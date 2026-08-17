'use strict';
/* =============================================================================
 * 1p-rangejobs-harness-runtime  -  the MONTH and YEAR pull, end to end, over
 * the REAL seam.
 *
 * tests/1p-rangejobs-runtime.test.js already proves the range engine against a
 * STUB importer: it hand-writes the pullMonth result shape. That can only ever
 * prove the engine agrees with the test author. This suite replaces the stub
 * with the REAL /1p importer (1p-feat_mls_schedimport_exact.js) driven by the
 * REAL range engine (1p-feat_mls_rangejobs.js) in one vm, so the contract that
 * actually ships - pullMonth -> onDayCheckpoint/shouldStop -> durable manifest
 * - is measured rather than assumed.
 *
 * It replays a synthetic MONTH containing: days with appointments, verified
 * EMPTY days, a day whose schedule read never completes, a day whose chart
 * history fails for two rows, a Pause after day 9 followed by a Resume, an
 * athenaOne sign-in that expires mid-run, and a REPEAT pull of the same month.
 * Then a YEAR, chained month by month, whose October failure must never
 * restart January.
 *
 * Fake extension, fake backend, frozen clock, synthetic names/DOB/MRN only.
 * No network, no Athena, no PHI, no login.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeMonthHarness } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const RANGE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_rangejobs.js'), 'utf8');

const PROVIDER = { mode: 'selected', id: '7', stableKey: 'backend:7' };
let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* every date the month engine announced, in order - the doctor's "progress by
   day". The line shape is pinned by tests/provider-month-exact-routing. */
function dayProgress(lines) {
  const out = [];
  for (const line of lines) {
    const m = String(line).match(/^Month pull (\d+)\/(\d+): (\d{4}-\d{2}-\d{2})$/);
    if (m) out.push({ index: Number(m[1]), total: Number(m[2]), date: m[3] });
  }
  return out;
}
function dayStates(manifest, monthKey) {
  const days = manifest.months[monthKey].days;
  return Object.keys(days).sort().map(d => ({ date: d, status: days[d].status, reason: days[d].reason, attempts: days[d].attempts }));
}
/* Install a deliberately UN-fixed copy of the range engine so a claim about a
   fix is measured against the bytes it replaced, not asserted. */
function installPatchedRange(h, find, replace) {
  assert(RANGE.indexOf(find) >= 0, 'the pre-fix control cannot find: ' + find);
  h.runInContext(RANGE.split(find).join(replace), '1p-feat_mls_rangejobs.prefix.js');
  return h.rt.__mlsP1RangeJobs;
}
/* the range engine reads window.__mlsSI fresh on every call, so a tap here
   sees exactly what the real importer handed back. */
function tapMonth(h, sink) {
  const real = h.api.pullMonth;
  h.rt.__mlsSI.pullMonth = function (opts) {
    const call = { month: opts.month, dates: (opts.dates || []).slice() };
    sink.calls.push(call);
    return real.call(h.rt.__mlsSI, opts).then(result => { sink.results.push(result); return result; });
  };
}

/* ======================================================================== 0 ==
 * The asset is still /1p-only and still the one the /1p loader installs.
 * ========================================================================== */
function testAssetIsP1Only() {
  const connect = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
  ok(connect.includes("A='1p-feat_mls_rangejobs.js'"), 'the /1p loader no longer installs the range engine');
  ok(!fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8').includes('1p-feat_mls_rangejobs.js'),
    'the production loader learned about the /1p range engine');
  ok(RANGE.includes("preview.route === '/1p/' || preview.route === '/1pScribeFlow.html'"),
    'the range engine can install outside the /1p preview marker');
  /* the transport-eaten-escape class: a bare d+/s+ literal parses fine and
     silently never matches (see memory: shell-transport-eats-backslashes). */
  const stripped = RANGE.replace(/\[[^\]]*\]/g, '[]');
  ok(!/\/\^?\(\?:[^/]*\)?[^/\\[]*(?<![\\[])\bd\{4\}-d\{2\}/.test(stripped),
    'a date regex in the range engine lost its backslashes in transport');
  ok(!/[^\\[]\bd\+\)/.test(stripped), 'a d+ literal in the range engine lost its backslash');
}

/* ======================================================================== 1 ==
 * ONE synthetic month, every shape at once.
 * ========================================================================== */
async function testWholeMonthReplay() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  /* 2 clinic days with rows, one of which loses two charts; 1 day whose grid
     never settles; the other 25 days are verified EMPTY. */
  h.seedDay('2026-02-03', 3);
  h.seedDay('2026-02-10', 4);
  h.chartFail.add('2026-02-10|syn-01');
  h.chartFail.add('2026-02-10|syn-02');
  h.incompleteDays.add('2026-02-17');

  const tap = { calls: [], results: [] };
  tapMonth(h, tap);
  const range = h.installRangeJobs();
  ok(range && range.installed === true, 'the range engine did not install over the real importer');

  const lines = [];
  const started = Date.now();
  const result = await range.startMonth('2026-02', {
    provider: PROVIDER, includeHistory: true, pullVisitBodies: false,
    onStatus: m => lines.push(String(m || ''))
  });
  const elapsed = Date.now() - started;

  /* --- progress BY DAY, one line per day, in order, never skipping ------ */
  const progress = dayProgress(lines);
  eq(progress.length, 28, 'the month did not announce one progress line per day');
  eq(progress[0].total, 28, 'the progress line does not carry the day total');
  eq(progress.map(p => p.date).join(','), dayStates(h.manifest(), '2026-02').map(d => d.date).join(','),
    'the announced day order is not the manifest day order');

  /* --- per-day checkpoints are DURABLE and carry the day's OWN verdict -- */
  const states = dayStates(h.manifest(), '2026-02');
  const byDate = Object.fromEntries(states.map(s => [s.date, s]));
  eq(states.filter(s => s.status === 'complete').length, 26, 'the month did not durably complete 26 days');
  eq(byDate['2026-02-03'].status, 'complete', 'a clean 3-row day did not checkpoint complete');
  eq(byDate['2026-02-03'].reason, 'complete', 'a day with appointments lost its verdict');
  eq(byDate['2026-02-01'].reason, 'provider-empty', 'a verified-empty day is indistinguishable from a day with patients');
  eq(byDate['2026-02-10'].status, 'retry', 'a day that lost two charts was marked complete');
  eq(byDate['2026-02-10'].reason, 'history-partial',
    'the failed day did not keep the importer\'s own cause (got ' + byDate['2026-02-10'].reason + ')');
  eq(byDate['2026-02-17'].reason, 'schedule-incomplete',
    'the unsettled-grid day did not keep its own cause (got ' + byDate['2026-02-17'].reason + ')');
  ok(byDate['2026-02-10'].reason !== byDate['2026-02-17'].reason,
    'two different failures were flattened into one durable reason');
  eq(h.manifest().status, 'waiting-retry', 'a month with two failed days claimed a terminal state');

  /* --- the completion receipt: done / with rows / empty / failed / skipped */
  const summary = h.manifest().summary;
  eq(summary.days, 28, 'the receipt lost the day total');
  eq(summary.complete, 26, 'the receipt miscounted completed days');
  eq(summary.empty, 25, 'the receipt cannot say how many days Athena verified empty');
  eq(summary.withRows, 1, 'the receipt cannot say how many days actually held appointments');
  eq(summary.failed, 2, 'the receipt miscounted days still to retry');
  eq(summary.pending, 0, 'a day was left unaccounted for');
  eq(h.manifest().run.skippedComplete, 0, 'a first run claimed it skipped verified work');
  eq(h.manifest().run.plannedDays, 28, 'a first run did not plan every day');

  /* --- the store: no duplicate appointment, one row per seeded slot ----- */
  const census = h.census();
  eq(census.rows, 7, 'the month did not import exactly the 7 seeded appointments');
  eq(census.uniqueIds, 7, 'the backend holds duplicate appointment ids');
  eq(census.uniqueAppointments, 7, 'the same Athena appointment was stored twice');

  /* --- empty days are not paid for: ed-1.0.0 over a whole month --------- */
  const emptyDayNav = h.gotoDates.filter(d => !['2026-02-03', '2026-02-10'].includes(d)).length;
  eq(emptyDayNav, 26, 'the month did not visit each empty day exactly once');
  eq(h.chartCalls.filter(c => !['2026-02-03', '2026-02-10'].includes(c.day)).length, 0,
    'an Athena chart was opened on a verified-empty day');
  eq(h.noteCalls.filter(c => !['2026-02-03', '2026-02-10'].includes(c.onlyDate)).length, 0,
    'a day-note was read on a verified-empty day');
  ok(elapsed < 45000, 'the 28-day replay took ' + elapsed + ' ms - the empty-day path is no longer free');

  /* ================================ RESUME: only the failures re-run ==== */
  h.chartFail.clear();
  h.incompleteDays.clear();
  const navBefore = h.gotoDates.length;
  const cleanDayChartsBefore = h.chartCalls.filter(c => c.day === '2026-02-03').length;
  const resumed = await range.resume({ onStatus: () => {} });
  const revisited = h.gotoDates.slice(navBefore);

  eq(resumed.complete, true, 'the month did not finish after its two failures recovered');
  eq(revisited.length, 2, 'resume re-visited ' + revisited.length + ' days; only the 2 failed ones were unproved');
  eq(revisited.sort().join(','), '2026-02-10,2026-02-17', 'resume re-pulled a day it had already verified');
  ok(cleanDayChartsBefore > 0, 'the fixture never opened a chart on the clean day - the next check is vacuous');
  eq(h.chartCalls.filter(c => c.day === '2026-02-03').length, cleanDayChartsBefore,
    'resume re-opened charts on an already-verified day');
  const resumedManifest = h.manifest();
  eq(resumedManifest.status, 'complete', 'the recovered month did not reach a terminal complete state');
  eq(resumedManifest.summary.complete, 28, 'the receipt did not account for every day after recovery');
  eq(resumedManifest.summary.failed, 0, 'the receipt still claims failures after a clean recovery');
  eq(resumedManifest.run.skippedComplete, 26, 'the receipt cannot say how many days it skipped as already verified');
  eq(resumedManifest.run.plannedDays, 2, 'the receipt cannot say how much work the resume actually planned');
  /* every failed day was retried INDIVIDUALLY, not by restarting the month */
  eq(tap.calls[tap.calls.length - 1].dates.join(','), '2026-02-10,2026-02-17',
    'the resume handed the importer more than the unproved days');

  /* ================================ REPEAT: no duplicate data ========== */
  const censusBefore = h.census();
  const navBeforeRepeat = h.gotoDates.length;
  /* a COMPLETE job is terminal, so an explicit second pull of the same month
     is admitted - that is exactly the "pull it again" the owner asked about. */
  const repeat = await range.startMonth('2026-02', { provider: PROVIDER, onStatus: () => {} });
  eq(repeat.complete, true, 'the repeat month pull did not complete');
  eq(h.gotoDates.length - navBeforeRepeat, 28, 'the repeat pull did not actually re-read the month');
  const censusAfter = h.census();
  eq(censusAfter.rows, censusBefore.rows, 'the repeat month pull created duplicate appointments');
  eq(censusAfter.uniqueIds, censusBefore.uniqueIds, 'the repeat month pull duplicated backend ids');
  eq(censusAfter.uniqueAppointments, censusBefore.uniqueAppointments, 'the repeat pull stored the same Athena appointment twice');
  eq(h.patients.length, 24, 'the repeat month pull created duplicate patients');

  /* the lease is not left held by anybody */
  eq(h.locksHeld().length, 0, 'a settled month job still holds a Web Lock');
  eq(h.store.has(h.monthOwnerKey()), false, 'a settled month job left the month-owner record behind');
  range.revert();
}

/* ======================================================================== 1b =
 * CAUSAL control for p1-range-reasons-1.0.0: with the final retry-reconcile
 * loop un-guarded (the shipped bytes before this lane), the SAME two failures
 * both read `month-partial` - the durable receipt could not tell a lost chart
 * from an unsettled Athena grid.
 * ========================================================================== */
async function testPreFixFlattensEveryFailureReason() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-02-10', 4);
  h.chartFail.add('2026-02-10|syn-01');
  h.incompleteDays.add('2026-02-17');
  const preFix = installPatchedRange(h,
    "      if (seen[retryDate] && retryDay && retryDay.status !== 'complete') continue;",
    "      /* pre-fix: no guard */");
  await preFix.startMonth('2026-02', { provider: PROVIDER, onStatus: () => {} });
  const days = h.manifest().months['2026-02'].days;
  eq(days['2026-02-10'].reason, 'month-partial', 'the pre-fix control did not flatten the history failure');
  eq(days['2026-02-17'].reason, 'month-partial', 'the pre-fix control did not flatten the schedule failure');
  eq(days['2026-02-10'].reason, days['2026-02-17'].reason,
    'the pre-fix control already distinguished the two causes - the fix proves nothing');
  preFix.revert();
}

/* ======================================================================== 2 ==
 * Interruption after day 9, then Resume. A browser close is the same shape:
 * the manifest survives, the days already proved are never re-pulled.
 * ========================================================================== */
async function testStopAfterDayNineAndResume() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-02-04', 2);
  h.seedDay('2026-02-12', 2);
  const range = h.installRangeJobs();

  let stoppedAt = '';
  const result = await range.startMonth('2026-02', {
    provider: PROVIDER,
    onStatus: m => {
      const hit = String(m).match(/^Month pull (\d+)\/\d+: (\d{4}-\d{2}-\d{2})$/);
      if (hit && Number(hit[1]) === 9 && !stoppedAt) { stoppedAt = hit[2]; range.pause(); }
    }
  });
  eq(stoppedAt, '2026-02-09', 'the fixture did not press Pause on day 9');
  eq(result.status, 'paused', 'the settling month overwrote the durable paused state');
  ok(h.rt.__mlsPullStopRequested === true, 'Pause did not ask the importer to stop');

  const paused = h.manifest();
  const states = dayStates(paused, '2026-02');
  const done = states.filter(s => s.status === 'complete').map(s => s.date);
  ok(done.length >= 8, 'the eight days proved before the Pause were lost (kept ' + done.length + ')');
  ok(done.every(d => d <= '2026-02-09'), 'a day after the stop was marked complete');
  const afterStop = states.filter(s => s.date > '2026-02-09');
  eq(afterStop.filter(s => s.status === 'complete').length, 0, 'the pull kept running past the Pause');
  ok(afterStop.every(s => s.reason === 'stopped-by-user'),
    'the days the stop skipped are not honestly marked stopped-by-user');
  eq(h.gotoDates.filter(d => d > '2026-02-09').length, 0, 'Athena was navigated after the doctor pressed Pause');
  eq(h.locksHeld().length, 0, 'the paused job is still holding a Web Lock');
  eq(h.store.has(h.monthOwnerKey()), false, 'the paused job left the month-owner record held');
  /* a saved, non-terminal job blocks a second Start - a doctor cannot lose
     their checkpoint by pressing Start again */
  const second = await range.startMonth('2026-02', { provider: PROVIDER });
  eq(second.reason, 'job-exists', 'a second Start overwrote a paused job');
  eq(h.manifest().summary.complete, done.length, 'the refused Start disturbed the saved checkpoint');

  /* Resume: continue, never restart */
  const navBefore = h.gotoDates.length;
  const resumed = await range.resume({ onStatus: () => {} });
  eq(resumed.complete, true, 'the paused month did not finish on Resume');
  const revisited = h.gotoDates.slice(navBefore);
  eq(revisited.filter(d => d <= '2026-02-08').length, 0, 'Resume re-pulled a day proved before the Pause');
  eq(h.manifest().summary.complete, 28, 'the resumed month did not account for every day');
  eq(h.manifest().summary.failed, 0, 'the resumed month left failures behind');
  ok(h.manifest().run.skippedComplete >= 8, 'the receipt does not report the days Resume skipped');
  eq(h.census().uniqueIds, 4, 'the interrupted-then-resumed month duplicated appointments');
  range.revert();
}

/* ======================================================================== 3 ==
 * A browser CLOSE mid-month: a second page, same account, same storage.
 * ========================================================================== */
async function testBrowserCloseResumesInANewPage() {
  const store = new Map();
  const world = { backendRows: [], savedBodies: [], patients: [], seq: 0 };
  const first = makeMonthHarness({ today: '2026-03-15', store, world });
  first.seedDay('2026-02-06', 2);
  const rangeA = first.installRangeJobs();
  let closed = false;
  await rangeA.startMonth('2026-02', {
    provider: PROVIDER,
    onStatus: m => {
      const hit = String(m).match(/^Month pull (\d+)\/\d+: /);
      if (hit && Number(hit[1]) === 12 && !closed) { closed = true; rangeA.pause(); }
    }
  });
  /* simulate the close: this page never runs again. The manifest is the only
     thing that crosses. Put it back into the exact in-flight state a close
     leaves behind - "running", not "paused". */
  const key = first.manifestKey();
  const inFlight = JSON.parse(store.get(key));
  inFlight.status = 'running'; inFlight.reason = '';
  store.set(key, JSON.stringify(inFlight));
  const provedBeforeClose = Object.keys(inFlight.months['2026-02'].days)
    .filter(d => inFlight.months['2026-02'].days[d].status === 'complete');
  ok(provedBeforeClose.length >= 11, 'the fixture did not close the browser mid-month');
  rangeA.revert();

  const second = makeMonthHarness({ today: '2026-03-15', store, world });
  second.seedDay('2026-02-06', 2);
  const rangeB = second.installRangeJobs();
  const recovered = await rangeB.resume({ onStatus: () => {} });
  eq(recovered.complete, true, 'a job interrupted by a browser close could not be recovered');
  eq(second.gotoDates.filter(d => provedBeforeClose.includes(d)).length, 0,
    'the new page re-pulled days the closed page had already proved');
  eq(second.manifest().summary.complete, 28, 'the recovered month did not account for every day');
  eq(second.census().uniqueIds, 2, 'recovery after a browser close duplicated appointments');
  rangeB.revert();
}

/* ======================================================================== 4 ==
 * athenaOne sign-in expires mid-run: stop early, name the ONE cause, keep
 * every unproved day retryable, and recover on Resume.
 * ========================================================================== */
async function testLoginExpiryMidRun() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-02-02', 2);
  const tap = { calls: [], results: [] };
  tapMonth(h, tap);
  const range = h.installRangeJobs();

  let seen = 0;
  const result = await range.startMonth('2026-02', {
    provider: PROVIDER,
    onStatus: m => { if (/^Month pull \d+\/\d+: /.test(String(m))) { seen++; if (seen === 5) h.setLoginExpired(true); } }
  });
  eq(result.status, 'waiting-retry', 'an expired athenaOne sign-in did not leave a resumable job');
  eq(result.reason, 'no-read',
    'the job does not name the ONE cause the importer proved (got ' + result.reason + ')');
  eq(tap.results[0].reason, 'month-stopped-systemic', 'the importer did not stop the sweep systemically');

  const states = dayStates(h.manifest(), '2026-02');
  const proved = states.filter(s => s.status === 'complete');
  eq(proved.length, 4, 'the four days proved before the sign-in expired were lost');
  eq(states.filter(s => s.reason === 'no-read').length, 3,
    'the days that hit the expired sign-in are not marked with that cause');
  eq(states.filter(s => s.reason === 'not-attempted-after-systemic-failure').length, 21,
    'the days after the systemic stop were silently dropped instead of queued');
  eq(states.filter(s => s.status === 'pending').length, 0, 'a day was left in limbo by the systemic stop');
  eq(h.gotoDates.length, 7, 'the sweep kept driving Athena after three identical failures');

  /* the doctor signs back in and presses Resume */
  h.setLoginExpired(false);
  const navBefore = h.gotoDates.length;
  const recovered = await range.resume({ onStatus: () => {} });
  eq(recovered.complete, true, 'the job did not finish after the sign-in was restored');
  eq(h.gotoDates.slice(navBefore).length, 24, 'Resume re-pulled days that were already proved');
  eq(h.manifest().summary.complete, 28, 'the recovered month did not account for every day');
  eq(h.manifest().run.skippedComplete, 4, 'the receipt cannot say what the recovery skipped');
  eq(h.census().uniqueIds, 2, 'recovery after a sign-in expiry duplicated appointments');
  range.revert();
}

/* ======================================================================== 5 ==
 * The current month stops at TODAY: no future day is queued, navigated, or
 * given a day-note read - and today's own note is still read (fd-1.0.0).
 * ========================================================================== */
async function testNoFutureDayIsTouched() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-03-15', 2);
  h.seedDay('2026-03-09', 2);
  const range = h.installRangeJobs();
  const result = await range.startMonth('2026-03', { provider: PROVIDER, onStatus: () => {} });
  eq(result.complete, true, 'the elapsed part of the current month did not complete');

  const states = dayStates(h.manifest(), '2026-03');
  eq(states.length, 15, 'the current month queued ' + states.length + ' days; only 15 have happened');
  eq(states[states.length - 1].date, '2026-03-15', 'the queue did not reach today - the boundary is untested');
  eq(states.filter(s => s.date > '2026-03-15').length, 0, 'a future day was queued');
  eq(h.gotoDates.filter(d => d > '2026-03-15').length, 0, 'Athena was navigated to a future day');
  eq(h.noteCalls.filter(c => String(c.onlyDate) > '2026-03-15').length, 0, 'a day-note was read on a future day');
  /* non-vacuity: TODAY's own note IS read, so the assertion above is a
     boundary, not a dead branch. */
  eq(h.noteCalls.filter(c => c.onlyDate === '2026-03-15').length, 2, 'today\'s own day-note was not read');
  eq(h.noteCalls.filter(c => c.onlyDate === '2026-03-09').length, 2, 'a past day\'s own day-note was not read');

  /* a future month cannot be started at all */
  await range.cancel();
  eq((await range.startMonth('2026-04', { provider: PROVIDER })).reason, 'invalid-range', 'a future month was accepted');
  range.revert();
}

/* ======================================================================== 6 ==
 * p1-range-daybound-1.0.0: the queue must not contain a day the importer's own
 * Eastern month bound will refuse, or the month can never complete.
 * ========================================================================== */
async function testAccountZoneAheadOfEasternStillCompletes() {
  /* 2026-03-16T16:00Z is 12:00 in New York on the 16th and 01:00 in Tokyo on
     the 17th: the account day and the importer's day disagree. */
  const h = makeMonthHarness({ today: '2026-03-16' });
  h.store.set('sf_u::' + h.account + '::acctTz', 'Asia/Tokyo');
  const tap = { calls: [], results: [] };
  tapMonth(h, tap);
  const range = h.installRangeJobs();
  const result = await range.startMonth('2026-03', { provider: PROVIDER, onStatus: () => {} });

  const states = dayStates(h.manifest(), '2026-03');
  eq(states[states.length - 1].date, '2026-03-16', 'the queue was not clamped to the day both sides agree on');
  eq(result.complete, true, 'a month whose account zone runs ahead of Eastern could not complete');
  eq(states.filter(s => s.status !== 'complete').length, 0, 'a queued day the importer refuses was left unfinishable');
  eq(tap.calls[0].dates.length, 16, 'the engine asked the importer for a day it would silently drop');

  const importerKeys = tap.results[0].days.map(d => d.date);
  eq(importerKeys.includes('2026-03-17'), false,
    'the importer accepted 2026-03-17 - the divergence this clamp exists for is gone, re-check the bound');
  range.revert();

  /* CAUSAL control: run the PRE-FIX bytes (account day alone) in the same
     fixture. The queue gains a seventeenth day, the real importer silently
     drops it from `dates`, so it is never checkpointed and the month can
     never complete - no matter how many times Resume is pressed. */
  const before = makeMonthHarness({ today: '2026-03-16' });
  before.store.set('sf_u::' + before.account + '::acctTz', 'Asia/Tokyo');
  const preFix = installPatchedRange(before,
    "createMonths(kind, target, queueBoundDayKey(), stamp)",
    "createMonths(kind, target, todayKey(), stamp)");
  const preResult = await preFix.startMonth('2026-03', { provider: PROVIDER, onStatus: () => {} });
  const preStates = dayStates(before.manifest(), '2026-03');
  eq(preStates.length, 17, 'the pre-fix control did not reproduce the extra day - the control proves nothing');
  eq(preResult.complete, false, 'the pre-fix control completed - the divergence is not what stalled the month');
  eq(preStates[preStates.length - 1].reason, 'not-attempted', 'the pre-fix control failed for some other reason');
  await preFix.resume({});
  eq(before.manifest().months['2026-03'].days['2026-03-17'].attempts, 2,
    'the pre-fix control did not re-attempt the impossible day on Resume');
  eq(before.manifest().status !== 'complete', true, 'the pre-fix control eventually completed - it should never');
  preFix.revert();
}

/* ======================================================================== 7 ==
 * YEAR = months chained on the same checkpoints. October's failure must never
 * restart January, and pause/cancel must release everything.
 * ========================================================================== */
async function testYearIsMonthsChained() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-01-08', 2);
  h.seedDay('2026-02-11', 2);
  h.incompleteDays.add('2026-02-11');          /* February loses one day     */
  const tap = { calls: [], results: [] };
  tapMonth(h, tap);
  const range = h.installRangeJobs();

  const first = await range.startYear(2026, { provider: PROVIDER, onStatus: () => {} });
  eq(first.status, 'waiting-retry', 'a year with one failed day claimed a terminal state');
  eq(tap.calls.map(c => c.month).join(','), '2026-01,2026-02', 'the year did not stop at the incomplete month');
  const manifest = h.manifest();
  eq(Object.keys(manifest.months).sort().join(','), '2026-01,2026-02,2026-03', 'the year queued future months');
  eq(manifest.months['2026-01'].status, 'complete', 'January completion was not durable');
  eq(manifest.months['2026-02'].status, 'retry', 'the month that lost a day was promoted');
  eq(manifest.months['2026-03'].status, 'pending', 'a month after the failure was silently consumed');
  eq(manifest.summary.months, 3, 'the year receipt lost its month count');
  eq(manifest.summary.completeMonths, 1, 'the year receipt miscounted complete months');
  eq(manifest.summary.failed, 1, 'the year receipt miscounted days still to retry');
  const januaryNav = h.gotoDates.filter(d => d.slice(0, 7) === '2026-01').length;
  eq(januaryNav, 31, 'January was not pulled exactly once');

  /* the failure recovers: only the ONE day re-runs, then the year continues */
  h.incompleteDays.clear();
  const callsBefore = tap.calls.length;
  const done = await range.resume({ onStatus: () => {} });
  eq(done.complete, true, 'the year did not finish after its one failed day recovered');
  const retried = tap.calls.slice(callsBefore);
  eq(retried.map(c => c.month).join(','), '2026-02,2026-03', 'the resume restarted a completed month');
  eq(retried[0].dates.join(','), '2026-02-11', 'the February retry re-ran days it had already proved');
  eq(h.gotoDates.filter(d => d.slice(0, 7) === '2026-01').length, januaryNav,
    'January restarted because February failed');
  eq(h.manifest().summary.completeMonths, 3, 'the finished year does not report three complete months');
  eq(h.manifest().summary.days, 31 + 28 + 15, 'the year receipt lost days');
  eq(h.census().uniqueIds, 4, 'the chained year duplicated appointments');
  eq(h.locksHeld().length, 0, 'the finished year still holds a Web Lock');
  eq(h.store.has(h.monthOwnerKey()), false, 'the finished year left the month-owner record held');
  range.revert();
}

/* ======================================================================== 8 ==
 * Cancel is terminal, releases everything, and destroys no clinical data.
 * ========================================================================== */
async function testCancelIsCleanAndReleasesTheLease() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-02-03', 2);
  const range = h.installRangeJobs();
  let cancelledAt = '';
  const result = await range.startYear(2026, {
    provider: PROVIDER,
    onStatus: m => {
      const hit = String(m).match(/^Month pull (\d+)\/\d+: (\d{4}-\d{2}-\d{2})$/);
      if (hit && Number(hit[1]) === 6 && !cancelledAt) { cancelledAt = hit[2]; range.cancel(); }
    }
  });
  eq(result.status, 'cancelled', 'the settling job overwrote the cancelled state');
  eq(h.manifest().status, 'cancelled', 'cancel did not checkpoint a terminal state');
  eq(h.locksHeld().length, 0, 'a cancelled job still holds a Web Lock');
  eq(h.store.has(h.monthOwnerKey()), false, 'a cancelled job left the month-owner record held');
  eq(h.gotoDates.filter(d => d > cancelledAt).length, 0, 'Athena was navigated after Cancel');
  ok(h.census().uniqueIds >= 0 && h.patients.length === 24, 'cancel deleted patient records');
  eq((await range.resume({})).reason, 'cancelled', 'a cancelled job restarted without an explicit new job');
  /* an explicit new job is admitted after a terminal one */
  const restarted = await range.startMonth('2026-02', { provider: PROVIDER, onStatus: () => {} });
  eq(restarted.complete, true, 'an explicit new pull was refused after a cancel');
  range.revert();
}

async function main() {
  testAssetIsP1Only();
  await testWholeMonthReplay();
  await testPreFixFlattensEveryFailureReason();
  await testStopAfterDayNineAndResume();
  await testBrowserCloseResumesInANewPage();
  await testLoginExpiryMidRun();
  await testNoFutureDayIsTouched();
  await testAccountZoneAheadOfEasternStillCompletes();
  await testYearIsMonthsChained();
  await testCancelIsCleanAndReleasesTheLease();
  console.log('PASS 1p-rangejobs-harness-runtime: ' + checks + ' checks - a whole synthetic month replayed through the REAL /1p importer under the REAL range engine: every day checkpoints durably with its own verdict (empty-day / history-partial / schedule-incomplete, no longer one generic code), Pause after day 9 and a browser close both resume without re-pulling one proved day, an expired athenaOne sign-in stops the sweep after three identical failures and names that one cause, a repeat month pull adds no duplicate appointment or patient, no future day is queued/navigated/note-read while today\'s own note still is, the queue is clamped to the day the importer itself will accept, and a year runs month by month so October can never restart January');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-rangejobs-harness-runtime did not finish')); process.exit(1); }, 600000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });

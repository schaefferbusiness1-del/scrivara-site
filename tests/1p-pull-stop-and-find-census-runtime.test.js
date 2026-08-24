'use strict';
/* =============================================================================
 * stp-2.0.0  +  fdx-1.0.0  +  scv-1.0.0
 *
 * (1) stp-2.0.0 - owner 2026-08-17: "a couple issues like when STOPPING".
 *     MEASURED CAUSE: the cooperative stop broke only the CHART loop. After it,
 *     the batch still ran the whole today-note TAIL pass (one Athena read per
 *     visits-skipped row), then the automatic convergence SWEEP, then armed a
 *     DEFERRED today-note round - minutes of further Athena driving after the
 *     doctor pressed Stop, with the lease still held.
 *
 * (2) fdx-1.0.0 - owner 2026-08-17, "Pull Thursday the 27th": 13 of 15 rows
 *     failed with ONE sentence, "athenaOne patient search found no matching
 *     patient." That sentence is background.js:12596 collapsing FOUR distinct
 *     extension outcomes (no-results / no-name-match / blank-error /
 *     rows-not-rendered) and the site threw the findReason away.
 *
 * (3) scv-1.0.0 - skeptic verdict 3: the counters can say complete while the
 *     store is byte-identical. The verdict is now a STORE CENSUS.
 *
 * Real importer, fake extension, synthetic identities. No network, no PHI.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness, flush } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const SI = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
const TWIN = fs.readFileSync(path.join(ROOT, '1p', 'index.html'), 'utf8');
const MC = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
const EMPTY_VISITS = () => ({ ok: true, visits: 0, authoritativeEmpty: true });
const GOOD_CHART = () => ({ problems: 'Synthetic problem', meds: 'Synthetic med', summary: 'Synthetic summary' });

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ============================ fdx-1.0.0: the SHELL keeps the find verdict == */
function testShellAttachesFindDiag() {
  for (const [name, src] of [['1pScribeFlow.html', SHELL], ['1p/index.html', TWIN]]) {
    const a = src.indexOf('/* ===== p1-find-diag-1.0.0 (PHI-free chart-open evidence) =====');
    const b = src.indexOf('/* ===== end p1-find-diag-1.0.0 ===== */');
    ok(a >= 0 && b > a, name + ': the p1-find-diag-1.0.0 block is missing or unclosed');
    const block = src.slice(a, b);
    ok(/__fdErr\.mlsFind\s*=/.test(block), name + ': the chart-read failure does not carry mlsFind');
    ok(/findReason:/.test(block) && /candidates:/.test(block) && /route:/.test(block),
      name + ': mlsFind does not carry findReason/candidates/route');
    /* PHI trap: the evidence must be codes and counts only. */
    ok(!/chartName|chartDob|chartMrn|patientName|target\.name|target\.dob|target\.mrn/.test(block),
      name + ': the find evidence carries a patient identifier - it must be codes only');
  }

  /* EXECUTE the real block: a refusal Error must arrive carrying the code. */
  const i = SHELL.indexOf('/* ===== p1-find-diag-1.0.0 (PHI-free chart-open evidence) =====');
  const j = SHELL.indexOf('/* ===== end p1-find-diag-1.0.0 ===== */');
  const body = SHELL.slice(i, j);
  const fn = new Function('r', 'reject', body + '\nreturn null;');
  let caught = null;
  fn({ ok: false, text: '', error: 'athenaOne patient search found no matching patient.',
       findReason: 'rows-not-rendered', candidates: 0, diag: { route: 'findpatient' } },
     e => { caught = e; });
  ok(caught && caught.mlsFind, 'the extracted block did not attach mlsFind to the rejection');
  eq(caught.mlsFind.findReason, 'rows-not-rendered', 'the extracted block lost the findReason');
  eq(caught.mlsFind.route, 'findpatient', 'the extracted block lost the route');
  ok(/no matching patient/.test(String(caught.message)),
    'the extracted block changed the honest refusal sentence');

  /* NON-VACUITY: the pre-fix one-liner throws away the code. */
  let plain = null;
  (function (r, reject) { reject(new Error(r.error)); })(
    { ok: false, text: '', error: 'athenaOne patient search found no matching patient.', findReason: 'rows-not-rendered' },
    e => { plain = e; });
  ok(plain && !plain.mlsFind, 'the pre-fix shape already carried mlsFind - the test proves nothing');
}

/* ============ fdx-1.0.0: the ENGINE counts the four collapsed outcomes ===== */
async function testEngineCensusesFindReasons() {
  const CLASSES = ['no-results', 'no-name-match', 'blank-error', 'rows-not-rendered'];
  const h = makeHarness({
    day: '2026-08-27', today: '2026-08-28', rows: 8, visitNotesOn: true,
    /* the class is a property of the PATIENT, not of the attempt: the engine
       retries a failed chart read once, so a per-call cycle would only ever
       record the second attempt's code. */
    chartResult: (target) => ({
      __throw: 'athenaOne patient search found no matching patient.',
      mlsFind: { findReason: CLASSES[(Number(String(target.patientId).slice(-2)) - 1) % 4], via: '', route: 'findpatient', candidates: 0, opened: false }
    })
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(receipt.noMatchingPatient, 8, 'the receipt did not count the collapsed no-matching-patient rows');
  for (const c of CLASSES) {
    eq(Number((receipt.findReasons || {})[c] || 0), 2,
      'the receipt did not break "' + c + '" out of the one collapsed sentence');
  }
  ok(receipt.patients.every(p => p.findDiag && p.findDiag.findReason),
    'a failed row kept no per-row find verdict');
  /* the four codes are the ONLY thing that distinguishes these rows - before
     the fix every one of them read the same single sentence. */
  const messages = new Set(receipt.patients.map(p => String(p.reason || '')));
  eq(messages.size, 1, 'the fixture did not reproduce ONE sentence for four outcomes');

  /* rows-not-rendered earns an ACTIONABLE hint; no-results must not. */
  const hRows = makeHarness({
    day: '2026-08-27', today: '2026-08-28', rows: 6, visitNotesOn: true,
    chartResult: () => ({ __throw: 'athenaOne patient search found no matching patient.',
      mlsFind: { findReason: 'rows-not-rendered', route: 'findpatient', candidates: 0 } })
  });
  const rRows = await hRows.api._runHistoryBatch(hRows.rows, [], hRows.onStatus);
  ok(/athena tab/i.test(String(rRows.findHint || '')),
    'a rows-not-rendered day produced no honest "the athena tab is not painting" hint');
  /* PHI trap: the hint must not contain ANY synthetic identifier. */
  const hintText = String(rRows.findHint || '');
  ok(hRows.patients.every(p0 => hintText.indexOf(p0.name) < 0 && hintText.indexOf(p0.dob) < 0),
    'the hint carries a patient name or DOB - it must be counts and tab state only');

  const hNo = makeHarness({
    day: '2026-08-27', today: '2026-08-28', rows: 6, visitNotesOn: true,
    chartResult: () => ({ __throw: 'athenaOne patient search found no matching patient.',
      mlsFind: { findReason: 'no-results', route: 'findpatient', candidates: 0 } })
  });
  const rNo = await hNo.api._runHistoryBatch(hNo.rows, [], hNo.onStatus);
  eq(String(rNo.findHint || ''), '',
    'a genuine athena "no results" answer was blamed on the tab - that would be a lie');
}

/* ==================== stp-2.0.0: STOP ends every remaining leg ============ */
async function testStopEndsEverything() {
  const DAY = '2026-08-17';
  let stopAt = null;
  let notesAtStop = null;
  const h = makeHarness({
    day: DAY, today: DAY, rows: 12, visitNotesOn: true, noteResult: EMPTY_VISITS,
    chartCoverage: true, parseResult: GOOD_CHART,
    /* syn-04's chart read never succeeds (both attempts fail), so its day-note
       is still UNREAD when the doctor presses Stop on the way to syn-05 - the
       exact state the tail pass used to walk through minutes after the Stop. */
    chartResult: (target) => {
      const id = String(target.patientId);
      if (id === 'syn-04') return { __throw: 'chart-read-failed-fixture' };
      if (id === 'syn-05') { stopAt = id; notesAtStop = h.noteCalls.length; h.rt.window.__mlsPullStopRequested = true; return null; }
      return null;
    }
  });
  const notesBeforeStop = () => h.noteCalls.length;
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  eq(receipt.stoppedByUser, true, 'a stopped batch does not say so on its receipt');
  eq(receipt.reason, 'stopped-by-user', 'a stopped batch still reports the generic history-partial');
  ok(receipt.retry.some(r => r.reason === 'stopped-by-user'),
    'the rows the doctor stopped are not honestly marked stopped-by-user');
  eq(stopAt, 'syn-05', 'the fixture did not press Stop where it intended');

  /* The current chart may finish, but Stop must not start another chart/body
     or invent a separate pulled-day tail failure. */
  eq(Number(receipt.todayNoteStoppedRows || 0), 0,
    'Stop invented a separate pulled-day note failure');
  eq(h.noteCalls.length, Number(notesAtStop || 0) + 1,
    'Stop did not finish exactly the in-flight chart body before halting');
  ok(h.noteCalls.every(c => ['syn-01', 'syn-02', 'syn-03', 'syn-05'].includes(String(c.patientId))),
    'a visit body started after the in-flight chart completed');

  /* the SWEEP did not run */
  eq(receipt.sweepPasses, undefined, 'the automatic sweep ran after the doctor pressed Stop');

  /* the deferred today-note round is not armed */
  const q = h.api._todayNoteDeferred();
  eq(q.queued, 0, 'a deferred today-note round survived the Stop');
  eq(q.armed, false, 'a deferred today-note timer was left armed after the Stop');

  /* PARTIAL, but honest: everything read before the Stop is still on the receipt */
  eq(receipt.patients.length, 5, 'the charts read before the Stop were discarded or over-run');
  ok(receipt.processed >= 5, 'the stop lost the processed count of the work that finished');
  eq(receipt.retry.filter(r => r.reason === 'stopped-by-user').length, 7,
    'the seven rows never started are not all queued as stopped-by-user');
  eq(notesBeforeStop(), 4, 'the completed ON visit-body work before Stop was lost or over-run');

  /* nothing is latched: stopPull() reports what it did and drains its queue */
  const s1 = h.api.stopPull();
  eq(s1.requested, true, 'stopPull no longer reports what it did');
  eq(typeof s1.deferredTodayNotesDropped, 'number', 'stopPull does not report the dropped notes');

  /* NON-VACUITY: with the stop flag DOWN the same ON fixture walks the whole day. */
  const h2 = makeHarness({
    day: DAY, today: DAY, rows: 12, visitNotesOn: true, noteResult: EMPTY_VISITS,
    chartCoverage: true, parseResult: GOOD_CHART,
    chartResult: (target) => (String(target.patientId) === 'syn-04' ? { __throw: 'chart-read-failed-fixture' } : null)
  });
  const r2 = await h2.api._runHistoryBatch(h2.rows, [], h2.onStatus);
  eq(h2.noteCalls.length, 11,
    'without a Stop, the control did not complete every chart body except the failed chart');
  eq(r2.patients.length, 12, 'the un-stopped control did not walk the whole day');
}

/* the lease/mutex release is structural: prove the settle path releases on
   BOTH outcomes and that nothing in the stop path bypasses it. */
function testStopReleasesTheLease() {
  const i = SI.indexOf('function runManagedAthenaOperation(task, busyFactory) {');
  ok(i >= 0, 'runManagedAthenaOperation is missing');
  const block = SI.slice(i, SI.indexOf('function buildRetryRows', i));
  const releases = (block.match(/releaseAthenaOwner\(\);/g) || []).length;
  ok(releases >= 3, 'the Athena owner token is not released on every exit path (found ' + releases + ')');
  ok((block.match(/pullRunning = false;/g) || []).length >= 2,
    'pullRunning is not cleared on both settle paths - "already running" could latch');
  ok((block.match(/releaseSiLease\(\);/g) || []).length >= 2,
    'the page pull lease is not released on both settle paths');
  ok(/window\.__mlsPullBusyAt = 0/.test(block), 'the cross-tab busy stamp is not cleared');
  /* the stop must not be able to re-arm the deferred round */
  ok(/window\.__mlsPullStopRequested === true.*tnDropDeferredQueue|tnDropDeferredQueue\("stopped-by-user"\); return false;/s.test(SI),
    'tnScheduleDeferredRound can still arm a round the doctor stopped');
  /* an explicit retry is a NEW intent and must clear the latch */
  ok(/window\.__mlsPullStopRequested = false; \/\* stp-2\.0\.0/.test(SI),
    'an explicit Retry cannot clear the stop latch - the next retry would stop instantly');
  /* the site-side auto re-pull refuses after a stop */
  ok(/__stoppedByUser/.test(MC) && /!__stoppedByUser/.test(MC),
    '1p-mls-connect.js still auto-re-pulls after the doctor pressed Stop');
}

/* ==================== scv-1.0.0: the verdict is a store census ============ */
async function testVerdictIsAStoreCensus() {
  /* every chart read "succeeds" but the fake writer stores nothing, so the
     walk counters are perfect and the STORE is byte-identical - the exact
     shape tests/pull-verdict-is-a-store-census.test.js proved. */
  const h = makeHarness({ day: '2026-08-17', today: '2026-08-17', rows: 5, visitNotesOn: true, noteResult: EMPTY_VISITS });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  ok(receipt.storeCensus, 'the receipt carries no store census at all');
  eq(receipt.storeCensus.measured === true || receipt.storeCensus.measured === false, true,
    'the store census does not state whether it was measured');
  eq(Number(receipt.storeCensus.withContent || 0), 0,
    'the fixture did not reproduce a zero-content store');
  eq(receipt.contentVerified, false,
    'a store holding no content still claims contentVerified');

  /* the pull-level gate: history may not be called complete on that census. */
  ok(/var __scvStoreOk = !__scvRan \|\| __scvTargets === 0 \|\| \(__scvMeasured && __scvHeld > 0\);/.test(SI),
    'the pull verdict does not gate on the store census (scv-1.0.0)');
  ok(/var __scvRan = includeHistory \|\| \(p1CensusHistoryDeferred === true && historyReceipt\.skipped !== true\);/.test(SI),
    'a bob-1.0.0 phase-2 history read escapes the store-census bar');
  ok(/historyComplete = !includeHistory \|\| !!\(historyReceipt\.complete && historyReceipt\.exactIdentityVerified === true && __scvStoreOk\)/.test(SI),
    'historyComplete still trusts the walk counters alone');
  ok(/history-store-empty/.test(SI) && /history-store-unmeasured/.test(SI),
    'the store-census refusal has no named reason');
  ok(/storeVerdict: dsPick\(hr\.storeVerdict/.test(MC),
    'the copyable error report does not carry the store verdict');
}

async function main() {
  testShellAttachesFindDiag();
  await testEngineCensusesFindReasons();
  await testStopEndsEverything();
  testStopReleasesTheLease();
  await testVerdictIsAStoreCensus();
  await flush(5);
  console.log('PASS 1p-pull-stop-and-find-census: ' + checks + ' checks - the chart-open refusal keeps the extension\'s PHI-free findReason; STOP finishes only the in-flight ON chart/body, then ends chart, sweep and deferred work with an honest partial receipt and no latch; and completeness is gated on a measured store census');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-pull-stop-and-find-census did not finish')); process.exit(1); }, 60000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });

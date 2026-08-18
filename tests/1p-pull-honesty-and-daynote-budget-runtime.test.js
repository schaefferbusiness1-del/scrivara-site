/* CAUSAL CONTROL PIN (2026-08-17 batch 8): the control engine is the pre-fix commit 1e0151a4 (main before
   batch 7), NOT the moving origin/main - once the fix ships, origin/main carries it and a control against it
   would "prove nothing" and fail. */
'use strict';
/* =============================================================================
 * 1p pull honesty + the day-note budget
 *
 * SIX defects, all MEASURED on the owner's live /cloned (derived from these
 * exact 1p sources) on 2026-08-17, ext 3.0.62:
 *
 *  1  RESUME HIJACK. A pull of 2026-08-25 ended `nav-failed` and left a
 *     `pullResumeV1` record. A later Pull click in another tab whose selected
 *     day was 2026-08-17 produced _lastPullResult().target === '2026-08-25' -
 *     the 10 s countdown card had IMPOSED the stale record's day. Repeatedly,
 *     with nothing on screen to explain it.  (p1-resume-honesty-1.0.0)
 *  2  `no-athena-tab` treated as terminal WHILE THREE signed-in athena tabs
 *     were open; the lease-free presence verb answered presence-verified 5/5
 *     within 80 ms right afterwards.  (p1-athena-presence-1.0.0)
 *  3  `nav-failed: athena week strip shows no selected day` on a next-week
 *     date: 3 athena tabs, ONE with a rendered strip, TWO with an EMPTY
 *     .calendar-nav - and the extension leased an empty one. The doctor was
 *     told to do what he had already done.  (p1-onetab-nav-1.0.0)
 *  4  A second Pull click during the schedule phase painted "The pull did not
 *     return a verified completion receipt (pull-in-flight). Nothing is being
 *     reported as complete." over a healthy running pull.  (p1-busy-click-1.0.0)
 *  5  The "Full visit notes" checkbox rendered CHECKED while
 *     __mlsVisitNotesPref.read() said {state:'off', on:false}.
 *     (p1-visitpref-broadcast-1.0.0)
 *  6  The day-note leg: 10 of 24 rows `pulled-day-note-deadline-exceeded` on an
 *     occluded athena tab, NONE of them retried, the bar reading 100% while
 *     "saving the pulled day's note (7 of 23)" still ran.
 *     (dnb-1.0.0 / dnf2-1.0.0 / dnd2-1.0.0 / dnw-1.0.0 / dnp-1.0.0)
 *
 * Every runtime case boots the REAL 1p importer against the shared fake
 * extension bridge. Synthetic names/DOB/MRN only - no network, no extension,
 * no PHI. Defects 1 and 5 additionally run a CAUSAL CONTROL against the
 * origin/main copy of the same file, so "this test would fail before the fix"
 * is a measurement rather than a claim.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { makeHarness, makeMonthHarness, flush } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const MC = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ---------------------------------------------------------- causal control --
 * origin/main's copy of the two files, on disk, so the same fixtures can be
 * run against the engine that shipped the defect. If git cannot produce them
 * the control cases are SKIPPED LOUDLY rather than silently passing. */
const CONTROL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-pullfix-control-'));
let CONTROL_IMPORTER = '';
let CONTROL_CONNECT = '';
try {
  const impo = execFileSync('git', ['show', '1e0151a4864b696b2934ffcabf88a95e9716e593:1p-feat_mls_schedimport_exact.js'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  CONTROL_IMPORTER = path.join(CONTROL_DIR, 'control-importer.js');
  fs.writeFileSync(CONTROL_IMPORTER, impo);
  const conn = execFileSync('git', ['show', '1e0151a4864b696b2934ffcabf88a95e9716e593:1p-mls-connect.js'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  CONTROL_CONNECT = path.join(CONTROL_DIR, 'control-connect.js');
  fs.writeFileSync(CONTROL_CONNECT, conn);
} catch (eCtl) {
  CONTROL_IMPORTER = ''; CONTROL_CONNECT = '';
  console.log('NOTE: origin/main control unavailable (' + String((eCtl && eCtl.message) || eCtl).slice(0, 80) + ')');
}

/* ============================================================ 1  STATIC ==== */
{
  const blocks = [
    ['p1-athena-presence-1.0.0', '/* ===== p1-athena-presence-1.0.0', '/* ===== end p1-athena-presence-1.0.0 ===== */'],
    ['p1-onetab-nav-1.0.0', '/* ===== p1-onetab-nav-1.0.0', '/* ===== end p1-onetab-nav-1.0.0 ===== */']
  ];
  blocks.forEach(([name, a, b]) => {
    const i = SRC.indexOf(a), j = SRC.indexOf(b);
    ok(i >= 0 && j > i, 'the ' + name + ' block is missing or unclosed');
  });
  ok(/p1-resume-honesty-1\.0\.0/.test(SRC), 'the resume-honesty change is unmarked');
  ok(/p1-busy-click-1\.0\.0/.test(SRC) && /p1-busy-click-1\.0\.0/.test(MC),
    'the busy-click change must be marked on BOTH sides of the seam');
  /* THE REGRESSION THIS PINS: the countdown that started a pull by itself. */
  const offer = SRC.slice(SRC.indexOf('function resumeOffer(rec)'), SRC.indexOf('function maybeResumePull()'));
  eq((offer.match(/setInterval/g) || []).length, 0,
    'resumeOffer still arms a timer - a resume offer may never start itself');
  eq((offer.match(/resumeStart\(/g) || []).length, 1,
    'resumeOffer must reach resumeStart exactly once, from the Resume button');
  ok(/mlsPullResumeFresh/.test(offer), 'the offer has no "Start over" control');
  /* the shell transport eats backslashes: EXECUTE the new literals. */
  ok(/no athenaone tab open/i.test('No athenaOne tab open.'), 'sanity');
  const noTabRe = SRC.match(/return \/no athenaone tab open\/i\.test\(String\(r\.error \|\| ""\)\);/);
  ok(!!noTabRe, 'the no-athena-tab error sniffer lost its literal');
}

/* ===================================== 2  RESUME: the hijack, and its cure == */
const FOREIGN_DAY = '2026-08-25';
const SELECTED_DAY = '2026-08-17';

function seedResumeRecord(h, day, extra) {
  /* the harness clock, never the wall clock: the engine judges freshness with
     its OWN Date.now(), which the harness freezes at noon Eastern. */
  const rec = Object.assign({
    date: day, startedAt: h.clock.now(), attempts: 0, includeHistory: true, bodies: null,
    p1CensusEligible: true, providerScope: { v: 1, mode: 'all', source: 'day-caller' }
  }, extra || {});
  h.store.set('p1-harness::pullResumeV1', JSON.stringify(rec));
  return rec;
}

async function resumeCase(importerPath) {
  /* the exact live shape: the record is for 2026-08-25, the doctor is looking
     at 2026-08-17 (the harness's _calRefDate IS the selected day). */
  const h = makeHarness({ day: SELECTED_DAY, today: SELECTED_DAY, rows: 2, importerPath: importerPath || undefined });
  seedResumeRecord(h, FOREIGN_DAY);
  const postedBefore = 0;
  h.rt.__mlsSIPostCount = 0;
  const gotoBefore = [];
  const origPost = h.rt.postMessage;
  h.rt.postMessage = function (msg) { gotoBefore.push(msg && msg.type); return origPost.apply(this, arguments); };
  /* count only the timers THE OFFER arms - the module's own boot retries were
     already armed when the vm ran. */
  const intervalsBefore = h.intervals.length;
  h.api._maybeResumePull();
  const card = h.rt.document.getElementById('mlsPullResumeCard');
  const armed = h.intervals.slice(intervalsBefore).filter(iv => iv.live).length;
  /* fire whatever countdown was armed, ten times - the live card's ten seconds */
  h.fireIntervals(10);
  await flush(40);
  const durable = JSON.parse(h.store.get('p1-harness::pullResumeV1') || 'null');
  return {
    h, cardMounted: !!card, armedIntervals: armed,
    startedAPull: gotoBefore.some(t => t === 'mlsAppGotoDate' || t === 'mlsPing'),
    /* resumeStart re-writes the record with attempts+1 BEFORE it calls pull(),
       so this is a synchronous, unambiguous "the resume ran" marker. */
    resumeRan: !!(durable && Number(durable.attempts || 0) >= 1 && durable.date === FOREIGN_DAY),
    lastResult: h.api._lastPullResult(),
    postedBefore
  };
}

{
  const run = (async () => {
    const fixed = await resumeCase('');
    eq(fixed.cardMounted, false,
      'a resume record for ' + FOREIGN_DAY + ' was OFFERED while ' + SELECTED_DAY + ' is selected - this is the hijack');
    eq(fixed.h.api._resumeOfferState().reason, 'other-day',
      'the refusal to offer did not name the day mismatch');
    eq(fixed.startedAPull, false, 'a foreign-day resume reached the extension bridge');
    eq(fixed.resumeRan, false, 'a foreign-day resume ran and re-armed its own record');

    if (CONTROL_IMPORTER) {
      const control = await resumeCase(CONTROL_IMPORTER);
      eq(control.cardMounted, true,
        'CAUSAL CONTROL BROKEN: origin/main did not mount the foreign-day resume card, so this suite proves nothing');
      ok(control.armedIntervals >= 1,
        'CAUSAL CONTROL BROKEN: origin/main armed no countdown, so the hijack mechanism is not what this suite reproduces');
      eq(control.resumeRan, true,
        'CAUSAL CONTROL BROKEN: origin/main did not RUN the foreign-day resume off its countdown');
    }

    /* SAME day: the offer IS made, with both choices, and still starts nothing */
    const same = makeHarness({ day: SELECTED_DAY, today: SELECTED_DAY, rows: 2 });
    seedResumeRecord(same, SELECTED_DAY);
    const sameIntervalsBefore = same.intervals.length;
    same.api._maybeResumePull();
    const sameCard = same.rt.document.getElementById('mlsPullResumeCard');
    ok(!!sameCard, 'a record for the SELECTED day must still be offered');
    eq(same.api._resumeOfferState().offered, true, 'the same-day offer was not recorded');
    ok(!!same.rt.document.getElementById('mlsPullResumeGo'), 'the offer lost its Resume control');
    ok(!!same.rt.document.getElementById('mlsPullResumeFresh'), 'the offer lost its Start over control');
    eq(same.intervals.slice(sameIntervalsBefore).filter(iv => iv.live).length, 0,
      'the same-day offer armed a countdown - resume must be OFFERED, never imposed');
    const before = same.api._lastPullResult();
    same.fireIntervals(12);
    await flush(4);
    eq(same.api._lastPullResult(), before, 'firing every timer started a pull the doctor never chose');

    /* EXPIRY: a record older than the window is dropped, not offered */
    const old = makeHarness({ day: SELECTED_DAY, today: SELECTED_DAY, rows: 1 });
    seedResumeRecord(old, SELECTED_DAY, { startedAt: old.clock.now() - (7 * 60 * 60 * 1000) });
    old.api._maybeResumePull();
    eq(old.api._resumeOfferState().reason, 'expired', 'a 7 h old record was not expired');
    eq(old.store.get('p1-harness::pullResumeV1'), undefined, 'an expired record was left in storage');

    /* ANOTHER TAB's record is that tab's to resume */
    const foreignTab = makeHarness({ day: SELECTED_DAY, today: SELECTED_DAY, rows: 1 });
    seedResumeRecord(foreignTab, SELECTED_DAY, { tabId: 'some-other-tab' });
    foreignTab.api._maybeResumePull();
    eq(foreignTab.api._resumeOfferState().reason, 'foreign-tab',
      "another tab's interruption was adopted by this tab");
    eq(foreignTab.rt.document.getElementById('mlsPullResumeCard'), null,
      "another tab's record mounted an offer here");

    /* a record written by THIS tab carries this tab's id and is adoptable */
    const mine = makeHarness({ day: SELECTED_DAY, today: SELECTED_DAY, rows: 1 });
    seedResumeRecord(mine, SELECTED_DAY, { tabId: mine.api._resumeTabId() });
    mine.api._maybeResumePull();
    eq(mine.api._resumeOfferState().offered, true, "this tab's own record was refused");

    /* (a) even a DIRECT resumeStart of a foreign-day record refuses */
    const direct = makeHarness({ day: SELECTED_DAY, today: SELECTED_DAY, rows: 1 });
    seedResumeRecord(direct, SELECTED_DAY);
    direct.api._maybeResumePull();
    const goBtn = direct.rt.document.getElementById('mlsPullResumeGo');
    ok(goBtn && typeof goBtn.onclick === 'function', 'the offer button is not wired');
    direct.store.set('p1-harness::pullResumeV1', JSON.stringify(
      Object.assign(JSON.parse(direct.store.get('p1-harness::pullResumeV1')), { date: FOREIGN_DAY })));
    /* the CAPTURED record still says the selected day, the durable one moved:
       the pre-existing scope gate owns that case and must still refuse. */
    goBtn.onclick();
    await flush(4);
    const changed = direct.api._lastPullResult();
    ok(changed && changed.reason === 'resume-scope-changed',
      'a record whose day changed under the offer was resumed anyway (' + String(changed && changed.reason) + ')');
  })();
  module.exports = module.exports || {};
  global.__p1ResumeRun = run;
}

/* ==================================== 3  TERMINAL VERDICTS CLEAR THE RECORD = */
const MONTH_DAY = '2026-03-16';
function monthWorld(options) {
  const h = makeMonthHarness(Object.assign({ today: MONTH_DAY }, options || {}));
  h.seedDay(MONTH_DAY, 2);
  return h;
}
const resumeKeyOf = h => 'sf_u::' + h.account + '::pullResumeV1';

async function terminalClearRun() {
  /* nav-failed is terminal: the record must NOT survive it. This is the exact
     record that hijacked 2026-08-17. */
  const nav = monthWorld({ gotoResult: () => ({ ok: false, error: 'athena week strip shows no selected day instead of ' + MONTH_DAY, diag: { rounds: 3, initFound: false, tabPath: '/x' } }), athenaTabs: 3 });
  const navRes = await nav.api.pull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: nav.onStatus });
  eq(navRes.reason, 'nav-failed', 'the nav fixture did not produce nav-failed');
  eq(nav.store.has(resumeKeyOf(nav)), false,
    'a nav-failed pull kept its resume record - this is what came back to life on another day');
  ok(nav.api._resumeVerdictIsTerminal(navRes), 'nav-failed is not classified terminal');

  /* a COMPLETE pull clears it too (pre-existing behaviour, pinned) */
  const done = monthWorld({});
  const doneRes = await done.api.pull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: done.onStatus });
  eq(doneRes.complete, true, 'the clean fixture did not complete');
  eq(done.store.has(resumeKeyOf(done)), false, 'a complete pull kept its resume record');

  /* an honest PARTIAL still keeps it - pr-1.0.0 exists for exactly this */
  const partial = monthWorld({ scheduleResult: base => Object.assign({}, base, { receipt: Object.assign({}, base.receipt, { complete: false, parsedCount: 1 }) }) });
  const partialRes = await partial.api.pull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: partial.onStatus });
  eq(partialRes.complete, false, 'the partial fixture completed');
  eq(partial.api._resumeVerdictIsTerminal(partialRes), false,
    'schedule-incomplete was classified terminal - an honest partial must stay resumable');
  eq(partial.store.has(resumeKeyOf(partial)), true,
    'an honest partial lost its resume record - that is the pr-1.0.0 guarantee');
  return { navRes };
}

/* =============================== 4  A BUSY ATHENA IS NOT A MISSING ATHENA === */
async function busyAthenaRun() {
  /* the live shape: one leg answers no-athena-tab, the presence verb proves
     athena is there, the pull carries on. */
  let gotoCalls = 0;
  const busy = monthWorld({
    gotoResult: () => { gotoCalls++; return gotoCalls === 1 ? { ok: false, reason: 'no-athena-tab', error: 'No athenaOne tab open.' } : null; },
    presenceResult: () => ({ ok: true, athenaOpen: true, certain: true, reason: 'presence-verified' })
  });
  const res = await busy.api.pull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: busy.onStatus });
  eq(res.complete, true, 'a transient no-athena-tab ended the pull even though athena was proven present');
  ok(gotoCalls >= 2, 'the goto leg was never retried (calls=' + gotoCalls + ')');
  eq(busy.presenceCalls.length >= 1, true, 'the presence verb was never asked');
  ok(busy.statusLines.some(l => /Athena is busy rendering/.test(l)),
    'the doctor was never told why the pull paused: ' + JSON.stringify(busy.statusLines.slice(0, 6)));
  ok(busy.statusLines.some(l => /re-checking \(1 of 3\)/.test(l)), 'the retry is not counted for the doctor');

  /* presence really absent -> honest terminal, and NEVER an unbounded loop */
  let calls2 = 0;
  const gone = monthWorld({
    gotoResult: () => { calls2++; return { ok: false, reason: 'no-athena-tab', error: 'No athenaOne tab open.' }; },
    presenceResult: () => ({ ok: true, athenaOpen: false, certain: true, reason: 'no-athena-tab' })
  });
  const goneRes = await gone.api.pull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: gone.onStatus });
  eq(goneRes.ok, false, 'an absent athena produced a successful pull');
  eq(goneRes.reason, 'nav-failed', 'an absent athena did not end with the nav verdict');
  eq(Number(goneRes.athenaBusyRetries || 0), 0,
    'the engine retried a leg while presence said athena was genuinely absent');
  ok(calls2 <= 4, 'the goto leg looped ' + calls2 + ' times against an absent athena');

  /* the bound: presence-verified but the leg never recovers -> at most 3 */
  let calls3 = 0;
  const stuck = monthWorld({
    gotoResult: () => { calls3++; return { ok: false, reason: 'no-athena-tab', error: 'No athenaOne tab open.' }; },
    presenceResult: () => ({ ok: true, athenaOpen: true, certain: true, reason: 'presence-verified' })
  });
  const stuckRes = await stuck.api.pull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: stuck.onStatus });
  eq(stuckRes.ok, false, 'a permanently unreachable athena reported success');
  eq(Number(stuckRes.athenaBusyRetries || 0), 3, 'the busy budget is not exactly 3 retries');
  ok(calls3 <= 8, 'the settle ladder multiplied the busy retries (' + calls3 + ' goto calls)');
}

/* ==================================== 5  THE NAV REFUSAL SAYS WHAT IT SAW === */
async function navAdviceRun() {
  const strip = monthWorld({
    athenaTabs: 3,
    gotoResult: () => ({ ok: false, error: 'athena week strip shows no selected day instead of ' + MONTH_DAY, diag: { rounds: 3, initFound: false, tabPath: '/1/13/calendar' } })
  });
  const res = await strip.api.pull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: strip.onStatus });
  eq(res.reason, 'nav-failed', 'the empty-strip fixture did not fail navigation');
  ok(/isn't showing a week strip/.test(String(res.navAdvice || '')),
    'the nav refusal did not name the empty week strip: ' + JSON.stringify(res.navAdvice));
  ok(/Keep ONE signed-in Athena tab open/.test(String(res.navAdvice || '')),
    'the nav refusal did not give the one-tab instruction');
  ok(/3 Athena tabs are open/.test(String(res.navAdvice || '')),
    'the nav refusal did not report the measured tab count: ' + JSON.stringify(res.navAdvice));
  eq(Number(res.athenaTabsAtFailure), 3, 'the PHI-free tab count is missing from the receipt');
  eq(res.navEmptyStrip, true, 'the receipt does not record WHICH nav failure this was');
  ok(strip.statusLines.some(l => /Keep ONE signed-in Athena tab open/.test(l)),
    'the doctor never saw the one-tab advice on screen');

  /* a nav failure that is NOT an empty strip keeps the old honest wording */
  const other = monthWorld({ gotoResult: () => ({ ok: false, error: 'No athenaOne tab open.', sessionLikelyExpired: true }) });
  const otherRes = await other.api.pull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: other.onStatus });
  eq(otherRes.navAdvice, undefined, 'a missing-tab nav failure was given the one-tab strip advice');

  /* PREFLIGHT: the same advice up front, before a 60 s failure */
  const pre = makeMonthHarness({ today: MONTH_DAY, athenaTabs: 4, presenceResult: () => ({ ok: true, athenaOpen: false, certain: false, reason: 'athena-tab-unverified' }) });
  pre.seedDay(MONTH_DAY, 2);
  await pre.api.dayPull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: pre.onStatus });
  ok(pre.statusLines.some(l => /4 Athena tabs are open/.test(l)),
    'the multi-tab preflight said nothing: ' + JSON.stringify(pre.statusLines.slice(0, 5)));

  /* and it is SILENT on a healthy single tab */
  const quiet = makeMonthHarness({ today: MONTH_DAY, athenaTabs: 1 });
  quiet.seedDay(MONTH_DAY, 2);
  await quiet.api.dayPull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: quiet.onStatus });
  eq(quiet.statusLines.some(l => /Athena tabs are open|isn't showing a week strip/.test(l)), false,
    'the preflight nagged a healthy single-tab machine');
}

/* ======================== 6  A SECOND CLICK IS NOT A FAILED PULL ============ */
async function busyClickRun() {
  /* hold the schedule leg open, click again, and read what the second click
     did to the FIRST pull's evidence. */
  let release = null;
  const held = new Promise(r => { release = r; });
  let scheduleSeen = 0;
  const h = makeMonthHarness({
    today: MONTH_DAY,
    scheduleResult: base => { scheduleSeen++; return base; }
  });
  h.seedDay(MONTH_DAY, 2);
  /* freeze the goto so the first pull is provably mid-flight */
  let firstGoto = true;
  const post = h.rt.postMessage;
  h.rt.postMessage = function (msg) {
    if (msg && msg.type === 'mlsAppGotoDate' && firstGoto) { firstGoto = false; held.then(() => post.call(this, msg)); return; }
    return post.apply(this, arguments);
  };
  const first = h.api.pull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: h.onStatus });
  await flush(4);
  const beforeSecond = h.api._lastPullResult();
  const second = await h.api.dayPull({ date: MONTH_DAY, provider: 'all', includeHistory: false, onStatus: h.onStatus });
  eq(second.reason, 'pull-in-flight', 'the second click was not refused by the engine');
  eq(second.busyInFlight, true, 'the busy refusal is not marked as a refusal-to-start');
  ok(/already running/.test(String(second.error)), 'the busy refusal still speaks in receipt language: ' + second.error);
  ok(/watch the progress just below/.test(String(second.error)),
    'the busy refusal does not point at the running pull');
  eq(h.api._lastPullResult(), beforeSecond,
    'the busy stub REPLACED the running pull\'s receipt - this is the "no verified completion receipt" defect');
  release();
  const firstRes = await first;
  eq(firstRes.complete, true, 'the first pull did not survive the second click');
  ok(h.api._lastPullResult() === firstRes, 'the running pull never got to publish its own receipt');
  /* and the surface says the calm thing */
  ok(/'pull-in-flight': String\(\(r && r\.error\)/.test(MC),
    'mls-connect still falls through to the generic "did not return a verified completion receipt" text');
}

/* ============ 7  THE VISIT-NOTES CHECKBOX REFLECTS THE PULL'S PREFERENCE ==== */
function visitPrefCase(connectPath) {
  const src = fs.readFileSync(connectPath, 'utf8');
  const rs = src.indexOf('(function () {\n  if (window.__mlsVisitNotesPref) return;');
  const re = src.indexOf('  window.__mlsVisitNotesPref = api;\n})();');
  assert(rs >= 0 && re > rs, 'the __mlsVisitNotesPref resolver could not be located in ' + connectPath);
  const resolver = src.slice(rs, re + '  window.__mlsVisitNotesPref = api;\n})();'.length);
  const ps = src.indexOf("        var tgl = $('mlsDsVisitBodies'); if (!tgl) return;");
  const pe = src.indexOf('      })();', ps);
  assert(ps >= 0 && pe > ps, 'the day-strip checkbox block could not be located in ' + connectPath);
  const paintBlock = src.slice(ps, pe);

  const store = new Map();
  const intervals = [];
  const listeners = new Map();
  const tgl = { id: 'mlsDsVisitBodies', checked: false, onchange: null };
  const ctx = {
    console, Date, JSON, String, Number, Object, Boolean, Promise, Math, RegExp, Error,
    setInterval(fn) { intervals.push({ fn, live: true }); return intervals.length; },
    clearInterval(id) { if (intervals[id - 1]) intervals[id - 1].live = false; },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    localStorage: {
      getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)); },
      removeItem: k => { store.delete(String(k)); }
    },
    document: { getElementById: id => (id === 'mlsDsVisitBodies' ? tgl : null) },
    $: id => (id === 'mlsDsVisitBodies' ? tgl : null)
  };
  ctx.window = ctx;
  ctx.window.uns = suffix => 'sf_u::doc@example.invalid::' + suffix;   /* a REAL, settled namespace */
  ctx.addEventListener = (type, fn) => {
    const key = String(type);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
  };
  ctx.dispatchEvent = ev => {
    const set = listeners.get(String(ev && ev.type));
    if (set) Array.from(set).forEach(fn => { try { fn(ev); } catch (e) {} });
    return true;
  };
  vm.createContext(ctx);
  vm.runInContext(resolver, ctx, { filename: 'visit-notes-resolver' });
  vm.runInContext('(function(){' + paintBlock + '})();', ctx, { filename: 'day-strip-checkbox' });
  const atBuild = { checked: tgl.checked, read: ctx.window.__mlsVisitNotesPref.read() };
  /* the SAME-TAB write the Settings copy performs. No storage event fires. */
  ctx.window.__mlsVisitNotesPref.write(false);
  intervals.forEach(iv => { if (iv.live) { try { iv.fn(); } catch (e) {} } });
  return { atBuild, after: { checked: tgl.checked, read: ctx.window.__mlsVisitNotesPref.read() } };
}

{
  const fixed = visitPrefCase(path.join(ROOT, '1p-mls-connect.js'));
  eq(fixed.atBuild.checked, true, 'fixture drift: an unset preference must paint the box ON');
  eq(fixed.atBuild.read.state, 'unset', 'fixture drift: the resolver did not start unset');
  eq(fixed.after.read.on, false, 'the write did not land');
  eq(fixed.after.checked, false,
    'the visible checkbox still says ON while the pull would run OFF - the doctor cannot see what the pull will do');
  if (CONTROL_CONNECT) {
    const control = visitPrefCase(CONTROL_CONNECT);
    eq(control.after.read.on, false, 'CAUSAL CONTROL BROKEN: the control write did not land');
    eq(control.after.checked, true,
      'CAUSAL CONTROL BROKEN: origin/main already repainted the checkbox, so this suite proves nothing');
  }
}

/* ================================ 8  THE DAY-NOTE LEG (item 6) ============= */
const DN_DAY = '2026-08-14';   /* a PAST day: every row's note is genuinely due */

function dayNoteHarness(options) {
  return makeHarness(Object.assign({
    day: DN_DAY, today: '2026-08-17', rows: 3, scheduleBorn: false, chartCoverage: true
  }, options || {}));
}

async function dayNoteRun() {
  /* ---- the deferred round must actually take these rows -------------------- */
  const api = makeHarness({ day: DN_DAY, today: '2026-08-17', rows: 1 }).api;
  eq(typeof api._todayNoteDeferred, 'function', 'the deferred queue is not observable');

  /* dnd2-1.0.0: EXECUTE the predicate against the exact live strings. */
  const deferrable = [
    'pulled-day-note-deadline-exceeded',
    'The Athena patient open reached its own deadline',
    'pull-in-flight: another Athena read or schedule pull is active. Nothing started.',
    'athenaOne is still showing a different patient than this read expects'
  ];
  const notDeferrable = [
    'Safety stop — Athena returned an encounter index without verified full detail for every row. Nothing was saved as complete history.',
    'Athena exposed 18 encounters, which cannot all be verified inside this pull\'s bounded budget',
    'extension-predates-scoped-read',
    'Safety stop — at least one returned visit identifies a different patient. Nothing from this batch was saved.'
  ];
  /* the predicate lives inside the module closure; drive it through the real
     engine by running a batch whose day-note reads fail with each string. */
  for (const reason of deferrable) {
    const h = dayNoteHarness({
      noteResult: () => { const e = { ok: false, reason: reason }; return e; }
    });
    await h.api._runHistoryBatch(h.rows.slice(0, 1), [], h.onStatus, {});
    const q = h.api._todayNoteDeferred();
    ok(q.queued >= 1 || q.rows.length >= 1,
      'a retryable day-note refusal was NOT deferred: ' + reason.slice(0, 60));
  }
  for (const reason of notDeferrable) {
    const h = dayNoteHarness({ noteResult: () => ({ ok: false, reason: reason }) });
    await h.api._runHistoryBatch(h.rows.slice(0, 1), [], h.onStatus, {});
    const q = h.api._todayNoteDeferred();
    eq(q.queued, 0, 'a deterministic refusal was queued for a pointless retry: ' + reason.slice(0, 60));
  }

  /* ---- deadline on 3 rows -> deferred round recovers 2 -------------------- */
  let noteCall = 0;
  const recovering = makeHarness({
    day: DN_DAY, today: '2026-08-17', rows: 3, scheduleBorn: false, chartCoverage: true,
    noteResult: () => {
      noteCall++;
      if (noteCall <= 3) return { ok: false, reason: 'pulled-day-note-deadline-exceeded' };
      return noteCall <= 5 ? { ok: true, visits: 1 } : { ok: false, reason: 'pulled-day-note-deadline-exceeded' };
    }
  });
  const receipt = await recovering.api._runHistoryBatch(recovering.rows, [], recovering.onStatus, {});
  eq(Number(receipt.todayNoteFailures || 0), 3, 'the fixture did not start with 3 unread day notes');
  const queued = recovering.api._todayNoteDeferred();
  eq(queued.queued, 3, 'all three timing failures should be queued for the deferred round');
  /* every queued row reads RETRYING, not "could not be read" */
  const pp = recovering.ppState();
  const retryRows = (pp && pp.rows || []).filter(r => String(r.dn || '').indexOf('retrying:') === 0);
  ok(retryRows.length >= 1, 'a queued row still paints as a failure instead of "retrying"');
  /* run the round with athena free */
  recovering.setLeaseBusy(false);
  const summary = await recovering.api._runDeferredTodayNotes();
  eq(Number(summary && summary.attempted), 3, 'the deferred round did not attempt all three rows');
  eq(Number(summary && summary.recovered), 2, 'the deferred round did not recover the two readable rows');
  eq(Number(receipt.todayNoteFailures || 0), 1,
    'the receipt still counts recovered rows as failures - a fixed row must never keep showing the failure');
  eq(Number(receipt.todayNoteRecovered || 0), 2, 'the receipt does not count what the retry recovered');
  eq(Number(receipt.todayNoteDeferred.recovered), 2, 'the deferred receipt lost its recovered count');
  /* the panel renders LATEST-STATE-PER-CHART (ppt-2.0), so read it that way */
  const latestRows = state => {
    const latest = {};
    (state && state.rows || []).forEach(r => { latest[r.k || r.name] = r; });
    return Object.keys(latest).map(k => latest[k]);
  };
  const after = latestRows(recovering.ppState());
  const stillRetrying = after.filter(r => String(r.dn || '').indexOf('retrying:') === 0);
  eq(stillRetrying.length, 0, 'a row the retry finished is still painted "retrying"');
  const recovered = after.filter(r => String(r.dn || '') === 'read');
  eq(recovered.length, 2, 'the recovered rows were not re-stamped as read (' + recovered.length + ')');

  /* ---- dnb-1.0.0: the budget is measured, not assumed --------------------- */
  const slow = makeHarness({
    day: DN_DAY, today: '2026-08-17', rows: 3, scheduleBorn: false, chartCoverage: true,
    noteDelayMs: 30000
  });
  const slowReceipt = await slow.api._runHistoryBatch(slow.rows, [], slow.onStatus, {});
  ok(Number(slowReceipt.todayNoteMsMax || 0) >= 30000,
    'the per-row day-note cost is not measured (todayNoteMsMax=' + slowReceipt.todayNoteMsMax + ')');
  ok(Number(slowReceipt.todayNoteBudgetMs || 0) > 45000,
    'a machine that provably needs 30 s per note kept the flat 45 s budget (' + slowReceipt.todayNoteBudgetMs + ')');
  ok(Number(slowReceipt.todayNoteBudgetMs || 0) <= 150000, 'the day-note budget escaped its cap');

  /* ---- dnf2-1.0.0: the day-note read stays IN THE SAME VISIT -------------
     The owner's live pull: history 24/24 in ~4 min, then a SECOND pass that
     re-opened every remaining chart (find-patient + chart + encounter body) on
     an occluded tab and burned 15.7 min for 19 failures. The mechanism is the
     ONE-WAY fuse: the first timeout-class refusal disabled the inline lane for
     every later row.
     MEASURED HERE by ORDER, not by opinion: with the cooldown, only the row
     that actually failed lands after the last chart open; with a one-way fuse
     the whole tail does. */
  async function fuseCase(importerPath) {
    let dnCall = 0;
    const h = makeHarness({
      day: DN_DAY, today: '2026-08-17', rows: 6, scheduleBorn: false, chartCoverage: true,
      importerPath: importerPath || undefined,
      /* a THROWN deadline is what trips the fuse (the catch branch) */
      noteResult: () => { dnCall++; return dnCall === 1 ? { __throw: 'pulled-day-note-deadline-exceeded' } : { ok: true, visits: 1 }; }
    });
    const r = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});
    const lastChartSeq = h.chartCalls.length ? h.chartCalls[h.chartCalls.length - 1].seq : 0;
    return {
      receipt: r, chartOpens: h.chartCalls.length,
      notesAfterLastChart: h.noteCalls.filter(n => n.seq > lastChartSeq).length,
      noteCalls: h.noteCalls.length
    };
  }
  const fused = await fuseCase('');
  eq(fused.chartOpens, 6, 'the harness did not open one chart per patient');
  ok(Number(fused.receipt.todayNoteFuseCleared || 0) >= 1,
    'the inline fuse never re-armed after a verified chart read');
  eq(fused.notesAfterLastChart, 1,
    'day-note reads were pushed into a SECOND pass: ' + fused.notesAfterLastChart + ' of 6 ran after the last chart open');
  eq(Number(fused.receipt.todayNoteRead || 0), 5, 'the one-visit lane did not read the remaining notes');
  if (CONTROL_IMPORTER) {
    const control = await fuseCase(CONTROL_IMPORTER);
    eq(control.notesAfterLastChart, 5,
      'CAUSAL CONTROL BROKEN: origin/main did not push the remaining 5 rows into the second pass (got ' + control.notesAfterLastChart + ')');
  }

  /* ---- dnp-1.0.0: the phase the dialog can render ------------------------- */
  ok(/ppPhase\("day-notes"/.test(SRC), 'the day-note pass publishes no phase for the dialog');
  ok(/s\.phase = \{ kind: String\(kind\)/.test(SRC), 'the phase carries no counts');
  ok(/String\(S\.phase\.kind \|\| ''\) === 'day-notes'/.test(MC), 'the panel does not read the day-note phase');
  ok(/pct = 99/.test(MC), 'the bar can still claim 100% while the day-note pass runs');
  ok(/today’s note not read yet — retrying/.test(MC), 'the calm in-progress wording is missing');
  ok(/nothing was lost/.test(MC), 'the final wording does not tell the doctor nothing was lost');
}

/* ------------------------------------------------------------------ driver */
const watchdog = setTimeout(() => {
  console.error(new Error('1p-pull-honesty-and-daynote-budget did not finish'));
  process.exit(1);
}, 240000);

(async () => {
  await global.__p1ResumeRun;
  await terminalClearRun();
  await busyAthenaRun();
  await navAdviceRun();
  await busyClickRun();
  await dayNoteRun();
  clearTimeout(watchdog);
  try { fs.rmSync(CONTROL_DIR, { recursive: true, force: true }); } catch (eRm) {}
  console.log('PASS 1p-pull-honesty-and-daynote-budget: ' + checks + ' checks - a resume is offered for the SELECTED day only and never starts itself (causal control: origin/main mounts the foreign-day card and starts that pull), terminal verdicts clear the record while honest partials keep it, a no-athena-tab leg is re-checked against the lease-free presence verb and bounded at 3, the empty-week-strip refusal names the one-tab fix and the measured tab count, a second click can no longer overwrite the running pull\'s receipt, the "Full visit notes" checkbox follows a same-tab write (causal control: origin/main stays checked), and the day-note leg measures its own budget, keeps ONE chart open per patient, defers only retryable refusals, re-stamps every row the retry recovers, and stops claiming 100%');
})().catch(err => { clearTimeout(watchdog); console.error(err); process.exit(1); });

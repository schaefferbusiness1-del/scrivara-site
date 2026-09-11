'use strict';
/* =============================================================================
 * upcoming-autopull-runtime.test.js  -  upnext-1.0.0
 *
 * Owner 2026-09-11: "it always has to pull the to-be visits as to make good op
 * notes." An operative note is written from what came BEFORE, so the next
 * scheduled days' charts have to already be in MLS before anybody opens the
 * generator. This suite drives the REAL importer over the shared fake-extension
 * harness (no network, no extension, no Athena, synthetic identities only) and
 * measures the whole lane:
 *
 *   1. after boot, TODAY is read once, then TOMORROW is read once, and the walk
 *      stops at the first future day whose schedule is empty
 *   2. progress reaches the corner pill's ONE source
 *      (window.__mlsDayHistoryPull.state) and nothing else: no dialog is
 *      opened, and a clean walk says nothing at all
 *   3. a second walk inside the freshness window reads nothing
 *   4. new rows on an already-fresh day make that day due again
 *   5. recording / generating / the Send-to-athenaOne sheet / a running pull /
 *      a write in flight / another tab EACH defer the walk, by name
 *   6. the setting OFF stops the lane outright
 *   7. a day with rows that could not be read produces exactly ONE line
 *   8. the quiet call never arms the presence assist (nobody is watching)
 *
 * Run: node tests/upcoming-autopull-runtime.test.js   (bare exit code)
 * ========================================================================== */

const assert = require('assert');
const { makeMonthHarness } = require('./1p-pull-harness.js');

const TODAY = '2026-09-11';
const TOMORROW = '2026-09-12';
const DAY_AFTER = '2026-09-13';

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

/* ---------------------------------------------------------------------------
   A harness with the three seams this lane needs on top of the shared one:
   a real element map (the gate reads #captureBtn and #mlsAthenaUnifiedConfirm),
   a toast recorder (the quiet law is measured in toasts) and a dialog counter
   (an automatic pull may never open the full-visit-notes choice).
   ------------------------------------------------------------------------- */
function world(options) {
  options = options || {};
  const h = makeMonthHarness(Object.assign({ today: TODAY, visitNotesOn: false }, options));
  const elements = new Map();
  const toasts = [];
  let dialogOpens = 0;

  h.rt.document.getElementById = id => elements.get(String(id)) || null;
  h.rt.toast = (m, k) => { toasts.push({ text: String(m || ''), kind: String(k || '') }); };

  const pref = h.rt.__mlsVisitNotesPref;
  const realEnsure = pref.ensureChosenForBulkPull;
  pref.ensureChosenForBulkPull = function () { dialogOpens++; return realEnsure.apply(this, arguments); };

  /* the corner pill's ONE source, instrumented: every running transition is
     recorded, so "the pill showed this pull" is a measurement, not a claim. */
  const pill = { transitions: [], painted: [] };
  let running = false;
  const state = { __si: 1, total: 0, done: 0, ok: 0, failed: 0, current: '', rows: [] };
  Object.defineProperty(state, 'running', {
    enumerable: true, configurable: true,
    get() { return running; },
    set(v) {
      running = v;
      pill.transitions.push(v === true);
      /* ppStart clears rows for each new sub-batch, so what the pill actually
         had to paint is captured at the moment each run lets go */
      if (v !== true) pill.painted.push({ rows: state.rows.length, total: Number(state.total || 0) });
    }
  });
  h.rt.__mlsDayHistoryPull = { state };

  return {
    h,
    si: h.rt.__mlsSI,
    toasts,
    pill,
    state,
    dialogs: () => dialogOpens,
    el(id, node) { elements.set(String(id), node); return node; },
    clearEl(id) { elements.delete(String(id)); },
    key(suffix) { return 'sf_u::' + h.account + '::' + suffix; },
    /* how many charts this lane opened while athenaOne sat on each date */
    chartsPerDay() {
      const out = {};
      h.chartCalls.forEach(c => { out[c.day] = (out[c.day] || 0) + 1; });
      return out;
    }
  };
}

function recordingButton() {
  return { id: 'captureBtn', classList: { contains: c => String(c) === 'recording' } };
}

/* The harness unrefs every engine deadline on purpose, so a suite that got
   stuck waiting on a bridge reply would let the event loop empty and EXIT 0
   having proved nothing. Hold the loop open for the duration: a hang is then a
   visible hang, never a green run. */
const keepAlive = setInterval(function () {}, 1000);
let stage = 'start';

(async function main() {
  /* =========================================================================
     1-3. the walk itself: today, then tomorrow, then stop on the empty day
     ====================================================================== */
  {
    stage = '1-3 walk';
    const w = world();
    w.h.seedDay(TODAY, 3);
    w.h.seedDay(TOMORROW, 2);
    w.h.seedDay(DAY_AFTER, 0);

    const cfg = w.si._upcomingConfig();
    eq(cfg.version, 'upnext-1.0.0', 'the upcoming lane did not install');
    eq(cfg.freshMs, 6 * 60 * 60 * 1000, 'the freshness window is no longer six hours');
    eq(cfg.futureDays, 2, 'the lane no longer looks at today plus the next two days');

    const before = w.si._upcomingState();
    eq(before.on, true, 'the upcoming lane is not ON by default');
    eq(before.days.length, 3, 'the plan is not today plus the next two days');
    eq(before.days[0].day, TODAY, 'the plan does not start at the account day');
    eq(before.days[1].day, TOMORROW, 'the second planned day is not tomorrow');
    eq(before.days.filter(d => d.due).length, 3, 'a never-pulled day is not due');

    const run = await w.si._upcomingRunNow({});
    eq(run.ran, 3, 'the walk did not read today, tomorrow and the day it had to test');
    eq(run.reason, 'empty-day', 'the walk did not stop on the first empty future day');

    const charts = w.chartsPerDay();
    eq(charts[TODAY], 3, 'today was not read exactly once, in full');
    eq(charts[TOMORROW], 2, 'tomorrow was not read exactly once, in full');
    eq(charts[DAY_AFTER], undefined, 'an empty future day still opened charts');

    /* the pill, and ONLY the pill */
    ok(w.pill.transitions.filter(t => t === true).length >= 2,
      'the corner pill was never told this lane was running');
    eq(w.state.running, false, 'the lane left the corner pill running after it finished');
    ok(w.pill.painted.some(p => p.rows >= 3 && p.total >= 3),
      'the pill was never handed a whole day of rows to paint');
    eq(w.dialogs(), 0, 'an automatic pull opened the full-visit-notes choice dialog');
    eq(w.toasts.length, 0, 'a clean automatic walk was not silent');

    /* the receipt, and the second walk */
    const after = w.si._upcomingState();
    eq(after.days.filter(d => d.due).length, 0, 'a just-pulled day is still due');
    eq(after.days[0].rows, 3, 'the ledger did not record how many rows today had');
    eq(after.days[2].rows, 0, 'the ledger did not record the empty future day');
    eq(w.si._upcomingDayReady(TODAY).ready, true, 'today is not reported ready after its pull');
    eq(w.si._upcomingDayReady(TOMORROW).ready, true, 'tomorrow is not reported ready after its pull');

    const gotoBefore = w.h.gotoDates.length;
    const chartsBefore = w.h.chartCalls.length;
    const second = await w.si._upcomingRunNow({});
    eq(second.ran, 0, 'a second walk inside the freshness window read a day again');
    eq(w.h.gotoDates.length, gotoBefore, 'a second walk inside the freshness window navigated athenaOne');
    eq(w.h.chartCalls.length, chartsBefore, 'a second walk inside the freshness window opened a chart');

    /* 4. new rows on an already-fresh day put it back in the queue */
    const led = JSON.parse(w.h.store.get(w.key('mlsUpcomingPullV1')));
    led[TOMORROW + '|all'].rows = 0;
    w.h.store.set(w.key('mlsUpcomingPullV1'), JSON.stringify(led));
    const reDue = w.si._upcomingState().days.find(d => d.day === TOMORROW);
    eq(reDue.due, true, 'new rows on a fresh day do not make it due again');
    eq(reDue.why, 'new-rows', 'a day due for new rows names some other cause');
  }

  /* =========================================================================
     5. every busy stamp defers the walk, by name - and never reads Athena
     ====================================================================== */
  {
    stage = '5 busy stamps';
    const cases = [
      ['recording', w => w.el('captureBtn', recordingButton())],
      ['athena-review-open', w => w.el('mlsAthenaUnifiedConfirm', { id: 'mlsAthenaUnifiedConfirm' })],
      ['note-generating', w => w.el('ez3GenBusy', { id: 'ez3GenBusy' })],
      ['opnote-drafting', w => { w.h.rt.__mlsTplPrepFix = { isDrafting: () => true }; }],
      ['history-pull-running', w => { w.h.rt.__mlsDayHistoryPull.state.running = true; }],
      ['day-switch-busy', w => { w.h.rt.__mlsDaySwitch = { isBusy: () => true, rowsFor: () => [] }; }],
      ['visits-backfill-running', w => { w.h.rt.__mlsVisitsBackfill = { state: { running: true } }; }],
      ['pull-running-other-tab', w => { w.h.store.set(w.key('mlsPullBusyXTabV1'), String(w.h.now())); }],
      ['pull-busy-stamp', w => { w.h.rt.__mlsPullBusyAt = w.h.now(); }],
      ['athena-write-running', w => { w.h.rt.__mlsWriteFlow = { state: { athenaBusy: true } }; }],
      ['pull-running', w => { w.h.rt.__mlsP1AthenaReadLease = { busy: () => true }; }],
      ['visit-notes-unchosen', w => {
        w.h.rt.__mlsVisitNotesPref = { read: () => ({ state: '', on: false, settled: false }),
          ensureChosenForBulkPull: () => Promise.resolve({ ok: false }), write: () => true, isPrefKey: () => false };
      }]
    ];

    for (const [reason, arm] of cases) {
      const w = world();
      w.h.seedDay(TODAY, 3);
      w.h.seedDay(TOMORROW, 2);
      arm(w);
      eq(w.si._quietDriveGate().reason, reason, 'the quiet gate does not name the ' + reason + ' refusal');
      eq(w.si._quietDriveGate().open, false, 'the quiet gate stayed open under ' + reason);
      const run = await w.si._upcomingRunNow({});
      eq(run.ran, 0, 'the lane pulled a day while ' + reason);
      eq(run.reason, reason, 'the lane refused for some reason other than ' + reason);
      eq(w.h.gotoDates.length, 0, 'the lane navigated athenaOne while ' + reason);
      eq(w.h.chartCalls.length, 0, 'the lane opened a chart while ' + reason);
    }
  }

  /* =========================================================================
     5b. a stamp raised MID-WALK stops the walk before the next day
     ====================================================================== */
  {
    stage = '5b mid-walk stop';
    const w = world();
    w.h.seedDay(TODAY, 2);
    w.h.seedDay(TOMORROW, 2);
    const realGoto = w.h.rt.postMessage;
    let armed = false;
    w.h.rt.postMessage = msg => {
      /* the doctor presses Record while today is still being read */
      if (!armed && msg && msg.type === 'mlsAppGotoDate' && String(msg.date) === TODAY) {
        armed = true;
        w.el('captureBtn', recordingButton());
      }
      return realGoto(msg);
    };
    const run = await w.si._upcomingRunNow({});
    eq(run.ran, 1, 'the walk did not finish the day it had already started');
    eq(run.reason, 'recording', 'a recording started mid-walk did not stop the next day');
    eq(w.chartsPerDay()[TOMORROW], undefined, 'the walk read tomorrow after the doctor started recording');
  }

  /* =========================================================================
     5c. Stop stops THIS walk - and only this walk. A Stop pressed hours ago
         leaves __mlsPullStopRequested standing true until the next pull clears
         it; the lane must not read that as "retired for the session" (the
         class that left the day-note catch-up stopped through every later
         pull).
     ====================================================================== */
  {
    stage = '5c stop scope';
    const stale = world();
    stale.h.seedDay(TODAY, 2);
    stale.h.seedDay(TOMORROW, 2);
    stale.h.rt.__mlsPullStopRequested = true;      /* pressed long before this walk */
    const staleRun = await stale.si._upcomingRunNow({});
    ok(staleRun.ran >= 2, 'a Stop pressed before the walk retired the lane for the whole session');
    eq(stale.chartsPerDay()[TOMORROW], 2, 'a stale Stop flag kept tomorrow out of the walk');

    const live = world();
    live.h.seedDay(TODAY, 2);
    live.h.seedDay(TOMORROW, 2);
    const passthrough = live.h.rt.postMessage;
    let todayGotos = 0;
    live.h.rt.postMessage = msg => {
      if (msg && msg.type === 'mlsAppGotoDate' && String(msg.date) === TODAY) {
        todayGotos++;
        /* the second navigation to today IS today's own pull (the first is its
           warm-up), so the flag is set after __dayPullInner cleared it - which
           is exactly what a Stop pressed mid-pull looks like */
        if (todayGotos === 2) live.h.rt.__mlsPullStopRequested = true;
      }
      return passthrough(msg);
    };
    const liveRun = await live.si._upcomingRunNow({});
    eq(liveRun.ran, 1, 'a Stop pressed during the walk did not stop it after the day in flight');
    eq(liveRun.reason, 'stopped-by-user', 'a Stop pressed during the walk was not named as the cause');
    eq(live.chartsPerDay()[TOMORROW], undefined, 'the walk read tomorrow after the doctor pressed Stop');
    eq(live.toasts.length, 0,
      'a Stop the doctor pressed came back as a "could not be read" line - their own decision, reported as news');
  }

  /* =========================================================================
     6. the setting OFF stops the lane, and stops it without asking Athena
     ====================================================================== */
  {
    stage = '6 setting off';
    const w = world();
    w.h.seedDay(TODAY, 3);
    w.h.seedDay(TOMORROW, 2);
    w.h.store.set(w.key('upcomingAutoPull'), '0');
    eq(w.si._upcomingSettingOn(), false, 'an explicit 0 did not turn the lane off');
    eq(w.si._upcomingState().on, false, 'the receipt does not report the lane off');
    const run = await w.si._upcomingRunNow({});
    eq(run.ran, 0, 'the lane ran with the setting off');
    eq(run.reason, 'setting-off', 'the lane refused for some reason other than the setting');
    eq(w.h.gotoDates.length, 0, 'the lane navigated athenaOne with the setting off');
    eq(w.si._upcomingTick(), false, 'the timer tick still ran with the setting off');
    /* and the default, with nothing stored at all, is ON */
    w.h.store.delete(w.key('upcomingAutoPull'));
    eq(w.si._upcomingSettingOn(), true, 'the lane is not ON for an account that never opened Settings');
  }

  /* =========================================================================
     7. rows that could not be read produce exactly ONE line, once
     ====================================================================== */
  {
    stage = '7 attention line';
    const w = world();
    const rows = w.h.seedDay(TODAY, 3);
    w.h.seedDay(TOMORROW, 2);
    w.h.chartFail.add(TODAY + '|' + rows[0].patient_external_id);
    const run = await w.si._upcomingRunNow({});
    ok(run.ran >= 1, 'the walk never reached the day with an unreadable chart');
    eq(w.toasts.length, 1, 'a day with unreadable rows said something other than one line');
    ok(/could not be read/.test(w.toasts[0].text),
      'the one line does not say, in plain words, that a chart could not be read');
    ok(!/\bpull\b.*\bfail/i.test(w.toasts[0].text) && !/receipt|gate|lease|batch/i.test(w.toasts[0].text),
      'the doctor-visible line carries developer words');
    eq(w.dialogs(), 0, 'a walk with a failed row opened a dialog');
  }

  /* =========================================================================
     8. the quiet call is quiet: no presence assist, no strip writes
     ====================================================================== */
  {
    stage = '8 quiet';
    const w = world();
    w.h.seedDay(TODAY, 2);
    w.h.seedDay(TOMORROW, 0);
    await w.si._upcomingRunNow({});
    eq(w.h.statusLines.length, 0, 'the quiet lane wrote to the visible day-strip status');
    const quietReceipt = (w.si._lastPullResult() || {}).historyReceipt || {};
    eq(quietReceipt.presenceRequested, false,
      'the quiet lane armed the presence assist - it chases the OS focus of a doctor who is not watching');
    eq(quietReceipt.presenceAssisted, false, 'the quiet lane took a fronted read');

    /* POSITIVE CONTROL: the SAME day, pulled the way the visible button pulls
       it, still arms the assist. Without this the assertion above would pass
       just as well if the assist had been deleted for everybody. */
    const loud = world();
    loud.h.seedDay(TODAY, 2);
    await loud.si.dayPull({ date: TODAY, includeHistory: true, pullVisitBodies: false, onStatus: () => {} });
    const loudReceipt = (loud.si._lastPullResult() || {}).historyReceipt || {};
    eq(loudReceipt.presenceRequested, true,
      'a doctor-initiated day pull lost its presence assist - the quiet flag leaked onto the visible lane');
  }

  /* =========================================================================
     9. boot wires the lane without reading anything
     ====================================================================== */
  {
    stage = '9 boot';
    const w = world();
    w.h.seedDay(TODAY, 2);
    eq(w.si._upcomingState().wired, false, 'the lane was already wired before boot');
    eq(w.si._upcomingBoot(), true, 'boot did not wire the upcoming lane');
    eq(w.si._upcomingBoot(), false, 'boot wired the upcoming lane twice');
    const st = w.si._upcomingState();
    eq(st.wired, true, 'the receipt does not report the lane wired');
    eq(w.h.gotoDates.length, 0, 'wiring the lane read Athena');
    eq(w.h.chartCalls.length, 0, 'wiring the lane opened a chart');
    /* a settled pull arms the follow-up check rather than running inside it */
    eq(w.si._upcomingScheduleAfterPull(), true, 'a settled pull did not arm the upcoming re-check');
    eq(w.si._upcomingScheduleAfterPull(), false, 'a settled pull armed the re-check twice');
    eq(w.h.gotoDates.length, 0, 'arming the re-check read Athena');
    /* a generation in flight closes the gate, and its settlement reopens it */
    w.h.dispatch('mls:generation-started', {});
    eq(w.si._quietDriveGate().reason, 'note-generating', 'a generation in flight did not close the quiet gate');
    w.h.dispatch('mls:generation-settled', {});
    eq(w.si._quietDriveGate().open, true, 'a settled generation left the quiet gate closed');
  }

  /* =========================================================================
     10. the two quiet gates cannot drift: every shared stamp closes BOTH the
         idle catch-up gate and the upcoming-days gate.
     ====================================================================== */
  {
    stage = '10 gate parity';
    const shared = [
      ['recording', w => w.el('captureBtn', recordingButton())],
      ['athena-review-open', w => w.el('mlsAthenaUnifiedConfirm', { id: 'x' })],
      ['opnote-drafting', w => { w.h.rt.__mlsTplPrepFix = { isDrafting: () => true }; }],
      ['history-pull-running', w => { w.h.rt.__mlsDayHistoryPull.state.running = true; }],
      ['day-switch-busy', w => { w.h.rt.__mlsDaySwitch = { isBusy: () => true, rowsFor: () => [] }; }],
      ['visits-backfill-running', w => { w.h.rt.__mlsVisitsBackfill = { state: { running: true } }; }],
      ['pull-running-other-tab', w => { w.h.store.set(w.key('mlsPullBusyXTabV1'), String(w.h.now())); }],
      ['pull-running', w => { w.h.rt.__mlsP1AthenaReadLease = { busy: () => true }; }]
    ];
    for (const [reason, arm] of shared) {
      const w = world();
      arm(w);
      eq(w.si._quietDriveGate().reason, reason, 'the upcoming gate lost the ' + reason + ' row');
      /* the idle catch-up asks with force=true, which waives only its own idle
         threshold and backoff - never these rows */
      const ni = w.si._notesIdleGate(true);
      ok(ni.open === false, 'the idle catch-up gate opened under ' + reason + ' - the two gates have drifted');
    }
  }

  clearInterval(keepAlive);
  console.log('upcoming-autopull-runtime: ' + checks + ' checks passed');
})().catch(err => { clearInterval(keepAlive); console.error('FAILED at stage: ' + stage); console.error(err && err.stack || err); process.exit(1); });

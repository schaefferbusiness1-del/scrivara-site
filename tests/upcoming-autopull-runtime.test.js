'use strict';
/* =============================================================================
 * upcoming-autopull-runtime.test.js  -  upnext-1.1.0
 *
 * Owner 2026-09-11: "it always has to pull the to-be visits as to make good op
 * notes." An operative note is written from what came BEFORE, so the next
 * scheduled days' charts have to already be in MLS before anybody opens the
 * generator. This suite drives the REAL importer over the shared fake-extension
 * harness (no network, no extension, no Athena, synthetic identities only) and
 * measures the whole lane:
 *
 *   1. after boot, TODAY is read only with an exact date-bound census and empty
 *      calendar days are skipped until the next two scheduled days are warm
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
const { makeMonthHarness, flush } = require('./1p-pull-harness.js');

const TODAY = '2026-09-11';
const TOMORROW = '2026-09-12';
const DAY_AFTER = '2026-09-13';
const MONDAY = '2026-09-14';
const TUESDAY = '2026-09-15';

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

  /* Automatic Today may not trust the reusable calendar row cache. Model the
     production appointment-only census from the harness's explicitly seeded
     day; a missing seed is deliberately unverified. */
  h.rt.__mlsSI.appointmentCensusStatusForDay = function (day) {
    day = String(day || '');
    const rows = h.rowDays.get(day);
    if (day === TODAY && options.todayCensus === false) {
      return { available: false, exactAppointments: false, date: day, sourceCount: 0, reason: 'no-snapshot' };
    }
    if (!h.rowDays.has(day)) {
      return { available: false, exactAppointments: false, date: day, sourceCount: 0, reason: 'no-snapshot' };
    }
    return { available: true, exactAppointments: true, date: day, sourceCount: rows.length, reason: 'exact-appointment-census' };
  };

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

function unscopedBodyReads(w) {
  return w.h.posted.filter(m => m && m.type === 'mlsAppReadAllVisits' &&
    !String(m.hint && m.hint.onlyDate || '')).length;
}

function recordingButton() {
  return { id: 'captureBtn', classList: { contains: c => String(c) === 'recording' } };
}

/* Capture only this lane's four documented delays. The engine has many other
   bounded safety deadlines; those keep using the shared harness's host timer
   so this proof measures the scheduler without rewriting unrelated runtime. */
function captureUpcomingTimers(w) {
  const cfg = w.si._upcomingConfig();
  const delays = new Set([cfg.tickMs, cfg.bootDelayMs, cfg.wakeDelayMs, cfg.afterPullMs]);
  const realSetTimeout = w.h.rt.setTimeout;
  const realClearTimeout = w.h.rt.clearTimeout;
  const realSetInterval = w.h.rt.setInterval;
  const realClearInterval = w.h.rt.clearInterval;
  const all = [];
  const documentListeners = new Map();
  let seq = 0;
  let intervalCalls = 0;

  w.h.rt.setTimeout = function (fn, ms) {
    const delay = Number(ms) || 0;
    if (!delays.has(delay)) return realSetTimeout(fn, ms);
    const id = { upcomingTimer: ++seq };
    all.push({ id, fn, ms: delay, canceled: false, fired: false });
    return id;
  };
  w.h.rt.clearTimeout = function (id) {
    const timer = all.find(one => one.id === id);
    if (timer) { timer.canceled = true; return; }
    return realClearTimeout(id);
  };
  w.h.rt.setInterval = function () { intervalCalls++; return realSetInterval.apply(this, arguments); };
  w.h.rt.clearInterval = function () { return realClearInterval.apply(this, arguments); };
  w.h.rt.document.addEventListener = function (type, fn) {
    const key = String(type);
    if (!documentListeners.has(key)) documentListeners.set(key, new Set());
    documentListeners.get(key).add(fn);
  };
  w.h.rt.document.removeEventListener = function (type, fn) {
    const set = documentListeners.get(String(type));
    if (set) set.delete(fn);
  };

  return {
    active() { return all.filter(one => !one.canceled && !one.fired); },
    all,
    intervalCalls: () => intervalCalls,
    fire(timer) {
      if (!timer || timer.canceled || timer.fired) return false;
      timer.fired = true;
      timer.fn();
      return true;
    },
    dispatchDocument(type) {
      Array.from(documentListeners.get(String(type)) || []).forEach(fn => fn({ type: String(type) }));
    }
  };
}

/* The harness unrefs every engine deadline on purpose, so a suite that got
   stuck waiting on a bridge reply would let the event loop empty and EXIT 0
   having proved nothing. Hold the loop open for the duration: a hang is then a
   visible hang, never a green run. */
const keepAlive = setInterval(function () {}, 1000);
let stage = 'start';

(async function main() {
  /* =========================================================================
     1-3. the walk itself: today, skip an empty weekend, then two scheduled days
     ====================================================================== */
  {
    stage = '1-3 walk';
    const w = world();
    w.h.seedDay(TODAY, 3);
    w.h.seedDay(TOMORROW, 0);
    w.h.seedDay(DAY_AFTER, 0);
    w.h.seedDay(MONDAY, 2);
    w.h.seedDay(TUESDAY, 1);

    const cfg = w.si._upcomingConfig();
    eq(cfg.version, 'upnext-1.1.0', 'the upcoming lane did not install');
    eq(cfg.freshMs, 6 * 60 * 60 * 1000, 'the freshness window is no longer six hours');
    eq(cfg.futureDays, 2, 'the lane no longer warms the next two scheduled days');
    eq(cfg.scanDays, 14, 'the scheduled-day search lost its bounded two-week horizon');

    const before = w.si._upcomingState();
    eq(before.on, true, 'the upcoming lane is not ON by default');
    eq(before.days.length, 15, 'the bounded plan is not today plus fourteen calendar days');
    eq(before.days[0].day, TODAY, 'the plan does not start at the account day');
    eq(before.days[1].day, TOMORROW, 'the second planned day is not tomorrow');
    eq(before.days.filter(d => d.due).length, 15, 'a never-pulled day is not due');

    const run = await w.si._upcomingRunNow({});
    eq(run.ran, 5, 'the walk did not read today, skip the weekend, and reach two scheduled days');
    eq(run.reason, 'complete', 'the walk did not stop after warming two scheduled future days');

    const charts = w.chartsPerDay();
    eq(charts[TODAY], 3, 'today was not read exactly once, in full');
    eq(charts[TOMORROW], undefined, 'an empty Saturday opened a chart');
    eq(charts[DAY_AFTER], undefined, 'an empty Sunday opened a chart');
    eq(charts[MONDAY], 2, 'Monday was hidden behind the empty weekend');
    eq(charts[TUESDAY], 1, 'the second scheduled future day was not warmed');

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
    eq(after.days.slice(0, 5).filter(d => d.due).length, 0, 'a just-checked day is still due');
    eq(after.days[0].rows, 3, 'the ledger did not record how many rows today had');
    eq(after.days[1].rows, 0, 'the ledger did not record the empty Saturday');
    eq(after.days[2].rows, 0, 'the ledger did not record the empty Sunday');
    eq(w.si._upcomingDayReady(TODAY).ready, true, 'today is not reported ready after its pull');
    eq(w.si._upcomingDayReady(MONDAY).ready, true, 'Monday is not reported ready after its pull');
    eq(w.si._upcomingDayReady(TUESDAY).ready, true, 'Tuesday is not reported ready after its pull');
    eq(w.si._upcomingDayReady(TOMORROW).ready, false, 'an empty future day claims charts are ready');

    const gotoBefore = w.h.gotoDates.length;
    const chartsBefore = w.h.chartCalls.length;
    const second = await w.si._upcomingRunNow({});
    eq(second.ran, 0, 'a second walk inside the freshness window read a day again');
    eq(w.h.gotoDates.length, gotoBefore, 'a second walk inside the freshness window navigated athenaOne');
    eq(w.h.chartCalls.length, chartsBefore, 'a second walk inside the freshness window opened a chart');

    /* 4. new rows on an already-fresh day put it back in the queue */
    const led = JSON.parse(w.h.store.get(w.key('mlsUpcomingPullV1')));
    led[MONDAY + '|all'].rows = 0;
    w.h.store.set(w.key('mlsUpcomingPullV1'), JSON.stringify(led));
    const reDue = w.si._upcomingState().days.find(d => d.day === MONDAY);
    eq(reDue.due, true, 'new rows on a fresh day do not make it due again');
    eq(reDue.why, 'new-rows', 'a day due for new rows names some other cause');
    eq(w.si._upcomingDayReady(MONDAY).ready, false,
      'the strip still claims ready after the engine detected a new appointment');
  }

  /* Today is skipped unless its appointment-only receipt proves this exact
     date. The walk still advances to untouched future clinic days. */
  {
    stage = '3b today census ownership';
    const unknown = world({ todayCensus: false });
    unknown.h.seedDay(TODAY, 3);
    unknown.h.seedDay(TOMORROW, 1);
    unknown.h.seedDay(DAY_AFTER, 1);
    const unknownRun = await unknown.si._upcomingRunNow({});
    eq(unknownRun.days[0].reason, 'schedule-unverified', 'an unverified Today was not named and skipped');
    eq(unknown.chartsPerDay()[TODAY], undefined, 'an unverified Today opened charts from a reusable row cache');
    eq(unknown.chartsPerDay()[TOMORROW], 1, 'an unverified Today prevented the next untouched day from being warmed');

    const empty = world();
    empty.h.seedDay(TODAY, 0);
    empty.h.seedDay(TOMORROW, 1);
    empty.h.seedDay(DAY_AFTER, 1);
    const emptyRun = await empty.si._upcomingRunNow({});
    eq(emptyRun.days[0].reason, 'verified-empty', 'an exact zero Today was not reported as verified empty');
    eq(empty.chartsPerDay()[TODAY], undefined, 'a verified-empty Today still opened a chart');
    eq(empty.chartsPerDay()[TOMORROW], 1, 'a verified-empty Today prevented the next untouched day from being warmed');
  }

  /* =========================================================================
     4b. a day-facts cache cannot satisfy a later Full visit notes ON request
     ====================================================================== */
  {
    stage = '4b read mode change';
    const w = world({ visitNotesOn: false });
    w.h.seedDay(TODAY, 1);
    w.h.seedDay(TOMORROW, 1);
    w.h.seedDay(DAY_AFTER, 1);
    const first = await w.si._upcomingRunNow({});
    eq(first.ran, 3, 'the OFF control did not warm its three scheduled days');
    eq(unscopedBodyReads(w), 0, 'the OFF control made a full-history body read');
    let led = JSON.parse(w.h.store.get(w.key('mlsUpcomingPullV1')));
    eq(led[TODAY + '|all'].readMode, 'day-facts', 'the warm ledger lost the frozen OFF read mode');

    w.h.rt.__mlsVisitNotesPref.read = () => ({ state: 'on', on: true, settled: true });
    w.h.rt.__mlsVisitNotesPref.ensureChosenForBulkPull = () =>
      Promise.resolve({ ok: true, on: true, reason: 'synthetic-on' });
    const due = w.si._upcomingState().days.find(d => d.day === TODAY);
    eq(due.due, true, 'turning Full visit notes ON left the OFF-warmed day fresh');
    eq(due.why, 'read-mode-changed', 'the OFF-to-ON refresh names some other cause');
    eq(w.si._upcomingDayReady(TODAY).ready, false,
      'the strip claims an OFF-warmed day is ready after Full visit notes turns ON');

    const second = await w.si._upcomingRunNow({});
    eq(second.ran, 3, 'the ON walk reused the incompatible OFF cache');
    ok(unscopedBodyReads(w) > 0, 'the ON refresh made no full-history body reads');
    led = JSON.parse(w.h.store.get(w.key('mlsUpcomingPullV1')));
    eq(led[TODAY + '|all'].readMode, 'full', 'the refreshed ledger does not record full mode');
    eq(w.si._upcomingDayReady(TODAY).ready, false,
      'the harness full reader returned partial, but the refreshed day still claims ready');
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
     11. one cancellable wake at a time: no permanent poll, no hidden/off leak
     ====================================================================== */
  {
    stage = '11 timer lifecycle';
    const w = world();
    const timers = captureUpcomingTimers(w);
    const cfg = w.si._upcomingConfig();
    w.el('captureBtn', recordingButton()); /* the fired synthetic wake must fail closed */

    eq(w.si._upcomingBoot(), true, 'the timer proof could not boot the lane');
    eq(timers.intervalCalls(), 0, 'boot created a permanent interval instead of one cancellable wake');
    eq(timers.active().length, 1, 'boot did not create exactly one pending wake');
    eq(timers.active()[0].ms, cfg.bootDelayMs, 'the first wake did not preserve the sign-in settling delay');
    eq(w.h.gotoDates.length, 0, 'arming the boot wake synchronously navigated Athena');

    const bootWake = timers.active()[0];
    ok(timers.fire(bootWake), 'the boot wake could not be fired by the proof');
    await flush();
    eq(w.h.gotoDates.length, 0, 'a scheduler wake ignored the recording gate');
    eq(timers.active().length, 1, 'a settled wake did not leave exactly one successor');
    eq(timers.active()[0].ms, cfg.tickMs, 'the settled wake did not return to the low-frequency cadence');

    w.h.store.set(w.key('upcomingAutoPull'), '0');
    w.h.dispatch('mls:upcoming-setting-changed', { on: false });
    eq(timers.active().length, 0, 'turning the setting off left a wake armed');
    eq(w.si._upcomingState().armed, false, 'the receipt still calls the disabled lane armed');
    w.h.dispatch('mls:upcoming-setting-changed', { on: false });
    eq(timers.active().length, 0, 'a repeated OFF event recreated a wake');
    w.h.dispatch('mls:upcoming-setting-changed', { on: true });
    eq(timers.active().length, 0, 'event detail overrode the authoritative stored OFF value');

    w.h.store.set(w.key('upcomingAutoPull'), '1');
    const gotoBeforeOn = w.h.gotoDates.length;
    w.h.dispatch('mls:upcoming-setting-changed', { on: false });
    eq(w.h.gotoDates.length, gotoBeforeOn, 'turning the setting on synchronously drove Athena');
    eq(timers.active().length, 1, 'turning the setting on did not queue one guarded wake');
    eq(w.si._upcomingState().on, true, 'event detail overrode the authoritative stored ON value');
    eq(timers.active()[0].ms, cfg.wakeDelayMs, 'the setting wake did not leave the checkbox event stack');
    w.h.dispatch('mls:upcoming-setting-changed', { on: true });
    eq(timers.active().length, 1, 'repeating the ON event created duplicate wakes');

    w.h.rt.document.hidden = true;
    w.h.rt.document.visibilityState = 'hidden';
    timers.dispatchDocument('visibilitychange');
    eq(timers.active().length, 0, 'hiding the tab left its upcoming wake armed');
    w.h.rt.document.hidden = false;
    w.h.rt.document.visibilityState = 'visible';
    timers.dispatchDocument('visibilitychange');
    timers.dispatchDocument('visibilitychange');
    eq(timers.active().length, 1, 'returning visible created anything other than one catch-up wake');
    eq(timers.active()[0].ms, cfg.wakeDelayMs, 'the visible return waited a full polling interval');

    eq(w.si._upcomingScheduleAfterPull(), true, 'the post-pull follow-up was not armed');
    eq(w.si._upcomingScheduleAfterPull(), false, 'the post-pull follow-up was duplicated');
    eq(timers.active().filter(one => one.ms === cfg.afterPullMs).length, 1,
      'the post-pull hook did not keep exactly one distinct short follow-up');

    w.h.dispatch('mls:session-boundary', {});
    eq(timers.active().length, 1, 'an account boundary did not replace old-account timers with one clean wake');
    eq(timers.active()[0].ms, cfg.bootDelayMs, 'an account boundary skipped the sign-in settling delay');

    w.h.store.set(w.key('upcomingAutoPull'), '0');
    w.h.dispatch('storage', { key: w.key('upcomingAutoPull'), newValue: '0' });
    eq(timers.active().length, 0, 'a cross-tab OFF change left a wake armed');
    w.h.store.set(w.key('upcomingAutoPull'), '1');
    w.h.dispatch('storage', { key: w.key('upcomingAutoPull'), newValue: '1' });
    eq(timers.active().length, 1, 'a cross-tab ON change did not queue exactly one wake');

    const stale = timers.active()[0];
    eq(w.si._upcomingShutdown(), true, 'shutdown did not run');
    eq(timers.active().length, 0, 'shutdown left a scheduler timer alive');
    stale.fn(); /* even a callback already queued by the browser must retire */
    await flush();
    eq(timers.active().length, 0, 'a stale callback re-armed after shutdown');
    eq(w.h.gotoDates.length, 0, 'a stale callback drove Athena after shutdown');
    w.h.dispatch('mls:upcoming-setting-changed', { on: true });
    timers.dispatchDocument('visibilitychange');
    eq(timers.active().length, 0, 'shutdown left a setting or visibility listener wired');
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
    const stoppedLedger = JSON.parse(live.h.store.get(live.key('mlsUpcomingPullV1')));
    const stoppedEntry = stoppedLedger[TODAY + '|all'];
    eq(stoppedEntry.ok, false, 'a stopped partial day was marked fresh/ok in the upcoming ledger');
    eq(stoppedEntry.complete, false, 'a stopped partial day was marked complete in the upcoming ledger');
    eq(stoppedEntry.reason, 'stopped-by-user', 'the ledger hid the Stop behind a generic partial reason');
    let stoppedDue = live.si._upcomingState().days.find(d => d.day === TODAY);
    eq(stoppedDue.due, false, 'the scheduler would immediately restart a pull the doctor just stopped');
    eq(stoppedDue.why, 'retry-wait', 'the stopped day is mislabeled fresh during its bounded retry pause');
    live.h.setNow(live.h.now() + live.si._upcomingConfig().retryMs + 1);
    stoppedDue = live.si._upcomingState().days.find(d => d.day === TODAY);
    eq(stoppedDue.due, true, 'a stopped partial day never became retry-due');
    eq(stoppedDue.why, 'retry', 'a stopped partial day became due under the wrong reason');
  }

  /* A stopped future day can contain rows while it waits for its bounded
     retry. Those rows are not "ready" and cannot consume one of the two warm
     future-day slots or hide a genuinely untouched clinic day. */
  {
    stage = '5d stopped future is not ready quota';
    const w = world();
    w.h.seedDay(TODAY, 0);
    w.h.seedDay(TOMORROW, 2);
    w.h.seedDay(DAY_AFTER, 1);
    w.h.seedDay(MONDAY, 1);
    const ledger = {};
    ledger[TOMORROW + '|all'] = {
      at: w.h.now(), rows: 2, ok: false, complete: false, attention: 0,
      readMode: 'day-facts', reason: 'stopped-by-user'
    };
    w.h.store.set(w.key('mlsUpcomingPullV1'), JSON.stringify(ledger));
    const run = await w.si._upcomingRunNow({});
    const held = run.days.find(d => d.day === TOMORROW);
    eq(held.reason, 'retry-wait', 'the stopped future day was reported as fresh while waiting');
    eq(w.chartsPerDay()[TOMORROW], undefined, 'the bounded retry pause immediately reopened the stopped day');
    eq(w.chartsPerDay()[DAY_AFTER], 1, 'the stopped rows hid the next untouched future clinic day');
    eq(w.chartsPerDay()[MONDAY], 1, 'the stopped rows consumed a ready-day slot and hid the second untouched clinic day');
    eq(run.ran, 2, 'the walk did not fill exactly the two ready future-day slots');
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
     6b. turning the setting OFF mid-walk finishes the current day and stops
         before the next chart is opened
     ====================================================================== */
  {
    stage = '6b setting off mid-walk';
    const w = world();
    w.h.seedDay(TODAY, 2);
    w.h.seedDay(TOMORROW, 2);
    const passthrough = w.h.rt.postMessage;
    let todayGotos = 0;
    w.h.rt.postMessage = msg => {
      if (msg && msg.type === 'mlsAppGotoDate' && String(msg.date) === TODAY) {
        todayGotos++;
        if (todayGotos === 2) w.h.store.set(w.key('upcomingAutoPull'), '0');
      }
      return passthrough(msg);
    };
    const run = await w.si._upcomingRunNow({});
    eq(run.ran, 1, 'turning the setting off did not let the day already in flight finish');
    eq(run.reason, 'setting-off', 'the mid-walk setting change did not name why the walk stopped');
    eq(w.chartsPerDay()[TOMORROW], undefined, 'the lane opened tomorrow after the doctor turned it off');
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
    eq(run.reason, 'partial', 'a walk containing an incomplete day still reported overall complete');
    const partialLedger = JSON.parse(w.h.store.get(w.key('mlsUpcomingPullV1')));
    eq(partialLedger[TODAY + '|all'].ok, false, 'an incomplete day was stored as fresh/ok');
    eq(w.si._upcomingDayReady(TODAY).ready, false,
      'a partial day is reported ready merely because one chart was read');
    eq(w.toasts.length, 1, 'a day with unreadable rows said something other than one line');
    ok(/could not be read/.test(w.toasts[0].text),
      'the one line does not say, in plain words, that a chart could not be read');
    ok(!/charts?[^.]*\bare ready\b/i.test(w.toasts[0].text),
      'the partial-day warning still claims the charts are ready');
    ok(!/\bpull\b.*\bfail/i.test(w.toasts[0].text) && !/receipt|gate|lease|batch/i.test(w.toasts[0].text),
      'the doctor-visible line carries developer words');
    eq(w.dialogs(), 0, 'a walk with a failed row opened a dialog');
  }

  /* =========================================================================
     7b. a chart success with an unread pulled-day note is not ready
     ====================================================================== */
  {
    stage = '7b own-day note debt';
    const w = world({ legacyAllVisits: true });
    w.h.seedDay(TODAY, 1);
    w.h.rt.__mlsVisitSavePref.runForPatient = (p, _onStatus, opts) => {
      w.h.noteCalls.push({ patientId: p && p.id, onlyDate: opts && opts.onlyDate, syntheticFailure: true });
      return Promise.resolve({ ok: false, reason: 'identity-mismatch' });
    };
    const post = w.h.rt.postMessage;
    let todayGotos = 0;
    w.h.rt.postMessage = message => {
      if (message && message.type === 'mlsAppGotoDate' && message.date === TODAY && ++todayGotos === 2) {
        w.h.store.set(w.key('upcomingAutoPull'), '0');
      }
      return post(message);
    };
    const run = await w.si._upcomingRunNow({});
    eq(run.ran, 1, 'the own-day note fixture did not finish its chart day');
    const led = JSON.parse(w.h.store.get(w.key('mlsUpcomingPullV1')));
    const entry = led[TODAY + '|all'];
    eq(entry.complete, false, 'a failed pulled-day note was stored as complete');
    eq(entry.attention, 1, 'the failed pulled-day note is absent from needs attention');
    eq(w.si._upcomingDayReady(TODAY).ready, false,
      'a chart with its pulled-day note still owed is reported ready');
    eq(w.toasts.length, 1, 'the pulled-day note debt did not produce exactly one quiet-walk warning');
    ok(/could not be read/.test(w.toasts[0].text),
      'the pulled-day note warning does not explain that one patient could not be read');
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

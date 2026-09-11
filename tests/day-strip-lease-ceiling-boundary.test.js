'use strict';
/* =============================================================================
 * day-strip-lease-ceiling-boundary.test.js
 *
 * Executes the SHIPPED day-strip bytes for three measured pull wedges:
 *
 *   dslease-1.0.0  ONE KEYBOARD. A pull may not start while another MLS lane
 *                  is driving the athenaOne tab, and while a pull runs the
 *                  shared per-tab busy stamp the write lane already reads
 *                  stays fresh so that lane refuses in the other direction.
 *                  PIN one-keyboard: with the write lane marked driving, a
 *                  pull start returns reason 'athena-busy' with by='write-lane'
 *                  and the engine is never called.
 *
 *   dsceil-1.0.0   NO-SETTLE CEILING. si.dayPull() used to be awaited with no
 *                  ceiling at all, so a bridge that never settles left
 *                  DS.pulling true, the button on "Starting..." and NO outcome
 *                  ever written.
 *                  PIN no-settle-ceiling: stub si.dayPull with a never-settling
 *                  promise -> within the ceiling the button is enabled,
 *                  DS.pulling is false and the outcome reason is
 *                  'engine-no-settle'. A pull that is still reporting progress
 *                  is never cut short.
 *
 *   dsbt-1.0.0     BOUNDARY TEARDOWN. done() opened with a session-serial
 *                  guard ahead of DS.pulling=false and the button re-enable, so
 *                  a boundary landing mid-pull left the control dead.
 *                  PIN boundary-teardown: start a pull, run the session
 *                  boundary mid-flight, let the engine settle -> button
 *                  enabled, a terminal receipt exists, DS.pulling false.
 *
 * No network, no browser, no extension, no patient data: the day-strip source
 * is sliced out of 1p-mls-connect.js and executed in a vm against a fake
 * window, a fake DOM and a controllable clock.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

/* ------------------------------- slices --------------------------------- */
const laneStart = connect.indexOf("  var DS_LEASE_VERSION = 'dslease-1.0.0'");
const laneEnd = connect.indexOf('  function removeDoctorDayControls() {');
assert(laneStart > 0 && laneEnd > laneStart, 'the day-strip lease/ceiling lane could not be bounded');
const laneBlock = connect.slice(laneStart, laneEnd);

/* attq-1.0.0 / idq-1.0.0 live above the lane block: the two queues the doctor
   could not see, and the two verbs that clear them. */
const queueStart = connect.indexOf("  var DS_ATTENTION_VERSION = 'attq-1.0.0'");
const queueEnd = connect.indexOf('  function wakeAthenaAndRetryFailedHistories() {');
assert(queueStart > 0 && queueEnd > queueStart, 'the needs-attention / identity queue lane could not be bounded');
const queueBlock = connect.slice(queueStart, queueEnd);

const resetStart = connect.indexOf('  function resetDaySwitchSession() {');
const resetEnd = connect.indexOf("\n  window.addEventListener('mls:easy-visit-day-changed', onEasyVisitDayChanged)", resetStart);
assert(resetStart > 0 && resetEnd > resetStart, 'resetDaySwitchSession could not be bounded');
const resetBlock = connect.slice(resetStart, resetEnd);

/* --------------------------- structural pins ----------------------------- */
assert(laneBlock.includes("reason: 'athena-busy'"), 'the start gate no longer names the athena-busy refusal');
assert(laneBlock.includes('var dsBusyLane = dsAthenaBusyLane();'), 'the start gate no longer consults the shared driver predicate');
assert(laneBlock.includes('window.__mlsAthenaDrivenByMls'), 'the lease gate must consult the follow guard\'s own predicate, not a private copy');
assert(/reason: 'engine-no-settle'/.test(laneBlock), 'the no-settle terminal lost its reason code');
assert(resetBlock.indexOf("dsAbortActiveRun('aborted-session-boundary'") > 0, 'the session boundary no longer drives the active run terminal');
assert(resetBlock.indexOf('dsAbortActiveRun') < resetBlock.indexOf('DS.sessionSerial++'),
  'the boundary bumps the serial BEFORE it disarms the run it is invalidating');
const doneIdx = connect.indexOf('function done(ok, msg, keepStatus, signinRequired) {');
const doneSlice = connect.slice(doneIdx, doneIdx + 1600);
assert(doneSlice.indexOf('DS.pulling = false;') < doneSlice.indexOf('if (!dsPainting) return;'),
  'done() gates its teardown on the session serial again');
assert(doneSlice.indexOf('btn.disabled = false') < doneSlice.indexOf('if (!dsPainting) return;'),
  'the button re-enable sits behind the painting fence again');

/* ------------------------------ sandbox ---------------------------------- */
function makeLane(opts) {
  opts = opts || {};
  let NOW = 1767225600000; /* fixed synthetic clock */
  let timerSeq = 0;
  const timers = new Map();

  const elements = new Map();
  function element(id) {
    const el = {
      id: id, disabled: false, innerHTML: '', textContent: '', type: '', className: '', tag: '',
      style: { display: '', cssText: '' }, parentNode: null, nextSibling: null, children: [], attrs: {},
      setAttribute(k, v) { el.attrs[String(k)] = String(v); },
      appendChild(c) { el.children.push(c); if (c) { c.parentNode = el; if (c.id) elements.set(c.id, c); } return c; },
      insertBefore(c) { el.children.push(c); if (c) { c.parentNode = el; if (c.id) elements.set(c.id, c); } return c; },
      remove() {
        if (el.id) elements.delete(el.id);
        if (el.parentNode) { const at = el.parentNode.children.indexOf(el); if (at >= 0) el.parentNode.children.splice(at, 1); }
      }
    };
    return el;
  }
  function need(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); }
  need('mlsDsPullBtn'); need('mlsDsStatus');
  elements.get('mlsDsStatus').parentNode = need('mlsDsStrip');
  /* the identity panel is a SIBLING of the strip, so the strip needs a parent */
  elements.get('mlsDsStrip').parentNode = need('mlsDsBody');

  const log = { status: [], owned: [], toasts: [], renders: 0, terminals: [], stops: 0 };

  const win = {};
  win.toast = function (m, k) { log.toasts.push({ m: String(m || ''), k: String(k || '') }); };

  const sandbox = {
    console, Math, Number, String, Object, JSON, Promise, Array, Error, isFinite, parseInt, parseFloat,
    Date: { now: () => NOW },
    window: win,
    document: {
      getElementById(id) { return elements.has(id) ? elements.get(id) : null; },
      createElement(tag) { const made = element(''); made.tag = String(tag); return made; }
    },
    setTimeout(fn, ms) { const id = ++timerSeq; timers.set(id, { fn, at: NOW + (Number(ms) || 0), every: 0 }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = ++timerSeq; const every = Math.max(1, Number(ms) || 1); timers.set(id, { fn, at: NOW + every, every }); return id; },
    clearInterval(id) { timers.delete(id); },
    /* ---- the day-strip collaborators this lane does not own ---- */
    DS: {
      day: '2026-09-11', followToday: true, pulling: false, retrying: false, __autoRetrying: false,
      sessionSerial: 3, pullSerial: 5, autoRePull: 0, pullId: '', pullStartedAt: 0,
      lastResult: null, lastAttemptResult: null, terminalReceipt: null, terminalReceiptKey: '',
      statusLog: [], statusOmitted: 0, pullProviderScope: null, preferenceGatePending: false,
      pullVisitBodies: false, providerRosterRetryReceipt: null, providerAttributionCoverage: null,
      __psrFirst: null, __psrRec: null, __psrNote: '', __psrPending: false, __resumeCache: null
    },
    DS_AUTO_RETRY: {}, DS_PREF_READY: {},
    $(id) { return elements.has(id) ? elements.get(id) : null; },
    esc(v) { return String(v == null ? '' : v); },
    fmtDay(k) { return String(k || ''); },
    todayKey() { return '2026-09-11'; },
    ensure() {},
    renderList() { log.renders++; },
    dsStatusLog(m) { if (m) log.status.push(String(m)); },
    dsSyncDiagBtn() {},
    syncRetryControl() { return 0; },
    retryItems() { return []; },
    dsConvergeEligible() { return false; },
    dsAutoConvergeBodies(serial, cb) { cb({ rounds: 0 }); },
    dsBoundAttributionCoverage() { return null; },
    dsFullyRowUnattributed() { return false; },
    dsPsrApi() { return null; },
    dsRosterPaintRefusal() { return false; },
    dsRosterRetryBlocked() { return false; },
    dsRunRosterWarmGuard(task) { return Promise.resolve({ started: true, value: task() }); },
    dsPreferenceRefusal(r) { return 'pref-refusal:' + String(r || ''); },
    dsNewPullId() { return 'pull-syn-' + (++timerSeq); },
    dsResumeState() { return { resumable: false }; },
    dsResumeCacheClear() {},
    dsResumeLine() { return 'resume'; },
    dsPullVerb() { return 'Pull today'; },
    dsBeginPullEpoch(serial) { return { sessionSerial: String(serial), pullId: String(sandbox.DS.pullId || ''), emitted: false }; },
    dsTerminalPullEpoch(handle, ok) {
      if (!handle || handle.emitted) return false;
      handle.emitted = true; log.terminals.push({ ok: ok === true }); return true;
    },
    pullOutcome(result, day) {
      return { ok: !!(result && result.ok === true), message: 'verdict for ' + String(day), keepStatus: false, signinRequired: false };
    },
    ownAttemptResult(result, day, fallbackReason, fallbackError) {
      const owned = Object.assign({}, result && typeof result === 'object' ? result : null);
      owned.ok = !!(result && result.ok === true);
      if (!owned.reason) owned.reason = fallbackReason || 'unverified-result';
      if (!owned.target) owned.target = String(day || '');
      if (!owned.error && fallbackError) owned.error = String(fallbackError);
      owned.terminalStatus = owned.ok ? 'complete' : 'failed';
      sandbox.DS.lastAttemptResult = owned;
      sandbox.DS.terminalReceipt = { status: owned.terminalStatus, reason: owned.reason, day: owned.target, durable: true };
      log.owned.push({ reason: owned.reason, day: owned.target, error: String(owned.error || '') });
      return owned;
    }
  };
  sandbox.window.uns = s => 'syn::' + s;
  vm.createContext(sandbox);
  vm.runInContext(queueBlock + '\n' + laneBlock + '\n' + resetBlock +
    '\nthis.__lane = { startPull: startPull, reset: resetDaySwitchSession, sweep: dsWedgeSweep,' +
    ' busyLane: dsAthenaBusyLane, busyLine: dsAthenaBusyLine, noSettleLine: dsNoSettleLine,' +
    ' interruptedLine: dsInterruptedLine, ceiling: dsCeilConfig,' +
    ' syncAttention: syncAttentionControl, retryAttentionCharts: retryAttentionCharts,' +
    ' syncIdentity: syncIdentityControl, showIdentityPanel: renderIdentityPanel };',
    sandbox, { filename: 'day-strip-lease-ceiling-lane.js' });

  function fire(untilMs) {
    /* deterministic pump: advance the clock in order of due timers */
    const limit = NOW + untilMs;
    for (let guard = 0; guard < 20000; guard++) {
      let next = null, nextId = 0;
      timers.forEach((t, id) => { if (!next || t.at < next.at) { next = t; nextId = id; } });
      if (!next || next.at > limit) break;
      NOW = next.at;
      if (next.every > 0) next.at = NOW + next.every; else timers.delete(nextId);
      try { next.fn(); } catch (e) { log.status.push('TIMER-THREW:' + e.message); }
    }
    NOW = limit;
  }
  const flush = () => new Promise(r => setImmediate(r));

  return {
    sandbox, log, elements, win, timers, need,
    api: sandbox.__lane,
    btn: () => elements.get('mlsDsPullBtn'),
    stat: () => elements.get('mlsDsStatus'),
    now: () => NOW,
    advance: async (ms) => { fire(ms); await flush(); await flush(); await flush(); },
    flush
  };
}

/* ======================================================================
   1. one-keyboard: a driving write lane refuses the start by name
   ====================================================================== */
async function scenarioLease() {
  const L = makeLane();
  let dayPullCalls = 0;
  L.win.__mlsSI = {
    pull() { dayPullCalls++; return Promise.resolve({ ok: true }); },
    dayPull() { dayPullCalls++; return Promise.resolve({ ok: true }); },
    stopPull() { L.log.stops++; return { requested: true }; }
  };
  L.win.__mlsWriteFlow = { state: { running: true, busy: false, athenaBusy: true, athenaBusyAt: L.now() } };
  L.win.__mlsAthenaDrivenByMls = () => ({ driving: true, by: 'write-lane', at: L.now() });

  const refusal = L.api.startPull();
  await L.flush();
  assert(refusal && refusal.ok === false, 'a pull started while the write lane was driving');
  assert.strictEqual(refusal.reason, 'athena-busy', 'the refusal lost its reason code');
  assert.strictEqual(refusal.by, 'write-lane', 'the refusal does not name the lane holding the tab');
  assert.strictEqual(dayPullCalls, 0, 'the engine was called anyway - the pull typed into a tab another lane was driving');
  assert.strictEqual(L.sandbox.DS.pulling, false, 'the refused press still claimed the strip');
  assert.strictEqual(L.btn().disabled, false, 'the refused press left the button disabled');
  assert.strictEqual(L.win.__mlsPullLastOutcome.reason, 'athena-busy', 'the machine surface does not record the refusal');
  assert.strictEqual(L.win.__mlsPullLastOutcome.by, 'write-lane', 'the machine surface does not name the lane');
  assert(L.log.owned.some(r => r.reason === 'athena-busy'), 'the refusal left no durable attempt receipt');
  assert(/writing into athenaOne/.test(L.stat().textContent), 'the doctor is not told which lane holds the tab');

  /* an automatic retry that loses the tab is a TERMINAL, never a new wedge -
     and it may not erase the receipt the attempt it is retrying earned */
  L.sandbox.DS.__autoRetrying = true;
  L.win.__mlsPullLastOutcome = { ok: false, reason: 'history-partial', at: L.now(), kept: true };
  const ownedBeforeRetry = L.log.owned.length;
  L.api.startPull(L.sandbox.DS_AUTO_RETRY);
  await L.flush();
  assert.strictEqual(L.sandbox.DS.__autoRetrying, false, 'a refused automatic retry left __autoRetrying armed forever (isBusy would never clear)');
  assert.strictEqual(L.win.__mlsPullLastOutcome.reason, 'history-partial', 'a refused automatic re-read erased the day verdict its own pull had earned');
  assert.strictEqual(L.log.owned.length, ownedBeforeRetry, 'a refused automatic re-read re-owned the attempt receipt');
  assert.strictEqual(L.win.__mlsDayPullLeaseV1.lastRefusal.by, 'write-lane', 'the automatic refusal left no read-only record of itself');

  /* a LEAKED write-lane hop stamp may not take the button away */
  L.win.__mlsWriteFlow = { state: { running: false, busy: false, athenaBusy: true, athenaBusyAt: L.now() - 200000 } };
  assert.strictEqual(L.api.busyLane(), '', 'a 200s-stale write-lane hop stamp still blocks the doctor\'s pull');

  /* with the tab free the pull runs, and while it runs the shared busy stamp
     the write lane itself reads stays fresh (the reciprocal refusal) */
  L.win.__mlsAthenaDrivenByMls = () => ({ driving: false, by: '', at: L.now() });
  L.win.__mlsPullBusyAt = 0;
  L.api.startPull(L.sandbox.DS_PREF_READY);
  await L.flush();
  assert.strictEqual(dayPullCalls, 1, 'the pull did not reach the engine once the tab was free');
  assert.strictEqual(L.sandbox.DS.pulling, false, 'the resolved pull never settled');
  assert(L.log.owned.some(r => r.reason !== 'athena-busy'), 'the successful attempt left no receipt');
  console.log('  ok  one-keyboard: athena-busy names the lane, types nothing, and a stale flag cannot wedge the button');
  return true;
}

/* ======================================================================
   2. no-settle-ceiling: a never-settling engine promise still terminates
   ====================================================================== */
async function scenarioCeiling() {
  const L = makeLane();
  L.win.__mlsDayPullCeilingOverrideV1 = { noProgressMs: 4000, absoluteMs: 120000, tickMs: 500 };
  let statusSink = null;
  let resolveEngine = null;
  L.win.__mlsSI = {
    pull() { return new Promise(() => {}); },
    dayPull(opts) { statusSink = opts && opts.onStatus; return new Promise(r => { resolveEngine = r; }); },
    stopPull() { L.log.stops++; return { requested: true }; }
  };
  const cfg = L.api.ceiling();
  assert.strictEqual(cfg.noProgressMs, 4000, 'the ceiling override seam is not honoured');
  assert.strictEqual(cfg.source, 'override', 'the ceiling does not report where its clock came from');

  L.api.startPull(L.sandbox.DS_PREF_READY);
  await L.flush();
  assert.strictEqual(L.sandbox.DS.pulling, true, 'the pull never claimed the strip');
  assert.strictEqual(L.btn().disabled, true, 'the running pull left its button live');

  /* a pull that is still talking is ALIVE, however long it takes */
  for (let i = 0; i < 6; i++) {
    await L.advance(3000);
    if (statusSink) statusSink('History 1 of 20 - synthetic');
  }
  assert.strictEqual(L.sandbox.DS.pulling, true, 'a pull reporting progress every 3s was timed out by a 4s no-progress ceiling');
  assert(!L.win.__mlsPullLastOutcome || L.win.__mlsPullLastOutcome.reason !== 'engine-no-settle',
    'a live pull was stamped engine-no-settle');

  /* now it goes silent */
  await L.advance(6000);
  assert.strictEqual(L.sandbox.DS.pulling, false, 'a never-settling engine still holds DS.pulling');
  assert.strictEqual(L.btn().disabled, false, 'the button is still stuck after the ceiling expired');
  assert(!/Pulling|Resuming|Starting/.test(L.btn().innerHTML), 'the button still reads as a running pull');
  assert.strictEqual(L.win.__mlsPullLastOutcome.reason, 'engine-no-settle', 'no outcome was written for the wedged engine');
  assert.strictEqual(L.win.__mlsPullLastOutcome.ceiling, 'no-progress', 'the outcome does not say which ceiling bit');
  assert(L.log.owned.some(r => r.reason === 'engine-no-settle'), 'the wedge left no durable attempt receipt');
  assert.strictEqual(L.log.stops, 1, 'the wedged engine was never asked to stop driving athena');
  assert.strictEqual(L.log.terminals.length, 1, 'the attempt-scoped terminal did not fire exactly once');

  /* the late answer is recorded as late, and may NOT re-own the receipt */
  const ownedBefore = L.log.owned.length;
  resolveEngine({ ok: true, complete: true, reason: 'complete' });
  await L.flush();
  assert.strictEqual(L.log.owned.length, ownedBefore, 'a late engine answer re-owned the receipt the doctor was already shown');
  assert(L.win.__mlsPullLateSettleV1 && L.win.__mlsPullLateSettleV1.ok === true, 'the late answer was not recorded');
  assert.strictEqual(L.win.__mlsPullLastOutcome.reason, 'engine-no-settle', 'the late answer overwrote the terminal outcome');
  console.log('  ok  no-settle-ceiling: progress defers it, silence ends it with engine-no-settle, the late answer is recorded not swapped in');
  return true;
}

/* ======================================================================
   3. boundary-teardown + the wall-clock sweeper and button watchdog
   ====================================================================== */
async function scenarioBoundary() {
  const L = makeLane();
  let resolveBoundary = null;
  L.win.__mlsSI = {
    pull() { return new Promise(() => {}); },
    dayPull() { return new Promise(r => { resolveBoundary = r; }); },
    stopPull() { L.log.stops++; return { requested: true }; }
  };
  L.api.startPull(L.sandbox.DS_PREF_READY);
  await L.flush();
  assert.strictEqual(L.sandbox.DS.pulling, true, 'the pull never started');
  const serialBefore = L.sandbox.DS.sessionSerial;

  L.api.reset(); /* the mls:session-boundary handler, verbatim */
  await L.flush();
  assert.strictEqual(L.sandbox.DS.sessionSerial, serialBefore + 1, 'the boundary did not invalidate the in-flight callbacks');
  assert.strictEqual(L.sandbox.DS.pulling, false, 'the boundary stranded DS.pulling - the control is dead');
  assert.strictEqual(L.sandbox.DS.__autoRetrying, false, 'the boundary stranded the automatic chain');
  assert(L.log.owned.some(r => r.reason === 'aborted-session-boundary'), 'the interrupted run left no terminal receipt');
  assert.strictEqual(L.win.__mlsPullLastOutcome.reason, 'aborted-session-boundary', 'the machine surface does not record the interruption');
  assert.strictEqual(L.log.stops, 1, 'the boundary left the engine driving athena for the signed-out account');
  assert.strictEqual(L.log.terminals.length, 1, 'the interrupted attempt emitted no scoped terminal');
  assert.strictEqual(L.btn().disabled, false, 'the interrupted run left the button disabled');
  /* the engine answering after the boundary may not re-own the interruption */
  const ownedAfterBoundary = L.log.owned.length;
  resolveBoundary({ ok: true, complete: true, reason: 'complete' });
  await L.flush();
  assert.strictEqual(L.log.owned.length, ownedAfterBoundary, 'a late answer re-owned the receipt of a boundary-interrupted run');
  assert.strictEqual(L.win.__mlsPullLastOutcome.reason, 'aborted-session-boundary', 'a late answer overwrote the interruption outcome');

  /* a STALE-SERIAL settle (a boundary driven by some other owner) must still
     run the teardown, and must paint nothing into the new session */
  const M = makeLane();
  let resolveM = null;
  M.win.__mlsSI = { pull() { return new Promise(() => {}); }, dayPull() { return new Promise(r => { resolveM = r; }); }, stopPull() { M.log.stops++; return {}; } };
  M.api.startPull(M.sandbox.DS_PREF_READY);
  await M.flush();
  M.sandbox.DS.sessionSerial += 1;              /* somebody else bumped it */
  const rendersBefore = M.log.renders, statusBefore = M.log.status.length;
  resolveM({ ok: true, complete: true, reason: 'complete' });
  await M.flush();
  assert.strictEqual(M.sandbox.DS.pulling, false, 'a stale-serial settle skipped the teardown - DS.pulling stayed true');
  assert.strictEqual(M.btn().disabled, false, 'a stale-serial settle left the button disabled for good');
  assert.strictEqual(M.log.renders, rendersBefore, 'a superseded session was repainted');
  assert.strictEqual(M.log.status.length, statusBefore, 'a superseded session had status written into its log');

  /* the button watchdog: disabled, nothing running, nobody coming back */
  const W = makeLane();
  W.btn().disabled = true;
  W.btn().innerHTML = 'Pulling...';
  assert.strictEqual(W.api.sweep(), false, 'the watchdog fired on its very first look');
  await W.advance(31000);
  assert.strictEqual(W.api.sweep(), true, 'the watchdog never restored a button disabled for 30s with nothing running');
  assert.strictEqual(W.btn().disabled, false, 'the watchdog did not give the button back');
  assert(/interrupted/.test(W.stat().textContent), 'the watchdog did not say the last pull was interrupted');

  /* and the wall-clock backstop for a run whose own timer never fired */
  const S = makeLane();
  S.win.__mlsSI = { pull() { return new Promise(() => {}); }, dayPull() { return new Promise(() => {}); }, stopPull() { S.log.stops++; return {}; } };
  S.win.__mlsDayPullCeilingOverrideV1 = { noProgressMs: 600000, absoluteMs: 60000, tickMs: 600000 };
  S.api.startPull(S.sandbox.DS_PREF_READY);
  await S.flush();
  await S.advance(130000); /* absolute 60s + the sweeper's own 60s grace */
  assert.strictEqual(S.api.sweep(), true, 'the wall-clock sweeper did not notice a run past its absolute ceiling');
  assert.strictEqual(S.sandbox.DS.pulling, false, 'the sweeper left DS.pulling set');
  assert(S.log.owned.some(r => r.reason === 'engine-no-settle'), 'the swept run left no terminal receipt');
  console.log('  ok  boundary-teardown: the boundary drives the run\'s own terminal, a stale serial still tears down and paints nothing, and both wedge backstops fire');
  return true;
}

/* ======================================================================
   4. oown-1.0.0 + the doctor's words

   The strip already refused to let a late answer re-own ITS receipt, but the
   machine surface window.__mlsPullLastOutcome is written by the IMPORTER's
   own settle, unconditionally - measured 2026-09-11, 15s after a session
   boundary had ended the run, the engine's settle put 'history-partial' back
   over 'aborted-session-boundary'. The strip now raises a fence the engine
   reads, so the two surfaces cannot disagree about one attempt.

   And the sentences: a no-settle terminal may not claim athenaOne "stopped
   answering" (the strip cannot see athenaOne - only whether this pull
   reported anything), no doctor-facing sentence may contain an internal word
   or a raw code, and the new refusals use the same em dash their siblings do.
   ====================================================================== */
const DOCTOR_WORD_BAN = /\b(lane|engine|promise|callback|serial|token|null|undefined|receipt|bridge|API|DOM|async)\b/i;

async function scenarioFenceAndWords() {
  /* ---- the sentences, straight out of the shipped bytes ---------------- */
  const W = makeLane();
  const busyKnown = W.api.busyLine('write-lane');
  const busyUnknown = W.api.busyLine('some-new-reader');
  const noProgress = W.api.noSettleLine('2026-09-11', 13 * 60000, 'no-progress');
  const absolute = W.api.noSettleLine('2026-09-11', 76 * 60000, 'absolute');
  const interrupted = W.api.interruptedLine('2026-09-11');

  [busyKnown, busyUnknown, noProgress, absolute, interrupted].forEach((line) => {
    assert(!DOCTOR_WORD_BAN.test(line), 'a doctor-facing sentence carries an internal word: ' + line);
    assert(!/[{}<>]|\bundefined\b|\[object/.test(line), 'a doctor-facing sentence carries machine debris: ' + line);
  });
  assert(!/some-new-reader/.test(busyUnknown), 'the fallback refusal prints a raw internal code at the doctor: ' + busyUnknown);
  assert(/another part of MLS is using athenaOne/.test(busyUnknown), 'the fallback refusal no longer says what is happening: ' + busyUnknown);
  assert(/writing into athenaOne/.test(busyKnown), 'the named lane lost its plain-English sentence');
  assert(busyKnown.indexOf('—') > 0, 'the refusal uses a hyphen where every sibling refusal uses an em dash');
  assert(noProgress.indexOf('—') > 0, 'the no-settle sentence uses a hyphen where every sibling refusal uses an em dash');

  assert(!/stopped answering/.test(noProgress),
    'the no-settle sentence still asserts something about athenaOne the strip cannot know: ' + noProgress);
  assert(/nothing has come back from this pull for 13 minutes/.test(noProgress),
    'the no-progress ceiling does not name the silence it actually measured: ' + noProgress);
  assert(/ran for 76 minutes without finishing/.test(absolute),
    'the absolute ceiling describes itself as silence it never measured: ' + absolute);
  [noProgress, absolute, interrupted].forEach((line) => {
    assert(/Select Pull to run the day again\.$/.test(line), 'a terminal sentence does not end with what to do next: ' + line);
  });
  /* the subject is swappable so the needs-attention re-read gets its own */
  assert(/^Those charts were not re-read — /.test(W.api.busyLine('write-lane', 'Those charts were not re-read')),
    'the busy sentence cannot speak for anything but the Pull button');

  /* ---- the fence: the ceiling raises it ------------------------------- */
  const L = makeLane();
  L.win.__mlsDayPullCeilingOverrideV1 = { noProgressMs: 4000, absoluteMs: 120000, tickMs: 500 };
  let resolveEngine = null;
  L.win.__mlsSI = {
    pull() { return new Promise(() => {}); },
    dayPull() { return new Promise((r) => { resolveEngine = r; }); },
    stopPull() { L.log.stops++; return { requested: true }; }
  };
  assert(!L.win.__mlsPullOutcomeFenceV1, 'a fence existed before any pull ran');
  L.api.startPull(L.sandbox.DS_PREF_READY);
  await L.flush();
  const startedAt = L.now();
  await L.advance(6000);
  const fence = L.win.__mlsPullOutcomeFenceV1;
  assert(fence, 'THE MEASURED DEFECT: the ceiling wrote no fence, so the engine settle will re-own the outcome');
  assert.strictEqual(fence.reason, 'engine-no-settle', 'the fence does not name what ended the run');
  assert.strictEqual(fence.target, '2026-09-11', 'the fence does not name the day it belongs to');
  assert(fence.at >= startedAt, 'the fence is stamped before the run it fences');
  resolveEngine({ ok: true, complete: true });
  await L.flush();

  /* ---- the fence: a session boundary raises it too --------------------- */
  const B = makeLane();
  B.win.__mlsSI = { pull() { return new Promise(() => {}); }, dayPull() { return new Promise(() => {}); }, stopPull() { B.log.stops++; return {}; } };
  B.api.startPull(B.sandbox.DS_PREF_READY);
  await B.flush();
  B.api.reset();
  await B.flush();
  assert(B.win.__mlsPullOutcomeFenceV1, 'a session boundary left the engine free to overwrite the interruption');
  assert.strictEqual(B.win.__mlsPullOutcomeFenceV1.reason, 'aborted-session-boundary', 'the boundary fence does not name itself');

  /* ---- and the late-answer support line says nothing internal --------- */
  const lateLines = L.log.status.filter((m) => /answered after MLS/.test(m));
  assert(lateLines.length >= 1, 'the late answer left no line in the copyable support report');
  lateLines.forEach((line) => {
    assert(!DOCTOR_WORD_BAN.test(line), 'the late-answer line still carries an internal word: ' + line);
    assert(!/late-resolve|late-reject/.test(line), 'the late-answer line still prints a raw code: ' + line);
  });
  console.log('  ok  oown-1.0.0 + words: the ceiling and the boundary fence the engine settle, and every new sentence says only what MLS measured');
  return true;
}

/* ======================================================================
   5. attq-1.0.0 + idq-1.0.0: the two queues the doctor could not see

   MEASURED 2026-09-11: the engine wrote durable refusals into the day ledger
   and could re-read exactly those rows, the shell raised one-click identity
   suggestions and blocked the duplicate mint behind them - and NOTHING on any
   screen mentioned either. Both were reachable only from a console.
   ====================================================================== */
async function scenarioQueues() {
  const L = makeLane();
  L.need('mlsDsAttentionBtn');
  L.need('mlsDsIdentityBtn');

  let queued = 2, retried = null;
  L.win.__mlsSI = {
    pull() { return Promise.resolve({ ok: true }); },
    dayPull() { return Promise.resolve({ ok: true }); },
    stopPull() { return {}; },
    attentionQueue(opts) { return { count: queued, days: [String(opts && opts.day || '')], codes: {}, rows: [] }; },
    retryAttention(day, onStatus) { retried = { day: day, onStatus: onStatus }; queued = 0; return Promise.resolve({ complete: true }); }
  };

  /* the control exists only while the queue does, and names the count */
  const attBtn = L.elements.get('mlsDsAttentionBtn');
  assert.strictEqual(L.api.syncAttention(true), 2, 'the strip cannot see the needs-attention queue at all');
  assert.strictEqual(attBtn.style.display, 'inline-block', 'the needs-attention control stayed hidden with two refusals waiting');
  assert(/2 charts that need attention/.test(attBtn.textContent), 'the control does not name what is waiting: ' + attBtn.textContent);
  assert(!DOCTOR_WORD_BAN.test(attBtn.textContent), 'the control label carries an internal word');

  /* one click re-reads ONLY those rows, for THIS day */
  L.api.retryAttentionCharts();
  await L.flush();
  assert(retried, 'the one click never reached the engine - the queue is still console-only');
  assert.strictEqual(retried.day, '2026-09-11', 'the retry targeted the wrong day');
  await L.flush();
  assert.strictEqual(L.sandbox.DS.retrying, false, 'the attention retry never released the strip');
  assert.strictEqual(L.btn().disabled, false, 'the attention retry left the Pull button disabled');
  assert.strictEqual(attBtn.style.display, 'none', 'the control stayed on screen after its queue emptied');
  assert(/Every chart that needed attention/.test(L.stat().textContent), 'the doctor was not told the queue is clear: ' + L.stat().textContent);

  /* and it refuses for the same reason a pull refuses, without driving */
  queued = 3;
  retried = null;
  L.win.__mlsAthenaDrivenByMls = () => ({ driving: true, by: 'write-lane', at: L.now() });
  L.api.syncAttention(true);
  L.api.retryAttentionCharts();
  await L.flush();
  assert.strictEqual(retried, null, 'the needs-attention re-read typed into a tab another part of MLS was driving');
  assert(/Those charts were not re-read/.test(L.stat().textContent), 'the refusal does not say what was not done: ' + L.stat().textContent);
  L.win.__mlsAthenaDrivenByMls = () => ({ driving: false, by: '', at: L.now() });

  /* ---- the identity suggestions ---------------------------------------- */
  const applied = [];
  const dismissed = [];
  let suggestions = [{ key: 'bea sample', name: 'Bea Sample', dob: '05/14/1980', candidateIds: ['p-a', 'p-b'], conflictIds: [] }];
  L.win.__mlsIdentityFillQueue = () => suggestions.slice();
  L.win.__mlsIdentityFillApply = (key, pid) => { applied.push({ key: key, pid: pid }); suggestions = []; return { ok: true, patientId: pid }; };
  L.win.__mlsIdentityFillDismiss = (key) => { dismissed.push(key); suggestions = []; return { ok: true }; };
  L.win.getPatients = () => ([{ id: 'p-a', name: 'Bea Sample' }, { id: 'p-b', name: 'Sample, Bea R' }]);

  const idBtn = L.elements.get('mlsDsIdentityBtn');
  assert.strictEqual(L.api.syncIdentity(), 1, 'the strip cannot see the identity suggestion queue at all');
  assert.strictEqual(idBtn.style.display, 'inline-block', 'the identity control stayed hidden with a blocked mint waiting');
  assert(/Confirm 1 patient record/.test(idBtn.textContent), 'the identity control does not name what is waiting: ' + idBtn.textContent);

  const panel = L.api.showIdentityPanel();
  assert(panel, 'the identity panel could not be built - the two verbs are still console-only');
  const pick = L.elements.get('mlsDsIdPick0_1');
  assert(pick, 'the panel offers no way to name a candidate record');
  assert(/This is Sample, Bea R/.test(pick.textContent), 'the candidate button does not name the record: ' + pick.textContent);
  assert(L.elements.get('mlsDsIdSkip0'), 'the panel offers no way to say these are different people');

  pick.onclick();
  assert.strictEqual(applied.length, 1, 'the one click never reached the resolver');
  assert.strictEqual(applied[0].pid, 'p-b', 'the click named the wrong record');
  assert.strictEqual(applied[0].key, 'bea sample', 'the click lost the suggestion it was answering');
  assert(/Confirmed: Sample, Bea R/.test(L.stat().textContent), 'the doctor was not told what he just confirmed: ' + L.stat().textContent);
  assert.strictEqual(L.api.syncIdentity(), 0, 'the answered suggestion stayed in the queue');
  assert.strictEqual(idBtn.style.display, 'none', 'the identity control stayed on screen with an empty queue');
  assert.strictEqual(L.sandbox.document.getElementById('mlsDsIdentityPanel'), null, 'the panel outlived the queue it was showing');

  /* the other verb */
  suggestions = [{ key: 'cy sample', name: 'Cy Sample', dob: '05/14/1980', candidateIds: ['p-a'], conflictIds: [] }];
  L.api.syncIdentity();
  L.api.showIdentityPanel();
  L.elements.get('mlsDsIdSkip0').onclick();
  assert.strictEqual(dismissed.join(','), 'cy sample', 'the dismiss verb is not wired to the control');
  assert(!DOCTOR_WORD_BAN.test(L.stat().textContent), 'the dismiss sentence carries an internal word: ' + L.stat().textContent);
  console.log('  ok  attq-1.0.0 + idq-1.0.0: both queues are visible, counted and clearable from the day strip, and the re-read obeys the same one-keyboard gate');
  return true;
}

/* ======================================================================
   6. dsline-1.0.0: a refusal the doctor cannot read is not a refusal

   MEASURED 2026-09-11: syncStrip repaints #mlsDsStatus from the stored
   terminal receipt every 1.2s, and that receipt could only ever say
   "Pull failed for Fri, Sep 11." So the athena-busy refusal and the
   session-boundary interruption survived about a second on screen and then
   vanished, leaving a toast at best.
   ====================================================================== */
function scenarioDurableLine() {
  const rStart = connect.indexOf('  function dsReceiptDay(value) {');
  const rEnd = connect.indexOf('  /* ===== dayresume-1.0.0');
  assert(rStart > 0 && rEnd > rStart, 'the terminal-receipt helpers could not be bounded');
  const receiptBlock = connect.slice(rStart, rEnd);
  assert(receiptBlock.indexOf('dsline-1.0.0') > 0, 'the durable doctor line is gone from the terminal receipt');

  const store = new Map();
  const sandbox = {
    console, JSON, Date, Object, String, Number, Math, Array,
    DS: { day: '2026-09-11', terminalReceipt: null, terminalReceiptKey: '', __resumeCache: null },
    fmtDay: (k) => String(k || ''),
    dsTerminalReceiptKey: () => 'syn::dayPullTerminalV1',
    window: {
      localStorage: {
        getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
        setItem: (k, v) => store.set(String(k), String(v)),
        removeItem: (k) => store.delete(String(k))
      }
    }
  };
  sandbox.localStorage = sandbox.window.localStorage;
  vm.createContext(sandbox);
  vm.runInContext(receiptBlock + '\nthis.__r = { build: dsBuildTerminalReceipt, persist: dsPersistTerminalReceipt, load: dsLoadTerminalReceipt, line: dsTerminalReceiptLine, clean: dsReceiptLine };',
    sandbox, { filename: 'terminal-receipt-block.js' });
  const R = sandbox.__r;

  const SENTENCE = 'Pull not started — MLS is writing into athenaOne right now. Nothing was read and nothing was typed. Try again in a moment.';
  const built = R.build({ reason: 'athena-busy', __dsDoctorLine: SENTENCE }, '2026-09-11');
  assert.strictEqual(built.line, SENTENCE, 'the sentence the doctor was shown was not stored with the terminal');
  assert.strictEqual(R.persist(built).durable, true, 'the terminal receipt did not persist');

  /* the RELOAD (and the 1.2s repaint reads the same way) */
  const back = R.load('2026-09-11');
  assert(back, 'the terminal receipt did not survive the reload');
  assert.strictEqual(R.line(back), SENTENCE,
    'THE MEASURED DEFECT: the strip repaints the generic "Pull failed" line over the refusal it just showed');

  /* an older receipt with no stored sentence keeps the generic line */
  const legacy = R.build({ reason: 'history-partial' }, '2026-09-11');
  assert(/^Pull failed for 2026-09-11\./.test(R.line(legacy)), 'a receipt with no stored sentence lost its status line');

  /* and extension prose can never become a stored sentence */
  assert.strictEqual(R.clean('<b>Ada Sample</b> could not be opened'), '',
    'markup reached the account-local receipt');
  assert.strictEqual(R.clean('   a   b\n c  '), 'a b c', 'the stored sentence is not normalised to one line');
  assert.strictEqual(R.clean('x'.repeat(600)).length, 240, 'the stored sentence is unbounded');
  assert.strictEqual(R.build({ reason: 'history-partial' }, '2026-09-11').line, '',
    'a receipt with no lane-composed sentence invented one');
  console.log('  ok  dsline-1.0.0: the sentence the lane composed survives the 1.2s repaint AND a reload, and only a lane-composed sentence is ever stored');
  return true;
}

(async function main() {
  await scenarioLease();
  await scenarioCeiling();
  await scenarioBoundary();
  await scenarioFenceAndWords();
  await scenarioQueues();
  scenarioDurableLine();
  console.log('PASS day-strip lease + ceiling + boundary + queues (dslease/dsceil/dsbt/oown/attq/idq/dsline): one keyboard on the athena tab, a never-settling engine always ends with a written outcome and a live button, a session boundary can no longer strand the pull control, the engine can no longer overwrite the verdict the doctor was shown, and both refusal queues are visible and clearable from the day strip');
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });

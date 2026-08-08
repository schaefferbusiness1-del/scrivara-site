'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('ScribeFlow.html');
const b18 = read('feat_b18_qa.js');
const task3 = read('feat_task3_frontsync.js');
const realtime = read('feat_mls_upnow_realtime.js');
const activeSelect = read('feat_mls_upnow_activeselect.js');
const connect = read('mls-connect.js');
const staging = read('mls-connect.staging.js');

assert(app.includes("window.__mlsLoaderReadyAt=0; window.dispatchEvent(new Event('mls:loader-start'))"),
  'a new secure startup does not reset the prior loader-ready generation');
assert(app.includes("window.__mlsLoaderReadyAt=Date.now(); window.dispatchEvent(new Event('mls:loader-ready'))"),
  'loader readiness is not durable for modules that arrive after the custom event');
assert(app.includes('var quiet=now-assets.lastActivity>=180'),
  'critical assets regained the duplicate 900ms silence before frame stability');
assert(app.includes('SF_GATE_QUIET_MS=180') && app.includes('setTimeout(check,80)'),
  'the independent frame-stability barrier is no longer short and sampled');

assert(!/offsetParent|getComputedStyle\s*\(/.test(b18),
  'b18 still forces style/layout merely to decide whether a route is visible');
assert.strictEqual((b18.match(/observer\.observe\(document\.documentElement/g) || []).length, 1,
  'b18 must have one lifecycle-owned document observer');
assert(b18.includes("window.addEventListener('mls:loader-ready',readyListener,{once:true})") &&
  b18.includes('function fallbackCheck()') && b18.includes('fallbackTimer=Q.later(fallbackCheck,1000)') &&
  b18.includes('fallbackTimer=Q.later(fallbackCheck,12000)'),
  'b18 lacks loader-ready deferral with a gate-aware lost-event fallback');
assert(b18.includes('__mlsB18Q.onResume(bootWrap)'),
  'calendar wrapper retries can still begin under the secure startup gate');
assert(b18.includes("window.addEventListener('mls:loader-start',loaderStartListener)"),
  'b18 cannot pause its observer and queued scans on a later sign-in');
assert(b18.includes("window.addEventListener('mls:session-boundary',sessionBoundaryListener)"),
  'b18 misses a session boundary when the loading gate is already visible');
assert(b18.includes('while(timers.length) Q.cancel(timers[timers.length-1]);') &&
  b18.includes('pauseHooks.slice().forEach') && b18.includes('__mlsB18Q.onPause(function(){'),
  'b18 can retain old-session timers or its write-confirmation surface across an account boundary');
assert(b18.includes('if(!__mlsB18Q.active){') && b18.includes('cancelled during an account transition'),
  'b18 can reopen a stale write confirmation while the account lifecycle is paused');
assert(b18.includes('listeners.push(rec); if(active) attach(rec);') &&
  b18.includes('listeners.forEach(attach);'),
  'b18 listeners can attach beneath the loader or fail to attach when the lifecycle starts');

assert(task3.includes("var VERSION = 't3-1.1.3'") &&
  task3.includes('if (destroyed || !started) return;') &&
  task3.includes('if (!firstUseReconciled) { scheduleFirstUseReconcile(); return; }'),
  'Task 3 heavy reconciliation is not gated on post-loader startup');
assert(task3.includes("target.closest('.wn-chip,#nav_calendar,#nav_visit,#nav_patients,#heroToday,#calProvFilter,#calJump')") &&
  task3.includes('if (!relevant) return;\n    noteFirstUseActivity();\n    scheduleTick(80);'),
  'Task 3 still schedules a full reconciliation after unrelated button clicks');
assert(!task3.includes(".wn-chip,#calendarView,#visitView,#patientsView"),
  'Task 3 restored broad route-root click reconciliation');
assert(!task3.includes('[400, 1200, 2500, 5000, 9000]'),
  'Task 3 restored the five-pass startup reconciliation ladder');
assert(!task3.includes('[500, 1800, 5000]') && !task3.includes('timeout: 800'),
  'Task 3 restored guaranteed post-reveal reconciliation passes');
assert(task3.includes('T3_FIRST_USE_QUIET_MS = 2500') &&
  task3.includes('scheduler && isFn(scheduler.stats) ? scheduler.stats() : null') &&
  task3.includes("scheduling.isInputPending({ includeContinuous: true })") &&
  task3.includes('startIdle = idle(function (deadline) {') &&
  task3.includes('removeFirstUseActivityListeners();\n      safe(tick);'),
  'Task 3 no longer gives first-use input priority before its one real-idle reconciliation');
assert(task3.includes("safe(ensureWraps); safe(wrapHeroRender); safe(wrapHeroPick);\n    scheduleFirstUseReconcile();"),
  'Task 3 no longer installs correctness wrappers before deferring its expensive first reconciliation');
assert(task3.includes("document.addEventListener('pointerdown', noteFirstUseActivity, true)") &&
  task3.includes("document.removeEventListener('pointerdown', noteFirstUseActivity, true)") &&
  task3.includes('if (!firstUseActivityListeners) return;'),
  'Task 3 first-use fallback listeners are not lifecycle-owned and retired after reconciliation');
assert(task3.includes("window.addEventListener('mls:loader-ready', loaderReadyListener, { once: true })"),
  'Task 3 no longer starts from the canonical loader handoff');
assert(task3.includes('if (destroyed || !started) return;') &&
  task3.includes('if (w.__mlsWrapperDisposed || destroyed || !started) return cur.apply(self, args);') &&
  task3.includes('while (trackedTimeouts.length) safe(function () { clearTimeout(trackedTimeouts.pop()); });'),
  'Task 3 can still perform old-account work beneath a repeat sign-in gate');
assert(task3.includes("window.addEventListener('mls:session-boundary', sessionBoundaryListener)") &&
  task3.includes("nodes.forEach(function (id) { if (id === 'mlsT3Css') return;") &&
  task3.includes("var tags = document.querySelectorAll('.t3p-tag')") &&
  task3.includes('restoreCalData(); clearSessionUi(); resetStatusState();') &&
  task3.includes('if (destroyed || !started) return;\n    safe(renderStrip);'),
  'Task 3 does not synchronously purge account-owned DOM/status/data at every session boundary');
assert(task3.includes("var app = $('appScreen');") &&
  task3.includes("app.style && app.style.display === 'none'") &&
  task3.includes('if (startupBusy()) { queueStart(80); return; }'),
  'Task 3 can treat a hidden signed-app route as visible or begin during the loader fade');

assert(!/\bsetInterval\s*\(/.test(realtime),
  'UP NOW restored permanent one/two-second polling');
assert(realtime.includes('_obs.observe(hero, { childList: true, subtree: true })') &&
  !realtime.includes('_obs.observe($(HERO) || document.documentElement'),
  'UP NOW observer is not confined to its hero subtree');
assert(realtime.includes('function clockDelay()') && realtime.includes('m + 31 - nm'),
  'UP NOW lost its appointment-boundary clock replacement');
assert(realtime.includes('wrapperChainHas(window._renderTodayPatients, "__mlsUnrGuard")'),
  'UP NOW can stack duplicate render guards around another wrapper');
assert(!realtime.includes('if (fn.__mlsWrapperDisposed || !_started) return orig.apply(this, arguments);') &&
  realtime.includes('installAutoPos(); installLoadNextUp(); installRenderGuard();') &&
  realtime.includes('if (_domReadyListener) { safe(function () { document.removeEventListener("DOMContentLoaded", _domReadyListener); })'),
  'UP NOW correctness is pass-through during hydration or heavy DOM work can resurrect beneath a repeat sign-in gate');
assert(realtime.includes('window.addEventListener("mls:session-boundary", _sessionBoundaryListener)') &&
  realtime.includes('var delta = (m + 31 - nm) * 60000 - intoMinute'),
  'UP NOW misses an already-visible gate boundary or can stay stale for a full extra minute');

assert(activeSelect.includes("document.removeEventListener('DOMContentLoaded', domReadyListener)") &&
  activeSelect.includes('if (wrappedCalLoadNextUp) wrappedCalLoadNextUp.__mlsWrapperDisposed = true;'),
  'active-select can resurrect after revert or leave a live stranded wrapper');
assert(!/\bsetInterval\s*\(/.test(activeSelect) &&
  activeSelect.includes("window.addEventListener('mls:loader-ready', loaderReadyListener, { once:true })") &&
  activeSelect.includes("window.addEventListener('mls:loader-start', loaderStartListener)") &&
  activeSelect.includes("window.addEventListener('mls:session-boundary', sessionBoundaryListener)"),
  'active-select still polls during hydration or cannot pause at an account boundary');

/* Task3 may restore duplicate rows only into the same live calendar array it
   normalized. Core replaces that array before session-boundary specifically so
   no retained Account-A reference can be repopulated. */
const restoreAt = task3.indexOf('function restoreCalData()');
const restoreEnd = task3.indexOf('function resetStatusState()', restoreAt);
assert(restoreAt >= 0 && restoreEnd > restoreAt, 'Task3 restoreCalData slice is missing');
const restoreSource = task3.slice(restoreAt, restoreEnd);
function runTask3Restore(replaced) {
  const old = [{ id: 'kept' }], removed = { id: 'old-account-duplicate' };
  const taskWindow = { _calAppts: old };
  const Cal = { _full: old, _removedDups: [removed], _dupCount: 1, _sig: 'old', _provIdx: { old: true } };
  if (replaced) { old.length = 0; taskWindow._calAppts = []; }
  vm.runInNewContext(restoreSource + '\nrestoreCalData();', {
    window: taskWindow, Cal,
    Array,
    safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  });
  return { old, current: taskWindow._calAppts, Cal, removed };
}
const liveRestore = runTask3Restore(false);
assert(liveRestore.old.includes(liveRestore.removed), 'Task3 lost reversible duplicate restoration within the same live session');
const replacedRestore = runTask3Restore(true);
assert.deepStrictEqual(replacedRestore.old, [], 'Task3 resurrected Account-A rows into a detached retained array');
assert.deepStrictEqual(replacedRestore.current, [], 'Task3 contaminated the new account calendar array');
assert.strictEqual(replacedRestore.Cal._removedDups.length, 0, 'Task3 retained old-account duplicate pointers after boundary');

/* Execute Task 3's first-use scheduler itself. A real input arriving before an
   idle callback must cancel that callback, restart the full quiet window, and
   coalesce startup to one reconciliation. Route reconciliation remains live
   after that one startup pass. */
const t3IdleAt = task3.indexOf('var tickTimer = null');
const t3IdleEnd = task3.indexOf('function onReady()', t3IdleAt);
assert(t3IdleAt >= 0 && t3IdleEnd > t3IdleAt, 'Task 3 first-use scheduler slice is missing');
let t3Now = 1000;
let t3Seq = 0;
let t3SharedBusy = 1000;
let t3InputPending = false;
const t3Timers = new Map();
const t3Idles = new Map();
const t3Window = {
  navigator: { scheduling: { isInputPending() { return t3InputPending; } } },
  __mlsDeferAsset: { stats() { return { lastBusy: t3SharedBusy }; } },
  requestIdleCallback(fn) { const id = ++t3Seq; t3Idles.set(id, { fn, cancelled: false }); return id; },
  cancelIdleCallback(id) { const idle = t3Idles.get(id); if (idle) idle.cancelled = true; }
};
const t3Context = vm.createContext({
  window: t3Window,
  document: { hidden: false },
  Date: { now() { return t3Now; } },
  Math, Number,
  setTimeout(fn, ms) { const id = ++t3Seq; t3Timers.set(id, { fn, due: t3Now + Number(ms || 0), ms: Number(ms || 0), cancelled: false }); return id; },
  clearTimeout(id) { const timer = t3Timers.get(id); if (timer) timer.cancelled = true; }
});
vm.runInContext(`
  var destroyed=false, started=true, ticks=0, listenerRemovals=0;
  function isFn(fn){ return typeof fn === 'function'; }
  function safe(fn,d){ try { return fn(); } catch(e) { return d; } }
  function tick(){ ticks++; }
  function viewShown(){ return true; }
  function removeFirstUseActivityListeners(){ listenerRemovals++; }
  ${task3.slice(t3IdleAt, t3IdleEnd)}
  firstUseLastBusy=Date.now();
  window.__t3IdleTest={
    start:scheduleFirstUseReconcile,
    activity:noteFirstUseActivity,
    route:function(){ scheduleTick(80); },
    ticks:function(){ return ticks; },
    listenerRemovals:function(){ return listenerRemovals; }
  };
`, t3Context, { filename: 'task3-first-use-idle.js' });
const t3Api = t3Window.__t3IdleTest;
function runT3Timers(at) {
  let ran = true;
  while (ran) {
    ran = false;
    const due = [...t3Timers.entries()].filter(([, timer]) => !timer.cancelled && timer.due <= at).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
    if (due) { t3Now = due[1].due; due[1].cancelled = true; due[1].fn(); ran = true; }
  }
  t3Now = at;
}
t3Api.start();
assert.strictEqual(t3Api.ticks(), 0, 'Task 3 reconciled before its first-use quiet window');
t3Now = 2000;
t3SharedBusy = 2000;
t3Api.activity();
runT3Timers(4499);
assert.strictEqual(t3Idles.size, 0, 'Task 3 did not restart the complete quiet window after input');
runT3Timers(4500);
const firstIdle = [...t3Idles.entries()].find(([, idle]) => !idle.cancelled);
assert(firstIdle, 'Task 3 did not request a real idle slice after the quiet window');
t3Now = 4550;
t3SharedBusy = 4550;
t3Api.activity();
assert.strictEqual(firstIdle[1].cancelled, true, 'Task 3 left its pending idle callback armed across new input');
runT3Timers(7050);
const secondIdle = [...t3Idles.entries()].find(([, idle]) => !idle.cancelled);
assert(secondIdle, 'Task 3 did not re-arm idle work after renewed input quiet');
secondIdle[1].cancelled = true;
secondIdle[1].fn({ timeRemaining() { return 12; } });
assert.strictEqual(t3Api.ticks(), 1, 'Task 3 startup did not coalesce to exactly one idle reconciliation');
assert.strictEqual(t3Api.listenerRemovals(), 1, 'Task 3 kept first-use input listeners after reconciliation began');
t3Api.route();
runT3Timers(7130);
assert.strictEqual(t3Api.ticks(), 2, 'Task 3 lost route-driven correctness after its deferred startup pass');

assert(connect.includes('feat_b18_qa.js') && connect.includes('20260808b18v14perf2'));
assert(connect.includes('feat_task3_frontsync.js') && connect.includes('20260808t3113perf2'));
assert(connect.includes("feat_mls_upnow_realtime.js?v='+(window.__MLS_AV||Date.now())"));
assert(staging.includes("feat_mls_upnow_realtime.js?v='+(window.__MLS_AV||Date.now())"));

/* Execute the actual b18 lifecycle in a synthetic secure-startup state. Its
   observer and registered work must remain dormant until loader-ready. */
const lifecycleAt = b18.indexOf('(function(){', b18.indexOf('One lifecycle for the bundle'));
const lifecycleEnd = b18.indexOf('var __mlsB18Q=window.__mlsB18QA;', lifecycleAt);
assert(lifecycleAt >= 0 && lifecycleEnd > lifecycleAt, 'b18 lifecycle slice is missing');

let seq = 0;
const timers = [];
let idle = null;
let observed = 0;
let disconnected = 0;
const windowListeners = new Map();
const targetListeners = new Map();
let targetAdds = 0;
let targetRemoves = 0;
const fakeWindow = {
  sfGateLoadingVisible: true,
  __mlsLoaderReadyAt: 0,
  addEventListener(type, fn, opts) {
    if (opts && opts.once) {
      const wrapped = function () { if (windowListeners.get(type) === wrapped) windowListeners.delete(type); return fn.apply(this, arguments); };
      wrapped.original = fn;
      windowListeners.set(type, wrapped);
    } else windowListeners.set(type, fn);
  },
  removeEventListener(type, fn) {
    const current = windowListeners.get(type);
    if (current === fn || (current && current.original === fn)) windowListeners.delete(type);
  },
  requestIdleCallback(fn) { idle = fn; return 7001; },
  cancelIdleCallback(id) { if (id === 7001) idle = null; }
};
const target = {
  addEventListener(type, fn) { targetAdds += 1; targetListeners.set(type, fn); },
  removeEventListener(type, fn) {
    targetRemoves += 1;
    if (targetListeners.get(type) === fn) targetListeners.delete(type);
  }
};
const documentElement = { classList: { contains(name) { return name === 'mls-secure-loading'; } } };
const context = {
  window: fakeWindow,
  document: { documentElement },
  MutationObserver: function MutationObserver() {
    this.observe = function () { observed += 1; };
    this.disconnect = function () { disconnected += 1; };
  },
  Promise,
  setTimeout(fn, ms) { const item = { id: ++seq, fn, ms, cancelled: false }; timers.push(item); return item.id; },
  clearTimeout(id) { const item = timers.find(timer => timer.id === id); if (item) item.cancelled = true; }
};
vm.runInNewContext(b18.slice(lifecycleAt, lifecycleEnd), context, { filename: 'b18-lifecycle.js' });
const Q = fakeWindow.__mlsB18QA;
let watcherRuns = 0;
Q.watch('synthetic', ['#synthetic'], function () { watcherRuns += 1; });
Q.listen(target, 'click', function () {});
assert.strictEqual(Q.active, false, 'b18 activated beneath the secure loader');
assert.strictEqual(observed, 0, 'b18 observer started beneath the secure loader');
assert.strictEqual(watcherRuns, 0, 'b18 initial watcher ran beneath the secure loader');
assert.strictEqual(targetListeners.has('click'), false,
  'b18 attached a dormant feature listener beneath the secure loader');
assert.strictEqual(targetAdds, 0, 'dormant Q.listen registration touched the event target');

const firstFallback = timers.find(timer => !timer.cancelled && timer.ms === 12000);
assert(firstFallback, 'b18 did not arm its bounded lost-event fallback');
firstFallback.fn();
assert.strictEqual(observed, 0, 'b18 fallback activated while the secure loader was still busy');
assert(timers.some(timer => !timer.cancelled && timer.ms === 1000),
  'b18 fallback did not recheck a still-busy startup gate');

const ready = windowListeners.get('mls:loader-ready');
assert.strictEqual(typeof ready, 'function', 'b18 did not arm the loader-ready handoff');
ready();
const racedDelay = timers.find(timer => !timer.cancelled && timer.ms === 180);
assert(racedDelay, 'b18 did not queue its first post-reveal activation');
const loaderStart = windowListeners.get('mls:loader-start');
assert.strictEqual(typeof loaderStart, 'function', 'b18 did not retain its repeat sign-in pause hook');
fakeWindow.__mlsLoaderReadyAt = 0;
fakeWindow.sfGateLoadingVisible = true;
loaderStart();
assert.strictEqual(racedDelay.cancelled, true, 'b18 did not cancel a start queued for the prior session');
const racedReady = windowListeners.get('mls:loader-ready');
assert.strictEqual(typeof racedReady, 'function', 'b18 once-listener race missed the next loader-ready handoff');
fakeWindow.sfGateLoadingVisible = false;
fakeWindow.__mlsLoaderReadyAt = 21;
racedReady();
const startDelay = timers.filter(timer => !timer.cancelled && timer.ms === 180).pop();
assert(startDelay, 'b18 did not preserve the post-reveal scheduling gap');
startDelay.fn();
assert.strictEqual(typeof idle, 'function', 'b18 did not yield heavy startup work to an idle slice');
idle();
assert.strictEqual(Q.active, true, 'b18 did not activate after loader-ready');
assert.strictEqual(observed, 1, 'b18 observer was not started exactly once');
assert.strictEqual(targetListeners.has('click'), true, 'b18 feature listeners did not attach after readiness');
assert.strictEqual(targetAdds, 1, 'b18 start attached a dormant listener more than once');

fakeWindow.__mlsLoaderReadyAt = 0;
fakeWindow.sfGateLoadingVisible = true;
loaderStart();
assert.strictEqual(Q.active, false, 'b18 stayed active beneath a repeat sign-in gate');
assert.strictEqual(targetListeners.has('click'), false, 'b18 pause left a feature listener active beneath repeat sign-in');
assert.strictEqual(targetRemoves, 1, 'b18 pause did not detach each active listener exactly once');
const secondReady = windowListeners.get('mls:loader-ready');
assert.strictEqual(typeof secondReady, 'function', 'b18 did not re-arm loader readiness after pause');
fakeWindow.sfGateLoadingVisible = false;
fakeWindow.__mlsLoaderReadyAt = 42;
secondReady();
const secondDelay = timers.filter(timer => !timer.cancelled && timer.ms === 180).pop();
assert(secondDelay, 'b18 did not queue its second post-reveal activation');
secondDelay.fn();
assert.strictEqual(typeof idle, 'function', 'b18 repeat activation did not yield to idle');
idle();
assert.strictEqual(Q.active, true, 'b18 did not reactivate after the repeat loader handoff');
assert.strictEqual(observed, 2, 'b18 observer was not restarted exactly once after repeat sign-in');
assert.strictEqual(targetListeners.has('click'), true, 'b18 restart did not reattach its dormant listener');
assert.strictEqual(targetAdds, 2, 'b18 restart duplicated or omitted the registered listener');

let pauseHookRuns = 0;
Q.onPause(function () { pauseHookRuns += 1; });
const oldSessionTimer = Q.later(function () {}, 45000);
const boundary = windowListeners.get('mls:session-boundary');
assert.strictEqual(typeof boundary, 'function', 'b18 did not retain its session-boundary pause hook');
fakeWindow.__mlsLoaderReadyAt = 0;
fakeWindow.sfGateLoadingVisible = true;
boundary();
assert.strictEqual(Q.active, false, 'b18 stayed active after an account boundary');
assert.strictEqual(pauseHookRuns, 1, 'b18 did not synchronously scrub registered session state');
assert.strictEqual(timers.find(timer => timer.id === oldSessionTimer).cancelled, true,
  'b18 left an old-session feature timer runnable');
assert.strictEqual(targetListeners.size, 0, 'b18 left feature listeners attached beneath the next sign-in gate');
assert.strictEqual(targetRemoves, 2, 'b18 account-boundary pause did not detach exactly one active listener');

const boundaryReady = windowListeners.get('mls:loader-ready');
assert.strictEqual(typeof boundaryReady, 'function', 'b18 account boundary did not arm the next start');
fakeWindow.sfGateLoadingVisible = false;
fakeWindow.__mlsLoaderReadyAt = 84;
boundaryReady();
const boundaryDelay = timers.filter(timer => !timer.cancelled && timer.ms === 180).pop();
assert(boundaryDelay, 'b18 account-boundary restart lost its post-reveal delay');
boundaryDelay.fn();
assert.strictEqual(typeof idle, 'function', 'b18 account-boundary restart did not yield to idle');
idle();
assert.strictEqual(Q.active, true, 'b18 did not restart after an account boundary');
assert.strictEqual(targetListeners.has('click'), true, 'b18 account-boundary restart left the registration dormant');
assert.strictEqual(targetAdds, 3, 'b18 account-boundary restart duplicated or omitted the feature listener');
Q.revert();
assert(disconnected >= 1, 'b18 revert did not disconnect its observer');
assert.strictEqual(targetListeners.size, 0, 'b18 revert left feature listeners attached');
assert.strictEqual(targetRemoves, 3, 'b18 active revert did not detach each registered listener exactly once');

console.log('PASS startup heavy-work deferral: durable handoff, one dormant b18 observer, scoped clicks, and event-driven UP NOW');

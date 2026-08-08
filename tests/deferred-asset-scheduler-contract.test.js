'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');
const calmSource = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_calm_shell.js'), 'utf8');
const marker = source.indexOf('/* Optional satellite scheduler.');
const start = source.indexOf(';(function(){', marker);
const end = source.indexOf('\n;(function(){try{var sched=', start);
assert(marker >= 0 && start >= 0 && end > start, 'optional satellite scheduler block is missing');

assert((source.match(/var sched=window\.__mlsDeferAsset\|\|window\.requestIdleCallback/g) || []).length >= 90,
  'not every previously idle-deferred satellite uses the serialized scheduler');
assert.strictEqual((source.match(/priority:0,owner:'__mls/g) || []).length, 8,
  'priority readiness is not tied to the Calm foundation and all seven dependent owner APIs');
assert.strictEqual((source.match(/var sched=window\.requestIdleCallback/g) || []).length, 0,
  'a deferred satellite can still join the native requestIdleCallback timeout stampede');
assert(source.includes("defer(appendReport,{timeout:2500})") && source.includes('window.__mlsProcReportQueued=1'),
  'the RVU-dependent delayed procedure-report append escapes scheduler ownership');
for (const asset of ['feat_mls_stop_confirm.js','mls-template-stdline.js','feat_mls_copilot_power.js','feat_mls_audio_capture.js','feat_mls_athena_follow.js']) {
  const positions = [
    source.indexOf('data-mls-asset="' + asset + '"'),
    source.indexOf('var A="' + asset + '"'),
    source.indexOf("var A='" + asset + "'")
  ].filter((position) => position >= 0);
  assert(positions.length >= 1, asset + ' loader locator is missing');
  const i = Math.min(...positions);
  const line = source.slice(source.lastIndexOf('\n', i) + 1, source.indexOf('\n', i));
  assert(line.includes('priority:0') && line.includes('s.async=false') && line.includes('return s;'),
    asset + ' must be scheduler-owned on the pre-interaction priority lane');
  assert(appSource.includes("'" + asset + "'"),
    asset + ' must remain in the secure-gate critical asset list');
}
assert(source.includes("listen(window,'mls:session-boundary',boundaryBusy)") &&
  source.includes("listen(document,'visibilitychange',visibilityChanged)") &&
  !source.includes('retryFromScripts') && !source.includes('retireScripts'),
  'the scheduler can poll hidden state or double-evaluate a removed/requeued dynamic script');
assert(source.includes('if(priorityInFlight) return -1;') &&
  source.includes('wait=Math.max(wait,1100-(at-lastBusy),40-(at-lastJobEnd))'),
  'a deadline or forced gate release can bypass fresh interaction/in-flight priority ownership');
assert(source.includes("priority:0,owner:'__mlsCalmShell',retireVersion:'calm-1.0.0',barrier:true") &&
  source.includes('if(priorityBarrierInFlight) return -1;') &&
  source.includes('if(barrier) priorityBarrierInFlight++'),
  'the Calm Shell is not an evaluation barrier ahead of dependent presentation owners');
assert.strictEqual((source.match(/requiresFoundation:true/g) || []).length, 7,
  'a dependent presentation owner can still evaluate after the Calm foundation fails');
assert(source.includes("fallback:'classic',asset:'feat_mls_calm_shell.js'") &&
  source.includes("healthy?'mls:deferred-assets-ready':'mls:deferred-assets-error'"),
  'foundation failure does not fail into Classic or optional errors can still publish a green ready event');
assert(!source.includes("localStorage.setItem('mlsCalmShell','0')"),
  'an automatic Calm load failure can still overwrite the user layout preference across later sessions');
assert((calmSource.match(/localStorage\.setItem\(STORE_KEY,\s*'0'\)/g) || []).length >= 2,
  'explicit user-selected Classic no longer persists through the Calm shell owner');

let clock = 0;
let sequence = 0;
let secure = true;
let idle = null;
let redesignReverts = 0;
let activeMutationObserver = null;
class MockMutationObserver {
  constructor() { this.records = []; }
  observe() { activeMutationObserver = this; }
  takeRecords() { const records = this.records.slice(); this.records.length = 0; return records; }
  disconnect() { if (activeMutationObserver === this) activeMutationObserver = null; }
}
const timers = new Map();
const windowListeners = new Map();
const documentListeners = new Map();
const add = (map, type, fn) => {
  if (!map.has(type)) map.set(type, []);
  map.get(type).push(fn);
};
const emit = (map, type) => (map.get(type) || []).slice().forEach(fn => fn({ type }));
const auth = { style: { display: 'none' } };
const app = { style: { display: 'block' } };
const document = {
  hidden: false,
  body: { classList: { remove() {} } },
  documentElement: {
    dataset: {},
    classList: { contains(name) { return name === 'mls-secure-loading' && secure; } },
    appendChild(node) { if (activeMutationObserver) activeMutationObserver.records.push({ addedNodes: [node] }); return node; }
  },
  getElementById(id) { return id === 'authScreen' ? auth : id === 'appScreen' ? app : null; },
  addEventListener(type, fn) { add(documentListeners, type, fn); }
};
const window = {
  sfGateLoadingVisible: true,
  __mlsRedesign: { installed: true, revert() { redesignReverts++; this.installed = false; } },
  MutationObserver: MockMutationObserver,
  addEventListener(type, fn) { add(windowListeners, type, fn); },
  dispatchEvent(event) { emit(windowListeners, event.type); },
  requestIdleCallback(fn) { idle = fn; return ++sequence; },
  cancelIdleCallback() { idle = null; }
};
const context = vm.createContext({
  window,
  document,
  MutationObserver: MockMutationObserver,
  localStorage: { values: new Map(), setItem(key, value) { this.values.set(String(key), String(value)); }, getItem(key) { return this.values.get(String(key)) || null; } },
  Event: class Event { constructor(type) { this.type = type; } },
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  Date: { now() { return clock; } },
  setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, due: clock + Math.max(0, ms || 0) }); return id; },
  clearTimeout(id) { timers.delete(id); }
});
vm.runInContext(source.slice(start, end), context, { filename: 'optional-satellite-scheduler.js' });
assert.strictEqual(typeof window.__mlsDeferAsset, 'function', 'serialized scheduler API was not installed');

function script(name) {
  const listeners = new Map();
  const node = {
    tagName: 'SCRIPT', src: '/' + name + '.js',
    addEventListener(type, fn) { add(listeners, type, fn); },
    emit(type) { emit(listeners, type); },
    removed: false
  };
  node.parentNode = { removeChild(target) { assert.strictEqual(target, node); node.removed = true; node.parentNode = null; } };
  return node;
}
function fireTimer() {
  const entries = [...timers.entries()].sort((a, b) => a[1].due - b[1].due || a[0] - b[0]);
  assert(entries.length, 'scheduler did not retain a wake timer');
  const [id, timer] = entries[0];
  timers.delete(id); clock = Math.max(clock, timer.due); timer.fn();
}
function reachIdle(max = 40) {
  for (let i = 0; i < max && typeof idle !== 'function'; i++) fireTimer();
  assert.strictEqual(typeof idle, 'function', 'scheduler did not request a quiet idle slice');
}
function fireIdle() {
  const fn = idle; assert.strictEqual(typeof fn, 'function', 'no idle callback was armed');
  idle = null; fn({ didTimeout: false, timeRemaining() { return 8; } });
}

const ran = [];
const foundation = script('calm-shell-foundation');
const priority = script('priority');
const one = script('one');
const two = script('two');
const three = script('three');
const four = script('four');
let foundationRuns = 0;
window.__mlsDeferAsset(() => { foundationRuns++; return foundation; }, { timeout: 1500, priority: 0, owner: '__mlsCalmShell', barrier: true });
window.__mlsDeferAsset(() => { ran.push('one'); return one; }, { timeout: 2500 });
window.__mlsDeferAsset(() => { ran.push('priority'); return priority; }, { timeout: 4000, priority: 0 });
window.__mlsDeferAsset(() => { ran.push('two'); return two; }, { timeout: 2500 });
window.__mlsDeferAsset(() => { ran.push('three'); return three; }, { timeout: 2500 });
window.__mlsDeferAsset(() => { ran.push('four'); return four; }, { timeout: 2500 });

fireTimer();
assert.deepStrictEqual(ran, [], 'an optional asset ran in the gate busy window');
fireTimer();
assert.strictEqual(foundationRuns, 1, 'the Calm foundation did not start first beneath the veil');
assert.deepStrictEqual(ran, [], 'a dependent presentation owner started beside the Calm foundation');
assert.strictEqual(window.__mlsDeferAsset.stats().priorityQueued, 2,
  'the barrier and queued dependent owner were not both retained in readiness');
assert.strictEqual(window.__mlsDeferAsset.stats().priorityBarrier, true,
  'the in-flight Calm foundation was not reported as the active priority barrier');
fireTimer();
assert.deepStrictEqual(ran, [], 'the barrier wake admitted a dependent owner before Calm evaluated');
window.__mlsCalmShell = { installed: true };
foundation.emit('load');
assert.strictEqual(window.__mlsDeferAsset.stats().priorityBarrier, false,
  'the real Calm load/evaluation event did not release the barrier');
fireTimer();
assert.deepStrictEqual(ran, ['priority'], 'priority presentation did not start promptly beneath the veil');
assert.strictEqual(window.__mlsDeferAsset.stats().priorityQueued, 1,
  'priority work was reported ready before its script load/evaluation completed');
assert([...timers.values()].some(timer => timer.due - clock === 10000),
  'priority script lacks its bounded stalled-network diagnostic');

priority.emit('load');
assert.strictEqual(window.__mlsDeferAsset.stats().priorityQueued, 0,
  'completed priority script remained in the readiness count');
fireTimer();
assert.strictEqual(timers.size, 0, 'normal-only queue polls repeatedly beneath the secure gate');
secure = false; window.sfGateLoadingVisible = false;
emit(windowListeners, 'mls:loader-ready');
reachIdle(); fireIdle();
assert.deepStrictEqual(ran, ['priority', 'one'], 'first normal asset did not wait for post-reveal quiet');

/* A second callback may not start while the first script is still in flight. */
clock += 5000;
assert.deepStrictEqual(ran, ['priority', 'one'], 'async script loads overlapped despite callback serialization');
one.emit('load');
reachIdle(); fireIdle();
assert.deepStrictEqual(ran, ['priority', 'one', 'two'], 'second normal asset did not resume after load + quiet');

two.emit('load');
emit(windowListeners, 'mls:active-patient-changed');
/* The deadlines are long expired, but fresh activity must still win. */
for (let i = 0; i < 4; i++) {
  clock += 300; emit(documentListeners, 'pointerdown'); fireTimer();
  assert.deepStrictEqual(ran, ['priority', 'one', 'two'], 'expired deadline disabled the interaction pause');
}
reachIdle(); fireIdle();
assert.deepStrictEqual(ran, ['priority', 'one', 'two', 'three'], 'normal work did not resume after a genuinely quiet window');
three.emit('load');

/* A retained queue is inert--not polled--on the signed-out credential screen. */
auth.style.display = 'flex'; app.style.display = 'none';
fireTimer();
assert.deepStrictEqual(ran, ['priority', 'one', 'two', 'three'], 'signed-out screen admitted a signed-app satellite');
assert.strictEqual(timers.size, 0, 'scheduler polls continuously while the user is signed out');

auth.style.display = 'none'; app.style.display = 'block'; secure = true; window.sfGateLoadingVisible = true;
emit(windowListeners, 'mls:loader-start');
fireTimer();
assert.deepStrictEqual(ran, ['priority', 'one', 'two', 'three'], 'repeat sign-in gate admitted normal optional work');
secure = false; window.sfGateLoadingVisible = false;
emit(windowListeners, 'mls:loader-ready');
reachIdle(); fireIdle();
assert.deepStrictEqual(ran, ['priority', 'one', 'two', 'three', 'four'], 'queue did not resume after repeat loader handoff');
four.emit('load');
assert.strictEqual(window.__mlsDeferAsset.stats().queued, 0, 'scheduler queue did not drain');
assert.strictEqual(window.__mlsDeferAsset.stats().active, false, 'scheduler retained a completed active script');

/* A prepared dynamic script cannot be canceled by removing its node. Keep the
   one admitted file owned until the browser reports its real completion, while
   the rest of the queue remains dormant on the credential screen. */
secure = false; window.sfGateLoadingVisible = false;
const boundaryNodes = [];
window.__mlsDeferAsset(() => { const node = script('boundary-' + boundaryNodes.length); boundaryNodes.push(node); return node; }, { timeout: 2500 });
reachIdle(); fireIdle();
assert.strictEqual(boundaryNodes.length, 1, 'boundary fixture did not start its first script');
auth.style.display = 'flex'; app.style.display = 'none';
emit(windowListeners, 'mls:session-boundary');
assert.strictEqual(boundaryNodes[0].removed, false, 'session boundary pretended node removal could cancel browser execution');
assert.strictEqual(window.__mlsDeferAsset.stats().active, true, 'session boundary released an admitted script before real completion');
assert.strictEqual(window.__mlsDeferAsset.stats().queued, 0, 'session boundary cloned/requeued an already admitted script');
boundaryNodes[0].emit('load');
assert.strictEqual(window.__mlsDeferAsset.stats().active, false, 'real boundary-era completion did not settle ownership');
while (timers.size) fireTimer();
assert.strictEqual(timers.size, 0, 'signed-out boundary retained a polling wake-up');

auth.style.display = 'none'; app.style.display = 'block'; secure = true; window.sfGateLoadingVisible = true;
emit(windowListeners, 'mls:loader-start');
secure = false; window.sfGateLoadingVisible = false; emit(windowListeners, 'mls:loader-ready');
assert.strictEqual(boundaryNodes.length, 1, 'boundary-era source was evaluated a second time');

/* A stalled normal script strands only optional loading. It must never be
   declared complete so a late evaluation can overlap its successor. */
const late = script('late-normal');
const afterLate = script('after-late');
window.__mlsDeferAsset(() => late, { timeout: 2500 });
window.__mlsDeferAsset(() => { ran.push('after-late'); return afterLate; }, { timeout: 2500 });
reachIdle(); fireIdle();
assert.strictEqual(window.__mlsDeferAsset.stats().active, true, 'timeout fixture did not become active');
clock += 20000;
assert.strictEqual(window.__mlsDeferAsset.stats().active, true, 'elapsed time faked completion of an uncancellable script');
assert(!ran.includes('after-late'), 'a successor started beside a stalled script');
late.emit('load');
reachIdle(); fireIdle();
assert(ran.includes('after-late'), 'successor did not resume after the real load event');
afterLate.emit('load');

secure = true; window.sfGateLoadingVisible = true; emit(windowListeners, 'mls:loader-start');
const latePriority = script('late-priority');
window.__mlsDeferAsset(() => latePriority, { timeout: 4000, priority: 0 });
while (window.__mlsDeferAsset.stats().priorityQueued && !window.__mlsDeferAsset.stats().active) fireTimer();
assert.strictEqual(window.__mlsDeferAsset.stats().priorityQueued, 1, 'priority timeout fixture was prematurely ready');
while (window.__mlsDeferAsset.stats().priorityErrors === 0) fireTimer();
assert.strictEqual(latePriority.removed, false, 'priority diagnostic pretended DOM removal canceled execution');
assert.strictEqual(window.__mlsDeferAsset.stats().priorityQueued, 1, 'stalled priority owner was reported ready before real completion');
const afterPriority = script('after-priority');
window.__mlsDeferAsset(() => { ran.push('after-priority'); return afterPriority; }, { timeout: 2500 });
secure = false; window.sfGateLoadingVisible = false; emit(windowListeners, 'mls:loader-ready');
fireTimer();
assert(!ran.includes('after-priority'), 'forced gate release overlapped a still-live priority script');
latePriority.emit('load');
assert.strictEqual(window.__mlsDeferAsset.stats().priorityQueued, 0, 'late priority load resurrected readiness accounting');
reachIdle(); fireIdle();
assert(ran.includes('after-priority'), 'normal queue did not resume after priority really settled');
afterPriority.emit('load');

/* Hidden documents are event-woken, not polled at ~8Hz. */
const hiddenNode = script('hidden');
document.hidden = true;
window.__mlsDeferAsset(() => { ran.push('hidden'); return hiddenNode; }, { timeout: 2500 });
emit(documentListeners, 'visibilitychange');
assert.strictEqual(timers.size, 0, 'hidden queue retained a recurring wake timer');
assert(!ran.includes('hidden'), 'hidden document admitted optional evaluation');
document.hidden = false; emit(documentListeners, 'visibilitychange');
reachIdle(); fireIdle();
assert(ran.includes('hidden'), 'visible event did not wake retained optional work');
hiddenNode.emit('load');
assert(window.__mlsDeferredAssetsReadyAt > 0, 'full optional queue drain did not publish durable readiness for exhaustive QA');
assert.strictEqual(window.__mlsDeferredAssetsStatus.ready, true, 'healthy drain did not publish an explicit green status');

/* A real optional load error is settled, not ready. Exhaustive QA must not
   mistake an empty queue for a completely installed product. */
let errorEvents = 0, settledEvents = 0;
window.addEventListener('mls:deferred-assets-error', () => { errorEvents++; });
window.addEventListener('mls:deferred-assets-settled', () => { settledEvents++; });
const optionalFailure = script('optional-failure');
window.__mlsDeferAsset(() => optionalFailure, { timeout: 2500, asset: 'optional-failure.js' });
reachIdle(); fireIdle();
optionalFailure.emit('error');
assert.strictEqual(window.__mlsDeferAsset.stats().errors, 1, 'normal optional script error was not counted');
assert.strictEqual(window.__mlsDeferAsset.stats().priorityErrors, 0, 'normal optional error polluted the priority counter');
assert.strictEqual(window.__mlsDeferredAssetsReadyAt, 0, 'failed optional drain published a green ready timestamp');
assert.strictEqual(window.__mlsDeferredAssetsStatus.ready, false, 'failed optional drain published a green status');
assert.strictEqual(errorEvents, 1, 'failed optional drain did not emit its explicit error event');
assert(settledEvents >= 1, 'failed optional drain did not emit a neutral settled event');

window.__mlsDeferAsset(() => { throw new Error('callback exploded'); }, { timeout: 2500, asset: 'callback-failure.js' });
reachIdle(); fireIdle();
assert.strictEqual(window.__mlsDeferAsset.stats().errors, 2, 'thrown optional callback was swallowed as successful readiness');
assert(window.__mlsDeferAsset.stats().errorJobs.some(name => /callback-failure\.js:load-error/.test(name)),
  'thrown optional callback omitted its exact asset from diagnostics');

/* Throwing after append is still a failed job, but the uncancellable script
   retains the evaluation lane until its real browser event. */
const appendedBeforeThrow = script('appended-before-throw');
const afterThrownAppend = script('after-thrown-append');
let afterThrownAppendRuns = 0;
window.__mlsDeferAsset(() => {
  document.documentElement.appendChild(appendedBeforeThrow);
  throw new Error('threw after append');
}, { timeout: 2500, asset: 'append-then-throw.js' });
window.__mlsDeferAsset(() => { afterThrownAppendRuns++; return afterThrownAppend; },
  { timeout: 2500, asset: 'after-append-throw.js' });
reachIdle(); fireIdle();
assert.strictEqual(window.__mlsDeferAsset.stats().active, true, 'append-then-throw released its live script immediately');
clock += 5000;
assert.strictEqual(afterThrownAppendRuns, 0, 'successor overlapped a script whose callback threw after append');
appendedBeforeThrow.emit('load');
reachIdle(); fireIdle();
assert.strictEqual(afterThrownAppendRuns, 1, 'successor did not resume after the real append-then-throw load event');
afterThrownAppend.emit('load');
assert.strictEqual(window.__mlsDeferAsset.stats().errors, 3, 'append-then-throw failure was not retained after real script completion');

/* If the presentation foundation itself fails, every dependent owner is
   skipped and the loader records a current-session Classic fallback without
   changing the user's persisted layout preference. */
secure = true; window.sfGateLoadingVisible = true; emit(windowListeners, 'mls:loader-start');
clock += 2000;
context.localStorage.setItem('mlsCalmShell', '1');
const failedFoundation = script('failed-calm-foundation');
let failedFoundationRuns = 0, dependentRuns = 0;
window.__mlsDeferAsset(() => { failedFoundationRuns++; return failedFoundation; },
  { timeout: 1500, priority: 0, owner: '__failedCalm', barrier: true, fallback: 'classic', asset: 'feat_mls_calm_shell.js' });
window.__mlsDeferAsset(() => { dependentRuns++; return script('must-not-run'); },
  { timeout: 1500, priority: 0, owner: '__dependent', requiresFoundation: true });
while (!failedFoundationRuns) fireTimer();
failedFoundation.emit('error');
while (window.__mlsDeferAsset.stats().priorityQueued) fireTimer();
assert.strictEqual(dependentRuns, 0, 'dependent presentation evaluated after its Calm foundation failed');
assert.strictEqual(context.localStorage.getItem('mlsCalmShell'), '1',
  'foundation failure changed the user layout preference instead of staying current-session only');
assert.strictEqual(window.__mlsPresentationFallback, 'classic', 'foundation failure did not expose Classic fallback state');
assert.strictEqual(document.documentElement.dataset.mlsPresentationFallback, 'classic', 'fallback state was absent from diagnostics');
assert.strictEqual(redesignReverts, 1, 'Classic fallback did not invoke the redesign owner\'s supported revert contract');
assert.strictEqual(Number(document.documentElement.dataset.mlsDeferredAssetErrors), window.__mlsDeferAsset.stats().errors,
  'asset-error diagnostics double-counted the priority classification');
assert.strictEqual(Number(document.documentElement.dataset.mlsDeferredPriorityErrors), window.__mlsDeferAsset.stats().priorityErrors,
  'priority-error diagnostics disagree with scheduler state');
assert(window.__mlsDeferAsset.stats().errorJobs.some(name => /feat_mls_calm_shell\.js:load-error/.test(name)),
  'foundation failure omitted its exact asset from diagnostics');

/* An owner-named presentation request that never emits load/error is retired
   at the bounded diagnostic. Its exact-version sentinel makes a late response
   hit the module's installed guard instead of evaluating after fallback. */
const hungFoundation = script('hung-calm-foundation');
let hungFoundationRuns = 0;
window.__mlsDeferAsset(() => { hungFoundationRuns++; return hungFoundation; }, {
  timeout: 1500, priority: 0, owner: '__hungCalm', retireVersion: 'calm-1.0.0',
  barrier: true, fallback: 'classic', asset: 'hung-calm-shell.js'
});
while (!hungFoundationRuns) fireTimer();
while (window.__mlsDeferAsset.stats().priorityQueued) fireTimer();
assert.strictEqual(window.__mlsDeferAsset.stats().active, false, 'hung owner retained the gate/evaluation lane forever');
assert.strictEqual(window.__hungCalm.version, 'calm-1.0.0', 'hung owner sentinel cannot satisfy the module\'s exact-version guard');
assert.strictEqual(window.__hungCalm.installed, false, 'hung owner sentinel falsely reported installation');
assert(window.__mlsDeferAsset.stats().errorJobs.some(name => /hung-calm-shell\.js:load-timeout/.test(name)),
  'hung presentation owner omitted its timeout from diagnostics');
const errorsBeforeLateHungLoad = window.__mlsDeferAsset.stats().errors;
hungFoundation.emit('load');
assert.strictEqual(window.__mlsDeferAsset.stats().errors, errorsBeforeLateHungLoad,
  'late event after owner retirement changed settled failure accounting');
assert.strictEqual(window.__mlsDeferAsset.stats().active, false,
  'late event after owner retirement resurrected scheduler ownership');

console.log('PASS deferred asset scheduler: honest async ownership, true interaction pause, serialized evaluation, and event-woken dormancy');

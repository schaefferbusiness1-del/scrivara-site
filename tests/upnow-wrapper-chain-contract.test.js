'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const activeSource = fs.readFileSync(path.join(root, 'feat_mls_upnow_activeselect.js'), 'utf8');
const realtimeSource = fs.readFileSync(path.join(root, 'feat_mls_upnow_realtime.js'), 'utf8');
const task3Source = fs.readFileSync(path.join(root, 'feat_task3_frontsync.js'), 'utf8');
const upnowSyncSource = fs.readFileSync(path.join(root, 'feat_mls_upnow_sync.js'), 'utf8');
const nextUpSource = fs.readFileSync(path.join(root, 'feat_nextup_connect.js'), 'utf8');
const nextUpVersionMatch = nextUpSource.match(/var VERSION = '([^']+)'/);
assert(nextUpVersionMatch, 'Next Up source no longer declares its release identity');
const nextUpVersion = nextUpVersionMatch[1];

function harness(readyState) {
  let sequence = 0;
  let baseCalls = 0;
  let observerStarts = 0;
  const timeouts = new Map();
  const intervals = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const add = (map, type, fn) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(fn);
  };
  const remove = (map, type, fn) => {
    const list = map.get(type) || [];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  };
  const hero = {
    hidden: false,
    style: { display: 'none' },
    getAttribute() { return null; },
    querySelectorAll() { return []; }
  };
  const document = {
    readyState: readyState || 'complete',
    hidden: false,
    documentElement: { classList: { contains() { return false; } } },
    getElementById(id) { return id === 'heroToday' ? hero : null; },
    addEventListener(type, fn) { add(documentListeners, type, fn); },
    removeEventListener(type, fn) { remove(documentListeners, type, fn); }
  };
  function baseLoad() { baseCalls += 1; return 'base'; }
  const window = {
    sfGateLoadingVisible: false,
    __mlsLoaderReadyAt: 0,
    currentView: 'patients',
    _heroTodayList: [],
    _calLoadNextUp: baseLoad,
    _heroAutoPos() { return 0; },
    _renderTodayPatients() {},
    addEventListener(type, fn) { add(windowListeners, type, fn); },
    removeEventListener(type, fn) { remove(windowListeners, type, fn); }
  };
  const context = vm.createContext({
    window,
    document,
    console: { debug() {}, warn() {}, error() {} },
    MutationObserver: function MutationObserver() {
      this.observe = function () { observerStarts += 1; };
      this.disconnect = function () {};
    },
    setTimeout(fn, ms) { const id = ++sequence; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn, ms) { const id = ++sequence; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); }
  });
  return {
    context,
    window,
    documentListeners,
    get baseCalls() { return baseCalls; },
    resetBaseCalls() { baseCalls = 0; },
    get intervalCount() { return intervals.size; },
    get observerStarts() { return observerStarts; }
  };
}

function loadActive(h) {
  vm.runInContext(activeSource, h.context, { filename: 'feat_mls_upnow_activeselect.js' });
}
function loadRealtime(h) {
  vm.runInContext(realtimeSource, h.context, { filename: 'feat_mls_upnow_realtime.js' });
}
function chainHas(fn, marker) {
  const seen = [];
  while (typeof fn === 'function' && seen.length < 32 && !seen.includes(fn)) {
    if (fn[marker] && !fn.__mlsWrapperDisposed) return true;
    seen.push(fn);
    fn = fn.__mlsUnrOrig || fn.__t3Orig || fn.__mlsUpNowOrig || fn.__mlsOrig || null;
  }
  return false;
}
function assertOneBaseCall(h, label) {
  h.resetBaseCalls();
  assert.doesNotThrow(() => h.window._calLoadNextUp(), label + ' recursed or threw');
  assert.strictEqual(h.baseCalls, 1, label + ' did not reach the base function exactly once');
  assert(chainHas(h.window._calLoadNextUp, '__mlsActiveSelectWrapped'), label + ' lost active-select behavior');
  assert(chainHas(h.window._calLoadNextUp, '__mlsUnrWrapped'), label + ' lost real-time behavior');
}

function hiddenRenderOwnerChain(marker, originMarker) {
  let baseCalls = 0;
  function base() { baseCalls += 1; return 'base'; }
  const owner = function () { return base.apply(this, arguments); };
  owner[marker] = true;
  owner[originMarker] = base;
  let top = owner;
  for (const link of ['__orig', '__t3Orig', '__mlsUnrOrig', '__mlsUpNowOrig', '__mlsOrig']) {
    const inner = top;
    const wrapper = function () { return inner.apply(this, arguments); };
    wrapper[link] = inner;
    top = wrapper;
  }
  top.__orig = top; // a co-wrapper cycle must not block the other origin path
  return { base, owner, top, get baseCalls() { return baseCalls; } };
}

/* The renderer is shared by several independently loaded features. Each guard
   must find an existing owner below every supported co-wrapper link instead of
   adding another full render traversal on every poll or reapply. */
{
  const chain = hiddenRenderOwnerChain('__mlsAuthoritativeScheduleGuard', '__orig');
  const document = {
    readyState: 'complete', body: {}, documentElement: {},
    getElementById() { return null; },
    addEventListener() {}, createElement() { return {}; }
  };
  const window = {
    _renderTodayPatients: chain.top, _calAppts: [], _heroTodayList: [],
    addEventListener() {}, sessionStorage: { getItem() { return null; } }
  };
  const context = vm.createContext({
    window, document, console: { debug() {}, warn() {}, error() {} }, Date,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}
  });
  vm.runInContext(nextUpSource, context, { filename: 'feat_nextup_connect.js' });
  assert.strictEqual(window._renderTodayPatients, chain.top,
    'Next Up added a duplicate renderer guard above a hidden existing owner');
  assert.strictEqual(window.__mlsNextUp.version, nextUpVersion,
    'Next Up API did not publish the exact version declared by the loaded module');
  window.__mlsNextUp._installRendererGuard();
  assert.strictEqual(window._renderTodayPatients, chain.top,
    'Next Up reapply added a duplicate renderer guard');
  window.__mlsNextUp.revert();
  assert.strictEqual(window._renderTodayPatients, chain.top,
    'Next Up claimed and reverted a co-wrapper it did not install');
}
{
  const chain = hiddenRenderOwnerChain('__mlsUpNowWrapped', '__mlsUpNowOrig');
  const visitView = { style: { display: 'none' } };
  const document = {
    readyState: 'complete',
    getElementById(id) { return id === 'visitView' ? visitView : null; },
    addEventListener() {}, removeEventListener() {}, createElement() { return {}; }
  };
  const window = {
    _renderTodayPatients: chain.top, _heroTodayList: [],
    addEventListener() {}, removeEventListener() {}
  };
  function MutationObserver() {
    this.observe = function () {};
    this.disconnect = function () {};
    this.takeRecords = function () { return []; };
  }
  const context = vm.createContext({
    window, document, MutationObserver,
    console: { debug() {}, warn() {}, error() {} },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}
  });
  vm.runInContext(upnowSyncSource, context, { filename: 'feat_mls_upnow_sync.js' });
  assert.strictEqual(window._renderTodayPatients, chain.top,
    'Up Now Sync added a duplicate renderer wrapper above a hidden existing owner');
  window.__mlsUpNowSync.reapply();
  assert.strictEqual(window._renderTodayPatients, chain.top,
    'Up Now Sync reapply added a duplicate renderer wrapper');
  assert.doesNotThrow(() => window._renderTodayPatients(),
    'the preserved Up Now renderer chain no longer reaches its base');
  assert.strictEqual(chain.baseCalls, 1,
    'the preserved Up Now renderer chain reached its base more than once');
}

/* Both asynchronous load orders must compose without the mutable-original cycle
   that previously made a Patients click recurse through more than a million DOM
   mutations. Both revert orders must also permit a clean reload. */
for (const scenario of [
  { name: 'active then realtime / active-first revert', loads: [loadActive, loadRealtime], reverts: ['active', 'realtime'] },
  { name: 'realtime then active / realtime-first revert', loads: [loadRealtime, loadActive], reverts: ['realtime', 'active'] }
]) {
  const h = harness('complete');
  scenario.loads.forEach(load => load(h));
  assertOneBaseCall(h, scenario.name + ' initial chain');

  for (const owner of scenario.reverts) {
    if (owner === 'active') h.window.__mlsUpNowActiveSelect.revert();
    else h.window.__mlsUpNowRealtime.revert();
  }

  h.resetBaseCalls();
  scenario.loads.slice().reverse().forEach(load => load(h));
  assertOneBaseCall(h, scenario.name + ' reloaded chain');
}

/* A stale once-listener can already be queued by a browser when revert runs.
   Calling that stale callback directly must still be harmless. */
{
  const h = harness('loading');
  const base = h.window._calLoadNextUp;
  loadActive(h);
  const staleReady = (h.documentListeners.get('DOMContentLoaded') || [])[0];
  assert.strictEqual(typeof staleReady, 'function', 'active-select did not register a named DOM-ready callback');
  h.window.__mlsUpNowActiveSelect.revert();
  staleReady();
  assert.strictEqual(h.window._calLoadNextUp, base, 'active-select resurrected its wrapper after revert');
  assert.strictEqual(h.intervalCount, 0, 'active-select resurrected its polling interval after revert');
}
{
  const h = harness('loading');
  const base = h.window._calLoadNextUp;
  loadRealtime(h);
  const staleReady = (h.documentListeners.get('DOMContentLoaded') || [])[0];
  assert.strictEqual(typeof staleReady, 'function', 'real-time did not register a named DOM-ready callback');
  h.window.__mlsUpNowRealtime.revert();
  staleReady();
  assert.strictEqual(h.window._calLoadNextUp, base, 'real-time resurrected its wrapper after revert');
  assert.strictEqual(h.observerStarts, 0, 'real-time resurrected its observer after revert');
}

{
  const h = harness('complete');
  loadRealtime(h);
  h.window.__mlsUpNowRealtime.revert();
  h.resetBaseCalls();
  h.window.__mlsUpNowRealtime.reapply();
  assert.strictEqual(h.window.__mlsUpNowRealtime.installed, true, 'real-time reapply did not reactivate its API');
  assert(chainHas(h.window._calLoadNextUp, '__mlsUnrWrapped'), 'real-time reapply did not reinstall its load guard');
  assert.doesNotThrow(() => h.window._calLoadNextUp(), 'real-time reapplied load guard threw');
  assert.strictEqual(h.baseCalls, 1, 'real-time reapplied load guard did not reach base exactly once');
}

assert(task3Source.includes('if (fn[marker] && !fn.__mlsWrapperDisposed) return true;'),
  'Task 3 reload still mistakes a stranded disposed wrapper for a live owner');
assert(task3Source.includes('if (w.__mlsWrapperDisposed || destroyed || !started) return cur.apply(self, args);'),
  'Task 3 calendar wrappers still execute old-account behavior after pause/revert');
assert(task3Source.includes('if (p[2]) p[2].__mlsWrapperDisposed = true;'),
  'Task 3 revert does not deactivate wrappers stranded beneath another owner');

console.log('PASS UP NOW wrapper chain: both load orders, both revert orders, reloads, and stale DOM-ready callbacks are safe');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const realtime = fs.readFileSync(path.join(root, 'feat_mls_upnow_realtime.js'), 'utf8');
const activeSelect = fs.readFileSync(path.join(root, 'feat_mls_upnow_activeselect.js'), 'utf8');

let secure = true;
let selected = null;
let baseLoadCalls = 0;
let timerSeq = 0;
let clock = 0;
const timers = new Map();
const windowListeners = new Map();
const documentListeners = new Map();

function addListener(map, type, fn, opts) {
  if (!map.has(type)) map.set(type, []);
  let listener = fn;
  if (opts && opts.once) {
    listener = function () { removeListener(map, type, listener); return fn.apply(this, arguments); };
    listener.original = fn;
  }
  map.get(type).push(listener);
}
function removeListener(map, type, fn) {
  const list = map.get(type) || [];
  const at = list.findIndex(item => item === fn || item.original === fn);
  if (at >= 0) list.splice(at, 1);
}
function emit(map, type) {
  (map.get(type) || []).slice().forEach(fn => fn({ type }));
}
function element(id) {
  return {
    id,
    value: '',
    textContent: '',
    hidden: false,
    style: { display: id === 'appScreen' ? 'block' : id === 'authScreen' ? 'none' : '' },
    getAttribute() { return null; },
    querySelectorAll() { return []; }
  };
}
const elements = new Map([
  ['heroToday', element('heroToday')],
  ['heroPtName', element('heroPtName')],
  ['heroPtDob', element('heroPtDob')],
  ['heroPullStatus', element('heroPullStatus')],
  ['appScreen', element('appScreen')],
  ['authScreen', element('authScreen')]
]);
const document = {
  readyState: 'complete',
  hidden: false,
  documentElement: { classList: { contains(name) { return name === 'mls-secure-loading' && secure; } } },
  getElementById(id) { return elements.get(id) || null; },
  addEventListener(type, fn, opts) { addListener(documentListeners, type, fn, opts); },
  removeEventListener(type, fn) { removeListener(documentListeners, type, fn); }
};
const window = {
  sfGateLoadingVisible: true,
  __mlsLoaderReadyAt: 0,
  currentView: 'visit',
  _heroTodayList: [
    { name: 'Early Patient', time: '08:00' },
    { name: 'Late Patient', time: '09:00' }
  ],
  _acctNowMinutes() { return 18 * 60; },
  _calApptMins(appt) { const p = String(appt.time).split(':'); return Number(p[0]) * 60 + Number(p[1]); },
  _heroAutoPos() { return 0; },
  _renderTodayPatients() {},
  _calLoadNextUp() {
    baseLoadCalls += 1;
    elements.get('heroPtName').value = 'Late Patient';
  },
  getPatients() { return [{ id: 'late', name: 'Late Patient' }]; },
  getActivePtId() { return null; },
  selectPatient(id) { selected = id; },
  addEventListener(type, fn, opts) { addListener(windowListeners, type, fn, opts); },
  removeEventListener(type, fn) { removeListener(windowListeners, type, fn); }
};
const context = vm.createContext({
  window,
  document,
  currentView: 'visit',
  console: { debug() {} },
  Date,
  Math,
  Promise,
  MutationObserver: function MutationObserver() { this.observe = function () {}; this.disconnect = function () {}; },
  setTimeout(fn, ms) { const id = ++timerSeq; timers.set(id, { fn, due: clock + Math.max(0, ms || 0) }); return id; },
  clearTimeout(id) { timers.delete(id); }
});

vm.runInContext(realtime, context, { filename: 'feat_mls_upnow_realtime.js' });
window._calLoadNextUp();
assert.strictEqual(baseLoadCalls, 0, 'past-all schedule hydration called the stale base auto-loader beneath the gate');
assert.strictEqual(elements.get('heroPtName').value, '', 'past-all hydration populated a stale patient name');
assert.strictEqual(elements.get('heroPullStatus').textContent, 'No more patients today.', 'past-all hydration did not publish the honest banner');

vm.runInContext(activeSelect, context, { filename: 'feat_mls_upnow_activeselect.js' });
secure = false;
window.sfGateLoadingVisible = false;
window.__mlsLoaderReadyAt = 1;
emit(windowListeners, 'mls:loader-ready');
while (true) {
  const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
  if (!next || next[1].due > 200) break;
  timers.delete(next[0]); clock = next[1].due; next[1].fn();
}
assert.strictEqual(elements.get('heroPtName').value, '', 'post-reveal lifecycle resurrected the stale past appointment');
assert.strictEqual(selected, null, 'active-select selected a stale past patient after reveal');

const clockAt = realtime.indexOf('function clockDelay()');
const clockEnd = realtime.indexOf('function scheduleClock()', clockAt);
assert(clockAt >= 0 && clockEnd > clockAt, 'clockDelay slice is missing');
function FakeDate() {}
FakeDate.prototype.getSeconds = function () { return 59; };
FakeDate.prototype.getMilliseconds = function () { return 0; };
const clockContext = {
  window: { _heroTodayList: [{ time: '10:00' }] },
  Date: FakeDate,
  Math,
  isFinite,
  safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
  nowMin() { return 10 * 60 + 30; },
  mins() { return 10 * 60; }
};
vm.runInNewContext(realtime.slice(clockAt, clockEnd) + '\nresult = clockDelay();', clockContext);
assert(clockContext.result <= 15000, 'minute-boundary clock can stay stale for nearly a full extra minute');

console.log('PASS UP NOW past-all secure-startup correctness and exact minute-boundary scheduling');

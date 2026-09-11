'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const box = fs.readFileSync(path.join(root, 'feat_mls_calbox_uniform.js'), 'utf8');
const dedupe = fs.readFileSync(path.join(root, 'feat_mls_caldedupe_render.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');

assert(box.includes("var VERSION = 'cb-1.1.0'"), 'Calendar box hidden-repaint version was not advanced');
assert(box.includes("window.__mlsCurrentView === 'calendar' && typeof window.renderCalendar === 'function'"),
  'Calendar box styling still repaints the hidden Calendar during Visit/login');

assert(dedupe.includes('var WRAPPED = ["renderCalendar", "calOpenDay"];'),
  'Calendar dedupe still scans appointments for provider-only check-in renders');
assert(!dedupe.includes('"renderCalCheckin"'), 'Calendar dedupe still wraps provider-only check-in rendering');
assert(dedupe.includes('if (window.__mlsCurrentView === "calendar") {') &&
  dedupe.includes('version: "caldedupe-1.1.0"'),
  'Calendar dedupe still performs its install repaint off-view');

/* BusyAll discovers global calls from inline handlers during click capture.
 * It may instrument async work, but it must leave a synchronous day-navigation
 * function stable because that function has no Promise-backed work to paint. */
const busyOpen = shell.indexOf('<!-- ===== busyall-1.0.0');
const busyScript = shell.indexOf('<script>', busyOpen);
const busyClose = shell.indexOf('</script>', busyScript);
assert(busyOpen >= 0 && busyScript > busyOpen && busyClose > busyScript, 'BusyAll source block is missing');
let clickCapture = null;
let selectedDay = '';
let calAssignments = 0;
const nativeOpen = function (day) { selectedDay = day; };
const win = { slowCalendarRead: async function () {} };
Object.defineProperty(win, 'calOpenDay', {
  configurable: true,
  get() { return nativeOpen; },
  set() { calAssignments++; }
});
const sandbox = {
  window: win,
  document: {
    addEventListener(name, fn, capture) { if (name === 'click' && capture === true) clickCapture = fn; },
    removeEventListener() {},
    getElementById() { return null; }
  },
  setTimeout() { return 1; }, clearTimeout() {}, clearInterval() {},
  Date, Promise
};
vm.createContext(sandbox);
vm.runInContext(shell.slice(busyScript + '<script>'.length, busyClose), sandbox);
assert.strictEqual(typeof clickCapture, 'function', 'BusyAll capture listener did not install');
function control(handler) {
  return {
    nodeType: 1, parentNode: sandbox.document,
    hasAttribute(name) { return name === 'onclick'; },
    getAttribute(name) { return name === 'onclick' ? handler : null; }
  };
}
clickCapture({ target: control("calOpenDay('2026-10-14')") });
assert.strictEqual(calAssignments, 0, 'month-cell capture replaced the synchronous day opener');
win.calOpenDay('2026-10-14');
assert.strictEqual(selectedDay, '2026-10-14', 'synchronous day opener was not stable after capture');

clickCapture({ target: control('slowCalendarRead()') });
assert.strictEqual(win.slowCalendarRead.__mlsBusyAll, true,
  'excluding the synchronous day opener disabled instrumentation for async calendar work');

console.log('PASS hidden Calendar repaint: styling/dedupe wait for Calendar, check-in skips appointment scans, and synchronous navigation stays outside BusyAll');

'use strict';

/* Calendar chrome is identical once Calendar opens, but it must not construct
 * or observe that hidden screen while the signed-in Visit workspace boots. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_calendar_exact.js'), 'utf8');
let domReads = 0;
let observerCreates = 0;
let observerDisconnects = 0;
let intervalCreates = 0;
let intervalClears = 0;
let timeoutCreates = 0;
const listeners = {};

const windowObject = {
  __mlsCurrentView: 'visit',
  addEventListener(name, fn) { listeners[name] = fn; },
  removeEventListener(name, fn) { if (listeners[name] === fn) delete listeners[name]; }
};
const documentObject = {
  readyState: 'complete',
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
  querySelector(selector) {
    return selector === 'script[src*="mls-connect.staging.js"]' ? {} : null;
  },
  getElementById() { domReads++; return null; },
  createElement() { throw new Error('hidden Visit boot must not construct Calendar DOM'); }
};
function MutationObserver() {
  observerCreates++;
  this.observe = function () {};
  this.disconnect = function () { observerDisconnects++; };
}

const context = {
  window: windowObject,
  document: documentObject,
  location: { pathname: '/ScribeFlow.html' },
  MutationObserver,
  Date,
  setInterval() { intervalCreates++; return intervalCreates; },
  clearInterval() { intervalClears++; },
  setTimeout() { timeoutCreates++; return timeoutCreates; },
  clearTimeout() {}
};
vm.runInNewContext(source, context, { filename: 'feat_mls_calendar_exact.js' });

assert(windowObject.__mlsCx && windowObject.__mlsCx.installed, 'Calendar API did not install during Visit boot');
assert.strictEqual(domReads, 0, 'hidden Visit boot touched Calendar DOM');
assert.strictEqual(observerCreates, 0, 'hidden Visit boot created a Calendar observer');
assert.strictEqual(intervalCreates, 0, 'hidden Visit boot started Calendar repair passes');
assert.strictEqual(timeoutCreates, 0, 'hidden Visit boot scheduled Calendar work');
assert.strictEqual(typeof listeners['mls:view-changed'], 'function', 'Calendar lifecycle listener did not install');

windowObject.__mlsCurrentView = 'calendar';
listeners['mls:view-changed']({ detail: { previousView: 'visit', view: 'calendar' } });
assert(domReads > 0, 'opening Calendar did not run its normal construction path');
assert.strictEqual(observerCreates, 1, 'opening Calendar did not create exactly one observer');
assert.strictEqual(intervalCreates, 1, 'opening Calendar did not start its bounded repair passes');

windowObject.__mlsCurrentView = 'visit';
listeners['mls:view-changed']({ detail: { previousView: 'calendar', view: 'visit' } });
assert(observerDisconnects > 0, 'leaving Calendar did not disconnect its observer');
assert(intervalClears > 0, 'leaving Calendar did not stop its repair passes');

console.log('PASS Calendar activation lifecycle: Visit boot stays inert; Calendar opens with one bounded owner');

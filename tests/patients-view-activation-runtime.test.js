'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_patients_exact.js'), 'utf8');
let domReads = 0;
let observerCreates = 0;
let observerDisconnects = 0;
let timeoutCreates = 0;
const listeners = {};

const windowObject = {
  __mlsCurrentView: 'visit',
  addEventListener(name, fn) { listeners[name] = fn; },
  removeEventListener(name, fn) {
    if (listeners[name] === fn) delete listeners[name];
  }
};
const documentObject = {
  readyState: 'complete',
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
  querySelector(selector) {
    return selector === 'script[src*="mls-connect.staging.js"]' ? {} : null;
  },
  getElementById() {
    domReads++;
    return null;
  },
  createElement() {
    throw new Error('Patients exact must not create DOM while another view is active');
  }
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
  setTimeout() { timeoutCreates++; return timeoutCreates; },
  clearTimeout() {}
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_patients_exact.js' });

assert(windowObject.__mlsPx && windowObject.__mlsPx.installed, 'Patients exact API was not installed');
assert.strictEqual(domReads, 0, 'Patients exact touched hidden Patients DOM during Visit boot');
assert.strictEqual(observerCreates, 0, 'Patients exact created an observer before Patients opened');
assert.strictEqual(timeoutCreates, 0, 'Patients exact started background timers before Patients opened');
assert.strictEqual(typeof listeners['mls:view-changed'], 'function', 'Patients exact did not subscribe to the canonical view lifecycle');

windowObject.__mlsCurrentView = 'patients';
listeners['mls:view-changed']({ detail: { view: 'patients' } });
assert(domReads > 0, 'Patients exact did not reconcile when Patients opened');
assert.strictEqual(observerCreates, 1, 'Patients exact should create one scoped observer when Patients opens');
assert.strictEqual(timeoutCreates, 0, 'Initial Patients activation should reconcile synchronously without a timer');

windowObject.__mlsCurrentView = 'visit';
listeners['mls:view-changed']({ detail: { view: 'visit' } });
assert(observerDisconnects > 0, 'Patients exact did not disconnect its observer after leaving Patients');

console.log('PASS Patients exact remains dormant off-view and activates only for Patients');

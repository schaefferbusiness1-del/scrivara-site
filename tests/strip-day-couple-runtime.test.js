'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_strip_day_couple.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
new Function(source); // syntax gate

assert(connect.includes("feat_mls_strip_day_couple.js';"), 'sdc satellite is not injected by mls-connect.js');
assert(connect.includes('?v=20260717sdc100'), 'sdc satellite injection is not cache-busted');

function el(extra) {
  const node = Object.assign({
    id: '', className: '', innerHTML: '', textContent: '', style: {},
    offsetParent: {}, parentNode: null, children: [],
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { c.parentNode = node; node.children.push(c); },
    insertBefore(c) { c.parentNode = node; node.children.push(c); registry[c.id] = c; },
    remove() { registry[node.id] = null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }
  }, extra || {});
  return node;
}

const d = new Date();
const todayKey = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
const otherDay = '2099-01-05';

const ezPt = el({ textContent: 'Stephen Michael Buchanan' });
const ezWrap = el({ id: 'ez3Wrap' });
const dsList = el({ id: 'mlsDsList' });
const listParent = el({});
dsList.parentNode = listParent;
listParent.insertBefore = function (c) { registry[c.id] = c; c.parentNode = listParent; };
const registry = { ez3Wrap: ezWrap, mlsDsList: dsList };

const listeners = {};
const document = {
  readyState: 'complete',
  body: el({}), head: el({}), documentElement: el({}),
  getElementById(id) { return registry[id] || null; },
  querySelector(sel) { return sel === '#ez3Wrap .ez3-pt' ? ezPt : null; },
  createElement() { return el({}); },
  addEventListener(type, fn) { listeners['d:' + type] = fn; },
  removeEventListener() {}
};

const patients = [
  { id: 'PT-STEPHEN', name: 'Stephen Michael Buchanan', dob: '10/26/1956' },
  { id: 'PT-AARON', name: 'Aaron Stone', dob: '01/02/1970' }
];
const appts = [
  { id: 901, patient_external_id: 'PT-AARON', name: 'Aaron Stone', dob: '1970-01-02', day_local: todayKey, time_display: '11:20 AM' },
  { id: 902, patient_external_id: 'PT-STEPHEN', name: 'Stephen Michael Buchanan', dob: '1956-10-26', day_local: todayKey, time_display: '9:00 AM' }
];

let active = patients[1]; // header says Aaron, workspace shows Stephen -> drift
const starts = [], selects = [];

const window = {
  _calAppts: appts,
  getPatients: () => patients,
  activePatient: () => active,
  selectPatient(id) { selects.push(String(id)); active = patients.find(p => p.id === id) || active; },
  __mlsEasyV32: { remote: { startVisitFor(id) { starts.push(String(id)); return true; } } },
  __mlsCrossDayContext: {
    installed: true,
    current: () => null,
    openAppointment(a) { window.__opened = a; return true; },
    _test: {
      selectedDay: () => otherDay,
      appointmentsForDay: () => [
        { key: 'k1', candidates: [{ id: 1, name: 'Weekend Person', time_display: '8:30 AM', day_local: otherDay }] },
        { key: 'k2', candidates: [{ id: 2, name: 'Second Guy', time_display: '9:15 AM', day_local: otherDay }] }
      ]
    }
  },
  requestAnimationFrame(fn) { fn(); return 1; },
  addEventListener(type, fn) { listeners['w:' + type] = fn; },
  removeEventListener() {},
  dispatchEvent() {}
};
window.window = window;

class MutationObserver { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} }

const context = { window, document, MutationObserver, Date, Object, Array, String, Math, console, setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_strip_day_couple.js' });

const api = window.__mlsStripDayCouple;
assert(api && api.installed && api.version === 'sdc-1.0.0', 'strip/day couple owner did not install');

// helper sanity
assert.strictEqual(api._test.shortName('Stephen Michael Buchanan'), 'Stephen B.', 'short chip name mismatch');
assert.strictEqual(api._test.t12({ time_display: '9:00 AM' }), '9:00 AM', '12h passthrough mismatch');
assert.strictEqual(api._test.workspaceName(), 'stephen michael buchanan', 'workspace name reader failed');

// top -> workspace coupling: switching header to Aaron re-selects his one today appointment
active = patients[1];
listeners['w:mls:active-patient-changed']({ detail: { patientId: 'PT-AARON' } });
assert.deepStrictEqual(starts, ['901'], 'active-patient change did not re-select the matching today appointment');

// exact matching only: two same-day rows for one patient must not auto-select
appts.push({ id: 903, patient_external_id: 'PT-AARON', name: 'Aaron Stone', dob: '1970-01-02', day_local: todayKey, time_display: '2:00 PM' });
listeners['w:mls:active-patient-changed']({ detail: { patientId: 'PT-AARON' } });
assert.strictEqual(starts.length, 1, 'ambiguous same-day appointments must not auto-select');
appts.pop();

// non-today chip strip renders from the cross-day groups
api.refresh();
const strip = registry.mlsSdcQuick;
assert(strip, 'non-today chip strip was not rendered');
assert(strip.className.indexOf('ez3-quick') === 0, 'strip does not reuse the ez3-quick styling');
assert(strip.innerHTML.indexOf('Weekend P.') !== -1 && strip.innerHTML.indexOf('Second G.') !== -1, 'strip chips missing day appointments');
assert(strip.innerHTML.indexOf('8:30 AM') !== -1, 'strip chip missing time label');
assert(strip.innerHTML.indexOf('data-sdc-i') !== -1, 'strip chips are not wired for exact open');

// strip is removed again when the selected day is today
window.__mlsCrossDayContext._test.selectedDay = () => todayKey;
api.refresh();
assert(!registry.mlsSdcQuick, 'strip must not duplicate the native today strip');

console.log('strip-day-couple-runtime: all assertions passed');

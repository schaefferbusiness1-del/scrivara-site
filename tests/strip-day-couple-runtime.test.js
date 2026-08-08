'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_strip_day_couple.js'), 'utf8');
const connectSource = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
new Function(source); // syntax gate

assert(source.includes('VERSION = "sdc-2.0.2"'), 'presentation-free sdc-2.0.2 release marker is missing');
assert(connectSource.includes("?v=20260808sdc202perf1"), 'sdc-2.0.2 is not loaded through a fresh immutable asset URL');
assert(!/\.id\s*=\s*["']mlsSdcQuick/.test(source), 'feature still builds the removed second patient strip');
assert(!source.includes('mlsDsList .ds-row'), 'feature still depends on the removed alternate-day list');
assert(!/new\s+MutationObserver/.test(source), 'feature must not synthesize UI from DOM mutations');
assert(!/setInterval\s*\(/.test(source), 'feature must not passively poll or activate patients');
assert(!source.includes('.pullDay('), 'feature must never initiate a schedule pull');
assert(!source.includes('mlsAppSearchOpenPatient'), 'feature must never navigate Athena directly');
assert(!source.includes('_athenaSetVisitBinding'), 'binding ownership must remain in cross-day context');

// Backend asset refreshes reuse the live document.  Replace sdc-1.0.0 and its
// stale script marker so its observer/interval cannot keep recreating a second
// non-today patient strip after the one-workspace release is loaded.
{
  const loaderStart = connectSource.indexOf(";(function(){try{\n  var A='feat_mls_strip_day_couple.js'");
  const loaderEnd = connectSource.indexOf("\n;(function(){try{var A='feat_mls_premium_gate.js'", loaderStart);
  assert(loaderStart >= 0 && loaderEnd > loaderStart, 'could not isolate the sdc hot-refresh loader');
  const loader = connectSource.slice(loaderStart, loaderEnd);
  const removed = [];
  const parent = { removeChild(node) { removed.push(node.label); node.parentNode = null; } };
  const staleScript = { label: 'stale-script', parentNode: parent };
  const nodes = new Map(['mlsSdcQuick', 'mlsSdcStyle'].map(id => [id, { label: id, parentNode: parent }]));
  let reverted = 0;
  const appended = [];
  const body = { appendChild(node) { appended.push(node); node.parentNode = this; return node; } };
  const context = {
    window: { __mlsStripDayCouple: { installed: true, version: 'sdc-1.0.0', revert() { reverted += 1; } } },
    document: {
      body, head: null, documentElement: body,
      querySelectorAll(selector) {
        return selector === 'script[data-mls-asset="feat_mls_strip_day_couple.js"]' ? [staleScript] : [];
      },
      getElementById(id) { return nodes.get(id) || null; },
      createElement(tag) {
        return { tagName: tag, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(loader, context, { filename: 'mls-connect.js#sdc-hot-refresh-loader' });
  assert.strictEqual(reverted, 1, 'the b419 sdc owner was not reverted exactly once');
  assert.strictEqual(context.window.__mlsStripDayCouple, undefined, 'the b419 sdc owner survived loader replacement');
  assert.deepStrictEqual(removed.sort(), ['mlsSdcQuick', 'mlsSdcStyle', 'stale-script'].sort(),
    'the loader left the duplicate strip, style, or stale marker behind');
  assert.strictEqual(appended.length, 1, 'the current sdc asset was not loaded exactly once');
  assert.strictEqual(appended[0].src, 'feat_mls_strip_day_couple.js?v=20260808sdc202perf1');
  assert.strictEqual(appended[0].attributes['data-mls-asset'], 'feat_mls_strip_day_couple.js');
}

// Direct satellite evaluation has the same version-aware replacement path.
{
  const preludeStart = source.indexOf('  var prior = null;');
  const preludeEnd = source.indexOf('\n\n  var disposed', preludeStart);
  assert(preludeStart >= 0 && preludeEnd > preludeStart, 'could not isolate the sdc owner-replacement prelude');
  const prelude = source.slice(preludeStart, preludeEnd);
  const removed = [];
  const parent = { removeChild(node) { removed.push(node.label); node.parentNode = null; } };
  const nodes = new Map(['mlsSdcQuick', 'mlsSdcStyle'].map(id => [id, { label: id, parentNode: parent }]));
  let reverted = 0;
  const context = {
    NS: '__mlsStripDayCouple', VERSION: 'sdc-2.0.2',
    window: { __mlsStripDayCouple: { installed: true, version: 'sdc-1.0.0', revert() { reverted += 1; } } },
    document: { getElementById(id) { return nodes.get(id) || null; } }
  };
  vm.createContext(context);
  vm.runInContext(`(function(){${prelude}})();`, context, { filename: 'feat_mls_strip_day_couple.js#hot-refresh-prelude' });
  assert.strictEqual(reverted, 1, 'direct sdc refresh did not revert the prior owner');
  assert.strictEqual(context.window.__mlsStripDayCouple, undefined, 'direct sdc refresh left the prior owner installed');
  assert.deepStrictEqual(removed.sort(), ['mlsSdcQuick', 'mlsSdcStyle'].sort(),
    'direct sdc refresh left the duplicate strip or style behind');
}

function el(extra) {
  const node = Object.assign({
    id: '', offsetParent: {}, parentNode: null,
    closest() { return null; }
  }, extra || {});
  return node;
}

const today = '2026-07-19';
const friday = '2026-07-24';
let selectedDay = today;

const patients = [
  { id: 'PT-AARON', name: 'Aaron Stone', dob: '01/02/1970' },
  { id: 'PT-STEPHEN', name: 'Stephen Michael Buchanan', dob: '10/26/1956' }
];
const rowsByDay = {};
rowsByDay[today] = [
  { id: 901, patient_external_id: 'PT-AARON', appointment_id: 'A-901', name: 'Aaron Stone', dob: '1970-01-02', appt_date: today, time_display: '11:20 AM' },
  { id: 902, patient_external_id: 'PT-STEPHEN', appointment_id: 'A-902', name: 'Stephen Michael Buchanan', dob: '1956-10-26', appt_date: today, time_display: '9:00 AM' }
];
rowsByDay[friday] = [
  { id: 951, patient_external_id: 'ATHENA-77', appointment_id: 'A-951', name: 'Aaron Stone', dob: '1970-01-02', appt_date: friday, provider: 'Matthew Schaeffer, MD', time_display: '8:30 AM' }
];

const registry = {
  ez3Wrap: el({ id: 'ez3Wrap' }),
  mlsSdcQuick: el({ id: 'mlsSdcQuick' }),
  mlsSdcStyle: el({ id: 'mlsSdcStyle' })
};
registry.mlsSdcQuick.parentNode = { removeChild(node) { registry[node.id] = null; } };
registry.mlsSdcStyle.parentNode = { removeChild(node) { registry[node.id] = null; } };

const listeners = {};
const document = {
  readyState: 'complete',
  getElementById(id) { return registry[id] || null; },
  addEventListener(type, fn) { listeners['d:' + type] = fn; },
  removeEventListener(type, fn) { if (listeners['d:' + type] === fn) delete listeners['d:' + type]; }
};

let active = patients[0];
let snapshot = { day: today, active: { id: 902, name: 'Stephen Michael Buchanan', dob: '1956-10-26' } };
const starts = [], opens = [], selects = [], dsRowsCalls = [];

const window = {
  _acctTodayKey: () => today,
  __mlsDaySwitch: {
    installed: true,
    currentDay: () => selectedDay,
    rowsFor(day) { dsRowsCalls.push(day); return (rowsByDay[day] || []).slice(); }
  },
  __mlsEasyV32: {
    remote: {
      snapshot: () => snapshot,
      startVisitFor(id, options) { starts.push({ id: String(id), record: !!(options && options.record) }); snapshot = { day: selectedDay, active: { id: id } }; return true; }
    }
  },
  __mlsCrossDayContext: {
    installed: true,
    current: () => null,
    openAppointment(row, action) { opens.push({ row, action }); snapshot = { day: selectedDay, active: { id: row.id } }; return true; }
  },
  getPatients: () => patients,
  activePatient: () => active,
  selectPatient(id) { selects.push(String(id)); active = patients.filter(p => p.id === id)[0] || active; },
  addEventListener(type, fn) { listeners['w:' + type] = fn; },
  removeEventListener(type, fn) { if (listeners['w:' + type] === fn) delete listeners['w:' + type]; }
};
window.window = window;

const context = {
  window, document, Date, Object, Array, String, Math, console,
  setTimeout(fn) { fn(); return 1; }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_strip_day_couple.js' });

const api = window.__mlsStripDayCouple;
assert(api && api.installed && api.version === 'sdc-2.0.2', 'single-strip coupling owner did not install');
assert.strictEqual(registry.mlsSdcQuick, null, 'legacy duplicate strip was not removed');
assert.strictEqual(registry.mlsSdcStyle, null, 'legacy duplicate-strip style was not removed');

// DaySwitch is the sole selected-day/row authority.
assert.strictEqual(api._test.currentDay(), today, 'selected day did not come from DaySwitch');
assert.strictEqual(api._test.selectedRows().length, 2, 'selected-day exact rows were not read from DaySwitch');
assert(dsRowsCalls.every(day => day === selectedDay), 'rowsFor was called for a day other than currentDay');

// Header -> Today workspace: exact one-row match uses the native Easy path.
active = patients[0];
snapshot = { day: today, active: { id: 902 } };
listeners['w:mls:active-patient-changed']({ detail: { patientId: 'PT-AARON' } });
assert.deepStrictEqual(starts, [{ id: '901', record: false }], 'Today did not use Easy.remote.startVisitFor');
assert.strictEqual(opens.length, 0, 'Today incorrectly used the cross-day binding path');

// Another selected date: exact name+DOB fallback routes only through XDC.
selectedDay = friday;
active = patients[0];
snapshot = { day: friday, active: null };
listeners['w:mls:active-patient-changed']({ detail: { patientId: 'PT-AARON' } });
assert.strictEqual(starts.length, 1, 'non-today selection bypassed XDC and called Easy directly');
assert.strictEqual(opens.length, 1, 'non-today exact appointment did not route through XDC');
assert.strictEqual(String(opens[0].row.id), '951', 'XDC received the wrong selected-day appointment');
assert.strictEqual(opens[0].action, undefined, 'header coupling unexpectedly requested a clinical action');

// Duplicate exact rows fail closed: no direct activation and no XDC opener.
rowsByDay[friday].push({ id: 952, patient_external_id: 'ATHENA-77', appointment_id: 'A-952', name: 'Aaron Stone', dob: '1970-01-02', appt_date: friday, time_display: '2:00 PM' });
snapshot = { day: friday, active: null };
listeners['w:mls:active-patient-changed']({ detail: { patientId: 'PT-AARON' } });
assert.strictEqual(starts.length, 1, 'ambiguous rows activated through Easy');
assert.strictEqual(opens.length, 1, 'ambiguous rows activated through XDC');
rowsByDay[friday].pop();

// Workspace -> header: a native quick-strip click aligns one exact chart.
selectedDay = today;
active = patients[0];
snapshot = { day: today, active: { id: 902 } };
const nativeChip = { closest(selector) { return selector.indexOf('#ez3Quick [data-q]') !== -1 ? this : null; } };
listeners['d:click']({ target: nativeChip });
assert.deepStrictEqual(selects, ['PT-STEPHEN'], 'native quick-strip selection did not align the active-patient header');

// Missing DaySwitch row API is a hard stop, never an _calAppts fallback.
const savedRowsFor = window.__mlsDaySwitch.rowsFor;
window.__mlsDaySwitch.rowsFor = null;
active = patients[0]; snapshot = { day: today, active: null };
assert.strictEqual(api._test.coupleHeaderToWorkspace(), false, 'missing selected-day authority did not fail closed');
assert.strictEqual(starts.length, 1, 'missing DaySwitch authority still activated a patient');
window.__mlsDaySwitch.rowsFor = savedRowsFor;

api.revert();
assert(!window.__mlsStripDayCouple, 'revert did not release feature ownership');
assert(!listeners['w:mls:active-patient-changed'] && !listeners['d:click'], 'revert left listeners installed');

console.log('strip-day-couple-runtime: all assertions passed');

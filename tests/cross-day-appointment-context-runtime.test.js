'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_cross_day_context.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
new Function(source); // syntax gate

function classes() {
  const values = new Set();
  return {
    add(v) { values.add(v); }, remove(v) { values.delete(v); },
    toggle(v, on) { if (on) values.add(v); else values.delete(v); },
    contains(v) { return values.has(v); }
  };
}

const label = { textContent: 'Fri, Jul 17' };
const dsList = { querySelectorAll() { return []; } };
const ezBody = { classList: classes() };
const body = { classList: classes(), appendChild() {}, querySelector() { return null; } };
const head = { appendChild(node) { node.parentNode = head; }, removeChild() {} };
const elements = { mlsDsDayLbl: label, mlsDsList: dsList, mlsEz3Body: ezBody };
const listeners = {};
const document = {
  readyState: 'complete', body, head, documentElement: body,
  getElementById(id) { return elements[id] || null; },
  createElement(tag) {
    return { tagName: tag.toUpperCase(), id: '', className: '', style: {}, classList: classes(),
      setAttribute() {}, appendChild() {}, insertBefore() {}, querySelector() { return null; },
      querySelectorAll() { return []; }, parentNode: null, textContent: '', innerHTML: '' };
  },
  addEventListener(type, fn) { listeners['d:' + type] = fn; },
  removeEventListener() {}
};

const patients = [
  { id: 'PT-FRI', name: 'Friday Patient', dob: '02/03/1980' },
  { id: 'PT-TODAY', name: 'Today Patient', dob: '04/05/1981' }
];
const appts = [
  { id: 701, appointment_id: 'A-FRI', patient_external_id: 'PT-FRI', name: 'Friday Patient', dob: '1980-02-03', day_local: '2026-07-17', time_display: '9:00 AM', provider: 'Dr Friday' },
  { id: 702, appointment_id: 'A-TODAY', patient_external_id: 'PT-TODAY', name: 'Today Patient', dob: '1981-04-05', day_local: '2026-07-16', time_display: '10:00 AM', provider: 'Dr Today' }
];
let active = null;
const starts = [], bindings = [], events = [], toasts = [];

const window = {
  _calAppts: appts,
  getPatients: () => patients,
  activePatient: () => active,
  __mlsEasyV32: { remote: { startVisitFor(id) { starts.push(String(id)); active = patients[0]; return true; } } },
  _athenaFreezeVisitBinding(patient, meta) { return { id: 'bind-' + meta.visitContext.appointmentId, patient, meta }; },
  _athenaSetVisitBinding(binding) { bindings.push(binding); return true; },
  toast(message, kind) { toasts.push({ message, kind }); },
  requestAnimationFrame(fn) { fn(); return 1; },
  addEventListener(type, fn) { listeners['w:' + type] = fn; },
  removeEventListener() {},
  dispatchEvent(ev) { events.push(ev); }
};
window.window = window;

class MutationObserver { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} }
class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }

const context = { window, document, MutationObserver, CustomEvent, Date, Object, Array, String, Math, Set, console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_cross_day_context.js' });

const api = window.__mlsCrossDayContext;
assert(api && api.installed && api.version === 'xdc-1.0.0', 'cross-day owner did not install');
assert.strictEqual(api._test.selectedDay(), '2026-07-17', 'visible non-today label did not resolve to the exact loaded practice date');
assert.strictEqual(api._test.appointmentsForDay('2026-07-17').length, 1, 'cross-day rows were not date-scoped');
assert.strictEqual(api._test.resolvePatient(appts[0]).patient.id, 'PT-FRI', 'stable appointment patient id did not win');

assert.strictEqual(api.openAppointment(appts[0]), true, 'exact Friday appointment did not open');
assert.deepStrictEqual(starts, ['701'], 'workspace started a different appointment or used the display id instead of the source row id');
assert(api.current() && api.current().appointmentId === 'A-FRI' && api.current().date === '2026-07-17' && api.current().patientId === 'PT-FRI', 'immutable appointment context is incomplete');
const bound = bindings.find(Boolean);
assert(bound && bound.meta.visitContext.visitDate === '2026-07-17', 'visit tools were not bound to the appointment date');
assert.strictEqual(bound.meta.visitContext.appointmentId, 'A-FRI', 'visit tools lost the exact appointment id');
assert.strictEqual(bound.meta.visitContext.provider, 'Dr Friday', 'visit tools lost the appointment provider');
assert(body.classList.contains('mls-xdc-active') && ezBody.classList.contains('mls-xdc-active'), 'full workspace was not revealed after exact binding');
assert(events.some(e => e.type === 'mls:appointment-context-changed' && e.detail.active && e.detail.date === '2026-07-17'), 'context activation was not published to dependent tools');

api.clear('test-day-change');
assert.strictEqual(api.current(), null, 'day/patient change did not clear the appointment context');
assert.strictEqual(bindings[bindings.length - 1], null, 'stale visit binding survived context clear');

const ambiguous = { id: 703, name: 'Duplicate Name', dob: '01/01/1970', day_local: '2026-07-17' };
patients.push({ id: 'D1', name: 'Duplicate Name', dob: '01/01/1970' }, { id: 'D2', name: 'Duplicate Name', dob: '1970-01-01' });
assert.strictEqual(api._test.resolvePatient(ambiguous).ok, false, 'duplicate name+DOB charts did not fail closed');

label.textContent = 'Sat, Jul 18';
assert.strictEqual(api.openAppointment(appts[0]), false, 'appointment opened after the selected day changed');
assert(/selected day changed/i.test(toasts[toasts.length - 1].message), 'wrong-day failure did not explain recovery');

assert(source.includes('body.mls-xdc-active #mlsEz3Body.mls-ds-otherday>#ez3Wrap{display:block!important;}'), 'other-day exact context does not reveal the full workspace');
assert(source.includes('body.mls-xdc-active #ez3Wrap .ez3-quick{display:none!important;}'), 'today quick strip can still appear under a non-today exact context');
assert(connect.includes("A='feat_mls_cross_day_context.js'") && connect.includes("A+'?v=20260718xdc101'"), 'production bundle does not load the cross-day context owner');
assert(!/pullScheduleViaAssist|__mlsSI\.pull|postMessage\(/.test(source), 'cross-day context must not pull or command Athena');

console.log('PASS cross-day appointment context: exact patient/date/provider binding reveals every tool and stale/ambiguous selection fails closed');

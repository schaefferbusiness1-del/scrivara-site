'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const writeflow = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');

function between(source, start, end, label) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'could not isolate ' + label);
  return source.slice(a, b);
}

const calls = [];
const patient = { id: 'patient-synthetic-1', patientId: 'patient-synthetic-1', name: 'Synthetic Patient', dob: '1970-01-01', mrn: 'MRN-SYN-1' };
let active = patient;
let editorFingerprint = 'editor-fingerprint-1';
const nodes = {
  patientLabel: { value: patient.name }, transcript: { value: 'Synthetic transcript.' },
  noteBox: { value: 'Synthetic SOAP note.', style: { display: '' } }, handoutBody: { value: '' },
  procNoteBody: { value: '' }, contextBox: { value: '' }, signLine: { style: { display: 'none' }, textContent: '' }
};
const context = {
  console, Date, Math,
  S(v) { return String(v == null ? '' : v); },
  nrmName(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); },
  nrmDob(v) { return String(v || '').replace(/\D/g, ''); },
  nrmId(v) { return String(v || '').replace(/\D/g, ''); },
  activePt() { return active; },
  expectedVisitContext(_patient, opts) { return Object.assign({}, opts.expectedContext); },
  unifiedStatus(_state, message, kind) { calls.push(['status', kind, message]); },
  _athenaCurrentMatchesBound() { return true; },
  document: { getElementById(id) { return nodes[id] || null; } },
  getActivePtId() { return active && active.id || ''; },
  findPatient(id) { return String(id) === patient.id ? patient : null; },
  getVisitComment() { return ''; },
  currentNoteId: 'note-synthetic-1', currentCoding: null, lastEMR: null,
  currentFormat: 'soap', currentSoap: nodes.noteBox.value, currentInsurance: '',
  currentNoteProvenance: 'generated_soap', currentAthenaNote: '', currentAthenaNoteProvenance: 'none', currentAthenaNoteSourceFingerprint: '',
  currentOpt: null, currentAVS: '', currentReferral: '', currentIME: '', currentHandout: '',
  currentOrders: [], ordersDx: {}, currentPriorAuth: '', currentRedFlags: '', currentDdx: '',
  currentSurgicalData: null, currentSurgicalPlan: '', currentProcNote: '', mmeOpioids: [],
  currentMips: '', currentOutcome: null, signed: false
};
context.window = context;
context._athenaEditorFingerprint = () => editorFingerprint;
vm.createContext(context);

vm.runInContext(between(shell, 'function _athenaPatientSnapshot(', '/* dayvs-1.0.0', 'canonical binding freezer'), context);
vm.runInContext('let currentVisitAthenaBinding=null,currentVisitAthenaCompromised=false,currentVisitAthenaAwayFingerprint=null,currentVisitAthenaEpoch=0;\n' +
  between(shell, 'function _athenaSetVisitBinding(', 'function _athenaCurrentMatchesBound(', 'canonical binding owner'), context);
vm.runInContext(between(writeflow, 'function p1SamePatient(', 'function p1ProviderNorm(', 'exact patient comparator'), context);
vm.runInContext(between(writeflow, 'function wfbindEditorFingerprint()', 'function wfbindFinish(', 'explicit Bind bridge'), context);
vm.runInContext(between(shell, 'function noteRecordFromState(', 'function upsertNote(', 'saved-note serializer'), context);
vm.runInContext(between(shell, 'function _athenaBindingForSavedRecord(', 'function _athenaBoundVisitForAction(', 'History binding restore'), context);

const expectedContext = {
  visitDate: '2026-08-25', provider: 'Synthetic Provider', appointmentId: 'appointment-synthetic-25',
  encounterId: '', encounterUrl: ''
};
const state = {
  editorFingerprint,
  manifest: { patient: { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn } }
};
assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext, visitTimestamp: 1787659200000 }), true,
  'explicit exact appointment Bind did not reach the canonical Visit binding');

const saved = context.noteRecordFromState(false);
assert.strictEqual(saved.patientId, patient.id, 'Save History lost the exact patient');
assert.strictEqual(saved.appointmentId, expectedContext.appointmentId, 'Save History lost the explicitly bound appointment');
assert.strictEqual(saved.visitDate, expectedContext.visitDate, 'Save History lost the explicitly bound visit date');
const reopened = context._athenaBindingForSavedRecord(saved);
assert.strictEqual(reopened.patient.patientId, patient.id, 'History reopen lost the exact patient');
assert.strictEqual(reopened.visitContext.appointmentId, expectedContext.appointmentId, 'History reopen lost the saved appointment');
assert.strictEqual(reopened.visitContext.visitDate, expectedContext.visitDate, 'History reopen lost the saved visit date');

const accepted = context._athenaGetVisitBinding();

const realSetBinding = context._athenaSetVisitBinding;
const realGetBinding = context._athenaGetVisitBinding;
context._athenaSetVisitBinding = function (binding, replaceExisting) {
  realSetBinding(binding, replaceExisting);
  return false;
};
assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext }), false, 'a setter refusal was treated as a successful Bind');
context._athenaSetVisitBinding = realSetBinding;
assert.strictEqual(realGetBinding(), accepted, 'setter refusal did not restore the prior binding');

let readbackCalls = 0;
context._athenaGetVisitBinding = function () {
  const actual = realGetBinding();
  readbackCalls++;
  if (readbackCalls === 1) return actual;
  return Object.assign({}, actual, { visitContext: Object.assign({}, actual && actual.visitContext, { appointmentId: 'wrong-readback' }) });
};
assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext }), false, 'a mismatched canonical read-back was treated as a successful Bind');
context._athenaGetVisitBinding = realGetBinding;
assert.strictEqual(realGetBinding(), accepted, 'read-back mismatch did not restore the prior binding');

editorFingerprint = 'changed-editor-fingerprint';
assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext }), false, 'a stale note was allowed to change canonical binding');
assert.strictEqual(context._athenaGetVisitBinding(), accepted, 'stale-note refusal changed the prior binding');

editorFingerprint = state.editorFingerprint;
active = Object.assign({}, patient, { id: 'different-patient', patientId: 'different-patient' });
assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext }), false, 'same-name different-ID patient was allowed to bind');
assert.strictEqual(context._athenaGetVisitBinding(), accepted, 'patient-refusal changed the prior binding');

assert.strictEqual((writeflow.match(/if \(!wfbindCommitCanonical\(state, /g) || []).length, 3,
  'not every explicit day/appointment Bind success is gated by canonical binding readback');
for (const rel of ['1p/index.html', '1pScribeFlow.html']) {
  assert(fs.readFileSync(path.join(root, rel), 'utf8').includes('function _athenaGetVisitBinding(){return currentVisitAthenaBinding;}'),
    rel + ' does not expose canonical binding readback');
}

console.log('PASS History Bind/Save/reopen runtime: explicit exact appointment survives Save History and reopen; setter/read-back, stale-note, and same-name different-ID refusals preserve the prior binding');

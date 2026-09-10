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
  getNotes() { return []; },
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
vm.runInContext(between(shell, 'function _mlsAthenaSourceState(', 'function _mlsAthenaGenerationSourceFingerprint(', 'explicit Bind source re-anchor'), context);
vm.runInContext(between(shell, 'function _mlsSavedAthenaFingerprintMatchesRecord(', 'function _mlsSavedAthenaCanonicalForWrite(', 'saved fingerprint comparator'), context);
vm.runInContext(between(writeflow, 'function p1SamePatient(', 'function p1ProviderNorm(', 'exact patient comparator'), context);
vm.runInContext(between(writeflow, 'function wfbindEditorFingerprint()', 'function wfbindFinish(', 'explicit Bind bridge'), context);
vm.runInContext(between(shell, 'function noteRecordFromState(', 'function upsertNote(', 'saved-note serializer'), context);
vm.runInContext(between(shell, 'function _athenaBindingForSavedRecord(', 'function _athenaBoundVisitForAction(', 'History binding restore'), context);

const expectedContext = {
  visitDate: '8/25/2026', provider: 'Synthetic Provider', appointmentId: 'appointment-synthetic-25',
  encounterId: '', encounterUrl: ''
};
const state = {
  editorFingerprint,
  manifest: { patient: { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn } }
};
const generatedBinding = context._athenaFreezeVisitBinding(patient, {
  source: 'generated-visit', historical: true,
  visitContext: { visitDate: '2026-09-10', provider: expectedContext.provider, appointmentId: '', encounterId: '', encounterUrl: '' }
});
assert.strictEqual(context._athenaSetVisitBinding(generatedBinding, true), true);
context.currentAthenaNote = 'Synthetic canonical note.';
context.currentAthenaNoteProvenance = 'generated';
context.currentAthenaNoteSourceFingerprint = context._mlsAthenaSourceFingerprint();
const preBindFingerprint = context.currentAthenaNoteSourceFingerprint;
const sourceBeforeBind = [nodes.transcript.value, nodes.noteBox.value, context.currentSoap];
assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext, visitTimestamp: 1787659200000 }), true,
  'explicit exact appointment Bind did not reach the canonical Visit binding');

const saved = context.noteRecordFromState(false);
assert.strictEqual(saved.patientId, patient.id, 'Save History lost the exact patient');
assert.strictEqual(saved.appointmentId, expectedContext.appointmentId, 'Save History lost the explicitly bound appointment');
assert.strictEqual(saved.visitDate, expectedContext.visitDate, 'Save History lost the explicitly bound visit date');
assert.strictEqual(context._mlsSavedAthenaFingerprintMatchesRecord(saved.athenaNoteSourceFingerprint, saved), true,
  'explicit Bind left the saved note with its pre-bind appointment fingerprint');
assert.deepStrictEqual([nodes.transcript.value, nodes.noteBox.value, context.currentSoap], sourceBeforeBind,
  'explicit Bind mutated clinical source text while re-anchoring metadata');
const reopened = context._athenaBindingForSavedRecord(saved);
assert.strictEqual(reopened.patient.patientId, patient.id, 'History reopen lost the exact patient');
assert.strictEqual(reopened.visitContext.appointmentId, expectedContext.appointmentId, 'History reopen lost the saved appointment');
assert.strictEqual(reopened.visitContext.visitDate, expectedContext.visitDate, 'History reopen lost the saved visit date');

// A pre-fix saved note is recoverable only through a fresh explicit choice of
// its same stored appointment and exact unchanged source/patient bytes.
const legacySaved = Object.assign({}, saved, {
  visitDate: '8/25/2026',
  athenaNote: 'Synthetic canonical note.', athenaNoteProvenance: 'generated',
  athenaNoteSourceFingerprint: preBindFingerprint
});
context.getNotes = () => [legacySaved];
context.currentAthenaNote = '';
context.currentAthenaNoteProvenance = 'stale';
context.currentAthenaNoteSourceFingerprint = '';
context._mlsSetAthenaNote = function (text, provenance) {
  assert.strictEqual(text, nodes.noteBox.value, 'legacy recovery did not derive from the unchanged displayed SOAP');
  context.currentAthenaNote = text;
  context.currentAthenaNoteProvenance = provenance;
  context.currentAthenaNoteSourceFingerprint = context._mlsAthenaSourceFingerprint();
};
context._mlsAthenaFingerprintMatchesCurrent = expected => expected === context._mlsAthenaSourceFingerprint();
const legacyState = JSON.parse(preBindFingerprint);
const legacyRecordState = { v: 2, transcript: legacySaved.transcript, context: legacySaved.context, visitComment: legacySaved.visitComment,
  standardNote: legacySaved.soap, activePatientId: legacySaved.patientId,
  patient: { patientId: legacySaved.patientId, name: legacySaved.patient, dob: legacySaved.patientDob, mrn: legacySaved.patientMrn },
  visit: { visitDate: legacySaved.visitDate, provider: legacySaved.provider, appointmentId: legacySaved.appointmentId,
    encounterId: legacySaved.encounterId, encounterUrl: legacySaved.encounterUrl } };
assert.strictEqual(context._mlsAthenaBindClinicalPatientSame(legacyState, legacyRecordState), true, 'fixture legacy source/patient proof is invalid');
assert.strictEqual(context._mlsAthenaBindClinicalPatientSame(legacyRecordState, context._mlsAthenaSourceState(context._athenaGetVisitBinding(), true)), true, 'fixture live source/patient proof is invalid');
assert.strictEqual(context._mlsAthenaBindDayKey(legacyRecordState.visit.visitDate), context._mlsAthenaBindDayKey(context._mlsAthenaSourceState(context._athenaGetVisitBinding(), true).visit.visitDate), 'fixture saved/live dates do not identify the same day');
const eligibilityBefore = JSON.stringify({ binding: context._athenaGetVisitBinding(), note: context.currentAthenaNote,
  provenance: context.currentAthenaNoteProvenance, fingerprint: context.currentAthenaNoteSourceFingerprint,
  transcript: nodes.transcript.value, noteBox: nodes.noteBox.value, soap: context.currentSoap });
assert.strictEqual(context._mlsAthenaCanRecoverExplicitBinding(context._athenaGetVisitBinding()), true,
  'exact legacy saved binding is not visible to the pure recovery eligibility check');
assert.strictEqual(JSON.stringify({ binding: context._athenaGetVisitBinding(), note: context.currentAthenaNote,
  provenance: context.currentAthenaNoteProvenance, fingerprint: context.currentAthenaNoteSourceFingerprint,
  transcript: nodes.transcript.value, noteBox: nodes.noteBox.value, soap: context.currentSoap }), eligibilityBefore,
  'read-only recovery eligibility mutated binding, canonical state, or clinical source');
assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext, visitTimestamp: 1787659200000 }), true,
  'fresh explicit re-bind of the exact saved appointment was refused');
assert.strictEqual(context.currentAthenaNoteProvenance, 'edited', 'exact saved-note recovery did not restore a current canonical sidecar');
assert.strictEqual(context._mlsAthenaFingerprintMatchesCurrent(context.currentAthenaNoteSourceFingerprint), true,
  'saved-note recovery did not re-anchor to the explicitly selected appointment');
const recoveredSaved = context.noteRecordFromState(false);
assert.strictEqual(context._mlsSavedAthenaFingerprintMatchesRecord(recoveredSaved.athenaNoteSourceFingerprint, recoveredSaved), true,
  'Save after legacy re-bind did not persist one internally consistent appointment proof');
assert.deepStrictEqual([nodes.transcript.value, nodes.noteBox.value, context.currentSoap], sourceBeforeBind,
  'saved-note recovery mutated transcript or displayed SOAP');

context.currentAthenaNote = '';
context.currentAthenaNoteProvenance = 'stale';
context.currentAthenaNoteSourceFingerprint = '';
const differentAppointment = Object.assign({}, expectedContext, { appointmentId: 'appointment-synthetic-other' });
assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext: differentAppointment }), true,
  'an ineligible stale sidecar incorrectly blocked the explicit visit binding');
assert.strictEqual(context.currentAthenaNoteProvenance, 'stale', 'a different appointment improperly recovered the saved canonical sidecar');
assert.strictEqual(context._athenaGetVisitBinding().visitContext.appointmentId, differentAppointment.appointmentId,
  'the valid explicit binding was rolled back only because canonical recovery was ineligible');

function expectRecoveryRefusal(label, savedOverride, mutate, restore) {
  context.getNotes = () => [savedOverride || legacySaved];
  context.currentAthenaNote = '';
  context.currentAthenaNoteProvenance = 'stale';
  context.currentAthenaNoteSourceFingerprint = '';
  if (mutate) mutate();
  assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext }), true, label + ' blocked a valid explicit Bind');
  assert.strictEqual(context.currentAthenaNoteProvenance, 'stale', label + ' improperly recovered the canonical sidecar');
  if (restore) restore();
}
expectRecoveryRefusal('changed transcript', null, () => { nodes.transcript.value += ' changed'; }, () => { nodes.transcript.value = legacySaved.transcript; });
expectRecoveryRefusal('changed context', null, () => { nodes.contextBox.value = 'changed context'; }, () => { nodes.contextBox.value = legacySaved.context; });
expectRecoveryRefusal('changed displayed SOAP', null, () => { nodes.noteBox.value += ' changed'; }, () => { nodes.noteBox.value = legacySaved.soap; });
expectRecoveryRefusal('changed internal SOAP', null, () => { context.currentSoap += ' changed'; }, () => { context.currentSoap = legacySaved.soap; });
expectRecoveryRefusal('changed saved patient', Object.assign({}, legacySaved, { patient: 'Different Synthetic Patient' }));
const priorAppointmentState = JSON.parse(preBindFingerprint);
priorAppointmentState.visit.appointmentId = 'appointment-from-another-bind';
expectRecoveryRefusal('fingerprint with an existing different appointment', Object.assign({}, legacySaved, { athenaNoteSourceFingerprint: JSON.stringify(priorAppointmentState) }));

context.getNotes = () => [legacySaved];
assert.strictEqual(context.wfbindCommitCanonical(state, { expectedContext }), true,
  'returning to the exact saved appointment did not remain recoverable');
assert.strictEqual(context.currentAthenaNoteProvenance, 'edited', 'exact saved appointment did not recover after an ineligible binding');
const stableFingerprint = context.currentAthenaNoteSourceFingerprint;
const sameReadback = context._athenaGetVisitBinding();
assert.strictEqual(context._mlsAthenaReanchorExplicitBinding(sameReadback, sameReadback), true,
  'reused identical binding readback caused a re-anchor loop/refusal');
assert.strictEqual(context.currentAthenaNoteSourceFingerprint, stableFingerprint,
  'identical binding readback changed an already current fingerprint');

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

assert.strictEqual((writeflow.match(/if \(!wfbindCommitCanonical\(state, /g) || []).length, 4,
  'not every explicit day/appointment Bind success is gated by canonical binding readback');
for (const rel of ['1p/index.html', '1pScribeFlow.html']) {
  assert(fs.readFileSync(path.join(root, rel), 'utf8').includes('function _athenaGetVisitBinding(){return currentVisitAthenaBinding;}'),
    rel + ' does not expose canonical binding readback');
}

console.log('PASS History Bind/Save/reopen runtime: explicit exact appointment re-anchors unchanged source through Save/History; exact legacy re-bind recovers without AI; setter/read-back, stale-note, and same-name different-ID refusals preserve the prior binding');

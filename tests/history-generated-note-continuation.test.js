'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1p/index.html', '1pScribeFlow.html'];
const detail = fs.readFileSync(path.join(root, 'feat_visit_note_detail.js'), 'utf8');

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function between(source, start, end, label) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'could not isolate ' + label);
  return source.slice(a, b);
}

for (const rel of shells) {
  const source = read(rel);
  const reopen = between(source, 'function _mlsSavedRecordCanReopen(n){', '\nfunction reopenViewed(){', rel + ' continuation');
  const calls = [];
  const noteCard = { scrollIntoView(opts) { calls.push(['scroll', opts]); } };
  const patient = { id: 'patient-local-1', name: 'Synthetic Patient' };
  const context = {
    _mlsIsChartImportNote(n) { return n.cc === 'Athena chart import'; },
    findPatient(id) { return String(id) === patient.id ? patient : null; },
    getActivePtId() { return 'other-patient'; },
    setActivePtId(id) { calls.push(['patient', id]); },
    showView(view) { calls.push(['view', view]); },
    loadRecordIntoEditor(note) { calls.push(['load', note.id, note.appointmentId]); },
    renderPatientBar() { calls.push(['bar']); },
    toast(message) { calls.push(['toast', message]); },
    document: { getElementById(id) { return id === 'noteCard' ? noteCard : null; } }
  };
  vm.createContext(context);
  vm.runInContext(reopen, context, { filename: rel + '#continuation' });

  const generated = {
    id: 'note-generated-1', patientId: patient.id, appointmentId: 'appointment-9',
    transcript: 'Synthetic current visit transcript.', soap: 'Synthetic generated SOAP.',
    noteProvenance: 'generated_soap'
  };
  assert.strictEqual(context._mlsSavedRecordCanReopen(generated), true, rel + ': generated SOAP was not recognized as editor-owned');
  assert.strictEqual(context._mlsContinueSavedRecord(generated), true, rel + ': generated note did not continue');
  assert.deepStrictEqual(calls.slice(0, 4), [
    ['patient', patient.id], ['view', 'visit'], ['load', generated.id, generated.appointmentId], ['bar']
  ], rel + ': continuation did not restore patient, route, and exact saved record in order');
  assert.strictEqual(calls.filter(x => x[0] === 'scroll').length, 1, rel + ': continuation has more than one scroll owner');

  const before = calls.length;
  assert.strictEqual(context._mlsSavedRecordCanReopen({ id: 'chart-receipt', patientId: patient.id, cc: 'Athena chart import', text: 'clinical history' }), false,
    rel + ': chart-import receipt was mistaken for a Visit-editor draft');
  assert.strictEqual(context._mlsContinueSavedRecord({ id: 'chart-receipt', patientId: patient.id, cc: 'Athena chart import', text: 'clinical history' }), false);
  assert.strictEqual(calls.length, before, rel + ': rejected clinical-history receipt mutated the Visit editor');

  assert(source.includes('renderSurgicalPlan(currentSurgicalData,{scroll:false})'), rel + ': restore still lets surgical-plan rendering scroll');
  assert(source.includes("if(!(opts&&opts.scroll===false)) card.scrollIntoView"), rel + ': surgical renderer cannot suppress its scroll during restore');
  assert(source.includes("mine=(histData.byPatient&&histData.byPatient.get(ap.id))||[];"), rel + ': patient History no longer uses the canonical patientId index');
}

assert(detail.includes('↩ Continue this draft'), 'rich saved-note detail has no clear continuation action');
assert(detail.includes('editorPatient && canContinueInVisitEditor(note) && isFn(window._mlsContinueSavedRecord)'),
  'rich detail does not require both exact patient identity and editor-owned record evidence');
assert(detail.includes('window._mlsContinueSavedRecord(note);'), 'rich detail does not dispatch the exact saved record to the canonical editor loader');
assert(!/function canContinueInVisitEditor[\s\S]*?note\.text/.test(detail), 'arbitrary clinical-history text can qualify as an editable Visit draft');

console.log('PASS History generated-note continuation: exact patient and appointment restore, clinical-history exclusion, and one scroll owner');

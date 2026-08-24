'use strict';

/* Runtime state-machine coverage for the separate clinician display note and
 * canonical five-destination Athena sidecar. This suite exercises the real
 * functions extracted from both 1p shells; it does not reimplement them. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function marker: ' + marker);
  const open = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unbalanced function: ' + marker);
}

function canonicalBlock(source) {
  const start = source.indexOf('function _mlsAthenaNoteQualityError(');
  const end = source.indexOf('\n\n/* =========================================================\n   GENERATE NOTE', start);
  assert(start >= 0 && end > start, 'missing canonical Athena state block');
  return source.slice(start, end);
}

const canonicalText = [
  'HPI:', 'Pain improved after the injection.',
  '', 'ROS:', 'Denies weakness or bowel/bladder change.',
  '', 'EXAM:', 'Strength is five out of five.',
  '', 'ASSESSMENT:', 'Lumbar radicular pain, improving.',
  '', 'PLAN:', 'Continue home exercise and follow up in four weeks.'
].join('\n');
const displayText = 'Alternate clinician-facing narrative that is intentionally not the five-field Athena payload.';

function harness(source, file) {
  const values = {
    transcript: 'source transcript',
    contextBox: 'source context',
    visitComment: '',
    patientLabel: 'Test Patient',
    noteBox: displayText
  };
  const binding = {
    patient: { patientId: 'p-1', name: 'Test Patient', dob: '1980-01-01', mrn: 'M-1' },
    visitContext: { visitDate: '2026-08-23', provider: 'Dr Test', appointmentId: 'a-1', encounterId: 'e-1', encounterUrl: '/enc/e-1' }
  };
  const sandbox = {
    window: { __mlsWriteFlow: { parseGeneratedSoapSections: () => ({ ok: false, sections: [] }) } },
    document: {
      getElementById: id => Object.prototype.hasOwnProperty.call(values, id) ? {
        style: { display: 'block' },
        get value() { return values[id]; },
        set value(value) { values[id] = String(value); }
      } : null
    },
    getActivePtId: () => 'p-1',
    currentVisitAthenaBinding: binding,
    currentSoap: displayText,
    currentInsurance: '',
    currentFormat: 'soap',
    currentNoteProvenance: 'generated_soap',
    currentAthenaNote: '',
    currentAthenaNoteProvenance: 'none',
    currentAthenaNoteSourceFingerprint: ''
  };
  vm.createContext(sandbox);
  vm.runInContext(canonicalBlock(source) + `
    this.__api={
      validate:_mlsValidateAthenaNote,
      set:_mlsSetAthenaNote,
      sync:_mlsSyncAthenaAfterStandardNoteMutation,
      restore:_mlsRestoreAthenaState,
      fingerprint:_mlsAthenaSourceFingerprint,
      generationFingerprint:_mlsAthenaGenerationSourceFingerprint,
      write:_mlsAthenaCanonicalForWrite,
      saved:_mlsSavedAthenaCanonicalForWrite
    };`, sandbox, { filename: file });
  return { sandbox, values, binding, api: sandbox.__api };
}

function savedRecord(h) {
  const s = h.sandbox, b = h.binding;
  return {
    id: 'generated-1',
    patient: 'Test Patient', patientLabel: h.values.patientLabel, patientId: 'p-1', patientDob: '1980-01-01', patientMrn: 'M-1',
    transcript: h.values.transcript, context: h.values.contextBox, visitComment: h.values.visitComment,
    soap: s.currentSoap, noteProvenance: s.currentNoteProvenance,
    athenaNote: s.currentAthenaNote, athenaNoteProvenance: s.currentAthenaNoteProvenance,
    athenaNoteSourceFingerprint: s.currentAthenaNoteSourceFingerprint,
    visitDate: b.visitContext.visitDate, provider: b.visitContext.provider,
    appointmentId: b.visitContext.appointmentId, encounterId: b.visitContext.encounterId,
    encounterUrl: b.visitContext.encounterUrl, coding: null, orders: []
  };
}

for (const file of shells) {
  const source = read(file);
  const preferenceSandbox = {
    window: {},
    getGenPatientSummary: () => true,
    getGenStyle: () => 'soap',
    getMlsNoteStyle: () => 'balanced',
    getQolFollowup: () => '',
    getDocPrefs: () => []
  };
  vm.runInNewContext(extractFunction(source, 'function hostedNotePreferences()') + '\nthis.__preferences=hostedNotePreferences();', preferenceSandbox, { filename: file });
  eq(preferenceSandbox.__preferences.patientSummary, true, file + ': real hosted preference collector dropped patient-summary choice');
  eq(preferenceSandbox.__preferences.noteFormat, 'flat_hpi_ros_exam_assessment_plan_v1', file + ': real hosted preference collector lost exact flat-note format');
  const h = harness(source, file);
  const { sandbox: s, values, api } = h;

  const baseFingerprint = api.fingerprint();
  s.currentSoap = displayText + ' edited';
  ok(api.fingerprint() !== baseFingerprint, file + ': display-note edits are absent from the canonical source fingerprint');
  const generationFingerprint = api.generationFingerprint();
  s.currentSoap = displayText + ' edited again';
  eq(api.generationFingerprint(), generationFingerprint, file + ': output-only display text polluted the generation-input fingerprint');
  values.contextBox = 'changed context';
  ok(api.generationFingerprint() !== generationFingerprint, file + ': context edits do not invalidate in-flight generation');
  values.contextBox = 'source context';
  const commentGenerationFingerprint = api.generationFingerprint();
  values.visitComment = 'Patient understood the plan.';
  ok(api.generationFingerprint() !== commentGenerationFingerprint, file + ': visit-comment edits do not invalidate in-flight generation');

  s.currentSoap = displayText;
  const first = api.set(canonicalText, 'generated');
  eq(first.sections.map(section => section.key).join(','), 'hpi,ros,exam,assessment,plan', file + ': comment-bearing sidecar changed the exact destination set');
  eq((s.currentAthenaNote.match(/COMMENT: Patient understood the plan\./g) || []).length, 1, file + ': visit comment was missing or duplicated in canonical Plan');
  ok(first.sections[4].text.includes('COMMENT: Patient understood the plan.'), file + ': visit comment did not travel through the canonical Plan destination');
  api.set(s.currentAthenaNote, 'generated');
  eq((s.currentAthenaNote.match(/COMMENT: Patient understood the plan\./g) || []).length, 1, file + ': resetting the sidecar duplicated the visit comment');
  eq(api.write().ok, true, file + ': freshly bound sidecar was not writable');

  values.noteBox = canonicalText + '\n\nCOMMENT:\nPatient understood the plan.';
  s.currentSoap = values.noteBox;
  s.currentNoteProvenance = 'edited_generated_soap';
  s.currentAthenaNote = '';
  s.currentAthenaNoteSourceFingerprint = '';
  s.currentAthenaNoteProvenance = 'stale';
  eq(api.sync('repair legacy display comment'), true, file + ': legacy two-line display comment could not repair a stale sidecar');
  eq((s.currentAthenaNote.match(/Patient understood the plan\./g) || []).length, 1, file + ': legacy display comment and canonical comment were both retained');
  ok(!/COMMENT:\s*\n/.test(s.currentAthenaNote), file + ': legacy two-line comment shape leaked into canonical Plan');
  values.visitComment = '';
  eq(api.sync('clear visit comment'), true, file + ': clearing a visit comment could not refresh the canonical sidecar');
  ok(!/COMMENT:/i.test(s.currentAthenaNote), file + ': cleared visit comment survived in canonical Plan');

  /* The refresh helper must own every generated-SOAP edit, not just the first
     provenance transition from generated_soap to edited_generated_soap. */
  values.visitComment = '';
  values.noteBox = canonicalText;
  s.currentSoap = canonicalText;
  s.currentFormat = 'soap';
  s.currentNoteProvenance = 'generated_soap';
  api.set(canonicalText, 'generated');
  values.noteBox = values.noteBox.replace('four weeks', 'three weeks');
  s.currentSoap = values.noteBox;
  eq(api.sync('first edit'), true, file + ': first standard-note edit did not refresh the sidecar');
  values.noteBox = values.noteBox.replace('three weeks', 'two weeks');
  s.currentSoap = values.noteBox;
  eq(api.sync('second edit'), true, file + ': second standard-note edit did not refresh the sidecar');
  eq(s.currentNoteProvenance, 'edited_generated_soap', file + ': repeated edits lost generated-SOAP provenance');
  ok(s.currentAthenaNote.includes('two weeks'), file + ': second edit silently reused the first-edited sidecar');
  eq(api.write().ok, true, file + ': twice-edited exact five-field note was incorrectly stale');

  s.currentAthenaNote = '';
  s.currentAthenaNoteSourceFingerprint = '';
  s.currentAthenaNoteProvenance = 'stale';
  eq(api.sync('repair after stale'), true, file + ': valid generated SOAP could not repair a stale sidecar');
  eq(s.currentAthenaNoteProvenance, 'edited', file + ': repaired sidecar did not regain editable canonical provenance');
  eq(api.write().ok, true, file + ': repaired sidecar remained blocked');
  s.currentNoteProvenance = 'generated_nonsoap';
  s.currentAthenaNote = '';
  s.currentAthenaNoteSourceFingerprint = '';
  s.currentAthenaNoteProvenance = 'none';
  eq(api.sync('alternate style changed'), false, file + ': alternate-style mutation claimed canonical repair');
  eq(s.currentAthenaNoteProvenance, 'stale', file + ': alternate-style generated note silently fell back to a manual route');
  s.currentNoteProvenance = 'edited_generated_soap';
  eq(api.sync('return to exact SOAP'), true, file + ': returning to a valid generated SOAP note did not repair the sidecar');

  s.currentFormat = 'insurance';
  s.currentInsurance = 'Insurer-facing display changed.';
  eq(api.write().ok, true, file + ': insurance display change invalidated an unchanged standard-note sidecar');
  s.currentFormat = 'soap';
  s.currentSoap += '\nClinician mutation that bypassed refresh.';
  eq(api.write().ok, false, file + ': untracked standard-note mutation silently reused a stale sidecar');
  eq(api.write().reason, 'canonical-source-changed', file + ': stale sidecar reported the wrong refusal');

  /* Save/restore and History use the same exact v2 source binding. */
  s.currentSoap = values.noteBox;
  values.patientLabel = 'Clinician-entered visit label';
  api.set(canonicalText, 'generated');
  const record = savedRecord(h);
  ok(record.patient !== record.patientLabel, file + ': route-patient/source-label mismatch control is invalid');
  eq(api.saved(record).ok, true, file + ': exact saved generated note failed canonical revalidation');
  const changedRecord = { ...record, soap: record.soap + '\nchanged after save' };
  eq(api.saved(changedRecord).ok, false, file + ': changed saved display note reused the old sidecar');
  eq(api.saved(changedRecord).reason, 'canonical-source-changed', file + ': changed saved note reported the wrong refusal');
  const legacyWithoutExactLabel = { ...record }; delete legacyWithoutExactLabel.patientLabel;
  eq(api.saved(legacyWithoutExactLabel).ok, false, file + ': legacy record inferred patientLabel from a different route-patient field');
  eq(api.saved({ noteProvenance: 'typed', athenaNoteProvenance: 'none' }), null, file + ': manual saved note was forced into generated-sidecar rules');
  eq(api.saved({ noteProvenance: 'generated_soap', athenaNoteProvenance: 'none' }).reason, 'missing-canonical-note', file + ': generated saved note silently fell back without a sidecar');

  const restored = {
    noteProvenance: record.noteProvenance,
    athenaNote: record.athenaNote,
    athenaNoteProvenance: record.athenaNoteProvenance,
    athenaNoteSourceFingerprint: record.athenaNoteSourceFingerprint
  };
  s.currentAthenaNote = ''; s.currentAthenaNoteProvenance = 'none'; s.currentAthenaNoteSourceFingerprint = '';
  api.restore(restored);
  eq(s.currentAthenaNoteProvenance, 'generated', file + ': valid saved sidecar did not restore');
  values.contextBox = 'newer context';
  api.restore(restored);
  eq(s.currentAthenaNoteProvenance, 'stale', file + ': restore accepted a sidecar for changed context');
  eq(s.currentAthenaNote, '', file + ': stale restored sidecar retained executable text');
  values.contextBox = record.context;

  /* Run the real History dispatcher with the real saved-sidecar validator. */
  let notes = [record], pushed = null, toasts = [];
  Object.assign(s, {
    getNotes: () => notes,
    toast: message => toasts.push(String(message)),
    _athenaBindingForSavedRecord: n => ({ patient: { patientId: n.patientId, name: n.patient, dob: n.patientDob, mrn: n.patientMrn }, visitContext: h.binding.visitContext }),
    _athenaPushPlan: plan => { pushed = plan; },
    ATHENA_SECTIONS: {
      note: { icon: 'N', label: 'Note', dest: 'generic note' },
      procedure: { icon: 'P', label: 'Procedure', dest: 'Procedure Documentation' },
      dx: { icon: 'D', label: 'Diagnoses', dest: 'diagnoses' },
      billing: { icon: 'B', label: 'Billing', dest: 'billing' },
      orders: { icon: 'O', label: 'Orders', dest: 'orders' }
    }
  });
  vm.runInContext(extractFunction(source, 'function pushHistoryNoteToAthena(id)') + '\nthis.__pushHistory=pushHistoryNoteToAthena;', s, { filename: file });
  s.__pushHistory(record.id);
  eq(pushed.map(row => row.kind).join(','), 'hpi,ros,exam,assessment,plan', file + ': History collapsed a saved generated note into generic text');
  ok(pushed.every(row => row.generatedCanonical === true), file + ': History five-field rows lost canonical provenance');
  pushed = null; toasts = []; notes = [changedRecord];
  s.__pushHistory(changedRecord.id);
  eq(pushed, null, file + ': History staged a changed generated note with a stale sidecar');
  ok(toasts.some(message => /verified five-section Athena payload/.test(message)), file + ': stale History refusal was not visible');
  pushed = null; notes = [{ ...record, id: 'manual-1', noteProvenance: 'typed', athenaNote: '', athenaNoteProvenance: 'none', athenaNoteSourceFingerprint: '' }];
  s.__pushHistory('manual-1');
  eq(pushed.length, 1, file + ': manual History note gained unexpected destinations');
  eq(pushed[0].kind, 'note', file + ': manual History note lost its generic note route');
  pushed = null; notes = [{ ...record, id: 'op-1', kind: 'opnote', noteProvenance: 'typed', athenaNote: '', athenaNoteProvenance: 'none', athenaNoteSourceFingerprint: '' }];
  s.__pushHistory('op-1');
  eq(pushed[0].kind, 'procedure', file + ': operative History note lost Procedure Documentation routing');

  ok(source.includes("currentNoteProvenance==='generated_soap'||currentNoteProvenance==='edited_generated_soap'"), file + ': repeated editor edits are not covered by the refresh listener');
  ok(source.includes("id==='noteBox'&&typeof currentFormat!=='undefined'&&currentFormat==='soap'"), file + ': insurance edits can enter the standard-note invalidation lane');
  ok(source.includes("_mlsSyncAthenaAfterStandardNoteMutation('template changed the standard note')"), file + ': template mutation does not update or stale the sidecar');
  ok(source.includes("_mlsSyncAthenaAfterStandardNoteMutation('custom widget changed the standard note')"), file + ': widget mutation does not update or stale the sidecar');
  ok(source.includes("currentSoap!==beforeCommentMutation)try{_mlsSyncAthenaAfterStandardNoteMutation('visit comment or signature changed the standard note')"), file + ': deterministic comment/signature mutation does not update or stale the sidecar');
  ok(source.includes("context:(document.getElementById('contextBox')||{}).value||'', visitComment:(document.getElementById('visitComment')||{}).value||''"), file + ': recovery draft omits canonical source fields');
  ok(source.includes("if(typeof _mlsRestoreAthenaState==='function') _mlsRestoreAthenaState(d);"), file + ': recovery draft does not revalidate restored canonical state');
  ok(source.includes("athenaNoteSourceFingerprint: safe(function ()"), file + ': per-patient draft switch drops canonical state');
  ok(source.includes("_mlsAthenaGenerationSourceFingerprint(generationBinding)!==generationSourceFingerprint"), file + ': late generation result ignores source changes');
  ok(source.includes("out.patientSummary=(typeof getGenPatientSummary==='function'&&getGenPatientSummary()===true)"), file + ': hosted preference object drops patient-summary choice');
  ok(!source.includes("notePreferences:hostedNotePreferences(), patientSummary:"), file + ': patient-summary choice escaped the sanitized preference object');
  ok(source.includes("patientLabel: document.getElementById('patientLabel').value"), file + ': saved record does not retain the exact source patient label');
}

console.log('PASS athena-dual-note-state-runtime: ' + checks + ' checks — fingerprints, repeated edits, comments, insurance display, recovery, History, manual/op-note routing, and hosted patient-summary transport remain fail-closed and exact');

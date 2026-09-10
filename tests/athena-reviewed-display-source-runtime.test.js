'use strict';

/* A generated five-field note the clinician can see is the canonical Athena
 * source only while its full transcript/context/patient/visit fingerprint is
 * still current. Exercise the shipped validator and write gate directly; no AI
 * call, browser, Athena bridge, or synthetic reimplementation is involved. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }

const displayed = [
  'HPI:', 'Synthetic knee pain worsened over three weeks.',
  '', 'ROS:', 'Patient denies fever and new weakness.',
  '', 'EXAM:', 'Synthetic knee has medial joint line tenderness.',
  '', 'ASSESSMENT:', 'Synthetic mechanical knee pain under evaluation.',
  '', 'PLAN:', 'DIAGNOSIS:', 'Synthetic knee pain.', 'FINDINGS:', 'Medial tenderness documented today.',
  'RECOMMENDATIONS:', 'Continue the documented home program.', 'DISCUSSION:', 'Follow up in four weeks.'
].join('\n');
const differentSidecar = [
  'HPI:', 'Different but substantive generated sidecar history.',
  '', 'ROS:', 'Different but substantive generated sidecar review.',
  '', 'EXAM:', 'Different but substantive generated sidecar examination.',
  '', 'ASSESSMENT:', 'Different but substantive generated sidecar assessment.',
  '', 'PLAN:', 'Different but substantive generated sidecar plan.'
].join('\n');

function canonicalBlock(source, file) {
  const start = source.indexOf('function _mlsAthenaNoteQualityError(');
  const end = source.indexOf('\n\n/* =========================================================\n   GENERATE NOTE', start);
  assert(start >= 0 && end > start, file + ': canonical state block missing');
  return source.slice(start, end);
}

function rejects(api, text, pattern, message) {
  let error = null;
  try { api.validate(text); } catch (caught) { error = caught; }
  ok(error, message + ' (accepted)');
  ok(pattern.test(String(error && error.mlsAi && error.mlsAi.detail)), message + ' (wrong reason)');
}

for (const file of shells) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const values = {
    transcript: 'Synthetic source transcript for the current visit.',
    contextBox: 'Synthetic current-visit context.',
    visitComment: '',
    patientLabel: 'Synthetic Patient',
    noteBox: displayed
  };
  let activePatientId = 'patient-1';
  const binding = {
    patient: { patientId: 'patient-1', name: 'Synthetic Patient', dob: '1980-01-01', mrn: 'SYN-1' },
    visitContext: { visitDate: '2026-08-25', provider: 'Synthetic Provider', appointmentId: 'appt-1', encounterId: 'enc-1', encounterUrl: '/synthetic/enc-1' }
  };
  const sandbox = {
    window: {},
    document: { getElementById(id) { return Object.prototype.hasOwnProperty.call(values, id) ? { value: values[id] } : null; } },
    getActivePtId: () => activePatientId,
    stripSignatureBlock: text => String(text),
    _autoDraftStripCarried: text => String(text),
    currentVisitAthenaBinding: binding,
    currentSoap: displayed,
    currentFormat: 'soap',
    currentNoteProvenance: 'generated_soap',
    currentAthenaNote: differentSidecar,
    currentAthenaNoteProvenance: 'generated',
    currentAthenaNoteSourceFingerprint: ''
  };
  vm.createContext(sandbox);
  vm.runInContext(canonicalBlock(source, file) + `
    this.__api={
      validate:_mlsValidateAthenaNote,
      fromDisplay:_mlsAthenaCanonicalFromStandardNote,
      fingerprint:_mlsAthenaSourceFingerprint,
      write:_mlsAthenaCanonicalForWrite
    };`, sandbox, { filename: file });
  const api = sandbox.__api;

  const parsed = api.fromDisplay(displayed);
  eq(parsed.sections.map(section => section.key).join(','), 'hpi,ros,exam,assessment,plan', file + ': displayed note lost the exact outer destination order');
  ok(parsed.sections[4].text.includes('DIAGNOSIS:') && parsed.sections[4].text.includes('FINDINGS:') && parsed.sections[4].text.includes('DISCUSSION:'),
    file + ': compatible inner Plan labels were rejected or removed');
  eq(parsed.text, displayed, file + ': deterministic display conversion rewrote the clinician note');

  sandbox.currentAthenaNoteSourceFingerprint = api.fingerprint(binding);
  const beforeSoap = sandbox.currentSoap, beforeBox = values.noteBox;
  const preferred = api.write();
  eq(preferred.ok, true, file + ': source-proven displayed note was not writable');
  eq(preferred.text, displayed, file + ': a different model sidecar won over the reviewed displayed note');
  eq(sandbox.currentSoap, beforeSoap, file + ': write validation mutated currentSoap');
  eq(values.noteBox, beforeBox, file + ': write validation mutated the visible note');

  sandbox.currentAthenaNote = '';
  const recovered = api.write();
  eq(recovered.ok, true, file + ': source-proven generated display could not recover a missing canonical text');
  eq(recovered.text, displayed, file + ': missing-canonical recovery did not use the exact reviewed display');

  values.transcript += ' New text added after generation.';
  eq(api.write().ok, false, file + ': transcript mismatch reused the old source proof');
  eq(api.write().reason, 'canonical-source-changed', file + ': transcript mismatch reported the wrong refusal');
  values.transcript = 'Synthetic source transcript for the current visit.';

  values.contextBox = 'Changed context after generation.';
  eq(api.write().ok, false, file + ': context mismatch reused the old source proof');
  values.contextBox = 'Synthetic current-visit context.';

  activePatientId = 'patient-2';
  eq(api.write().ok, false, file + ': active-patient mismatch reused another patient source proof');
  activePatientId = 'patient-1';

  sandbox.currentAthenaNoteProvenance = 'stale';
  eq(api.write().ok, false, file + ': stale provenance auto-healed from display text');
  eq(api.write().reason, 'stale-canonical-provenance', file + ': stale provenance reported the wrong refusal');

  rejects(api, displayed.replace('\n\nROS:', '\n\nPLAN:\nPremature plan.\n\nROS:'), /duplicate plan|sections are missing or out of order/,
    file + ': duplicate/out-of-order outer destination');
  rejects(api, displayed.replace('\n\nEXAM:', '\n\nSUBJECTIVE:\nUnsupported wrapper.\n\nEXAM:'), /nested or wrapper heading/,
    file + ': wrapper heading inside the flat note');
  rejects(api, displayed.replace('\n\nASSESSMENT:', '\n\nPLAN:\nPremature plan.\n\nASSESSMENT:'), /duplicate plan|sections are missing or out of order/,
    file + ': out-of-order outer destination');

  ok(!/\b(?:fetch|aiCallRaw|generateNote|regenerateNote)\s*\(/.test(canonicalBlock(source, file)),
    file + ': deterministic canonical recovery unexpectedly invokes generation or network code');
}

console.log('PASS Athena reviewed display source: ' + checks + ' checks — exact five-field display wins, inner clinical labels survive, source/provenance mismatches refuse, note bytes stay unchanged, and recovery uses zero AI');

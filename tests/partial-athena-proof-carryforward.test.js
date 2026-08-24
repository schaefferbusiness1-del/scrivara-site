'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');
function between(start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, 'missing start: ' + start);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, 'missing end: ' + end);
  return source.slice(a, b);
}

const guardSource = between('var __mlsAthenaProofByKey={};', 'function savePatients');
const upsertSource = between('function upsertPatient(p){', '\nfunction ');
const stored = [];
const context = vm.createContext({
  Date,
  uns: key => 'acct::' + key,
  __mlsPtsStorageKey: key => key || 'acct::patients',
  __mlsPtsBatchByKey: {},
  __mlsPtsForeignBatch: () => null,
  __mlsPtsFlushBatch() {}, __mlsPtsArmBatch() {},
  getPatients: () => stored.slice(),
  savePatients: rows => { stored.length = 0; rows.forEach(row => stored.push(row)); },
  backendMode: () => false, bkToken: () => '', syncPatientToServer() {}
});
context.window = context;
context.globalThis = context;
vm.runInContext(
  guardSource + '\n' + upsertSource +
  '\nthis.upsertPatient=upsertPatient;this.guard=__mlsAthenaProofGuard;',
  context,
  { filename: 'partial-athena-proof-carryforward.js' }
);

function partial(at, fields) {
  return {
    kind: 'athena-partial-profile-coverage', version: '1.0.0', complete: false,
    exactIdentityVerified: true, patientId: 'patient-a', capturedAt: at,
    identityProof: 'name-dob', fields
  };
}

stored.push({
  id: 'patient-a', name: 'Mary Moreno',
  problems: 'Lumbar stenosis', meds: 'Meloxicam 15 mg', allergies: 'Manual latex note',
  athenaPartialProfileCoverage: partial('2026-08-24T15:00:00.000Z', {
    problems: { status: 'found', count: 1 }, meds: { status: 'found', count: 1 }
  })
});

context.upsertPatient({
  id: 'patient-a', name: 'Mary Moreno', problems: '', meds: '', allergies: 'New manual note'
});
let row = stored.find(item => item.id === 'patient-a');
assert.strictEqual(row.athenaPartialProfileCoverage.capturedAt, '2026-08-24T15:00:00.000Z',
  'a stale single-row upsert erased the partial receipt');
assert.strictEqual(row.problems, 'Lumbar stenosis', 'stale upsert erased a receipt-attested problem');
assert.strictEqual(row.meds, 'Meloxicam 15 mg', 'stale upsert erased a receipt-attested medication');
assert.strictEqual(row.allergies, 'New manual note', 'an unattested manual field was overwritten');

const fresh = {
  id: 'patient-a', problems: 'Lumbar stenosis', meds: 'Meloxicam 15 mg', allergies: 'Penicillin',
  athenaPartialProfileCoverage: partial('2026-08-24T16:00:00.000Z', {
    problems: { status: 'found', count: 1 }, meds: { status: 'found', count: 1 },
    allergies: { status: 'found', count: 1 }
  })
};
context.guard('acct::patients', [fresh]);
const staleBulk = {
  id: 'patient-a', problems: 'old problem', meds: 'old med', allergies: '',
  athenaPartialProfileCoverage: partial('2026-08-24T14:00:00.000Z', {
    problems: { status: 'found', count: 1 }, meds: { status: 'found', count: 1 }
  })
};
context.guard('acct::patients', [staleBulk]);
assert.strictEqual(staleBulk.athenaPartialProfileCoverage.capturedAt, '2026-08-24T16:00:00.000Z',
  'a stale bulk writer rolled back the partial receipt');
assert.strictEqual(staleBulk.problems, 'Lumbar stenosis');
assert.strictEqual(staleBulk.meds, 'Meloxicam 15 mg');
assert.strictEqual(staleBulk.allergies, 'Penicillin');

const otherAccount = { id: 'patient-a' };
context.guard('other::patients', [otherAccount]);
assert.strictEqual(otherAccount.athenaPartialProfileCoverage, undefined,
  'partial provenance leaked across account-scoped stores');

console.log('partial-athena-proof-carryforward: ok');

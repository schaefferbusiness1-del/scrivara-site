'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_athena_autopull.js'), 'utf8');
const context = {
  console, Date, Math, JSON, Object, String, Number, Array, RegExp, Promise,
  setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  addEventListener() {}, removeEventListener() {},
  document: { getElementById() { return null; }, createElement() { return {}; }, body: null, documentElement: null }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_athena_autopull.js' });

const api = context.__mlsAthenaAutoPull;
assert(api && api.version === '1.2.0', 'athena autopull v1.2.0 did not load');
assert.strictEqual(typeof api.partialCoverageReceipt, 'function');
assert.match(source, /patient\.athenaPartialProfileCoverage\s*=\s*partialReceipt/,
  'the verified fallback receipt is not wired into the patient write');

const patient = { id: 'patient-a', name: 'Mary Moreno', dob: '1967-06-01', mrn: '7731709' };
const identity = { name: 'Mary Moreno', dob: '06/01/1967', mrn: '7731709' };
const capture = {
  name: 'Moreno, Mary', dob: '1967-06-01', mrn: '7731709',
  medications: ['Meloxicam 15 mg'], problems: ['Lumbar stenosis'], allergies: ['Penicillin']
};
const receipt = api.partialCoverageReceipt(patient, capture, identity, '2026-08-24T15:00:00.000Z');
assert.deepStrictEqual(JSON.parse(JSON.stringify(receipt)), {
  kind: 'athena-partial-profile-coverage', version: '1.0.0', complete: false,
  exactIdentityVerified: true, patientId: 'patient-a', capturedAt: '2026-08-24T15:00:00.000Z',
  identityProof: 'name-dob',
  fields: {
    meds: { status: 'found', count: 1 },
    problems: { status: 'found', count: 1 },
    allergies: { status: 'found', count: 1 }
  }
});

assert.strictEqual(api.partialCoverageReceipt(patient, { ...capture, dob: '1970-01-01', mrn: '' }, identity), null,
  'a same-name/different-DOB banner minted provenance');
assert.strictEqual(api.partialCoverageReceipt(patient, { ...capture, name: 'Another Patient' }, identity), null,
  'a different patient banner minted provenance');
assert.strictEqual(api.partialCoverageReceipt(patient, { name: capture.name, dob: capture.dob }, identity), null,
  'a banner with no captured facts minted a meaningless partial receipt');
assert.strictEqual(api.partialCoverageReceipt({ ...patient, id: '' }, capture, identity), null,
  'an unbound patient record minted provenance');

const mrnReceipt = api.partialCoverageReceipt(
  patient,
  { ...capture, dob: '', mrn: '7731709' },
  { ...identity, dob: '', mrn: '7731709' },
  '2026-08-24T15:01:00.000Z'
);
assert.strictEqual(mrnReceipt.identityProof, 'name-mrn', 'stable-id fallback proof was lost');

console.log('athena-autopull-partial-provenance: ok');

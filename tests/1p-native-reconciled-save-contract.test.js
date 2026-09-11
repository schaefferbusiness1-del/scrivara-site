'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', '1p-feat_mls_writeflow.js'), 'utf8');
const start = source.indexOf('function nativeReconciledSaveResponse(');
const end = source.indexOf('function nativePersistedReceipt(', start);
assert(start >= 0 && end > start, 'native reconciliation contract seam missing');
const helperSource = source.slice(start, end).trim();
const S = value => String(value == null ? '' : value);
const accepts = Function('S', `${helperSource}; return nativeReconciledSaveResponse;`)(S);

function receipt() {
  return {
    ok: true, attempted: false, verified: true, saved: true, persisted: true, serverVerified: true,
    reason: 'exact-section-persistence-reconciled', sectionsDeclared: 5, persistedDestinations: 4,
    results: ['hpi','ros','exam','ap'].map(key => ({ ok: true, key, saved: true, persisted: true, verified: true }))
  };
}

assert.strictEqual(accepts(receipt()), true, 'actual read-only extension receipt was refused');
const attempted = receipt(); attempted.attempted = true;
assert.strictEqual(accepts(attempted), true, 'attempted:true compatibility receipt was refused');
for (const field of ['verified', 'serverVerified']) {
  const missing = receipt(); delete missing[field];
  assert.strictEqual(accepts(missing), false, `missing ${field} was accepted`);
  const falseValue = receipt(); falseValue[field] = false;
  assert.strictEqual(accepts(falseValue), false, `false ${field} was accepted`);
}
const missingResultVerification = receipt(); delete missingResultVerification.results[0].verified;
assert.strictEqual(accepts(missingResultVerification), false, 'unverified destination was accepted');
const falseResultVerification = receipt(); falseResultVerification.results[1].verified = false;
assert.strictEqual(accepts(falseResultVerification), false, 'false destination verification was accepted');
const duplicate = receipt(); duplicate.results[3].key = 'hpi';
assert.strictEqual(accepts(duplicate), false, 'duplicate destination key was accepted');
const missingRow = receipt(); missingRow.results.pop();
assert.strictEqual(accepts(missingRow), false, 'missing destination result was accepted');

for (const code of [
  'section-persistence-frame-changed', 'section-persistence-proof-ambiguous',
  'section-persistence-readback-missing', 'section-persistence-readback-ambiguous',
  'section-persistence-readback-mismatch'
]) {
  assert(source.includes(`'${code}'`), `${code} is missing from the closed help registry`);
}
assert(source.includes('All reviewed sections match the saved Athena note.'), 'verified copy exposes implementation counts');
assert(!source.includes('complete five-section to four-destination persistence proof'), 'failure copy exposes implementation counts');

console.log('PASS native reconciled save contract: exact verification and four unique saved-section results required');

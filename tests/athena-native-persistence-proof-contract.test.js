'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function extract(name, next) {
  const start = background.indexOf(`function ${name}(`), end = background.indexOf(`function ${next}(`, start);
  assert(start >= 0 && end > start, `${name} source seam missing`);
  return background.slice(start, end).trim();
}
const shapeSource = extract('nativeNamedPersistenceShape', 'gestureBatchSerial');
const clean = value => String(value == null ? '' : value).trim();
const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const shape = Function('clean', 'norm', `${shapeSource}; return nativeNamedPersistenceShape;`)(clean, norm);
const sections = [
  { key: 'plan', text: 'Plan body.', execute: true, destination: 'Athena encounter > Assessment & Plan > Plan / Follow-up' },
  { key: 'hpi', text: 'HPI body.', execute: true, destination: 'Athena encounter > HPI' },
  { key: 'assessment', text: 'Assessment body.', execute: true, destination: 'Athena encounter > Assessment & Plan > Assessment' },
  { key: 'exam', text: 'Exam body.', execute: true, destination: 'Athena encounter > Physical Exam' },
  { key: 'ros', text: 'ROS body.', execute: true, destination: 'Athena encounter > Review of Systems' }
];
const got = shape(sections);
assert(got, 'exact five-section manifest was refused');
assert.strictEqual(got.values.ap, 'Assessment:\nAssessment body.\n\nPlan / Follow-up:\nPlan body.', 'Assessment/Plan formatter drifted');
assert.strictEqual(got.sectionsDeclared, 5); assert.strictEqual(got.persistedDestinations, 4);
assert.strictEqual(shape(sections.slice(0, 4)), null, 'partial manifest entered native reconciliation');
assert.strictEqual(shape(sections.map((row, i) => i === 4 ? { ...row, key: 'hpi' } : row)), null, 'duplicate/missing section entered native reconciliation');
assert.strictEqual(shape(sections.map((row, i) => i === 0 ? { ...row, destination: 'Athena encounter > HPI' } : row)), null, 'wrong reviewed destination entered native reconciliation');

for (const binding of ['batchSerial', 'senderTabId', 'athenaTabId', 'patientKey', 'manifestHash', 'executionDocumentId', 'persistenceContextKey', 'sectionKey', 'sectionText', 'sectionDestination', 'frameTimeOrigin']) {
  assert(background.includes(`proof.${binding}`), `proof-set matcher omits ${binding}`);
}
assert(background.includes('target.documentIds = [clean(documentId)]'), 'execute is not pinned to the probed Chrome document');
assert(background.includes("reason: 'section-persistence-proof-missing'") && background.includes("reason: 'exact-section-persistence-reconciled'"), 'closed final receipts are missing');
assert(background.indexOf("if (nativeNamedSave && action === 'save_draft')") < background.indexOf("if (snvNamedSave && action === 'save_draft')"), 'legacy Save click precedes native reconciliation');
assert(content.includes('nativeNamedSectionPersistenceV1: true'), 'capability is not advertised');
assert(content.includes('verify\\s+saved\\s+unsigned\\s+note'), 'verification aria phrase cannot arm save_draft');
assert(!manifest.permissions.includes('webRequest'), 'native proof added a request interception permission');

const matcherStart = background.indexOf('async function matchingNativePersistenceProofSet(');
const matcherEnd = background.indexOf('async function noteWriteProofFailure(', matcherStart);
assert(matcherStart >= 0 && matcherEnd > matcherStart, 'native proof-set matcher source seam missing');
const matcherSource = background.slice(matcherStart, matcherEnd).trim();
const digits = value => clean(value).replace(/\D+/g, '');
const dateKey = value => clean(value).slice(0, 10);
const urlKey = value => clean(value).split('#')[0];
const patientKey = p => [clean(p && p.patientId), norm(p && p.name), dateKey(p && p.dob)].join('|');
const persistenceContextKey = c => [norm(c && c.patientName), dateKey(c && c.dob), digits(c && c.mrn), digits(c && c.appointmentId), digits(c && c.encounterId), urlKey(c && c.encounterUrl), dateKey(c && c.visitDate), norm(c && c.provider), clean(c && c.framePath)].join('|');
const patient = { patientId: 'local-synthetic', name: 'Synthetic Patient', dob: '1975-04-12' };
const context = { patientName: patient.name, dob: patient.dob, mrn: '700777', appointmentId: '8812777', encounterId: '9912777', encounterUrl: 'https://athenanet.athenahealth.com/one/two/ax/encounter/9912777/exam', visitDate: '2026-08-27', provider: 'Synthetic Clinician', framePath: 'top>owned' };
const cohort = { batchSerial: 'batch-9', senderTabId: 11, athenaTabId: 22, manifestHash: 'manifest-x', documentId: 'doc-x', frameTimeOrigin: 1900000000000 };

function runtimeMatcher(records, now) {
  const noteWriteProofs = records;
  const withTokenStateLock = fn => fn();
  const pruneExpiredAuthSessionUnlocked = async () => {
    Object.keys(noteWriteProofs).forEach(id => { if (Number(noteWriteProofs[id].expiresAt) <= now) delete noteWriteProofs[id]; });
  };
  const validPersistedNoteWriteProof = (id, proof) => !!proof && proof.proofId === id && proof.expiresAt > now;
  return Function('withTokenStateLock', 'pruneExpiredAuthSessionUnlocked', 'clean', 'persistenceContextKey', 'noteWriteProofs', 'validPersistedNoteWriteProof', 'patientKey', `${matcherSource}; return matchingNativePersistenceProofSet;`)(withTokenStateLock, pruneExpiredAuthSessionUnlocked, clean, persistenceContextKey, noteWriteProofs, validPersistedNoteWriteProof, patientKey);
}

function records(overrides) {
  const out = {};
  for (const key of ['hpi', 'ros', 'exam', 'ap']) {
    const id = `proof-${key}`;
    out[id] = {
      proofId: id, state: 'ready', used: false, issuedAt: 999000, expiresAt: 1010000,
      serverVerified: true, persisted: true, batchSerial: cohort.batchSerial,
      senderTabId: cohort.senderTabId, athenaTabId: cohort.athenaTabId,
      patientKey: patientKey(patient), manifestHash: cohort.manifestHash,
      executionDocumentId: cohort.documentId, persistenceContextKey: persistenceContextKey(context),
      sectionKey: key, sectionText: got.values[key], sectionDestination: got.destinations[key],
      frameTimeOrigin: cohort.frameTimeOrigin
    };
  }
  if (overrides) overrides(out);
  return out;
}

async function match(rows, changes) {
  const args = { ...cohort, patient, shape: got, context, ...(changes || {}) };
  return runtimeMatcher(rows, 1000000)(args.batchSerial, args.senderTabId, args.athenaTabId, args.patient, args.manifestHash, args.documentId, args.shape, args.context);
}

(async () => {
  assert.strictEqual((await match(records())).ok, true, 'exact four-proof cohort was refused');
  for (const [label, change] of [
    ['batch', { batchSerial: 'other-batch' }], ['manifest', { manifestHash: 'other-manifest' }],
    ['document', { documentId: 'other-document' }], ['context', { context: { ...context, framePath: 'top>reloaded' } }]
  ]) assert.strictEqual((await match(records(), change)).reason, 'section-persistence-proof-missing', `${label} mismatch was accepted`);
  assert.strictEqual((await match(records(rows => { rows['proof-hpi'].expiresAt = 999999; }))).reason, 'section-persistence-proof-missing', 'expired proof was accepted');
  assert.strictEqual((await match(records(rows => { delete rows['proof-ros']; }))).reason, 'section-persistence-proof-missing', 'missing section proof was accepted');
  assert.strictEqual((await match(records(rows => { rows['proof-hpi-copy'] = { ...rows['proof-hpi'], proofId: 'proof-hpi-copy' }; }))).reason, 'section-persistence-proof-ambiguous', 'duplicate section proof was accepted');
  assert.strictEqual((await match(records(rows => { rows['proof-ap'].frameTimeOrigin++; }))).reason, 'section-persistence-proof-mismatch', 'mixed inner-frame lifetime was accepted');
  const changedShape = { ...got, values: { ...got.values, hpi: got.values.hpi + ' changed' } };
  assert.strictEqual((await match(records(), { shape: changedShape })).reason, 'section-persistence-proof-missing', 'changed reviewed payload reused an old proof');
  console.log('PASS Athena native persistence proof contract: matcher executes exact cohort and refuses stale, ambiguous, or mismatched proofs');
})().catch(error => { console.error(error); process.exit(1); });

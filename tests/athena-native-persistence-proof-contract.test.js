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

console.log('PASS Athena native persistence proof contract: exact 5-to-4 mapping, full cohort/document/context binding, capability, zero new permission');

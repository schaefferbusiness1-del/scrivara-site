'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const document = {
  readyState: 'loading',
  body: {},
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; },
  createElement() { return {}; }
};
const window = {
  document,
  location: { origin: 'https://mlsscribe.com' },
  addEventListener() {},
  removeEventListener() {},
  postMessage() {},
  toast() {}
};
window.window = window;
function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
const ctx = {
  window, document, MutationObserver, console,
  setTimeout, clearTimeout, Date, Math, Promise, Object, Array, String, Number,
  RegExp, JSON, Uint32Array
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8'), ctx);

const wf = window.__mlsWriteFlow;
assert.strictEqual(typeof wf.buildUnifiedManifest, 'function');
assert.strictEqual(typeof wf.openUnifiedConfirmation, 'function');

const opts = {
  patient: { patientId: 'pt-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' },
  expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' },
  requireExpectedVisit: true,
  receiptSessionId: 'receipt-fixed',
  previewHash: 'mls-preview-fixed',
  plan: [
    { kind: 'note', body: 'NOTE TEXT:\nFull generated note.\nAssessment and plan remain intact.' },
    { kind: 'dx', body: 'ICD-10 DIAGNOSES:\n- M54.50' },
    { kind: 'billing', body: 'BILLING:\nE/M level: 99214\nCPT: 20610', billing: { emCode: '99214', cptCodes: ['20610'] } },
    { kind: 'orders', body: 'ORDERS:\n- MRI lumbar spine' },
    { kind: 'untyped_custom_route', body: 'Must never be sent generically' }
  ]
};

const manifest = wf.buildUnifiedManifest(opts);
assert.strictEqual(manifest.schema, 'mls-athena-write-manifest-v1');
assert.strictEqual(manifest.previewHash, 'mls-preview-fixed');
assert(Object.isFrozen(manifest));
assert(Object.isFrozen(manifest.patient));
assert(Object.isFrozen(manifest.visit));
assert(Object.isFrozen(manifest.rows));
assert(manifest.rows.every(row => Object.isFrozen(row) && Object.isFrozen(row.payload)));

const byAction = Object.fromEntries(manifest.rows.filter(row => row.action).map(row => [row.action, row]));
assert.strictEqual(byAction.write_note.capability, 'ready');
assert.strictEqual(byAction.save_draft.capability, 'ready');
assert.strictEqual(byAction.write_note.payload.noteText, 'Full generated note.\nAssessment and plan remain intact.');
assert(byAction.write_note.payloadHash && byAction.write_note.rowHash && manifest.manifestHash);

const billingRow = manifest.rows.find(row => row.id === 'stage-billing');
const signRow = manifest.rows.find(row => row.id === 'sign-encounter');
assert(billingRow && signRow, 'billing and signing review payloads must remain visible');
for (const row of [billingRow, signRow]) {
  assert.strictEqual(row.capability, 'manual', `${row.id} must remain manual`);
  assert.strictEqual(row.action, '', `${row.id} must never expose an executable action`);
  assert(/complete in Athena/i.test(row.reason), `${row.id} must explicitly say Complete in Athena`);
}
assert.deepStrictEqual(Array.from(billingRow.payload.billing.cptCodes), ['20610']);
assert(!manifest.rows.some(row => ['stage_billing', 'sign_encounter', 'place_order'].includes(row.action)), 'a final clinical/financial action leaked into an executable row');

const dx = manifest.rows.find(row => row.kind === 'dx');
const orders = manifest.rows.find(row => row.kind === 'orders');
const unknown = manifest.rows.find(row => row.kind === 'untyped_custom_route');
assert.strictEqual(dx.capability, 'manual');
assert.strictEqual(orders.capability, 'manual');
assert.strictEqual(unknown.capability, 'blocked');
assert(dx.payload.body.includes('M54.50'));
assert(orders.payload.body.includes('MRI lumbar spine'));
assert(unknown.payload.body.includes('Must never be sent'));

const same = wf.buildUnifiedManifest(opts);
assert.strictEqual(same.manifestHash, manifest.manifestHash, 'same frozen input must produce the same manifest hash');
assert.strictEqual(same.rows.map(row => row.rowHash).join('|'), manifest.rows.map(row => row.rowHash).join('|'));

assert.throws(() => { manifest.patient.name = 'Changed Patient'; }, TypeError);
assert.strictEqual(manifest.patient.name, 'Example Patient');

const historical = wf.buildUnifiedManifest({
  patient: opts.patient,
  requireExpectedVisit: true,
  receiptSessionId: 'historical-fixed',
  plan: opts.plan
});
for (const row of historical.rows.filter(row => row.action)) {
  assert.strictEqual(row.capability, 'blocked', `${row.action} must fail closed without original historical visit context`);
}

console.log('PASS unified Athena manifest: immutable payloads, only note write/save ready, exact billing/sign review rows manual, and unknowns blocked');

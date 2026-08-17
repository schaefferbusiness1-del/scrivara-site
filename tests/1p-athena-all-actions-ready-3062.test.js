'use strict';
/* 1p ALL-ACTIONS-READY CONTRACT (MLS Assist 3.0.62 / wsg-2.0.0, owner directive
   2026-08-12): does the 1p writeflow render every action READY (write_note, save_draft,
   stage_billing, sign_encounter, place_order) with the 3.0.62 capabilities, and
   fall back honestly without them? Runs the REAL 1p-feat_mls_writeflow.js in a
   vm, both ways. Synthetic data only. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

function boot(caps) {
  const document = { readyState: 'loading', body: {}, addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, createElement() { return {}; } };
  const window = { document, location: { origin: 'https://mlsscribe.com', hostname: 'mlsscribe.com' }, addEventListener() {}, removeEventListener() {}, postMessage() {}, toast() {} };
  window.window = window;
  if (caps) window.__mlsExtensionCapabilities = Object.freeze(caps);
  function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
  const ctx = { window, document, MutationObserver, console, setTimeout, clearTimeout, Date, Math, Promise, Object, Array, String, Number, RegExp, JSON, Uint32Array };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8'), ctx);
  return window.__mlsWriteFlow;
}
const order = { id: 'ord-1', type: 'imaging', reviewStatus: 'accepted', source: 'provider-entered', clientOrderId: 'ord-1', displayLabel: 'MRI Lumbar spine', query: 'MRI Lumbar spine', catalogCode: 'MRI-LS', catalogId: '', fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Radiculopathy' }, complete: true };
const opts = {
  patient: { patientId: 'pt-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' },
  expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' },
  requireExpectedVisit: true, receiptSessionId: 'receipt-fixed', previewHash: 'mls-preview-fixed',
  plan: [
    { kind: 'note', body: 'NOTE TEXT:\nFull generated note.' },
    { kind: 'billing', body: 'BILLING:\nE/M level: 99214\nCPT: 20610', billing: { emCode: '99214', cptCodes: ['20610'] } },
    { kind: 'orders', body: 'ORDERS', orderDrafts: [order, { id: 'ord-med', type: 'medication', reviewStatus: 'accepted', source: 'provider-entered', clientOrderId: 'ord-med', fields: { drug: 'ibuprofen' }, complete: true }], orderSuggestions: [] }
  ]
};
function summarize(m) { return m.rows.map(r => `${r.id}:${r.action || '-'}:${r.capability}`).join(' | '); }

const capable = boot({ supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true }).buildUnifiedManifest(opts);
console.log('CAPABLE  ', summarize(capable));
const byId = Object.fromEntries(capable.rows.map(r => [r.id, r]));
assert.strictEqual(byId['write-note'].capability, 'ready');
assert.strictEqual(byId['save-draft'].capability, 'ready');
assert.strictEqual(byId['stage-billing'].action, 'stage_billing'); assert.strictEqual(byId['stage-billing'].capability, 'ready');
assert.strictEqual(byId['sign-encounter'].action, 'sign_encounter'); assert.strictEqual(byId['sign-encounter'].capability, 'ready');
const orderRow = capable.rows.find(r => r.action === 'place_order');
assert(orderRow, 'no typed place_order row'); assert.strictEqual(orderRow.capability, 'ready'); assert.strictEqual(orderRow.payload.order.clientOrderId, 'ord-1');
const medRow = capable.rows.find(r => r.kind === 'orders' && r.action === '' && /medication|Medication/.test(r.label + r.reason));
assert(medRow && medRow.capability === 'manual', 'medication order must stay manual (no adapter)');
assert(/no typed MLS adapter/.test(medRow.reason), 'medication reason must name the adapter gap, not policy: ' + medRow.reason);
for (const r of capable.rows) assert(!/MLS does not stage billing|never clicks it|MLS does not place|never becomes an MLS action/.test(r.reason + r.consequence), 'old policy text leaked into capable row ' + r.id + ': ' + r.reason + ' / ' + r.consequence);

const stale = boot({ supervisedOrderPlacementV2: true, destinationTeachingV2: true }).buildUnifiedManifest(opts);
console.log('OLD-EXT  ', summarize(stale));
const s = Object.fromEntries(stale.rows.map(r => [r.id, r]));
assert.strictEqual(s['stage-billing'].action, ''); assert.strictEqual(s['stage-billing'].capability, 'manual'); assert(/Update MLS Assist/.test(s['stage-billing'].reason));
assert.strictEqual(s['sign-encounter'].action, ''); assert(/Update MLS Assist/.test(s['sign-encounter'].reason));
assert(!stale.rows.some(r => r.action === 'place_order'), 'old extension must not get a typed order row');
const staleOrder = stale.rows.find(r => r.kind === 'orders' && /MRI/.test(r.label));
assert(staleOrder && staleOrder.capability === 'manual' && /Update MLS Assist/.test(staleOrder.reason), 'stale order row must name the cure: ' + (staleOrder && staleOrder.reason));

/* identity-missing must still block EVERY typed row, capability or not */
const noMrn = boot({ supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true }).buildUnifiedManifest({ ...opts, patient: { ...opts.patient, mrn: '' } });
for (const r of noMrn.rows) if (r.action) assert.strictEqual(r.capability, 'blocked', 'identity gate must block ' + r.id);
console.log('NO-MRN   ', summarize(noMrn));
console.log('PASS 1p all actions ready (3.0.62): capable = 5 typed READY rows (note, billing, save, sign, order); old extension = honest manual + Update MLS Assist; missing MRN blocks every typed row.');

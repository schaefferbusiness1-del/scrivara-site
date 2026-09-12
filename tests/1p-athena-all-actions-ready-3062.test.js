'use strict';
/* Legacy filename, current policy contract (owner ruling 2026-09-02): even a
   legacy extension capability advertisement cannot make signing, billing, or
   orders executable. The real 1p writeflow must expose exactly write_note and
   save_draft while retaining the other reviewed payloads for direct Athena
   entry. Runs both capability shapes with synthetic data only. */
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

const legacyCaps = boot({ supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true }).buildUnifiedManifest(opts);
console.log('LEGACY-CAPS', summarize(legacyCaps));
const byId = Object.fromEntries(legacyCaps.rows.map(r => [r.id, r]));
assert.strictEqual(byId['write-note'].capability, 'ready');
assert.strictEqual(byId['save-draft'].capability, 'ready');
assert.strictEqual(byId['stage-billing'].action, ''); assert.strictEqual(byId['stage-billing'].capability, 'manual');
assert.strictEqual(byId['sign-encounter'].action, ''); assert.strictEqual(byId['sign-encounter'].capability, 'manual');
const orderRow = byId['order-draft-2-0'];
assert(orderRow, 'reviewed order row disappeared'); assert.strictEqual(orderRow.action, ''); assert.strictEqual(orderRow.capability, 'manual'); assert.strictEqual(orderRow.payload.order.clientOrderId, 'ord-1');
assert(/directly in Athena|direct entry in Athena/i.test(orderRow.reason + ' ' + orderRow.consequence), 'reviewed order does not name the manual destination');
const medRow = legacyCaps.rows.find(r => r.kind === 'orders' && r.action === '' && /medication|Medication/.test(r.label + r.reason));
assert(medRow && medRow.capability === 'manual', 'medication order must stay manual (no adapter)');
assert(/no typed MLS adapter/.test(medRow.reason), 'medication reason must name the adapter gap, not policy: ' + medRow.reason);
for (const r of legacyCaps.rows) assert(!/Update MLS Assist|until then/i.test(r.reason + r.consequence), 'manual policy falsely advertises an extension upgrade in ' + r.id + ': ' + r.reason + ' / ' + r.consequence);

const stale = boot({ supervisedOrderPlacementV2: true, destinationTeachingV2: true }).buildUnifiedManifest(opts);
console.log('OLD-EXT  ', summarize(stale));
const s = Object.fromEntries(stale.rows.map(r => [r.id, r]));
assert.strictEqual(s['stage-billing'].action, ''); assert.strictEqual(s['stage-billing'].capability, 'manual'); assert(/directly in Athena/i.test(s['stage-billing'].reason + ' ' + s['stage-billing'].consequence));
assert.strictEqual(s['sign-encounter'].action, ''); assert(/yourself in Athena|directly in Athena/i.test(s['sign-encounter'].reason + ' ' + s['sign-encounter'].consequence));
assert(!stale.rows.some(r => r.action === 'place_order'), 'old extension must not get a typed order row');
const staleOrder = stale.rows.find(r => r.kind === 'orders' && /MRI/.test(r.label));
assert(staleOrder && staleOrder.capability === 'manual' && /directly in Athena|direct entry in Athena/i.test(staleOrder.reason + ' ' + staleOrder.consequence), 'manual order row must name the Athena destination: ' + (staleOrder && staleOrder.reason));

/* identity-missing must still block EVERY typed row, capability or not */
const noMrn = boot({ supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true }).buildUnifiedManifest({ ...opts, patient: { ...opts.patient, mrn: '' } });
for (const r of noMrn.rows) if (r.action) assert.strictEqual(r.capability, 'blocked', 'identity gate must block ' + r.id);
console.log('NO-MRN   ', summarize(noMrn));
console.log('PASS current Athena action policy: legacy capabilities cannot override note/save-only execution; billing, signing, and orders stay visible and manual; missing MRN blocks every executable row.');

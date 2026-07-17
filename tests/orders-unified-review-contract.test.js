'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const flowSource = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
const scribeSource = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const document = {
  readyState: 'loading', body: {}, addEventListener() {}, getElementById() { return null; },
  querySelectorAll() { return []; }, createElement() { return {}; }
};
const window = { document, location: { origin: 'https://mlsscribe.com' }, __mlsExtensionCapabilities: { supervisedOrderPlacementV2: true }, addEventListener() {}, removeEventListener() {}, postMessage() {}, toast() {} };
window.window = window;
function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
const ctx = { window, document, MutationObserver, console, setTimeout, clearTimeout, Date, Math, Promise, Object, Array, String, Number, RegExp, JSON, Uint32Array };
vm.createContext(ctx);
vm.runInContext(flowSource, ctx);

const manifest = window.__mlsWriteFlow.buildUnifiedManifest({
  patient: { name: 'Example Patient', dob: '01/02/1980', mrn: '123', patientId: 'local-patient-exact-7' },
  expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' },
  receiptSessionId: 'orders-review-fixed', previewHash: 'orders-review-preview',
  plan: [{
    kind: 'orders', body: 'Order review',
    orderDrafts: [{
      clientOrderId: 'order-reviewed-imaging-1', displayLabel: 'MRI Lumbar spine', query: 'MRI Lumbar spine',
      catalogCode: '', catalogId: 'athena-catalog-imaging-1', reviewStatus: 'accepted',
      type: 'imaging', fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Persistent radicular pain' },
      summary: 'MRI lumbar spine', source: 'ai-suggestion-accepted', originalText: 'MRI lumbar spine'
    }, {
      type: 'medication', fields: { drug: '', dose: '300 mg' }, complete: false,
      summary: 'Incomplete medication draft', source: 'provider-entered'
    }],
    orderSuggestions: [{
      type: 'referral', fields: { specialty: 'Neurosurgery', reason: 'Review after MRI' },
      summary: 'Consider neurosurgery referral', source: 'ai-suggestion', originalText: 'Consider neurosurgery referral'
    }]
  }]
});

const orders = manifest.rows.filter(row => row.payload.category === 'order');
assert.strictEqual(orders.length, 3, 'reviewed drafts, incomplete drafts, and unaccepted suggestions must all be frozen into the final manifest');
const reviewed = orders.find(row => row.payload.reviewStatus === 'accepted / reviewed draft');
const incomplete = orders.find(row => row.payload.reviewStatus === 'incomplete reviewed draft');
const suggestion = orders.find(row => /suggestion only/i.test(row.payload.reviewStatus));
assert(reviewed && incomplete && suggestion, 'order status separation is missing');
assert.strictEqual(manifest.patient.patientId, 'local-patient-exact-7', 'immutable frontend manifest lost the local patient id');
assert(Object.isFrozen(manifest.patient), 'frontend patient binding must be immutable');
assert.strictEqual(reviewed.capability, 'ready', 'complete canonical supported order should expose the dedicated typed adapter');
assert.strictEqual(reviewed.action, 'place_order', 'complete canonical supported order did not receive the single-order action');
assert.strictEqual(reviewed.payload.fields.indication, 'Persistent radicular pain');
assert.strictEqual(reviewed.payload.order.clientOrderId, 'order-reviewed-imaging-1');
assert.strictEqual(reviewed.payload.order.query, 'MRI Lumbar spine');
assert(/Orders > Imaging/.test(reviewed.destination), 'order-specific proposed destination is missing');
assert(/Accepted AI suggestion/.test(reviewed.source), 'accepted source label is missing');
assert.strictEqual(incomplete.capability, 'blocked', 'incomplete reviewed order must fail closed');
assert.strictEqual(incomplete.action, '', 'incomplete reviewed order must not gain an executable action');
assert.strictEqual(incomplete.payload.complete, false, 'incomplete status was lost from the immutable payload');
assert(/required|incomplete|blocked|adapter/i.test(incomplete.reason));
assert.strictEqual(suggestion.capability, 'blocked', 'unaccepted AI suggestion must be blocked');
assert.strictEqual(suggestion.action, '', 'unaccepted AI suggestion must never be executable');
assert(/not accepted/i.test(suggestion.reason));
assert(/AI suggestion \(not accepted\)/.test(suggestion.source));
assert(Object.isFrozen(reviewed.payload.fields), 'complete order payload must be immutable');
assert(Object.isFrozen(reviewed.payload.order) && Object.isFrozen(reviewed.payload.order.fields), 'canonical executable order must be immutable');
assert.strictEqual(orders.filter(row => row.action === 'place_order').length, 1, 'one reviewed order row should expose exactly one typed order action');

window.__mlsExtensionCapabilities = {};
const oldClientManifest = window.__mlsWriteFlow.buildUnifiedManifest({
  patient: { name: 'Example Patient', dob: '01/02/1980', mrn: '123', patientId: 'local-patient-exact-7' },
  expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' },
  previewHash: 'orders-old-client-preview',
  plan: [{ kind: 'orders', orderDrafts: [{
    clientOrderId: 'order-old-client', displayLabel: 'MRI Lumbar spine', query: 'MRI Lumbar spine', catalogId: 'athena-catalog-imaging-1',
    reviewStatus: 'accepted', type: 'imaging', fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Pain' }, source: 'provider-entered'
  }], orderSuggestions: [] }]
});
const oldClientOrder = oldClientManifest.rows.find(row => row.payload.category === 'order');
assert.strictEqual(oldClientOrder.capability, 'blocked', 'version-only/older clients must never expose the executable order action');
assert.strictEqual(oldClientOrder.action, '', 'capability-missing client received place_order');
assert(/Update MLS Assist/i.test(oldClientOrder.reason), 'capability-missing row does not explain the update/manual route');
window.__mlsExtensionCapabilities = { supervisedOrderPlacementV2: true };

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' function is missing');
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Could not extract ' + name);
}

let unifiedCalls = 0, capturedOptions = null;
const exactBinding = Object.freeze({
  id: 'visit-binding-orders-7', patient: Object.freeze({ name: 'Example Patient', dob: '01/02/1980', mrn: '123', patientId: 'local-patient-exact-7' }),
  historical: false, noteTimestamp: 1770000000000,
  visitContext: Object.freeze({ visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: 'appt-7' })
});
const sendContext = {
  currentOrders: [{ type: 'imaging', fields: { study: 'MRI' } }], aiSuggestedOrders: ['Consider referral'],
  _athenaBoundVisitForAction() { return exactBinding; },
  _athenaOrderReviewBundle() {
    return {
      drafts: [{ type: 'imaging', fields: { study: 'MRI' }, summary: 'MRI lumbar spine', source: 'provider-entered', complete: true }],
      suggestions: [{ type: 'referral', fields: {}, summary: 'Consider referral', source: 'ai-suggestion', complete: false }]
    };
  },
  toast() {}, console, Date, Math, Object, Array, String,
  window: { __mlsWriteFlow: { openUnifiedConfirmation(opts) { unifiedCalls++; capturedOptions = opts; return { manifestId: 'one-review' }; } } }
};
vm.createContext(sendContext);
const sendOrdersSource = extractFunction(scribeSource, 'sendOrdersToEMR');
vm.runInContext(sendOrdersSource + '\nthis.sendOrdersToEMR = sendOrdersToEMR;', sendContext);
sendContext.sendOrdersToEMR(null);
assert.strictEqual(unifiedCalls, 1, 'Orders button must open exactly one unified review');
assert(capturedOptions && capturedOptions.plan && capturedOptions.plan.length === 1, 'Orders button did not hand off one structured orders plan');
assert.strictEqual(capturedOptions.patient.patientId, 'local-patient-exact-7', 'Orders button lost the exact local patient id before manifest freeze');
assert(Object.isFrozen(capturedOptions.patient), 'Orders button patient snapshot is mutable');
assert.strictEqual(capturedOptions.plan[0].orderDrafts.length, 1, 'reviewed drafts were not carried to the unified review');
assert.strictEqual(capturedOptions.plan[0].orderSuggestions.length, 1, 'suggestion-only rows were not carried to the unified review');
assert(!/sendToEMRviaAssist|\{\s*text\s*:/.test(sendOrdersSource), 'Orders button still has a generic text writer route');

assert(flowSource.includes('Orders proposed for Athena'), 'compact final-review Orders summary is missing');
assert(flowSource.includes('Review complete proposed order'), 'order details are not expandable in the final review');
assert(flowSource.includes('<b>Source:</b>') && flowSource.includes('<b>Handled by:</b>'), 'compact summary omits source or the handled-by capability disclosure'); /* b387 commercial copy: "Capability: BLOCKED" became "Handled by: you, in athenaOne" - same disclosure, human wording */
assert(!/renderAiSuggestedOrders\(so\);\s*try\s*\{\s*_autoSaveAiOrders\(/.test(scribeSource), 'generation still auto-accepts AI order suggestions');
assert(/function _autoSaveAiOrders\(\)\{\s*return false;\s*\}/.test(scribeSource), 'legacy auto-save hook is not fail-closed');
assert(scribeSource.includes("_source:'ai-suggestion', _reviewStatus:'accepted'"), 'explicit AI-suggestion acceptance is not recorded');
assert(scribeSource.includes('orderDrafts:orderReview.drafts,orderSuggestions:orderReview.suggestions'), 'active visit does not pass structured orders into the unified review');
assert(flowSource.includes('function bridgePatient(p)'), 'patient binding bridge helper is missing');
assert(/patientId:\s*S\(p\.patientId/.test(flowSource), 'local patient audit ID does not cross the supervised bridge');

console.log('PASS Orders final review: one immutable exact-patient review, one typed supported order action, blocked incomplete/suggestion rows, and manual high-risk orders');

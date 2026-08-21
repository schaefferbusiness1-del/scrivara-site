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
const window = { document, location: { origin: 'https://mlsscribe.com' }, __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true }, addEventListener() {}, removeEventListener() {}, postMessage() {}, toast() {} };
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
assert.strictEqual(reviewed.capability, 'ready', 'a complete canonical order with both extension capabilities must expose one supervised ready row');
assert.strictEqual(reviewed.action, 'place_order', 'the capable reviewed order lost its typed place_order action');
assert.strictEqual(reviewed.reason, '', 'a capable exact order is incorrectly described as blocked or manual');
assert.strictEqual(reviewed.payload.fields.indication, 'Persistent radicular pain');
assert.strictEqual(reviewed.payload.order.clientOrderId, 'order-reviewed-imaging-1');
assert.strictEqual(reviewed.payload.order.query, 'MRI Lumbar spine');
assert(/Orders > Imaging/.test(reviewed.destination), 'order-specific proposed destination is missing');
assert(/Accepted AI suggestion/.test(reviewed.source), 'accepted source label is missing');
assert.strictEqual(incomplete.capability, 'manual', 'incomplete high-risk medication review must stay manual');
assert.strictEqual(incomplete.action, '', 'incomplete reviewed order must not gain an executable action');
assert.strictEqual(incomplete.payload.complete, false, 'incomplete status was lost from the immutable payload');
assert(/Complete in Athena/i.test(incomplete.reason));
assert.strictEqual(suggestion.capability, 'blocked', 'unaccepted AI suggestion must be blocked');
assert.strictEqual(suggestion.action, '', 'unaccepted AI suggestion must never be executable');
assert(/not accepted/i.test(suggestion.reason));
assert(/AI suggestion \(not accepted\)/.test(suggestion.source));
assert(Object.isFrozen(reviewed.payload.fields), 'complete order payload must be immutable');
assert(Object.isFrozen(reviewed.payload.order) && Object.isFrozen(reviewed.payload.order.fields), 'canonical reviewed order must be immutable');
assert.strictEqual(orders.filter(row => row.action === 'place_order').length, 1, 'exactly one complete, catalog-bound reviewed order must expose place_order');

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
assert.strictEqual(oldClientOrder.capability, 'manual', 'extension capability must not change a manual order into an executable action');
assert.strictEqual(oldClientOrder.action, '', 'capability-missing client received place_order');
assert(/Update MLS Assist/i.test(oldClientOrder.reason) && /manual entry/i.test(oldClientOrder.reason), 'capability-missing row must truthfully name the update and preserve a manual route');
window.__mlsExtensionCapabilities = { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true };

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
  /* fixture updated 2026-07-22: imaging orders now require study+region+
     indication — an incomplete order must never reach the EMR review at all
     (asserted below), so the happy path uses a complete one. */
  currentOrders: [{ type: 'imaging', fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Persistent low back pain' } }], aiSuggestedOrders: ['Consider referral'],
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

/* 2026-07-22: incomplete orders must be refused at the EMR-review boundary
   with a visible error, before any binding or manifest work. */
assert(sendOrdersSource.includes("_ordersBlockedMsg('reviewing the EMR route')"), 'EMR review lost its incomplete-order guard');
assert(scribeSource.includes('function orderMissingFields(type,fields)'), 'canonical required-field validator is missing');
assert(scribeSource.includes("{key:'study', label:'Study', type:'select', req:1, opts:['','X-ray'"), 'imaging study select lost its blank required placeholder');
{
  const blockedCallsBefore = unifiedCalls;
  const blockedToasts = [];
  const blockedContext = {
    currentOrders: [{ type: 'imaging', fields: { study: 'X-ray' } }], aiSuggestedOrders: [],
    _ordersBlockedMsg(action) { return 'Complete or remove the incomplete order before ' + action + '.'; },
    _athenaBoundVisitForAction() { throw new Error('binding must not be resolved for invalid drafts'); },
    _athenaOrderReviewBundle() { throw new Error('review bundle must not be built for invalid drafts'); },
    toast(message, type) { blockedToasts.push({ message, type }); },
    console, Date, Math, Object, Array, String,
    window: { __mlsWriteFlow: { openUnifiedConfirmation() { unifiedCalls++; return { manifestId: 'should-not-open' }; } } }
  };
  vm.createContext(blockedContext);
  vm.runInContext(sendOrdersSource + '\nthis.sendOrdersToEMR = sendOrdersToEMR;', blockedContext);
  const blockedResult = blockedContext.sendOrdersToEMR(null);
  assert.strictEqual(blockedResult, null, 'invalid order draft still opened the EMR review');
  assert.strictEqual(unifiedCalls, blockedCallsBefore, 'invalid order draft reached the unified confirmation');
  assert(blockedToasts.length === 1 && /incomplete order/.test(blockedToasts[0].message) && blockedToasts[0].type === 'err', 'invalid order refusal was not a visible error');
}

assert(flowSource.includes('Orders proposed for Athena'), 'compact final-review Orders summary is missing');
assert(flowSource.includes('Review complete proposed order'), 'order details are not expandable in the final review');
assert(flowSource.includes('<b>Source:</b>') && flowSource.includes('<b>Handled by:</b>'), 'compact summary omits source or the handled-by capability disclosure'); /* b387 commercial copy: "Capability: BLOCKED" became "Handled by: you, in athenaOne" - same disclosure, human wording */
assert(!/renderAiSuggestedOrders\(so\);\s*try\s*\{\s*_autoSaveAiOrders\(/.test(scribeSource), 'generation still auto-accepts AI order suggestions');
assert(/function _autoSaveAiOrders\(\)\{\s*return false;\s*\}/.test(scribeSource), 'legacy auto-save hook is not fail-closed');
assert(scribeSource.includes("_source:'ai-suggestion', _reviewStatus:'accepted'"), 'explicit AI-suggestion acceptance is not recorded');
assert(scribeSource.includes('orderDrafts:orderReview.drafts,orderSuggestions:orderReview.suggestions'), 'active visit does not pass structured orders into the unified review');
assert(flowSource.includes('function bridgePatient(p)'), 'patient binding bridge helper is missing');
assert(/patientId:\s*S\(p\.patientId/.test(flowSource), 'local patient audit ID does not cross the supervised bridge');

/* oa-1.0.0 (owner 2026-07-22): a suggestion row must carry a review-and-accept
   control; acceptance is recorded app-side immediately, the review reopens
   with the item as an accepted draft, and it is never re-asked. Acceptance is
   a recorded decision only — it never performs placement by itself. */
assert(flowSource.includes('data-mls-accept-order='), 'suggestion rows lost their review-and-accept button');
assert(flowSource.includes('function acceptUnifiedSuggestion(state, rowId, btn)'), 'the unified accept handler is missing');
assert(/typeof window\._athenaAcceptProposedOrder === 'function'/.test(flowSource), 'the accept button must exist only when the app can record acceptance');
assert(flowSource.includes("unifiedStatus(state, 'Acceptance was NOT recorded'"), 'a failed acceptance must fail closed with a visible refusal');
assert(/next\.previewHash = ''/.test(flowSource), 'the reopened review must recompute its preview hash after acceptance');
assert(!/acceptUnifiedSuggestion[\s\S]{0,2400}(executeUnifiedSelection|mlsAppAthenaActionV2|place_order)/.test(flowSource.slice(flowSource.indexOf('function acceptUnifiedSuggestion'), flowSource.indexOf('function acceptUnifiedSuggestion') + 3200)), 'acceptance must never trigger an Athena action');
for (const [label, source] of [['ScribeFlow', scribeSource], ['ScribeFlow-staging', fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8')]]) {
  assert(source.includes('function _athenaAcceptProposedOrder(desc)'), label + ' is missing the acceptance recorder');
  assert(source.includes('window._athenaAcceptProposedOrder=_athenaAcceptProposedOrder'), label + ' does not expose the acceptance recorder to the unified review');
  assert(/already-accepted/.test(source), label + ' acceptance recorder is not idempotent');
}
{
  /* runtime: the recorder must accept a type-less suggestion (no ORDER_DEFS
     entry), be idempotent, and stamp a legacy un-reviewed order in place. */
  const recCtx = {
    currentOrders: [{ id: 'oLegacy', type: 'imaging', fields: {}, _src: 'MRI right knee', _ai: true }],
    ORDER_DEFS: { imaging: { fields: [{ key: 'study' }] } },
    parseSuggestedOrder(text) { return /MRI/.test(text) ? { type: 'imaging', fields: { study: 'MRI' } } : { type: 'mystery_modality', fields: { anything: 'x' } }; },
    renderOrderList() {}, updateNavCounts() {},
    window: {}, console, Date, Math, Object, Array, String
  };
  vm.createContext(recCtx);
  const recSource = extractFunction(scribeSource, '_athenaAcceptProposedOrder');
  vm.runInContext(recSource + '\nthis._athenaAcceptProposedOrder = _athenaAcceptProposedOrder;', recCtx);
  const legacy = recCtx._athenaAcceptProposedOrder({ originalText: 'MRI right knee' });
  assert(legacy.ok === true && legacy.mode === 'legacy-accepted', 'legacy _ai order was not stamped accepted in place: ' + JSON.stringify(legacy));
  assert.strictEqual(recCtx.currentOrders[0]._reviewStatus, 'accepted', 'legacy order reviewStatus not recorded');
  const again = recCtx._athenaAcceptProposedOrder({ originalText: 'MRI right knee' });
  assert(again.ok === true && again.mode === 'already-accepted', 'second acceptance must be a no-op acknowledgement');
  assert.strictEqual(recCtx.currentOrders.length, 1, 'idempotent acceptance duplicated the order');
  const typeless = recCtx._athenaAcceptProposedOrder({ originalText: 'Custom bracing protocol', source: 'ai-suggestion' });
  assert(typeless.ok === true && typeless.mode === 'accepted', 'a suggestion without a builder form must still be acceptable: ' + JSON.stringify(typeless));
  assert.strictEqual(recCtx.currentOrders.length, 2, 'accepted suggestion was not recorded');
  assert.strictEqual(recCtx.currentOrders[1]._reviewStatus, 'accepted', 'accepted suggestion is missing its review status');
  const empty = recCtx._athenaAcceptProposedOrder({});
  assert(empty.ok === false, 'an empty descriptor must be refused');
}

console.log('PASS Orders final review: immutable exact-patient payloads, one capable typed order ready, older clients/manual/high-risk/incomplete/suggestion rows safe, and acceptance recorded once');

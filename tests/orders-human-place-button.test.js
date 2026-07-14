'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function extractFunction(text, name) {
  const start = text.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' function is missing');
  const brace = text.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('Could not extract ' + name);
}

const candidateSource = extractFunction(source, '_athenaOrderPlacementCandidate');
const visitSource = extractFunction(source, '_athenaOrderPlacementVisitSnapshot');
const capabilitySource = extractFunction(source, '_athenaOrderPlacementCapabilityReady');
const controlSource = extractFunction(source, '_athenaOrderPlacementControl');
const placeSource = extractFunction(source, 'reviewAndPlaceOrderInAthena');

let confirmationCalls = 0;
let directActionCalls = 0;
let captured = null;
const toasts = [];
const exactBinding = Object.freeze({
  id: 'visit-bind-exact-42',
  patient: Object.freeze({
    name: 'Adam J Schaeffer', dob: '01/02/1980', mrn: 'MRN-4242', patientId: 'local-patient-42'
  }),
  historical: false,
  noteTimestamp: 1784000000000,
  displayDate: '2026-07-14',
  displayProvider: 'Matthew Schaeffer, MD',
  visitContext: Object.freeze({
    visitDate: '2026-07-14', provider: 'Matthew Schaeffer, MD', appointmentId: '', encounterId: '', encounterUrl: ''
  })
});

const safeOrder = {
  id: 'order-safe-1', type: 'imaging', _source: 'provider-entered', _reviewStatus: 'accepted',
  catalogId: 'athena-catalog-imaging-17',
  fields: {
    study: 'MRI', region: 'Lumbar spine', indication: 'Persistent right S1 radiculopathy',
    notes: 'Without contrast', untrustedExtra: 'must never enter the typed payload'
  }
};
const incompleteOrder = {
  id: 'order-incomplete-1', type: 'imaging', _source: 'provider-entered', _reviewStatus: 'accepted',
  fields: { study: 'MRI', region: 'Lumbar spine', indication: '' }
};
const medicationOrder = {
  id: 'order-rx-1', type: 'medication', _source: 'provider-entered', _reviewStatus: 'accepted',
  fields: { drug: 'Gabapentin', dose: '300 mg', route: 'PO', freq: 'TID', qty: '90' }
};
const suggestionOnly = {
  id: 'order-suggestion-1', type: 'referral', _source: 'ai-suggestion', _ai: true,
  fields: { specialty: 'Neurosurgery', reason: 'Review MRI and progressive weakness' }
};

const context = {
  console, Object, Array, String, Number, Date, Math, RegExp, JSON,
  encodeURIComponent, decodeURIComponent,
  currentVisitAthenaBinding: exactBinding,
  currentVisitAthenaCompromised: false,
  currentOrders: [safeOrder, incompleteOrder, medicationOrder, suggestionOnly],
  _athenaCurrentMatchesBound(binding) { return binding === exactBinding; },
  _athenaBoundVisitForAction() { return exactBinding; },
  orderSummary(order) {
    const f = order.fields || {};
    if (order.type === 'imaging') return [f.study, f.region].filter(Boolean).join(' ') + (f.indication ? ' — ' + f.indication : '');
    if (order.type === 'pt') return 'Physical therapy for ' + f.dx + ' · ' + f.freq + ' x ' + f.duration + ' · ' + f.modalities;
    if (order.type === 'dme') return f.item + ' — ' + f.dx + ' (' + f.icd + ')';
    if (order.type === 'referral') return 'Referral to ' + f.specialty + ' — ' + f.reason;
    return order.type || '';
  },
  esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
  toast(message, kind) { toasts.push({ message: String(message), kind: kind || '' }); },
  window: {
    __mlsExtensionCapabilities: { supervisedOrderPlacementV2: true },
    __mlsWriteFlow: {
      openUnifiedConfirmation(options) {
        confirmationCalls++;
        captured = options;
        return { manifestId: 'one-order-confirmation' };
      },
      startAthenaAction() {
        directActionCalls++;
        throw new Error('The row button must never perform a direct Athena action');
      }
    }
  }
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(
  [candidateSource, visitSource, capabilitySource, controlSource, placeSource,
    'this._athenaOrderPlacementCandidate=_athenaOrderPlacementCandidate;',
    'this._athenaOrderPlacementVisitSnapshot=_athenaOrderPlacementVisitSnapshot;',
    'this._athenaOrderPlacementCapabilityReady=_athenaOrderPlacementCapabilityReady;',
    'this._athenaOrderPlacementControl=_athenaOrderPlacementControl;',
    'this.reviewAndPlaceOrderInAthena=reviewAndPlaceOrderInAthena;'].join('\n'),
  context,
  { filename: 'ScribeFlow-order-place-functions.js' }
);

const candidate = context._athenaOrderPlacementCandidate(safeOrder);
assert.strictEqual(candidate.eligible, true, 'complete reviewed imaging order should be eligible');
assert.deepStrictEqual(
  Array.from(Object.keys(candidate.order)),
  ['clientOrderId', 'type', 'displayLabel', 'catalogCode', 'catalogId', 'query', 'fields', 'reviewStatus', 'source'],
  'typed order must contain exactly the canonical audited keys'
);
assert.strictEqual(candidate.order.query, candidate.order.displayLabel, 'catalog query must be deterministically frozen from the visible label');
assert.strictEqual(candidate.order.displayLabel, 'MRI Lumbar spine', 'catalog label must exclude clinical indication/details kept in fields');
assert.strictEqual(candidate.order.catalogId, 'athena-catalog-imaging-17');
assert.strictEqual(candidate.order.reviewStatus, 'accepted');
assert.strictEqual(candidate.order.fields.untrustedExtra, undefined, 'unknown/free-text keys leaked into the typed order');
assert(Object.isFrozen(candidate.order) && Object.isFrozen(candidate.order.fields), 'typed order and fields must be immutable');
const noOptionalCandidate = context._athenaOrderPlacementCandidate({ ...safeOrder, id: 'order-no-optional', fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Pain' } });
assert.strictEqual(noOptionalCandidate.eligible, true);
assert.strictEqual(noOptionalCandidate.order.fields.notes, undefined, 'blank optional fields leaked into the exact runtime payload');

assert.strictEqual(context._athenaOrderPlacementCandidate(incompleteOrder).eligible, false, 'incomplete order must fail closed');
assert.strictEqual(context._athenaOrderPlacementCandidate(medicationOrder).badge, 'Manual in Athena', 'medication must remain manual');
assert.strictEqual(context._athenaOrderPlacementCandidate(suggestionOnly).eligible, false, 'unaccepted suggestion must never be executable');
assert.strictEqual(context._athenaOrderPlacementCandidate({ ...safeOrder, id: 'order-no-catalog', catalogId: '', catalogCode: '' }).eligible, false, 'an order without durable catalog identity must fail closed');
assert.strictEqual(context._athenaOrderPlacementCandidate({ ...safeOrder, id: 'order-long-field', fields: { ...safeOrder.fields, indication: 'x'.repeat(2001) } }).eligible, false, 'overlong order details must fail closed instead of being truncated');
assert.strictEqual(context._athenaOrderPlacementCandidate({ ...safeOrder, id: 'order-bad-source', _source: 'legacy-auto-suggestion' }).eligible, false, 'an unapproved order source must fail closed');
assert(!/Review &amp; place in Athena/.test(context._athenaOrderPlacementControl(incompleteOrder)), 'incomplete row received an executable button');
assert(!/Review &amp; place in Athena/.test(context._athenaOrderPlacementControl(medicationOrder)), 'medication row received an executable button');
assert(!/Review &amp; place in Athena/.test(context._athenaOrderPlacementControl(suggestionOnly)), 'suggestion-only row received an executable button');
assert(/Review &amp; place in Athena/.test(context._athenaOrderPlacementControl(safeOrder)), 'complete reviewed supported row is missing its explicit button');

context.window.__mlsExtensionCapabilities = {};
const disabledForOldExtension = context._athenaOrderPlacementControl(safeOrder);
assert(/disabled/.test(disabledForOldExtension) && /Update MLS Assist/.test(disabledForOldExtension), 'an extension without the explicit supervised-order capability must show update-required/manual-only UI');
assert(!/reviewAndPlaceOrderInAthena/.test(disabledForOldExtension), 'an older extension received an executable order handler');
assert.strictEqual(context.reviewAndPlaceOrderInAthena('order-safe-1', null), null, 'an older extension could open the executable order review');
assert.strictEqual(confirmationCalls, 0, 'capability-missing client opened a confirmation');
context.window.__mlsExtensionCapabilities = { supervisedOrderPlacementV2: true };

const missingMrn = Object.freeze(Object.assign({}, exactBinding, {
  id: 'visit-bind-missing-mrn', patient: Object.freeze({ name: 'Adam J Schaeffer', dob: '01/02/1980', mrn: '', patientId: 'local-patient-42' })
}));
assert.strictEqual(context._athenaOrderPlacementVisitSnapshot(missingMrn).eligible, false, 'patient identity without MRN must fail closed');
context.currentVisitAthenaBinding = missingMrn;
const disabledForIdentity = context._athenaOrderPlacementControl(safeOrder);
assert(/disabled/.test(disabledForIdentity) && /Review &amp; place in Athena/.test(disabledForIdentity), 'complete order should show a disabled, clearly labeled button while identity is incomplete');
assert(!/reviewAndPlaceOrderInAthena/.test(disabledForIdentity), 'identity-blocked button must not have an executable handler');
context.currentVisitAthenaBinding = exactBinding;

const result = context.reviewAndPlaceOrderInAthena('order-safe-1', null);
assert(result && result.manifestId === 'one-order-confirmation');
assert.strictEqual(confirmationCalls, 1, 'button must open exactly one unified confirmation');
assert.strictEqual(directActionCalls, 0, 'button performed an Athena action before separate Confirm');
assert.strictEqual(captured.preferredAction, 'place_order');
assert.strictEqual(captured.requireExpectedVisit, true);
assert.strictEqual(captured.visitBindingId, 'visit-bind-exact-42');
assert.strictEqual(captured.patient.patientId, 'local-patient-42', 'local patient audit identity was lost');
assert.strictEqual(captured.patient.dob, '01/02/1980');
assert.strictEqual(captured.patient.mrn, 'MRN-4242');
assert.strictEqual(captured.expectedContext.visitDate, '2026-07-14');
assert.strictEqual(captured.expectedContext.provider, 'Matthew Schaeffer, MD');
assert.strictEqual(captured.plan.length, 1, 'more than one confirmation plan was created');
assert.strictEqual(captured.plan[0].orderDrafts.length, 1, 'confirmation did not freeze exactly one order');
assert.strictEqual(captured.plan[0].orderDrafts[0].clientOrderId, 'order-safe-1');
assert.strictEqual(captured.plan[0].orderSuggestions.length, 0, 'suggestions leaked into the executable confirmation');
assert(Object.isFrozen(captured.patient) && Object.isFrozen(captured.expectedContext), 'patient/visit snapshots must be immutable');
assert(Object.isFrozen(captured.plan) && Object.isFrozen(captured.plan[0]) && Object.isFrozen(captured.plan[0].orderDrafts), 'one-order confirmation plan must be immutable');
assert(/one exact .* order only/i.test(captured.plan[0].consequence));
assert(/only after you separately press Confirm/i.test(captured.plan[0].consequence));
for (const consequence of ['write', 'Save', 'Sign', 'billing', 'claim', 'any other order']) {
  assert(captured.plan[0].consequence.includes(consequence), 'consequence copy omitted ' + consequence);
}

for (const blockedId of ['order-incomplete-1', 'order-rx-1', 'order-suggestion-1']) {
  assert.strictEqual(context.reviewAndPlaceOrderInAthena(blockedId, null), null, blockedId + ' should be blocked');
}
assert.strictEqual(confirmationCalls, 1, 'unsafe rows opened another confirmation');
context.currentOrders.push(Object.assign({}, safeOrder));
assert.strictEqual(context.reviewAndPlaceOrderInAthena('order-safe-1', null), null, 'duplicate local order id must fail closed');
assert.strictEqual(confirmationCalls, 1, 'duplicate local order id opened another confirmation');
assert.strictEqual(directActionCalls, 0);

assert(source.includes('Review &amp; place in Athena'), 'production UI is missing the human-permission order button');
assert(source.includes('supervisedOrderPlacementV2===true'), 'production UI does not strictly require the supervised-order capability handshake');
assert(source.includes('id="ordCatalogCode"') && source.includes('id="ordCatalogId"'), 'Orders builder has no safe way to bind a normal reviewed draft to a durable Athena catalog identity');
assert(source.includes("o._reviewStatus='accepted'") && source.includes('delete o.complete'), 'editing/binding a legacy draft does not record the clinician review or clear stale incomplete state');
assert(source.includes("preferredAction:'place_order'"), 'button does not select the typed place_order confirmation row');
assert(source.includes("preferredAction:''"), 'manual route overview must remain non-executable by default');
assert(!/startAthenaAction|sendToEMRviaAssist|sendMessage\s*\(/.test(placeSource), 'row button contains a direct or generic Athena write path');
assert(/openUnifiedConfirmation/.test(placeSource), 'row button does not use the existing unified confirmation');

console.log('PASS order placement UI: one exact typed order, immutable exact patient/visit, separate Confirm, unsafe rows blocked, and no direct Athena action');

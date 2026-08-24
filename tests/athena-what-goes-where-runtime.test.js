'use strict';

/* Render the canonical unified Athena sheet with one supported READY order,
   one medication that must stay manual, and one unaccepted suggestion that
   must stay blocked. This is a synthetic read-only probe: the test never
   clicks Confirm and therefore never sends an execute request. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');
const sent = [];
const byId = Object.create(null);
const listeners = Object.create(null);

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.children = [];
    this.parentNode = null;
    this.nodeType = 1;
    this.disabled = false;
    this.checked = false;
    this.textContent = '';
    this.value = '';
    this._id = '';
    this._html = '';
  }
  set id(value) { this._id = String(value || ''); if (this._id) byId[this._id] = this; }
  get id() { return this._id; }
  set innerHTML(value) {
    this._html = String(value || '');
    this.children.slice().forEach(child => child.remove());
    this.children = [];
    const tags = this._html.match(/<(?:button|div|input)\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const id = /\bid="([^"]+)"/i.exec(tag);
      const name = /\bname="([^"]+)"/i.exec(tag);
      if (!id && (!name || name[1] !== 'mlsAthenaUnifiedAction')) continue;
      const type = /^<([a-z]+)/i.exec(tag)[1];
      const el = new El(type);
      if (id) el.id = id[1];
      const valueMatch = /\bvalue="([^"]*)"/i.exec(tag);
      if (valueMatch) el.value = valueMatch[1];
      if (name) el.setAttribute('name', name[1]);
      if (/\bdisabled\b/i.test(tag)) el.disabled = true;
      if (/\bchecked\b/i.test(tag)) el.checked = true;
      this.appendChild(el);
    }
  }
  get innerHTML() { return this._html; }
  appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] || ''; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  querySelector(selector) {
    if (selector[0] === '#') return byId[selector.slice(1)] || null;
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const all = [];
    const walk = node => { for (const child of node.children) { all.push(child); walk(child); } };
    walk(this);
    if (/input\[name="mlsAthenaUnifiedAction"\]/.test(selector)) {
      return all.filter(el => el.tagName === 'INPUT' && el.getAttribute('name') === 'mlsAthenaUnifiedAction');
    }
    return [];
  }
  remove() {
    const drop = node => {
      node.children.forEach(drop);
      if (node.id && byId[node.id] === node) delete byId[node.id];
    };
    drop(this);
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
  }
}

const document = {
  readyState: 'loading',
  body: new El('body'),
  addEventListener() {},
  removeEventListener() {},
  createElement: tag => new El(tag),
  getElementById: id => byId[id] || null,
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
};
const store = Object.create(null);
const exactContext = {
  patientName: 'Example Patient', dob: '1/2/1980', mrn: '123',
  encounterId: 'enc-order-1', encounterUrl: 'https://athenanet.athenahealth.com/encounter/enc-order-1',
  visitDate: '7/14/2026', provider: 'Example Doctor, MD', controlLabel: 'Orders workspace'
};
const window = {
  document,
  location: { origin: 'https://mlsscribe.com' },
  __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
  sessionStorage: {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; }
  },
  toast() {},
  addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
  removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
  postMessage(message) {
    sent.push(structuredClone(message));
    if (message.type !== 'mlsAppAthenaActionV2' || message.mode !== 'probe') return;
    const resp = {
      ok: true, actionToken: 'synthetic-order-probe-token', context: exactContext,
      rowHash: message.rowHash, clientOrderId: message.clientOrderId
    };
    setTimeout(() => {
      for (const fn of [...(listeners.message || [])]) {
        fn({ data: { source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: message.requestId, resp } });
      }
    }, 0);
  }
};
window.window = window;
function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
const safeTimer = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  if (ms > 1000 && timer.unref) timer.unref();
  return timer;
};
const ctx = {
  window, document, MutationObserver, console, structuredClone,
  setTimeout: safeTimer, clearTimeout, Date, Math, Promise, Object, Array,
  String, Number, RegExp, JSON, Uint32Array
};
vm.createContext(ctx);
vm.runInContext(source, ctx, { filename: '1p-feat_mls_writeflow.js' });

const manifest = window.__mlsWriteFlow.openUnifiedConfirmation({
  patient: { patientId: 'pt-order-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' },
  expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' },
  receiptSessionId: 'what-goes-where-order-runtime', previewHash: 'what-goes-where-order-preview',
  preferredAction: 'place_order',
  plan: [{
    kind: 'orders',
    orderDrafts: [{
      clientOrderId: 'reviewed-imaging-order-1', displayLabel: 'MRI lumbar spine', query: 'MRI lumbar spine',
      catalogId: 'athena-imaging-mri-lumbar', reviewStatus: 'accepted', type: 'imaging',
      fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Persistent radicular pain' },
      summary: 'MRI lumbar spine', source: 'provider-entered'
    }, {
      reviewStatus: 'accepted', type: 'medication', complete: true,
      fields: { drug: 'Synthetic medication', dose: '1 tablet' }, summary: 'Synthetic medication draft', source: 'provider-entered'
    }],
    orderSuggestions: [{
      type: 'referral', fields: { specialty: 'Neurosurgery', reason: 'Review after MRI' },
      summary: 'Consider neurosurgery referral', source: 'ai-suggestion'
    }]
  }]
});

const readyOrder = manifest.rows.find(row => row.action === 'place_order');
assert(readyOrder && readyOrder.capability === 'ready', 'fixture did not produce one supported READY order');
assert.strictEqual(manifest.rows.filter(row => row.action === 'place_order').length, 1, 'fixture exposed more than one executable order');
const manualMedication = manifest.rows.find(row => row.payload.orderType === 'medication');
const blockedSuggestion = manifest.rows.find(row => /suggestion only/i.test(row.reviewStatus));
assert(manualMedication && manualMedication.capability === 'manual' && !manualMedication.action, 'medication boundary is no longer manual');
assert(blockedSuggestion && blockedSuggestion.capability === 'blocked' && !blockedSuggestion.action, 'unaccepted order boundary is no longer blocked');

const wait = () => new Promise(resolve => setTimeout(resolve, 12));
(async () => {
  const card = byId.mlsAthenaUnifiedConfirm && byId.mlsAthenaUnifiedConfirm.children[0];
  assert(card, 'unified Athena sheet did not render');
  const radios = card.querySelectorAll('input[name="mlsAthenaUnifiedAction"]');
  assert.strictEqual(radios.length, 1, 'only the single supported READY order may render an action radio');
  assert.strictEqual(radios[0].value, readyOrder.id, 'the rendered action radio is not bound to the immutable READY order row');
  assert.strictEqual(radios[0].checked, true, 'preferred place_order was not pre-selected');
  assert(/What &rarr; Where &rarr; How/.test(card.innerHTML), 'compact destination guide is missing');
  assert(/What:<\/b> Reviewed MRI lumbar spine order/.test(card.innerHTML), 'ready order does not plainly identify the artifact');
  assert(/Where:<\/b> Athena encounter > Orders > Imaging/.test(card.innerHTML), 'ready order does not plainly identify its exact Athena destination');
  assert(/READY · SEPARATE CONFIRMATION/.test(card.innerHTML), 'ready order does not plainly state its separate-confirmation status');
  assert(/MANUAL IN ATHENA/.test(card.innerHTML), 'medication row does not plainly state its manual boundary');
  assert(/BLOCKED · NOTHING SENT/.test(card.innerHTML), 'unaccepted suggestion does not plainly state its blocked boundary');
  assert(/Orders and other Athena items \(3\).*1 order can be sent with separate confirmation/.test(card.innerHTML), 'order drawer still falsely says every order is manual');
  assert(!/Review the generated encounter-note text/.test(card.innerHTML), 'order-only review still renders a false generic Encounter-note hero');

  assert.strictEqual(sent.filter(message => message.type === 'mlsAppAthenaActionV2').length, 1, 'opening the sheet must make exactly one read-only order probe');
  const probe = sent.find(message => message.type === 'mlsAppAthenaActionV2');
  assert.strictEqual(probe.mode, 'probe', 'opening the sheet performed a non-probe order action');
  assert.strictEqual(probe.action, 'place_order', 'preferred READY order was not auto-probed');
  assert.strictEqual(probe.rowHash, readyOrder.rowHash, 'order probe lost the immutable row hash');
  assert.strictEqual(probe.clientOrderId, readyOrder.payload.order.clientOrderId, 'order probe lost the immutable client order ID');

  await wait();
  const go = byId.mlsAthenaUnifiedGo;
  assert(go && go.disabled === false, 'valid order read-only probe did not enable the shared confirmation button');
  assert.strictEqual(go.getAttribute('data-mls-athena-action'), 'place_order', 'shared confirmation button was not armed for the selected order');
  assert.strictEqual(go.getAttribute('data-mls-row-hash'), readyOrder.rowHash, 'shared confirmation button lost the order row hash');
  assert.strictEqual(go.getAttribute('data-mls-client-order-id'), readyOrder.payload.order.clientOrderId, 'shared confirmation button lost the order ID');
  assert.strictEqual(sent.filter(message => message.mode === 'execute').length, 0, 'render/probe test executed an order without a clinician confirmation');

  const namedManifest = window.__mlsWriteFlow.openUnifiedConfirmation({
    patient: { patientId: 'pt-order-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' },
    expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' },
    receiptSessionId: 'what-goes-where-named-runtime', previewHash: 'what-goes-where-named-preview',
    preferredAction: 'write_note',
    sections: [
      { key: 'hpi', text: 'Exact synthetic HPI.' },
      { key: 'ros', text: 'Exact synthetic ROS.' },
      { key: 'exam', text: 'Exact synthetic exam.' },
      { key: 'assessment', text: 'Exact synthetic assessment.' },
      { key: 'plan', text: 'Exact synthetic plan.' }
    ]
  });
  const namedCard = byId.mlsAthenaUnifiedConfirm.children[0];
  assert.strictEqual(namedManifest.rows.filter(row => row.action === 'write_note').length, 5, 'named fixture lost an exact section action');
  assert(!/Review the generated encounter-note text/.test(namedCard.innerHTML), 'named-section review still renders a false generic Encounter-note hero');
  assert(/What: Reviewed HPI draft/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > HPI/.test(namedCard.innerHTML), 'HPI What/Where metadata is unclear');
  assert(/What: Reviewed Review of Systems draft/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > Review of Systems/.test(namedCard.innerHTML), 'ROS What/Where metadata is unclear');
  assert(/What: Reviewed Physical Exam draft/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > Physical Exam/.test(namedCard.innerHTML), 'Exam What/Where metadata is unclear');
  assert(/What: Reviewed assessment narrative/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > Assessment &amp; Plan > Assessment/.test(namedCard.innerHTML), 'Assessment What/Where metadata is unclear or does not match Athena hierarchy');
  assert(/What: Reviewed Plan \/ Follow-up draft/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > Assessment &amp; Plan > Plan \/ Follow-up/.test(namedCard.innerHTML), 'Plan What/Where metadata is unclear or does not match Athena hierarchy');
  assert.strictEqual(namedCard.querySelectorAll('input[name="mlsAthenaUnifiedAction"]').length, 5, 'each named Athena field must remain its own selectable confirmation');

  const probesBeforeProcedure = sent.filter(message => message.mode === 'probe').length;
  const procedureManifest = window.__mlsWriteFlow.openUnifiedConfirmation({
    patient: { patientId: 'pt-order-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' },
    expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' },
    receiptSessionId: 'what-goes-where-procedure-runtime', previewHash: 'what-goes-where-procedure-preview',
    plan: [{ kind: 'procedure', body: 'Exact synthetic procedure narrative.' }]
  });
  const procedureCard = byId.mlsAthenaUnifiedConfirm.children[0];
  const procedureRow = procedureManifest.rows.find(row => row.kind === 'procedure');
  assert(procedureRow && procedureRow.capability === 'ready' && procedureRow.action === 'write_note', 'procedure fixture did not expose its exact supervised placement');
  assert(!/Review the generated encounter-note text/.test(procedureCard.innerHTML), 'procedure-only review still renders a false generic Encounter-note hero');
  assert(/What: Reviewed procedure \/ operative-note draft/.test(procedureCard.innerHTML), 'procedure artifact is not plainly identified');
  assert(/Where:<\/b> Athena encounter > Physical Exam > Procedure Documentation/.test(procedureCard.innerHTML), 'procedure row does not name its exact Athena destination');
  assert(/READY (?:&middot;|·) SEPARATE CONFIRMATION/.test(procedureCard.innerHTML), 'procedure row does not plainly state its separate-confirmation boundary');
  assert.strictEqual(procedureCard.querySelectorAll('input[name="mlsAthenaUnifiedAction"]').length, 1, 'exact procedure row is not independently selectable');
  await wait();
  const procedureProbes = sent.filter(message => message.mode === 'probe').slice(probesBeforeProcedure);
  assert.strictEqual(procedureProbes.length, 1, 'procedure review did not start exactly one read-only probe');
  assert.strictEqual(procedureProbes[0].action, 'write_note', 'procedure review probed a non-note action');
  assert.strictEqual(procedureProbes[0].sections[0].key, 'procedure', 'procedure probe lost its exact destination key');
  assert.strictEqual(sent.filter(message => message.mode === 'execute').length, 0, 'rendered destination checks executed an Athena action');

  const genericManifest = window.__mlsWriteFlow.openUnifiedConfirmation({
    patient: { patientId: 'pt-order-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' },
    expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' },
    receiptSessionId: 'what-goes-where-generic-runtime', previewHash: 'what-goes-where-generic-preview',
    preferredAction: 'write_note',
    sections: [{ key: 'note', text: 'Exact synthetic generic encounter note.' }],
    billing: { em: '99213', cptCodes: ['97110'] }
  });
  const genericCard = byId.mlsAthenaUnifiedConfirm.children[0];
  assert(/Review the generated encounter-note text/.test(genericCard.innerHTML), 'true generic note lost its full-text review hero');
  assert(/What: Reviewed encounter-note draft/.test(genericCard.innerHTML) && /Where:<\/b> Athena encounter > Encounter note/.test(genericCard.innerHTML), 'generic note What/Where metadata is unclear');
  assert(/What: Reviewed E\/M and CPT\/HCPCS coding payload/.test(genericCard.innerHTML) && /Where:<\/b> Athena encounter > Billing \/ Charges slate/.test(genericCard.innerHTML), 'billing What/Where metadata is unclear');
  assert(/What: Save the reviewed encounter draft/.test(genericCard.innerHTML) && /Where:<\/b> Athena encounter > Save \/ Save Draft control/.test(genericCard.innerHTML), 'Save Draft What/Where metadata is unclear');
  assert(/What: Sign &amp; Save the reviewed encounter/.test(genericCard.innerHTML) && /Where:<\/b> Athena encounter > Sign &amp; Save control/.test(genericCard.innerHTML), 'Sign & Save What/Where metadata is unclear');
  assert.strictEqual(genericCard.querySelectorAll('input[name="mlsAthenaUnifiedAction"]').length, 4, 'generic note, billing, Save Draft, and Sign & Save must remain separate selectable actions');
  const allTypedActions = new Set([
    ...manifest.rows.filter(row => row.action).map(row => row.action),
    ...genericManifest.rows.filter(row => row.action).map(row => row.action)
  ]);
  assert.deepStrictEqual([...allTypedActions].sort(), ['place_order', 'save_draft', 'sign_encounter', 'stage_billing', 'write_note'], 'the unified UI no longer preserves all five typed Athena actions');
  assert.strictEqual(sent.filter(message => message.mode === 'execute').length, 0, 'five-action render coverage executed an Athena action');

  console.log('PASS Athena What/Where/How runtime: all five typed actions preserved; named/generic/procedure destinations exact; one supported order probe-ready; manual/blocked orders nonselectable; zero execute requests');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

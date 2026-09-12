'use strict';

/* Render the canonical unified Athena sheet with one exact reviewed order,
   one medication, and one unaccepted suggestion. Current owner policy keeps
   both reviewed orders manual and the suggestion blocked; opening this sheet
   must send neither a probe nor an execute request. */
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

const reviewedOrder = manifest.rows.find(row => row.payload.orderType === 'imaging');
assert(reviewedOrder && reviewedOrder.capability === 'manual' && !reviewedOrder.action, 'exact reviewed order did not remain manual');
assert(reviewedOrder.payload.order && reviewedOrder.payload.order.clientOrderId === 'reviewed-imaging-order-1', 'manual review lost the exact canonical order payload');
assert.strictEqual(manifest.rows.filter(row => row.action === 'place_order').length, 0, 'fixture exposed retired order execution');
const manualMedication = manifest.rows.find(row => row.payload.orderType === 'medication');
const blockedSuggestion = manifest.rows.find(row => /suggestion only/i.test(row.reviewStatus));
assert(manualMedication && manualMedication.capability === 'manual' && !manualMedication.action, 'medication boundary is no longer manual');
assert(blockedSuggestion && blockedSuggestion.capability === 'blocked' && !blockedSuggestion.action, 'unaccepted order boundary is no longer blocked');

const wait = () => new Promise(resolve => setTimeout(resolve, 12));
(async () => {
  const card = byId.mlsAthenaUnifiedConfirm && byId.mlsAthenaUnifiedConfirm.children[0];
  assert(card, 'unified Athena sheet did not render');
  const radios = card.querySelectorAll('input[name="mlsAthenaUnifiedAction"]');
  assert.strictEqual(radios.length, 0, 'manual and blocked order rows must not render action radios');
  assert(/What &rarr; Where &rarr; How/.test(card.innerHTML), 'compact destination guide is missing');
  assert(/What:<\/b> Reviewed MRI lumbar spine order/.test(card.innerHTML), 'manual order does not plainly identify the artifact');
  assert(/Where:<\/b> Athena encounter > Orders > Imaging/.test(card.innerHTML), 'manual order does not plainly identify its exact Athena destination');
  assert(/MANUAL IN ATHENA/.test(card.innerHTML), 'medication row does not plainly state its manual boundary');
  assert(/BLOCKED · NOTHING SENT/.test(card.innerHTML), 'unaccepted suggestion does not plainly state its blocked boundary');
  assert(/Complete final actions in Athena yourself \(3\).*nothing here is sent/.test(card.innerHTML), 'order drawer advertises retired order execution');
  assert(!/Review the generated encounter-note text/.test(card.innerHTML), 'order-only review still renders a false generic Encounter-note hero');

  assert.strictEqual(sent.filter(message => message.type === 'mlsAppAthenaActionV2').length, 0, 'opening a manual-only order sheet contacted Athena');

  await wait();
  const go = byId.mlsAthenaUnifiedGo;
  assert(go && go.disabled === true, 'manual-only order sheet enabled the shared confirmation button');
  assert.strictEqual(go.getAttribute('data-mls-athena-action') || '', '', 'shared confirmation button was armed for a manual order');
  assert.strictEqual(sent.filter(message => message.mode === 'execute').length, 0, 'render test executed an order');

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
  /* ap-1.0.0 moved this pin, deliberately, and it is stated here rather than
     left as a bare number: athenaOne owns ONE combined Assessment & Plan
     editor, so alongside the five named section rows the manifest offers a
     sixth row that writes the reviewed assessment and plan together. Five
     sections therefore produce SIX write_note rows - the same
     sections.length + 1 shape athena-crosslayer-bridge-payload-runtime
     already pins, and the same six rows the owner sees on the live sheet.
     The count alone was what drifted, so assert the SHAPE instead. */
  const namedWriteRows = namedManifest.rows.filter(row => row.action === 'write_note');
  /* joined, not deepStrictEqual: these rows are built inside the vm realm, so
     their arrays do not share Array.prototype with this file's and a
     deep-equal fails on identical contents. */
  assert.strictEqual(
    namedWriteRows.map(row => String((row.payload && row.payload.sectionKey) || '')).join(','),
    'hpi,ros,exam,assessment,plan,assessment_and_plan',
    'named fixture lost an exact section action, or the combined Assessment & Plan row');
  assert(!/Review the generated encounter-note text/.test(namedCard.innerHTML), 'named-section review still renders a false generic Encounter-note hero');
  assert(/What: Reviewed HPI draft/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > HPI/.test(namedCard.innerHTML), 'HPI What/Where metadata is unclear');
  assert(/What: Reviewed Review of Systems draft/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > Review of Systems/.test(namedCard.innerHTML), 'ROS What/Where metadata is unclear');
  assert(/What: Reviewed Physical Exam draft/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > Physical Exam/.test(namedCard.innerHTML), 'Exam What/Where metadata is unclear');
  assert(/What: Reviewed assessment narrative/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > Assessment &amp; Plan > Assessment/.test(namedCard.innerHTML), 'Assessment What/Where metadata is unclear or does not match Athena hierarchy');
  assert(/What: Reviewed Plan \/ Follow-up draft/.test(namedCard.innerHTML) && /Where:<\/b> Athena encounter > Assessment &amp; Plan > Plan \/ Follow-up/.test(namedCard.innerHTML), 'Plan What/Where metadata is unclear or does not match Athena hierarchy');
  assert(/What: Write reviewed Assessment &amp; Plan \(combined\)/.test(namedCard.innerHTML) || /Assessment &amp; Plan \(combined\)/.test(namedCard.innerHTML),
    'the combined Assessment & Plan row lost its own What metadata');
  /* ap-1.0.0, same deliberate move as the row-shape pin above: the combined
     Assessment & Plan row is ALSO its own selectable confirmation, so five
     named fields offer six radios. The law being pinned is one-radio-per-row
     (nothing silently batched behind a single confirmation), so tie the count
     to the row set rather than to a literal that drifts whenever a
     destination is added. */
  /* savenamed-app-1.0.0 (OWNER RULING 2026-09-02: "unblock the save block in
     mls assistant it should be able to do it if someone clicks save on mls
     site"). The law is unchanged - one radio per READY row, nothing silently
     batched behind a single confirmation - and the row set is now the named
     writes PLUS the review's own supervised encounter save, which is a READY
     row of its own with its own destination, its own probe and its own
     receipt. Tie the count to the READY rows so it keeps following the shape. */
  const namedReadyRows = namedManifest.rows.filter(row => row.capability === 'ready' && row.action);
  assert.strictEqual(namedCard.querySelectorAll('input[name="mlsAthenaUnifiedAction"]').length, namedReadyRows.length,
    'each named Athena field must remain its own selectable confirmation');
  assert.strictEqual(namedReadyRows.length, namedWriteRows.length + 1,
    'the named review lost its supervised encounter-save row, or gained a ready row that is not one');
  assert.strictEqual(namedReadyRows.filter(row => row.action === 'save_draft').length, 1,
    'the named review offers more than one encounter save');
  assert.strictEqual(namedWriteRows.length, 6, 'the named fixture no longer offers six exact destinations');

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
  /* savenamed-app-1.0.0: the op note is a NAMED destination, so this review
     also carries the supervised encounter-save row - two READY rows, two
     radios, one per row, exactly as the law says. */
  assert.strictEqual(procedureCard.querySelectorAll('input[name="mlsAthenaUnifiedAction"]').length, 2, 'exact procedure row is not independently selectable');
  assert.strictEqual(procedureManifest.rows.filter(row => row.capability === 'ready' && row.action === 'save_draft').length, 1,
    'the op-note review lost its supervised encounter-save row');
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
  assert(/What: Reviewed E\/M and CPT\/HCPCS coding/.test(genericCard.innerHTML) && /Where:<\/b> Athena encounter > Billing \/ Charges slate/.test(genericCard.innerHTML), 'billing What/Where metadata is unclear');
  assert(/What: Save the reviewed encounter draft/.test(genericCard.innerHTML) && /Where:<\/b> Athena encounter > Save \/ Save Draft control/.test(genericCard.innerHTML), 'Save Draft What/Where metadata is unclear');
  assert(/What: Sign &amp; Save the reviewed encounter/.test(genericCard.innerHTML) && /Where:<\/b> Athena encounter > Sign &amp; Save control/.test(genericCard.innerHTML), 'Sign & Save What/Where metadata is unclear');
  assert.strictEqual(genericCard.querySelectorAll('input[name="mlsAthenaUnifiedAction"]').length, 2, 'only reviewed note and Save Draft may remain selectable');
  const allTypedActions = new Set([
    ...manifest.rows.filter(row => row.action).map(row => row.action),
    ...genericManifest.rows.filter(row => row.action).map(row => row.action)
  ]);
  assert.deepStrictEqual([...allTypedActions].sort(), ['save_draft', 'write_note'], 'legacy capabilities widened the current note/save-only action set');
  assert.strictEqual(sent.filter(message => message.mode === 'execute').length, 0, 'render coverage executed an Athena action');

  console.log('PASS Athena What/Where/How runtime: only note/save execute; named/generic/procedure destinations exact; reviewed orders stay manual and suggestions blocked; zero order probes or executes');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

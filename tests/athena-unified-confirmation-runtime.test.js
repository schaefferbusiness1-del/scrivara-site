'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const sent = [];
const byId = Object.create(null);
const windowListeners = Object.create(null);

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
    if (/input\[name="mlsAthenaUnifiedAction"\]/.test(selector)) return all.filter(el => el.tagName === 'INPUT' && el.getAttribute('name') === 'mlsAthenaUnifiedAction');
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
  createElement: tag => new El(tag),
  getElementById: id => byId[id] || null,
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
};
const exactContext = {
  patientName: 'Example Patient', dob: '1/2/1980', mrn: '123',
  encounterId: 'enc-1', encounterUrl: 'https://athenanet.athenahealth.com/encounter/enc-1',
  visitDate: '7/14/2026', provider: 'Example Doctor, MD', controlLabel: 'Encounter note editor'
};
const window = {
  document,
  location: { origin: 'https://mlsscribe.com' },
  __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
  sessionStorage: (() => { const data = Object.create(null); return { getItem: key => Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null, setItem: (key, value) => { data[key] = String(value); }, removeItem: key => { delete data[key]; } }; })(),
  toast() {},
  addEventListener(type, fn) { (windowListeners[type] || (windowListeners[type] = [])).push(fn); },
  removeEventListener(type, fn) { windowListeners[type] = (windowListeners[type] || []).filter(item => item !== fn); },
  postMessage(message) {
    sent.push(structuredClone(message));
    const response = message.mode === 'probe'
      ? { ok: true, actionToken: 'one-use-token', context: exactContext }
      : {
          ok: true, attempted: true, written: true, noteWritten: true, verified: true,
          noteWriteProof: 'proof-exact-note', noteWriteProofExpiresAt: Date.now() + 120000,
          context: exactContext
        };
    setTimeout(() => {
      for (const fn of [...(windowListeners.message || [])]) fn({ data: { source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: message.requestId, resp: response } });
    }, 0);
  }
};
window.window = window;
function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
const longTimerSafe = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  if (ms > 1000 && timer.unref) timer.unref();
  return timer;
};
const ctx = {
  window, document, MutationObserver, console, structuredClone,
  setTimeout: longTimerSafe, clearTimeout, Date, Math, Promise, Object, Array,
  String, Number, RegExp, JSON, Uint32Array
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'feat_mls_show_assistant.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8'), ctx);

const staleReceipt = new El('div'); staleReceipt.id = 'athenaReceipt'; document.body.appendChild(staleReceipt);
const staleAction = new El('div'); staleAction.id = 'mlsAthenaActionConfirm'; document.body.appendChild(staleAction);

const reviewOpts = {
  patient: { patientId: 'pt-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' },
  expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' },
  receiptSessionId: 'runtime-receipt',
  previewHash: 'mls-preview-runtime',
  preferredAction: 'write_note',
  plan: [
    { kind: 'note', body: 'NOTE TEXT:\nExact reviewed note.' },
    { kind: 'dx', body: 'ICD-10:\n- M54.50' },
    { kind: 'orders', body: 'ORDERS:\n- MRI lumbar spine' }
  ]
};
const teachManifest = window.__mlsWriteFlow.buildUnifiedManifest(reviewOpts);
const taughtRow = teachManifest.rows.find(row => row.id === 'write-note');
const namedSections = [
  { key: 'history', text: 'Exact HPI.' },
  { key: 'ros', text: 'Exact ROS.' },
  { key: 'physical_exam', text: 'Exact exam.' },
  { key: 'assessment_narrative', text: 'Exact assessment.' },
  { key: 'follow_up', text: 'Exact plan.' }
];
const namedManifest = window.__mlsWriteFlow.buildUnifiedManifest(Object.assign({}, reviewOpts, { plan: [], sections: namedSections, receiptSessionId: 'runtime-named-sections' }));
const namedWriteRows = namedManifest.rows.filter(row => row.action === 'write_note');
assert.deepStrictEqual(Array.from(namedWriteRows, row => row.kind), ['hpi', 'ros', 'exam', 'assessment', 'plan'], 'named note sections were not split into exact destination rows');
assert.deepStrictEqual(Array.from(namedWriteRows, row => row.destination), [
  'Athena encounter > HPI', 'Athena encounter > Review of Systems', 'Athena encounter > Physical Exam',
  'Athena encounter > Assessment & Plan > Assessment', 'Athena encounter > Assessment & Plan > Plan / Follow-up'
], 'named note rows advertise the wrong Athena destinations');
for (const row of namedWriteRows) {
  assert.strictEqual(row.payload.sections.length, 1, `${row.kind} row carried another destination`);
  assert.strictEqual(row.payload.sections[0].key, row.kind, `${row.kind} row lost its canonical section key`);
  assert.strictEqual(row.payload.noteText, row.payload.sections[0].text, `${row.kind} row changed the reviewed bytes`);
}
assert(!namedManifest.rows.some(row => row.id === 'write-note'), 'named sections still created a generic encounter-note write row');
for (const id of ['save-named-sections-manual', 'sign-named-sections-manual']) {
  const row = namedManifest.rows.find(item => item.id === id);
  assert(row && row.capability === 'manual' && !row.action, `${id} did not fail closed as a manual final action`);
}
const mixedManifest = window.__mlsWriteFlow.buildUnifiedManifest(Object.assign({}, reviewOpts, { plan: [], sections: [
  { key: 'note', text: 'Generic text must not become a fallback.' },
  { key: 'hpi', text: 'Exact HPI remains independently reviewable.' }
], receiptSessionId: 'runtime-mixed-note-targets' }));
assert.strictEqual(mixedManifest.rows.filter(row => row.action === 'write_note').length, 1, 'mixed generic/named review exposed an extra write action');
assert.strictEqual(mixedManifest.rows.find(row => row.action === 'write_note').kind, 'hpi', 'mixed review did not preserve the exact named destination');
const mixedGeneric = mixedManifest.rows.find(row => row.id === 'blocked-mixed-generic-note-0');
assert(mixedGeneric && mixedGeneric.capability === 'blocked' && !mixedGeneric.action, 'mixed generic note silently fell through to Athena');

const duplicateNamedManifest = window.__mlsWriteFlow.buildUnifiedManifest(Object.assign({}, reviewOpts, { plan: [], sections: [
  { key: 'hpi', text: 'First HPI fragment.' }, { key: 'history', text: 'Second HPI fragment.' }
], receiptSessionId: 'runtime-duplicate-hpi-target' }));
assert(!duplicateNamedManifest.rows.some(row => row.action === 'write_note'), 'duplicate canonical HPI destinations remained executable');
const duplicateHpi = duplicateNamedManifest.rows.find(row => row.id === 'blocked-duplicate-note-hpi');
assert(duplicateHpi && duplicateHpi.capability === 'blocked' && duplicateHpi.payload.sections.length === 2, 'duplicate HPI was not shown as one fail-closed destination conflict');

const duplicateGenericManifest = window.__mlsWriteFlow.buildUnifiedManifest(Object.assign({}, reviewOpts, { plan: [], sections: [
  { key: 'note', text: 'First generic note.' }, { key: 'note', text: 'Second generic note.' }
], receiptSessionId: 'runtime-duplicate-generic-target' }));
assert(!duplicateGenericManifest.rows.some(row => row.action === 'write_note'), 'duplicate generic note destinations remained executable');
assert.strictEqual(duplicateGenericManifest.rows.find(row => row.id === 'blocked-duplicate-generic-note').capability, 'blocked', 'duplicate generic note did not fail closed visibly');

const procedureManifest = window.__mlsWriteFlow.buildUnifiedManifest(Object.assign({}, reviewOpts, { plan: [
  { kind: 'opnote', body: 'PROCEDURE / OPERATIVE NOTE:\nSynthetic reviewed procedure text.' }
], sections: [], receiptSessionId: 'runtime-procedure-manual-target' }));
const procedureRow = procedureManifest.rows.find(row => row.kind === 'procedure');
assert(procedureRow && procedureRow.capability === 'ready' && procedureRow.action === 'write_note', 'procedure/op note did not expose its exact supervised placement');
assert.strictEqual(procedureRow.destination, 'Athena encounter > Physical Exam > Procedure Documentation', 'procedure/op note advertised the wrong exact destination');
assert.strictEqual(procedureRow.payload.sections.length, 1, 'procedure/op note carried another note destination');
assert.strictEqual(procedureRow.payload.sections[0].key, 'procedure', 'procedure/op note lost its immutable destination key');
assert.strictEqual(procedureRow.payload.noteText, 'Synthetic reviewed procedure text.', 'procedure/op note transport label leaked into the exact editor payload');
assert(!procedureManifest.rows.some(row => row.id === 'write-note'), 'procedure/op note fell through to the generic note writer');
const pushHistorySource = /function pushHistoryNoteToAthena\(id\)\{[\s\S]*?\n\}/.exec(appSource);
assert(pushHistorySource && /n\.kind==='opnote'\?'procedure':'note'/.test(pushHistorySource[0]), 'saved op-note route discarded its artifact type');
assert(/var allowed=\{note:1,hpi:1,ros:1,exam:1,assessment:1,plan:1,procedure:1,dx:1,billing:1,orders:1\}/.test(appSource), 'the app blocks unknown destinations before review and admits only exact named clinical rows');
assert(!/var noteRoute=n\.kind==='opnote'\?'note'/.test(appSource), 'saved op notes explicitly fall back to the generic note route');
const taughtBinding = window.__mlsShowAsst.contextFor(teachManifest, taughtRow);
const taughtTarget = {
  selector: '#exact-note-editor', sectionLabel: 'Encounter note editor', label: 'Encounter note editor',
  framePath: 'top.0', frameUrl: 'https://athenanet.athenahealth.com/encounter/enc-1', tag: 'textarea', targetFingerprint: '1234abcd'
};
const teachStates = [];
const teachRequestId = window.__mlsShowAsst.startForRow(teachManifest, taughtRow, state => teachStates.push(state.state));
for (const fn of [...(windowListeners.message || [])]) fn({ data: { source: 'mls-ext', type: 'mlsAppTeachStartResult', requestId: teachRequestId, resp: { ok: true, state: 'waiting' } } });
for (const fn of [...(windowListeners.message || [])]) fn({ data: { source: 'mls-ext', type: 'mlsAppTeachProgress', requestId: teachRequestId, resp: { ok: true, state: 'captured', binding: taughtBinding, target: taughtTarget } } });
assert.strictEqual(window.__mlsShowAsst.forRow(teachManifest, taughtRow).selector, '#exact-note-editor', 'validated taught selector was not scoped to the exact manifest row');
assert.deepStrictEqual(teachStates, ['connected', 'waiting', 'captured'], 'destination teaching did not expose its explicit connection lifecycle');
sent.length = 0;
const manifest = window.__mlsWriteFlow.openUnifiedConfirmation(reviewOpts);
const actionMessages = () => sent.filter(message => message.type === 'mlsAppAthenaActionV2');

const tick = () => new Promise(resolve => setTimeout(resolve, 8));

(async () => {
  assert(manifest && Object.isFrozen(manifest));
  assert(byId.mlsAthenaUnifiedConfirm, 'unified page did not open');
  assert(!byId.athenaReceipt, 'legacy receipt still overlaps unified page');
  assert(!byId.mlsAthenaActionConfirm, 'legacy action modal still overlaps unified page');
  assert.strictEqual(actionMessages().length, 1);
  assert.strictEqual(actionMessages()[0].mode, 'probe', 'opening the review must only perform a read-only probe');
  assert.strictEqual(actionMessages()[0].manifestHash, manifest.manifestHash, 'probe lost the immutable manifest binding');
  assert.strictEqual(actionMessages()[0].rowHash, taughtRow.rowHash, 'probe lost the exact destination-row binding');
  assert.strictEqual(actionMessages()[0].taughtDestination.selector, '#exact-note-editor', 'read-only probe did not consume the taught destination');
  await tick();

  const go = byId.mlsAthenaUnifiedGo;
  assert(go && !go.disabled, 'Confirm & write did not enable after exact read-only verification');
  assert.strictEqual(go.getAttribute('data-mls-athena-action'), 'write_note');
  assert.strictEqual(go.getAttribute('data-mls-preview-hash'), manifest.previewHash);
  assert(/Confirm write reviewed note/i.test(go.getAttribute('aria-label')));
  const card = byId.mlsAthenaUnifiedConfirm.children[0];
  assert(/MANUAL|COMPLETE IN ATHENA/.test(card.innerHTML), 'manual diagnosis/order rows are not visible');
  assert(/complete (?:billing|the exact order|final actions).+Athena/i.test(card.innerHTML), 'review does not visibly route unsupported/untyped rows to Athena');
  assert(/Exact reviewed note\./.test(card.innerHTML), 'full note payload is not visible');

  go.listeners.click[0]({ target: go });
  await tick();
  assert.deepStrictEqual(actionMessages().map(message => message.mode), ['probe', 'execute'], 'one Confirm & write click must issue exactly one typed execute');
  assert.strictEqual(actionMessages()[1].action, 'write_note');
  assert.strictEqual(actionMessages()[1].noteText, 'Exact reviewed note.');
  assert.strictEqual(actionMessages()[1].taughtDestination.selector, '#exact-note-editor', 'confirmed execute did not consume the same taught destination');
  assert.strictEqual(actionMessages()[1].taughtDestination.contextHash, taughtBinding.contextHash, 'confirmed execute changed the taught patient/writeflow binding');
  assert(!actionMessages().some(message => message.action === 'sign_encounter'), 'Sign auto-chained from a newly written note');
  assert(/VERIFIED/.test(byId.mlsAthenaUnifiedReceipt.innerHTML), 'per-row verified receipt was not rendered');
  const signRow = manifest.rows.find(row => row.id === 'sign-encounter');
  assert(signRow && signRow.capability === 'ready' && signRow.action === 'sign_encounter', 'capable extension did not expose Sign as its own immutable, proof-gated row');
  assert.strictEqual(actionMessages().filter(message => message.action === 'sign_encounter').length, 0, 'proof-gated Sign ran without a separate row selection and confirmation');

  console.log('PASS unified Athena runtime: exact taught destination bound through probe + one confirmed execute, one page, per-row receipt, separate proof-gated Sign with no auto-chain');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

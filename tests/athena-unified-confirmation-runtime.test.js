'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
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
  sessionStorage: (() => { const data = Object.create(null); return { getItem: key => Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null, setItem: (key, value) => { data[key] = String(value); }, removeItem: key => { delete data[key]; } }; })(),
  toast() {},
  addEventListener(type, fn) { (windowListeners[type] || (windowListeners[type] = [])).push(fn); },
  removeEventListener(type, fn) { windowListeners[type] = (windowListeners[type] || []).filter(item => item !== fn); },
  postMessage(message) {
    sent.push(structuredClone(message));
    const response = message.mode === 'probe'
      ? { ok: true, actionToken: 'one-use-token', context: exactContext }
      : {
          ok: true, written: true, noteWritten: true, verified: true,
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

const tick = () => new Promise(resolve => setTimeout(resolve, 8));

(async () => {
  assert(manifest && Object.isFrozen(manifest));
  assert(byId.mlsAthenaUnifiedConfirm, 'unified page did not open');
  assert(!byId.athenaReceipt, 'legacy receipt still overlaps unified page');
  assert(!byId.mlsAthenaActionConfirm, 'legacy action modal still overlaps unified page');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].mode, 'probe', 'opening the review must only perform a read-only probe');
  assert.strictEqual(sent[0].manifestHash, manifest.manifestHash, 'probe lost the immutable manifest binding');
  assert.strictEqual(sent[0].rowHash, taughtRow.rowHash, 'probe lost the exact destination-row binding');
  assert.strictEqual(sent[0].taughtDestination.selector, '#exact-note-editor', 'read-only probe did not consume the taught destination');
  await tick();

  const go = byId.mlsAthenaUnifiedGo;
  assert(go && !go.disabled, 'Confirm & write did not enable after exact read-only verification');
  assert.strictEqual(go.getAttribute('data-mls-athena-action'), 'write_note');
  assert.strictEqual(go.getAttribute('data-mls-preview-hash'), manifest.previewHash);
  assert(/Confirm write reviewed note/i.test(go.getAttribute('aria-label')));
  const card = byId.mlsAthenaUnifiedConfirm.children[0];
  assert(/MANUAL/.test(card.innerHTML) && /BLOCKED/.test(card.innerHTML), 'manual and blocked rows are not visible');
  assert(/Exact reviewed note\./.test(card.innerHTML), 'full note payload is not visible');

  go.listeners.click[0]({ target: go });
  await tick();
  assert.deepStrictEqual(sent.map(message => message.mode), ['probe', 'execute'], 'one Confirm & write click must issue exactly one typed execute');
  assert.strictEqual(sent[1].action, 'write_note');
  assert.strictEqual(sent[1].noteText, 'Exact reviewed note.');
  assert.strictEqual(sent[1].taughtDestination.selector, '#exact-note-editor', 'confirmed execute did not consume the same taught destination');
  assert.strictEqual(sent[1].taughtDestination.contextHash, taughtBinding.contextHash, 'confirmed execute changed the taught patient/writeflow binding');
  assert(!sent.some(message => message.action === 'sign_encounter'), 'Sign auto-chained from a newly written note');
  assert(/VERIFIED/.test(byId.mlsAthenaUnifiedReceipt.innerHTML), 'per-row verified receipt was not rendered');
  assert(byId.mlsAthenaUnifiedReviewSign, 'verified note should offer a separate Sign review, not auto-run it');

  console.log('PASS unified Athena runtime: exact taught destination bound through probe + one confirmed execute, one page, per-row receipt, no Sign auto-chain');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

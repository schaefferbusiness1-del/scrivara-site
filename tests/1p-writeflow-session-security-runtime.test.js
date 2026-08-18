'use strict';

/* P1-only adversarial ownership proof for Athena note writes. All identities
 * are synthetic. No extension, Athena tab, backend, or network is used. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');
const byId = Object.create(null);
const winListeners = Object.create(null);
const docListeners = Object.create(null);
const posted = [];

class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.children = [];
    this.parentNode = null;
    this.nodeType = 1;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this._id = '';
    this._html = '';
    this._text = '';
  }
  set id(value) { this._id = String(value || ''); if (this._id) byId[this._id] = this; }
  get id() { return this._id; }
  _drop(node) {
    node.children.slice().forEach(child => this._drop(child));
    if (node.id && byId[node.id] === node) delete byId[node.id];
  }
  set textContent(value) {
    this._text = String(value || '');
    this.children.slice().forEach(child => this._drop(child));
    this.children = [];
    this._html = this._text;
  }
  get textContent() { return this._text; }
  set innerHTML(value) {
    this.children.slice().forEach(child => this._drop(child));
    this.children = [];
    this._html = String(value || '');
    this._text = '';
    const tags = this._html.match(/<(?:button|div|input|textarea|select)\b[^>]*>/gi) || [];
    for (const raw of tags) {
      const id = /\bid="([^"]+)"/i.exec(raw);
      const name = /\bname="([^"]+)"/i.exec(raw);
      const dataRow = /\bdata-mls-(?:copy-note|copy-payload|accept-order|teach-start|teach-cancel|teach-clear)="([^"]+)"/i.exec(raw);
      if (!id && !name && !dataRow) continue;
      const tag = /^<([a-z]+)/i.exec(raw)[1];
      const el = new El(tag);
      if (id) el.id = id[1];
      if (name) el.setAttribute('name', name[1]);
      const val = /\bvalue="([^"]*)"/i.exec(raw); if (val) el.value = val[1];
      if (/\bdisabled\b/i.test(raw)) el.disabled = true;
      const attrs = raw.match(/\bdata-mls-[a-z-]+="[^"]*"/gi) || [];
      attrs.forEach(pair => { const m = /([^=]+)="([^"]*)"/.exec(pair); if (m) el.setAttribute(m[1], m[2]); });
      this.appendChild(el);
    }
  }
  get innerHTML() { return this._html; }
  appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] || ''; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const all = [];
    const walk = node => node.children.forEach(child => { all.push(child); walk(child); });
    walk(this);
    if (selector[0] === '#') return all.filter(el => el.id === selector.slice(1));
    if (/input\[name="mlsAthenaUnifiedAction"\]/.test(selector)) return all.filter(el => el.tagName === 'INPUT' && el.getAttribute('name') === 'mlsAthenaUnifiedAction');
    if (selector === 'input,textarea,select') return all.filter(el => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
    if (/^button/.test(selector)) return all.filter(el => el.tagName === 'BUTTON');
    const data = /^\[([^\]]+)\]$/.exec(selector);
    if (data) return all.filter(el => Object.prototype.hasOwnProperty.call(el.attrs, data[1]));
    return [];
  }
  contains(el) { if (el === this) return true; return this.children.some(child => child.contains(el)); }
  focus() { document.activeElement = this; }
  remove() {
    this._drop(this);
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
}

const document = {
  readyState: 'loading',
  body: new El('body'),
  documentElement: new El('html'),
  activeElement: null,
  createElement: tag => new El(tag),
  createTextNode: text => { const el = new El('#text'); el.textContent = text; return el; },
  getElementById: id => byId[id] || null,
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); },
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  addEventListener(type, fn) { (docListeners[type] || (docListeners[type] = [])).push(fn); },
  removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter(item => item !== fn); },
  contains(el) { return this.body.contains(el); }
};

let token = 'token-account-a';
const window = {
  document,
  location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
  __mlsSessionAccount: 'clinician@example.test',
  __mlsSessionEpoch: 11,
  bkToken: () => token,
  toast() {},
  addEventListener(type, fn) { (winListeners[type] || (winListeners[type] = [])).push(fn); },
  removeEventListener(type, fn) { winListeners[type] = (winListeners[type] || []).filter(item => item !== fn); },
  postMessage(message, targetOrigin) { posted.push({ message: structuredClone(message), targetOrigin }); }
};
window.window = window;

function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
function longTimerSafe(fn, ms) { const timer = setTimeout(fn, ms); if (ms > 1000 && timer.unref) timer.unref(); return timer; }
const context = vm.createContext({ window, document, location: window.location, MutationObserver, console, structuredClone,
  setTimeout: longTimerSafe, clearTimeout, Date, Math, Promise, Object, Array, String, Number, RegExp, JSON, Uint32Array });
vm.runInContext(source, context, { filename: '1p-feat_mls_writeflow.js' });

const PATIENT = { patientId: 'synthetic-patient-a', name: 'Synthetic Patient A', dob: '01/02/1980', mrn: '100001' };
const NOTE = 'Synthetic exact reviewed note for the current visit.';
const EXACT_CONTEXT = {
  patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn,
  encounterId: 'enc-synthetic-1', encounterUrl: 'https://athenanet.athenahealth.com/encounter/enc-synthetic-1',
  visitDate: '8/13/2026', provider: 'Synthetic Clinician, MD', controlLabel: 'Encounter note editor'
};
const OPTS = {
  patient: PATIENT,
  expectedContext: { appointmentId: '900001', visitDate: '08/13/2026', provider: 'Synthetic Clinician, MD' },
  receiptSessionId: 'synthetic-receipt', previewHash: 'mls-preview-synthetic', preferredAction: 'write_note',
  sections: [{ key: 'note', text: NOTE }]
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const messages = mode => posted.filter(item => item.message.mode === mode);
function emitWindow(type, event) { (winListeners[type] || []).slice().forEach(fn => fn(event)); }
function reply(item, resp, extras) {
  emitWindow('message', Object.assign({ source: window, origin: window.location.origin, data: {
    source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: item.message.requestId, resp
  } }, extras || {}));
}
function probeReceipt(label) { return { ok: true, actionToken: 'one-use-' + label, context: Object.assign({}, EXACT_CONTEXT) }; }
function executeReceipt() { return { ok: true, written: true, noteWritten: true, verified: true,
  noteWriteProof: 'proof-synthetic', noteWriteProofExpiresAt: Date.now() + 120000, context: Object.assign({}, EXACT_CONTEXT) }; }
function click(el) { (el.listeners.click || []).slice().forEach(fn => fn.call(el, { target: el })); }

(async () => {
  /* A probe is in flight. Boundary first, then a same-email B token/epoch.
   * Its late response and the detached stale control cannot paint or execute. */
  window.__mlsWriteFlow.openUnifiedConfirmation(OPTS);
  assert.strictEqual(messages('probe').length, 1, 'A read-only probe did not start');
  const aProbe = messages('probe')[0];
  const aOverlay = byId.mlsAthenaUnifiedConfirm;
  const aGo = byId.mlsAthenaUnifiedGo;
  assert(aOverlay && aOverlay.children[0].innerHTML.includes(PATIENT.name), 'A confirmation did not visibly contain the synthetic identity');

  token = 'token-account-b';
  window.__mlsSessionEpoch = 12;
  emitWindow('mls:session-boundary', { type: 'mls:session-boundary', detail: { account: window.__mlsSessionAccount, epoch: 12 } });
  assert.strictEqual(byId.mlsAthenaUnifiedConfirm, undefined, 'boundary left the PHI overlay mounted');
  assert.strictEqual(aOverlay.children.length, 0, 'boundary did not synchronously scrub the detached overlay');
  assert.strictEqual(window.__mlsWriteFlow.state.lastResp, null, 'boundary retained an Athena response');
  assert.deepStrictEqual(Object.keys(window.__mlsWriteFlow.state.verifiedWrites), [], 'boundary retained verified-write PHI');

  reply(aProbe, probeReceipt('late-a'));
  click(aGo);
  await tick();
  assert.strictEqual(messages('execute').length, 0, 'late A response/control emitted a write under B');

  /* A complete read-only confirmation is also destroyed before its click. */
  window.__mlsWriteFlow.openUnifiedConfirmation(OPTS);
  const bProbeBeforeBoundary = messages('probe').slice(-1)[0];
  reply(bProbeBeforeBoundary, probeReceipt('b-pending'));
  await tick();
  const pendingGo = byId.mlsAthenaUnifiedGo;
  assert(pendingGo && pendingGo.disabled === false, 'exact read-only receipt did not arm the current confirmation');
  token = 'token-account-b2';
  window.__mlsSessionEpoch = 13;
  emitWindow('mls:session-boundary', { type: 'mls:session-boundary', detail: { account: window.__mlsSessionAccount, epoch: 13 } });
  click(pendingGo);
  await tick();
  assert.strictEqual(messages('execute').length, 0, 'stale armed confirmation wrote after same-email reauthentication');
  assert.strictEqual(byId.mlsAthenaUnifiedConfirm, undefined, 'armed confirmation survived the account boundary');

  /* The exact current B action remains usable, but only once. Foreign window
   * and wrong-origin receipts cannot arm it. */
  window.__mlsWriteFlow.openUnifiedConfirmation(OPTS);
  const currentProbe = messages('probe').slice(-1)[0];
  reply(currentProbe, probeReceipt('forged-source'), { source: {} });
  reply(currentProbe, probeReceipt('forged-origin'), { origin: 'https://attacker.invalid' });
  await tick();
  assert.strictEqual(byId.mlsAthenaUnifiedGo.disabled, true, 'foreign source/origin armed the write control');
  reply(currentProbe, probeReceipt('current-b'));
  await tick();
  const currentGo = byId.mlsAthenaUnifiedGo;
  assert.strictEqual(currentGo.disabled, false, 'current exact receipt did not arm the write control');
  click(currentGo);
  click(currentGo);
  assert.strictEqual(messages('execute').length, 1, 'one current confirmation did not emit exactly one execute');
  assert.strictEqual(messages('execute')[0].targetOrigin, window.location.origin, 'bridge used a wildcard target origin');
  assert.strictEqual(messages('execute')[0].message.noteText, NOTE, 'confirmed note changed after review');
  reply(messages('execute')[0], executeReceipt());
  await tick();
  assert(/VERIFIED/.test(byId.mlsAthenaUnifiedReceipt.innerHTML), 'current exact action did not render its verified receipt');
  assert.strictEqual(messages('execute').length, 1, 'completion auto-chained or repeated the write');

  /* The older standalone action confirmation is fenced and scrubbed too. */
  window.__mlsWriteFlow.closeUnifiedConfirmation();
  const legacyStart = window.__mlsWriteFlow.startAthenaAction('write_note', OPTS);
  const legacyProbe = messages('probe').slice(-1)[0];
  reply(legacyProbe, probeReceipt('legacy-current'));
  await legacyStart;
  await tick();
  const legacyGo = byId.mlsAthenaActionGo;
  assert(legacyGo && byId.mlsAthenaActionConfirm, 'standalone action confirmation did not open');
  token = 'token-account-b3';
  window.__mlsSessionEpoch = 14;
  emitWindow('mls:session-boundary', { type: 'mls:session-boundary', detail: { account: window.__mlsSessionAccount, epoch: 14 } });
  click(legacyGo);
  await tick();
  assert.strictEqual(messages('execute').length, 1, 'stale standalone confirmation emitted a write');
  assert.strictEqual(byId.mlsAthenaActionConfirm, undefined, 'standalone PHI confirmation survived the boundary');

  assert(source.includes('p1-write-session-1.0.0') && source.includes("window.addEventListener('mls:session-boundary', wfBoundaryHandler, true)"), 'P1 session owner marker/listener missing');
  console.log('PASS 1p writeflow session security: A boundary scrubs PHI/tokens/handlers, stale and forged continuations cannot write, current B writes once');
})().catch(error => { console.error(error); process.exitCode = 1; });

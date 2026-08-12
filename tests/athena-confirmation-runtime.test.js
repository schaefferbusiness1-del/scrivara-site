'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sent = [];
const byId = Object.create(null);
const listeners = Object.create(null);

class El {
  constructor(tag = 'div') {
    Object.assign(this, {
      tagName: tag,
      style: {},
      attrs: {},
      listeners: {},
      children: [],
      nodeType: 1,
      disabled: false,
      textContent: '',
      parentNode: null,
      _id: ''
    });
  }
  set id(v) { this._id = String(v); if (v) byId[this._id] = this; }
  get id() { return this._id; }
  set innerHTML(v) { this._html = String(v); }
  appendChild(e) { this.children.push(e); e.parentNode = this; return e; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] || ''; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] || (this.listeners[t] = [])).push(f); }
  querySelector(selector) {
    if (!/^#mlsAthenaAction(?:Cancel|Go)$/.test(selector)) return null;
    const e = new El('button');
    e.id = selector.slice(1);
    return this.appendChild(e);
  }
  remove() {
    const drop = e => {
      e.children.forEach(drop);
      if (e.id && byId[e.id] === e) delete byId[e.id];
    };
    drop(this);
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this);
  }
}

const document = {
  readyState: 'loading',
  body: new El('body'),
  addEventListener() {},
  createElement: tag => new El(tag),
  getElementById: id => byId[id] || null,
  querySelectorAll: () => []
};
const window = {
  document,
  location: { origin: 'https://mlsscribe.com' },
  toast() {},
  addEventListener(t, f) { (listeners[t] || (listeners[t] = [])).push(f); },
  removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
  postMessage(msg) {
    sent.push(structuredClone(msg));
    const resp = msg.mode === 'probe'
      ? {
          ok: true,
          actionToken: 'token-' + sent.length,
          context: {
            patientName: 'Example Patient',
            dob: '1/2/1980',
            mrn: '123',
            encounterId: 'enc-1',
            encounterUrl: 'https://athenanet.athenahealth.com/encounter/enc-1',
            visitDate: '7/14/2026',
            provider: 'Example Doctor, MD',
            controlLabel: 'Athena Billing / Charges'
          }
        }
      : {
          ok: true, written: true, noteWritten: true, verified: true,
          noteWriteProof: 'proof-runtime-note', noteWriteProofExpiresAt: Date.now() + 120000,
          context: {
            patientName: 'Example Patient', dob: '1/2/1980', mrn: '123',
            encounterId: 'enc-1', encounterUrl: 'https://athenanet.athenahealth.com/encounter/enc-1',
            visitDate: '7/14/2026', provider: 'Example Doctor, MD', controlLabel: 'Encounter note editor'
          }
        };
    setTimeout(() => {
      [...(listeners.message || [])].forEach(f => f({
        data: {
          source: 'mls-ext',
          type: 'mlsAppAthenaActionV2Result',
          requestId: msg.requestId,
          resp
        }
      }));
    }, 0);
  }
};
window.window = window;

function MutationObserver() {
  this.observe = () => {};
  this.disconnect = () => {};
}
const vmTimeout = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  if (ms > 1000 && timer.unref) timer.unref();
  return timer;
};
const ctx = {
  window,
  document,
  console,
  setTimeout: vmTimeout,
  clearTimeout,
  Date,
  Math,
  Promise,
  Object,
  Array,
  String,
  Number,
  RegExp,
  JSON,
  Uint32Array,
  MutationObserver,
  structuredClone
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8'), ctx);

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

(async () => {
  const opts = {
    patient: { patientId: 'pt-runtime-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' },
    expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: 'appt-runtime-1' },
    plan: [{ kind: 'note', body: 'NOTE TEXT:\nExact reviewed note.' }]
  };

  /* Owner directive 2026-08-12: billing/sign are executable actions but fail
     closed without the extension's athenaFinalActionsV1 capability; orders
     stay manual-only. None of these may cross the bridge here. */
  const expectedRefusal = {
    stage_billing: 'final-action-capability-required',
    sign_encounter: 'final-action-capability-required',
    place_order: 'manual-only-final-action'
  };
  for (const action of ['stage_billing', 'sign_encounter', 'place_order']) {
    const refused = await window.__mlsWriteFlow.startAthenaAction(action, opts);
    assert.strictEqual(refused.error, expectedRefusal[action], `${action} was not refused at the UI controller`);
  }
  assert.deepStrictEqual(sent, [], 'a refused final action crossed the bridge');

  await window.__mlsWriteFlow.startAthenaAction('write_note', opts);
  await tick();
  assert.deepStrictEqual(sent.map(x => x.mode), ['probe'], 'opening note confirmation did not remain read-only');

  byId.mlsAthenaActionCancel.onclick();
  await tick();
  assert.deepStrictEqual(sent.map(x => x.mode), ['probe'], 'Cancel emitted an execute request');

  await window.__mlsWriteFlow.startAthenaAction('write_note', opts);
  await tick();
  assert.deepStrictEqual(sent.map(x => x.mode), ['probe', 'probe']);

  byId.mlsAthenaActionGo.listeners.click[0]({ target: byId.mlsAthenaActionGo });
  await tick();
  assert.deepStrictEqual(sent.map(x => x.mode), ['probe', 'probe', 'execute'], 'final confirmation did not emit exactly one execute');
  assert.strictEqual(sent[2].action, 'write_note');
  assert.strictEqual(sent[1].noteText, 'Exact reviewed note.');
  assert.strictEqual(sent[2].noteText, sent[1].noteText, 'note payload changed between visible probe and final confirmation');
  assert(!sent.some(x => ['stage_billing', 'sign_encounter', 'place_order'].includes(x.action)), 'a final action crossed the bridge');

  console.log('PASS Athena confirmation runtime: manual final actions never cross the bridge; note probe/cancel/one confirmed execute stay exact');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

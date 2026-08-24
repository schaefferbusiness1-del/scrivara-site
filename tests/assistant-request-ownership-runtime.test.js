'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_asst_fix.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function harness(options = {}) {
  let active = 'A', owner = 'A', rev = 0;
  const history = [], requests = [], toasts = [], snapshotQuestions = [], preflightQuestions = [], handlers = {};
  const store = {
    all() { return history.slice(); },
    messages() { return history.filter(m => m.role === 'user' || m.role === 'ai'); },
    append(role, text, extra) { const m = Object.assign({ role, text }, extra || {}); history.push(m); rev++; return m; },
    pushPending(text, extra) { const m = Object.assign({ role: 'pending', text }, extra || {}); history.push(m); rev++; return m; },
    dropPending(target) {
      let changed = false;
      for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'pending' && (!target || history[i] === target)) {
        history.splice(i, 1); changed = true; if (target) break;
      }
      if (changed) rev++;
      return changed;
    },
    subscribe() { return function () {}; }, rev() { return rev; }
  };
  class AbortController {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  }
  const document = {
    readyState: 'complete', activeElement: null,
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, RegExp, AbortController,
    location: { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' }, document,
    __mlsCopilotConvo: store, _copilotHistory: history, _copilotBusy: false,
    __mlsPtCtxSafety: { owner() { return owner; }, reconcile() {} },
    getActivePtId() { return active; }, activePatient() { return { id: active, name: 'Patient ' + active }; },
    getPatients() { return []; },
    copilotSnapshot(question) {
      snapshotQuestions.push(question);
      return { activePatient: { id: active, name: 'Patient ' + active }, patients: [{ id: active, name: 'Patient ' + active }, { id: 'FOREIGN', name: 'Foreign Patient', summary: 'FOREIGN_ASSISTANT_SENTINEL' }], panel: { foreign: true }, practiceMetrics: { visits: 4 } };
    },
    _copilotPrepareRequest(question, raw) {
      preflightQuestions.push(question);
      const activeRow = raw.patients.find(p => p.id === raw.activePatient.id);
      return {
        context: { activePatient: activeRow, patients: [activeRow], requestScope: 'active-patient' },
        localAnswer: options.localAnswer || null,
        chart: options.localAnswer ? null : { kind: 'patient-injection-trend', status: 'ready', patientId: activeRow.id, question }
      };
    },
    _copilotChartForQuestion(question, context) { return { kind: 'patient-injection-trend', status: 'ready', patientId: context.activePatient.id, question }; },
    backendMode() { return true; }, bkToken() { return 'token'; }, bkBase() { return 'https://example.test'; },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch(_url, options) { const d = deferred(); requests.push({ d, options }); return d.promise; },
    toast(message) { toasts.push(String(message)); },
    addEventListener(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); },
    removeEventListener() {}, setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`
    let currentVisitAthenaBinding = { id: 'visit-A' };
    let currentVisitAthenaEpoch = 1;
    function __switchVisit(id, epoch) { currentVisitAthenaBinding = { id: id }; currentVisitAthenaEpoch = epoch; }
  `, context);
  vm.runInContext(source, context, { filename: 'feat_mls_asst_fix.js' });
  return {
    context, history, requests, snapshotQuestions, preflightQuestions, toasts,
    switchPatient(id) {
      active = id; owner = id; context.__switchVisit('visit-' + id, id === 'A' ? 1 : 2);
      (handlers['mls:active-patient-changed'] || []).forEach(fn => fn());
    }
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  const h = harness();
  assert.strictEqual(h.context.__mlsAsstFix.version, '1.4.1');
  assert.strictEqual(h.context.__mlsAsstFix._handleSend('summarize this patient'), true);
  assert.strictEqual(h.requests.length, 1);
  const firstWire = JSON.parse(h.requests[0].options.body);
  assert.strictEqual(firstWire.context.requestScope, 'active-patient');
  assert.deepStrictEqual(firstWire.context.patients.map(p => p.id), ['A'], 'Assistant sent another patient after preflight');
  assert(!JSON.stringify(firstWire).includes('FOREIGN_ASSISTANT_SENTINEL'), 'Assistant sent a stripped foreign sentinel');
  assert.strictEqual(h.context.__mlsAsstFix._handleSend('duplicate click'), false, 'busy Assistant accepted a second request');
  assert.strictEqual(h.history.filter(m => m.role === 'user').length, 1, 'busy double-click injected a duplicate user turn');

  h.switchPatient('B');
  assert.strictEqual(h.requests[0].options.signal.aborted, true, 'canonical patient-change event did not abort stale Assistant request');
  h.requests[0].d.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'Patient A answer' }) });
  await settle(); await settle();
  assert(!h.history.some(m => m.text === 'Patient A answer'), 'stale patient-A answer landed after switching to patient B');
  assert(!h.history.some(m => m.role === 'pending'), 'stale Assistant request left a pending bubble');
  assert.strictEqual(h.context._copilotBusy, false, 'stale Assistant request left Copilot busy');
  assert(h.toasts.some(t => /discarded/i.test(t)), 'stale response discard was not explained');

  assert.strictEqual(h.context.__mlsAsstFix._handleSend('show useful next steps'), true);
  h.requests[1].d.resolve({ ok: true, status: 200, json: () => Promise.resolve({
    reply: 'Safe answer',
    actions: [{ kind: 'navigate', arg: 'visit', label: 'Open visit' }, { kind: 'navigate', arg: 'visit', label: 'Open visit' }],
    followups: ['What next?', 'What next?'],
    citations: [{ visitId: 'visit-B', label: '2026-08-21 visit' }]
  }) });
  await settle(); await settle();
  const answer = h.history.find(m => m.text === 'Safe answer');
  assert(answer, 'stable Assistant answer was not accepted');
  assert.strictEqual(answer.actions.length, 1, 'duplicate response action survived normalization');
  assert.strictEqual(answer.followups.length, 1, 'duplicate follow-up survived normalization');
  assert.deepStrictEqual(h.snapshotQuestions, ['summarize this patient', 'show useful next steps'], 'Assistant owner did not pass each submitted question into copilotSnapshot');
  assert.deepStrictEqual(h.preflightQuestions, ['summarize this patient', 'show useful next steps'], 'Assistant owner bypassed canonical request preflight');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(answer.chart)), { kind: 'patient-injection-trend', status: 'ready', patientId: 'B', question: 'show useful next steps' }, 'Assistant did not preserve patient-bound local chart metadata on the accepted response');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(answer.citations)), [{ visitId: 'visit-B', label: '2026-08-21 visit' }], 'Assistant did not preserve citation metadata on the accepted response');
  assert.strictEqual(h.context._copilotBusy, false);

  const localProcedure = harness({
    localAnswer: {
      kind: 'patient-procedure-list', status: 'ready', patientId: 'A',
      message: 'Documented procedure for Patient A.',
      citations: [{ ref: 'V1', date: '2026-01-10', type: 'Injection', source: 'athena-visits' }]
    }
  });
  assert.strictEqual(localProcedure.context.__mlsAsstFix._handleSend('What procedures did he get done?'), true);
  assert.strictEqual(localProcedure.requests.length, 0, 'Assistant deterministic procedure answer reached /api/copilot');
  const procedureAnswer = localProcedure.history.find(m => m.role === 'ai' && /Documented procedure/.test(m.text || ''));
  assert(procedureAnswer && procedureAnswer.procedureAnswer && procedureAnswer.citations.length === 1,
    'Assistant lost deterministic procedure evidence metadata');
  assert.strictEqual(localProcedure.context._copilotBusy, false, 'Assistant local answer left Copilot busy');
  assert.strictEqual(localProcedure.history.some(m => m.role === 'pending'), false, 'Assistant local answer left a pending row');

  const mismatch = harness({
    localAnswer: { kind: 'patient-subject-mismatch', status: 'blocked', patientId: 'A', message: 'Open the named patient chart and ask again.', citations: [] }
  });
  assert.strictEqual(mismatch.context.__mlsAsstFix._handleSend('Tell me about Another Person last visit'), true);
  assert.strictEqual(mismatch.requests.length, 0, 'Assistant named-subject refusal reached /api/copilot');
  assert(mismatch.history.some(m => m.localAnswer && m.localAnswer.kind === 'patient-subject-mismatch'),
    'Assistant did not preserve the subject-mismatch refusal');

  console.log('PASS Assistant Copilot ownership: immutable patient/visit owner, preflight scoping, zero-fetch deterministic answers, stale suppression, exact busy state, and deduped response affordances');
})().catch(error => { console.error(error); process.exit(1); });

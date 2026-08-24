'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_copilot_request_safety.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const normalizeStart = appSource.indexOf('function _copilotTopPatientsByVisits');
const normalizeEnd = appSource.indexOf('function _copilotRenderThread', normalizeStart);
assert(normalizeStart >= 0 && normalizeEnd > normalizeStart, 'client Copilot action normalizer is missing');
const normalizeSource = appSource.slice(normalizeStart, normalizeEnd);

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function makeHarness(prompt = 'summarize this patient', options = {}) {
  const input = { value: prompt, style: {} };
  const chips = { innerHTML: '' };
  const send = { disabled: false };
  const nodes = { copilotInput: input, copilotChips: chips, copilotSendBtn: send };
  const request = deferred();
  const toasts = [];
  const calls = [];
  const requestOptions = [];
  const snapshotQuestions = [];
  const preflightQuestions = [];
  const handlers = {};
  let active = 'A';
  let owner = 'A';
  class AbortController {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  }
  const context = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, AbortController,
    _copilotHistory: [], _copilotBusy: false, _calAppts: [{}],
    document: { getElementById(id) { return nodes[id] || null; } },
    copilotAsk() { throw new Error('unguarded original should be replaced'); },
    backendMode() { return true; }, bkToken() { return 'token'; }, bkBase() { return 'https://example.test'; },
    getActivePtId() { return active; },
    copilotSnapshot(question) {
      snapshotQuestions.push(question);
      return { activePatient: { id: active, name: 'Patient ' + active }, patients: [{ id: active, name: 'Patient ' + active }, { id: 'FOREIGN', name: 'Foreign Patient', summary: 'FOREIGN_CONTEXT_SENTINEL' }], panel: { foreign: true } };
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
    _copilotRenderThread() {}, _copilotRenderChips() {}, _copilotSaveHist() {},
    toast(message) { toasts.push(message); },
    __mlsPtCtxSafety: { owner() { return owner; }, reconcile() {} },
    addEventListener(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); },
    removeEventListener() {},
    fetch(_url, opts) { calls.push(JSON.parse(opts.body)); requestOptions.push(opts); return request.promise; }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`
    let currentVisitAthenaBinding = { id: 'visit-a' };
    let currentVisitAthenaEpoch = 1;
    function __switchVisitForTest(id, epoch) {
      currentVisitAthenaBinding = { id: id };
      currentVisitAthenaEpoch = epoch;
    }
  `, context);
  vm.runInContext(normalizeSource, context, { filename: 'ScribeFlow-copilot-normalizer.js' });
  vm.runInContext(source, context, { filename: 'feat_mls_copilot_request_safety.js' });
  return {
    context, request, calls, requestOptions, snapshotQuestions, preflightQuestions, toasts,
    switchToB() {
      active = 'B'; owner = 'B';
      context.__switchVisitForTest('visit-b', 2);
      context._copilotHistory = [];
      (handlers['mls:active-patient-changed'] || []).forEach(fn => fn());
    }
  };
}

(async () => {
  const stale = makeHarness();
  const run = stale.context.copilotAsk();
  assert.strictEqual(stale.calls.length, 1, 'Copilot did not issue its read-only request');
  assert.strictEqual(await stale.context.copilotAsk(), false, 'busy Copilot accepted a duplicate send');
  assert.strictEqual(stale.calls.length, 1, 'busy duplicate send issued a second request');
  stale.switchToB();
  assert.strictEqual(stale.requestOptions[0].signal.aborted, true, 'canonical patient-change event did not abort the stale request');
  stale.request.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'Patient A answer' }) });
  assert.strictEqual(await run, false, 'stale Copilot response was reported as accepted');
  assert(!stale.context._copilotHistory.some(m => /Patient A answer/.test(m.text || '')), 'patient-A answer landed in patient B history');
  assert(stale.toasts.some(t => /discarded/i.test(t)), 'patient switch did not produce an honest discarded-result notice');

  const stable = makeHarness();
  assert.strictEqual(stable.context.__mlsCopilotRequestSafety.version, 'crs-1.2.0');
  const stableRun = stable.context.copilotAsk();
  stable.request.resolve({ ok: true, status: 200, json: () => Promise.resolve({
    reply: 'Safe answer',
    actions: [{ kind: 'navigate', arg: 'visit', label: 'Open visit' }, { kind: 'navigate', arg: 'visit', label: 'Open visit' }],
    followups: ['What next?', 'What next?'],
    citations: [{ visitId: 'visit-a', label: '2026-08-20 visit' }]
  }) });
  assert.strictEqual(await stableRun, true);
  assert.deepStrictEqual(stable.snapshotQuestions, ['summarize this patient'], 'request-safety owner did not pass the submitted question into copilotSnapshot');
  assert.deepStrictEqual(stable.preflightQuestions, ['summarize this patient'], 'request-safety owner bypassed canonical request preflight');
  assert.strictEqual(stable.calls[0].context.requestScope, 'active-patient');
  assert.deepStrictEqual(stable.calls[0].context.patients.map(p => p.id), ['A'], 'request-safety owner sent another patient after preflight');
  assert(!JSON.stringify(stable.calls[0]).includes('FOREIGN_CONTEXT_SENTINEL'), 'request-safety owner sent a stripped foreign sentinel');
  assert(stable.context._copilotHistory.some(m => m.role === 'ai' && m.text === 'Safe answer'));
  const safeAnswer = stable.context._copilotHistory.find(m => m.role === 'ai' && m.text === 'Safe answer');
  assert.strictEqual(safeAnswer.actions.length, 1, 'duplicate Copilot response action survived normalization');
  assert.strictEqual(safeAnswer.followups.length, 1, 'duplicate Copilot follow-up survived normalization');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(safeAnswer.chart)), { kind: 'patient-injection-trend', status: 'ready', patientId: 'A', question: 'summarize this patient' }, 'patient-bound local chart metadata was not preserved on the accepted response');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(safeAnswer.citations)), [{ visitId: 'visit-a', label: '2026-08-20 visit' }], 'citation metadata was not preserved on the accepted response');
  assert.strictEqual(stable.context._copilotHistory.some(m => m.role === 'pending'), false);

  const localTop = makeHarness('Who are my top patients by visit count?');
  const localTopRun = localTop.context.copilotAsk();
  localTop.request.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'Local visit-count answer' }) });
  assert.strictEqual(await localTopRun, true);
  const localTopAnswer = localTop.context._copilotHistory.find(m => m.role === 'ai' && m.text === 'Local visit-count answer');
  assert(localTopAnswer, 'production request-safety owner dropped the local visit-count answer');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(localTopAnswer.actions)), [
    { label: 'View Top Patients', kind: 'navigate', arg: 'patients' }
  ], 'production request-safety owner bypassed the top-patient action normalizer');
  assert.deepStrictEqual(localTop.snapshotQuestions, ['Who are my top patients by visit count?']);

  const limited = makeHarness();
  const limitedRun = limited.context.copilotAsk();
  limited.request.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: 'generic error' }) });
  assert.strictEqual(await limitedRun, true, 'handled high-demand response was not completed cleanly');
  assert(limited.context._copilotHistory.some(m => /unusually high demand/i.test(m.text || '')), '429 response was not distinguished from a generic failure');

  const localProcedure = makeHarness('What procedures did he get done?', {
    localAnswer: {
      kind: 'patient-procedure-list', status: 'ready', patientId: 'A',
      message: 'Documented procedure for Patient A.',
      citations: [{ ref: 'V1', date: '2026-01-10', type: 'Injection', source: 'athena-visits' }]
    }
  });
  assert.strictEqual(await localProcedure.context.copilotAsk(), true, 'guarded owner did not complete deterministic procedure answer');
  assert.strictEqual(localProcedure.calls.length, 0, 'deterministic procedure answer reached /api/copilot');
  const procedureAnswer = localProcedure.context._copilotHistory.find(m => m.role === 'ai' && /Documented procedure/.test(m.text || ''));
  assert(procedureAnswer && procedureAnswer.procedureAnswer && procedureAnswer.citations.length === 1,
    'guarded owner lost deterministic procedure evidence metadata');
  assert.strictEqual(localProcedure.context._copilotBusy, false, 'local answer left guarded Copilot busy');
  assert.strictEqual(localProcedure.context._copilotHistory.some(m => m.role === 'pending'), false, 'local answer left a pending row');

  const mismatch = makeHarness('Tell me about Another Person last visit', {
    localAnswer: { kind: 'patient-subject-mismatch', status: 'blocked', patientId: 'A', message: 'Open the named patient chart and ask again.', citations: [] }
  });
  assert.strictEqual(await mismatch.context.copilotAsk(), true);
  assert.strictEqual(mismatch.calls.length, 0, 'named-subject refusal reached /api/copilot');
  assert(mismatch.context._copilotHistory.some(m => m.localAnswer && m.localAnswer.kind === 'patient-subject-mismatch'),
    'guarded owner did not preserve the subject-mismatch refusal');

  console.log('PASS Copilot request binding: abort/stale ownership, preflight scoping, zero-fetch deterministic answers, response dedupe, and distinct service status');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

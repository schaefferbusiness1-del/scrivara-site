'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_copilot_request_safety.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function makeHarness() {
  const input = { value: 'summarize this patient', style: {} };
  const chips = { innerHTML: '' };
  const send = { disabled: false };
  const nodes = { copilotInput: input, copilotChips: chips, copilotSendBtn: send };
  const request = deferred();
  const toasts = [];
  const calls = [];
  const requestOptions = [];
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
    copilotSnapshot() { return { activePatient: { id: active } }; },
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
  vm.runInContext(source, context, { filename: 'feat_mls_copilot_request_safety.js' });
  return {
    context, request, calls, requestOptions, toasts,
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
  const stableRun = stable.context.copilotAsk();
  stable.request.resolve({ ok: true, status: 200, json: () => Promise.resolve({
    reply: 'Safe answer',
    actions: [{ kind: 'navigate', arg: 'visit', label: 'Open visit' }, { kind: 'navigate', arg: 'visit', label: 'Open visit' }],
    followups: ['What next?', 'What next?']
  }) });
  assert.strictEqual(await stableRun, true);
  assert(stable.context._copilotHistory.some(m => m.role === 'ai' && m.text === 'Safe answer'));
  const safeAnswer = stable.context._copilotHistory.find(m => m.role === 'ai' && m.text === 'Safe answer');
  assert.strictEqual(safeAnswer.actions.length, 1, 'duplicate Copilot response action survived normalization');
  assert.strictEqual(safeAnswer.followups.length, 1, 'duplicate Copilot follow-up survived normalization');
  assert.strictEqual(stable.context._copilotHistory.some(m => m.role === 'pending'), false);

  const limited = makeHarness();
  const limitedRun = limited.context.copilotAsk();
  limited.request.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: 'generic error' }) });
  assert.strictEqual(await limitedRun, true, 'handled high-demand response was not completed cleanly');
  assert(limited.context._copilotHistory.some(m => /unusually high demand/i.test(m.text || '')), '429 response was not distinguished from a generic failure');

  console.log('PASS Copilot request binding: abort/stale ownership, double-click lock, response dedupe, and distinct service status');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

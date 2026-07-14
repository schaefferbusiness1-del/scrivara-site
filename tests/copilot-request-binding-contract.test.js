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
  let active = 'A';
  let owner = 'A';
  const context = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number,
    _copilotHistory: [], _copilotBusy: false, _calAppts: [{}],
    document: { getElementById(id) { return nodes[id] || null; } },
    copilotAsk() { throw new Error('unguarded original should be replaced'); },
    backendMode() { return true; }, bkToken() { return 'token'; }, bkBase() { return 'https://example.test'; },
    getActivePtId() { return active; },
    copilotSnapshot() { return { activePatient: { id: active } }; },
    _copilotRenderThread() {}, _copilotRenderChips() {}, _copilotSaveHist() {},
    toast(message) { toasts.push(message); },
    __mlsPtCtxSafety: { owner() { return owner; }, reconcile() {} },
    fetch(_url, opts) { calls.push(JSON.parse(opts.body)); return request.promise; }
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
    context, request, calls, toasts,
    switchToB() {
      active = 'B'; owner = 'B';
      context.__switchVisitForTest('visit-b', 2);
      context._copilotHistory = [];
    }
  };
}

(async () => {
  const stale = makeHarness();
  const run = stale.context.copilotAsk();
  assert.strictEqual(stale.calls.length, 1, 'Copilot did not issue its read-only request');
  stale.switchToB();
  stale.request.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'Patient A answer' }) });
  assert.strictEqual(await run, false, 'stale Copilot response was reported as accepted');
  assert(!stale.context._copilotHistory.some(m => /Patient A answer/.test(m.text || '')), 'patient-A answer landed in patient B history');
  assert(stale.toasts.some(t => /discarded/i.test(t)), 'patient switch did not produce an honest discarded-result notice');

  const stable = makeHarness();
  const stableRun = stable.context.copilotAsk();
  stable.request.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'Safe answer' }) });
  assert.strictEqual(await stableRun, true);
  assert(stable.context._copilotHistory.some(m => m.role === 'ai' && m.text === 'Safe answer'));
  assert.strictEqual(stable.context._copilotHistory.some(m => m.role === 'pending'), false);

  console.log('PASS Copilot request binding: delayed answers cannot cross patient/conversation/visit ownership');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

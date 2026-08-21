'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_athena_provider_roster.js'), 'utf8');
const installToken = 'provider-dedupe-owned-roster';
const store = new Map();
const messageListeners = [];
let rosterUpdates = 0;
const localStorage = {
  getItem: key => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
};
const document = {
  readyState: 'complete',
  addEventListener() {}, removeEventListener() {},
  querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; },
  currentScript: {
    getAttribute(name) {
      if (name === 'data-mls-install-token') return installToken;
      if (name === 'data-mls-asset') return 'feat_athena_provider_roster.js';
      return null;
    }
  }
};
class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
const window = {
  window: null, document, localStorage, _calProviders: [],
  __MLS_MAIN: { enabled: true },
  __mlsP1ProviderRosterLoader: {
    installed: true, version: 'p1-provider-roster-1.0.0', installToken
  },
  __mlsSessionAccount: 'provider-dedupe@example.test',
  __mlsSessionEpoch: 1,
  bkToken: () => 'provider-dedupe-session-token',
  location: { origin: 'https://provider-dedupe.example.test' },
  uns: suffix => `dedupe-test::${suffix}`,
  addEventListener(type, fn) { if (type === 'message') messageListeners.push(fn); },
  removeEventListener() {},
  dispatchEvent(event) { if (event && event.type === 'mls-provider-roster-updated') rosterUpdates++; }
};
window.window = window;
const context = vm.createContext({
  window, document, localStorage, CustomEvent,
  console, Date, Object, Array, String, Number, Math, JSON, RegExp, WeakMap,
  setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
});
vm.runInContext(source, context, { filename: 'feat_athena_provider_roster.js' });
const api = window.__mlsProviderRoster;
assert(api && typeof api.getIngestStats === 'function', 'provider roster did not expose PHI-free ingestion counters');
assert.strictEqual(api.version, 'p1-provider-roster-1.0.0', 'the promoted exact provider-roster owner did not install');
assert.strictEqual(api.installToken, installToken, 'provider roster API is not bound to the exact loader token');

function reply(requestId) {
  return {
    ok: true, requestId, id: requestId, schedDate: '2026-07-21', text: '', appts: [],
    providerRoster: [{ stableKey: 'athena-id:synthetic-1', id: 'synthetic-1', raw: 'Synthetic_Doctor_MD', name: 'Synthetic Doctor, MD' }],
    providerRosterReceipt: {
      requestId, targetDate: '2026-07-21', complete: true, partial: false, reason: 'complete',
      expectedCount: 1, observedCount: 1, reachedEnd: true, capReached: false,
      budgetExpired: false, restored: true, boundsStable: true, steps: 1
    }
  };
}
function arm(requestId) {
  api.beginOperation({ targetDate: '2026-07-21', requestId, providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' });
}
function dispatch(resp) {
  const event = {
    source: window, origin: window.location.origin,
    data: { source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: resp.requestId, resp }
  };
  for (const fn of messageListeners) fn(event);
}

arm('schedule-request-1');
const first = reply('schedule-request-1');
dispatch(first);                                // passive capture listener
const firstDiag = api.getDiag();
const explicitDiag = api.ingestResp(first);     // exact pull's explicit receipt read
dispatch(first);                                // accidental duplicate event
api.ingestResp(JSON.parse(JSON.stringify(first))); // cloned replay, same request id
assert.strictEqual(explicitDiag, firstDiag, 'duplicate ingestion did not reuse the first normalized diagnostic');
assert.deepStrictEqual(Object.assign({}, api.getIngestStats()), { processed: 1, deduped: 3 }, 'one schedule reply performed duplicate roster/cache/DOM work');
assert.strictEqual(rosterUpdates, 1, 'one schedule reply dispatched duplicate provider-roster update events');

// Same shape/count on a genuinely new request must still be processed; the old
// length-signature de-dupe could not safely distinguish these operations.
arm('schedule-request-2');
dispatch(reply('schedule-request-2'));
assert.deepStrictEqual(Object.assign({}, api.getIngestStats()), { processed: 2, deduped: 3 }, 'new request was mistaken for a duplicate because its row counts matched');
assert.strictEqual(rosterUpdates, 2, 'new request did not publish its own roster receipt');

console.log('PASS provider roster ingestion: one normalization per request/object, cloned replay dedupe, and new same-shape request preserved');

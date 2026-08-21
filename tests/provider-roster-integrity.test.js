'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const rosterSrc = fs.readFileSync(path.join(root, 'feat_athena_provider_roster.js'), 'utf8');
const labelSrc = fs.readFileSync(path.join(root, 'feat_mls_provider_label.js'), 'utf8');
const assistantSrc = fs.readFileSync(path.join(root, 'feat_mls_asst_fix.js'), 'utf8');
const assistantExactSrc = fs.readFileSync(path.join(root, 'feat_mls_assistant_exact.js'), 'utf8');

function browserContext(calProviders) {
  const installToken = 'provider-integrity-owned-roster';
  const store = new Map();
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const document = {
    readyState: 'complete',
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    currentScript: {
      getAttribute(name) {
        if (name === 'data-mls-install-token') return installToken;
        if (name === 'data-mls-asset') return 'feat_athena_provider_roster.js';
        return null;
      }
    }
  };
  const window = {
    _calProviders: calProviders || [],
    __MLS_MAIN: { enabled: true },
    __mlsP1ProviderRosterLoader: {
      installed: true, version: 'p1-provider-roster-1.0.0', installToken
    },
    __mlsSessionAccount: 'provider-integrity@example.test',
    __mlsSessionEpoch: 1,
    bkToken: () => 'provider-integrity-session-token',
    uns: n => `acct:${n}`,
    addEventListener: () => {}, removeEventListener: () => {},
    document, localStorage
  };
  window.window = window;
  return vm.createContext({
    window, document, localStorage,
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: () => 1, clearTimeout: () => {},
    console
  });
}

let ingestSequence = 0;
function ingestExact(ctx, response) {
  const api = ctx.window.__mlsProviderRoster;
  assert(api && api.version === 'p1-provider-roster-1.0.0',
    'the promoted provider roster did not install under the exact controller/session owner');
  assert.strictEqual(api.installToken, ctx.window.__mlsP1ProviderRosterLoader.installToken,
    'the provider roster API is not bound to the exact loader token');
  const requestId = `provider-integrity-${++ingestSequence}`;
  assert(api.beginOperation({
    targetDate: '2026-07-15', requestId, providerMode: 'all',
    requestedProviderId: '', requestedProviderStableKey: ''
  }), 'the exact provider-roster operation did not arm');
  const payload = Object.assign({}, response, { requestId });
  if (payload.providerRosterReceipt) {
    payload.providerRosterReceipt = Object.assign({}, payload.providerRosterReceipt, {
      requestId, targetDate: '2026-07-15'
    });
  }
  const result = api.ingestResp(payload);
  assert(!result || result.ignored !== true,
    'the exact owned provider-roster response was refused as unbound');
  return result;
}

// Stable identity, not display name, is the roster invariant. Both clinicians
// survive even though their human labels are identical.
const ctx = browserContext([
  { id: '101', name: 'Alex Same' },
  { id: '202', name: 'Alex Same' },
  { id: '101', name: 'Alex Same' }
]);
vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
let roster = ctx.window.__mlsProviderRoster.list();
assert.deepStrictEqual(Array.from(roster, x => x.stableKey).sort(), ['backend:101', 'backend:202']);
assert(roster.every(x => x.rosterVerified), 'backend provider ids are verified roster identities');
assert.strictEqual(ctx.window.__mlsProviderRoster.resolve('Alex Same'), null, 'ambiguous same-name lookup must fail closed');
assert.strictEqual(ctx.window.__mlsProviderRoster.resolve('pv:' + encodeURIComponent('backend:101')).id, '101');

ingestExact(ctx, {
  providerRoster: [
    { stableKey: 'athena:same_alex_md', raw: 'Same_Alex_MD', name: 'Alex Same' },
    { stableKey: 'athena:same_alex_do', raw: 'Same_Alex_DO', name: 'Alex Same' },
    { stableKey: 'athena:same_alex_md', raw: 'Same_Alex_MD', name: 'Alex Same' }
  ],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', observedCount: 2, reachedEnd: true, capReached: false, budgetExpired: false, restored: true, boundsStable: true }
});
roster = ctx.window.__mlsProviderRoster.list();
assert.strictEqual(roster.length, 4, 'distinct stable identities must all survive canonical display cleanup');
assert(roster.some(x => x.stableKey === 'athena:same_alex_md' && x.name === 'Alex Same, MD'), 'machine identity credential should survive in the canonical label');
assert(roster.some(x => x.stableKey === 'athena:same_alex_do' && x.name === 'Alex Same, DO'), 'distinct MD/DO variants must not collapse');
assert.strictEqual(roster.filter(x => x.stableKey === 'athena:same_alex_md').length, 1, 'only the identical stable identity is deduped');
assert.strictEqual(ctx.window.__mlsProviderRoster.getReceipt().complete, true);
assert.strictEqual(ctx.window.__mlsProviderRoster.getReceipt().boundsStable, true, 'normalized roster receipt dropped the full-sweep bounds proof');
assert.strictEqual(ctx.window.__mlsProviderRoster.getReceipt().expectedCount, 2, 'complete full sweep did not bind its exact observed provider count');

ingestExact(ctx, { providers: ['Legacy_Doctor_MD'] });
assert.strictEqual(ctx.window.__mlsProviderRoster.getReceipt().complete, false, 'legacy provider lists never claim complete coverage');
assert.strictEqual(ctx.window.__mlsProviderRoster.getReceipt().partial, true);

// The shared calendar normalizer must obey the same stable-identity rule.
const labelCtx = browserContext([
  { id: '101', name: 'Alex Same' },
  { id: '202', name: 'Alex Same' },
  { id: '101', name: 'Alex Same' }
]);
vm.runInContext(labelSrc, labelCtx, { filename: 'feat_mls_provider_label.js' });
assert.deepStrictEqual(Array.from(labelCtx.window._calProviders, x => x.stableKey).sort(), ['backend:101', 'backend:202']);

// Assistant selection is stable-reference based and refuses ambiguous/expired
// selections; the base schedule list no longer widens a zero-match provider to All.
assert(assistantSrc.includes('return matches.length === 1 ? matches[0] : null'));
assert(assistantSrc.includes('That provider selection is no longer verifiable'));
assert(assistantSrc.includes('"pv:" + encodeURIComponent(e.stableKey)'));
assert(assistantExactSrc.includes('explicit selection cannot silently become All'));
assert(!assistantExactSrc.includes('if (narrowed.length) pool = narrowed'));

console.log('PASS stable provider roster, completeness receipt, and fail-closed assistant selection');

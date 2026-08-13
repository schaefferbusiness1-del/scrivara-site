'use strict';

/* Production Day/Visit display only. The existing Athena pull, history,
 * importer, calendar, retry, relay, and extension paths are deliberately not
 * exercised or replaced here. This proves that switching the visible provider
 * only filters the already-loaded schedule and that the truthful default keeps
 * the complete returned view. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const start = source.indexOf('  var renderedProviderReceipt =');
const end = source.indexOf('  function providerRosterReceipt() {', start);
assert(start >= 0 && end > start, 'production Day provider render helpers are missing');

const entries = [
  { stableKey: 'athena:101', id: '101', name: 'Jane Smith, MD', aliases: ['Smith_Jane_MD', 'Jane Smith, M.D.'] },
  { stableKey: 'athena:202', id: '202', name: 'Jane Smith, MD', aliases: ['Smith_Jane_Second_MD'] },
  { stableKey: 'athena:303', id: '303', name: 'Anh Do', aliases: ['Do_Anh'] },
  { stableKey: 'athena:404', id: '404', name: 'Sam Pa', aliases: ['Pa_Sam'] },
  { stableKey: 'athena:505', id: '505', name: 'Lee Rn', aliases: ['Rn_Lee'] },
  { stableKey: 'athena:606', id: '606', name: 'Ari Ot', aliases: ['Ot_Ari'] }
];

function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
let listCalls = 0;
const roster = {
  list() { listCalls += 1; return entries.map((entry) => ({ ...entry, equivalentKey: norm(entry.name) })); },
  _equivalentKey(value) { return norm(value); }
};

const state = { providerFilter: null, providerRef: '' };
const sandbox = {
  S: state,
  window: { __mlsProviderRoster: roster },
  safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
  isFn(value) { return typeof value === 'function'; },
  activeProvider() { return state.providerFilter != null ? state.providerFilter : 'Jane Smith, MD'; }
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) + '\nthis.matches = rowMatchesActiveProvider; this.renderProof = providerRenderProof; this.rendered = renderedProvider;', sandbox);

assert.strictEqual(sandbox.rendered(), '',
  'a null internal pull identity was mistaken for an explicit Day provider selection');
assert.strictEqual(sandbox.matches({ provider: '' }), true,
  'the truthful default view must keep an unattributed row from the returned schedule');
assert.strictEqual(sandbox.matches({ athena_provider_id: '202', provider: 'Jane Smith, MD' }), true,
  'the truthful default view must not scope the already-returned schedule');
assert.strictEqual(listCalls, 0,
  'the default view should not even consult the provider roster while rendering returned rows');

state.providerFilter = 'Jane Smith, MD';
state.providerRef = 'athena:101';
const selectedProof = sandbox.renderProof();
assert.strictEqual(listCalls, 1,
  'a selected Day render should freeze exactly one canonical roster snapshot');
assert.strictEqual(sandbox.matches({ athena_provider_id: '101', provider: 'Jane Smith, MD' }, selectedProof), true,
  'the selected exact Athena provider ID was rejected');
assert.strictEqual(sandbox.matches({ provider: { id: '101', name: 'Smith_Jane_MD' } }, selectedProof), true,
  'a structured exact provider identity was rejected');
assert.strictEqual(sandbox.matches({ athena_provider_id: '202', provider: 'Jane Smith, MD' }, selectedProof), false,
  'a same-name clinician with a different ID leaked into the selected view');
assert.strictEqual(sandbox.matches({ athena_provider_id: '101', provider: 'Anh Do' }, selectedProof), false,
  'a contradictory provider name was accepted beside an exact ID');
assert.strictEqual(sandbox.matches({ provider: 'Smith_Jane_MD' }, selectedProof), true,
  'the selected provider\'s unique canonical alias was rejected');
assert.strictEqual(sandbox.matches({ provider: 'Jane Smith, MD' }, selectedProof), false,
  'an ambiguous same-name row without an ID leaked into the selected view');
assert.strictEqual(sandbox.matches({ provider: '' }, selectedProof), false,
  'a provider-blank row leaked into the selected view');
assert.strictEqual(listCalls, 1,
  'appointment-card filtering must reuse the one frozen roster snapshot');

state.providerFilter = 'Retired Clinician, MD';
state.providerRef = 'athena:missing';
const staleProof = sandbox.renderProof();
assert.strictEqual(staleProof.defaultView, true,
  'an unavailable saved provider did not reconcile to the truthful default view');
assert.strictEqual(sandbox.rendered(), '',
  'an unavailable provider name remained visible while default rows were shown');
assert.strictEqual(sandbox.matches({ provider: '' }, staleProof), true,
  'an unavailable provider incorrectly hid rows from the truthful default view');

[
  ['Anh Do', 'athena:303', 'Do_Anh'],
  ['Sam Pa', 'athena:404', 'Pa_Sam'],
  ['Lee Rn', 'athena:505', 'Rn_Lee'],
  ['Ari Ot', 'athena:606', 'Ot_Ari']
].forEach(([name, key, alias]) => {
  state.providerFilter = name;
  state.providerRef = key;
  const proof = sandbox.renderProof();
  assert.strictEqual(sandbox.matches({ provider: alias }, proof), true,
    `legitimate clinician surname was damaged for ${name}`);
});

assert(/DEFAULT_PROVIDER_SCOPE_LABEL\s*=\s*'Your athenaOne view \(default\)'/.test(source),
  'the truthful default provider label is missing');
assert(/<label for="ez3Prov">Show visits for<\/label>/.test(source) &&
  /aria-label="Show visits for provider"/.test(source),
  'the provider selector is not clearly labelled');
assert(/if \(prov && !rowMatchesActiveProvider\(a, providerProof\)\) return false;/.test(source),
  'the active production Day renderer is not using exact provider proof');

const helperSource = source.slice(start, end);
assert(!/fetch\s*\(|postMessage|localStorage|sessionStorage|readSchedule|dayPull|pullMonth|importAppts/.test(helperSource),
  'the render-only helper unexpectedly contains pull, history, import, bridge, or storage work');

console.log('PASS production provider Day render runtime (25 assertions)');

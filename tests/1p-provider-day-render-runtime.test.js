'use strict';

/* 1p twin of tests/production-provider-day-render-runtime.test.js.
 *
 * b1026's pdr-1.0.0 block was never ported to the fork, so /1p's Day view
 * dropped appointment rows that production renders: an OBJECT provider, a
 * rendering_provider_id / renderingProviderId, and a doctor_user_id. Those
 * shapes are asserted here by name so the regression cannot come back.
 *
 * Display only: the pull, history, importer, calendar, retry, relay and
 * extension paths are deliberately not exercised or replaced. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const start = source.indexOf('  var renderedProviderReceipt =');
const end = source.indexOf('  function providerRosterReceipt() {', start);
assert(start >= 0 && end > start, '1p Day provider render helpers (pdr-1.0.0) are missing');

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
vm.runInContext(source.slice(start, end) +
  '\nthis.matches = rowMatchesActiveProvider; this.renderProof = providerRenderProof; this.rendered = renderedProvider;', sandbox);

/* ---- the truthful default view ---------------------------------------- */
assert.strictEqual(sandbox.rendered(), '',
  'a null internal pull identity was mistaken for an explicit Day provider selection');
assert.strictEqual(sandbox.matches({ provider: '' }), true,
  'the truthful default view must keep an unattributed row from the returned schedule');
assert.strictEqual(sandbox.matches({ athena_provider_id: '202', provider: 'Jane Smith, MD' }), true,
  'the truthful default view must not scope the already-returned schedule');
assert.strictEqual(listCalls, 0,
  'the default view should not even consult the provider roster while rendering returned rows');

/* ---- an explicitly selected provider ----------------------------------- */
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

/* ---- the five row shapes the pre-port fork HID (P0 #5) ------------------
 * Measured against the fork's own HEAD predicate before this port: each of
 * these returned false while production returned true. */
[
  ['an object-shaped provider', { provider: { id: '101', name: 'Smith_Jane_MD' } }],
  ['a rendering_provider_id row', { rendering_provider_id: '101' }],
  ['a renderingProviderId row', { renderingProviderId: '101' }],
  ['a doctor_user_id row', { doctor_user_id: '101' }],
  ['a doctor_user_id row with doctor_name', { doctor_user_id: '101', doctor_name: 'Smith_Jane_MD' }]
].forEach(([label, row]) => {
  assert.strictEqual(sandbox.matches(row, selectedProof), true,
    label + ' was hidden from the selected Day view that production renders');
  assert.strictEqual(sandbox.matches(row), true,
    label + ' was hidden when the proof was derived inside the predicate');
});

/* the same alternate spellings must still fail closed for a DIFFERENT clinician */
[
  { rendering_provider_id: '303' },
  { renderingProviderId: '303' },
  { doctor_user_id: '303' },
  { provider: { id: '303', name: 'Do_Anh' } }
].forEach((row) => {
  assert.strictEqual(sandbox.matches(row, selectedProof), false,
    'another clinician leaked into the selected view through an alternate provider spelling');
});

/* ---- a saved provider that no longer exists ---------------------------- */
state.providerFilter = 'Retired Clinician, MD';
state.providerRef = 'athena:missing';
const staleProof = sandbox.renderProof();
assert.strictEqual(staleProof.defaultView, true,
  'an unavailable saved provider did not reconcile to the truthful default view');
assert.strictEqual(sandbox.rendered(), '',
  'an unavailable provider name remained visible while default rows were shown');
assert.strictEqual(sandbox.matches({ provider: '' }, staleProof), true,
  'an unavailable provider incorrectly hid rows from the truthful default view');

/* ---- legitimate credential-shaped surnames ----------------------------- */
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

/* ---- the shipped wiring ------------------------------------------------ */
assert(/DEFAULT_PROVIDER_SCOPE_LABEL\s*=\s*'Your athenaOne view \(default\)'/.test(source),
  'the truthful default provider label is missing');
assert(/<label for="ez3Prov">Show visits for<\/label>/.test(source) &&
  /aria-label="Show visits for provider"/.test(source),
  'the provider selector is not clearly labelled');
assert(/if \(prov && !rowMatchesActiveProvider\(a, providerProof\)\) return false;/.test(source),
  'the active 1p Day renderer is not using exact provider proof');
assert(/var providerProof = providerRenderProof\(\);/.test(source),
  '1p rowsInRange does not freeze one roster snapshot per render');
/* the display surfaces must name the provider the renderer actually used */
assert(/\(renderedProvider\(\) \? '<span class="ez3-badge">/.test(source),
  'the visit badge still advertises the raw pull identity instead of the rendered provider');
assert(/\(renderedProvider\(\) \? ' · scoped to ' \+ esc\(renderedProvider\(\)\)/.test(source),
  'the range subtitle still advertises the raw pull identity instead of the rendered provider');
assert(/var un = visitCountUnscoped\(\), prov = renderedProvider\(\)/.test(source),
  'the empty-day state still names the raw pull identity instead of the rendered provider');
assert(/var scoped = !!renderedProvider\(\);/.test(source),
  'the day-count reconciliation still treats a null pull identity as a scoped view');

const helperSource = source.slice(start, end);
assert(!/fetch\s*\(|postMessage|localStorage|sessionStorage|readSchedule|dayPull|pullMonth|importAppts/.test(helperSource),
  'the render-only helper unexpectedly contains pull, history, import, bridge, or storage work');

console.log('PASS 1p provider Day render runtime (pdr-1.0.0 port, 43 assertions)');

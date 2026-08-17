'use strict';

/* The clinician chosen in the Visit Day selector is both the pull scope and
 * the visible-row scope. A selected view must never mix in an unattributed or
 * different-provider appointment, and the app must never CLAIM a scope it did
 * not actually apply. Calendar persistence remains covered by the canonical
 * schedule importer tests run alongside this focused contract.
 *
 * b1026 pdr-1.0.0 was ported into the fork; this suite pins the honesty
 * invariant (what the renderer filtered by === what the UI names), while
 * tests/1p-provider-day-render-runtime.test.js pins the row-matching
 * behaviour itself. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const start = source.indexOf('  var renderedProviderReceipt =');
const end = source.indexOf('  function providerRosterReceipt() {', start);
assert(start >= 0 && end > start, 'Visit Day provider identity helpers are missing');

const entries = [
  { stableKey: 'provider:smith', id: '101', name: 'Jane Smith, MD', aliases: ['Smith_Jane_MD', 'Jane Smith, M.D.'] },
  { stableKey: 'provider:jones', id: '202', name: 'John Jones, DO', aliases: ['Jones_John_DO'] }
];
function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const state = { providerFilter: '', providerRef: '' };
const roster = {
  list() { return entries.map((entry) => ({ ...entry, equivalentKey: norm(entry.name) })); },
  _equivalentKey(value) { return norm(value); }
};
const sandbox = {
  S: state,
  window: { __mlsProviderRoster: roster },
  safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
  isFn(value) { return typeof value === 'function'; },
  activeProvider() { return state.providerFilter || ''; }
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) +
  '\nthis.matches = rowMatchesActiveProvider; this.renderProof = providerRenderProof; this.rendered = renderedProvider;', sandbox);

assert.strictEqual(sandbox.matches({ provider: '' }), true,
  'the default athenaOne view should continue to show the complete saved day');
assert.strictEqual(sandbox.rendered(), '',
  'the default athenaOne view must not name a provider it did not filter by');

state.providerFilter = 'Jane Smith, MD';
state.providerRef = 'provider:smith';
const proof = sandbox.renderProof();
assert.strictEqual(proof.defaultView, false, 'an explicit selection did not narrow the render');
assert.strictEqual(sandbox.rendered(), 'Jane Smith, MD',
  'the selected clinician was filtered on but not named');
assert.strictEqual(sandbox.matches({ athena_provider_id: '101', provider: 'Smith, Jane MD' }, proof), true,
  'the exact selected Athena provider id was rejected');
assert.strictEqual(sandbox.matches({ athena_provider_id: '202', provider: 'Jane Smith, MD' }, proof), false,
  'a different Athena provider id leaked into the selected clinician view');
assert.strictEqual(sandbox.matches({ provider: 'Jane Smith, M.D.' }, proof), true,
  'the exact normalized selected provider name was rejected');
assert.strictEqual(sandbox.matches({ provider: 'Smith_Jane_MD' }, proof), true,
  'the canonical Athena roster alias was rejected');
assert.strictEqual(sandbox.matches({ provider: 'John Jones, DO' }, proof), false,
  'another provider leaked into the selected clinician view');
assert.strictEqual(sandbox.matches({ provider: '' }, proof), false,
  'an unattributed legacy row leaked into the selected clinician view');

/* THE HONESTY INVARIANT: whenever the render falls back to the complete day,
 * the UI must stop naming a provider — otherwise the doctor reads "scoped to
 * Dr X" over a list that contains everyone. */
sandbox.window.__mlsProviderRoster = { resolve() { return null; } };
const unprovable = sandbox.renderProof();
assert.strictEqual(unprovable.defaultView, true,
  'an unprovable roster must reconcile to the complete default view, not a half-filtered list');
assert.strictEqual(sandbox.rendered(), '',
  'the UI named a provider while the renderer was showing the complete default day');
assert.strictEqual(sandbox.matches({ provider: '' }, unprovable), true,
  'an unprovable roster silently hid rows from the default view');
sandbox.window.__mlsProviderRoster = roster;

assert(/if \(prov && !rowMatchesActiveProvider\(a, providerProof\)\) return false;/.test(source),
  'the Visit Day rows are not using the strict selected-provider predicate');
assert(/<label for="ez3Prov">Show visits for<\/label>/.test(source) &&
  /aria-label="Show visits for provider"/.test(source),
  'the Visit Day provider control is not clearly labelled');
assert(/DEFAULT_PROVIDER_SCOPE_LABEL\s*=\s*'Your athenaOne view \(default\)'/.test(source),
  'the default provider option no longer uses the requested athenaOne wording');
/* the selector files the render receipt on every draw, including the
 * no-providers and unresolvable-ref branches */
const selStart = source.indexOf('  function provSelectHtml() {');
const selEnd = source.indexOf('  function wireProvSelect() {', selStart);
assert(selStart >= 0 && selEnd > selStart, 'the 1p provider selector markup is missing');
const selSource = source.slice(selStart, selEnd);
assert(/if \(!list\.length\) \{ rememberRenderedProvider\(''\); return ''; \}/.test(selSource),
  'the empty-roster branch of the selector leaves a stale render receipt behind');
assert(/else \{ cur = rememberRenderedProvider\(''\); \}/.test(selSource),
  'an unresolvable saved provider ref leaves a stale render receipt behind');
assert(/var opts = '<option value="__all"' \+ \(!cur \? ' selected' : ''\)/.test(selSource),
  'the default option is selected from raw state instead of the render receipt');

console.log('PASS 1p provider Day/Calendar contract (21 assertions)');

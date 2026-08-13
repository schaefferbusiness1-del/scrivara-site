'use strict';

/* The clinician chosen in the Visit Day selector is both the pull scope and
 * the visible-row scope. A selected view must never mix in an unattributed or
 * different-provider appointment. Calendar persistence remains covered by the
 * canonical schedule importer tests run alongside this focused contract. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const start = source.indexOf('  function providerIdentityKey(value) {');
const end = source.indexOf('  function providerRosterReceipt() {', start);
assert(start >= 0 && end > start, 'Visit Day provider identity helpers are missing');

const state = { providerFilter: '', providerRef: '' };
const roster = {
  resolve(ref) {
    if (ref === 'provider:smith' || /smith/i.test(String(ref || ''))) {
      return { id: '101', name: 'Jane Smith, MD', raw: 'Smith_Jane_MD' };
    }
    return null;
  }
};
const sandbox = {
  S: state,
  window: { __mlsProviderRoster: roster },
  safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
  isFn(value) { return typeof value === 'function'; },
  activeProvider() { return state.providerFilter || ''; }
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) + '\nthis.matches = rowMatchesActiveProvider;', sandbox);

assert.strictEqual(sandbox.matches({ provider: '' }), true,
  'the default athenaOne view should continue to show the complete saved day');

state.providerFilter = 'Jane Smith, MD';
state.providerRef = 'provider:smith';
assert.strictEqual(sandbox.matches({ athena_provider_id: '101', provider: 'Smith, Jane MD' }), true,
  'the exact selected Athena provider id was rejected');
assert.strictEqual(sandbox.matches({ athena_provider_id: '202', provider: 'Jane Smith, MD' }), false,
  'a different Athena provider id leaked into the selected clinician view');
assert.strictEqual(sandbox.matches({ provider: 'Jane Smith, M.D.' }), true,
  'the exact normalized selected provider name was rejected');
assert.strictEqual(sandbox.matches({ provider: 'Smith_Jane_MD' }), true,
  'the canonical Athena roster alias was rejected');
assert.strictEqual(sandbox.matches({ provider: 'John Jones, DO' }), false,
  'another provider leaked into the selected clinician view');
assert.strictEqual(sandbox.matches({ provider: '' }), false,
  'an unattributed legacy row leaked into the selected clinician view');

assert(/if \(prov && !rowMatchesActiveProvider\(a\)\) return false;/.test(source),
  'the Visit Day rows are not using the strict selected-provider predicate');
assert(/<label for="ez3Prov">Show visits for<\/label>/.test(source) &&
  /aria-label="Show visits for provider"/.test(source),
  'the Visit Day provider control is not clearly labelled');
assert(/DEFAULT_PROVIDER_SCOPE_LABEL\s*=\s*'Your athenaOne view \(default\)'/.test(source),
  'the default provider option no longer uses the requested athenaOne wording');

console.log('PASS 1p provider Day/Calendar contract (12 assertions)');

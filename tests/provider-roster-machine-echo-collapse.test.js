'use strict';

/* Live 2026-07-16: the persisted roster carried EVERY clinician twice — once
 * keyed from display text ("athena:matthew schaeffer, md") and once from
 * Athena's machine username surface ("athena:schaeffer_matthew_md",
 * surname-first). stringEchoEquivalent compared letters IN ORDER, so the
 * reordered body evaded the echo collapse: calendarSelection() then failed
 * every selected-provider pull "provider-ambiguous" (two entries, same
 * display name), and ingestResp's unique-clinician count contradicted the
 * extension sweep receipt, downgrading it to provider-roster-contaminated →
 * "provider-roster-incomplete" even right after a clean day pull.
 *
 * The fix canonicalizes the KEY BODY itself: an id-less athena:* key whose
 * body canonicalizes to the entry's own clinician identity is a display echo.
 * Opaque supplied keys (athena:alex-1) canonicalize to nothing and stay
 * distinct — fail-closed resolution semantics are unchanged.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const rosterSrc = fs.readFileSync(path.join(root, 'feat_athena_provider_roster.js'), 'utf8');

assert(rosterSrc.includes("var VERSION = '2.3.0'"), 'roster satellite version must be 2.3.0 (prs-1.0.0: the receipt states its scope, and the roster learns from providers observed on already-pulled appointments)');

function browserContext(seedV2) {
  const store = new Map();
  if (seedV2) store.set('acct:mlsProviderRosterV2', JSON.stringify(seedV2));
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
    getElementById: () => null
  };
  const window = {
    _calProviders: [],
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

const completeReceipt = (n) => ({
  complete: true, partial: false, reason: 'complete', observedCount: n,
  reachedEnd: true, capReached: false, budgetExpired: false, restored: true, boundsStable: true
});

// 1. One clinician read from two Athena surfaces in one sweep collapses to ONE
//    entry, the dropped key survives as an alias, and the sweep receipt keeps
//    its completeness because the collapsed unique count matches the sweep.
{
  const ctx = browserContext();
  vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
  ctx.window.__mlsProviderRoster.ingestResp({
    providerRoster: [
      { stableKey: 'athena:matthew schaeffer, md', raw: 'Matthew Schaeffer, MD' },
      { stableKey: 'athena:schaeffer_matthew_md', raw: 'Schaeffer_Matthew_MD' }
    ],
    providerRosterReceipt: completeReceipt(1)
  });
  const roster = ctx.window.__mlsProviderRoster.list();
  const schaeffer = roster.filter(x => /schaeffer/i.test(x.name));
  assert.strictEqual(schaeffer.length, 1, 'machine-username echo must collapse into one clinician entry');
  assert.strictEqual(schaeffer[0].name, 'Matthew Schaeffer, MD');
  const aliasPool = [schaeffer[0].stableKey].concat(schaeffer[0].aliases || []);
  assert(aliasPool.includes('athena:matthew schaeffer, md') && (
    aliasPool.includes('athena:schaeffer_matthew_md') || aliasPool.includes('Schaeffer_Matthew_MD')
  ), 'the dropped echo key must survive as an alias of the survivor');
  const receipt = ctx.window.__mlsProviderRoster.getReceipt();
  assert.strictEqual(receipt.complete, true, 'collapsed unique count must agree with the sweep receipt');
  assert.strictEqual(ctx.window.__mlsProviderRoster.resolve('athena:schaeffer_matthew_md').name, 'Matthew Schaeffer, MD');
  assert.strictEqual(ctx.window.__mlsProviderRoster.resolve('athena:matthew schaeffer, md').name, 'Matthew Schaeffer, MD');
}

// 2. A label-prefixed key body ("doctor: ...") is the same clinician too.
{
  const ctx = browserContext();
  vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
  ctx.window.__mlsProviderRoster.ingestResp({
    providerRoster: [
      { stableKey: 'athena:clare miller, np', raw: 'Clare Miller, NP' },
      { stableKey: 'athena:doctor: clare miller, np', raw: 'Doctor: Clare Miller, NP' }
    ],
    providerRosterReceipt: completeReceipt(1)
  });
  const roster = ctx.window.__mlsProviderRoster.list();
  assert.strictEqual(roster.filter(x => /miller/i.test(x.name)).length, 1, 'label-prefixed echo must collapse');
  assert.strictEqual(ctx.window.__mlsProviderRoster.getReceipt().complete, true);
}

// 3. Fail-closed unchanged: an opaque supplied key is a REAL distinct identity
//    and never folds into a display-text entry by name alone.
{
  const ctx = browserContext();
  vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
  ctx.window.__mlsProviderRoster.ingestResp({
    providerRoster: [
      { stableKey: 'athena:alex-1', name: 'Alex Same, MD' },
      { stableKey: 'athena:alex same, md', raw: 'Alex Same, MD' }
    ],
    providerRosterReceipt: completeReceipt(2)
  });
  const roster = ctx.window.__mlsProviderRoster.list();
  assert.strictEqual(roster.filter(x => /same/i.test(x.name)).length, 2, 'opaque athena key must stay a distinct identity');
  assert.strictEqual(ctx.window.__mlsProviderRoster.getReceipt().complete, true);
}

// 4. Distinct credentials never collapse (MD vs DO with identical human name).
{
  const ctx = browserContext();
  vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
  ctx.window.__mlsProviderRoster.ingestResp({
    providerRoster: [
      { stableKey: 'athena:same_alex_md', raw: 'Same_Alex_MD' },
      { stableKey: 'athena:same_alex_do', raw: 'Same_Alex_DO' }
    ],
    providerRosterReceipt: completeReceipt(2)
  });
  const roster = ctx.window.__mlsProviderRoster.list();
  assert(roster.some(x => x.name === 'Alex Same, MD') && roster.some(x => x.name === 'Alex Same, DO'),
    'MD/DO variants of the same human name must not collapse');
  assert.strictEqual(ctx.window.__mlsProviderRoster.getReceipt().complete, true);
}

// 5. Healing a POLLUTED persisted cache: merging collapses the old dup pair,
//    marks the cache sanitized (receipt honestly degrades), and the NEXT clean
//    exact sweep restores completeness. Mirrors the live repair sequence.
{
  const seed = [
    { stableKey: 'athena:matthew schaeffer, md', raw: 'Matthew Schaeffer, MD', name: 'Matthew Schaeffer, MD', source: 'athena-schedule-header', rosterVerified: true, aliases: [] },
    { stableKey: 'athena:schaeffer_matthew_md', raw: 'Schaeffer_Matthew_MD', name: 'Matthew Schaeffer, MD', source: 'athena-schedule-header', rosterVerified: true, aliases: [] }
  ];
  const ctx = browserContext(seed);
  vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
  ctx.window.__mlsProviderRoster.merge([]);
  const healed = ctx.window.__mlsProviderRoster.list().filter(x => /schaeffer/i.test(x.name));
  assert.strictEqual(healed.length, 1, 'a polluted persisted cache must heal on the first merge');
  const degraded = ctx.window.__mlsProviderRoster.getReceipt();
  assert.notStrictEqual(degraded.complete, true, 'healing must honestly degrade the stale receipt');
  ctx.window.__mlsProviderRoster.ingestResp({
    providerRoster: [{ stableKey: 'athena:matthew schaeffer, md', raw: 'Matthew Schaeffer, MD' }],
    providerRosterReceipt: completeReceipt(1)
  });
  assert.strictEqual(ctx.window.__mlsProviderRoster.getReceipt().complete, true, 'a fresh clean exact sweep must restore completeness');
}

console.log('PASS machine-username/label-prefixed roster echoes collapse; opaque keys and real credential variants stay distinct; polluted caches heal');

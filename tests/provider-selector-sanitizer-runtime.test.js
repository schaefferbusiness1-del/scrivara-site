'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const rosterSrc = fs.readFileSync(path.join(root, 'feat_athena_provider_roster.js'), 'utf8');
const labelSrc = fs.readFileSync(path.join(root, 'feat_mls_provider_label.js'), 'utf8');
const assistantSrc = fs.readFileSync(path.join(root, 'feat_mls_asst_fix.js'), 'utf8');
const connectSrc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function context(providers) {
  const store = new Map();
  const localStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
  const document = {
    readyState: 'complete', addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }
  };
  const window = {
    _calProviders: providers.slice(), uns: key => `acct:${key}`,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    document, localStorage
  };
  window.window = window;
  const ctx = vm.createContext({
    window, document, localStorage, console,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  });
  ctx.__store = store;
  return ctx;
}

const legitimate = [
  { id: 'p1', name: 'Matthew Schaeffer, MD' },
  { id: 'p2', name: 'Robert McCafferty, PA' },
  { stableKey: 'athena:hoynak_jonathon_do', raw: 'Hoynak_Jonathon_DO', rosterVerified: true },
  { stableKey: 'athena:crane_sarah_pa-c', name: 'PHYSICIAN: Sarah Crane Johnson, PA-C - athena:Crane_Sarah_PA-C', rosterVerified: true },
  { stableKey: 'athena:oneil_anne_np-c', name: "Doctor: Anne-Marie O'Neil, NP-C", rosterVerified: true },
  { id: 'p3', name: 'Jane May, MD' }
];
const equivalentEchoes = [
  'Performed by Matthew Schaeffer, M.D.',
  '07/15/2026 - Jonathon Hoynak, D.O.',
  'Matthew Schaeffer, MD - athena:Schaeffer_Matthew_MD'
];
const pollution = [
  '07/15/2026', '6:00 PM', 'Tuesday July 15', 'Appointment Type',
  'L4-5 facet cyst aspiration / injection', 'Follow-up MRI review',
  '123 Main Street, Suite 200', 'Newtown Square, PA',
  'Aetna Medicare PPO', 'UHC - NO AUTH', 'Reason: low back pain',
  'DOB 01/02/1970', 'POSM CL Kennett Square', 'Patient status confirmed',
  'Low Back Pain', 'Lumbar Radiculopathy', 'Blue Cross Blue Shield',
  'Independence Blue Cross', 'West Chester', 'King of Prussia',
  'July Fourteenth', 'Smith July'
];

const ctx = context(legitimate.concat(equivalentEchoes, pollution));
vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
vm.runInContext(labelSrc, ctx, { filename: 'feat_mls_provider_label.js' });
ctx.window.__mlsProviderLabel.normalize();
const roster = Array.from(ctx.window.__mlsProviderRoster.list());
const calendar = Array.from(ctx.window._calProviders);

const rosterNames = roster.map(x => x.name);
const calendarNames = calendar.map(x => x.name);
for (const required of [
  'Matthew Schaeffer, MD', 'Robert McCafferty, PA', 'Jonathon Hoynak, DO',
  'Sarah Crane Johnson, PA-C', "Anne-Marie O'Neil, NP-C", 'Jane May, MD'
]) {
  assert(rosterNames.includes(required), `legitimate provider was lost: ${required}`);
  assert(calendarNames.includes(required), `calendar provider was lost: ${required}`);
}
assert.strictEqual(roster.find(x => x.id === 'p2').stableKey, 'backend:p2', 'current id-backed provider identity must survive cleanup');
assert.strictEqual(rosterNames.filter(x => x === 'Matthew Schaeffer, MD').length, 1, 'equivalent provider echoes were not deduped');
assert.strictEqual(rosterNames.filter(x => x === 'Jonathon Hoynak, DO').length, 1, 'date-prefixed equivalent echo was not deduped');
const oldMatthewRef = 'legacy-name:' + ctx.window.__mlsProviderRoster._equivalentKey('Performed by Matthew Schaeffer, M.D.', true);
const restoredMatthew = ctx.window.__mlsProviderRoster.resolve('pv:' + encodeURIComponent(oldMatthewRef));
assert(restoredMatthew && restoredMatthew.id === 'p1', 'an already-selected equivalent provider value must resolve to its unique strong identity');

const forbidden = /(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\bappointment\b|\breason\b|\binsurance\b|\bmedicare\b|\baetna\b|\bstreet\b|\bsquare\b|\bfollow-?up\b|\bmri\b|\bpatient\s+status\b|\bperformed\s+by\b|\bphysician\s*:|\bdoctor\s*:|\bathena:)/i;

/* Runtime DOM-feed assertion for all five live selectors. The first two read
   canonical roster.list(); the three legacy/base selectors read the normalized
   _calProviders array. No surface may be able to render a rejected label. */
const fakeDom = {
  'select.as-prov[aria-label="Provider"]': { options: rosterNames.slice() },
  '#ez3Prov': { options: rosterNames.slice() },
  '#calProvFilter': { options: calendarNames.slice() },
  '#calAddDoc': { options: calendarNames.slice() },
  '#sbv2Prov': { options: calendarNames.slice() }
};
for (const [selector, node] of Object.entries(fakeDom)) {
  assert(node.options.length >= legitimate.length, `${selector} lost the legitimate roster`);
  assert(!node.options.some(label => forbidden.test(label)), `${selector} can still render polluted provider text`);
}

/* Plain PA is ambiguous with a US state in arbitrary text. It is accepted only
   in a provider-typed/id-backed context, while PA-C and other credentials remain
   unambiguous. */
assert.strictEqual(ctx.window.__mlsProviderRoster._canonicalName('Newtown Square, PA', false), '');
assert.strictEqual(ctx.window.__mlsProviderRoster._canonicalName('Robert McCafferty, PA', false), '');
assert.strictEqual(ctx.window.__mlsProviderRoster._canonicalName('Robert McCafferty, PA', true), 'Robert McCafferty, PA');
assert.strictEqual(ctx.window.__mlsProviderRoster._canonicalName('Performed by Robert McCafferty, PA', false), 'Robert McCafferty, PA');
assert.strictEqual(ctx.window.__mlsProviderRoster._canonicalName('Schaeffer, Matthew MD', true), 'Matthew Schaeffer, MD');
for (const notProvider of [
  'Low Back Pain', 'Lumbar Radiculopathy', 'Blue Cross Blue Shield',
  'Independence Blue Cross', 'West Chester', 'King of Prussia',
  'July Fourteenth', 'Smith July'
]) assert.strictEqual(ctx.window.__mlsProviderRoster._canonicalName(notProvider, true), '', `human-shaped nonprovider passed: ${notProvider}`);
assert.strictEqual(ctx.window.__mlsProviderRoster._canonicalName('John Smith, Jr., MD', true), 'John Smith Jr., MD');
assert.strictEqual(ctx.window.__mlsProviderRoster._canonicalName('Smith, John Jr., MD', true), 'John Smith Jr., MD');

/* A complete provider receipt containing even one rejected/duplicate roster row
   must fail closed instead of blessing the sanitized subset as exact. */
const receiptCtx = context([]);
vm.runInContext(rosterSrc, receiptCtx, { filename: 'feat_athena_provider_roster.js' });
receiptCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [
    { stableKey: 'athena:valid_md', raw: 'Valid_Jordan_MD' },
    { stableKey: 'athena:noise', name: 'Appointment Type' }
  ],
  providerRosterReceipt: {
    complete: true, partial: false, reason: 'complete', expectedCount: 2,
    observedCount: 2, reachedEnd: true, restored: true
  }
});
assert.strictEqual(receiptCtx.window.__mlsProviderRoster.getReceipt().complete, false);
assert.strictEqual(receiptCtx.window.__mlsProviderRoster.getReceipt().reason, 'provider-roster-contaminated');

const humanPollutionCtx = context([]);
vm.runInContext(rosterSrc, humanPollutionCtx, { filename: 'feat_athena_provider_roster.js' });
humanPollutionCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [
    { stableKey: 'athena:jane', raw: 'Doe_Jane_MD' },
    { stableKey: 'athena:reason', name: 'Low Back Pain' },
    { stableKey: 'athena:insurance', name: 'Blue Cross Blue Shield' },
    { stableKey: 'athena:location', name: 'West Chester' }
  ],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', expectedCount: 4, observedCount: 4, reachedEnd: true, restored: true }
});
assert.deepStrictEqual(Array.from(humanPollutionCtx.window.__mlsProviderRoster.list(), x => x.name), ['Jane Doe, MD']);
assert.strictEqual(humanPollutionCtx.window.__mlsProviderRoster.getReceipt().complete, false, 'stableKey-shaped semantic pollution retained a complete receipt');
assert.strictEqual(humanPollutionCtx.window.__mlsProviderRoster.getReceipt().reason, 'provider-roster-contaminated');

/* A repeated strong stable identity must never merge two clinicians or retain
   a complete receipt. The whole identity is quarantined until a clean retry. */
const identityConflictCtx = context([]);
vm.runInContext(rosterSrc, identityConflictCtx, { filename: 'feat_athena_provider_roster.js' });
identityConflictCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [
    { stableKey: 'athena:dup', raw: 'Doe_Jane_MD' },
    { stableKey: 'athena:dup', raw: 'Smith_John_DO' }
  ],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', expectedCount: 1, observedCount: 1, reachedEnd: true, restored: true }
});
assert.strictEqual(identityConflictCtx.window.__mlsProviderRoster.getReceipt().complete, false, 'conflicting strong stable key retained complete receipt');
assert.strictEqual(identityConflictCtx.window.__mlsProviderRoster.getReceipt().reason, 'provider-roster-contaminated');
assert.strictEqual(identityConflictCtx.window.__mlsProviderRoster.list().some(x => x.stableKey === 'athena:dup'), false, 'conflicted stable key was not quarantined');
identityConflictCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [{ stableKey: 'athena:dup', raw: 'Doe_Jane_MD' }],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', expectedCount: 1, observedCount: 1, reachedEnd: true, restored: true }
});
assert.strictEqual(identityConflictCtx.window.__mlsProviderRoster.getReceipt().complete, true, 'clean retry did not recover a quarantined identity');
assert.deepStrictEqual(Array.from(identityConflictCtx.window.__mlsProviderRoster.list(), x => [x.name, x.raw]), [['Jane Doe, MD', 'Jane Doe, MD']], 'clean recovery synthesized a hybrid clinician');

const singleHybridCtx = context([]);
vm.runInContext(rosterSrc, singleHybridCtx, { filename: 'feat_athena_provider_roster.js' });
singleHybridCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [{ stableKey: 'athena:hybrid', name: 'John Smith, DO', raw: 'Doe_Jane_MD' }],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', expectedCount: 1, observedCount: 1, reachedEnd: true, restored: true }
});
assert.strictEqual(singleHybridCtx.window.__mlsProviderRoster.list().length, 0, 'one-row name/raw conflict produced a hybrid provider');
assert.strictEqual(singleHybridCtx.window.__mlsProviderRoster.getReceipt().complete, false);

/* Old uncredentialed selections are retained only as non-rendering migration
   aliases, then promoted to one uniquely matching strong identity. */
const weakPromotionCtx = context(['Matthew Schaeffer']);
vm.runInContext(rosterSrc, weakPromotionCtx, { filename: 'feat_athena_provider_roster.js' });
const oldWeakRef = 'legacy-name:matthewschaeffer|';
assert.strictEqual(weakPromotionCtx.window.__mlsProviderRoster.list().length, 0, 'weak uncredentialed value rendered before positive provider proof');
weakPromotionCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [{ stableKey: 'athena:ms', raw: 'Schaeffer_Matthew_MD' }],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', expectedCount: 1, observedCount: 1, reachedEnd: true, restored: true }
});
const promotedList = Array.from(weakPromotionCtx.window.__mlsProviderRoster.list());
assert.deepStrictEqual(promotedList.map(x => x.stableKey), ['athena:ms'], 'weak + strong provider remained duplicated');
assert.strictEqual(weakPromotionCtx.window.__mlsProviderRoster.resolve('pv:' + encodeURIComponent(oldWeakRef)).stableKey, 'athena:ms', 'old selected weak ref was not promoted to the unique strong provider');

/* The exact response can beat the first picker/list render on startup. Capture
   the legacy calendar claim during ingest so its selected value still migrates
   without ever appearing as a selectable provider. */
const weakPromotionNoPreListCtx = context(['Matthew Schaeffer']);
vm.runInContext(rosterSrc, weakPromotionNoPreListCtx, { filename: 'feat_athena_provider_roster.js' });
weakPromotionNoPreListCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [{ stableKey: 'athena:ms', raw: 'Schaeffer_Matthew_MD' }],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', expectedCount: 1, observedCount: 1, reachedEnd: true, restored: true }
});
assert.deepStrictEqual(Array.from(weakPromotionNoPreListCtx.window.__mlsProviderRoster.list()).map(x => x.stableKey), ['athena:ms'], 'no-pre-list weak claim remained visible or duplicated');
assert.strictEqual(weakPromotionNoPreListCtx.window.__mlsProviderRoster.resolve('pv:' + encodeURIComponent(oldWeakRef)).stableKey, 'athena:ms', 'no-pre-list weak selected ref was lost before exact ingest');

const weakAmbiguousCtx = context(['Alex Same']);
vm.runInContext(rosterSrc, weakAmbiguousCtx, { filename: 'feat_athena_provider_roster.js' });
weakAmbiguousCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [
    { stableKey: 'athena:alex-md-1', raw: 'Same_Alex_MD' },
    { stableKey: 'athena:alex-md-2', raw: 'Same_Alex_MD' }
  ],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', expectedCount: 2, observedCount: 2, reachedEnd: true, restored: true }
});
assert.strictEqual(weakAmbiguousCtx.window.__mlsProviderRoster.resolve('pv:' + encodeURIComponent('legacy-name:alexsame|')), null, 'ambiguous weak alias widened to one strong provider');

/* Polluted legacy cache rows were previously filtered before the rejection
   count was compared, allowing a stale complete receipt to survive. A dropped
   semantic row must invalidate it, and a later exact clean sweep restores it. */
const legacyCacheCtx = context([]);
legacyCacheCtx.__store.set('acct:mlsSchedProviders', JSON.stringify([
  'Valid_Jordan_MD', 'Appointment Type', 'Aetna Medicare PPO'
]));
legacyCacheCtx.__store.set('acct:mlsProviderRosterReceiptV2', JSON.stringify({
  complete: true, partial: false, reason: 'complete', expectedCount: 1,
  observedCount: 1, reachedEnd: true, restored: true
}));
vm.runInContext(rosterSrc, legacyCacheCtx, { filename: 'feat_athena_provider_roster.js' });
legacyCacheCtx.window.__mlsProviderRoster.list();
assert.strictEqual(legacyCacheCtx.window.__mlsProviderRoster.getReceipt().complete, false, 'polluted legacy cache preserved a complete receipt');
assert.strictEqual(legacyCacheCtx.window.__mlsProviderRoster.getReceipt().reason, 'cached-roster-sanitized');
legacyCacheCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [{ stableKey: 'athena:valid_jordan_md', raw: 'Performed by: Valid Jordan, MD' }],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', expectedCount: 1, observedCount: 1, reachedEnd: true, restored: true }
});
legacyCacheCtx.window.__mlsProviderRoster.list();
assert.strictEqual(legacyCacheCtx.window.__mlsProviderRoster.getReceipt().complete, true, 'later clean exact roster receipt did not restore completeness');

/* The same rule applies to live _calProviders merges. Canonicalizable wrappers
   are retained and do not poison the receipt; only dropped semantic noise does. */
const liveCalendarCtx = context([
  { id: 'provider-1', name: 'Valid Jordan, MD' },
  '07/15/2026', 'Reason: follow-up MRI', 'Newtown Square, PA'
]);
liveCalendarCtx.__store.set('acct:mlsProviderRosterReceiptV2', JSON.stringify({
  complete: true, partial: false, reason: 'complete', expectedCount: 1,
  observedCount: 1, reachedEnd: true, restored: true
}));
vm.runInContext(rosterSrc, liveCalendarCtx, { filename: 'feat_athena_provider_roster.js' });
liveCalendarCtx.window.__mlsProviderRoster.list();
assert.strictEqual(liveCalendarCtx.window.__mlsProviderRoster.getReceipt().complete, false, 'polluted _calProviders merge preserved a complete receipt');
assert.strictEqual(liveCalendarCtx.window.__mlsProviderRoster.getReceipt().reason, 'cached-roster-sanitized');
liveCalendarCtx.window.__mlsProviderRoster.ingestResp({
  providerRoster: [{ stableKey: 'athena:valid_jordan_md', raw: 'PHYSICIAN: Valid Jordan, MD - athena:Valid_Jordan_MD' }],
  providerRosterReceipt: { complete: true, partial: false, reason: 'complete', expectedCount: 1, observedCount: 1, reachedEnd: true, restored: true }
});
liveCalendarCtx.window.__mlsProviderRoster.list();
assert.strictEqual(liveCalendarCtx.window.__mlsProviderRoster.getReceipt().complete, true, 'canonical wrapper should remain exact after a clean receipt');

/* Static feed wiring guards: if a future module bypasses the sanitized sources,
   this focused regression test points to the affected live selector. */
assert(assistantSrc.includes('rp._makeEntry'), 'assistant .as-prov must use canonical roster entry validation');
assert(assistantSrc.includes('var old = resolveProviderValue(cur)'), 'assistant must preserve an already-selected provider through canonical alias resolution');
assert(connectSrc.includes("select id=\"ez3Prov\""), '#ez3Prov surface disappeared');
assert(connectSrc.includes('canonicalSelectedRef'), '#ez3Prov must preserve an already-selected canonical provider');
assert(connectSrc.includes("select id=\"sbv2Prov\""), '#sbv2Prov surface disappeared');
assert(appSrc.includes('id="calProvFilter"') && appSrc.includes('id="calAddDoc"'), 'calendar provider surfaces disappeared');

console.log('PASS provider selector sanitizer: five surfaces clean, real variants retained, receipts fail closed');

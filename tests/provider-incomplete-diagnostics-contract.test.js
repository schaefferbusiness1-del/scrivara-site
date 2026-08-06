'use strict';
/* mdx-1.0.0 — a provider-incomplete refusal must NAME its rows.
 * Field report (Mac, 2026-08-05, build b879, ext 3.0.44): every pull of
 * 2026-08-06 refused with "Some Athena schedule rows did not identify their
 * provider ... retry after the full day grid finishes loading" while the same
 * report's own scheduleReceipt said complete:true 18/18. Two defects, neither
 * of them the gate itself:
 *   1. The advice was wrong every time it was shown - provider-incomplete can
 *      only fire AFTER the schedule read proved complete (an unsettled grid
 *      reports provider-unverified), so "wait for the grid" chased a ghost.
 *   2. The emailed error report carried NO provider receipt, so the failing
 *      rows could not be identified remotely - "which rows, and did they show
 *      the selected name without a structured id?" was unanswerable.
 * The fail-closed behavior itself is intact and re-asserted here: nothing is
 * imported, no matching is widened, no attribution is guessed. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const siSource = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connectSource = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const liveHtml = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const stagingHtml = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const extManifest = JSON.parse(fs.readFileSync(path.join(root, 'extension-version.json'), 'utf8'));

/* ---- boot the importer in the proven minimal context ---------------------- */
const context = {
  console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
  setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
  location: { pathname: '/ScribeFlow-staging.html' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
    getElementById: () => null, addEventListener: () => {},
    body: {}, head: {}, documentElement: {}
  },
  addEventListener: () => {}, removeEventListener: () => {}, postMessage: () => {}
};
context.window = context;
context.__mlsProviderRoster = {
  list: () => [
    { id: 7, stableKey: 'backend:7', rosterVerified: true, name: 'Matthew Schaeffer, MD' },
    { id: 8, stableKey: 'backend:8', rosterVerified: true, name: 'Michael Schaeffer, MD' }
  ],
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: () => null
};
vm.runInNewContext(siSource, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 2000 });
const api = context.__mlsSI;
assert(api && typeof api._scopeProviderRows === 'function', 'importer test API missing');

const fullResponse = {
  receipt: { complete: true, authoritativeEmpty: false },
  providers: ['Matthew Schaeffer, MD', 'Michael Schaeffer, MD'],
  providerDiag: { providerNames: ['Matthew Schaeffer, MD', 'Michael Schaeffer, MD'] }
};

/* ---- 1. a row with NO provider identity is named on the receipt ----------- */
const noIdentity = api._scopeProviderRows(
  [
    { name: 'Patient One', provider: 'Matthew Schaeffer, MD', providerId: '7', time: '8:00 AM' },
    { name: 'Patient Two', provider: '', time: '9:15 AM' }
  ],
  { id: '7', name: 'Matthew Schaeffer, MD', rosterVerified: true },
  fullResponse
);
assert.strictEqual(noIdentity.complete, false, 'mixed grid must stay fail-closed');
assert.strictEqual(noIdentity.reason, 'provider-incomplete');
assert.strictEqual(noIdentity.rows.length, 0, 'a refusal imports nothing');
assert.strictEqual(noIdentity.receipt.unattributedRows, 1);
assert.strictEqual(noIdentity.receipt.nameMatchedIdMissingRows, 0);
assert.strictEqual(noIdentity.receipt.requireStableId, true, 'roster-verified id request must be stamped on the receipt');
assert(Array.isArray(noIdentity.receipt.unattributedDetail), 'receipt must carry per-row detail');
assert.strictEqual(noIdentity.receipt.unattributedDetail.length, 1);
const d0 = noIdentity.receipt.unattributedDetail[0];
assert.deepStrictEqual(Object.keys(d0).sort(), ['hasId', 'hasName', 'nameMatchesSelected', 'shape', 'time'],
  'detail entries carry exactly the PHI-free shape fields');
assert.strictEqual(d0.shape, 'no-provider-identity');
assert.strictEqual(d0.time, '9:15 AM');
assert.strictEqual(d0.hasName, false);
assert.strictEqual(d0.hasId, false);
assert.strictEqual(d0.nameMatchesSelected, false);

/* ---- 2. the duplicate-name id-less row is named AND counted separately ---- */
const duplicateNameProvider = { id: '7', stableKey: 'backend:7', name: 'Alex Morgan, MD', rosterVerified: true };
const dupRefusal = api._scopeProviderRows(
  [
    { name: 'Provider Seven Patient', provider: 'Alex Morgan, MD', providerId: '7', time: '10:00 AM' },
    { name: 'Unproven Patient', provider: 'Alex Morgan, MD', time: '10:30 AM' }
  ],
  duplicateNameProvider,
  { receipt: { complete: true }, providers: ['Alex Morgan, MD'] }
);
assert.strictEqual(dupRefusal.complete, false, 'id-less same-name row must never be guessed into a stable-id pull');
assert.strictEqual(dupRefusal.reason, 'provider-incomplete');
assert.strictEqual(dupRefusal.receipt.nameMatchedIdMissingRows, 1,
  'the name-matched-but-id-missing shape must be counted apart from blank rows');
assert.strictEqual(dupRefusal.receipt.canonicalNameFallback, false,
  'no canonical roster entry for this name means no name fallback');
assert.strictEqual(dupRefusal.receipt.canonicalNameFallbackBasis, 'requested-name-not-listed',
  'mdx-2.0.0: the receipt must name WHY the fallback stayed off');
const d1 = dupRefusal.receipt.unattributedDetail[0];
assert.strictEqual(d1.shape, 'selected-name-no-structured-id');
assert.strictEqual(d1.hasName, true);
assert.strictEqual(d1.nameMatchesSelected, true);
assert.strictEqual(d1.hasId, false);

/* ---- 3. detail is PHI-free and capped ------------------------------------- */
const detailJson = JSON.stringify(noIdentity.receipt.unattributedDetail) + JSON.stringify(dupRefusal.receipt.unattributedDetail);
for (const leaked of ['Patient One', 'Patient Two', 'Unproven Patient', 'Provider Seven Patient']) {
  assert(!detailJson.includes(leaked), 'unattributedDetail leaked a patient field: ' + leaked);
}
const manyBlank = [];
for (let i = 0; i < 40; i++) manyBlank.push({ name: 'P' + i, provider: '', time: i + ':00' });
const capped = api._scopeProviderRows(manyBlank, 'all', { receipt: { complete: true }, providers: [] });
assert.strictEqual(capped.reason, 'provider-incomplete');
assert.strictEqual(capped.receipt.unattributedRows, 40, 'counting is never capped');
assert(capped.receipt.unattributedDetail.length <= 12, 'detail is capped so the report stays mailable');

/* ---- 4. the all-mode receipt still counts exactly as before --------------- */
const allMode = api._scopeProviderRows(
  [
    { name: 'A', provider: 'Matthew Schaeffer, MD' },
    { name: 'B', provider: 'Michael Schaeffer, MD' },
    { name: 'C', provider: 'Matthew Schaeffer, DO' }
  ],
  'all', { receipt: { complete: true }, providers: fullResponse.providers }
);
assert.strictEqual(allMode.complete, true);
assert.strictEqual(allMode.receipt.providerTaggedRows, 3);
assert.strictEqual(allMode.receipt.unattributedRows, 0);

/* ---- 5. the status message tells the truth now ---------------------------- */
const branchIdx = siSource.indexOf('providerReason === "provider-incomplete"');
assert(branchIdx > 0, 'the provider-incomplete branch must remain named');
assert(!siSource.includes('Some Athena schedule rows did not identify their provider. Nothing was imported; retry after the full day grid finishes loading.'),
  '2026-08-05: this advice was wrong every time it was shown - provider-incomplete requires a COMPLETE schedule read, so waiting for the grid cures nothing. (The empty-day CONTRACT branch may keep its own retry advice; a mid-paint disagreement genuinely can settle.)');
const branchRegion = siSource.slice(Math.max(0, branchIdx - 2600), branchIdx + 600);
assert(branchRegion.includes('nameMatchedIdMissingRows'),
  'the provider-incomplete message must be built from the receipt counters, not a blanket sentence');
assert(branchRegion.includes('use the error-report button so the rows are named'),
  'the refusal must route the user to the report that now carries the row detail');

/* ---- 6. the emailed error report now carries the provider receipt --------- */
const pick = connectSource.match(/providerReceipt: dsPick\(res\.providerReceipt, \[([^\]]+)\]\)/);
assert(pick, 'dsDiagReport must include the provider receipt');
for (const field of ['unattributedRows', 'nameMatchedIdMissingRows', 'requireStableId', 'canonicalNameFallback', 'canonicalNameFallbackBasis', 'rosterSameNameCount', 'sameNameConflictKinds', 'unattributedDetail', 'discoveredProviders']) {
  assert(pick[1].includes("'" + field + "'"), 'error report provider receipt must carry ' + field);
}

/* ---- 7. Settings carries the extension download, pinned to the manifest --- */
const version = String(extManifest.version || '').trim();
assert(/^\d/.test(version), 'extension-version.json must name a version');
for (const [label, html] of [['live', liveHtml], ['staging', stagingHtml]]) {
  assert(html.includes('id="extensionDownloadSettings"'), label + ': Settings must carry the extension download section');
  const href = html.match(/id="extDlBtn" href="(MLS_Assist_v[^"]+\.zip)"/);
  assert(href, label + ': the download button must link a versioned zip');
  assert.strictEqual(href[1], 'MLS_Assist_v' + version + '.zip',
    label + ': the baked download link must name the manifest version - bump them together');
  assert(html.includes('<b id="extDlVersion">' + version + '</b>'), label + ': the shown version must match the manifest');
  assert(fs.existsSync(path.join(root, href[1])), label + ': the linked zip must exist in the deployed tree: ' + href[1]);
  /* owner order 2026-08-05 ("with new saying"): the card carries the release
     notes, and the BAKED text must be exactly the manifest's notes so the two
     can never tell different stories about the same version. */
  const notesM = html.match(/id="extDlNotes"[^>]*>([^<]+)<\/p>/);
  assert(notesM, label + ': the card must carry a What\'s-new notes block');
  assert.strictEqual(notesM[1].trim(), String(extManifest.notes || '').trim(),
    label + ': the baked What\'s-new text must equal extension-version.json notes - update them together');
  assert(html.includes('id="extDlVersionNotes">' + version + '<'), label + ': the What\'s-new heading version must match the manifest');
}
assert(connectSource.includes('__mlsExtDlCardWired'), 'the drift refresher must be wired exactly once');
assert(connectSource.includes("fetch('extension-version.json?nc="), 'the refresher must read the manifest, never invent a version');
assert(connectSource.includes("getElementById('extDlNotes')"), 'the refresher must also refresh the What\'s-new text from the manifest');

/* ---- 8. mdx-2.0.0 - the same-clinician roster echo no longer blocks the name
   fallback. Field report #2 (Mac, 2026-08-06, b894, ext 3.0.45): 20/20 rows
   `selected-name-no-structured-id`, requireStableId true, canonicalNameFallback
   false - that athenaOne skin renders names with no structured id anywhere, so
   roster ingest kept a credential-less display echo of the SAME clinician
   beside the real entry and the old `length === 1` demand was unsatisfiable on
   that machine forever. Owner order: "default to just name if it has to but
   make sure everything else still works." The fallback engages only when every
   other same-name entry is provably an echo of the REQUESTED clinician; a
   possible second real clinician still refuses exactly as before. ------------ */
const mattRows = [];
for (let i = 0; i < 20; i++) mattRows.push({ name: 'Mac Patient ' + i, provider: 'Matthew Schaeffer', time: (7 + (i % 10)) + ':' + (i % 2 ? '30' : '00') });
const mattRequest = { id: '12', stableKey: 'backend:12', name: 'Matthew Schaeffer', rosterVerified: true };
const mattResponse = { receipt: { complete: true, authoritativeEmpty: false }, providers: ['Matthew Schaeffer, MD'] };

/* 8a. the b894 replay: real entry + credential-less echo of the same human */
context.__mlsProviderRoster = {
  list: () => [
    { id: '12', stableKey: 'backend:12', name: 'Matthew Schaeffer', equivalentKey: 'matthew schaeffer|' },
    { id: '', stableKey: 'legacy-name:matthew schaeffer|md', name: 'Matthew Schaeffer, MD', equivalentKey: 'matthew schaeffer|md' },
    { id: '8', stableKey: 'backend:8', name: 'Michael Schaeffer, MD', equivalentKey: 'michael schaeffer|md' }
  ],
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: () => null
};
const echoCured = api._scopeProviderRows(mattRows, mattRequest, mattResponse);
assert.strictEqual(echoCured.complete, true,
  'a credential-less display echo of the SAME clinician must not block the name fallback: ' + JSON.stringify(echoCured.receipt));
assert.strictEqual(echoCured.reason, 'provider-complete');
assert.strictEqual(echoCured.rows.length, 20, 'every name-matched row imports once the echo collapses');
assert.strictEqual(echoCured.receipt.canonicalNameFallback, true);
assert.strictEqual(echoCured.receipt.canonicalNameFallbackBasis, 'roster-echo-collapsed');
assert.strictEqual(echoCured.receipt.rosterSameNameCount, 2);
assert.strictEqual(echoCured.receipt.sameNameConflictKinds.length, 0,
  'no conflict kinds for a pure echo (vm-realm arrays: compare by length, never deepStrictEqual)');
assert.strictEqual(echoCured.receipt.unattributedRows, 0);
assert.strictEqual(echoCured.receipt.nameMatchedIdMissingRows, 0, 'attributed rows are not unattributed');
assert(!JSON.stringify(echoCured.receipt).includes('Mac Patient'), 'the provider receipt stays PHI-free');

/* 8b. a second REAL clinician (independent structured id) still refuses */
context.__mlsProviderRoster = {
  list: () => [
    { id: '12', stableKey: 'backend:12', name: 'Matthew Schaeffer, MD', equivalentKey: 'matthew schaeffer|md' },
    { id: '99', stableKey: 'backend:99', name: 'Matthew Schaeffer, MD', equivalentKey: 'matthew schaeffer|md' }
  ],
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: () => null
};
const twoReal = api._scopeProviderRows(mattRows,
  { id: '12', stableKey: 'backend:12', name: 'Matthew Schaeffer, MD', rosterVerified: true }, mattResponse);
assert.strictEqual(twoReal.complete, false, 'two distinct same-name clinicians must refuse exactly as before');
assert.strictEqual(twoReal.reason, 'provider-incomplete');
assert.strictEqual(twoReal.rows.length, 0, 'a refusal imports nothing');
assert.strictEqual(twoReal.receipt.canonicalNameFallback, false);
assert.strictEqual(twoReal.receipt.canonicalNameFallbackBasis, 'same-name-identity-conflict');
assert(twoReal.receipt.sameNameConflictKinds.includes('independent-id'));
assert.strictEqual(twoReal.receipt.nameMatchedIdMissingRows, 20);

/* 8c. credential conflict among id-less echoes (MD vs DO) still refuses */
context.__mlsProviderRoster = {
  list: () => [
    { id: '12', stableKey: 'backend:12', name: 'Matthew Schaeffer', equivalentKey: 'matthew schaeffer|' },
    { id: '', stableKey: 'legacy-name:matthew schaeffer|md', name: 'Matthew Schaeffer, MD', equivalentKey: 'matthew schaeffer|md' },
    { id: '', stableKey: 'legacy-name:matthew schaeffer|do', name: 'Matthew Schaeffer, DO', equivalentKey: 'matthew schaeffer|do' }
  ],
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: () => null
};
const credClash = api._scopeProviderRows(mattRows, mattRequest, mattResponse);
assert.strictEqual(credClash.complete, false, 'MD vs DO under one stripped name is possibly two humans - refuse');
assert.strictEqual(credClash.receipt.canonicalNameFallback, false);
assert.strictEqual(credClash.receipt.canonicalNameFallbackBasis, 'same-name-identity-conflict');
assert(credClash.receipt.sameNameConflictKinds.includes('credential-conflict'));

/* 8d. entries WITHOUT equivalentKey use the trailing-credential name parse */
context.__mlsProviderRoster = {
  list: () => [
    { id: '12', stableKey: 'backend:12', name: 'Matthew Schaeffer' },
    { id: '', stableKey: 'legacy-name:x', name: 'Matthew Schaeffer, DO' },
    { id: '', stableKey: 'legacy-name:y', name: 'Matthew Schaeffer, MD' }
  ],
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: () => null
};
const scanClash = api._scopeProviderRows(mattRows, mattRequest, mattResponse);
assert.strictEqual(scanClash.complete, false, 'the name-parse fallback must also see the MD/DO conflict');
assert(scanClash.receipt.sameNameConflictKinds.includes('credential-conflict'));

/* 8e. the plain unique-name roster keeps working and names its basis */
context.__mlsProviderRoster = {
  list: () => [
    { id: 7, stableKey: 'backend:7', rosterVerified: true, name: 'Matthew Schaeffer, MD' },
    { id: 8, stableKey: 'backend:8', rosterVerified: true, name: 'Michael Schaeffer, MD' }
  ],
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: () => null
};
const unique = api._scopeProviderRows(
  [{ name: 'Solo Patient', provider: 'Matthew Schaeffer, MD', time: '9:00 AM' }],
  { id: '7', stableKey: 'backend:7', name: 'Matthew Schaeffer, MD', rosterVerified: true },
  mattResponse
);
assert.strictEqual(unique.complete, true, 'the pre-existing unique-name fallback is unchanged');
assert.strictEqual(unique.receipt.canonicalNameFallback, true);
assert.strictEqual(unique.receipt.canonicalNameFallbackBasis, 'roster-unique');
assert.strictEqual(unique.receipt.rosterSameNameCount, 1);

console.log('provider-incomplete-diagnostics-contract: PASS');

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
for (const field of ['unattributedRows', 'nameMatchedIdMissingRows', 'requireStableId', 'canonicalNameFallback', 'unattributedDetail', 'discoveredProviders']) {
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
}
assert(connectSource.includes('__mlsExtDlCardWired'), 'the drift refresher must be wired exactly once');
assert(connectSource.includes("fetch('extension-version.json?nc="), 'the refresher must read the manifest, never invent a version');

console.log('provider-incomplete-diagnostics-contract: PASS');

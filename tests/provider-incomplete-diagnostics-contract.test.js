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
/* PIN RE-AIMED 2026-09-01, and NOT weakened - it was measuring the wrong thing.
   The two assertions below used to read a fixed 2600-byte lookback window ending
   at the branch. A byte window pins PROXIMITY, which is a proxy for the property,
   not the property. b1134 (provscope-1.0.1) inserted a 2223-byte MESSAGE-ONLY
   block - the provider-not-on-calendar sentence - between the counter reads and
   the branch, and both pins fell out of the window while the wiring they exist to
   protect was never touched. Measured on the two commits: at 8302ffec^ the window
   carried 'nameMatchedIdMissingRows', at 8302ffec it did not, and
   'pNim = Number(pRec.nameMatchedIdMissingRows' is byte-identical in both.
   Pinned structurally instead, end to end and strictly stronger than the window:
   the message this branch actually EMITS is a named variable; that variable's own
   builder statement interpolates locals; and each of those locals was read from
   the provider RECEIPT's counters. receipt -> local -> emitted message. A blanket
   sentence, a builder that drops any one counter, or advice moved off the emitted
   message all still redden this - and an unrelated insertion nearby no longer
   can. */
function statementFrom(src, start) {
  /* the single statement beginning at `start`, skipping string literals and
     comments so a ';' inside prose is never mistaken for the end */
  var depth = 0, q = null;
  for (var i = start; i < src.length; i++) {
    var c = src[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '*') { var e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
    if (c === '/' && src[i + 1] === '/') { var n = src.indexOf('\n', i); i = n < 0 ? src.length : n; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}
const emitM = siSource.slice(branchIdx, branchIdx + 400).match(/\?\s*([A-Za-z_$][\w$]*)\s*[\s\r\n]*:/);
assert(emitM, 'the provider-incomplete arm must emit a named message variable, not an inline literal');
const msgVar = emitM[1];
const blockIdx = siSource.lastIndexOf('var providerReason =', branchIdx);
assert(blockIdx > 0, 'the refusal block must still name providerReason');
const refusalBlock = siSource.slice(blockIdx, branchIdx);
const asgIdx = refusalBlock.lastIndexOf('var ' + msgVar + ' =');
assert(asgIdx > 0, 'the emitted message ' + msgVar + ' must be BUILT inside the refusal block');
const msgBuilder = statementFrom(refusalBlock, asgIdx);
for (const counter of ['unattributedRows', 'sourceRows', 'nameMatchedIdMissingRows']) {
  const declM = refusalBlock.match(new RegExp(
    '(?:var|let|const|,)\\s*([A-Za-z_$][\\w$]*)\\s*=\\s*Number\\(\\s*[A-Za-z_$][\\w$]*\\.' + counter + '\\b'));
  assert(declM, 'the refusal block must read receipt.' + counter + ' into a local');
  /* the local must reach the message TEXT, not merely the statement: a first
     draft of this pin accepted a bare mention and a mutation that deleted the
     count from every sentence still passed, because the local also names the
     ternary GUARD. Require a concatenation position - `pNim + "` or the
     defaulted `(pUn || "Some") + "` - which a guard can never satisfy. */
  assert(new RegExp('\\b' + declM[1] + '\\b\\s*(?:\\|\\|\\s*"[^"]*"\\s*)?\\)?\\s*\\+').test(msgBuilder),
    'the provider-incomplete message must be built from the receipt counters, not a blanket sentence: ' +
    counter + ' (read into ' + declM[1] + ') never reaches the text of ' + msgVar);
}
assert(msgBuilder.includes('use the error-report button so the rows are named'),
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
  /* 2026-08-06, pin moved deliberately. The button now links the .bin MIRROR
     and renames it on save. Why: a service worker keeps controlling a tab until
     every tab closes and this app's worker declines skipWaiting() on purpose,
     so an already-installed worker retires the CURRENT .zip and answers the
     download with 410 — measured live on b903 and again on b905, and the worker
     did not roll across three production deploys. The .bin extension is passed
     through by every worker generation; the download attribute keeps the saved
     filename a .zip for the doctor. The mirror's bytes are digest-asserted
     equal to the zip in public-publication-boundary. */
  const href = html.match(/id="extDlBtn" href="(MLS_Assist_v[^"]+\.bin)" download="([^"]+)"/);
  assert(href, label + ': the download button must link the versioned .bin mirror with an explicit download filename');
  assert.strictEqual(href[1], 'MLS_Assist_v' + version + '.bin',
    label + ': the baked download link must name the manifest version - bump them together');
  assert.strictEqual(href[2], 'MLS_Assist_v' + version + '.zip',
    label + ': the doctor must still SAVE a .zip - a bare download attribute would save it as .bin');
  assert(fs.existsSync(path.join(root, href[1])), label + ': the linked mirror must exist in the deployed tree: ' + href[1]);
  assert(fs.existsSync(path.join(root, 'MLS_Assist_v' + version + '.zip')),
    label + ': the released .zip must still exist - the mirror supplements it, never replaces it');
  assert(html.includes('<b id="extDlVersion">' + version + '</b>'), label + ': the shown version must match the manifest');
  /* owner order 2026-08-05 ("with new saying"): the card carries the release
     notes, and the BAKED text must be exactly the manifest's notes so the two
     can never tell different stories about the same version. */
  const notesM = html.match(/id="extDlNotes"[^>]*>([^<]+)<\/p>/);
  assert(notesM, label + ': the card must carry a What\'s-new notes block');
  assert.strictEqual(notesM[1].trim(), String(extManifest.notes || '').trim(),
    label + ': the baked What\'s-new text must equal extension-version.json notes - update them together');
  assert(html.includes('id="extDlVersionNotes">' + version + '<'), label + ': the What\'s-new heading version must match the manifest');
}
/* ---- 7b. THE SERVICE WORKER MUST NOT RETIRE THE CURRENT PACKAGE, EVEN WHEN
   THE WORKER IS A RELEASE BEHIND. This is the regression that shipped at every
   single release: sw.js allowlisted ONE hardcoded filename, so the worker
   already installed in a doctor's browser carried the PREVIOUS release's
   literal and answered the new package with 410. Simulated here by running the
   SHIPPED sw.js with its floor patched back one release - if that copy blocks
   today's package, the defect is back. ------------------------------------- */
{
  const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const region = swSource.match(/const RELEASED_PACKAGE_FLOOR[\s\S]*?function isRetiredPath[\s\S]*?\n}/);
  assert(region, 'sw.js must expose the release-floor package rule');
  assert(!/name === 'mls_assist_v[\d.]+\.zip'/.test(swSource),
    'sw.js must not go back to a single hardcoded package filename - that is the per-release 410');

  const build = (src) => new Function('baseName', 'normalizedPath', 'isInternalDirectory',
    'RETIRED_ASSET_PATHS', 'PUBLIC_HTML_PATHS', src + '; return { isRetiredPath };')(
    (p) => { const a = String(p || '').split('/').filter(Boolean); return a.length ? a[a.length - 1] : ''; },
    (u) => String(u).toLowerCase(), () => false, new Set(), new Set());

  const current = build(region[0]);
  const pkg = '/mls_assist_v' + version.toLowerCase() + '.zip';
  assert.strictEqual(current.isRetiredPath(pkg), false, 'the CURRENT released package must never be retired');
  assert.strictEqual(current.isRetiredPath('/mls_assist_v3.0.45.bin'), false, 'the mirror must pass through');
  /* fail-closed, unchanged */
  assert.strictEqual(current.isRetiredPath('/mls_assist_v2.9.41.zip'), true, 'historical archives stay retired');
  assert.strictEqual(current.isRetiredPath('/extension-candidates/mls_assist_v9.9.9.zip'), true,
    'a released-looking name in a subdirectory must never pass on basename alone');
  assert.strictEqual(current.isRetiredPath('/random.zip'), true, 'unrelated zips stay retired');

  /* THE STALE-WORKER SIMULATION, and the negative control in one: a worker one
     release behind must STILL serve today's package. Under the old one-literal
     rule this assertion is impossible to satisfy. */
  const stale = build(region[0].replace('const RELEASED_PACKAGE_FLOOR = [3, 0, 45];', 'const RELEASED_PACKAGE_FLOOR = [3, 0, 44];'));
  assert.strictEqual(stale.isRetiredPath(pkg), false,
    'a worker built one release ago must still serve the CURRENT package - this is the defect that 410d every release');
  assert.strictEqual(stale.isRetiredPath('/mls_assist_v2.9.41.zip'), true,
    'the one-release-behind worker must still fail closed on historical archives');
}

/* ---- 7c. NOTHING MAY REWRITE THE BAKED CARD INTO A CLAIM THAT IS NOT TRUE.
   Measured live on b903/b905: an older module captured this card by TEXT match,
   relabelled the button "Add to Chrome - Chrome Web Store" (a publish that is
   owner-gated and has not happened) over a local file href, REMOVED the
   download attribute and added target="_blank" - turning the click into a
   navigation in a new tab, which is precisely the request the stale worker
   answers with 410. So the doctor met a refusal page in a tab they never asked
   for. The module now stands down wherever the baked card exists. ---------- */
assert(connectSource.includes("if (document.getElementById('extensionDownloadSettings')) return false;"),
  'edsync must stand down when the baked Settings card owns the surface');
for (const [label, html] of [['live', liveHtml], ['staging', stagingHtml]]) {
  const btn = html.match(/<a[^>]*id="extDlBtn"[^>]*>/);
  assert(btn, label + ': the download button must exist');
  assert(/\sdownload="/.test(btn[0]), label + ': the button must keep an explicit download attribute');
  assert(!/\starget=/.test(btn[0]), label + ': the button must not open a new tab - a navigation is what the stale worker 410s');
  assert(!/Chrome Web Store/i.test(btn[0]), label + ': the button must not claim the Chrome Web Store while the publish is owner-gated');
}

/* ---- 7d. THE POINTER MUST SURVIVE A STALE SHELL. --------------------------
   b914 shipped the `.bin` mirror to bypass a service worker that will not roll,
   but `/ScribeFlow.html` is a STATIC_SHELL_PATH, so that same worker keeps
   serving the CACHED shell carrying the old `.zip` href. Measured on the owner's
   browser across two consecutive full reloads of b914: DOM href `…45.zip`, the
   string `.bin` absent from the document entirely, and what the button pointed
   at returned the 75-byte 410 refusal page. The fix could not arrive by the
   mechanism it was designed to bypass.
   mls-connect.js DOES reach him (it loads with `?v=<build>`, an exact-versioned
   asset on a different worker branch), so the href is normalised there. This
   executes the SHIPPED normalisation against a stub anchor carrying the stale
   shell's exact markup. ------------------------------------------------------ */
{
  const block = connectSource.match(/if \(a\) \{\s*var mirror = 'MLS_Assist_v' \+ v \+ '\.bin';[\s\S]*?\n          \}/);
  assert(block, 'the refresher must normalise the anchor to the .bin mirror');
  const normalise = new Function('a', 'v', block[0]);

  const makeAnchor = (attrs) => {
    const store = Object.assign({}, attrs);
    return {
      getAttribute: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setAttribute: (k, val) => { store[k] = String(val); },
      hasAttribute: (k) => Object.prototype.hasOwnProperty.call(store, k),
      removeAttribute: (k) => { delete store[k]; },
      _store: store
    };
  };

  /* the owner's actual stale shell: old .zip href, bare download attribute */
  const stale = makeAnchor({ href: 'MLS_Assist_v' + version + '.zip', download: '' });
  normalise(stale, version);
  assert.strictEqual(stale._store.href, 'MLS_Assist_v' + version + '.bin',
    'a STALE shell must be normalised to the mirror — this is the owner\'s exact machine');
  assert.strictEqual(stale._store.download, 'MLS_Assist_v' + version + '.zip',
    'the doctor must still SAVE a .zip');

  /* the shape the hijacker left behind: Web Store href, target=_blank, no download */
  const hijacked = makeAnchor({ href: 'https://chromewebstore.google.com/x', target: '_blank' });
  normalise(hijacked, version);
  assert.strictEqual(hijacked._store.href, 'MLS_Assist_v' + version + '.bin');
  assert.strictEqual(hijacked._store.target, undefined,
    'target must be stripped — a navigation is exactly what the stale worker answers with 410');

  /* already correct (fresh browser): inert, and MUST NOT be rewritten back to .zip */
  const fresh = makeAnchor({ href: 'MLS_Assist_v' + version + '.bin', download: 'MLS_Assist_v' + version + '.zip' });
  normalise(fresh, version);
  assert.strictEqual(fresh._store.href, 'MLS_Assist_v' + version + '.bin',
    'a correct anchor must survive untouched — the previous refresher wrote .zip unconditionally and re-broke fresh browsers');

  /* NEGATIVE CONTROL: the refresher as it shipped in b914 wrote .zip
     unconditionally. Against the same stale anchor it must FAIL to produce the
     mirror — otherwise this test proves nothing about the fix. */
  const old = new Function('a', 'v', "var want = 'MLS_Assist_v' + v + '.zip'; if (a.getAttribute('href') !== want) a.setAttribute('href', want);");
  const control = makeAnchor({ href: 'MLS_Assist_v' + version + '.zip', download: '' });
  old(control, version);
  assert.notStrictEqual(control._store.href, 'MLS_Assist_v' + version + '.bin',
    'CONTROL FAILED: the b914 refresher already produced the mirror, so this scenario does not reproduce the defect');
  assert(!connectSource.includes("var want = 'MLS_Assist_v' + v + '.zip';"),
    'the unconditional .zip rewrite must be gone — it overwrote the baked .bin on fresh browsers too');
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

/* 8a. THE b894 REPLAY, IN THE SHAPE THE EXTENSION ACTUALLY PRODUCES.
   mdx-2.0.0 shipped as b899 and was a NO-OP for the reporting user because this
   fixture originally used a hand-written `legacy-name:` stableKey. Ext 3.0.45
   stamps every id-less schedule-header provider as `athena:<display text>`
   (extension-candidates/3.0.45/background.js:6790 and :6971), and the roster
   preserves a supplied stableKey verbatim (feat_athena_provider_roster.js:315,
   :340), so the REAL echo is `athena:matthew schaeffer, md` with an empty id.
   Against that shape b899 pushed `independent-structured-key` and refused
   exactly as b894 had. A fixture looser than the real producer cannot tell a
   working fix from a dead one - do not "simplify" this key back. */
context.__mlsProviderRoster = {
  list: () => [
    { id: '12', stableKey: 'backend:12', name: 'Matthew Schaeffer', equivalentKey: 'matthew schaeffer|' },
    { id: '', stableKey: 'athena:matthew schaeffer, md', name: 'Matthew Schaeffer, MD', equivalentKey: 'matthew schaeffer|md' },
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

/* ---- 8f. OPAQUE athena keys are NOT display echoes and must still refuse ----
   The roster module's own rule (stringEchoEquivalent, feat_athena_provider_
   roster.js:394-410): an `athena:*` body that canonicalizes to this clinician's
   identity is display evidence of one person, but an OPAQUE body carries
   information beyond the display string and stays a distinct identity. If this
   ever passes, the fallback has been widened into "any id-less entry", which
   would let a second real clinician through. */
context.__mlsProviderRoster = {
  list: () => [
    { id: '12', stableKey: 'backend:12', name: 'Matthew Schaeffer', equivalentKey: 'matthew schaeffer|' },
    { id: '', stableKey: 'athena:prov-88217', name: 'Matthew Schaeffer, MD', equivalentKey: 'matthew schaeffer|md' }
  ],
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: () => null
};
const opaqueKey = api._scopeProviderRows(mattRows, mattRequest, mattResponse);
assert.strictEqual(opaqueKey.complete, false,
  'an opaque athena stableKey is a distinct identity, not a display echo - it must refuse');
assert.strictEqual(opaqueKey.reason, 'provider-incomplete');
assert.strictEqual(opaqueKey.rows.length, 0, 'a refusal imports nothing');
assert(opaqueKey.receipt.sameNameConflictKinds.includes('independent-structured-key'));

/* ---- 8g. the tightened legacy arm: a `legacy-name:` key whose body belongs to
   a DIFFERENT clinician is not an echo either. mdx-2.0.0 exempted every
   `legacy-name:` key regardless of body; 2.0.1 requires the body to canonicalize
   to the requested clinician's own token set. ------------------------------- */
context.__mlsProviderRoster = {
  list: () => [
    { id: '12', stableKey: 'backend:12', name: 'Matthew Schaeffer', equivalentKey: 'matthew schaeffer|' },
    { id: '', stableKey: 'legacy-name:michael schaeffer|md', name: 'Matthew Schaeffer', equivalentKey: 'matthew schaeffer|' }
  ],
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: () => null
};
const wrongBody = api._scopeProviderRows(mattRows, mattRequest, mattResponse);
assert.strictEqual(wrongBody.complete, false,
  'a legacy-name key naming a DIFFERENT clinician must not be treated as a display echo');
assert(wrongBody.receipt.sameNameConflictKinds.includes('independent-structured-key'));

/* ---- 8h. SURNAME-AS-CREDENTIAL must not manufacture a second clinician -----
   QA lane, 2026-08-06: "Dr. Anh Do" is a real surname. mdx-2.0.0 read a
   credential two ways that both mistook the surname for one (equivalentKey's
   credential segment, and any trailing credential-spelled token), producing
   signatures {"do","md"} across ONE clinician's two roster entries, tripping
   credential-conflict and blocking 100% of her selected-provider imports. */
const doRows = [];
for (let i = 0; i < 8; i++) doRows.push({ name: 'Pain Patient ' + i, provider: 'Anh Thi Do, MD', time: (8 + i) + ':00' });
const doRequest = { id: '31', stableKey: 'backend:31', name: 'Anh Thi Do', rosterVerified: true };
const doResponse = { receipt: { complete: true, authoritativeEmpty: false }, providers: ['Anh Thi Do, MD'] };
for (const [label, roster] of [
  ['with equivalentKey', [
    { id: '31', stableKey: 'backend:31', name: 'Anh Thi Do', equivalentKey: 'anh thi|do' },
    { id: '', stableKey: 'athena:anh thi do, md', name: 'Anh Thi Do, MD', equivalentKey: 'anh thi do|md' }]],
  ['without equivalentKey', [
    { id: '31', stableKey: 'backend:31', name: 'Anh Thi Do' },
    { id: '', stableKey: 'athena:anh thi do, md', name: 'Anh Thi Do, MD' }]]
]) {
  context.__mlsProviderRoster = { list: () => roster, getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }), resolve: () => null };
  const r = api._scopeProviderRows(doRows, doRequest, doResponse);
  assert.strictEqual(r.complete, true,
    `surname-as-credential (${label}) must not manufacture a second clinician: ` + JSON.stringify(r.receipt.sameNameConflictKinds));
  assert.strictEqual(r.rows.length, 8, `${label}: her day must import`);
  assert.strictEqual(r.receipt.sameNameConflictKinds.length, 0, `${label}: no conflict may be claimed`);
}

/* ---- 8i. the conflict that MUST still fire: a delimited MD beside a DO ----- */
for (const [label, nameA, nameB] of [
  ['comma form', 'Matthew Schaeffer, MD', 'Matthew Schaeffer, DO'],
  ['athena machine-username form', 'Schaeffer_Matthew_MD', 'Schaeffer_Matthew_DO']
]) {
  context.__mlsProviderRoster = {
    list: () => [
      { id: '12', stableKey: 'backend:12', name: nameA },
      { id: '', stableKey: 'athena:' + nameB.toLowerCase(), name: nameB }
    ],
    getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }), resolve: () => null
  };
  const clash = api._scopeProviderRows(
    [{ name: 'X', provider: nameA, time: '9:00' }],
    { id: '12', stableKey: 'backend:12', name: nameA, rosterVerified: true },
    { receipt: { complete: true }, providers: [nameA] }
  );
  assert.strictEqual(clash.complete, false,
    `${label}: an explicitly delimited MD beside a DO is possibly two humans and must refuse`);
  assert(clash.receipt.sameNameConflictKinds.includes('credential-conflict'), label + ': must name the credential conflict');
}

console.log('provider-incomplete-diagnostics-contract: PASS');

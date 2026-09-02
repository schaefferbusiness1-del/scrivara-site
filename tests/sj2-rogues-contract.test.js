'use strict';
/* =============================================================================
 * sj2-rogues-contract.test.js  (sj-2.0 phase-2, Commit D step 1, conflict C3)
 * 2026-08-11
 *
 * THE ROGUES CONTRACT - the test the rogues stage described but never wrote
 * (INTEGRATION-ORDER.md conflict C3: "draft it now ... and register it, or
 * record an explicit honest waiver" - drafted, the stronger option). Covers
 * the four direct blob readers/writers outside the managed path:
 *   A1 b121 _restoreSnapshot   (writer -> saveAsync({allowRemovals:true}))
 *   A2 b121 snapshotRotate     (reader -> refuse-and-report in idb mode)
 *   A3 visitfix hydrate fallback (reader -> getRoster() when store live)
 *   A4 legal patients()        (reader -> getRoster().slice() when store live)
 *
 * Registered AT the rogues commit and judged against the SHIPPED bytes:
 * identity proof first (applyToSources in tolerant mode must report all 4
 * edits already-applied - the shipped bytes carry EXACTLY the validated
 * replacements, not a lookalike), then structure pins, then vm behaviour for
 * the extractable reader (legal patients() - the silent-zero class).
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const patcher = require(path.join(__dirname, 'patch-sj2-rogues.js'));

const FILES = ['feat_mls_visitfix.js', 'feat_mls_b121_pack.js', 'legal-chart-fill-ui.js'];
const SRC = {};
for (const f of FILES) SRC[f] = fs.readFileSync(path.join(ROOT, f), 'latin1');

function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

/* ---- 1. identity proof: the shipped bytes ARE the validated edits --------
 *
 * sj-2.1 SUPERSESSION (2026-08-31), recorded here 2026-09-02.
 *
 * This step used to run the 2026-08-11 DRAFT patcher over the shipped bytes and
 * require all four of its edits to report `already-applied`. That is a proof
 * about the PATCHER'S LITERAL SPLICE, not about the property the splice was
 * there to install - and sj-2.1 moved two of the four. The b121 snapshot lane
 * got its OWN IndexedDB home (mlsB121SnapshotsV1): pre-merge snapshots are now
 * MINTED into it by api.mintSnapshot(), and _restoreSnapshot reads them back
 * from it, so the draft's two b121 anchors describe a pre-sj-2.1 shape that no
 * longer exists. The patcher threw before this suite reached a single
 * behavioural assertion:
 *
 *   ANCHOR FAILURE [b121-restore-snapshot-reroute] in feat_mls_b121_pack.js:
 *   expected occurrence==1, found 0
 *
 * That is the A RED SUITE MAY NEVER HAVE RUN shape - nothing below section 1
 * was executing, so the whole rogues contract had been inert since 8/31.
 *
 * The patcher step is RETIRED, not weakened, and the retirement is partitioned
 * by measurement rather than asserted wholesale:
 *   - the TWO edits sj-2.1 never touched (visitfix + legal) keep the identical
 *     byte-identity proof. `applyToSources({tolerateApplied:true})` reporting
 *     already-applied is by definition `occurrences(src, e.replace) === 1`, so
 *     checking the replacement bytes directly IS the same proof, minus a
 *     patcher-wide throw that no longer says anything true;
 *   - the TWO superseded edits must have their PRE-sj-2.0 `find` shape absent
 *     (the rogue is provably gone, not merely un-matchable), and the sj-2.1
 *     property that replaced them is asserted directly in section 1b.
 * The draft patcher itself is left untouched on disk as the historical record;
 * it is not registered in run-all.js and must never be re-applied.
 * ------------------------------------------------------------------------- */
assert.strictEqual(patcher.EDITS.length, 4, 'the rogues patcher carries exactly 4 edits');

const SUPERSEDED_BY_SJ21 = new Set(['b121-restore-snapshot-reroute', 'b121-snapshot-rotate-honest-refusal']);
const VERBATIM = patcher.EDITS.filter(e => !SUPERSEDED_BY_SJ21.has(e.id));
const SUPERSEDED = patcher.EDITS.filter(e => SUPERSEDED_BY_SJ21.has(e.id));
assert.strictEqual(VERBATIM.length, 2, 'exactly two rogues edits still ship as their original bytes');
assert.strictEqual(SUPERSEDED.length, 2, 'exactly two rogues edits were superseded by sj-2.1');
assert.deepStrictEqual(SUPERSEDED.map(e => e.file), ['feat_mls_b121_pack.js', 'feat_mls_b121_pack.js'],
  'only the b121 snapshot lane was re-shaped by sj-2.1 - a superseded edit in another file is a different story and needs reading, not re-labelling');

for (const e of VERBATIM) {
  assert.strictEqual(occurrences(SRC[e.file], e.replace), 1,
    'ROGUE RE-ROUTE NOT SHIPPED [' + e.id + ']: the validated replacement bytes are not present exactly once in ' +
    e.file + ' - the shipped code is not the edit this contract was written against.');
  assert.strictEqual(occurrences(SRC[e.file], e.find), 0,
    '[' + e.id + '] the UNPATCHED rogue shape is still present in ' + e.file + ' alongside the re-route');
}
for (const e of SUPERSEDED) {
  assert.strictEqual(occurrences(SRC[e.file], e.find), 0,
    '[' + e.id + '] the PRE-sj-2.0 rogue shape came back to ' + e.file + '. sj-2.1 replaced this whole region; ' +
    'a direct blob read/write reappearing here is the original defect, not a refactor.');
}

/* ---- 1b. the sj-2.1 property that superseded those two edits ------------- */
{
  const b = SRC['feat_mls_b121_pack.js'];
  /* the snapshot lane has its own IndexedDB home and mints THROUGH it - the
     open question the sj-2.0 rogues NOTES left, now answered. */
  assert.strictEqual(occurrences(b, "var rq = indexedDB.open('mlsB121SnapshotsV1', 1);"), 1,
    'the b121 snapshot lane lost its own IndexedDB database - a multi-MB snapshot is back on the localStorage ceiling sj-2.0 removed');
  for (const needle of ['api.mintSnapshot = function () {', 'function snapDb() {', 'function snapPut(db, k, v) {', 'function snapGet(db, k) {']) {
    assert.strictEqual(occurrences(b, needle), 1, 'sj-2.1 snapshot primitive missing or duplicated: ' + needle);
  }
  /* the rewind is ONE routed implementation shared by both read paths - the
     draft spliced it inline; sj-2.1 named it. */
  assert.strictEqual(occurrences(b, 'api._restoreSnapshotRows = function (bk) {'), 1,
    'the routed rewind is no longer a single named implementation - two copies of a whole-store rewind is how they diverge');
  assert.strictEqual(occurrences(b, 'return api._restoreSnapshotRows(bk);'), 1,
    'the localStorage-snapshot rewind no longer routes through the primitive in sj mode');
  assert.strictEqual(occurrences(b, 'return api._restoreSnapshotRows(got);'), 1,
    'the IndexedDB-snapshot rewind no longer routes through the primitive - a post-migration rewind would find no snapshot at all');
  /* ordering inside _restoreSnapshot: sjMode is decided first, the idb home is
     read when localStorage holds nothing, and the legacy setItem stays LAST as
     the pre-migration path only. */
  const iRestore = b.indexOf('api._restoreSnapshot = function (o) {');
  const iSjMode = b.indexOf("var sjMode = !!(sjStore && typeof sjStore.isReady === 'function' && sjStore.isReady());", iRestore);
  const iIdbRead = b.indexOf('return snapDb().then(function (db) {', iRestore);
  const iRows = b.indexOf('return api._restoreSnapshotRows(bk);', iRestore);
  const iLsSet = b.indexOf('localStorage.setItem(key, bk.raw);', iRestore);
  assert.ok(iRestore >= 0 && iSjMode > iRestore && iIdbRead > iSjMode && iRows > iIdbRead && iLsSet > iRows,
    'the sj-2.1 rewind order broke: sjMode must be decided first, the b121 IndexedDB home read when localStorage ' +
    'holds no snapshot, and the raw localStorage.setItem must stay LAST - reachable only pre-migration');
}

/* ---- 2. structure pins on the shipped bytes ------------------------------ */

/* the legacy branches SURVIVE (pre-migration boots + primitive-less pages;
   also the patient-store-compression-runtime pin: __mlsPtsDecode presence) */
assert.ok(occurrences(SRC['feat_mls_visitfix.js'], '__mlsPtsDecode') >= 1, 'visitfix keeps its legacy decode branch');
assert.ok(occurrences(SRC['legal-chart-fill-ui.js'], '__mlsPtsDecode') >= 1, 'legal keeps its legacy decode branch');
assert.strictEqual(occurrences(SRC['feat_mls_visitfix.js'],
  "var rawLs=(typeof window.uns==='function')?localStorage.getItem(window.uns('patients')):null;"), 1,
  'visitfix legacy raw read survives exactly once (in the else-branch)');
assert.strictEqual(occurrences(SRC['feat_mls_b121_pack.js'], 'localStorage.setItem(key, bk.raw);'), 1,
  'b121 ls-mode restore path survives exactly once (below the idb-mode branch)');

/* b121 restore: routed through saveAsync with allowRemovals, and the idb
   branch REFUSES non-arrays before writing anything */
const b121 = SRC['feat_mls_b121_pack.js'];
assert.ok(b121.indexOf('sjStore.saveAsync(sjRows, { allowRemovals: true })') >= 0,
  'restore routes through saveAsync({allowRemovals:true}) in idb mode');
const iRefuse = b121.indexOf("return 'restore-refused: the snapshot does not decode to a patient array");
const iSaveAsync = b121.indexOf('sjStore.saveAsync(sjRows,');
assert.ok(iRefuse >= 0 && iSaveAsync > iRefuse, 'non-array snapshots are refused BEFORE any write');

/* b121 snapshotRotate: the sj-mode branch sits BEFORE the raw read, is guarded
   on isReady, and mints nothing into localStorage.

   sj-2.1 (2026-08-31) answered the open question this pin was written around.
   The sj-2.0 rogues stage could only REFUSE post-migration ("pre-merge snapshots
   are not minted post-migration"), because there was nowhere honest to put a
   multi-MB snapshot; sj-2.1 gave the lane its own IndexedDB home, so the sj-mode
   branch now ACCEPTS a snapshot that api.mintSnapshot() confirmed moments ago
   and refuses - still loudly, still with the true reason, still fail-closed -
   only when there is no fresh confirmed mint. Pinning the old refusal STRING
   made a strictly better answer look like a regression. Re-aimed at what has to
   stay true either way: the sj branch decides everything before the legacy read,
   both of its exits are honest, and neither of them writes to localStorage. */
const iRotate = b121.indexOf('function snapshotRotate(key) {');
const iSjGuard = b121.indexOf("sjStoreSr && typeof sjStoreSr.isReady === 'function' && sjStoreSr.isReady()", iRotate);
const iIdbAccept = b121.indexOf("return 'idb::' + key + '::b121backup::1';", iRotate);
const iRefusalLog = b121.indexOf('sj-2.1: no fresh IndexedDB pre-merge snapshot', iRotate);
const iRawRead = b121.indexOf('var raw = localStorage.getItem(key);', iRotate);
assert.ok(iRotate >= 0 && iSjGuard > iRotate,
  'snapshotRotate lost its isReady guard - it can no longer tell a migrated store from a pre-migration one');
assert.ok(iIdbAccept > iSjGuard && iRefusalLog > iIdbAccept && iRawRead > iRefusalLog,
  'snapshotRotate must settle the sj-mode case entirely - accept a freshly CONFIRMED IndexedDB mint, else refuse ' +
  'with the true reason (never a "storage quota?" framing) - BEFORE it ever reaches the legacy localStorage read');
assert.ok(b121.indexOf('var mintedAt = Number(api.state.snapshotMintedAt || 0);', iRotate) > iSjGuard &&
  b121.indexOf('(Date.now() - mintedAt) < 60000', iRotate) > iSjGuard,
  'the sj-mode accept no longer requires a RECENT confirmed mint - a merge could proceed behind a stale or ' +
  'never-completed snapshot, which is the fail-closed guarantee this gate exists for');
{
  /* nothing in the sj branch may write the blob: the ONLY localStorage writes
     in snapshotRotate are the two legacy-mode ones, both after the raw read. */
  const rotateBody = b121.slice(iRotate, b121.indexOf('\n  }', iRawRead));
  const writes = rotateBody.match(/localStorage\.setItem\(/g) || [];
  assert.strictEqual(writes.length, 2,
    'the number of localStorage writes in snapshotRotate changed. The sj-mode branch must mint NOTHING into ' +
    'localStorage - re-creating a multi-MB snapshot there is the exact quota ceiling sj-2.0 removed.');
  assert.ok(rotateBody.indexOf('localStorage.setItem(') > (iRawRead - iRotate),
    'a localStorage write moved AHEAD of the legacy raw read - the sj-mode path can now mint into the retired surface');
}

/* every re-route is isReady()-guarded (inert until migration) */
for (const [f, needle] of [
  ['feat_mls_visitfix.js', "vfxSjStore&&typeof vfxSjStore.isReady==='function'&&vfxSjStore.isReady()"],
  ['feat_mls_b121_pack.js', "sjStore && typeof sjStore.isReady === 'function' && sjStore.isReady()"],
  ['feat_mls_b121_pack.js', "sjStoreSr && typeof sjStoreSr.isReady === 'function' && sjStoreSr.isReady()"],
  ['legal-chart-fill-ui.js', "sjStore && typeof sjStore.isReady === 'function' && sjStore.isReady()"]
]) {
  assert.ok(SRC[f].indexOf(needle) >= 0, f + ' re-route is isReady()-guarded: ' + needle.slice(0, 40) + '...');
}

/* forbidden tokens: the qg latch identifier and the retired v1 journal names
   ride in NO satellite */
for (const f of FILES) {
  assert.strictEqual(occurrences(SRC[f], '__mlsPtsEdit' + 'AtRiskUnknown'), 0, f + ' never references the qg latch');
  assert.strictEqual(occurrences(SRC[f], '.pending' + '-v1'), 0, f + ' carries no retired v1 journal name (.pending-v1)');
  assert.strictEqual(occurrences(SRC[f], '.commit' + '-v1'), 0, f + ' carries no retired v1 journal name (.commit-v1)');
}

/* ---- 3. all three shipped files still compile ---------------------------- */
for (const f of FILES) {
  assert.doesNotThrow(() => new vm.Script(SRC[f], { filename: f }), f + ' parses');
}

/* ---- 4. vm behaviour: legal patients() (the silent-zero class) ----------- */
const lg = SRC['legal-chart-fill-ui.js'];
const pStart = lg.indexOf('  function patients() {');
const pEnd = lg.indexOf('\n  function patientById(id) {', pStart);
assert.ok(pStart >= 0 && pEnd > pStart, 'patients() extracted');
const P_FN = lg.slice(pStart, pEnd);

function runPatients(opts) {
  const ctx = {
    window: opts.window || {},
    localStorage: opts.localStorage,
    uns: (s) => 'sf_u::acct@example.test::' + s
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(P_FN + '\nthis.__patients=patients;', ctx, { filename: 'lg-patients-extract.js' });
  return ctx.__patients();
}

/* 4a: live store -> serves the roster, NEVER touches localStorage (getItem
   throws in this harness - not reached), and returns a COPY (slice) */
{
  const roster = [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }];
  const out = runPatients({
    window: { __mlsPtsStore: { isReady: () => true, getRoster: () => roster } },
    localStorage: { getItem: () => { throw new Error('localStorage must not be touched when the store is live'); } }
  });
  assert.strictEqual(out.length, 2, '4a: store roster served');
  assert.notStrictEqual(out, roster, '4a: a COPY is returned (slice), never the live array ref');
  assert.strictEqual(out[0].id, 'r1', '4a: content intact');
}

/* 4b: store present but NOT ready (pre-migration) -> legacy read serves the
   blob exactly as today */
{
  const out = runPatients({
    window: { __mlsPtsStore: { isReady: () => false, getRoster: () => { throw new Error('must not be called'); } } },
    localStorage: { getItem: (k) => (k === 'sf_u::acct@example.test::patients' ? JSON.stringify([{ id: 'l1' }]) : null) }
  });
  assert.strictEqual(out.length, 1, '4b: pre-migration legacy read intact');
  assert.strictEqual(out[0].id, 'l1', '4b: legacy content served');
}

/* 4c: no store at all (primitive-less page) -> legacy read; a null blob
   parses to [] (the enumerated residual, silent-empty on such pages) */
{
  const out = runPatients({ window: {}, localStorage: { getItem: () => null } });
  assert.ok(Array.isArray(out) && out.length === 0, '4c: primitive-less page serves [] from a null blob');
}

/* 4d: a throwing getRoster falls to [] (never a crash on legal pages) */
{
  const out = runPatients({
    window: { __mlsPtsStore: { isReady: () => true, getRoster: () => { throw new Error('account changed'); } } },
    localStorage: { getItem: () => { throw new Error('not reached'); } }
  });
  assert.ok(Array.isArray(out) && out.length === 0, '4d: store refusal serves [] (loud-empty, never a crash)');
}

console.log('sj2-rogues-contract: OK (identity proof: the 2 rogues edits sj-2.1 never touched ship as their exact validated bytes, and the 2 it superseded have no pre-sj-2.0 shape left; sj-2.1 property proved directly - own IndexedDB snapshot home, ONE routed rewind reached from both the localStorage and idb read paths, raw setItem last; legacy branches + compression pins survive; b121 restore routes saveAsync+allowRemovals with non-array refusal before any write; snapshotRotate settles sj mode on a RECENT confirmed mint before the legacy read and writes nothing to localStorage there; all re-routes isReady-guarded; latch + retired names absent; 3 files parse; legal patients(): live-store copy serves roster without touching localStorage, pre-migration legacy intact, primitive-less [] residual, store-refusal contained)');

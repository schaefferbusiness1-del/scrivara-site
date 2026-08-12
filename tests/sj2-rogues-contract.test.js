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

/* ---- 1. identity proof: the shipped bytes ARE the validated edits -------- */
assert.strictEqual(patcher.EDITS.length, 4, 'the rogues patcher carries exactly 4 edits');
const res = patcher.applyToSources(SRC, { tolerateApplied: true });
const applied = res.log.filter(l => l.status === 'already-applied').map(l => l.id);
assert.strictEqual(applied.length, 4,
  'ROGUE RE-ROUTES NOT SHIPPED: expected all 4 rogues edits already applied to the repo bytes, got [' +
  applied.join(', ') + '] - this suite registers WITH the rogues commit (tests/patch-sj2-rogues.js --apply), never before.');
for (const e of patcher.EDITS) {
  assert.strictEqual(occurrences(SRC[e.file], e.replace), 1,
    '[' + e.id + '] replacement bytes present exactly once in shipped ' + e.file);
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

/* b121 snapshotRotate: honest refusal sits BEFORE the raw read, guarded on
   isReady, and mints nothing */
const iRotate = b121.indexOf('function snapshotRotate(key) {');
const iRefusalLog = b121.indexOf('pre-merge snapshots are not minted post-migration', iRotate);
const iRawRead = b121.indexOf('var raw = localStorage.getItem(key);', iRotate);
assert.ok(iRotate >= 0 && iRefusalLog > iRotate && iRawRead > iRefusalLog,
  'snapshotRotate refuses honestly (true reason, not "storage quota?") before the legacy read');

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

console.log('sj2-rogues-contract: OK (identity proof: shipped bytes == the 4 validated edits; legacy branches + compression pins survive; b121 restore routes saveAsync+allowRemovals with non-array refusal before any write; snapshotRotate refuses honestly; all re-routes isReady-guarded; latch + retired names absent; 3 files parse; legal patients(): live-store copy serves roster without touching localStorage, pre-migration legacy intact, primitive-less [] residual, store-refusal contained)');

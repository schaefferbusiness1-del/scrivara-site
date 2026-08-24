'use strict';

/*
 * /cloned LANE CONTRACT — "the clone is /1p wearing production's route"
 * =============================================================================
 * 2026-08-16  /cloned was created as a byte-faithful clone of PRODUCTION, with
 *             features meant to graduate into it one delimited block at a time.
 * 2026-08-17a the owner said "the clone site isn't even a clone of the
 *             commercial site" — six /1p features had been promoted without his
 *             go — and the lane was reset to a pristine production clone.
 * 2026-08-17b the owner's model, stated plainly: /1p is the TESTING GROUND and
 *             /cloned is the RELEASE CANDIDATE. The clone must carry ALL of
 *             /1p's features on production's route identity, be tested live at
 *             mlsscribe.com/cloned/, and then BECOME main.
 *
 * That third step is what this file now proves. Block-by-block promotion cannot
 * express it: /1p differs from production by hundreds of KB of in-place edits,
 * a different bundle and 15 forked feature files, so there is no set of
 * delimited blocks that adds up to /1p. The clone is therefore DERIVED, by
 * scripts/derive-cloned-from-1p.js, and the proof is byte equality with what
 * that script generates.
 *
 * THE CENTRAL ASSERTION. Re-run the derivation in memory and byte-compare all
 * 17 outputs with the files on disk. Because the derivation only ever rewrites
 * lane IDENTITY (marker name, route, asset names, build token) and the seven
 * audited user-facing "1p" labels — every rule is enumerated and justified in
 * that script's header — file equality IS the statement "cloned == 1p modulo
 * lane identity". Anything else that ever reaches a cloned file, from any
 * source, fails here and names the file.
 *
 * WHAT THIS FILE STILL GUARDS INDEPENDENTLY (a derivation cannot vouch for
 * these, because a wrong derivation would generate them wrong too):
 *   - production is untouched: no clone marker, token or loader in
 *     ScribeFlow.html / mls-connect.js, and no cloned-feat_* fork referenced
 *   - the clone registers NO service worker, and says so explicitly
 *   - exactly one bundle loader, and it never enters production's bundle
 *   - the frozen lane marker and its immutable build token
 *   - not one 1p-only string survives anywhere under the clone
 *   - every published fork is actually reachable from the clone's bundle
 *
 * tests/cloned-promotions.json is retained but must stay EMPTY: while the clone
 * is derived there is nothing to promote block-by-block. scripts/promote-1p-
 * block-to-cloned.js still works and is the tool for the day /cloned diverges
 * from /1p on purpose — at which point this contract is what must be reopened.
 *
 * Finally this test PRINTS the cloned-vs-production delta: the manifest of what
 * promoting /cloned to main would actually change.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const derive = require('../scripts/derive-cloned-from-1p.js');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const exists = (name) => fs.existsSync(path.join(root, name));

/* ---------------------------------------------------------------------------
 * 1. The derivation is the definition. Re-run it and byte-compare.
 * ------------------------------------------------------------------------- */
const built = derive.generate();
const CLONED_BUILD = built.token;
assert(/^cloned-\d{8}-r\d+$/.test(CLONED_BUILD), `/cloned build token is malformed: ${CLONED_BUILD}`);

/* 19 = the shell + the bundle + one fork per 1p-feat_*.js. It became 19 when
   the account-scoped AI draft-tuning module was added as an independently
   loaded, lane-derived feature. */
assert.strictEqual(built.files.length, 19,
  `the derivation must produce the shell, the bundle and one fork per 1p-feat_*.js; got ${built.files.length}`);

const drifted = [];
for (const file of built.files) {
  const full = path.join(root, file.name);
  assert(exists(file.name) && fs.statSync(full).isFile(), `/cloned lane file is missing: ${file.name}`);
  assert(fs.statSync(full).size > 5000, `/cloned lane file is unexpectedly empty/truncated: ${file.name}`);
  if (read(file.name) !== file.text) drifted.push(file.name);
}
assert.deepStrictEqual(drifted, [],
  'these /cloned files are not what scripts/derive-cloned-from-1p.js generates from /1p — the clone is no longer "/1p modulo lane identity".\n' +
  '  Re-derive with:  node scripts/derive-cloned-from-1p.js\n' +
  '  NEVER hand-edit a cloned file: the edit would be silently reverted by the next derivation.');

/* Every 1p fork must have produced a clone counterpart, and vice versa — no
   orphan on either side. */
const forkSources = derive.forkSources();
assert.strictEqual(forkSources.length, 17, `expected 17 1p-feat_*.js forks, found ${forkSources.length}`);
const clonedForksOnDisk = fs.readdirSync(root).filter((n) => /^cloned-feat_[A-Za-z0-9_]+\.js$/.test(n)).sort();
assert.deepStrictEqual(clonedForksOnDisk, forkSources.map(derive.forkOutName).sort(),
  'the cloned-feat_*.js files on disk are not exactly the derived names of the 1p-feat_*.js forks');

/* ---------------------------------------------------------------------------
 * 2. Not one 1p-only string survives — checked against DISK, not the generator.
 * ------------------------------------------------------------------------- */
const onDisk = built.files.map((f) => ({ name: f.name, text: read(f.name) }));
const survivors = derive.survivors(onDisk);
assert.deepStrictEqual(survivors.slice(0, 25), [],
  `/cloned still names the 1p lane (${survivors.length} site(s)); the clone is a release candidate, not a preview`);

const clonedShell = read(derive.SHELL_OUT);
const clonedConnect = read(derive.CONNECT_OUT);
const productionShell = read('ScribeFlow.html');
const productionConnect = read('mls-connect.js');

/* ---------------------------------------------------------------------------
 * 3. CSP / route bootstrap
 * ------------------------------------------------------------------------- */
assert(clonedShell.includes("base-uri 'self'"), '/cloned CSP must permit only its same-origin base element');
assert(!clonedShell.includes("base-uri 'none'"), '/cloned CSP still blocks its required base element');

const clonedAuth = clonedShell.indexOf('window.__mlsAuthHandoff = captured;');
const clonedNormalize = clonedShell.indexOf("history.replaceState(null, document.title, '/cloned'");
const clonedBase = clonedShell.indexOf('<base href="/cloned">');
const clonedFirstAsset = clonedShell.indexOf('<script src="public-preview-policy.js?v=b497"></script>');
assert(clonedAuth >= 0 && clonedAuth < clonedNormalize && clonedNormalize < clonedBase && clonedBase < clonedFirstAsset,
  '/cloned must scrub auth first, normalize its URL, install its base, then load the first relative asset');

/* ---------------------------------------------------------------------------
 * 4. Never register or replace the production service worker
 * ------------------------------------------------------------------------- */
assert(!/serviceWorker\.register\s*\(/.test(clonedShell), '/cloned must never register or replace the production service worker');
assert(clonedShell.includes("Promise.reject(new Error('cloned lane: service worker deliberately not registered')).catch(function(){});"),
  '/cloned must explicitly decline service-worker registration, not merely omit it silently');
for (const f of onDisk) {
  assert(!/serviceWorker\.register\s*\(/.test(f.text), `/cloned file registers a service worker: ${f.name}`);
}

/* ---------------------------------------------------------------------------
 * 5. Exactly one loader, and never production's bundle
 * ------------------------------------------------------------------------- */
assert.strictEqual((clonedShell.match(/s\.src='cloned-mls-connect\.js\?v='\+window\.__MLS_AV/g) || []).length, 1,
  '/cloned shell must have exactly one loader for cloned-mls-connect.js');
assert(!clonedShell.includes("s.src='mls-connect.js?v='+window.__MLS_AV"),
  '/cloned shell must never enter the production mls-connect.js bundle');

/* Every published fork must be reachable from the clone: named by the clone's
   bundle, or chained from another fork (nextup rides schedimport). An orphan
   fork is a published file no page can load. */
/* Draft tuning is deliberately assembled on first Settings/generation use so
   it is not misclassified as part of the post-login boot burst. Its runtime
   path is proven in draft-tuning-contract; include that one computed owner in
   this bidirectional publication inventory. */
const computedForks = [];
if (clonedConnect.includes("var A = prefix + 'feat_mls_' + 'draft_tuning.js'") &&
    clonedConnect.includes("var shell = 'ScribeFlow.html'")) {
  computedForks.push('cloned-feat_mls_draft_tuning.js');
}
const reachableFrom = clonedConnect + '\n' + clonedForksOnDisk.map((n) => read(n)).join('\n') +
  '\n' + computedForks.join('\n');
for (const fork of clonedForksOnDisk) {
  assert(reachableFrom.includes(fork), `/cloned publishes an unreachable fork: ${fork} is named by no cloned loader`);
}
/* And the other direction: a fork NAMED by the clone but absent from disk is a
   guaranteed live 404 that no HTML-asset test can see, because these names are
   assembled in JS. Neither direction alone catches a renamed fork. */
const namedForks = new Set(
  (clonedShell + '\n' + reachableFrom).match(/cloned-feat_[A-Za-z0-9_]+\.js/g) || []
);
for (const named of Array.from(namedForks).sort()) {
  assert(exists(named), `/cloned loads a fork that does not exist on disk: ${named} (a live 404)`);
  assert(clonedForksOnDisk.includes(named), `/cloned loads ${named}, which is not one of the derived forks`);
}
assert.strictEqual(namedForks.size, clonedForksOnDisk.length,
  `the clone names ${namedForks.size} forks but publishes ${clonedForksOnDisk.length}`);

/* ---------------------------------------------------------------------------
 * 6. Frozen lane marker / immutable build token
 * ------------------------------------------------------------------------- */
assert(clonedShell.includes(`var CLONED_BUILD='${CLONED_BUILD}';`), '/cloned shell does not declare the expected immutable build token');
assert(clonedShell.includes("window.__MLS_CLONED=Object.freeze({enabled:true,route:'/cloned/',build:CLONED_BUILD});"),
  '/cloned shell must publish the exact, frozen lane marker before loading its bundle');
assert(clonedShell.includes('window.__MLS_AV=CLONED_BUILD;'), '/cloned shell must use its own build as the downstream cache token');
assert(!/window\.__MLS_AV\s*=\s*['"]b\d+['"]/.test(clonedShell), '/cloned shell fell back to a production build token');
assert(!/window\.__MLS_AV\s*=\s*['"]p1-[^'"]*['"]/.test(clonedShell), '/cloned shell fell back to a /1p build token');
assert(clonedConnect.includes(`window.__MLS_AV = window.__MLS_AV || '${CLONED_BUILD}';`),
  '/cloned bundle fallback cache token differs from the shell build token');
assert(clonedConnect.includes(`var MLS_APP_BUILD='${CLONED_BUILD}';`),
  '/cloned bundle diagnostic build differs from the shell build token');
/* Retired tokens from the production-clone era must not linger anywhere. */
for (const retired of ['cloned-20260816-r1', 'cloned-20260817-r2']) {
  if (retired === CLONED_BUILD) continue;
  for (const f of onDisk) {
    assert(!f.text.includes(retired), `/cloned still carries the retired token ${retired} in ${f.name}`);
  }
}

/* ---------------------------------------------------------------------------
 * 7. The lane marker must actually gate the features (a rename that missed a
 *    site would leave dead code that never installs).
 * ------------------------------------------------------------------------- */
const markerHits = onDisk.reduce((n, f) => n + (f.text.split('__MLS_CLONED').length - 1), 0);
assert(markerHits >= 45,
  `/cloned publishes the lane marker but only ${markerHits} references consume it; the /1p lane has 48 — a missed rename leaves features permanently uninstalled`);

/* ---------------------------------------------------------------------------
 * 8. NO STRING THE DOCTOR CAN SEE MAY NAME THE 1p/p1 LANE.
 *
 * The forbidden-substring scan above catches routes, markers and asset names.
 * It does NOT catch prose, and prose is what the doctor reads. Two successive
 * regex sweeps over the sources missed three real user-facing labels — a
 * legalpack toast, a schedule-importer receipt error, and the header row of an
 * EXPORTED study coverage receipt — because two of them put the lane name at
 * the very start of the literal (so a "separator before 1p" pattern cannot
 * match) and the third spells it "P1".
 *
 * So this does not pattern-match prose at all: it extracts EVERY quoted string
 * literal in every cloned file and tests each one. Machine tokens (a literal
 * that is a single [A-Za-z0-9_.-/] run: version strings, storage keys, asset
 * names, selectors) are exempt — those are not read by anyone. Anything left
 * that names the lane as a word is a label that shipped to a doctor.
 * ------------------------------------------------------------------------- */
const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
const NAMES_THE_LANE = /(^|[^A-Za-z0-9_-])(1p|p1)([^A-Za-z0-9_-]|$)/i;
const MACHINE_TOKEN = /^[A-Za-z0-9_.\-/]*$/;

const laneProse = [];
for (const f of onDisk) {
  const lines = f.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let m;
    STRING_LITERAL.lastIndex = 0;
    while ((m = STRING_LITERAL.exec(lines[i]))) {
      const literal = m[1] !== undefined ? m[1] : m[2];
      if (!literal || MACHINE_TOKEN.test(literal) || !NAMES_THE_LANE.test(literal)) continue;
      laneProse.push(`${f.name}:${i + 1}: ${JSON.stringify(literal.slice(0, 120))}`);
    }
  }
}
assert.deepStrictEqual(laneProse, [],
  '/cloned ships user-facing text that names the 1p/p1 lane. The clone is the release candidate real doctors use; ' +
  'lane labels belong in /1p only. Add a neutral replacement to WORDING in scripts/derive-cloned-from-1p.js and re-derive.');

/* ---------------------------------------------------------------------------
 * 9. Promotions manifest: retained, and empty while the clone is derived
 * ------------------------------------------------------------------------- */
const MANIFEST = path.join(root, 'tests', 'cloned-promotions.json');
assert(fs.existsSync(MANIFEST), 'tests/cloned-promotions.json must be retained — it is the record for the day /cloned diverges from /1p on purpose');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
assert(Array.isArray(manifest.promoted), 'tests/cloned-promotions.json must hold {promoted:[...]}');
assert.strictEqual(manifest.promoted.length, 0,
  'tests/cloned-promotions.json lists block promotions, but /cloned is DERIVED from /1p in full — a block promotion would be overwritten by the next derivation. ' +
  'If the clone must diverge from /1p, change the derivation (and this contract) deliberately.');

/* ---------------------------------------------------------------------------
 * 10. Production must stay completely untouched by this lane
 * ------------------------------------------------------------------------- */
assert(!productionShell.includes('__MLS_CLONED') && !productionShell.includes('cloned-mls-connect.js'),
  '/cloned lane marker or loader leaked into the production shell');
assert(!productionShell.includes('cloned-feat_'), '/cloned fork loader leaked into the production shell');
assert(!productionConnect.includes('__MLS_CLONED'), '/cloned lane marker leaked into the production bundle');
assert(!productionConnect.includes('cloned-feat_'), '/cloned fork loader leaked into the production bundle');
assert(!productionConnect.includes(CLONED_BUILD), '/cloned build token leaked into the production bundle');
assert(!productionShell.includes(CLONED_BUILD), '/cloned build token leaked into the production shell');
assert(productionShell.includes("s.src='mls-connect.js?v='+window.__MLS_AV"), 'production shell lost its own bundle loader');
assert(/navigator\.serviceWorker\.register\('sw\.js'\)/.test(productionShell),
  'production shell lost its service-worker registration — the clone lane must never touch it');

/* ---------------------------------------------------------------------------
 * 11. THE PROMOTION-TO-MAIN MANIFEST: cloned vs production, in lines.
 *     This is what "make /cloned the main site" would actually change.
 * ------------------------------------------------------------------------- */
function numstat(a, b) {
  const r = spawnSync('git', ['diff', '--no-index', '--numstat', '--', a, b],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  const line = String(r.stdout || '').trim().split('\n')[0] || '';
  const m = line.match(/^(\d+)\t(\d+)\t/);
  return m ? { added: Number(m[1]), removed: Number(m[2]) } : null;
}
function lineCount(name) {
  return read(name).split('\n').length;
}

const PAIRS = [[derive.SHELL_OUT, 'ScribeFlow.html'], [derive.CONNECT_OUT, 'mls-connect.js']];
for (const fork of clonedForksOnDisk) {
  PAIRS.push([fork, 'feat_' + fork.slice('cloned-feat_'.length)]);
}

const rows = [];
let totalAdded = 0, totalRemoved = 0, newFiles = 0;
for (const [clone, prod] of PAIRS) {
  if (!exists(prod)) {
    const n = lineCount(clone);
    rows.push(`  + ${clone}  NEW FILE (${n} lines; production has no ${prod})`);
    totalAdded += n;
    newFiles++;
    continue;
  }
  const stat = numstat(prod, clone);
  if (!stat) { rows.push(`  ? ${clone}  vs ${prod}: could not measure (git unavailable)`); continue; }
  totalAdded += stat.added;
  totalRemoved += stat.removed;
  rows.push(`  ~ ${clone}  vs ${prod}:  +${stat.added} / -${stat.removed}`);
}

console.log(
  `\n/cloned -> main PROMOTION MANIFEST (what promoting this clone would change in production):\n` +
  rows.join('\n') +
  `\n  TOTAL: ${PAIRS.length} file(s), ${newFiles} new, +${totalAdded} / -${totalRemoved} lines\n`
);

console.log(
  `PASS /cloned lane contract: ${CLONED_BUILD} — cloned/index.html, cloned-mls-connect.js and ${clonedForksOnDisk.length} ` +
  `cloned-feat_*.js are byte-exactly what scripts/derive-cloned-from-1p.js generates from 1pScribeFlow.html, ` +
  `1p-mls-connect.js and the ${forkSources.length} 1p-feat_*.js (/1p build ${built.p1Build}); ${markerHits} lane-marker gates; ` +
  `no 1p-only string, no service worker, production untouched.`
);

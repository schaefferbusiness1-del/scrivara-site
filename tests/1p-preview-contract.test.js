'use strict';

/*
 * 1p PREVIEW ISOLATION CONTRACT (2026-08-12)
 * ===========================================
 * The owner authorized changes only in the exact 1p preview lane. This test
 * pins the preview's own build/cache identity and loaders, while byte-comparing
 * the production app and released extension surfaces with the commit at which
 * this repair began. A fix that leaks into production or the extension is a
 * failure even when the preview itself works.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const EXPECTED_BUILD = 'p1-20260812-r1';
const BASE_COMMIT = '08a7da1c6520fc6c6220664ebf4f05556859ab47';

const P1_FILES = [
  '1pScribeFlow.html',
  '1p/index.html',
  '1p-mls-connect.js',
  '1p-feat_mls_avatar.js',
  '1p-feat_mls_writeflow.js'
];

for (const name of P1_FILES) {
  const file = path.join(root, name);
  assert(fs.existsSync(file) && fs.statSync(file).isFile(), `1p preview file is missing: ${name}`);
  assert(fs.statSync(file).size > 1000, `1p preview file is unexpectedly empty/truncated: ${name}`);
}

const shell = read('1pScribeFlow.html');
const liveShell = read('1p/index.html');
const connect = read('1p-mls-connect.js');

/* One immutable identity must own the shell, bundle, downstream preview
   assets, and diagnostics. Production b-numbers are not valid preview tokens. */
assert(shell.includes(`var P1_BUILD='${EXPECTED_BUILD}';`), '1p shell does not declare the expected immutable preview build');
assert(shell.includes("window.__MLS_P1_PREVIEW=Object.freeze({enabled:true,route:'/1pScribeFlow.html',build:P1_BUILD});"),
  '1p shell must publish the exact, frozen preview marker before loading its bundle');
assert(liveShell.includes("window.__MLS_P1_PREVIEW=Object.freeze({enabled:true,route:'/1p/',build:P1_BUILD});"),
  'live /1p/ shell must publish its exact, frozen route marker before loading its bundle');
assert(shell.includes('window.__MLS_AV=P1_BUILD;'), '1p shell must use its preview build as the downstream cache token');
assert(!/window\.__MLS_AV\s*=\s*['"]b\d+['"]/.test(shell), '1p shell fell back to a production build token');
assert(connect.includes(`window.__MLS_AV = window.__MLS_AV || '${EXPECTED_BUILD}';`),
  '1p bundle fallback cache token differs from the shell preview build');
assert(connect.includes(`var MLS_APP_BUILD='${EXPECTED_BUILD}';`),
  '1p bundle diagnostic build differs from the shell preview build');

/* /1p/ must be a normal live route even in a browser already controlled by
   the unchanged production service worker. Its file-like base makes root
   assets resolve correctly without breaking same-document SVG fragments. */
assert(liveShell.includes("base-uri 'self'"), 'live /1p/ CSP must permit only its same-origin base element');
assert(!liveShell.includes("base-uri 'none'"), 'live /1p/ CSP still blocks its required base element');
const liveAuth = liveShell.indexOf('window.__mlsAuthHandoff = captured;');
const liveNormalize = liveShell.indexOf("history.replaceState(null, document.title, '/1p'");
const liveBase = liveShell.indexOf('<base href="/1p">');
const liveFirstAsset = liveShell.indexOf('<script src="public-preview-policy.js?v=b497"></script>');
assert(liveAuth >= 0 && liveAuth < liveNormalize && liveNormalize < liveBase && liveBase < liveFirstAsset,
  'live /1p/ must scrub auth first, normalize its URL, install its base, then load the first relative asset');
assert(!/serviceWorker\.register\s*\(/.test(liveShell), 'live /1p/ must never register or replace the production service worker');

const canonicalizeLive = (value) => String(value)
  .replace("base-uri 'self'", "base-uri 'none'")
  .replace(/<!-- p1-live-1\.0\.0:[\s\S]*?<base href="\/1p">\r?\n/, '')
  .replace("route:'/1p/'", "route:'/1pScribeFlow.html'");
assert.strictEqual(canonicalizeLive(liveShell), shell,
  'the live /1p/ shell drifted beyond its route/CSP bootstrap from the reviewed 1p source shell');

/* The shell must enter only the 1p bundle. The bundle keeps canonical
   data-mls-asset identities for dedupe/adoption, while both the deferred and
   eager paths fetch the preview implementations. */
assert.strictEqual((shell.match(/s\.src='1p-mls-connect\.js\?v='\+window\.__MLS_AV/g) || []).length, 1,
  '1p shell must have exactly one loader for 1p-mls-connect.js');
assert.strictEqual((liveShell.match(/s\.src='1p-mls-connect\.js\?v='\+window\.__MLS_AV/g) || []).length, 1,
  'live /1p/ shell must have exactly one loader for 1p-mls-connect.js');
assert(!shell.includes("s.src='mls-connect.js?v='+window.__MLS_AV"),
  '1p shell must never enter the production mls-connect.js bundle');

assert.strictEqual((connect.match(/s\.src='1p-feat_mls_writeflow\.js\?v='/g) || []).length, 1,
  '1p bundle must load the preview write-flow implementation exactly once');
assert(connect.includes("s.setAttribute('data-mls-asset','feat_mls_writeflow.js')"),
  '1p write-flow loader must retain the canonical dedupe identity');
assert(!connect.includes("s.src='feat_mls_writeflow.js?v='"),
  '1p bundle still loads the production write-flow implementation');

assert.strictEqual((connect.match(/s\.src='1p-feat_mls_avatar\.js\?v='/g) || []).length, 1,
  '1p deferred avatar loader must fetch the preview implementation exactly once');
assert(connect.includes("var ASSET='feat_mls_avatar.js', SRC='1p-feat_mls_avatar.js', ID='mlsAvVisitCard';"),
  '1p eager avatar loader must separate its canonical identity from its preview source');
assert(connect.includes("s.src=SRC+'?v='+(window.__MLS_AV||Date.now())"),
  '1p eager avatar loader must fetch the preview source');
assert(!connect.includes("s.src='feat_mls_avatar.js?v='"),
  '1p bundle still has a direct production avatar fetch');

/* app-version.json describes production. It may remain the endpoint used by
   the shared code, but its refresh banner is disabled only when the explicit
   frozen 1p marker is present. Exercise the real one-line predicate rather
   than accepting a comment or a dead marker. */
const versionStart = connect.indexOf('if(window.__mlsVersionCheck) return;');
const versionEnd = connect.indexOf('\n(function(){', versionStart + 1);
assert(versionStart >= 0 && versionEnd > versionStart, '1p production-version-check block could not be isolated');
const versionBlock = connect.slice(versionStart, versionEnd);
assert(versionBlock.includes("var URL='app-version.json';"), 'version check no longer identifies the production manifest it must avoid comparing to 1p');
const canCheckLine = versionBlock.split(/\r?\n/).find((line) => line.includes('function canCheck()'));
assert(canCheckLine, '1p version-check predicate is missing');
const makeCanCheck = new Function('window', `${canCheckLine}\nreturn canCheck;`);
assert.strictEqual(makeCanCheck({ __MLS_P1_PREVIEW: { enabled: true }, backendMode: () => true })(), false,
  'production update banner remains enabled inside the 1p preview');
assert.strictEqual(makeCanCheck({ __MLS_P1_PREVIEW: { enabled: false }, backendMode: () => true })(), true,
  'a non-enabled preview marker must not disable production version checks');
assert.strictEqual(makeCanCheck({ backendMode: () => true })(), true,
  'ordinary production-capable callers must retain version checks');
assert.strictEqual(makeCanCheck({ backendMode: () => false })(), false,
  'the pre-existing backend availability gate must remain intact');
assert(versionBlock.includes('if(canCheck()){') && versionBlock.includes('setTimeout(check, 8000);'),
  '1p version-check scheduling must stay behind the preview-aware predicate');

/* This train's hard boundary: none of the production app loaders, shared
   importer/service worker, or audited 3.0.61 extension release bytes may move.
   Compare through Git so text filters do not make Windows line endings look
   like a mutation. A future authorized production/extension train must choose
   and document a new baseline instead of weakening this check. */
const PROTECTED_PRODUCTION = [
  'ScribeFlow.html',
  'mls-connect.js',
  'feat_mls_avatar.js',
  'feat_mls_writeflow.js',
  'feat_mls_schedimport_exact.js',
  'app-version.json',
  'sw.js',
  '_config.yml'
];
const PROTECTED_EXTENSION = [
  'manifest.json',
  'background.js',
  'destination_teach_navigation_guard.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.js',
  'mls-popup.js',
  'mls-popup.css',
  'offscreen.html',
  'offscreen.js',
  'feat_codes_driver.js',
  'ext_reviews_reader.js',
  'write_safety_guard.js',
  'review_screen.js',
  'teach_destination_memory.js',
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-128.png',
  'extension-version.json',
  'MLS_Assist_v3.0.61.zip',
  'MLS_Assist_v3.0.61.bin'
];
const protectedFiles = [...PROTECTED_PRODUCTION, ...PROTECTED_EXTENSION];
const unchanged = spawnSync('git', ['diff', '--quiet', BASE_COMMIT, '--', ...protectedFiles],
  { cwd: root, encoding: 'utf8', windowsHide: true });
if (unchanged.status !== 0) {
  const names = spawnSync('git', ['diff', '--name-only', BASE_COMMIT, '--', ...protectedFiles],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.fail(`1p-only repair changed protected production/extension bytes (git status ${unchanged.status}): ${String(names.stdout || unchanged.stderr || '').trim()}`);
}

const productionShell = read('ScribeFlow.html');
const productionConnect = read('mls-connect.js');
assert(productionShell.includes("s.src='mls-connect.js?v='+window.__MLS_AV"), 'production shell lost its production bundle loader');
assert(!productionShell.includes('__MLS_P1_PREVIEW') && !productionShell.includes('1p-mls-connect.js'),
  '1p preview marker/loader leaked into the production shell');
assert(!productionConnect.includes('1p-feat_mls_avatar.js') && !productionConnect.includes('1p-feat_mls_writeflow.js'),
  '1p preview feature loaders leaked into the production bundle');

console.log(`PASS 1p preview contract: ${EXPECTED_BUILD}, live /1p/ route, exact preview loaders, production version banner suppressed only by the 1p marker, protected production/extension bytes unchanged from ${BASE_COMMIT.slice(0, 8)}`);

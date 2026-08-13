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
const EXPECTED_BUILD = 'p1-20260813-r1';
const BASE_COMMIT = '08a7da1c6520fc6c6220664ebf4f05556859ab47';

const P1_FILES = [
  '1pScribeFlow.html',
  '1p/index.html',
  '1p/legal/index.html',
  '1p-mls-connect.js',
  '1p-feat_mls_athena_occurrence.js',
  '1p-feat_mls_avatar.js',
  '1p-feat_mls_avatar_face.js',
  '1p-feat_fullhistory_pdf.js',
  '1p-feat_mls_legalpack.js',
  '1p-feat_nextup_connect.js',
  '1p-feat_mls_schedimport_exact.js',
  '1p-feat_mls_writeflow.js',
  '1p-feat_task3_frontsync.js'
];

for (const name of P1_FILES) {
  const file = path.join(root, name);
  assert(fs.existsSync(file) && fs.statSync(file).isFile(), `1p preview file is missing: ${name}`);
  assert(fs.statSync(file).size > 1000, `1p preview file is unexpectedly empty/truncated: ${name}`);
}

const shell = read('1pScribeFlow.html');
const liveShell = read('1p/index.html');
const connect = read('1p-mls-connect.js');
const occurrence = read('1p-feat_mls_athena_occurrence.js');

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

const faceLoaderStart = connect.indexOf("A='feat_mls_avatar_face.js',SRC='1p-feat_mls_avatar_face.js',V='p1-face-studio-1.0.1',KEY='__mlsP1AvatarFaceLoader'");
const faceLoaderEnd = connect.indexOf('/* 1p Avatar face studio:', faceLoaderStart);
const faceLoader = faceLoaderStart >= 0 && faceLoaderEnd > faceLoaderStart ? connect.slice(faceLoaderStart, faceLoaderEnd) : '';
assert.strictEqual((faceLoader.match(/node\.src=SRC\+'\?v='/g) || []).length, 1,
  '1p bundle must have exactly one canonical Avatar face-studio source assignment');
assert(faceLoader.includes("node.setAttribute('data-mls-asset',A)") &&
  faceLoader.includes("node.setAttribute('data-mls-version',V)") &&
  faceLoader.includes("node.setAttribute('data-mls-install-token',ctl.installToken)"),
  '1p Avatar face loader lost canonical identity, exact version, or install token');
assert(faceLoader.includes('maxAttempts:2') && faceLoader.includes("fail(node,'network-error')") &&
  faceLoader.includes("fail(node,'owner-missing')") && faceLoader.includes("ctl.state='failed-bounded'"),
  '1p Avatar face loader lacks bounded network/owner recovery');
assert(faceLoader.includes('function validController(controller)') && faceLoader.includes('ensured=prior.ensure()===true') &&
  faceLoader.includes('if(ensured&&window[KEY]===prior&&validController(prior))return;') &&
  faceLoader.includes('if(window[KEY]!==prior)return;') && faceLoader.includes('var replacement=window[KEY];'),
  '1p Avatar face loader does not validate or fence a same-version/reentrant controller takeover');
assert(!/\.src=['"]feat_mls_avatar_face\.js/.test(faceLoader),
  '1p bundle directly fetches a shared/production Avatar face implementation');
const p1Face = read('1p-feat_mls_avatar_face.js');
assert(p1Face.includes("var LOADER_KEY = '__mlsP1AvatarFaceLoader';") &&
  p1Face.includes('loader.installToken === installToken') && p1Face.includes('window.__MLS_P1_PREVIEW.enabled === true'),
  '1p Avatar face API is not bound to its exact preview controller/token');

assert.strictEqual((connect.match(/SRC='1p-feat_mls_athena_occurrence\.js'/g) || []).length, 1,
  '1p bundle must load the exact Athena occurrence search exactly once');
assert(connect.includes("A='feat_mls_athena_occurrence.js',SRC='1p-feat_mls_athena_occurrence.js',V='p1-athena-occurrence-1.0.0',KEY='__mlsP1AthenaOccurrenceLoader'") &&
  connect.includes("node.setAttribute('data-mls-install-token',ctl.installToken)"),
  '1p occurrence loader is missing its immutable preview owner version');
assert(occurrence.includes("type: 'mlsAppSearchProcedure'") && occurrence.includes('window.__mlsVerifiedCandidateImport'),
  '1p occurrence search must use the read-only report bridge and delegate selected chart pulls to the canonical importer');
assert(connect.includes('window._assistReadChart(target') && connect.includes('window.__mlsVerifiedCandidateImport=verifiedCandidateImport'),
  '1p canonical candidate importer must own the exact chart-read helper');

assert.strictEqual((connect.match(/s\.src='1p-feat_mls_schedimport_exact\.js\?v='/g) || []).length, 1,
  '1p bundle must load the isolated preview importer exactly once');
assert(connect.includes("s.setAttribute('data-mls-asset','feat_mls_schedimport_exact.js')"),
  '1p importer loader must retain the canonical dedupe identity');
assert(!connect.includes("s.src='feat_mls_schedimport_exact.js?v='"),
  '1p bundle still loads the shared production importer');

assert(connect.includes('1p-feat_task3_frontsync.js'),
  '1p bundle must load the isolated Task3 calendar consumer');
assert(!connect.includes('s.src=A+"?v=20260808t3113perf2"'),
  '1p bundle still fetches the shared Task3 consumer');
const p1Importer = read('1p-feat_mls_schedimport_exact.js');
assert(p1Importer.includes('1p-feat_nextup_connect.js'),
  '1p importer must load the isolated Next Up census consumer');
assert(!p1Importer.includes('s.src = "feat_nextup_connect.js?v=20260808auth3perf1"'),
  '1p importer still fetches the shared Next Up consumer');

assert.strictEqual((connect.match(/s\.src='1p-feat_fullhistory_pdf\.js\?v='/g) || []).length, 1,
  '1p bundle must load the isolated full-history PDF implementation exactly once');
assert(connect.includes("s.setAttribute('data-mls-asset','feat_fullhistory_pdf.js')"),
  '1p full-history PDF loader must retain the canonical dedupe identity');
assert(!connect.includes("s.src='feat_fullhistory_pdf.js?v='"),
  '1p bundle still loads the shared full-history PDF implementation');

const legalLoaderStart = connect.indexOf("A='feat_mls_legalpack.js',SRC='1p-feat_mls_legalpack.js',V='p1-legal-1.0.0'");
const legalLoaderEnd = connect.indexOf('/* av-6.0.8:', legalLoaderStart);
const legalLoader = legalLoaderStart >= 0 && legalLoaderEnd > legalLoaderStart ? connect.slice(legalLoaderStart, legalLoaderEnd) : '';
assert.strictEqual((legalLoader.match(/node\.src=SRC\+'\?v='/g) || []).length, 1,
  '1p bundle must have exactly one canonical Legal / IME preview source assignment');
assert(connect.includes("A='feat_mls_legalpack.js',SRC='1p-feat_mls_legalpack.js',V='p1-legal-1.0.0'"),
  '1p Legal loader must separate canonical dedupe identity from its isolated source/version');
assert(connect.includes("node.setAttribute('data-mls-asset',A)") && connect.includes("node.setAttribute('data-mls-version',V)"),
  '1p Legal loader must publish canonical identity and exact preview version');
assert(connect.includes("KEY='__mlsP1LegalLoader'") && connect.includes('maxAttempts:2') &&
  connect.includes("fail(node,'network-error')") && connect.includes("fail(node,'owner-missing')") &&
  connect.includes("if(!active()){disposeLatePreview();removeNode(node,'reverted-late');return;}"),
  '1p Legal loader lacks bounded load/owner failure recovery');
assert(connect.includes('var shared=window.__mlsLegalPack') && connect.includes("ctl.state='blocked-shared-owner'"),
  '1p Legal loader does not retire or refuse a hot shared Legal owner');
assert(!/\.src=['"]feat_mls_legalpack\.js\?v=/.test(connect),
  '1p bundle directly fetches the held shared Legal implementation');
const p1Legal = read('1p-feat_mls_legalpack.js');
assert(connect.includes('p1.installToken===ctl.installToken') && connect.includes('if(window[KEY]===ctl)') &&
  p1Legal.includes('installToken: liveLoader.installToken'),
  '1p Legal loader/API ownership is not bound to the exact install token');
assert(p1Legal.includes("window.__MLS_P1_PREVIEW.enabled !== true") && p1Legal.includes("byId('ptLawyerBtn')"),
  '1p Legal asset is not preview-gated or lacks its patient-level door');
assert(/Free preview/.test(p1Legal) && /role === 'receptionist'/.test(p1Legal),
  '1p Legal door is not visibly free or fails to exclude receptionists');

/* app-version.json describes production. Preview tabs must never compare
   themselves to it; they use metadata from their own /1p/ document while the
   ordinary production-capable branch retains app-version.json. */
const versionStart = connect.indexOf('if(window.__mlsVersionCheck) return;');
const versionEnd = connect.indexOf('\n(function(){', versionStart + 1);
assert(versionStart >= 0 && versionEnd > versionStart, '1p production-version-check block could not be isolated');
const versionBlock = connect.slice(versionStart, versionEnd);
assert(versionBlock.includes("var URL='app-version.json';"), 'version check no longer identifies the production manifest it must avoid comparing to 1p');
const canCheckLine = versionBlock.split(/\r?\n/).find((line) => line.includes('function canCheck()'));
assert(canCheckLine, '1p version-check predicate is missing');
const makeCanCheck = new Function('window', `${canCheckLine}\nreturn canCheck;`);
assert.strictEqual(makeCanCheck({ __MLS_P1_PREVIEW: { enabled: true }, backendMode: () => true })(), true,
  'the isolated 1p freshness check is disabled inside the preview');
assert.strictEqual(makeCanCheck({ __MLS_P1_PREVIEW: { enabled: false }, backendMode: () => true })(), true,
  'a non-enabled preview marker must not disable production version checks');
assert.strictEqual(makeCanCheck({ backendMode: () => true })(), true,
  'ordinary production-capable callers must retain version checks');
assert.strictEqual(makeCanCheck({ backendMode: () => false })(), false,
  'the pre-existing backend availability gate must remain intact');
assert(versionBlock.includes("fetch('/1p/?nc='+now,{method:'HEAD',cache:'no-store'})"),
  '1p freshness must use a metadata-only no-store request to its own route');
assert(versionBlock.includes("if(isPreview()){") && versionBlock.includes("fetch(URL+'?nc='+now,{cache:'no-store'})"),
  'preview and production version sources are no longer kept in separate branches');
assert(versionBlock.includes('if(canCheck()){') && versionBlock.includes('setTimeout(check, 8000);'),
  '1p version-check scheduling must stay behind the backend availability predicate');

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
  'sw.js'
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

/* Publication config is shared infrastructure, so this 1p train authorizes
   exactly one narrow traversal block and still byte-compares everything else
   to the frozen production baseline. */
const baseConfigResult = spawnSync('git', ['show', `${BASE_COMMIT}:_config.yml`],
  { cwd: root, encoding: 'utf8', windowsHide: true });
assert.strictEqual(baseConfigResult.status, 0, 'could not read baseline _config.yml for exact 1p publication proof');
const p1ConfigBlock = [
  '  # Exact nested showcase path. Do not include bare directory basenames here:',
  '  # Jekyll treats those broadly enough to reopen unrelated legal/test files.',
  '  - "1p/legal/index.html"',
  ''
].join('\n');
const currentConfig = read('_config.yml').replace(/\r\n/g, '\n');
assert.strictEqual((currentConfig.match(/  - "1p\/legal\/index\.html"/g) || []).length, 1, 'exact FREE Legal showcase include must appear once');
assert.strictEqual(currentConfig.replace(p1ConfigBlock, ''), String(baseConfigResult.stdout).replace(/\r\n/g, '\n'),
  '_config.yml changed beyond the exact reviewed 1p/legal traversal block');

const productionShell = read('ScribeFlow.html');
const productionConnect = read('mls-connect.js');
assert(productionShell.includes("s.src='mls-connect.js?v='+window.__MLS_AV"), 'production shell lost its production bundle loader');
assert(!productionShell.includes('__MLS_P1_PREVIEW') && !productionShell.includes('1p-mls-connect.js'),
  '1p preview marker/loader leaked into the production shell');
assert(!productionConnect.includes('1p-feat_mls_avatar.js') && !productionConnect.includes('1p-feat_mls_writeflow.js') &&
  !productionConnect.includes('1p-feat_mls_avatar_face.js') &&
  !productionConnect.includes('1p-feat_fullhistory_pdf.js') && !productionConnect.includes('1p-feat_task3_frontsync.js') &&
  !productionConnect.includes('1p-feat_mls_legalpack.js') && !productionConnect.includes('1p-feat_mls_athena_occurrence.js') &&
  !read('feat_mls_schedimport_exact.js').includes('1p-feat_nextup_connect.js'),
  '1p preview feature loaders leaked into the production bundle');

console.log(`PASS 1p preview contract: ${EXPECTED_BUILD}, live /1p/ route, exact preview loaders, 1p freshness isolated from the production version feed, protected production/extension bytes unchanged from ${BASE_COMMIT.slice(0, 8)}`);

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
const EXPECTED_BUILD = 'p1-20260815-launch-r1';
const P1_CONFIG_BASE_COMMIT = '08a7da1c6520fc6c6220664ebf4f05556859ab47';
/* The extension release train of 2026-08-17 (MLS Assist 3.0.62, wsg-2.0.0)
   moved exactly TWO literals in _config.yml - the released-package include
   name (MLS_Assist_v3.0.61 -> v3.0.62: zip, bin and the download comment) and
   its SHA-256 comment - the same lines every extension release moves
   (scripts/sweep-3062.js). The config comparison below applies those two
   literal substitutions to the frozen baseline text, so everything else in
   the file is still byte-compared. */
const P1_CONFIG_RELEASE_SUBS = [
  ['MLS_Assist_v3.0.62', 'MLS_Assist_v3.0.63'],
  ['b8a12950f9272a1fd1f50a13ac7f123d2d5a3638ecd0b6a1ccbc37380901ec0f', '2a62dc2ec6c1b4f60581a9f4237eb88d88ac6a784b5857b712e5579db30943ac']
];
/* Advanced by the AUTHORIZED /p1-only launch train of 2026-08-15 — resumable
   month/year pulls, scoped storage recovery, clinical review confirmation,
   mobile encounter safety, study provenance, and P1 presentation controls.
   This constant freezes 1p against a PRODUCTION train, which is why a 1p train
   is the only thing allowed to move it, and why the production and extension
   baselines below are deliberately NOT moved by it. */
/* Advanced by the AUTHORIZED extension release train of 2026-08-17 (MLS Assist
   3.0.62 / wsg-2.0.0, owner directive 2026-08-12: every supervised Athena action
   executes after the clinician's own confirm) - the 1p writeflow gained typed
   place_order rows and the Settings card moved to 3.0.62. */
/* Advanced by the 1p train of 2026-08-17 (Fable straighten-up lane): mrn-1.0.0
   (identity loss-prevention + local MRN/DOB backfill, both shells) and
   avcam-1.0.0 (avatar camera preview measured only after a decoded frame,
   1p-feat_mls_avatar.js). Production and extension baselines untouched. */
/* Advanced by the 1p train of 2026-08-17 (Fable straighten-up, batch 2): uns-namespace-guard-1.0.0,
   p1-roster-settle-preflight-1.0.0, p1-todaynote-deferred-retry-1.0.0, legal-tools-1.0.0,
   p1-legal-letterhead-1.0.0. Production and extension baselines untouched. */
/* Advanced by the 1p train of 2026-08-17 (Fable straighten-up, batch 3 — the pull lane): dnd-1.0.0
   (retry rows keep their schedule day), fd-1.0.0 (future-day note leg not applicable), dnf-1.0.0
   (bounded day-note read), bob-1.0.0 (census path defers history, never drops it), stp-2.0.0 (STOP
   ends every phase), fdx-1.0.0 (find diagnostics), scv-1.0.0 (store-census bar), ed-1.0.0 in the
   fork, rsk-1.0.0 (skip verified-today), cost breakdown, p1-authority-repair-1.0.0, cvc-1.0.0 (one
   continuous pull), U0 regex repairs. Production and extension baselines untouched. */
/* Advanced by the 1p train of 2026-08-17 (Fable straighten-up, batch 4 — the UI lane): msl-1.0.0 ring on
   every screen + mode chip + prose folding, msl-today regex fix, msl-fit-1.1.0, dock-1p-1.0.0 (side rail
   default, never covers content), opnote-open-1.0.0 (Prep Op Notes opens in 15 ms), _opContextDay ok()
   regex fix (no more wrong-day auto-draft), harness account for the uns guard. Production and
   extension baselines untouched. */
/* Advanced by the 1p train of 2026-08-17 (Fable straighten-up, batch 5): range jobs (durable month job in
   Staff Prep with Pause/Resume, year continues past a partial month with caps, sign-out → waiting-login),
   avatar (avlook-1.0.0 adult proportions, avanim-1.0.0 blink/gaze/visemes/neutral mouth,
   avintake-1.0.0 topics/correction/repeat guard/one encounter write); /cloned re-derived. Production and
   extension baselines untouched. */
/* Advanced by the 1p train of 2026-08-17 (Fable straighten-up, batch 6 — pull follow-up): dv3-1.0.0 (row
   verdict decoupled from the pulled-day note), tny-1.0.0 (today's not-yet-seen appointments are not failures),
   cap-1.0.0 (a captured chart is saved before any AI step; AI outage → summaryPending), nav-1.0.0 (no whole
   re-pull after a landed schedule), fdx-1.1.0; /cloned re-derived. Production and extension baselines untouched. */
const P1_BASE_COMMIT = '5fb0e3d60409ca0d751297d59686cd89e9fdef58';
/* Advanced by the SAME authorized extension release train (3.0.62): the four
   write-safety execute layers lifted, athenaFinalActionsV1 advertised, digest
   e5579398..., zip b8a12950... - documented in scripts/sweep-3062.js and the
   2026-08-17 evidence artifact. */
const EXTENSION_BASE_COMMIT = 'a1983b91737bef97871241cc18e053b7115f3413';
/* Advanced by the SAME extension release train, for the pin lines ONLY: the
   production Settings card version strings + release notes (ScribeFlow.html,
   ScribeFlow-staging.html) and the feat_mls_checker.js loader token in
   mls-connect.js (chk3061 -> chk3062) - exactly what every prior extension
   release moved. The production write contract (feat_mls_writeflow.js:
   note write/save only) did NOT move and is pinned by athena-action-contract. */
/* Advanced by the AUTHORIZED production hotfix train of 2026-08-17 (b1028,
   ed-1.0.0: a verified-empty day no longer reaches the AI schedule parser —
   owner: 'main site fixes come first'). Moves ScribeFlow.html/-staging.html,
   mls-connect.js, app-version.json build tokens and feat_mls_schedimport_exact.js
   ONLY; the extension baseline does not move. */
const PRODUCTION_BASE_COMMIT = '1ba4a812a10996e3f2b259bea70fb015b1297d09';

const P1_FILES = [
  '1pScribeFlow.html',
  '1p/index.html',
  '1p/legal/index.html',
  '1p/marketing/index.html',
  '1p-mls-connect.js',
  '1p-feat_mls_athena_occurrence.js',
  '1p-feat_athena_provider_roster.js',
  '1p-feat_mls_avatar.js',
  '1p-feat_mls_avatar_face.js',
  '1p-feat_fullhistory_pdf.js',
  '1p-feat_mls_legalpack.js',
  '1p-feat_mls_marketing.js',
  '1p-feat_nextup_connect.js',
  '1p-feat_mls_schedimport_exact.js',
  '1p-feat_mls_mobile_encounter.js',
  '1p-feat_mls_rangejobs.js',
  '1p-feat_mls_study_provenance.js',
  '1p-feat_mls_template_modes.js',
  '1p-feat_mls_writeflow.js',
  '1p-feat_task3_frontsync.js'
];

for (const name of P1_FILES) {
  const file = path.join(root, name);
  assert(fs.existsSync(file) && fs.statSync(file).isFile(), `1p preview file is missing: ${name}`);
  assert(fs.statSync(file).size > 1000, `1p preview file is unexpectedly empty/truncated: ${name}`);
}

/* b1026 is an authorized production-only Day rendering train. Freeze every
   1p runtime byte independently at the prior live checkpoint so a production
   release can never make preview drift invisible. */
const unchangedP1 = spawnSync('git', ['diff', '--quiet', P1_BASE_COMMIT, '--', ...P1_FILES],
  { cwd: root, encoding: 'utf8', windowsHide: true });
if (unchangedP1.status !== 0) {
  const names = spawnSync('git', ['diff', '--name-only', P1_BASE_COMMIT, '--', ...P1_FILES],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.fail(`authorized production b1026 changed frozen 1p bytes: ${String(names.stdout || unchangedP1.stderr || '').trim()}`);
}

const shell = read('1pScribeFlow.html');
const liveShell = read('1p/index.html');
const connect = read('1p-mls-connect.js');
const occurrence = read('1p-feat_mls_athena_occurrence.js');
const providerRoster = read('1p-feat_athena_provider_roster.js');

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

const avatarLoaderStart = connect.indexOf('/* p1-avatar-loader-1.0.0:');
const avatarLoaderEnd = connect.indexOf("if(!(window.__MLS_P1_PREVIEW&&window.__MLS_P1_PREVIEW.enabled===true))return;", avatarLoaderStart);
const avatarLoader = avatarLoaderStart >= 0 && avatarLoaderEnd > avatarLoaderStart
  ? connect.slice(avatarLoaderStart, avatarLoaderEnd) : '';
assert.strictEqual((avatarLoader.match(/node\.src=SRC\+'\?v='/g) || []).length, 1,
  '1p Avatar must have exactly one preview script creator');
assert(avatarLoader.includes("A='feat_mls_avatar.js',SRC='1p-feat_mls_avatar.js'") &&
  avatarLoader.includes("KEY='__mlsP1AvatarLoader'") && avatarLoader.includes("node.setAttribute('data-mls-install-token',ctl.installToken)"),
  '1p Avatar loader lost canonical identity, preview source, or exact install token');
assert(avatarLoader.includes('ctl.mountSkeleton=function()') &&
  connect.includes("ctl.version==='p1-avatar-loader-1.0.0'&&typeof ctl.mountSkeleton==='function'"),
  'instant Avatar card is no longer delegated to the one canonical loader');
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

assert.strictEqual((connect.match(/src:'1p-feat_athena_provider_roster\.js'/g) || []).length, 1,
  '1p bundle must load the preview canonical provider roster exactly once');
assert(!connect.includes("src:'1p-feat_athena_provider_picker.js'"),
  '1p bundle must not load the legacy widening provider picker');
assert(connect.includes("ctl.state='blocked-picker'") && connect.includes("retireGlobal('__mlsProviderTagFix')") &&
  connect.includes("retireGlobal('__mlsProviderPicker')") && connect.includes("data-mls-load-state','retired-p1-no-widen'"),
  '1p roster loader does not fail closed while retiring a hot picker/tag owner');
assert(providerRoster.includes("var INSTALL_TOKEN=loader.installToken") && providerRoster.includes('installToken: INSTALL_TOKEN') &&
  providerRoster.includes("e.source===root&&!!root.location&&e.origin===String(root.location.origin||'')") &&
  providerRoster.includes("reason:'unowned-raw-replay-disabled'") && providerRoster.includes("root.addEventListener('mls:session-boundary'"),
  '1p roster lost exact token/message/request/session ownership');
assert(!providerRoster.includes('__mlsProviderPicker') && !/widenToAll|applyScope\s*\(/.test(providerRoster),
  '1p roster forwards into a selected-to-all legacy picker path');

assert.strictEqual((connect.match(/s\.src='1p-feat_mls_schedimport_exact\.js\?v='/g) || []).length, 1,
  '1p bundle must load the isolated preview importer exactly once');
assert(connect.includes("s.setAttribute('data-mls-asset','feat_mls_schedimport_exact.js')"),
  '1p importer loader must retain the canonical dedupe identity');
assert(!connect.includes("s.src='feat_mls_schedimport_exact.js?v='"),
  '1p bundle still loads the shared production importer');
assert.strictEqual((connect.match(/A='1p-feat_mls_rangejobs\.js',V='p1-rangejobs-1\.1\.0'/g) || []).length, 1,
  '1p bundle must load the durable Month/Year coordinator exactly once');
assert.strictEqual((connect.match(/A='1p-feat_mls_study_provenance\.js',V='p1sp-1\.0\.0'/g) || []).length, 1,
  '1p bundle must declare the stored-evidence provenance loader exactly once');
assert(connect.includes("A='1p-feat_mls_study_provenance.js',V='p1sp-1.0.0'") &&
  connect.includes('api=window.__mlsP1StudyProvenance'),
  '1p bundle must load the exact stored-evidence provenance owner');
assert.strictEqual((connect.match(/A='1p-feat_mls_mobile_encounter\.js',V='p1-mobile-encounter-1\.0\.0',K='__mlsP1MobileEncounterLoader'/g) || []).length, 1,
  '1p bundle must declare the mobile encounter coordinator exactly once');
assert(connect.indexOf("A='1p-feat_mls_mobile_encounter.js',V='p1-mobile-encounter-1.0.0'") >
  connect.indexOf("SRC='1p-feat_mls_avatar.js'") &&
  connect.indexOf("A='1p-feat_mls_mobile_encounter.js',V='p1-mobile-encounter-1.0.0'") <
  connect.indexOf("SRC='1p-feat_mls_avatar_face.js'"),
  'mobile coordinator must load after Avatar and before the face presentation owner');
assert.strictEqual((connect.match(/A='1p-feat_mls_template_modes\.js',V='p1-template-modes-1\.0\.0',K='__mlsP1TemplateModesLoader'/g) || []).length, 1,
  '1p bundle must declare the template-mode adapter loader exactly once');
assert(connect.indexOf("A='1p-feat_mls_template_modes.js',V='p1-template-modes-1.0.0'") >
  connect.indexOf('var A="feat_mls_opnote_templates_ui.js"'),
  '1p template-mode adapter must load after the established template UI loader');

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
const legalLoaderEnd = connect.indexOf('/* 1p FREE Legal / IME preview:', legalLoaderStart);
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

const marketingLoaderStart = connect.indexOf("A='feat_mls_marketing.js',SRC='1p-feat_mls_marketing.js',V='mkt-p1-1.0.0'");
const marketingLoaderEnd = connect.indexOf('/* 1p FREE Marketing:', marketingLoaderStart);
const marketingLoader = marketingLoaderStart >= 0 && marketingLoaderEnd > marketingLoaderStart ? connect.slice(marketingLoaderStart, marketingLoaderEnd) : '';
assert(marketingLoader.includes('maxAttempts:2') && marketingLoader.includes("node.setAttribute('data-mls-install-token',ctl.installToken)") &&
  marketingLoader.includes("code:'marketing-draft'") && !/\.src=['"]feat_mls_marketing\.js/.test(marketingLoader),
  '1p Marketing loader lost bounded exact-token ownership or dirty-draft deferral');
const p1Marketing = read('1p-feat_mls_marketing.js');
assert(p1Marketing.includes("var LOADER_KEY = '__mlsP1MarketingLoader';") && p1Marketing.includes('loader.installToken !== installToken') &&
  p1Marketing.includes("['admin', 'owner', 'practice_owner', 'head', 'doctor', 'user']") && p1Marketing.includes("byId('mlsToolsMenu')"),
  '1p Marketing asset is not exact-token, canonical-role, and Calm/Lite reachable');
assert(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\/api\//.test(p1Marketing) &&
  !/mlsP1MktReview["']|Paste de-identified public review/.test(p1Marketing),
  '1p Marketing asset contains network/storage or free-text review intake');
for (const previewShell of [shell, liveShell]) {
  assert(previewShell.includes('window.__mlsP1MarketingIdentity=function(){') &&
    previewShell.includes("const account=sfNormalizeSessionAccount(window.__mlsSessionAccount||'');") &&
    previewShell.includes("mls:p1-marketing-identity-ready"),
    '1p shell lacks authoritative bounded Marketing identity reconciliation');
}

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
   importer/service worker, or audited 3.0.62 extension release bytes may move.
   Compare through Git so text filters do not make Windows line endings look
   like a mutation. A future authorized production/extension train must choose
   and document a new baseline instead of weakening this check. */
const PROTECTED_PRODUCTION = [
  'ScribeFlow.html',
  'ScribeFlow-staging.html',
  'mls-connect.js',
  'feat_mls_avatar.js',
  'feat_athena_provider_picker.js',
  'feat_athena_provider_roster.js',
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
  'MLS_Assist_v3.0.63.zip',
  'MLS_Assist_v3.0.63.bin'
];
const unchangedProduction = spawnSync('git', ['diff', '--quiet', PRODUCTION_BASE_COMMIT, '--', ...PROTECTED_PRODUCTION],
  { cwd: root, encoding: 'utf8', windowsHide: true });
if (unchangedProduction.status !== 0) {
  const names = spawnSync('git', ['diff', '--name-only', PRODUCTION_BASE_COMMIT, '--', ...PROTECTED_PRODUCTION],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.fail(`production bytes moved beyond the reviewed b1026 render release: ${String(names.stdout || unchangedProduction.stderr || '').trim()}`);
}
const unchangedExtension = spawnSync('git', ['diff', '--quiet', EXTENSION_BASE_COMMIT, '--', ...PROTECTED_EXTENSION],
  { cwd: root, encoding: 'utf8', windowsHide: true });
if (unchangedExtension.status !== 0) {
  const names = spawnSync('git', ['diff', '--name-only', EXTENSION_BASE_COMMIT, '--', ...PROTECTED_EXTENSION],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.fail(`authorized production b1026 changed frozen extension bytes: ${String(names.stdout || unchangedExtension.stderr || '').trim()}`);
}

/* Publication config is shared infrastructure, so this 1p train authorizes
   exactly one narrow traversal block and still byte-compares everything else
   to the frozen production baseline. */
const baseConfigResult = spawnSync('git', ['show', `${P1_CONFIG_BASE_COMMIT}:_config.yml`],
  { cwd: root, encoding: 'utf8', windowsHide: true });
assert.strictEqual(baseConfigResult.status, 0, 'could not read baseline _config.yml for exact 1p publication proof');
const p1ConfigBlock = [
  '  # Exact nested showcase path. Do not include bare directory basenames here:',
  '  # Jekyll treats those broadly enough to reopen unrelated legal/test files.',
  '  - "1p/legal/index.html"',
  '  - "1p/marketing/index.html"',
  ''
].join('\n');
/* The /cloned lane (2026-08-16) is a second authorized traversal block in the
   same shared file: a byte-faithful production clone that features graduate
   into from /1p. It is allowed here by exactly the same rule as the 1p block
   — one reviewed, literal set of lines — so everything else in _config.yml is
   still byte-compared against the frozen baseline. tests/cloned-lane-contract
   .test.js is what proves the route itself is a true clone. */
const clonedConfigBlock = [
  '',
  '',
  '  # 2026-08-16 — the /cloned live route (owner-only for now). A byte-faithful',
  '  # clone of ScribeFlow.html that will receive individual features promoted',
  '  # from /1p one at a time, and eventually become the main site. Same shape',
  '  # as the 1p live route above: it registers NO service worker, so it can',
  '  # never cache anything or disturb the main app.',
  '  # Exact nested path. Do not include a bare "cloned" directory basename here:',
  '  # Jekyll treats those broadly enough to reopen unrelated files.',
  '  - "cloned/index.html"'
].join('\n');
const currentConfig = read('_config.yml').replace(/\r\n/g, '\n');
assert.strictEqual((currentConfig.match(/  - "1p\/legal\/index\.html"/g) || []).length, 1, 'exact FREE Legal showcase include must appear once');
assert.strictEqual((currentConfig.match(/  - "1p\/marketing\/index\.html"/g) || []).length, 1, 'exact FREE Marketing showcase include must appear once');
assert.strictEqual((currentConfig.match(/  - "cloned\/index\.html"/g) || []).length, 1, 'exact /cloned live-route include must appear once');
const baseConfigText = P1_CONFIG_RELEASE_SUBS.reduce((text, [from, to]) => text.split(from).join(to), String(baseConfigResult.stdout).replace(/\r\n/g, '\n'));
assert.strictEqual(currentConfig.replace(p1ConfigBlock, '').replace(clonedConfigBlock, ''), baseConfigText,
  '_config.yml changed beyond the exact reviewed 1p showcase and /cloned traversal blocks (and the two 3.0.62 release literals)');

const productionShell = read('ScribeFlow.html');
const productionConnect = read('mls-connect.js');
assert(productionShell.includes("s.src='mls-connect.js?v='+window.__MLS_AV"), 'production shell lost its production bundle loader');
assert(!productionShell.includes('__MLS_P1_PREVIEW') && !productionShell.includes('1p-mls-connect.js'),
  '1p preview marker/loader leaked into the production shell');
assert(!productionConnect.includes('1p-feat_mls_avatar.js') && !productionConnect.includes('1p-feat_mls_writeflow.js') &&
  !productionConnect.includes('1p-feat_mls_avatar_face.js') &&
  !productionConnect.includes('1p-feat_fullhistory_pdf.js') && !productionConnect.includes('1p-feat_task3_frontsync.js') &&
  !productionConnect.includes('1p-feat_mls_legalpack.js') && !productionConnect.includes('1p-feat_mls_athena_occurrence.js') &&
  !productionConnect.includes('1p-feat_athena_provider_roster.js') &&
  !productionConnect.includes('1p-feat_mls_mobile_encounter.js') &&
  !productionConnect.includes('1p-feat_mls_rangejobs.js') &&
  !productionConnect.includes('1p-feat_mls_study_provenance.js') &&
  !productionConnect.includes('1p-feat_mls_template_modes.js') &&
  !productionConnect.includes('1p-feat_mls_marketing.js') &&
  !read('feat_mls_schedimport_exact.js').includes('1p-feat_nextup_connect.js'),
  '1p preview feature loaders leaked into the production bundle');

console.log(`PASS 1p preview contract: ${EXPECTED_BUILD}, live /1p/ route and loaders frozen at ${P1_BASE_COMMIT.slice(0, 8)}, production frozen at ${PRODUCTION_BASE_COMMIT.slice(0, 8)}, extension frozen at ${EXTENSION_BASE_COMMIT.slice(0, 8)}`);

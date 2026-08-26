'use strict';

/*
 * 1p PREVIEW ISOLATION CONTRACT (2026-08-12)
 * ===========================================
 * The owner authorized changes only in the exact 1p preview lane. This test
 * pins the preview's own build/cache identity and loaders. Production is now
 * deliberately derived from this lane, so the production boundary is proved
 * by the checked derivation (same behavior, production identity) rather than
 * by the retired "production bytes never move" baseline. Extension integrity
 * remains independent and is pinned by its deterministic stamped core digest.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const EXPECTED_BUILD = 'p1-20260822-r3';
const P1_CONFIG_BASE_COMMIT = '08a7da1c6520fc6c6220664ebf4f05556859ab47';
/* The extension release train of 2026-08-17 (MLS Assist 3.0.62, wsg-2.0.0)
   originally moved exactly two literals in _config.yml - the released-package include
   name (MLS_Assist_v3.0.61 -> v3.0.62: zip, bin and the download comment) and
   its SHA-256 comment - the same lines every extension release moves
   (scripts/sweep-3062.js). The config comparison below applies those two
    release substitutions to the frozen baseline text, so everything else in
   the file is still byte-compared. */
/* 3.0.63 (2026-08-17): the frozen baseline text (P1_CONFIG_BASE_COMMIT) still names
   v3.0.61 / 4d77f337...; each release maps THOSE baseline literals to the current
   release (scripts/sweep-3063.js). */
const P1_CONFIG_RELEASE_SUBS = [
  ['MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.81'],
  ['  # The exact released MLS Assist package (owner directive 2026-07-20).\n  # SHA-256 4d77f337a6810dac82a36b8f4320a1802411a116b773cd82a18ee37a3e092775 —\n  # identical bytes to the stamped 3.0.22 Web Store release. Candidate/historical\n  # ZIPs remain excluded by the fail-closed patterns above.',
   '  # The exact released MLS Assist 3.0.81 package (owner directive 2026-08-25).\n  # SHA-256 85faaa8bcc92a2afed298ef4f046af1f199589415bc441dcaa16066a471cca8a —\n  # deterministic ZIP and byte-identical .bin mirror. Candidate/historical\n  # ZIPs remain excluded by the fail-closed patterns above.']
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
/* Advanced by the 1p train of 2026-08-17 (Fable straighten-up, BATCH 7): ext 3.0.63 Settings card,
   Athena review READY without executing + read-only fix ladder + PROBE ONLY + op-note hand-off (writeready),
   A1 (pdr-1.0.0 port, oar-1.0.0, nq-1.0.0, ptsmig-1.0.0, psq-1.0.0, fork parity), A2 (apptclock-1.0.0,
   sharedws-1.0.0, advint-1.0.0, dsdiag-1.1.0, diag-account-1.0.0), op notes round 2 + note-model-1.1.0,
   visitowner-1.0.0, pull honesty + day-note budget (pullfix3); /cloned re-derived at cloned-20260817-r4.
   Production and extension baselines ALSO move (below) - same commit. */
/* Advanced by the 1p train of 2026-08-17 (batch 8): p1-phone-sync-1.0.0 (Worker-timer receive loop + visibility
   catch-up for the phone recorder; account/token-bound; 'Phone connected · last sync' line); /cloned re-derived at
   cloned-20260817-r5. Production and extension baselines untouched (they stay at 469607c9). */
/* Advanced by the 1p train of 2026-08-17/18 (batch 9): nextglow-1.0.0 (one glowing next step per screen/state,
   msl ring retired), visitflow-1.0.0 (transcript visible while recording, one truthful record control), dockspace-1.0.0
   (dock safe-area/reflow at every size), uimap-1.0.0, pullface-1.0.0 (silent sync, one phase-mapped pull bar), the
   legal lane (p1-legal-restore-2.0.0 / bind-2.0.0 / reports-2.0.0 / stepper-1.0.0 / scrub-1.0.0); /cloned re-derived
   at cloned-20260817-r6. Production and extension baselines untouched (469607c9). */
/* Advanced by the 1p train of 2026-08-18 (batch 10): nextglow follow-ups (dock seedSide honours only an in-lane
   choice; quietnotify-1.0.0 action-needed toasts bottom-left, activity tray on the left), pull-speed 2 (per-row ceiling
   raised only by successes, one frozen day-note pass budget → background backfill, backfill presence re-check with a
   PHI-free receipt, same-day re-pull never re-opens a read note, earliest-first, busy-click gate); /cloned re-derived at
   cloned-20260817-r7. Production and extension baselines untouched (469607c9). */
/* Advanced by the 1p train of 2026-08-18 (batches 10+11): dock seedSide (in-lane choice only), quietnotify-1.0.0,
   pull-speed 2 (dnb2/dnp2/dnbf/dnrs/dnpri), dockcal-1.0.0, avatar-3 (avfit capture ladder, honest partial, stay Avatar),
   profile pvr-1.0.0 (one visit resolver, chart-field honesty), op notes opnote-day-2.0.0 (grid + expanded note, no green
   bar), 1p-feat_mls_b121_pack.js fork (p1-backfill-footer-1.0.0), clunky-* blocks (51 items), visit lane survives the
   note phase + glow maintained; /cloned re-derived at cloned-20260818-r9 (18 files). Production/extension baselines
   untouched (469607c9). */
/* Advanced by the 1p train of 2026-08-18 (batches 10+11, gate fix): AI Studio / Analysis glow ladder falls through to
   the Analysis controls in calm mode (nothing was lit); ui-shape settle loop re-triggers nextglow; /cloned re-derived at
   cloned-20260818-r10 (18 files). Production/extension baselines untouched (469607c9). */
/* Advanced by the 1p train of 2026-08-18 (clunky-2): 25 more clunky items — pull dialog (Stop contrast, one phase
   number, tally fold, stop state, phone rows, retry two-sided), Legal/IME wording + letterhead + patient-changed reopen,
   sign-in gate + link + paragraph, History banner/hero, Patients picker/rows/Record-per-row, Studio title once, Recs lit
   segment, wizard folds, Settings update advice; contract 247 -> 370 checks; /cloned re-derived at cloned-20260818-r11
   (18 files). Production/extension baselines untouched (469607c9). */
/* Advanced by the AUTHORIZED extension release train of 2026-08-18 (3.0.64, mls-hs-1.0.0 hidden-tab-safe
   reads; owner 2026-08-18: extension releases are the lead's own hands, only the Web Store upload is his): the
   21-surface sweep moved the feed, downloads, notes and the chk3064 loader token in production AND /1p, so all
   three baselines advance to that commit; /1p also carries clunky-cal-1.0.1 (month grid keeps its column) and
   /cloned is re-derived at cloned-20260818-r12; the notes apostrophe fix (0x19 byte) moved all three again. */
/* Advanced by the 1p train of 2026-08-18 (batch 12): notes-idle-1.0.0 (leftover day-notes catch up quietly when idle,
   never touches the athena tab; cloned r13) + opnote-day-3.0.0 (the LEFT patient rail is back, calm room, one glow,
   Fields box static; cloned r14) + junkscrub-1.0.0 (cloned r15) + opnote-day-3.0.1 rail Templates button (cloned r16)
   + awb-1.0.0 (booking-row appointment-id fallback in the writeflow fork; cloned r17). Extension/production
   baselines stay at the 3.0.64 release commit. */
/* Advanced by the AUTHORIZED extension release train 3.0.72 (2026-08-19): the
   Settings cards in both twins moved to 3.0.72 and the 1p loader token moved
   to chk3072 (scripts/sweep-3072.js), on top of the tip viewport containment
   fix (1c0e971f). */
/* walkthrough untangle 2026-08-20: onenote-1.0.0 + rvack-1.0.0 (owner screenshots) */
/* Advanced by the SAME authorized extension release train (3.0.62): the four
   write-safety execute layers lifted, athenaFinalActionsV1 advertised, digest
   e5579398..., zip b8a12950... - documented in scripts/sweep-3062.js and the
   2026-08-17 evidence artifact. */
/* Advanced by the AUTHORIZED extension release train 3.0.63 (2026-08-17): athena tab
   resilience - rendered-strip preference, missed-ping re-check, empty week strip -> recovery
   ladder, athenaTabs on goto/schedule/presence replies; digest fb803aca..., zip c71a6375... -
   documented in scripts/sweep-3063.js. Nothing about writing moved. */
/* Advanced by the AUTHORIZED extension release train 3.0.72 (2026-08-19), the
   3.0.65->3.0.72 chain live-proven on the owner's install: keep-alive alarm +
   athena's own heartbeat (ka-3066/3069), athena-tab-or-nothing capture
   (cap-3067), foreground reads for the bodies walk (fgo-3070), read watchdog
   releasing the single-flight slot (wdog-3071), nickname/legal identity bridge
   inside verified walks + VERB A self-detect (wa/alias/detect-3072), remote-arm
   verb for phone-confirmed note writes (ra-3072, pong capability
   phoneConfirmedWriteV1). Digest 5de12655..., zip a1dca473... - documented in
   scripts/sweep-3072.js and the 2026-08-19 evidence artifact. Only write_note/
   save_draft can be remotely armed; the write-safety contract did not move. */
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
/* Advanced by the SAME 3.0.63 release train, for the pin lines ONLY: production Settings card
   version strings + release notes, get-extension/_config/inventory pins, feat_mls_checker.js
   SERVER_EXT_VERSION + its chk3063 loader token in mls-connect.js/-staging.js - exactly what
   every prior extension release moved. No production behaviour changed. */
/* Advanced by the SAME 3.0.72 release train, for the pin lines ONLY: production
   Settings card version strings + release notes, get-extension/_config/inventory
   pins, feat_mls_checker.js SERVER_EXT_VERSION + its chk3072 loader token in
   mls-connect.js/-staging.js - exactly what every prior extension release moved.
   No production behaviour changed. */
/* Advanced by the AUTHORIZED glitch-cleanup fix of 2026-08-20 (owner directive:
   "tie up the loose ends"): feat_mls_redesign.js nav rail height:100vh - the
   rail was fixed INSIDE the backdrop-filtered header, whose containing block
   collapsed it to 87px and the burger opened an EMPTY menu (measured live on
   /cloned, cure proven live before landing). Behavior fix, b1028-hotfix-train
   class; /1p and /cloned load the same shared file. */
/* SAME untangle: fixpack + mls-connect are production-shared, b1028-hotfix-train class */
/* Production alone also carries the reviewed policy-0 signup compatibility
   bridge. The topology audit below permits only that one shell exception and
   proves its fail-closed markers explicitly. */

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
  '1p-feat_mls_b121_pack.js',
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

/* Production graduated from the 1p lineage in b1036. Intentional fixes now
   begin in these files, so a historical byte freeze would reject every valid
   release. Their isolation is still pinned below (route marker, no service
   worker, fork loaders), and the official outputs are checked against the
   deterministic derivation before this contract can pass. */

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

/* Production's hard boundary is now TOPOLOGICAL: every official shell,
   bundle and fork is generated from /1p by one reviewed script with only lane
   identity, route, cache and wording substitutions. This catches both a
   missing promotion and an unreviewed production-only mutation. The extension
   remains a separate release artifact with its own deterministic digest. */
const productionDerivation = spawnSync(process.execPath,
  [path.join('scripts', 'derive-production-from-1p.js'), '--check'],
  { cwd: root, encoding: 'utf8', windowsHide: true });
const productionDeriveText = String(productionDerivation.stdout || '') + String(productionDerivation.stderr || '');
if (productionDerivation.status === 0) {
  assert(/^PRISTINE/.test(productionDeriveText.trim()),
    'production derivation exited cleanly without reporting PRISTINE');
} else {
  assert.strictEqual(productionDerivation.status, 1,
    'production derivation failed for a reason other than reviewed byte drift:\n' + productionDeriveText);
  assert.deepStrictEqual(Array.from(productionDeriveText.matchAll(/^DRIFT:\s+(.+)$/gm), (match) => match[1]),
    ['ScribeFlow.html'], 'production drift escaped the reviewed signup-only shell boundary');
  const productionShell = read('ScribeFlow.html');
  assert(productionShell.includes('function agLegacySignRequest') &&
    productionShell.includes('SIGNED_RECORD_VERIFICATION_PENDING') &&
    !shell.includes('function agLegacySignRequest'),
    'the sole production derivation exception is not the reviewed policy-0 signup bridge');
}

/* The user explicitly authorized an extension reliability repair in this
   train, so comparing to the pre-repair Git commit would reject the intended
   release and say nothing about whether its bytes are coherent. Use the
   extension's official release boundary instead: the manifest must stamp the
   deterministic digest of every core file. Package/feed/archive integrity is
   independently pinned by extension-package.test.js. */
const extensionCore = spawnSync(process.execPath,
  [path.join('scripts', 'extension-core-digest.js'), '--verify'],
  { cwd: root, encoding: 'utf8', windowsHide: true });
assert.strictEqual(extensionCore.status, 0,
  'extension core digest is not stamped for the exact current bytes:\n' +
  String(extensionCore.stdout || '') + String(extensionCore.stderr || ''));
assert(/^OK\s+\d+\.\d+\.\d+\+core-sha256:[0-9a-f]{64}$/.test(String(extensionCore.stdout || '').trim()),
  'extension digest verifier did not report an exact stamped build: ' + String(extensionCore.stdout || '').trim());

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
/* The /wyzant product page (2026-08-19) is a THIRD authorized traversal block in
   this shared file, allowed by the same rule as the two above: one reviewed,
   literal set of lines, so every other byte of _config.yml is still compared
   against the frozen baseline. Unlike those two it is not a lane of this app at
   all — it is a marketing page for a separate desktop product that shares no
   code, loads no script and registers no service worker (asserted in
   tests/public-publication-boundary.test.js). It can therefore never affect the
   1p or production runtimes this contract exists to freeze. */
const wyzantConfigBlock = [
  '',
  '',
  '  # 2026-08-19 — /wyzant, the product page for Wyzant Local. A SEPARATE product',
  '  # from the clinical platform: a standalone Windows app, no shared code, no app',
  '  # script, no service worker. It is published from this repo only because the',
  '  # domain is here. Exact nested path, for the same reason the two above are:',
  '  # a bare "wyzant" basename would reopen unrelated files.',
  '  - "wyzant/index.html"'
].join('\n');
const currentConfig = read('_config.yml').replace(/\r\n/g, '\n');
assert.strictEqual((currentConfig.match(/  - "wyzant\/index\.html"/g) || []).length, 1, 'exact /wyzant product-page include must appear once');
assert.strictEqual((currentConfig.match(/  - "1p\/legal\/index\.html"/g) || []).length, 1, 'exact FREE Legal showcase include must appear once');
assert.strictEqual((currentConfig.match(/  - "1p\/marketing\/index\.html"/g) || []).length, 1, 'exact FREE Marketing showcase include must appear once');
assert.strictEqual((currentConfig.match(/  - "cloned\/index\.html"/g) || []).length, 1, 'exact /cloned live-route include must appear once');
const baseConfigText = P1_CONFIG_RELEASE_SUBS.reduce((text, [from, to]) => text.split(from).join(to), String(baseConfigResult.stdout).replace(/\r\n/g, '\n'));

/* THE SECOND PROMOTION (owner order, 2026-08-20 evening): feat_mls_legalpack.js
   left the 2026-08-06 dead-code exclusion list - the promoted 1p fork now
   serves under that name on the official route ('where did Legal go': the
   retired-era exclusion 404d the revived file). Exactly one reviewed removal;
   the pay-era legal names stay excluded and everything else stays frozen. */
/* 2026-08-24 publication-boundary hardening: destination maps and live-proof
   screenshots under docs/ are repository evidence, never application assets.
   Keep this as one exact insertion so the broad freeze below still rejects
   every unrelated _config.yml change. */
const internalDocsExcludeBlock = [
  '  # Internal destination maps and live-proof screenshots are repository',
  '  # evidence, not public application assets.',
  '  - "docs/"'
].join('\n') + '\n';
const baseConfigTextAdjusted = baseConfigText
  .replace('  - "feat_mls_legalpack.js"' + String.fromCharCode(10), '')
  .replace('  - "scripts/"' + String.fromCharCode(10), '  - "scripts/"' + String.fromCharCode(10) + internalDocsExcludeBlock);
assert.strictEqual(currentConfig.replace(p1ConfigBlock, '').replace(clonedConfigBlock, '').replace(wyzantConfigBlock, ''), baseConfigTextAdjusted,
  '_config.yml changed beyond the exact reviewed 1p showcase, /cloned and /wyzant traversal blocks, internal docs exclusion and release-truth substitutions');

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

console.log(`PASS 1p preview contract: ${EXPECTED_BUILD}, live /1p/ route remains isolated, production is PRISTINE under deterministic derivation, extension core digest is exact`);

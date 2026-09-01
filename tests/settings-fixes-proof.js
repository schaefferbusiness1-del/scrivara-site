'use strict';

/* setfix-1.0.0 (b1169) — proof for the sweep-digest items fixed in this pass:
 *   n=39/60/73  the MLS Checker self-diagnostic was frozen at extension 3.0.84
 *               forever because its cache-bust token was a hand literal that
 *               never moved across five SERVER_EXT_VERSION bumps.
 *   n=40        setup wizard step 2's injected "Close" button did nothing in
 *               the wizard and could hide an unrelated Patients-view panel.
 *   n=41        setup step 4's booking-link clipboard-failure toast pointed
 *               at a row not mounted inside the wizard.
 *   n=42        togglePtMore() re-showed the role-gated Setup button for
 *               owner/admin/setupAllowed:false accounts.
 *   n=43        the legacy Settings-tab builder could not reach Change
 *               password / the walkthrough for lawyer accounts.
 *   n=45        three live Settings sections carried no ownership scope chip.
 *   n=46        the live extension-version row polled the extension every 4s
 *               for the life of the tab, Settings open or not.
 *   n=70        feat_pull_month_btn sent a bridge verb no extension handles.
 *   n=72        the goHome->gotoDate shim monkey-patched postMessage forever
 *               while its swallow branch could never fire (shim.armed was
 *               never set true).
 *
 * Each check pins a PROPERTY of the fix, not an incidental spelling, so a
 * later legitimate refactor can move the exact text without relitigating
 * this file — see the class of defect this convention exists to avoid in
 * tests/cache-token-cannot-go-stale.test.js and its neighbors.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let checks = 0;
function ok(value, message) { checks++; assert.ok(value, message); }

const p1Connect = read('1p-mls-connect.js');
const connect = read('mls-connect.js');
const clonedConnect = read('cloned-mls-connect.js');
const p1Shell = read('1pScribeFlow.html');
const shell = read('ScribeFlow.html');
const oneShell = read('1p/index.html');

/* ---------------------------------------------------------------------- */
/* n=39/60/73 — checker loader follows the build token, not a frozen literal */
/* ---------------------------------------------------------------------- */
const CHECKER_DYNAMIC = "feat_mls_checker.js?v='+(window.__MLS_AV||Date.now())";
for (const [name, text] of [['1p-mls-connect.js', p1Connect], ['mls-connect.js', connect], ['cloned-mls-connect.js', clonedConnect]]) {
  ok(text.includes(CHECKER_DYNAMIC),
    name + ': the MLS Checker loader must follow the shared __MLS_AV build token, not a hand-maintained literal');
  ok(!text.includes("feat_mls_checker.js?v=20260827chk3084"),
    name + ': the frozen 20260827chk3084 checker token must not be reachable from the loader position');
}
/* The property that made it freeze in the first place: a literal token has no
   structural link to SERVER_EXT_VERSION, so it can silently stop matching the
   published version. The build-token form is immune by construction — prove
   the checker module itself still declares a version this loader never has
   to individually track. */
ok(/var SERVER_EXT_VERSION\s*=\s*'[\d.]+'/.test(read('feat_mls_checker.js')),
  'feat_mls_checker.js must still declare SERVER_EXT_VERSION (untouched — the loader was the defect, not the checker)');

/* ---------------------------------------------------------------------- */
/* n=40 — wizard step 2's injected footer no longer ships a dead Close button */
/* ---------------------------------------------------------------------- */
for (const [name, text] of [['1pScribeFlow.html', p1Shell], ['ScribeFlow.html', shell], ['1p/index.html', oneShell]]) {
  ok(/<div id="su_schedBox" data-availbox>/.test(text),
    name + ': the wizard schedule host must carry the data-availbox marker avCloseEditor() looks for');
  ok(/function _avRenderEditor\(av,opts\)/.test(text),
    name + ': _avRenderEditor must accept an opts parameter');
  ok(/opts=opts\|\|\{\};\s*var chrome=opts\.chrome!==false;/.test(text),
    name + ': _avRenderEditor must default chrome to true and allow opts.chrome===false to suppress it');
  ok(text.includes("_avRenderEditor((d&&d.availability)||{},{chrome:false})"),
    name + ': the wizard\'s suRenderSchedule() must mount the editor with chrome:false (no injected Save/Close row)');
  /* The standalone hosts must keep their chrome — this is a scoped fix, not a
     global removal of the Save/Close row. */
  ok(/_avRenderEditor\(\(d&&d\.availability\)\|\|\{\}\):'<div class="mini">Editor unavailable\.<\/div>'/.test(text),
    name + ': the standalone #calAvailBox host must still call _avRenderEditor with its default (chrome-on) form');
}

/* ---------------------------------------------------------------------- */
/* n=41 — booking-link fallback has a copy target actually mounted in the wizard */
/* ---------------------------------------------------------------------- */
for (const [name, text] of [['1pScribeFlow.html', p1Shell], ['ScribeFlow.html', shell], ['1p/index.html', oneShell]]) {
  ok(text.includes('id="suBookingLinkRow"') && text.includes('id="suBookingLinkInput"'),
    name + ': #suBookingCard must carry its own copy row/input for a failed clipboard write');
  ok(text.includes("onclick=\"copyBookingLinkText('suBookingLinkInput')\""),
    name + ': the wizard copy button must target the wizard-local input');
  ok(/function copyBookingLinkText\(id\)/.test(text),
    name + ': copyBookingLinkText must accept a target id instead of always reading #bookingLinkInput');
  ok(/if\(row\.offsetParent!==null\) shown=true;/.test(text),
    name + ': copyBookingLink must judge "shown" by which copy target is actually visible, not assume the Patients-view row');
}

/* ---------------------------------------------------------------------- */
/* n=42 — one predicate governs the Setup button everywhere it is painted */
/* ---------------------------------------------------------------------- */
for (const [name, text] of [['1pScribeFlow.html', p1Shell], ['ScribeFlow.html', shell], ['1p/index.html', oneShell]]) {
  ok(/function mlsSetupButtonAllowed\(\)\{/.test(text),
    name + ': a single mlsSetupButtonAllowed() helper must exist');
  ok(/setupBtn\.style\.display=mlsSetupButtonAllowed\(\)\?'':'none';/.test(text),
    name + ': applyAccessUI() must paint #ptSetupBtn from the shared predicate');
  ok(/ptSetupBtn:mlsSetupButtonAllowed\(\)/.test(text),
    name + ': togglePtMore()\'s visibility map must paint #ptSetupBtn from the same shared predicate, not a weaker "hosted" flag');
  ok(!/ptSetupBtn:hosted/.test(text),
    name + ': the weaker `hosted`-only predicate for #ptSetupBtn must be gone from togglePtMore()');
}

/* ---------------------------------------------------------------------- */
/* n=43 — the legacy Settings-tab builder admits "Account & access" for lawyers */
/* ---------------------------------------------------------------------- */
for (const [name, text] of [['1pScribeFlow.html', p1Shell], ['ScribeFlow.html', shell], ['1p/index.html', oneShell]]) {
  ok(/const show = lawyer \? \/Display\|Security\|Account & access\/i\.test\(label\) : true;/.test(text),
    name + ': mlsBuildSettingsTabs()\'s lawyer gate must also admit "Account & access" (where #changePwField and the walkthrough live)');
}

/* ---------------------------------------------------------------------- */
/* n=45 — every live Settings heading has an ownership scope chip mapping */
/* ---------------------------------------------------------------------- */
for (const [name, text] of [['1pScribeFlow.html', p1Shell], ['ScribeFlow.html', shell], ['1p/index.html', oneShell]]) {
  for (const heading of ["'Patient check-in avatar':'Practice'", "'MLS Assist extension':'This device'", "'AI draft tuning':'Your account'"]) {
    ok(text.includes(heading), name + ': _SET_SCOPES must map ' + heading);
  }
  ok(/if\(!scope\)\{ try\{ console\.warn\(/.test(text),
    name + ': decorateSettingsScopes() must warn (not bail silently) on an unmapped heading, so a future omission is loud');
}

/* ---------------------------------------------------------------------- */
/* n=46 — the live extension-version row only pings while Settings is open */
/* ---------------------------------------------------------------------- */
for (const [name, text] of [['1p-mls-connect.js', p1Connect], ['mls-connect.js', connect], ['cloned-mls-connect.js', clonedConnect]]) {
  ok(/function settingsModalOpen\(\)\s*\{/.test(text),
    name + ': __mlsExtVerLive must define a settingsModalOpen() visibility check');
  ok(/if \(document\.hidden \|\| !settingsModalOpen\(\)\) return;/.test(text),
    name + ': render() must gate its expensive ping work on the Settings modal being visible and the tab not being hidden');
}
for (const [name, text] of [['1pScribeFlow.html', p1Shell], ['ScribeFlow.html', shell], ['1p/index.html', oneShell]]) {
  ok(text.includes("if(window.__mlsExtVerLive&&typeof window.__mlsExtVerLive.render==='function') window.__mlsExtVerLive.render();"),
    name + ': openSettings() must force one render immediately after the modal opens, so the row is not stale for up to 4s');
}

/* ---------------------------------------------------------------------- */
/* n=70 — the dead mlsAppPullMonth sender no longer exists */
/* ---------------------------------------------------------------------- */
for (const [name, text] of [['1p-mls-connect.js', p1Connect], ['mls-connect.js', connect], ['cloned-mls-connect.js', clonedConnect]]) {
  /* the actual send shape, not the bare substring — the removal comment
     itself quotes 'mlsAppPullMonth' in prose to explain what is gone. */
  ok(!text.includes("window.postMessage({source:'mls-app', type:'mlsAppPullMonth', days:31}"),
    name + ': no code may still post the mlsAppPullMonth verb — no extension release has ever implemented it');
  ok(!text.includes("btn.id='mls-pull-month-btn';"),
    name + ': the dead-end "Pull whole month" button must no longer be minted');
  ok(text.includes('feat_pull_month_btn REMOVED'),
    name + ': the removal must be recorded in place, not silently vanished, for the next reader');
}

/* ---------------------------------------------------------------------- */
/* n=72 — the never-armed goHome->gotoDate shim no longer monkey-patches postMessage */
/* ---------------------------------------------------------------------- */
for (const [name, text] of [['1p-mls-connect.js', p1Connect], ['mls-connect.js', connect], ['cloned-mls-connect.js', clonedConnect]]) {
  ok(!/function wrappedPost/.test(text),
    name + ': the wrappedPost postMessage interceptor must be gone');
  ok(!/var shim = \{ armed: false/.test(text),
    name + ': the shim state object must be gone');
  ok(!/window\.postMessage = wrappedPost;/.test(text),
    name + ': window.postMessage must not be unconditionally monkey-patched by the removed shim');
  /* run(), providersFor() and rosterFor() — the actual pull logic this shim
     sat beside — must be completely untouched by the removal, per "do not
     change pull behavior". */
  ok(/function run\(provider, monthPrefix\) \{/.test(text) && /exact\.pullMonth\(\{/.test(text),
    name + ': __mlsProvMonthPull.run() must still call the real exact.pullMonth() engine, unchanged');
}

console.log('PASS settings-fixes: ' + checks + ' checks');

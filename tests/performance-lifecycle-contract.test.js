'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const lifecycleFiles = [
  'feat_mls_recording_segments.js',
  'feat_mls_checker.js',
  'feat_mls_easy.js',
  'feat_mls_easy_4fixes.js',
  'feat_b18_qa.js',
  'feat_task3_frontsync.js',
  'feat_mls_legal_paywidget.js'
];

for (const file of lifecycleFiles) {
  const source = read(file);
  assert(!/\bsetInterval\s*\(/.test(source), `${file} must not add permanent interval polling`);
  assert(/revert/.test(source), `${file} must expose lifecycle cleanup`);
  assert(/clearTimeout|disconnect|removeEventListener/.test(source), `${file} must clean timers, observers, or listeners`);
}

const app = read('ScribeFlow.html');
const patientCardStart = app.indexOf('function renderInto(bar, p)');
const patientCard = app.slice(patientCardStart, app.indexOf('var _syncHtml', patientCardStart));
assert(patientCard.includes('bar.__mlsCardBaseHtml !== baseHtml'), 'active-patient header must diff its base facts before replacing the subtree');
assert(patientCard.includes('if (needsBase){'), 'active-patient header refresh must preserve an unchanged live subtree');

for (const file of ['feat_mls_dayprogress.js','feat_mls_recentpts.js','feat_mls_ptsnapshot.js','feat_mls_ctx_appt.js']) {
  const source = read(file);
  assert(/innerHTML\s*!==\s*html/.test(source), `${file} must not rebuild an unchanged header chip on its heartbeat`);
}
const tooltip = app.slice(app.indexOf('function _stripOneTitle'), app.indexOf('/* ---------------- Boot ---------------- */'));
assert(tooltip.includes('roots.forEach(_stripTitles)'), 'tooltip cleanup must process added subtrees');
const observerStart = tooltip.indexOf('new MutationObserver');
assert(observerStart >= 0);
assert(!tooltip.slice(observerStart).includes('_stripTitles(document)'), 'tooltip observer must not rescan the whole document after each mutation');

const connect = read('mls-connect.js');
const round4 = connect.slice(connect.indexOf('if (window.__mlsRound4B44)'), connect.indexOf('/* ================= apply toggles ================= */'));
assert(round4.includes('function backendReady()'), 'legacy controls must share the app demo/backend safety boundary');
assert(round4.includes("typeof window.backendMode === 'function' && !window.backendMode()"), 'demo/local mode must disable controls-card backend probes');
assert(round4.includes('if (!backendReady()) return Promise.resolve({});'), 'JSON status probes must short-circuit without network access');
assert(round4.includes("if (backendReady()) {\n      fetch(API + '/api/health')"), 'health probe must run only for authenticated hosted sessions');
assert(/function hjson[\s\S]*?\.catch\(function \(\) \{ return \{\}; \}\);/.test(round4), 'controls-card JSON probes must handle rejected requests');
assert(connect.includes('if (!hostedSessionReady()) return;'), 'version API checks must not run in demo or unsigned local sessions');
assert(connect.includes("version: inst || 'not-installed' }) }).catch(function () {});"), 'version reporting must handle rejected requests');
assert(connect.includes('if (!backendReady()) { state = { cls: "chk", txt: "Backend status is available after hosted sign-in." }; paint(); return; }'), 'legacy health polling must short-circuit before fetch in demo mode');
assert(connect.includes("if(canCheck()){\n    setTimeout(check, 8000);"), 'remote app-version self-check timers must not register in demo mode');
const cycle = connect.slice(connect.indexOf('MLS Scribe — RUN RE-WRAP CYCLE GUARD'), connect.indexOf('MLS Scribe — BOTTOM-RIGHT CLUSTER FIX'));
assert(cycle.includes('bounded boot window'));
assert(!/setInterval\s*\(tick\s*,\s*60/.test(cycle), 'cycle guard must not wake every 60ms forever');

const queue = connect.slice(connect.indexOf('feat_queue_fixes_0703 (inlined)'), connect.indexOf('end feat_queue_fixes_0703'));
assert(queue.includes('qRelevant') && queue.includes('qBootRetry'));
assert(!/setInterval/.test(queue), 'queue/template reconciliation must be event-driven');

const formatted = connect.slice(connect.indexOf('function attachPretty(ta, key)'), connect.indexOf('/* ---------- read-only xbody panels'));
assert(formatted.includes("Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')"));
assert(!/setInterval\s*\(tick\s*,\s*700/.test(formatted), 'formatted textareas must not each create a 700ms poll');

const autoPull = connect.slice(connect.indexOf('function startTodayPull(manual)'), connect.indexOf('function maybeAutoPull()'));
assert(autoPull.includes('var terminal ='));
assert(autoPull.includes('elapsed > 5000 && terminal'), 'terminal pull results must dismiss the loading card promptly');

const zipLink = connect.slice(connect.indexOf('SETTINGS DIRECT-DOWNLOAD RESTORE'), connect.indexOf('patient-list WIPE GUARD'));
assert(zipLink.includes('new MutationObserver'));
assert(zipLink.includes('data-mls-zip-checked'));
assert(!/setInterval\s*\(/.test(zipLink), 'extension ZIP availability must not poll the network forever');

const capturePolish = connect.slice(connect.indexOf('b45 polish hotfix'), connect.indexOf('b44 "Round 4"'));
assert(capturePolish.includes('WANT_STYLE'));
assert(capturePolish.includes('mountMo.observe'));
assert(!/setInterval\s*\(/.test(capturePolish), 'capture-card polish must not self-trigger through a permanent style poll');

const topLane = connect.slice(connect.indexOf('function syncTopLane(rec)'), connect.indexOf('function ensure()'));
assert(topLane.includes('setLaneText') && topLane.includes('setLaneHidden'));
assert(!/rb\.innerHTML\s*=/.test(topLane), 'top recording lane must not rebuild its button every 500ms');
assert(!/hint\.textContent\s*=|count\.textContent\s*=/.test(topLane), 'top recording lane text writes must be state-idempotent');

const smartToolsStart = connect.indexOf('function panelStateSignature()');
const smartTools = connect.slice(smartToolsStart, connect.indexOf('window.__mlsEasySmartTools_revert', smartToolsStart));
assert(smartTools.includes('existing.__mlsPanelSig === sig'));
assert(smartTools.includes('fresh.__mlsPanelSig = sig'), 'smart tools must rebuild only when its phase/widgets change');

const liveContrast = connect.slice(connect.indexOf('__mlsFmtLiveContrast) v1.0.0'), connect.indexOf('MLS Scribe — SUMMARY SANITIZER'));
assert(liveContrast.includes('window.__mlsFmtLiveContrast_iv = null'));
assert(!/setInterval\s*\(applyInline/.test(liveContrast), 'formatted note contrast must rely on its stylesheet, not repaint the tree every 800ms');

const round4Apply = connect.slice(connect.indexOf('function applyCtl()'), connect.indexOf('window.__mlsRound4B44 ='));
assert(round4Apply.includes('setR44Display'));
assert(!/applyCtl\(\); sweepErrors\(\)/.test(round4Apply), 'friendly-error handling is observer-driven and must not rescan the body every two seconds');

const premium = connect.slice(connect.indexOf('function normalizeSettingsLabel'), connect.indexOf('function paint(){'));
assert(premium.includes("sp.getAttribute('data-mls-prem-pill') !== '1'"), 'premium labels must not rewrite their own observer target forever');

const intervalGuard = connect.slice(connect.indexOf('/* ================= RC3:'), connect.indexOf('/* ================= RC4: FETCH COALESCER'));
assert(intervalGuard.includes('Preserve native timer semantics'));
assert(!intervalGuard.includes('pulseAll') && !intervalGuard.includes('reg[i].f()'), 'view changes must not synchronously replay every registered timer');
assert(!intervalGuard.includes('new MutationObserver') && !intervalGuard.includes("document.addEventListener('click'"), 'timer dedupe must not install a global view detector');

const wbDefaults = connect.slice(connect.indexOf('function patchTeachMsg(root)'), connect.indexOf('feat_today_noblink'));
assert(wbDefaults.includes("document.addEventListener('click'"));
assert(!/MutationObserver/.test(wbDefaults), 'routing help must patch when opened, not watch every document mutation');

const noBlink = connect.slice(connect.indexOf('if(window.__mlsNoTodayBlink)'), connect.indexOf('feat_pull_date_fix'));
assert(noBlink.includes('setTimeout(scrub,1000)'));
assert(!/MutationObserver|setInterval/.test(noBlink), 'Today-button polish must use CSS and bounded boot passes only');

const legal = read('feat_mls_legal_paywidget.js');
assert(legal.includes('for (var j = 1; j < all.length; j++) all[j].remove()'), 'legal payment banner must deduplicate itself');
assert(legal.includes("sessionStorage.getItem('sf_bk_token')"), 'legal status must honor the active per-tab session');

console.log(`PASS performance lifecycle: ${lifecycleFiles.length} interval-free modules, scoped observers, bounded loading and deduplicated UI`);

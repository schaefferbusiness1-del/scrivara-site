'use strict';

/*
 * /cloned LANE CONTRACT (2026-08-16)
 * ===================================
 * The owner authorized a new, third lane: /cloned. It starts as a byte-faithful
 * clone of the CURRENT PRODUCTION app (ScribeFlow.html + mls-connect.js) so
 * that individual features can later be promoted from /1p into /cloned one at
 * a time, and — once proven — /cloned can become the main site. /1p remains
 * the wild testing ground; production stays untouched.
 *
 * This test is modelled closely on tests/1p-preview-contract.test.js. Its most
 * important assertion is canonicalizeCloned(): strip away EXACTLY the
 * documented route bootstrap (URL normalize, <base>, CSP base-uri, dropped
 * service-worker registration, forked bundle loader/build token) and what is
 * left must be byte-identical to ScribeFlow.html. That is the checkable
 * definition of "it is a true clone".
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const CLONED_BUILD = 'cloned-20260816-r1';

const CLONED_FILES = ['cloned/index.html', 'cloned-mls-connect.js'];

for (const name of CLONED_FILES) {
  const file = path.join(root, name);
  assert(fs.existsSync(file) && fs.statSync(file).isFile(), `/cloned lane file is missing: ${name}`);
  assert(fs.statSync(file).size > 100000, `/cloned lane file is unexpectedly empty/truncated: ${name}`);
}

const clonedShell = read('cloned/index.html');
const clonedConnect = read('cloned-mls-connect.js');
const productionShell = read('ScribeFlow.html');
const productionConnect = read('mls-connect.js');

/* ---- CSP / route bootstrap ---- */
assert(clonedShell.includes("base-uri 'self'"), '/cloned CSP must permit only its same-origin base element');
assert(!clonedShell.includes("base-uri 'none'"), '/cloned CSP still blocks its required base element');

const clonedAuth = clonedShell.indexOf('window.__mlsAuthHandoff = captured;');
const clonedNormalize = clonedShell.indexOf("history.replaceState(null, document.title, '/cloned'");
const clonedBase = clonedShell.indexOf('<base href="/cloned">');
const clonedFirstAsset = clonedShell.indexOf('<script src="public-preview-policy.js?v=b497"></script>');
assert(clonedAuth >= 0 && clonedAuth < clonedNormalize && clonedNormalize < clonedBase && clonedBase < clonedFirstAsset,
  '/cloned must scrub auth first, normalize its URL, install its base, then load the first relative asset');

/* ---- must never register or replace the production service worker ---- */
assert(!/serviceWorker\.register\s*\(/.test(clonedShell), '/cloned must never register or replace the production service worker');
assert(clonedShell.includes("Promise.reject(new Error('cloned lane: service worker deliberately not registered')).catch(function(){});"),
  '/cloned must explicitly decline service-worker registration, not merely omit it silently');

/* ---- exactly one loader for cloned-mls-connect.js, never mls-connect.js ---- */
assert.strictEqual((clonedShell.match(/s\.src='cloned-mls-connect\.js\?v='\+window\.__MLS_AV/g) || []).length, 1,
  '/cloned shell must have exactly one loader for cloned-mls-connect.js');
assert(!clonedShell.includes("s.src='mls-connect.js?v='+window.__MLS_AV"),
  '/cloned shell must never enter the production mls-connect.js bundle');

/* ---- frozen lane marker / build token ---- */
assert(clonedShell.includes(`var CLONED_BUILD='${CLONED_BUILD}';`), '/cloned shell does not declare the expected immutable build token');
assert(clonedShell.includes(`window.__MLS_CLONED=Object.freeze({enabled:true,route:'/cloned/',build:CLONED_BUILD});`),
  '/cloned shell must publish the exact, frozen lane marker before loading its bundle');
assert(clonedShell.includes('window.__MLS_AV=CLONED_BUILD;'), '/cloned shell must use its own build as the downstream cache token');
assert(!/window\.__MLS_AV\s*=\s*['"]b\d+['"]/.test(clonedShell), '/cloned shell fell back to a production build token');

/* ---- no leaked 1p markers/loaders ---- */
assert(!clonedShell.includes('__MLS_P1_PREVIEW'), '/cloned must never publish or reference the 1p preview marker');
assert(!/\b1p-[\w.-]*\.js\b/.test(clonedShell), '/cloned must never load a 1p-prefixed script');

/* ---- promoted /1p features (2026-08-16 first /cloned graduation) ----
 * Six items, promoted one at a time from 1pScribeFlow.html per the lane's
 * graduation model. Each is asserted here — so the list of what has been
 * promoted stays explicit and readable in one place — and each is then
 * canonicalized away below so the true-clone proof still covers every other
 * byte of the file. Reversion literals are checked against productionShell
 * itself so a future, unrelated production edit fails loudly here instead of
 * producing a confusing byte-mismatch at the bottom of this file. */
const OLD_OPENOPPREP_LINE = "if(!dayKey){ var d=new Date(); d.setDate(d.getDate()+1); dayKey=_opDayKey(d); }   // default = tomorrow";
assert(productionShell.includes(OLD_OPENOPPREP_LINE), 'production openOpPrep default-tomorrow line moved — reversion literal is stale');

const ccOldFullStart = productionShell.indexOf('/* bounded snapshot for the instant next-open paint; quota-safe.');
const ccOldFullEnd = productionShell.indexOf('\n  renderCalendar(); renderCalCheckin();', ccOldFullStart);
assert(ccOldFullStart >= 0 && ccOldFullEnd > ccOldFullStart, 'production bounded-snapshot calendar-cache block could not be found — reversion literal is stale');
const ccOldFull = productionShell.slice(ccOldFullStart, ccOldFullEnd);
const ccTryMarker = '\n  try{ if(_calApplied&&_calRequestCurrent()){';
const ccTryIdx = ccOldFull.indexOf(ccTryMarker);
assert(ccTryIdx >= 0, 'production bounded-snapshot try block could not be isolated — reversion literal is stale');
/* Strip the leading "\n  " (newline + 2-space indent): that whitespace sits
   on the preserved side of the swap (right after the untouched "bounded
   snapshot" comment), not inside the replaced text itself. */
const OLD_CC_REPLACEMENT = ccOldFull.slice(ccTryIdx + 3);
assert(OLD_CC_REPLACEMENT.startsWith('try{ if(_calApplied'), 'OLD_CC_REPLACEMENT lost its expected prefix');

/* 1-3: msl-1.0.0 (simplification layer: three modes, selector registry,
 * disclosure buttons, card accordion, guided next-step ring), msl-today-1.0.0
 * (day/date chip, nested inside msl-1.0.0), and msl-autodraft-1.0.0
 * (auto-draft on opening Prep Op Notes). All three sit immediately before
 * the closing </body>, exactly as in 1pScribeFlow.html. */
const MSL_BLOCKS = [
  ['msl-1.0.0', '<!-- ===== msl-1.0.0', '<!-- ===== end msl-1.0.0'],
  ['msl-today-1.0.0', '<!-- ===== msl-today-1.0.0', '<!-- ===== end msl-today-1.0.0'],
  ['msl-autodraft-1.0.0', '<!-- ===== msl-autodraft-1.0.0', '<!-- ===== end msl-autodraft-1.0.0']
];
for (const [name, openMark, closeMark] of MSL_BLOCKS) {
  assert.strictEqual(clonedShell.split(openMark).length - 1, 1, `promoted ${name} block must open exactly once`);
  assert.strictEqual(clonedShell.split(closeMark).length - 1, 1, `promoted ${name} block must close exactly once`);
}
assert(clonedShell.includes('window.__mlsSimpleLayer = {') && clonedShell.includes("version: 'msl-1.0.0',"),
  'promoted msl-1.0.0 lost its controller API (window.__mlsSimpleLayer)');
assert(clonedShell.includes('window.applyMslModePreview = function (mode) {'),
  'promoted msl-1.0.0 lost the Settings field handler applyMslModePreview');
assert(clonedShell.includes("window.__mlsToday = { version: 'msl-today-1.0.0',"),
  'promoted msl-today-1.0.0 lost its controller API (window.__mlsToday)');
assert(clonedShell.includes("version: 'msl-autodraft-1.0.0',") && clonedShell.includes('window.__mlsAutoDraft = {'),
  'promoted msl-autodraft-1.0.0 lost its controller API (window.__mlsAutoDraft)');

const MSL_END_MARKER = '<!-- ===== end msl-autodraft-1.0.0 ====================================== -->';
const mslSpanStart = clonedShell.indexOf('<!-- ===== msl-1.0.0');
const mslEndMarkIdx = clonedShell.indexOf(MSL_END_MARKER);
assert(mslSpanStart > 0 && mslEndMarkIdx > mslSpanStart, 'promoted msl blocks could not be isolated as one contiguous span');
const mslSpanEnd = mslEndMarkIdx + MSL_END_MARKER.length + 1; // +1 consumes the single trailing newline before </body>
assert.strictEqual(clonedShell.slice(mslSpanEnd), '</body>\n</html>\n',
  'promoted msl blocks must sit immediately before the closing </body>, exactly like 1pScribeFlow.html');
const MSL_BLOCK_TEXT = clonedShell.slice(mslSpanStart, mslSpanEnd);

/* 4: the Settings field #qolMslMode (Simple / Normal / Everything), between
 * Text size and Navigation bar position — matching its position in 1p. Its
 * onchange handler (applyMslModePreview) is part of the promoted msl-1.0.0
 * controller asserted above, so reaching it depends on both landing. */
assert.strictEqual((clonedShell.match(/id="qolMslMode"/g) || []).length, 1, 'promoted Settings field #qolMslMode must appear exactly once');
assert(clonedShell.includes('onchange="applyMslModePreview(this.value)"'), 'promoted #qolMslMode field must call applyMslModePreview');
const qtsFieldIdx = clonedShell.indexOf('id="qolTextSize"');
const qmmFieldIdx = clonedShell.indexOf('id="qolMslMode"');
const qdsFieldIdx = clonedShell.indexOf('id="qolDockSide"');
assert(qtsFieldIdx >= 0 && qtsFieldIdx < qmmFieldIdx && qmmFieldIdx < qdsFieldIdx,
  'promoted #qolMslMode field must sit between Text size and Navigation bar position, matching 1p');
const QMM_FIELD_START = clonedShell.indexOf('\n\n      <div class="field">\n        <label for="qolMslMode">');
const QMM_FIELD_END = clonedShell.indexOf('\n\n      <div class="field">\n        <label for="qolDockSide">');
assert(QMM_FIELD_START >= 0 && QMM_FIELD_END > QMM_FIELD_START, 'promoted #qolMslMode field could not be isolated for canonicalization');
const QMM_FIELD_TEXT = clonedShell.slice(QMM_FIELD_START, QMM_FIELD_END);

/* 5: _opContextDay() + the openOpPrep default change — Prep Op Notes now
 * opens on the day the Calendar/Visit screen is showing, never an
 * unconditional tomorrow. */
assert.strictEqual((clonedShell.match(/function _opContextDay\(\)\{/g) || []).length, 1,
  'promoted _opContextDay() must be defined exactly once');
assert(clonedShell.includes("if(shown('calendarView')){ var c=cal(); if(c) return c; }") &&
  clonedShell.includes("if(shown('visitView')){ var v=strip(); if(v) return v; }"),
  '_opContextDay must prefer the shown Calendar/Visit day surface before falling back to today');
assert(clonedShell.includes('if(!dayKey){ dayKey=_opContextDay(); }'),
  'openOpPrep must default an unset day to _opContextDay(), not an unconditional tomorrow');
assert(!clonedShell.includes(OLD_OPENOPPREP_LINE),
  'openOpPrep still contains the old unconditional "default = tomorrow" line');
const OCD_START = clonedShell.indexOf('/* OWNER 2026-08-16: "when u click draft op notes on a day');
const OCD_END = clonedShell.indexOf('function openOpPrep(dayKey){');
assert(OCD_START >= 0 && OCD_END > OCD_START, 'promoted _opContextDay comment/function could not be isolated for canonicalization');
const OCD_TEXT = clonedShell.slice(OCD_START, OCD_END);

/* 6: the cc-1.1.0 calendar-cache quota fix — calApptsCacheV2 degrades
 * through 62/31/14/7-day windows instead of writing a single ~1.7MB
 * snapshot that could fill localStorage. */
assert(clonedShell.includes('/* cc-1.1.0 (owner phone screenshot, 2026-08-16).'), 'promoted cc-1.1.0 marker is missing');
assert(clonedShell.includes('_ccSteps=[[62,1500],[31,600],[14,250],[7,120]]'),
  'cc-1.1.0 must degrade through the documented 62/31/14/7-day windows');
assert(clonedShell.includes(".slice(0,cap)"), 'cc-1.1.0 write must use the degrading per-step cap, not a fixed size');
assert(!clonedShell.includes('_ccWin'), 'cc-1.1.0 must not still use the old single-window variable/write path');
assert(clonedShell.includes("localStorage.removeItem(uns('calApptsCacheV2'))"),
  'cc-1.1.0 must remove the cache key rather than leave a stale oversized value when even the smallest window will not fit');
const CC_START = clonedShell.indexOf('/* cc-1.1.0 (owner phone screenshot, 2026-08-16).');
const CC_END = clonedShell.indexOf('\n  renderCalendar(); renderCalCheckin();', CC_START);
assert(CC_START >= 0 && CC_END > CC_START, 'promoted cc-1.1.0 block could not be isolated for canonicalization');
const CC_TEXT = clonedShell.slice(CC_START, CC_END);

/* ---- canonicalizeCloned(): the true-clone proof ----
 * Strip EXACTLY the documented route/CSP/service-worker/bundle-loader
 * bootstrap and the remainder must be byte-identical to ScribeFlow.html.
 * The five promoted-feature edits above (msl blocks, the #qolMslMode field,
 * _opContextDay/openOpPrep, and cc-1.1.0) are undone the same way: strip or
 * reverse EXACTLY the text isolated above, nothing more. */
function canonicalizeCloned(value) {
  return String(value)
    .replace("base-uri 'self'", "base-uri 'none'")
    .replace(/<!-- cloned-live-1\.0\.0:[\s\S]*?<base href="\/cloned">\r?\n/, '')
    .replace(
      "Promise.reject(new Error('cloned lane: service worker deliberately not registered')).catch(function(){});",
      "navigator.serviceWorker.register('sw.js').catch(function(){});"
    )
    .replace(
      /\/\* cloned-1\.0\.0:[\s\S]*?var CLONED_BUILD='cloned-20260816-r1';\r?\n {2}window\.__MLS_CLONED=Object\.freeze\(\{enabled:true,route:'\/cloned\/',build:CLONED_BUILD\}\);\r?\n {2}window\.__MLS_AV=CLONED_BUILD;\r?\n/,
      "window.__MLS_AV='b1027';\n"
    )
    .replace("s.src='cloned-mls-connect.js?v='+window.__MLS_AV;", "s.src='mls-connect.js?v='+window.__MLS_AV;")
    .replace(MSL_BLOCK_TEXT, '')
    .replace(QMM_FIELD_TEXT, '')
    .replace(OCD_TEXT, '')
    .replace('if(!dayKey){ dayKey=_opContextDay(); }', OLD_OPENOPPREP_LINE)
    .replace(CC_TEXT, OLD_CC_REPLACEMENT);
}

const canonicalized = canonicalizeCloned(clonedShell);
assert.notStrictEqual(canonicalized, clonedShell, 'canonicalizeCloned() must actually strip something — a no-op means the route markers were not found');
assert.strictEqual(canonicalized, productionShell,
  'cloned/index.html drifted beyond its documented route/CSP/service-worker/bundle-loader bootstrap from ScribeFlow.html');

/* ---- cloned-mls-connect.js: same true-clone proof for the bundle ----
 * Only the fallback cache token and the diagnostic build constant may differ.
 * No feat_*.js fork is expected yet — the clone deliberately shares
 * production's feature files at first. */
assert(clonedConnect.includes(`window.__MLS_AV = window.__MLS_AV || '${CLONED_BUILD}';`),
  '/cloned bundle fallback cache token differs from the shell build token');
assert(clonedConnect.includes(`var MLS_APP_BUILD='${CLONED_BUILD}';`),
  '/cloned bundle diagnostic build differs from the shell build token');
assert(!/window\.__MLS_AV\s*=\s*window\.__MLS_AV\s*\|\|\s*['"]b\d+['"]/.test(clonedConnect),
  '/cloned bundle fell back to a production build token');
assert(!/\b1p-[\w.-]*\.js\b/.test(clonedConnect), '/cloned bundle must never load a 1p-prefixed feature file');

function canonicalizeClonedConnect(value) {
  return String(value)
    .replace(`window.__MLS_AV = window.__MLS_AV || '${CLONED_BUILD}';`, "window.__MLS_AV = window.__MLS_AV || 'b1027';")
    .replace(`var MLS_APP_BUILD='${CLONED_BUILD}';`, "var MLS_APP_BUILD='2026-07-25-b1027';");
}

const canonicalizedConnect = canonicalizeClonedConnect(clonedConnect);
assert.notStrictEqual(canonicalizedConnect, clonedConnect, 'canonicalizeClonedConnect() must actually strip something — a no-op means the build tokens were not found');
assert.strictEqual(canonicalizedConnect, productionConnect,
  'cloned-mls-connect.js drifted beyond its documented fallback-token/build-constant edits from mls-connect.js — no feat_*.js fork is authorized yet');

/* ---- production must stay completely untouched by this lane ---- */
assert(!productionShell.includes('__MLS_CLONED') && !productionShell.includes('cloned-mls-connect.js'),
  '/cloned lane marker or loader leaked into the production shell');
assert(!productionConnect.includes(CLONED_BUILD), '/cloned build token leaked into the production bundle');

console.log(`PASS /cloned lane contract: ${CLONED_BUILD}, cloned/index.html and cloned-mls-connect.js are exact route/token forks of ScribeFlow.html and mls-connect.js`);

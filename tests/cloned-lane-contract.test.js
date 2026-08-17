'use strict';

/*
 * /cloned LANE CONTRACT (2026-08-16, RESET TO PRISTINE 2026-08-17)
 * =================================================================
 * The owner authorized a new, third lane: /cloned. It is a byte-faithful clone
 * of the CURRENT PRODUCTION app (ScribeFlow.html + mls-connect.js) so that
 * individual features can later be promoted from /1p into /cloned one at a
 * time — ONLY when the owner says he is ready — and, once proven, /cloned can
 * become the main site. /1p remains the wild testing ground; production stays
 * untouched.
 *
 * 2026-08-17: the owner looked at /cloned and said "the clone site isn't even a
 * clone of the commercial site". He was right — six /1p features had been
 * promoted into it on 2026-08-16 without his go. This lane was reset to a
 * pristine clone (build token cloned-20260817-r2) and this test now asserts
 * that NOTHING but the documented lane identity differs from production.
 * Promotions are a separate, owner-approved act; when one lands it must be a
 * delimited block, asserted here by name AND canonicalized away, exactly as
 * tests/1p-preview-contract.test.js does for /1p.
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

const CLONED_BUILD = 'cloned-20260817-r2';
/* Production's own build-token line and bundle constants. These are read from
   the production files below (not hardcoded) so a production build bump moves
   them automatically; the literal here is only what the clone must NOT be. */
const PROD_AV_RE = /window\.__MLS_AV='(b\d+)';\n/;

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

const prodAvMatch = productionShell.match(PROD_AV_RE);
assert(prodAvMatch, 'production ScribeFlow.html no longer declares window.__MLS_AV=\'bNNNN\'; — update this contract');
const PROD_BUILD = prodAvMatch[1];
const prodConnectFallback = (productionConnect.match(/window\.__MLS_AV = window\.__MLS_AV \|\| '(b\d+)';/) || [])[0];
const prodConnectBuild = (productionConnect.match(/var MLS_APP_BUILD='([^']+)';/) || [])[0];
assert(prodConnectFallback && prodConnectBuild, 'production mls-connect.js no longer declares its fallback token / build constant; update this contract');

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
assert(!clonedShell.includes('cloned-20260816-r1'), '/cloned still carries the retired r1 token (the promoted-features era)');

/* ---- no leaked 1p markers/loaders ---- */
assert(!clonedShell.includes('__MLS_P1_PREVIEW'), '/cloned must never publish or reference the 1p preview marker');
assert(!/\b1p-[\w.-]*\.js\b/.test(clonedShell), '/cloned must never load a 1p-prefixed script');

/* ---- NO promoted /1p features (reset 2026-08-17) ----
 * The owner has not yet said "I'm ready" for any promotion. Until he does,
 * none of the /1p feature markers may appear in the clone. When he approves
 * one, add it as a named, delimited block here (assert it exactly once) AND
 * canonicalize it away below — never let it ride in silently. */
const P1_ONLY_MARKERS = [
  '<!-- ===== msl-1.0.0', 'window.__mlsSimpleLayer', 'applyMslModePreview', 'id="qolMslMode"',
  '<!-- ===== msl-today-1.0.0', 'window.__mlsToday', '<!-- ===== msl-autodraft-1.0.0', 'window.__mlsAutoDraft',
  'function _opContextDay()', '/* cc-1.1.0', '_ccSteps=', 'data-msl=', 'p1-live-1.0.0', 'window.__MLS_P1'
];
for (const marker of P1_ONLY_MARKERS) {
  assert(!clonedShell.includes(marker), `/cloned carries an unpromoted /1p feature marker: ${JSON.stringify(marker)} — promotions need the owner's go and a named block here`);
}

/* ---- canonicalizeCloned(): the true-clone proof ----
 * Strip EXACTLY the documented route/CSP/service-worker/bundle-loader
 * bootstrap and the remainder must be byte-identical to ScribeFlow.html.
 * NOTHING else is canonicalized: any other byte that differs fails here. */
function canonicalizeCloned(value) {
  return String(value)
    .replace("base-uri 'self'", "base-uri 'none'")
    .replace(/<!-- cloned-live-1\.0\.0:[\s\S]*?<base href="\/cloned">\r?\n/, '')
    .replace(
      "Promise.reject(new Error('cloned lane: service worker deliberately not registered')).catch(function(){});",
      "navigator.serviceWorker.register('sw.js').catch(function(){});"
    )
    .replace(
      new RegExp("\\/\\* cloned-1\\.0\\.0:[\\s\\S]*?var CLONED_BUILD='" + CLONED_BUILD.replace(/[.]/g, '\\.') + "';\\r?\\n {2}window\\.__MLS_CLONED=Object\\.freeze\\(\\{enabled:true,route:'\\/cloned\\/',build:CLONED_BUILD\\}\\);\\r?\\n {2}window\\.__MLS_AV=CLONED_BUILD;\\r?\\n"),
      `window.__MLS_AV='${PROD_BUILD}';\n`
    )
    .replace("s.src='cloned-mls-connect.js?v='+window.__MLS_AV;", "s.src='mls-connect.js?v='+window.__MLS_AV;");
}

const canonicalized = canonicalizeCloned(clonedShell);
assert.notStrictEqual(canonicalized, clonedShell, 'canonicalizeCloned() must actually strip something — a no-op means the route markers were not found');
assert.strictEqual(canonicalized, productionShell,
  'cloned/index.html drifted beyond its documented route/CSP/service-worker/bundle-loader bootstrap from ScribeFlow.html — it is no longer a true clone');

/* Belt and braces: the diff must be exactly the five identity hunks and its
   size delta must be small. A promoted feature would blow this up. */
const delta = clonedShell.length - productionShell.length;
assert(delta > 0 && delta < 1500, `cloned/index.html is ${delta} bytes larger than ScribeFlow.html; the lane identity alone is ~1.1KB — something else rode in`);

/* ---- cloned-mls-connect.js: same true-clone proof for the bundle ----
 * Only the fallback cache token and the diagnostic build constant may differ.
 * No feat_*.js fork exists — the clone shares production's feature files. */
assert(clonedConnect.includes(`window.__MLS_AV = window.__MLS_AV || '${CLONED_BUILD}';`),
  '/cloned bundle fallback cache token differs from the shell build token');
assert(clonedConnect.includes(`var MLS_APP_BUILD='${CLONED_BUILD}';`),
  '/cloned bundle diagnostic build differs from the shell build token');
assert(!/window\.__MLS_AV\s*=\s*window\.__MLS_AV\s*\|\|\s*['"]b\d+['"]/.test(clonedConnect),
  '/cloned bundle fell back to a production build token');
assert(!/\b1p-[\w.-]*\.js\b/.test(clonedConnect), '/cloned bundle must never load a 1p-prefixed feature file');
assert(!/\bcloned-feat_[\w.-]*\.js\b/.test(clonedConnect), '/cloned bundle loads a cloned-feat_*.js fork — no fork is authorized until the owner promotes a feature');

function canonicalizeClonedConnect(value) {
  return String(value)
    .replace(`window.__MLS_AV = window.__MLS_AV || '${CLONED_BUILD}';`, prodConnectFallback)
    .replace(`var MLS_APP_BUILD='${CLONED_BUILD}';`, prodConnectBuild);
}

const canonicalizedConnect = canonicalizeClonedConnect(clonedConnect);
assert.notStrictEqual(canonicalizedConnect, clonedConnect, 'canonicalizeClonedConnect() must actually strip something — a no-op means the build tokens were not found');
assert.strictEqual(canonicalizedConnect, productionConnect,
  'cloned-mls-connect.js drifted beyond its documented fallback-token/build-constant edits from mls-connect.js — no feat_*.js fork is authorized');

/* ---- production must stay completely untouched by this lane ---- */
assert(!productionShell.includes('__MLS_CLONED') && !productionShell.includes('cloned-mls-connect.js'),
  '/cloned lane marker or loader leaked into the production shell');
assert(!productionConnect.includes(CLONED_BUILD), '/cloned build token leaked into the production bundle');

console.log(`PASS /cloned lane contract: ${CLONED_BUILD}, cloned/index.html and cloned-mls-connect.js are PRISTINE route/token forks of ScribeFlow.html (${PROD_BUILD}) and mls-connect.js — zero promoted features`);

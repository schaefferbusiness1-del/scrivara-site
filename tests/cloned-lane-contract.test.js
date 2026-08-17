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

/* ---- canonicalizeCloned(): the true-clone proof ----
 * Strip EXACTLY the documented route/CSP/service-worker/bundle-loader
 * bootstrap and the remainder must be byte-identical to ScribeFlow.html. */
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
    .replace("s.src='cloned-mls-connect.js?v='+window.__MLS_AV;", "s.src='mls-connect.js?v='+window.__MLS_AV;");
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

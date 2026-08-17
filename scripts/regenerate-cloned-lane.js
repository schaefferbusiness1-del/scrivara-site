#!/usr/bin/env node
'use strict';
/*
 * Regenerate the /cloned lane as a PRISTINE byte-clone of production.
 *
 *   node scripts/regenerate-cloned-lane.js [--token cloned-YYYYMMDD-rN] [--check]
 *
 * The clone (cloned/index.html + cloned-mls-connect.js) is production
 * (ScribeFlow.html + mls-connect.js) plus EXACTLY the five lane-identity edits
 * that tests/cloned-lane-contract.test.js canonicalizes away:
 *   1. CSP  base-uri 'none'  ->  base-uri 'self'   (the clone needs a <base>)
 *   2. a cloned-live-1.0.0 URL-normalize block + <base href="/cloned"> right
 *      after the auth-scrub script
 *   3. the production service-worker registration replaced by an explicit
 *      refusal (a clone that registered the root SW would hijack the origin)
 *   4. window.__MLS_AV='bNNNN'  ->  the cloned-1.0.0 marker + CLONED_BUILD token
 *   5. the bundle loader points at cloned-mls-connect.js
 * and, in the bundle, only the fallback cache token and MLS_APP_BUILD.
 *
 * Owner's model (2026-08-16/17): /1p is the testing ground; features graduate
 * /1p -> /cloned ONE AT A TIME and ONLY when the owner says he is ready; when
 * /cloned is proven it becomes main; rinse and repeat. Until a promotion is
 * approved the clone must be a clone. Run this after any production change,
 * or after /cloned has become main, to re-derive the pristine clone; the
 * contract test then proves it. A promotion is NOT done with this script —
 * a promoted feature is a named, delimited block asserted by the contract test.
 *
 * With --check the script writes nothing and exits 1 if the files on disk are
 * not exactly what it would generate for the token they declare.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const tokenArg = (() => { const i = args.indexOf('--token'); return i >= 0 ? args[i + 1] : ''; })();
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

const prodShell = read('ScribeFlow.html');
const prodConnect = read('mls-connect.js');

const currentToken = (() => {
  try { return (read('cloned/index.html').match(/var CLONED_BUILD='([^']+)';/) || [])[1] || ''; } catch (e) { return ''; }
})();
const TOKEN = tokenArg || currentToken;
if (!/^cloned-\d{8}-r\d+$/.test(TOKEN)) {
  console.error('need a token like cloned-20260817-r2 (pass --token, or have an existing cloned/index.html declare one)');
  process.exit(2);
}

const NORMALIZE_BLOCK =
`<!-- cloned-live-1.0.0: GitHub Pages serves this clone at /cloned/. Normalize the
     document to the file-like /cloned URL, then use that exact URL as the base.
     Relative app assets consequently resolve at the site root, while CSS/SVG
     fragment paints still resolve back to this same document (/cloned#id). -->
<script>
(function () {
  try {
    if (location.pathname !== '/cloned') {
      history.replaceState(null, document.title, '/cloned' + (location.search || '') + (location.hash || ''));
    }
  } catch (_) {}
})();
</script>
<base href="/cloned">
`;
const AUTH_ANCHOR = "  window.__mlsAuthHandoff = captured;\n})();\n</script>\n";
const SW_REGISTER = "navigator.serviceWorker.register('sw.js').catch(function(){});";
const SW_REFUSAL = "Promise.reject(new Error('cloned lane: service worker deliberately not registered')).catch(function(){});";
const MARKER_BLOCK = (token) =>
`  /* cloned-1.0.0: the clone owns a distinct immutable asset identity. Reusing a
     production build token lets an already-active root service worker replay
     stale shared modules into this page, and makes diagnostics indistinguishable
     from the production app. This marker changes clone requests only. */
  var CLONED_BUILD='${token}';
  window.__MLS_CLONED=Object.freeze({enabled:true,route:'/cloned/',build:CLONED_BUILD});
  window.__MLS_AV=CLONED_BUILD;
`;

function once(hay, needle, label) {
  const n = hay.split(needle).length - 1;
  if (n !== 1) throw new Error(`${label}: expected exactly 1 occurrence in production, found ${n}`);
}
const avLine = (prodShell.match(/  window\.__MLS_AV='(b\d+)';\n/) || [])[0];
if (!avLine) throw new Error("production ScribeFlow.html no longer declares  window.__MLS_AV='bNNNN';");
once(prodShell, "base-uri 'none'", 'CSP base-uri');
once(prodShell, AUTH_ANCHOR, 'auth-scrub anchor');
once(prodShell, SW_REGISTER, 'SW register');
once(prodShell, avLine, 'build-token line');
once(prodShell, "s.src='mls-connect.js?v='+window.__MLS_AV;", 'bundle loader');

const shell = prodShell
  .replace("base-uri 'none'", "base-uri 'self'")
  .replace(AUTH_ANCHOR, AUTH_ANCHOR + NORMALIZE_BLOCK)
  .replace(SW_REGISTER, SW_REFUSAL)
  .replace(avLine, MARKER_BLOCK(TOKEN))
  .replace("s.src='mls-connect.js?v='+window.__MLS_AV;", "s.src='cloned-mls-connect.js?v='+window.__MLS_AV;");

const fallback = (prodConnect.match(/window\.__MLS_AV = window\.__MLS_AV \|\| '(b\d+)';/) || [])[0];
const buildConst = (prodConnect.match(/var MLS_APP_BUILD='([^']+)';/) || [])[0];
if (!fallback || !buildConst) throw new Error('production mls-connect.js no longer declares its fallback token / build constant');
once(prodConnect, fallback, 'connect fallback token');
once(prodConnect, buildConst, 'connect build constant');
const connect = prodConnect
  .replace(fallback, `window.__MLS_AV = window.__MLS_AV || '${TOKEN}';`)
  .replace(buildConst, `var MLS_APP_BUILD='${TOKEN}';`);

if (check) {
  const okShell = fs.existsSync(path.join(root, 'cloned/index.html')) && read('cloned/index.html') === shell;
  const okConnect = fs.existsSync(path.join(root, 'cloned-mls-connect.js')) && read('cloned-mls-connect.js') === connect;
  console.log(`cloned/index.html ${okShell ? 'PRISTINE' : 'DRIFTED'}; cloned-mls-connect.js ${okConnect ? 'PRISTINE' : 'DRIFTED'} (token ${TOKEN})`);
  process.exit(okShell && okConnect ? 0 : 1);
}
fs.mkdirSync(path.join(root, 'cloned'), { recursive: true });
fs.writeFileSync(path.join(root, 'cloned/index.html'), shell, 'utf8');
fs.writeFileSync(path.join(root, 'cloned-mls-connect.js'), connect, 'utf8');
console.log(`regenerated /cloned as a pristine clone of production (${avLine.trim()}) with token ${TOKEN}: cloned/index.html ${shell.length} bytes (+${shell.length - prodShell.length}), cloned-mls-connect.js ${connect.length} bytes (+${connect.length - prodConnect.length})`);

/* 1p-ondemand-templates.test.js  (1p PREVIEW ONLY)
 *
 * Pins p1-ondemand-1.0.0: Templates and the op-note room load when their
 * surface is opened, instead of waiting for their turn at position 99/107 in
 * the 125-deep __mlsDeferAsset queue (2500ms + 250ms per script = ~27s best
 * case, longer because interacting pauses the queue).
 *
 * The load-bearing property is NOT "we added a loader" - it is that the early
 * loader is INDISTINGUISHABLE from the queued one, so the two can never both
 * fetch. Every queued registration guards on
 *   document.querySelector('script[data-mls-asset="NAME"]')
 * so our tag must carry the IDENTICAL name and the IDENTICAL NAME?v=__MLS_AV
 * url. Those two identities are what this suite protects.
 *
 * Touches only 1p-mls-connect.js. Asserts nothing about production files.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const CONNECT = path.join(ROOT, '1p-mls-connect.js');
const src = fs.readFileSync(CONNECT, 'latin1');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- 1. the block ships, once ---- */
const marker = /p1-ondemand-1\.0\.0/g;
const markerHits = (src.match(marker) || []).length;
ok(markerHits >= 1, 'p1-ondemand-1.0.0 block is missing from 1p-mls-connect.js');
ok((src.match(/window\.__mlsP1OnDemand\s*=\s*\{/g) || []).length === 1,
  'expected exactly one __mlsP1OnDemand installation');
ok(/if\s*\(window\.__mlsP1OnDemand\)\s*return;/.test(src),
  'the block must re-entry-guard on window.__mlsP1OnDemand');

/* ---- 2. the three assets are exactly the queued names ---- */
const ASSETS = [
  'feat_mls_template_library.js',
  'feat_mls_opnote_templates_ui.js',
  'feat_mls_opnote_room.js'
];
for (const name of ASSETS) {
  /* the queued registration for this asset must still exist... */
  ok(src.indexOf('data-mls-asset') > -1 && src.indexOf(name) > -1,
    'queued registration for ' + name + ' vanished - the on-demand path must ADD a trigger, not replace one');
  /* ...and our list must name it verbatim */
  ok(new RegExp("'" + name.replace(/[.]/g, '\\.') + "'").test(src),
    'on-demand asset list must name ' + name + ' verbatim');
}

/* ---- 3. THE DEDUPE CONTRACT: identical tag identity ---- *
 * If we ever set a different data-mls-asset (e.g. a "1p-" prefixed one), the
 * queued guard stops recognising our tag and BOTH paths fetch. */
ok(/s\.setAttribute\('data-mls-asset',\s*name\);/.test(src),
  'the on-demand tag must set data-mls-asset to the SAME name the queue guards on');
ok(!/setAttribute\('data-mls-asset',\s*'1p-/.test(src),
  'the on-demand tag must NOT use a 1p-prefixed data-mls-asset - that would defeat the queued dedupe guard');

/* ---- 4. THE URL CONTRACT: identical cache entry ---- */
ok(/s\.src\s*=\s*name\s*\+\s*'\?v='\s*\+\s*\(window\.__MLS_AV\s*\|\|\s*Date\.now\(\)\);/.test(src),
  'the on-demand src must be NAME?v=__MLS_AV, byte-identical to the queued url, so one fetch is shared');

/* ---- 5. present() checks before injecting ---- */
ok(/function present\(name\)[^]{0,220}querySelector\('script\[data-mls-asset="'\s*\+\s*name/.test(src),
  'present() must probe the same selector the queued guards use');
ok(/if\s*\(stopped\s*\|\|\s*hurried\[name\]\s*\|\|\s*present\(name\)\)\s*return false;/.test(src),
  'hurry() must refuse when the asset is already present or already hurried');

/* ---- 6. a failed early load must not strand the surface ---- */
ok(/addEventListener\('error'[^]{0,200}hurried\[name\]\s*=\s*false/.test(src),
  'on error the on-demand path must release its claim so the deferred queue still gets its turn');

/* ---- 7. house convention: additive and reversible ---- */
ok(/revert:\s*function/.test(src), 'p1-ondemand must expose revert()');
ok(/removeEventListener/.test(src), 'revert() must actually unbind its listeners');
ok(/state:\s*function/.test(src), 'p1-ondemand must expose state() for diagnosis');

/* ---- 8. it must never break boot ---- */
const block = src.slice(src.indexOf('p1-ondemand-1.0.0'));
ok(/catch\s*\(e\)\s*\{\s*\/\* never let a preview convenience break boot \*\/\s*\}/.test(block),
  'the whole block must be wrapped in a swallowing try/catch');

/* ---- 9. no production file is implicated ---- */
ok(!/ScribeFlow\.html/.test(block), 'the on-demand block must not reference the production shell');
ok(!/'mls-connect\.js/.test(block), 'the on-demand block must not reference the production bundle');

/* ---- 10. the entry-point matcher cannot fire on arbitrary prose ---- */
ok(/t\.length\s*<\s*40\s*&&\s*LABEL\.test\(t\)/.test(src),
  'the label match must be length-bounded so long prose cannot trigger a load');
ok(/closest\('button,a,\[role="button"\],\[role="tab"\],\.opr-tab,\.mlsTbItem'\)/.test(src),
  'the matcher must be scoped to interactive elements only');

console.log('PASS 1p-ondemand-templates (' + checks + ' assertions)');

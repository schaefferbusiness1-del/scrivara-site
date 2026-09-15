'use strict';
/* MLS Assist 3.0.156 — hoistfix-1.0.0: the chart handler must not carry block-level copies of the identity key
 * helpers. A sloppy-mode function declaration inside a bare block hoists to the enclosing function as
 * `undefined` until the block runs (Annex B), so every use above the block threw "is not a function" - measured
 * live on Run AF (3.0.155): 40 of 40 chart reads failed in ~4 s. Reproduces the hazard, then pins the cure. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* 1. the hazard itself, executed: a block-level declaration shadows the global as undefined above the block */
const hazard = new Function('function key(v) { return "global:" + v; }\nreturn (function handler() { var before = typeof key; { function key(v) { return "local:" + v; } } return before; })();');
eq(hazard(), 'undefined', 'a block-level function declaration hoists as undefined above its block (sloppy mode) - the Run AF failure');
const cured = new Function('function key(v) { return "global:" + v; }\nreturn (function handler() { var before = typeof key; { /* copies deleted */ } return before; })();');
eq(cured(), 'function', 'with the copies deleted the global serves the whole handler');

/* 2. the cure in background.js: no block-level copy of either helper inside the chart handler */
const hStart = bg.indexOf("  if (msg.type === 'mlsAppChartRequest') {");
ok(hStart > 0, 'chart handler located');
/* the handler ends where the next top-level message branch begins */
const hEnd = bg.indexOf("\n  if (msg.type === '", hStart + 10);
ok(hEnd > hStart, 'chart handler end located');
const handler = bg.slice(hStart, hEnd);
ok(handler.includes("const wantDob = String(msg.patientDob || '').trim();"), 'this is the read handler');
eq((handler.match(/^\s+function mlsExactDobKey\(value\) \{/gm) || []).length, 0, 'no block-level mlsExactDobKey inside the chart handler');
eq((handler.match(/^\s+function mlsExactNameKey\(value\) \{/gm) || []).length, 0, 'no block-level mlsExactNameKey inside the chart handler');
ok(handler.includes('mlsExactDobKey(') && handler.includes('mlsExactNameKey('), 'the handler still uses both helpers (now the globals)');
/* 3. the worker's ONE top-level copy: column 0, right before mlsPickEmrTab, marked hoistfix-1.0.0 */
const mark = bg.indexOf("/* hoistfix-1.0.0 (3.0.156): the worker's ONE top-level copy of the exact identity keys.");
ok(mark > 0, 'the worker-level copy is marked');
const gName = bg.indexOf('\nfunction mlsExactNameKey(value) {', mark), gDob = bg.indexOf('\nfunction mlsExactDobKey(value) {', mark);
const anchor = bg.indexOf('\nfunction mlsPickEmrTab(all) {', mark);
ok(gName > mark && gDob > gName && anchor > gDob && anchor - mark < 3500, 'both keys sit between the mark and mlsPickEmrTab, at column 0');
ok(bg.indexOf("  if (msg.type === 'mlsAppChartRequest') {") > anchor, 'the chart handler follows (a hoisted top-level declaration serves it either way)');
/* the worker copy is byte-identical to the driver copy it was taken from */
const drv = bg.indexOf('\nfunction mlsExactNameKey(value) {');
const fnPair = (from) => { const d = bg.indexOf('\nfunction mlsExactDobKey(value) {', from); const e = bg.indexOf('\n}', d + 10); return bg.slice(from + 1, e + 2).replace(/\r/g, ''); };
eq(fnPair(gName), fnPair(drv), 'the worker copy equals the driver copy (line endings aside)');
/* every other copy is an INDENTED-or-driver copy inside an injected page function; none may be a block-level
   declaration inside any chrome.runtime.onMessage handler (the hazard class) */
const listenerStarts = []; let li = -1; while ((li = bg.indexOf('chrome.runtime.onMessage.addListener(', li + 1)) >= 0) listenerStarts.push(li);
ok(listenerStarts.length >= 2, 'message listeners located');
const blockLevelRe = /\n\s+function mlsExact(Dob|Name)Key\(value\) \{/g; let mm; const offenders = [];
while ((mm = blockLevelRe.exec(bg))) {
  const at = mm.index; const nearestListener = listenerStarts.filter((x) => x < at).pop();
  if (nearestListener == null) continue;
  /* inside a listener, an indented declaration is allowed only inside an injected `func:` / driver function, never in a bare block */
  const between = bg.slice(nearestListener, at);
  const lastFunc = Math.max(between.lastIndexOf('func: '), between.lastIndexOf('function mls'), between.lastIndexOf('DriverFn('));
  const lastBareBlock = between.lastIndexOf('\n        {\n');
  if (lastBareBlock > lastFunc) offenders.push(bg.slice(0, at).split('\n').length + 1);
}
eq(offenders.length, 0, 'no block-level key declaration inside any message listener (lines: ' + offenders.join(',') + ')');
/* 4. the service worker is a classic script, so top-level declarations are globals in every handler */
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
eq(manifest.background && manifest.background.type, undefined, 'classic (non-module) service worker: top-level functions are globals');
console.log('PASS hoistfix-30156-runtime: ' + checks + ' checks');

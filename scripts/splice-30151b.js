'use strict';
/* MLS Assist 3.0.151 - axlistdate-1.0.1 (Fable, 2026-09-15): the two `location.pathname` reads added by
 * axlistdate-1.0.0 run inside injected page functions, but two Node suites (full-visit-reader-runtime) execute the
 * same ops without a window. Read the path through a guarded accessor so the harness answers '' instead of
 * throwing. Latin1 seams, inverse proof. Run once (after splice-30151.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("      return { ok: true, encounters: axUnique, briefingPath: String(location.pathname || ''), surfaceSig: {",
    "      return { ok: true, encounters: axUnique, briefingPath: (typeof location !== 'undefined' ? String(location.pathname || '') : ''), surfaceSig: {", 'harvest path');
rep("        if (explicitEmptyVisits() && !/\\/ax\\/encounter\\//i.test(String(location.pathname || ''))) return { ok: true, selector: 'verified-empty-state',",
    "        if (explicitEmptyVisits() && !/\\/ax\\/encounter\\//i.test(typeof location !== 'undefined' ? String(location.pathname || '') : '')) return { ok: true, selector: 'verified-empty-state',", 'empty guard');
let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30151b: ' + edits.length + ' verified seams');

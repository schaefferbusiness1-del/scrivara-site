'use strict';
/* MLS Assist 3.0.152 - axscoped-1.0.0 (Fable, 2026-09-15). Run AC on 3.0.151: the same-day read now KEEPS the in-day
 * encounter (receipt parsed 1, dateFromListRows 1: axlistdate-1.0.0 works) and still refuses visit-bodies-incomplete
 * with expected 38 - the scoped ax coverage counted the FULL-HISTORY index population (vcensus-1.0.0, 3.0.118,
 * written for unscoped reads: "the fallback cannot shrink the known full-history population") against a day
 * read that harvested exactly the encounters athena lists on the briefing. A scoped day is complete when every
 * HARVESTED encounter was read and dated (axScannedAll already guards the cap); the unscoped population rule is
 * untouched. Latin1 seam, inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("            var axExpected = axOnlyDate ? Math.max(0, axKnown - axDateSkipped) : axKnown;",
    "            var axExpected = axOnlyDate ? Math.max(0, axTotalE - axDateSkipped) : axKnown; /* axscoped-1.0.0 (3.0.152): a scoped day counts the harvested encounters (every one read and dated, axScannedAll guards the cap), not the full-history index */", 'scoped expected');
let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30152: ' + edits.length + ' verified seams');

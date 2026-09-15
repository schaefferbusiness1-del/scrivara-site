'use strict';
/* MLS Assist 3.0.141 - qpstrip-2.1.0 (Fable, 2026-09-15). Measured with the 3.0.140 settle receipt on a hidden
 * pull: the classic day grid was STABLE at 48 rows (one look, first = final) and its section census printed
 * the doctor's procedure-room section with 8 rows, while a full-width tab prints the same section with 28 -
 * athena's dashboard lays the list out differently below desktop width and shows a subset of a long section.
 * The 760 px work window was the cause, not load timing. Cure: size the work window like a desktop viewport -
 * about 55% of the display work area, never narrower than 1280 px nor wider than 1500 px - still unfocused,
 * still at the right edge, still released to the original window and index afterwards. Latin1 seam, inverse
 * proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("      var W = 760, H = Math.max(600, Math.round(((wa && wa.height) || 900) * 0.85));",
    "      var W = Math.max(1280, Math.min(1500, Math.round(((wa && wa.width) || 2340) * 0.55))), H = Math.max(600, Math.round(((wa && wa.height) || 900) * 0.85)); /* qpstrip-2.1.0 (3.0.141): a desktop-width viewport - below it athena's day grid prints a subset of a long section (measured: 8 of 28 rows at 760 px) */", 'width');
let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30141: ' + edits.length + ' verified seams');

'use strict';
/* MLS Assist 3.0.145 - restorehome-1.2.0 (Fable, 2026-09-15). Runs T and V on the hidden work window: three rows
 * refused schedule-date-restore-failed whose refusal diag (navproof-diag) showed the re-ground's per-frame
 * answers: every frame found:false except the dashboard frame answering 'weekstrip: the calendar strip is present
 * but shows no day tabs (Day view not rendered)' - on all four tries, three seconds apart. After the Home click the
 * dashboard in the unfocused work window takes longer than the 12 s restorehome-1.1.0 allowed to paint its day
 * tabs (a fresh dashboard load measured 10-15 s to populate its frames). Run U, minutes apart, had zero such rows:
 * the wait is the only variable. Cure: keep retrying the date navigation while the ONLY answer is the empty strip,
 * up to ten tries (about 30 s), still under the absolute open deadline and still only while every other frame says
 * found:false; the refusal diag counts the tries. Latin1 seams, inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("          for (var rgTry = 0; rgTry < 4; rgTry++) {",
    "          for (var rgTry = 0; rgTry < 10; rgTry++) { /* restorehome-1.2.0 (3.0.145): up to ten tries (~30 s) while the only answer is the empty strip */", 'loop bound');
rep("if (rgVerified || !rgEmptyStripOnly || rgTry === 3) break;",
    "if (rgVerified || !rgEmptyStripOnly || rgTry === 9) break;", 'last try');
rep("regroundFrames: (regroundX.r || [])",
    "regroundTries: rgTry + 1, regroundFrames: (regroundX.r || [])", 'diag');
let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30145: ' + edits.length + ' verified seams');

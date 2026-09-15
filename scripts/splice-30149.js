'use strict';
/* MLS Assist 3.0.149 - nowindow-1.0.1 (Fable, 2026-09-15): the quiet-pull module header still described the
 * deleted work window ('strip' verdict, "move athena back to its original window"). Comment only; the code was
 * changed in 3.0.147. Single-line latin1 seams (the region's line terminator is untouched), inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep(" *     tab inside its window only when that displaces nothing the doctor is looking at;",
    " *     tab inside its window only when that displaces nothing the doctor is looking at", 'l1');
rep(" *     else (qpstrip-2.0.0, 3.0.135) move it once into an UNFOCUSED work window of its",
    " *     -> 'selected'. Still occluded -> 'limp': the read proceeds on the hidden tab under", 'l2');
rep(" *     own at the right edge of its display -> 'strip'. Still occluded -> 'limp': the",
    " *     the callers' own hidden-safe budgets and retries. nowindow-1.0.0 (3.0.147, owner:", 'l3');
rep(" *     read proceeds under the callers' own budgets and retries.",
    " *     \"snapping windows out is not reliable\"): no window is ever created, moved, resized", 'l4');
rep(" *   - qpRelease(): move athena back to its original window and index, preserving",
    " *     or focused; the 3.0.135-3.0.146 work window is gone.", 'l5');
rep(" *     whatever tab the doctor has selected - fired by end-of-run mlsAppFocusMlsTab, a",
    " *   - qpRelease(): end the lease (one exact tab per pull) - fired by end-of-run", 'l6');
rep(" *     120s quiet watchdog + alarms backstop (worker restarts), and before any write op.",
    " *     mlsAppFocusMlsTab, a 120s quiet watchdog + alarms backstop (worker restarts), the" +
    " 30 s sticky hand-back after the last verb (qpsticky-1.0.0), and before any write op.", 'l7');
let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30149: ' + edits.length + ' verified seams');

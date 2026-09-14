'use strict';
/* MLS Assist 3.0.134 - restorehome-1.1.0 (Fable, 2026-09-14). Measured on the 3.0.133 run: after
 * the Home step the dashboard frame now answers the restore, but its week strip had painted no
 * day tabs yet ("weekstrip: the calendar strip is present but shows no day tabs (Day view not
 * rendered)") and the single goto-date call refused. The restore now retries the date navigation
 * up to three more times, three seconds apart under the absolute open deadline, while every
 * answering frame reports only the empty strip. Byte-preserving latin1 seam with an inverse proof.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90)); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
const a1 = "          var regroundX = await execOpen({ target: { tabId: tab.id, allFrames: true }, args: [frozenScheduleDate, false, openGuard], func: mlsAthenaGotoDate }, 40000);";
const i1 = out.indexOf(a1); assert(i1 >= 0, 'goto seam'); const nl = out.indexOf('\n', i1); const N = (out[nl - 1] === '\r') ? '\r\n' : '\n';
rep(a1,
    "          /* restorehome-1.1.0 (3.0.134): right after Home the week strip can be present with no day" + N +
    "             tabs painted yet (measured); retry the date navigation a few times while that is the" + N +
    "             only answer, three seconds apart, under the absolute open deadline. */" + N +
    "          var regroundX = null;" + N +
    "          for (var rgTry = 0; rgTry < 4; rgTry++) {" + N +
    "            regroundX = await execOpen({ target: { tabId: tab.id, allFrames: true }, args: [frozenScheduleDate, false, openGuard], func: mlsAthenaGotoDate }, 40000);" + N +
    "            if (regroundX.timeout) break;" + N +
    "            var rgResults = (regroundX.r || []).map(function (entry) { return entry && entry.result; }).filter(Boolean);" + N +
    "            var rgVerified = rgResults.some(function (value) { return value.done === true && value.dateUnverified !== true; });" + N +
    "            var rgEmptyStripOnly = !rgVerified && rgResults.some(function (value) { return value.reason === 'weekstrip-empty'; }) && rgResults.every(function (value) { return value.reason === 'weekstrip-empty' || value.found === false; });" + N +
    "            if (rgVerified || !rgEmptyStripOnly || rgTry === 3) break;" + N +
    "            if (!(await waitOpen(3000))) { failOpenDeadline(stage || 'exact schedule restoration'); return false; }" + N +
    "          }", 'goto retry');
let restored = out;
for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30134: ' + edits.length + ' verified seam');

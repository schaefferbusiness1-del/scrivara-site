'use strict';
/* MLS Assist 3.0.135 follow-up seam: the v2.9.35 comment above the new work-window branch stated the
 * opposite policy ("a read must NEVER create, move, or resize a browser window"). A comment that
 * disagrees with the runtime is a defect (contract cleanup); rewrite it to the current law. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const a0 = "    /* v2.9.35 owner directive: a read must NEVER create, move, or resize a";
const i = before.indexOf(a0); assert(i >= 0 && before.split(a0).length === 2, 'unique start');
const endMark = "       and bounded retries, exactly like the covered-strip case before. */";
const j = before.indexOf(endMark, i); assert(j > i, 'end mark');
const nl = before.indexOf('\n', j); const N = (before[nl - 1] === '\r') ? '\r\n' : '\n';
const orig = before.slice(i, j + endMark.length);
const repl =
  "    /* qpstrip-2.0.0 (3.0.135, owner 2026-09-14: \"it shouldn't have to be visible to work\")." + N +
  "       Policy now: select the Athena tab inside its own window only when that displaces" + N +
  "       nothing the doctor is looking at; otherwise, or when the tab stays hidden anyway," + N +
  "       give it an UNFOCUSED work window of its own on its own display (qpMakeStrip). The" + N +
  "       doctor's window is never moved, resized, focused or re-selected; the awg-2.0.0" + N +
  "       wrapper clamps the work window to a real display; qpRelease moves the tab back to" + N +
  "       its original window and index when the run goes quiet. If the work window is still" + N +
  "       occluded the read proceeds 'limp' under the callers' budgets, as before. The older" + N +
  "       v2.9.35 rule (never create a window) is superseded by this owner instruction. */";
assert(before.split(repl).length === 1, 'replacement absent');
const out = before.slice(0, i) + repl + before.slice(j + endMark.length);
assert.strictEqual(out.replace(repl, () => orig), before, 'inverse restores');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30135b: comment rewritten');

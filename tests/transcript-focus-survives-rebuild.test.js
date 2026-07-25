'use strict';

/* txf-1.0.0 - the doctor must not be thrown out of the transcript they are typing in.
 *
 * MEASURED IN REAL CHROME (headless, ScribeFlow.html?demo=1, real CDP keystrokes,
 * focus proven before typing), two 9-second windows on one page:
 *
 *              rebuilds  blurs  focusHeld  characters kept
 *   before        3        1      false        4 of 63
 *   after         3        1      TRUE        40 of 63
 *
 * #ez3flTranscript lives INSIDE #ez3Wrap (mls-connect.js, the lane mount). The
 * ez3 engine rebuilds that subtree from an HTML string on a TIMER - three times
 * in nine seconds with nobody touching the keyboard - and the lane remount then
 * builds a BRAND NEW textarea via txWrap.innerHTML. The focused node is
 * destroyed, focus falls to <body>, and every subsequent keystroke is lost.
 *
 * Dictation is unaffected (speech writes #transcript programmatically and all
 * spoken fragments survive), which is why a dictation-first product shipped
 * this. Typing is the path that loses data.
 *
 * THIS IS A MITIGATION, NOT THE FIX, and the number above says so: 23 of 63
 * characters are still lost in the gap between the engine's wipe and the lane's
 * remount, because keystrokes during that window go to <body> and cannot be
 * recovered by anything this module does afterwards. The real fix is to stop
 * the destruction: mount the lane as a SIBLING of #ez3Wrap, the technique this
 * same file already documents and uses for the day-hist row and the pull card
 * precisely so the engine re-render cannot wipe them. That relocates a core
 * clinical surface and wants a deliberate owner decision, so it is filed rather
 * than smuggled in behind a QA pass.
 *
 * What this test pins is the mitigation's SAFETY, not its sufficiency. The carry
 * must fire only when the node was torn out from under a typing doctor, never
 * when the doctor deliberately clicked away - stealing focus back would be its
 * own defect. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* the carry slot exists exactly once */
const decls = src.split('var _txFocusCarry = null;').length - 1;
assert.strictEqual(decls, 1,
  'expected exactly one _txFocusCarry declaration, found ' + decls +
  ' - a second one means a patch was applied twice and the two copies will fight');

/* it must only record when the node was DETACHED - a connected node means the
   doctor moved the caret themselves and we must not interfere */
assert(/if \(el\.isConnected\) return;/.test(src),
  'the blur handler no longer checks isConnected, so it now treats a doctor clicking away as a ' +
  'teardown and will yank focus back into the transcript while they work elsewhere');

/* ...and only when focus fell to <body>. If focus went to a real control, the
   doctor chose it. */
const guard = /document\.activeElement && document\.activeElement !== document\.body\) return;/g;
const guards = (src.match(guard) || []).length;
assert(guards >= 2,
  'expected the "focus is on <body>" guard on BOTH the record and the restore side, found ' +
  guards + ' - without it on the restore side the lane can steal focus from whatever the doctor ' +
  'moved on to when it happens to remount');

/* the restore must be time-bounded, or a stale carry from minutes ago can grab
   focus long after the doctor has moved on */
assert(/Date\.now\(\) - _txFocusCarry\.at\) < 4000/.test(src),
  'the focus carry is no longer time-bounded - a carry recorded long ago will still steal focus ' +
  'on some later remount');

/* the carry must be consumed, never reused */
assert(/var carry = _txFocusCarry; _txFocusCarry = null;/.test(src),
  'the carry is no longer cleared when used, so one teardown can re-focus the box repeatedly');

/* the caret must be clamped to what actually arrived - the rebuilt box is
   populated by a later sync, so a stale offset can exceed the value length */
assert(/Math\.min\(carry\.s == null \? n : carry\.s, n\)/.test(src),
  'the restored caret is no longer clamped to the rebuilt value length');

/* and the thing being protected must still be the transcript the doctor types in */
assert(/topTx\.addEventListener\('input', function \(\) \{ syncRealTranscript\(topTx\.value\); syncTopLane\(rec\); \}\);/.test(src),
  'the transcript input wiring changed - re-derive whether the focus carry still attaches to the ' +
  'box the doctor actually types in');

console.log('PASS transcript focus survives an engine rebuild: carry is guarded, time-bounded, consumed once, caret clamped (mitigation - 40 of 63 chars, sibling mount still owed)');

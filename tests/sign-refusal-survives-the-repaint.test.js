'use strict';
/*
 * A REFUSAL THAT POINTS AT SOMETHING MUST NOT BE REPAINTED AWAY
 * -----------------------------------------------------------------------------
 * Owner, repeatedly: "why do u have to clikc review and sign twice".
 *
 * b819 answered the FIRST half: signNote() refuses while the note holds an
 * unresolved placeholder, and it now focuses the editor the doctor is actually
 * looking at and SELECTS the first blank, so his second press is a deliberate
 * act rather than a retry of a press that appeared to be ignored.
 *
 * b824 answers the second half, and it is the half that made the first one
 * useless on the control he actually presses. The visit card's "✔ Review &
 * Sign" (#ez3Sign) is driven from mls-connect.js, and that driver ended a
 * refusal with:
 *
 *     if (!lineSigned && !flagSigned) { render(); return; }
 *
 * render() rebuilds the lane SYNCHRONOUSLY inside the same click. #ez3flNote is
 * torn out of the DOM, focus falls to <body>, and the selection goes with it.
 * The doctor gets a toast and nothing moving - which is precisely the state
 * b819 existed to end. The live walkthrough did not catch it because it presses
 * #signBtn; #ez3Sign is the button on the card in front of him.
 *
 * WHY THIS SUITE IS SOURCE-LEVEL. #ez3Sign only exists in the engine's card
 * state - it is absent while the advanced workspace is open, which is where the
 * walkthrough necessarily is by the time it has a note to sign - so no harness
 * in this repo can press it end to end. What CAN be pinned, exactly, is that no
 * copy of the driver repaints a placeholder refusal, and that all four copies
 * agree. Four is not a typo: mls-connect.js carries four byte-identical
 * generations of this handler, and fixing one is how a fix ships to a screen
 * nobody is looking at.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- 1. every copy of the driver guards its repaint ---------------------- */

const OLD = /if \(!lineSigned && !flagSigned\) \{ render\(\); return; \}/g;
assert.strictEqual((connect.match(OLD) || []).length, 0,
  'a copy of the sign driver still calls render() unconditionally on a refusal. That repaint ' +
  'destroys #ez3flNote in the same click, taking the selection the refusal just made with it, ' +
  'and the doctor sees a toast with nothing moving - the "press it twice" report.');

const guards = connect.match(/if \(!lineSigned && !flagSigned\) \{[\s\S]{0,900}?\n      \}/g) || [];
assert.strictEqual(guards.length, 4,
  `expected 4 guarded sign drivers in mls-connect.js, found ${guards.length}. This file carries ` +
  'four byte-identical generations of the handler; they must be fixed together or the fix lands ' +
  'on a screen nobody uses.');

guards.forEach((g, i) => {
  assert.match(g, /opNoteBlankTokens/,
    `sign driver ${i + 1} no longer asks whether the note holds a blank, so it cannot tell a ` +
    'placeholder refusal (which pointed the doctor at something) from the other refusals.');
  assert.match(g, /if \(!heldABlank\) render\(\);/,
    `sign driver ${i + 1} lost the guarded repaint. Every OTHER refusal - already signed, a ` +
    'patient-binding refusal, a save that un-signed itself - must still repaint, because those ' +
    'can leave stale signed affordances on screen.');
});

/* ---- 2. the refusal reaches the editor the doctor can see ---------------- */

const eds = /var _eds=\[([^\]]+)\]/.exec(app);
assert.ok(eds, 'the sign refusal no longer builds a candidate editor list');
['ez3flNote', 'ez3Note', 'noteBox'].forEach((id) => {
  assert.ok(eds[1].indexOf(`'${id}'`) >= 0,
    `#${id} is missing from the sign refusal's candidate editors. Each one is the ONLY visible ` +
    'note editor in some real state: #ez3flNote in the visit lane, #ez3Note on a phone (where ' +
    'body.mls-phone hides the lane record row AND the advanced toggle), #noteBox in the advanced ' +
    'workspace. Drop one and the refusal selects a blank inside a display:none subtree, where ' +
    'focus() and setSelectionRange() are silent no-ops.');
});
assert.ok(eds[1].indexOf("'ez3flNote'") < eds[1].indexOf("'noteBox'"),
  'the candidate order no longer prefers the lane editor over #noteBox. #noteBox lives inside the ' +
  'advanced workspace, which is closed by default, so trying it first is what shipped the bug.');

/* the scan must pick the first VISIBLE candidate, not simply the first one */
const scan = /for\(_ei=0;_ei<_eds\.length;_ei\+\+\)\{[\s\S]{0,400}?\}/.exec(app);
assert.ok(scan, 'the visible-editor scan is gone');
assert.match(scan[0], /display!=='none'[\s\S]*visibility!=='hidden'[\s\S]*width>0[\s\S]*height>0/,
  'the scan no longer tests real visibility, so it can select a blank in an editor the doctor ' +
  'cannot see - which is the whole defect.');

/* ---- 3. a refusal still writes nothing ----------------------------------- */

const block = /SELECT IT IN THE EDITOR HE IS ACTUALLY LOOKING AT[\s\S]*?\}catch\(_eSel\)\{\}/.exec(app);
assert.ok(block, 'the refusal block is gone');
assert.doesNotMatch(block[0], /\.value\s*=/,
  'the sign refusal now writes to a note editor. A refused signature must change not one ' +
  'character of the medical record - selection and focus only.');

console.log('PASS sign refusal survives the repaint: 4 sign drivers guard their repaint, ' +
  '3 candidate editors in visible-first order, and a refusal still writes nothing.');

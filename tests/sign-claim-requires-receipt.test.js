'use strict';

/* "Note signed & saved in MLS" may only be said when the note was signed.
 *
 * MLS Easy's Sign control proxied the engine's real Sign button and then told
 * the doctor it had worked, without ever reading whether it had:
 *
 *     sb.click(); S.signedAt = Date.now();
 *     toast('Note signed & saved in MLS.'); render();
 *
 * signNote() (ScribeFlow.html) is synchronous and refuses in four places that
 * only toast and return: already-signed, a patient-binding refusal
 * (_athenaGuardBoundEditor), unresolved note placeholders, and a save that did
 * not return true — where it explicitly UN-signs itself via setBadge(false) and
 * hides the signature line.
 *
 * On every one of those the workspace still set S.signedAt, which is its ONLY
 * signed flag, so the card painted "Signed & saved in MLS" and replaced the
 * Sign button with Send to Athena / Next patient. The green claim rendered on
 * #ez3Toast while the engine's red refusal sat on #toast — two anchors, both on
 * screen, the same shape as the b569 Athena toast that told doctors a note had
 * reached Athena when it had not. On the saveCurrentNote branch the note is not
 * merely unsigned, it is unsaved.
 *
 * FOUR generational copies of the handler exist in the bundle. All four are
 * gated, and the count is pinned: a new copy added without the gate fails here,
 * which is what the b569 five-copy fix had to learn the hard way. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* 1. the unconditional claim must not exist anywhere */
const unconditional = (connect.match(/sb\.click\(\); S\.signedAt = Date\.now\(\);/g) || []).length;
assert.strictEqual(unconditional, 0,
  'a Sign proxy sets S.signedAt straight after sb.click(), so it claims "signed & saved" ' +
  'on all four of signNote()\'s refusal paths');

/* 2. every copy reads a receipt before claiming, and there are still four.
      b824 widened the body of this gate - a placeholder refusal must no longer
      repaint, because the repaint destroyed the editor the refusal had just
      selected a blank in (see sign-refusal-survives-the-repaint.test.js). The
      GATE ITSELF is untouched and is what this suite is about: the early return
      on "no signature line and no signed flag" still guards every claim below.
      So the pin moves from the whole one-line statement to the condition, and a
      companion assertion keeps the early return honest. */
const gated = (connect.match(/if \(!lineSigned && !flagSigned\) \{/g) || []).length;
assert.strictEqual(gated, 4,
  'expected all 4 generational copies of the ez3Sign handler to be receipt-gated, found ' + gated +
  ' — a new copy without the gate reintroduces the defect');

const gateBodies = connect.match(/if \(!lineSigned && !flagSigned\) \{[\s\S]{0,900}?\n      \}/g) || [];
assert.strictEqual(gateBodies.length, 4, 'a receipt gate lost its block form');
gateBodies.forEach((body, i) => {
  assert.match(body, /\breturn;/,
    `receipt gate ${i + 1} no longer returns, so execution falls through to the ` +
    '"Note signed & saved in MLS." claim on a refusal — the exact defect this suite exists for.');
});

const claims = (connect.match(/toast\('Note signed & saved in MLS\.'\); render\(\);/g) || []).length;
assert.strictEqual(claims, gated,
  'every "Note signed & saved" claim must be preceded by its own receipt gate');

/* 3. the receipt must be the two signals signNote itself maintains */
assert((connect.match(/var lineSigned = !!\(line && line\.style\.display !== 'none'/g) || []).length === 4,
  'the signature-line receipt is missing from a copy');
assert((connect.match(/typeof signed !== 'undefined' && signed === true/g) || []).length === 4,
  "the engine's signed-flag receipt is missing from a copy");

/* 4. and those signals must still mean what we think they mean.
      If the engine stops un-signing on a failed save, the line receipt goes
      stale and this gate would start passing refusals through. */
assert(/if\(saveCurrentNote\(false\)!==true\)\{ setBadge\(false\); line\.style\.display='none';/.test(shell),
  'signNote() no longer un-signs on a failed save, so the signature-line receipt can no longer be trusted');
assert(/function setBadge\(s\)\{[\s\S]{0,120}signed=s;/.test(shell),
  'setBadge no longer writes the signed flag, so the flag receipt can no longer be trusted');
assert(/if\(currentVisitAthenaBinding&&!_athenaGuardBoundEditor\('signing this note'\)\) return;/.test(shell),
  'the patient-binding refusal disappeared from signNote — re-check what this gate must cover');

console.log('PASS sign claim requires a receipt: 4/4 Sign proxies assert from signNote\'s own signature line and signed flag, never from the click');

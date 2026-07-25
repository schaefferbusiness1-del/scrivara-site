'use strict';

/* A scope chip that says WHOSE numbers you are reading must not be clipped.
 *
 * The analysis view stamps a chip — "PRACTICE-WIDE · ALL PROVIDERS COMBINED",
 * "PROVIDER VIEW" — onto each section heading. Measured on the running page at
 * 375px, in the untouched preview state:
 *
 *   body scrollWidth 515 vs viewport 375
 *   5 of 8 rendered chips past the right edge, worst at 515px
 *   body{overflow-x:hidden}, so they were CLIPPED and not scrollable
 *
 * On a phone that renders as "PRACTICE-WI…", which still reads as an answer
 * while hiding which answer it is. A partial scope label is worse than none.
 *
 * The cause is a flex-item default, not a width: white-space:nowrap plus
 * min-width:auto forbids shrinking below content width. So this suite asserts
 * the ESCAPE (min-width:0 under a narrow media query), not a pixel number —
 * pixels depend on the label text, which is allowed to change.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

/* the chip's base rule still declares the nowrap that makes the escape necessary */
const base = /\.mls-anaclar-chip\{[^}]*\}/.exec(src);
assert.ok(base, 'the analysis scope chip lost its base rule');

if (/white-space:\s*nowrap/.test(base[0])) {
  /* nowrap is fine — but then a narrow-screen escape MUST exist */
  const narrow = /@media\s*\(max-width:\s*\d+px\)\s*\{\s*\.mls-anaclar-chip\{([^}]*)\}/.exec(src);
  assert.ok(
    narrow,
    'the scope chip is white-space:nowrap with no narrow-screen rule. At 375px ' +
    'it ran to 515px and was clipped by body{overflow-x:hidden} — the label ' +
    'saying whether a number is practice-wide or provider-specific was cut off.'
  );
  assert.ok(
    /min-width:\s*0/.test(narrow[1]),
    'the narrow-screen chip rule does not set min-width:0. That is the operative ' +
    'part: a flex item defaults to min-width:auto, which forbids shrinking below ' +
    'its content width, so white-space:normal alone will not stop the overflow. ' +
    'Found: ' + narrow[1]
  );
  assert.ok(
    /white-space:\s*normal/.test(narrow[1]),
    'the narrow-screen chip rule must also release nowrap, or the chip can ' +
    'shrink its box without reflowing its text. Found: ' + narrow[1]
  );
}

/* the fix must not have been "make it fit by hiding the overflow" */
assert.ok(
  !/\.mls-anaclar-chip\{[^}]*text-overflow:\s*ellipsis/.test(src),
  'the scope chip must never be truncated with an ellipsis — a half-read scope ' +
  'label still reads as an answer. Let it wrap instead.'
);

/* and the guard must be able to fail */
{
  const broken = ".mls-anaclar-chip{white-space:nowrap;padding:2px 9px}";
  const narrow = /@media\s*\(max-width:\s*\d+px\)\s*\{\s*\.mls-anaclar-chip\{([^}]*)\}/.exec(broken);
  assert.strictEqual(
    narrow, null,
    'the narrow-rule detector matches a stylesheet that has no narrow rule — ' +
    'it would pass regardless of the file'
  );
}

console.log('PASS analysis-scope-chip-fits-a-phone: the chip that names the scope ' +
  'can shrink and wrap under 760px, and is never ellipsised');

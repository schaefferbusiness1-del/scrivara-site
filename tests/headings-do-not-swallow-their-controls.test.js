'use strict';
/* A heading that contains buttons is announced as its title WELDED to every
 * button label.
 *
 * Measured on the running app (headless Chrome, ?demo=1) on 2026-07-26 at
 * b672 — nine VISIBLE card headings did this, and this static scan then found
 * thirteen more in views the runtime probe never reached (team, legal, studio
 * result, pinned widget). Twenty-two in total. The worst:
 *
 *   <h2> "Visit history" + 5 buttons
 *   announced as: "Visit history New visit Schedule follow-up Pull chart from
 *                  AthenaREAD-ONLYP..."
 *
 * A heading's accessible name is computed from its contents, so every action
 * button in the title row became part of the section's name. This is the same
 * accessible-name welding class that has been recorded against this codebase
 * before (textContent welds block children); here it is the AX name rather
 * than a text scrape, and Chrome's own Accessibility.getFullAXTree confirmed
 * both the defect and the fix.
 *
 * THE FIX IS aria-label, NOT RESTRUCTURING, and that was a deliberate call:
 * `.card>h2` and `.card>h2 .ic` use the DIRECT-CHILD combinator, so wrapping
 * the h2 in an actions row would silently drop its 19px size and the 30px
 * rounded .ic badge — a visual regression with no error anywhere. Verified
 * after the change that heading rect, font-size, weight, .ic badge size and
 * EVERY button rect are byte-identical to the same build with the attribute
 * stripped at runtime.
 *
 * This gate is static because the defect is static: the markup either gives
 * the heading a name or it lets the buttons write one.
 *
 * Negative-tested both directions before being trusted (the b669 rule):
 * removing any one aria-label fails by heading title; adding a new button to a
 * labelled heading still passes; adding a button to an UNLABELLED heading
 * fails. It passes on the real tree.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');

/* Every <h2>...</h2> block, including the multi-line ones. */
const blocks = src.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/g) || [];
assert(blocks.length > 20, 'found only ' + blocks.length + ' <h2> blocks — the scan is wrong, not the tree');

const CONTROL = /<(?:button|select|input)\b/i;

const offenders = [];
let guarded = 0;
for (const b of blocks) {
  if (!CONTROL.test(b)) continue;                 // no controls inside: nothing to weld
  const open = b.match(/<h2\b[^>]*>/)[0];
  if (/\saria-label\s*=\s*"[^"]+"/.test(open)) { guarded++; continue; }
  if (/\saria-labelledby\s*=\s*"[^"]+"/.test(open)) { guarded++; continue; }
  /* name it by the text a reader would call the section, so the failure is
     actionable rather than a line number in a 24k-line file */
  const title = b
    .replace(/<h2\b[^>]*>/, '')
    .replace(/<(?:button|select|input)\b[\s\S]*?(?:<\/(?:button|select)>|>)/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  offenders.push('  "' + title + '"  — has controls inside the heading and no aria-label');
}

assert.deepStrictEqual(offenders, [],
  'a card heading contains its own action controls but has no explicit accessible name, so screen\n' +
  'readers announce the section title welded to every button label inside it.\n' +
  'Add aria-label="<the title alone>" to the <h2>. Do NOT move the buttons into a sibling row:\n' +
  '.card>h2 and .card>h2 .ic are direct-child selectors and the heading would lose its size and badge.\n' +
  offenders.join('\n'));

assert(guarded >= 22,
  'expected at least the 22 welded headings found at b672 to carry an explicit accessible name, found ' +
  guarded + '. Nine of those were VISIBLE in the runtime probe; the other thirteen live in views the\n' +
  'probe never reached (team, legal, studio result, pinned widget) and were found by this static scan —\n' +
  'which is the argument for the gate being static. If a heading legitimately lost its controls, lower\n' +
  'this number deliberately and say why.');

console.log('PASS headings do not swallow their controls: ' + blocks.length + ' <h2> blocks scanned, ' +
  guarded + ' heading(s) with controls carry an explicit accessible name, 0 unguarded');

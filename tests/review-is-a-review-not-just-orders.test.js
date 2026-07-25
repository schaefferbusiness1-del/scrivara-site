'use strict';

/* "Actually make Review review, not just orders." — the owner, 2026-07-25.
 *
 * The dock destination was:
 *     { id:'review', label:'Review', targets:['nav_orders','nav_recs'] }
 * and destTarget() takes the FIRST available target, so Review landed on
 * Orders. The segmented row only appears when more than one target is
 * available, so on an account without Recommendations, Review WAS Orders —
 * a differently-named door to the same room.
 *
 * Worse, two rows above it the stage bar runs Prep · Record · REVIEW · Sign ·
 * Send, where Review means review-the-note. One word, two meanings, one screen.
 *
 * The note is reached through nav_visit, which is why it is `extra` and not a
 * target. As a target it would (a) become the landing tab, duplicating the
 * Visit dock item, and (b) keep Review alive on accounts with neither orders
 * nor recommendations — a destination that exists only to re-enter the view
 * you are already in. Those two properties are what this suite pins.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_calm_shell.js'), 'utf8');

/* ---- 1. Review offers the note, and offers it as an extra ---- */
const review = /\{\s*id:\s*'review'[\s\S]{0,400}?\}/.exec(src);
assert.ok(review, 'the review destination is gone from DEST');

assert.ok(
  /extra:\s*\[[^\]]*'nav_visit'/.test(review[0]),
  'Review no longer offers the note. It was named Review and went to Orders ' +
  'while the stage bar used Review to mean review-the-note.'
);
assert.ok(
  !/targets:\s*\[[^\]]*'nav_visit'/.test(review[0]),
  'nav_visit became a real TARGET of Review. As a target it becomes the landing ' +
  'tab (duplicating the Visit dock item) and keeps Review alive on accounts with ' +
  'no orders and no recommendations. It must stay in `extra`.'
);
assert.ok(
  /targets:\s*\[\s*'nav_orders'/.test(review[0]),
  'Review must still LAND on Orders — this change adds a room, it does not move the door'
);
assert.ok(
  /as:\s*\{[^}]*nav_visit:\s*'The note'/.test(review[0]),
  "the nav_visit segment must be re-labelled 'The note'. Unlabelled it renders " +
  "as the rail tab's own text ('Today'), which inside Review means nothing."
);

/* ---- 2. an extra must never decide landing or survival ---- */
assert.ok(
  /function destTarget\(d\)\s*\{\s*return destTargets\(d\)\[0\]/.test(src),
  'destTarget() must keep reading destTargets(), not destSegments() — otherwise ' +
  'an extra becomes the landing tab'
);
const segFn = /function destSegments\(d\)\{?[\s\S]{0,600}?\n  \}/.exec(src);
assert.ok(segFn, 'destSegments() is missing');
assert.ok(
  /if \(!real\.length[^)]*\) return real;/.test(segFn[0]),
  'destSegments() must return nothing when the destination has no REAL target. ' +
  'Otherwise Review survives on the note alone and becomes a second Visit button.'
);
assert.ok(
  /available\(/.test(segFn[0]),
  'destSegments() must filter extras through available() — a rail tab the account ' +
  'is not entitled to must never be proxied. See the .click()-on-hidden-elements note.'
);

/* ---- 3. an aliased segment discloses the control it opens ----
 * The shell already had an honest alias idiom for the right-now buttons —
 * `p.as || controlLabel(p.el)` plus a title reading 'Runs "X" on this screen'.
 * The first version of this change invented a parallel segmentLabel() helper
 * instead, and shell-label-authority-contract caught it. Segments now use the
 * same idiom: alias for the label, real control name disclosed in the title.
 * An alias without disclosure is the shell claiming authorship of a control it
 * only proxies. */
assert.ok(
  /s\.textContent = alias \|\| controlLabel\(tab\)/.test(src),
  'the segment label must still fall back to controlLabel() — an alias may ' +
  'override the text, never replace the authority'
);
assert.ok(
  /if \(alias\) s\.title = 'Opens "' \+ controlLabel\(tab\)/.test(src),
  'an aliased segment must disclose the real control in its title. Without it, ' +
  '"The note" is the shell renaming a rail tab it does not own.'
);

/* ---- 4. Sign is still never proxied ---- */
assert.ok(
  !/signBtn/.test(src),
  'the calm shell must never reference #signBtn. Sign is a trusted-gesture, ' +
  'human-only control — Review may navigate you TO the note, never sign it.'
);

/* ---- 5. the guard can fail ---- */
{
  const broken = "{ id: 'review', label: 'Review', targets: ['nav_orders','nav_recs'] }";
  assert.ok(
    !/extra:\s*\[[^\]]*'nav_visit'/.test(broken),
    'the extra-detector matches a destination with no extra — it would pass regardless'
  );
}

console.log('PASS review-is-a-review-not-just-orders: Review offers the note, orders and ' +
  'recommendations; the note never becomes its landing tab, never keeps it alive alone, ' +
  'and Sign is never proxied');

'use strict';

/* The review control must not come to rest UNDER the floating bubble.
 *
 * b666 fixed "pressing Review did nothing you could see" by scrolling the send
 * control into view with scrollIntoView({block:'nearest'}). 'nearest' is by
 * definition the MINIMUM scroll, so a control below the fold lands with its
 * bottom FLUSH to the viewport bottom — and that is precisely where the merged
 * Copilot bubble lives, position:fixed in the bottom-left corner.
 *
 * Measured at b668 on a real Chrome, 1400x900, bubble in its CLOSED resting
 * state, after pressing "Next: Review & send to Athena":
 *
 *     #pushAllEmrBtn   rect top=860 bottom=900   margin below = 0px of 900
 *     7 of 9 sample points across the button were owned by #mlsCopVoiceBtn
 *     a real trusted click at its centre (316,880) was received by the BUBBLE
 *
 * So the app revealed the last human gate before Athena, told the doctor to
 * press it, and the mouse could not reach it. (Keyboard was unaffected — focus
 * lands on the control, so Enter always worked. That is exactly why this went
 * unnoticed: every automated check that asserts focus passed.)
 *
 * b669 fixes it by reserving the overlapping fixed furniture as
 * scroll-margin-bottom before scrolling, so 'nearest' comes to rest clear of it.
 *
 * WHY THIS TEST EXISTS: that fix degrades SILENTLY. The clearance is computed by
 * looking up element ids; if the bubble is renamed, every lookup returns null,
 * clearance falls to 0, and the behaviour reverts to the measured defect with no
 * error, no warning, and a green suite. This test makes the rename loud.
 *
 * It deliberately does NOT assert pixel geometry — that needs a browser, and the
 * probe that found this lives outside the suite. It asserts the two things that
 * can rot in the source: the guard is still there, and the ids it depends on are
 * still real.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'latin1');

/* Scan every shipped module, not just mls-connect + ScribeFlow. The bubble is
   built in feat_mls_voice_cluster.js, so a narrower haystack reported the id as
   missing on a perfectly healthy tree — a false alarm that would have trained
   the next person to delete this test rather than read it. */
const SHIPPED = fs.readdirSync(ROOT)
  .filter(f => (/\.js$/.test(f) || /^ScribeFlow\.html$/.test(f)))
  /* mls-connect.js is excluded here and folded in separately BELOW with the
     REVIEW_FIXED_FURNITURE declaration excised — including it whole would let the
     list prove its own ids exist, which is exactly the circularity that made the
     first version of this test pass on the regression it was written to catch. */
  .filter(f => f !== 'sw.js' && f !== 'mls-connect.js');
const app = SHIPPED.map(f => {
  try { return fs.readFileSync(path.join(ROOT, f), 'latin1'); } catch (e) { return ''; }
}).join('\n');

/* ---- 1. the guard still exists ---------------------------------------- */

assert.ok(/REVIEW_FIXED_FURNITURE\s*=\s*\[/.test(connect),
  'REVIEW_FIXED_FURNITURE is gone from mls-connect.js. openReviewStep sizes its scroll ' +
  'clearance from this list; without it the review control lands flush with the bottom ' +
  'edge, under the floating bubble, and the mouse cannot reach it (measured b668: 7 of 9 ' +
  'points across the button owned by #mlsCopVoiceBtn).');

assert.ok(/scrollMarginBottom/.test(connect),
  'openReviewStep no longer sets scrollMarginBottom. That property is the entire mechanism ' +
  "that keeps scrollIntoView({block:'nearest'}) from parking the review control underneath " +
  'the floating bubble. Without it the b668 defect returns.');

assert.ok(/var\s+covered\s*=/.test(connect),
  'The "covered" test is gone from openReviewStep. Being covered is the same failure to a ' +
  'doctor as being off-screen — the button is on screen and still unpressable — so it has ' +
  'to earn the same scroll. Only checking `offscreen` lets a covered control sit there.');

/* ---- 2. every id it depends on is real --------------------------------- */

const listMatch = connect.match(/REVIEW_FIXED_FURNITURE\s*=\s*\[([^\]]*)\]/);
assert.ok(listMatch, 'could not parse the REVIEW_FIXED_FURNITURE list');
const ids = listMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

assert.ok(ids.length > 0,
  'REVIEW_FIXED_FURNITURE is empty, so the computed clearance is always 0 and the review ' +
  'control goes straight back to landing under the bubble.');

/* The list's OWN declaration must not count as evidence that its ids are real.
   First cut of this test searched `connect + app` intact, so a renamed id matched
   the very line that renamed it — the check passed on the exact regression it was
   written to catch. Excise the declaration before looking anywhere else. */
const haystack = connect.replace(/REVIEW_FIXED_FURNITURE\s*=\s*\[[^\]]*\]/, '') + app;
const missing = ids.filter(id => {
  /* the bubble is built in JS, so accept either an id="..." in the HTML or the
     id string appearing where the element is created/looked up */
  const asAttr = new RegExp('id\\s*=\\s*["\']' + id + '["\']');
  const asString = new RegExp('["\']' + id + '["\']');
  return !asAttr.test(haystack) && !asString.test(haystack);
});

assert.deepStrictEqual(missing, [],
  'REVIEW_FIXED_FURNITURE names element ids that no longer exist anywhere: ' + missing.join(', ') +
  '. This is the silent-failure mode this test was written for: the lookup returns null, the ' +
  'clearance computes to 0, the review control parks under the floating bubble again, and ' +
  'nothing anywhere reports an error. If the bubble was renamed, update the list to match.');

console.log('PASS review-control-clears-fixed-furniture (' + ids.length + ' furniture ids, all real)');

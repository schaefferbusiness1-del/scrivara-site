'use strict';

/* When the app blocks a doctor, the one message it gives them must name a place
 * that exists.
 *
 * feat_mls_premium_gate.js told them:
 *
 *     "<feature> is a Premium feature. Your plan keeps everything else —
 *      upgrade to Premium in Settings to unlock it."
 *
 * Settings has no upgrade control. Measured on the running page at b600: the
 * settings modal holds 12,935 characters of text, the word "upgrade" does not
 * appear in it once, and scanning every button, link and select inside it for
 * upgrade / plan / premium / billing returns ZERO controls. So the only
 * instruction a blocked doctor receives sent them somewhere that cannot help,
 * with nothing there to tell them they had arrived at the wrong place — the
 * same shape as the retired-page phone number in the patient portal, where
 * office() read a key only a retired page ever wrote.
 *
 * The app DOES have a working route: showUpsell() in mls-connect.js opens an
 * overlay with an <a href="/index.html#pricing">. It is module-local and not
 * exported — window.__mlsShowUpsell is undefined on the running page — so this
 * module cannot call it. Naming the destination is the honest fix available
 * here. Wiring the toast to that overlay needs the export and belongs with
 * mls-connect.js, not with a text change.
 *
 * IF someone later adds a genuine upgrade control to Settings, this test should
 * be updated deliberately, with the new control named — not deleted. The
 * invariant is "the block names a route that exists", not "never say Settings".
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gate = fs.readFileSync(path.join(root, 'feat_mls_premium_gate.js'), 'utf8');

/* ---- the SECOND instance, which this suite could not see ----
 * This file read feat_mls_premium_gate.js, public-publication-boundary.test.js
 * and mls-connect.js — and never ScribeFlow.html. So the identical sentence
 * survived in the app shell itself:
 *
 *   ScribeFlow.html:10430        "Upgrade in Settings to unlock the full app."
 *   ScribeFlow-staging.html:8395  same
 *
 * That is the Lite guard in showView(): every Lite user navigating anywhere
 * outside the visit was sent to a Settings screen measured at b600 as 12,935
 * characters containing the word "upgrade" zero times and zero upgrade controls.
 *
 * Fixing one instance and leaving another is how this defect class survives, so
 * the suite now checks every shipped surface that can block a user, not just the
 * one that was caught first. Staging is included deliberately — it drifted from
 * production seven times in a single day by being forgotten. */
for (const file of ['ScribeFlow.html', 'ScribeFlow-staging.html']) {
  const shell = fs.readFileSync(path.join(root, file), 'utf8');
  const blocks = shell.match(/toast\('[^']*Lite plan[^']*'/g) || [];
  assert(blocks.length, file + ': the Lite block message is gone — if the guard was ' +
    'removed that is fine, but confirm Lite users are not silently redirected instead');
  for (const b of blocks) {
    assert(!/\bin Settings\b/i.test(b),
      file + ': a Lite block still points at Settings, which has no upgrade control.\n  ' + b);
    assert(/home page|pricing|plans/i.test(b),
      file + ': a Lite block names no destination at all.\n  ' + b);
  }
}

/* Assert on the MESSAGE STRING, never on the file: the fix's own rationale
   comment quotes the old wording to explain it, so a file-wide scan for
   "upgrade … in Settings" matches the comment and fails forever. That is the
   same trap as banning a phrase whose explanation contains it. */
const msg = /toast\(\s*featureName \+ "([^"]+)"/.exec(gate);
assert(msg, 'the premium block no longer carries a user-facing message');

assert(!/\bin Settings\b/i.test(msg[1]),
  'the premium block tells the doctor to upgrade "in Settings", and Settings has no upgrade ' +
  'control — that is a dead end. Name a route that exists, or add the control and update this test.\n' +
  'message was: "' + msg[1] + '"');

/* and it must still say where to go */
assert(/home page|pricing|plans/i.test(msg[1]),
  'the premium block no longer names anywhere to go: "' + msg[1].slice(0, 120) + '"');

/* the route it names must be one the app actually serves. index.html is in
   PUBLIC_HTML and carries the pricing section the real upsell links to. */
const boundary = fs.readFileSync(path.join(root, 'tests', 'public-publication-boundary.test.js'), 'utf8');
assert(/'index\.html'/.test(boundary),
  'index.html is no longer a published page, so "the MLS home page" is no longer a real route');

const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
assert(/href="\/index\.html#pricing"/.test(connect),
  "the app's own upsell no longer links to /index.html#pricing — re-check where a blocked doctor should be sent");

console.log('PASS premium block names a real route: no upgrade path points at a Settings control that does not exist');

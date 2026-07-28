'use strict';

/* THE PULL-VISITS CHOICE HAS A HOME AGAIN (b743, owner live report 2026-07-27).
 * The "Full visit notes" checkbox beside Pull today was hidden by the Calm
 * Shell declutter (body.mls-calm #mlsDsStrip > #mlsDsVisitTgl, !important) —
 * proven live via document.styleSheets + el.matches on the owner's session,
 * where the toggle computed display:none while the code still shipped it.
 * That silently took the ONLY control over the slow-but-complete bodies lane.
 * The owner asked for it back as its own clearly separated option — NOT next
 * to the pull button. It now lives in Settings -> Integrations. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const calm = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'latin1');

/* The Settings control exists, in the integrations card, NOT in the day strip. */
const idx = app.indexOf('id="setPullVisitBodies"');
assert(idx > 0, 'the restored Settings checkbox is missing');
const followIdx = app.indexOf('id="athenaFollowToggle"');
assert(followIdx > 0 && Math.abs(idx - followIdx) < 4000,
  'the option lives in the same Settings integrations card as the extension controls');
assert(!/mlsDsStrip[\s\S]{0,600}setPullVisitBodies/.test(app),
  'the restored control must NOT sit beside the pull button');

/* One stored truth, both consumers served. 2026-07-28: the shared truth is
   the tri-state pullVisitBodiesPref() — DEFAULT ON, a recorded human choice
   (the pullVisitBodiesSet marker) respected in both directions, the legacy
   code-authored '0' ignored. Execution-proven in
   tests/pull-visit-bodies-default-on.test.js; source-pinned here. */
const fn = app.slice(app.indexOf('function pullVisitBodiesPref()'), app.indexOf('TWO-FACTOR AUTH (enrollment'));
assert(fn.includes("localStorage.getItem(uns('pullVisitBodies'))"), 'reads the same per-account key the importer reads');
assert(fn.includes("localStorage.setItem(uns('pullVisitBodies'), cb.checked?'1':'0')"), 'writes the key the importer consults');
assert(fn.includes("localStorage.setItem(uns('pullVisitBodiesSet'),'1')"), 'a human change must record the human-choice marker');
assert(fn.includes("getElementById('mlsDsVisitBodies')") && fn.includes('inline.checked=cb.checked'),
  'mirrors the inline node the phone-relay job payload reads');
assert(fn.includes('cb.checked=pullVisitBodiesPref()'), 'the checkbox renders the shared tri-state truth');
assert(fn.includes("return set ? raw!=='0' : true"), 'default is ON unless a recorded human choice says otherwise (2026-07-28 supersession of the 2026-07-21 fast-lane default)');
assert(/renderTwofaSettings\(\);\s*\n\s*renderPullVisitBodiesSetting\(\);/.test(app),
  'the Settings open pipeline renders it');

/* The relationship is deliberate: the calm shell may keep hiding the INLINE
 * toggle only because Settings now owns the choice. If the calm-shell hide is
 * ever removed, this pin goes with it consciously, not by accident. */
assert(/mlsDsVisitTgl/.test(calm), 'the calm-shell hide of the inline toggle is the reason this Settings option exists');
assert(connect.includes('id="mlsDsVisitBodies"'), 'the inline checkbox node must keep existing for the relay lane');

console.log('PASS pull-visits setting restored: separated Settings home, one stored truth, inline node mirrored, bodies-on default with human choice respected');

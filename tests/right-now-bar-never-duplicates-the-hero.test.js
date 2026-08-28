'use strict';

/* THE RIGHT-NOW BAR NEVER RE-OFFERS A VISIBLE PRIMARY - owner-escalated
 * 2026-07-26 ("I've asked many times"): the bar rendered "Start Recording -
 * <patient> . <dob> . ..." at 734x37 directly above the 720x82 visit hero
 * offering the SAME action in the SAME words. b685 already established the
 * ruling for the patient screen (ACTIONS.patient = [], "not a list waiting
 * to be filled back in"); vf-1.0.0 gives the visit view one state-driven
 * primary at hero size for EVERY phase, so the visit list joins it. Laws 3,
 * 4, 15 of REDESIGN_CONTRACT_2026-07-26.md.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

const actionsAt = shell.indexOf('var ACTIONS = {');
assert(actionsAt !== -1, 'the right-now ACTIONS map must exist');
const actionsBlock = shell.slice(actionsAt, shell.indexOf('function findControl', actionsAt));

assert(/patient:\s*\[\]/.test(actionsBlock),
  'ACTIONS.patient must stay empty (b685 ruling)');
assert(/visit:\s*\[\]/.test(actionsBlock),
  'ACTIONS.visit must stay empty - the visit hero is the one offer of every visit action (owner, 2026-07-26)');
assert(!/label:\s*\/[^\n/]*(start|record|begin|generate|sign)/i.test(actionsBlock),
  'no right-now label SPEC may re-offer a visit action (comments are free, code is not)');

/* The bar itself stays: on destinations with segments it is navigation, and
 * the day view keeps its exit-first actions ("Back to the calendar"). */
assert(/day:\s*\[/.test(actionsBlock), 'the day view keeps its exit-first actions');
assert(shell.includes("bar.classList.toggle('empty', empty)"),
  'an empty bar must hide rather than render chrome');

/* silentpass-1.0.0 (2026-08-28): this suite ran its assertions and said
   NOTHING. run-all.js judges a suite on its exit code alone, so it could
   not tell "ran and passed" from "did nothing at all" - which is exactly
   how four other suites in this corpus were passing while executing none
   of themselves. Announcing what was proved is what makes that
   distinguishable. */
console.log('PASS right-now bar never duplicates the hero: the same patient is never offered twice on one screen');

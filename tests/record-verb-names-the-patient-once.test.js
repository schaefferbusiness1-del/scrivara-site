'use strict';

/* THE "START RECORDING - <PATIENT>" PILL HAD THREE SOURCES, NOT ONE (b750).
 *
 * Item #4 was marked VERIFIED COMPLETE. The owner then photographed
 * "Start Recording - Diana Terrell" back on his screen. Git forensics settled
 * what happened, and it was not a revert:
 *
 *   - b676 (9151dda) removed the ez3fl flow-lane pill.        STILL FIXED.
 *   - b706 (27c048c) emptied the right-now bar action list.    STILL FIXED.
 *   - the LIVE ez3 workspace button was never touched at all.  THIS WAS IT.
 *
 * Nothing reverted and no parallel session clobbered anything. It was never one
 * pill. Two of three sources were fixed, the fix was verified against those two,
 * and the third kept rendering - and the module that was supposed to cover it is
 * dead in production, reachable only by the verification probe itself. That is
 * worse than a revert, because a revert would have been detectable.
 *
 * Nothing was guarding ANY of the three. This suite guards all three, so a
 * future partial fix cannot pass by covering two of them again.
 *
 * SCOPE MATTERS AND IS ASSERTED BOTH WAYS. The HOME screen buttons fuse the
 * patient name DELIBERATELY - the design note in the module and the onboarding
 * copy both teach "the big button is already loaded for whoever is up now:
 * Start Recording - [patient]", and the home screen has no bound-patient banner.
 * Only the VISIT WORKSPACE button is duplication, because the banner names the
 * patient immediately above it and `.ez3-big small{display:block}` turned the
 * name into its own line, which is what made it read as a second pill.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

/* the live module; four later copies are hard-dead (each opens with a bare return) */
const live = connect.indexOf("var VER = '3.7.3'");
assert(live > 0, "the live ez3 module marker (VER = '3.7.3') must still exist");

/* ---- SOURCE 3: the visit-workspace button must NOT repeat the patient ---- */
{
  const at = connect.indexOf('id="ez3Rec"', live);
  assert(at > 0, 'the workspace Start Recording button must still exist');
  const lineStart = connect.lastIndexOf('\n', at) + 1;
  const lineEnd = connect.indexOf('\n', at);
  const line = connect.slice(lineStart, lineEnd);
  assert(!/<small>/.test(line),
    'the visit-workspace Start Recording button fuses the patient name again. The banner ' +
    'already names the patient directly above it and .ez3-big small renders display:block, so ' +
    'the name becomes its own line and reads as a duplicate pill above the stage rail. The ' +
    'owner reported this twice. Line: ' + line.trim());
  assert(!/esc\(nm\)/.test(line),
    'the workspace button must not interpolate the patient name at all');
}

/* ---- the HOME buttons must KEEP it - documented, taught, and not duplication ---- */
{
  const homeAt = connect.indexOf('id="ez3Now"', live);
  assert(homeAt > 0, 'the home NOW button must still exist');
  const lineStart = connect.lastIndexOf('\n', homeAt) + 1;
  const line = connect.slice(lineStart, connect.indexOf('\n', homeAt));
  assert(/esc\(/.test(line),
    'the HOME screen Start Recording button must still name the patient - there is no ' +
    'bound-patient banner on that screen, and the onboarding copy teaches this exact label. ' +
    'Stripping it would be an over-correction of the workspace fix.');
}

/* ---- SOURCE 1 (b676): the ez3fl flow-lane pill stays hidden when idle ---- */
assert(connect.includes('setLaneHidden(rb, !live && !rbResumable)'),
  'the b676 flow-lane guard is gone - the ez3fl record pill would render while idle again. ' +
  'This is one of the three sources of the duplicate pill and it was previously fixed.');
/* Matched on the distinctive fragment, not a resolved selector: these rules are
   built by CONCATENATION ('#' + ROOT_ID + ' .ez3fl-recbtn...'), so searching for
   the composed selector finds nothing even when the rule ships. */
assert(connect.includes('ez3fl-recbtn[hidden]{display:none!important;}'),
  'the CSS backstop that beats the lane pill display:inline-flex rule must survive - without ' +
  'it the [hidden] attribute alone does not win and the lane pill renders anyway');

/* ---- SOURCE 2 (b706): the right-now bar offers no visit actions ---- */
assert(/visit:\s*\[\]/.test(shell),
  'the b706 right-now bar fix is gone - an action spec was restored, which puts a pill back ' +
  'above the stage rail. This is the second of the three sources.');

console.log('PASS the record verb names the patient exactly once: the visit workspace button no ' +
  'longer repeats what the banner already says, the home screen keeps its documented ' +
  '"Start Recording - <patient>" label, and both previously-fixed sources (the ez3fl lane pill ' +
  'and the right-now bar spec) are pinned so a partial fix cannot pass again');

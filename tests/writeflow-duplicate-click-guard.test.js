'use strict';

/* The encounter write path's duplicate protections existed but were unpinned —
 * any refactor could silently drop them. Contract (accepted wf2 lane in
 * feat_mls_writeflow.js, NOT the rejected 2.9.44 exact-encounter-verify lane):
 *
 *  1. A second Athena action started while one is awaiting confirmation or
 *     running is refused honestly ("busy"), never queued or doubled.
 *  2. The in-flight flag arms at action start and clears on every fail-closed
 *     exit (missing token, order-binding, identity, encounter context) and on
 *     Cancel.
 *  3. The FIRST confirm click synchronously disables both Confirm and Cancel
 *     before the execute crosses the bridge — a rapid second click can never
 *     dispatch a second execute.
 *  4. Execution requires the probe's one-use actionToken; a missing token is a
 *     fail-closed "Nothing was changed" exit.
 *  5. The execute message carries mode:'execute' with that same actionToken and
 *     the identity-locked patient as both patient and expectedPatient.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const wf = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');

// 1. busy refusal for a concurrent action start (both entry points)
assert(/if \(athenaActionRunning\) \{ actionSay\(opts, 'Another Athena action is awaiting confirmation or still running\. Finish or cancel it first\.', ''\); return Promise\.resolve\(\{ ok: false, error: 'busy' \}\);/.test(wf),
  'concurrent action start lost its honest busy refusal');
assert(wf.includes("Another Athena action is already awaiting confirmation. Finish or cancel it before opening the unified review."),
  'the unified review entry lost its busy refusal');

// 2. flag arms at start and clears on fail-closed exits + cancel
assert(wf.includes('athenaActionRunning = true;'), 'the in-flight flag never arms');
/* wfrep-1.0.0 (2026-08-28): the PROPERTY is unchanged - no fail-closed exit may
   leave the in-flight flag armed, or the control stays stuck forever. What
   changed is that the terminal refusals in showActionConfirm now route through
   refuseAction(), which says it, clears the flag AND reports the refusal to a
   waiting phone (before, the phone heard nothing and blamed a timeout ~9
   minutes later). Counting one spelling would have called that refactor a
   regression, so this counts fail-closed exits BOTH ways and separately proves
   the helper really does clear the flag - which the old literal count could
   only ever assume. */
assert(/function refuseAction\(action, opts, message\) \{[\s\S]{0,400}?athenaActionRunning = false;/.test(wf),
  'refuseAction must clear the in-flight flag itself');
/* This must match the CALL, not the typeof guard beside it. Written the loose
   way first, and a canary that deleted the invocation still passed - the regex
   was matching `typeof opts.onResult === 'function'` and calling that proof. */
assert(/function refuseAction\(action, opts, message\) \{[\s\S]{0,400}?opts\.onResult\(\{ ok: false, error: message \}/.test(wf),
  'refuseAction must REPORT the refusal, not merely display it - a phone waiting on this job hears nothing otherwise');
/* wfrep-1.0.1 (2026-08-28): THE COUNT I WROTE HERE WAS A PATIENT-SAFETY HOLE.
 *
 * wfrep-1.0.0 moved six terminal refusals onto refuseAction(), and I replaced
 * the old census with one that counts `refuseAction(action, opts,` call sites.
 * It never looked at what FOLLOWS them. An adversarial audit proved, by
 * execution, that dropping `return;` from five of those refusals left this
 * suite PASSING - including the chart-identity mismatch. I reproduced it
 * independently before believing it.
 *
 * What that costs: the refusal says its sentence, clears athenaActionRunning
 * and reports the refusal - and then execution CONTINUES. lockedPatient is
 * built from the MISMATCHED chart, the confirm overlay renders, and the bridge
 * receives the same object as both `patient` and `expectedPatient`, so the
 * expectedPatient self-check cannot catch it. A wrong-chart Athena write, one
 * Confirm click away. It also clears the in-flight flag while a live confirm
 * overlay stands, defeating the concurrent-action guard at the same time.
 *
 * The OLD assertion had discriminating power mine lacked, by accident: it
 * counted `athenaActionRunning = false; return;` - clear AND return in one
 * literal - so deleting a return broke the count. Control run confirmed it:
 * baseline test + this bypass fails "found 1, expected >= 5".
 *
 * A count cannot express "and then it stops". This pins the PROPERTY instead:
 * every refusal must be structurally terminal. The engine now spells them
 * `return refuseAction(...)`, so falling through requires deleting the return
 * keyword from the call itself - and that is exactly what is asserted here,
 * per site, with comments stripped first so prose quoting an old spelling can
 * never pad the census (line 396's block comment was doing that). */
const wfCode = wf
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const refusalSites = [...wfCode.matchAll(/refuseAction\s*\(\s*action\s*,\s*opts\s*,/g)]
  .filter((m) => !/function\s+refuseAction/.test(wfCode.slice(Math.max(0, m.index - 40), m.index + 20)));
assert(refusalSites.length >= 5,
  'fail-closed refusals in showActionConfirm dropped to ' + refusalSites.length + ' (expected >= 5) - ' +
  'a terminal refusal was deleted rather than re-routed');
for (const m of refusalSites) {
  const before = wfCode.slice(Math.max(0, m.index - 12), m.index);
  assert(/return\s+$/.test(before),
    'A REFUSAL THAT DOES NOT RETURN. Every refuseAction call in showActionConfirm must be spelled ' +
    '`return refuseAction(...)`. Without the return the refusal is announced and then execution ' +
    'CONTINUES into lockedPatient/bridgePatient, which sends the same object as patient AND ' +
    'expectedPatient - so a mismatched chart passes its own self-check and a wrong-chart write is ' +
    'one Confirm click away. Context: ' + JSON.stringify(wfCode.slice(m.index - 12, m.index + 90)));
}
/* And the flag-clear still lives in exactly one place, so no site can forget it. */
assert((wfCode.match(/athenaActionRunning = false;/g) || []).length >= 1,
  'nothing clears the in-flight flag any more');
assert(/cancel\.onclick = function \(\) \{ closeActionConfirm\(\); athenaActionRunning = false;/.test(wf),
  'Cancel no longer clears the in-flight flag');

// 3. first confirm click disables BOTH buttons synchronously before the bridge execute
const goClick = wf.indexOf("go.addEventListener('click', function () {");
assert(goClick > 0, 'confirm click handler missing');
const clickBody = wf.slice(goClick, goClick + 400);
const disableAt = clickBody.indexOf('go.disabled = true; cancel.disabled = true;');
const bridgeAt = clickBody.indexOf("bridge('mlsAppAthenaActionV2'");
assert(disableAt >= 0, 'confirm click no longer disables both buttons');
assert(bridgeAt > disableAt, 'the buttons must be disabled BEFORE the execute crosses the bridge');

// 4. one-use token fail-closed
/* wfrep-1.0.0: same refusal, now routed through refuseAction() so a waiting
   phone is told WHY instead of timing out nine minutes later. The property
   pinned here is unchanged and still exact: no actionToken means stop, before
   anything is confirmed or written. */
/* wfrep-1.0.1: matched on the GUARD plus its refusal, not on one exact
   spelling. The engine now writes every refusal `return refuseAction(...)`;
   pinning the old `refuseAction(...); return;` here would have demanded back
   the very shape that let a refusal fall through. The per-site return check
   above is what enforces termination now. */
assert(/if \(!actionToken\) \{ return refuseAction\(action, opts, 'Athena did not return a one-use confirmation token\. Nothing was changed\.'\); \}/.test(wf),
  'missing one-use token no longer fails closed');

// 5. execute carries mode:'execute' + the same token + locked identity on both fields
const exec = wf.slice(bridgeAt + goClick, bridgeAt + goClick + 400);
assert(/mode: 'execute', action: action, actionToken: actionToken/.test(exec), 'execute must carry the probe\'s one-use actionToken');
assert(/patient: bridgeLockedPatient, expectedPatient: bridgeLockedPatient/.test(exec), 'execute must send the identity-locked patient as patient AND expectedPatient');

console.log('PASS writeflow duplicate-click guard: busy refusal, armed/cleared in-flight flag, synchronous double-disable before execute, one-use token, and locked-identity execute are all pinned');

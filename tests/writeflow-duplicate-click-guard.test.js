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
const failClears = (wf.match(/athenaActionRunning = false; return;/g) || []).length;
assert(failClears >= 5, 'fail-closed exits must clear the in-flight flag (found ' + failClears + ', expected >= 5)');
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
assert(wf.includes("if (!actionToken) { actionSay(opts, 'Athena did not return a one-use confirmation token. Nothing was changed.', 'err'); athenaActionRunning = false; return; }"),
  'missing one-use token no longer fails closed');

// 5. execute carries mode:'execute' + the same token + locked identity on both fields
const exec = wf.slice(bridgeAt + goClick, bridgeAt + goClick + 400);
assert(/mode: 'execute', action: action, actionToken: actionToken/.test(exec), 'execute must carry the probe\'s one-use actionToken');
assert(/patient: bridgeLockedPatient, expectedPatient: bridgeLockedPatient/.test(exec), 'execute must send the identity-locked patient as patient AND expectedPatient');

console.log('PASS writeflow duplicate-click guard: busy refusal, armed/cleared in-flight flag, synchronous double-disable before execute, one-use token, and locked-identity execute are all pinned');

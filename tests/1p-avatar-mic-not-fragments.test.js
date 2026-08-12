/* 1p-avatar-mic-not-fragments.test.js  (1p PREVIEW ONLY)
 *
 * Pins p1-mic-1.0.0. Owner: "avatar listens in fragments and shows the text its
 * listening to in fragments so its like is it even listening ... get rid of the
 * text, make sure it listens to everything, and show a mic listening animation
 * when it hears talking instead."
 *
 * THE TWO PROPERTIES THAT MATTER, and both are easy to break later:
 *   1. Interim text is WITHHELD FROM THE SCREEN ONLY. Recognition is untouched:
 *      interimResults stays on and every FINAL transcript is still captured, so
 *      the avatar still hears everything. A future edit that "fixes" this by
 *      turning interimResults off would silently degrade capture.
 *   2. Only kind==='transcript' is suppressed. #mlsAvKioskInterim is a shared
 *      line with FOURTEEN historical writers, arbitrated by rank
 *      (transcript 0 < hint 1 < status 2 < alert 3). Suppressing anything above
 *      transcript would hide a real staff/patient message.
 *
 * Touches only 1p-feat_mls_avatar.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const AV = path.join(ROOT, '1p-feat_mls_avatar.js');
const src = fs.readFileSync(AV, 'latin1');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- 1. the block ships once ---- */
ok(/p1-mic-1\.0\.0/.test(src), 'p1-mic-1.0.0 block is missing from 1p-feat_mls_avatar.js');
ok((src.match(/function p1Hearing\s*\(/g) || []).length === 1, 'expected exactly one p1Hearing()');

/* ---- 2. interim transcript is suppressed, and ONLY transcript ---- */
ok(/if \(kind === 'transcript' && !p1MicOff\) \{/.test(src),
  'the suppression must be gated on kind === transcript');
ok(/kind === 'transcript'[^]{0,260}iv\.textContent = '';/.test(src),
  'the transcript branch must clear the line rather than paint half-words');
for (const kind of ['hint', 'status', 'alert']) {
  ok(!new RegExp("kind === '" + kind + "'[^]{0,80}return true;").test(src),
    'kind ' + kind + ' must NOT be short-circuited - it owns real messages on this line');
}
ok(/KL_RANK = \{ transcript: 0, hint: 1, status: 2, alert: 3 \}/.test(src),
  'the rank table must be intact so hint/status/alert still outrank transcript');

/* ---- 3. THE CAPTURE CONTRACT: recognition is untouched ---- *
 * This is the assertion that stops a later "simplification" from turning off
 * interim results and quietly making the avatar hear less. */
ok(/interimResults = true/.test(src),
  'interimResults must stay TRUE - suppression is a RENDERING change, not a capture change');
ok(/isFinal\)/.test(src), 'the final-result path must still exist and still accumulate finalText');
ok(!/interimResults = false/.test(src),
  'interimResults must never be disabled - that would reduce what the avatar hears');

/* ---- 4. the pulse actually exists and is driven by hearing ---- */
ok(/id=\\?"mlsAvP1Mic\\?"/.test(src) || /id="mlsAvP1Mic"/.test(src),
  'the #mlsAvP1Mic element must be mounted in the kiosk DOM');
ok(/#mlsAvP1Mic\.on\{display:inline-flex\}/.test(src), 'the .on class must reveal the indicator');
ok(/@keyframes mlsAvP1Wave/.test(src), 'the pulse keyframes must ship');
ok(/p1Hearing\(\);/.test(src), 'the transcript branch must call p1Hearing()');
ok(/setTimeout\(function \(\) \{ try \{ m\.classList\.remove\('on'\)/.test(src),
  'the pulse must switch itself off when speech stops, not latch on forever');

/* ---- 5. mounted INSIDE #mlsAvKiosk so the existing reduced-motion rule applies ---- */
const domIdx = src.indexOf('mlsAvP1Mic" aria-hidden');
const kioskIdx = src.indexOf('<div id=\\"mlsAvKioskInterim\\"></div>');
ok(domIdx > -1, 'the indicator must be in the kiosk markup string');
ok(/prefers-reduced-motion: reduce\)\{#mlsAvKiosk \*/.test(src),
  'the kiosk-wide reduced-motion rule must still exist to cover the new animation');

/* ---- 6. accessibility: the pulse is decorative, the state chip carries meaning ---- */
ok(/mlsAvP1Mic" aria-hidden="true"|mlsAvP1Mic\\" aria-hidden=\\"true/.test(src),
  'the pulse must be aria-hidden - #mlsAvKioskState already announces listening/speaking');

/* ---- 7. house convention ---- */
ok(/window\.__mlsAvP1Mic = \{/.test(src), 'must expose window.__mlsAvP1Mic');
ok(/revert: function \(\) \{ p1MicOff = true;/.test(src), 'revert() must disable the whole behaviour');
ok(/state: function \(\)/.test(src), 'state() must report mounted/on/suppressed');

console.log('PASS 1p-avatar-mic-not-fragments (' + checks + ' assertions)');

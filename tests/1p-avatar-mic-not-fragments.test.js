/* 1p-avatar-mic-not-fragments.test.js  (1p PREVIEW ONLY)
 *
 * Pins p1-mic (now 1.1.0) and p1-livewords-1.0.0.
 *
 * Owner: "avatar listens in fragments and shows the text its listening to in
 * fragments so its like is it even listening ... get rid of the text, make sure it
 * listens to everything, and show a mic listening animation when it hears talking
 * instead." Then, after 1.0.0 shipped: "0 words" while speaking, and "very laggy
 * and not great at making sure its showing its listening."
 *
 * THE FOUR PROPERTIES THAT MATTER, each easy to break later:
 *   1. Interim text is WITHHELD FROM THE SCREEN ONLY. interimResults stays on and
 *      every FINAL transcript is still captured. A future edit that "fixes" a display
 *      problem by capturing less must fail here.
 *   2. Only kind==='transcript' is suppressed. #mlsAvKioskInterim is a shared line
 *      with fourteen historical writers arbitrated by rank (transcript 0 < hint 1 <
 *      status 2 < alert 3). Suppressing anything above transcript hides real messages.
 *   3. The indicator RESERVES its space. 1.0.0 toggled display per recognition event
 *      inside a centred flex column with gap, so every word re-flowed and re-centred
 *      the whole full-screen kiosk - the measured cause of "very laggy".
 *   4. The word counter moves on LIVE speech. Removing the interim text removed the
 *      doctor's proof it was hearing him, and the counter only moved on FINAL results,
 *      so a healthy mid-utterance recogniser rendered byte-identically to a dead one.
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

/* ---- 1. the blocks ship, once each ---- */
ok(/p1-mic-1\.[0-9]+\.[0-9]+/.test(src), 'the p1-mic block is missing from 1p-feat_mls_avatar.js');
ok(/p1-livewords-1\.[0-9]+\.[0-9]+/.test(src), 'the p1-livewords block is missing');
ok((src.match(/function p1Hearing\s*\(/g) || []).length === 1, 'expected exactly one p1Hearing()');

/* ---- 2. interim transcript suppressed, and ONLY transcript ---- */
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

/* ---- 3. THE CAPTURE CONTRACT: recognition is untouched ---- */
ok(/interimResults = true/.test(src),
  'interimResults must stay TRUE - suppression is a RENDERING change, not a capture change');
ok(/isFinal\)/.test(src), 'the final-result path must still exist and still accumulate finalText');
ok(!/interimResults = false/.test(src),
  'interimResults must never be disabled - that would reduce what the avatar hears');

/* ---- 4. THE LAYOUT CONTRACT (pin moved from 1.0.0, deliberately) ----
 * 1.0.0 pinned `#mlsAvP1Mic.on{display:inline-flex}`. That property is exactly what
 * caused the thrash, so the pin moves to the stronger property: display is FIXED and
 * only opacity/visibility change. This is a tightening, not a relaxation. */
ok(/#mlsAvP1Mic\{display:inline-flex;visibility:hidden/.test(src),
  'the indicator must RESERVE its row (display fixed) so it can never relayout the kiosk');
ok(!/#mlsAvP1Mic\.on\{display:/.test(src),
  'the .on class must never change display - that is what caused the layout thrash');
ok(/#mlsAvP1Mic\.on\{opacity:1\}/.test(src),
  'speech must brighten the indicator via opacity only');
ok(/#mlsAvKiosk\.listening #mlsAvP1Mic/.test(src) && /#mlsAvKiosk\.ambient #mlsAvP1Mic/.test(src),
  'the indicator must be visible for the WHOLE time the mic is open (both listening and ambient), not only just after a word');

/* ---- 5. THE LIVE-WORD CONTRACT, pinned in BOTH directions ---- */
ok(/return n \+ \(kiosk\.ambLiveWords \| 0\);/.test(src),
  'the ambient clock must include the in-flight utterance, or a healthy recogniser reads as dead');
ok(/kiosk\.ambLiveWords = clean\(interim\)/.test(src),
  'kioskAmbientPaint must record the in-flight word count');
ok(/kiosk\.ambLiveWords = 0;\s*\n\s*if \(!v\) return;/.test(src),
  'finalising must clear the live tally BEFORE the empty-guard, so words are never double-counted');
ok(/ambParts = \[\][^\n]*ambLiveWords = 0;/.test(src),
  'a new ambient session must reset the live tally');

/* ---- 6. the pulse still exists and still stands down ---- */
ok(/@keyframes mlsAvP1Wave/.test(src), 'the pulse keyframes must ship');
ok(/p1Hearing\(\);/.test(src), 'the transcript branch must call p1Hearing()');
ok(/m\.classList\.remove\('on'\)/.test(src),
  'the brightened state must fall back on silence, not latch on forever');

/* ---- 7. mounted inside #mlsAvKiosk so reduced-motion covers it ---- */
ok(src.indexOf('mlsAvP1Mic" aria-hidden') > -1, 'the indicator must be in the kiosk markup string');
ok(/prefers-reduced-motion: reduce\)\{#mlsAvKiosk \*/.test(src),
  'the kiosk-wide reduced-motion rule must still exist to cover the animation');
ok(/mlsAvP1Mic" aria-hidden="true"/.test(src),
  'the pulse must be aria-hidden - #mlsAvKioskState already announces listening/speaking');

/* ---- 8. house convention ---- */
ok(/window\.__mlsAvP1Mic = \{/.test(src), 'must expose window.__mlsAvP1Mic');
ok(/revert: function \(\) \{ p1MicOff = true;/.test(src), 'revert() must disable the whole behaviour');
ok(/state: function \(\)/.test(src), 'state() must report mounted/on/suppressed');

console.log('PASS 1p-avatar-mic-not-fragments (' + checks + ' assertions)');

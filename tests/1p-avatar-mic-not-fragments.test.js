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
function eq(actual, expected, msg) { assert.strictEqual(actual, expected, msg); checks++; }

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

/* Execute the real arbitrator. Suppressing transcript pixels must not bypass the
 * existing hold clock: while a hint/status/alert is live it still owns the line,
 * and at the exact expiry boundary (`klUntil > now`) the stale message must be
 * cleared even though the new interim fragment itself remains hidden. */
const arbFrom = src.indexOf('  var KL_RANK = {');
const arbTo = src.indexOf('  function kioskState(', arbFrom);
ok(arbFrom > -1 && arbTo > arbFrom, 'could not isolate the real 1p patient-line arbitrator');
const arbSource = src.slice(arbFrom, arbTo);

function makeArbitrator() {
  let now = 1000;
  let nextTimer = 1;
  const timers = new Map();
  const lineNode = { textContent: '' };
  const micClasses = new Set();
  const micNode = {
    classList: {
      add: (name) => micClasses.add(name),
      remove: (name) => micClasses.delete(name),
      contains: (name) => micClasses.has(name)
    }
  };
  const runtimeWindow = {};
  const build = new Function('getNode', 'clock', 'setTimer', 'cancelTimer', 'runtimeWindow', `
    var gid = function (id) { return getNode(id); };
    var Date = { now: clock };
    var setTimeout = setTimer, clearTimeout = cancelTimer;
    var window = runtimeWindow;
    ${arbSource}
    return {
      line: kioskLine,
      reset: kioskLineReset,
      state: kioskLineState,
      mic: window.__mlsAvP1Mic
    };
  `);
  const api = build(
    (id) => id === 'mlsAvP1Mic' ? micNode : (id === 'mlsAvKioskInterim' ? lineNode : null),
    () => now,
    (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    (id) => timers.delete(id),
    runtimeWindow
  );
  return {
    line: api.line,
    reset: api.reset,
    state: api.state,
    revert: () => api.mic.revert(),
    text: () => lineNode.textContent,
    pulse: () => micClasses.has('on'),
    setNow: (value) => { now = value; },
    advance: (value) => { now += value; }
  };
}

/* Blank/repeated interim speech: pulse is the visible proof; fragments never
 * become text and never acquire ownership of the shared message line. */
{
  const h = makeArbitrator();
  eq(h.line('transcript', 'well'), true, 'a cold interim fragment was not handled');
  eq(h.text(), '', 'a cold interim fragment was painted');
  eq(h.state().kind, '', 'a hidden interim fragment acquired line ownership');
  eq(h.state().holdMs, 0, 'a hidden interim fragment acquired a hold');
  eq(h.pulse(), true, 'a cold interim fragment did not brighten the mic');
  eq(h.line('transcript', 'well it hurts'), true, 'a repeated interim fragment was not handled');
  eq(h.text(), '', 'a repeated interim fragment was painted');
  eq(h.state().kind, '', 'a repeated hidden fragment acquired line ownership');
}

/* Exact clock boundary matrix. Test exact expiry first so a regression reports
 * the stale-message defect directly; then pin the active and post-expiry sides. */
const HOLD_MS = { hint: 6000, status: 9000, alert: 20000 };
for (const kind of Object.keys(HOLD_MS)) {
  for (const offset of [0, -1, 1]) {
    const h = makeArbitrator();
    const held = kind.toUpperCase() + ' MESSAGE';
    eq(h.line(kind, held), true, kind + ' did not acquire the line');
    h.advance(HOLD_MS[kind] + offset);
    const handled = h.line('transcript', 'partial words must stay hidden');
    eq(h.pulse(), true, kind + ' hold prevented the mic from showing live hearing');
    if (offset < 0) {
      eq(handled, false, kind + ' at TTL-1 must report that its live hold suppressed the transcript');
      eq(h.text(), held, kind + ' was cleared before its hold expired');
      eq(h.state().kind, kind, kind + ' lost line ownership before expiry');
      eq(h.state().holdMs, 1, kind + ' TTL-1 did not leave exactly 1ms on the hold');
    } else {
      eq(handled, true, kind + ' at/after expiry did not handle the hidden transcript');
      eq(h.text(), '', kind + ' remained visibly stale at/after its hold expired');
      eq(h.state().kind, '', kind + ' retained ownership after its hold expired');
      eq(h.state().holdMs, 0, kind + ' retained a hold after expiry');
    }
  }
}

/* Higher-priority clinical messages must still replace lower ones, and a new
 * turn must clear both pixels and arbitration state immediately. */
{
  const h = makeArbitrator();
  h.line('hint', 'HINT');
  eq(h.line('status', 'STATUS'), true, 'status could not replace a live hint');
  eq(h.text(), 'STATUS', 'status replacement painted the wrong message');
  eq(h.state().kind, 'status', 'status replacement did not acquire ownership');
  eq(h.line('alert', 'ALERT'), true, 'alert could not replace a live status');
  eq(h.text(), 'ALERT', 'alert replacement painted the wrong message');
  eq(h.state().kind, 'alert', 'alert replacement did not acquire ownership');
  eq(h.reset(), true, 'new-turn reset did not complete');
  eq(h.text(), '', 'new-turn reset left stale message pixels');
  eq(h.state().kind, '', 'new-turn reset left stale ownership');
  eq(h.state().holdMs, 0, 'new-turn reset left a stale hold');
}

/* Revert is a real behavioral rollback: the production arbitrator paints
 * transcript text again, while retaining its original priority/expiry rules. */
{
  const h = makeArbitrator();
  eq(h.revert(), true, 'p1 mic revert did not complete');
  eq(h.line('transcript', 'visible after revert'), true, 'reverted transcript was not accepted');
  eq(h.text(), 'visible after revert', 'revert did not restore transcript rendering');
  eq(h.state().kind, 'transcript', 'revert did not restore transcript ownership');
  eq(h.pulse(), false, 'reverted transcript still drove the p1 mic pulse');

  const held = makeArbitrator();
  held.revert();
  held.line('alert', 'ALERT');
  held.advance(HOLD_MS.alert - 1);
  eq(held.line('transcript', 'too soon'), false, 'revert weakened the production alert hold');
  eq(held.text(), 'ALERT', 'revert let transcript overwrite a live alert');
  held.advance(1);
  eq(held.line('transcript', 'visible at expiry'), true, 'revert did not honor the production exact-expiry boundary');
  eq(held.text(), 'visible at expiry', 'revert did not restore transcript pixels at exact expiry');
  eq(held.state().kind, 'transcript', 'revert left stale alert ownership at exact expiry');
}

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

/* ---- 5. THE RECEIPT / CLOCK SEPARATION -- the highest-value pin in this file ----
 * p1-livewords-1.0.0 added the in-flight utterance to kioskAmbientWords(), which is
 * ALSO read by the filing receipt ("N words - M characters written to the transcript").
 * That made the receipt claim words that were never filed. Proven path: a mid-utterance
 * Pause makes pvStopMic NULL pvRec.onresult BEFORE stop(), so the final never arrives,
 * ambParts never gains those words, and the receipt over-reported them as written.
 * A receipt that overstates what reached the chart is a clinical-honesty defect and is
 * strictly worse than a clock that reads zero. These pins keep the two apart forever. */
ok(/function kioskAmbientWords\(\)[^]{0,220}return n;\s*\n\s*\}/.test(src),
  'kioskAmbientWords() must be FILED-ONLY - it feeds the receipt');
ok(!/function kioskAmbientWords\(\)[^]{0,220}ambLiveWords/.test(src),
  'kioskAmbientWords() must NEVER include in-flight words - that is what made the receipt lie');
/* the separator is a UTF-8 middot read here as latin1, so match around it, not through it */
ok(/min captured[^]{0,12}\+ kioskAmbientWords\(\) \+/.test(src),
  'the FILING RECEIPT must call kioskAmbientWords() (filed-only), never the clock helper');
ok(!/min captured[^]{0,12}\+ kioskAmbientClockWords\(\)/.test(src),
  'the FILING RECEIPT must never use the live-inclusive clock helper');
ok(/kioskAmbientElapsed\(\) \+ '  \|  ' \+ kioskAmbientClockWords\(\) \+ ' words'/.test(src),
  'the CLOCK must call kioskAmbientClockWords() so it moves while he is still speaking');
ok(/function kioskAmbientClockWords\(\) \{ return kioskAmbientWords\(\) \+ kioskAmbientLiveWords\(\); \}/.test(src),
  'the clock helper must be filed + live, and nothing else');

/* the live tally must SELF-EXPIRE rather than trusting every discard path (pause,
 * Chrome self-restart, flush timeout, stop) to remember to clear it */
ok(/var LIVE_TTL_MS = \d+;/.test(src), 'the in-flight tally must have a TTL');
ok(/if \(!at \|\| \(Date\.now\(\) - at\) > LIVE_TTL_MS\) return 0;/.test(src),
  'a stale in-flight tally must read 0 - the recogniser is not delivering');
ok(/kiosk\.ambLiveAt = Date\.now\(\)/.test(src), 'the in-flight tally must be timestamped when recorded');
ok(/kiosk\.ambLiveWords = clean\(interim\)/.test(src),
  'kioskAmbientPaint must record the in-flight word count');
ok(/kiosk\.ambLiveWords = 0; kiosk\.ambLiveAt = 0;\s*\n\s*if \(!v\) return;/.test(src),
  'finalising must clear tally AND stamp before the empty-guard, so words are never double-counted');
ok(/ambParts = \[\][^\n]*ambLiveWords = 0; kiosk\.ambLiveAt = 0;/.test(src),
  'a new ambient session must reset tally and stamp');

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

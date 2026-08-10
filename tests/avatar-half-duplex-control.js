'use strict';
/*
 * THE CONTROL, ONE FIX AT A TIME.
 * ===========================================================================================
 * Running the new suite against the whole pre-fix module proves only that the FIRST group can
 * fail — assert throws, and everything after the throw is never evaluated. That is the shape of
 * "A PARTIAL GATE IS NOT A GATE": a gate that aborts at the first red has not tested what comes
 * after it. So this script builds one control copy per fix, reverting EXACTLY that fix and
 * nothing else, and reports which named assertion fires. A fix whose control passes is not
 * load-bearing and is reported as such rather than left looking like it is.
 *
 * RUN: node tests/avatar-half-duplex-control.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'feat_mls_avatar.js'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-control-'));

/* each variant reverts one fix. `from` must appear exactly once, or the revert is not the
   revert it claims to be and the control is measuring something else. */
const VARIANTS = [
  { id: 'A1 pvListen stops the VOICE again',
    from: '    pvStopMicOnly();\n    var rec; try { rec = new C(); } catch (e) { return false; }',
    to: '    pvStopVoice();\n    var rec; try { rec = new C(); } catch (e) { return false; }',
    expect: 'OPENING THE MICROPHONE STILL CANCELS THE SENTENCE' },
  /* ── THE av-6.3.1 VARIANT THAT MATTERS MOST: PUT ROUND 5 BACK ───────────────────────────────
     ⛔ These are the ROUND-5 BYTES, verbatim, not a synthetic mutant: two buckets, held segments
     refused and the clean remainder filed. Round 5 shipped this and its own suite pinned it as
     correct, which is why the defect survived a review round. It takes five edits because the
     round-5 design needed a second accumulation, and a control that reverted only one line would
     crash on an undeclared variable instead of reproducing the defect — a crash is not a control.
     ⚠️ pvListen has no 'use strict', so a partial revert would create a GLOBAL rather than throw
     in some engines; naming all five edits is the only version of this that is honest. */
  { id: 'A1b the utterance is SPLICED again — round 5 restored (five edits: the whole two-bucket design)',
    edits: [
      { from: "    var turnText = '', turnHeld = false, segTag = {}, segSeen = -1, turnFrom = 0;",
        to: "    var turnText = '', heldText = '', turnHeld = false, segTag = {}, segSeen = -1, turnFrom = 0;" },
      { from: "        if (segTag[i] === 'held') turnHeld = true;\n", to: '' },
      { from: "            if (pvIsSelfEcho(piece)) turnHeld = true;\n            turnText += (turnText ? ' ' : '') + piece;",
        to: "            if (segTag[i] === 'held' || pvIsSelfEcho(piece)) heldText += (heldText ? ' ' : '') + piece;\n            else turnText += (turnText ? ' ' : '') + piece;" },
      { from: '      var whole = turnText.trim(), held = turnHeld;',
        to: "      var whole = turnText.trim(), held = heldText.trim(); heldText = '';" },
      { from: '      if (!whole) return;\n      if (held) {',
        to: '      if (held && onOverlap) safe(function () { onOverlap(held); });\n      if (!whole) return;\n      if (false) {' },
    ],
    expect: 'A REMAINDER WAS FILED AS A COMPLETE ANSWER' },
  /* the same revert, checked by the suite that owns the four permanent negation controls */
  { id: 'T1 the four permanent controls lose their leading words — round 5 restored',
    edits: null,   /* filled in below from A1b: one description of the revert, two subjects */
    copyEditsFrom: 'A1b',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'WAS FILED WITHOUT ITS LEADING WORDS' },
  /* ⚠️ RECORDED HONESTLY: re-tagging a growing segment shows up FIRST as the critical defect
     itself — the straddling utterance is re-judged 'clean' the moment the question ends and is
     filed as a complete answer. So this control fails on the whole-turn assertion rather than on
     the re-tagging one written beside it. That is a stronger observation, not a weaker one, and
     naming the message it actually produces is the only honest way to record it. */
  { id: 'A1c the segment is re-tagged as the patient keeps talking',
    from: "        if (segTag[i] === undefined) segTag[i] = pvAudioLive() ? 'held' : 'clean';",
    to: "        segTag[i] = pvAudioLive() ? 'held' : 'clean';",
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'WAS FILED WITHOUT ITS LEADING WORDS' },
  /* ── AND THE TURN BOUNDARY ITSELF ─────────────────────────────────────────────────────────── */
  { id: 'T3 a segment already filed is read into the next turn (the turn boundary is gone)',
    from: '      turnText = \'\'; turnHeld = false; turnFrom = segSeen + 1;',
    to: '      turnText = \'\'; turnHeld = false;',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'THE SAME ANSWER WAS FILED TWICE' },
  { id: 'T4 submit() tears the microphone down again (the half-teardown)',
    from: '      endTurn();\n',
    to: '      endTurn();\n      if (pvRec === rec) { safe(function () { rec.stop(); }); pvRec = null; }\n',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'submit() STOPPED THE RECOGNISER' },
  { id: 'T5 kioskTurn closes the microphone on every turn again',
    from: "    pvAbandonSpeech();\n    kioskMood('thinking', '', answer);",
    to: "    pvStopVoice();\n    kioskMood('thinking', '', answer);",
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'A FUNCTION INSIDE THE INTERVIEW LOOP CLOSES THE MICROPHONE' },
  { id: 'T6 pvAudioLive believes a positive signal outside any trust window (the deafness hang)',
    from: '    if (!pvAudioStartAt) return false;\n    if ((Date.now() - pvAudioStartAt) > PV_AUDIO_TRUST_MS) return false;',
    to: '    if (pvAudioStartAt && (Date.now() - pvAudioStartAt) > PV_AUDIO_TRUST_MS) return false;',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'THE KIOSK IS DEAF FOR THE REST OF THE VISIT' },
  { id: 'T6b finish() leaves the element it declared finished still playing',
    from: '      if (ttsAudioNow) { safe(function () { ttsAudioNow.onended = null; ttsAudioNow.onerror = null; ttsAudioNow.pause(); }); ttsAudioNow = null; }\n      if (pvFinishNow === finish) pvFinishNow = null;',
    to: '      if (pvFinishNow === finish) pvFinishNow = null;',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'LEFT THE LOUDSPEAKER PLAYING' },
  { id: 'A2 a live recogniser is torn down and rebuilt again',
    from: '    if (pvRec) {\n      if (!keepMood) {',
    to: '    if (keepMood && pvRec) {\n      if (!keepMood) {',
    expect: 'A LIVE RECOGNISER WAS TORN DOWN AND REBUILT' },
  { id: 'A2b the microphone opens AFTER the question again (the clipping fence)',
    from: '        kioskListen(true);\n        pvSpeakShaped(kiosk.lastSay, function () {',
    to: '        pvSpeakShaped(kiosk.lastSay, function () {',
    suite: 'avatar-listens-while-speaking.test.js',
    expect: 'the mic must open alongside the question' },
  { id: 'A3 barge-in from the microphone is restored',
    from: '      if (pvAudioLive()) { kiosk.heardWhileSpeaking = (kiosk.heardWhileSpeaking || 0) + 1; return; }',
    to: '      if (pvAudioLive()) { kiosk.heardWhileSpeaking = (kiosk.heardWhileSpeaking || 0) + 1; pvStopSpeechOnly(); }',
    expect: 'THE SENTENCE WAS CUT OFF BY THE MICROPHONE' },
  { id: 'A3b the stop/paint fence reads the ESTIMATE instead of the audio',
    from: '      if (pvAudioLive()) { kiosk.heardWhileSpeaking',
    to: '      if (pvSaying) { kiosk.heardWhileSpeaking',
    suite: 'avatar-finishes-its-sentences.test.js',
    expect: 'a result arriving while the avatar speaks is no longer dropped-and-counted' },
  { id: 'A4 the reverted one-word rule is put back on the FILING path',
    from: '      if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }\n      var reuse = kiosk.lastTry',
    to: '      if (String(finalText).trim().split(/\\s+/).length < 2) return;\n      if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }\n      var reuse = kiosk.lastTry',
    expect: 'A PATIENT\'S ANSWER WAS DROPPED' },
  { id: 'A5 the interrupt button is unwired',
    from: "    root.querySelector('#mlsAvKioskSkip').addEventListener('click', kioskSkipSpeech);\n",
    to: '',
    expect: 'the interrupt button is not wired to anything' },
  { id: 'A5b the interrupt button is not revealed while speaking',
    from: "      '#mlsAvKiosk.speaking #mlsAvKioskSkip{visibility:visible}' +\n",
    to: '',
    expect: 'not revealed by the class that means' },
  /* the mistake I actually made and then measured: floating the button over the column */
  { id: 'A5c the interrupt button floats over the column again',
    from: "'#mlsAvKioskSkip{visibility:hidden;border:2px solid #204034;",
    to: "'#mlsAvKioskSkip{visibility:hidden;position:absolute;left:50%;bottom:2.2vh;border:2px solid #204034;",
    expect: 'THE INTERRUPT BUTTON IS FLOATING OVER THE COLUMN AGAIN' },
  /* ── DEFECT 4: the interrupt ORPHANED the sentence's continuation ──────────────────────────
     Reverting to the old ordering (bump the sequence first) makes finish() unreachable, which is
     exactly the shipped bug: a tap on the closing line left the check-in hanging. */
  { id: 'A6 the interrupt orphans the sentence again',
    from: '    var ending = pvFinishNow;\n    pvFinishNow = null;\n    if (ending) { safe(ending); }',
    to: '    var ending = null;\n    pvFinishNow = null;\n    if (ending) { safe(ending); }',
    expect: 'THE INTERRUPT ORPHANED THE SENTENCE\'S CONTINUATION' },
  /* ⚠️ FOUR EDITS, DELIBERATELY, AND RECORDED AS SUCH — because "the continuation runs exactly
     once" turned out to be protected four times over, and finding that out is the point of running
     controls at all. pvStopSpeechOnly de-registers the ending before running it; finish() has its
     own `finished` latch; finish() ALSO de-registers itself; and pvSpeakSeq has moved on by the
     time a second tap arrives. Any one of them is sufficient, so no single-edit control can expose
     the assertion, and calling it "not load-bearing" on that basis would be the wrong conclusion.
     Removing all four is the only honest way to show the assertion is capable of failing. */
  { id: 'A6b the interrupt runs the continuation twice (four edits: every idempotence mechanism)',
    edits: [
      { from: '    var ending = pvFinishNow;\n    pvFinishNow = null;', to: '    var ending = pvFinishNow;' },
      { from: '      if (finished || mySeq !== pvSpeakSeq) return;\n      finished = true;', to: '' },
      { from: '      if (pvFinishNow === finish) pvFinishNow = null;\n', to: '' },
      { from: '    pvSpeakSeq++;      /* AFTER the hand-off: a late fetch may not start a second voice */', to: '' },
    ],
    expect: 'the continuation ran 2 times' },
  { id: 'A6c the continuation runs BEFORE the sound is stopped',
    from: '    if (ttsAudioNow) { safe(function () { ttsAudioNow.onended = null; ttsAudioNow.onerror = null; ttsAudioNow.pause(); }); ttsAudioNow = null; }\n    safe(function () { if (window.speechSynthesis) window.speechSynthesis.cancel(); });\n    /* ── AND THEN THE SENTENCE *ENDS*',
    to: '    /* ── AND THEN THE SENTENCE *ENDS*',
    expect: 'the tap did not actually silence the synthesiser' },
  { id: 'A7 the silence watchdog fires over a live sentence again',
    from: '    if (pvAudioLive()) {\n      if ((kiosk.audioWaits || 0) < 3) {',
    to: '    if (false) {\n      if ((kiosk.audioWaits || 0) < 3) {',
    expect: 'THE WATCHDOG STILL FIRES OVER A LIVE SENTENCE' },
  { id: 'A7b the watchdog fence reads the ESTIMATE instead of the audio',
    from: '    if (pvAudioLive()) {\n      if ((kiosk.audioWaits || 0) < 3) {',
    to: '    if (pvSaying) {\n      if ((kiosk.audioWaits || 0) < 3) {',
    expect: 'THE WATCHDOG FIRES WHILE THE LOUDSPEAKER IS STILL PLAYING' },
  /* ⛔ ROUND 5's OWN LINE: the watchdog returns and walks away from the only timer that can revive
     a stalled question. Silent, and invisible to a suite that only asserted "nothing happened". */
  { id: 'A7c the watchdog returns without re-arming (round 5 restored)',
    from: '    if (pvAudioLive()) {\n      if ((kiosk.audioWaits || 0) < 3) {\n        kiosk.audioWaits = (kiosk.audioWaits || 0) + 1;\n        kioskArmWatchdog(pvAudioRemainingMs() + 750);\n        return;\n      }\n    }',
    to: '    if (pvAudioLive()) return;',
    expect: 'THE WATCHDOG STILL FIRES OVER A LIVE SENTENCE' },
  { id: 'A8 the 12-second net can cut the closing line again',
    from: '      if (pvAudioLive() && n < DONE_NET_MAX) { kioskArmDoneNet(pvAudioRemainingMs() + 750, n + 1); return; }',
    to: '',
    expect: 'THE CLOSING LINE IS STILL BEING CUT OFF' },
  /* ⛔ AND ROUND 5's ACTUAL BYTES: the guard was a ONE-SHOT, so when audio was still live at
     t=12000 the net evaporated and nothing could ever end the interview. A permanent hang the
     pre-fix code did not have — its net was unconditional. */
  { id: 'A8d the closing net is a ONE-SHOT again (round 5 restored: the permanent hang)',
    from: '      if (pvAudioLive() && n < DONE_NET_MAX) { kioskArmDoneNet(pvAudioRemainingMs() + 750, n + 1); return; }',
    to: '      if (pvAudioLive()) return;',
    expect: 'THE CHECK-IN HANGS FOR EVER' },
  { id: 'A8e the closing net extends without a bound (a poll, and a hang wearing a hat)',
    from: '      if (pvAudioLive() && n < DONE_NET_MAX) {',
    to: '      if (pvAudioLive()) {',
    expect: 'waited an unbounded number of times' },
  /* ── DEFECT 2: the ESTIMATE was the authority for "is it still talking" ────────────────────── */
  { id: 'A8b the speech watchdog ends a sentence that is still audible',
    from: '      if (!extended && pvAudioPlaying()) {',
    to: '      if (false && pvAudioPlaying()) {',
    expect: 'THE ESTIMATE ENDED A SENTENCE THAT WAS STILL PLAYING' },
  { id: 'A8c pvAudioLive falls back to the estimate alone',
    from: '    if (pvAudioPlaying()) return true;\n    return !!pvSaying;',
    to: '    return !!pvSaying;',
    expect: 'THE FENCE LIFTS WHILE THE LOUDSPEAKER IS STILL PLAYING' },
  /* ── DEFECT 1's other half: a refusal that says nothing ────────────────────────────────────── */
  { id: 'A11 a refused utterance is dropped silently',
    from: "      kioskLine('hint', 'Sorry — I was still talking, so I missed that. Could you say it again?');",
    to: '      return;',
    expect: 'A PATIENT WAS NOT TOLD THAT THEIR ANSWER WAS DROPPED' },
  { id: 'A11b the kiosk apologises for its own echo',
    from: '      if (pvIsSelfEcho(refused) || pvNovelWordCount(tpl, refused) < 1) {',
    to: '      if (false) {',
    expect: 'THE KIOSK APOLOGISED FOR ITS OWN ECHO' },
  { id: 'A9 ttsPlayUrl loses its exactly-once guard',
    from: '      if (fired || mySeq !== pvSpeakSeq) return;\n      fired = true;',
    to: '      if (mySeq !== pvSpeakSeq) return;',
    expect: 'THE SECOND HALF OF THE SENTENCE PLAYS' },
  /* the census must catch a NEW unfenced way to cut a sentence off - added inside kioskAmbientPaint,
     which is neither a human action nor fenced, and which runs while the avatar can be speaking */
  { id: 'A10 a new unfenced way to cut the avatar off',
    from: "  function kioskAmbientNoMic() {",
    to: "  function kioskRogueStop() { pvStopVoice(); }\n  function kioskAmbientNoMic() {",
    expect: 'A NEW WAY TO CUT THE AVATAR OFF MID-SENTENCE' },
  { id: 'B1 the children can be compressed again',
    from: "      '#mlsAvKiosk>*{flex-shrink:0}' +\n",
    to: '',
    expect: 'NOTHING STOPS THE COLUMN COMPRESSING ITS CHILDREN' },
  /* ⚠️ EXPECTATION CORRECTED TO THE MESSAGE IT ACTUALLY PRODUCES. It was written as "has no
     max-height", but removing the cap AND the scroller together trips the sibling assertion about
     OWNERSHIP first — which is the stronger of the two, because a capped box with visible overflow
     is worse than an uncapped one. Recording the message the control really fires is the point of
     this harness; "failed on a different assertion" is a result, not a pass. */
  { id: 'B1b the interim line stops owning its overflow',
    from: 'min-height:3.4vh;max-height:4.2em;overflow-y:auto;overscroll-behavior:contain}',
    to: 'min-height:3.4vh}',
    expect: 'does not own its overflow' },
  { id: 'B1c the face is rigid again',
    from: "'#mlsAvKioskFaceWrap{position:relative;height:min(40vh,420px);width:auto;aspect-ratio:1;min-height:14vh;flex:0 1 auto}'",
    to: "'#mlsAvKioskFaceWrap{position:relative;width:min(40vh,420px);height:min(40vh,420px)}'",
    expect: 'the FACE is no longer the element allowed to yield' },
  /* the version I actually shipped first, and that a screenshot caught: a cap that contains the
     text but slices the last visible line horizontally through the glyphs */
  /* ⚠️ RE-AIMED AT THE SUITE THAT CAN SEE IT. This variant used to run against the code-reading
     suite and PASSED, so it was reported as a fix with no control — correctly. Reverting to a
     fractional cap is a RENDERING defect (measured: clientHeight 108px on a 33px line box = 3.27
     lines, so the fourth line is sliced through the glyphs at five viewport sizes), and only the
     rendered suite measures it. The instrument was pointed at the wrong subject, not the fix. */
  { id: 'B1d the cap goes back to a fractional number of lines',
    from: 'min-height:3.4vh;max-height:4.2em;overflow-y:auto',
    to: 'min-height:3.4vh;max-height:11vh;overflow-y:auto',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'SLICED' },
  { id: 'B2 the live transcript is unbounded again',
    from: "    if (kind === 'transcript' && out.length > KL_TRANSCRIPT_MAX) {",
    to: "    if (false && kind === 'transcript' && out.length > KL_TRANSCRIPT_MAX) {",
    expect: 'THE LIVE TRANSCRIPT IS STILL UNBOUNDED' },
  /* the answer must still ride verbatim, so this variant truncates it WITHOUT touching the
     `body.answer = answer;` line — otherwise the first assertion of the group fires instead and
     the one that actually guards the filing path is never reached */
  { id: 'B3 a length rule reaches the filing path',
    from: '    kiosk.busy = true;\n    if (kiosk.nudgeTimer)',
    to: '    kiosk.busy = true;\n    if (answer) answer = answer.slice(0, 160);\n    if (kiosk.nudgeTimer)',
    expect: 'A LENGTH RULE REACHED THE FILING PATH' },
  { id: 'B4 an equal-rank write re-arms the hold again',
    from: '    if (rank > heldRank) klUntil = now + (KL_HOLD[kind] || 0);',
    to: '    klUntil = now + (KL_HOLD[kind] || 0);',
    expect: 'an equal-rank write RE-ARMED the full hold' },
  { id: 'B5 the hold survives the screen again',
    from: '       later session may act on it */\n    kiosk.consentAt = 0;',
    to: '       later session may act on it */\n    kiosk.consentAt = 0; /* no reset */',
    expect: null,  /* filled in below: this one needs the reset call removed, see PATCHES */
    removeCloseReset: true },
  /* injected OUTSIDE the arbitrator's own source range, or the group's self-check ("the
     arbitrator itself is being flagged") fires first and the real assertion is never reached.
     The shape is the one-liner that defeated the first version of the scanner. */
  /* ── DEFECT 3: the panel that was sitting on the patient's words ───────────────────────────
     Checked by the RENDERED suite, which is why it names that one. Measured with this rule gone:
     #mlsAvKioskOrders covers #mlsAvKioskSay and #mlsAvKioskInterim at 1366x768 and 1024x768. */
  { id: 'B7 the text column stops reserving the actions panel\'s area',
    from: "      '#mlsAvKiosk.hasorders{padding-right:calc(var(--mlsav-panel) + 32px)}' +\n",
    to: '',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'THE TEXT COLUMN NO LONGER RESERVES' },
  { id: 'B7b the narrow-screen bottom sheet reserves the wrong axis',
    from: "      '#mlsAvKiosk.hasorders{padding-right:5vw;padding-bottom:calc(44vh + 16px)}' +",
    to: "      '#mlsAvKiosk.hasorders{padding-right:5vw}' +",
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'reserves the wrong axis entirely' },
  /* ── DEFECT 3 CONTINUED (av-6.3.1): the NARROW-SCREEN layout, which no viewport used to render ──
     Every variant below is measured by the rendered suite at 375x812 / 414x896 / 360x740 /
     720x1280 / 320x568, and every one of them was a REAL failing state before this round. */
  { id: 'B8 the phone loses its corner-control clearance',
    from: "      '#mlsAvKiosk{padding-top:72px;gap:1vh}' +",
    to: '',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'COVERED' },
  { id: 'B8b the phone keeps the desktop line counts, so the column overflows the sheet',
    edits: [
      { from: "      '#mlsAvKioskSay{font:600 2.9vh/1.35 \\'Public Sans\\',system-ui;max-height:4.05em;min-height:4vh}' +", to: '' },
      { from: "      '#mlsAvKioskInterim{max-height:2.8em;min-height:2.8vh}' +", to: '' },
      { from: "      '#mlsAvKiosk.hasorders #mlsAvKioskSay{max-height:2.7em}' +", to: '' },
      { from: "      '#mlsAvKiosk.hasorders #mlsAvKioskInterim{max-height:1.4em}' +", to: '' },
    ],
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'COVERED' },
  { id: 'B8c the face keeps its desktop size on a phone with the panel open',
    from: "      '#mlsAvKiosk.hasorders #mlsAvKioskFaceWrap{display:none}' +",
    to: '',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'COVERED' },
  { id: 'B8d the recording banner is capped with a SCROLLER, hiding the clock inside it',
    from: "      '#mlsAvKiosk.hasorders #mlsAvKioskRec{font:800 1.7vh system-ui;padding:.6vh 1.4vh;gap:8px}' +",
    to: "      '#mlsAvKiosk.hasorders #mlsAvKioskRec{max-height:5.4em;overflow-y:auto;font-size:1.8vh}' +",
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'COVERED' },
  { id: 'B8e the avatar name loses the clearance the wave row used to give it',
    from: "      '#mlsAvKiosk.ambient #mlsAvKioskName{margin-top:16px}' +",
    to: '',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'COVERED' },
  /* ── AND THE GUARD ON THE GUARD: a responsive branch nothing renders must fail LOUDLY ─────────
     This is the class of miss that let the whole narrow-screen layout ship untested — the rule was
     pinned as a STRING by a regex and no viewport could make it match. A new media query that no
     viewport triggers has to be a red, not a silence. */
  { id: 'B9 a media query no viewport in the list can match',
    from: "      '@media (max-width:720px){#mlsAvKioskOrders{",
    to: "      '@media (max-width:200px){#mlsAvKioskSay{color:red}}' +\n      '@media (max-width:720px){#mlsAvKioskOrders{",
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'A RESPONSIVE BRANCH OF THE SHIPPED STYLESHEET IS NEVER RENDERED' },
  { id: 'B7c ordersRender stops keeping the layout honest about the panel',
    from: "    if (!list.length) { host.style.display = 'none'; host.innerHTML = ''; ordersReserve(false); return; }",
    to: "    if (!list.length) { host.style.display = 'none'; host.innerHTML = ''; return; }",
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'does not set the class that makes the column' },
  { id: 'B6 a direct writer to the patient line comes back',
    from: "  function kioskSetSay(text) {",
    to: "  function kioskBypass(t) { var line = gid('mlsAvKioskInterim'); if (line) line.textContent = t; }\n" +
        "  function kioskSetSay(text) {",
    expect: 'DIRECT WRITER(S) TO THE PATIENT LINE SURVIVE' },
];

/* B5 needs its own surgery: remove the kioskLineReset() call inside kioskClose only.
   ⚠️ ASSIGNED BY ID, NOT BY POSITION. This line used to read
   `VARIANTS[VARIANTS.length - 2].expect = ...`, and the moment this round appended variants it
   stamped B5's expectation onto B7c and left B5 with none — so TWO proven fixes reported as
   "failed on the wrong assertion" while both were working perfectly. A positional reference into
   a list that grows is the same defect class as a byte-window pin, in the instrument this round
   depends on most. */
const CLOSE_RESET = "    kioskLineReset();\n";
const b5 = VARIANTS.find((v) => v.removeCloseReset);
if (!b5) throw new Error('the B5 variant is gone, so nothing checks that the hold dies with the screen');
b5.expect = 'kioskClose does not reset the patient line';

/* ONE DESCRIPTION OF A REVERT, SEVERAL SUBJECTS. The round-5 splice has to be checked by two
   suites — the one that owns the general whole-or-refused rule and the one that owns the four
   permanent negation controls — and two hand-copied five-edit lists would drift the day one of
   them was updated. Resolved by ID, never by position: a positional reference into a list that
   grows is what once stamped one variant's expectation onto another and reported two working
   fixes as broken. */
for (const v of VARIANTS) {
  if (!v.copyEditsFrom) continue;
  const donor = VARIANTS.find((d) => d.id.split(' ')[0] === v.copyEditsFrom);
  if (!donor || !donor.edits) {
    throw new Error('the control variant "' + v.id + '" copies its revert from "' + v.copyEditsFrom +
      '", which no longer exists or no longer has one — so this control would silently test nothing');
  }
  v.edits = donor.edits;
}

let ok = 0, weak = [];
for (const v of VARIANTS) {
  let body = SRC;
  if (v.removeCloseReset) {
    const at = body.indexOf('function kioskClose(reason)');
    const stop = body.indexOf('function kioskSetSay(', at);
    const seg = body.slice(at, stop);
    if (seg.indexOf(CLOSE_RESET) < 0) { console.log('SKIP ' + v.id + ' — kioskClose has no reset to remove'); continue; }
    body = body.slice(0, at) + seg.replace(CLOSE_RESET, '') + body.slice(stop);
  } else {
    /* one edit, or several when a property is protected by more than one mechanism and no single
       revert can expose it — see A6b, where BOTH de-registrations have to go before a
       continuation can run twice. A multi-edit variant says so in its id. */
    const edits = v.edits || [{ from: v.from, to: v.to }];
    let broken = false;
    for (const e of edits) {
      const n = body.split(e.from).length - 1;
      if (n !== 1) {
        console.log('BAD  ' + v.id + ' — the revert target appears ' + n + ' times, so this control is ' +
          'not reverting what it claims. FIX THE CONTROL.');
        weak.push(v.id + ' (revert target x' + n + ')');
        broken = true;
        break;
      }
      body = body.replace(e.from, e.to);
    }
    if (broken) continue;
  }
  const file = path.join(dir, v.id.split(' ')[0] + '.js');
  fs.writeFileSync(file, body);
  /* most variants are checked by the new suite; a few belong to an older one, which is named on
     the variant. Both suites honour AVATAR_SRC_OVERRIDE — one of them did not until this lane
     found it reading the shipped file unconditionally. */
  const suite = v.suite || 'avatar-half-duplex-and-one-live-region.test.js';
  const env = Object.assign({}, process.env, { AVATAR_SRC_OVERRIDE: file, MLS_AVATAR_SRC: file });
  const r = spawnSync(process.execPath, [path.join(__dirname, suite)], { env, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) {
    console.log('WEAK ' + v.id + ' — the suite PASSED with this fix reverted. The assertion for it ' +
      'is not testing anything.');
    weak.push(v.id + ' (control passed)');
  } else if (v.expect && out.indexOf(v.expect) >= 0) {
    console.log('ok   ' + v.id + '  -> failed by name: "' + v.expect + '"');
    ok++;
  } else {
    const first = (out.match(/AssertionError[^\n]*\n?[^\n]*/) || ['(no assertion text)'])[0].replace(/\s+/g, ' ').slice(0, 150);
    console.log('MISS ' + v.id + ' — it failed, but on a DIFFERENT assertion than the one written ' +
      'for it: ' + first);
    weak.push(v.id + ' (failed on the wrong assertion)');
  }
}
console.log('\n' + ok + ' of ' + VARIANTS.length + ' fixes are proven load-bearing by a control that fails BY NAME.');
if (weak.length) { console.log('NOT PROVEN:\n  ' + weak.join('\n  ')); process.exit(1); }
console.log('Every fix in this change set has a control that fails by name.');

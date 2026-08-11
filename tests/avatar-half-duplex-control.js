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
  { id: 'A1b the utterance is SPLICED again — round 5 restored (seven edits: the whole two-bucket design)',
    edits: [
      /* ⚠️ THE LAST TWO EDITS ARE WHY THIS IS SEVEN AND NOT FIVE. With only the accumulation
         reverted, a turn that was ENTIRELY held left turnText empty, so neither the quiet timer nor
         onend ever called submit() and the refusal was never reported at all — the control then
         failed on "the overlapping utterance was DROPPED SILENTLY" instead of on the splice it
         exists to demonstrate. Round 5 armed both on `finalText.trim() || heldText.trim()`, and a
         control has to be the whole of what it claims to restore. */
      { from: "    var turnText = '', turnHeld = false, segTag = {}, absorbed = {};",
        to: "    var turnText = '', heldText = '', turnHeld = false, segTag = {}, absorbed = {};" },
      { from: "        if (segTag[i] === 'held') turnHeld = true;\n", to: '' },
      { from: "            if (pvIsSelfEcho(piece)) turnHeld = true;\n            turnText += (turnText ? ' ' : '') + piece;",
        to: "            if (segTag[i] === 'held' || pvIsSelfEcho(piece)) heldText += (heldText ? ' ' : '') + piece;\n            else turnText += (turnText ? ' ' : '') + piece;" },
      { from: '      var whole = turnText.trim(), held = turnHeld, began = turnBeganAt;',
        to: "      var whole = turnText.trim(), held = heldText.trim(), began = turnBeganAt; heldText = '';" },
      { from: '      if (!whole) return;',
        to: '      if (held && onOverlap) safe(function () { onOverlap(held); });\n      if (!whole) return;' },
      /* ⚠️ AND THE av-6.3.2 REFUSAL BRANCH GOES DEAD WITH IT, which is the point: with the branch
         unreachable the restart gate never arms either, so this control restores round 5 AND round 6
         in one - two buckets, the remainder filed, and no boundary on what may be filed next. */
      { from: '      if (why) {\n        /* ⛔ THE GATE ARMS IN THE REFUSAL ITSELF',
        to: '      if (false) {\n        /* ⛔ THE GATE ARMS IN THE REFUSAL ITSELF' },
      { from: 'quiet = setTimeout(function () { if (turnText.trim()) submit(); }, 1300);',
        to: 'quiet = setTimeout(function () { if (turnText.trim() || heldText.trim()) submit(); }, 1300);' },
      { from: '      if (turnText.trim()) submit();',
        to: '      if (turnText.trim() || heldText.trim()) submit();' },
      /* and round 5's paint guard, which was per-segment too. Without this edit the control fires
         the PAINTING assertion first (held text drawn on the line the patient is reading the
         question from) — also a real consequence of the revert, but not the splice. */
      { from: '        } else if (!turnHeld) interim += String(r[0].transcript || \'\');',
        to: '        } else if (segTag[i] !== \'held\') interim += String(r[0].transcript || \'\');' },
      { from: '      if (onInterim) onInterim(turnHeld ? \'\' : (turnText + \' \' + interim).trim());',
        to: '      if (onInterim) onInterim((turnText + \' \' + interim).trim());' },
    ],
    expect: 'A REMAINDER WAS FILED AS A COMPLETE ANSWER' },
  /* the same revert, checked by the suite that owns the four permanent negation controls */
  { id: 'T1 the four permanent controls lose their leading words — round 5 restored',
    edits: null,   /* filled in below from A1b: one description of the revert, two subjects */
    copyEditsFrom: 'A1b',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'WAS FILED WITHOUT ITS LEADING WORDS' },
  /* ⚠️ AND THE DIRECTION THIS ONE ACTUALLY GUARDS. With a whole-turn latch, re-tagging clean -> held
     is harmless (the latch is already set), so the interesting case is the OTHER way: the patient
     answers into a silent room and the avatar starts talking mid-answer (the 9-second nudge, an
     apology). Re-tagging then judges their perfectly good answer 'held' and REFUSES it — a dropped
     answer, which is the one outcome this file must never risk. That is the assertion this control
     fires, and it is the reason the first-sighting rule is load-bearing rather than decorative. */
  { id: 'A1c the segment is re-tagged as the patient keeps talking',
    from: "        if (segTag[i] === undefined || already !== undefined) segTag[i] = pvAudioLive() ? 'held' : 'clean';",
    to: "        segTag[i] = pvAudioLive() ? 'held' : 'clean';",
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'A PATIENT\'S ANSWER WAS REFUSED BECAUSE THE AVATAR INTERRUPTED THEM' },
  /* ── AND THE TURN BOUNDARY ITSELF ─────────────────────────────────────────────────────────── */
  { id: 'T3 a cumulative results list is counted twice inside one turn',
    from: '        if (already !== undefined && already === piece) continue;',
    to: '',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'THE SAME WORDS WERE COUNTED TWICE INSIDE ONE TURN' },
  /* my own first version of the same guard: keyed on the INDEX rather than the WORDS, so a reused
     index carrying a new utterance swallowed it and inherited the old segment's audio verdict */
  { id: 'T3c the absorbed guard is keyed on the index instead of the words (two edits)',
    edits: [
      { from: '        if (already !== undefined && already === piece) continue;',
        to: '        if (already !== undefined) continue;' },
      { from: '        if (segTag[i] === undefined || already !== undefined) segTag[i] = pvAudioLive() ? \'held\' : \'clean\';',
        to: '        if (segTag[i] === undefined) segTag[i] = pvAudioLive() ? \'held\' : \'clean\';' },
    ],
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    /* ⚠️ it fires the FIRST half of the pair: with the new words swallowed, the earlier clean
       utterance is filed on its own. Same defect, and this is the message it really produces. */
    expect: 'WORDS SPOKEN OVER A QUESTION WERE FILED UNDER A STALE' },
  /* ⛔ MY OWN FIRST TURN BOUNDARY, RESTORED. It identified the turn by "the highest result index
     seen + 1", which assumes indices keep rising. A rendered proof caught the cost: on a recogniser
     that reuses index 0 for every utterance the loop iterated zero times after the first turn and
     the kiosk went permanently DEAF with the microphone light still on — a worse hang than either
     of the two this round was sent to fix, introduced by the fix for them. */
  /* ⚠️ SIX EDITS, because `absorbed` has to go with it. A five-edit version left `var already =
     absorbed[i];` behind and the control CRASHED with a ReferenceError — and a crash is not a
     control: it proves the file is broken, not that the assertion can see the defect. */
  { id: 'T3b the turn boundary assumes result indices keep rising (six edits)',
    edits: [
      { from: "    var turnText = '', turnHeld = false, segTag = {}, absorbed = {};",
        to: "    var turnText = '', turnHeld = false, segTag = {}, segSeen = -1, turnFrom = 0;" },
      { from: "      turnText = ''; turnHeld = false; segTag = {}; absorbed = {};",
        to: "      turnText = ''; turnHeld = false; turnFrom = segSeen + 1;" },
      /* ⚠️ THE LOOP HEADER APPEARS TWICE IN THE FILE — the interview recogniser and the ambient
         one — AND SO DO THE TWO LINES AROUND IT. The ambient handler differs by one line
         (`if (!kiosk.ambient || kiosk.ambRec !== rec) return;` between the handler and `var interim`),
         so the anchor reaches back to `rec.onresult` with `var interim` immediately after it. That
         shape belongs to pvListen alone. A revert that matched both would be patching a function
         this control says nothing about — and the harness's own count check is what caught it. */
      { from: 'rec.onresult = function (ev) {\n      var interim = \'\';\n      for (var i = ev.resultIndex; i < ev.results.length; i++) {',
        to: 'rec.onresult = function (ev) {\n      var interim = \'\';\n      for (var i = (ev.resultIndex > turnFrom ? ev.resultIndex : turnFrom); i < ev.results.length; i++) {\n        if (i > segSeen) segSeen = i;' },
      { from: '        var already = absorbed[i];\n        if (already !== undefined && already === piece) continue;\n', to: '' },
      { from: "        if (segTag[i] === undefined || already !== undefined) segTag[i] = pvAudioLive() ? 'held' : 'clean';",
        to: "        if (segTag[i] === undefined) segTag[i] = pvAudioLive() ? 'held' : 'clean';" },
      { from: '          absorbed[i] = piece;     /* the WORDS taken into this turn; see the note on `absorbed` */\n', to: '' },
    ],
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'THE KIOSK IS DEAF AFTER ITS FIRST ANSWER' },
  /* ⚠️ THE TEARDOWN GOES BACK EXACTLY WHERE ROUND 5 HAD IT — after the refusal returns, so an
     all-echo turn still keeps the microphone. Inserting it one line earlier (right after endTurn)
     also broke the echo case, so the control fired the echo group's assertion instead of the one it
     was written for: a control has to reproduce the defect, not a superset of it. */
  { id: 'T4 submit() tears the microphone down again (the half-teardown, round-5 placement)',
    from: '      if (onFinal) onFinal(whole);',
    to: '      if (pvRec === rec) { safe(function () { rec.stop(); }); pvRec = null; }\n      if (onFinal) onFinal(whole);',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'submit() STOPPED THE RECOGNISER' },
  { id: 'T5 kioskTurn closes the microphone on every turn again',
    from: "    pvAbandonSpeech();\n    kioskMood('thinking', '', answer);",
    to: "    pvStopVoice();\n    kioskMood('thinking', '', answer);",
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'A FUNCTION THAT IS NOT A LIFECYCLE BOUNDARY CLOSES THE MICROPHONE' },
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
    from: '    if (pvAudioLive()) {\n      kiosk.audioWaits = (kiosk.audioWaits || 0) + 1;',
    to: '    if (false) {\n      kiosk.audioWaits = (kiosk.audioWaits || 0) + 1;',
    expect: 'THE WATCHDOG STILL FIRES OVER A LIVE SENTENCE' },
  { id: 'A7b the watchdog fence reads the ESTIMATE instead of the audio',
    from: '    if (pvAudioLive()) {\n      kiosk.audioWaits = (kiosk.audioWaits || 0) + 1;',
    to: '    if (pvSaying) {\n      kiosk.audioWaits = (kiosk.audioWaits || 0) + 1;',
    expect: 'THE WATCHDOG FIRES WHILE THE LOUDSPEAKER IS STILL PLAYING' },
  /* ⛔ ROUND 5's OWN LINE: the watchdog returns and walks away from the only timer that can revive
     a stalled question. Silent, and invisible to a suite that only asserted "nothing happened". */
  { id: 'A7c the watchdog returns without re-arming (round 5 restored)',
    from: '    if (pvAudioLive()) {\n      kiosk.audioWaits = (kiosk.audioWaits || 0) + 1;\n      kioskArmWatchdog(pvAudioRemainingMs() + 750);\n      return;\n    }',
    to: '    if (pvAudioLive()) return;',
    expect: 'THE WATCHDOG STILL FIRES OVER A LIVE SENTENCE' },
  /* ── av-6.3.2: THIS ROUND'S OWN REGRESSION, PUT BACK AS A CONTROL ───────────────────────────
     ⛔ These are the av-6.3.1 BYTES, verbatim, not a synthetic mutant: a cap that FALLS THROUGH onto
     a live sentence after three waits, so the next statement reached is pvAbandonSpeech() and the
     question is cut mid-word to say "take your time" over it. The pre-fix bytes had no such breach,
     and av-6.3.1's own registered suite asserted the breach as REQUIRED ("a stuck signal must
     degrade to a nudge"). The control for a corrected assertion is therefore a control that restores
     the regression the assertion used to demand — and it must fail by name. */
  { id: 'A7d the watchdog cap falls through onto a live sentence again (av-6.3.1 restored)',
    from: '    if (pvAudioLive()) {\n      kiosk.audioWaits = (kiosk.audioWaits || 0) + 1;\n      kioskArmWatchdog(pvAudioRemainingMs() + 750);\n      return;\n    }',
    to: '    if (pvAudioLive()) {\n      if ((kiosk.audioWaits || 0) < 3) {\n        kiosk.audioWaits = (kiosk.audioWaits || 0) + 1;\n        kioskArmWatchdog(pvAudioRemainingMs() + 750);\n        return;\n      }\n    }',
    expect: 'THE WATCHDOG CUT A LIVE SENTENCE' },
  { id: 'A8 the 12-second net can cut the closing line again',
    from: '      if (pvAudioLive() && n < DONE_NET_MAX) { kioskArmDoneNet(pvAudioRemainingMs() + 750, n + 1); return; }',
    to: '',
    expect: 'did not wait for the loudspeaker at all' },
  /* ⛔ AND ROUND 5's ACTUAL BYTES: the guard was a ONE-SHOT, so when audio was still live at
     t=12000 the net evaporated and nothing could ever end the interview. A permanent hang the
     pre-fix code did not have — its net was unconditional. */
  { id: 'A8d the closing net is a ONE-SHOT again (round 5 restored: the permanent hang)',
    from: '      if (pvAudioLive() && n < DONE_NET_MAX) { kioskArmDoneNet(pvAudioRemainingMs() + 750, n + 1); return; }',
    to: '      if (pvAudioLive()) return;',
    expect: 'THE CHECK-IN HANGS FOR EVER' },
  /* ⚠️ RECORDED HONESTLY: an unbounded extension fires the HANG assertion, not the bound one. That
     is not the control missing its target — it is the measurement saying something worth writing
     down: with the audio signal never going quiet, "extend for ever" and "never finish" are the
     same behaviour (50 timers fired, kioskFinish reached 0 times). The bound assertion exists to
     describe WHY, and this variant proves the pair of them cannot both be satisfied by a poll. */
  { id: 'A8e the closing net extends without a bound (a poll, and a hang wearing a hat)',
    from: '      if (pvAudioLive() && n < DONE_NET_MAX) {',
    to: '      if (pvAudioLive()) {',
    expect: 'THE CHECK-IN HANGS FOR EVER' },
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
    from: "      kioskReAsk(why === 'continuation' ? 'continuation' : 'overlap');",
    to: '      return;',
    expect: 'A PATIENT WAS NOT TOLD THAT THEIR ANSWER WAS DROPPED' },
  { id: 'A11b the kiosk apologises for its own echo',
    from: "      if (why !== 'continuation' && (pvIsSelfEcho(refused) || pvNovelWordCount(tpl, refused) < 1)) {",
    to: '      if (false) {',
    expect: 'THE KIOSK APOLOGISED FOR ITS OWN ECHO' },
  /* ⚠️ AND THE OTHER DIRECTION OF THE SAME EXEMPTION (av-6.3.2): a CONTINUATION must never be
     silenced by the echo test. It only exists because a real answer was already refused, so there is
     a patient waiting to be asked; going quiet leaves them answering a question nobody hears. */
  { id: 'A11c the echo exemption swallows a continuation too',
    from: "      if (why !== 'continuation' && (pvIsSelfEcho(refused) || pvNovelWordCount(tpl, refused) < 1)) {",
    to: '      if (pvIsSelfEcho(refused) || pvNovelWordCount(tpl, refused) < 1) {',
    suite: 'avatar-half-duplex-and-one-live-region.test.js',
    expect: 'A CONTINUATION WAS REFUSED IN SILENCE' },
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
  /* ⚠️ IT FIRES THE MINIMUM-SIZE ASSERTION, and that is the interesting result: with the face still
     laid out, flex squeezes it to 34x34 at 320x568 rather than covering anything. A 34px circle
     satisfies "width equals height" perfectly, which is exactly why the circularity check alone was
     not enough and the floor was added beside it this round. */
  { id: 'B8c the face keeps its desktop size on a phone with the panel open',
    from: "      '#mlsAvKiosk.hasorders #mlsAvKioskFaceWrap{display:none}' +",
    to: '',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'a patient cannot read a face that small' },
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
  /* ══ av-6.3.2 — THE RESTART GATE. ROUND 7's FIXES, ONE REVERT EACH ═══════════════════════════
     ⛔ T7 IS THE CONTROL THAT MATTERS: it restores the ROUND-6 BYTES for the continuation term. Round
     6 refused a held turn and then filed the very next clean turn — and because a "turn" is ended by
     a 1.3-second silence timer, the next clean turn is routinely the SECOND HALF of the same
     sentence. A lens ran the same probe against round 5 and round 6 and got the same strings. */
  { id: 'T7 a continuation is filed as a complete answer again (round 6 restored: the whole defect)',
    from: '      var why = \'\';\n      if (held) why = \'overlap\';\n      else if (pvReAsk && (!pvReAskFrom || began < pvReAskFrom)) why = \'continuation\';',
    to: '      var why = \'\';\n      if (held) why = \'overlap\';',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'A CONTINUATION WAS FILED AS A COMPLETE ANSWER' },
  /* the gate exists but the refusal stops arming it, so it can only ever be armed by a caller that
     remembers to — three refusal paths, and the first one that forgets files the fragment */
  { id: 'T7b the refusal no longer arms the gate, only the caller does',
    from: '        pvReAsk = true; pvReAskFrom = 0;\n',
    to: '',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    /* ⚠️ IT FIRES THE BEHAVIOURAL ASSERTION, NOT THE STRUCTURAL ONE, and that is the honest result:
       T7's continuation fixture runs long before T7(f)'s code reading, and with the refusal no longer
       arming the gate the fragment is filed again. Recorded as what it actually produces. */
    expect: 'A CONTINUATION WAS FILED AS A COMPLETE ANSWER' },
  /* the boundary is stamped at a CALL SITE instead of where a sentence ends. It still works for the
     path somebody remembered; the deferred re-ask (audio still live) never gets a boundary at all. */
  { id: 'T7c the restart boundary leaves finish() for a call site',
    from: '      pvOpenReAsk();\n      if (then) safe(then);',
    to: '      if (then) safe(then);',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'THE RESTART BOUNDARY IS NO LONGER STAMPED WHERE A SENTENCE ENDS' },
  /* round 6's actual patient-facing behaviour: print a hint, say nothing. A patient mid-sentence
     neither reads it nor stops, which is how the remainder arrived as a fresh "complete" turn. */
  { id: 'T7d the re-ask is printed and never spoken (round 6 restored)',
    edits: [
      { from: '    if (pvAudioLive()) {\n      /* still mid-sentence: it finishes, and kioskTurn\'s continuation says this line - see the\n         note above. pvAudioLive(), not pvSaying: an estimated-duration watchdog clears pvSaying\n         while the loudspeaker is still going, and cutting the question is the one thing forbidden. */\n      kiosk.reAskPending = line;\n      return;\n    }\n    kioskReAskSpeak(line);',
        to: '    return;' },
    ],
    suite: 'avatar-half-duplex-and-one-live-region.test.js',
    expect: 'THE RE-ASK IS NOT SPOKEN' },
  /* and the version of this fix that would re-create the owner's original complaint: apologise by
     cutting the question off. Two harms for the price of one. */
  { id: 'T7e the re-ask abandons the sentence it is apologising for',
    from: '    if (pvAudioLive()) {\n      /* still mid-sentence: it finishes, and kioskTurn\'s continuation says this line - see the\n         note above. pvAudioLive(), not pvSaying: an estimated-duration watchdog clears pvSaying\n         while the loudspeaker is still going, and cutting the question is the one thing forbidden. */\n      kiosk.reAskPending = line;\n      return;\n    }\n    kioskReAskSpeak(line);',
    to: '    pvAbandonSpeech();\n    kioskReAskSpeak(line);',
    suite: 'avatar-half-duplex-and-one-live-region.test.js',
    /* ⚠️ IT FIRES THE A10 CENSUS FIRST, which is the better red: the census walks every call site of
       pvStopVoice/pvAbandonSpeech in the whole file and reports any that is neither a human action nor
       fenced against a live sentence. It named kioskReAsk by name and line. Recorded as produced. */
    expect: 'A NEW WAY TO CUT THE AVATAR OFF MID-SENTENCE' },
  /* the discard: without it, the refused fragment is welded to the front of the next answer */
  /* ⛔ MY OWN FIRST VERSION OF THIS FIX, KEPT AS A CONTROL. It armed the gate on the ECHO path too,
     on the reasoning that a wrong audio boundary is a wrong audio boundary. It is not: every word of
     an echo turn is a word we were saying, so the patient contributed nothing — and a room with
     imperfect echo cancellation produces one on nearly every question. Left armed, it DROPPED the
     patient's next real answer (0 of 1 filed, measured with the rendered consent proof). */
  { id: 'T7h the gate arms itself on the avatar\'s own echo and eats the next real answer',
    from: '        pvReAskStandDown();',
    to: '        pvArmReAsk();',
    suite: 'avatar-half-duplex-and-one-live-region.test.js',
    expect: 'THE RESTART GATE STAYED ARMED ON AN ALL-ECHO REFUSAL' },
  { id: 'T7f a refusal no longer discards what the recogniser is holding',
    from: '    safe(function () { if (pvRec && isFn(pvRec.__endTurn)) pvRec.__endTurn(); });',
    to: '',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    expect: 'THE REFUSED WORDS SURVIVED INTO THE NEXT ANSWER' },
  /* and the gate must stand down when an answer is filed whole, or the interview stalls for ever */
  { id: 'T7g the gate never stands down after a whole answer is filed',
    from: '      pvClearReAsk();\n      if (onFinal) onFinal(whole);',
    to: '      if (onFinal) onFinal(whole);',
    suite: 'avatar-turn-is-whole-or-refused.test.js',
    /* ⚠️ the behavioural assertion again, and it is the stronger one: the gate is still armed after a
       whole answer was filed, so every later turn is measured against a stale boundary. */
    expect: 'the gate did not stand down when an answer was filed WHOLE' },
  /* ══ av-6.3.2 — DEFECT 3: THE STATE POPULATION AND THE ROWS THE STYLESHEET CANNOT SEE ═════════ */
  { id: 'B10 the hand-off row stops telling the layout it is there',
    from: '      if (on) root.classList.add(\'resting\'); else root.classList.remove(\'resting\');',
    to: '      if (on) root.classList.add(\'resting\');',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'kioskRestReserve no longer toggles the `resting` reservation class both ways' },
  /* ⚠️ AND THE CALL, WHICH THE RENDERED SWEEP CANNOT SEE. The harness sets the root class from its
     own state list, so a kioskRestShow that stopped setting it would render exactly the same page.
     Only a code-reading assertion catches that, which is why one exists beside the layout ones. */
  { id: 'B10f kioskRestShow stops reserving the sheet\'s area',
    from: '    host.style.display = \'flex\';\n    kioskRestReserve(true);',
    to: '    host.style.display = \'flex\';',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'kioskRestShow shows the hand-off row without telling the layout' },
  { id: 'B10b the phone reserves a row for controls that cannot appear',
    edits: [
      { from: '      \'#mlsAvKiosk.resting #mlsAvKioskSkip{display:none}\' +\n', to: '' },
      { from: '      \'#mlsAvKiosk.hasorders #mlsAvKioskWave{display:none}\' +\n', to: '' },
    ],
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'COVERED' },
  /* ⚠️ THE OVERRIDE IS REVERTED TO THE BASE NUMBER RATHER THAN DELETED, so both rules still exist and
     the drift guard (B10d) cannot fire first. What is left is the layout question on its own: with the
     sheet back at its full 44vh the column has 14-19px less room than it needs and the surplus lands
     on the card. Deleting the rules instead fires the guard-on-the-guard ("fewer than two pairs"),
     which is a real red but not the one this control is for. */
  { id: 'B10c the sheet stops yielding height to the hand-off row',
    edits: [
      { from: '\'#mlsAvKiosk.resting.hasorders #mlsAvKioskOrders{max-height:36vh}\'',
        to: '\'#mlsAvKiosk.resting.hasorders #mlsAvKioskOrders{max-height:44vh}\'' },
      { from: '\'#mlsAvKiosk.resting.hasorders{padding-right:5vw;padding-bottom:calc(36vh + 16px)}\'',
        to: '\'#mlsAvKiosk.resting.hasorders{padding-right:5vw;padding-bottom:calc(44vh + 16px)}\'' },
    ],
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'COVERED' },
  /* the drift guard on the pair, checked by breaking exactly the pairing and nothing else */
  { id: 'B10d the sheet height and the height reserved for it drift apart',
    from: '\'#mlsAvKiosk.resting.hasorders{padding-right:5vw;padding-bottom:calc(36vh + 16px)}\'',
    to: '\'#mlsAvKiosk.resting.hasorders{padding-right:5vw;padding-bottom:calc(30vh + 16px)}\'',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'THE COLUMN RESERVES' },
  { id: 'B10e the typed row takes a hard width again and ignores the reserved gutter',
    from: '\'#mlsAvKioskTypeRow{display:none;gap:10px;width:min(720px,90vw);max-width:100%}\'',
    to: '\'#mlsAvKioskTypeRow{display:none;gap:10px;width:min(720px,90vw)}\'',
    suite: 'avatar-kiosk-text-is-never-covered.test.js',
    expect: 'COVERED' },
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
    /* ⚠️ THE WHOLE OUTPUT, not a regex guess at where the message is. The extractor below used to
       be the only view of a MISS, and it reported "(no assertion text)" whenever the suite failed
       inside an async IIFE (whose catch prints the message with no AssertionError prefix) — so the
       one thing this harness exists to tell me was unreadable exactly when I needed it.
       MLS_CONTROL_SHOW=<id prefix> prints it in full. */
    const first = (out.match(/AssertionError[^\n]*\n?[^\n]*/) ||
      out.split('\n').filter((l) => l.trim()).slice(-1) || ['(no assertion text)'])[0]
      .replace(/\s+/g, ' ').slice(0, 200);
    console.log('MISS ' + v.id + ' — it failed, but on a DIFFERENT assertion than the one written ' +
      'for it: ' + first);
    weak.push(v.id + ' (failed on the wrong assertion)');
  }
  if (process.env.MLS_CONTROL_SHOW && v.id.indexOf(process.env.MLS_CONTROL_SHOW) === 0) {
    console.log('---- full output for ' + v.id + ' ----\n' + out + '\n----');
  }
}
console.log('\n' + ok + ' of ' + VARIANTS.length + ' fixes are proven load-bearing by a control that fails BY NAME.');
if (weak.length) { console.log('NOT PROVEN:\n  ' + weak.join('\n  ')); process.exit(1); }
console.log('Every fix in this change set has a control that fails by name.');

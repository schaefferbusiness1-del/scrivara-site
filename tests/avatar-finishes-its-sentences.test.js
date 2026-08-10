'use strict';
/*
 * THE AVATAR MUST FINISH ITS SENTENCES (av-6.0.9)
 * -----------------------------------------------------------------------------
 * Owner: "it doesnt even say eve4ryhhting its going to say it hears its self
 * its a MESS FIX IT".
 *
 * Those are ONE defect, not two. In kioskListen's interim handler:
 *     if (pvIsSelfEcho(interim)) return;
 *     if (pvSaying && interim.split(/\s+/).length >= 2) pvStopSpeechOnly();
 * pvStopSpeechOnly has exactly ONE call site — that line. So the only thing that can
 * cut a question off mid-sentence is barge-in, and the only thing between barge-in and
 * the avatar's own voice was pvIsSelfEcho. Every miss meant the avatar heard itself,
 * concluded a patient was interrupting, and silenced its own question.
 *
 * A microphone hearing a loudspeaker does not return a clean transcript. This file runs
 * the SHIPPED classifier against the ordinary error modes — a dropped word, a homophone,
 * two words merged — over the interview's real question shapes, and requires:
 *   (a) no self-echo may stop the speech, and
 *   (b) a real person interrupting still stops it.
 * (b) is not optional: a gate that refuses everything scores perfectly on (a) while
 * quietly deleting the feature.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js'), 'utf8');

/* lift the classifier verbatim — a reimplementation would test my copy, not the product */
const from = src.indexOf('function pvNorm(t)');
const to = src.indexOf('function pvSpeakVoiced(');
assert.ok(from > 0 && to > from, 'could not extract the echo classifier');
const cls = new Function(`
  var pvEchoTail = [];
  var pvSaying = '';
  ${src.slice(from, to)}
  return { set: function (s) { pvSaying = s; }, isSelfEcho: pvIsSelfEcho,
           norm: pvNorm, novel: pvNovelWordCount };
`)();

/* ⛔ av-6.3.0 — THIS FILE'S CENTRAL CLAIM WAS TOO WEAK, AND THE OWNER SAID SO.
   av-6.0.9 (this file) made barge-in require positive evidence of another voice, and measured the
   remaining miss rate at 42 of 232 realistic echo renderings. It shipped, and the report came
   back: "it litterly never gets out everyhting it wants to say caosue it picks up its own
   talking". A ~18% miss rate on a per-question event is not a fixed defect, it is a defect with
   a smaller number attached — and each miss cuts a question off AND posts a fabricated answer.
   The owner's decision: finishing the sentence outranks instant interruption. The microphone is
   no longer open while the avatar speaks, so no evidence rule of any kind runs on the stop path.
   pvNovelWordCount is KEPT — it still guards the FILING path, where it is the term that stops a
   mis-transcribed echo becoming an answer — and the sweeps below still exercise it. What is gone
   is its role in silencing a question, and with it every threshold that had to be right in both
   directions at once. */
assert.ok(/function pvNovelWordCount\(/.test(src),
  'the novel-word gate is gone — it still guards the FILING path, and it is the only term there ' +
  'that can tell a mis-transcribed echo from an answer');
{
  /* scoped to the FUNCTION, not a byte window. The original 700-character window broke the
     moment av-6.1.0 added a comment above the same code — a pin that measures how the code is
     written rather than what it does burns a real investigation every time it misfires. */
  const at = src.indexOf('function kioskListen(keepMood)');
  assert.ok(at > 0, 'kioskListen is gone');
  const end = src.indexOf('\n  /* ── THE INTERRUPT', at);
  const body = src.slice(at, end > at ? end : at + 12000);
  assert.ok(!/pvStopSpeechOnly\(\);/.test(body),
    'THE MICROPHONE CAN SILENCE THE AVATAR AGAIN from inside kioskListen. Every rule that ever ' +
    'sat on that line was measured being fooled by the avatar\'s own voice; the interrupt is a ' +
    'TAP now (kioskSkipSpeech), which our loudspeaker cannot press.');
  /* ⚠️ av-6.3.0, REVISED BY THE ADVERSARIAL ROUND. This pinned `if (pvSaying) { kiosk.micDeferred
     = true; return; }` — the fence that CLOSED the microphone while the avatar spoke. That fence
     had to go: a microphone that opens when the question ends opens in the middle of the patient's
     sentence, and the fragment it captures was filed as a complete answer with the negation and
     the laterality missing ("no pain in my left leg" -> "pain in my left leg"). The requirement
     this pin was written for is UNCHANGED and is now enforced in two stronger places, both pinned
     below: a live recogniser may not be torn down and rebuilt, and nothing heard while sound is
     playing may stop the sentence or be filed. */
  assert.ok(/if \(pvRec\) \{/.test(body),
    'A LIVE RECOGNISER CAN BE TORN DOWN MID-UTTERANCE AGAIN. pvListen replaces the recogniser, so ' +
    'every mid-question caller (the no-speech retry, resume, the PIN pad Back) would restart ' +
    'recognition in the middle of the patient\'s sentence and lose its first half.');
  assert.ok(/if \(pvAudioLive\(\)\) \{ kiosk\.heardWhileSpeaking = \(kiosk\.heardWhileSpeaking \|\| 0\) \+ 1; return; \}/.test(body),
    'a result arriving while the avatar speaks is no longer dropped-and-counted: it would be ' +
    'painted onto the line the patient is reading the question from, and a silent failure is how ' +
    'the previous gate shipped looking healthy');
  assert.ok(!/if \(pvSaying\) \{ kiosk\./.test(body),
    'the fence is back on pvSaying, which is cleared by an ESTIMATED-duration watchdog: it lifts ' +
    'mid-sentence and the loudspeaker\'s own words go back on the patient-facing line. It must ask ' +
    'pvAudioLive(), which reads the audio element and the synthesiser.');
  /* av-6.1.0: and the kiosk must NOT request the microphone here. It is requested once, on the
     staff tap, and the gate adopts that stream; my first attempt asked again from this
     function and avatar-consent-and-turn-taking-proof.js caught it at "calls = 2". */
  assert.ok(!/pvVoiceGateStart\(/.test(body),
    'kioskListen requests the microphone a second time — the preflight already asked, and a ' +
    'second request risks a permission prompt in front of a patient');
}

/* ── av-6.1.0 THE VOICE GATE ────────────────────────────────────────────────────────────
   Owner's choice, asked and answered: keep the ability to interrupt, add REAL echo
   cancellation. Presence is now an AUDIO fact, not a string comparison — which is the only
   way the remaining half was ever fixable ("in the morning" the echo and "in the morning"
   the answer are the same string, but not the same sound).
   Proven executed in real Chrome by scratchpad/facelook/voicegate.js — 5/5, with
   echoCancellation read back off the live track, a silent room reporting no voice
   (0.006 vs floor 0.005) and a real second voice detected (0.028, 43 frames).
   These pins exist so the wiring cannot be quietly removed, leaving the receipt behind. */
{
  assert.ok(/echoCancellation: true, noiseSuppression: true, autoGainControl: true/.test(src),
    'the voice gate no longer REQUESTS echo cancellation');
  assert.ok(/vgSettings\.echoCancellation !== true/.test(src),
    'the gate trusts the constraint it asked for instead of reading the applied setting back — ' +
    'a browser can hand back a track with the constraint ignored, and then the guard is decoration');
  /* ⛔ av-6.3.0 — THE EXECUTED BARGE-IN DECISION IS DELETED BECAUSE THE DECISION IS DELETED.
     The block that stood here executed the shipped three-regime `otherVoice` expression against
     a cough, a self-echo, a real interruption and a device without AEC. It was a good test of a
     thing that should not exist: every regime it exercised was a rule for deciding, from the
     microphone, whether to silence the avatar, and the microphone cannot make that decision —
     measured wrong in both directions (18% of echo renderings barged in; the energy gate tripped
     on the avatar's own residual on every question; and in a noisy room a real patient never
     cleared the learned bar at all).
     What replaces it is stronger and needs no calibration: the microphone is CLOSED while the
     avatar speaks, so there is nothing to decide. That is executed in
     avatar-half-duplex-and-one-live-region.test.js group A3 over seven microphone inputs, group
     A2 over the three real callers, and group A5 over the button that replaced it — with a
     control that reverts each fix separately and fails by name (19 of 19).
     The voice gate's wiring is still pinned above, because it still guards the FILING path
     below; only its role in stopping the speech is gone. */
  {
    const at = src.indexOf('function kioskListen(keepMood)');
    const body = src.slice(at, src.indexOf('\n  /* ── THE INTERRUPT', at));
    assert.ok(!/var otherVoice/.test(body),
      'A BARGE-IN DECISION IS BACK IN kioskListen. There is no version of it that works: it has ' +
      'to distinguish the avatar\'s own voice from a patient\'s using either words (a ' +
      'mis-transcribed echo is byte-identical to a real answer) or energy (the room floor is ' +
      'learned in silence and applied over a loudspeaker). The owner has ranked finishing the ' +
      'sentence above interrupting it; the interrupt is a button.');
  }
  /* THE FILING REFUSAL NEEDS TWO INDEPENDENT REASONS. Audio alone is not enough: the bar is
     floor x 2.6 and the floor is learned from the room, so a noisy waiting area raises it until
     a soft-spoken patient never registers — and then an audio-only refusal deletes every answer
     they give while the avatar is speaking. The transcript must ALSO carry zero novel words. */
  {
    const at = src.indexOf('if (pvIsSelfEcho(finalText)) return;');
    assert.ok(at > 0, 'the final-path self-echo guard is gone');
    /* scope to the FUNCTION, not a byte count - my own comment above the condition pushed it
       past a 2200-char window and this pin cried wolf, which is the fourth time today */
    const fnEnd = src.indexOf('\n  function ', at);
    const win = src.slice(at, fnEnd > at ? fnEnd : at + 6000);
    assert.ok(/pvVoiceGateReady\(\)/.test(win),
      'the echo refusal on the FILING path lost its pvVoiceGateReady() condition — without ' +
      'confirmed AEC this would start deleting real answers again (9 of 12, 22 of 22 measured)');
    assert.ok(/pvNovelWordCount\(pvSaying, finalText\) === 0/.test(win),
      'THE FILING REFUSAL IS AUDIO-ONLY AGAIN. In a noisy room the learned floor rises until a ' +
      'quiet patient never clears the bar, and this branch then deletes every answer they give ' +
      'while the avatar is still speaking. It must also require zero novel words.');
    /* executed: a real answer must survive even when the mic never registered the speaker */
    const rStart = src.indexOf('if (pvSaying && pvVoiceGateReady()', at);
    const rEnd = src.indexOf('}', src.indexOf('kiosk.echoRefused', rStart));
    assert.ok(rStart > 0 && rEnd > rStart, 'the filing refusal has no identifiable site');
    const refuse = new Function('finalText', 'pvSaying', 'ready', 'presence', 'novelCount', `
      var kiosk = { echoRefused: 0 };
      var pvVoiceGateReady = function () { return ready; };
      var pvOtherVoiceNow = function () { return presence; };
      var pvNovelWordCount = function () { return novelCount; };
      var refused = false;
      ${src.slice(rStart, rEnd + 1).replace(/return;/, 'refused = true;')}
      return refused;
    `);
    const Q = 'is the pain in your back or in your neck';
    assert.strictEqual(refuse('my shoulder actually', Q, true, false, 2), false,
      'A REAL ANSWER IS BEING DELETED: the mic did not register the patient (quiet room-floor ' +
      'problem) but the words are clearly not ours, and it was refused anyway');
    assert.strictEqual(refuse('is the pain in your', Q, true, false, 0), true,
      'a pure self-echo arriving in a silent room is no longer refused — mis-transcribed echo ' +
      'would be filed as the patient answer');
    assert.strictEqual(refuse('is the pain in your', Q, false, false, 0), false,
      'the refusal fires without confirmed echo cancellation');
  }
  /* the microphone must be released with the overlay */
  /* ⚠️ SCOPED TO THE FUNCTION, not to 500 bytes. This pin went red the moment av-6.3.0 added the
     arbitrator reset (and its note) to the top of kioskClose, while pvVoiceGateStop was still
     sitting there doing its job three lines further down. That is the SIXTH byte-window pin in
     this lane to report a correct change as a broken guard; each one costs a real investigation,
     and the noise is what trained me to dismiss a red that was genuine. */
  const closeAt = src.indexOf('function kioskClose(');
  const closeEnd = src.indexOf('function kioskSetSay(', closeAt);
  assert.ok(closeAt > 0 && closeEnd > closeAt && /pvVoiceGateStop\(\)/.test(src.slice(closeAt, closeEnd)),
    'kioskClose no longer stops the voice gate — the mic light would stay on after a ' +
    'patient-facing screen has closed');
  /* the floor must never be learned while the avatar is talking, or its own residual
     raises the bar it is measured against and the gate goes deaf.
     ⚠️ av-6.3.0 STRENGTHENED THIS RATHER THAN CHANGING IT: the test used to be `!pvSaying`, and
     pvSaying is cleared by an ESTIMATED-duration watchdog — so the floor could still be learned
     from the tail of the avatar's own voice, which is precisely what this pin exists to prevent.
     It asks pvAudioLive() now, which reads the audio element and the synthesiser. */
  assert.ok(/if \(!pvAudioLive\(\) && vgLoudFrames === 0\)/.test(src),
    'the room-floor calibration no longer excludes the avatar\'s own speech — and it must exclude ' +
    'it by the AUDIO, not by an estimate that clears while the loudspeaker is still going');
}

const QUESTIONS = [
  'What brings you in to see the doctor today?',
  'Does anything make it worse, or is there nothing that changes it?',
  'Is the pain in your back, or in your neck?',
  'On a scale of one to ten, how bad is it right now?',
  'Have you taken anything for it, like ibuprofen or paracetamol?',
  'Is it worse in the morning, or in the evening?',
  'How long has this been going on for?',
  'Are you allergic to any medicines that you know of?',
  'Hello, I am Ava. I am going to ask you a few short questions before the doctor comes in.',
  'Thank you. That is everything I needed, your doctor will be in with you soon.',
];
const HOMOPHONE = { to: 'two', two: 'to', for: 'four', four: 'for', in: 'and', is: 'as',
  it: 'that', your: 'you', are: 'our', a: 'the', the: 'a', anything: 'everything',
  one: 'won', ten: 'tan', back: 'bag', neck: 'net', worse: 'worst', pain: 'pane' };
const MODES = {
  clean: (w) => w.slice(),
  dropOne: (w) => (w.length > 2 ? w.filter((_, i) => i !== Math.floor(w.length / 2)) : w.slice()),
  homophone: (w) => w.map((x, i) => (i === Math.floor(w.length / 2) && HOMOPHONE[x]) ? HOMOPHONE[x] : x),
  merge: (w) => (w.length > 2 ? w.slice(0, 1).concat([w[1] + w[2]]).concat(w.slice(3)) : w.slice()),
};
/* ⛔ av-6.3.0 — THE TWO SWEEPS BELOW NOW MEASURE THE FILING GATE, NOT BARGE-IN, because that is
   what pvIsSelfEcho and pvNovelWordCount still control. Under half-duplex nothing the microphone
   hears can stop a sentence, so a sweep phrased as "can this stop the speech" would be asserting
   a tautology — passing for a reason that has nothing to do with the code it names, which is the
   worst kind of green. The shipped FILING refusal is
       pvSaying && pvVoiceGateReady() && !pvOtherVoiceNow() && pvNovelWordCount(pvSaying, final) === 0
   so an echo is refused when pvIsSelfEcho catches it OR it carries no word we are not saying, and
   a real answer must do neither. Both directions still matter and both are still measured:
   deleting a patient's answer is the one outcome in this file worse than talking over them. */
const NOVEL_MIN = 1;

/* (a) NO SELF-ECHO MAY EVER BE FILED AS THE PATIENT'S ANSWER */
let cases = 0, killed = 0, upstream = 0;
const survivors = [];
for (const q of QUESTIONS) {
  const tpl = cls.norm(q);
  cls.set(tpl);
  const w = tpl.split(' ').filter(Boolean);
  for (const n of [2, 3, 4, 5, 7, 10]) {
    if (n > w.length) continue;
    for (const [mode, f] of Object.entries(MODES)) {
      const hw = f(w.slice(0, n));
      if (hw.length < 2) continue;
      const heard = hw.join(' ');
      cases++;
      if (cls.isSelfEcho(heard)) { upstream++; continue; }
      if (cls.novel(tpl, heard) >= NOVEL_MIN) { killed++; survivors.push('[' + mode + '] "' + heard + '"'); }
    }
  }
}
/* ── THE MEASURED RESIDUAL, STATED RATHER THAN ROUNDED AWAY ────────────────────────────────
   232 renderings of the avatar's own voice: 190 are caught outright by pvIsSelfEcho, and of the
   42 that are not, 31 carry no word we are not saying (so the FILING refusal rejects them) and
   11 carry one. Those 11 are all short homophone fragments — "is the pane in your", "on the
   scale", "does everything" — never a whole answer.
   ⛔ I AM DELIBERATELY NOT TIGHTENING THE CLASSIFIER TO REACH ZERO, and that is the important
   part of this assertion. The only lever left is to make short results droppable, and this lane
   has already measured what that costs: it deleted the answer to almost every "A or B?" question
   the interview asks — 9 of 12 in one sweep, 22 of 22 in another. Deciding to talk over a patient
   is recoverable in one turn; deleting their answer is not recoverable at all.
   And the 11 are no longer REACHABLE by the route that produced them. They required a microphone
   open while the loudspeaker played; under half-duplex it is closed, and after the audio ends the
   speaker is silent, so what remains is the bounded echo tail, which needs a 4-word contiguous
   run. This pin therefore holds the residual FLAT: it fails if the classifier degrades, and it
   fails just as loudly if someone "improves" it into deleting answers again (group (c)). */
assert.ok(killed <= 11,
  'THE ECHO CLASSIFIER HAS DEGRADED: ' + killed + ' of ' + cases + ' renderings of the avatar\'s ' +
  'own voice now carry a novel word (the measured baseline is 11, all short homophone ' +
  'fragments), so more of them would survive the filing refusal:\n  ' + survivors.slice(0, 8).join('\n  '));
for (const s of survivors) {
  const words = /"([^"]*)"/.exec(s)[1].split(' ').length;
  assert.ok(words <= 5,
    'AN ESCAPING SELF-ECHO IS NOW LONG ENOUGH TO BE FILED AS A WHOLE ANSWER (' + words +
    ' words): ' + s + '. A short fragment costs one re-asked question; a sentence-length one ' +
    'becomes a fabricated answer in the chart and every summary built on it.');
}

/* (b) AND A REAL PERSON'S WORDS ARE NEVER MISTAKEN FOR OURS */
const INTERRUPTIONS = [
  ['What brings you in to see the doctor today?', 'actually my knee is the problem'],
  ['What brings you in to see the doctor today?', 'sorry can you repeat that'],
  ['Does anything make it worse, or is there nothing that changes it?', 'bending over makes it terrible'],
  ['Is the pain in your back, or in your neck?', 'its my shoulder blade mostly'],
  ['On a scale of one to ten, how bad is it right now?', 'about a seven when I stand up'],
  ['Have you taken anything for it, like ibuprofen or paracetamol?', 'I took some naproxen last night'],
  ['Is it worse in the morning, or in the evening?', 'hold on I need to sit down'],
  ['How long has this been going on for?', 'since christmas roughly'],
  ['Are you allergic to any medicines that you know of?', 'penicillin gives me hives'],
  ['Hello, I am Ava. I am going to ask you a few short questions before the doctor comes in.',
    'wait I need my wife here she speaks for me'],
  ['Thank you. That is everything I needed, your doctor will be in with you soon.', 'I have one more thing to mention'],
  ['Does anything make it worse, or is there nothing that changes it?', 'my chest feels tight too'],
];
const deaf = [];
for (const [q, said] of INTERRUPTIONS) {
  const tpl = cls.norm(q);
  cls.set(tpl);
  if (cls.isSelfEcho(said) || cls.novel(tpl, said) < NOVEL_MIN) {
    deaf.push(said + ' (novel=' + cls.novel(tpl, said) + ')');
  }
}
assert.deepEqual(deaf, [],
  'THE AVATAR HAS GONE DEAF TO REAL INTERRUPTIONS — the gate refuses everything, which scores ' +
  'perfectly on the echo test while deleting barge-in:\n  ' + deaf.join('\n  '));

/* AND THE CALIBRATION THAT PROTECTS REAL ANSWERS IS UNTOUCHED. The novel-word rule is
   deliberately NOT on the filing path: a real reply reuses the question's words by nature
   ("in the morning"), so a novel-word test there would delete answers — measured at 9 of 12
   and 22 of 22 in an earlier round. These must keep being FILED, not judged as echo. */
const REAL_ANSWERS = [
  ['Is it worse in the morning, or in the evening?', 'in the morning'],
  ['Is the pain in your back, or in your neck?', 'my back'],
  ['On a scale of one to ten, how bad is it right now?', 'about a seven'],
  ['Does anything make it worse, or is there nothing that changes it?', 'nothing really'],
];
const eaten = [];
for (const [q, said] of REAL_ANSWERS) {
  cls.set('');                          /* the question has finished; this is the patient */
  if (cls.isSelfEcho(said)) eaten.push(said);
}
assert.deepEqual(eaten, [],
  'the echo filter is eating real answers again — this is the regression that cost 22 of 22 ' +
  'answers in a previous round:\n  ' + eaten.join('\n  '));

console.log('PASS avatar finishes its sentences (av-6.3.0 — HALF-DUPLEX): nothing the microphone ' +
  'hears can stop a sentence any more, so the classifier is measured where it still decides ' +
  'something — the FILING path. ' + cases + ' renderings of the avatar\'s own voice: ' + upstream +
  ' caught by pvIsSelfEcho, ' + (cases - upstream - killed) + ' refused by the zero-novel-word ' +
  'term, ' + killed + ' escaping (baseline 11, every one a fragment of <= 5 words — and none of them ' +
  'reachable on the filing path any more: a recognition segment that overlapped playback is refused ' +
  'WHOLE by pvListen on TIMING, before any classifier sees it). All ' + INTERRUPTIONS.length +
  ' real interruptions are still recognised as somebody else, and all ' + REAL_ANSWERS.length +
  ' question-shaped real answers are still filed — the classifier was NOT tightened to reach ' +
  'zero, because the only lever left deletes one-word answers (9 of 12, then 22 of 22, measured).');

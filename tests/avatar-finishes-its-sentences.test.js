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

/* the gate must exist AND be wired into the one line that stops the speech */
assert.ok(/function pvNovelWordCount\(/.test(src),
  'the novel-word gate is gone — barge-in is back to "stop unless proven to be our own voice"');
{
  /* scoped to the FUNCTION, not a byte window. The original 700-character window broke the
     moment av-6.1.0 added a comment above the same code — a pin that measures how the code is
     written rather than what it does burns a real investigation every time it misfires. */
  const at = src.indexOf('function kioskListen');
  assert.ok(at > 0, 'kioskListen is gone');
  const end = src.indexOf('\n  function ', at + 20);
  const body = src.slice(at, end > at ? end : at + 6000);
  assert.ok(/pvStopSpeechOnly\(\);/.test(body), 'the barge-in call site left kioskListen');
  assert.ok(/pvNovelWordCount\(pvSaying, interim\)/.test(body),
    'barge-in no longer consults the novel-word count — the interim handler can silence the avatar again');
  assert.ok(/if \(pvSaying && !otherVoice\) return;/.test(body),
    'our own voice is no longer dropped before it can stop the speech or paint the interim line');
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
  /* THE FALLBACK MUST SURVIVE: a device without echo cancellation has to behave exactly as it
     did before av-6.1.0. This is checked by EXECUTING the shipped decision, not by matching its
     shape. The previous form here matched the ternary `pvVoiceGateReady() ? pvOtherVoiceNow() :
     (novel >= 2)`, and it went red the moment the cough fix turned that ternary into an if/else
     — while the fallback it was guarding was still perfectly intact. That is the THIRD pin of
     mine in one change set to fail on how the code is written rather than what it does; each one
     costs a full investigation to clear, and one of them let a real regression reach main because
     the noise trained me to expect false alarms. So: execute it. */
  const dStart = src.indexOf('var otherVoice', src.indexOf('function kioskListen'));
  const dEnd = src.indexOf('if (pvSaying && !otherVoice) return;', dStart);
  assert.ok(dStart > 0 && dEnd > dStart, 'the barge-in decision has no single identifiable site');
  const decide = new Function('interim', 'pvSaying', 'ready', 'presence', 'sustained', 'novelCount', `
    var pvVoiceGateReady = function () { return ready; };
    var pvOtherVoiceNow = function () { return presence; };
    var pvOtherVoiceSustained = function () { return sustained; };
    var pvNovelWordCount = function () { return novelCount; };
    var novel = pvSaying ? pvNovelWordCount(pvSaying, interim) : 0;
    ${src.slice(dStart, dEnd)}
    return !!otherVoice;
  `);
  const Q = 'is the pain in your back or in your neck';
  /* no echo cancellation available — the av-6.0.9 novel-word rule must still be in force */
  assert.strictEqual(decide('my shoulder hurts', Q, false, false, false, 2), true,
    'without echo cancellation a real interruption (2 novel words) no longer barges in — the ' +
    'device lost its protection entirely');
  assert.strictEqual(decide('the pain', Q, false, false, false, 1), false,
    'without echo cancellation a single novel word now cuts the question off — that is the ' +
    'self-echo regression av-6.0.9 measured at 42 of 232');
  assert.strictEqual(decide('', Q, false, false, false, 0), false,
    'without echo cancellation a wordless noise cuts the question off');
  /* and with the gate live, presence alone must NOT be enough (the cough case) */
  assert.strictEqual(decide('', Q, true, true, false, 0), false,
    'with echo cancellation live, bare audio presence cuts the question off — a cough is ' +
    '200-400ms of energy and would silence the avatar');
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
  const closeAt = src.indexOf('function kioskClose(');
  assert.ok(closeAt > 0 && /pvVoiceGateStop\(\)/.test(src.slice(closeAt, closeAt + 500)),
    'kioskClose no longer stops the voice gate — the mic light would stay on after a ' +
    'patient-facing screen has closed');
  /* the floor must never be learned while the avatar is talking, or its own residual
     raises the bar it is measured against and the gate goes deaf */
  assert.ok(/if \(!pvSaying && vgLoudFrames === 0\)/.test(src),
    'the room-floor calibration no longer excludes the avatar\'s own speech');
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
const NOVEL_MIN = 2;

/* (a) NO SELF-ECHO MAY EVER STOP THE SPEECH */
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
assert.strictEqual(killed, 0,
  'THE AVATAR STILL CUTS ITSELF OFF on ' + killed + ' of ' + cases + ' self-echoes:\n  ' +
  survivors.slice(0, 8).join('\n  '));

/* (b) AND A REAL PERSON STILL INTERRUPTS IT */
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

console.log('PASS avatar finishes its sentences: 0 of ' + cases + ' self-echoes can stop the speech (' +
  upstream + ' caught by pvIsSelfEcho, the rest refused by the novel-word gate), all ' +
  INTERRUPTIONS.length + ' real interruptions still barge in, and all ' + REAL_ANSWERS.length +
  ' question-shaped real answers are still filed');

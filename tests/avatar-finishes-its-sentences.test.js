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
  const at = src.indexOf('pvStopSpeechOnly();', src.indexOf('function kioskListen'));
  assert.ok(at > 0, 'the barge-in call site moved');
  const window = src.slice(at - 700, at + 40);
  assert.ok(/pvNovelWordCount\(pvSaying, interim\)/.test(window),
    'barge-in no longer consults the novel-word count — the interim handler can silence the avatar again');
  assert.ok(/if \(pvSaying && !otherVoice\) return;/.test(window),
    'our own voice is no longer dropped before it can stop the speech or paint the interim line');
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

'use strict';
/*
 * "IT SHOULD BE ABLE TO LISTEN WHILE IT IS TALKING" (owner, 2026-08-06), and
 * the complaint behind it: "when the avatar starts listening it doesn't really
 * start listening right away it's delayed and it's unacceptable."
 *
 * The delay was structural, not slow code. Nothing could be heard until this
 * whole chain finished: getUserMedia -> POST /office/turn -> POST /office/tts
 * -> the avatar speaks the ENTIRE question -> only then kioskListen(). A
 * patient who answers as soon as the question makes sense - which is most
 * people, before the sentence ends - had their first words discarded, and the
 * screen appeared to sit there doing nothing.
 *
 * THE RISK THIS CREATES IS WORSE THAN THE BUG IT FIXES: a microphone open
 * during playback hears the AVATAR and files it as the patient's answer,
 * corrupting the intake record. So the order of business is:
 *   1. echoCancellation must be REQUESTED (it was not requested at all),
 *   2. any recognition result that merely echoes the sentence being spoken is
 *      discarded as self-hearing, in BOTH the interim and final paths,
 *   3. only then may the mic open during speech.
 *
 * Barge-in is guarded at two words so a cough, an "mhm" or a nod-noise cannot
 * cut a question off mid-sentence, and it stops the VOICE only - tearing down
 * the recogniser would destroy the very capture that triggered it.
 *
 * ============ av-5.7.0: THE ABOVE SHIPPED AND IT DID NOT WORK ==============
 * Owner, 2026-08-07: "its trying to constantly record which it has to to have
 * normal convos but it records itself talking and doesnt listent for answers
 * and is just a mess."
 *
 * BOTH HALVES OF THAT SENTENCE WERE A REAL DEFECT, and this file pinned the
 * cause of one of them as if it were the cure:
 *
 *   A. IT RECORDED ITSELF. Chrome finalises a recognition result hundreds of
 *      milliseconds - sometimes seconds - after the words were spoken. The echo
 *      template was cleared the instant the audio ended, so the TAIL of every
 *      question arrived at an empty template, was NOT recognised as self-echo,
 *      and was posted as the patient's answer. The old assertion here demanded
 *      exactly that clearing ("or later answers are wrongly suppressed") - a
 *      real concern with the wrong remedy. The template now survives the speech
 *      for a BOUNDED PV_ECHO_TAIL_MS and every entry expires by wall clock, so
 *      both failures are closed: the tail cannot be filed as an answer, and a
 *      patient who answers in the question's own words four seconds later is
 *      still heard.
 *   B. IT STOPPED LISTENING. The filter ran only in the CALLER, so the avatar's
 *      own words were accumulated into pvListen's finalText, submitted - which
 *      stops the recogniser and nulls pvRec - and only then rejected. The mic
 *      was dead, no answer had been taken, and nothing re-opened it: the 9s
 *      watchdog was the only path back, once per question. The filter now runs
 *      at the SOURCE, per result, and submit() refuses to tear the recogniser
 *      down when there is nothing left to send.
 *   C. A BARE "no" WAS DELETED. The containment test used indexOf, which
 *      matches INSIDE words, so any question carrying "not", "know", "now" or
 *      "none" silently ate a one-word refusal - the most consequential answer
 *      in an intake ("any allergies?" / "chest pain?"). Matching is now on word
 *      boundaries, and a single word is never treated as the echo of a
 *      sentence.
 *
 * THE CONTROL: set MLS_AVATAR_SRC to a checkout of the previous file and the
 * executed section below fails on cases A and C by name. That is the only
 * reason this file is worth anything - it was green against the code that had
 * the defect the owner reported.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
/* read-only test input, so the same assertions can be run against an older
   copy of the module as a negative control */
const srcPath = process.env.MLS_AVATAR_SRC || path.join(root, 'feat_mls_avatar.js');
const source = fs.readFileSync(srcPath, 'utf8');

/* ---- 1. the prerequisite ---- */
assert(/getUserMedia\(\{\s*\n?\s*audio: \{ echoCancellation: true, noiseSuppression: true, autoGainControl: true \}/.test(source),
  'echoCancellation/noiseSuppression/autoGainControl must be REQUESTED — without them an open mic during playback transcribes the avatar');

/* ---- 2. self-echo can never reach the answer ---- */
assert(source.includes('function pvIsSelfEcho'), 'the self-echo detector was removed');
assert(/onInterim[\s\S]{0,200}pvIsSelfEcho\(interim\)/.test(source) || /if \(pvIsSelfEcho\(interim\)\) return;/.test(source),
  'the INTERIM path must drop self-echo');
assert(source.includes('if (pvIsSelfEcho(finalText)) return;'),
  'the FINAL path must drop self-echo — this is the one that would file the avatar as the patient');
assert(/pvSaying = pvNorm\(t\);/.test(source), 'the spoken sentence must be recorded for echo comparison');

/* ---- 2b. av-5.7.0 — the filter runs at the SOURCE, and an all-echo result
   does not cost the microphone ---- */
assert(/if \(piece && pvIsSelfEcho\(piece\)\) continue;/.test(source),
  'the echo filter must run INSIDE pvListen, per result — filtering only in the caller means the avatar\'s words enter finalText and the whole answer is rejected with them');
{
  const at = source.indexOf('function pvListen');
  const listen = source.slice(at, source.indexOf('/* ======', at));
  assert(/function submit\(\)[\s\S]{0,1200}if \(!v\) return;[\s\S]{0,200}rec\.stop\(\)/.test(listen),
    'submit() must refuse BEFORE stopping the recogniser when nothing survived the filter — otherwise one echo leaves the kiosk deaf until the 9s watchdog');
}
/* the template must OUTLIVE the speech, boundedly. Both halves are asserted:
   it is handed to the tail, and it is still cleared. */
assert(/finished = true;[\s\S]{0,400}pvEchoHold\(pvSaying\);\s*\n\s*pvSaying = '';/.test(source),
  'when speech finishes the spoken sentence must move to the BOUNDED echo tail and pvSaying must clear — clearing it outright is what filed the avatar\'s own questions as answers');
assert(/pvEchoHold\(pvSaying\);\s*\n\s*pvSaying = '';/.test(source.slice(source.indexOf('function pvStopSpeechOnly'), source.indexOf('function pvStopVoice'))),
  'barge-in must hold the tail too — the words already out of the speaker are still travelling through the recogniser');
assert(/var PV_ECHO_TAIL_MS = \d+;/.test(source), 'the echo tail must be bounded by a named constant');
assert(/pvEchoDrop\(\);/.test(source), 'ambient room mode must DROP the tail — a room capture is verbatim');

/* ---- 3. the mic opens WITH the question ---- */
assert(source.includes('kioskListen(true);'), 'the mic must open alongside the question, not after it');
/* av-5.8.1 gave the speak call a delivery SHAPE, so the entry point is now pvSpeakShaped.
   The ordering guarantee is unchanged and is what this asserts; `pvSpeak[A-Za-z]*` admits the
   renamed entry without admitting anything that is not a speak call. */
assert(/kioskListen\(true\);[\s\S]{0,200}pvSpeak[A-Za-z]*\(kiosk\.lastSay/.test(source),
  'listening must start BEFORE/with the speak call, not in its completion callback');
assert(source.includes('function kioskListen(keepMood)'), 'kioskListen must accept the keep-mood flag');
assert(source.includes('if (keepMood && pvRec) return;'), 'opening the mic twice for one question must be a no-op');
/* av-5.7.0: and the silence clock starts when the QUESTION ENDS. Armed from
   kioskListen it started when the question began, so a six-second question left
   three seconds before the kiosk talked over the patient's first words. */
assert(/pvSpeak[A-Za-z]*\(kiosk\.lastSay, function \(\) \{[\s\S]{0,600}kioskArmWatchdog\(9000\);/.test(source),
  'the silence watchdog must be re-armed when the question finishes playing, not when it starts');

/* ---- 4. barge-in stops the VOICE only, and is guarded ---- */
assert(source.includes('function pvStopSpeechOnly'), 'barge-in must not tear down the recogniser');
assert(/pvStopSpeechOnly\(\);\s*\n\s*var iv/.test(source) || />= 2\) pvStopSpeechOnly\(\);/.test(source),
  'barge-in must fire from the interim path');
assert(/var otherVoice = pvSaying[\s\S]{0,180}\? \(novel >= 2\)[\s\S]{0,500}if \(pvSaying && otherVoice\) pvStopSpeechOnly\(\);/.test(source),
  'barge-in must require two novel words — a cough, "mhm", or misheard self-echo must not cut the question off');
assert(!/pvStopSpeechOnly[\s\S]{0,400}pvRec = null/.test(source.slice(source.indexOf('function pvStopSpeechOnly'), source.indexOf('function pvStopVoice'))),
  'pvStopSpeechOnly must leave the recogniser alive');

/* ---- 5. EXECUTED: the self-echo filter actually classifies correctly ---- */
const sandbox = { console };
vm.createContext(sandbox);
/* the slice starts at the echo-tail constant so the tail helpers come with it -
   the classifier cannot be executed without them */
const cut = source.indexOf('var PV_ECHO_TAIL_MS') >= 0 ? source.indexOf('var PV_ECHO_TAIL_MS') : source.indexOf('function pvNorm');
const normSrc = source.slice(cut, source.indexOf('function pvSpeakVoiced'));
vm.runInContext("var pvSaying='';" + normSrc +
  "\nthis.pvNorm=pvNorm; this.pvIsSelfEcho=pvIsSelfEcho; this.setSaying=function(v){pvSaying=v;};" +
  "\nthis.hold=(typeof pvEchoHold==='function')?function(v){pvEchoHold(v);}:function(){};" +
  "\nthis.expire=function(){try{for(var i=0;i<pvEchoTail.length;i++)pvEchoTail[i].until=Date.now()-1;}catch(e){}};" +
  "\nthis.dropTail=(typeof pvEchoDrop==='function')?function(){pvEchoDrop();}:function(){};", sandbox);

const QUESTION = 'How bad is the pain right now, on a scale of zero to ten?';
sandbox.setSaying(sandbox.pvNorm(QUESTION));
// the avatar hearing itself, in whole or in part -> ALWAYS discarded
assert.strictEqual(sandbox.pvIsSelfEcho('how bad is the pain right now'), true, 'a slice of our own sentence is self-echo');
assert.strictEqual(sandbox.pvIsSelfEcho('on a scale of zero to ten'), true, 'a later slice is self-echo');
assert.strictEqual(sandbox.pvIsSelfEcho(QUESTION), true, 'the whole sentence is self-echo');
// the PATIENT answering -> never discarded
assert.strictEqual(sandbox.pvIsSelfEcho('about a seven'), false, 'a real answer must not be mistaken for self-echo');
assert.strictEqual(sandbox.pvIsSelfEcho('my back has been killing me for three weeks'), false, 'a long real answer must survive');
assert.strictEqual(sandbox.pvIsSelfEcho('seven'), false, 'a one-word answer must survive');

/* ---- 5a. THE DEFECT THE OWNER REPORTED. The audio has stopped; Chrome
   delivers the tail of the question a moment later. It must still be self-echo,
   because the alternative is what happened: the avatar's own question posted as
   the patient's answer, and every summary built on top of it. ---- */
sandbox.dropTail();
sandbox.hold(sandbox.pvNorm(QUESTION));      /* what finish() now does */
sandbox.setSaying('');                        /* ...and pvSaying still clears */
assert.strictEqual(sandbox.pvIsSelfEcho('on a scale of zero to ten'), true,
  'A: a late final result carrying the tail of the question the avatar JUST finished must still be self-echo');
assert.strictEqual(sandbox.pvIsSelfEcho('how bad is the pain right now'), true,
  'A: the same for the front of the sentence');
/* and it must be BOUNDED - the patient answering in the question's own words a
   few seconds later is a real answer, not an echo */
sandbox.expire();
assert.strictEqual(sandbox.pvIsSelfEcho('on a scale of zero to ten'), false,
  'A: the echo tail must EXPIRE — a permanent template would silence a patient who answers in the question\'s words');
assert.strictEqual(sandbox.pvIsSelfEcho('about a seven'), false, 'A: real answers unaffected either side of the tail');

/* ---- 5b. A BARE REFUSAL SURVIVES A QUESTION THAT CONTAINS "know"/"not". The
   old containment test matched inside words, so "no" was eaten by "know" - and
   "no" is the answer to "any chest pain?" and "any allergies?". ---- */
const NOSY = 'Do you know if anything makes it worse, or is there nothing that changes it?';
sandbox.dropTail();
sandbox.setSaying(sandbox.pvNorm(NOSY));
assert.strictEqual(sandbox.pvIsSelfEcho('no'), false,
  'C: a one-word "no" must survive a question containing "know" and "nothing" — indexOf matched inside words and deleted it');
assert.strictEqual(sandbox.pvIsSelfEcho('now'), false, 'C: and any other short word that is a substring of the question');
/* the answer a patient actually gives to that question is built almost
   entirely out of the question's own words. It is a real answer and it must
   survive - this is the case that stops the tail from being made permanent. */
assert.strictEqual(sandbox.pvIsSelfEcho('no nothing makes it worse'), false,
  'C: "no, nothing makes it worse" is the ANSWER to that question, not an echo of it');
assert.strictEqual(sandbox.pvIsSelfEcho(NOSY), true,
  'C: a full echo of the question is still caught — the boundary fix must not blunt the detector');

/* ---- 5c. THE REGIME BOUNDARY, stated out loud. "worse at night" is both the
   tail of the question and the whole answer to it. While the speaker is ACTIVE
   it is our own voice (and the server has the question anyway). Once the
   speaker has stopped it is the PATIENT, and a three-word quote is no longer
   evidence of anything. The window is short for the same reason. ---- */
const NIGHT = 'Is the pain worse at night?';
sandbox.dropTail();
sandbox.setSaying(sandbox.pvNorm(NIGHT));
assert.strictEqual(sandbox.pvIsSelfEcho('worse at night'), true,
  'while the question is still playing, a quote of it is the microphone hearing the speaker');
sandbox.hold(sandbox.pvNorm(NIGHT));
sandbox.setSaying('');
assert.strictEqual(sandbox.pvIsSelfEcho('worse at night'), false,
  'once the question has finished, "worse at night" is the ANSWER — a short quote must not be deleted');
assert.strictEqual(sandbox.pvIsSelfEcho('yes it is definitely worse at night when i lie down'), false,
  'and the long form of that answer survives too');

/* ---- 5d. ⛔ THIS GROUP USED TO ASSERT THE OPPOSITE, AND IT WAS WRONG.
   av-5.7.0 made a one-word result droppable when the avatar was saying that word
   and it was not on a whitelist of answers. This group pinned that behaviour —
   including `pvIsSelfEcho('knee') === true` — which means the suite was ENSHRINING
   a defect: an adversarial review then measured the classifier against ordinary
   intake questions and found it deleted the answer to almost every "A or B?"
   question (9 of 12 in one sweep, 22 of 22 in another, versus 0 for the code it
   replaced). "Is the pain in your back, or in your neck?" → "back" was binned.
   A pin that holds a defect in place is worse than no pin, so the rule was
   reverted and this group now asserts the property that actually matters: A
   ONE-WORD ANSWER IS NEVER DELETED, whatever the avatar happens to be saying.
   The accepted cost is stated in the module: a rare one-word echo fragment gets
   through and the MA persona asks again. ---- */
sandbox.dropTail();
sandbox.setSaying(sandbox.pvNorm('Is the pain in your back, or is it in your neck?'));
assert.strictEqual(sandbox.pvIsSelfEcho('back'), false,
  'D: "back" is the ANSWER to that question — deleting it is the regression this group now guards');
assert.strictEqual(sandbox.pvIsSelfEcho('neck'), false, 'D: and so is the other branch of it');
sandbox.setSaying(sandbox.pvNorm('Is the pain better or worse, or about the same?'));
assert.strictEqual(sandbox.pvIsSelfEcho('worse'), false, 'D: "worse" survives');
assert.strictEqual(sandbox.pvIsSelfEcho('same'), false, 'D: so does "same"');
assert.strictEqual(sandbox.pvIsSelfEcho('pain'), false,
  'D: even the question\'s own noun survives — one word is never the echo of a sentence');
sandbox.setSaying(sandbox.pvNorm('Which knee is bothering you, the left or the right?'));
assert.strictEqual(sandbox.pvIsSelfEcho('left'), false,
  'D: A LATERALITY MUST NEVER BE DELETED — it is the answer that causes a wrong-site error');
assert.strictEqual(sandbox.pvIsSelfEcho('right'), false, 'D: either side of it');
assert.strictEqual(sandbox.pvIsSelfEcho('knee'), false,
  'D: and the noun too — this assertion was inverted in the version that shipped this group');

/* ---- 5e. THE TAIL IS CONTIGUITY ONLY, AND LONG. The overlap branch could
   delete a real answer for 1.6s after the question ended, because a short reply
   reuses the question's words by nature — and the answer it deletes may be the
   red flag. ---- */
const NIGHT2 = 'Is the pain worse at night, or in the morning?';
sandbox.dropTail();
sandbox.setSaying('');
sandbox.hold(sandbox.pvNorm(NIGHT2));
assert.strictEqual(sandbox.pvIsSelfEcho('worse at night'), false,
  'E: a three-word quote AFTER the question is the answer, not an echo');
assert.strictEqual(sandbox.pvIsSelfEcho('in the morning'), false, 'E: and so is the other branch of it');
assert.strictEqual(sandbox.pvIsSelfEcho('is the pain worse at night'), true,
  'E: a long contiguous quote is still caught in the tail');
/* ⛔ THE THREE ASSERTIONS ABOVE ALL PASS AGAINST THE PRE-FIX MODULE, so on their
   own they prove nothing about the change they were written for. Measured: the old
   tail call was pvEchoMatch(tail, h, words, 4, 5), which returns before the overlap
   loop whenever words.length < 5 — so both 3-word cases already returned false and
   the 6-word contiguous one already returned true. The change this group exists to
   pin is the removal of the OVERLAP branch, and only a case with >= 5 words that is
   NOT contiguous can see it. This one was measured on both files: true on the
   pre-fix module (the overlap branch deleted a real answer), false now. */
sandbox.dropTail();
sandbox.setSaying('');
sandbox.hold(sandbox.pvNorm('Do you have any chest pain or pressure when you walk?'));
assert.strictEqual(sandbox.pvIsSelfEcho('chest pain pressure when you walk'), false,
  'E: THE OVERLAP BRANCH IS GONE — a five-word reply built from the question\'s own words, garbled by the recogniser, is the ANSWER and must survive the tail (this is the assertion that fails on the pre-fix module; the three above do not)');

// nothing being spoken and no tail -> nothing is echo
sandbox.dropTail();
sandbox.setSaying('');
assert.strictEqual(sandbox.pvIsSelfEcho('how bad is the pain right now'), false,
  'with silence and an expired tail there is no self-echo — otherwise real answers would be dropped forever');

console.log('PASS avatar listens while speaking: echo cancellation requested, the filter runs at the SOURCE, ' +
  'the echo template outlives the speech but EXPIRES, the tail is contiguity-only so a short reply survives it, ' +
  'and NO ONE-WORD ANSWER IS EVER DELETED — a laterality, a refusal, a number, or the question\'s own noun ' +
  '(the rule that dropped those was reverted after it was measured deleting 9 of 12 ordinary A-or-B answers, ' +
  'and this group used to pin the damage) — ' +
  'an all-echo result never costs the microphone, the mic opens with the question, the silence clock starts when it ends, ' +
  'and barge-in stays guarded at two words');

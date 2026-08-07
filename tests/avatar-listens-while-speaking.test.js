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
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_avatar.js'), 'utf8');

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
assert(/finished = true;\s*\n\s*pvSaying = '';/.test(source), 'pvSaying must clear when speech finishes, or later answers are wrongly suppressed');

/* ---- 3. the mic opens WITH the question ---- */
assert(source.includes('kioskListen(true);'), 'the mic must open alongside the question, not after it');
assert(/kioskListen\(true\);[\s\S]{0,200}pvSpeak\(kiosk\.lastSay/.test(source),
  'listening must start BEFORE/with pvSpeak, not in its completion callback');
assert(source.includes('function kioskListen(keepMood)'), 'kioskListen must accept the keep-mood flag');
assert(source.includes('if (keepMood && pvRec) return;'), 'opening the mic twice for one question must be a no-op');

/* ---- 4. barge-in stops the VOICE only, and is guarded ---- */
assert(source.includes('function pvStopSpeechOnly'), 'barge-in must not tear down the recogniser');
assert(/pvStopSpeechOnly\(\);\s*\n\s*var iv/.test(source) || />= 2\) pvStopSpeechOnly\(\);/.test(source),
  'barge-in must fire from the interim path');
assert(/filter\(Boolean\)\.length >= 2\) pvStopSpeechOnly\(\)/.test(source),
  'barge-in must require two words — a cough or an "mhm" must not cut the question off');
assert(!/pvStopSpeechOnly[\s\S]{0,400}pvRec = null/.test(source.slice(source.indexOf('function pvStopSpeechOnly'), source.indexOf('function pvStopVoice'))),
  'pvStopSpeechOnly must leave the recogniser alive');

/* ---- 5. EXECUTED: the self-echo filter actually classifies correctly ---- */
const sandbox = { console };
vm.createContext(sandbox);
const normSrc = source.slice(source.indexOf('function pvNorm'), source.indexOf('function pvSpeakVoiced'));
vm.runInContext("var pvSaying='';" + normSrc + "\nthis.pvNorm=pvNorm; this.pvIsSelfEcho=pvIsSelfEcho; this.setSaying=function(v){pvSaying=v;};", sandbox);

sandbox.setSaying(sandbox.pvNorm('How bad is the pain right now, on a scale of zero to ten?'));
// the avatar hearing itself, in whole or in part -> ALWAYS discarded
assert.strictEqual(sandbox.pvIsSelfEcho('how bad is the pain right now'), true, 'a slice of our own sentence is self-echo');
assert.strictEqual(sandbox.pvIsSelfEcho('on a scale of zero to ten'), true, 'a later slice is self-echo');
assert.strictEqual(sandbox.pvIsSelfEcho('How bad is the pain right now, on a scale of zero to ten?'), true, 'the whole sentence is self-echo');
// the PATIENT answering -> never discarded
assert.strictEqual(sandbox.pvIsSelfEcho('about a seven'), false, 'a real answer must not be mistaken for self-echo');
assert.strictEqual(sandbox.pvIsSelfEcho('my back has been killing me for three weeks'), false, 'a long real answer must survive');
assert.strictEqual(sandbox.pvIsSelfEcho('seven'), false, 'a one-word answer must survive');
// nothing being spoken -> nothing is echo
sandbox.setSaying('');
assert.strictEqual(sandbox.pvIsSelfEcho('how bad is the pain right now'), false,
  'with silence there is no self-echo — otherwise real answers would be dropped after the question ends');

console.log('PASS avatar listens while speaking: echo cancellation requested, self-echo dropped in both paths ' +
  '(7 executed cases), mic opens with the question, barge-in guarded at two words and leaves the recogniser alive');

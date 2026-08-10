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
/* ⚠️ av-6.3.0 — SAME REQUIREMENT, DIFFERENT VERB, AND THE VERB IS THE FIX. This used to pin
   `if (piece && pvIsSelfEcho(piece)) continue;` — the echo piece was skipped and the pieces around
   it were CONCATENATED, which is an EDIT of a transcript that may be the patient's. That is the
   critical finding of the review round: an utterance must be accepted whole or refused whole, and
   a spliced one is neither. The filter still runs at the source, per segment, and an all-echo
   result still costs nothing; what changed is that the segment it recognises goes to the REFUSED
   bucket (which is counted and reported to the caller) instead of being deleted from the middle of
   a string that is then filed as complete. */
/* ⚠️ av-6.3.1 — SAME REQUIREMENT, ONE BOUNDARY COARSER, AND THAT IS THE FIX. This pinned
   `pvIsSelfEcho(piece)) heldText +=` — the echo segment went to a REFUSED bucket and the other
   segments were still filed. Two buckets is a splice with a nicer name: a held leading segment
   refused and the clean remainder filed as a complete answer is the identical inversion the
   `continue` version had ("no pain in my" + "left leg" files as "left leg"). There is one
   accumulation now, and an echo POISONS THE WHOLE TURN instead of being separated out of it. */
assert(/pvIsSelfEcho\(piece\)\) turnHeld = true;/.test(source),
  'the echo filter must run INSIDE pvListen, per segment, and mark the whole TURN — filtering only ' +
  'in the caller means the avatar\'s words enter the answer and the whole answer is rejected with ' +
  'them, and diverting the segment into a second bucket files the remainder as a complete answer');
assert(!/pvIsSelfEcho\(piece\)\) continue;/.test(source),
  'A SEGMENT IS BEING SKIPPED IN THE MIDDLE OF AN ACCUMULATION AGAIN. Dropping one piece and ' +
  'concatenating the rest edits the patient\'s transcript and then files the edit as a complete ' +
  'answer — the exact class of defect that turns "no pain in my left leg" into "pain in my left leg".');
{
  const at = source.indexOf('function pvListen');
  /* ⚠️ COMMENTS BLANKED FIRST, LINE FOR LINE. The comment that explains the old half-teardown
     QUOTES it (`if (pvRec === rec) { rec.stop(); pvRec = null; }`), so the first version of the
     scan below reported the module's own documentation as the defect — the eighth time in this lane
     a text grep has failed to tell code from prose. */
  const listen = source.slice(at, source.indexOf('/* ======', at))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  /* ⛔ STRONGER THAN IT WAS. This used to require submit() to refuse BEFORE `rec.stop()`, i.e. it
     accepted a submit() that tore the microphone down on the way past. It must not tear it down at
     ALL: closing the recogniser between turns forces the next turn to build a new one, and a
     recogniser that starts listening at a moment nobody chose cannot know whether the first thing
     it hears is the middle of the patient's sentence. The only complete microphone teardown in the
     file is pvStopMicOnly, and submit() is not one of its callers. */
  assert(!/function submit\(\)[\s\S]{0,2600}rec\.stop\(\)/.test(listen),
    'submit() TEARS THE MICROPHONE DOWN. It must end the TURN and leave the recogniser live: a ' +
    'rebuilt recogniser clips the front off the next answer, and the half-teardown it used to do ' +
    '(stop + null pvRec, but no killQuiet, no handler nulling, no accumulation reset) also let a ' +
    'trailing result re-enter submit() and file the same answer twice.');
  assert(/function endTurn\(\)/.test(listen) && /endTurn\(\);/.test(listen),
    'there is no single place that ends a turn any more, so the accumulation, the overlap latch and ' +
    'the quiet timer are reset from wherever an author remembers — which is how `finalText` survived ' +
    'a submit and was filed a second time');
}
/* the template must OUTLIVE the speech, boundedly. Both halves are asserted:
   it is handed to the tail, and it is still cleared. */
assert(/finished = true;[\s\S]{0,400}pvEchoHold\(pvSaying\);\s*\n\s*pvSaying = '';/.test(source),
  'when speech finishes the spoken sentence must move to the BOUNDED echo tail and pvSaying must clear — clearing it outright is what filed the avatar\'s own questions as answers');
assert(/pvEchoHold\(pvSaying\);\s*\n\s*pvSaying = '';/.test(source.slice(source.indexOf('function pvStopSpeechOnly'), source.indexOf('function pvStopVoice'))),
  'barge-in must hold the tail too — the words already out of the speaker are still travelling through the recogniser');
assert(/var PV_ECHO_TAIL_MS = \d+;/.test(source), 'the echo tail must be bounded by a named constant');
assert(/pvEchoDrop\(\);/.test(source), 'ambient room mode must DROP the tail — a room capture is verbatim');

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * ⛔ av-6.3.0 — SECTIONS 3 AND 4 USED TO ASSERT THE OPPOSITE OF WHAT THEY ASSERT NOW, AND THE
 * OWNER IS THE ONE WHO REVERSED THEM.
 *
 * This file's founding requirement was "it should be able to listen while it is talking", and
 * it pinned kioskListen(true) firing BEFORE the speak call. That shipped, and the owner came
 * back twice: "it doesnt even say eve4ryhhting its going to say it hears its self its a MESS",
 * then "it litterly never gets out everyhting it wants to say caosue it picks up its own
 * talking and then everyhting gets so fucked up".
 *
 * An open microphone pointed at the loudspeaker playing the question transcribes the AVATAR.
 * Two releases were spent trying to tell that transcript from a patient's, and neither could:
 *   · a mis-transcribed echo arriving as a FINAL result is byte-identical to a real answer, and
 *     a real answer legitimately reuses the question's words ("in the morning" answering "is it
 *     worse in the morning, or the evening?" carries ZERO novel words) — 42 of 232 realistic
 *     echo renderings reached kioskTurn;
 *   · the audio gate was measured tripping on the avatar's own residual on EVERY question
 *     (bar 0.0208 RMS, residual 0.020, true at frame 4, floor unable to learn out of it).
 * Every miss did BOTH kinds of damage at once: it cut the question off mid-word AND posted a
 * fabricated answer that advanced the interview.
 *
 * THE OWNER'S DECISION IS BINDING: finishing the sentence outranks instant interruption.
 *
 * ⛔ av-6.3.0's FIRST ATTEMPT AT THAT DECISION CLOSED THE MICROPHONE, AND THE ADVERSARIAL ROUND
 * REVERSED IT — for a reason that outranks everything above. A microphone that opens when the
 * question ENDS opens in the MIDDLE of the patient's sentence, because patients answer as soon as
 * they understand (the very observation this file was created for). The recogniser's first result
 * was then the TAIL of an utterance whose head was spoken into a closed microphone, and it was
 * submitted and FILED as a complete answer. English puts negation and laterality at the FRONT:
 * "no pain in my left leg" files as "pain in my left leg". A wrong-site finding written into a
 * chart under a green receipt is a worse outcome than anything an open microphone can cause, and
 * nothing downstream can detect it, because a fragment is byte-identical to a whole answer.
 *
 * So the microphone is open across the question again — and the owner's decision is kept in full
 * by putting the fence on the two DECISIONS that were doing the damage rather than on the
 * microphone itself:
 *   · nothing the microphone hears can stop a sentence (the interim handler does nothing at all
 *     while sound is playing; interruption is a visible BUTTON our loudspeaker cannot press);
 *   · nothing heard while sound was playing can be FILED (pvListen tags every recognition
 *     segment on first sighting with whether it overlapped playback, and refuses the overlapping
 *     ones WHOLE — never spliced, never trimmed, and the patient is told).
 * Both are decided by WHEN audio arrived, a fact this file owns, instead of by WHAT it sounded
 * like — the two classifiers that were measured wrong in both directions above.
 *
 * The executed proof lives in avatar-half-duplex-and-one-live-region.test.js, with a control that
 * fails by name (avatar-half-duplex-control.js). What is kept HERE is the part of this file that
 * is still true and still load-bearing: the echo classifier, which still guards the FILING path,
 * and the ordering of the turn.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/* ---- 3. the mic opens WITH the question, and what it hears then cannot be filed ---- */
assert(source.includes('kioskListen(true);'), 'the mic must open alongside the question, not after it');
/* av-5.8.1 gave the speak call a delivery SHAPE, so the entry point is now pvSpeakShaped.
   The ordering guarantee is unchanged and is what this asserts; `pvSpeak[A-Za-z]*` admits the
   renamed entry without admitting anything that is not a speak call. */
assert(/kioskListen\(true\);[\s\S]{0,200}pvSpeak[A-Za-z]*\(kiosk\.lastSay/.test(source),
  'THE MICROPHONE IS BEING OPENED AFTER THE QUESTION AGAIN. It then opens in the middle of the ' +
  'patient\'s sentence and files the tail as a complete answer, with the negation and the ' +
  'laterality missing — the critical finding of the av-6.3.0 review round.');
assert(source.includes('function kioskListen(keepMood)'), 'kioskListen must accept the keep-mood flag');
/* ⚠️ STRONGER THAN THE OLD `if (keepMood && pvRec) return;`. A live recogniser may not be rebuilt
   by ANY caller, keepMood or not: pvListen tears the old one down, and a teardown mid-utterance
   loses whatever it was holding and re-clips the patient mid-word. */
{
  const at = source.indexOf('function kioskListen(keepMood)');
  const end = source.indexOf('\n  /* ── THE INTERRUPT', at);
  const body = source.slice(at, end > at ? end : at + 12000);
  assert(/if \(pvRec\) \{/.test(body),
    'A LIVE RECOGNISER CAN BE TORN DOWN AND REBUILT AGAIN. Every mid-question caller — the ' +
    'recogniser-died retry, resume, the PIN pad Back, the next question — would then restart ' +
    'recognition in the middle of whatever the patient was saying and lose the first half of it.');
  assert(!/pvStopSpeechOnly/.test(body),
    'something in kioskListen can silence the avatar again — the one interrupt is a TAP now');
  /* THE FENCE, where it now lives: the interim handler is inert while sound is playing, and it
     asks the AUDIO, not the estimate. */
  assert(/if \(pvAudioLive\(\)\) \{ kiosk\.heardWhileSpeaking/.test(body),
    'THE HALF-DUPLEX FENCE IS GONE from the interim path. What the microphone hears while the ' +
    'loudspeaker is playing must neither stop the sentence nor be painted on the patient-facing ' +
    'line — and it must be asked of the AUDIO, because pvSaying is cleared by an estimate.');
}
/* and the silence clock starts when the QUESTION ENDS, not when it starts: armed from the speak
   continuation, because armed at mic-open a six-second question spent its own patience.
   ⚠️ SCOPED TO THE QUESTION BRANCH, NOT A BYTE WINDOW. The obvious form of this assertion —
   /pvSpeak.*\(kiosk\.lastSay, function \(\) \{[\s\S]{0,900}kioskArmWatchdog\(9000\)/ — matches the
   FIRST pvSpeakShaped(kiosk.lastSay, ...) in the file, which is the CLOSING line's call in the
   `j.done` branch, and then measures 900 characters of that branch's comments. It went red on a
   file where the arming was present and correct. That is the eighth byte-window pin in this lane
   to cry wolf, so this one names its subject: the branch that asks a question. */
{
  const qAt = source.indexOf("kioskMood('speaking', kiosk.lastSay, answer);");
  assert(qAt > 0, 'the question branch of kioskTurn is gone');
  const branch = source.slice(qAt, source.indexOf('\n    }, function () {', qAt));
  assert(/pvSpeak[A-Za-z]*\(kiosk\.lastSay, function \(\) \{[\s\S]*kioskArmWatchdog\(9000\);/.test(branch),
    'the silence watchdog must be re-armed when the question finishes playing, not when it starts');
  assert(!/kioskListen\(\);\s*\n\s*\}\);/.test(branch) || /if \(!pvRec\) \{ kioskListen\(\); return; \}/.test(branch),
    'the speak continuation re-opens the microphone unconditionally. pvListen tears the live ' +
    'recogniser down, so this would discard whatever the patient said DURING the question — the ' +
    'words this design exists to keep. It may only re-open when the recogniser actually died.');
}
assert(/if \(!keepMood\) kioskArmWatchdog\(9000\);/.test(source),
  'the silence watchdog is no longer armed when the microphone opens on its own — a patient who ' +
  'says nothing would never be nudged and the interview would never self-end');

/* ---- 4. the one thing that can cut a sentence short is a TAP ---- */
assert(source.includes('function pvStopSpeechOnly'), 'barge-in must not tear down the recogniser');
{
  const callers = (source.match(/pvStopSpeechOnly\(\);/g) || []).length;
  assert.strictEqual(callers, 1,
    'pvStopSpeechOnly now has ' + callers + ' call sites — with more than one, nothing can be ' +
    'concluded about what silenced a question');
  const skipAt = source.indexOf('function kioskSkipSpeech()');
  assert(skipAt > 0, 'kioskSkipSpeech is gone — there is no way for a patient to interrupt at all');
  const skipEnd = source.indexOf('\n  /* Natural completion', skipAt);
  assert(/pvStopSpeechOnly\(\);/.test(source.slice(skipAt, skipEnd)),
    'the one call site left kioskSkipSpeech. It has to be a button: the avatar\'s own voice ' +
    'defeated every audio and every text rule this lane wrote, and it cannot press a button.');
  /* ⛔ AND THE MICROPHONE MUST NOT BE ABLE TO REACH IT. pvListen's onInterim is where both
     previous mechanisms lived; it may not stop anything now. */
  const ih = source.indexOf('}, function (interim) {');
  assert(ih > 0, 'the interim handler is gone');
  const handler = source.slice(ih, source.indexOf('}, function () {', ih));
  assert(!/pvStopSpeechOnly|pvOtherVoice|pvNovelWordCount/.test(handler),
    'A MICROPHONE RULE IS BACK ON THE PATH THAT SILENCES THE AVATAR. Neither a word count nor an ' +
    'energy threshold can tell the avatar\'s own voice from a patient\'s — measured wrong in both ' +
    'directions — and the owner has ranked finishing the sentence above interrupting it.');
  assert(/kiosk\.heardWhileSpeaking/.test(handler),
    'a recognition result arriving while the avatar is speaking is no longer COUNTED. It is not a ' +
    'fault — the microphone stays open on purpose — but it is the only number that says how much ' +
    'of the avatar\'s own voice the room is failing to cancel, and a gate with no counter is how ' +
    'av-6.1.0 shipped a report reading "echo cancellation active" while it self-triggered on ' +
    'every question.');
}
/* ⚠️ MERGE NOTE, 1363f7c5 (another lane, while main was red because of me). Upstream replaced
   the old literal cough pin with a DIFFERENT literal, matching b991's code shape:
       /var otherVoice = pvSaying[...]\? \(novel >= 2\)[...]if \(pvSaying && otherVoice\)/
   Their requirement is kept in full and their wording is better than mine was — they added
   "or misheard self-echo", which is exactly the case that matters. But that shape no longer
   exists: av-6.1.0 has three regimes, so `var otherVoice = pvSaying ?` is gone and their pin
   would have gone red on the next push. Trading one text-shape proxy for another only moves
   the brittleness, so the requirement is now checked by EXECUTING the decision instead, with
   their self-echo case among the nine. Nothing was dropped and nothing was relaxed. */
/* ── "a cough or an 'mhm' must not cut the question off" — NOW EXECUTED ────────────────────
   This requirement is unchanged and is the whole point of the pin that used to live here. What
   changed is how it is checked. The old form matched the literal text
   `filter(Boolean).length >= 2) pvStopSpeechOnly()`, i.e. it required the condition and the call
   to sit adjacent on one line. av-6.1.0 gave the condition a NAME (`otherVoice`) because there
   are now three regimes, and the literal disappeared — while the requirement itself got
   STRONGER. A text-adjacency proxy cannot tell those two situations apart, and it reported a
   correct refactor as a broken cough guard on main, blocking another lane.
   ⚠️ This is deliberately NOT a relaxation. It EXECUTES the shipped decision expression, lifted
   verbatim out of kioskListen, against a cough, an "mhm", a real interruption and a self-echo —
   and it fails on any build where a cough can stop the question. It caught a real defect the
   moment it was written: av-6.1.0's first barge-in used audio presence ALONE, and a cough is
   200-400ms of sustained energy, so it WOULD have cut the question off. */
/* ⛔ av-6.3.0 — THE EXECUTED "a cough must not cut the question off" DECISION IS GONE, BECAUSE
   ITS SUBJECT IS GONE, and the requirement it protected is now satisfied structurally instead of
   by a threshold. A cough cannot cut the question off because the microphone is not open while
   the question plays; neither can an "mhm", nor a mis-transcription, nor the avatar's own
   residual tripping the energy gate — which was the case this decision was measured getting
   WRONG on every single question (bar 0.0208 RMS vs a 0.020 residual, true at frame 4).
   The replacement lives in avatar-half-duplex-and-one-live-region.test.js group A3, which runs
   SEVEN such inputs — perfect echo, merged-word and homophone mis-transcriptions, a cough, and
   the residual case — through the SHIPPED interim handler and requires that none of them stops
   the speech, plus group A5 which requires the button still does. Its control reverts each fix
   one at a time and each one fails by name (19 of 19).
   Nothing was relaxed by deleting this block: a threshold that has to be right in both
   directions was replaced by a condition that cannot be wrong in either.
   The voice gate's timing constants are deliberately NOT pinned here any more. VG_SPEECH_FRAMES
   and pvOtherVoiceSustained were DELETED with the decision they served, rather than left in the
   file for a suite to keep describing as load-bearing. */
{
  /* ⚠️ COMMENTS STRIPPED FIRST. The first version of these two assertions matched the raw file
     and went red on the module's own note explaining WHY the function was deleted — a text grep
     cannot tell code from prose, which is a recurring cost in this lane (two sweeps have flagged
     their own comments). */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(!/function pvOtherVoiceSustained/.test(code),
    'pvOtherVoiceSustained is back with nothing calling it — a "longer than a cough" threshold ' +
    'is only meaningful on a path that can silence the avatar, and there is no such path now');
  /* THE GATE SURVIVES ON ONE DECISION PATH ONLY — the FILING refusal, where it is the
     PERMISSIVE term: a false positive there makes us file an answer rather than delete one, and
     deleting an answer is the one outcome this file must never risk. Checked by naming the
     permitted sites rather than by counting, because a count goes red the day someone adds a
     diagnostic and says nothing about where the value is actually used. */
  const sites = code.split('\n').map((ln, i) => [i + 1, ln])
    .filter(([, ln]) => /pvOtherVoiceNow\(\)/.test(ln));
  for (const [n, ln] of sites) {
    const ok = /function pvOtherVoiceNow\(\)/.test(ln)              /* the definition */
      || /pvVoiceGateReady\(\) && !pvOtherVoiceNow\(\)/.test(ln)     /* the FILING refusal */
      || /otherVoiceNow: function \(\)/.test(ln);                    /* the diagnostics report */
    assert(ok, 'pvOtherVoiceNow is used somewhere new (line ' + n + '): ' + ln.trim() + '\n' +
      'It must never be back on a path that decides whether to stop talking — measured wrong in ' +
      'BOTH directions: it returned true on the avatar\'s own residual at frame 4 on every ' +
      'question, and it was invisible to a patient speaking at 1.8x a noisy room\'s floor.');
  }
  assert(sites.length >= 2, 'the voice gate lost its filing-path use as well — that refusal is ' +
    'the only thing standing between a mis-transcribed echo and a fabricated answer');
}
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
  'an all-echo result never costs the microphone, and (av-6.3.0) the microphone opens WITH the question ' +
  'and is never torn down while it is live — because a mic that opens when the question ends opens ' +
  'mid-utterance and files the tail as a whole answer — while the half-duplex guarantee sits on the ' +
  'two decisions instead: nothing the microphone hears can stop the avatar (counted, not silent), ' +
  'nothing heard while sound was playing can be filed, and the one interrupt left is a tap');

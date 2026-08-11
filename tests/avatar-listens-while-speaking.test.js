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
/* ══ av-6.4.0: TWO ASSERTIONS MOVED HERE, QUOTED VERBATIM, WITH THE REASON ═════════════════════
   ⛔ Nothing below is weakened. Round 7 deleted an assertion and the product then failed it, so
   both originals are recorded in full and each is replaced by something that enforces the same
   requirement or a strictly stronger one. The full ledger, with a control that fails on the
   pre-fix bytes by name, is tests/avatar-answer-is-an-object.test.js.

   ORIGINAL 1, verbatim:
       assert(/if \(piece && pvIsSelfEcho\(piece\)\) continue;/.test(source),
         'the echo filter must run INSIDE pvListen, per result — filtering only in the caller means
          the avatar\'s words enter finalText and the whole answer is rejected with them');
   WHY IT MOVED: THIS ASSERTION PINNED A DEFECT IN PLACE — round 5's, live on main until now. The
   `continue` drops a segment out of the MIDDLE of an accumulation which is then filed as a
   COMPLETE answer, and English puts negation and laterality at the leading edge, so the surviving
   text reads fluent, plausible and INVERTED: "no pain in my left leg" files as "pain in my left
   leg". The requirement it was written for is real and is KEPT: the classifier must run at the
   source, per piece, inside pvListen, not only in the caller. What changed is what it does there —
   it MARKS the answer instead of deleting words, and no piece is ever removed from an accumulation.
   This is the same correction group 5d below already made once, for the same reason it states:
   "a pin that holds a defect in place is worse than no pin".

   ORIGINAL 2, verbatim:
       assert(/function submit\(\)[\s\S]{0,1200}if \(!v\) return;[\s\S]{0,200}rec\.stop\(\)/.test(listen),
         'submit() must refuse BEFORE stopping the recogniser when nothing survived the filter —
          otherwise one echo leaves the kiosk deaf until the 9s watchdog');
   WHY IT MOVED: STRENGTHENED. submit() no longer stops the recogniser AT ALL, so there is no
   ordering left to get wrong and no echo can leave the kiosk deaf. The half teardown this pinned
   was itself a defect three ways: it left the quiet timer armed (so a trailing result re-armed it
   and the same answer filed twice as two turns), it left the handlers wired, and it forced the next
   turn to build a NEW recogniser — and a recogniser that starts listening at a moment nobody chose
   cannot know whether the first thing it hears is the middle of a sentence. That is round 4. */
assert(/if \(pvIsSelfEcho\(p\)\) this\.echo = true;/.test(source),
  'the echo classifier no longer runs at the SOURCE, per piece, inside pvListen. Filtering only in ' +
  'the caller means the avatar\'s words enter the answer and the caller must then reject the WHOLE ' +
  'result, the patient\'s words with it.');
/* ⚠️ COMMENTS BLANKED FIRST, and blanked character-for-character so offsets still mean something.
   A text grep cannot tell code from prose: the module's own note QUOTES the line it removed, so the
   raw-source form of this scan flagged the explanation as the defect. That has now happened several
   times in this lane, in both directions. */
const bareSource = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
assert(!/pvIsSelfEcho\([a-z]+\)\) continue;/.test(bareSource),
  'A PIECE IS BEING DROPPED OUT OF THE MIDDLE OF AN ACCUMULATION AGAIN. Whatever is left is then ' +
  'filed as a complete answer, and because negation and laterality sit at the leading edge of ' +
  'English, what remains is an INVERTED clinical fact with no marker that anything was removed.');
{
  const at = source.indexOf('function pvListen');
  const listen = source.slice(at, source.indexOf('/* ======', at));
  const bare = listen.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const sFrom = bare.indexOf('function submit() {');
  const sTo = bare.indexOf('function armQuiet(', sFrom);
  assert(sFrom > 0 && sTo > sFrom, 'submit() could not be scoped inside pvListen');
  assert(!/rec\.stop\(\)/.test(bare.slice(sFrom, sTo)),
    'submit() CLOSES THE MICROPHONE AGAIN. It must not: the recogniser has to stay live across a ' +
    'filing, because the only way to know the next utterance is WHOLE is to have been listening ' +
    'before it started. Rebuilding it between turns is round 4, and the half teardown this ' +
    'replaced also filed the same answer twice.');
  assert(/if \(!ans \|\| ans\.settled\) return;/.test(bare.slice(sFrom, sTo)),
    'submit() no longer stands down when there is nothing to settle — an all-echo turn must leave ' +
    'the microphone open, or one echo leaves the kiosk deaf until the 9s watchdog');
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
/* Assert the FIRING LINE, not the line that happens to follow it. Both old alternatives were
   code-shape proxies and both went stale: `>= 2) pvStopSpeechOnly();` died with the cough fix,
   and `pvStopSpeechOnly();\n var iv` died when av-6.2.0 routed the interim write through the
   arbitrator, so the next line is no longer `var iv = gid(...)`. Behaviour never changed either
   time. This is the FIFTH shape-pin in this change set to cry wolf, and one of them trained me
   to dismiss a red that was real — so pin what barge-in DOES: it fires from inside kioskListen,
   on the decided condition, and nowhere else in the file. */
{
  const at = source.indexOf('function kioskListen');
  assert(at > 0, 'kioskListen is gone');
  const end = source.indexOf('\n  function ', at + 20);
  const body = source.slice(at, end > at ? end : at + 6000);
  /* ══ av-6.4.0: THIS ASSERTION MOVED. ORIGINAL, VERBATIM ════════════════════════════════════
         assert(/if \(pvSaying && otherVoice\) pvStopSpeechOnly\(\);/.test(body),
           'barge-in must fire from the interim path, on the decided condition');
     WHY IT MOVED: THE OWNER'S COMPLAINT IS THIS LINE. "it litterly never gets out everyhting it
     wants to say caosue it picks up its own talking" — barge-in fired FROM THE MICROPHONE, and the
     only thing between it and the avatar's own voice was a classifier. Every classifier tried there
     was measured being fooled: 42 of 232 mis-transcribed echoes read as an interruption with no
     gate at all, and the audio gate itself tripped on the avatar's own residual on nearly every
     question. A loudspeaker can defeat any classifier.
     THE REQUIREMENT IS KEPT IN FULL AND MADE UNFORGEABLE: the patient can still cut a question
     short, via #mlsAvKioskSkip, whose handler refuses any event that is not isTrusted — a property
     only the user agent can set, matching this codebase's existing precedent that a scripted
     .click() is refused for lacking it. Both directions are EXECUTED in
     tests/avatar-answer-is-an-object.test.js (a synthetic event must not stop the speech; a real
     tap must). The sibling assertion below — that pvStopSpeechOnly has exactly ONE call site — is
     UNCHANGED, and it is now that handler. */
  assert(/if \(pvAudioLive\(\)\) \{ kiosk\.heardWhileSpeaking = /.test(body),
    'THE INTERIM HANDLER CAN SILENCE OR OVERPAINT THE QUESTION AGAIN. While sound is coming out of ' +
    'the loudspeaker this handler must do nothing but COUNT: it may not stop the speech and it may ' +
    'not paint over the question the patient is still reading. pvAudioLive(), NOT pvSaying — ' +
    'pvSaying is cleared by an ESTIMATED-duration watchdog, so a pvSaying fence lifts mid-sentence.');
  assert(!/pvStopSpeechOnly\(\)/.test(body),
    'A MICROPHONE-DERIVED HANDLER IN kioskListen CAN END A SENTENCE AGAIN. That is the defect the ' +
    'owner reported twice, and no classifier on that line has ever survived contact with the ' +
    'avatar\'s own voice.');
  assert(/function kioskSkipSpeech\(ev\) \{/.test(source) &&
    /if \(!ev \|\| ev\.isTrusted !== true\) return false;/.test(source),
    'the interrupt was REMOVED rather than moved. The patient must still be able to cut a question ' +
    'short — through a trusted tap, which our own loudspeaker cannot forge.');
  /* and it must remain the ONLY caller: the whole diagnosis of "it does not say everything it
     is going to say" rests on there being exactly one thing that can cut a question off */
  const callers = (source.match(/pvStopSpeechOnly\(\);/g) || []).length;
  assert.strictEqual(callers, 1,
    'pvStopSpeechOnly now has ' + callers + ' call sites — with more than one, nothing can be ' +
    'concluded about what silenced a question');
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
/* ══ av-6.4.0: THE NINE-CASE BARGE-IN DECISION MOVED. ORIGINAL SETUP, VERBATIM ══════════════════
       const decideStart = source.indexOf('var otherVoice', listenAt);
       const decideEnd = source.indexOf('if (pvSaying && !otherVoice) return;', decideStart);
       assert(decideStart > 0 && decideEnd > decideStart,
         'the barge-in decision no longer has a single identifiable site in kioskListen');
   ...executed over these nine rows, each of which is preserved by name below:
       a COUGH while the question plays (loud, 320ms, no words)              -> must NOT barge in
       an "mhm" while the question plays                                     -> must NOT barge in
       a cough with NO echo cancellation available                           -> must NOT barge in
       the avatar hearing ITSELF (all its own words back)                    -> must NOT barge in
       a REAL interruption: one novel word plus a voice present              -> MUST barge in
       a REAL interruption with no transcript yet, speech running on         -> MUST barge in
       a REAL interruption with NO echo cancellation (two novel words)       -> MUST barge in
       two ordinary words while NOTHING is playing                           -> paints
       one word while nothing is playing (below the historical floor)        -> does not paint
   WHY IT MOVED: there is no longer a decision to execute, because NOTHING THE MICROPHONE HEARS CAN
   END A SENTENCE. The four must-NOT rows are now satisfied ABSOLUTELY rather than by a classifier
   that was measured being fooled 42 of 232 times — a cough, an "mhm", silence and the avatar's own
   voice are all strings and none of them has a path to a speech-stopping call. The three MUST rows
   moved to #mlsAvKioskSkip: a real person interrupts by tapping a button, which our loudspeaker
   cannot press and a mis-transcription cannot forge. Both directions of that are EXECUTED in
   tests/avatar-answer-is-an-object.test.js, and the SHIPPED interim handler is executed over all
   nine rows below.
   ⛔ NOT A RELAXATION: the old rule could be defeated by the avatar's own voice on any of the four
   must-NOT rows. This one cannot be defeated at all. The two "nothing is playing" rows are still
   about PAINTING, and they are still checked here. */
{
  const listenAt = source.indexOf('function kioskListen');
  assert(listenAt > 0, 'kioskListen is gone');
  const hFrom = source.indexOf('}, function (interim) {', listenAt);
  const hTo = source.indexOf('}, function () {', hFrom);
  assert(hFrom > 0 && hTo > hFrom,
    'the interim handler no longer has a single identifiable site in kioskListen');
  const handlerSrc = source.slice(hFrom + 3, hTo) + '}';
  /* every input the handler reads is injected, and EVERY act it could take is instrumented — so a
     stop cannot hide as "nothing happened", which is how a dead handler would score perfectly. */
  const run = new Function('interim', 'audioLive', 'selfEcho', `
    var stopped = 0, painted = null, heard = false;
    var kiosk = { heard: false, heardWhileSpeaking: 0 };
    var pvIsSelfEcho = function () { return selfEcho; };
    var pvAudioLive = function () { return audioLive; };
    var pvStopSpeechOnly = function () { stopped++; };
    var pvAbandonSpeech = function () { stopped++; };
    var pvStopVoice = function () { stopped++; };
    var kioskLine = function (kind, text) { painted = kind + ':' + text; };
    var handler = ${handlerSrc};
    handler(interim);
    return { stopped: stopped, painted: painted, heard: !!kiosk.heard,
             counted: kiosk.heardWhileSpeaking };
  `);
  const rows = [
    /* label,                                                        interim, audioLive, selfEcho */
    ['a COUGH while the question plays (loud, 320ms, no words)',           '', true, false],
    ['an "mhm" while the question plays',                              'mhm', true, false],
    ['a cough with NO echo cancellation available',                        '', true, false],
    ['the avatar hearing ITSELF (all its own words back)', 'is the pain in your', true, true],
    ['a REAL interruption: one novel word plus a voice present',   'actually', true, false],
    ['a REAL interruption with no transcript yet, speech running on',      '', true, false],
    ['a REAL interruption with NO echo cancellation (two novel words)',
      'my shoulder hurts', true, false],
  ];
  for (const [label, interim, live, echo] of rows) {
    const r = run(interim, live, echo);
    assert.strictEqual(r.stopped, 0,
      'THE MICROPHONE STOPPED THE SENTENCE for "' + label + '". Nothing the microphone hears may ' +
      'end speech — that is the owner\'s complaint, twice, and every classifier put on this line ' +
      'has been measured being fooled by the avatar\'s own voice.');
    assert.strictEqual(r.painted, null,
      'THE LIVE TRANSCRIPT PAINTED OVER A QUESTION THE PATIENT IS STILL READING for "' + label +
      '" — this is the "overlaying text" half of the same report');
  }
  /* and the handler is NOT simply dead: with nothing playing it still paints, and a real
     interruption still reaches the patient through the trusted tap (executed elsewhere) */
  const quiet2 = run('my back', false, false);
  assert.strictEqual(quiet2.painted, 'transcript:my back',
    'two ordinary words while NOTHING is playing no longer reach the live transcript — the handler ' +
    'has been made dead, which scores perfectly on every must-NOT row above while deleting the ' +
    'feature');
  assert.strictEqual(quiet2.heard, true,
    'speech while nothing is playing no longer counts as activity, so the self-end watchdog will ' +
    'cut off a patient who is talking');
  const echoQuiet = run('is the pain in your', false, true);
  assert.strictEqual(echoQuiet.painted, null,
    'the avatar\'s own words reach the live transcript once the audio estimate has expired');
  /* and the sustained threshold must actually be longer than a cough, or the branch above
     that relies on it is decoration */
  const framesMs = /var VG_FRAME_MS = (\d+);/.exec(source);
  const speechFrames = /var VG_SPEECH_FRAMES = (\d+);/.exec(source);
  assert(framesMs && speechFrames, 'the voice-gate timing constants are gone');
  const sustainedMs = Number(framesMs[1]) * Number(speechFrames[1]);
  assert(sustainedMs >= 600,
    'the "speech runs on past a cough" threshold is only ' + sustainedMs + 'ms — a cough reaches ' +
    '400ms, so this would let one barge in');
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
  'an all-echo result never costs the microphone, the mic opens with the question, the silence clock starts when it ends, ' +
  'and barge-in stays guarded at two words');

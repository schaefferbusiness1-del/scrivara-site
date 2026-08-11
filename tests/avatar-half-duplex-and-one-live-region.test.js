'use strict';
/*
 * THE AVATAR ALWAYS FINISHES ITS SENTENCE, AND NO TEXT EVER OVERLAPS (av-6.3.0)
 * ===========================================================================================
 * Owner, for the SECOND time: "Listen it litterly never gets out everyhting it wants to say
 * caosue it picks up its own talking and then everyhting gets so fucked up fix it all to uin
 * paralele and fix the overlaying text to"
 *
 * Both halves had already been "fixed" once. This file exists because both fixes were aimed at
 * the wrong mechanism, and because the suites written with them could not have caught that:
 *
 *   1. BARGE-IN WAS NOT THE TRUNCATION PATH THAT FIRES. pvStopSpeechOnly had exactly one call
 *      site and av-6.1.0 hardened the condition on it — but pvStopVoice() does the same damage
 *      (pvSpeakSeq++, ttsAudioNow.pause(), speechSynthesis.cancel(), pvSaying='') and it has
 *      FIFTEEN call sites, of which kioskTurn, pvListen and kioskWatchdog are all reachable
 *      while a sentence is playing. pvListen's FIRST STATEMENT was pvStopVoice(), so simply
 *      re-opening the microphone cut the audio mid-word — measured: audio cut at t=1000ms of a
 *      6.0s question, pvSaying "is the pain in your " -> "", and finish callbacks fired = 0, so
 *      the continuation that re-arms the silence clock was STRANDED and nothing re-spoke it.
 *      Chrome's speech service is network-backed and every ordinary `no-speech` error re-opens
 *      the mic 400ms later, so this fired routinely, not rarely.
 *
 *   2. THE OVERLAP IS BETWEEN TWO DIFFERENT ELEMENTS, so a one-writer-per-node arbitrator could
 *      never have fixed it. Measured against the shipped CSS: #mlsAvKioskInterim's last line
 *      painted 20.9px into #mlsAvKioskProgress (both transparent -> the glyphs interleave), and
 *      #mlsAvKioskSay's last line ran 12.9px UNDER the opaque white #mlsAvKioskMic pill, where
 *      it is not interleaved but GONE. Cause: `min-height` on a flex item REPLACES
 *      `min-height:auto` and so cancels flex's automatic minimum content size, and every child
 *      kept `flex-shrink:1`, so Chrome compressed those boxes below their own text.
 *
 * THE OWNER'S DECISION, BINDING: finishing the sentence outranks instant interruption. Text
 * self-echo detection can never be sound (a mis-transcribed echo arriving as a FINAL result is
 * byte-identical to a real answer, and a real answer legitimately reuses the question's words),
 * and the audio gate was measured tripping on the avatar's own residual on every question. So
 * the microphone is not fed into any stop decision while the avatar is speaking — it is not
 * even OPEN — and interruption moves to a visible button, which our loudspeaker cannot press.
 *
 * ⛔ THE ONE THING THIS FILE MUST NEVER LET SLIP: a patient's answer may never be dropped.
 * An earlier round in this lane put a novel-word rule on the FILING path and deleted 9 of 12,
 * then 22 of 22, ordinary "A or B" answers. Deciding to stop talking is never destructive;
 * deciding not to file an answer destroys clinical information. Group A4 is the control that
 * keeps the two gates from ever being merged again.
 *
 * CONTROL: AVATAR_SRC_OVERRIDE=<pre-fix copy> node tests/avatar-half-duplex-and-one-live-region.test.js
 * Every group below was run against the pre-fix module and the failing group is named in the
 * report. A group whose control passes is recorded as such rather than left to look load-bearing.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const lib = require('./kiosk-render-lib.js');

const root = path.resolve(__dirname, '..');
const srcPath = process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js');
const src = fs.readFileSync(srcPath, 'utf8');

function lift(startNeedle, endNeedle, what) {
  const a = src.indexOf(startNeedle);
  assert.ok(a > 0, what + ': start marker is gone (' + startNeedle + ')');
  const b = src.indexOf(endNeedle, a + startNeedle.length);
  assert.ok(b > a, what + ': end marker is gone (' + endNeedle + ')');
  return src.slice(a, b);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
   A. THE AVATAR ALWAYS FINISHES ITS SENTENCE
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* ── A1. OPENING THE MICROPHONE MUST NOT CANCEL THE SENTENCE ───────────────────────────────
   EXECUTED against pvListen itself, with a fake recogniser, because this is the truncation path
   that actually fires and it is invisible to any assertion about barge-in. */
/* ── A0. 🚨 "IS IT STILL TALKING?" IS ASKED OF THE PLATFORM, NOT OF AN ESTIMATE (defect 2) ─────
   Every fence in this file used to read `pvSaying`, and pvSaying is cleared by pvSpeakVoiced's
   finish() — which is armed THREE ways, one of them an ESTIMATED-duration watchdog (word count x
   380ms for the synth, clip duration + 2500ms for the MP3). The moment that estimate fired early,
   every gate keyed to "is it still talking" opened while the loudspeaker was still playing: the
   microphone's words could be filed, the silence watchdog could speak over the second half of a
   question, the 12-second net could cut the closing line, and the visible "skip ahead" button went
   dead while the avatar was still audible.
   EXECUTED on the shipped predicate, with the two signals and the ceiling under the test's control.
   ⚠️ THE GC HAZARD AND THE WATCHDOG ARE RECONCILED HERE, not wished away. Chrome garbage-collects a
   live SpeechSynthesisUtterance (why pvHeld exists) and `onend` can fail to fire (why the watchdog
   exists); both make a signal STICK TRUE, never false — so they cannot lift this fence, only jam it
   shut. A jammed fence files nothing, so a positive signal is believed only while any sentence this
   file can produce could still be playing. The ceiling BOUNDS a stuck signal; it is not the
   authority for the ordinary case, which is exactly what the defect was. */
{
  const liveSrc = lift('  var pvAudioStartAt = 0;', '\n  /* the continuation of the sentence', 'pvAudioLive');
  const ask = (cfg) => new Function('cfg', `
    var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
    var pvSaying = cfg.saying || '';
    var pvSpeakSeq = 1, pvWatchdog = null;
    var ttsAudioNow = cfg.el || null;
    var window = { speechSynthesis: cfg.synth ? { speaking: true } : { speaking: false } };
    var clearTimeout = function () {}, setTimeout = function () { return 1; };
    ${liveSrc}
    pvAudioStartAt = Date.now() - (cfg.age || 0);
    return { live: pvAudioLive(), playing: pvAudioPlaying(), ceiling: PV_AUDIO_TRUST_MS };
  `)(cfg);
  const PLAYING = { paused: false, ended: false };
  const DONE = { paused: true, ended: true };
  assert.strictEqual(ask({ el: PLAYING, saying: '' }).live, true,
    '🚨 THE FENCE LIFTS WHILE THE LOUDSPEAKER IS STILL PLAYING. The audio element reports itself ' +
    'unpaused and not ended — it is the thing making the sound — and the predicate said the avatar ' +
    'had stopped talking because pvSaying had been cleared by an ESTIMATE. That single answer is ' +
    'what let a mis-transcribed echo be filed as the patient\'s answer, let "take your time" be ' +
    'spoken over the second half of a question, and killed the skip button mid-sentence.');
  assert.strictEqual(ask({ synth: true, saying: '' }).live, true,
    'the browser synthesiser reports itself speaking and the predicate disagrees — that is the ' +
    'fallback voice, i.e. what a patient hears whenever the network hiccups');
  assert.strictEqual(ask({ el: DONE, saying: 'a sentence being fetched' }).live, true,
    'a sentence is in flight but not yet audible (the TTS fetch runs up to 6.5s) and the predicate ' +
    'says nothing is happening — an answer filed then is an answer to a question never asked');
  assert.strictEqual(ask({ el: DONE, saying: '' }).live, false,
    'the predicate says the avatar is talking when nothing is playing and nothing is in flight — ' +
    'a fence stuck shut files NOTHING, which is the worse failure of the two');
  /* ⛔ AND A STUCK SIGNAL MUST NOT DEAFEN THE KIOSK FOR THE REST OF THE VISIT */
  const ceiling = ask({ synth: true, saying: 'stuck', age: 10 }).ceiling;
  assert.ok(ceiling >= 30000 && ceiling <= 120000,
    'the trust ceiling is ' + ceiling + 'ms. It has to be longer than any sentence this file can ' +
    'speak (the synth watchdog alone allows 30s, the MP3 watchdog 45s) and short enough that a ' +
    'stuck signal cannot silence a whole visit.');
  assert.strictEqual(ask({ synth: true, saying: 'stuck', age: ceiling + 1000 }).live, false,
    'A STUCK SIGNAL DEAFENS THE KIOSK FOR EVER. speechSynthesis.speaking can stay true after the ' +
    'sound stops — this lane has already been bitten by Chrome collecting a live utterance — and ' +
    'with no ceiling the kiosk would refuse every answer for the rest of the visit while showing ' +
    'no fault at all.');
  assert.strictEqual(ask({ el: PLAYING, saying: '', age: ceiling + 1000 }).playing, true,
    'pvAudioPlaying stopped reporting what the platform says; the ceiling belongs to the ' +
    'BELIEVING, not to the observing, or the watchdog extension has nothing to consult');
}

const pvListenSrc = lift('function pvListen(onFinal, onInterim, onDead, onOverlap)', '\n  /* =====', 'pvListen');
/* THE RESTART GATE, LIFTED RATHER THAN STUBBED (av-6.3.2). Every harness below that executes
   pvListen or pvSpeakVoiced's finish() needs it, and a stub would be a re-implementation of the very
   thing under test — this lane has already shipped a stub looser than the real thing that hid the
   call it was written to catch.
   ⚠️ AND IT MUST BE DECLARED INSIDE EACH HARNESS. pvReAsk is ASSIGNED in submit() and pvListen has
   no 'use strict', so an undeclared one becomes a GLOBAL and the armed gate leaks from one fixture
   into the next — measured: the straddle fixture armed it and the clean control's answer was then
   refused as a continuation. */
/* ⛔ AND ITS ABSENCE IS AN ASSERTION, NOT A LIFT ERROR: against the pre-fix bytes a bare lift() dies
   with "start marker is gone", which reads as a broken TEST rather than a missing MECHANISM. */
assert.ok(src.indexOf('  var pvReAsk = false;') > 0,
  '🚨🚨 THERE IS NO RESTART GATE IN THIS FILE. A refusal then tells the patient nothing and gates ' +
  'nothing: the next thing the recogniser delivers is filed, and because a "turn" ends on a ' +
  '1.3-second silence timer that is routinely the SECOND HALF of the sentence just refused. The ' +
  'mechanism has to be refuse -> RE-ASK -> accept only speech that BEGAN after the asking.');
const reAskSrc = lift('  var pvReAsk = false;',
  '  /* ── WHY THERE IS NO LONGER A DEFERRED LISTEN', 'the restart gate');
/* THE SHIPPED pvListen, EXECUTED against a fake recogniser whose result stream we control, with
   `audioLive` under the test's thumb so a segment can be made to start during playback or after
   it. Nothing here is a re-implementation: the recogniser's handlers are the shipped ones. */
function mic(opts) {
  const o = opts || {};
  const log = [];
  const api = new Function('log', 'cfg', `
    var pvRec = null, pvSaying = cfg.saying || '', pvSpeakSeq = 1;
    var audioLive = !!cfg.audioLive;
    var isFn = function (f) { return typeof f === 'function'; };
    var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
    var pvAudioLive = function () { return audioLive; };
    var pvIsSelfEcho = function (t) { return (cfg.echo || []).indexOf(String(t)) >= 0; };
    var timers = [], nextId = 1;
    var setTimeout = function (fn, ms) { timers.push({ id: nextId, fn: fn, ms: ms }); return nextId++; };
    var clearTimeout = function (id) { for (var i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); return; } };
    var rec = null;
    var window = { SpeechRecognition: function () {
      rec = this;
      this.start = function () { log.push('rec.start'); };
      this.stop = function () { log.push('rec.stop'); };
    } };
    function pvStopVoice() { log.push('pvStopVoice'); pvSpeakSeq++; pvSaying = ''; }
    function pvStopMicOnly() {
      log.push('pvStopMicOnly');
      if (!pvRec) return;
      safe(function () { if (isFn(pvRec.__killQuiet)) pvRec.__killQuiet(); });
      safe(function () { pvRec.onresult = null; pvRec.onend = null; pvRec.onerror = null; pvRec.stop(); });
      pvRec = null;
    }
    ${reAskSrc}
    ${pvListenSrc}
    var got = { filed: [], refused: [], painted: [], dead: 0 };
    var started = pvListen(
      function (v) { got.filed.push(v); },
      function (v) { got.painted.push(v); },
      function () { got.dead++; },
      function (v) { got.refused.push(v); });
    /* ONE RESULT EVENT, shaped exactly like Chrome's: results is cumulative and resultIndex says
       where it changed. Each segment is {text, final}. */
    function emit(segs, from) {
      var results = segs.map(function (s) { return [{ transcript: s.text }].concat([]); });
      results.forEach(function (r, i) { r.isFinal = !!segs[i].final; });
      results.length = segs.length;
      rec.onresult({ resultIndex: from === undefined ? 0 : from, results: results });
    }
    return {
      started: started, got: got,
      emit: emit,
      live: function (v) { audioLive = v; },
      say: function (v) { pvSaying = v; },
      quiet: function () { var t = timers.slice(); timers.length = 0; t.forEach(function (x) { x.fn(); }); },
      end: function () { rec.onend(); },
      saying: function () { return pvSaying; },
      seq: function () { return pvSpeakSeq; },
      rec: function () { return pvRec; }
    };
  `);
  return { inst: api(log, o), log };
}
{
  const h = mic({ saying: 'is the pain in your back or in your neck' });
  assert.strictEqual(h.inst.started, true, 'pvListen no longer starts a recogniser at all');
  assert.ok(h.log.indexOf('pvStopVoice') < 0,
    'OPENING THE MICROPHONE STILL CANCELS THE SENTENCE. pvListen called pvStopVoice, which is ' +
    'pvSpeakSeq++, ttsAudioNow.pause(), speechSynthesis.cancel() and pvSaying=\'\' — measured ' +
    'cutting a 6.0s question at t=1000ms and STRANDING the completion callback (0 fired), so ' +
    'nothing re-armed the silence clock and nothing re-spoke the question. Every ordinary ' +
    'Chrome no-speech error reaches this line 400ms later.');
  assert.ok(h.log.indexOf('pvStopMicOnly') >= 0,
    'pvListen no longer tears the previous recogniser down — two live recognisers on one ' +
    'microphone is how a duplicated answer gets filed');
  assert.strictEqual(h.inst.saying(), 'is the pain in your back or in your neck',
    'the sentence being spoken was cleared by opening the microphone');
  assert.strictEqual(h.inst.seq(), 1, 'the speak sequence was bumped by opening the microphone — that ' +
    'alone silences the audio and voids the continuation');
}

/* ── A1b. 🚨 THE ONE THAT MATTERS MOST: AN UTTERANCE IS ACCEPTED WHOLE OR REFUSED WHOLE ────────
   This is the CRITICAL finding of the adversarial round and it is a patient-safety property, not
   an engineering preference. av-6.3.0's first attempt closed the microphone while the avatar
   spoke; a patient who starts answering before the question ends — which this file's own history
   says is the NORMAL case — then had the first words of their answer spoken into a closed
   microphone, and the tail was filed as a complete answer. English puts negation and laterality
   at the FRONT, so the words lost are exactly the ones that change the clinical meaning.
   EXECUTED on the shipped handlers: the fixtures below are the two shapes that matter. */
{
  /* (1) the patient starts speaking while the question is still playing, and keeps going. Chrome
     delivers that as ONE segment. It may contain our own words interleaved with theirs, and
     nothing can separate them without editing — so it is refused WHOLE and reported. */
  const straddle = mic({ audioLive: true, saying: 'is the pain in your left leg' });
  straddle.inst.emit([{ text: 'no pain in my', final: false }]);
  straddle.inst.live(false);                       /* the question ends mid-utterance */
  straddle.inst.emit([{ text: 'no pain in my left leg', final: true }]);
  straddle.inst.quiet();                           /* 1.3s of quiet -> submit */
  assert.deepEqual(straddle.inst.got.filed, [],
    '🚨 A TRUNCATED ANSWER WAS FILED AS A COMPLETE ONE. The utterance began while the avatar was ' +
    'still speaking, so it may be the patient\'s words and the avatar\'s interleaved in one ' +
    'string — and it was handed to the server anyway. This is the defect class that turns "no ' +
    'pain in my left leg" into "pain in my left leg": a wrong-site finding written into a chart ' +
    'under a green receipt, undetectable downstream because a fragment is byte-identical to a ' +
    'whole answer. Filed: ' + JSON.stringify(straddle.inst.got.filed));
  assert.deepEqual(straddle.inst.got.refused, ['no pain in my left leg'],
    'the overlapping utterance was DROPPED SILENTLY rather than refused and reported. A patient ' +
    'who answered and was not heard must be told, or they sit waiting for a machine that has ' +
    'already moved on — and nobody can count how often it happens.');
  assert.ok(straddle.inst.got.painted.every((p) => p === ''),
    'the overlapping text was painted on the patient-facing line while they were still reading ' +
    'the question from it: ' + JSON.stringify(straddle.inst.got.painted));

  /* (2) the ordinary case, and the one a refusal must never eat: the patient waits, then answers.
     Its LEADING words must survive verbatim — that is the whole point. */
  const clean = mic({ audioLive: false });
  clean.inst.emit([{ text: 'no pain in my', final: false }]);
  clean.inst.emit([{ text: 'no pain in my left leg', final: true }]);
  clean.inst.quiet();
  assert.deepEqual(clean.inst.got.filed, ['no pain in my left leg'],
    'A WHOLE ANSWER WAS NOT FILED. Refusing is safe; refusing everything is a kiosk that cannot ' +
    'take an answer. Filed: ' + JSON.stringify(clean.inst.got.filed));
  assert.deepEqual(clean.inst.got.refused, [], 'a clean utterance was reported as refused');

  /* (3) 🚨🚨 THE ONE THIS ASSERTION USED TO GET BACKWARDS — READ THIS BEFORE CHANGING IT.
     ⛔ THIS FIXTURE PREVIOUSLY EXPECTED `filed === ['no its my right knee']`, i.e. a held leading
     segment refused and the CLEAN REMAINDER FILED AS A COMPLETE ANSWER. That expectation was the
     round-4 wrong-site defect at a finer boundary, written down as correct behaviour, which is why
     it survived a review round: the code did exactly what its test demanded.
     WHY THE OLD ASSERTION WAS WRONG, precisely: it assumed the held segment was OUR voice and the
     clean segment was the WHOLE answer. Nothing in the data says either thing. Run the identical
     code path with the patient starting to speak over the tail of the question - the normal case,
     by this file's own history - and the held segment is "no pain in my", the clean segment is
     "left leg", and the shipped path files "left leg" as a complete answer. The two situations are
     byte-indistinguishable at the boundary, so a rule that files the remainder in one files a
     laterality-only fragment in the other. The fixture below is that second situation, in the same
     group, so the two can never be separated again.
     THE LAW: any boundary-based separation of our audio from their speech inside an accumulated
     transcript cuts somewhere, and wherever it cuts is where the meaning lives. So the unit is the
     TURN: if any part of it overlapped playback, the WHOLE turn is refused. */
  const both = mic({ audioLive: true, saying: 'is the pain in your left leg' });
  both.inst.emit([{ text: 'is the pain in your left leg', final: true }]);
  both.inst.live(false);
  /* ⚠️ THE WHOLE CUMULATIVE LIST, with resultIndex pointing at the new segment — that is what
     Chrome delivers, and an emit() that sent only the new one would leave the shipped loop
     (`for (i = ev.resultIndex; i < ev.results.length; i++)`) with nothing to iterate. My first
     version of this fixture did exactly that and the suite reported the answer as "spliced" when
     the module had never been handed it: the instrument lies first. */
  both.inst.emit([{ text: 'is the pain in your left leg', final: true },
    { text: 'no its my right knee', final: true }], 1);
  both.inst.quiet();
  assert.deepEqual(both.inst.got.filed, [],
    '🚨 A REMAINDER WAS FILED AS A COMPLETE ANSWER. Part of this turn arrived while sound was ' +
    'coming out of the speaker, so the turn is refused ENTIRE — never trimmed to "the clean part". ' +
    'Filing the remainder is how "no pain in my left leg" becomes "left leg": the leading segment ' +
    'that gets dropped is where English puts negation and laterality. Filed: ' +
    JSON.stringify(both.inst.got.filed));
  assert.deepEqual(both.inst.got.refused, ['is the pain in your left leg no its my right knee'],
    'the refused turn was not handed over WHOLE. onOverlap must receive everything the turn ' +
    'accumulated, in arrival order — handing over "just the suspect part" means deciding where the ' +
    'suspect part ended, which is the very cut this design exists to refuse. Refused: ' +
    JSON.stringify(both.inst.got.refused));

  /* (3b) 🚨 THE SAME CODE PATH, THE PATIENT'S OWN WORDS SPLIT ACROSS THE BOUNDARY. This is the
     harm the old (3) licensed: the head of the answer straddles the end of the question, so it
     lands in a held segment, and the tail lands in a clean one. A per-segment rule refuses the
     head and files the tail — "left leg" — as the answer to "is the pain in your left leg". */
  const split = mic({ audioLive: true, saying: 'is the pain in your left leg' });
  split.inst.emit([{ text: 'no pain in my', final: true }]);
  split.inst.live(false);
  split.inst.emit([{ text: 'no pain in my', final: true },
    { text: 'left leg', final: true }], 1);
  split.inst.quiet();
  assert.deepEqual(split.inst.got.filed, [],
    '🚨🚨 A LATERALITY-ONLY FRAGMENT WAS FILED AS THE PATIENT\'S ANSWER. Their sentence began ' +
    'while the question was still playing, so its first segment is held and its second is clean — ' +
    'and filing the clean one turns "no pain in my left leg" into "left leg" against a question ' +
    'about the left leg. That is a wrong-finding entry in a chart under a green receipt. Filed: ' +
    JSON.stringify(split.inst.got.filed));
  assert.deepEqual(split.inst.got.refused, ['no pain in my left leg'],
    'the whole turn was not reported as refused, so the patient is never asked to say it again');

  /* (4) a pure echo needs no apology, so it is refused but reported through the same one path —
     the CALLER decides whether to say sorry (group A11). */
  const echo = mic({ audioLive: true, saying: 'is the pain in your left leg',
    echo: ['is the pain in your left leg'] });
  echo.inst.emit([{ text: 'is the pain in your left leg', final: true }]);
  echo.inst.quiet();
  assert.deepEqual(echo.inst.got.filed, [], 'the avatar\'s own voice was filed as the patient\'s answer');
  assert.deepEqual(echo.inst.got.refused, ['is the pain in your left leg'],
    'an all-echo result vanished with no counter and no report — "the avatar records itself ' +
    'talking" then cannot be measured, only argued about');
  assert.ok(echo.log.indexOf('rec.stop') < 0,
    'AN ALL-ECHO RESULT COST THE MICROPHONE. submit() must refuse before tearing the recogniser ' +
    'down; otherwise one echo leaves the kiosk deaf until the 9-second watchdog revives it, which ' +
    'is the "it doesn\'t listen for answers" half of the owner\'s report.');

  /* (5) a segment is tagged ONCE, on first sighting. Re-tagging it as the patient talks would
     move the boundary mid-utterance, which is the splice again by another route. */
  const grow = mic({ audioLive: true, saying: 'a question' });
  grow.inst.emit([{ text: 'well it', final: false }]);
  grow.inst.live(false);
  grow.inst.emit([{ text: 'well it started three weeks ago', final: true }]);
  grow.inst.quiet();
  assert.deepEqual(grow.inst.got.filed, [],
    'A SEGMENT WAS RE-TAGGED AS THE PATIENT KEPT TALKING. Its first words arrived while the ' +
    'avatar was speaking, so the whole segment is suspect; deciding again later means the answer ' +
    'is filed as complete when its beginning may be the loudspeaker.');
}

/* ── the kioskListen harness: the real function, executed, with everything injected ───────── */
const kioskListenSrc = lift('function kioskListen(keepMood)', '\n  /* ── THE INTERRUPT', 'kioskListen');
const kioskSkipSrc = lift('function kioskSkipSpeech()', '\n  /* Natural completion', 'kioskSkipSpeech');

function harness(opts) {
  const o = opts || {};
  const log = [];
  const nodes = {
    mlsAvKiosk: { classList: { list: [], add(c) { this.list.push(c); }, remove(c) { this.list = this.list.filter((x) => x !== c); }, contains(c) { return this.list.indexOf(c) >= 0; } } },
    mlsAvKioskTypeRow: { style: {} },
    mlsAvKioskInput: { focus() {} },
  };
  const api = new Function('log', 'nodes', 'cfg', `
    var pvRec = cfg.pvRec || null;
    var pvSaying = cfg.pvSaying || '';
    var kiosk = cfg.kiosk;
    var gid = function (id) { return nodes[id] || null; };
    var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
    var isFn = function (f) { return typeof f === 'function'; };
    var handlers = {};
    var listenStarted = cfg.listenStarts !== false;
    var pvListen = function (onFinal, onInterim, onDead, onOverlap) {
      log.push('pvListen');
      handlers.final = onFinal; handlers.interim = onInterim; handlers.dead = onDead;
      handlers.overlap = onOverlap;
      if (listenStarted) pvRec = { fake: true };
      return listenStarted;
    };
    /* the AUDIO truth, injectable: by default it follows pvSaying, but a test can set it
       independently — which is the whole point of defect 2 (pvSaying is cleared by an ESTIMATE
       while the loudspeaker is still playing, so the two are not the same fact) */
    var audioLive = cfg.audioLive;
    var pvAudioLive = function () { return audioLive === undefined ? !!pvSaying : !!audioLive; };
    var pvIsSelfEcho = function (t) { return !!cfg.selfEcho && cfg.selfEcho.indexOf(t) >= 0; };
    var pvNovelWordCount = function () { return cfg.novel || 0; };
    var pvVoiceGateReady = function () { return !!cfg.gateReady; };
    var pvOtherVoiceNow = function () { return !!cfg.presence; };
    var pvStopSpeechOnly = function () { log.push('pvStopSpeechOnly'); pvSaying = ''; };
    var kioskArmWatchdog = function (ms) { log.push('armWatchdog:' + ms); };
    var kioskMood = function (s) { log.push('mood:' + s); };
    var kioskState = function (s) { log.push('state:' + s); };
    var kioskLine = function (kind, text) { log.push('line:' + kind + ':' + String(text).slice(0, 40)); return true; };
    var kioskLineState = function () { return { kind: cfg.heldKind || '', holdMs: 0 }; };
    var kioskNonce = function () { return 'an-test'; };
    var kioskTurn = function (answer, nonce) { log.push('TURN:' + answer); };
    /* THE RE-ASK IS EXECUTED, NOT STUBBED (av-6.3.2): kioskReAsk and kioskReAskSpeak are inside the
       lifted kioskListen block, so what the patient HEARS and SEES on a refusal is the shipped code.
       pvSpeakShaped is the only stub, and it does what pvSpeakVoiced's finish() does in the order it
       does it: stamp the restart boundary, THEN run the continuation. */
    var pvSpeakShaped = function (t, then, shape) {
      log.push('speak:' + String(t).slice(0, 48));
      pvOpenReAsk();
      if (then) safe(then);
    };
    ${reAskSrc}
    var kioskListenCalls = 0;
    ${kioskListenSrc}
    ${kioskSkipSrc}
    return {
      listen: function (k) { return kioskListen(k); },
      skip: function () { return kioskSkipSpeech(); },
      interim: function (t) { return handlers.interim && handlers.interim(t); },
      final: function (t) { return handlers.final && handlers.final(t); },
      dead: function () { return handlers.dead && handlers.dead(); },
      /* the refusal REASON is forwarded: pvListen tells the caller which refusal this is ('overlap' or
         'continuation'), and the two are handled differently — an overlap may be our own echo and
         needs no apology, a continuation always has a patient waiting to be asked again. */
      overlap: function (t, why) { return handlers.overlap && handlers.overlap(t, why); },
      /* the restart gate, as submit() leaves it: EVERY refusal arms it, and it is this handler's job
         to decide whether the refusal was our own loudspeaker (stand down) or the patient (re-ask) */
      armGate: function () { pvArmReAsk(); },
      gate: function () { return pvReAskState(); },
      say: function (v) { pvSaying = v; },
      live: function (v) { audioLive = v; },
      saying: function () { return pvSaying; },
      rec: function () { return pvRec; }
    };
  `);
  const kiosk = Object.assign({ open: true, consentAt: 123, busy: false, completed: false,
    ambient: false, paused: false, mic: true, lastSay: 'is the pain in your back or in your neck' }, o.kiosk || {});
  const inst = api(log, nodes, Object.assign({}, o, { kiosk }));
  return { inst, log, kiosk, nodes };
}

/* ── A2. A LIVE RECOGNISER IS NEVER TORN DOWN AND REBUILT ──────────────────────────────────
   ⛔ THIS GROUP USED TO ASSERT THE OPPOSITE, and A1b is why it was reversed. It pinned "a listen
   asked for mid-sentence does not open the microphone" — the closed-microphone fence — and that
   fence is what clipped the front off the patient's answer and filed the remainder as complete.
   The microphone is open across the question now. What these callers must not do is REPLACE the
   recogniser that is holding what the patient has already said: pvListen tears the old one down,
   which discards its buffer and starts the new one mid-word. Every fixture is a REAL call site:
     · kiosk.deadTimer -> kioskListen()            (feat_mls_avatar.js, the recogniser-died path)
     · kioskPauseToggle resume -> kioskListen()
     · the PIN pad's "Back to the interview" -> kioskListen()
     · kioskTurn's own kioskListen(true), opening the mic with the next question */
{
  for (const label of ['recogniser-died retry', 'resume from pause', 'PIN pad Back']) {
    const h = harness({ pvSaying: 'is the pain in your back or in your neck', pvRec: { fake: true } });
    h.inst.listen();
    assert.ok(h.log.indexOf('pvListen') < 0,
      'A LIVE RECOGNISER WAS TORN DOWN AND REBUILT via the ' + label + ' path. pvListen replaces ' +
      'it, so whatever the patient was part-way through saying is discarded and the replacement ' +
      'starts mid-word. Log: ' + JSON.stringify(h.log));
    assert.ok(h.log.indexOf('armWatchdog:9000') >= 0,
      'the no-op path (' + label + ') also dropped the silence clock — a caller asking to listen ' +
      'expects the interview to move on, and with no clock a silent patient is never nudged');
  }
  /* the next question opening the mic WITH itself is also a no-op on a live recogniser, and it
     must NOT arm the clock: the continuation arms it when the question ENDS, because a 6-second
     question armed at its start spends its own patience (measured). */
  const keep = harness({ pvSaying: '', pvRec: { fake: true } });
  keep.inst.listen(true);
  assert.ok(keep.log.indexOf('pvListen') < 0, 'the question re-opened an already-live microphone');
  assert.ok(keep.log.indexOf('armWatchdog:9000') < 0,
    'the silence clock was armed when the QUESTION started, so a question longer than 9 seconds ' +
    'nudges "take your time" over its own second half');
  /* with no recogniser the same call opens one, INCLUDING mid-sentence — which is now correct:
     the words a patient says over the question are captured rather than lost, and the FILING gate
     is what refuses them whole (A1b). Deafness was never the safe option. */
  const h2 = harness({ pvSaying: 'a question still playing' });
  h2.inst.listen();
  assert.ok(h2.log.indexOf('pvListen') >= 0,
    'THE MICROPHONE NEVER OPENS AT ALL — the kiosk is deaf, and a deaf kiosk cannot know whether ' +
    'the answer it eventually hears is whole');
  assert.ok(h2.log.indexOf('armWatchdog:9000') >= 0,
    'the silence clock is not armed when the microphone opens on its own: a patient who ' +
    'says nothing would never be nudged and the interview would never self-end');
}

/* ── A3. NOTHING THE MICROPHONE HEARS CAN END A SENTENCE ───────────────────────────────────
   Executed on the SHIPPED interim handler, captured from the real pvListen call. The inputs are
   the ones both previous mechanisms got wrong. */
{
  const CASES = [
    ['a perfect echo of our own question (0 novel words)', 'is the pain in your', 0, false, false],
    ['a MERGED-WORD mis-transcription of our own voice (52% of the measured misses)', 'is the painin your back', 1, false, false],
    ['a HOMOPHONE mis-transcription of our own voice', 'is the pane in your back', 1, false, false],
    ['a real person interrupting, two novel words', 'my shoulder hurts', 2, false, false],
    ['a cough: audio presence, no words', '', 0, true, true],
    ['the avatar\'s own residual tripping the voice gate (measured on EVERY question)', 'is the pain in your', 0, true, true],
    ['sustained energy with a byte-perfect echo — the case the old gate stopped on', 'is the pain in your back or in your neck', 0, true, true],
  ];
  for (const [label, interim, novel, gateReady, presence] of CASES) {
    const h = harness({ pvSaying: '' , novel, gateReady, presence });
    h.inst.listen();                                 /* opens for real: nothing is playing */
    h.inst.say('is the pain in your back or in your neck');   /* now a question starts playing */
    const before = h.log.length;
    h.inst.interim(interim);
    const after = h.log.slice(before);
    assert.ok(after.indexOf('pvStopSpeechOnly') < 0,
      'THE SENTENCE WAS CUT OFF BY THE MICROPHONE for "' + label + '". The microphone is open ' +
      'while the avatar speaks — that is deliberate, because closing it clipped the patient\'s ' +
      'answers — so this handler is the fence: while sound is playing it may do NOTHING. This is ' +
      'the owner\'s complaint, twice.');
    assert.ok(!after.some((l) => l.indexOf('line:transcript') === 0),
      'a result arriving while the avatar is speaking was PAINTED on the patient-facing line ' +
      'for "' + label + '" — it is our own voice, or the patient\'s words interleaved with it, ' +
      'and either way it goes on top of the question they are reading');
    assert.strictEqual(h.kiosk.heardWhileSpeaking, 1,
      'what the microphone heard during playback was dropped WITHOUT BEING COUNTED for "' + label +
      '". It is not a fault, but it is the only number that says how much of the avatar\'s own ' +
      'voice the room fails to cancel — and a gate with no counter is how av-6.1.0 shipped a ' +
      'report saying "echo cancellation active" while it self-triggered on every question.');
  }
  /* and with nothing playing, the patient's words still reach the line */
  const h = harness({ pvSaying: '' });
  h.inst.listen();
  h.inst.interim('its more in my lower back');
  assert.ok(h.log.some((l) => l.indexOf('line:transcript:its more in my lower back') === 0),
    'the live transcript no longer reaches the patient-facing line — the one signal that tells ' +
    'a patient the machine is hearing them');
  assert.strictEqual(h.kiosk.heard, true, 'speech no longer resets the silence watchdog');
}

/* ── A4. ⛔ THE CONTROL THAT MATTERS MOST: A REAL ANSWER IS STILL FILED ─────────────────────
   The filing path is deliberately NOT touched by any of this. It is executed here, on the
   shipped handler, with the shapes that were measured being deleted the last time somebody put
   an echo rule on it (9 of 12, then 22 of 22). */
{
  const REAL_ANSWERS = [
    ['the answer built entirely from the question\'s own words', 'in the morning', 0],
    ['a bare laterality — the answer that causes a wrong-site error', 'left', 0],
    ['a bare refusal', 'no', 0],
    ['a number on a pain scale', 'seven', 0],
    ['an ordinary sentence', 'its more in my lower back on the right side', 4],
    ['a red flag', 'my chest feels tight too', 3],
  ];
  for (const [label, said, novel] of REAL_ANSWERS) {
    for (const gateReady of [false, true]) {
      for (const presence of [false, true]) {
        const h = harness({ pvSaying: '', novel, gateReady, presence });
        h.inst.listen();
        h.inst.final(said);
        assert.ok(h.log.indexOf('TURN:' + said) >= 0,
          'A PATIENT\'S ANSWER WAS DROPPED (' + label + ', gateReady=' + gateReady +
          ', presence=' + presence + '). Deciding to stop talking is never destructive; ' +
          'refusing to file an answer destroys clinical information. This is the regression ' +
          'that cost 9 of 12 and then 22 of 22 ordinary A-or-B answers.');
      }
    }
  }
  /* and the pre-existing echo refusal is UNCHANGED — it still needs BOTH audio evidence and a
     zero novel-word count, so a real answer survives a microphone that never registered the
     person who spoke it (the noisy-room case) */
  const win = lift('if (pvIsSelfEcho(finalText)) return;', '\n    }, function (interim)', 'the filing gate');
  assert.ok(/pvVoiceGateReady\(\)/.test(win) && /pvNovelWordCount\(pvSaying, finalText\) === 0/.test(win),
    'THE FILING REFUSAL LOST A CONDITION. It must require confirmed echo cancellation AND zero ' +
    'novel words; audio alone deletes every answer a soft-spoken patient gives in a noisy room, ' +
    'and words alone delete "in the morning".');
  assert.ok(!/interim\.split|novel >= /.test(kioskListenSrc.slice(kioskListenSrc.indexOf('function (interim)'))),
    'a word-count rule is back on the interim path — it is exactly what could not be made sound');
}

/* ── A5. THE INTERRUPT IS A BUTTON, AND IT IS THE ONLY WAY IN ──────────────────────────────── */
{
  const callers = (src.match(/pvStopSpeechOnly\(\);/g) || []).length;
  assert.strictEqual(callers, 1,
    'pvStopSpeechOnly has ' + callers + ' call sites. With more than one, nothing can be ' +
    'concluded about what silenced a question — and the whole diagnosis of "it never gets out ' +
    'everything it wants to say" rests on there being exactly one thing that can cut one off.');
  const skipAt = src.indexOf('function kioskSkipSpeech()');
  const skipEnd = src.indexOf('\n  /* Natural completion', skipAt);
  assert.ok(skipAt > 0 && /pvStopSpeechOnly\(\);/.test(src.slice(skipAt, skipEnd)),
    'the one call site is no longer inside kioskSkipSpeech — the interrupt must be a TAP, ' +
    'because our own loudspeaker can defeat any classifier and has, three times');
  /* it is wired to a real control, that control exists in the shipped markup, and the shipped
     stylesheet reveals it exactly while a sentence is playing */
  assert.ok(/querySelector\('#mlsAvKioskSkip'\)\.addEventListener\('click', kioskSkipSpeech\)/.test(src),
    'the interrupt button is not wired to anything — a patient would have no way to cut in at all');
  const html = lib.liftKioskHtml(src);
  assert.ok(/id="mlsAvKioskSkip"/.test(html), 'the interrupt button is not in the kiosk markup');
  const css = lib.liftKioskCss(src);
  assert.ok(/#mlsAvKiosk\.speaking #mlsAvKioskSkip\{visibility:visible\}/.test(css),
    'the interrupt button is not revealed by the class that means "a sentence is playing" — ' +
    '"can I interrupt" and "is it talking" have to be one fact, or the button lies');
  assert.ok(/#mlsAvKioskSkip\{visibility:hidden/.test(css),
    'the interrupt button reserves no space while it is hidden, so the whole column jumps every ' +
    'time the avatar starts and stops speaking — on a patient-facing screen that reads as a fault');
  /* ⛔ AND IT MUST NOT FLOAT. My first version was position:absolute;bottom:2.2vh on the
     reasoning that it then costs the column no height — and the rendered proof measured it
     sitting ON TOP of the live transcript (19-21px) and the progress line (20-27px) at all four
     viewport sizes. Absolute positioning does not remove an element from the layout, it removes
     the LAYOUT'S KNOWLEDGE of it, which is the same class of defect as the min-height override
     this whole group exists for. */
  assert.ok(!/#mlsAvKioskSkip\{[^}]*position:(absolute|fixed)/.test(css),
    'THE INTERRUPT BUTTON IS FLOATING OVER THE COLUMN AGAIN. Measured: it covered 19-21px of the ' +
    'live transcript and 20-27px of the progress line in the busiest state, at every viewport ' +
    'size — the owner\'s overlapping-text complaint, reintroduced by the fix for it.');
  assert.ok(/#mlsAvKiosk\.preconsent #mlsAvKioskSkip\{display:none!important\}/.test(css),
    'the interrupt button is reachable BEFORE consent — the tab order on the consent screen is ' +
    'supposed to contain exactly Yes and No, and a hidden control is the only reliable way');
  /* EXECUTED: it interrupts only when there is something to interrupt, and it does NOT touch the
     microphone — the microphone is already open, and pvStopSpeechOnly ends the sentence so the
     turn's own continuation runs (group A6). Two things racing to open one recogniser is how a
     just-created one gets torn down again. */
  const speaking = harness({ pvSaying: 'is the pain in your back or in your neck' });
  assert.strictEqual(speaking.inst.skip(), true, 'the interrupt button does nothing while a sentence plays');
  assert.ok(speaking.log.indexOf('pvStopSpeechOnly') >= 0, 'the tap did not stop the speech');
  assert.ok(speaking.log.indexOf('pvListen') < 0,
    'THE TAP OPENED A SECOND RECOGNISER. The microphone never closed, so opening one here tears ' +
    'down the live one and loses whatever the patient said while they were reaching for the ' +
    'button — the interrupt would then eat the very words it was pressed to make room for.');
  assert.strictEqual(speaking.kiosk.barged, 1, 'a real interruption is not counted anywhere');
  const silent = harness({ pvSaying: '' });
  assert.strictEqual(silent.inst.skip(), undefined, 'the button acts when nothing is playing');
  assert.ok(silent.log.indexOf('pvStopSpeechOnly') < 0, 'the button stopped a sentence that was not there');
  /* ⚠️ AND IT ASKS THE AUDIO, NOT THE ESTIMATE (defect 2). pvSaying is cleared by an
     estimated-duration watchdog, so a patient who can still HEAR the avatar and taps the visible
     button must not be told, silently, that nothing was playing. */
  const stillAudible = harness({ pvSaying: '', audioLive: true });
  assert.strictEqual(stillAudible.inst.skip(), true,
    'THE INTERRUPT IS DEAD WHILE THE LOUDSPEAKER IS STILL PLAYING. Its guard reads pvSaying, ' +
    'which an ESTIMATE clears early — so the button is visible, the avatar is audible, and ' +
    'tapping it does nothing at all.');
  for (const state of [{ paused: true }, { completed: true }, { ambient: true }, { consentAt: 0 }, { open: false }]) {
    const h = harness({ pvSaying: 'a question', kiosk: state });
    h.inst.skip();
    assert.ok(h.log.indexOf('pvStopSpeechOnly') < 0,
      'the interrupt fired in a state where it must not (' + JSON.stringify(state) + ')');
  }
}

/* ── A6. 🚨 AN INTERRUPTED SENTENCE *ENDS*. IT IS NOT ORPHANED. (defect 4) ──────────────────
   This is the demonstrated failure of the interrupt control on the CLOSING line, and it is a
   sequencing bug, not a policy one. pvSpeakVoiced's finish() is the only thing that runs the
   caller's continuation, and it refuses to run once pvSpeakSeq has moved on — while
   pvStopSpeechOnly's FIRST statement was pvSpeakSeq++. So every tap on "skip ahead" made the
   continuation unreachable for ever:
     · on an ordinary question the continuation re-arms the 9-second silence clock and puts the
       screen into its listening state, so the interview sat there mute;
     · on the CLOSING line the continuation IS kioskFinish, so tapping skip on the last sentence a
       patient hears left the check-in unfinished — no rest screen, nothing handed back to staff,
       and only a 12-second net to rescue it. A hang, not a crash, which is why it was invisible.
   EXECUTED end to end: the real pvSpeakVoiced ending, the real pvStopSpeechOnly, and the two real
   continuations that reach them. */
{
  const speakSrc = lift('function pvSpeakVoiced(text, then, voiceOverride, shape)', '\n    var t = String(text == null', 'pvSpeakVoiced head');
  const stopSrc = lift('function pvStopSpeechOnly()', '\n  function pvStopVoice()', 'pvStopSpeechOnly');
  const liveSrc = lift('  var pvAudioStartAt = 0;', '\n  /* the continuation of the sentence', 'pvAudioLive');
  const mk = () => {
    const log = [];
    const api = new Function('log', `
      var pvSpeakSeq = 0, pvSaying = '', pvWatchdog = null, pvHeld = [], ttsAudioNow = null;
      var kiosk = { ambient: false };
      var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
      var window = { speechSynthesis: { speaking: false, cancel: function () { log.push('synth.cancel'); } } };
      var faceTalkStop = function () { log.push('faceTalkStop'); };
      var pvEchoHold = function (t) { log.push('echoHold:' + t); };
      var pvNorm = function (t) { return String(t).toLowerCase(); };
      var clearTimeout = function () {};
      var pvRec = null;
      var isFn = function (f) { return typeof f === 'function'; };
      ${reAskSrc}
      ${liveSrc}
      ${stopSrc}
      /* pvSpeakVoiced's real head, cut off just before it starts fetching audio: everything this
         group is about — finish(), pvFinishNow, pvSaying, pvAudioStartAt — lives in it. */
      ${speakSrc}
        pvSaying = pvNorm(text);
        pvFinishNow = finish;
        pvAudioStartAt = Date.now();
        return { finish: finish };
      }
      return {
        speak: function (t, then) { return pvSpeakVoiced(t, then); },
        stop: function () { return pvStopSpeechOnly(); },
        saying: function () { return pvSaying; },
        seq: function () { return pvSpeakSeq; },
        pending: function () { return !!pvFinishNow; }
      };
    `);
    return { inst: api(log), log };
  };
  /* (1) the ordinary question: the tap ends the sentence and the turn's continuation RUNS */
  let h = mk();
  let ran = 0;
  h.inst.speak('is the pain in your back, or in your neck?', () => { ran++; h.log.push('continuation'); });
  h.inst.stop();
  assert.strictEqual(ran, 1,
    '🚨 THE INTERRUPT ORPHANED THE SENTENCE\'S CONTINUATION (' + ran + ' runs). On a question that ' +
    'is the callback that re-arms the silence clock and puts the screen into its listening state, ' +
    'so the interview goes mute; the interrupt button then makes the kiosk look broken.');
  assert.strictEqual(h.inst.saying(), '', 'the interrupted sentence is still marked as playing');
  assert.ok(h.log.indexOf('synth.cancel') >= 0, 'the tap did not actually silence the synthesiser');
  assert.ok(h.log.indexOf('synth.cancel') < h.log.indexOf('continuation'),
    'the continuation ran BEFORE the sound was stopped, so whatever it starts next (a question, ' +
    'the rest screen) overlaps the sentence being cut short');
  /* (2) EXACTLY ONCE. A continuation that runs twice on the closing line files the visit twice. */
  h = mk(); ran = 0;
  h.inst.speak('All set — thank you. Your doctor will be in with you soon.', () => { ran++; });
  h.inst.stop();
  h.inst.stop();
  assert.strictEqual(ran, 1, 'the continuation ran ' + ran + ' times — two taps on "skip ahead" ' +
    'must not finish a check-in twice, or the visit is written twice');
  assert.strictEqual(h.inst.pending(), false, 'the finished sentence is still registered as the ' +
    'one that can be interrupted, so a later tap would re-run its continuation');
  /* (3) nothing playing: a tap must not invent a continuation out of a previous sentence */
  h = mk();
  h.inst.stop();
  assert.strictEqual(h.inst.seq() > 0, true, 'pvStopSpeechOnly no longer voids late callbacks');
  /* (4) and the CLOSING line's continuation is kioskFinish, in the shipped call — so (1) and (2)
     are about the real hang, not a hypothetical one */
  assert.ok(/pvSpeakShaped\(kiosk\.lastSay, function \(\) \{ kioskFinish\(\); \}, saidShape\);/.test(src),
    'the closing line no longer finishes the check-in from its own continuation — if that moves, ' +
    'the 12-second net becomes the only thing that ends an interview');
}

/* ── A7. THE SILENCE WATCHDOG MUST NOT TALK OVER A LIVE SENTENCE ───────────────────────────
   Every branch of kioskWatchdog begins with pvStopVoice(), so reaching it while a sentence is
   playing is a truncation with a "take your time" nudge painted over the question.
   ⚠️ AND ITS FENCE MUST ASK THE AUDIO, NOT pvSaying (defect 2). The third fixture below is the one
   that matters: pvSaying already CLEARED (an estimated-duration watchdog fired early) while the
   loudspeaker is still playing. A fence on pvSaying passes that case straight through. */
{
  const wd = lift('function kioskWatchdog()', 'function kioskStopBounded()', 'kioskWatchdog');
  const mk = (pvSaying, kiosk, audioLive) => {
    const log = [];
    const fn = new Function('log', 'kiosk', 'pvSaying', 'audioLive', `
      var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
      var NUDGE_LINE = 'take your time';
      var pvAudioLive = function () { return audioLive === undefined ? !!pvSaying : !!audioLive; };
      /* fixed, so the re-arm below is a deterministic number rather than a wall-clock one */
      var pvAudioRemainingMs = function () { return 5000; };
      var pvAbandonSpeech = function () { log.push('pvAbandonSpeech'); };
      var pvSpeakShaped = function (t, then) { log.push('speak:' + t); };
      var kioskListen = function () { log.push('kioskListen'); };
      var kioskArmWatchdog = function (ms) { log.push('arm:' + ms); };
      var kioskMood = function () {};
      var kioskTurn = function () { log.push('finishTurn'); };
      var kioskStopBounded = function () { log.push('stopBounded'); };
      ${wd}
      kioskWatchdog();
    `);
    fn(log, Object.assign({ open: true, busy: false, completed: false, ambient: false,
      heard: false, silent: 0, lastSay: 'q', nudgedFor: null }, kiosk || {}), pvSaying, audioLive);
    return log;
  };
  /* ⚠️ THE EXPECTED LOG IS TOTAL, NOT FILTERED, and it is exactly one re-arm.
     ⛔ IT USED TO BE `[]`, i.e. the watchdog returned and DROPPED THE ONLY TIMER THAT CAN REVIVE A
     STALLED QUESTION, on the reasoning that the speak continuation always arms a fresh one. That
     reasoning is one code path away from being wrong at any time and its failure mode is a kiosk
     that sits silent for ever — the same shape as the closing net's hang (group A12). Waiting is
     right; walking away is not. The re-arm is ONE, past the audio trust window, so it is bounded
     and is not a poll. */
  assert.deepEqual(mk('a question still playing', {}), ['arm:5750'],
    'THE WATCHDOG STILL FIRES OVER A LIVE SENTENCE (or it returned without re-arming, which loses ' +
    'the only timer that can revive the question). Its first act is pvAbandonSpeech() and its ' +
    'second is speaking a nudge, so a question longer than the clock talked over its own second ' +
    'half and then cut itself off.');
  assert.deepEqual(mk('', {}, true), ['arm:5750'],
    'THE WATCHDOG FIRES WHILE THE LOUDSPEAKER IS STILL PLAYING. Its fence reads pvSaying, which ' +
    'the ESTIMATED-duration speech watchdog clears early — so "take your time" is spoken over the ' +
    'second half of the question, and the question is cut off to say it. The fence must ask ' +
    'pvAudioLive(), which reads the audio element and the synthesiser.');
  /* ══ THE ASSERTION THAT USED TO LIVE HERE PINNED THIS ROUND'S OWN REGRESSION AS A REQUIREMENT ══
     ⛔ av-6.3.1 wrote the fence as `if (pvAudioLive()) { if (audioWaits < 3) { wait; return; } }` and
     asserted, here, that with audioWaits already at 3 the watchdog must "proceed" — which means reach
     pvAbandonSpeech() and cut a live sentence mid-word to say "take your time" over it. The pre-fix
     bytes had no such breach. The assertion read:
         mk('', { audioWaits: 3 }, true) must log something other than an arm
         "THE WATCHDOG CAN BE POSTPONED FOR EVER by an audio signal that stays live. After a bounded
          number of waits it must proceed — a stuck signal must degrade to a nudge, never to silence."
     The REQUIREMENT in that sentence is right; the behaviour it demanded is the exact harm this
     lane exists to remove, and a suite that pins a regression as intended converts a defect into a
     requirement. CORRECTED av-6.3.2, and the reason recorded here rather than in a commit message.
     WHERE THE REQUIREMENT IS ACTUALLY MET: pvAudioLive() is FALSE outside the trust window that
     begins when a sentence starts (group A0, and T6 in the turn suite, both of which EXECUTE it), so
     a stuck signal cannot hold this fence shut. The re-arm is computed from pvAudioRemainingMs(), so
     it lands AFTER that window closes — the wait terminates by construction, and the only way the
     next tick still finds audio live is that a NEW sentence started, which is a kiosk that is
     working rather than one that has stalled. So: it waits, however many times it has already
     waited, and it never cuts. */
  assert.deepEqual(mk('', { audioWaits: 3 }, true), ['arm:5750'],
    '🚨 THE WATCHDOG CUT A LIVE SENTENCE. It fell through its own audio fence after a fixed number ' +
    'of waits and reached pvAbandonSpeech(), which stops the audio mid-word, and then spoke a nudge ' +
    'over the question it was supposed to be waiting for. That is the owner\'s report ("it never ' +
    'gets out everything it wants to say") re-created by the guard written to prevent it. The wait ' +
    'is already bounded where it belongs — pvAudioLive() is false outside the trust window — so no ' +
    'cap here is needed and none may cut a sentence. Log: ' +
    JSON.stringify(mk('', { audioWaits: 3 }, true)));
  assert.deepEqual(mk('', { audioWaits: 99 }, true), ['arm:5750'],
    'the watchdog cuts a live sentence once it has waited enough times. There is no number of ' +
    'previous waits that makes cutting the patient\'s question off correct.');
  /* AND THE WAIT REALLY DOES TERMINATE, asserted positively rather than bought with a breach: the
     re-arm is the AUDIO WINDOW's own remainder, never a fixed interval, so the next tick lands past
     the point at which pvAudioLive() must answer no. A fixed re-arm would be a polling timer. */
  assert.deepEqual(mk('', {}, true), ['arm:5750'],
    'the watchdog re-arms on a fixed interval rather than from pvAudioRemainingMs(). A fixed ' +
    'interval is a poll (forbidden in this module) and it never lands past the audio trust window, ' +
    'so it can spin for as long as a signal stays stuck instead of terminating by construction.');
  /* ── AND THE COMPOSITION, EXECUTED: A STUCK SIGNAL DEGRADES TO A NUDGE BECAUSE THE FENCE CLOSES ─
     This is the requirement the deleted assertion was reaching for, met without a breach. The REAL
     pvAudioLive is lifted and handed an Audio element that is stuck reporting itself playing, with the
     sentence's start time older than the trust ceiling. The watchdog must nudge — and it must nudge
     because the fence answered no, not because it gave up and cut. */
  {
    const liveSrc = lift('  var pvAudioStartAt = 0;', '\n  /* the continuation of the sentence', 'pvAudioLive');
    const stuckLog = [];
    const out = new Function('log', `
      var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
      var NUDGE_LINE = 'take your time';
      var pvSaying = 'a sentence that never reports itself done';
      var ttsAudioNow = { paused: false, ended: false };            /* stuck true, for ever */
      var window = { speechSynthesis: { speaking: true } };          /* and so is the synthesiser */
      var pvSpeakSeq = 1, pvWatchdog = null;
      ${liveSrc}
      /* the sentence started longer ago than any sentence this file can produce */
      pvAudioStartAt = Date.now() - (PV_AUDIO_TRUST_MS + 5000);
      var kiosk = { open: true, busy: false, completed: false, ambient: false, heard: false,
        silent: 0, lastSay: 'q', nudgedFor: null, audioWaits: 0 };
      var pvAbandonSpeech = function () { log.push('pvAbandonSpeech'); };
      var pvSpeakShaped = function (t) { log.push('speak:' + t); };
      var kioskListen = function () { log.push('kioskListen'); };
      var kioskArmWatchdog = function (ms) { log.push('arm:' + ms); };
      var kioskMood = function () {};
      var kioskTurn = function () { log.push('finishTurn'); };
      var kioskStopBounded = function () { log.push('stopBounded'); };
      ${wd}
      var playing = pvAudioPlaying(), fence = pvAudioLive();
      kioskWatchdog();
      return { stuckSignalSaysPlaying: playing, fenceSays: fence };
    `)(stuckLog);
    assert.strictEqual(out.stuckSignalSaysPlaying, true,
      'this proof is not set up: the element is not reporting itself as playing, so nothing is stuck ' +
      'and the case being proved does not exist');
    assert.strictEqual(out.fenceSays, false,
      'A SIGNAL STUCK TRUE HOLDS THE AUDIO FENCE SHUT FOR EVER. That is the hazard the deleted ' +
      'audioWaits cap was aimed at, and the trust CEILING in pvAudioLive is where it is answered — ' +
      'if the ceiling stops working, the watchdog waits for ever and the only remedy on offer is ' +
      'cutting live sentences.');
    assert.ok(stuckLog.some((l) => l.indexOf('speak:') === 0),
      'A STUCK AUDIO SIGNAL SILENCED THE KIOSK. With the trust ceiling passed the fence must answer ' +
      'no and the watchdog must nudge; it logged ' + JSON.stringify(stuckLog) + ' instead. This is ' +
      'the "never to silence" half of the requirement, met by the fence closing rather than by the ' +
      'watchdog cutting a sentence.');
  }
  const nudged = mk('', {}, false);
  assert.ok(nudged.indexOf('pvAbandonSpeech') >= 0 && nudged.some((l) => l.indexOf('speak:') === 0),
    'the watchdog no longer nudges a silent patient at all — the interview would sit forever');
  /* ⛔ AND IT STOPS THE SPEECH WITHOUT CLOSING THE MICROPHONE. pvStopVoice tears the recogniser
     down, and two of the three branches re-open it immediately afterwards — so the nudge used to
     destroy the recogniser holding whatever the patient had already started saying and replace it
     with one that began listening mid-word. A rebuilt recogniser cannot know whether the first
     thing it hears is the middle of a sentence (group A1b). */
  assert.ok(!/pvStopVoice\(\)/.test(wd),
    'kioskWatchdog closes the MICROPHONE again (pvStopVoice) where it only needs the sentence to ' +
    'stop (pvAbandonSpeech). Two of its three branches re-open the mic on the next line, so this ' +
    'is the clearest tear-down-and-rebuild in the file and it re-clips the patient mid-word.');
}

/* ── A8. THE CLOSING LINE MUST NOT RACE A FIXED BUDGET ─────────────────────────────────────
   kioskFinish's first act is pvStopVoice(), and the safety net was armed from the RESPONSE, so
   the longest line in the interview — the one that tells the patient what happens next — raced
   12 seconds that included its own generation latency. Measured cut at exactly 12000ms. */
{
  /* the net is a named helper now, and it has to be: an inline one-shot cannot re-arm, and a net
     that does not re-arm is the hang below */
  const netSrc = lift('  var DONE_NET_MAX', '\n  /* THE SELF-END WATCHDOG', 'the done net');
  assert.ok(/kioskArmDoneNet\(12000, 0\);/.test(src),
    'the closing branch no longer arms the safety net at all — a stranded continuation would leave ' +
    'the patient on "thank you" for ever');
  /* EXECUTED with a driven clock: every timer the net arms is run, in order, and the harness
     records how many it took. A bounded wait that asserts PROGRESS — not merely that nothing threw. */
  const mk = (liveForever) => {
    const log = [];
    const timers = [];
    new Function('log', 'timers', 'liveForever', 'setTimeout', `
      var kiosk = { open: true, completed: false };
      var pvAudioLive = function () { return !!liveForever; };
      var pvAudioRemainingMs = function () { return 4000; };
      var kioskFinish = function () { log.push('kioskFinish'); };
      ${netSrc}
      kioskArmDoneNet(12000, 0);
    `)(log, timers, liveForever, (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
    assert.ok(timers.length, 'the 12-second net is gone entirely — a stranded continuation would hang the kiosk');
    assert.strictEqual(timers[0].ms, 12000, 'the net no longer waits 12 seconds first');
    /* drain, with a hard ceiling so a genuine hang shows up as a failure here rather than as a
       hanging test run */
    let fired = 0;
    while (timers.length && fired < 50) { fired++; timers.shift().fn(); }
    return { log, fired, pending: timers.length };
  };
  const still = mk(true);
  assert.deepEqual(still.log, ['kioskFinish'],
    '🚨 THE CHECK-IN HANGS FOR EVER. The safety net is the ONLY thing that ends an interview whose ' +
    'closing-line continuation was stranded — that is the entire reason it exists — and guarding it ' +
    'with `!pvAudioLive()` as a ONE-SHOT means that when audio is still live at t=12000 the timer ' +
    'simply evaporates. The patient sits on the "thank you" screen, the rest screen never comes up, ' +
    'and staff never get the visit back. The pre-fix code did not have this: its net was ' +
    'unconditional. Waiting for the loudspeaker is right; walking away is not. Fired ' + still.fired +
    ' timer(s), log: ' + JSON.stringify(still.log));
  assert.ok(still.fired > 1 && still.fired <= 5,
    'the net either did not wait for the loudspeaker at all, or waited an unbounded number of times ' +
    '(' + still.fired + ' timers). It must extend a BOUNDED number of times and then finish: an ' +
    'unbounded extension is a poll, which this module forbids, and it is a hang by another name.');
  assert.strictEqual(still.pending, 0, 'the net left a timer armed after finishing the check-in');
  const done = mk(false);
  assert.deepEqual(done.log, ['kioskFinish'],
    'the net no longer closes a check-in whose continuation never fired — the kiosk would never rest');
  assert.strictEqual(done.fired, 1,
    'with nothing playing the net must finish on its FIRST expiry; it fired ' + done.fired +
    ' times, so an ordinary close is being delayed by up to a minute');
  /* and the closing line must still not be CUT: the first expiry with audio live may not finish */
  const cutCheck = [];
  const t = [];
  new Function('log', 'setTimeout', `
    var kiosk = { open: true, completed: false };
    var live = true;
    var pvAudioLive = function () { return live; };
    var pvAudioRemainingMs = function () { return 4000; };
    var kioskFinish = function () { log.push('kioskFinish'); };
    ${netSrc}
    kioskArmDoneNet(12000, 0);
  `)(cutCheck, (fn, ms) => { t.push({ fn, ms }); return t.length; });
  t.shift().fn();
  assert.deepEqual(cutCheck, [],
    'THE CLOSING LINE IS STILL BEING CUT OFF at 12 seconds by its own safety net. Measured: a ' +
    '26-word closing line whose second half took 6000ms to generate was cut at exactly 12000ms. ' +
    '(And the net must ask pvAudioLive(), not pvSaying: an estimate that clears early would hand ' +
    'the net a sentence it believes has ended while the patient can still hear it.)');
}

/* ── A9. ONE SENTENCE, ONE PLAYBACK ────────────────────────────────────────────────────────
   ttsPlayUrl's callback is armed three ways (ended, error, duration watchdog) and on the
   two-chunk path that callback is the one that STARTS the second half. Measured: the second half
   plays TWICE once its generation exceeds 20ms + 2500ms + dur0 — two Audio objects over each
   other, and the patient-facing line written twice. "everything gets so fucked up", with no
   microphone involved at all. */
{
  const playSrc = lift('function ttsPlayUrl(url, mySeq, finish)', '\n  var cameraStream', 'ttsPlayUrl');
  /* the REAL watchdog arming helper comes along, because ttsPlayUrl now goes through it — a stub
     here would let the estimate end a sentence that is still audible and the group would be
     testing a shape production does not have */
  const wdSrc = lift('  function pvArmSpeechWatchdog(', '\n  /* the continuation of the sentence', 'pvArmSpeechWatchdog');
  const liveSrc = lift('  var pvAudioStartAt = 0;', '\n  /* the continuation of the sentence', 'pvAudioLive');
  const run = new Function('report', `
    var pvSpeakSeq = 7, pvWatchdog = null, ttsAudioNow = null, ttsCtx = null, ttsRaf = 0, pvSaying = '';
    var kiosk = { face: null };
    var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
    var window = { speechSynthesis: null };
    var faceTalkCycle = function () {}, faceTalkStop = function () {};
    var timers = [];
    var setTimeout = function (fn) { timers.push(fn); return timers.length; };
    var clearTimeout = function () {};
    var requestAnimationFrame = function () { return 0; };
    var made = [];
    var Audio = function (url) {
      /* paused:true — the audio has NOT started yet when the watchdog fires in this fixture, which
         is what makes the watchdog the thing that ends the sentence. With paused:false the new
         extension would (correctly) wait for the real end event instead, and this group would
         stop exercising the three-way race it exists for. */
      this.url = url; this.duration = 2; this.ended = false; this.paused = true;
      this.play = function () { return { catch: function () {} }; };
      made.push(this);
    };
    ${liveSrc}
    ${playSrc}
    var plays = 0;
    ttsPlayUrl('blob:one', 7, function () { plays++; });
    var a = made[0];
    a.onloadedmetadata();          /* metadata arrives, the duration watchdog is armed */
    var fire = timers.slice(); timers.length = 0;
    fire.forEach(function (t) { t(); });     /* ...and it fires, because generation ran long */
    a.ended = true; a.onended();   /* ...and THEN the audio ends, as it always would */
    a.onerror();                   /* and an error afterwards must not count either */
    report({ plays: plays, extended: timers.length });
  `);
  let out = null;
  run((n) => { out = n; });
  assert.strictEqual(out.plays, 1,
    'THE SECOND HALF OF THE SENTENCE PLAYS ' + out.plays + ' TIMES. ttsPlayUrl handed its callback ' +
    'to onended, onerror AND the duration watchdog with no idempotence, so two Audio objects ' +
    'played the same words over each other and the patient-facing line was written twice.');
  /* AND THE ESTIMATE DEFERS TO THE PLATFORM (defect 2): with the clip still playing, the watchdog
     must WAIT rather than declare the sentence over. */
  const run2 = new Function('report', `
    var pvSpeakSeq = 7, pvWatchdog = null, ttsAudioNow = null, ttsCtx = null, ttsRaf = 0, pvSaying = 'a sentence';
    var kiosk = { face: null };
    var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
    var window = { speechSynthesis: null };
    var faceTalkCycle = function () {}, faceTalkStop = function () {};
    var timers = [];
    var setTimeout = function (fn) { timers.push(fn); return timers.length; };
    var clearTimeout = function () {};
    var requestAnimationFrame = function () { return 0; };
    var made = [];
    var Audio = function (url) {
      this.url = url; this.duration = 2; this.ended = false; this.paused = false;   /* STILL PLAYING */
      this.play = function () { return { catch: function () {} }; };
      made.push(this);
    };
    ${liveSrc}
    ${playSrc}
    var plays = 0;
    ttsPlayUrl('blob:one', 7, function () { plays++; });
    var a = made[0];
    a.onloadedmetadata();
    var fire = timers.slice(); timers.length = 0;
    fire.forEach(function (t) { t(); });
    report({ plays: plays, rearmed: timers.length });
  `);
  let out2 = null;
  run2((n) => { out2 = n; });
  assert.strictEqual(out2.plays, 0,
    'THE ESTIMATE ENDED A SENTENCE THAT WAS STILL PLAYING. The duration watchdog fired while the ' +
    'audio element reported itself unpaused and not ended — so pvSaying cleared, the continuation ' +
    'ran, and every gate keyed to "is it still talking" opened over the top of the loudspeaker. ' +
    'That is defect 2 of the review round, one layer down from the fences that read it.');
  assert.strictEqual(out2.rearmed, 1,
    'the watchdog waited for the audio but never re-armed, so if the `ended` event never arrives ' +
    'the sentence hangs for ever — the reason the watchdog exists in the first place');
}

/* ── A10. THE CENSUS: EVERY PATH THAT CAN CUT A SENTENCE SHORT ─────────────────────────────
   The whole reason this defect survived two releases is that the investigation looked at
   pvStopSpeechOnly, which has ONE call site, while pvStopVoice does the same damage
   (pvSpeakSeq++, ttsAudioNow.pause(), speechSynthesis.cancel(), pvSaying='') from THIRTEEN. So
   the census is the guard: every call site must be a place where a HUMAN asked for it, or be
   fenced against a live sentence. A new one that is neither fails here by name — which is the
   only way this class of defect stops recurring, because reading one function cannot find it. */
{
  const lines = src.split('\n');
  let fn = '';
  const sites = [];
  /* ⚠️ BOTH NAMES, and that is the point of counting rather than reading. av-6.3.1 split the old
     pvStopVoice into pvAbandonSpeech (silence the sentence) + pvStopMicOnly (close the microphone),
     because closing the microphone between turns is what let a REBUILT recogniser start listening
     mid-sentence. pvAbandonSpeech does exactly the damage this census exists to track —
     pvSpeakSeq++, pause the audio, cancel the synth, clear pvSaying — so a census that only knew
     the old name would have silently stopped seeing four of the sites it was written to guard.
     A test that stops seeing its subject is a test that has stopped working. */
  lines.forEach((ln, i) => {
    const m = /^  function ([A-Za-z0-9_$]+)/.exec(ln);
    if (m) fn = m[1];
    if (/(pvStopVoice|pvAbandonSpeech)\(\);/.test(ln) &&
        !/function (pvStopVoice|pvAbandonSpeech)/.test(ln)) sites.push({ fn, line: i + 1 });
  });
  /* A HUMAN ASKED: a tap, a Send, a staff exit, a lifecycle boundary. Cutting the speech is what
     was requested, and none of these can be triggered by our own audio. */
  const HUMAN = ['setupForm', 'kioskClose', 'kioskRequestEnd', 'kioskPauseToggle', 'openKiosk',
    'kioskAmbientStart', 'kioskAmbientStop'];
  /* REACHED ONLY WITH NOTHING PLAYING, and each one is fenced or proven above:
     kioskTurn      - entered from a FINAL result (the microphone is only open when not speaking),
                      from kioskTypedSubmit (the patient pressed Send), or from kioskWatchdog's
                      auto-finish, which is fenced;
     kioskWatchdog  - `if (pvAudioLive())` on its first lines (group A7, executed);
     kioskStopBounded - reached only from kioskWatchdog, behind that same fence;
     kioskFinish    - reached from the speak continuation (the sentence has ended) or from the
                      12-second net, which tests pvAudioLive() and re-arms (group A8, executed). */
  const FENCED = ['kioskTurn', 'kioskWatchdog', 'kioskStopBounded', 'kioskFinish'];
  /* the COMPOSITION itself: pvStopVoice is defined as pvAbandonSpeech() + pvStopMicOnly(), so the
     body of pvStopVoice is one of the matches above. It is not a call site, it is the definition of
     the full stop, and it is named here rather than pattern-matched away. */
  const COMPOSED = ['pvStopVoice'];
  const rogue = sites.filter((s) => HUMAN.indexOf(s.fn) < 0 && FENCED.indexOf(s.fn) < 0 &&
    COMPOSED.indexOf(s.fn) < 0);
  assert.deepEqual(rogue.map((s) => s.fn + ':' + s.line), [],
    'A NEW WAY TO CUT THE AVATAR OFF MID-SENTENCE. pvStopVoice/pvAbandonSpeech do exactly what ' +
    'barge-in does — pvSpeakSeq++, pause the audio, cancel the synth, clear pvSaying — and they do ' +
    'it from ' + sites.length + ' places. A call site that is neither a human action nor fenced ' +
    'against a live sentence is the defect the owner reported twice: ' +
    rogue.map((s) => s.fn + ' (line ' + s.line + ')').join(', '));
  assert.ok(sites.length >= 13, 'only ' + sites.length + ' speech-stop call sites found — the ' +
    'census is not seeing them, so it is guarding nothing');
  /* ── AND THE MICROPHONE HALF IS COUNTED SEPARATELY, because it is the half that clips answers ──
     Every place that CLOSES the recogniser has to be a place where listening is genuinely over. A
     new pvStopVoice() inside the interview loop is a rebuilt recogniser, which is group A1b's
     wrong-site defect arriving from a different function. */
  const micSites = sites.filter((s) => /pvStopVoice\(\);/.test(lines[s.line - 1]) &&
    COMPOSED.indexOf(s.fn) < 0);
  const MIC_MAY_CLOSE = ['setupForm', 'kioskClose', 'kioskRequestEnd', 'kioskPauseToggle',
    'openKiosk', 'kioskAmbientStart', 'kioskAmbientStop', 'kioskStopBounded', 'kioskFinish'];
  assert.deepEqual(micSites.filter((s) => MIC_MAY_CLOSE.indexOf(s.fn) < 0)
    .map((s) => s.fn + ':' + s.line), [],
    'SOMETHING INSIDE THE INTERVIEW LOOP CLOSES THE MICROPHONE (pvStopVoice) where it only needs ' +
    'the sentence to stop (pvAbandonSpeech). Closing it forces the next turn to build a NEW ' +
    'recogniser, and a recogniser that starts listening at a moment nobody chose cannot know ' +
    'whether the first thing it hears is the middle of the patient\'s sentence — which is how ' +
    '"no pain in my left leg" was filed as "pain in my left leg". Listening is only over at a ' +
    'lifecycle boundary or a human action.');
  /* and the two fenced-by-a-guard functions must actually still carry their guard */
  for (const [name, endNeedle, guard] of [
    ['function kioskWatchdog()', 'function kioskStopBounded()', 'if (pvAudioLive()) {'],
    /* ⚠️ THE FENCE MOVED, and this is where the census now leans. kioskListen's old guard closed
       the MICROPHONE while the avatar spoke; that is what clipped the front off the patient's
       answer (group A1b), so the guard on it now is the one that matters here: a live recogniser
       is never torn down and rebuilt, which is what "kioskTurn is reached only from a FINAL
       result" rests on. */
    ['function kioskListen(keepMood)', '\n  /* ── THE INTERRUPT', 'if (pvRec) {'],
  ]) {
    const a = src.indexOf(name);
    assert.ok(a > 0, name + ' is gone');
    assert.ok(src.slice(a, src.indexOf(endNeedle, a)).indexOf(guard) >= 0,
      name + ' lost its fence (' + guard + ') — the census above is then relying on a guard that ' +
      'is not there');
  }
}

/* ── A11. A REFUSED UTTERANCE IS SAID OUT LOUD — AND AN ECHO IS NOT ────────────────────────
   The other half of the whole-or-refused rule (A1b). Refusing to file is the safe half of the
   decision; refusing SILENTLY is not, because a patient who answered and was not heard sits
   waiting for a machine that has already moved on. Executed on the SHIPPED onOverlap handler,
   captured from the real pvListen call. */
{
  const CASES = [
    /* label,                                        refused text,                     novel, tell? */
    ['a patient talking over the question', 'no its my right knee', 3, true],
    ['a patient interrupting with a red flag', 'my chest feels tight too', 3, true],
    /* ⚠️ AND THE ONE THAT MUST NOT APOLOGISE: our own voice coming back. Every room where echo
       cancellation is imperfect produces these on EVERY question, and "sorry, could you say that
       again?" to a patient who never spoke is worse than saying nothing. */
    ['the avatar\'s own voice, recognised as echo', 'is the pain in your back or in your neck', 0, false],
    ['a mis-transcription of our own voice (0 novel words)', 'is the pain in your bag', 0, false],
  ];
  for (const [label, refused, novel, shouldTell] of CASES) {
    const h = harness({ pvSaying: 'is the pain in your back or in your neck', novel,
      selfEcho: novel === 0 ? [refused] : [], audioLive: false });
    h.inst.listen();
    const before = h.log.length;
    h.inst.armGate();               /* submit() arms the gate on every refusal, before this handler runs */
    h.inst.overlap(refused);
    const said = h.log.slice(before).filter((l) => l.indexOf('line:hint') === 0);
    if (shouldTell) {
      assert.strictEqual(said.length, 1,
        'A PATIENT WAS NOT TOLD THAT THEIR ANSWER WAS DROPPED (' + label + '). The utterance ' +
        'overlapped the avatar, so it was refused whole — which is right — but nothing on the ' +
        'screen says so, and the patient waits for a machine that has moved on. ' +
        JSON.stringify(h.log.slice(before)));
      assert.strictEqual(h.kiosk.overlapRefused, 1,
        'a whole-utterance refusal was not counted (' + label + ') — nobody can then tell whether ' +
        'the questions are too long or the "skip ahead" button is invisible to patients');
    } else {
      assert.strictEqual(said.length, 0,
        'THE KIOSK APOLOGISED FOR ITS OWN ECHO (' + label + '). That fires on every question in ' +
        'any room whose echo cancellation is imperfect, and it asks a patient who never spoke to ' +
        'repeat themselves.');
      assert.strictEqual(h.kiosk.echoRefused, 1,
        'an echo refusal is no longer counted, so "it records itself talking" cannot be measured');
    }
    assert.strictEqual(h.kiosk.overlapHeard, 1,
      'the refusal was not counted at all (' + label + ')');
    assert.ok(!h.log.slice(before).some((l) => l.indexOf('TURN:') === 0),
      'A REFUSED UTTERANCE WAS FILED ANYWAY (' + label + ') — the refusal path must never reach ' +
      'the server, or the whole distinction is decoration');
    /* ══ 🚨 AND WHAT THIS HANDLER DOES WITH THE GATE IS THE DECISION MY OWN FIX GOT WRONG FIRST ════
       ⛔ It armed the restart gate on the ECHO path too, reasoning that a wrong audio boundary is a
       wrong audio boundary. It is not: every word of an echo turn is a word we were saying, so the
       patient contributed NOTHING and there is no half-answer of theirs to protect — and a room with
       imperfect echo cancellation produces one of these on nearly every question. Left armed, the
       rendered consent proof measured it DROP the patient's next real answer ("My right knee is
       swollen and it gave out yesterday": 0 of 1 filed armed, 1 of 1 with the stand-down). That is
       the 9-of-12 / 22-of-22 harm class, re-entered through the fix for a different defect.
       ⚠️ ASSERTED AFTER the apology assertions above, deliberately: A11b's control (the echo test
       disabled) must land on "THE KIOSK APOLOGISED FOR ITS OWN ECHO", which is its own name. Put
       first, this assertion stole that control's red and left A11b looking unproven. */
    assert.strictEqual(h.inst.gate().armed, !!shouldTell,
      shouldTell
        ? 'a refusal that really was the PATIENT stood the restart gate DOWN, so the next thing they ' +
          'say — the rest of the sentence they already started — is filable again (' + label + ')'
        : '🚨 THE RESTART GATE STAYED ARMED ON AN ALL-ECHO REFUSAL (' + label + '). Nothing of the ' +
          'patient\'s was ever in flight, so there is nothing to protect against — and the next ' +
          'thing they say gets REFUSED. Measured cost: their real answer, dropped. Rooms with ' +
          'imperfect echo cancellation produce one of these on nearly every question.');
  }
  /* ══ A11b. AND "TOLD" MEANS ASKED AGAIN, OUT LOUD (av-6.3.2) ═════════════════════════════════
     ⛔ ROUND 6 PRINTED A HINT AND NOTHING ELSE, and that is the whole reason the defect survived: a
     patient who is mid-sentence does not read a hint and does not stop, so the rest of their
     sentence arrived as a fresh "complete" turn and was filed with its negation missing. A refusal
     has to RE-PROMPT — and the answer that follows has to be one that began after the prompting. */
  {
    const h = harness({ pvSaying: 'is the pain in your left leg', novel: 3, audioLive: false });
    h.inst.listen();
    const before = h.log.length;
    h.inst.overlap('no pain in my', 'overlap');
    const after = h.log.slice(before);
    assert.ok(after.some((l) => l.indexOf('speak:') === 0),
      'THE RE-ASK IS NOT SPOKEN. The patient hears nothing at all when their answer is refused, so ' +
      'they carry on talking — and the remainder of their sentence is then a whole turn by this ' +
      'system\'s definition and a fragment by theirs. ' + JSON.stringify(after));
    assert.ok(after.some((l) => l.indexOf('line:hint') === 0),
      'the re-ask is spoken but never shown, so a patient with the sound down is told nothing');
    /* and the WORDS are plain and ask for the whole answer again — read from the module's own
       constants rather than from the truncated log line */
    for (const name of ['REASK_OVERLAP_LINE', 'REASK_CONT_LINE']) {
      const line = new RegExp('var ' + name + ' = ([\\s\\S]*?);\\n').exec(src);
      assert.ok(line, name + ' is gone, so there is no plain-words re-ask for the patient to hear');
      const words = line[1].replace(/'\s*\+\s*\n\s*'/g, '').replace(/^'|'$/g, '');
      assert.ok(/again|start/i.test(words),
        name + ' does not ask the patient to say it AGAIN or to START again. It has to be plain ' +
        'words that tell them to give the whole answer over, or the next thing they say is a ' +
        'continuation of the sentence we already refused: "' + words + '"');
      assert.ok(!/error|overlap|segment|transcript|audio|buffer/i.test(words),
        name + ' explains our plumbing to a patient: "' + words + '"');
    }
    assert.ok(after.some((l) => l.indexOf('pvListen') === 0 || l.indexOf('state:listening') === 0),
      'nothing re-opened the interview after the asking, so the patient is asked to speak again and ' +
      'nothing is listening: ' + JSON.stringify(after));
  }
  /* ⛔ AND IT MAY NOT CUT THE SENTENCE IT IS APOLOGISING FOR. A refusal usually arrives BECAUSE the
     patient talked over a question, so that question is very often still playing. Speaking over it
     (or abandoning it) is the owner's original complaint, produced by the fix for another one. */
  {
    const h = harness({ pvSaying: 'is the pain in your left leg', novel: 3, audioLive: true });
    h.inst.listen();
    const before = h.log.length;
    h.inst.overlap('no pain in my', 'overlap');
    const after = h.log.slice(before);
    assert.ok(!after.some((l) => l.indexOf('speak:') === 0),
      '🚨 THE RE-ASK TALKED OVER THE QUESTION IT WAS APOLOGISING FOR. Audio was still live: the ' +
      'sentence must FINISH, and its own ending is what stamps the restart boundary (finish() -> ' +
      'pvOpenReAsk). The asking is deferred to the turn\'s continuation. ' + JSON.stringify(after));
    assert.ok(after.some((l) => l.indexOf('line:hint') === 0),
      'the patient was told nothing at all while the question finished — the screen must still say ' +
      'we missed it, even when the voice has to wait');
    assert.strictEqual(typeof h.kiosk.reAskPending, 'string',
      'the deferred asking was not recorded, so the turn continuation has nothing to say and the ' +
      'patient is never asked again');
  }
  /* ⛔ AND A CONTINUATION IS ALWAYS SAID OUT LOUD, even when it reads like our own words. The echo
     exemption exists so we do not apologise to a patient who never spoke; a continuation only
     happens because a real answer was already refused, so there IS somebody waiting. */
  {
    const h = harness({ pvSaying: 'is the pain in your back or in your neck', novel: 0,
      selfEcho: ['in your neck'], audioLive: false });
    h.inst.listen();
    const before = h.log.length;
    h.inst.overlap('in your neck', 'continuation');
    const after = h.log.slice(before);
    assert.ok(after.some((l) => l.indexOf('speak:') === 0),
      'A CONTINUATION WAS REFUSED IN SILENCE because it scored zero novel words. The echo exemption ' +
      'is about not apologising to a patient who never spoke; a continuation exists only because a ' +
      'real answer was already refused, so going quiet leaves that patient answering a question ' +
      'nobody is listening to. ' + JSON.stringify(after));
  }
  /* and a finished/closed kiosk says nothing at all: the rest screen must not be overwritten */
  for (const state of [{ completed: true }, { open: false }]) {
    const h = harness({ pvSaying: 'a question', novel: 3, kiosk: state });
    h.inst.listen();
    const before = h.log.length;
    h.inst.overlap('something the patient said');
    assert.ok(!h.log.slice(before).some((l) => l.indexOf('line:') === 0),
      'the refusal notice was written over a finished or closed kiosk (' + JSON.stringify(state) + ')');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
   B. ONE LIVE REGION: NO TEXT CAN EVER PAINT ON ANYTHING ELSE
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* ── B1. THE STYLESHEET MAKES STACKING IMPOSSIBLE ──────────────────────────────────────────
   Checked as a PROPERTY over the lifted stylesheet, not as a byte window: for every element
   that renders patient-facing text, either nothing can compress it below its own content, or it
   owns its own overflow. The rendered proof
   (tests/avatar-kiosk-text-never-overlaps-proof.js) is what MEASURES the result — 40 states x 4
   viewports, 0 spills, against 13 spills and 24 unowned overflows on the pre-fix bytes. */
{
  const css = lib.liftKioskCss(src);
  /* parse into selector -> declarations */
  const rules = {};
  css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').forEach((chunk) => {
    const at = chunk.indexOf('{');
    if (at < 0) return;
    const sel = chunk.slice(0, at).trim();
    const decls = {};
    chunk.slice(at + 1).split(';').forEach((d) => {
      const c = d.indexOf(':');
      if (c > 0) decls[d.slice(0, c).trim()] = d.slice(c + 1).trim();
    });
    sel.split(',').forEach((s) => { rules[s.trim()] = Object.assign(rules[s.trim()] || {}, decls); });
  });
  const childRule = rules['#mlsAvKiosk>*'] || rules['#mlsAvKiosk > *'] || {};
  const shrinkOff = childRule['flex-shrink'] === '0';
  assert.ok(shrinkOff,
    'NOTHING STOPS THE COLUMN COMPRESSING ITS CHILDREN. Every child keeps the default ' +
    'flex-shrink:1, and #mlsAvKioskSay/#mlsAvKioskInterim carry an explicit min-height, which ' +
    'REPLACES min-height:auto and cancels flex\'s automatic minimum content size — so Chrome ' +
    'compressed those boxes below their own text and the surplus was painted on the next ' +
    'sibling. Measured: Interim -> Progress 20.9px (transparent, interleaved) and Say -> Mic ' +
    '12.9px (opaque white pill, so the last line of the question is simply GONE).');
  for (const id of ['#mlsAvKioskSay', '#mlsAvKioskInterim']) {
    const r = rules[id] || {};
    assert.ok(r['max-height'],
      id + ' has no max-height, so a long answer or a long question can claim the whole column ' +
      'and push everything else off the screen (measured: 1023-1645px of content in a 982px ' +
      'viewport across 10 real states)');
    assert.ok(/auto|scroll|hidden/.test(r['overflow-y'] || r.overflow || ''),
      id + ' does not own its overflow. A capped box with visible overflow is WORSE than an ' +
      'uncapped one: the surplus is painted straight onto the sibling below.');
    /* ⚠️ AND THE CAP MUST BE A WHOLE NUMBER OF LINES. A box that contains its text passes every
       assertion above while still LOOKING broken: my first version capped in vh (11vh = 3.27
       lines of 2.4vh/1.4 text) and the fourth line was sliced horizontally through the glyphs.
       Every measurement said "contained"; the SCREENSHOT said "broken", and the owner reads
       screenshots. Expressing the cap in `em` against the declared line-height makes it exact. */
    const lh = /\/([\d.]+)\s/.exec(r.font || '');
    const cap = /^([\d.]+)em$/.exec(r['max-height'] || '');
    assert.ok(lh && cap,
      id + ' expresses its cap in ' + r['max-height'] + ' rather than em against its line-height ' +
      '(' + (r.font || '(no font shorthand)') + '). A cap that is not a whole number of line ' +
      'boxes slices the last visible line through the middle of the letters.');
    const lines = Number(cap[1]) / Number(lh[1]);
    assert.ok(Math.abs(lines - Math.round(lines)) < 0.02,
      id + ' is capped at ' + lines.toFixed(2) + ' lines. A fractional cap cuts the last visible ' +
      'line in half horizontally — measured on this exact element at 11vh/3.27 lines.');
  }
  const face = rules['#mlsAvKioskFaceWrap'] || {};
  assert.ok(/^0 1 /.test(face.flex || ''),
    'the FACE is no longer the element allowed to yield — with every child rigid and nothing ' +
    'flexible, the column can only overflow the screen');
  assert.ok(face['aspect-ratio'] === '1',
    'the face yields by being SQUEEZED rather than scaled: the old rule pinned the width and let ' +
    'flex compress the height, so the portrait became an ellipse inside a border-radius:999px ' +
    'frame (measured 420x259 on the pre-fix bytes)');
  assert.ok(/hidden|auto/.test((rules['#mlsAvKiosk'] || {}).overflow || (rules['#mlsAvKiosk'] || {})['overflow-y'] || ''),
    'the kiosk root has no overflow rule at all, so anything the budget cannot absorb is painted ' +
    'outside the viewport instead of being contained');
}

/* ── B2. THE LIVE TRANSCRIPT IS BOUNDED — EXECUTED on the shipped arbitrator ───────────────
   It was passed to the line UNTRUNCATED while the ambient path had always capped its tail at
   160 characters. Measured: the box stopped containing its text at 16 words / 80 characters and
   the first cross-element overlap landed at 52 words / 231 characters. An open clinical question
   reliably produces 200-400 characters, so the overflowing state was the NORMAL state. */
const arbFrom = src.indexOf('  var KL_RANK = {');
const arbTo = src.indexOf('  function kioskState(');
assert.ok(arbFrom > 0 && arbTo > arbFrom, 'could not extract the arbitrator');
function buildArb() {
  let node = { textContent: '' };
  let now = 1000;
  const real = Date.now;
  const api = new Function('getNode', `
    var gid = function () { return getNode(); };
    ${src.slice(arbFrom, arbTo)}
    return { line: kioskLine, reset: kioskLineReset, state: kioskLineState };
  `);
  Date.now = () => now;
  let inst;
  try { inst = api(() => node); } finally { Date.now = real; }
  const wrap = (fn) => (...a) => { Date.now = () => now; try { return fn(...a); } finally { Date.now = real; } };
  return { line: wrap(inst.line), reset: wrap(inst.reset), state: wrap(inst.state),
    text: () => node.textContent, advance: (ms) => { now += ms; } };
}
{
  const RAMBLE = 'well it started maybe three weeks ago after i moved some boxes in the garage and at ' +
    'first i thought it was just a pulled muscle but then it started going down my leg and now it wakes ' +
    'me up at night and my wife says i have been limping which i did not even notice myself until she said it';
  const k = buildArb();
  k.line('transcript', RAMBLE);
  assert.ok(k.text().length <= 170,
    'THE LIVE TRANSCRIPT IS STILL UNBOUNDED (' + k.text().length + ' characters on the line). ' +
    'A 20-second answer to "describe the pain" is 200-400 characters and it overflowed the box ' +
    'onto the progress line — measured, the normal state of a check-in.');
  assert.ok(k.text().indexOf('until she said it') >= 0,
    'the cap keeps the HEAD of the transcript. A patient needs to see the machine hearing the ' +
    'words they are saying NOW, not the ones they said twenty seconds ago.');
  /* a message that is NOT a transcript is never truncated: a staff instruction must be whole */
  const long = 'Staff: nothing is being recorded. Allow the microphone for this site, then start the ' +
    'check-in again and confirm consent with the patient out loud before you hand the screen over.';
  const k2 = buildArb();
  k2.line('alert', long);
  assert.strictEqual(k2.text(), long,
    'a staff ALERT was truncated — the cap belongs to the transient transcript only, and half an ' +
    'instruction is worse than none');
}

/* ── B3. AND THE CAP IS NOWHERE NEAR THE FILING PATH ───────────────────────────────────────── */
{
  const turnAt = src.indexOf('function kioskTurn(answer, nonce, finish)');
  const turnBody = src.slice(turnAt, src.indexOf('\n  /* THE SELF-END WATCHDOG', turnAt));
  assert.ok(/body\.answer = answer;/.test(turnBody),
    'the answer no longer rides to the server verbatim');
  assert.ok(!/answer\.slice\(|answer\.substring\(|KL_TRANSCRIPT_MAX/.test(turnBody),
    'A LENGTH RULE REACHED THE FILING PATH. The display cap is display-only, on purpose: this ' +
    'lane has already deleted 9 of 12 and then 22 of 22 real answers by putting a rule meant ' +
    'for the screen onto the path that writes the chart.');
}

/* ── B4. THE HOLD BELONGS TO THE FIRST MESSAGE OF A RUN, NOT THE LATEST ─────────────────── */
{
  const k = buildArb();
  k.line('alert', 'first');
  k.advance(19000);
  k.line('alert', 'second');
  assert.ok(k.state().holdMs <= 1000,
    'an equal-rank write RE-ARMED the full hold (' + k.state().holdMs + 'ms left) — a repeating ' +
    'same-rank writer could then own the patient-facing line indefinitely, and the patient\'s ' +
    'own words would never come back');
  assert.strictEqual(k.text(), 'second', 'the newer message of equal rank must still be shown');
  /* and once the hold lapses, the next message starts a fresh one */
  const k2 = buildArb();
  k2.line('status', 'a');
  k2.advance(9500);
  k2.line('status', 'b');
  assert.ok(k2.state().holdMs > 8000, 'a message written after the hold lapsed got no hold of its own');
}

/* ── B5. THE ARBITRATOR'S HOLD DIES WITH THE SCREEN ────────────────────────────────────────
   klKind/klUntil are module state and the only reset used to be inside kioskTurn, which returns
   early for ambient captures FIVE LINES ABOVE it. Measured: patient A's staff alert still owned
   the line into patient B's session and refused B's first writes for a further 17 000ms. */
{
  const closeAt = src.indexOf('function kioskClose(reason)');
  const closeBody = src.slice(closeAt, src.indexOf('function kioskSetSay(', closeAt));
  assert.ok(/kioskLineReset\(\)/.test(closeBody),
    'kioskClose does not reset the patient line — the previous patient\'s alert carries into the ' +
    'next patient\'s session and refuses their first writes');
  const mountAt = src.indexOf("root.querySelector('#mlsAvKioskSkip')");
  assert.ok(mountAt > 0, 'the interrupt button is not wired during the mount');
  assert.ok(/kioskLineReset\(\)/.test(src.slice(mountAt, mountAt + 800)),
    'opening a kiosk does not reset the patient line — a hold from the previous session survives ' +
    'the overlay being destroyed and rebuilt, because the state is module-level');
}

/* ── B6. THE GUARD ON DIRECT WRITERS IS TARGET-SHAPED, NOT NAME-SHAPED ────────────────────
   The previous guard flagged a line only if it matched BOTH `.textContent =` AND a variable
   spelled `iv*`. Measured against six realistic bypasses, FIVE were invisible to it — so the
   claim "all call sites are routed" was being asserted by an instrument that would not notice
   the next one. This version follows the NODE: it collects every binding of
   gid('mlsAvKioskInterim') and flags a write through any of them, or any inline write. */
const NODE = "gid('mlsAvKioskInterim')";
function directWriters(text) {
  const lines = text.split('\n');
  const bound = new Set();
  const offenders = [];
  const WRITE = /\.(textContent|innerHTML|innerText|append|appendChild|replaceChildren|insertAdjacentHTML|insertAdjacentText)\s*(=|\()/;
  let fnName = '';
  lines.forEach((ln, i) => {
    const fn = /^\s*function ([A-Za-z0-9_$]+)/.exec(ln);
    if (fn) { fnName = fn[1]; bound.clear(); }
    /* ⛔ RECORD THE BINDING AND *THEN* KEEP SCANNING THE SAME LINE. The first version of this
       scanner `return`ed on a binding line, so the single most obvious bypass —
       `var line = gid('mlsAvKioskInterim'); if (line) line.textContent = t;` on ONE line — was
       invisible to it. My own control caught that: the suite PASSED with a direct writer added.
       That is the third instrument in this lane to be wrong before the code was. */
    const bind = new RegExp('var\\s+([A-Za-z0-9_$]+)\\s*=\\s*' + NODE.replace(/[()']/g, (c) => '\\' + c)).exec(ln);
    if (bind) bound.add(bind[1]);
    const permitted = (fnName === 'kioskLine' || fnName === 'kioskLineReset');
    if (permitted) return;
    if (ln.indexOf(NODE) >= 0 && WRITE.test(ln)) {
      offenders.push((i + 1) + ' [' + fnName + '] ' + ln.trim().slice(0, 100)); return;
    }
    for (const name of bound) {
      if (new RegExp('\\b' + name + '\\s*\\.(textContent|innerHTML|innerText)\\s*=').test(ln) ||
          new RegExp('\\b' + name + '\\s*\\.(append|appendChild|replaceChildren|insertAdjacentHTML|insertAdjacentText)\\s*\\(').test(ln)) {
        offenders.push((i + 1) + ' [' + fnName + '] ' + ln.trim().slice(0, 100));
        return;
      }
    }
  });
  return offenders;
}
{
  /* THE GUARD IS PROVEN CAPABLE OF SEEING each bypass before it is trusted on the real file —
     the previous one could not see five of these, which is why it was worth nothing. */
  const BYPASSES = [
    "  function evil() {\n    var line = gid('mlsAvKioskInterim');\n    line.textContent = 'x';\n  }",
    "  function evil() {\n    var el = gid('mlsAvKioskInterim');\n    el.innerHTML = '<b>x</b>';\n  }",
    "  function evil() {\n    gid('mlsAvKioskInterim').textContent = 'x';\n  }",
    "  function evil() {\n    var n = gid('mlsAvKioskInterim');\n    n.insertAdjacentHTML('beforeend', 'x');\n  }",
    "  function evil() {\n    var iv = gid('mlsAvKioskInterim');\n    iv.textContent = 'x';\n  }",
    "  function evil() {\n    var iv2 = gid('mlsAvKioskInterim');\n    iv2.innerText = 'x';\n  }",
    /* ⚠️ THE ONE THAT DEFEATED THE FIRST VERSION OF THIS SCANNER — binding and write on one
       line. It was found by the control (the suite passed with this writer added), not by
       reading the scanner. */
    "  function evil(t) { var line = gid('mlsAvKioskInterim'); if (line) line.textContent = t; }",
  ];
  BYPASSES.forEach((code, i) => {
    assert.strictEqual(directWriters(code).length, 1,
      'THE GUARD CANNOT SEE BYPASS ' + (i + 1) + ' — an instrument that misses the next direct ' +
      'writer makes "all call sites are routed" an unfounded claim:\n' + code);
  });
  /* and the permitted owners are NOT flagged */
  assert.deepEqual(directWriters(src.slice(arbFrom, arbTo)), [],
    'the arbitrator itself is being flagged — it is the one permitted writer');
  /* now the real file */
  const offenders = directWriters(src);
  assert.deepEqual(offenders, [],
    'DIRECT WRITER(S) TO THE PATIENT LINE SURVIVE — half-routing is worse than not routing at ' +
    'all, because the arbitrator then believes it owns a line something else overwrites behind ' +
    'its back:\n  ' + offenders.join('\n  '));
  /* and no reader either: a hand-rolled `if (!node.textContent)` guard is the tell that
     ownership is missing, and this file had one */
  assert.ok(!/if \([A-Za-z0-9_$]* && !\1\.textContent\)/.test(src),
    'a hand-rolled read of the owned line is back — ask kioskLineState(), not the node');
}

console.log('PASS avatar half-duplex + one live region:\n' +
  '  A0 "is it still talking" is asked of the PLATFORM: the audio element and the synthesiser ' +
  'both count, an estimate cannot lift the fence, the in-flight window counts, and a signal stuck ' +
  'true is bounded by a trust ceiling instead of deafening the kiosk for the visit.\n' +
  '  A1 the avatar always finishes: opening the microphone no longer cancels the sentence ' +
  '(pvListen executed with a fake recogniser: pvStopVoice never reached, pvSaying and ' +
  'pvSpeakSeq untouched). A1b — the critical one — an utterance is ACCEPTED WHOLE OR REFUSED ' +
  'WHOLE and never spliced: a straddling "no pain in my left leg" is refused and reported rather ' +
  'than filed with its negation missing, a clean one is filed verbatim, an echo costs nothing, ' +
  'and a segment is tagged once on first sighting.\n' +
  '  A2-A5 a live recogniser is never torn down and rebuilt (all three real mid-sentence callers ' +
  'executed); 7 microphone inputs that used to cut a question off — perfect echo, merged-word and ' +
  'homophone mis-transcriptions, a cough, and the avatar\'s own residual tripping the voice gate — ' +
  'now cut nothing and every one is counted; 24 real-answer filings still reach the server; the ' +
  'one interrupt is a wired, class-revealed, pre-consent-hidden BUTTON that works while the ' +
  'loudspeaker is audible.\n' +
  '  A6-A11 (av-6.3.2) the silence watchdog NEVER cuts a live sentence — the cap that used to fall ' +
  'through onto one after three waits is gone and the assertion that pinned that as correct is ' +
  'corrected in place, with the requirement it was reaching for now met where it belongs (a stuck ' +
  'signal is answered by the trust ceiling, executed: the fence closes and the watchdog nudges); a ' +
  'refusal RE-ASKS the patient out loud and on screen, in plain words, without cutting the sentence ' +
  'it is apologising for; and ' +
  'an interrupted sentence ENDS rather than orphaning its continuation (the closing-line ' +
  'hang), exactly once, and after the sound is stopped; the watchdog cannot nudge over a live ' +
  'sentence; the closing line cannot be cut at 12s; one sentence plays exactly once through three ' +
  'racing callbacks; and a refused utterance is said out loud to the patient — unless it was our ' +
  'own echo, which needs no apology.\n' +
  '  B one live region: the stylesheet cannot compress a text box below its own text, both ' +
  'text boxes own their overflow, the face is the one element that yields and stays circular, ' +
  'the live transcript is capped to its TAIL (staff alerts are not, and nothing is capped on ' +
  'the filing path), an equal-rank write cannot re-arm the hold, the hold dies with the screen, ' +
  'and the direct-writer guard is proven to see all 6 bypasses before it is believed.');

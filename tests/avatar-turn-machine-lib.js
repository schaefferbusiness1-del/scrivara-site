'use strict';
/*
 * THE TURN-MACHINE HARNESS: EXECUTE THE SHIPPED BYTES, DO NOT REIMPLEMENT THEM
 * =============================================================================================
 * Every scenario in avatar-answer-is-an-object.test.js runs against a slice of the REAL module,
 * lifted verbatim and executed. A reimplementation would test my copy, not the product — and this
 * lane has already paid for that twice (a "fix" that measured identical to the round before it,
 * because nothing executed the shipped decision).
 *
 * The SAME harness drives three different builds, which is what makes the controls real:
 *     MLS_AVATAR_SRC=<path>   any checkout of feat_mls_avatar.js
 *   · the new bytes                       — must pass every control
 *   · origin/main's bytes (round 5, LIVE) — must FAIL the named byte-exact and continuation
 *                                           controls, because that defect is in production today
 *   · wip/avatar-speech-round6 (round 7)  — must FAIL the named joining control
 *
 * WHAT POPULATION DOES THE LIFT ENUMERATE, AND WHO CHOSE IT?
 * The slice is DERIVED, not typed: it runs from the first of two start markers that is present to
 * the FACE-section banner that follows pvListen. Its contents are therefore whatever the module
 * puts between them — the audio-truth predicate, the three stops, the echo classifier, the voice
 * gate, the speak engine, AvFloor/AvAnswer where they exist, and pvListen. Nothing in the range is
 * chosen by me except the two endpoints, and both endpoints are asserted present.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function readSource(p) {
  return fs.readFileSync(p || process.env.MLS_AVATAR_SRC || path.join(root, 'feat_mls_avatar.js'), 'utf8');
}

/* the lifted range, derived from the file rather than typed as line numbers */
function liftRange(src) {
  /* the audio-truth block heads the range on the new bytes; on any earlier build the range starts
     at the first stop function, which is what those builds have instead */
  const starts = [
    '  var pvAudioStartAt = 0;',
    '  function pvStopSpeechOnly() {',
  ];
  let from = -1;
  for (const m of starts) { const i = src.indexOf(m); if (i >= 0) { from = i; break; } }
  if (from < 0) throw new Error('the harness cannot find the start of the speech/turn range');
  const face = src.indexOf('av-5.0.0 — THE LIVING FACE');
  if (face < 0) throw new Error('the harness cannot find the FACE banner that ends the range');
  const to = src.lastIndexOf('/* =', face);
  if (to < from) throw new Error('the lifted range is empty or inverted');
  return { from, to, code: src.slice(from, to) };
}

/* ── THE FAKE RECOGNISER, IN THE TWO SHAPES PLATFORMS ACTUALLY DELIVER ────────────────────────
   MONOTONIC   Chrome with continuous:true — `results` grows and `resultIndex` points at the first
               changed entry.
   CUMULATIVE  `resultIndex: 0` with the whole list re-delivered every time. A non-continuous
               session, a polyfill, and round 7's own fake recogniser all do this — its comment
               named the shape — and it is what welded answer N-1 onto answer N.
   Both are exercised; a build that only survives one of them is not fixed. */
const SHAPES = ['monotonic', 'cumulative'];

function makeHarness(src) {
  const { code } = liftRange(src);
  const sandbox = {};
  vm.createContext(sandbox);

  const prologue = `
    var __log = { filed: [], refused: [], interim: [], lost: [], dead: 0 };
    var __timers = [], __tid = 0, __now = 1700000000000;
    function setTimeout(fn, ms) { __timers.push({ id: ++__tid, fn: fn, at: ms }); return __tid; }
    function clearTimeout(id) {
      for (var i = 0; i < __timers.length; i++) if (__timers[i].id === id) { __timers.splice(i, 1); return; }
    }
    function setInterval() { throw new Error('this module forbids polling timers'); }
    function clearInterval() {}
    function requestAnimationFrame() { return 0; }
    function cancelAnimationFrame() {}
    function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
    function isFn(f) { return typeof f === 'function'; }
    function gid() { return null; }
    function faceTalkStop() {}
    function faceTalkCycle() {}
    function kioskReAskSpeak() {}
    function kioskListen() {}
    function ttsSplitForSpeech(t) { return [t]; }
    function ttsFetchUrl() { return { then: function () {} }; }
    function ttsPlayUrl() {}
    var pvRec = null, pvHeld = [], pvSpeakSeq = 0, pvWatchdog = null, pvVoice;
    var ttsAudioNow = null, ttsCtx = null, ttsRaf = 0, ttsDownUntil = 0, ttsCache = {}, ttsOrder = [];
    var kiosk = { open: true, consentAt: 1, busy: false, completed: false, ambient: false,
                  paused: false, lastSay: '', lastTry: null, mic: true };
    var window = {
      speechSynthesis: { speaking: false, cancel: function () {}, getVoices: function () { return []; },
                         speak: function () {}, addEventListener: function () {} },
      SpeechRecognition: null
    };
  `;

  const epilogue = `
    /* ── THE FAKE RECOGNISER ─────────────────────────────────────────────────────────────── */
    var __recs = [];
    function FakeRec() { this.lang = ''; this.interimResults = false; this.continuous = false;
      this.started = false; this.__results = []; __recs.push(this); }
    FakeRec.prototype.start = function () { this.started = true; };
    FakeRec.prototype.stop = function () { this.started = false; };
    window.SpeechRecognition = FakeRec;

    /* deliver one recognition result in the requested platform shape. The "pieces" argument is
       the FULL cumulative list of this session's results so far; "changedFrom" is where it
       changed. */
    FakeRec.prototype.deliver = function (shape, pieces, changedFrom) {
      var results = [];
      for (var i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        /* the same OBJECT for an unchanged entry: a re-delivery is identity, not a text match.
           A platform that hands back fresh objects for the same words is exercised too, by the
           cumulative-fresh shape below. */
        if (this.__results[i] && this.__results[i].__text === p.text && this.__results[i].isFinal === p.isFinal) {
          results.push(this.__results[i]);
        } else {
          var r = { 0: { transcript: p.text }, length: 1, isFinal: !!p.isFinal, __text: p.text };
          results.push(r);
        }
      }
      this.__results = results;
      var idx = (shape === 'cumulative') ? 0 : changedFrom;
      if (this.onresult) this.onresult({ resultIndex: idx, results: results });
    };
    /* the harsher variant: a cumulative list rebuilt from NEW objects every time, so identity
       cannot help and only the (index -> text) fallback ledger can. */
    FakeRec.prototype.deliverFresh = function (pieces) {
      var results = [];
      for (var i = 0; i < pieces.length; i++) {
        results.push({ 0: { transcript: pieces[i].text }, length: 1, isFinal: !!pieces[i].isFinal,
                       __text: pieces[i].text });
      }
      this.__results = results;
      if (this.onresult) this.onresult({ resultIndex: 0, results: results });
    };

    /* ⛔ NAMESPACED UNDER ONE OBJECT, AND A PROBE IS WHY. In a vm context the top-level
       "this" IS the global object, so "this.kiosk = ..." OVERWROTE the module's own "kiosk"
       variable — and AvFloor.open() then read a function where an object should be, answered
       "not interviewing", and every answer was refused. The harness reported a green-looking
       refusal for a reason that had nothing to do with the product. One namespace, no shadowing. */
    var API = {};
    this.API = API;
    API.hasFloor = (typeof AvFloor !== 'undefined');
    API.hasAudioLive = (typeof pvAudioLive === 'function');
    API.recs = function () { return __recs; };
    API.liveRec = function () { return pvRec; };
    API.log = function () { return __log; };
    API.resetLog = function () { __log.filed = []; __log.refused = []; __log.interim = []; __log.lost = []; __log.dead = 0; };
    API.pendingTimers = function () { return __timers.length; };
    /* fire every pending timer once, in order — this is how the 1.3s quiet window is closed
       deterministically. A poll would re-arm for ever; an event-driven timer drains. */
    API.flushTimers = function (rounds) {
      var n = rounds || 1;
      for (var k = 0; k < n; k++) {
        var due = __timers.slice(); __timers = [];
        for (var i = 0; i < due.length; i++) safe(due[i].fn);
      }
    };
    API.setSaying = function (v) { pvSaying = v ? pvNorm(v) : ''; };
    API.saying = function () { return pvSaying; };
    API.dropTail = function () { if (typeof pvEchoDrop === 'function') pvEchoDrop(); };
    API.holdTail = function (v) { if (typeof pvEchoHold === 'function') pvEchoHold(pvNorm(v)); };
    API.kiosk = function () { return kiosk; };
    API.setKiosk = function (patch) { for (var k in patch) if (patch.hasOwnProperty(k)) kiosk[k] = patch[k]; };
    /* AUDIO STATE, set the way the module sets it: pvAudioStartAt is stamped by pvSpeakVoiced. */
    API.audioOn = function () {
      if (typeof pvAudioStartAt !== 'undefined') pvAudioStartAt = Date.now();
      ttsAudioNow = { paused: false, ended: false, pause: function () { this.paused = true; } };
    };
    API.audioOff = function () {
      if (typeof pvAudioStartAt !== 'undefined') pvAudioStartAt = 0;
      ttsAudioNow = null;
      window.speechSynthesis.speaking = false;
    };
    /* a STUCK element: paused:false, ended:false, with no sentence in flight. This is the state
       that made the pre-graft predicate answer true for ever. */
    API.audioStuck = function () {
      if (typeof pvAudioStartAt !== 'undefined') pvAudioStartAt = 0;
      ttsAudioNow = { paused: false, ended: false, pause: function () {} };
    };
    API.audioLive = function () { return (typeof pvAudioLive === 'function') ? pvAudioLive() : !!pvSaying; };
    API.remainingMs = function () { return (typeof pvAudioRemainingMs === 'function') ? pvAudioRemainingMs() : 0; };
    /* A QUESTION IS ASKED. On the new bytes this is the one statement pvSpeakVoiced runs; on any
       earlier build there is no boundary to mint and this is a no-op, which is exactly the
       difference the controls measure. */
    API.ask = function (text) {
      API.setSaying(text || 'is there any pain in your left leg');
      API.audioOn();
      if (typeof AvFloor !== 'undefined') AvFloor.open();
    };
    API.askDone = function () {
      API.audioOff();
      API.setSaying('');
    };
    API.shutFloor = function (why) { if (typeof AvFloor !== 'undefined') AvFloor.shut(why || 'test'); };
    API.floorTok = function () { return (typeof AvFloor !== 'undefined') ? AvFloor.tokenNow() : -1; };
    API.answerText = function () {
      return (typeof AvAnswer !== 'undefined' && AvAnswer.current) ? AvAnswer.current.text : null;
    };
    /* open a microphone through the SHIPPED pvListen, with the shipped callback contract. The 4th
       callback does not exist on earlier builds; passing it is harmless there and is how the same
       probe drives every build.
       ⚠️ THE onFinal CALLBACK MODELS kioskTurn, AND ONLY ITS TWO RELEVANT ACTS. It is a stand-in
       for the caller, not for the machine, and the suite pins BOTH acts statically inside the real
       kioskTurn so this model cannot drift away from the product:
         · a turn that arrives while the kiosk is BUSY is DROPPED by kioskTurn, whose first line
           tests kiosk.open and kiosk.busy and returns. On main that drop is SILENT - the answer is
           gone and the patient is never told, which is the "no answer is silently lost"
           requirement being violated in production today. Recorded as lost, not filed.
         · filing sets kiosk.busy and shuts the floor, which is what makes the NEXT thing the
           recogniser hears a continuation with no known boundary. */
    API.listen = function () {
      return pvListen(
        function (text) {
          if (!kiosk.open || kiosk.busy || kiosk.completed) { __log.lost.push(text); return; }
          __log.filed.push(text);
          kiosk.busy = true;
          if (typeof AvFloor !== 'undefined') AvFloor.shut('busy');
        },
        function (text) { __log.interim.push(text); },
        function () { __log.dead++; },
        function (text, why, overlap, wasEcho) {
          __log.refused.push({ text: text, why: why, overlap: !!overlap, echo: !!wasEcho });
        }
      );
    };
    /* the backend answered: kioskTurn clears busy, then speaks the next question (which is the
       next API.ask()). Until then nothing is fileable, by design. */
    API.turnDone = function () { kiosk.busy = false; };
    API.stopMic = function () { if (typeof pvStopMicOnly === 'function') pvStopMicOnly(); else pvStopVoice(); };
    API.stopSpeech = function () { pvStopSpeechOnly(); };
    API.speakSeq = function () { return pvSpeakSeq; };
  `;

  vm.runInContext(prologue + '\n' + code + '\n' + epilogue, sandbox, { filename: 'lifted-avatar-turn-machine.js' });
  return sandbox.API;
}

module.exports = { readSource, liftRange, makeHarness, SHAPES, root };

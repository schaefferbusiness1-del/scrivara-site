/* 1p-avatar-listener-reliability-runtime.test.js  (1p PREVIEW ONLY)
 *
 * Controlled-clock execution of the real listener slices. No microphone,
 * backend, chart, extension, or patient data is used. The resolving controls
 * matter: each failure case is paired with a healthy path that must still move.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, '1p-feat_mls_avatar.js'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function deep(actual, expected, message) { assert.deepStrictEqual(actual, expected, message); checks++; }
function between(from, to) {
  const a = SRC.indexOf(from);
  const b = SRC.indexOf(to, a + from.length);
  assert(a >= 0 && b > a, 'could not isolate real 1p slice: ' + from + ' -> ' + to);
  return SRC.slice(a, b);
}

function makeClock() {
  let now = 100000, next = 1;
  const timers = new Map();
  function setTimer(fn, delay) {
    const id = next++;
    timers.set(id, { fn, at: now + Math.max(0, Number(delay) || 0) });
    return id;
  }
  function clearTimer(id) { timers.delete(id); }
  function runNext() {
    if (!timers.size) return false;
    const row = Array.from(timers.entries()).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    timers.delete(row[0]); now = row[1].at; row[1].fn(); return true;
  }
  function advance(ms, cap) {
    const until = now + ms;
    let n = 0;
    while (timers.size && n++ < (cap || 100)) {
      const row = Array.from(timers.entries()).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (row[1].at > until) break;
      timers.delete(row[0]); now = row[1].at; row[1].fn();
    }
    now = until;
  }
  return { now: () => now, setTimer, clearTimer, runNext, advance, pending: () => timers.size };
}

/* -------------------------------------------------------------------------
 * 0. MICROPHONE OWNER: the independent AEC stream/RAF/context really closes.
 */
{
  const gateSlice = between('  var vgStream = null, vgCtx = null, vgNode = null, vgData = null, vgRaf = 0,',
    '  /* true only with sustained energy ABOVE');
  const state = { trackStops: 0, contextCloses: 0, rafs: 0, cancels: 0 };
  const track = { getSettings() { return { echoCancellation: true, noiseSuppression: true }; },
    stop() { state.trackStops++; } };
  const stream = { getAudioTracks() { return [track]; }, getTracks() { return [track]; } };
  function AudioContext() {
    this.createMediaStreamSource = () => ({ connect() {} });
    this.createAnalyser = () => ({ fftSize: 0, smoothingTimeConstant: 0, getByteTimeDomainData() {} });
    this.close = () => { state.contextCloses++; };
  }
  const api = new Function('stream', 'state', 'AudioContext', `
    var window = { AudioContext: AudioContext };
    var navigator = { mediaDevices: null };
    var pvSaying = '';
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function requestAnimationFrame() { state.rafs++; return 41; }
    function cancelAnimationFrame(id) { if (id === 41) state.cancels++; }
    ${gateSlice}
    return { adopt: function () { return pvVoiceGateAdopt(stream); }, stop: pvVoiceGateStop,
      report: function () { return { ready: vgReady, stream: !!vgStream, context: !!vgCtx, raf: vgRaf }; } };
  `)(stream, state, AudioContext);
  eq(api.adopt(), true, 'resolving control: AEC stream could not be adopted');
  eq(api.report().ready, true, 'adopted AEC gate did not report live');
  api.stop();
  eq(state.trackStops, 1, 'voice-gate stop did not stop every media track');
  eq(state.contextCloses, 1, 'voice-gate stop did not close its AudioContext');
  eq(state.cancels, 1, 'voice-gate stop did not cancel its animation-frame owner');
  eq(api.report().ready, false, 'voice-gate stop still reported a live microphone');
}

function makeDeferredGateHarness() {
  const gateSlice = between('  var vgStream = null, vgCtx = null, vgNode = null, vgData = null, vgRaf = 0,',
    '  /* true only with sustained energy ABOVE');
  const state = { getCalls: 0, callbacks: 0, trackStops: 0, contextCloses: 0,
    controls: [], rafs: 0, cancels: 0 };
  const track = { getSettings() { return { echoCancellation: true }; }, stop() { state.trackStops++; } };
  const stream = { getAudioTracks() { return [track]; }, getTracks() { return [track]; } };
  function AudioContext() {
    this.createMediaStreamSource = () => ({ connect() {} });
    this.createAnalyser = () => ({ fftSize: 0, smoothingTimeConstant: 0, getByteTimeDomainData() {} });
    this.close = () => { state.contextCloses++; };
  }
  const api = new Function('state', 'AudioContext', `
    var window = { AudioContext: AudioContext };
    var navigator = { mediaDevices: { getUserMedia: function () {
      state.getCalls++;
      return { then: function (ok, fail) { state.controls.push({ ok: ok, fail: fail }); } };
    } } };
    var pvSaying = '';
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function requestAnimationFrame() { state.rafs++; return 51; }
    function cancelAnimationFrame(id) { if (id === 51) state.cancels++; }
    ${gateSlice}
    return { start: function () { pvVoiceGateStart(function (adopted) {
        state.callbacks++; (state.results || (state.results = [])).push(adopted === true);
      }); },
      stop: pvVoiceGateStop,
      resolve: function (n, stream) { state.controls[n].ok(stream); },
      report: function () { return { ready: vgReady, stream: !!vgStream, context: !!vgCtx, pending: vgStartPending }; } };
  `)(state, AudioContext);
  return { state, stream, api };
}

{
  const h = makeDeferredGateHarness();
  h.api.start(); h.api.start();
  eq(h.state.getCalls, 1, 'two gate starts opened two pending microphone requests');
  h.api.resolve(0, h.stream);
  eq(h.state.callbacks, 2, 'single-flight gate start did not settle every caller');
  eq(h.api.report().ready, true, 'single-flight gate start failed to adopt one stream');
  eq(h.state.trackStops, 0, 'healthy single-flight gate stopped its only stream early');
  h.api.stop();
  eq(h.state.trackStops, 1, 'single-flight gate stop did not release its one stream');
}

{
  const h = makeDeferredGateHarness();
  h.api.start();
  h.api.stop();
  eq(h.state.callbacks, 1, 'Pause/close did not settle a pending gate caller');
  deep(h.state.results, [false], 'Pause/close reported a canceled gate as successfully adopted');
  h.api.resolve(0, h.stream);
  eq(h.state.trackStops, 1, 'late microphone grant was not stopped after Pause/close');
  deep(h.api.report(), { ready: false, stream: false, context: false, pending: null },
    'late microphone grant resurrected a gate behind non-listening UI');
}


{
  const h = makeDeferredGateHarness();
  h.api.start();                 // A pending
  h.api.stop();                  // invalidate A
  h.api.start();                 // B pending
  eq(h.state.getCalls, 2, 'fresh post-Pause start did not create its own request');
  h.api.resolve(0, h.stream);    // stale A resolves
  eq(h.state.trackStops, 1, 'stale A stream was not stopped while B remained pending');
  eq(h.state.callbacks, 1, 'stale A completion drained B callback early');
  deep(h.state.results, [false], 'stopped A gate reported a false successful adoption');
  ok(h.api.report().pending, 'stale A completion cleared current B pending state');
  h.api.resolve(1, h.stream);    // current B resolves
  eq(h.state.callbacks, 2, 'current B completion did not settle its caller');
  deep(h.state.results, [false, true], 'current B gate did not report exact adopted/canceled truth');
  eq(h.api.report().ready, true, 'current B stream was not adopted after stale A resolved');
  h.api.stop();
  eq(h.state.trackStops, 2, 'current B stream was not released by final Stop');
}

/* -------------------------------------------------------------------------
 * 1. ECHO CLASSIFICATION: options and question-word answers survive.
 */
{
  const clock = makeClock();
  let gateReady = false, otherVoice = false;
  const echoSlice = between('  var PV_ECHO_TAIL_MS = 1600;', '  function pvSpeakVoiced(');
  const api = new Function('clock', 'gateReady', 'otherVoice', `
    var Date = { now: clock };
    var pvEchoSaying = '', pvSaying = '';
    var pvVoiceGateReady = gateReady, pvOtherVoiceNow = otherVoice;
    ${echoSlice}
    return {
      echo: pvIsSelfEcho,
      speaking: function (v) { pvEchoSaying = pvNorm(v); },
      stop: function () { pvEchoSaying = ''; },
      tail: function (v) { pvEchoTail.push({ norm: pvNorm(v), until: Date.now() + PV_ECHO_TAIL_MS }); }
    };
  `)(clock.now, () => gateReady, () => otherVoice);

  const q = 'Is the pain worse at night, or in the morning?';
  api.speaking(q);
  for (const answer of ['worse at night', 'in the morning', 'both knees', 'more of a dull ache',
    'shortness of breath', 'numbness on one side of my face']) {
    eq(api.echo(answer), false, 'ordinary answer was deleted while speaking: ' + answer);
  }
  eq(api.echo(q), true, 'resolving control: the exact full speaker sentence was not rejected');
  gateReady = true; otherVoice = true;
  for (const answer of ['worse at night', 'in the morning', 'both knees', 'more of a dull ache']) {
    eq(api.echo(answer), false, 'confirmed patient voice was deleted because it reused question words: ' + answer);
  }
  eq(api.echo(q), false, 'confirmed other-voice audio must preserve even an exact repeated question');
  otherVoice = false;
  eq(api.echo('is the pain worse at night'), false,
    'AEC false-negative deleted a patient answer built from question words');
  eq(api.echo('worse at night'), false,
    'AEC false-negative deleted the common three-word A-or-B answer');
  eq(api.echo(q), true,
    'resolving control: exact full-line echo remains rejected without other-voice evidence');

  gateReady = false; otherVoice = false; api.stop(); api.tail(q);
  eq(api.echo('worse at night'), false, 'tail window deleted an A-or-B answer');
  eq(api.echo(q), true, 'resolving control: exact late self-tail was not rejected');
  clock.advance(1601);
  eq(api.echo(q), false, 'bounded echo tail did not expire');
}

/* -------------------------------------------------------------------------
 * 2. RECOGNISER CORE: code propagation, no duplicate, no deaf submit.
 */
function makeListenHarness(echoFn) {
  const clock = makeClock();
  const recs = [];
  function Recognition() {
    this.live = false; this.onresult = null; this.onerror = null; this.onend = null;
    this.start = () => { this.live = true; recs.push(this); };
    this.stop = () => { this.live = false; };
  }
  const win = { SpeechRecognition: Recognition };
  const listenSlice = between('  function pvListen(onFinal, onInterim, onDead) {', '\n\n  /* =========================================================================\n     av-5.0.0');
  const api = new Function('window', 'setTimer', 'clearTimer', 'isEcho', `
    var setTimeout = setTimer, clearTimeout = clearTimer;
    var pvRec = null;
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function pvIsSelfEcho(v) { return isEcho(v); }
    function pvStopMic() {
      if (!pvRec) return;
      try { if (typeof pvRec.__killQuiet === 'function') pvRec.__killQuiet(); } catch (e) {}
      try { pvRec.onresult = pvRec.onend = pvRec.onerror = null; pvRec.stop(); } catch (e) {}
      pvRec = null;
    }
    ${listenSlice}
    return { listen: pvListen, current: function () { return pvRec; }, stop: pvStopMic };
  `)(win, clock.setTimer, clock.clearTimer, echoFn || (() => false));
  function result(rec, rows, resultIndex) {
    const results = rows.map((row) => {
      const one = [{ transcript: row.text }]; one.isFinal = !!row.final; return one;
    });
    rec.onresult({ resultIndex: resultIndex || 0, results });
  }
  return { clock, recs, api, result };
}

{
  const h = makeListenHarness();
  const finals = [], dead = [];
  ok(h.api.listen((v) => finals.push(v), () => {}, (code, tail) => dead.push([code, tail])),
    'healthy recogniser did not start');
  const rec = h.recs[0];
  h.result(rec, [{ text: 'first clause', final: true }], 0);
  h.clock.advance(1300);
  deep(finals, ['first clause'], 'first final did not submit once');
  eq(rec.live, true, 'submit closed the recogniser during backend latency');
  eq(h.api.current(), rec, 'submit released the live recogniser');

  /* Chrome may re-deliver an old final slot. Same slot/text is not a new turn. */
  h.result(rec, [{ text: 'first clause', final: true }], 0);
  h.clock.advance(1300);
  deep(finals, ['first clause'], 're-delivered final posted a duplicate answer');

  h.result(rec, [
    { text: 'first clause', final: true },
    { text: 'and the second clause', final: true }
  ], 1);
  h.clock.advance(1300);
  deep(finals, ['first clause', 'and the second clause'],
    'resolving control: continuing speech did not submit through the same recogniser');
  eq(rec.live, true, 'continuation left a deaf microphone');
  eq(dead.length, 0, 'healthy continuous recognition reported death');
}

{
  const h = makeListenHarness();
  const dead = [];
  h.api.listen(() => {}, () => {}, (code, tail) => dead.push([code, tail]));
  const rec = h.recs[0];
  h.result(rec, [{ text: 'editable partial answer', final: false }], 0);
  rec.onerror({ error: 'service-not-allowed' });
  deep(dead, [['service-not-allowed', 'editable partial answer']],
    'terminal error code or interim recovery text was discarded');
  eq(h.api.current(), null, 'dead recogniser remained globally live');
}

{
  const h = makeListenHarness();
  const finals = [], dead = [];
  h.api.listen((v) => finals.push(v), () => {}, (code) => dead.push(code));
  const rec = h.recs[0];
  h.result(rec, [{ text: 'last confirmed words', final: true }], 0);
  rec.onend();
  h.clock.advance(5000);
  deep(finals, ['last confirmed words'], 'natural end failed to flush its final exactly once');
  deep(dead, ['end'], 'natural end was not reported for restart');
}

{
  const h = makeListenHarness((v) => v === 'exact speaker sentence');
  const finals = [];
  h.api.listen((v) => finals.push(v), () => {}, () => {});
  const rec = h.recs[0];
  h.result(rec, [{ text: 'exact speaker sentence', final: true }], 0);
  h.clock.advance(5000);
  deep(finals, [], 'self echo escaped the exact classifier');
  eq(rec.live, true, 'echo refusal killed the microphone');
  eq(h.api.current(), rec, 'echo refusal released the recogniser');
}

/* -------------------------------------------------------------------------
 * 3. KIOSK POLICY: terminal/bounded failures and busy-turn queue.
 */
function makeKioskHarness(deadCodes) {
  const clock = makeClock();
  const nodes = {
    mlsAvKioskTypeRow: { style: { display: 'none' } },
    mlsAvKioskInput: { value: '', focused: false, focus() { this.focused = true; } },
    mlsAvKiosk: { classList: { contains: () => false } }
  };
  const state = { arms: 0, turns: [], lines: [], states: [], listens: 0, voiceGateStops: 0 };
  const queueSlice = between('  function kioskQueueSpeech(text) {', '  function kioskNonce() {');
  const listenSlice = between('  function kioskListen(keepMood) {', '  /* Natural completion must not expose');
  const kiosk = { consentAt: 1, ambient: false, paused: false, open: true, busy: false,
    completed: false, mic: true, lastSay: '', pendingSpeech: '' };
  let codeIndex = 0;
  const api = new Function('kiosk', 'nodes', 'state', 'codes', 'clock', 'setTimer', 'clearTimer', `
    var setTimeout = setTimer, clearTimeout = clearTimer;
    var Date = { now: clock };
    var pvRec = null, pvEchoSaying = '', pvSaying = '';
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function clean(v) { return String(v == null ? '' : v).replace(/\\s+/g, ' ').trim(); }
    function gid(id) { return nodes[id] || null; }
    function kioskState(v) { state.states.push(v); }
    function kioskLine(kind, text) { state.lines.push([kind, text]); return true; }
    function kioskArmWatchdog() { state.arms++; }
    function kioskMood() {}
    function pvVoiceGateStop() { state.voiceGateStops++; }
    function pvIsSelfEcho() { return false; }
    function pvVoiceGateReady() { return false; }
    function pvOtherVoiceNow() { return false; }
    function pvOtherVoiceSustained() { return false; }
    function pvNovelWordCount() { return 2; }
    function pvNorm(v) { return clean(v).toLowerCase(); }
    function pvStopSpeechOnly() {}
    function kioskNonce() { return 'nonce'; }
    function kioskTurn(v, nonce) { state.turns.push([v, nonce]); }
    ${queueSlice}
    var deadCallbacks = [];
    function pvListen(onFinal, onInterim, onDead) {
      state.listens++;
      pvRec = { live: true };
      deadCallbacks.push(onDead);
      if (codes.length) {
        var row = codes.shift();
        setTimeout(function () { pvRec = null; onDead(row.code, row.tail || ''); }, 0);
      }
      state.lastFinal = onFinal; state.lastInterim = onInterim;
      return true;
    }
    ${listenSlice}
    return { listen: kioskListen, take: kioskTakeSpeech, fallback: kioskTypingFallback,
      final: function (v) { return state.lastFinal(v); }, interim: function (v) { return state.lastInterim(v); } };
  `)(kiosk, nodes, state, deadCodes.slice(), clock.now, clock.setTimer, clock.clearTimer);
  return { clock, nodes, state, kiosk, api };
}

{
  const h = makeKioskHarness([{ code: 'service-not-allowed', tail: 'words to review' }]);
  h.api.listen(false); h.clock.runNext();
  eq(h.state.listens, 1, 'terminal service refusal restarted the recogniser');
  eq(h.kiosk.mic, false, 'terminal service refusal did not enter typing mode');
  eq(h.nodes.mlsAvKioskTypeRow.style.display, 'flex', 'typing fallback was not visible');
  eq(h.nodes.mlsAvKioskInput.value, 'words to review', 'recoverable interim was not offered for review');
  eq(h.state.voiceGateStops, 1, 'terminal typing fallback left the adopted AEC microphone stream open');
  ok(/speech service is unavailable/i.test(h.state.lines[h.state.lines.length - 1][1]),
    'terminal outage did not show an honest visible message');
  eq(h.state.arms, 2, 'terminal fallback should replace the initial voice watchdog with one typed watchdog');
}

{
  const h = makeKioskHarness([{ code: 'end', tail: 'editable partial answer' }]);
  h.api.listen(false); h.clock.runNext();
  eq(h.nodes.mlsAvKioskTypeRow.style.display, 'flex',
    'transient recogniser end silently discarded its interim-only words');
  eq(h.nodes.mlsAvKioskInput.value, 'editable partial answer',
    'transient recogniser end did not offer its provisional words for review');
  h.api.final('editable partial answer and confirmed tail');
  deep(h.state.turns, [['editable partial answer and confirmed tail', 'nonce']],
    'resolving final after transient end did not file exactly one confirmed answer');
  eq(h.nodes.mlsAvKioskInput.value, '',
    'corroborated provisional text remained available for a duplicate typed send');
  eq(h.nodes.mlsAvKioskTypeRow.style.display, 'none',
    'corroborated provisional offer did not retire');
}

{
  const h = makeKioskHarness([{ code: 'network', tail: 'network-edge words' }]);
  h.api.listen(false); h.clock.runNext();
  eq(h.nodes.mlsAvKioskInput.value, 'network-edge words',
    'network boundary silently discarded its interim-only words');
  ok(h.clock.pending() > 0, 'network boundary did not retain its bounded restart');
}

{
  const h = makeKioskHarness([
    { code: 'end', tail: 'first partial' },
    { code: 'end', tail: 'second partial' }
  ]);
  h.api.listen(false);
  for (let i = 0; i < 4; i++) h.clock.runNext();
  eq(h.nodes.mlsAvKioskInput.value, 'first partial second partial',
    'a second transient boundary overwrote the first provisional patient words');
  h.api.final('first partial second partial confirmed');
  deep(h.state.turns, [['first partial second partial confirmed', 'nonce']],
    'two recovered fragments produced a duplicate or incomplete confirmed turn');
  eq(h.nodes.mlsAvKioskInput.value, '',
    'confirmed two-fragment recovery remained available for duplicate typed send');
}

{
  const h = makeKioskHarness([
    { code: 'network' }, { code: 'network' }, { code: 'network', tail: 'last partial' }
  ]);
  h.api.listen(false);
  /* error, restart delay, error, restart delay, error -> terminal fallback */
  for (let i = 0; i < 7 && h.clock.pending(); i++) h.clock.runNext();
  eq(h.state.listens, 3, 'bounded network outage did not stop at three attempts');
  eq(h.kiosk.mic, false, 'repeated network failures left a false Listening state');
  eq(h.nodes.mlsAvKioskInput.value, 'last partial', 'network fallback lost interim recovery text');
  ok(/cannot connect/i.test(h.state.lines[h.state.lines.length - 1][1]),
    'network outage did not explain the typing fallback');
  eq(h.state.arms, 2, 'initial + typed watchdogs were not the only watchdog arms');
}

{
  const h = makeKioskHarness([{ code: 'no-speech' }, { code: 'no-speech' }]);
  h.api.listen(false);
  for (let i = 0; i < 5 && h.clock.pending(); i++) h.clock.runNext();
  eq(h.state.listens, 3, 'resolving control: transient no-speech did not restart capture');
  eq(h.kiosk.mic, true, 'ordinary no-speech incorrectly disabled voice input');
  eq(h.state.arms, 1, 'transient restarts reset the silence watchdog and could prevent self-end');
}

{
  const h = makeKioskHarness([]);
  h.kiosk.busy = true;
  h.api.listen(true);
  h.api.final('and it also goes down the leg');
  eq(h.state.turns.length, 0, 'speech during backend work started a competing turn');
  eq(h.kiosk.pendingSpeech, 'and it also goes down the leg', 'speech during backend work was not buffered');
  eq(h.api.take(), 'and it also goes down the leg', 'buffered continuation was not consumed once');
  eq(h.api.take(), '', 'buffered continuation could be consumed twice');
}

/* Execute the real backend-turn failure owner. This is deliberately not a
 * source-shape test: the race depends on the order of the refusal response,
 * apology callback/watchdog, a patient continuation, and the resend. */
function makeTurnFailureHarness() {
  const clock = makeClock();
  const nodes = {
    mlsAvKioskTypeRow: { style: { display: 'none' } },
    mlsAvKioskInput: { value: '', focused: false, focus() { this.focused = true; } }
  };
  const state = { requests: [], controls: [], speech: [], lines: [], says: [],
    listens: 0, listenArgs: [], watchdogArms: 0, stopMic: 0, stopGate: 0,
    fallbackStates: [], nonce: 0 };
  const kiosk = { open: true, consentAt: 1, ambient: false, completed: false,
    busy: false, mic: true, generation: 7, sid: 'sid-A', ext: 'patient-A',
    pendingSpeech: '', lastTry: null, chartCtx: null, spoke: true };
  const queueSlice = between('  function kioskQueueSpeech(text) {', '  function kioskNonce() {');
  const turnSlice = between('  function kioskTurn(answer, nonce, finish, retryAttempt) {',
    '  /* THE SELF-END WATCHDOG');
  const control = new Function('kiosk', 'nodes', 'state', 'clock', 'setTimer', 'clearTimer', `
    var setTimeout = setTimer, clearTimeout = clearTimer;
    var pvRec = { live: true };
    function clean(v) { return String(v == null ? '' : v).replace(/\\s+/g, ' ').trim(); }
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function gid(id) { return nodes[id] || null; }
    function kioskNonce() { state.nonce++; return 'nonce-' + state.nonce; }
    function kioskState(v) { state.fallbackStates.push(v); }
    function kioskLine(kind, text) { state.lines.push([kind, text]); return true; }
    function kioskLineReset() {}
    function kioskMood() {}
    function kioskSetSay(v) { state.says.push(String(v || '')); }
    function kioskSetIdentity() {}
    function kioskIntakeAdd() {}
    /* avintake-1.0.0 (2026-08-17): kioskTurn consults the interview's covered-topic
       ledger, its repeat guard and its correction detector. The REAL block is injected
       rather than stubbed - a stub looser than the real thing hides the call - and it
       is pure over kiosk and clean, both of which this harness already has.
       (No back-ticks in this comment: it lives inside a template literal.) */
    ${between('  /* ===== avintake-1.0.0 (2026-08-17) — THE INTERVIEW GETS A MEMORY.', '  function kioskIntakeText')}
    function kioskChartContext() { return null; }
    function kioskArmWatchdog() { state.watchdogArms++; }
    function kioskFinish() {}
    function kioskListen(keepMood) {
      state.listens++; state.listenArgs.push(keepMood === true);
      if (keepMood !== true) kioskArmWatchdog();
      return true;
    }
    function pvStopMic() { state.stopMic++; pvRec = null; }
    function pvVoiceGateStop() { state.stopGate++; }
    function pvSpeakShaped(text, done, shape) { state.speech.push({ text: text, done: done, shape: shape }); }
    function api(url, options) {
      var row = { url: url, body: JSON.parse(options.body), ok: null, fail: null };
      state.requests.push(row.body);
      state.controls.push(row);
      var chain = { then: function (ok, fail) { row.ok = ok; row.fail = fail; return chain; } };
      return chain;
    }
    ${queueSlice}
    ${turnSlice}
    return {
      start: function (answer, nonce) { return kioskTurn(answer, nonce); },
      queue: kioskQueueSpeech,
      take: kioskTakeSpeech,
      resolve: function (n, value) { state.controls[n].ok(value); },
      reject: function (n) { state.controls[n].fail(new Error('synthetic rejection')); }
    };
  `)(kiosk, nodes, state, clock.now, clock.setTimer, clock.clearTimer);
  return { clock, nodes, state, kiosk, control };
}

{
  const h = makeTurnFailureHarness();
  h.control.start('first clause', 'nonce-original');
  eq(h.state.requests.length, 1, 'original answer did not start exactly one request');
  h.control.resolve(0, { ok: false, json: { ok: false, message: 'Please repeat that.' } });
  eq(h.kiosk.busy, true, 'refusal released the turn while its apology was still speaking');
  h.control.queue('and the second clause');
  eq(h.state.requests.length, 1, 'continuation outran the refused original during the apology');
  eq(h.state.speech.length, 1, 'spoken refusal did not own one bounded apology');
  h.state.speech[0].done();
  eq(h.state.requests.length, 2, 'apology completion did not retry the refused original once');
  eq(h.state.requests[1].answer, 'first clause', 'continuation replaced the refused original');
  eq(h.state.requests[1].answerNonce, 'nonce-original', 'refused original lost its idempotency nonce');
  eq(h.clock.pending(), 1,
    'spoken retry left anything except the retried request deadline alive');
  h.control.resolve(1, { ok: true, json: { ok: true, say: '' } });
  eq(h.state.requests.length, 3, 'queued continuation did not drain after original retry succeeded');
  eq(h.state.requests[2].answer, 'and the second clause', 'wrong words drained after the original retry');
  ok(h.state.requests[2].answerNonce && h.state.requests[2].answerNonce !== 'nonce-original',
    'continuation reused the original answer nonce');
  eq(h.kiosk.pendingSpeech, '', 'successful retry left the continuation reusable');
}

{
  const h = makeTurnFailureHarness();
  h.control.start('watchdog answer', 'nonce-watchdog');
  h.control.resolve(0, { ok: false, json: { ok: false, message: 'Please repeat that.' } });
  h.clock.advance(5999);
  eq(h.state.requests.length, 1, 'refusal retried before its bounded apology window');
  h.clock.advance(1);
  eq(h.state.requests.length, 2, 'canceled apology callback stranded the refused answer');
  eq(h.state.requests[1].answerNonce, 'nonce-watchdog', 'watchdog retry changed the original nonce');
  eq(h.clock.pending(), 1,
    'watchdog retry left anything except the retried request deadline alive');
}

{
  const h = makeTurnFailureHarness();
  h.control.start('keep this exact answer', 'nonce-twice');
  h.control.resolve(0, { ok: false, json: { ok: false, message: 'Please repeat that.' } });
  h.control.queue('and keep this continuation');
  h.state.speech[0].done();
  h.control.resolve(1, { ok: false, json: { ok: false, message: 'Still unavailable.' } });
  eq(h.state.requests.length, 2, 'persistent refusal created an unbounded backend retry loop');
  eq(h.kiosk.busy, false, 'second refusal left the interview permanently busy');
  eq(h.kiosk.mic, false, 'second refusal did not enter honest typed recovery');
  eq(h.nodes.mlsAvKioskInput.value, 'keep this exact answer',
    'typed recovery did not preserve the original refused answer');
  eq(h.kiosk.pendingSpeech, 'and keep this continuation',
    'typed recovery discarded the later patient clause');
  eq(h.clock.pending(), 0, 'persistent refusal left a hot retry timer');
  ok(h.state.stopMic > 0 && h.state.stopGate > 0,
    'typed recovery left a microphone owner running');
}

{
  const h = makeTurnFailureHarness();
  h.control.start('rejected answer', 'nonce-reject');
  h.control.reject(0);
  h.clock.advance(499);
  eq(h.state.requests.length, 1, 'network rejection retried before its bounded delay');
  h.clock.advance(1);
  eq(h.state.requests.length, 2, 'network rejection did not retry the original exactly once');
  h.control.reject(1);
  eq(h.state.requests.length, 2, 'persistent network rejection entered an unbounded loop');
  eq(h.nodes.mlsAvKioskInput.value, 'rejected answer',
    'persistent network rejection did not preserve the original answer for review');
  eq(h.clock.pending(), 0, 'persistent network rejection left a hot retry timer');
}

{
  const h = makeTurnFailureHarness();
  h.control.start('', '');
  h.control.resolve(0, { ok: false, json: { ok: false, message: 'Opening unavailable.' } });
  h.state.speech[0].done();
  deep(h.state.listenArgs, [false],
    'opening-turn refusal restarted through the no-watchdog duplex path');
  eq(h.state.watchdogArms, 1,
    'opening-turn refusal did not restore the silence/self-end watchdog');
}

{
  const h = makeTurnFailureHarness();
  h.control.start('answer during a hung request', 'nonce-hung');
  h.control.queue('and every later clause');
  h.clock.advance(29999);
  eq(h.kiosk.busy, true, 'hung request released before its hard deadline');
  h.clock.advance(1);
  eq(h.kiosk.busy, false, 'hung request wedged the interview forever');
  eq(h.state.requests.length, 1, 'hung request started an unsafe competing request');
  eq(h.nodes.mlsAvKioskInput.value, 'answer during a hung request',
    'hung request did not preserve its original answer for review');
  eq(h.kiosk.pendingSpeech, 'and every later clause',
    'hung request discarded its queued continuation');
  ok(h.state.stopMic > 0 && h.state.stopGate > 0,
    'hung request left microphone owners active after timeout');
  h.control.resolve(0, { ok: true, json: { ok: true, say: 'late stale response' } });
  eq(h.state.requests.length, 1, 'late timed-out response created another turn');
  eq(h.kiosk.pendingSpeech, 'and every later clause',
    'late timed-out response consumed the retained continuation');
  eq(h.clock.pending(), 0, 'hung-request deadline did not settle cleanly');
}

/* -------------------------------------------------------------------------
 * 3b. STAFF PIN: delayed unlocks are owned by one kiosk generation/patient.
 */
{
  const requestSlice = between('  function kioskRequestEnd() {',
    '  /* Staff leaving must CLOSE');
  const submitSlice = between('  function kioskPinSubmit(mode) {',
    '  function kioskMicPreflight(then) {');
  const kiosk = { open: true, generation: 1, sid: 'sid-A', ext: 'patient-A',
    pinSet: null, completed: false, ambient: false };
  const nodes = {
    mlsAvKioskPin: { style: {} },
    mlsAvKioskPinInput: { value: '1234', focused: false, focus() { this.focused = true; } },
    mlsAvKioskPinMsg: { textContent: '' },
    mlsAvKioskPinGo: { disabled: false }, mlsAvKioskPinAmb: { disabled: false }
  };
  const state = { requests: [], end: 0, ambient: 0, gateStops: 0 };
  const api = new Function('kiosk', 'nodes', 'state', `
    function clean(v) { return String(v == null ? '' : v).trim(); }
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function gid(id) { return nodes[id] || null; }
    function pvStopVoice() {}
    function pvVoiceGateStop() { state.gateStops++; }
    function kioskEndForStaff() { state.end++; }
    function kioskAmbientStart() { state.ambient++; return true; }
    function api(url, options) {
      var row = { body: JSON.parse(options.body), ok: null, fail: null };
      state.requests.push(row);
      var p = { then: function (ok, fail) { row.ok = ok; row.fail = fail; return p; } };
      return p;
    }
    ${requestSlice}
    ${submitSlice}
    return { requestEnd: kioskRequestEnd, submit: kioskPinSubmit,
      resolve: function (n, value) { state.requests[n].ok(value); } };
  `)(kiosk, nodes, state);

  api.requestEnd();
  eq(state.requests.length, 1, 'unknown-PIN probe did not start exactly one request');
  api.requestEnd();
  eq(state.requests.length, 1, 'repeated End dispatched competing unknown-PIN probes');
  kiosk.generation = 2; kiosk.sid = 'sid-B'; kiosk.ext = 'patient-B'; kiosk.pinProbeBusy = false;
  api.resolve(0, { ok: true, json: { ok: true, unset: true } });
  eq(state.end, 0, 'patient A unknown-PIN response closed patient B kiosk');

  kiosk.pinSet = true; nodes.mlsAvKioskPinInput.value = '1234';
  api.submit('ambient'); api.submit('ambient');
  eq(state.requests.length, 2, 'double PIN submit dispatched competing unlock requests');
  kiosk.generation = 3; kiosk.sid = 'sid-C'; kiosk.ext = 'patient-C'; kiosk.pinUnlockBusy = false;
  api.resolve(1, { ok: true, json: { ok: true } });
  eq(state.ambient, 0, 'patient B unlock response opened patient C room microphone');

  nodes.mlsAvKioskPinInput.value = '1234'; api.submit('end');
  api.resolve(2, { ok: true, json: { ok: true } });
  eq(state.end, 1, 'current exact PIN response did not perform its one staff exit');
}

/* -------------------------------------------------------------------------
 * 4. AMBIENT TAIL: interim/final stop boundaries commit exactly once.
 */
function makeAmbientHarness(mode) {
  const clock = makeClock();
  const kiosk = { ambient: true, ambParts: [], ambLast: '', ambPending: '', ambLiveWords: 0,
    ambLiveAt: 0, ambClosing: false, ambFlushWaiters: [], ambRec: null,
    ambBound: 'patient-A', paused: false, completed: true };
  const slice = between('  function kioskAmbientAppend(text) {', '  /* ---- MUTE / PAUSE');
  const pauseSlice = between('  function kioskPauseToggle() {', '  function kioskEndVisit() {');
  const endSlice = between('  function kioskEndVisit() {', '  /* THE REVIEW.');
  const visitSlice = between('  function onVisitContext() {', '  function boot() {');
  const exitSlice = between('  function kioskEndForStaff(reason) {', '  function kioskPinSubmit(mode) {');
  const nodes = {
    mlsAvKioskMute: { textContent: '', setAttribute() {} },
    mlsAvKioskRecText: { textContent: '' },
    mlsAvKiosk: { classList: { add() {}, remove() {} } }
  };
  const state = { saves: 0, detects: 0, done: 0, stops: [], listens: 0,
    aborts: 0, gateStops: 0, active: 'patient-A', reviews: [], closeServer: 0, closes: 0 };
  const api = new Function('kiosk', 'nodes', 'state', 'clock', 'setTimer', 'clearTimer', `
    var Date = { now: clock };
    var setTimeout = setTimer, clearTimeout = clearTimer;
    var AMBIENT_REC_TEXT = 'Recording this visit';
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function clean(v) { return String(v == null ? '' : v).replace(/\\s+/g, ' ').trim(); }
    function gid(id) { return nodes[id] || null; }
    function activePtIdSafe() { return state.active; }
    function kioskAmbientSave() { state.saves++; }
    function ordersDetectSoon() { state.detects++; }
    function kioskLine() { return true; }
    function kioskAmbientClock() {}
    function kioskSetSay() {}
    function kioskMood() {}
    function kioskState() {}
    function pvStopVoice() {}
    function pvVoiceGateStop() { state.gateStops++; }
    function pvVoiceGateStart(done) { if (done) done(); }
    function kioskListen() { state.listens++; return true; }
    function kioskAmbientListen() { state.listens++; return true; }
    function ensureVisitCard() {}
    function kioskReviewShow(v) { state.reviews.push(v); }
    function kioskCloseServerSide() { state.closeServer++; }
    function kioskClose() { state.closes++; }
    function kioskAmbientStop(reason) {
      state.stops.push(reason); kiosk.ambient = false; kiosk.ambRec = null;
      kiosk.ambClosing = false;
      kiosk.ambResult = { reason: reason, filed: true, chars: 1 };
      return kiosk.ambResult;
    }
    ${slice}
    ${pauseSlice}
    ${endSlice}
    ${visitSlice}
    ${exitSlice}
    return { append: kioskAmbientAppend, commit: kioskAmbientCommitPending,
      flush: kioskAmbientFlush, pause: kioskPauseToggle, end: kioskEndVisit, visit: onVisitContext,
      exit: kioskEndForStaff,
      setActive: function (v) { state.active = v; },
      parts: function () { return kiosk.ambParts.slice(); } };
  `)(kiosk, nodes, state, clock.now, clock.setTimer, clock.clearTimer);

  if (mode === 'final-on-stop') {
    kiosk.ambPending = 'partial version';
    kiosk.ambRec = {
      stop() {
        api.append('confirmed final tail');
        kiosk.ambPending = '';
        kiosk.ambRec = null;
      }
    };
  } else {
    kiosk.ambPending = 'interim only tail';
    kiosk.ambRec = {
      stop() {}, abort() { state.aborts++; },
      onresult() { api.append('late private words'); }, onerror() {}, onend() {}
    };
  }
  return { clock, nodes, kiosk, state, api, rec: kiosk.ambRec };
}

{
  const h = makeAmbientHarness('final-on-stop');
  h.api.flush(() => { h.state.done++; });
  h.clock.runNext();
  deep(h.api.parts(), ['confirmed final tail'], 'stop final did not replace its provisional tail exactly once');
  eq(h.state.done, 1, 'stop final did not resolve its flush once');
  eq(h.api.commit(), false, 'cleared stop tail could be committed again');
}

{
  const h = makeAmbientHarness('interim-only');
  h.api.flush(() => { h.state.done++; });
  h.api.flush(() => { h.state.done++; });
  h.clock.advance(1200, 20);
  deep(h.api.parts(), ['interim only tail'], 'interim-only stop tail was discarded');
  eq(h.state.done, 2, 'concurrent stop callers were not fanned out from one flush');
  eq(h.api.commit(), false, 'interim-only tail was not cleared before append');
  eq(h.kiosk.ambRec, null, 'flush ceiling left the recogniser attached after the screen may say Paused');
  eq(h.rec.onresult, null, 'late browser results remained wired after the flush ceiling');
  if (h.rec.onresult) h.rec.onresult();
  deep(h.api.parts(), ['interim only tail'], 'late speech was captured after the flush ceiling');
  eq(h.state.aborts, 1, 'stuck recogniser was not hard-released at the flush ceiling');
}

{
  const h = makeAmbientHarness('interim-only');
  const ownership = [];
  h.api.flush((owned) => ownership.push(['pause', owned]), 'pause');
  h.api.flush((owned) => ownership.push(['end', owned]), 'end-visit');
  h.clock.advance(1200, 20);
  deep(ownership, [['end', true], ['pause', false]],
    'concurrent terminal work did not elect exactly one terminal owner first');
}

{
  const h = makeAmbientHarness('interim-only');
  h.api.exit('ended');
  eq(h.state.closes, 0, 'staff exit closed the overlay before its trailing words settled');
  h.clock.advance(1200, 20);
  deep(h.api.parts(), ['interim only tail'], 'staff exit lost its interim-only transcript tail');
  deep(h.state.stops, ['staff'], 'staff exit did not file/stop the capture exactly once');
  eq(h.state.closeServer, 1, 'staff exit did not close the interview server row once');
  eq(h.state.closes, 1, 'staff exit did not close the overlay after filing settled');
}

{
  const h = makeAmbientHarness('interim-only');
  h.api.end();
  h.clock.advance(1200, 20);
  deep(h.state.stops, ['end-visit'], 'End Visit did not own exactly one terminal stop');
  eq(h.kiosk.ambClosing, false, 'completed End Visit left the flush permanently active');
  eq(h.state.reviews.length, 1, 'End Visit did not show its one settled review');
  h.api.exit('ended');
  eq(h.state.closes, 1, 'Back to chart could not close after End Visit settled');
  eq(h.state.closeServer, 1, 'Back to chart did not close the server row after End Visit');
}

{
  const h = makeAmbientHarness('interim-only');
  h.api.pause();
  eq(h.kiosk.paused, true, 'resolving control: ambient pause did not enter paused state');
  eq(h.state.gateStops, 1, 'ambient Pause left the independent AEC microphone owner active');
  eq(h.kiosk.ambClosing, true, 'pause did not reserve its in-flight flush');
  h.api.setActive('patient-B');
  h.api.visit();
  h.clock.advance(1200, 20);
  deep(h.state.stops, ['patient-changed'],
    'chart switch during pause flush did not become the sole terminal owner');
  eq(h.kiosk.ambient, false, 'wrong-patient chart switch left ambient capture resumable');
  h.api.pause();
  eq(h.state.listens, 0, 'Resume reopened capture after the bound patient changed');
}

/* Keep-listening starts a NEW ambient capture on the surviving overlay. Prove
 * that it fixes every old Pause pixel before opening a microphone, and that a
 * chart switch is refused before any capture begins. */
function makeAmbientStartHarness(active) {
  const clock = makeClock();
  const classes = new Set(['paused']);
  const nodes = {
    mlsAvKiosk: { classList: {
      add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); }
    } },
    mlsAvKioskMute: { textContent: '▶ Resume', aria: 'true', setAttribute(k, v) { if (k === 'aria-pressed') this.aria = v; } },
    mlsAvKioskRecText: { textContent: 'PAUSED - not recording.' },
    mlsAvKioskPin: { style: {} }, mlsAvKioskTypeRow: { style: {} },
    mlsAvKioskRest: { style: {} }, mlsAvKioskProgress: { textContent: '' }
  };
  const kiosk = { open: true, ambient: false, consentAt: 1, mic: true,
    ext: 'patient-A', paused: true, ambParts: [], ambActions: [], ambFiled: true,
    intake: [], completed: true };
  const state = { active, listens: 0, closeServer: 0, gateStops: 0, says: [], lines: [] };
  const startSlice = between('  function kioskAmbientStart() {', '  /* ---- 3. END VISIT');
  const api = new Function('kiosk', 'nodes', 'state', 'clock', 'setTimer', 'clearTimer', `
    var Date = { now: clock }, setTimeout = setTimer, clearTimeout = clearTimer;
    var AMBIENT_REC_TEXT = 'Recording this visit. The avatar is listening in the room and taking notes for the doctor.';
    var AMBIENT_MAX_MS = 5400000, pvSaying = '', pvEchoSaying = '';
    function clean(v) { return String(v == null ? '' : v).replace(/\\s+/g, ' ').trim(); }
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function gid(id) { return nodes[id] || null; }
    function activePtIdSafe() { return state.active; }
    function ambientCaptureVisitReceipt(bound) {
      return bound === state.active ? { v: 1, bindingId: 'binding-A', epoch: 1,
        patient: { patientId: bound, name: '', dob: '', mrn: '' },
        visit: { historical: false, noteTimestamp: null, visitDate: '2026-08-17',
          provider: 'Synthetic Provider A', appointmentId: 'appointment-A',
          encounterId: '', encounterUrl: '' } } : null;
    }
    function ambientCurrentVisitMatchesReceipt(receipt) {
      return !!receipt && receipt.bindingId === 'binding-A' && receipt.epoch === 1 && receipt.patient.patientId === state.active;
    }
    function kioskSetSay(v) { state.says.push(String(v || '')); }
    function kioskLine(k, v) { state.lines.push([k, v]); }
    function kioskCloseServerSide() { state.closeServer++; }
    function pvStopVoice() {}
    function pvVoiceGateStop() { state.gateStops++; }
    function pvEchoDrop() {}
    function kioskAmbientClear() {}
    function kioskMood() {}
    function kioskAmbientPaint() {}
    function kioskAmbientTick() {}
    function ordersRender() {}
    function kioskAmbientSave() {}
    function kioskAmbientFlush() {}
    function kioskAmbientStop() {}
    function kioskAmbientListen() { state.listens++; return true; }
    ${startSlice}
    return { start: kioskAmbientStart };
  `)(kiosk, nodes, state, clock.now, clock.setTimer, clock.clearTimer);
  return { clock, nodes, classes, kiosk, state, api };
}

{
  const h = makeAmbientStartHarness('patient-A');
  eq(h.api.start(), true, 'Keep listening did not start the same bound patient capture');
  eq(h.state.listens, 1, 'same-patient Keep listening did not open one recogniser');
  eq(h.state.gateStops, 1, 'room capture retained the independent AEC microphone owner');
  eq(h.classes.has('paused'), false, 'live resumed capture retained the Paused class');
  eq(h.nodes.mlsAvKioskMute.textContent, '⏸ Pause', 'live resumed capture still offered Resume');
  eq(h.nodes.mlsAvKioskMute.aria, 'false', 'live resumed capture retained aria-pressed=true');
  eq(h.nodes.mlsAvKioskRecText.textContent,
    'Recording this visit. The avatar is listening in the room and taking notes for the doctor.',
    'live resumed capture still claimed it was not recording');
}

{
  const h = makeAmbientStartHarness('patient-B');
  eq(h.api.start(), false, 'Keep listening accepted a different active patient');
  eq(h.state.listens, 0, 'wrong-patient Keep listening opened a recogniser');
  eq(h.kiosk.ambient, false, 'wrong-patient Keep listening painted a recording state');
  eq(h.state.closeServer, 0, 'wrong-patient Keep listening mutated the interview server row');
  ok(/open chart changed/i.test(h.state.says[h.state.says.length - 1]),
    'wrong-patient Keep listening did not explain its refusal');
}

{
  const clock = makeClock();
  const kiosk = { open: true, generation: 4, consentAt: 123, paused: false,
    ambient: false, completed: false, busy: false, mic: true, lastSay: '' };
  const state = { media: [], turns: 0, listens: 0, trackStops: 0, gateStops: 0 };
  const nodes = {
    mlsAvKiosk: { classList: { add() {}, remove() {}, contains() { return false; } } },
    mlsAvKioskMute: { textContent: '', setAttribute() {} },
    mlsAvKioskRecText: { textContent: '' }
  };
  const preflightSlice = between('  function kioskMicPreflight(then) {',
    '  /* which of the eight backend voices');
  const pauseSlice = between('  function kioskPauseToggle() {', '  function kioskEndVisit() {');
  const api = new Function('kiosk', 'nodes', 'state', 'clock', 'setTimer', 'clearTimer', `
    var Date = { now: clock }, setTimeout = setTimer, clearTimeout = clearTimer;
    var AMBIENT_REC_TEXT = 'Recording';
    var vgStartGeneration = 0;
    var navigator = { mediaDevices: { getUserMedia: function () {
      var row = { ok: null, fail: null };
      state.media.push(row);
      return { then: function (ok, fail) { row.ok = ok; row.fail = fail; } };
    } } };
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function clean(v) { return String(v == null ? '' : v).trim(); }
    function gid(id) { return nodes[id] || null; }
    function pvVoiceGateAdopt() { return true; }
    function pvVoiceGateStop() { vgStartGeneration++; state.gateStops++; }
    function pvVoiceGateStart(done) { if (done) done(false); }
    function pvStopVoice() {}
    function kioskAmbientFlush() {}
    function kioskAmbientSave() {}
    function activePtIdSafe() { return 'patient-A'; }
    function kioskAmbientStop() {}
    function kioskAmbientListen() { state.listens++; }
    function kioskState() {}
    function kioskSetSay() {}
    function kioskMood() {}
    function kioskListen() { state.listens++; }
    function kioskTurn() { state.turns++; }
    function kioskLine() {}
    ${preflightSlice}
    ${pauseSlice}
    return { preflight: function () { kioskMicPreflight(function () { kioskTurn(null, null); }); },
      pause: kioskPauseToggle,
      resolve: function (n) { var track = { stop: function () { state.trackStops++; } };
        state.media[n].ok({ getTracks: function () { return [track]; } }); } };
  `)(kiosk, nodes, state, clock.now, clock.setTimer, clock.clearTimer);
  api.preflight();
  eq(state.media.length, 1, 'consent preflight did not create its first permission request');
  api.pause();
  eq(kiosk.paused, true, 'Pause did not mark pending consent preflight paused');
  eq(state.turns, 0, 'Pause during preflight started an opening turn');
  api.pause();
  eq(kiosk.paused, false, 'Resume did not leave the pending preflight pause state');
  eq(state.media.length, 2, 'Resume did not create a fresh consent preflight');
  eq(state.listens, 0, 'Resume opened a recogniser before the opening turn existed');
  api.resolve(0);
  eq(state.trackStops, 1, 'stale consent preflight stream was not stopped');
  eq(state.turns, 0, 'stale consent preflight started an opening turn');
  api.resolve(1);
  eq(state.turns, 1, 'fresh resumed preflight did not start exactly one opening turn');
  eq(state.listens, 0, 'fresh resumed preflight bypassed the opening backend turn');
}

{
  const clock = makeClock();
  const kiosk = { ambient: true, paused: false, ambClosing: false, ambFails: 0,
    ambRecAt: 0, ambRec: null, ambPending: 'last provisional room words', ambParts: [] };
  const state = { starts: 0, stops: [], saves: 0 };
  const failureSlice = between('  function kioskAmbientNoMic() {', '  function kioskIntakeAdd(');
  const api = new Function('kiosk', 'state', 'clock', 'setTimer', 'clearTimer', `
    var Date = { now: clock }, setTimeout = setTimer, clearTimeout = clearTimer, pvRec = null;
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function clean(v) { return String(v == null ? '' : v).replace(/\\s+/g, ' ').trim(); }
    function Recognition() {
      this.start = function () {
        var self = this; state.starts++;
        setTimeout(function () { if (self.onerror) self.onerror({ error: 'network' }); }, 0);
      };
      this.stop = function () {};
    }
    var window = { SpeechRecognition: Recognition };
    function kioskAmbientAppend(v) { v = clean(v); if (v) kiosk.ambParts.push(v); }
    function kioskAmbientCommitPending() {
      var v = clean(kiosk.ambPending); kiosk.ambPending = '';
      if (!v) return false; kioskAmbientAppend(v); return true;
    }
    function kioskAmbientPaint() {}
    function kioskAmbientSave() { state.saves++; }
    function kioskAmbientStop(reason) {
      state.stops.push(reason); kiosk.ambient = false; kiosk.ambRec = null;
      if (kiosk.ambRestart) { clearTimeout(kiosk.ambRestart); kiosk.ambRestart = null; }
      return { ok: true };
    }
    ${failureSlice}
    return { start: kioskAmbientListen };
  `)(kiosk, state, clock.now, clock.setTimer, clock.clearTimer);
  eq(api.start(), true, 'resolving control: ambient recogniser did not start');
  let guard = 0; while (clock.pending() && guard++ < 60) clock.runNext();
  eq(state.starts, 6, 'persistent ambient network outage was not bounded to finite starts');
  deep(state.stops, ['speech-service-unavailable'],
    'persistent ambient network outage did not stop/file honestly exactly once');
  deep(kiosk.ambParts, ['last provisional room words'],
    'persistent ambient outage discarded the painted provisional tail');
  eq(kiosk.ambient, false, 'ambient outage left the recording disclosure logically live');
  eq(clock.pending(), 0, 'ambient outage left a hot recogniser restart loop');
  eq(state.saves, 1, 'ambient outage did not back up captured words before stopping');
}

/* Route pins: both automatic boundaries must pass through the same tested flush. */
ok(/kiosk\.ambCap = setTimeout\(function \(\) \{\s*kioskAmbientFlush\(function \(owned\) \{[^]*?kioskAmbientStop\('cap'\)[^]*?\}, 'cap'\)/.test(SRC),
  '90-minute cap bypasses the tested last-tail flush');
ok(/function onVisitContext\(\)[^]*?kioskAmbientFlush\(function \(owned\) \{[^]*?kioskAmbientStop\('patient-changed'\)[^]*?\}, 'patient-changed'\)/.test(SRC),
  'patient change bypasses the tested last-tail flush');
ok(/function kioskEndForStaff\(reason\)[^]*?kioskAmbientFlush\(finishExit, 'staff'\)/.test(SRC),
  'staff PIN exit bypasses the tested last-tail flush');
ok(/if \(!answer \|\| finish\) pvStopMic\(\);/.test(SRC),
  'answered turns still close the microphone during backend latency');
ok(/continued = kioskTakeSpeech\(\);[^]*?kioskTurn\(continued, kioskNonce\(\)\)/.test(SRC),
  'buffered speech has no one-shot continuation path');
ok(/var turnGeneration = kiosk\.generation \| 0;[^]*?function turnCurrent\(\)[^]*?clean\(kiosk\.sid\) === turnSid[^]*?clean\(kiosk\.ext\) === turnExt/.test(SRC),
  'backend turns are not bound to the exact kiosk generation/session/patient');
ok(/setTimeout\(function \(\) \{ if \(turnCurrent\(\) && !kiosk\.completed\) kioskFinish\(\); \}, 12000\)/.test(SRC),
  'the delayed done fallback can still mutate a later patient session');
ok(/if \(!turnCurrent\(\)\) return;\s*kiosk\.busy = false;/.test(SRC),
  'a stale backend response can still clear or mutate the current patient session');
ok(/function handleTurnFailure\(message, speakIt\)[^]*?if \(retryAttempt >= 1\)[^]*?kioskTypingFallback\(/.test(SRC),
  'second backend failure has no bounded typed-recovery owner');
ok(/retryTimer = setTimeout\(settleRetry, speakIt \? 6000 : 500\)/.test(SRC),
  'refusal callback has no bounded watchdog if speech is canceled');
ok(/var continued = clean\(kiosk\.pendingSpeech\);[^]*?var alertContinuation = kioskTakeSpeech\(\)/.test(SRC),
  'emergency alert removes the continuation before the alert actually finishes');

console.log('PASS 1p-avatar-listener-reliability-runtime (' + checks + ' assertions)');

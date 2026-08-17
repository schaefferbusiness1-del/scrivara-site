/* 1p PREVIEW ONLY: the audible sentence, visible state and exact face are one
 * lifecycle. Synthetic browser objects only; no microphone, backend, chart or
 * Athena action is used. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_avatar.js'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function deep(actual, expected, message) { assert.deepStrictEqual(actual, expected, message); checks++; }

/* the avintake-1.0.0 block, verbatim: the topic vocabulary, the repeat guard and the
   correction detector that kioskTurn now calls. Sliced rather than re-declared so this
   harness executes the shipped code. */
function sliceBetween(first, last) {
  const a = SOURCE.indexOf(first), b = SOURCE.indexOf(last, a);
  assert(a >= 0 && b > a, 'missing source boundary: ' + first);
  return SOURCE.slice(a, b);
}
const INTAKE_BLOCK = sliceBetween(
  '/* ===== avintake-1.0.0 (2026-08-17) — THE INTERVIEW GETS A MEMORY.',
  '/* ===== end avintake-1.0.0 ===== */\n  function kioskIntakeText'
);

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = SOURCE.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
  const brace = SOURCE.indexOf('{', start);
  let depth = 0, quote = '', line = false, block = false, escape = false;
  for (let i = brace; i < SOURCE.length; i++) {
    const c = SOURCE[i], n = SOURCE[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return SOURCE.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}

/* Setup voice samples are owned by the visible Setup face and by the panel
 * lifecycle. Closing or changing tabs cannot leave disembodied speech alive. */
{
  const close = extractFunction('close');
  ok(close.indexOf('pvStopVoice();') >= 0 && close.indexOf('pvStopVoice();') < close.indexOf('removeChild(back)'),
    'Setup panel was removed before its voice owner stopped');
  const previewAt = SOURCE.indexOf("var voiceTry = make('button'");
  const previewEnd = SOURCE.indexOf('voiceRow.appendChild', previewAt);
  const preview = SOURCE.slice(previewAt, previewEnd);
  ok(/pvSpeakVoiced\([^]*voiceSelect\.value, 'greet', lookCtl\);/.test(preview),
    'Hear-this-voice does not bind playback to the visible Setup face');
  const tabsAt = SOURCE.indexOf('defs.forEach(function (def, index)');
  const tabsEnd = SOURCE.indexOf('panel.appendChild(tabs)', tabsAt);
  const tabs = SOURCE.slice(tabsAt, tabsEnd);
  ok(tabs.includes('stopCamera();') && tabs.includes('pvStopVoice();'),
    'changing Setup tabs did not stop every camera/voice owner');
}

/* Execute the real audio/mouth owner. A queued frame from chunk one is invoked
 * adversarially after chunk two starts; it must be inert. Mouth movement and
 * visible speaking truth begin only at actual playback, not at fetch time. */
{
  const state = { audios: [], raf: new Map(), nextRaf: 1, canceled: [], starts: 0, finishes: 0 };
  function Audio(url) {
    this.url = url; this.ended = false; this.duration = 2;
    this.play = () => ({ catch() {} }); this.pause = () => {};
    state.audios.push(this);
  }
  function face(name) {
    return { name, calls: [], talk(v) { this.calls.push(['talk', v]); }, talkCycle(v) { this.calls.push(['cycle', v]); } };
  }
  const build = new Function('state', 'Audio', `
    var kiosk = { face: null }, pvSpeakSeq = 7, pvWatchdog = null;
    var ttsAudioNow = null, ttsRaf = 0, ttsMouthGeneration = 0, pvTalkFace = null;
    var ttsCtx = {
      state: 'running', destination: {},
      createMediaElementSource: function () { return { connect: function () {} }; },
      createAnalyser: function () { return { fftSize: 0, frequencyBinCount: 64,
        connect: function () {}, getByteFrequencyData: function (buf) { for (var i=0;i<buf.length;i++) buf[i]=120; } }; }
    };
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function requestAnimationFrame(fn) { var id = state.nextRaf++; state.raf.set(id, fn); return id; }
    function cancelAnimationFrame(id) { state.canceled.push(id); state.raf.delete(id); }
    function setTimeout() { return 91; } function clearTimeout() {}
    ${extractFunction('faceTalkStop')}
    ${extractFunction('faceTalkCycle')}
    ${extractFunction('ttsPlayUrl')}
    return { play: ttsPlayUrl, report: function () { return { generation: ttsMouthGeneration, raf: ttsRaf }; } };
  `);
  const api = build(state, Audio);
  const first = face('first'), second = face('second');
  api.play('one', 7, () => state.finishes++, first, () => state.starts++);
  eq(first.calls.length, 0, 'mouth moved while audio was only loading');
  eq(state.starts, 0, 'visible speaking began before playback');
  state.audios[0].onplaying();
  eq(state.starts, 1, 'actual first playback did not publish speaking once');
  const staleId = api.report().raf, stale = state.raf.get(staleId);
  ok(typeof stale === 'function', 'first audio did not own an amplitude frame');

  api.play('two', 7, () => state.finishes++, second, () => state.starts++);
  ok(state.canceled.includes(staleId), 'second audio did not cancel the first audio frame owner');
  stale(100); // browsers may still deliver a callback already queued for paint
  eq(first.calls.length, 0, 'stale first-chunk frame changed the mouth after ownership moved');
  eq(second.calls.length, 0, 'stale first-chunk frame stopped or changed the live second face');

  state.audios[1].onplaying();
  state.audios[1].onplaying();
  eq(state.starts, 2, 'one audio element published playback start more than once');
  const live = state.raf.get(api.report().raf);
  ok(typeof live === 'function', 'second audio did not own its own amplitude frame');
  live(100);
  ok(second.calls.some(row => row[0] === 'talk' && row[1] > 0),
    'the exact second audio owner did not animate the exact second face');
}

/* Browser-speech fallback obeys the same actual-playback gate. Some Windows
 * voices emit only boundary, so both events are supported behind one owner. */
{
  const state = { spoken: [], timers: [] };
  function Utterance(text) { this.text = text; }
  const synth = { cancel() {}, speak(u) { state.spoken.push(u); }, getVoices() { return []; } };
  const face = { calls: [], talkCycle(v) { this.calls.push(['cycle', v]); }, talk(v) { this.calls.push(['talk', v]); } };
  const build = new Function('state', 'Utterance', 'synth', 'face', `
    var window = { speechSynthesis:synth, SpeechSynthesisUtterance:Utterance };
    var pvSpeakSeq=4, pvWatchdog=null, pvHeld=[], pvVoice=null, pvWantMale=null;
    var kiosk={ face:face }, pvTalkFace=null, ttsRaf=0, ttsMouthGeneration=0;
    function safe(fn, fallback) { try { return fn(); } catch(e) { return fallback; } }
    function setTimeout(fn, ms) { state.timers.push([fn,ms]); return state.timers.length; }
    function clearTimeout() {} function cancelAnimationFrame() {}
    function pvPickVoice() { return null; }
    ${extractFunction('faceTalkCycle')}
    ${extractFunction('pvSpeakSynth')}
    return { speak:pvSpeakSynth };
  `);
  let started = 0, finished = 0;
  const api = build(state, Utterance, synth, face);
  api.speak('Synthetic fallback sentence', 4, () => finished++, face, () => started++);
  eq(face.calls.length, 0, 'fallback mouth moved before browser speech playback');
  eq(started, 0, 'fallback UI claimed speaking before browser playback');
  const utterance = state.spoken[0];
  ok(utterance && typeof utterance.onstart === 'function' && typeof utterance.onboundary === 'function',
    'fallback lacks its two actual-playback signals');
  utterance.onboundary(); utterance.onstart();
  eq(started, 1, 'fallback playback signals published Speaking more than once');
  deep(face.calls, [['cycle', true]], 'fallback mouth cycle did not start exactly with playback');
  utterance.onend();
  eq(finished, 1, 'fallback completion receipt did not settle once');
}

/* Drive the real ordinary-turn branch. Fetch/generation does not claim
 * Speaking; actual playback does, and completion atomically returns the chip,
 * root classes and face to Listening while preserving the recogniser. */
(async function () {
  const state = { moods: [], states: [], listens: [], arms: [], speech: null };
  const kiosk = { open: true, busy: false, consentAt: 1, completed: false, ambient: false,
    paused: false, generation: 3, sid: 'synthetic-session', ext: 'synthetic-patient',
    pendingSpeech: '', chartCtx: null, spoke: true, lastSay: '', intake: [] };
  const build = new Function('state', 'kiosk', `
    var pvRec = null;
    function clean(v) { return String(v == null ? '' : v).replace(/\\s+/g, ' ').trim(); }
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function setTimeout() { return 17; } function clearTimeout() {}
    function pvStopMic() { pvRec = null; }
    function pvVoiceGateStop() {}
    function kioskMood(a,b,c) { state.moods.push([a,b,c]); }
    function kioskState(v) { state.states.push(v); }
    function kioskLineReset() {}
    function kioskLine() {}
    function kioskChartContext() { return null; }
    function kioskSetSay(v) { state.say = v; }
    function kioskSetIdentity() {}
    function kioskIntakeAdd() {}
    function kioskTakeSpeech() { var v=clean(kiosk.pendingSpeech); kiosk.pendingSpeech=''; return v; }
    function kioskNonce() { return 'synthetic-nonce'; }
    function kioskListen(keep) { state.listens.push(keep); pvRec = { live: true }; }
    function kioskArmWatchdog(ms) { state.arms.push(ms); }
    function kioskFinish() {}
    function kioskTypingFallback() {}
    function kioskRetryAnswer() {}
    function kioskStopBounded() {}
    /* avintake-1.0.0 (2026-08-17): kioskTurn now consults the interview's covered-topic
       ledger, its repeat guard and its correction detector. The REAL block is injected
       below rather than stubbed - a stub looser than the real thing hides the call, and
       these are pure functions over kiosk and clean, both of which this harness already
       provides. (No back-ticks in this comment: it lives inside a template literal.) */
    ${INTAKE_BLOCK}
    function gid(id) { return id === 'mlsAvKioskProgress' ? { textContent: '' } : null; }
    function pvSpeakShaped(text, then, shape, onStart) { state.speech = { text:text, finish:then, shape:shape, start:onStart }; }
    function api() { return Promise.resolve({ ok:true, json:{ ok:true, say:'How are you feeling today?', done:false,
      progress:{ covered:2, total:6 }, avatar:{ name:'Synthetic assistant' } } }); }
    ${extractFunction('kioskSpeechStarted')}
    ${extractFunction('kioskTurn')}
    return { turn: kioskTurn, rec: function () { return pvRec; } };
  `);
  const api = build(state, kiosk);
  api.turn('synthetic answer', 'synthetic-answer-nonce');
  await Promise.resolve(); await Promise.resolve();
  deep(state.moods, [['thinking', '', 'synthetic answer']],
    'audio generation claimed Speaking before sound actually began');
  deep(state.listens, [true], 'ordinary question did not open duplex listening before playback');
  ok(state.speech && typeof state.speech.start === 'function', 'ordinary question has no actual-playback state hook');
  state.speech.start();
  deep(state.moods[state.moods.length - 1], ['speaking', 'How are you feeling today?', 'synthetic answer'],
    'actual playback did not move the face/root into speaking');
  eq(state.states[state.states.length - 1], 'duplex', 'live playback with an open mic did not show duplex truth');
  state.speech.finish();
  deep(state.moods[state.moods.length - 1], ['listening', 'How are you feeling today?', 'synthetic answer'],
    'speech completion left the face/root claiming to speak');
  eq(api.rec().live, true, 'speech completion closed the continuous recogniser');
  eq(state.arms[state.arms.length - 1], 9000, 'silence owner did not begin at actual speech completion');

  const listen = extractFunction('kioskListen');
  ok(/var bargedIn = !!\(pvSaying && otherVoice\);[^]*pvStopSpeechOnly\(\);[^]*kioskMood\('listening'/.test(listen),
    'real barge-in does not atomically retire speaking UI with the audio');

  console.log('PASS 1p Avatar speech connection (' + checks + ' assertions)');
})().catch(error => { console.error(error); process.exitCode = 1; });

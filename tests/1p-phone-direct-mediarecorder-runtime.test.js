'use strict';

/*
 * p1-phone-direct-mediarecorder-runtime
 *
 * Browserless contract for the simple iPhone app's in-page recorder.  The
 * fixture uses only synthetic identities and synthetic audio bytes; it never
 * opens a browser, microphone, Athena, MLS, or the extension.
 *
 * It proves the parts that were missing from the previous phone path:
 *   - the two preview shells carry the same direct-recorder owner and compile;
 *   - a phone prefers the hosted MediaRecorder owner even when WebKit exposes
 *     a nominal SpeechRecognition constructor (the real failure shown by the
 *     iPhone screenshots);
 *   - recording opens one authenticated server session, creates complete
 *     MediaRecorder segments, and does not claim Stop until the final segment
 *     has uploaded and the final transcript poll has completed;
 *   - transcript text is appended once and only while the immutable visit
 *     binding is still exact;
 *   - a patient/session boundary stops the stream and closes the server
 *     session rather than leaking audio into the next visit;
 *   - the phone owns one persistent mic explanation, so the hidden host toast
 *     cannot stack a duplicate over the Record control.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const START = 'const _mlsDirectPhone={';
const END = '/* ===== RECORD-FIRST HERO';

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }

function inlineScriptsCompile(source, label) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match, count = 0;
  while ((match = re.exec(source))) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i);
    if (type && !/^(?:text|application)\/(?:java|ecma)script$|^module$/i.test(type[1].trim())) continue;
    const code = match[2].replace(/^\s*<!--/, '').replace(/-->\s*$/, '');
    if (!code.trim()) continue;
    count += 1;
    assert.doesNotThrow(
      () => new vm.Script('(function(){\n' + code + '\n})', { filename: `${label}#inline-${count}` }),
      `${label}: inline script ${count} does not compile`
    );
  }
  ok(count > 0, `${label}: no inline scripts were compiled`);
}

function directBlock(source, label) {
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  ok(start >= 0 && end > start, `${label}: direct phone recorder block is missing`);
  return source.slice(start, end);
}

function classList(initial) {
  const values = new Set(initial || []);
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); },
    toArray() { return Array.from(values); }
  };
}

function response(data, status) {
  const code = status == null ? 200 : status;
  return {
    ok: code >= 200 && code < 300,
    status: code,
    json: async () => data,
    clone: () => response(data, code)
  };
}

function namedError(name, message) {
  const error = new Error(message || name);
  error.name = name;
  return error;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush(turns) {
  for (let i = 0; i < (turns || 4); i += 1) {
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
  }
}

function makeHarness(options) {
  const opts = options || {};
  const events = Object.create(null);
  const warnings = [];
  const calls = {
    getUserMedia: 0, start: 0, audio: 0, poll: 0, stop: 0,
    trackStops: 0, recorderStarts: 0, recorderStops: 0,
    releases: 0, dirty: 0, liveUpdates: []
  };
  const audioGate = opts.audioGate || null;
  let audioAccepted = false;

  const captureBtn = {
    classList: classList(['btn-primary']),
    innerHTML: '\u25b6 Start Visit'
  };
  const transcript = { value: opts.initialTranscript || '' };
  const micWarn = { style: { display: 'none' }, offsetParent: null, textContent: '' };
  const elements = { captureBtn, transcript, micWarn };
  const track = { stop() { calls.trackStops += 1; } };
  const stream = { getTracks() { return [track]; } };

  class FakeFileReader {
    readAsDataURL(blob) {
      Promise.resolve(blob.arrayBuffer()).then(buffer => {
        this.result = 'data:' + (blob.type || 'audio/mp4') + ';base64,' + Buffer.from(buffer).toString('base64');
        if (this.onloadend) this.onloadend();
      }, error => { if (this.onerror) this.onerror(error); });
    }
  }

  class FakeMediaRecorder {
    constructor(inputStream, recorderOptions) {
      FakeMediaRecorder.attempts += 1;
      const failedAttempts = Array.isArray(opts.recorderFailsAt) ? opts.recorderFailsAt : [Number(opts.recorderFailsAt)];
      if (failedAttempts.indexOf(FakeMediaRecorder.attempts) >= 0) throw new Error('synthetic recorder interruption');
      this.stream = inputStream;
      this.mimeType = (recorderOptions && recorderOptions.mimeType) || 'audio/mp4';
      this.state = 'inactive';
      FakeMediaRecorder.instances.push(this);
    }
    start() { this.state = 'recording'; calls.recorderStarts += 1; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive'; calls.recorderStops += 1;
      queueMicrotask(() => {
        if (this.ondataavailable) this.ondataavailable({ data: new Blob(['synthetic-audio'], { type: this.mimeType }) });
        if (this.onstop) this.onstop();
      });
    }
    static isTypeSupported(mime) { return /^audio\/mp4/.test(String(mime || '')); }
  }
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.attempts = 0;

  const fetch = async (url, init) => {
    const method = String((init && init.method) || 'GET').toUpperCase();
    const target = String(url);
    if (/\/api\/mic\/start$/.test(target) && method === 'POST') {
      calls.start += 1;
      if (opts.sessionStatus) return response({ error: 'synthetic session refusal' }, Number(opts.sessionStatus));
      return response({ ok: true, code: 'SYN123' });
    }
    if (/\/api\/mic\/SYN123\/audio$/.test(target) && method === 'POST') {
      calls.audio += 1;
      ok(init && /application\/json/i.test(String(init.headers && init.headers['Content-Type'] || '')),
        'audio upload is not JSON');
      const body = JSON.parse(init.body);
      ok(/^data:audio\/mp4[^,]*;base64,/.test(body.audio), 'final segment is not a complete data URL');
      ok(/^audio\/mp4/.test(body.mimetype), 'Safari-compatible MP4 MIME was not preserved');
      if (audioGate) await audioGate.promise;
      audioAccepted = true;
      return response({ ok: true, transcript: 'Patient says pain improved.' });
    }
    if (/\/api\/mic\/SYN123\/stop$/.test(target) && method === 'POST') {
      calls.stop += 1;
      return response({ ok: true });
    }
    if (/\/api\/mic\/SYN123$/.test(target) && method === 'GET') {
      calls.poll += 1;
      return response({ ok: true, transcript: audioAccepted ? 'Patient says pain improved.' : '' });
    }
    throw new Error('unexpected request: ' + method + ' ' + target);
  };

  const ctx = {
    Promise, Date, Math, String, Number, JSON, Array, Object, RegExp, Error,
    Blob, Buffer, FileReader: FakeFileReader, MediaRecorder: FakeMediaRecorder,
    encodeURIComponent, setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask, fetch,
    console: { log() {}, warn() {}, error() {} },
    navigator: {
      mediaDevices: {
        getUserMedia() {
          calls.getUserMedia += 1;
          if (opts.micError) return Promise.reject(opts.micError);
          return Promise.resolve(stream);
        }
      }
    },
    document: {
      body: { classList: classList(['mls-ph3']) },
      getElementById(id) { return elements[id] || null; }
    },
    location: { origin: 'https://mlsscribe.example' },
    SR: opts.speechRecognition || null,
    backendMode: () => true,
    bkToken: () => 'synthetic-token',
    bkBase: () => 'https://backend.example',
    handle401: () => {},
    showMicWarn(message) { warnings.push(String(message)); micWarn.textContent = String(message); micWarn.style.display = 'block'; },
    mlsSpeechHub() {
      return {
        register() { return () => {}; },
        claim() { return { ok: true, pending: false, whenReady(fn) { fn(); return true; } }; },
        release() { calls.releases += 1; }
      };
    },
    _athenaAsyncBindingStillSafe(candidate, action, epoch) {
      return !!candidate && action === 'recording' && Number(epoch) === Number(ctx.currentVisitAthenaEpoch);
    },
    _athenaSetVisitBinding(binding) {
      ctx.currentVisitAthenaBinding = binding;
      ctx.currentVisitAthenaEpoch += 1;
      return true;
    },
    _athenaCurrentMatchesBound(binding) { return binding === ctx.currentVisitAthenaBinding; },
    _markVisitDirty() { calls.dirty += 1; },
    _updateLiveCapture(words) { calls.liveUpdates.push(words); },
    _hideLiveCapture() {},
    currentVisitAthenaBinding: null,
    currentVisitAthenaEpoch: 7,
    currentVisitAthenaCompromised: false,
    capturing: false,
    captureSessionEpoch: 0,
    finalText: ''
  };
  ctx.window = ctx;
  ctx.window.addEventListener = (type, fn) => { (events[type] || (events[type] = [])).push(fn); };

  const block = directBlock(read('1pScribeFlow.html'), '1pScribeFlow.html');
  new vm.Script(block, { filename: 'p1-direct-phone-recorder.js' }).runInNewContext(ctx);

  return {
    ctx, calls, warnings, captureBtn, transcript, micWarn, audioGate,
    recorders: FakeMediaRecorder.instances,
    fire(type) { (events[type] || []).slice().forEach(fn => fn()); }
  };
}

function sourceContracts() {
  const compatibilityErrors = [];
  const sources = SHELLS.map(rel => [rel, read(rel)]);
  sources.forEach(([rel, source]) => inlineScriptsCompile(source, rel));
  const first = directBlock(sources[0][1], sources[0][0]);
  const second = directBlock(sources[1][1], sources[1][0]);
  eq(second, first, 'the canonical and /1p direct-recorder blocks drifted');

  sources.forEach(([rel, source]) => {
    const supported = source.slice(source.indexOf('function _mlsDirectPhoneSupported()'), source.indexOf('function _mlsDirectPhoneMime()'));
    if (/!SR\s*&&/.test(supported)) compatibilityErrors.push(
      `${rel}: the direct iPhone recorder is incorrectly disabled when Safari exposes its unreliable prefixed SpeechRecognition API`);
    const start = source.slice(source.indexOf('function startCapture()'), source.indexOf('function stopCapture()'));
    ok(start.indexOf('_mlsDirectPhoneSupported()') >= 0, `${rel}: startCapture does not route to the direct phone recorder`);
    if (!(start.indexOf('_mlsDirectPhoneSupported()') < start.indexOf('initRecog()'))) compatibilityErrors.push(
      `${rel}: phone capture tries Web Speech before the reliable MediaRecorder path`);

    const warn = source.slice(source.indexOf('function showMicWarn(msg)'), source.indexOf(START));
    /* micv-1.0.0 (2026-08-28): the PROPERTY pinned here is unchanged - a hidden
       host warning must not stack a duplicate toast over the phone's own
       persistent banner. What changed is that the suppression no longer tests
       `phoneOwns` (body.mls-ph3), which was a PROXY for "the doctor can already
       read this" and was wrong exactly when the phone had not lifted the
       sentence into its banner: the mic failure then announced itself to
       nobody, which is the defect phone-has-a-transcript-and-a-way-on exists to
       prevent. Those two suites were pinning opposite spellings of the same
       requirement. The condition now asks whether the message is VISIBLE, which
       satisfies both, so this pins that instead - and adds the second half,
       that a bare is-a-phone test must never come back. */
    ok(/alreadyVisible/.test(warn) && /!w\.offsetParent\s*&&\s*!alreadyVisible/.test(warn) && /mlsPh3Note/.test(warn),
      `${rel}: hidden host mic warnings can still stack a duplicate toast over the phone owner`);
    ok(!/classList\.contains\('mls-ph3'\)/.test(warn),
      `${rel}: the mic fallback is suppressed by merely being on a phone - that is how a real mic failure goes silent`);
  });
  return compatibilityErrors;
}

async function happyLifecycle() {
  const gate = deferred();
  const h = makeHarness({ audioGate: gate });
  const binding = { id: 'visit-synthetic-1', patient: { name: 'Synthetic One', dob: '2000-01-01' } };

  eq(h.ctx._mlsDirectPhoneSupported(), true, 'simple phone does not advertise its direct recorder');
  eq(h.ctx._mlsStartDirectPhoneCapture(binding), true, 'trusted phone start was not accepted');
  await flush();

  eq(h.calls.getUserMedia, 1, 'phone requested the microphone more than once');
  eq(h.calls.start, 1, 'phone opened the wrong number of hosted mic sessions');
  eq(h.recorders.length, 1, 'phone did not create exactly one first MediaRecorder segment');
  eq(h.ctx.__mlsDirectPhoneCapture.state().status, 'recording', 'phone never reached truthful Recording state');
  ok(h.captureBtn.classList.contains('recording'), 'host capture receipt did not enter recording state');

  const stopped = h.ctx._mlsStopDirectPhoneCapture('test-stop');
  await flush(1);
  eq(h.ctx.__mlsDirectPhoneCapture.state().status, 'stopping', 'Stop did not enter a truthful finishing state');
  eq(h.calls.trackStops, 0, 'phone released the microphone before its final segment was uploaded');
  eq(h.calls.stop, 0, 'phone closed the server session before the final upload completed');

  gate.resolve();
  eq(await stopped, true, 'clean direct phone stop did not report success');
  await flush();

  eq(h.calls.audio, 1, 'final self-contained segment was not uploaded exactly once');
  eq(h.calls.stop, 1, 'hosted mic session was not closed exactly once');
  eq(h.calls.trackStops, 1, 'microphone track was not released exactly once');
  eq(h.ctx.__mlsDirectPhoneCapture.state().status, 'idle', 'phone remained stuck after Stop');
  eq(h.transcript.value, 'Patient says pain improved.', 'cumulative server transcript was duplicated or dropped');
  eq(h.ctx.finalText, 'Patient says pain improved. ', 'SpeechRecognition buffer did not stay aligned with the direct transcript');
  eq(h.warnings.length, 0, 'successful direct recording raised a mic warning');
  ok(!h.captureBtn.classList.contains('recording'), 'capture receipt remained recording after final upload');
}

async function identityBoundaryAborts() {
  const h = makeHarness();
  const binding = { id: 'visit-synthetic-A', patient: { name: 'Synthetic A', dob: '2000-01-01' } };
  h.ctx._mlsStartDirectPhoneCapture(binding);
  await flush();
  eq(h.ctx.__mlsDirectPhoneCapture.state().status, 'recording', 'boundary fixture never started');

  h.ctx.currentVisitAthenaEpoch += 1;
  h.fire('mls:active-patient-changed');
  await new Promise(resolve => setTimeout(resolve, 15));
  await flush();

  eq(h.ctx.__mlsDirectPhoneCapture.state().status, 'idle', 'patient boundary left the old visit recorder alive');
  eq(h.calls.trackStops, 1, 'patient boundary did not close the old microphone track');
  eq(h.calls.audio, 0, 'patient boundary uploaded audio after invalidating the visit binding');
  eq(h.transcript.value, '', 'patient boundary appended speech into the next visit');
  eq(h.calls.stop, 1, 'patient boundary did not close the hosted mic session');
}

async function rollingSegmentsStaySelfContainedAndDeduplicated() {
  const h = makeHarness();
  const binding = { id: 'visit-synthetic-roll', patient: { name: 'Synthetic Roll', dob: '2000-01-01' } };
  h.ctx._mlsStartDirectPhoneCapture(binding);
  await flush();

  /* Model the eight-second rollover without waiting eight wall-clock seconds.
     The first recorder's normal stop handler must upload that complete file
     and then construct an independent recorder for the next segment. */
  h.recorders[0].stop();
  await new Promise(resolve => setTimeout(resolve, 15));
  await flush(8);
  eq(h.recorders.length, 2, 'segment rollover reused a stopped recorder instead of creating a complete new file');
  eq(h.calls.audio, 1, 'first complete segment did not upload once');
  eq(h.ctx.__mlsDirectPhoneCapture.state().status, 'recording', 'normal segment rollover stopped the visit');

  eq(await h.ctx._mlsStopDirectPhoneCapture('rollover-stop'), true, 'recording did not stop cleanly after a rollover');
  await flush();
  eq(h.calls.audio, 2, 'the final segment after rollover did not upload exactly once');
  eq(h.transcript.value, 'Patient says pain improved.', 'cumulative transcript duplicated across two segments');
}

async function lateTranscriptCannotCrossAVisitBoundary() {
  const gate = deferred();
  const h = makeHarness({ audioGate: gate });
  const binding = { id: 'visit-synthetic-late-A', patient: { name: 'Synthetic Late A', dob: '2000-01-01' } };
  h.ctx._mlsStartDirectPhoneCapture(binding);
  await flush();
  const stopped = h.ctx._mlsStopDirectPhoneCapture('late-stop');
  await flush(2);

  /* The audio request is already in flight when the selected visit changes.
     Its eventual server transcript must not enter the new editor. */
  h.ctx.currentVisitAthenaEpoch += 1;
  gate.resolve();
  await stopped;
  await flush();
  eq(h.calls.audio, 1, 'late-response fixture did not have an in-flight audio upload');
  eq(h.transcript.value, '', 'late transcript crossed into a different visit');
  eq(h.ctx.__mlsDirectPhoneCapture.state().status, 'idle', 'late response left the recorder stuck');
}

async function rolloverFailureCannotClaimItIsRecording() {
  const h = makeHarness({ recorderFailsAt: [2, 3] });
  const binding = { id: 'visit-synthetic-interrupt', patient: { name: 'Synthetic Interrupt', dob: '2000-01-01' } };
  h.ctx._mlsStartDirectPhoneCapture(binding);
  await flush();
  h.recorders[0].stop();
  await new Promise(resolve => setTimeout(resolve, 15));
  await flush();

  const status = h.ctx.__mlsDirectPhoneCapture.state().status;
  const liveRecorders = h.recorders.filter(recorder => recorder.state === 'recording').length;
  const truthful = status === 'idle' || (status === 'recording' && liveRecorders === 1);
  /* Always release a defective implementation too, so a failed assertion does
     not leave the suite's interval alive. */
  if (status !== 'idle') await h.ctx._mlsStopDirectPhoneCapture('test-cleanup');
  ok(truthful,
    'a failed segment restart left the UI claiming Recording with no live MediaRecorder');
  ok(h.warnings.some(message => /could not start the iPhone recorder/i.test(message)),
    'segment restart failure did not explain the interruption');
}

async function deniedPermissionIsSpecificAndClean() {
  const h = makeHarness({ micError: namedError('NotAllowedError', 'synthetic refusal') });
  const binding = { id: 'visit-synthetic-denied', patient: { name: 'Synthetic Denied', dob: '2000-01-01' } };
  h.ctx._mlsStartDirectPhoneCapture(binding);
  await flush();

  eq(h.ctx.__mlsDirectPhoneCapture.state().status, 'idle', 'denied microphone left the app stuck in Starting');
  eq(h.calls.start, 1, 'permission failure fixture did not open its parallel server session');
  eq(h.calls.stop, 1, 'permission failure leaked the parallel server session');
  eq(h.recorders.length, 0, 'permission failure created a MediaRecorder');
  eq(h.warnings.length, 1, 'permission failure did not produce exactly one persistent explanation');
  ok(/Page Settings.*Microphone.*Allow/i.test(h.warnings[0]), 'permission guidance is not specific to iPhone Safari');
}

async function serverSessionFailureReleasesGrantedMicrophone() {
  const h = makeHarness({ sessionStatus: 503 });
  const binding = { id: 'visit-synthetic-server-fail', patient: { name: 'Synthetic Server Fail', dob: '2000-01-01' } };
  h.ctx._mlsStartDirectPhoneCapture(binding);
  await flush();

  eq(h.ctx.__mlsDirectPhoneCapture.state().status, 'idle', 'server refusal left the app stuck in Starting');
  eq(h.calls.getUserMedia, 1, 'server failure fixture never received its granted microphone');
  eq(h.calls.trackStops, 1, 'server refusal leaked the already-granted microphone stream');
  eq(h.recorders.length, 0, 'server refusal started a local recorder with nowhere to send audio');
  eq(h.warnings.length, 1, 'server refusal did not produce exactly one persistent explanation');
  ok(/secure transcription session/i.test(h.warnings[0]), 'server refusal was mislabeled as a microphone-permission failure');
}

(async function main() {
  const compatibilityErrors = sourceContracts();
  await happyLifecycle();
  await rollingSegmentsStaySelfContainedAndDeduplicated();
  await lateTranscriptCannotCrossAVisitBoundary();
  await rolloverFailureCannotClaimItIsRecording();
  await identityBoundaryAborts();
  await deniedPermissionIsSpecificAndClean();
  await serverSessionFailureReleasesGrantedMicrophone();
  assert.deepStrictEqual(compatibilityErrors, [], compatibilityErrors.join('\n'));
  console.log(`PASS direct iPhone MediaRecorder lifecycle: ${checks} checks`);
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

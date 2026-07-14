'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const feature = fs.readFileSync(path.join(root, 'feat_mls_record_backup.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Could not locate ${start}`);
  return source.slice(a, b);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeStream(label) {
  const tracks = [0, 1].map((index) => ({
    stopCalls: 0,
    stop() { this.stopCalls += 1; }
  }));
  return {
    label,
    tracks,
    getTracks() { return tracks; },
    stopped() { return tracks.every((track) => track.stopCalls === 1); }
  };
}

function makeHarness(startResults) {
  const micRequests = [];
  const recorders = [];

  class FakeMediaRecorder {
    constructor(mediaStream) {
      this.stream = mediaStream;
      this.mimeType = 'audio/webm';
      this.state = 'inactive';
      this.startCalls = 0;
      this.stopCalls = 0;
      recorders.push(this);
    }
    start() {
      this.startCalls += 1;
      this.state = 'recording';
    }
    stop() {
      this.stopCalls += 1;
      this.state = 'inactive';
    }
  }
  FakeMediaRecorder.isTypeSupported = () => true;

  const context = {
    console,
    Date,
    Math,
    Promise,
    JSON,
    Object,
    String,
    Array,
    MediaRecorder: FakeMediaRecorder,
    navigator: {
      mediaDevices: {
        getUserMedia() {
          const request = deferred();
          micRequests.push(request);
          return request.promise;
        }
      }
    },
    document: { getElementById: () => null },
    indexedDB: { open() { throw new Error('IndexedDB disabled in lifecycle harness'); } },
    IDBKeyRange: { bound() { return null; } },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout(fn) { fn(); return 1; },
    clearTimeout: () => {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`
    var __baseStartResults = [];
    var __baseStarts = 0;
    var __baseStops = 0;
    function startCapture() {
      __baseStarts += 1;
      return __baseStartResults.length ? __baseStartResults.shift() : true;
    }
    function stopCapture() { __baseStops += 1; return true; }
    function newVisit() { return stopCapture(); }
    function switchPatient() { return stopCapture(); }
  `, context);
  context.__baseStartResults = (startResults || []).slice();
  vm.runInContext(feature, context, { filename: 'feat_mls_record_backup.js' });

  return { context, micRequests, recorders };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

async function staleAfter(operation) {
  const h = makeHarness([true]);
  assert.strictEqual(h.context.startCapture(), true);
  assert.strictEqual(h.micRequests.length, 1);
  const staleStream = makeStream(operation);
  h.context[operation]();
  h.micRequests[0].resolve(staleStream);
  await settle();
  assert(staleStream.stopped(), `${operation} did not stop every track on its stale stream`);
  assert.strictEqual(h.recorders.length, 0, `${operation} constructed a recorder from a stale stream`);
}

(async () => {
  const newVisitSource = between(app, 'function newVisit(opts)', 'function noteRecordFromState(markSigned)');
  assert(newVisitSource.includes('if(capturing) stopCapture();'), 'New Visit no longer stops active desktop capture');
  const patientSwitchSource = between(app, 'function _athenaHandleActivePatientChange(previousId,nextId)', 'function _athenaMarkBoundEdit(fieldId)');
  assert(patientSwitchSource.includes("capturing&&typeof stopCapture==='function')stopCapture()"), 'patient switch no longer stops active desktop capture');

  await staleAfter('stopCapture');
  await staleAfter('newVisit');
  await staleAfter('switchPatient');

  const failed = makeHarness([false]);
  assert.strictEqual(failed.context.startCapture(), false);
  assert.strictEqual(failed.micRequests.length, 0, 'a failed base start requested the backup microphone');
  assert.strictEqual(failed.recorders.length, 0, 'a failed base start created a backup recorder');

  const failedSecond = makeHarness([true, false]);
  assert.strictEqual(failedSecond.context.startCapture(), true);
  assert.strictEqual(failedSecond.micRequests.length, 1);
  assert.strictEqual(failedSecond.context.startCapture(), false);
  const staleFromFirstStart = makeStream('failed-second-start');
  failedSecond.micRequests[0].resolve(staleFromFirstStart);
  await settle();
  assert(staleFromFirstStart.stopped(), 'a failed second base start did not invalidate the first pending stream');
  assert.strictEqual(failedSecond.recorders.length, 0, 'a failed second base start allowed the old request to create a recorder');

  const rapid = makeHarness([true, true]);
  assert.strictEqual(rapid.context.startCapture(), true);
  assert.strictEqual(rapid.context.startCapture(), true);
  assert.strictEqual(rapid.micRequests.length, 2, 'rapid starts did not create distinct request epochs');
  const firstStream = makeStream('rapid-first');
  const ownerStream = makeStream('rapid-owner');
  rapid.micRequests[0].resolve(firstStream);
  await settle();
  assert(firstStream.stopped(), 'the superseded rapid-start stream remained open');
  assert.strictEqual(rapid.recorders.length, 0, 'the superseded rapid-start stream constructed a recorder');
  rapid.micRequests[1].resolve(ownerStream);
  await settle();
  assert.strictEqual(rapid.recorders.length, 1, 'the current successful start did not own exactly one recorder');
  assert.strictEqual(rapid.recorders[0].startCalls, 1, 'the owning recorder did not start exactly once');
  assert.strictEqual(rapid.recorders[0].stream, ownerStream, 'the recorder was attached to the wrong request stream');
  assert.strictEqual(ownerStream.stopped(), false, 'the current owner stream was stopped before capture ended');
  rapid.context.stopCapture();
  assert.strictEqual(rapid.recorders[0].stopCalls, 1, 'Stop did not stop the owning recorder exactly once');
  assert(ownerStream.stopped(), 'Stop did not close every track on the owning stream');

  console.log('PASS recording backup lifecycle: stale mic requests cannot outlive Stop/New Visit/patient switch/base failure/rapid restart');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

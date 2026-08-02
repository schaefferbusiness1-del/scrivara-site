'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const importerSource = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function extractIife(source, marker) {
  const markerAt = source.indexOf(marker);
  assert(markerAt >= 0, `missing marker: ${marker}`);
  const start = source.indexOf('(function ()', markerAt);
  const end = source.indexOf('\n})();', start);
  assert(start >= 0 && end > start, `missing IIFE after: ${marker}`);
  return source.slice(start, end + '\n})();'.length);
}

class FakeBlob { constructor(parts) { this.parts = parts; } }
class FakeWorker {
  static instances = [];
  constructor() { this.messages = []; this.onmessage = null; FakeWorker.instances.push(this); }
  postMessage(message) { this.messages.push(message); }
  fireFirstArm() {
    const arm = this.messages.find(message => message.action === 'arm');
    assert(arm, 'Worker deadline was never armed');
    this.onmessage({ data: { id: arm.id } });
  }
  terminate() {}
}

function testContentDeadlineAndLateReply() {
  FakeWorker.instances.length = 0;
  const pageListeners = [], runtimeListeners = [], sent = [], posted = [], callbacks = {};
  class RuntimeURL extends URL {}
  RuntimeURL.createObjectURL = () => 'blob:deadline-worker';
  RuntimeURL.revokeObjectURL = () => {};
  const context = {
    console, Date, Object, String, Number, isFinite, URL: RuntimeURL,
    Blob: FakeBlob, Worker: FakeWorker,
    setTimeout() { throw new Error('page timer must not be needed when Worker is available'); },
    clearTimeout() {},
    window: {
      __mlsAllVisitsBridge: 0,
      addEventListener(type, fn) { if (type === 'message') pageListeners.push(fn); },
      postMessage(message, origin) { posted.push({ message, origin }); }
    },
    chrome: {
      runtime: {
        id: 'mls-test-extension', /* csr-1.x orphan guards treat a runtime without an id as a dead context and go silent */
        lastError: null,
        sendMessage(message, callback) { sent.push(message); callbacks[message.requestId] = callback; },
        onMessage: { addListener(fn) { runtimeListeners.push(fn); } }
      }
    }
  };
  vm.runInNewContext(extractIife(contentSource, '/* === MLS Assist v1.35'), context, { filename: 'content-history-deadline.js' });
  const deadlineAt = Date.now() + 60000;
  const requestId = 'history-correlated-1';
  pageListeners[0]({
    origin: 'https://mlsscribe.com',
    data: { source: 'mls-app', type: 'mlsAppReadAllVisits', id: requestId, requestId, deadlineAt, managed: true, hint: { name: 'Exact Patient' } }
  });
  assert.strictEqual(sent.length, 1, 'history request was not relayed');
  assert.strictEqual(sent[0].requestId, requestId);
  assert.strictEqual(sent[0].deadlineAt, deadlineAt, 'absolute deadline was not forwarded');
  assert.strictEqual(FakeWorker.instances.length, 1, 'content bridge did not create its dedicated deadline Worker');

  FakeWorker.instances[0].fireFirstArm();
  const results = posted.map(item => item.message).filter(message => message.type === 'mlsAppAllVisitsResult');
  assert.strictEqual(results.length, 1, 'deadline must emit exactly one terminal result');
  assert.strictEqual(results[0].requestId, requestId);
  assert.strictEqual(results[0].reason, 'content-deadline-exceeded');
  assert.strictEqual(results[0].ok, false);

  callbacks[requestId]({ ok: true, visits: [{ sourceVisitKey: 'late' }] });
  const afterLate = posted.map(item => item.message).filter(message => message.type === 'mlsAppAllVisitsResult');
  assert.strictEqual(afterLate.length, 1, 'late background result escaped after the correlated deadline');
  for (const listener of runtimeListeners) listener({ type: 'mlsAppVisitsProgress', requestId, message: 'late progress' });
  assert.strictEqual(posted.map(item => item.message).filter(message => message.type === 'mlsAppVisitsProgress' && message.message === 'late progress').length, 0, 'late progress escaped after settlement');
}

function testContentWorkerPostFailurePreservesAbsoluteDeadlines() {
  class ThrowOnSecondArmWorker extends FakeWorker {
    constructor() { super(); this.armCount = 0; }
    postMessage(message) {
      if (message.action === 'arm' && ++this.armCount === 2) throw new Error('worker channel failed');
      this.messages.push(message);
    }
  }
  class RuntimeURL extends URL {}
  RuntimeURL.createObjectURL = () => 'blob:deadline-worker-failure';
  RuntimeURL.revokeObjectURL = () => {};
  const pageListeners = [], posted = [], sent = [], fallbackTimers = [];
  const context = {
    console, Date, Object, String, Number, isFinite, URL: RuntimeURL,
    Blob: FakeBlob, Worker: ThrowOnSecondArmWorker,
    setTimeout(fn, delay) { fallbackTimers.push({ fn, delay, cleared: false }); return fallbackTimers.length; },
    clearTimeout(id) { if (fallbackTimers[id - 1]) fallbackTimers[id - 1].cleared = true; },
    window: {
      __mlsAllVisitsBridge: 0,
      addEventListener(type, fn) { if (type === 'message') pageListeners.push(fn); },
      postMessage(message, origin) { posted.push({ message, origin }); }
    },
    chrome: {
      runtime: {
        id: 'mls-test-extension', /* csr-1.x orphan guards treat a runtime without an id as a dead context and go silent */
        lastError: null,
        sendMessage(message) { sent.push(message); },
        onMessage: { addListener() {} }
      }
    }
  };
  vm.runInNewContext(extractIife(contentSource, '/* === MLS Assist v1.35'), context, { filename: 'content-history-worker-failure.js' });
  const deadlineAt = Date.now() + 60000;
  for (const id of ['armed-before-worker-failure', 'trigger-worker-failure']) {
    pageListeners[0]({ origin: 'https://mlsscribe.com', data: { source: 'mls-app', type: 'mlsAppReadAllVisits', id, requestId: id, deadlineAt, hint: { name: 'Exact Patient' } } });
  }
  assert.strictEqual(sent.length, 2, 'a future-deadline Worker failure blocked a safely re-armed request');
  assert.strictEqual(posted.filter(item => item.message.type === 'mlsAppAllVisitsResult').length, 0, 'Worker failure fired a request deadline early');
  assert.strictEqual(fallbackTimers.length, 2, 'every live Worker arm was not moved to a window timer');
  assert(fallbackTimers.every(timer => timer.delay > 50000 && timer.delay <= 60000), 'fallback timers reset or extended the original absolute deadline');
  for (const timer of fallbackTimers) timer.fn();
  const terminal = posted.map(item => item.message).filter(message => message.type === 'mlsAppAllVisitsResult');
  assert.deepStrictEqual(terminal.map(message => message.requestId).sort(), ['armed-before-worker-failure', 'trigger-worker-failure']);
  assert(terminal.every(message => message.reason === 'content-deadline-exceeded' && message.ok === false), 're-armed deadlines did not settle exactly once');
}

function testContentAsyncWorkerFailurePreservesDeadline() {
  class RuntimeURL extends URL {}
  RuntimeURL.createObjectURL = () => 'blob:deadline-worker-async-failure';
  RuntimeURL.revokeObjectURL = () => {};
  FakeWorker.instances.length = 0;
  const pageListeners = [], posted = [], sent = [], fallbackTimers = [];
  const context = {
    console, Date, Object, String, Number, isFinite, URL: RuntimeURL,
    Blob: FakeBlob, Worker: FakeWorker,
    setTimeout(fn, delay) { fallbackTimers.push({ fn, delay }); return fallbackTimers.length; },
    clearTimeout() {},
    window: {
      __mlsAllVisitsBridge: 0,
      addEventListener(type, fn) { if (type === 'message') pageListeners.push(fn); },
      postMessage(message, origin) { posted.push({ message, origin }); }
    },
    chrome: {
      runtime: {
        id: 'mls-test-extension', /* csr-1.x orphan guards treat a runtime without an id as a dead context and go silent */
        lastError: null,
        sendMessage(message) { sent.push(message); },
        onMessage: { addListener() {} }
      }
    }
  };
  vm.runInNewContext(extractIife(contentSource, '/* === MLS Assist v1.35'), context, { filename: 'content-history-worker-async-failure.js' });
  const deadlineAt = Date.now() + 60000;
  pageListeners[0]({ origin: 'https://mlsscribe.com', data: { source: 'mls-app', type: 'mlsAppReadAllVisits', id: 'async-worker-failure', requestId: 'async-worker-failure', deadlineAt, hint: { name: 'Exact Patient' } } });
  assert.strictEqual(sent.length, 1);
  FakeWorker.instances[0].onerror(new Error('worker loop failed'));
  assert.strictEqual(posted.filter(item => item.message.type === 'mlsAppAllVisitsResult').length, 0, 'async Worker error fired the deadline early');
  assert.strictEqual(fallbackTimers.length, 1, 'async Worker error did not preserve its pending arm');
  assert(fallbackTimers[0].delay > 50000 && fallbackTimers[0].delay <= 60000, 'async fallback extended the immutable deadline');
  fallbackTimers[0].fn();
  assert.strictEqual(posted.filter(item => item.message.type === 'mlsAppAllVisitsResult').length, 1);
}

function testContentTerminalArmDoesNotDispatch() {
  class AlwaysThrowWorker extends FakeWorker {
    postMessage(message) { if (message.action === 'arm') throw new Error('worker failed'); this.messages.push(message); }
  }
  class RuntimeURL extends URL {}
  RuntimeURL.createObjectURL = () => 'blob:deadline-worker-terminal';
  RuntimeURL.revokeObjectURL = () => {};
  const pageListeners = [], posted = [], sent = [];
  const context = {
    console, Date, Object, String, Number, isFinite, URL: RuntimeURL,
    Blob: FakeBlob, Worker: AlwaysThrowWorker,
    setTimeout() { throw new Error('window timer failed'); }, clearTimeout() {},
    window: {
      __mlsAllVisitsBridge: 0,
      addEventListener(type, fn) { if (type === 'message') pageListeners.push(fn); },
      postMessage(message, origin) { posted.push({ message, origin }); }
    },
    chrome: {
      runtime: {
        id: 'mls-test-extension', /* csr-1.x orphan guards treat a runtime without an id as a dead context and go silent */
        lastError: null,
        sendMessage(message) { sent.push(message); },
        onMessage: { addListener() {} }
      }
    }
  };
  vm.runInNewContext(extractIife(contentSource, '/* === MLS Assist v1.35'), context, { filename: 'content-history-worker-terminal.js' });
  const requestId = 'terminal-before-dispatch';
  pageListeners[0]({ origin: 'https://mlsscribe.com', data: { source: 'mls-app', type: 'mlsAppReadAllVisits', id: requestId, requestId, deadlineAt: Date.now() + 60000, hint: { name: 'Exact Patient' } } });
  const terminal = posted.map(item => item.message).filter(message => message.type === 'mlsAppAllVisitsResult');
  assert.strictEqual(terminal.length, 1, 'unarmable request did not fail exactly once');
  assert.strictEqual(terminal[0].requestId, requestId);
  assert.strictEqual(sent.length, 0, 'stateful history request dispatched after its deadline arm was already terminal');
  assert.strictEqual(posted.filter(item => item.message.type === 'mlsAppVisitsProgress').length, 0, 'acceptance progress escaped after terminal arm failure');
}

function testImporterSchedulerWorkerFailureFallback() {
  const start = importerSource.indexOf('function makeAbsoluteDeadlineScheduler()');
  const end = importerSource.indexOf('\n  var absoluteDeadlines = makeAbsoluteDeadlineScheduler();', start);
  assert(start >= 0 && end > start, 'could not extract importer deadline scheduler');
  const schedulerSource = importerSource.slice(start, end);
  class ThrowWorker extends FakeWorker { postMessage(message) { if (message.action === 'arm') throw new Error('worker channel failed'); this.messages.push(message); } }
  class RuntimeURL {}
  RuntimeURL.createObjectURL = () => 'blob:importer-worker-failure';
  RuntimeURL.revokeObjectURL = () => {};
  const fallbackTimers = [];
  const context = {
    Date, Object, Number, String, isFinite, Blob: FakeBlob, Worker: ThrowWorker, URL: RuntimeURL,
    window: { URL: RuntimeURL }, isFn: value => typeof value === 'function',
    setTimeout(fn, delay) { fallbackTimers.push({ fn, delay }); return fallbackTimers.length; }, clearTimeout() {}
  };
  vm.runInNewContext(`${schedulerSource}\nthis.scheduler = makeAbsoluteDeadlineScheduler();`, context, { filename: 'importer-deadline-scheduler.js' });
  let fired = 0;
  const cancel = context.scheduler.arm(Date.now() + 60000, () => { fired++; });
  assert.strictEqual(fired, 0, 'importer Worker failure fired a future deadline early');
  assert.strictEqual(cancel.isTerminal(), false, 're-armed importer deadline was reported terminal');
  assert.strictEqual(fallbackTimers.length, 1);
  assert(fallbackTimers[0].delay > 50000 && fallbackTimers[0].delay <= 60000, 'importer fallback reset the absolute deadline');
  fallbackTimers[0].fn();
  assert.strictEqual(fired, 1);
  assert.strictEqual(cancel.isTerminal(), true);

  const terminalContext = {
    Date, Object, Number, String, isFinite, Blob: FakeBlob, Worker: ThrowWorker, URL: RuntimeURL,
    window: { URL: RuntimeURL }, isFn: value => typeof value === 'function',
    setTimeout() { throw new Error('window timer failed'); }, clearTimeout() {}
  };
  vm.runInNewContext(`${schedulerSource}\nthis.scheduler = makeAbsoluteDeadlineScheduler();`, terminalContext, { filename: 'importer-deadline-scheduler-terminal.js' });
  let terminalFired = 0;
  const terminalCancel = terminalContext.scheduler.arm(Date.now() + 60000, () => { terminalFired++; });
  assert.strictEqual(terminalFired, 1, 'unarmable importer deadline did not fail closed');
  assert.strictEqual(terminalCancel.isTerminal(), true, 'importer arm did not report synchronous terminal state');
  const bridgeStart = importerSource.indexOf('function bridge(type, reqType, timeoutMs, payload)');
  const bridgeEnd = importerSource.indexOf('\n  /* ---- exact-patient history', bridgeStart);
  const bridge = importerSource.slice(bridgeStart, bridgeEnd);
  assert(bridge.indexOf('cancelDeadline.isTerminal()') < bridge.indexOf('window.postMessage(msg, "*")'), 'importer bridge can dispatch after a terminal deadline arm');
}

async function testStarvedPageTimerBatchResetsBusy() {
  class ImmediateWorker extends FakeWorker {
    postMessage(message) {
      this.messages.push(message);
      if (message.action === 'arm') queueMicrotask(() => this.onmessage && this.onmessage({ data: { id: message.id } }));
    }
  }
  class RuntimeURL {}
  RuntimeURL.createObjectURL = () => 'blob:importer-deadline-worker';
  RuntimeURL.revokeObjectURL = () => {};
  const patients = [
    { id: 'p1', name: 'Patient One', dob: '01/01/1960' },
    { id: 'p2', name: 'Patient Two', dob: '02/02/1960' }
  ];
  let pageTimerCalls = 0;
  const context = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp, encodeURIComponent, isFinite,
    Blob: FakeBlob, Worker: ImmediateWorker, URL: RuntimeURL, AbortController, queueMicrotask,
    setTimeout() { pageTimerCalls++; return 1; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {},
    location: { pathname: '/ScribeFlow-staging.html' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      readyState: 'complete', querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
      addEventListener() {}, body: {}, head: {}, documentElement: {}
    },
    getPatients: () => patients,
    _athenaHistoryTargetSnapshot(ref) {
      const patient = patients.find(item => item.id === ref.patientId);
      return patient ? { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: '' } : null;
    },
    _assistReadChart() { return new Promise(() => {}); },
    renderHistory() {}, renderProfile() {}, loadPatients() {}
  };
  context.window = context;
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  context.postMessage = () => {};
  vm.runInNewContext(importerSource, context, { filename: 'schedule-history-deadline.js', timeout: 1000 });
  const rows = patients.map(patient => ({ patient_external_id: patient.id, _mlsTargetPatientId: patient.id, _mlsTargetDob: patient.dob, name: patient.name, dob: patient.dob }));
  const first = await context.__mlsSI._runHistoryBatch(rows, [], () => {});
  assert.strictEqual(first.complete, false);
  assert.strictEqual(first.timedOut, true);
  assert.strictEqual(first.processed, 1, 'timed-out current patient must be recorded before stopping');
  assert.strictEqual(first.retry.length, 2, 'current and remaining patients must both be retryable');
  assert(/deadline/.test(first.retry[0].reason), 'current patient did not retain the deadline reason');
  assert.strictEqual(first.retry[1].reason, 'deferred-after-timeout');

  const second = await context.__mlsSI._runHistoryBatch([rows[0]], [], () => {});
  assert.notStrictEqual(second.reason, 'history-batch-busy', 'deadline did not reset the managed batch busy state');
  assert.strictEqual(second.timedOut, true);
  assert.strictEqual(pageTimerCalls, 0, 'starved page timers were used even though the Worker deadline was available');
  assert.strictEqual(context.__mlsSI._deadlineScheduler.workerBacked(), true);
}

(async () => {
  assert(importerSource.includes('navigator.locks.request("mls-managed-athena-pull"'), 'managed pull does not hold one Web Lock for its lifetime');
  assert(importerSource.includes('ifAvailable: true'), 'Web Lock could queue an automatic later pull');
  assert(importerSource.includes('catch (e) { failWorker(); }'), 'importer Worker post failure does not settle every pending deadline');
  testContentDeadlineAndLateReply();
  testContentWorkerPostFailurePreservesAbsoluteDeadlines();
  testContentAsyncWorkerFailurePreservesDeadline();
  testContentTerminalArmDoesNotDispatch();
  testImporterSchedulerWorkerFailureFallback();
  await testStarvedPageTimerBatchResetsBusy();
  console.log('PASS Worker-backed absolute history deadlines, late-result suppression, and busy reset');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});

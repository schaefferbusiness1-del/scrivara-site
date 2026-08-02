'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const visitsSource = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing start marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

const copySource = between(
  visitsSource,
  '/* ----------------------------------------------------------------------------\n * 3) COPY EVERY VISIT',
  '/* ----------------------------------------------------------------------------\n * 4) WIRE THE GRAB'
);

function makeCopyRuntime() {
  const listeners = new Set();
  const requests = [];
  const document = {
    readyState: 'loading',
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; },
    createElement() { return {}; },
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Uint32Array,
    document, setTimeout, clearTimeout,
    setInterval() { return 1; }, clearInterval() {},
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn); },
    postMessage(message) { requests.push(message); }
  };
  context.window = context;
  vm.runInNewContext(copySource, context, { filename: 'copy-visits-correlation.js' });
  return {
    api: context.__mlsCopyVisits,
    requests,
    listeners,
    dispatch(data) { for (const fn of [...listeners]) fn({ data }); }
  };
}

async function testPageDriverCorrelation() {
  const rt = makeCopyRuntime();
  const statusesA = [], statusesB = [];
  let settledA = false, settledB = false;
  const a = rt.api._driveRequest(
    'mlsAppReadAllVisits', { requestId: 'caller-supplied-stale-id' },
    'mlsAppAllVisitsResult', ['mlsAppVisitsProgress'],
    message => statusesA.push(message), null, 2000, 200
  ).then(value => { settledA = true; return value; });
  const b = rt.api._driveRequest(
    'mlsAppReadAllVisits', {},
    'mlsAppAllVisitsResult', ['mlsAppVisitsProgress'],
    message => statusesB.push(message), null, 2000, 200
  ).then(value => { settledB = true; return value; });

  assert.strictEqual(rt.requests.length, 2, 'two requests were not posted');
  const idA = rt.requests[0].requestId;
  const idB = rt.requests[1].requestId;
  assert(/^mlscv-readallvisits-/.test(idA), 'request A did not receive a generated correlation id');
  assert(/^mlscv-readallvisits-/.test(idB), 'request B did not receive a generated correlation id');
  assert.notStrictEqual(idA, idB, 'consecutive history requests reused a correlation id');
  assert.strictEqual(rt.requests[0].id, idA, 'id/requestId transport aliases diverged');
  assert.notStrictEqual(idA, 'caller-supplied-stale-id', 'caller payload overrode the unique transport id');

  rt.dispatch({ source: 'mls-ext', type: 'mlsAppVisitsProgress', id: idA, requestId: idA, message: 'A progress' });
  rt.dispatch({ source: 'mls-ext', type: 'mlsAppVisitsProgress', id: 'old-request', requestId: 'old-request', message: 'stale progress' });
  assert.deepStrictEqual(statusesA, ['A progress']);
  assert.deepStrictEqual(statusesB, [], 'mismatched progress engaged the wrong request');

  rt.dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'old-request', requestId: 'old-request', ok: false, error: 'Extension context invalidated.' });
  await Promise.resolve();
  assert.strictEqual(settledA, false, 'stale result finished request A');
  assert.strictEqual(settledB, false, 'stale result finished request B');

  rt.dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: idA, requestId: idA, ok: true, visits: ['A'] });
  const resultA = await a;
  assert.deepStrictEqual(resultA.visits, ['A']);
  assert.strictEqual(settledB, false, 'request A result finished request B');

  /* This is the live failure signature: an older callback arrives after the
     next run has started. It must be ignored even though type/error match. */
  rt.dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: idA, requestId: idA, ok: false, error: 'Extension context invalidated.' });
  rt.dispatch({ source: 'mls-ext', type: 'mlsAppVisitsProgress', id: idA, requestId: idA, message: 'late A progress' });
  await Promise.resolve();
  assert.strictEqual(settledB, false, 'late prior-run traffic finished the current run');
  assert.deepStrictEqual(statusesB, [], 'late prior-run progress reached the current status');

  rt.dispatch({ source: 'mls-ext', type: 'mlsAppVisitsProgress', id: idB, requestId: idB, message: 'B progress' });
  rt.dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: idB, requestId: idB, ok: true, visits: ['B'] });
  const resultB = await b;
  assert.deepStrictEqual(resultB.visits, ['B']);
  assert.deepStrictEqual(statusesB, ['B progress']);
  assert.strictEqual(rt.listeners.size, 0, 'settled request listeners were not cleaned up');
}

async function testManualRetryLinkage() {
  const rt = makeCopyRuntime();
  const lifecycle = { manual: true, action: 'patient-history', patientId: 'patient-exact-1' };
  const first = rt.api._driveRequest(
    'mlsAppReadAllVisits', { hint: { name: 'Exact Patient' } },
    'mlsAppAllVisitsResult', ['mlsAppVisitsProgress'], null, null, 2000, 200, lifecycle
  ).then(() => null, error => error);
  const idA = rt.requests[0].requestId;
  assert.strictEqual(rt.requests[0].retryOf, undefined, 'first manual pull was incorrectly labeled as a retry');
  rt.dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: idA, requestId: idA, ok: false, error: 'visit-bodies-incomplete' });
  const firstError = await first;
  assert(firstError && firstError.requestId === idA, 'failed manual pull did not retain its transport id');

  const second = rt.api._driveRequest(
    'mlsAppReadAllVisits', { hint: { name: 'Exact Patient' } },
    'mlsAppAllVisitsResult', ['mlsAppVisitsProgress'], null, null, 2000, 200, lifecycle
  );
  const requestB = rt.requests[1];
  assert.notStrictEqual(requestB.requestId, idA, 'manual retry reused the failed transport id');
  assert.strictEqual(requestB.retryOf, idA, 'manual retry did not link to the failed request');
  assert.strictEqual(requestB.parentRequestId, idA, 'manual retry omitted its parent request id');
  rt.dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: requestB.requestId, requestId: requestB.requestId, retryOf: idA, ok: true, visits: [] });
  await second;

  const third = rt.api._driveRequest(
    'mlsAppReadAllVisits', { hint: { name: 'Exact Patient' } },
    'mlsAppAllVisitsResult', ['mlsAppVisitsProgress'], null, null, 2000, 200, lifecycle
  );
  const requestC = rt.requests[2];
  assert.strictEqual(requestC.retryOf, undefined, 'successful retry left a stale retry parent active');
  rt.dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: requestC.requestId, requestId: requestC.requestId, ok: true, visits: [] });
  await third;
}

function extractAllVisitsContentBridge() {
  const marker = contentSource.indexOf('/* === MLS Assist v1.35 — Copy-every-visit bridge');
  assert(marker >= 0, 'copy-every-visit content bridge marker missing');
  const start = contentSource.indexOf('(function ()', marker);
  const end = contentSource.indexOf('\n})();', start);
  assert(start >= 0 && end > start, 'copy-every-visit content bridge IIFE missing');
  return contentSource.slice(start, end + '\n})();'.length);
}

function makeContentRuntime() {
  const pageListeners = [];
  const runtimeListeners = [];
  const sent = [];
  const posted = [];
  const callbacks = Object.create(null);
  const context = {
    console, Date, Object, String, URL, setTimeout, clearTimeout,
    location: { origin: 'https://mlsscribe.com' },
    window: {
      addEventListener(type, fn) { if (type === 'message') pageListeners.push(fn); },
      postMessage(message, origin) { posted.push({ message, origin }); }
    },
    chrome: {
      runtime: {
        id: 'mls-test-extension', /* csr-1.x orphan guards treat an id-less runtime as a dead context */
        lastError: null,
        sendMessage(message, callback) { sent.push(message); callbacks[message.requestId] = callback; },
        onMessage: { addListener(fn) { runtimeListeners.push(fn); } }
      }
    }
  };
  vm.runInNewContext(extractAllVisitsContentBridge(), context, { filename: 'content-all-visits-correlation.js' });
  return {
    sent, posted, callbacks,
    page(data) { for (const fn of pageListeners) fn({ data, origin: 'https://mlsscribe.com' }); },
    runtime(message) { for (const fn of runtimeListeners) fn(message); }
  };
}

function messages(rt, type) {
  return rt.posted.map(item => item.message).filter(message => message.type === type);
}

function testContentRelayCorrelation() {
  const rt = makeContentRuntime();
  rt.page({ source: 'mls-app', type: 'mlsAppReadAllVisits', id: 'request-a', requestId: 'request-a', hint: { name: 'Patient A' } });
  rt.page({ source: 'mls-app', type: 'mlsAppReadAllVisits', id: 'request-b', requestId: 'request-b', retryOf: 'request-a', parentRequestId: 'request-a', managed: true, background: true, initiator: 'batch', hint: { name: 'Patient B' } });
  assert.deepStrictEqual(rt.sent.map(message => message.requestId), ['request-a', 'request-b']);
  assert.deepStrictEqual(messages(rt, 'mlsAppVisitsProgress').map(message => message.requestId), ['request-a', 'request-b'], 'bridge acceptance was not correlated');
  assert(messages(rt, 'mlsAppVisitsProgress').every(message => !String(message.message || '').includes('â')), 'history acceptance message contains mojibake');
  assert.strictEqual(rt.sent[1].retryOf, 'request-a', 'content bridge dropped retry correlation before runtime');
  assert.strictEqual(rt.sent[1].managed, true, 'content bridge dropped managed-batch ownership');
  assert.strictEqual(rt.sent[1].background, true, 'content bridge dropped background-batch ownership');

  const beforeProgress = messages(rt, 'mlsAppVisitsProgress').length;
  rt.runtime({ type: 'mlsAppVisitsProgress', requestId: 'unknown-old', message: 'stale' });
  rt.runtime({ type: 'mlsAppVisitsProgress', message: 'uncorrelated' });
  assert.strictEqual(messages(rt, 'mlsAppVisitsProgress').length, beforeProgress, 'mismatched/blank runtime progress was forwarded');
  rt.runtime({ type: 'mlsAppVisitsProgress', requestId: 'request-a', message: 'A only' });
  const progress = messages(rt, 'mlsAppVisitsProgress').slice(-1)[0];
  assert.strictEqual(progress.requestId, 'request-a');
  assert.strictEqual(progress.id, 'request-a');

  rt.callbacks['request-a']({ ok: false, error: 'Extension context invalidated.' });
  const resultA = messages(rt, 'mlsAppAllVisitsResult').slice(-1)[0];
  assert.strictEqual(resultA.requestId, 'request-a', 'stale callback was relabeled as the newer request');
  assert.strictEqual(resultA.id, 'request-a');
  assert.strictEqual(resultA.error, 'Extension context invalidated.');

  const afterA = messages(rt, 'mlsAppVisitsProgress').length;
  rt.runtime({ type: 'mlsAppVisitsProgress', requestId: 'request-a', message: 'late A' });
  assert.strictEqual(messages(rt, 'mlsAppVisitsProgress').length, afterA, 'progress for a settled request was forwarded');

  rt.runtime({ type: 'mlsAppVisitsProgress', requestId: 'request-b', message: 'B still active' });
  assert.strictEqual(messages(rt, 'mlsAppVisitsProgress').slice(-1)[0].requestId, 'request-b');
  rt.callbacks['request-b']({ ok: true, visits: [{ date: '2026-07-14' }] });
  const resultB = messages(rt, 'mlsAppAllVisitsResult').slice(-1)[0];
  assert.strictEqual(resultB.requestId, 'request-b');
  assert.strictEqual(resultB.id, 'request-b');
  assert.strictEqual(resultB.ok, true);
  assert.strictEqual(resultB.retryOf, 'request-a', 'content bridge dropped retry correlation from the final result');
  assert.strictEqual(resultB.parentRequestId, 'request-a');
  assert.strictEqual(resultB.managed, true, 'content bridge dropped managed-batch ownership from the final result');
  assert.strictEqual(resultB.initiator, 'batch');

  const beforeSettledB = messages(rt, 'mlsAppVisitsProgress').length;
  rt.runtime({ type: 'mlsAppVisitsProgress', requestId: 'request-b', message: 'late B' });
  assert.strictEqual(messages(rt, 'mlsAppVisitsProgress').length, beforeSettledB, 'settled B retained progress ownership');
}

function testBackgroundRequestIdPlumbing() {
  const start = backgroundSource.indexOf('/* === MLS Assist visit-reader lineage (active: v2.9.22 r4)');
  const end = backgroundSource.indexOf('\n})();', start);
  assert(start >= 0 && end > start, 'all-visits background reader IIFE missing');
  const reader = backgroundSource.slice(start, end);
  assert(reader.includes('function runAllVisits(appTabId, hint, cfg, requestId, callerDeadlineAt)'), 'reader did not accept the frozen request id and caller deadline');
  assert(reader.includes("type: 'mlsAppVisitsProgress', requestId: String(requestId || '').slice(0, 100)"), 'background progress omitted request correlation');
  assert(reader.includes('var frozenRequestId = String(requestId || \'\').slice(0, 100)'), 'request id was not frozen at read start');
  assert(reader.includes('var transportRequestId = String(msg.requestId || \'\').slice(0, 100)'), 'runtime request id was not frozen at bridge entry');
  assert(reader.includes('runAllVisits(appTabId, msg.hint || {}, cfg, transportRequestId, msg.deadlineAt)'), 'runtime request id and caller deadline were not threaded into the reader');
  const emitLines = reader.split(/\r?\n/).filter(line => line.includes('emit(appTabId'));
  assert(emitLines.length >= 5, 'expected all visit progress milestones were not found');
  assert(emitLines.every(line => line.includes('frozenRequestId')), 'one or more reader progress milestones is uncorrelated');
}

(async () => {
  await testPageDriverCorrelation();
  await testManualRetryLinkage();
  testContentRelayCorrelation();
  testBackgroundRequestIdPlumbing();
  console.log('PASS visit request correlation runtime');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_cohort_visits.js'), 'utf8');

function makeRuntime(copyVisits) {
  const listeners = new Set();
  const requests = [];
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document: {
      getElementById() { return null; },
      querySelector() { return null; },
      createElement() { return { style: {}, appendChild() {} }; }
    },
    setTimeout, clearTimeout,
    setInterval() { return 1; }, clearInterval() {},
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn); },
    postMessage(message) { requests.push(message); }
  };
  context.window = context;
  if (copyVisits) context.__mlsCopyVisits = copyVisits;
  vm.runInNewContext(source, context, { filename: 'cohort-request-correlation.js', timeout: 1000 });
  return {
    api: context.__mlsCohortVisits,
    requests,
    listeners,
    dispatch(data) { for (const fn of [...listeners]) fn({ data }); }
  };
}

async function testPrimaryBridgeOwnership() {
  const calls = [];
  const rt = makeRuntime({
    _driveRequest() {
      calls.push([...arguments]);
      return Promise.resolve({ ok: true, visits: [] });
    }
  });
  await rt.api._readAllVisits({ name: 'Exact Patient' }, () => {});
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'mlsAppReadAllVisits');
  assert.strictEqual(calls[0][1].managed, true, 'cohort history read was not marked managed');
  assert.strictEqual(calls[0][1].background, true, 'cohort history read was not marked background');
  assert.strictEqual(calls[0][1].initiator, 'batch', 'cohort history read omitted batch ownership');
}

async function testFallbackCorrelation() {
  const rt = makeRuntime(null);
  const statusA = [], statusB = [];
  let settledB = false;
  const a = rt.api._readAllVisits({ name: 'Patient A' }, message => statusA.push(message));
  const b = rt.api._readAllVisits({ name: 'Patient B' }, message => statusB.push(message)).then(value => { settledB = true; return value; });

  assert.strictEqual(rt.requests.length, 2, 'fallback did not post both cohort requests');
  const idA = rt.requests[0].requestId;
  const idB = rt.requests[1].requestId;
  assert(/^mlscohort-/.test(idA) && /^mlscohort-/.test(idB), 'fallback omitted generated cohort request IDs');
  assert.notStrictEqual(idA, idB, 'concurrent cohort requests reused an ID');
  for (const request of rt.requests) {
    assert.strictEqual(request.id, request.requestId, 'cohort id aliases diverged');
    assert.strictEqual(request.managed, true);
    assert.strictEqual(request.background, true);
    assert.strictEqual(request.initiator, 'batch');
  }

  rt.dispatch({ source: 'mls-ext', type: 'mlsAppVisitsProgress', id: 'stale', requestId: 'stale', message: 'stale' });
  rt.dispatch({ source: 'wrong-source', type: 'mlsAppVisitsProgress', id: idA, requestId: idA, message: 'spoofed' });
  assert.deepStrictEqual(statusA, []);
  assert.deepStrictEqual(statusB, []);

  rt.dispatch({ source: 'mls-ext', type: 'mlsAppVisitsProgress', id: idA, requestId: idA, message: 'A only' });
  assert.deepStrictEqual(statusA, ['A only']);
  assert.deepStrictEqual(statusB, [], 'request A progress reached request B');

  rt.dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: idA, requestId: idA, ok: true, visits: ['A'] });
  const resultA = await a;
  assert.deepStrictEqual(resultA.visits, ['A']);
  assert.strictEqual(settledB, false, 'request A result finished request B');

  rt.dispatch({ source: 'mls-ext', type: 'mlsAppVisitsProgress', id: idA, requestId: idA, message: 'late A' });
  assert.deepStrictEqual(statusB, [], 'late request A progress reached request B');
  rt.dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: idB, requestId: idB, ok: true, visits: ['B'] });
  const resultB = await b;
  assert.deepStrictEqual(resultB.visits, ['B']);
  assert.strictEqual(rt.listeners.size, 0, 'settled cohort fallback listeners leaked');
}

(async () => {
  await testPrimaryBridgeOwnership();
  await testFallbackCorrelation();
  console.log('PASS cohort history requests use unique exact correlation and managed-batch ownership');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});

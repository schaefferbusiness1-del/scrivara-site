'use strict';

/* Runtime proof for the release-safe patient store. Normal saves remain
   synchronous and complete in the legacy ::patients key before returning.
   Managed chart pulls may opt into off-main-thread compression, but they still
   commit the same MLSZ1 bytes to that one key and never introduce a recovery
   sidecar or journal protocol. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function patientStoreBlock(file) {
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf('var __mlsLZ=(function(){');
  const end = html.indexOf('function getActivePtId', start);
  assert(start >= 0 && end > start, 'patient-store runtime block not found in ' + file);
  return html.slice(start, end);
}

const source = patientStoreBlock(path.join(root, 'ScribeFlow.html'));
const saveStart = source.indexOf('function savePatients(arr,__storageKey,__opts){');
const saveEnd = source.indexOf('var __mlsPtsBaseSavePatients=savePatients;', saveStart);
assert(saveStart >= 0 && saveEnd > saveStart, 'savePatients source was not found');
const saveSource = source.slice(saveStart, saveEnd);
const cooperativeStart = saveSource.indexOf('if(__opts&&__opts.cooperative===true){');
const syncEncode = saveSource.indexOf('var packed=_mlsPtsEncode(__json);');
assert(cooperativeStart >= 0 && syncEncode > cooperativeStart,
  'normal and cooperative patient-save branches are no longer explicit');
assert(saveSource.slice(cooperativeStart, syncEncode).includes('_mlsPtsEncodeAsync(__json)'),
  'managed cooperative saves lost off-main-thread encoding');
assert(!saveSource.slice(syncEncode).includes('_mlsPtsEncodeAsync('),
  'normal patient saves can unexpectedly enter the async worker path');
assert(source.includes("version:'pts-batch-1.1.0'") && source.includes('st.cooperative?__mlsPtsFlushBatchCooperative'),
  'managed-only cooperative batch routing was removed');
assert(source.includes('function compressVerifiedAsync(input)') && source.includes("packed='MLSZ1|'"),
  'cooperative worker no longer verifies and returns the legacy MLSZ1 format');

for (const retired of [
  'patient-store worker + durable patch journal',
  '__mlsPtsAsync',
  '__mlsPtsStageAsync',
  '__mlsPtsSyncCommit',
  '__mlsPatientStoreHasPending',
  '__mlsReadPatientStore',
  "key+'.pending-v1'",
  "key+'.commit-v1'"
]) assert(!source.includes(retired), 'retired patient-journal code remains: ' + retired);
assert(source.includes('window.__mlsPatientStoreBatch='), 'schedule-import patient batching was removed');

for (const file of ['mls-connect.js', 'feat_mls_store_cache.js', 'feat_mls_visitfix.js']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert(!text.includes('__mlsPatientStoreHasPending'), file + ' still delegates to the retired journal');
  assert(!text.includes('__mlsReadPatientStore'), file + ' still reads through the retired journal');
}

function makeStore(seed, fail) {
  const data = new Map(Object.entries(seed || {}));
  return {
    data,
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
    setItem(key, value) {
      key = String(key); value = String(value);
      if (fail && fail(key, value)) { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; }
      data.set(key, value);
    },
    removeItem(key) { data.delete(String(key)); },
    key(index) { return Array.from(data.keys())[index] || null; },
    get length() { return data.size; }
  };
}

function makeHarness(store, globals) {
  let account = 'alpha@example.test';
  let timerId = 0;
  const timers = new Map();
  const listeners = new Map();
  const toasts = [];
  const context = {
    console, localStorage: store, Date, JSON, Object, Array, String, Number, Math, Map, Set,
    uns: suffix => 'sf_u::' + account + '::' + suffix,
    backendMode: () => false, bkToken: () => '', syncPatientToServer: () => {},
    toast: message => toasts.push(String(message)),
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class { constructor(type) { this.type = type; } }
  };
  Object.assign(context, globals || {});
  context.window = context;
  context.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  context.dispatchEvent = event => {
    for (const fn of listeners.get(event.type) || []) fn(event);
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'ScribeFlow.patient-store-sync.js' });
  return {
    context, timers, toasts,
    dispatch(type, detail) { context.dispatchEvent(new context.CustomEvent(type, { detail })); },
    account(value) { if (arguments.length) account = value; return account; }
  };
}

function bigPatients() {
  const rows = [];
  for (let i = 0; i < 260; i++) {
    rows.push({ id: 'p-' + i, name: 'Synthetic ' + i, dob: '01/01/1970', summary: ('clinical synthetic row ' + i + ' ').repeat(52), visits: [] });
  }
  assert(JSON.stringify(rows).length > 200000, 'fixture must exercise MLSZ1 compression');
  return rows;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function pkey(account) { return 'sf_u::' + account + '::patients'; }
function pendingKey(account) { return pkey(account) + '.pending-v1'; }
function commitKey(account) { return pkey(account) + '.commit-v1'; }
function decoded(harness, store, account) {
  return JSON.parse(harness.context.__mlsPtsDecode(store.getItem(pkey(account))));
}
function stageBatchRow(harness, token, row) {
  const state = harness.context.__mlsPtsBatchByKey[token.key];
  const index = state.arr.findIndex(patient => patient.id === row.id);
  assert(index >= 0, 'batch fixture patient was not found');
  state.arr[index] = row;
  state.dirty = true;
  state.totalChanges++;
  state.changesSinceFlush++;
  state.flushEpoch++;
  state.dirtySince = Date.now();
  state.dirtyIds[row.id] = 1;
  state.uniqueSinceFlush++;
  if (state.cooperative) state.syncIds[row.id] = 1;
}

// Large normal saves are complete in the rollback-compatible key before return.
{
  const base = bigPatients();
  const store = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base) });
  const harness = makeHarness(store);
  const next = clone(base); next[7].summary += ' acknowledged synchronously';
  assert.strictEqual(harness.context.savePatients(next), undefined, 'normal save became asynchronous');
  const raw = store.getItem(pkey('alpha@example.test'));
  assert(raw.startsWith('MLSZ1|'), 'large normal save did not use the legacy MLSZ1 format');
  assert.deepStrictEqual(decoded(harness, store, 'alpha@example.test'), next, 'normal save returned before the exact roster was durable');
  assert.strictEqual(store.getItem(pendingKey('alpha@example.test')), null, 'normal writer created a pending sidecar');
  assert.strictEqual(store.getItem(commitKey('alpha@example.test')), null, 'normal writer created a commit marker');
  const reloaded = makeHarness(store);
  assert.strictEqual(JSON.stringify(reloaded.context.getPatients()), JSON.stringify(next), 'cold reload lost the acknowledged normal save');
}

// Opaque sidecars from an unreleased historical build remain inert.
{
  const base = bigPatients();
  const pending = '{"magic":"MLSPJ1","opaque":"stale"}';
  const marker = '{"magic":"MLSPC1","opaque":"stale"}';
  const store = makeStore({
    [pkey('alpha@example.test')]: JSON.stringify(base),
    [pendingKey('alpha@example.test')]: pending,
    [commitKey('alpha@example.test')]: marker
  });
  const harness = makeHarness(store), next = clone(base); next[17].summary += ' after stale marker';
  harness.context.savePatients(next);
  assert.strictEqual(store.getItem(pendingKey('alpha@example.test')), pending, 'normal writer deleted an opaque pending sidecar');
  assert.strictEqual(store.getItem(commitKey('alpha@example.test')), marker, 'normal writer rewrote an opaque commit marker');
  const reloaded = makeHarness(store);
  assert.strictEqual(JSON.stringify(reloaded.context.getPatients()), JSON.stringify(next), 'stale marker masked the newer normal save');
  assert.strictEqual(reloaded.context.__mlsPatientStoreAsync, undefined, 'retired journal state machine is still reachable');
}

// Total localStorage failure remains loud; no false acknowledgement is allowed.
{
  const base = bigPatients();
  const store = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base) }, key => key === pkey('alpha@example.test'));
  const harness = makeHarness(store), next = clone(base); next[4].summary += ' cannot persist';
  assert.throws(() => harness.context.savePatients(next), /quota/i, 'total storage failure was silently accepted');
  assert(harness.toasts.some(text => /could not be saved/i.test(text)), 'total storage failure was not surfaced');
}

// Worker routing is opt-in: direct and ordinary managed saves stay synchronous;
// a cooperative managed pull uses the worker but still commits only the legacy
// patient key in the rollback-compatible MLSZ1 format.
(async function verifyManagedWorkerRouting() {
  const base = bigPatients();
  const store = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base) });
  let harness = null, workerStarts = 0, workerPosts = 0;
  class FakeWorker {
    constructor() { workerStarts++; }
    postMessage(message) {
      workerPosts++;
      Promise.resolve().then(() => this.onmessage({
        data: { id: message.id, packed: harness.context.__mlsPtsEncode(message.input) }
      }));
    }
    terminate() {}
  }
  harness = makeHarness(store, {
    Blob: class FakeBlob {},
    URL: { createObjectURL() { return 'blob:patient-codec-test'; } },
    Worker: FakeWorker
  });

  const direct = clone(base); direct[1].summary += ' direct synchronous save';
  assert.strictEqual(harness.context.savePatients(direct), undefined, 'normal save became asynchronous');
  assert.strictEqual(workerPosts, 0, 'normal save unexpectedly posted to the codec worker');

  const ordinary = harness.context.__mlsPatientStoreBatch.begin({ maxChanges: 12, maxDelayMs: 15000 });
  const ordinaryRow = clone(direct[2]); ordinaryRow.summary += ' ordinary managed save';
  stageBatchRow(harness, ordinary, ordinaryRow);
  const ordinaryEnd = harness.context.__mlsPatientStoreBatch.end(ordinary, 'ordinary-end');
  assert(!(ordinaryEnd && typeof ordinaryEnd.then === 'function'), 'ordinary managed batch unexpectedly became asynchronous');
  assert.strictEqual(workerPosts, 0, 'ordinary managed batch unexpectedly posted to the codec worker');

  const cooperative = harness.context.__mlsPatientStoreBatch.begin({ cooperative: true, maxChanges: 64, maxDelayMs: 15000 });
  const cooperativeRow = clone(ordinaryRow); cooperativeRow.summary += ' cooperative managed save';
  stageBatchRow(harness, cooperative, cooperativeRow);
  await harness.context.__mlsPatientStoreBatch.end(cooperative, 'cooperative-end');
  assert.strictEqual(workerStarts, 1, 'cooperative managed batch did not initialize exactly one codec worker');
  assert.strictEqual(workerPosts, 1, 'one cooperative flush did not produce exactly one worker encode');
  assert(decoded(harness, store, 'alpha@example.test').some(patient => patient.id === cooperativeRow.id && /cooperative managed save/.test(patient.summary)),
    'cooperative worker save was not durable in the legacy patient key');
  assert.strictEqual(store.getItem(pendingKey('alpha@example.test')), null, 'cooperative worker created a pending sidecar');
  assert.strictEqual(store.getItem(commitKey('alpha@example.test')), null, 'cooperative worker created a commit marker');

  console.log('PASS patient-store persistence: normal saves remain synchronous, cooperative worker routing is managed-only, same-key crash reads work, sidecars stay inert, and quota failure is loud');
})().catch(error => { console.error(error); process.exit(1); });

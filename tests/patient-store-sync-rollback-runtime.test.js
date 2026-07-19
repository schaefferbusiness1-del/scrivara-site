'use strict';

/* Runtime proof for the release-safe patient store. The unreleased b429
   Worker/sidecar experiment was retired after cross-tab and crash-marker
   races were reproduced. The production path is again the b428 synchronous
   MLSZ1 writer, while the independent schedule-import batch remains intact.

   These tests deliberately seed opaque b429 sidecar keys. The retired writer
   must never parse, overwrite, or delete them; every save acknowledged by the
   current build must already be complete in the legacy ::patients key, so a
   crash or rollback can read it without a recovery protocol. */

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
const rollbackSource = patientStoreBlock(path.join(root, '_site', 'ScribeFlow.html'));

assert.strictEqual(source, rollbackSource,
  'current patient persistence is not byte-identical to the pre-worker b428 rollback implementation');
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
      if (fail && fail(key, value)) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      data.set(key, value);
    },
    removeItem(key) { data.delete(String(key)); },
    key(index) { return Array.from(data.keys())[index] || null; },
    get length() { return data.size; }
  };
}

function makeHarness(store, runtimeSource) {
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
  context.window = context;
  context.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  context.dispatchEvent = event => {
    for (const fn of listeners.get(event.type) || []) fn(event);
  };
  vm.createContext(context);
  vm.runInContext(runtimeSource || source, context, { filename: 'ScribeFlow.patient-store-sync.js' });
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
function decoded(h, store, account) {
  return JSON.parse(h.context.__mlsPtsDecode(store.getItem(pkey(account))));
}

// Large saves are complete in the rollback-compatible key before returning.
{
  const base = bigPatients();
  const store = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base) });
  const h = makeHarness(store);
  const next = clone(base); next[7].summary += ' acknowledged synchronously';
  h.context.savePatients(next);
  const raw = store.getItem(pkey('alpha@example.test'));
  assert(raw.startsWith('MLSZ1|'), 'large save did not use the legacy MLSZ1 format');
  assert.deepStrictEqual(decoded(h, store, 'alpha@example.test'), next, 'save returned before the exact roster was durable');
  assert.strictEqual(store.getItem(pendingKey('alpha@example.test')), null, 'current writer created a pending sidecar');
  assert.strictEqual(store.getItem(commitKey('alpha@example.test')), null, 'current writer created a commit marker');
  const crashed = makeHarness(store);
  assert.strictEqual(JSON.stringify(crashed.context.getPatients()), JSON.stringify(next), 'cold reload lost the acknowledged save');
}

// Regression: stale marker -> new save -> crash. Opaque unreleased sidecars
// cannot mask the new save because the current reader/writer never consults them.
{
  const base = bigPatients(), pending = '{"magic":"MLSPJ1","opaque":"stale"}', marker = '{"magic":"MLSPC1","opaque":"stale"}';
  const store = makeStore({
    [pkey('alpha@example.test')]: JSON.stringify(base),
    [pendingKey('alpha@example.test')]: pending,
    [commitKey('alpha@example.test')]: marker
  });
  const h = makeHarness(store), next = clone(base); next[17].summary += ' after stale marker';
  h.context.savePatients(next);
  assert.strictEqual(store.getItem(pendingKey('alpha@example.test')), pending, 'sync writer deleted an opaque pending sidecar');
  assert.strictEqual(store.getItem(commitKey('alpha@example.test')), marker, 'sync writer rewrote an opaque commit marker');
  const crashed = makeHarness(store);
  assert.strictEqual(JSON.stringify(crashed.context.getPatients()), JSON.stringify(next), 'stale marker masked the newer synchronous save');
}

// Regression: a newer second-tab sidecar survives the first tab's managed
// flush. The first tab writes only the atomic legacy key and never removes a
// shared journal key.
{
  const base = bigPatients(), store = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base) });
  const first = makeHarness(store);
  const token = first.context.__mlsPatientStoreBatch.begin({ maxChanges: 12, maxDelayMs: 15000 });
  const changed = clone(base[3]); changed.summary += ' first-tab batched edit';
  const batchState = first.context.__mlsPtsBatchByKey[token.key];
  const changedIndex = batchState.arr.findIndex(p => p.id === changed.id);
  batchState.arr[changedIndex] = changed;
  batchState.dirty = true; batchState.totalChanges++; batchState.changesSinceFlush++; batchState.dirtySince = Date.now();
  const newer = '{"magic":"MLSPJ1","owner":"second-tab","seq":99}';
  store.setItem(pendingKey('alpha@example.test'), newer);
  first.context.__mlsPatientStoreBatch.flush(token, 'first-tab-flush');
  assert.strictEqual(store.getItem(pendingKey('alpha@example.test')), newer, 'first-tab flush deleted the newer second-tab sidecar');
  assert(decoded(first, store, 'alpha@example.test').some(p => p.id === changed.id && /first-tab batched edit/.test(p.summary)), 'managed batch was not kept');
  first.context.__mlsPatientStoreBatch.end(token, 'done');
}

// Regression: a direct/legacy base write cannot turn an opaque sidecar into a
// corrupt state, because this release has no journal replay state machine.
{
  const base = bigPatients(), opaque = '{"magic":"MLSPJ1","owner":"unreleased-b429"}';
  const store = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base), [pendingKey('alpha@example.test')]: opaque });
  const legacy = clone(base); legacy[9].summary += ' direct legacy write';
  store.setItem(pkey('alpha@example.test'), JSON.stringify(legacy));
  const h = makeHarness(store);
  assert.strictEqual(JSON.stringify(h.context.getPatients()), JSON.stringify(legacy), 'direct base write entered a corrupt journal state');
  assert.strictEqual(store.getItem(pendingKey('alpha@example.test')), opaque, 'direct base read destructively changed an opaque sidecar');
  assert.strictEqual(h.context.__mlsPatientStoreAsync, undefined, 'retired async state machine is still reachable');
}

// Mixed-version/rollback proof: current and pre-worker b428 execute the same
// persistence bytes, and b428 can read a large save after an immediate crash.
{
  const base = bigPatients(), store = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base) });
  const current = makeHarness(store), latest = clone(base); latest[12].summary += ' rollback exact';
  current.context.savePatients(latest);
  const rollback = makeHarness(store, rollbackSource);
  assert.strictEqual(JSON.stringify(rollback.context.getPatients()), JSON.stringify(latest), 'b428 rollback could not read the current save');
  assert.strictEqual(store.getItem(pendingKey('alpha@example.test')), null, 'rollback depends on a pending sidecar');
  assert.strictEqual(store.getItem(commitKey('alpha@example.test')), null, 'rollback depends on a commit marker');
}

// Total localStorage failure remains loud; no false acknowledgement is allowed.
{
  const base = bigPatients();
  const store = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base) }, key => key === pkey('alpha@example.test'));
  const h = makeHarness(store), next = clone(base); next[4].summary += ' cannot persist';
  assert.throws(() => h.context.savePatients(next), /quota/i, 'total storage failure was silently accepted');
  assert(h.toasts.some(t => /could not be saved/i.test(t)), 'total storage failure was not surfaced');
}

console.log('PASS patient-store sync rollback: no worker/sidecar protocol, batching kept, stale markers inert, second-tab sidecars untouched, exact crash/rollback reads, and loud quota failure');

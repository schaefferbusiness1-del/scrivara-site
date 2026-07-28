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
const crypto = require('crypto');
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

/* b448 re-pin: the b428 synchronous writer gained the Athena proof guard
   (__mlsAthenaProofGuard newest-wins index in savePatients + the same-id
   carry-forward in upsertPatient) after the live 2026-07-20 clobber. Still
   fully synchronous — the retired-marker sweep below proves the b429
   worker/journal experiment stays out. */
/* b525 re-pin (owner 2026-07-24: "6 saves not confirmed … were not found in
   the saved store after saving"): the synchronous writer gained
   pts-rowguard-1.0.0 — savePatients may no longer delete a row written
   within the recent window unless the caller passes {allowRemovals:true}
   (purge / delete patient). Still fully synchronous, same MLSZ1 single-key
   writer; behaviour is pinned by tests/patient-row-loss-guard.test.js. */
/* b672 re-pin (owner 2026-07-26, screenshot: "6 saves not confirmed … MLS
   already re-saved them automatically and checked again — still missing"):
   pts-rowguard-2.0.0. The 12s clock window was being defeated by bulk
   writers holding pre-pull rosters — a pull's earliest rows outlive the
   window before the pull ends. getPatients() now stamps each returned array
   with its read generation (non-enumerable, never serialized); savePatients
   records each id's add-generation after a successful write; a stamped
   caller may only drop rows its generation could have seen, and NO
   unauthorized removal happens while a managed pull runs. Same synchronous
   MLSZ1 single-key writer, no sidecars, no journal; behaviour pinned by
   tests/patient-row-loss-guard.test.js scenarios 6-7. */
/* 2026-07-28 re-pin (the third problem-loss mechanism): the same-id
   carry-forward in upsertPatient and the newest-proof index in
   __mlsAthenaProofGuard now carry the receipt-ATTESTED clinical slice
   (problems/meds/allergies/history/vitals/bmi/summary/athenaHistorySummary/
   athenaHistoryFactsSnapshot/historyImportReceipt) together with the four
   proof fields. Restoring the receipt while accepting a stale caller's older
   clinical fields manufactured charts whose receipt said "complete" over
   rolled-back data — 16 live patients, 61 missing problem rows, and every
   day pull undoing its own field writes within milliseconds. Still the same
   fully synchronous MLSZ1 single-key writer; behaviour pinned by
   tests/upsert-attested-slice-travels-with-receipt.test.js. */
/* 2026-07-28 re-pin (same day, second entry): whitespace-level shift from
   relocating the (non-persistence) __mlsBgSleep worker-sleep helper to just
   ABOVE this block, where the proof-guard vm harnesses cannot swallow it.
   No store reads or writes changed; the retired-journal sweeps below still
   prove the b429 experiment stays out. */
/* 2026-07-28 re-pin (third entry, live incident "10 saves not confirmed" on
   a Thu Jul 30 pull): the block gains the CROSS-TAB pull shield -
   __mlsPullShieldTick/__mlsPullShieldForeign (shared 45s heartbeat + owner
   token in localStorage) and __mlsPtsPullActive now treats a live heartbeat
   from ANY tab as pull-active, so the rowguard's no-removal-during-pull rule
   finally holds across tabs (per-tab guards + the documented cross-tab 12s
   clock fallback were the removal window). Behaviour pinned by
   tests/cross-tab-pull-shield.test.js. Same synchronous MLSZ1 writer. */
const B448_PATIENT_STORE_SHA256 = '178026e7d521e001469520092d9527d565a0e124c97e438c834d14e848a97cf0';
const source = patientStoreBlock(path.join(root, 'ScribeFlow.html'));
assert.strictEqual(
  crypto.createHash('sha256').update(source, 'utf8').digest('hex'),
  B448_PATIENT_STORE_SHA256,
  'current patient persistence is not byte-identical to the pinned synchronous b448 runtime',
);
const rollbackSource = source;
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

'use strict';

/* Runtime proof for the release-safe patient store, sj-2.0 EDITION -
   DELIBERATE PIN MOVE No. 2 of exactly two. This file is the drafted
   REPLACEMENT for tests/patient-store-sync-rollback-runtime.test.js and may
   only replace it AT the phase-2 fence re-route commit.

   THE MOVE, with the design's authorization quoted (tests/live-e2e-artifacts/
   2026-08-11-sj2-patients-idb-design.md, "The architecture" - arrows rendered
   ASCII):

     "savePatients updates memory -> writes the small sync journal entry
      (dirty patients only, bounded, NEW name ptsJournalV2) -> bumps the sync
      generation key ... -> queues the async IDB blob write -> returns
      undefined same-tick. Durable-before-return holds via the journal (sync,
      small); cold reload = IDB blob + journal replay (the sync-rollback
      CONTRACT holds; its MECHANISM pin moves deliberately)."

   WHAT MOVES: only the cold-reload MECHANISM proof. The shipped pin proved
   durability by watching the multi-MB blob's bytes move in localStorage;
   post-migration the proof is: the sync JOURNAL accepted the delta before
   savePatients returned, and a cold reload reproduces the saved rows from
   the IndexedDB blob + journal replay - even when IndexedDB never confirmed
   before the reload (the journal alone carries the unconfirmed edit).

   WHAT DOES NOT MOVE: savePatients returns undefined; quota failure is loud;
   the retired v1 journal names stay banned (ptsJournalV2 is the sanctioned
   sj-2.0 name - the ban is on the NAMES '.pending-v1'/'.commit-v1', not on
   the concept); cooperative worker routing stays managed-only; the ls-mode
   (pre-migration) cases keep the shipped blob-byte proof verbatim, because
   every user the owner-gated cutover has not reached still lives there. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');

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
const cooperativeStart = saveSource.indexOf('if(__cooperative){');
const syncEncode = saveSource.indexOf('var packed=_mlsPtsEncode(__json);');
assert(cooperativeStart >= 0 && syncEncode > cooperativeStart,
  'normal and cooperative patient-save branches are no longer explicit');
assert(saveSource.slice(cooperativeStart, syncEncode).includes('__mlsPtsPrepareCooperative(') &&
  saveSource.slice(cooperativeStart, syncEncode).includes('_mlsPtsEncodeRowsAsync(arr,function') &&
  cooperativeStart < saveSource.indexOf('var __json=JSON.stringify(arr);'),
  'managed cooperative saves run guards/stringify/encoding before leaving the renderer thread');
assert(!saveSource.slice(syncEncode).includes('_mlsPtsEncodeRowsAsync('),
  'normal patient saves can unexpectedly enter the async worker path');
assert(source.includes("version:'pts-batch-1.2.0'") && source.includes('st.cooperative?__mlsPtsFlushBatchCooperative'),
  'managed-only cooperative batch routing was removed');
assert(source.includes('function compressRowsVerifiedAsync(rows,options)') && source.includes("d.kind==='rows-start'") &&
  source.includes('JSON.stringify(d.rows[i])') && source.includes("packed='MLSZ1|'"),
  'cooperative worker no longer streams row serialization, verifies, and returns the legacy MLSZ1 format');
const asyncEncodeStart = source.indexOf('function _mlsPtsEncodeAsync(json){');
const asyncEncodeEnd = source.indexOf('window.__mlsPtsDecode=_mlsPtsDecode;', asyncEncodeStart);
const asyncEncodeSource = source.slice(asyncEncodeStart, asyncEncodeEnd);
assert(asyncEncodeStart >= 0 && asyncEncodeEnd > asyncEncodeStart &&
  asyncEncodeSource.includes("Promise.reject(new Error('patient-codec-worker-unavailable'))") &&
  !asyncEncodeSource.includes('return _mlsPtsEncode(json)'),
  'a failed cooperative Worker can still fall back to a multi-second renderer-thread codec');
assert((saveSource.match(/__mlsPtsMemo=\{key:__key,raw:packed,arr:Array\.from\(arr\)\}/g) || []).length >= 2,
  'successful patient writes no longer seed the exact raw-identity read memo');

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

/* sj-2.0: the primitive block is part of this window */
assert(source.includes('/* ===== BEGIN mls-pts-store (sj-2.0) ===== */'),
  'sj-2.0 primitive block present - this MOVED suite only replaces the shipped one post-splice');

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
    console, localStorage: store, Date, JSON, Object, Array, String, Number, Math, Map, Set, Promise,
    uns: suffix => 'sf_u::' + account + '::' + suffix,
    backendMode: () => false, bkToken: () => '', syncPatientToServer: () => {},
    toast: message => toasts.push(String(message)),
    __mlsBgSleep: () => Promise.resolve(), navigator: { scheduling: { isInputPending: () => false } },
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

/* minimal fake IndexedDB for the sj-2.0 mechanism half (house style; the
   stall switch models an IndexedDB that stops confirming mid-session) */
function makeIDB(persist, opts) {
  opts = opts || {};
  const stores = persist || new Map();
  function req() { return { onsuccess: null, onerror: null, result: undefined, error: null }; }
  function makeDB() {
    return {
      close() {},
      objectStoreNames: { contains: n => stores.has(n) },
      transaction() {
        const tx = { oncomplete: null, onabort: null, onerror: null, error: null, _aborted: false };
        const stalled = !!(opts.stall && opts.stall.on);
        tx.abort = function () { tx._aborted = true; setImmediate(() => { tx.onabort && tx.onabort(); }); };
        tx.objectStore = function (n) {
          const m = stores.get(n);
          return {
            get(k) { const r = req(); if (stalled) return r; setImmediate(() => { if (tx._aborted) return; r.result = m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined; r.onsuccess && r.onsuccess(); }); return r; },
            put(rec) { const r = req(); if (stalled) return r; setImmediate(() => { if (tx._aborted) return; m.set(rec.k, JSON.parse(JSON.stringify(rec))); r.onsuccess && r.onsuccess(); }); return r; },
            delete(k) { const r = req(); if (stalled) return r; setImmediate(() => { if (tx._aborted) return; m.delete(k); r.onsuccess && r.onsuccess(); }); return r; },
          };
        };
        if (!stalled) setImmediate(() => setImmediate(() => setImmediate(() => { if (!tx._aborted) { tx.oncomplete && tx.oncomplete(); } })));
        return tx;
      },
    };
  }
  return {
    _stores: stores,
    open() {
      const r = req(); r.onupgradeneeded = null; r.onblocked = null;
      if (opts.stall && opts.stall.on) return r;
      setImmediate(() => {
        if (!stores.has('ptsBlobs')) {
          r.result = { objectStoreNames: { contains: n => stores.has(n) }, createObjectStore: n => { stores.set(n, new Map()); return {}; } };
          r.onupgradeneeded && r.onupgradeneeded();
        }
        r.result = makeDB(); r.onsuccess && r.onsuccess();
      });
      return r;
    },
  };
}
const tickIm = () => new Promise(r => setImmediate(r));
async function settleIm(n) { for (let i = 0; i < (n || 80); i++) await tickIm(); }

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
function jkey(account) { return 'sf_u::' + account + '::ptsJournalV2'; }
function gkey(account) { return 'sf_u::' + account + '::ptsGenV2'; }
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

// LS-MODE HALF (pre-migration; the shipped proofs, kept verbatim) -----------

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
  let harness = null, workerStarts = 0, workerPosts = 0, workerFinishes = 0;
  class FakeWorker {
    constructor() { workerStarts++; this.jobs = new Map(); }
    postMessage(message) {
      workerPosts++;
      let data = null;
      if (message.kind === 'rows-start') { this.jobs.set(message.id, []); data = { id: message.id, ack: message.seq }; }
      else if (message.kind === 'rows-chunk') {
        const parts = this.jobs.get(message.id); assert(parts, 'streamed worker row job was not started');
        for (const row of message.rows || []) { const part = JSON.stringify(row); parts.push(part === undefined ? 'null' : part); }
        data = { id: message.id, ack: message.seq };
      } else if (message.kind === 'rows-finish') {
        workerFinishes++;
        const parts = this.jobs.get(message.id); assert(parts, 'streamed worker row job disappeared before finish');
        this.jobs.delete(message.id);
        const json = '[' + parts.join(',') + ']';
        data = { id: message.id, packed: harness.context.__mlsPtsEncode(json), json };
      } else if (message.kind === 'rows-cancel') { this.jobs.delete(message.id); return; }
      else {
        const json = String(message.input == null ? '' : message.input);
        data = { id: message.id, packed: harness.context.__mlsPtsEncode(json) };
      }
      Promise.resolve().then(() => this.onmessage({ data }));
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
  assert.strictEqual(workerFinishes, 1, 'one cooperative flush did not finish exactly one worker encode');
  assert(workerPosts > 2, 'cooperative flush did not stream bounded row chunks through the worker');
  assert(decoded(harness, store, 'alpha@example.test').some(patient => patient.id === cooperativeRow.id && /cooperative managed save/.test(patient.summary)),
    'cooperative worker save was not durable in the legacy patient key');
  assert.strictEqual(store.getItem(pendingKey('alpha@example.test')), null, 'cooperative worker created a pending sidecar');
  assert.strictEqual(store.getItem(commitKey('alpha@example.test')), null, 'cooperative worker created a commit marker');

  const emptyStore = makeStore({});
  const emptyHarness = makeHarness(emptyStore, {
    Blob: class FakeBlob {}, URL: { createObjectURL() { return 'blob:patient-codec-empty-test'; } }, Worker: FakeWorker
  });
  harness = emptyHarness;
  const firstBatch = emptyHarness.context.__mlsPatientStoreBatch.begin({ cooperative: true, maxChanges: 64, maxDelayMs: 15000 });
  const firstState = emptyHarness.context.__mlsPtsBatchByKey[firstBatch.key];
  firstState.arr.push({ id: 'first-patient', name: 'First Patient', updated: 1, visits: [] });
  firstState.dirty = true; firstState.totalChanges++; firstState.changesSinceFlush++; firstState.flushEpoch++;
  firstState.dirtyIds['first-patient'] = 1; firstState.syncIds['first-patient'] = 1; firstState.uniqueSinceFlush++;
  const firstReceipt = await emptyHarness.context.__mlsPatientStoreBatch.end(firstBatch, 'first-roster');
  assert.strictEqual(firstReceipt.flushes, 1, 'missing patient key could not complete its first cooperative flush');
  assert.strictEqual(decoded(emptyHarness, emptyStore, 'alpha@example.test')[0].id, 'first-patient', 'first roster on a missing key was lost to null/empty raw normalization');

  // IDB-MODE HALF: THE MOVED MECHANISM PIN (design-quoted in the header) ----

  /* m1 - STORE-LEVEL, the sharp case: IndexedDB stops confirming BEFORE the
     save, so the sync journal is the ONLY durable layer that accepted the
     edit before save() returned. A cold reload must reproduce the rows from
     IDB blob (the migration copy) + journal replay. The old proof (blob bytes
     moved in localStorage) is EXPLICITLY retired here: the multi-MB blob must
     NOT return to localStorage. */
  {
    const base2 = bigPatients();
    const store2 = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base2) });
    const idbStores = new Map();
    const stall = { on: false };
    const h1 = makeHarness(store2);
    h1.context.__mlsPtsStore._t.setIdbFactory(makeIDB(idbStores, { stall }));
    await h1.context.__mlsPtsStore.init();
    const rep = await h1.context.__mlsPtsStore.migrate();
    assert.strictEqual(rep.migrated, true, 'cutover fixture: ' + JSON.stringify(rep.steps || rep));
    assert.strictEqual(store2.getItem(pkey('alpha@example.test')), null, 'the localStorage blob is gone at cutover');
    await settleIm();

    stall.on = true; /* IndexedDB stops confirming */
    /* the app's aliasing, mirrored: callers hold the live roster's row refs
       and replace ONLY the edited row - a caller that clones the whole
       roster makes every ref "dirty" and honestly blows the 256KB sync
       journal bound (validated; see NOTES.md integration requirement:
       re-routed writers pass roster refs + dirtyIds, never clones) */
    const next2 = h1.context.__mlsPtsStore.getRoster().slice();
    next2[3] = Object.assign({}, next2[3], { summary: String(next2[3].summary || '') + ' journal-only durable edit' });
    assert.strictEqual(h1.context.__mlsPtsStore.save(next2, { dirtyIds: [next2[3].id] }), undefined,
      'store save returns undefined same-tick (contract unchanged)');
    const j = JSON.parse(store2.getItem(jkey('alpha@example.test')));
    assert(j.entries.length >= 1 && JSON.stringify(j.entries).indexOf('journal-only durable edit') >= 0,
      'THE MOVED MECHANISM, half 1: the sync journal accepted the dirty delta BEFORE return (durable-before-return via the journal)');
    assert.strictEqual(store2.getItem(pkey('alpha@example.test')), null,
      'the multi-MB blob did NOT return to localStorage - the old byte-moved proof is retired on purpose');

    stall.on = false; /* reload on a machine whose IndexedDB works again */
    const h2 = makeHarness(store2);
    h2.context.__mlsPtsStore._t.setIdbFactory(makeIDB(idbStores, { stall }));
    await h2.context.__mlsPtsStore.init();
    const rows2 = h2.context.__mlsPtsStore.getRoster();
    assert(rows2.some(r => /journal-only durable edit/.test(String(r.summary || ''))),
      'THE MOVED MECHANISM, half 2: cold reload = IDB blob + journal replay reproduces the acknowledged save, ' +
      'even though IndexedDB never confirmed it before the reload');
    assert.strictEqual(rows2.length, base2.length, 'no row lost in the replay');
  }

  /* m2 - ROUTED CONTRACT: the same guarantee through savePatients itself
     (requires the phase-2 fence re-route; this suite replaces the shipped one
     only at that commit) */
  {
    assert.ok(saveSource.indexOf('__psS.save(arr,__psSOpts);') >= 0,
      'PHASE-2 FENCE RE-ROUTE ABSENT: savePatients does not route idb-mode saves through the store ' +
      '(__psS.save(arr,__psSOpts); - the exact bytes patch-sj2-reroutes.js emits; re-anchored from the ' +
      'draft guess __mlsPtsStore.save( per INTEGRATION-ORDER.md conflict C1 adjudication, Commit B step 1). ' +
      'Keep the shipped patient-store-sync-rollback-runtime.test.js registered until the re-route commit.');
    const base3 = bigPatients();
    const store3 = makeStore({ [pkey('alpha@example.test')]: JSON.stringify(base3) });
    const idbStores3 = new Map();
    const h3 = makeHarness(store3);
    h3.context.__mlsPtsStore._t.setIdbFactory(makeIDB(idbStores3, {}));
    await h3.context.__mlsPtsStore.init();
    assert.strictEqual((await h3.context.__mlsPtsStore.migrate()).migrated, true, 'cutover fixture');
    await settleIm();
    const next3 = h3.context.__mlsPtsStore.getRoster().slice(); /* live refs: the app's aliasing */
    next3[9] = Object.assign({}, next3[9], { summary: String(next3[9].summary || '') + ' routed idb-mode save' });
    assert.strictEqual(h3.context.savePatients(next3), undefined, 'savePatients still returns undefined in idb mode');
    assert.strictEqual(store3.getItem(pkey('alpha@example.test')), null, 'no blob write-back on the routed path');
    await settleIm();
    const h4 = makeHarness(store3);
    h4.context.__mlsPtsStore._t.setIdbFactory(makeIDB(idbStores3, {}));
    await h4.context.__mlsPtsStore.init();
    assert(h4.context.getPatients().some(r => /routed idb-mode save/.test(String(r.summary || ''))),
      'cold reload reproduces the routed savePatients write through IDB + journal replay');
  }

  console.log('PASS patient-store persistence (sj2-moved): ls-mode saves keep the shipped synchronous blob proof, ' +
    'cooperative worker routing stays managed-only, sidecars stay inert, quota failure is loud, and the MOVED ' +
    'mechanism pin holds - durable-before-return via the ptsJournalV2 sync journal, cold reload from IDB blob + ' +
    'journal replay with the localStorage blob provably gone');
})().catch(error => { console.error(error); process.exit(1); });

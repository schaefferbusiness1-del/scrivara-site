'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_visitfix.js'), 'utf8');

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function dirtyRoster(label) {
  return [{
    id: label + '-1', name: label,
    visits: [
      { id: label + '-junk', type: 'Chart summary', raw: 'Pulled chart blob' },
      { id: label + '-real', type: 'Office visit', source: 'import', raw: 'Provider: Dr Test\nOffice visit | 07-02-2026, Dr Test' },
      { id: label + '-keep', type: 'Follow up', source: 'manual', raw: 'A real follow-up visit' }
    ]
  }];
}

function harness(initialAccount, options = {}) {
  let account = initialAccount || 'acct-a@example.test';
  let token = 'token-' + account;
  let seq = 0;
  const timers = new Map();
  const idles = new Map();
  const intervals = new Map();
  const stores = Object.create(null);
  const calls = [];
  const pending = [];
  const scanRequests = [];
  const deferred = [];
  let syncCalls = 0;
  let inputPending = false;
  let rosterReads = 0;
  let yields = 0;

  function key() { return 'sf_u::' + account + '::patients'; }
  stores[key()] = dirtyRoster('A');

  const document = {
    readyState: 'complete',
    addEventListener() {},
    getElementById() { return null; }
  };
  const window = {
    document,
    navigator: { scheduling: { isInputPending() { return inputPending; } } },
    addEventListener() {}, removeEventListener() {},
    uns(suffix) { return 'sf_u::' + account + '::' + suffix; },
    bkToken() { return token; },
    getSessionEmail() { return account; },
    getPatients() { rosterReads++; return (stores[key()] || []).slice(); },
    upsertPatient() {},
    __mlsPatientStoreBatch: { version: 'pts-batch-1.1.1' },
    __mlsBgSleep() { yields++; return Promise.resolve(); },
    __mlsDeferAsset(fn, opts) { deferred.push({ fn, opts }); return deferred.length; },
    requestIdleCallback(fn, opts) { const id = ++seq; idles.set(id, { fn, opts }); return id; },
    cancelIdleCallback(id) { idles.delete(id); }
  };

  window.savePatients = function (list, storageKey, opts) {
    const target = typeof storageKey === 'string' ? storageKey : key();
    const cooperative = !!(opts && opts.cooperative === true);
    calls.push({ list, key: target, opts, cooperative });
    if (!cooperative) {
      syncCalls++;
      stores[target] = list;
      return true;
    }
    return new Promise((resolve, reject) => {
      pending.push({
        finish() {
          if (!opts.isCurrent()) { resolve({ stale: true }); return; }
          stores[target] = list;
          resolve({ saved: true, rows: list });
        },
        fail(message) { reject(new Error(message || 'synthetic worker failure')); }
      });
    });
  };

  if (options.sharedQueue !== false) {
    window.__mlsMaintenancePersist = {
      version: '1.1.0',
      scan(scanOptions) {
        return new Promise(resolve => scanRequests.push({ options: scanOptions, resolve, account, key: key() }));
      }
    };
  }

  const localStorage = {
    getItem(storageKey) { const value = stores[storageKey]; return value ? JSON.stringify(value) : null; },
    setItem() {}, removeItem() {}, key() { return null; }, length: 0
  };
  function setTimeoutFake(fn, ms) { const id = ++seq; timers.set(id, { fn, ms: Number(ms) || 0 }); return id; }
  function clearTimeoutFake(id) { timers.delete(id); }
  function setIntervalFake(fn, ms) { const id = ++seq; intervals.set(id, { fn, ms: Number(ms) || 0 }); return id; }
  function clearIntervalFake(id) { intervals.delete(id); }

  const context = vm.createContext({
    window, document, navigator: window.navigator, localStorage,
    setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
    setInterval: setIntervalFake, clearInterval: clearIntervalFake,
    Promise, Object, Array, String, Number, Math, Date, JSON, RegExp,
    console: { log() {}, warn() {}, error() {} },
    URL: { revokeObjectURL() {} }
  });
  vm.runInContext(source, context, { filename: 'feat_mls_visitfix.js' });

  function runTimer(delay) {
    const entry = Array.from(timers.entries()).find(([, item]) => delay == null || item.ms === delay);
    assert(entry, 'missing timer' + (delay == null ? '' : ' at ' + delay + 'ms'));
    timers.delete(entry[0]); entry[1].fn();
  }
  function runIdle() {
    const entry = idles.entries().next().value;
    assert(entry, 'missing idle callback');
    idles.delete(entry[0]); entry[1].fn({ didTimeout: false, timeRemaining() { return 50; } });
  }
  function switchAccount(next) {
    account = next;
    token = 'token-' + next;
    if (!stores[key()]) stores[key()] = dirtyRoster(next.toUpperCase().slice(0, 1));
  }
  function runScan(mode = 'save') {
    const request = scanRequests.shift();
    assert(request, 'missing shared maintenance scan request');
    const source = (stores[request.key] || []).slice();
    const rows = source.slice();
    const dirty = [];
    for (let i = 0; i < source.length; i++) {
      const prepared = request.options.prepare(source[i], i, source);
      if (prepared && typeof prepared === 'object') { rows[i] = prepared; dirty.push(prepared); }
    }
    if (mode === 'fail') {
      const error = new Error('synthetic shared maintenance failure');
      request.options.onFailed(error, rows);
      request.resolve({ saved: false, error });
      return { rows, dirty };
    }
    if (!dirty.length) {
      if (request.options.onEmpty) request.options.onEmpty({ saved: false, empty: true }, rows);
      request.resolve({ saved: false, empty: true, rows });
      return { rows, dirty };
    }
    stores[request.key] = rows;
    request.options.onSaved({ saved: true, rows }, rows);
    request.resolve({ saved: true, rows });
    return { rows, dirty };
  }

  return {
    window, stores, calls, pending, timers, idles, scanRequests, deferred,
    key, runTimer, runIdle, switchAccount,
    runScan,
    setInputPending(value) { inputPending = !!value; },
    syncCalls() { return syncCalls; },
    rosterReads() { return rosterReads; },
    yields() { return yields; }
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

(async function () {
  /* Boot owns no roster scan or save. It submits both repairs to the shared
     session-ready/input-aware scan owner, which provides bounded chunks and
     the exact account/raw fence before calling these row preparers. */
  const h = harness('acct-a@example.test');
  const originalKey = h.key();
  const original = copy(h.stores[originalKey]);
  h.runTimer(1500); // boot
  assert.strictEqual(h.calls.length, 0, 'boot synchronously saved a dirty roster');
  assert.strictEqual(h.rosterReads(), 0, 'visitfix read the roster before the shared scan owner admitted it');
  assert.strictEqual(h.scanRequests.length, 1, 'boot did not coalesce migrate+retag into one shared scan');
  assert.strictEqual(h.window.__mlsVisitFix.maintenance.wanted, 3, 'boot lost one of its two maintenance intents');
  assert.strictEqual(h.scanRequests[0].options.chunkSize, 20, 'visitfix lost its bounded scan size');
  assert.strictEqual(h.scanRequests[0].options.mirror, true, 'visitfix lost server mirroring for repaired rows');
  assert.strictEqual(h.syncCalls(), 0, 'boot used an ordinary synchronous save');

  const failed = h.runScan('fail');
  await flushPromises();
  assert.deepStrictEqual(copy(h.stores[originalKey]), original, 'failed cooperative save mutated the memo-backed source roster');
  assert(failed.dirty.length === 1 && failed.dirty[0] !== h.stores[originalKey][0], 'failed scan was not copy-on-write');
  assert.strictEqual(h.window.__mlsVisitFix.maintenance.wanted, 3, 'failed save did not retain both migrations for retry');
  assert.strictEqual(h.deferred.length, 1, 'failed shared scan did not use the common deferred retry lane');
  h.deferred.shift().fn(); await flushPromises();
  assert.strictEqual(h.scanRequests.length, 1, 'failed maintenance did not request a fresh shared scan');
  const savedRun = h.runScan('save'); await flushPromises();
  assert.strictEqual(savedRun.dirty.length, 1, 'retry did not rediscover the exact dirty patient');

  const saved = h.stores[originalKey][0];
  assert.strictEqual(saved.visits.some(v => v.type === 'Chart summary'), false, 'junk visit survived the coalesced migration');
  assert.strictEqual(saved._junkVisits.length, 1, 'removed visit was not recoverably stashed');
  const retagged = saved.visits.find(v => v.id === 'A-real');
  assert(retagged && retagged.source === 'athena-visits' && retagged._srcPrev === 'import', 'source retag was lost when migrations coalesced');
  assert.strictEqual(h.window.__mlsVisitFix.maintenance.saves, 1, 'successful retry was not recorded as one maintenance save');
  assert.strictEqual(h.syncCalls(), 0, 'automatic retry ever entered the sync save path');

  /* Public/manual repair remains immediate; the optimization is deliberately
     limited to automatic boot maintenance. */
  h.stores[originalKey][0].visits.push({ id: 'manual-junk', type: 'Chart summary', raw: 'manual repair fixture' });
  const manual = h.window.__mlsVisitFix.migrateNow();
  assert.strictEqual(manual.removed, 1, 'manual migration no longer performs its repair immediately');
  assert.strictEqual(h.syncCalls(), 1, 'manual migration was unexpectedly delayed');

  /* If the shared owner has not loaded, automatic repair stays fail-closed and
     retries through the deferred owner; it never probes savePatients. */
  const old = harness('acct-old@example.test', { sharedQueue: false });
  old.runTimer(1500); await flushPromises();
  assert.strictEqual(old.calls.length, 0, 'unsupported patient store was invoked and could have synchronously compressed');
  assert.strictEqual(old.window.__mlsVisitFix.maintenance.wanted, 3, 'unsupported store did not retain maintenance for a fail-closed retry');
  assert.strictEqual(old.deferred.length, 1, 'missing shared owner did not use the deferred retry lane');

  /* The cooperative save wrapper itself must yield while preparing a large
     snapshot, then delegate once. This covers hydration/other cooperative
     writers outside the automatic maintenance owner. */
  const cooperative = harness('cooperative@example.test');
  const large = Array.from({ length: 45 }, (_, i) => ({ id: 'bulk-' + i, visits: [{ id: 'v-' + i, type: 'Follow up', raw: 'clinical' }] }));
  cooperative.stores[cooperative.key()] = large;
  const savePromise = cooperative.window.savePatients(large, cooperative.key(), { cooperative: true, isCurrent() { return true; } });
  assert(savePromise && typeof savePromise.then === 'function', 'cooperative visitfix wrapper lost its promise contract');
  assert.strictEqual(cooperative.calls.length, 0, 'cooperative visitfix wrapper scanned before yielding its caller task');
  for (let i = 0; i < 12 && !cooperative.pending.length; i++) await flushPromises();
  assert.strictEqual(cooperative.calls.length, 1, 'cooperative visitfix wrapper did not delegate exactly once');
  assert(cooperative.yields() >= 3, '45-row cooperative preparation was not split into 20-row tasks');
  assert.notStrictEqual(cooperative.calls[0].list[0], large[0], 'cooperative visitfix wrapper did not detach its writable row');
  cooperative.pending.shift().finish();
  await savePromise;

  console.log('PASS visitfix boot maintenance: one shared bounded scan, retry-safe COW repairs, fail-closed owner dependency, chunked cooperative saves, and manual semantics');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

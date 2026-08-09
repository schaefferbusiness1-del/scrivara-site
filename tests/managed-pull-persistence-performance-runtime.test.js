'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Worker: NodeWorker } = require('worker_threads');
const { performance } = require('perf_hooks');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const visitsSource = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const importer = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const storeStart = html.indexOf('var __mlsLZ=(function(){');
const storeEnd = html.indexOf('/* Remove every patient MLS imported from Athena', storeStart);
assert(storeStart >= 0 && storeEnd > storeStart, 'patient persistence block not found');
const patientStoreSource = html.slice(storeStart, storeEnd);

assert(importer.includes('cooperative: true, maxChanges: 64, maxDelayMs: 15000'),
  'managed pulls must opt into unique-patient cooperative persistence');
assert(importer.includes('await Promise.resolve(checkpointPatientBatch(opts.__patientStoreBatch, "schedule-import", true))'),
  'the pre-history durability checkpoint is not awaited');
assert(importer.includes('Promise.resolve(endPatientBatch(token, "receipt"))'),
  'the terminal durability receipt is not awaited');
assert(visitsSource.includes('wrapped.__mlsVisitWireOwner = true'), 'VisitWire does not expose exact wrapper ownership');
assert(connect.includes('if (visitWireOwnsChartSave()) return;'), 'legacy F7 still double-ingests a VisitWire-owned chart');
assert(!patientStoreSource.includes("'.pending-v1'") && !patientStoreSource.includes("'.commit-v1'"),
  'cooperative persistence reintroduced a sidecar/journal protocol');

const f7Start = connect.indexOf('  function visitWireOwnsChartSave()');
const f7End = connect.indexOf('\n\n  /* =======================================================================\n   * F8', f7Start);
assert(f7Start >= 0 && f7End > f7Start, 'F7 ownership block not found');
const f7Source = connect.slice(f7Start, f7End);
function runF7OwnershipCase(withOwner) {
  let ingests = 0;
  const ctx = {
    console, setTimeout: () => 0,
    orig: {}, isFn: fn => typeof fn === 'function',
    safe(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } },
    chartDobFor: () => '', refreshEasy() {}, bumpBeacon() {}, mlsStatus: () => null,
    getPatients: () => [{ id: 'f7-patient' }],
    __mlsVisitModel: { ingestChart() { ingests++; } }
  };
  ctx.window = ctx;
  const base = () => true;
  if (withOwner) {
    const visitWire = function () { const result = base.apply(this, arguments); if (result === true) ctx.__mlsVisitModel.ingestChart(); return result; };
    visitWire.__mlsVisitWireOwner = true; visitWire.__mlsOrig = base;
    const outer = function () { return visitWire.apply(this, arguments); };
    outer.__orig = visitWire;
    ctx._savePatientChart = outer;
  } else ctx._savePatientChart = base;
  vm.createContext(ctx);
  vm.runInContext('(function(){' + f7Source + '\ninstallF7();}).call(window);', ctx, { filename: 'mls-connect.f7-owner-runtime.js' });
  ctx._savePatientChart({ patientId: 'f7-patient' }, { source: 'athena' }, { visits: [{ date: '2026-08-01' }] });
  return ingests;
}
assert.strictEqual(runF7OwnershipCase(true), 1, 'F7 repeated a canonical VisitWire ingest hidden through an outer wrapper');
assert.strictEqual(runF7OwnershipCase(false), 1, 'F7 did not retain its one fallback ingest when VisitWire is absent');

function visitContext() {
  const clone = value => JSON.parse(JSON.stringify(value));
  const state = { patients: [], upserts: 0 };
  const el = () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {}, textContent: '', innerHTML: '', className: '', id: '' });
  const ctx = {
    console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: {
      readyState: 'complete', addEventListener() {}, removeEventListener() {},
      getElementById: () => null, createElement: el, querySelector: () => null,
      querySelectorAll: () => [], head: el(), documentElement: el(), body: el()
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getPatients: () => state.patients.map(clone),
    findPatient: id => { const p = state.patients.find(row => row && row.id === id); return p ? clone(p) : null; },
    savePatients(rows) { state.patients = rows.map(clone); },
    upsertPatient(p) {
      state.upserts++;
      const i = state.patients.findIndex(row => row && row.id === p.id);
      if (i >= 0) state.patients[i] = clone(p); else state.patients.unshift(clone(p));
    },
    fetch: () => Promise.reject(new Error('network disabled')),
    state
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(visitsSource, ctx, { filename: 'feat_visits.bulk-runtime.js' });
  return ctx;
}

{
  const ctx = visitContext();
  const patient = { id: 'bulk-patient', name: 'Bulk Patient', dob: '01/02/1960', visits: [] };
  ctx.state.patients = [patient];
  const indexRows = Array.from({ length: 15 }, (_, i) => ({
    date: '2026-07-' + String(i + 1).padStart(2, '0'), type: 'Visit ' + i,
    textHead: 'Index ' + i, encounterId: 'enc-' + i, sourceVisitKey: 'row-' + i
  }));
  ctx.__mlsVisitModel.ingestChart('bulk-patient', { visits: indexRows }, 'athena-schedule-history', {
    identityVerified: true, identityBinding: 'bulk-patient'
  });
  assert.strictEqual(ctx.state.upserts, 1, '15 chart-index rows performed more than one patient upsert');
  assert.strictEqual(ctx.state.patients[0].visits.length, 15, 'chart-index bulk save lost visits');

  const bodies = indexRows.map((row, i) => Object.assign({}, row, {
    raw: 'Verified clinical body ' + i, fullDetail: true,
    patientName: 'Bulk Patient', patientDob: '01/02/1960'
  }));
  const beforeBodies = ctx.state.upserts;
  const saved = ctx.__mlsCopyVisits._saveVisits(
    ctx.state.patients[0], { name: 'Bulk Patient', dob: '01/02/1960' }, bodies, null,
    { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, parsed: 15, expected: 15 }
  );
  assert.strictEqual(saved, 15, 'full-body batch did not save every verified visit');
  assert.strictEqual(ctx.state.upserts - beforeBodies, 1, '15 full-body visits performed more than one patient upsert');
  assert(ctx.state.patients[0].visits.every(v => v.bodyComplete === true && /Verified clinical body/.test(v.raw)),
    'bulk persistence changed verified-body semantics');

  const freshCurrent = { id: 'stale-target', name: 'Current Patient', dob: '03/04/1965', marker: 'newer-store-field', visits: [] };
  const staleCaller = Object.assign({}, freshCurrent, { marker: 'stale-caller-field' });
  ctx.state.patients = [freshCurrent];
  const staleAdded = ctx.__mlsVisitModel.ingestChart(staleCaller, { visits: [{ date: '2026-08-01', type: 'Follow-up', encounterId: 'stale-1', raw: 'index' }] }, 'athena-schedule-history', {
    identityVerified: true, identityBinding: 'stale-target'
  });
  assert.strictEqual(staleAdded.length, 1, 'canonical stale-caller ingest did not add its row');
  assert.strictEqual(ctx.state.patients[0].marker, 'newer-store-field', 'stale object caller overwrote a newer canonical patient field');
  ctx.state.patients = [];
  assert.deepStrictEqual(Array.from(ctx.__mlsVisitModel.ingestChart(staleCaller, { visits: [{ date: '2026-08-02', type: 'Deleted patient row' }] }, 'athena-schedule-history')), [],
    'bulk ingest resurrected a patient deleted during the Athena read');

  const atomic = { id: 'atomic-target', name: 'Atomic Patient', dob: '05/06/1970', visits: [] };
  ctx.state.patients = [atomic];
  const beforeAtomic = JSON.stringify(ctx.state.patients);
  const originalAdd = ctx.__mlsVisitModel.addVisit;
  let atomicCalls = 0;
  ctx.__mlsVisitModel.addVisit = function () {
    atomicCalls++;
    if (atomicCalls === 2) return null;
    return originalAdd.apply(this, arguments);
  };
  assert.throws(() => ctx.__mlsVisitModel.saveVerifiedVisitBatch('atomic-target', [
    { date: '2026-08-03', type: 'One', encounterId: 'atomic-1', raw: 'body one' },
    { date: '2026-08-04', type: 'Two', encounterId: 'atomic-2', raw: 'body two' }
  ], { source: 'athena-copy', bodyComplete: true, reconcile: true }), /filtered before persistence/,
  'a wrapper-filtered authoritative set did not fail closed');
  assert.strictEqual(JSON.stringify(ctx.state.patients), beforeAtomic, 'partial authoritative rows escaped the staged clone after a wrapper refusal');
  ctx.__mlsVisitModel.addVisit = originalAdd;

  assert.throws(() => ctx.__mlsVisitModel.saveVerifiedVisitBatch('atomic-target', [
    { date: '2026-08-03', type: 'One', encounterId: 'duplicate-encounter', sourceVisitKey: 'source-a', raw: 'body one' },
    { date: '2026-08-04', type: 'Two', encounterId: 'duplicate-encounter', sourceVisitKey: 'source-b', raw: 'body two' }
  ], { source: 'athena-copy', bodyComplete: true, reconcile: true }), /repeated an encounter identity/,
  'two receipt rows sharing a stable encounter alias were folded and committed');
  assert.strictEqual(JSON.stringify(ctx.state.patients), beforeAtomic, 'duplicate receipt aliases changed the patient store');

  assert.throws(() => ctx.__mlsCopyVisits._saveVisits(
    atomic, { name: 'Atomic Patient', dob: '05/06/1970' },
    [{ date: '2026-08-03', type: 'One', encounterId: 'atomic-1', raw: 'body one', patientName: 'Atomic Patient', patientDob: '05/06/1970' }], null,
    { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, parsed: 2, expected: 2 }
  ), /receipt no longer matches/,
  'a filtered list retained authority from its pre-filter full receipt');
  assert.strictEqual(JSON.stringify(ctx.state.patients), beforeAtomic, 'filtered receipt mismatch changed the patient store');
}

function largeRoster(count, repeats) {
  count = count || 1571; repeats = repeats || 67;
  return Array.from({ length: count }, (_, i) => ({
    id: 'p-' + i, name: 'Synthetic ' + i, updated: i + 1,
    summary: ('synthetic clinical persistence row ' + i + ' ').repeat(repeats), visits: []
  }));
}

function patientStoreHarness(options) {
  options = options || {};
  let account = 'alpha@example.test';
  let workerSeq = 0, workerFailuresRemaining = Math.max(0, Number(options.workerFailures) || 0);
  const blobs = new Map(), held = [], timers = new Map(), listeners = new Map(), workers = [];
  const data = new Map();
  const writes = [];
  const localStorage = {
    getItem(key) { key = String(key); return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { key = String(key); value = String(value); data.set(key, value); writes.push({ key, value }); },
    removeItem(key) { data.delete(String(key)); },
    get length() { return data.size; },
    key(i) { return Array.from(data.keys())[i] || null; }
  };
  class FakeBlob { constructor(parts) { this.source = parts.join(''); } }
  const FakeURL = {
    createObjectURL(blob) { const id = 'blob:fake-' + (++workerSeq); blobs.set(id, blob.source); return id; },
    revokeObjectURL() {}
  };
  class FakeWorker {
    constructor(url) {
      this.source = blobs.get(url); this.onmessage = null; this.onerror = null; this.node = null;
      if (!options.holdWorker) {
        const wrapper = "const {parentPort}=require('worker_threads');var onmessage=null;function postMessage(value){parentPort.postMessage(value);}" + this.source + ";parentPort.on('message',function(data){onmessage({data:data});});";
        this.node = new NodeWorker(wrapper, { eval: true });
        this.node.on('message', data => { if (this.onmessage) this.onmessage({ data }); });
        this.node.on('error', error => { if (this.onerror) this.onerror(error); });
        this.node.unref(); workers.push(this.node);
      } else {
        this.workerCtx = { String, Object, Array, Math, Date, JSON, Error, postMessage: result => { if (this.onmessage) this.onmessage({ data: result }); } };
        vm.createContext(this.workerCtx);
        vm.runInContext(this.source, this.workerCtx, { filename: 'patient-codec.worker.js' });
      }
    }
    postMessage(payload) {
      if (workerFailuresRemaining > 0) {
        workerFailuresRemaining--;
        setImmediate(() => { if (this.onerror) this.onerror(new Error('synthetic patient-codec failure')); });
        return;
      }
      if (this.node) { this.node.postMessage(payload); return; }
      const deliver = () => {
        try {
          this.workerCtx.onmessage({ data: payload });
        } catch (error) { if (this.onerror) this.onerror(error); }
      };
      if (options.holdWorker) held.push(deliver); else setImmediate(deliver);
    }
    terminate() { if (this.node) this.node.terminate(); }
  }
  let timerSeq = 0, directMirrors = 0;
  const ctx = {
    console, Date, JSON, Object, Array, String, Number, Math, Map, Set, Promise,
    Blob: FakeBlob, URL: FakeURL, Worker: FakeWorker,
    localStorage,
    uns: suffix => 'sf_u::' + account + '::' + suffix,
    backendMode: () => true, bkToken: () => 'synthetic-token',
    syncPatientToServer: () => { directMirrors++; }, toast() {},
    setTimeout(fn, ms) { const id = ++timerSeq; timers.set(id, { fn, ms: Number(ms) || 0 }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval: () => 0, clearInterval() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class { constructor(type) { this.type = type; } }
  };
  ctx.__mlsBgSleep = typeof options.bgSleep === 'function' ? options.bgSleep : (ms => (Number(ms) || 0) <= 0 ? new Promise(resolve => setImmediate(resolve)) : new Promise(() => {}));
  ctx.window = ctx;
  ctx.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
  ctx.dispatchEvent = event => { for (const fn of listeners.get(event.type) || []) fn(event); };
  vm.createContext(ctx);
  vm.runInContext(patientStoreSource, ctx, { filename: 'ScribeFlow.patient-store-cooperative.js' });
  return {
    ctx, data, writes, timers, held,
    account(value) { if (arguments.length) account = value; return account; },
    dispatch(type, detail) { ctx.dispatchEvent(new ctx.CustomEvent(type, { detail })); },
    patientKey(name) { return 'sf_u::' + name + '::patients'; },
    pendingKey(name) { return 'sf_u::' + name + '::pendingPtSync'; },
    pendingIds(name) {
      const base = 'sf_u::' + name + '::pendingPtSync', prefix = base + '::id::', out = [];
      for (const key of data.keys()) if (key.startsWith(prefix)) out.push(decodeURIComponent(key.slice(prefix.length)));
      const legacy = data.get(base); if (legacy) { try { for (const id of JSON.parse(legacy)) if (!out.includes(String(id))) out.push(String(id)); } catch (e) {} }
      return out.sort();
    },
    directMirrors: () => directMirrors,
    cleanup() { workers.forEach(worker => worker.terminate()); }
  };
}

function nextTurn() { return new Promise(resolve => setImmediate(resolve)); }
async function waitForHeld(harness, count, rounds) {
  count = count || 1;
  for (let i = 0; i < (rounds || 300) && harness.held.length < count; i++) await nextTurn();
  return harness.held.length;
}
async function releaseHeldUntil(harness, promise, maxRounds) {
  let done = false, failure = null, value;
  Promise.resolve(promise).then(v => { done = true; value = v; }, e => { done = true; failure = e; });
  for (let round = 0; round < (maxRounds || 500) && !done; round++) {
    const deliveries = harness.held.splice(0);
    deliveries.forEach(deliver => deliver());
    await nextTurn();
  }
  if (!done) throw new Error('held worker operation did not settle');
  if (failure) throw failure;
  return value;
}
async function drainHeldUntil(harness, predicate, maxRounds) {
  for (let round = 0; round < (maxRounds || 500); round++) {
    const deliveries = harness.held.splice(0);
    deliveries.forEach(deliver => deliver());
    await nextTurn();
    if (predicate()) return true;
  }
  return false;
}

const mirrorStart = html.indexOf('function _pendingSyncGet(key)');
const mirrorEnd = html.indexOf('async function deletePatientOnServer', mirrorStart);
assert(mirrorStart >= 0 && mirrorEnd > mirrorStart, 'scoped patient mirror runtime not found');
const mirrorSource = html.slice(mirrorStart, mirrorEnd);
function mirrorHarness() {
  let account = 'alpha@example.test', token = 'token-alpha', base = 'https://alpha.test';
  const data = new Map(), patientsByAccount = new Map(), calls = [], zeroTimers = [], heldFetches = [];
  let holdFetch = false;
  const localStorage = {
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
    setItem(key, value) { data.set(String(key), String(value)); },
    removeItem(key) { data.delete(String(key)); },
    get length() { return data.size; },
    key(i) { return Array.from(data.keys())[i] || null; }
  };
  const ctx = {
    console, JSON, Object, Array, String, Number, Math, Date, Promise, encodeURIComponent, decodeURIComponent,
    localStorage, __mlsPtsBatchByKey: Object.create(null), __mlsPtsPendingMirrorMemoryByKey: Object.create(null),
    __mlsPtsMirrorItemKey: (key, id) => String(key) + '::id::' + encodeURIComponent(String(id)),
    backendMode: () => true, bkToken: () => token, bkBase: () => base,
    uns: suffix => 'sf_u::' + account + '::' + suffix,
    getPatients: () => (patientsByAccount.get(account) || []), ptServerLabel: p => String(p && p.id || '').slice(0, 2),
    _serverPtIds: {}, handle401() {},
    setInterval: () => 1, clearInterval() {}, addEventListener() {},
    setTimeout(fn, ms) { if (Number(ms) === 0) zeroTimers.push(fn); return zeroTimers.length; },
    fetch(url, init) {
      const call = { url, init, account, token, body: JSON.parse(init.body) }; calls.push(call);
      if (!holdFetch) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'server-' + call.body.external_id }) });
      return new Promise(resolve => heldFetches.push(() => resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'server-' + call.body.external_id }) })));
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(mirrorSource, ctx, { filename: 'ScribeFlow.patient-mirror-runtime.js' });
  return {
    ctx, data, calls, heldFetches,
    setAccount(next) { account = next; token = 'token-' + next.split('@')[0]; base = 'https://' + next.split('@')[0] + '.test'; },
    setPatients(nextAccount, rows) { patientsByAccount.set(nextAccount, rows); },
    hold(value) { holdFetch = value; },
    async runZeroTimers() { while (zeroTimers.length) { const fn = zeroTimers.shift(); fn(); await nextTurn(); } }
  };
}

(async function run() {
  const interactive = patientStoreHarness();
  const interactiveRoster = largeRoster();
  const interactiveBytes = JSON.stringify(interactiveRoster).length;
  assert(interactiveRoster.length === 1571 && interactiveBytes > 4000000 && interactiveBytes < 4600000,
    'interactive fixture must match the measured 1,571-patient / ~4.27 MB roster');
  interactive.data.set(interactive.patientKey('alpha@example.test'), JSON.stringify(interactiveRoster));
  let interactiveEvents = 0;
  interactive.ctx.addEventListener('mls:patient-record-updated', () => { interactiveEvents++; });
  let interactivePulseAt = performance.now(), interactiveMaxGap = 0;
  const interactivePulse = setInterval(() => { const now = performance.now(); interactiveMaxGap = Math.max(interactiveMaxGap, now - interactivePulseAt); interactivePulseAt = now; }, 5);
  const interactiveStart = performance.now();
  interactive.ctx.upsertPatient(Object.assign({}, interactive.ctx.getPatients().find(row => row.id === 'p-7'), { summary: 'interactive-latest' }));
  const interactiveReturnMs = performance.now() - interactiveStart;
  assert(interactiveReturnMs < 250, 'ordinary large-roster upsert blocked its caller for ' + interactiveReturnMs.toFixed(1) + 'ms');
  assert.strictEqual(interactive.ctx.getPatients().find(row => row.id === 'p-7').summary, 'interactive-latest',
    'ordinary cooperative upsert was not immediately visible from the in-memory roster');
  assert.notStrictEqual(JSON.parse(interactive.ctx.__mlsPtsDecode(interactive.data.get(interactive.patientKey('alpha@example.test')))).find(row => row.id === 'p-7').summary, 'interactive-latest',
    'ordinary cooperative upsert synchronously rewrote the multi-megabyte roster');
  assert.strictEqual(interactive.writes.filter(w => w.key === interactive.patientKey('alpha@example.test')).length, 0,
    'ordinary cooperative upsert wrote the patient key before returning');
  assert.strictEqual(interactive.directMirrors(), 0, 'ordinary cooperative upsert sent a server mirror before local durability');
  for (let i = 0; i < 2000; i++) {
    const key = interactive.patientKey('alpha@example.test');
    if (!interactive.ctx.__mlsPtsBatchByKey[key] && interactive.writes.filter(w => w.key === key).length === 1 && interactive.pendingIds('alpha@example.test').length === 1) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  clearInterval(interactivePulse);
  interactiveMaxGap = Math.max(interactiveMaxGap, performance.now() - interactivePulseAt);
  const interactiveKey = interactive.patientKey('alpha@example.test');
  assert.strictEqual(interactive.ctx.__mlsPtsBatchByKey[interactiveKey], undefined, 'ordinary cooperative upsert left its implicit batch open');
  assert.strictEqual(interactive.writes.filter(w => w.key === interactiveKey).length, 1, 'ordinary cooperative upsert rewrote the full roster more than once');
  assert.strictEqual(JSON.parse(interactive.ctx.__mlsPtsDecode(interactive.data.get(interactiveKey))).find(row => row.id === 'p-7').summary, 'interactive-latest',
    'ordinary cooperative upsert acknowledged stale durable data');
  assert.deepStrictEqual(interactive.pendingIds('alpha@example.test'), ['p-7'], 'ordinary cooperative upsert did not queue exactly one patient mirror');
  assert.strictEqual(interactive.directMirrors(), 0, 'ordinary cooperative upsert bypassed the terminal mirror queue');
  assert.strictEqual(interactiveEvents, 1, 'ordinary cooperative upsert emitted duplicate patient update events');
  assert(interactiveMaxGap < 250, 'ordinary 4.27 MB upsert blocked the event loop for ' + interactiveMaxGap.toFixed(1) + 'ms');
  interactive.cleanup();

  const smallInteractive = patientStoreHarness();
  smallInteractive.data.set(smallInteractive.patientKey('alpha@example.test'), JSON.stringify(largeRoster(2, 1)));
  smallInteractive.ctx.upsertPatient(Object.assign({}, smallInteractive.ctx.getPatients()[0], { summary: 'small-sync' }));
  assert.strictEqual(smallInteractive.ctx.__mlsPtsBatchByKey[smallInteractive.patientKey('alpha@example.test')], undefined,
    'small ordinary upsert unexpectedly changed to an asynchronous batch');
  assert.strictEqual(smallInteractive.writes.filter(w => w.key === smallInteractive.patientKey('alpha@example.test')).length, 1,
    'small ordinary upsert lost synchronous local durability');
  assert.strictEqual(smallInteractive.directMirrors(), 1, 'small ordinary upsert lost its direct best-effort mirror');
  smallInteractive.cleanup();

  const rapidInteractive = patientStoreHarness({ holdWorker: true });
  rapidInteractive.data.set(rapidInteractive.patientKey('alpha@example.test'), JSON.stringify(largeRoster(128, 67)));
  rapidInteractive.ctx.upsertPatient(Object.assign({}, rapidInteractive.ctx.getPatients()[7], { summary: 'rapid-first' }));
  await waitForHeld(rapidInteractive);
  rapidInteractive.ctx.upsertPatient(Object.assign({}, rapidInteractive.ctx.getPatients()[7], { summary: 'rapid-latest' }));
  assert.strictEqual(rapidInteractive.ctx.getPatients().find(row => row.id === 'p-7').summary, 'rapid-latest',
    'second ordinary edit was hidden behind the first in-flight worker');
  assert(await drainHeldUntil(rapidInteractive, () => !rapidInteractive.ctx.__mlsPtsBatchByKey[rapidInteractive.patientKey('alpha@example.test')], 1000),
    'rapid ordinary edits did not settle their implicit batch');
  assert.strictEqual(JSON.parse(rapidInteractive.ctx.__mlsPtsDecode(rapidInteractive.data.get(rapidInteractive.patientKey('alpha@example.test')))).find(row => row.id === 'p-7').summary, 'rapid-latest',
    'in-flight ordinary edit worker overwrote the latest edit');
  assert.strictEqual(rapidInteractive.writes.filter(w => w.key === rapidInteractive.patientKey('alpha@example.test')).length, 1,
    'rapid same-patient edits produced more than one full-roster write');
  assert.deepStrictEqual(rapidInteractive.pendingIds('alpha@example.test'), ['p-7'], 'rapid ordinary edits duplicated/lost their mirror intent');
  rapidInteractive.cleanup();

  const failedInteractive = patientStoreHarness({ workerFailures: 1 });
  failedInteractive.data.set(failedInteractive.patientKey('alpha@example.test'), JSON.stringify(largeRoster(128, 67)));
  failedInteractive.ctx.upsertPatient(Object.assign({}, failedInteractive.ctx.getPatients()[9], { summary: 'failure-pagehide-latest' }));
  const failedKey = failedInteractive.patientKey('alpha@example.test');
  for (let i = 0; i < 100 && !(failedInteractive.ctx.__mlsPtsBatchByKey[failedKey] && failedInteractive.ctx.__mlsPtsBatchByKey[failedKey].lastError); i++) await nextTurn();
  assert(failedInteractive.ctx.__mlsPtsBatchByKey[failedKey] && failedInteractive.ctx.__mlsPtsBatchByKey[failedKey].dirty,
    'codec failure discarded the only in-memory ordinary edit');
  assert.strictEqual(failedInteractive.writes.filter(w => w.key === failedKey).length, 0,
    'failed worker falsely acknowledged ordinary edit durability');
  failedInteractive.dispatch('pagehide');
  assert.strictEqual(JSON.parse(failedInteractive.ctx.__mlsPtsDecode(failedInteractive.data.get(failedKey))).find(row => row.id === 'p-9').summary, 'failure-pagehide-latest',
    'pagehide did not rescue an ordinary edit after worker failure');
  assert.deepStrictEqual(failedInteractive.pendingIds('alpha@example.test'), ['p-9'],
    'worker failure/pagehide path lost the ordinary edit mirror intent');
  failedInteractive.cleanup();

  const h = patientStoreHarness();
  const roster = largeRoster();
  const rosterBytes = JSON.stringify(roster).length;
  assert(roster.length === 1571 && rosterBytes > 4000000 && rosterBytes < 4600000,
    'fixture must match the measured 1,571-patient / ~4.27 MB roster');
  h.data.set(h.patientKey('alpha@example.test'), JSON.stringify(roster));
  const api = h.ctx.__mlsPatientStoreBatch;
  const token = api.begin({ cooperative: true, maxChanges: 64, maxDelayMs: 15000 });
  for (let i = 0; i < 49; i++) {
    const p = Object.assign({}, h.ctx.getPatients().find(row => row.id === 'p-7'), { summary: 'latest-' + i, updated: 1000 + i });
    h.ctx.upsertPatient(p);
  }
  assert.strictEqual(api.state(token).flushes, 0, 'repeated writes to one patient reached the unique-patient threshold');
  let lastPulse = performance.now(), maxGap = 0;
  const pulse = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - lastPulse); lastPulse = now; }, 5);
  const receipt = await api.end(token, 'terminal');
  clearInterval(pulse);
  maxGap = Math.max(maxGap, performance.now() - lastPulse);
  assert.strictEqual(receipt.flushes, 1, '49 same-patient enrichments did not collapse to one durable flush');
  assert.strictEqual(h.directMirrors(), 0, 'cooperative batch serialized/sent the patient once per upsert');
  const pending = h.pendingIds('alpha@example.test');
  assert.deepStrictEqual(pending, ['p-7'], 'server durability queue did not coalesce the patient id');
  const durable = JSON.parse(h.ctx.__mlsPtsDecode(h.data.get(h.patientKey('alpha@example.test'))));
  assert.strictEqual(durable.find(row => row.id === 'p-7').summary, 'latest-48', 'terminal worker checkpoint acknowledged stale patient data');
  let postSaveDecodes = 0;
  const decodeAfterSave = h.ctx.__mlsLZ.decompressFromUTF16;
  h.ctx.__mlsLZ.decompressFromUTF16 = function () { postSaveDecodes++; return decodeAfterSave.apply(this, arguments); };
  const memoRead = h.ctx.getPatients();
  assert.strictEqual(memoRead.length, 1571, 'post-save memo did not return the durable roster');
  assert.strictEqual(postSaveDecodes, 0, 'the first post-save read synchronously decompressed the roster we just encoded');
  assert.strictEqual(h.writes.filter(w => w.key === h.patientKey('alpha@example.test')).length, 1,
    'cooperative terminal checkpoint rewrote the full roster more than once');
  assert(maxGap < 250, '4.27 MB worker checkpoint blocked the event loop for ' + maxGap.toFixed(1) + 'ms');
  h.cleanup();

  const threshold = patientStoreHarness({ holdWorker: true });
  const thresholdRoster = largeRoster(70, 120);
  threshold.data.set(threshold.patientKey('alpha@example.test'), JSON.stringify(thresholdRoster));
  const thresholdToken = threshold.ctx.__mlsPatientStoreBatch.begin({ cooperative: true, maxChanges: 64, maxDelayMs: 15000 });
  for (let i = 0; i < 63; i++) threshold.ctx.upsertPatient(Object.assign({}, threshold.ctx.getPatients()[i], { thresholdMarker: 'threshold-' + i }));
  await nextTurn();
  assert.strictEqual(threshold.held.length, 0, '63 unique patients crossed the 64-patient checkpoint');
  threshold.ctx.upsertPatient(Object.assign({}, threshold.ctx.getPatients()[63], { thresholdMarker: 'threshold-63' }));
  await waitForHeld(threshold);
  assert.strictEqual(threshold.held.length, 1, '64 unique patients did not start the cooperative checkpoint: ' + JSON.stringify(threshold.ctx.__mlsPatientStoreBatch.state(thresholdToken)));
  const thresholdEnding = threshold.ctx.__mlsPatientStoreBatch.end(thresholdToken, 'terminal');
  const thresholdReceipt = await releaseHeldUntil(threshold, thresholdEnding);
  assert.strictEqual(thresholdReceipt.flushes, 1, 'the 64-patient checkpoint and terminal receipt duplicated a full-roster write');

  let releaseHiddenSleep = null, hiddenSleepCalls = 0;
  const hiddenTimer = patientStoreHarness({ bgSleep(ms) {
    if ((Number(ms) || 0) <= 0) return new Promise(resolve => setImmediate(resolve));
    hiddenSleepCalls++; return new Promise(resolve => { releaseHiddenSleep = resolve; });
  } });
  hiddenTimer.data.set(hiddenTimer.patientKey('alpha@example.test'), JSON.stringify(largeRoster(20, 1)));
  const hiddenToken = hiddenTimer.ctx.__mlsPatientStoreBatch.begin({ cooperative: true, maxChanges: 64, maxDelayMs: 15000 });
  hiddenTimer.ctx.upsertPatient(Object.assign({}, hiddenTimer.ctx.getPatients()[0], { hiddenTimerMarker: true }));
  assert.strictEqual(hiddenSleepCalls, 1, 'cooperative max-delay durability still depends on a throttled renderer timer');
  assert.strictEqual(hiddenTimer.timers.size, 0, 'cooperative hidden-tab checkpoint armed a main-thread setTimeout');
  releaseHiddenSleep();
  for (let i = 0; i < 100 && hiddenTimer.ctx.__mlsPatientStoreBatch.state(hiddenToken).flushes < 1; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.strictEqual(hiddenTimer.ctx.__mlsPatientStoreBatch.state(hiddenToken).flushes, 1, 'worker-backed hidden-tab deadline did not checkpoint the patient');
  await hiddenTimer.ctx.__mlsPatientStoreBatch.end(hiddenToken, 'terminal');

  const external = patientStoreHarness({ holdWorker: true });
  const externalRoster = [
    { id: 'dirty-existing', name: 'Dirty', marker: 'initial', visits: [] },
    { id: 'dirty-deleted', name: 'Dirty then deleted', marker: 'initial', visits: [] },
    { id: 'external-update', name: 'External', marker: 'initial', padding: 'x'.repeat(220000), visits: [] },
    { id: 'external-delete', name: 'Delete me', marker: 'initial', visits: [] }
  ];
  external.data.set(external.patientKey('alpha@example.test'), JSON.stringify(externalRoster));
  const externalToken = external.ctx.__mlsPatientStoreBatch.begin({ cooperative: true, maxChanges: 64, maxDelayMs: 15000 });
  external.ctx.upsertPatient(Object.assign({}, external.ctx.getPatients().find(row => row.id === 'dirty-existing'), { marker: 'local-first' }));
  external.ctx.upsertPatient(Object.assign({}, external.ctx.getPatients().find(row => row.id === 'dirty-deleted'), { marker: 'local-before-delete' }));
  const externalEnding = external.ctx.__mlsPatientStoreBatch.end(externalToken, 'terminal');
  await waitForHeld(external);
  assert.strictEqual(external.held.length, 1, 'external-race worker did not start');
  external.data.set(external.patientKey('alpha@example.test'), JSON.stringify([
    { id: 'dirty-existing', name: 'Dirty', marker: 'external-conflict', visits: [] },
    { id: 'external-update', name: 'External', marker: 'external-wins', padding: 'x'.repeat(220000), visits: [] },
    { id: 'external-add', name: 'New tab row', marker: 'external-only', visits: [] }
  ]));
  external.ctx.upsertPatient(Object.assign({}, external.ctx.getPatients().find(row => row.id === 'dirty-existing'), { marker: 'local-latest' }));
  const externalReceipt = await releaseHeldUntil(external, externalEnding);
  const externalDurable = JSON.parse(external.ctx.__mlsPtsDecode(external.data.get(external.patientKey('alpha@example.test'))));
  assert.strictEqual(externalDurable.find(row => row.id === 'dirty-existing').marker, 'local-latest',
    'a same-id external write overwrote this batch\'s newer dirty patient');
  assert(!externalDurable.some(row => row.id === 'dirty-deleted'),
    'an explicit cross-tab deletion did not outrank a previously committed dirty row');
  assert.strictEqual(externalDurable.find(row => row.id === 'external-update').marker, 'external-wins', 'external untouched-row update was overwritten');
  assert(externalDurable.some(row => row.id === 'external-add'), 'external new row disappeared during retry');
  assert(!externalDurable.some(row => row.id === 'external-delete'), 'external deletion was resurrected by an untouched batch row');
  assert(externalReceipt.externalWrites >= 1, 'external storage identity change did not force a merge/retry');

  const pagehide = patientStoreHarness({ holdWorker: true });
  pagehide.data.set(pagehide.patientKey('alpha@example.test'), JSON.stringify(largeRoster(120, 67)));
  const pageToken = pagehide.ctx.__mlsPatientStoreBatch.begin({ cooperative: true, maxChanges: 64, maxDelayMs: 15000 });
  pagehide.ctx.upsertPatient(Object.assign({}, pagehide.ctx.getPatients()[5], { summary: 'pagehide-latest' }));
  const pageEnding = pagehide.ctx.__mlsPatientStoreBatch.end(pageToken, 'terminal');
  await waitForHeld(pagehide);
  assert.strictEqual(pagehide.held.length, 1, 'pagehide test worker did not start');
  pagehide.dispatch('pagehide');
  const pageDurableBeforeWorker = JSON.parse(pagehide.ctx.__mlsPtsDecode(pagehide.data.get(pagehide.patientKey('alpha@example.test'))));
  assert.strictEqual(pageDurableBeforeWorker.find(row => row.id === 'p-5').summary, 'pagehide-latest', 'pagehide did not synchronously acknowledge the latest patient');
  const writesBeforeLateWorker = pagehide.writes.filter(w => w.key === pagehide.patientKey('alpha@example.test')).length;
  await releaseHeldUntil(pagehide, pageEnding);
  assert.strictEqual(pagehide.writes.filter(w => w.key === pagehide.patientKey('alpha@example.test')).length, writesBeforeLateWorker,
    'late worker completion overwrote the pagehide durability barrier');

  const implicitPagehide = patientStoreHarness({ holdWorker: true });
  implicitPagehide.data.set(implicitPagehide.patientKey('alpha@example.test'), JSON.stringify(largeRoster(128, 67)));
  implicitPagehide.ctx.upsertPatient(Object.assign({}, implicitPagehide.ctx.getPatients()[5], { summary: 'implicit-pagehide-latest' }));
  await waitForHeld(implicitPagehide);
  assert(implicitPagehide.ctx.__mlsPtsBatchByKey[implicitPagehide.patientKey('alpha@example.test')],
    'ordinary large-roster edit did not retain an implicit durability owner while its worker was pending');
  implicitPagehide.dispatch('pagehide');
  const implicitPageRaw = implicitPagehide.data.get(implicitPagehide.patientKey('alpha@example.test'));
  assert.strictEqual(JSON.parse(implicitPagehide.ctx.__mlsPtsDecode(implicitPageRaw)).find(row => row.id === 'p-5').summary, 'implicit-pagehide-latest',
    'pagehide did not synchronously persist an ordinary large-roster edit');
  assert.deepStrictEqual(implicitPagehide.pendingIds('alpha@example.test'), ['p-5'],
    'pagehide did not retain the ordinary edit server-mirror intent');
  const implicitPageWrites = implicitPagehide.writes.filter(w => w.key === implicitPagehide.patientKey('alpha@example.test')).length;
  assert(await drainHeldUntil(implicitPagehide, () => !implicitPagehide.ctx.__mlsPtsBatchByKey[implicitPagehide.patientKey('alpha@example.test')]),
    'ordinary pagehide durability owner did not close after its stale worker settled');
  assert.strictEqual(implicitPagehide.writes.filter(w => w.key === implicitPagehide.patientKey('alpha@example.test')).length, implicitPageWrites,
    'late ordinary-edit worker rewrote the pagehide snapshot');
  implicitPagehide.cleanup();

  const implicitBoundary = patientStoreHarness({ holdWorker: true });
  implicitBoundary.data.set(implicitBoundary.patientKey('alpha@example.test'), JSON.stringify(largeRoster(128, 67)));
  implicitBoundary.data.set(implicitBoundary.patientKey('beta@example.test'), JSON.stringify([{ id: 'beta-only', name: 'Beta' }]));
  implicitBoundary.ctx.upsertPatient(Object.assign({}, implicitBoundary.ctx.getPatients()[3], { summary: 'implicit-boundary-latest' }));
  await waitForHeld(implicitBoundary);
  implicitBoundary.account('beta@example.test');
  implicitBoundary.dispatch('mls:session-boundary', { previousAccount: 'alpha@example.test', nextAccount: 'beta@example.test' });
  assert.strictEqual(implicitBoundary.ctx.__mlsPtsBatchByKey[implicitBoundary.patientKey('alpha@example.test')], undefined,
    'account boundary left the ordinary-edit token blocking the new account');
  assert.strictEqual(JSON.parse(implicitBoundary.ctx.__mlsPtsDecode(implicitBoundary.data.get(implicitBoundary.patientKey('alpha@example.test')))).find(row => row.id === 'p-3').summary, 'implicit-boundary-latest',
    'account boundary did not durably preserve the ordinary old-account edit');
  assert(!JSON.stringify(JSON.parse(implicitBoundary.data.get(implicitBoundary.patientKey('beta@example.test')))).includes('implicit-boundary-latest'),
    'ordinary old-account edit leaked into the new account');
  assert.deepStrictEqual(implicitBoundary.pendingIds('alpha@example.test'), ['p-3'],
    'account boundary lost the ordinary old-account mirror intent');
  implicitBoundary.ctx.upsertPatient(Object.assign({}, implicitBoundary.ctx.getPatients()[0], { marker: 'beta-edit-after-boundary' }));
  assert.strictEqual(JSON.parse(implicitBoundary.data.get(implicitBoundary.patientKey('beta@example.test')))[0].marker, 'beta-edit-after-boundary',
    'released old-account ordinary token still blocked a new-account upsert');
  const implicitBoundaryWrites = implicitBoundary.writes.filter(w => w.key === implicitBoundary.patientKey('alpha@example.test')).length;
  for (let i = 0; i < 20; i++) { implicitBoundary.held.splice(0).forEach(deliver => deliver()); await nextTurn(); }
  assert.strictEqual(implicitBoundary.writes.filter(w => w.key === implicitBoundary.patientKey('alpha@example.test')).length, implicitBoundaryWrites,
    'late ordinary-edit worker overwrote the account-boundary snapshot');
  implicitBoundary.cleanup();

  const manyMirrors = patientStoreHarness({ holdWorker: true });
  manyMirrors.data.set(manyMirrors.patientKey('alpha@example.test'), JSON.stringify(largeRoster(520, 15)));
  const manyToken = manyMirrors.ctx.__mlsPatientStoreBatch.begin({ cooperative: true, maxChanges: 64, maxDelayMs: 15000 });
  for (let i = 0; i < 520; i++) manyMirrors.ctx.upsertPatient(Object.assign({}, manyMirrors.ctx.getPatients()[i], { summary: 'mirror-' + i }));
  const manyEnding = manyMirrors.ctx.__mlsPatientStoreBatch.end(manyToken, 'terminal');
  await nextTurn();
  manyMirrors.dispatch('pagehide');
  await releaseHeldUntil(manyMirrors, manyEnding);
  assert.strictEqual(manyMirrors.pendingIds('alpha@example.test').length, 520,
    'server mirror durability queue truncated patient ids above 500');

  const boundary = patientStoreHarness({ holdWorker: true });
  const boundaryRoster = largeRoster(100, 67);
  boundary.data.set(boundary.patientKey('alpha@example.test'), JSON.stringify(boundaryRoster));
  boundary.data.set(boundary.patientKey('beta@example.test'), JSON.stringify([{ id: 'beta-only', name: 'Beta' }]));
  const boundaryToken = boundary.ctx.__mlsPatientStoreBatch.begin({ cooperative: true, maxChanges: 64, maxDelayMs: 15000 });
  boundary.ctx.upsertPatient(Object.assign({}, boundary.ctx.getPatients()[3], { summary: 'old-account-latest', updated: 9999 }));
  const ending = boundary.ctx.__mlsPatientStoreBatch.end(boundaryToken, 'terminal');
  await waitForHeld(boundary);
  assert.strictEqual(boundary.held.length, 1, 'cooperative worker did not start before the account switch');
  boundary.account('beta@example.test');
  boundary.dispatch('mls:session-boundary', { previousAccount: 'alpha@example.test', nextAccount: 'beta@example.test' });
  const oldDurable = JSON.parse(boundary.ctx.__mlsPtsDecode(boundary.data.get(boundary.patientKey('alpha@example.test'))));
  assert.strictEqual(oldDurable.find(row => row.id === 'p-3').summary, 'old-account-latest', 'session boundary did not synchronously durably flush the captured account');
  assert(!JSON.stringify(JSON.parse(boundary.data.get(boundary.patientKey('beta@example.test')))).includes('old-account-latest'),
    'old-account worker data leaked into the new account');
  boundary.held.splice(0).forEach(deliver => deliver());
  const boundaryReceipt = await ending;
  assert.strictEqual(boundaryReceipt.accountChanged, true, 'async batch did not record account invalidation');
  assert.deepStrictEqual(boundary.pendingIds('alpha@example.test'), ['p-3'],
    'session-boundary durability lost the old account server-mirror intent');

  const mirrors = mirrorHarness();
  const alpha = 'alpha@example.test', alphaPending = 'sf_u::' + alpha + '::pendingPtSync';
  mirrors.setPatients(alpha, Array.from({ length: 30 }, (_, i) => ({ id: 'm-' + i, name: 'Mirror ' + i, revision: 1 })));
  for (let i = 0; i < 30; i++) mirrors.ctx._pendingSyncAdd('m-' + i, alphaPending, false);
  await mirrors.ctx._flushPendingSync(); await mirrors.runZeroTimers();
  assert.strictEqual(mirrors.calls.length, 30, 'successful mirror backlog waited 60 seconds between 25-row chunks');
  assert.deepStrictEqual(Array.from(mirrors.ctx._pendingSyncGet(alphaPending)), [], 'successful mirror backlog did not drain');

  mirrors.setPatients(alpha, [{ id: 'blocked', name: 'Blocked' }]);
  mirrors.ctx._pendingSyncAdd('blocked', alphaPending, false);
  mirrors.ctx.__mlsPtsBatchByKey[mirrors.ctx.uns('patients')] = { cooperative: true, depth: 1 };
  const callsBeforeBlocked = mirrors.calls.length;
  await mirrors.ctx._flushPendingSync();
  assert.strictEqual(mirrors.calls.length, callsBeforeBlocked, 'server mirror drained before the managed patient batch reached its terminal receipt');
  delete mirrors.ctx.__mlsPtsBatchByKey[mirrors.ctx.uns('patients')];
  await mirrors.ctx._flushPendingSync();
  assert.strictEqual(mirrors.calls.length, callsBeforeBlocked + 1, 'terminally released mirror did not send');

  mirrors.setPatients(alpha, [{ id: 'newer', name: 'Newest payload', revision: 1 }]);
  mirrors.ctx._pendingSyncAdd('newer', alphaPending, false); mirrors.hold(true);
  const stalePayloadFlush = mirrors.ctx._flushPendingSync(); await nextTurn();
  mirrors.setPatients(alpha, [{ id: 'newer', name: 'Newest payload', revision: 2 }]);
  mirrors.heldFetches.shift()(); await stalePayloadFlush;
  assert.deepStrictEqual(Array.from(mirrors.ctx._pendingSyncGet(alphaPending)), ['newer'], 'older POST success cleared a newer patient payload');
  mirrors.hold(false); await mirrors.ctx._flushPendingSync();
  assert.strictEqual(mirrors.calls[mirrors.calls.length - 1].body.data.revision, 2, 'retry did not send the newest patient body');
  assert.deepStrictEqual(Array.from(mirrors.ctx._pendingSyncGet(alphaPending)), [], 'newest confirmed patient body remained queued');

  mirrors.setPatients(alpha, [{ id: 'old-account', name: 'Old account patient', revision: 1 }]);
  mirrors.ctx._pendingSyncAdd('old-account', alphaPending, false); mirrors.hold(true);
  const oldAccountFlush = mirrors.ctx._flushPendingSync(); await nextTurn();
  mirrors.setAccount('beta@example.test');
  const betaPending = 'sf_u::beta@example.test::pendingPtSync';
  mirrors.setPatients('beta@example.test', [{ id: 'beta-patient', name: 'Beta patient', revision: 1 }]);
  mirrors.ctx._pendingSyncAdd('beta-patient', betaPending, false);
  mirrors.heldFetches.shift()(); await oldAccountFlush;
  assert.deepStrictEqual(Array.from(mirrors.ctx._pendingSyncGet(alphaPending)), ['old-account'], 'stale old-account response deleted its retry intent');
  assert.deepStrictEqual(Array.from(mirrors.ctx._pendingSyncGet(betaPending)), ['beta-patient'], 'old-account response changed the new account queue');
  mirrors.hold(false); await mirrors.ctx._flushPendingSync();
  const betaCall = mirrors.calls[mirrors.calls.length - 1];
  assert.strictEqual(betaCall.body.external_id, 'beta-patient', 'new-account drain sent an old-account patient');
  assert.strictEqual(betaCall.init.headers.Authorization, 'Bearer token-beta', 'new-account drain reused the old account token');

  const atomicQueue = mirrorHarness(), atomicPending = 'sf_u::alpha@example.test::pendingPtSync';
  for (let i = 0; i < 520; i++) atomicQueue.ctx._pendingSyncAdd('atomic-' + i, atomicPending, false);
  assert.strictEqual(atomicQueue.ctx._pendingSyncGet(atomicPending).length, 520, 'per-patient atomic mirror keys truncated a >500 queue');
  assert.strictEqual(atomicQueue.data.has(atomicPending), false, 'current mirror writers still use the cross-tab lossy shared JSON array');

  console.log('PASS managed-pull persistence: atomic 15+15 visit batches, one off-main 4.27 MB save, 64-unique/hidden/pagehide/external/account barriers, and lossless scoped mirror draining');
})().catch(error => { console.error(error); process.exitCode = 1; });

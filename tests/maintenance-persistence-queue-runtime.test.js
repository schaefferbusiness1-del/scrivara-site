#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const marker = connect.indexOf('MLS Scribe - INPUT-AWARE PATIENT MAINTENANCE PERSISTENCE');
const queueStart = connect.indexOf('(function () {', marker);
const queueEnd = connect.indexOf('/* =============================================================================\n * MLS Scribe - PULLED-CHART STRUCTURING', queueStart);
assert(marker >= 0 && queueStart >= 0 && queueEnd > queueStart, 'maintenance persistence queue source not found');
const queueSource = connect.slice(queueStart, queueEnd);

assert(!/setInterval\s*\(/.test(queueSource) && !/setTimeout\s*\(/.test(queueSource),
  'maintenance persistence added a timer or polling loop');
assert(queueSource.includes('window.__mlsSessionReady') && queueSource.includes('window.__mlsDeferAsset') &&
  queueSource.includes('scheduling.isInputPending'), 'maintenance persistence lost its post-loader/input-aware admission');
assert(queueSource.includes('cooperative: true') && queueSource.includes('window.savePatients(snapshot, batch.scope.key'),
  'maintenance persistence is not using the public cooperative save wrapper');
assert(queueSource.includes('currentKey() !== scope.key') && queueSource.includes('currentAccount() !== scope.account') &&
  queueSource.includes('currentToken() !== scope.token') && queueSource.includes('rawFor(scope.key) === scope.raw'),
  'maintenance persistence lost exact account/key/token/raw fencing');
assert(!connect.includes('window.savePatients(ps)'), 'an automatic full-roster maintenance save still uses the blocking path');

const chartSection = connect.slice(connect.indexOf('MLS Scribe - PULLED-CHART STRUCTURING'), connect.indexOf('try { if (window.__mlsSanitizeV2'));
const v2Start = connect.indexOf('try { if (window.__mlsSanitizeV2');
const v2Section = connect.slice(v2Start, connect.indexOf('window.__mlsSanitizeV2_revert', v2Start));
const continuousStart = connect.indexOf('try { if (window.__mlsContinuousScrub)');
const continuousSection = connect.slice(continuousStart, connect.indexOf('window.__mlsContinuousScrub_revert', continuousStart));
const baseStart = connect.indexOf('try { if (window.__mlsSummarySanitize)');
const baseSection = connect.slice(baseStart, connect.indexOf('window.__mlsSummarySanitize_revert', baseStart));
for (const [name, section] of [['chart structure', chartSection], ['sanitizer v2', v2Section], ['continuous scrub', continuousSection], ['base sanitizer', baseSection]]) {
  assert(section.includes('.enqueue('), name + ' did not join the maintenance queue');
  assert(!section.includes('window.savePatients('), name + ' retained a direct full-roster save');
}
assert((connect.match(/maintenance\.enqueue\(ps, dirty, \{ scope: persistScope, fields: \['dob', 'updated'\], mirror: false \}\)/g) || []).length === 2,
  'both automatic DOB backfill copies must use the cooperative queue without changing mirror semantics');

const repairStart = connect.indexOf('function reconcileToday()');
const repairEnd = connect.indexOf('/* ---------- D) sequential chart pull', repairStart);
const repair = connect.slice(repairStart, repairEnd);
assert(repair.includes('window.savePatients(arr)'), 'manual destructive reconcile durability call unexpectedly moved');
assert((connect.match(/window\.savePatients\((?!snapshot)/g) || []).length === 1,
  'unexpected direct savePatients call remains outside the cooperative queue');

function makeHarness(options) {
  options = options || {};
  let account = 'alpha@example.test';
  let token = 'token-alpha';
  let inputPending = !!options.inputPending;
  let rosterReads = 0;
  let roster = Array.isArray(options.roster) ? options.roster : [];
  let releaseReady = null;
  const sessionReady = options.holdReady ? new Promise(resolve => { releaseReady = resolve; }) : Promise.resolve(true);
  const store = new Map();
  const deferred = [];
  const calls = [];
  const mirrors = [];
  const held = [];
  const listeners = Object.create(null);
  const localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(String(key), String(value)); },
    removeItem(key) { store.delete(String(key)); }
  };
  const sessionStorage = { getItem(key) { return key === 'sf_session' ? account : null; } };
  const context = {
    console,
    Promise,
    Error,
    Object,
    Array,
    String,
    localStorage,
    sessionStorage,
    navigator: { scheduling: { isInputPending() { return inputPending; } } },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter(item => item !== fn); },
    uns(suffix) { return 'sf_u::' + account + '::' + suffix; },
    bkToken() { return token; },
    getSessionEmail() { return account; },
    __mlsSessionReady: sessionReady,
    __mlsDeferAsset(fn, opts) { deferred.push({ fn, opts }); return deferred.length; },
    getPatients() { rosterReads++; return roster; },
    syncPatientToServer(row) { mirrors.push(row.id); return Promise.resolve({ ok: true }); }
  };
  context.window = context;
  context.savePatients = function (rows, key, opts) {
    assert(opts && opts.cooperative === true, 'queue attempted a synchronous patient save');
    calls.push({ rows, key, opts });
    if (options.hold) return new Promise(resolve => held.push({ resolve, rows, key, opts }));
    if (!opts.isCurrent()) return Promise.resolve({ stale: true, external: true });
    store.set(key, 'saved-' + calls.length);
    return Promise.resolve({ saved: true, rows });
  };
  vm.createContext(context);
  vm.runInContext(queueSource, context, { filename: 'maintenance-persistence-queue.js' });
  return {
    context, store, deferred, calls, mirrors, held,
    key() { return context.uns('patients'); },
    account(value) { account = value; },
    token(value) { token = value; },
    dispatch(type) { for (const fn of (listeners[type] || []).slice()) fn({ type }); },
    setInputPending(value) { inputPending = !!value; },
    releaseReady() { if (releaseReady) { const fn = releaseReady; releaseReady = null; fn(true); } },
    setRoster(value) { roster = value; },
    rosterReads() { return rosterReads; }
  };
}

async function turns() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
async function runDeferred(h) {
  assert(h.deferred.length, 'missing deferred maintenance callback');
  h.deferred.shift().fn();
  await turns();
}
async function drainDeferred(h, limit = 200) {
  let count = 0;
  while (h.deferred.length) {
    if (++count > limit) throw new Error('maintenance callback queue did not settle');
    await runDeferred(h);
  }
  return count;
}

(async function run() {
  const h = makeHarness();
  h.store.set(h.key(), 'raw-alpha');
  const base = [{ id: 'p1', summary: 'dirty', problems: '', updated: 1 }, { id: 'p2', summary: 'stable', problems: '', updated: 1 }];
  const scope = h.context.__mlsMaintenancePersist.capture();
  const summaryRows = base.map(row => Object.assign({}, row));
  summaryRows[0].summary = 'clean'; summaryRows[0].updated = 2;
  const problemRows = base.map(row => Object.assign({}, row));
  problemRows[0].problems = 'structured'; problemRows[0].updated = 3;
  let savedCallbacks = 0;
  const first = h.context.__mlsMaintenancePersist.enqueue(summaryRows, [summaryRows[0]], {
    scope, fields: ['summary', 'updated'], onSaved() { savedCallbacks++; }
  });
  const second = h.context.__mlsMaintenancePersist.enqueue(problemRows, [problemRows[0]], {
    scope, fields: ['problems', 'updated'], onSaved() { savedCallbacks++; }
  });
  await turns();
  assert.strictEqual(h.deferred.length, 1, 'coalesced maintenance jobs armed more than one quiet callback');
  assert.strictEqual(h.calls.length, 0, 'maintenance persisted before the post-loader quiet callback');
  h.deferred.shift().fn();
  await Promise.all([first, second]);
  assert.strictEqual(h.calls.length, 1, 'two dirty maintenance lanes did not coalesce into one cooperative save');
  assert.strictEqual(h.calls[0].rows[0].summary, 'clean', 'coalescing lost the sanitizer change');
  assert.strictEqual(h.calls[0].rows[0].problems, 'structured', 'coalescing lost the chart-structure change');
  assert.strictEqual(savedCallbacks, 2, 'coalesced jobs did not receive durable completion');
  assert.deepStrictEqual(h.mirrors, ['p1'], 'coalesced server mirroring was not deduplicated by patient id');
  assert.strictEqual(h.context.__mlsMaintenancePersist.stats().coalesced, 1, 'queue did not report the coalesced lane');

  const account = makeHarness();
  account.store.set(account.key(), 'raw-alpha');
  const accountScope = account.context.__mlsMaintenancePersist.capture();
  const accountRows = [{ id: 'a1', summary: 'clean' }];
  let accountFailed = 0;
  const accountJob = account.context.__mlsMaintenancePersist.enqueue(accountRows, accountRows, { scope: accountScope, fields: ['summary'], onFailed() { accountFailed++; } });
  await turns(); account.account('beta@example.test'); account.token('token-beta');
  account.deferred.shift().fn();
  const accountResult = await accountJob;
  assert(accountResult.stale && accountFailed === 1, 'account/token change did not fail closed');
  assert.strictEqual(account.calls.length, 0, 'old-account maintenance reached savePatients');

  const external = makeHarness();
  external.store.set(external.key(), 'raw-alpha');
  const externalScope = external.context.__mlsMaintenancePersist.capture();
  const externalRows = [{ id: 'e1', summary: 'clean' }];
  const externalJob = external.context.__mlsMaintenancePersist.enqueue(externalRows, externalRows, { scope: externalScope, fields: ['summary'] });
  await turns(); external.store.set(external.key(), 'newer-other-tab'); external.deferred.shift().fn();
  assert((await externalJob).stale, 'external write before admission did not fail closed');
  assert.strictEqual(external.calls.length, 0, 'stale roster reached savePatients after an external write');

  const inFlight = makeHarness({ hold: true });
  inFlight.store.set(inFlight.key(), 'raw-alpha');
  const inFlightScope = inFlight.context.__mlsMaintenancePersist.capture();
  const inFlightRows = [{ id: 'f1', summary: 'clean' }];
  const inFlightJob = inFlight.context.__mlsMaintenancePersist.enqueue(inFlightRows, inFlightRows, { scope: inFlightScope, fields: ['summary'] });
  await turns(); inFlight.deferred.shift().fn(); await turns();
  assert.strictEqual(inFlight.held.length, 1, 'cooperative save did not begin in the quiet lane');
  inFlight.store.set(inFlight.key(), 'newer-during-worker');
  assert.strictEqual(inFlight.held[0].opts.isCurrent(), false, 'in-flight external write did not invalidate completion');
  inFlight.held[0].resolve({ stale: true, external: true });
  assert((await inFlightJob).stale, 'stale worker completion was not failed closed');

  /* The scan owner must not even read the roster until the signed-in session
     is ready. It then yields between bounded row slices, re-yields while input
     is pending, and persists all changed rows through one cooperative save. */
  const scanRows = Array.from({ length: 60 }, (_, i) => ({ id: 's' + i, summary: i % 10 === 0 ? 'dirty' : 'stable', updated: 1 }));
  const scan = makeHarness({ holdReady: true, roster: scanRows });
  scan.store.set(scan.key(), 'raw-alpha');
  const scanJob = scan.context.__mlsMaintenancePersist.scan({
    chunkSize: 10, fields: ['summary', 'updated'], mirror: false,
    prepare(row) {
      if (row.summary !== 'dirty') return null;
      return Object.assign({}, row, { summary: 'clean', updated: 2 });
    }
  });
  await turns();
  assert.strictEqual(scan.rosterReads(), 0, 'scan read the roster before session readiness');
  assert.strictEqual(scan.deferred.length, 0, 'scan scheduled work before session readiness');
  scan.releaseReady(); await turns();
  assert.strictEqual(scan.deferred.length, 1, 'ready scan did not enter the shared deferred lane');
  scan.setInputPending(true);
  await runDeferred(scan);
  assert.strictEqual(scan.rosterReads(), 0, 'scan read the roster while input was pending');
  assert.strictEqual(scan.context.__mlsMaintenancePersist.stats().scanRows, 0, 'input-pending scan processed rows');
  scan.setInputPending(false);
  const scanTurns = await drainDeferred(scan);
  const scanReceipt = await scanJob;
  assert(scanReceipt && scanReceipt.saved, 'chunked scan did not receive a durable save receipt');
  assert.strictEqual(scan.calls.length, 1, 'chunked scan did not collapse to one cooperative save');
  assert.strictEqual(scan.calls[0].rows.filter(row => row.summary === 'clean').length, 6, 'chunked scan changed the wrong rows');
  assert(scanTurns >= 7, '60-row scan was not split into bounded deferred slices');
  assert.strictEqual(scan.context.__mlsMaintenancePersist.stats().scanRows, 60, 'scan row accounting is not exact');

  const scanExternal = makeHarness({ roster: Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, summary: 'dirty' })) });
  scanExternal.store.set(scanExternal.key(), 'raw-alpha');
  let scanExternalFailed = 0;
  const scanExternalJob = scanExternal.context.__mlsMaintenancePersist.scan({
    chunkSize: 5, fields: ['summary'],
    prepare(row) { return Object.assign({}, row, { summary: 'clean' }); },
    onFailed() { scanExternalFailed++; }
  });
  await turns(); await runDeferred(scanExternal); // first five rows only
  scanExternal.store.set(scanExternal.key(), 'newer-other-tab');
  await drainDeferred(scanExternal);
  const scanExternalReceipt = await scanExternalJob;
  assert(scanExternalReceipt.stale && scanExternalFailed === 1, 'mid-scan external write did not stop the scan exactly once');
  assert.strictEqual(scanExternal.calls.length, 0, 'mid-scan external write reached persistence');

  const canceled = makeHarness({ holdReady: true, roster: [{ id: 'c1', summary: 'dirty' }] });
  canceled.store.set(canceled.key(), 'raw-alpha');
  const canceledJob = canceled.context.__mlsMaintenancePersist.scan({ prepare(row) { return Object.assign({}, row); } });
  await turns(); canceled.dispatch('mls:session-boundary');
  const canceledReceipt = await canceledJob;
  assert(canceledReceipt.stale, 'session boundary did not cancel a queued scan');
  canceled.releaseReady(); await turns();
  assert.strictEqual(canceled.rosterReads(), 0, 'canceled scan touched the next session roster');

  console.log('PASS maintenance persistence queue: post-loader/input-aware bounded scans, cooperative-only coalescing, exact account/key/token/raw fences, deduplicated mirrors, and no timer storm');
})().catch(error => { console.error(error); process.exit(1); });

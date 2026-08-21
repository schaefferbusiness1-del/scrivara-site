'use strict';

/* Deterministic range-job proof, originating in /p1 and now promoted to the
 * official site through the production-from-1p derivation. The engine runs in
 * an isolated VM; real Chrome then exercises its additive Staff Prep controls
 * against a local, synthetic importer. No Athena account, backend, or PHI is
 * used. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const vm = require('vm');
const { chromium } = require('playwright');

const source = fs.readFileSync('1p-feat_mls_rangejobs.js', 'utf8');
const productionSource = fs.readFileSync('feat_mls_rangejobs.js', 'utf8');
const importerSource = fs.readFileSync('1p-feat_mls_schedimport_exact.js', 'utf8');
const p1Connect = fs.readFileSync('1p-mls-connect.js', 'utf8');
const regularConnect = fs.readFileSync('mls-connect.js', 'utf8');

assert(p1Connect.includes("s.src=A+'?v='+(window.__MLS_AV||'p1-preview')") &&
  p1Connect.includes("A='1p-feat_mls_rangejobs.js',V='p1-rangejobs-1.1.0'"), 'the /p1 loader does not install the current range-job engine');
assert(regularConnect.includes("A='feat_mls_rangejobs.js',V='p1-rangejobs-1.1.0'") &&
  regularConnect.includes('__mlsP1RangeJobs') && !regularConnect.includes('1p-feat_mls_rangejobs.js'),
  'the official bundle does not load the promoted range-job engine under its production asset name');
assert(source.includes("preview.route === '/1p/' || preview.route === '/1pScribeFlow.html'") &&
  source.includes('preview.enabled === true') && source.includes('preview.build'),
  'the range-job asset can install without the exact /p1 preview marker');
const expectedProductionSource = source
  .split('__MLS_P1_PREVIEW').join('__MLS_MAIN')
  .split("(preview.route === '/1p/' || preview.route === '/1pScribeFlow.html')")
    .join("(preview.route === '/ScribeFlow.html' || preview.route === '/')")
  .split('1p-feat_').join('feat_');
assert.strictEqual(productionSource, expectedProductionSource,
  'the official range-job asset drifted from the promoted /p1 source beyond lane identity');
assert(productionSource.includes("preview.route === '/ScribeFlow.html' || preview.route === '/'") &&
  productionSource.includes('window.__MLS_MAIN'),
  'the official range-job asset lacks its exact production marker gate');
assert(!/\btoast\s*\(/.test(source), 'background range recovery can emit notification spam');
assert(source.includes("document.getElementById('ez3PullStart')") && source.includes("document.getElementById('ez3Prov')") &&
  source.includes("id=\"mlsP1YearChoice\"") && source.includes("id=\"mlsP1YearProgress\""),
  'doctor-facing controls are not anchored to the canonical Staff Prep owner');
const monthImporterStart = importerSource.indexOf('function pullMonth(opts)');
const monthStopReset = importerSource.indexOf('window.__mlsPullStopRequested = false;', monthImporterStart);
const monthStopRecheck = importerSource.indexOf('return shouldStop() === true;', monthStopReset);
assert(monthImporterStart >= 0 && importerSource.indexOf('var shouldStop = isFn(opts.shouldStop) ? opts.shouldStop : null;', monthImporterStart) < monthStopReset &&
  monthStopReset >= 0 && monthStopRecheck > monthStopReset, 'pause/cancel during async month admission can be cleared by the importer reset');

function runtime(options = {}) {
  const store = options.store || new Map();
  const writes = [];
  const listeners = Object.create(null);
  const timers = [];
  const pullCalls = [];
  let account = options.account || 'doctor-a@example.invalid';
  let nowValue = options.now || Date.UTC(2026, 9, 15, 16, 0, 0);
  let lockAvailable = options.lockAvailable !== false;
  let stopCalls = 0;

  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowValue])); }
    static now() { return nowValue; }
  }

  const localStorage = {
    getItem(key) {
      if (options.readThrows && options.readThrows(key)) {
        const error = new Error('read blocked'); error.name = 'SecurityError'; throw error;
      }
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      key = String(key); value = String(value);
      if (options.quotaThrows && options.quotaThrows(key, value)) {
        const error = new Error('full'); error.name = 'QuotaExceededError'; throw error;
      }
      if (!(options.readbackMismatch && options.readbackMismatch(key, value))) store.set(key, value);
      writes.push({ key, value });
    },
    removeItem(key) { store.delete(String(key)); }
  };
  if (!store.has('sf_bk_token')) store.set('sf_bk_token', 'synthetic-token');

  const rosterEntry = {
    id: 'provider-7', stableKey: 'stable-provider-7',
    name: 'Dr Secret Person', raw: 'Secret Person, MD', rosterVerified: true
  };
  const importer = {
    installed: true,
    pullMonth(opts) {
      pullCalls.push({
        month: opts.month, dates: opts.dates.slice(), provider: opts.provider,
        includeHistory: opts.includeHistory, pullVisitBodies: opts.pullVisitBodies
      });
      if (options.pullMonth) return options.pullMonth(opts, { store, pullCalls, localStorage });
      const days = opts.dates.map(date => {
        const receipt = { date, ok: true, complete: true, reason: 'complete' };
        opts.onDayCheckpoint(receipt);
        return receipt;
      });
      return Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
    },
    stopPull() { stopCalls += 1; return { requested: true }; },
    _resolveProviderRequest(raw) {
      if (raw === 'all' || raw == null) return { ok: true, provider: 'all' };
      return { ok: true, provider: Object.assign({}, rosterEntry) };
    }
  };

  const document = {
    hidden: false,
    addEventListener(type, fn) { (listeners[`document:${type}`] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const list = listeners[`document:${type}`] || [];
      const at = list.indexOf(fn); if (at >= 0) list.splice(at, 1);
    }
  };
  const sandbox = {
    console, JSON, Math, Object, Array, String, Number, RegExp, Boolean,
    Promise, Intl, Date: FakeDate, isFinite, parseInt, parseFloat,
    window: null, document, localStorage,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: options.noLocks ? {} : {
      locks: {
        request(name, lockOptions, callback) {
          if (options.onLockRequest) options.onLockRequest(name, lockOptions);
          return Promise.resolve(callback(lockAvailable ? { name } : null));
        }
      }
    },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval(fn) { timers.push(fn); return timers.length; },
    clearInterval() {},
    addEventListener(type, fn) { (listeners[`window:${type}`] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const list = listeners[`window:${type}`] || [];
      const at = list.indexOf(fn); if (at >= 0) list.splice(at, 1);
    },
    __MLS_AV: 'synthetic-p1-build',
    __MLS_P1_PREVIEW: { enabled: true, route: '/1p/', build: 'synthetic-p1-build' },
    __mlsSI: importer,
    __mlsProviderRoster: {
      resolve(value) {
        const id = value && typeof value === 'object' ? value.id : String(value || '');
        return id === rosterEntry.id || id === rosterEntry.stableKey ? Object.assign({}, rosterEntry) : null;
      }
    },
    __mlsSessionAccount: account,
    session: { email: account },
    uns(suffix) { return `sf_u::${account || '_'}::${suffix}`; }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: '1p-feat_mls_rangejobs.js' });

  return {
    api: sandbox.__mlsP1RangeJobs,
    sandbox, importer, store, writes, pullCalls, timers,
    manifestKey(value = account) { return `sf_u::${value || '_'}::p1RangeJobV1`; },
    manifest(value = account) {
      const raw = store.get(this.manifestKey(value));
      return raw ? JSON.parse(raw) : null;
    },
    setAccount(value) {
      account = value;
      sandbox.__mlsSessionAccount = value;
      sandbox.session = value ? { email: value } : null;
    },
    setNow(value) { nowValue = value; },
    setLockAvailable(value) { lockAvailable = value; },
    stopCalls() { return stopCalls; },
    dispatch(type, detail) {
      for (const fn of (listeners[`window:${type}`] || []).slice()) fn({ type, detail: detail || {} });
    }
  };
}

async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function testContinuousCheckpointAndPhiFreeManifest() {
  let pending, monthCalls = 0;
  const r = runtime({
    pullMonth(opts) {
      monthCalls += 1;
      if (monthCalls === 1) {
        pending = opts;
        return new Promise(resolve => { pending.resolve = resolve; });
      }
      /* p1-range-continue-1.0.0: the range comes BACK for the one unproved
         day. It still fails, so the day walks to its attempt cap. */
      const days = opts.dates.map(date => {
        const out = { date, ok: false, complete: false, reason: 'wrong-day' };
        opts.onDayCheckpoint(out); return out;
      });
      return Promise.resolve({ ok: false, complete: false, reason: 'month-partial', days, retry: { dates: opts.dates.slice() } });
    }
  });
  const job = r.api.startMonth('2026-10', {
    provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' },
    includeHistory: true,
    pullVisitBodies: true
  });
  await flush();
  assert(pending, 'month pull did not begin after a verified manifest write and lock');
  assert.strictEqual(pending.dates.length, 15, 'current-month future days were queued');
  assert.strictEqual(pending.dates.at(-1), '2026-10-15', 'the current account day was not the final queued day');

  pending.onDayCheckpoint({ date: '2026-10-01', ok: true, complete: true, reason: 'complete' });
  let manifest = r.manifest();
  assert.strictEqual(manifest.months['2026-10'].days['2026-10-01'].status, 'complete', 'first day did not persist immediately');
  assert.strictEqual(manifest.months['2026-10'].days['2026-10-02'].status, 'pending', 'a future checkpoint was invented');
  pending.onDayCheckpoint({ date: '2026-10-02', ok: false, complete: false, reason: 'wrong-day' });
  manifest = r.manifest();
  assert.strictEqual(manifest.months['2026-10'].days['2026-10-02'].status, 'retry', 'failed day was not retained for retry');
  assert.strictEqual(manifest.months['2026-10'].days['2026-10-02'].reason, 'wrong-day', 'bounded failure reason was not retained');

  for (const date of pending.dates.slice(2)) pending.onDayCheckpoint({ date, ok: true, complete: true, reason: 'complete' });
  pending.resolve({
    ok: false, complete: false, reason: 'month-partial',
    days: pending.dates.map(date => ({ date, ok: date !== '2026-10-02', complete: date !== '2026-10-02', reason: date === '2026-10-02' ? 'wrong-day' : 'complete' }))
  });
  const result = await job;
  assert.strictEqual(result.status, 'needs-attention', 'a day that failed to its attempt cap did not settle as needs-attention');
  assert.strictEqual(r.manifest().months['2026-10'].days['2026-10-02'].attempts, 3, 'the per-day attempt cap did not hold at 3');
  assert.deepStrictEqual(r.manifest().summary.attention, [{ date: '2026-10-02', reason: 'wrong-day' }],
    'the receipt does not list the capped day with its own reason');
  assert.strictEqual(monthCalls, 3, 'the range did not come back for the unproved day exactly to the cap');
  const raw = r.store.get(r.manifestKey());
  assert(!raw.includes('Dr Secret Person') && !raw.includes('Secret Person, MD') && !/"name"|"raw"/.test(raw), 'provider display identity leaked into durable metadata');
  assert.deepStrictEqual(JSON.parse(raw).provider, { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' }, 'manifest did not retain only strong provider identity');
  assert.deepStrictEqual(JSON.parse(raw).options, { includeHistory: true, fullNotes: true }, 'pull choices were not durably frozen');
}

async function testYearFutureExclusion() {
  const observed = [];
  const r = runtime({
    pullMonth(opts) {
      observed.push({ month: opts.month, dates: opts.dates.slice(), full: opts.pullVisitBodies });
      const days = opts.dates.map(date => {
        const out = { date, ok: true, complete: true, reason: 'complete' };
        opts.onDayCheckpoint(out); return out;
      });
      return Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
    }
  });
  const result = await r.api.startYear(2026, { provider: 'all', includeHistory: false, fullNotes: false });
  assert.strictEqual(result.complete, true, 'elapsed current-year range did not complete');
  assert.deepStrictEqual(observed.map(row => row.month), [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
    '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'
  ], 'future current-year months were queued or elapsed months were skipped');
  assert.strictEqual(observed.at(-1).dates.at(-1), '2026-10-15', 'future current-month days were included');
  assert(observed.every(row => row.full === false), 'frozen full-note choice did not reach every month');
  const futureMonth = await r.api.startMonth('2026-11', { provider: 'all' });
  assert.strictEqual(futureMonth.reason, 'invalid-range', 'a future month in the current year was accepted');
  const future = await r.api.startYear(2027, { provider: 'all' });
  assert.strictEqual(future.reason, 'invalid-range', 'a future year was accepted');
}

async function testFinalMonthProofCanDemoteLastDay() {
  const r = runtime({
    pullMonth(opts) {
      const days = opts.dates.map(date => {
        const out = { date, ok: true, complete: true, reason: 'complete' };
        opts.onDayCheckpoint(out); return out;
      });
      return Promise.resolve({
        ok: false, complete: false, reason: 'month-owner-unverified', days,
        retry: { dates: [opts.dates.at(-1)] }
      });
    }
  });
  const result = await r.api.startMonth('2026-10', { provider: 'all' });
  assert.strictEqual(result.status, 'waiting-retry', 'failed final month ownership proof was reported complete');
  assert.strictEqual(r.manifest().months['2026-10'].days['2026-10-15'].status, 'retry', 'final ownership failure did not demote the affected day');
  assert.strictEqual(r.manifest().months['2026-10'].days['2026-10-15'].reason, 'month-owner-unverified', 'final ownership failure lost its bounded reason');

  const shared = new Map([['sf_bk_token', 'synthetic-token']]);
  let orphaned;
  const beforeClose = runtime({
    store: shared,
    pullMonth(opts) { orphaned = opts; return new Promise(() => {}); }
  });
  beforeClose.api.startMonth('2026-10', { provider: 'all' });
  await flush();
  for (const date of orphaned.dates) orphaned.onDayCheckpoint({ date, ok: true, complete: true, reason: 'complete' });
  assert.strictEqual(beforeClose.manifest().months['2026-10'].status, 'running', 'test did not capture the pre-final-proof crash window');
  const afterCloseCalls = [];
  const afterClose = runtime({
    store: shared,
    pullMonth(opts) {
      afterCloseCalls.push(opts.dates.slice());
      const days = opts.dates.map(date => { const out = { date, ok: true, complete: true, reason: 'complete' }; opts.onDayCheckpoint(out); return out; });
      return Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
    }
  });
  assert.strictEqual((await afterClose.api.maybeResume()).complete, true, 'crash-window month could not recover');
  assert.strictEqual(JSON.stringify(afterCloseCalls), JSON.stringify([['2026-10-15']]), 'month was promoted without re-proving its final day/owner receipt');
}

async function testReloadResumeAndLoginWait() {
  const shared = new Map([['sf_bk_token', 'synthetic-token']]);
  let firstPending;
  const first = runtime({
    store: shared,
    pullMonth(opts) {
      firstPending = opts;
      return new Promise(() => {}); // Simulated browser close: this page never settles.
    }
  });
  first.api.startMonth('2026-10', { provider: 'all' });
  await flush();
  firstPending.onDayCheckpoint({ date: '2026-10-01', ok: true, complete: true, reason: 'complete' });
  assert.strictEqual(first.manifest().status, 'running', 'in-flight manifest was not resumable after browser close');

  const resumedCalls = [];
  const second = runtime({
    store: shared,
    pullMonth(opts) {
      resumedCalls.push(opts.dates.slice());
      const days = opts.dates.map(date => {
        const out = date === '2026-10-02'
          ? { date, ok: false, complete: false, reason: 'signin-expired' }
          : { date, ok: true, complete: true, reason: 'complete' };
        opts.onDayCheckpoint(out); return out;
      });
      return Promise.resolve({ ok: false, complete: false, reason: 'signin-expired', days });
    }
  });
  const waiting = await second.api.maybeResume();
  assert(!resumedCalls[0].includes('2026-10-01'), 'reload resume restarted a completed day');
  assert.strictEqual(waiting.status, 'waiting-login', 'login expiration did not preserve position in waiting-login');
  assert.strictEqual(second.manifest().months['2026-10'].days['2026-10-02'].status, 'retry', 'expired-login day was lost');

  second.importer.pullMonth = function (opts) {
    resumedCalls.push(opts.dates.slice());
    const days = opts.dates.map(date => {
      const out = { date, ok: true, complete: true, reason: 'complete' };
      opts.onDayCheckpoint(out); return out;
    });
    return Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
  };
  const complete = await second.api.resume();
  assert.strictEqual(complete.complete, true, 'job did not resume after login recovery');
  assert(!resumedCalls.at(-1).includes('2026-10-01'), 'login recovery restarted a previously completed day');
}

async function testPauseResumeAndCancel() {
  let pending;
  const r = runtime({
    pullMonth(opts) {
      pending = opts;
      return new Promise(resolve => { pending.resolve = resolve; });
    }
  });
  r.store.set('synthetic-clinical-record', 'must-survive');
  const running = r.api.startMonth('2026-10', { provider: 'all' });
  await flush();
  pending.onDayCheckpoint({ date: '2026-10-01', ok: true, complete: true, reason: 'complete' });
  const paused = await r.api.pause();
  assert.strictEqual(paused.status, 'paused', 'pause did not checkpoint the job');
  assert.strictEqual(pending.shouldStop(), true, 'month admission cannot observe the durable pause');
  assert(r.stopCalls() > 0, 'pause did not ask the importer to stop safely');
  pending.resolve({ ok: false, complete: false, reason: 'stopped-by-user', stoppedByUser: true, days: [{ date: '2026-10-01', ok: true, complete: true, reason: 'complete' }] });
  assert.strictEqual((await running).status, 'paused', 'settling pull overwrote the paused state');

  const resumeDates = [];
  r.importer.pullMonth = opts => {
    resumeDates.push(opts.dates.slice());
    const days = opts.dates.map(date => { const out = { date, ok: true, complete: true, reason: 'complete' }; opts.onDayCheckpoint(out); return out; });
    return Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
  };
  assert.strictEqual((await r.api.resume()).complete, true, 'paused job did not resume');
  assert(!resumeDates[0].includes('2026-10-01'), 'resume restarted a completed pre-pause day');

  let cancelPending;
  const c = runtime({
    pullMonth(opts) { cancelPending = opts; return new Promise(resolve => { cancelPending.resolve = resolve; }); }
  });
  c.store.set('synthetic-clinical-record', 'must-survive');
  const cancelRun = c.api.startMonth('2026-10', { provider: 'all' });
  await flush();
  const cancelled = await c.api.cancel();
  assert.strictEqual(cancelled.status, 'cancelled', 'cancel did not checkpoint a terminal cancelled state');
  assert(c.stopCalls() > 0, 'cancel did not ask the importer to stop safely');
  cancelPending.resolve({ ok: false, complete: false, reason: 'stopped-by-user', stoppedByUser: true, days: [] });
  assert.strictEqual((await cancelRun).status, 'cancelled', 'settling pull overwrote cancelled state');
  assert.strictEqual(c.store.get('synthetic-clinical-record'), 'must-survive', 'cancel deleted clinical data');
  assert.strictEqual((await c.api.resume()).reason, 'cancelled', 'cancelled job restarted without an explicit new job');
}

async function testOctoberRetryNeverRestartsJanuary() {
  const firstCalls = [];
  const r = runtime({
    now: Date.UTC(2026, 11, 15, 16, 0, 0),
    pullMonth(opts) {
      firstCalls.push({ month: opts.month, dates: opts.dates.slice() });
      const days = opts.dates.map(date => {
        const fails = opts.month === '2026-10' && date === '2026-10-05';
        const out = { date, ok: !fails, complete: !fails, reason: fails ? 'wrong-day' : 'complete' };
        opts.onDayCheckpoint(out); return out;
      });
      const partial = opts.month === '2026-10';
      return Promise.resolve({ ok: !partial, complete: !partial, reason: partial ? 'month-partial' : 'complete', days });
    }
  });
  const first = await r.api.startYear(2026, { provider: 'all' });
  /* p1-range-continue-1.0.0 (lead ruling 2026-08-17): October failing must
     NOT stop November and December - the range finishes them, comes back to
     October, and settles that ONE day after its attempt cap. */
  assert.deepStrictEqual(firstCalls.slice(0, 12).map(row => row.month), [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'
  ], 'an incomplete October stopped the year instead of continuing to November');
  assert.deepStrictEqual(firstCalls.slice(12).map(row => row.month), ['2026-10', '2026-10'],
    'the range did not come back to the retryable month at the end');
  assert.strictEqual(first.status, 'needs-attention', 'a bounded, settled year did not settle');
  assert.strictEqual(r.manifest().months['2026-01'].status, 'complete', 'January completion was not durable');
  assert.strictEqual(r.manifest().months['2026-12'].status, 'complete', 'December never ran because October failed');
  assert.strictEqual(r.manifest().summary.needsAttention, 1, 'the year receipt miscounted days needing attention');

  const retryCalls = [];
  r.importer.pullMonth = opts => {
    retryCalls.push({ month: opts.month, dates: opts.dates.slice() });
    const days = opts.dates.map(date => { const out = { date, ok: true, complete: true, reason: 'complete' }; opts.onDayCheckpoint(out); return out; });
    return Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
  };
  const done = await r.api.resume();
  assert.strictEqual(done.complete, true, 'year did not finish after the failed day recovered');
  assert.deepStrictEqual(retryCalls.map(row => row.month), ['2026-10'], 'resume restarted months the first run had already completed');
  assert.deepStrictEqual(retryCalls[0].dates, ['2026-10-05'], 'October retry restarted already-completed October days');
  assert(!retryCalls.some(row => row.month === '2026-01'), 'January restarted after an October failure');
}

async function testLockAccountAndPersistenceRefusals() {
  const denied = runtime({ lockAvailable: false });
  const lockResult = await denied.api.startMonth('2026-10', { provider: 'all' });
  assert.strictEqual(lockResult.reason, 'range-lock-denied', 'cross-tab lock denial was not explicit');
  assert.strictEqual(denied.pullCalls.length, 0, 'cross-tab denial still navigated Athena');
  assert.strictEqual(denied.manifest(), null, 'cross-tab denial overwrote the other tab manifest');

  const noLocks = runtime({ noLocks: true });
  assert.strictEqual((await noLocks.api.startMonth('2026-10', { provider: 'all' })).reason, 'range-lock-unavailable', 'missing Web Locks did not fail closed');
  assert.strictEqual(noLocks.pullCalls.length, 0, 'missing required lock still navigated Athena');

  const mismatch = runtime({ readbackMismatch: key => key.endsWith('p1RangeJobV1') });
  assert.strictEqual((await mismatch.api.startMonth('2026-10', { provider: 'all' })).reason, 'metadata-persist-failed', 'read-back mismatch was reported as durable');
  assert.strictEqual(mismatch.pullCalls.length, 0, 'read-back mismatch still navigated Athena');

  const quota = runtime({ quotaThrows: key => key.endsWith('p1RangeJobV1') });
  assert.strictEqual((await quota.api.startMonth('2026-10', { provider: 'all' })).reason, 'storage-full', 'quota failure was not named');
  assert.strictEqual(quota.pullCalls.length, 0, 'quota failure still navigated Athena');

  const misboundNamespace = runtime();
  misboundNamespace.sandbox.uns = suffix => `sf_u::doctor-b@example.invalid::${suffix}`;
  assert.strictEqual((await misboundNamespace.api.startMonth('2026-10', { provider: 'all' })).reason, 'signin',
    'a manifest namespace that did not match the authenticated account was accepted');
  assert.strictEqual(misboundNamespace.pullCalls.length, 0, 'a misbound account namespace still navigated Athena');

  let pending;
  const switched = runtime({
    pullMonth(opts) { pending = opts; return new Promise(resolve => { pending.resolve = resolve; }); }
  });
  const oldAccount = 'doctor-a@example.invalid';
  const activeRun = switched.api.startMonth('2026-10', { provider: 'all' });
  await flush();
  pending.onDayCheckpoint({ date: '2026-10-01', ok: true, complete: true, reason: 'complete' });
  switched.setAccount('doctor-b@example.invalid');
  switched.dispatch('mls:session-boundary', { previousAccount: oldAccount, nextAccount: 'doctor-b@example.invalid' });
  pending.resolve({ ok: false, complete: false, reason: 'stopped-by-user', stoppedByUser: true, days: [
    { date: '2026-10-01', ok: true, complete: true, reason: 'complete' },
    { date: '2026-10-02', ok: true, complete: true, reason: 'complete' }
  ] });
  const switchedResult = await activeRun;
  assert.strictEqual(switchedResult.status, 'account-changed', 'account switch did not stop the frozen job');
  assert.strictEqual(switchedResult.state, null, 'old account operational metadata was returned into the new account session');
  assert(switched.stopCalls() > 0, 'account switch did not stop Athena navigation');
  assert.strictEqual(switched.manifest(oldAccount).status, 'account-changed', 'old account manifest lost its exact resume position');
  assert.notStrictEqual(switched.manifest(oldAccount).months['2026-10'].days['2026-10-02'].status, 'complete',
    'a result settling after the account switch promoted an untrusted old-account day');
  assert.strictEqual(switched.manifest('doctor-b@example.invalid'), null, 'old account job crossed into the new account namespace');
}

function rangeUiFixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box}html,body{margin:0;max-width:100%;font-family:system-ui,sans-serif}body{background:#f4f7f5;color:#20352c}
    #workspace{width:100%;padding:12px}.ez3-prov,.ez3-card{width:100%;max-width:760px;margin:0 auto 12px}
    .ez3-card{padding:14px;border:1px solid #cad8d0;border-radius:12px;background:#fff}.ph{font-weight:700;margin-bottom:8px}
    button,select{font:inherit;min-height:38px;max-width:100%}.ez3-sm{padding:8px 12px;border:1px solid #94aa9e;border-radius:8px;background:#fff}.pri{background:#2e6a4b;color:#fff}
    /* the real panel bounds its own log; without this the fixture's log grows
       over the controls and a click lands on a status line instead */
    #ez3PullLog{max-height:60px;overflow:auto;font-size:11px}
    .ez3-row2{display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:2;margin-top:10px}
  </style></head><body><main id="workspace"></main><script>
  (function(){
    'use strict';
    var params=new URLSearchParams(location.search),account=params.get('account')||'doctor-ui-a@example.invalid';
    var nativeSet=Storage.prototype.setItem;
    window.__rangeFixture={calls:[],stopCalls:0,failWrites:false,cardBuilds:0,account:account,autoMonth:false,autoDays:0,monthDates:[]};
    Storage.prototype.setItem=function(key,value){
      if(window.__rangeFixture.failWrites&&String(key).endsWith('p1RangeJobV1'))throw new DOMException('Synthetic quota','QuotaExceededError');
      return nativeSet.call(this,key,value);
    };
    window.__MLS_AV='synthetic-p1-ui-build';
    window.__MLS_P1_PREVIEW={enabled:true,route:'/1p/',build:'synthetic-p1-ui-build'};
    window.__mlsSessionEpoch=1;window.__mlsSessionAccount=account;window.session={email:account};
    window.uns=function(suffix){return 'sf_u::'+window.__rangeFixture.account+'::'+suffix;};
    nativeSet.call(localStorage,'sf_bk_token','synthetic-browser-token');
    nativeSet.call(localStorage,window.uns('acctTz'),'America/New_York');
    var entry={id:'provider-7',stableKey:'stable-provider-7',name:'Dr Synthetic Provider',raw:'Synthetic Provider, MD',rosterVerified:true};
    function resolveProvider(value){
      var raw=value&&typeof value==='object'?(value.stableKey||value.id||''):String(value||'');
      if(raw.slice(0,3)==='pv:'){try{raw=decodeURIComponent(raw.slice(3));}catch(_decode){return null;}}
      return raw===entry.id||raw===entry.stableKey?Object.assign({},entry):null;
    }
    window.__mlsProviderRoster={installed:true,resolve:resolveProvider,list:function(){return [Object.assign({},entry)];}};
    window.__mlsSI={installed:true,
      _resolveProviderRequest:function(raw){
        if(raw==='all'||raw==null)return {ok:true,provider:'all'};
        var found=resolveProvider(raw);return found?{ok:true,provider:found}:{ok:false,reason:'provider-unverified'};
      },
      pullMonth:function(opts){
        window.__rangeFixture.monthDates.push(opts.dates.slice());
        if(window.__rangeFixture.autoMonth===true){
          /* a slow, verified-empty month so a Pause can land mid-run */
          var dates=opts.dates.slice(),days=[],retry=[];
          return new Promise(function(resolve){
            function step(i){
              if(i>=dates.length){resolve({ok:!retry.length,complete:!retry.length,reason:retry.length?'month-partial':'complete',days:days,retry:{dates:retry}});return;}
              if(opts.shouldStop&&opts.shouldStop()===true){
                for(var k=i;k<dates.length;k++){var s={date:dates[k],ok:false,complete:false,reason:'stopped-by-user'};days.push(s);retry.push(dates[k]);opts.onDayCheckpoint(s);}
                resolve({ok:false,complete:false,reason:'stopped-by-user',stoppedByUser:true,days:days,retry:{dates:retry}});return;
              }
              if(opts.onStatus)opts.onStatus('Month pull '+(i+1)+'/'+dates.length+': '+dates[i],'');
              var one={date:dates[i],ok:true,complete:true,reason:'provider-empty'};
              days.push(one);opts.onDayCheckpoint(one);
              window.__rangeFixture.autoDays++;
              setTimeout(function(){step(i+1);},70);
            }
            step(0);
          });
        }
        var resolvePromise,row={opts:opts,settled:false};
        row.promise=new Promise(function(resolve){resolvePromise=resolve;});
        row.resolve=function(result){if(row.settled)return false;row.settled=true;resolvePromise(result);return true;};
        window.__rangeFixture.calls.push(row);return row.promise;
      },
      stopPull:function(){window.__rangeFixture.stopCalls++;return {requested:true};}
    };
    try{Object.defineProperty(navigator,'locks',{configurable:true,value:{request:function(name,options,callback){return Promise.resolve().then(function(){return callback({name:name});});}}});}catch(_locks){}
    window.__fixtureCall=function(index){var row=window.__rangeFixture.calls[index];if(!row)return null;return {
      month:row.opts.month,dates:row.opts.dates.slice(),provider:JSON.parse(JSON.stringify(row.opts.provider)),
      includeHistory:row.opts.includeHistory,pullVisitBodies:row.opts.pullVisitBodies
    };};
    window.__fixtureCheckpoint=function(index,date,reason){var row=window.__rangeFixture.calls[index];if(!row)return false;return row.opts.onDayCheckpoint({date:date,ok:reason!=='wrong-day',complete:reason!=='wrong-day',reason:reason||'complete'});};
    window.__fixtureSettleStopped=function(index){var row=window.__rangeFixture.calls[index];return !!(row&&row.resolve({ok:false,complete:false,reason:'stopped-by-user',stoppedByUser:true,days:[]}));};
    window.mountStaff=function(mode){
      mode=mode||'all';window.__rangeFixture.cardBuilds++;
      var provider='';
      if(mode!=='missing')provider='<div class="ez3-prov"><label for="ez3Prov">Show visits for</label><select id="ez3Prov" aria-label="Show visits for provider">'+
        '<option value="__all"'+(mode==='all'?' selected':'')+'>Your athenaOne view (default)</option>'+
        '<option value="'+(mode==='unverified'?'pv:stale-provider':'pv:stable-provider-7')+'"'+(mode!=='all'?' selected':'')+'>'+
        (mode==='unverified'?'Stale provider':'Dr Synthetic Provider')+'</option></select></div>';
      document.getElementById('workspace').innerHTML='<section id="staffPrep">'+provider+'<div class="ez3-card ez3-pull">'+
        '<div class="ph" id="monthPullTitle">Pull a month from Athena</div><p id="monthCopy">Existing month pull stays owned here.</p>'+
        '<button type="button" class="ez3-sm pri" id="ez3PullStart">Start month pull</button></div></section>';
      return true;
    };
    /* ---- the REAL Staff Prep pull panel, minus the app around it --------
       mountPullPanel() renders exactly the ids the shipped
       p1-durable-month-1.0.0 block touches; /durable.js then EXECUTES that
       block (plus the shipped pCounts button rules and the shipped click
       wiring) lifted verbatim out of 1p-mls-connect.js. */
    window.mountPullPanel=function(month){
      document.getElementById('workspace').innerHTML='<section id="staffPrep">'+
        '<div class="ez3-prov"><select id="ez3Prov"><option value="pv:stable-provider-7" selected>Dr Synthetic Provider</option></select></div>'+
        '<div class="ez3-card ez3-pull">'+
        '<div class="ph" id="monthPullTitle">Pull a month from Athena</div>'+
        '<div class="prow"><label>Month</label><input type="month" id="ez3sMonth" value="'+(month||'2026-02')+'"></div>'+
        '<div class="barwrap"><div class="bar" id="ez3PullBar"></div></div>'+
        '<div id="ez3PullBarLbl"></div>'+
        '<div class="counts"><b id="ez3cFound">0</b><b id="ez3cSaved">0</b><b id="ez3cDup">0</b><b id="ez3cFail">0</b></div>'+
        '<div class="nowl" id="ez3PullNow"></div><div class="nowl2" id="ez3PullNow2"></div>'+
        '<div class="plog" id="ez3PullLog"></div>'+
        '<div class="ez3-row2">'+
          '<button type="button" id="ez3PullStart">Start month pull</button>'+
          '<button type="button" id="ez3PullResume" style="display:none">Resume month pull</button>'+
          '<button type="button" id="ez3PullPause" style="display:none">Pause</button>'+
          '<button type="button" id="ez3PullRetry" style="display:none">Retry failed days</button>'+
          '<button type="button" id="ez3PullCancel" style="display:none">Cancel</button>'+
        '</div></div></section>';
      if(window.__wirePullPanel)window.__wirePullPanel();
      return true;
    };
    window.switchFixtureAccount=function(next,extra){
      var previous=window.__rangeFixture.account;window.__rangeFixture.account=next;window.__mlsSessionAccount=next;window.session={email:next};window.__mlsSessionEpoch++;
      nativeSet.call(localStorage,window.uns('acctTz'),'America/New_York');
      var detail=Object.assign({previousAccount:previous,nextAccount:next},extra||{});
      window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:detail}));
    };
  })();
  </script><script src="/range.js"></script><script src="/durable.js"></script></body></html>`;
}

/* ===== the shipped durable-month block, lifted verbatim from the ACTIVE
   Staff Prep workspace of 1p-mls-connect.js and given only the tiny host it
   calls. If a refactor renames or drops any of these three pieces the
   extraction fails loudly instead of the test quietly proving nothing. ==== */
function durableMonthBundle() {
  const cut = (startMark, endMark, from) => {
    const a = p1Connect.indexOf(startMark, from || 0);
    assert(a >= 0, 'durable-month extraction: missing ' + startMark);
    const b = p1Connect.indexOf(endMark, a);
    assert(b > a, 'durable-month extraction: unclosed ' + startMark);
    return p1Connect.slice(a, b + endMark.length);
  };
  const helpers = cut('/* ===== p1-durable-month-1.0.0 (the month pull IS the durable job) =====',
    '/* ===== end p1-durable-month-1.0.0 ===== */');
  const buttons = cut('/* ===== p1-durable-month-1.0.0 (controls follow the SAVED job) =====',
    '/* ===== end p1-durable-month-1.0.0 ===== */');
  const wireStart = p1Connect.indexOf("    on('ez3PullResume', function () { if (!p1RangeResume()) startMonthPull(true); });");
  const wireEnd = p1Connect.indexOf("    on('ez3sPullToday'", wireStart);
  assert(wireStart >= 0 && wireEnd > wireStart, 'durable-month extraction: the Pause/Resume/Cancel wiring is missing');
  const wiring = p1Connect.slice(wireStart, wireEnd);
  assert(helpers.includes('function p1RangeAdopt()') && helpers.includes('function p1RangeStartMonth('),
    'the durable-month helpers no longer carry adopt/start');
  assert(buttons.includes("$('ez3PullResume')") && buttons.includes("$('ez3PullPause')"),
    'the shipped button rules no longer drive Resume/Pause');
  return `(function(){
    'use strict';
    var P = null;
    function $(id){ return document.getElementById(id); }
    function isFn(v){ return typeof v === 'function'; }
    function safe(fn, d){ try { return fn(); } catch (e) { return d; } }
    function pSet(id, txt){ var e = $(id); if (e) e.textContent = String(txt == null ? '' : txt); }
    function plog(msg){ var l = $('ez3PullLog'); if (l) { var d = document.createElement('div'); d.textContent = String(msg); l.appendChild(d); } }
    function render(){}
    function cancelPullRun(){ window.__panel.legacyCancels++; }
    function startMonthPull(retryOnly){ window.__panel.legacyStarts.push(!!retryOnly); }
    function pullMonthRange(ym){
      var m = /^(\\d{4})-(\\d{2})$/.exec(String(ym || ''));
      if (!m) return null;
      var last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate(), keys = [];
      for (var d = 1; d <= last; d++) keys.push(ym + '-' + (d < 10 ? '0' : '') + d);
      return { ym: ym, from: keys[0], to: keys[keys.length - 1], keys: keys, label: ym };
    }
    function freshPull(range, provider){
      return { range: range, provider: provider || 'all', keysToRun: range.keys.slice(), running: false,
        cancelled: false, dayStatus: {}, found: 0, saved: 0, dups: 0, failedRows: 0, emptyDays: [],
        failedDays: [], providersSeen: {}, extNav: false, existing: null, log: [] };
    }
    function pCounts(){
      if (!P) return;
      var done = 0; P.range.keys.forEach(function (k) { var st = P.dayStatus[k]; if (st && /^(done|empty|failed)$/.test(st.status)) done++; });
      pSet('ez3cFail', String(P.failedDays.length));
      var bar = $('ez3PullBar'); if (bar) bar.style.width = Math.round(done * 100 / Math.max(1, P.range.keys.length)) + '%';
      pSet('ez3PullBarLbl', done + ' of ' + P.range.keys.length + ' days' + (P.emptyDays.length ? (' \\u00b7 ' + P.emptyDays.length + ' empty') : ''));
${buttons.split('\n').map(l => '      ' + l).join('\n')}
    }
${helpers.split('\n').map(l => '    ' + l).join('\n')}
    function on(id, fn){ var e = $(id); if (e) e.onclick = fn; }
    window.__panel = { legacyCancels: 0, legacyStarts: [],
      state: function(){ return P ? { running: P.running, owned: P.p1Owned === true, failedDays: P.failedDays.slice(), month: P.range && P.range.ym } : null; },
      adopt: function(){ return !!p1RangeAdopt(); },
      paint: function(){ return !!p1RangePaint(); },
      startMonth: function(){
        var month = $('ez3sMonth') ? $('ez3sMonth').value : '';
        var gate = { ok: true, provider: { id: 'provider-7', stableKey: 'stable-provider-7', name: 'Dr Synthetic Provider' } };
        return p1RangeStartMonth(month, pullMonthRange(month), gate);
      } };
    window.__wirePullPanel = function(){
      p1RangeAdopt();
      on('ez3PullStart', function(){ window.__panel.startMonth(); });
      on('ez3PullRetry', function(){ startMonthPull(true); });
${wiring.split('\n').map(l => '  ' + l).join('\n')}
      pCounts();
    };
  })();`;
}

function serveRangeUiFixture() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      res.setHeader('Cache-Control', 'no-store');
      if (pathname === '/range.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        return res.end(source);
      }
      if (pathname === '/durable.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        return res.end(durableMonthBundle());
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(rangeUiFixtureHtml());
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function settleBrowserJob(page, index) {
  await page.evaluate(value => window.__fixtureSettleStopped(value), index);
  await page.waitForTimeout(60);
}

/* ==========================================================================
 * p1-durable-month-1.0.0 (lead ruling 2026-08-17): the doctor-facing MONTH
 * pull must BE the durable job. Real Chrome, the shipped panel bytes, the
 * real range engine: Start creates a job, Pause stops it and keeps the
 * checkpoint, a full page RELOAD shows that job with ONE click, and Resume
 * continues without re-pulling a proved day.
 * ======================================================================== */
async function testDurableMonthPanel() {
  const server = await serveRangeUiFixture();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let failure = null;
  try {
    const context = await browser.newContext({ viewport: { width: 980, height: 800 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
    await page.goto(base + '/?account=doctor-month@example.invalid', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true && window.__panel);
    await page.evaluate(() => { window.__rangeFixture.autoMonth = true; window.mountPullPanel('2026-02'); });

    /* the panel opens clean: Start only */
    const fresh = await page.evaluate(() => ({
      start: getComputedStyle(document.getElementById('ez3PullStart')).display,
      resume: getComputedStyle(document.getElementById('ez3PullResume')).display,
      pause: getComputedStyle(document.getElementById('ez3PullPause')).display,
      saved: localStorage.getItem(window.uns('p1RangeJobV1'))
    }));
    assert.notStrictEqual(fresh.start, 'none', 'the clean panel hid Start month pull');
    assert.strictEqual(fresh.resume, 'none', 'the clean panel offered Resume with nothing saved');
    assert.strictEqual(fresh.saved, null, 'a range manifest existed before the doctor pressed anything');

    /* 1. Start creates a DURABLE JOB, not a bare pullMonth */
    await page.click('#ez3PullStart');
    await page.waitForFunction(() => {
      const raw = localStorage.getItem(window.uns('p1RangeJobV1'));
      return !!raw && JSON.parse(raw).kind === 'month';
    });
    await page.waitForFunction(() => window.__rangeFixture.autoDays >= 4);
    const started = await page.evaluate(() => {
      const job = JSON.parse(localStorage.getItem(window.uns('p1RangeJobV1')));
      return { kind: job.kind, target: job.target, provider: job.provider, options: job.options,
        legacyStarts: window.__panel.legacyStarts.length,
        pause: getComputedStyle(document.getElementById('ez3PullPause')).display,
        start: getComputedStyle(document.getElementById('ez3PullStart')).display,
        bar: document.getElementById('ez3PullBarLbl').textContent };
    });
    assert.strictEqual(started.kind, 'month', 'Start month pull did not create a durable MONTH job');
    assert.strictEqual(started.target, '2026-02', 'the durable job did not take the picked month');
    assert.deepStrictEqual(started.provider, { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' },
      'the durable job did not freeze the verified provider identity');
    assert.deepStrictEqual(started.options, { includeHistory: true, fullNotes: false },
      'the durable job weakened history or turned full notes on by itself');
    assert.strictEqual(started.legacyStarts, 0, 'the panel fell through to the old in-tab month pull');
    assert.notStrictEqual(started.pause, 'none', 'a running durable job did not offer Pause');
    assert.strictEqual(started.start, 'none', 'Start stayed available while a job was running');
    assert(/of 28 days/.test(started.bar), 'the panel bar is not counting the durable job days: ' + started.bar);

    /* 2. Pause stops it and keeps every verified day */
    await page.click('#ez3PullPause');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem(window.uns('p1RangeJobV1'))).status === 'paused');
    const paused = await page.evaluate(() => {
      const job = JSON.parse(localStorage.getItem(window.uns('p1RangeJobV1')));
      return { status: job.status, complete: job.summary.complete, days: job.summary.days,
        stopCalls: window.__rangeFixture.stopCalls,
        resume: getComputedStyle(document.getElementById('ez3PullResume')).display,
        start: getComputedStyle(document.getElementById('ez3PullStart')).display };
    });
    assert.strictEqual(paused.status, 'paused', 'Pause did not checkpoint the durable job');
    assert(paused.complete >= 4, 'Pause lost the days already verified (kept ' + paused.complete + ')');
    assert.strictEqual(paused.days, 28, 'the paused job forgot the size of the month');
    assert(paused.stopCalls > 0, 'Pause did not ask the importer to stop');
    assert.notStrictEqual(paused.resume, 'none', 'a paused job did not offer Resume');
    assert.strictEqual(paused.start, 'none', 'a paused job still offered a fresh Start over its checkpoint');
    const provedBeforeReload = await page.evaluate(() => {
      const job = JSON.parse(localStorage.getItem(window.uns('p1RangeJobV1')));
      const days = job.months['2026-02'].days;
      return Object.keys(days).filter(d => days[d].status === 'complete');
    });

    /* 3. a full RELOAD shows the unfinished job with ONE click */
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true && window.__panel);
    await page.evaluate(() => { window.__rangeFixture.autoMonth = true; window.mountPullPanel('2026-02'); });
    const reloaded = await page.evaluate(() => ({
      resume: getComputedStyle(document.getElementById('ez3PullResume')).display,
      start: getComputedStyle(document.getElementById('ez3PullStart')).display,
      bar: document.getElementById('ez3PullBarLbl').textContent,
      month: window.__panel.state() && window.__panel.state().month,
      monthCalls: window.__rangeFixture.monthDates.length
    }));
    assert.strictEqual(reloaded.monthCalls, 0, 'the reload restarted Athena work on its own');
    assert.notStrictEqual(reloaded.resume, 'none', 'a reload hid the unfinished job behind no control at all');
    assert.strictEqual(reloaded.start, 'none', 'a reload offered a fresh Start that would abandon the checkpoint');
    assert.strictEqual(reloaded.month, '2026-02', 'the reload did not adopt the saved month');
    assert(/of 28 days/.test(reloaded.bar) && !/^0 of/.test(reloaded.bar),
      'the reload showed no saved progress: ' + reloaded.bar);

    /* 4. ONE click resumes, and no proved day is pulled again */
    await page.click('#ez3PullResume');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem(window.uns('p1RangeJobV1'))).status === 'complete', null, { timeout: 20000 });
    const finished = await page.evaluate(() => {
      const job = JSON.parse(localStorage.getItem(window.uns('p1RangeJobV1')));
      return { status: job.status, summary: job.summary, run: job.run,
        asked: window.__rangeFixture.monthDates.slice(),
        receipt: document.getElementById('ez3PullNow2').textContent,
        now: document.getElementById('ez3PullNow').textContent };
    });
    assert.strictEqual(finished.status, 'complete', 'Resume did not finish the month');
    assert.strictEqual(finished.summary.complete, 28, 'the resumed month did not account for every day');
    assert.strictEqual(finished.summary.empty, 28, 'the receipt lost the verified-empty count');
    assert.strictEqual(finished.run.skippedComplete, provedBeforeReload.length,
      'the receipt does not report the days Resume skipped as already verified');
    assert.strictEqual(finished.asked.length, 1, 'Resume ran more than one month request');
    provedBeforeReload.forEach(day => {
      assert(!finished.asked[0].includes(day), 'Resume re-pulled ' + day + ', already proved before the reload');
    });
    assert(/days done/.test(finished.receipt) && /verified empty/.test(finished.receipt) &&
      /skipped as already verified/.test(finished.receipt),
      'the panel does not show the completion receipt: ' + finished.receipt);
    assert(/complete/i.test(finished.now), 'the panel never said the month finished: ' + finished.now);
    assert.strictEqual(pageErrors.length, 0, 'the durable month panel raised browser errors: ' + pageErrors.join(' | '));
    await context.close();
  } catch (error) {
    failure = error;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  if (failure) throw failure;
}

async function testDoctorFacingYearPullUi() {
  const server = await serveRangeUiFixture();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let failure = null;
  try {
    const context = await browser.newContext({ viewport: { width: 980, height: 800 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
    await page.goto(base + '/?account=doctor-ui-a@example.invalid', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true);
    assert.strictEqual(await page.locator('#mlsP1YearPull').count(), 0, 'Year controls appeared without the canonical Staff Prep month card');

    await page.evaluate(() => window.mountStaff('selected'));
    await page.waitForSelector('#mlsP1YearPull');
    const initial = await page.evaluate(() => {
      const root = document.getElementById('mlsP1YearPull'), select = document.getElementById('mlsP1YearChoice');
      return {
        rootCount: document.querySelectorAll('#mlsP1YearPull').length,
        directChild: root.parentElement.classList.contains('ez3-pull'),
        monthTitle: document.getElementById('monthPullTitle').textContent,
        monthButton: document.getElementById('ez3PullStart').textContent,
        years: Array.from(select.options).map(option => option.value), value: select.value,
        provider: document.getElementById('mlsP1YearProvider').textContent,
        role: document.getElementById('mlsP1YearStatus').getAttribute('role'),
        live: document.getElementById('mlsP1YearStatus').getAttribute('aria-live')
      };
    });
    assert.strictEqual(initial.rootCount, 1, 'dynamic Staff Prep mount produced duplicate Year controls');
    assert.strictEqual(initial.directChild, true, 'Year controls were not a child of the canonical month-pull card');
    assert.strictEqual(initial.monthTitle, 'Pull a month from Athena', 'the established month-pull title was rebuilt');
    assert.strictEqual(initial.monthButton, 'Start month pull', 'the established month-pull action was replaced');
    assert.strictEqual(initial.years.length, 10, 'bounded year picker did not expose current plus nine historical years');
    assert.strictEqual(initial.value, initial.years[0], 'year picker did not default to the current account year');
    assert(initial.provider.includes('Dr Synthetic Provider'), 'Year controls did not follow the existing selected provider');
    assert.strictEqual(initial.role, 'status', 'routine Year progress is not an accessible status');
    assert.strictEqual(initial.live, 'polite', 'Year progress uses repetitive assertive announcements');

    const currentYear = initial.years[0];
    const pickedYear = initial.years[1];
    await page.selectOption('#mlsP1YearChoice', pickedYear);
    await page.check('#mlsP1YearFullNotes');
    /* The production clunky owner groups this exact node under its fold. The
       range owner must accept that host while it remains inside the canonical
       pull card, preserving node identity, selection and the four handlers. */
    await page.evaluate(() => {
      const root = document.getElementById('mlsP1YearPull');
      const card = root.closest('.ez3-card.ez3-pull');
      const fold = document.createElement('details'); fold.id = 'mlsClunkyPullMore';
      const body = document.createElement('div'); body.id = 'mlsClunkyPullMoreBody';
      fold.appendChild(body); card.insertBefore(fold, root); body.appendChild(root);
      fold.open = true;
      window.__foldedYearIdentity = root;
      document.body.appendChild(document.createElement('i'));
    });
    await page.waitForTimeout(220);
    const folded = await page.evaluate(() => ({
      same: window.__foldedYearIdentity === document.getElementById('mlsP1YearPull'),
      parent: document.getElementById('mlsP1YearPull').parentElement.id,
      year: document.getElementById('mlsP1YearChoice').value,
      full: document.getElementById('mlsP1YearFullNotes').checked,
      roots: document.querySelectorAll('#mlsP1YearPull').length
    }));
    assert.strictEqual(folded.same, true, 'rangejobs replaced the year controller after the Staff Prep fold moved it');
    assert.strictEqual(folded.parent, 'mlsClunkyPullMoreBody', 'rangejobs fought the canonical Staff Prep fold host');
    assert.strictEqual(folded.year, pickedYear, 'Staff Prep fold churn lost the chosen year');
    assert.strictEqual(folded.full, true, 'Staff Prep fold churn lost the full-note choice');
    assert.strictEqual(folded.roots, 1, 'Staff Prep fold integration duplicated the year controller');
    await page.evaluate(() => {
      const start = document.getElementById('mlsP1YearStart');
      start.click();
      start.click();
    });
    await page.waitForFunction(() => window.__rangeFixture.calls.length === 1);
    await page.waitForFunction(() => document.getElementById('mlsP1YearPull').dataset.status === 'running' &&
      !document.getElementById('mlsP1YearPause').disabled);
    await page.waitForTimeout(40);
    const running = await page.evaluate(() => {
      const call = window.__fixtureCall(0), api = window.__mlsP1RangeJobs, key = window.uns('p1RangeJobV1');
      return {
        call, callCount: window.__rangeFixture.calls.length, state: api.state(), raw: localStorage.getItem(key),
        selectedYear: document.getElementById('mlsP1YearChoice').value,
        yearDisabled: document.getElementById('mlsP1YearChoice').disabled,
        fullDisabled: document.getElementById('mlsP1YearFullNotes').disabled,
        pauseDisabled: document.getElementById('mlsP1YearPause').disabled,
        statusText: document.getElementById('mlsP1YearStatus').textContent,
        roots: document.querySelectorAll('#mlsP1YearPull').length
      };
    });
    assert.strictEqual(running.callCount, 1, 'rapid double Start admitted two Year jobs');
    assert(!/already running|already exists/i.test(running.statusText), 'rapid double Start painted a confusing second refusal');
    assert.strictEqual(running.call.month, pickedYear + '-01', 'picked historical year did not drive the engine');
    assert.strictEqual(running.call.provider.id, 'provider-7', 'selected provider ID did not reach the existing importer');
    assert.strictEqual(running.call.provider.stableKey, 'stable-provider-7', 'selected provider stable key did not reach the importer');
    assert.strictEqual(running.call.includeHistory, true, 'Year UI weakened the existing history pull');
    assert.strictEqual(running.call.pullVisitBodies, true, 'full-visit-note choice did not reach the importer');
    assert.strictEqual(running.state.target, pickedYear, 'active manifest target differs from the chosen year');
    assert.strictEqual(running.selectedYear, pickedYear, 'active UI does not show its frozen manifest year');
    assert.strictEqual(running.yearDisabled, true, 'active manifest year can be changed mid-job');
    assert.strictEqual(running.fullDisabled, true, 'full-note scope can be changed mid-job');
    assert.strictEqual(running.pauseDisabled, false, 'Start admission lock kept Pause disabled for the full Year job');
    assert.strictEqual(running.roots, 1, 'self-induced observer refresh duplicated the panel');
    assert(!running.raw.includes('Dr Synthetic Provider') && !running.raw.includes('Synthetic Provider, MD') && !/"name"|"raw"/.test(running.raw),
      'doctor display text leaked into durable Year metadata');

    const completedDate = running.call.dates[0];
    await page.evaluate(date => window.__fixtureCheckpoint(0, date, 'complete'), completedDate);
    await page.waitForFunction(() => Number(document.getElementById('mlsP1YearProgress').value) === 1);
    const progress = await page.evaluate(() => ({
      value: Number(document.getElementById('mlsP1YearProgress').value),
      max: Number(document.getElementById('mlsP1YearProgress').max),
      text: document.getElementById('mlsP1YearCount').textContent,
      aria: document.getElementById('mlsP1YearProgress').getAttribute('aria-valuetext')
    }));
    assert.strictEqual(progress.value, 1, 'durable day checkpoint did not advance visible progress');
    assert(progress.max >= 365 && progress.text.startsWith('1 / ') && progress.aria.startsWith('1 of '), 'visible progress is not based on truthful manifest day counts');

    await page.click('#mlsP1YearPause');
    await page.waitForFunction(() => document.getElementById('mlsP1YearPull').dataset.status === 'paused');
    const paused = await page.evaluate(() => ({
      stopCalls: window.__rangeFixture.stopCalls,
      resumeHidden: document.getElementById('mlsP1YearResume').hidden,
      cancelHidden: document.getElementById('mlsP1YearCancel').hidden,
      text: document.getElementById('mlsP1YearStatus').textContent
    }));
    assert(paused.stopCalls > 0, 'Pause did not stop the existing importer safely');
    assert.strictEqual(paused.resumeHidden, false, 'paused job did not expose Resume');
    assert.strictEqual(paused.cancelHidden, false, 'paused job did not expose Cancel');
    assert(paused.text.includes('Resume continues from the saved checkpoint'), 'paused status does not explain truthful recovery');
    await settleBrowserJob(page, 0);

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true);
    await page.evaluate(() => window.mountStaff('selected'));
    await page.waitForFunction(() => document.getElementById('mlsP1YearPull') && document.getElementById('mlsP1YearPull').dataset.status === 'paused');
    const reloaded = await page.evaluate(() => ({
      calls: window.__rangeFixture.calls.length,
      year: document.getElementById('mlsP1YearChoice').value,
      disabled: document.getElementById('mlsP1YearChoice').disabled,
      progress: Number(document.getElementById('mlsP1YearProgress').value),
      status: document.getElementById('mlsP1YearStatus').textContent
    }));
    assert.strictEqual(reloaded.calls, 0, 'reload auto-started a paused job');
    assert.strictEqual(reloaded.year, pickedYear, 'reload did not restore the saved target year');
    assert.strictEqual(reloaded.disabled, true, 'reload made an active saved target editable');
    assert.strictEqual(reloaded.progress, 1, 'reload lost truthful saved progress');
    assert(reloaded.status.startsWith('Paused:'), 'reload hid the saved paused status');

    await page.click('#mlsP1YearResume');
    await page.waitForFunction(() => window.__rangeFixture.calls.length === 1);
    const resumed = await page.evaluate(() => window.__fixtureCall(0));
    assert(!resumed.dates.includes(completedDate), 'Resume restarted an already-verified day');
    await page.click('#mlsP1YearCancel');
    await page.waitForFunction(() => document.getElementById('mlsP1YearPull').dataset.status === 'cancelled');
    await settleBrowserJob(page, 0);
    assert.strictEqual(await page.inputValue('#mlsP1YearChoice'), pickedYear, 'terminal job discarded the chosen year for an explicit new pull');
    assert.strictEqual(await page.isEnabled('#mlsP1YearChoice'), true, 'terminal job did not re-enable the new-job year choice');

    await page.evaluate(() => { window.__oldYearRoot = document.getElementById('mlsP1YearPull'); window.mountStaff('all'); });
    await page.waitForFunction(() => document.getElementById('mlsP1YearPull') && document.getElementById('mlsP1YearProvider').textContent.includes('athenaOne'));
    const remount = await page.evaluate(() => ({
      one: document.querySelectorAll('#mlsP1YearPull').length,
      replaced: window.__oldYearRoot !== document.getElementById('mlsP1YearPull'),
      year: document.getElementById('mlsP1YearChoice').value
    }));
    assert.strictEqual(remount.one, 1, 'Staff Prep rerender duplicated Year controls');
    assert.strictEqual(remount.replaced, true, 'Staff Prep rerender left controls attached to the removed card');
    assert.strictEqual(remount.year, pickedYear, 'Staff Prep rerender discarded the explicit new-job year choice');
    await page.selectOption('#mlsP1YearChoice', currentYear);
    await page.uncheck('#mlsP1YearFullNotes');
    await page.evaluate(() => document.body.appendChild(document.createElement('i')));
    await page.waitForTimeout(30);
    assert.strictEqual(await page.inputValue('#mlsP1YearChoice'), currentYear, 'unrelated rerender activity overwrote the new-job year choice');
    assert.strictEqual(await page.isChecked('#mlsP1YearFullNotes'), false, 'unrelated rerender activity restored a stale full-note choice');
    await page.click('#mlsP1YearStart');
    await page.waitForFunction(() => window.__rangeFixture.calls.length === 2);
    const allProvider = await page.evaluate(() => window.__fixtureCall(1));
    assert.strictEqual(allProvider.month, currentYear + '-01', 'new all-provider job ignored the newly picked year');
    assert.strictEqual(allProvider.provider, 'all', 'default provider selection was narrowed or guessed');
    assert.strictEqual(allProvider.pullVisitBodies, false, 'unchecked full-note choice was not honored');
    await page.click('#mlsP1YearCancel');
    await settleBrowserJob(page, 1);
    assert.strictEqual(pageErrors.length, 0, 'selected/all/reload Year UI raised browser errors: ' + pageErrors.join(' | '));
    await context.close();

    const errorContext = await browser.newContext({ viewport: { width: 820, height: 720 } });
    const errorPage = await errorContext.newPage();
    const errorPageErrors = [];
    errorPage.on('pageerror', error => errorPageErrors.push(String(error && error.message || error)));
    await errorPage.goto(base + '/?account=doctor-ui-error@example.invalid', { waitUntil: 'load' });
    await errorPage.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true);
    await errorPage.evaluate(() => window.mountStaff('all'));
    await errorPage.waitForSelector('#mlsP1YearPull');
    await errorPage.evaluate(() => { window.__rangeFixture.failWrites = true; });
    await errorPage.click('#mlsP1YearStart');
    await errorPage.waitForFunction(() => document.getElementById('mlsP1YearPull').dataset.error === 'true');
    const storageError = await errorPage.evaluate(() => ({
      calls: window.__rangeFixture.calls.length,
      text: document.getElementById('mlsP1YearStatus').textContent,
      role: document.getElementById('mlsP1YearStatus').getAttribute('role'),
      live: document.getElementById('mlsP1YearStatus').getAttribute('aria-live')
    }));
    assert.strictEqual(storageError.calls, 0, 'unverified manifest write still navigated Athena');
    assert(storageError.text.includes('browser storage is full'), 'storage refusal was hidden behind a ready state');
    assert.strictEqual(storageError.role, 'status', 'error rerenders use repeating assertive alerts');
    assert.strictEqual(storageError.live, 'polite', 'error rerenders use repeating assertive announcements');
    await errorPage.reload({ waitUntil: 'load' });
    await errorPage.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true);
    await errorPage.evaluate(() => window.mountStaff('unverified'));
    await errorPage.waitForFunction(() => document.getElementById('mlsP1YearPull').dataset.error === 'true' && document.getElementById('mlsP1YearStart').disabled);
    assert((await errorPage.textContent('#mlsP1YearStatus')).includes('could not be verified'), 'unverified selected provider was not explained in-place');
    assert.strictEqual(errorPageErrors.length, 0, 'error-state Year UI raised browser errors: ' + errorPageErrors.join(' | '));
    await errorContext.close();

    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const phone = await phoneContext.newPage();
    await phone.goto(base + '/?account=doctor-ui-phone@example.invalid', { waitUntil: 'load' });
    await phone.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true);
    await phone.evaluate(() => window.mountStaff('all'));
    await phone.waitForSelector('#mlsP1YearPull');
    const mobile = await phone.evaluate(() => {
      const root = document.getElementById('mlsP1YearPull'), rect = root.getBoundingClientRect();
      const controls = Array.from(root.querySelectorAll('button:not([hidden]),select:not([hidden])')).map(node => ({
        id: node.id, height: node.getBoundingClientRect().height, left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right
      }));
      return {
        left: rect.left, right: rect.right, viewport: innerWidth,
        overflow: document.documentElement.scrollWidth - innerWidth,
        position: getComputedStyle(root).position, controls,
        sectionLabel: root.getAttribute('aria-labelledby'),
        yearLabel: document.querySelector('label[for="mlsP1YearChoice"]') && document.querySelector('label[for="mlsP1YearChoice"]').textContent.trim(),
        progressLabel: document.getElementById('mlsP1YearProgress').getAttribute('aria-label'),
        startText: document.getElementById('mlsP1YearStart').textContent
      };
    });
    assert(mobile.left >= -0.5 && mobile.right <= mobile.viewport + 0.5 && mobile.overflow <= 1, 'phone Year controls overflow the viewport');
    assert.notStrictEqual(mobile.position, 'fixed', 'phone Year controls obstruct the viewport as a fixed overlay');
    assert(mobile.controls.every(control => control.height >= 44 && control.left >= -0.5 && control.right <= mobile.viewport + 0.5),
      'phone Year controls are clipped or smaller than the 44px touch target');
    assert.strictEqual(mobile.sectionLabel, 'mlsP1YearTitle', 'Year section lost its visible accessible label');
    assert(mobile.yearLabel.startsWith('Year') && mobile.progressLabel === 'Year pull progress' && /Start [0-9]{4} year pull/.test(mobile.startText),
      'phone controls lack understandable labels');
    await phoneContext.close();

    const boundaryContext = await browser.newContext({ viewport: { width: 900, height: 760 } });
    const boundary = await boundaryContext.newPage();
    const boundaryErrors = [];
    boundary.on('pageerror', error => boundaryErrors.push(String(error && error.message || error)));
    await boundary.goto(base + '/?account=doctor-ui-session-a@example.invalid', { waitUntil: 'load' });
    await boundary.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true);
    await boundary.evaluate(() => window.mountStaff('selected'));
    await boundary.waitForSelector('#mlsP1YearPull');
    await boundary.click('#mlsP1YearStart');
    await boundary.waitForFunction(() => window.__rangeFixture.calls.length === 1);
    const boundaryDate = await boundary.evaluate(() => window.__fixtureCall(0).dates[0]);
    await boundary.evaluate(date => window.__fixtureCheckpoint(0, date, 'complete'), boundaryDate);
    await boundary.evaluate(() => window.switchFixtureAccount('doctor-ui-session-b@example.invalid', { patientName: 'Synthetic Patient Must Not Persist' }));
    await boundary.waitForFunction(() => window.__rangeFixture.stopCalls > 0 && document.getElementById('mlsP1YearPull').dataset.status === 'ready');
    const switched = await boundary.evaluate(() => ({
      oldRaw: localStorage.getItem('sf_u::doctor-ui-session-a@example.invalid::p1RangeJobV1'),
      newRaw: localStorage.getItem('sf_u::doctor-ui-session-b@example.invalid::p1RangeJobV1'),
      status: document.getElementById('mlsP1YearStatus').textContent,
      values: Object.keys(localStorage).map(key => localStorage.getItem(key)).join('|')
    }));
    assert.strictEqual(JSON.parse(switched.oldRaw).status, 'account-changed', 'session switch did not freeze the old account job');
    assert.strictEqual(switched.newRaw, null, 'old Year job crossed into the new account namespace');
    assert(switched.status.startsWith('Ready.'), 'new account inherited the old account progress surface');
    assert(!switched.values.includes('Synthetic Patient Must Not Persist'), 'session detail patient text reached durable metadata');
    await settleBrowserJob(boundary, 0);
    const reverted = await boundary.evaluate(() => {
      const api = window.__mlsP1RangeJobs, result = api.revert();
      return { result, installed: api.installed, root: !!document.getElementById('mlsP1YearPull'), style: !!document.getElementById('mlsP1RangeJobsCss') };
    });
    assert.strictEqual(reverted.result, true, 'Year owner refused exact revert');
    assert.strictEqual(reverted.installed, false, 'reverted Year API remained operational');
    assert.strictEqual(reverted.root, false, 'revert left Year controls in Staff Prep');
    assert.strictEqual(reverted.style, false, 'revert left Year styles behind');
    await boundary.evaluate(() => {
      window.mountStaff('all');
      window.dispatchEvent(new CustomEvent('mls:ui-ready'));
      window.dispatchEvent(new CustomEvent('mls:view-changed'));
      document.body.appendChild(document.createElement('i'));
    });
    await boundary.waitForTimeout(100);
    const afterRevert = await boundary.evaluate(() => ({
      root: !!document.getElementById('mlsP1YearPull'), style: !!document.getElementById('mlsP1RangeJobsCss'),
      month: document.getElementById('ez3PullStart').textContent, provider: !!document.getElementById('ez3Prov')
    }));
    assert.strictEqual(afterRevert.root, false, 'reverted observer remounted Year controls');
    assert.strictEqual(afterRevert.style, false, 'reverted lifecycle event recreated Year styles');
    assert.strictEqual(afterRevert.month, 'Start month pull', 'revert damaged the canonical month action');
    assert.strictEqual(afterRevert.provider, true, 'revert removed the canonical provider selector');
    assert.strictEqual(boundaryErrors.length, 0, 'session/revert Year UI raised browser errors: ' + boundaryErrors.join(' | '));
    await boundaryContext.close();
  } catch (error) {
    failure = error;
  }
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  if (failure) throw failure;
}

(async function main() {
  await testContinuousCheckpointAndPhiFreeManifest();
  await testYearFutureExclusion();
  await testFinalMonthProofCanDemoteLastDay();
  await testReloadResumeAndLoginWait();
  await testPauseResumeAndCancel();
  await testOctoberRetryNeverRestartsJanuary();
  await testLockAccountAndPersistenceRefusals();
  await testDurableMonthPanel();
  await testDoctorFacingYearPullUi();
  console.log('PASS /p1 durable range jobs + Staff Prep Month/Year controls: PHI-free checkpoints, a per-day attempt cap that settles a stuck day as needs-attention instead of blocking later months, selected/all provider, bounded year choice, truthful progress, rapid-Start guard, reload, pause/resume/cancel, errors, phone layout, session wall, exact revert — and the doctor-facing MONTH pull now IS that durable job: Start creates a manifest with the frozen provider, Pause keeps every verified day, a full page reload shows the unfinished job with ONE click, and Resume finishes it without re-pulling a proved day');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

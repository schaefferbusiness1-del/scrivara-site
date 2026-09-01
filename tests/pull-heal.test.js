'use strict';

/* pullheal-1.0.0 proof - the self-healing supervisor and the health tracker.
 *
 * OWNER, 2026-09-01: "needs attention needs to be 0 or its not even worth
 * doing as this has to be accurate. why dont u make a self healing fixer and
 * tracker to make sure things always work".
 *
 * Every case below runs the REAL engine (1p-feat_mls_rangejobs.js) in an
 * isolated VM against a synthetic importer and a synthetic localStorage. No
 * Athena account, no backend, no browser, no PHI. The synthetic provider is
 * deliberately given a display name so the PHI case can prove that name never
 * reaches the durable health record.
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const P1 = '1p-feat_mls_rangejobs.js';
const source = fs.readFileSync(P1, 'utf8');
const productionSource = fs.readFileSync('feat_mls_rangejobs.js', 'utf8');
const clonedSource = fs.readFileSync('cloned-feat_mls_rangejobs.js', 'utf8');

const EXT_OLD = '3.0.99';
const EXT_NEW = '3.0.100';
const ACCOUNT = 'doctor-a@example.invalid';
const PROVIDER_NAME = 'Dr Secret Person';
const PROVIDER_RAW = 'Secret Person, MD';

/* ------------------------------------------------------------------ */
/* harness                                                             */
/* ------------------------------------------------------------------ */
function runtime(options = {}) {
  const store = options.store || new Map();
  const listeners = Object.create(null);
  const pending = [];
  const parked = [];
  const pullCalls = [];
  let timerSeq = 0;
  let account = ACCOUNT;
  let nowValue = options.now || Date.UTC(2026, 9, 15, 16, 0, 0);
  let stopCalls = 0;
  let workerTickMs = 0;
  let workerLive = null;

  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowValue])); }
    static now() { return nowValue; }
  }

  const localStorage = {
    getItem(key) { key = String(key); return store.has(key) ? store.get(key) : null; },
    setItem(key, value) {
      key = String(key); value = String(value);
      if (options.quotaThrows && options.quotaThrows(key, value)) {
        const error = new Error('full'); error.name = 'QuotaExceededError'; throw error;
      }
      if (!(options.readbackMismatch && options.readbackMismatch(key, value))) store.set(key, value);
    },
    removeItem(key) { store.delete(String(key)); },
    key(index) { return Array.from(store.keys())[index] || null; },
    get length() { return store.size; }
  };
  if (!store.has('sf_bk_token')) store.set('sf_bk_token', 'synthetic-token');

  const rosterEntry = {
    id: 'provider-7', stableKey: 'stable-provider-7',
    name: PROVIDER_NAME, raw: PROVIDER_RAW, rosterVerified: true
  };
  const importer = {
    installed: true,
    pullMonth(opts) {
      pullCalls.push({ month: opts.month, dates: opts.dates.slice() });
      if (options.pullMonth) return options.pullMonth(opts, { store, pullCalls });
      const days = opts.dates.map((date) => {
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
    hidden: options.hidden === true,
    addEventListener(type, fn) { (listeners[`document:${type}`] ||= []).push(fn); },
    removeEventListener() {}
  };

  /* A MessageChannel that yields through the timer queue, so the hidden-tab
     sleep path terminates under a driven clock instead of spinning. */
  class FakeMessageChannel {
    constructor() {
      const self = this;
      this.port1 = { onmessage: null, close() {} };
      this.port2 = {
        close() {},
        postMessage() {
          sandbox.setTimeout(() => { if (self.port1.onmessage) self.port1.onmessage({ data: 0 }); }, 50);
        }
      };
    }
  }

  const sandbox = {
    console, JSON, Math, Object, Array, String, Number, RegExp, Boolean,
    Promise, Intl, Date: FakeDate, isFinite, parseInt, parseFloat,
    window: null, document, localStorage,
    MessageChannel: FakeMessageChannel,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: {
      locks: {
        request(name, lockOptions, callback) {
          if (options.lockDenied) return Promise.resolve(callback(null));
          return Promise.resolve(callback({ name }));
        }
      }
    },
    setTimeout(fn, ms) { pending.push({ id: ++timerSeq, fn, at: nowValue + (Number(ms) || 0) }); return timerSeq; },
    clearTimeout(id) { const at = pending.findIndex((t) => t.id === id); if (at >= 0) pending.splice(at, 1); },
    setInterval(fn, ms) { pending.push({ id: ++timerSeq, fn, at: nowValue + (Number(ms) || 0), every: Number(ms) || 0 }); return timerSeq; },
    clearInterval(id) { const at = pending.findIndex((t) => t.id === id); if (at >= 0) pending.splice(at, 1); },
    addEventListener(type, fn) { (listeners[`window:${type}`] ||= []).push(fn); },
    removeEventListener() {},
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
    __mlsVisitNotesPref: {
      read() { return { state: 'off', on: false, settled: true }; },
      ensureChosenForBulkPull() { return Promise.resolve({ ok: true, on: false, reason: 'test-choice-off' }); }
    },
    uns(suffix) { return `sf_u::${account || '_'}::${suffix}`; }
  };
  if (options.extVersion !== null) sandbox.__mlsExtReportedVersion = options.extVersion || EXT_NEW;
  /* The shell's worker-backed sleep, unless a case is deliberately proving the
     hidden-tab MessageChannel fallback. */
  if (!options.noBgSleep) {
    sandbox.__mlsBgSleep = (ms) => new Promise((resolve) => sandbox.setTimeout(resolve, ms));
  }
  if (options.withWorker) {
    sandbox.Blob = class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } };
    sandbox.URL = { createObjectURL() { return 'blob:heal'; }, revokeObjectURL() {} };
    sandbox.Worker = class {
      constructor() { this.onmessage = null; workerLive = this; }
      postMessage(ms) { workerTickMs = Number(ms) || 0; }
      terminate() { if (workerLive === this) workerLive = null; }
    };
  }
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: P1 });

  const r = {
    api: sandbox.__mlsP1RangeJobs,
    sandbox, importer, store, pullCalls, pending, parked,
    manifestKey() { return `sf_u::${account}::p1RangeJobV1`; },
    healKey() { return `sf_u::${account}::p1PullHealV1`; },
    offKey() { return `sf_u::${account}::p1PullHealOffV1`; },
    manifest() { const raw = store.get(this.manifestKey()); return raw ? JSON.parse(raw) : null; },
    writeManifest(manifest) { store.set(this.manifestKey(), JSON.stringify(manifest)); },
    now() { return nowValue; },
    setNow(value) { nowValue = value; },
    advance(ms) { nowValue += Number(ms) || 0; },
    setExtVersion(value) {
      if (value == null) delete sandbox.__mlsExtReportedVersion;
      else sandbox.__mlsExtReportedVersion = value;
    },
    setHidden(value) { document.hidden = value === true; },
    stopCalls() { return stopCalls; },
    workerTickMs() { return workerTickMs; },
    fireWorkerTick() { if (workerLive && workerLive.onmessage) workerLive.onmessage({ data: 1 }); },
    dispatch(type, detail) {
      for (const fn of (listeners[`window:${type}`] || []).slice()) fn({ type, detail: detail || {} });
    }
  };
  return r;
}

async function micro(rounds = 8) { for (let i = 0; i < rounds; i += 1) await Promise.resolve(); }

/* Drain the timer queue one timer at a time, advancing the driven clock to
   each timer's own due time. Deterministic and terminating.
   REPEATING timers are PARKED, never run: the only setInterval in the module
   is the supervisor's own fallback clock, and this suite drives that clock
   explicitly through beat() so each case controls exactly how many supervisor
   beats it spends. Letting it free-run here would silently walk the driven
   clock past the one-hour recovery window and make the bound untestable. */
async function settle(r, rounds = 600) {
  for (let i = 0; i < rounds; i += 1) {
    await micro(6);
    let next = null;
    while (r.pending.length) {
      r.pending.sort((a, b) => a.at - b.at);
      const candidate = r.pending.shift();
      if (candidate.every) { r.parked.push(candidate); continue; }
      next = candidate; break;
    }
    if (!next) { await micro(6); if (!r.pending.some((t) => !t.every)) return; continue; }
    if (next.at > r.now()) r.setNow(next.at);
    try { next.fn(); } catch (error) { /* the module swallows its own; so does the clock */ }
  }
}
/* One supervisor beat: move the wall clock past the interval, then tick. */
async function beat(r) {
  r.advance(r.api.heal.tickMs + 1000);
  r.api.heal.tick();
  await settle(r);
}

function newDay(status, reason, attempts, extV) {
  const day = { status, reason, attempts, updatedAt: 1 };
  if (extV) day.attemptExtV = extV;
  return day;
}
function cappedManifest(days) {
  return {
    v: 1, build: 'p1-rangejobs-1.1.0', jobId: 'range-capped-1', kind: 'month', target: '2026-09',
    provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' },
    options: { includeHistory: true, fullNotes: false },
    status: 'needs-attention', reason: 'needs-attention',
    createdAt: 1, startedAt: 1, updatedAt: 1, lastCheckpointAt: 1, completedAt: 0,
    currentMonth: '', run: { startedAt: 1, skippedComplete: 0, plannedDays: 3 },
    months: { '2026-09': { status: 'needs-attention', reason: 'month-partial', updatedAt: 1, days } }
  };
}

/* ------------------------------------------------------------------ */
/* 1. the version-scoping rule, both halves                            */
/* ------------------------------------------------------------------ */
async function testVersionScopedRearmReleasesOldExtensionFailures() {
  const r = runtime({ extVersion: EXT_NEW });
  r.writeManifest(cappedManifest({
    '2026-09-01': newDay('needs-attention', 'nav-failed', 3, EXT_OLD),
    '2026-09-02': newDay('needs-attention', 'nav-failed', 3, EXT_OLD),
    '2026-09-03': newDay('complete', 'complete', 1, EXT_OLD)
  }));
  const before = r.api.state();
  assert.strictEqual(before.summary.needsAttention, 2, 'the fixture did not start with two capped days');

  const result = await r.api.rearmOutdatedVersions();
  await settle(r);
  assert.strictEqual(result.ok, true, 'the version re-arm refused a healthy manifest');
  assert.strictEqual(result.rearmed, 2, 'both days failed by the old extension did not re-arm');
  assert.strictEqual(result.from, EXT_OLD, 'the receipt does not name the extension that spent the attempts');
  assert.strictEqual(result.to, EXT_NEW, 'the receipt does not name the extension that fixed it');

  const after = r.manifest();
  const day = after.months['2026-09'].days['2026-09-01'];
  assert.strictEqual(day.status, 'retry', 're-armed day did not go back to retry');
  assert.strictEqual(day.attempts, 0, 're-armed day kept its spent attempts');
  assert.strictEqual(day.attemptExtV, undefined, 're-armed day kept a stale extension stamp');
  assert.strictEqual(after.summary.needsAttention, 0, 'needs-attention did not drain to 0');
  assert.strictEqual(after.months['2026-09'].days['2026-09-03'].status, 'complete', 'a proved day was disturbed');
  assert.notStrictEqual(after.status, 'needs-attention', 'the job still claims it is settled while days are retryable');
}

async function testCurrentVersionAttemptsAreNeverGivenBack() {
  /* THE load-bearing half: the cap must still stop a live broken loop. */
  for (const [label, stamp, ext] of [
    ['the CURRENT extension', EXT_NEW, EXT_NEW],
    ['a NEWER extension than the one reported (a downgrade)', '3.0.101', EXT_NEW],
    ['no recorded extension at all', '', EXT_NEW],
    ['no extension version reported by the app', EXT_OLD, null]
  ]) {
    const r = runtime({ extVersion: ext });
    if (ext === null) r.setExtVersion(null);
    r.writeManifest(cappedManifest({
      '2026-09-01': newDay('needs-attention', 'nav-failed', 3, stamp),
      '2026-09-02': newDay('needs-attention', 'nav-failed', 3, stamp)
    }));
    const result = await r.api.rearmOutdatedVersions();
    await settle(r);
    assert.strictEqual(result.rearmed, 0, `attempts spent under ${label} were given back`);
    /* read it back the way the engine itself does - sanitized and recounted,
       so a stale stored summary cannot make this pass. */
    const after = r.api.state();
    assert.strictEqual(after.months['2026-09'].days['2026-09-01'].attempts, 3, `the cap was reset under ${label}`);
    assert.strictEqual(after.months['2026-09'].days['2026-09-01'].status, 'needs-attention',
      `a capped day stopped being settled under ${label}`);
    assert.strictEqual(after.summary.needsAttention, 2, `needs-attention was falsely drained under ${label}`);
  }
}

async function testAttemptsRecordTheExtensionThatSpentThem() {
  const r = runtime({
    extVersion: EXT_OLD,
    pullMonth(opts) {
      const days = opts.dates.map((date) => {
        const out = { date, ok: false, complete: false, reason: 'nav-failed' };
        opts.onDayCheckpoint(out); return out;
      });
      return Promise.resolve({ ok: false, complete: false, reason: 'month-partial', days, retry: { dates: opts.dates.slice() } });
    }
  });
  const job = r.api.startMonth('2026-09', { provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' } });
  await settle(r);
  const result = await job;
  assert.strictEqual(result.status, 'needs-attention', 'the fixture did not walk its days to the cap');
  const capped = r.manifest().months['2026-09'].days['2026-09-01'];
  assert.strictEqual(capped.attempts, 3, 'the cap did not hold at 3');
  assert.strictEqual(capped.attemptExtV, EXT_OLD, 'the day does not record the extension that spent its attempts');
  assert(r.manifest().summary.needsAttention > 0, 'the fixture did not produce needs-attention days');
  return r;
}

/* ------------------------------------------------------------------ */
/* 2. the supervisor drains needs-attention after an extension fix     */
/* ------------------------------------------------------------------ */
async function testSupervisorDrainsNeedsAttentionAfterAnExtensionFix() {
  let round = 0;
  const r = runtime({
    extVersion: EXT_OLD,
    pullMonth(opts) {
      round += 1;
      const broken = round <= 3; /* the three passes under the broken extension */
      const days = opts.dates.map((date) => {
        const out = broken
          ? { date, ok: false, complete: false, reason: 'nav-failed' }
          : { date, ok: true, complete: true, reason: 'complete' };
        opts.onDayCheckpoint(out); return out;
      });
      return broken
        ? Promise.resolve({ ok: false, complete: false, reason: 'month-partial', days, retry: { dates: opts.dates.slice() } })
        : Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
    }
  });
  await r.api.startMonth('2026-09', { provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' } });
  await settle(r);
  const stuck = r.manifest();
  assert.strictEqual(stuck.status, 'needs-attention', 'the broken-extension run did not settle needs-attention');
  const stuckCount = stuck.summary.needsAttention;
  assert(stuckCount >= 15, `expected a month of capped days, got ${stuckCount}`);

  /* The extension is fixed. Nothing else changes. */
  r.setExtVersion(EXT_NEW);
  await beat(r);
  await settle(r);

  const ledger = r.api.heal.ledger();
  assert(ledger, 'the supervisor kept no ledger for the job it healed');
  assert.strictEqual(ledger.rearmedDays, stuckCount, 'the supervisor did not re-arm every day the old extension failed');
  assert(/^re-armed \d+ days? - their failures happened under MLS Assist 3\.0\.99$/.test(ledger.lastRearm),
    `the re-arm receipt is not the stated line: ${JSON.stringify(ledger.lastRearm)}`);
  assert.strictEqual(ledger.lastRearm.indexOf(String(stuckCount)), 're-armed '.length,
    'the re-arm receipt does not name the number of days it gave back');
  const healed = r.manifest();
  assert.strictEqual(healed.summary.needsAttention, 0, 'needs-attention did not drain to 0 after the extension fix');
  assert.strictEqual(healed.status, 'complete', 'the re-armed month did not go on to finish');
  assert(ledger.resumes >= 1, 'the supervisor re-armed the days but never restarted the engine');
  assert(/Finished after \d+ automatic recover/.test(r.api.heal.statusLine()),
    `the completion line does not name the automatic recoveries: ${r.api.heal.statusLine()}`);
}

/* The interstitial that wedged every navigation on 2026-09-01 is FIXED
   extension-side (contfix-1.0.0). All this side does is count the shape it
   makes here, so "did it come back?" is answered from the ledger. */
async function testNavigationBlocksAreCountedNotActedOn() {
  const r = runtime({
    extVersion: EXT_NEW,
    pullMonth(opts) {
      const days = opts.dates.map((date) => {
        const out = { date, ok: false, complete: false, reason: 'nav-failed' };
        opts.onDayCheckpoint(out); return out;
      });
      return Promise.resolve({ ok: false, complete: false, reason: 'month-partial', days, retry: { dates: opts.dates.slice() } });
    }
  });
  const job = r.api.startMonth('2026-09', { provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' } });
  await settle(r);
  await job;
  const blocked = r.api.state().summary.attention.filter((row) => row.reason === 'nav-failed').length;
  assert(blocked >= 2, `the fixture did not produce blocked navigations: ${blocked}`);

  await beat(r);
  const ledger = r.api.heal.ledger();
  assert.strictEqual(ledger.interstitials, blocked,
    `blocked navigations were not counted in the health ledger: ${ledger.interstitials} of ${blocked}`);
  assert(/navigation blocks? seen/.test(r.api.heal.panelLine()) || ledger.interstitials > 0,
    'the ledger does not carry the navigation-block count');
  await beat(r);
  assert.strictEqual(r.api.heal.ledger().interstitials, blocked,
    'the same blocked navigations were counted twice on a second beat');
  const rows = r.api.heal.history();
  assert.strictEqual(rows.length, 1, 'the blocked run was not recorded');
  assert.strictEqual(rows[0].interstitials, blocked, 'the durable history lost the navigation-block count');
  assertPhiFreeRow(rows[0], 'a blocked run');
}

/* ------------------------------------------------------------------ */
/* 3. bounded auto-resume on the measured storage transient            */
/* ------------------------------------------------------------------ */
async function testBoundedAutoResumeWithReceiptsAndAnHonestStop() {
  let live = null;
  const r = runtime({
    extVersion: EXT_NEW,
    pullMonth(opts) {
      return new Promise((resolve) => {
        live.sandbox.setTimeout(() => {
          const receipt = { date: opts.dates[0], ok: false, complete: false, reason: 'metadata-persist-failed' };
          opts.onDayCheckpoint(receipt);
          resolve({ ok: false, complete: false, reason: 'metadata-persist-failed', days: [receipt], retry: {} });
        }, 4000);
      });
    }
  });
  live = r;
  /* the job promise settles only when the driven clock runs - never await it
     before the clock has been pumped, or the suite hangs instead of failing */
  const job = r.api.startMonth('2026-09', { provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' } });
  await settle(r);
  await job;
  assert.strictEqual(r.manifest().status, 'storage-failed', 'the fixture did not reproduce the measured storage stall');
  assert.strictEqual(r.manifest().reason, 'metadata-persist-failed', 'the fixture did not reproduce the measured reason');

  const bound = r.api.heal.resumeBoundPerHour;
  for (let i = 0; i < bound + 3; i += 1) await beat(r);

  const ledger = r.api.heal.ledger();
  assert.strictEqual(ledger.resumes, bound, `the supervisor resumed ${ledger.resumes} times against a bound of ${bound}`);
  assert.strictEqual(ledger.bounded, true, 'the supervisor never admitted it had hit its bound');
  assert(/stopped trying: 6 automatic recoveries in one hour is the bound, and this needs a person/.test(ledger.lastAction),
    `the honest stop is not stated: ${JSON.stringify(ledger.lastAction)}`);
  assert(ledger.stalls >= bound, 'the stalls it acted on were not counted');
  assert.strictEqual(r.manifest().status, 'storage-failed',
    'the supervisor hid a failure it could not fix instead of leaving it visible');
  assert(/Self-healing paused/.test(r.api.heal.panelLine()),
    `the panel does not say it stopped: ${r.api.heal.panelLine()}`);
}

/* ------------------------------------------------------------------ */
/* 4. every action is serialized: pause -> confirm -> resume -> confirm */
/* ------------------------------------------------------------------ */
function stalledRunningManifest() {
  return {
    v: 1, build: 'p1-rangejobs-1.1.0', jobId: 'range-stalled-1', kind: 'month', target: '2026-09',
    provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' },
    options: { includeHistory: true, fullNotes: false },
    status: 'running', reason: '',
    createdAt: 1, startedAt: 1, updatedAt: 1, lastCheckpointAt: 1, completedAt: 0,
    currentMonth: '2026-09', run: { startedAt: 1, skippedComplete: 0, plannedDays: 2 },
    months: {
      '2026-09': {
        status: 'running', reason: '', updatedAt: 1,
        days: {
          '2026-09-01': newDay('complete', 'complete', 1, ''),
          '2026-09-02': newDay('retry', 'pull-failed', 1, EXT_NEW)
        }
      }
    }
  };
}

/* A job the engine's own boot resume has already had its chance at: drain the
   boot timer FIRST, then plant the stalled manifest. Otherwise scheduleBoot
   would adopt it and there would be no stall left to supervise. */
async function stalledJob(options) {
  const r = runtime(Object.assign({ extVersion: EXT_NEW }, options || {}));
  await settle(r);
  r.writeManifest(stalledRunningManifest());
  return r;
}

async function testSupervisorActionsAreSerializedWithSettleWaits() {
  const r = await stalledJob();
  const calls = [];
  const realPause = r.api.pause, realResume = r.api.resume;
  r.api.pause = function () { calls.push(['pause', r.api.state().status]); return realPause.apply(null, arguments); };
  r.api.resume = function () { calls.push(['resume', r.api.state().status]); return realResume.apply(null, arguments); };

  await beat(r);                     /* first beat records the signature */
  await beat(r);                     /* one identical beat is not yet a stall */
  assert.deepStrictEqual(calls, [],
    'the supervisor acted before two whole intervals of no forward motion');
  await beat(r);                     /* two whole intervals with nothing moving */
  await settle(r);

  assert(calls.length >= 2, `expected a pause then a resume, got ${JSON.stringify(calls)}`);
  assert.strictEqual(calls[0][0], 'pause', 'the supervisor resumed a job that still claimed to be running');
  assert.strictEqual(calls[0][1], 'running', 'the pause was not issued against the running job');
  assert.strictEqual(calls[1][0], 'resume', 'the second action was not the resume');
  assert.strictEqual(calls[1][1], 'paused',
    'the resume was fired before the pause was CONFIRMED - that is the measured bounce');
  const ledger = r.api.heal.ledger();
  assert.strictEqual(ledger.resumes, 1, 'the confirmed recovery was not recorded exactly once');
  assert(/automatic recovery: the pull stopped moving/.test(ledger.lastAction),
    `the recovery receipt is missing: ${JSON.stringify(ledger.lastAction)}`);
}

async function testAnUnconfirmedPauseNeverReachesTheResume() {
  const r = await stalledJob();
  let resumed = 0;
  r.api.pause = function () { return Promise.resolve({ ok: false, status: 'running', reason: 'pull-failed' }); };
  const realResume = r.api.resume;
  r.api.resume = function () { resumed += 1; return realResume.apply(null, arguments); };

  await beat(r);
  await beat(r);
  await beat(r);
  await settle(r);

  assert.strictEqual(resumed, 0, 'the supervisor restarted an engine it could not prove had stopped');
  const ledger = r.api.heal.ledger();
  assert.strictEqual(ledger.resumes, 0, 'an unconfirmed pause was counted as a recovery');
  assert.strictEqual(ledger.refusals, 1, 'the refusal was not recorded');
  assert(/would not confirm it had stopped/.test(ledger.lastAction),
    `the honest refusal is not stated: ${JSON.stringify(ledger.lastAction)}`);
}

async function testAnotherTabsJobIsLeftAloneAndCostsNoBudget() {
  const r = await stalledJob();
  r.api.pause = function () { const m = r.api.state(); m.status = 'paused'; r.writeManifest(m); return Promise.resolve({ ok: false, status: 'paused', reason: 'paused' }); };
  r.api.resume = function () { return Promise.resolve({ ok: false, complete: false, status: 'refused', reason: 'range-lock-denied', state: null }); };

  await beat(r);
  await beat(r);
  await beat(r);
  await settle(r);

  const ledger = r.api.heal.ledger();
  assert.strictEqual(ledger.resumes, 0, 'a lock-denied resume was counted as a recovery');
  assert.strictEqual(ledger.bounded, false, 'another tab owning the job spent this tab\'s recovery budget');
  assert(/another MLS tab owns this pull/.test(ledger.lastAction),
    `the one-tab law is not stated honestly: ${JSON.stringify(ledger.lastAction)}`);
}

/* ------------------------------------------------------------------ */
/* 5. the kill switch                                                  */
/* ------------------------------------------------------------------ */
async function testKillSwitchDefaultsOnAndStopsEverythingWhenOff() {
  const r = await stalledJob();
  assert.strictEqual(r.api.heal.enabled(), true, 'self-healing did not default to ON');
  assert.strictEqual(r.store.has(r.offKey()), false, 'the default ON state wrote a durable key it did not need');

  assert.strictEqual(r.api.heal.setEnabled(false), true, 'the kill switch could not be turned off');
  assert.strictEqual(r.store.get(r.offKey()), '1', 'the off state is not durable');
  assert.strictEqual(r.api.heal.enabled(), false, 'the kill switch did not read back off');

  let touched = 0;
  r.api.pause = function () { touched += 1; return Promise.resolve({ ok: false }); };
  r.api.resume = function () { touched += 1; return Promise.resolve({ ok: false }); };
  for (let i = 0; i < 4; i += 1) await beat(r);
  assert.strictEqual(touched, 0, 'a disabled supervisor still acted on the engine');
  assert.strictEqual(r.api.heal.timerKind(), 'none', 'a disabled supervisor left its clock running');
  assert(/Self-healing is OFF/.test(r.api.heal.panelLine()), 'the panel does not say self-healing is off');

  assert.strictEqual(r.api.heal.setEnabled(true), true, 'the kill switch could not be turned back on');
  assert.strictEqual(r.store.has(r.offKey()), false, 'turning it back on left the off marker behind');
  assert.strictEqual(r.api.heal.enabled(), true, 'the kill switch did not read back on');
}

/* ------------------------------------------------------------------ */
/* 6. the ledger and the durable history: shape and PHI-freedom        */
/* ------------------------------------------------------------------ */
const HISTORY_KEYS = ['v', 'at', 'kind', 'target', 'outcome', 'days', 'complete', 'needsAttention',
  'stalls', 'resumes', 'refusals', 'rearmedDays', 'interstitials', 'persistFailures', 'bounded', 'ext', 'from'];

function assertPhiFreeRow(row, label) {
  assert.deepStrictEqual(Object.keys(row).slice().sort(), HISTORY_KEYS.slice().sort(),
    `${label}: the persisted run row is not the closed allowlist`);
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (typeof value === 'number' || typeof value === 'boolean') continue;
    assert.strictEqual(typeof value, 'string', `${label}: ${key} is neither a number, a boolean, nor a bounded code`);
    assert(/^[a-z0-9.-]{0,32}$/.test(value), `${label}: ${key}=${JSON.stringify(value)} is not a bounded code`);
  }
}

async function testHealthHistoryIsRecordedAndIsPhiFree() {
  const r = runtime({ extVersion: EXT_NEW });
  await r.api.startMonth('2026-09', { provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' } });
  await settle(r);
  assert.strictEqual(r.manifest().status, 'complete', 'the fixture month did not finish');
  await beat(r);

  const rows = r.api.heal.history();
  assert.strictEqual(rows.length, 1, 'the finished run was not recorded in the durable history');
  const row = rows[0];
  assert.strictEqual(row.outcome, 'complete', 'the recorded outcome is wrong');
  assert.strictEqual(row.kind, 'month', 'the recorded kind is wrong');
  assert.strictEqual(row.target, '2026-09', 'the recorded target is wrong');
  assert.strictEqual(row.days, row.complete, 'a clean run did not record every day complete');
  assert.strictEqual(row.ext, EXT_NEW, 'the run did not record the extension it ran under');
  assertPhiFreeRow(row, 'a recorded run');

  const raw = String(r.store.get(r.healKey()) || '');
  assert(raw, 'the health history was not persisted');
  assert(!raw.includes(PROVIDER_NAME) && !raw.includes(PROVIDER_RAW), 'a provider display name reached the health record');
  assert(!raw.includes(ACCOUNT), 'the account identity reached the health record');
  assert(!/\d{2}\/\d{2}\/\d{4}/.test(raw), 'a date of birth shape reached the health record');
  assert(!/"name"|"raw"|"dob"|"mrn"|"patient"/i.test(raw), 'an identity field name reached the health record');
  assert.strictEqual(r.api.heal.statusLine().indexOf('Finished clean.') > 0, true,
    `a clean run did not say so: ${r.api.heal.statusLine()}`);
}

async function testPoisonedHistoryIsRebuiltFromTheAllowlist() {
  const r = runtime({ extVersion: EXT_NEW });
  r.store.set(r.healKey(), JSON.stringify({
    v: 1,
    runs: [
      { kind: 'month', target: '2026-08', outcome: 'complete', days: 31, complete: 31,
        patient: 'Jane Q Patient', dob: '01/02/1990', mrn: '998877', note: 'chest pain',
        stalls: 2, resumes: 1, ext: EXT_NEW },
      { kind: 'not-a-kind', target: '2026-08', outcome: 'complete' },
      { kind: 'month', target: 'Jane Doe', outcome: 'complete' },
      { kind: 'month', target: '2026-08', outcome: 'invented-status' }
    ]
  }));
  const rows = r.api.heal.history();
  assert.strictEqual(rows.length, 1, 'the poisoned rows were not all refused');
  assertPhiFreeRow(rows[0], 'a poisoned row read back');
  assert.strictEqual(rows[0].patient, undefined, 'a PHI field survived the read');
  assert.strictEqual(rows[0].stalls, 2, 'the allowlisted counts were lost with the poison');

  /* and it never survives the next WRITE either */
  await r.api.startMonth('2026-09', { provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' } });
  await settle(r);
  await beat(r);
  const raw = String(r.store.get(r.healKey()) || '');
  assert(!/Jane|998877|chest pain|01\/02\/1990/.test(raw), 'poison from an earlier write survived the next write');
  for (const row of JSON.parse(raw).runs) assertPhiFreeRow(row, 'a rewritten row');
}

/* ------------------------------------------------------------------ */
/* 7. the metadata-persist instrumentation                             */
/* ------------------------------------------------------------------ */
async function testPersistFailureNamesTheKeyAndWhetherItMoved() {
  let mismatch = true;
  const r = runtime({
    extVersion: EXT_NEW,
    readbackMismatch(key) { return mismatch && key.endsWith('p1RangeJobV1'); }
  });
  const result = await r.api.startMonth('2026-09', { provider: { mode: 'selected', id: 'provider-7', stableKey: 'stable-provider-7' } });
  await settle(r);
  assert.strictEqual(result.reason, 'metadata-persist-failed', 'the read-back mismatch did not present as the measured reason');

  const diag = r.api.heal.persistDiag();
  assert(diag.length >= 1, 'the refused write left no diagnosis');
  const newest = diag[diag.length - 1];
  assert.strictEqual(newest.stage, 'readback-absent', `the failing ARM was not named: ${newest.stage}`);
  assert.strictEqual(newest.reason, 'metadata-persist-failed', 'the diagnosis lost the reason code');
  assert.strictEqual(newest.keyShape, 'sf_u::account::p1RangeJobV1', `the key shape is wrong: ${newest.keyShape}`);
  assert.strictEqual(newest.keyMoved, false, 'a key that did not move was reported as moved');
  assert.strictEqual(newest.liveKeyMissing, false, 'a present key was reported missing');
  assert(newest.wroteChars > 0, 'the diagnosis does not say how much was written');
  assert.strictEqual(newest.readChars, -1, 'the diagnosis does not say nothing came back');
  assert(newest.storeChars > 0, 'the diagnosis does not measure the store');
  const rawDiag = JSON.stringify(diag);
  assert(!rawDiag.includes(ACCOUNT), 'the account identity reached the diagnosis ring');
  assert(!rawDiag.includes(PROVIDER_NAME), 'a provider name reached the diagnosis ring');

  /* the same instrument names the OTHER arm: no account-scoped key at all */
  mismatch = false;
  r.sandbox.__mlsSessionAccount = '';
  r.sandbox.uns = function (suffix) { return 'sf_u::undefined::' + suffix; };
  const refused = await r.api.resume();
  await settle(r);
  assert.strictEqual(refused.ok, false, 'a job with no provable account scope was admitted');
  const flaps = r.api.heal.scopeDiag();
  assert(flaps.flaps >= 1, 'the account-scope change was not measured');
  assert(flaps.ring.some((row) => row.to === 'empty' || String(row.to).indexOf('undefined') >= 0),
    `the scope ring did not record the flap: ${JSON.stringify(flaps.ring)}`);
  assert(!JSON.stringify(flaps).includes(ACCOUNT), 'the account identity reached the scope ring');
}

/* ------------------------------------------------------------------ */
/* 8. the clock is hidden-tab safe                                     */
/* ------------------------------------------------------------------ */
async function testHiddenSafeClockAndWallClockAdmission() {
  const worker = await stalledJob({ withWorker: true });
  worker.api.heal.kick();
  assert.strictEqual(worker.api.heal.timerKind(), 'worker',
    'the supervisor did not take the Worker clock, which is the only one a hidden tab keeps running');
  assert.strictEqual(worker.workerTickMs(), worker.api.heal.tickMs, 'the Worker clock is not on the supervisor interval');

  const plain = await stalledJob();
  plain.api.heal.kick();
  assert.strictEqual(plain.api.heal.timerKind(), 'interval', 'the no-Worker fallback clock did not start');

  /* THE property: whichever clock ticks, a beat is admitted only when the WALL
     CLOCK says a full interval has passed. A hidden tab buckets its fallback
     timer and then fires a BURST of catch-up ticks the moment it is shown
     again; those must not count as intervals of observed stalling, or the
     supervisor would decide a job had stopped moving purely because the tab
     was in the background. It heals LATE, never on a burst. */
  const r = await stalledJob();
  let resumes = 0;
  const realResume = r.api.resume;
  r.api.resume = function () { resumes += 1; return realResume.apply(null, arguments); };
  await beat(r);
  assert.strictEqual(r.api.heal.ledger().stallTicks, 0, 'the first observation is not a stall');
  /* the catch-up burst: eight ticks, zero wall-clock time between them */
  for (let i = 0; i < 8; i += 1) r.api.heal.tick();
  await settle(r);
  assert.strictEqual(r.api.heal.ledger().stallTicks, 0,
    'a burst of catch-up ticks with no wall-clock time was counted as observed stalling');
  assert.strictEqual(resumes, 0, 'a catch-up burst healed a job that was never observed to stall');
  /* real time passing IS admitted */
  await beat(r);
  assert.strictEqual(r.api.heal.ledger().stallTicks, 1, 'a real interval was not counted');
  await beat(r);
  await settle(r);
  assert.strictEqual(resumes, 1, 'two whole intervals of no motion were not healed');
}

async function testAHiddenTabStillHealsThroughTheMessageChannelSleep() {
  const r = await stalledJob({ noBgSleep: true, hidden: true });
  await beat(r);
  await beat(r);
  await beat(r);
  await settle(r, 1600);
  const ledger = r.api.heal.ledger();
  assert.strictEqual(ledger.resumes, 1,
    'a hidden tab could not complete a settle wait, so the recovery never confirmed');
  assert(/automatic recovery/.test(ledger.lastAction), 'the hidden-tab recovery left no receipt');
}

/* ------------------------------------------------------------------ */
/* 9. the wiring is real (verify the dispatch, not only the mechanism) */
/* ------------------------------------------------------------------ */
function testTheTrackerIsWiredIntoTheCardAndTheTwinsAgree() {
  assert(source.includes('healPanelHtml()') && source.includes("id=\"mlsP1HealPanel\"") &&
    source.includes("id=\"mlsP1HealLine\"") && source.includes("id=\"mlsP1HealSwitch\""),
    'the health panel is not built into the card markup');
  assert(source.includes('host.appendChild(existing); wireYearUi(existing);') && source.includes('healWirePanel(root);'),
    'the health panel is never wired');
  assert(source.includes('healRefreshPanel(root, manifest);'), 'the health panel is never refreshed');
  assert(source.includes("uiReceiptCopy(manifest) + healOutcomeCopy(manifest)"),
    'the completion line does not carry the healing outcome');
  assert(source.includes('#mlsP1YearPull .p1yr-heal{'), 'the health panel has no style');
  assert(source.includes('healKick();'), 'the supervisor clock is never started');
  assert(source.includes('healStopClock(); healLedger = null; healBusy = false;'),
    'revert() does not stop the supervisor');
  assert(!/\btoast\s*\(/.test(source), 'the supervisor can emit notification spam');
  /* the extension owns athena: the supervisor must never reach for it */
  assert(!/mlsAppGotoDate|mlsAthenaContinue|chrome\.(tabs|runtime)/.test(source),
    'the supervisor reaches for athena or the extension directly');

  /* lane identity only - the twins are derived, never hand-written */
  const expectedProduction = source
    .split('__MLS_P1_PREVIEW').join('__MLS_MAIN')
    .split("(preview.route === '/1p/' || preview.route === '/1pScribeFlow.html')")
      .join("(preview.route === '/ScribeFlow.html' || preview.route === '/')")
    .split('1p-feat_').join('feat_');
  assert.strictEqual(productionSource, expectedProduction, 'the production twin drifted from the 1p source');
  const expectedCloned = source
    .split('__MLS_P1_PREVIEW').join('__MLS_CLONED')
    .split("(preview.route === '/1p/' || preview.route === '/1pScribeFlow.html')")
      .join("(preview.route === '/cloned/')")
    .split('1p-feat_').join('cloned-feat_');
  assert.strictEqual(clonedSource, expectedCloned, 'the cloned twin drifted from the 1p source');
}

/* ------------------------------------------------------------------ */
/* "A SUITE CAN PASS WITHOUT RUNNING": run-all judges on the exit code, and a
   suite whose async chain silently stops draining the event loop exits 0
   having proved nothing. The interval holds the loop open so an early exit is
   a FAILURE with the name of the case it died in, not a green tick. */
const CASES = [
  ['the wiring, and the twins', testTheTrackerIsWiredIntoTheCardAndTheTwinsAgree],
  ['version-scoped re-arm releases old-extension failures', testVersionScopedRearmReleasesOldExtensionFailures],
  ['current-version attempts are never given back', testCurrentVersionAttemptsAreNeverGivenBack],
  ['attempts record the extension that spent them', testAttemptsRecordTheExtensionThatSpentThem],
  ['the supervisor drains needs-attention after an extension fix', testSupervisorDrainsNeedsAttentionAfterAnExtensionFix],
  ['blocked navigations are counted, not acted on', testNavigationBlocksAreCountedNotActedOn],
  ['bounded auto-resume with receipts and an honest stop', testBoundedAutoResumeWithReceiptsAndAnHonestStop],
  ['supervisor actions are serialized with settle waits', testSupervisorActionsAreSerializedWithSettleWaits],
  ['an unconfirmed pause never reaches the resume', testAnUnconfirmedPauseNeverReachesTheResume],
  ["another tab's job is left alone and costs no budget", testAnotherTabsJobIsLeftAloneAndCostsNoBudget],
  ['the kill switch defaults on and stops everything when off', testKillSwitchDefaultsOnAndStopsEverythingWhenOff],
  ['the health history is recorded and is PHI-free', testHealthHistoryIsRecordedAndIsPhiFree],
  ['a poisoned history is rebuilt from the allowlist', testPoisonedHistoryIsRebuiltFromTheAllowlist],
  ['a refused save names the key and whether it moved', testPersistFailureNamesTheKeyAndWhetherItMoved],
  ['the clock is hidden-tab safe and wall-clock admitted', testHiddenSafeClockAndWallClockAdmission],
  ['a hidden tab still heals through the MessageChannel sleep', testAHiddenTabStillHealsThroughTheMessageChannelSleep]
];
let finished = false;
let running = '(nothing started)';
const holdOpen = setInterval(() => {}, 250);
process.on('exit', (code) => {
  if (finished || code !== 0) return;
  console.error('FAIL pull-heal exited without finishing - died inside: ' + running);
  process.exitCode = 1;
});

(async function main() {
  for (const [name, run] of CASES) {
    running = name;
    if (process.env.HEALDBG) console.error('>> ' + name);   /* HEALDBG=1 names each case as it starts */
    await run();
  }
  finished = true;
  clearInterval(holdOpen);
  console.log('PASS pullheal-1.0.0: version-scoped attempts drain needs-attention to 0 after an MLS Assist fix and NEVER give back attempts the current extension spent; bounded auto-resume on the measured metadata-persist stall with a receipt each time and an honest stop at the bound; every supervisor action serialized pause -> confirmed -> resume -> confirmed, with another tab\'s job left alone; a PHI-free closed-allowlist health ledger and history; a kill switch that defaults ON; a hidden-tab-safe Worker clock admitted on the wall clock; and the metadata-persist mystery instrumented down to which key failed and whether it moved');
})().catch((error) => {
  finished = true;
  clearInterval(holdOpen);
  console.error('FAIL pull-heal in: ' + running);
  console.error(error);
  process.exit(1);
});

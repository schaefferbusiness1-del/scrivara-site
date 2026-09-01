'use strict';

/* pullresume-1.0.0 - RESUME, PROVEN.
 *
 * OWNER 2026-09-01, verbatim: "if a month pull, year pull stops or fials or if
 * a day pull stops or failes it sohuld be possible to resume and iot acatlly
 * work also for the yera pull to there needs to be an indictarer jjust like
 * ithe the month pull. also make the pulling for slecter also here".
 *
 * WHAT WAS MEASURED BEFORE THIS WAS WRITTEN. A settled month job refused every
 * Resume and every Retry with:
 *
 *   "The full Athena provider roster is not verified yet. Re-pull the Day
 *    schedule and retry ... could not read the Athena Day schedule"
 *
 * Two independent gates produced it, and both re-ran on a RESUME:
 *   1. Staff Prep's startMonthPull ran the LIVE all-provider roster gate (and
 *      then its automatic Day-schedule re-verify) BEFORE it ever reached the
 *      durable resume below it. "Retry failed days" is wired to that function.
 *   2. The importer's own pullMonth re-ran the same gate for every month of
 *      the range, so even a resume that got past the card died on month one.
 * A roster receipt is only `complete` while athenaOne happens to be showing a
 * readable full Day schedule at that instant, so a job whose scope was proved
 * hours earlier could never be continued.
 *
 * THE RULE THIS SUITE PINS:
 *   - a NEW start verifies the live roster. Unchanged, and proved unchanged.
 *   - a RESUME of a durable job may stand on the scope stamp its own manifest
 *     recorded when that job's scope WAS verified live - all-provider mode
 *     only, roster-completeness refusals only, bounded by age, and only through
 *     a private option the public gate export strips.
 *   - a resume that genuinely cannot proceed refuses under its OWN name.
 *   - the "Pulling for" picker shows the saved job's provider after a reload.
 *   - a stopped DAY pull resumes: the ledger already refuses a done row, and
 *     the button and the status line now say so before the click.
 *   - the Year card carries the month card's indicator: bar, months/days line,
 *     the four honest tiles, and its own frozen provider picker.
 *
 * Every case below EXECUTES shipped code - the real provider gate, the real
 * range engine, the real picker painter, the real day-resume reader, and the
 * real year card in a real browser. No Athena account, backend, or PHI. */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const vm = require('vm');
const { chromium } = require('playwright');

const RANGE = fs.readFileSync('1p-feat_mls_rangejobs.js', 'utf8');
const IMPORTER = fs.readFileSync('1p-feat_mls_schedimport_exact.js', 'utf8');
const CONNECT = fs.readFileSync('1p-mls-connect.js', 'utf8');

const DAY_MS = 24 * 60 * 60 * 1000;

/* ---- one extractor, used for every slice ------------------------------- */
function balanced(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'slice not found: ' + (label || signature));
  let depth = 0, quote = '', i = source.indexOf('{', start);
  assert(i > start, 'slice has no body: ' + (label || signature));
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1];
    if (quote) { if (ch === quote && prev !== '\\') quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i); continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated slice: ' + (label || signature));
}

/* =======================================================================
 * PART A - the importer's own provider gate, executed.
 * ===================================================================== */
function importerGateSlice(rosterComplete, options) {
  options = options || {};
  const slices = [
    'var FROZEN_SCOPE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;',
    balanced(IMPORTER, 'function frozenAllScopeOk(stamp)', 'frozenAllScopeOk'),
    balanced(IMPORTER, 'function providerRequest(raw)', 'providerRequest'),
    balanced(IMPORTER, 'function resolveProviderRequest(raw, opts)', 'resolveProviderRequest')
  ].join('\n');
  const receipt = { complete: rosterComplete === true, partial: rosterComplete !== true, listedCount: 3, rosterScope: 'painted-day-grid' };
  const ctx = vm.createContext({
    console, JSON, Math, Object, String, Number, Date, RegExp, Boolean, isFinite,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    isFn(value) { return typeof value === 'function'; },
    providerKey(raw) { return String(raw == null ? '' : raw).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'); },
    window: {
      __mlsProviderRoster: {
        getReceipt() { return receipt; },
        resolve(ref) {
          const key = ref && typeof ref === 'object' ? (ref.stableKey || ref.id || ref.name) : ref;
          return String(key || '') === 'stable-doc-1'
            ? { id: 'doc-1', stableKey: 'stable-doc-1', name: 'Clinic Doctor', raw: 'Clinic Doctor' } : null;
        }
      }
    }
  });
  vm.runInContext(slices + '\nthis.__gate = resolveProviderRequest;\nthis.__stampOk = frozenAllScopeOk;', ctx,
    { filename: 'importer-provider-gate' });
  /* the public export wrapper, taken from the shipped object literal so the
     strip is proved by the shipped code and not by a copy of it. */
  if (options.publicExport) {
    const exportSlice = balanced(IMPORTER, '_resolveProviderRequest: function (raw, opts)', 'public gate export');
    vm.runInContext('this.__public = ' + exportSlice.replace('_resolveProviderRequest: ', '') + ';', ctx,
      { filename: 'importer-public-gate-export' });
  }
  return ctx;
}

function partAImporterGate() {
  const now = Date.now();
  const goodStamp = { v: 1, mode: 'all', verified: true, at: now - 60000, listed: 3 };

  /* 1. the measured refusal, still exactly itself when nothing is presented. */
  let ctx = importerGateSlice(false);
  let out = ctx.__gate('all', { allowAll: true, requireRosterForAll: true, allowDetectedProvider: true });
  assert.strictEqual(out.ok, false, 'an incomplete roster admitted an all-provider month with no frozen scope');
  assert.strictEqual(out.reason, 'provider-roster-incomplete', 'the live refusal changed its reason code');
  assert(/full Athena provider roster is not verified yet/.test(String(out.error || '')),
    'the measured refusal sentence is no longer the one a new start gets: ' + out.error);

  /* 2. a RESUME presenting this job's own recorded stamp is admitted. */
  out = ctx.__gate('all', { allowAll: true, requireRosterForAll: true, allowDetectedProvider: true, __frozenAllScope: goodStamp });
  assert.strictEqual(out.ok, true, 'a resume could not stand on the scope its own start verified');
  assert.strictEqual(out.provider, 'all', 'the frozen resume did not stay all-provider');
  assert(out.frozenScope && out.frozenScope.verified === true && out.frozenScope.at === goodStamp.at,
    'the admitted gate did not disclose that it ran on a frozen scope');

  /* 3. the stamp is BOUNDED. Nothing about these is admitted. */
  const refused = [
    ['expired', { v: 1, mode: 'all', verified: true, at: now - (31 * DAY_MS), listed: 3 }],
    ['future-dated', { v: 1, mode: 'all', verified: true, at: now + (2 * DAY_MS), listed: 3 }],
    ['selected-mode', { v: 1, mode: 'selected', verified: true, at: now - 60000, listed: 3 }],
    ['unverified', { v: 1, mode: 'all', verified: false, at: now - 60000, listed: 3 }],
    ['wrong-version', { v: 2, mode: 'all', verified: true, at: now - 60000, listed: 3 }],
    ['no-timestamp', { v: 1, mode: 'all', verified: true, at: 0, listed: 3 }],
    ['not-an-object', 'all'],
    ['true', true]
  ];
  for (const [label, stamp] of refused) {
    const attempt = ctx.__gate('all', { allowAll: true, requireRosterForAll: true, allowDetectedProvider: true, __frozenAllScope: stamp });
    assert.strictEqual(attempt.ok, false, 'a ' + label + ' scope stamp was accepted');
    assert.strictEqual(attempt.reason, 'provider-roster-incomplete', 'a ' + label + ' stamp changed the refusal reason');
  }

  /* 4. a stamp NEVER rescues anything but the roster-completeness refusal. */
  out = ctx.__gate('all', { allowAll: false, requireRosterForAll: true, __frozenAllScope: goodStamp });
  assert.strictEqual(out.reason, 'provider-required', 'a frozen scope widened a route that never allowed All');

  /* 5. a complete roster needs no stamp and reports none. */
  const live = importerGateSlice(true);
  out = live.__gate('all', { allowAll: true, requireRosterForAll: true, allowDetectedProvider: true });
  assert.strictEqual(out.ok, true, 'a verified roster stopped admitting an all-provider month');
  assert(!out.frozenScope, 'a live gate falsely claimed it ran on a frozen scope');

  /* 6. THE STRUCTURAL HALF: the public gate export strips the private option,
        so no caller outside pullMonth's own call site can present one - a new
        start cannot carry a stamp even if it tries. */
  const pub = importerGateSlice(false, { publicExport: true });
  const viaPublic = pub.__public('all', { allowAll: true, requireRosterForAll: true, allowDetectedProvider: true, __frozenAllScope: goodStamp });
  assert.strictEqual(viaPublic.ok, false, 'the public provider gate honoured a frozen scope presented by an outside caller');
  assert.strictEqual(viaPublic.reason, 'provider-roster-incomplete', 'the public gate refusal changed shape');

  /* 7. and pullMonth is the ONE place that forwards it. */
  const monthGateLine = IMPORTER.split('\n').filter(line => line.includes('__frozenAllScope: opts.frozenAllScope'));
  assert.strictEqual(monthGateLine.length, 1, 'the frozen scope is forwarded from more than one call site');
  const pullMonthBody = balanced(IMPORTER, 'function pullMonth(opts)', 'pullMonth');
  assert(pullMonthBody.includes('__frozenAllScope: opts.frozenAllScope'), 'pullMonth stopped forwarding the resume scope');
  assert(pullMonthBody.includes('providerScopeFrozen: monthScopeFrozen'), 'a frozen-scope month run no longer discloses itself on its receipt');
  const dayBody = balanced(IMPORTER, 'function pull(opts)', 'the single-day pull');
  assert(!dayBody.includes('__frozenAllScope'), 'the single-day route learned to accept a frozen range scope');
  console.log('  A. importer gate: live refusal unchanged, resume stamp admitted, 8 bad stamps refused, public export strips it');
}

/* =======================================================================
 * PART B - the durable range engine, executed end to end.
 * ===================================================================== */
function rangeRuntime(options) {
  options = options || {};
  const store = options.store || new Map();
  const timers = [];
  const listeners = Object.create(null);
  const pullCalls = [];
  let account = options.account || 'resume-doctor@example.invalid';
  let nowValue = options.now || Date.UTC(2026, 7, 20, 15, 0, 0);
  let rosterComplete = options.rosterComplete !== false;
  let importerPresent = true;

  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowValue])); }
    static now() { return nowValue; }
  }
  const localStorage = {
    getItem(key) { return store.has(String(key)) ? store.get(String(key)) : null; },
    setItem(key, value) { store.set(String(key), String(value)); },
    removeItem(key) { store.delete(String(key)); }
  };
  store.set('sf_bk_token', 'synthetic-token');

  /* the REAL importer provider gate drives this stub, so Part B's admission
     decisions are the shipped ones and not a second opinion. */
  const gateCtxComplete = importerGateSlice(true);
  const gateCtxIncomplete = importerGateSlice(false);
  function gate(raw, opts) {
    return (rosterComplete ? gateCtxComplete : gateCtxIncomplete).__gate(raw, opts);
  }

  const importer = {
    installed: true,
    pullMonth(opts) {
      const admitted = gate(opts.provider, {
        allowAll: true, requireRosterForAll: true, allowDetectedProvider: true,
        __frozenAllScope: opts.frozenAllScope
      });
      pullCalls.push({
        month: opts.month, dates: opts.dates.slice(), provider: opts.provider,
        frozenAllScope: opts.frozenAllScope || null, admitted: admitted.ok === true,
        frozen: !!admitted.frozenScope
      });
      if (!admitted.ok) {
        return Promise.resolve({ ok: false, complete: false, reason: admitted.reason, days: [], retry: { dates: opts.dates.slice() } });
      }
      if (options.pullMonth) return options.pullMonth(opts, { pullCalls, store });
      const days = opts.dates.map(date => {
        const receipt = { date, ok: true, complete: true, reason: 'complete' };
        opts.onDayCheckpoint(receipt);
        return receipt;
      });
      return Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
    },
    stopPull() { return { requested: true }; },
    _resolveProviderRequest(raw, opts) {
      const passed = {};
      for (const key in opts) if (Object.prototype.hasOwnProperty.call(opts, key) && key !== '__frozenAllScope') passed[key] = opts[key];
      return gate(raw, passed);
    }
  };

  const document = {
    hidden: false,
    addEventListener(type, fn) { (listeners['document:' + type] ||= []).push(fn); },
    removeEventListener() {}
  };
  const sandbox = {
    console, JSON, Math, Object, Array, String, Number, RegExp, Boolean,
    Promise, Intl, Date: FakeDate, isFinite, parseInt, parseFloat,
    window: null, document, localStorage,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: {
      locks: {
        request(name, lockOptions, callback) { return Promise.resolve(callback({ name })); }
      }
    },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {}, setInterval(fn) { timers.push(fn); return timers.length; }, clearInterval() {},
    addEventListener(type, fn) { (listeners['window:' + type] ||= []).push(fn); },
    removeEventListener() {},
    __MLS_AV: 'pull-resume-proof',
    __MLS_P1_PREVIEW: { enabled: true, route: '/1p/', build: 'pull-resume-proof' },
    __mlsSessionAccount: account,
    session: { email: account },
    __mlsVisitNotesPref: {
      read() { return { state: 'off', on: false, settled: true }; },
      ensureChosenForBulkPull() { return Promise.resolve({ ok: true, on: false, reason: 'proof-choice-off' }); }
    },
    uns(suffix) { return 'sf_u::' + (account || '_') + '::' + suffix; }
  };
  Object.defineProperty(sandbox, '__mlsSI', { get() { return importerPresent ? importer : null; }, configurable: true });
  Object.defineProperty(sandbox, '__mlsProviderRoster', {
    get() {
      return {
        getReceipt() { return { complete: rosterComplete, partial: !rosterComplete, listedCount: 3, rosterScope: 'painted-day-grid' }; },
        resolve(ref) {
          const key = ref && typeof ref === 'object' ? (ref.stableKey || ref.id) : ref;
          return String(key || '') === 'stable-doc-1'
            ? { id: 'doc-1', stableKey: 'stable-doc-1', name: 'Clinic Doctor', raw: 'Clinic Doctor' } : null;
        },
        list() { return [{ id: 'doc-1', stableKey: 'stable-doc-1', name: 'Clinic Doctor' }]; },
        seenOnCalendar() { return []; }
      };
    },
    configurable: true
  });
  sandbox.window = sandbox;
  vm.runInNewContext(RANGE, sandbox, { filename: '1p-feat_mls_rangejobs.js' });

  return {
    api: sandbox.__mlsP1RangeJobs, sandbox, store, pullCalls, timers,
    manifestKey() { return 'sf_u::' + account + '::p1RangeJobV1'; },
    manifest() { const raw = store.get(this.manifestKey()); return raw ? JSON.parse(raw) : null; },
    setRosterComplete(value) { rosterComplete = value !== false; },
    setImporterPresent(value) { importerPresent = value !== false; },
    setNow(value) { nowValue = value; }
  };
}

async function flush(rounds = 10) { for (let i = 0; i < rounds; i += 1) await Promise.resolve(); }

async function partBFrozenScopeResume() {
  /* 1. Start under a verified roster. It records the scope check it passed. */
  let pending = null, monthCalls = 0;
  const r = rangeRuntime({
    pullMonth(opts) {
      monthCalls += 1;
      if (monthCalls === 1) {
        opts.onDayCheckpoint({ date: opts.dates[0], ok: true, complete: true, reason: 'complete' });
        opts.onDayCheckpoint({ date: opts.dates[1], ok: true, complete: true, reason: 'complete' });
        return new Promise(resolve => { pending = resolve; });
      }
      const days = opts.dates.map(date => {
        const out = { date, ok: true, complete: true, reason: 'complete' };
        opts.onDayCheckpoint(out); return out;
      });
      return Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
    }
  });

  const started = r.api.startMonth('2026-07', { provider: 'all', includeHistory: true, pullVisitBodies: false });
  await flush();
  let manifest = r.manifest();
  assert(manifest, 'the start wrote no manifest');
  assert(manifest.scope && manifest.scope.verified === true && manifest.scope.mode === 'all',
    'the start did not record the scope check it passed');
  assert(manifest.scope.at > 0, 'the recorded scope stamp carries no time');
  const raw = r.store.get(r.manifestKey());
  assert(!/"name"|"raw"/.test(raw) && !raw.includes('Clinic Doctor'),
    'the scope stamp leaked provider display identity into durable metadata: ' + raw.slice(0, 400));

  /* 2. Athena stops showing a readable full Day schedule, the doctor pauses. */
  await r.api.pause();
  if (pending) pending({ ok: false, complete: false, reason: 'stopped-by-user', days: [], retry: { dates: [] } });
  await started;
  assert.strictEqual(r.manifest().status, 'paused', 'Pause did not checkpoint the job');
  const provedBefore = Object.keys(r.manifest().months['2026-07'].days)
    .filter(day => r.manifest().months['2026-07'].days[day].status === 'complete');
  assert(provedBefore.length >= 2, 'the paused job lost the days it had already verified');

  r.setRosterComplete(false);

  /* 3. THE MEASURED BUG: a NEW start is still refused. It must be. */
  const fresh = await r.api.startYear('2026', { provider: 'all', includeHistory: true, pullVisitBodies: false });
  assert.strictEqual(fresh.ok, false, 'a NEW pull started with an unverified roster');
  assert(fresh.reason === 'provider-roster-incomplete' || fresh.reason === 'job-exists',
    'a new start refused for the wrong reason: ' + fresh.reason);

  /* 4. THE CURE: the RESUME of the saved job proceeds under its own stamp. */
  const callsBefore = r.pullCalls.length;
  const resumed = await r.api.resume({});
  const resumeCalls = r.pullCalls.slice(callsBefore);
  assert(resumeCalls.length >= 1, 'the resume never reached the importer at all');
  assert.strictEqual(resumeCalls[0].admitted, true,
    'the resume was refused by the importer gate it had already passed once');
  assert.strictEqual(resumeCalls[0].frozen, true, 'the resume did not run on the recorded scope');
  assert(resumeCalls[0].frozenAllScope && resumeCalls[0].frozenAllScope.mode === 'all',
    'the manifest stamp did not travel with the run, so month one would have died on the roster sentence');
  assert.strictEqual(resumed.status, 'complete', 'the resume did not finish the month: ' + resumed.status + '/' + resumed.reason);
  assert.notStrictEqual(r.manifest().reason, 'provider-roster-incomplete', 'the resumed job still settled on the roster refusal');
  for (const day of provedBefore) {
    assert(!resumeCalls[0].dates.includes(day), 'the resume re-pulled ' + day + ', already proved before it stopped');
  }
  console.log('  B1. frozen-scope resume: start stamps the scope, a new start still gates, resume finishes without re-verifying');
}

/* Start a real job under a verified roster and stop it half way, so what
   follows is testing a RESUME and not a fresh start. */
async function startedAndPaused() {
  let pending = null, calls = 0;
  const r = rangeRuntime({
    pullMonth(opts) {
      calls += 1;
      if (calls === 1) {
        opts.onDayCheckpoint({ date: opts.dates[0], ok: true, complete: true, reason: 'complete' });
        opts.onDayCheckpoint({ date: opts.dates[1], ok: true, complete: true, reason: 'complete' });
        return new Promise(resolve => { pending = resolve; });
      }
      const days = opts.dates.map(date => {
        const out = { date, ok: true, complete: true, reason: 'complete' };
        opts.onDayCheckpoint(out); return out;
      });
      return Promise.resolve({ ok: true, complete: true, reason: 'complete', days });
    }
  });
  const started = r.api.startMonth('2026-07', { provider: 'all', includeHistory: true, pullVisitBodies: false });
  await flush();
  await r.api.pause();
  if (pending) pending({ ok: false, complete: false, reason: 'stopped-by-user', days: [], retry: { dates: [] } });
  await started;
  assert.strictEqual(r.manifest().status, 'paused', 'the proof could not produce a stopped job to resume');
  return r;
}

async function partBRefusalsNameTheRealCause() {
  /* A job with NO recorded stamp (a manifest written before this change) is
     not rescued - it refuses exactly as it always did. */
  const legacy = await startedAndPaused();
  const stripped = JSON.parse(legacy.store.get(legacy.manifestKey()));
  delete stripped.scope;
  legacy.store.set(legacy.manifestKey(), JSON.stringify(stripped));
  assert(!legacy.manifest().scope, 'the pre-change manifest still carries a stamp');
  legacy.setRosterComplete(false);
  const legacyResume = await legacy.api.resume({});
  assert.strictEqual(legacyResume.ok, false, 'a manifest with no recorded scope was resumed on a scope it never proved');
  assert.strictEqual(legacyResume.reason, 'provider-roster-incomplete',
    'a job with no stamp refused under a reason it did not earn: ' + legacyResume.reason);
  assert.strictEqual(legacy.manifest().status, 'waiting-retry', 'the unrescued job did not stay resumable');

  /* A resume blocked by something that is NOT the roster says what it IS. The
     stamp must not paper over an absent schedule reader. */
  const noImporter = await startedAndPaused();
  assert(noImporter.manifest().scope, 'the started job recorded no scope stamp');
  noImporter.setRosterComplete(false);
  noImporter.setImporterPresent(false);
  const blocked = await noImporter.api.resume({});
  assert.strictEqual(blocked.ok, false, 'a resume with no schedule reader reported success');
  assert.strictEqual(blocked.reason, 'importer-not-ready',
    'a resume blocked by the missing schedule reader borrowed another cause: ' + blocked.reason);

  /* ONE copy table answers "what stopped this pull", and none of the answers
     for a non-roster cause mentions the roster or the Day schedule. */
  const api = noImporter.api;
  assert.strictEqual(typeof api.reasonCopy, 'function', 'the range engine does not publish its reason copy');
  const rosterish = /provider roster|provider list|Day schedule/i;
  for (const code of ['importer-not-ready', 'signin', 'signin-expired', 'athena-session-expired', 'no-ext', 'no-athena-tab']) {
    const sentence = String(api.reasonCopy(code) || '');
    assert(sentence.length > 10, 'reason ' + code + ' has no sentence');
    assert(!rosterish.test(sentence), 'reason ' + code + ' borrowed the provider-roster sentence: ' + sentence);
  }
  assert(/provider list/i.test(String(api.reasonCopy('provider-roster-incomplete'))),
    'the genuine roster refusal lost its own sentence');
  console.log('  B2. refusals: no stamp = no rescue; a missing reader says so; no non-roster cause borrows the roster sentence');
}

/* =======================================================================
 * PART C - the Staff Prep picker and the day-pull resume reader, executed.
 * ===================================================================== */
function fakeSelect(values) {
  const options = values.map(v => ({ value: v, textContent: v }));
  return {
    id: 'ez3Prov', value: values[0] || '', options, attrs: {},
    appendChild(node) { this.options.push(node); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; }
  };
}

function partCPickerFreeze() {
  const slice = [
    balanced(CONNECT, 'function p1RangeApi()', 'p1RangeApi'),
    balanced(CONNECT, 'function p1RangeState()', 'p1RangeState'),
    balanced(CONNECT, 'function p1RangeRunning(st)', 'p1RangeRunning'),
    balanced(CONNECT, 'function p1RangeResumable(st)', 'p1RangeResumable'),
    balanced(CONNECT, 'function p1RangeFreezePicker()', 'p1RangeFreezePicker')
  ].join('\n');

  function host(manifest, selectValues, rosterName) {
    const select = fakeSelect(selectValues);
    const note = { id: 'ez3PullScopeLock', textContent: '', style: { display: 'none' } };
    const ctx = vm.createContext({
      console, JSON, Math, Object, String, Number, Boolean, encodeURIComponent,
      safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
      isFn(value) { return typeof value === 'function'; },
      $(id) { return id === 'ez3Prov' ? select : (id === 'ez3PullScopeLock' ? note : null); },
      document: { createElement() { return { value: '', textContent: '' }; } },
      DEFAULT_PROVIDER_SCOPE_LABEL: 'Your athenaOne view (default)',
      window: {
        __mlsP1RangeJobs: {
          installed: true, startMonth() {}, resume() {},
          state() { return manifest; }
        },
        __mlsProviderRoster: rosterName ? { resolve(key) { return String(key) === 'stable-doc-1' ? { id: 'doc-1', stableKey: 'stable-doc-1', name: rosterName } : null; } } : null
      }
    });
    vm.runInContext(slice + '\nthis.__freeze = p1RangeFreezePicker;', ctx, { filename: 'connect-picker-freeze' });
    return { ctx, select, note };
  }

  /* THE OWNER'S SCREENSHOT: a reload leaves the picker on the default while a
     saved job is frozen to a named clinician. */
  let h = host({ status: 'paused', provider: { mode: 'selected', id: 'doc-1', stableKey: 'stable-doc-1' } },
    ['__all', 'pv:stable-doc-1'], 'Clinic Doctor');
  let painted = h.ctx.__freeze();
  assert.strictEqual(painted, 'pv:stable-doc-1', 'the picker did not adopt the saved job scope');
  assert.strictEqual(h.select.value, 'pv:stable-doc-1', 'the picker still showed the default over a frozen job');
  assert.strictEqual(h.select.getAttribute('data-mls-jobscope'), 'pv:stable-doc-1', 'the picker did not record whose scope it is showing');
  assert(h.note.textContent.includes('Clinic Doctor') && /locked/i.test(h.note.textContent),
    'the card never said the scope is locked: ' + h.note.textContent);
  assert.strictEqual(h.note.style.display, '', 'the lock line stayed hidden');
  /* it must NOT disable the control - #ez3Prov is also the visit-list filter */
  assert.notStrictEqual(h.select.disabled, true, 'freezing the scope took away the visit-list filter');

  /* the roster may no longer list the frozen clinician; the card must still
     show that job rather than silently answering "default". */
  h = host({ status: 'needs-attention', provider: { mode: 'selected', id: 'doc-1', stableKey: 'stable-doc-1' } },
    ['__all'], 'Clinic Doctor');
  painted = h.ctx.__freeze();
  assert.strictEqual(painted, 'pv:stable-doc-1', 'a frozen provider missing from the picker was dropped');
  assert(h.select.options.some(o => o.value === 'pv:stable-doc-1' && o.textContent === 'Clinic Doctor'),
    'the missing frozen provider was not minted into the picker');

  /* an all-provider job selects the default and says so. */
  h = host({ status: 'waiting-retry', provider: { mode: 'all' } }, ['__all', 'pv:stable-doc-1'], 'Clinic Doctor');
  assert.strictEqual(h.ctx.__freeze(), '__all', 'an all-provider job did not paint the default scope');
  assert(h.note.textContent.includes('Your athenaOne view (default)'), 'the all-provider lock line named nothing');

  /* a SETTLED job owns nothing. The doctor gets the control back, clean. */
  for (const status of ['complete', 'cancelled']) {
    h = host({ status, provider: { mode: 'selected', id: 'doc-1', stableKey: 'stable-doc-1' } },
      ['__all', 'pv:stable-doc-1'], 'Clinic Doctor');
    h.select.value = '__all';
    assert.strictEqual(h.ctx.__freeze(), '', 'a ' + status + ' job still held the picker');
    assert.strictEqual(h.select.value, '__all', 'a ' + status + ' job moved the picker');
    assert.strictEqual(h.note.style.display, 'none', 'a ' + status + ' job left a stale lock line on screen');
  }
  h = host(null, ['__all'], 'Clinic Doctor');
  assert.strictEqual(h.ctx.__freeze(), '', 'the picker was frozen with no saved job at all');
  console.log('  C1. picker: a saved job owns the "Pulling for" scope after a reload, a settled one hands it back');
}

function partCDayResume() {
  const DAY = '2026-08-19';
  const NAMESPACE = 'sf_u::day-doctor@example.invalid::';
  const slice = [
    balanced(CONNECT, 'function dsReceiptDay(value)', 'dsReceiptDay'),
    balanced(CONNECT, 'function dsReceiptCount(value)', 'dsReceiptCount'),
    balanced(CONNECT, 'function dsTerminalReceiptKey()', 'dsTerminalReceiptKey'),
    balanced(CONNECT, 'function dsLoadTerminalReceipt(day)', 'dsLoadTerminalReceipt'),
    balanced(CONNECT, 'function dsLedgerDone(day)', 'dsLedgerDone'),
    balanced(CONNECT, 'function dsResumeState(day)', 'dsResumeState'),
    balanced(CONNECT, 'function dsResumeLine(stateValue, day)', 'dsResumeLine'),
    balanced(CONNECT, 'function dsOrdinal(n)', 'dsOrdinal'),
    balanced(CONNECT, 'function dsPullVerb(day)', 'dsPullVerb')
  ].join('\n');

  function host(seed, day) {
    const store = new Map(Object.entries(seed || {}));
    const localStorage = {
      getItem(key) { return store.has(String(key)) ? store.get(String(key)) : null; },
      setItem(key, value) { store.set(String(key), String(value)); }
    };
    const ctx = vm.createContext({
      console, JSON, Math, Object, String, Number, Boolean, Date, RegExp, isFinite,
      DS: { day: day || DAY, __resumeCache: null },
      DS_TERMINAL_RECEIPT_SUFFIX: 'dayPullTerminalReceiptV1',
      todayKey() { return '2026-08-20'; },
      fmtDay(k) { return String(k); },
      window: { uns(suffix) { return NAMESPACE + suffix; }, localStorage }
    });
    ctx.window.window = ctx.window;
    vm.runInContext(slice +
      '\nthis.__resume = dsResumeState; this.__verb = dsPullVerb; this.__line = dsResumeLine; this.__ledger = dsLedgerDone;',
      ctx, { filename: 'connect-day-resume' });
    return ctx;
  }

  function ledger(doneCount, pendingCount) {
    const rows = {};
    for (let i = 0; i < doneCount; i++) rows['done-' + i] = { state: 'done', patientId: 'p' + i, appt_date: DAY, updated: 1 };
    for (let i = 0; i < pendingCount; i++) rows['pending-' + i] = { state: 'pending', owner: 'o' + i, appt_date: DAY, updated: 1 };
    return JSON.stringify({ v: 1, rows });
  }
  function receipt(status, parsed, requested) {
    return JSON.stringify({
      v: 1, kind: 'day-pull-terminal', target: DAY, status, at: 1, durable: true,
      reason: status, schedule: { complete: status === 'complete', expected: parsed, parsed },
      history: { requested, processed: requested, complete: false, failures: 0, retry: 0 },
      visitNotes: { requested: false, mode: 'day-facts', read: 0, failures: 0, notRequested: 0 }
    });
  }

  /* 1. a day nothing has ever touched is a PULL, never a promise of a
        checkpoint that does not exist. */
  let ctx = host({});
  let state = ctx.__resume(DAY);
  assert.strictEqual(state.resumable, false, 'an untouched day offered a resume');
  assert.strictEqual(ctx.__verb(DAY), 'Pull Wednesday the 19th', 'an untouched day did not offer a plain pull: ' + ctx.__verb(DAY));

  /* 2. a day whose last attempt FAILED half way is a resume, and the button
        and the sentence both count what actually landed. */
  ctx = host({
    [NAMESPACE + 'schedImportIndexV1::' + DAY]: ledger(7, 1),
    [NAMESPACE + 'dayPullTerminalReceiptV1']: receipt('partial', 19, 19)
  });
  state = ctx.__resume(DAY);
  assert.strictEqual(state.resumable, true, 'a half-finished day did not offer a resume');
  assert.strictEqual(state.done, 7, 'the resume miscounted the appointments already saved');
  assert.strictEqual(state.total, 19, 'the resume did not take the day total athena declared');
  assert.strictEqual(ctx.__verb(DAY), 'Resume Wednesday the 19th', 'the button did not say Resume: ' + ctx.__verb(DAY));
  const line = ctx.__line(state, DAY);
  assert(line.startsWith('Resuming - 7 of 19 already saved.'),
    'the honest resuming line is not the one the doctor reads: ' + line);
  assert(/skipped, not pulled again/.test(line), 'the resuming line does not say what happens to the saved rows');

  /* 3. today reads as today, not as a date. */
  const todayCtx = host({
    [NAMESPACE + 'schedImportIndexV1::2026-08-20']: ledger(3, 0),
    [NAMESPACE + 'dayPullTerminalReceiptV1']: JSON.stringify({
      v: 1, kind: 'day-pull-terminal', target: '2026-08-20', status: 'failed', at: 1, durable: true, reason: 'nav-failed',
      schedule: { complete: false, expected: 11, parsed: 11 }, history: { requested: 3, processed: 3, complete: false, failures: 0, retry: 0 },
      visitNotes: { requested: false, mode: 'day-facts', read: 0, failures: 0, notRequested: 0 }
    })
  }, '2026-08-20');
  assert.strictEqual(todayCtx.__verb('2026-08-20'), 'Resume today', 'today did not name itself on the resume button');

  /* 4. a day whose last attempt COMPLETED is finished. Pressing again is a
        fresh pull, and the button must not imply a checkpoint. */
  ctx = host({
    [NAMESPACE + 'schedImportIndexV1::' + DAY]: ledger(19, 0),
    [NAMESPACE + 'dayPullTerminalReceiptV1']: receipt('complete', 19, 19)
  });
  assert.strictEqual(ctx.__resume(DAY).resumable, false, 'a completed day offered a resume');
  assert.strictEqual(ctx.__verb(DAY), 'Pull Wednesday the 19th', 'a completed day still said Resume');

  /* 5. a ledger with rows but no terminal receipt is NOT a resume - nothing
        proved an attempt ever ended. */
  ctx = host({ [NAMESPACE + 'schedImportIndexV1::' + DAY]: ledger(4, 0) });
  assert.strictEqual(ctx.__resume(DAY).resumable, false, 'a day with no terminal receipt was called resumable');

  /* 6. an unsettled account namespace reads nothing at all - a resume answer
        must never be borrowed from another account's ledger. */
  const anon = vm.createContext({
    console, JSON, Math, Object, String, Number, Boolean, Date, RegExp, isFinite,
    DS: { day: DAY, __resumeCache: null }, DS_TERMINAL_RECEIPT_SUFFIX: 'dayPullTerminalReceiptV1',
    todayKey() { return '2026-08-20'; }, fmtDay(k) { return String(k); },
    window: {
      uns(suffix) { return 'sf_u::_::' + suffix; },
      localStorage: { getItem() { return ledger(9, 0); }, setItem() {} }
    }
  });
  anon.window.window = anon.window;
  vm.runInContext(slice + '\nthis.__resume = dsResumeState;', anon, { filename: 'connect-day-resume-anon' });
  assert.strictEqual(anon.__resume(DAY).done, 0, 'the anonymous namespace read a signed-in ledger');

  /* 7. THE STORAGE HALF, executed: the shipped claim() refuses a row the
        ledger already marks done, which is WHY a second press continues
        instead of restarting. This is the property the UI now names. */
  const claimCtx = vm.createContext({
    console, JSON, Math, Object, String, Number, Date,
    inFlight: {}, PENDING_TTL: 5 * 60 * 1000,
    index: { v: 1, rows: { 'row-done': { state: 'done', patientId: 'p1', appt_date: DAY, updated: 1 } } },
    readIndex() { return claimCtx.index; },
    writeIndex() { return true; }
  });
  vm.runInContext(balanced(IMPORTER, 'function claim(key, meta)', 'claim') + '\nthis.__claim = claim;',
    claimCtx, { filename: 'importer-claim' });
  assert.strictEqual(claimCtx.__claim('row-done', { date: DAY }), '',
    'the ledger stopped refusing a row it already saved - a second press would re-import it');
  const fresh = claimCtx.__claim('row-new', { date: DAY, patientId: 'p2' });
  assert(fresh && fresh.length > 0, 'the ledger refused an unsaved row, so a resume could not finish the day');
  console.log('  C2. day resume: ledger + receipt decide it, the button says Resume, the line counts what landed, done rows are refused');
}

/* =======================================================================
 * PART D - the Year card, in a real browser.
 * ===================================================================== */
function yearFixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>year card proof</title></head>
<body><div id="workspace"></div>
<script>
(function(){
  var account = new URL(location.href).searchParams.get('account') || 'year-doctor@example.invalid';
  window.__MLS_AV='pull-resume-proof';
  window.__MLS_P1_PREVIEW={enabled:true,route:'/1p/',build:'pull-resume-proof'};
  window.__mlsSessionAccount=account; window.session={email:account};
  localStorage.setItem('sf_bk_token','synthetic-token');
  window.uns=function(s){return 'sf_u::'+account+'::'+s;};
  localStorage.setItem(window.uns('acctTz'),'America/New_York');
  var roster=[{id:'doc-1',stableKey:'stable-doc-1',name:'Clinic Doctor'},
              {id:'doc-2',stableKey:'stable-doc-2',name:'Second Clinician'}];
  var calendarOnly=[{id:'',stableKey:'seen-only-3',name:'Calendar Only Clinician'}];
  window.__mlsProviderRoster={installed:true,
    resolve:function(ref){var k=ref&&typeof ref==='object'?(ref.stableKey||ref.id):ref;k=String(k||'');
      var all=roster.concat(calendarOnly);
      for(var i=0;i<all.length;i++){if(all[i].stableKey===k||(all[i].id&&all[i].id===k))return Object.assign({},all[i]);}
      return null;},
    list:function(){return roster.map(function(p){return Object.assign({},p);});},
    seenOnCalendar:function(){return calendarOnly.map(function(p){return Object.assign({},p);});},
    getReceipt:function(){return {complete:true,partial:false,listedCount:roster.length,rosterScope:'painted-day-grid'};}};
  window.__mlsVisitNotesPref={read:function(){return {state:'off',on:false,settled:true};},
    choicePending:function(){return false;},
    ensureChosenForBulkPull:function(){return Promise.resolve({ok:true,on:false,reason:'proof-choice-off'});}};
  window.__yearFixture={calls:[],stopCalls:0};
  window.__mlsSI={installed:true,
    _resolveProviderRequest:function(raw,opts){
      if(raw==='all'||raw==null)return {ok:true,provider:'all',receipt:{complete:true}};
      var e=window.__mlsProviderRoster.resolve(raw);
      return e?{ok:true,provider:{id:e.id,stableKey:e.stableKey,name:e.name,raw:e.name,rosterVerified:true,detectedOnly:false}}
              :{ok:false,reason:'provider-unverified'};},
    stopPull:function(){window.__yearFixture.stopCalls++;return {requested:true};},
    pullMonth:function(o){var rec={month:o.month,dates:o.dates.slice(),provider:o.provider};
      window.__yearFixture.calls.push(rec);
      return new Promise(function(resolve){rec.resolve=resolve;rec.checkpoint=o.onDayCheckpoint;});}};
  window.__fixtureCheckpoint=function(i,date,status){
    var c=window.__yearFixture.calls[i];
    c.checkpoint({date:date,ok:status==='complete',complete:status==='complete',reason:status==='complete'?'complete':'wrong-day'});};
  window.mountStaff=function(providerValue){
    document.getElementById('workspace').innerHTML=
      '<div class="ez3-prov"><select id="ez3Prov">'+
        '<option value="__all">Your athenaOne view (default)</option>'+
        '<option value="pv:stable-doc-1">Clinic Doctor</option>'+
        '<option value="pv:stable-doc-2">Second Clinician</option></select></div>'+
      '<div class="ez3-card ez3-pull"><div class="ph">Pull a month from Athena</div>'+
      '<button type="button" id="ez3PullStart">Start month pull</button></div>';
    document.getElementById('ez3Prov').value=providerValue||'__all';
    return true;};
})();
</script><script src="/range.js"></script></body></html>`;
}

function serveYearFixture() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      res.setHeader('Cache-Control', 'no-store');
      if (pathname === '/range.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        return res.end(RANGE);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(yearFixtureHtml());
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function partDYearCard() {
  const server = await serveYearFixture();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let failure = null;
  try {
    const context = await browser.newContext({ viewport: { width: 980, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
    await page.goto(base + '/?account=year-doctor@example.invalid', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true);
    await page.evaluate(() => window.mountStaff('pv:stable-doc-2'));
    await page.waitForSelector('#mlsP1YearProv');

    /* 1. THE OWNER'S ASK: the year card has its own "Pulling for" selector,
          with the same options as the month card INCLUDING the csp-1.0.0
          calendar-only group, and it follows the month card until touched. */
    const picker = await page.evaluate(() => {
      const select = document.getElementById('mlsP1YearProv');
      const group = select.querySelector('optgroup');
      return {
        label: select.parentElement.textContent.trim().slice(0, 20),
        values: Array.from(select.options).map(o => o.value),
        value: select.value, disabled: select.disabled,
        groupLabel: group ? group.getAttribute('label') : '',
        groupValues: group ? Array.from(group.querySelectorAll('option')).map(o => o.value) : [],
        provider: document.getElementById('mlsP1YearProvider').textContent
      };
    });
    assert(picker.label.startsWith('Pulling for'), 'the year card selector is not labelled "Pulling for": ' + picker.label);
    assert(picker.values.includes('__all') && picker.values.includes('pv:stable-doc-1') && picker.values.includes('pv:stable-doc-2'),
      'the year picker does not carry the month card options: ' + picker.values.join(','));
    assert.strictEqual(picker.groupLabel, 'Seen on the athena calendar - not verified yet',
      'the calendar-only group is missing from the year picker');
    assert.deepStrictEqual(picker.groupValues, ['pv:seen-only-3'], 'the calendar-only clinician is not offerable on the year card');
    assert.strictEqual(picker.value, 'pv:stable-doc-2', 'the year picker did not follow the month card selection');
    assert.strictEqual(picker.disabled, false, 'the year picker was frozen with no job running');
    assert(picker.provider.includes('Second Clinician'), 'the year card named a provider it is not scoped to: ' + picker.provider);

    /* 2. its own choice wins over the month card, and it is the scope the
          engine is actually started with. */
    await page.selectOption('#mlsP1YearProv', 'pv:stable-doc-1');
    await page.evaluate(() => window.mountStaff('pv:stable-doc-2'));
    await page.waitForFunction(() => document.getElementById('mlsP1YearProv') &&
      document.getElementById('mlsP1YearProv').value === 'pv:stable-doc-1');
    const years = await page.evaluate(() => Array.from(document.getElementById('mlsP1YearChoice').options).map(o => o.value));
    await page.click('#mlsP1YearStart');
    await page.waitForFunction(() => window.__yearFixture.calls.length === 1);
    const started = await page.evaluate(() => ({
      provider: window.__yearFixture.calls[0].provider,
      month: window.__yearFixture.calls[0].month,
      target: window.__mlsP1RangeJobs.state().target
    }));
    assert.strictEqual(started.provider.stableKey, 'stable-doc-1',
      'the year card started under a provider the doctor did not pick on it');
    assert.strictEqual(started.target, years[0], 'the year job did not take the picked year');

    /* 3. while it runs, the picker is FROZEN, shows the job scope, and says so. */
    const running = await page.evaluate(() => ({
      value: document.getElementById('mlsP1YearProv').value,
      disabled: document.getElementById('mlsP1YearProv').disabled,
      lockHidden: document.getElementById('mlsP1YearProvLock').hidden,
      lock: document.getElementById('mlsP1YearProvLock').textContent,
      yearDisabled: document.getElementById('mlsP1YearChoice').disabled
    }));
    assert.strictEqual(running.value, 'pv:stable-doc-1', 'the running job stopped showing its own scope');
    assert.strictEqual(running.disabled, true, 'the scope could be changed while the job was running');
    assert.strictEqual(running.lockHidden, false, 'nothing told the doctor the scope was locked');
    assert(running.lock.includes('Clinic Doctor'), 'the lock line did not name the frozen provider: ' + running.lock);
    assert.strictEqual(running.yearDisabled, true, 'the year could be changed mid-job');

    /* 4. THE INDICATOR: bar + months/days sentence + the four honest tiles,
          every number from the manifest's own recounted summary. */
    const firstMonth = await page.evaluate(() => window.__yearFixture.calls[0].dates.slice(0, 3));
    await page.evaluate(dates => {
      window.__fixtureCheckpoint(0, dates[0], 'complete');
      window.__fixtureCheckpoint(0, dates[1], 'complete');
      window.__fixtureCheckpoint(0, dates[2], 'failed');
    }, firstMonth);
    await page.waitForFunction(() => Number(document.getElementById('mlsP1YearProgress').value) === 2);
    const painted = await page.evaluate(() => {
      const summary = window.__mlsP1RangeJobs.state().summary;
      return {
        summary,
        bar: Number(document.getElementById('mlsP1YearProgress').value),
        barMax: Number(document.getElementById('mlsP1YearProgress').max),
        count: document.getElementById('mlsP1YearCount').textContent,
        months: document.getElementById('mlsP1YearMonths').textContent,
        rows: document.getElementById('mlsP1YearTileRows').textContent,
        saved: document.getElementById('mlsP1YearTileSaved').textContent,
        empty: document.getElementById('mlsP1YearTileEmpty').textContent,
        attention: document.getElementById('mlsP1YearTileAttention').textContent,
        tileLabels: Array.from(document.querySelectorAll('#mlsP1YearTiles .p1yr-tile span')).map(n => n.textContent)
      };
    });
    assert.strictEqual(painted.bar, 2, 'the year bar did not follow the durable day checkpoints');
    assert(painted.barMax >= 200, 'the year bar is not scaled to the year: max=' + painted.barMax);
    assert.strictEqual(painted.saved, String(painted.summary.complete), 'the "days saved" tile disagrees with the manifest summary');
    assert.strictEqual(painted.rows, String(painted.summary.withRows), 'the "days with visits" tile disagrees with the manifest summary');
    assert.strictEqual(painted.empty, String(painted.summary.empty), 'the "verified empty" tile disagrees with the manifest summary');
    assert.strictEqual(painted.attention, String(painted.summary.needsAttention), 'the "need attention" tile disagrees with the manifest summary');
    assert.deepStrictEqual(painted.tileLabels, ['days with visits', 'days saved', 'verified empty', 'need attention'],
      'the year tiles are not the month card quantities: ' + painted.tileLabels.join(' | '));
    assert(/^\d+ of \d+ months? complete - \d+ of \d+ days saved$/.test(painted.months),
      'the year card has no months-and-days indicator: ' + painted.months);
    assert(painted.months.startsWith('0 of '), 'a year with no finished month claimed one: ' + painted.months);
    assert(/ - 2 of \d+ days saved$/.test(painted.months), 'the months line lost the day count: ' + painted.months);

    /* 5. a reload shows the same frozen scope on the year card, with no pull. */
    await page.evaluate(() => window.__mlsP1RangeJobs.pause());
    await page.waitForFunction(() => window.__mlsP1RangeJobs.state().status === 'paused');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed === true);
    await page.evaluate(() => window.mountStaff('__all'));
    await page.waitForSelector('#mlsP1YearProv');
    await page.waitForFunction(() => document.getElementById('mlsP1YearProv').disabled === true);
    const reloaded = await page.evaluate(() => ({
      calls: window.__yearFixture.calls.length,
      value: document.getElementById('mlsP1YearProv').value,
      disabled: document.getElementById('mlsP1YearProv').disabled,
      lock: document.getElementById('mlsP1YearProvLock').textContent,
      months: document.getElementById('mlsP1YearMonths').textContent,
      saved: document.getElementById('mlsP1YearTileSaved').textContent,
      resumeHidden: document.getElementById('mlsP1YearResume').hidden
    }));
    assert.strictEqual(reloaded.calls, 0, 'the reload restarted Athena work on its own');
    assert.strictEqual(reloaded.value, 'pv:stable-doc-1',
      'after a reload the year picker showed the default over a saved job frozen elsewhere');
    assert.strictEqual(reloaded.disabled, true, 'the reloaded card let the saved job scope be changed');
    assert(reloaded.lock.includes('Clinic Doctor'), 'the reloaded card did not say whose pull is saved');
    assert(/ - 2 of \d+ days saved$/.test(reloaded.months), 'the reloaded card lost the saved progress: ' + reloaded.months);
    assert.strictEqual(reloaded.saved, '2', 'the reloaded tiles forgot the days already saved');
    assert.strictEqual(reloaded.resumeHidden, false, 'a paused year job offered no Resume after a reload');
    assert.strictEqual(pageErrors.length, 0, 'the year card raised browser errors: ' + pageErrors.join(' | '));
    await context.close();
    console.log('  D. year card: own frozen "Pulling for" picker (incl. calendar-only group), bar, months/days line, four honest tiles');
  } catch (error) {
    failure = error;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  if (failure) throw failure;
}

/* =======================================================================
 * PART E - the two routes that produced the owner's measured sentence.
 * ===================================================================== */
function partERouting() {
  const month = balanced(CONNECT, 'function startMonthPull(retryOnly, rosterRetried, choiceAdmitted, fullNotesChoice)', 'startMonthPull');
  const gateAt = month.indexOf('_resolveProviderRequest(activeProviderRequest()');
  const resumeAt = month.indexOf('if (retryOnly === true && p1RangeApi())');
  assert(resumeAt > 0, 'Retry no longer routes to the durable resume at all');
  assert(gateAt > 0, 'a NEW start no longer preflights the canonical roster');
  assert(resumeAt < gateAt,
    'Retry still runs the live roster gate BEFORE the durable resume - the owner measured exactly this');
  assert(month.includes('requireRosterForAll: true'), 'a new all-provider month start stopped requiring a verified roster');
  const autoVerifyAt = month.indexOf('Setting up Athena automatically');
  assert(autoVerifyAt > resumeAt, 'the automatic Day-schedule re-verify still runs ahead of a resume');

  /* the settle path speaks the job's own reason instead of one generic line */
  const settled = balanced(CONNECT, 'function p1RangeSettled(result)', 'p1RangeSettled');
  assert(settled.includes('p1RangeReasonCopy(st.reason)'),
    'a stopped month pull no longer names its own cause on the card');
  assert(settled.includes('p1RangeReasonCopy(result.reason)'),
    'a refused resume no longer names its own cause on the card');

  /* and the picker painter runs on the reload path - outside the no-P return */
  const counts = balanced(CONNECT, 'function pCounts()', 'pCounts');
  const freezeAt = counts.indexOf('p1RangeFreezePicker()');
  const earlyReturnAt = counts.indexOf('if (!P) {');
  assert(freezeAt > 0 && earlyReturnAt > 0 && freezeAt < earlyReturnAt,
    'the picker painter sits behind the no-in-tab-pull early return, which is the reload case itself');

  /* the twins stay identical; the derived lanes are generated, never edited */
  const production = fs.readFileSync('feat_mls_rangejobs.js', 'utf8');
  const expected = RANGE
    .split('__MLS_P1_PREVIEW').join('__MLS_MAIN')
    .split("(preview.route === '/1p/' || preview.route === '/1pScribeFlow.html')")
      .join("(preview.route === '/ScribeFlow.html' || preview.route === '/')")
    .split('1p-feat_').join('feat_');
  assert.strictEqual(production, expected, 'the promoted range asset drifted from /1p beyond lane identity');
  console.log('  E. routing: Retry resumes before the gate, a new start still gates, the card names the real cause');
}

async function main() {
  console.log('pullresume-1.0.0 - resume, proven');
  partAImporterGate();
  await partBFrozenScopeResume();
  await partBRefusalsNameTheRealCause();
  partCPickerFreeze();
  partCDayResume();
  await partDYearCard();
  partERouting();
  console.log('PASS pullresume-1.0.0: a resume stands on the scope its own start verified (a new start still gates), ' +
    'refusals name the real cause, the "Pulling for" picker shows the saved job after a reload, a stopped day pull ' +
    'resumes and says how much already landed, and the Year card carries the month card indicator with its own frozen picker');
}

main().catch(error => { console.error(error); process.exit(1); });

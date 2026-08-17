'use strict';

/* ed-1.0.0 (live, production, 2026-08-17): a VERIFIED-EMPTY day must never be
 * handed to the AI schedule-text parser.
 *
 * What the owner saw on the main site for Mon 2026-08-31: "The Athena grid was
 * still settling - re-reading automatically (attempt 3 of 3)..." and then "The
 * pull did not return a verified completion receipt (schedule-parse-timeout)".
 * The receipt on his tab said the opposite of "settling": authoritativeEmpty
 * true, liveSessionProven true, complete true, 0 rows, empty text. The engine
 * had proved the day empty (authoritativeEmptyContract) and then STILL fell
 * into `_parseScheduleText(r.text)` — an AI call — bounded to 25 s; the AI was
 * slow, the deadline fired, and the day-strip's transient-refusal auto-retry
 * re-ran the same thing twice more.
 *
 * This suite drives the REAL engine (feat_mls_schedimport_exact.js) with a
 * fake extension and a fake `_parseScheduleText` that records calls and never
 * resolves (a hung AI). It asserts:
 *   1. a verified-empty day completes as verified empty, the parser is NOT
 *      called, and the reason is not schedule-parse-timeout;
 *   2. a NON-empty text-only day (no exact rows, text present, not
 *      authoritative-empty) still calls the parser — the fallback is intact;
 *   3. CAUSAL: the pre-fix engine (origin/main before ed-1.0.0) DID call the
 *      parser for scenario 1 — proven by evaluating the same harness against
 *      the historical bytes when git can produce them.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const enginePath = path.join(root, 'feat_mls_schedimport_exact.js');
const source = fs.readFileSync(enginePath, 'utf8');
assert(source.includes('ed-1.0.0'), 'ed-1.0.0 guard comment missing from feat_mls_schedimport_exact.js');
assert(/var parsedP = verifiedEmptyDay\s*\?\s*Promise\.resolve\(\[\]\)\s*:\s*exactRows\.length/.test(source),
  'ed-1.0.0: parsedP must short-circuit to [] on a verified-empty day BEFORE the exactRows/text-parse ladder');

function harness(engineSource, scenario) {
  const listeners = new Set();
  const statuses = [];
  const store = new Map();
  const day = scenario.day;
  const parserCalls = [];
  const context = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp, Error, Map, Set,
    encodeURIComponent, decodeURIComponent, queueMicrotask, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {},
    location: { pathname: '/ScribeFlow.html', origin: 'https://mlsscribe.com' },
    localStorage: {
      getItem: key => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      key: i => Array.from(store.keys())[i] || null,
      get length() { return store.size; }
    },
    document: {
      readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
      getElementById: () => null, addEventListener: () => {}, removeEventListener: () => {},
      body: {}, head: { appendChild: () => {} }, documentElement: { appendChild: () => {} }, hidden: false, visibilityState: 'visible'
    },
    backendMode: () => true, bkToken: () => 'test-token', bkBase: () => 'https://local.invalid',
    uns: key => `ed-1.0.0-test::${key}`,
    _normDate: value => String(value || '').slice(0, 10),
    _calAppts: [],
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
    dispatchEvent: () => {},
    /* The AI parser: record the call and HANG (never resolve) — exactly the
       failure the owner hit. If the engine reaches it, only the 25 s deadline
       can rescue the pull, and this suite would take 25 s and report a
       schedule-parse-timeout. */
    _parseScheduleText: function (text) { parserCalls.push(String(text == null ? '' : text)); return new Promise(function () {}); },
    fetch: async (url, opts) => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, appointments: [], created: 0, repaired: 0, skipped: 0, failed: 0, rows: [], items: [] }),
      text: async () => '{}'
    })
  };
  context.window = context;
  function emit(type, resp, id) {
    const event = { data: { source: 'mls-ext', type, id: id || '', resp } };
    Array.from(listeners).forEach(fn => fn(event));
  }
  context.postMessage = message => {
    if (message.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true, version: '3.0.62' }, ''));
    if (message.type === 'mlsAppGotoDate') queueMicrotask(() => emit('mlsAppGotoDateResult', {
      id: message.id, requestId: message.id, ok: true, schedDate: day
    }, message.id));
    if (message.type === 'mlsAppPullSchedule') queueMicrotask(() => emit('mlsAppScheduleResult', Object.assign({
      id: message.id, requestId: message.id, ok: true, schedDate: day
    }, scenario.scheduleResult(message)), message.id));
    /* Any other read (roster, history, census) answers "nothing" quickly. */
    if (/^mlsApp(ProviderRoster|ReadChart|Visits|Census|Enumerate)/.test(String(message.type || ''))) {
      queueMicrotask(() => emit(String(message.type) + 'Result', { id: message.id, requestId: message.id, ok: false, error: 'not-in-this-test' }, message.id));
    }
  };
  vm.runInNewContext(engineSource, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 5000 });
  const api = context.__mlsSI;
  assert(api && typeof api.pull === 'function', 'engine did not install __mlsSI.pull');
  return { api, statuses, parserCalls };
}

const emptyReceipt = (reqId) => ({
  complete: true, authoritativeEmpty: true, requestId: reqId,
  expectedCount: 0, candidateCount: 0, parsedCount: 0, declaredCount: 0, unnamedCount: 0,
  domValidRows: 0, textValidRows: 0, mergedRows: 0, liveSessionProven: true, scheduleVerified: true
});

const verifiedEmptyScenario = {
  day: '2026-08-31',
  scheduleResult: (message) => ({ text: '', appts: [], receipt: emptyReceipt(message.requestId || message.id),
    diag: { canonicalCount: 0, reconciledCount: 0 }, providerDiag: { domValidRows: 0, textValidRows: 0, mergedRows: 0 } })
};
const textOnlyScenario = {
  day: '2026-08-31',
  scheduleResult: (message) => {
    const requestId = message.requestId || message.id;
    return {
      text: '7:30 AM  Someone Synthetic  DOB 01/02/1980  Follow-up\n8:00 AM  Another Synthetic  DOB 03/04/1975  New', appts: [],
      receipt: { complete: true, authoritativeEmpty: false, requestId, expectedCount: 2, candidateCount: 2, parsedCount: 0,
        declaredCount: 2, unnamedCount: 0, domValidRows: 0, textValidRows: 2, mergedRows: 0, liveSessionProven: true, scheduleVerified: true },
      providers: ['Synthetic Provider, MD'],
      providerRoster: [{ name: 'Synthetic Provider, MD', id: 'p1', stableKey: 'athena:synthetic provider md' }],
      /* a COMPLETE roster receipt bound to this exact request, all-providers mode */
      providerRosterReceipt: { complete: true, partial: false, reason: 'complete', observed: 1, observedCount: 1, expectedCount: 1,
        requestId, targetDate: '2026-08-31', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '',
        attributionCoverage: { verdict: 'row-unattributed', rows: 2, headerCount: 1, unattributedRows: 2, foreignRows: 0 } },
      providerDiag: { domValidRows: 0, textValidRows: 2, mergedRows: 0, providerNames: ['Synthetic Provider, MD'] }
    };
  }
};

function race(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' did not settle within ' + ms + ' ms')), ms))]);
}

(async () => {
  /* 1. verified-empty day: parser never called, no parse-timeout, settles fast */
  const t0 = Date.now();
  const h1 = harness(source, verifiedEmptyScenario);
  const r1 = await race(h1.api.pull({ date: verifiedEmptyScenario.day, includeHistory: false, onStatus: (m, k) => h1.statuses.push({ message: String(m || ''), kind: String(k || '') }) }), 12000, 'verified-empty pull');
  const dt = Date.now() - t0;
  assert.strictEqual(h1.parserCalls.length, 0, `ed-1.0.0: the AI schedule parser was called ${h1.parserCalls.length}× on a verified-empty day`);
  assert.notStrictEqual(String(r1 && r1.reason || ''), 'schedule-parse-timeout', 'a verified-empty day still refused with schedule-parse-timeout');
  assert(!h1.statuses.some(s => /did not finish in time/.test(s.message)), 'the parse-timeout status was painted for a verified-empty day');
  assert(dt < 12000, `verified-empty pull took ${dt} ms — it must not wait on any parse deadline`);
  assert.strictEqual(!!(r1 && r1.ok), true, 'a verified-empty day must COMPLETE (ok:true); got reason ' + String(r1 && r1.reason));
  assert.strictEqual(String(r1 && r1.reason || ''), 'empty-day', 'a verified-empty day must complete with reason empty-day');

  /* 2. text-only day (no exact rows, text present): the fallback still runs */
  const h2 = harness(source, textOnlyScenario);
  const p2 = h2.api.pull({ date: textOnlyScenario.day, includeHistory: false, onStatus: (m, k) => h2.statuses.push({ message: String(m || ''), kind: String(k || '') }) });
  /* give the engine a moment to reach the parse ladder; the parser hangs by design, so do not await completion */
  await new Promise(r => setTimeout(r, 1500));
  assert.strictEqual(h2.parserCalls.length, 1, `text-only fallback must still call the parser exactly once (called ${h2.parserCalls.length}×)`);
  assert(h2.parserCalls[0].indexOf('Someone Synthetic') >= 0, 'the parser must receive the schedule text');
  p2.catch(() => {}); /* leave it hanging; the deadline is the engine's business */

  /* 3. CAUSAL: the pre-fix engine called the parser on the verified-empty day */
  const prior = spawnSync('git', ['show', 'origin/main:feat_mls_schedimport_exact.js'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (prior.status === 0 && prior.stdout && prior.stdout.length > 100000 && !prior.stdout.includes('ed-1.0.0')) {
    const h3 = harness(prior.stdout, verifiedEmptyScenario);
    const p3 = h3.api.pull({ date: verifiedEmptyScenario.day, includeHistory: false, onStatus: () => {} });
    await new Promise(r => setTimeout(r, 1500));
    assert(h3.parserCalls.length >= 1, 'CAUSAL CONTROL: the pre-fix engine did NOT call the parser on a verified-empty day — this test would not have caught the defect');
    p3.catch(() => {});
    console.log('  [causal control] pre-fix engine called the AI parser ' + h3.parserCalls.length + '× on a verified-empty day; ed-1.0.0 calls it 0×');
  } else {
    console.log('  [causal control] skipped — origin/main already carries ed-1.0.0 or is unavailable');
  }
  console.log(`PASS ed-1.0.0: a verified-empty day never reaches the AI schedule parser (settled in ${dt} ms, reason ${JSON.stringify(String(r1 && r1.reason || ''))}); the text-only fallback still calls it once`);
  process.exit(0);
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });

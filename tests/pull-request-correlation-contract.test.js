'use strict';
/* b346 pull-request correlation + stale-response contract.
 *
 * Guards four guarantees added for "one authoritative date/provider":
 *  1. The ACTIVE EZ3 engine bridge stamps every outgoing extension request
 *     with a fresh requestId and REJECTS replies that echo a different id
 *     (cross-talk between concurrent pulls: si pulls, relay jobs, probes).
 *  2. The pullrec bridgeOnce (pullScheduleViaAssist probe/auto-nav path)
 *     carries the same correlation contract.
 *  3. loadCalendar is newest-wins: an older in-flight /api/appointments
 *     response can never overwrite _calAppts or the instant-paint cache
 *     after a newer call started (stale-cache-overwrites-fresh-pull bug).
 *  4. si (feat_mls_schedimport_exact) and the EZ3 staff/month engine
 *     mutually exclude via the SHARED window.__mlsSchedulePullLease slot,
 *     so a day pull and a month pull can never interleave goto-date/reads
 *     on the one Athena tab.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const b18 = fs.readFileSync(path.join(root, 'feat_b18_qa.js'), 'utf8');
const b121 = fs.readFileSync(path.join(root, 'feat_mls_b121_pack.js'), 'utf8');

function between(source, start, end, label) {
  const at = source.indexOf(start);
  assert(at >= 0, label + ' start not found');
  const stop = source.indexOf(end, at + start.length);
  assert(stop > at, label + ' end not found');
  return source.slice(at, stop);
}

function extractFunction(source, signature, label) {
  const at = source.indexOf(signature);
  assert(at >= 0, label + ' not found');
  const open = source.indexOf('{', at);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  assert.fail(label + ' closing brace not found');
}

/* ---- 1. active engine bridge correlation ---- */
const activeBridgeAt = connect.indexOf("var reqId = 'ez3-'");
assert(activeBridgeAt > 0, 'active engine bridge does not mint a request id');
const activeBridge = connect.slice(activeBridgeAt, activeBridgeAt + 2600);
assert(activeBridge.includes('if (gotId && gotId !== reqId) return;'),
  'active engine bridge does not reject foreign-id replies');
assert(activeBridge.includes('msg.id = reqId; msg.requestId = reqId;'),
  'active engine bridge does not stamp outgoing requests');
/* the dormant stacked engine copies carry the same contract */
const dormantCopies = connect.split("var reqId = 'ez3d-'").length - 1;
assert(dormantCopies >= 3, 'dormant engine bridge copies lost the correlation patch (found ' + dormantCopies + ')');

/* ---- 2. pullrec bridgeOnce correlation ---- */
const prfAt = connect.indexOf("var reqId = 'prf-'");
assert(prfAt > 0, 'pullrec bridgeOnce does not mint a request id');
const prf = connect.slice(prfAt, prfAt + 1400);
assert(prf.includes('if (gotId && gotId !== reqId) return;'),
  'pullrec bridgeOnce does not reject foreign-id replies');

/* ---- 3. loadCalendar newest-wins ---- */
const lcAt = app.indexOf('async function loadCalendar(');
assert(lcAt > 0, 'loadCalendar not found');
const lc = app.slice(lcAt, app.indexOf('function _calFilterVal', lcAt));
assert(lc.includes('window.__mlsCalLoadSeq=(window.__mlsCalLoadSeq||0)+1'),
  'loadCalendar does not take a sequence number');
const staleChecks = lc.split('if(!_calRequestCurrent())').length - 1;
assert(staleChecks >= 4, 'loadCalendar stale-response checks missing (found ' + staleChecks + ')');
assert(lc.includes("if(_calSeq!==window.__mlsCalLoadSeq) return 'superseded';"),
  'loadCalendar no longer distinguishes an older overlapping read');
const cacheWriteAt = lc.indexOf("localStorage.setItem(uns('calApptsCacheV2')");
assert(cacheWriteAt > 0, 'loadCalendar cache write not found');
assert(lc.lastIndexOf('if(!_calRequestCurrent())') < cacheWriteAt,
  'a stale-response check must guard the cache write');
assert(lc.indexOf('if(!_calRequestCurrent())') < lc.indexOf('_calAppts=d.appointments'),
  'a stale-response check must precede applying fetched appointments');
assert(lc.includes('window.__mlsCalendarMutationEpoch'),
  'loadCalendar does not capture/check the shared appointment mutation epoch');
assert(/\/api\/appointments['"`]\s*,\s*\{[\s\S]*?cache\s*:\s*['"]no-store['"]/.test(lc),
  'loadCalendar appointments GET is not explicitly cache:no-store');
assert(lc.includes('Array.isArray(d.appointments)'),
  'loadCalendar accepts an appointments payload without validating the array');
assert(!/d\.appointments\s*\|\|\s*\[\]/.test(lc),
  'loadCalendar still coerces malformed appointments payloads to an authoritative empty array');

/* The base loader is now the authoritative error boundary. Satellite wrappers
   may add normalization/render work, but they must never alternate ownership
   by dropping a marker installed by an inner wrapper. */
const LOAD_MARKERS = ['__prf', '__dkf', '__mlsDobWrap', '__mlsWrapped'];
function assertMarkerPropagation(block, label, ownMarker) {
  assert(block.includes(ownMarker), label + ' does not guard its current outer wrapper with ' + ownMarker);
  for (const marker of LOAD_MARKERS) {
    assert(block.includes(marker), label + ' does not propagate prior marker ' + marker);
  }
  assert(/\.forEach\s*\(function\s*\(\s*marker\s*\)/.test(block) &&
      (block.match(/\[marker\]/g) || []).length >= 3,
    label + ' lists markers but does not copy truthy inner markers onto the new outer wrapper');
}
const b18Wrap = between(b18, 'function wrapLoad(){', '/* (2) change-watcher', 'b18 loadCalendar wrapper');
const b121DkfWrap = between(b121, 'if (typeof window.loadCalendar === \'function\' && !window.loadCalendar.__dkf)', '/* ------------------------------ data access', 'b121 date-key loadCalendar wrapper');
const b121DobWrap = between(b121, 'function wrapLoad() {', 'function wrapSave()', 'b121 DOB loadCalendar wrapper');
const prfWrap = between(connect, 'if (isFn(window.loadCalendar) && !window.loadCalendar.__prf)', 'if (isFn(window._calDateOf)', 'PRF loadCalendar wrapper');
assertMarkerPropagation(b18Wrap, 'b18 loadCalendar wrapper', 'window.loadCalendar.__mlsWrapped');
assertMarkerPropagation(b121DkfWrap, 'b121 date-key loadCalendar wrapper', 'window.loadCalendar.__dkf');
assertMarkerPropagation(b121DobWrap, 'b121 DOB loadCalendar wrapper', 'f.__mlsDobWrap');
assertMarkerPropagation(prfWrap, 'PRF loadCalendar wrapper', 'window.loadCalendar.__prf');

/* T6 may still coalesce harmless provider/status polling, but appointment reads
   are freshness-sensitive and every successful appointment mutation invalidates
   any loadCalendar call that captured the previous epoch. */
const t6Fetch = between(connect,
  '/* ================= RC4: FETCH COALESCER (hot GET polls) ================= */',
  '/* housekeeping: drop stale TTL entries',
  'T6 fetch stabilizer');
assert(!/var\s+HOT\s*=\s*\/[^\n;]*appointments/.test(t6Fetch),
  'T6 still classifies GET /api/appointments as a TTL/coalescing hot poll');
assert(t6Fetch.includes('__mlsCalendarMutationEpoch'),
  'T6 does not advance the shared calendar mutation epoch');
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  assert(t6Fetch.includes(method),
    'T6 mutation classifier does not cover ' + method + ' appointment writes');
}
assert(t6Fetch.includes('emr-sync') && t6Fetch.includes('schedule'),
  'T6 mutation classifier does not cover the Athena schedule import endpoint');

/* ---- 4. si <-> engine mutual exclusion on the shared page lease ---- */
assert(si.includes('function foreignPullLease()'), 'si does not check the shared page lease');
assert(si.includes('if (foreignPullLease()) return Promise.resolve(busy("same-tab"));'),
  'si does not refuse to start while the engine holds the pull lease');
assert(si.includes('window.__mlsSchedulePullLease = { id: SI_LEASE_ID'),
  'si does not claim the shared page lease while running');
assert(si.includes('releaseSiLease()'), 'si never releases the shared page lease');
/* engine side: claimPullLease refuses foreign fresh leases (pre-existing contract) */
assert(connect.includes('if (l && l.id !== _ez3PullLeaseId) return false;'),
  'engine claimPullLease no longer refuses foreign leases');

/* ---- 5. the "Finding patients..." stage always terminates ---- */
assert(si.includes('schedule-parse-deadline-exceeded'),
  'schedule text-parse fallback is not deadline-bounded');
assert(si.includes('schedule-parse-timeout'),
  'schedule parse timeout does not produce a terminal fail reason');

/* ---- 6. rl-2.0.0 mobile<->desktop sync contract ---- */
const rlAt = connect.indexOf("version: 'rl-2.0.0'");
assert(rlAt > 0, 'relay module is not rl-2.0.0');
const rl = connect.slice(connect.lastIndexOf('__mlsRelayLink rl-', rlAt) >= 0 ? connect.lastIndexOf('/* ===== __mlsRelayLink', rlAt) : rlAt, connect.indexOf('__mlsPhoneHome ph-', rlAt));
/* right computer: role-gated agent + device-targeted polling. pdp-1.0.0
   widened eligibility to office OR secondary, but a secondary computer may
   ONLY poll targeted jobs (never legacy untargeted office work). */
assert(rl.includes('function agentEligible()'), 'agent is not role gated');
assert(rl.includes("r === 'office' || r === 'secondary'"), 'agentEligible must allow exactly office/secondary');
assert(rl.includes("&targetedOnly=1"), 'secondary agent does not poll targetedOnly');
assert(rl.includes('if (sec && !did) { agentBusy = false; return; }'), 'secondary agent may poll without a device id');
assert(rl.includes('/api/relay/jobs/next' + "' + (did ? ('?deviceId="), 'agent does not poll with its deviceId');
assert(rl.includes('targetDeviceId: targetDeviceId'), 'phone jobs are not targeted at the office device');
assert(rl.includes('(presence && presence.officeId)'), 'phone does not take the target from presence.officeId');
/* frozen date/provider + requestId travel; the phone verifies the echo */
assert(rl.includes("dedupeKey: 'pullDay|' + date + '|'"), 'duplicate commands are not deduped server-side');
/* Pin moved deliberately at b656 (rl-2.0.2 N4), not relaxed. The frozen trio is
   still asserted verbatim; it simply became a named object so the requesting
   device's "Full visit notes" choice could be added WITHOUT it. That choice has
   to travel because the importer otherwise reads pullVisitBodies from the
   EXECUTING device's localStorage — so the office computer's checkbox silently
   decided how much of the record a phone-commanded pull returned. */
assert(rl.includes('var jobPayload = { date: date, provider: provider, requestId: requestId }'),
  'job payload does not freeze date/provider/requestId');
assert(rl.includes('payload: jobPayload'), 'the queued job does not send the frozen payload');
assert(rl.includes('jobPayload.pullVisitBodies = !!_bt.checked'),
  'the requesting device\'s Full visit notes choice must travel with the job');
assert(rl.includes("if (_bt && typeof _bt.checked === 'boolean')"),
  'an absent control must send NOTHING, leaving the executing device in charge');
assert(rl.includes('pulled !== date'), 'phone does not verify the pulled-day echo before claiming success');
assert(rl.includes('requestedDate: date'), 'agent result does not echo the requested date');
/* honest disconnects + reload recovery + progress mirroring */
assert(rl.includes("job.status === 'lost'"), 'phone does not surface lost executors');
assert(rl.includes("job.status === 'canceled'"), 'phone does not surface canceled jobs');
assert(rl.includes('function makeProgressPoster('), 'agent does not relay live progress');
assert(rl.includes('job.progress && job.progress.note'), 'phone does not mirror per-patient progress');
assert(rl.includes("var ACTIVE_KEY = 'mlsRlActiveJob'"), 'active job is not persisted for reload recovery');
assert(rl.includes('Rejoining the Athena pull'), 'reload does not rejoin the in-flight pull');
assert(rl.includes('api.cancelActive'), 'no cancel affordance for the active job');
assert(rl.includes('is still running on'), 'no single-flight refusal for a different-date pull');
/* timeout ladder fits a real full-history day (old 150s starved 20-patient days) */
assert(rl.includes('510000'), 'agent pull deadline no longer fits a full-history day');
assert(rl.includes('tries > 252'), 'phone polling window no longer fits a full-history day');
/* at-most-once execution per job id on the agent */
assert(rl.includes('if (executedJobs[job.id])'), 'agent can execute the same job twice');

function response(status, body, parseError) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json() {
      if (parseError) return Promise.reject(new Error(parseError));
      return Promise.resolve(body);
    },
    clone() { return response(status, body, parseError); }
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function assertLoadResult(result, label) {
  assert(result && typeof result === 'object', label + ' did not return a structured result');
  for (const key of ['applied', 'authoritative', 'seq', 'epoch', 'count', 'error', 'discarded']) {
    assert(Object.prototype.hasOwnProperty.call(result, key), label + ' result omitted ' + key);
  }
  assert.strictEqual(typeof result.applied, 'boolean', label + ' applied is not boolean');
  assert.strictEqual(typeof result.authoritative, 'boolean', label + ' authoritative is not boolean');
  assert.strictEqual(typeof result.seq, 'number', label + ' seq is not numeric');
  assert.strictEqual(typeof result.epoch, 'number', label + ' epoch is not numeric');
  assert.strictEqual(typeof result.count, 'number', label + ' count is not numeric');
  assert.strictEqual(typeof result.error, 'string', label + ' error is not a string');
  assert.strictEqual(typeof result.discarded, 'string', label + ' discarded is not a string');
}

function makeCalendarHarness(seedRows, appointmentReplies) {
  const calls = [];
  const queue = appointmentReplies.slice();
  const context = {
    console,
    Promise,
    Date,
    JSON,
    Math,
    setTimeout,
    clearTimeout,
    __renders: 0,
    __checkinRenders: 0,
    localStorage: { getItem() { return null; }, setItem() {} },
    document: { getElementById() { return { innerHTML: '' }; } },
    backendMode() { return true; },
    bkToken() { return 'token'; },
    bkBase() { return 'https://api.example'; },
    _calLiveAccount() { return 'test-account'; },
    _calLiveSessionEpoch() { return 0; },
    _calOwnerMatches() { return true; },
    _calResetForSession() {},
    uns(value) { return value; },
    handle401() {},
    fetch(url, init) {
      calls.push({ url: String(url), init: init || {} });
      if (/\/api\/appointments(?:\?|$)/.test(String(url))) {
        assert(queue.length, 'unexpected appointments fetch');
        const next = queue.shift();
        if (next instanceof Error) return Promise.reject(next);
        return Promise.resolve(next);
      }
      if (/\/api\/providers(?:\?|$)/.test(String(url))) return Promise.resolve(response(200, { providers: [] }));
      return Promise.reject(new Error('unexpected fetch ' + url));
    },
    renderCalendar() { context.__renders += 1; },
    renderCalCheckin() { context.__checkinRenders += 1; }
  };
  context.window = context;
  context.__mlsCalendarMutationEpoch = 7;
  vm.createContext(context);
  const loadSource = extractFunction(app, 'async function loadCalendar(', 'base loadCalendar');
  vm.runInContext(`
    var _calYear=2026, _calMonth=6, _calAppts=${JSON.stringify(seedRows)}, _calMe={}, _calProviders=[];
    function _calInit(){}
    function _calPad(n){ return (n<10?'0':'')+n; }
    ${loadSource}
    window.__calendarRows=function(){ return _calAppts; };
  `, context, { filename: 'ScribeFlow-loadCalendar-runtime.js' });
  return { context, calls, load: context.loadCalendar, rows: () => Array.from(context.__calendarRows()) };
}

async function testCalendarAuthoritativeBoundary() {
  const old = [{ id: 'old', appt_date: '2026-07-18' }];
  const fresh = [{ id: 'fresh', appt_date: '2026-07-19' }];

  let h = makeCalendarHarness(old, [response(200, { appointments: fresh, me: { id: 'me' } })]);
  let result = await h.load();
  assertLoadResult(result, 'valid calendar response');
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.authoritative, true);
  assert.strictEqual(result.count, 1);
  assert.strictEqual(result.error, '');
  assert.strictEqual(result.discarded, '');
  assert.deepStrictEqual(h.rows().map(row => row.id), ['fresh']);
  const appointmentCall = h.calls.find(call => /\/api\/appointments(?:\?|$)/.test(call.url));
  assert(appointmentCall && appointmentCall.init.cache === 'no-store', 'live appointments read did not use cache:no-store');

  h = makeCalendarHarness(old, [response(200, { appointments: [] })]);
  result = await h.load();
  assertLoadResult(result, 'authoritative empty calendar response');
  assert.strictEqual(result.applied, true, 'validated empty response was not applied');
  assert.strictEqual(result.authoritative, true, 'validated empty response lost authoritative status');
  assert.strictEqual(result.count, 0);
  assert.deepStrictEqual(h.rows(), [], 'validated empty response did not clear old rows');

  const failures = [
    ['network failure', new Error('offline')],
    ['parse failure', response(200, null, 'bad json')],
    ['invalid payload', response(200, { appointments: 'not-an-array' })],
    ['non-200 response', response(201, { appointments: fresh })]
  ];
  for (const [label, reply] of failures) {
    h = makeCalendarHarness(old, [reply]);
    result = await h.load();
    assertLoadResult(result, label);
    assert.strictEqual(result.applied, false, label + ' was applied');
    assert.strictEqual(result.authoritative, false, label + ' was called authoritative');
    assert(result.error, label + ' did not report an error');
    assert.deepStrictEqual(h.rows().map(row => row.id), ['old'], label + ' erased/replaced current rows');
  }
}

async function testCalendarFreshnessGuards() {
  const old = [{ id: 'old', appt_date: '2026-07-18' }];
  const stale = [{ id: 'stale', appt_date: '2026-07-17' }];
  const fresh = [{ id: 'fresh', appt_date: '2026-07-19' }];

  let pending = deferred();
  let h = makeCalendarHarness(old, [pending.promise]);
  const epochLoad = h.load();
  h.context.__mlsCalendarMutationEpoch += 1;
  pending.resolve(response(200, { appointments: stale }));
  let result = await epochLoad;
  assertLoadResult(result, 'mutation-superseded calendar response');
  assert.strictEqual(result.applied, false);
  assert.strictEqual(result.authoritative, false);
  assert.strictEqual(result.discarded, 'mutation_superseded');
  assert.deepStrictEqual(h.rows().map(row => row.id), ['old'], 'pre-mutation response overwrote current rows');

  pending = deferred();
  h = makeCalendarHarness(old, [pending.promise, response(200, { appointments: fresh })]);
  const first = h.load();
  const second = h.load();
  const secondResult = await second;
  pending.resolve(response(200, { appointments: stale }));
  const firstResult = await first;
  assertLoadResult(secondResult, 'newest calendar response');
  assert.strictEqual(secondResult.applied, true);
  assertLoadResult(firstResult, 'superseded calendar response');
  assert.strictEqual(firstResult.applied, false);
  assert.strictEqual(firstResult.discarded, 'superseded');
  assert.deepStrictEqual(h.rows().map(row => row.id), ['fresh'], 'older overlapping response beat the newest load');
}

async function testT6AppointmentFreshnessRuntime() {
  const calls = [];
  const context = {
    Promise,
    Date,
    console,
    __mlsT6Stab: { reverted: false, fetch: { pass: 0, ttlHits: 0, coalesced: 0 } },
    fetch(input, init) {
      const url = typeof input === 'string' ? input : input.url;
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      calls.push({ url, method });
      return Promise.resolve(response(String(url).includes('fail=1') ? 500 : 200, {}));
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`(function(){ var ST=window.__mlsT6Stab; ${t6Fetch} })();`, context, { filename: 'mls-connect-T6-fetch-runtime.js' });

  await Promise.all([
    context.fetch('/api/appointments', { method: 'GET' }),
    context.fetch('/api/appointments', { method: 'GET' })
  ]);
  assert.strictEqual(calls.filter(call => call.url === '/api/appointments').length, 2,
    'T6 coalesced freshness-sensitive appointments reads');

  await Promise.all([
    context.fetch('/api/providers', { method: 'GET' }),
    context.fetch('/api/providers', { method: 'GET' })
  ]);
  assert.strictEqual(calls.filter(call => call.url === '/api/providers').length, 1,
    'T6 no longer coalesces harmless provider polling');

  const writes = [
    ['/api/appointments', 'POST'],
    ['/api/appointments/42', 'PUT'],
    ['/api/appointments/42', 'PATCH'],
    ['/api/appointments/42', 'DELETE'],
    ['/api/emr-sync/schedule', 'POST']
  ];
  for (const [url, method] of writes) await context.fetch(url, { method });
  assert.strictEqual(context.__mlsCalendarMutationEpoch, writes.length,
    'successful appointment/schedule writes did not each advance the mutation epoch');
  await context.fetch('/api/appointments/42?fail=1', { method: 'DELETE' });
  assert.strictEqual(context.__mlsCalendarMutationEpoch, writes.length,
    'failed appointment write advanced the mutation epoch');
  await context.fetch('/api/emr-sync/schedule', { method: 'PUT' });
  assert.strictEqual(context.__mlsCalendarMutationEpoch, writes.length,
    'non-POST schedule request advanced the calendar mutation epoch');
  await context.fetch('/api/providers', { method: 'POST' });
  assert.strictEqual(context.__mlsCalendarMutationEpoch, writes.length,
    'unrelated successful write advanced the calendar mutation epoch');
}

async function main() {
  await testCalendarAuthoritativeBoundary();
  await testCalendarFreshnessGuards();
  await testT6AppointmentFreshnessRuntime();
  console.log('PASS pull-request correlation contract: correlated pulls, authoritative epoch-guarded no-store calendar reads, mutation invalidation, stable wrapper ownership, lease exclusion, bounded parse, rl-2.0.0 sync');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

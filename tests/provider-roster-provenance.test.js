'use strict';

/* Blocker 4.1 (2026-07-15): batch-bound provider/roster receipt provenance.
 * The roster receipt attached to a pull must carry the exact batch context —
 * targetDate, the frozen schedule requestId, providerMode, and the exact
 * requested provider identity — and must carry it ONLY when the ingested
 * schedule reply proves it belongs to that exact request. Hostile vectors:
 * stale, mismatched, missing, replayed, expired, and weakly typed provenance
 * all yield EMPTY provenance so batch-binding gates fail closed. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const rosterSrc = fs.readFileSync(path.join(root, 'feat_athena_provider_roster.js'), 'utf8');
const siSrc = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const backgroundSrc = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

/* ---- source-level invariants (extension emits provenance at the source) ---- */
assert(backgroundSrc.includes("requestId: __schedRequestId, complete: !!__complete"),
  'extension schedule receipt must be stamped with the frozen request id');
assert(backgroundSrc.includes("{ requestId: __schedRequestId, targetDate: (pick && pick.s && pick.s.schedDate) || '' }"),
  'extension provider-roster receipt must be stamped with request id and served date');
assert(backgroundSrc.includes("expectedCount:(_declProvS&&_provObservedS===_declProvS)?_declProvS:null"),
  'a weak text-declared provider count may only corroborate an exactly matching observed sweep, never masquerade as the expected total (live 2026-07-15: body text "1 provider" vs 2 proven headers failed every pull)');
assert(backgroundSrc.includes("if (!__providerRoster.length) (__mlsM.providers || []).forEach(__addProviderRosterEntry);"),
  'merged display-string providers may only backfill the roster when the picked lane supplied no structured entries (live 2026-07-15: a comma-variant echo of the same clinician contradicted the sweep receipt count)');
assert(siSrc.includes('schedule-request-unbound'), 'importer must fail closed on an unbound schedule receipt');
assert(siSrc.includes('provider-roster-unbound'), 'importer must fail closed on an unbound roster receipt');
assert(siSrc.includes('roster.beginOperation') || siSrc.includes('beginOperation(rosterOperation)'),
  'importer must arm the batch operation before the schedule read');

/* ---- roster module runtime ---- */
function rosterContext() {
  const installToken = 'provider-provenance-owned-roster';
  const store = new Map();
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const document = {
    readyState: 'complete',
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    currentScript: {
      getAttribute(name) {
        if (name === 'data-mls-install-token') return installToken;
        if (name === 'data-mls-asset') return 'feat_athena_provider_roster.js';
        return null;
      }
    }
  };
  const window = {
    _calProviders: [],
    __MLS_MAIN: { enabled: true },
    __mlsP1ProviderRosterLoader: {
      installed: true, version: 'p1-provider-roster-1.0.0', installToken
    },
    __mlsSessionAccount: 'provider-provenance@example.test',
    __mlsSessionEpoch: 1,
    bkToken: () => 'provider-provenance-session-token',
    uns: n => `provenance-test::${n}`,
    addEventListener: () => {}, removeEventListener: () => {},
    document, localStorage
  };
  window.window = window;
  return vm.createContext({
    window, document, localStorage,
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: () => 1, clearTimeout: () => {},
    console, Date
  });
}

function freshRoster() {
  const ctx = rosterContext();
  vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
  const api = ctx.window.__mlsProviderRoster;
  assert(api && api.version === 'p1-provider-roster-1.0.0',
    'the promoted provider roster did not install under its exact controller/session owner');
  assert.strictEqual(api.installToken, ctx.window.__mlsP1ProviderRosterLoader.installToken,
    'the provider roster API is not bound to the exact loader token');
  return api;
}

const PROVENANCE_KEYS = ['targetDate', 'requestId', 'providerMode', 'requestedProviderId', 'requestedProviderStableKey'];
const completeSweep = () => ({
  complete: true, partial: false, reason: 'complete',
  expectedCount: 2, observedCount: 2, reachedEnd: true, capReached: false,
  budgetExpired: false, restored: true, boundsStable: true, steps: 3
});
const twoProviders = () => ([
  { stableKey: 'athena-id:7', id: '7', raw: 'Schaeffer_Matthew_MD', name: 'Matthew Schaeffer, MD' },
  { stableKey: 'athena-id:8', id: '8', raw: 'Hoynak_Jonathon_MD', name: 'Jonathon Hoynak, MD' }
]);
function reply(requestId, extra) {
  return Object.assign({
    ok: true, requestId, id: requestId,
    providerRoster: twoProviders(),
    providerRosterReceipt: Object.assign(completeSweep(), { requestId, targetDate: '2026-07-15' })
  }, extra || {});
}

/* 1. Happy path: armed operation + matching reply -> full provenance. */
{
  const api = freshRoster();
  const armed = api.beginOperation({
    targetDate: '2026-07-15', requestId: 'mlssi-sched-abc123',
    providerMode: 'selected', requestedProviderId: '7', requestedProviderStableKey: 'athena-id:7'
  });
  assert(armed && armed.requestId === 'mlssi-sched-abc123', 'valid operation must arm');
  api.ingestResp(reply('mlssi-sched-abc123'));
  const receipt = api.getReceipt();
  assert.strictEqual(receipt.complete, true, 'clean exact sweep stays complete');
  assert.strictEqual(receipt.targetDate, '2026-07-15');
  assert.strictEqual(receipt.requestId, 'mlssi-sched-abc123');
  assert.strictEqual(receipt.providerMode, 'selected');
  assert.strictEqual(receipt.requestedProviderId, '7');
  assert.strictEqual(receipt.requestedProviderStableKey, 'athena-id:7');
}

/* 2. All-provider mode carries empty requested identity, never a leftover. */
{
  const api = freshRoster();
  assert(api.beginOperation({ targetDate: '2026-07-15', requestId: 'rq-all-1', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' }));
  api.ingestResp(reply('rq-all-1'));
  const receipt = api.getReceipt();
  assert.strictEqual(receipt.providerMode, 'all');
  assert.strictEqual(receipt.requestedProviderId, '');
  assert.strictEqual(receipt.requestedProviderStableKey, '');
}

/* 2b. Live 2026-07-15 regression: a punctuation echo of the SAME clinician on
   two string-derived athena:* keys is one person, not two. It must collapse
   (with aliases preserved) instead of contradicting the sweep receipt count,
   while distinct real backend ids keep same-name clinicians separately
   routable. */
{
  const api = freshRoster();
  api.beginOperation({ targetDate: '2026-07-15', requestId: 'rq-echo', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' });
  api.ingestResp({
    ok: true, requestId: 'rq-echo', id: 'rq-echo',
    providerRoster: [
      { stableKey: 'athena:matthew schaeffer md', raw: 'Matthew Schaeffer MD', name: 'Matthew Schaeffer, MD', source: 'athena-schedule-header' },
      { stableKey: 'athena:matthew schaeffer, md', raw: 'Matthew Schaeffer, MD', name: 'Matthew Schaeffer, MD', source: 'athena-schedule-header' }
    ],
    providerRosterReceipt: Object.assign(completeSweep(), { expectedCount: 1, observedCount: 1, requestId: 'rq-echo', targetDate: '2026-07-15' })
  });
  const entries = api.list().filter(e => /matthew/i.test(e.name || ''));
  assert.strictEqual(entries.length, 1, 'a comma-variant string echo must collapse into ONE clinician entry');
  const resolved = api.resolve('athena:matthew schaeffer, md');
  assert(resolved && resolved.stableKey === entries[0].stableKey, 'the dropped echo key must still resolve to the surviving clinician via aliases');
  const receipt = api.getReceipt();
  assert.strictEqual(receipt.complete, true, 'a clean single-provider sweep with a collapsed echo must stay complete');
  assert.strictEqual(receipt.requestId, 'rq-echo', 'the collapsed-echo receipt must stay batch-bound');
}
{
  const api = freshRoster();
  api.beginOperation({ targetDate: '2026-07-15', requestId: 'rq-two-real', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' });
  api.ingestResp({
    ok: true, requestId: 'rq-two-real', id: 'rq-two-real',
    providerRoster: [
      { stableKey: 'backend:7', id: '7', raw: 'Same_Alex_MD', name: 'Alex Same, MD', source: 'athena-schedule-header' },
      { stableKey: 'backend:8', id: '8', raw: 'Same_Alex_MD', name: 'Alex Same, MD', source: 'athena-schedule-header' }
    ],
    providerRosterReceipt: Object.assign(completeSweep(), { expectedCount: 2, observedCount: 2, requestId: 'rq-two-real', targetDate: '2026-07-15' })
  });
  const entries = api.list().filter(e => /alex same/i.test(e.name || ''));
  assert.strictEqual(entries.length, 2, 'two REAL same-name clinicians with distinct backend ids must both survive');
}

/* 3. Weakly typed / contradictory operations refuse to arm. */
{
  const api = freshRoster();
  const rejected = [
    null, undefined, 'string-op', 42,
    { targetDate: 20260715, requestId: 'rq', providerMode: 'selected', requestedProviderId: '7' },       /* number date */
    { targetDate: '2026-07-15', requestId: 12345, providerMode: 'selected', requestedProviderId: '7' },  /* number id */
    { targetDate: '2026-07-15', requestId: 'rq', providerMode: 'SELECTED-ISH', requestedProviderId: '7' },
    { targetDate: '2026-07-15', requestId: 'rq', providerMode: 'all', requestedProviderId: '7', requestedProviderStableKey: '' }, /* all + id */
    { targetDate: '2026-07-15', requestId: 'rq', providerMode: 'selected', requestedProviderId: '', requestedProviderStableKey: '' }, /* selected w/o identity */
    { targetDate: 'July 15 2026', requestId: 'rq', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' },   /* non-ISO date */
    { targetDate: '2026-07-15', requestId: '', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' },       /* blank request */
    { targetDate: '2026-07-15', requestId: { toString: () => 'rq' }, providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' } /* object id */
  ];
  for (const op of rejected) assert.strictEqual(api.beginOperation(op), null, 'weakly typed operation must not arm: ' + JSON.stringify(op));
  api.ingestResp(reply('rq'));
  const receipt = api.getReceipt();
  for (const key of PROVENANCE_KEYS) assert.strictEqual(String(receipt[key] || ''), '', `unarmed ingest must leave ${key} empty`);
}

/* 4. Mismatched reply requestId -> provenance stays empty (stale/replayed reply). */
{
  const api = freshRoster();
  api.beginOperation({ targetDate: '2026-07-15', requestId: 'rq-current', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' });
  api.ingestResp(reply('rq-OLD'));
  const receipt = api.getReceipt();
  for (const key of PROVENANCE_KEYS) assert.strictEqual(String(receipt[key] || ''), '', `mismatched reply must leave ${key} empty`);
}

/* 5. Extension receipt claiming a different requestId than its own reply is
      replayed evidence: completeness is voided outright. */
{
  const api = freshRoster();
  api.beginOperation({ targetDate: '2026-07-15', requestId: 'rq-now', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' });
  const hostile = reply('rq-now');
  hostile.providerRosterReceipt.requestId = 'rq-yesterday';
  api.ingestResp(hostile);
  const receipt = api.getReceipt();
  assert.strictEqual(receipt.complete, false, 'request-echo conflict must void completeness');
  assert.strictEqual(receipt.reason, 'provider-roster-request-mismatch');
  assert.strictEqual(receipt.requestId, 'rq-now',
    'the refusal receipt must stay bound to the current armed batch, not the hostile nested request id');
  assert.notStrictEqual(receipt.requestId, hostile.providerRosterReceipt.requestId,
    'the hostile nested request id crossed into the refusal receipt');
}

/* 6. A later unbound ingest is ignored — it can neither replace nor clear the
      current exact receipt. The last accepted batch remains the only evidence. */
{
  const api = freshRoster();
  api.beginOperation({ targetDate: '2026-07-15', requestId: 'rq-a', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' });
  api.ingestResp(reply('rq-a'));
  assert.strictEqual(api.getReceipt().requestId, 'rq-a');
  const ignored = api.ingestResp(reply('rq-b'));  /* stray/probe reply, not armed */
  assert.deepStrictEqual(Object.assign({}, ignored), { ignored: true, reason: 'unbound-or-stale-response' },
    'the stray response was not explicitly refused at the ingestion choke point');
  const receipt = api.getReceipt();
  assert.strictEqual(receipt.requestId, 'rq-a', 'a stray response displaced the last accepted exact receipt');
  assert.strictEqual(receipt.targetDate, '2026-07-15');
  assert.strictEqual(receipt.providerMode, 'all');
}

/* 7. Operation TTL: an armed batch context expires rather than binding forever. */
{
  const ctx = rosterContext();
  let now = 1_800_000_000_000;
  const FakeDate = function (...args) { return args.length ? new Date(...args) : new Date(now); };
  FakeDate.now = () => now;
  ctx.Date = FakeDate;
  vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
  const api = ctx.window.__mlsProviderRoster;
  api.beginOperation({ targetDate: '2026-07-15', requestId: 'rq-ttl', providerMode: 'all', requestedProviderId: '', requestedProviderStableKey: '' });
  now += 11 * 60 * 1000; /* > 10 min */
  api.ingestResp(reply('rq-ttl'));
  const receipt = api.getReceipt();
  for (const key of PROVENANCE_KEYS) assert.strictEqual(String(receipt[key] || ''), '', `expired operation must leave ${key} empty`);
}

/* ---- importer runtime: unbound receipts block the pull ---- */
async function runImporterPull({ scheduleReceiptRequestId, rosterEcho, wrongRosterScope }) {
  const listeners = new Set();
  const store = new Map();
  const statuses = [];
  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
    encodeURIComponent, decodeURIComponent, queueMicrotask,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    location: { pathname: '/ScribeFlow-staging.html' },
    localStorage: {
      getItem: k => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    document: {
      readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
      getElementById: () => null, addEventListener: () => {}, removeEventListener: () => {},
      body: {}, head: { appendChild: () => {} }, documentElement: { appendChild: () => {} }
    },
    backendMode: () => true, bkToken: () => 'test-token', bkBase: () => 'https://local.invalid',
    uns: k => `roster-unbound-test::${k}`,
    _normDate: v => String(v || '').slice(0, 10),
    _calAppts: [],
    dispatchEvent: () => {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ appointments: [] }) })
  };
  rt.window = rt;
  let armed = null;
  rt.__mlsProviderRoster = {
    list: () => [],
    resolve: () => null,
    beginOperation: op => { armed = Object.assign({}, op); return armed; },
    ingestResp: () => {},
    getReceipt: () => {
      const base = { complete: true, partial: false, reason: 'complete', observedCount: 1 };
      if (rosterEcho && armed) {
        Object.assign(base, {
          targetDate: armed.targetDate,
          requestId: wrongRosterScope ? 'rq-other-batch' : armed.requestId,
          providerMode: armed.providerMode,
          requestedProviderId: armed.requestedProviderId,
          requestedProviderStableKey: armed.requestedProviderStableKey
        });
      }
      return base;
    }
  };
  rt.addEventListener = (_t, fn) => listeners.add(fn);
  rt.removeEventListener = (_t, fn) => listeners.delete(fn);
  const emit = (type, resp, id) => {
    const event = { data: { source: 'mls-ext', type, id: id || '', resp } };
    Array.from(listeners).forEach(fn => fn(event));
  };
  rt.postMessage = msg => {
    if (msg.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true }, ''));
    if (msg.type === 'mlsAppGotoDate') queueMicrotask(() => emit('mlsAppGotoDateResult', { id: msg.id, ok: true, schedDate: '2026-07-15' }, msg.id));
    if (msg.type === 'mlsAppPullSchedule') queueMicrotask(() => emit('mlsAppScheduleResult', {
      id: msg.id, requestId: msg.requestId, ok: true, schedDate: '2026-07-15', text: 'Wednesday July 15 2026',
      receipt: {
        complete: true, authoritativeEmpty: false, parsedCount: 1, expectedCount: 1,
        requestId: scheduleReceiptRequestId === 'echo' ? (msg.requestId || msg.id) : scheduleReceiptRequestId
      },
      appts: [{ name: 'Some Patient', dob: '01/02/1960', date: '2026-07-15', time: '9:00 AM', provider: 'Schaeffer_Matthew_MD' }],
      providers: ['Matthew Schaeffer, MD']
    }, msg.id));
  };
  vm.runInNewContext(siSrc, rt, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
  return rt.__mlsSI.pull({ date: '2026-07-15', provider: 'all', includeHistory: false, pullVisitBodies: false, onStatus: (m, k) => statuses.push({ m, k }) });
}

(async () => {
  /* 8. Schedule receipt without the frozen requestId -> nothing imports. */
  let out = await runImporterPull({ scheduleReceiptRequestId: '', rosterEcho: true });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'schedule-request-unbound');
  assert.strictEqual(out.created, 0);

  /* 9. Schedule receipt bound to a DIFFERENT request -> nothing imports. */
  out = await runImporterPull({ scheduleReceiptRequestId: 'rq-some-other-pull', rosterEcho: true });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'schedule-request-unbound');

  /* 10. Complete roster receipt WITHOUT batch provenance -> roster-unbound. */
  out = await runImporterPull({ scheduleReceiptRequestId: 'echo', rosterEcho: false });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'provider-roster-unbound');

  /* 11. Complete roster receipt bound to ANOTHER batch -> roster-unbound. */
  out = await runImporterPull({ scheduleReceiptRequestId: 'echo', rosterEcho: true, wrongRosterScope: true });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'provider-roster-unbound');

  /* 12. Fully bound receipts -> the pull proceeds past both binding gates. */
  out = await runImporterPull({ scheduleReceiptRequestId: 'echo', rosterEcho: true });
  assert.notStrictEqual(out.reason, 'schedule-request-unbound');
  assert.notStrictEqual(out.reason, 'provider-roster-unbound');

  console.log('PASS batch-bound provider/roster receipt provenance: source stamps, armed-operation binding, hostile stale/mismatched/missing/weakly-typed vectors fail closed');
})().catch(err => { console.error(err); process.exit(1); });

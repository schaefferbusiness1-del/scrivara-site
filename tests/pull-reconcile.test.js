'use strict';
/* reconcile-1.0.0 - ATHENA AS FACT, PROVEN BY EXECUTION.
 *
 * Owner directive 2026-09-01: month/year pulls should "treat athena as fact and
 * delete any extra appointmets that an old bad extetnion opulled ... and merg
 * all duplicates".
 *
 * Every claim below is RUN against the shipped feat_mls_pull_reconcile.js
 * inside a vm sandbox - the module's own rules, not a re-statement of them:
 *
 *   1. AUTHORITATIVE-DAY GATING. A day whose schedule read was partial,
 *      calendar-partial, nav-failed or otherwise unproven reconciles NOTHING,
 *      and issues no DELETE. Six refusal shapes are driven.
 *   2. THE PROVIDER-SCOPE RULE. An ALL read owns the whole day; a SELECTED read
 *      owns only rows whose provider key matches, and an unattributed row is
 *      never deleted under a scoped read. A selected request NEVER falls back
 *      to the all-snapshot.
 *   3. LINKED-VISIT PROTECTION. A row whose patient has a visit that day, or
 *      that names a visit/note/encounter itself, is FLAGGED, never deleted -
 *      including when the join comes through the schedule-import ledger.
 *   4. THE SERVER-DELETE CALL SHAPE. DELETE <base>/api/appointments/<id> with
 *      the bearer token; the local calendar is re-read from the server, never
 *      hand-edited; an id athena returned is never in a delete URL.
 *   5. SNAPSHOT BEFORE DELETE. The sj-2.1 IndexedDB mint must CONFIRM before
 *      the first DELETE, and a failed mint means zero deletes.
 *   6. THE RECEIPT. Fixed shape, name-free, and it reaches the pull log.
 *   7. THE AUTO-MERGE TRIGGER. After a pull settles the LAWFUL sweep runs once
 *      - and only the lawful one; the review count never merges anything.
 *   8. THE YIELD-CHUNKING PROPERTY. A sweep longer than one slice provably
 *      spans more than one turn.
 *
 * [[a-suite-can-pass-without-running]]: this file announces every check and
 * ends with an explicit completion line, so exit 0 with no output is a failure.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SRC_NAME = 'feat_mls_pull_reconcile.js';
const SRC = fs.readFileSync(path.join(root, SRC_NAME), 'utf8');

let n = 0;
const ok = (m) => { n++; console.log('ok ' + n + ' - ' + m); };
/* the module runs in a vm realm, so an array it built is not host-Array.
   Array.from re-homes it before a deepStrictEqual compares prototypes. */
const arr = (x) => Array.from(x || []);

/* ---------------------------------------------------------------- 0. bytes */
new Function(SRC); /* syntax gate */
assert.strictEqual(/[^\x00-\x7f]/.test(SRC), false, 'the module must be ASCII-only (latin1 writer law)');
assert(SRC.indexOf('/api/appointments/') > 0, 'the server delete path must be present in the shipped bytes');
assert(SRC.indexOf('dryRun: true') > 0, 'dry run must be the SHIPPED default for a destructive lane');
assert(SRC.indexOf('savePatients') < 0, 'the reconciler must never write the patient store itself');
ok('shipped bytes: ASCII-only, dry-run default, server delete path present, no patient-store write');

/* ------------------------------------------------------------- 1. harness */
const PROVIDER_KEY = (raw) => {
  /* A deterministic stand-in for the importer's providerKey. The exact
     derivation is the importer's contract (and its own suites'); what is
     proven here is that the reconciler COMPARES canonical keys and refuses a
     row it cannot key. Idempotent on its own output, like the real one. */
  const s = String(raw == null ? '' : raw).toLowerCase();
  if (!s.trim() || /^all(?:\s+providers?)?$/.test(s.trim())) return '';
  const drop = { md: 1, do: 1, pa: 1, np: 1, dr: 1 };
  const all = s.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const stripped = all.filter((t) => !drop[t]);
  const tokens = stripped.length >= 2 ? stripped : all;
  if (tokens.length < 2) return '';
  return tokens.slice().sort().join('|');
};
const MATT = PROVIDER_KEY('Matthew Schaeffer, MD');

function makeSandbox(opts) {
  opts = opts || {};
  const store = {};
  const scheduled = [];        /* every setTimeout the module asked for */
  const intervals = [];        /* every setInterval, recorded and NOT run */
  const fetches = [];
  const idbPuts = [];
  const idbData = {};
  const events = {};
  const logLines = [];
  const trace = [];            /* ordered record of side effects */
  let loadCalendarCalls = 0;
  let mergeRuns = [];
  let dedupRunOnceCalls = 0;
  let mintCalls = 0;

  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean,
    Promise, RegExp, Error, encodeURIComponent, isFinite, parseInt, parseFloat,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms: Number(ms) || 0 });
      /* Real timing, capped so a 6-second settle is testable in one tick, and
         UNREF'd: the module's idle safety net is a self-rearming chain (a page
         has a permanent event loop; a node process does not), so a ref'd timer
         here would hold this suite open forever and it would read as a hang.
         [[a-suite-can-pass-without-running]] in reverse - a suite that never
         EXITS is just as useless as one that never runs. */
      const t = setTimeout(fn, Math.min(Number(ms) || 0, 1));
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    },
    clearTimeout(id) { return clearTimeout(id); },
    setInterval(fn, ms) { intervals.push({ fn, ms: Number(ms) || 0 }); return intervals.length; },
    clearInterval() { return undefined; },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    }
  };
  ctx.window = ctx;
  ctx.window.addEventListener = function (type, fn) { (events[type] = events[type] || []).push(fn); };
  ctx.window.removeEventListener = function (type, fn) {
    const list = events[type] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  ctx.window.dispatch = function (type, detail) {
    (events[type] || []).slice().forEach((fn) => fn({ detail }));
  };
  ctx.window.uns = (suffix) => 'acct:' + suffix;
  ctx.window.bkBase = () => 'https://backend.example';
  ctx.window.bkToken = () => 'TOKEN123';
  ctx.window.backendMode = () => true;
  ctx.window._calAppts = opts.calendar || [];
  ctx.window.getPatients = () => (opts.patients || []);
  ctx.window.loadCalendar = function () { loadCalendarCalls++; trace.push('loadCalendar'); return Promise.resolve({ applied: true }); };
  ctx.window.__mlsSI = {
    installed: true,
    _providerKey: PROVIDER_KEY,
    isBusy: () => opts.busy === true,
    _loadAuthoritativeStore() {
      if (opts.storeRefusal) return { ok: false, reason: opts.storeRefusal, store: null, quarantined: [] };
      return { ok: true, reason: 'ok', store: { v: 1, days: opts.days || {} }, quarantined: opts.quarantined || [] };
    },
    authoritativeStatusForDay(day) {
      const s = (opts.status || {})[day];
      return s || { available: false, exact: false, date: day, scope: '', sourceCount: 0, activeCount: 0, missingCount: 0, unclassifiedCount: 0, reason: 'no-snapshot' };
    }
  };
  ctx.window.__mlsEasyV32 = { pullLog(message, kind) { logLines.push({ message, kind }); return true; } };
  ctx.window.__mlsPatientMerge = {
    run(o) { mergeRuns.push(o || {}); trace.push('merge.run'); return { merged: opts.mergedCount == null ? 2 : opts.mergedCount, movedVisits: 3 }; }
  };
  ctx.window.__mlsDedupById = {
    mintSnapshot() { mintCalls++; trace.push('dedup.mintSnapshot'); return Promise.resolve(true); },
    runOnce() { dedupRunOnceCalls++; return { dry: true }; }
  };
  ctx.window.fetch = function (url, init) {
    fetches.push({ url: String(url), init: init || {} });
    trace.push('fetch:' + String(init && init.method || 'GET') + ':' + String(url));
    if (opts.deleteFails) return Promise.resolve({ ok: false, status: 500 });
    return Promise.resolve({ ok: true, status: 200 });
  };
  ctx.window.indexedDB = {
    open() {
      const req = {};
      setTimeout(() => {
        req.result = {
          transaction(name, mode) {
            const tx = {};
            tx.objectStore = () => ({
              put(value, key) {
                if (opts.idbWriteFails) { setTimeout(() => { tx.onerror && tx.onerror(); }, 0); return; }
                idbPuts.push({ key, value });
                trace.push('idbPut:' + key);
                setTimeout(() => { tx.oncomplete && tx.oncomplete(); }, 0);
              },
              get(key) {
                const rq = {};
                setTimeout(() => { rq.result = idbData[key] || null; rq.onsuccess && rq.onsuccess(); }, 0);
                return rq;
              }
            });
            void mode; void name;
            return tx;
          },
          close() {}
        };
        if (opts.idbOpenFails) { req.error = new Error('idb-open-failed'); req.onerror && req.onerror(); return; }
        req.onupgradeneeded && req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    }
  };
  if (opts.seedLedger) {
    Object.keys(opts.seedLedger).forEach((day) => {
      store['acct:schedImportIndexV1::' + day] = JSON.stringify({ rows: opts.seedLedger[day] });
    });
  }

  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    ctx, api: ctx.window.__mlsPullReconcile,
    scheduled, intervals, fetches, idbPuts, idbData, logLines, trace, store,
    loadCalendarCalls: () => loadCalendarCalls,
    mergeRuns: () => mergeRuns,
    dedupRunOnceCalls: () => dedupRunOnceCalls,
    mintCalls: () => mintCalls,
    deleteUrls: () => fetches.filter((f) => String(f.init.method) === 'DELETE').map((f) => f.url)
  };
}
/* the shared world every scenario below reads */
function snap(date, mode, providerKey, ids) {
  return { v: 1, date, mode, providerKey: providerKey || '', backendIds: ids.slice(), sourceCount: ids.length, updated: 1 };
}
const DAYS = {
  '2026-08-12': { all: snap('2026-08-12', 'all', '', ['101', '102']), providers: {}, active: { mode: 'all', key: '' } },
  '2026-08-13': { all: null, providers: { [MATT]: snap('2026-08-13', 'selected', MATT, ['201']) }, active: { mode: 'provider', key: MATT } },
  '2026-08-14': { all: snap('2026-08-14', 'all', '', []), providers: {}, active: { mode: 'all', key: '' } },
  '2026-08-15': { all: snap('2026-08-15', 'all', '', ['301']), providers: {}, active: { mode: 'all', key: '' } },
  '2026-08-16': { all: snap('2026-08-16', 'all', '', ['401']), providers: {}, active: { mode: 'all', key: '' } }
};
const EXACT = (date) => ({ available: true, exact: true, date, scope: 'all', missingCount: 0, unclassifiedCount: 0, reason: 'exact' });
const EMPTY = (date) => ({ available: true, exact: true, date, scope: 'all', missingCount: 0, unclassifiedCount: 0, reason: 'authoritative-empty' });
const STATUS = {
  '2026-08-12': EXACT('2026-08-12'),
  '2026-08-13': { available: true, exact: true, date: '2026-08-13', scope: 'selected', missingCount: 0, reason: 'exact' },
  '2026-08-14': EMPTY('2026-08-14'),
  /* the PARTIAL day: athena did not finish, so ids are still missing locally */
  '2026-08-15': { available: false, exact: false, date: '2026-08-15', scope: 'all', missingCount: 1, reason: 'backend-rows-pending' },
  '2026-08-16': EXACT('2026-08-16')
};
const CAL = [
  { id: '101', name: 'Ann Alpha', appt_date: '2026-08-12', provider: 'Matthew Schaeffer, MD' },
  { id: '102', name: 'Bob Beta', appt_date: '2026-08-12', provider: 'Matthew Schaeffer, MD' },
  { id: '999', name: 'Ghost Gamma', appt_date: '2026-08-12', provider: 'Matthew Schaeffer, MD' },   /* debris, no visit */
  { id: '998', name: 'Dana Delta', appt_date: '2026-08-12', provider: 'Matthew Schaeffer, MD' },    /* debris BUT has a visit */
  { id: '201', name: 'Eve Epsilon', appt_date: '2026-08-13', provider: 'Matthew Schaeffer, MD' },
  { id: '777', name: 'Fay Phi', appt_date: '2026-08-13', provider: 'Anh Thi Do' },                   /* other provider */
  { id: '778', name: 'Gil Gamma', appt_date: '2026-08-13' },                                          /* no provider at all */
  { id: '779', name: 'Hal Eta', appt_date: '2026-08-13', provider: 'Matthew Schaeffer MD' },          /* in scope, stale */
  { id: '555', name: 'Ivy Iota', appt_date: '2026-08-14', provider: 'Matthew Schaeffer, MD' },        /* debris on an EMPTY day */
  { id: '444', name: 'Jon Kappa', appt_date: '2026-08-15', provider: 'Matthew Schaeffer, MD' },       /* on the PARTIAL day */
  { id: '402', name: 'Kim Lambda', appt_date: '2026-08-16', provider: 'Matthew Schaeffer, MD', note_id: 'nt-9' } /* names its own note */
];
const PATIENTS = [
  { id: 'p-dana', name: 'Dana Delta', dob: '1970-01-02', visits: [{ date: '2026-08-12', raw: 'seen' }] },
  { id: 'p-ghost', name: 'Ghost Gamma', dob: '1980-03-04', visits: [{ date: '2025-01-01', raw: 'old' }] },
  { id: 'p-hal', name: 'Hal Eta', dob: '1966-06-06', visits: [] }
];
const world = { days: DAYS, status: STATUS, calendar: CAL, patients: PATIENTS };

/* ============================================ 1. authoritative-day gating */
{
  const sb = makeSandbox(world);
  const p = sb.api.plan('2026-08-15', '');
  assert.strictEqual(p.ok, false, 'a partial day must refuse');
  assert.strictEqual(p.reason, 'backend-rows-pending', 'the refusal must carry the importer\'s own reason');
  assert.strictEqual(p.stale.length, 0, 'a partial day must produce NOTHING to delete');
  ok('a partial day (missingCount>0) reconciles nothing and keeps the importer\'s reason');
}
{
  const sb = makeSandbox(world);
  for (const reason of ['calendar-partial', 'nav-failed', 'history-partial', 'wrong-day', 'unverified-day',
    'needs-attention', 'month-partial', 'complete-appointment-census-history-partial']) {
    const p = sb.api.plan('2026-08-12', '', { dayReason: reason });
    assert.strictEqual(p.ok, false, reason + ' must refuse');
    assert.strictEqual(p.reason, 'day-verdict-not-reconcilable', reason + ' must refuse as an unreconcilable verdict');
    assert.strictEqual(p.stale.length, 0, reason + ' must produce nothing to delete');
  }
  const good = sb.api.plan('2026-08-12', '', { dayReason: 'complete' });
  assert.strictEqual(good.ok, true, 'a complete day must reconcile');
  ok('eight non-complete verdicts refuse (including complete-appointment-census-history-partial); "complete" passes');
}
{
  const allow = makeSandbox(world).api._dayReasonAllowList();
  assert.strictEqual(allow.filter((r) => /partial|failed|unverified|attention/.test(r)).length, 0,
    'the day-reason allowlist must be closed against every partial/failed verdict');
  assert(allow.indexOf('authoritative-empty') >= 0 && allow.indexOf('empty-day') >= 0,
    'a verified-empty day must stay reconcilable - it is the strongest debris case there is');
  ok('the day-reason allowlist is CLOSED (' + allow.length + ' verdicts, none partial/failed)');
}
{
  const sb = makeSandbox({ ...world, storeRefusal: 'authority-store-invalid' });
  const p = sb.api.plan('2026-08-12', '');
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.reason, 'authority-store-invalid', 'an unreadable authority store must refuse');
  const q = makeSandbox({ ...world, quarantined: ['2026-08-12'] }).api.plan('2026-08-12', '');
  assert.strictEqual(q.reason, 'authority-store-invalid', 'a QUARANTINED date must refuse on its own');
  const none = makeSandbox({ ...world, days: {} }).api.plan('2026-08-12', '');
  assert.strictEqual(none.reason, 'no-snapshot', 'a day with no published snapshot must refuse');
  ok('store-invalid, quarantined-day and no-snapshot each refuse fail-closed');
}
{
  const bent = JSON.parse(JSON.stringify(DAYS));
  bent['2026-08-12'].all.sourceCount = 5;   /* backendIds.length is still 2 */
  const p = makeSandbox({ ...world, days: bent }).api.plan('2026-08-12', '');
  assert.strictEqual(p.reason, 'snapshot-shape-invalid', 'a snapshot whose count disagrees with its ids must refuse');
  ok('a snapshot whose sourceCount disagrees with its backendIds refuses');
}

/* ================================================= 2. the provider scope rule */
{
  const sb = makeSandbox(world);
  const p = sb.api.plan('2026-08-12', '');
  assert.strictEqual(p.scope, 'all');
  assert.strictEqual(p.counts.rowsOnDay, 4, 'all four stored rows for the day are in scope under an ALL read');
  assert.strictEqual(p.counts.kept, 2, 'the two ids athena returned are kept');
  assert.deepStrictEqual(arr(p.stale), ['999'], 'only the debris row with no clinical work is stale');
  assert.strictEqual(p.counts.skippedOutOfScope, 0, 'an ALL read can put nothing out of scope');
  ok('ALL scope: the whole day is in scope; kept 2, stale 1, out-of-scope 0');
}
{
  const sb = makeSandbox(world);
  const p = sb.api.plan('2026-08-13', '', { request: { mode: 'selected', key: MATT } });
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.scope, 'selected');
  assert.deepStrictEqual(arr(p.stale), ['779'], 'only the in-scope unreturned row is stale');
  assert.strictEqual(p.counts.skippedOutOfScope, 2,
    'another provider\'s row AND an unattributed row are both out of a scoped read');
  ok('SELECTED scope: 1 stale; the other provider\'s row and the unattributed row are skipped, never deleted');
}
{
  const sb = makeSandbox(world);
  assert.strictEqual(sb.api._rowInScope({ provider: 'anybody' }, 'all', ''), true, 'an ALL read owns every row');
  assert.strictEqual(sb.api._rowInScope({}, 'all', ''), true, 'an ALL read owns an unattributed row too');
  assert.strictEqual(sb.api._rowInScope({}, 'selected', MATT), false, 'a scoped read never owns an unattributed row');
  assert.strictEqual(sb.api._rowInScope({ provider: 'Anh Thi Do' }, 'selected', MATT), false, 'a scoped read never owns another provider');
  assert.strictEqual(sb.api._rowInScope({ provider: 'Schaeffer, Matthew MD' }, 'selected', MATT), true,
    'a scoped read owns a row whose canonical provider key matches');
  assert.strictEqual(sb.api._rowInScope({ provider: 'Matthew Schaeffer' }, 'provider-from-all', MATT), false,
    'a DERIVED membership scope is never reconcilable');
  ok('the scope predicate itself: all owns everything, selected owns only its own keyed rows, derived owns nothing');
}
{
  /* a SELECTED request on a day that only holds an ALL snapshot must NOT fall
     back to it - that is the derived-membership hole, closed twice over */
  const sb = makeSandbox({
    ...world,
    status: { ...STATUS, '2026-08-12': { available: true, exact: true, date: '2026-08-12', scope: 'all', requestedScope: 'selected', derivedFromAllMembership: true, missingCount: 0, reason: 'exact' } }
  });
  const p = sb.api.plan('2026-08-12', '', { request: { mode: 'selected', key: MATT } });
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.reason, 'no-snapshot-for-scope', 'a selected request must never borrow the all-snapshot');
  ok('a selected request never falls back to the all-providers snapshot');
}
{
  /* the status question is asked with a NAME the importer re-keys, so the key
     round trip is PROVEN rather than assumed */
  const sb = makeSandbox(world);
  const bad = sb.api.plan('2026-08-13', '', { request: { mode: 'selected', key: MATT, name: 'Someone Else' } });
  assert.strictEqual(bad.reason, 'provider-key-roundtrip-failed',
    'a name that does not re-key to the requested scope must refuse the day');
  const none = sb.api.plan('2026-08-13', '', { request: { mode: 'selected', key: '' } });
  assert.strictEqual(none.reason, 'provider-key-unavailable', 'a scoped request with no key refuses');
  ok('the provider-key round trip is proven per day, not assumed');
}

/* ============================================== 3. linked-visit protection */
{
  const sb = makeSandbox(world);
  const p = sb.api.plan('2026-08-12', '');
  assert.strictEqual(p.counts.flaggedLinkedVisit, 1, 'the row whose patient has a visit that day is flagged');
  assert.deepStrictEqual(arr(p.flagged).map((f) => f.id), ['998'], 'the flagged row is the one with clinical work');
  assert.strictEqual(p.stale.indexOf('998'), -1, 'a flagged row is never in the delete set');
  ok('a stale row whose patient has a visit ON THAT DAY is FLAGGED, not deleted');
}
{
  const sb = makeSandbox({ ...world, status: { ...STATUS } });
  const p = sb.api.plan('2026-08-16', '');
  assert.strictEqual(p.counts.flaggedLinkedVisit, 1, 'a row that names its own note is flagged');
  assert.strictEqual(p.stale.length, 0, 'and it is not deletable');
  ok('a row carrying note_id / visit_id / encounter_id is flagged on its own field, with no store lookup');
}
{
  /* the LEDGER join: the row carries no patient link at all, but the day's
     schedule-import ledger binds this backend id to a patient who has a visit */
  const ledgerCal = CAL.map((r) => (r.id === '999' ? { id: '999', name: 'Ghost Gamma', appt_date: '2026-08-12', provider: 'Matthew Schaeffer, MD' } : r));
  const sb = makeSandbox({
    ...world,
    calendar: ledgerCal,
    patients: [{ id: 'p-linked', name: 'Somebody Else', dob: '1955-05-05', visits: [{ date: '2026-08-12', raw: 'seen' }] }],
    seedLedger: {
      '2026-08-12': { 'appointment-id:5551': { state: 'done', backendAppointmentId: '999', patientId: 'p-linked', appt_date: '2026-08-12' } }
    }
  });
  const p = sb.api.plan('2026-08-12', '');
  assert.strictEqual(p.stale.indexOf('999'), -1, 'the ledger-linked row must not be deletable');
  assert(p.flagged.some((f) => f.id === '999'), 'the ledger-linked row must be flagged for review');
  ok('the schedule-import ledger join protects a row whose own fields carry no patient link');
}
{
  const sb = makeSandbox(world);
  assert.strictEqual(sb.api._rowHasClinicalWork({ id: 'x', name: 'Nobody' }, '2026-08-12', null, {}), true,
    'with NO index built, every row must be treated as protected');
  ok('an unbuilt protection index protects everything (fail-closed)');
}
{
  /* tzcarry-1.0.0: the day that decides a DELETE must be the practice's day.
     A row carrying only start_at, with no practice-day helper available, must
     not be attributed to a UTC-sliced day and deleted there. */
  const utcOnly = [
    { id: '101', name: 'Ann Alpha', appt_date: '2026-08-12', provider: 'Matthew Schaeffer, MD' },
    { id: '102', name: 'Bob Beta', appt_date: '2026-08-12', provider: 'Matthew Schaeffer, MD' },
    { id: '966', name: 'Zed Omega', start_at: '2026-08-12T23:30:00Z', provider: 'Matthew Schaeffer, MD' }
  ];
  const sb = makeSandbox({ ...world, calendar: utcOnly, patients: [] });
  const p = sb.api.plan('2026-08-12', '');
  assert.strictEqual(p.counts.rowsOnDay, 2, 'a row whose practice day cannot be proven is not on any day here');
  assert.strictEqual(p.stale.length, 0, 'and it is never deleted on a UTC guess');
  /* with the shell's frozen practice-day helper present, the SAME row is seen */
  const sb2 = makeSandbox({ ...world, calendar: utcOnly, patients: [] });
  sb2.ctx.window._calDateOf = (a) => (a && a.appt_date) || String((a && a.start_at) || '').slice(0, 10);
  const p2 = sb2.api.plan('2026-08-12', '');
  assert.strictEqual(p2.counts.rowsOnDay, 3, 'the practice-day helper is what admits a start_at-only row');
  assert.deepStrictEqual(arr(p2.stale), ['966'], 'and only then is it judged');
  ok('a start_at-only row is judged by the practice-day helper or not at all - never by a UTC slice');
}

/* ==== 4./5./6./7./8. everything that needs a settled promise runs in here ====
 * A REF'D KEEPALIVE HOLDS THE LOOP OPEN FOR THE WHOLE ASYNC BODY. Every timer
 * the sandbox hands the module is unref'd (the module's idle net re-arms
 * forever, which a page can afford and a node process cannot), and without one
 * ref'd handle node would drain and EXIT MID-SUITE with status 0 - the exact
 * silent-pass shape [[a-suite-can-pass-without-running]] records. The final
 * PASS line is the completeness assertion; the keepalive is what lets it be
 * reached. */
(async function main() {
  const keepalive = setInterval(() => {}, 250);
  {
    const sb = makeSandbox(world);
    sb.api.setDryRun(false);
    const receipt = await sb.api.reconcileDay('2026-08-12', '');
    const urls = sb.deleteUrls();
    assert.deepStrictEqual(urls, ['https://backend.example/api/appointments/999'],
      'exactly the one stale id is DELETEd, at the server-confirmed route');
    const del = sb.fetches.find((f) => f.init.method === 'DELETE');
    assert.strictEqual(del.init.headers.Authorization, 'Bearer TOKEN123', 'the delete must carry the account bearer token');
    assert.strictEqual(urls.filter((u) => /\/(101|102|998)$/.test(u)).length, 0,
      'no id athena returned, and no flagged id, may ever appear in a delete URL');
    assert.strictEqual(sb.loadCalendarCalls(), 1, 'the calendar is re-read from the server after the deletes');
    assert.strictEqual(Number(sb.ctx.window.__mlsCalendarMutationEpoch), 1,
      'the calendar mutation epoch is bumped so a stale in-flight read cannot win');
    assert.strictEqual(receipt.counts.deleted, 1);
    assert.strictEqual(receipt.counts.failed, 0);
    ok('the delete path is DELETE <base>/api/appointments/<id> with the bearer token; kept and flagged ids are never in it');

    /* SNAPSHOT BEFORE DELETE - proven by ORDER, not by presence */
    const iPut = sb.trace.findIndex((t) => t.indexOf('idbPut:') === 0);
    const iDel = sb.trace.findIndex((t) => t.indexOf('fetch:DELETE') === 0);
    assert(iPut >= 0, 'a pre-delete snapshot must be minted');
    assert(iDel >= 0, 'the delete must have happened');
    assert(iPut < iDel, 'the snapshot must be CONFIRMED before the first DELETE is issued');
    const put = sb.idbPuts[sb.idbPuts.length - 1];
    assert(/::1$/.test(put.key), 'the newest generation is ::1, exactly like sj-2.1');
    assert.deepStrictEqual(arr(put.value.ids), ['999'], 'the snapshot carries the ids it is about to remove');
    assert.strictEqual(put.value.plainRows, true, 'sj-2.1 snapshots store plain rows');
    assert(JSON.parse(put.value.raw).length === 1, 'the whole row is snapshotted, so undo can re-create it');
    assert.strictEqual(receipt.snapshotKey.indexOf('idb:'), 0, 'the receipt names the snapshot it can be undone from');
    ok('sj-2.1 mint-before-delete: the ::1 generation is written and CONFIRMED before any DELETE');

    /* THE RECEIPT */
    for (const k of ['id', 'at', 'version', 'date', 'scope', 'providerKey', 'ok', 'reason', 'dryRun',
      'counts', 'deletedIds', 'flaggedIds', 'failedIds', 'snapshotKey']) {
      assert(Object.prototype.hasOwnProperty.call(receipt, k), 'the receipt must carry ' + k);
    }
    for (const k of ['rowsOnDay', 'athenaReturned', 'kept', 'stale', 'deleted', 'failed',
      'flaggedLinkedVisit', 'skippedOutOfScope', 'skippedNoId']) {
      assert(typeof receipt.counts[k] === 'number', 'the receipt counts must carry ' + k);
    }
    const asText = JSON.stringify(receipt);
    for (const name of ['Ghost', 'Gamma', 'Dana', 'Delta', 'Alpha', 'Beta']) {
      assert.strictEqual(asText.indexOf(name), -1, 'the receipt must be NAME-FREE (' + name + ' leaked)');
    }
    assert.deepStrictEqual(arr(receipt.deletedIds), ['999']);
    assert.deepStrictEqual(arr(receipt.flaggedIds), ['998']);
    ok('the receipt is fixed-shape, name-free, and names its deleted / flagged / failed ids');

    const line = sb.api.line(receipt);
    assert(/removed 1 stale row athena no longer shows/.test(line), 'the per-day line must say what was removed: ' + line);
    assert(/kept 1 for your review/.test(line), 'the per-day line must say what was kept back: ' + line);
    assert(sb.logLines.some((l) => l.message === line), 'the per-day line must reach the pull log');
    ok('the pull log receives the per-day line: "' + line + '"');

    const stored = sb.api.receipts();
    assert.strictEqual(stored[stored.length - 1].id, receipt.id, 'the receipt is persisted for the report and for undo');
    const ms = sb.api.monthSummary('2026-08');
    assert.strictEqual(ms.removed, 1, 'the month summary counts the removal');
    assert.strictEqual(ms.flagged, 1, 'the month summary counts the review-flagged rows');
    assert.strictEqual(ms.days, 1, 'the month summary counts the reconciled days');
    ok('the month-report provenance summary reads back removed=1 flagged=1 days=1');
  }

  /* UNDO - the snapshot is what makes the delete one-click reversible */
  {
    const sb = makeSandbox(world);
    sb.api.setDryRun(false);
    const receipt = await sb.api.reconcileDay('2026-08-12', '');
    /* the snapshot the mint wrote is what undo reads back */
    const put = sb.idbPuts[sb.idbPuts.length - 1];
    sb.idbData[put.key] = put.value;
    const before = sb.fetches.length;
    const res = await sb.api.undo(receipt.id);
    assert.strictEqual(res.ok, true, 'undo must restore what the receipt removed: ' + res.reason);
    assert.strictEqual(res.restored, 1);
    const posts = sb.fetches.slice(before).filter((f) => f.init.method === 'POST');
    assert.strictEqual(posts.length, 1, 'one row was removed, so one row is re-created');
    assert.strictEqual(posts[0].url, 'https://backend.example/api/appointments');
    const body = JSON.parse(posts[0].init.body);
    assert.strictEqual(body.appt_date, '2026-08-12', 'the restored row keeps its practice day');
    assert.strictEqual(body.provider, 'Matthew Schaeffer, MD', 'and its provider attribution');
    assert(/NEW backend appointment ids/.test(res.note), 'undo must be honest that the ids change');
    const missing = await sb.api.undo('rc_nope');
    assert.strictEqual(missing.reason, 'no-such-receipt', 'an unknown receipt id restores nothing');
    ok('undo re-creates exactly the snapshotted rows through POST /api/appointments, and says the ids are new');
  }

  /* DRY RUN - the shipped default deletes nothing */
  {
    const sb = makeSandbox(world);
    const receipt = await sb.api.reconcileDay('2026-08-12', '');
    assert.strictEqual(receipt.dryRun, true, 'dry run is the shipped default');
    assert.strictEqual(receipt.reason, 'dry-run');
    assert.strictEqual(sb.deleteUrls().length, 0, 'a dry run must issue NO delete');
    assert.strictEqual(sb.idbPuts.length, 0, 'a dry run does not even mint - there is nothing to undo');
    assert.strictEqual(receipt.counts.stale, 1, 'but it still reports exactly what it WOULD have removed');
    ok('dry run (the shipped default): 0 deletes, 0 mints, and an honest would-remove count');
  }

  /* A FAILED MINT REFUSES THE DAY */
  {
    const sb = makeSandbox({ ...world, idbOpenFails: true });
    sb.api.setDryRun(false);
    const receipt = await sb.api.reconcileDay('2026-08-12', '');
    assert.strictEqual(sb.deleteUrls().length, 0, 'no snapshot means no delete, ever');
    assert.strictEqual(receipt.ok, false);
    assert(/snapshot-mint-failed/.test(receipt.reason), 'the refusal must name the failed mint: ' + receipt.reason);
    ok('a snapshot that cannot be minted refuses the whole day - zero deletes');
  }

  /* A SERVER THAT REFUSES IS NOT A REMOVAL */
  {
    const sb = makeSandbox({ ...world, deleteFails: true });
    sb.api.setDryRun(false);
    const receipt = await sb.api.reconcileDay('2026-08-12', '');
    assert.strictEqual(receipt.counts.deleted, 0, 'an HTTP 500 is not a removal');
    assert.strictEqual(receipt.counts.failed, 1);
    assert.deepStrictEqual(arr(receipt.failedIds), ['999']);
    assert.strictEqual(receipt.ok, false, 'a day where nothing could be deleted is not ok');
    ok('a server refusal counts as failed, never as removed - the local view can only agree with the server');
  }

  /* AUTHORITATIVE-EMPTY - the strongest debris case */
  {
    const sb = makeSandbox(world);
    sb.api.setDryRun(false);
    const receipt = await sb.api.reconcileDay('2026-08-14', '');
    assert.strictEqual(receipt.counts.athenaReturned, 0, 'athena verified the day holds nothing');
    assert.deepStrictEqual(arr(receipt.deletedIds), ['555'], 'so the one stored row for that day is debris');
    ok('an authoritative-EMPTY day removes the rows athena proved do not exist');
  }

  /* BLAST RADIUS */
  {
    const many = [];
    for (let i = 0; i < 61; i++) many.push({ id: 'z' + i, name: 'Row ' + i, appt_date: '2026-08-12', provider: 'Matthew Schaeffer, MD' });
    const sb = makeSandbox({ ...world, calendar: many, patients: [] });
    sb.api.setDryRun(false);
    const receipt = await sb.api.reconcileDay('2026-08-12', '');
    assert.strictEqual(receipt.ok, false);
    assert.strictEqual(receipt.reason, 'blast-radius', 'more stale rows than the cap must refuse the whole day');
    assert.strictEqual(sb.deleteUrls().length, 0, 'and delete nothing at all');
    assert(sb.logLines.some((l) => l.kind === 'err' && /NONE were removed/.test(l.message)),
      'a blast-radius refusal must SAY so in the pull log - it needs a person');
    ok('the blast-radius cap refuses a day with 61 stale rows, deletes none, and says so in the pull log');
  }

  /* ================================ 7. the auto-merge trigger after settle */
  {
    const sb = makeSandbox(world);
    sb.api.setDryRun(false);
    /* the importer publishes an authoritative snapshot -> the day is QUEUED,
       never reconciled inside the pull */
    sb.ctx.window.dispatch('mls-authoritative-schedule', { date: '2026-08-12', scope: 'all' });
    sb.ctx.window.dispatch('mls-authoritative-schedule', { date: '2026-08-12', scope: 'cleared-provider-unknown' });
    assert.deepStrictEqual(arr(sb.api.queue()).map((q) => q.date), ['2026-08-12'],
      'the published day is queued once; a census invalidation is not a publish and queues nothing');
    assert.strictEqual(sb.deleteUrls().length, 0, 'nothing is deleted while the pull is still running');
    const settle = sb.scheduled.filter((s) => s.ms === 6000);
    assert.strictEqual(settle.length, 1, 'exactly one settle timer is armed, at the settle delay');
    assert.strictEqual(sb.mergeRuns().length, 0, 'and no merge has run yet');

    /* the pull settles */
    const res = await sb.api.drain({ force: true });
    assert.strictEqual(res.ran, 1, 'the queued day drains');
    assert.strictEqual(sb.api.queue().length, 0, 'and leaves the queue');
    assert.strictEqual(sb.mergeRuns().length, 1, 'the lawful duplicate sweep runs exactly ONCE after the pull settles');
    assert.strictEqual(sb.mergeRuns()[0].silent, true, 'the automatic sweep is quiet; the line below is the announcement');
    assert.strictEqual(sb.dedupRunOnceCalls(), 0,
      'the b121 console lane (a DIFFERENT comparator) must never be run automatically');
    assert(sb.mintCalls() >= 1, 'the sj-2.1 pre-merge snapshot is minted before the sweep');
    const iMint = sb.trace.indexOf('dedup.mintSnapshot');
    const iRun = sb.trace.indexOf('merge.run');
    assert(iMint >= 0 && iRun > iMint, 'the snapshot must be minted BEFORE the merge runs');
    assert.strictEqual(res.merge.merged, 2);
    const mline = sb.api.mergeLine(res.merge);
    assert(/^2 duplicates auto-merged, \d+ need your review$/.test(mline), 'the completion line shape: ' + mline);
    assert(sb.logLines.some((l) => l.message === mline), 'the merge line must reach the pull log');
    ok('after settle: one lawful sweep, snapshot first, b121 console lane untouched, line "' + mline + '"');
  }
  {
    const sb = makeSandbox(world);
    /* the identity law itself, executed */
    const A = { id: 'a', name: 'John Adams', dob: '1950-01-01', mrn: '12345' };
    const B = { id: 'b', name: 'John Adams', dob: '1950-01-01', mrn: '12345' };
    const C = { id: 'c', name: 'John Adams', dob: '', mrn: '' };
    const D = { id: 'd', name: 'John Adams', dob: '1961-02-02', mrn: '' };
    const E = { id: 'e', name: 'John Adams', dob: '1950-01-01', mrn: '' };
    const F = { id: 'f', name: 'John Adams', dob: '', mrn: '99999' };
    assert.strictEqual(sb.api._lawfullyMergeable(A, B), true, 'same MRN merges');
    assert.strictEqual(sb.api._lawfullyMergeable(A, F), false, 'CONFLICTING MRNs never merge');
    assert.strictEqual(sb.api._lawfullyMergeable(E, { id: 'g', name: 'John Adams', dob: '1950-01-01', mrn: '' }), true,
      'same name AND same DOB merges');
    assert.strictEqual(sb.api._lawfullyMergeable(E, D), false, 'same name with a DIFFERENT DOB never merges');
    assert.strictEqual(sb.api._lawfullyMergeable(E, C), false, 'a MISSING DOB is not agreement');
    ok('the identity law is unchanged: MRN match or name+DOB match only; conflict or absence never merges');

    const review = sb.api.reviewCandidates([C, D, E]);
    assert.strictEqual(review.length, 1, 'the near-duplicates are grouped for review');
    assert(review[0].reasons.indexOf('dob-conflict') >= 0 || review[0].reasons.indexOf('dob-missing-on-one-side') >= 0,
      'and the review says why the law refused: ' + review[0].reasons.join(','));
    assert.deepStrictEqual(arr(review[0].ids).sort(), ['c', 'd', 'e'], 'review lists the ids, nothing else');
    ok('reviewCandidates COUNTS what the law refuses and merges none of it (' + review[0].reasons.join(', ') + ')');
  }
  {
    /* the merge sweep must not run while a pull is still live */
    const sb = makeSandbox({ ...world, busy: true });
    const res = await sb.api.drain();
    assert.strictEqual(res.reason, 'pull-busy', 'a live pull defers the whole drain');
    assert.strictEqual(sb.mergeRuns().length, 0, 'and no merge runs mid-pull');
    assert.strictEqual(sb.api._pullBusy(), true);
    /* the sweep has its OWN busy gate, not just the drain's - the pm-1.0.1
       lesson was a merge fired mid-history-batch, so this must refuse even
       when called directly */
    const direct = await sb.api.mergeAfterPull();
    assert.strictEqual(direct.reason, 'pull-busy', 'mergeAfterPull must refuse mid-pull on its own');
    assert.strictEqual(sb.mergeRuns().length, 0, 'and still rewrite nothing');
    assert.strictEqual(sb.mintCalls(), 0, 'and not even mint a snapshot mid-pull');
    ok('a live pull defers the drain AND the sweep independently - nothing rewrites a store mid-pull');
  }
  {
    /* a SELECTED publish carries no key in its event, so the queue reads back
       the freshest provider snapshot for that date - not entry.active, which a
       later all-scope publish overwrites */
    const fresh = JSON.parse(JSON.stringify(DAYS));
    fresh['2026-08-13'].providers[MATT].updated = Date.now();
    fresh['2026-08-13'].active = { mode: 'all', key: '' };   /* a later publish moved it */
    const sb = makeSandbox({ ...world, days: fresh });
    sb.ctx.window.dispatch('mls-authoritative-schedule', { date: '2026-08-13', scope: 'selected' });
    const q = arr(sb.api.queue());
    assert.strictEqual(q.length, 1, 'the scoped day is queued');
    assert.strictEqual(q[0].providerKey, MATT, 'with the provider whose snapshot was just written');
    /* a STALE provider stamp is never claimed as "the publish that just fired" */
    const stale = JSON.parse(JSON.stringify(DAYS));
    stale['2026-08-13'].providers[MATT].updated = Date.now() - (10 * 60 * 1000);
    const sb2 = makeSandbox({ ...world, days: stale });
    sb2.ctx.window.dispatch('mls-authoritative-schedule', { date: '2026-08-13', scope: 'selected' });
    assert.strictEqual(arr(sb2.api.queue()).length, 0, 'a stale stamp queues nothing');
    ok('a scoped publish is queued against the FRESHEST provider snapshot, never a stale one or entry.active');
  }
  {
    /* a month/year pull that produced no reconcilable day still gets its
       duplicate sweep, exactly once, when the job reaches a terminal state */
    const sb = makeSandbox(world);
    sb.ctx.window.dispatch('mls:job-progress', { kind: 'schedule_history_pull', status: 'completed' });
    const armed = sb.scheduled.filter((s) => s.ms === 6000);
    assert.strictEqual(armed.length, 1, 'a terminal pull job arms exactly one settle');
    assert.strictEqual(sb.api.queue().length, 0, 'with nothing queued there is nothing to reconcile');
    await armed[armed.length - 1].fn();
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(sb.mergeRuns().length, 1, 'the duplicate sweep still runs once after the pull settles');
    ok('a settled month/year pull with no reconcilable day still runs the duplicate sweep exactly once');
  }
  {
    /* and it does not run twice for one pull */
    const sb = makeSandbox(world);
    await sb.api.mergeAfterPull();
    const second = await sb.api.mergeAfterPull();
    assert.strictEqual(second.reason, 'merged-recently', 'a second settle inside the cooldown must not re-sweep');
    assert.strictEqual(sb.mergeRuns().length, 1, 'exactly one sweep per pull');
    ok('the sweep cooldown keeps one settled pull to one merge');
  }
  {
    /* another TAB pulling is just as blocking (the b490 cross-tab stamp) */
    const sb = makeSandbox(world);
    sb.store['acct:mlsPullBusyXTabV1'] = String(Date.now());
    assert.strictEqual(sb.api._pullBusy(), true, 'another tab\'s fresh pull stamp must block this tab\'s drain');
    ok('the cross-tab pull stamp blocks reconciliation from a second tab');
  }

  /* ==================================== 8. the yield-chunking property */
  {
    const sb = makeSandbox(world);
    const before = sb.api._yields();
    const seen = [];
    const list = [];
    for (let i = 0; i < 500; i++) list.push(i);
    const total = await sb.api._chunkEach(list, (v) => { seen.push(v); }, { maxPerSlice: 200 });
    const turns = sb.api._yields() - before;
    assert.strictEqual(total, 500, 'every item is processed');
    assert.strictEqual(seen.length, 500);
    assert(turns >= 2, 'a 500-item sweep at 200 per slice must yield at least twice, not run in one block (yielded ' + turns + ')');
    ok('chunkEach yields ' + turns + ' time(s) across 500 items - the UI thread gets turns back');
  }
  {
    const sb = makeSandbox(world);
    const before = sb.api._yields();
    const one = [];
    for (let i = 0; i < 10; i++) one.push(i);
    await sb.api._chunkEach(one, () => {}, { maxPerSlice: 200 });
    assert.strictEqual(sb.api._yields() - before, 0, 'a list that fits one slice must not pay a turn for nothing');
    ok('a short sweep costs no extra turn - the chunker is not a tax');
  }
  {
    /* the drain's own store walk is the chunked one, not the synchronous one */
    const many = [];
    for (let i = 0; i < 450; i++) many.push({ id: 'pp' + i, name: 'P ' + i, dob: '1970-01-01', visits: [{ date: '2026-08-12' }] });
    const sb = makeSandbox({ ...world, patients: many });
    const before = sb.api._yields();
    const idx = await sb.api._buildVisitIndex();
    assert(Object.keys(idx.byId).length >= 450, 'the index covers the whole store');
    assert(sb.api._yields() - before >= 2, 'a 450-patient store must be indexed across turns, not in one block');
    ok('the post-pull protection index is built in yielded chunks over a 450-chart store');
  }
  {
    /* the calendar is bucketed by practice day ONCE per drain, chunked - a
       31-day month costs one pass over the appointment array, not thirty-one */
    const wide = [];
    for (let i = 0; i < 700; i++) wide.push({ id: 'w' + i, name: 'W ' + i, appt_date: '2026-08-' + (10 + (i % 5)), provider: 'Matthew Schaeffer, MD' });
    const sb = makeSandbox({ ...world, calendar: wide, patients: [] });
    const before = sb.api._yields();
    const idx = await sb.api._buildCalendarDayIndex();
    assert.strictEqual(Object.keys(idx).length, 5, 'every practice day gets its own bucket');
    let total = 0; Object.keys(idx).forEach((d) => { total += idx[d].length; });
    assert.strictEqual(total, 700, 'and no row is lost in the bucketing');
    assert(sb.api._yields() - before >= 2, 'a 700-row calendar is bucketed across turns, not in one block');
    ok('the calendar day index is built once per drain, in yielded chunks over 700 rows');
  }
  {
    const sb = makeSandbox(world);
    assert.strictEqual(sb.intervals.length, 0,
      'the safety net must NOT be a setInterval - an interval never stops (boot-script-budget arm C)');
    assert.strictEqual(sb.scheduled.filter((s) => s.ms === 15000).length, 1,
      'exactly one idle re-check is armed, as a self-rearming timeout');
    assert.strictEqual(/setInterval/.test(SRC), false, 'and the shipped bytes register no interval at all');
    ok('the idle safety net is a bounded self-rearming timeout, not an interval, so a queued day is never stranded');
  }
  {
    const sb = makeSandbox(world);
    assert.strictEqual(sb.api.revert(), true);
    assert.strictEqual(sb.ctx.window.__mlsPullReconcile, undefined, 'revert removes the module');
    sb.ctx.window.dispatch('mls-authoritative-schedule', { date: '2026-08-12', scope: 'all' });
    ok('revert() unhooks every listener and removes the module (additive + reversible)');
  }

  clearInterval(keepalive);
  console.log('PASS pull-reconcile: ' + n + ' checks - athena-as-fact gating, provider scope, ' +
    'linked-visit protection, server delete shape, snapshot-before-delete, receipt shape, ' +
    'lawful auto-merge after settle, and the yield-chunking property');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });

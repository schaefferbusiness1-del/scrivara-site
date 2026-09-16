'use strict';
/* calfresh-1.0.0 (2026-09-15) - "MATCH TO <DAY>" REFRESHES THAT DAY FIRST.
 *
 * Measured live by the extension lane on the dummy patient: the Send-to-Athena
 * sheet could not bind a freshly booked appointment because the in-page
 * appointment store (_calAppts, seeded from the calApptsCacheV2 snapshot) was
 * stale while /api/appointments?date=<day> already returned the row; replacing
 * _calAppts from the backend made _athenaCurrentApptStamp resolve at once.
 *
 * This executes wfbindRefreshDay sliced out of the shipped write-flow module
 * with a fake fetch, and pins that the press runs it before deciding whether
 * the day is "already resolvable". Synthetic rows only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');
let checks = 0;
function ok(c, m) { checks++; assert.ok(c, m); }

/* wiring pins */
ok(src.includes('function wfbindRun(state, day, btn, refreshed) {'), 'wfbindRun takes the refreshed flag');
ok(src.includes("refreshing.then(function () { wfbindRun(state, day, btn, true); }, function () { wfbindRun(state, day, btn, true); });"), 'the press refreshes once, then runs for real on success OR failure');
/* calfresh-1.0.1: with no backend session the refresh answers false synchronously and the press runs at once (1p-writeflow-bind-cure measures the nav in the same tick) */
ok(src.includes("if (refreshing === false) return wfbindRun(state, day, btn, true);"), 'with nothing to refresh the press runs in the same tick');
ok(src.includes("if (typeof window.bkBase !== 'function' || typeof window.bkToken !== 'function' || !window.bkToken()) return false;\n    return new Promise(function (resolve) {"), 'the refresh returns false, not a promise, when it cannot fetch');
const runAt = src.indexOf('function wfbindRun(state, day, btn, refreshed) {');
const refreshAt = src.indexOf('if (refreshed !== true) {', runAt);
const alreadyAt = src.indexOf('var already = wfbindResolvedOpts(state, day);', runAt);
ok(refreshAt > runAt && alreadyAt > refreshAt, 'the refresh precedes the "already resolvable" decision');

/* execute the refresher */
const s = src.indexOf('function wfbindRefreshDay(day) {');
const e = src.indexOf('\n  }\n', s);
const fn = src.slice(s, e + 4);
function run(fetchImpl, existing) {
  const notes = [];
  const ctx = { console, Promise, Error, JSON, String, Object, Array, setTimeout, clearTimeout, AbortController, encodeURIComponent,
    fetch: fetchImpl, wfdxNote(n) { notes.push(n); } };
  ctx.window = { bkBase() { return 'https://backend.test'; }, bkToken() { return 'tok'; }, _calAppts: existing.slice(),
    _calMergeApptRows(fresh) { const seen = new Set(fresh.map((r) => String(r.id))); return fresh.concat(ctx.window._calAppts.filter((r) => !seen.has(String(r.id)))); } };
  vm.runInNewContext(fn + '\nglobalThis.__refresh = wfbindRefreshDay;', ctx, { filename: 'writeflow-calfresh' });
  return { ctx, notes, promise: ctx.__refresh('2026-09-19') };
}
(async () => {
  /* success: the backend row lands in the store, the month is not truncated */
  let urls = [];
  const good = run(async (u, o) => { urls.push({ u: String(u), auth: o && o.headers && o.headers.Authorization, cache: o && o.cache }); return { ok: true, json: async () => ({ appointments: [{ id: 'new-1', appt_date: '2026-09-19', patient_external_id: 'p1' }] }) }; },
    [{ id: 'old-1', appt_date: '2026-09-01', patient_external_id: 'p1' }]);
  ok((await good.promise) === true, 'a good response resolves true');
  ok(urls.length === 1 && urls[0].u === 'https://backend.test/api/appointments?date=2026-09-19', 'exactly one request for exactly that day');
  ok(urls[0].auth === 'Bearer tok' && urls[0].cache === 'no-store', 'authenticated and uncached');
  ok(good.ctx.window._calAppts.length === 2 && good.ctx.window._calAppts[0].id === 'new-1' && good.ctx.window._calAppts[1].id === 'old-1', 'the fresh row is merged in front and the older month row is kept');
  ok(good.notes.length === 1 && good.notes[0].verb === 'calfresh' && good.notes[0].rows === 1, 'a PHI-free diagnostic note records the refresh');
  /* failure: the store is untouched and the press still proceeds */
  const bad = run(async () => { throw new Error('offline'); }, [{ id: 'old-1' }]);
  ok((await bad.promise) === false, 'a failed fetch resolves false');
  ok(bad.ctx.window._calAppts.length === 1 && bad.ctx.window._calAppts[0].id === 'old-1', 'the store is untouched on failure');
  const notOk = run(async () => ({ ok: false, json: async () => ({}) }), [{ id: 'old-1' }]);
  ok((await notOk.promise) === false, 'a non-2xx resolves false');
  /* no session: no request at all */
  const noTok = run(async () => { throw new Error('must not be called'); }, []);
  noTok.ctx.window.bkToken = () => '';
  ok((await noTok.ctx.__refresh('2026-09-19')) === false, 'without a session nothing is requested');
  /* bounded: a hung fetch resolves false within the budget */
  const hung = run(() => new Promise(() => {}), []);
  const t0 = Date.now();
  ok((await hung.promise) === false && Date.now() - t0 < 6000, 'a hung request resolves false inside the 4 s budget');
  console.log('PASS calfresh match refreshes the day: the Match-to-day press refreshes that day from the backend into the in-page store (merged, bounded, fail-soft) before deciding whether the appointment is already resolvable (' + checks + ' checks)');
})().catch((err) => { console.error(err); process.exit(1); });

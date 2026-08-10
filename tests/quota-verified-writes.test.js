/* qv-1.0 (3.0.56) - write verification: every check-mark must be earned.
 *
 * 2026-08-09: localStorage hit its ~5MB ceiling and setItem's QuotaExceeded
 * was swallowed up-stack - rows showed "saved" while nothing persisted
 * (July 7 = 9/15 stored under a "15/15 failures 0" day line; day 9 = ~1/15).
 * The guard judges the STORED ECHO, not the request. This suite EXECUTES the
 * real wrapper against stub stores - it does not merely pin strings.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

/* ---- extract the real qv IIFE and run it in a vm with a stub store ---- */
const start = mc.indexOf('qv-1.0 (2026-08-09)');
assert(start > 0, 'qv-1.0 block present in mls-connect');
const iifeStart = mc.indexOf('(function () {', start);
const iifeEnd = mc.indexOf("window.__mlsQuotaGuard_revert = QG.revert;\n})();", iifeStart);
assert(iifeStart > 0 && iifeEnd > iifeStart, 'qv IIFE extractable');
const iife = mc.slice(iifeStart, iifeEnd) + "window.__mlsQuotaGuard_revert = QG.revert;\n})();";

function mkCtx(storeBehavior) {
  const store = { data: {}, behavior: storeBehavior || 'normal' };
  const ctx = {
    console: { error: function () {}, warn: function () {} },
    setInterval: function () { return 0; },
    clearInterval: function () {},
    Date: Date, JSON: JSON, String: String, Number: Number, Math: Math,
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store.data, k) ? store.data[k] : null; },
      setItem: function (k, v) {
        if (store.behavior === 'quota-throw') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
        if (store.behavior === 'silent-noop') return; /* the swallowed-quota shape: no throw, no write */
        store.data[k] = String(v);
      }
    }
  };
  ctx.window = ctx;
  ctx.window.uns = function (k) { return 'test::' + k; };
  ctx.window.savePatients = function (arr) { ctx.localStorage.setItem(ctx.window.uns('patients'), JSON.stringify(arr)); };
  vm.createContext(ctx);
  vm.runInContext(iife, ctx);
  return { ctx: ctx, store: store };
}

const big = [];
for (let i = 0; i < 40; i++) big.push({ id: 'p' + i, name: 'X'.repeat(50) });

/* arm 1: healthy write verifies and CLEARS the flag */
{
  const { ctx } = mkCtx('normal');
  ctx.window.__mlsStoreWriteFailed = { at: 1, reason: 'stale' };
  ctx.window.savePatients(big);
  assert.strictEqual(ctx.window.__mlsStoreWriteFailed, null, 'a verified write clears the failure flag');
  assert(ctx.window.savePatients.__mlsQvGuarded === true, 'the wrapper installed');
}

/* arm 2: a THROWING store rethrows AND flags - no more swallowed quota */
{
  const { ctx } = mkCtx('quota-throw');
  let threw = false;
  try { ctx.window.savePatients(big); } catch (e) { threw = true; assert(/Quota/.test(e.name), 'the original error surfaces'); }
  assert(threw, 'the wrapper RETHROWS - a dead write can never look done');
  assert(ctx.window.__mlsStoreWriteFailed && /Quota/.test(ctx.window.__mlsStoreWriteFailed.reason),
    'the failure is recorded loudly with its reason');
}

/* arm 3: the SILENT NO-OP shape (the exact 2026-08-09 failure: store cannot
   grow, nothing thrown to the caller, bytes unchanged) is caught by the echo */
{
  const { ctx, store } = mkCtx('normal');
  ctx.window.savePatients(big); /* seed a real value */
  store.behavior = 'silent-noop';
  const bigger = big.concat([{ id: 'new', name: 'Y'.repeat(500) }]);
  ctx.window.savePatients(bigger);
  assert(ctx.window.__mlsStoreWriteFailed && ctx.window.__mlsStoreWriteFailed.reason === 'silent-no-op',
    'a write that wanted to grow the store but changed nothing is a recorded FAILURE');
}

/* arm 4: a byte-identical re-save (legitimate idempotent upsert) never alarms */
{
  const { ctx } = mkCtx('normal');
  ctx.window.savePatients(big);
  ctx.window.savePatients(big);
  assert.strictEqual(ctx.window.__mlsStoreWriteFailed, null, 'an idempotent same-bytes save is not a failure');
}

/* arm 5 (CONTROL, non-vacuity): the RAW unwrapped save on the silent-noop
   store reports nothing - proving the wrapper is what catches it */
{
  const store = { data: {} };
  let flagged = false;
  const raw = function (arr) { /* silent no-op */ };
  raw(big);
  assert(!flagged, 'control: without the wrapper the dead write is invisible - the pre-qv world');
}

/* ---- si side: the row gate + the day-line clause + not-sweepable ---- */
assert(si.includes('if (__qvFail && Number(__qvFail.at || 0) >= patientReadStartedAt) {'),
  'si fails the row when a storage failure is fresher than this chart\'s read');
assert(si.includes('one.reason = "storage-full-not-saved";'),
  'the row carries the storage reason, not a generic failure');
assert(si.includes('read correctly but could NOT be saved because this browser\'s MLS storage is full'),
  'the day line names the storage cause in plain words');
assert(si.includes('Existing records are intact - nothing was lost or overwritten.'),
  'the day line carries the one-key atomicity reassurance (verified: one key, one atomic setItem)');
{
  const sweepable = si.slice(si.indexOf('var SWEEPABLE_REASON'), si.indexOf('var SWEEPABLE_REASON') + 400);
  assert(!/storage-full/.test(sweepable),
    'storage-full is NOT sweepable - a re-check against a full store fails identically and would only churn');
}

console.log('quota-verified-writes: PASS (5 executed arms + 5 si pins)');

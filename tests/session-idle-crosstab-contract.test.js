'use strict';

/* lgn-1.0.0 (owner goal 2026-07-21): the ~10-minute "signed out / everything
 * reloads" cycle. The inactivity auto-logoff used a PER-TAB activity clock, so
 * a background MLS tab idled out on its own timer while the doctor worked in
 * another tab (or in Athena) — and its logout PURGED the shared account
 * namespace (patient store, ledgers, audio backups) plus the localStorage
 * token seed out from under the active tab.
 *
 * Contract:
 *  - activity is ACCOUNT-WIDE via a per-account localStorage ledger;
 *  - the idle timer only signs out when the WHOLE account has been idle for
 *    the full window, otherwise it re-arms for the remaining time;
 *  - a live visit recording (hands-free by design) holds the timer;
 *  - handle401 evicts ONLY on a confirmed 401 from /api/me — a 403 is a
 *    server gate/policy state and must never purge local clinical data.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

// ---- bound the active idle block --------------------------------------------
const idleStart = app.indexOf('let idleTimer=null;');
const idleEnd = app.indexOf('function applyBackendModeUI()');
assert(idleStart > 0 && idleEnd > idleStart, 'could not bound the inactivity-logoff block');
const idleBlock = app.slice(idleStart, idleEnd);

assert(idleBlock.includes('_accountIdleRemainingMs'), 'the account-wide idle ledger check is missing');
assert(idleBlock.includes("uns('idleLastActive')"), 'the idle ledger must live in the per-account namespace');
assert(idleBlock.includes('_touchIdleLedger'), 'activity must stamp the shared ledger');
assert(/capturing[\s\S]{0,120}resetIdle\(\); return;/.test(idleBlock),
  'a live visit recording must hold the inactivity timer');

// ---- handle401: eviction requires a confirmed-dead token (401), never 403 ---
const h401 = app.slice(app.indexOf('function handle401()'), app.indexOf('function applyAccessUI'));
assert(h401.includes('if(r.status===401) evict();'), 'handle401 must evict only on a confirmed 401 from /api/me');
assert(!/403[^\n]*evict\(\)/.test(h401), 'a 403 (gate/policy state) must never evict the session');

// ---- functional harness ------------------------------------------------------
function harness({ idleMins = '10', ledgerAgeMs = null, capturing = undefined } = {}) {
  const store = new Map();
  const email = 'doctor@example.test';
  const ledgerKey = `sf_u::${email}::idleLastActive`;
  if (ledgerAgeMs != null) store.set(ledgerKey, String(Date.now() - ledgerAgeMs));
  if (idleMins != null) store.set(`sf_u::${email}::idleMins`, idleMins);
  const calls = { logout: [], toast: [], timeouts: [], writes: [] };
  const context = {
    String, Number, Date, parseInt, isFinite,
    session: { email },
    uns: (s) => `sf_u::${email}::${s}`,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); calls.writes.push({ k, v: String(v) }); },
      removeItem: (k) => { store.delete(k); }
    },
    toast: (m) => calls.toast.push(String(m)),
    logout: (force) => calls.logout.push(force),
    setTimeout: (fn, ms) => { calls.timeouts.push(ms); return calls.timeouts.length; },
    clearTimeout: () => {},
    window: { addEventListener() {} }
  };
  if (capturing !== undefined) context.capturing = capturing;
  vm.createContext(context);
  vm.runInContext(idleBlock, context, { filename: 'idle-block.js' });
  return { context, calls, store, ledgerKey };
}

// 1) Another tab was active 1 minute ago (window 10) -> NO logout; re-armed for ~9 min.
{
  const h = harness({ ledgerAgeMs: 60 * 1000 });
  h.context.idleLogout();
  assert.strictEqual(h.calls.logout.length, 0, 'idleLogout signed out while another tab was active');
  assert.strictEqual(h.calls.timeouts.length, 1, 'idleLogout must re-arm exactly once');
  const delay = h.calls.timeouts[0];
  assert(delay > 8.8 * 60000 && delay <= 9.2 * 60000, `re-arm must cover the remaining window (got ${delay}ms)`);
}

// 2) The WHOLE account idle past the window -> sign out (the safeguard still works).
{
  const h = harness({ ledgerAgeMs: 11 * 60 * 1000 });
  h.context.idleLogout();
  assert.deepStrictEqual(h.calls.logout, [true], 'a genuinely idle account must still be signed out');
  assert(h.calls.toast.some((m) => /inactivity/i.test(m)), 'the sign-out must say why');
}

// 3) A live recording holds the timer even when the ledger is stale.
{
  const h = harness({ ledgerAgeMs: 11 * 60 * 1000, capturing: true });
  h.context.idleLogout();
  assert.strictEqual(h.calls.logout.length, 0, 'idleLogout must never fire mid-recording');
  assert.strictEqual(h.calls.timeouts.length, 1, 'a held timer must re-arm');
}

// 4) resetIdle stamps the shared ledger (throttled), so THIS tab's activity
//    keeps every same-account tab alive.
{
  const h = harness({ ledgerAgeMs: null });
  h.context.resetIdle();
  const ledgerWrites = h.calls.writes.filter((w) => w.k === h.ledgerKey);
  assert.strictEqual(ledgerWrites.length, 1, 'resetIdle must stamp the account ledger');
  h.context.resetIdle(); // immediately again -> throttled, no second write
  assert.strictEqual(h.calls.writes.filter((w) => w.k === h.ledgerKey).length, 1,
    'ledger writes must be throttled (at most one per ~5s)');
}

// 5) No ledger at all (first boot / storage unavailable) -> classic behavior:
//    the safeguard fails toward privacy, not toward staying signed in.
{
  const h = harness({ ledgerAgeMs: null });
  h.context.idleLogout();
  assert.deepStrictEqual(h.calls.logout, [true], 'a missing ledger must not disable the safeguard');
}

console.log('PASS session idle cross-tab: account-wide activity ledger holds background tabs, recording holds the timer, a genuinely idle account still locks, and eviction requires a confirmed 401');

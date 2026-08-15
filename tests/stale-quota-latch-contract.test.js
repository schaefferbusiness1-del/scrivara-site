'use strict';
/* ql-1.0 control: THE QUOTA GATE JUDGES CURRENT REALITY, NOT A FROZEN LATCH —
 * AND A STORE THAT IS GENUINELY FAILING WRITES STILL REFUSES LOUDLY.
 *
 * Live proof 1 (final-live-proofs-VERDICT.md, 2026-08-11, b1016): the qv
 * guard verifies a save by reading back uns('patients') from localStorage — a
 * key the sj-2.0 migration REMOVED. In idb mode the echo is null forever, so
 * the guard condemned the very boot flush IndexedDB CONFIRMED (receipt gen
 * 1->2, confirmedGen 2, wbFailures 0) as "silent-no-op", armed
 * window.__mlsStoreWriteFailed ~3.5 min after reload, and the b1014 quota
 * preflight refused every day pull indefinitely (gate:"quota-preflight",
 * reason:"storage-full-writes-failing") while localStorage sat at 1.4MB of
 * 5.2MB. Proof 2 disclosed the second gap: the MONTH lane bypassed the quota
 * preflight entirely.
 *
 * Pinned here on the real shipped bytes, BOTH directions:
 *   A. the qv guard (mls-connect) is MODE-AWARE: a healthy idb save never
 *      arms the flag off the retired localStorage key; the flag's self-clear
 *      has a second writer at the store's confirm point; a degraded /
 *      rejecting store still arms it loudly; ls mode is byte-for-byte the old
 *      behavior; the heal tick clears a latch the receipt proves stale (the
 *      chip follows the same truth).
 *   B. the day-lane preflight (__dayPullInner): stale latch + healthy idb
 *      receipt => the latch clears and the pull PROCEEDS; flag + unhealthy /
 *      absent store => refuses exactly as b1014 shipped it (named gate,
 *      spoken, stamped, no navigation, no presence arm).
 *   C. the MONTH lane (pullMonth) carries the same preflight: refuses loudly
 *      BEFORE any per-day engine call while writes are failing; proceeds when
 *      the latch is provably stale; untouched when no flag is set.
 *   D. patcher identity: all 6 ql-1.0 edits are present exactly once in the
 *      shipped bytes (tolerant applyToSources reports already-applied).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'latin1');

const drain = () => new Promise(r => setImmediate(r));

/* =========================================================================
 * PART A: the qv guard (extracted exactly like quota-verified-writes)
 * ========================================================================= */
const qvMark = mc.indexOf('qv-1.0 (2026-08-09)');
assert.ok(qvMark > 0, 'qv-1.0 block present');
const iifeStart = mc.indexOf('(function () {', qvMark);
const TAIL = 'window.__mlsQuotaGuard_revert = QG.revert;\n})();';
const iifeEnd = mc.indexOf(TAIL, iifeStart);
assert.ok(iifeStart > 0 && iifeEnd > iifeStart, 'qv IIFE extractable');
const qvSrc = mc.slice(iifeStart, iifeEnd) + TAIL;

/* a configurable sj-2.0 store stub: receipt + flushNow are the only surfaces
   the guard may consult (the store's own confirm receipt, sj2 integration) */
function mkStore(shape) {
  const st = Object.assign({
    mode: 'idb', hydrated: true, gen: 2, confirmedGen: 2,
    wbFailures: 0, degraded: false, degradedWhy: '', lastError: '',
    flushReject: '', confirmOnFlush: true
  }, shape || {});
  return {
    _st: st,
    isReady() { return st.mode === 'idb' && st.hydrated === true; },
    receipt() {
      return {
        mode: st.mode, hydrated: st.hydrated, gen: st.gen, confirmedGen: st.confirmedGen,
        wbFailures: st.wbFailures, degraded: st.degraded, degradedWhy: st.degradedWhy, lastError: st.lastError
      };
    },
    flushNow() {
      if (st.flushReject) return Promise.reject(new Error(st.flushReject));
      if (st.confirmOnFlush) st.confirmedGen = st.gen;
      return Promise.resolve({ confirmedGen: st.confirmedGen });
    }
  };
}

function bootQv(store) {
  const map = new Map();
  const localStorage = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k)
  };
  const elements = new Map();
  const doc = {
    getElementById: id => elements.get(id) || null,
    createElement: () => {
      const el = {
        id: '', style: {}, attrs: {}, textContent: '',
        setAttribute(k, v) { this.attrs[k] = v; },
        remove() { if (this.id && elements.get(this.id) === this) elements.delete(this.id); this.__removed = true; }
      };
      return el;
    },
    body: { appendChild: el => { if (el.id) elements.set(el.id, el); } },
    documentElement: { appendChild: el => { if (el.id) elements.set(el.id, el); } }
  };
  const toasts = [];
  const warns = [];
  const intervalFns = [];
  const win = {
    uns: k => 'sf_u::t::' + k,
    toast: m => toasts.push(String(m)),
    localStorage
  };
  if (store) win.__mlsPtsStore = store;
  /* the retired-key world: savePatients persists NOTHING to localStorage
     (post-migration the store owns durability; the ls blob is gone by design) */
  win.savePatients = function () {};
  const consoleStub = {
    error: function () {},
    log: function () {},
    warn: function () { warns.push(Array.prototype.join.call(arguments, ' ')); }
  };
  const f = new Function('window', 'document', 'localStorage', 'setInterval', 'clearInterval', 'console', qvSrc);
  f(win, doc, localStorage, fn => { intervalFns.push(fn); return intervalFns.length; }, () => {}, consoleStub);
  return { win, doc, map, elements, toasts, warns, intervalFns };
}

const big = [];
for (let i = 0; i < 200; i++) big.push({ id: 'p' + i, name: 'X'.repeat(60) });

(async function () {

  /* ---- A1. THE LIVE INCIDENT: a healthy idb save must not arm the flag ---- */
  {
    const h = bootQv(mkStore());
    h.win.savePatients(big); /* material save; ls echo is null FOREVER (key retired) */
    assert.ok(!h.win.__mlsStoreWriteFailed,
      'a healthy idb-mode save is NOT condemned off the retired localStorage key (old shape: silent-no-op armed at boot, expected ~38MB got 0, latch never cleared)');
    await drain(); await drain();
    assert.strictEqual(h.win.__mlsStoreWriteFailed, null,
      'after the store confirm the flag is exactly null - the verified-write clear fired at the idb confirm point');
    assert.ok(!h.elements.get('mlsQuotaChip'), 'no false "Local storage full" chip on a healthy idb save');
    console.log('ok 1 - idb-mode save verified through the store confirm, never the retired ls key');
  }

  /* ---- A2. the confirm point is the flag's SECOND self-clear writer ---- */
  {
    const h = bootQv(mkStore());
    h.win.__mlsStoreWriteFailed = { at: Date.now() - 900000, reason: 'silent-no-op', expected: 38235881, got: 0 };
    h.win.__mlsQuotaGuard._chip(); /* paint the stale chip the live page showed */
    assert.ok(h.elements.get('mlsQuotaChip'), 'stale chip painted for the test');
    h.win.savePatients(big);
    await drain(); await drain();
    assert.strictEqual(h.win.__mlsStoreWriteFailed, null,
      'a pre-armed stale latch clears on the next store-confirmed save (the self-clear regained a functioning writer in idb mode)');
    assert.ok(!h.elements.get('mlsQuotaChip'), 'the chip follows the flag down');
    console.log('ok 2 - stale latch clears at the idb confirm point, chip follows');
  }

  /* ---- A3. NEVER WEAKENED: a genuinely failing idb store arms the flag ---- */
  {
    const h = bootQv(mkStore({ flushReject: 'MLS_PTS_IDB_DEGRADED: write-behind is failing' }));
    h.win.savePatients(big);
    await drain(); await drain();
    assert.ok(h.win.__mlsStoreWriteFailed, 'a rejecting store confirm ARMS the flag - the refusal side is not weakened');
    assert.ok(/^idb-confirm:/.test(String(h.win.__mlsStoreWriteFailed.reason)),
      'the failure names the idb confirm as its source: ' + String(h.win.__mlsStoreWriteFailed.reason));
    assert.ok(h.elements.get('mlsQuotaChip'), 'the chip appears for the genuine failure');
    console.log('ok 3 - genuinely failing idb store still arms flag + chip loudly');
  }

  /* ---- A4. ls mode is byte-for-byte the old behavior ---- */
  {
    /* no store at all (pre-migration world) */
    const h = bootQv(null);
    h.map.set('sf_u::t::patients', 'A'.repeat(1000));
    h.win.savePatients(big); /* wants growth, bytes do not move -> silent-no-op */
    assert.ok(h.win.__mlsStoreWriteFailed && h.win.__mlsStoreWriteFailed.reason === 'silent-no-op',
      'ls mode: the swallowed-quota no-op is still caught (qv-1.0 unchanged)');
    /* a verified ls write still clears */
    h.win.savePatients.__mlsQvOrig
      ? void 0 : assert.fail('wrapper chain intact');
    const orig = h.win.savePatients;
    h.win.savePatients = function (arr) { h.map.set(h.win.uns('patients'), JSON.stringify(arr)); };
    /* re-wrap via the heal path */
    h.intervalFns.forEach(fn => fn());
    h.win.savePatients(big);
    assert.strictEqual(h.win.__mlsStoreWriteFailed, null, 'ls mode: a verified write still clears the flag');
    void orig;
    /* an ls-mode store object (isReady false) must also take the legacy path */
    const h2 = bootQv(mkStore({ mode: 'ls', hydrated: false }));
    h2.map.set('sf_u::t::patients', 'A'.repeat(1000));
    h2.win.savePatients(big);
    assert.ok(h2.win.__mlsStoreWriteFailed && h2.win.__mlsStoreWriteFailed.reason === 'silent-no-op',
      'an un-migrated store (mode ls / not ready) never routes verification to idb');
    console.log('ok 4 - ls mode unchanged: silent-no-op caught, verified write clears, not-ready store stays legacy');
  }

  /* ---- A5. the heal tick clears a latch the receipt proves stale ---- */
  {
    const h = bootQv(mkStore());
    h.win.__mlsStoreWriteFailed = { at: Date.now() - 600000, reason: 'silent-no-op' };
    h.win.__mlsQuotaGuard._chip();
    assert.ok(h.elements.get('mlsQuotaChip'), 'stale chip up before the tick');
    h.intervalFns.forEach(fn => fn());
    assert.strictEqual(h.win.__mlsStoreWriteFailed, null,
      'the 4s heal tick adjudicates the latch against the store receipt (old shape: the tick only re-painted the stale chip forever)');
    assert.ok(!h.elements.get('mlsQuotaChip'), 'the stale chip dies within one tick');
    assert.ok(h.warns.some(w => w.indexOf('stale write-failure latch CLEARED') >= 0),
      'the clear says why, on the record');
    /* and the tick NEVER clears over an unhealthy receipt */
    const hBad = bootQv(mkStore({ degraded: true, degradedWhy: 'idb-write-behind: quota' }));
    hBad.win.__mlsStoreWriteFailed = { at: Date.now(), reason: 'idb-unhealthy: x' };
    hBad.intervalFns.forEach(fn => fn());
    assert.ok(hBad.win.__mlsStoreWriteFailed, 'a degraded store keeps its latch through every tick');
    console.log('ok 5 - heal tick: stale latch dies in one tick, degraded latch survives every tick');
  }

  /* =========================================================================
   * PART B: the day-lane preflight judges current reality
   * ========================================================================= */
  function extractBraced(src, startToken, from) {
    const at = src.indexOf(startToken, from || 0);
    assert.ok(at >= 0, 'extractor found: ' + startToken);
    const open = src.indexOf('{', at);
    let depth = 0, mode = null;
    for (let i = open; i < src.length; i++) {
      const c = src[i], p = src[i - 1];
      if (mode === null) {
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
        else if (c === "'" || c === '"' || c === '`') mode = c;
        else if (c === '/' && src[i + 1] === '/') { mode = '//'; i++; }
        else if (c === '/' && src[i + 1] === '*') { mode = '/*'; i++; }
      } else if (mode === '//') { if (c === '\n') mode = null; }
      else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
      else { if (c === '\\') i++; else if (c === mode) mode = null; }
    }
    throw new Error('unbalanced braces after ' + startToken);
  }

  const adjSrc = extractBraced(si, 'function _quotaLatchStale()');
  const innerSrc = extractBraced(si, 'function __dayPullInner(opts, __armPresence)');

  function buildInner(ctx) {
    const f = new Function('ctx',
      'var window = ctx.window;\n' +
      'var console = ctx.console || { warn: function () {}, error: function () {}, log: function () {} };\n' +
      'var pullRunning = false;\n' +
      'var lastPullResult = null;\n' +
      'var isFn = function (x) { return typeof x === "function"; };\n' +
      'var normDate = function (d) { d = String(d || ""); return /^\\d{4}-\\d{2}-\\d{2}$/.test(d) ? d : ""; };\n' +
      'var safe = function (fn, fb) { try { return fn(); } catch (e) { return fb; } };\n' +
      'var foreignPullLease = function () { return null; };\n' +
      'var PROD_DAY_CENSUS_TOKEN = {};\n' +
      'var _dayPreflightDone = true;\n' +
      'var warmUpDay = ctx.warmUpDay;\n' +
      'var accountProviderRequest = function () { return "all"; };\n' +
      'var _resolveDayScope = function () { return { ok: true, provider: "all" }; };\n' +
      'var pull = ctx.pull;\n' +
      adjSrc + '\n' +
      innerSrc + '\n' +
      'return { inner: __dayPullInner, getLastPullResult: function () { return lastPullResult; } };');
    return f(ctx);
  }

  /* ---- B1. stale latch + healthy idb receipt => the pull PROCEEDS ---- */
  {
    const said = [];
    let pulled = false, chipRefreshes = 0;
    const warns = [];
    const ctx = {
      window: {
        __mlsStoreWriteFailed: { at: Date.now() - 780000, reason: 'silent-no-op', expected: 38235881, got: 0 },
        __mlsQuotaGuard: { failures: 1, _chip: () => { chipRefreshes++; } },
        __mlsPtsStore: mkStore()
      },
      console: { warn: m => warns.push(String(m)), error: () => {}, log: () => {} },
      warmUpDay: () => Promise.resolve({}),
      pull: () => { pulled = true; return Promise.resolve({ ok: true, marker: 'engine-ran' }); }
    };
    const h = buildInner(ctx);
    const res = await h.inner({ date: '2026-07-07', onStatus: (m, k) => said.push({ m: String(m), k: String(k || '') }) }, null);
    assert.strictEqual(res.ok, true,
      'a stale latch over a provably-healthy idb store no longer refuses the pull (old shape: gate:"quota-preflight" forever, dn-1.0 unreachable)');
    assert.ok(pulled, 'the engine ran');
    assert.strictEqual(ctx.window.__mlsStoreWriteFailed, null, 'the preflight CLEARED the stale latch, it did not just step over it');
    assert.ok(chipRefreshes >= 1, 'the chip was refreshed at the clear (the surface follows the flag)');
    assert.ok(warns.some(w => w.indexOf('stale write-failure latch CLEARED') >= 0),
      'the adjudication says why, on the record');
    assert.ok(!said.some(s => /storage is FULL/i.test(s.m)), 'no false storage-full narration');
    console.log('ok 6 - day preflight: stale latch clears, pull proceeds, clear is named');
  }

  /* ---- B2. flag + NO store => refuses exactly as b1014 shipped it ---- */
  {
    const said = [];
    let warmed = false, pulled = false, armed = false;
    const ctx = {
      window: {
        __mlsStoreWriteFailed: { at: Date.now() - 300000, reason: 'silent-no-op' },
        __mlsQuotaGuard: { failures: 3 }
      },
      warmUpDay: () => { warmed = true; return Promise.resolve({}); },
      pull: () => { pulled = true; return Promise.resolve({ ok: true }); }
    };
    const h = buildInner(ctx);
    const res = await h.inner(
      { date: '2026-08-12', onStatus: (m, k) => said.push({ m: String(m), k: String(k || '') }) },
      () => { armed = true; });
    assert.strictEqual(res.ok, false, 'no store receipt to consult => the refusal stands');
    assert.strictEqual(res.reason, 'storage-full-writes-failing', 'named reason unchanged');
    assert.strictEqual(res.gate, 'quota-preflight', 'named gate unchanged');
    assert.ok(said.some(s => s.k === 'err' && /storage is FULL/i.test(s.m)), 'spoken through onStatus');
    assert.ok(said.some(s => /No Athena navigation was started/.test(s.m)), 'the no-navigation truth survives');
    assert.strictEqual(h.getLastPullResult(), res, 'receipt-stamped into lastPullResult');
    assert.ok(ctx.window.__mlsPullLastOutcome && ctx.window.__mlsPullLastOutcome.ok === false, 'outcome-stamped');
    assert.ok(!warmed && !pulled && !armed, 'no warm-up, no engine, no presence arm');
    console.log('ok 7 - day preflight: refusal unchanged when there is no receipt to prove health');
  }

  /* ---- B3. flag + UNHEALTHY receipts => still refuses, latch survives ---- */
  {
    const shapes = [
      ['degraded idb', mkStore({ degraded: true, degradedWhy: 'idb-write-behind: quota' })],
      ['write-behind failing', mkStore({ wbFailures: 2 })],
      ['unconfirmed generation lag', mkStore({ gen: 7, confirmedGen: 5 })],
      ['un-migrated (ls mode)', mkStore({ mode: 'ls', hydrated: false })]
    ];
    for (const [label, store] of shapes) {
      let pulled = false;
      const ctx = {
        window: {
          __mlsStoreWriteFailed: { at: Date.now() - 60000, reason: 'x' },
          __mlsQuotaGuard: { failures: 1 },
          __mlsPtsStore: store
        },
        warmUpDay: () => Promise.resolve({}),
        pull: () => { pulled = true; return Promise.resolve({ ok: true }); }
      };
      const h = buildInner(ctx);
      const res = await h.inner({ date: '2026-08-12', onStatus: () => {} }, null);
      assert.strictEqual(res.ok, false, label + ': still refused');
      assert.strictEqual(res.gate, 'quota-preflight', label + ': gate named');
      assert.ok(ctx.window.__mlsStoreWriteFailed, label + ': the latch is NOT cleared over an unhealthy receipt');
      assert.ok(!pulled, label + ': the engine never ran');
    }
    console.log('ok 8 - day preflight: all four unhealthy shapes refuse; the latch survives');
  }

  /* =========================================================================
   * PART C: the MONTH lane carries the same preflight (proof-2 gap)
   * ========================================================================= */
  const monthSrc = extractBraced(si, 'function pullMonth(opts)');

  function buildMonth(ctx) {
    const f = new Function('ctx',
      'var window = ctx.window;\n' +
      'var console = ctx.console || { warn: function () {}, error: function () {}, log: function () {} };\n' +
      'var monthPullRunning = false;\n' +
      'var isFn = function (x) { return typeof x === "function"; };\n' +
      'var safe = function (fn, fb) { try { return fn(); } catch (e) { return fb; } };\n' +
      'var monthDateKeys = function () { return ctx.dates.slice(); };\n' +
      'var resolveProviderRequest = function () { return { ok: true, provider: "all", receipt: { complete: true } }; };\n' +
      'var providerScopeReceipt = function () { return {}; };\n' +
      'var providerScopeNotice = function () { return ""; };\n' +
      'var pull = ctx.pull;\n' +
      adjSrc + '\n' +
      monthSrc + '\n' +
      'return { pullMonth: pullMonth };');
    return f(ctx);
  }

  /* ---- C1. flag + no healthy receipt => month refuses BEFORE any day ---- */
  {
    const said = [];
    const pullCalls = [];
    const ctx = {
      window: {
        __mlsStoreWriteFailed: { at: Date.now() - 720000, reason: 'silent-no-op' },
        __mlsQuotaGuard: { failures: 2 }
      },
      dates: ['2026-02-02', '2026-02-03'],
      pull: o => { pullCalls.push(o); return Promise.resolve({ ok: true, complete: true }); }
    };
    const h = buildMonth(ctx);
    const res = await h.pullMonth({ month: '2026-02', onStatus: (m, k) => said.push({ m: String(m), k: String(k || '') }) });
    assert.strictEqual(res.ok, false,
      'the month pull is refused while writes are failing (old shape: pullMonth BYPASSED the quota preflight and drove every day - the proof-2 disclosed gap)');
    assert.strictEqual(res.reason, 'storage-full-writes-failing', 'same named reason as the day lane');
    assert.strictEqual(res.gate, 'quota-preflight', 'same named gate as the day lane');
    assert.strictEqual(res.failures, 2, 'the refusal carries the guard failure count');
    assert.strictEqual(pullCalls.length, 0, 'ZERO per-day engine calls: Athena was never driven');
    assert.ok(said.some(s => s.k === 'err' && /storage is FULL/i.test(s.m)), 'spoken through onStatus');
    assert.ok(said.some(s => /No Athena navigation was started/.test(s.m)), 'the no-navigation truth is spoken');
    assert.ok(ctx.window.__mlsPullLastOutcome && ctx.window.__mlsPullLastOutcome.ok === false, 'outcome-stamped');
    assert.strictEqual(res.month, '2026-02', 'the month-shaped receipt survives (failed() shape, not a foreign object)');
    console.log('ok 9 - month lane: refuses loudly before any Athena navigation while writes are failing');
  }

  /* ---- C2. stale latch + healthy idb receipt => the month PROCEEDS ---- */
  {
    const pullCalls = [];
    const ctx = {
      window: {
        __mlsStoreWriteFailed: { at: Date.now() - 720000, reason: 'silent-no-op' },
        __mlsQuotaGuard: { failures: 1, _chip: () => {} },
        __mlsPtsStore: mkStore()
      },
      dates: ['2026-02-02', '2026-02-03'],
      pull: o => { pullCalls.push(o); return Promise.resolve({ ok: true, complete: true }); }
    };
    const h = buildMonth(ctx);
    const res = await h.pullMonth({ month: '2026-02', onStatus: () => {} });
    assert.strictEqual(ctx.window.__mlsStoreWriteFailed, null, 'the stale latch cleared on the month entry too');
    assert.strictEqual(pullCalls.length, 2, 'every day of the month ran');
    assert.strictEqual(res.reason, 'complete', 'the month completed normally');
    console.log('ok 10 - month lane: stale latch clears and the month proceeds');
  }

  /* ---- C3. control: no flag => the month lane is untouched ---- */
  {
    const pullCalls = [];
    const ctx = {
      window: {},
      dates: ['2026-02-02'],
      pull: o => { pullCalls.push(o); return Promise.resolve({ ok: true, complete: true }); }
    };
    const h = buildMonth(ctx);
    const res = await h.pullMonth({ month: '2026-02', onStatus: () => {} });
    assert.strictEqual(res.reason, 'complete', 'no flag: month unchanged');
    assert.strictEqual(pullCalls.length, 1, 'no flag: the engine ran');
    console.log('ok 11 - month lane control: no flag, no gate, unchanged behavior');
  }

  /* =========================================================================
   * PART D: placement + patcher identity on the shipped bytes
   * ========================================================================= */
  {
    /* the month gate sits BETWEEN the in-flight refusal and the engine start */
    const mIdx = si.indexOf('function pullMonth(opts)');
    const mBusy = si.indexOf('if (monthPullRunning) return', mIdx);
    const mGate = si.indexOf('var _lrQuotaM', mIdx);
    const mRun = si.indexOf('monthPullRunning = true;', mIdx);
    assert.ok(mBusy > 0 && mGate > mBusy && mRun > mGate,
      'month quota gate sits between the in-flight refusal and the engine start (BEFORE any Athena navigation)');

    /* the day gate ordering the qol suites pin stays intact around our line */
    const dIdx = si.indexOf('function __dayPullInner(opts, __armPresence)');
    const dAdvisory = si.indexOf('if (pullRunning || foreignPullLease()) {', dIdx);
    const dAdj = si.indexOf('typeof _quotaLatchStale === "function"', dIdx);
    const dArm = si.indexOf('if (isFn(__armPresence)) __armPresence(); /* qol-2.3', dIdx);
    assert.ok(dAdvisory > 0 && dAdj > dAdvisory && dArm > dAdj,
      'day lane order: advisory in-flight < latch adjudication < presence arm');

    /* patcher identity: every ql-1.0 edit present exactly once */
    const patcher = require('./patch-stale-quota-latch.js');
    const raw = {
      'mls-connect.js': mc,
      'feat_mls_schedimport_exact.js': si
    };
    const { log } = patcher.applyToSources(raw, { tolerateApplied: true });
    const appliedIds = log.filter(l => l.status === 'already-applied').map(l => l.id);
    assert.strictEqual(appliedIds.length, patcher.EDITS.length,
      'all ' + patcher.EDITS.length + ' ql-1.0 edits are already applied on the shipped bytes (got: ' + appliedIds.join(', ') + ')');
    console.log('ok 12 - placement pins + patcher identity (' + appliedIds.length + '/' + patcher.EDITS.length + ' edits present exactly once)');
  }

  console.log('# stale-quota-latch-contract: 12 groups passed');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });

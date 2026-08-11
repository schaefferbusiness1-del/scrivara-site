'use strict';
/* =============================================================================
 * sj2-boot-barrier.test.js  (sj-2.0 phase-2, Commit A step 3 coverage)
 * 2026-08-11
 *
 * THE C4 BOOT BARRIER, suite-covered (INTEGRATION-ORDER.md: "The cutover
 * (step 8) is FORBIDDEN until this is shipped and suite-covered"): after
 * session identity resolves, boot calls __mlsPtsStore.init() and the FIRST
 * roster-dependent paint awaits ready(); pre-migration the paint stays
 * SYNCHRONOUS (byte-compatible boot timing); fail-open on refusal/hang so a
 * broken store can never brick boot.
 *
 * Extraction-based: the barrier bytes are read from ScribeFlow.html (the
 * shipped surface), never from a file copy. Static pins first (register-with-
 * the-commit discipline: this suite is RED before patch-sj2-boot-barrier.js
 * applied), then vm behaviour with deterministic fakes.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'latin1');

function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

/* ---- 1. static pins ------------------------------------------------------ */

const FN_HEAD = 'function __mlsPtsBootBarrier(paint){';
assert.strictEqual(occurrences(APP, FN_HEAD), 1,
  'C4 BOOT BARRIER ABSENT: ScribeFlow.html does not define __mlsPtsBootBarrier exactly once. ' +
  'This suite registers WITH the Commit A boot-barrier patch (tests/patch-sj2-boot-barrier.js) - ' +
  'never before it.');

const fnStart = APP.indexOf(FN_HEAD);
const fnEnd = APP.indexOf('\n}\n', fnStart);
assert.ok(fnEnd > fnStart, 'barrier function body delimited');
const FN = APP.slice(fnStart, fnEnd + 3);

/* barrier before the startSession window; paint call inside it; the
   registered fastpath pin (showView before scheduleNavCounts) preserved */
const s0 = APP.indexOf('function startSession(email)');
const s1 = APP.indexOf('function logout(force)', s0);
assert.ok(s0 >= 0 && s1 > s0, 'startSession window located');
assert.ok(fnStart < s0, 'barrier defined before startSession');
const SESSION = APP.slice(s0, s1);
assert.ok(SESSION.indexOf('__mlsPtsBootBarrier(function(){') >= 0,
  'startSession routes its roster paint through the barrier');
assert.ok(SESSION.indexOf("showView('visit');") >= 0 && SESSION.indexOf('scheduleNavCounts();') >= 0 &&
  SESSION.indexOf("showView('visit');") < SESSION.indexOf('scheduleNavCounts();'),
  'showView(visit) still precedes scheduleNavCounts inside the wrapped block (route-patient-read-fastpath pin held)');
assert.ok(SESSION.indexOf('renderDots();') >= 0 &&
  SESSION.indexOf('__mlsPtsBootBarrier(function(){') < SESSION.indexOf('renderDots();'),
  'renderDots is inside the barrier closure');

/* the identity-change side door re-inits the store */
const idPin = "window.__mlsPtsBootReady=window.__mlsPtsStore.init();";
assert.ok(occurrences(APP, idPin) >= 1, 'refreshMe identity-change branch re-runs init()');

/* the sync migrated-probe reads the gen stamp and the blob key - the ls-mode
   inert-fast guarantee rests on this exact probe shape */
assert.ok(FN.indexOf("localStorage.getItem(uns('ptsGenV2'))!=null") >= 0 &&
  FN.indexOf("localStorage.getItem(uns('patients'))==null") >= 0,
  'migrated probe = gen stamp present AND blob absent (sync, pre-paint)');

/* the barrier must call init() exactly once per invocation and never
   reference the qg latch */
assert.strictEqual(occurrences(FN, 'store.init()'), 1, 'one init() call inside the barrier');
assert.strictEqual(occurrences(FN, '__mlsPtsEdit' + 'AtRiskUnknown'), 0, 'barrier never references the qg latch');

/* ---- 2. vm behaviour ----------------------------------------------------- */

function makeCtx(opts) {
  opts = opts || {};
  const timeouts = [];
  const warned = [];
  const ls = Object.assign({}, opts.ls || {});
  const ctx = {
    console: { warn: (m) => warned.push(String(m)), error: (m) => warned.push(String(m)), info: () => {} },
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null)
    },
    uns: (s) => 'sf_u::acct@example.test::' + s,
    window: {}
  };
  if (opts.store) ctx.window.__mlsPtsStore = opts.store;
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(FN + '\nthis.__bb=__mlsPtsBootBarrier;', ctx, { filename: 'bb-extract.js' });
  return { ctx, timeouts, warned, ls };
}

function deferred() {
  let res, rej;
  const p = new Promise((a, b) => { res = a; rej = b; });
  return { p, res, rej };
}

const tick = () => new Promise((r) => setImmediate(r));

(async function () {
  /* A: no store at all -> paint runs synchronously */
  {
    const h = makeCtx({});
    let painted = 0;
    h.ctx.__bb(() => { painted++; });
    assert.strictEqual(painted, 1, 'A: no store - paint is synchronous');
    assert.strictEqual(h.timeouts.length, 0, 'A: no timer armed');
  }

  /* B: store present, pre-migration (no gen stamp) -> paint synchronous,
     init() fired exactly once, boot promise published */
  {
    const d = deferred();
    let initCalls = 0;
    const store = { init: () => { initCalls++; return d.p; } };
    const h = makeCtx({ store, ls: { 'sf_u::acct@example.test::patients': '[]' } });
    let painted = 0;
    h.ctx.__bb(() => { painted++; });
    assert.strictEqual(painted, 1, 'B: ls mode - paint is SYNCHRONOUS (inert-fast; init still pending)');
    assert.strictEqual(initCalls, 1, 'B: init() fired once');
    assert.ok(h.ctx.window.__mlsPtsBootReady, 'B: boot promise published on window.__mlsPtsBootReady');
    d.res({ mode: 'ls' });
    await tick();
    assert.strictEqual(painted, 1, 'B: settling init never repaints');
  }

  /* B2: fresh account (nothing anywhere) -> synchronous too */
  {
    const d = deferred();
    const store = { init: () => d.p };
    const h = makeCtx({ store, ls: {} });
    let painted = 0;
    h.ctx.__bb(() => { painted++; });
    assert.strictEqual(painted, 1, 'B2: fresh account - synchronous paint');
    d.res({});
    await tick();
  }

  /* C: migrated (gen stamp present, blob absent) -> paint DEFERRED until
     init resolves */
  {
    const d = deferred();
    const store = { init: () => d.p };
    const h = makeCtx({ store, ls: { 'sf_u::acct@example.test::ptsGenV2': '7|ab|1' } });
    let painted = 0;
    h.ctx.__bb(() => { painted++; });
    assert.strictEqual(painted, 0, 'C: migrated - paint awaits hydration');
    assert.ok(h.timeouts.length === 1 && h.timeouts[0].ms === 4000, 'C: 4000ms fail-open armed');
    d.res({ mode: 'idb', rows: 3 });
    await tick();
    assert.strictEqual(painted, 1, 'C: paint released by init resolution');
    h.timeouts[0].fn();
    assert.strictEqual(painted, 1, 'C: later timeout never double-paints');
  }

  /* D: migrated + init REJECTS -> paint still released (fail-open), loud */
  {
    const d = deferred();
    const store = { init: () => d.p };
    const h = makeCtx({ store, ls: { 'sf_u::acct@example.test::ptsGenV2': '7|ab|1' } });
    let painted = 0;
    h.ctx.__bb(() => { painted++; });
    assert.strictEqual(painted, 0, 'D: deferred first');
    d.rej(Object.assign(new Error('refused'), { code: 'MLS_PTS_STORE_NO_NAMESPACE' }));
    await tick(); await tick();
    assert.strictEqual(painted, 1, 'D: refusal releases the paint (fail-open)');
    assert.ok(h.warned.some(w => /init refused|init-refusal/.test(w)), 'D: refusal is loud');
  }

  /* E: migrated + init never settles -> the 4000ms timer releases the paint */
  {
    const d = deferred();
    const store = { init: () => d.p };
    const h = makeCtx({ store, ls: { 'sf_u::acct@example.test::ptsGenV2': '7|ab|1' } });
    let painted = 0;
    h.ctx.__bb(() => { painted++; });
    assert.strictEqual(painted, 0, 'E: deferred');
    assert.strictEqual(h.timeouts.length, 1, 'E: timer armed');
    h.timeouts[0].fn();
    assert.strictEqual(painted, 1, 'E: hung IndexedDB cannot brick boot - timeout releases the paint');
    assert.ok(h.warned.some(w => /fail-open timeout/.test(w)), 'E: the fail-open is loud');
    d.res({});
    await tick();
    assert.strictEqual(painted, 1, 'E: late resolution never double-paints');
  }

  /* F: init() throwing SYNCHRONOUSLY -> paint runs, no crash */
  {
    const store = { init: () => { throw new Error('sync boom'); } };
    const h = makeCtx({ store, ls: { 'sf_u::acct@example.test::ptsGenV2': '7|ab|1' } });
    let painted = 0;
    h.ctx.__bb(() => { painted++; });
    assert.strictEqual(painted, 1, 'F: a synchronously-throwing init falls open to an immediate paint');
  }

  /* G: the paint itself throwing is contained (loud, not fatal) */
  {
    const h = makeCtx({});
    assert.doesNotThrow(() => { h.ctx.__bb(() => { throw new Error('paint boom'); }); },
      'G: a throwing paint is contained');
    assert.ok(h.warned.some(w => /roster paint failed/.test(w)), 'G: contained loudly');
  }

  console.log('sj2-boot-barrier: OK (static pins: defined once before startSession, paint routed through barrier with fastpath pin held, identity-reinit present, migrated probe shape; vm: no-store sync, ls-mode sync inert-fast, fresh-account sync, migrated defers until init, refusal fail-open loud, hung-init 4000ms fail-open loud, sync-throw fail-open, throwing paint contained)');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });

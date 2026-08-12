'use strict';
/* hs-1.0 control: THE MACHINE SURFACE CARRIES THE RUN'S OWN VERDICT.
 *
 * Live 2026-08-12 (final-live-proofs-VERDICT.md, b1017 re-run, Proof-1
 * criterion-6 caveat): the Jul-7 day pull died athena-side with the named
 * terminal narration ("Athena did not show any readable appointment rows ...
 * Nothing was imported."), the resolved receipt said ok:false, the roster
 * receipt said no-provider-headers - and window.__mlsPullLastOutcome read
 * {ok:true} because runManagedAthenaOperation's resolve path stamped ok:true
 * on ANY resolve ("a receipt that can't fail"). The progress stage consumes
 * exactly that surface and told the doctor "Pull finished."
 *
 * This suite runs the REAL shipped wrapper (extracted from
 * feat_mls_schedimport_exact.js) and drives its real settle path with a
 * failure fixture shaped like the live incident. OLD BYTES FAIL CASE 1 BY
 * NAME: they stamp ok:true for a resolved terminal failure. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'latin1');

/* ---- balanced-brace extractor (string/comment aware; idiom shared with
 * loud-refusal-pull-receipt.test.js) ---- */
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

const wrapperSrc = extractBraced(si, 'function runManagedAthenaOperation(task, busyFactory) {');
assert.ok(wrapperSrc.indexOf('__mlsPullLastOutcome') >= 0,
  'the wrapper still owns the __mlsPullLastOutcome stamp (anchor drift check)');

/* hs-1.0 helper: present on new bytes. On old bytes the wrapper never
 * references it, so an inert fallback keeps the extraction from masking the
 * behavioral failure below (the point is that CASE 1 fails on old bytes at
 * the ok===false assertion, not at extraction). */
let helperSrc = 'function honestPullOutcome() { throw new Error("honestPullOutcome missing from shipped bytes"); }';
if (si.indexOf('function honestPullOutcome(') >= 0) {
  helperSrc = extractBraced(si, 'function honestPullOutcome(');
}

/* ---- build the REAL wrapper against a controlled environment ---- */
function buildWrapper(env) {
  const prelude =
    'var window = env.window;\n' +
    'var navigator = env.navigator;\n' +
    'var pullRunning = false;\n' +
    'var SI_LEASE_ID = "mls-si-test";\n' +
    'function safe(fn, d) { try { return fn(); } catch (e) { return d; } }\n' +
    'function isFn(f) { return typeof f === "function"; }\n' +
    'function foreignPullLease() { return env.foreignLease || null; }\n' +
    'function claimSiLease() {}\n' +
    'function releaseSiLease() {}\n' +
    'function releaseManagedAthenaWorkspace() {}\n';
  const f = new Function('env',
    prelude + helperSrc + '\n' + wrapperSrc + '\nreturn runManagedAthenaOperation;');
  return f(env);
}

function freshEnv(extra) {
  const store = {};
  const env = {
    window: {
      localStorage: {
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        getItem: (k) => (k in store ? store[k] : null)
      },
      uns: (k) => 'test::' + k
    },
    navigator: {},           /* no locks API -> operation = start() */
    foreignLease: null
  };
  return Object.assign(env, extra || {});
}

function assertRecentStamp(outcome, label) {
  assert.ok(outcome && typeof outcome === 'object', label + ': outcome stamped');
  assert.ok(typeof outcome.at === 'number' && Math.abs(Date.now() - outcome.at) < 60000,
    label + ': stamp carries a fresh at timestamp');
}

/* The live incident's receipt shape: pullUnlocked's fail() result for the
 * no-rows terminal (reason + narration + zeroed counts + a named failure). */
const LIVE_FAILURE_RECEIPT = {
  ok: false, complete: false, reason: 'no-read',
  error: 'Athena did not show any readable appointment rows - the schedule grid may still be loading, or athenaOne is signed out. Open the signed-in Day schedule and retry. Nothing was imported.',
  includeHistory: true, created: 0, repaired: 0, skipped: 0, failed: 0, failures: 1,
  target: '2026-07-07', retry: {}
};

(async function () {
  let n = 0;
  const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

  /* ---- 1. THE LIVE SEAM: a run that RESOLVES with a named terminal failure
   * must stamp ok:false + reason + narration + counts. Old bytes stamp
   * {ok:true} here - this is the assertion they fail. ---- */
  {
    const env = freshEnv();
    const wrap = buildWrapper(env);
    const value = await wrap(function () { return Promise.resolve(LIVE_FAILURE_RECEIPT); });
    assert.strictEqual(value, LIVE_FAILURE_RECEIPT, 'the settled value passes through unchanged');
    const o = env.window.__mlsPullLastOutcome;
    assertRecentStamp(o, 'terminal failure');
    assert.strictEqual(o.ok, false,
      'a resolved TERMINAL FAILURE must stamp ok:false (old shape: the wrapper stamped ok:true on ANY resolve - the b1017 live no-rows failure was recorded as a success)');
    assert.strictEqual(o.reason, 'no-read', 'the stamp names the terminal reason');
    assert.ok(String(o.error || '').indexOf('Nothing was imported') >= 0,
      'the stamp carries the narration the visible surfaces speak');
    assert.strictEqual(o.complete, false, 'the stamp carries the completeness verdict');
    assert.ok(o.counts && o.counts.failures === 1 && o.counts.created === 0,
      'the stamp carries the run counts (failures/created)');
    ok('resolved terminal failure stamps ok:false with reason, narration and counts (the b1017 {ok:true} seam is dead)');
  }

  /* ---- 2. a genuinely successful run still stamps ok:true ---- */
  {
    const env = freshEnv();
    const wrap = buildWrapper(env);
    const receipt = { ok: true, complete: true, reason: 'complete', created: 2, repaired: 1, skipped: 0, failed: 0 };
    const value = await wrap(function () { return Promise.resolve(receipt); });
    assert.strictEqual(value, receipt, 'success value passes through');
    const o = env.window.__mlsPullLastOutcome;
    assertRecentStamp(o, 'success');
    assert.strictEqual(o.ok, true, 'a run whose own verdict is success stamps ok:true');
    assert.strictEqual(o.reason, 'complete', 'the success stamp keeps the reason token');
    assert.ok(!('error' in o), 'a success stamp carries no error text');
    ok('honest success: ok:true only when the run\'s own verdict is success');
  }

  /* ---- 3. the reject path is unchanged: ok:false + error, and the promise
   * still rejects ---- */
  {
    const env = freshEnv();
    const wrap = buildWrapper(env);
    let threw = null;
    try { await wrap(function () { return Promise.reject(new Error('bridge exploded')); }); }
    catch (e) { threw = e; }
    assert.ok(threw && String(threw.message).indexOf('bridge exploded') >= 0, 'rejection propagates');
    const o = env.window.__mlsPullLastOutcome;
    assertRecentStamp(o, 'rejection');
    assert.strictEqual(o.ok, false, 'rejection stamps ok:false');
    assert.ok(String(o.error || '').indexOf('bridge exploded') >= 0, 'rejection stamp carries the error');
    ok('reject path preserved: ok:false + error, promise still rejects');
  }

  /* ---- 4. a receipt WITHOUT a verdict field (history-retry shape) is judged
   * by its own completeness contract ---- */
  {
    const env = freshEnv();
    const wrap = buildWrapper(env);
    await wrap(function () {
      return Promise.resolve({ requestId: 'hr1', requested: 3, processed: 1, complete: false, failures: 2, reason: 'history-partial', patients: [], retry: [] });
    });
    const bad = env.window.__mlsPullLastOutcome;
    assert.strictEqual(bad.ok, false, 'an incomplete retry receipt (failures>0) stamps ok:false');
    assert.strictEqual(bad.reason, 'history-partial', 'retry stamp names its reason');
    assert.ok(bad.counts && bad.counts.processed === 1 && bad.counts.failures === 2, 'retry stamp carries walk counts');

    await wrap(function () {
      return Promise.resolve({ requestId: 'hr2', requested: 2, processed: 2, complete: true, failures: 0, patients: [], retry: [] });
    });
    const good = env.window.__mlsPullLastOutcome;
    assert.strictEqual(good.ok, true, 'a complete zero-failure retry receipt stamps ok:true');
    ok('verdict-free receipts judged by their own completeness contract (complete AND zero failures)');
  }

  /* ---- 5. the lock-unavailable busy refusal resolves THROUGH the wrapper:
   * its ok:false receipt must reach the stamp too (old bytes also called
   * this one a success) ---- */
  {
    const env = freshEnv({
      navigator: { locks: { request: (name, opts, cb) => Promise.resolve(cb(null)) } }
    });
    const wrap = buildWrapper(env);
    const value = await wrap(
      function () { throw new Error('task must not start when the lock is held'); },
      function (scope) {
        return { ok: false, complete: false, reason: 'pull-in-flight',
          error: 'Another MLS tab is already running an explicit pull. Nothing else was started.', retry: {} };
      });
    assert.strictEqual(value.reason, 'pull-in-flight', 'busy receipt returned to the caller');
    const o = env.window.__mlsPullLastOutcome;
    assert.strictEqual(o.ok, false, 'a busy refusal resolving through the wrapper stamps ok:false');
    assert.strictEqual(o.reason, 'pull-in-flight', 'busy stamp names its gate reason');
    ok('other-tab busy refusal stamps ok:false through the same resolve path');
  }

  /* ---- 6. a verdict-free resolve (no receipt object) keeps the wrapper's
   * old contract: stamped, recent, ok:true ---- */
  {
    const env = freshEnv();
    const wrap = buildWrapper(env);
    await wrap(function () { return Promise.resolve(undefined); });
    const o = env.window.__mlsPullLastOutcome;
    assertRecentStamp(o, 'verdict-free');
    assert.strictEqual(o.ok, true, 'a resolve with no receipt keeps ok:true (nothing claims failure)');
    ok('verdict-free resolve keeps the old contract (stamped, ok:true)');
  }

  console.log('PASS pull-outcome honest stamp: the machine surface carries the run\'s own verdict - resolved terminal failures stamp ok:false with reason/narration/counts, successes stamp ok:true, rejects unchanged (' + n + ' cases)');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });

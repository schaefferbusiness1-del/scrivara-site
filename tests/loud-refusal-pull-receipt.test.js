'use strict';
/* lr-1.0 control: EVERY PULL REFUSAL IS LOUD.
 *
 * Diagnosis 2026-08-11 (handoff-2026-08-11/silent-refusal-DIAGNOSIS.md):
 * a 12.8s roster-gate refusal ran to completion and painted ZERO visible
 * pixels. Four stacked silencers, three of them pinned here:
 *   1. setS spoke into #heroPullStatus - a 0x0 element inside the RETIRED
 *      legacy hero - because its toast fall-through was gated on element
 *      ABSENCE instead of element VISIBILITY;
 *   2. the dayPull receipt was DISCARDED at the cv-handoff settle
 *      (.then(_cvDone,_cvDone) where _cvDone only re-enabled the button);
 *   3. the advisory in-flight gate (schedimport __dayPullInner) must return a
 *      named, visible refusal without overwriting the healthy RUNNING pull's
 *      evidence with the second click's non-terminal result.
 * This suite runs the REAL shipped functions (extracted from the served
 * bytes) and fails on every one of the three old shapes by name. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'latin1');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'latin1');

/* ---- balanced-brace extractor (string/comment aware; the known bodies keep
 * braces balanced inside regex literals, verified by the parse assert) ---- */
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

/* =========================================================================
 * PART 1: the cv-handoff (ScribeFlow pullScheduleViaAssist, guarded path)
 * ========================================================================= */
const psvaSrc = extractBraced(html, 'function pullScheduleViaAssist(');

function buildPsva(ctx) {
  const f = new Function('ctx',
    'var document = ctx.document;\n' +
    'var toast = ctx.toast;\n' +
    'var window = ctx.window;\n' +
    'var _acctTodayKey = ctx._acctTodayKey;\n' +
    psvaSrc + '\n' +
    'return pullScheduleViaAssist;');
  return f(ctx);
}

function heroStub(visible) {
  return {
    textContent: '',
    style: {},
    getBoundingClientRect() { return visible ? { width: 220, height: 18 } : { width: 0, height: 0 }; }
  };
}

const ROSTER_REFUSAL = {
  ok: false, complete: false, reason: 'provider-roster-incomplete',
  error: "Athena's full provider roster was not verified. Nothing was imported; keep the complete Day schedule open and retry."
};

(async function () {
  let n = 0;
  const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

  /* ---- 1a. hidden hero (the LIVE layout): narration AND refusal reach the
   * toast; the receipt survives the settle ---- */
  {
    const toasts = [];
    const hero = heroStub(false);
    const ctx = {
      document: { getElementById: id => (id === 'heroPullStatus' ? hero : null) },
      toast: (m, k) => { toasts.push({ m: String(m), k: String(k || '') }); },
      _acctTodayKey: () => '2026-08-11',
      window: {}
    };
    ctx.window.__mlsSI = {
      installed: true,
      dayPull: o => { o.onStatus('Opening the day in athenaOne before the pull...', ''); return Promise.resolve(ROSTER_REFUSAL); }
    };
    const psva = buildPsva(ctx);
    const res = await psva(null);
    assert.ok(toasts.some(t => t.m.indexOf('Opening the day in athenaOne') >= 0),
      'narration into an INVISIBLE #heroPullStatus falls through to toast (old shape: spoken into a 0x0 element, zero pixels)');
    assert.strictEqual(res, ROSTER_REFUSAL,
      'the dayPull receipt survives the settle (old shape: .then(_cvDone,_cvDone) resolved undefined - psva-settle undefined in the live probe)');
    const refusalToasts = toasts.filter(t => t.k === 'err' && t.m.indexOf('provider-roster-incomplete') >= 0);
    assert.ok(refusalToasts.length >= 1,
      'the refusal toast NAMES the gate verbatim (provider-roster-incomplete)');
    assert.ok(refusalToasts[0].m.indexOf('roster was not verified') >= 0,
      'the refusal toast carries the receipt error text, not a generic apology');
    ok('hidden hero: narration falls through, receipt kept, gate named verbatim');
  }

  /* ---- 1b. visible hero: narration stays on the line (no toast spam), the
   * refusal is ALWAYS loud (line AND toast) ---- */
  {
    const toasts = [];
    const hero = heroStub(true);
    const ctx = {
      document: { getElementById: id => (id === 'heroPullStatus' ? hero : null) },
      toast: (m, k) => { toasts.push({ m: String(m), k: String(k || '') }); },
      _acctTodayKey: () => '2026-08-11',
      window: {}
    };
    ctx.window.__mlsSI = {
      installed: true,
      dayPull: o => { o.onStatus('Re-reading the athenaOne Day schedule...', ''); return Promise.resolve(ROSTER_REFUSAL); }
    };
    const psva = buildPsva(ctx);
    await psva(null);
    assert.ok(!toasts.some(t => t.m.indexOf('Re-reading the athenaOne') >= 0),
      'narration does NOT toast while the status line is visible (no toast flood)');
    assert.ok(toasts.some(t => t.k === 'err' && t.m.indexOf('provider-roster-incomplete') >= 0),
      'a refusal is loud even when the line is visible');
    assert.ok(hero.textContent.indexOf('provider-roster-incomplete') >= 0,
      'the visible line carries the named refusal too');
    ok('visible hero: quiet narration, loud refusal on both surfaces');
  }

  /* ---- 1c. rejection path: an Error surfaces with its message ---- */
  {
    const toasts = [];
    const hero = heroStub(false);
    const ctx = {
      document: { getElementById: id => (id === 'heroPullStatus' ? hero : null) },
      toast: (m, k) => { toasts.push({ m: String(m), k: String(k || '') }); },
      _acctTodayKey: () => '2026-08-11',
      window: {}
    };
    ctx.window.__mlsSI = {
      installed: true,
      dayPull: () => Promise.reject(new Error('bridge-deadline-exceeded'))
    };
    const psva = buildPsva(ctx);
    const res = await psva(null);
    assert.ok(res instanceof Error && String(res.message).indexOf('bridge-deadline-exceeded') >= 0,
      'the rejection reason survives the settle');
    assert.ok(toasts.some(t => t.k === 'err' && t.m.indexOf('bridge-deadline-exceeded') >= 0),
      'a rejected dayPull toasts its reason');
    ok('rejection path is loud and keeps the error');
  }

  /* =======================================================================
   * PART 2: the advisory in-flight gate (schedimport __dayPullInner) returns
   * a NAMED, visible receipt while preserving the running pull's evidence
   * ======================================================================= */
  const innerSrc = extractBraced(si, 'function __dayPullInner(opts, __armPresence)');

  function buildInner(ctx) {
    const f = new Function('ctx',
      'var window = ctx.window;\n' +
      'var pullRunning = ctx.pullRunning;\n' +
      'var monthPullRunning = false;\n' +
      'var p1MonthForeignOwner = ctx.p1MonthForeignOwner || function () { return null; };\n' +
      'var lastPullResult = null;\n' +
      'var isFn = function (x) { return typeof x === "function"; };\n' +
      'var normDate = function (d) { d = String(d || ""); return /^\\d{4}-\\d{2}-\\d{2}$/.test(d) ? d : ""; };\n' +
      'var safe = function (fn, fb) { try { return fn(); } catch (e) { return fb; } };\n' +
      'var foreignPullLease = ctx.foreignPullLease;\n' +
      'var _dayPreflightDone = true;\n' +
      'var warmUpDay = ctx.warmUpDay;\n' +
      'var accountProviderRequest = function () { return "all"; };\n' +
      'var _resolveDayScope = function () { return { ok: true, provider: "all" }; };\n' +
      'var pull = ctx.pull;\n' +
      innerSrc + '\n' +
      'return { inner: __dayPullInner, getLastPullResult: function () { return lastPullResult; } };');
    return f(ctx);
  }

  /* ---- 2a. same-tab in-flight: named and spoken, but never allowed to
     replace the real running pull's eventual completion evidence ---- */
  {
    const said = [];
    const ctx = {
      window: {},
      pullRunning: true,
      foreignPullLease: () => null,
      warmUpDay: () => { ctx.warmed = true; return Promise.resolve({}); },
      pull: () => Promise.resolve({ ok: true, marker: 'engine-ran' })
    };
    const h = buildInner(ctx);
    const res = await h.inner({ date: '2026-08-12', onStatus: (m, k) => said.push({ m: String(m), k: String(k || '') }) }, null);
    assert.strictEqual(res.reason, 'pull-in-flight', 'reason preserved');
    assert.strictEqual(res.gate, 'advisory-in-flight',
      'the refusal NAMES its gate (old shape: an anonymous inline object)');
    assert.ok(typeof res.holder === 'string' && res.holder.length > 0,
      'the refusal names its holder');
    assert.ok(said.some(s => s.k === '' && s.m.indexOf('already running') >= 0),
      'the harmless second-click refusal is SPOKEN through onStatus without painting the running pull as failed');
    assert.strictEqual(h.getLastPullResult(), null,
      'a second click must not overwrite the running pull\'s lastPullResult evidence');
    assert.strictEqual(ctx.window.__mlsPullLastOutcome, undefined,
      'a second click must not overwrite the running pull\'s machine outcome stamp');
    assert.ok(!ctx.warmed, 'a refused pull never navigates (warm-up untouched)');
    ok('advisory gate (same tab): named, spoken, running evidence preserved, no navigation');
  }

  /* ---- 2b. foreign lease: the holder carries kind + age ---- */
  {
    const said = [];
    const lease = { id: 'mls-ez3-x', kind: 'ez3-today', at: Date.now() - 30000 };
    const ctx = {
      window: {},
      pullRunning: false,
      foreignPullLease: () => lease,
      warmUpDay: () => Promise.resolve({}),
      pull: () => Promise.resolve({ ok: true })
    };
    const h = buildInner(ctx);
    const res = await h.inner({ date: '2026-08-12', onStatus: (m, k) => said.push(String(m)) }, null);
    assert.strictEqual(res.reason, 'pull-in-flight', 'reason preserved');
    assert.ok(String(res.holder).indexOf('ez3-today') >= 0,
      'the holder names the lease KIND (which lane holds the tab)');
    assert.ok(/\d+s old/.test(String(res.holder)),
      'the holder names the lease AGE');
    ok('advisory gate (foreign lease): holder kind + age named');
  }

  console.log('# loud-refusal-pull-receipt: ' + n + ' groups passed');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });

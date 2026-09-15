'use strict';
/* statetruth-1.0.0 (2026-09-15) - WORKSTREAM 3, "state/progress truth": one
 * pull, one verdict, every surface repainted from the state that owns it.
 * Findings F1-F5 of AUDIT_STATE_TRUTH_2026-09-15.md (Opus read-only audit,
 * every claim re-read by hand before the fix; its one wrong claim - that
 * mls:pull-terminal has no listener - is not relied on here).
 *
 *  F1  the Pull Progress panel painted DONE when the engine ended the history
 *      batch, while the day strip still ran the convergence round; the next
 *      batch tore the card down. Now the card is HELD while the owning lane
 *      is busy, the convergence batch is a continuation, and the lane's own
 *      terminal event re-renders (30 min wall clock as the backstop).
 *  F2  a refused start (busyInFlight) returned without done(): the ceiling
 *      timer kept ticking on a run that never existed and, 75 minutes later,
 *      stopped whichever pull WAS running. Now that branch tears down.
 *  F3  the Calendar hero lane had no ceiling and no session-boundary
 *      terminal; a promise that never settled disabled the button forever.
 *  F4  syncStrip relabelled the pull button from a two-part predicate during
 *      the automatic convergence round. Now the same four-part one as status.
 *  F5  the relay terminal skipped four repaints and never held the busy lease.
 *
 * Part 1 pins the source. Part 2 EXECUTES the shipped Pull Progress panel and
 * the shipped Calendar hero lane in a VM with a minimal document. Synthetic
 * ids, no patient text.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.strictEqual(a, b, m + '\n   got: ' + JSON.stringify(a) + '\n   expected: ' + JSON.stringify(b)); };

/* ---- Part 1: source pins ---------------------------------------------- */
eq(connect.split('statetruth-1.0.0').length - 1, 16, 'every statetruth hunk is in the connect bundle');
ok(connect.includes("    if (!running && startedAt > 0 && !doneDismissed && laneIsBusy()) {"), 'F1: the DONE branch is held while the owning lane is busy');
ok(connect.includes("    if (newRun) {\n      /* statetruth-1.0.0: a convergence batch inside one held pull keeps the\n         clock, the maximum, the Stop request and the card it is painting. */\n      if (!continuation) {\n      startedAt = 0; watchedMaxTotal = 0; doneDismissed = false; stopRequested = false;"), 'F1: a continuation run keeps the clock and the card');
ok(connect.includes("window.addEventListener('mls:pull-terminal', function () { try { render(); } catch (eLr) {} }, false);"), 'F1: the lane terminal re-renders the panel');
ok(connect.includes("            closed = true;\n            dsCeilStop();\n            dsRunTeardown(dsRunHandle);\n            try { hideDsProgress(); } catch (eBusyBar) {}\n            DS.busyRefusalsTornDown = (DS.busyRefusalsTornDown || 0) + 1;\n            return;"), 'F2: the busyInFlight refusal tears its run down');
ok(connect.includes("      if (pb && !DS.pulling && !DS.retrying && DS.__autoRetrying !== true && !DS.preferenceGatePending) {\n        var desiredPull = "), 'F4: syncStrip uses the four-part idle predicate');
ok(connect.includes("        if (pb.disabled) pb.disabled = false;\n      }"), 'F4: an idle button is enabled');
ok(connect.includes("        dsLeaseHold(); /* statetruth-1.0.0 (F5)"), 'F5: the relay run holds the busy lease');
ok(connect.includes("          DS.pulling = false;\n          dsLeaseRelease();\n          if (sessionSerial !== DS.sessionSerial) return;\n          dsTerminalPullEpoch(dsRelayEpoch, ok === true);"), 'F5: relay teardown precedes the who-is-looking check; the terminal epoch stays behind the fence');
ok(connect.includes("          try { syncRetryControl(DS.lastResult); } catch (eRelRetry) {}\n          try { dsAttentionCacheClear(); syncAttentionControl(true); } catch (eRelAtt) {}\n          try { syncIdentityControl(); } catch (eRelId) {}\n          renderList();"), 'F5: the relay terminal repaints the four controls');
ok(connect.includes("  var HERO_CEIL_MS = 75 * 60 * 1000, HERO_CEIL_TICK_MS = 60 * 1000;"), 'F3: the hero lane has an absolute ceiling checked every minute');
ok(connect.includes("  try { window.addEventListener('mls:session-boundary', onHeroSessionBoundary, false); } catch (eHb) {}"), 'F3: the hero lane ends on a session boundary');
ok(connect.includes("    if (!isAutoRetry) { heroArc++; heroArcStartedAt = Date.now(); heroArmCeiling(el, heroArc); } /* statetruth-1.0.1: one ceiling per arc */"), 'F3: every manual press arms one ceiling for the whole arc (automatic retries continue it; the hero contract counts per-run timeouts)');
ok(connect.includes("    try { heroCeilTimer = setInterval(function () { heroCeilTick(el, arc); }, HERO_CEIL_TICK_MS); } catch (eHa) { heroCeilTimer = null; }"), 'F3: the ceiling is a 60 s interval, never a per-run timeout');
ok(connect.includes("    try { if (heroCeilTimer && typeof heroCeilTimer.unref === 'function') heroCeilTimer.unref(); } catch (eHu) {}"), 'F3: the interval never keeps a node harness alive');
ok(connect.includes("    heroCeilStop(); /* statetruth-1.0.0 (F3): the run settled on its own */"), 'F3: a settled run disarms it');

/* ---- Part 2a: the shipped Pull Progress panel, executed ----------------- */
function sliceIIFE(startMarker, endMarker) {
  const a = connect.indexOf(startMarker);
  assert(a > 0, 'missing ' + startMarker);
  const s = connect.lastIndexOf('(function () {', a);
  const e = connect.indexOf(endMarker, a);
  assert(s > 0 && e > s, 'could not bound the IIFE at ' + startMarker);
  return connect.slice(s, e + endMarker.length);
}
function fakeDom() {
  const nodes = {};
  const mk = (id) => ({ id, style: {}, innerHTML: '', textContent: '', value: '', disabled: false, children: [], childNodes: [], className: '', dataset: {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, appendChild(c) { this.children.push(c); this.childNodes.push(c); return c; }, insertBefore(c) { this.children.push(c); return c; }, remove() { delete nodes[this.id]; }, removeChild() {}, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; }, focus() {}, click() {}, parentNode: null });
  const doc = {
    getElementById: (id) => nodes[id] || null,
    createElement: (tag) => { const n = mk('_anon_' + Math.random().toString(36).slice(2)); n.tagName = String(tag).toUpperCase(); const orig = n.setAttribute; n.setAttribute = function (k, v) { if (k === 'id') { this.id = v; nodes[v] = this; } return orig.call(this, k, v); }; Object.defineProperty(n, 'id', { get() { return this._id; }, set(v) { this._id = v; if (v) nodes[v] = this; } }); n.id = ''; return n; },
    body: mk('body'), documentElement: mk('html'), head: mk('head'), querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, visibilityState: 'visible',
  };
  doc.body.appendChild = function (c) { this.children.push(c); if (c && c.id) nodes[c.id] = c; return c; };
  doc.head.appendChild = doc.body.appendChild;
  return { doc, nodes };
}
function bootPanel() {
  const src = sliceIIFE('MLS Scribe - PULL PROGRESS SCREEN  (__mlsPullProgress)', "window.__mlsPullProgress_revert = ");
  /* close the IIFE at the first '})();' after the revert publication */
  const full = connect.slice(connect.indexOf(src), connect.indexOf('\n})();', connect.indexOf(src) + src.length) + '\n})();'.length);
  const { doc, nodes } = fakeDom();
  const listeners = {};
  const ctx = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Error, Promise, clearTimeout, clearInterval,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (t.unref) t.unref(); return t; },
    setInterval: (f, ms) => { const t = setInterval(f, ms); t.unref(); return t; },
    document: doc, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    requestAnimationFrame: (f) => setTimeout(f, 0), navigator: { userAgent: 'node' }, location: { href: 'https://mlsscribe.com/1pScribeFlow.html' },
    __mlsDayHistoryPull: { state: null },
  };
  ctx.window = ctx;
  ctx.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  ctx.removeEventListener = (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); };
  ctx.dispatchEvent = (ev) => { (listeners[ev.type] || []).slice().forEach((fn) => fn(ev)); return true; };
  vm.runInNewContext(full, ctx, { filename: 'pull-progress.js' });
  assert(ctx.__mlsPullProgress, 'the Pull Progress panel did not install');
  return { ctx, nodes, listeners };
}
{
  const h = bootPanel();
  const api = h.ctx.__mlsPullProgress;
  ok(typeof api._render === 'function', 'the panel exposes its one-tick seam');
  const render = api._render;
  let laneBusy = false;
  h.ctx.__mlsDaySwitch = { isBusy: () => laneBusy };
  /* a run starts: the engine is running, the lane is busy */
  laneBusy = true;
  h.ctx.__mlsDayHistoryPull.state = { running: true, runId: 'run-1', total: 4, done: 1, rows: [{ ok: true }], startedAt: Date.now() };
  render();
  ok(!!h.nodes.mlsPullProgPanel || !!h.nodes.mlsPullProgFab || Object.keys(h.nodes).some((k) => /mlsPullProg/.test(k)), 'the running run painted something (' + Object.keys(h.nodes).filter((k) => /mlsPullProg/.test(k)).join(',') + ')');
  /* the engine ends the history batch, the lane keeps converging */
  h.ctx.__mlsDayHistoryPull.state = { running: false, runId: 'run-1', total: 4, done: 4, rows: [{ ok: true }, { ok: false }], startedAt: Date.now() };
  render();
  eq(api.laneHolds, 1, 'F1: the DONE card is held while the lane is busy');
  const doneNodeHeld = Object.values(h.nodes).some((n) => /saved/.test(String(n.textContent || n.innerHTML || '')) && /not saved/.test(String(n.textContent || n.innerHTML || '')));
  eq(doneNodeHeld, false, 'F1: no "N saved / N not saved" verdict is on screen during the hold');
  /* the convergence batch mints a new runId while the hold is on */
  h.ctx.__mlsDayHistoryPull.state = { running: true, runId: 'run-2', total: 1, done: 0, rows: [], startedAt: Date.now() };
  render();
  eq(api.laneHolds, 1, 'a continuation run is not a new hold');
  /* the lane finishes: engine idle, lane idle, terminal event fires */
  h.ctx.__mlsDayHistoryPull.state = { running: false, runId: 'run-2', total: 1, done: 1, rows: [{ ok: true }], startedAt: Date.now() };
  laneBusy = false;
  h.ctx.dispatchEvent(new h.ctx.CustomEvent('mls:pull-terminal', { detail: { ok: true } }));
  const doneNow = Object.values(h.nodes).some((n) => /saved/.test(String(n.textContent || n.innerHTML || '')));
  ok(doneNow, 'F1: once the lane is idle the terminal event paints the closing card');
}

/* ---- Part 2b: the shipped Calendar hero lane, executed ------------------ */
function bootHero() {
  const marker = connect.indexOf('window.__mlsCalHeroPull = {');
  assert(marker > 0, 'hero api marker missing');
  const start = connect.lastIndexOf('(function () {', connect.indexOf('  var HERO_CEIL_MS = 75 * 60 * 1000, HERO_CEIL_TICK_MS'));
  const end = connect.indexOf('\n})();', marker) + '\n})();'.length;
  const src = connect.slice(start, end);
  const { doc, nodes } = fakeDom();
  const listeners = {};
  let neverSettles = null;
  const ctx = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Error, Promise, clearTimeout, clearInterval,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (t.unref) t.unref(); return t; },
    setInterval: (f, ms) => { const t = setInterval(f, ms); t.unref(); return t; },
    document: doc, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    requestAnimationFrame: (f) => setTimeout(f, 0), navigator: { userAgent: 'node' }, location: { href: 'https://mlsscribe.com/1pScribeFlow.html' },
    __mlsSI: { dayPull: () => (neverSettles = new Promise(() => {})), stopPull: () => { ctx.stopPulls = (ctx.stopPulls || 0) + 1; } },
    toast: () => {},
  };
  ctx.window = ctx;
  ctx.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  ctx.removeEventListener = (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); };
  ctx.dispatchEvent = (ev) => { (listeners[ev.type] || []).slice().forEach((fn) => fn(ev)); return true; };
  vm.runInNewContext(src, ctx, { filename: 'cal-hero.js' });
  assert(ctx.__mlsCalHeroPull && ctx.__mlsCalHeroPull.installed, 'the Calendar hero lane did not install');
  return { ctx, nodes, listeners };
}
{
  const h = bootHero();
  const api = h.ctx.__mlsCalHeroPull;
  const el = h.ctx.document.createElement('button'); el.id = 'calHeroPullBtn';
  ok(typeof api.run === 'function', 'hero run entry');
  api.run(el, false, true);
  eq(api.busy(), true, 'F3: a run that never settles holds busy');
  eq(el.disabled, true, 'and the button is disabled while it runs');
  ok(String(h.ctx.__mlsCalPullDay || '') !== '', 'and the calendar day is pinned');
  /* the absolute ceiling, driven by hand (75 minutes is not a test budget) */
  eq(api._noSettle(), true, 'F3: the ceiling ends the run');
  eq(api.busy(), false, 'busy released');
  eq(el.disabled, false, 'button enabled');
  eq(String(h.ctx.__mlsCalPullDay || ''), '', 'calendar day unpinned');
  eq(h.ctx.stopPulls, 1, 'the engine was asked to stop');
  eq(api.terminals.ceiling, 1, 'counted');
  /* a second run, ended by the session boundary */
  api.run(el, false, true);
  eq(api.busy(), true, 'second run holds busy');
  h.ctx.dispatchEvent(new h.ctx.CustomEvent('mls:session-boundary', { detail: { reason: 'logout', nextAccount: '' } }));
  eq(api.busy(), false, 'F3: a session boundary ends the run');
  eq(el.disabled, false, 'button enabled after the boundary');
  eq(api.terminals.boundary, 1, 'counted');
  /* a boundary with no run in flight changes nothing and does not throw */
  h.ctx.dispatchEvent(new h.ctx.CustomEvent('mls:session-boundary', { detail: { reason: 'logout', nextAccount: '' } }));
  eq(api.terminals.boundary, 1, 'an idle lane ignores the boundary');
  /* a run that settles on its own is untouched by the ceiling machinery */
  h.ctx.__mlsSI.dayPull = () => Promise.resolve({ ok: true, complete: true, reason: 'complete', historyReceipt: { complete: true, retry: [] } });
  api.run(el, false, true);
  return new Promise((r) => setTimeout(r, 50)).then(() => {
    eq(api.busy(), false, 'a settled run releases busy on its own');
    eq(api.terminals.ceiling, 1, 'and never trips the ceiling');
    console.log('PASS statetruth-1.0.0: the Pull Progress card waits for the owning lane, a refused start tears down, the hero lane has a ceiling and a session-boundary terminal, the strip and the relay repaint from one predicate (' + checks + ' checks)');
  });
}

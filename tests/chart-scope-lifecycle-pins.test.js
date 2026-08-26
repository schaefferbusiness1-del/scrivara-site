'use strict';
/* scl-1.0.0 regression (Codex reply 31): the chart-work admission scope is a
 * LEASE. readFromAthena captures an opaque handle (counter + clock, never
 * clock-only) and compare-and-clears it on EVERY terminal - success, named
 * refusal, thrown/rejected read - so late background chatter 1-179 seconds
 * later cannot mint a new history job after the scoped read finished. ABA:
 * an old read's terminal can never clear a newer read's scope. Clearing
 * gates FUTURE admissions only - the open job finishes through its own
 * timer. The REAL readFromAthena is sliced from the shipped shell bytes and
 * executed; the post-clear reopen scenario runs on the real lb+ps modules. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');

/* ---- source pins: the lease exists and BOTH continuations release it ---- */
assert.strictEqual(shell.split('function releaseChartScope()').length - 1, 1, 'the lease release helper is gone');
assert.strictEqual(shell.split('releaseChartScope(); /* scl-1.0.0').length - 1, 2,
  'the release must run in BOTH terminal continuations (success/named-refusal AND thrown read)');
assert.ok(shell.includes("if (sc && sc.id === cfScopeId) window.__mlsChartWorkScopeV1 = null;"),
  'the release is no longer compare-and-clear (ABA protection lost)');
assert.ok(shell.includes("var cfScopeId = 'cfread-' + (++_cfScopeSerial) + '-' + Date.now().toString(36);"),
  'the scope id is no longer an opaque counter + clock');

/* ---- execute the REAL function with injected collaborators ---- */
const fnStart = shell.indexOf('  function readFromAthena(p, onStatus) {');
const fnEnd = shell.indexOf('\n  /* ======================================================== DOM RECONCILIATION', fnStart);
assert.ok(fnStart > 0 && fnEnd > fnStart, 'readFromAthena moved');
const prelude = "var _reading = ''; var _cfScopeSerial = 0;\n" +
  "function safe(fn, d) { try { return fn(); } catch (e) { return d; } }\n" +
  "function isFn(f) { return typeof f === 'function'; }\n" +
  "function str(v) { return String(v == null ? '' : v); }\n";
const makeRead = new Function('window', 'canRead',
  prelude + shell.slice(fnStart, fnEnd) + '\nreturn readFromAthena;');

function world(overrides) {
  const win = Object.assign({
    _assistReadChart: () => Promise.resolve({ requestId: 'r1' }),
    _athenaChartTextForParse: () => 'txt',
    _parsePatientChart: () => ({}),
    _athenaHistoryVerifiedRef: () => ({ verified: true }),
    _savePatientChart: () => true
  }, overrides || {});
  return { win, read: makeRead(win, () => true) };
}
const PATIENT = { id: 'p1', name: 'X', dob: 'd', mrn: 'm' };

(async () => {
  /* success: scope stamped during the read, cleared at the terminal */
  let w = world();
  const p1 = w.read(PATIENT, null);
  assert.ok(w.win.__mlsChartWorkScopeV1 && /^cfread-1-/.test(w.win.__mlsChartWorkScopeV1.id), 'the scoped read did not stamp its opaque handle');
  const r1 = await p1;
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(w.win.__mlsChartWorkScopeV1, null, 'a successful read left its scope armed');

  /* named refusal (parse-failed) clears too */
  w = world({ _parsePatientChart: () => null });
  const r2 = await w.read(PATIENT, null);
  assert.deepStrictEqual({ ok: r2.ok, reason: r2.reason }, { ok: false, reason: 'parse-failed' });
  assert.strictEqual(w.win.__mlsChartWorkScopeV1, null, 'a named refusal left its scope armed');

  /* identity refusal clears */
  w = world({ _athenaHistoryVerifiedRef: () => null });
  assert.strictEqual((await w.read(PATIENT, null)).reason, 'identity-unproven');
  assert.strictEqual(w.win.__mlsChartWorkScopeV1, null, 'an identity refusal left its scope armed');

  /* thrown/rejected read clears through the rejection continuation */
  w = world({ _assistReadChart: () => Promise.reject(new Error('bridge died')) });
  assert.strictEqual((await w.read(PATIENT, null)).reason, 'error');
  assert.strictEqual(w.win.__mlsChartWorkScopeV1, null, 'a rejected read left its scope armed');

  /* ABA: an old read's terminal cannot clear a newer scope B */
  let releaseGate;
  w = world({ _assistReadChart: () => new Promise(res => { releaseGate = () => res({ requestId: 'rA' }); }) });
  const slow = w.read(PATIENT, null);
  const scopeA = w.win.__mlsChartWorkScopeV1.id;
  w.win.__mlsChartWorkScopeV1 = { id: 'scope-B-newer', at: Date.now() }; /* scope B starts while A is in flight */
  releaseGate();
  await slow;
  assert.ok(w.win.__mlsChartWorkScopeV1 && w.win.__mlsChartWorkScopeV1.id === 'scope-B-newer',
    'an old completion cleared the NEWER scope (ABA violation): ' + JSON.stringify(w.win.__mlsChartWorkScopeV1));
  assert.notStrictEqual(scopeA, 'scope-B-newer');

  /* serials are opaque and increment per read within one shell */
  w = world();
  await w.read(PATIENT, null);
  const q = w.read(PATIENT, null);
  assert.ok(/^cfread-2-/.test(w.win.__mlsChartWorkScopeV1.id), 'the per-read serial did not advance');
  await q;

  /* ---- the reopen class, on the REAL lb+ps modules: after the lease clears,
     late background chatter inside the old 180s window mints nothing ---- */
  const lbSource = fs.readFileSync(path.join(root, 'feat_mls_loading_calm.js'), 'utf8');
  const psSource = fs.readFileSync(path.join(root, 'feat_mls_progress_stages.js'), 'utf8');
  const nodes = {}; const stored = {}; let nextTimer = 0; const listeners = {};
  function element(tag) { const kids = []; return { tagName: tag, id: '', style: {}, textContent: '', innerHTML: '', attributes: {}, classList: { add() {}, remove() {}, contains() { return false; } }, setAttribute(k, v) { this.attributes[k] = String(v); }, addEventListener() {}, appendChild(c) { kids.push(c); if (c.id) nodes[c.id] = c; return c; }, remove() { if (this.id) delete nodes[this.id]; }, querySelector() { return element('span'); } }; }
  const doc = { readyState: 'complete', head: element('head'), body: element('body'), documentElement: element('html'), getElementById: id => nodes[id] || null, createElement: t => element(t), createTextNode: t => ({ text: t }), createEvent: () => ({ initCustomEvent() {} }) };
  doc.head.appendChild = doc.body.appendChild = doc.documentElement.appendChild = function (el) { if (el.id) nodes[el.id] = el; return el; };
  const box = { now: 1000000000000 };
  const ctx = {
    console, Promise, Math, Array, Object, JSON, Number, String,
    Date: { now: () => box.now },
    crypto: { randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    document: doc,
    sessionStorage: { getItem: k => stored[k] ?? null, setItem(k, v) { stored[k] = String(v); } },
    localStorage: { getItem: k => stored[k] ?? null, setItem(k, v) { stored[k] = String(v); }, removeItem(k) { delete stored[k]; } },
    setTimeout() { return ++nextTimer; }, clearTimeout() {}, setInterval() { return ++nextTimer; }, clearInterval() {},
    fetch: () => Promise.resolve({ ok: true })
  };
  ctx.window = ctx;
  ctx.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f); };
  ctx.removeEventListener = () => {};
  ctx.dispatchEvent = ev => { (listeners[ev && ev.type] || []).forEach(f => f(ev)); };
  vm.createContext(ctx);
  vm.runInContext(lbSource, ctx, { filename: 'feat_mls_loading_calm.js' });
  vm.runInContext(psSource, ctx, { filename: 'feat_mls_progress_stages.js' });
  const lb = ctx.__mlsLoadingCalm, ps = ctx.__mlsProgressStages;
  const running = () => lb.snapshot().filter(j => j.status === 'running' || j.status === 'retrying').length;
  const chatter = () => ps._observe({ data: { source: 'mls-app', type: 'mlsAppReadChart', patient: { name: 'B' } } });

  /* fenced day-pull epoch (terminaled) so ONLY the scope admits */
  ctx.__mlsPullEpochV1 = { sessionSerial: '1', pullId: 'A', startedAt: box.now };
  ctx.__mlsPullBusyAt = box.now; ps._pullTick();
  ctx.__mlsPullBusyAt = 0;
  ctx.dispatchEvent({ type: 'mls:pull-terminal', detail: { sessionSerial: '1', pullId: 'A', ok: true, at: box.now } });
  assert.strictEqual(running(), 0);
  /* scoped read paints; its lease clears at the read terminal; job closes */
  ctx.__mlsChartWorkScopeV1 = { id: 'cfread-9-x', at: box.now };
  chatter();
  assert.strictEqual(running(), 1, 'the scoped read did not paint under the fenced epoch');
  ctx.__mlsChartWorkScopeV1 = null; /* what releaseChartScope() does at the terminal */
  const job = lb.snapshot().find(j => j.kind === 'history_pull' && j.status === 'running');
  lb.complete(job.id, 'done', job.requestId); /* the job's own quiet terminal */
  assert.strictEqual(running(), 0);
  /* late background chatter 1-179s later: the stale-scope window is GONE */
  for (const lateMs of [1000, 90000, 179000]) {
    box.now = 1000000000000 + lateMs;
    chatter();
    assert.strictEqual(running(), 0, 'late chatter at +' + lateMs + 'ms minted a job after the lease cleared');
  }
  /* scope B paints and finishes normally afterward */
  ctx.__mlsChartWorkScopeV1 = { id: 'cfread-10-y', at: box.now };
  chatter();
  assert.strictEqual(running(), 1, 'a fresh scope B could not paint after the clear');

  console.log('PASS chart-scope lifecycle (scl-1.0.0): the lease clears on success, named refusals, and thrown reads; an old terminal never clears a newer scope (ABA); after the clear, background chatter at +1s/+90s/+179s mints nothing while a fresh scope paints normally (real shell function + real lb+ps modules)');
})().catch(e => { console.error(e); process.exit(1); });

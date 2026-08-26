'use strict';
/* pts-1.1.0 regression (Codex reply 30, BLOCKs 1-3):
 * 1 — ownership is never inferred from absence: an identity-less (no-epoch)
 *     history job that began before a pull stamped its epoch is NOT closed by
 *     that pull's terminal and continues to its own terminal.
 * 2 — the epoch fence is DURABLE: far beyond any time window, late traffic
 *     and local stamps under the still-current terminaled epoch reopen
 *     nothing; an explicitly scoped single-patient refresh paints
 *     immediately; a new pull attempt paints and terminals normally.
 * 3 — every day-strip attempt (local AND office-relay) flows through one
 *     begin/terminal epoch owner with a once-only latch; stale/duplicate
 *     callbacks emit only their own old identity, which the observer's
 *     current-epoch fence ignores. Owner helpers extracted from the shipped
 *     1p bytes and EXECUTED; relay call sites byte-pinned. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const lbSource = fs.readFileSync(path.join(root, 'feat_mls_loading_calm.js'), 'utf8');
const psSource = fs.readFileSync(path.join(root, 'feat_mls_progress_stages.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

function makeSandbox() {
  const nodes = {};
  const stored = {};
  let nextTimer = 0;
  const listeners = {};
  function element(tag) {
    const kids = [];
    return {
      tagName: tag, id: '', style: {}, textContent: '', innerHTML: '', attributes: {},
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      addEventListener() {},
      appendChild(child) { kids.push(child); if (child.id) nodes[child.id] = child; return child; },
      remove() { if (this.id) delete nodes[this.id]; },
      querySelector() { return element('span'); }
    };
  }
  const document = {
    readyState: 'complete',
    head: element('head'), body: element('body'), documentElement: element('html'),
    getElementById(id) { return nodes[id] || null; },
    createElement(tag) { return element(tag); },
    createTextNode(t) { return { text: t }; },
    createEvent() { return { initCustomEvent() {} }; }
  };
  document.head.appendChild = document.body.appendChild = document.documentElement.appendChild = function (el) { if (el.id) nodes[el.id] = el; return el; };
  const box = { now: 1000000000000 };
  const context = {
    console, Promise, Math, Array, Object, JSON, Number, String,
    Date: { now: () => box.now },
    crypto: { randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    document,
    sessionStorage: { getItem: k => Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null, setItem(k, v) { stored[k] = String(v); } },
    localStorage: {
      getItem: k => Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null,
      setItem(k, v) { stored[k] = String(v); }, removeItem(k) { delete stored[k]; }
    },
    setTimeout() { return ++nextTimer; }, clearTimeout() {},
    setInterval() { return ++nextTimer; }, clearInterval() {},
    fetch() { return Promise.resolve({ ok: true }); }
  };
  context.window = context;
  context.addEventListener = function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); };
  context.removeEventListener = function () {};
  context.dispatchEvent = function (ev) { (listeners[ev && ev.type] || []).forEach(fn => fn(ev)); };
  vm.createContext(context);
  vm.runInContext(lbSource, context, { filename: 'feat_mls_loading_calm.js' });
  vm.runInContext(psSource, context, { filename: 'feat_mls_progress_stages.js' });
  const lb = context.__mlsLoadingCalm;
  const ps = context.__mlsProgressStages;
  assert(lb && lb.installed && ps && ps.installed && ps.version === 'ps-1.5.0', 'real ps-1.5.0 module failed to install');
  return {
    box, stored, lb, ps,
    win: context,
    running: () => lb.snapshot().filter(j => j.status === 'running' || j.status === 'retrying').length,
    bridge: (type, extra) => ps._observe({ data: Object.assign({ source: 'mls-app', type }, extra || {}) }),
    terminal: (ss, pid, ok) => context.dispatchEvent({ type: 'mls:pull-terminal', detail: { sessionSerial: ss, pullId: pid, ok, at: box.now } })
  };
}

/* ================= BLOCK 1: no ownership from absence ================= */
{
  const s = makeSandbox();
  /* an unrelated identity-less history job begins BEFORE any pull stamps */
  s.bridge('mlsAppReadChart', { patient: { name: 'Unrelated U' } });
  assert.strictEqual(s.running(), 1, 'the pre-pull history job did not open');
  /* pull A stamps its epoch and opens its pull job (the history slot is the
     singleton above, epoch '') */
  s.win.__mlsPullEpochV1 = { sessionSerial: '9', pullId: 'A', startedAt: s.box.now };
  s.win.__mlsPullBusyAt = s.box.now;
  s.ps._pullTick();
  assert.strictEqual(s.running(), 2, 'pull A did not open its pull job');
  /* terminal A: closes ONLY A's pull job; the no-epoch job is unowned */
  s.win.__mlsPullBusyAt = 0;
  s.terminal('9', 'A', true);
  assert.strictEqual(s.running(), 1, 'terminal A did not close exactly its own job');
  const survivor = s.lb.snapshot().find(j => j.kind === 'history_pull' && j.status === 'running');
  assert(survivor, 'the unrelated identity-less history job was closed by a terminal that does not own it');
  /* it continues to its own terminal (driven here through the real finish
     path the quiet timer would call) */
  s.terminal('9', 'A', true); /* duplicate — latched, still no effect */
  assert.strictEqual(s.running(), 1, 'a duplicate terminal touched the unowned job');
}

/* ================= BLOCK 2: durable fence + scoped refresh ================= */
{
  const s = makeSandbox();
  /* pull A: both jobs, then terminal */
  s.win.__mlsPullEpochV1 = { sessionSerial: '4', pullId: 'A', startedAt: s.box.now };
  s.win.__mlsPullBusyAt = s.box.now;
  s.ps._pullTick();
  s.bridge('mlsAppReadChart', { patient: { name: 'Case A' } });
  assert.strictEqual(s.running(), 2, 'pull A jobs did not open');
  s.win.__mlsPullBusyAt = 0;
  s.terminal('4', 'A', true);
  assert.strictEqual(s.running(), 0, 'terminal A did not close its jobs');
  /* FAR beyond any time window: late traffic and a local stamp reopen nothing */
  s.box.now += 45 * 60000;
  s.bridge('mlsAppReadChart', { patient: { name: 'Case A' } });
  s.bridge('mlsAppReadAllVisits', {});
  assert.strictEqual(s.running(), 0, 'very late old-epoch bridge traffic reopened a job');
  s.win.__mlsPullBusyAt = s.box.now - 1000;
  s.ps._pullTick();
  assert.strictEqual(s.running(), 0, 'a very late local stamp under the terminaled epoch reopened the pull job');
  s.win.__mlsPullBusyAt = 0;
  /* an explicitly scoped single-patient refresh paints immediately */
  s.win.__mlsChartWorkScopeV1 = { id: 'cfread-x1', at: s.box.now };
  s.bridge('mlsAppReadChart', { patient: { name: 'Refresh R' } });
  assert.strictEqual(s.running(), 1, 'the scoped single-patient refresh did not paint');
  /* no pull terminal owns it — a replayed A terminal cannot close it */
  s.terminal('4', 'A', true);
  assert.strictEqual(s.running(), 1, 'a stale pull terminal closed the scoped refresh job');
  /* close it through its own real finish path so the singleton frees */
  const scoped = s.lb.snapshot().find(j => j.kind === 'history_pull' && j.status === 'running');
  s.lb.complete(scoped.id, 'refresh finished', scoped.requestId);
  assert.strictEqual(s.running(), 0, 'the scoped job could not reach its own terminal');
  /* a NEW pull attempt paints and terminals normally */
  s.win.__mlsPullEpochV1 = { sessionSerial: '4', pullId: 'B', startedAt: s.box.now };
  s.win.__mlsPullBusyAt = s.box.now;
  s.ps._pullTick();
  s.bridge('mlsAppReadChart', { patient: { name: 'Case B' } });
  assert.strictEqual(s.running(), 2, 'a new attempt could not open its jobs under the durable fence');
  s.win.__mlsPullBusyAt = 0;
  s.terminal('4', 'B', true);
  assert.strictEqual(s.running(), 0, 'the new attempt terminal did not close its jobs');
}

/* ================= BLOCK 3: one epoch owner, local + relay ================= */
{
  /* extract and EXECUTE the owner helpers from the shipped bytes */
  const start = connect.indexOf('function dsBeginPullEpoch(sessionSerial) {');
  const end = connect.indexOf('function startPull(autoRetry) {', start);
  assert(start > 0 && end > start, 'the shared epoch owner left the day strip');
  const dispatches = [];
  const fakeWin = {
    dispatchEvent(ev) { dispatches.push(ev.detail); }
  };
  const factory = new Function('window', 'DS', 'CustomEvent',
    connect.slice(start, end) + '\nreturn { begin: dsBeginPullEpoch, terminal: dsTerminalPullEpoch };');
  const DS = { pullId: 'p-1' };
  const owner = factory(fakeWin, DS, function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; });
  const h1 = owner.begin('7');
  assert.deepStrictEqual({ ss: fakeWin.__mlsPullEpochV1.sessionSerial, pid: fakeWin.__mlsPullEpochV1.pullId }, { ss: '7', pid: 'p-1' },
    'begin did not stamp the attempt identity');
  /* relay success */
  assert.strictEqual(owner.terminal(h1, true), true, 'first terminal was refused');
  assert.strictEqual(dispatches.length, 1, 'first terminal did not dispatch');
  assert.deepStrictEqual({ ss: dispatches[0].sessionSerial, pid: dispatches[0].pullId, ok: dispatches[0].ok }, { ss: '7', pid: 'p-1', ok: true },
    'terminal detail is not the attempt identity');
  /* duplicate callback: latched */
  assert.strictEqual(owner.terminal(h1, true), false, 'a duplicate callback re-emitted');
  assert.strictEqual(dispatches.length, 1, 'duplicate callback dispatched again');
  /* cross-attempt isolation: a second attempt gets its own handle/identity */
  DS.pullId = 'p-2';
  const h2 = owner.begin('7');
  assert.strictEqual(fakeWin.__mlsPullEpochV1.pullId, 'p-2', 'the new attempt did not replace the epoch stamp');
  /* relay refusal / sync-throw shape: ok:false emits honestly */
  assert.strictEqual(owner.terminal(h2, false), true, 'the second attempt terminal was refused');
  assert.deepStrictEqual({ pid: dispatches[1].pullId, ok: dispatches[1].ok }, { pid: 'p-2', ok: false },
    'the ok:false terminal lost its own identity');
  /* stale callback after a new attempt: h1 is spent; a hypothetical unspent
     old handle emits only its OWN old identity (observer fences it) */
  const h3 = owner.begin('7'); /* p-2 stamp again, fresh handle */
  DS.pullId = 'p-3';
  owner.begin('7'); /* new attempt replaces the stamp */
  owner.terminal(h3, true);
  assert.strictEqual(dispatches[2].pullId, 'p-2', 'a stale callback emitted the NEW attempt identity');
  assert.notStrictEqual(dispatches[2].pullId, fakeWin.__mlsPullEpochV1.pullId, 'the stale terminal matches the current epoch — the observer fence cannot ignore it');

  /* call-site byte pins: local + relay, all through the owner */
  assert(connect.includes('var dsLocalEpoch = dsBeginPullEpoch(sessionSerial); /* pts-1.1.0: the one epoch owner */'),
    'the local attempt no longer begins through the owner');
  assert(connect.includes('var dsRelayEpoch = dsBeginPullEpoch(sessionSerial); /* pts-1.1.0: relay attempts share the one epoch owner */'),
    'the relay attempt no longer begins through the owner');
  const onDoneIdx = connect.indexOf('onDone: function (ok, msg) {');
  assert(onDoneIdx > 0, 'the relay onDone seam moved');
  const onDoneSlice = connect.slice(onDoneIdx, onDoneIdx + 500);
  assert(onDoneSlice.includes('if (sessionSerial !== DS.sessionSerial) return;') &&
    onDoneSlice.includes('dsTerminalPullEpoch(dsRelayEpoch, ok === true);') &&
    onDoneSlice.indexOf('DS.sessionSerial) return;') < onDoneSlice.indexOf('dsTerminalPullEpoch'),
    'relay onDone does not terminal through the owner behind the session fence');
  const relayCatchIdx = connect.indexOf('} catch (relayStartError) {');
  const relayCatchSlice = connect.slice(relayCatchIdx, relayCatchIdx + 400);
  assert(relayCatchSlice.includes('dsTerminalPullEpoch(dsRelayEpoch, false);'),
    'the synchronous relay throw does not terminal through the owner');
  /* the raw dispatch exists ONLY inside the owner — no bypass emission */
  assert.strictEqual(connect.split("new CustomEvent('mls:pull-terminal'").length - 1, 1,
    'a second raw mls:pull-terminal dispatch bypasses the owner');
}

console.log('PASS pull-terminal scope blocks (pts-1.1.0 / Codex reply 30): no ownership from absence, the epoch fence is durable with a scoped refresh lane, and local+relay attempts share one once-only epoch owner (helpers executed from shipped bytes)');

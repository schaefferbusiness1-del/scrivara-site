'use strict';
/* pts-1.0.0 regression (Codex reply 29): the stale "2 running" chip had two
 * heuristic observer jobs (history_pull from bridge traffic,
 * schedule_history_pull from the busy stamps) and no authoritative close.
 * The day-strip owner now emits ONE attempt-scoped 'mls:pull-terminal' from
 * its done() seam after convergence settles, and stamps __mlsPullEpochV1 at
 * pull start. This suite loads the REAL lb + ps modules and executes the
 * required scenario list: both jobs created under one epoch while chatter and
 * a foreign stale stamp persist; the scoped terminal closes both ONCE and the
 * active count reaches zero; late old-epoch traffic cannot recreate/reopen;
 * a new epoch starts normally; a foreign/stale terminal cannot close the
 * current job. Emitter wiring in the 1p day strip is byte-pinned. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const lbSource = fs.readFileSync(path.join(root, 'feat_mls_loading_calm.js'), 'utf8');
const psSource = fs.readFileSync(path.join(root, 'feat_mls_progress_stages.js'), 'utf8');
new Function(psSource); // syntax gate

/* ---------------- sandbox (same style as progress-stages-runtime) -------- */
function element(tag) {
  const classes = new Set();
  const children = {};
  const kids = [];
  return {
    tagName: tag, id: '', type: '', style: {}, textContent: '', innerHTML: '', attributes: {},
    classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); } },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    addEventListener() {},
    appendChild(child) { kids.push(child); if (child.id) nodes[child.id] = child; return child; },
    remove() { if (this.id) delete nodes[this.id]; },
    querySelector(sel) { if (!children[sel]) children[sel] = element('span'); return children[sel]; }
  };
}
const nodes = {};
const stored = {};
let nextTimer = 0;
const document = {
  readyState: 'complete',
  head: element('head'), body: element('body'), documentElement: element('html'),
  getElementById(id) { return nodes[id] || null; },
  createElement(tag) { return element(tag); },
  createTextNode(t) { return { text: t }; },
  createEvent() { return { initCustomEvent() {} }; }
};
document.head.appendChild = document.body.appendChild = document.documentElement.appendChild = function (el) { if (el.id) nodes[el.id] = el; return el; };

/* controllable clock so quarantine windows are deterministic */
let NOW = 1000000000000;
const listeners = {}; /* type -> [fn] — capture EVERY window listener type */
const context = {
  console, Promise, Math, Array, Object, JSON, Number, String,
  Date: { now: () => NOW },
  crypto: { randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() },
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
  document,
  sessionStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
    setItem(k, v) { stored[k] = String(v); }
  },
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
    setItem(k, v) { stored[k] = String(v); },
    removeItem(k) { delete stored[k]; }
  },
  setTimeout(fn, ms) { return ++nextTimer; }, /* timers never auto-fire: the seam must not need them */
  clearTimeout() {},
  setInterval() { return ++nextTimer; },
  clearInterval() {},
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
assert(lb && lb.installed, 'shared lb owner missing');
assert(ps && ps.installed && ps.version === 'ps-1.5.0', 'ps-1.5.0 (pts-1.1.0) module missing');
assert(typeof ps._pullTerminal === 'function', 'the scoped-terminal hook is not exposed');
assert(listeners['mls:pull-terminal'] && listeners['mls:pull-terminal'].length === 1, 'the mls:pull-terminal listener is not attached');

function running() { return lb.snapshot().filter(j => j.status === 'running' || j.status === 'retrying').length; }
function bridge(type, extra) { ps._observe({ data: Object.assign({ source: 'mls-app', type }, extra || {}) }); }
function bridgeResp(type, extra) { ps._observe({ data: Object.assign({ source: 'mls-extension', type }, extra || {}) }); }

/* ---- scenario: one exact pull epoch, both observer jobs, chatter + foreign stamp ---- */
context.__mlsPullEpochV1 = { sessionSerial: '7', pullId: 'pull-A', startedAt: NOW };
context.__mlsPullBusyAt = NOW;                    /* local busy stamp fresh */
stored.mlsPullBusyXTabV1 = String(NOW - 5000);    /* foreign/stale cross-tab stamp PRESENT */
ps._pullTick();                                   /* creates the schedule_history_pull job */
bridge('mlsAppReadChart', { patient: { name: 'Case A' } });  /* creates the history job */
bridge('mlsAppReadVisits', {});
bridgeResp('mlsAppReadVisitsResult', { resp: {} });
assert.strictEqual(running(), 2, 'both observer jobs should be active mid-pull (got ' + running() + ')');

/* keep emitting chatter; leave the foreign stamp fresh-ish; deliver the SCOPED terminal */
bridge('mlsAppReadAllVisits', {});
/* a foreign/different-session terminal must NOT close the current jobs */
context.dispatchEvent({ type: 'mls:pull-terminal', detail: { sessionSerial: '6', pullId: 'pull-OLD', ok: true, at: NOW } });
assert.strictEqual(running(), 2, 'a foreign/older-attempt terminal closed the current jobs');
/* identity-less terminals are ignored too */
context.dispatchEvent({ type: 'mls:pull-terminal', detail: { ok: true } });
assert.strictEqual(running(), 2, 'an identity-less terminal closed the current jobs');

/* the engine clears its local stamp on completion; the xtab stamp lingers (other tab / straggler) */
context.__mlsPullBusyAt = 0;
context.dispatchEvent({ type: 'mls:pull-terminal', detail: { sessionSerial: '7', pullId: 'pull-A', ok: true, at: NOW } });
assert.strictEqual(running(), 0, 'the scoped terminal did not close both jobs (active=' + running() + ')');
const afterTerminal = lb.snapshot().length;

/* delivering the SAME terminal again is a no-op (once only) */
context.dispatchEvent({ type: 'mls:pull-terminal', detail: { sessionSerial: '7', pullId: 'pull-A', ok: true, at: NOW } });
assert.strictEqual(lb.snapshot().length, afterTerminal, 'a duplicate terminal minted extra terminal jobs');

/* late old-epoch traffic cannot recreate/reopen either job */
NOW += 4000;
bridge('mlsAppReadChart', { patient: { name: 'Case A' } });
bridgeResp('mlsAppReadAllVisitsResult', { resp: {} });
assert.strictEqual(running(), 0, 'late old-epoch bridge traffic reopened the history job');
context.__mlsPullBusyAt = NOW - 2000; /* a straggler local stamp write from the closed attempt */
ps._pullTick();
assert.strictEqual(running(), 0, 'a late same-epoch local stamp reopened the pull job');

/* a genuinely foreign tab's xtab stamp still renders (fallback heuristics kept) */
context.__mlsPullBusyAt = 0;
stored.mlsPullBusyXTabV1 = String(NOW);
ps._pullTick();
assert.strictEqual(running(), 1, 'a foreign-tab xtab stamp no longer renders the shared chip');
/* close it again via its own heuristic path: stamp vanishes, no recent outcome */
delete stored.mlsPullBusyXTabV1;
ps._pullTick();
assert.strictEqual(running(), 0, 'the foreign-tab chip did not close when its stamp vanished');

/* a NEW epoch starts normally — creation resumes immediately */
context.__mlsPullEpochV1 = { sessionSerial: '7', pullId: 'pull-B', startedAt: NOW };
context.__mlsPullBusyAt = NOW;
ps._pullTick();
bridge('mlsAppReadChart', { patient: { name: 'Case B' } });
assert.strictEqual(running(), 2, 'a new pull epoch could not start its observer jobs');
/* and ITS scoped terminal closes them */
context.__mlsPullBusyAt = 0;
context.dispatchEvent({ type: 'mls:pull-terminal', detail: { sessionSerial: '7', pullId: 'pull-B', ok: false, at: NOW } });
assert.strictEqual(running(), 0, 'the second epoch terminal did not close its jobs');
const failed = lb.snapshot().find(j => j.kind === 'schedule_history_pull' && j.status === 'failed');
assert(failed, 'an ok:false terminal did not record an honest failed pull job');

/* pts-1.1.0 durable fence: however late, unscoped traffic under the
   terminaled epoch reopens nothing; the explicit chart-work scope paints */
NOW += 61000;
bridge('mlsAppReadChart', { patient: { name: 'Refresh C' } });
assert.strictEqual(running(), 0, 'unscoped late traffic reopened a job after the old quarantine window');
context.__mlsChartWorkScopeV1 = { id: 'cfread-test', at: NOW };
bridge('mlsAppReadChart', { patient: { name: 'Refresh C' } });
assert.strictEqual(running(), 1, 'the scoped single-patient refresh no longer paints a chip');

/* ---- emitter byte pins: the shared epoch owner (pts-1.1.0) ---- */
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const ownerIdx = connect.indexOf('function dsBeginPullEpoch(sessionSerial) {');
const termIdx = connect.indexOf('function dsTerminalPullEpoch(handle, ok) {');
assert(ownerIdx > 0 && termIdx > ownerIdx, 'the shared day-strip epoch owner is gone');
const ownerSlice = connect.slice(ownerIdx, termIdx + 700);
assert(ownerSlice.includes("window.__mlsPullEpochV1 = { sessionSerial: handle.sessionSerial, pullId: handle.pullId, startedAt: Date.now() }"),
  'begin no longer stamps the attempt identity');
assert(ownerSlice.includes('if (!handle || handle.emitted) return false;') && ownerSlice.includes('handle.emitted = true;'),
  'the once-only emitted latch left the terminal owner');
assert(ownerSlice.includes("sessionSerial: handle.sessionSerial, pullId: handle.pullId, ok: ok === true, at: Date.now()"),
  'the terminal detail lost its PHI-free attempt-scoped shape');
assert(!/detail:\s*\{[^}]*msg/.test(ownerSlice), 'the terminal detail must never carry message text');
const doneIdx = connect.indexOf('function done(ok, msg, keepStatus, signinRequired) {');
assert(doneIdx > 0, 'the day-strip done() seam moved');
const doneSlice = connect.slice(doneIdx, doneIdx + 900);
assert(doneSlice.includes("if (closed) return; closed = true;") &&
  doneSlice.includes('dsTerminalPullEpoch(dsLocalEpoch, ok === true);') &&
  doneSlice.indexOf('closed = true;') < doneSlice.indexOf('dsTerminalPullEpoch'),
  'done() no longer terminals through the shared owner inside its closed latch');

console.log('PASS pull-terminal seam (pts-1.1.0): scoped attempt terminal closes both observer jobs once, foreign/stale/identity-less terminals are fenced, the epoch fence is durable, the chart-work scope paints, foreign-tab stamps still render, a new epoch starts normally, and the day strip emits through the shared epoch owner');

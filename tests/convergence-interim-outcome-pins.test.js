'use strict';
/* cvi-1.0.0 regression (Codex reply 24): no global complete:true while a
 * convergence phase is active. The day strip stamps a truthful interim
 * ({ok:false, interim:true, phase:'converging', complete:false}) BEFORE each
 * dsAutoConvergeBodies call, and restores the day's own verdict VERBATIM
 * (never upgraded - the b752 subset rule) with a convergence appendix, once,
 * when the retry set is empty or explicitly terminal. The progress observer's
 * stamp-vanished fallback treats a recent interim as "still working", never a
 * terminal. Byte pins on the 1p day strip; the observer path is EXECUTED
 * against the real lb+ps modules. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

/* ---- byte pins: both converge sites stamp interim first, final once ---- */
const INTERIM = "window.__mlsPullLastOutcome = { ok: false, interim: true, phase: 'converging', complete: false, remaining:";
assert.strictEqual(connect.split(INTERIM).length - 1, 2,
  'both converge sites (main + navVetoed) must stamp the truthful interim');
for (const idx of [connect.indexOf(INTERIM), connect.indexOf(INTERIM, connect.indexOf(INTERIM) + 1)]) {
  const callIdx = connect.indexOf('dsAutoConvergeBodies(sessionSerial,', idx);
  assert(callIdx > idx && callIdx - idx < 700, 'the interim stamp does not immediately precede its converge call');
}
assert.strictEqual(connect.split('delete cvFinal.interim; delete cvFinal.phase;').length - 1, 1,
  'the main converge settle must clear the interim marks exactly once');
assert.strictEqual(connect.split('delete cvNavFinal.interim; delete cvNavFinal.phase;').length - 1, 1,
  'the navVetoed converge settle must clear the interim marks exactly once');
/* the final stamp restores the PRIOR verdict verbatim (JSON round-trip), never recomputes it */
assert(connect.includes("var cvFinal = (cvPrior && typeof cvPrior === 'object') ? JSON.parse(JSON.stringify(cvPrior)) : { ok: outcome.ok === true };"),
  'the main settle no longer restores the day verdict verbatim');
assert(connect.includes("cvFinal.convergence = { rounds: cvRounds, retried: cvItems, remaining: remaining };"),
  'the main settle lost its convergence appendix');
assert(connect.includes("cvNavFinal.convergence = { retried: retryCount, remaining: navRemaining };"),
  'the navVetoed settle lost its convergence appendix');
/* the final stamp lands BEFORE done() so the scoped pull-terminal (pts-1.0.0)
   never races a stale interim */
const mainSettle = connect.indexOf('cvFinal.convergence =');
const mainDone = connect.indexOf('done(outcome.ok, outcome.message + cvNote,', mainSettle);
assert(mainSettle > 0 && mainDone > mainSettle && mainDone - mainSettle < 400,
  'the final stamp must land in the settle continuation before done()');

/* ---- executed: the observer treats a recent interim as alive ---- */
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
const nodes = {};
const stored = {};
let nextTimer = 0;
let NOW = 1000000000000;
const listeners = {};
const document = {
  readyState: 'complete',
  head: element('head'), body: element('body'), documentElement: element('html'),
  getElementById(id) { return nodes[id] || null; },
  createElement(tag) { return element(tag); },
  createTextNode(t) { return { text: t }; },
  createEvent() { return { initCustomEvent() {} }; }
};
document.head.appendChild = document.body.appendChild = document.documentElement.appendChild = function (el) { if (el.id) nodes[el.id] = el; return el; };
const context = {
  console, Promise, Math, Array, Object, JSON, Number, String,
  Date: { now: () => NOW },
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
vm.runInContext(fs.readFileSync(path.join(root, 'feat_mls_loading_calm.js'), 'utf8'), context, { filename: 'feat_mls_loading_calm.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'feat_mls_progress_stages.js'), 'utf8'), context, { filename: 'feat_mls_progress_stages.js' });
const lb = context.__mlsLoadingCalm;
const ps = context.__mlsProgressStages;
assert(lb && lb.installed && ps && ps.installed, 'real modules failed to install');
const running = () => lb.snapshot().filter(j => j.status === 'running' || j.status === 'retrying').length;

/* a pull job is alive on a fresh local stamp */
context.__mlsPullEpochV1 = { sessionSerial: '3', pullId: 'pull-X', startedAt: NOW };
context.__mlsPullBusyAt = NOW;
ps._pullTick();
assert.strictEqual(running(), 1, 'the pull job did not open');

/* stamps vanish mid-convergence (round gap) while the INTERIM stamp is recent:
   the fallback must keep the job alive - neither "Pull finished." nor a fail */
context.__mlsPullBusyAt = 0;
context.__mlsPullLastOutcome = { ok: false, interim: true, phase: 'converging', complete: false, remaining: 5, at: NOW };
NOW += 4000;
ps._pullTick();
assert.strictEqual(running(), 1, 'a recent interim stamp was treated as a terminal');
const live = lb.snapshot().find(j => j.kind === 'schedule_history_pull' && j.status === 'running');
assert(live && /second read/i.test(String(live.operation || '')), 'the interim tick did not say what the engine is doing');

/* the FINAL stamp (interim cleared, day verdict restored) closes it complete */
context.__mlsPullLastOutcome = { ok: true, complete: true, convergence: { rounds: 1, retried: 5, remaining: 0 }, at: NOW };
NOW += 1000;
ps._pullTick();
assert.strictEqual(running(), 0, 'the restored final verdict did not close the job');
assert(lb.snapshot().some(j => j.kind === 'schedule_history_pull' && j.status === 'completed'),
  'the final ok:true verdict did not record a completed job');

console.log('PASS convergence interim outcome (cvi-1.0.0): both converge sites stamp a truthful interim before the lane runs, the day verdict returns verbatim with a convergence appendix once at settle, and the observer keeps the chip alive on a recent interim instead of minting a false terminal');

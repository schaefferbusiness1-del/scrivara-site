'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_recentpts.js'), 'utf8');

assert(source.includes("var VERSION='rp-2.4.0'"), 'Recent Patients identity-safe version missing');
assert(!/\bsetInterval\s*\(/.test(source), 'Recent Patients retained permanent roster polling');
assert(!source.includes('window.renderPatientBar=function'), 'Recent Patients still wraps the broad patient-bar renderer');
assert(source.includes("typeof window.selectPatient==='function'"), 'recent-chart clicks bypass canonical patient selection');
assert(source.includes("typeof window.showView==='function')window.showView('patients')"),
  'recent-chart clicks can leave a stale visit card under the newly selected patient');
assert(source.includes("listen(window,'mls:patient-record-updated',exactRecord)"), 'exact patient-row event missing');
assert(source.includes("listen(document,'visibilitychange',onVisibility)"), 'hidden/visible lifecycle missing');

const all = [];
function element(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), id: '', className: '', children: [], parentNode: null,
    style: {}, offsetParent: {}, disabled: false, _html: '', _button: null, _handlers: Object.create(null),
    appendChild(child) { if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(x => x !== child); child.parentNode = this; this.children.push(child); return child; },
    insertBefore(child, ref) { if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(x => x !== child); child.parentNode = this; const at = this.children.indexOf(ref); if (at >= 0) this.children.splice(at, 0, child); else this.children.push(child); return child; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); this.parentNode = null; },
    querySelector(selector) { if (selector === '.mlsctx-actions') return this._actions || null; if (selector === '.mrp-btn') return this._button; return null; },
    querySelectorAll() { return []; },
    addEventListener(name, fn) { this._handlers[name] = fn; }, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, bottom: 20 }; }, contains() { return false; },
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = String(value); if (this._html.includes('mrp-btn')) { const btn = element('button'); btn.className = 'mrp-btn'; btn.disabled = this._html.includes(' disabled'); this._button = btn; } else this._button = null; }
  };
  all.push(el);
  return el;
}

const head = element('head');
const body = element('body');
const bar = element('div'); bar.id = 'mlsCtxBar'; body.appendChild(bar);
const actions = element('span'); actions.className = 'mlsctx-actions'; bar.appendChild(actions); bar._actions = actions;
const windowHandlers = Object.create(null);
const documentHandlers = Object.create(null);
const timers = [];
const idleJobs = [];
let timerId = 0;
function addHandler(bucket, name, fn) { (bucket[name] || (bucket[name] = [])).push(fn); }
function removeHandler(bucket, name, fn) { if (bucket[name]) bucket[name] = bucket[name].filter(value => value !== fn); }
function fire(bucket, name, event) { for (const fn of (bucket[name] || []).slice()) fn(event || {}); }
function setTimeoutFake(fn) { const job = { id: ++timerId, fn, live: true }; timers.push(job); return job.id; }
function clearTimeoutFake(id) { const job = timers.find(value => value.id === id); if (job) job.live = false; }
function flushTimers() { let guard = 100; while (timers.length && guard--) { const batch = timers.splice(0); for (const job of batch) if (job.live) job.fn(); } assert(guard > 0, 'timer queue did not settle'); }
function requestIdleCallbackFake(fn) { const job = { id: ++timerId, fn, live: true }; idleJobs.push(job); return job.id; }
function cancelIdleCallbackFake(id) { const job = idleJobs.find(value => value.id === id); if (job) job.live = false; }
function flushIdle() { const batch = idleJobs.splice(0); for (const job of batch) if (job.live) job.fn({ didTimeout: false, timeRemaining: () => 20 }); }

const document = {
  readyState: 'complete', hidden: false, visibilityState: 'visible', head, body,
  getElementById(id) { return all.find(node => node.id === id && node.parentNode) || null; },
  createElement: element, querySelector() { return null; }, querySelectorAll() { return []; },
  addEventListener(name, fn) { addHandler(documentHandlers, name, fn); },
  removeEventListener(name, fn) { removeHandler(documentHandlers, name, fn); }
};
const storage = new Map([['recent_pts', JSON.stringify(['P1', 'P2'])]]);
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); }, removeItem(key) { storage.delete(key); }
};
let activeId = 'P1';
let patientReads = 0;
let intervalStarts = 0;
let patients = [
  { id: 'P1', name: 'Alpha Patient', dob: '1980-01-01' },
  { id: 'P2', name: 'Beta Patient', dob: '1981-02-02' }
];
function originalRenderPatientBar() {}
const context = {
  console, document, localStorage, innerWidth: 1280,
  getComputedStyle() { return { display: 'flex' }; },
  MutationObserver: class { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} },
  setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
  requestIdleCallback: requestIdleCallbackFake, cancelIdleCallback: cancelIdleCallbackFake,
  setInterval() { intervalStarts++; return 1; }, clearInterval() {},
  addEventListener(name, fn) { addHandler(windowHandlers, name, fn); },
  removeEventListener(name, fn) { removeHandler(windowHandlers, name, fn); },
  uns(value) { return value; }, getActivePtId() { return activeId; },
  getPatients() { patientReads++; return patients; }, renderPatientBar: originalRenderPatientBar
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'feat_mls_recentpts.js' });
flushTimers();

const api = context.__mlsRecentPts;
assert(api && api.__booted, 'Recent Patients did not install');
assert.strictEqual(intervalStarts, 0, 'Recent Patients started a heartbeat');
assert.strictEqual(context.renderPatientBar, originalRenderPatientBar, 'broad patient-bar renderer was wrapped');
assert.strictEqual(patientReads, 0, 'boot decoded the roster in the first-click timer lane');
assert(idleJobs.some(job => job.live), 'boot did not defer its first roster refresh to genuine idle time');
flushIdle();
assert.strictEqual(patientReads, 1, 'boot idle reconciliation did not perform one visible roster refresh');
assert(document.getElementById('mlsRecentPts'), 'Recent chip did not mount');
assert(document.getElementById('mlsRecentPts').innerHTML.includes('Recent (1)'), 'visible chip count changed');

patientReads = 0;
for (let i = 0; i < 1000; i++) fire(windowHandlers, 'mls:view-changed', { detail: { view: i % 2 ? 'visit' : 'day' } });
flushTimers();
assert.strictEqual(patientReads, 0, 'route changes cold-scanned the patient roster');

bar.offsetParent = null;
fire(windowHandlers, 'mls:view-changed', { detail: { view: 'settings' } });
flushTimers();
assert.strictEqual(document.getElementById('mlsRecentPts'), null, 'chip remained mounted without a visible patient bar');
bar.offsetParent = {};
fire(windowHandlers, 'mls:view-changed', { detail: { view: 'visit' } });
flushTimers();
assert.strictEqual(patientReads, 0, 'returning route cold-scanned the patient roster');
assert(document.getElementById('mlsRecentPts').innerHTML.includes('Recent (1)'),
  'route remount lost the last committed Recent UI');

for (let i = 0; i < 1000; i++) fire(windowHandlers, 'storage', { key: 'patients', storageArea: localStorage });
flushTimers();
assert.strictEqual(patientReads, 0, 'broad cross-tab patient writes cold-scanned the roster');
assert.strictEqual(idleJobs.filter(job => job.live).length, 1,
  'broad cross-tab patient writes did not coalesce one idle rename/delete reconciliation');

/* A remote patient write invalidates the app's decoded roster cache before its
 * activePt write arrives. The exact binding must repaint from cached metadata,
 * never descend into getPatients() on the 40ms interaction lane. */
activeId = 'P3';
patients = patients.concat({ id: 'P3', name: 'Gamma Patient', dob: '1982-03-03' });
fire(windowHandlers, 'storage', { key: 'patients', storageArea: localStorage });
fire(windowHandlers, 'storage', { key: 'activePt', storageArea: localStorage });
flushTimers();
assert.strictEqual(patientReads, 0, 'patients invalidation + visible activePt decoded before genuine idle time');
assert(idleJobs.some(job => job.live), 'cross-tab activePt did not defer reconciliation to requestIdleCallback');
flushIdle();
assert.strictEqual(patientReads, 1, 'idle reconciliation did not perform exactly one fresh roster read');
patientReads = 0;

document.hidden = true; document.visibilityState = 'hidden';
activeId = 'P4';
patients = patients.concat({ id: 'P4', name: 'Delta Patient', dob: '1983-04-04' });
fire(windowHandlers, 'mls:active-patient-changed', { detail: { patientId: 'P4' } });
flushTimers();
assert.strictEqual(patientReads, 0, 'hidden active-patient event decoded the roster');
assert.strictEqual(JSON.parse(storage.get('recent_pts'))[0], 'P4', 'hidden exact patient event did not retain the recent ID');

document.hidden = false; document.visibilityState = 'visible';
for (let i = 0; i < 100; i++) fire(documentHandlers, 'visibilitychange', {});
flushTimers();
assert.strictEqual(patientReads, 0, 'tab return decoded the roster in the first-click timer lane');
assert.strictEqual(idleJobs.filter(job => job.live).length, 1, 'tab return did not coalesce hidden work to one idle refresh');
flushIdle();
assert.strictEqual(patientReads, 1, 'tab-return idle reconciliation did not perform one roster refresh');
assert(document.getElementById('mlsRecentPts').innerHTML.includes('Recent (3)'), 'visible reconciliation changed the recent count');

patientReads = 0;
for (let i = 0; i < 100; i++) fire(windowHandlers, 'mls:patient-record-updated', {
  detail: { patientId: 'NOT-RECENT', patientStoreKey: 'patients' }
});
flushTimers();
assert.strictEqual(patientReads, 0, 'unrelated exact row updates scanned the roster');

for (let i = 0; i < 100; i++) fire(windowHandlers, 'mls:patient-record-updated', {
  detail: { patientId: 'P2', patientStoreKey: 'patients' }
});
flushTimers();
assert.strictEqual(patientReads, 1, 'relevant exact row updates did not coalesce');

patientReads = 0;
api.rerender();
assert.strictEqual(patientReads, 1, 'public rerender lost its explicit full-refresh compatibility');

fire(windowHandlers, 'mls:patient-record-updated', { detail: { patientId: 'P2', patientStoreKey: 'patients' } });
assert(timers.some(job => job.live), 'exact refresh did not queue before revert test');
api.revert();
flushTimers();
assert.strictEqual(context.__mlsRecentPts, undefined, 'revert did not remove the public API');
assert.strictEqual(document.getElementById('mlsRecentPts'), null, 'revert did not remove the chip');
assert.strictEqual((windowHandlers['mls:view-changed'] || []).length, 0, 'revert leaked route listeners');
assert.strictEqual((documentHandlers.visibilitychange || []).length, 0, 'revert leaked visibility listeners');

console.log('PASS Recent Patients is exact-event driven: zero heartbeat, zero route/broad-storage scans, hidden deferral, coalesced visible refresh, and complete revert');

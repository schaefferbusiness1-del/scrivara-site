'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_patient_context_safety.js'), 'utf8');

function eventTarget(target) {
  const listeners = Object.create(null);
  target.addEventListener = function (name, fn) {
    (listeners[name] || (listeners[name] = [])).push(fn);
  };
  target.removeEventListener = function (name, fn) {
    listeners[name] = (listeners[name] || []).filter(item => item !== fn);
  };
  target.emit = function (name, event) {
    (listeners[name] || []).slice().forEach(fn => fn(event || { type: name }));
  };
  target.listenerCount = name => (listeners[name] || []).length;
  return target;
}

function timerQueue() {
  let nextId = 0;
  const pending = new Map();
  return {
    setTimeout(fn) { const id = ++nextId; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
    runOne() {
      const entry = pending.entries().next();
      if (entry.done) return false;
      const [id, fn] = entry.value;
      pending.delete(id);
      fn();
      return true;
    },
    get pendingCount() { return pending.size; }
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

function domNode(nodes, id) {
  const attrs = Object.create(null);
  const node = {
    id: id || '', parentNode: null, innerHTML: '', className: '', children: [],
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) nodes[child.id] = child;
      return child;
    },
    insertBefore(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) nodes[child.id] = child;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter(item => item !== child);
      if (child.id) delete nodes[child.id];
      child.parentNode = null;
      return child;
    }
  };
  if (node.id) nodes[node.id] = node;
  return node;
}

const clock = timerQueue();
const localStorage = memoryStorage();
const nodes = Object.create(null);
const head = domNode(nodes, 'head');
const threadParent = domNode(nodes, 'thread-parent');
const thread = domNode(nodes, 'copilotThread');
thread.parentNode = threadParent;
threadParent.children.push(thread);

const document = eventTarget({
  readyState: 'complete', head, documentElement: head,
  querySelector() { return null; },
  getElementById(id) { return nodes[id] || null; },
  createElement() { return domNode(nodes, ''); },
  createTextNode(text) { return { textContent: String(text), parentNode: null }; }
});
const location = { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' };
let activeId = 'patient-a';
let rosterDecodes = 0;
const patients = [
  { id: 'patient-a', name: 'Patient A', dob: '01/01/1980' },
  { id: 'patient-b', name: 'Patient B', dob: '02/02/1980' },
  { id: 'patient-c', name: 'Patient C', dob: '03/03/1980' }
];
const window = eventTarget({
  document, location, localStorage,
  __mlsSessionAccount: 'doctor@example.test',
  _copilotHistory: [{ role: 'user', text: 'A private turn' }],
  uns(key) { return `sf_u::doctor@example.test::${key}`; },
  getActivePtId() { return activeId; },
  getPatients() { rosterDecodes++; return patients; },
  findPatient(id) { return this.getPatients().find(patient => patient.id === id) || null; },
  activePatient() { return patients.find(patient => patient.id === activeId) || null; },
  _copilotSaveHist() {}, _copilotRenderThread() {}, _copilotRenderChips() {}
});
window.window = window;

const context = vm.createContext({
  window, document, location, localStorage, console,
  setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout
});
vm.runInContext(source, context, { filename: 'feat_mls_patient_context_safety.js' });

const api = window.__mlsPtCtxSafety;
assert(api && api.installed && api.version === 'pcs-1.2.1', 'patient-context safety did not install');
assert.strictEqual(api.owner(), 'patient-a', 'boot did not adopt the active conversation owner');
assert.strictEqual(rosterDecodes, 0, 'boot decoded the roster in its lifecycle stack');
assert.strictEqual(clock.pendingCount, 1, 'boot did not defer the presentation-only identity lookup');
clock.runOne();
assert.strictEqual(rosterDecodes, 1, 'deferred boot identity lookup did not run exactly once');

activeId = 'patient-b';
window.emit('storage', { key: window.uns('activePt'), storageArea: localStorage });
assert.strictEqual(api.owner(), 'patient-b', 'cross-tab ownership did not switch synchronously');
assert.deepStrictEqual(window._copilotHistory, [], 'incoming patient inherited the outgoing conversation');
assert.strictEqual(rosterDecodes, 1, 'exact active-patient storage callback decoded the full roster');
assert.strictEqual(clock.pendingCount, 1, 'storage callback did not queue one identity refresh');

activeId = 'patient-c';
window.emit('storage', { key: window.uns('activePt'), storageArea: localStorage });
assert.strictEqual(api.owner(), 'patient-c', 'rapid cross-tab ownership did not land synchronously on the latest patient');
assert.strictEqual(rosterDecodes, 1, 'rapid storage callbacks decoded the roster before yielding');
assert.strictEqual(clock.pendingCount, 1, 'rapid storage callbacks did not coalesce their identity work');
clock.runOne();
assert.strictEqual(rosterDecodes, 2, 'coalesced identity refresh did not perform exactly one deferred lookup');
assert.strictEqual(nodes.mlsPtCtxIdentity.getAttribute('data-k'), 'Patient C|03/03/1980|patient-c', 'deferred identity chip rendered a stale owner');

window.emit('storage', { key: 'unrelated', storageArea: localStorage });
assert.strictEqual(clock.pendingCount, 0, 'unrelated storage traffic queued identity work');
assert.strictEqual(rosterDecodes, 2, 'unrelated storage traffic decoded the roster');

activeId = 'patient-a';
window.emit('storage', { key: window.uns('activePt'), storageArea: localStorage });
assert.strictEqual(clock.pendingCount, 1, 'final exact storage event did not queue identity work');
api.revert();
assert.strictEqual(clock.pendingCount, 0, 'revert leaked the deferred identity lookup');
assert.strictEqual(window.listenerCount('storage'), 0, 'revert leaked the cross-tab listener');
assert.strictEqual(rosterDecodes, 2, 'revert executed the deferred roster lookup');

console.log('PASS patient-context cross-tab performance: ownership swaps synchronously while identity lookup is deferred, coalesced, exact-key filtered, latest-owner correct, and cancelled on revert');

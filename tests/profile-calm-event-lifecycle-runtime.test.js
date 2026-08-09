'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_ease.js'), 'utf8');

assert(!/\bsetInterval\s*\(/.test(source), 'profile calm regained a permanent repair poll');
assert(source.includes("window.addEventListener('mls:view-changed', onViewChanged)") &&
  source.includes("window.addEventListener('mls:active-patient-changed', onPatientChanged)") &&
  source.includes("window.addEventListener('mls:session-boundary', onSessionBoundary)"),
  'profile calm is not driven by the canonical view/patient/session lifecycle');
assert(source.includes("observer.observe(pc, { childList: true, subtree: true })"),
  'profile calm lost its profileCard-scoped repair observer');
assert(!/observer\.observe\((?:document|document\.documentElement|document\.body)/.test(source),
  'profile calm observes the whole document instead of its owned profile root');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn); listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter(item => item !== fn));
    },
    emit(type, detail) {
      (listeners.get(type) || []).slice().forEach(fn => fn({ type, detail: detail || {} }));
    },
    count(type) { return (listeners.get(type) || []).length; }
  };
}

function classList() {
  const values = new Set();
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); }
  };
}

const ids = new Map();
function node(id) {
  const attrs = Object.create(null);
  const n = {
    id: id || '', style: { display: '' }, className: '', classList: classList(),
    children: [], parentNode: null, parentElement: null, textContent: '', innerHTML: '',
    setAttribute(name, value) { attrs[name] = String(value); if (name === 'id') this.id = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    appendChild(child) {
      child.parentNode = child.parentElement = this;
      this.children.push(child);
      if (child.id) ids.set(child.id, child);
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      if (this.id) ids.delete(this.id);
      this.parentNode = this.parentElement = null;
    },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  if (id) ids.set(id, n);
  return n;
}

const head = node('head');
const documentElement = node('html');
const patientsView = node('patientsView'); patientsView.style.display = 'none';
const profileCard = node('profileCard');
const document = {
  readyState: 'complete', head, documentElement,
  getElementById(id) { return ids.get(id) || null; },
  createElement(tag) { const n = node(); n.tagName = String(tag).toUpperCase(); return n; },
  querySelector() { return null; },
  querySelectorAll() { return []; }
};

const frames = [];
const winEvents = eventTarget();
const observers = [];
class FakeMutationObserver {
  constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this); }
  observe(target, options) { this.targets.push({ target, options }); this.disconnected = false; }
  disconnect() { this.disconnected = true; }
  fire() { this.callback([]); }
}

const context = {
  console, document, MutationObserver: FakeMutationObserver,
  localStorage: { getItem() { return null; }, setItem() {} },
  requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
  setTimeout(fn) { frames.push(fn); return frames.length; },
  clearTimeout() {},
  addEventListener: winEvents.addEventListener,
  removeEventListener: winEvents.removeEventListener
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_ease.js' });

assert.strictEqual(context.__mlsEase.version, '1.2.0');
for (const type of ['mls:view-changed', 'mls:active-patient-changed', 'mls:session-boundary']) {
  assert.strictEqual(winEvents.count(type), 1, `${type} listener is not installed exactly once`);
}
assert.strictEqual(observers.length, 1, 'profile calm installed more than one observer');
assert.strictEqual(observers[0].targets[0].target, profileCard, 'profile observer is not scoped to #profileCard');

winEvents.emit('mls:active-patient-changed', { patientId: 'hidden-patient' });
assert.strictEqual(frames.length, 0, 'hidden Patients view still performs patient-change repair work');

patientsView.style.display = 'block';
winEvents.emit('mls:view-changed', { view: 'patients', previousView: 'visit' });
winEvents.emit('mls:active-patient-changed', { patientId: 'visible-patient' });
observers[0].fire();
assert.strictEqual(frames.length, 1, 'same-turn view/patient/mutation signals did not coalesce');
frames.shift()();
assert(observers[0].targets.length >= 2, 'profile observer was not reattached after guarded repair');

const replacementProfileCard = node('profileCard');
winEvents.emit('mls:active-patient-changed', { patientId: 'replacement-root' });
assert.strictEqual(observers[0].targets[observers[0].targets.length - 1].target, replacementProfileCard,
  'profile repair did not move its scoped observer to a replaced profileCard');
frames.shift()();

winEvents.emit('mls:view-changed', { view: 'visit', previousView: 'patients' });
assert.strictEqual(frames.length, 0, 'unrelated view navigation triggered profile repair');

winEvents.emit('mls:active-patient-changed', { patientId: 'pending-before-revert' });
assert.strictEqual(frames.length, 1, 'revert fixture did not queue one repair frame');
context.__mlsEase.revert();
frames.shift()();
assert.strictEqual(context.__mlsEase.installed, false, 'revert did not retire the profile owner');
for (const type of ['mls:view-changed', 'mls:active-patient-changed', 'mls:session-boundary']) {
  assert.strictEqual(winEvents.count(type), 0, `${type} listener leaked after revert`);
}
assert.strictEqual(document.getElementById('mlsEaseStyle'), null, 'a queued repair resurrected profile UI after revert');
assert(observers[0].disconnected, 'profile observer remained connected after revert');

const loadingDocEvents = eventTarget();
const loadingWinEvents = eventTarget();
const loadingDocument = {
  readyState: 'loading',
  addEventListener: loadingDocEvents.addEventListener,
  removeEventListener: loadingDocEvents.removeEventListener,
  getElementById() { return null; },
  querySelectorAll() { return []; }
};
const loadingContext = {
  console, document: loadingDocument,
  localStorage: { getItem() { return null; }, setItem() {} },
  addEventListener: loadingWinEvents.addEventListener,
  removeEventListener: loadingWinEvents.removeEventListener,
  setTimeout() { throw new Error('startup revert unexpectedly scheduled work'); }
};
loadingContext.window = loadingContext;
vm.createContext(loadingContext);
vm.runInContext(source, loadingContext, { filename: 'feat_ease.js' });
assert.strictEqual(loadingDocEvents.count('DOMContentLoaded'), 1,
  'loading install did not register exactly one DOM-ready callback');
loadingContext.__mlsEase.revert();
assert.strictEqual(loadingDocEvents.count('DOMContentLoaded'), 0,
  'revert leaked its pending DOM-ready callback');
loadingDocEvents.emit('DOMContentLoaded');
assert.strictEqual(loadingContext.__mlsEase.installed, false,
  'a post-revert DOM-ready event resurrected profile calm');
assert.strictEqual(loadingWinEvents.count('mls:view-changed'), 0,
  'a post-revert DOM-ready event resurrected lifecycle listeners');

console.log('PASS profile calm lifecycle: no permanent poll, canonical visible-view repair, one scoped observer, coalescing, and complete revert');

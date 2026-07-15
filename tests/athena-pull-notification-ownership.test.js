'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function classList(node) {
  const set = new Set();
  return {
    add(name) { set.add(name); node.className = Array.from(set).join(' '); },
    remove(name) { set.delete(name); node.className = Array.from(set).join(' '); },
    contains(name) { return set.has(name) || String(node.className || '').split(/\s+/).includes(name); },
    toggle(name, on) {
      const next = arguments.length > 1 ? !!on : !this.contains(name);
      if (next) this.add(name); else this.remove(name);
      return next;
    }
  };
}

function element(tag) {
  const handlers = Object.create(null);
  const node = {
    nodeType: 1, tagName: String(tag || '').toUpperCase(), id: '', className: '',
    textContent: '', parentNode: null, children: [], style: {}, attributes: {},
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parentNode = null; return child; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, fn, capture) { (handlers[type] || (handlers[type] = [])).push({ fn, capture: !!capture }); },
    removeEventListener(type, fn) { if (handlers[type]) handlers[type] = handlers[type].filter(h => h.fn !== fn); },
    click() { (handlers.click || []).slice().sort((a, b) => Number(b.capture) - Number(a.capture)).forEach(h => h.fn.call(this, { target: this })); },
    querySelector(selector) {
      if (selector === '.mlsdoc-x') return this._dismiss || null;
      return queryAll(this, selector)[0] || null;
    },
    querySelectorAll(selector) { return queryAll(this, selector); }
  };
  node.classList = classList(node);
  Object.defineProperty(node, 'nextSibling', {
    get() { if (!this.parentNode) return null; const at = this.parentNode.children.indexOf(this); return this.parentNode.children[at + 1] || null; }
  });
  Object.defineProperty(node, 'innerHTML', {
    get() { return this._html || ''; },
    set(value) { this._html = String(value || ''); this._dismiss = { addEventListener() {} }; }
  });
  return node;
}

function matches(node, selector) {
  if (selector === '[data-mls-athena-pull-failure="1"]') return node.getAttribute('data-mls-athena-pull-failure') === '1';
  if (selector === '.mlsac-toast') return String(node.className).split(/\s+/).includes('mlsac-toast');
  if (selector === '.mls-sv-card') return String(node.className).split(/\s+/).includes('mls-sv-card');
  if (selector[0] === '#') return node.id === selector.slice(1);
  if (selector[0] === '.') return String(node.className).split(/\s+/).includes(selector.slice(1));
  return false;
}

function queryAll(rootNode, selector) {
  const out = [];
  (function visit(node) {
    if (node !== rootNode && matches(node, selector)) out.push(node);
    (node.children || []).forEach(visit);
  })(rootNode);
  return out;
}

const html = element('html');
const head = element('head');
const body = element('body');
html.appendChild(head); html.appendChild(body);
const pullButton = element('button');
pullButton.id = 'ptPullAthenaBtn';
pullButton.textContent = 'Pull from Athena';
body.appendChild(pullButton);

function byId(node, id) {
  if (node.id === id) return node;
  for (const child of node.children || []) { const found = byId(child, id); if (found) return found; }
  return null;
}

const document = {
  readyState: 'complete', head, body, documentElement: html,
  createElement: element,
  createTextNode(text) { const node = element('#text'); node.textContent = String(text); return node; },
  getElementById(id) { return byId(html, id); },
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === 'button, a.btn, [role="button"]') return [pullButton];
    return queryAll(html, selector);
  },
  addEventListener() {}, removeEventListener() {}
};

const windowHandlers = Object.create(null);
const timers = [];
class FakeMutationObserver { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} }
const ctx = {
  console, document, MutationObserver: FakeMutationObserver,
  activePatient() { return { id: 'patient-1', name: 'Test Patient' }; },
  getPatients() { return []; },
  setTimeout(fn, ms) { timers.push({ fn, ms: Number(ms) || 0 }); return timers.length; },
  clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
  addEventListener(type, fn, capture) { (windowHandlers[type] || (windowHandlers[type] = [])).push({ fn, capture: !!capture }); },
  removeEventListener(type, fn) { if (windowHandlers[type]) windowHandlers[type] = windowHandlers[type].filter(h => h.fn !== fn); },
  postMessage() {}
};
ctx.window = ctx;

vm.runInNewContext(read('feat_save_verify.js'), ctx, { filename: 'feat_save_verify.js' });
vm.runInNewContext(read('feat_athena_doctor.js'), ctx, { filename: 'feat_athena_doctor.js' });
vm.runInNewContext(read('feat_athena_clarity.js'), ctx, { filename: 'feat_athena_clarity.js' });

function dispatch(data) {
  const event = { data };
  const list = (windowHandlers.message || []).slice();
  list.filter(h => h.capture).forEach(h => h.fn(event));
  list.filter(h => !h.capture).forEach(h => h.fn(event));
  let ran;
  do {
    ran = false;
    for (let i = 0; i < timers.length; i++) {
      if (timers[i] && timers[i].ms === 0) { const task = timers[i]; timers[i] = null; task.fn(); ran = true; }
    }
  } while (ran);
}

function failures() { return document.querySelectorAll('[data-mls-athena-pull-failure="1"]'); }

pullButton.click();
const manualFailure = { source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'manual-pull-1', ok: false, reason: 'no-tab' };
dispatch(manualFailure);
assert.strictEqual(failures().length, 1, 'one manual failure produced overlapping Clarity/Doctor/Save Verify warnings');
assert(document.getElementById('mlsAthenaDoctorToast'), 'the single warning must be Athena Doctor\'s actionable Troubleshoot warning');

dispatch(Object.assign({}, manualFailure));
assert.strictEqual(failures().length, 1, 'a repeated result duplicated the one manual warning');

// A background success is unrelated and must not erase the manual warning.
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'mlssi-batch-success1', ok: true, visits: [{}] });
assert.strictEqual(failures().length, 1, 'managed success erased an unrelated manual warning');

// The exact correlated manual success retires every stale failure surface.
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'manual-pull-1', ok: true, visits: [{}] });
assert.strictEqual(failures().length, 0, 'correlated manual success left a stale pull-failure surface');

pullButton.click();
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'prefetch-2', initiator: 'prefetch', ok: false, reason: 'no-tab' });
assert.strictEqual(failures().length, 0, 'managed/background failure created a standalone notification');

console.log('PASS Athena pull notification ownership: one manual warning, zero managed noise, correlated-only stale cleanup');

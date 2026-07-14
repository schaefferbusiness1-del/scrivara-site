'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_athena_doctor.js'), 'utf8');

function element(tag) {
  const node = {
    tagName: String(tag || '').toUpperCase(),
    id: '', className: '', textContent: '', parentNode: null,
    children: [], style: {}, attributes: {},
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] || null; },
    addEventListener() {},
    querySelector(selector) {
      if (selector === '.mlsdoc-x') return this._dismiss || null;
      return null;
    },
    querySelectorAll() { return []; }
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return this._html || ''; },
    set(value) {
      this._html = String(value || '');
      this._dismiss = { addEventListener() {} };
    }
  });
  return node;
}

const html = element('html');
const head = element('head');
const body = element('body');
html.appendChild(head);
html.appendChild(body);

function findById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

const document = {
  readyState: 'loading', head, body, documentElement: html,
  createElement: element,
  getElementById(id) { return findById(html, id); },
  addEventListener() {}
};

const ctx = {
  console, document,
  setTimeout() { return 1; }, clearTimeout() {},
  addEventListener() {}, removeEventListener() {},
  postMessage() {}
};
ctx.window = ctx;

vm.runInNewContext(source, ctx, { filename: 'feat_athena_doctor.js', timeout: 1000 });
const api = ctx.__mlsAthenaDoctor;
assert(api && api.installed, 'Athena doctor did not install');
assert.strictEqual(api.version, '1.0.2');

function dispatch(data) { api._onResultMessage({ data }); }
function toast() { return document.getElementById('mlsAthenaDoctorToast'); }

const managedFail = {
  source: 'mls-ext', type: 'mlsAppAllVisitsResult',
  id: 'mlssi-mabc12-abc1234', ok: false, reason: 'visit-bodies-incomplete'
};
assert.strictEqual(api.isManagedPullResult(managedFail), true, 'correlated provider/day result was not recognized');
assert.strictEqual(api.isManagedPullResult({ resp: { requestId: 'mlssi-mabc12-abc1234' } }), true, 'nested correlated result was not recognized');
assert.strictEqual(api.isManagedPullResult({ resp: { background: true } }), true, 'explicit background result was not recognized');
dispatch(managedFail);
assert.strictEqual(toast(), null, 'managed per-patient failure created a duplicate alarming toast');

const manualFail = {
  source: 'mls-ext', type: 'mlsAppAllVisitsResult',
  id: 'manual-read-1', ok: false, reason: 'visit-bodies-incomplete'
};
assert.strictEqual(api.isManagedPullResult(manualFail), false, 'manual result was incorrectly classified as background');
dispatch(manualFail);
const firstWarning = toast();
assert(firstWarning && firstWarning.className === 'warn', 'manual failure lost its actionable warning');
assert(firstWarning.innerHTML.includes('Troubleshoot Athena'), 'manual warning lost troubleshooting guidance');

dispatch(manualFail);
assert.strictEqual(toast(), firstWarning, 'duplicate manual failure flashed/recreated an already-visible warning');

// A real success must clear stale failure state even when the richer clarity
// module owns the success message and Athena Doctor intentionally stays quiet.
ctx.__mlsAthenaClarity = { installed: true };
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'manual-read-2', ok: true, visits: [{}] });
assert.strictEqual(toast(), null, 'successful pull did not retire the stale failure warning');

dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'mlssi-mabc12-next123', ok: true, visits: [] });
assert.strictEqual(toast(), null, 'managed zero-result created a duplicate toast instead of leaving aggregate UI in control');

dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'manual-search-1', ok: false, reason: 'no-form' });
assert(toast() && toast().className === 'warn', 'manual Athena search failure should remain honest and actionable');

console.log('PASS Athena pull toast lifecycle suppresses managed noise, preserves manual warnings, dedupes repeats, and clears stale failures on success');

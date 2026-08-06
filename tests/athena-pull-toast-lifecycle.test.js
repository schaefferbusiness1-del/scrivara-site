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
assert.strictEqual(api.version, '1.1.0');

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
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'prefetch-1', background: true, ok: false, reason: 'no-tab' });
assert.strictEqual(toast(), null, 'explicit background failure created a standalone warning');

/* v1.0.4 (2026-08-06) — the owner asked twice to delete the orange failure bar
   ("I hate this notification just get rid of it", with a screenshot of the
   search line). It is gone for MANUAL failures too, not only managed ones.
   What must survive the deletion is asserted below: the notice is still
   CLAIMED, and success lines still speak. */
const manualFail = {
  source: 'mls-ext', type: 'mlsAppAllVisitsResult',
  id: 'manual-read-1', ok: false, reason: 'visit-bodies-incomplete'
};
assert.strictEqual(api.isManagedPullResult(manualFail), false, 'manual result was incorrectly classified as background');
dispatch(manualFail);
assert.strictEqual(toast(), null, 'a manual failure raised the orange bar the owner asked us to delete');
assert.strictEqual(manualFail.__mlsAthenaPullNoticeHandled, 'doctor',
  'Doctor stopped CLAIMING the failure notice - feat_athena_clarity.js:227 and feat_save_verify.js:515 stand down only on that claim, so the bar would come straight back wearing a different module name');

/* Silence must not cost the honest SUCCESS line. The deleted warning used to
   park _activeManualFailure, which gated every later success toast; if that
   state is ever restored without its toast, this catches it. */
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'manual-read-unlinked', ok: true, visits: [{}] });
const okToast = toast();
assert(okToast && okToast.className === 'ok', 'an earlier failure swallowed a later honest success line');
assert(okToast.innerHTML.includes('Pulled 1 visit'), 'the success line lost its count');

// Managed traffic stays silent on both sides — its batch owner reports once.
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'mlssi-mabc12-success1', ok: true, visits: [{}] });
assert.strictEqual(toast(), okToast, 'managed success created a duplicate toast');
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'mlssi-mabc12-next123', ok: true, visits: [] });
assert.strictEqual(toast(), okToast, 'managed zero-result created a toast instead of leaving aggregate UI in control');
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'mlssi-mabc12-fail1', ok: false, reason: 'no-tab' });
assert.strictEqual(toast(), okToast, 'managed failure created a standalone warning');

// Clarity owns the richer per-patient success line when installed.
ctx.__mlsAthenaClarity = { installed: true };
api.clearToast();
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'manual-read-2', ok: true, visits: [{}] });
assert.strictEqual(toast(), null, 'Doctor duplicated Clarity per-patient success toast');

// The SEARCH path is the exact one in the owner's screenshot. 'no-form' matched
// no precondition, so it produced the generic "didn't work - re-run" line.
const searchFail = { source: 'mls-ext', type: 'mlsAppSearchResult', id: 'manual-search-1', ok: false, reason: 'no-form' };
dispatch(searchFail);
assert.strictEqual(toast(), null, 'a failed Athena search still raises the notification the owner deleted');
assert.strictEqual(searchFail.__mlsAthenaPullNoticeHandled, 'doctor', 'the search failure notice was left unclaimed');

console.log('PASS Athena failure toasts are gone on every path, the notice is still claimed so no other module raises one, and success lines still speak');

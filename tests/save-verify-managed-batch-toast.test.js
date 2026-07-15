'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_save_verify.js'), 'utf8');
const batchSource = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

function element(tag) {
  return {
    tagName: String(tag || '').toUpperCase(),
    id: '', className: '', textContent: '', innerHTML: '', type: '',
    style: {}, children: [], parentNode: null, firstChild: null,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    insertBefore(child, before) {
      child.parentNode = this;
      const at = this.children.indexOf(before);
      this.children.splice(at < 0 ? this.children.length : at, 0, child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null;
      this.firstChild = this.children[0] || null;
      return child;
    },
    setAttribute(name, value) { this[name] = String(value); },
    querySelectorAll() { return []; }
  };
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

function findAll(node, predicate, out = []) {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) findAll(child, predicate, out);
  return out;
}

const document = {
  readyState: 'loading', head, body, documentElement: html,
  createElement: element,
  createTextNode(text) { const node = element('#text'); node.textContent = String(text); return node; },
  getElementById(id) { return findById(html, id); },
  addEventListener() {},
  querySelectorAll(selector) {
    if (selector === '[data-mls-athena-pull-failure="1"]') return findAll(html, node => node['data-mls-athena-pull-failure'] === '1');
    return [];
  }
};

const ctx = {
  console, document,
  setTimeout() { return 1; }, clearTimeout() {},
  setInterval() { return 1; }, clearInterval() {},
  addEventListener() {}, removeEventListener() {}
};
ctx.window = ctx;

vm.runInNewContext(source, ctx, { filename: 'feat_save_verify.js', timeout: 1000 });
const api = ctx.__mlsSaveVerify;
assert(api && api.installed, 'save verifier did not install');

const managed = { data: { type: 'mlsAppAllVisitsResult', source: 'mls-ext', id: 'mlssi-mabc12-abc1234', ok: false, visits: [] } };
assert.strictEqual(api._isManagedHistoryBatchResult(managed.data), true, 'managed history result was not recognized');
assert.strictEqual(api._isManagedHistoryBatchResult({ background: true }), true, 'explicit background marker was not recognized');
assert.strictEqual(api._isManagedHistoryBatchResult({ resp: { silent: true } }), true, 'nested silent marker was not recognized');
assert.strictEqual(api._isManagedHistoryBatchResult({ initiator: 'prefetch' }), true, 'prefetch initiator was not recognized');
api._onResultMessage(managed);
assert.strictEqual(document.getElementById('mls-save-verify-stack'), null,
  'managed history failure must not create one alarming standalone toast per patient');
api._onResultMessage({ data: { type: 'mlsAppAllVisitsResult', source: 'mls-ext', id: 'background-read', background: true, ok: false, visits: [] } });
assert.strictEqual(document.getElementById('mls-save-verify-stack'), null,
  'explicit background failure must not create a standalone save warning');

const standalone = { data: { type: 'mlsAppAllVisitsResult', source: 'mls-ext', id: 'manual-read-1', ok: false, visits: [] } };
assert.strictEqual(api._isManagedHistoryBatchResult(standalone.data), false, 'standalone result was misclassified as a managed batch');
api._onResultMessage(standalone);
const stack = document.getElementById('mls-save-verify-stack');
assert(stack && stack.children.length === 1, 'standalone/manual failure must retain its honest warning');
api._onResultMessage({ data: { type: 'mlsAppAllVisitsResult', source: 'mls-ext', id: 'manual-read-unlinked', ok: true, visits: [] } });
assert.strictEqual(stack.children.length, 1, 'unlinked manual success erased the active fallback warning');
api._onResultMessage({ data: { type: 'mlsAppAllVisitsResult', source: 'mls-ext', id: 'manual-read-2', retryOf: 'manual-read-1', parentRequestId: 'manual-read-1', ok: true, visits: [] } });
assert.strictEqual(stack.children.length, 0, 'linked fresh-ID retry success did not clear the fallback warning');

assert(batchSource.includes('Incomplete: schedule '),
  'managed provider/day pull must retain one honest final incomplete-batch status');
assert(batchSource.includes('historyReceipt.retry || []'),
  'managed provider/day final receipt must retain per-patient retry details');

console.log('PASS save verifier suppresses per-patient managed-batch alarms while preserving standalone and aggregate failure status');

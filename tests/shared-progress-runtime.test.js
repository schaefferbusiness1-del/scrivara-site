'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_loading_calm.js'), 'utf8');
new Function(source); // syntax gate

function element(tag) {
  const classes = new Set();
  const children = {};
  return {
    tagName: tag,
    id: '',
    style: {},
    textContent: '',
    innerHTML: '',
    attributes: {},
    classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); } },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    appendChild(child) { if (child.id) nodes[child.id] = child; },
    remove() { if (this.id) delete nodes[this.id]; },
    querySelector(sel) {
      if (!children[sel]) children[sel] = element('span');
      return children[sel];
    }
  };
}

const nodes = {};
const stored = {};
const timeouts = [];
let nextTimer = 0;
const document = {
  readyState: 'complete',
  head: element('head'),
  body: element('body'),
  documentElement: element('html'),
  getElementById(id) { return nodes[id] || null; },
  createElement(tag) { return element(tag); },
  createEvent() { return { initCustomEvent() {} }; }
};
document.head.appendChild = document.body.appendChild = document.documentElement.appendChild = function (el) { if (el.id) nodes[el.id] = el; };

const context = {
  console,
  Promise,
  Math,
  Date,
  crypto: { randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() },
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
  document,
  sessionStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
    setItem(k, v) { stored[k] = String(v); }
  },
  setTimeout(fn, ms) { const id = ++nextTimer; timeouts.push({ id, fn, ms }); return id; },
  clearTimeout(id) { const t = timeouts.find(x => x.id === id); if (t) t.cleared = true; },
  setInterval() { return ++nextTimer; },
  clearInterval() {},
  fetch() { return Promise.resolve({ ok: true }); }
};
context.window = context;
context.addEventListener = function () {};
context.dispatchEvent = function () {};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_loading_calm.js' });

const api = context.__mlsLoadingCalm;
assert(api && api.installed, 'shared progress owner did not install');
assert.strictEqual(api.version, 'lb-2.0.0');

const stages = ['Preparing', 'Validating', 'Processing', 'Finalizing'];
const first = api.start({ key: 'opnote:patient-1', kind: 'opnote', stages, total: 5, timeoutMs: 5000, patient: 'Synthetic Patient' });
const duplicate = api.start({ key: 'opnote:patient-1', kind: 'opnote', stages, total: 5 });
assert.strictEqual(duplicate.id, first.id, 'duplicate job created a second loader');
assert.strictEqual(duplicate.duplicate, true, 'duplicate handle was not identified');

let result = api.update(first.id, { stage: 'Processing', current: 2 }, 'req-stale-0001');
assert.strictEqual(result.stale, true, 'late response was not rejected by request id');
assert.strictEqual(api.get(first.id).current, 0, 'stale response mutated progress');

result = first.progress(2, 5, 'Drafting findings');
assert.strictEqual(result.accepted, true);
assert.strictEqual(api.get(first.id).percent, 40, 'real item counts did not produce exact percent');
assert.strictEqual(first.isCurrent(), true, 'active request lost key ownership');

const replacement = api.start({ key: 'opnote:patient-1', kind: 'opnote', replace: true, stages, timeoutMs: 5000, cancelable: true });
assert.strictEqual(api.get(first.id).status, 'canceled', 'obsolete request was not canceled on replace');
assert.strictEqual(replacement.isCurrent(), true, 'replacement did not own stale-response gate');
assert.strictEqual(api.cancel(replacement.id, 'Canceled safely.', replacement.requestId).accepted, true);
assert.strictEqual(api.get(replacement.id).status, 'canceled');

const fixed = api.start({ key: 'noncancelable', timeoutMs: 5000, cancelable: false });
assert.strictEqual(api.cancel(fixed.id, 'no', fixed.requestId).cancelable, false, 'unsafe cancel was presented as successful');
fixed.complete('Done');
assert.strictEqual(api.update(fixed.id, { current: 9 }, fixed.requestId).terminal, true, 'terminal job accepted a late update');

let retried = null;
const retryable = api.start({ key: 'retryable', timeoutMs: 5000, retry(next) { retried = next; } });
retryable.fail(Object.assign(new Error('temporary'), { code: 'TEMP' }));
const retryHandle = api.retry(retryable.id);
assert(retryHandle && retried && retryHandle.id === retried.id, 'working retry control did not create a new request owner');
assert.strictEqual(retryHandle.snapshot().status, 'retrying');

const expiring = api.start({ key: 'deadline', timeoutMs: 1000 });
const deadline = timeouts.filter(t => !t.cleared && t.ms === 1000).pop();
assert(deadline, 'job deadline was not armed');
deadline.fn();
assert.strictEqual(api.get(expiring.id).status, 'timed_out', 'indefinite job did not reach timed_out');

for (const status of ['completed', 'partial', 'failed', 'canceled', 'timed_out']) {
  assert(source.includes(`${status}: 1`), `terminal-state contract missing ${status}`);
}
assert(stored['mls:progress:v2'], 'progress was not persisted for refresh recovery');

console.log('PASS shared progress: dedupe, stages/counts, stale rejection, safe cancel, retry, terminal deadlines, and persistence');

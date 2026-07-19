'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const start = source.indexOf('/* ===== __mlsDaySwitch');
const end = source.indexOf('/* ===== __mlsVisitSavePref', start);
assert(start >= 0 && end > start, 'day-switch module markers are missing');
const moduleSource = source.slice(start, end);

const nodes = Object.create(null);
function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(), style: {}, children: [], parentNode: null,
    disabled: false, textContent: '', onclick: null, firstChild: null,
    appendChild(child) { child.parentNode = this; this.children.push(child); this.firstChild = this.children[0] || null; return child; },
    insertBefore(child, before) {
      child.parentNode = this;
      const index = before ? this.children.indexOf(before) : -1;
      if (index >= 0) this.children.splice(index, 0, child); else this.children.push(child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      if (this._id) delete nodes[this._id];
      this.parentNode = null;
    },
    querySelector(selector) {
      if (selector && selector.charAt(0) === '#') return nodes[selector.slice(1)] || null;
      return null;
    }
  };
  Object.defineProperty(node, 'id', {
    get() { return this._id || ''; },
    set(value) { this._id = String(value || ''); if (this._id) nodes[this._id] = this; }
  });
  Object.defineProperty(node, 'innerHTML', {
    get() { return this._innerHTML || ''; },
    set(value) {
      this._innerHTML = String(value || '');
      const re = /<(button|span)[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi;
      let match;
      while ((match = re.exec(this._innerHTML))) {
        const child = makeNode(match[1]);
        child.id = match[2];
        child.textContent = match[3].replace(/<[^>]*>/g, '');
        this.appendChild(child);
      }
    }
  });
  return node;
}

const head = makeNode('head');
const appBody = makeNode('div'); appBody.id = 'mlsEz3Body';
const document = {
  getElementById(id) { return nodes[id] || null; },
  createElement(tag) { return makeNode(tag); },
  head, body: appBody, documentElement: head
};

const toasts = [];
let resolvePull;
let resolveRetry;
let retryCalls = 0;
let retrySource = null;
const context = {
  console, Date, Math, JSON, Object, String, Number, Array, RegExp, Promise, Error,
  document,
  addEventListener() {}, removeEventListener() {},
  setInterval() { return 1; }, clearInterval() {},
  setTimeout() { return 1; }, clearTimeout() {},
  toast(message, kind) { toasts.push({ message: String(message), kind: String(kind || '') }); },
  _calAppts: [],
  __mlsSI: {
    pull() { return new Promise(resolve => { resolvePull = resolve; }); }
  },
  MLSScheduleImporter: {
    retryFailedHistory(sourceReceipt, onStatus) {
      retryCalls += 1;
      retrySource = sourceReceipt;
      onStatus('Reading only the incomplete histories...');
      return new Promise(resolve => { resolveRetry = resolve; });
    }
  }
};
context.window = context;
vm.runInNewContext(moduleSource, context, { filename: 'day-switch-manual-history-retry.js', timeout: 1000 });

const pullButton = nodes.mlsDsPullBtn;
const retryButton = nodes.mlsDsRetryHistoryBtn;
const status = nodes.mlsDsStatus;
assert(pullButton && retryButton && status, 'day strip did not render its controls');
assert.strictEqual(retryButton.style.display, 'none', 'history retry must start hidden');

const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const partialPull = {
    ok: false, complete: false, reason: 'history-partial',
    scheduleReceipt: { parsedCount: 18 },
    historyReceipt: { reason: 'history-partial', requested: 18, processed: 18, retry: [{ patientId: 'a' }, { patientId: 'b' }] }
  };

  pullButton.onclick();
  assert.strictEqual(retryCalls, 0, 'starting a pull must not trigger a history retry');
  resolvePull(partialPull);
  await flush();
  assert.strictEqual(retryCalls, 0, 'a settled partial pull must wait for a human click');
  assert.strictEqual(retryButton.style.display, '', 'partial history did not reveal the manual retry control');
  assert.strictEqual(retryButton.disabled, false, 'manual retry stayed disabled after the pull settled');
  assert(/\(2\)/.test(retryButton.textContent), 'manual retry control omitted the aggregate patient count');
  assert.strictEqual(toasts.length, 1, 'partial pull emitted more than one aggregate toast');

  retryButton.onclick();
  assert.strictEqual(retryCalls, 1, 'manual retry click did not invoke the importer exactly once');
  assert.strictEqual(retrySource, partialPull, 'manual retry did not receive the settled pull result');
  assert.strictEqual(retryButton.disabled, true, 'retry control was not disabled while its request was in flight');
  assert.strictEqual(pullButton.disabled, true, 'full pull remained clickable during a history-only retry');
  assert(/incomplete histories/i.test(status.textContent), 'live aggregate retry status was not shown');
  resolveRetry({ complete: false, reason: 'history-partial', retry: [{ patientId: 'b' }] });
  await flush();
  assert.strictEqual(retryButton.style.display, '', 'partial retry hid the recovery control');
  assert.strictEqual(retryButton.disabled, false, 'partial retry did not re-enable its control');
  assert(/\(1\)/.test(retryButton.textContent), 'partial retry did not update the aggregate remaining count');
  assert(/1 patient/i.test(status.textContent), 'partial retry status omitted the remaining count');
  assert.strictEqual(toasts.length, 2, 'partial retry emitted more than one final aggregate toast');

  retryButton.onclick();
  assert.strictEqual(retryCalls, 2, 'second human retry click did not start exactly one continuation');
  resolveRetry({ complete: true, reason: 'complete', retry: [], failures: 0 });
  await flush();
  assert.strictEqual(retryButton.style.display, 'none', 'completed history retry did not hide the recovery control');
  assert.strictEqual(pullButton.disabled, false, 'completed retry did not restore the normal pull control');
  assert(/history is complete/i.test(status.textContent), 'completed retry did not leave one calm aggregate status');
  assert.strictEqual(toasts.length, 3, 'completed retry emitted more than one final aggregate toast');
  assert.strictEqual(toasts[2].kind, 'ok', 'completed retry was not reported as successful');

  console.log('PASS manual history retry UI: explicit click only, aggregate status, partial retention, complete hide');
})().catch(error => { console.error(error); process.exit(1); });

'use strict';

/* P1-only proof for the storage action surface. The regular-site guard is
 * intentionally not loaded or changed by this test. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const importer = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const regularConnect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const start = connect.indexOf('qv-1.0 (2026-08-09)');
const iifeStart = connect.indexOf('(function () {', start);
const tail = 'window.__mlsQuotaGuard_revert = QG.revert;\n})();';
const iifeEnd = connect.indexOf(tail, iifeStart);
assert(start > 0 && iifeStart > start && iifeEnd > iifeStart, 'P1 quota guard is not extractable');
const source = connect.slice(iifeStart, iifeEnd) + tail;

function node(tag, elements) {
  return {
    tagName: String(tag || '').toUpperCase(), id: '', attrs: {}, style: { cssText: '' },
    textContent: '', parentNode: null, children: [],
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    insertBefore(child) {
      if (child.parentNode && child.parentNode.removeChild) child.parentNode.removeChild(child);
      child.parentNode = this; this.children.unshift(child);
      if (child.id) elements.set(child.id, child);
      return child;
    },
    appendChild(child) {
      if (child.parentNode && child.parentNode.removeChild) child.parentNode.removeChild(child);
      child.parentNode = this; this.children.push(child);
      if (child.id) elements.set(child.id, child);
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1);
      if (child.id) elements.delete(child.id); child.parentNode = null; return child;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  };
}

function harness() {
  const elements = new Map();
  const appWrap = node('main', elements); appWrap.id = 'appWrap'; elements.set(appWrap.id, appWrap);
  const body = node('body', elements); body.appendChild(appWrap);
  const data = new Map();
  const events = {};
  const intervals = [];
  const toasts = [];
  const logs = [];
  const pending = [];
  let account = 'alpha@example.invalid';
  let epoch = 1;
  let mode = 'normal';
  let receipt = { mode: 'idb', hydrated: true, degraded: false, wbFailures: 0, gen: 4, confirmedGen: 4 };
  const key = () => `sf_u::${account}::patients`;
  data.set(key(), '[]');

  const sandbox = {
    Date, JSON, String, Number, Math, Object, Promise, Error,
    console: { error(...args) { logs.push(['error', ...args]); }, warn(...args) { logs.push(['warn', ...args]); } },
    localStorage: {
      getItem(name) { return data.has(name) ? data.get(name) : null; },
      setItem(name, value) { data.set(name, String(value)); },
      removeItem(name) { data.delete(name); }
    },
    document: {
      body, documentElement: body,
      getElementById(id) { return elements.get(id) || null; },
      createElement(tag) { return node(tag, elements); }
    },
    setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {},
    addEventListener(type, fn) { (events[type] ||= []).push(fn); },
    removeEventListener(type, fn) { const rows = events[type] || []; const at = rows.indexOf(fn); if (at >= 0) rows.splice(at, 1); },
    toast(message, kind) { toasts.push({ message, kind }); },
    uns(suffix) { return `sf_u::${account || '_'}::${suffix}`; },
    savePatients(rows) {
      if (mode === 'throw') { const error = new Error('raw alpha@example.invalid patient-key detail'); error.name = 'QuotaExceededError'; throw error; }
      if (mode === 'normal') data.set(key(), JSON.stringify(rows));
      return 'saved';
    },
    __mlsPtsStore: null
  };
  Object.defineProperty(sandbox, '__mlsSessionAccount', { configurable: true, enumerable: true, get() { return account; } });
  Object.defineProperty(sandbox, '__mlsSessionEpoch', { configurable: true, enumerable: true, get() { return epoch; } });
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: '1p-quota-guard.js' });

  return {
    win: sandbox, elements, appWrap, toasts, logs, intervals, pending,
    setMode(value) {
      mode = value;
      if (value === 'idb') {
        sandbox.__mlsPtsStore = {
          isReady() { return true; }, receipt() { return { ...receipt }; },
          flushNow() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); }
        };
      } else sandbox.__mlsPtsStore = null;
    },
    setReceipt(value) { receipt = { ...receipt, ...value }; },
    switchAccount(value, valueEpoch) { account = value; epoch = valueEpoch; if (!data.has(key())) data.set(key(), '[]'); },
    dispatch(type, detail) { for (const fn of [...(events[type] || [])]) fn({ type, detail: detail || {} }); }
  };
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }

(async function run() {
  const h = harness();
  const large = [{ text: 'x'.repeat(300) }];

  h.setMode('throw');
  assert.throws(() => h.win.savePatients(large), /raw alpha/, 'original write failure was swallowed');
  const first = h.win.__mlsStoreWriteFailed;
  const card = h.elements.get('mlsQuotaChip');
  assert(first && first.reason === 'quota-exceeded', 'failure was not reduced to an allowlisted category');
  assert(card && card.parentNode === h.appWrap, 'action-required card did not mount in normal flow');
  assert.strictEqual(card.attrs.role, 'alert', 'card lost alert semantics');
  assert(!/position\s*:\s*fixed|bottom\s*:/.test(card.style.cssText), 'card can overlay the navigation');
  assert(/couldn'?t verify the latest save/i.test(card.textContent), 'card copy is not truthful');
  assert(!/safe in memory|sync|fix in progress|storage is full/i.test(card.textContent), 'card makes an unproven storage claim');
  assert.strictEqual(h.toasts.length, 0, 'mounted persistent card also produced a duplicate toast');
  assert(!JSON.stringify({ first, diag: h.win.__mlsQuotaGuard.diagnostic(), logs: h.logs }).includes('alpha@example.invalid'),
    'account identity leaked into latch, diagnostics, or logs');

  assert.throws(() => h.win.savePatients(large), /raw alpha/, 'second original failure was swallowed');
  assert.strictEqual(h.toasts.length, 0, 'one failure episode repeated its notification');
  assert.strictEqual(h.elements.get('mlsQuotaChip').textContent, card.textContent, 'alert text churned during one episode');

  h.setMode('normal');
  h.win.savePatients([{ text: 'small unrelated retry' }]);
  assert(h.win.__mlsStoreWriteFailed, 'a smaller unrelated write erased the prior capacity failure');
  assert(h.elements.get('mlsQuotaChip'), 'a smaller unrelated write hid the unresolved action card');
  h.win.savePatients(large);
  assert.strictEqual(h.win.__mlsStoreWriteFailed, null, 'same-scope verified local echo did not recover');
  assert(!h.elements.get('mlsQuotaChip'), 'verified recovery left the action card up');
  assert.strictEqual(h.toasts.length, 0, 'verified recovery emitted a user notification');
  assert.strictEqual(h.logs.length, 0, 'failure or recovery emitted raw engineering console noise');

  /* A newer rejection must win over an older success. */
  h.setMode('idb');
  h.win.savePatients([{ text: 'older' }]);
  h.win.savePatients([{ text: 'newer' }]);
  assert.strictEqual(h.pending.length, 2, 'IDB confirmations were not independently tracked');
  h.pending[1].reject(new Error('newer raw patient/account detail'));
  await settle();
  assert.strictEqual(h.win.__mlsStoreWriteFailed.reason, 'idb-confirm-rejected', 'newest IDB rejection did not arm a sanitized latch');
  h.setReceipt({ degraded: false, wbFailures: 0, gen: 9, confirmedGen: 9 });
  h.pending[0].resolve();
  await settle();
  assert(h.win.__mlsStoreWriteFailed, 'older IDB success cleared a newer failure');
  assert(h.win.__mlsQuotaGuard.diagnostic().lateResultsDropped >= 1, 'out-of-order result was not recorded as dropped');
  assert(!JSON.stringify({ latch: h.win.__mlsStoreWriteFailed, diag: h.win.__mlsQuotaGuard.diagnostic(), logs: h.logs }).includes('newer raw'),
    'raw IDB rejection text escaped sanitization');

  /* Strict same-scope recovery is quiet. */
  assert.strictEqual(h.win.__mlsQuotaGuard._recover('pull-preflight'), true, 'healthy same-scope receipt could not recover');
  assert.strictEqual(h.win.__mlsStoreWriteFailed, null, 'same-scope recovery left the latch');
  assert.strictEqual(h.win.__mlsQuotaGuard.diagnostic().recoverySource, 'pull-preflight', 'sanitized recovery source missing');

  /* A late Account A callback cannot arm Account B. */
  h.win.savePatients([{ text: 'account-a-pending' }]);
  const oldPending = h.pending[2];
  h.switchAccount('beta@example.invalid', 2);
  h.dispatch('mls:session-boundary', { previousAccount: 'alpha@example.invalid', nextAccount: 'beta@example.invalid' });
  assert.strictEqual(h.win.__mlsStoreWriteFailed, null, 'session boundary carried the old latch into Account B');
  oldPending.reject(new Error('late Account A raw detail'));
  await settle();
  assert.strictEqual(h.win.__mlsStoreWriteFailed, null, 'late Account A rejection armed Account B');
  assert(!h.elements.get('mlsQuotaChip'), 'late Account A rejection painted a card in Account B');

  /* Unhealthy current receipts remain fail-closed; healthy receipts clear. */
  h.win.savePatients([{ text: 'account-b-current' }]);
  h.pending[3].reject(new Error('current failure'));
  await settle();
  h.setReceipt({ degraded: true, wbFailures: 1, gen: 10, confirmedGen: 9 });
  h.intervals[0]();
  assert(h.win.__mlsStoreWriteFailed, 'unhealthy receipt cleared the current failure');
  h.setReceipt({ degraded: false, wbFailures: 0, gen: 10, confirmedGen: 10 });
  h.intervals[0]();
  assert.strictEqual(h.win.__mlsStoreWriteFailed, null, 'healthy same-scope heal did not clear');
  assert.strictEqual(h.toasts.length, 0, 'failure/recovery path produced duplicate toast noise');
  assert.strictEqual(h.logs.length, 0, 'failure/recovery path produced console noise');

  h.setMode('throw');
  assert.throws(() => h.win.savePatients(large));
  assert(h.elements.get('mlsQuotaChip'), 'revert setup did not create a card');
  assert.strictEqual(h.win.__mlsQuotaGuard_revert(), 'reverted', 'guard did not revert');
  assert(!h.elements.get('mlsQuotaChip') && !h.win.__mlsStoreWriteFailed, 'revert left stale warning state');

  assert(importer.includes('qg._recover("pull-preflight")'), 'pull preflight bypasses scoped recovery');
  assert(!/Local storage is FULL|storage fix is in progress|stale write-failure latch CLEARED/.test(importer),
    'P1 importer still contains noisy or unproven storage language');
  const monthPreflightAt = importer.indexOf('var _lrQuotaM');
  assert(monthPreflightAt >= 0 && monthPreflightAt < importer.indexOf('p1ClaimMonthOwner()', monthPreflightAt),
    'month preflight no longer refuses before owner admission/navigation');
  assert(regularConnect.includes('MLS storage is FULL'), 'test unexpectedly changed the regular-site storage guard');

  console.log('PASS /p1 quota notification: scoped ordering, account wall, truthful non-overlay card, sanitized diagnostics, quiet verified recovery, and pre-navigation refusal');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});

'use strict';

/* dtr-1.0.0: terminal DaySwitch status is account-scoped, date-isolated,
 * PHI-free, durable when storage works, and honest when it does not. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const start = source.indexOf("  var DS_TERMINAL_RECEIPT_SUFFIX = 'dayPullTerminalReceiptV1';");
const end = source.indexOf('  function rowSortMinute(a) {', start);
assert(start >= 0 && end > start, 'durable terminal receipt helper boundary moved');

function boot(store, account, day) {
  const window = {};
  window.uns = suffix => account + '::' + suffix;
  window.localStorage = {
    getItem(key) { return store.has(String(key)) ? store.get(String(key)) : null; },
    setItem(key, value) { store.set(String(key), String(value)); }
  };
  const sandbox = { window, DS: { day }, fmtDay: value => String(value || ''), Date, Object, JSON, Math, Number, String, isFinite };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + '\nthis.receiptApi = { build: dsBuildTerminalReceipt, persist: dsPersistTerminalReceipt, load: dsLoadTerminalReceipt, status: dsTerminalStatus };', sandbox,
    { filename: 'day-pull-terminal-receipt.js' });
  return sandbox;
}

const store = new Map();
const day = '2026-08-23';
const completeResult = {
  ok: true, complete: true, target: day, pullId: 'pull-synthetic-1', reason: 'complete',
  visitNotesRequested: false,
  scheduleReceipt: { complete: true, expectedCount: 2, parsedCount: 2 },
  calendarReceipt: { complete: true, accounted: 2 },
  historyReceipt: { skipped: true, reason: 'full-notes-off', requested: 0, processed: 0, complete: true, failures: 0, retry: [] }
};
const first = boot(store, 'account-a', day);
const complete = first.receiptApi.build(completeResult, day);
assert.strictEqual(complete.status, 'complete', 'successful schedule-only pull was not complete');
assert.strictEqual(complete.visitNotes.requested, false, 'terminal receipt lost Full Notes OFF choice');
assert.strictEqual(complete.visitNotes.mode, 'not-requested', 'OFF terminal receipt was mislabeled as full detail');
assert(!JSON.stringify(complete).includes('Synthetic'), 'terminal receipt contains patient text');
assert(!JSON.stringify(complete).includes('name'), 'terminal receipt contains a PHI-bearing name field');
const persistedComplete = first.receiptApi.persist(complete);
assert.strictEqual(persistedComplete.ok, true, 'working account storage did not confirm the terminal receipt');
assert.strictEqual(persistedComplete.durable, true, 'working account storage did not mark the terminal receipt durable');
assert.strictEqual(persistedComplete.reason, '', 'working account storage returned an unexpected persistence reason');

const reload = boot(store, 'account-a', day);
const restored = reload.receiptApi.load(day);
assert(restored && restored.durable === true, 'reload did not restore the account-scoped terminal receipt');
assert.strictEqual(restored.target, day, 'reload restored a receipt for the wrong date');
assert.strictEqual(restored.status, 'complete', 'reload changed the terminal verdict');

const otherDay = boot(store, 'account-a', '2026-08-24');
assert.strictEqual(otherDay.receiptApi.load('2026-08-24'), null, 'a different selected day reused the prior receipt');
const otherAccount = boot(store, 'account-b', day);
assert.strictEqual(otherAccount.receiptApi.load(day), null, 'one account could see another account terminal receipt');

const partial = first.receiptApi.build({
  ok: false, complete: false, target: day, reason: 'history-partial',
  scheduleReceipt: { complete: true, expectedCount: 2, parsedCount: 2 },
  historyReceipt: { requested: 2, processed: 1, complete: false, failures: 1, retry: [{}] }
}, day);
assert.strictEqual(partial.status, 'partial', 'schedule evidence plus unfinished history was not partial');
const failed = first.receiptApi.build({ ok: false, complete: false, target: day, reason: 'pull-engine-unavailable' }, day);
assert.strictEqual(failed.status, 'failed', 'an attempt with no verified schedule/history evidence was not failed');

const throwingStore = { getItem() { return null; }, setItem() { throw new Error('quota'); } };
const failureWindow = boot(new Map(), 'account-c', day);
failureWindow.window.localStorage = throwingStore;
const unsaved = failureWindow.receiptApi.build(completeResult, day);
const persisted = failureWindow.receiptApi.persist(unsaved);
assert.strictEqual(persisted.durable, false, 'storage failure was reported as durable');
assert.strictEqual(persisted.reason, 'storage-write-failed', 'storage failure lost its honest reason');

console.log('PASS day-pull terminal receipt runtime: account scope, date isolation, reload restoration, PHI-free bounded status, complete/partial/failed classification, and honest storage failure');

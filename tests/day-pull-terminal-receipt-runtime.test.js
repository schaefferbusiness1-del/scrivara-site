'use strict';

/* dtr-1.1.0 (was dtr-1.0.0): terminal DaySwitch status is account-scoped,
 * date-isolated, PHI-free, durable when storage works, and honest when it does
 * not.
 *
 * dayfacts-1.0.1 realignment: the pre-1.0.1 pin on visitNotes.mode ===
 * 'not-requested' is RETIRED. Full visit notes OFF is no longer "nothing was
 * opened" - it is DAY-FACTS mode: every scheduled chart is opened, its facts
 * and its own-day note are read, and only the dated HISTORICAL encounter
 * bodies are skipped. The persisted receipt and the sentence the owner reads
 * must both speak that vocabulary, so this suite now pins it positively and
 * keeps a byte tripwire against the retired "opens no chart" claims coming
 * back. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const start = source.indexOf("  var DS_TERMINAL_RECEIPT_SUFFIX = 'dayPullTerminalReceiptV1';");
const end = source.indexOf('  function rowSortMinute(a) {', start);
assert(start >= 0 && end > start, 'durable terminal receipt helper boundary moved');
const block = source.slice(start, end);

function boot(store, account, day, opts) {
  const window = {};
  const o = opts || {};
  window.uns = typeof o.uns === 'function' ? o.uns : (suffix => account + '::' + suffix);
  window.localStorage = {
    getItem(key) { return store.has(String(key)) ? store.get(String(key)) : null; },
    setItem(key, value) { store.set(String(key), String(value)); }
  };
  const sandbox = { window, DS: { day }, fmtDay: value => String(value || ''), Date, Object, JSON, Math, Number, String, isFinite };
  vm.createContext(sandbox);
  vm.runInContext(block + '\nthis.receiptApi = { build: dsBuildTerminalReceipt, persist: dsPersistTerminalReceipt, load: dsLoadTerminalReceipt, status: dsTerminalStatus, line: dsTerminalReceiptLine };', sandbox,
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

/* dayfacts-1.0.1 POSITIVE PIN (replaces the retired 'not-requested' pin). */
assert.strictEqual(complete.visitNotes.mode, 'day-facts',
  'OFF terminal receipt must persist DAY-FACTS mode (dayfacts-1.0.1), not the retired not-requested vocabulary');
assert(!JSON.stringify(complete.visitNotes).includes('not-requested'),
  'the retired not-requested mode token is still in the persisted visitNotes vocabulary');
assert(!JSON.stringify(complete).includes('Synthetic'), 'terminal receipt contains patient text');
assert(!JSON.stringify(complete).includes('name'), 'terminal receipt contains a PHI-bearing name field');

/* The other two modes must stay distinct - OFF is not ON, and a choice that
 * was never made is never reported as a choice. */
const onReceipt = first.receiptApi.build({
  ok: true, complete: true, target: day, reason: 'complete', visitNotesRequested: true,
  scheduleReceipt: { complete: true, expectedCount: 2, parsedCount: 2 },
  historyReceipt: { requested: 2, processed: 2, complete: true, failures: 0, retry: [] }
}, day);
assert.strictEqual(onReceipt.visitNotes.mode, 'full', 'Full visit notes ON was not recorded as full detail');
assert.strictEqual(onReceipt.visitNotes.requested, true, 'ON receipt lost the ON choice');

const persistedComplete = first.receiptApi.persist(complete);
assert.strictEqual(persistedComplete.ok, true, 'working account storage did not confirm the terminal receipt');
assert.strictEqual(persistedComplete.durable, true, 'working account storage did not mark the terminal receipt durable');
assert.strictEqual(persistedComplete.reason, '', 'working account storage returned an unexpected persistence reason');

const reload = boot(store, 'account-a', day);
const restored = reload.receiptApi.load(day);
assert(restored && restored.durable === true, 'reload did not restore the account-scoped terminal receipt');
assert.strictEqual(restored.target, day, 'reload restored a receipt for the wrong date');
assert.strictEqual(restored.status, 'complete', 'reload changed the terminal verdict');
/* The day-facts vocabulary has to survive storage, not just the build call. */
assert.strictEqual(restored.visitNotes.requested, false, 'reload lost the OFF choice');
assert.strictEqual(restored.visitNotes.mode, 'day-facts', 'a reloaded OFF receipt no longer speaks day-facts');

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
assert.strictEqual(failed.visitNotes.requested, null, 'an unmade Full-notes choice was reported as a choice');
assert.strictEqual(failed.visitNotes.mode, 'unknown', 'an unmade Full-notes choice was labeled as a real mode');

/* Evidence, not vocabulary, decides the verdict. A batch that was genuinely
 * skipped cannot manufacture "complete: true" evidence out of nothing... */
const skippedOnly = first.receiptApi.build({
  ok: false, complete: false, target: day, reason: 'schedule-unverified',
  historyReceipt: { skipped: true, requested: 0, processed: 0, complete: true, failures: 0, retry: [] }
}, day);
assert.strictEqual(skippedOnly.status, 'failed', 'a skipped history batch manufactured evidence for a pull that read nothing');
/* ...but a DAY-FACTS history leg really ran (charts opened, facts and own-day
 * notes read), so it IS evidence even though Full visit notes was off. That is
 * the whole point of dayfacts-1.0.1. */
const dayFactsWork = first.receiptApi.build({
  ok: false, complete: false, target: day, reason: 'schedule-partial', visitNotesRequested: false,
  historyReceipt: { requested: 3, processed: 3, complete: true, failures: 0, retry: [] }
}, day);
assert.strictEqual(dayFactsWork.status, 'partial', 'day-facts chart work was discarded as no evidence at all');
assert.strictEqual(dayFactsWork.visitNotes.mode, 'day-facts', 'day-facts chart work was not labeled day-facts');

/* ---- the sentence the owner actually reads ---------------------------- */
const RETIRED_CLAIMS = [
  /intentionally skipped/i,
  /Full Notes is off/,
  /opens no chart/i,
  /no patient chart/i,
  /schedule rows only/i,
  /were not opened/i
];
function assertNoRetiredClaim(text, where) {
  RETIRED_CLAIMS.forEach(function (re) {
    assert(!re.test(text), 'retired pre-dayfacts claim ' + re + ' is back in ' + where + ': ' + text);
  });
}

const offLine = reload.receiptApi.line(restored);
assert(/^Pull complete for 2026-08-23\./.test(offLine), 'terminal line lost its verdict-and-date opening: ' + offLine);
assert(/Historical visit notes were skipped by choice \(Full visit notes is off\)/.test(offLine),
  'the OFF terminal line no longer names WHAT was skipped and why: ' + offLine);
assert(/chart facts and each day.s own note were read\./.test(offLine),
  'the OFF terminal line no longer tells the owner the charts were read: ' + offLine);
assertNoRetiredClaim(offLine, 'the OFF terminal line');
assert(!/could not be saved/.test(offLine), 'a durable receipt claimed it could not be saved: ' + offLine);

const onLine = first.receiptApi.line(onReceipt);
assert(!/skipped by choice/.test(onLine), 'the ON terminal line claimed visit notes were skipped: ' + onLine);
assertNoRetiredClaim(onLine, 'the ON terminal line');
const unknownLine = first.receiptApi.line(failed);
assert(!/skipped by choice/.test(unknownLine), 'an unmade choice was narrated as a deliberate skip: ' + unknownLine);
assert(/^Pull failed for 2026-08-23\./.test(unknownLine), 'a failed pull did not say so: ' + unknownLine);

/* A receipt that never reached storage says so, AND still tells the day-facts
 * truth - the two clauses coexist. */
const volatileLine = first.receiptApi.line(complete);
assert(/Historical visit notes were skipped by choice/.test(volatileLine), 'the volatile OFF line dropped the day-facts truth: ' + volatileLine);
assert(/Status could not be saved for reload; it is available in this tab only\./.test(volatileLine),
  'a receipt that was never persisted did not admit it is tab-only: ' + volatileLine);
assertNoRetiredClaim(volatileLine, 'the volatile OFF line');
assert.strictEqual(first.receiptApi.line(null), '', 'a missing receipt still produced a status sentence');

/* Byte tripwire: no retired "OFF opens nothing" prose may reappear anywhere in
 * the terminal-receipt helper block itself. */
assertNoRetiredClaim(block, 'the terminal-receipt helper block source');

/* ---- honest failure modes -------------------------------------------- */
const throwingStore = { getItem() { return null; }, setItem() { throw new Error('quota'); } };
const failureWindow = boot(new Map(), 'account-c', day);
failureWindow.window.localStorage = throwingStore;
const unsaved = failureWindow.receiptApi.build(completeResult, day);
const persisted = failureWindow.receiptApi.persist(unsaved);
assert.strictEqual(persisted.durable, false, 'storage failure was reported as durable');
assert.strictEqual(persisted.reason, 'storage-write-failed', 'storage failure lost its honest reason');

/* An unsettled account namespace must never write into a shared key - the
 * unscoped door is no softer than the day-scoped one. */
[
  { name: 'empty namespace', uns: () => '' },
  { name: 'placeholder namespace', uns: suffix => 'mls::_::' + suffix },
  { name: 'undefined namespace', uns: suffix => 'mls::undefined::' + suffix },
  { name: 'throwing namespace', uns: () => { throw new Error('unsettled'); } }
].forEach(function (probe) {
  const unsettledStore = new Map();
  const box = boot(unsettledStore, 'account-d', day, { uns: probe.uns });
  const r = box.receiptApi.persist(box.receiptApi.build(completeResult, day));
  assert.strictEqual(r.ok, false, probe.name + ': an unsettled account claimed a successful write');
  assert.strictEqual(r.durable, false, probe.name + ': an unsettled account claimed durability');
  assert.strictEqual(r.reason, 'account-namespace-unsettled', probe.name + ': unsettled write lost its honest reason');
  assert.strictEqual(unsettledStore.size, 0, probe.name + ': an unsettled account wrote a receipt into storage anyway');
  assert.strictEqual(box.receiptApi.load(day), null, probe.name + ': an unsettled account read a receipt it cannot own');
});

console.log('PASS day-pull terminal receipt runtime: account scope, date isolation, reload restoration, PHI-free bounded status, complete/partial/failed classification, dayfacts-1.0.1 day-facts vocabulary (persisted + reloaded + narrated), no retired "OFF opens no charts" prose, unsettled-namespace refusal, and honest storage failure');

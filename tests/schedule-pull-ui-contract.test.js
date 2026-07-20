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

const document = {
  getElementById() { return null; },
  createElement() { return { style: {}, remove() {} }; },
  head: { appendChild() {} },
  body: { appendChild() {} },
  documentElement: { appendChild() {} }
};
const context = {
  console, Date, Math, JSON, Object, String, Number, Array, RegExp, Promise,
  document,
  addEventListener() {}, removeEventListener() {},
  setInterval() { return 1; }, clearInterval() {},
  setTimeout() { return 1; }, clearTimeout() {}
};
context.window = context;
vm.runInNewContext(moduleSource, context, { filename: 'day-switch.js' });

const classify = context.__mlsDaySwitch && context.__mlsDaySwitch.classifyPullResult;
assert.strictEqual(typeof classify, 'function', 'day pull result classifier is not exposed');
const safeReasonCounts = context.__mlsDaySwitch && context.__mlsDaySwitch._safeReasonCounts;
assert.strictEqual(typeof safeReasonCounts, 'function', 'copyable report reason allowlist is not exposed for verification');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(safeReasonCounts({ 'appointment-create-http': 1, janedoe: 1, 'MRN-123': 1 }))),
  { 'appointment-create-http': 1, unverified: 2 },
  'copyable report allowed single-token PHI-shaped diagnostic keys'
);

let result = classify({ ok: false, complete: false, reason: 'no-ext' }, '2026-07-15');
assert.strictEqual(result.ok, false, 'missing extension was labeled successful');
assert(/not available|extension/i.test(result.message), 'missing extension message is not actionable');

result = classify({
  ok: false, complete: false, reason: 'schedule-incomplete',
  scheduleReceipt: { expectedCount: 17, parsedCount: 7 }
}, '2026-07-15');
assert.strictEqual(result.ok, false, '7/17 schedule was labeled successful');
assert(/7 of 17/.test(result.message), 'partial schedule counts are not shown honestly');

result = classify({
  ok: false, complete: false, reason: 'history-partial',
  scheduleReceipt: { parsedCount: 17 },
  historyReceipt: { retry: [{ patientId: 'a' }, { patientId: 'b' }] }
}, '2026-07-15');
assert.strictEqual(result.ok, false, 'incomplete history was labeled as a complete pull');
assert(/2 patient/.test(result.message), 'history retry count is missing');

result = classify({
  ok: false, complete: false, reason: 'calendar-partial',
  calendarReceipt: { failureClass: 'mapping-unverified', attempted: 18, accounted: 18, failed: 0, mappingComplete: false }
}, '2026-07-20');
assert.strictEqual(result.ok, false, 'unproven one-to-one mapping was labeled successful');
assert(/one-to-one Athena-to-calendar mapping/i.test(result.message), 'mapping-only refusal was mislabeled as an appointment save failure');

result = classify({
  ok: false, complete: false, reason: 'calendar-partial',
  calendarReceipt: {
    failureClass: 'save-failed', attempted: 18, accounted: 17, failed: 1, mappingComplete: false,
    failureReasons: { 'appointment-create-http': 1 }
  }
}, '2026-07-20');
assert.strictEqual(result.ok, false, 'backend calendar write failure was labeled successful');
assert(/1 calendar save\/update request failed/i.test(result.message), 'actual backend write failure did not name the failed write count');

result = classify({
  ok: false, complete: false, reason: 'calendar-partial',
  calendarReceipt: {
    failureClass: 'save-failed', attempted: 18, accounted: 15, failed: 3,
    failureReasons: { 'appointment-update-http': 1, 'patient-not-resolved': 2 }
  }
}, '2026-07-20');
assert(/1 calendar save\/update request failed/i.test(result.message), 'mixed refusal types overstated the number of failed writes');
assert(!/3 calendar save\/update requests failed/i.test(result.message), 'total row refusals were mislabeled as failed writes');

/* "Schedule read, rows refused" must carry the full reconciliation ledger:
   expected, found, resolved (already-present vs new), unresolved + reasons. */
result = classify({
  ok: false, complete: false, reason: 'calendar-partial',
  scheduleReceipt: { expectedCount: 17, parsedCount: 17 },
  calendarReceipt: {
    failureClass: 'identity-unverified', attempted: 17, mapped: 16, skipped: 12, created: 4, failed: 1,
    failureReasons: { 'patient-not-resolved': 1 }
  }
}, '2026-07-20');
assert(/expected 17/.test(result.message) && /found 17/.test(result.message), 'refused rows lack expected/found counts');
assert(/resolved 16 \(12 already present, 4 new\)/.test(result.message), 'refused rows lack the resolved breakdown');
assert(/unresolved 1 — patient not resolved ×1/.test(result.message), 'unresolved rows lack their per-reason counts');

result = classify({
  ok: true, complete: true, reason: 'complete',
  scheduleReceipt: { parsedCount: 17 },
  historyReceipt: { requested: 17, processed: 17, complete: true }
}, '2026-07-15');
assert.strictEqual(result.ok, true, 'fully reconciled pull was not accepted');
assert(/17 appointment/.test(result.message) && /17 patient/.test(result.message), 'complete receipt summary omits reconciled counts');

result = classify({
  ok: true, complete: true, reason: 'complete',
  scheduleReceipt: { expectedCount: 17, parsedCount: 17 },
  calendarReceipt: { attempted: 17, mapped: 17, skipped: 13, created: 4, failed: 0 },
  historyReceipt: { requested: 17, processed: 17, complete: true }
}, '2026-07-15');
assert(/expected 17/.test(result.message) && /resolved 17 \(13 already present, 4 new\)/.test(result.message) && /unresolved 0/.test(result.message),
  'the complete verdict omits the reconciliation ledger');

result = classify({
  ok: true, complete: true, reason: 'empty-day',
  scheduleReceipt: { authoritativeEmpty: true, parsedCount: 0 },
  historyReceipt: { requested: 0, processed: 0, complete: true }
}, '2026-07-15');
assert.strictEqual(result.ok, true, 'authoritatively empty day was rejected');
assert(/verified.*no appointments/i.test(result.message), 'empty-day message does not state that Athena proved it empty');

assert(source.includes('r && r.ok === true && r.complete === true'), 'phone relay still accepts any fulfilled pull promise');
assert(!source.includes("setTimeout(function () { fin(true); }, 90000)"), 'phone relay still fabricates success after a timer');
assert(!moduleSource.includes("setTimeout(function () { done(true"), 'day strip still fabricates success after a timer');
assert(moduleSource.includes("'failureClass'"), 'copyable PHI-free pull report omits the calendar failure class');
assert(moduleSource.includes('dsSafeReasonCounts'), 'copyable pull report does not sanitize calendar reason histograms');

console.log('PASS schedule pull UI: success requires complete receipts; partial schedule/history and missing extension stay failed');

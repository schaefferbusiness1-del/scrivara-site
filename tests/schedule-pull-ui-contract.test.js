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
  setInterval() { return 1; }, clearInterval() {},
  setTimeout() { return 1; }, clearTimeout() {}
};
context.window = context;
vm.runInNewContext(moduleSource, context, { filename: 'day-switch.js' });

const classify = context.__mlsDaySwitch && context.__mlsDaySwitch.classifyPullResult;
assert.strictEqual(typeof classify, 'function', 'day pull result classifier is not exposed');

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
  ok: true, complete: true, reason: 'complete',
  scheduleReceipt: { parsedCount: 17 },
  historyReceipt: { requested: 17, processed: 17, complete: true }
}, '2026-07-15');
assert.strictEqual(result.ok, true, 'fully reconciled pull was not accepted');
assert(/17 appointment/.test(result.message) && /17 patient/.test(result.message), 'complete receipt summary omits reconciled counts');

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

console.log('PASS schedule pull UI: success requires complete receipts; partial schedule/history and missing extension stay failed');

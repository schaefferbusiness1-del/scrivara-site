'use strict';
/* The pulled-day note column is a historical compatibility surface. Current
   pull semantics do not create its rows: OFF is schedule-only, and ON reads
   full visit history through the ordinary unscoped all-visits lane. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeMonthHarness, flush } = require('./1p-pull-harness.js');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

async function main() {
  ok(src.includes('var pulledDayNoteLaneEnabled = false;'), 'inline day-note lane is active');
  ok(src.includes('var pulledDayNoteTailEnabled = false;'), 'tail day-note lane is active');
  ok(/function tnColumn\(/.test(src) && /function tnEmitDayNoteColumn\(/.test(src),
    'compatibility receipt rendering disappeared');
  ok(/r\.dn/.test(ui), 'the UI can no longer render historical day-note receipt data');

  const day = '2026-08-23';
  const off = makeMonthHarness({ today: '2026-08-24' });
  off.seedDay(day, 8);
  const offResult = await off.api.pull({ date: day, provider: off.provider,
    includeHistory: true, pullVisitBodies: false, onStatus: off.onStatus });
  eq(off.chartCalls.length, 0, 'OFF opened patient charts');
  eq(off.noteCalls.length, 0, 'OFF opened note bodies');
  eq(offResult.historyReceipt.reason, 'full-notes-off', 'OFF lacks its intentional skip receipt');
  eq(Number(offResult.historyReceipt.todayNoteFailures || 0), 0,
    'OFF invented unread pulled-day notes');
  eq(Number(offResult.historyReceipt.failures || 0), 0,
    'OFF turned an intentional skip into failed patient rows');
  eq((offResult.historyReceipt.retry || []).length, 0,
    'OFF queued skipped rows for retry/re-checking');

  const on = makeMonthHarness({ today: '2026-08-24' });
  on.seedDay(day, 8);
  await on.api.pull({ date: day, provider: on.provider,
    includeHistory: true, pullVisitBodies: true, onStatus: on.onStatus });
  const reads = on.posted.filter(message => message.type === 'mlsAppReadAllVisits');
  eq(reads.length, 8, 'ON did not read all eight patient histories');
  ok(reads.every(message => !(message.hint && message.hint.onlyDate)),
    'ON used the retired date-scoped day-note reader');
  eq(on.noteCalls.length, 0, 'ON duplicated note reads through the retired day-note lane');

  await flush(3);
  console.log('PASS 1p-daynote-column-and-not-yet: ' + checks +
    ' checks - OFF creates no chart, body, failure, or retry row; ON uses one unscoped all-visits read per patient; compatibility rendering remains available for historical receipts without driving new work');
}

main().catch(error => { console.error(error); process.exit(1); });

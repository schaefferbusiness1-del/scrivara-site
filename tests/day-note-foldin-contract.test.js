'use strict';
/* The old day-note fold-in intentionally no longer ships as an active lane.
   OFF is schedule-only. ON gets the same visit through the ordinary unscoped
   all-visits reader, without a second date-scoped chart open. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeMonthHarness, flush } = require('./1p-pull-harness.js');

const root = path.resolve(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

async function main() {
  ok(si.includes('var pulledDayNoteLaneEnabled = false;'), 'inline fold-in is active again');
  ok(si.includes('var pulledDayNoteTailEnabled = false;'), 'tail fold-in is active again');
  const legacyStart = mc.indexOf('var fullLeg = Promise.resolve();');
  const legacyEnd = mc.indexOf('} catch (eV) {}', legacyStart);
  ok(legacyStart > 0 && legacyEnd > legacyStart, 'legacy history helper boundary moved');
  const legacy = mc.slice(legacyStart, legacyEnd);
  ok(!/onlyDate/.test(legacy), 'legacy OFF branch still performs a date-scoped note read');

  const day = '2026-08-23';
  const off = makeMonthHarness({ today: '2026-08-24' });
  off.seedDay(day, 2);
  const offResult = await off.api.pull({ date: day, provider: off.provider,
    includeHistory: true, pullVisitBodies: false, onStatus: off.onStatus });
  eq(off.chartCalls.length, 0, 'OFF opened a chart');
  eq(off.noteCalls.length, 0, 'OFF opened a note body');
  eq(offResult.historyReceipt.reason, 'full-notes-off', 'OFF lacks its intentional skip receipt');

  const on = makeMonthHarness({ today: '2026-08-24' });
  on.seedDay(day, 2);
  await on.api.pull({ date: day, provider: on.provider,
    includeHistory: true, pullVisitBodies: true, onStatus: on.onStatus });
  const bodyReads = on.posted.filter(message => message.type === 'mlsAppReadAllVisits');
  eq(bodyReads.length, 2, 'ON did not read both patients through the all-visits lane');
  ok(bodyReads.every(message => !(message.hint && message.hint.onlyDate)),
    'ON used the retired date-scoped fold-in');
  eq(on.noteCalls.length, 0, 'ON duplicated the body walk through the retired fold-in');

  await flush(3);
  console.log('PASS day-note-foldin-contract: ' + checks +
    ' checks - OFF performs no chart/body read, ON performs one unscoped all-visits walk per patient, and both retired date-scoped fold-in passes stay disabled');
}

main().catch(error => { console.error(error); process.exit(1); });

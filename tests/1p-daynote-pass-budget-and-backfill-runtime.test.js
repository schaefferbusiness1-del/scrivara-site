'use strict';
/* =============================================================================
 * Full Notes boundary after the schedule-only redesign.
 *
 * The former version of this suite measured a special pulled-day-note pass
 * while Full visit notes was OFF. That behavior is intentionally retired:
 * OFF now means schedule/booking only, with zero patient-chart and note-body
 * opens. ON uses the ordinary unscoped all-visits reader, so the old second
 * chart-open pass, its budget, and its background backfill must stay dormant.
 *
 * This keeps the historical filename in the release gate while making the
 * current boundary executable in both directions. Synthetic rows only.
 * ============================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeMonthHarness, flush } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function staticRetirementContract() {
  ok(SRC.includes('var pulledDayNoteLaneEnabled = false;'),
    'the retired inline pulled-day-note lane can run again');
  ok(SRC.includes('var pulledDayNoteTailEnabled = false;'),
    'the retired pulled-day-note tail pass can run again');
  ok(SRC.includes('var fullNotesOff = visitNotesRequested === false;') &&
    SRC.includes('var includeHistory = visitNotesRequested === true && opts.includeHistory !== false && !fullNotesOff;'),
    'Full Notes OFF/ON choice does not close or open the chart/history phase at admission');
  ok(SRC.includes('var historyReceipt = (!fullNotesOff && includeHistory)') &&
    SRC.includes('reason: historySkipReason'),
    'OFF can still enter the body/history batch or lacks an honest skip receipt');
  ok(SRC.includes('if (receipt.visitNotesRequested !== true) return 0;'),
    'a dormant day-note helper can run without an explicit ON receipt');
}

async function explicitOffIsScheduleOnly() {
  const day = '2026-08-23';
  const h = makeMonthHarness({ today: '2026-08-24' });
  h.seedDay(day, 4);
  const result = await h.api.pull({
    date: day,
    provider: h.provider,
    includeHistory: true,
    pullVisitBodies: false,
    onStatus: h.onStatus
  });

  eq(h.chartCalls.length, 0, 'Full Notes OFF opened a patient chart');
  eq(h.noteCalls.length, 0, 'Full Notes OFF opened a visit-note body');
  eq(h.posted.filter(message => message.type === 'mlsAppReadAllVisits').length, 0,
    'Full Notes OFF emitted an all-visits reader request');
  eq(result.visitNotesRequested, false, 'OFF receipt lost its frozen choice');
  eq(result.visitNotesMode, 'not-requested', 'OFF receipt mislabels its mode');
  eq(result.historyReceipt && result.historyReceipt.reason, 'full-notes-off',
    'OFF did not record an intentional history skip');
  eq(Number(result.historyReceipt && result.historyReceipt.failures || 0), 0,
    'the intentional OFF skip was counted as a failure');
}

async function explicitOnUsesOneUnscopedReader() {
  const day = '2026-08-23';
  const h = makeMonthHarness({ today: '2026-08-24' });
  h.seedDay(day, 4);
  const result = await h.api.pull({
    date: day,
    provider: h.provider,
    pullVisitBodies: true,
    onStatus: h.onStatus
  });

  const bodyReads = h.posted.filter(message => message.type === 'mlsAppReadAllVisits');
  eq(bodyReads.length, 4, 'Full Notes ON did not issue one historical body walk per patient');
  ok(bodyReads.every(message => !(message.hint && message.hint.onlyDate)),
    'ON used the retired date-scoped second-pass reader');
  eq(h.noteCalls.length, 0,
    'ON also ran the retired pulled-day-note/backfill reader after the full body walk');
  eq(result.visitNotesRequested, true, 'ON receipt lost its frozen choice');
  eq(result.visitNotesMode, 'full', 'ON receipt mislabels its mode');
}

async function main() {
  staticRetirementContract();
  await explicitOffIsScheduleOnly();
  await explicitOnUsesOneUnscopedReader();
  await flush(3);
  console.log('PASS 1p-daynote-pass-budget-and-backfill: ' + checks +
    ' checks - the obsolete OFF-only pulled-day-note pass and backfill stay dormant; OFF performs schedule-only work with no chart/body opens, while ON uses one unscoped all-visits body walk per patient and no duplicate second pass');
}

const watchdog = setTimeout(() => {
  console.error(new Error('1p-daynote-pass-budget-and-backfill did not finish'));
  process.exit(1);
}, 120000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});

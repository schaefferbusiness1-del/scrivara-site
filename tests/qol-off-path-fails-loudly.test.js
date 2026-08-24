'use strict';
/* OFF no longer manufactures visit-note failures. It must finish honestly as
   an intentional schedule-only operation with no chart/body reads. */
const assert = require('assert');
const { makeMonthHarness, flush } = require('./1p-pull-harness.js');

(async () => {
  const day = '2026-08-23';
  const h = makeMonthHarness({ today: '2026-08-24' });
  h.seedDay(day, 3);
  const result = await h.api.pull({
    date: day,
    provider: h.provider,
    includeHistory: true,
    pullVisitBodies: false,
    onStatus: h.onStatus
  });

  assert.strictEqual(h.chartCalls.length, 0, 'OFF opened a patient chart');
  assert.strictEqual(h.noteCalls.length, 0, 'OFF opened a visit-note body');
  assert.strictEqual(h.posted.filter(message => message.type === 'mlsAppReadAllVisits').length, 0,
    'OFF emitted an all-visits body request');
  assert.strictEqual(result.historyReceipt.reason, 'full-notes-off',
    'OFF did not explain that history was intentionally skipped');
  assert.strictEqual(result.historyReceipt.visitNotesRequested, false,
    'OFF receipt lost its frozen choice');
  assert.strictEqual(Number(result.historyReceipt.failures || 0), 0,
    'intentional OFF work was reported as a failure');
  assert.strictEqual(Number(result.historyReceipt.todayNoteFailures || 0), 0,
    'OFF invented pulled-day note failures');
  await flush(3);
  console.log('qol-off-path-fails-loudly: OK (OFF is an explicit, honest full-notes-off skip with zero chart/body reads and zero invented note failures)');
})().catch(error => { console.error(error); process.exit(1); });

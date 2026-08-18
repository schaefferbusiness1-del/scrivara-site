'use strict';
/* =============================================================================
 * dnd-1.0.0  +  fd-1.0.0  -  the pulled day's own visit note
 *
 * TWO measured owner defects, one lane.
 *
 * (1) dnd-1.0.0 - "on 1p histories aren't saved correctly" / dayVerdict
 *     tnReasons {no-day-on-row:15}, MEASURED live 2026-08-17 on the owner's /1p
 *     for 2026-08-27 (15 appts, bodies OFF). CAUSE: frozenRetryEntry froze
 *     identity but NOT the schedule day, so buildRetryRows rebuilt DAY-LESS
 *     rows and every sweep / Retry round settled "no-day-on-row" - the one note
 *     the owner requires with bodies OFF was never even attempted.
 *
 * (2) fd-1.0.0 - MEASURED live 2026-08-17/18 on PRODUCTION (b1027, ext 3.0.62,
 *     bodies OFF, pulling TOMORROW): the batch sat at "Reading verified history
 *     2 of 14" for >75 s inside the day-note leg, 60-80 s PER ROW, for a day on
 *     which no encounter can exist. That is both the slowness and the "0 ok".
 *
 * Everything runs the REAL importer against a fake extension. Synthetic
 * names/DOB/MRN only; no network, no PHI.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness, flush } = require('./1p-pull-harness.js');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '1p-feat_mls_schedimport_exact.js'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* --------------------------------------------------------------- static -- */
{
  const a = SRC.indexOf('/* ===== fd-1.0.0 (a future day has no note to read) =====');
  const b = SRC.indexOf('/* ===== end fd-1.0.0 ===== */');
  ok(a >= 0 && b > a, 'the fd-1.0.0 block is missing or unclosed');
  ok(/function acctTodayKey\(/.test(SRC) && /function dayNoteFuture\(/.test(SRC),
    'fd-1.0.0 did not add acctTodayKey()/dayNoteFuture() beside normDate()');
  ok(/scheduleDate: normDate\(target\.scheduleDate \|\| row\.scheduleDate \|\| row\.date/.test(SRC),
    'frozenRetryEntry still does not freeze the schedule day (dnd-1.0.0)');
  ok(/function buildRetryRows\(retryEntries, scopeDay\)/.test(SRC),
    'buildRetryRows still takes no scope day (dnd-1.0.0)');
  ok(/DN_ROW_DEADLINE_MS/.test(SRC), 'the day-note read has no per-row deadline');
}

/* ------------------------------------------------- 1. TODAY reads the note */
async function testTodayReadsTheNote() {
  const DAY = '2026-08-17';
  const h = makeHarness({ day: DAY, today: DAY, rows: 15 });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(receipt.patients.length, 15, 'the batch did not reach all 15 synthetic rows');
  eq(h.noteCalls.length, 15, 'the pulled day\'s note was not read for every row (bodies OFF)');
  ok(h.noteCalls.every(c => c.onlyDate === DAY), 'a day-note read drifted off the pulled day');
  eq(receipt.todayNoteFailures, 0, 'a today-day pull still reports today-note failures');
  eq(Object.keys(receipt.todayNoteReasons || {}).length, 0, 'a fully read day still carries reasons');
  eq(receipt.day, DAY, 'the receipt does not state the day it read (dnd-1.0.0)');
}

/* ----------------------------- 2. retry rows KEEP the day (the owner's bug) */
async function testRetryRowsKeepTheDay() {
  const DAY = '2026-08-27';
  /* every chart read fails the way the owner's 13 rows failed, so every row
     lands in receipt.retry - which is what the Retry round rebuilds from. */
  const h = makeHarness({
    day: DAY, today: '2026-08-28', rows: 6,
    chartResult: () => ({ __throw: 'athenaOne patient search found no matching patient.' })
  });
  const first = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(first.retry.length, 6, 'the fixture did not produce six retry entries');
  ok(first.retry.every(r => r.scheduleDate === DAY),
    'a frozen retry entry lost the schedule day - this is the no-day-on-row cause');

  /* rebuild exactly as retryFailedHistory / the sweep do */
  const rebuilt = h.api._buildRetryRows
    ? h.api._buildRetryRows(first.retry, '')
    : null;
  if (rebuilt) {
    ok(rebuilt.rows.every(r => r.scheduleDate === DAY && r.date === DAY),
      'buildRetryRows rebuilt day-less rows even though the entries carry the day');
  }

  /* CAUSAL PROOF: strip the day off the frozen entries AND give the batch no
     scope day - the exact pre-fix state - and no-day-on-row comes back. */
  const stripped = first.retry.map(r => { const c = Object.assign({}, r); delete c.scheduleDate; return c; });
  const h2 = makeHarness({ day: DAY, today: '2026-08-28', rows: 6 });
  const dayless = h2.rows.map(r => { const c = Object.assign({}, r); delete c.scheduleDate; delete c.date; return c; });
  const before = h2.noteCalls.length;
  const r2 = await h2.api._runHistoryBatch(dayless, [], h2.onStatus);
  eq(h2.noteCalls.length - before, 0, 'a day-less row still attempted a day-note read');
  eq(r2.todayNoteFailures, 6, 'the pre-fix shape did not reproduce - the test proves nothing');
  eq(Number((r2.todayNoteReasons || {})['no-day-on-row'] || 0), 6,
    'the pre-fix shape did not settle no-day-on-row (non-vacuity check failed)');
  ok(stripped.length === 6, 'guard');

  /* and the CURE: the same day-less rows, handed the pull's own scope day. */
  const h3 = makeHarness({ day: DAY, today: '2026-08-28', rows: 6 });
  const dayless3 = h3.rows.map(r => { const c = Object.assign({}, r); delete c.scheduleDate; delete c.date; return c; });
  const r3 = await h3.api._runHistoryBatch(dayless3, [], h3.onStatus, { scopeDay: DAY });
  eq(h3.noteCalls.length, 6, 'the batch scope day did not rescue the day-less rows');
  eq(Number((r3.todayNoteReasons || {})['no-day-on-row'] || 0), 0,
    'no-day-on-row survived even with an explicit batch scope day');
}

/* ------------------------------------- 3. a FUTURE day is skipped, not read */
async function testFutureDayIsSkippedNotFailed() {
  const h = makeHarness({ day: '2026-08-18', today: '2026-08-17', rows: 14, noteDelayMs: 70000 });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(h.noteCalls.length, 0, 'the day-note reader ran for a day that has not happened yet');
  eq(receipt.todayNoteFailures, 0, 'a future day was counted as today-note FAILURES');
  eq(receipt.todayNoteSkippedFutureDay, 14, 'the receipt does not count the future-day skips');
  ok(receipt.patients.every(p => p.todayNote === 'future-day'),
    'a future-day row is not marked future-day');
  ok(receipt.patients.every(p => p.todayNoteSkipped === 'future-day'),
    'a future-day row carries no todayNoteSkipped stamp');
  eq(Number(receipt.todayNoteMsTotal || 0), 0,
    'a future day still spent time in the day-note leg');
  /* the whole point: 14 rows x 70s of day-note reads did NOT happen */
  ok(!Object.keys(receipt.todayNoteReasons || {}).some(k => k !== 'future-day'),
    'a future-day pull produced a real day-note failure reason');
}

/* ------------------------------------------- 4. a PAST day still reads it */
async function testPastDayStillReadsTheNote() {
  const h = makeHarness({ day: '2026-08-10', today: '2026-08-17', rows: 5 });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(h.noteCalls.length, 5, 'a PAST day stopped reading the pulled day\'s note - fd-1.0.0 over-reached');
  ok(h.noteCalls.every(c => c.onlyDate === '2026-08-10'), 'a past-day read drifted off the day');
  eq(receipt.todayNoteFailures, 0, 'a past-day read was reported as a failure');
  eq(Number(receipt.todayNoteSkippedFutureDay || 0), 0, 'a past day was mis-classified as future');
}

/* -------------------------------- 5. the per-row cost is MEASURED, not told */
async function testDayNoteCostIsMeasured() {
  /* dnp2-1.0.0 rescopes this fixture, it does not weaken it. The pass budget
     for a 4-row day is max(60 s, 4 x 10 s) = 60 s, so a 61 s-per-row fixture no
     longer measures four rows - it measures ONE row and three hand-offs, which
     is the whole point of the budget. Four 12 s reads (48 s, inside the budget)
     measure exactly what this case was written to measure. */
  const h = makeHarness({ day: '2026-08-17', today: '2026-08-17', rows: 4, noteDelayMs: 12000 });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(receipt.todayNoteAttempts, 4, 'the day-note leg did not record its attempts');
  eq(receipt.todayNoteMsTotal, 4 * 12000, 'the day-note leg did not record its total cost');
  eq(receipt.todayNoteMsMax, 12000, 'the day-note leg did not record its worst row');
  ok(receipt.patients.every(p => p.todayNoteMs === 12000),
    'a per-row day-note cost is missing from the receipt');
  eq(Number(receipt.todayNoteHandedOff || 0), 0,
    'a pass that fits inside its budget handed rows to the backfill anyway');

  /* and the SAME fixture at 61 s a row proves the budget bites: the pass stops
     after the row that spent it, and the rest are handed over - not read, and
     not counted as failures of the reader. */
  const over = makeHarness({ day: '2026-08-17', today: '2026-08-17', rows: 4, noteDelayMs: 61000 });
  const overReceipt = await over.api._runHistoryBatch(over.rows, [], over.onStatus);
  eq(over.noteCalls.length, 1, 'the pass budget did not stop the day-note leg (' + over.noteCalls.length + ' reads)');
  eq(Number(overReceipt.todayNotePassBudgetMs || 0), 60000, 'a 4-row day did not get the 60 s floor budget');
  eq(Number(overReceipt.todayNoteHandedOff || 0), 3, 'the remaining rows were not handed to the background backfill');
  eq(Number(overReceipt.todayNoteRead || 0), 1, 'the one row that fit was not recorded as read');
  ok(overReceipt.patients.filter(p => p.todayNoteHandedOff === true)
    .every(p => p.todayNoteReason === 'day-note-pass-budget-exhausted'),
    'a handed-over row does not name why it was handed over');
}

/* ----------------- 6. one slow row cannot stall the batch (bounded per row) */
async function testOneRowCannotStallTheBatch() {
  const src = SRC;
  const i = src.indexOf('function tnBoundedRead(vp, p, day, opts) {');
  ok(i >= 0, 'tnBoundedRead is missing');
  const block = src.slice(i, src.indexOf('}', src.indexOf('"pulled-day-note-deadline-exceeded"', i)));
  ok(/boundedUntil\(/.test(block), 'the day-note read is not bounded by an absolute deadline');
  /* pullfix3 (2026-08-17, measured 943 s day-note pass): the per-row bound is now
     tnRowDeadlineMs() - DN_ROW_DEADLINE_MS as the floor, raised adaptively from the
     rows this machine actually finished, capped at DN_ROW_DEADLINE_CAP_MS. The bound
     is still per row (never the day). */
  ok(/DN_ROW_DEADLINE_MS|tnRowDeadlineMs\(\)/.test(block), 'the day-note bound is not the per-row budget');
  const tnRowIdx = src.indexOf('function tnRowDeadlineMs()');
  ok(tnRowIdx >= 0, 'tnRowDeadlineMs is missing');
  ok(/DN_ROW_DEADLINE_MS/.test(src.slice(tnRowIdx, tnRowIdx + 400)), 'tnRowDeadlineMs must be anchored on DN_ROW_DEADLINE_MS (the per-row floor)');
  ok(/pulled-day-note-deadline-exceeded/.test(block),
    'the day-note bound does not refuse with a named, honest reason');
  /* every call site goes through the bound - a bare runForPatient in the
     day-note lane is the regression this pins. */
  const lane = src.slice(src.indexOf('dn-1.0 FOLD-IN'), src.indexOf('function finalizeVerdict'));
  eq((lane.match(/runForPatient\(/g) || []).length, 0,
    'the day-note lane still calls runForPatient directly instead of through tnBoundedRead');
}

async function main() {
  await testTodayReadsTheNote();
  await testRetryRowsKeepTheDay();
  await testFutureDayIsSkippedNotFailed();
  await testPastDayStillReadsTheNote();
  await testDayNoteCostIsMeasured();
  await testOneRowCannotStallTheBatch();
  await flush(5);
  console.log('PASS 1p-day-note-day-and-future: ' + checks + ' checks - the pulled day travels with every retry/sweep row so no-day-on-row cannot recur (proved causally in both directions), a FUTURE day is skipped as future-day rather than read or failed, TODAY and PAST days still read the day\'s own note with bodies OFF, and every day-note read is bounded per row with its cost measured on the receipt');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-day-note-day-and-future did not finish')); process.exit(1); }, 60000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });

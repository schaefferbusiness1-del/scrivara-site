'use strict';
/* =============================================================================
 * dnd-1.0.0  +  fd-1.0.0  -  the pulled day's own visit note
 *
 * TWO measured owner defects, one lane.
 *
 * (1) dnd-1.0.0 - "on 1p histories aren't saved correctly" / dayVerdict
 *     tnReasons {no-day-on-row:15}, MEASURED live 2026-08-17 on the owner's /1p
 *     for 2026-08-27 (15 appts). CAUSE: frozenRetryEntry froze identity but NOT
 *     the schedule day, so buildRetryRows rebuilt DAY-LESS rows and every sweep
 *     / Retry round settled "no-day-on-row" when Full visit notes was ON.
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

/* ------------------------------ 1. OFF is a clean history/body no-op */
async function testOffSkipsTheNoteBodyLane() {
  const DAY = '2026-08-17';
  const h = makeHarness({ day: DAY, today: DAY, rows: 15 });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(receipt.patients.length, 0, 'the OFF compatibility seam entered patient history rows');
  eq(receipt.processed, 0, 'the OFF compatibility seam reported patient charts processed');
  eq(receipt.requested, 0, 'the OFF compatibility seam reported history requested');
  eq(receipt.reason, 'visit-notes-off', 'the OFF compatibility seam did not name its intentional scope');
  eq(h.chartCalls.length, 0, 'Full visit notes OFF still opened patient charts');
  eq(h.noteCalls.length, 0, 'Full visit notes OFF still opened a pulled-day note body');
  eq(receipt.visitNotesRequested, false, 'the OFF receipt does not preserve the frozen choice');
  eq(receipt.visitNotesMode, 'not-requested', 'the OFF receipt mislabels its note-body mode');
  eq(Number(receipt.todayNoteRead || 0), 0, 'the OFF receipt claims a pulled-day note was read');
  eq(receipt.todayNoteFailures, 0, 'intentionally skipped note bodies were counted as failures');
}

/* ----------------------------- 2. retry rows KEEP the day (the owner's bug) */
async function testRetryRowsKeepTheDay() {
  const DAY = '2026-08-27';
  /* every chart read fails the way the owner's 13 rows failed, so every row
     lands in receipt.retry - which is what the Retry round rebuilds from. */
  const h = makeHarness({
    day: DAY, today: '2026-08-28', rows: 6, visitNotesOn: true,
    chartResult: () => ({ __throw: 'athenaOne patient search found no matching patient.' })
  });
  const first = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(first.retry.length, 6, 'the fixture did not produce six retry entries');
  ok(first.retry.every(r => r.scheduleDate === DAY),
    'a frozen retry entry lost the schedule day - this is the no-day-on-row cause');
  ok(first.retry.every((r, i) => r.appointmentId === 'appt-' + DAY + '-' + (i + 1)),
    'a frozen retry entry lost the exact Athena appointment id and would degrade to name search');

  /* rebuild exactly as retryFailedHistory / the sweep do */
  const rebuilt = h.api._buildRetryRows
    ? h.api._buildRetryRows(first.retry, '')
    : null;
  if (rebuilt) {
    ok(rebuilt.rows.every(r => r.scheduleDate === DAY && r.date === DAY),
      'buildRetryRows rebuilt day-less rows even though the entries carry the day');
    ok(rebuilt.rows.every((r, i) => r.appointmentId === 'appt-' + DAY + '-' + (i + 1) && r.athenaAppointmentId === r.appointmentId),
      'buildRetryRows dropped the frozen exact Athena appointment binding');
  }

  /* CAUSAL PROOF: strip the day off the frozen entries. Without an explicit
     scope, the rebuilt rows remain day-less; with the pull's frozen scope,
     every row recovers the exact date. This proves the repaired seam without
     invoking the visit-body reader. */
  const stripped = first.retry.map(r => { const c = Object.assign({}, r); delete c.scheduleDate; return c; });
  const withoutScope = h.api._buildRetryRows(stripped, '');
  ok(withoutScope.rows.every(r => !r.scheduleDate && !r.date),
    'the causal control manufactured a day even though both entry and scope were empty');
  const withScope = h.api._buildRetryRows(stripped, DAY);
  ok(withScope.rows.every(r => r.scheduleDate === DAY && r.date === DAY),
    'the frozen pull scope did not restore the day onto stripped retry entries');
  eq(h.noteCalls.length, 0, 'failed chart retry bookkeeping opened a visit-note body');
}

/* ------------------ 3. a future-day body read has an explicit hard refusal */
function testFutureDayIsStaticallyRefused() {
  const start = SRC.indexOf('function dayNoteFuture(');
  const end = SRC.indexOf('/* ===== end dnf-1.0.0', start);
  ok(start >= 0 && end > start, 'the future-day refusal helper moved or disappeared');
  const block = SRC.slice(start, end);
  ok(/acctTodayKey\(\)/.test(block), 'future-day comparison is not account-day scoped');
  ok(/return !!\(d && t && d > t\)/.test(block),
    'future-day refusal no longer requires a valid day strictly after account today');
}

/* ----------------- 4. one slow row cannot stall the ON lane (static guard) */
function testOneRowCannotStallTheBatch() {
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
  await testOffSkipsTheNoteBodyLane();
  await testRetryRowsKeepTheDay();
  testFutureDayIsStaticallyRefused();
  testOneRowCannotStallTheBatch();
  await flush(5);
  console.log('PASS 1p-day-note-day-and-future: ' + checks + ' checks - Full visit notes OFF opens zero charts and bodies; ON retry rows retain the frozen pull day; future-day and per-row deadline guards remain in the legacy compatibility reader.');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-day-note-day-and-future did not finish')); process.exit(1); }, 60000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });

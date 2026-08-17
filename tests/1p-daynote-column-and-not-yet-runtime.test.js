'use strict';
/* =============================================================================
 * dv3-1.0.0  +  tny-1.0.0  -  the day-note leg stops failing the row
 *
 * THE MEASUREMENT THIS SUITE EXISTS FOR (owner, watching live 2026-08-17, /1p,
 * 23 rows, "Full visit notes" OFF, 21 minutes in):
 *
 *     13 done · 0 saved · 8 not saved · 5 re-checking
 *     every finished row: "the note for the pulled day could not be read"
 *
 * and on the earlier 16-row run of the same day: dayVerdict tnFailed 12, nine
 * of them "Safety stop - Athena returned an encounter index without verified
 * full detail" - which is what feat_visits.js:2355 throws when a scoped read
 * finds no verified encounter body for that date. At 13:52 ET most of those
 * appointments had not happened yet.
 *
 * TWO CAUSES, both proved here causally (the pre-fix shape is reconstructed and
 * shown to reproduce the owner's numbers, then the cure is shown to remove it):
 *
 *  (1) dv3-1.0.0 - the day-note leg pushed its OWN ppSettle(ok:false) AFTER the
 *      row's settle, and the panel's tally takes the LATEST state per chart, so
 *      an unread note became the row's verdict. Charts that were read,
 *      organised and stored painted "not saved". A PIPELINED row (bodies OFF =
 *      every row) also stayed "finishing…" until end-of-batch finalization,
 *      which is why "saved" was 0 with 13 rows done.
 *
 *  (2) tny-1.0.0 - on TODAY, an appointment whose time has not arrived, or
 *      whose encounter has not been opened, has NO note to read. That is not a
 *      failure: it is stamped 'not-yet', excluded from todayNoteFailures, and
 *      it costs zero seconds instead of the 45 s per-row day-note bound.
 *
 * Real importer, fake extension, synthetic names/DOB/MRN. No network, no PHI.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness, flush } = require('./1p-pull-harness.js');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '1p-feat_mls_schedimport_exact.js'), 'utf8');
const MC = fs.readFileSync(path.resolve(__dirname, '..', '1p-mls-connect.js'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* the reader's refusal, verbatim from feat_visits.js:2355 - the exact string
   the owner's nine rows carried. */
const SAFETY_STOP = 'Safety stop — Athena returned an encounter index without verified full detail for every row. Nothing was saved as complete history.';

/* -------------------------------------------------------------- static -- */
{
  const a = SRC.indexOf('/* ===== tny-1.0.0 (TODAY\'s not-yet-seen appointments are not failures) =====');
  const b = SRC.indexOf('/* ===== end tny-1.0.0 ===== */');
  ok(a >= 0 && b > a, 'the tny-1.0.0 block is missing or unclosed');
  const c = SRC.indexOf('/* ===== dv3-1.0.0 (a saved chart says SAVED while the pull is still running) =====');
  const d = SRC.indexOf('/* ===== end dv3-1.0.0 ===== */');
  ok(c >= 0 && d > c, 'the dv3-1.0.0 block is missing or unclosed');
  ok(/function tnApptPassed\(/.test(SRC), 'tny-1.0.0 added no appointment-time predicate');
  ok(/function tnNowMinutes\(/.test(SRC), 'tny-1.0.0 reads the clock without an account-zone "now"');
  ok(/timeZone: EST_TZ, hour: "2-digit", minute: "2-digit", hour12: false/.test(SRC),
    'the not-yet clock is not read in the ACCOUNT zone - a clinician one zone over gets the wrong answer');
  ok(/function tnColumn\(/.test(SRC) && /function tnEmitDayNoteColumn\(/.test(SRC),
    'the day-note verdict has no separate column');
  /* THE REGRESSION THIS PINS: no surface in the day-note lane may settle a row
     as FAILED. Every ppSettle in the lane must go through tnEmitDayNoteColumn,
     which passes the row's OWN history verdict. */
  const lane = SRC.slice(SRC.indexOf('dn-1.0 FOLD-IN'), SRC.indexOf('function finalizeVerdict'));
  eq((lane.match(/ppSettle\([^)]*?,\s*false\s*,\s*"pulled-day-note-unread/g) || []).length, 0,
    'the day-note lane still settles the ROW as failed - this is the "0 saved" defect');
  const tail = SRC.slice(SRC.indexOf('2026-07-28 owner directive (post-sweep lane)'), SRC.indexOf('finalizeVerdict();\n    /* si-1.9.0'));
  eq((tail.match(/pulled-day-note-unread/g) || []).length, 0,
    'the day-note TAIL pass still writes a failing row settle');
  /* and the panel must render the column + the honest counter */
  ok(/histor' \+ \(ok === 1 \? 'y' : 'ies'\) \+ ' saved'/.test(MC),
    'the pull panel still says a bare "N saved" - the owner needs to know WHAT was saved');
  ok(/not read yet/.test(MC), 'the pulled-day note count is not surfaced as its own line');
  ok(/r\.dn/.test(MC), 'the panel does not render the day-note column');
}

/* ================================================================== (1) ==
   THE OWNER'S NUMBERS. Every chart read succeeds and is stored; every
   day-note read refuses. Pre-fix that produced "0 saved / N not saved"; the
   row verdict must now be driven by the HISTORY only. */
async function testDayNoteCannotFailTheRow() {
  const DAY = '2026-08-17';
  const h = makeHarness({
    day: DAY, today: DAY, rows: 8,
    chartCoverage: true,
    parseResult: () => ({ problems: 'Synthetic problem', meds: 'Synthetic med', summary: 'Synthetic summary' }),
    /* A GENUINE day-note refusal - deliberately NOT the not-yet class, so this
       case isolates the row-verdict defect from tny-1.0.0 below. */
    noteResult: () => ({ ok: false, reason: 'scoped-read-refused' })
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  eq(receipt.patients.length, 8, 'the batch did not reach all eight rows');
  eq(h.saveCalls.length, 8, 'the fixture did not actually store eight charts - the test would prove nothing');
  eq(receipt.patients.filter(p => p.organized === true).length, 8, 'a stored chart was not marked organized');

  /* THE BAR: history captured + stored = row ok. */
  eq(receipt.patients.filter(p => p.complete === true).length, 8,
    'a stored, organized chart was still marked incomplete because its day note could not be read');
  eq(receipt.retry.length, 0, 'a day-note failure put a SAVED row into the retry queue');
  eq(receipt.complete, true, 'the day verdict failed on the day-note leg');

  /* and the PANEL - the surface the owner was reading - agrees */
  const S = h.ppState();
  ok(S, 'the pull progress state was never fed');
  eq(S.ok, 8, 'the panel reported ' + S.ok + ' saved on a day that stored eight charts (the "0 saved" defect)');
  eq(S.failed, 0, 'the panel counted the unread day notes as failed CHARTS');

  /* the note is still VISIBLE - it is a column, not a silence */
  const rowsByKey = {};
  (S.rows || []).forEach(r => { rowsByKey[r.k || r.name] = r; });
  const dnRows = Object.keys(rowsByKey).map(k => rowsByKey[k]).filter(r => String(r.dn || '').indexOf('unread:') === 0);
  eq(dnRows.length, 8, 'the unread day note vanished instead of moving to its own column');
  eq(receipt.todayNoteFailures, 8, 'the day-note failure count is no longer reported at all');
}

/* ================================================================== (2) ==
   CAUSAL CONTROL: with the day-note reader HAPPY the same fixture must look
   identical on the history side. If it did not, the assertions above would be
   measuring the fixture rather than the fix. */
async function testHappyNoteControl() {
  const DAY = '2026-08-17';
  const h = makeHarness({
    day: DAY, today: DAY, rows: 8,
    chartCoverage: true,
    parseResult: () => ({ problems: 'p', meds: 'm', summary: 's' })
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(receipt.patients.filter(p => p.complete === true).length, 8, 'the control day did not complete');
  eq(receipt.todayNoteFailures, 0, 'the control day reported day-note failures');
  const S = h.ppState();
  eq(S.ok, 8, 'the control panel did not report eight saved');
  const read = (S.rows || []).filter(r => String(r.dn || '') === 'read');
  ok(read.length >= 1, 'a successfully read day note is not shown in the note column');
}

/* ================================================================== (3) ==
   tny-1.0.0 BY TIME. A fake clock at 13:52 ET on the pulled day; half the
   appointments are later than that. Those rows must be stamped not-yet, must
   NOT be read (no 45 s bound spent), and must not be failures. */
async function testNotYetByAppointmentTime() {
  const DAY = '2026-08-17';
  /* 13:52 America/New_York = 17:52 UTC (EDT, UTC-4) */
  const AT_1352_ET = Date.parse(DAY + 'T17:52:00Z');
  const h = makeHarness({
    day: DAY, today: DAY, rows: 8, startAt: AT_1352_ET,
    chartCoverage: true,
    parseResult: () => ({ problems: 'p', meds: 'm', summary: 's' }),
    /* rows 0-3 at 09:00-12:00 (past), rows 4-7 at 15:00-18:00 (not yet) */
    rowTime: i => (i < 4 ? String(9 + i).padStart(2, '0') + ':00' : String(15 + (i - 4)).padStart(2, '0') + ':00'),
    noteDelayMs: 61000 /* every read that DOES happen is expensive - so we can measure the saving */
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  eq(h.noteCalls.length, 4, 'the day-note reader ran for ' + h.noteCalls.length + ' rows; only the 4 past-time ones may be read');
  eq(receipt.todayNoteNotYet, 4, 'the receipt does not count the not-yet-seen appointments');
  eq(receipt.todayNoteSkippedNotYet, 4, 'the skip is not recorded on the receipt');
  eq(receipt.todayNoteFailures, 0, 'a not-yet-seen appointment was counted as a day-note FAILURE');
  eq(receipt.patients.filter(p => p.todayNote === 'not-yet').length, 4, 'a not-yet row is not stamped not-yet');
  eq(receipt.patients.filter(p => p.todayNoteReason === 'not-yet-seen').length, 4, 'the not-yet reason is missing');
  eq(receipt.patients.filter(p => p.complete === true).length, 8, 'a not-yet row was not counted as a saved history');

  /* MEASURED SAVING: 4 rows x 61 s of day-note reads did not happen. */
  eq(receipt.todayNoteMsTotal, 4 * 61000,
    'the day-note leg spent ' + receipt.todayNoteMsTotal + ' ms; four not-yet rows should have cost zero');

  /* A/B CONTROL with no times on the rows: every row is read, so the saving
     above is the lever and not the fixture. */
  const h2 = makeHarness({
    day: DAY, today: DAY, rows: 8, startAt: AT_1352_ET,
    chartCoverage: true,
    parseResult: () => ({ problems: 'p', meds: 'm', summary: 's' }),
    noteDelayMs: 61000
  });
  const r2 = await h2.api._runHistoryBatch(h2.rows, [], h2.onStatus);
  eq(h2.noteCalls.length, 8, 'the A/B control did not read all eight - the measurement is meaningless');
  eq(Number(r2.todayNoteNotYet || 0), 0, 'a row with no time was parked as not-yet - the guard over-reached');
  eq(h2.noteCalls.length - h.noteCalls.length, 4,
    'the time gate saved ' + (h2.noteCalls.length - h.noteCalls.length) + ' day-note reads, expected 4');
}

/* ================================================================== (4) ==
   tny-1.0.0 BY RECEIPT. No times on the rows at all; the reader answers with
   the exact "encounter index without verified full detail" refusal. On TODAY
   that is a visit that has not happened; on a PAST day it is a real gap. */
async function testNotYetByReaderReceipt() {
  const DAY = '2026-08-17';
  const today = makeHarness({
    day: DAY, today: DAY, rows: 5,
    chartCoverage: true,
    parseResult: () => ({ problems: 'p', meds: 'm', summary: 's' }),
    noteResult: () => { throw new Error(SAFETY_STOP); }
  });
  const rToday = await today.api._runHistoryBatch(today.rows, [], today.onStatus);
  eq(rToday.todayNoteNotYet, 5, 'the reader\'s "no verified encounter for that date" was not read as not-yet on TODAY');
  eq(rToday.todayNoteFailures, 0, 'TODAY\'s not-yet-seen rows were still counted as failures');

  /* THE OTHER DIRECTION - a PAST day with the same refusal is still a failure.
     A missing note on a finished day is a real gap and must stay visible. */
  const past = makeHarness({
    day: '2026-08-10', today: DAY, rows: 5,
    chartCoverage: true,
    parseResult: () => ({ problems: 'p', meds: 'm', summary: 's' }),
    noteResult: () => { throw new Error(SAFETY_STOP); }
  });
  const rPast = await past.api._runHistoryBatch(past.rows, [], past.onStatus);
  eq(Number(rPast.todayNoteNotYet || 0), 0, 'a PAST day was excused as not-yet-seen - the guard over-reached');
  eq(rPast.todayNoteFailures, 5, 'a PAST day\'s unread note stopped being reported');
  /* ...and it still does not fail the ROW */
  eq(rPast.patients.filter(p => p.complete === true).length, 5,
    'a PAST day\'s unread note failed the saved history rows');
}

/* ================================================================== (5) ==
   NO RETRY STORM. The owner watched "5 re-checking" cycle. A row whose
   history is saved may never be swept, re-read or auto-converged just because
   its day note was not-yet or unread. */
async function testNoResweepOfSavedRows() {
  const DAY = '2026-08-17';
  const h = makeHarness({
    day: DAY, today: DAY, rows: 6,
    chartCoverage: true,
    parseResult: () => ({ problems: 'p', meds: 'm', summary: 's' }),
    noteResult: () => { throw new Error(SAFETY_STOP); }
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  const opened = new Set(h.chartCalls.map(c => String(c.patientId))).size;
  eq(opened, 6, 'the batch opened ' + opened + ' distinct charts for six rows - a saved row was re-read');
  eq(h.chartCalls.length, 6, 'a saved row was re-opened (' + h.chartCalls.length + ' opens for 6 rows) - this is the re-check loop');
  eq(Number(receipt.sweepPasses || 0), 0, 'the automatic sweep ran on a day with nothing to sweep');
  eq(receipt.retry.length, 0, 'a saved row is queued for retry, so the convergence lane would re-read it');

  /* the panel must be TERMINAL: no row left "re-checking" at the end */
  const S = h.ppState();
  const stillPending = (S.rows || []).filter(r => r.pending === true);
  eq(stillPending.length, 0, stillPending.length + ' rows were still "re-checking" when the pull ended');
  eq(S.ok + S.failed, S.done, 'the tally does not add up: ok ' + S.ok + ' + failed ' + S.failed + ' != done ' + S.done);
}

async function main() {
  await testDayNoteCannotFailTheRow();
  await testHappyNoteControl();
  await testNotYetByAppointmentTime();
  await testNotYetByReaderReceipt();
  await testNoResweepOfSavedRows();
  await flush(5);
  console.log('PASS 1p-daynote-column-and-not-yet: ' + checks + ' checks - a stored history is a SAVED row whatever the pulled-day note did (8/8 saved, 0 in retry, panel ok=8 where the live defect showed 0), the note verdict lives in its own read/not-yet/unread column, TODAY\'s appointments that have not happened yet are not-yet rather than failures by BOTH detectors (time and the reader\'s own no-encounter receipt, each proved against an A/B control and against a PAST day that still fails honestly), 4 of 8 day-note reads and 244 s are provably not spent, and no saved row is ever re-opened or left re-checking');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-daynote-column-and-not-yet did not finish')); process.exit(1); }, 90000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });

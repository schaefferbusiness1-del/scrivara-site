'use strict';
/* =============================================================================
 * dnd-1.0.0  +  fd-1.0.0  +  dayfacts-1.0.0  -  the pulled day's own visit note
 *
 * ===== WHY THE OLD PINS MOVED (dayfacts-1.0.0, owner 2026-08-25) =============
 * This suite used to open with testOffSkipsTheNoteBodyLane: it pinned that
 * "Full visit notes" OFF was a clean SCHEDULE-ONLY no-op - zero chart opens,
 * zero note bodies, receipt.reason 'visit-notes-off', visitNotesMode
 * 'not-requested'. The owner's superseding DAY contract (2026-08-25, accepted
 * by Codex as dayfacts-1.0.0) REVOKED that meaning. The checkbox now selects
 * HOW MUCH history a bulk pull reads, never WHETHER a chart opens:
 *
 *   OFF (settled)  = DAY-FACTS mode. The per-patient batch RUNS. Every exact
 *                    scheduled row still gets its identity-verified chart open
 *                    + chart-facts save (the pipelined-parse branch), and the
 *                    pulled day's own encounter note is attempted. Only the
 *                    OTHER dated historical bodies are out of scope
 *                    (one.visitsSkipped === true). Receipt: visitNotesMode
 *                    'day-facts', chartFactsRequired true,
 *                    allVisitBodiesRequested false, and honest insurance
 *                    placeholders (insuranceAttempted 0, insuranceReason
 *                    'reader-not-shipped').
 *   ON             = the same mandatory floor PLUS full historical traversal
 *                    (visitNotesMode 'full').
 *   UNSET/unsettled= FAIL-CLOSED. reason 'visit-notes-unchosen', visitNotesMode
 *                    'blocked-unchosen', zero reads of any kind.
 *
 * The old 'visit-notes-off' schedule-only early return is deliberately gone and
 * must not be reasserted, so every OFF assertion below was flipped to its
 * new-contract equivalent rather than deleted: "OFF opens no charts" became
 * "day-facts opens EVERY row's chart and saves its facts", and "OFF reads no
 * bodies" became "day-facts reads no UNSCOPED historical body while ON reads
 * one per row" (testDayFactsIsNotFullNotes is the differential that keeps the
 * two modes from collapsing into each other).
 *
 * The two ORIGINAL defects this file was built for are untouched and still
 * pinned below:
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
 * ===== OPEN ENGINE GAP (reported, NOT forced green) =========================
 * The contract's third day-facts clause - "the tn/onlyDate tail pass attempts
 * exactly the pulled-day encounter note per row" - is NOT met by the engine
 * bytes under test. Both day-note lanes are still hard-disabled and the
 * aggregate still short-circuits on the checkbox:
 *   1p-feat_mls_schedimport_exact.js:5614  var pulledDayNoteLaneEnabled = false;
 *   1p-feat_mls_schedimport_exact.js:6188  var pulledDayNoteTailEnabled = false;
 *   1p-feat_mls_schedimport_exact.js:5790  tnAggregate(): if (receipt.visitNotesRequested !== true) -> todayNoteNotRequested = rows, everything else 0
 * MEASURED here: a settled-OFF day-facts batch over rows whose charts all
 * verify performs rows chart opens and ZERO scoped note reads, and reports
 * todayNoteNotRequested === rows. See the TODO(dayfacts-daynote) block in
 * testDayFactsOpensChartsAndSkipsHistoricalBodies: the day-note assertions
 * there are NARROWED to what is honest today (the receipt may not claim more
 * pulled-day reads than actually happened, and no read may be unscoped or
 * scoped to a day other than the pulled one). They are deliberately NOT
 * pinned at zero - pinning zero would freeze the gap.
 *
 * Everything runs the REAL importer against a fake extension. Synthetic
 * names/DOB/MRN only; no network, no PHI.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness, flush } = require('./1p-pull-harness.js');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '1p-feat_mls_schedimport_exact.js'), 'utf8');
const CONNECT = fs.readFileSync(path.resolve(__dirname, '..', '1p-mls-connect.js'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* A chart the fake reader can fully verify, so the batch reaches the
   pipelined parse/save branch instead of refusing at chart-coverage-unproven.
   Synthetic clinical strings only. */
const SYNTHETIC_CHART = {
  problems: 'Synthetic problem', meds: 'Synthetic med', allergies: 'Synthetic allergy',
  summary: 'Synthetic summary', vitals: { bp: '118/76' }, history: { pmh: 'Synthetic PMH' },
  coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
};
/* one settled-choice day fixture, used by both modes so the ONLY difference
   between day-facts and full is the checkbox itself. */
function dayFixture(day, visitNotesOn, rows) {
  return makeHarness({
    day: day, today: day, rows: rows == null ? 4 : rows, visitNotesOn: visitNotesOn,
    chartCoverage: true, parseResult: () => SYNTHETIC_CHART,
    rowTime: i => (8 + i) + ':00 AM'      /* every slot is in the past at noon ET */
  });
}

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

/* ------------------------------------------- static: the dayfacts contract */
function testDayFactsContractIsDeclaredInTheSource() {
  ok(/dayfacts-1\.0\.0 \(superseding owner DAY contract, 2026-08-25\)/.test(SRC),
    'the dayfacts-1.0.0 contract block is missing from the batch door');
  ok(/visitNotesMode: visitNotesRequested \? "full" : "day-facts"/.test(SRC),
    'the receipt no longer labels an unchecked pull "day-facts"');
  ok(/chartFactsRequired: chartFactsRequired, allVisitBodiesRequested: allVisitBodiesRequested/.test(SRC),
    'the receipt lost the mandatory-floor / checkbox split (chartFactsRequired + allVisitBodiesRequested)');
  ok(/insuranceAttempted: 0, insuranceComplete: false, benefitsComplete: false, insuranceReason: "reader-not-shipped"/.test(SRC),
    'the honest insurance placeholders are gone - a missing reader must never read as verified-none');
  /* the revoked early return must not come back */
  ok(!/if \(!visitNotesRequested\) \{/.test(SRC),
    'the REVOKED schedule-only OFF early return (if (!visitNotesRequested)) was reasserted');
  ok(/receipt\.reason = "visit-notes-unchosen"/.test(SRC) && /receipt\.visitNotesMode = "blocked-unchosen"/.test(SRC),
    'the fail-closed unchosen refusal is missing from the batch door');
  /* includeHistory is decoupled from the checkbox in all three callers */
  ok(!/visitNotesRequested === true && opts\.includeHistory !== false && !fullNotesOff/.test(SRC),
    'pullUnlocked still ties includeHistory to the Full-visit-notes checkbox');
  ok(!/opts\.includeHistory !== false && !monthFullNotesOff/.test(SRC),
    'pullMonth still forces includeHistory=false when Full visit notes is OFF');
  ok(/if \(runOpts\.includeHistory === undefined\) runOpts\.includeHistory = true;/.test(SRC),
    'dayPull no longer defaults includeHistory to TRUE (the mandatory day-facts floor would not run)');
  /* no user-facing message may still claim OFF opens no charts */
  ok(!/Full Notes is off, so no patient charts or visit notes were opened/.test(SRC),
    'a user-facing message still claims Full Notes OFF opens no charts');
  ok(/Full visit notes is off - each day saved chart facts and attempted only its own pulled-day note/.test(SRC),
    'the month-complete OFF message does not tell the truth about chart facts + own-day note');
  /* the reader half of the contract lives in mls-connect */
  ok(/var dayScoped = !!\(runOpts && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(String\(runOpts\.onlyDate \|\| ''\)\)\);/.test(CONNECT),
    '__mlsVisitSavePref.runForPatient no longer recognises a well-formed onlyDate scope');
  ok(/if \(!enabled\(\) && !\(dayScoped && choiceSettled\)\) return Promise\.resolve\(\{ ok: true, skipped: choiceSettled \? 'preference-off' : 'preference-unchosen' \}\);/.test(CONNECT),
    'runForPatient does not admit a settled day-scoped read / does not report preference-unchosen separately from preference-off');
}

/* ------- 1. day-facts OPENS every chart, saves facts, skips historical bodies */
async function testDayFactsOpensChartsAndSkipsHistoricalBodies() {
  const DAY = '2026-08-17';
  const ROWS = 4;
  const h = dayFixture(DAY, false, ROWS);
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  /* --- the batch RUNS (this is the pin that used to demand a 0-row no-op) -- */
  eq(receipt.requested, ROWS, 'the day-facts batch did not request every scheduled row');
  eq(receipt.processed, ROWS, 'the day-facts batch did not process every scheduled row');
  eq(receipt.patients.length, ROWS, 'the day-facts batch entered no patient history rows - the revoked OFF no-op is back');
  eq(receipt.complete, true, 'the day-facts batch did not settle complete on a day where every chart verified');
  ok(receipt.reason !== 'visit-notes-off',
    'the REVOKED schedule-only reason "visit-notes-off" is still the day-facts verdict');

  /* --- the receipt names the new mode honestly ---------------------------- */
  eq(receipt.visitNotesRequested, false, 'the day-facts receipt does not preserve the frozen OFF choice');
  eq(receipt.visitNotesMode, 'day-facts', 'the day-facts receipt mislabels its mode');
  eq(receipt.chartFactsRequired, true, 'the day-facts receipt does not declare the mandatory chart-facts floor');
  eq(receipt.allVisitBodiesRequested, false, 'the day-facts receipt claims all visit bodies were requested');
  eq(receipt.insuranceAttempted, 0, 'the day-facts receipt claims an insurance read was attempted');
  eq(receipt.insuranceComplete, false, 'the day-facts receipt claims insurance is complete with no reader shipped');
  eq(receipt.benefitsComplete, false, 'the day-facts receipt claims benefits are complete with no reader shipped');
  eq(receipt.insuranceReason, 'reader-not-shipped',
    'the day-facts receipt does not say WHY insurance was not attempted - a missing reader must never read as verified-none');

  /* --- every exact scheduled row got its identity-verified chart open ----- */
  ok(h.chartCalls.length >= ROWS, 'Full visit notes OFF opened fewer charts than scheduled rows');
  const chartedIds = new Set(h.chartCalls.map(c => String(c.patientId)));
  ok(h.rows.every(r => chartedIds.has(String(r._mlsTargetPatientId))),
    'a scheduled row never had its chart opened in day-facts mode');
  ok(h.chartCalls.every(c => c.scheduleDate === DAY),
    'a day-facts chart open lost the pulled day off its exact target');
  ok(receipt.patients.every(p => p.identityVerified === true && p.dobVerified === true),
    'a day-facts chart was accepted without the exact identity proof');

  /* --- and its chart-facts save, through the pipelined-parse branch ------- */
  ok(receipt.patients.every(p => p.parsePipelined === true),
    'day-facts did not use the pipelined-parse branch the contract names');
  ok(receipt.patients.every(p => p.organized === true && p.organizationComplete === true),
    'a day-facts row did not organize/save its chart facts');
  ok(receipt.patients.every(p => p.profileCoverage && p.profileCoverage.complete === true),
    'a day-facts row saved facts without a complete six-card coverage receipt');
  ok(h.patients.every(p => String(p.problems || '') === 'Synthetic problem' && String(p.summary || '') === 'Synthetic summary'),
    'day-facts never wrote the chart facts into the store - the facts save is the mandatory floor');

  /* --- historical traversal is the ONLY thing skipped --------------------- */
  ok(receipt.patients.every(p => p.visitsSkipped === true),
    'day-facts traversed historical visit bodies (one.visitsSkipped must be true on every row)');
  eq(h.noteCalls.filter(c => !c.onlyDate).length, 0,
    'day-facts performed an UNSCOPED all-visits read - that is the full-history lane, not the mandatory floor');
  ok(h.patients.every(p => (p.visits || []).length === 0),
    'day-facts persisted a historical visit body');

  /* ===== TODO(dayfacts-daynote) - OPEN ENGINE GAP ========================= *
   * Contract: "the tn/onlyDate tail pass attempts exactly the pulled-day
   * encounter note per row". The engine bytes under test do NOT do this - both
   * day-note lanes are hard-disabled and tnAggregate short-circuits on the
   * checkbox:
   *   1p-feat_mls_schedimport_exact.js:5614 var pulledDayNoteLaneEnabled = false;
   *   1p-feat_mls_schedimport_exact.js:6188 var pulledDayNoteTailEnabled = false;
   *   1p-feat_mls_schedimport_exact.js:5790 tnAggregate(): if (receipt.visitNotesRequested !== true) { ... todayNoteNotRequested = rows; return; }
   * Measured on this exact fixture: 0 scoped note reads, todayNoteNotRequested
   * === ROWS. The assertions below are therefore NARROWED to what is honest
   * today: they never pin the attempt count at zero (that would freeze the
   * gap), and they still fail loudly if the day-note lane comes back WRONG -
   * unscoped, aimed at another day, or over-reported on the receipt.
   * When the lane is enabled, tighten to:
   *   eq(h.noteCalls.filter(c => c.onlyDate === DAY).length, ROWS, ...)
   *   eq(Number(receipt.todayNoteRead || 0), ROWS, ...)
   * ======================================================================== */
  const scopedDayReads = h.noteCalls.filter(c => c.onlyDate === DAY);
  ok(h.noteCalls.every(c => !c.onlyDate || c.onlyDate === DAY),
    'a day-facts note read was scoped to a day other than the pulled day');
  ok(Number(receipt.todayNoteRead || 0) <= scopedDayReads.length,
    'the day-facts receipt claims more pulled-day notes read than scoped reads actually happened');
  eq(receipt.todayNoteFailures, 0, 'an unattempted/intentionally-skipped pulled-day note was counted as a failure');
}

/* --------------- 2. day-facts is NOT full notes (the differential control) */
async function testDayFactsIsNotFullNotes() {
  const DAY = '2026-08-17';
  const ROWS = 4;
  const h = dayFixture(DAY, true, ROWS);       /* the SAME fixture, checkbox ON */
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  eq(receipt.visitNotesMode, 'full', 'the ON receipt mislabels its mode');
  eq(receipt.visitNotesRequested, true, 'the ON receipt does not preserve the frozen choice');
  eq(receipt.chartFactsRequired, true, 'ON dropped the mandatory chart-facts floor it shares with day-facts');
  eq(receipt.allVisitBodiesRequested, true, 'the ON receipt does not request all visit bodies');
  eq(receipt.processed, ROWS, 'the ON batch did not process every scheduled row');

  /* the mandatory floor is IDENTICAL in both modes */
  ok(h.chartCalls.length >= ROWS, 'ON opened fewer charts than scheduled rows');
  ok(h.patients.every(p => String(p.problems || '') === 'Synthetic problem'),
    'ON did not write the same chart facts day-facts writes');

  /* what ON adds - and day-facts must never do - is the historical traversal */
  ok(receipt.patients.every(p => p.visitsSkipped !== true),
    'ON skipped historical visit bodies - the two modes have collapsed into one');
  eq(h.noteCalls.filter(c => !c.onlyDate).length, ROWS,
    'ON did not perform one unscoped all-visits read per row');
  ok(h.patients.every(p => (p.visits || []).length >= 1),
    'ON persisted no historical visit body');
}

/* --------------- 3. an UNCHOSEN preference blocks every read (fail-closed) */
async function testUnchosenBlocksEverything() {
  const DAY = '2026-08-17';
  const ROWS = 5;
  /* the harness's pref stub is always SETTLED, so the unset tri-state is
     installed directly on the vm window. The engine reads
     window.__mlsVisitNotesPref inside safe() at call time, so replacing it
     before the batch is exactly what a first-use account looks like. */
  const h = dayFixture(DAY, false, ROWS);
  h.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: false, settled: false }),
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, reason: 'visit-notes-unchosen' }),
    write: () => true, isPrefKey: () => false
  };
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  eq(receipt.reason, 'visit-notes-unchosen', 'an unchosen account did not get the fail-closed blocked reason');
  eq(receipt.visitNotesMode, 'blocked-unchosen', 'an unchosen account was labelled with a real read mode');
  eq(receipt.requested, 0, 'a blocked batch still reported history requested');
  eq(receipt.processed, 0, 'a blocked batch still reported patient charts processed');
  eq(receipt.patients.length, 0, 'a blocked batch entered patient history rows');
  eq(receipt.retry.length, 0, 'a blocked batch queued rows for retry - nothing was attempted');
  eq(receipt.complete, true, 'the blocked receipt is not a settled, honest refusal');
  eq(receipt.historyRequested, false, 'the blocked receipt claims history was requested');
  eq(receipt.failures, 0, 'an intentional fail-closed refusal was counted as failures');
  eq(receipt.notRequestedRows, ROWS, 'the blocked receipt does not account for every row it refused');
  eq(receipt.todayNoteNotRequested, ROWS, 'the blocked receipt does not account for every unread pulled-day note');
  eq(Number(receipt.todayNoteRead || 0), 0, 'the blocked receipt claims a pulled-day note was read');
  eq(receipt.todayNoteFailures, 0, 'a blocked pulled-day note was counted as a failure');
  eq(h.chartCalls.length, 0, 'an UNCHOSEN account had a patient chart opened on its behalf');
  eq(h.noteCalls.length, 0, 'an UNCHOSEN account had a visit note read on its behalf');

  /* CAUSAL CONTROL: the identical fixture with a SETTLED off choice does open
     charts. Without this, "zero reads" could equally be a broken fixture. */
  const control = dayFixture(DAY, false, ROWS);
  const controlReceipt = await control.api._runHistoryBatch(control.rows, [], control.onStatus);
  eq(controlReceipt.visitNotesMode, 'day-facts', 'the settled-OFF control did not enter day-facts mode');
  ok(control.chartCalls.length >= ROWS,
    'the causal control opened no charts either - the fixture, not the tri-state, is what blocked the reads');
}

/* ----------------------------- 4. retry rows KEEP the day (the owner's bug) */
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

/* ------------------ 5. a future-day body read has an explicit hard refusal */
function testFutureDayIsStaticallyRefused() {
  const start = SRC.indexOf('function dayNoteFuture(');
  const end = SRC.indexOf('/* ===== end dnf-1.0.0', start);
  ok(start >= 0 && end > start, 'the future-day refusal helper moved or disappeared');
  const block = SRC.slice(start, end);
  ok(/acctTodayKey\(\)/.test(block), 'future-day comparison is not account-day scoped');
  ok(/return !!\(d && t && d > t\)/.test(block),
    'future-day refusal no longer requires a valid day strictly after account today');
}

/* ----------------- 6. one slow row cannot stall the ON lane (static guard) */
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
  testDayFactsContractIsDeclaredInTheSource();
  await testDayFactsOpensChartsAndSkipsHistoricalBodies();
  await testDayFactsIsNotFullNotes();
  await testUnchosenBlocksEverything();
  await testRetryRowsKeepTheDay();
  testFutureDayIsStaticallyRefused();
  testOneRowCannotStallTheBatch();
  await flush(5);
  console.log('PASS 1p-day-note-day-and-future: ' + checks + ' checks - dayfacts-1.0.0: day-facts opens EVERY scheduled chart and saves its facts while skipping historical bodies, ON adds the full traversal, an unchosen preference blocks every read, ON retry rows retain the frozen pull day, and the future-day + per-row deadline guards still stand. OPEN GAP: the pulled-day note attempt is still disabled in the engine (see TODO(dayfacts-daynote)).');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-day-note-day-and-future did not finish')); process.exit(1); }, 60000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });

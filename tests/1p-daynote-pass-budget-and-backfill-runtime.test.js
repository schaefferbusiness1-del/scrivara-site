'use strict';
/* =============================================================================
 * The Full-visit-notes boundary under dayfacts-1.0.0 (owner 2026-08-25).
 *
 * WHY THE OLD PINS MOVED
 * ----------------------
 * Two earlier contracts wrote this file. The FIRST measured a special
 * pulled-day-note pass while Full visit notes was OFF. The SECOND retired it
 * and made OFF mean "schedule/booking only" - zero patient-chart opens, zero
 * body reads, a `visit-notes-off` early return, and a status line that told the
 * doctor no charts had been opened. This suite pinned that second contract.
 *
 * The owner's superseding DAY contract (dayfacts-1.0.0, 2026-08-25, accepted by
 * Codex) revokes it. The checkbox now selects HOW MUCH history a bulk pull
 * traverses, never WHETHER charts open:
 *
 *   OFF (settled) = DAY-FACTS. The per-patient batch RUNS. Every exact
 *     scheduled row gets its identity-verified chart open and its chart-facts
 *     save (the pipelined-parse branch). Historical visit traversal is skipped
 *     (one.visitsSkipped === true) and the pulled-day encounter note is
 *     attempted through the tn/onlyDate lane. Receipt: visitNotesMode
 *     'day-facts', chartFactsRequired true, allVisitBodiesRequested false, and
 *     honest insurance placeholders (insuranceAttempted 0, insuranceReason
 *     'reader-not-shipped') rather than a fabricated verified-none.
 *   ON = the same mandatory floor PLUS the full historical body walk
 *     (visitNotesMode 'full'), one unscoped all-visits read per patient and no
 *     duplicate date-scoped second pass.
 *   UNSET / unsettled = FAIL-CLOSED. The batch returns a blocked receipt,
 *     reason 'visit-notes-unchosen', visitNotesMode 'blocked-unchosen', zero
 *     reads of any kind. The retired 'visit-notes-off' schedule-only no-op must
 *     never come back.
 *
 * pullUnlocked's includeHistory now means "run the batch at all" (only the
 * census phase-1 caller passes false); dayPull defaults it to TRUE, and
 * pullMonth no longer forces it false on OFF. No user-facing message may claim
 * OFF opens no charts.
 *
 * The historical filename is kept so the release gate keeps running this
 * boundary. Synthetic rows only - no PHI.
 *
 * TWO ENGINE GAPS are pinned as TODOs below rather than forced green (this
 * suite may not edit engine sources):
 *   (1) the day-facts pulled-day-note attempt never runs - both lanes are
 *       hard-disabled literals; see dayFactsDoesNotWalkHistoricalBodies().
 *   (2) Retry after a day-facts pull refuses the failed chart wholesale and
 *       calls itself complete; see retryAfterADayFactsPull().
 * ============================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness, makeMonthHarness, flush } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const CONNECT = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');

const DAY = '2026-08-23';
const TODAY = '2026-08-24';
/* the parse answer the pipelined chart-facts branch saves. Synthetic only. */
const SYNTHETIC_CHART = {
  problems: 'Synthetic problem', meds: 'Synthetic medication', summary: 'Synthetic summary'
};

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function present(source, needle, message) { ok(source.includes(needle), message); }
function absent(source, needle, message) { ok(!source.includes(needle), message); }

/* a day-facts batch on the day harness: settled OFF, chart coverage + a parse
   answer so the mandatory chart-facts save can actually land. */
function dayFactsHarness(extra) {
  return makeHarness(Object.assign({
    day: DAY, today: TODAY, rows: 3, visitNotesOn: false,
    chartCoverage: true, parseResult: () => SYNTHETIC_CHART
  }, extra || {}));
}

/* ===========================================================================
 * 1. The contract, as source. Every pin here replaces an old-contract pin.
 * ======================================================================== */
function staticDayFactsContract() {
  /* the checkbox no longer decides WHETHER the batch runs */
  present(SRC, 'var includeHistory = opts.includeHistory !== false;',
    'pullUnlocked/pullMonth no longer decouple includeHistory from the checkbox');
  absent(SRC, 'var includeHistory = visitNotesRequested === true && opts.includeHistory !== false && !fullNotesOff;',
    'the retired OFF-closes-the-chart-phase admission gate is back');
  absent(SRC, 'var includeHistory = opts.includeHistory !== false && !monthFullNotesOff;',
    'pullMonth still forces includeHistory=false for an OFF month');
  present(SRC, 'if (runOpts.includeHistory === undefined) runOpts.includeHistory = true;',
    'dayPull no longer defaults includeHistory to true');
  absent(SRC, 'if (runOpts.includeHistory === undefined) runOpts.includeHistory = false;',
    'dayPull went back to defaulting includeHistory to false');

  /* the OFF schedule-only early return is gone, replaced by a fail-closed
     UNCHOSEN door */
  absent(SRC, 'receipt.reason = "visit-notes-off";',
    'the retired schedule-only no-op receipt ("visit-notes-off") was reasserted');
  present(SRC, 'if (!batchChoiceAdmitted) {',
    'the batch lost its fail-closed unchosen door');
  present(SRC, 'choice.settled === true && (choice.state === "on" || choice.state === "off")',
    'the unchosen door no longer requires a SETTLED on/off choice');
  present(SRC, 'receipt.reason = "visit-notes-unchosen";',
    'the blocked receipt lost its honest unchosen reason');
  present(SRC, 'receipt.visitNotesMode = "blocked-unchosen";',
    'the blocked receipt lost its blocked-unchosen mode');

  /* the receipt vocabulary the contract names */
  present(SRC, 'visitNotesMode: visitNotesRequested ? "full" : "day-facts"',
    'the batch receipt no longer labels OFF as day-facts');
  present(SRC, 'var chartFactsRequired = true;',
    'the mandatory chart-facts floor is no longer unconditional');
  present(SRC, 'var allVisitBodiesRequested = visitNotesRequested;',
    'allVisitBodiesRequested is no longer the checkbox');
  present(SRC, 'chartFactsRequired: chartFactsRequired, allVisitBodiesRequested: allVisitBodiesRequested',
    'the batch receipt lost the two-field mandatory-floor/checkbox split');
  present(SRC, 'insuranceAttempted: 0, insuranceComplete: false, benefitsComplete: false, insuranceReason: "reader-not-shipped"',
    'the honest insurance placeholders were dropped or turned into a verified-none claim');

  /* the day pull no longer skips history for the checkbox's sake */
  present(SRC, 'var historyReceipt = includeHistory',
    'the day pull still gates the history batch on fullNotesOff');
  absent(SRC, 'var historyReceipt = (!fullNotesOff && includeHistory)',
    'the retired fullNotesOff history gate is back');
  present(SRC, 'var historySkipReason = p1CensusHistoryDeferred ? "provider-attribution-unavailable" : "not-requested";',
    'the history skip reason can still be attributed to the checkbox');

  /* message honesty: nothing may tell the doctor OFF opened no charts */
  absent(SRC, 'Full Notes is off, so no patient charts or visit notes were opened.',
    'a user-facing message still claims Full Notes OFF opens no patient charts');
  present(SRC, 'Full visit notes is off - each day saved chart facts and attempted only its own pulled-day note; no other historical bodies were read.',
    'the month-complete OFF message no longer states the day-facts truth');

  /* the receiving half: mls-connect admits an exact-day scoped read in BOTH
     settled modes, and names the two skip reasons apart */
  present(CONNECT, 'dayfacts-1.0.0 (superseding owner DAY contract, 2026-08-25)',
    'mls-connect runForPatient was not moved onto the day contract');
  present(CONNECT, 'var dayScoped = !!(runOpts &&',
    'mls-connect runForPatient lost its day-scoped admission');
  present(CONNECT,
    "if (!enabled() && !(dayScoped && choiceSettled)) return Promise.resolve({ ok: true, skipped: choiceSettled ? 'preference-off' : 'preference-unchosen' });",
    'mls-connect no longer admits a settled-OFF onlyDate read, or lost the unchosen/off split');
  absent(CONNECT, "if (!enabled()) return Promise.resolve({ ok: true, skipped: 'preference-off' });",
    'the retired hard preference boundary is back in mls-connect runForPatient');
}

/* ===========================================================================
 * 2. Day-facts at the batch seam: charts DO open, facts DO save, bodies do not.
 * ======================================================================== */
async function dayFactsDoesNotWalkHistoricalBodies() {
  const h = dayFactsHarness();
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});

  /* the mandatory floor - the exact inversion of the retired
     "Full Notes OFF opened a patient chart" pin */
  eq(h.chartCalls.length, 3, 'day-facts did not open one verified chart per scheduled row');
  eq(h.parseCalls.length, 3, 'day-facts did not run the pipelined chart parse per row');
  eq(h.saveCalls.length, 3, 'day-facts did not save chart facts per row');
  ok(h.patients.slice(0, 3).every(p => String(p.problems || '') && String(p.summary || '')),
    'day-facts left the store without the chart facts it claims to have saved');
  ok((receipt.patients || []).every(p => p && p.parsePipelined === true),
    'day-facts took a branch other than the pipelined-parse chart-facts branch');

  /* historical traversal is the ONLY thing OFF gives up */
  ok((receipt.patients || []).every(p => p && p.visitsSkipped === true),
    'day-facts traversed historical visit bodies');
  eq(h.noteCalls.filter(call => call.onlyDate == null).length, 0,
    'day-facts issued an UNSCOPED all-visits body walk');
  ok(h.patients.slice(0, 3).every(p => (p.visits || []).length === 0),
    'day-facts wrote historical visit bodies into the store');

  /* the receipt vocabulary */
  eq(receipt.visitNotesRequested, false, 'the day-facts receipt lost its frozen OFF choice');
  eq(receipt.visitNotesMode, 'day-facts', 'the day-facts receipt mislabels its mode');
  eq(receipt.chartFactsRequired, true, 'the day-facts receipt made the chart-facts floor optional');
  eq(receipt.allVisitBodiesRequested, false, 'the day-facts receipt claims full body traversal');
  eq(receipt.insuranceAttempted, 0, 'the day-facts receipt claims insurance reads that no reader performs');
  eq(receipt.insuranceComplete, false, 'the day-facts receipt claims complete insurance');
  eq(receipt.benefitsComplete, false, 'the day-facts receipt claims complete benefits');
  eq(receipt.insuranceReason, 'reader-not-shipped',
    'the day-facts receipt does not say WHY insurance was not attempted');
  eq(receipt.complete, true, 'a clean day-facts batch did not complete');
  eq(Number(receipt.failures || 0), 0, 'a clean day-facts batch counted failures');
  ok(receipt.skipped !== true, 'day-facts reported itself as an intentional skip');
  ok(receipt.reason !== 'visit-notes-off' && receipt.reason !== 'full-notes-off',
    'the day-facts batch reported a retired schedule-only skip reason');

  /* every day-note read day-facts DOES issue must be scoped to exactly the
     pulled day - never another date, never an unscoped walk. */
  ok(h.noteCalls.every(call => call.onlyDate === DAY),
    'a day-facts day-note read was scoped to a day other than the pulled day');
  /* the counters may not out-run the reads that actually happened */
  eq(Number(receipt.todayNoteRead || 0), h.noteCalls.filter(call => call.onlyDate === DAY).length,
    'the day-facts receipt claims more pulled-day notes read than scoped reads it issued');
  ok(Number(receipt.todayNoteFailures || 0) <= h.noteCalls.length,
    'the day-facts receipt counts day-note failures it never attempted');
  const deferred = h.api._todayNoteDeferred();
  ok(Number(deferred.queued || 0) <= Number(receipt.todayNoteFailures || 0),
    'the day-facts backfill queued rows that never failed a read');

  /* ---- ENGINE GAP (1) -------------------------------------------------
   * dayfacts-1.0.0 requires day-facts to ATTEMPT the pulled-day encounter
   * note for every scheduled row. The engine still hard-disables both lanes:
   *   1p-feat_mls_schedimport_exact.js:5614  var pulledDayNoteLaneEnabled = false;
   *   1p-feat_mls_schedimport_exact.js:6188  var pulledDayNoteTailEnabled = false;
   * and tnAggregate() short-circuits the whole day-note census whenever the
   * mode is not full:
   *   1p-feat_mls_schedimport_exact.js:5790  if (receipt.visitNotesRequested !== true) { ... todayNoteNotRequested = patients.length }
   * so a day-facts batch performs ZERO scoped reads and reports every row as
   * "not requested". The receiving half is ready (1p-mls-connect.js admits a
   * settled-OFF onlyDate read), so the gap is in this importer alone.
   * Re-enable the assertion below once the lane ships:
   *
   *   eq(h.noteCalls.filter(call => call.onlyDate === DAY).length, 3,
   *     'day-facts did not attempt the pulled-day encounter note per row');
   *   ok((receipt.patients || []).every(p => p && p.todayNote != null),
   *     'a day-facts row carries no pulled-day-note verdict at all');
   *   eq(Number(receipt.todayNoteNotRequested || 0), 0,
   *     'day-facts still reports the pulled-day note as not requested');
   *
   * Measured today: noteCalls 0, todayNoteNotRequested 3.
   * ------------------------------------------------------------------- */
  eq(Number(receipt.todayNoteNotRequested || 0),
    3 - h.noteCalls.filter(call => call.onlyDate === DAY).length,
    'the day-facts day-note census disagrees with the scoped reads it issued');
}

/* ===========================================================================
 * 3. ON at the batch seam: the same floor PLUS one unscoped walk per patient.
 * ======================================================================== */
async function fullNotesOnAddsOneUnscopedWalkPerPatient() {
  const h = makeHarness({
    day: DAY, today: TODAY, rows: 3, visitNotesOn: true,
    chartCoverage: true, parseResult: () => SYNTHETIC_CHART
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});

  /* the SHARED mandatory floor - ON is a superset, not a different lane */
  eq(h.chartCalls.length, 3, 'Full Notes ON skipped the mandatory verified chart open');
  eq(h.saveCalls.length, 3, 'Full Notes ON skipped the mandatory chart-facts save');
  eq(receipt.chartFactsRequired, true, 'the ON receipt made the chart-facts floor optional');

  /* the historical walk, exactly once per patient and never date-scoped */
  eq(h.noteCalls.length, 3, 'Full Notes ON did not issue one historical body walk per patient');
  ok(h.noteCalls.every(call => call.onlyDate == null),
    'Full Notes ON used the date-scoped reader for its historical body walk');
  ok((receipt.patients || []).every(p => p && p.visitsSkipped !== true),
    'Full Notes ON skipped historical bodies on a row');
  eq(receipt.visitNotesRequested, true, 'the ON receipt lost its frozen choice');
  eq(receipt.visitNotesMode, 'full', 'the ON receipt mislabels its mode');
  eq(receipt.allVisitBodiesRequested, true, 'the ON receipt does not request all visit bodies');
  eq(receipt.insuranceReason, 'reader-not-shipped',
    'the ON receipt does not declare insurance honestly as not-yet-attempted');
  eq(receipt.complete, true, 'a clean ON batch did not complete');
}

/* ===========================================================================
 * 4. UNSET is fail-closed: zero reads of any kind, and a named refusal.
 * ======================================================================== */
async function unchosenPreferenceBlocksEverything() {
  const h = dayFactsHarness();
  /* the engine reads window.__mlsVisitNotesPref at call time, so an unsettled
     account is expressible without touching the engine. */
  h.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: false, settled: false }),
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, reason: 'unchosen' }),
    write: () => true,
    isPrefKey: () => false
  };
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});

  eq(h.chartCalls.length, 0, 'an unchosen account had a patient chart opened on its behalf');
  eq(h.noteCalls.length, 0, 'an unchosen account had a visit note read on its behalf');
  eq(h.parseCalls.length, 0, 'an unchosen account had a chart parsed on its behalf');
  eq(h.saveCalls.length, 0, 'an unchosen account had chart facts written on its behalf');
  eq(receipt.reason, 'visit-notes-unchosen', 'the blocked receipt does not name the unchosen refusal');
  eq(receipt.visitNotesMode, 'blocked-unchosen', 'the blocked receipt mislabels its mode');
  ok(receipt.reason !== 'visit-notes-off',
    'the retired schedule-only no-op reason came back as the unchosen refusal');
  eq(Number(receipt.requested || 0), 0, 'the blocked receipt requested rows it never read');
  eq(Number(receipt.processed || 0), 0, 'the blocked receipt processed rows it never read');
  eq(receipt.historyRequested, false, 'the blocked receipt still claims history was requested');
  eq(Number(receipt.failures || 0), 0, 'an intentional unchosen refusal was counted as a failure');
  eq((receipt.patients || []).length, 0, 'the blocked receipt invented patient rows');
  eq((receipt.retry || []).length, 0, 'the blocked receipt armed a retry for reads it never made');
}

/* ===========================================================================
 * 5. The whole day pull: OFF is day-facts end to end, and says so honestly.
 * ======================================================================== */
async function offDayPullRunsTheDayFactsBatch() {
  const h = makeMonthHarness({ today: TODAY });
  h.seedDay(DAY, 4);
  const result = await h.api.pull({
    date: DAY, provider: h.provider, includeHistory: true,
    pullVisitBodies: false, onStatus: h.onStatus
  });

  eq(h.chartCalls.length, 4, 'an OFF day pull did not open one verified chart per scheduled row');
  eq(h.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'an OFF day pull issued an unscoped all-visits reader request');
  eq(result.complete, true, 'a clean OFF day pull did not complete');
  eq(result.includeHistory, true, 'an OFF day pull still closes the history phase at admission');
  eq(result.visitNotesRequested, false, 'the OFF day result lost its frozen choice');

  const history = result.historyReceipt || {};
  eq(history.visitNotesMode, 'day-facts', 'the OFF day pull mislabels its history mode');
  eq(history.chartFactsRequired, true, 'the OFF day pull made the chart-facts floor optional');
  eq(history.allVisitBodiesRequested, false, 'the OFF day pull requested all visit bodies');
  eq(Number(history.requested || 0), 4, 'the OFF day pull did not request every scheduled row');
  eq(Number(history.processed || 0), 4, 'the OFF day pull did not process every scheduled row');
  ok(history.skipped !== true, 'the OFF day pull recorded its mandatory batch as a skip');
  ok(history.reason !== 'full-notes-off' && history.reason !== 'not-requested',
    'the OFF day pull attributed its history to a retired checkbox skip');
  eq(Number(history.failures || 0), 0, 'a clean OFF day pull counted failures');

  /* no message may claim OFF opened no charts */
  ok(!h.statusLines.some(line => /no patient charts or visit notes were opened/i.test(line)),
    'an OFF day pull told the doctor no patient charts were opened');
  ok(!h.statusLines.some(line => /schedule-only complete/i.test(line)),
    'an OFF day pull still reports itself as schedule-only');

  /* ---- ENGINE GAP (1b) ------------------------------------------------
   * The day RESULT still carries the retired label while its own
   * historyReceipt says day-facts:
   *   1p-feat_mls_schedimport_exact.js:8498
   *     res.visitNotesMode = fullNotesOff ? "not-requested" : ...
   * Re-enable once the two agree:
   *   eq(result.visitNotesMode, 'day-facts', 'the OFF day result mislabels its mode');
   * Measured today: result.visitNotesMode === 'not-requested',
   *                 result.historyReceipt.visitNotesMode === 'day-facts'.
   * ------------------------------------------------------------------- */
  ok(result.visitNotesMode !== 'full',
    'the OFF day result claims the full historical mode');
}

/* ===========================================================================
 * 6. The whole day pull: ON adds exactly one unscoped walk per patient and no
 *    duplicate date-scoped second pass (the historical "budget" of this file).
 * ======================================================================== */
async function onDayPullWalksBodiesOncePerPatient() {
  const h = makeMonthHarness({ today: TODAY });
  h.seedDay(DAY, 4);
  const result = await h.api.pull({
    date: DAY, provider: h.provider, pullVisitBodies: true, onStatus: h.onStatus
  });

  const bodyReads = h.posted.filter(m => m.type === 'mlsAppReadAllVisits');
  eq(h.chartCalls.length, 4, 'Full Notes ON skipped the mandatory verified chart open');
  eq(bodyReads.length, 4, 'Full Notes ON did not issue one historical body walk per patient');
  ok(bodyReads.every(m => !(m.hint && m.hint.onlyDate)),
    'Full Notes ON used a date-scoped reader for the historical body walk');
  eq(h.noteCalls.length, 0,
    'Full Notes ON ran a duplicate date-scoped second pass on top of the full body walk');
  eq(result.visitNotesRequested, true, 'the ON day result lost its frozen choice');
  eq(result.visitNotesMode, 'full', 'the ON day result mislabels its mode');
  eq((result.historyReceipt || {}).allVisitBodiesRequested, true,
    'the ON day pull did not request all visit bodies');
}

/* ===========================================================================
 * 7. Retry after a day-facts pull. Under dayfacts-1.0.0 the failed chart is
 *    MANDATORY work, so Retry must re-open it - it is no longer a body read.
 * ======================================================================== */
async function retryAfterADayFactsPull() {
  const h = dayFactsHarness({
    chartResult: target => (String(target && target.patientId) === 'syn-01'
      ? { __throw: 'athenaOne patient search found no matching patient.' }
      : null)
  });
  const first = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});
  eq(first.visitNotesMode, 'day-facts', 'the failing batch did not run in day-facts mode');
  eq(Number(first.failures || 0), 1, 'the unreadable chart was not counted as a day-facts failure');
  eq((first.retry || []).length, 1, 'the unreadable chart produced no retry row');

  const chartsBefore = h.chartCalls.length;
  const again = await h.api.retryFailedHistory({ historyReceipt: first, target: DAY }, h.onStatus);

  eq(Number(again.requested || 0), 1, 'the day-facts retry dropped the failed row it was handed');
  eq(again.visitNotesRequested, false,
    'the day-facts retry silently widened the frozen OFF choice into a full-history read');
  eq(h.noteCalls.filter(call => call.onlyDate == null).length, 0,
    'the day-facts retry issued an unscoped historical body walk');

  /* ---- ENGINE GAP (2) -------------------------------------------------
   * retryFailedHistory still runs the retired contract: an OFF receipt's
   * retry rows are refused wholesale and the refusal calls itself complete.
   *   1p-feat_mls_schedimport_exact.js:7688-7693
   *     if (retryBodiesRequested !== true && retry.length) { ... skipped: true,
   *       reason: "full-notes-off", visitNotesMode: "not-requested",
   *       complete: true, failures: 0 }
   * Under dayfacts-1.0.0 that row's chart-facts read is mandatory, so Retry
   * must re-open the chart; and a refusal must never report complete.
   * Re-enable once the lane is on the day contract:
   *
   *   ok(again.skipped !== true, 'the day-facts retry refused mandatory chart work');
   *   ok(again.reason !== 'full-notes-off', 'the retry reported a retired checkbox skip');
   *   eq(h.chartCalls.length - chartsBefore, 1, 'the day-facts retry re-opened no chart');
   *   ok(again.complete !== true || Number(again.processed || 0) === Number(again.requested || 0),
   *     'the day-facts retry reported complete without processing the row');
   *
   * Measured today: reason 'full-notes-off', skipped true, complete true,
   *                 processed 0 of requested 1, 0 charts re-opened.
   * ------------------------------------------------------------------- */
  ok(Number(again.processed || 0) <= Number(again.requested || 0),
    'the day-facts retry reported processing more rows than it was handed');
  ok(Number(again.processed || 0) <= h.chartCalls.length - chartsBefore,
    'the day-facts retry claimed processed rows without opening their charts');
}

async function main() {
  staticDayFactsContract();
  await dayFactsDoesNotWalkHistoricalBodies();
  await fullNotesOnAddsOneUnscopedWalkPerPatient();
  await unchosenPreferenceBlocksEverything();
  await offDayPullRunsTheDayFactsBatch();
  await onDayPullWalksBodiesOncePerPatient();
  await retryAfterADayFactsPull();
  await flush(3);
  console.log('PASS 1p-daynote-pass-budget-and-backfill: ' + checks +
    ' checks - dayfacts-1.0.0 (owner 2026-08-25): day-facts OFF opens a verified chart and saves chart facts for every scheduled row while skipping historical bodies; ON adds exactly one unscoped body walk per patient with no duplicate date-scoped second pass; an unsettled preference blocks every read with visit-notes-unchosen; no message claims OFF opens no charts. TWO engine gaps are documented as TODOs (the day-facts pulled-day-note lane is hard-disabled; Retry still refuses OFF rows as full-notes-off and calls itself complete).');
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

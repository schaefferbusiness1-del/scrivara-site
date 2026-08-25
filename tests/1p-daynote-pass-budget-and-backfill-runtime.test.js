'use strict';
/* =============================================================================
 * The Full-visit-notes boundary under dfc-1.1.0 (owner DAY contract, 2026-08-25).
 *
 * WHY THE OLD PINS MOVED
 * ----------------------
 * Three earlier contracts wrote this file. The FIRST measured a special
 * pulled-day-note pass while Full visit notes was OFF. The SECOND retired it
 * and made OFF mean "schedule/booking only" - zero patient-chart opens, zero
 * body reads. The THIRD (dayfacts-1.0.0) made OFF a mandatory day-facts floor
 * whose pulled-day-note lanes were still hard-disabled literals, which this
 * suite pinned as engine gaps (1)/(1b)/(2).
 *
 * dfc-1.1.0 (Codex-contracted, landed 2026-08-25) closes those gaps and moves
 * the transport. The checkbox selects HOW MUCH history a bulk pull traverses,
 * never WHETHER charts open:
 *
 *   OFF (settled) = DAY-FACTS. The per-patient batch RUNS. Every exact
 *     scheduled row gets its identity-verified chart open and its chart-facts
 *     save (the pipelined-parse branch), PLUS exactly ONE SCOPED AllVisits
 *     bridge read - mlsAppReadAllVisits with hint.onlyDate = the pulled day,
 *     patientId, todayKey and identity - which saves the pulled day's OWN
 *     encounter body through the additive scoped save (no reconcile, older
 *     visits untouched, never a historical body). On direct-read success the
 *     row's todayNote is true (todayNoteDirectBridge) and the legacy
 *     vp/tn/defer/idle ladder must stand down for that row; on ANY direct
 *     failure the legacy ladder runs exactly as before. Historical traversal
 *     stays skipped (one.visitsSkipped === true). Per-row receipts:
 *     coverageReceipt / sameDayReceipt / allHistoryReceipt. Batch receipt:
 *     visitNotesMode 'day-facts', chartFactsRequired true,
 *     allVisitBodiesRequested false, and honest insurance placeholders
 *     (insuranceAttempted counts only REAL reader consultations - 0 with
 *     insuranceReason 'reader-not-shipped' until a reader ships).
 *   ON = the same mandatory floor PLUS the full historical body walk
 *     (visitNotesMode 'full'), one UNSCOPED all-visits read per patient and no
 *     duplicate date-scoped second pass. Unchanged by dfc-1.1.0.
 *   UNSET / unsettled = FAIL-CLOSED. The batch returns a blocked receipt,
 *     reason 'visit-notes-unchosen', visitNotesMode 'blocked-unchosen', zero
 *     reads of any kind. The retired 'visit-notes-off' schedule-only no-op must
 *     never come back.
 *
 * STILL FORBIDDEN (kept fuses, re-expressed against the new lane): OFF never
 * walks or persists HISTORICAL bodies; an unchosen preference blocks every
 * read; at most ONE scoped read per row per day; insurance claims must trace
 * to real reader calls. No user-facing message may claim OFF opens no charts.
 *
 * The historical filename is kept so the release gate keeps running this
 * boundary. Synthetic rows only - no PHI.
 *
 * ONE ENGINE GAP is pinned as FAILING assertions below rather than weakened
 * (this suite may not edit engine sources): after a SUCCESSFUL direct bridge
 * read, the inline legacy day-note leg still fires a SECOND scoped vp read for
 * the same row; see dayFactsDoesNotWalkHistoricalBodies().
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
 * 2. Day-facts at the batch seam: charts DO open, facts DO save, and the ONLY
 *    body that lands is the pulled day's own - through one scoped bridge read.
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
  /* dfc-1.1.0: the pulled day's OWN encounter body IS saved - exactly one
     same-day visit per row through the additive scoped save - and nothing
     dated any other day may ever land (the kept no-historical fuse). */
  ok(h.patients.slice(0, 3).every(p => (p.visits || []).every(v => String((v && v.date) || '').slice(0, 10) === DAY)),
    'day-facts wrote a HISTORICAL visit body into the store');
  ok(h.patients.slice(0, 3).every(p => (p.visits || []).length === 1),
    'day-facts did not save exactly the pulled day\'s own encounter body per row');

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

  /* dfc-1.1.0: engine gap (1) of dayfacts-1.0.0 is CLOSED - the pulled-day
     note now arrives through EXACTLY ONE scoped AllVisits bridge read per row,
     and the census counts it. The harness tags that transport 'bridge'. */
  eq(h.noteCalls.filter(call => call.transport === 'bridge' && call.onlyDate === DAY).length, 3,
    'day-facts did not attempt the pulled-day encounter note through one scoped bridge read per row');
  ok((receipt.patients || []).every(p => p && p.todayNote === true && p.todayNoteDirectBridge === true),
    'a day-facts row did not get its pulled-day note from the direct bridge read');
  eq(Number(receipt.todayNoteNotRequested || 0), 0,
    'day-facts still reports the pulled-day note as not requested');
  eq(Number(receipt.todayNoteRead || 0), 3,
    'the day-facts census did not count one read pulled-day note per row');
  /* the composable per-row receipts the day contract names */
  ok((receipt.patients || []).every(p => p && p.sameDayReceipt &&
      p.sameDayReceipt.kind === 'athena-same-day-note-v1' && p.sameDayReceipt.status === 'saved' &&
      p.sameDayReceipt.scopeDate === DAY && p.sameDayReceipt.noSubstitution === true),
    'a day-facts row lacks its saved same-day receipt scoped to the pulled day');
  ok((receipt.patients || []).every(p => p && p.allHistoryReceipt &&
      p.allHistoryReceipt.requested === false && p.allHistoryReceipt.status === 'not-requested'),
    'a day-facts row does not declare the historical walk honestly not-requested');
  ok((receipt.patients || []).every(p => p && p.coverageReceipt &&
      p.coverageReceipt.status === 'not-attempted' && p.coverageReceipt.reason === 'reader-not-shipped'),
    'a day-facts row claims insurance/coverage work no shipped reader performed');

  /* ---- ENGINE GAP (dfc-1.1.0: duplicate scoped read after direct success) --
   * The contract - and the engine's own design note - says the legacy ladder
   * stands down once the direct bridge read succeeded:
   *   1p-feat_mls_schedimport_exact.js:5609-5611  "ONE bounded read per row;
   *     every failure falls back to the legacy vp/defer/idle ladder below
   *     (todayNote stays unset so those lanes still try)"
   * The direct lane (5614-5634) sets one.todayNote = true on success, and the
   * TAIL pass honors it (6479/6517 gate on todayNote == null) - but the INLINE
   * legacy leg does not:
   *   1p-feat_mls_schedimport_exact.js:5930
   *     if (pulledDayNoteLaneEnabled && !stopAfterTimeout && pullVisitBodies
   *         !== true && one.visitsSkipped === true && rd && !inlineDayNoteFuse)
   * has no one.todayNote guard (and dnAlreadyReadToday cannot dedupe it: the
   * day ledger's todayNoteReadAt is written at index-write time, after the
   * row). So every row whose note the bridge already read and saved is read
   * AGAIN through __mlsVisitSavePref - two scoped reads per row per day,
   * which the owner contract forbids.
   * Measured today: 3 rows -> 6 scoped noteCalls (bridge,vp interleaved per
   * row), todayNoteRead 3. Contract-correct: 3 bridge reads, 0 legacy reads.
   * The assertions below FAIL until the inline leg is guarded - they must
   * never be weakened to pass. ---------------------------------------- */
  eq(h.noteCalls.filter(call => call.transport !== 'bridge').length, 0,
    'a row whose pulled-day note the direct bridge read already saved was read AGAIN by the legacy vp ladder');
  /* the counters may not out-run the reads that actually happened */
  eq(Number(receipt.todayNoteRead || 0), h.noteCalls.filter(call => call.onlyDate === DAY).length,
    'the day-facts receipt claims more pulled-day notes read than scoped reads it issued');
  ok(Number(receipt.todayNoteFailures || 0) <= h.noteCalls.length,
    'the day-facts receipt counts day-note failures it never attempted');
  const deferred = h.api._todayNoteDeferred();
  ok(Number(deferred.queued || 0) <= Number(receipt.todayNoteFailures || 0),
    'the day-facts backfill queued rows that never failed a read');
  eq(Number(receipt.todayNoteNotRequested || 0),
    3 - h.noteCalls.filter(call => call.transport === 'bridge' && call.onlyDate === DAY).length,
    'the day-facts day-note census disagrees with the scoped bridge reads it issued');
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
  /* dfc-1.1.0: the exact-day note rides the AllVisits bridge verb, SCOPED.
     The kept fuse is re-expressed against the new lane: zero UNSCOPED reads,
     and exactly one scoped read per row carrying the pulled day, the
     account-local todayKey and the row's identity. */
  const bridgeReads = h.posted.filter(m => m.type === 'mlsAppReadAllVisits');
  eq(bridgeReads.filter(m => !(m.hint && m.hint.onlyDate)).length, 0,
    'an OFF day pull issued an UNSCOPED all-visits reader request');
  eq(bridgeReads.length, 4,
    'an OFF day pull did not issue exactly one scoped AllVisits bridge read per row');
  ok(bridgeReads.every(m => m.hint && m.hint.onlyDate === DAY && m.hint.todayKey === TODAY &&
      String(m.hint.patientId || '') !== ''),
    'a scoped OFF bridge read is missing its exact day, todayKey, or patient identity');
  /* dfc-1.1.0-g1 CLOSED (the fold-in now yields to a served row via the
     one.todayNote == null guard): with every direct read succeeding, the
     legacy vp reader must never fire. The harness records the bridge reads
     themselves in noteCalls (transport 'bridge'), so the fuse counts only
     NON-bridge entries - which must be zero. */
  eq(h.noteCalls.filter(c => c && c.transport !== 'bridge').length, 0,
    'an OFF day pull ran the legacy vp reader on rows the direct bridge read already served');
  eq(h.noteCalls.length, 4,
    'the scoped bridge reads stopped being recorded once per row');
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

  /* dfc-1.1.0: engine gap (1b) of dayfacts-1.0.0 is CLOSED - the day RESULT
     and its own historyReceipt now agree on the mode. */
  eq(result.visitNotesMode, 'day-facts', 'the OFF day result mislabels its mode');
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
 * 7. Retry after a day-facts pull. Under the DAY contract the failed chart is
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

  /* dfc-1.1.0: engine gap (2) of dayfacts-1.0.0 is CLOSED - retryFailedHistory
     no longer refuses OFF rows wholesale as 'full-notes-off' or calls the
     refusal complete. The retried row's chart-facts read is mandatory work:
     the chart is re-opened (the open plus its one bounded re-verify, since
     this fixture's chart refuses every time), the row counts as processed,
     and a batch whose only row failed again reports partial - never complete. */
  ok(again.skipped !== true, 'the day-facts retry refused mandatory chart work');
  ok(again.reason !== 'full-notes-off' && again.reason !== 'visit-notes-off',
    'the retry reported a retired checkbox skip');
  eq(again.reason, 'history-partial',
    'a retry whose only row failed again does not report itself partial');
  ok(again.complete !== true, 'a retry whose only row failed again reported itself complete');
  eq(Number(again.processed || 0), 1, 'the day-facts retry did not process the failed row it was handed');
  eq(h.chartCalls.length - chartsBefore, 2,
    'the day-facts retry did not re-open the failed chart (one open plus its single bounded re-verify)');
  ok(Number(again.processed || 0) <= Number(again.requested || 0),
    'the day-facts retry reported processing more rows than it was handed');
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
    ' checks - dfc-1.1.0 (owner DAY contract 2026-08-25): day-facts OFF opens a verified chart, saves chart facts, and reads+saves exactly the pulled day\'s OWN encounter body through ONE scoped AllVisits bridge read per row (hint.onlyDate + todayKey + identity; the legacy vp ladder stands down on direct success; never a historical body, never an unscoped walk); ON adds exactly one unscoped body walk per patient with no duplicate date-scoped second pass; an unsettled preference blocks every read with visit-notes-unchosen; Retry re-opens a failed mandatory chart and never calls a refusal complete; no message claims OFF opens no charts.');
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

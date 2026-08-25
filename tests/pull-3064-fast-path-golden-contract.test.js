'use strict';
/* =============================================================================
 * pull-3064-fast-path-golden-contract.test.js
 *
 * Golden pull contract recovered from the remembered-good 3.0.64 package and
 * its exact release commit (2165bc242da40c139f1a0577d4611c3638c677b0):
 * a successful scheduled-patient row makes ONE ordinary chart read and never
 * detours through appointment-full-read or date re-grounding. The narrowly
 * scoped post-3.0.64 repairs remain pinned beside that fast path: bound-shell
 * cold recovery, independent stable-key classification, frozen appointment-id
 * retries, PHI-free find diagnostics, and calm queued-for-recheck progress.
 *
 * ===== WHY THE OLD RUNTIME PINS MOVED: dayfacts-1.0.0 (owner 2026-08-25) =====
 * This suite used to close with a "Full Notes OFF is schedule/booking-only"
 * pair: OFF made ZERO chart reads and its history receipt read
 * reason 'full-notes-off'. The owner's superseding DAY contract (dayfacts-1.0.0,
 * Codex-accepted 2026-08-25) REVOKED that meaning, so those two pins were
 * pinning a contract that no longer exists. The checkbox now selects HOW MUCH
 * history a bulk pull reads, never WHETHER charts open:
 *
 *   OFF (settled)  = day-facts mode. The per-patient batch RUNS. Every exact
 *                    scheduled row still gets its identity-verified chart open
 *                    and chart-facts save (the pipelined-parse branch), and
 *                    exactly the pulled-day encounter note is attempted;
 *                    historical visit traversal is skipped (visitsSkipped).
 *                    Receipt: visitNotesMode 'day-facts', chartFactsRequired
 *                    true, allVisitBodiesRequested false, plus honest
 *                    insurance placeholders (0 / 'reader-not-shipped').
 *   ON             = the same mandatory floor PLUS the unscoped historical
 *                    walker. Receipt: visitNotesMode 'full'.
 *   UNSET/unsettled= fail-closed. Blocked receipt, reason
 *                    'visit-notes-unchosen', visitNotesMode 'blocked-unchosen',
 *                    zero reads of any kind.
 *
 * Nothing was deleted: each revoked pin was REPLACED by its new-contract
 * equivalent, and the checks that guarded the still-true half of the old
 * boundary (OFF never traverses historical bodies; ON does, in the managed
 * schedule-batch lane) are kept verbatim. The old 'visit-notes-off'
 * schedule-only no-op is additionally pinned as REMOVED so it cannot be
 * reasserted, and no user-facing line may claim OFF opens no charts.
 *
 * ===== dayfacts-1.0.1 (owner 2026-08-25): THE DAY-NOTE LANES ARE LIVE =======
 * Round 1 of this suite reported one engine gap: the pulled-day encounter-note
 * attempt was unreachable in day-facts mode (both lanes hard-disabled ahead of
 * their conditions, and tnAggregate short-circuiting the whole OFF column as
 * "not requested"). That gap is now CLOSED in the engine, so the TODO that
 * stood in for it is replaced by the assertion it named: day-facts mode must
 * PROVE one exact-day (onlyDate) encounter-note attempt per scheduled row,
 * folded into the row's own already-open chart, and the receipt's day-note
 * census must agree with the reads actually made. The suite additionally pins
 * the rest of the 1.0.1 delta at source: both lane flags true, the tnAggregate
 * checkbox short-circuit gone, the stop path's 'stopped-by-user' stamp in BOTH
 * modes, retryFailedHistory's wholesale OFF refusal gone, one 'day-facts'
 * envelope vocabulary at every level, the decoupled Calendar door, and the
 * mls-connect half (day-completion mapper + legacy _pullAllHistories scope).
 *
 * ===== dfc-1.1.0 (owner DAY contract, 2026-08-25): THE DIRECT BRIDGE READ ===
 * Day-facts OFF now performs EXACTLY ONE SCOPED AllVisits bridge read per row:
 * the engine posts mlsAppReadAllVisits with hint.onlyDate = the pulled day
 * (plus patientId, todayKey, identity) while the row's own verified chart is
 * still open, and SAVES the pulled day's OWN encounter body as a visit through
 * the additive scoped save (no reconcile; older visits untouched). On direct-
 * read success the row's todayNote is true, todayNoteDirectBridge marks the
 * transport, sameDayReceipt carries the scoped save proof, and the LEGACY
 * vp/tn/defer/idle ladder must never fire for that row. On ANY direct-read
 * failure (ok:false, unscoped receipt from a legacy reader, deadline) the
 * legacy ladder still runs exactly as before, so a failing row costs one extra
 * noteCalls entry (the failed bridge attempt, transport 'bridge') before its
 * vp attempt. ON/full mode is unchanged. The suite's store pin FLIPPED with
 * this delta: OFF now holds exactly one visit per row, dated the pulled day -
 * the no-HISTORICAL-bodies protection now lives in the visit-date check.
 *
 * REMAINING ENGINE GAPS (reported, deliberately NOT frozen into expectations):
 * 1. dfc-1.1.0 DOUBLE SCOPED READ: on direct-read SUCCESS the legacy vp
 *    fold-in still fires a second scoped read for the same row in the same
 *    batch - the fold-in door (importer :5930) never consults one.todayNote
 *    (set true at :5633) and dnAlreadyReadToday (:5949) reads a day-ledger
 *    stamp only written at index finalization (:1691). Measured: 6 scoped
 *    reads for 3 clean OFF rows. The one-read-per-row pins in
 *    dayFactsBatchIsTheMandatoryFloor() stay at the CONTRACT numbers and are
 *    RED until the engine suppresses the fold-in after a direct-read success.
 * 2. the deferred day-note round can no longer be armed by anything - see the
 *    TODO in dayFactsDeferrableNoteIsAccountedHonestly().
 * Synthetic identities only.
 * ============================================================================= */

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeHarness, makeMonthHarness, flush } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const IMPORTER = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const CONNECT = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');

const BASELINE_COMMIT = '2165bc242da40c139f1a0577d4611c3638c677b0';
function baselineFile(relativePath) {
  return childProcess.execFileSync('git', ['show', BASELINE_COMMIT + ':' + relativePath], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  });
}
const BASELINE_IMPORTER = baselineFile('1p-feat_mls_schedimport_exact.js');
const BASELINE_BACKGROUND = baselineFile('background.js');
const BASELINE_CONTENT = baselineFile('content.js');
const BASELINE_MANIFEST = JSON.parse(baselineFile('manifest.json'));

const DAY = '2026-08-23';
const VALID_APPOINTMENT_ID = 'Appt_9-XY';
const GOOD_CHART = {
  problems: 'Synthetic problem', meds: 'Synthetic medication',
  summary: 'Synthetic summary'
};

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function between(source, start, end, label) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  ok(from >= 0 && to > from, label + ': source boundary moved or disappeared');
  return source.slice(from, to);
}

function sourceContracts() {
  /* First prove the governing facts against the exact 3.0.64 release commit,
     instead of inferring them from a later package or today's implementation. */
  eq(BASELINE_MANIFEST.version, '3.0.64',
    'the pinned governing commit is not the 3.0.64 extension release');
  const baselineChartLoop = between(
    BASELINE_IMPORTER,
    'var rd = null, chartAttempt = 0, overlapParse = null;',
    '/* Skipping visits is recorded honestly on the receipt',
    '3.0.64 ordinary chart loop'
  );
  ok(baselineChartLoop.includes('dnReadChart(target, function () {}, { requestId: chartRequestId, deadlineAt: chartDeadlineAt, athenaOwnerToken: siAthenaOwnerToken })'),
    'the exact 3.0.64 commit does not contain the claimed ordinary chart-read call');
  ok(!baselineChartLoop.includes('exactAppointmentFullRead'),
    'the exact 3.0.64 ordinary row contains an appointment-full-read detour');
  ok(!baselineChartLoop.includes('mlsAppGotoDate') && !baselineChartLoop.includes('gotoDate'),
    'the exact 3.0.64 ordinary row contains a date re-ground/navigation detour');
  /* dayfacts-1.0.0 KEEPS this per-row body-stage skip - it is exactly what
     day-facts mode still does on OFF. Only the BATCH-level schedule-only
     no-op that grew on top of it was revoked. */
  ok(BASELINE_IMPORTER.includes('if (!stopAfterTimeout && pullVisitBodies !== true) {') &&
    BASELINE_IMPORTER.includes('one.visitsSkipped = true;'),
    'the exact 3.0.64 commit does not contain the Full Notes OFF body-stage skip');
  ok(BASELINE_IMPORTER.includes('bridge("mlsAppAllVisitsResult", "mlsAppReadAllVisits"'),
    'the exact 3.0.64 commit does not contain the Full Notes ON all-visits call');
  ok(BASELINE_CONTENT.includes("d.type !== 'mlsAppReadAllVisits'") &&
    BASELINE_CONTENT.includes("type: 'mlsAppAllVisitsRequest'"),
    'the exact 3.0.64 content bridge does not preserve the AllVisits message boundary');
  ok(BASELINE_BACKGROUND.includes("msg.type !== 'mlsAppAllVisitsRequest'") &&
    BASELINE_BACKGROUND.includes('runAllVisits(appTabId, msg.hint || {}, cfg, transportRequestId, msg.deadlineAt)'),
    'the exact 3.0.64 worker does not preserve the AllVisits dispatcher call');

  /* The successful per-row loop must keep the 3.0.64 call shape. Recovery for
     a failed row belongs outside this ordinary call, never in every row.
     dayfacts-1.0.0 does not touch this loop: day-facts mode reaches it for
     EVERY scheduled row, so the fast path now carries more traffic, not less. */
  const chartLoop = between(
    IMPORTER,
    'var rd = null, chartAttempt = 0, overlapParse = null;',
    '/* Skipping visits is recorded honestly on the receipt',
    'ordinary chart loop'
  );
  ok(chartLoop.includes('dnReadChart(target, function () {}, { requestId: chartRequestId, deadlineAt: chartDeadlineAt, athenaOwnerToken: siAthenaOwnerToken })'),
    'the ordinary row no longer uses the proven 3.0.64 chart-read call shape');
  ok(!chartLoop.includes('exactAppointmentFullRead'),
    'the ordinary row acquired an appointment-full-read detour');
  ok(!chartLoop.includes('mlsAppGotoDate') && !chartLoop.includes('gotoDate'),
    'the ordinary row acquired a date re-ground/navigation detour');

  /* Only an exact, bound-shell hydration refusal is normalized into the
     existing cold lane. Its two allowlist evaluations must both retain it. */
  const noBound = between(
    BACKGROUND,
    'function normalizeNoBoundDetail(a) {',
    'if (attempt.failure) {',
    'no-bound cold recovery'
  );
  ok(noBound.includes("a.detail.fullDetail !== true && String(a.detail.reason || '') === 'no-bound-clinical-detail'"),
    'a complete or unrelated detail could enter no-bound cold recovery');
  eq((noBound.match(/coldRetryable = \/\^\(\?:no-bound-clinical-detail\|/g) || []).length, 2,
    'no-bound-clinical-detail is not allowlisted before and after the bounded cold retry');
  ok(noBound.includes('while (coldRetryable && coldTries < 2'),
    'the no-bound recovery is no longer bounded to the established cold attempts');

  /* Missing bodies and unstable keys are separate classifications; body
     completeness remains strict and cannot be manufactured by the repair. */
  const stableKeys = between(
    BACKGROUND,
    'var sourceKeys = {}, stableKeysComplete = true;',
    'var receipt = {',
    'stable source-key classification'
  );
  ok(stableKeys.includes("if (!sourceKey || sourceKeys[sourceKey]) stableKeysComplete = false;"),
    'empty/duplicate stable source keys no longer fail closed');
  ok(stableKeys.includes("if (!stableKeysComplete) failures.push({ index: -1, reason: 'stable-source-keys-incomplete' });"),
    'the stable-key refusal disappeared from the receipt');
  /* scensus-1.0.0/1.0.1 strengthened this clause: a scoped census with an
     unknown-date row, or without a proven account-local calendar authority,
     is additionally incomplete (never absence-by-arithmetic) */
  ok(stableKeys.includes('var bodyComplete = failures.length === 0 && visits.length === clinicalTotal && stableKeysComplete && (!frozenHint.onlyDate || (dateUnknownRows.length === 0 && (scTodayKeyValid || visits.length > 0)));'),
    'body completeness no longer independently requires every clinical body (plus scensus unknown-date/authority incompleteness)');

  /* Freeze only a valid opaque Athena id and rebuild both aliases on retry. */
  const frozenRetry = between(
    IMPORTER,
    'function frozenRetryEntry(row, target, reason, diagSource) {',
    'function historyDiagSuffix(one) {',
    'frozen retry entry'
  );
  ok(frozenRetry.includes('/^[A-Za-z0-9_-]{2,40}$/.test(rawAppointmentId)'),
    'retry capture no longer validates the opaque appointment id');
  ok(frozenRetry.includes('entry.diag = {') && frozenRetry.includes('find: diagSource.findDiag || null'),
    'the PHI-free chart-open diagnostic no longer travels with the retry');
  const retryBuild = between(
    IMPORTER,
    'var rawFrozenAppointmentId = String(item && item.appointmentId || "").trim();',
    'return { rows: rows, unresolved: unresolved };',
    'retry row rebuild'
  );
  ok(retryBuild.includes('/^[A-Za-z0-9_-]{2,40}$/.test(rawFrozenAppointmentId)'),
    'retry rebuild no longer re-validates the frozen appointment id');
  ok(retryBuild.includes('appointmentId: frozenAppointmentId') &&
    retryBuild.includes('athenaAppointmentId: frozenAppointmentId'),
    'retry rebuild no longer restores both appointment-id aliases');

  /* The content bridge may expose only closed codes, booleans, and numeric
     counts. Never forward Athena row/name/DOB/MRN payloads as diagnostics. */
  const diagnostics = between(
    CONTENT,
    "var openedSafe = (opened && typeof opened === 'object') ? opened : {};",
    'if (chartBootstrapIdentity && !(opened.appointmentIdBound === true',
    'chart-open diagnostics'
  );
  ok(diagnostics.includes("function openCode(value) { return mlsStr(value, 40).toLowerCase().replace(/[^a-z0-9_-]/g, ''); }"),
    'chart-open diagnostic codes are no longer closed and length bounded');
  ok(diagnostics.includes("['scanned', 'scrollers', 'topScore', 'inputCount', 'numericFieldsRefused', 'apptIdMatches', 'rowDobKnown']"),
    'the closed numeric chart-open diagnostic allowlist changed');
  ok(diagnostics.includes('safeDiag.rowMrnMatched = openedDiag.rowMrnMatched === true;'),
    'the closed boolean MRN-match diagnostic disappeared');
  ok(diagnostics.includes('diag: safeDiag') && !diagnostics.includes('diag: openedDiag'),
    'the bridge forwards raw chart-open diagnostics instead of the safe projection');

  /* A transient first pass is visibly pending until the established sweep
     settles it; it must not paint a terminal orange failure prematurely. */
  ok(IMPORTER.includes('var oneQueuedForSweep =') &&
    IMPORTER.includes('oneQueuedForSweep ? "queued-for-automatic-recheck"'),
    'the first-pass transient row is no longer queued calmly for re-check');
  ok(IMPORTER.includes('var AUTOMATIC_HISTORY_RETRY_REASON =') &&
    IMPORTER.includes('var SWEEPABLE_REASON = AUTOMATIC_HISTORY_RETRY_REASON;'),
    'row progress and automatic sweep no longer share one retry vocabulary');
  ok(CONNECT.includes("/^queued-for-automatic-recheck/.test(raw)") &&
    CONNECT.includes('chart saved — full visit notes queued for automatic re-check'),
    'the pull panel no longer renders queued-for-recheck as a pending state');
}

/* ===== dayfacts-1.0.0 source pins (owner 2026-08-25) =========================
 * These replace nothing in the block above; they are the SOURCE half of the
 * runtime pins that moved. Each one is a fact the revoked contract could not
 * have satisfied, so a silent revert to schedule-only OFF turns them red.
 * ========================================================================== */
function dayFactsSourceContract() {
  /* 1. The batch door is now the SETTLED tri-state, not the boolean. An
        unchosen account is refused here with its own reason and mode. */
  const batchDoor = between(
    IMPORTER,
    'var chartFactsRequired = true;',
    'if (historyBatchRunning) {',
    'day-facts batch door'
  );
  ok(batchDoor.includes('if (!batchChoiceAdmitted) {'),
    'the batch door no longer refuses on an UNCHOSEN preference');
  ok(!batchDoor.includes('if (!visitNotesRequested) {'),
    'the revoked "OFF is a complete no-op" batch early-return came back');
  ok(batchDoor.includes('receipt.reason = "visit-notes-unchosen";') &&
    batchDoor.includes('receipt.visitNotesMode = "blocked-unchosen";'),
    'the unchosen refusal no longer names itself visit-notes-unchosen/blocked-unchosen');
  eq((IMPORTER.match(/receipt\.reason = "visit-notes-off";/g) || []).length, 0,
    'the removed visit-notes-off schedule-only no-op was reasserted in the batch');
  ok(IMPORTER.includes('var batchChoiceAdmitted = safe(function () {') &&
    IMPORTER.includes('return !!(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"));'),
    'batch admission no longer requires a SETTLED on/off choice');

  /* 2. The receipt vocabulary: mode names the scope, the mandatory floor is
        always true, and insurance is declared honestly as not-yet-attempted. */
  ok(IMPORTER.includes('visitNotesMode: visitNotesRequested ? "full" : "day-facts"'),
    'the batch receipt no longer labels OFF as day-facts mode');
  ok(IMPORTER.includes('chartFactsRequired: chartFactsRequired, allVisitBodiesRequested: allVisitBodiesRequested, insuranceAttempted: 0, insuranceComplete: false, benefitsComplete: false, insuranceReason: "reader-not-shipped"'),
    'the mandatory chart-facts floor / body-scope / honest insurance placeholders left the receipt');
  ok(IMPORTER.includes('var chartFactsRequired = true;') &&
    IMPORTER.includes('var allVisitBodiesRequested = visitNotesRequested;'),
    'chart facts stopped being the always-true floor, or the checkbox stopped meaning body scope');

  /* 3. includeHistory means "run the batch at all" and is decoupled from the
        checkbox in ALL THREE callers - the day pull, the month pull, and (new
        in dayfacts-1.0.1) the Calendar door; the day pull defaults it to TRUE.
        Counting the three occurrences is what stops a fourth caller from
        quietly re-introducing a coupled door somewhere else. */
  const decoupledDoors = (IMPORTER.match(/var includeHistory = opts\.includeHistory !== false;/g) || []).length;
  eq(decoupledDoors, 3,
    'the day pull, month pull and Calendar pull no longer share the decoupled includeHistory door');
  eq((IMPORTER.match(/var includeHistory = /g) || []).length, decoupledDoors,
    'a caller declares includeHistory with a shape other than the decoupled door');
  ok(!IMPORTER.includes('var includeHistory = visitNotesRequested === true && opts.includeHistory !== false && !fullNotesOff;'),
    'the day pull re-coupled includeHistory to the Full-visit-notes checkbox');
  ok(!IMPORTER.includes('var includeHistory = opts.includeHistory !== false && !monthFullNotesOff;'),
    'pullMonth again forces includeHistory=false when the checkbox is OFF');
  /* dayfacts-1.0.1: the Calendar door used to AND the checkbox in, so an OFF
     Calendar pull skipped the mandatory batch entirely. Prove the decoupled
     declaration is the one INSIDE pullCalendarSelection, not merely present. */
  const calendarDoor = between(
    IMPORTER,
    'function pullCalendarSelection(opts) {',
    'return publicPull({ date: frozenDate',
    'calendar selection door'
  );
  ok(calendarDoor.includes('var includeHistory = opts.includeHistory !== false;'),
    'the Calendar pull no longer opens the decoupled includeHistory door');
  ok(!/var includeHistory = [^;]*(?:calendarPullVisitBodies|visitNotesRequested|fullNotesOff|pullVisitBodies)/.test(calendarDoor),
    'the Calendar pull re-coupled includeHistory to the Full-visit-notes checkbox');
  ok(IMPORTER.includes('if (runOpts.includeHistory === undefined) runOpts.includeHistory = true;'),
    'dayPull no longer defaults includeHistory to TRUE');

  /* 4. The only remaining history skips are the census phase-1 caller and a
        day with nothing provable to read - never the checkbox. */
  ok(IMPORTER.includes('var historySkipReason = p1CensusHistoryDeferred ? "provider-attribution-unavailable" : "not-requested";'),
    'the day-pull history skip reason no longer excludes the checkbox');
  ok(!IMPORTER.includes('var historySkipReason = fullNotesOff ?'),
    'the revoked full-notes-off history skip reason came back to the day pull');

  /* 5. No user-facing line may claim OFF opens no charts; the month-complete
        OFF line states the abbreviated scope it actually performs. */
  eq((IMPORTER.match(/no patient charts or visit notes were opened/g) || []).length, 0,
    'a user-facing line again claims Full Notes OFF opened no patient charts');
  ok(IMPORTER.includes('Full visit notes is off - each day saved chart facts and attempted only its own pulled-day note; no other historical bodies were read.'),
    'the month-complete OFF message no longer states chart facts + own-day note only');

  /* ===== dayfacts-1.0.1 source deltas ====================================== */

  /* 6. BOTH pulled-day note lanes are live. Round 1 measured them hard-disabled
        by a literal ahead of their own conditions - the cheapest possible way
        to make a shipped lane inert while every surrounding pin stays green -
        so the literal is pinned to TRUE and the `false` spelling is pinned as
        absent for both names. */
  ok(IMPORTER.includes('var pulledDayNoteLaneEnabled = true;'),
    'the inline pulled-day note fold-in is disabled again by its own flag');
  ok(IMPORTER.includes('var pulledDayNoteTailEnabled = true;'),
    'the pulled-day note tail pass is disabled again by its own flag');
  eq((IMPORTER.match(/pulledDayNote(?:Lane|Tail)Enabled = false/g) || []).length, 0,
    'a pulled-day note lane was re-disabled by a literal ahead of its condition');
  /* the flags must still GUARD their lanes - a live flag nothing reads is the
     same inert lane wearing a green literal. */
  eq((IMPORTER.match(/if \(pulledDayNoteLaneEnabled && /g) || []).length, 1,
    'the inline fold-in no longer reads its own enable flag');
  eq((IMPORTER.match(/if \(pulledDayNoteTailEnabled && /g) || []).length, 1,
    'the tail pass no longer reads its own enable flag');
  /* both lanes are the OFF-mode lanes: their conditions still exclude ON. */
  ok(IMPORTER.includes('if (pulledDayNoteLaneEnabled && !stopAfterTimeout && pullVisitBodies !== true && one.visitsSkipped === true && rd && !inlineDayNoteFuse && one.todayNote == null) {'),
    'the inline fold-in left its day-facts (visitsSkipped, chart-already-read) condition');
  ok(IMPORTER.includes('if (pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped) {'),
    'the tail pass left its day-facts / not-stopped condition');

  /* 7. tnAggregate's checkbox short-circuit is gone: the real per-row tally
        runs in BOTH modes and not-requested survives only at the blocked door. */
  const tnAgg = between(
    IMPORTER,
    'function tnAggregate() {',
    'receipt.todayNoteFailures = tnF; receipt.todayNoteReasons = tnR;',
    'tnAggregate census'
  );
  ok(!tnAgg.includes('if (receipt.visitNotesRequested !== true) {'),
    'the revoked checkbox short-circuit came back to tnAggregate');
  ok(tnAgg.includes('receipt.todayNoteNotRequested = 0;'),
    'tnAggregate no longer zeroes not-requested before the real per-row tally');
  ok(!tnAgg.includes('receipt.todayNoteNotRequested = Number((receipt.patients || []).length || 0);'),
    'tnAggregate again declares the whole day-facts column "not requested"');

  /* 8. Stop stamps the same honest reason in both modes; the revoked
        'visit-notes-off' row stamp is gone from the stop path. */
  const stopPath = between(
    IMPORTER,
    'var tnSkipped = 0, tnNotRequested = 0;',
    'receipt.todayNoteStoppedRows = tnSkipped;',
    'stop-path day-note stamp'
  );
  ok(stopPath.includes('p.todayNote = false;') && stopPath.includes('p.todayNoteReason = "stopped-by-user";'),
    'a stopped row no longer records its pulled-day note as stopped-by-user');
  ok(!stopPath.includes('"visit-notes-off"') && !stopPath.includes('p.todayNote = "not-requested";'),
    'the revoked visit-notes-off / not-requested stop stamp came back');
  eq((stopPath.match(/if \(receipt\.visitNotesRequested !== true\)/g) || []).length, 0,
    'the stop path branches on the checkbox again instead of stamping both modes alike');

  /* 9. retryFailedHistory no longer refuses an OFF receipt wholesale; the
        frozen override still scopes retried bodies to the receipt's own mode. */
  const retryGate = between(
    IMPORTER,
    'function retryFailedHistory(source, onStatus) {',
    'var retryScopeDay = normDate(',
    'retryFailedHistory OFF refusal'
  );
  ok(!retryGate.includes('if (retryBodiesRequested !== true && retry.length) {'),
    'the wholesale Full-Notes-OFF retry refusal came back to retryFailedHistory');
  ok(retryGate.includes('var retryBodiesRequested = typeof history.visitNotesRequested === "boolean"'),
    'the retry lost the frozen per-receipt body scope');
  eq((IMPORTER.match(/full-notes-off/g) || []).length, 0,
    'the revoked full-notes-off reason was reasserted somewhere in the importer');
  eq((IMPORTER.match(/visitNotesMode: "not-requested"/g) || []).length, 0,
    'a receipt again reports not-requested as a visit-notes MODE');

  /* 10. One envelope vocabulary at EVERY level: an OFF pull reports mode
         'day-facts' on the day-fail, day-success and month envelopes alike. */
  eq((IMPORTER.match(/fullNotesOff \? "day-facts"/g) || []).length, 3,
    'the day pull envelopes no longer map Full-Notes-OFF to day-facts mode at all three levels');
  eq((IMPORTER.match(/monthFullNotesOff \? "day-facts"/g) || []).length, 2,
    'the month pull envelopes no longer map Full-Notes-OFF to day-facts mode');
  eq((IMPORTER.match(/NotesOff \? "not-requested"/g) || []).length, 0,
    'an OFF pull envelope again reports "not-requested" as its visit-notes mode');
  ok(IMPORTER.includes('res.visitNotesMode = fullNotesOff ? "day-facts" : (res.visitNotesRequested === true ? "full" : (historyReceipt && historyReceipt.visitNotesMode) || "unspecified");'),
    'the day-success envelope no longer normalises its mode to the one vocabulary');

  /* 11. The idle/deferred seams refuse ONLY an unchosen preference now -
         settled OFF is day-facts mode and its onlyDate reads are mandatory. */
  const niGateBlock = between(
    IMPORTER,
    'function niGate(force) {',
    'if (_ni.reading === true)',
    'idle backfill gate'
  );
  ok(niGateBlock.includes('return { open: false, reason: "visit-notes-unchosen" };'),
    'the idle backfill gate no longer names its refusal visit-notes-unchosen');
  ok(!niGateBlock.includes('reason: "visit-notes-off"'),
    'the idle backfill gate refuses settled-OFF day-facts rows again');
  ok(niGateBlock.includes('return !(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"));'),
    'the idle backfill gate stopped requiring a SETTLED choice');
  const niReadOnceBlock = between(
    IMPORTER,
    'function niReadOnce(row) {',
    'var vp = safe(function () { return window.__mlsVisitSavePref; }, null);',
    'idle backfill pre-read gate'
  );
  ok(niReadOnceBlock.includes('return Promise.resolve({ ok: false, reason: "visit-notes-unchosen" });'),
    'the pre-read idle gate no longer names its refusal visit-notes-unchosen');
  ok(!niReadOnceBlock.includes('reason: "visit-notes-off"'),
    'the pre-read idle gate refuses settled-OFF day-facts rows again');

  /* 12. The mls-connect half of dayfacts-1.0.1. The legacy _pullAllHistories
         wrapper does exactly one thing (the full historical crawl), so it may
         still refuse OFF - but only about HISTORICAL bodies, and it may never
         tell the doctor that OFF opens no charts. */
  ok(CONNECT.includes("reason: 'historical-bodies-not-requested', visitNotesRequested: false, historiesRequested: 0"),
    'the legacy history helper no longer scopes its refusal to historical bodies');
  eq((CONNECT.match(/reason: 'visit-notes-off', visitNotesRequested: false/g) || []).length, 0,
    'the legacy history helper reasserted the revoked visit-notes-off refusal');
  ok(CONNECT.includes('Full visit notes is off, so this legacy history helper did not crawl historical encounter bodies.'),
    'the legacy history helper no longer states the historical-only scope of its refusal');
  eq((CONNECT.match(/patient charts and visit notes were not opened/g) || []).length, 0,
    'a mls-connect line again tells the doctor that Full Notes OFF opened no charts');
  /* the day-completion mapper: OFF is day-facts, so it must NOT suppress the
     history line, and its OFF sentence must describe the abbreviated scope. */
  ok(CONNECT.includes("var historyIntentionallySkipped = hr.skipped === true ||\n        r.historyRequested === false || r.includeHistory === false;"),
    'the day-completion mapper again treats an OFF receipt as intentionally-skipped history');
  ok(!CONNECT.includes("var historyIntentionallySkipped = hr.visitNotesRequested === false || hr.skipped === true ||"),
    'the revoked visitNotesRequested===false history suppression came back to the mapper');
  /* the shipped source spells the apostrophe as a LITERAL ’ escape (the
     latin1-writer law): match the bytes that are actually in the file. */
  ok(CONNECT.includes('Historical visit notes were skipped by choice (Full visit notes is off); chart facts and each day\\u2019s own note were read.'),
    'the day-completion OFF sentence no longer reports the chart facts + own-day note that day-facts mode reads');
  /* the CONVERTED completion sentence is the one built by the day-completion
     mapper, and it is the only place the old wording may not reappear. */
  const completionLine = between(
    CONNECT,
    "var visitNotesMessage = hr.visitNotesMode === 'day-facts'",
    "return { ok: true, message: fmtDay(day)",
    'day-completion visit-notes sentence'
  ); /* dayfacts-1.0.2: keyed on the MODE so a blocked refusal can never borrow the working sentence */
  ok(!completionLine.includes('Full visit notes were intentionally skipped (Full Notes is off).'),
    'the revoked "visit notes were intentionally skipped" sentence came back to the day-completion mapper');
  ok(completionLine.includes('pulled-day note'),
    'the day-completion OFF sentence stopped reporting unread pulled-day notes at all');

  /* TODO(dayfacts-1.0.1 ENGINE GAP - reported, deliberately NOT pinned red):
     the PERSISTED day-pull terminal receipt in mls-connect was not converted
     with the rest of the vocabulary. Measured against these bytes:
       1p-mls-connect.js:49570  visitNotes.mode = requested === false
                                ? 'not-requested'  <- the mode delta-6 removed
                                                      from every other level
       1p-mls-connect.js:49602  ' Full visit notes were intentionally skipped
                                  (Full Notes is off).'  <- shown to the doctor
                                  on reload for a pull that DID attempt every
                                  pulled-day note (todayNoteRead 2 of 2 here).
     The assertions that WOULD pin it, once the mapper is converted:
        ok(!CONNECT.includes("'not-requested' : 'unknown'"), ...);
        ok(!CONNECT.includes(' Full visit notes were intentionally skipped'), ...);
     What is pinned instead is honest today AND load-bearing either way: the
     persisted receipt must keep carrying the day-note census (so a converted
     line has real numbers to state, and an unconverted one is measurably
     contradicted by its own receipt). */
  ok(CONNECT.includes("read: dsReceiptCount(hr.todayNoteRead), failures: dsReceiptCount(hr.todayNoteFailures), notRequested: dsReceiptCount(hr.todayNoteNotRequested)"),
    'the persisted day-pull terminal receipt stopped carrying the day-note census');
}

/* The mls-connect half of dayfacts-1.0.0, proven by EXECUTING the real gate
   rather than matching its source: a shipped regex that never runs is a
   regex nobody has tested (shell-transport backslash law). */
function connectAdmitsExactlyTheDayScopedRead() {
  const start = 'api.runForPatient = function (p, onStatus, runOpts) {';
  const end = 'function ensureSettings() {';
  const from = CONNECT.indexOf(start);
  const to = CONNECT.indexOf(end, from + start.length);
  ok(from >= 0 && to > from, 'the mls-connect runForPatient gate boundary moved or disappeared');

  const cvCalls = [];
  let pref = null;
  const ctx = vm.createContext({
    api: { running: false, current: null },
    enabled: () => !!(pref && pref.on === true && pref.state === 'on'),
    window: {
      __mlsVisitNotesPref: { read: () => pref },
      __mlsCopyVisits: { run: (_say, _p, runOpts) => { cvCalls.push(runOpts || null); return Promise.resolve(2); } }
    },
    Promise, Error, RegExp, String
  });
  vm.runInContext(CONNECT.slice(from, to), ctx, { filename: 'connect-runForPatient-gate' });

  const patient = { id: 'syn-01', name: 'Synthetic Row 01' };
  function reset() { ctx.api.running = false; ctx.api.current = null; }
  function call(runOpts) {
    const promise = Promise.resolve(ctx.api.runForPatient(patient, null, runOpts));
    return promise.then(value => { reset(); return value; }, error => { reset(); throw error; });
  }

  /* UNSET is fail-closed for BOTH shapes - a day-scoped read is not a way in. */
  pref = { state: 'unset', on: false, settled: false };
  return call({ onlyDate: DAY })
    .then(res => {
      eq(res.skipped, 'preference-unchosen',
        'an unchosen preference admitted the pulled-day scoped read');
      return call({});
    })
    .then(res => {
      eq(res.skipped, 'preference-unchosen',
        'an unchosen preference did not refuse the unscoped read as unchosen');
      eq(cvCalls.length, 0, 'an unchosen preference reached the visit reader');
      /* SETTLED OFF: unscoped still refused, exact-day scoped now admitted. */
      pref = { state: 'off', on: false, settled: true };
      return call({});
    })
    .then(res => {
      eq(res.skipped, 'preference-off',
        'settled-off no longer refuses an UNSCOPED historical body read');
      eq(cvCalls.length, 0, 'settled-off let an unscoped read reach the visit reader');
      return call({ onlyDate: DAY });
    })
    .then(res => {
      eq(res.ok, true, 'settled-off refused the mandatory pulled-day scoped read');
      eq(cvCalls.length, 1, 'the admitted day-scoped read never reached the visit reader');
      eq(String((cvCalls[0] || {}).onlyDate || ''), DAY,
        'the admitted read lost its exact pulled-day scope');
      /* A malformed date is NOT a well-formed onlyDate and must not open the door. */
      return call({ onlyDate: '8/23/2026' });
    })
    .then(res => {
      eq(res.skipped, 'preference-off',
        'a malformed onlyDate was accepted as the day-scoped admission');
      eq(cvCalls.length, 1, 'a malformed onlyDate reached the visit reader');
      pref = { state: 'on', on: true, settled: true };
      return call({});
    })
    .then(res => {
      eq(res.ok, true, 'settled-on refused the unscoped historical walk');
      eq(cvCalls.length, 2, 'settled-on did not reach the unscoped visit reader');
    });
}

async function successfulBulkKeeps3064Trace() {
  const h = makeHarness({
    day: DAY, today: '2026-08-24', rows: 3,
    visitNotesOn: true,
    chartCoverage: true, parseResult: () => GOOD_CHART
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  const golden3064 = {
    scheduledRows: 3,
    ordinaryChartReads: 3,
    exactAppointmentFullReads: 0,
    dateRegrounds: 0
  };
  const observed = {
    scheduledRows: h.rows.length,
    ordinaryChartReads: h.chartCalls.filter(call => call.exactAppointmentFullRead !== true).length,
    exactAppointmentFullReads: h.chartCalls.filter(call => call.exactAppointmentFullRead === true).length,
    dateRegrounds: h.gotoCalls.length
  };
  eq(JSON.stringify(observed), JSON.stringify(golden3064),
    'successful bulk trace diverged from the 3.0.64 one-read-per-row golden path');
  ok(receipt.complete === true && receipt.patients.length === 3 &&
    receipt.patients.every(patient => patient.complete === true),
    'the golden fast-path fixture did not finish every scheduled patient');
  ok(h.chartCalls.every((call, index) =>
    call.appointmentId === h.rows[index].appointmentId && call.scheduleDate === DAY),
    'ordinary chart reads changed the frozen schedule binding');
}

async function retryPreservesBindingAndDiagnostic() {
  const h = makeHarness({
    day: DAY, today: '2026-08-24', rows: 1,
    visitNotesOn: true,
    chartCoverage: true, parseResult: () => GOOD_CHART,
    chartResult: () => ({
      __throw: 'athenaOne patient search found no matching patient.',
      mlsFind: {
        findReason: 'dob-mismatch', reason: 'dob-mismatch', route: 'findpatient',
        scanned: 2, rowMrnMatched: false
      }
    })
  });
  h.rows[0].appointmentId = VALID_APPOINTMENT_ID;
  h.rows[0].athenaAppointmentId = VALID_APPOINTMENT_ID;

  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  ok(receipt.retry.length >= 1, 'failed scheduled row did not emit a retry entry');
  const entry = receipt.retry[0];
  eq(entry.appointmentId, VALID_APPOINTMENT_ID,
    'retry entry lost the valid frozen appointment id');
  ok(entry.diag && entry.diag.find && entry.diag.find.findReason === 'dob-mismatch' &&
    entry.diag.find.route === 'findpatient' && entry.diag.find.scanned === 2,
    'retry entry lost the closed chart-open diagnostic');

  const rebuilt = h.api._buildRetryRows([entry], '');
  eq(rebuilt.rows.length, 1, 'valid retry entry did not rebuild');
  eq(rebuilt.rows[0].appointmentId, VALID_APPOINTMENT_ID,
    'rebuilt retry lost the canonical appointment id');
  eq(rebuilt.rows[0].athenaAppointmentId, VALID_APPOINTMENT_ID,
    'rebuilt retry lost the Athena appointment-id alias');
  eq(rebuilt.rows[0].scheduleDate, DAY,
    'rebuilt retry lost the frozen schedule day');
}

/* ===== dayfacts-1.0.0 runtime: the batch is the MANDATORY FLOOR =============
 * REPLACES the old "OFF makes zero chart reads" pin. Day-facts mode now runs
 * the same 3.0.64 one-read-per-row fast path as ON and saves the chart facts;
 * only the historical bodies are out of scope.
 * ========================================================================== */
async function dayFactsBatchIsTheMandatoryFloor() {
  function boot(visitNotesOn) {
    return makeHarness({
      day: DAY, today: '2026-08-24', rows: 3,
      visitNotesOn: visitNotesOn,
      chartCoverage: true, parseResult: () => GOOD_CHART
    });
  }

  const offH = boot(false);
  const off = await offH.api._runHistoryBatch(offH.rows, [], offH.onStatus);

  /* --- the batch RAN (the revoked schedule-only no-op is gone) --- */
  ok(off.skipped !== true, 'day-facts mode skipped the per-patient history batch');
  eq(off.reason, 'complete', 'the day-facts batch did not run to a complete verdict');
  eq(off.requested, 3, 'day-facts mode did not request every scheduled row');
  eq(off.processed, 3, 'day-facts mode did not process every scheduled row');
  eq(off.failures, 0, 'the day-facts intentional body skip was counted as a failure');
  eq(off.complete, true, 'the day-facts batch refused to call itself complete');
  eq(off.exactIdentityVerified, true, 'day-facts mode saved without exact identity verification');
  /* every `patients.every(...)` pin below is only worth something if the array
     is the full scheduled set - an empty array satisfies all of them. */
  eq(off.patients.length, 3, 'the day-facts receipt did not carry every scheduled row');

  /* --- the mandatory floor: one identity-verified chart open + facts save --- */
  eq(offH.chartCalls.length, 3,
    'day-facts mode did not open the chart for every exact scheduled row');
  eq(offH.chartCalls.filter(call => call.exactAppointmentFullRead === true).length, 0,
    'day-facts mode detoured through appointment-full-read instead of the 3.0.64 fast path');
  eq(offH.gotoCalls.length, 0, 'day-facts mode re-grounded the date on an ordinary row');
  eq(offH.parseCalls.length, 3, 'day-facts mode skipped the pipelined chart parse');
  eq(offH.saveCalls.length, 3, 'day-facts mode did not save chart facts for every row');
  eq(Number((off.chartOpens && off.chartOpens.history) || 0), 3,
    'the receipt does not account one history chart open per day-facts row');
  eq(Number((off.chartOpens && off.chartOpens.rows) || 0), 3,
    'the receipt chart-open census lost the day-facts row count');
  eq(off.contentVerified, true, 'day-facts mode did not verify the saved chart content');
  eq(Number(off.contentGap || 0), 0, 'a day-facts row landed without content');
  ok(offH.patients.every(p => p.problems === GOOD_CHART.problems && p.summary === GOOD_CHART.summary),
    'day-facts mode left the store without the chart facts it claims to save');

  /* --- the receipt vocabulary the contract names --- */
  eq(off.visitNotesMode, 'day-facts',
    'the OFF history receipt no longer reports day-facts mode');
  eq(off.visitNotesRequested, false,
    'OFF did not carry the frozen choice into the history receipt');
  eq(off.chartFactsRequired, true,
    'the always-true mandatory chart-facts floor left the OFF receipt');
  eq(off.allVisitBodiesRequested, false,
    'OFF reported that all visit bodies were requested');
  eq(off.insuranceAttempted, 0, 'OFF claimed an insurance read the reader cannot perform');
  eq(off.insuranceComplete, false, 'a missing insurance reader was reported complete');
  eq(off.benefitsComplete, false, 'a missing benefits reader was reported complete');
  eq(off.insuranceReason, 'reader-not-shipped',
    'the honest missing-insurance-reader placeholder left the OFF receipt');

  /* --- still true from the old boundary: NO historical body traversal --- */
  ok(off.patients.every(p => p.visitsSkipped === true),
    'a day-facts row traversed historical visit bodies instead of skipping them');
  eq(offH.noteCalls.filter(call => !call.onlyDate).length, 0,
    'day-facts mode made an UNSCOPED historical visit-body read');
  /* dfc-1.1.0 FLIP (was `visits.length === 0`): the scoped direct read SAVES
     the pulled day's OWN encounter body through the additive scoped save -
     exactly one visit per row, dated the pulled day. The protection the old
     zero pin carried (no HISTORICAL bodies in OFF) is kept by the date check:
     any visit dated off the pulled day is still a red. */
  ok(offH.patients.every(p => (p.visits || []).length === 1),
    'a day-facts row did not save exactly one pulled-day visit body');
  ok(offH.patients.every(p => (p.visits || []).every(v => String(v.date || '') === DAY)),
    'day-facts mode wrote a HISTORICAL visit body into the store');

  /* ===== dayfacts-1.0.1: THE PULLED-DAY NOTE IS ATTEMPTED, AND PROVEN =======
     Round 1 could only report this as an engine gap (both lanes were disabled
     by a literal ahead of their conditions and tnAggregate short-circuited the
     whole OFF column). The lanes are live in 1.0.1, so the assertion round 1
     left as a TODO is now the pin: exactly one exact-day encounter-note
     attempt per scheduled row - no more (a second pass would re-open every
     chart) and no fewer (a silent lane is what round 1 measured). */
  const offScoped = offH.noteCalls.filter(call => String(call.onlyDate || '') === DAY);
  /* ENGINE GAP (dfc-1.1.0, reported 2026-08-25, deliberately left RED - see
     the header): the contract says the successful direct read is the row's
     ONLY scoped read ("the LEGACY vp/tn/defer/idle ladder never fires for
     that row"; "at most one scoped read per row per day"). MEASURED: 6 scoped
     reads for 3 rows - each row's successful bridge read (transport 'bridge',
     seq chart+1, todayNoteDirectBridge true) is followed by a SECOND scoped
     read through the legacy vp fold-in (seq chart+2), because the fold-in
     door at 1p-feat_mls_schedimport_exact.js:5930 never consults
     one.todayNote (set true at :5633) and dnAlreadyReadToday (:5949) reads a
     day-ledger stamp that is only written at index finalization (:1691), so
     it can never dedupe within the batch that made the read. The pins below
     are the CONTRACT, not today's engine. */
  eq(offScoped.length, 3,
    'day-facts mode did not attempt the pulled-day encounter note for every scheduled row');
  ok(offScoped.every(call => call.transport === 'bridge'),
    'a day-facts pulled-day note read left the scoped AllVisits bridge transport');
  eq(offScoped.length, offH.noteCalls.length,
    'a day-facts visit read escaped the exact pulled-day onlyDate scope');
  eq(JSON.stringify(offScoped.map(call => call.patientId)),
    JSON.stringify(offH.rows.map(row => row._mlsTargetPatientId)),
    'the day-facts day-note reads are not one per scheduled row, in schedule order');
  /* it is the INLINE FOLD-IN, not a second sweep: each row's note read is the
     very next Athena call after that row's own chart read, i.e. it happens
     while the identity-verified chart is still open. A tail-pass regression
     would push all three note reads after all three chart reads. */
  ok(offScoped.every((call, index) => call.seq === offH.chartCalls[index].seq + 1 &&
    call.patientId === offH.chartCalls[index].patientId),
    'the pulled-day note is no longer folded into its own row\'s open chart');
  /* dfc-1.1.0 provenance + typed per-row receipts: the day note came from the
     DIRECT bridge read, the scoped save is receipted with its exact scope and
     no-substitution proof, and the skipped historical walk is a typed
     not-requested receipt rather than an implied absence. */
  ok(off.patients.every(p => p.todayNoteDirectBridge === true),
    'a day-facts row lost the direct-bridge provenance of its pulled-day note');
  ok(off.patients.every(p => p.sameDayReceipt &&
    p.sameDayReceipt.kind === 'athena-same-day-note-v1' &&
    p.sameDayReceipt.status === 'saved' &&
    String(p.sameDayReceipt.scopeDate || '') === DAY &&
    p.sameDayReceipt.noSubstitution === true),
    'a day-facts row lost its saved same-day receipt (exact scope + no-substitution)');
  ok(off.patients.every(p => p.allHistoryReceipt &&
    p.allHistoryReceipt.requested === false &&
    p.allHistoryReceipt.status === 'not-requested'),
    'a day-facts row lost the typed not-requested all-history receipt');
  /* dfc-1.1.0 cost model: the direct scoped bridge read rides the row's
     ALREADY-OPEN chart, so the day-note leg costs ZERO additional chart
     opens and a day-facts row costs exactly ONE open total. (The old
     one-plus-one model was the vp transport's price.) */
  eq(Number((off.chartOpens && off.chartOpens.dayNote) || 0), 0,
    'the direct-bridge day-note leg opened charts it does not need');
  eq(Number((off.chartOpens && off.chartOpens.perRow) || 0), 1,
    'the day-facts row no longer costs exactly one chart open in total');
  eq(Number((off.chartOpens && off.chartOpens.total) || 0), 3,
    'the day-facts chart-open census stopped totalling the history and day-note opens');
  eq(Number(off.todayNoteRead || 0), offScoped.length,
    'the receipt day-note read count disagrees with the onlyDate reads actually made');
  eq(Number(off.todayNoteFailures || 0), 0,
    'day-facts mode painted a day-note failure it never attempted');
  /* the revoked "OFF is not requested" column is gone from the tally itself. */
  eq(Number(off.todayNoteNotRequested || 0), 0,
    'the day-facts column is again reported as "not requested" instead of tallied');
  ok(off.patients.every(p => p.todayNote === true),
    'a day-facts row finished without its pulled-day note verdict');
  /* dfc-1.1.0: the note lands on the FIRST transport - the direct bridge
     read (todayNoteDirectBridge, zero legacy-ladder attempts). A second
     attempt of any kind is the regression this pin guards. */
  ok(off.patients.every(p => p.todayNoteDirectBridge === true && Number(p.todayNoteAttempts || 0) === 0),
    'a day-facts row was re-opened for a second pulled-day note attempt (or lost its direct-bridge credit)');

  /* --- ON is the same floor PLUS the unscoped historical walk --- */
  const onH = boot(true);
  const on = await onH.api._runHistoryBatch(onH.rows, [], onH.onStatus);
  eq(on.visitNotesMode, 'full', 'the ON history receipt no longer reports full mode');
  eq(on.chartFactsRequired, true, 'the mandatory chart-facts floor is not required in ON mode');
  eq(on.allVisitBodiesRequested, true, 'ON did not request all visit bodies');
  eq(on.insuranceReason, 'reader-not-shipped',
    'ON reported an insurance verdict the reader cannot produce');
  eq(onH.chartCalls.length, 3, 'ON stopped opening the chart for every scheduled row');
  eq(onH.noteCalls.length, 3, 'ON did not walk the bodies once per scheduled patient');
  eq(onH.noteCalls.filter(call => !call.onlyDate).length, 3,
    'ON scoped its historical walk to one day instead of traversing every body');
  ok(on.patients.every(p => p.visitsSkipped !== true),
    'ON skipped the historical bodies it was explicitly asked to read');
  eq(on.complete, true, 'the ON batch did not finish every scheduled patient');
  /* ON gets the pulled day from the full traversal, so it must NOT also spend
     a second scoped open per row - and it may not label its column
     "not requested" either: after 1.0.1 that count belongs to one door only. */
  eq(onH.noteCalls.filter(call => String(call.onlyDate || '') === DAY).length, 0,
    'ON spent an extra exact-day open on top of the historical walk it already made');
  eq(Number((on.chartOpens && on.chartOpens.dayNote) || 0), 0,
    'ON accounted a separate day-note chart open on top of its historical walk');
  eq(Number(on.todayNoteNotRequested || 0), 0,
    'ON reported a "not requested" day-note column outside the blocked-unchosen door');
}

/* ===== dayfacts-1.0.1 runtime: a REFUSED pulled-day note stays honest =======
 * The day-note lanes now run in day-facts mode, so day-facts mode also owns
 * their FAILURES for the first time. This fixture drives the transient class
 * (a deferrable 'pull-in-flight' refusal on a row whose chart this very pull
 * opened) and pins the accounting that must hold in either direction.
 * ========================================================================== */
async function dayFactsDeferrableNoteIsAccountedHonestly() {
  const h = makeHarness({
    day: DAY, today: '2026-08-24', rows: 3,
    visitNotesOn: false, chartCoverage: true, parseResult: () => GOOD_CHART,
    noteResult: () => ({ ok: false, reason: 'pull-in-flight' })
  });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  /* the note was really attempted per row, and really refused - in BOTH lanes.
     dfc-1.1.0 MIGRATION (was: 3 scoped reads, all vp): the row's FIRST attempt
     is now the scoped AllVisits bridge read; on ANY direct-read failure (here
     the reader refuses ok:false 'pull-in-flight') the legacy vp ladder still
     runs exactly as before. A failing row therefore costs exactly TWO scoped
     attempts - the failed bridge read, then its own row's vp read, in that
     order, both inside the row's open chart - and never a third. */
  const bridgeAttempts = h.noteCalls.filter(call => call.transport === 'bridge');
  const vpAttempts = h.noteCalls.filter(call => call.transport !== 'bridge');
  eq(bridgeAttempts.length, 3,
    'the direct scoped bridge attempt stopped being made once per day-facts row');
  eq(vpAttempts.length, 3,
    'a refusing day-note reader stopped being asked once per day-facts row');
  eq(h.noteCalls.length, 6,
    'a failing day-facts row cost more than one bridge attempt plus one vp attempt');
  eq(h.noteCalls.filter(call => String(call.onlyDate || '') === DAY).length, h.noteCalls.length,
    'a refusal-fixture visit read escaped the exact pulled-day onlyDate scope');
  ok(bridgeAttempts.every((call, index) =>
    call.patientId === h.rows[index]._mlsTargetPatientId &&
    vpAttempts[index] && vpAttempts[index].patientId === call.patientId &&
    vpAttempts[index].seq === call.seq + 1),
    'a failed bridge attempt does not immediately precede its own row\'s legacy vp attempt');
  /* the bridge refusal is receipted per row, PHI-free, with its real reason */
  ok(receipt.patients.every(p => String(p.sameDayDirectReason || '') === 'pull-in-flight'),
    'a refused direct bridge read lost its per-row sameDayDirectReason evidence');
  eq(Number(receipt.todayNoteRead || 0), 0,
    'day-facts mode counted a refused pulled-day note as read');
  eq(Number(receipt.todayNoteFailures || 0), 3,
    'day-facts mode did not count the refused pulled-day notes as failures');
  eq(Number((receipt.todayNoteReasons || {})['pull-in-flight'] || 0), 3,
    'the day-note reason census lost the real refusal reason');
  /* the CHART work is untouched by a day-note refusal - the row still saved. */
  eq(receipt.patients.length, 3,
    'the refusal fixture receipt did not carry every scheduled row (its every() pins would be vacuous)');
  eq(receipt.complete, true, 'a refused pulled-day note failed the whole day-facts batch');
  eq(Number(receipt.failures || 0), 0, 'a refused pulled-day note was counted as a row failure');
  eq(h.saveCalls.length, 3, 'a refused pulled-day note suppressed the chart-facts save');
  /* the accounting identity: whatever is queued for the background round is
     not also reported as finally-unread. True before and after the fix below,
     so it can never be satisfied by hiding rows. */
  eq(Number(receipt.todayNoteUnreadFinal || 0),
    Number(receipt.todayNoteFailures || 0) - Number(receipt.todayNoteQueued || 0),
    'the day-note unread-final count does not reconcile with failures minus queued');
  /* every refused row carries the observable progress the retry may bet on. */
  ok(receipt.patients.every(p => p.dayNoteChartOpen === true &&
    p.todayNoteProgress === 'chart-open'),
    'a refused day-facts row lost the chart-open progress evidence');

  /* ===== TODO(dayfacts-1.0.1 ENGINE GAP - reported, deliberately NOT frozen)
     Delta item 3 claims "tnDeferRow and niSyncFromReceipt no longer refuse
     day-facts rows". They still do, and after 1.0.1 that makes the deferred
     day-note round UNREACHABLE rather than merely OFF-blind:
       1p-feat_mls_schedimport_exact.js:5873
         if (!entry || !day || sweepDepth || receipt.visitNotesRequested !== true) return false;
       1p-feat_mls_schedimport_exact.js:7064
         if (receipt.visitNotesRequested !== true) return 0;
     All three tnDeferRow call sites are inside OFF-only lanes (the inline
     fold-in :5685, the tail pass :6299, tnStampHandedOff :4598 - each guarded
     by pullVisitBodies !== true), so the one mode that can reach them is the
     one mode the guard rejects. niSyncFromReceipt is the only producer for the
     idle backfill queue, and it returns 0 for exactly those receipts - while
     niGate/niReadOnce were opened to settled OFF in this same release.
     MEASURED by this fixture: 3 deferrable failures, todayNoteQueued 0,
     todayNoteDeferred null on all three rows - stranded outside BOTH queues
     (the nih-1.0.0 class, this time by construction).
     The assertions that WOULD pin the contract:
        ok(receipt.patients.every(p => p.todayNoteDeferred === true), ...);
        eq(Number(receipt.todayNoteQueued || 0), 3, ...);
     They are left here rather than run, because pinning today's numbers
     (queued 0) would freeze the defect and pinning the contract would only
     restate this report in red. */
  ok(receipt.patients.every(p => p.todayNote === false),
    'a refused pulled-day note did not settle to a false verdict');
}

/* ===== dayfacts-1.0.0 runtime: UNSET is fail-closed ==========================
 * REPLACES nothing that existed - the revoked contract had no unchosen state
 * at this door - but it is the pin that stops the removed 'visit-notes-off'
 * no-op from being smuggled back in under a new name.
 * ========================================================================== */
async function unchosenPreferenceBlocksEveryRead() {
  const h = makeHarness({
    day: DAY, today: '2026-08-24', rows: 3,
    visitNotesOn: false,
    chartCoverage: true, parseResult: () => GOOD_CHART
  });
  /* the ONLY unsettled shape: first use, before the admission gate has asked */
  h.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: false, settled: false }),
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, on: null, reason: 'choice-unmade' }),
    write: () => true,
    isPrefKey: () => false
  };

  const blocked = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(blocked.reason, 'visit-notes-unchosen',
    'an unchosen preference did not return the blocked-unchosen refusal reason');
  ok(blocked.reason !== 'visit-notes-off',
    'the removed visit-notes-off schedule-only acceptance was reasserted for an unchosen account');
  eq(blocked.visitNotesMode, 'blocked-unchosen',
    'an unchosen preference did not report blocked-unchosen mode');
  eq(blocked.historyRequested, false,
    'an unchosen preference claimed history was requested');
  eq(blocked.requested, 0, 'an unchosen preference requested scheduled rows anyway');
  eq(blocked.processed, 0, 'an unchosen preference processed scheduled rows anyway');
  eq(blocked.failures, 0, 'the unchosen refusal was painted as a row failure');
  eq(blocked.notRequestedRows, 3, 'the unchosen refusal did not account every held row');
  eq(blocked.patients.length, 0, 'an unchosen preference produced patient rows');
  eq(blocked.retry.length, 0, 'an unchosen preference queued rows for retry');
  /* dayfacts-1.0.1: this door is now the ONLY producer of a "not requested"
     day-note column - tnAggregate zeroes it for every settled mode - so the
     count has to be here, and it has to be every held row. */
  eq(Number(blocked.todayNoteNotRequested || 0), 3,
    'the blocked-unchosen door stopped accounting every held row as day-note not-requested');
  eq(Number(blocked.todayNoteRead || 0), 0, 'a blocked receipt claimed a day-note read');
  eq(Number(blocked.todayNoteFailures || 0), 0,
    'the unchosen refusal was painted as a day-note failure');

  /* ZERO reads of any kind - chart, parse, save, or body. */
  eq(h.chartCalls.length, 0, 'an unchosen preference opened a patient chart');
  eq(h.parseCalls.length, 0, 'an unchosen preference parsed a chart');
  eq(h.saveCalls.length, 0, 'an unchosen preference saved chart facts');
  eq(h.noteCalls.length, 0, 'an unchosen preference read an encounter body');
  eq(h.gotoCalls.length, 0, 'an unchosen preference navigated athenaOne');
}

/* ===== dayfacts-1.0.0 runtime through the whole pull() ======================
 * REPLACES the old fullNotesModeBoundary(). The old pair pinned
 * chartCalls===0 + historyReceipt.reason==='full-notes-off' for OFF; both were
 * revoked. The ON half of that pair - the unscoped managed schedule-batch
 * walker, once per scheduled patient - is kept verbatim.
 * ========================================================================== */
async function visitNotesModeBoundaryThroughPull() {
  async function run(pullVisitBodies) {
    const h = makeMonthHarness({ today: '2026-08-24' });
    h.seedDay(DAY, 2);
    const result = await h.api.pull({
      date: DAY, provider: h.provider, includeHistory: true,
      pullVisitBodies, onStatus: h.onStatus
    });
    return {
      h, result,
      unscopedHistoryWalks: h.posted.filter(message =>
        message.type === 'mlsAppReadAllVisits' && !(message.hint && message.hint.onlyDate))
    };
  }

  const off = await run(false);
  /* FLIPPED (was `eq(..., 0, 'Full Notes OFF opened a patient chart ...')`):
     the checkbox no longer decides whether charts open. */
  eq(off.h.chartCalls.length, 2,
    'day-facts mode stopped opening the exact scheduled charts through pull()');
  /* KEPT: the still-true half of the old boundary. */
  eq(off.unscopedHistoryWalks.length, 0,
    'day-facts mode invoked the unscoped historical encounter-body walker');
  /* FLIPPED (was `reason === 'full-notes-off'`): OFF is no longer a skip. */
  eq(off.result.historyReceipt.visitNotesMode, 'day-facts',
    'the OFF pull did not record its history stage as day-facts mode');
  ok(off.result.historyReceipt.skipped !== true,
    'the OFF pull recorded the history stage as intentionally skipped');
  eq(off.result.historyReceipt.requested, 2,
    'the OFF pull did not hand every scheduled row to the day-facts batch');
  eq(off.result.historyReceipt.chartFactsRequired, true,
    'the OFF pull dropped the mandatory chart-facts floor');
  eq(off.result.historyReceipt.allVisitBodiesRequested, false,
    'the OFF pull requested all visit bodies');
  /* KEPT verbatim from the old boundary. */
  eq(off.result.historyReceipt.visitNotesRequested, false,
    'the OFF pull did not carry the frozen choice into the history receipt');
  eq(off.result.historyReceipt.failures, 0,
    'the day-facts intentional body skip was counted as incomplete');
  eq(off.result.complete, true, 'a clean day-facts pull did not report itself complete');
  /* dayfacts-1.0.1 through the WHOLE public pull(), not only the batch seam:
     every scheduled row gets exactly one exact-day encounter-note attempt and
     the envelope reports it. This is the pin round 1 could not make. */
  const offDayNotes = off.h.noteCalls.filter(note => String(note.onlyDate || '') === DAY);
  eq(offDayNotes.length, 2,
    'the OFF pull did not attempt the pulled-day encounter note for every scheduled row');
  eq(offDayNotes.length, off.h.noteCalls.length,
    'the OFF pull made a visit read outside the exact pulled-day scope');
  eq(Number(off.result.historyReceipt.todayNoteRead || 0), 2,
    'the OFF pull envelope does not report the pulled-day notes it read');
  eq(Number(off.result.historyReceipt.todayNoteFailures || 0), 0,
    'the OFF pull painted a pulled-day note failure it never hit');
  eq(Number(off.result.historyReceipt.todayNoteNotRequested || 0), 0,
    'the OFF pull envelope again calls its day-note column "not requested"');
  eq(Number((off.result.historyReceipt.chartOpens || {}).dayNote || 0), 0,
    'the direct-bridge day-note leg cost the envelope chart opens it does not need');
  eq(off.result.visitNotesMode, 'day-facts',
    'the OFF pull RESULT envelope does not use the one day-facts vocabulary');

  /* No user-facing line may claim OFF opens no charts (owner contract). */
  const denials = off.h.statusLines.filter(line =>
    /no patient charts/i.test(line) ||
    /charts?[^.]{0,80}(?:were|was)\s+not\s+opened/i.test(line) ||
    /schedule-only/i.test(line));
  eq(denials.length, 0,
    'a day-facts status line still tells the doctor no charts were opened: ' + JSON.stringify(denials));

  const on = await run(true);
  eq(on.h.chartCalls.length, 2,
    'Full Notes ON stopped reading the upcoming scheduled charts');
  eq(on.unscopedHistoryWalks.length, 2,
    'Full Notes ON did not invoke the unscoped body walker once per scheduled patient');
  ok(on.unscopedHistoryWalks.every(message => message.managed === true &&
    message.initiator === 'schedule-batch'),
    'Full Notes ON left the managed schedule-batch reader lane');
  eq(on.result.historyReceipt.visitNotesMode, 'full',
    'the ON pull did not record its history stage as full mode');
  eq(on.result.historyReceipt.allVisitBodiesRequested, true,
    'the ON pull did not request all visit bodies');
  eq(on.h.noteCalls.filter(note => String(note.onlyDate || '') === DAY).length, 0,
    'the ON pull spent an extra exact-day open on top of the historical walk');
  eq(on.result.visitNotesMode, 'full',
    'the ON pull RESULT envelope does not use the one full-mode vocabulary');
}

async function main() {
  sourceContracts();
  dayFactsSourceContract();
  await connectAdmitsExactlyTheDayScopedRead();
  await successfulBulkKeeps3064Trace();
  await retryPreservesBindingAndDiagnostic();
  await dayFactsBatchIsTheMandatoryFloor();
  await dayFactsDeferrableNoteIsAccountedHonestly();
  await unchosenPreferenceBlocksEveryRead();
  await visitNotesModeBoundaryThroughPull();
  await flush(3);
  console.log('PASS pull-3064-fast-path-golden-contract: ' + checks +
    ' checks - exact commit 2165bc2 proves the 3.0.64 one-read trace; dfc-1.1.0 (owner DAY contract, 2026-08-25) pins day-facts OFF as the mandatory chart-facts floor: one identity-verified chart open plus exactly ONE scoped AllVisits BRIDGE read per row (hint.onlyDate = the pulled day, transport proven, folded into that row\'s own open chart), saving exactly the pulled day\'s OWN visit body through the additive scoped save (one visit per row, dated the pulled day, typed sameDayReceipt / not-requested allHistoryReceipt, NO historical bodies); on direct-read success the legacy vp ladder stays silent, on a refused direct read the row costs exactly one failed bridge attempt then its own vp attempt with the refusal receipted per row; receipt census agrees with the reads made; ON is that floor plus the unscoped managed walk and no extra scoped open; an unchosen preference is the only zero-read blocked receipt and the only "not requested" day-note column; the three includeHistory doors (day, month, Calendar) are decoupled from the checkbox and one day-facts vocabulary spans every envelope; approved cold/key/retry/diagnostic/queued repairs remain. ENGINE GAPS reported, not frozen: the deferred day-note round is unreachable (importer 5873 tnDeferRow / 7064 niSyncFromReceipt vs the OFF-only call sites 4598/5685/6299), and the persisted day-pull terminal receipt still says "not requested" / "intentionally skipped" (1p-mls-connect.js 49570/49602).');
}

const watchdog = setTimeout(() => {
  console.error(new Error('pull-3064-fast-path-golden-contract did not finish'));
  process.exit(1);
}, 90000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});

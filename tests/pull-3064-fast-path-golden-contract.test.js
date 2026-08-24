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
 * The final runtime pair proves the MAIN historical-stage boundary: Full Notes
 * OFF is schedule/booking-only and makes zero patient-chart or encounter-body
 * reads; Full Notes ON still invokes the unscoped walker. Synthetic identities
 * only.
 * ============================================================================= */

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
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
     a failed row belongs outside this ordinary call, never in every row. */
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
  ok(stableKeys.includes('var bodyComplete = failures.length === 0 && visits.length === clinicalTotal && stableKeysComplete;'),
    'body completeness no longer independently requires every clinical body');

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

async function fullNotesModeBoundary() {
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
  eq(off.h.chartCalls.length, 0,
    'Full Notes OFF opened a patient chart instead of staying schedule-only');
  eq(off.unscopedHistoryWalks.length, 0,
    'Full Notes OFF invoked the unscoped historical encounter-body walker');
  eq(off.result.historyReceipt.reason, 'full-notes-off',
    'Full Notes OFF did not record the history stage as intentionally skipped');
  eq(off.result.historyReceipt.visitNotesRequested, false,
    'Full Notes OFF did not carry the frozen choice into the history receipt');
  eq(off.result.historyReceipt.failures, 0,
    'Full Notes OFF intentional skip was counted as incomplete');

  const on = await run(true);
  eq(on.h.chartCalls.length, 2,
    'Full Notes ON stopped reading the upcoming scheduled charts');
  eq(on.unscopedHistoryWalks.length, 2,
    'Full Notes ON did not invoke the unscoped body walker once per scheduled patient');
  ok(on.unscopedHistoryWalks.every(message => message.managed === true &&
    message.initiator === 'schedule-batch'),
    'Full Notes ON left the managed schedule-batch reader lane');
}

async function main() {
  sourceContracts();
  await successfulBulkKeeps3064Trace();
  await retryPreservesBindingAndDiagnostic();
  await fullNotesModeBoundary();
  await flush(3);
  console.log('PASS pull-3064-fast-path-golden-contract: ' + checks +
    ' checks - exact commit 2165bc2 proves the 3.0.64 one-read trace, schedule-only OFF, and unscoped ON history boundary; approved cold/key/retry/diagnostic/queued repairs remain');
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

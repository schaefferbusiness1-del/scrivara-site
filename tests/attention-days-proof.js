'use strict';

/* attn-1.0.0 - NEEDS-ATTENTION MUST MEAN "THE OWNER HAS TO ACT", MEASURED ON
 * THE AUGUST MONTH PULL FOR ONE PA AND PINNED HERE BY EXECUTING THE SHIPPED
 * SLICES. Plain node: no Athena account, no backend, no browser, no PHI.
 *
 * THE LIVE STATE (2026-09-02 03:3x, extension 3.0.107, three Retry passes):
 * 25 days complete, 2 cycling 'retry' (2026-08-28, 2026-08-30, reason
 * provider-not-on-calendar) and 4 in needs-attention - 2026-08-05
 * calendar-partial, 2026-08-06 nav-failed, 2026-08-12 and 2026-08-27
 * history-partial. The owner's bar is needs-attention = 0 AND a receipt that
 * tells the truth.
 *
 * (R0) THE WEDGE. scopeempty-1.0.0 (b1195) DID promote the two scoped-empty
 *      days - and processMonthResult's final-retry reconciliation demoted them
 *      again on the same pass. The importer counts a provider-not-on-calendar
 *      day as a failure, so it rides in result.retry.dates; that loop skipped
 *      only days the walk left NOT complete, so a day the JOB had deliberately
 *      completed fell through and was re-checkpointed with the month's own
 *      reason. Neither checkpoint spent an attempt, so the cap could never
 *      settle it: retry -> complete -> retry, for ever. The loop exists for a
 *      failed month-owner RELEASE proof, so it is now gated on that proof.
 *
 * (R1) A day whose stored verdict is already the scoped-empty code settles
 *      complete/empty with NO second read of athena, and the evidence (how
 *      many other clinicians the calendar painted) rides on the day record.
 *
 * (R2) A PER-CHART REFUSAL IS NOT A DAY FAILURE. 2026-08-12 refused ONE chart
 *      because its DOB did not match the schedule row. That refusal must
 *      STAND - it is the wrong-patient gate working - and the DAY must finish,
 *      naming it. Never attention.
 *
 * (R3) 'history-partial' is attention ONLY when NO chart of the day could be
 *      read. A day that read charts and then spent its attempts is finished
 *      with what it could not read recorded.
 *
 * (R4) 'calendar-partial' STAYS attention: athena showed rows the day never
 *      accounted for and only the owner can look. The day now records HOW MANY
 *      and the card says it beside the date, next to the Resume that re-pulls.
 *
 * (R5) 'nav-failed' is unchanged and pinned: a driven day, one attempt per
 *      pass, attention only at DAY_ATTEMPT_CAP.
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const RANGE = fs.readFileSync('1p-feat_mls_rangejobs.js', 'utf8');
const IMPORTER = fs.readFileSync('1p-feat_mls_schedimport_exact.js', 'utf8');

let checks = 0;
function ok(cond, message) { checks++; assert.ok(cond, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }

/* ---- the day-note-proof / scoped-pull-keeps-others-proof brace walker ------
   Comments are recognised BEFORE quotes: every block in these files is
   documented in prose full of apostrophes, and opening quote-mode inside a
   comment desyncs the walker and truncates the slice. */
function balanced(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'slice not found: ' + (label || signature));
  let depth = 0, quote = '', i = source.indexOf('{', start);
  assert(i > start, 'slice has no body: ' + (label || signature));
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1];
    if (quote) { if (ch === quote && prev !== '\\') quote = ''; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated slice: ' + (label || signature));
}
function statement(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'statement not found: ' + (label || signature));
  const end = source.indexOf('\n', start);
  return source.slice(start, end < 0 ? source.length : end);
}

/* =======================================================================
 * THE DURABLE JOB. The real checkpointDay / processMonthResult /
 * summarize / uiReceiptCopy / uiAttentionCopy, executed.
 * ===================================================================== */
function rangeContext() {
  const slices = [
    statement(RANGE, 'var DAY_ATTEMPT_CAP =', 'DAY_ATTEMPT_CAP'),
    statement(RANGE, 'var MANIFEST_VERSION =', 'MANIFEST_VERSION'),
    statement(RANGE, 'var MAX_IDENTITY =', 'MAX_IDENTITY'),
    statement(RANGE, 'var VERSION =', 'VERSION'),
    balanced(RANGE, 'var JOB_STATUS = {', 'JOB_STATUS') + ';',
    balanced(RANGE, 'var MONTH_STATUS = {', 'MONTH_STATUS') + ';',
    balanced(RANGE, 'var DAY_STATUS = {', 'DAY_STATUS') + ';',
    balanced(RANGE, 'var REASONS = {', 'REASONS') + ';',
    balanced(RANGE, 'var EMPTY_REASONS = {', 'EMPTY_REASONS') + ';',
    statement(RANGE, 'var SCOPED_EMPTY_REASON =', 'SCOPED_EMPTY_REASON'),
    balanced(RANGE, 'function providerScopedJob(manifest)', 'providerScopedJob'),
    balanced(RANGE, 'var CHART_REFUSAL_CODES = {', 'CHART_REFUSAL_CODES') + ';',
    balanced(RANGE, 'var GENERIC_MONTH_REASONS = {', 'GENERIC_MONTH_REASONS') + ';',
    balanced(RANGE, 'function boundedCount(value, max)', 'boundedCount'),
    balanced(RANGE, 'function sanitizeRefusalCodes(raw)', 'sanitizeRefusalCodes'),
    balanced(RANGE, 'var LOGIN_REASONS = {', 'LOGIN_REASONS') + ';',
    balanced(RANGE, 'var SIGNOUT_CANDIDATE_REASONS = {', 'SIGNOUT_CANDIDATE_REASONS') + ';',
    balanced(RANGE, 'var STORAGE_REASONS = {', 'STORAGE_REASONS') + ';',
    balanced(RANGE, 'var NON_ATTEMPT_REASONS = {', 'NON_ATTEMPT_REASONS') + ';',
    balanced(RANGE, 'function reasonCode(value)', 'reasonCode'),
    balanced(RANGE, 'function isLoginReason(value)', 'isLoginReason'),
    balanced(RANGE, 'function isStorageReason(value)', 'isStorageReason'),
    balanced(RANGE, 'function own(obj, key)', 'own'),
    balanced(RANGE, 'function now()', 'now'),
    balanced(RANGE, 'function copy(value)', 'copy'),
    balanced(RANGE, 'function cleanText(value, max)', 'cleanText'),
    balanced(RANGE, 'function finiteStamp(value)', 'finiteStamp'),
    balanced(RANGE, 'function monthComplete(month)', 'monthComplete'),
    /* navhome-1.0.0 (2026-09-02): the closed athenaOne-surface vocabulary the
       day record, the summary row and the card copy all read. */
    balanced(RANGE, 'var NAV_SURFACE_CODES = {', 'NAV_SURFACE_CODES') + ';',
    balanced(RANGE, 'function navSurfaceShape(raw)', 'navSurfaceShape'),
    balanced(RANGE, 'var NAV_SURFACE_REASONS = {', 'NAV_SURFACE_REASONS') + ';',
    balanced(RANGE, 'var NAV_SURFACE_COPY = {', 'NAV_SURFACE_COPY') + ';',
    balanced(RANGE, 'function summarize(manifest)', 'summarize'),
    balanced(RANGE, 'function sanitizeRun(raw)', 'sanitizeRun'),
    balanced(RANGE, 'function checkpointDay(ctx, monthKey, payload, seen)', 'checkpointDay'),
    balanced(RANGE, 'function monthOwnerUnproven(result)', 'monthOwnerUnproven'),
    balanced(RANGE, 'function processMonthResult(ctx, monthKey, dates, result, seen)', 'processMonthResult'),
    balanced(RANGE, 'function uiReceiptCopy(manifest)', 'uiReceiptCopy'),
    balanced(RANGE, 'var UI_REFUSAL_COPY = {', 'UI_REFUSAL_COPY') + ';',
    balanced(RANGE, 'function uiRefusedCopy(manifest)', 'uiRefusedCopy'),
    balanced(RANGE, 'function uiAttentionCopy(manifest)', 'uiAttentionCopy')
  ].join('\n');
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp, isFinite,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    accountGuard() { return true; },
    persistContext() { return true; },
    stopImporter() {},
    currentExtVersion() { return '3.0.107'; },
    /* attnscope-1.0.0: checkpointDay now stamps the app build that spent the
       attempt beside the extension version, so the lifted slice needs the
       same stub. An opaque build token, never PHI. */
    currentAppBuild() { return 'attn-proof-build'; }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'attn-range-slices.js' });
  return { ctx, sandbox };
}

const RANGE_CTX = rangeContext();
function job(days, mode) {
  return {
    control: '', storageFailure: '',
    manifest: {
      status: 'running',
      provider: mode === 'all' ? { mode: 'all' } : { mode: 'selected', id: 'p-uyen', stableKey: 'uyen|phan' },
      run: { startedAt: 1, skippedComplete: 0, plannedDays: Object.keys(days).length },
      months: { '2026-08': { status: 'running', days: days } }
    }
  };
}
function daysOf(list) {
  const out = {};
  for (const date of list) out[date] = { status: 'retry', attempts: 0, reason: '' };
  return out;
}
function dayOf(ctx, date) { return ctx.manifest.months['2026-08'].days[date]; }
function checkpoint(ctx, payload, seen) {
  RANGE_CTX.sandbox.__c = ctx; RANGE_CTX.sandbox.__p = payload; RANGE_CTX.sandbox.__seen = seen || {};
  return vm.runInContext('checkpointDay(__c, "2026-08", __p, __seen)', RANGE_CTX.ctx);
}
function settle(ctx, dates, result, seen) {
  RANGE_CTX.sandbox.__c = ctx; RANGE_CTX.sandbox.__d = dates;
  RANGE_CTX.sandbox.__r = result; RANGE_CTX.sandbox.__seen = seen;
  return vm.runInContext('processMonthResult(__c, "2026-08", __d, __r, __seen)', RANGE_CTX.ctx);
}
function summary(manifest) {
  RANGE_CTX.sandbox.__m = manifest;
  return vm.runInContext('summarize(__m)', RANGE_CTX.ctx);
}
function receiptCopy(manifest) {
  RANGE_CTX.sandbox.__m = manifest; RANGE_CTX.sandbox.__m.summary = summary(manifest);
  return vm.runInContext('uiReceiptCopy(__m)', RANGE_CTX.ctx);
}
function attentionCopy(manifest) {
  RANGE_CTX.sandbox.__m = manifest; RANGE_CTX.sandbox.__m.summary = summary(manifest);
  return vm.runInContext('uiAttentionCopy(__m)', RANGE_CTX.ctx);
}

/* =======================================================================
 * THE IMPORTER'S RECEIPT BUILDERS. The real p1MonthDayCheckpoint and the
 * three attn-1.0.0 measurements, executed on receipt shapes the importer
 * actually produces.
 * ===================================================================== */
function importerContext() {
  const slices = [
    statement(IMPORTER, 'var AUTOMATIC_HISTORY_RETRY_REASON =', 'AUTOMATIC_HISTORY_RETRY_REASON'),
    balanced(IMPORTER, 'var P1_CHART_REFUSAL_CODES = {', 'P1_CHART_REFUSAL_CODES') + ';',
    balanced(IMPORTER, 'function p1ChartRefusalCode(raw)', 'p1ChartRefusalCode'),
    balanced(IMPORTER, 'function p1MonthDayCharts(receipt)', 'p1MonthDayCharts'),
    balanced(IMPORTER, 'function p1MonthDayCalendarMissing(receipt)', 'p1MonthDayCalendarMissing'),
    balanced(IMPORTER, 'function p1MonthDaySurfaceProviders(receipt)', 'p1MonthDaySurfaceProviders'),
    balanced(IMPORTER, 'function p1MonthDaySignedOut(receipt)', 'p1MonthDaySignedOut'),
    balanced(IMPORTER, 'function p1MonthDayNotesPending(receipt)', 'p1MonthDayNotesPending'),
    /* navhome-1.0.0 (2026-09-02): the thirteenth checkpoint member's builder. */
    balanced(IMPORTER, 'function p1MonthDayNavSurface(receipt)', 'p1MonthDayNavSurface'),
    balanced(IMPORTER, 'function p1MonthDayCheckpoint(callback, date, outcome)', 'p1MonthDayCheckpoint')
  ].join('\n');
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    isFn(f) { return typeof f === 'function'; }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'attn-importer-slices.js' });
  return { ctx, sandbox };
}
const IMP = importerContext();
function importerCheckpoint(date, outcome) {
  IMP.sandbox.__date = date; IMP.sandbox.__o = outcome;
  return vm.runInContext('p1MonthDayCheckpoint(null, __date, __o)', IMP.ctx);
}

/* =======================================================================
 * (1) THE IMPORTER SEAM. Counts and CLOSED codes, never PHI.
 * ===================================================================== */
function proveTheSeamMeasures() {
  const refusal = code => { IMP.sandbox.__raw = code; return vm.runInContext('p1ChartRefusalCode(__raw)', IMP.ctx); };
  eq(refusal('dob-mismatch'), 'dob-mismatch', 'the DOB refusal - the 2026-08-12 case - is not classified as a refusal at all');
  eq(refusal('ambiguous'), 'ambiguous', 'two charts answering to one identity is not classified as a refusal');
  eq(refusal('chart parse timed out after 90000ms'), 'chart-parse-timeout',
    'a spent chart parse was not classified as a parse timeout');
  eq(refusal('same-frame-name-mismatch'), '',
    'a MULTI-TAB artifact the importer re-reads by itself was mis-filed as a refusal that ends the day');
  eq(refusal('chart-read-deadline-exceeded'), '',
    'a transport deadline in the importer\'s own automatic-retry vocabulary was mis-filed as a refusal');
  eq(refusal('identity-not-proven'), '',
    'a retryable identity read was mis-filed as a refusal - the importer retries that one itself');
  eq(refusal(''), '', 'an absent per-chart reason invented a refusal');

  /* THE LIVE 2026-08-12 SHAPE: eleven charts read, one refused on DOB. */
  const day0812 = {
    ok: false, complete: false, reason: 'history-partial', receipt: {
    historyReceipt: {
      complete: false, reason: 'history-partial',
      storeCensus: { measured: true, targets: 12, withContent: 11 },
      patients: [
        ...Array.from({ length: 11 }, (_, i) => ({ complete: true, reason: '', name: 'Read ' + i })),
        { complete: false, reason: 'dob-mismatch', name: 'Refused One' }
      ]
    },
    calendarReceipt: { complete: true, attempted: 12, accounted: 12 }
  } };
  const cp = importerCheckpoint('2026-08-12', day0812);
  eq(cp.chartsRead, 11, 'the seam cannot say how many charts of the day landed with content');
  eq(cp.chartsUnread, 1, 'the seam cannot say how many charts of the day did not land');
  eq(cp.chartsRefused, 1, 'the DOB refusal did not cross the seam as a refusal');
  eq(JSON.stringify(cp.chartsRefusedCodes), '{"dob-mismatch":1}', 'the refusal cause did not cross the seam as a bounded code');
  eq(cp.calendarMissing, 0, 'a fully accounted calendar reported missing rows');
  /* navhome-1.0.0 (2026-09-02): the thirteenth member is navSurface, the
     closed code naming WHICH athenaOne surface a nav refusal died on. The pin
     is re-aimed here deliberately; its closed-value law and the day card it
     feeds are proved in tests/nav-home-proof.js. */
  eq(JSON.stringify(Object.keys(cp).sort()),
    JSON.stringify(['calendarMissing', 'chartsRead', 'chartsRefused', 'chartsRefusedCodes', 'chartsUnread',
      'complete', 'date', 'dayNotesPending', 'navSurface', 'ok', 'reason', 'sessionExpired', 'surfaceProviders']),
    'the PHI-free checkpoint grew a field that is not a count, a date or a bounded code');
  const serialized = JSON.stringify(cp);
  ok(serialized.indexOf('Refused One') < 0 && serialized.indexOf('Read 0') < 0,
    'a patient name crossed the PHI-free checkpoint seam');

  /* THE LIVE 2026-08-05 SHAPE: athena showed 14 rows, 11 were accounted. */
  const day0805 = {
    ok: false, complete: false, reason: 'calendar-partial', receipt: {
      calendarReceipt: { complete: false, attempted: 14, accounted: 11, failed: 3 },
      historyReceipt: { patients: [] }
    }
  };
  eq(importerCheckpoint('2026-08-05', day0805).calendarMissing, 3,
    'a calendar-partial day cannot say how many appointments athena showed that it never saved');

  /* THE LIVE 2026-08-28 SHAPE: the calendar rendered OTHER clinicians. */
  const day0828 = {
    ok: false, complete: false, reason: 'provider-not-on-calendar', receipt: {
      providerReceipt: { reason: 'provider-not-on-calendar', surfaceProviders: ['A', 'B', 'C', 'D'], discoveredProviders: ['A', 'B', 'C', 'D'] }
    }
  };
  eq(importerCheckpoint('2026-08-28', day0828).surfaceProviders, 4,
    'the evidence provscope-1.0.0 refuses on - other clinicians painted on that calendar - never reached the durable job');
  console.log('  1. the checkpoint seam carries the day\'s chart census, its unaccounted rows and its painted clinicians - counts and closed codes only');
}

/* =======================================================================
 * (2) R0 - THE WEDGE. A day THIS run completed survives the month result.
 * ===================================================================== */
function proveTheReconciliationWedge() {
  const scopedStamp = date => ({
    date: date, ok: false, complete: false, reason: 'provider-not-on-calendar',
    sessionExpired: false, dayNotesPending: 0, chartsRead: 0, chartsUnread: 0,
    chartsRefused: 0, chartsRefusedCodes: {}, calendarMissing: 0, surfaceProviders: 4
  });
  const dates = ['2026-08-28', '2026-08-30'];
  const ctx = job(daysOf(dates), 'selected');
  const seen = {}, rows = [];
  for (const date of dates) {
    const stamp = scopedStamp(date);
    checkpoint(ctx, stamp, seen);
    rows.push({ date: date, ok: false, complete: false, reason: 'provider-not-on-calendar', receipt: {}, checkpoint: stamp });
  }
  eq(dayOf(ctx, '2026-08-28').status, 'complete', 'the per-day callback no longer promotes the scoped-empty day at all');

  /* The importer counts BOTH of these as failures, so both ride in
     retry.dates - the exact shape that demoted them on every pass. */
  settle(ctx, dates, {
    ok: false, complete: false, reason: 'month-partial', days: rows, retry: { dates: dates.slice() }
  }, seen);
  eq(dayOf(ctx, '2026-08-28').status, 'complete', '2026-08-28 was demoted back to retry by the month reconciliation - the cycling defect');
  eq(dayOf(ctx, '2026-08-30').status, 'complete', '2026-08-30 was demoted back to retry by the month reconciliation - the cycling defect');
  eq(dayOf(ctx, '2026-08-28').reason, 'provider-not-on-calendar', 'the reconciliation overwrote the day\'s own verdict with the month\'s');
  eq(dayOf(ctx, '2026-08-28').attempts, 0, 'an honest empty day burned a retry attempt');
  const tiles = summary(ctx.manifest);
  eq(tiles.needsAttention, 0, 'a provider-not-on-calendar day is still counted as needing attention');
  eq(tiles.failed, 0, 'the two scoped-empty days are still counted as days left to retry');
  eq(tiles.empty, 2, 'the two scoped-empty days were not counted as verified empty');

  /* THE GUARD THAT MUST NOT WEAKEN: a REAL failed month-owner release proof
     still demotes the last day, exactly as testFinalMonthProofCanDemoteLastDay
     pins it. */
  const proofDates = ['2026-08-24', '2026-08-25'];
  const proofFailed = job(daysOf(proofDates), 'all');
  const seen2 = {}, rows2 = [];
  for (const date of proofDates) {
    const stamp = { date: date, ok: true, complete: true, reason: 'complete' };
    checkpoint(proofFailed, stamp, seen2);
    rows2.push({ date: date, ok: true, complete: true, reason: 'complete', receipt: {}, checkpoint: stamp });
  }
  settle(proofFailed, proofDates, {
    ok: false, complete: false, reason: 'month-owner-unverified', days: rows2,
    monthOwnerReceipt: { complete: false, reason: 'month-owner-unverified', ownerLost: true },
    retry: { dates: ['2026-08-25'] }
  }, seen2);
  eq(dayOf(proofFailed, '2026-08-25').status, 'retry',
    'a FAILED month-owner release proof stopped demoting its affected day - the durability guard was weakened, not narrowed');
  eq(dayOf(proofFailed, '2026-08-25').reason, 'month-owner-unverified', 'the ownership failure lost its bounded reason');
  eq(dayOf(proofFailed, '2026-08-24').status, 'complete', 'a day the owner proof never named was demoted with it');

  const unproven = r => { RANGE_CTX.sandbox.__r = r; return vm.runInContext('monthOwnerUnproven(__r)', RANGE_CTX.ctx); };
  eq(unproven({ reason: 'month-partial' }), false, 'an ordinary partial month was treated as an unproven owner');
  eq(unproven({ reason: 'month-stopped-systemic' }), false, 'a systemic stop was treated as an unproven owner');
  eq(unproven({ reason: 'month-owner-unverified' }), true, 'an unverified month owner was treated as proven');
  eq(unproven({ reason: 'month-exception' }), true, 'a month that threw after its days was treated as proven');
  eq(unproven({ reason: 'complete', monthOwnerReceipt: { complete: false } }), true,
    'a month whose OWN receipt says the owner is unproven was treated as proven');
  eq(unproven(null), true, 'a missing month result was treated as proof of ownership');
  console.log('  2. a day this run completed survives the month reconciliation; a FAILED owner-release proof still demotes its day');
}

/* =======================================================================
 * (3) R1 - the scoped-empty day settles with no second read of athena.
 * ===================================================================== */
function proveScopedEmptyNeedsNoReRead() {
  const ctx = job(daysOf(['2026-08-28']), 'selected');
  checkpoint(ctx, {
    date: '2026-08-28', ok: false, complete: false, reason: 'provider-not-on-calendar', surfaceProviders: 4
  }, {});
  eq(dayOf(ctx, '2026-08-28').scopedEmpty, 1, 'the scoped-empty verdict was not recorded on the day');
  eq(dayOf(ctx, '2026-08-28').surfaceProviders, 4, 'the day did not keep how many other clinicians its calendar painted');

  /* THE NEXT CHECKPOINT, with NO new read: a MONTH-level code arrives and the
     day settles on the evidence it already holds. */
  dayOf(ctx, '2026-08-28').status = 'retry';
  checkpoint(ctx, { date: '2026-08-28', ok: false, complete: false, reason: 'month-partial' }, {});
  eq(dayOf(ctx, '2026-08-28').status, 'complete', 'a day already proved empty for this provider did not settle on its own stored evidence');
  eq(dayOf(ctx, '2026-08-28').reason, 'provider-not-on-calendar', 'the settled day took the month\'s generic reason instead of its own verdict');
  eq(dayOf(ctx, '2026-08-28').attempts, 0, 'settling on stored evidence spent an athena attempt');

  /* IT IS NOT A BLANKET AMNESTY: a day-level READ failure still stands. */
  const later = job(daysOf(['2026-08-28']), 'selected');
  checkpoint(later, { date: '2026-08-28', ok: false, complete: false, reason: 'provider-not-on-calendar', surfaceProviders: 4 }, {});
  later.manifest.months['2026-08'].days['2026-08-28'].status = 'retry';
  checkpoint(later, { date: '2026-08-28', ok: false, complete: false, reason: 'nav-failed' }, {});
  eq(dayOf(later, '2026-08-28').status, 'retry', 'stored scoped-empty evidence swallowed a later navigation failure');
  eq(dayOf(later, '2026-08-28').reason, 'nav-failed', 'a later navigation failure lost its own cause to the stored verdict');

  /* AN ALL-PROVIDER JOB never gets it: it cannot be honestly absent from its
     own calendar. */
  const allJob = job(daysOf(['2026-08-28']), 'all');
  checkpoint(allJob, { date: '2026-08-28', ok: false, complete: false, reason: 'provider-not-on-calendar', surfaceProviders: 4 }, {});
  eq(dayOf(allJob, '2026-08-28').status, 'retry', 'an all-provider job silently completed a day it could not read');
  eq(dayOf(allJob, '2026-08-28').scopedEmpty, undefined, 'an all-provider job recorded a scoped-empty verdict it can never earn');

  /* THE SAME RULING IS ENFORCED ON READ, like the attempt cap: a manifest
     stored by an older build settles with no pull at all. */
  ok(/if \(dayStatus !== 'complete' && provider\.mode === 'selected' && dayReason === SCOPED_EMPTY_REASON\) dayStatus = 'complete';/.test(RANGE),
    'a stored provider-not-on-calendar day is not settled on READ, so a manifest written before this build still needs a re-read');
  console.log('  3. a scoped-empty day settles complete/empty on stored evidence with no second read; a later nav failure still stands');
}

/* =======================================================================
 * (4) R2/R3 - per-chart refusals finish the day; history-partial is
 * attention ONLY when nothing at all could be read.
 * ===================================================================== */
function proveChartRefusalsFinishTheDay() {
  /* R2. THE LIVE 2026-08-12 CASE: eleven charts read, one refused on DOB. */
  const refused = job(daysOf(['2026-08-12']), 'selected');
  checkpoint(refused, {
    date: '2026-08-12', ok: false, complete: false, reason: 'history-partial',
    chartsRead: 11, chartsUnread: 1, chartsRefused: 1, chartsRefusedCodes: { 'dob-mismatch': 1 }
  }, {});
  eq(dayOf(refused, '2026-08-12').status, 'complete',
    'a day whose only unread chart was an honest identity refusal is still held in the pull, so it can only end in attention');
  eq(dayOf(refused, '2026-08-12').chartsRefused, 1, 'the finished day does not record that a chart was refused');
  eq(dayOf(refused, '2026-08-12').chartsUnread, 1, 'the finished day does not record how many charts it could not read');
  eq(JSON.stringify(dayOf(refused, '2026-08-12').refused), '{"dob-mismatch":1}', 'the finished day does not record WHY the chart was refused');
  eq(dayOf(refused, '2026-08-12').attempts, 1, 'the day that drove athena did not spend its one attempt');
  eq(summary(refused.manifest).needsAttention, 0, 'a refused chart still put the whole day in front of the owner');
  eq(summary(refused.manifest).chartsRefused, 1, 'the receipt cannot say how many charts were refused');
  eq(summary(refused.manifest).refusedDays, 1, 'the receipt cannot say how many days finished with a refused chart');

  /* IT SETTLES ON THE FIRST PASS - re-reading returns the same refusal. */
  eq(dayOf(refused, '2026-08-12').attempts < 3, true, 'the refusal-settled day waited for the attempt cap it can never learn anything from');

  /* R3. A TRANSIENT failure keeps retrying while it has attempts left. */
  const transient = job(daysOf(['2026-08-27']), 'selected');
  const payload = {
    date: '2026-08-27', ok: false, complete: false, reason: 'history-partial',
    chartsRead: 9, chartsUnread: 2, chartsRefused: 0, chartsRefusedCodes: {}
  };
  checkpoint(transient, payload, {});
  eq(dayOf(transient, '2026-08-27').status, 'retry', 'a day with transient chart failures stopped retrying on its first try');
  checkpoint(transient, payload, {});
  eq(dayOf(transient, '2026-08-27').status, 'retry', 'a day with transient chart failures stopped retrying on its second try');
  checkpoint(transient, payload, {});
  eq(dayOf(transient, '2026-08-27').status, 'complete',
    'a day that READ nine charts and spent every attempt was handed to the owner as needs-attention - there is nothing there for him to do');
  eq(dayOf(transient, '2026-08-27').chartsUnread, 2, 'the settled day does not say how many charts it never read');
  eq(dayOf(transient, '2026-08-27').chartsRefused, undefined, 'a transient failure was recorded as a refusal');
  eq(dayOf(transient, '2026-08-27').attempts, 3, 'the day did not spend the three genuine attempts before settling');

  /* R3. A day NOTHING could be read on is exactly what attention is for. */
  const blind = job(daysOf(['2026-08-27']), 'selected');
  const nothing = {
    date: '2026-08-27', ok: false, complete: false, reason: 'history-partial',
    chartsRead: 0, chartsUnread: 6, chartsRefused: 0, chartsRefusedCodes: {}
  };
  for (let i = 0; i < 3; i++) checkpoint(blind, nothing, {});
  eq(dayOf(blind, '2026-08-27').status, 'needs-attention',
    'a day on which NO chart could be read stopped reaching the owner - that is the one history case he must see');
  eq(dayOf(blind, '2026-08-27').reason, 'history-partial', 'the day that read nothing lost its own cause');
  eq(summary(blind.manifest).needsAttention, 1, 'the receipt does not count the day nobody could read');

  /* A day that still owes its OWN visit notes is never settled by any of it. */
  const owing = job(daysOf(['2026-08-12']), 'selected');
  checkpoint(owing, {
    date: '2026-08-12', ok: false, complete: false, reason: 'history-partial', dayNotesPending: 2,
    chartsRead: 11, chartsUnread: 1, chartsRefused: 1, chartsRefusedCodes: { 'dob-mismatch': 1 }
  }, {});
  eq(dayOf(owing, '2026-08-12').status, 'retry', 'a day still owing its own visit notes was finished by the refusal rule');
  console.log('  4. a refused chart finishes its day and is named; history-partial reaches the owner only when NO chart could be read');
}

/* =======================================================================
 * (5) R4/R5 - calendar-partial stays attention and says how many rows;
 * nav-failed is retried to the cap and no further.
 * ===================================================================== */
function proveCalendarAndNav() {
  /* R4. THE LIVE 2026-08-05 CASE. */
  const partial = job(daysOf(['2026-08-05']), 'selected');
  const rows = {
    date: '2026-08-05', ok: false, complete: false, reason: 'calendar-partial',
    chartsRead: 11, chartsUnread: 0, chartsRefused: 0, calendarMissing: 3
  };
  for (let i = 0; i < 3; i++) checkpoint(partial, rows, {});
  eq(dayOf(partial, '2026-08-05').status, 'needs-attention',
    'a day athena showed appointments for that were never saved stopped reaching the owner');
  eq(dayOf(partial, '2026-08-05').calendarMissing, 3, 'the day cannot say how many appointments were missing');
  eq(dayOf(partial, '2026-08-05').attempts, 3, 'the calendar-partial day did not spend its three genuine attempts first');
  const list = summary(partial.manifest).attention;
  eq(list.length, 1, 'the receipt does not list the calendar-partial day');
  eq(list[0].missing, 3, 'the receipt lists the day without the one number that makes it actionable');
  const copy = attentionCopy(partial.manifest);
  ok(/2026-08-05 \(calendar partial, 3 appointments missing\)/.test(copy),
    'the card does not say how many appointments that day was missing: ' + copy);
  ok(/Press Resume to re-pull just those days\./.test(RANGE),
    'the card never points the owner at the one-click re-pull that already exists');

  /* R5. nav-failed: driven, one attempt each pass, attention at the cap. */
  const nav = job(daysOf(['2026-08-06']), 'selected');
  const navPayload = { date: '2026-08-06', ok: false, complete: false, reason: 'nav-failed', chartsRead: 0, chartsUnread: 0 };
  checkpoint(nav, navPayload, {});
  eq(dayOf(nav, '2026-08-06').status, 'retry', 'a navigation failure was handed to the owner on its first try');
  eq(dayOf(nav, '2026-08-06').attempts, 1, 'a driven day did not spend an attempt');
  checkpoint(nav, navPayload, {});
  eq(dayOf(nav, '2026-08-06').status, 'retry', 'a navigation failure was handed to the owner on its second try');
  checkpoint(nav, navPayload, {});
  eq(dayOf(nav, '2026-08-06').status, 'needs-attention', 'a navigation failure never settles - the job would retry it for ever');
  eq(dayOf(nav, '2026-08-06').reason, 'nav-failed', 'the navigation failure lost its own cause');
  eq(dayOf(nav, '2026-08-06').attempts, 3, 'the navigation failure did not spend exactly the attempt cap');

  /* A sign-out riding on the same code is a sign-in problem, not an attempt. */
  const signedOut = job(daysOf(['2026-08-06']), 'selected');
  checkpoint(signedOut, { date: '2026-08-06', ok: false, complete: false, reason: 'nav-failed', sessionExpired: true }, {});
  eq(dayOf(signedOut, '2026-08-06').reason, 'athena-session-expired', 'a signed-out nav failure was charged to the day instead of the session');
  eq(dayOf(signedOut, '2026-08-06').attempts, 0, 'a sign-out burned one of the day\'s three attempts');
  console.log('  5. calendar-partial stays attention and names the missing rows beside Resume; nav-failed is retried to the cap and no further');
}

/* =======================================================================
 * (6) THE CARD. What the owner actually reads.
 * ===================================================================== */
function proveTheCardSaysIt() {
  const ctx = job({
    '2026-08-05': { status: 'needs-attention', attempts: 3, reason: 'calendar-partial', calendarMissing: 3 },
    '2026-08-12': { status: 'complete', attempts: 1, reason: 'history-partial', chartsUnread: 1, chartsRefused: 1, refused: { 'dob-mismatch': 1 } },
    '2026-08-28': { status: 'complete', attempts: 0, reason: 'provider-not-on-calendar', scopedEmpty: 1, surfaceProviders: 4 }
  }, 'selected');
  const copy = receiptCopy(ctx.manifest);
  ok(/2026-08-12 complete/.test(copy), 'the card does not say the refused-chart day is complete: ' + copy);
  ok(/1 chart refused: patient identity did not match/.test(copy),
    'the card does not say IN ENGLISH that one chart was refused because the identity did not match: ' + copy);
  ok(/A refused chart stays refused/.test(copy),
    'the card does not tell the owner that the refusal stands and nothing was guessed: ' + copy);
  ok(copy.indexOf('dob-mismatch') < 0, 'the card prints a raw machine code at the doctor: ' + copy);
  ok(/skipped as already verified\./.test(copy), 'the receipt sentence lost its skipped-days clause');
  const tiles = summary(ctx.manifest);
  eq(tiles.needsAttention, 1, 'the card counts a refused chart or an honest empty day as work for the owner');
  eq(tiles.complete, 2, 'the card does not count the refusal-settled and scoped-empty days as done');
  eq(tiles.empty, 1, 'the scoped-empty day was not counted as verified empty');
  eq(tiles.withRows, 1, 'the day that read eleven charts was not counted as a day with appointments');

  /* A clean job says nothing about refusals at all. */
  const clean = job({ '2026-08-04': { status: 'complete', attempts: 1, reason: 'complete' } }, 'selected');
  eq(/refused/.test(receiptCopy(clean.manifest)), false, 'a job with no refusals still talks about refusals');

  /* pull-heal.test.js pins the composed status line; keep the seam it pins. */
  ok(RANGE.indexOf('uiReceiptCopy(manifest) + healOutcomeCopy(manifest)') > 0,
    'the composed completion line lost the healOutcomeCopy seam pull-heal.test.js pins');
  console.log('  6. the card reads "complete - 1 chart refused: patient identity did not match" and counts no attention for it');
}

console.log('attention-days-proof: attn-1.0.0, measured on the August month pull 2026-09-02');
proveTheSeamMeasures();
proveTheReconciliationWedge();
proveScopedEmptyNeedsNoReRead();
proveChartRefusalsFinishTheDay();
proveCalendarAndNav();
proveTheCardSaysIt();
console.log('attention-days-proof PASS (' + checks + ' checks)');

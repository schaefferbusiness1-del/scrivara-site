'use strict';
/* =============================================================================
 * site-full-notes-host-contract.test.js
 *
 * The site owns two different AllVisits shapes and must never confuse them:
 *   - unscoped: Full Notes ON historical encounter-body walk;
 *   - Full Notes OFF: schedule/booking-only; no patient chart or visit-body
 *     read is attempted. Cached local facts remain untouched.
 *
 * This contract also pins one first-use admission/freeze seam for every public
 * day/month/range entry, plus relay/resume transport and doctor-facing status
 * sanitization. Synthetic patients only; no network, browser or Athena.
 * ============================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMonthHarness, flush } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const IMPORTER = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const RANGE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_rangejobs.js'), 'utf8');
const CONNECT = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
const VISITS = fs.readFileSync(path.join(ROOT, 'feat_visits.js'), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function between(source, start, end, label) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  ok(from >= 0 && to > from, label + ': source boundary moved');
  return source.slice(from, to);
}

function publicAdmissionContracts() {
  const gate = between(IMPORTER,
    'function admitFrozenVisitNotesChoice(opts, owner) {',
    '/* ===== end fnc-1.0.0', 'shared public admission');
  ok(gate.includes('typeof opts.pullVisitBodies === "boolean"'),
    'the shared gate does not recognize an already-frozen boolean');
  ok(gate.includes('pref.ensureChosenForBulkPull()') &&
    gate.includes('frozen.pullVisitBodies = choice.on === true'),
    'the shared gate does not resolve and freeze the first-use choice');
  ok(gate.includes('return owner(frozen);'),
    'the admitted operation does not re-enter with the frozen options');

  [
    ['function pull(opts) {', 'var __monthOwned', 'day engine'],
    ['function pullMonth(opts) {', 'var month =', 'month engine'],
    ['function dayPull(opts) {', '/* fg-1.2', 'guarded day engine']
  ].forEach(([start, end, label]) => {
    const head = between(IMPORTER, start, end, label + ' admission head');
    ok(head.includes('admitFrozenVisitNotesChoice(opts,'),
      label + ' can start without the shared first-use admission');
    ok(head.indexOf('admitFrozenVisitNotesChoice') < head.lastIndexOf('return __visitNotesAdmission'),
      label + ' admission does not return before engine work');
  });

  const rangeHead = between(RANGE, 'function start(kind, value, opts) {',
    'function resume(opts) {', 'durable range admission');
  ok(rangeHead.includes('admitRangeVisitNotesChoice(kind, parsed.target, parsed.opts)'),
    'direct range starts can still manufacture a mode before first-use choice');
  ok(rangeHead.indexOf('admitRangeVisitNotesChoice') < rangeHead.indexOf('lockApi()'),
    'range admission happens after lock/provider/manifest work');
  const rangeGate = between(RANGE, 'function admitRangeVisitNotesChoice(',
    'function start(kind, value, opts) {', 'range freeze helper');
  ok(rangeGate.includes('normalized.pullVisitBodies = explicit') &&
    rangeGate.includes('normalized.fullNotes = explicit') &&
    rangeGate.includes('frozen.pullVisitBodies = choice.on === true') &&
    rangeGate.includes('frozen.fullNotes = choice.on === true'),
    'range choice is not frozen into both durable compatibility fields');

  /* These are the still-loaded alternate owners found by the audit. They may
     omit a boolean, but none may bypass the now-gated public methods. */
  const alternate = [
    ['feat_mls_patientpick.js', /__mlsSI\.pull\s*\(/],
    ['feat_mls_simple_exact.js', /__mlsSI\.pull\s*\(/],
    ['feat_mls_assistant_exact.js', /\bSI\.pull\s*\(/],
    ['feat_mls_asst_fix.js', /\bsi\.pull(?:Month)?\s*\(/i],
    ['feat_mls_copilot_power.js', /\bsi\.dayPull\s*\(/],
    ['feat_mls_calpro.js', /\bsi\.pullMonth\s*\(/],
    ['1p-feat_mls_legalpack.js', /\bsi\.dayPull\s*\(/],
    ['1p-mls-connect.js', /\bexact\.pullMonth\s*\(/]
  ];
  alternate.forEach(([file, call]) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    ok(call.test(source), file + ' no longer contains the audited public pull entry');
    ok(!/\._runHistoryBatch\s*\(|\bpullUnlocked\s*\(/.test(source),
      file + ' bypasses the public admission boundary');
  });
}

function transportAndShapeContracts() {
  ok(IMPORTER.includes('var fullNotesOff = visitNotesRequested === false;') &&
    IMPORTER.includes('var historyReceipt = (!fullNotesOff && includeHistory)'),
    'Full Notes OFF does not close the entire bulk chart/history phase');
  ok(IMPORTER.includes('var pulledDayNoteLaneEnabled = false;') &&
    IMPORTER.includes('var pulledDayNoteTailEnabled = false;'),
    'legacy inline/tail note lanes are not disabled for schedule-only pulls');
  ok(VISITS.includes("'mlsAppReadAllVisits'") &&
    VISITS.includes("onlyDate: String(runOpts.onlyDate || '')"),
    'the scoped reader no longer transports hint.onlyDate');

  ok(CONNECT.includes("if (typeof pl.pullVisitBodies === 'boolean') opts.pullVisitBodies = pl.pullVisitBodies"),
    'relay runner can lose the requesting device boolean');
  ok(CONNECT.includes("if (typeof _bv === 'boolean') jobPayload.pullVisitBodies = _bv"),
    'relay sender can omit its frozen boolean');
  ok(CONNECT.includes("jobPayload.pullVisitBodies === true ? '1' : (jobPayload.pullVisitBodies === false ? '0' : 'u')"),
    'relay dedupe identity no longer includes the boolean mode');
  ok(IMPORTER.includes("bodies: (typeof opts.pullVisitBodies === \"boolean\") ? opts.pullVisitBodies : null") &&
    IMPORTER.includes("if (typeof rec.bodies === 'boolean') resumeOpts.pullVisitBodies = rec.bodies"),
    'day resume no longer preserves the frozen boolean');
  ok(RANGE.includes('pullVisitBodies: manifest.options.fullNotes === true'),
    'durable month/year resume no longer emits an explicit boolean per month');
  ok(CONNECT.includes('var historyIntentionallySkipped = hr.visitNotesRequested === false') &&
    CONNECT.includes('var histLine = (!historyIntentionallySkipped && hr.requested != null)') &&
    CONNECT.includes('Full visit notes were intentionally skipped (Full Notes is off).'),
    'schedule-only completion does not invent a history gap or offer a misleading retry');
}

function installChoice(h, on, options = {}) {
  let ensureCalls = 0, readCalls = 0;
  h.rt.__mlsVisitNotesPref = {
    read() { readCalls++; return { state: options.poisonReadOn ? 'on' : 'off', on: !!options.poisonReadOn, settled: true }; },
    write: () => true,
    isPrefKey: () => false,
    ensureChosenForBulkPull() {
      ensureCalls++;
      if (options.refuse) return Promise.resolve({ ok: false, on: null, reason: options.refuse });
      return Promise.resolve({ ok: true, on: on === true, reason: 'synthetic-choice' });
    }
  };
  return { ensureCalls: () => ensureCalls, readCalls: () => readCalls };
}

async function runtimeModeBoundary() {
  const day = '2026-08-23';

  /* Poison storage ON; the explicit OFF argument must still win without even
     consulting the first-use resolver. */
  const explicitOff = makeMonthHarness({ today: '2026-08-24' });
  explicitOff.seedDay(day, 2);
  const explicitGate = installChoice(explicitOff, true, { poisonReadOn: true });
  const explicitResult = await explicitOff.api.pull({
    date: day, provider: explicitOff.provider, includeHistory: true,
    pullVisitBodies: false, onStatus: explicitOff.onStatus
  });
  eq(explicitGate.ensureCalls(), 0, 'an explicit OFF operation reopened first-use admission');
  eq(explicitGate.readCalls(), 0, 'an explicit OFF operation reread poisoned storage');
  eq(explicitOff.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'explicit OFF emitted an unscoped historical AllVisits request');
  eq(explicitOff.noteCalls.length, 0,
    'explicit OFF attempted a deferred/scoped visit-note read');
  eq(explicitOff.chartCalls.length, 0,
    'explicit OFF opened a patient chart for fresh stable facts');
  eq(explicitResult.historyReceipt.reason, 'full-notes-off',
    'OFF history stage was not recorded as intentionally skipped');
  eq(explicitResult.historyReceipt.visitNotesRequested, false,
    'OFF history receipt did not carry the frozen visit-notes choice');
  eq(explicitResult.historyReceipt.failures, 0,
    'intentionally skipped OFF history was counted as incomplete');

  /* An omitted mode must be admitted once. The confirmed OFF choice stays
     frozen across both days even while read() lies ON. */
  const monthOff = makeMonthHarness({ today: '2026-08-24' });
  const dayA = '2026-08-21', dayB = '2026-08-22';
  monthOff.seedDay(dayA, 1); monthOff.seedDay(dayB, 1);
  const monthGate = installChoice(monthOff, false, { poisonReadOn: true });
  const monthResult = await monthOff.api.pullMonth({
    month: '2026-08', dates: [dayA, dayB], provider: monthOff.provider,
    includeHistory: true, onStatus: monthOff.onStatus
  });
  eq(monthGate.ensureCalls(), 1, 'month first-use choice was not resolved exactly once');
  eq(monthGate.readCalls(), 0, 'the admitted month reread mutable storage');
  eq(monthResult.includeHistory, false,
    'the admitted OFF month still advertised a chart/history phase at the top level');
  eq(monthResult.historyRequested, false,
    'the admitted OFF month did not mark history as intentionally skipped');
  eq(monthResult.visitNotesRequested, false,
    'the admitted OFF month lost its frozen Full Notes choice at the top level');
  eq(monthOff.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'the admitted OFF month switched into an unscoped ON body walk');
  eq(monthOff.noteCalls.length, 0,
    'the OFF month attempted deferred/scoped visit-note reads');
  eq(monthOff.chartCalls.length, 0,
    'the OFF month opened patient charts for fresh stable facts');
  eq(monthResult.days.filter(d => d.receipt && d.receipt.historyReceipt && d.receipt.historyReceipt.reason === 'full-notes-off').length, 2,
    'the OFF month did not preserve an intentional skip receipt for every day');
  ok(monthResult.days.length === 2,
    'the synthetic two-day month did not finish both frozen-mode days');

  /* Confirmed ON is the opposite shape: one ordinary unscoped historical
     request per uncached patient, with no onlyDate field on those messages. */
  const admittedOn = makeMonthHarness({ today: '2026-08-24' });
  admittedOn.seedDay(day, 2);
  const onGate = installChoice(admittedOn, true, { poisonReadOn: false });
  await admittedOn.api.pull({ date: day, provider: admittedOn.provider,
    includeHistory: true, onStatus: admittedOn.onStatus });
  const unscoped = admittedOn.posted.filter(m => m.type === 'mlsAppReadAllVisits');
  eq(onGate.ensureCalls(), 1, 'omitted ON mode did not use first-use admission exactly once');
  eq(onGate.readCalls(), 0, 'admitted ON reread the opposite stored preference');
  eq(unscoped.length, 2, 'ON ordinary success did not emit one unscoped body walk per patient');
  ok(unscoped.every(m => !(m.hint && m.hint.onlyDate)),
    'an ON historical body walk was mislabeled as a date-scoped day-note read');
  eq(admittedOn.noteCalls.length, 0,
    'ON also ran the OFF-only pulled-day note lane');

  /* Missing admission capability refuses before schedule, navigation or chart
     work. This is the fail-closed behavior for an unset/partially loaded site. */
  const unavailable = makeMonthHarness({ today: '2026-08-24' });
  unavailable.seedDay(day, 1);
  delete unavailable.rt.__mlsVisitNotesPref.ensureChosenForBulkPull;
  const refused = await unavailable.api.dayPull({ date: day, provider: unavailable.provider,
    includeHistory: true, onStatus: unavailable.onStatus });
  eq(refused.gate, 'visit-notes-choice', 'missing choice API did not fail at the admission gate');
  eq(unavailable.gotoDates.length, 0, 'refused first-use day pull navigated Athena');
  eq(unavailable.scheduleReads.length, 0, 'refused first-use day pull read the schedule');
  eq(unavailable.chartCalls.length, 0, 'refused first-use day pull opened a chart');
}

function statusSanitizationContract() {
  const start = CONNECT.indexOf('var PP_PENDING =');
  const end = CONNECT.indexOf('  function buildPanel() {', start);
  ok(start >= 0 && end > start, 'pull-panel mapper boundaries moved');
  const context = {
    esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  };
  vm.createContext(context);
  vm.runInContext(CONNECT.slice(start, end) + '\nthis.__rowsHtml = rowsHtml;', context,
    { filename: 'pull-panel-status-mapper.js' });
  const raw = 'visit-bodies-incomplete [no-bound-clinical-detail,stable-source-keys-incomplete]';
  const html = context.__rowsHtml({ rows: [{
    name: 'Synthetic Patient', k: 'synthetic|p1', pid: 'p1', ok: true,
    reason: '', dn: 'unread:' + raw, dnd: '2026-08-23'
  }] });
  ok(html.includes('saved') && html.includes('today’s note not read this time'),
    'OFF day-note refusal is not rendered as a separate chart-saved status');
  ok(!/visit-bodies-incomplete|no-bound-clinical-detail|stable-source-keys-incomplete/.test(html),
    'OFF day-note status/tooltip leaked raw scoped-reader internals');
  ok(!html.includes('chart saved — visit notes incomplete'),
    'OFF day-note refusal was mislabeled as an unscoped full-history failure');
}

async function main() {
  publicAdmissionContracts();
  transportAndShapeContracts();
  await runtimeModeBoundary();
  statusSanitizationContract();
  await flush(3);
  console.log('PASS site-full-notes-host-contract: ' + checks +
    ' checks - public admission freezes OFF/ON across day/month/range/relay/resume, OFF is schedule-only with no chart/body reads, and raw day-note internals stay out of UI');
}

const watchdog = setTimeout(() => {
  console.error(new Error('site-full-notes-host-contract did not finish'));
  process.exit(1);
}, 120000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});

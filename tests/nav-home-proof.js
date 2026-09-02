/* nav-home-proof.js — navhome-1.0.0
 *
 * MEASURED live 2026-09-02 05:5x, owner's tab, MLS Assist 3.0.107, on the
 * provider-scoped August 2026 durable month job (29 of 31 days complete): ONE
 * day failed `nav-failed` on nine consecutive attempts across three app builds
 * while the other thirty days of the same month navigated normally. Its
 * receipt read
 *
 *   navDiag { ok:false, supported:true, reason:'goto-date-deadline-exceeded',
 *             via:'', observedDay:'', initFrames:0, initFound:false,
 *             rounds:0, recoveryRan:false, sequences:1, attempts:2 }
 *
 * and THREE separate readers - including the brief that opened this lane -
 * concluded from those zeros that "the goto never found a calendar frame, so
 * the extension's recovery ladder was never reachable".
 *
 * THAT CONCLUSION IS WRONG, AND THIS SUITE IS THE PROOF.
 *
 * MLS Assist answers a blown request deadline from ONE guarded funnel, and
 * that funnel attaches NO diag at all. navDiagOf then defaults every
 * diag-derived field through `(d && d.initFrames) || 0`, so a diag-less reply
 * prints initFrames 0 / initFound false / rounds 0 / tabPath '' no matter what
 * the handler actually did. The zeros are the ABSENCE of the evidence.
 *
 * The one real signal the deadline reply does carry is the STAGE its own fixed
 * text names, and the stage this day died in - the selected-day settle - is
 * reachable only AFTER a date control was found. So athenaOne HAD a control
 * and spent its whole navigation budget failing to make the day land on it:
 * the dashboard shape the owner cures by hand with Calendar > View Calendar.
 *
 * navhome-1.0.0 therefore (1) says the diag was absent instead of printing
 * zeros that read as a measurement, (2) names the stage the budget died in,
 * (3) asks the extension's OWN read-only goto probe which surface athenaOne is
 * showing - once, only on that class, only after the pull is already lost -
 * and (4) puts the two clicks that cure it on the day card and on the durable
 * month card. It drives NO navigation of its own: the extension owns that tab,
 * and there is no app-reachable verb for its Calendar > View Calendar restore.
 *
 * Every function under test is LIFTED FROM THE SHIPPED BYTES and executed.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const IMPORTER = fs.readFileSync('1p-feat_mls_schedimport_exact.js', 'utf8');
const RANGE = fs.readFileSync('1p-feat_mls_rangejobs.js', 'utf8');

let checks = 0;
function ok(cond, message) { checks++; assert.ok(cond, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }
function deep(actual, expected, message) { checks++; assert.deepStrictEqual(actual, expected, message); }

/* ---- slice helpers: the same balanced extractors attention-days-proof uses -- */
function closing(source, start, open, shut, label) {
  let depth = 0, quote = '', i = source.indexOf(open, start);
  assert(i > start - 1, 'slice has no body: ' + label);
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1];
    if (quote) { if (ch === quote && prev !== '\\') quote = ''; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === shut && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated slice: ' + label);
}
function balanced(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'slice not found: ' + (label || signature));
  return closing(source, start, '{', '}', label || signature);
}
function listOf(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'slice not found: ' + (label || signature));
  return closing(source, start, '[', ']', label || signature);
}

/* =======================================================================
 * THE IMPORTER'S NAV SEAM, EXECUTED. navDiagOf and p1NavFailure are lifted
 * out of the real pull closure, together with the real fail() they build
 * their receipt through and the real navhome vocabulary they classify on.
 * ===================================================================== */
const TARGET_DAY = '2026-08-06';
function importerContext() {
  const slices = [
    listOf(IMPORTER, 'var P1_NAV_DEADLINE_STAGES = [', 'P1_NAV_DEADLINE_STAGES') + ';',
    balanced(IMPORTER, 'var P1_NAV_POST_CONTROL_STAGES = {', 'P1_NAV_POST_CONTROL_STAGES') + ';',
    balanced(IMPORTER, 'function p1NavDeadlineStage(nav)', 'p1NavDeadlineStage'),
    balanced(IMPORTER, 'var P1_NAV_SURFACE_CODES = {', 'P1_NAV_SURFACE_CODES') + ';',
    balanced(IMPORTER, 'function p1NavSurfaceOf(resp)', 'p1NavSurfaceOf'),
    balanced(IMPORTER, 'function p1NavSurfaceAdvice(surface, stage)', 'p1NavSurfaceAdvice'),
    balanced(IMPORTER, 'function p1NavEmptyStrip(nav, diag)', 'p1NavEmptyStrip'),
    balanced(IMPORTER, 'function p1OneTabAdvice(tabs)', 'p1OneTabAdvice'),
    balanced(IMPORTER, 'function p1MonthDayNavSurface(receipt)', 'p1MonthDayNavSurface'),
    balanced(IMPORTER, 'var RECEIPT_GATE_REASONS = {', 'RECEIPT_GATE_REASONS') + ';',
    balanced(IMPORTER, 'function fail(reason, extra)', 'fail'),
    balanced(IMPORTER, 'function navDiagOf(nav, attempts)', 'navDiagOf'),
    balanced(IMPORTER, 'function p1NavFailure(nav, diag)', 'p1NavFailure')
  ].join('\n');
  const calls = { bridge: [], status: [], tabCount: 0 };
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp, Promise, isFinite,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    isFn(f) { return typeof f === 'function'; },
    normDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''; },
    /* the pull-closure state navDiagOf/p1NavFailure/fail read */
    date: TARGET_DAY,
    navRecovery: { ran: false },
    athenaBusy: { athenaBusyRetries: 0, athenaPresence: '' },
    p1PresenceLast: { at: 0, resp: null },
    includeHistory: true,
    visitNotesRequested: null,
    fullNotesOff: true,
    providerGate: { ok: true, receipt: null },
    duplicateExtHint() { return ''; },
    extUpdateHint() { return ''; },
    onStatus(message, kind) { calls.status.push({ message: String(message || ''), kind: String(kind || '') }); },
    /* the extension bridge, scripted. EVERY dispatch is recorded, so the
       suite can prove exactly how many were spent and what they asked for. */
    bridge(type, reqType, timeoutMs, payload) {
      calls.bridge.push({ type, reqType, timeoutMs, payload: payload || {} });
      const reply = sandbox.__probeReply;
      if (typeof reply === 'function') return Promise.resolve(reply(calls.bridge.length));
      if (reply === '__throw') return Promise.reject(new Error('bridge exploded'));
      return Promise.resolve(reply);
    },
    p1AthenaTabsKnown() { return sandbox.__tabsKnown; },
    p1AthenaTabCount() { calls.tabCount++; return Promise.resolve(1); },
    __probeReply: null,
    __tabsKnown: 1
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'navhome-importer-slices.js' });
  return { ctx, sandbox, calls };
}
const IMP = importerContext();
function call(expr, args) {
  IMP.sandbox.__args = args || [];
  return vm.runInContext(expr, IMP.ctx);
}
function navDiag(nav, attempts) {
  IMP.sandbox.__nav = nav; IMP.sandbox.__attempts = attempts;
  return vm.runInContext('navDiagOf(__nav, __attempts)', IMP.ctx);
}
function navFail(nav) {
  IMP.sandbox.__nav = nav;
  IMP.sandbox.__diag = navDiag(nav, 2);
  return vm.runInContext('p1NavFailure(__nav, __diag)', IMP.ctx);
}
function reset(probeReply) {
  IMP.calls.bridge.length = 0; IMP.calls.status.length = 0; IMP.calls.tabCount = 0;
  IMP.sandbox.__probeReply = probeReply === undefined ? null : probeReply;
  IMP.sandbox.navRecovery.ran = false;
}

/* THE EXACT MEASURED REPLY. Byte for byte the shape MLS Assist 3.0.107's
   deadline funnel answers: supported, reason-coded, and carrying NO diag. */
const MEASURED = {
  ok: false,
  supported: true,
  reason: 'goto-date-deadline-exceeded',
  error: 'Date navigation reached its immutable request deadline during the selected-day settle. No late retry was dispatched.',
  sessionLikelyExpired: false,
  controlVisible: false,
  athenaTabs: 1
};
/* A reply that DOES carry a diag - the terminal weekstrip verdict. */
const WEEKSTRIP = {
  ok: false, supported: true, via: 'weekstrip', schedDate: '',
  error: 'athena week strip shows no selected day instead of ' + TARGET_DAY + '.',
  diag: { tabId: 7, tabPath: '/1/1/ax/dashboard', initFrames: 3, initFound: true, rounds: [{ rec: 0 }, { rec: 1 }] }
};
const PROBE_CONTROL = { ok: true, supported: true, via: 'weekstrip', controlVisible: true };
const PROBE_NO_CONTROL = { ok: true, supported: true, via: 'auto-recovery', controlVisible: false };
const PROBE_NO_TAB = { ok: false, supported: false, error: 'No athenaOne tab open.' };

/* =======================================================================
 * (1) THE REFUTATION. The measured zeros are an ABSENCE, not a measurement.
 * ===================================================================== */
function proveTheZerosAreAnAbsence() {
  reset();
  const d = navDiag(MEASURED, 2);
  /* the four fields that were read as evidence, reproduced exactly */
  deep({ initFrames: d.initFrames, initFound: d.initFound, rounds: d.rounds, tabPath: d.tabPath },
    { initFrames: 0, initFound: false, rounds: 0, tabPath: '' },
    'the shipped diag no longer reproduces the measured receipt - the lane premise moved');
  eq(d.recoveryRan, false, 'the measured shape reported the ladder as re-entered');
  eq(d.sequences, 1, 'the measured shape reported two goto sequences');
  /* navhome-1.0.0: and now it says WHY those are zero */
  eq(d.diagPresent, false, 'a diag-less deadline reply still prints four zeros with nothing saying the diag was absent');
  eq(d.deadlineStage, 'selected-day-settle', 'the deadline reply does not name the stage its budget died in');

  /* the SAME builder on a reply that really does carry a diag */
  const withDiag = navDiag(WEEKSTRIP, 1);
  eq(withDiag.diagPresent, true, 'a reply carrying a real diag was reported as diag-less');
  eq(withDiag.initFrames, 3, 'a real diag did not reach the receipt');
  eq(withDiag.rounds, 2, 'a real diag lost the rounds the ladder actually spent');
  eq(withDiag.deadlineStage, '', 'a non-deadline reply invented a deadline stage');

  /* THE PROPERTY: diagPresent:false and initFrames:0 can never be confused
     again, because zero frames WITH a diag says diagPresent:true. */
  const zeroFramesMeasured = navDiag({ ok: false, supported: true, diag: { initFrames: 0, initFound: false, rounds: [] } }, 1);
  eq(zeroFramesMeasured.diagPresent, true, 'a MEASURED zero-frame diag is indistinguishable from an absent one');
  eq(zeroFramesMeasured.initFrames, 0, 'a measured zero-frame diag lost its zero');

  /* the stage vocabulary is CLOSED: every recognised stage maps to a code,
     anything else that is still a deadline reply is exactly 'other', and a
     reply that is not a deadline reply at all is exactly ''. */
  const stageOf = text => {
    IMP.sandbox.__nav = { reason: 'goto-date-deadline-exceeded', error: text };
    return vm.runInContext('p1NavDeadlineStage(__nav)', IMP.ctx);
  };
  const during = stage => 'Date navigation reached its immutable request deadline during ' + stage + '. No late retry was dispatched.';
  eq(stageOf(during('the selected-day settle')), 'selected-day-settle', 'the post-control settle stage lost its code');
  eq(stageOf(during('the selected-day re-render')), 'selected-day-re-render', 'the post-control re-render stage lost its code');
  eq(stageOf(during('the View Calendar settle')), 'view-calendar-settle', 'the extension\'s own Calendar restore stage lost its code');
  eq(stageOf(during('the Calendar menu')), 'calendar-menu', 'the Calendar menu stage lost its code');
  eq(stageOf(during('the schedule frameset settle')), 'frameset-settle', 'the frameset settle stage lost its code');
  eq(stageOf(during('the Home navigation')), 'home-navigation', 'the Home stage lost its code');
  eq(stageOf(during('Athena tab enumeration')), 'tab-enumeration', 'the tab enumeration stage lost its code');
  eq(stageOf(during('Athena tab selection')), 'tab-selection', 'the tab selection stage lost its code');
  eq(stageOf(during('the Athena navigation lock')), 'nav-lock', 'the navigation lock stage lost its code');
  eq(stageOf(during('the quiet Athena workspace')), 'quiet-workspace', 'the quiet workspace stage lost its code');
  eq(stageOf(during('the request')), 'request', 'the whole-request deadline lost its code');
  eq(stageOf('Date navigation returned after its immutable request deadline. The late result was discarded.'), 'late-result',
    'the discarded-late-result reply lost its code');
  eq(stageOf(during('some screen a later extension invents')), 'other',
    'an unrecognised deadline stage is not collapsed to the closed fallback');
  IMP.sandbox.__nav = { ok: false, supported: true, reason: 'athena-navigation-busy', error: 'x' };
  eq(vm.runInContext('p1NavDeadlineStage(__nav)', IMP.ctx), '', 'a non-deadline coded refusal was read as a deadline');
  IMP.sandbox.__nav = null;
  eq(vm.runInContext('p1NavDeadlineStage(__nav)', IMP.ctx), '', 'a null reply minted a deadline stage');
  console.log('  1. the measured zeros are the ABSENCE of the diag, not a measurement of zero frames - and the stage the budget died in is named');
}

/* =======================================================================
 * (2) THE MEASURED SHAPE SPENDS EXACTLY ONE READ-ONLY SURFACE PROBE, and
 *     the verdict names the two clicks that cure it.
 * ===================================================================== */
async function proveTheOneBoundedProbe() {
  reset(PROBE_CONTROL);
  const out = await navFail(MEASURED);
  eq(IMP.calls.bridge.length, 1, 'the deadline class did not spend exactly one surface probe');
  const dispatch = IMP.calls.bridge[0];
  eq(dispatch.reqType, 'mlsAppGotoDate', 'the surface measurement used a verb other than the shipped goto');
  eq(dispatch.payload.probe, true, 'the surface measurement was NOT the read-only probe - the app must never drive athena here');
  eq(dispatch.payload.date, TARGET_DAY, 'the probe asked about a day other than the one that failed');
  ok(Number(dispatch.timeoutMs) > 0 && Number(dispatch.timeoutMs) <= 6000,
    'the surface probe is not bounded by a short immutable deadline: ' + dispatch.timeoutMs);

  eq(out.reason, 'nav-failed', 'the day verdict left the pinned nav-failed class');
  eq(out.ok, false, 'a nav refusal reported success');
  eq(out.complete, false, 'a nav refusal reported the day complete');
  eq(out.navStage, 'selected-day-settle', 'the receipt lost the stage the budget died in');
  eq(out.navSurface, 'control-visible', 'the receipt lost the measured athenaOne surface');
  ok(/Calendar > View Calendar/.test(out.navAdvice), 'the verdict does not tell the doctor to open Calendar > View Calendar: ' + out.navAdvice);
  ok(/not the dashboard/.test(out.navAdvice), 'the verdict does not say which screen to leave: ' + out.navAdvice);
  eq(IMP.calls.status[IMP.calls.status.length - 1].message, out.navAdvice,
    'the status line the doctor sees is not the sentence the receipt carries');
  eq(IMP.calls.status[IMP.calls.status.length - 1].kind, 'err', 'the nav refusal stopped being reported as an error');

  /* the same class with NO control visible says the other half of the cure */
  reset(PROBE_NO_CONTROL);
  const parked = await navFail({ ok: false, supported: true, reason: 'goto-date-deadline-exceeded', error: 'Date navigation reached its immutable request deadline during the schedule frameset settle. No late retry was dispatched.' });
  eq(IMP.calls.bridge.length, 1, 'the no-control shape did not spend exactly one probe');
  eq(parked.navSurface, 'no-control', 'a measured missing date control did not reach the receipt');
  eq(parked.navStage, 'frameset-settle', 'the frameset stage did not reach the receipt');
  ok(/Calendar > View Calendar/.test(parked.navAdvice), 'a parked athenaOne is not told how to come back: ' + parked.navAdvice);
  ok(/dashboard or inside a chart/.test(parked.navAdvice), 'the parked sentence does not name what MLS actually saw');

  /* no signed-in athena tab keeps the sign-in copy - this build must not
     start telling a signed-out doctor to open a calendar menu */
  reset(PROBE_NO_TAB);
  const noTab = await navFail(MEASURED);
  eq(noTab.navSurface, 'no-athena-tab', 'an absent athenaOne tab did not reach the receipt as its own code');
  eq(noTab.navAdvice, undefined, 'a missing athenaOne tab was answered with calendar-menu advice instead of the sign-in copy');
  eq(IMP.calls.status[IMP.calls.status.length - 1].message, MEASURED.error,
    'the existing extension sentence stopped standing when nothing better was proved');
  console.log('  2. the measured deadline class spends exactly ONE read-only probe and the verdict names the exact cure');
}

/* =======================================================================
 * (3) NO LOOPS, NO NEW NAVIGATION, AND EVERY OTHER SHAPE UNTOUCHED.
 * ===================================================================== */
async function proveItNeverLoopsAndNeverDrives() {
  /* a second failure of the same day is another honest nav-failed: one probe
     each, never a retry of the goto, never a navigation verb from the app */
  reset(PROBE_CONTROL);
  const first = await navFail(MEASURED);
  const firstDispatches = IMP.calls.bridge.length;
  const second = await navFail(MEASURED);
  eq(firstDispatches, 1, 'the first failure spent more than one dispatch');
  eq(IMP.calls.bridge.length, 2, 'the second failure did not spend exactly one more probe');
  eq(first.reason, 'nav-failed', 'the first failure left the pinned class');
  eq(second.reason, 'nav-failed', 'a repeat failure was promoted to some softer verdict');
  eq(IMP.calls.bridge.filter(c => c.payload.probe !== true).length, 0,
    'the app dispatched a NON-probe navigation of its own - the extension owns that tab');
  eq(IMP.calls.bridge.filter(c => c.reqType !== 'mlsAppGotoDate').length, 0,
    'the app reached for a verb outside the read-only goto probe');

  /* a probe that never answers, or throws, costs the verdict nothing */
  reset({ ok: false, complete: false, reason: 'bridge-deadline-exceeded', error: 'MLS Assist did not finish before the immutable request deadline.' });
  const silent = await navFail(MEASURED);
  eq(silent.navSurface, 'unmeasured', 'an unanswered probe was reported as a measurement');
  eq(silent.reason, 'nav-failed', 'an unanswered probe changed the day verdict');
  ok(/Calendar > View Calendar/.test(silent.navAdvice),
    'the post-control STAGE alone no longer proves a control was found - the cure sentence was lost when the probe went quiet');
  reset('__throw');
  const thrown = await navFail(MEASURED);
  eq(thrown.navSurface, 'unmeasured', 'a thrown probe minted a surface');
  eq(thrown.reason, 'nav-failed', 'a thrown probe changed the day verdict');

  /* (c) EVERY OTHER NAV SHAPE: zero probes, verdict and copy untouched */
  reset(PROBE_CONTROL);
  const strip = await navFail(WEEKSTRIP);
  eq(IMP.calls.bridge.length, 0, 'a non-deadline nav failure spent a probe it had no reason to spend');
  eq(strip.navStage, '', 'a non-deadline nav failure invented a deadline stage');
  eq(strip.navSurface, '', 'a non-deadline nav failure invented a surface');
  eq(strip.navEmptyStrip, true, 'the older empty-strip measurement stopped being made');
  ok(/Keep ONE signed-in Athena tab open/.test(strip.navAdvice),
    'the empty-strip sentence lost its priority over the new surface sentence: ' + strip.navAdvice);

  reset(PROBE_CONTROL);
  const busy = await navFail({ ok: false, supported: true, reason: 'athena-navigation-busy', error: 'Another Athena navigation is still finishing.' });
  eq(IMP.calls.bridge.length, 0, 'a coded non-deadline refusal spent a probe');
  eq(busy.reason, 'nav-failed', 'a coded refusal left the pinned class');
  eq(busy.navAdvice, undefined, 'a coded refusal was given surface advice it had not earned');

  reset(PROBE_CONTROL);
  const nulled = await navFail(null);
  eq(IMP.calls.bridge.length, 0, 'a null reply spent a probe');
  eq(nulled.reason, 'nav-failed', 'a null reply escaped the nav-failed class');

  /* byte pins: the app-side lane still drives NOTHING at athena, and the one
     new dispatch in it is the read-only probe */
  ok(!IMPORTER.includes('bridge("mlsAppGoHomeResult", "mlsAppGoHome"'),
    'the importer started driving the extension Home verb again - it lands on the dashboard, which is the wrong surface');
  const failureSlice = balanced(IMPORTER, 'function p1NavFailure(nav, diag)', 'p1NavFailure');
  eq((failureSlice.match(/bridge\(/g) || []).length, 1, 'the nav-failure seam grew a second extension dispatch');
  ok(/\{ date: date, probe: true \}/.test(failureSlice), 'the nav-failure dispatch is no longer the read-only probe');
  console.log('  3. one probe per failure, never a loop, never a navigation from the app - and every other nav shape is byte-for-byte untouched');
}

/* =======================================================================
 * (4) THE SEAM STAYS PHI-FREE AND CLOSED, at the receipt and at the
 *     durable checkpoint, and the two classifiers cannot disagree.
 * ===================================================================== */
async function proveTheSeamIsClosedAndPhiFree() {
  const SECRETS = ['Uyen Phan', 'Never Expose', '1970-01-02', '99887766', 'briefing/12345'];
  reset({
    ok: true, supported: true, controlVisible: true, via: 'weekstrip',
    patientName: 'Never Expose', mrn: '99887766', dob: '1970-01-02',
    url: 'https://athenanet.athenahealth.com/1/1/ax/briefing/12345'
  });
  const out = await navFail({
    ok: false, supported: true, reason: 'goto-date-deadline-exceeded',
    error: 'Date navigation reached its immutable request deadline during the selected-day settle. No late retry was dispatched.',
    patientName: 'Uyen Phan', schedRows: [{ name: 'Never Expose', dob: '1970-01-02' }]
  });
  const receiptText = JSON.stringify({ navStage: out.navStage, navSurface: out.navSurface, navDiag: out.navDiag, navAdvice: out.navAdvice });
  SECRETS.forEach(secret => ok(receiptText.indexOf(secret) < 0, 'PHI crossed the navhome receipt seam: ' + secret));
  eq(out.navSurface, 'control-visible', 'a PHI-stuffed probe reply lost its closed surface code');

  /* the two closed vocabularies, exhaustively */
  const SURFACES = ['control-visible', 'no-control', 'no-athena-tab', 'unmeasured', ''];
  const surfaceOf = resp => { IMP.sandbox.__resp = resp; return vm.runInContext('p1NavSurfaceOf(__resp)', IMP.ctx); };
  [null, undefined, 0, 'yes', [], {}, { ok: true }, { ok: 'true', supported: true, controlVisible: true },
    { ok: true, supported: true, reason: 'athena-tab-sleeping', controlVisible: true },
    { ok: true, supported: 'yes', controlVisible: true }].forEach(shape => {
    const code = surfaceOf(shape);
    ok(SURFACES.indexOf(code) >= 0, 'the surface classifier answered outside its closed set: ' + code);
  });
  eq(surfaceOf({ ok: true, supported: true, controlVisible: true }), 'control-visible', 'an exact control-visible probe was not read as one');
  eq(surfaceOf({ ok: true, supported: true, controlVisible: false }), 'no-control', 'an exact no-control probe was not read as one');
  eq(surfaceOf({ ok: true, supported: true }), 'no-control', 'an absent controlVisible was read as a visible control');
  eq(surfaceOf({ ok: 'true', supported: true, controlVisible: true }), 'unmeasured', 'a malformed ok minted a measurement');
  eq(surfaceOf({ ok: false, supported: false, error: 'No athenaOne tab open.' }), 'no-athena-tab', 'an absent tab lost its own code');
  eq(surfaceOf({ ok: false, supported: true }), 'unmeasured', 'a bare failed probe minted a surface');

  /* the checkpoint classifier folds the stage in by the SAME law the advice
     does, so the day card and the day receipt can never disagree */
  const checkpointOf = receipt => { IMP.sandbox.__r = receipt; return vm.runInContext('p1MonthDayNavSurface(__r)', IMP.ctx); };
  const adviceOf = (surface, stage) => { IMP.sandbox.__s = surface; IMP.sandbox.__st = stage; return vm.runInContext('p1NavSurfaceAdvice(__s, __st)', IMP.ctx); };
  const STAGES = ['', 'selected-day-settle', 'selected-day-re-render', 'frameset-settle', 'request', 'other', 'late-result'];
  SURFACES.concat(['nonsense', 'CONTROL-VISIBLE']).forEach(surface => STAGES.forEach(stage => {
    const cp = checkpointOf({ navSurface: surface, navStage: stage });
    ok(['control-visible', 'no-control', 'no-athena-tab', ''].indexOf(cp) >= 0,
      'the checkpoint surface left its closed set: ' + cp);
    const advice = adviceOf(surface, stage);
    if (cp === 'control-visible') ok(/date control open but never switched/.test(advice), 'the card and the receipt disagree for ' + surface + '/' + stage);
    else if (cp === 'no-control') ok(/isn't showing a schedule date control/.test(advice), 'the card and the receipt disagree for ' + surface + '/' + stage);
    else eq(advice, '', 'advice was minted with nothing proved for ' + surface + '/' + stage);
  }));
  eq(checkpointOf(null), '', 'a missing receipt minted a surface');
  eq(checkpointOf({ navSurface: 'unmeasured', navStage: 'request' }), '', 'an unmeasured probe was stored as a measurement');
  eq(checkpointOf({ navSurface: 'unmeasured', navStage: 'selected-day-re-render' }), 'control-visible',
    'the post-control stage alone stopped proving a control was found');
  console.log('  4. the receipt and the durable checkpoint carry closed codes only, and the card can never disagree with the receipt');
}

/* =======================================================================
 * (5) THE DURABLE MONTH CARD, from the shipped range job.
 * ===================================================================== */
function proveTheDurableCardSaysTheCure() {
  const slices = [
    balanced(RANGE, 'var EMPTY_REASONS = {', 'EMPTY_REASONS') + ';',
    balanced(RANGE, 'var NAV_SURFACE_CODES = {', 'NAV_SURFACE_CODES') + ';',
    balanced(RANGE, 'function navSurfaceShape(raw)', 'navSurfaceShape'),
    balanced(RANGE, 'var NAV_SURFACE_REASONS = {', 'NAV_SURFACE_REASONS') + ';',
    balanced(RANGE, 'var NAV_SURFACE_COPY = {', 'NAV_SURFACE_COPY') + ';',
    balanced(RANGE, 'function copy(value)', 'copy'),
    balanced(RANGE, 'function summarize(manifest)', 'summarize'),
    balanced(RANGE, 'function uiAttentionCopy(manifest)', 'uiAttentionCopy')
  ].join('\n');
  const sandbox = { console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } } };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'navhome-range-slices.js' });
  const card = days => {
    sandbox.__m = { months: { '2026-08': { status: 'needs-attention', days: days } } };
    sandbox.__m.summary = vm.runInContext('summarize(__m)', ctx);
    return { copy: vm.runInContext('uiAttentionCopy(__m)', ctx), summary: sandbox.__m.summary };
  };

  /* THE LIVE SHAPE: one nav-failed day at the cap, surface proved. */
  const stuck = card({ '2026-08-06': { status: 'needs-attention', reason: 'nav-failed', attempts: 3, navSurface: 'control-visible' } });
  eq(stuck.summary.attention.length, 1, 'the attention row for the stuck day was lost');
  eq(stuck.summary.attention[0].navSurface, 'control-visible', 'the summary row lost the closed surface code');
  deep(Object.keys(stuck.summary.attention[0]).sort(), ['date', 'missing', 'navSurface', 'reason'],
    'the attention row grew a field outside its bounded contract');
  ok(/2026-08-06 \(nav failed\)/.test(stuck.copy), 'the card stopped naming the stuck date: ' + stuck.copy);
  ok(/Calendar > View Calendar/.test(stuck.copy), 'the month card still does not say the two clicks that cure it: ' + stuck.copy);
  ok(/not the dashboard/.test(stuck.copy), 'the month card does not say which screen to leave: ' + stuck.copy);

  /* the same day with NOTHING proved keeps exactly the copy it had */
  const bare = card({ '2026-08-06': { status: 'needs-attention', reason: 'nav-failed', attempts: 3 } });
  eq(bare.summary.attention[0].navSurface, undefined, 'an unproved day minted a surface code');
  deep(Object.keys(bare.summary.attention[0]).sort(), ['date', 'missing', 'reason'],
    'a day with nothing proved no longer writes the exact receipt row every earlier build wrote');
  ok(!/View Calendar/.test(bare.copy), 'a day with nothing proved was given the cure sentence anyway: ' + bare.copy);

  /* a garbage stored code is dropped, never rendered */
  const junk = card({ '2026-08-06': { status: 'needs-attention', reason: 'nav-failed', attempts: 3, navSurface: '<img onerror=1>' } });
  eq(junk.summary.attention[0].navSurface, undefined, 'a garbage stored surface code survived sanitisation');
  ok(!/View Calendar|img/.test(junk.copy), 'a garbage stored surface code reached the card: ' + junk.copy);

  /* the sentence belongs to the nav classes only, and is said ONCE */
  const other = card({ '2026-08-12': { status: 'needs-attention', reason: 'history-partial', attempts: 3, navSurface: 'control-visible' } });
  ok(!/View Calendar/.test(other.copy), 'a non-nav attention day was given navigation advice: ' + other.copy);
  const many = card({
    '2026-08-06': { status: 'needs-attention', reason: 'nav-failed', attempts: 3, navSurface: 'control-visible' },
    '2026-08-07': { status: 'needs-attention', reason: 'nav-failed', attempts: 3, navSurface: 'control-visible' },
    '2026-08-10': { status: 'needs-attention', reason: 'wrong-day', attempts: 3, navSurface: 'no-control' }
  });
  eq((many.copy.match(/View Calendar/g) || []).length, 1, 'the cure sentence is repeated once per day instead of once per card');

  /* the durable day record: written on a nav refusal, dropped once the day
     completes, and never invented for a manifest written before navhome */
  const dayRecord = raw => {
    sandbox.__raw = raw;
    return vm.runInContext('navSurfaceShape(__raw)', ctx);
  };
  eq(dayRecord('control-visible'), 'control-visible', 'a stored surface code was not read back');
  eq(dayRecord('CONTROL-VISIBLE'), 'control-visible', 'a stored code stopped being normalised');
  eq(dayRecord(undefined), '', 'an absent stored code minted a value');
  eq(dayRecord({ toString() { return 'control-visible'; } }), 'control-visible', 'an object code was not coerced through the closed set');
  eq(dayRecord('nav-failed'), '', 'a reason code was accepted as a surface code');
  console.log('  5. the durable month card names the cure once, only for the nav classes, and only on a proved closed code');
}

(async () => {
  console.log('nav-home-proof: navhome-1.0.0, measured on the August month job 2026-09-02 05:5x');
  proveTheZerosAreAnAbsence();
  await proveTheOneBoundedProbe();
  await proveItNeverLoopsAndNeverDrives();
  await proveTheSeamIsClosedAndPhiFree();
  proveTheDurableCardSaysTheCure();
  console.log('nav-home-proof PASS (' + checks + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });

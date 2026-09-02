'use strict';

/* residue-1.0.0 (b1189) - A CHART MLS OPENED IS NEVER A CHART TO FOLLOW.
 *
 * MEASURED live 2026-09-01 on the owner's tab (b1188), six or more times in
 * one evening, WITH dnote-1.1.0's follow guard already shipped: the active
 * patient kept flipping to a patient he never chose, and one note generation
 * aborted with "source-changed: the patient or visit source changed while MLS
 * was generating".
 *
 * THE SEQUENCE, every time:
 *   1. an MLS background reader (the notes-idle catch-up - "Visit notes for
 *      Sep 1 - 9 of 15 read - paused while you work" - or the day-history
 *      pull) opens patient X's chart in athenaOne to read it;
 *   2. it finishes and leaves athenaOne PARKED on X. A reader never navigates
 *      back, and nothing else moves the athena tab;
 *   3. minutes later nothing is running: __mlsPullBusyAt is stale, every
 *      "am I driving" predicate honestly answers no;
 *   4. the doctor clicks the MLS tab. Follow's LEG B (feat_mls_athena_follow,
 *      af-1.0.0) asks the extension which chart is open, hears X, resolves X
 *      locally and calls setActivePtId(X): "Following athenaOne: X".
 *
 * dnote-1.1.0 covers step 1-2 (WHILE MLS drives, a follow reply is muted). It
 * cannot cover step 3-4, which is the RESIDUE - and the residue is the flip
 * the owner actually watched.
 *
 * THE RULE PINNED HERE (residue-1.0.0): a chart MLS itself opened in athenaOne
 * is never something Follow adopts.
 *   - the engine records the identity it is about to open, in memory only
 *     (window.__mlsDrivenChartResidue), at EVERY door through which an
 *     MLS-driven lane opens a chart;
 *   - the app-side guard swallows a Follow reply naming that person whether or
 *     not a lane is still running;
 *   - a DIFFERENT person on screen is the doctor's own navigation: the residue
 *     is retired and the reply passes, so Follow keeps working;
 *   - the doctor choosing another patient in MLS retires it too;
 *   - it never expires on a clock, because a parked chart does not either.
 *
 * Everything below EXECUTES the shipped source (lifted by the day-note-proof
 * brace walker). No Athena account, no backend, no PHI. */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const IMPORTER = fs.readFileSync('1p-feat_mls_schedimport_exact.js', 'utf8');
const CONNECT = fs.readFileSync('1p-mls-connect.js', 'utf8');
const FOLLOW = fs.readFileSync('feat_mls_athena_follow.js', 'utf8');

let checks = 0;
function ok(cond, message) { checks++; assert.ok(cond, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }

/* ---- the extractors, verbatim from tests/day-note-proof.js ----------------
   comments are recognised BEFORE quotes, because every doctor-facing block in
   these files is documented in prose full of apostrophes. */
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

/* a localStorage that FAILS the suite if the residue is ever written to it -
   the identity it holds is PHI and lives in memory for the tab's life only. */
function forbiddenStorage(what) {
  const boom = () => { throw new Error(what + ' touched localStorage - the residue is memory-only PHI'); };
  return { getItem: boom, setItem: boom, removeItem: boom, key: boom, clear: boom };
}

/* =======================================================================
 * PART A - the stamp itself, executed.
 * ===================================================================== */
function partAStamp() {
  const slice = [
    statement(IMPORTER, 'var DNOTE_RESIDUE_VERSION =', 'DNOTE_RESIDUE_VERSION'),
    balanced(IMPORTER, 'function dnoteResidueStamp(lane, who, dob)', 'dnoteResidueStamp'),
    balanced(IMPORTER, 'function dnoteResidueClear()', 'dnoteResidueClear'),
    balanced(IMPORTER, 'function dnoteResidueReceipt()', 'dnoteResidueReceipt'),
    statement(IMPORTER, 'safe(function () { window.__mlsDrivenChartResidueClear = dnoteResidueClear; });', 'residue-clear export')
  ].join('\n');

  const win = { localStorage: forbiddenStorage('the residue stamp') };
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    isFn(v) { return typeof v === 'function'; },
    window: win
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slice, ctx, { filename: 'residue-stamp.js' });
  const run = expr => vm.runInContext(expr, ctx);

  eq(run('DNOTE_RESIDUE_VERSION'), 'residue-1.0.0', 'the residue rule is not named residue-1.0.0');
  eq(typeof win.__mlsDrivenChartResidueClear, 'function',
    'window.__mlsDrivenChartResidueClear is not exposed, so nothing outside the engine can retire a residue');

  /* a patient record */
  eq(run('dnoteResidueStamp("notes-idle", { name: "Adam Everyman", dob: "1975-04-02", id: "p1" })'), true,
    'stamping a driven chart open from a patient record failed');
  eq(win.__mlsDrivenChartResidue.name, 'Adam Everyman', 'the residue does not carry the opened chart\'s name');
  eq(win.__mlsDrivenChartResidue.dob, '1975-04-02', 'the residue does not carry the opened chart\'s DOB');
  eq(win.__mlsDrivenChartResidue.lane, 'notes-idle', 'the residue does not name the lane that opened the chart');
  ok(win.__mlsDrivenChartResidue.at > 0, 'the residue carries no stamp time');
  ok(!('id' in win.__mlsDrivenChartResidue),
    'the residue carries more of the patient record than the identity it needs');

  /* a bare name (the identity bootstrap has no DOB yet - that is what it is
     reading FOR) still stamps, with an empty DOB. */
  eq(run('dnoteResidueStamp("identity-proof", "  Barbara Q. Public  ")'), true, 'a name-only driven open did not stamp');
  eq(win.__mlsDrivenChartResidue.name, 'Barbara Q. Public', 'the name-only residue is not trimmed to the name');
  eq(win.__mlsDrivenChartResidue.dob, '', 'a name-only residue invented a DOB');

  /* nothing to name = nothing to remember (never a residue that matches every
     nameless reply). */
  const before = win.__mlsDrivenChartResidue;
  eq(run('dnoteResidueStamp("day-note", { name: "   " })'), false, 'a nameless driven open stamped a residue');
  eq(win.__mlsDrivenChartResidue, before, 'a nameless driven open overwrote the real residue');
  eq(run('dnoteResidueStamp("day-note", null)'), false, 'a missing patient stamped a residue');

  /* the receipt is PHI-free */
  const receipt = run('dnoteResidueReceipt()');
  eq(receipt.present, true, 'the receipt does not report a parked chart');
  eq(receipt.lane, 'identity-proof', 'the receipt does not name the lane that parked the chart');
  ok(!('name' in receipt) && !('dob' in receipt) && !JSON.stringify(receipt).includes('Barbara'),
    'the residue receipt carries PHI');

  /* and it is retired on demand */
  eq(run('window.__mlsDrivenChartResidueClear()'), true, 'the exported clear did not report success');
  eq(win.__mlsDrivenChartResidue, null, 'the exported clear left the residue in place');
  eq(run('dnoteResidueReceipt().present'), false, 'a cleared residue still reports a parked chart');

  console.log('  A. the engine records WHOSE chart it is about to open - in memory, PHI-free on every receipt, retired on demand');
}

/* =======================================================================
 * PART B - the census of driven-open doors. An unstamped door is the whole
 * defect, so the count is FROZEN: adding a lane that opens a chart without a
 * residue stamp fails here, by name.
 * ===================================================================== */
function partBEveryDoorIsStamped() {
  /* every call site, excluding the definition itself */
  const sites = [];
  IMPORTER.split('\n').forEach((line, i) => {
    if (line.indexOf('function dnoteResidueStamp(') >= 0) return;
    const m = line.match(/dnoteResidueStamp\(\s*"([a-z-]+)"/);
    if (m) sites.push({ lane: m[1], line: i + 1, text: line.trim() });
  });

  /* THE FROZEN CENSUS. Five doors, one lane name each:
       identity-proof  - the schedule identity bootstrap (mlsAppReadChart)
       day-pull-chart  - the managed pull's history/visits chart read
       day-note        - the managed pull's day-note leg (incl. the off-pass
                         tail round that runs AFTER the pull's Done)
       deferred-round  - the immediate _tnDefer retry round
       notes-idle      - the background catch-up, the lane the owner watched
     The drain has no door of its own: it spends the deferred round and
     notes-idle, which stamp for it. */
  const EXPECTED = ['identity-proof', 'day-pull-chart', 'day-note', 'deferred-round', 'notes-idle'];
  eq(sites.length, EXPECTED.length,
    'the number of MLS-driven chart-open sites changed (' + sites.length + ' found, ' + EXPECTED.length +
    ' pinned: ' + sites.map(s => s.lane + '@' + s.line).join(', ') +
    ') - a door that opens a chart WITHOUT a residue stamp is the 2026-09-01 flip');
  eq(sites.map(s => s.lane).sort().join(','), EXPECTED.slice().sort().join(','),
    'the driven-open lanes are not the five pinned ones');

  /* each door is where it claims to be */
  ok(/dnoteResidueStamp\("identity-proof", String\(row\.name \|\| ""\)\);\s*\n\s*var opened = await bridge\("mlsAppChartResult", "mlsAppReadChart"/.test(IMPORTER),
    'the schedule identity bootstrap opens a chart without recording whose');
  ok(/function dnReadChart\(target, say, opts\)[\s\S]{0,600}?dnoteResidueStamp\("day-pull-chart", target\);[\s\S]{0,200}?window\._assistReadChart/.test(IMPORTER),
    'the managed pull\'s history chart read opens a chart without recording whose');
  ok(/function tnBoundedRead\(vp, p, day, opts\)[\s\S]{0,600}?dnoteResidueStamp\("day-note", p\);/.test(IMPORTER),
    'the day-note leg opens a chart without recording whose');
  ok(/safe\(dnoteStampDriving\);[\s\S]{0,400}?dnoteResidueStamp\("deferred-round", patientById\(item\.patientId\)\);/.test(IMPORTER),
    'the immediate deferred round opens a chart without recording whose');
  ok(/dnoteResidueStamp\("notes-idle", patientById\(row\.p\)\);[\s\S]{0,400}?dnoteStampDriving\(\);\s*\n\s*_ni\.state = "reading";/.test(IMPORTER),
    'the notes-idle catch-up - the lane the owner watched - opens a chart without recording whose');

  /* the residue is never persisted anywhere */
  const engineBlock = IMPORTER.slice(IMPORTER.indexOf('var DNOTE_RESIDUE_VERSION ='),
    IMPORTER.indexOf('/* ===== end residue-1.0.0'));
  ok(engineBlock.length > 200, 'the residue-1.0.0 engine block moved');
  ok(!/localStorage|sessionStorage|indexedDB|console\.(log|warn|error)/.test(engineBlock),
    'the residue block persists or logs the identity it holds');

  /* ---- one door, EXECUTED: the managed pull's chart read ---------------- */
  const doorSlice = [
    balanced(IMPORTER, 'function dnoteResidueStamp(lane, who, dob)', 'dnoteResidueStamp'),
    balanced(IMPORTER, 'function dnReadChart(target, say, opts)', 'dnReadChart'),
    statement(IMPORTER, 'dnoteResidueStamp("notes-idle", patientById(row.p));', 'notes-idle stamp')
  ].join('\n');
  const win = { localStorage: forbiddenStorage('a driven chart open'), _assistReadChart: () => 'read' };
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    window: win, receipt: {}, row: { p: 'p7', d: '2026-09-01' },
    patientById(id) { return id === 'p7' ? { id: 'p7', name: 'Carla Ruiz', dob: '02/14/1968' } : null; }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(doorSlice, ctx, { filename: 'residue-doors.js' });
  eq(vm.runInContext('dnReadChart({ patientId: "p3", name: "Dana Wu", dob: "1980-01-09" }, function () {}, {})', ctx), 'read',
    'the stamped chart-read door no longer delegates to the shipped reader');
  eq(win.__mlsDrivenChartResidue.name, 'Dana Wu', 'the managed pull\'s chart read left no residue');
  eq(win.__mlsDrivenChartResidue.lane, 'day-pull-chart', 'the managed pull\'s chart read mislabelled its lane');
  eq(sandbox.receipt.chartOpensHistory, 1, 'the stamped door stopped counting chart opens');
  vm.runInContext('dnoteResidueStamp("notes-idle", patientById(row.p));', ctx);
  eq(win.__mlsDrivenChartResidue.name, 'Carla Ruiz', 'the notes-idle stamp does not resolve the row\'s patient');
  eq(win.__mlsDrivenChartResidue.dob, '02/14/1968', 'the notes-idle stamp drops the DOB the comparison needs');
  eq(win.__mlsDrivenChartResidue.lane, 'notes-idle', 'the notes-idle stamp mislabelled its lane');

  console.log('  B. all five doors through which MLS opens a chart record whose - the count is frozen, and two of them are executed');
}

/* =======================================================================
 * PART C - the guard, executed against real event dispatches.
 * ===================================================================== */
function guardContext(options) {
  options = options || {};
  const guardFrom = CONNECT.indexOf("  var VERSION = 'dnote-1.1.0';");
  const guardTo = CONNECT.indexOf("  try { window.addEventListener('message', onMessage, true); }", guardFrom);
  assert(guardFrom > 0 && guardTo > guardFrom, 'the follow guard block moved');
  const guardSrc = CONNECT.slice(guardFrom, guardTo);

  const listeners = [];
  const active = { pid: 'doctors-own-patient' };
  let drivingBy = options.drivingBy || '';
  const win = {
    localStorage: forbiddenStorage('the follow guard'),
    __mlsAthenaDrivenByMls: () => ({ driving: drivingBy !== '', by: drivingBy }),
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture: capture === true }); },
    removeEventListener() {}
  };
  if (options.residue) win.__mlsDrivenChartResidue = options.residue;
  if (options.roster) {
    win.findPatient = id => options.roster.filter(p => String(p.id) === String(id))[0] || null;
  }
  if (options.followModule) win.__mlsAthenaFollow = options.followModule;

  const sandbox = { console, JSON, Math, Object, String, Number, Boolean, Date, window: win, active };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(guardSrc, ctx, { filename: 'follow-guard.js' });
  /* the guard registers itself exactly as the shipped module does */
  vm.runInContext("window.addEventListener('message', onMessage, true);", ctx);
  vm.runInContext("window.addEventListener('mls:active-patient-changed', onActiveChanged);", ctx);

  /* af-1.0.0's LEG B in miniature: a NON-capturing message listener that makes
     the chart's patient active. */
  const legB = { fired: 0, saw: null };
  win.addEventListener('message', ev => {
    legB.fired++;
    legB.saw = ev.data && ev.data.identity;
    active.pid = 'chart-athena-has-open';
  }, false);

  function dispatchMessage(requestId, identity) {
    let stopped = false;
    const ev = {
      data: { source: 'mls-ext', type: 'mlsAppChartIdentityResult', requestId, ok: true, identity },
      stopImmediatePropagation() { stopped = true; }
    };
    /* the DOM order the guard depends on: capture listeners run first. */
    const ordered = listeners.filter(l => l.type === 'message' && l.capture)
      .concat(listeners.filter(l => l.type === 'message' && !l.capture));
    for (const l of ordered) { l.fn(ev); if (stopped) break; }
    return stopped;
  }
  function dispatchActive(patientId) {
    listeners.filter(l => l.type === 'mls:active-patient-changed')
      .forEach(l => l.fn({ type: 'mls:active-patient-changed', detail: { patientId } }));
  }
  return {
    ctx, win, legB, active, dispatchMessage, dispatchActive,
    drive(by) { drivingBy = by; },
    residue() { return win.__mlsDrivenChartResidue || null; },
    stats() { return vm.runInContext('stats', ctx); },
    run: expr => vm.runInContext(expr, ctx)
  };
}

const PARKED = { name: 'Adam Everyman', dob: '1975-04-02', at: Date.now() - 120000, lane: 'notes-idle' };
const SAME = { name: 'Everyman, Adam', dob: '04/02/1975' };   /* athena's banner spelling */
const OTHER = { name: 'Grace Hopper', dob: '1906-12-09' };

function partCTheResidueIsNeverFollowed() {
  /* (1) THE 2026-09-01 FLIP. Nothing is driving - the read finished minutes
         ago - and the chart it parked is still open. Follow may not adopt it. */
  const parked = guardContext({ residue: Object.assign({}, PARKED) });
  eq(parked.dispatchMessage('af1zzz0', SAME), true,
    'the chart MLS left parked in athenaOne reached the follow lane once the lane went quiet - the 2026-09-01 flip');
  eq(parked.legB.fired, 0, 'the follow lane acted on a chart MLS itself had opened');
  eq(parked.active.pid, 'doctors-own-patient',
    'MLS\'s own leftover chart switched the doctor\'s active patient after the read had finished');
  eq(parked.stats().residueMuted, 1, 'the PHI-free residueMuted counter did not record the refusal');
  ok(parked.residue(), 'a muted residue was retired - the chart is still parked, so it must survive');

  /* the tolerant comparison is the point: athena prints "Everyman, Adam" and
     "04/02/1975" for the record MLS holds as "Adam Everyman" / "1975-04-02". */
  const strict = guardContext({ residue: Object.assign({}, PARKED) });
  eq(strict.dispatchMessage('af1zzz1', { name: 'ADAM  EVERYMAN', dob: '4/2/1975' }), true,
    'a spelling difference in athena\'s banner defeated the residue comparison');

  /* a residue with no DOB (the identity bootstrap) still matches on the name -
     exactly the rule Follow itself uses when one side has no DOB. */
  const noDob = guardContext({ residue: { name: 'Adam Everyman', dob: '', at: Date.now(), lane: 'identity-proof' } });
  eq(noDob.dispatchMessage('af1zzz2', SAME), true, 'a DOB-less residue failed to protect the chart it parked');

  /* (2) A DIFFERENT PERSON is the doctor's own navigation. Follow must work. */
  const byHand = guardContext({ residue: Object.assign({}, PARKED) });
  eq(byHand.dispatchMessage('af1zzz3', OTHER), false,
    'the guard swallowed a chart the doctor opened by hand while a stale residue was held');
  eq(byHand.legB.fired, 1, 'the follow lane never heard about the doctor\'s own chart');
  eq(byHand.active.pid, 'chart-athena-has-open', 'Follow stopped working once a residue existed');
  eq(byHand.residue(), null, 'a chart the doctor navigated to did not retire the residue');
  eq(byHand.stats().residueCleared, 1, 'retiring the residue was not counted');
  /* and it stays retired: the same patient may now be followed */
  eq(byHand.dispatchMessage('af1zzz4', SAME), false,
    'the retired residue still muted a later reply - the residue outlived the chart it described');

  /* a same-name different-DOB reply is a DIFFERENT person, and is let through */
  const twin = guardContext({ residue: Object.assign({}, PARKED) });
  eq(twin.dispatchMessage('af1zzz5', { name: 'Adam Everyman', dob: '1991-08-30' }), false,
    'two people who share a name were treated as one by the residue comparison');
  eq(twin.residue(), null, 'a proven-different person did not retire the residue');

  /* (3) no residue at all: the shipped behaviour is untouched. */
  const clean = guardContext({});
  eq(clean.dispatchMessage('af1zzz6', SAME), false, 'the guard refused a follow with no residue to refuse it for');
  eq(clean.legB.fired, 1, 'Follow stopped working when nothing had been parked');

  /* (4) WHILE DRIVING: unchanged - every af reply is muted - and the residue
         is refreshed from whatever chart MLS actually landed on. */
  const driving = guardContext({ drivingBy: 'notes-idle', residue: Object.assign({}, PARKED) });
  eq(driving.dispatchMessage('af1zzz7', OTHER), true,
    'a chart-identity answer produced by MLS\'s own driving reached the follow lane');
  eq(driving.legB.fired, 0, 'the follow lane acted on a chart MLS opened itself');
  eq(driving.stats().drivingMuted, 1, 'the driving refusal was not counted');
  eq(driving.residue().name, 'Grace Hopper', 'the residue was not refreshed to the chart MLS actually landed on');
  eq(driving.residue().lane, 'notes-idle', 'the refreshed residue does not name the lane that was driving');
  /* the write lane's own read is not the follow lane's, so it is never muted -
     but it IS the truest statement of where MLS drove the tab. */
  const writer = guardContext({ drivingBy: 'write-lane' });
  eq(writer.dispatchMessage('wf-9911', SAME), false,
    'the guard swallowed a chart-identity answer that was not the follow lane\'s');
  eq(writer.legB.fired, 1, 'a non-follow reader was starved of its own reply');
  eq(writer.residue().name, 'Everyman, Adam', 'a non-follow reply while driving did not refresh the residue');
  eq(writer.residue().lane, 'write-lane', 'the refreshed residue does not name the driving lane');

  /* (5) a NON-follow reply is never muted when nothing is driving, and it
         never touches the residue either - only Follow is scoped by it. */
  const other = guardContext({ residue: Object.assign({}, PARKED) });
  eq(other.dispatchMessage('wf-2201', SAME), false,
    'a reader that is not the follow lane was muted by the residue');
  eq(other.legB.fired, 1, 'a non-follow reader was starved of its own reply');
  ok(other.residue() && other.residue().lane === 'notes-idle',
    'a non-follow reply retired or rewrote the residue while nothing was driving');
  eq(other.stats().residueMuted, 0, 'a non-follow reply was counted as a residue refusal');

  console.log('  C. a parked chart is never followed, whether or not a lane is still running; a different chart retires it and Follow works');
}

/* =======================================================================
 * PART D - the doctor's own choice in MLS retires the residue.
 * ===================================================================== */
function partDTheDoctorRetiresIt() {
  const roster = [
    { id: 'p-adam', name: 'Adam Everyman', dob: '1975-04-02' },
    { id: 'p-grace', name: 'Grace Hopper', dob: '1906-12-09' }
  ];

  /* the roster click / the up-now "Switch" offer: a different person becomes
     active while MLS is idle, so the parked chart is no longer interesting. */
  const picked = guardContext({ residue: Object.assign({}, PARKED), roster });
  picked.dispatchActive('p-grace');
  eq(picked.residue(), null, 'the doctor choosing another patient in MLS did not retire the residue');
  eq(picked.dispatchMessage('af1yyy0', SAME), false,
    'Follow was still muted for a chart whose residue the doctor had retired');

  /* choosing the residue's OWN patient changes nothing - the chart parked in
     athenaOne is still the one MLS opened. */
  const same = guardContext({ residue: Object.assign({}, PARKED), roster });
  same.dispatchActive('p-adam');
  ok(same.residue(), 'selecting the same person retired the residue that still describes the open chart');
  eq(same.dispatchMessage('af1yyy1', SAME), true, 'the residue stopped protecting its chart');

  /* an active-patient change MLS itself caused (a driving lane, or Leg B's own
     write) is not the doctor's choice and retires nothing. */
  const driven = guardContext({ drivingBy: 'day-pull', residue: Object.assign({}, PARKED), roster });
  driven.dispatchActive('p-grace');
  ok(driven.residue(), 'an active-patient change made while MLS was driving retired the residue');

  /* an id nothing can resolve says nothing about the residue: fail closed
     toward the doctor's chosen patient, never toward a silent switch. */
  const unknown = guardContext({ residue: Object.assign({}, PARKED), roster });
  unknown.dispatchActive('p-nobody');
  ok(unknown.residue(), 'an unresolvable patient id retired the residue on a guess');

  console.log('  D. the doctor picking another patient in MLS retires the residue; MLS\'s own switch never does');
}

/* =======================================================================
 * PART E - one definition of "the same person", and the wiring that makes
 * the whole rule reachable in the shipped page.
 * ===================================================================== */
function partEOneComparator() {
  /* af-1.0.0 exports its comparator, and the guard prefers it - so a change to
     Follow's own identity math can never leave the guard behind. */
  ok(/_samePerson: samePerson/.test(FOLLOW),
    'the follow module no longer exports the comparator the guard reuses');
  ok(/var rid = 'af' \+ Date\.now\(\)\.toString\(36\)/.test(FOLLOW),
    'the follow lane no longer mints an "af"-prefixed request id, so the guard would stop nothing');
  ok(/window\.addEventListener\('mls:active-patient-changed', onActiveChanged\)/.test(FOLLOW),
    'the follow module no longer listens to the active-patient event the guard hooks for its own clearing');

  let asked = 0;
  const spy = guardContext({
    residue: Object.assign({}, PARKED),
    followModule: { _samePerson() { asked++; return false; } }
  });
  eq(spy.dispatchMessage('af1www0', SAME), false, 'the guard ignored the follow module\'s own verdict');
  eq(asked > 0, true, 'the guard did not consult af-1.0.0\'s exported comparator when the module was loaded');

  /* with the module absent, the identical normalization stands in */
  const alone = guardContext({ residue: Object.assign({}, PARKED) });
  eq(alone.run("localSamePerson('Everyman, Adam', '04/02/1975', 'Adam Everyman', '1975-04-02')"), true,
    'the fallback comparator does not match the same person written two ways');
  eq(alone.run("localSamePerson('Adam Everyman', '1975-04-02', 'Adam Everyman', '1991-08-30')"), false,
    'the fallback comparator matches two people who share a name');
  eq(alone.run("localSamePerson('', '', 'Adam Everyman', '1975-04-02')"), false,
    'the fallback comparator matches a nameless identity against a real one');

  /* the shipped page really registers both listeners, and the message one in
     the CAPTURE phase - the whole mechanism depends on running first. */
  ok(/try \{ window\.addEventListener\('message', onMessage, true\); \} catch \(eG3\) \{ return; \}/.test(CONNECT),
    'the follow guard no longer registers in the CAPTURE phase, so the follow lane hears the reply first');
  ok(/window\.addEventListener\('mls:active-patient-changed', onActiveChanged\)/.test(CONNECT),
    'the follow guard never hears the doctor choose a patient, so a residue could outlive its chart');
  ok(/removeEventListener\('mls:active-patient-changed', onActiveChanged\)/.test(CONNECT),
    'revert() leaves the active-patient listener behind');
  ok(/residueVersion: RESIDUE_VERSION/.test(CONNECT) && /var RESIDUE_VERSION = 'residue-1\.0\.0';/.test(CONNECT),
    'the guard does not publish the residue rule version on its receipt');
  ok(/stats: stats/.test(CONNECT), 'the PHI-free counters are not reachable as __mlsFollowGuard.stats');

  /* the guard never expires the residue on a clock: a parked chart does not */
  const guardBlock = CONNECT.slice(CONNECT.indexOf("  var RESIDUE_VERSION = 'residue-1.0.0';"),
    CONNECT.indexOf("  window.__mlsFollowGuard = {"));
  ok(guardBlock.length > 500, 'the residue guard block moved');
  ok(!/setTimeout|setInterval|requestAnimationFrame/.test(guardBlock),
    'the residue rule grew a timer - a parked chart does not expire, so neither may the residue');
  ok(!/localStorage|sessionStorage|indexedDB/.test(guardBlock),
    'the residue guard persists the identity it compares');

  console.log('  E. one definition of "the same person" in the tab, no timer, no storage, and both listeners really registered');
}

function main() {
  console.log('residue-1.0.0 (b1189) - a chart MLS opened in athenaOne is never a chart Follow adopts');
  partAStamp();
  partBEveryDoorIsStamped();
  partCTheResidueIsNeverFollowed();
  partDTheDoctorRetiresIt();
  partEOneComparator();
  console.log('PASS follow-residue: ' + checks + ' checks - every MLS-driven chart open records whose chart it parked in athenaOne ' +
    '(five frozen doors, memory only); Follow never adopts that chart, while it is being driven OR minutes later when nothing is; ' +
    'a different chart on screen or the doctor picking another patient retires the residue and Follow works again; and a reader ' +
    'that is not Follow is never muted');
}

main();

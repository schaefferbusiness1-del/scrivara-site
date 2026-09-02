'use strict';

/* capsel-1.0.0 (b1192) - AN MLS-DRIVEN CAPTURE NEVER MOVES THE DOCTOR'S PATIENT.
 *
 * MEASURED live 2026-09-01 23:0x on the owner's tab (b1191): while the durable
 * August month pull was running, the ACTIVE PATIENT of the Visit screen changed
 * from the chart the doctor had chosen (Adam) to a row the capture itself had
 * minted - one of the "_"+digits capture twins padoptIsDebrisId() knows about,
 * carrying the assist-capture source. At that moment
 * window.__mlsAthenaDrivenByMls() answered {driving:true, by:'day-pull'} and
 * window.__mlsFollowGuard.stats showed ZERO Follow activity, so this is NOT the
 * Follow module - residue-1.0.0 already covers that one and was not even
 * consulted. The writer is the capture's OWN adopt path: it makes the row it is
 * importing "current" so its next step can find it, and the doctor's screen
 * follows the import. Earlier the same evening the same class aborted a note
 * generation with "source-changed: the patient or visit source changed while
 * MLS was generating"; to the owner it read as "the thing went away".
 *
 * THE RULE PINNED HERE (capsel-1.0.0): an MLS-driven read or capture may
 * create, merge and update patient rows, chart facts and visit records exactly
 * as before. It may not move the SELECTION. getActivePtId() comes out of every
 * driven lane exactly as it went in.
 *
 * A lane that legitimately needs the row "current" for its own bookkeeping is
 * handed the row itself: __mlsCopyVisits.run(onStatus, patientOverride) has
 * always taken an explicit patient, and the driven callers now pass it.
 *
 * TWO QUESTIONS, AND WHICH WRITER ASKS WHICH - measured, not guessed:
 *   - LANE-PRIVATE code (the bulk history lane, which no human press can
 *     reach) asks the AMBIENT question, window.__mlsAthenaDrivenByMls().
 *   - SHARED code a human can also press (both pull-chart paths, the autopull
 *     button, the add-patient Athena leg, chart autofill) asks the SCOPED
 *     question - "did MLS initiate THIS call" - answered only by an explicit
 *     capture scope. Gating those on the ambient predicate was tried and
 *     MEASURED WRONG: tests/1p-pull-one-owner-contract.test.js went red
 *     because a background visits-backfill happened to be running while the
 *     doctor pressed the pull button, and his own landing was swallowed.
 *     "Some lane is busy" is true, and irrelevant to a button.
 *
 * Everything below EXECUTES the shipped source (lifted with the brace walker
 * tests/day-note-proof.js and tests/follow-residue-proof.js use). No Athena
 * account, no backend, no PHI.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const readU = (n) => fs.readFileSync(path.join(root, n), 'utf8');
const readL = (n) => fs.readFileSync(path.join(root, n), 'latin1');

const CONNECT = readU('1p-mls-connect.js');
const AUTOPULL = readU('feat_athena_autopull.js');
const ADDPATIENT = readU('feat_addpatient.js');
const CHARTFILL = readU('feat_mls_chartautofill.js');
const SHELL_A = readL('1pScribeFlow.html');
const SHELL_B = readL(path.join('1p', 'index.html'));
const SHELL_S = readL('ScribeFlow-staging.html');

let checks = 0;
function ok(cond, message) { checks++; assert.ok(cond, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }

/* ---- the extractors, verbatim from tests/follow-residue-proof.js ----------
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
function between(source, from, to, label) {
  const a = source.indexOf(from);
  assert(a >= 0, 'slice start not found: ' + label);
  const b = source.indexOf(to, a);
  assert(b > a, 'slice end not found: ' + label);
  return source.slice(a, b + to.length);
}

/* A driving predicate under this suite's control - the same shape
   window.__mlsAthenaDrivenByMls() (dnote-1.1.0) publishes. */
function driver(lane) {
  return function () { return { version: 'dnote-1.1.0', driving: !!lane, by: lane || '', at: 1 }; };
}
/* a localStorage that FAILS the suite if the guard is ever tempted to persist
   its lane names - the counter is memory-only and PHI-free by design. */
function forbiddenStorage(what) {
  const boom = () => { throw new Error(what + ' touched localStorage - the capsel counter is memory-only'); };
  return { getItem: boom, setItem: boom, removeItem: boom, key: boom, clear: boom };
}

const GUARD_SRC = between(CONNECT,
  "  var VERSION = 'capsel-1.0.0';",
  "      try { delete window.__mlsCaptureSelection; } catch (eS6) {}\n    }\n  };",
  'the capsel-1.0.0 guard block');

/* Install the shipped guard in a fresh sandbox and hand back its window. */
function installGuard(lane) {
  const win = { localStorage: forbiddenStorage('the capsel guard') };
  if (lane !== undefined) win.__mlsAthenaDrivenByMls = driver(lane);
  const sandbox = { console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp, window: win };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(GUARD_SRC, ctx, { filename: 'capsel-guard.js' });
  return { win, ctx, run: (expr) => vm.runInContext(expr, ctx) };
}

/* =======================================================================
 * PART A - the guard itself, EXECUTED.
 * ===================================================================== */
function partATheGuard() {
  ok(GUARD_SRC.length > 800, 'the capsel-1.0.0 guard block moved or shrank out of recognition');

  /* 1. nothing driving = nothing held. The doctor's own picks are the whole
        reason this must fail open. */
  const idle = installGuard('');
  eq(idle.run("keep('roster-click')"), false, 'the guard held the selection while NOTHING was driving');
  eq(idle.win.__mlsCaptureSelectionKept.count, 0, 'an unheld selection incremented the counter');
  eq(idle.run("laneFor('roster-click')"), '', 'laneFor named a lane while nothing was driving');

  /* with no engine at all the answer is still "the doctor is in charge" */
  const bare = installGuard(undefined);
  eq(bare.run('drivingBy()'), '', 'the guard invented a driver with no lane predicate on the page');
  eq(bare.run("keep('roster-click')"), false, 'the guard held the selection with no lane predicate loaded');

  /* 1b. THE TWO QUESTIONS. A shared writer asks "did MLS initiate THIS call";
         a merely-busy background lane is not an answer, and treating it as one
         swallowed a doctor's own pull landing when it was measured. */
  const busy = installGuard('visits-backfill');
  eq(busy.run("keep('chart-pull-land', true)"), false,
    'a doctor press while a background lane runs is being held - the measured 1p-pull-one-owner red');
  eq(busy.win.__mlsCaptureSelectionKept.count, 0, 'a swallowed press was counted as a held selection');
  eq(busy.run("keep('bulk-history-adopt')"), true,
    'lane-private code stopped asking the ambient question, so a driven lane may move the selection again');

  /* 2. a driven lane = held, and the counter names the site AND the lane */
  const driven = installGuard('day-pull');
  eq(driven.run("keep('bulk-history-adopt')"), true, 'a day-pull-driven capture was allowed to move the selection');
  const k = driven.win.__mlsCaptureSelectionKept;
  eq(k.count, 1, 'the PHI-free counter did not increment on a held selection');
  eq(k.lastLane, 'bulk-history-adopt:day-pull', 'the counter does not name BOTH the call site and the driving lane');
  ok(k.at > 0, 'the counter carries no time');
  eq(driven.run("keep('bulk-history-adopt')"), true, 'a second driven write was allowed through');
  eq(driven.win.__mlsCaptureSelectionKept.count, 2, 'the counter does not count every held selection');

  /* every enumerated lane in the rule is covered by the ONE predicate */
  ['day-pull', 'month-pull', 'range-job', 'day-history-pull', 'notes-idle',
    'deferred-round', 'day-note-drain', 'patient-batch'].forEach((lane) => {
    const g = installGuard(lane);
    eq(g.run("keep('x')"), true, 'the ' + lane + ' lane was allowed to move the doctor\'s active patient');
    eq(g.win.__mlsCaptureSelectionKept.lastLane, 'x:' + lane, 'the counter mislabelled the ' + lane + ' lane');
  });

  /* 3. the capture scope answers for BOTH kinds of writer, and it answers even
        when the lane predicate has already gone quiet - an adopt that runs in
        the moments after its lane released the athena reader. */
  const scoped = installGuard('');
  eq(scoped.run("keep('autopull-terminal-land', true)"), false, 'a scoped writer held the selection with no scope open');
  eq(scoped.run("begin('autopull')"), true, 'begin() did not open a capture scope');
  eq(scoped.run('window.__mlsCaptureSelection.scoped()'), true, 'the guard does not report an open capture scope');
  eq(scoped.run("keep('autopull-terminal-land', true)"), true, 'a capture-scoped adopt moved the selection with the lane already quiet');
  eq(scoped.win.__mlsCaptureSelectionKept.lastLane, 'autopull-terminal-land:autopull', 'a scoped hold does not name its scope');
  eq(scoped.run('end()'), true, 'end() did not close the capture scope');
  eq(scoped.run("keep('autopull-terminal-land', true)"), false, 'the capture scope outlived its own end()');
  /* nesting: an inner end() may not release the outer scope */
  scoped.run("begin('outer'); begin('inner'); end();");
  eq(scoped.run("keep('x', true)"), true, 'a nested end() released the outer capture scope');
  scoped.run('end();');
  eq(scoped.run("keep('x', true)"), false, 'the outer capture scope never closed');
  /* around() closes its scope even when the body throws */
  let threw = '';
  try { scoped.run("around('boom', function () { throw new Error('body'); })"); } catch (e) { threw = String(e.message || ''); }
  eq(threw, 'body', 'around() swallowed the body\'s error');
  eq(scoped.run("keep('x', true)"), false, 'around() leaked its capture scope when the body threw');

  /* 4. the receipt is PHI-free and honest */
  const r = driven.run('window.__mlsCaptureSelection.receipt()');
  eq(r.version, 'capsel-1.0.0', 'the receipt does not name the rule');
  eq(r.drivingNow, 'day-pull', 'the receipt does not report who is driving');
  eq(r.count, 2, 'the receipt does not report how many selections were held');
  ok(!('patientId' in r) && !('name' in r) && !('dob' in r), 'the capsel receipt carries patient identity');
  ok(!/localStorage|sessionStorage|indexedDB/.test(GUARD_SRC),
    'the capsel guard persists its lane names - the counter is memory-only');
  ok(!/setTimeout|setInterval|requestAnimationFrame/.test(GUARD_SRC),
    'the capsel guard grew a timer - a driven lane is not a clock');

  /* 5. revert really unhooks */
  driven.run('window.__mlsCaptureSelection.revert()');
  eq(typeof driven.win.__mlsCaptureSelectionKeep, 'undefined', 'revert() left the exported predicate behind');

  console.log('  A. the guard answers both questions - ambient for lane-private code, scope for a writer a human can press - on a PHI-free counter');
}

/* =======================================================================
 * PART B - THE FROZEN CENSUS. An ungated writer IS the defect, so the count
 * is pinned by name: adding a capture-path writer of the active patient
 * without a gate fails here.
 * ===================================================================== */
const CENSUS = [
  { file: '1p-mls-connect.js',         site: 'bulk-history-adopt',      scopedOnly: false, src: () => CONNECT },
  { file: '1pScribeFlow.html',         site: 'chart-pull-target',       scopedOnly: true,  src: () => SHELL_A },
  { file: '1pScribeFlow.html',         site: 'chart-pull-land',         scopedOnly: true,  src: () => SHELL_A },
  { file: '1p/index.html',             site: 'chart-pull-target',       scopedOnly: true,  src: () => SHELL_B },
  { file: '1p/index.html',             site: 'chart-pull-land',         scopedOnly: true,  src: () => SHELL_B },
  { file: 'ScribeFlow-staging.html',   site: 'chart-pull-target',       scopedOnly: true,  src: () => SHELL_S },
  { file: 'feat_athena_autopull.js',   site: 'autopull-resolve-open',   scopedOnly: true,  src: () => AUTOPULL },
  { file: 'feat_athena_autopull.js',   site: 'autopull-terminal-land',  scopedOnly: true,  src: () => AUTOPULL },
  { file: 'feat_addpatient.js',        site: 'addpatient-athena-adopt', scopedOnly: true,  src: () => ADDPATIENT },
  { file: 'feat_mls_chartautofill.js', site: 'chart-autofill-link',     scopedOnly: true,  src: () => CHARTFILL }
];
/* SEVEN writers, ten gated call sites. The shell writers are counted once per
   SHELL on purpose: 1pScribeFlow.html, 1p/index.html and ScribeFlow-staging.html
   are NOT byte-identical and are edited by hand, and a hunk applied to one and
   forgotten in another is exactly how this rule would come back half-shipped.
   (The staging shell has no pullone-1.0.0 landing, so it carries one of the
   two shell gates, which is why nine names cover seven writers.) */
const WRITERS = 7;
const CALL_RE = /(?:capselKeep|_mlsCaptureKeepsSelection)\('([a-z-]+)'(, ?true)?\)/g;

function partBEveryWriterIsGated() {
  const found = [];
  CENSUS.forEach((row) => {
    const src = row.src();
    let m;
    const re = new RegExp(CALL_RE.source, 'g');
    while ((m = re.exec(src))) {
      if (m[1] !== row.site) continue;
      eq(!!m[2], row.scopedOnly,
        row.file + ':' + row.site + ' asks the WRONG question - ' +
        (row.scopedOnly
          ? 'a writer a human can press must ask the scoped question, or a background lane swallows his press'
          : 'lane-private code must ask the ambient question, or a driven lane can still move the selection'));
      found.push(row.file + ':' + row.site);
    }
  });
  eq(found.length, CENSUS.length,
    'the gated capture-path selection writers changed (' + found.length + ' found, ' + CENSUS.length +
    ' pinned: ' + found.join(', ') + ') - an UNGATED writer on the capture/adopt path is the 2026-09-01 flip');
  eq(new Set(found).size, CENSUS.length, 'two pinned gate sites collapsed onto one name');
  /* the three HTML shells are ONE writer each, applied by hand in each shell */
  eq(new Set(CENSUS.map((r) => (/\.html$/.test(r.file) ? 'shell' : r.file) + '|' + r.site)).size,
    WRITERS, 'the writer census no longer resolves to ' + WRITERS + ' distinct capture-path writers');

  /* no file grew a gate name this census does not know about */
  const known = new Set(CENSUS.map((r) => r.site));
  [['1p-mls-connect.js', CONNECT], ['feat_athena_autopull.js', AUTOPULL],
    ['feat_addpatient.js', ADDPATIENT], ['feat_mls_chartautofill.js', CHARTFILL],
    ['1pScribeFlow.html', SHELL_A], ['1p/index.html', SHELL_B],
    ['ScribeFlow-staging.html', SHELL_S]].forEach(([name, src]) => {
    let m;
    const re = new RegExp(CALL_RE.source, 'g');
    while ((m = re.exec(src))) {
      ok(known.has(m[1]), name + ' gates a call site "' + m[1] + '" that this frozen census does not name');
    }
  });

  /* the local readers are ONE reader: guard first, scope-honest second, lane
     predicate third, fail-open last. Four JS copies must agree character for
     character, or "is MLS driving" would mean four things in one tab. */
  const bodies = [
    balanced(CONNECT, 'function capselKeep(site, scopedOnly)', 'connect capselKeep'),
    balanced(AUTOPULL, 'function capselKeep(site, scopedOnly)', 'autopull capselKeep'),
    balanced(ADDPATIENT, 'function capselKeep(site, scopedOnly)', 'addpatient capselKeep'),
    balanced(CHARTFILL, 'function capselKeep(site, scopedOnly)', 'chartfill capselKeep')
  ];
  eq(new Set(bodies).size, 1, 'the four module-local capselKeep readers are not identical');
  ok(/__mlsCaptureSelectionKeep/.test(bodies[0]) && /__mlsAthenaDrivenByMls/.test(bodies[0]),
    'capselKeep does not prefer the engine guard with the lane predicate as its fallback');
  ok(/if \(scopedOnly === true\) return false;/.test(bodies[0]),
    'capselKeep\'s engine-absent fallback answers the AMBIENT question for a scoped writer - a busy lane would swallow a press');

  /* the three shells carry the SAME inlined helper */
  const helpers = [
    balanced(SHELL_A, 'function _mlsCaptureKeepsSelection(lane,scopedOnly)', 'shell A helper'),
    balanced(SHELL_B, 'function _mlsCaptureKeepsSelection(lane,scopedOnly)', 'shell B helper'),
    balanced(SHELL_S, 'function _mlsCaptureKeepsSelection(lane,scopedOnly)', 'staging helper')
  ];
  eq(new Set(helpers).size, 1, 'the shell twins carry DIFFERENT capsel helpers');
  ok(/if\(scopedOnly===true\) return false;/.test(helpers[0]),
    'the shell helper\'s engine-absent fallback answers the AMBIENT question for a button');

  /* and each shell gate appears exactly once where it belongs */
  const targetNeedle = "!_mlsCaptureKeepsSelection('chart-pull-target', true) && typeof setActivePtId==='function'";
  const landNeedle = "window._mlsCaptureKeepsSelection('chart-pull-land', true) === true; }, false)) return false;";
  [['1pScribeFlow.html', SHELL_A, 1], ['1p/index.html', SHELL_B, 1], ['ScribeFlow-staging.html', SHELL_S, 0]]
    .forEach(([name, src, lands]) => {
      eq(src.split(targetNeedle).length - 1, 1, name + ' does not gate the pull target exactly once');
      eq(src.split(landNeedle).length - 1, lands, name + ' does not gate the pulled-chart landing as pinned');
    });

  console.log('  B. ' + WRITERS + ' capture-path writers, ' + CENSUS.length + ' gated call sites, each asking the right question, one identical reader per lane');
}

/* =======================================================================
 * PART C - the shell landing, EXECUTED: the doctor always lands, even mid
 * background lane; a scoped (MLS-initiated) call does not.
 * ===================================================================== */
function shellSandbox(shell, label, lane, engineKeep) {
  const src = [
    balanced(shell, 'function _mlsCaptureKeepsSelection(lane,scopedOnly)', label + ' helper'),
    balanced(shell, '  function openPulledChart(patientId)', label + ' openPulledChart')
  ].join('\n');
  const moved = { setActive: [], views: [] };
  const win = {
    __mlsAthenaDrivenByMls: driver(lane),
    getActivePtId: () => 'doctor-chart',
    setActivePtId: (id) => { moved.setActive.push(String(id)); },
    showView: (v) => { moved.views.push(String(v)); },
    renderProfile: () => {}, renderPatients: () => {}
  };
  if (engineKeep) win.__mlsCaptureSelectionKeep = engineKeep;
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
    window: win,
    document: { body: { setAttribute: () => {} }, getElementById: () => null, querySelectorAll: () => [] },
    S: (v) => (v == null ? '' : String(v)),
    isFn: (f) => typeof f === 'function',
    safe(fn, d) { try { return fn(); } catch (e) { return d; } },
    byId: () => null,
    setTimeout: () => 0
  };
  win.window = win;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx, { filename: label + '-shell.js' });
  /* the shell declares the helper as a global function; make it reachable the
     way a classic script on the page does, through window. */
  vm.runInContext('window._mlsCaptureKeepsSelection = _mlsCaptureKeepsSelection;', ctx);
  return { win, moved, run: (expr) => vm.runInContext(expr, ctx) };
}

function partCTheShellLanding() {
  [['1pScribeFlow.html', SHELL_A], ['1p/index.html', SHELL_B]].forEach(([name, shell]) => {
    /* the doctor pressed the button with nothing running */
    const quiet = shellSandbox(shell, name + '-idle', '');
    eq(quiet.run("openPulledChart('pulled-chart')"), true, name + ': the doctor\'s own pull no longer lands on the chart');
    eq(quiet.moved.setActive.join(','), 'pulled-chart', name + ': the doctor\'s own pull did not select the pulled chart');
    ok(quiet.moved.views.indexOf('patients') >= 0, name + ': the doctor\'s own pull did not open the Patients view');

    /* THE MEASURED REGRESSION: the doctor pressed the button while a background
       visits-backfill was running. His landing must still happen. */
    const alsoBusy = shellSandbox(shell, name + '-busy', 'visits-backfill');
    eq(alsoBusy.run("openPulledChart('pulled-chart')"), true,
      name + ': a doctor press during a background lane was swallowed - the 1p-pull-one-owner red');
    eq(alsoBusy.moved.setActive.join(','), 'pulled-chart', name + ': the doctor\'s press during a background lane did not land');

    /* an MLS-INITIATED call declares itself with a capture scope, and then the
       landing is refused and NOTHING moves. */
    const held = [];
    const scopedRun = shellSandbox(shell, name + '-scoped', 'day-pull', function (site, scopedOnly) {
      held.push(site + '|' + String(scopedOnly));
      return true;
    });
    eq(scopedRun.run("openPulledChart('imported-chart')"), false, name + ': a scoped pull still reported that it landed');
    eq(scopedRun.moved.setActive.length, 0, name + ': a scoped pull moved the doctor\'s active patient');
    eq(scopedRun.moved.views.length, 0, name + ': a scoped pull yanked the doctor\'s view');
    eq(held.join(','), 'chart-pull-land|true', name + ': the landing does not ask the engine the SCOPED question');
  });

  console.log('  C. the pulled-chart landing lands for the doctor - even while a background lane runs - and refuses only for an MLS-initiated call');
}

/* =======================================================================
 * PART D - the DATA WORK still happens. Holding a selection may never cost a
 * saved row, a chart fact, or a filled field.
 * ===================================================================== */
/* an engine guard stub that says "MLS initiated this call" */
function heldEngine(record) {
  return function (site, scopedOnly) { record.push(site + '|' + String(scopedOnly)); return true; };
}

function partDTheDataStillLands() {
  /* ---- D1. the bulk history lane: the ROW travels as an argument --------- */
  const bulk = between(CONNECT, '        var bulkRow = null;', '        } catch (e) {}', 'bulk history adopt');
  ok(/bulkRow = p2;/.test(bulk),
    'the bulk history lane no longer keeps the resolved row in a local - it has nothing to hand the visit walk');
  ok(/!capselKeep\('bulk-history-adopt'\)\) window\.selectPatient\(p2\.id\)/.test(bulk),
    'the bulk history lane moves the doctor\'s active patient without asking whether MLS is driving');
  ok(CONNECT.indexOf('window.__mlsCopyVisits.run(function () {}, bulkRow || undefined)') > 0,
    'the bulk history lane does not hand __mlsCopyVisits.run the row explicitly, so holding the selection would cost the visits');
  [['', 1], ['month-pull', 0], ['day-history-pull', 0]].forEach(([lane, expectSelects]) => {
    const selected = [];
    const win = {
      getPatients: () => [{ id: 'other', name: 'Someone Else' }, { id: 'import-me', name: 'Imported Person' }],
      selectPatient: (id) => { selected.push(String(id)); },
      __mlsAthenaDrivenByMls: driver(lane)
    };
    const ctx = vm.createContext({
      console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
      window: win, target: { patientId: 'import-me' }
    });
    vm.runInContext(balanced(CONNECT, '  function capselKeep(site, scopedOnly)', 'connect capselKeep') + '\n' + bulk,
      ctx, { filename: 'bulk-adopt.js' });
    eq(vm.runInContext('bulkRow && bulkRow.id', ctx), 'import-me',
      (lane || 'the doctor') + ': the bulk lane failed to resolve the row it is importing');
    eq(selected.length, expectSelects,
      lane ? 'a ' + lane + '-driven bulk history lane moved the doctor\'s active patient'
        : 'the undriven bulk history lane stopped selecting the row');
  });

  /* ---- D2. chart autofill: the fields fill, only the LINK is held -------- */
  const fillSrc = [
    balanced(CHARTFILL, '  function capselKeep(site, scopedOnly)', 'chartfill capselKeep'),
    balanced(CHARTFILL, '  function fillInto(name, dob)', 'fillInto')
  ].join('\n');
  [[null, true], [[], false]].forEach(([record, expectLink]) => {
    const selected = [];
    const nodes = {
      heroPtName: { value: '', dispatchEvent: () => {} },
      heroPtDob: { value: '', dispatchEvent: () => {} },
      patientLabel: { value: '' }
    };
    /* the lane predicate says a background lane IS running in BOTH cases - only
       the explicit scope may hold this writer. */
    const win = { __mlsAthenaDrivenByMls: driver('notes-idle') };
    if (record) win.__mlsCaptureSelectionKeep = heldEngine(record);
    const ctx = vm.createContext({
      console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
      window: win,
      document: { getElementById: (id) => nodes[id] || null },
      Event: function (type) { this.type = type; },
      safe(fn, d) { try { return fn(); } catch (e) { return d; } },
      gid: (id) => nodes[id] || null,
      getPatients: () => [{ id: 'chart-7', name: 'Imported Person' }],
      selectPatient: (id) => { selected.push(String(id)); }
    });
    vm.runInContext(fillSrc, ctx, { filename: 'chartfill.js' });
    const filled = vm.runInContext("fillInto('Imported Person', '02/14/1968')", ctx);
    const who = expectLink ? 'the doctor' : 'an MLS-initiated read';
    eq(nodes.heroPtName.value, 'Imported Person', who + ': the chart read stopped filling the name - the DATA work must never be held');
    eq(nodes.heroPtDob.value, '02/14/1968', who + ': the chart read stopped filling the DOB');
    eq(filled.hero, true, who + ': the hero fill receipt disappeared');
    if (expectLink) {
      eq(filled.linked, true, 'a doctor chart read during a background lane no longer links the matching chart');
      eq(selected.join(','), 'chart-7', 'a doctor chart read during a background lane no longer selects the matching chart');
    } else {
      eq(selected.length, 0, 'an MLS-initiated chart read moved the doctor\'s active patient');
      eq(filled.linked, undefined, 'an MLS-initiated chart read reported a link it did not make');
      eq(filled.selectionKept, true, 'an MLS-initiated chart read did not record that it kept the selection');
      eq(record.join(','), 'chart-autofill-link|true', 'the autofill link does not ask the engine the SCOPED question');
    }
  });

  /* ---- D3. the add-patient Athena leg hands the row over ----------------- */
  ok(/if \(!capselKeep\('addpatient-athena-adopt', true\)\) selectPatient\(p\.id\);/.test(ADDPATIENT),
    'the add-patient Athena leg moves the active patient without asking whether MLS initiated the call');
  ok(ADDPATIENT.indexOf('setStatus(modal, m); }, p).then(function () {') > 0,
    'the add-patient Athena leg does not hand __mlsCopyVisits.run the patient explicitly - holding the selection would break the walk');

  /* ---- D4. autopull: the save is above the gate, the landing is inside --- */
  const resolveGate = balanced(AUTOPULL, "      if (!capselKeep('autopull-resolve-open', true))", 'autopull resolve gate');
  ok(/openPatient\(patient\.id\)/.test(resolveGate) && /selectPatient\(patient\.id\)/.test(resolveGate),
    'the autopull resolve-time selection is not inside its gate');
  const landGate = balanced(AUTOPULL, "      if (!capselKeep('autopull-terminal-land', true))", 'autopull landing gate');
  ok(/setActivePtId\(String\(patient\.id\)\)/.test(landGate) && /showView\('patients'\)/.test(landGate),
    'the autopull terminal landing is not inside its gate');
  ok(!/_saveVisits|upsertPatient|saveBatchApi/.test(resolveGate + landGate),
    'a gate swallowed autopull DATA work - the save must run whether or not the selection moves');
  const resolveAt = AUTOPULL.indexOf('      var r = resolvePatient(identity);');
  ok(resolveAt > 0 && resolveAt < AUTOPULL.indexOf("if (!capselKeep('autopull-resolve-open', true))"),
    'resolvePatient() moved inside the selection gate - a held pull would stop creating the row');
  ok(AUTOPULL.indexOf('cv._saveVisits(patient, identity, visits') > 0,
    'the autopull visit save no longer takes the patient explicitly');
  [[null, 1], [[], 0]].forEach(([record, expectMoves]) => {
    const moves = [];
    /* again: a background lane is running in BOTH cases */
    const win = { __mlsAthenaDrivenByMls: driver('range-job') };
    if (record) win.__mlsCaptureSelectionKeep = heldEngine(record);
    const ctx = vm.createContext({
      console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
      window: win, patient: { id: 'imported-7' },
      document: { getElementById: () => null },
      openPatient: (id) => { moves.push('open:' + id); },
      selectPatient: (id) => { moves.push('select:' + id); },
      setActivePtId: (id) => { moves.push('active:' + id); },
      showView: (v) => { moves.push('view:' + v); },
      renderPatients: () => {}, renderProfile: () => {}
    });
    vm.runInContext(balanced(AUTOPULL, '  function capselKeep(site, scopedOnly)', 'autopull capselKeep'), ctx);
    vm.runInContext(resolveGate, ctx, { filename: 'autopull-resolve.js' });
    vm.runInContext(landGate, ctx, { filename: 'autopull-land.js' });
    if (expectMoves) {
      eq(moves.join(','), 'open:imported-7,active:imported-7,view:patients',
        'a doctor autopull during a background lane no longer opens and lands on the patient it saved');
    } else {
      eq(moves.length, 0, 'an MLS-initiated autopull moved the doctor\'s active patient or his view');
      eq(record.join(','), 'autopull-resolve-open|true,autopull-terminal-land|true',
        'the autopull gates do not ask the engine the SCOPED question');
    }
  });

  console.log('  D. every gated writer still does its DATA work - rows resolved, fields filled, visits handed over by argument');
}

/* =======================================================================
 * PART E - the doctor is never guarded against himself, and the rule reaches
 * the derived lanes.
 * ===================================================================== */
function partETheDoctorStillSwitches() {
  /* the doctor's own switch doors are NOT gated - a gate there would be the
     opposite bug, a doctor who cannot change patients. */
  [
    ['feat_mls_upnow_activeselect.js', 'the up-now "Switch" offer'],
    ['feat_mls_patientpick.js', 'the patient picker'],
    ['feat_mls_recentpts.js', 'the recent-patients switcher'],
    ['feat_patient_switcher.js', 'the patient switcher'],
    ['feat_patient_quicksearch.js', 'patient quick search'],
    /* the merge survivor-follow is NOT a capture adopt: it moves the pointer
       only when the doctor's OWN chart was absorbed, and holding it would
       strand him on a dead id - the defect it was shipped to cure. */
    ['feat_mls_patient_merge.js', 'the merge survivor-follow']
  ].forEach(([name, what]) => {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return;
    ok(!/capselKeep|_mlsCaptureKeepsSelection/.test(fs.readFileSync(file, 'utf8')),
      what + ' grew a capsel gate - the doctor\'s own picks must switch exactly as before');
  });

  /* the derived lanes carry the same rule, or production ships without it */
  [['mls-connect.js', 'production'], ['cloned-mls-connect.js', '/cloned']].forEach(([name, lane]) => {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return;
    const src = fs.readFileSync(file, 'utf8');
    ok(/var VERSION = 'capsel-1\.0\.0';/.test(src), lane + ' has no capsel-1.0.0 guard - re-run the derive scripts');
    ok(/!capselKeep\('bulk-history-adopt'\)/.test(src), lane + ' ships the bulk history lane UNGATED');
  });
  [['ScribeFlow.html', 'production'], [path.join('cloned', 'index.html'), '/cloned']].forEach(([name, lane]) => {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return;
    const src = fs.readFileSync(file, 'latin1');
    ok(/function _mlsCaptureKeepsSelection\(lane,scopedOnly\)/.test(src), lane + ' shell has no capsel helper - re-run the derive scripts');
    ok(src.indexOf("_mlsCaptureKeepsSelection('chart-pull-target', true)") > 0 &&
       src.indexOf("_mlsCaptureKeepsSelection('chart-pull-land', true)") > 0,
    lane + ' shell ships a pull path that an MLS-initiated call can still use to move the doctor\'s patient');
  });

  console.log('  E. the doctor\'s own switch doors are untouched, and both derived lanes carry the rule');
}

function main() {
  console.log('capsel-1.0.0 (b1192) - an MLS-driven read or capture never changes the doctor\'s active patient');
  partATheGuard();
  partBEveryWriterIsGated();
  partCTheShellLanding();
  partDTheDataStillLands();
  partETheDoctorStillSwitches();
  console.log('PASS capture-keeps-selection: ' + checks + ' checks - ' + WRITERS + ' frozen capture-path writers of the active ' +
    'patient are gated, lane-private code on the ambient driving predicate and every writer a human can press on an explicit ' +
    'capture scope; a held call keeps every row, chart fact and filled field it was already saving and skips ONLY the selection ' +
    'change, on a PHI-free counter naming the site and the lane; a doctor press still lands even while a background lane runs; ' +
    'and all three shells plus both derived lanes carry it');
}

main();

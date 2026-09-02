'use strict';

/* f16ctx-1.1.0 — RUNTIME contract for the F16 #contextBox janitor.
 *
 * MEASURED 2026-09-02 10:xx. F16 latches the active patient id at install and,
 * every 2500 ms, clears #contextBox the first tick after getActivePtId()
 * differs. It could not tell two very different things apart:
 *
 *   (1) patient A's PASTED background still sitting there under patient B —
 *       the cross-patient carry the guard exists to stop; and
 *   (2) the context the app itself just wrote FOR B — goNewVisitForPatient()
 *       (1pScribeFlow.html) calls newVisit(), whose contextBox line blanks the
 *       box, and then prefillContextFromProfile(), which refills it from B's
 *       own problems/meds/allergies.
 *
 * Case (2) was deleted up to 2.5 s after the chart opened, with a toast that
 * blamed "the previous patient". #contextBox is a real request input
 * (getContext() -> buildPatientContext), and it is one of the values compared
 * after the response comes back — so a clear landing during a run ALSO fails
 * the source fingerprint and discards the finished note as
 * "The patient or visit source changed".
 *
 * The signal used is __mlsOpenSwitchFix.resets, which is incremented as the
 * LAST statement of forceFreshVisitForNewPatient() — the function that runs
 * newVisit() + prefillContextFromProfile() inside the wrapped
 * selectPatient/setActivePtId. "resets moved since my last tick" therefore
 * proves the box was blanked during this switch, so anything in it now was
 * authored after it.
 *
 * WHY THIS DOES NOT WEAKEN THE GUARD: getActivePtId() reads localStorage, so a
 * switch made in ANOTHER TAB moves the id with no chokepoint wrapper and no
 * newVisit() — resets does not move and the clear still fires (NC1). If
 * newVisit() threw and left A's paste standing, the bytes are unchanged from
 * the previous tick and the clear still fires (NC2). If __mlsOpenSwitchFix is
 * not installed at all, resets reads 0 for ever and F16 behaves exactly as it
 * did before. Fail-closed in every unknown case.
 *
 * Both halves are LIFTED from the shipped files by content search — never
 * paraphrased. A paraphrase would pin a spelling, not the product.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');

let failures = 0;
function check(label, ok, detail) {
  if (ok) { console.log('  ok   ' + label); return; }
  failures += 1;
  console.log('  FAIL ' + label + (detail ? ' :: ' + detail : ''));
}

/* ---------- lift the shipped bytes ---------- */

/* The interval installer: from `function installF16() {` through the end of
   the `}, 2500));` statement. Closing brace appended so the slice is a
   complete function declaration. */
function liftF16Installer() {
  const start = connect.indexOf('function installF16() {');
  assert(start >= 0, 'installF16() is gone from 1p-mls-connect.js');
  const stop = connect.indexOf('}, 2500));', start);
  assert(stop > start, 'the F16 2500 ms context janitor is gone from installF16()');
  return connect.slice(start, stop + '}, 2500));'.length) + '\n}';
}

function liftFunction(source, name, opener) {
  const start = source.indexOf(opener);
  assert(start >= 0, 'missing ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unterminated ' + name);
}

const F16_SRC = liftF16Installer();
const PREFILL_SRC = liftFunction(shell, 'prefillContextFromProfile', 'function prefillContextFromProfile(){');
const NEWVISIT_SRC = liftFunction(shell, 'newVisit', 'function newVisit(opts){');

/* The app's own clear is the reason the skip is safe at all. If newVisit()
   ever stops blanking #contextBox, "resets moved" no longer proves the box was
   emptied and this whole contract has to be rethought rather than patched. */
assert(
  /const cb=document\.getElementById\('contextBox'\); if\(cb\) cb\.value='';/.test(NEWVISIT_SRC),
  'newVisit() no longer blanks #contextBox — __mlsOpenSwitchFix.resets stops proving the box was reset'
);
assert(
  /api\.resets\+\+;/.test(connect) && connect.indexOf('function forceFreshVisitForNewPatient(keepRecovery)') >= 0,
  'forceFreshVisitForNewPatient/api.resets is gone — the skip signal has no owner'
);

/* ---------- one isolated world per case ---------- */

function makeWorld() {
  const els = { contextBox: { value: '' }, patientLabel: { value: '' } };
  const charts = {
    A: { id: 'A', name: 'Ann Alpha', problems: 'T2DM\nHTN', meds: 'metformin', allergies: '' },
    B: { id: 'B', name: 'Adam Bravo', problems: 'Lumbar radiculopathy', meds: 'gabapentin', allergies: 'PCN' }
  };
  const toasts = [];
  const ticks = [];
  let activeId = 'A';

  const api = {};
  const sandbox = {
    document: { getElementById: (id) => els[id] || null },
    setInterval: (fn, ms) => { ticks.push({ fn, ms }); return ticks.length; },
    console
  };
  const win = {
    getActivePtId: () => activeId,
    toast: (m) => { toasts.push(String(m)); },
    /* the open-switch fix's exported counter, in the shape it really has */
    __mlsOpenSwitchFix: { ver: '1.1.0', resets: 0, preserved: 0 }
  };
  sandbox.window = win;
  sandbox.activePatient = () => charts[activeId] || null;

  /* module-local helpers, verbatim from 1p-mls-connect.js (the F16 closure's
     own definitions of safe/isFn/$/toastSafe/timers/api) */
  const prelude = [
    "function safe(fn, d) { try { return fn(); } catch (e) { return d; } }",
    "function isFn(f) { return typeof f === 'function'; }",
    "function $(id) { return document.getElementById(id); }",
    "function toastSafe(m, k) { safe(function () { if (isFn(window.toast)) window.toast(m, k || ''); }); }",
    "var timers = [];"
  ].join('\n');

  sandbox.api = api;
  vm.createContext(sandbox);
  vm.runInContext(prelude + '\n' + F16_SRC + '\n' + PREFILL_SRC + '\ninstallF16();', sandbox,
    { filename: 'f16-context-clear.lifted.js' });

  function advance(ms) {
    ticks.forEach((t) => { for (let e = t.ms; e <= ms; e += t.ms) t.fn(); });
  }

  return {
    api, toasts, els, charts,
    box: () => els.contextBox.value,
    setBox: (v) => { els.contextBox.value = v; },
    activeId: () => activeId,
    advance,
    /* forceFreshVisitForNewPatient (1p-mls-connect.js): newVisit() blanks the
       box, prefillContextFromProfile() refills it from the patient now active,
       and resets++ is the last statement. */
    switchThroughApp: (id) => {
      activeId = id;
      els.contextBox.value = '';                       /* newVisit()'s contextBox line */
      vm.runInContext('prefillContextFromProfile();', sandbox);
      win.__mlsOpenSwitchFix.resets += 1;
    },
    /* another tab wrote localStorage: the id moves, nothing else runs */
    switchCrossTab: (id) => { activeId = id; },
    /* the chokepoint ran but newVisit() threw inside safe(): resets still
       moved, the box was never blanked */
    switchWithBrokenNewVisit: (id) => { activeId = id; win.__mlsOpenSwitchFix.resets += 1; }
  };
}

console.log('f16-context-clear-owner-runtime');

/* ---------- POSITIVE: the app's own prefill for the CORRECT patient survives ---------- */
{
  const w = makeWorld();
  w.setBox('PASTED FOR ANN: prior L4-5 microdiscectomy 2019');
  w.advance(2500);                                     /* a tick under A, so lastCtxSeen is Ann's paste */
  w.switchThroughApp('B');
  const written = w.box();
  w.advance(2500);
  check('POSITIVE: chart opened from Patients keeps its own prefilled context',
    w.box() === written && written.indexOf('Lumbar radiculopathy') >= 0,
    'box=' + JSON.stringify(w.box()) + ' expected=' + JSON.stringify(written));
  check('POSITIVE: no clear was counted', (w.api.contextClears || 0) === 0,
    'contextClears=' + (w.api.contextClears || 0));
  check('POSITIVE: the skip is countable', (w.api.contextClearsSkipped || 0) === 1,
    'contextClearsSkipped=' + (w.api.contextClearsSkipped || 0));
  check('POSITIVE: the skip is silent (no toast blaming the previous patient)', w.toasts.length === 0,
    JSON.stringify(w.toasts));
}

/* ---------- NEGATIVE CONTROL 1: cross-tab switch still clears ---------- */
{
  const w = makeWorld();
  w.setBox('PASTED FOR ANN: allergies PCN, on gabapentin');
  w.advance(2500);
  w.switchCrossTab('B');                               /* id moves, resets does NOT */
  w.advance(2500);
  check('NC1: a switch made in another tab still clears the stale paste', w.box() === '',
    'box=' + JSON.stringify(w.box()));
  check('NC1: the clear is counted', (w.api.contextClears || 0) === 1,
    'contextClears=' + (w.api.contextClears || 0));
  check('NC1: the doctor is told', w.toasts.some((t) => /previous patient/i.test(t)),
    JSON.stringify(w.toasts));
  check('NC1: the console recovery hatch still holds the text',
    /allergies PCN/.test(String(w.api.lastClearedContext || '')),
    String(w.api.lastClearedContext));
}

/* ---------- NEGATIVE CONTROL 2: resets moved but the box was never blanked ---------- */
{
  const w = makeWorld();
  w.setBox('PASTED FOR ANN: allergies PCN, on gabapentin');
  w.advance(2500);                                     /* previous tick SAW these exact bytes */
  w.switchWithBrokenNewVisit('B');                     /* resets++ but newVisit() threw */
  w.advance(2500);
  check('NC2: resets moved but the bytes did not — the stale paste is still cleared', w.box() === '',
    'box=' + JSON.stringify(w.box()));
  check('NC2: the clear is counted', (w.api.contextClears || 0) === 1,
    'contextClears=' + (w.api.contextClears || 0));
  check('NC2: no skip was counted', (w.api.contextClearsSkipped || 0) === 0,
    'contextClearsSkipped=' + (w.api.contextClearsSkipped || 0));
}

/* ---------- NEGATIVE CONTROL 3: no id change, doctor's own typing is never touched ---------- */
{
  const w = makeWorld();
  w.setBox('Doctor typed: prior L4-5 microdiscectomy 2019');
  w.advance(10000);
  check('NC3: ten seconds with no patient change never touches the doctor typing',
    w.box() === 'Doctor typed: prior L4-5 microdiscectomy 2019', 'box=' + JSON.stringify(w.box()));
  check('NC3: nothing counted', (w.api.contextClears || 0) === 0 && (w.api.contextClearsSkipped || 0) === 0,
    'clears=' + (w.api.contextClears || 0) + ' skipped=' + (w.api.contextClearsSkipped || 0));
}

/* ---------- NEGATIVE CONTROL 4: the second app switch must not ride the first switch's reset ----------
 * The skip reads resets as a DELTA against the previous tick, not as a level.
 * A cross-tab switch that follows an app switch must still clear. */
{
  const w = makeWorld();
  w.switchThroughApp('B');
  w.advance(2500);                                     /* skip; latches resets=1 */
  w.setBox('PASTED FOR ADAM: allergies PCN');
  w.switchCrossTab('A');                               /* id moves, resets stays 1 */
  w.advance(2500);
  check('NC4: a stale reset level cannot authorise a later cross-tab switch', w.box() === '',
    'box=' + JSON.stringify(w.box()));
  check('NC4: the clear is counted', (w.api.contextClears || 0) === 1,
    'contextClears=' + (w.api.contextClears || 0));
}

/* ---------- the untouched neighbours ---------- */
{
  const w = makeWorld();
  check('the 2500 ms period is unchanged', /\}, 2500\)\);/.test(F16_SRC), 'period changed');
  check('the toast wording is unchanged',
    F16_SRC.indexOf("Cleared the pasted visit context from the previous patient (it never carries over).") >= 0,
    'toast reworded');
  check('api.lastClearedContext (the console recovery hatch) still exists',
    /api\.lastClearedContext = box\.value;/.test(F16_SRC), 'recovery hatch removed');
  check('the box-has-text guard is unchanged',
    /box && box\.value && box\.value\.trim\(\)/.test(F16_SRC), 'guard changed');
  void w;
}

if (failures) {
  console.error('FAIL f16-context-clear-owner-runtime: ' + failures + ' assertion(s) failed');
  process.exit(1);
}
console.log('PASS f16-context-clear-owner-runtime: the app\'s own prefill for the patient now open survives, ' +
  'and a cross-tab switch, a reset that never blanked the box, a stale reset level and untouched doctor typing all behave exactly as before');

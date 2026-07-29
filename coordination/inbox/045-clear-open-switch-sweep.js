'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': expected source text was ambiguous');
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function prepare(relative, encoding, edits) {
  const file = path.join(root, relative);
  const original = fs.readFileSync(file, encoding);
  let next = original;
  edits.forEach(function (edit, index) {
    next = replaceOnce(next, edit[0], edit[1], relative + ' replacement ' + (index + 1));
  });
  if (next === original) throw new Error(relative + ': proposal produced no change');
  return { file, encoding, original, next };
}

const connectPlan = prepare('mls-connect.js', 'latin1', [
  [
    "  setInterval(function () {\n    safe(function () {\n      var a = window._calAppts;\n      if (!a || !a.length) { return; }\n      for (var i = a.length - 1; i >= 0; i--) {\n        if (a[i] && isOpenPlaceholder(a[i].name)) {\n          a.splice(i, 1);\n          api.sweepDropped++;\n        }\n      }\n    });\n  }, 3000);",
    "  var appointmentSweep = setInterval(function () {\n    safe(function () {\n      var a = window._calAppts;\n      if (!a || !a.length) { return; }\n      for (var i = a.length - 1; i >= 0; i--) {\n        if (a[i] && isOpenPlaceholder(a[i].name)) {\n          a.splice(i, 1);\n          api.sweepDropped++;\n        }\n      }\n    });\n  }, 3000);"
  ],
  [
    "  window.__mlsOpenSwitchFix_revert = function () {\n    Object.keys(origRegistry).forEach(function (name) {",
    "  window.__mlsOpenSwitchFix_revert = function () {\n    try { clearInterval(appointmentSweep); } catch (e) {}\n    appointmentSweep = null;\n    Object.keys(origRegistry).forEach(function (name) {"
  ]
]);

const testPlan = prepare('tests/unsaved-switch-leaves-no-trace.test.js', 'utf8', [
  [
    " *   6. Anti-vacuity: the same harness run against the unfixed modules observes\n *      the defect.",
    " *   6. Revert clears the appointment sweep, and reinstall owns exactly one.\n *   7. Anti-vacuity: the same harness run against the unfixed modules observes\n *      the switch defect."
  ],
  [
    "  window.findPatient = function (id) { return patients[id] || null; };\n  /* ScribeFlow.html:9533 */",
    "  window.findPatient = function (id) { return patients[id] || null; };\n  window.upsertPatient = function (patient) { return patient; };\n  window._importPulledSchedule = function (appts) { return appts; };\n  /* ScribeFlow.html:9533 */"
  ],
  [
    "  vm.runInContext(osfSrc, sandbox, { filename: 'mls-connect.js#__mlsOpenSwitchFix' });\n  intervals.slice().forEach(function (fn) { if (fn) fn(); });\n\n  assert(window.setActivePtId.__mlsOpenSwitchWrapped === true && window.selectPatient.__mlsOpenSwitchWrapped === true,",
    "  vm.runInContext(osfSrc, sandbox, { filename: 'mls-connect.js#__mlsOpenSwitchFix' });\n  function tickIntervals() {\n    intervals.slice().forEach(function (fn) { if (fn) fn(); });\n  }\n  function reinstallOpenSwitchFix() {\n    vm.runInContext(osfSrc, sandbox, { filename: 'mls-connect.js#__mlsOpenSwitchFix-reinstall' });\n    tickIntervals();\n  }\n  tickIntervals();\n\n  assert(window.setActivePtId.__mlsOpenSwitchWrapped === true && window.selectPatient.__mlsOpenSwitchWrapped === true,"
  ],
  [
    "    window: window, log: log, state: state, els: els,\n    /* the doctor holds unsaved recorded work but is not recording any more */",
    "    window: window, log: log, state: state, els: els,\n    activeIntervalCount: function () { return intervals.filter(Boolean).length; },\n    tickIntervals: tickIntervals,\n    reinstallOpenSwitchFix: reinstallOpenSwitchFix,\n    /* the doctor holds unsaved recorded work but is not recording any more */"
  ],
  [
    "  /* ---------------- 6. anti-vacuity: the unfixed modules exhibit the defect --------- */\n  {\n    const guardLine = ' && !switchWillBeRefused(newId);';",
    "  /* ---------------- 6. revert owns the appointment sweep lifecycle ----------------- */\n  {\n    const h = boot();\n    assert.strictEqual(h.activeIntervalCount(), 1,\n      'settled __mlsOpenSwitchFix must own exactly one appointment sweep');\n    h.window.__mlsOpenSwitchFix_revert();\n    assert.strictEqual(h.activeIntervalCount(), 0,\n      'revert left the appointment sweep running');\n    h.reinstallOpenSwitchFix();\n    assert.strictEqual(h.activeIntervalCount(), 1,\n      'reinstall accumulated a second appointment sweep');\n    h.window.__mlsOpenSwitchFix_revert();\n    assert.strictEqual(h.activeIntervalCount(), 0,\n      'the reinstalled appointment sweep did not revert cleanly');\n\n    const trackedStart = '  var appointmentSweep = setInterval(function () {';\n    const clearSweep = '    try { clearInterval(appointmentSweep); } catch (e) {}\\n    appointmentSweep = null;\\n';\n    assert(openSwitchFix.includes(trackedStart) && openSwitchFix.includes(clearSweep),\n      'the appointment sweep lifecycle fix is not present in the real IIFE');\n    const unfixedTimerOsf = openSwitchFix\n      .replace(trackedStart, '  setInterval(function () {')\n      .replace(clearSweep, '');\n    assert(!unfixedTimerOsf.includes(trackedStart) && !unfixedTimerOsf.includes(clearSweep),\n      'the timer anti-vacuity patch did not remove the lifecycle fix');\n    const leaked = boot({ osfSource: unfixedTimerOsf });\n    assert.strictEqual(leaked.activeIntervalCount(), 1,\n      'timer anti-vacuity harness did not start one appointment sweep');\n    leaked.window.__mlsOpenSwitchFix_revert();\n    assert.strictEqual(leaked.activeIntervalCount(), 1,\n      'anti-vacuity failed: the unfixed revert unexpectedly stopped the sweep');\n    leaked.reinstallOpenSwitchFix();\n    assert.strictEqual(leaked.activeIntervalCount(), 2,\n      'anti-vacuity failed: the unfixed reinstall did not accumulate sweeps');\n  }\n\n  /* ---------------- 7. anti-vacuity: the unfixed switch modules exhibit the defect --- */\n  {\n    const guardLine = ' && !switchWillBeRefused(newId);';"
  ],
  [
    "  console.log('PASS unsaved switch leaves no trace: Cancel changes nothing, OK clears the old note off the new patient, one action asks once, and a refused switch never resets the visit engine');",
    "  console.log('PASS unsaved switch leaves no trace: Cancel changes nothing, OK clears the old note off the new patient, one action asks once, a refused switch never resets the visit engine, and the appointment sweep reverts without accumulating');"
  ]
]);

const plans = [connectPlan, testPlan];

/* Every target and every unique anchor is validated above before the first write. */
plans.forEach(function (plan) {
  fs.writeFileSync(plan.file, plan.next, plan.encoding);
});

console.log('Applied proposal 045: clear the open-switch appointment sweep on revert.');

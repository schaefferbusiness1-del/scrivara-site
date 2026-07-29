'use strict';

const fs = require('fs');
const path = require('path');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text was ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const root = path.join(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const testPath = path.join(root, 'tests', 'scoped-lifecycle-watchers-contract.test.js');

let connect = fs.readFileSync(connectPath, 'latin1');
connect = replaceOnce(
  connect,
  [
    '  var iv = setInterval(function () { ensureSettings(); wrapSinglePull(); }, 1200);',
    '  ensureSettings(); wrapSinglePull();'
  ].join('\n'),
  [
    '  /* 2026-07-29: Settings has one scoped remount event. Reconcile this row',
    '     only when that owner runs; poll only until the late pull dependency is',
    '     wrapped, then retire the timer instead of waking forever. */',
    '  function onSettingsReconciled() { ensureSettings(); }',
    '  var iv = null;',
    "  window.addEventListener('mls:settings-reconciled', onSettingsReconciled);",
    '  ensureSettings(); wrapSinglePull();',
    '  if (!wrapped) {',
    '    iv = setInterval(function () {',
    '      wrapSinglePull();',
    '      if (wrapped && iv) { clearInterval(iv); iv = null; }',
    '    }, 1200);',
    '  }'
  ].join('\n'),
  'replace permanent settings poll with scoped lifecycle'
);
connect = replaceOnce(
  connect,
  [
    '  api.revert = function () {',
    '    try { clearInterval(iv); } catch (e) {}',
    "    try { var r = $('mlsSaveEveryVisitRow'); if (r) r.remove(); } catch (e) {}"
  ].join('\n'),
  [
    '  api.revert = function () {',
    '    try { if (iv) clearInterval(iv); } catch (e) {}',
    "    try { window.removeEventListener('mls:settings-reconciled', onSettingsReconciled); } catch (e) {}",
    "    try { var r = $('mlsSaveEveryVisitRow'); if (r) r.remove(); } catch (e) {}"
  ].join('\n'),
  'clean up scoped settings lifecycle'
);
fs.writeFileSync(connectPath, connect, 'latin1');

let test = fs.readFileSync(testPath, 'utf8');
test = replaceOnce(
  test,
  [
    "assert(!legacySettings.includes(\"window.__mlsUiUnification.reconcileSettings()\"), 'Legacy Settings cleanup must not recursively call the unified owner');",
    '',
    "assert(!/setInterval\\s*\\(/.test(settingsWb), 'Settings writeback row must not retain a permanent poll');"
  ].join('\n'),
  [
    "assert(!legacySettings.includes(\"window.__mlsUiUnification.reconcileSettings()\"), 'Legacy Settings cleanup must not recursively call the unified owner');",
    '',
    "const visitPrefStart = connect.indexOf('if (window.__mlsVisitSavePref) return;');",
    "const visitPrefEnd = connect.indexOf('/* ===== __mlsPullCheck', visitPrefStart);",
    "assert(visitPrefStart >= 0 && visitPrefEnd > visitPrefStart, 'Visit-save preference block is missing');",
    'const visitPref = connect.slice(visitPrefStart, visitPrefEnd);',
    "assert(!visitPref.includes('setInterval(function () { ensureSettings(); wrapSinglePull(); }'), 'Visit-save preference still polls Settings forever');",
    "assert(visitPref.includes(\"window.addEventListener('mls:settings-reconciled', onSettingsReconciled)\") && visitPref.includes(\"window.removeEventListener('mls:settings-reconciled', onSettingsReconciled)\"), 'Visit-save preference Settings lifecycle is incomplete');",
    "assert(visitPref.includes('if (wrapped && iv) { clearInterval(iv); iv = null; }'), 'Visit-save preference late-dependency poll does not retire after wrapping');",
    '',
    "const visitPrefVm = require('vm');",
    "const visitPrefIifeStart = connect.lastIndexOf('(function () {', visitPrefStart);",
    "assert(visitPrefIifeStart >= 0, 'Visit-save preference runtime IIFE start is missing');",
    'const visitPrefRuntimeSource = connect.slice(visitPrefIifeStart, visitPrefEnd);',
    'function createVisitPrefRuntime(dependency) {',
    '  const listeners = Object.create(null);',
    '  const intervals = new Map();',
    '  const probes = { nextId: 0, styleReads: 0 };',
    '  const settingsModal = {',
    "    id: 'settingsModal',",
    '    querySelectorAll() { return []; }',
    '  };',
    '  const nodes = { settingsModal };',
    '  const document = {',
    '    getElementById(id) { return nodes[id] || null; },',
    "    createElement() { return { id: '', className: '', innerHTML: '', appendChild() {}, addEventListener() {}, remove() {} }; }",
    '  };',
    '  const window = {',
    '    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },',
    '    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },',
    '    dispatch(type, event) { (listeners[type] || []).slice().forEach(fn => fn(event || {})); },',
    '    toast() {},',
    '    activePatient() { return null; }',
    '  };',
    "  if (typeof dependency === 'function') window.pullPatientChartViaAssist = dependency;",
    '  const localStorage = { getItem() { return null; }, setItem() {} };',
    '  const sandbox = {',
    '    window, document, localStorage,',
    "    getComputedStyle() { probes.styleReads++; return { display: 'none' }; },",
    '    setInterval(fn, ms) { const id = ++probes.nextId; intervals.set(id, { fn, ms }); return id; },',
    '    clearInterval(id) { intervals.delete(id); },',
    '    Promise, Date, JSON, Array, String, Object, Math, RegExp, console',
    '  };',
    '  window.window = window;',
    '  window.document = document;',
    '  window.localStorage = localStorage;',
    "  visitPrefVm.runInNewContext(visitPrefRuntimeSource, sandbox, { filename: 'mls-connect.js#__mlsVisitSavePref' });",
    '  return { window, listeners, intervals, probes };',
    '}',
    '',
    'const bootDependency = function () { return Promise.resolve(true); };',
    'const visitPrefReady = createVisitPrefRuntime(bootDependency);',
    "assert.strictEqual(visitPrefReady.intervals.size, 0, 'Present pull dependency must not create a permanent interval');",
    "assert.notStrictEqual(visitPrefReady.window.pullPatientChartViaAssist, bootDependency, 'Present pull dependency was not wrapped at boot');",
    "assert.strictEqual(visitPrefReady.window.pullPatientChartViaAssist.__mlsFullVisitPref, true, 'Boot wrapper marker is missing');",
    'visitPrefReady.window.__mlsVisitSavePref.revert();',
    '',
    'const visitPrefLate = createVisitPrefRuntime(null);',
    "assert.strictEqual(visitPrefLate.intervals.size, 1, 'Missing pull dependency must create one late-dependency interval');",
    "assert.strictEqual(Array.from(visitPrefLate.intervals.values())[0].ms, 1200, 'Late-dependency interval changed from 1200ms');",
    'const visitSettingsReadsBefore = visitPrefLate.probes.styleReads;',
    "visitPrefLate.window.dispatch('mls:settings-reconciled', { detail: { open: false } });",
    "assert.strictEqual(visitPrefLate.probes.styleReads, visitSettingsReadsBefore + 1, 'Settings lifecycle did not reconcile the visit preference row');",
    'const lateDependency = function () { return Promise.resolve(true); };',
    'visitPrefLate.window.pullPatientChartViaAssist = lateDependency;',
    'const lateTick = Array.from(visitPrefLate.intervals.values())[0].fn;',
    'lateTick();',
    "assert.strictEqual(visitPrefLate.intervals.size, 0, 'Late-dependency interval did not clear after wrapping');",
    'const installedVisitWrapper = visitPrefLate.window.pullPatientChartViaAssist;',
    "assert.notStrictEqual(installedVisitWrapper, lateDependency, 'Late dependency was not wrapped on the next tick');",
    "assert.strictEqual(installedVisitWrapper.__mlsFullVisitPref, true, 'Late wrapper marker is missing');",
    'lateTick();',
    "assert.strictEqual(visitPrefLate.window.pullPatientChartViaAssist, installedVisitWrapper, 'Late dependency was wrapped more than once');",
    'visitPrefLate.window.__mlsVisitSavePref.revert();',
    "assert.strictEqual(visitPrefLate.window.pullPatientChartViaAssist, lateDependency, 'Revert did not restore the original late dependency');",
    '',
    'const visitPrefRevert = createVisitPrefRuntime(null);',
    "assert.strictEqual(visitPrefRevert.intervals.size, 1, 'Revert fixture did not start with one late-dependency interval');",
    'visitPrefRevert.window.__mlsVisitSavePref.revert();',
    "assert.strictEqual(visitPrefRevert.intervals.size, 0, 'Visit preference revert leaked its late-dependency interval');",
    "assert.strictEqual((visitPrefRevert.listeners['mls:settings-reconciled'] || []).length, 0, 'Visit preference revert leaked its Settings listener');",
    '',
    "assert(!/setInterval\\s*\\(/.test(settingsWb), 'Settings writeback row must not retain a permanent poll');"
  ].join('\n'),
  'pin visit preference scoped lifecycle'
);
fs.writeFileSync(testPath, test, 'utf8');

console.log('Patched ' + connectPath);
console.log('Patched ' + testPath);

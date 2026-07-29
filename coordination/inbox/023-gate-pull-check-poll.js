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
  ' * Reversible: window.__mlsPullCheck.revert(). ES5; one gentle 1.2s ensure tick. */',
  [
    ' * Reversible: window.__mlsPullCheck.revert(). ES5.',
    ' * 2026-07-29: the 1.2s chip-recovery tick runs only while verification is on;',
    ' * the Settings row follows the canonical scoped Settings lifecycle. */'
  ].join('\n'),
  'describe scoped pull-check lifecycle'
);
connect = replaceOnce(
  connect,
  "      tg.addEventListener('change', function () { setOn(tg.checked); toast(",
  "      tg.addEventListener('change', function () { setOn(tg.checked); syncChipPolling(); toast(",
  'update pull-check scheduling with its toggle'
);
connect = replaceOnce(
  connect,
  [
    '  var iv = setInterval(function () { try { ensureSettingsRow(); ensureChip(); } catch (e) {} }, 1200);',
    '  api.revert = function () {',
    '    try { clearInterval(iv); } catch (e) {}',
    '    try { st.remove(); } catch (e) {}'
  ].join('\n'),
  [
    '  var iv = null;',
    '  function syncChipPolling() {',
    '    try {',
    '      ensureChip();',
    '      if (!on()) {',
    '        if (iv) { clearInterval(iv); iv = null; }',
    '        return;',
    '      }',
    '      if (!iv) iv = setInterval(function () { try { ensureChip(); } catch (e) {} }, 1200);',
    '    } catch (e) {}',
    '  }',
    '  function onSettingsReconciled() { ensureSettingsRow(); }',
    '  function onPatientLifecycle() { ensureChip(); }',
    '  function onStorage(ev) {',
    '    try {',
    '      if (ev && ev.key != null && ev.key !== KEY) return;',
    '      ensureSettingsRow();',
    '      syncChipPolling();',
    '    } catch (e) {}',
    '  }',
    "  window.addEventListener('mls:settings-reconciled', onSettingsReconciled);",
    "  window.addEventListener('mls:active-patient-changed', onPatientLifecycle);",
    "  window.addEventListener('mls:view-changed', onPatientLifecycle);",
    "  window.addEventListener('storage', onStorage);",
    '  ensureSettingsRow();',
    '  syncChipPolling();',
    '  api.revert = function () {',
    '    try { if (iv) clearInterval(iv); } catch (e) {}',
    '    try {',
    "      window.removeEventListener('mls:settings-reconciled', onSettingsReconciled);",
    "      window.removeEventListener('mls:active-patient-changed', onPatientLifecycle);",
    "      window.removeEventListener('mls:view-changed', onPatientLifecycle);",
    "      window.removeEventListener('storage', onStorage);",
    '    } catch (e) {}',
    '    try { st.remove(); } catch (e) {}'
  ].join('\n'),
  'gate pull-check poll and bind scoped lifecycle'
);
fs.writeFileSync(connectPath, connect, 'latin1');

let test = fs.readFileSync(testPath, 'utf8');
test = replaceOnce(
  test,
  [
    "const fs = require('fs');",
    "const path = require('path');"
  ].join('\n'),
  [
    "const fs = require('fs');",
    "const path = require('path');",
    "const vm = require('vm');"
  ].join('\n'),
  'load VM for pull-check lifecycle proof'
);
test = replaceOnce(
  test,
  [
    "assert(settingsWb.includes(\"window.removeEventListener('mls:settings-reconciled', onSettingsReconciled)\"), 'Settings writeback row must unsubscribe on revert');",
    '',
    '['
  ].join('\n'),
  [
    "assert(settingsWb.includes(\"window.removeEventListener('mls:settings-reconciled', onSettingsReconciled)\"), 'Settings writeback row must unsubscribe on revert');",
    '',
    "const pullCheckStart = connect.indexOf('if (window.__mlsPullCheck) return;');",
    "const pullCheckEnd = connect.indexOf('/* ===== __mlsStaffMark', pullCheckStart);",
    "assert(pullCheckStart >= 0 && pullCheckEnd > pullCheckStart, 'Pull-check block is missing');",
    'const pullCheck = connect.slice(pullCheckStart, pullCheckEnd);',
    "assert(!pullCheck.includes('setInterval(function () { try { ensureSettingsRow(); ensureChip(); } catch (e) {} }, 1200)'), 'Pull check still polls closed Settings while disabled');",
    "assert(pullCheck.includes('if (!on()) {\\n        if (iv) { clearInterval(iv); iv = null; }\\n        return;'), 'Pull-check recovery timer is not gated by its enabled state');",
    "assert(pullCheck.includes(\"window.addEventListener('mls:settings-reconciled', onSettingsReconciled)\") && pullCheck.includes(\"window.removeEventListener('mls:settings-reconciled', onSettingsReconciled)\"), 'Pull-check Settings lifecycle is incomplete');",
    "assert(pullCheck.includes(\"window.addEventListener('mls:active-patient-changed', onPatientLifecycle)\") && pullCheck.includes(\"window.addEventListener('mls:view-changed', onPatientLifecycle)\"), 'Pull-check chip must react immediately to canonical patient/view changes');",
    "assert(pullCheck.includes(\"window.addEventListener('storage', onStorage)\") && pullCheck.includes(\"window.removeEventListener('storage', onStorage)\"), 'Pull-check cross-tab preference lifecycle is incomplete');",
    '',
    "const pullCheckIifeStart = connect.lastIndexOf('(function () {', pullCheckStart);",
    "assert(pullCheckIifeStart >= 0, 'Pull-check runtime IIFE start is missing');",
    'const pullCheckRuntimeSource = connect.slice(pullCheckIifeStart, pullCheckEnd);',
    'function createPullCheckRuntime(initialValue) {',
    '  const values = Object.create(null);',
    "  if (initialValue != null) values.mls_verify_pulls = String(initialValue);",
    '  const listeners = Object.create(null);',
    '  const intervals = new Map();',
    '  const probes = { nextId: 0, styleReads: 0, preferenceReads: 0 };',
    '  const nodes = Object.create(null);',
    '  function makeElement(tag) {',
    '    return {',
    "      tagName: String(tag || '').toUpperCase(), id: '', className: '', style: {}, children: [],",
    '      appendChild(node) { node.parentElement = this; this.children.push(node); if (node.id) nodes[node.id] = node; return node; },',
    '      remove() { this.removed = true; if (this.id) delete nodes[this.id]; },',
    '      addEventListener() {},',
    '      querySelector() { return null; },',
    '      querySelectorAll() { return []; }',
    '    };',
    '  }',
    "  const head = makeElement('head');",
    "  const documentElement = makeElement('html');",
    "  const body = makeElement('body');",
    "  const settingsModal = makeElement('div');",
    "  settingsModal.id = 'settingsModal';",
    '  nodes.settingsModal = settingsModal;',
    '  const document = {',
    '    head, documentElement, body,',
    '    createElement: makeElement,',
    '    getElementById(id) { return nodes[id] || null; },',
    '    addEventListener() {},',
    '    removeEventListener() {}',
    '  };',
    '  const window = {',
    '    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },',
    '    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },',
    '    dispatch(type, event) { (listeners[type] || []).slice().forEach(fn => fn(event || {})); },',
    '    postMessage() {},',
    '    toast() {},',
    '    activePatient() { return null; }',
    '  };',
    '  const localStorage = {',
    "    getItem(key) { if (key === 'mls_verify_pulls') probes.preferenceReads++; return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },",
    '    setItem(key, value) { values[key] = String(value); }',
    '  };',
    '  const sandbox = {',
    '    window, document, localStorage,',
    "    getComputedStyle() { probes.styleReads++; return { display: 'none' }; },",
    '    setInterval(fn, ms) { const id = ++probes.nextId; intervals.set(id, { fn, ms }); return id; },',
    '    clearInterval(id) { intervals.delete(id); },',
    '    setTimeout() { return 1; },',
    '    clearTimeout() {},',
    '    Promise, Date, JSON, Array, String, Object, Math, RegExp, console',
    '  };',
    '  window.window = window;',
    '  window.document = document;',
    '  window.localStorage = localStorage;',
    "  vm.runInNewContext(pullCheckRuntimeSource, sandbox, { filename: 'mls-connect.js#__mlsPullCheck' });",
    '  return { window, values, listeners, intervals, probes };',
    '}',
    '',
    'const pullCheckOff = createPullCheckRuntime(null);',
    "assert.strictEqual(pullCheckOff.intervals.size, 0, 'Default-off Pull Check must create zero intervals');",
    'const settingsReadsBefore = pullCheckOff.probes.styleReads;',
    "pullCheckOff.window.dispatch('mls:settings-reconciled', { detail: { open: false } });",
    "assert.strictEqual(pullCheckOff.probes.styleReads, settingsReadsBefore + 1, 'Settings lifecycle did not reconcile the Pull Check row');",
    'const preferenceReadsBefore = pullCheckOff.probes.preferenceReads;',
    "pullCheckOff.window.dispatch('mls:active-patient-changed', { detail: { patientId: 'SYNTHETIC-ID' } });",
    "pullCheckOff.window.dispatch('mls:view-changed', { detail: { view: 'patients' } });",
    "assert.strictEqual(pullCheckOff.probes.preferenceReads, preferenceReadsBefore + 2, 'Patient/view lifecycle did not refresh the Pull Check chip');",
    "pullCheckOff.values.mls_verify_pulls = '1';",
    "pullCheckOff.window.dispatch('storage', { key: 'mls_verify_pulls' });",
    "assert.strictEqual(pullCheckOff.intervals.size, 1, 'Enabling Pull Check must create exactly one recovery interval');",
    "assert.strictEqual(Array.from(pullCheckOff.intervals.values())[0].ms, 1200, 'Pull Check recovery interval changed from 1200ms');",
    'const firstPullCheckInterval = Array.from(pullCheckOff.intervals.keys())[0];',
    "pullCheckOff.window.dispatch('storage', { key: 'mls_verify_pulls' });",
    "assert.strictEqual(pullCheckOff.intervals.size, 1, 'Repeated enable duplicated the Pull Check recovery interval');",
    "assert.strictEqual(Array.from(pullCheckOff.intervals.keys())[0], firstPullCheckInterval, 'Repeated enable replaced the live Pull Check recovery interval');",
    "pullCheckOff.values.mls_verify_pulls = '0';",
    "pullCheckOff.window.dispatch('storage', { key: 'mls_verify_pulls' });",
    "assert.strictEqual(pullCheckOff.intervals.size, 0, 'Disabling Pull Check did not clear its recovery interval');",
    "pullCheckOff.values.mls_verify_pulls = '1';",
    "pullCheckOff.window.dispatch('storage', { key: 'mls_verify_pulls' });",
    "assert.strictEqual(pullCheckOff.intervals.size, 1, 'Re-enable did not restore exactly one Pull Check interval');",
    'pullCheckOff.window.__mlsPullCheck.revert();',
    "assert.strictEqual(pullCheckOff.intervals.size, 0, 'Pull Check revert leaked its recovery interval');",
    "['mls:settings-reconciled', 'mls:active-patient-changed', 'mls:view-changed', 'storage'].forEach(name => {",
    "  assert.strictEqual((pullCheckOff.listeners[name] || []).length, 0, 'Pull Check revert leaked ' + name);",
    '});',
    'const pullCheckOn = createPullCheckRuntime(1);',
    "assert.strictEqual(pullCheckOn.intervals.size, 1, 'Enabled Pull Check boot must create exactly one interval');",
    "assert.strictEqual(Array.from(pullCheckOn.intervals.values())[0].ms, 1200, 'Enabled Pull Check boot lost its 1200ms recovery cadence');",
    'pullCheckOn.window.__mlsPullCheck.revert();',
    '',
    '['
  ].join('\n'),
  'pin option-gated pull-check lifecycle'
);
fs.writeFileSync(testPath, test, 'utf8');

console.log('Patched ' + connectPath);
console.log('Patched ' + testPath);

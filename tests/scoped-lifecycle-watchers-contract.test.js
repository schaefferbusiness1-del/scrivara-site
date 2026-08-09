'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const simple = read('feat_mls_simple_exact.js');
const patients = read('feat_mls_patients_exact.js');
const studio = read('feat_mls_studio_exact.js');
const picker = read('feat_mls_patientpick.js');
const settingsWb = read('feat_mls_settings_wb.js');
const unified = read('feat_athena_tooltip_dedupe.js');
const connect = read('mls-connect.js');

for (const [name, source] of Object.entries({ simple, patients, studio, picker, settingsWb, unified })) {
  new Function(source); // eslint-disable-line no-new-func
  assert(source.includes('revert'), `${name} must retain lifecycle cleanup`);
}

assert(!/setInterval\s*\(\s*sync\b/.test(simple), 'Simple Visit must not poll editor/patient state every 400ms');
assert(simple.includes('var VERSION = "simx-1.4.2"'), 'Simple Visit lifecycle release version was not advanced');
assert(simple.includes('_obs.observe(_visitRoot'), 'Simple Visit mutations must be scoped to #visitView');
assert(!/_obs\.observe\(document\.documentElement[\s\S]*?subtree:\s*true/.test(simple), 'Simple Visit still observes the whole document subtree');
assert(simple.includes('_modeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })'), 'Simple/full mode changes need a root-class-only observer');
assert(simple.includes('window.addEventListener("mls:view-changed", onLifecycle)') && simple.includes('window.addEventListener("mls:active-patient-changed", onLifecycle)'), 'Simple Visit must use canonical view/patient events');
assert(simple.includes('function boot() {\n    stopLifecycle();') && simple.includes('function revert() {\n    stopLifecycle();'), 'Simple Visit reapply/revert must not leak observers or listeners');

assert(patients.includes('_obs.observe(v, {'), 'Patients styling observer must be rooted at #patientsView');
assert(patients.includes('var VERSION = "px-1.3.0"'), 'Patients view-activated lifecycle release version was not advanced');
assert(!patients.includes('_obs.observe(document.documentElement'), 'Patients styling still observes page-wide DOM/style churn');
assert(!/\.offsetParent|getComputedStyle\s*\(/.test(patients), 'Patients reconciliation still forces layout merely to test profile visibility');
assert(patients.includes('window.addEventListener("mls:view-changed", onViewChanged)') && patients.includes('window.removeEventListener("mls:view-changed", onViewChanged)'), 'Patients view event lifecycle is incomplete');
assert(patients.includes('if (isPatientsActive()) startActive();'), 'Patients styling must stay dormant until the Patients view is active');
assert(!/setInterval\s*\(/.test(patients), 'Patients styling must not run blind repair passes after boot');

assert(studio.includes('_obs.observe(v, { childList: true, subtree: true })'), 'AI Studio observer must be scoped to #studioView');
assert(studio.includes('var VERSION = "sx-2.4.0-prod"'), 'AI Studio scoped lifecycle release version was not advanced');
assert(!studio.includes('_obs.observe(document.documentElement'), 'AI Studio still observes every DOM mutation in the app');
assert(!/window\.showView\s*=\s*function/.test(studio), 'AI Studio must not permanently wrap global showView');
assert(!/setInterval\s*\(/.test(studio), 'AI Studio late-mount recovery must be bounded');
assert(studio.includes('window.addEventListener("mls:view-changed", onViewChanged)') && studio.includes('clearBootTimers();'), 'AI Studio event/timer cleanup is incomplete');

assert(picker.includes('_obs.observe(visit, { childList: true, subtree: true })'), 'Patient picker must observe only the Visit root');
assert(picker.includes('var VERSION = "pick-1.6.2"'), 'Patient picker scoped lifecycle + identity/performance release version was not advanced');
assert(picker.includes('_ctxObs.observe(wrap, { childList: true })'), 'Patient picker context-bar recovery must observe only its direct stable parent');
assert(!picker.includes('_obs.observe(document.documentElement'), 'Patient picker still observes every DOM mutation in the app');
assert(picker.includes('window.addEventListener("mls:view-changed", onViewChanged)') && picker.includes('window.addEventListener("mls:active-patient-changed", onPatientChanged)'), 'Patient picker must use canonical lifecycle events');
const pickerBoot = picker.slice(picker.indexOf('function boot()'), picker.indexOf('function revert()'));
assert(!pickerBoot.includes('startNowTimer();'), 'Patient picker must not start its clock timer before a grid is actually mounted');
assert(picker.includes('if (!_gridHosts.length && _nowTimer)'), 'Patient picker must stop its clock timer after all grid hosts unmount');

const unifiedSettingsStart = unified.indexOf('function reconcileSettings()');
const unifiedSettingsEnd = unified.indexOf('function reconcileAll()', unifiedSettingsStart);
const unifiedSettings = unified.slice(unifiedSettingsStart, unifiedSettingsEnd);
assert(unifiedSettings.includes("W.dispatchEvent(ev)") && unifiedSettings.includes("mls:settings-reconciled"), 'Unified Settings owner must publish its scoped remount lifecycle');

const legacyStart = connect.indexOf('if (window.__mlsSettingsCleanupV1) return;');
const legacyEnd = connect.indexOf('/* feat_analysis_clarity_b56', legacyStart);
assert(legacyStart >= 0 && legacyEnd > legacyStart, 'Legacy Settings cleanup block is missing');
const legacySettings = connect.slice(legacyStart, legacyEnd);
assert(!/setInterval\s*\(/.test(legacySettings), 'Legacy Settings cleanup must not retain a permanent poll');
assert(!/new MutationObserver/.test(legacySettings), 'Legacy Settings cleanup must not retain a whole-page observer');
assert(legacySettings.includes("window.addEventListener('mls:settings-reconciled', passAll)"), 'Legacy Settings cleanup must subscribe to the unified owner');
assert(legacySettings.includes("window.removeEventListener('mls:settings-reconciled', passAll)"), 'Legacy Settings cleanup must unsubscribe on revert');
assert(!legacySettings.includes("window.__mlsUiUnification.reconcileSettings()"), 'Legacy Settings cleanup must not recursively call the unified owner');

const visitPrefStart = connect.indexOf('if (window.__mlsVisitSavePref) return;');
const visitPrefEnd = connect.indexOf('/* ===== __mlsPullCheck', visitPrefStart);
assert(visitPrefStart >= 0 && visitPrefEnd > visitPrefStart, 'Visit-save preference block is missing');
const visitPref = connect.slice(visitPrefStart, visitPrefEnd);
assert(!visitPref.includes('setInterval(function () { ensureSettings(); wrapSinglePull(); }'), 'Visit-save preference still polls Settings forever');
assert(visitPref.includes("window.addEventListener('mls:settings-reconciled', onSettingsReconciled)") && visitPref.includes("window.removeEventListener('mls:settings-reconciled', onSettingsReconciled)"), 'Visit-save preference Settings lifecycle is incomplete');
assert(visitPref.includes('if (wrapped && iv) { clearInterval(iv); iv = null; }'), 'Visit-save preference late-dependency poll does not retire after wrapping');

const visitPrefVm = require('vm');
const visitPrefIifeStart = connect.lastIndexOf('(function () {', visitPrefStart);
assert(visitPrefIifeStart >= 0, 'Visit-save preference runtime IIFE start is missing');
const visitPrefRuntimeSource = connect.slice(visitPrefIifeStart, visitPrefEnd);
function createVisitPrefRuntime(dependency) {
  const listeners = Object.create(null);
  const intervals = new Map();
  const probes = { nextId: 0, styleReads: 0 };
  const settingsModal = {
    id: 'settingsModal',
    querySelectorAll() { return []; }
  };
  const nodes = { settingsModal };
  const document = {
    getElementById(id) { return nodes[id] || null; },
    createElement() { return { id: '', className: '', innerHTML: '', appendChild() {}, addEventListener() {}, remove() {} }; }
  };
  const window = {
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
    dispatch(type, event) { (listeners[type] || []).slice().forEach(fn => fn(event || {})); },
    toast() {},
    activePatient() { return null; }
  };
  if (typeof dependency === 'function') window.pullPatientChartViaAssist = dependency;
  const localStorage = { getItem() { return null; }, setItem() {} };
  const sandbox = {
    window, document, localStorage,
    getComputedStyle() { probes.styleReads++; return { display: 'none' }; },
    setInterval(fn, ms) { const id = ++probes.nextId; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    Promise, Date, JSON, Array, String, Object, Math, RegExp, console
  };
  window.window = window;
  window.document = document;
  window.localStorage = localStorage;
  visitPrefVm.runInNewContext(visitPrefRuntimeSource, sandbox, { filename: 'mls-connect.js#__mlsVisitSavePref' });
  return { window, listeners, intervals, probes };
}

const bootDependency = function () { return Promise.resolve(true); };
const visitPrefReady = createVisitPrefRuntime(bootDependency);
assert.strictEqual(visitPrefReady.intervals.size, 0, 'Present pull dependency must not create a permanent interval');
assert.notStrictEqual(visitPrefReady.window.pullPatientChartViaAssist, bootDependency, 'Present pull dependency was not wrapped at boot');
assert.strictEqual(visitPrefReady.window.pullPatientChartViaAssist.__mlsFullVisitPref, true, 'Boot wrapper marker is missing');
visitPrefReady.window.__mlsVisitSavePref.revert();

const visitPrefLate = createVisitPrefRuntime(null);
assert.strictEqual(visitPrefLate.intervals.size, 1, 'Missing pull dependency must create one late-dependency interval');
assert.strictEqual(Array.from(visitPrefLate.intervals.values())[0].ms, 1200, 'Late-dependency interval changed from 1200ms');
const visitSettingsReadsBefore = visitPrefLate.probes.styleReads;
visitPrefLate.window.dispatch('mls:settings-reconciled', { detail: { open: false } });
assert.strictEqual(visitPrefLate.probes.styleReads, visitSettingsReadsBefore + 1, 'Settings lifecycle did not reconcile the visit preference row');
const lateDependency = function () { return Promise.resolve(true); };
visitPrefLate.window.pullPatientChartViaAssist = lateDependency;
const lateTick = Array.from(visitPrefLate.intervals.values())[0].fn;
lateTick();
assert.strictEqual(visitPrefLate.intervals.size, 0, 'Late-dependency interval did not clear after wrapping');
const installedVisitWrapper = visitPrefLate.window.pullPatientChartViaAssist;
assert.notStrictEqual(installedVisitWrapper, lateDependency, 'Late dependency was not wrapped on the next tick');
assert.strictEqual(installedVisitWrapper.__mlsFullVisitPref, true, 'Late wrapper marker is missing');
lateTick();
assert.strictEqual(visitPrefLate.window.pullPatientChartViaAssist, installedVisitWrapper, 'Late dependency was wrapped more than once');
visitPrefLate.window.__mlsVisitSavePref.revert();
assert.strictEqual(visitPrefLate.window.pullPatientChartViaAssist, lateDependency, 'Revert did not restore the original late dependency');

const visitPrefRevert = createVisitPrefRuntime(null);
assert.strictEqual(visitPrefRevert.intervals.size, 1, 'Revert fixture did not start with one late-dependency interval');
visitPrefRevert.window.__mlsVisitSavePref.revert();
assert.strictEqual(visitPrefRevert.intervals.size, 0, 'Visit preference revert leaked its late-dependency interval');
assert.strictEqual((visitPrefRevert.listeners['mls:settings-reconciled'] || []).length, 0, 'Visit preference revert leaked its Settings listener');

assert(!/setInterval\s*\(/.test(settingsWb), 'Settings writeback row must not retain a permanent poll');
assert(settingsWb.includes("var VERSION = 'swb-1.1.0'"), 'Settings writeback lifecycle release version was not advanced');
assert(!/new MutationObserver/.test(settingsWb), 'Settings writeback row must not observe the whole page');
assert(settingsWb.includes("window.addEventListener('mls:settings-reconciled', onSettingsReconciled)"), 'Settings writeback row must subscribe to the unified owner');
assert(settingsWb.includes("window.removeEventListener('mls:settings-reconciled', onSettingsReconciled)"), 'Settings writeback row must unsubscribe on revert');

const pullCheckStart = connect.indexOf('if (window.__mlsPullCheck) return;');
const pullCheckEnd = connect.indexOf('/* ===== __mlsStaffMark', pullCheckStart);
assert(pullCheckStart >= 0 && pullCheckEnd > pullCheckStart, 'Pull-check block is missing');
const pullCheck = connect.slice(pullCheckStart, pullCheckEnd);
assert(!pullCheck.includes('setInterval(function () { try { ensureSettingsRow(); ensureChip(); } catch (e) {} }, 1200)'), 'Pull check still polls closed Settings while disabled');
assert(pullCheck.includes('if (!on()) {\n        if (iv) { clearInterval(iv); iv = null; }\n        return;'), 'Pull-check recovery timer is not gated by its enabled state');
assert(pullCheck.includes("window.addEventListener('mls:settings-reconciled', onSettingsReconciled)") && pullCheck.includes("window.removeEventListener('mls:settings-reconciled', onSettingsReconciled)"), 'Pull-check Settings lifecycle is incomplete');
assert(pullCheck.includes("window.addEventListener('mls:active-patient-changed', onPatientLifecycle)") && pullCheck.includes("window.addEventListener('mls:view-changed', onPatientLifecycle)"), 'Pull-check chip must react immediately to canonical patient/view changes');
assert(pullCheck.includes("window.addEventListener('storage', onStorage)") && pullCheck.includes("window.removeEventListener('storage', onStorage)"), 'Pull-check cross-tab preference lifecycle is incomplete');

const pullCheckIifeStart = connect.lastIndexOf('(function () {', pullCheckStart);
assert(pullCheckIifeStart >= 0, 'Pull-check runtime IIFE start is missing');
const pullCheckRuntimeSource = connect.slice(pullCheckIifeStart, pullCheckEnd);
function createPullCheckRuntime(initialValue) {
  const values = Object.create(null);
  if (initialValue != null) values.mls_verify_pulls = String(initialValue);
  const listeners = Object.create(null);
  const intervals = new Map();
  const probes = { nextId: 0, styleReads: 0, preferenceReads: 0 };
  const nodes = Object.create(null);
  function makeElement(tag) {
    return {
      tagName: String(tag || '').toUpperCase(), id: '', className: '', style: {}, children: [],
      appendChild(node) { node.parentElement = this; this.children.push(node); if (node.id) nodes[node.id] = node; return node; },
      remove() { this.removed = true; if (this.id) delete nodes[this.id]; },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; }
    };
  }
  const head = makeElement('head');
  const documentElement = makeElement('html');
  const body = makeElement('body');
  const settingsModal = makeElement('div');
  settingsModal.id = 'settingsModal';
  nodes.settingsModal = settingsModal;
  const document = {
    head, documentElement, body,
    createElement: makeElement,
    getElementById(id) { return nodes[id] || null; },
    addEventListener() {},
    removeEventListener() {}
  };
  const window = {
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
    dispatch(type, event) { (listeners[type] || []).slice().forEach(fn => fn(event || {})); },
    postMessage() {},
    toast() {},
    activePatient() { return null; }
  };
  const localStorage = {
    getItem(key) { if (key === 'mls_verify_pulls') probes.preferenceReads++; return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem(key, value) { values[key] = String(value); }
  };
  const sandbox = {
    window, document, localStorage,
    getComputedStyle() { probes.styleReads++; return { display: 'none' }; },
    setInterval(fn, ms) { const id = ++probes.nextId; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout() { return 1; },
    clearTimeout() {},
    Promise, Date, JSON, Array, String, Object, Math, RegExp, console
  };
  window.window = window;
  window.document = document;
  window.localStorage = localStorage;
  vm.runInNewContext(pullCheckRuntimeSource, sandbox, { filename: 'mls-connect.js#__mlsPullCheck' });
  return { window, values, listeners, intervals, probes };
}

const pullCheckOff = createPullCheckRuntime(null);
assert.strictEqual(pullCheckOff.intervals.size, 0, 'Default-off Pull Check must create zero intervals');
const settingsReadsBefore = pullCheckOff.probes.styleReads;
pullCheckOff.window.dispatch('mls:settings-reconciled', { detail: { open: false } });
assert.strictEqual(pullCheckOff.probes.styleReads, settingsReadsBefore + 1, 'Settings lifecycle did not reconcile the Pull Check row');
const preferenceReadsBefore = pullCheckOff.probes.preferenceReads;
pullCheckOff.window.dispatch('mls:active-patient-changed', { detail: { patientId: 'SYNTHETIC-ID' } });
pullCheckOff.window.dispatch('mls:view-changed', { detail: { view: 'patients' } });
assert.strictEqual(pullCheckOff.probes.preferenceReads, preferenceReadsBefore + 2, 'Patient/view lifecycle did not refresh the Pull Check chip');
pullCheckOff.values.mls_verify_pulls = '1';
pullCheckOff.window.dispatch('storage', { key: 'mls_verify_pulls' });
assert.strictEqual(pullCheckOff.intervals.size, 1, 'Enabling Pull Check must create exactly one recovery interval');
assert.strictEqual(Array.from(pullCheckOff.intervals.values())[0].ms, 1200, 'Pull Check recovery interval changed from 1200ms');
const firstPullCheckInterval = Array.from(pullCheckOff.intervals.keys())[0];
pullCheckOff.window.dispatch('storage', { key: 'mls_verify_pulls' });
assert.strictEqual(pullCheckOff.intervals.size, 1, 'Repeated enable duplicated the Pull Check recovery interval');
assert.strictEqual(Array.from(pullCheckOff.intervals.keys())[0], firstPullCheckInterval, 'Repeated enable replaced the live Pull Check recovery interval');
pullCheckOff.values.mls_verify_pulls = '0';
pullCheckOff.window.dispatch('storage', { key: 'mls_verify_pulls' });
assert.strictEqual(pullCheckOff.intervals.size, 0, 'Disabling Pull Check did not clear its recovery interval');
pullCheckOff.values.mls_verify_pulls = '1';
pullCheckOff.window.dispatch('storage', { key: 'mls_verify_pulls' });
assert.strictEqual(pullCheckOff.intervals.size, 1, 'Re-enable did not restore exactly one Pull Check interval');
pullCheckOff.window.__mlsPullCheck.revert();
assert.strictEqual(pullCheckOff.intervals.size, 0, 'Pull Check revert leaked its recovery interval');
['mls:settings-reconciled', 'mls:active-patient-changed', 'mls:view-changed', 'storage'].forEach(name => {
  assert.strictEqual((pullCheckOff.listeners[name] || []).length, 0, 'Pull Check revert leaked ' + name);
});
const pullCheckOn = createPullCheckRuntime(1);
assert.strictEqual(pullCheckOn.intervals.size, 1, 'Enabled Pull Check boot must create exactly one interval');
assert.strictEqual(Array.from(pullCheckOn.intervals.values())[0].ms, 1200, 'Enabled Pull Check boot lost its 1200ms recovery cadence');
pullCheckOn.window.__mlsPullCheck.revert();

[
  /* Patients exact now stays inert until Patients is the active view. */
  'feat_mls_patients_exact.js?v=20260727px130',
  'feat_mls_studio_exact.js?v=20260728sx241',
  'feat_mls_patientpick.js?v=20260808pick162perf1'
].forEach(token => assert(connect.includes(token), `fresh lifecycle asset cache key is missing: ${token}`));
assert(connect.includes("var A='feat_mls_simple_exact.js'") &&
  connect.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"),
  'Simple Visit must follow the shared build cache token');
assert(connect.includes("var A='feat_athena_tooltip_dedupe.js'") &&
  connect.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"), 'unified Settings owner cache key was not advanced');
assert(connect.includes('var A="feat_mls_settings_wb.js"') && connect.includes('A+"?v=20260722swb111"'), 'Settings writeback cache key was not advanced');

console.log('PASS scoped lifecycle watchers: Visit, Patients, Studio, patient picker, and Settings no longer own page-wide recurring work');

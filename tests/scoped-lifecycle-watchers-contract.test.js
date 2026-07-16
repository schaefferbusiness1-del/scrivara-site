'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
assert(simple.includes('var VERSION = "simx-1.4.1"'), 'Simple Visit lifecycle release version was not advanced');
assert(simple.includes('_obs.observe(_visitRoot'), 'Simple Visit mutations must be scoped to #visitView');
assert(!/_obs\.observe\(document\.documentElement[\s\S]*?subtree:\s*true/.test(simple), 'Simple Visit still observes the whole document subtree');
assert(simple.includes('_modeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })'), 'Simple/full mode changes need a root-class-only observer');
assert(simple.includes('window.addEventListener("mls:view-changed", onLifecycle)') && simple.includes('window.addEventListener("mls:active-patient-changed", onLifecycle)'), 'Simple Visit must use canonical view/patient events');
assert(simple.includes('function boot() {\n    stopLifecycle();') && simple.includes('function revert() {\n    stopLifecycle();'), 'Simple Visit reapply/revert must not leak observers or listeners');

assert(patients.includes('_obs.observe(v, {'), 'Patients styling observer must be rooted at #patientsView');
assert(patients.includes('var VERSION = "px-1.2.0"'), 'Patients scoped lifecycle release version was not advanced');
assert(!patients.includes('_obs.observe(document.documentElement'), 'Patients styling still observes page-wide DOM/style churn');
assert(!/\.offsetParent|getComputedStyle\s*\(/.test(patients), 'Patients reconciliation still forces layout merely to test profile visibility');
assert(patients.includes('window.addEventListener("mls:view-changed", onViewChanged)') && patients.includes('window.removeEventListener("mls:view-changed", onViewChanged)'), 'Patients view event lifecycle is incomplete');

assert(studio.includes('_obs.observe(v, { childList: true, subtree: true })'), 'AI Studio observer must be scoped to #studioView');
assert(studio.includes('var VERSION = "sx-2.4.0-prod"'), 'AI Studio scoped lifecycle release version was not advanced');
assert(!studio.includes('_obs.observe(document.documentElement'), 'AI Studio still observes every DOM mutation in the app');
assert(!/window\.showView\s*=\s*function/.test(studio), 'AI Studio must not permanently wrap global showView');
assert(!/setInterval\s*\(/.test(studio), 'AI Studio late-mount recovery must be bounded');
assert(studio.includes('window.addEventListener("mls:view-changed", onViewChanged)') && studio.includes('clearBootTimers();'), 'AI Studio event/timer cleanup is incomplete');

assert(picker.includes('_obs.observe(visit, { childList: true, subtree: true })'), 'Patient picker must observe only the Visit root');
assert(picker.includes('var VERSION = "pick-1.6.1"'), 'Patient picker scoped lifecycle + identity release version was not advanced');
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

assert(!/setInterval\s*\(/.test(settingsWb), 'Settings writeback row must not retain a permanent poll');
assert(settingsWb.includes("var VERSION = 'swb-1.1.0'"), 'Settings writeback lifecycle release version was not advanced');
assert(!/new MutationObserver/.test(settingsWb), 'Settings writeback row must not observe the whole page');
assert(settingsWb.includes("window.addEventListener('mls:settings-reconciled', onSettingsReconciled)"), 'Settings writeback row must subscribe to the unified owner');
assert(settingsWb.includes("window.removeEventListener('mls:settings-reconciled', onSettingsReconciled)"), 'Settings writeback row must unsubscribe on revert');

[
  'feat_mls_patients_exact.js?v=20260716px120',
  'feat_mls_studio_exact.js?v=20260716sx240',
  'feat_mls_patientpick.js?v=20260716pick161',
  'feat_mls_simple_exact.js?v=20260716simx141'
].forEach(token => assert(connect.includes(token), `fresh lifecycle asset cache key is missing: ${token}`));
assert(connect.includes("var A='feat_athena_tooltip_dedupe.js'") && connect.includes("A+'?v=20260716ui115'"), 'unified Settings owner cache key was not advanced');
assert(connect.includes('var A="feat_mls_settings_wb.js"') && connect.includes('A+"?v=20260716swb110"'), 'Settings writeback cache key was not advanced');

console.log('PASS scoped lifecycle watchers: Visit, Patients, Studio, patient picker, and Settings no longer own page-wide recurring work');

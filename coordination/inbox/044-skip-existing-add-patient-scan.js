'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const addPatientPath = path.join(root, 'feat_addpatient.js');
const performanceTestPath = path.join(root, 'tests', 'interaction-performance-contract.test.js');

function replaceOne(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': exact source anchor is missing');
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': exact source anchor is ambiguous');
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const addPatient = fs.readFileSync(addPatientPath, 'utf8');
const performanceTest = fs.readFileSync(performanceTestPath, 'utf8');

const addPatientBefore = `  function ensureLauncher() {
    if (!loggedInUi()) { var ex0 = document.getElementById('mlsAddPtLauncher'); if (ex0) ex0.remove(); return; }
    // try to dock into a patients toolbar if one is present and visible
    var anchors = ['#patientSearch', '#ptSearch', '#patientsHeader', '#patientList', '#patientsList', '#patientsTab', '#patients'];
    var docked = null;
    for (var i = 0; i < anchors.length; i++) {
      var a = document.querySelector(anchors[i]);
      if (a && a.offsetParent !== null) { docked = a; break; }
    }
    if (document.getElementById('mlsAddPtLauncher')) return;`;

const addPatientAfter = `  function ensureLauncher() {
    if (!loggedInUi()) { var ex0 = document.getElementById('mlsAddPtLauncher'); if (ex0) ex0.remove(); return; }
    if (document.getElementById('mlsAddPtLauncher')) return;
    // try to dock into a patients toolbar if one is present and visible
    var anchors = ['#patientSearch', '#ptSearch', '#patientsHeader', '#patientList', '#patientsList', '#patientsTab', '#patients'];
    var docked = null;
    for (var i = 0; i < anchors.length; i++) {
      var a = document.querySelector(anchors[i]);
      if (a && a.offsetParent !== null) { docked = a; break; }
    }`;

const testImportsBefore = `const centerpiece = read('feat_mls_centerpiece.js');
const fab = read('feat_fab_layout.js');
const connect = read('mls-connect.js');`;

const testImportsAfter = `const centerpiece = read('feat_mls_centerpiece.js');
const fab = read('feat_fab_layout.js');
const addPatient = read('feat_addpatient.js');
const connect = read('mls-connect.js');`;

const testAssertionsBefore = `assert(!fab.includes('_pollT = setInterval'), 'floating controls still force layout on a permanent timer');
assert(fab.includes('function scheduleLayout()') && fab.includes('function touchesLauncher('), 'floating controls lack filtered frame-coalesced layout');

assert(!connect.includes('reg[i].f()'), 'navigation still synchronously replays every registered UI timer');`;

const testAssertionsAfter = `assert(!fab.includes('_pollT = setInterval'), 'floating controls still force layout on a permanent timer');
assert(fab.includes('function scheduleLayout()') && fab.includes('function touchesLauncher('), 'floating controls lack filtered frame-coalesced layout');

const addPatientLauncherStart = addPatient.indexOf('  function ensureLauncher() {');
const addPatientLauncherEnd = addPatient.indexOf('\\n  function start() {', addPatientLauncherStart);
const addPatientLauncher = addPatient.slice(addPatientLauncherStart, addPatientLauncherEnd);
const existingLauncherGuard = "if (document.getElementById('mlsAddPtLauncher')) return;";
const patientAnchorScan = "var anchors = ['#patientSearch', '#ptSearch', '#patientsHeader', '#patientList', '#patientsList', '#patientsTab', '#patients'];";
assert(addPatientLauncherStart >= 0 && addPatientLauncherEnd > addPatientLauncherStart, 'Add patient launcher owner slice is missing');
assert.strictEqual((addPatientLauncher.match(/if \\(document\\.getElementById\\('mlsAddPtLauncher'\\)\\) return;/g) || []).length, 1, 'Add patient launcher has a missing or duplicate existing-node guard');
assert(addPatientLauncher.indexOf(existingLauncherGuard) < addPatientLauncher.indexOf(patientAnchorScan), 'Add patient launcher still scans seven docking anchors after its node already exists');

assert(!connect.includes('reg[i].f()'), 'navigation still synchronously replays every registered UI timer');`;

const nextAddPatient = replaceOne(
  addPatient,
  addPatientBefore,
  addPatientAfter,
  'existing Add patient launcher guard'
);
const withTestImport = replaceOne(
  performanceTest,
  testImportsBefore,
  testImportsAfter,
  'interaction-performance Add patient import'
);
const nextPerformanceTest = replaceOne(
  withTestImport,
  testAssertionsBefore,
  testAssertionsAfter,
  'interaction-performance Add patient guard contract'
);

const guardLiteral = "if (document.getElementById('mlsAddPtLauncher')) return;";
const anchorLiteral = "var anchors = ['#patientSearch', '#ptSearch', '#patientsHeader', '#patientList', '#patientsList', '#patientsTab', '#patients'];";
const launcherStart = nextAddPatient.indexOf('  function ensureLauncher() {');
const launcherEnd = nextAddPatient.indexOf('\n  function start() {', launcherStart);
const launcherSource = nextAddPatient.slice(launcherStart, launcherEnd);
if (
  launcherStart < 0 ||
  launcherEnd <= launcherStart ||
  launcherSource.indexOf(guardLiteral) < 0 ||
  launcherSource.indexOf(guardLiteral) >= launcherSource.indexOf(anchorLiteral)
) {
  throw new Error('postcondition failed: existing launcher guard is not before the docking scan');
}
if (!nextPerformanceTest.includes('Add patient launcher still scans seven docking anchors after its node already exists')) {
  throw new Error('postcondition failed: focused performance contract was not added');
}

fs.writeFileSync(addPatientPath, nextAddPatient, 'utf8');
fs.writeFileSync(performanceTestPath, nextPerformanceTest, 'utf8');

console.log('Applied proposal 044: existing Add patient launchers now bypass docking-anchor scans.');

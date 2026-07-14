'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function between(source, begin, end) {
  const start = source.indexOf(begin);
  assert(start >= 0, `missing start marker: ${begin}`);
  const finish = source.indexOf(end, start);
  assert(finish > start, `missing end marker: ${end}`);
  return source.slice(start, finish);
}

// The visits driver emits reason:'unverified' when Athena is on the dashboard
// or another surface with no patient banner. The content bridge must run its
// one bounded, DOB-gated open-and-retry recovery for that exact reason.
assert(
  /\^\(wrong-chart\|unverified\|unverified-patient\)\$/.test(content),
  'dashboard history reads must recover from the reader\'s actual unverified reason'
);

// Date and Home navigation share one worker-wide ground lock. Timing out while
// waiting for it must fail honestly, never start a second heavy navigation.
const busyRefusals = background.match(/reason:\s*'athena-navigation-busy'/g) || [];
assert.strictEqual(busyRefusals.length, 2, 'both GotoDate and GoHome must refuse overlap after the bounded wait');
assert(
  /while \(self\.__mlsGroundBusy[\s\S]{0,260}if \(self\.__mlsGroundBusy\) return sendResponse\(\{ ok: false, supported: true, reason: 'athena-navigation-busy'/.test(background),
  'GotoDate must check the lock again before claiming it'
);
assert(
  /while \(self\.__mlsGroundBusy[\s\S]{0,260}if \(self\.__mlsGroundBusy\) return sendResponse\(\{ ok: false, reason: 'athena-navigation-busy'/.test(background),
  'GoHome must check the lock again before claiming it'
);

// Quiet-read teardown must preserve the selected tab in Athena's destination
// window, even when that window is not Chrome's last-focused window.
assert(background.includes('var destinationActiveTabId = null, movedHome = false;'));
assert(background.includes('destinationNow.id === QP.athenaTabId'));
assert(background.includes('await chrome.tabs.update(destinationActiveTabId, { active: true });'));

// The audited read handlers remain wired through the focus-safe visibility
// lease. Direct foregrounding is reserved for explicit focus/write routes.
for (const handler of ['mlsAppScheduleRequest', 'mlsAppGotoDateRequest', 'mlsAppGoHomeRequest', 'mlsAppReadVisitsRequest']) {
  assert(background.includes(handler), `${handler} must remain wired`);
}
assert(background.includes('__mlsQpEnsure'));
assert(background.includes('mlsReadFocusWouldYank'));

// Every GotoDate renderer call is timeout-wrapped; a frozen Athena frame must
// not leave a worker request alive after the app has already offered a retry.
const gotoDateHandler = background.slice(
  background.indexOf("if (msg.type === 'mlsAppGotoDateRequest')"),
  background.indexOf("if (msg.type === 'mlsAppGoHomeRequest')")
);
assert(gotoDateHandler.includes('const initX = await mlsExecTO('));
assert(gotoDateHandler.includes('const chk2X = await mlsExecTO('));
assert(gotoDateHandler.includes('const chkX = await mlsExecTO('));
assert(!gotoDateHandler.includes('await chrome.scripting.executeScript('), 'GotoDate must not contain an unbounded renderer injection');

// The current extension owns the patient open + banner identity gate. The old
// app-side detour must remain retired: it issued a second bare read and raced
// the page's 30-second timeout. A slow verified read now gets the extension's
// full bounded budget and responses are correlated to their initiating call.
const chartRead = between(app, 'function _assistReadChart(patientRef, onStatus)', '/* ===== Pull a PATIENT');
assert(chartRead.includes("requestId='chart-"));
assert(chartRead.includes('requestId:requestId'));
assert(chartRead.includes("patientDob:String(target.dob||'')"));
assert(chartRead.includes("patientMrn:String(target.mrn||target.athenaId||'')"));
assert(chartRead.includes("patientId:String(target.patientId||target.id||'')"));
assert(chartRead.includes('e.data.requestId!==requestId'));
assert(chartRead.includes('100000'));
assert(!chartRead.includes("new Error('OLDEXT')"));
const pullPatient = between(app, 'async function pullPatientChartViaAssist(btn, opts)', '/* Save a parsed Athena chart');
assert(!pullPatient.includes('_assistReadAthenaTab'), 'a patient chart pull must never fall back to arbitrary schedule text');
assert(connect.includes('var LEGACY_CHART_GATE_ENABLED = false;'));
assert(/LEGACY_CHART_GATE_ENABLED\s*&&[\s\S]{0,180}msg\.type === 'mlsAppReadChart'/.test(connect));
assert(content.includes("requestId: chartRequestId"), 'content relay must echo chart request correlation IDs');

console.log('PASS extension read paths: bounded history recovery, serialized navigation, destination-tab preservation');

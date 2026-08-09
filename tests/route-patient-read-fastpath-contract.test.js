'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');
const start = app.indexOf('function showView(v)');
const end = app.indexOf('function renderPatientBar()', start);
assert(start >= 0 && end > start, 'showView source is missing');
const route = app.slice(start, end);

for (const expensive of ['renderPatientBar()', 'updateNavCounts()', 'activePatient()', 'getPatients()']) {
  assert(!route.includes(expensive),
    `visual route switching regained synchronous patient-store work through ${expensive}`);
}
assert(route.includes("if(v==='patients'){ renderPatients(); renderProfile();"),
  'Patients lost its canonical directory/profile render');
assert(route.includes("mls:view-changed"),
  'route switching lost its canonical lifecycle event');

const cardStart = app.indexOf('MLS Unified Patient Card');
const cardEnd = app.indexOf('window.__mlsCtxBar = window.__mlsCard', cardStart);
const card = app.slice(cardStart, cardEnd);
assert(card.includes("window.addEventListener('mls:view-changed', syncRouteLayout)"),
  'unified patient banner bypasses the route fast path with a synchronous record refresh');
assert(!card.includes("window.addEventListener('mls:view-changed', refresh)"),
  'unified patient banner regained a route-to-roster decode');

const sessionStart = app.indexOf('function startSession(email)');
const sessionEnd = app.indexOf('function logout(force)', sessionStart);
const session = app.slice(sessionStart, sessionEnd);
assert(session.includes("showView('visit');") && session.includes('scheduleNavCounts();') &&
  session.indexOf("showView('visit');") < session.indexOf('scheduleNavCounts();'),
  'existing/local accounts can remain on temporary zero navigation badges after sign-in');

const navScheduleStart = app.indexOf('let __mlsNavCountTask=');
const navScheduleEnd = app.indexOf('/* ---------- PATIENTS LIST ---------- */', navScheduleStart);
assert(navScheduleStart >= 0 && navScheduleEnd > navScheduleStart, 'idle navigation-count owner is missing');
const navSchedule = app.slice(navScheduleStart, navScheduleEnd);
assert(navSchedule.includes('window.requestIdleCallback(run)') && !navSchedule.includes('requestIdleCallback(run,{'),
  'startup navigation counts can time out into the first-input window');
assert(navSchedule.includes('__mlsNavCountInputPending()'),
  'startup navigation counts are not input-aware');

let idle = null, countReads = 0, idleSeq = 0, cancelledIdle = null;
const navContext = {
  Array, sfSessionUiEpoch: 7,
  updateNavCounts() { countReads++; },
  setTimeout() { throw new Error('test expects the genuine idle path'); },
  window: {
    navigator: { scheduling: { isInputPending() { return false; } } },
    requestIdleCallback(fn) { idle = fn; return idleSeq++; },
    cancelIdleCallback(id) { cancelledIdle = id; }
  }
};
vm.createContext(navContext);
vm.runInContext(navSchedule + '\nthis.scheduleNavCounts=scheduleNavCounts;', navContext);
for (let i = 0; i < 1000; i++) navContext.scheduleNavCounts();
assert.strictEqual(countReads, 0, 'route/startup count scheduling read data before idle');
assert.strictEqual(typeof idle, 'function', 'navigation counts did not schedule genuine idle work');
const accountAIdle = idle;
navContext.sfSessionUiEpoch = 8;
navContext.scheduleNavCounts();
assert.strictEqual(cancelledIdle, 0, 'new account did not cancel the prior account count task');
assert.notStrictEqual(idle, accountAIdle, 'new account count refresh was dropped behind an old idle task');
idle({ didTimeout: false, timeRemaining() { return 20; } });
assert.strictEqual(countReads, 1, '1,000 count signals did not coalesce into one idle refresh');

const deleteStart = app.indexOf('async function deleteNote(id)');
const deleteEnd = app.indexOf('/* ---- view a saved note', deleteStart);
const deleteSource = app.slice(deleteStart, deleteEnd);
assert(deleteSource.includes('updateHistoryNavCount(getActivePtId())'),
  'deleting a visit leaves the History badge stale after route repairs were removed');
assert(!deleteSource.includes('updateNavCounts();'),
  'deleting a visit cold-reads the patient roster just to update the History badge');

console.log('PASS route patient fast path: visual navigation stays roster-free while startup counts repair at genuine idle and note deletion updates only its hot badge');

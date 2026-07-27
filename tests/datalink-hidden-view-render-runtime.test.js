'use strict';

/* Cloud hydration completes while Visit is the active route. The data-link
 * module used to respond by rebuilding Patients (up to 150 rows), Profile,
 * Calendar, and both exact-view chrome layers even though none was visible.
 * Those hidden renders also wake the app's observer population.
 *
 * This runtime contract proves that a data sync repaints only the active heavy
 * surface. The context bar and navigation count still refresh globally, and
 * ScribeFlow's normal view-entry handlers remain the owners of first render.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_datalink_exact.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function makeHarness(route) {
  const calls = {
    patients: 0,
    profile: 0,
    patientBar: 0,
    nav: 0,
    calendar: 0,
    patientsChrome: 0,
    calendarChrome: 0,
    styleReads: 0
  };
  const views = {
    patientsView: { style: { display: 'none' }, offsetParent: null },
    calendarView: { style: { display: 'none' }, offsetParent: null }
  };
  const context = {
    location: { pathname: '/ScribeFlow.staging.html' },
    document: {
      readyState: 'complete',
      getElementById(id) { return views[id] || null; },
      querySelector() { return null; },
      addEventListener() {}
    },
    getComputedStyle(el) {
      calls.styleReads++;
      return { display: el && el.style ? el.style.display : 'none' };
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    renderPatients() { calls.patients++; },
    renderProfile() { calls.profile++; },
    renderPatientBar() { calls.patientBar++; },
    updateNavCounts() { calls.nav++; },
    renderCalendar() { calls.calendar++; },
    getPatients() { return []; },
    getActivePtId() { return null; },
    _calAppts: [],
    __mlsCurrentView: route,
    __mlsPx: { build() { calls.patientsChrome++; } },
    __mlsCx: { build() { calls.calendarChrome++; } }
  };
  context.window = context;
  vm.runInNewContext(source, context, {
    filename: 'feat_mls_datalink_exact.js',
    timeout: 1000
  });
  assert(context.__mlsLink && context.__mlsLink.installed, 'data-link module did not install in the runtime harness');
  context.__mlsLink.syncAll('runtime-test', false);
  return calls;
}

const visit = makeHarness('visit');
assert.deepStrictEqual(
  [visit.patients, visit.profile, visit.calendar, visit.patientsChrome, visit.calendarChrome],
  [0, 0, 0, 0, 0],
  'Visit hydration rebuilt a hidden Patients or Calendar surface'
);
assert.strictEqual(visit.nav, 1, 'hidden Patients optimization dropped the global navigation-count refresh');
assert.strictEqual(visit.patientBar, 1, 'Visit hydration dropped the visible patient context-bar refresh');
assert.strictEqual(visit.styleReads, 0, 'canonical route detection regressed to forced visibility/layout reads');

const patients = makeHarness('patients');
assert.deepStrictEqual(
  [patients.patients, patients.profile, patients.patientsChrome],
  [1, 1, 1],
  'the visible Patients route no longer receives its complete data-sync render'
);
assert.strictEqual(patients.calendar, 0, 'Patients data sync repainted the hidden Calendar');
assert.strictEqual(patients.calendarChrome, 0, 'Patients data sync rebuilt hidden Calendar chrome');

const calendar = makeHarness('calendar');
assert.deepStrictEqual(
  [calendar.calendar, calendar.calendarChrome],
  [1, 1],
  'the visible Calendar route no longer receives its complete data-sync render'
);
assert.strictEqual(calendar.patients, 0, 'Calendar data sync rebuilt the hidden Patients directory');
assert.strictEqual(calendar.profile, 0, 'Calendar data sync rebuilt the hidden patient Profile');
assert.strictEqual(calendar.patientsChrome, 0, 'Calendar data sync rebuilt hidden Patients chrome');
assert.strictEqual(calendar.nav, 1, 'Calendar data sync dropped the navigation-count refresh formerly supplied by renderPatients');

const showView = app.slice(app.indexOf('function showView(v)'), app.indexOf('/* ---------- LOCAL DATA', app.indexOf('function showView(v)')));
assert(
  showView.includes("if(v==='patients'){ renderPatients(); renderProfile();"),
  'Patients navigation no longer owns the deferred first directory/profile render'
);
assert(
  showView.includes("if(v==='calendar' && typeof loadCalendar==='function') loadCalendar();"),
  'Calendar navigation no longer owns the deferred first calendar render'
);

for (const loader of ['mls-connect.js', 'mls-connect.staging.js']) {
  const text = fs.readFileSync(path.join(root, loader), 'utf8');
  assert(
    text.includes("feat_mls_datalink_exact.js?v=20260727dl2"),
    loader + ' does not publish the optimized data-link module under its new immutable URL'
  );
}

console.log('PASS data-link hydration repaints only the active heavy view');

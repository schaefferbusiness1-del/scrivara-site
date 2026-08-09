'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

console.log('PASS route patient fast path: visual navigation performs zero generic patient-roster reads while Patients retains its own render');

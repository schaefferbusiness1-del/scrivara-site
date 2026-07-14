'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('ScribeFlow.html');
const patientPick = read('feat_mls_patientpick.js');
const upNow = read('feat_mls_upnow_realtime.js');

let inlineBlocks = 0;
for (const match of app.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=|application\/ld\+json/i.test(match[1])) continue;
  // Compile without executing so a broken inline block is caught before release.
  new Function(match[2]); // eslint-disable-line no-new-func
  inlineBlocks += 1;
}
assert(inlineBlocks > 0, 'ScribeFlow must contain parseable inline application scripts');

// Calendar, board, booking, and guided view must share the saved practice clock.
assert(app.includes('function _acctNowParts(d)'), 'the app needs one practice-time clock');
assert(app.includes('function _acctTodayKey()'), 'day-relative workflows need the practice date');
assert(app.includes('function _acctNowMinutes()'), 'guided highlighting needs the practice clock');
assert(app.includes("startIso=_acctWallToUtcIso(date,time)"), 'calendar creation must convert practice wall time to UTC');
assert(app.includes("startIso=_acctWallToUtcIso(_boardDay(),time)"), 'front-desk creation must convert practice wall time to UTC');
assert(app.includes("const t=a.start_at?_fmtApptTime(a.start_at):''"), 'front desk must display time in the practice timezone');
assert(!app.includes("new Date(date+'T'+time).toISOString()"), 'calendar creation must not use the browser timezone');
assert(!app.includes("new Date(_boardDay()+'T'+time).toISOString()"), 'front desk must not use the browser timezone');
assert(patientPick.includes('window._acctTodayKey()') && patientPick.includes('window._acctNowMinutes()'), 'guided patient cards must use the practice clock');
assert(upNow.includes('window._acctNowMinutes()'), 'realtime up-now correction must use the practice clock');

const apptMins = app.slice(app.indexOf('function _calApptMins(a)'), app.indexOf('function _calPickNowIdx', app.indexOf('function _calApptMins(a)')));
assert(apptMins.includes('_apptMinsTz(a.start_at)'), 'up-now selection must prefer timezone-normalized appointment instants');
assert(apptMins.includes('([AaPp])'), 'up-now selection must understand AM/PM schedule labels');

// Operative-note drafting must carry the immutable appointment/chart id and full history.
const opCtx = app.slice(app.indexOf('function _opPatientCtx'), app.indexOf('function _opNewRow', app.indexOf('function _opPatientCtx')));
assert(opCtx.includes('patientId') && opCtx.includes("String(x.id)===String(patientId)"), 'op notes must resolve an exact chart id first');
assert(opCtx.includes('compilePatientRecord(p)'), 'op notes must compile the attached patient history');
const opGenerate = app.slice(app.indexOf('async function opPrepGenerateOne'), app.indexOf('function _opResolvePatient', app.indexOf('async function opPrepGenerateOne')));
assert(opGenerate.includes('row.appt.patientId') && opGenerate.includes('_genOpNote'), 'op-note generation must pass the appointment chart id into drafting');
assert(app.includes('PATIENT CHART / PRIOR HISTORY') && app.includes('ctx.history'), 'the drafting prompt must receive the attached chart history');
assert(app.includes('function _opResolvePatient(row)') && app.includes('if(!p && row._patientAmbiguous) return;'), 'draft autosave must refuse an ambiguous same-name chart');

// Attorney requests may suggest a chart only when there is one unambiguous match.
const legalMatch = app.slice(app.indexOf('function _legalMatchPatient'), app.indexOf('function setLegalAttachedPatient', app.indexOf('function _legalMatchPatient')));
assert(legalMatch.includes('nameScore') && legalMatch.includes('dobScore'), 'legal matching must score name and DOB separately');
assert(legalMatch.includes('tied=true') && legalMatch.includes('!tied'), 'equal legal chart matches must not pick the first patient');
assert(legalMatch.includes('nameScore>=1 && dobScore>0'), 'DOB alone must never attach a legal request to a chart');

console.log(`PASS site continuity: ${inlineBlocks} inline scripts, practice time, guided highlight, exact op-note history, and legal matching`);

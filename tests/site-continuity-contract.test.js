'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('ScribeFlow.html');
const patientPick = read('feat_mls_patientpick.js');
const upNow = read('feat_mls_upnow_realtime.js');
const connect = read('mls-connect.js');

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
// unr-1.1.0: a late-running clinic must not be told "No more patients today"
// while unseen patients remain — the banner reconciles with the agenda strip.
assert(upNow.includes('function unseenPastCount()'), 'end-of-day banner must count unseen patients');
assert(upNow.includes('not marked seen yet'), 'end-of-day banner must surface still-unseen patients honestly');
assert(upNow.includes('No more patients today.'), 'the clean all-seen end-of-day banner must remain');
assert(upNow.includes('__mlsStaffMark'), 'unseen count must exclude owner-marked staff like the agenda strip does');
assert(connect.includes("typeof window._acctTodayKey === 'function'"), 'guided visit home must use the practice day');
assert(connect.includes("typeof window._acctNowParts === 'function'"), 'guided visit clock must use the practice timezone');
assert(connect.includes("typeof window._acctWallToUtcIso === 'function'"), 'guided fallback times must be interpreted in the practice timezone');
assert(!connect.includes('nowMs - t <= 90 * 60000'), 'an appointment more than 30 minutes old must not be labeled happening now');
assert(connect.includes('nowMs - t <= 30 * 60000'), 'guided view needs a bounded happening-now window');

const apptMins = app.slice(app.indexOf('function _calApptMins(a)'), app.indexOf('function _calPickNowIdx', app.indexOf('function _calApptMins(a)')));
assert(apptMins.includes('_apptMinsTz(a.start_at)'), 'up-now selection must prefer timezone-normalized appointment instants');
assert(apptMins.includes('([AaPp])'), 'up-now selection must understand AM/PM schedule labels');

// Operative-note drafting must carry the immutable appointment/chart id and full history.
const opCtx = app.slice(app.indexOf('function _opResolvePatient(name,dob,patientId)'), app.indexOf('function _opNewRow', app.indexOf('function _opResolvePatient(name,dob,patientId)')));
assert(opCtx.includes('function _opResolvePatient(name,dob,patientId)') && opCtx.includes("String(x&&x.id||'')===pid"), 'op notes must resolve an exact chart id first');
assert(opCtx.includes("if(nm && String(byId.name||'')") && opCtx.includes("if(dk && _opDobKey(byId.dob)!==dk)"), 'op-note identity must reject a mismatched name or DOB even when an id is supplied');
assert(opCtx.includes('compilePatientRecord(p)'), 'op notes must compile the attached patient history');
const opGenerate = app.slice(app.indexOf('async function opPrepGenerateOne'), app.indexOf('/* Save (or update)', app.indexOf('async function opPrepGenerateOne')));
assert(opGenerate.includes('_opPatientCtx(row.appt.name,row.appt.dob,row.patientId)') && opGenerate.includes('_genOpNote'), 'op-note generation must pass the immutable patient id and DOB into drafting');
assert(app.includes('PATIENT CHART / PRIOR HISTORY') && app.includes('ctx.history'), 'the drafting prompt must receive the attached chart history');
const opAutosave = app.slice(app.indexOf('function opPrepAutosaveDraft'), app.indexOf('async function opPrepGenerateAll', app.indexOf('function opPrepAutosaveDraft')));
assert(opAutosave.includes('_opResolvePatient(row.appt.name,row.appt.dob,row.patientId)') && opAutosave.includes('if(!p)'), 'draft autosave must refuse an unverified or ambiguous chart');
assert(!opAutosave.includes("source:'athena-schedule'"), 'draft autosave must never manufacture a patient from a schedule label');

// Attorney requests may suggest a chart only when there is one unambiguous match.
const legalMatch = app.slice(app.indexOf('function _legalMatchPatient'), app.indexOf('function setLegalAttachedPatient', app.indexOf('function _legalMatchPatient')));
assert(legalMatch.includes('nameScore') && legalMatch.includes('dobScore'), 'legal matching must score name and DOB separately');
assert(legalMatch.includes('tied=true') && legalMatch.includes('!tied'), 'equal legal chart matches must not pick the first patient');
assert(legalMatch.includes('nameScore>=1 && dobScore>0'), 'DOB alone must never attach a legal request to a chart');

// Patient-bar stability (owner 2026-07-23): the Athena status chip must never
// re-flow the wrapped bar and shift the seen-strip. The slot is a RESERVED
// fixed-width box, the chip is width-capped, and a keep-alive ping stops the
// ready/verify state flap that changed the chip width every two minutes.
const stagingApp = read('ScribeFlow-staging.html');
const stagingConnect = read('mls-connect.staging.js');
for (const [label, html] of [['production', app], ['staging', stagingApp]]) {
  assert(html.includes(".mlsctx-slot{flex:0 0 auto;min-width:220px;min-height:26px;display:flex;align-items:center;justify-content:flex-end;}"), label + ': patient-bar chip slot must reserve fixed space');
  assert(html.includes(".mlsctx-slot .mls-sync{max-width:236px;overflow:hidden;}"), label + ': status chip must be width-capped inside the reserved slot');
  assert(!html.includes(".mlsctx-slot:empty{display:none;}"), label + ': collapsing the empty chip slot re-flows the bar and shifts the seen-strip');
}
for (const [label, js] of [['production', connect], ['staging', stagingConnect]]) {
  assert(js.includes("PASSIVE.pongAt<5*60*1000){cls='idle';txt='Athena · extension ready';}"), label + ': extension-ready freshness must tolerate a missed keep-alive (5 min)');
  assert(js.includes("if(Date.now()-lastPingAt>60000){lastPingAt=Date.now();safe(function(){window.postMessage({source:'mls-app',type:'mlsPing'},location.origin);});}"), label + ': render-tick keep-alive ping must hold the chip state steady (single-interval contract)');
}

console.log(`PASS site continuity: ${inlineBlocks} inline scripts, practice time, guided highlight, exact op-note history, legal matching, and stable patient-bar chip slot`);

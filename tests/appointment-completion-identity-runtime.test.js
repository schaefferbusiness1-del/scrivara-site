'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');

function between(src, start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `could not extract ${start}`);
  return src.slice(a, b);
}

const helper = between(app,
  '/* ===== apptdone-1.0.0 — arrival is not completion',
  '/* ===== end apptdone-1.0.0');

const DAY = '2026-09-12';
const OLD_DAY = '2026-09-11';
let notes = [];
let rows = [];
const windowObject = { _calAppts: rows };
const ctx = {
  window: windowObject,
  getNotes() { return notes; },
  _acctTodayKey() { return DAY; },
  _normDate(v) {
    const s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    return m ? `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` : '';
  },
  _apptScheduleDate(a, fallback) {
    return String((a && (a.day_local || a.appt_date || a.date)) || fallback || '').slice(0, 10);
  },
  _calResolveLocalPatient(a) { return a && !a._resolverReject && a._mlsTargetPatientId || null; },
  _mlsIsChartImportNote(n) { return String(n && n.cc || '') === 'Athena chart import'; },
  console,
};
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(helper + '\nthis.done=_mlsAppointmentCompleted;this.arrived=_mlsAppointmentArrived;this.seen=_seenToday;', ctx,
  { filename: 'appointment-completion-shipped.js' });

const checkedIn = {
  id: 'backend-a', name: 'Same Name', dob: '1970-01-01', appt_date: DAY,
  athena_appointment_id: 'appt-a', _mlsTargetPatientId: 'patient-a',
  status: 'checked_in', checked_in_at: `${DAY}T13:00:00Z`, start_at: `${DAY}T13:00:00Z`,
};
const sameNameOtherChart = {
  id: 'backend-b', name: 'Same Name', dob: '1980-02-02', appt_date: DAY,
  athena_appointment_id: 'appt-b', _mlsTargetPatientId: 'patient-b',
  status: 'booked', start_at: `${DAY}T13:30:00Z`,
};
const booked = {
  id: 'backend-c', name: 'Booked Later', dob: '1990-03-03', appt_date: DAY,
  athena_appointment_id: 'appt-c', _mlsTargetPatientId: 'patient-c',
  status: 'booked', start_at: `${DAY}T14:00:00Z`,
};
rows = [checkedIn, sameNameOtherChart, booked];
ctx.window._calAppts = rows;

assert.strictEqual(ctx.arrived(checkedIn), true, 'checked-in_at did not remain arrival evidence');
assert.strictEqual(ctx.arrived({ status: 'in_room' }), true, 'in-room status did not remain arrival evidence');
assert.strictEqual(ctx.done(checkedIn, 'appt-a'), false, 'check-in alone incorrectly completed the visit');

notes = [{
  id: 'note-a', patient: 'Same Name', patientId: 'patient-a', isDraft: false,
  visitDate: DAY, appointmentId: 'appt-a', soap: 'Completed clinical note', updated: Date.now(),
}];
assert.strictEqual(ctx.done(checkedIn, 'appt-a'), true, 'exact saved appointment note did not complete its row');
assert.strictEqual(ctx.done(sameNameOtherChart, 'appt-b'), false,
  'one same-name patient completed a different local chart');
assert.strictEqual(ctx.seen('Same Name'), false,
  'a bare ambiguous name selected one of two schedule rows');

notes = [{
  id: 'prior-note', patient: 'Same Name', patientId: 'patient-a', isDraft: false,
  visitDate: OLD_DAY, appointmentId: 'old-appt', soap: 'Prior visit', updated: Date.now(),
}];
assert.strictEqual(ctx.done(checkedIn, 'appt-a'), false,
  'editing a prior visit today completed today\'s appointment');

notes = [{
  id: 'wrong-day-exact-id', patient: 'Same Name', patientId: 'patient-a', isDraft: false,
  visitDate: OLD_DAY, appointmentId: 'appt-a', soap: 'Conflicting day', updated: Date.now(),
}];
assert.strictEqual(ctx.done(checkedIn, 'appt-a'), false,
  'an exact appointment id overrode a conflicting clinical visit date');

const resolverConflict = { ...checkedIn, id: 'backend-conflict', _resolverReject: true };
notes = [{
  id: 'conflict-note', patient: 'Same Name', patientId: 'patient-a', isDraft: false,
  visitDate: DAY, appointmentId: 'appt-a', soap: 'Must not be reused',
}];
assert.strictEqual(ctx.done(resolverConflict, 'appt-a'), false,
  'a prefilled local patient id bypassed the canonical identity-conflict resolver');

const backendOnly = {
  id: 'backend-only', name: 'Same Name', dob: '1970-01-01', appt_date: DAY,
  _mlsTargetPatientId: 'patient-a', status: 'booked',
};
ctx.window._calAppts = [backendOnly];
notes = [{
  id: 'strong-id-note', patient: 'Same Name', patientId: 'patient-a', isDraft: false,
  visitDate: DAY, appointmentId: 'different-appt', soap: 'Different exact appointment',
}];
assert.strictEqual(ctx.done(backendOnly), false,
  'a note with an unmatched exact appointment id was downgraded to legacy date-only evidence');
ctx.window._calAppts = [checkedIn];
notes = [{
  id: 'strong-encounter-note', patient: 'Same Name', patientId: 'patient-a', isDraft: false,
  visitDate: DAY, encounterId: 'different-encounter', soap: 'Different exact encounter',
}];
assert.strictEqual(ctx.done(checkedIn, 'appt-a'), false,
  'a note with an unmatched exact encounter id was downgraded to legacy date-only evidence');
const conflictingEncounterRow = { ...checkedIn, encounterId: 'encounter-a' };
notes = [{
  id: 'conflicting-ids-note', patientId: 'patient-a', isDraft: false,
  visitDate: DAY, appointmentId: 'appt-a', encounterId: 'encounter-other', soap: 'Conflicting exact ids',
}];
assert.strictEqual(ctx.done(conflictingEncounterRow, 'appt-a'), false,
  'a matching appointment id overrode a conflicting exact encounter id');

const encounterRow = {
  id: 'backend-enc', name: 'Encounter Match', appt_date: DAY,
  _mlsTargetPatientId: 'patient-enc', encounterId: 'encounter-7', status: 'booked',
};
ctx.window._calAppts = [encounterRow];
notes = [{
  id: 'encounter-note', patientId: 'patient-enc', isDraft: false,
  visitDate: DAY, encounterId: 'encounter-7', soap: 'Exact encounter note',
}];
assert.strictEqual(ctx.done(encounterRow), true, 'an exact saved encounter did not complete its row');

const secondSameDay = {
  id: 'backend-a2', name: 'Same Name', dob: '1970-01-01', appt_date: DAY,
  athena_appointment_id: 'appt-a2', _mlsTargetPatientId: 'patient-a', status: 'booked',
};
ctx.window._calAppts = [checkedIn, secondSameDay];
notes = [{
  id: 'legacy-note', patient: 'Same Name', patientId: 'patient-a', isDraft: false,
  visitDate: DAY, soap: 'Legacy saved visit', updated: Date.now(),
}];
assert.strictEqual(ctx.done(checkedIn, 'appt-a'), false,
  'an id-less legacy note chose the first of two same-day appointments');
assert.strictEqual(ctx.done(secondSameDay, 'appt-a2'), false,
  'an id-less legacy note chose the second of two same-day appointments');

ctx.window._calAppts = [checkedIn];
assert.strictEqual(ctx.done(checkedIn, 'appt-a'), true,
  'a same-day legacy note did not complete the sole appointment for its exact chart');
notes = [{
  id: 'draft-only', patient: 'Same Name', patientId: 'patient-a', isDraft: true,
  visitDate: DAY, appointmentId: 'appt-a', soap: 'Draft',
}, {
  id: 'import-only', patient: 'Same Name', patientId: 'patient-a', isDraft: false,
  visitDate: DAY, appointmentId: 'appt-a', cc: 'Athena chart import',
}];
assert.strictEqual(ctx.done(checkedIn, 'appt-a'), false, 'a draft or chart-import receipt completed a visit');

/* Run the active Easy queue/status functions from the shipped connector. */
const easyStatus = between(connect, '  function isArrived(a) {', '  function visitType(a)');
const easyNext = between(connect, '  function nextPatient() {', '\n\n  /* ---- the banner patient');
const queueCtx = {
  window: {
    _mlsAppointmentArrived: ctx.arrived,
    _seenToday(target, appointmentId) { return ctx.done(target, appointmentId); },
  },
  isFn(f) { return typeof f === 'function'; },
  apptDay() { return DAY; },
  todayLocal() { return DAY; },
  scheduledAppointmentId(a) { return String(a && a.athena_appointment_id || ''); },
  dayRows() { return [checkedIn, booked]; },
  visitDay() { return DAY; },
  Date,
};
vm.createContext(queueCtx);
vm.runInContext(easyStatus + easyNext + '\nthis.next=nextPatient;this.status=statusOf;this.complete=isSeen;', queueCtx,
  { filename: 'active-easy-queue-shipped.js' });

notes = [];
ctx.window._calAppts = [checkedIn, booked];
assert.strictEqual(queueCtx.complete(checkedIn), false, 'active Easy still treats check-in as completion');
assert.strictEqual(queueCtx.status(checkedIn), 'Checked in', 'arrived unfinished row lost its honest status');
assert.strictEqual(queueCtx.next().id, checkedIn.id, 'Next patient skipped the arrived unfinished row');

notes = [{ patientId: 'patient-a', visitDate: DAY, appointmentId: 'appt-a', isDraft: false, soap: 'Done' }];
assert.strictEqual(queueCtx.complete(checkedIn), true, 'active Easy did not see the exact completed appointment');
assert.strictEqual(queueCtx.status(checkedIn), 'Seen', 'completed row did not display Seen');
assert.strictEqual(queueCtx.next().id, booked.id, 'Next patient did not advance after exact completion');

/* The exact predicate is called for every visible row; its note index must be
   one read per account/store generation, then invalidate on the next save. */
let cacheVersion = 1;
let cacheAccount = 'synthetic-account';
let cacheReads = 0;
let cacheNotes = [];
const cacheWindow = { _calAppts: [checkedIn], __mlsStoreCache: { verFor() { return `notes:${cacheVersion}`; } } };
const cacheCtx = {
  window: cacheWindow,
  uns(suffix) { return `${cacheAccount}::${suffix}`; },
  getNotes() { cacheReads++; return cacheNotes; },
  _acctTodayKey() { return DAY; },
  _normDate: ctx._normDate,
  _apptScheduleDate: ctx._apptScheduleDate,
  _calResolveLocalPatient: ctx._calResolveLocalPatient,
  _mlsIsChartImportNote: ctx._mlsIsChartImportNote,
};
cacheWindow.window = cacheWindow;
vm.createContext(cacheCtx);
vm.runInContext(helper + '\nthis.done=_mlsAppointmentCompleted;', cacheCtx, { filename: 'appointment-completion-cache-shipped.js' });
assert.strictEqual(cacheCtx.done(checkedIn, 'appt-a'), false);
assert.strictEqual(cacheCtx.done(checkedIn, 'appt-a'), false);
assert.strictEqual(cacheReads, 1, 'same-version row checks reparsed the note store');
cacheNotes = [{ patientId: 'patient-a', appointmentId: 'appt-a', visitDate: DAY, isDraft: false, soap: 'Done' }];
assert.strictEqual(cacheCtx.done(checkedIn, 'appt-a'), false, 'the cache changed without a store-version save');
cacheVersion++;
assert.strictEqual(cacheCtx.done(checkedIn, 'appt-a'), true, 'the next store version did not expose the saved note');
assert.strictEqual(cacheReads, 2, 'store-version invalidation did not rebuild exactly once');
cacheAccount = 'second-account';
cacheNotes = [];
assert.strictEqual(cacheCtx.done(checkedIn, 'appt-a'), false, 'an account change reused another account\'s completion index');
assert.strictEqual(cacheReads, 3, 'an account change did not rebuild the completion index');

let unsafeReads = 0;
const unsafeWindow = { _calAppts: [checkedIn], __mlsStoreCache: { verFor() { return null; }, ver() { return NaN; } } };
const unsafeCtx = {
  window: unsafeWindow,
  uns(suffix) { return `unsafe-account::${suffix}`; },
  getNotes() { unsafeReads++; return []; },
  _acctTodayKey() { return DAY; },
  _normDate: ctx._normDate,
  _apptScheduleDate: ctx._apptScheduleDate,
  _calResolveLocalPatient: ctx._calResolveLocalPatient,
  _mlsIsChartImportNote: ctx._mlsIsChartImportNote,
};
unsafeWindow.window = unsafeWindow;
vm.createContext(unsafeCtx);
vm.runInContext(helper + '\nthis.done=_mlsAppointmentCompleted;', unsafeCtx, { filename: 'appointment-completion-unsafe-cache-shipped.js' });
unsafeCtx.done(checkedIn, 'appt-a');
unsafeCtx.done(checkedIn, 'appt-a');
assert.strictEqual(unsafeReads, 2, 'an untrustworthy null/NaN generation retained a stale completion cache');

const f2 = between(connect, '  function installF2() {', '    /* _nextClinicDay');
assert(f2.includes('orig._seenToday(target, appointmentId)'), 'F2 does not delegate to the exact base predicate');
assert(!f2.includes('updated ||') && !f2.includes('anyName'), 'F2 restored updated-time or ambiguous-name completion');
assert(!connect.includes('filter(function (a) { return !!a.checked_in_at; }).length'),
  'a fallback agenda still counts check-in as seen');
assert(!connect.includes('var badge = a.checked_in_at ?'),
  'a fallback agenda still labels check-in as seen');
assert(connect.includes("(isArrived(a)?'arrived':'pending')"),
  'agenda repaint signatures do not observe an arrival-state change');

/* Execute the guarded B49 fallback's real popup painter across the state
   transition that its old seen-count-only signature masked. */
const b49Marker = connect.indexOf('b49 agenda BUTTON provider-scope fix');
const b49Start = connect.indexOf('  function isSeen(a) {', b49Marker);
const b49End = connect.indexOf('  /* Re-apply right after', b49Start);
assert(b49Marker >= 0 && b49Start > b49Marker && b49End > b49Start, 'could not extract B49 agenda painter');
const b49Source = connect.slice(b49Start, b49End);
let popupHtml = '';
let completed = false;
const popup = {
  firstElementChild: null,
  get innerHTML() { return popupHtml; },
  set innerHTML(value) {
    popupHtml = String(value);
    const m = /data-b49="([^"]*)"/.exec(popupHtml);
    this.firstElementChild = m ? { getAttribute(name) { return name === 'data-b49' ? m[1] : null; } } : null;
  },
};
const popupRow = {
  id: 'popup-row', name: 'Popup Patient', provider: 'Synthetic Provider', appt_date: DAY,
  time_display: '9:00 AM', start_at: `${DAY}T09:00:00Z`, status: 'booked',
};
const popupCtx = {
  window: {
    _seenToday() { return completed; },
    _mlsAppointmentArrived(a) { return !!a.checked_in_at; },
  },
  $(id) { return id === 'mlsAgendaPop' ? popup : null; },
  provToday() { return { prov: 'Synthetic Provider', appts: [popupRow] }; },
  Date,
};
vm.createContext(popupCtx);
vm.runInContext(b49Source + '\nthis.paint=fixPop;', popupCtx, { filename: 'b49-agenda-repaint-shipped.js' });
popupCtx.paint();
assert(!popupHtml.includes('checked in') && popupHtml.includes('>next</span>'), 'booked popup baseline is wrong');
popupRow.checked_in_at = `${DAY}T13:00:00Z`;
popupCtx.paint();
assert(popupHtml.includes('checked in · next') && popupHtml.includes('0 / 1 seen'),
  'already-open agenda did not repaint an arrived unfinished patient');
completed = true;
popupCtx.paint();
assert(popupHtml.includes('>seen</span>') && popupHtml.includes('1 / 1 seen') && !popupHtml.includes('checked in · next'),
  'already-open agenda did not repaint exact completion');

console.log('PASS appointment completion identity: arrival stays pending, exact patient/visit evidence completes, ambiguous legacy evidence fails closed');

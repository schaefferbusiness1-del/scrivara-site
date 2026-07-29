'use strict';

/* The first guarded __mlsEasyV32 engine is the active implementation. Its one
 * selected visitDay must own Home, Choose, the quick strip, and snapshots.
 * Browsing dates is fail-closed while recording or while an unsigned draft is
 * active, so a day change can never silently erase clinical work. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const marker = connect.indexOf('the effortless Visit tab  (__mlsEasyV32)', 15000);
const easyStart = connect.lastIndexOf('/*', marker);
const easyEnd = connect.indexOf('F7  MLS EASY SYNC TRUTH', marker);
assert(marker >= 0 && easyStart >= 0 && easyEnd > easyStart, 'active canonical Easy Visit engine boundary was not found');
const easy = connect.slice(easyStart, easyEnd);

function functionSource(text, name, nextName) {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`\n  function ${nextName}(`, start);
  assert(start >= 0 && end > start, `could not bound active Easy ${name}`);
  return text.slice(start, end);
}

assert(/visitDay:\s*['"]['"]/.test(easy), 'active Easy state has no selected visitDay');
assert(easy.includes('currentVisitDay: visitDay'), 'selected visit day is not exposed read-only');
assert(easy.includes('setVisitDay: setVisitDay'), 'selected visit day cannot be changed transactionally');

const apptDay = functionSource(easy, 'apptDay', 'rowKey');
assert(apptDay.includes('a.appt_date || a.day_local'),
  'active Easy must bucket exact rows by filed appt_date before recomputed day_local');

const timeContext = functionSource(easy, 'timeContext', 'lateLine');
assert(timeContext.includes('var allRows = arguments.length ? arguments[0] : dayRows(visitDay());'),
  'Home time context cannot consume one selected-day appointment snapshot');
assert(timeContext.includes('var rows = allRows.filter'),
  'Home time context does not preserve seen filtering over the supplied snapshot');

const homeSig = functionSource(easy, 'homeSig', 'recBannerHtml');
assert(homeSig.includes("visitDay() + '|'"), 'Home invalidation is not selected-day owned');
assert(homeSig.includes('var allRows = arguments.length ? arguments[0] : dayRows(visitDay());'),
  'Home invalidation cannot own or consume one selected-day snapshot');
assert(homeSig.includes('var tc = arguments.length > 1 ? arguments[1] : timeContext(allRows);'),
  'Home invalidation recomputes time context when the caller already has it');
assert(homeSig.includes("'|' + allRows.length + '|'"),
  'Home invalidation must count every selected-day row, including seen rows');
assert(!homeSig.includes('dayRows(visitDay()).length'),
  'Home invalidation returned to a second selected-day appointment scan');

const renderHome = functionSource(easy, 'renderHome', 'hasPrep');
assert(renderHome.includes('var rows = dayRows(visitDay());'), 'Home does not render the selected day');
assert(renderHome.includes('var tc = timeContext(rows), late = lateLine(tc);'),
  'Home render does not reuse its selected-day snapshot for time context');
assert(renderHome.includes('S._homeSig = homeSig(rows, tc);'),
  'Home render does not reuse its snapshot and time context for invalidation');
assert.strictEqual((renderHome.match(/dayRows\(visitDay\(\)\)/g) || []).length, 1,
  'Home render performs more than one selected-day appointment scan');
assert(renderHome.includes('fmtToday()'), 'Home does not render the selected date label');

const pollStart = easy.indexOf('pollIv = setInterval(function () {');
const pollEnd = easy.indexOf('\n    }, 700);', pollStart);
assert(pollStart >= 0 && pollEnd > pollStart, 'active Easy poll could not be bounded');
const poll = easy.slice(pollStart, pollEnd);
const pollHomeStart = poll.indexOf("} else if (S.mode === 'doctor' && S.screen === 'home') {");
const pollChooseStart = poll.indexOf("} else if (S.mode === 'doctor' && S.screen === 'choose') {", pollHomeStart);
assert(pollHomeStart >= 0 && pollChooseStart > pollHomeStart, 'active Easy Home poll branch could not be bounded');
const pollHome = poll.slice(pollHomeStart, pollChooseStart);
assert.strictEqual((pollHome.match(/dayRows\(visitDay\(\)\)/g) || []).length, 1,
  'stable Home poll performs more than one selected-day appointment scan');
assert(pollHome.includes('var rows = dayRows(visitDay()), tc = timeContext(rows);'),
  'stable Home poll does not derive time context from its one snapshot');
assert(pollHome.includes('homeSig(rows, tc)') && pollHome.includes('lateLine(tc)'),
  'stable Home poll does not share one context between invalidation and lateness');

/* 2026-07-29: execute the active functions with generated rows. The signature
 * must scan once when called alone, scan zero times with a caller snapshot,
 * and count all scheduled rows rather than only the unseen time-context rows. */
{
  const generatedRows = [
    { id: 'row-a', seen: false },
    { id: 'row-b', seen: true },
    { id: 'row-c', seen: false }
  ];
  const ctx = {
    S: { autoPull: 'idle' },
    dayRowsCalls: 0,
    dayRows(day) { ctx.dayRowsCalls++; assert.strictEqual(day, '2026-07-29'); return generatedRows; },
    visitDay() { return '2026-07-29'; },
    visitIsToday() { return false; },
    isSeen(row) { return row.seen; },
    rowKey(row) { return row.id; },
    lateLine() { return ''; },
    isRecording() { return false; },
    isFn(value) { return typeof value === 'function'; },
    window: { verifiedActivePatient() { return null; }, activePatient() { return null; } },
    assert
  };
  vm.createContext(ctx);
  vm.runInContext(`${timeContext}\n${homeSig}\nthis.snapshotApi = { timeContext, homeSig };`, ctx);

  const standaloneSig = ctx.snapshotApi.homeSig();
  assert.strictEqual(ctx.dayRowsCalls, 1, 'standalone Home invalidation must scan appointments exactly once');
  assert.strictEqual(standaloneSig.split('|')[5], '3',
    'standalone Home invalidation lost the all-row count when one row was seen');

  ctx.dayRowsCalls = 0;
  const suppliedContext = ctx.snapshotApi.timeContext(generatedRows);
  const suppliedSig = ctx.snapshotApi.homeSig(generatedRows, suppliedContext);
  assert.strictEqual(ctx.dayRowsCalls, 0, 'caller-supplied Home snapshot unexpectedly rescanned appointments');
  assert.strictEqual(suppliedContext.rows.length, 2, 'time context no longer filters seen rows');
  assert.strictEqual(suppliedSig.split('|')[5], '3',
    'caller-supplied Home invalidation counted unseen rows instead of all rows');
}

const chooseFiltered = functionSource(easy, 'chooseFiltered', 'otherPatientMatches');
assert(chooseFiltered.includes('dayRows(visitDay())'), 'Choose patient does not filter the selected day');
const otherMatches = functionSource(easy, 'otherPatientMatches', 'ptRowHtml');
assert(otherMatches.includes('dayRows(visitDay())'), 'Choose patient can leak scheduled patients across days');
const renderChoose = functionSource(easy, 'renderChoose', 'quickStripHtml');
assert(renderChoose.includes('visitDayName()'), 'Choose patient does not name the selected day');

const quickStrip = functionSource(easy, 'quickStripHtml', 'wireQuickStrip');
assert(quickStrip.includes('dayRows(visitDay())'), 'the native quick strip is not selected-day owned');

const remoteStart = easy.indexOf('remote: {');
const startVisitFor = easy.indexOf('startVisitFor:', remoteStart);
assert(remoteStart >= 0 && startVisitFor > remoteStart, 'active Easy remote snapshot was not found');
const snapshot = easy.slice(remoteStart, startVisitFor);
assert(snapshot.includes('var rows = dayRows(visitDay()).map'), 'snapshot rows are not selected-day owned');
assert(snapshot.includes('day: visitDay()'), 'snapshot does not report the selected day');
assert(easy.slice(startVisitFor, startVisitFor + 600).includes('apptDay(a) !== visitDay()'),
  'remote visit start can activate an appointment from another day');

// Execute the actual transition guard rather than relying only on source text.
const visitDaySource = functionSource(easy, 'visitDay', 'visitIsToday');
const setVisitDayStart = easy.indexOf('function setVisitDay(');
const setVisitDayEnd = easy.indexOf('\n\n  /* Staff Prep has one activation path', setVisitDayStart);
assert(setVisitDayStart >= 0 && setVisitDayEnd > setVisitDayStart, 'could not bound active Easy setVisitDay');
const setVisitDaySource = easy.slice(setVisitDayStart, setVisitDayEnd);
{
  const baseState = () => ({
    visitDay: '', appt: null, locked: null, phase: 'idle', recStart: 0,
    genClickedAt: 0, signedAt: 0, expanded: null, editing: false,
    lastWarn: '', query: '', showCount: 5, mode: 'doctor', screen: 'home'
  });
  const ctx = {
    S: baseState(),
    recording: false,
    transcript: '',
    note: '',
    renders: 0,
    bindings: [],
    events: [],
    toasts: [],
    todayLocal() { return '2026-07-19'; },
    isRecording() { return ctx.recording; },
    noteText() { return ctx.note; },
    $(id) { return id === 'transcript' ? { value: ctx.transcript } : null; },
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    toast(message) { ctx.toasts.push(String(message)); },
    render() { ctx.renders++; },
    setEasyMode(mode, screen) { ctx.S.mode = mode; ctx.S.screen = screen; ctx.render(); },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
    window: {
      _athenaSetVisitBinding(value, explicit) { ctx.bindings.push({ value, explicit }); },
      dispatchEvent(ev) { ctx.events.push(ev); }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(`${visitDaySource}\n${setVisitDaySource}\nthis.visitDay = visitDay; this.setVisitDay = setVisitDay;`, ctx);

  ctx.recording = true;
  assert.strictEqual(ctx.setVisitDay('2026-07-20'), false, 'recording must block a day change');
  assert.strictEqual(ctx.visitDay(), '2026-07-19', 'recording must preserve the prior day');
  assert.strictEqual(ctx.bindings.length, 0, 'a blocked recording transition must preserve its Athena binding');

  ctx.recording = false;
  ctx.S.appt = { id: 'appt-current' };
  ctx.S.locked = { id: 'appt-current' };
  ctx.transcript = 'unsigned visit transcript';
  assert.strictEqual(ctx.setVisitDay('2026-07-20'), false, 'an unsigned transcript must block a day change');
  assert.strictEqual(ctx.S.appt.id, 'appt-current', 'a blocked draft transition must preserve the active appointment');
  assert.strictEqual(ctx.bindings.length, 0, 'a blocked draft transition must preserve its Athena binding');

  ctx.transcript = '';
  ctx.note = 'unsigned generated note';
  assert.strictEqual(ctx.setVisitDay('2026-07-20'), false, 'an unsigned generated note must block a day change');
  assert.strictEqual(ctx.visitDay(), '2026-07-19', 'an unsigned note must preserve the prior day');

  ctx.note = '';
  assert.strictEqual(ctx.setVisitDay('2026-07-20'), true, 'a safe day change must succeed');
  assert.strictEqual(ctx.visitDay(), '2026-07-20', 'the selected future day must own Easy after commit');
  assert.strictEqual(ctx.S.appt, null, 'a committed day change must not carry the prior patient');
  assert.strictEqual(ctx.S.locked, null, 'a committed day change must not carry the prior context lock');
  assert.deepStrictEqual(ctx.bindings[0], { value: null, explicit: true }, 'a committed day change must clear the Athena binding');
  assert.strictEqual(ctx.events.length, 1, 'a committed day change must emit one synchronization event');

  // Prove future -> future -> Today uses the same shell without patient carry.
  ctx.S.appt = { id: 'future-patient' };
  ctx.S.locked = { id: 'future-patient' };
  assert.strictEqual(ctx.setVisitDay('2026-07-21'), true, 'future-to-future transition must succeed when safe');
  assert.strictEqual(ctx.S.appt, null, 'future-to-future must clear the prior patient');
  ctx.S.appt = { id: 'second-future-patient' };
  ctx.S.locked = { id: 'second-future-patient' };
  assert.strictEqual(ctx.setVisitDay('2026-07-19'), true, 'returning to Today must use the same transition');
  assert.strictEqual(ctx.visitDay(), '2026-07-19', 'Today must become the selected day again');
  assert.strictEqual(ctx.S.appt, null, 'returning to Today must not carry a future patient');
}

console.log('PASS Visit selected-day ownership: one Easy shell owns Home, Choose, quick strip, and snapshots; recording/unsigned drafts fail closed');

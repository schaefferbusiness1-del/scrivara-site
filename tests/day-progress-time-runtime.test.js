'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const dayProgress = fs.readFileSync(path.join(root, 'feat_mls_dayprogress.js'), 'utf8');

/* start at the shared memoized-formatter cache so the extracted helpers run
   exactly the shipped code path (b322: _fmtApptTime formats through
   _mlsTzFmt instead of constructing an Intl formatter per call) */
const helperStart = app.indexOf('var _mlsTzFmtCache={};');
const helperEnd = app.indexOf('function _acctWallToUtcIso', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'canonical appointment display helpers were not found');

const context = {
  console,
  Date,
  Intl,
  Array,
  String,
  isNaN,
  _acctTz: () => 'America/New_York',
  _calPad: n => ('0' + n).slice(-2),
  _acctTodayKey: () => '2026-07-15',
  _acctDateKeyOf: d => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d)
};
context.window = context;
vm.createContext(context);
vm.runInContext(app.slice(helperStart, helperEnd), context);

const conflicting = {
  name: 'Morrie Gold',
  appt_date: '2026-07-15',
  start_at: '2026-07-15T12:40:00Z',
  start_local: '2026-07-15 08:40:00',
  time_display: '12:40 PM'
};
assert.strictEqual(context._apptDisplayTime(conflicting), '8:40 AM', 'UTC-looking time_display overrode the authoritative account-timezone instant');
assert.strictEqual(context._apptDisplayTime({ start_local: '2026-07-15 08:40:00', time_display: '12:40 PM' }), '8:40 AM', 'start_local did not beat legacy time_display');
assert.strictEqual(context._apptDisplayTime({ time_display: '4:00 PM' }), '4:00 PM', 'an explicit legacy meridian was lost');
assert.strictEqual(context._apptDisplayTime({}), '', 'missing appointment time must stay blank');

const unique = context._findCanonicalScheduleAppt({ name: 'Morrie Gold', appt_date: '2026-07-15' }, [conflicting], '2026-07-15');
assert(unique && unique.start_at === conflicting.start_at, 'a unique exact full-name/date schedule row was not resolved');

const duplicates = [
  { id: 'appt-a', name: 'Alex Same', appt_date: '2026-07-15', start_at: '2026-07-15T12:40:00Z' },
  { id: 'appt-b', name: 'Alex Same', appt_date: '2026-07-15', start_at: '2026-07-15T13:40:00Z' }
];
assert.strictEqual(context._findCanonicalScheduleAppt({ name: 'Alex Same', appt_date: '2026-07-15' }, duplicates, '2026-07-15'), null, 'duplicate names selected an arbitrary first appointment');
assert.strictEqual(context._findCanonicalScheduleAppt({ id: 'appt-b', name: 'Alex Same', appt_date: '2026-07-15' }, duplicates, '2026-07-15').id, 'appt-b', 'an appointment id did not disambiguate duplicate names');

Object.assign(context, {
  document: {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
    head: { appendChild() {} },
    body: null,
    documentElement: null
  },
  setTimeout() { return 1; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  MutationObserver: function MutationObserver() { this.observe = function observe() {}; this.disconnect = function disconnect() {}; },
  getComputedStyle() { return { display: 'none' }; },
  _calAppts: [conflicting]
});
vm.runInContext(dayProgress, context);
assert(context.__mlsDayProgress && typeof context.__mlsDayProgress._displayTime === 'function', 'day-progress display resolver was not exposed for regression checks');
assert.strictEqual(
  context.__mlsDayProgress._displayTime({ name: 'Morrie Gold', appt_date: '2026-07-15', time: '12:40' }),
  '8:40 AM',
  'day-progress pill did not resolve the exact authoritative appointment instant'
);

context._calAppts = duplicates;
assert.strictEqual(
  context.__mlsDayProgress._displayTime({ name: 'Alex Same', appt_date: '2026-07-15', time: '12:40' }),
  '',
  'ambiguous duplicate-name rows must hide an untrusted bare time instead of guessing'
);
assert.strictEqual(
  context.__mlsDayProgress._displayTime({ name: 'Alex Same', appt_date: '2026-07-15', time: '4:00 PM' }),
  '4:00 PM',
  'an explicit row meridian should remain usable even when names repeat'
);

assert(!dayProgress.includes('.slice(0,12)'), 'day-progress still uses truncated-name prefix matching');
assert(dayProgress.includes("return ''"), 'day-progress has no honest blank-time fallback');
assert(app.includes("var t=String((a&&(a.start_local||a.time_display||a.time))||'').trim()"), 'up-now fallback selection does not prefer the account-local wall clock');

console.log('PASS day-progress time: practice-timezone instant wins, exact identities resolve, and duplicate names never guess');

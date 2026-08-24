'use strict';

/* The cross-surface link must stay visually identical while idle work is zero:
 * lifecycle/store signals own reconciliation and no permanent patient-count
 * interval is allowed to read a large roster in the background. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_datalink_exact.js'), 'utf8');

function eventTarget(target) {
  const handlers = Object.create(null);
  target.addEventListener = function (name, fn) {
    (handlers[name] || (handlers[name] = [])).push(fn);
  };
  target.removeEventListener = function (name, fn) {
    handlers[name] = (handlers[name] || []).filter(item => item !== fn);
  };
  target.emit = function (name, event) {
    (handlers[name] || []).slice().forEach(fn => fn(event || { type: name }));
  };
  target.listenerCount = name => (handlers[name] || []).length;
  return target;
}

function timerHarness() {
  let nextId = 0;
  const timeouts = new Map();
  const intervals = new Map();
  const intervalDelays = [];
  return {
    setTimeout(fn, delay) {
      const id = ++nextId;
      timeouts.set(id, { fn, delay: Number(delay) || 0 });
      return id;
    },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn, delay) {
      const id = ++nextId;
      const ms = Number(delay) || 0;
      intervalDelays.push(ms);
      intervals.set(id, { fn, delay: ms });
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    runTimeout() {
      const row = timeouts.entries().next();
      if (row.done) return false;
      const [id, task] = row.value;
      timeouts.delete(id);
      task.fn();
      return true;
    },
    get timeoutCount() { return timeouts.size; },
    get intervalCount() { return intervals.size; },
    get intervalDelays() { return intervalDelays.slice(); }
  };
}

const clock = timerHarness();
const idle = timerHarness();
const localStorage = {};
const calls = { roster: 0, bar: 0, nav: 0, calendar: 0, calendarOpen: 0, calendarChrome: 0 };
let activeId = 'p-1';
let calendarApplied = true;
const views = {
  patientsView: { offsetParent: null },
  calendarView: { offsetParent: null }
};
const document = eventTarget({
  readyState: 'complete',
  getElementById(id) { return views[id] || null; },
  querySelector() { return null; }
});
const context = eventTarget({
  location: { pathname: '/ScribeFlow-staging.html' },
  document,
  localStorage,
  __mlsCurrentView: 'visit',
  _calAppts: [{ name: 'Synthetic One', dob: '2000-01-01', start_at: '2026-08-08T09:00:00' }],
  uns(suffix) { return 'sf_u::doctor@example.test::' + suffix; },
  getPatients() {
    calls.roster++;
    return [{ id: 'p-1', name: 'Synthetic One', dob: '2000-01-01' }];
  },
  getActivePtId() { return activeId; },
  renderPatientBar() { calls.bar++; },
  updateNavCounts() { calls.nav++; },
  renderCalendar() { calls.calendar++; },
  calOpenDay(key) { calls.calendar++; calls.calendarOpen++; this._calSelDay = key; },
  loadCalendar() { return { applied: calendarApplied }; },
  loadPatientsFromServer() { return Promise.resolve([]); },
  pullScheduleViaAssist() { return Promise.resolve({ ok: true }); },
  importPatients() { return Promise.resolve({ ok: true }); },
  _importPulledSchedule() { return Promise.resolve({ ok: true }); },
  __mlsCx: { build() { calls.calendarChrome++; } },
  getComputedStyle() { return { display: 'none' }; },
  setTimeout: clock.setTimeout,
  clearTimeout: clock.clearTimeout,
  setInterval: clock.setInterval,
  clearInterval: clock.clearInterval,
  requestIdleCallback(fn) { return idle.setTimeout(fn, 0); },
  cancelIdleCallback(id) { idle.clearTimeout(id); },
  console
});
context.window = context;

vm.runInNewContext(source, context, { filename: 'feat_mls_datalink_exact.js', timeout: 1000 });

assert(context.__mlsLink && context.__mlsLink.version === 'link-1.1.2', 'event-driven data-link did not install');
assert.strictEqual(calls.roster, 0, 'data-link read the full roster during idle boot');
assert.deepStrictEqual(clock.intervalDelays, [700], 'data-link installed an interval beyond its bounded hook-discovery retry');
assert(!clock.intervalDelays.includes(2000), 'legacy two-second data signature poll survived');
[
  'mls:view-changed', 'mls:active-patient-changed', 'mls:patient-record-updated',
  'mls:calendar-session-reset', 'mls:session-boundary', 'mls:ui-ready', 'storage', 'pageshow'
].forEach(name => assert.strictEqual(context.listenerCount(name), 1, name + ' lifecycle listener is not installed exactly once'));

context.emit('storage', { key: 'sf_u::doctor@example.test::notes', storageArea: localStorage });
assert.strictEqual(clock.timeoutCount, 0, 'unrelated storage traffic scheduled cross-surface work');
context.emit('storage', { key: context.uns('patients'), storageArea: localStorage });
assert.strictEqual(clock.timeoutCount, 0, 'hidden heavy views scheduled a cross-tab roster reconciliation');
assert.strictEqual(calls.roster, 0, 'Visit-route store reconciliation scanned the roster');
assert.strictEqual(calls.bar, 0, 'cross-tab roster traffic refreshed hidden shared chrome');
context.emit('pageshow');
context.emit('mls:session-boundary', { detail: { nextAccount: 'doctor@example.test' } });
context.emit('mls:ui-ready');
assert.strictEqual(clock.timeoutCount, 0, 'hidden lifecycle resume entered the timer/click lane');
assert.strictEqual(idle.timeoutCount, 0, 'hidden lifecycle resume scheduled a roster reconciliation');
assert.strictEqual(calls.roster, 0, 'hidden lifecycle resume scanned the roster');

context.emit('mls:patient-record-updated', {
  detail: { patientId: activeId, patientStoreKey: 'sf_u::someone-else@example.test::patients' }
});
assert.strictEqual(clock.timeoutCount, 0, 'another account patient update scheduled work');
context.emit('mls:view-changed', { detail: { previousView: 'visit', view: 'patients' } });
assert.strictEqual(clock.timeoutCount, 1, 'view lifecycle did not queue shared selection reconciliation');
clock.runTimeout();
assert.strictEqual(calls.roster, 0, 'view lifecycle duplicated a heavy surface roster render');
assert.strictEqual(calls.bar, 0, 'view lifecycle redundantly refreshed the patient bar');
context.emit('mls:patient-record-updated', {
  detail: { patientId: activeId, patientStoreKey: context.uns('patients') }
});
context.emit('mls:patient-record-updated', {
  detail: { patientId: activeId, patientStoreKey: context.uns('patients') }
});
assert.strictEqual(clock.timeoutCount, 1, 'rapid store-generation events did not coalesce to one task');
clock.runTimeout();

context.emit('mls:active-patient-changed', { detail: { patientId: activeId } });
assert.strictEqual(clock.timeoutCount, 1, 'active-patient change did not queue selection reflection');
clock.runTimeout();
assert.strictEqual(calls.roster, 0, 'Visit-route selection reflection scanned the roster');

context.__mlsCurrentView = 'calendar';
context.emit('mls:active-patient-changed', { detail: { patientId: activeId } });
clock.runTimeout();
assert.strictEqual(calls.roster, 1, 'visible Calendar selection did not perform its one required patient lookup');
assert(calls.calendar > 0 && calls.calendarChrome > 0, 'visible Calendar no longer follows the selected patient');

context.emit('pageshow');
assert.strictEqual(clock.timeoutCount, 0, 'page resume entered the timer/click lane');
assert.strictEqual(idle.timeoutCount, 1, 'visible page resume did not schedule one idle reconciliation');

/* A successful calendar/server refresh must repaint shared chrome without
 * behaving like a fresh Athena pull. The historical wrapper scheduled two
 * post-pull focus passes, and each could reopen #calDayPanel after Month was
 * selected. Drain the settled refresh: it may render, never open a day. */
while (idle.runTimeout()) {}
const opensBeforeRefresh = calls.calendarOpen;
const rendersBeforeRefresh = calls.calendar;
context.loadCalendar();
while (clock.runTimeout()) {}
assert.strictEqual(calls.calendarOpen, opensBeforeRefresh,
  'an ordinary loadCalendar refresh auto-opened a Calendar day panel');
assert(calls.calendar > rendersBeforeRefresh,
  'a successful ordinary loadCalendar refresh stopped reconciling shared Calendar chrome');

/* A failed/superseded refresh owns the small honest state it just painted.
 * Re-rendering stale _calAppts here caused an 838px late layout jump. */
calendarApplied = false;
const rendersBeforeRefusal = calls.calendar;
context.loadCalendar();
while (clock.runTimeout()) {}
assert.strictEqual(calls.calendar, rendersBeforeRefusal,
  'a non-applied loadCalendar receipt repainted stale in-memory rows');
calendarApplied = true;

/* The behavior was split, not deleted: a genuine schedule import still owns
 * the post-pull focus path. */
context._calSelDay = '';
const opensBeforePull = calls.calendarOpen;
context._importPulledSchedule([]);
while (clock.runTimeout()) {}
assert(calls.calendarOpen > opensBeforePull,
  'a genuine pulled-schedule import no longer focuses the pulled day');

context.__mlsLink.revert();
assert.strictEqual(clock.timeoutCount, 0, 'revert left scheduled data-link work alive');
assert.strictEqual(idle.timeoutCount, 0, 'revert left scheduled idle data-link work alive');
assert.strictEqual(clock.intervalCount, 0, 'revert left the bounded hook retry alive');
[
  'mls:view-changed', 'mls:active-patient-changed', 'mls:patient-record-updated',
  'mls:calendar-session-reset', 'mls:session-boundary', 'mls:ui-ready', 'storage', 'pageshow'
].forEach(name => assert.strictEqual(context.listenerCount(name), 0, name + ' listener leaked after revert'));
const readsAfterRevert = calls.roster;
context.emit('mls:active-patient-changed', { detail: { patientId: activeId } });
assert.strictEqual(calls.roster, readsAfterRevert, 'reverted data-link still read the roster');

console.log('PASS data-link lifecycle is event-driven: zero idle roster reads, exact store filtering, coalesced refresh, clean revert');

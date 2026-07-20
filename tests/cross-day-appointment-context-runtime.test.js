'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_cross_day_context.js'), 'utf8');
const connectSource = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
new Function(source); // syntax gate / ES5-compatible source syntax
assert(source.includes('VERSION = "xdc-2.0.3"'), 'observer-free xdc-2.0.3 release marker is missing');
assert(connectSource.includes("feat_mls_cross_day_context.js") && connectSource.includes("?v=20260719xdc203"),
  'account-clearing cross-day context is not loaded through a fresh immutable asset URL');

// A backend refresh re-executes mls-connect.js in the existing document.  It
// must retire b419's xdc-1.0.0 owner (including its whole-body observer) and
// replace the stale script marker; otherwise the old owner keeps rebuilding
// "Open full workspace" controls even after DaySwitch removes its list.
{
  const loaderStart = connectSource.indexOf(";(function(){try{\n  var A='feat_mls_cross_day_context.js'");
  const loaderEnd = connectSource.indexOf("\n;(function(){try{var A='feat_mls_portal_request_inbox.js'", loaderStart);
  assert(loaderStart >= 0 && loaderEnd > loaderStart, 'could not isolate the xdc hot-refresh loader');
  const loader = connectSource.slice(loaderStart, loaderEnd);
  const removed = [];
  const classRemovals = [];
  const parent = { removeChild(node) { removed.push(node.label); node.parentNode = null; } };
  const staleScript = { label: 'stale-script', parentNode: parent };
  const button = { label: 'legacy-button', parentNode: parent };
  const nodes = new Map(['mlsXdcBanner', 'mlsXdcModal', 'mlsXdcStyle'].map(id => [id, { label: id, parentNode: parent }]));
  const easyBody = { classList: { remove(name) { classRemovals.push(`easy:${name}`); } } };
  nodes.set('mlsEz3Body', easyBody);
  let reverted = 0;
  const appended = [];
  const body = {
    classList: { remove(name) { classRemovals.push(`body:${name}`); } },
    appendChild(node) { appended.push(node); node.parentNode = this; return node; }
  };
  const context = {
    window: { __mlsCrossDayContext: { installed: true, version: 'xdc-1.0.0', revert() { reverted += 1; } } },
    document: {
      body, head: null, documentElement: body,
      querySelectorAll(selector) {
        if (selector === 'script[data-mls-asset="feat_mls_cross_day_context.js"]') return [staleScript];
        if (selector === '.mls-xdc-open') return [button];
        return [];
      },
      getElementById(id) { return nodes.get(id) || null; },
      createElement(tag) {
        return { tagName: tag, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(loader, context, { filename: 'mls-connect.js#xdc-hot-refresh-loader' });
  assert.strictEqual(reverted, 1, 'the b419 xdc owner was not reverted exactly once');
  assert.strictEqual(context.window.__mlsCrossDayContext, undefined, 'the b419 xdc owner survived loader replacement');
  assert.deepStrictEqual(removed.sort(), ['legacy-button', 'mlsXdcBanner', 'mlsXdcModal', 'mlsXdcStyle', 'stale-script'].sort(),
    'the loader left a legacy xdc marker or presentation node behind');
  assert.deepStrictEqual(classRemovals.sort(), ['body:mls-xdc-active', 'easy:mls-xdc-active'].sort(),
    'the loader left the legacy full-workspace presentation class active');
  assert.strictEqual(appended.length, 1, 'the current xdc asset was not loaded exactly once');
  assert.strictEqual(appended[0].src, 'feat_mls_cross_day_context.js?v=20260719xdc203');
  assert.strictEqual(appended[0].attributes['data-mls-asset'], 'feat_mls_cross_day_context.js');
}

// Directly evaluating the satellite (for example a devtools/backend asset
// refresh that bypasses the bundle loader) has the same version-aware prelude.
{
  const preludeStart = source.indexOf('  var prior = null;');
  const preludeEnd = source.indexOf('\n\n  var STYLE_ID', preludeStart);
  assert(preludeStart >= 0 && preludeEnd > preludeStart, 'could not isolate the xdc owner-replacement prelude');
  const prelude = source.slice(preludeStart, preludeEnd);
  const removed = [];
  const parent = { removeChild(node) { removed.push(node.label); node.parentNode = null; } };
  const button = { label: 'legacy-button', parentNode: parent };
  const nodes = new Map(['mlsXdcBanner', 'mlsXdcModal', 'mlsXdcStyle'].map(id => [id, { label: id, parentNode: parent }]));
  nodes.set('mlsEz3Body', { classList: { remove() {} } });
  let reverted = 0;
  const context = {
    NS: '__mlsCrossDayContext', VERSION: 'xdc-2.0.3',
    window: { __mlsCrossDayContext: { installed: true, version: 'xdc-1.0.0', revert() { reverted += 1; } } },
    document: {
      body: { classList: { remove() {} } },
      getElementById(id) { return nodes.get(id) || null; },
      querySelectorAll(selector) { return selector === '.mls-xdc-open' ? [button] : []; }
    }
  };
  vm.createContext(context);
  vm.runInContext(`(function(){${prelude}})();`, context, { filename: 'feat_mls_cross_day_context.js#hot-refresh-prelude' });
  assert.strictEqual(reverted, 1, 'direct satellite refresh did not revert the prior xdc owner');
  assert.strictEqual(context.window.__mlsCrossDayContext, undefined, 'direct satellite refresh left the prior owner installed');
  assert.deepStrictEqual(removed.sort(), ['legacy-button', 'mlsXdcBanner', 'mlsXdcModal', 'mlsXdcStyle'].sort(),
    'direct satellite refresh left legacy xdc presentation residue');
}

function classes() {
  const values = new Set();
  return {
    add(v) { values.add(v); }, remove(v) { values.delete(v); },
    toggle(v, on) { if (on) values.add(v); else values.delete(v); },
    contains(v) { return values.has(v); }
  };
}

const elements = {};
function host() {
  return {
    classList: classes(), children: [], parentNode: null,
    appendChild(node) { node.parentNode = this; this.children.push(node); if (node.id) elements[node.id] = node; return node; },
    removeChild(node) { this.children = this.children.filter(x => x !== node); if (node.id && elements[node.id] === node) delete elements[node.id]; node.parentNode = null; },
    querySelector() { return null; }
  };
}
const body = host();
const head = host();
const documentListeners = {};
const document = {
  readyState: 'complete', body, head, documentElement: body, activeElement: null,
  getElementById(id) { return elements[id] || null; },
  createElement(tag) {
    return {
      tagName: String(tag).toUpperCase(), id: '', className: '', style: {}, classList: classes(), parentNode: null,
      textContent: '', innerHTML: '', attributes: {},
      setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] || null; },
      appendChild() {}, remove() { if (this.parentNode) this.parentNode.removeChild(this); }, querySelector() { return null; }
    };
  },
  addEventListener(type, fn, capture) { (documentListeners[type] || (documentListeners[type] = [])).push({ fn, capture }); },
  removeEventListener() {}
};

const patients = [
  { id: 'PT-FRI', name: 'Friday Patient', dob: '02/03/1980' },
  { id: 'PT-TODAY', name: 'Today Patient', dob: '04/05/1981' },
  { id: 'PT-UNSCHEDULED', name: 'Unscheduled Patient', dob: '06/07/1982' }
];
const friday = {
  id: 701, appointment_id: 'A-FRI', patient_external_id: 'PT-FRI',
  name: 'Friday Patient', dob: '1980-02-03', day_local: '2026-07-17',
  time_display: '9:00 AM', start_local: '09:00', provider: 'Dr Friday'
};
const today = {
  id: 702, appointment_id: 'A-TODAY', patient_external_id: 'PT-TODAY',
  name: 'Today Patient', dob: '1981-04-05', day_local: '2026-07-16',
  time_display: '10:00 AM', start_local: '10:00', provider: 'Dr Today'
};
const appts = [friday, today];

let selected = '2026-07-17';
let snapshotActive = null;
let snapshotPhase = 'idle';
let active = null;
let rowsForCalls = 0;
let pullCalls = 0;
const starts = [], bindings = [], events = [], toasts = [], order = [], actionCalls = [];
const windowListeners = {};

function addWindowListener(type, fn, capture) {
  (windowListeners[type] || (windowListeners[type] = [])).push({ fn, capture: !!capture });
}
function removeWindowListener(type, fn) {
  windowListeners[type] = (windowListeners[type] || []).filter(x => x.fn !== fn);
}

const remote = {
  currentVisitDay() { return selected; },
  snapshot() { return { day: selected, phase: snapshotPhase, active: snapshotActive ? { id: snapshotActive.id } : null }; },
  startVisitFor(id, opts) {
    starts.push({ id: String(id), opts }); order.push('start:' + id);
    const row = appts.find(a => String(a.id) === String(id));
    if (!row || row.day_local !== selected) return false;
    snapshotActive = row;
    active = patients.find(p => p.id === row.patient_external_id) || null;
    return true;
  },
  record() { actionCalls.push('rec'); order.push('action:rec'); return true; },
  generate() { actionCalls.push('gen'); order.push('action:gen'); return true; },
  requestSendReview() { actionCalls.push('send'); order.push('action:send'); return true; }
};

const window = {
  _calAppts: appts,
  _acctTodayKey: () => '2026-07-16',
  getPatients: () => patients,
  activePatient: () => active,
  __mlsDaySwitch: {
    currentDay() { return selected; },
    rowsFor(day) { rowsForCalls++; return appts.filter(a => a.day_local === day); },
    pullDay() { pullCalls++; }
  },
  __mlsEasyV32: { remote },
  _athenaFreezeVisitBinding(patient, meta) { return Object.freeze({ id: 'bind-' + meta.visitContext.appointmentId, patient, meta }); },
  _athenaSetVisitBinding(binding) {
    bindings.push(binding); order.push(binding ? 'bind:' + binding.meta.visitContext.appointmentId : 'clear'); return true;
  },
  calPullChartFor(id) { actionCalls.push('chart:' + id); order.push('action:chart'); },
  openOpPrepForPatient(id) { actionCalls.push('prep:' + id); order.push('action:prep'); },
  toast(message, kind) { toasts.push({ message, kind }); },
  addEventListener: addWindowListener,
  removeEventListener: removeWindowListener,
  dispatchEvent(ev) { events.push(ev); }
};
window.window = window;

class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
}

const context = { window, document, CustomEvent, Date, Object, Array, String, Math, Set, console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_cross_day_context.js' });

const api = window.__mlsCrossDayContext;
assert(api && api.installed && api.version === 'xdc-2.0.3', 'selected-day native-workspace guard did not install');
assert.strictEqual(api._test.selectedDay(), '2026-07-17', 'selected day did not come from the DaySwitch API');
assert(windowListeners.click && windowListeners.click.length === 1 && windowListeners.click[0].capture, 'guard must intercept on window capture before Easy document capture');
assert(!documentListeners.click, 'a late document capture listener cannot preempt native Easy and must not be used');

function target(attrs, id) {
  attrs = attrs || {};
  const easy = { id: 'mlsEz3' };
  const owner = { id: id || '', getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? String(attrs[name]) : null; } };
  return {
    id: id || '',
    closest(selector) {
      if (selector === '#mlsEz3') return easy;
      if (selector === '#ez3Back' && id === 'ez3Back') return owner;
      if (selector === '#ez3Change' && id === 'ez3Change') return owner;
      if (selector === '[data-xdc-close]' && attrs['data-xdc-close'] != null) return owner;
      if (selector === '[data-more]' && attrs['data-more'] != null) return owner;
      if (selector === '[data-act]' && attrs['data-act'] != null) return owner;
      if (selector === '[data-q]' && attrs['data-q'] != null) return owner;
      if (selector === '[data-hd]' && attrs['data-hd'] != null) return owner;
      if (selector === '[data-pt]' && attrs['data-pt'] != null) return owner;
      return null;
    }
  };
}
function click(t) {
  const flags = { prevented: false, stopped: false, immediate: false };
  const ev = {
    target: t,
    preventDefault() { flags.prevented = true; },
    stopPropagation() { flags.stopped = true; },
    stopImmediatePropagation() { flags.immediate = true; }
  };
  windowListeners.click[0].fn(ev);
  return flags;
}
function fire(type, detail) {
  (windowListeners[type] || []).slice().forEach(x => x.fn({ type, detail }));
}
function resetVisit() {
  api.clear('test-reset'); snapshotActive = null; active = null; snapshotPhase = 'idle'; closeFailure();
}
function closeFailure() {
  const modal = document.getElementById('mlsXdcModal');
  if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
}

const fridayKey = api._test.rowKey(friday);

// Native quick-select opens the exact row, binds first, and runs no extra action.
let flags = click(target({ 'data-q': fridayKey }));
assert(flags.prevented && flags.stopped && flags.immediate, 'non-today native quick-select was not fully intercepted');
assert.strictEqual(starts[0].id, '701', 'quick-select started a different appointment');
assert(starts[0].opts && starts[0].opts.record === false && Object.keys(starts[0].opts).length === 1, 'guard must activate without smuggling an action into startVisitFor');
assert.deepStrictEqual(order.slice(0, 2), ['start:701', 'bind:A-FRI'], 'exact binding was not installed immediately after activation');
assert(api.current() && api.current().appointmentId === 'A-FRI' && api.current().date === '2026-07-17' && api.current().provider === 'Dr Friday', 'immutable date/appointment/provider context is incomplete');
assert(Object.isFrozen(api.current()), 'appointment context must be immutable');
assert.strictEqual(actionCalls.length, 0, 'quick-select performed an unrequested action');
const firstBinding = bindings.find(Boolean);
assert(firstBinding && firstBinding.meta.visitContext.visitDate === '2026-07-17', 'binding lost the selected visit date');
assert.strictEqual(firstBinding.meta.visitContext.appointmentId, 'A-FRI', 'binding lost the exact appointment id');
assert.strictEqual(firstBinding.meta.visitContext.provider, 'Dr Friday', 'binding lost the exact provider');
assert(rowsForCalls > 0, 'exact resolution did not cross-check DaySwitch rowsFor(selectedDay)');

// Back clears only the local binding and remains available to native Easy.
flags = click(target({}, 'ez3Back'));
assert(!flags.prevented && !flags.stopped, 'Back was swallowed instead of being left to native Easy');
assert.strictEqual(api.current(), null, 'Back did not clear selected-day context');
assert.strictEqual(bindings[bindings.length - 1], null, 'Back left a stale visit binding');

// Native patient-row header uses the same exact activation path.
flags = click(target({ 'data-hd': fridayKey }));
assert(flags.immediate && api.current() && api.current().sourceId === '701', 'native row header did not open the exact selected-day appointment');
fire('mls:active-patient-changed', { patientId: 'SOMEONE-ELSE' });
assert.strictEqual(api.current(), null, 'changing patients did not clear the exact binding');

// Whitelisted row actions run only after exact activation and binding.
function assertAction(action, expected) {
  resetVisit();
  const beforeOrder = order.length;
  const beforeCalls = actionCalls.length;
  const actionFlags = click(target({ 'data-act': action, 'data-k': fridayKey }));
  assert(actionFlags.immediate, action + ' click was not intercepted');
  assert.deepStrictEqual(order.slice(beforeOrder, beforeOrder + 3), ['start:701', 'bind:A-FRI', 'action:' + action], action + ' did not run strictly after activation and binding');
  assert.strictEqual(actionCalls[beforeCalls], expected, action + ' performed a different action');
}
assertAction('rec', 'rec');
assertAction('chart', 'chart:701');
assertAction('gen', 'gen');
assertAction('send', 'send');
assertAction('prep', 'prep:PT-FRI');

// A broader patient-search row may never bypass the selected-day appointment
// contract. One exact scheduled match is converted to that appointment; an
// unscheduled or multiply-scheduled patient fails closed.
resetVisit();
flags = click(target({ 'data-pt': 'PT-FRI' }));
assert(flags.immediate && api.current() && api.current().appointmentId === 'A-FRI', 'data-pt did not convert one exact selected-day match into its scheduled appointment');
resetVisit();
const beforeUnscheduled = starts.length;
flags = click(target({ 'data-pt': 'PT-UNSCHEDULED' }));
assert(flags.immediate, 'non-today broader patient row escaped the capture guard');
assert.strictEqual(starts.length, beforeUnscheduled, 'unscheduled broader patient row created an unbound visit');
assert(/does not have one exact appointment/i.test(document.getElementById('mlsXdcModal').innerHTML), 'unscheduled patient failure did not explain the exact-appointment requirement');
closeFailure();
const fridaySecond = Object.assign({}, friday, { id: 797, appointment_id: 'A-FRI-SECOND', start_local: '13:00', time_display: '1:00 PM' });
appts.push(fridaySecond);
flags = click(target({ 'data-pt': 'PT-FRI' }));
assert.strictEqual(starts.length, beforeUnscheduled, 'multiply-scheduled broader patient row guessed an appointment');
assert(/more than one appointment/i.test(document.getElementById('mlsXdcModal').innerHTML), 'multiply-scheduled patient failure did not tell the doctor to choose the exact row');
appts.pop(); closeFailure();

// Selected-day browsing clears context but performs no pull, Athena read, or action.
const pullsBeforeDayChange = pullCalls;
const actionsBeforeDayChange = actionCalls.length;
selected = '2026-07-18';
fire('mls:visit-day-changed', { day: selected, previousDay: '2026-07-17' });
assert.strictEqual(api.current(), null, 'selected-day change did not clear context');
assert.strictEqual(pullCalls, pullsBeforeDayChange, 'date browsing triggered a schedule pull');
assert.strictEqual(actionCalls.length, actionsBeforeDayChange, 'date browsing triggered a patient/Athena action');

// Today is owned entirely by native Easy; the companion must leave it untouched.
selected = '2026-07-16';
const startsBeforeToday = starts.length;
flags = click(target({ 'data-q': api._test.rowKey(today) }));
assert(!flags.prevented && !flags.stopped && !flags.immediate, 'today click was intercepted instead of staying native');
assert.strictEqual(starts.length, startsBeforeToday, 'companion duplicated native Today activation');

// Duplicate exact-looking rows fail closed before opening or running anything.
selected = '2026-07-17';
const duplicate = Object.assign({}, friday, { id: 701, appointment_id: 'A-FRI-DUP' });
appts.push(duplicate);
const startsBeforeAmbiguous = starts.length;
const actionsBeforeAmbiguous = actionCalls.length;
flags = click(target({ 'data-act': 'rec', 'data-k': fridayKey }));
assert(flags.immediate, 'ambiguous row was not captured');
assert.strictEqual(starts.length, startsBeforeAmbiguous, 'ambiguous appointment was activated');
assert.strictEqual(actionCalls.length, actionsBeforeAmbiguous, 'ambiguous appointment ran the requested action');
assert(document.getElementById('mlsXdcModal'), 'ambiguity did not produce a clear blocking modal');
assert(/more than one appointment/i.test(document.getElementById('mlsXdcModal').innerHTML), 'ambiguity modal did not explain that MLS refused to guess');
appts.pop(); closeFailure();

// Repeated transport rows dedupe only when their complete binding identity is
// identical. Same source/appointment IDs with conflicting identity evidence
// remain separate candidates and fail closed, even if the conflict changes
// the native row key or moves the second row to another filed date.
resetVisit();
const byteEquivalent = Object.assign({}, friday);
appts.push(byteEquivalent);
const beforeEquivalent = starts.length;
flags = click(target({ 'data-q': fridayKey }));
assert.strictEqual(starts.length, beforeEquivalent + 1, 'truly identical repeated row did not dedupe to one exact appointment');
assert(api.current() && api.current().appointmentId === 'A-FRI', 'identical transport duplicate lost the exact binding');
appts.pop();

function assertSameIdConflict(changes, label) {
  resetVisit();
  const conflicting = Object.assign({}, friday, changes, { id: friday.id, appointment_id: friday.appointment_id });
  appts.push(conflicting);
  const before = starts.length;
  const actionBefore = actionCalls.length;
  const conflictFlags = click(target({ 'data-act': 'rec', 'data-k': fridayKey }));
  assert(conflictFlags.immediate, label + ' same-ID conflict escaped capture');
  assert.strictEqual(starts.length, before, label + ' same-ID conflict was activated');
  assert.strictEqual(actionCalls.length, actionBefore, label + ' same-ID conflict ran the requested action');
  const modal = document.getElementById('mlsXdcModal');
  assert(modal && /more than one appointment/i.test(modal.innerHTML), label + ' same-ID conflict did not fail as an ambiguous appointment');
  appts.pop(); closeFailure();
}
assertSameIdConflict({ patient_external_id: 'PT-CONFLICT', name: 'Different Patient', dob: '1971-01-01' }, 'patient');
assertSameIdConflict({ appt_date: '2026-07-18' }, 'date');
assertSameIdConflict({ provider: 'Dr Different' }, 'provider');
assertSameIdConflict({ start_local: '15:30', time_display: '3:30 PM' }, 'time');

// Missing exact provider and unapproved data-act both fail before activation.
const noProvider = Object.assign({}, friday, { id: 798, appointment_id: 'A-NOPROV', provider: '', start_local: '11:00', time_display: '11:00 AM' });
appts.push(noProvider);
const noProviderKey = api._test.rowKey(noProvider);
const beforeMissing = starts.length;
click(target({ 'data-hd': noProviderKey }));
assert.strictEqual(starts.length, beforeMissing, 'provider-less appointment opened without an immutable provider context');
assert(/no exact provider/i.test(document.getElementById('mlsXdcModal').innerHTML), 'provider failure did not explain the missing exact context');
appts.pop(); closeFailure();
click(target({ 'data-act': 'delete', 'data-k': fridayKey }));
assert.strictEqual(starts.length, beforeMissing, 'unapproved action activated the appointment');
assert(/not approved/i.test(document.getElementById('mlsXdcModal').innerHTML), 'unapproved action did not fail clearly');
closeFailure();

// Public openAppointment remains available to the selected-day strip coupling.
resetVisit();
assert.strictEqual(api.openAppointment(friday), true, 'public exact-row opener did not support selected-day coupling');
assert(api.current() && api.current().appointmentId === 'A-FRI', 'public opener did not install the same exact binding');

// Account boundaries synchronously destroy the private frozen context as well
// as the base binding. Same-day/same-ID collisions in the next account must
// never inherit this account's patient/provider identity.
assert(windowListeners['mls:session-boundary'] && windowListeners['mls:session-boundary'].length === 1,
  'cross-day context did not subscribe to account boundaries');
fire('mls:session-boundary', { previousAccount: 'a@example.test', nextAccount: 'b@example.test', epoch: 9 });
assert.strictEqual(api.current(), null, 'account boundary left the prior patient/appointment context readable');
assert.strictEqual(bindings[bindings.length - 1], null, 'account boundary left the prior exact visit binding installed');
assert.strictEqual(document.getElementById('mlsXdcModal'), null, 'account boundary left a prior-account blocking modal visible');

assert(events.some(e => e.type === 'mls:appointment-context-changed' && e.detail.active && e.detail.date === '2026-07-17'), 'exact context activation was not published to dependent tools');
assert(!/mlsDsList|mlsXdcChange/.test(source), 'legacy alternate-day list/change UI survived');
assert(!/className\s*=\s*["']mls-xdc-open|textContent\s*=.*Open full workspace|\.id\s*=\s*["']mlsXdcBanner/.test(source),
  'the current xdc owner still creates a legacy full-workspace button or banner');
assert(!/new\s+MutationObserver|function\s+scheduleDecorate\s*\(|function\s+decorate\s*\(/.test(source),
  'the current xdc owner still installs the b419 mutation/decorate loop');
assert(!/pullScheduleViaAssist|__mlsSI\.pull|postMessage\(|pushAllEmrBtn/.test(source), 'selected-day guard contains a passive pull, direct extension command, or write path');
assert(source.includes('window.addEventListener("click", onCaptureClick, true)'), 'capture-order contract is not explicit in source');
assert(source.includes('window.addEventListener("mls:session-boundary", onSessionBoundary)') &&
       source.includes('window.removeEventListener("mls:session-boundary", onSessionBoundary)'),
  'account-boundary listener lifecycle is incomplete');

/* ---------------------------------------------------------------------------
 * b438 regression pins.
 *
 * Every appointment fixture in this file supplies an invented appointment_id
 * ('A-FRI', 'A-TODAY', ...). Real pulled rows routinely have NONE: the only
 * producer is the extension's schedule DOM scrape, and when it yields nothing
 * the field is empty for the whole day. Because the fixtures fabricated the
 * field, this suite stayed green while every non-today patient click failed
 * closed with "Appointment not opened" in production. These pins encode the
 * two contracts that regression violated.
 * ------------------------------------------------------------------------- */

// (1) A missing Athena appointment id must not block OPENING a chart. It is a
//     destination identifier, not a patient identifier.
assert(!/reason:\s*"appointment-id-missing"/.test(source),
  'resolveForKey blocks opening on a missing Athena appointment id again - every pulled row without one becomes unopenable');

// (2) ...while every real identity check still fails closed.
['source-id-missing', 'provider-missing', 'ambiguous-appointment', 'stale-row', 'wrong-selected-day'].forEach(reason => {
  assert(source.includes('"' + reason + '"'),
    'identity check "' + reason + '" was removed from the selected-day resolver');
});
assert(/candidates\.length !== 1/.test(source),
  'the single-candidate rule that makes ambiguity fail closed was removed');

// (3) An action that could not START must not clear the frozen binding. The
//     binding is a constraint, not a capability: it pins the note to the
//     selected day and forces Athena writes to refuse. Clearing it while the
//     visit stayed open handed the visit to manual-entry binding, which
//     re-dated a pulled-day note to today AND flipped the write gate to ready.
assert(!/clear\("action-failed"\)/.test(source),
  'an action failure clears the exact visit binding again - the open visit re-dates itself to today');
assert(/if \(!performAction\(requestedAction, a, resolvedPatient\.patient, remote\)\) \{\s*\n\s*return showFailure\("action-unavailable"\);/.test(source),
  'the action-failure path no longer returns with the binding intact');

console.log('PASS cross-day appointment context: every date stays in native Easy; exact selected-day clicks bind before one requested safe action and ambiguity fails closed');

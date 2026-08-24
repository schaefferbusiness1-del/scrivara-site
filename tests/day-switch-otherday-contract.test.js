'use strict';

/* ds-2.0.2 contract: the date strip changes the date owned by the native Easy
 * Visit workspace. It must never replace that workspace with a second patient
 * list or hide it for non-today dates. A rejected Easy transition is atomic:
 * the strip remains on the prior day. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const connect = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const dsStart = connect.indexOf('/* ===== __mlsDaySwitch ds-2.0.2');
const dsEnd = connect.indexOf('/* ===== __mlsVisitSavePref', dsStart);
assert(dsStart >= 0 && dsEnd > dsStart, 'ds-2.0.2 day-switch module boundary was not found');
const ds = connect.slice(dsStart, dsEnd);
const productionShell = fs.readFileSync(path.resolve(__dirname, '..', 'ScribeFlow.html'), 'utf8');
const stagingShell = fs.readFileSync(path.resolve(__dirname, '..', 'ScribeFlow-staging.html'), 'utf8');

function functionSource(text, name, nextName) {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`\n  function ${nextName}(`, start);
  assert(start >= 0 && end > start, `could not bound ${name}`);
  return text.slice(start, end);
}

assert(ds.includes("version: 'ds-2.0.2'"), 'ds-2.0.2 release marker is missing');
assert(ds.includes("window.addEventListener('mls:easy-mode-changed', onEasyModeChanged)"),
  'DaySwitch still depends on polling to learn Staff/doctor ownership');
assert(ds.includes("if (easyMode() === 'staff') { removeDoctorDayControls(); return; }"),
  'DaySwitch does not synchronously suppress doctor-day controls in Staff mode');

// One Visit shell for every date. Stale legacy nodes may be removed during an
// upgrade, but this release may never create one or hide the Easy workspace.
assert(!/\.id\s*=\s*['"]mlsDsList['"]/.test(ds), 'DaySwitch still creates the retired mlsDsList');
assert(!/id=["']mlsDsList["']/.test(ds), 'DaySwitch still renders the retired mlsDsList');
assert(!/setAttribute\(\s*['"]id['"]\s*,\s*['"]mlsDsList['"]/.test(ds), 'DaySwitch still assigns the retired mlsDsList id');
assert(!/ez3Wrap\s*\{[^}]*display\s*:\s*none/i.test(ds),
  'DaySwitch still hides the native Easy Visit workspace on another day');
assert(!/classList\.(?:add|toggle)\(['"]mls-ds-otherday/.test(ds),
  'DaySwitch still switches into the retired other-day presentation');
assert(productionShell.includes('#mlsDsList{display:none!important}') && stagingShell.includes('#mlsDsList{display:none!important}'),
  'the shells can flash the retired b419 other-day list during an in-place runtime upgrade');
const renderList = functionSource(ds, 'renderList', 'syncStrip');
assert(renderList.includes("var old = $('mlsDsList'); if (old) old.remove();"),
  'the upgrade path must remove a stale legacy other-day list');
assert(renderList.includes("easy.remote.setVisitDay(DS.day)"),
  'refreshes must target the native Easy Visit shell');

// A same-document asset refresh must evict the exact b419-style owner and its
// separate list. This is the path used by the backend reload portal; a normal
// hard reload also starts clean and reaches the same single owner.
assert(ds.includes("if (prior && prior.version === 'ds-2.0.2') return;"),
  'the hot-upgrade guard does not recognize the exact current owner');
assert(ds.includes("if (typeof prior.revert === 'function') prior.revert();"),
  'an older DaySwitch owner is not reverted during a hot upgrade');
assert(ds.includes("['mlsDsList', 'mlsDsStrip', 'mlsDsPullBar', 'mlsDsCss']"),
  'the hot-upgrade path does not remove every retired presentation node');
const ensureSource = functionSource(ds, 'ensure', 'onEasyVisitDayChanged');
assert(ensureSource.includes("var staleLegacyList = $('mlsDsList'); if (staleLegacyList) staleLegacyList.remove();"),
  'the recovery loop can leave the b419 other-day list beside the Easy workspace');
{
  const iifeStart = ds.indexOf('(function () {');
  const apiStart = ds.indexOf('  var api =', iifeStart);
  assert(iifeStart >= 0 && apiStart > iifeStart, 'could not bound the hot-upgrade prelude');
  const prelude = ds.slice(iifeStart + '(function () {'.length, apiStart);
  const removed = [];
  let reverted = 0;
  const nodes = new Map(['mlsDsList', 'mlsDsStrip', 'mlsDsPullBar', 'mlsDsCss'].map(id => [id, { remove() { removed.push(id); } }]));
  const context = {
    window: { __mlsDaySwitch: { version: 'ds-1.9.0', revert() { reverted += 1; } } },
    document: { getElementById(id) { return nodes.get(id) || null; } }
  };
  vm.createContext(context);
  vm.runInContext(`(function(){${prelude}})();`, context);
  assert.strictEqual(reverted, 1, 'the prior day owner was not reverted exactly once');
  assert.deepStrictEqual(removed.sort(), ['mlsDsCss', 'mlsDsList', 'mlsDsPullBar', 'mlsDsStrip'],
    'the same-document upgrade left legacy day-view UI behind');
  assert.strictEqual(context.window.__mlsDaySwitch, undefined, 'the older day owner survived the upgrade prelude');
}

// The strip itself must also keep one topology. Today is a fixed, quiet
// control in the same position on every date; native disabled state, not
// conditional insertion/visibility, communicates that Today is selected.
const syncStripSource = functionSource(ds, 'syncStrip', 'setDay');
assert(ds.includes('id="mlsDsTodayBtn" aria-label="Go to Today">Today</button>'),
  'the fixed Today shortcut is missing from the date strip');
assert(ds.includes('id="mlsDsPrev" title="Previous day" aria-label="Previous day"') &&
  ds.includes('id="mlsDsNext" title="Next day" aria-label="Next day"'),
  'day arrows need descriptive accessible names');
assert(ds.includes("strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'Visit date controls')") &&
  ds.includes('id="mlsDsDayLbl" aria-live="polite" aria-atomic="true"'),
  'date controls need a named group and live selected-day announcement');
assert(ds.includes('#mlsDsStrip .ds-nav{width:44px;height:44px;'),
  'day arrows are smaller than the 44px touch target');
assert(!ds.includes('>Back to Today</button>'),
  'the conditional-looking Back to Today copy survived');
assert(syncStripSource.includes("tb.style.display = '';"),
  'Today shortcut visibility is not stable across dates');
assert(syncStripSource.includes('tb.disabled = !!isToday;'),
  'Today shortcut does not use native selected-day disabled state');
assert(syncStripSource.includes('lb && lb.innerHTML !== desiredDayLabel'),
  'day label is rebuilt on every recovery poll even when its value is unchanged');
assert(!/tb\.style\.display\s*=\s*isToday\s*\?/.test(syncStripSource),
  'Today shortcut is still hidden conditionally');
{
  const attrs = {};
  const label = { innerHTML: '' };
  /* getAttribute is part of the contract this double stands in for. syncStrip
     now compares before it commits — an unchanged attribute still notifies every
     observer watching it, and the Today tooltip in particular was caught writing
     13 times with no same-value write, because the tooltip dedupe strips `title`
     between passes so a guard on it can never hold. A double that implements
     only the write half cannot exercise a read-before-write writer. */
  const today = {
    style: { display: 'none' }, disabled: false, title: '',
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; }
  };
  const DS = { day: '2026-07-19' };
  const ctx = {
    DS,
    $(id) { if (id === 'mlsDsDayLbl') return label; if (id === 'mlsDsTodayBtn') return today; return null; },
    todayKey() { return '2026-07-19'; },
    fmtDay(day) { return day; },
    esc(value) { return String(value); },
    dsHydrateTerminalReceipt() { return null; }
  };
  vm.createContext(ctx);
  vm.runInContext(`${syncStripSource}\nthis.syncStrip = syncStrip;`, ctx);
  ctx.syncStrip();
  assert.strictEqual(today.style.display, '', 'Today shortcut is hidden on Today');
  assert.strictEqual(today.disabled, true, 'Today shortcut is actionable while already on Today');
  assert.strictEqual(attrs['aria-disabled'], 'true');
  assert.strictEqual(attrs['aria-current'], 'date');
  /* The tooltip moved from title to data-tip. feat_athena_tooltip_dedupe strips
     title to data-tip and REMOVES it, so writing title meant a guard could never
     hold - getAttribute returns null and the write repeats forever (13 captured
     on the owner's tab, none a same-value write). data-tip is the channel the
     hover bubble actually reads and nothing removes it. Still asserting the user
     gets the words, just on the surviving channel. */
  assert.strictEqual(attrs['data-tip'], 'Already viewing Today');
  assert.strictEqual(today.title, '', 'the Today shortcut must not write title - it is stripped between passes');

  DS.day = '2026-07-20';
  ctx.syncStrip();
  assert.strictEqual(today.style.display, '', 'Today shortcut disappeared on another date');
  assert.strictEqual(today.disabled, false, 'Today shortcut stayed disabled on another date');
  assert.strictEqual(attrs['aria-disabled'], 'false');
  assert.strictEqual(attrs['aria-current'], 'false');
  assert.strictEqual(attrs['data-tip'], 'Go to Today');
  assert.strictEqual(today.title, '', 'the Today shortcut must not write title on either branch');
}

// The date/row authority is public; consumers must not scrape labels or build
// another presentation model.
assert(ds.includes('api.currentDay = function () { return DS.day; };'), 'currentDay is not public');
assert(ds.includes('api.rowsFor = rowsFor;'), 'rowsFor is not public');
assert(ds.includes('api.pullDay = startPull;'), 'pullDay is not public');

// rowsFor uses the filed Athena appointment date first and returns the exact
// original appointment objects, retaining appointment/encounter identity.
const rowsForSource = functionSource(ds, 'rowsFor', 'renderList');
const rowSortMinuteStart = ds.indexOf('function rowSortMinute(');
const rowSortMinuteEnd = ds.indexOf('\n\n  var st =', rowSortMinuteStart);
assert(rowSortMinuteStart >= 0 && rowSortMinuteEnd > rowSortMinuteStart, 'could not bound rowSortMinute');
const rowSortMinuteSource = ds.slice(rowSortMinuteStart, rowSortMinuteEnd);
assert(rowsForSource.includes("String(a.appt_date || a.day_local || '').slice(0, 10)"),
  'rowsFor must bucket by appt_date before the recomputed day_local');
assert(rowsForSource.includes('out.push(a);'), 'rowsFor must return exact appointment objects');
{
  const selected = '2026-07-22';
  const first = {
    id: 'patient-1', appointmentId: 'appt-1', encounterId: 'enc-1', name: 'Alpha Patient',
    appt_date: selected, day_local: '2026-07-23', time_display: '9:00 AM'
  };
  const identicalDuplicate = { ...first };
  const conflictingDuplicate = {
    ...first, name: 'Conflicting Identity', dob: '02/02/1980', time_display: '11:00 AM'
  };
  const second = {
    id: 'patient-2', appointmentId: 'appt-2', encounterId: 'enc-2', name: 'Beta Patient',
    appt_date: selected, day_local: selected, time_display: '10:00 AM'
  };
  const wrongFiledDay = {
    id: 'patient-3', appointmentId: 'appt-3', name: 'Wrong Day',
    appt_date: '2026-07-21', day_local: selected, time_display: '8:00 AM'
  };
  const staff = {
    appointmentId: 'staff-1', name: 'Office Staff', appt_date: selected, time_display: '8:30 AM'
  };
  const ctx = {
    window: {
      _calAppts: [wrongFiledDay, first, identicalDuplicate, second, conflictingDuplicate, staff],
      __mlsStaffMark: { isStaff(name) { return name === 'Office Staff'; } }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(`${rowSortMinuteSource}\n${rowsForSource}\nthis.rowsFor = rowsFor;`, ctx);
  const rows = Array.from(ctx.rowsFor(selected));
  assert.deepStrictEqual(rows, [first, second, conflictingDuplicate],
    'rowsFor must use filed day, dedupe only identical rows, retain conflicts for fail-closed ambiguity, and sort by clock time');
  assert.strictEqual(rows[0], first, 'rowsFor must preserve the original exact appointment object');
  assert.strictEqual(rows[0].encounterId, 'enc-1', 'rowsFor must retain exact encounter identity');
}

// Exercise the real setDay transaction. A rejection or exception must restore
// the prior strip day and emit no committed-day event.
const setDaySource = functionSource(ds, 'setDay', 'shift');
{
  const calls = [];
  const events = [];
  const ctx = {
    DS: { day: '2026-07-19', followToday: true },
    acceptance: false,
    throwOnSet: false,
    todayKey() { return '2026-07-19'; },
    dsSyncDiagBtn() {},
    syncStrip() { calls.push('sync'); },
    renderList() { calls.push('render'); },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
    window: {
      toast() {},
      dispatchEvent(ev) { events.push(ev); },
      __mlsEasyV32: { remote: { setVisitDay(day) {
        calls.push(`easy:${day}`);
        if (ctx.throwOnSet) throw new Error('transition failed');
        return ctx.acceptance;
      } } }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(`${setDaySource}\nthis.setDay = setDay;`, ctx);

  assert.strictEqual(ctx.setDay('2026-07-20'), false, 'a rejected Easy transition must reject the strip change');
  assert.strictEqual(ctx.DS.day, '2026-07-19', 'a rejected transition must roll back to the prior day');
  assert.strictEqual(ctx.DS.followToday, true, 'a rejected transition must restore Today-follow ownership');
  assert.deepStrictEqual(events, [], 'a rejected transition must not announce a committed day');
  assert(calls.includes('easy:2026-07-20'), 'DaySwitch must ask Easy to accept the selected day');

  ctx.acceptance = true;
  assert.strictEqual(ctx.setDay('2026-07-20'), true, 'an accepted Easy transition must commit');
  assert.strictEqual(ctx.DS.day, '2026-07-20', 'the strip must commit the accepted day');
  assert.strictEqual(ctx.DS.followToday, false, 'an explicit future day must stop following account-day rollover');
  assert.strictEqual(events.length, 1, 'an accepted transition must emit one committed-day event');
  assert.strictEqual(events[0].detail.day, '2026-07-20');
  assert.strictEqual(events[0].detail.previousDay, '2026-07-19');

  ctx.throwOnSet = true;
  assert.strictEqual(ctx.setDay('2026-07-21'), false, 'an Easy transition exception must fail closed');
  assert.strictEqual(ctx.DS.day, '2026-07-20', 'an exception must roll back to the last committed day');
  assert.strictEqual(events.length, 1, 'an exception must not emit a committed-day event');
}

console.log('PASS ds-2.0.2: hot upgrades evict the b419 list; every date reuses the native Easy Visit shell; exact rows and date/mode changes stay atomic');

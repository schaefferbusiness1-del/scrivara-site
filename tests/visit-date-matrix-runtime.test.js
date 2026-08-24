'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.TZ = 'America/Indiana/Indianapolis';

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const easyVersionMatch = source.match(/var VER = '3\.7\.\d+'/);
const easyStart = easyVersionMatch ? easyVersionMatch.index : -1;
const easyEnd = source.indexOf('window.__mlsEasyV32 = api;', easyStart);
assert(easyStart >= 0 && easyEnd > easyStart, 'canonical Easy 3.7.x module was not found');
const easy = source.slice(easyStart, easyEnd);
const dsStart = source.search(/\/\* ===== __mlsDaySwitch ds-2\.\d+\.\d+/);
const dsEnd = source.indexOf('/* ===== __mlsVisitSavePref', dsStart);
assert(dsStart >= 0 && dsEnd > dsStart, 'canonical ds-2.x module was not found');
const ds = source.slice(dsStart, dsEnd);

function functionSource(text, name, nextName) {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`\n  function ${nextName}(`, start);
  assert(start >= 0 && end > start, `could not bound ${name}`);
  return text.slice(start, end);
}

/* Staff Prep and month-pull defaults must share the account-local Today
 * authority. Simulate an office computer already on March 1 while the
 * account/practice is still on February 28: Tomorrow, month filters, the
 * month input default/max, and future-month rejection must all stay with the
 * account date. This is the midnight + month-boundary failure a same-TZ test
 * cannot expose. */
{
  const pad2Easy = functionSource(easy, 'pad2', 'ymd');
  const ymdEasy = functionSource(easy, 'ymd', 'todayLocal');
  const todayEasy = functionSource(easy, 'todayLocal', 'accountDate');
  const accountDateEasy = functionSource(easy, 'accountDate', 'visitDay');
  const tomorrowEasy = functionSource(easy, 'tomorrowLocal', 'viewMonthRange');
  const monthRangeEasy = functionSource(easy, 'viewMonthRange', 't12');
  const pullMonthRangeEasy = functionSource(easy, 'pullMonthRange', 'accountYm');
  const accountYmEasy = functionSource(easy, 'accountYm', 'prevYm');
  const prevYmEasy = functionSource(easy, 'prevYm', 'nowYm');
  const nowYmEasy = functionSource(easy, 'nowYm', 'freshPull');
  assert(!/new Date\(\s*\)/.test(tomorrowEasy + monthRangeEasy + accountYmEasy + prevYmEasy + nowYmEasy),
    'a relative Staff/month date still reads the browser clock directly');
  assert(/String\(todayLocal\(\)\)\.split\('-'\)/.test(accountDateEasy),
    'relative Staff dates are not derived from account-local Today');
  assert(/String\(todayLocal\(\)\)\.split\('-'\)/.test(monthRangeEasy),
    'Staff month ranges are not derived from account-local Today');

  let accountToday = '2026-02-28';
  let zeroArgDateCalls = 0;
  class BrowserDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else { zeroArgDateCalls++; super('2026-03-01T12:30:00.000Z'); }
    }
  }
  const ctx = {
    Date: BrowserDate,
    String,
    window: { _acctTodayKey() { return accountToday; } },
    MONTH_NAMES: ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December']
  };
  vm.createContext(ctx);
  vm.runInContext([
    pad2Easy, ymdEasy, todayEasy, accountDateEasy, tomorrowEasy, monthRangeEasy,
    pullMonthRangeEasy, accountYmEasy, prevYmEasy, nowYmEasy,
    'this.todayLocal=todayLocal;this.tomorrowLocal=tomorrowLocal;this.viewMonthRange=viewMonthRange;',
    'this.pullMonthRange=pullMonthRange;this.prevYm=prevYm;this.nowYm=nowYm;'
  ].join('\n'), ctx, { filename: 'mls-connect.js#account-local-staff-dates' });

  assert.strictEqual(ctx.todayLocal(), '2026-02-28', 'account-local Today lost to browser-local March 1');
  assert.strictEqual(ctx.tomorrowLocal(), '2026-03-01', 'account-local Tomorrow skipped the month boundary');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.viewMonthRange(0))),
    { from: '2026-02-01', to: '2026-02-28' }, 'This month followed the browser month');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.viewMonthRange(-1))),
    { from: '2026-01-01', to: '2026-01-31' }, 'Last month followed the browser month');
  assert.strictEqual(ctx.nowYm(), '2026-02', 'month input max followed the browser month');
  assert.strictEqual(ctx.prevYm(), '2026-01', 'month input default followed the browser month');
  const currentMonth = ctx.pullMonthRange(ctx.nowYm());
  assert(currentMonth && currentMonth.from === '2026-02-01' && currentMonth.to === '2026-02-28',
    `current account month range was wrong: ${JSON.stringify(currentMonth)}`);
  assert.strictEqual(currentMonth.keys.length, 28, 'current account month did not contain every day through account Today');
  assert.strictEqual(ctx.pullMonthRange('2026-03'), null,
    'browser-local March was accepted while the account was still in February');
  assert.strictEqual(zeroArgDateCalls, 0, 'Staff/month calculations consulted the browser clock despite account Today');

  accountToday = '2026-12-31';
  assert.strictEqual(ctx.tomorrowLocal(), '2027-01-01', 'account-local Tomorrow failed the year boundary');
  assert.strictEqual(ctx.nowYm(), '2026-12', 'month max failed the account-local year boundary');
  assert.strictEqual(ctx.prevYm(), '2026-11', 'previous month failed the account-local year boundary');
}

/* The real strip date arithmetic must advance calendar dates, not add 24-hour
 * millisecond chunks. Noon anchoring is what keeps spring/fall DST safe. */
const pad2Source = functionSource(ds, 'pad2', 'keyOf');
const keyOfSource = functionSource(ds, 'keyOf', 'todayKey');
const parseKeySource = functionSource(ds, 'parseKey', 'fmtDay');
const shiftSource = functionSource(ds, 'shift', 'dsStatusLog');
assert(/new Date\(\+p\[0\], \+p\[1\] - 1, \+p\[2\], 12, 0, 0\)/.test(parseKeySource),
  'selected-day parsing is no longer anchored at local noon');
assert(/d\.setDate\(d\.getDate\(\) \+ n\)/.test(shiftSource),
  'selected-day arrows no longer use calendar-day arithmetic');

/* Date navigation must not add/remove a control. The fixed Today shortcut is
 * visible for the whole matrix and changes only its native disabled/current
 * state when the selected day actually is Today. */
const syncStripSource = functionSource(ds, 'syncStrip', 'setDay');
assert(ds.includes('id="mlsDsTodayBtn" aria-label="Go to Today">Today</button>'),
  'date strip does not render one fixed Today shortcut');
assert(syncStripSource.includes("tb.style.display = '';"),
  'Today shortcut does not remain visible on every date');
assert(syncStripSource.includes('tb.disabled = !!isToday;'),
  'Today shortcut does not express the selected date with native disabled state');
{
  const label = { innerHTML: '' }, attrs = {};
  const todayButton = {
    style: { display: 'none' }, disabled: false, title: '',
    setAttribute(name, value) { attrs[name] = String(value); },
    /* syncStrip compares before it commits, so the double must answer reads too. */
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; }
  };
  const DS = { day: '2026-07-19' };
  const ctx = {
    DS,
    $(id) { if (id === 'mlsDsDayLbl') return label; if (id === 'mlsDsTodayBtn') return todayButton; return null; },
    todayKey() { return '2026-07-19'; },
    fmtDay(day) { return day; },
    esc(value) { return String(value); },
    dsHydrateTerminalReceipt() { return null; }
  };
  vm.createContext(ctx);
  vm.runInContext(`${syncStripSource}\nthis.syncStrip = syncStrip;`, ctx,
    { filename: 'mls-connect.js#DaySwitch.syncStrip' });
  const days = [
    '2026-07-19', '2026-07-18', '2026-07-20', '2026-01-31', '2026-02-01',
    '2026-12-31', '2027-01-01', '2026-03-07', '2026-03-08', '2026-03-09'
  ];
  for (const day of days) {
    DS.day = day;
    ctx.syncStrip();
    const isToday = day === '2026-07-19';
    assert.strictEqual(todayButton.style.display, '', `${day}: Today shortcut disappeared`);
    assert.strictEqual(todayButton.disabled, isToday, `${day}: Today shortcut has the wrong disabled state`);
    assert.strictEqual(attrs['aria-disabled'], isToday ? 'true' : 'false', `${day}: aria-disabled disagrees`);
    assert.strictEqual(attrs['aria-current'], isToday ? 'date' : 'false', `${day}: aria-current disagrees`);
  }
}

{
  const DS = { day: '' }, selected = [];
  const ctx = {
    DS,
    selected,
    setDay(day) { selected.push(day); DS.day = day; return true; },
    Date,
    String
  };
  vm.createContext(ctx);
  vm.runInContext(`${pad2Source}\n${keyOfSource}\n${parseKeySource}\n${shiftSource}\nthis.shift = shift; this.parseKey = parseKey;`, ctx);
  const cases = [
    ['past-day', '2026-07-19', -1, '2026-07-18'],
    ['tomorrow', '2026-07-19', 1, '2026-07-20'],
    ['month-boundary', '2026-01-31', 1, '2026-02-01'],
    ['leap-month-boundary', '2028-02-28', 1, '2028-02-29'],
    ['year-boundary', '2026-12-31', 1, '2027-01-01'],
    ['spring-DST-enter', '2026-03-07', 1, '2026-03-08'],
    ['spring-DST-exit', '2026-03-08', 1, '2026-03-09'],
    ['fall-DST-enter', '2026-10-31', 1, '2026-11-01'],
    ['fall-DST-exit', '2026-11-01', 1, '2026-11-02']
  ];
  for (const [label, from, delta, expected] of cases) {
    ctx.DS.day = from;
    assert.strictEqual(ctx.shift(delta), true, `${label}: shift rejected`);
    assert.strictEqual(ctx.selected.at(-1), expected, `${label}: selected the wrong calendar date`);
    assert.strictEqual(ctx.DS.day, expected, `${label}: committed the wrong calendar date`);
  }
  assert.strictEqual(ctx.parseKey('2026-03-08').getHours(), 12, 'DST date was not parsed at local noon');
}

/* Exercise the shipped Easy date transaction. A clean transition clears all
 * appointment/action state and the exact Athena binding together; a recording
 * or unsaved visit rejects atomically and preserves every field. */
const setVisitDayStart = easy.indexOf('function setVisitDay(');
let setVisitDayEnd = easy.indexOf('\n\n  /* Staff Prep', setVisitDayStart);
if (setVisitDayEnd < 0) setVisitDayEnd = easy.indexOf('\n\n  /* =======================================================================', setVisitDayStart);
assert(setVisitDayStart >= 0 && setVisitDayEnd > setVisitDayStart, 'could not bound setVisitDay');
const setVisitDaySource = easy.slice(setVisitDayStart, setVisitDayEnd);
{
  const events = [], bindings = [], toasts = [];
  const transcript = { value: '' };
  const S = {
    visitDay: '2026-01-31', appt: { id: 'APPT-OLD' }, locked: { id: 'LOCK-OLD' },
    phase: 'stopped', recStart: 42, genClickedAt: 43, signedAt: 44,
    expanded: 'ROW', editing: true, lastWarn: 'old', query: 'old patient',
    showCount: 99, mode: 'staff', screen: 'doctor'
  };
  let recording = false, note = '', renderCount = 0;
  const ctx = {
    S,
    visitDay() { return S.visitDay; },
    isRecording() { return recording; },
    toast(message) { toasts.push(message); },
    safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
    $(id) { return id === 'transcript' ? transcript : null; },
    noteText() { return note; },
    render() { renderCount++; },
    setEasyMode(mode, screen) { S.mode = mode; S.screen = screen; renderCount++; return true; },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
    window: {
      _athenaSetVisitBinding(value, force) { bindings.push({ value, force }); },
      dispatchEvent(event) { events.push(event); }
    },
    String
  };
  vm.createContext(ctx);
  vm.runInContext(`${setVisitDaySource}\nthis.setVisitDay = setVisitDay;`, ctx,
    { filename: 'mls-connect.js#Easy.setVisitDay' });

  assert.strictEqual(ctx.setVisitDay('2026-02-01'), true, 'month-boundary transition was rejected');
  assert.strictEqual(ctx.S.visitDay, '2026-02-01');
  assert.strictEqual(ctx.S.appt, null, 'prior appointment survived a date change');
  assert.strictEqual(ctx.S.locked, null, 'prior identity lock survived a date change');
  assert.strictEqual(ctx.S.phase, 'idle', 'prior action phase survived a date change');
  assert.strictEqual(ctx.S.recStart, 0);
  assert.strictEqual(ctx.S.genClickedAt, 0);
  assert.strictEqual(ctx.S.signedAt, 0);
  assert.strictEqual(ctx.S.expanded, null);
  assert.strictEqual(ctx.S.editing, false);
  assert.strictEqual(ctx.S.lastWarn, '');
  assert.strictEqual(ctx.S.query, '', 'prior patient filter survived a date change');
  assert.strictEqual(ctx.S.showCount, 5);
  assert.strictEqual(ctx.S.mode, 'doctor');
  assert.strictEqual(ctx.S.screen, 'home');
  assert.deepStrictEqual(bindings, [{ value: null, force: true }], 'exact Athena binding was not cleared with date state');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].detail.day, '2026-02-01');
  assert.strictEqual(events[0].detail.previousDay, '2026-01-31');

  ctx.S.appt = { id: 'APPT-DIRTY' }; ctx.S.locked = { id: 'LOCK-DIRTY' };
  ctx.S.phase = 'stopped'; ctx.S.query = 'must survive'; transcript.value = 'unsaved visit text';
  const beforeDirty = JSON.stringify(ctx.S), eventsBeforeDirty = events.length, bindingsBeforeDirty = bindings.length;
  assert.strictEqual(ctx.setVisitDay('2026-12-31'), false, 'unsaved visit allowed a date change');
  assert.strictEqual(JSON.stringify(ctx.S), beforeDirty, 'rejected unsaved transition changed Visit state');
  assert.strictEqual(events.length, eventsBeforeDirty, 'rejected unsaved transition emitted a date event');
  assert.strictEqual(bindings.length, bindingsBeforeDirty, 'rejected unsaved transition cleared the binding');
  assert(toasts.some(message => /finish or save/i.test(message)), 'unsaved-date block was not explained');

  transcript.value = ''; recording = true;
  const beforeRecording = JSON.stringify(ctx.S);
  assert.strictEqual(ctx.setVisitDay('2026-12-31'), false, 'active recording allowed a date change');
  assert.strictEqual(JSON.stringify(ctx.S), beforeRecording, 'recording block changed Visit state');
  assert(toasts.some(message => /stop the active recording/i.test(message)), 'recording-date block was not explained');
}

/* The real 1.2-second ensure loop owns midnight rollover only while the doctor
 * is following Today. An explicitly selected historical/future day stays put. */
const ensureSource = functionSource(ds, 'ensure', 'onEasyVisitDayChanged');
assert(ds.includes("if (DS.followToday && DS.day !== todayKey()) setDay(todayKey());"),
  'account-local midnight rollover ownership is missing');
assert(/setInterval\(function \(\) \{ try \{ ensure\(\); \} catch \(e\) \{\} \}, 1200\)/.test(ds),
  'midnight rollover is not attached to the bounded ensure loop');
{
  let accountToday = '2027-01-01';
  const transitions = [], syncs = [];
  const existing = {};
  const body = { firstChild: existing, querySelector() { return null; }, insertBefore() { throw new Error('unexpected remount'); } };
  const DS = { day: '2026-12-31', followToday: true };
  const ctx = {
    DS,
    $(id) { if (id === 'mlsEz3Body') return body; if (id === 'mlsDsStrip') return existing; return null; },
    easyMode() { return 'doctor'; },
    removeDoctorDayControls() {},
    todayKey() { return accountToday; },
    setDay(day) { transitions.push(day); DS.day = day; DS.followToday = true; return true; },
    syncStrip() { syncs.push(DS.day); },
    renderList() {}
  };
  vm.createContext(ctx);
  vm.runInContext(`${ensureSource}\nthis.ensure = ensure;`, ctx, { filename: 'mls-connect.js#DaySwitch.ensure' });
  ctx.ensure();
  assert.deepStrictEqual(transitions, ['2027-01-01'], 'Today did not advance across midnight/year rollover');
  assert.strictEqual(ctx.DS.day, '2027-01-01');

  ctx.DS.day = '2026-03-08'; ctx.DS.followToday = false; accountToday = '2027-01-02';
  ctx.ensure();
  assert.deepStrictEqual(transitions, ['2027-01-01'], 'an explicitly selected day was overwritten at midnight');
  assert.strictEqual(ctx.DS.day, '2026-03-08');
  assert(syncs.includes('2026-03-08'), 'explicit selected-day strip stopped synchronizing');
}

console.log('PASS Visit date matrix: account-TZ Staff ranges/month defaults, past/tomorrow, month/year/leap/DST arithmetic, midnight follow, dirty guards, and action-state isolation');

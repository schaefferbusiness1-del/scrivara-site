'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

const mergeStart = background.indexOf('var mlsProv = (function () {');
const mergeEnd = background.indexOf('/* A schedule surface must be proven', mergeStart);
assert(mergeStart >= 0 && mergeEnd > mergeStart, 'could not extract mlsProv');
const mlsProv = vm.runInNewContext(
  background.slice(mergeStart, mergeEnd) + '\nmlsProv;',
  Object.create(null),
  { timeout: 2000 }
);

const nameStart = background.indexOf('function mlsParseName(raw)');
const readerStart = background.indexOf('async function mlsSchedDomInline(doc, CFG)', nameStart);
const readerEnd = background.indexOf('\n if (/stm\\.esp|', readerStart);
assert(nameStart >= 0 && readerStart > nameStart && readerEnd > readerStart,
  'could not extract packaged injected reader');

class FakeEvent {
  constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
}

const packaged = vm.runInContext(
  background.slice(nameStart, readerEnd) + '\n({ mlsParseName, mlsSchedDomInline });',
  vm.createContext({ setTimeout, clearTimeout, Promise, Date, Event: FakeEvent }),
  { timeout: 2000 }
);
const reference = require(path.join(root, 'inject_dom.js'));

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function cell(text) {
  return {
    textContent: text,
    children: [],
    getAttribute() { return ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, right: 100, width: 100 }; }
  };
}

const headers = ['Time', 'Patient', 'Provider', 'Status'].map(cell);
function row(time, name, provider, status, dob) {
  const cells = [cell(time), cell(name), cell(provider), cell(status)];
  return {
    // This is Chrome's real table-row textContent shape: td boundaries do not
    // insert spaces. It was the source of the lost AM/PM regression.
    textContent: `${time}${name}${provider}${status}`,
    children: cells,
    getAttribute(attribute) { return attribute === 'data-patient-dob' ? dob : ''; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('[role="cell"]') || selector.startsWith('th, td')) return cells;
      return [];
    },
    getBoundingClientRect() { return { left: 0, right: 400, width: 400 }; }
  };
}

const rows = [
  row('8:30 AM', 'Alpha Sample', 'Avery Stone MD', 'Scheduled', '1981-04-12'),
  row('10:15 AM', 'Bravo Sample', 'Avery Stone MD', 'Checked in', '1975-09-23')
];
const grid = {
  textContent: '', children: rows,
  getAttribute() { return ''; },
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector.includes('thead th')) return headers;
    if (selector.includes('tbody tr')) return rows;
    if (selector === 'tr') return rows;
    return [];
  }
};
const doc = {
  body: { innerText: '' },
  location: { pathname: '/1/1/schedule/dashboard' },
  scrollingElement: null,
  defaultView: { getComputedStyle() { return { overflowX: 'hidden', overflowY: 'hidden' }; } },
  querySelector(selector) {
    if (selector.includes('PatientAppointment_appointment-container')
        && !selector.includes('schedule-grid')) return null;
    if (selector.includes('schedule-grid')) return grid;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === 'table, [role="grid"], [role="table"]') return [grid];
    return [];
  }
};

(async () => {
  const dom = mlsProv.fromDom(doc);
  assert.deepStrictEqual(plain(dom.appts.map(a => a.time)), ['8:30 AM', '10:15 AM']);
  assert.deepStrictEqual(plain(dom.appts.map(a => a.name)), ['Alpha Sample', 'Bravo Sample']);
  assert.deepStrictEqual(plain(dom.appts.map(a => a.dob)), ['04/12/1981', '09/23/1975']);

  const browserInnerText = [
    'Saturday, July 18, 2026',
    'Clinical schedule: 2 appointments, 1 provider.',
    'Time\tPatient\tProvider\tStatus',
    '8:30 AM\tAlpha Sample\tAvery Stone MD\tScheduled',
    '10:15 AM\tBravo Sample\tAvery Stone MD\tChecked in'
  ].join('\n');
  const text = mlsProv.fromText(browserInnerText);
  /* This compared the WHOLE row object, so it doubled as an accidental "the
     text lane may never learn a new field" pin - and the text lane did learn
     one: every tabular mint now carries athena's appointment status
     (mlsApptStatusFromRaw). That is a strengthening, and it matters (a
     checked-in row is exactly the row the write lane has to recognise), so the
     status is pinned as its own property below rather than being allowed to red
     an echo-reconciliation suite. The three fields this suite is actually about
     - the isolated Time cell, the patient name, the provider - stay pinned
     exactly, and a lost AM/PM still reds here. */
  assert.deepStrictEqual(plain(text.appts.map(a => ({ time: a.time, name: a.name, provider: a.provider }))), [
    { time: '8:30 AM', name: 'Alpha Sample', provider: 'Avery Stone MD' },
    { time: '10:15 AM', name: 'Bravo Sample', provider: 'Avery Stone MD' }
  ]);
  assert.deepStrictEqual(plain(text.appts.map(a => a.status)), ['scheduled', 'checked in'],
    'the text lane must read athena\'s own appointment status off the row it minted - "Checked in" is not ' +
    'the same visit state as "Scheduled" and a row that loses it looks bookable when it is already in progress');
  assert.strictEqual(text.diag.tabularHeaderCount, 1);
  assert.strictEqual(text.diag.tabularRowCount, 2);

  const exact = mlsProv.merge(dom, text);
  assert.strictEqual(exact.appts.length, 2, JSON.stringify(exact));
  assert.deepStrictEqual(plain(exact.appts.map(a => ({
    time: a.time, name: a.name, provider: a.provider, dob: a.dob
  }))), [
    { time: '8:30 AM', name: 'Alpha Sample', provider: 'Avery Stone MD', dob: '04/12/1981' },
    { time: '10:15 AM', name: 'Bravo Sample', provider: 'Avery Stone MD', dob: '09/23/1975' }
  ]);

  // Defensive reconciliation for text surfaces that collapse all cells into
  // spaces: the first provider token must not become a third patient token.
  const collapsed = mlsProv.fromText([
    'Time Patient Provider Status',
    '8:30 AM Alpha Sample Avery Stone MD Scheduled',
    '10:15 AM Bravo Sample Avery Stone MD Checked in'
  ].join('\n'));
  assert.deepStrictEqual(plain(collapsed.appts.map(a => a.name)), ['Alpha Sample Avery', 'Bravo Sample Avery']);
  const collapsedMerge = mlsProv.merge(dom, collapsed);
  assert.strictEqual(collapsedMerge.appts.length, 2, JSON.stringify(collapsedMerge));
  assert.strictEqual(collapsedMerge.providerDiag.textProviderEchoRowsRemoved, 2);

  // The text lane remains additive for an actual offscreen/virtualized row.
  const virtualized = mlsProv.merge({
    appts: [dom.appts[0]], providers: dom.providers, diag: {}
  }, {
    appts: [
      { time: '8:30 AM', name: 'Alpha Sample Avery', provider: '' },
      { time: '11:00 AM', name: 'Charlie Gamma', provider: '' }
    ], providers: [], diag: { strategy: 'text' }
  });
  assert.deepStrictEqual(plain(virtualized.appts.map(a => a.name)), ['Alpha Sample', 'Charlie Gamma']);
  assert.strictEqual(virtualized.providerDiag.textProviderEchoRowsRemoved, 1);

  // Never infer a meridian: AM and PM are distinct appointment identities.
  const oppositeMeridian = mlsProv.merge({
    appts: [dom.appts[0]], providers: dom.providers, diag: {}
  }, {
    appts: [{ time: '8:30 PM', name: 'Alpha Sample Avery', provider: '' }],
    providers: [], diag: { strategy: 'text' }
  });
  assert.strictEqual(oppositeMeridian.appts.length, 2);
  assert.deepStrictEqual(plain(oppositeMeridian.appts.map(a => a.time)), ['8:30 AM', '8:30 PM']);

  // A proofless lossy row cannot choose between two exact DOM identities.
  const exactIdentities = mlsProv.merge({
    appts: [
      { time: '8:30 AM', name: 'Alpha Sample', provider: 'Avery Stone MD', appointmentId: 'appt-a' },
      { time: '8:30 AM', name: 'Alpha Sample', provider: 'Avery Stone MD', appointmentId: 'appt-b' }
    ], providers: ['Avery Stone MD'], diag: {}
  }, {
    appts: [{ time: '8:30 AM', name: 'Alpha Sample Avery', provider: '' }],
    providers: [], diag: { strategy: 'text' }
  });
  assert.deepStrictEqual(plain(exactIdentities.appts.map(a => a.appointmentId)), ['appt-a', 'appt-b']);
  assert.strictEqual(exactIdentities.providerDiag.ambiguousTextProviderEchoRowsRemoved, 1);

  // Provider tails can disambiguate two simultaneous structured providers;
  // both exact DOM rows survive and neither flat shadow becomes a new visit.
  const providers = mlsProv.merge({
    appts: [
      { time: '8:30 AM', name: 'Alpha Sample', provider: 'Avery Stone MD' },
      { time: '8:30 AM', name: 'Alpha Sample', provider: 'Bailey Creek DO' }
    ], providers: ['Avery Stone MD', 'Bailey Creek DO'], diag: {}
  }, {
    appts: [
      { time: '8:30 AM', name: 'Alpha Sample Avery', provider: '' },
      { time: '8:30 AM', name: 'Alpha Sample Bailey', provider: '' }
    ], providers: [], diag: { strategy: 'text' }
  });
  assert.deepStrictEqual(plain(providers.appts.map(a => a.provider)), ['Avery Stone MD', 'Bailey Creek DO']);
  assert.strictEqual(providers.providerDiag.textProviderEchoRowsRemoved, 2);

  const ambiguousColumns = mlsProv.fromText([
    'Time\tPatient\tPatient\tProvider',
    '8:30 AM\tAlpha Sample\tWrong Sample\tAvery Stone MD'
  ].join('\n'));
  assert.strictEqual(ambiguousColumns.appts.length, 0);
  assert.strictEqual(ambiguousColumns.diag.tabularAmbiguousHeaders, 1);

  // Both executable reader copies must use the isolated Time cell, not the
  // boundary-less tr.textContent string.
  const packagedRows = await packaged.mlsSchedDomInline(doc, { __maxSweepMs: 1000 });
  assert.deepStrictEqual(plain(packagedRows.appts.map(a => a.time)), ['8:30 AM', '10:15 AM']);
  assert.strictEqual(packagedRows.diag.bareTimes || 0, 0, JSON.stringify(packagedRows.diag));
  const referenceRows = await reference.mlsSchedDomInline(doc);
  assert.deepStrictEqual(plain(referenceRows.appts.map(a => a.time)), ['8:30 AM', '10:15 AM']);

  console.log('PASS exact schedule table cells, provider-echo reconciliation, meridians, identity ambiguity, and virtualized union');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

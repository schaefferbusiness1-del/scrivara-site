'use strict';

/* mrpt-1.0.0 - the Month report card.  [STAGED PROOF - not registered]
 *
 * FILENAME NOTE. tests/run-all.js:2013 discovers every tests/*.test.js and
 * REFUSES to load if one is unregistered, so a .test.js name here would have
 * broken tests/fast-release-gate-contract.test.js while this work is staged
 * (measured, both directions). It therefore ships as -proof.js and runs with
 *     node tests/month-report-surface-proof.js
 * To promote: rename to month-report-surface.test.js and add that name to the
 * tests[] array in run-all.js in the same commit.
 *
 * The owner asked for a per-provider monthly report ("days worked"). The whole
 * risk in that request is INVENTION: a report that shows 0 for a clinician
 * whose month was never imported reads exactly like a clinician who did not
 * work, and a report that folds provider-blank rows into somebody's total
 * manufactures a number nobody measured.
 *
 * This suite EXECUTES the real mrpt-1.0.0 slice out of 1p-mls-connect.js
 * against fixture rows and proves:
 *
 *   1. per-provider day counts are distinct appointment DATES, per month;
 *   2. provider-blank rows are their own line and are counted for NOBODY;
 *   3. a roster clinician with no row in the month is reported as
 *      "not imported yet", never as a zero, and the card names the import;
 *   4. the persisted capture carries provider name + ISO dates + integers and
 *      NOTHING else - no patient name, DOB, MRN, reason or appointment id can
 *      reach it even when every fixture row carries all of them;
 *   5. the capture is account-scoped through uns() and refuses to write before
 *      a session is owned;
 *   6. the /cloned and production twins are byte-identical derivations of the
 *      edited 1p bundle.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

/* values built inside the vm realm carry that realm's Array prototype, so
   deepStrictEqual would compare prototypes rather than contents. */
function arr(v) { return Array.prototype.slice.call(v || []); }

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

const start = source.indexOf('/* ===== mrpt-1.0.0 - MONTH REPORT');
const end = source.indexOf('/* ===== end mrpt-1.0.0 ===== */');
assert(start >= 0 && end > start, 'the mrpt-1.0.0 month-report slice is missing from 1p-mls-connect.js');
const moduleSource = source.slice(start, end);

/* The slice must never reach for the private Staff Prep opener. Staff Prep has
 * exactly one activation path (the topbar Menu row) and
 * tests/canonical-ui-ownership-runtime.test.js pins that ownership; a report
 * card that dispatched the menu intent itself would quietly become a second
 * owner. */
const codeOnly = moduleSource.replace(/\/\*[\s\S]*?\*\//g, ' ');
assert(codeOnly.indexOf('menu-staff-prep') < 0 && codeOnly.indexOf('mls-topbar-menu') < 0,
  'the month report impersonates the topbar Menu instead of opening it');
assert(/getElementById\('mlsTbMenuBtn'\)/.test(codeOnly),
  'the month report no longer opens the real Menu control');
/* It must also never claim a live month read it does not perform. */
assert(/MLS does not read a month directly from athenaOne/.test(moduleSource),
  'the month report no longer states that its numbers come from imported rows only');

/* ------------------------------------------------------------------ harness */
function makeEnv(opts) {
  opts = opts || {};
  const storage = opts.storage || {};
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; }
  };
  const documentStub = {
    readyState: 'complete',
    getElementById() { return null; },
    createElement() { return { style: { cssText: '' }, setAttribute() {}, appendChild() {}, querySelector() { return null; }, addEventListener() {} }; },
    addEventListener() {},
    removeEventListener() {},
    body: { appendChild() {} }
  };
  const win = {
    _calAppts: opts.rows || [],
    _calProviders: opts.calProviders || [],
    _calApptProviders: [],
    __mlsProviderRoster: opts.roster ? { providers() { return opts.roster.slice(); } } : null,
    uns(suffix) { return 'sf_u::' + (opts.account || '_') + '::' + suffix; },
    unsResolved() { return opts.account !== undefined ? !!opts.account : true; },
    localStorage,
    document: documentStub,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    setTimeout,
    clearTimeout,
    Date
  };
  win.window = win;
  const sandbox = {
    window: win,
    document: documentStub,
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    isFinite,
    RegExp
  };
  vm.createContext(sandbox);
  new vm.Script(moduleSource, { filename: 'mrpt-1.0.0.js' }).runInContext(sandbox);
  assert(win.__mlsMonthReport && win.__mlsMonthReport.installed === true, 'mrpt did not install');
  return { win, storage, api: win.__mlsMonthReport };
}

/* Fixture rows carry EVERY patient field a real backend row carries, on
 * purpose: the capture assertions below are only meaningful if there was
 * something identifiable there to leak. */
const PHI = {
  names: ['Wanda Testerly', 'Gregorio Palumbo', 'Aiko Sato-Reyes'],
  dobs: ['1961-04-02', '1977-11-30', '1988-02-14'],
  mrns: ['MRN-882317', 'MRN-114029', 'MRN-770561'],
  reasons: ['knee pain follow up', 'post-op wound check', 'annual physical']
};
let rowSeq = 0;
function row(date, provider, who) {
  const i = who % PHI.names.length;
  rowSeq += 1;
  return {
    id: 'appt-' + rowSeq,
    appt_date: date,
    provider: provider,
    name: PHI.names[i],
    dob: PHI.dobs[i],
    mrn: PHI.mrns[i],
    reason: PHI.reasons[i],
    patient_external_id: 'pt-' + (100 + i),
    athena_appointment_id: 'ath-' + rowSeq,
    status: 'booked',
    start_at: date + 'T14:00:00Z'
  };
}

const MATTHEW = 'Matthew Schaeffer, MD';
const UYEN = 'Uyen Nguyen, PA-C';
const SARAH = 'Sarah Johnson, PA-C';

/* Matthew: 3 distinct August days, 5 appointments (one day carries two).
 * Uyen: 2 distinct August days, 2 appointments.
 * 2 August rows with NO provider at all (the real default-view shape).
 * 1 September row that must not leak into the August month.
 * 1 duplicate row id that must be counted once. */
const AUG = [
  row('2026-08-03', MATTHEW, 0),
  row('2026-08-03', MATTHEW, 1),
  row('2026-08-04', MATTHEW, 2),
  row('2026-08-05', MATTHEW, 0),
  row('2026-08-05', MATTHEW, 1),
  row('2026-08-06', UYEN, 2),
  row('2026-08-07', UYEN, 0),
  row('2026-08-10', '', 1),
  row('2026-08-10', '   ', 2),
  row('2026-09-01', MATTHEW, 0)
];
AUG.push(Object.assign({}, AUG[0]));            /* same id -> one appointment */

/* ---- 1. per-provider day counts are distinct dates, scoped to the month --- */
{
  const { api } = makeEnv({ rows: AUG, roster: [MATTHEW, UYEN, SARAH] });
  const rep = api.compute({ month: '2026-08', rows: AUG, roster: [MATTHEW, UYEN, SARAH], now: 1756684800000 });

  assert.strictEqual(rep.month, '2026-08');
  const byName = {};
  rep.providers.forEach(function (p) { byName[p.name] = p; });

  assert(byName[MATTHEW], 'Matthew is missing from the report');
  assert.strictEqual(byName[MATTHEW].days, 3, 'Matthew day count is not the number of distinct August dates');
  assert.strictEqual(byName[MATTHEW].appointments, 5, 'Matthew appointment count is wrong (the duplicate id must count once)');
  assert.deepStrictEqual(arr(byName[MATTHEW].dates), ['2026-08-03', '2026-08-04', '2026-08-05']);
  assert.strictEqual(byName[MATTHEW].avgPerDay, 1.7, 'the per-day estimate is not appointments/days to one decimal');

  assert(byName[UYEN], 'Uyen is missing from the report');
  assert.strictEqual(byName[UYEN].days, 2);
  assert.strictEqual(byName[UYEN].appointments, 2);

  assert.strictEqual(rep.provenance.duplicateRowsIgnored, 1, 'the duplicate backend id was counted twice');
  /* the September row must not be in an August report at all */
  rep.providers.forEach(function (p) {
    p.dates.forEach(function (d) { assert.strictEqual(d.slice(0, 7), '2026-08', 'a row outside the month leaked in'); });
  });
  /* sorted by days desc: Matthew (3) before Uyen (2) */
  assert.strictEqual(rep.providers[0].name, MATTHEW, 'the report is not ordered by days worked');
}

/* ---- 2. provider-blank rows are their own line, counted for NOBODY -------- */
{
  const { api } = makeEnv({ rows: AUG });
  const rep = api.compute({ month: '2026-08', rows: AUG, roster: [], now: 0 });
  assert.strictEqual(rep.unattributed.appointments, 2, 'the provider-blank August rows were not isolated');
  assert.strictEqual(rep.unattributed.days, 1, 'the two blank rows fall on one day');
  assert.deepStrictEqual(arr(rep.unattributed.dates), ['2026-08-10']);
  const attributed = rep.providers.reduce(function (n, p) { return n + p.appointments; }, 0);
  assert.strictEqual(attributed, 7, 'a provider-blank row was folded into a clinician total');
  assert.strictEqual(rep.totals.appointments, attributed + rep.unattributed.appointments,
    'the month total does not equal attributed plus unattributed');
  assert.strictEqual(rep.provenance.unattributedRows, 2);
  assert.strictEqual(rep.provenance.attributedRows, 7);
}

/* ---- 3. honest empty state for a provider with no data in the month ------- */
{
  const { api } = makeEnv({ rows: AUG, roster: [MATTHEW, UYEN, SARAH] });
  const rep = api.compute({ month: '2026-08', rows: AUG, roster: [MATTHEW, UYEN, SARAH], now: 0 });
  assert.deepStrictEqual(arr(rep.notImported), [SARAH],
    'a roster clinician with no imported row is not reported as not-imported-yet');
  rep.providers.forEach(function (p) {
    assert(p.appointments > 0, 'a zero row was minted for a provider with nothing imported');
  });

  /* the missing provider must never be rendered as a numeric zero, and the
     card must name the import that would fix it. */
  assert(/not imported yet/.test(moduleSource), 'the not-imported-yet wording is gone');
  assert(/That is a MISSING IMPORT, not a zero/.test(moduleSource),
    'the card no longer distinguishes a missing import from a real zero');
  assert(/Staff prep &amp; Athena month pull/.test(moduleSource) && /Start month pull/.test(moduleSource),
    'the card no longer names the exact import path');
  assert(/provider&#8209;not&#8209;on&#8209;calendar/.test(moduleSource),
    'the card no longer warns that athenaOne must be showing that clinician own schedule');

  /* a month with nothing at all reads as missing, never as a set of zeros */
  const empty = api.compute({ month: '2026-01', rows: AUG, roster: [MATTHEW, UYEN, SARAH], now: 0 });
  assert.strictEqual(empty.providers.length, 0);
  assert.strictEqual(empty.totals.appointments, 0);
  assert.strictEqual(empty.provenance.reason, 'nothing-imported-for-month');
  assert.deepStrictEqual(arr(empty.notImported), [MATTHEW, SARAH, UYEN].sort(),
    'an entirely unimported month does not name every clinician as not-imported-yet');
  assert(/Nothing is imported for/.test(moduleSource), 'the whole-month empty state wording is gone');

  /* and an empty month is never persisted as a row of zeros */
  const env = makeEnv({ rows: AUG, roster: [MATTHEW, UYEN, SARAH], account: 'owner@example.com' });
  const res = env.api.capture(env.api.compute({ month: '2026-01', rows: AUG, roster: [MATTHEW], now: 3 }));
  assert.strictEqual(res.written, false, 'an empty month was written to the store as zeros');
  assert.strictEqual(res.reason, 'nothing-to-capture');
  assert.deepStrictEqual(Object.keys(env.storage), [], 'browsing an empty month wrote something');
}

/* ---- 4. the capture holds provider + date + counts and NOTHING else ------- */
const ALLOWED_KEYS = {
  root: ['month', 'at', 'providers', 'unattributed', 'totals'],
  provider: ['name', 'days', 'appointments', 'dates'],
  unattributed: ['days', 'appointments', 'dates'],
  totals: ['days', 'appointments']
};
{
  const env = makeEnv({ rows: AUG, roster: [MATTHEW, UYEN, SARAH], account: 'owner@example.com' });
  const rep = env.api.compute({ month: '2026-08', rows: AUG, roster: [MATTHEW, UYEN, SARAH], now: 1756684800000 });
  const res = env.api.capture(rep);
  assert.strictEqual(res.written, true, 'the capture refused to write for a signed-in account: ' + res.reason);

  const key = 'sf_u::owner@example.com::mlsMonthReportV1';
  assert(Object.prototype.hasOwnProperty.call(env.storage, key), 'the capture is not account-scoped through uns()');
  const blob = env.storage[key];
  const parsed = JSON.parse(blob);
  assert.strictEqual(parsed.v, 1);
  assert.deepStrictEqual(Object.keys(parsed.months), ['2026-08'], 'the capture is not keyed by month');

  const rec = parsed.months['2026-08'];
  assert.deepStrictEqual(Object.keys(rec).sort(), ALLOWED_KEYS.root.slice().sort(),
    'the stored month record grew a field beyond month/at/providers/unattributed/totals');
  assert.strictEqual(rec.month, '2026-08');
  assert.strictEqual(rec.at, 1756684800000);
  assert.deepStrictEqual(Object.keys(rec.unattributed).sort(), ALLOWED_KEYS.unattributed.slice().sort());
  assert.deepStrictEqual(Object.keys(rec.totals).sort(), ALLOWED_KEYS.totals.slice().sort());
  rec.providers.forEach(function (p) {
    assert.deepStrictEqual(Object.keys(p).sort(), ALLOWED_KEYS.provider.slice().sort(),
      'a stored provider entry grew a field beyond name/days/appointments/dates');
    assert.strictEqual(typeof p.name, 'string');
    assert.strictEqual(typeof p.days, 'number');
    assert.strictEqual(typeof p.appointments, 'number');
    p.dates.forEach(function (d) { assert(/^\d{4}-\d{2}-\d{2}$/.test(d), 'a stored date is not a bare ISO day: ' + d); });
  });
  rec.unattributed.dates.forEach(function (d) { assert(/^\d{4}-\d{2}-\d{2}$/.test(d)); });

  /* NOTHING identifiable may appear anywhere in the persisted bytes. */
  const leaks = []
    .concat(PHI.names, PHI.dobs, PHI.mrns, PHI.reasons)
    .concat(AUG.map(function (r) { return r.id; }))
    .concat(AUG.map(function (r) { return r.athena_appointment_id; }))
    .concat(AUG.map(function (r) { return r.patient_external_id; }));
  leaks.forEach(function (needle) {
    assert(blob.indexOf(needle) < 0, 'PATIENT DATA REACHED THE MONTH-REPORT STORE: ' + needle);
  });
  /* provider names, by contrast, are exactly what the record is for */
  assert(blob.indexOf(MATTHEW) >= 0 && blob.indexOf(UYEN) >= 0, 'the record dropped the provider names it exists to hold');

  /* sanitize is the only door to the store, and it must survive a widened
     report object without carrying the extra fields through. */
  const dirty = env.api.compute({ month: '2026-08', rows: AUG, roster: [], now: 5 });
  dirty.patients = PHI.names.slice();
  dirty.providers[0].patientNames = PHI.names.slice();
  dirty.providers[0].rows = AUG.slice();
  const clean = env.api.sanitize(dirty);
  const cleanJson = JSON.stringify(clean);
  assert.deepStrictEqual(Object.keys(clean).sort(), ALLOWED_KEYS.root.slice().sort());
  PHI.names.forEach(function (n) { assert(cleanJson.indexOf(n) < 0, 'sanitize let a patient name through: ' + n); });
  assert(cleanJson.indexOf('appt-') < 0, 'sanitize let an appointment id through');

  /* a re-capture of the same month replaces, never appends */
  env.api.capture(env.api.compute({ month: '2026-08', rows: AUG, roster: [], now: 9 }));
  const again = JSON.parse(env.storage[key]);
  assert.deepStrictEqual(Object.keys(again.months), ['2026-08'], 'a repeat capture of one month created a second entry');
  assert.strictEqual(again.months['2026-08'].at, 9, 'a repeat capture did not replace the as-of stamp');
}

/* ---- 5. no account, no write --------------------------------------------- */
{
  const env = makeEnv({ rows: AUG, account: '' });
  const rep = env.api.compute({ month: '2026-08', rows: AUG, roster: [], now: 1 });
  const res = env.api.capture(rep);
  assert.strictEqual(res.written, false, 'the capture wrote a device-scope key before a session was owned');
  assert.strictEqual(res.reason, 'no-account-scope');
  assert.deepStrictEqual(Object.keys(env.storage), [], 'something was written with no account to scope it to');
  /* it still returns the honest sanitized record so the card can render */
  assert.strictEqual(res.record.month, '2026-08');
}

/* ---- 6. an unreadable month is refused, never guessed --------------------- */
{
  const { api } = makeEnv({ rows: AUG });
  const bad = api.compute({ month: 'not-a-month', rows: AUG, roster: [MATTHEW], now: 0 });
  assert.strictEqual(bad.provenance.reason, 'no-month');
  assert.strictEqual(bad.providers.length, 0);
  assert.strictEqual(bad.totals.appointments, 0);
  assert.strictEqual(api.capture(bad).written, false, 'a monthless report was persisted');
}

/* ---- 7. the twins are byte-identical derivations of the edited 1p bundle -- */
{
  ['derive-cloned-from-1p.js', 'derive-production-from-1p.js'].forEach(function (script) {
    const out = execFileSync(process.execPath, [path.join(root, 'scripts', script), '--check'], {
      cwd: root, encoding: 'utf8'
    });
    assert(/PRISTINE/.test(out), script + ' reports drift between 1p and its derived twin:\n' + out);
  });
}

console.log('month-report-surface: OK');

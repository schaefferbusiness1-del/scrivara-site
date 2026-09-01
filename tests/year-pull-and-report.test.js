'use strict';

/* yrpt-1.0.0 + csp-1.0.0 - the YEAR report, the YEAR pull queue, and the
 * calendar-only provider.  [registered]
 *
 * FILENAME NOTE, measured both directions on this worktree. tests/run-all.js
 * discovers every tests/*.test.js (:2015-2017) and THROWS
 * "Automated test registry is incomplete: unregistered automated tests: ..."
 * for any it finds that the tests[] array does not name. This lane is staged
 * and must not register, so - exactly as tests/month-report-surface.test.js
 * did while IT was staged - this ships as -proof.js, which is discovered only
 * if its name is added to AUTOMATED_PROOF_FILES. It runs with
 *     node tests/year-pull-and-report-proof.js
 * To promote: rename to year-pull-and-report.test.js and add that name to the
 * tests[] array in run-all.js in the same commit.
 *
 * WHAT WAS ALREADY THERE, and is therefore NOT rebuilt here. The durable YEAR
 * PULL engine ships today: window.__mlsP1RangeJobs.startYear(). It already
 * queues the months of a year one at a time through the real month seam
 * (window.__mlsSI.pullMonth), persists a per-day ledger to uns('p1RangeJobV1'),
 * resumes across reloads, refuses while another pull holds the lease, pauses
 * between months and stamps a per-day verdict. This suite therefore PROVES
 * that engine against the real bytes rather than reimplementing it, and adds
 * the two things that were genuinely missing:
 *
 *   A. the YEAR REPORT (yrpt-1.0.0 in 1p-mls-connect.js) - a provider x month
 *      grid whose every cell is compute() for that one month, and whose
 *      missing cells are an em dash carrying the import recipe, NEVER a zero.
 *   B. the CALENDAR-ONLY PROVIDER (csp-1.0.0 in the roster) - a clinician the
 *      athena view named but the roster could not prove an identity for is now
 *      selectable, without weakening the noise guard or provscope-1.0.0.
 *
 * Every claim below is DRIVEN - the shipped bytes execute in a VM and the
 * assertion reads what they actually did - except where marked READ, which is
 * a property of the source a VM cannot exercise.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let checks = 0;
const measured = {};
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

const CONNECT = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
const RANGE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_rangejobs.js'), 'utf8');
const ROSTER = fs.readFileSync(path.join(ROOT, '1p-feat_athena_provider_roster.js'), 'utf8');

/* ==================================================================== A ====
 * THE YEAR REPORT
 * ========================================================================= */

const mrStart = CONNECT.indexOf('/* ===== mrpt-1.0.0 - MONTH REPORT');
const mrEnd = CONNECT.indexOf('/* ===== end mrpt-1.0.0 ===== */');
ok(mrStart >= 0 && mrEnd > mrStart, 'the mrpt/yrpt report slice is missing from 1p-mls-connect.js');
const REPORT_SRC = CONNECT.slice(mrStart, mrEnd);

/* A DOM stub thin enough to be obviously inert and thick enough that the real
   paint() runs and hands back the HTML it would have shipped. */
function makeNode() {
  const node = {
    innerHTML: '', className: '', id: '', value: '',
    style: { cssText: '' }, children: [],
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { node.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
  return node;
}
function makeReportEnv(opts) {
  opts = opts || {};
  const storage = {};
  const created = [];
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; }
  };
  const body = makeNode();
  const documentStub = {
    readyState: 'complete',
    body: body,
    getElementById() { return null; },
    createElement() { const n = makeNode(); created.push(n); return n; },
    addEventListener() {}, removeEventListener() {}
  };
  const win = {
    _calAppts: opts.rows || [],
    _calProviders: [], _calApptProviders: [],
    __mlsProviderRoster: opts.roster ? { providers() { return opts.roster.slice(); } } : null,
    uns(suffix) { return 'sf_u::doc@example.test::' + suffix; },
    unsResolved() { return true; },
    localStorage, document: documentStub,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setTimeout, clearTimeout, Date
  };
  win.window = win;
  const sandbox = {
    window: win, document: documentStub, localStorage, console,
    setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, isFinite, RegExp
  };
  vm.createContext(sandbox);
  new vm.Script(REPORT_SRC, { filename: 'yrpt-1.0.0.js' }).runInContext(sandbox);
  ok(win.__mlsMonthReport && win.__mlsMonthReport.installed === true, 'the report module did not install');
  return { win, storage, created, api: win.__mlsMonthReport };
}

const MATTHEW = 'Matthew Schaeffer, MD';
const UYEN = 'Uyen Nguyen, PA-C';
const SARAH = 'Sarah Johnson, PA-C';
/* rows carry real patient fields so a leak would have something to leak */
let seq = 0;
function row(date, provider) {
  seq += 1;
  return {
    id: 'appt-' + seq, appt_date: date, provider: provider,
    name: 'Wanda Testerly', dob: '1961-04-02', mrn: 'MRN-882317',
    reason: 'knee pain follow up', status: 'booked', start_at: date + 'T14:00:00Z'
  };
}
/* 2025: January has Matthew only (2 days / 3 appts). March has Uyen only
 * (1 day / 1 appt) plus one provider-blank row. February and the other nine
 * months were never imported at all. Sarah is on the roster and appears in no
 * month - the exact case that must never read as twelve zeros. */
const YEAR = '2025';
const ROWS = [
  row('2025-01-06', MATTHEW), row('2025-01-06', MATTHEW), row('2025-01-08', MATTHEW),
  row('2025-03-11', UYEN), row('2025-03-12', ''),
  row('2024-12-30', MATTHEW)  /* previous year - must not leak in */
];

{
  const env = makeReportEnv({ rows: ROWS, roster: [MATTHEW, UYEN, SARAH] });
  const rep = env.api.computeYear({ year: YEAR, rows: ROWS, roster: [MATTHEW, UYEN, SARAH], now: Date.now() });

  eq(rep.months.length, 12, 'the year grid does not carry twelve months');
  eq(rep.months[0], '2025-01', 'the year grid does not start at January');
  eq(rep.months[11], '2025-12', 'the year grid does not end at December');

  /* --- 1. every cell equals compute() for that month (the no-drift claim) -- */
  let crossChecked = 0;
  for (let i = 0; i < rep.months.length; i++) {
    const mk = rep.months[i];
    const month = env.api.compute({ month: mk, rows: ROWS, roster: [MATTHEW, UYEN, SARAH], now: Date.now() });
    eq(rep.monthImported[mk], month.provenance.monthRows > 0,
      `the year grid disagrees with compute() about whether ${mk} is imported`);
    for (let p = 0; p < month.providers.length; p++) {
      const mp = month.providers[p];
      const yr = rep.providers.filter((x) => x.key === mp.key)[0];
      ok(yr, `${mp.name} is in the Month view for ${mk} but missing from the year grid`);
      const cell = yr.cells[mk];
      eq(cell.state, 'imported', `${mp.name}/${mk} is "${cell.state}" in the year grid but has rows in the Month view`);
      eq(cell.days, mp.days, `${mp.name}/${mk}: year grid says ${cell.days} days, compute() says ${mp.days}`);
      eq(cell.appointments, mp.appointments, `${mp.name}/${mk}: year grid says ${cell.appointments} appts, compute() says ${mp.appointments}`);
      crossChecked++;
    }
  }
  measured.cellsCrossCheckedAgainstMonthView = crossChecked;
  ok(crossChecked >= 2, 'no imported cell was cross-checked against the Month view');

  /* --- 2. the three cell states, and NO zero anywhere in a missing one ----- */
  const matthew = rep.providers.filter((p) => /Matthew/.test(p.name))[0];
  const sarah = rep.providers.filter((p) => /Sarah/.test(p.name))[0];
  ok(matthew, 'Matthew is missing from the year grid');
  ok(sarah, 'Sarah is missing from the year grid - a roster clinician with no rows was OMITTED instead of reported as not imported');

  eq(matthew.cells['2025-01'].state, 'imported', 'January is not imported for Matthew');
  eq(matthew.cells['2025-01'].days, 2, 'Matthew January days');
  eq(matthew.cells['2025-01'].appointments, 3, 'Matthew January appointments');
  eq(matthew.cells['2025-02'].state, 'month-not-imported',
    'February has no imported rows at all, but Matthew\'s February cell is "' + matthew.cells['2025-02'].state + '"');
  eq(matthew.cells['2025-03'].state, 'not-imported',
    'March IS imported but carries no Matthew row - his cell must be a missing import, not a zero, and it is "' + matthew.cells['2025-03'].state + '"');

  let missingCells = 0;
  rep.providers.concat(rep.unattributed ? [rep.unattributed] : []).forEach((p) => {
    rep.months.forEach((mk) => {
      const c = p.cells[mk];
      ok(c, `${p.name}/${mk} has no cell at all - a consumer would have to invent one`);
      ok(c.state === 'imported' || c.state === 'not-imported' || c.state === 'month-not-imported',
        `${p.name}/${mk} carries the unknown state "${c.state}"`);
      if (c.state !== 'imported') { missingCells++; eq(c.days, 0, 'a missing cell carries a nonzero day count, which a renderer could print'); }
    });
  });
  measured.missingCells = missingCells;
  ok(missingCells > 20, 'the fixture did not exercise the missing-cell path');

  /* --- 3. totals sum ONLY imported months, and say how many they cover ----- */
  eq(rep.totals.monthsImported, 2, 'the year totals claim ' + rep.totals.monthsImported + ' imported months, expected 2');
  eq(rep.totals.days, 4, 'year totals days (Jan 01-06,01-08 + Mar 03-11,03-12 = 4 distinct dates)');
  eq(rep.totals.appointments, 5, 'year totals appointments (Jan 3 + Mar 2)');
  eq(matthew.monthsImported, 1, 'Matthew covers ' + matthew.monthsImported + ' of 12 months, expected 1');
  eq(matthew.days, 2, 'Matthew year days must sum ONLY his imported months');
  eq(sarah.monthsImported, 0, 'Sarah covers no month, so her coverage must be 0');
  eq(sarah.days, 0, 'Sarah has no imported month; her total is 0 but her CELLS must be em dashes, proved below');
  eq(rep.notImportedMonths.length, 10, 'ten months of 2025 have nothing imported');
  eq(rep.provenance.yearRows, 5, 'the year read the wrong number of rows (the 2024 row must not leak in)');
  ok(rep.unattributed && rep.unattributed.cells['2025-03'].appointments === 1,
    'the provider-blank March row was folded into a clinician instead of its own line');
  measured.yearTotals = { days: rep.totals.days, appointments: rep.totals.appointments, monthsImported: rep.totals.monthsImported };

  /* --- 4. the RENDERED grid prints an em dash, never a zero --------------- */
  const painted = env.api.open({ scope: 'year', year: YEAR });
  ok(painted && painted.year === YEAR, 'open({scope:"year"}) did not paint the year view');
  const html = env.created.map((n) => n.innerHTML).filter(Boolean).join('\n');
  ok(html.indexOf('Year report') >= 0, 'the painted card is not the Year report');
  ok(/mlsMRScope/.test(html), 'the Month|Year selector is missing from the painted card');
  /* Sarah's whole row: twelve missing cells. It must contain twelve recipe
     buttons and not a single standalone zero. */
  const rowStart = html.indexOf('Sarah Johnson');
  ok(rowStart > 0, 'Sarah has no row in the painted year grid');
  const rowHtml = html.slice(rowStart, html.indexOf('</tr>', rowStart));
  const dashes = (rowHtml.match(/&mdash;/g) || []).length;
  const cellButtons = (rowHtml.match(/class="mlsMRCell"/g) || []).length;
  measured.sarahRow = { dashes, cellButtons };
  eq(cellButtons, 12, 'Sarah\'s row paints ' + cellButtons + ' not-imported cells, expected 12');
  ok(dashes >= 12, 'Sarah\'s row paints ' + dashes + ' em dashes, expected at least 12');
  ok(!/>0</.test(rowHtml), 'a clinician with no imported month is rendering a ZERO - this is the exact defect the card exists to prevent');
  ok(/not imported yet/i.test(rowHtml), 'the missing cells do not say "not imported yet" to a screen reader');
  /* the recipe is one click away, and it is the provscope recipe */
  ok(/data-m="2025-0[1-9]"/.test(rowHtml), 'the missing cell carries no month for its recipe');
  ok(/MLS does not read a year directly from athenaOne/.test(html),
    'the year view no longer states that its numbers come from imported rows only');
  ok(/never as zero/.test(html), 'the year view no longer states the missing-is-not-zero law');
  measured.yearCardPainted = true;
  console.log('  A year report: 12 months, ' + crossChecked + ' cells cross-checked against the Month view, ' +
    missingCells + ' missing cells, Sarah renders ' + cellButtons + ' recipe buttons and zero zeros (DRIVEN)');
}

/* the em dash / recipe rule, pinned in the source so a future edit cannot
   quietly turn a missing cell back into a number. (READ) */
ok(/state === 'imported'/.test(REPORT_SRC), 'cellHtml no longer branches on the imported state');
ok(/month-not-imported/.test(REPORT_SRC), 'the month-not-imported state is gone');
/* the report writes the refusal code with non-breaking hyphens so it cannot
   wrap mid-token; match the shipped entity form, not the plain spelling. */
ok(/provider&#8209;not&#8209;on&#8209;calendar/.test(REPORT_SRC), 'the report no longer states the provscope refusal');
ok(/PROVSCOPE_STEP/.test(REPORT_SRC) && /provscopeStep/.test(REPORT_SRC),
  'the month and year recipes no longer share ONE provscope sentence, so they can drift apart');
ok(/year pull/.test(REPORT_SRC), 'the year recipe no longer names the Start year pull control');
ok(/nothing imported for/.test(REPORT_SRC),
  'a provider with no imported month can total to a printed zero again');

/* ==================================================================== B ====
 * THE YEAR PULL QUEUE - the shipped engine, driven
 * ========================================================================= */

function makeRangeHost(options) {
  options = options || {};
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { if (options.onWrite) { const r = options.onWrite(k, String(v)); if (r) throw r; } store.set(k, String(v)); },
    removeItem: (k) => store.delete(k),
    key: (i) => Array.from(store.keys())[i] || null,
    get length() { return store.size; }
  };
  const node = () => ({
    style: {}, dataset: {}, attrs: {}, children: [], hidden: false, value: '', textContent: '',
    innerHTML: '', className: '', id: '', checked: false, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  });
  const document = {
    readyState: 'complete', hidden: false, body: node(), head: node(), documentElement: node(),
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => node()
  };
  const window = {
    document, localStorage,
    __MLS_P1_PREVIEW: { enabled: true, route: '/1pScribeFlow.html', build: 'b-test' },
    uns: (k) => 'sf_u::doc@example.test::' + k,
    __mlsSessionAccount: 'doc@example.test',
    session: { email: 'doc@example.test', token: 'tok' },
    __mlsSessionToken: 'tok',
    __mlsVisitNotesPref: {
      read() { return { state: 'off', on: false, settled: true }; },
      ensureChosenForBulkPull() { return Promise.resolve({ ok: true, on: false, reason: 'test-choice-off' }); }
    },
    location: { hostname: 'mlsscribe.com' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setTimeout: () => 0, clearTimeout() {}, Intl
  };
  window.window = window;
  const navigator = {
    locks: { request(name, opts, cb) { return Promise.resolve(cb({ name })); } }
  };
  const context = vm.createContext({
    window, document, localStorage, navigator, console,
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Error,
    isFinite, parseInt, parseFloat, isNaN,
    setTimeout: (fn, ms) => { if (Number(ms || 0) <= 50) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(RANGE, context, { filename: '1p-feat_mls_rangejobs.js' });
  return { window, context, store, api: window.__mlsP1RangeJobs };
}
const settle = async (n) => { for (let i = 0; i < (n || 60); i++) await new Promise((r) => setImmediate(r)); };
const MKEY = 'sf_u::doc@example.test::p1RangeJobV1';
const PULL_YEAR = String(new Date().getUTCFullYear() - 1);

/* the real month seam, stubbed. Every dispatch is recorded with the exact
   month and dates the engine handed over, so "sequential" is measured, not
   asserted from the source. */
function installMonthEngine(host, perDay, hooks) {
  hooks = hooks || {};
  const dispatched = [];
  let inFlight = 0, maxInFlight = 0;
  host.window.__mlsSI = {
    pullMonth(opts) {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      dispatched.push({ month: opts.month, dates: (opts.dates || []).slice(), provider: opts.provider,
        pullVisitBodies: opts.pullVisitBodies });
      if (hooks.onDispatch) hooks.onDispatch(opts, dispatched.length);
      const days = [];
      let chain = Promise.resolve();
      (opts.dates || []).forEach((date) => {
        chain = chain.then(() => {
          if (opts.shouldStop && opts.shouldStop() === true) return;
          const outcome = perDay(date, dispatched.length, opts.month);
          days.push(Object.assign({ date }, outcome));
          if (opts.onDayCheckpoint) {
            opts.onDayCheckpoint({ date, ok: outcome.ok === true, complete: outcome.complete === true,
              reason: outcome.reason, sessionExpired: outcome.sessionExpired === true });
          }
        });
      });
      /* answer the way the real importer answers: a month is complete only
         when every day it was handed verified. Reporting every month partial
         would make the engine spend its three retry passes, which is correct
         engine behaviour but would measure retries instead of ordering. */
      return chain.then(() => { inFlight--;
        const allDone = days.length > 0 && days.every((d) => d.complete === true);
        return { ok: allDone, complete: allDone, reason: allDone ? 'month-complete' : 'month-partial',
          month: opts.month, days, totals: {}, retry: { dates: [] } };
      });
    },
    _resolveProviderRequest(raw, opts) {
      if (raw === 'all' && opts && opts.allowAll) return { ok: true, provider: 'all', receipt: { complete: true, providerMode: 'all' } };
      return { ok: false, reason: 'provider-unverified' };
    },
    stop() {}
  };
  return { dispatched, peak: () => maxInFlight };
}

(async function main() {
  /* --- 1. months run ONE AT A TIME, in order, through the real seam ------- */
  {
    const host = makeRangeHost();
    const seam = installMonthEngine(host, () => ({ ok: true, complete: true, reason: 'empty-day' }));
    const res = await host.api.startYear(PULL_YEAR);
    await settle(200);
    ok(seam.dispatched.length > 0, 'startYear dispatched no month at all: ' + JSON.stringify({ ok: res && res.ok, reason: res && res.reason }));
    eq(seam.peak(), 1, 'the year queue had ' + seam.peak() + ' months in flight at once - it must be exactly one');
    const order = seam.dispatched.map((d) => d.month);
    /* one clean pass: twelve months, ascending, none repeated. */
    const firstPass = order.slice(0, 12);
    assert.deepStrictEqual(firstPass, firstPass.slice().sort(),
      'the year queue ran months out of order: ' + order.join(','));
    eq(new Set(firstPass).size, 12, 'the first pass did not cover twelve distinct months: ' + firstPass.join(','));
    eq(order.length, 12, 'a fully verified year dispatched ' + order.length + ' month runs, expected exactly 12');
    eq(order[0], PULL_YEAR + '-01', 'the year queue did not start at January');
    eq(order[11], PULL_YEAR + '-12', 'the year queue did not end at December');
    measured.monthsDispatched = order.length;
    measured.peakInFlight = seam.peak();
    /* and each month's dates are that month's own days, not a flat year */
    seam.dispatched.forEach((d) => {
      ok(d.dates.every((x) => x.slice(0, 7) === d.month), d.month + ' was handed a date outside itself');
    });
    console.log('  B1 sequential: ' + order.length + ' months, peak in-flight ' + seam.peak() + ', ascending, own dates only (DRIVEN)');
  }

  /* --- 2. per-month verdicts are stamped honestly ------------------------- */
  {
    const host = makeRangeHost();
    /* January proves empty; February refuses to read; the rest prove empty. */
    installMonthEngine(host, (date, n, month) => (month.slice(5) === '02'
      ? { ok: false, complete: false, reason: 'no-read' }
      : { ok: true, complete: true, reason: 'empty-day' }));
    await host.api.startYear(PULL_YEAR);
    await settle(400);
    const state = host.api.state();
    const jan = state.months[PULL_YEAR + '-01'], feb = state.months[PULL_YEAR + '-02'];
    ok(jan && feb, 'the ledger is missing January or February');
    eq(jan.status, 'complete', 'a month whose every day verified empty is stamped "' + jan.status + '"');
    ok(feb.status !== 'complete', 'February could not be read, yet it is stamped complete');
    const janDay = jan.days[Object.keys(jan.days)[0]];
    eq(janDay.reason, 'empty-day', 'a verified-empty day is stamped "' + janDay.reason + '" instead of empty-day');
    const febDay = feb.days[Object.keys(feb.days)[0]];
    eq(febDay.reason, 'no-read', 'the unreadable day is stamped "' + febDay.reason + '" instead of the importer\'s own verdict');
    /* the queue summary lists both, and never claims the failures succeeded */
    ok(state.summary.days > 300, 'the year summary covers ' + state.summary.days + ' days');
    ok(state.summary.complete > 0 && state.summary.complete < state.summary.days,
      'the summary claims ' + state.summary.complete + ' of ' + state.summary.days + ' complete - a partial year cannot be all or nothing');
    measured.verdicts = { janStatus: jan.status, febStatus: feb.status, janDay: janDay.reason, febDay: febDay.reason,
      complete: state.summary.complete, days: state.summary.days, empty: state.summary.empty, failed: state.summary.failed };
    console.log('  B2 verdicts: Jan=' + jan.status + '/' + janDay.reason + ', Feb=' + feb.status + '/' + febDay.reason +
      ', summary ' + state.summary.complete + '/' + state.summary.days + ' (DRIVEN)');
  }

  /* --- 3. it STOPS between months and RESUMES from the persisted ledger --- */
  {
    const host = makeRangeHost();
    let pausedAfter = 0;
    const seam = installMonthEngine(host, () => ({ ok: true, complete: true, reason: 'empty-day' }), {
      onDispatch(opts, n) { if (n === 2) { pausedAfter = n; host.api.pause(); } }
    });
    await host.api.startYear(PULL_YEAR);
    await settle(300);
    const paused = host.api.state();
    eq(pausedAfter, 2, 'the pause hook never fired');
    ok(paused.status === 'paused' || paused.status === 'cancelled',
      'pause() between months left the job "' + paused.status + '"');
    const ranBeforePause = seam.dispatched.length;
    ok(ranBeforePause < 12, 'the queue ran all ' + ranBeforePause + ' months despite a pause after month 2');
    /* the ledger survived, and a NEW tab resumes from it */
    const saved = host.store.get(MKEY);
    ok(saved && saved.length, 'the paused job persisted no ledger, so a reload would lose it');
    const host2 = makeRangeHost();
    host2.store.set(MKEY, saved);
    const seam2 = installMonthEngine(host2, () => ({ ok: true, complete: true, reason: 'empty-day' }));
    const r2 = await host2.api.resume();
    await settle(400);
    ok(seam2.dispatched.length > 0, 'resume in a fresh tab dispatched nothing: ' + JSON.stringify({ ok: r2 && r2.ok, reason: r2 && r2.reason }));
    /* it must not redo the months the ledger already proved complete */
    const redone = seam2.dispatched.map((d) => d.month).filter((m) => {
      const rec = JSON.parse(saved).months[m];
      return rec && rec.status === 'complete';
    });
    eq(redone.length, 0, 'resume re-ran ' + redone.length + ' month(s) the ledger had already proved complete: ' + redone.join(','));
    measured.pause = { ranBeforePause, resumedFrom: seam2.dispatched[0].month, resumedMonths: seam2.dispatched.length };
    console.log('  B3 stop/resume: paused after ' + ranBeforePause + ' months, a fresh tab resumed at ' +
      seam2.dispatched[0].month + ' and redid none (DRIVEN)');
  }

  /* --- 4. it REFUSES while a job is running, and on a foreign lease ------- */
  {
    const host = makeRangeHost();
    installMonthEngine(host, () => ({ ok: true, complete: true, reason: 'empty-day' }));
    host.api.startYear(PULL_YEAR);            /* deliberately not awaited */
    const second = await host.api.startYear(PULL_YEAR);
    eq(second.ok, false, 'a second startYear was admitted while one was already running');
    ok(second.reason === 'job-busy' || second.reason === 'job-exists',
      'the concurrent start was refused with "' + second.reason + '" rather than naming the running job');
    await settle(400);
    /* a saved unfinished job blocks a NEW start in a fresh tab too */
    const host2 = makeRangeHost();
    host2.store.set(MKEY, JSON.stringify(Object.assign(JSON.parse(host.store.get(MKEY)), { status: 'paused', reason: 'paused' })));
    installMonthEngine(host2, () => ({ ok: true, complete: true, reason: 'empty-day' }));
    const third = await host2.api.startYear(PULL_YEAR);
    eq(third.ok, false, 'a new year pull was admitted on top of a saved unfinished job');
    eq(third.reason, 'job-exists', 'the saved-job refusal says "' + third.reason + '"');
    /* the lease the shipped engine refuses on: the Web Locks API missing */
    const noLock = makeRangeHost();
    installMonthEngine(noLock, () => ({ ok: true, complete: true, reason: 'empty-day' }));
    noLock.context.navigator.locks = null;
    const refused = await noLock.api.startYear(PULL_YEAR);
    eq(refused.ok, false, 'a year pull started with no way to coordinate across tabs');
    eq(refused.reason, 'range-lock-unavailable', 'the uncoordinated start was refused with "' + refused.reason + '"');
    measured.refusals = { concurrent: second.reason, savedJob: third.reason, noLock: refused.reason };
    console.log('  B4 refusals: concurrent=' + second.reason + ', saved-job=' + third.reason + ', no-lock=' + refused.reason + ' (DRIVEN)');
  }

  /* --- 5. the provscope law is stated where the year is started (READ) ---- */
  {
    ok(/mlsP1YearScopeNote/.test(RANGE), 'the year pull card no longer carries the provider-view prerequisite');
    ok(/provider-not-on-calendar\) rather than saved as empty/.test(RANGE),
      'the year card no longer names the provscope refusal in the importer\'s own words');
    /* the sentence lives inside a single-quoted JS string, so the shipped
       bytes carry a backslash before the apostrophe. */
    ok(/set the calendar\\?'s View to the provider selected above/.test(RANGE),
      'the year card no longer states the one human step that satisfies provscope');
    /* and the engine still forwards a real provider scope to every month */
    ok(/provider: liveProvider\.provider/.test(RANGE), 'the month seam no longer receives the job\'s provider scope');
    console.log('  B5 provscope: stated on the Year pull card, refusal named, provider scope still forwarded (READ)');
  }

  /* ================================================================== C ====
   * THE CALENDAR-ONLY PROVIDER
   * ======================================================================= */
  {
    function makeRosterHost() {
      const store = new Map();
      const localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
      };
      const script = {
        getAttribute(k) {
          if (k === 'data-mls-install-token') return 'tok-test';
          if (k === 'data-mls-asset') return 'feat_athena_provider_roster.js';
          return null;
        }
      };
      const document = {
        readyState: 'complete', currentScript: script,
        addEventListener() {}, removeEventListener() {},
        getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, addEventListener() {} }),
        body: { appendChild() {} }, documentElement: { appendChild() {} }
      };
      /* the roster binds every ingest to an owner made of account + epoch +
         token; all three must be real or current() refuses everything. */
      const sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
      const win = {
        document, localStorage, sessionStorage,
        __MLS_P1_PREVIEW: { enabled: true, route: '/1pScribeFlow.html', build: 'b-test' },
        __mlsP1ProviderRosterLoader: { installed: true, version: 'p1-provider-roster-1.0.0', installToken: 'tok-test' },
        __mlsSessionAccount: 'doc@example.test',
        __mlsSessionEpoch: 7,
        bkToken: () => 'bk-tok-test',
        uns: (k) => 'sf_u::doc@example.test::' + k,
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
        setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' }
      };
      win.window = win;
      const ctx = vm.createContext({
        window: win, document, localStorage, sessionStorage, console, Date, Math, JSON, Promise,
        Object, Array, String, Number, RegExp, Error, isFinite, parseInt, parseFloat, isNaN,
        WeakMap, Map, Set, URL,
        setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
      });
      vm.runInContext('(' + ROSTER.slice(ROSTER.indexOf('(function (root)') + 1, ROSTER.lastIndexOf('})(')) + '})(window);', ctx,
        { filename: '1p-feat_athena_provider_roster.js' });
      return { win, store, api: win.__mlsProviderRoster };
    }

    const host = makeRosterHost();
    ok(host.api && host.api.installed === true, 'the provider roster did not install in the harness');
    ok(typeof host.api.seenOnCalendar === 'function', 'the roster exposes no seenOnCalendar() - a calendar-only provider stays unselectable');

    /* BEFORE any refresh: nobody is seen. */
    eq(host.api.seenOnCalendar().length, 0, 'the roster reported calendar-seen providers before any schedule was read');

    /* the refresh: an athena view that names a credentialed clinician AND a
       bare-name one. The bare name is exactly the clinician makeEntry drops. */
    const owner = host.api._captureOwner('test');
    const CAL_ONLY = 'Jane Smith';
    host.api.merge([{ name: MATTHEW, id: '5501', source: 'backend-calendar' }], 'backend-calendar', owner);
    const seenBefore = host.api.list().map((e) => e.name);
    measured.rosterListAfterMerge = seenBefore.slice(0, 5);

    /* drive the calendar-seen capture the ONLY way the module accepts one: an
       armed, request-bound schedule response, shaped as the extension sends
       it. An unbound replay is refused by design, so arming is not a shortcut
       here - it is the real path. */
    function refresh(providers, requestId) {
      const armed = host.api.beginOperation({ targetDate: '2026-09-01', requestId: requestId, providerMode: 'all' });
      ok(armed && armed.requestId === requestId, 'beginOperation did not arm the request ' + requestId);
      return host.api.ingestResp({
        ok: true, requestId: requestId, providers: providers,
        providerRoster: [], appts: [], text: ''
      }, host.api._captureOwner('test'));
    }
    const ingest = refresh([MATTHEW, CAL_ONLY], 'req-1');
    measured.ingest = ingest && ingest.ignored ? { ignored: ingest.reason } : { ok: true };
    ok(!(ingest && ingest.ignored), 'the armed schedule response was refused: ' + JSON.stringify(measured.ingest));

    const seenList = host.api.seenOnCalendar();
    const seenNames = seenList.map((e) => e.name);
    measured.seenOnCalendar = seenNames;
    ok(seenNames.indexOf(CAL_ONLY) >= 0,
      'a clinician the athena view NAMED as a provider is still not selectable after a refresh: ' + JSON.stringify(seenNames));
    /* and the verified one is NOT duplicated into the unverified group */
    ok(!seenNames.some((n) => /Matthew/.test(n)),
      'a roster-verified clinician was duplicated into the calendar-seen group');

    /* the entry is honest about what it is */
    const jane = seenList.filter((e) => e.name === CAL_ONLY)[0];
    eq(jane.rosterVerified, false, 'a calendar-seen provider claims to be roster-verified');
    eq(jane.seenOnCalendar, true, 'the calendar-seen marker is missing, so a surface cannot label it');
    eq(jane.providerEligible, false, 'a calendar-seen provider claims roster eligibility');
    ok(/^calendar-seen:/.test(jane.stableKey), 'the calendar-seen key is not namespaced: ' + jane.stableKey);

    /* it RESOLVES, which is what makes a scoped pull possible at all */
    const resolved = host.api.resolve(jane.stableKey);
    ok(resolved && resolved.name === CAL_ONLY, 'a calendar-seen provider does not resolve, so no pull can be aimed at her');
    eq(resolved.rosterVerified, false, 'the resolved calendar-seen provider claims verification');
    const byName = host.api.resolve(CAL_ONLY);
    ok(byName && byName.name === CAL_ONLY, 'a calendar-seen provider does not resolve by name');

    /* the noise guard still holds: grid junk never becomes selectable */
    refresh(['Aetna', 'Low Back Pain', 'Room 4', 'Provider 12'], 'req-2');
    const afterNoise = host.api.seenOnCalendar().map((e) => e.name);
    measured.afterNoise = afterNoise;
    ['Aetna', 'Low Back Pain', 'Provider 12'].forEach((junk) => {
      ok(afterNoise.indexOf(junk) < 0, 'grid noise "' + junk + '" became a selectable provider');
    });
    /* the roster's own verified list is untouched by any of this */
    const listAfter = host.api.list().map((e) => e.name);
    ok(!listAfter.some((n) => n === CAL_ONLY),
      'a calendar-seen name leaked into list(), which every existing caller reads as "verified"');
    measured.listStillVerifiedOnly = listAfter;

    /* the case the owner actually described: athena proves NO identity at all,
       and the only clinicians that exist are calendar headers. The selector
       used to bail on an empty verified roster, which would hide them again. */
    const bare = makeRosterHost();
    const bareOwner = bare.api._captureOwner('test');
    bare.api.beginOperation({ targetDate: '2026-09-01', requestId: 'req-bare', providerMode: 'all' });
    bare.api.ingestResp({ ok: true, requestId: 'req-bare', providers: ['Jane Smith', 'Omar Haddad'],
      providerRoster: [], appts: [], text: '' }, bareOwner);
    const bareVerified = bare.api.list().map((e) => e.name);
    const bareSeen = bare.api.seenOnCalendar().map((e) => e.name);
    measured.bareRoster = { verified: bareVerified, seen: bareSeen };
    eq(bareVerified.length, 0, 'the bare-roster fixture accidentally verified somebody: ' + bareVerified.join(','));
    eq(bareSeen.length, 2, 'with no verified provider at all, ' + bareSeen.length +
      ' calendar clinicians are offered - the doctor would have nobody to pull for');
    ok(bare.api.resolve('Omar Haddad'), 'a calendar-only clinician does not resolve when the roster is empty');
    /* and the selector no longer bails before it has looked (READ) */
    ok(/resolved BEFORE the empty-roster bail/.test(CONNECT),
      'the provider selector resolves the calendar-seen group after its empty-roster bail, so it can never show them');
    ok(/!list\.length && !seenOnCal\.length/.test(CONNECT),
      'the selector bails on an empty VERIFIED roster again, hiding every calendar-only clinician');

    console.log('  C calendar-only provider: "' + CAL_ONLY + '" selectable and resolvable after a refresh; ' +
      'noise refused; list() still verified-only; ' + bareSeen.length + ' offered with an EMPTY roster (DRIVEN)');
  }

  /* the two guards this must never have weakened (READ) */
  ok(/provscope-1\.0\.0 is untouched/.test(ROSTER), 'the csp block no longer states that provscope is untouched');
  ok(/detectedOnly/.test(ROSTER) || /rosterVerified: false/.test(ROSTER),
    'a calendar-seen provider no longer carries the unverified marker the pull routes gate on');
  ok(/seenOnCalendar/.test(CONNECT), 'the provider selector never offers the calendar-seen group');
  ok(/Seen on the athena calendar - not verified yet/.test(CONNECT),
    'the calendar-seen group is offered WITHOUT its label - the doctor cannot tell verified from seen');
  /* the selector must not have quietly widened list() itself */
  ok(/list: listEntries/.test(ROSTER), 'listEntries is no longer the roster list');
  ok(/e\.providerEligible !== false/.test(ROSTER), 'the roster eligibility filter was removed rather than supplemented');

  /* ================================================================== D ====
   * TWIN PARITY - the repo's own definition of it
   * ======================================================================= */
  {
    const twins = [
      ['scripts/derive-cloned-from-1p.js', 'cloned'],
      ['scripts/derive-production-from-1p.js', 'production']
    ];
    twins.forEach(([script, label]) => {
      const out = execFileSync(process.execPath, [path.join(ROOT, script), '--check'], { cwd: ROOT, encoding: 'utf8' });
      ok(!/DRIFTED/.test(out), `the ${label} twin has drifted from the edited 1p lane:\n${out}`);
    });
    measured.twins = 'cloned + production derive --check clean';
    console.log('  D twins: cloned and production derive --check report no drift (DRIVEN)');
  }

  console.log('MEASURED ' + JSON.stringify(measured));
  console.log(`year-pull-and-report: ${checks} checks passed`);
})().catch((error) => {
  console.error('year-pull-and-report FAILED: ' + (error && error.message));
  console.error(error);
  process.exitCode = 1;
});

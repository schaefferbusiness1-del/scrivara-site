'use strict';

/* rptfix-1.0.0 / rattr-1.0.0 (b1184) - THE MONTH & YEAR REPORT, AND THE PULL
 * CARD IT SITS BESIDE, PROVED BY EXECUTION.
 *
 * Eleven measured defects, every one pinned here by PROPERTY - the real
 * builders run in a VM against fixtures and this suite reads what they
 * produced, rather than grepping for a spelling that a refactor can move.
 *
 *  47  "Days with seen visits" printed a bold 0 whenever the histogram held a
 *      bucket for the day but NO status was ever captured - the exact false
 *      zero the card exists to refuse, under a receipt claiming 3.0.98+.
 *  48  a second, less honest "Days worked" card shipped on the same Analysis
 *      page and printed 0 days for months that were never imported.
 *  49  both reports opened on the furthest-FUTURE booked month/year, so the
 *      first thing a doctor saw was a near-empty report for a month that has
 *      not happened - and an as-of receipt was captured for it.
 *  50  the as-of receipt was overwritten by the act of reading it, so a silent
 *      row loss was visible exactly once and then unprovable.
 *  51  seen-days could EXCEED days-with-appointments: the histogram was folded
 *      per bucket, not per day, and never intersected with the month.
 *  52  the ghost-provider fold merged the counts but kept the scraped column
 *      label ("Provider MATTHEW SCHAEFFER, MD") as the displayed name.
 *  53  the Month dropdown capped at 24 entries, so imported months fell off it
 *      silently.
 *  54  the writer's seen-class was wider than every sentence the card showed
 *      (including a bare "seen", which matches "not seen").
 *  16  a finished month manifest is never deleted, so its year/month-wide
 *      summary repainted the four tiles over every later pull on that card.
 *  17  Staff Prep's "Pull today only" bypassed the guarded dayPull lane.
 *  23  a year job adopted into the month card was painted as a month.
 *
 * Plus rattr-1.0.0, the receipt-driven repair for rows the import stored with
 * NO provider: it moves a day's rows to a clinician ONLY when a receipt MLS
 * wrote at pull time names exactly one verified provider for that whole day,
 * and it refuses - by name, with the days listed - in every other case.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const CONNECT = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
/* mls-connect.js carries bytes that are not valid UTF-8; latin1 round-trips. */
const PROD = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const SI = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

/* ---------------------------------------------------------------- slicing */
const mrStart = CONNECT.indexOf('/* ===== mrpt-1.0.0 - MONTH REPORT');
const mrEnd = CONNECT.indexOf('/* ===== end mrpt-1.0.0 ===== */');
ok(mrStart >= 0 && mrEnd > mrStart, 'the mrpt report slice is missing from 1p-mls-connect.js');
const REPORT_SRC = CONNECT.slice(mrStart, mrEnd);

/* the brace/quote/comment scanner the cancel suite uses - plain slicing over
   a 1.9MB file, with no assumption that a comment cannot hold a brace. */
function extractFn(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, marker + ' is missing');
  const open = source.indexOf('{', at + marker.length - 1);
  let depth = 0, mode = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i], p = source[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return source.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && source[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && source[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced ' + marker);
}

/* --------------------------------------------------------- report harness */
function makeNode(id) {
  const node = {
    id: id || '', innerHTML: '', className: '', value: '', textContent: '', disabled: false,
    style: { cssText: '', display: '', width: '' }, children: [], _handlers: {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { node.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
  return node;
}
function makeReportEnv(opts) {
  opts = opts || {};
  const storage = Object.assign({}, opts.storage || {});
  const created = [];
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; }
  };
  const buttons = {};
  const body = makeNode('body');
  const documentStub = {
    readyState: 'complete', body,
    getElementById() { return null; },
    createElement() {
      const n = makeNode();
      /* the card queries its own controls out of the box it just painted */
      n.querySelector = function (sel) {
        if (!/^#/.test(String(sel))) return null;
        const wanted = String(sel).slice(1);
        if (n.innerHTML.indexOf('id="' + wanted + '"') < 0) return null;
        if (!buttons[wanted]) buttons[wanted] = makeNode(wanted);
        return buttons[wanted];
      };
      created.push(n); return n;
    },
    addEventListener() {}, removeEventListener() {}
  };
  const win = {
    _calAppts: opts.rows || [], _calProviders: [], _calApptProviders: [],
    __mlsProviderRoster: opts.rosterApi || (opts.roster ? { providers() { return opts.roster.slice(); } } : null),
    uns(suffix) { return 'sf_u::' + (opts.account === undefined ? 'doc@example.test' : opts.account) + '::' + suffix; },
    unsResolved() { return opts.account === undefined ? true : !!opts.account; },
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
  new vm.Script(REPORT_SRC, { filename: 'mrpt.js' }).runInContext(sandbox);
  ok(win.__mlsMonthReport && win.__mlsMonthReport.installed === true, 'the report module did not install');
  return {
    win, storage, created, buttons, api: win.__mlsMonthReport,
    html() { return created.map(n => n.innerHTML).filter(Boolean).join('\n'); }
  };
}
function monthKey(offset) {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + (offset || 0), 1);
  return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2);
}
let rowSeq = 0;
function row(date, provider) {
  rowSeq += 1;
  return {
    id: 'appt-' + rowSeq, appt_date: date, provider: provider,
    name: 'Wanda Testerly', dob: '1961-04-02', mrn: 'MRN-882317',
    reason: 'knee pain follow up', status: 'booked', start_at: date + 'T14:00:00Z'
  };
}
const MATTHEW = 'Matthew Schaeffer, MD';
const GHOST = 'Provider MATTHEW SCHAEFFER, MD';
const UYEN = 'Uyen Nguyen, PA-C';
const PAST = monthKey(-1);
const FUTURE = monthKey(6);

/* =======================================================================
 * 47 + 51 - the seen column: no bucket without a status, folded by day,
 *           clamped to the days this month actually holds.
 * ===================================================================== */
{
  const histKey = 'sf_u::doc@example.test::mlsProvDayStatusV1';
  const rows = [
    row(PAST + '-03', MATTHEW), row(PAST + '-03', MATTHEW),
    row(PAST + '-04', MATTHEW), row(PAST + '-05', MATTHEW),
    row(PAST + '-06', UYEN)
  ];
  /* Matthew: three days in the store. Two carry NO status at all (a pre-3.0.98
     pull), one carries statuses with zero seen-class rows. Uyen: one day, all
     scheduled. Plus a day the calendar reconcile has since deleted. */
  const store = {
    v: 1,
    days: {
      [PAST + '-03']: { 'matthew schaeffer, md': { name: MATTHEW, total: 9, seen: 0, statuses: {} } },
      [PAST + '-04']: { 'matthew schaeffer, md': { name: MATTHEW, total: 5, seen: 0, statuses: {} } },
      [PAST + '-06']: { 'uyen nguyen, pa-c': { name: UYEN, total: 3, seen: 0, statuses: { scheduled: 3 } } },
      [PAST + '-28']: { 'matthew schaeffer, md': { name: MATTHEW, total: 4, seen: 4, statuses: { 'checked out': 4 } } }
    }
  };
  const env = makeReportEnv({ rows, roster: [MATTHEW, UYEN], storage: { [histKey]: JSON.stringify(store) } });
  const bare = env.api.provStatusFor(PAST);
  eq(Object.keys(bare.byKey).filter(k => /matthew/.test(k)).length, 1,
    '47: a status-less bucket must not be the only thing keeping a provider in the join');
  const mBare = bare.byKey[Object.keys(bare.byKey).find(k => /matthew/.test(k))];
  eq(mBare.statusDays, 1, '47: only the ONE Matthew day that actually carried a status may count');
  eq(mBare.seenDays, 1, '47: that day was checked out, so it is a seen day');

  /* the clamp: the reconcile-deleted day is not in the month report at all */
  const rep = env.api.compute({ month: PAST, rows, roster: [MATTHEW, UYEN], now: Date.now() });
  const allow = env.api.allowedDaysFor(rep);
  const clamped = env.api.provStatusFor(PAST, allow);
  const mKey = Object.keys(clamped.byKey).find(k => /matthew/.test(k));
  eq(mKey, undefined, '51: a histogram day the month no longer holds must not be counted for anybody');
  const uKey = Object.keys(clamped.byKey).find(k => /uyen/.test(k));
  ok(uKey, '51: a provider whose status day IS in the month must survive the clamp');
  eq(clamped.byKey[uKey].statusDays, 1, '51: Uyen has one day with a status');
  eq(clamped.byKey[uKey].seenDays, 0, '51: none of Uyen\'s rows carried a seen-class status');

  /* THE RENDERED CELL: a dash for Matthew (nothing captured), a MEASURED zero
     for Uyen that says how much it measured. */
  const painted = env.api.open(PAST);
  ok(painted && painted.month === PAST, '49: open() landed on ' + (painted && painted.month) + ' not the past month with rows');
  const html = env.html();
  const mRow = html.slice(html.indexOf('Matthew Schaeffer'), html.indexOf('</tr>', html.indexOf('Matthew Schaeffer')));
  ok(/&mdash;/.test(mRow), '47: a provider with NO captured status must render the em dash, not a number');
  ok(!/<b>0<\/b>/.test(mRow), '47: the false bold zero is back in the seen column');
  ok(/Re-pull this month with MLS Assist 3\.0\.98 or newer/.test(mRow), '47: the dash lost its re-pull guidance');
  const uRow = html.slice(html.indexOf('Uyen Nguyen'), html.indexOf('</tr>', html.indexOf('Uyen Nguyen')));
  ok(/<b>0<\/b>/.test(uRow), '47: a MEASURED zero must still print as a number');
  ok(/of 1 day with a status/.test(uRow), '47: a measured zero must say how many days it measured');

  /* fold by day: two spellings of one clinician on ONE day = one day */
  const twoSpellings = {
    v: 1,
    days: {
      [PAST + '-03']: {
        'matthew schaeffer, md': { name: MATTHEW, total: 4, seen: 2, statuses: { 'checked out': 2, scheduled: 2 } },
        'provider matthew schaeffer, md': { name: GHOST, total: 3, seen: 1, statuses: { arrived: 1 } }
      }
    }
  };
  const env2 = makeReportEnv({ rows, roster: [MATTHEW], storage: { [histKey]: JSON.stringify(twoSpellings) } });
  const ps2 = env2.api.provStatusFor(PAST);
  const k2 = Object.keys(ps2.byKey);
  eq(k2.length, 1, '51: two spellings of one clinician must fold to ONE key');
  eq(ps2.byKey[k2[0]].statusDays, 1, '51: two buckets on ONE calendar day counted as two days');
  eq(ps2.byKey[k2[0]].seenDays, 1, '51: seen days must be counted per DAY, not per bucket');
  eq(ps2.byKey[k2[0]].seenAppts, 3, '51: seen appointments still sum every bucket');
  const rep2 = env2.api.compute({ month: PAST, rows, roster: [MATTHEW], now: 0 });
  const m2 = rep2.providers.filter(p => /Matthew/.test(p.name))[0];
  ok(ps2.byKey[k2[0]].seenDays <= m2.days,
    '51: days with seen visits (' + ps2.byKey[k2[0]].seenDays + ') exceeded days with appointments (' + m2.days + ')');
}

/* =======================================================================
 * 52 - the fold keeps the count, the ROSTER keeps the name.
 * ===================================================================== */
{
  /* the ghost row sorts FIRST (earlier date), which is what used to decide */
  const rows = [row(PAST + '-10', GHOST), row(PAST + '-11', MATTHEW)];
  const env = makeReportEnv({ rows, roster: [] });
  const rep = env.api.compute({ month: PAST, rows, roster: [], now: 0 });
  eq(rep.providers.length, 1, '52: the welded column label minted a ghost provider row');
  eq(rep.providers[0].days, 2, '52: the ghost spelling did not fold into the real provider');
  eq(rep.providers[0].name, MATTHEW, '52: the row is labelled with the scraped column label, which is not a name in athenaOne');
  /* and the roster spelling wins even when NO row carries it cleanly */
  const ghostOnly = [row(PAST + '-10', GHOST)];
  const rep2 = env.api.compute({ month: PAST, rows: ghostOnly, roster: [MATTHEW], now: 0 });
  eq(rep2.providers[0].name, MATTHEW, '52: the roster spelling must win over a scraped label');
  /* the year grid carries the same name */
  const year = env.api.computeYear({ year: PAST.slice(0, 4), rows, roster: [], now: 0 });
  eq(year.providers[0].name, MATTHEW, '52: the year grid still labels the row with the scraped column label');
  /* and the recipe sentence a doctor is told to follow names a real person */
  const painted = env.api.open({ scope: 'year', year: PAST.slice(0, 4) });
  ok(painted, '52: the year view did not paint');
  ok(env.html().indexOf(GHOST) < 0, '52: the scraped column label reached the rendered card');
}

/* =======================================================================
 * 49 - neither report opens on a month that has not happened.
 * ===================================================================== */
{
  const rows = [
    row(PAST + '-03', MATTHEW), row(PAST + '-04', MATTHEW),
    row(FUTURE + '-11', MATTHEW)                       /* one forward booking */
  ];
  const env = makeReportEnv({ rows, roster: [MATTHEW] });
  const rep = env.api.open();
  eq(rep.month, PAST, '49: the Month report opened on a future month');
  ok(rep.provenance.monthRows >= 2, '49: the month it opened on holds no data');
  /* the future month is still SELECTABLE - only the landing changed */
  ok(env.html().indexOf('value="' + FUTURE + '"') >= 0, '49: the future month vanished from the picker');
  /* nothing was captured for the phantom month */
  const stored = env.storage['sf_u::doc@example.test::mlsMonthReportV1'];
  ok(!stored || Object.keys(JSON.parse(stored).months).indexOf(FUTURE) < 0,
    '49: an as-of receipt was captured for a month that has not happened');
  env.api.close();
  const yearNow = String(new Date().getFullYear());
  const futureYearRows = [row(PAST + '-03', MATTHEW), row((Number(yearNow) + 1) + '-03-11', MATTHEW)];
  const env2 = makeReportEnv({ rows: futureYearRows, roster: [MATTHEW] });
  const yrep = env2.api.openYear();
  eq(yrep.year, yearNow, '49: the Year report opened on a year that has not happened');
}

/* =======================================================================
 * 53 - an imported month can never fall off the picker.
 * ===================================================================== */
{
  const rows = [];
  for (let i = 1; i <= 30; i++) rows.push(row(monthKey(-i) + '-05', MATTHEW));
  const oldest = monthKey(-30);
  const env = makeReportEnv({ rows, roster: [MATTHEW] });
  env.api.open(monthKey(-1));
  const html = env.html();
  ok(html.indexOf('value="' + oldest + '"') >= 0,
    '53: the oldest imported month (' + oldest + ') is not offered in the Month picker');
  let offered = 0;
  for (let i = 1; i <= 30; i++) if (html.indexOf('value="' + monthKey(-i) + '"') >= 0) offered++;
  eq(offered, 30, '53: only ' + offered + ' of 30 imported months are reachable from the Month view');
}

/* =======================================================================
 * 50 - the receipt is not destroyed by reading it.
 * ===================================================================== */
{
  const key = 'sf_u::doc@example.test::mlsMonthReportV1';
  const full = [row(PAST + '-03', MATTHEW), row(PAST + '-03', MATTHEW), row(PAST + '-04', MATTHEW)];
  const env = makeReportEnv({ rows: full, roster: [MATTHEW] });
  const first = env.api.capture(env.api.compute({ month: PAST, rows: full, roster: [], now: 1000 }));
  eq(first.written, true, '50: the first capture refused: ' + first.reason);
  /* an unchanged month still refreshes its stamp - nothing is lost by that */
  const same = env.api.capture(env.api.compute({ month: PAST, rows: full, roster: [], now: 2000 }));
  eq(same.written, true, '50: a repeat read of an UNCHANGED month must still refresh the receipt');
  eq(JSON.parse(env.storage[key]).months[PAST].at, 2000, '50: the unchanged re-capture did not refresh the stamp');

  /* now a retirement pass takes two rows away */
  const shrunk = [full[0]];
  env.win._calAppts = shrunk;
  const second = env.api.capture(env.api.compute({ month: PAST, rows: shrunk, roster: [], now: 3000 }));
  eq(second.written, false, '50: a DISAGREEING read overwrote the as-of receipt');
  eq(second.reason, 'receipt-held', '50: the held receipt must name itself');
  const held = JSON.parse(env.storage[key]).months[PAST];
  eq(held.totals.appointments, 3, '50: the original receipt figures were destroyed by the second read');
  /* and it stays provable on every later open, not just the first */
  const painted = env.api.open(PAST);
  eq(painted.totals.appointments, 1, '50: the table must show the LIVE figures');
  let html = env.html();
  ok(/captured on/.test(html), '50: the card stopped showing the as-of figures it disagrees with');
  ok(/ORIGINAL receipt is kept/.test(html), '50: the card does not say the receipt was kept rather than overwritten');
  ok(html.indexOf('id="mlsMRRebase"') >= 0, '50: there is no visible way to re-baseline a held receipt');
  env.api.close();
  /* the explicit re-baseline is the only thing that replaces it */
  const re = env.api.recapture(PAST);
  eq(re.written, true, '50: the explicit re-baseline was refused: ' + re.reason);
  eq(JSON.parse(env.storage[key]).months[PAST].totals.appointments, 1, '50: re-baseline did not replace the receipt');
}

/* =======================================================================
 * 54 - the disclosed seen-class list IS the writer's definition.
 * ===================================================================== */
{
  const writerWords = /var SEEN_STATUS_WORDS = (\[[^\]]*\]);/.exec(SI);
  const readerWords = /var SEEN_CLASS_WORDS = (\[[^\]]*\]);/.exec(REPORT_SRC);
  ok(writerWords, '54: the writer no longer names its seen-class list');
  ok(readerWords, '54: the report no longer names its seen-class list');
  const w = JSON.parse(writerWords[1].replace(/'/g, '"'));
  const r = JSON.parse(readerWords[1].replace(/'/g, '"'));
  assert.deepStrictEqual(w, r, '54: the writer counts a status the card never names, or the card names one it does not count');
  checks++;
  ok(!/\|seen\b/.test(SI.slice(SI.indexOf('var SEEN_STATUS_RE'), SI.indexOf('var SEEN_STATUS_RE') + 200)),
    '54: the bare "seen" alternative is back - it matches "not seen"');

  /* EXECUTE the shipped fold: the definition is what it counts. */
  const foldStart = SI.indexOf('var SEEN_STATUS_WORDS = [');
  const foldEndMark = 'safe(function () { localStorage.setItem(k, JSON.stringify(store)); });';
  const foldEnd = SI.indexOf(foldEndMark, foldStart);
  ok(foldStart > 0 && foldEnd > foldStart, '54: the provstatus fold could not be sliced out of the importer');
  const foldSrc = SI.slice(foldStart, foldEnd + foldEndMark.length);
  const storage = {};
  const ctx = vm.createContext({
    Object, String, Number, JSON, Date, Math, RegExp, Array, console,
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
      setItem(k, v) { storage[k] = String(v); }
    },
    window: { uns(s) { return 'sf_u::doc@example.test::' + s; } },
    isFn(v) { return typeof v === 'function'; },
    safe(fn, d) { try { return fn(); } catch (e) { return d; } },
    normDate(v) { return String(v || '').slice(0, 10); },
    target: PAST + '-03',
    requestedProvider: null,
    appts: [
      { provider: MATTHEW, _date: PAST + '-03', status: 'Checked Out' },
      { provider: MATTHEW, _date: PAST + '-03', status: 'completed' },
      { provider: MATTHEW, _date: PAST + '-03', status: 'roomed' },
      { provider: MATTHEW, _date: PAST + '-03', status: 'not seen' },
      { provider: MATTHEW, _date: PAST + '-03', status: 'unseen' },
      { provider: MATTHEW, _date: PAST + '-03', status: 'scheduled' }
    ]
  });
  vm.runInContext('(function(){' + foldSrc + '})()', ctx, { filename: 'provstatus-fold.js' });
  const written = JSON.parse(storage['sf_u::doc@example.test::mlsProvDayStatusV1']);
  const bucket = written.days[PAST + '-03']['matthew schaeffer, md'];
  eq(bucket.total, 6, '54: the fold dropped a row');
  eq(bucket.seen, 3, '54: the seen count is not the disclosed list - "not seen"/"unseen" must NOT count, "completed"/"roomed" must');
  assert.deepStrictEqual(written.seenClass, w, '54: the store does not record the definition it was written under');
  checks++;

  /* every disclosed word reaches the doctor */
  const env = makeReportEnv({
    rows: [row(PAST + '-03', MATTHEW)], roster: [MATTHEW],
    storage: { 'sf_u::doc@example.test::mlsProvDayStatusV1': JSON.stringify(written) }
  });
  env.api.open(PAST);
  const html = env.html();
  w.forEach(function (word) { ok(html.indexOf(word) >= 0, '54: the card never names the seen-class status "' + word + '" it counts'); });
}

/* =======================================================================
 * rattr-1.0.0 - re-attribute ONLY from a receipt that names one provider.
 * ===================================================================== */
function rattrEnv(opts) {
  opts = opts || {};
  const acct = 'sf_u::doc@example.test::';
  const rows = opts.rows;
  const storage = {};
  if (opts.manifest) storage[acct + 'p1RangeJobV1'] = JSON.stringify(opts.manifest);
  if (opts.authority) storage[acct + 'schedAuthoritativeDaysV1'] = JSON.stringify(opts.authority);
  (opts.ledgerDays || []).forEach(function (d) { storage[acct + 'schedImportIndexV1::' + d] = JSON.stringify({ v: 1, rows: {} }); });
  return makeReportEnv({
    rows, storage, roster: opts.roster || [MATTHEW],
    rosterApi: {
      providers() { return (opts.roster || [MATTHEW]).slice(); },
      resolve(ref) {
        const map = opts.resolve || { 'stable-matthew': MATTHEW };
        const name = map[String(ref)];
        return name ? { name, stableKey: String(ref) } : null;
      }
    }
  });
}
function monthManifest(days, extra) {
  const m = {
    v: 1, kind: 'month', target: PAST, status: 'complete', updatedAt: 1000,
    provider: { mode: 'selected', id: 'p-7', stableKey: 'stable-matthew' },
    scope: { v: 1, mode: 'selected', verified: true, at: 900, listed: 3, scopeKind: 'day' },
    months: { [PAST]: { status: 'complete', days: {} } }
  };
  Object.keys(days).forEach(function (d) { m.months[PAST].days[d] = { status: days[d], attempts: 1 }; });
  return Object.assign(m, extra || {});
}
{
  const rows = [
    row(PAST + '-03', ''), row(PAST + '-03', ''),      /* receipt: complete   */
    row(PAST + '-04', ''),                             /* receipt: complete   */
    row(PAST + '-05', ''),                             /* receipt: retry      */
    row(PAST + '-06', ''),                             /* no receipt at all   */
    row(PAST + '-07', MATTHEW)                         /* already attributed  */
  ];
  const env = rattrEnv({
    rows,
    manifest: monthManifest({ [PAST + '-03']: 'complete', [PAST + '-04']: 'complete', [PAST + '-05']: 'retry' }),
    ledgerDays: [PAST + '-05']
  });
  const plan = env.api.reattributePlan(PAST);
  eq(plan.ready.length, 2, 'rattr: only the days the receipt marked complete may move');
  eq(plan.rows, 3, 'rattr: the plan must count the rows it would move');
  /* values built inside the vm realm carry that realm's Array prototype, so
     deepStrictEqual would compare prototypes rather than contents. */
  eq(Array.prototype.slice.call(plan.ready).map(r => r.day).join(','), PAST + '-03,' + PAST + '-04',
    'rattr: the wrong days are ready');
  eq(plan.ready[0].name, MATTHEW, 'rattr: the mover must be named from the roster, not from the manifest');
  eq(plan.blocked.length, 2, 'rattr: every day that cannot be proved must be listed');
  ok(/no provider-scoped pull receipt/.test(plan.blocked.find(b => b.day === PAST + '-05').why),
    'rattr: a day with an import ledger and no receipt must say exactly that');
  ok(/no import receipt for this day at all/.test(plan.blocked.find(b => b.day === PAST + '-06').why),
    'rattr: a day MLS never imported must be distinguished from one it could not prove');

  /* the card offers it, names the days, and never claims the blocked ones */
  env.api.open(PAST);
  let html = env.html();
  ok(html.indexOf('id="mlsMRAttrGo"') >= 0, 'rattr: the one-click repair is not on the card');
  ok(/No provider recorded/.test(html), 'rattr: the honest unattributed row disappeared');
  ok(html.indexOf(PAST + '-06') >= 0, 'rattr: the card does not say WHICH days it cannot repair');
  ok(html.indexOf('id="mlsMRAttrPull"') >= 0, 'rattr: the card does not offer to pull the month for a provider');
  env.api.close();

  const applied = env.api.applyReattribution(PAST);
  eq(applied.ok, true, 'rattr: the apply failed: ' + applied.reason);
  eq(applied.moved.days, 2, 'rattr: the wrong number of days moved');
  eq(applied.moved.rows, 3, 'rattr: the wrong number of rows moved');
  const blob = env.storage['sf_u::doc@example.test::mlsProvDayAttributionV1'];
  ok(blob, 'rattr: nothing was persisted');
  ['Wanda Testerly', '1961-04-02', 'MRN-882317', 'knee pain follow up', 'appt-'].forEach(function (needle) {
    ok(blob.indexOf(needle) < 0, 'rattr: PATIENT DATA REACHED THE ATTRIBUTION STORE: ' + needle);
  });

  const after = env.api.report(PAST);
  const m = after.providers.filter(p => p.name === MATTHEW)[0];
  eq(m.appointments, 4, 'rattr: the moved rows are not counted for the provider the receipt names');
  eq(m.reattributed, 3, 'rattr: the provider row does not carry how many of its rows were moved');
  eq(after.unattributed.appointments, 2, 'rattr: the rows that could NOT be proved were moved anyway');
  eq(after.provenance.reattributedRows, 3, 'rattr: the provenance does not count the moved rows apart');

  env.api.open(PAST);
  html = env.html();
  ok(/moved here from a provider-scoped pull receipt/.test(html), 'rattr: the table does not disclose the moved rows');
  ok(/Undo re/.test(html), 'rattr: there is no way to undo a re-attribution');
  ok(/counted for a clinician only because a pull receipt/.test(html), 'rattr: the provenance does not state the rule');
  env.api.close();

  const cleared = env.api.clearReattribution(PAST);
  eq(cleared.cleared, 2, 'rattr: undo did not remove the month\'s overlay days');
  eq(env.api.report(PAST).unattributed.appointments, 5, 'rattr: undo did not put the rows back under "No provider recorded"');
}
/* the refusals: an all-provider job, an unverified scope, an all-scope day
   read, and two receipts that disagree - none of them may move a row. */
{
  const rows = [row(PAST + '-03', ''), row(PAST + '-04', '')];
  const days = { [PAST + '-03']: 'complete', [PAST + '-04']: 'complete' };

  const allJob = rattrEnv({ rows, manifest: monthManifest(days, { provider: { mode: 'all' } }) });
  eq(allJob.api.reattributePlan(PAST).ready.length, 0, 'rattr: an ALL-provider job named a provider for a day');
  ok(/all-provider job/.test(allJob.api.reattributePlan(PAST).blocked[0].why), 'rattr: the all-provider refusal does not say why');

  const noScope = rattrEnv({ rows, manifest: monthManifest(days, { scope: null }) });
  eq(noScope.api.reattributePlan(PAST).ready.length, 0, 'rattr: a job with no verified scope stamp moved rows');
  ok(/no verified provider-scope stamp/.test(noScope.api.reattributePlan(PAST).blocked[0].why),
    'rattr: the unverified-scope refusal does not say why');

  const unknown = rattrEnv({ rows, manifest: monthManifest(days), resolve: {} });
  eq(unknown.api.reattributePlan(PAST).ready.length, 0, 'rattr: a provider the roster cannot name was used anyway');

  const allScopeDay = rattrEnv({
    rows, manifest: monthManifest(days),
    authority: { v: 1, days: { [PAST + '-03']: { all: { v: 1, date: PAST + '-03', mode: 'all', providerKey: '', backendIds: [], sourceCount: 0, updated: 5 } }, providers: {} } }
  });
  const asPlan = allScopeDay.api.reattributePlan(PAST);
  eq(asPlan.ready.length, 1, 'rattr: a day that was ALSO read as a whole-clinic view must be refused');
  eq(asPlan.ready[0].day, PAST + '-04', 'rattr: the wrong day survived the all-scope refusal');
  ok(/whole-clinic view/.test(asPlan.blocked[0].why), 'rattr: the all-scope refusal does not name itself');

  const disagree = rattrEnv({
    rows, manifest: monthManifest(days),
    roster: [MATTHEW, UYEN],
    resolve: { 'stable-matthew': MATTHEW, 'stable-uyen': UYEN },
    authority: {
      v: 1,
      days: { [PAST + '-03']: { all: null, providers: { 'stable-uyen': { v: 1, date: PAST + '-03', mode: 'selected', providerKey: 'stable-uyen', backendIds: ['a1'], sourceCount: 1, updated: 6 } } } }
    }
  });
  const dPlan = disagree.api.reattributePlan(PAST);
  eq(dPlan.ready.length, 1, 'rattr: two receipts naming different clinicians must move nothing for that day');
  ok(/different clinicians/.test(dPlan.blocked[0].why), 'rattr: the conflict refusal does not name itself');

  /* and with no account there is nothing to scope a receipt to */
  const anon = makeReportEnv({ rows, roster: [MATTHEW], account: '' });
  eq(anon.api.reattributePlan(PAST).reason, 'no-account-scope', 'rattr: an unowned session wrote an attribution');
}

/* =======================================================================
 * 48 - the second, less honest card is gone from BOTH bundles.
 * ===================================================================== */
[['1p-mls-connect.js', CONNECT], ['mls-connect.js', PROD]].forEach(function (pair) {
  const name = pair[0], src = pair[1];
  ok(src.indexOf("card.id='mlsDWCard'") < 0, '48: ' + name + ' still injects the Days worked card');
  ok(src.indexOf("id=\"mlsDWOpen\"") < 0, '48: ' + name + ' still ships the Days worked Open button');
  ok(src.indexOf("window.__mlsDaysWorked=api") < 0, '48: ' + name + ' still installs dw-1.1.0');
  ok(src.indexOf('feat_days_worked (dw-1.1.0) - RETIRED') > 0, '48: ' + name + ' lost the record of why the card was retired');
});

/* =======================================================================
 * 16 + 23 - the four tiles belong to THIS card's run, or to nobody.
 * ===================================================================== */
{
  const pTileSrc = extractFn(CONNECT, 'function pTile(id, val, label)');
  const pCountsSrc = extractFn(CONNECT, 'function pCounts()');
  function tileHost(P, manifest, cardMonth) {
    const spans = {}, els = {};
    ['ez3cFound', 'ez3cSaved', 'ez3cDup', 'ez3cFail'].forEach(function (id) {
      spans[id] = { textContent: '' };
      els[id] = { textContent: '', parentNode: { querySelector() { return spans[id]; } } };
    });
    els.ez3sMonth = { value: cardMonth || '' };
    els.ez3PullBar = { style: { width: '' } };
    ['ez3PullPause', 'ez3PullResume', 'ez3PullRetry', 'ez3PullCancel', 'ez3PullStart'].forEach(function (id) {
      els[id] = { style: { display: '' }, disabled: false };
    });
    const texts = {};
    const ctx = vm.createContext({
      P, String, Math, Object, Number,
      $: (id) => els[id] || null,
      pSet: (id, txt) => { texts[id] = txt; if (els[id]) els[id].textContent = txt; },
      p1RangeState: () => manifest,
      p1RangeRunning: (st) => !!st && (st.status === 'running' || st.status === 'pending'),
      p1RangeResumable: (st) => !!st && /^(paused|waiting-login|waiting-retry|storage-failed|needs-attention|account-changed)$/.test(String(st.status || ''))
    });
    vm.runInContext(pTileSrc, ctx, { filename: 'pTile' });
    vm.runInContext(pCountsSrc, ctx, { filename: 'pCounts' });
    vm.runInContext('pCounts()', ctx);
    return { els, spans, texts };
  }
  const finishedMonth = {
    kind: 'month', target: PAST, status: 'complete',
    summary: { withRows: 22, complete: 30, empty: 8, days: 31, failed: 0, needsAttention: 0 }
  };
  const dayP = {
    found: 7, saved: 6, dups: 1, running: false, range: { ym: null, keys: ['2026-09-01'] },
    emptyDays: [], failedDays: [], dayStatus: { '2026-09-01': { status: 'done' } }
  };
  /* the measured defect: a DAY pull on the same card, under a finished month */
  const day = tileHost(dayP, finishedMonth, PAST);
  eq(day.els.ez3cFound.textContent, '7', '16: a finished month job repainted its own totals over a day pull');
  eq(day.els.ez3cSaved.textContent, '6', '16: the "saved" tile is the finished job\'s, not this run\'s');
  eq(day.spans.ez3cSaved.textContent, 'saved', '16: the tile kept the durable label over the legacy number');
  eq(day.spans.ez3cFail.textContent, 'failed days', '16: the fail tile kept a label from the other engine');

  /* the SAME card, when the saved job really is this run */
  const monthP = {
    found: 0, saved: 0, dups: 0, running: false, range: { ym: PAST, keys: ['x'] },
    emptyDays: [], failedDays: [], dayStatus: {}
  };
  const owned = tileHost(monthP, finishedMonth, PAST);
  eq(owned.els.ez3cSaved.textContent, '30', '16: the durable summary must still paint its OWN month');
  eq(owned.spans.ez3cSaved.textContent, 'days saved', '16: the durable tile lost its label');

  /* a YEAR job is never this card's job */
  const yearJob = {
    kind: 'year', target: String(new Date().getFullYear() - 1), status: 'paused',
    summary: { withRows: 180, complete: 212, empty: 40, days: 365, failed: 3, needsAttention: 2 }
  };
  const yr = tileHost(monthP, yearJob, PAST);
  eq(yr.els.ez3cSaved.textContent, '0', '23: a YEAR job painted its year-wide totals into the month tiles');
  eq(yr.els.ez3PullResume.style.display, 'none', '23: the month card offered "Resume month pull" for a year job');
  const yrNoP = tileHost(null, yearJob, PAST);
  eq(yrNoP.els.ez3cSaved.textContent, '', '23: a reloaded card painted a year job into the month tiles');
  eq(yrNoP.els.ez3PullStart.disabled, true, '23: the card offered a month start under a saved year job');

  /* and the month card declines to ADOPT a year manifest at all */
  const adopt = extractFn(CONNECT, 'function p1RangeAdopt()');
  ok(/if \(String\(st\.kind \|\| ''\) === 'year'\) return P;/.test(adopt),
    '23: the month card adopts a year manifest again, and paints it as a month');
  const receipt = extractFn(CONNECT, 'function p1RangeReceiptLine(st)');
  ok(/year pull/.test(receipt), '23: the receipt line no longer names a year job as a year');
}

/* =======================================================================
 * 17 - "Pull today only" runs the guarded lane every other button runs.
 * ===================================================================== */
{
  const start = extractFn(CONNECT, 'function startDayPull(retryOnly, rosterRetried, choiceAdmitted, fullNotesChoice)');
  /* everything after this exact line is the pre-2026-07-08 fallback body that
     has been unreachable since the exact engine landed; the LIVE lane is
     what runs. */
  const deadAt = start.indexOf('\n    return;\n    if (P && P.running) return;');
  ok(deadAt > 0, '17: the live day-pull lane could not be bounded');
  const live = start.slice(0, deadAt);
  ok(/exact\.dayPull\(dpOpts\)/.test(live), '17: Staff Prep no longer calls the guarded dayPull entry');
  ok(/isFn\(exact\.dayPull\) \? exact\.dayPull\(dpOpts\) : exact\.pull\(dpOpts\)/.test(live),
    '17: dayPull must be the PRIMARY route with si.pull only as the legacy fallback');
  ok(!/exact\._resolveProviderRequest/.test(live),
    '17: the local provider pre-gate is back, so this lane resolves a scope dayPull is entitled to resolve');
  ok(/dpOpts\.provider = exactScope/.test(live) && /activeProviderRequest\(\)/.test(live),
    '17: the Staff Prep picker is no longer forwarded as the pull scope');
  ok(/includeHistory: true/.test(live), '17: the day pull stopped asking for history');
  ok(/pullVisitBodies: P\.pullVisitBodies === true/.test(live), '17: the frozen Full Notes choice is no longer forwarded');
  /* the production twin carries the same lane */
  ok(PROD.indexOf('rptfix-1.0.0 (b1184) - ONE GUARDED DAY LANE') > 0,
    '17: the derived production bundle did not receive the converged lane');
}

/* =======================================================================
 * the twins are derivations, never hand edits.
 * ===================================================================== */
{
  const { execFileSync } = require('child_process');
  ['derive-cloned-from-1p.js', 'derive-production-from-1p.js'].forEach(function (script) {
    const out = execFileSync(process.execPath, [path.join(root, 'scripts', script), '--check'], { cwd: root, encoding: 'utf8' });
    ok(/PRISTINE/.test(out), script + ' reports drift between 1p and its derived twin:\n' + out);
  });
}

console.log('PASS reports-fixes: ' + checks + ' checks');

'use strict';

/* THE OUTCOME STUDY STOPS ASKING FOR PATIENTS IT ALREADY HAS (b820)
 *
 * Every way into the study asked the doctor to supply patient names and dates of
 * service. The paste box says so in its own placeholder:
 *
 *     "Name, DOS / Jane Doe, 03/04/2026 / John Smith, 2026-02-15"
 *
 * while window.getPatients() holds every one of those names and every visit date —
 * and this very module already calls getPatients() when it writes results BACK
 * (mls-outcome-study.js, savePatients). It could read the roster to save into it
 * and not to build from it.
 *
 * "📁 Use my charts" builds the cohort from the store and hands it to the SAME
 * ingestRows() the file and paste paths use, so nothing downstream is
 * re-implemented — the study, the mapper and the aggregation are untouched.
 *
 * Two properties matter more than the happy path and are asserted hardest:
 *
 *  1. THE DATE LADDER IS THE APP'S OWN. ScribeFlow.html reads
 *     `n.date || n.note_date || n.created_at` wherever it needs a note date, so
 *     that ladder is reused rather than a fresh guess about which field wins.
 *     Getting this wrong would silently drop or mis-date real cohorts.
 *  2. NO SILENT CAPS. A patient with no visit date has no date of service and
 *     cannot be a study row, so it is left out — and the count that was left out
 *     is REPORTED. A smaller cohort presented as the whole one is the failure mode
 *     this repo tracks, and it would corrupt every percentage downstream.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'mls-outcome-study.js'), 'utf8');

function fnBlock(input, name) {
  const at = input.indexOf('function ' + name + '(');
  assert(at >= 0, 'missing function ' + name);
  const brace = input.indexOf('{', at);
  let depth = 0, quote = '', esc = false, line = false, block = false;
  for (let i = brace; i < input.length; i++) {
    const ch = input[i], next = input[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return input.slice(at, i + 1);
  }
  throw new Error('unterminated ' + name);
}

function build(patients) {
  const ctx = { String, Object, Array, console };
  ctx.window = { getPatients: () => patients };
  vm.createContext(ctx);
  vm.runInContext(fnBlock(src, 'chartVisitDate') + '\n' + fnBlock(src, 'rowsFromCharts') +
    '\nthis.build = rowsFromCharts; this.dateOf = chartVisitDate;', ctx);
  return { out: ctx.build(), dateOf: ctx.dateOf };
}

/* ---- POSITIVE CONTROL --------------------------------------------------
   An empty store must produce a header and nothing else. If it produced rows,
   every count below would be measuring the harness rather than the product. */
{
  const { out } = build([]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.rows)), [['Name', 'DOS']],
    'positive control: an empty store must yield the header alone');
  assert.strictEqual(out.used, 0, 'positive control: nothing used');
  assert.strictEqual(out.total, 0, 'positive control: nothing counted');
}

/* ---- THE DATE LADDER IS THE APP'S OWN ---------------------------------- */
{
  const { dateOf } = build([]);
  assert.strictEqual(dateOf({ visits: [{ date: '2026-03-04' }] }), '2026-03-04', '.date must be read');
  assert.strictEqual(dateOf({ visits: [{ note_date: '2026-03-05' }] }), '2026-03-05', '.note_date must be read');
  assert.strictEqual(dateOf({ visits: [{ created_at: '2026-03-06' }] }), '2026-03-06', '.created_at must be read');
  /* precedence, in the app's order — date beats note_date beats created_at */
  assert.strictEqual(dateOf({ visits: [{ date: '2026-01-01', note_date: '2026-09-09', created_at: '2026-12-12' }] }), '2026-01-01',
    '.date must outrank .note_date and .created_at, matching ScribeFlow.html\'s own ladder');
  assert.strictEqual(dateOf({ visits: [{ note_date: '2026-01-01', created_at: '2026-12-12' }] }), '2026-01-01',
    '.note_date must outrank .created_at');
  /* an ISO timestamp is truncated to a date, not passed through whole */
  assert.strictEqual(dateOf({ visits: [{ created_at: '2026-03-06T14:22:01.000Z' }] }), '2026-03-06',
    'a timestamp must be truncated to its date');
  /* MOST RECENT wins: a study row is one date of service */
  assert.strictEqual(dateOf({ visits: [{ date: '2026-02-01' }, { date: '2026-05-09' }, { date: '2026-03-15' }] }), '2026-05-09',
    'the most recent visit must win — the doctor is studying the case they just worked on');
  /* and nothing to read yields nothing, rather than today */
  for (const shape of [undefined, {}, { visits: [] }, { visits: null }, { visits: [{}] }, { visits: 'nope' }]) {
    assert.strictEqual(dateOf(shape), '',
      'a patient with no readable visit date must yield empty, never a substituted date: ' + JSON.stringify(shape));
  }
}

/* ---- THE COHORT, AND WHAT IS LEFT OUT ---------------------------------- */
{
  const { out } = build([
    { name: 'Jane Doe', visits: [{ date: '2026-03-04' }] },
    { name: 'John Smith', visits: [{ note_date: '2026-02-15' }, { note_date: '2026-04-01' }] },
    { name: 'No Visits Yet', visits: [] },                       /* left out, counted */
    { name: '', visits: [{ date: '2026-01-01' }] },              /* nameless: not a patient row at all */
    { name: '   ', visits: [{ date: '2026-01-02' }] },           /* whitespace name likewise */
    { name: 'Undated Too' }                                       /* left out, counted */
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.rows)), [
    ['Name', 'DOS'],
    ['Jane Doe', '2026-03-04'],
    ['John Smith', '2026-04-01']
  ], 'the cohort must be exactly the named patients that have a date of service');
  assert.strictEqual(out.used, 2, 'two patients are usable');
  assert.strictEqual(out.noDate, 2, 'two named patients had no visit date and must be COUNTED, not ignored');
  assert.strictEqual(out.total, 4, 'total counts named patients only — a blank name is not a patient row');
  /* the arithmetic has to close, or the reported "left out" number lies */
  assert.strictEqual(out.used + out.noDate, out.total,
    'used + left-out must equal the total, or the message the doctor reads is wrong');
}

/* ---- MALFORMED STORES MUST NOT THROW ---------------------------------- */
/* This runs from a click in the doctor's Studio. A throw is a dead button. */
{
  for (const store of [null, undefined, 'nope', 42, [null], [undefined], [{ name: 'X', visits: [null] }]]) {
    assert.doesNotThrow(() => {
      const ctx = { String, Object, Array, console };
      ctx.window = { getPatients: () => store };
      vm.createContext(ctx);
      vm.runInContext(fnBlock(src, 'chartVisitDate') + '\n' + fnBlock(src, 'rowsFromCharts') + '\nthis.b = rowsFromCharts;', ctx);
      ctx.b();
    }, 'a malformed patient store threw: ' + JSON.stringify(store));
  }
  /* and a getPatients that throws outright */
  assert.doesNotThrow(() => {
    const ctx = { String, Object, Array, console };
    ctx.window = { getPatients: () => { throw new Error('store unavailable'); } };
    vm.createContext(ctx);
    vm.runInContext(fnBlock(src, 'chartVisitDate') + '\n' + fnBlock(src, 'rowsFromCharts') + '\nthis.b = rowsFromCharts;', ctx);
    assert.strictEqual(ctx.b().used, 0, 'a throwing store must yield an empty cohort, not a crash');
  }, 'a throwing getPatients took the button down');
}

/* ---- IT REUSES THE EXISTING PIPELINE, AND REPORTS OMISSIONS -----------
   RUN the click handler; do not grep it. A grep for `built.noDate` cannot tell a
   live omission report from a disabled one, because the same text also sits
   INSIDE the report it guards — `if (false) { ...built.noDate... }` matches just
   as well as the real thing. Only executing the handler and reading what lands
   in #ocParseMsg can see the control flow. */

/* Pull out the click handler as a function expression, brace-matched. An
   indexOf('});') bound would truncate it at the first nested call. */
function clickHandler(input) {
  const at = input.indexOf("body.querySelector('#ocFromCharts')");
  assert(at >= 0, 'the button has no handler wired');
  const fnAt = input.indexOf('function () {', at);
  assert(fnAt > at, 'the handler is not a function expression');
  const brace = input.indexOf('{', fnAt);
  let depth = 0, quote = '', esc = false, line = false, block = false;
  for (let i = brace; i < input.length; i++) {
    const ch = input[i], next = input[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return input.slice(fnAt, i + 1);
  }
  throw new Error('unterminated click handler');
}

/* Click it for real, with the module's own rowsFromCharts/chartVisitDate and
   stubs standing in only for the DOM and for the shared ingest pipeline. */
function click(patients) {
  const seen = { ingest: null, calls: 0 };
  const el = { innerHTML: '' };
  const ctx = { String, Object, Array, Boolean, console };
  ctx.window = { getPatients: () => patients };
  ctx.box = { querySelector: (sel) => (sel === '#ocParseMsg' ? el : null) };
  ctx.body = ctx.box;
  ctx.redMsg = (t) => '<span style="color:#ff6b6b">⚠ ' + t + '</span>';
  ctx.ingestRows = (rows, box, name) => {
    seen.calls++;
    seen.ingest = { rows: JSON.parse(JSON.stringify(rows)), sameBox: box === ctx.box, name };
    /* the real one writes its own summary into the same element */
    el.innerHTML = 'Read ' + (rows.length - 1) + ' patients.';
  };
  vm.createContext(ctx);
  vm.runInContext(fnBlock(src, 'chartVisitDate') + '\n' + fnBlock(src, 'rowsFromCharts') +
    '\nthis.click = ' + clickHandler(src) + ';', ctx);
  ctx.click();
  return { html: el.innerHTML, seen };
}

{
  assert(/id="ocFromCharts"/.test(src), 'the button is not rendered');

  /* THE COHORT REACHES THE SHARED PIPELINE, unchanged and in the same box */
  const ok = click([
    { name: 'Jane Doe', visits: [{ date: '2026-03-04' }] },
    { name: 'John Smith', visits: [{ note_date: '2026-04-01' }] }
  ]);
  assert.strictEqual(ok.seen.calls, 1, 'the handler must call the shared ingest exactly once');
  assert.strictEqual(ok.seen.ingest.name, 'your charts',
    'the cohort must be labelled as coming from the charts, so the study names its own source');
  assert.strictEqual(ok.seen.ingest.sameBox, true, 'ingest must be handed the same box the handler renders into');
  assert.deepStrictEqual(ok.seen.ingest.rows, [['Name', 'DOS'], ['Jane Doe', '2026-03-04'], ['John Smith', '2026-04-01']],
    'the chart cohort must go through the SAME ingestRows() the file and paste paths use, or the ' +
    'study, mapper and aggregation are being re-implemented for one more input');

  /* NO SILENT CAPS — the count left out must LAND IN THE MESSAGE the doctor reads */
  const capped = click([
    { name: 'Jane Doe', visits: [{ date: '2026-03-04' }] },
    { name: 'No Visits Yet', visits: [] },
    { name: 'Undated Too' }
  ]);
  assert.strictEqual(capped.seen.calls, 1, 'a partial cohort must still be ingested');
  assert.deepStrictEqual(capped.seen.ingest.rows, [['Name', 'DOS'], ['Jane Doe', '2026-03-04']],
    'only the datable patient belongs in the cohort');
  assert(/2 of 3 patients had no visit date and were left out/.test(capped.html),
    'patients left out for having no visit date are not REPORTED to the doctor. A smaller cohort ' +
    'presented as the whole one corrupts every percentage the study prints. Message was: ' + capped.html);
  assert(/Read 1 patients/.test(capped.html),
    'the omission note must be appended to the ingest summary, not replace it');

  /* a whole cohort must NOT carry an omission note — a false "left out" is its own lie */
  assert(!/left out/.test(ok.html),
    'a complete cohort must not claim patients were left out. Message was: ' + ok.html);

  /* THE TWO EMPTY CASES READ DIFFERENTLY, or the doctor hunts in the wrong place */
  const none = click([]);
  assert.strictEqual(none.seen.calls, 0, 'an empty store must not be ingested as a cohort');
  assert(/No patients in MLS yet/.test(none.html), 'an empty chart list must say so: ' + none.html);

  const undated = click([{ name: 'A', visits: [] }, { name: 'B', visits: [{}] }]);
  assert.strictEqual(undated.seen.calls, 0, 'a cohort with no dates at all must not be ingested');
  assert(/2 patients in MLS but none has a visit date yet/.test(undated.html),
    'patients-without-dates must read differently from no-patients — they send the doctor to ' +
    'different places. Message was: ' + undated.html);
  assert(!/No patients in MLS yet/.test(undated.html),
    'a full chart list must never be reported as an empty one: ' + undated.html);

  /* singular/plural, because the doctor with one chart reads this too */
  const one = click([{ name: 'Solo', visits: [] }]);
  assert(/1 patient in MLS/.test(one.html) && !/1 patients/.test(one.html),
    'the one-patient message must not read "1 patients": ' + one.html);

  /* the module's loader token moved, or none of this reaches a browser */
  const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  const tok = /mls-outcome-study\.js\?v=([A-Za-z0-9_.-]+)/.exec(connect);
  assert(tok, 'mls-outcome-study.js is not loaded with a cache-busting token');
  assert(tok[1] !== '20260730lib3',
    'the loader token still reads 20260730lib3, so a returning browser keeps the cached module and ' +
    'this whole change ships invisibly — the trap this repo names first');
}

console.log('PASS the outcome study builds from the charts: "Use my charts" reads window.getPatients() ' +
  'and feeds the existing ingestRows() pipeline, the visit date is resolved by the app\'s own ' +
  'date||note_date||created_at ladder with the most recent visit winning (precedence and truncation ' +
  'both executed), patients with no date of service are left out AND counted rather than silently ' +
  'dropped, and eight malformed store shapes plus a throwing getPatients leave the button alive');

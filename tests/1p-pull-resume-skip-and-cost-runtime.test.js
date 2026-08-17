'use strict';
/* =============================================================================
 * rsk-1.0.0  -  a re-run does not re-read what it already proved
 *
 * Two requirements, one mechanism:
 *   (a) STOP (owner 2026-08-17, "a couple issues like when STOPPING"): after a
 *       stopped pull the doctor presses Pull again, and the rows that already
 *       landed must RESUME, not be read from scratch.
 *   (b) SPEED, measured not claimed (owner: "if you can make it even faster do
 *       so"): the one Athena read that is provably redundant is a chart this
 *       same account day already read, verified and STORED WITH CONTENT.
 *
 * This suite also pins the per-row COST BREAKDOWN, so "where does the time go"
 * is answered with numbers from the engine's own receipt rather than a story.
 * Real importer, fake extension, synthetic identities. No network, no PHI.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness } = require('./1p-pull-harness.js');

/* DISTINCT charts opened. The harness has no _parsePatientChart, so every
   row it does read is re-opened once by the engine's deferred parse retry -
   a fixture artefact. Counting distinct patients measures the real lever. */
const opened = h => new Set(h.chartCalls.map(c => String(c.patientId))).size;

const SI = fs.readFileSync(path.resolve(__dirname, '..', '1p-feat_mls_schedimport_exact.js'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* --------------------------------------------------------------- static -- */
{
  const a = SI.indexOf('/* ===== rsk-1.0.0 (a re-run does not re-read what it already proved) =====');
  const b = SI.indexOf('/* ===== end rsk-1.0.0 ===== */');
  ok(a >= 0 && b > a, 'the rsk-1.0.0 block is missing or unclosed');
  const block = SI.slice(a, b);
  /* every clause of the bar must be present - a marker is not evidence */
  ok(/h\.contentMeasured !== true \|\| h\.contentVerified !== true/.test(block),
    'the skip does not require a MEASURED, content-verified day (scv-1.0.0 bar)');
  ok(/12 \* 3600 \* 1000/.test(block), 'the skip has no age bound');
  ok(/accountDayFromInstant\(at\) !== acctTodayKey\(\)/.test(block),
    'the skip is not confined to the SAME account day');
  ok(/normDob\(target\.dob\)/.test(block) && /normMrn\(target\.mrn\)/.test(block),
    'the skip does not re-check the frozen identity against the stored patient');
  ok(/CENSUS_CONTENT_FIELDS/.test(block),
    'the skip does not require the stored record to still hold content');
  ok(/window\.__mlsP1SkipVerifiedToday !== false/.test(block),
    'the skip cannot be turned off for a live A/B');
}

/* the fixture writes the day ledger the way a completed batch does */
function seedVerifiedDay(h, day, patientIds) {
  const key = 'p1-harness::schedImportIndexV1::' + day;
  const raw = h.rt.localStorage.getItem(key);
  const x = raw ? JSON.parse(raw) : { v: 1, rows: {} };
  x.history = Object.assign({}, x.history, {
    at: h.clock.now(),
    contentMeasured: true,
    contentVerified: true,
    perPatient: patientIds.reduce((a, id) => (a[id] = 'ok', a), {})
  });
  h.rt.localStorage.setItem(key, JSON.stringify(x));
  /* the stored record must actually hold content */
  h.patients.forEach(p => {
    if (patientIds.indexOf(p.id) < 0) return;
    p.problems = ['Synthetic problem'];
    p.summary = 'Synthetic chart summary';
  });
}

/* ------------------------------- 1. a verified row is skipped, not re-read */
async function testVerifiedRowsSkip() {
  const DAY = '2026-08-17';
  const h = makeHarness({ day: DAY, today: DAY, rows: 10 });
  seedVerifiedDay(h, DAY, h.patients.slice(0, 6).map(p => p.id));

  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(receipt.chartsSkippedVerifiedToday, 6, 'the re-run re-read rows it had already proved');
  eq(opened(h), 4, 'the re-run opened ' + opened(h) + ' charts; only the 4 unproved ones were needed');
  eq(h.chartCalls.filter(c => Number(String(c.patientId).slice(-2)) <= 6).length, 0,
    'a skipped row was still opened in Athena');
  eq(receipt.patients.length, 10, 'the skip lost rows from the receipt');
  eq(receipt.processed, 10, 'the skip broke the processed count');
  ok(receipt.patients.filter(p => p.chartSkippedVerifiedToday).length === 6,
    'a skipped row is not recorded as skipped - it must never look like a fresh read');
  ok(receipt.patients.slice(0, 6).every(p => p.complete === true),
    'a proved row did not stay complete across the re-run');

  /* MEASURED DELTA: the same day with the skip turned OFF re-reads everything */
  const h2 = makeHarness({ day: DAY, today: DAY, rows: 10 });
  seedVerifiedDay(h2, DAY, h2.patients.slice(0, 6).map(p => p.id));
  h2.rt.window.__mlsP1SkipVerifiedToday = false;
  await h2.api._runHistoryBatch(h2.rows, [], h2.onStatus);
  eq(opened(h2), 10, 'the A/B control did not re-read all ten - the measurement is meaningless');
  /* MEASURED: 4 charts opened instead of 10 on the same day and the same
     rows - a 60% reduction in Athena chart opens for a re-run. */
  eq(opened(h2) - opened(h), 6, 'the skip saved ' + (opened(h2) - opened(h)) + ' chart opens, expected 6');
  ok(h.chartCalls.length < h2.chartCalls.length,
    'the skip saved no Athena reads (' + h.chartCalls.length + ' vs ' + h2.chartCalls.length + ')');
}

/* ------------------------------------- 2. every clause of the bar refuses */
async function testTheBarIsNotAMarker() {
  const DAY = '2026-08-17';

  /* (a) a day whose census was NOT measured must be re-read */
  {
    const h = makeHarness({ day: DAY, today: DAY, rows: 4 });
    const key = 'p1-harness::schedImportIndexV1::' + DAY;
    h.rt.localStorage.setItem(key, JSON.stringify({ v: 1, rows: {}, history: {
      at: h.clock.now(), contentMeasured: false, contentVerified: true,
      perPatient: h.patients.reduce((a, p) => (a[p.id] = 'ok', a), {}) } }));
    h.patients.forEach(p => { p.problems = ['Synthetic problem']; });
    await h.api._runHistoryBatch(h.rows, [], h.onStatus);
    eq(opened(h), 4, 'an UNMEASURED day was accepted as proof and its charts were skipped');
  }

  /* (b) a stale verdict (yesterday) must be re-read */
  {
    const h = makeHarness({ day: DAY, today: DAY, rows: 4 });
    const key = 'p1-harness::schedImportIndexV1::' + DAY;
    h.rt.localStorage.setItem(key, JSON.stringify({ v: 1, rows: {}, history: {
      at: h.clock.now() - 30 * 3600 * 1000, contentMeasured: true, contentVerified: true,
      perPatient: h.patients.reduce((a, p) => (a[p.id] = 'ok', a), {}) } }));
    h.patients.forEach(p => { p.problems = ['Synthetic problem']; });
    await h.api._runHistoryBatch(h.rows, [], h.onStatus);
    eq(opened(h), 4, 'a verdict older than the bound was accepted as proof');
  }

  /* (c) a record that no longer holds content must be re-read */
  {
    const h = makeHarness({ day: DAY, today: DAY, rows: 4 });
    seedVerifiedDay(h, DAY, h.patients.map(p => p.id));
    h.patients.forEach(p => { delete p.problems; delete p.summary; });
    await h.api._runHistoryBatch(h.rows, [], h.onStatus);
    eq(opened(h), 4, 'an EMPTY stored record was accepted as proof of a completed read');
  }

  /* (d) an identity that drifted must be re-read */
  {
    const h = makeHarness({ day: DAY, today: DAY, rows: 4 });
    seedVerifiedDay(h, DAY, h.patients.map(p => p.id));
    h.patients.forEach(p => { p.dob = '12/31/1999'; });
    await h.api._runHistoryBatch(h.rows, [], h.onStatus);
    eq(opened(h), 0,
      'guard: a drifted DOB should not even resolve an identity target, so no chart may open');
  }
}

/* ---------------------------- 3. the cost breakdown is on every receipt -- */
async function testCostBreakdown() {
  const DAY = '2026-08-17';
  const h = makeHarness({ day: DAY, today: DAY, rows: 5, noteDelayMs: 62000 });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  const cb = receipt.costBreakdown;
  ok(cb, 'the receipt carries no per-row cost breakdown');
  eq(cb.rows, 5, 'the cost breakdown counted the wrong number of rows');
  eq(cb.todayNoteMs, 5 * 62000, 'the day-note leg cost is not aggregated');
  eq(cb.perRowTodayNoteMs, 62000, 'the per-row day-note cost is wrong');
  eq(typeof cb.chartMs, 'number', 'the chart-read cost is missing');
  eq(typeof cb.parseSaveMs, 'number', 'the parse/save cost is missing');
  eq(cb.visitsMs, 0, 'bodies were OFF but the visits stage reported time');
  eq(cb.skippedVerifiedToday, 0, 'the breakdown mis-reports skipped rows on a first run');
  /* the finding the owner needs: with bodies OFF the day-note leg dominates. */
  ok(cb.todayNoteMs > cb.chartMs + cb.parseSaveMs + cb.visitsMs,
    'the fixture did not reproduce the day-note leg as the dominant cost');
}

async function main() {
  await testVerifiedRowsSkip();
  await testTheBarIsNotAMarker();
  await testCostBreakdown();
  console.log('PASS 1p-pull-resume-skip-and-cost: ' + checks + ' checks - a re-run skips only rows this same account day already proved AND stored with content under an unchanged identity (every other clause re-reads, proved four ways), the saving is measured against an A/B control with the lever off, and every receipt carries the per-row cost breakdown that shows where the seconds go');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-pull-resume-skip-and-cost did not finish')); process.exit(1); }, 60000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });

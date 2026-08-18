'use strict';
/* =============================================================================
 * 1p day-note PASS BUDGET + the background BACKFILL  (lane: pullspeed2)
 *
 * THE MEASUREMENT THIS SUITE EXISTS FOR - owner's live /cloned, 2026-08-17,
 * bodies OFF, ext 3.0.62, THREE signed-in athenaOne tabs with the leased one
 * occluded:
 *
 *   fresh pull   schedule ~45 s; 24 histories in ~4 min (24/24, contentGap 0);
 *                then the day-note pass opened a SECOND chart per patient and
 *                ran 943 s - todayNoteMsMax 45,088 - for 19 of 24 unread
 *                (15 deadline-exceeded, 3 find-patient deadline, 1 different
 *                patient).                                  TOTAL 19m 56s
 *   same-day     histories all skipped as verified-today (instant), then the
 *   re-pull      day-note leg spent ~19 min on the 19 unread rows and
 *                recovered 6.                               TOTAL 20m 04s
 *   footer       "Visit backfill: <name> - open-failed: Open your signed-in
 *                athenaOne in another tab, then try again"  <- FALSE. Three
 *                signed-in athena tabs were open at that moment.
 *   owner        "very happy... any way we can make it faster? ... this looks
 *                so clunky."
 *
 * Five engine changes are measured here, each against the behaviour it
 * replaces, and two of them against the ORIGIN/MAIN engine running the
 * identical fixture so "this would have been slow before" is a number:
 *
 *   dnb2-1.0.0   only a SUCCESS raises the per-row ceiling; failures walk it
 *                DOWN to a 25 s floor; one retry, and only after observable
 *                progress.
 *   dnp2-1.0.0   the whole pass has ONE budget (10 s a row, floor 60 s, cap
 *                4 min); what it cannot reach is handed over, not failed.
 *   dnbf-1.0.0   the backfill asks mlsAthenaPresence before it tells the
 *                doctor to open a tab he already has open; backoff on
 *                transient reasons; PHI-free receipt of CODES and counts.
 *   dnrs-1.0.0   a note already read this account day is never re-opened;
 *                chart opens are counted and reported.
 *   dnpri-1.0.0  the notes most likely to EXIST are read first.
 *
 * Everything runs the REAL 1p importer in a vm against the shared fake
 * extension. No network, no extension, no Athena, no PHI - synthetic
 * names/DOB/MRN only, and a frozen clock.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeHarness, flush } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* the before/after table this suite prints at the end */
const TABLE = [];
function row(scenario, engine, r, h) {
  TABLE.push({
    scenario, engine,
    /* origin/main has no chart-open counter at all, which is itself part of
       the finding - render it as "n/a" rather than as a zero. */
    chartOpens: (r && r.chartOpens) ? Number(r.chartOpens.total || 0) : 'n/a',
    noteReads: h ? h.noteCalls.length : 0,
    dayNoteSec: Math.round(Number((r && r.todayNoteMsTotal) || 0) / 1000),
    notesRead: Number((r && r.todayNoteRead) || 0),
    /* todayNoteQueued ALREADY counts the handed-over rows (they are queued);
       adding handedOff on top double-counted them in the first draft. */
    deferred: Number((r && r.todayNoteQueued) || 0)
  });
}

/* ---------------------------------------------------------- causal control --
 * origin/main's engine on disk. It is the engine the owner measured, so it is
 * the right "before" for THIS lane (unlike the pullfix3 suite, whose fix has
 * since landed on main). If git cannot produce it the control cases are
 * SKIPPED LOUDLY - never silently passed. */
const CONTROL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-pullspeed2-control-'));
let CONTROL = '';
try {
  const src = execFileSync('git', ['show', 'origin/main:1p-feat_mls_schedimport_exact.js'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  /* a control that already carries the fix proves nothing - say so and skip. */
  if (src.indexOf('dnp2-1.0.0') >= 0) throw new Error('origin/main already carries dnp2-1.0.0');
  CONTROL = path.join(CONTROL_DIR, 'control-importer.js');
  fs.writeFileSync(CONTROL, src);
} catch (eCtl) {
  CONTROL = '';
  console.log('NOTE: origin/main causal control unavailable (' + String((eCtl && eCtl.message) || eCtl).slice(0, 100) + ')');
}

/* A PAST day, so every row's note is genuinely due and nothing is parked as
   not-yet or future-day: this suite is about the BUDGET, not the calendar. */
const DAY = '2026-08-14';
const TODAY = '2026-08-17';

function harness(extra) {
  return makeHarness(Object.assign({
    day: DAY, today: TODAY, rows: 24, scheduleBorn: false, chartCoverage: true
  }, extra || {}));
}

/* ===================================================== 1  STATIC (markers) == */
{
  [['dnb2-1.0.0', '/* ===== dnb2-1.0.0', '/* ===== end dnb2-1.0.0 ===== */'],
   ['dnp2-1.0.0', '/* ===== dnp2-1.0.0', '/* ===== end dnp2-1.0.0 ===== */'],
   ['dnrs-1.0.0', '/* ===== dnrs-1.0.0', '/* ===== end dnrs-1.0.0 ===== */'],
   ['dnpri-1.0.0', '/* ===== dnpri-1.0.0', '/* ===== end dnpri-1.0.0 ===== */'],
   ['dnbf-1.0.0', '/* ===== dnbf-1.0.0', '/* ===== end dnbf-1.0.0 (state) ===== */']
  ].forEach(([name, a, b]) => {
    const i = SRC.indexOf(a), j = SRC.indexOf(b);
    ok(i >= 0 && j > i, 'the ' + name + ' block is missing or unclosed');
  });
  /* the shell transport eats backslashes - EXECUTE every new literal against a
     real sample rather than grepping for its presence. */
  const noTab = /no-athena-tab|no athenaone tab|open your signed-in athenaone|open-failed|not responding|unreachable/i;
  ok(noTab.test('Open your signed-in athenaOne in another tab, then try again.'),
    'the no-athena-tab sniffer would not match the owner\'s measured footer');
  ok(noTab.test('open-failed'), 'the no-athena-tab sniffer lost open-failed');
  ok(!noTab.test('Safety stop - Athena returned an encounter index'), 'the sniffer over-matches a safety stop');
  const seen = /check(?:ed)?[ -]?out|completed|complete|seen|closed|discharged/;
  ok(seen.test('Checked Out') === false && seen.test('checked out'),
    'the seen-status literal is case-sensitive by design; the engine lower-cases first');
  ['checked out', 'checked-out', 'checkedout', 'check out', 'checkout', 'completed', 'seen', 'discharged']
    .forEach(s => ok(seen.test(s), 'the seen-status literal does not match athena wording "' + s + '"'));
  ok(!seen.test('checked in') && !seen.test('scheduled'), 'the seen-status literal matches a NOT-seen status');
  /* the engine's own copy of that literal must be the one that runs */
  ok(/check\(\?:ed\)\?\[ -\]\?out\|completed\|complete\|seen\|closed\|discharged/.test(SRC),
    'tnSeenRank lost its status literal to the transport');
}

/* ============================================ 2  SLOW ATHENA (deliverable 2) */
/* Each day-note read costs 40-60 s, exactly the owner's night. 24 rows.
   The pull must finish inside history time + the pass budget, with the rest
   DEFERRED and the counts honest. */
async function slowAthenaRun() {
  const cost = n => 40000 + ((n * 7919) % 20001);      /* 40-60 s, deterministic */

  async function scenario(importerPath) {
    const h = harness({ noteDelayMs: cost, importerPath: importerPath || undefined });
    const t0 = h.clock.now();
    const r = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});
    return { h, r, elapsedMs: h.clock.now() - t0 };
  }

  const slow = await scenario('');
  row('slow athena (40-60 s/note, 24 rows)', 'pullspeed2', slow.r, slow.h);

  const budget = Number(slow.r.todayNotePassBudgetMs || 0);
  eq(budget, 240000, 'a 24-row day did not get the 4-minute pass budget (' + budget + ')');
  const spentOnNotes = Number(slow.r.todayNoteMsTotal || 0);
  ok(spentOnNotes <= budget + 60000,
    'the day-note pass spent ' + spentOnNotes + ' ms against a ' + budget + ' ms budget - the budget does not bite');
  /* the owner's number: 943 s. The new pass may not approach it. */
  ok(spentOnNotes < 400000,
    'the day-note pass still costs the owner ' + Math.round(spentOnNotes / 1000) + ' s on a slow night');

  /* HONEST COUNTS: every row is accounted for exactly once. */
  const p = slow.r.patients || [];
  eq(p.length, 24, 'the fixture did not process all 24 rows');
  const read = Number(slow.r.todayNoteRead || 0);
  const handed = Number(slow.r.todayNoteHandedOff || 0);
  const queued = Number(slow.r.todayNoteQueued || 0);
  const notYet = Number(slow.r.todayNoteNotYet || 0);
  const future = Number(slow.r.todayNoteFutureDay || 0);
  const finalUnread = Number(slow.r.todayNoteUnreadFinal || 0);
  ok(handed >= 1, 'a 40-60 s-per-note night handed NOTHING to the backfill - the budget never bit');
  eq(read + queued + finalUnread + notYet + future, 24,
    'the day-note census does not add up to the day: ' + JSON.stringify({ read, queued, finalUnread, notYet, future }));
  eq(queued >= handed, true, 'a handed-over row was not queued for the background backfill');
  /* a handed-over row is NOT a failure of the reader */
  slow.r.patients.filter(x => x.todayNoteHandedOff === true).forEach(x => {
    eq(x.todayNoteReason, 'day-note-pass-budget-exhausted', 'a handed-over row carries the wrong code');
    eq(x.complete, true, 'a handed-over day note failed its history row - the lane is verdict-neutral');
  });
  /* and the DEFERRED count is what the backfill will take */
  const q = slow.h.api._todayNoteDeferred();
  eq(q.queued, queued, 'the queue and the receipt disagree about how many rows are waiting');

  /* CAUSAL CONTROL: the same fixture on origin/main. */
  if (CONTROL) {
    const control = await scenario(CONTROL);
    row('slow athena (40-60 s/note, 24 rows)', 'origin/main', control.r, control.h);
    const controlNotes = Number(control.r.todayNoteMsTotal || 0);
    ok(controlNotes > spentOnNotes,
      'CAUSAL CONTROL BROKEN: origin/main spent ' + controlNotes + ' ms on day notes, the fix spent ' +
      spentOnNotes + ' ms - this fixture does not reproduce the slowness');
    ok(controlNotes > 600000,
      'CAUSAL CONTROL BROKEN: origin/main only spent ' + Math.round(controlNotes / 1000) +
      ' s; the owner measured 943 s, so this fixture is not his night');
    eq(Number(control.r.todayNotePassBudgetMs || 0), 0,
      'CAUSAL CONTROL BROKEN: origin/main already has a pass budget');
  }
}

/* ==================================== 3  FAST ATHENA READS EVERYTHING ======= */
/* The budget must never cost a healthy machine a single note. */
async function fastAthenaRun() {
  const h = harness({ noteDelayMs: 2000 });
  const r = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});
  row('fast athena (2 s/note, 24 rows)', 'pullspeed2', r, h);
  eq(Number(r.todayNoteRead || 0), 24, 'a fast machine did not read all 24 notes');
  eq(Number(r.todayNoteHandedOff || 0), 0, 'a fast machine handed rows to the backfill anyway');
  eq(Number(r.todayNoteFailures || 0), 0, 'a fast machine reported day-note failures');
  eq(h.noteCalls.length, 24, 'the reader ran ' + h.noteCalls.length + ' times for 24 rows');
  eq(Number(r.todayNoteQueued || 0), 0, 'a fast machine queued a background backfill it does not need');
  /* ONE chart open per patient - the dnf2-1.0.0 guarantee, still true */
  eq(Number(r.chartOpens.history || 0), 24, 'the history leg did not open exactly one chart per patient');
  eq(Number(r.chartOpens.dayNote || 0), 24, 'the day-note leg did not open exactly one chart per patient');
  eq(Number(r.chartOpens.total || 0), 48, 'chartOpens.total is not the sum of its two doors');
  eq(r.chartOpens.perRow, 2, 'chartOpens.perRow is wrong (' + r.chartOpens.perRow + ')');
}

/* ============================= 4  SAME-DAY RE-PULL (deliverable 4) ========== */
/* Pull once, then pull the SAME day again over the same store. Rows whose note
   was already saved must not cost one chart open; unread rows get exactly one
   attempt. */
async function rePullRun() {
  const store = new Map();
  /* first pull: 12 rows, the first 8 read, the last 4 refuse a timing reason */
  const first = makeHarness({
    day: DAY, today: TODAY, rows: 12, scheduleBorn: false, chartCoverage: true, store,
    noteDelayMs: 2000,
    noteResult: (pid, onlyDate, n) => (n <= 8 ? { ok: true, visits: 1 } : { ok: false, reason: 'pulled-day-note-deadline-exceeded' })
  });
  const r1 = await first.api._runHistoryBatch(first.rows, [], first.onStatus, {});
  row('same-day re-pull: FIRST pull (12 rows)', 'pullspeed2', r1, first);
  eq(Number(r1.todayNoteRead || 0), 8, 'the first pull did not read the eight readable notes');
  eq(first.noteCalls.length, 12, 'the first pull did not attempt every row once');

  /* the ledger must now name those eight - this is the mechanism under test */
  const ledgerKey = Array.from(store.keys()).find(k => /p1MetaV|p1Meta|Index/i.test(k) || store.get(k).indexOf('todayNoteReadAt') >= 0);
  ok(!!ledgerKey, 'no day ledger was written: ' + JSON.stringify(Array.from(store.keys())));
  const ledger = JSON.parse(store.get(ledgerKey));
  const readAt = (ledger && ledger[DAY] && ledger[DAY].history && ledger[DAY].history.todayNoteReadAt) ||
    (ledger && ledger.history && ledger.history.todayNoteReadAt) || null;
  ok(readAt && Object.keys(readAt).length === 8,
    'the ledger recorded ' + (readAt ? Object.keys(readAt).length : 'no') + ' read notes, expected 8');

  /* SECOND pull, same day, same store, same patient records */
  const second = makeHarness({
    day: DAY, today: TODAY, rows: 12, scheduleBorn: false, chartCoverage: true,
    store, patients: first.patients,
    noteDelayMs: 2000,
    noteResult: () => ({ ok: true, visits: 1 })
  });
  const r2 = await second.api._runHistoryBatch(second.rows, [], second.onStatus, {});
  row('same-day re-pull: SECOND pull (12 rows)', 'pullspeed2', r2, second);

  eq(second.noteCalls.length, 4,
    'the re-pull opened ' + second.noteCalls.length + ' charts for day notes; only the 4 unread rows may be re-opened');
  eq(Number(r2.todayNoteSkippedAlreadyRead || 0), 8, 'the re-pull did not skip the eight notes already on file');
  eq(Number(r2.chartOpens.skippedNoteAlreadyRead || 0), 8, 'chartOpens does not report the skipped opens');
  eq(Number(r2.todayNoteAlreadyRead || 0), 8, 'the receipt does not count the already-read notes');
  eq(Number(r2.todayNoteRead || 0), 12, 'an already-read note is not counted as read for the day');
  eq(Number(r2.todayNoteFailures || 0), 0, 'the re-pull reported a day-note failure');
  /* every row attempted AT MOST once in this pull */
  ok((r2.patients || []).every(x => Number(x.todayNoteAttempts || 0) <= 1),
    'a row was attempted more than once inside one pull: ' +
    JSON.stringify((r2.patients || []).map(x => Number(x.todayNoteAttempts || 0))));
  /* the already-read rows paint READ, not a skip the doctor has to interpret */
  const pp = second.ppState();
  const latest = {};
  (pp && pp.rows || []).forEach(x => { latest[x.k || x.name] = x; });
  eq(Object.keys(latest).filter(k => String(latest[k].dn || '') === 'read').length, 12,
    'an already-read note does not paint as read on the panel');

  /* the A/B: the SAME second pull with the skip turned off re-opens all 12 */
  const ab = makeHarness({
    day: DAY, today: TODAY, rows: 12, scheduleBorn: false, chartCoverage: true,
    store: new Map(store), patients: first.patients.map(x => Object.assign({}, x)),
    noteDelayMs: 2000, noteResult: () => ({ ok: true, visits: 1 })
  });
  ab.rt.__mlsP1SkipReadDayNotes = false;
  const rAb = await ab.api._runHistoryBatch(ab.rows, [], ab.onStatus, {});
  row('same-day re-pull: SECOND pull, skip OFF (A/B)', 'pullspeed2', rAb, ab);
  eq(ab.noteCalls.length, 12,
    'the A/B control did not re-open all twelve - the saving above is the fixture, not the lever');
  eq(ab.noteCalls.length - second.noteCalls.length, 8, 'the measured saving is not eight chart opens');
}

/* ================= 5  THE BACKFILL RE-CHECKS PRESENCE (deliverable 3) ======= */
async function backfillRun() {
  /* THE OWNER'S FOOTER: the reader answers no-athena-tab; three signed-in
     athena tabs are open, so the presence verb says so; the row must be
     RETRIED rather than turned into "open your signed-in athenaOne". */
  let call = 0;
  const h = makeHarness({
    day: DAY, today: TODAY, rows: 2, scheduleBorn: false, chartCoverage: true,
    noteResult: () => {
      call++;
      /* calls 1-2 are the inline legs: no tab, both rows queued. Call 3 is the
         first row's backfill attempt: still no tab -> the presence verb is
         asked, says athena IS there, and call 4 (the backoff retry) succeeds.
         Call 5 is the second row's first attempt, which succeeds outright. */
      return call <= 3
        ? { ok: false, reason: 'no-athena-tab: Open your signed-in athenaOne in another tab, then try again.' }
        : { ok: true, visits: 1 };
    },
    presenceResult: () => ({ ok: true, athenaOpen: true, certain: true, reason: 'presence-verified' })
  });
  const r = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});
  eq(Number(r.todayNoteQueued || 0), 2, 'a no-athena-tab refusal was not queued for the backfill');
  h.setLeaseBusy(false);
  const summary = await h.api._runDeferredTodayNotes();
  await flush(20);

  ok(h.presenceCalls.length >= 1,
    'the backfill declared open-failed WITHOUT asking the presence verb - this is the false footer');
  const bf = summary.backfill;
  ok(bf && typeof bf === 'object', 'the backfill published no receipt');
  eq(bf.presenceChecks >= 1, true, 'the backfill receipt does not count its presence checks');
  eq(bf.presenceVerified >= 1, true, 'the backfill receipt does not record that athena was PROVEN present');
  eq(bf.retriedAfterPresence >= 1, true, 'a proven-present athena did not earn a retry');
  eq(Number(summary.recovered), 2, 'the retry after presence did not recover the rows (' + summary.recovered + ')');
  eq(Number(r.todayNoteRead || 0), 2, 'the recovered rows were not re-stamped as read on the receipt');

  /* PHI-FREE: the receipt is counts and a CLOSED code vocabulary. */
  const vocab = h.api._todayNoteReasonCodes();
  ok(Array.isArray(vocab) && vocab.length >= 5, 'the reason-code vocabulary is not published');
  Object.keys(bf.codes || {}).forEach(c => {
    ok(vocab.indexOf(c) >= 0, 'the backfill receipt carries a code outside the closed vocabulary: ' + c);
  });
  const names = (h.patients || []).map(x => x.name).filter(Boolean);
  const blob = JSON.stringify(h.api._todayNoteDeferred()) + JSON.stringify(bf) + JSON.stringify(r.todayNoteBackfill || {});
  names.forEach(n => {
    eq(blob.indexOf(n), -1, 'a PATIENT NAME reached the backfill receipt: ' + n);
  });
  (h.patients || []).forEach(x => {
    if (x.dob) eq(blob.indexOf(String(x.dob)), -1, 'a DOB reached the backfill receipt');
    if (x.mrn) eq(blob.indexOf(String(x.mrn)), -1, 'an MRN reached the backfill receipt');
  });

  /* THE OTHER DIRECTION: athena genuinely absent -> the honest verdict stands,
     and nothing is retried against a tab that is not there. */
  let call2 = 0;
  const gone = makeHarness({
    day: DAY, today: TODAY, rows: 2, scheduleBorn: false, chartCoverage: true,
    noteResult: () => { call2++; return { ok: false, reason: 'no-athena-tab: Open your signed-in athenaOne in another tab, then try again.' }; },
    presenceResult: () => ({ ok: true, athenaOpen: false, certain: true, reason: 'no-athena-tab' })
  });
  await gone.api._runHistoryBatch(gone.rows, [], gone.onStatus, {});
  gone.setLeaseBusy(false);
  const goneSummary = await gone.api._runDeferredTodayNotes();
  await flush(20);
  eq(Number(goneSummary.recovered), 0, 'an absent athena produced a recovered note');
  eq(Number(goneSummary.backfill.presenceAbsent) >= 1, true, 'the receipt does not record a proven-absent athena');
  eq(Number(goneSummary.backfill.retriedAfterPresence), 0,
    'the backfill retried against an athena the presence verb said was gone');
  eq(Number(goneSummary.attempted), 2, 'the absent-athena round did not attempt each row exactly once');
  ok(call2 <= 4, 'the backfill looped against an absent athena (' + call2 + ' reads)');

  /* AND IT IS BOUNDED: a permanently transient refusal costs 2 attempts a row,
     never a loop. */
  let call3 = 0;
  const stuck = makeHarness({
    day: DAY, today: TODAY, rows: 2, scheduleBorn: false, chartCoverage: true,
    noteResult: () => { call3++; return { ok: false, reason: 'pulled-day-note-deadline-exceeded' }; }
  });
  await stuck.api._runHistoryBatch(stuck.rows, [], stuck.onStatus, {});
  const inlineReads = call3;
  stuck.setLeaseBusy(false);
  const stuckSummary = await stuck.api._runDeferredTodayNotes();
  await flush(20);
  eq(Number(stuckSummary.rows), 2, 'the bounded round did not take both rows');
  eq(Number(stuckSummary.attempted), 4, 'the backoff bound is not exactly 2 attempts a row');
  eq(call3 - inlineReads, 4, 'the reader was driven ' + (call3 - inlineReads) + ' times by a 2x2-bounded round');
}

/* ============ 6  A RETRY NEEDS OBSERVABLE PROGRESS (deliverable 1) ========== */
async function progressGateRun() {
  const api = makeHarness({ day: DAY, today: TODAY, rows: 1 }).api;
  const progress = api._todayNoteProgressCode;
  eq(typeof progress, 'function', 'the retry progress predicate is not observable');

  /* THE PREDICATE, EXECUTED against every shape it has to judge. */
  eq(progress({}, { ok: false, reason: 'pulled-day-note-deadline-exceeded' }), '',
    'a bare timing refusal was treated as progress - it would buy a second full-length wait on no evidence');
  eq(progress({}, null), '', 'a THROWN refusal with no result was treated as progress');
  eq(progress({ dayNoteChartOpen: true }, { ok: false, reason: 'pulled-day-note-deadline-exceeded' }), 'chart-open',
    'a verified chart open for this row was not counted as progress');
  eq(progress({}, { ok: false, reason: 'x', receipt: { expected: 3, parsed: 0 } }), 'encounter-index',
    'a refusal that reached the encounter index was not counted as progress');
  eq(progress({}, { ok: false, reason: 'x', receipt: { expected: 0, parsed: 0 } }), '',
    'an EMPTY encounter receipt was counted as progress');
  eq(progress({}, { ok: false, reason: 'x', indexCount: 2 }), 'encounter-index',
    'an index count was not counted as progress');
  eq(progress({ dayNoteChartOpen: false }, undefined), '', 'an absent result was counted as progress');

  /* INTEGRATION. The flag is set by the pull's own VERIFIED chart read, not by
     the inline day-note leg, so a row the fuse pushes to the tail pass still
     carries the evidence its chart really was opened. */
  const withChart = makeHarness({
    day: DAY, today: TODAY, rows: 3, scheduleBorn: false, chartCoverage: true,
    noteResult: () => ({ ok: false, reason: 'pulled-day-note-deadline-exceeded' })
  });
  const r2 = await withChart.api._runHistoryBatch(withChart.rows, [], withChart.onStatus, {});
  eq(Number((r2.todayNoteDeferred || {}).queued || 0), 3, 'a refusal AFTER a verified chart open was not deferred');
  ok((r2.patients || []).every(x => x.dayNoteChartOpen === true),
    'a row whose chart this pull verified does not carry the chart-open evidence');
  ok((r2.patients || []).every(x => x.todayNoteProgress === 'chart-open'),
    'the deferred rows do not name the progress they made');
  eq(Number(r2.todayNoteNoProgress || 0), 0, 'a row with a verified chart open was counted as no-progress');

  /* the counter exists and is wired, so a no-progress refusal is REPORTED
     rather than silently dropped. NOTE (honest limitation): this engine never
     reaches the day-note lane for a row whose chart failed to open - such a
     row is in receipt.retry with visitsSkipped unset - so the no-progress
     BRANCH could not be driven end-to-end through the batch here. Its
     guarantee is the predicate above: the retry cannot fire without evidence. */
  ok('todayNoteNoProgress' in r2 === false || Number(r2.todayNoteNoProgress || 0) === 0,
    'the no-progress counter reported a row that had a verified chart open');
  ok(/receipt\.todayNoteNoProgress = Number\(receipt\.todayNoteNoProgress \|\| 0\) \+ 1/.test(SRC),
    'the no-progress refusal is not counted on the receipt at all');
}

/* ================ 7  THE NOTES THAT EXIST ARE READ FIRST (deliverable 5) ==== */
async function priorityRun() {
  /* THE OWNER'S ACTUAL RE-PULL. When rsk-1.0.0 skips the histories as
     verified-today the inline day-note leg never runs (it needs this pull's
     own chart read), so EVERY row goes through the tail pass - which is
     exactly the 19-minute leg he watched. The tail pass is therefore where
     the ordering has to live, and this fixture is his shape.
     13:52 America/New_York = 17:52 UTC (EDT): rows at 08:00-12:00 have been
     seen, the 15:30 row has not. The array order is DELIBERATELY the reverse
     of clinic order, the budget is the 60 s floor and each read costs 25 s -
     so the rows that get read must be the EARLIEST-PASSED ones, not rows 1
     and 2 of the array. */
  const AT_1352_ET = Date.parse(TODAY + 'T17:52:00Z');
  const store = new Map();
  const base = {
    day: TODAY, today: TODAY, rows: 6, scheduleBorn: false, chartCoverage: true,
    startAt: AT_1352_ET,
    parseResult: () => ({ problems: 'p', meds: 'm', summary: 's' }),
    rowTime: i => ['12:00', '11:00', '10:00', '09:00', '08:00', '15:30'][i]
  };
  /* pull 1 stores verified content for the day and reads NO note (a
     deterministic refusal, so nothing is queued for the backfill). */
  const first = makeHarness(Object.assign({}, base, {
    store, noteResult: () => ({ ok: false, reason: 'extension-predates-scoped-read' })
  }));
  const r1 = await first.api._runHistoryBatch(first.rows, [], first.onStatus, {});
  eq(r1.contentVerified, true, 'the first pull did not verify the day - rsk-1.0.0 will not skip on the second');
  eq(Number(r1.todayNoteRead || 0), 0, 'the first pull read a note it was supposed to refuse');

  const h = makeHarness(Object.assign({}, base, {
    store, patients: first.patients, noteDelayMs: 25000, noteResult: () => ({ ok: true, visits: 1 })
  }));
  const r = await h.api._runHistoryBatch(h.rows, [], h.onStatus, {});
  eq(Number(r.chartsSkippedVerifiedToday || 0), 6,
    'the re-pull did not skip the histories, so this is not the tail-pass case');
  eq(r.todayNotePassOrdered, true, 'the tail pass did not order its rows');
  ok(h.noteCalls.length >= 2, 'the fixture read nothing');
  /* row index 4 is 08:00 - the earliest slot that has passed - and is first
     through the door even though it is FIFTH in the array. */
  eq(h.noteCalls.map(c => c.patientId).join(','), 'syn-05,syn-04,syn-03',
    'the pass did not walk the clinic day forward: ' + h.noteCalls.map(c => c.patientId).join(','));
  /* the 15:30 row has not happened: skipped honestly, never read, never timed
     out - tny-1.0.0 still holds under the new ordering. */
  ok(h.noteCalls.every(c => c.patientId !== 'syn-06'), 'a slot that has not arrived was read anyway');
  eq(Number(r.todayNoteNotYet || 0), 1, 'the not-yet row was not counted as not-yet');
  eq(Number(r.todayNoteSkippedNotYet || 0), 1, 'the not-yet skip is missing from the receipt');
  /* and the rows the budget could not reach were handed over, not failed */
  eq(Number(r.todayNoteHandedOff || 0), 2, 'the unreached rows were not handed to the backfill');
  eq(Number(r.todayNoteRead || 0) + Number(r.todayNoteHandedOff || 0) + Number(r.todayNoteNotYet || 0), 6,
    'the ordered pass lost a row');
  row('re-pull, tail pass, 60 s budget @25 s/note', 'pullspeed2', r, h);

  /* an explicit STATUS field, if the extension ever supplies one, wins outright */
  const store2 = new Map();
  const base2 = Object.assign({}, base, { rows: 4, rowTime: i => ['08:00', '09:00', '10:00', '11:00'][i] });
  const firstS = makeHarness(Object.assign({}, base2, {
    store: store2, noteResult: () => ({ ok: false, reason: 'extension-predates-scoped-read' })
  }));
  await firstS.api._runHistoryBatch(firstS.rows, [], firstS.onStatus, {});
  const withStatus = makeHarness(Object.assign({}, base2, {
    store: store2, patients: firstS.patients, noteDelayMs: 25000, noteResult: () => ({ ok: true, visits: 1 })
  }));
  /* the LAST row is the only one athena marks checked out */
  withStatus.rows[3].status = 'Checked Out';
  await withStatus.api._runHistoryBatch(withStatus.rows, [], withStatus.onStatus, {});
  ok(withStatus.noteCalls.length >= 1, 'the status fixture read nothing');
  eq(withStatus.noteCalls[0].patientId, 'syn-04',
    'a row the schedule marks Checked Out did not sort ahead of earlier unmarked slots (read ' +
    withStatus.noteCalls[0].patientId + ' first)');
}

/* ------------------------------------------------------------------ driver */
const watchdog = setTimeout(() => {
  console.error(new Error('1p-daynote-pass-budget-and-backfill did not finish'));
  process.exit(1);
}, 240000);

(async () => {
  await slowAthenaRun();
  await fastAthenaRun();
  await rePullRun();
  await backfillRun();
  await progressGateRun();
  await priorityRun();
  clearTimeout(watchdog);
  try { fs.rmSync(CONTROL_DIR, { recursive: true, force: true }); } catch (eRm) {}

  /* the before/after table the owner asked for */
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log('');
  console.log('  DAY-NOTE PASS - measured before/after (synthetic harness, real engine)');
  console.log('  ' + pad('scenario', 44) + pad('engine', 13) + padL('chartOpens', 11) +
    padL('noteReads', 10) + padL('dayNote s', 10) + padL('read', 6) + padL('deferred', 9));
  console.log('  ' + '-'.repeat(103));
  TABLE.forEach(t => {
    console.log('  ' + pad(t.scenario, 44) + pad(t.engine, 13) + padL(t.chartOpens, 11) +
      padL(t.noteReads, 10) + padL(t.dayNoteSec, 10) + padL(t.notesRead, 6) + padL(t.deferred, 9));
  });
  console.log('');

  console.log('PASS 1p-daynote-pass-budget-and-backfill: ' + checks + ' checks - on a 40-60 s-per-note night the day-note pass is bounded by ONE 4-minute budget for a 24-row day and hands the rest to the background backfill with counts that add up to the day (causal control: origin/main spends 10+ minutes on the same fixture and has no budget at all), a fast machine still reads every note at exactly one chart open per patient per door, a same-day re-pull re-opens ONLY the unread rows and attempts each at most once (A/B: 8 chart opens saved, and the lever off re-opens all twelve), the background backfill asks mlsAthenaPresence before it repeats the owner\'s false "open your signed-in athenaOne" - retrying a proven-present athena, standing its ground on a proven-absent one, bounded at 2 attempts a row - and publishes a receipt of closed reason CODES and counts carrying no name, DOB or MRN, a timing refusal earns its one retry only after observable progress, and the pass reads the earliest-passed appointments first while a slot that has not arrived is skipped honestly rather than timed out');
})().catch(err => { clearTimeout(watchdog); console.error(err); process.exit(1); });

'use strict';
/* =============================================================================
 * onheal-1.0.0 - THE DAY PULL HEALS ITSELF WITH FULL VISIT NOTES **ON**
 *
 * OWNER, 2026-08-26, about the day pull: it is "the number 1 thing", it must be
 * "self healing and save those ones that didn't work the first time", and
 * "make sure the visit for the day is being pulled correctly as that visit is
 * very important as will be used in op notes".
 *
 * FOUR MEASURED HOLES, all of them ON-mode-only, all executed here:
 *
 * (1) THE SAME-DAY LANE WAS STRUCTURALLY DEAD IN ON MODE. The cachev-1.0.0 v2
 *     proof demands lanes.sameDayNote.status in (saved|absent|not-yet-available),
 *     but that status was derived only from p.todayNote - and BOTH day-note
 *     lanes are gated `pullVisitBodies !== true`, so with Full visit notes ON
 *     todayNote is null forever, the lane read "unknown", and
 *     rskAlreadyVerifiedToday rejected every same-day re-pull with
 *     "same-day-lane-unproven". Consequence: EVERY same-day re-pull re-walked
 *     EVERY chart.
 *
 * (2) THE IDLE SELF-HEAL WAS NEVER FED IN ON MODE. niSyncFromReceipt's blanket
 *     `if (p.todayNote !== false) return;` dropped every row whose day-note
 *     stage produced no verdict at all - which in ON mode is every row. A
 *     first-time failure was therefore never retried by anything.
 *
 * (3) THE SWEEP LABEL LIED. A row could read "chart saved - full visit notes
 *     queued for automatic re-check" when nothing was ever going to re-check
 *     it: after Stop the whole sweep block (try AND its finally) is skipped,
 *     so the terminal settle and ppEnd never ran at all.
 *
 * (4) THE PER-ROW FACTS CAPTURE LEFT A NON-VERDICT. The ledger row kept the
 *     literal 'queued' forever because nothing ever collected the answer.
 *
 * Real /1p importer, fake extension, synthetic identities, drivable clock.
 * No network, no PHI.
 * ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const SI = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');

const DAY = '2026-08-17';
const LEDGER_KEY = 'p1-harness::schedImportIndexV1::' + DAY;

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

const GOOD_CHART = () => ({ problems: 'Synthetic problem', meds: 'Synthetic med', summary: 'Synthetic summary' });
/* the ON walk's own answer: an UNSCOPED history that contains the pulled day */
const WALK_WITH_THE_DAY = (pid) => ({ ok: true, visits: [
  { date: DAY, type: 'Office visit', raw: 'Synthetic pulled-day encounter body with substantive clinical detail.', fullDetail: true, sourceVisitKey: 'row:sd-' + pid },
  { date: '2026-01-05', type: 'Office visit', raw: 'Synthetic prior visit with substantive clinical detail.', fullDetail: true, sourceVisitKey: 'row:prior-' + pid }
] });
/* the same complete walk with NO encounter on the pulled day */
const WALK_WITHOUT_THE_DAY = (pid) => ({ ok: true, visits: [
  { date: '2026-01-05', type: 'Office visit', raw: 'Synthetic prior visit with substantive clinical detail.', fullDetail: true, sourceVisitKey: 'row:prior-' + pid }
] });

/* the coverage reader the clinical floor demands; absent from the shared
   harness because most fixtures do not reach the versioned-lane proof. */
function shipCoverageReader(h) {
  h.rt._assistReadCoverage = (_t, _s, o) => Promise.resolve({
    ok: true, values: {},
    receipt: { complete: true, status: 'saved', requestId: String((o && o.requestId) || ''),
      sourceSurface: 'synthetic-suite', capturedAt: h.clock.now(), fieldsPresent: 0, fieldsEmpty: 0 }
  });
}
function ledger(h) {
  const raw = h.rt.localStorage.getItem(LEDGER_KEY);
  return raw ? JSON.parse(raw) : null;
}

/* ================================================== 0  THE STATIC SHAPE == */
{
  const a = SI.indexOf('/* ===== onheal-1.0.0 (the ON lane\'s same-day proof) =');
  ok(a > 0, 'the onheal-1.0.0 same-day-proof block is missing from the /1p importer');

  /* THE ONE THING THIS FIX MAY NEVER DO: claim a pulled-day READ it never
     made. tests/1p-pull-resume-skip-and-cost-runtime pins todayNoteRead === 0
     in full mode and it is right - the ON proof rides its own field. */
  const laneFn = SI.slice(SI.indexOf('function sameDayLaneStatus(p) {'), SI.indexOf('function recordHistoryVerdict('));
  ok(laneFn.length > 200, 'sameDayLaneStatus could not be isolated');
  ok(!/todayNote\s*=[^=]/.test(laneFn),
    'the ON same-day proof WRITES todayNote - full mode makes no separate pulled-day read and must never report one');
  /* the status vocabulary is closed at BOTH ends: the writer validates against
     the same set the checker accepts, so an alien string can never travel. */
  eq((laneFn.match(/\^\(saved\|absent\|not-yet-available\)\$/g) || []).length, 2,
    'the ON fallbacks are no longer validated against the checker\'s own closed vocabulary');

  /* the walk-derived proof is admitted ONLY for a complete, unscoped walk */
  const proofSite = SI.slice(SI.indexOf('/* onheal-1.0.0: derive the ON lane\'s same-day proof'),
    SI.indexOf('/* si-2.0.0: a COMPLETED body pass earns the carry stamp. */'));
  ok(proofSite.length > 400, 'the walk-derived same-day proof could not be isolated');
  ok(/savedVisits\.scopedAdditive !== true/.test(proofSite),
    'a SCOPED/additive slice can stamp the walk proof - a slice is not the complete verified universe');
  ok(/savedVisits\.visitsCoverageComplete === true/.test(proofSite),
    'an INCOMPLETE walk can stamp the walk proof - "absent" would then be a guess');
  ok(!/one\.todayNote\s*=[^=]/.test(proofSite), 'the walk proof writes todayNote');
}

/* ================== 1  THE ON LANE PROVES THE DAY, AND THE RE-PULL SKIPS = */
async function testOnModeSameDayProofAndRoundTrip() {
  const store = new Map();
  const h1 = makeHarness({ day: DAY, today: DAY, rows: 3, visitNotesOn: true,
    chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITH_THE_DAY, store });
  shipCoverageReader(h1);
  const r1 = await h1.api._runHistoryBatch(h1.rows, [], h1.onStatus);

  eq(r1.visitNotesMode, 'full', 'the fixture did not run in Full visit notes ON mode');
  eq(r1.patients.filter(p => p.complete === true).length, 3, 'the ON walk did not complete every row');
  eq(h1.chartCalls.length, 3, 'the first pull did not open one chart per row');

  /* THE DAY'S OWN VISIT IS WHAT THE OWNER CARES ABOUT: it was walked, it was
     saved onto the target chart, and the proof says so in one measured word. */
  ok(h1.patients.every(p => (p.visits || []).some(v => String(v.date) === DAY)),
    "the pulled day's own encounter did not land on the target chart");
  ok(r1.patients.every(p => p.sameDayProof && p.sameDayProof.status === 'saved' &&
    p.sameDayProof.day === DAY && p.sameDayProof.from === 'full-walk'),
    'the ON walk did not stamp the same-day proof it actually measured');

  /* ...and it did NOT invent a pulled-day read */
  ok(r1.patients.every(p => p.todayNote == null), 'the ON lane wrote todayNote - it made no separate read');
  eq(Number(r1.todayNoteRead || 0), 0, 'full mode reported separate pulled-day reads it never made');
  eq(h1.noteCalls.filter(c => String(c.onlyDate || '')).length, 0,
    'full mode ran a separate scoped pulled-day lane on top of the historical walk');

  /* the ledger lane is the thing rskAlreadyVerifiedToday reads */
  const lanes1 = (ledger(h1).history || {}).perPatientLanes || {};
  eq(lanes1['syn-01'].sameDayNote.status, 'saved',
    'the ON pull still wrote an "unknown" same-day lane - every same-day re-pull would re-walk every chart');
  eq(lanes1['syn-01'].coverage.complete, true, 'the clinical-floor coverage lane was not proven');
  eq(lanes1['syn-01'].allHistory.scope, 'full', 'the ON pull did not record a full-scope history proof');

  /* ---- THE ROUND TRIP. This is the coverage that was missing everywhere:
     every existing skip case hand-seeds the ledger, so nothing proved that a
     REAL pull writes a proof a REAL re-pull can accept. ------------------- */
  const h2 = makeHarness({ day: DAY, today: DAY, rows: 3, visitNotesOn: true,
    chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITH_THE_DAY,
    store, patients: h1.patients });
  shipCoverageReader(h2);
  const r2 = await h2.api._runHistoryBatch(h2.rows, [], h2.onStatus);
  eq(r2.chartsSkippedVerifiedToday, 3,
    'the same-day re-pull re-walked charts it had already proved - the owner\'s "43 minutes" defect');
  eq(h2.chartCalls.length, 0, 'the re-pull opened ' + h2.chartCalls.length + ' charts; it had proof for all three');
  eq(h2.noteCalls.length, 0, 'the re-pull re-read visit bodies it had already proved');
  ok(r2.patients.every(p => p.chartSkippedVerifiedToday),
    'a skipped row is not recorded as skipped - it must never look like a fresh read');

  /* ---- AND THE PROOF MUST NOT DECAY. Without carrying the accepted status
     through the skip, the second pull writes a lane with no same-day status,
     and the THIRD pull re-walks everything the second one proved. --------- */
  const lanes2 = (ledger(h2).history || {}).perPatientLanes || {};
  eq(lanes2['syn-01'].sameDayNote.status, 'saved',
    'the skip wrote a lane that regressed to unknown - the next re-pull would re-walk the whole day again');
  ok(r2.patients.every(p => p.sameDayProof && p.sameDayProof.carriedFromProof === true),
    'the skip did not carry forward the same-day lane the validator accepted');

  const h3 = makeHarness({ day: DAY, today: DAY, rows: 3, visitNotesOn: true,
    chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITH_THE_DAY,
    store, patients: h1.patients });
  shipCoverageReader(h3);
  const r3 = await h3.api._runHistoryBatch(h3.rows, [], h3.onStatus);
  eq(r3.chartsSkippedVerifiedToday, 3, 'the THIRD same-day pull re-walked what the second one proved');
  eq(h3.chartCalls.length, 0, 'the third pull opened charts again');
}

/* ============== 2  THE PROOF CLAIMS ONLY WHAT THE WALK MEASURED ========== */
async function testProofOnlyClaimsWhatWasMeasured() {
  /* (a) a complete unscoped walk with NO encounter on the pulled day EARNS
     "absent" ONLY when that day is FINISHED (onheal-1.0.1, refuter
     2026-08-26): today's walk is a point-in-time observation - the note may
     simply not be written yet - so an in-progress day reports
     not-yet-available and can never buy a same-day skip. The wall clock is
     the runtime's own, so this case pulls YESTERDAY relative to the real
     machine date to be a genuinely finished day. */
  const store = new Map();
  const h = makeHarness({ day: DAY, today: DAY, rows: 2, visitNotesOn: true,
    chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITHOUT_THE_DAY, store });
  shipCoverageReader(h);
  const r = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  /* The walked day IS the harness's today -> in progress -> the walk may only
     say not-yet-available; claiming "absent" would buy a skip on a day whose
     note may still be coming. */
  ok(r.patients.every(p => p.sameDayProof && p.sameDayProof.status === 'not-yet-available'),
    'an in-progress day claimed a terminal status from a point-in-time walk (onheal-1.0.1 forbids the skip)');
  /* The FINISHED-day twin: same complete walk, pulled day strictly before the
     harness clock -> "absent" is an honest terminal claim. */
  const storeFin = new Map();
  const hFin = makeHarness({ day: '2026-08-16', today: DAY, rows: 2, visitNotesOn: true,
    chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITHOUT_THE_DAY, store: storeFin });
  shipCoverageReader(hFin);
  const rFin = await hFin.api._runHistoryBatch(hFin.rows, [], hFin.onStatus);
  ok(rFin.patients.every(p => p.sameDayProof && p.sameDayProof.status === 'absent'),
    'a complete walk that found no encounter on a FINISHED pulled day did not earn "absent"');
  ok(h.patients.every(p => !(p.visits || []).some(v => String(v.date) === DAY)),
    'the fixture is vacuous - a pulled-day visit was stored anyway');

  /* (b) a row the walk could NOT finish gets no proof at all */
  const hFail = makeHarness({ day: DAY, today: DAY, rows: 2, visitNotesOn: true,
    chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITH_THE_DAY,
    chartResult: (t) => (String(t.patientId) === 'syn-02' ? { __throw: 'chart-read-failed-fixture' } : null) });
  shipCoverageReader(hFail);
  const rFail = await hFail.api._runHistoryBatch(hFail.rows, [], hFail.onStatus);
  const failed = rFail.patients.filter(p => String(p.patientId) === 'syn-02')[0];
  ok(failed && failed.complete !== true, 'the fixture did not actually fail the second row');
  ok(!failed.sameDayProof, 'a chart the walk never read still claimed a same-day proof');

  /* (c) THE CHECKER'S OWN GATE, executed: an unproven or ALIEN status is
     refused, so nothing outside the measured vocabulary can buy a skip. */
  for (const [status, why] of [['unknown', 'an unproven lane'], ['unread', 'an unread lane'],
    ['saved-ish', 'an alien status string'], ['', 'an empty status']]) {
    const s2 = new Map();
    const seed = makeHarness({ day: DAY, today: DAY, rows: 1, visitNotesOn: true,
      chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITH_THE_DAY, store: s2 });
    shipCoverageReader(seed);
    await seed.api._runHistoryBatch(seed.rows, [], seed.onStatus);
    const x = ledger(seed);
    x.history.perPatientLanes['syn-01'].sameDayNote = { status: status };
    seed.rt.localStorage.setItem(LEDGER_KEY, JSON.stringify(x));

    const re = makeHarness({ day: DAY, today: DAY, rows: 1, visitNotesOn: true,
      chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITH_THE_DAY,
      store: s2, patients: seed.patients });
    shipCoverageReader(re);
    const rr = await re.api._runHistoryBatch(re.rows, [], re.onStatus);
    eq(Number(rr.chartsSkippedVerifiedToday || 0), 0, why + ' bought a skip');
    eq(String((rr.patients[0].cacheProof || {}).reason || ''), 'same-day-lane-unproven',
      why + ' was refused for the wrong reason');
    eq(re.chartCalls.length, 1, why + ' skipped the fresh chart read anyway');
  }
}

/* ======================= 3  THE ON-MODE SELF-HEAL FEED =================== */
/* niSyncFromReceipt is THE feed into the idle backfill. The ON branch is
   placed AFTER the three existing checks, so no OFF verdict semantics move. */
async function testSelfHealFeed() {
  const mk = () => makeHarness({ day: DAY, today: DAY, rows: 1, visitNotesOn: true });
  const NAMES = ['Quillon Ashgrove', 'Marisela Fenwick', 'Tobias Underhay', 'Perpetua Vandersloot', 'Ignatius Blackmoor'];

  /* (a) the ON row nothing could finish is the one that gets queued */
  {
    const h = mk();
    const receipt = { day: DAY, visitNotesRequested: true, patients: [
      { patientId: 'on-failed', name: NAMES[0], reason: 'chart-read-deadline-exceeded' },   /* todayNote null, incomplete */
      { patientId: 'on-complete', name: NAMES[1], complete: true },                          /* the walk proved it */
      { patientId: 'off-read', name: NAMES[2], todayNote: true },
      { patientId: 'off-notyet', name: NAMES[3], todayNote: 'not-yet' },
      { patientId: 'off-deferred', name: NAMES[4], todayNote: false, todayNoteDeferred: true }
    ] };
    eq(h.api._notesIdleSyncFromReceipt(receipt, DAY), 1,
      'the ON pull handed the wrong number of leftovers to the idle self-heal');
    const rows = h.api._notesIdle().rows;
    eq(rows.length, 1, 'the idle queue took a row it should not own');
    eq(rows[0].patientId, 'on-failed',
      'the ON row that failed first time was not the row queued - "save those ones that didn\'t work the first time"');
    eq(rows[0].day, DAY, 'the queued row lost the day it owes');
    eq(rows[0].code, 'deadline', 'the queued row did not carry a closed PHI-free reason code');
    eq(JSON.stringify(rows).indexOf('Ashgrove'), -1, 'the idle queue carries a NAME - it must be codes and ids only');
  }

  /* (b) the same receipt on a FUTURE day queues nothing - there is no note yet */
  {
    const h = makeHarness({ day: '2026-08-20', today: DAY, rows: 1, visitNotesOn: true });
    const receipt = { day: '2026-08-20', visitNotesRequested: true,
      patients: [{ patientId: 'on-failed', name: NAMES[0], reason: 'chart-read-deadline-exceeded' }] };
    eq(h.api._notesIdleSyncFromReceipt(receipt, '2026-08-20'), 0,
      'a day that has not happened yet was queued for a self-heal read');
  }

  /* (c) STOP still means stop */
  {
    const h = mk();
    h.rt.__mlsPullStopRequested = true;
    eq(h.api._notesIdleSyncFromReceipt({ day: DAY, visitNotesRequested: true,
      patients: [{ patientId: 'on-failed', name: NAMES[0], reason: 'chart-read-deadline-exceeded' }] }, DAY), 0,
      'a stopped pull still fed the idle self-heal');
  }

  /* (d) THE CAPS ARE HONOURED. NI_MAX_ROWS is 200; feed 260 ON failures. */
  {
    const h = mk();
    const many = { day: DAY, visitNotesRequested: true, patients: [] };
    for (let i = 0; i < 260; i++) many.patients.push({ patientId: 'on-' + i, name: NAMES[i % 5], reason: 'chart-read-deadline-exceeded' });
    h.api._notesIdleSyncFromReceipt(many, DAY);
    const r = h.api._notesIdle();
    eq(r.rows.length, 200, 'the ON feed queued ' + r.rows.length + ' rows - NI_MAX_ROWS is 200 and must bound it');
  }

  /* (e) a row that GAVE UP revives exactly once on a later pull, then the
     ladder starts over - the pull is a deliberate act and a fresh refusal is
     fresh evidence, but this can never become an unbounded retry. */
  {
    const QUEUE_KEY = 'p1-harness::p1NotesIdleQueueV1';
    const store = new Map();
    const h = makeHarness({ day: DAY, today: DAY, rows: 1, visitNotesOn: true, store });
    const receipt = { day: DAY, visitNotesRequested: true,
      patients: [{ patientId: 'on-failed', name: NAMES[0], reason: 'chart-read-deadline-exceeded' }] };
    eq(h.api._notesIdleSyncFromReceipt(receipt, DAY), 1, 'the first feed did not queue the row');
    eq(h.api._notesIdleSyncFromReceipt(receipt, DAY), 0, 'the same row was queued twice by two feeds');

    /* drive it to gave-up the way the engine does, then feed again */
    const raw = JSON.parse(h.rt.localStorage.getItem(QUEUE_KEY));
    raw.rows[0].s = 'gave-up'; raw.rows[0].a = 3;
    h.rt.localStorage.setItem(QUEUE_KEY, JSON.stringify(raw));
    const h2 = makeHarness({ day: DAY, today: DAY, rows: 1, visitNotesOn: true, store });
    eq(h2.api._notesIdle().rows[0].state, 'gave-up', 'the fixture did not persist a gave-up row');
    eq(h2.api._notesIdleSyncFromReceipt(receipt, DAY), 1, 'a later pull did not revive the row that gave up');
    const revived = h2.api._notesIdle().rows[0];
    eq(revived.state, 'queued', 'the revived row is not queued');
    eq(revived.attempts, 0, 'the revived row kept its spent attempts - the ladder must start over');
    eq(h2.api._notesIdleSyncFromReceipt(receipt, DAY), 0,
      'a revived row revives AGAIN on the same pull - one fresh life per pull is the bound');
  }

  /* (f) a row whose day visit is already ON FILE is dropped, never re-read */
  {
    const h = mk();
    h.patients[0].visits = [{ date: DAY, type: 'Office visit', raw: 'Synthetic body', fullDetail: true, bodyComplete: true, source: 'athena-schedule-history', identityVerified: true }];
    const receipt = { day: DAY, visitNotesRequested: true,
      patients: [{ patientId: h.patients[0].id, name: NAMES[0], reason: 'chart-read-deadline-exceeded' }] };
    eq(h.api._notesIdleSyncFromReceipt(receipt, DAY), 0,
      'a row whose pulled-day visit is already on file was queued for another Athena read');
  }
}

/* ============================ 4  THE SWEEP LABEL TELLS THE TRUTH ========= */
async function testSweepLabelTruth() {
  /* the label may only be claimed for a re-check that can still happen */
  const fin = SI.slice(SI.indexOf('function finalizeVerdict(holdAutomaticRows) {'),
    SI.indexOf('receipt.day = batchScopeDay;'));
  ok(/receipt\.sweepBudgetExhausted !== true/.test(fin),
    'a budget-exhausted row can still be labelled "queued for automatic re-check"');
  ok(/__stpStopped !== true/.test(fin),
    'a STOPPED row can still be labelled "queued for automatic re-check" - nothing will ever re-check it');
  /* the two byte-pinned literals other suites depend on must survive */
  ok(SI.includes('oneQueuedForSweep ? "queued-for-automatic-recheck"'),
    'the pinned queued-for-automatic-recheck literal was removed from the importer');
  ok(/fpQueuedForSweep \? "queued-for-automatic-recheck"/.test(SI),
    'the finalize-side queued-for-automatic-recheck literal was removed');
  /* the budget-exhausted branch must SAY what it did */
  ok(/receipt\.sweepSkippedForTime = sweepable\.length;/.test(SI),
    'the budget-exhausted sweep does not count the rows it skipped for time');
  ok(/Out of time for the automatic re-check/.test(SI),
    'the budget-exhausted sweep does not tell the doctor the re-check was skipped for time');
  ok(/recheckSkipped = "out-of-time"/.test(SI),
    'the rows the sweep skipped for time are not stamped as skipped');

  /* ---- EXECUTED: after a Stop the batch still ends terminally ---------- */
  const h = makeHarness({
    day: DAY, today: DAY, rows: 8, visitNotesOn: true,
    chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITH_THE_DAY,
    chartResult: (target) => {
      const id = String(target.patientId);
      if (id === 'syn-02') return { __throw: 'no-athena-tab' };          /* a SWEEPABLE reason */
      if (id === 'syn-04') { h.rt.window.__mlsPullStopRequested = true; return null; }
      return null;
    }
  });
  shipCoverageReader(h);
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  eq(receipt.stoppedByUser, true, 'the fixture did not actually stop the pull');
  eq(receipt.sweepPasses, undefined, 'the automatic sweep ran after the doctor pressed Stop');

  const s = h.ppState();
  ok(s, 'the pull progress state vanished');
  eq(s.running, false,
    'after a Stop the DONE card never froze its clock - ppEnd was never reached (the try/finally is the body of the un-stopped branch)');
  ok(Number(s.finishedAt || 0) > 0, 'the stopped pull never stamped a finish time');

  /* the panel and 1p-mls-connect both read the LAST settle per row key, so
     that is where the doctor's sentence comes from. The in-loop label is
     honest while the sweep is still ahead; the lie is leaving it standing. */
  const latest = (state) => {
    const by = {};
    state.rows.forEach(r => { by[r.k || r.name] = r; });
    return Object.keys(by).map(k => by[k]);
  };
  const stopLatest = latest(s);
  ok(s.rows.some(r => r.reason === 'queued-for-automatic-recheck'),
    'the stopped fixture never produced the in-loop sweep label, so the correction below proves nothing');
  eq(stopLatest.filter(r => r.reason === 'queued-for-automatic-recheck').length, 0,
    'a stopped pull still promised an automatic re-check that can never happen');
  eq(stopLatest.filter(r => r.pending === true).length, 0,
    'a stopped pull left a row reading pending forever');
  ok(stopLatest.some(r => String(r.pid || '') === 'syn-02' && /no-athena-tab/.test(String(r.reason || ''))),
    'the stopped row never got its real verdict back - it was left on the sweep promise');

  /* NON-VACUITY: the same fixture WITHOUT the Stop does claim the re-check for
     its sweepable row, so the assertion above is measuring the Stop and not an
     absent code path. */
  const h2 = makeHarness({
    day: DAY, today: DAY, rows: 8, visitNotesOn: true,
    chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITH_THE_DAY,
    chartResult: (target) => (String(target.patientId) === 'syn-02' ? { __throw: 'no-athena-tab' } : null)
  });
  shipCoverageReader(h2);
  await h2.api._runHistoryBatch(h2.rows, [], h2.onStatus);
  const s2 = h2.ppState();
  ok(s2.rows.some(r => r.reason === 'queued-for-automatic-recheck'),
    'the control never produced a queued-for-automatic-recheck row, so the Stop assertion proves nothing');
  eq(s2.running, false, 'the un-stopped control did not close its progress panel');
}

/* ================= 5  THE PER-ROW FACTS CAPTURE SETTLES =================== */
async function testCaptureSettlesBeforeTheBatchReturns() {
  const h = makeHarness({ day: DAY, today: DAY, rows: 4, visitNotesOn: true,
    chartCoverage: true, parseResult: GOOD_CHART, noteResult: WALK_WITH_THE_DAY });
  shipCoverageReader(h);
  /* record WHEN each capture is dispatched, measured in charts-read-so-far */
  const dispatched = [];
  const inner = h.rt.postMessage;
  h.rt.postMessage = (msg) => {
    if (msg && msg.type === 'mlsAppCapture') dispatched.push(h.chartCalls.length);
    return inner(msg);
  };
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);

  /* (a) the DISPATCH stays on the row. mlsAppCapture carries NO patient
     argument anywhere in its chain - it reads whatever chart the athenaOne tab
     is showing - so re-dispatching after the loop would read the LAST row's
     banner for every target and the two-token name guard would refuse all but
     one. Content preserved: one capture per row, while that row's verified
     chart is still the active surface. */
  eq(dispatched.length, 4, 'the pull dispatched ' + dispatched.length + ' captures for 4 rows');
  assert.deepStrictEqual(dispatched, [1, 2, 3, 4],
    'the captures were not dispatched one per row while that row\'s chart was the active surface');
  checks++;

  /* (b) the SETTLE is what was deferred: no row may be left on the non-verdict
     'queued' when the batch reports. */
  eq(receipt.patients.filter(p => p.factsCapture === 'queued').length, 0,
    "a row's facts capture was still on the non-verdict 'queued' when the batch returned");
  eq(receipt.patients.filter(p => typeof p.factsCapture === 'string' && p.factsCapture).length, 4,
    'a row reached the ledger with no facts-capture verdict at all');
  const census = receipt.factsCaptureVerdicts || null;
  ok(census, 'the batch does not report a facts-capture census');
  eq(Object.keys(census).reduce((n, k) => n + census[k], 0), 4,
    'the facts-capture census does not account for every row');

  /* (c) the promise handle may never reach a receipt or the day ledger */
  ok(receipt.patients.every(p => Object.keys(p).indexOf('__factsCaptureP') < 0),
    'the capture promise handle is enumerable on a receipt row');
  eq(JSON.stringify(receipt).indexOf('__factsCaptureP'), -1,
    'the capture promise handle reached the receipt JSON');
  eq(String(h.rt.localStorage.getItem(LEDGER_KEY) || '').indexOf('__factsCaptureP'), -1,
    'the capture promise handle reached the persisted day ledger');

  /* (d) only the OUTER batch drains; a sub-batch must not */
  ok(/if \(!sweepDepth\) \{\s*var sicapCounts/.test(SI),
    'the capture settle is not restricted to the outer batch - a sweep would drain a queue it does not own');
}

(async () => {
  await testOnModeSameDayProofAndRoundTrip();
  await testProofOnlyClaimsWhatWasMeasured();
  await testSelfHealFeed();
  await testSweepLabelTruth();
  await testCaptureSettlesBeforeTheBatchReturns();
  console.log('onheal-on-mode-self-heal-runtime: ' + checks + ' checks passed');
})().catch(err => { console.error(err); process.exit(1); });

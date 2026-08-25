'use strict';
/* =============================================================================
 * 1p-rangejobs-harness-runtime  -  the MONTH and YEAR pull, end to end, over
 * the REAL seam.
 *
 * tests/1p-rangejobs-runtime.test.js already proves the range engine against a
 * STUB importer: it hand-writes the pullMonth result shape. That can only ever
 * prove the engine agrees with the test author. This suite replaces the stub
 * with the REAL /1p importer (1p-feat_mls_schedimport_exact.js) driven by the
 * REAL range engine (1p-feat_mls_rangejobs.js) in one vm, so the contract that
 * actually ships - pullMonth -> onDayCheckpoint/shouldStop -> durable manifest
 * - is measured rather than assumed.
 *
 * It replays a synthetic MONTH containing: days with appointments, verified
 * EMPTY days, a day whose schedule read never completes, a day whose chart
 * history fails for two rows, a Pause after day 9 followed by a Resume, an
 * athenaOne sign-in that expires mid-run, and a REPEAT pull of the same month.
 * Then a YEAR, chained month by month, whose October failure must never
 * restart January.
 *
 * Fake extension, fake backend, frozen clock, synthetic names/DOB/MRN only.
 * No network, no Athena, no PHI, no login.
 *
 * ===== dayfacts-1.0.1 (superseding owner DAY contract, 2026-08-25) ==========
 * WHY THE OLD PINS MOVED. Until this contract, "Full visit notes OFF" meant
 * SCHEDULE-ONLY: the month lane forced includeHistory=false, no chart was ever
 * opened on an OFF month, and every readable day settled with the importer's
 * `complete-schedule-only` verdict. This suite pinned exactly that - three
 * assertions demanded ZERO chart opens across a whole OFF month, and one
 * demanded the `complete-schedule-only` reason on the durable day record.
 *
 * The owner's superseding ruling makes the checkbox mean "ALL historical visit
 * notes", never "whether any chart opens". So on an OFF month the per-patient
 * batch now RUNS in day-facts mode: every exact scheduled row gets its
 * identity-verified chart open and chart-facts save, historical visit
 * traversal is skipped (visitsSkipped), and the durable verdict is plain
 * `complete`. pullUnlocked/pullMonth no longer force includeHistory=false on
 * OFF, so the range engine's own `includeHistory: true` now reaches the day.
 *
 * Every old pin below was REPLACED, never deleted, by its new-contract
 * equivalent: "no chart on an OFF month" became "exactly one chart open per
 * scheduled row and NONE on a verified-empty or future day"; the
 * `complete-schedule-only` verdict became `complete` plus a positive pin on the
 * day-facts receipt (visitNotesMode 'day-facts', chartFactsRequired true,
 * allVisitBodiesRequested false, insuranceAttempted 0 / 'reader-not-shipped');
 * "OFF opened a visit-note body" became a measured ZERO unscoped all-visits
 * reads. The unchosen preference is pinned fail-closed at both doors.
 *
 * ===== dayfacts-1.0.1: THE LAST CLAUSE CLOSED ==============================
 * Under 1.0.0 one contract clause was NOT met by the shipped engine and this
 * suite pinned the measured zero: the pulled-day encounter-note attempt was
 * fused off at both lanes, and tnAggregate short-circuited the whole day-note
 * tally to `todayNoteNotRequested = rows` whenever the checkbox was off.
 *
 * 1.0.1 ships it. Both lanes are live - the inline fold-in and the tn/onlyDate
 * tail catch-up - and the short-circuit is gone. So those gap pins INVERT into
 * the contract: a day-facts row now has to PROVE its pulled-day note attempt,
 * scoped to the day being pulled, one per scheduled row, on exactly the rows
 * whose charts were opened, with the receipt saying todayNoteRead = rows and
 * todayNoteNotRequested = 0. `not-requested` survives at exactly ONE door -
 * blocked-unchosen - and is pinned there so it cannot creep back as a default.
 *
 * Because "3 notes were attempted" is only evidence if this fixture can also
 * produce zero, testPreDayfactsDayNoteFusesReadNoNote() boots the SAME harness
 * over the importer with those two switch bytes flipped back and measures the
 * old gap whole (0 onlyDate reads, todayNote null on every row,
 * chartOpens.dayNote 0) while the day-facts CHART pass is untouched - which is
 * what proves the day-note pins measure those two lanes and nothing else.
 *
 * ===== dfc-1.1.0: THE EXACT-DAY READ CHANGED TRANSPORT =====================
 * The pulled-day note now rides the SAME AllVisits bridge verb as the full
 * walk, distinguished ON THE WIRE by hint.onlyDate = the pulled day (plus
 * patientId, todayKey and identity): one bounded scoped read per row per
 * account day (dnAlreadyReadToday dedupes re-runs), saving the pulled day's
 * OWN body through the additive scoped save. So the retired fuse "OFF never
 * posts mlsAppReadAllVisits" is re-expressed, never weakened: OFF never posts
 * an UNSCOPED mlsAppReadAllVisits - the unscoped verb is still the only way to
 * walk history and is still pinned at ZERO everywhere. THIS harness's fake
 * reader is a LEGACY one (it answers the scoped verb with EVERY body - a
 * 2025-12-01 historical visit - and no scoped receipt), so this suite
 * exercises the direct read's FAILURE path: the engine must refuse the
 * unscoped answer (sameDayDirectReason 'scoped-read-unsupported-by-reader'),
 * persist NOTHING from it, and fall back to the legacy vp/tn ladder - which is
 * why every vp noteCalls pin from 1.0.1 still holds whole, now measured as the
 * fallback lane, with exactly one scoped bridge ATTEMPT per row alongside it.
 * The one legitimate home of the words `not-requested` is the new typed
 * per-row allHistoryReceipt {kind:'athena-all-history-v1', requested:false},
 * which is pinned positively and carved out of the envelope-wide vocabulary
 * scan.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeMonthHarness } = require('./1p-pull-harness.js');

const ROOT = path.resolve(__dirname, '..');
const RANGE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_rangejobs.js'), 'utf8');
/* the exact importer bytes makeMonthHarness boots, so a claim about the
   day-facts lane is measured against the source that produced the run. */
const IMPORTER = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');

const PROVIDER = { mode: 'selected', id: '7', stableKey: 'backend:7' };
let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* every date the month engine announced, in order - the doctor's "progress by
   day". The line shape is pinned by tests/provider-month-exact-routing. */
function dayProgress(lines) {
  const out = [];
  for (const line of lines) {
    const m = String(line).match(/^Month pull (\d+)\/(\d+): (\d{4}-\d{2}-\d{2})$/);
    if (m) out.push({ index: Number(m[1]), total: Number(m[2]), date: m[3] });
  }
  return out;
}
function dayStates(manifest, monthKey) {
  const days = manifest.months[monthKey].days;
  return Object.keys(days).sort().map(d => ({ date: d, status: days[d].status, reason: days[d].reason, attempts: days[d].attempts }));
}
/* Install a deliberately UN-fixed copy of the range engine so a claim about a
   fix is measured against the bytes it replaced, not asserted. */
function installPatchedRange(h, find, replace) {
  assert(RANGE.indexOf(find) >= 0, 'the pre-fix control cannot find: ' + find);
  h.runInContext(RANGE.split(find).join(replace), '1p-feat_mls_rangejobs.prefix.js');
  return h.rt.__mlsP1RangeJobs;
}
/* the range engine reads window.__mlsSI fresh on every call, so a tap here
   sees exactly what the real importer handed back. */
function tapMonth(h, sink) {
  const real = h.api.pullMonth;
  h.rt.__mlsSI.pullMonth = function (opts) {
    const call = { month: opts.month, dates: (opts.dates || []).slice() };
    sink.calls.push(call);
    return real.call(h.rt.__mlsSI, opts).then(result => { sink.results.push(result); return result; });
  };
}
/* dayfacts-1.0.0 helpers -------------------------------------------------- */
/* how many times the engine posted a bridge verb. */
function postedCount(h, type) { return h.posted.filter(m => m && m.type === type).length; }
/* dfc-1.1.0: `mlsAppReadAllVisits` is no longer one verb with one meaning.
   The day-facts exact-day read now rides the SAME bridge verb, distinguished
   on the wire by hint.onlyDate (the pulled day) - so the retired fuse "OFF
   never posts mlsAppReadAllVisits" is re-expressed, never weakened, as "OFF
   never posts an UNSCOPED mlsAppReadAllVisits". An unscoped post is the
   whole-chart historical walk, which is the read the checkbox governs. */
function allVisitsPosts(h) { return h.posted.filter(m => m && m.type === 'mlsAppReadAllVisits'); }
function scopedVisitsPosts(h) {
  return allVisitsPosts(h).filter(m => m.hint && /^\d{4}-\d{2}-\d{2}$/.test(String(m.hint.onlyDate || '')));
}
function unscopedVisitsPosts(h) {
  return allVisitsPosts(h).filter(m => !(m.hint && m.hint.onlyDate));
}
/* the real importer's per-day history receipt, pulled off the tapped month
   result rather than reconstructed by the test. */
function historyReceiptFor(tap, date) {
  for (const result of tap.results) {
    const day = (result.days || []).find(d => d && d.date === date);
    if (day && day.receipt && day.receipt.historyReceipt) return day.receipt.historyReceipt;
  }
  return null;
}

/* ======================================================================== 0 ==
 * The asset is still /1p-only and still the one the /1p loader installs.
 * ========================================================================== */
function testAssetIsP1Only() {
  const connect = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
  ok(connect.includes("A='1p-feat_mls_rangejobs.js'"), 'the /1p loader no longer installs the range engine');
  ok(!fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8').includes('1p-feat_mls_rangejobs.js'),
    'the production loader learned about the /1p range engine');
  ok(RANGE.includes("preview.route === '/1p/' || preview.route === '/1pScribeFlow.html'"),
    'the range engine can install outside the /1p preview marker');
  /* the transport-eaten-escape class: a bare d+/s+ literal parses fine and
     silently never matches (see memory: shell-transport-eats-backslashes). */
  const stripped = RANGE.replace(/\[[^\]]*\]/g, '[]');
  ok(!/\/\^?\(\?:[^/]*\)?[^/\\[]*(?<![\\[])\bd\{4\}-d\{2\}/.test(stripped),
    'a date regex in the range engine lost its backslashes in transport');
  ok(!/[^\\[]\bd\+\)/.test(stripped), 'a d+ literal in the range engine lost its backslash');
}

/* ======================================================================== 1 ==
 * ONE synthetic month, every shape at once.
 * ========================================================================== */
async function testWholeMonthReplay() {
  const h = makeMonthHarness({ legacyAllVisits: true, today: '2026-03-15' });
  /* 2 clinic days with rows, one of which loses two charts; 1 day whose grid
     never settles; the other 25 days are verified EMPTY. */
  h.seedDay('2026-02-03', 3);
  h.seedDay('2026-02-10', 4);
  h.scheduleErrorDays.add('2026-02-10');
  h.incompleteDays.add('2026-02-17');

  const tap = { calls: [], results: [] };
  tapMonth(h, tap);
  const range = h.installRangeJobs();
  ok(range && range.installed === true, 'the range engine did not install over the real importer');

  const lines = [];
  const started = Date.now();
  const result = await range.startMonth('2026-02', {
    provider: PROVIDER, includeHistory: true, pullVisitBodies: false,
    onStatus: m => lines.push(String(m || ''))
  });
  const elapsed = Date.now() - started;

  /* --- progress BY DAY, one line per day, in order, never skipping ------ */
  const progress = dayProgress(lines);
  eq(progress[0].total, 28, 'the progress line does not carry the day total');
  eq(progress.slice(0, 28).map(p => p.date).join(','), dayStates(h.manifest(), '2026-02').map(d => d.date).join(','),
    'the first pass did not announce every day once, in manifest order');
  /* p1-range-continue-1.0.0: the range comes BACK for the retryable days -
     two extra passes over exactly the two that failed, nothing else. */
  eq(progress.length, 32, 'the range did not come back for the retryable days (got ' + progress.length + ' lines)');
  eq(Array.from(new Set(progress.slice(28).map(p => p.date))).sort().join(','), '2026-02-10,2026-02-17',
    'a later pass re-ran a day that was already proved');

  /* --- per-day checkpoints are DURABLE and carry the day's OWN verdict -- */
  const states = dayStates(h.manifest(), '2026-02');
  const byDate = Object.fromEntries(states.map(s => [s.date, s]));
  eq(states.filter(s => s.status === 'complete').length, 26, 'the month did not durably complete 26 days');
  eq(byDate['2026-02-03'].status, 'complete', 'a clean 3-row day did not checkpoint complete');
  /* dayfacts-1.0.0: OFF is no longer schedule-only, so the importer's
     `complete-schedule-only` verdict is gone from this lane. The day is a
     FULL day-facts day and settles on the plain `complete` verdict; the
     abbreviation lives on the receipt, not in a second completion code. */
  eq(byDate['2026-02-03'].reason, 'complete',
    'a day-facts day with appointments lost its verdict (got ' + byDate['2026-02-03'].reason + ')');
  ok(byDate['2026-02-03'].reason !== 'complete-schedule-only',
    'the revoked schedule-only OFF verdict came back - dayfacts-1.0.0 removed it');
  eq(byDate['2026-02-01'].reason, 'provider-empty', 'a verified-empty day is indistinguishable from a day with patients');
  /* three genuine attempts, then the day is SETTLED as needs-attention with
     its own cause - never retried forever, never silently dropped */
  eq(byDate['2026-02-10'].status, 'needs-attention', 'a day that lost two charts three times is still being retried');
  eq(byDate['2026-02-10'].attempts, 3, 'the attempt cap is not 3 (got ' + byDate['2026-02-10'].attempts + ')');
  eq(byDate['2026-02-10'].reason, 'no-read',
    'the schedule-read failure did not keep the importer\'s own cause (got ' + byDate['2026-02-10'].reason + ')');
  eq(byDate['2026-02-17'].reason, 'schedule-incomplete',
    'the unsettled-grid day did not keep its own cause (got ' + byDate['2026-02-17'].reason + ')');
  ok(byDate['2026-02-10'].reason !== byDate['2026-02-17'].reason,
    'two different failures were flattened into one durable reason');
  eq(h.manifest().status, 'needs-attention', 'a settled month with two capped days did not settle');

  /* --- the completion receipt: done / rows / empty / failed / attention --- */
  const summary = h.manifest().summary;
  eq(summary.days, 28, 'the receipt lost the day total');
  eq(summary.complete, 26, 'the receipt miscounted completed days');
  eq(summary.empty, 25, 'the receipt cannot say how many days Athena verified empty');
  eq(summary.withRows, 1, 'the receipt cannot say how many days actually held appointments');
  eq(summary.failed, 0, 'a capped day is still being reported as retryable');
  eq(summary.needsAttention, 2, 'the receipt miscounted days needing attention');
  eq(summary.pending, 0, 'a day was left unaccounted for');
  eq(summary.attention.map(a => a.date + ':' + a.reason).join(','),
    '2026-02-10:no-read,2026-02-17:schedule-incomplete',
    'the receipt does not LIST the days needing attention with their own reasons');
  eq(h.manifest().run.skippedComplete, 0, 'a first run claimed it skipped verified work');
  eq(h.manifest().run.plannedDays, 28, 'a first run did not plan every day');

  /* --- the store: no duplicate appointment, one row per seeded slot ----- */
  const census = h.census();
  eq(census.rows, 3, 'the day-facts month did not import the one readable day');
  eq(census.uniqueIds, 3, 'the backend holds duplicate appointment ids');
  eq(census.uniqueAppointments, 3, 'the same Athena appointment was stored twice');
  /* dayfacts-1.0.0: an OFF month is no longer allowed to leave the chart
     cards empty. The store census is the only honest proof the facts LANDED
     rather than the chart merely being opened. */
  eq(census.patientsWithContent, 3, 'day-facts opened charts but stored no chart facts for the day\'s rows');

  /* --- empty days are not paid for: ed-1.0.0 over a whole month --------- */
  const emptyDays = h.gotoDates.filter(d => !['2026-02-03', '2026-02-10', '2026-02-17'].includes(d));
  eq(emptyDays.length, 25, 'the month did not visit each verified-empty day exactly once');
  eq(new Set(emptyDays).size, 25, 'a verified-empty day was navigated more than once');
  eq(h.gotoDates.filter(d => d === '2026-02-17').length, 3, 'the failing day was not retried exactly to the cap');

  /* ===== dayfacts-1.0.0: OFF is an ABBREVIATED CHART PASS, not a no-op ===
     The pin that stood here demanded ZERO chart opens across the whole OFF
     month. The superseding contract inverts it: every exact scheduled row on
     a readable day gets its identity-verified chart open and facts save. What
     must STILL be zero is a chart on a day Athena verified empty (no row
     exists to open) and on a day whose schedule never read (no verified row
     to bind an open to) - so the empty-day economy this suite exists to
     protect is measured, not abandoned. */
  eq(h.chartCalls.length, 3,
    'day-facts did not open exactly one chart per scheduled row (got ' + h.chartCalls.length + ')');
  eq(h.chartCalls.filter(c => c.day === '2026-02-03').length, 3,
    'the readable 3-row day did not get a chart open for every row');
  eq(new Set(h.chartCalls.map(c => c.patientId)).size, 3,
    'day-facts opened the same patient chart more than once on one day');
  eq(h.chartCalls.filter(c => !['2026-02-03', '2026-02-10'].includes(c.day)).length, 0,
    'an Athena chart was opened on a verified-empty day');
  eq(h.chartCalls.filter(c => c.day === '2026-02-10').length, 0,
    'a chart was opened on a day whose schedule never read - there is no verified row to bind it to');
  /* the other half of the contract: HISTORICAL bodies are skipped. dfc-1.1.0
     moved the exact-day read onto the SAME bridge verb, scoped by
     hint.onlyDate, so the retired "zero mlsAppReadAllVisits" fuse is
     re-expressed as zero UNSCOPED posts - the unscoped verb is still the only
     way to walk history, and its count over the whole month is still the
     measurement, not a harness-side callback. */
  eq(unscopedVisitsPosts(h).length, 0, 'day-facts mode issued the UNSCOPED all-visits walk');
  /* the new positive half: EXACTLY ONE scoped direct read per scheduled row,
     on the readable day only, carrying the pulled day, the row identity and
     the account todayKey on the wire. */
  eq(scopedVisitsPosts(h).length, 3,
    'day-facts did not post exactly one scoped AllVisits read per scheduled row (got ' + scopedVisitsPosts(h).length + ')');
  eq(scopedVisitsPosts(h).filter(m => m.hint.onlyDate === '2026-02-03').length, 3,
    'a scoped direct read was not scoped to the day being pulled');
  eq(new Set(scopedVisitsPosts(h).map(m => String(m.hint.patientId))).size, 3,
    'the scoped direct read hit the same row twice on one day');
  eq(scopedVisitsPosts(h).filter(m => m.hint.todayKey === '2026-03-15').length, 3,
    'a scoped direct read did not carry the account todayKey');
  eq(scopedVisitsPosts(h).filter(m => m.initiator === 'schedule-batch-same-day').length, 3,
    'a scoped direct read did not declare the same-day initiator');
  /* THIS fixture's reader is a LEGACY one: it answers the scoped verb with
     EVERY body (a 2025-12-01 historical visit) and no scoped receipt. The
     engine must fail the direct read CLOSED - never credit it, never persist
     the historical body - and fall back to the vp ladder, which is why the
     vp noteCalls pins below still hold whole. */
  ok(h.patients.every(p => !(p.visits || []).some(v => v && v.sourceVisitKey === 'row:syn-prior-1')),
    'the refused unscoped answer\'s HISTORICAL body was persisted - OFF must never store history');
  const dayFacts = historyReceiptFor(tap, '2026-02-03');
  eq(dayFacts.patients.filter(p => p && p.sameDayDirectReason === 'scoped-read-unsupported-by-reader').length, 3,
    'the legacy reader\'s unscoped answer was not refused with its own named reason');
  eq(dayFacts.patients.filter(p => p && p.todayNoteDirectBridge === true).length, 0,
    'a row claims its note came over the direct bridge - this fixture\'s reader cannot scope');
  ok(dayFacts, 'the readable day carried no history receipt - the day-facts batch never ran');
  eq(dayFacts.visitNotesMode, 'day-facts',
    'the OFF receipt does not declare day-facts mode (got ' + dayFacts.visitNotesMode + ')');
  eq(dayFacts.chartFactsRequired, true, 'the always-true mandatory chart-facts floor is not on the receipt');
  eq(dayFacts.allVisitBodiesRequested, false, 'the OFF receipt claims all visit bodies were requested');
  eq(dayFacts.insuranceAttempted, 0, 'the receipt claims an insurance read that has no shipped reader');
  eq(dayFacts.insuranceReason, 'reader-not-shipped',
    'the insurance placeholder is not honest (got ' + dayFacts.insuranceReason + ')');
  eq(dayFacts.patients.length, 3, 'the day-facts batch did not process every scheduled row');
  eq(dayFacts.patients.filter(p => p.visitsSkipped === true).length, 3,
    'a day-facts row traversed historical visits instead of skipping them');
  eq(Number(dayFacts.chartOpens && dayFacts.chartOpens.history), 3,
    'the receipt cannot say how many charts day-facts opened');

  /* ===== dayfacts-1.0.1: THE PULLED-DAY NOTE IS MANDATORY, AND MEASURED ===
     This is the clause that stood here under 1.0.0 as a MEASURED ENGINE GAP.
     The importer fused both day-note lanes off and tnAggregate zeroed the
     whole tally for an OFF pull, so the suite pinned 0 reads / 0 todayNoteRead
     / todayNoteNotRequested = rows, together with the exact fuse bytes.
     1.0.1 ships the attempt: both lanes are live -
       :5615  var pulledDayNoteLaneEnabled = true;   (inline fold-in)
       :6172  var pulledDayNoteTailEnabled = true;   (tail catch-up)
     - and the checkbox short-circuit is gone. So every one of those pins is
     INVERTED into the contract rather than deleted: exactly one onlyDate read
     per scheduled row, SCOPED to the day being pulled (an unscoped read is the
     whole chart, which is the read the checkbox governs), on exactly the rows
     whose charts day-facts opened, and nothing anywhere else in the month.
     testPreDayfactsDayNoteFusesReadNoNote() is the causal control that proves
     this fixture can still produce the old zero. */
  eq(h.noteCalls.length, 3,
    'day-facts did not attempt exactly one pulled-day note per scheduled row (got ' + h.noteCalls.length + ')');
  eq(h.noteCalls.filter(c => c.onlyDate === '2026-02-03').length, 3,
    'a pulled-day note was not SCOPED to the day being pulled - an unscoped read is the whole chart');
  eq(new Set(h.noteCalls.map(c => c.patientId)).size, 3,
    'day-facts read the same row\'s pulled-day note more than once');
  eq(Array.from(new Set(h.noteCalls.map(c => c.patientId))).sort().join(','),
     Array.from(new Set(h.chartCalls.map(c => c.patientId))).sort().join(','),
    'the rows that got a pulled-day note are not the rows whose charts day-facts opened');
  /* the fuse bytes, pinned from the other side: the moment either lane is
     re-fused this fails and names which one, instead of the counts above
     silently going quiet. */
  ok(IMPORTER.includes('var pulledDayNoteLaneEnabled = true;'),
    'the inline day-note fold-in was re-fused off - the mandatory pulled-day note is dead again');
  ok(IMPORTER.includes('var pulledDayNoteTailEnabled = true;'),
    'the tn/onlyDate tail catch-up was re-fused off - rows the inline lane misses get no note');
  ok(IMPORTER.indexOf('var pulledDayNoteLaneEnabled = false;') < 0 &&
     IMPORTER.indexOf('var pulledDayNoteTailEnabled = false;') < 0,
    'a revoked day-note fuse byte came back into the shipped importer');
  /* the receipt has to agree with the wire, or a surface can report a note
     lane that never ran (and did, under 1.0.0). */
  eq(Number(dayFacts.todayNoteRead || 0), 3,
    'the receipt cannot say it read the pulled-day note for every scheduled row (got ' + dayFacts.todayNoteRead + ')');
  eq(Number(dayFacts.todayNoteFailures || 0), 0, 'a day-facts row failed its pulled-day note');
  eq(Number(dayFacts.todayNoteNotRequested || 0), 0,
    'the revoked checkbox short-circuit is back - an OFF pull is declaring its pulled-day notes not-requested (got ' + dayFacts.todayNoteNotRequested + ')');
  eq(dayFacts.patients.filter(p => p && p.todayNote === true).length, 3,
    'a day-facts row did not stamp todayNote true for the day it pulled');
  eq(dayFacts.patients.filter(p => p && p.todayNote === false).length, 0,
    'a day-facts row stamped todayNote false - the pulled-day note is mandatory now');
  eq(Number(dayFacts.chartOpens && dayFacts.chartOpens.dayNote), 3,
    'the receipt cannot say how many pulled-day notes day-facts opened');
  eq(h.noteCalls.filter(c => !['2026-02-03', '2026-02-10'].includes(String(c.onlyDate))).length, 0,
    'a day-note was read on a verified-empty day, or unscoped');

  /* --- dayfacts-1.0.1 vocabulary at the RANGE seam ---------------------- */
  /* the month envelope is what the range engine itself consumes, so this is
     the level a vocabulary regression would actually reach the doctor through.
     `not-requested` is no longer a mode an OFF pull may report at ANY level,
     so the WHOLE envelope is scanned rather than the one field. */
  const monthEnvelope = tap.results[0];
  eq(monthEnvelope.visitNotesMode, 'day-facts',
    'the month result envelope does not report day-facts mode (got ' + monthEnvelope.visitNotesMode + ')');
  eq(monthEnvelope.visitNotesRequested, false, 'the OFF month envelope claims full visit notes were requested');
  /* dfc-1.1.0: the ONE legitimate home for the words `not-requested` is the
     new TYPED per-row allHistoryReceipt - {kind:'athena-all-history-v1',
     requested:false, status:'not-requested'} - which declares only that the
     ADDITIONAL all-history walk was not asked for. Pin that receipt
     positively on every row, then scan the rest of the envelope with exactly
     those receipts removed, so the revoked day-note / mode vocabulary still
     cannot creep back anywhere else. */
  eq(dayFacts.patients.filter(p => p && p.allHistoryReceipt &&
      p.allHistoryReceipt.kind === 'athena-all-history-v1' &&
      p.allHistoryReceipt.requested === false &&
      p.allHistoryReceipt.status === 'not-requested').length, 3,
    'a day-facts row lost its typed all-history not-requested receipt');
  const envelopeJson = JSON.stringify(monthEnvelope, function (k, v) {
    return k === 'allHistoryReceipt' ? undefined : v;
  });
  ok(envelopeJson.indexOf('not-requested') < 0,
    'the revoked not-requested mode is somewhere in the month envelope beyond the typed all-history receipt');
  ok(envelopeJson.indexOf('visit-notes-off') < 0, 'the revoked visit-notes-off vocabulary is still in the month envelope');
  ok(envelopeJson.indexOf('full-notes-off') < 0, 'the revoked full-notes-off vocabulary is still in the month envelope');
  ok(elapsed < 45000, 'the 28-day replay took ' + elapsed + ' ms - the empty-day path is no longer free');

  /* ================================ RESUME: only the failures re-run ==== */
  h.scheduleErrorDays.clear();
  h.incompleteDays.clear();
  const navBefore = h.gotoDates.length;
  const chartsBefore = h.chartCalls.length;
  const notesBefore = h.noteCalls.length;
  const scopedBefore = scopedVisitsPosts(h).length;
  const resumed = await range.resume({ onStatus: () => {} });
  const revisited = h.gotoDates.slice(navBefore);

  eq(resumed.complete, true, 'the month did not finish after its two failures recovered');
  eq(revisited.length, 2, 'resume re-visited ' + revisited.length + ' days; only the 2 failed ones were unproved');
  eq(revisited.sort().join(','), '2026-02-10,2026-02-17', 'resume re-pulled a day it had already verified');
  /* dayfacts-1.0.0 replaces "the resumed OFF pull opened no chart at all"
     with the precise claim: the resume opens charts for exactly the rows of
     the day it re-pulled, and for nothing it had already proved. */
  const resumedCharts = h.chartCalls.slice(chartsBefore);
  eq(resumedCharts.length, 4,
    'the resumed day-facts pull did not open one chart per row of the recovered 4-row day (got ' + resumedCharts.length + ')');
  eq(resumedCharts.filter(c => c.day === '2026-02-10').length, 4,
    'the resume opened a chart on a day other than the one it re-pulled');
  eq(h.chartCalls.filter(c => c.day === '2026-02-03').length, 3,
    'the resume re-opened charts on a day it had already proved complete');
  eq(unscopedVisitsPosts(h).length, 0, 'the resumed day-facts pull issued the UNSCOPED all-visits walk');
  /* dfc-1.1.0: the scoped direct read follows the RECOVERED day exactly as
     the charts and vp notes do - one per row of the re-pulled day, none
     re-issued for the day already proved. */
  const resumedScoped = scopedVisitsPosts(h).slice(scopedBefore);
  eq(resumedScoped.length, 4,
    'the resume did not post one scoped direct read per row of the recovered 4-row day (got ' + resumedScoped.length + ')');
  eq(resumedScoped.filter(m => m.hint.onlyDate === '2026-02-10').length, 4,
    'the resume scoped a direct read to a day other than the one it re-pulled');
  eq(new Set(resumedScoped.map(m => String(m.hint.patientId))).size, 4,
    'the resume posted the same row\'s scoped direct read twice');
  eq(scopedVisitsPosts(h).filter(m => m.hint.onlyDate === '2026-02-03').length, 3,
    'the resume re-posted scoped direct reads for a day it had already proved');
  /* dayfacts-1.0.1: the pulled-day note follows the RECOVERED day, not the
     day the pull was originally started on. A resume that re-read notes for
     an already-proved day would be paying twice for the same chart. */
  const resumedNotes = h.noteCalls.slice(notesBefore);
  eq(resumedNotes.length, 4,
    'the resumed day-facts pull did not attempt one pulled-day note per row of the recovered 4-row day (got ' + resumedNotes.length + ')');
  eq(resumedNotes.filter(c => c.onlyDate === '2026-02-10').length, 4,
    'the resume scoped a pulled-day note to a day other than the one it re-pulled');
  eq(new Set(resumedNotes.map(c => c.patientId)).size, 4,
    'the resume read one row\'s pulled-day note twice instead of covering all four rows');
  eq(h.noteCalls.filter(c => c.onlyDate === '2026-02-03').length, 3,
    'the resume re-read pulled-day notes on a day it had already proved complete');
  const recoveredReceipt = historyReceiptFor(tap, '2026-02-10');
  ok(recoveredReceipt, 'the recovered day carried no history receipt - its day-facts batch never ran');
  eq(recoveredReceipt.visitNotesMode, 'day-facts', 'the recovered day is not in day-facts mode');
  eq(Number(recoveredReceipt.todayNoteRead || 0), 4,
    'the recovered day\'s receipt cannot say it read all four pulled-day notes');
  eq(Number(recoveredReceipt.todayNoteNotRequested || 0), 0,
    'the recovered day declared its pulled-day notes not-requested');
  const resumedManifest = h.manifest();
  eq(resumedManifest.status, 'complete', 'the recovered month did not reach a terminal complete state');
  eq(resumedManifest.summary.complete, 28, 'the receipt did not account for every day after recovery');
  eq(resumedManifest.summary.failed, 0, 'the receipt still claims failures after a clean recovery');
  eq(resumedManifest.run.skippedComplete, 26, 'the receipt cannot say how many days it skipped as already verified');
  eq(resumedManifest.run.plannedDays, 2, 'the receipt cannot say how much work the resume actually planned');
  /* every failed day was retried INDIVIDUALLY, not by restarting the month */
  eq(tap.calls[tap.calls.length - 1].dates.join(','), '2026-02-10,2026-02-17',
    'the resume handed the importer more than the unproved days');

  /* ================================ REPEAT: no duplicate data ========== */
  const censusBefore = h.census();
  const navBeforeRepeat = h.gotoDates.length;
  /* a COMPLETE job is terminal, so an explicit second pull of the same month
     is admitted - that is exactly the "pull it again" the owner asked about. */
  const repeat = await range.startMonth('2026-02', { provider: PROVIDER, onStatus: () => {} });
  eq(repeat.complete, true, 'the repeat month pull did not complete');
  eq(h.gotoDates.length - navBeforeRepeat, 28, 'the repeat pull did not actually re-read the month');
  const censusAfter = h.census();
  eq(censusAfter.rows, censusBefore.rows, 'the repeat month pull created duplicate appointments');
  eq(censusAfter.uniqueIds, censusBefore.uniqueIds, 'the repeat month pull duplicated backend ids');
  eq(censusAfter.uniqueAppointments, censusBefore.uniqueAppointments, 'the repeat pull stored the same Athena appointment twice');
  eq(h.patients.length, 24, 'the repeat month pull created duplicate patients');
  /* dfc-1.1.0: AT MOST ONE scoped direct read per row per account day -
     dnAlreadyReadToday dedupes the re-run, so the repeat pull (same frozen
     account day) adds ZERO scoped posts and ZERO vp note reads on top of the
     3 + 4 already spent, even though it honestly re-reads the schedule. */
  eq(scopedVisitsPosts(h).length, 7,
    'the repeat pull re-posted a scoped direct read for a row already read this account day (got ' + scopedVisitsPosts(h).length + ')');
  eq(h.noteCalls.length, 7,
    'the repeat pull re-read a pulled-day note already saved this account day (got ' + h.noteCalls.length + ')');
  eq(unscopedVisitsPosts(h).length, 0, 'the repeat pull issued the UNSCOPED all-visits walk');

  /* the lease is not left held by anybody */
  eq(h.locksHeld().length, 0, 'a settled month job still holds a Web Lock');
  eq(h.store.has(h.monthOwnerKey()), false, 'a settled month job left the month-owner record behind');
  range.revert();
}

/* ======================================================================== 1b =
 * CAUSAL control for p1-range-reasons-1.0.0: with the final retry-reconcile
 * loop un-guarded (the shipped bytes before this lane), the SAME two failures
 * both read `month-partial` - the durable receipt could not tell a lost chart
 * from an unsettled Athena grid.
 * ========================================================================== */
async function testPreFixFlattensEveryFailureReason() {
  /* This causal control intentionally opts into Full Notes (dayfacts-1.0.0
     visitNotesMode 'full') so the chart-loss fixture remains a real HISTORY
     failure; the main replay above is the OFF day-facts contract. */
  const h = makeMonthHarness({ today: '2026-03-15', visitNotesOn: true, chartCoverage: true, identityEcho: true });
  h.seedDay('2026-02-10', 4);
  h.chartFail.add('2026-02-10|syn-01');
  h.incompleteDays.add('2026-02-17');
  const preFix = installPatchedRange(h,
    "      if (seen[retryDate] && retryDay && retryDay.status !== 'complete') continue;",
    "      /* pre-fix: no guard */");
  await preFix.startMonth('2026-02', { provider: PROVIDER, onStatus: () => {} });
  const days = h.manifest().months['2026-02'].days;
  eq(days['2026-02-10'].reason, 'month-partial', 'the pre-fix control did not flatten the history failure');
  eq(days['2026-02-17'].reason, 'month-partial', 'the pre-fix control did not flatten the schedule failure');
  eq(days['2026-02-10'].reason, days['2026-02-17'].reason,
    'the pre-fix control already distinguished the two causes - the fix proves nothing');
  preFix.revert();
}

/* ======================================================================== 1c =
 * dayfacts-1.0.0, the third state: UNCHOSEN.
 *
 * The contract has three states, not two, and the third is the one that can
 * quietly open charts on an account that never made the choice. OFF is now an
 * abbreviated chart pass, so "we did not read bodies" is no longer a proxy for
 * "we did not touch the chart" - the fail-closed door has to be measured on
 * its own. Two doors are reachable from this seam and both are pinned:
 *   - the RANGE door, where a caller supplies no explicit choice at all;
 *   - the BATCH door (__mlsSI._runHistoryBatch), the compatibility/test seam
 *     that can be reached without the public admission gate.
 * The suite also pins the boundary from the other side: a SETTLED-off
 * preference must NOT be blocked - it must run day-facts - because the old
 * `visit-notes-off` schedule-only no-op was revoked with the contract and must
 * never be reasserted as a "safe" default.
 * ========================================================================== */
function syntheticHistoryTargets(h, date) {
  return h.rowDays.get(date).map(row => ({
    patientId: row.patient_external_id, name: row.name, dob: row.dob, mrn: row.mrn,
    athenaId: row.mrn, appointmentId: row.athenaAppointmentId, scheduleDate: row.date,
    _mlsTargetPatientId: row.patient_external_id, patient_external_id: row.patient_external_id,
    date: row.date, d: row.date
  }));
}
async function testUnchosenPreferenceBlocksEveryRead() {
  /* ---- SETTLED OFF is admitted and RUNS (the revoked no-op stays dead) --- */
  const settled = makeMonthHarness({ today: '2026-03-15' });
  settled.seedDay('2026-03-09', 1);
  const offReceipt = await settled.api._runHistoryBatch(
    syntheticHistoryTargets(settled, '2026-03-09'), [], () => {}, {});
  ok(offReceipt.reason !== 'visit-notes-off',
    'the revoked schedule-only visit-notes-off no-op came back at the batch door');
  ok(offReceipt.skipped !== true, 'a settled-OFF batch skipped itself instead of running day-facts');
  eq(offReceipt.visitNotesMode, 'day-facts',
    'a settled-OFF batch is not in day-facts mode (got ' + offReceipt.visitNotesMode + ')');
  eq(offReceipt.requested, 1, 'a settled-OFF batch did not request its one row');
  eq(offReceipt.processed, 1, 'a settled-OFF batch did not process its one row');
  eq(settled.chartCalls.length, 1, 'a settled-OFF batch opened no chart - the mandatory floor is gone');
  /* dfc-1.1.0: the settled-OFF batch posts EXACTLY ONE scoped direct read for
     its one row - and still zero UNSCOPED walks. */
  eq(unscopedVisitsPosts(settled).length, 0, 'a settled-OFF batch issued the UNSCOPED all-visits walk');
  eq(scopedVisitsPosts(settled).length, 1,
    'a settled-OFF batch did not post exactly one scoped direct read for its one row (got ' + scopedVisitsPosts(settled).length + ')');
  eq(scopedVisitsPosts(settled)[0].hint.onlyDate, '2026-03-09',
    'the settled-OFF batch scoped its direct read to the wrong day (got ' + scopedVisitsPosts(settled)[0].hint.onlyDate + ')');
  /* dayfacts-1.0.1: a SETTLED-off account gets the pulled-day note too - that
     is the whole point of admitting it to runForPatient({onlyDate}). */
  eq(settled.noteCalls.length, 1, 'a settled-OFF batch did not attempt the pulled-day note for its one row');
  eq(settled.noteCalls[0].onlyDate, '2026-03-09',
    'the settled-OFF batch read an unscoped note instead of the pulled day (got ' + settled.noteCalls[0].onlyDate + ')');
  eq(Number(offReceipt.todayNoteRead || 0), 1, 'the settled-OFF receipt cannot say it read the pulled-day note');
  eq(Number(offReceipt.todayNoteNotRequested || 0), 0,
    'a settled-OFF batch declared its pulled-day note not-requested - the revoked short-circuit is back');
  /* dfc-1.1.0: the direct bridge read rides the row's already-open chart -
     the day-note leg costs zero additional opens. */
  eq(Number((offReceipt.chartOpens && offReceipt.chartOpens.dayNote) || 0), 0,
    'the direct-bridge day-note leg opened charts it does not need');

  /* ---- UNSET: zero reads, at both doors -------------------------------- */
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-03-09', 3);
  /* the harness's own pref always answers settled; an unchosen account is the
     state the engine must fail closed on, so drive it explicitly. The importer
     re-reads window.__mlsVisitNotesPref on every call, so this is the real
     seam and not a frozen boot value. */
  h.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: false, settled: false }),
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, reason: 'choice-cancelled' }),
    write: () => true, isPrefKey: () => false
  };

  const blocked = await h.api._runHistoryBatch(syntheticHistoryTargets(h, '2026-03-09'), [], () => {}, {});
  eq(blocked.reason, 'visit-notes-unchosen',
    'an unchosen account did not get the blocked receipt reason (got ' + blocked.reason + ')');
  eq(blocked.visitNotesMode, 'blocked-unchosen',
    'the blocked receipt does not name its mode (got ' + blocked.visitNotesMode + ')');
  eq(blocked.requested, 0, 'a blocked batch still claims it requested rows');
  eq(blocked.processed, 0, 'a blocked batch still claims it processed rows');
  eq(blocked.historyRequested, false, 'a blocked batch still claims history was requested');
  eq(blocked.failures, 0, 'the fail-closed refusal was reported as a failure');
  eq(blocked.patients.length, 0, 'a blocked batch produced per-patient rows');
  eq(blocked.retry.length, 0, 'a blocked batch queued a retry for a choice only the user can make');
  eq(blocked.notRequestedRows, 3, 'the blocked receipt cannot say how many rows it declined to read');
  /* dayfacts-1.0.1: blocked-unchosen is the ONE surviving not-requested door.
     Pinned positively here so the vocabulary cannot quietly return as a
     default on any OTHER path - where the suite pins it dead. */
  eq(Number(blocked.todayNoteNotRequested || 0), 3,
    'the blocked-unchosen door is the one place a not-requested day-note count survives, and it lost the count');
  eq(Number(blocked.todayNoteRead || 0), 0, 'a blocked batch claims it read a pulled-day note');
  eq(h.chartCalls.length, 0, 'an unchosen account had a patient chart opened');
  eq(h.noteCalls.length, 0, 'an unchosen account had a visit note read');
  eq(allVisitsPosts(h).length, 0,
    'an unchosen account had an AllVisits bridge read posted - scoped or not, the choice gate comes first');
  eq(h.gotoDates.length, 0, 'an unchosen account had Athena navigated');

  const range = h.installRangeJobs();
  const refused = await range.startMonth('2026-03', { provider: PROVIDER, onStatus: () => {} });
  eq(refused.ok, false, 'a range pull started without a settled full-visit-notes choice');
  eq(refused.status, 'refused', 'the unchosen range start did not refuse (got ' + refused.status + ')');
  eq(refused.gate, 'visit-notes-choice', 'the unchosen refusal does not name the gate that stopped it');
  eq(refused.reason, 'choice-cancelled', 'the unchosen refusal lost its cause (got ' + refused.reason + ')');
  eq(h.manifest(), null, 'a refused unchosen range start still wrote a durable job');
  eq(h.gotoDates.length, 0, 'a refused unchosen range start still navigated Athena');
  eq(h.chartCalls.length, 0, 'a refused unchosen range start still opened a chart');
  eq(h.locksHeld().length, 0, 'a refused unchosen range start left a Web Lock held');

  /* the BOUNDARY, stated from the other side: fail-closed is about an
     UNSTATED choice. A caller that supplies the boolean itself has made the
     choice, and the same unchosen account then runs a normal day-facts month.
     Pinned so neither half can drift silently. */
  const admitted = await range.startMonth('2026-03', { provider: PROVIDER, pullVisitBodies: false, onStatus: () => {} });
  eq(admitted.complete, true, 'an explicit caller choice was refused as unchosen');
  eq(h.chartCalls.length, 3, 'the explicitly-chosen OFF month did not run day-facts (got ' + h.chartCalls.length + ' chart opens)');
  eq(unscopedVisitsPosts(h).length, 0, 'the explicitly-chosen OFF month issued the UNSCOPED all-visits walk');
  eq(scopedVisitsPosts(h).length, 3,
    'the explicitly-chosen OFF month did not post one scoped direct read per row (got ' + scopedVisitsPosts(h).length + ')');
  eq(scopedVisitsPosts(h).filter(m => m.hint.onlyDate === '2026-03-09').length, 3,
    'the explicitly-chosen OFF month scoped a direct read outside the day it pulled');
  eq(h.noteCalls.length, 3,
    'the explicitly-chosen OFF month did not attempt one pulled-day note per row (got ' + h.noteCalls.length + ')');
  eq(h.noteCalls.filter(c => c.onlyDate === '2026-03-09').length, 3,
    'the explicitly-chosen OFF month read a note outside the day it pulled');
  range.revert();
}

/* ======================================================================== 1d =
 * CAUSAL control for dayfacts-1.0.0 itself.
 *
 * "The OFF month opened 3 charts" is only evidence if THIS fixture is capable
 * of producing zero. It is: the whole change at the month door is one clause -
 *   pre-fix:  var includeHistory = opts.includeHistory !== false && !monthFullNotesOff;
 *   shipped:  var includeHistory = opts.includeHistory !== false;
 * Boot the pre-fix bytes over the SAME harness and the SAME seeded day and the
 * old contract comes back whole: zero chart opens, zero stored chart facts, and
 * the `complete-schedule-only` verdict this suite used to pin. So the new pins
 * measure the ENGINE, not the harness, and the revoked behaviour is on record
 * rather than remembered.
 * ========================================================================== */
const DAYFACTS_MONTH_GATE = 'var includeHistory = opts.includeHistory !== false; /* dayfacts-1.0.0: OFF months still run the mandatory day-facts batch per day */';
const PRE_DAYFACTS_MONTH_GATE = 'var includeHistory = opts.includeHistory !== false && !monthFullNotesOff;';
async function testPreDayfactsOffMonthOpenedNoChart() {
  eq(IMPORTER.split(DAYFACTS_MONTH_GATE).length - 1, 1,
    'the dayfacts month gate is not exactly one line of the importer - re-anchor this control before trusting it');
  ok(IMPORTER.indexOf(PRE_DAYFACTS_MONTH_GATE) < 0,
    'the pre-dayfacts month gate is still in the shipped importer - OFF months are being forced schedule-only again');

  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-03-09', 3);
  h.runInContext(IMPORTER.split(DAYFACTS_MONTH_GATE).join(PRE_DAYFACTS_MONTH_GATE),
    '1p-feat_mls_schedimport_exact.predayfacts.js');
  ok(h.rt.__mlsSI && h.rt.__mlsSI !== h.api, 'the pre-fix importer did not replace the shipped one - the control proves nothing');
  const range = h.installRangeJobs();
  const preFix = await range.startMonth('2026-03', { provider: PROVIDER, pullVisitBodies: false, onStatus: () => {} });

  eq(preFix.complete, true, 'the pre-fix control did not complete - it failed for some other reason');
  eq(h.gotoDates.length, 15, 'the pre-fix control did not walk the same 15 elapsed days');
  eq(h.manifest().months['2026-03'].days['2026-03-09'].reason, 'complete-schedule-only',
    'the pre-fix control did not reproduce the revoked schedule-only verdict');
  eq(h.chartCalls.length, 0,
    'the pre-fix control opened a chart - the fixture cannot produce the old behaviour, so the day-facts pins prove nothing');
  eq(h.census().rows, 3, 'the pre-fix control did not import the day at all - wrong failure');
  eq(h.census().patientsWithContent, 0,
    'the pre-fix control stored chart facts - the OFF no-op it reproduces did not exist');
  range.revert();
}

/* ======================================================================== 1f =
 * CAUSAL control for the dayfacts-1.0.1 DAY-NOTE lanes.
 *
 * "The OFF month attempted 3 pulled-day notes" is only evidence if THIS fixture
 * is capable of producing zero - and under dayfacts-1.0.0 it did, which is why
 * this suite pinned the zero as a measured gap. The whole difference is two
 * switch bytes:
 *   pre-1.0.1:  var pulledDayNoteLaneEnabled = false;   (inline fold-in, :5615)
 *               var pulledDayNoteTailEnabled = false;   (tail catch-up, :6172)
 *   shipped:    both true
 * Boot the RE-FUSED bytes over the SAME harness and the SAME seeded day and the
 * old gap comes back whole at both doors: zero onlyDate reads, todayNote null
 * on every row, chartOpens.dayNote 0.
 *
 * The control is only clean if it changes NOTHING ELSE, so it also pins what
 * must stay identical: the day-facts CHART pass still opens 3 charts, still
 * stores 3 patients' facts, still reports mode 'day-facts' and still settles on
 * the plain `complete` verdict. That is what makes the day-note counts in the
 * replay a measurement of those two lanes rather than of the harness.
 * ========================================================================== */
const DAYNOTE_INLINE_LANE_ON = 'var pulledDayNoteLaneEnabled = true;';
const DAYNOTE_TAIL_LANE_ON = 'var pulledDayNoteTailEnabled = true;';
/* dfc-1.1.0: the day-note stack now has THREE rungs - the direct scoped
   bridge read plus the two legacy lanes. The control must fuse all three
   or it no longer models "day-note work fully off" and proves nothing. */
const DAYNOTE_DIRECT_ON = 'if (rd && /^\\d{4}-\\d{2}-\\d{2}$/.test(sdDay) && !dayNoteFuture(sdDay) && !dnAlreadyReadToday(sdDay, target.patientId)) {';
function refuseDayNoteLanes(src) {
  return src
    .split(DAYNOTE_INLINE_LANE_ON).join('var pulledDayNoteLaneEnabled = false;')
    .split(DAYNOTE_TAIL_LANE_ON).join('var pulledDayNoteTailEnabled = false;')
    .split(DAYNOTE_DIRECT_ON).join('if (false) {');
}
async function testPreDayfactsDayNoteFusesReadNoNote() {
  eq(IMPORTER.split(DAYNOTE_INLINE_LANE_ON).length - 1, 1,
    'the inline day-note lane switch is not exactly one line of the importer - re-anchor this control before trusting it');
  eq(IMPORTER.split(DAYNOTE_TAIL_LANE_ON).length - 1, 1,
    'the day-note tail switch is not exactly one line of the importer - re-anchor this control before trusting it');
  eq(IMPORTER.split(DAYNOTE_DIRECT_ON).length - 1, 1,
    'the direct scoped-read entry is not exactly one line of the importer - re-anchor this control before trusting it');

  /* ---- the BATCH door: the receipt fields the replay's day pins read ---- */
  const b = makeMonthHarness({ today: '2026-03-15' });
  b.seedDay('2026-03-09', 3);
  b.runInContext(refuseDayNoteLanes(IMPORTER), '1p-feat_mls_schedimport_exact.refused.js');
  ok(b.rt.__mlsSI && b.rt.__mlsSI !== b.api,
    'the re-fused importer did not replace the shipped one - the control proves nothing');
  const fused = await b.rt.__mlsSI._runHistoryBatch(syntheticHistoryTargets(b, '2026-03-09'), [], () => {}, {});
  eq(b.noteCalls.length, 0,
    'the re-fused control still attempted a pulled-day note - the fixture cannot produce the old gap, so the day-note pins prove nothing');
  eq(Number(fused.todayNoteRead || 0), 0, 'the re-fused control reported reading a note it never read');
  eq(Number(fused.chartOpens && fused.chartOpens.dayNote), 0, 'the re-fused control opened a day-note chart');
  eq(fused.patients.filter(p => p && p.todayNote === true).length, 0,
    'the re-fused control stamped todayNote true without a read');
  /* the checkbox short-circuit is gone in BOTH directions: with no lane to run,
     the tally is simply empty - it does not resurrect not-requested. */
  eq(Number(fused.todayNoteNotRequested || 0), 0,
    'the re-fused control resurrected the revoked not-requested short-circuit');
  /* ...and the chart pass is untouched, which is what makes it a control */
  eq(fused.visitNotesMode, 'day-facts', 'the re-fused control left day-facts mode - it changed more than the note lanes');
  eq(fused.processed, 3, 'the re-fused control stopped processing rows - it is not a clean control');
  eq(fused.patients.filter(p => p && p.visitsSkipped === true).length, 3,
    'the re-fused control changed the historical-visit skip - it is not a clean control');
  eq(b.chartCalls.length, 3, 'the re-fused control changed the day-facts chart pass too - it is not a clean control');
  eq(Number(fused.chartOpens && fused.chartOpens.history), 3, 'the re-fused control changed the chart-facts opens');

  /* ---- the MONTH door: the same zero through the real range engine ------ */
  const m = makeMonthHarness({ today: '2026-03-15' });
  m.seedDay('2026-03-09', 3);
  m.runInContext(refuseDayNoteLanes(IMPORTER), '1p-feat_mls_schedimport_exact.refused.js');
  const range = m.installRangeJobs();
  const preFix = await range.startMonth('2026-03', { provider: PROVIDER, pullVisitBodies: false, onStatus: () => {} });
  eq(preFix.complete, true, 'the re-fused control did not complete - it failed for some other reason');
  eq(m.noteCalls.length, 0, 'the re-fused month still attempted a pulled-day note');
  eq(m.gotoDates.length, 15, 'the re-fused control did not walk the same 15 elapsed days');
  eq(m.chartCalls.length, 3, 'the re-fused month changed the day-facts chart pass');
  eq(m.census().patientsWithContent, 3, 'the re-fused month stopped storing chart facts - it is not a clean control');
  eq(m.manifest().months['2026-03'].days['2026-03-09'].reason, 'complete',
    'the re-fused month changed the day verdict - the note lanes are not verdict-bearing');
  range.revert();
}

/* ======================================================================== 2 ==
 * Interruption after day 9, then Resume. A browser close is the same shape:
 * the manifest survives, the days already proved are never re-pulled.
 * ========================================================================== */
async function testStopAfterDayNineAndResume() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-02-04', 2);
  h.seedDay('2026-02-12', 2);
  const range = h.installRangeJobs();

  let stoppedAt = '';
  const result = await range.startMonth('2026-02', {
    provider: PROVIDER,
    onStatus: m => {
      const hit = String(m).match(/^Month pull (\d+)\/\d+: (\d{4}-\d{2}-\d{2})$/);
      if (hit && Number(hit[1]) === 9 && !stoppedAt) { stoppedAt = hit[2]; range.pause(); }
    }
  });
  eq(stoppedAt, '2026-02-09', 'the fixture did not press Pause on day 9');
  eq(result.status, 'paused', 'the settling month overwrote the durable paused state');
  ok(h.rt.__mlsPullStopRequested === true, 'Pause did not ask the importer to stop');

  const paused = h.manifest();
  const states = dayStates(paused, '2026-02');
  const done = states.filter(s => s.status === 'complete').map(s => s.date);
  ok(done.length >= 8, 'the eight days proved before the Pause were lost (kept ' + done.length + ')');
  ok(done.every(d => d <= '2026-02-09'), 'a day after the stop was marked complete');
  const afterStop = states.filter(s => s.date > '2026-02-09');
  eq(afterStop.filter(s => s.status === 'complete').length, 0, 'the pull kept running past the Pause');
  ok(afterStop.every(s => s.reason === 'stopped-by-user'),
    'the days the stop skipped are not honestly marked stopped-by-user');
  eq(h.gotoDates.filter(d => d > '2026-02-09').length, 0, 'Athena was navigated after the doctor pressed Pause');
  eq(h.locksHeld().length, 0, 'the paused job is still holding a Web Lock');
  eq(h.store.has(h.monthOwnerKey()), false, 'the paused job left the month-owner record held');
  /* a saved, non-terminal job blocks a second Start - a doctor cannot lose
     their checkpoint by pressing Start again */
  const second = await range.startMonth('2026-02', { provider: PROVIDER });
  eq(second.reason, 'job-exists', 'a second Start overwrote a paused job');
  eq(h.manifest().summary.complete, done.length, 'the refused Start disturbed the saved checkpoint');

  /* Resume: continue, never restart */
  const navBefore = h.gotoDates.length;
  const resumed = await range.resume({ onStatus: () => {} });
  eq(resumed.complete, true, 'the paused month did not finish on Resume');
  const revisited = h.gotoDates.slice(navBefore);
  eq(revisited.filter(d => d <= '2026-02-08').length, 0, 'Resume re-pulled a day proved before the Pause');
  eq(h.manifest().summary.complete, 28, 'the resumed month did not account for every day');
  eq(h.manifest().summary.failed, 0, 'the resumed month left failures behind');
  ok(h.manifest().run.skippedComplete >= 8, 'the receipt does not report the days Resume skipped');
  eq(h.census().uniqueIds, 4, 'the interrupted-then-resumed month duplicated appointments');
  range.revert();
}

/* ======================================================================== 3 ==
 * A browser CLOSE mid-month: a second page, same account, same storage.
 * ========================================================================== */
async function testBrowserCloseResumesInANewPage() {
  const store = new Map();
  const world = { backendRows: [], savedBodies: [], patients: [], seq: 0 };
  const first = makeMonthHarness({ today: '2026-03-15', store, world });
  first.seedDay('2026-02-06', 2);
  const rangeA = first.installRangeJobs();
  let closed = false;
  await rangeA.startMonth('2026-02', {
    provider: PROVIDER,
    onStatus: m => {
      const hit = String(m).match(/^Month pull (\d+)\/\d+: /);
      if (hit && Number(hit[1]) === 12 && !closed) { closed = true; rangeA.pause(); }
    }
  });
  /* simulate the close: this page never runs again. The manifest is the only
     thing that crosses. Put it back into the exact in-flight state a close
     leaves behind - "running", not "paused". */
  const key = first.manifestKey();
  const inFlight = JSON.parse(store.get(key));
  inFlight.status = 'running'; inFlight.reason = '';
  store.set(key, JSON.stringify(inFlight));
  const provedBeforeClose = Object.keys(inFlight.months['2026-02'].days)
    .filter(d => inFlight.months['2026-02'].days[d].status === 'complete');
  ok(provedBeforeClose.length >= 11, 'the fixture did not close the browser mid-month');
  rangeA.revert();

  const second = makeMonthHarness({ today: '2026-03-15', store, world });
  second.seedDay('2026-02-06', 2);
  const rangeB = second.installRangeJobs();
  const recovered = await rangeB.resume({ onStatus: () => {} });
  eq(recovered.complete, true, 'a job interrupted by a browser close could not be recovered');
  eq(second.gotoDates.filter(d => provedBeforeClose.includes(d)).length, 0,
    'the new page re-pulled days the closed page had already proved');
  eq(second.manifest().summary.complete, 28, 'the recovered month did not account for every day');
  eq(second.census().uniqueIds, 2, 'recovery after a browser close duplicated appointments');
  rangeB.revert();
}

/* ======================================================================== 4 ==
 * athenaOne sign-in expires mid-run: stop early, name the ONE cause, keep
 * every unproved day retryable, and recover on Resume.
 * ========================================================================== */
async function testLoginExpiryMidRun() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-02-02', 2);
  const tap = { calls: [], results: [] };
  tapMonth(h, tap);
  const range = h.installRangeJobs();

  let seen = 0;
  const result = await range.startMonth('2026-02', {
    provider: PROVIDER,
    onStatus: m => { if (/^Month pull \d+\/\d+: /.test(String(m))) { seen++; if (seen === 5) h.setLoginExpired(true); } }
  });
  /* p1-range-signout-1.0.0: the extension's bounded session probe turns an
     ambiguous `no-read` into a sign-in problem, so the job WAITS for a login
     instead of burning the month's retry budget. */
  eq(result.status, 'waiting-login', 'an athenaOne sign-out did not put the job in waiting-login');
  eq(result.reason, 'athena-session-expired',
    'the job does not name the sign-out (got ' + result.reason + ')');

  const states = dayStates(h.manifest(), '2026-02');
  const proved = states.filter(s => s.status === 'complete');
  eq(proved.length, 4, 'the four days proved before the sign-in expired were lost');
  const signedOut = states.filter(s => s.reason === 'athena-session-expired');
  eq(signedOut.length, 1, 'the sign-out was not confined to the one day that hit it');
  eq(signedOut[0].date, '2026-02-05', 'the sign-out was recorded on the wrong day');
  eq(signedOut[0].attempts, 0, 'a sign-out spent one of that day\'s three retry attempts');
  eq(states.filter(s => s.status === 'needs-attention').length, 0,
    'a sign-out pushed days past the attempt cap');
  eq(h.gotoDates.length, 5, 'the sweep kept driving Athena after athenaOne signed out');

  /* the doctor signs back in and presses Resume */
  h.setLoginExpired(false);
  const navBefore = h.gotoDates.length;
  const recovered = await range.resume({ onStatus: () => {} });
  eq(recovered.complete, true, 'the job did not finish after the sign-in was restored');
  eq(h.gotoDates.slice(navBefore).length, 24, 'Resume re-pulled days that were already proved');
  eq(h.manifest().summary.complete, 28, 'the recovered month did not account for every day');
  eq(h.manifest().run.skippedComplete, 4, 'the receipt cannot say what the recovery skipped');
  eq(h.census().uniqueIds, 2, 'recovery after a sign-in expiry duplicated appointments');
  range.revert();

  /* CONTROL: the SAME unreadable day WITHOUT the session probe must stay a
     retryable read failure, not a login wait - the classification is the
     probe, not the word "no-read". */
  const plain = makeMonthHarness({ today: '2026-03-15' });
  plain.scheduleErrorDays.add('2026-02-05');
  const plainRange = plain.installRangeJobs();
  const plainResult = await plainRange.startMonth('2026-02', { provider: PROVIDER, onStatus: () => {} });
  ok(plainResult.status !== 'waiting-login', 'a plain unreadable grid was mis-classified as a sign-out');
  const plainDay = dayStates(plain.manifest(), '2026-02').find(s => s.date === '2026-02-05');
  ok(plainDay.reason !== 'athena-session-expired', 'a plain read failure claimed athenaOne signed out');
  eq(plainDay.attempts, 3, 'a plain read failure did not spend its retry budget');
  plainRange.revert();
}

/* ======================================================================== 5 ==
 * The current month stops at TODAY: no future day is queued, navigated, or
 * given a chart or day-note read. dayfacts-1.0.0 changes only WHAT the elapsed
 * days do (they now open charts); the future boundary is unchanged and is now
 * measured on the chart lane too, which is where a regression would show.
 * ========================================================================== */
async function testNoFutureDayIsTouched() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-03-15', 2);
  h.seedDay('2026-03-09', 2);
  const range = h.installRangeJobs();
  const result = await range.startMonth('2026-03', { provider: PROVIDER, onStatus: () => {} });
  eq(result.complete, true, 'the elapsed part of the current month did not complete');

  const states = dayStates(h.manifest(), '2026-03');
  eq(states.length, 15, 'the current month queued ' + states.length + ' days; only 15 have happened');
  eq(states[states.length - 1].date, '2026-03-15', 'the queue did not reach today - the boundary is untested');
  eq(states.filter(s => s.date > '2026-03-15').length, 0, 'a future day was queued');
  eq(h.gotoDates.filter(d => d > '2026-03-15').length, 0, 'Athena was navigated to a future day');
  eq(h.noteCalls.filter(c => String(c.onlyDate) > '2026-03-15').length, 0, 'a day-note was read on a future day');
  /* dayfacts-1.0.0: the pin here used to be "OFF opened NO patient chart".
     OFF is now an abbreviated chart pass, so the honest replacement is
     exactly-one-open-per-elapsed-scheduled-row, still nothing on a future day
     and still nothing on a verified-empty day, and still zero VISIT BODIES -
     the unscoped all-visits verb, which is the read the checkbox governs. */
  eq(h.chartCalls.length, 4,
    'day-facts did not open one chart per elapsed scheduled row (got ' + h.chartCalls.length + ')');
  eq(h.chartCalls.filter(c => c.day === '2026-03-15').length, 2, 'today\'s two rows did not both get a chart open');
  eq(h.chartCalls.filter(c => c.day === '2026-03-09').length, 2, 'the past clinic day\'s rows did not both get a chart open');
  eq(h.chartCalls.filter(c => c.day > '2026-03-15').length, 0, 'a chart was opened on a future day');
  eq(h.chartCalls.filter(c => !['2026-03-09', '2026-03-15'].includes(c.day)).length, 0,
    'a chart was opened on a verified-empty day');
  eq(unscopedVisitsPosts(h).length, 0, 'Full Notes OFF issued the UNSCOPED all-visits walk');
  /* dfc-1.1.0: the scoped direct read obeys the same future boundary as the
     charts - one per ELAPSED scheduled row, never scoped past today. */
  eq(scopedVisitsPosts(h).length, 4,
    'day-facts did not post one scoped direct read per elapsed scheduled row (got ' + scopedVisitsPosts(h).length + ')');
  eq(scopedVisitsPosts(h).filter(m => m.hint.onlyDate === '2026-03-15').length, 2,
    'today\'s two rows did not both get a scoped direct read');
  eq(scopedVisitsPosts(h).filter(m => m.hint.onlyDate === '2026-03-09').length, 2,
    'the past clinic day\'s rows did not both get a scoped direct read');
  eq(scopedVisitsPosts(h).filter(m => String(m.hint.onlyDate) > '2026-03-15').length, 0,
    'a scoped direct read was posted for a FUTURE day');
  /* dayfacts-1.0.1 (was a measured gap under 1.0.0, see testWholeMonthReplay):
     one pulled-day onlyDate attempt per ELAPSED scheduled row - including
     today's own rows, which is the edge the future boundary sits against - and
     never one scoped to a day that has not happened. */
  eq(h.noteCalls.length, 4,
    'day-facts did not attempt one pulled-day note per elapsed scheduled row (got ' + h.noteCalls.length + ')');
  eq(h.noteCalls.filter(c => c.onlyDate === '2026-03-15').length, 2,
    'today\'s two rows did not both get a pulled-day note attempt');
  eq(h.noteCalls.filter(c => c.onlyDate === '2026-03-09').length, 2,
    'the past clinic day\'s rows did not both get a pulled-day note attempt');
  eq(new Set(h.noteCalls.map(c => c.patientId + '|' + c.onlyDate)).size, 4,
    'a row\'s pulled-day note was read twice');
  eq(h.noteCalls.filter(c => !['2026-03-09', '2026-03-15'].includes(String(c.onlyDate))).length, 0,
    'a pulled-day note was read unscoped, or on a day with no scheduled row');

  /* a future month cannot be started at all */
  await range.cancel();
  eq((await range.startMonth('2026-04', { provider: PROVIDER })).reason, 'invalid-range', 'a future month was accepted');
  range.revert();
}

/* ======================================================================== 6 ==
 * p1-range-daybound-1.0.0: the queue must not contain a day the importer's own
 * Eastern month bound will refuse, or the month can never complete.
 * ========================================================================== */
async function testAccountZoneAheadOfEasternStillCompletes() {
  /* 2026-03-16T16:00Z is 12:00 in New York on the 16th and 01:00 in Tokyo on
     the 17th: the account day and the importer's day disagree. */
  const h = makeMonthHarness({ today: '2026-03-16' });
  h.store.set('sf_u::' + h.account + '::acctTz', 'Asia/Tokyo');
  const tap = { calls: [], results: [] };
  tapMonth(h, tap);
  const range = h.installRangeJobs();
  const result = await range.startMonth('2026-03', { provider: PROVIDER, onStatus: () => {} });

  const states = dayStates(h.manifest(), '2026-03');
  eq(states[states.length - 1].date, '2026-03-16', 'the queue was not clamped to the day both sides agree on');
  eq(result.complete, true, 'a month whose account zone runs ahead of Eastern could not complete');
  eq(states.filter(s => s.status !== 'complete').length, 0, 'a queued day the importer refuses was left unfinishable');
  eq(tap.calls[0].dates.length, 16, 'the engine asked the importer for a day it would silently drop');

  const importerKeys = tap.results[0].days.map(d => d.date);
  eq(importerKeys.includes('2026-03-17'), false,
    'the importer accepted 2026-03-17 - the divergence this clamp exists for is gone, re-check the bound');
  range.revert();

  /* CAUSAL control: run the PRE-FIX bytes (account day alone) in the same
     fixture. The queue gains a seventeenth day, the real importer silently
     drops it from `dates`, so it is never checkpointed and the month can
     never complete - no matter how many times Resume is pressed. */
  const before = makeMonthHarness({ today: '2026-03-16' });
  before.store.set('sf_u::' + before.account + '::acctTz', 'Asia/Tokyo');
  const preFix = installPatchedRange(before,
    "createMonths(kind, target, queueBoundDayKey(), stamp)",
    "createMonths(kind, target, todayKey(), stamp)");
  const preResult = await preFix.startMonth('2026-03', { provider: PROVIDER, onStatus: () => {} });
  const preStates = dayStates(before.manifest(), '2026-03');
  eq(preStates.length, 17, 'the pre-fix control did not reproduce the extra day - the control proves nothing');
  eq(preResult.complete, false, 'the pre-fix control completed - the divergence is not what stalled the month');
  eq(preStates[preStates.length - 1].reason, 'not-attempted', 'the pre-fix control failed for some other reason');
  /* it can never converge: the day is dropped by the importer every time, so
     it is never even ATTEMPTED - it cannot complete and cannot reach the
     attempt cap either. Two Resumes, same stuck day. */
  await preFix.resume({});
  await preFix.resume({});
  const stuck = before.manifest().months['2026-03'].days['2026-03-17'];
  eq(stuck.status, 'retry', 'the pre-fix control settled the impossible day somehow');
  eq(stuck.reason, 'not-attempted', 'the pre-fix control failed for some other reason');
  ok(before.manifest().status !== 'complete', 'the pre-fix control eventually completed - it should never');
  preFix.revert();
}

/* ======================================================================== 7 ==
 * YEAR = months chained on the same checkpoints. October's failure must never
 * restart January, and pause/cancel must release everything.
 * ========================================================================== */
async function testYearIsMonthsChained() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-01-08', 2);
  h.seedDay('2026-02-11', 2);
  h.incompleteDays.add('2026-02-11');          /* February loses one day     */
  const tap = { calls: [], results: [] };
  tapMonth(h, tap);
  const range = h.installRangeJobs();

  const first = await range.startYear(2026, { provider: PROVIDER, onStatus: () => {} });

  /* p1-range-continue-1.0.0, the ruling: February losing a day must NOT stop
     March, and the range must come BACK to February at the end. */
  const monthOrder = tap.calls.map(c => c.month);
  eq(monthOrder.slice(0, 3).join(','), '2026-01,2026-02,2026-03',
    'a partial February stopped the year instead of continuing to March');
  eq(monthOrder.slice(3).join(','), '2026-02,2026-02',
    'the range did not come back to the retryable month at the end (got ' + monthOrder.slice(3).join(',') + ')');
  eq(tap.calls[3].dates.join(','), '2026-02-11', 'the February retry re-ran days it had already proved');
  eq(first.status, 'needs-attention', 'a bounded, settled year did not settle');

  const manifest = h.manifest();
  eq(Object.keys(manifest.months).sort().join(','), '2026-01,2026-02,2026-03', 'the year queued future months');
  eq(manifest.months['2026-01'].status, 'complete', 'January completion was not durable');
  eq(manifest.months['2026-03'].status, 'complete', 'March never ran because February failed');
  eq(manifest.months['2026-02'].status, 'needs-attention', 'the capped month is still claiming retryable work');
  eq(manifest.months['2026-02'].days['2026-02-11'].attempts, 3, 'the per-day attempt cap did not hold at 3');
  eq(manifest.summary.months, 3, 'the year receipt lost its month count');
  eq(manifest.summary.completeMonths, 2, 'the year receipt miscounted complete months');
  eq(manifest.summary.failed, 0, 'a capped day is still being reported as retryable');
  eq(manifest.summary.needsAttention, 1, 'the year receipt miscounted days needing attention');
  eq(manifest.summary.attention.map(a => a.date + ':' + a.reason).join(','), '2026-02-11:schedule-incomplete',
    'the year receipt does not LIST the day that needs attention');
  const januaryNav = h.gotoDates.filter(d => d.slice(0, 7) === '2026-01').length;
  eq(januaryNav, 31, 'January was not pulled exactly once');
  eq(h.gotoDates.filter(d => d === '2026-02-11').length, 3, 'the failing day was not retried exactly to the cap');

  /* the failure recovers: an explicit Resume re-arms exactly that day */
  h.incompleteDays.clear();
  const callsBefore = tap.calls.length;
  const done = await range.resume({ onStatus: () => {} });
  eq(done.complete, true, 'the year did not finish after its one failed day recovered');
  const retried = tap.calls.slice(callsBefore);
  eq(retried.map(c => c.month).join(','), '2026-02', 'the resume restarted a completed month');
  eq(retried[0].dates.join(','), '2026-02-11', 'the resume re-ran days it had already proved');
  eq(h.gotoDates.filter(d => d.slice(0, 7) === '2026-01').length, januaryNav,
    'January restarted because February failed');
  eq(h.manifest().summary.completeMonths, 3, 'the finished year does not report three complete months');
  eq(h.manifest().summary.days, 31 + 28 + 15, 'the year receipt lost days');
  eq(h.manifest().summary.needsAttention, 0, 'the recovered year still lists a day needing attention');
  eq(h.census().uniqueIds, 4, 'the chained year duplicated appointments');
  eq(h.locksHeld().length, 0, 'the finished year still holds a Web Lock');
  eq(h.store.has(h.monthOwnerKey()), false, 'the finished year left the month-owner record held');
  range.revert();
}

/* ======================================================================== 7b =
 * The other half of the ruling: continuing past a PARTIAL month is right, but
 * continuing past a second month that died the SAME systemic way would just
 * machine-gun Athena. Two in a row stops the range and names the one cause.
 * ========================================================================== */
async function testTwoSystemicMonthsStopTheRange() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  /* every day of January and February fails its schedule read the same way */
  for (let d = 1; d <= 31; d++) {
    h.scheduleErrorDays.add('2026-01-' + String(d).padStart(2, '0'));
    if (d <= 28) h.scheduleErrorDays.add('2026-02-' + String(d).padStart(2, '0'));
  }
  const tap = { calls: [], results: [] };
  tapMonth(h, tap);
  const range = h.installRangeJobs();
  const result = await range.startYear(2026, { provider: PROVIDER, onStatus: () => {} });

  eq(tap.calls.map(c => c.month).join(','), '2026-01,2026-02',
    'the range kept walking months that were all dying the same way');
  eq(result.status, 'waiting-retry', 'a systemic outage settled the year instead of leaving it resumable');
  eq(result.reason, 'no-read', 'the range did not name the ONE systemic cause (got ' + result.reason + ')');
  eq(h.manifest().months['2026-03'].status, 'pending', 'March was consumed by the systemic stop');
  /* the importer's own 3-strike breaker still bounds each month */
  eq(h.gotoDates.length, 6, 'the range drove Athena more than three days per systemic month');
  range.revert();
}

/* ======================================================================== 8 ==
 * Cancel is terminal, releases everything, and destroys no clinical data.
 * ========================================================================== */
async function testCancelIsCleanAndReleasesTheLease() {
  const h = makeMonthHarness({ today: '2026-03-15' });
  h.seedDay('2026-02-03', 2);
  const range = h.installRangeJobs();
  let cancelledAt = '';
  const result = await range.startYear(2026, {
    provider: PROVIDER,
    onStatus: m => {
      const hit = String(m).match(/^Month pull (\d+)\/\d+: (\d{4}-\d{2}-\d{2})$/);
      if (hit && Number(hit[1]) === 6 && !cancelledAt) { cancelledAt = hit[2]; range.cancel(); }
    }
  });
  eq(result.status, 'cancelled', 'the settling job overwrote the cancelled state');
  eq(h.manifest().status, 'cancelled', 'cancel did not checkpoint a terminal state');
  eq(h.locksHeld().length, 0, 'a cancelled job still holds a Web Lock');
  eq(h.store.has(h.monthOwnerKey()), false, 'a cancelled job left the month-owner record held');
  eq(h.gotoDates.filter(d => d > cancelledAt).length, 0, 'Athena was navigated after Cancel');
  ok(h.census().uniqueIds >= 0 && h.patients.length === 24, 'cancel deleted patient records');
  eq((await range.resume({})).reason, 'cancelled', 'a cancelled job restarted without an explicit new job');
  /* an explicit new job is admitted after a terminal one */
  const restarted = await range.startMonth('2026-02', { provider: PROVIDER, onStatus: () => {} });
  eq(restarted.complete, true, 'an explicit new pull was refused after a cancel');
  range.revert();
}

async function main() {
  testAssetIsP1Only();
  await testWholeMonthReplay();
  await testPreFixFlattensEveryFailureReason();
  await testUnchosenPreferenceBlocksEveryRead();
  await testPreDayfactsOffMonthOpenedNoChart();
  await testPreDayfactsDayNoteFusesReadNoNote();
  await testStopAfterDayNineAndResume();
  await testBrowserCloseResumesInANewPage();
  await testLoginExpiryMidRun();
  await testNoFutureDayIsTouched();
  await testAccountZoneAheadOfEasternStillCompletes();
  await testYearIsMonthsChained();
  await testTwoSystemicMonthsStopTheRange();
  await testCancelIsCleanAndReleasesTheLease();
  console.log('PASS 1p-rangejobs-harness-runtime: ' + checks + ' checks - a whole synthetic month and year replayed through the REAL /1p importer under the REAL range engine. dayfacts-1.0.1 (owner 2026-08-25) is now the pinned contract: Full-visit-notes OFF is an ABBREVIATED CHART PASS, not schedule-only - every exact scheduled row gets one identity-verified chart open and a chart-facts save that the store census proves landed, the day settles on the plain `complete` verdict (the revoked `complete-schedule-only` is pinned dead), the receipt declares visitNotesMode day-facts / chartFactsRequired / allVisitBodiesRequested false / insuranceAttempted 0 reader-not-shipped, every row reports visitsSkipped, ZERO unscoped all-visits reads are issued (dfc-1.1.0: the exact-day read rides the SAME bridge verb scoped by hint.onlyDate, so the retired zero-mlsAppReadAllVisits fuse is re-expressed as zero UNSCOPED posts, with exactly one scoped direct-read attempt per row per account day - deduped by dnAlreadyReadToday on the repeat pull - carrying the pulled day, the row identity and the account todayKey on the wire, following the recovered day on resume and the future/empty-day boundary everywhere), the typed per-row allHistoryReceipt is the ONE legitimate home of not-requested, and no chart is opened on a verified-empty, unreadable, or future day; a causal control boots the pre-dayfacts month gate over the same fixture and gets the old world back whole (0 charts, 0 stored facts, complete-schedule-only), so those pins measure the engine and not the harness. The clause that stood UNMET under dayfacts-1.0.0 - the pulled-day encounter note - is now SHIPPED and PROVED rather than tolerated: both day-note lanes are un-fused (1p-feat_mls_schedimport_exact.js:5615 inline fold-in, :6172 tn/onlyDate tail catch-up, and the byte pins now fail if either is re-fused), and under dfc-1.1.0 the scoped BRIDGE read goes first: this fixture\'s legacy reader answers it with EVERY body and no scoped receipt, so the engine is measured refusing it closed (sameDayDirectReason scoped-read-unsupported-by-reader, todayNoteDirectBridge never claimed, the 2025-12-01 historical body in that refused answer NEVER persisted) and falling back to exactly ONE vp.runForPatient read SCOPED to the day being pulled, on exactly the rows whose charts day-facts opened, never twice and never unscoped - 3 on the readable day, 4 more scoped to the RECOVERED day on resume and none re-read on the day already proved, 2+2 across a past clinic day and today with nothing on a future day - and the receipts agree with the wire (todayNoteRead = rows, todayNoteFailures 0, chartOpens.dayNote = rows, todayNote true on every row). The revoked checkbox short-circuit that reported todayNoteNotRequested = rows on an OFF pull is pinned dead everywhere, surviving at exactly ONE door - blocked-unchosen - which is pinned positively so it cannot creep back as a default; the month result envelope reports visitNotesMode day-facts and the WHOLE envelope - minus only the typed athena-all-history-v1 receipt, which is pinned positively in its place - is scanned for the retired not-requested / visit-notes-off / full-notes-off vocabulary. A second causal control re-fuses those two switch bytes over the same harness and measures the old gap back whole at both the batch and month doors (0 onlyDate reads, todayNote null, chartOpens.dayNote 0) while pinning that the chart pass, the mode, the skip and the verdict are UNCHANGED - so the day-note counts measure those two lanes and not the fixture. An UNCHOSEN preference still fails closed at both doors (blocked-unchosen receipt with zero chart, note and navigation reads at the batch seam, a refused visit-notes-choice gate with no manifest and no navigation at the range door) while a SETTLED-off account runs day-facts and gets its pulled-day note, the revoked visit-notes-off no-op staying dead. The pre-existing range contract is unchanged and still measured: every day checkpoints durably with its OWN verdict (empty-day / history-partial / schedule-incomplete, no longer one generic code); a failing day is retried to a cap of 3 and then settles as needs-attention, listed on the receipt with its reason, so one bad day never blocks a later month and never spins forever; February failing does not stop March and never restarts January; two months dying the same systemic way DO stop the range and name that cause; an athenaOne sign-out is classified by the extension\'s bounded session probe into waiting-login without spending a retry (a probe-less unreadable grid still is not); Pause after day 9, a browser close, and a login recovery all resume without re-pulling one proved day; a repeat month pull adds no duplicate appointment or patient; and the queue is clamped to the day the importer itself will accept');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-rangejobs-harness-runtime did not finish')); process.exit(1); }, 600000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });

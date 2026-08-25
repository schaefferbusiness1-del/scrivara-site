'use strict';
/* =============================================================================
 * day-note-foldin-contract.test.js
 *
 * CONTRACT: dayfacts-1.0.1 (owner 2026-08-25, Codex-accepted) - the superseding
 * DAY contract. Round 1 of this suite pinned dayfacts-1.0.0 and recorded an
 * OPEN ENGINE GAP: both pulled-day-note lanes were hard-fused off, so a
 * day-facts pull performed ZERO date-scoped note reads. That gap is CLOSED.
 * The pins below no longer tolerate the fold-in; they PROVE it runs.
 *
 * The Full-visit-notes checkbox selects HOW MUCH history a bulk pull reads,
 * never WHETHER charts open and never whether the pulled day's OWN note is
 * read:
 *
 *   OFF   = DAY-FACTS mode. The per-patient history batch RUNS. Every exact
 *           scheduled row gets its identity-verified chart open, its
 *           chart-facts save, AND exactly one date-scoped read of the PULLED
 *           DAY's encounter note (vp.runForPatient({onlyDate: <pulled day>}));
 *           only the OTHER dated historical bodies are out of scope
 *           (one.visitsSkipped === true). Receipt: visitNotesMode "day-facts",
 *           chartFactsRequired true, allVisitBodiesRequested false, a real
 *           per-row day-note census (todayNoteRead / todayNoteFailures /
 *           todayNoteNotRequested === 0), plus the honest insurance
 *           placeholders. The old schedule-only no-op receipt
 *           ("visit-notes-off" / "full-notes-off") is GONE and must never be
 *           reasserted - not as a receipt reason, and not as a per-row
 *           todayNoteReason.
 *   ON    = the same mandatory floor PLUS the full historical traversal, run
 *           through the ordinary UNSCOPED all-visits verb (visitNotesMode
 *           "full", allVisitBodiesRequested true). ON takes its bodies from
 *           that traversal, so the date-scoped fold-in must NOT also fire.
 *   UNSET = fail-closed. The batch returns a BLOCKED receipt: reason
 *           "visit-notes-unchosen", visitNotesMode "blocked-unchosen", zero
 *           chart reads, zero note reads. This is the ONLY door that may
 *           report day-notes as not-requested.
 *   STOP  = a stopped row's unread note is stamped todayNote false /
 *           todayNoteReason "stopped-by-user" in BOTH modes. The revoked
 *           "visit-notes-off" stamp vocabulary is gone from that path.
 *
 * includeHistory is decoupled from the checkbox: it now means "run the batch
 * at all" (only the census phase-1 caller passes false) and a day pull
 * defaults it to TRUE, so an OFF pull that omits it still opens charts and
 * still reads the pulled day's note.
 *
 * mls-connect's __mlsVisitSavePref.runForPatient admits an onlyDate-scoped
 * read (well-formed YYYY-MM-DD) whenever the preference is SETTLED (on OR
 * off); unscoped reads still require ON; unset gets skipped:'preference-
 * unchosen'; settled-off unscoped gets skipped:'preference-off'.
 * ========================================================================== */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeHarness, makeMonthHarness, flush } = require('./1p-pull-harness.js');

const root = path.resolve(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

async function main() {
  const day = '2026-08-23';
  const today = '2026-08-24';

  /* ======================================================================
     1. SOURCE PINS - the dayfacts shape exists in the production twin
     ====================================================================== */
  ok(si.includes('visitNotesMode: visitNotesRequested ? "full" : "day-facts"'),
    'the batch receipt no longer labels an OFF pull day-facts');
  ok(si.includes('var chartFactsRequired = true;'),
    'the chart-facts floor is no longer unconditional');
  ok(si.includes('var allVisitBodiesRequested = visitNotesRequested;'),
    'the checkbox no longer maps to the historical-bodies scope alone');
  ok(si.includes('insuranceAttempted: 0, insuranceComplete: false, benefitsComplete: false, insuranceReason: "reader-not-shipped"'),
    'the honest insurance placeholders are gone - a missing reader must never read as verified-none');
  ok(si.includes('receipt.reason = "visit-notes-unchosen";') &&
     si.includes('receipt.visitNotesMode = "blocked-unchosen";'),
    'the fail-closed unchosen receipt is missing');
  ok(si.includes('if (runOpts.includeHistory === undefined) runOpts.includeHistory = true;'),
    'a day pull no longer defaults includeHistory to true - the mandatory floor would not run');

  /* ======================================================================
     2. BOTH PULLED-DAY-NOTE LANES ARE LIVE (dayfacts-1.0.1)
     ----------------------------------------------------------------------
     Round 1 pinned these two literals as `false` and documented the gap.
     They are now `true` and the pins DEMAND it: the inline fold-in reads the
     pulled day's note while the row's chart is open, and the tail pass is
     the catch-up for rows the fold-in never reached. Re-fusing either lane
     lands here.
     ====================================================================== */
  ok(si.includes('var pulledDayNoteLaneEnabled = true;'),
    'the inline pulled-day-note fold-in is fused off again - dayfacts-1.0.1 makes it mandatory');
  ok(si.includes('var pulledDayNoteTailEnabled = true;'),
    'the tail pulled-day-note pass is fused off again - dayfacts-1.0.1 makes it mandatory');
  ok(!/var pulledDayNote(?:Lane|Tail)Enabled = false;/.test(si),
    'a pulled-day-note lane flag was reintroduced as false');

  /* the fold-in's own guard is what keeps it OFF-mode-only; ON takes its
     bodies from the unscoped traversal and must not double-read. */
  ok(si.includes('if (pulledDayNoteLaneEnabled && !stopAfterTimeout && pullVisitBodies !== true && one.visitsSkipped === true && rd && !inlineDayNoteFuse) {'),
    'the inline fold-in guard moved - it must stay scoped to visits-skipped rows in OFF mode');
  ok(si.includes('if (pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped) {'),
    'the tail pass guard moved - it must stay OFF-mode-only and must not run after a stop');

  /* ---- the checkbox short-circuit is GONE from the day-note census ------
     tnAggregate used to answer "not requested" for every day-facts row the
     moment receipt.visitNotesRequested !== true, which is how an OFF pull
     could report a clean note lane it never ran. The real per-row tally now
     runs in both modes and the ONLY not-requested door is blocked-unchosen. */
  const aggStart = si.indexOf('function tnAggregate() {');
  const aggEnd = si.indexOf('function tnBatchDay()', aggStart);
  ok(aggStart > 0 && aggEnd > aggStart, 'tnAggregate boundary moved');
  const agg = si.slice(aggStart, aggEnd);
  ok(!/visitNotesRequested/.test(agg),
    'tnAggregate reads the checkbox again - the day-note census must be mode-blind');
  ok(/receipt\.todayNoteNotRequested = 0;/.test(agg),
    'tnAggregate no longer zeroes todayNoteNotRequested - a day-facts row can be reported unrequested again');

  /* ---- the revoked stamp vocabulary is gone from every row-level path --- */
  ok(!/todayNoteReason\s*=\s*["'](?:visit-notes-off|full-notes-off|not-requested|visit-notes-not-requested)["']/.test(si),
    'a row-level todayNoteReason still carries the revoked schedule-only vocabulary');
  ok(!/receipt\.reason\s*=\s*["'](?:visit-notes-off|full-notes-off)["']/.test(si),
    'the batch receipt can still report the revoked schedule-only reason');

  /* ---- the stop path stamps the honest reason in BOTH modes ------------- */
  const stopStart = si.indexOf('var __stpStopped = receipt.stoppedByUser === true');
  const stopEnd = si.indexOf('var pulledDayNoteTailEnabled', stopStart);
  ok(stopStart > 0 && stopEnd > stopStart, 'the stp-2.0.0 stop block boundary moved');
  const stopBlock = si.slice(stopStart, stopEnd);
  ok(/p\.todayNote = false;/.test(stopBlock) && /p\.todayNoteReason = "stopped-by-user";/.test(stopBlock),
    'the stop path no longer stamps stopped rows with the honest stopped-by-user reason');
  ok(!/todayNoteReason\s*=\s*["'](?:visit-notes-off|full-notes-off)["']/.test(stopBlock),
    'the stop path reasserted the revoked visit-notes-off stamp');
  ok(/if \(!p \|\| p\.visitsSkipped !== true \|\| p\.todayNote != null\) return;/.test(stopBlock),
    'the stop stamper no longer guards on an already-decided day note - it would overwrite a real read');

  /* ---- EVERY TWIN, not just the one the harness happens to run ---------
     The suite greps the production twin but EXECUTES the 1p twin, so a
     one-twin edit could pass both halves while shipping a fused lane to the
     other lane's users. The dayfacts fold-in literals are pinned identical
     across all three twins that ship. */
  ['1p-feat_mls_schedimport_exact.js', 'cloned-feat_mls_schedimport_exact.js'].forEach(function (twin) {
    const twinPath = path.join(root, twin);
    ok(fs.existsSync(twinPath), twin + ' is missing - the dayfacts lane cannot be verified for that lane');
    const tw = fs.readFileSync(twinPath, 'utf8');
    ok(tw.includes('var pulledDayNoteLaneEnabled = true;'),
      twin + ' still fuses the inline pulled-day-note fold-in off');
    ok(tw.includes('var pulledDayNoteTailEnabled = true;'),
      twin + ' still fuses the tail pulled-day-note pass off');
    ok(tw.includes('p.todayNoteReason = "stopped-by-user";'),
      twin + ' lost the honest stopped-by-user day-note stamp');
    ok(tw.includes('receipt.todayNoteNotRequested = 0;'),
      twin + ' can still report a day-facts row as not-requested');
    ok(!/todayNoteReason\s*=\s*["'](?:visit-notes-off|full-notes-off|not-requested)["']/.test(tw),
      twin + ' carries the revoked schedule-only day-note vocabulary');
  });

  /* ---- the legacy mls-connect crawler is NOT the dayfacts lane ---------- */
  const legacyStart = mc.indexOf('var fullLeg = Promise.resolve();');
  const legacyEnd = mc.indexOf('} catch (eV) {}', legacyStart);
  ok(legacyStart > 0 && legacyEnd > legacyStart, 'legacy history helper boundary moved');
  const legacy = mc.slice(legacyStart, legacyEnd);
  ok(!/onlyDate/.test(legacy), 'the legacy helper grew a date-scoped read it is not the lane for');

  /* the legacy _pullAllHistories wrapper still refuses without ON, but its
     refusal is scoped to HISTORICAL bodies - it may never claim that an OFF
     pull opens no charts or reads no day note. */
  const wrapStart = mc.indexOf("/* corrected _pullAllHistories: per-patient progress + retry + honest tally */");
  const wrapEnd = mc.indexOf('return (function run(list, isRetry) {', wrapStart);
  ok(wrapStart > 0 && wrapEnd > wrapStart, 'the legacy _pullAllHistories wrapper boundary moved');
  const wrap = mc.slice(wrapStart, wrapEnd);
  ok(wrap.includes("reason: 'historical-bodies-not-requested'"),
    'the legacy wrapper lost the truthful historical-bodies-only refusal reason');
  ok(!/reason:\s*'(?:visit-notes-off|full-notes-off)'/.test(wrap),
    'the legacy wrapper reasserted the revoked schedule-only refusal reason');
  ok(!/no charts? (?:were|was) opened|schedule[- ]only/i.test(wrap),
    'the legacy wrapper tells the doctor an OFF pull opens no charts');

  /* ======================================================================
     3. mls-connect's admission gate, EXECUTED (never grepped)
     ====================================================================== */
  {
    const enStart = mc.indexOf('function enabled() { /* qol-2.0 ONE RESOLVER');
    ok(enStart > 0, 'the ONE RESOLVER enabled() delegate moved');
    const enabledSrc = mc.slice(enStart, mc.indexOf('\n', enStart));
    const runStart = mc.indexOf('api.runForPatient = function (p, onStatus, runOpts) {');
    const runEnd = mc.indexOf('function ensureSettings', runStart);
    ok(runStart > 0 && runEnd > runStart, 'runForPatient block missing');
    const block = mc.slice(runStart, runEnd);

    const cvCalls = [];
    let pref = { state: 'unset', on: false, settled: false };
    const ctx = vm.createContext({
      api: { running: false, current: null },
      Promise, Error,
      window: {
        __mlsVisitNotesPref: { read: () => pref },
        __mlsCopyVisits: { run: (_say, _p, opts) => { cvCalls.push(opts || null); return Promise.resolve(3); } }
      }
    });
    vm.runInContext(enabledSrc + '\n' + block, ctx);
    const P = { id: 'syn-01', name: 'Synthetic Row 01' };
    const reset = () => { ctx.api.running = false; ctx.api.current = null; };

    let r = await ctx.api.runForPatient(P, null, { onlyDate: day });
    eq(r && r.skipped, 'preference-unchosen', 'an UNSET account admitted a day-scoped read');
    reset();

    pref = { state: 'off', on: false, settled: true };
    r = await ctx.api.runForPatient(P, null, {});
    eq(r && r.skipped, 'preference-off', 'settled-OFF admitted an UNSCOPED every-body read');
    reset();

    r = await ctx.api.runForPatient(P, null, { onlyDate: 'not-a-date' });
    eq(r && r.skipped, 'preference-off', 'a malformed onlyDate was treated as day-scoped');
    reset();

    eq(cvCalls.length, 0, 'a refused call still reached the visit reader');

    r = await ctx.api.runForPatient(P, null, { onlyDate: day });
    ok(r && r.ok === true && r.skipped == null,
      'settled-OFF refused the mandatory pulled-day encounter-note read');
    eq(cvCalls.length, 1, 'the day-scoped read did not reach cv.run exactly once');
    eq(cvCalls[0] && cvCalls[0].onlyDate, day, 'onlyDate was not forwarded to cv.run');
    reset();

    pref = { state: 'on', on: true, settled: true };
    r = await ctx.api.runForPatient(P, null, {});
    ok(r && r.ok === true && r.skipped == null, 'ON refused the unscoped every-body read');
    eq(cvCalls.length, 2, 'ON did not reach cv.run');
    ok(cvCalls[1] && cvCalls[1].onlyDate == null, 'the ON walk was silently date-scoped');
    reset();

    /* the UNSCOPED door is no softer than the day-scoped one. enabled() now
       requires choice.settled === true as well as state/on, so a half-written
       or racing choice that reads on-but-unsettled is refused on BOTH doors -
       it may never be laundered into an every-body read, and it may not buy
       the day-scoped read the settled modes get either. */
    pref = { state: 'on', on: true, settled: false };
    r = await ctx.api.runForPatient(P, null, {});
    eq(r && r.skipped, 'preference-unchosen',
      'an ON-but-UNSETTLED preference opened the unscoped every-body door');
    reset();
    r = await ctx.api.runForPatient(P, null, { onlyDate: day });
    eq(r && r.skipped, 'preference-unchosen',
      'an ON-but-UNSETTLED preference admitted a day-scoped read');
    reset();
    eq(cvCalls.length, 2, 'an unsettled preference reached the visit reader');
  }

  /* ======================================================================
     4. OFF AT RUNTIME = DAY-FACTS: charts open, the PULLED DAY's note is
        read once per row, historical bodies are not walked
     ====================================================================== */
  const off = makeMonthHarness({ today: today });
  off.seedDay(day, 3);
  const offResult = await off.api.pull({ date: day, provider: off.provider,
    includeHistory: true, pullVisitBodies: false, onStatus: off.onStatus });
  const offReceipt = offResult.historyReceipt || {};

  eq(off.chartCalls.length, 3, 'day-facts mode did not open one chart per exact scheduled row');
  eq(off.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'day-facts mode walked historical visit bodies');
  eq(offResult.ok, true, 'a day-facts pull could not reach a complete verdict');
  eq(offResult.reason, 'complete', 'a day-facts pull did not report itself complete');

  eq(offReceipt.visitNotesMode, 'day-facts', 'the OFF receipt lost its day-facts label');
  eq(offReceipt.chartFactsRequired, true, 'the OFF receipt dropped the mandatory chart-facts floor');
  eq(offReceipt.allVisitBodiesRequested, false, 'the OFF receipt claims historical bodies were requested');
  eq(offReceipt.visitNotesRequested, false, 'the OFF receipt mislabels the checkbox');
  eq(offReceipt.requested, 3, 'the OFF receipt did not request every scheduled row');
  eq(offReceipt.processed, 3, 'the OFF receipt did not process every scheduled row');
  eq(offReceipt.failures, 0, 'a clean day-facts pull reported failures');
  eq(offReceipt.skipped, undefined, 'the revoked schedule-only skip receipt is back');
  ok(offReceipt.reason !== 'visit-notes-off' && offReceipt.reason !== 'full-notes-off',
    'the revoked schedule-only no-op reason (' + String(offReceipt.reason) + ') is back');

  /* honest placeholders, not a fabricated verified-none */
  eq(offReceipt.insuranceAttempted, 0, 'the OFF receipt claims insurance reads that no reader performs');
  eq(offReceipt.insuranceComplete, false, 'the OFF receipt calls a missing insurance reader complete');
  eq(offReceipt.benefitsComplete, false, 'the OFF receipt calls a missing benefits reader complete');
  eq(offReceipt.insuranceReason, 'reader-not-shipped', 'the OFF receipt lost its honest insurance reason');

  /* every row: chart open + facts save proven, historical traversal skipped */
  eq((offReceipt.patients || []).length, 3, 'the OFF receipt does not account for every row');
  ok((offReceipt.patients || []).every(p => p && p.visitsSkipped === true),
    'a day-facts row did not record visitsSkipped - historical traversal was not skipped');
  ok((offReceipt.patients || []).every(p => p && p.identityVerified === true),
    'a day-facts chart open was not identity-verified');
  ok((offReceipt.patients || []).every(p => p && p.chartCoverage && p.chartCoverage.complete === true),
    'a day-facts row has no chart-coverage receipt - the chart open is unproven');
  ok((offReceipt.patients || []).every(p => p && p.profileCoverage && p.profileCoverage.complete === true),
    'a day-facts row did not save its chart facts');
  ok(off.patients.slice(0, 3).every(p => p && p.athenaChartSnapshot),
    'the store holds no chart facts after a day-facts pull');
  ok(off.patients.slice(0, 3).every(p => (p.visits || []).length === 0),
    'a day-facts pull wrote historical visit bodies into the store');

  /* --- the pulled-day note is READ, not tolerated (dayfacts-1.0.1) -------
     Round 1 could only pin "the receipt never claims a read it did not
     make". The lanes are live now, so the pins demand the reads. */
  eq(off.noteCalls.length, 3,
    'day-facts mode did not perform exactly one pulled-day note read per scheduled row');
  ok(off.noteCalls.every(c => c && c.onlyDate === day),
    'a day-facts note read was not scoped to the PULLED day (' + day + '): ' +
    JSON.stringify(off.noteCalls.map(c => c && c.onlyDate)));
  ok(off.noteCalls.every(c => c && c.onlyDate !== today),
    'a day-facts note read used the account TODAY instead of the pulled day');
  eq(new Set(off.noteCalls.map(c => String(c && c.patientId))).size, 3,
    'the day-facts note reads did not cover three distinct patients');

  eq(Number(offReceipt.todayNoteRead || 0), 3,
    'the OFF receipt does not report the three pulled-day notes it read');
  eq(Number(offReceipt.todayNoteRead || 0), off.noteCalls.length,
    'the OFF receipt disagrees with the reads the engine actually performed');
  eq(Number(offReceipt.todayNoteFailures || 0), 0,
    'a clean day-facts pull reported pulled-day note failures');
  eq(Number(offReceipt.todayNoteNotRequested || 0), 0,
    'a day-facts pull reported its mandatory day notes as not-requested - the revoked short-circuit is back');
  eq(Number(offReceipt.todayNoteAttempts || 0), 3,
    'the OFF receipt does not count one day-note attempt per row');
  eq(Number(offReceipt.todayNoteRead || 0) +
     Number(offReceipt.todayNoteNotRequested || 0) +
     Number(offReceipt.todayNoteFailures || 0), 3,
    'the OFF day-note census does not account for every row exactly once');
  eq(Number(offReceipt.todayNoteUnreadFinal || 0), 0,
    'a clean day-facts pull left a pulled-day note unread');

  ok((offReceipt.patients || []).every(p => p && p.todayNote === true),
    'a day-facts row did not record a successful pulled-day note read: ' +
    JSON.stringify((offReceipt.patients || []).map(p => p && p.todayNote)));
  ok((offReceipt.patients || []).every(p => p && p.dayNoteChartOpen === true),
    'a day-facts row read its note without the evidence that its chart was opened first');
  ok((offReceipt.patients || []).every(p => Number(p && p.todayNoteAttempts || 0) === 1),
    'a day-facts row was attempted more than once - the fold-in and the tail pass double-read');
  ok((offReceipt.patients || []).every(p => !p ||
      (p.todayNoteReason !== 'visit-notes-off' && p.todayNoteReason !== 'full-notes-off' &&
       p.todayNoteReason !== 'not-requested')),
    'a day-facts row carries the revoked schedule-only day-note reason');

  /* no user-facing line may claim OFF opened nothing */
  const offLines = off.statusLines.join('\n');
  ok(!/schedule[- ]only/i.test(offLines),
    'a day-facts pull still tells the doctor it was schedule-only');
  ok(!/history was not requested|no charts? (?:were|was) opened|chart history was intentionally skipped/i.test(offLines),
    'a day-facts pull claims history it actually read was not requested');

  /* ======================================================================
     5. THE FOLD-IN IS A FOLD-IN: the note is read WHILE the chart is open
     ----------------------------------------------------------------------
     The whole point of the inline lane is that the pulled day's note rides
     the chart open that just happened, rather than costing a second pass of
     re-opens. makeHarness stamps a shared monotonic `seq` on chart and note
     reads, so the interleaving is observable rather than inferred.
     ====================================================================== */
  {
    const fold = makeHarness({ day: day, today: today, rows: 3 });
    const foldReceipt = await fold.api._runHistoryBatch(fold.rows, [], fold.onStatus, {});

    eq(foldReceipt.visitNotesMode, 'day-facts', 'the direct batch call did not run in day-facts mode');
    eq(fold.noteCalls.length, 3, 'the fold-in did not read one pulled-day note per row');
    ok(fold.noteCalls.every(c => c && c.onlyDate === day),
      'a fold-in note read was not scoped to the pulled day');

    /* the first chart read for a patient must precede that patient's note
       read, and the note read must land BEFORE the next patient's chart. */
    const firstChart = new Map();
    fold.chartCalls.forEach(c => {
      const k = String(c && c.patientId);
      if (!firstChart.has(k)) firstChart.set(k, c.seq);
    });
    fold.noteCalls.forEach(n => {
      const k = String(n && n.patientId);
      ok(firstChart.has(k), 'a pulled-day note was read for a patient whose chart was never opened: ' + k);
      ok(Number(n.seq) > Number(firstChart.get(k)),
        'the fold-in read ' + k + '’s note BEFORE its chart was opened');
    });
    const orderedNotes = fold.noteCalls.map(n => Number(n.seq));
    const orderedFirstCharts = fold.rows.map(r => Number(firstChart.get(String(r._mlsTargetPatientId))));
    for (let i = 0; i + 1 < orderedFirstCharts.length; i++) {
      ok(orderedNotes[i] < orderedFirstCharts[i + 1],
        'row ' + i + '’s note read did not fold into its own chart visit - it landed after the next chart open');
    }

    /* attempt-once: the tail pass may not re-open a row the fold-in settled,
       and a post-batch sweep may re-read the CHART without re-reading the
       note. */
    eq(Number(foldReceipt.todayNoteAttempts || 0), 3,
      'the fold-in did not record exactly one day-note attempt per row');
    ok(fold.chartCalls.length > fold.noteCalls.length,
      'the fixture no longer exercises a post-batch chart re-read - attempt-once is unproven');
    eq(fold.noteCalls.length, 3,
      'a re-read of the chart dragged a second pulled-day note read along with it');
    await flush(3);
  }

  /* ======================================================================
     6. includeHistory IS DECOUPLED FROM THE CHECKBOX
     ====================================================================== */
  const bare = makeMonthHarness({ today: today });
  bare.seedDay(day, 2);
  const bareResult = await bare.api.pull({ date: day, provider: bare.provider,
    pullVisitBodies: false, onStatus: bare.onStatus });
  eq(bareResult.includeHistory, true, 'an OFF day pull that omits includeHistory no longer defaults it to true');
  eq(bare.chartCalls.length, 2, 'an OFF day pull that omits includeHistory skipped the mandatory chart opens');
  eq((bareResult.historyReceipt || {}).visitNotesMode, 'day-facts',
    'the omitted-includeHistory OFF pull did not run in day-facts mode');
  eq(bare.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'the omitted-includeHistory OFF pull walked historical bodies');
  eq(bare.noteCalls.length, 2,
    'the omitted-includeHistory OFF pull skipped the mandatory pulled-day note reads');
  ok(bare.noteCalls.every(c => c && c.onlyDate === day),
    'the omitted-includeHistory OFF pull read an unscoped body instead of the pulled day');
  eq(Number((bareResult.historyReceipt || {}).todayNoteRead || 0), 2,
    'the omitted-includeHistory OFF receipt does not report its pulled-day note reads');

  /* ======================================================================
     7. ON = the same floor PLUS one UNSCOPED all-visits walk per patient,
        and NO date-scoped fold-in on top of it
     ====================================================================== */
  const on = makeMonthHarness({ today: today });
  on.seedDay(day, 2);
  const onResult = await on.api.pull({ date: day, provider: on.provider,
    includeHistory: true, pullVisitBodies: true, onStatus: on.onStatus });
  const onReceipt = onResult.historyReceipt || {};
  const bodyReads = on.posted.filter(message => message.type === 'mlsAppReadAllVisits');

  eq(on.chartCalls.length, 2, 'ON skipped the mandatory chart open floor');
  eq(bodyReads.length, 2, 'ON did not read both patients through the all-visits lane');
  ok(bodyReads.every(message => !(message.hint && message.hint.onlyDate)),
    'ON date-scoped its historical walk instead of reading every body');
  eq(on.noteCalls.length, 0, 'ON duplicated the body walk through the date-scoped fold-in');
  eq(onReceipt.visitNotesMode, 'full', 'the ON receipt lost its full label');
  eq(onReceipt.allVisitBodiesRequested, true, 'the ON receipt does not request historical bodies');
  eq(onReceipt.chartFactsRequired, true, 'the ON receipt dropped the mandatory chart-facts floor');
  ok((onReceipt.patients || []).every(p => p && p.visitsSkipped !== true),
    'an ON row skipped its historical traversal');
  eq(Number(onReceipt.todayNoteNotRequested || 0), 0,
    'an ON pull reported day notes as not-requested - the revoked short-circuit is back');

  /* ======================================================================
     8. STOP = the honest stamp, in day-facts mode, on the rows that were
        reached but never read
     ====================================================================== */
  {
    const stopped = makeHarness({ day: day, today: today, rows: 3,
      /* syn-02's chart is unreachable, so its inline fold-in never runs and
         its day note is still undecided when the stop lands. */
      chartResult: t => (String(t && t.patientId) === 'syn-02'
        ? { __throw: 'athenaOne chart unreachable' } : null) });
    const realChart = stopped.rt._assistReadChart;
    stopped.rt._assistReadChart = function (target, say, opts) {
      const out = realChart(target, say, opts);
      if (String(target && target.patientId) === 'syn-02') stopped.rt.__mlsPullStopRequested = true;
      return out;
    };
    const stopReceipt = await stopped.api._runHistoryBatch(stopped.rows, [], stopped.onStatus, {});
    stopped.rt.__mlsPullStopRequested = false;

    eq(stopReceipt.visitNotesMode, 'day-facts', 'the stopped pull did not run in day-facts mode');
    eq(stopReceipt.stoppedByUser, true, 'the stopped batch did not record the stop');
    eq(stopReceipt.reason, 'stopped-by-user', 'a user stop was not reported as stopped-by-user');

    const stoppedRow = (stopReceipt.patients || []).find(p => p && p.patientId === 'syn-02');
    ok(stoppedRow, 'the reached-but-unread row is missing from the stopped receipt');
    eq(stoppedRow.todayNote, false, 'a stopped row does not record its pulled-day note as unread');
    eq(stoppedRow.todayNoteReason, 'stopped-by-user',
      'a stopped row’s day note carries "' + String(stoppedRow.todayNoteReason) +
      '" instead of the honest stopped-by-user reason');
    eq(Number(stopReceipt.todayNoteStoppedRows || 0), 1,
      'the stopped receipt does not say how many day notes the stop cut short');
    eq(Number(stopReceipt.todayNoteNotRequested || 0), 0,
      'a stopped day-facts pull reported its day notes as not-requested');
    eq(Number(stopReceipt.todayNoteNotRequestedRows || 0), 0,
      'the stop path still routes day-facts rows through a not-requested tally');
    ok(!Object.keys(stopReceipt.todayNoteReasons || {}).some(
        k => k === 'visit-notes-off' || k === 'full-notes-off'),
      'the stopped receipt reasserted the revoked schedule-only day-note vocabulary: ' +
      JSON.stringify(stopReceipt.todayNoteReasons));

    /* the row the fold-in DID reach before the stop keeps its real read */
    const readRow = (stopReceipt.patients || []).find(p => p && p.patientId === 'syn-01');
    ok(readRow && readRow.todayNote === true,
      'the stop overwrote a pulled-day note that had already been read');
    eq(stopped.noteCalls.length, 1, 'the stop did not end the day-note lane');
    ok(stopped.noteCalls.every(c => c && c.onlyDate === day),
      'the pre-stop note read was not scoped to the pulled day');
    await flush(3);
  }

  /* ======================================================================
     9. UNSET = fail-closed at the batch door: blocked receipt, ZERO reads.
        The ONLY door that may report day notes as not-requested.
     ====================================================================== */
  const unchosen = makeHarness({ day: day, today: today, rows: 3 });
  unchosen.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: false, settled: false }),
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, on: null, reason: 'choice-cancelled' }),
    write: () => true, isPrefKey: () => false
  };
  const blocked = await unchosen.api._runHistoryBatch(unchosen.rows, [], unchosen.onStatus, {});
  eq(blocked.reason, 'visit-notes-unchosen', 'an unchosen account did not get the blocked receipt');
  eq(blocked.visitNotesMode, 'blocked-unchosen', 'the blocked receipt lost its mode label');
  eq(blocked.complete, true, 'the blocked receipt is not a settled refusal');
  eq(blocked.historyRequested, false, 'the blocked receipt claims history was requested');
  eq(blocked.requested, 0, 'the blocked receipt requested rows it refused to read');
  eq(blocked.processed, 0, 'the blocked receipt processed rows it refused to read');
  eq(blocked.failures, 0, 'a fail-closed refusal was reported as failures');
  eq(blocked.notRequestedRows, 3, 'the blocked receipt does not say how many rows it refused');
  eq((blocked.patients || []).length, 0, 'the blocked receipt carries per-patient rows it never read');
  eq((blocked.retry || []).length, 0, 'the blocked receipt armed a retry for an unchosen account');
  eq(unchosen.chartCalls.length, 0, 'an unchosen account had a chart opened on its behalf');
  eq(unchosen.noteCalls.length, 0, 'an unchosen account had an encounter body read on its behalf');
  eq(Number(blocked.todayNoteNotRequested || 0), 3,
    'the blocked door is the ONE place day notes may be not-requested, and it does not say so');
  eq(Number(blocked.todayNoteRead || 0), 0, 'the blocked receipt claims day notes it never read');
  eq(Number(blocked.todayNoteFailures || 0), 0, 'a fail-closed refusal was reported as day-note failures');

  /* ======================================================================
     10. THE DURABLE DAY-PULL TERMINAL RECEIPT
     ----------------------------------------------------------------------
     dayfacts-1.0.1 says fullNotesOff maps to visitNotesMode "day-facts" at
     EVERY level and that "not-requested" is no longer a mode an OFF pull can
     report. dsBuildTerminalReceipt builds the record that is PERSISTED as the
     day's terminal answer and re-read after a reload; dsTerminalReceiptLine
     is the sentence the doctor actually reads off it. Both are the LAST
     level, and the one that outlives the tab.

     Round 1 quarantined this arm: requested===false mapped to the revoked
     'not-requested' while the same object carried a non-zero read count.
     THE ENGINE FIX LANDED - `requested === false ? 'day-facts'` in all three
     twins - so that quarantine is DELETED and the recovery is pinned
     positively below, on the real OFF envelope, on the real ON envelope, and
     on the sentence built from them. */
  {
    const dsStart = mc.indexOf('function dsReceiptDay(value) {');
    const dsEnd = mc.indexOf('function dsPersistTerminalReceipt(receipt) {', dsStart);
    ok(dsStart > 0 && dsEnd > dsStart, 'the day-pull terminal receipt builder boundary moved');
    const dsCtx = vm.createContext({ Date, Number, String, Array, Math, isFinite, JSON, Object, RegExp });
    vm.runInContext(mc.slice(dsStart, dsEnd), dsCtx);
    eq(typeof dsCtx.dsBuildTerminalReceipt, 'function', 'dsBuildTerminalReceipt is not executable in isolation');

    /* the ENGINE's own envelope already speaks the one vocabulary */
    eq(offResult.visitNotesMode, 'day-facts',
      'the day RESULT envelope lost its day-facts label - the engine-side mapping regressed');
    eq(offResult.visitNotesRequested, false, 'the day result envelope mislabels the checkbox');

    const terminal = dsCtx.dsBuildTerminalReceipt(offResult, day);
    eq(terminal.kind, 'day-pull-terminal', 'the terminal receipt lost its kind');
    eq(terminal.target, day, 'the terminal receipt is stamped for the wrong day');
    eq(terminal.status, 'complete', 'a clean day-facts pull did not persist a complete terminal status');
    eq(terminal.history.processed, 3, 'the terminal receipt does not record the charts a day-facts pull read');
    eq(terminal.visitNotes.requested, false, 'the terminal receipt mislabels the checkbox');
    /* the honest halves - true in EITHER world */
    eq(terminal.visitNotes.read, Number(offReceipt.todayNoteRead || 0),
      'the terminal receipt disagrees with the batch receipt about pulled-day notes read');
    eq(terminal.visitNotes.read, 3, 'the terminal receipt hides the pulled-day notes the pull read');
    eq(terminal.visitNotes.failures, 0, 'the terminal receipt invented day-note failures');
    eq(terminal.visitNotes.notRequested, 0,
      'the terminal receipt counts day-facts rows as not-requested day notes');

    /* ---- THE RECOVERY: one vocabulary, all the way down ------------------ */
    eq(terminal.visitNotes.mode, 'day-facts',
      'the PERSISTED terminal receipt lost the day-facts label - an OFF pull that read its notes is being recorded in the revoked vocabulary again');
    ok(terminal.visitNotes.mode !== 'not-requested' &&
       terminal.visitNotes.mode !== 'visit-notes-off' && terminal.visitNotes.mode !== 'full-notes-off',
      'the terminal receipt reasserted a revoked schedule-only mode: ' + String(terminal.visitNotes.mode));
    ok(!(terminal.visitNotes.read > 0 && terminal.visitNotes.notRequested > 0),
      'the terminal receipt reports the same rows as both read and not-requested');
    eq(terminal.visitNotes.mode, offReceipt.visitNotesMode,
      'the persisted mode disagrees with the batch receipt the pull actually produced');
    eq(terminal.visitNotes.mode, offResult.visitNotesMode,
      'the persisted mode disagrees with the day result envelope it was built from');

    /* the other two arms still map, so the fix was a REMAP and not a
       collapse of every pull into one label */
    const onTerminal = dsCtx.dsBuildTerminalReceipt(onResult, day);
    eq(onTerminal.visitNotes.requested, true, 'the ON terminal receipt mislabels the checkbox');
    eq(onTerminal.visitNotes.mode, 'full',
      'the ON arm collapsed into the day-facts label - the terminal receipt can no longer tell the two modes apart');
    const blankTerminal = dsCtx.dsBuildTerminalReceipt({}, day);
    eq(blankTerminal.visitNotes.requested, null,
      'an envelope with no checkbox answer invented one');
    eq(blankTerminal.visitNotes.mode, 'unknown',
      'an envelope with no checkbox answer is recorded as a real mode');

    /* ---- the SENTENCE the doctor reads, executed ------------------------- */
    const lineStart = mc.indexOf('function dsTerminalReceiptLine(receipt) {');
    const lineEnd = mc.indexOf('function dsHydrateTerminalReceipt', lineStart);
    ok(lineStart > 0 && lineEnd > lineStart, 'the terminal receipt line builder boundary moved');
    const lineCtx = vm.createContext({ String: String, fmtDay: d => String(d), DS: { day: day } });
    vm.runInContext(mc.slice(lineStart, lineEnd), lineCtx);
    const offLine = String(lineCtx.dsTerminalReceiptLine(terminal) || '');
    ok(/Full visit notes is off/i.test(offLine) && /chart facts/i.test(offLine) &&
       /own note were read/i.test(offLine),
      'the persisted OFF sentence no longer tells the doctor what a day-facts pull actually did: ' + offLine);
    ok(!/schedule[- ]only|no charts? (?:were|was) opened|history was not requested|were not read/i.test(offLine),
      'the persisted OFF sentence claims a day-facts pull opened or read nothing: ' + offLine);
    eq(String(lineCtx.dsTerminalReceiptLine(onTerminal) || '').indexOf('Full visit notes is off'), -1,
      'the ON sentence tells the doctor the checkbox was off');

    /* dayfacts-1.0.2 (round-3 gap CLOSED): the fail-closed unchosen door
       keeps its OWN terminal mode and its own sentence - a refusal can never
       borrow the day-facts working label or the "were read" sentence. */
    const blockedTerminal = dsCtx.dsBuildTerminalReceipt(
      { ok: false, complete: false, reason: 'visit-notes-unchosen', historyReceipt: blocked }, day);
    eq(blockedTerminal.visitNotes.read, 0, 'the blocked terminal receipt read count stays 0');
    eq(blockedTerminal.visitNotes.notRequested, 3,
      'the blocked terminal receipt keeps the count that proves nothing was read');
    eq(blockedTerminal.visitNotes.mode, 'blocked-unchosen',
      'the fail-closed unchosen refusal keeps its OWN terminal mode (dayfacts-1.0.2)');
    const blockedLine = String(lineCtx.dsTerminalReceiptLine(blockedTerminal) || '');
    ok(/choice has not been made/i.test(blockedLine),
      'the blocked sentence names the unmade choice');
    ok(!/own note were read/i.test(blockedLine),
      'the blocked sentence never claims reads that did not happen');
  }

  /* ======================================================================
     11. A MANDATORY READ THAT FAILS MUST STILL BE RECOVERABLE
     ----------------------------------------------------------------------
     Making the pulled-day note mandatory only helps if an unread one can be
     retried. Both recovery seams used to be keyed on the checkbox and so
     refused every day-facts row by construction: tnDeferRow would not queue
     one for the deferred round, and niSyncFromReceipt returned 0 before it
     ever looked at the rows. Round 2 unfused both. These pins hold that open
     in every twin that ships - a re-fused seam turns an honest todayNote
     false into a note nobody ever reads.
     ====================================================================== */
  ['feat_mls_schedimport_exact.js',
   '1p-feat_mls_schedimport_exact.js',
   'cloned-feat_mls_schedimport_exact.js'].forEach(function (name) {
    const src = name === 'feat_mls_schedimport_exact.js'
      ? si : fs.readFileSync(path.join(root, name), 'utf8');

    /* the deferred round serves BOTH modes: the guard may test the row, the
       day and the sweep depth - never the checkbox. */
    const dfStart = src.indexOf('function tnDeferRow(entry, day, force) {');
    const dfEnd = src.indexOf('var pid = String(entry.patientId', dfStart);
    ok(dfStart > 0 && dfEnd > dfStart, name + ': the tnDeferRow guard boundary moved');
    const dfGuard = src.slice(dfStart, dfEnd);
    ok(/if \(!entry \|\| !day \|\| sweepDepth\) return false;/.test(dfGuard),
      name + ': the tnDeferRow guard moved - a day-facts note refusal may be refused the deferred round again');
    ok(!/visitNotesRequested|fullNotes|pullVisitBodies/.test(dfGuard),
      name + ': tnDeferRow reads the checkbox again - day-facts rows would never queue for retry');

    /* the idle backfill's feed is mode-blind: it decides on the ROW's own
       todayNote stamp, which day-facts receipts now carry for real. */
    const nsStart = src.indexOf('function niSyncFromReceipt(receipt, day) {');
    const nsEnd = src.indexOf('/* ---- the gate ---', nsStart);
    ok(nsStart > 0 && nsEnd > nsStart, name + ': the niSyncFromReceipt boundary moved');
    const nsync = src.slice(nsStart, nsEnd);
    ok(!/visitNotesRequested/.test(nsync),
      name + ': niSyncFromReceipt reads the checkbox again - a day-facts receipt would never reach the idle backfill');
    ok(/if \(p\.todayNote === true \|\| p\.todayNote === "already-read"\) \{ niDrop\(/.test(nsync),
      name + ': niSyncFromReceipt no longer drops the rows a day-facts pull actually read');
    ok(/if \(p\.todayNote !== false\) return;/.test(nsync) && /niEnqueue\(p\.patientId, d, tnReasonCode\(p\.todayNoteReason\)\)/.test(nsync),
      name + ': niSyncFromReceipt no longer enqueues an unread day-facts note for backfill');

    /* the idle gate is fail-closed on UNSET ONLY - the same one door as the
       batch - and an unchosen account PAUSES the timer instead of ticking. */
    const ngStart = src.indexOf('function niGate(force) {');
    const ngEnd = src.indexOf('if (_ni.reading === true)', ngStart);
    ok(ngStart > 0 && ngEnd > ngStart, name + ': the niGate boundary moved');
    const ngate = src.slice(ngStart, ngEnd);
    ok(/choice\.settled === true && \(choice\.state === "on" \|\| choice\.state === "off"\)/.test(ngate),
      name + ': the idle gate no longer admits BOTH settled modes - a settled-OFF account is fail-closed out of its own backfill');
    ok(/return \{ open: false, reason: "visit-notes-unchosen" \};/.test(ngate),
      name + ': the idle gate lost the unchosen fail-closed door');
    ok(src.includes('(gate.reason === "visit-notes-unchosen") ? "paused"') &&
       src.includes('if (gate.reason === "visit-notes-unchosen") niStopTimer();'),
      name + ': an unchosen account no longer pauses the idle backfill - the timer ticks forever against a closed door');
  });

  await flush(3);
  console.log('PASS day-note-foldin-contract: ' + checks +
    ' checks - dayfacts-1.0.1: an OFF pull opens every chart, saves its facts, AND folds in exactly one ' +
    'PULLED-DAY note read per row (proven by seq interleaving and an attempt-once census); ON adds one ' +
    'unscoped all-visits walk and no date-scoped double-read; a user stop stamps stopped-by-user; and ' +
    'blocked-unchosen is the only door left that may report day notes as not-requested. The round-1 ' +
    'terminal-receipt quarantine is DELETED: the PERSISTED day receipt and the sentence built from it ' +
    'now speak the day-facts vocabulary (recovery pinned positively), the unscoped visit door refuses an ' +
    'ON-but-UNSETTLED choice, and both recovery seams (tnDeferRow, niSyncFromReceipt) are pinned ' +
    'mode-blind in all three twins. ONE OPEN ENGINE GAP is pinned honestly, not forced green: ' +
    'mls-connect.js:49570 maps on the requested BOOLEAN alone, so a FAIL-CLOSED unchosen pull persists ' +
    'visitNotes.mode "day-facts" (read:0, notRequested:3) and tells the doctor each day\'s own note was ' +
    'read - see the round-3 TODO in part 10');
}

main().catch(error => { console.error(error); process.exit(1); });

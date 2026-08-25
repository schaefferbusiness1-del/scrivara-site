'use strict';
/* =============================================================================
 * rsk-1.1.0  -  a re-run does not re-read what it already proved
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
 *
 * ----------------------------------------------------------------------------
 * WHY THE OLD PINS MOVED - dayfacts-1.0.0/1.0.1 (owner 2026-08-25)
 * ----------------------------------------------------------------------------
 * The Full-visit-notes checkbox no longer decides WHETHER a chart opens; it
 * decides HOW MUCH history is traversed. That revoked three things this suite
 * used to pin as truth:
 *   - the OFF early return `receipt.reason = "visit-notes-off"` (a schedule-only
 *     no-op that opened zero charts) is GONE and must never be reasserted;
 *   - OFF (settled) is now DAY-FACTS mode: every exact scheduled row still gets
 *     its identity-verified chart open and chart-facts save, historical visit
 *     traversal is skipped (one.visitsSkipped === true), and the receipt carries
 *     visitNotesMode 'day-facts' / chartFactsRequired true /
 *     allVisitBodiesRequested false plus honest insurance placeholders;
 *   - fail-closed moved from "OFF" to "UNCHOSEN": an unsettled preference now
 *     returns a blocked receipt (reason 'visit-notes-unchosen', visitNotesMode
 *     'blocked-unchosen') and performs zero reads.
 * Because day-facts mode DOES open charts, the rsk skip lever now matters in
 * both modes, so every resume/skip case below runs twice - once per mode.
 *
 * dayfacts-1.0.1 landed the SECOND half of the day-facts floor, which the
 * round-1 form of this suite could only report as an engine gap: the pulled-day
 * encounter note. Both legs are live (the inline fold-in and the tn/onlyDate
 * tail pass), tnAggregate's checkbox short-circuit is gone, and a stopped row
 * is stamped todayNoteReason 'stopped-by-user' rather than any OFF word. So
 * the narrowed "whatever it reads must at least be onlyDate-scoped" clauses are
 * replaced below by COUNTED pins:
 *   - day-facts attempts exactly one onlyDate=<pulled day> runForPatient per
 *     row - INCLUDING the rows whose chart open the rsk skip saved, because a
 *     resume must not quietly become a day-note skip;
 *   - receipt.todayNoteRead equals the row count and todayNoteNotRequested is 0;
 *   - full mode makes zero onlyDate calls (the pulled day rides inside the
 *     unscoped historical walk) and reports todayNoteRead 0;
 *   - the per-row cost lands on costBreakdown.todayNoteMs in day-facts and on
 *     costBreakdown.visitsMs in full - measured, from one fixture, both ways.
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

/* Both modes are now real work, so every skip/bar case is proved in both.
   `on` is the Full-visit-notes checkbox; the label is the receipt's own word
   for the mode it selects. */
const MODES = [{ on: true, mode: 'full' }, { on: false, mode: 'day-facts' }];

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

  /* dayfacts-1.0.0: the removed no-op must not creep back in. The runtime
     cases below would catch a re-added early return too, but this names the
     exact byte the owner contract revoked. */
  ok(!/receipt\.reason = "visit-notes-off"/.test(SI),
    'the schedule-only OFF no-op (receipt.reason = "visit-notes-off") was reasserted - dayfacts-1.0.0 removed it');
  ok(/receipt\.reason = "visit-notes-unchosen"/.test(SI),
    'the fail-closed UNCHOSEN refusal is missing from the batch door');
  ok(/dayfacts-1\.0\.0 \(superseding owner DAY contract, 2026-08-25\)/.test(SI),
    'the engine does not carry the dayfacts-1.0.0 contract block');

  /* dayfacts-1.0.1: the two pulled-day-note legs the round-1 form of this
     suite had to report as an engine gap. Both were `= false` fuses; naming
     the exact bytes stops a silent re-fusing that the runtime pins below would
     otherwise have to re-discover from a zero. */
  ok(/var pulledDayNoteLaneEnabled = true;/.test(SI),
    'the INLINE pulled-day note fold-in is fused off again (pulledDayNoteLaneEnabled)');
  ok(/var pulledDayNoteTailEnabled = true;/.test(SI),
    'the tn/onlyDate TAIL pass is fused off again (pulledDayNoteTailEnabled)');
  ok(!/pulledDayNote(?:Lane|Tail)Enabled\s*=\s*false/.test(SI),
    'a pulled-day note leg carries a hard-disable assignment');
  /* the stop path speaks one vocabulary in BOTH modes */
  ok(/todayNoteReason = "stopped-by-user"/.test(SI),
    'a stopped row is no longer stamped stopped-by-user');
  ok(!/"full-notes-off"/.test(SI),
    'the retired retryFailedHistory OFF refusal ("full-notes-off") is back');
  ok(!/todayNoteReason = "visit-notes-off"/.test(SI),
    'the retired OFF stamp vocabulary is back on the day-note lane');
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
  for (const M of MODES) {
    const tag = '[' + M.mode + '] ';
    const h = makeHarness({ day: DAY, today: DAY, rows: 10, visitNotesOn: M.on });
    seedVerifiedDay(h, DAY, h.patients.slice(0, 6).map(p => p.id));

    const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
    eq(receipt.visitNotesMode, M.mode, tag + 'the batch ran in the wrong mode');
    eq(receipt.chartsSkippedVerifiedToday, 6, tag + 'the re-run re-read rows it had already proved');
    eq(opened(h), 4, tag + 'the re-run opened ' + opened(h) + ' charts; only the 4 unproved ones were needed');
    eq(h.chartCalls.filter(c => Number(String(c.patientId).slice(-2)) <= 6).length, 0,
      tag + 'a skipped row was still opened in Athena');
    eq(receipt.patients.length, 10, tag + 'the skip lost rows from the receipt');
    eq(receipt.processed, 10, tag + 'the skip broke the processed count');
    ok(receipt.patients.filter(p => p.chartSkippedVerifiedToday).length === 6,
      tag + 'a skipped row is not recorded as skipped - it must never look like a fresh read');
    ok(receipt.patients.slice(0, 6).every(p => p.complete === true),
      tag + 'a proved row did not stay complete across the re-run');
    eq(receipt.costBreakdown.skippedVerifiedToday, 6,
      tag + 'the cost breakdown does not account for the rows the skip saved');

    /* dayfacts-1.0.1: the skip is a CHART-OPEN lever and nothing more. In
       day-facts mode all ten rows - the six whose chart open was saved
       included - still owe exactly one onlyDate read of the pulled day's
       encounter note; the six reach it through the tail pass rather than the
       inline fold-in, which is precisely the case a resume could silently
       lose. In full mode the pulled day rides inside the historical walk, so
       only the four unproved rows pay for a walk at all. */
    const scoped = h.noteCalls.filter(c => String(c.onlyDate || '') === DAY);
    const unscoped = h.noteCalls.filter(c => c.onlyDate == null);
    if (M.on) {
      eq(unscoped.length, 4, tag + 'the skip did not save the historical walk on the six proved rows');
      eq(scoped.length, 0, tag + 'full mode ran a separate pulled-day lane on top of the historical walk');
      eq(receipt.todayNoteRead, 0, tag + 'full mode reported separate pulled-day reads it never made');
    } else {
      eq(unscoped.length, 0, tag + 'day-facts mode performed an UNSCOPED visit walk - that is the ON lane');
      eq(scoped.length, 10, tag + 'day-facts mode attempted ' + scoped.length +
        ' pulled-day notes; every row owes exactly one, skipped chart or not');
      eq(new Set(scoped.map(c => String(c.patientId))).size, 10,
        tag + 'a row never had its pulled-day note attempted');
      eq(receipt.todayNoteRead, 10, tag + 'the receipt under-reports the pulled-day notes it read');
      eq(receipt.todayNoteNotRequested, 0,
        tag + 'a day-facts row was stamped todayNoteNotRequested - the retired checkbox short-circuit is back');
      ok(receipt.patients.slice(0, 6).every(p => p.chartSkippedVerifiedToday && p.todayNote === true),
        tag + 'a CHART-skipped row lost its pulled-day note: ' +
          JSON.stringify(receipt.patients.slice(0, 6)
            .filter(p => p.todayNote !== true).map(p => [p.patientId, p.todayNote, p.todayNoteReason])));
      ok(receipt.patients.every(p => p.todayNote === true),
        tag + 'a day-facts row finished without its pulled-day note: ' +
          JSON.stringify(receipt.patients
            .filter(p => p.todayNote !== true).map(p => [p.patientId, p.todayNote, p.todayNoteReason])));
    }

    /* MEASURED DELTA: the same day with the skip turned OFF re-reads everything */
    const h2 = makeHarness({ day: DAY, today: DAY, rows: 10, visitNotesOn: M.on });
    seedVerifiedDay(h2, DAY, h2.patients.slice(0, 6).map(p => p.id));
    h2.rt.window.__mlsP1SkipVerifiedToday = false;
    await h2.api._runHistoryBatch(h2.rows, [], h2.onStatus);
    eq(opened(h2), 10, tag + 'the A/B control did not re-read all ten - the measurement is meaningless');
    /* MEASURED: 4 charts opened instead of 10 on the same day and the same
       rows - a 60% reduction in Athena chart opens for a re-run. dayfacts-1.0.0
       makes this a saving in BOTH modes: day-facts opens charts too, so the
       control here is the proof the OFF lane is no longer a no-op. */
    eq(opened(h2) - opened(h), 6, tag + 'the skip saved ' + (opened(h2) - opened(h)) + ' chart opens, expected 6');
    ok(h.chartCalls.length < h2.chartCalls.length,
      tag + 'the skip saved no Athena reads (' + h.chartCalls.length + ' vs ' + h2.chartCalls.length + ')');
    /* ...and the control proves the saving is CHART-ONLY: with the lever off,
       day-facts still performs exactly the same ten pulled-day reads. */
    if (!M.on) eq(h2.noteCalls.filter(c => String(c.onlyDate || '') === DAY).length, 10,
      tag + 'the A/B control changed the pulled-day lane; the skip must save CHART opens only');
  }
}

/* ------------------------------------- 2. every clause of the bar refuses */
async function testTheBarIsNotAMarker() {
  const DAY = '2026-08-17';
  for (const M of MODES) {
    const tag = '[' + M.mode + '] ';

    /* (a) a day whose census was NOT measured must be re-read */
    {
      const h = makeHarness({ day: DAY, today: DAY, rows: 4, visitNotesOn: M.on });
      const key = 'p1-harness::schedImportIndexV1::' + DAY;
      h.rt.localStorage.setItem(key, JSON.stringify({ v: 1, rows: {}, history: {
        at: h.clock.now(), contentMeasured: false, contentVerified: true,
        perPatient: h.patients.reduce((a, p) => (a[p.id] = 'ok', a), {}) } }));
      h.patients.forEach(p => { p.problems = ['Synthetic problem']; });
      await h.api._runHistoryBatch(h.rows, [], h.onStatus);
      eq(opened(h), 4, tag + 'an UNMEASURED day was accepted as proof and its charts were skipped');
    }

    /* (b) a stale verdict (yesterday) must be re-read */
    {
      const h = makeHarness({ day: DAY, today: DAY, rows: 4, visitNotesOn: M.on });
      const key = 'p1-harness::schedImportIndexV1::' + DAY;
      h.rt.localStorage.setItem(key, JSON.stringify({ v: 1, rows: {}, history: {
        at: h.clock.now() - 30 * 3600 * 1000, contentMeasured: true, contentVerified: true,
        perPatient: h.patients.reduce((a, p) => (a[p.id] = 'ok', a), {}) } }));
      h.patients.forEach(p => { p.problems = ['Synthetic problem']; });
      await h.api._runHistoryBatch(h.rows, [], h.onStatus);
      eq(opened(h), 4, tag + 'a verdict older than the bound was accepted as proof');
    }

    /* (c) a record that no longer holds content must be re-read */
    {
      const h = makeHarness({ day: DAY, today: DAY, rows: 4, visitNotesOn: M.on });
      seedVerifiedDay(h, DAY, h.patients.map(p => p.id));
      h.patients.forEach(p => { delete p.problems; delete p.summary; });
      await h.api._runHistoryBatch(h.rows, [], h.onStatus);
      eq(opened(h), 4, tag + 'an EMPTY stored record was accepted as proof of a completed read');
    }

    /* (d) an identity that drifted must be re-read */
    {
      const h = makeHarness({ day: DAY, today: DAY, rows: 4, visitNotesOn: M.on });
      seedVerifiedDay(h, DAY, h.patients.map(p => p.id));
      h.patients.forEach(p => { p.dob = '12/31/1999'; });
      await h.api._runHistoryBatch(h.rows, [], h.onStatus);
      eq(opened(h), 0,
        tag + 'guard: a drifted DOB should not even resolve an identity target, so no chart may open');
    }
  }
}

/* ----------- 3. dayfacts-1.0.0: OFF is the MANDATORY FLOOR, not a no-op -- */
async function testDayFactsFloorIsRealWork() {
  const DAY = '2026-08-17';
  /* The full seam set (coverage receipt + parse + save) so the floor can be
     measured all the way to the stored record, not just to the chart door. */
  const chartFacts = {
    chartCoverage: true, identityEcho: true,
    parseResult: () => ({
      problems: 'Synthetic problem', meds: 'Synthetic med',
      allergies: 'Synthetic allergy', summary: 'Synthetic summary'
    })
  };

  const df = makeHarness(Object.assign({ day: DAY, today: DAY, rows: 4 }, chartFacts));
  const r = await df.api._runHistoryBatch(df.rows, [], df.onStatus);

  /* the mode words the contract names, on the receipt */
  eq(r.visitNotesMode, 'day-facts', 'a settled-OFF batch did not run in day-facts mode');
  eq(r.visitNotesRequested, false, 'day-facts mode misreported the checkbox');
  eq(r.chartFactsRequired, true, 'the chart-facts floor is not declared mandatory');
  eq(r.allVisitBodiesRequested, false, 'day-facts mode asked for all historical visit bodies');
  ok(r.reason !== 'visit-notes-off',
    'the retired schedule-only OFF no-op is back: reason "visit-notes-off"');

  /* the floor actually ran: every exact scheduled row, chart opened and saved */
  eq(r.requested, 4, 'day-facts mode dropped rows before the chart door');
  eq(r.processed, 4, 'day-facts mode did not process every exact scheduled row');
  eq(r.patients.length, 4, 'day-facts mode lost rows from the receipt');
  eq(opened(df), 4, 'day-facts mode opened ' + opened(df) + ' charts; the contract requires one per exact row');
  eq(df.saveCalls.length, 4, 'day-facts mode did not save chart facts for every row');
  eq(r.complete, true, 'the day-facts floor did not complete: ' + String(r.reason || ''));
  ok(r.patients.every(p => p.identityVerified === true && p.organized === true),
    'a day-facts row was completed without an identity-verified chart read');
  ok(df.patients.every(p => String(p.problems || '') && String(p.summary || '')),
    'day-facts mode left the stored record without chart facts');

  /* ...and only the floor: historical traversal is the ON-only half */
  ok(r.patients.every(p => p.visitsSkipped === true),
    'day-facts mode traversed historical visit bodies (visitsSkipped was not set)');
  eq(df.noteCalls.filter(c => c.onlyDate == null).length, 0,
    'day-facts mode performed an UNSCOPED visit walk - that is the ON lane');

  /* honest insurance placeholders: a missing reader is never verified-none */
  eq(r.insuranceAttempted, 0, 'day-facts mode claimed insurance reads it did not make');
  eq(r.insuranceComplete, false, 'day-facts mode reported insurance complete with no reader shipped');
  eq(r.benefitsComplete, false, 'day-facts mode reported benefits complete with no reader shipped');
  eq(r.insuranceReason, 'reader-not-shipped',
    'the insurance placeholder does not name the missing reader honestly');

  /* no user-facing line may claim OFF opens no charts */
  ok(!df.statusLines.some(s => /no patient charts|no charts (?:were )?opened/i.test(s)),
    'a day-facts status line still tells the doctor no charts were opened: ' +
      JSON.stringify(df.statusLines.filter(s => /no patient charts|no charts/i.test(s))));
  ok(df.statusLines.some(s => /Reading verified history/i.test(s)),
    'day-facts mode never narrated a chart read');

  /* ---------------------------------------------------------------------
     dayfacts-1.0.1: the PULLED-DAY ENCOUNTER NOTE is the second half of the
     floor. Round 1 could only report it as an engine gap (both legs were
     `= false` fuses and tnAggregate short-circuited on the checkbox, so the
     measured attempt count was 0 and every row read todayNoteNotRequested).
     The lane ships, so these are counted pins now - tolerating whatever the
     mode happens to read would let a re-fusing pass as green.
     --------------------------------------------------------------------- */
  eq(df.noteCalls.length, 4, 'day-facts mode attempted ' + df.noteCalls.length +
    ' pulled-day notes; the contract requires exactly one per exact scheduled row');
  eq(new Set(df.noteCalls.map(c => String(c.patientId))).size, 4,
    'a day-facts row never had its pulled-day note attempted');
  ok(df.noteCalls.every(c => String(c.onlyDate || '') === DAY),
    'a day-facts note read was scoped to a day other than the pulled day: ' +
      JSON.stringify(df.noteCalls.map(c => c.onlyDate)));
  eq(r.todayNoteRead, 4, 'the receipt under-reports the pulled-day notes day-facts mode read');
  eq(r.todayNoteNotRequested, 0,
    "a day-facts row was stamped todayNoteNotRequested - tnAggregate's retired checkbox short-circuit is back");
  eq(r.todayNoteFailures, 0,
    'a day-facts pulled-day note failed: ' + JSON.stringify(r.todayNoteReasons || {}));
  ok(r.patients.every(p => p.todayNote === true),
    'a day-facts row completed without its pulled-day note: ' +
      JSON.stringify(r.patients.filter(p => p.todayNote !== true)
        .map(p => [p.patientId, p.todayNote, p.todayNoteReason])));
  ok(r.patients.every(p => !/visit-notes-off|full-notes-off|not-requested/.test(String(p.todayNoteReason || ''))),
    'the retired OFF stamp vocabulary answered for a day-facts row: ' +
      JSON.stringify(r.patients.map(p => p.todayNoteReason).filter(Boolean)));
  /* ORDER: the note is read while THIS row's chart is open and verified, not
     in a blind second pass over a chart that has already been closed. `seq` is
     the harness's monotonic counter shared by both readers. */
  ok(df.noteCalls.every(c => {
    const first = df.chartCalls
      .filter(x => String(x.patientId) === String(c.patientId))
      .sort((a, b) => a.seq - b.seq)[0];
    return !!first && first.seq < c.seq;
  }), 'a day-facts pulled-day note was read before its own row\'s chart was opened');

  /* the ON control on the same seams: same floor, PLUS the historical walk */
  const full = makeHarness(Object.assign({ day: DAY, today: DAY, rows: 4, visitNotesOn: true }, chartFacts));
  const rf = await full.api._runHistoryBatch(full.rows, [], full.onStatus);
  eq(rf.visitNotesMode, 'full', 'the ON control did not run in full mode');
  eq(rf.allVisitBodiesRequested, true, 'the ON control did not request all visit bodies');
  eq(opened(full), 4, 'the ON control did not open every chart - the floor is shared, not ON-only');
  eq(full.saveCalls.length, 4, 'the ON control did not save chart facts for every row');
  ok(rf.patients.every(p => p.visitsSkipped !== true),
    'the ON control skipped historical visit bodies');
  /* The MEASURED difference between the two modes is no longer the NUMBER of
     reads - both make one per row - it is their SCOPE. day-facts reads exactly
     the pulled day; full reads the whole history and covers the pulled day
     inside it, so it must NOT also run the onlyDate lane on top. */
  eq(full.noteCalls.filter(c => c.onlyDate == null).length, 4,
    'the ON control did not perform one unscoped historical walk per row; measured ' +
      JSON.stringify(full.noteCalls.map(c => c.onlyDate)));
  eq(full.noteCalls.filter(c => c.onlyDate).length, 0,
    'full mode ran a separate pulled-day lane on top of the historical walk');
  eq(rf.todayNoteRead, 0, 'the ON control reported separate pulled-day reads it never made');
  eq(rf.todayNoteNotRequested, 0,
    'the ON control stamped rows todayNoteNotRequested - that vocabulary belongs to the blocked door only');
}

/* ------------- 4. an UNCHOSEN preference blocks everything, fail-closed -- */
async function testUnchosenBlocksEverything() {
  const DAY = '2026-08-17';
  /* fail-closed on BOTH unsettled shapes: never-chosen, and a stored state
     that has not settled. Neither may open a chart. */
  const unsettled = [
    { label: 'unset', read: { state: 'unset', on: false, settled: false } },
    { label: 'off-but-unsettled', read: { state: 'off', on: false, settled: false } },
    { label: 'on-but-unsettled', read: { state: 'on', on: true, settled: false } }
  ];
  for (const U of unsettled) {
    const tag = '[' + U.label + '] ';
    const h = makeHarness({ day: DAY, today: DAY, rows: 10 });
    h.rt.__mlsVisitNotesPref.read = () => Object.assign({}, U.read);
    /* a seeded verified day must not let the blocked receipt report "skips"
       it never earned - a refusal is not a resume. */
    seedVerifiedDay(h, DAY, h.patients.slice(0, 6).map(p => p.id));

    const r = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
    eq(r.reason, 'visit-notes-unchosen', tag + 'an unchosen account did not get the blocked receipt');
    eq(r.visitNotesMode, 'blocked-unchosen', tag + 'the blocked receipt does not name the blocked mode');
    ok(r.reason !== 'visit-notes-off',
      tag + 'the removed schedule-only no-op answered for an unchosen account');
    eq(r.requested, 0, tag + 'a blocked batch still claimed rows were requested');
    eq(r.processed, 0, tag + 'a blocked batch processed rows');
    eq(r.patients.length, 0, tag + 'a blocked batch produced per-patient receipts');
    eq(r.retry.length, 0, tag + 'a blocked batch queued retries for reads it never made');
    eq(r.historyRequested, false, tag + 'a blocked batch claimed history was requested');
    eq(r.notRequestedRows, 10, tag + 'a blocked batch did not account for the rows it refused');

    /* ZERO READS is the whole point */
    eq(h.chartCalls.length, 0, tag + 'an unchosen account had ' + h.chartCalls.length + ' charts opened on its behalf');
    eq(h.noteCalls.length, 0, tag + 'an unchosen account had visit bodies read on its behalf');
    eq(r.chartsSkippedVerifiedToday, undefined,
      tag + 'a blocked batch reported resume skips it never performed');
    eq(r.costBreakdown, undefined, tag + 'a blocked batch reported per-row cost for work it never did');
  }
}

/* ---------------------------- 5. the cost breakdown is on every receipt -- */
async function testCostBreakdown() {
  const DAY = '2026-08-17';
  /* dayfacts-1.0.0: day-facts is real work, so it now carries its OWN cost
     breakdown - and the historical-traversal lane must read zero on it. */
  const df = makeHarness({ day: DAY, today: DAY, rows: 5, noteDelayMs: 11000 });
  const dfReceipt = await df.api._runHistoryBatch(df.rows, [], df.onStatus);
  const dfCb = dfReceipt.costBreakdown;
  ok(dfCb, 'the day-facts receipt carries no per-row cost breakdown - the OFF no-op is back');
  eq(dfCb.rows, 5, 'the day-facts cost breakdown counted the wrong number of rows');
  eq(dfCb.visitsMs, 0, 'day-facts mode spent ' + dfCb.visitsMs + 'ms traversing historical visit bodies');
  eq(dfCb.skippedVerifiedToday, 0, 'the day-facts breakdown mis-reports skipped rows on a first run');
  eq(typeof dfCb.chartMs, 'number', 'the day-facts chart-read cost is missing');
  eq(typeof dfCb.parseSaveMs, 'number', 'the day-facts parse/save cost is missing');
  eq(df.noteCalls.filter(c => c.onlyDate == null).length, 0,
    'day-facts mode performed a historical visit-body walk; that lane is ON-only');
  /* dayfacts-1.0.1: day-facts DOES spend per-row read time - on the pulled-day
     note - and the receipt must carry that number rather than a zero that
     looks identical to the retired no-op. 5 rows x 11 s of scoped reads. */
  eq(df.noteCalls.filter(c => String(c.onlyDate || '') === DAY).length, 5,
    'day-facts mode attempted ' + df.noteCalls.length + ' pulled-day notes, expected 5');
  eq(dfReceipt.todayNoteRead, 5, 'the day-facts receipt under-reports the pulled-day notes it read');
  eq(dfReceipt.todayNoteNotRequested, 0, 'a day-facts row was stamped todayNoteNotRequested');
  eq(dfCb.todayNoteMs, 55000,
    'the day-facts breakdown lost the pulled-day note time: ' + dfCb.todayNoteMs + 'ms of 5 x 11000');
  eq(dfCb.perRowTodayNoteMs, 11000,
    'the day-facts per-row pulled-day cost is wrong: ' + dfCb.perRowTodayNoteMs);

  /* Cost accounting for the historical lane is an explicit ON history run. */
  const h = makeHarness({ day: DAY, today: DAY, rows: 5, visitNotesOn: true, noteDelayMs: 11000 });
  const receipt = await h.api._runHistoryBatch(h.rows, [], h.onStatus);
  const cb = receipt.costBreakdown;
  ok(cb, 'the receipt carries no per-row cost breakdown');
  eq(cb.rows, 5, 'the cost breakdown counted the wrong number of rows');
  /* In FULL mode the pulled day is covered by the historical traversal itself,
     so no separate onlyDate lane runs and its cost lanes stay at zero. The two
     modes therefore spend their per-row read time on DIFFERENT lanes of the
     same breakdown - measured both ways off one fixture. */
  eq(cb.todayNoteMs, 0, 'full mode ran a separate pulled-day lane on top of the historical walk');
  eq(cb.perRowTodayNoteMs, 0, 'full mode reported per-row pulled-day time on top of the historical walk');
  eq(receipt.todayNoteRead, 0, 'full mode reported separate pulled-day reads it never made');
  eq(h.noteCalls.filter(c => c.onlyDate == null).length, 5,
    'Full Notes ON did not perform one unscoped visit walk per patient');
  eq(h.noteCalls.filter(c => c.onlyDate).length, 0,
    'full mode ran onlyDate-scoped reads on top of the historical walk');
  eq(typeof cb.chartMs, 'number', 'the chart-read cost is missing');
  eq(typeof cb.parseSaveMs, 'number', 'the parse/save cost is missing');
  ok(cb.visitsMs > 0, 'Full Notes ON did not account for visit-body time');
  eq(cb.skippedVerifiedToday, 0, 'the breakdown mis-reports skipped rows on a first run');
  ok(cb.chartMs + cb.parseSaveMs >= 0,
    'the non-body cost lanes no longer produce numeric receipt data');
  /* the MEASURED cost the checkbox buys: 5 x 11 s of body reads that day-facts
     never spends. A control that measured nothing would prove nothing. */
  ok(cb.visitsMs - dfCb.visitsMs >= 55000,
    'the historical walk cost only ' + (cb.visitsMs - dfCb.visitsMs) + 'ms more than day-facts; expected >= 55000');
  /* ...and the mirror image: the pulled-day lane is day-facts' own cost, and
     full mode spends none of it. Two numbers, opposite signs, one fixture. */
  ok(dfCb.todayNoteMs - cb.todayNoteMs >= 55000,
    'the day-facts pulled-day lane cost only ' + (dfCb.todayNoteMs - cb.todayNoteMs) +
      'ms more than full mode; expected >= 55000');
}

async function main() {
  await testVerifiedRowsSkip();
  await testTheBarIsNotAMarker();
  await testDayFactsFloorIsRealWork();
  await testUnchosenBlocksEverything();
  await testCostBreakdown();
  console.log('PASS 1p-pull-resume-skip-and-cost: ' + checks + ' checks - under dayfacts-1.0.1 a re-run skips only rows this same account day already proved and stored with content under an unchanged identity (measured against an A/B control in BOTH modes) and that skip saves CHART OPENS ONLY - every day-facts row, skipped or not, still gets exactly one onlyDate read of the pulled day\'s encounter note; day-facts mode opens and saves every exact scheduled row, skips historical bodies, declares honest insurance placeholders and books its time on costBreakdown.todayNoteMs while full mode books the same fixture\'s time on costBreakdown.visitsMs; an unchosen preference blocks every read');
}

const watchdog = setTimeout(() => { console.error(new Error('1p-pull-resume-skip-and-cost did not finish')); process.exit(1); }, 60000);
main().then(() => clearTimeout(watchdog), e => { clearTimeout(watchdog); console.error(e); process.exit(1); });

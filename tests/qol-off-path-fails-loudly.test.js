'use strict';
/* =============================================================================
 * qol-off-path-fails-loudly.test.js
 *
 * ===== WHY THE OLD PINS MOVED: dayfacts-1.0.0 -> 1.0.1 (owner 2026-08-25) ====
 * Until 2026-08-25 "Full visit notes OFF" meant SCHEDULE-ONLY. _runHistoryBatch
 * early-returned a no-op receipt whose reason was "visit-notes-off", pull()
 * reported historyReceipt.reason "full-notes-off", and not one patient chart
 * was opened. This suite pinned exactly that world:
 *     chartCalls === 0, noteCalls === 0, historyReceipt.reason === 'full-notes-off'
 *
 * The owner superseded that contract on 2026-08-25 (Codex-accepted) and the
 * engine sources implement it:
 *
 *   OFF (settled)   -> DAY-FACTS mode. The per-patient history batch RUNS.
 *                      Every exact scheduled row still gets its identity-
 *                      verified chart open + chart-facts save, AND the pulled-
 *                      day encounter note is read for that row (scoped by
 *                      onlyDate). Only the OTHER dated historical bodies are
 *                      out of scope (one.visitsSkipped === true). Receipt says
 *                      visitNotesMode 'day-facts', chartFactsRequired true,
 *                      allVisitBodiesRequested false, and carries HONEST
 *                      insurance placeholders (insuranceAttempted 0,
 *                      insuranceReason 'reader-not-shipped').
 *   ON              -> the same mandatory floor PLUS full historical traversal
 *                      (visitNotesMode 'full').
 *   UNSET/unsettled -> fail-closed: a blocked receipt, reason
 *                      'visit-notes-unchosen', visitNotesMode
 *                      'blocked-unchosen', ZERO reads. The old
 *                      'visit-notes-off' schedule-only no-op is REMOVED and
 *                      must never be reasserted.
 *   And: no user-facing message may claim OFF opens no charts.
 *
 * ===== WHAT MOVED AT dayfacts-1.0.1 (this revision) ==========================
 * Round 1 of this suite measured, and documented in section 6, that BOTH
 * pulled-day-note lanes were hard-disabled (pulledDayNoteLaneEnabled = false /
 * pulledDayNoteTailEnabled = false) and that tnAggregate short-circuited every
 * row to "not requested". THAT GAP IS CLOSED. Re-measured 2026-08-25 against
 * the 1.0.1 bytes: a 3-row OFF day performs 3 runForPatient({onlyDate}) reads,
 * receipt.todayNoteRead === 3, receipt.todayNoteNotRequested === 0, and every
 * receipt row carries todayNote === true. The narrowed round-1 pins are
 * therefore REPLACED by the target pins they parked (section 6), and the
 * settled-OFF control (section 9) now asserts the note reads it used to forbid.
 *
 * ===== THE LAST OPEN GAP CLOSED: NO QUARANTINES REMAIN (round 3) ============
 * Round 2 left exactly one open engine gap: the Day-strip Full-visit-notes
 * tooltip in the mls-connect twins still told the doctor OFF opens nothing. It
 * was quarantined by exact text with an EXPIRY assertion so the day it was
 * fixed this file would go red and force the promotion. dayfacts-1.0.1 fixed
 * it and THE EXPIRY FIRED. Per its own instruction the quarantine is deleted
 * and its parked target pin promoted: FORBIDDEN_OFF_CLAIM now scans all three
 * mls-connect twins WHOLE (section 5b), with a single carve-out for the
 * live-chart gate - a true sentence about an empty Athena tab - which carries
 * its own expiry. Not one assertion in this file excuses a defect any more.
 *
 * Round 3 also pins the two surfaces dayfacts-1.0.1 rewrote that no suite
 * owned: the corrected tooltip and guided-tour line, pinned POSITIVELY inside
 * the toggle's own label (5b - a banned-text scan alone would also pass on a
 * DELETED tooltip), the ScribeFlow Settings toast (5c), and the unscoped
 * visit-save door that now demands a settled choice (9b).
 *
 * ONE surface still speaks the old vocabulary and is deliberately NOT banned:
 * the cv-1.0.0 RETIRED legacy body in the ScribeFlow twins, which runs only on
 * a build with no guarded engine and there really does open no chart. Banning
 * a TRUE sentence would be moving the goalposts to force green, so 5c pins its
 * CONTAINMENT instead - one copy, inside the retired guard's else-branch.
 *
 * The adversarial QUESTION this file asks is unchanged - "does the OFF path
 * tell the truth about what it did?" - only the honest answer moved. Each
 * claim is measured against a CAUSAL CONTROL (an ON run for the bodies claim,
 * a settled-OFF run for the unchosen claim) so a zero can never be the fixture
 * being inert.
 *
 * Synthetic identities only - no PHI.
 * ========================================================================== */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness, makeMonthHarness, flush, ROOT } = require('./1p-pull-harness.js');

const DAY = '2026-08-23';
const TODAY = '2026-08-24';
const ROWS = 3;

/* The pulled day must NOT be "today", or an onlyDate === DAY pin would pass on
   an engine that scoped every read to the calendar today instead. */
assert.notStrictEqual(DAY, TODAY,
  'FIXTURE BROKEN: the pulled day equals today, so no onlyDate pin below can tell the two apart');

/* A message that tells the doctor OFF opens no charts is now a lie. Written
   as executable regexes (never shell-quoted) so a re-added claim is caught. */
const FORBIDDEN_OFF_CLAIM = [
  /no patient charts?\b/i,
  /charts?\s+(?:and|or)\s+visit notes were not opened/i,
  /no patient charts or visit notes were opened/i,
  /read schedule rows only/i
];
/* "Schedule-only complete" survives in the importer for the ONE remaining
   legitimate opt-out (a caller that passes includeHistory:false, e.g. census
   phase 1) and its wording no longer mentions the checkbox - so it is banned
   from an OFF pull's live status stream, but not from the source bytes. */
const FORBIDDEN_OFF_STATUS = FORBIDDEN_OFF_CLAIM.concat([/schedule-only complete/i]);
/* Reasons the OFF path is no longer allowed to speak, at any envelope level. */
const REVOKED_OFF_VOCAB = ['visit-notes-off', 'full-notes-off', 'not-requested'];
function firstMatch(list, text) {
  const s = String(text || '');
  for (const rx of list) if (rx.test(s)) return rx.source;
  return '';
}

(async () => {
  /* ======================================================================
     1) OFF (settled) IS DAY-FACTS MODE - it opens every exact scheduled
        chart and saves its facts. This inverts the old chartCalls===0 pin.
     ====================================================================== */
  const off = makeMonthHarness({ today: TODAY });
  const seeded = off.seedDay(DAY, ROWS);
  const seededIds = seeded.map(r => String(r.patient_external_id));
  const offResult = await off.api.pull({
    date: DAY,
    provider: off.provider,
    includeHistory: true,
    pullVisitBodies: false,
    onStatus: off.onStatus
  });
  await flush(5);
  const hr = offResult.historyReceipt || {};

  assert.strictEqual(off.chartCalls.length, ROWS,
    'day-facts OFF did not open one chart per exact scheduled row (the mandatory floor)');
  assert.deepStrictEqual(off.chartCalls.map(c => String(c.patientId)).sort(), seededIds.slice().sort(),
    'day-facts OFF opened charts for something other than the exact scheduled rows');
  assert.ok(off.chartCalls.every(c => String(c.day) === DAY),
    'day-facts OFF opened a chart while athena was parked on a different day');
  assert.strictEqual(hr.exactIdentityVerified, true,
    'day-facts OFF opened charts without proving exact identity');
  assert.strictEqual(Number(hr.processed || 0), ROWS,
    'day-facts OFF did not process every scheduled row');

  /* the SAVE half of the mandatory floor: chart facts must land in the store,
     not merely be read. A census that measured nothing is not a pass. */
  assert.strictEqual(off.patients.filter(p => p && p.problems).length, ROWS,
    'day-facts OFF opened charts but saved no chart facts');
  assert.ok(hr.storeVerdict && hr.storeVerdict.ok === true && hr.storeVerdict.measured === true,
    'day-facts OFF reported a store verdict that was never measured');
  assert.strictEqual(Number((hr.storeCensus || {}).withContent || 0), ROWS,
    'day-facts OFF left scheduled patients holding no chart content');

  /* ======================================================================
     2) OFF STILL SKIPS THE HISTORICAL BODIES. This is the old
        "no all-visits request" pin, kept verbatim in meaning - it is the
        half of the old contract dayfacts-1.0.0 did NOT revoke.
     ====================================================================== */
  const offAllVisits = off.posted.filter(m => m && m.type === 'mlsAppReadAllVisits').length;
  assert.strictEqual(offAllVisits, 0,
    'day-facts OFF emitted an all-visits body request');
  assert.ok((hr.patients || []).length === ROWS && (hr.patients || []).every(p => p && p.visitsSkipped === true),
    'day-facts OFF did not mark every row visitsSkipped - historical traversal was not skipped');
  assert.strictEqual(hr.allVisitBodiesRequested, false,
    'the OFF receipt claimed the full visit bodies were requested');

  /* ======================================================================
     3) THE RECEIPT NAMES THE NEW MODE HONESTLY. Replaces the old
        reason === 'full-notes-off' / visitNotesMode 'not-requested' pins.
     ====================================================================== */
  assert.strictEqual(hr.visitNotesMode, 'day-facts',
    'the OFF batch receipt did not declare day-facts mode');
  assert.strictEqual(hr.chartFactsRequired, true,
    'the OFF receipt dropped the always-true chart-facts floor');
  assert.strictEqual(hr.visitNotesRequested, false,
    'OFF receipt lost its frozen choice');
  assert.notStrictEqual(hr.reason, 'visit-notes-off',
    'the REMOVED schedule-only no-op reason was reasserted on an OFF pull');
  assert.notStrictEqual(hr.reason, 'full-notes-off',
    'the OFF pull still reported the revoked schedule-only skip reason');
  assert.notStrictEqual(hr.visitNotesMode, 'not-requested',
    'the OFF batch receipt still reports the revoked not-requested mode');
  assert.notStrictEqual(hr.skipped, true,
    'the OFF pull reported its mandatory day-facts batch as skipped');

  /* honest insurance placeholders: a reader that does not exist is never
     reported as verified-none. */
  assert.strictEqual(Number(hr.insuranceAttempted || 0), 0,
    'the OFF receipt claimed insurance reads that no shipped reader performs');
  assert.strictEqual(hr.insuranceReason, 'reader-not-shipped',
    'the OFF receipt did not name the missing insurance reader honestly');
  assert.strictEqual(hr.insuranceComplete, false,
    'the OFF receipt declared insurance complete with zero attempts');
  assert.strictEqual(hr.benefitsComplete, false,
    'the OFF receipt declared benefits complete with zero attempts');

  /* ======================================================================
     4) NOTHING IS INVENTED AS A FAILURE, the pull finishes green, and the
        DAY-LEVEL envelope speaks the same new vocabulary the batch does
        (dayfacts-1.0.1 mapped fullNotesOff -> 'day-facts' at every level).
     ====================================================================== */
  assert.strictEqual(Number(hr.failures || 0), 0,
    'intentional OFF work was reported as a failure');
  assert.strictEqual(Number(hr.todayNoteFailures || 0), 0,
    'OFF invented pulled-day note failures');
  assert.strictEqual(offResult.complete, true,
    'a clean day-facts OFF pull did not finish complete');
  assert.strictEqual(offResult.reason, 'complete',
    'a clean day-facts OFF pull did not report itself complete');
  assert.strictEqual(offResult.visitNotesRequested, false,
    'the OFF pull result lost its frozen choice');
  assert.strictEqual(offResult.visitNotesMode, 'day-facts',
    'the DAY-level result envelope did not declare day-facts mode');
  assert.notStrictEqual(offResult.visitNotesMode, 'not-requested',
    'the DAY-level result envelope still reports the revoked not-requested mode');

  /* Whole-envelope vocabulary sweep: not one nested receipt may still speak a
     revoked reason. Serialize once and assert the sweep actually had bytes to
     read, so an unserializable envelope cannot pass as "clean". */
  let offEnvelopeJson = '';
  try { offEnvelopeJson = JSON.stringify(offResult) || ''; } catch (e) { offEnvelopeJson = ''; }
  assert.ok(offEnvelopeJson.length > 500,
    'the OFF result envelope could not be serialized, so the vocabulary sweep measured nothing');
  REVOKED_OFF_VOCAB.forEach(word => {
    assert.ok(offEnvelopeJson.indexOf(word) === -1,
      'the OFF result envelope still carries the revoked reason "' + word + '" somewhere in its receipts');
  });

  /* ======================================================================
     5) NO USER-FACING MESSAGE MAY CLAIM OFF OPENS NO CHARTS - measured on
        the live status stream AND on the shipped importer bytes (all three
        twins, so a fix that lands on one lane and not the others is caught).
     ====================================================================== */
  assert.ok(off.statusLines.length > 0, 'the OFF pull emitted no status at all - nothing was measured');
  off.statusLines.forEach(line => {
    const hit = firstMatch(FORBIDDEN_OFF_STATUS, line);
    assert.strictEqual(hit, '', 'a day-facts OFF status line still claims no charts were opened (/' + hit + '/): ' + line);
  });
  ['1p-feat_mls_schedimport_exact.js', 'feat_mls_schedimport_exact.js', 'cloned-feat_mls_schedimport_exact.js']
    .forEach(name => {
      const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
      assert.ok(src.length > 100000, name + ' read back too small to have been scanned');
      const hit = firstMatch(FORBIDDEN_OFF_CLAIM, src);
      assert.strictEqual(hit, '', name + ' still ships a message claiming Full Notes OFF opens no charts (/' + hit + '/)');
    });
  /* The revoked stamp vocabulary must not come back on a row either: no row is
     ever stamped todayNoteReason = "visit-notes-off"/"full-notes-off". The stop
     path stamps 'stopped-by-user' in BOTH modes now. */
  const FORBIDDEN_STAMP = [
    /todayNoteReason\s*=\s*['"]visit-notes-off['"]/,
    /todayNoteReason\s*=\s*['"]full-notes-off['"]/,
    /todayNoteReason\s*=\s*['"]not-requested['"]/
  ];
  ['1p-feat_mls_schedimport_exact.js', 'feat_mls_schedimport_exact.js', 'cloned-feat_mls_schedimport_exact.js']
    .forEach(name => {
      const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
      const hit = firstMatch(FORBIDDEN_STAMP, src);
      assert.strictEqual(hit, '', name + ' re-added a revoked todayNoteReason stamp (/' + hit + '/)');
    });

  /* ======================================================================
     5b) THE SETTINGS SURFACE - GAP CLOSED, QUARANTINE EXPIRED, PIN PROMOTED.
        Round 2 found the Day-strip Full-visit-notes tooltip still reading
            "On: open and save every encounter note (slower).
             Off: read schedule rows only - no patient chart or history is
             opened."
        and quarantined it BY EXACT TEXT WITH AN EXPIRY, parking the target
        pin to promote the day it was fixed. dayfacts-1.0.1 fixed it: the
        expiry fired on this run, and per its own instruction the quarantine
        is DELETED and its parked target pin promoted verbatim -
        FORBIDDEN_OFF_CLAIM now scans the mls-connect twins WHOLE, exactly as
        section 5 scans the importer twins. Nothing here is excused any more.

        Re-measured 2026-08-25 across all three 3.7MB twins: with the one
        carve-out sentence removed, all four FORBIDDEN_OFF_CLAIM regexes find
        ZERO hits. That carve-out is the live-chart gate at :43293 ("no
        patient chart is open in Athena yet") - a TRUE statement about an
        empty Athena tab, nothing to do with the OFF preference - and it
        keeps its own expiry so it can never outlive the sentence it excuses.

        The old bad tooltip needs no separate regression pin: both of its
        claims ("Off: read schedule rows only", "no patient chart ...") are
        FORBIDDEN_OFF_CLAIM members, so the whole-file scan now rejects it.
        What the scan cannot do is prove the REPLACEMENT is honest - a
        deleted tooltip would also pass - so the corrected text is pinned
        POSITIVELY below, by both halves, inside the actual checkbox label.
     ====================================================================== */
  const LEGIT_LIVE_CHART_GATE = 'no patient chart is open in Athena yet';
  /* The shipped strings use the curly apostrophe U+2019 and the em dash
     U+2014. Every one is written here as a \u ESCAPE, never as a raw glyph,
     so this file stays ASCII-only end to end: a latin1 writer has turned a
     smart quote in a pinned constant into a control byte in this repo before,
     and a mangled pin would fail against correct bytes. */
  const TOOLTIP_ON_HALF = /On: also save every dated historical encounter note/;
  const TOOLTIP_OFF_HALF = /Off: each chart\u2019s facts and its own-day note only/;
  ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'].forEach(name => {
    const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
    assert.ok(src.length > 1000000, name + ' read back too small to have been scanned');

    /* The one surface the doctor reads WHILE MAKING THE CHOICE. Scoped to the
       toggle's own label, so a truthful sentence sitting somewhere else in
       3.7MB cannot satisfy this. */
    const tglAt = src.indexOf('id="mlsDsVisitTgl"');
    assert.ok(tglAt > 0,
      'EXPIRY: ' + name + ' no longer ships the Full-visit-notes toggle label - re-derive this pin');
    const label = src.slice(tglAt, tglAt + 600);
    assert.ok(TOOLTIP_ON_HALF.test(label),
      name + ': the Full-visit-notes tooltip stopped telling the doctor what ON adds');
    assert.ok(TOOLTIP_OFF_HALF.test(label),
      name + ': the Full-visit-notes tooltip does not tell the doctor that OFF still reads each ' +
      'the facts of each chart and its own-day note - this is the surface the choice is made on');

    /* the guided tour teaches the same truth (dayfacts-1.0.1 rewrote it too) */
    assert.ok(/chooses depth, not whether charts open/.test(src),
      name + ': the guided-tour line no longer teaches that Full visit notes chooses DEPTH, not whether charts open');

    /* PROMOTED TARGET PIN: whole-file scan, one carve-out, no quarantine. */
    assert.ok(src.indexOf(LEGIT_LIVE_CHART_GATE) >= 0,
      'EXPIRY: ' + name + ' no longer ships the live-chart gate sentence this carve-out excuses - re-derive the carve-out');
    const rest = src.split(LEGIT_LIVE_CHART_GATE).join('');
    const hit = firstMatch(FORBIDDEN_OFF_CLAIM, rest);
    assert.strictEqual(hit, '',
      name + ' ships a message claiming Full Notes OFF opens no charts (/' + hit + '/)');
  });

  /* ======================================================================
     5c) THE OTHER SURFACE THE DOCTOR TOGGLES: the Settings checkbox toast in
        the ScribeFlow twins. dayfacts-1.0.1 rewrote it and no suite pinned
        it, so it is pinned here - this file owns the question "does an OFF
        surface tell the truth about what it did".

        These twins DO still carry one sentence of the revoked shape:
            "Full visit notes is off <emdash> no patient charts were opened."
        It is deliberately NOT banned, because it is not a lie: it lives in
        the cv-1.0.0 RETIRED legacy body, which runs only on a build with no
        guarded engine, inside the ELSE of `opts.__pullVisitBodies===true` -
        a path that genuinely calls _pullAllHistories for nobody. Banning a
        true sentence would be forcing green by moving the goalposts.

        What IS pinned is its CONTAINMENT, which is the part that can rot:
        exactly ONE occurrence, sitting AFTER the retirement marker and
        INSIDE that guard's else-branch. Copy it into the guarded day-facts
        lane, or let a second copy appear, and this fails.
     ====================================================================== */
  const SF_TOAST_OFF = /Pulls will read each chart\u2019s facts and its own-day note \u2014 historical visit notes are skipped\./;
  const SF_TOAST_ON = /Full visit notes will be pulled \u2014 pulls run slower but save every encounter note\./;
  const SF_LEGACY_CLAIM = /Full visit notes is off \u2014 no patient charts were opened\./g;
  const SF_RETIRE_MARK = 'cv-1.0.0 (lane convergence 2026-07-27)';
  ['1pScribeFlow.html', 'ScribeFlow.html'].forEach(name => {
    const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
    assert.ok(src.length > 1000000, name + ' read back too small to have been scanned');
    assert.ok(SF_TOAST_OFF.test(src),
      name + ': turning Full visit notes OFF no longer toasts the day-facts truth (the facts of each chart ' +
      'and its own-day note); the doctor is told nothing, or something else');
    assert.ok(SF_TOAST_ON.test(src),
      name + ': turning Full visit notes ON no longer toasts what ON actually adds');

    const retireAt = src.indexOf(SF_RETIRE_MARK);
    assert.ok(retireAt > 0,
      'EXPIRY: ' + name + ' no longer marks the cv-1.0.0 retired legacy body - the pins below ' +
      'have lost their anchor and must be re-derived');
    /* dayfacts-1.0.2: the legacy body's OWN message was reworded too - it now
       states its limitation ("this fallback cannot read chart facts or day
       notes") instead of describing OFF as chartless. ZERO schedule-only
       claims remain anywhere in the shell. */
    SF_LEGACY_CLAIM.lastIndex = 0;
    const spots = [];
    let sfm;
    while ((sfm = SF_LEGACY_CLAIM.exec(src))) spots.push(sfm.index);
    assert.strictEqual(spots.length, 0,
      name + ' carries ' + spots.length + ' copies of the schedule-only claim; zero are allowed since ' +
      'dayfacts-1.0.2 reworded even the retired legacy body to state its own limitation instead');
    const legacyHonest = src.indexOf('this fallback cannot read chart facts or day notes');
    assert.ok(legacyHonest > retireAt,
      name + ': the retired legacy body no longer states its own limitation honestly inside the retired region');
    assert.ok(/opts\.__pullVisitBodies===true/.test(src.slice(Math.max(0, legacyHonest - 800), legacyHonest)),
      name + ': the legacy limitation message is no longer guarded by the legacy opts.__pullVisitBodies branch');
  });

  /* ======================================================================
     6) THE PULLED-DAY ENCOUNTER NOTE IS ATTEMPTED FOR EVERY DAY-FACTS ROW.
        Round 1 documented both lanes hard-disabled here and parked these
        pins. dayfacts-1.0.1 enabled the inline fold-in and the tn/onlyDate
        tail pass and removed tnAggregate's checkbox short-circuit, so the
        parked TARGET PINS are restored - and strengthened: the reads must be
        one per exact scheduled row, scoped to the PULLED day (not today),
        and the receipt tallies must agree with what the reader observed.
     ====================================================================== */
  assert.strictEqual(off.noteCalls.length, ROWS,
    'day-facts OFF skipped the mandatory pulled-day encounter note');
  assert.deepStrictEqual(off.noteCalls.map(c => String(c.patientId)).sort(), seededIds.slice().sort(),
    'the pulled-day note reads did not cover exactly the scheduled rows once each');
  assert.ok(off.noteCalls.every(c => c && String(c.onlyDate || '') === DAY),
    'the pulled-day note read was not scoped to the pulled day - onlyDate is the whole boundary (saw ' +
    JSON.stringify(off.noteCalls.map(c => c && c.onlyDate)) + ', wanted ' + DAY + ')');
  assert.strictEqual(Number(hr.todayNoteNotRequested || 0), 0,
    'day-facts OFF called the mandatory pulled-day note "not requested"');
  assert.strictEqual(Number(hr.todayNoteRead || 0), ROWS,
    'day-facts OFF did not report a pulled-day note read for every row');
  assert.strictEqual(Number(hr.todayNoteRead || 0), off.noteCalls.length,
    'the OFF receipt claimed a different number of pulled-day notes than were actually read (' +
    Number(hr.todayNoteRead || 0) + ' claimed vs ' + off.noteCalls.length + ' observed)');
  assert.strictEqual(Number(hr.todayNoteAttempts || 0), ROWS,
    'the OFF receipt did not record an attempt for every day-facts row');
  assert.ok((hr.patients || []).every(p => p && p.todayNote === true),
    'a day-facts row finished without its pulled-day note stamped read: ' +
    JSON.stringify((hr.patients || []).map(p => p && p.todayNote)));
  assert.ok((hr.patients || []).every(p => !(p && p.todayNoteReason)),
    'a successful pulled-day note still carried a refusal reason: ' +
    JSON.stringify((hr.patients || []).map(p => p && p.todayNoteReason)));
  assert.strictEqual(Number(hr.todayNoteQueued || 0), 0,
    'day-facts OFF queued a background note retry it never attempted');
  assert.strictEqual(Number(hr.todayNoteUnreadFinal || 0), 0,
    'day-facts OFF finished with a pulled-day note still unread');

  /* ======================================================================
     7) CAUSAL CONTROL FOR (2): the same fixture WITH the checkbox ON does
        emit the all-visits reads. Without this, "0 body requests" could be a
        harness that cannot emit them at all.
     ====================================================================== */
  const on = makeMonthHarness({ today: TODAY, visitNotesOn: true });
  on.seedDay(DAY, ROWS);
  const onResult = await on.api.pull({
    date: DAY, provider: on.provider, includeHistory: true, pullVisitBodies: true, onStatus: on.onStatus
  });
  await flush(5);
  const hrOn = onResult.historyReceipt || {};
  assert.strictEqual(on.posted.filter(m => m && m.type === 'mlsAppReadAllVisits').length, ROWS,
    'CONTROL DID NOT APPLY: Full Notes ON emitted no all-visits request, so the OFF zero proves nothing');
  assert.strictEqual(on.chartCalls.length, ROWS,
    'ON did not open the same mandatory chart floor OFF does');
  assert.strictEqual(hrOn.visitNotesMode, 'full',
    'Full Notes ON did not declare full mode');
  assert.strictEqual(hrOn.allVisitBodiesRequested, true,
    'Full Notes ON did not request the full visit bodies');
  assert.ok((hrOn.patients || []).length === ROWS && (hrOn.patients || []).every(p => p && p.visitsSkipped !== true),
    'Full Notes ON skipped historical bodies - the two modes are indistinguishable');
  /* NOTE: this ON run intentionally does not assert completeness. The month
     harness answers mlsAppReadAllVisits without the identity echo the visits
     save demands, so ON lands visits-identity-proof-failed here by fixture
     design; that lane is pinned by the ON suites, not by this OFF file. */

  /* ======================================================================
     8) UNSET / UNSETTLED PREFERENCE IS FAIL-CLOSED AT THE BATCH DOOR.
        Driven through the exported _runHistoryBatch seam because pull()'s
        admission gate freezes a choice before the batch is ever reached -
        the seam is exactly the door dayfacts-1.0.0 hardened. dayfacts-1.0.1
        narrowed the gate further: it refuses ONLY an unchosen/unsettled
        preference, never a settled OFF (proved by the control in 9).
     ====================================================================== */
  const unchosen = makeHarness({ day: DAY, today: TODAY, rows: ROWS, scheduleBorn: false, chartCoverage: true });
  unchosen.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: false, settled: false }),
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, reason: 'choice-unchosen' }),
    write: () => true,
    isPrefKey: () => false
  };
  const blocked = await unchosen.api._runHistoryBatch(unchosen.rows, [], unchosen.onStatus, { scopeDay: DAY });
  await flush(5);

  assert.strictEqual(blocked.reason, 'visit-notes-unchosen',
    'an unchosen preference did not block the batch with the contract reason');
  assert.strictEqual(blocked.visitNotesMode, 'blocked-unchosen',
    'the blocked receipt did not declare blocked-unchosen mode');
  assert.notStrictEqual(blocked.reason, 'visit-notes-off',
    'the REMOVED schedule-only no-op reason came back on the unchosen path');
  assert.strictEqual(unchosen.chartCalls.length, 0,
    'an unchosen account had a patient chart opened on its behalf');
  assert.strictEqual(unchosen.noteCalls.length, 0,
    'an unchosen account had a visit note read on its behalf');
  assert.strictEqual(Number(blocked.requested || 0), 0, 'the blocked receipt requested rows anyway');
  assert.strictEqual(Number(blocked.processed || 0), 0, 'the blocked receipt processed rows anyway');
  assert.strictEqual(Number(blocked.failures || 0), 0, 'fail-closed was reported as a failure');
  assert.strictEqual(blocked.historyRequested, false, 'the blocked receipt still claimed history was requested');
  assert.strictEqual((blocked.patients || []).length, 0, 'the blocked receipt carried patient rows');
  assert.strictEqual(Number(blocked.todayNoteFailures || 0), 0, 'fail-closed invented note failures');
  assert.strictEqual(Number(blocked.todayNoteRead || 0), 0,
    'the blocked receipt claimed pulled-day notes it never read');

  /* ======================================================================
     9) CAUSAL CONTROL FOR (8): the IDENTICAL fixture with a SETTLED-OFF
        preference reads all three charts AND all three pulled-day notes.
        This proves BOTH zeros above are caused by the unset choice, not by
        an inert harness - and it is the second, independent measurement
        (day harness, batch seam) that the day-note lane really runs.
     ====================================================================== */
  const settledOff = makeHarness({ day: DAY, today: TODAY, rows: ROWS, scheduleBorn: false, chartCoverage: true });
  const settledReceipt = await settledOff.api._runHistoryBatch(settledOff.rows, [], settledOff.onStatus, { scopeDay: DAY });
  await flush(5);
  assert.strictEqual(settledOff.chartCalls.length, ROWS,
    'CONTROL DID NOT APPLY: settled-OFF opened no charts either, so the unchosen zero proves nothing');
  assert.strictEqual(settledReceipt.visitNotesMode, 'day-facts',
    'the settled-OFF control did not enter day-facts mode');
  assert.notStrictEqual(settledReceipt.reason, 'visit-notes-unchosen',
    'a SETTLED off choice was mistaken for an unchosen one');
  assert.strictEqual(settledOff.noteCalls.length, ROWS,
    'CONTROL DID NOT APPLY: settled-OFF read no pulled-day note either, so the unchosen note zero proves nothing');
  assert.ok(settledOff.noteCalls.every(c => c && String(c.onlyDate || '') === DAY),
    'the settled-OFF control read a visit note that was not scoped to the pulled day (saw ' +
    JSON.stringify(settledOff.noteCalls.map(c => c && c.onlyDate)) + ')');
  assert.strictEqual(Number(settledReceipt.todayNoteRead || 0), ROWS,
    'the settled-OFF receipt did not report a pulled-day note read for every row');
  assert.strictEqual(Number(settledReceipt.todayNoteNotRequested || 0), 0,
    'the settled-OFF receipt called the mandatory pulled-day note "not requested"');

  /* ORDERING: the day-facts note read rides the row's ALREADY-VERIFIED chart
     open. `seq` is the harness's monotonic counter shared by both readers, so
     this catches a lane that reads a note for a row whose chart never opened
     (or opened afterwards) - a read against an unproven identity. */
  const chartSeqById = new Map(settledOff.chartCalls.map(c => [String(c.patientId), Number(c.seq)]));
  settledOff.noteCalls.forEach(n => {
    const chartSeq = chartSeqById.get(String(n.patientId));
    assert.ok(typeof chartSeq === 'number' && isFinite(chartSeq),
      'a pulled-day note was read for ' + n.patientId + ', a row whose chart was never opened');
    assert.ok(Number(n.seq) > chartSeq,
      'a pulled-day note for ' + n.patientId + ' was read BEFORE its identity-verified chart open (note seq ' +
      n.seq + ' vs chart seq ' + chartSeq + ')');
  });

  /* ======================================================================
     9b) THE UNSCOPED SAVE DOOR IS NO SOFTER THAN THE DAY-SCOPED ONE.
        Section 8 proves the DAY door fails closed on an unsettled choice.
        dayfacts-1.0.1 closed the matching hole on __mlsVisitSavePref's
        UNSCOPED door: enabled() now demands choice.settled === true, so a
        provisional placeholder-namespace 'on' can no longer open every
        historical body behind a doctor who never made the choice. Two doors
        onto the same data are only as strong as the weaker one, which is
        why this file - the one that asks whether OFF fails loudly - pins it.

        Pinned at the SOURCE, deliberately, not through the harness: the
        harness installs a __mlsVisitSavePref STUB carrying only
        runForPatient (measured), so an "executable" enabled() pin here
        would grade the fixture and pass on a shipped door that was wide
        open. A source pin that reads the shipped bytes is the honest
        instrument available at this seam.
     ====================================================================== */
  ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'].forEach(name => {
    const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
    const at = src.search(/function\s+enabled\s*\(\s*\)/);
    assert.ok(at > 0,
      'EXPIRY: ' + name + ' no longer defines the unscoped save door enabled() - re-derive this pin');
    const body = src.slice(at, at + 400);
    assert.ok(/settled\s*===\s*true/.test(body),
      name + ': the unscoped visit-save door stopped requiring a SETTLED choice - an unsettled ' +
      'placeholder "on" can now open every historical body, while the day-scoped door in section 8 ' +
      'still refuses it');
    assert.ok(/state\s*===\s*['"]on['"]/.test(body) && /\.on\s*===\s*true/.test(body),
      name + ': the unscoped visit-save door stopped requiring an explicit ON');
  });

  console.log('qol-off-path-fails-loudly: OK (dayfacts-1.0.1 - OFF is day-facts: ' + ROWS +
    ' verified chart opens + facts saved, ' + ROWS + ' pulled-day encounter notes read onlyDate=' + DAY +
    ' after their own chart open, 0 historical body reads, honest day-facts/insurance receipt with 0 ' +
    'not-requested rows, 0 invented failures, no revoked vocabulary anywhere in the day envelope, ' +
    'no "no charts opened" claim in the status stream or the importer twins; unchosen is fail-closed at ' +
    '0 chart AND 0 note reads; both controls applied. NO QUARANTINES REMAIN: the round-2 tooltip expiry ' +
    'fired and was promoted - all 3 mls-connect twins now scan WHOLE for the forbidden claim (one ' +
    'carve-out, the true live-chart gate, itself expiry-guarded) and ship the corrected tooltip + tour ' +
    'line; ScribeFlow toasts the day-facts truth and its one legacy schedule-only sentence is contained ' +
    'to the retired no-guarded-engine body; the unscoped save door requires a settled choice.)');
})().catch(error => { console.error(error); process.exit(1); });

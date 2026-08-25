'use strict';
/* =============================================================================
 * 1p-daynote-column-and-not-yet-runtime.test.js
 *
 * WHY THE OLD PINS MOVED - dayfacts-1.0.0 (owner 2026-08-25, Codex-accepted).
 *
 * This suite used to pin the PRE-dayfacts world, where the Full-visit-notes
 * checkbox decided WHETHER any chart opened:
 *   - OFF was a schedule-only no-op: zero chart reads, zero note reads, and a
 *     history receipt whose reason was "full-notes-off" / "visit-notes-off";
 *   - the pulled-day note column was called a "historical compatibility
 *     surface" that current pull semantics never fed.
 *
 * The superseding owner DAY contract revokes that meaning outright. The
 * checkbox now selects HOW MUCH history a bulk pull traverses, never whether
 * charts open:
 *   OFF (settled)  = day-facts mode. The per-patient history batch RUNS. Every
 *                    exact scheduled row gets its identity-verified chart open
 *                    plus chart-facts save (the pipelined-parse branch), the
 *                    historical visit traversal is SKIPPED (visitsSkipped),
 *                    and the tn/onlyDate tail pass attempts exactly the pulled
 *                    day's encounter note. Receipt: visitNotesMode
 *                    "day-facts", chartFactsRequired true,
 *                    allVisitBodiesRequested false, and honest insurance
 *                    placeholders (insuranceAttempted 0, insuranceReason
 *                    "reader-not-shipped").
 *   ON             = the same mandatory floor PLUS full historical traversal
 *                    (visitNotesMode "full", one unscoped all-visits read per
 *                    patient).
 *   UNSET/unsettled = fail-closed. The batch returns a blocked receipt whose
 *                    reason is "visit-notes-unchosen" and whose visitNotesMode
 *                    is "blocked-unchosen", with ZERO reads of any kind. The
 *                    old "visit-notes-off" schedule-only no-op is removed and
 *                    must not be reasserted.
 * Also: no user-facing message may claim OFF opens no charts.
 *
 * So the flips below are deliberate: "OFF opened patient charts" was a
 * FAILURE message before and is now the REQUIREMENT, and the suite's teeth
 * moved onto the three modes plus the honesty of the OFF wording.
 *
 * dfc-1.1.0 UPDATE (Codex-contracted, closes the old TODO dayfacts-daynote):
 * the day-facts exact-day read now rides the AllVisits BRIDGE, scoped by
 * hint.onlyDate = the pulled day (plus patientId + todayKey + identity) -
 * EXACTLY ONE scoped bridge read per row per day (dnAlreadyReadToday dedupes).
 * On success the row's own encounter body is saved through the additive
 * scoped save (no reconcile, older visits untouched) and todayNote is true
 * without the legacy ladder. On ANY failure - including an UNSCOPED receipt
 * from a legacy reader, which must NEVER be credited as day proof - the row
 * falls back to the legacy vp/tn ladder (pulledDayNoteLaneEnabled is now
 * true), so the old "tail pass fused off" engine gap is closed. The OFF fuse
 * that survives the move: OFF still never makes an UNSCOPED visit-body read
 * and never persists a HISTORICAL body - the scope of the read moved, the
 * no-unscoped-work protection did not. This suite's fixture answers the
 * bridge with a legacy UNSCOPED receipt, so it pins the fail-closed refusal
 * (scoped-read-unsupported-by-reader) plus the ladder covering every row.
 * ========================================================================== */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeMonthHarness, flush } = require('./1p-pull-harness.js');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

const DAY = '2026-08-23';
const TODAY = '2026-08-24';
const ROWS = 8;

async function main() {
  /* ======================================================================
     1. SOURCE: the revoked vocabulary is gone and the new one is in place.
     ====================================================================== */
  /* The old batch early-return said `receipt.reason = "visit-notes-off"` and
     accepted a schedule-only pull as complete history. dayfacts-1.0.0 removes
     it; the ONLY blocked receipt left is the unchosen one. */
  ok(!/receipt\.reason = "visit-notes-off"/.test(src),
    'the removed OFF schedule-only no-op ("visit-notes-off" batch receipt) was reasserted');
  ok(/receipt\.reason = "visit-notes-unchosen"/.test(src) &&
     /receipt\.visitNotesMode = "blocked-unchosen"/.test(src),
    'the fail-closed unchosen batch receipt is missing');
  ok(/visitNotesMode: visitNotesRequested \? "full" : "day-facts"/.test(src),
    'the batch receipt no longer names day-facts mode for OFF');
  ok(/chartFactsRequired: chartFactsRequired/.test(src) &&
     /var chartFactsRequired = true;/.test(src),
    'the always-true mandatory chart-facts floor is missing from the receipt');
  ok(/insuranceReason: "reader-not-shipped"/.test(src),
    'the honest insurance placeholder (reader-not-shipped) is missing');

  /* "No user-facing message may claim OFF opens no charts." The revoked
     sentence must not exist ANYWHERE in the engine or the UI. */
  const claimsNoCharts = /no patient charts? (?:or visit notes )?(?:were|was) opened/i;
  ok(!claimsNoCharts.test(src), 'the engine still tells the doctor OFF opens no charts');
  ok(!claimsNoCharts.test(ui), 'the UI still tells the doctor OFF opens no charts');
  ok(/Full visit notes is off - each day saved chart facts and attempted only its own pulled-day note; no other historical bodies were read\./.test(src),
    'the month-complete OFF message does not describe day-facts mode');

  /* includeHistory is decoupled from the checkbox: dayPull defaults it TRUE,
     and pullMonth no longer forces it false when the checkbox is OFF. */
  ok(/if \(runOpts\.includeHistory === undefined\) runOpts\.includeHistory = true;/.test(src),
    'dayPull no longer defaults includeHistory to true (the mandatory floor would not run)');
  ok(/var includeHistory = opts\.includeHistory !== false;/.test(src) &&
     !/opts\.includeHistory !== false && !monthFullNotesOff/.test(src),
    'pullMonth still forces includeHistory=false when the checkbox is OFF');
  ok(!/visitNotesRequested === true && opts\.includeHistory !== false && !fullNotesOff/.test(src),
    'the day pull still gates includeHistory on the checkbox');

  /* dfc-1.1.0: the day-facts exact-day read is a SCOPED AllVisits bridge read
     (initiator schedule-batch-same-day, hint.onlyDate + todayKey), it refuses
     fail-closed when the reader cannot prove scope, and the legacy inline
     day-note lane is UN-fused as its fallback. */
  ok(/initiator: "schedule-batch-same-day"/.test(src),
    'the day-facts scoped same-day bridge read (schedule-batch-same-day) is missing');
  ok(/onlyDate: sdDay, todayKey: acctTodayKey\(\)/.test(src),
    'the scoped bridge read does not carry onlyDate + the account todayKey');
  ok(/throw new Error\("scoped-read-unsupported-by-reader"\)/.test(src),
    'an unscoped receipt from a legacy reader is no longer refused as day proof');
  ok(/var pulledDayNoteLaneEnabled = true;/.test(src),
    'the legacy inline day-note lane (the direct-read fallback) is fused off again');

  /* mls-connect: an onlyDate-scoped read is admitted when the preference is
     SETTLED (on or off); unscoped still needs ON; unset is skipped. */
  ok(!/if \(!enabled\(\)\) return Promise\.resolve\(\{ ok: true, skipped: 'preference-off' \}\);/.test(ui),
    'the old unconditional preference bar in runForPatient was reasserted');
  ok(ui.includes("skipped: choiceSettled ? 'preference-off' : 'preference-unchosen'"),
    'runForPatient no longer distinguishes settled-off from unchosen');
  ok(/if \(!enabled\(\) && !\(dayScoped && choiceSettled\)\)/.test(ui),
    'runForPatient does not admit a day-scoped read on a settled preference');
  /* EXECUTE the shipped well-formed-date regex rather than eyeballing it - a
     transport-mangled backslash class here would silently admit garbage. */
  const scopedLiteral = (ui.match(/var dayScoped = !!\(runOpts && (\/[^/]+\/)\.test\(/) || [])[1];
  ok(!!scopedLiteral, 'the runForPatient onlyDate well-formedness test is not a regex literal any more');
  const scopedRe = new RegExp(scopedLiteral.slice(1, -1));
  ok(scopedRe.test('2026-08-23'), 'a well-formed YYYY-MM-DD onlyDate is not admitted');
  ok(!scopedRe.test('2026-8-3'), 'a malformed onlyDate is admitted as day-scoped');
  ok(!scopedRe.test(''), 'an empty onlyDate is admitted as day-scoped');
  ok(!scopedRe.test('2026-08-23 extra'), 'an unanchored onlyDate is admitted as day-scoped');

  /* The day-note COLUMN renderer and the not-yet machinery are the surfaces
     the pulled-day note reports through. They must survive the contract move
     (an OFF row that has not reached its appointment time is "not-yet", never
     an orange failure), so keep pinning them. */
  ok(/function tnColumn\(/.test(src) && /function tnEmitDayNoteColumn\(/.test(src),
    'the day-note column receipt rendering disappeared');
  ok(/function tnStampNotYet\(/.test(src) && /function tnApptPassed\(/.test(src) &&
     /var TNY_NO_ENCOUNTER = /.test(src),
    'the not-yet machinery (slot has not arrived / no encounter yet) disappeared');
  ok(/r\.dn/.test(ui), 'the UI can no longer render the day-note column');

  /* ======================================================================
     2. UNSET / unsettled preference = fail-closed, zero reads.
        _runHistoryBatch is also a compatibility seam, so it must refuse on
        its own rather than trusting an upstream admission gate.
     ====================================================================== */
  const un = makeMonthHarness({ today: TODAY });
  const unRows = un.seedDay(DAY, ROWS).map((row, i) => ({
    _mlsTargetPatientId: un.patients[i].id, patient_external_id: un.patients[i].id,
    _mlsTargetDob: un.patients[i].dob, _mlsTargetMrn: un.patients[i].mrn,
    name: un.patients[i].name, dob: un.patients[i].dob, mrn: un.patients[i].mrn,
    date: DAY, scheduleDate: DAY, appointmentId: 'appt-' + DAY + '-' + (i + 1)
  }));
  un.rt.__mlsVisitNotesPref = {
    read: () => ({ state: 'unset', on: false, settled: false }),
    ensureChosenForBulkPull: () => Promise.resolve({ ok: false, reason: 'unchosen' }),
    write: () => true, isPrefKey: () => false
  };
  const blocked = await un.api._runHistoryBatch(unRows, [], un.onStatus, { scopeDay: DAY });
  eq(blocked.reason, 'visit-notes-unchosen', 'an unchosen account did not get the fail-closed reason');
  eq(blocked.visitNotesMode, 'blocked-unchosen', 'an unchosen account did not get the fail-closed mode');
  ok(blocked.reason !== 'visit-notes-off' && blocked.visitNotesMode !== 'not-requested',
    'the removed schedule-only no-op vocabulary came back on the unchosen path');
  eq(blocked.requested, 0, 'an unchosen batch claimed it requested rows');
  eq(blocked.processed, 0, 'an unchosen batch claimed it processed rows');
  eq(blocked.complete, true, 'the unchosen refusal is not an honest terminal receipt');
  eq(blocked.historyRequested, false, 'an unchosen batch claimed history was requested');
  eq(blocked.failures, 0, 'an unchosen refusal was turned into failed patient rows');
  eq((blocked.retry || []).length, 0, 'an unchosen refusal queued rows for retry');
  eq((blocked.patients || []).length, 0, 'an unchosen refusal emitted patient rows');
  eq(blocked.notRequestedRows, ROWS, 'the unchosen receipt does not account for every row it refused');
  eq(un.chartCalls.length, 0, 'an unchosen account had charts opened on its behalf');
  eq(un.noteCalls.length, 0, 'an unchosen account had day-note reads run on its behalf');
  eq(un.posted.filter(m => m.type === 'mlsAppReadAllVisits').length, 0,
    'an unchosen account had visit bodies read on its behalf');

  /* ======================================================================
     3. OFF (settled) = DAY-FACTS. Charts DO open. Bodies do NOT.
     ====================================================================== */
  const off = makeMonthHarness({ legacyAllVisits: true, today: TODAY });
  off.seedDay(DAY, ROWS);
  const offResult = await off.api.pull({ date: DAY, provider: off.provider,
    includeHistory: true, pullVisitBodies: false, onStatus: off.onStatus });
  const offReceipt = offResult.historyReceipt || {};

  /* the flip: this exact count used to be pinned at 0 charts, then dayfacts
     opened the charts, and dfc-1.1.0 moved the exact-day note onto the same
     AllVisits bridge verb - SCOPED. The fuse that survives every move: OFF
     never makes an UNSCOPED visit-body read. */
  eq(off.chartCalls.length, ROWS, 'OFF did not open one chart per exact scheduled row');
  const offBridgeReads = off.posted.filter(m => m.type === 'mlsAppReadAllVisits');
  eq(offBridgeReads.length, ROWS,
    'OFF did not make exactly one scoped same-day bridge read per exact scheduled row');
  eq(offBridgeReads.filter(m => !(m.hint && m.hint.onlyDate)).length, 0,
    'OFF made an UNSCOPED all-visits bridge read (the historical walk ran)');
  ok(offBridgeReads.every(m => m.hint && m.hint.onlyDate === DAY),
    'an OFF scoped bridge read was not scoped to the pulled day');
  ok(offBridgeReads.every(m => m.hint && m.hint.todayKey === TODAY),
    'an OFF scoped bridge read did not carry the account todayKey');
  ok(offBridgeReads.every(m => m.hint && String(m.hint.patientId || '') && String(m.hint.name || '')),
    'an OFF scoped bridge read did not carry the row identity (patientId + name)');
  eq(new Set(offBridgeReads.map(m => String(m.hint.patientId))).size, ROWS,
    'OFF duplicated or dropped a scoped same-day read for some row (must be one per patient)');
  eq(offReceipt.visitNotesMode, 'day-facts', 'OFF did not run in day-facts mode');
  eq(offReceipt.chartFactsRequired, true, 'OFF did not declare the mandatory chart-facts floor');
  eq(offReceipt.allVisitBodiesRequested, false, 'OFF claimed all visit bodies were requested');
  eq(offReceipt.visitNotesRequested, false, 'OFF misreported the checkbox');
  ok(offReceipt.reason !== 'full-notes-off' && offReceipt.reason !== 'visit-notes-off',
    'the revoked schedule-only skip receipt came back on an OFF day pull');
  ok(offReceipt.skipped !== true, 'OFF reported its mandatory batch as skipped');
  eq(offReceipt.requested, ROWS, 'OFF did not request every exact scheduled row');
  eq(offReceipt.processed, ROWS, 'OFF did not process every exact scheduled row');
  eq(offReceipt.complete, true, 'a clean OFF day-facts pull did not complete');
  eq(offReceipt.exactIdentityVerified, true, 'OFF opened charts without exact identity verification');
  eq(offReceipt.failures, 0, 'OFF turned day-facts work into failed patient rows');
  eq((offReceipt.retry || []).length, 0, 'OFF queued rows for retry/re-checking');
  eq(offResult.ok, true, 'the OFF day pull did not report a verified completion');

  /* honest insurance placeholders - a missing reader is never verified-none */
  eq(Number(offReceipt.insuranceAttempted || 0), 0, 'OFF claimed insurance reads it never made');
  eq(offReceipt.insuranceComplete, false, 'OFF claimed insurance coverage was complete');
  eq(offReceipt.benefitsComplete, false, 'OFF claimed benefits coverage was complete');
  eq(offReceipt.insuranceReason, 'reader-not-shipped',
    'OFF did not declare the insurance reader as not-yet-shipped');

  /* every row: identity-verified chart open + facts save via the pipelined
     parse branch, historical traversal skipped */
  const offPatients = offReceipt.patients || [];
  eq(offPatients.length, ROWS, 'OFF did not emit one receipt row per patient');
  ok(offPatients.every(p => p && p.identityVerified === true),
    'an OFF chart was read without identity verification');
  ok(offPatients.every(p => p && p.parsePipelined === true),
    'OFF did not use the pipelined chart-facts parse/save branch');
  ok(offPatients.every(p => p && p.profileCoverage && p.profileCoverage.complete === true),
    'an OFF row did not save its six-card chart facts');
  ok(offPatients.every(p => p && p.visitsSkipped === true),
    'OFF did not mark the historical visit traversal as skipped');
  ok(offPatients.every(p => p && p.complete === true),
    'a clean OFF day-facts row was not reported complete');
  ok(offPatients.every(p => p && p.dayNoteChartOpen === true),
    'OFF lost the record that this pull opened and verified each chart');
  ok(off.patients.slice(0, ROWS).every(p => p && p.problems && p.athenaChartSnapshot),
    'OFF did not write chart facts into the store');
  /* This fixture's legacy reader ANSWERS the scoped read ok:true with a
     HISTORICAL body and an unscoped receipt - the engine must refuse it
     fail-closed rather than credit or persist it. Zero visits stored is now
     an ACTIVE rejection proof, not a no-read tautology. */
  ok(off.patients.slice(0, ROWS).every(p => (p.visits || []).length === 0),
    'OFF persisted a visit body offered by an unscoped (scope-unproven) reader');
  ok(offPatients.every(p => p && p.sameDayDirectReason === 'scoped-read-unsupported-by-reader'),
    'the engine credited an unscoped legacy answer as scoped day proof (or lost the refusal receipt)');
  ok(!offPatients.some(p => p && p.todayNoteDirectBridge === true),
    'a row claimed direct-bridge day-note provenance from a reader that never proved scope');
  ok(!offPatients.some(p => p && p.sameDayReceipt),
    'a same-day receipt was minted from an unscoped legacy answer');
  ok(offPatients.every(p => p && p.allHistoryReceipt &&
      p.allHistoryReceipt.requested === false && p.allHistoryReceipt.status === 'not-requested'),
    'an OFF row did not declare the historical walk not-requested via the typed all-history receipt');

  /* the wording the contract forbids must not reach the doctor on a real run */
  const offSaid = off.statusLines.join(' ¶ ');
  ok(!claimsNoCharts.test(offSaid), 'an OFF pull told the doctor no charts were opened');
  ok(/Verified complete: schedule 8\/8; history 8\/8; failures 0\./.test(offSaid),
    'an OFF pull did not report its day-facts history as verified complete');

  /* ---------------------------------------------------------------------
     The old TODO dayfacts-daynote engine gap is CLOSED by dfc-1.1.0: the
     pulled-day note lane shipped as the scoped bridge read (asserted above),
     and the legacy inline vp lane is un-fused as its fallback
     (1p-feat_mls_schedimport_exact.js: var pulledDayNoteLaneEnabled = true).
     In this fixture every direct read is refused (unscoped legacy reader),
     so the ladder must cover EVERY row: exactly one scoped vp read per row,
     never a partial or duplicated fan-out, every row's todayNote true, and
     day-facts must never manufacture a day-note FAILURE or a retry.
     --------------------------------------------------------------------- */
  const offOnlyDateReads = off.noteCalls.filter(c => c && /^\d{4}-\d{2}-\d{2}$/.test(String(c.onlyDate || ''))).length;
  eq(offOnlyDateReads, ROWS,
    'day-facts did not attempt exactly one pulled-day note per row after the direct read was refused');
  ok(off.noteCalls.every(c => c && c.onlyDate === DAY),
    'a fallback note read was not scoped to exactly the pulled day');
  eq(new Set(off.noteCalls.map(c => String(c.patientId))).size, ROWS,
    'the fallback pulled-day note pass duplicated or dropped a row');
  ok(offPatients.every(p => p && p.todayNote === true),
    'a day-facts row did not end with its pulled-day note read (todayNote true)');
  eq(Number(offReceipt.todayNoteFailures || 0), 0, 'OFF invented unread pulled-day notes');
  ok(!offPatients.some(p => p && p.todayNote === false),
    'OFF marked a pulled-day note as failed');
  ok(!offPatients.some(p => p && p.todayNoteReason === 'visit-notes-off'),
    'OFF re-stamped the revoked "visit-notes-off" reason onto a day-note row');

  /* ======================================================================
     4. ON = the same floor PLUS full historical traversal.
     ====================================================================== */
  const on = makeMonthHarness({ today: TODAY });
  on.seedDay(DAY, ROWS);
  const onResult = await on.api.pull({ date: DAY, provider: on.provider,
    includeHistory: true, pullVisitBodies: true, onStatus: on.onStatus });
  const onReceipt = onResult.historyReceipt || {};
  const reads = on.posted.filter(message => message.type === 'mlsAppReadAllVisits');

  eq(on.chartCalls.length, ROWS, 'ON did not open one chart per exact scheduled row');
  eq(reads.length, ROWS, 'ON did not read all eight patient histories');
  ok(reads.every(message => !(message.hint && message.hint.onlyDate)),
    'ON used the date-scoped day-note reader for its historical traversal');
  eq(on.noteCalls.length, 0, 'ON duplicated visit reads through the day-note reader');
  eq(onReceipt.visitNotesMode, 'full', 'ON did not run in full mode');
  eq(onReceipt.chartFactsRequired, true, 'ON dropped the mandatory chart-facts floor');
  eq(onReceipt.allVisitBodiesRequested, true, 'ON did not request all visit bodies');
  eq(onReceipt.visitNotesRequested, true, 'ON misreported the checkbox');
  eq(Number(onReceipt.insuranceAttempted || 0), 0, 'ON claimed insurance reads it never made');
  eq(onReceipt.insuranceReason, 'reader-not-shipped',
    'ON did not declare the insurance reader as not-yet-shipped');
  eq(onResult.visitNotesMode, 'full', 'the ON day pull did not report full mode');
  const onPatients = onReceipt.patients || [];
  eq(onPatients.length, ROWS, 'ON did not emit one receipt row per patient');
  ok(onPatients.every(p => p && p.visitsSkipped !== true),
    'ON skipped the historical visit traversal it was asked for');
  ok(onPatients.every(p => p && p.profileCoverage && p.profileCoverage.complete === true),
    'ON dropped the mandatory chart-facts save');

  await flush(3);
  console.log('PASS 1p-daynote-column-and-not-yet: ' + checks +
    ' checks - dfc-1.1.0: unchosen blocks every read (visit-notes-unchosen/blocked-unchosen, 0 charts); ' +
    'OFF runs day-facts (' + ROWS + ' identity-verified chart opens + facts saves, exactly one SCOPED same-day ' +
    'bridge read per row, 0 unscoped reads, 0 historical bodies persisted, honest insurance placeholders, ' +
    'no "no charts were opened" wording); an unscoped legacy answer is refused fail-closed ' +
    '(scoped-read-unsupported-by-reader) and the un-fused vp ladder covers every row (' + offOnlyDateReads +
    ' of ' + ROWS + ' pulled-day notes read, todayNote true on all); ON adds one unscoped all-visits read per patient.');
}

main().catch(error => { console.error(error); process.exit(1); });

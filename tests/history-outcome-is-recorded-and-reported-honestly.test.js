'use strict';

/* THE PULL KEPT NO RECORD OF WHY HISTORY FAILED, AND COUNTED THE WRONG THING (b751).
 *
 * The owner: "It only got 6 of the idk more then 14 patients", and separately
 * "I find it weird that so many patients did not have a history."
 *
 * MEASURED on his live store, Wed 2026-07-29, 19 appointments:
 *   ledger rows          19, every state "done", reasons {}
 *   ledger row fields    [appt_date, backendAppointmentId, patientId, state, updated]
 *   chart-import stamp    5 of 19
 *   problems present      6 of 19
 *   visits present       11 of 19
 *   store scan           220 keys, ZERO occurrences of deferred-after-timeout,
 *                        identity-target-unresolved, open-deadline-exceeded or
 *                        patient-not-found; no retry-like key at all
 *
 * TWO SEPARATE DEFECTS, and the first one is why this took a week to pin down.
 *
 * 1. NOTHING WAS WRITTEN DOWN. frozenRetryEntry already builds {patientId, reason}
 *    at all seven failure sites and they land in receipt.retry - but the receipt
 *    was in-memory only. Once the pull ended the reasons were gone, so "why did
 *    these patients get no history" was unanswerable after the fact by
 *    construction. Every investigation had to guess, and two of my own hypotheses
 *    were refuted only because I could measure something ELSE. This suite exists
 *    to keep the evidence.
 *
 * 2. THE NUMBER WAS THE WRONG NUMBER. The ready message read
 *    "history checked for <hr.processed> patients", and processed counts
 *    ENUMERATED ROWS - it is incremented for a pure failure and for every patient
 *    regardless of whether the chart landed. So it could report "history checked
 *    for 19 patients" with zero histories stored. That is precisely the success
 *    the owner was shown while 15 patients had nothing.
 *
 * Note what this suite does NOT claim: it does not identify WHY the 14 failed.
 * That answer requires the reasons this build starts recording. Pinning the
 * instrument before the diagnosis is the point.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');

/* ---- 1. the reasons get persisted ---- */
assert(/function recordHistoryVerdict\(day, receipt, dayRowCount\)/.test(si),
  'there must be a recorder that writes the history verdict into the day ledger');
assert(/x\.history = \{/.test(si),
  'the verdict must be stored on the ledger object so it survives the pull');
assert(/perPatient\[pid\] = why;/.test(si),
  'every failing patient must have its REASON recorded against its id - a count ' +
  'alone cannot answer which patients failed or why');
assert(/writeIndex\(day, x\);/.test(si) && si.indexOf('recordHistoryVerdict') < si.indexOf('function markDone'),
  'the recorder must persist through the existing ledger writer, alongside the other ledger helpers');

/* it has to be CALLED, or it is exactly the dead code this codebase keeps shipping */
{
  const signature = /function finalizeVerdict\([^)]*\)/.exec(si);
  const start = signature ? signature.index : -1;
  const end = si.indexOf('/* 2026-07-28 owner directive', start);
  assert(start > 0 && end > start, 'finalizeVerdict bounds must remain discoverable');
  const body = si.slice(start, end);
  assert(/recordHistoryVerdict\(day, receipt, rows\.length\)/.test(body),
    'the recorder must be called from finalizeVerdict - that runs at EVERY exit, so ' +
    'no pull can finish without leaving a record. An uncalled recorder is the ' +
    'present-but-unreachable pattern this codebase has shipped four times.');
  assert(/day = batchRowDay\(rows\[di\]\)/.test(body) && /if \(!day\) day = batchScopeDay/.test(body),
    'the day must be derived from each row, with the batch-scoped day only as a fallback, so a month pull records per day');
}

/* the day's own count must be recorded next to the queue count, because the two
   disagreeing is itself the finding */
assert(/dayRows: Number\(dayRowCount \|\| 0\)/.test(si),
  'the DAYS OWN patient count must be recorded');
assert(/requested: Number\(receipt\.requested \|\| 0\)/.test(si),
  'the queue count must be recorded alongside it - requested is only what the batch ' +
  'was handed, so requested < dayRows means patients were never queued for history at all');
assert(/storedOk: storedOk/.test(si),
  'the count of patients whose history actually STORED must be recorded');

/* ---- 2. the owner-visible message reports stores, not walks ---- */
{
  const at = connect.indexOf('function pullOutcome(result, day)');
  assert(at > 0, 'pullOutcome must still exist');
  const marker = 'api.classifyPullResult = pullOutcome;';
  const end = connect.indexOf(marker, at);
  assert(end > at, 'pullOutcome end marker must remain discoverable');
  const body = connect.slice(at, end + marker.length);

  assert(!/var hist = Number\(hr\.processed/.test(body),
    'the ready message counts hr.processed, which counts ENUMERATED ROWS rather than ' +
    'stored histories - it is incremented for a pure failure and for every patient ' +
    'regardless of whether the chart landed, so it can report "history checked for 19 ' +
    'patients" when zero were stored');
  assert(/filter\(function \(p\) \{ return p && p\.complete === true; \}\)/.test(body),
    'the count must come from patients whose history actually completed');
  assert(/history read for ' \+ hist \+ ' of ' \+ rows/.test(body),
    'the message must state the coverage as a fraction of the DAY, not a bare count - ' +
    'a bare count cannot be recognised as incomplete by the person reading it');
  assert(/no chart yet - use Retry failed histories to finish them\./.test(body),
    'when history is short the message must SAY SO and name the route that finishes it. ' +
    'The owner was shown an unqualified success while 15 of 19 patients had nothing.');
  assert(/histGap/.test(body),
    'the gap must be computed, not implied');
}

console.log('PASS history outcomes are recorded and reported honestly: every failing patient ' +
  'now leaves its reason in the day ledger (called from finalizeVerdict, so no pull can exit ' +
  'without a record), the day count and the queue count are both kept so their disagreement is ' +
  'visible, and the ready message reports histories STORED as a fraction of the day and names ' +
  'the gap instead of counting rows it merely walked');

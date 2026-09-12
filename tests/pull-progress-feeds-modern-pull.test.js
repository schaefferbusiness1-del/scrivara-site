'use strict';

/* THE PULL PROGRESS PANEL LIVES AGAIN (si-2.1.0 + FAB move) - owner:
 * "whatever happened to the amazing running icon thing in the bottom left".
 *
 * What happened: the panel (__mlsPullProgress, b113) watches
 * window.__mlsDayHistoryPull.state, a contract only the LEGACY day-history
 * engine fed. Modern pulls run feat_mls_schedimport_exact, which never wrote
 * it - the panel has been structurally dead on every modern pull. The modern
 * sweep now feeds it: start/current/settle/resolve/end, with the si-1.9.4
 * never-reset law on sub-batches, provisional pipelined rows corrected at
 * finalization, tallies recomputed from rows, and the legacy engine's
 * mid-run state never stolen. The pill also moves to the bottom-LEFT, where
 * the owner remembers it (free since the bubbles retired). */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const si = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* ---- source pins ------------------------------------------------------- */
assert(connect.includes("'#' + FAB + '{position:fixed;left:14px;bottom:150px;"),
  'the pull pill must sit bottom-LEFT');
assert(si.includes('var ppRequestedTotal = rows.length + unresolved.length;') &&
  si.includes('ppStart((sweepProgressTotal > ppRequestedTotal ? sweepProgressTotal : ppRequestedTotal), sweepProgressBase);') &&
  si.includes('ppSettleUnresolved(unresolved);'),
  'the modern sweep must start progress with the complete requested scope, including identity refusals');
assert(si.includes('ppCurrent(row.name || (target && target.name) || "");'),
  'the sweep must publish the patient being read');
assert(si.includes('one.__ppRow = ppSettle(row.name,'), 'every processed row must settle into the panel state');
assert(si.includes('ppResolve(pOne.__ppRow, pOne.complete === true,'),
  'pipelined rows must be corrected at finalization');
assert(si.includes('ppSettleUnvisited(rows, i, "stopped-by-user");') &&
  si.includes('ppSettleUnvisited(rows, i, "deferred-after-batch-deadline");') &&
  si.includes('ppSettleUnvisited(rows, i, "athena-search-surface-unresponsive");') &&
  si.includes('ppSettleUnvisited(rows, i + 1, "deferred-after-timeout");'),
  'an early exit can still omit the unvisited remainder from visible progress');
assert(si.includes('oneQueuedForSweep ? ppAutomaticRecheckReason(one)') &&
  si.includes('fpQueuedForSweep ? ppAutomaticRecheckReason(fp)'),
  'automatic re-check rows bypass the proof-aware progress wording');
/* b744 #36: the reporter's close moved OUT of the per-patient finally — it
   used to fire before the automatic sweeps, killing and re-creating the whole
   panel at every sweep boundary (elapsed reset, hidden reset, and the pts
   pull shield dropping between passes). Now: the finally closes it only on
   the THROW path, and the outer batch closes it exactly once after sweeps. */
assert(si.includes('if (!batchBodyCompleted && !sweepDepth) safe(ppEnd);'),
  'a thrown batch must still end the progress state (throw-path fallback)');
const outerSweepAt = si.indexOf('if (!sweepDepth && !__stpStopped) try {');
const afterOuterSweep = si.indexOf('/* ===== cap-1.0.0', outerSweepAt);
assert(outerSweepAt >= 0 && afterOuterSweep > outerSweepAt,
  'the outer automatic-sweep lifecycle could not be isolated');
const outerSweepBlock = si.slice(outerSweepAt, afterOuterSweep);
const outerCloseComment = outerSweepBlock.indexOf('the OUTER batch closes the progress reporter exactly once');
const outerClose = outerSweepBlock.indexOf('safe(ppEnd);', outerCloseComment);
assert(outerSweepBlock.includes('await runHistoryBatch(swept.rows') && outerCloseComment > 0 && outerClose > outerCloseComment,
  'the OUTER batch must end the progress state only after its sweeps');
/* ppend-1.0.0 (2026-08-28): this counted safe(ppEnd) inside the sliced region
   and demanded exactly one. There are two now, and the second is a FIX for the
   very failure this file is about: a stopped pull used to leave s.running true,
   so the STOP card never froze its clock - an "endless saving" state, which is
   an owner-reported defect. Stop was given its own terminal settle.
   The two are MUTUALLY EXCLUSIVE - `!sweepDepth && !__stpStopped` versus
   `!sweepDepth && __stpStopped` - so no run can reach both, and a naive count
   cannot see that. Requiring one would have meant deleting the stop settle and
   restoring the frozen clock.
   Pinned as the property instead: every terminal branch closes the reporter
   exactly once, and the branches cannot overlap. */
{
  const closes = [...outerSweepBlock.matchAll(/if \(!sweepDepth && (!?)__stpStopped\) (?:try )?\{/g)]
    .map((m) => m[1] === '!');
  assert.strictEqual(closes.length, 2,
    'the outer sweep no longer has exactly two terminal branches (found ' + closes.length +
    ') - re-derive this pin against whatever lifecycle replaced them rather than adjusting the count');
  assert.deepStrictEqual([...closes].sort(), [false, true],
    'the two terminal branches are no longer mutually exclusive on __stpStopped - a single run could close the progress reporter twice, or leave it open');
  assert.strictEqual(outerSweepBlock.split('safe(ppEnd);').length - 1, 2,
    'the OUTER sweep lifecycle must end the progress state exactly once PER terminal branch - a missing one leaves the card running forever, which is the endless-saving report');
  /* The stop branch specifically: it is the one that was missing, so pin that
     it still settles rather than merely existing. */
  const stopAt = outerSweepBlock.search(/if \(!sweepDepth && __stpStopped\) \{/);
  assert(stopAt >= 0, 'the stop-path terminal settle is gone - a stopped pull would leave its card running');
  const stopBlock = outerSweepBlock.slice(stopAt, stopAt + 260);
  assert(stopBlock.includes('finalizeVerdict(false);') && stopBlock.includes('safe(ppEnd);'),
    'the stop path no longer finalizes AND ends - a stopped pull would show a clock that never freezes');
}
assert(!si.includes('} finally { historyBatchRunning = false; ppEnd(); }'),
  'the old pre-sweep close must stay gone - it was the panel-teardown bug');
assert(si.includes('if(g.state&&g.state.running===true) return null;'),
  'a mid-run LEGACY state must never be stolen');

/* ---- runtime: drive the sliced helpers --------------------------------- */
const helpers = si.slice(si.indexOf('function ppState()'), si.indexOf('var sweepDepth = Number('));
const localPatients = {
  'refused-1': { id: 'refused-1', name: 'Same Synthetic Name' },
  'refused-2': { id: 'refused-2', name: 'Same Synthetic Name' }
};
const ctx = { window: {}, console: console };
ctx.window = ctx;
ctx.findPatient = (id) => localPatients[String(id)] || null;
vm.createContext(ctx);
vm.runInContext(helpers, ctx, { filename: 'si-pp-helpers.js' });

/* fresh pull */
ctx.ppStart(18, 0);
let S = ctx.window.__mlsDayHistoryPull.state;
assert(S.running === true && S.total === 18 && S.done === 0, 'start must arm the panel');
ctx.ppCurrent('Anne Snipes Moss');
assert.strictEqual(S.current, 'Anne Snipes Moss');
const r1 = ctx.ppSettle('Anne Snipes Moss', true, '');
assert(S.done === 1 && S.ok === 1 && S.failed === 0, 'a complete row counts as saved');
const r2 = ctx.ppSettle('Bernard P Brooks', false, 'finishing…', true);
assert(S.done === 2 && S.ok === 1 && S.failed === 0, 'a PENDING pipelined row must not count as failed');
ctx.ppSettle('Zed Unresolved', false, 'identity-target-unresolved');
assert(S.failed === 1, 'a real refusal counts as failed');
ctx.ppResolve(r2, true, '');
assert(S.ok === 2 && S.failed === 1, 'finalization must upgrade the pending row and recount');
void r1;

/* Unresolved-at-entry rows are terminal requested outcomes too. The live
   refuter was 22 requested = 14 readable + 8 source-proof-conflict, while the
   panel incorrectly closed as 14/14 saved. Names stay out of this fixture and
   duplicate display labels remain distinct through their local ids. */
ctx.ppStart(22, 0);
ctx.ppSettleUnresolved(Array.from({ length: 8 }, (_, i) => ({
  patientId: 'refused-' + (i + 1), reason: 'source-proof-conflict'
})));
for (let i = 0; i < 14; i++) ctx.ppSettle('Readable chart', true, '', false, { pid: 'readable-' + (i + 1) });
ctx.ppEnd();
S = ctx.window.__mlsDayHistoryPull.state;
assert.strictEqual(S.total, 22, 'progress hid unresolved rows from the requested total');
assert.strictEqual(S.done, 22, 'progress did not account for every requested row');
assert.strictEqual(S.ok, 14, 'identity refusals changed the saved count');
assert.strictEqual(S.failed, 8, 'identity refusals were not reported as terminal attention rows');
assert.strictEqual(S.rows.filter(r => r.reason === 'source-proof-conflict').length, 8,
  'the exact fail-closed refusal code was not preserved in progress');
const sameNameRefusals = S.rows.filter(r => r.name === 'Same Synthetic Name');
assert.strictEqual(sameNameRefusals.length, 2,
  'distinct exact-id patients sharing one name collapsed into one refusal row');
assert.notStrictEqual(sameNameRefusals[0].k, sameNameRefusals[1].k,
  'same-name refusal rows were not keyed by their distinct exact local ids');

/* Pid-less refusals can arrive in separate sub-batches. Their numbered labels
   may repeat, but their report keys must not; re-settling the same entry must
   still replace its earlier verdict in the latest-key tally. */
ctx.ppStart(23, 22);
const pidlessA = { reason: 'patient-not-resolved' };
ctx.ppSettleUnresolved([pidlessA]);
ctx.ppStart(24, 23);
const pidlessB = { reason: 'patient-not-resolved' };
ctx.ppSettleUnresolved([pidlessB]);
assert.notStrictEqual(pidlessA.__ppReportKey, pidlessB.__ppReportKey,
  'distinct pid-less sub-batch refusals received a colliding report key');
const beforeRestettle = S.done;
ctx.ppSettleUnresolved([pidlessA]);
assert.strictEqual(S.done, beforeRestettle,
  're-settling the same pid-less refusal created a second progress outcome');

/* Rows that the batch never visits are terminal retry outcomes, not empty
   space between done and total. This helper only reports the already-decided
   suffix; it does not run a chart operation. */
ctx.batchScopeDay = '2026-09-15';
ctx.ppStart(4, 0);
ctx.ppSettle('Saved synthetic chart', true, '', false, { pid: 'saved-1' });
const unvisited = [
  { name: 'Saved synthetic chart', _mlsTargetPatientId: 'saved-1' },
  { name: 'Stopped synthetic chart', _mlsTargetPatientId: 'stopped-2' },
  { name: 'Stopped synthetic chart', _mlsTargetPatientId: 'stopped-3' },
  { _mlsTargetPatientId: 'stopped-4' }
];
ctx.ppSettleUnvisited(unvisited, 1, 'stopped-by-user');
S = ctx.window.__mlsDayHistoryPull.state;
assert.strictEqual(S.done, 4, 'the stopped suffix did not fill the visible requested census');
assert.strictEqual(S.ok, 1, 'reporting the stopped suffix changed the saved count');
assert.strictEqual(S.failed, 0, 'the doctor\'s Stop was counted as failed charts needing attention');
assert.strictEqual(S.stoppedRows, 3, 'the stopped suffix is not counted separately from real failures');
assert.strictEqual(S.targetDate, '2026-09-15', 'the progress receipt lost the exact day being pulled');
assert.strictEqual(S.rows.filter(r => r.reason === 'stopped-by-user').length, 3,
  'the exact stopped retry code was not preserved in progress');

/* The existing renderer gives queued-for-automatic-recheck the stronger
   sentence “chart saved — full visit notes queued”. The importer may emit
   that code only when it has proof for both clauses. */
ctx.pullVisitBodies = true;
assert.strictEqual(ctx.ppAutomaticRecheckReason({ organized: true, dobVerified: true }), 'queued-for-automatic-recheck',
  'a proven saved chart in full-notes mode lost the specific queued wording');
assert.strictEqual(ctx.ppAutomaticRecheckReason({ organized: false, dobVerified: true }), 're-checking',
  'a row with no saved chart falsely claims its chart was saved');
ctx.pullVisitBodies = false;
assert.strictEqual(ctx.ppAutomaticRecheckReason({ organized: true, dobVerified: true }), 're-checking',
  'a day-facts row falsely claims full visit notes were queued');

/* sub-batch: the bar NEVER resets (si-1.9.4 law) */
const beforeSubBatch = { done: S.done, rows: S.rows.length, total: S.total };
ctx.ppEnd();
assert(S.running === false, 'end must disarm');
ctx.ppStart(18, 15);
assert(S.running === true && S.done === beforeSubBatch.done && S.rows.length === beforeSubBatch.rows && S.total === 18 && beforeSubBatch.total === 4,
  'a sub-batch (base>0) must preserve done/rows - the bar only ever moves forward');

/* Stop is durable terminal truth, not a transient button label. A fresh run
   clears it and stamps its own exact target date. */
ctx.receipt = { stoppedByUser: true, reason: 'stopped-by-user' };
ctx.window.__mlsPullStopRequested = true;
ctx.ppEnd();
assert.strictEqual(S.stopped, true, 'ending a stopped pull lost the terminal Stop verdict');
assert.strictEqual(S.stopReason, 'stopped-by-user', 'the terminal Stop reason drifted');
ctx.window.__mlsPullStopRequested = false;
ctx.batchScopeDay = '2026-09-22';
ctx.ppStart(2, 0);
S = ctx.window.__mlsDayHistoryPull.state;
assert.strictEqual(S.stopped, false, 'a new pull inherited the previous Stop verdict');
assert.strictEqual(S.targetDate, '2026-09-22', 'a new pull inherited the previous target date');

/* legacy engine mid-run is never stolen */
ctx.window.__mlsDayHistoryPull = { state: { running: true, total: 5 } };  /* no __si marker */
ctx.ppStart(9, 0);
assert(ctx.window.__mlsDayHistoryPull.state.total === 5 && !ctx.window.__mlsDayHistoryPull.state.__si,
  'a running legacy state must be left alone');

console.log('PASS pull progress feeds modern pull: armed on sweep start, per-patient current, pending rows never read as failed, finalization recounts, sub-batches never reset the bar, legacy state never stolen, pill at bottom-left');

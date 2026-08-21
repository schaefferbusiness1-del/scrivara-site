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
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* ---- source pins ------------------------------------------------------- */
assert(connect.includes("'#' + FAB + '{position:fixed;left:14px;bottom:150px;"),
  'the pull pill must sit bottom-LEFT');
assert(si.includes('ppStart((sweepProgressTotal > rows.length ? sweepProgressTotal : rows.length), sweepProgressBase);'),
  'the modern sweep must start the progress state');
assert(si.includes('ppCurrent(row.name || (target && target.name) || "");'),
  'the sweep must publish the patient being read');
assert(si.includes('one.__ppRow = ppSettle(row.name,'), 'every processed row must settle into the panel state');
assert(si.includes('ppResolve(pOne.__ppRow, pOne.complete === true,'),
  'pipelined rows must be corrected at finalization');
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
assert.strictEqual(outerSweepBlock.split('safe(ppEnd);').length - 1, 1,
  'the OUTER sweep lifecycle must end the progress state exactly once');
assert(!si.includes('} finally { historyBatchRunning = false; ppEnd(); }'),
  'the old pre-sweep close must stay gone - it was the panel-teardown bug');
assert(si.includes('if(g.state&&g.state.running===true) return null;'),
  'a mid-run LEGACY state must never be stolen');

/* ---- runtime: drive the sliced helpers --------------------------------- */
const helpers = si.slice(si.indexOf('function ppState()'), si.indexOf('var sweepDepth = Number('));
const ctx = { window: {}, console: console };
ctx.window = ctx;
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

/* sub-batch: the bar NEVER resets (si-1.9.4 law) */
ctx.ppEnd();
assert(S.running === false, 'end must disarm');
ctx.ppStart(18, 15);
assert(S.running === true && S.done === 3 && S.rows.length === 3 && S.total === 18,
  'a sub-batch (base>0) must preserve done/rows - the bar only ever moves forward');

/* legacy engine mid-run is never stolen */
ctx.window.__mlsDayHistoryPull = { state: { running: true, total: 5 } };  /* no __si marker */
ctx.ppStart(9, 0);
assert(ctx.window.__mlsDayHistoryPull.state.total === 5 && !ctx.window.__mlsDayHistoryPull.state.__si,
  'a running legacy state must be left alone');

console.log('PASS pull progress feeds modern pull: armed on sweep start, per-patient current, pending rows never read as failed, finalization recounts, sub-batches never reset the bar, legacy state never stolen, pill at bottom-left');

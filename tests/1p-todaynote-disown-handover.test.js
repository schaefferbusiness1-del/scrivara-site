'use strict';

/* nih-1.0.0 — the deferred day-note DISOWN handover.
 *
 * Measured live 2026-08-18 (r18, notes-ON pull, athena hidden): 15 rows queued
 * into _tnDefer during an ~11-minute pull; the lease-wait cap dropped 13 of
 * them mid-pull; the post-pull round deadlined the other 2. Only attempt()
 * ever cleared entry.todayNoteDeferred, so the 13 dropped rows kept the flag
 * forever, niSyncFromReceipt skipped them ("still _tnDefer's row"), and the
 * notes-idle engine sat at gate "nothing-due" while the pull card said notes
 * were being saved in the background. The rows were stranded outside BOTH
 * queues.
 *
 * The fix: every queued row carries disown(); BOTH drop paths (the lease-wait
 * cap and tnDropDeferredQueue) disown each dropped row BEFORE their settleDay
 * callbacks run, so the settle's niSyncFromReceipt can adopt the rows into
 * the idle queue. Stop stays safe: the stopped-by-user sync guard refuses
 * enqueue regardless of the flag.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'latin1');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- 1. the queue item carries disown() and the push forwards it ---- */
const disownStart = src.indexOf('disown: function () {');
ok(disownStart >= 0, 'the deferred queue item must define a disown() callback');
const disownEnd = src.indexOf('}); },', disownStart);
ok(disownEnd > disownStart, 'the disown() body must close with its emit call');
const disownBody = src.slice(disownStart + 'disown: function () {'.length, disownEnd + '});'.length);
const disownDef = [null, disownBody];
ok(/todayNoteDeferred = false/.test(disownDef[1]), 'disown() must clear todayNoteDeferred');
ok(/todayNoteReason/.test(disownDef[1]), 'disown() must leave an honest reason on the row');
ok(/disown:\s*isFn\(item\.disown\)\s*\?\s*item\.disown\s*:\s*null/.test(src),
  'tnQueueDeferred must forward disown into the queue entry');

/* ---- 2. BOTH drop paths disown before their settle callbacks ---- */
function spanOf(anchor) {
  const i = src.indexOf(anchor);
  ok(i >= 0, 'anchor present: ' + anchor.slice(0, 40));
  return { text: src.slice(i, i + 1600), at: i };
}
const leaseDrop = spanOf('if (_tnDefer.waits >= TN_DEFER_LEASE_WAITS) {');
const termDrop = spanOf('function tnDropDeferredQueue(reason) {');
for (const [name, span] of [['lease-wait drop', leaseDrop], ['tnDropDeferredQueue', termDrop]]) {
  const disownAt = span.text.indexOf('d.disown()');
  const settleAt = span.text.search(/seen(Drop)?\.push\(d\.settleDay\)|indexOf\(d\.settleDay\)/);
  ok(disownAt >= 0, name + ' must disown every dropped row');
  ok(settleAt >= 0, name + ' must still run its settleDay callbacks');
  ok(disownAt < settleAt, name + ' must disown BEFORE settle, so the sync can adopt the rows');
}

/* ---- 3. the guard this fix routes around must still exist (design pin) ---- */
ok(/todayNoteDeferred === true\) return;\s*\/\* still _tnDefer's row \*\//.test(src),
  "niSyncFromReceipt must still skip rows _tnDefer owns — disown is the ONLY release besides attempt()");
ok(/window\.__mlsPullStopRequested === true; \}, false\)\) return 0;/.test(src),
  'the stopped-by-user sync guard must survive (Stop never re-drives Athena)');

/* ---- 4. executed semantics of the disown closure itself ---- */
{
  const entry = { todayNoteDeferred: true, todayNoteReason: '' };
  let emitted = 0;
  const ctx = vm.createContext({
    entry,
    safe: (fn) => { try { return fn(); } catch (e) { return undefined; } },
    tnEmitDayNoteColumn: () => { emitted++; }
  });
  const fn = vm.runInContext('(function () {' + disownDef[1] + '})', ctx);
  fn();
  ok(entry.todayNoteDeferred === false, 'executed: disown clears the flag');
  ok(entry.todayNoteReason === 'deferred-dropped', 'executed: disown stamps the drop reason when none exists');
  ok(emitted === 1, 'executed: disown repaints the day-note column');
  const entry2 = { todayNoteDeferred: true, todayNoteReason: 'deadline' };
  const ctx2 = vm.createContext({ entry: entry2, safe: (fn2) => { try { return fn2(); } catch (e) { return undefined; } }, tnEmitDayNoteColumn: () => {} });
  vm.runInContext('(function () {' + disownDef[1] + '})', ctx2)();
  ok(entry2.todayNoteReason === 'deadline', 'executed: disown never overwrites a real reason');
}

/* ---- 5. two-sided: the round's own batch splice needs NO disown (attempt()
        clears the flag there) and must remain the only other splice ---- */
const splices = src.split('_tnDefer.queue.splice(0, _tnDefer.queue.length)').length - 1;
ok(splices === 3, 'exactly three queue splices: lease-wait drop, terminal drop, and the round batch (got ' + splices + ')');

console.log('PASS 1p today-note disown handover: ' + checks + ' checks — dropped rows are released to the idle queue before settle, Stop stays fenced, and the closure semantics execute');

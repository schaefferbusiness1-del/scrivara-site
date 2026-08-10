/* qol-1.2 control: A DAY PULL FRONTS ONCE AND RESTORES ONCE.
   2026-08-10 ("it keeps pulling me to mls"): every presence-assisted read
   fronted athena and immediately yanked focus back — N yanks for N patients.
   The restore is now deferred; the next read cancels the timer and inherits
   the batch's ORIGINAL previous-tab. Executed here with stub timers: two
   consecutive reads produce exactly ONE restore, aimed at the FIRST read's
   captured previous-tab. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');

/* extract the deferral helper (single-scope function, stub its dependencies) */
const fnStart = bg.indexOf('function __mlsDeferRestoreAfterRead(state)');
assert.ok(fnStart > 0, 'deferral helper missing');
const fnEnd = bg.indexOf('\n  }', bg.indexOf('__mlsFgDeferredRestore = slot;', fnStart)) + 4;
const fnSrc = bg.slice(fnStart, fnEnd);

const timers = [];
let restoreCalls = [];
const sandbox = {
  setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
  clearTimeout: t => { if (t) t.cleared = true; },
  __mlsRestoreFocusAfterRead: s => restoreCalls.push(s),
};
const harness = new Function('setTimeout', 'clearTimeout', '__mlsRestoreFocusAfterRead',
  'var __mlsFgDeferredRestore = null;\n' + fnSrc + '\nreturn { defer: __mlsDeferRestoreAfterRead, pending: function () { return __mlsFgDeferredRestore; } };');
const h = harness(sandbox.setTimeout, sandbox.clearTimeout, sandbox.__mlsRestoreFocusAfterRead);

const stateA = { athTabId: 7, athWinId: 1, prevTabId: 42, prevWinId: null, appTabId: 9 };
const stateB = { athTabId: 7, athWinId: 1, prevTabId: 99, prevWinId: null, appTabId: 9 };

/* read 1 finishes -> restore deferred, nothing fired */
h.defer(stateA);
assert.strictEqual(restoreCalls.length, 0, 'no immediate restore (the old per-read yank)');
assert.strictEqual(timers.length, 1, 'one deferred timer armed');

/* read 2 finishes -> the pending timer is cancelled, the ORIGINAL prev is inherited */
h.defer(stateB);
assert.strictEqual(timers[0].cleared, true, 'the first timer is cancelled by the next read');
assert.strictEqual(timers.length, 2, 'a fresh timer replaces it');
assert.strictEqual(restoreCalls.length, 0, 'still no mid-batch restore');

/* batch ends quietly -> the ONE restore fires with the FIRST read's state */
timers[1].fn();
assert.strictEqual(restoreCalls.length, 1, 'exactly one restore for the whole batch');
assert.strictEqual(restoreCalls[0].prevTabId, 42,
  'the restore returns the doctor to where the BATCH began (inherited original prev-tab), not the mid-batch capture');

/* a fired slot clears itself so a later batch starts clean */
assert.strictEqual(h.pending(), null, 'slot cleared after firing');

/* structural: finish() defers, the immediate call is gone, the next front inherits */
assert.ok(bg.indexOf('__mlsDeferRestoreAfterRead(__fgState); __fgState = null;') > 0, 'finish() schedules the deferred restore');
assert.ok(!bg.includes('__mlsRestoreFocusAfterRead(__fgState)'), 'non-vacuity: the OLD per-read restore call no longer exists');
assert.ok(bg.indexOf('clearTimeout(__dSlot.timer)') > 0 && bg.indexOf('return __dSt;') > 0,
  'the next front cancels a pending deferred restore and inherits its state when athena is still front');

console.log('qol-batch-scoped-focus-restore: OK (two reads -> one restore, aimed at the original tab; per-read yank gone)');

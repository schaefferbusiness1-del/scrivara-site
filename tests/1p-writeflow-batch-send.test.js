'use strict';
/* bx-1.0.0 pins: the multi-select batch is a QUEUE over the existing per-row
   machinery - checkboxes only on READY note-write rows, one batch button, the
   same probe/execute per row, halt-on-uncertain, and settle-latch waits
   (never bare timers, which freeze in a hidden tab). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), '1p-feat_mls_writeflow.js'), 'utf8');

/* the checkbox exists only for write_note rows, outside the radio label */
assert.ok(src.includes("(row.action === 'write_note'"), 'the checkbox write_note gate is gone');
assert.ok(src.includes('class="mls-bx-check" data-mls-bx-row="'), 'the include checkbox is gone');
const cbIdx = src.indexOf('class="mls-bx-check"');
const radioLabelClose = src.lastIndexOf("</label>' +", cbIdx);
const radioInput = src.lastIndexOf('name="mlsAthenaUnifiedAction"', cbIdx);
assert.ok(radioLabelClose > radioInput && radioLabelClose < cbIdx,
  'the checkbox moved inside the radio label - the two controls would fight');

/* the batch driver reuses the per-row machinery and its gates */
assert.ok(src.includes('function runUnifiedBatchSend(state, btn)'), 'the batch driver is gone');
const bx = src.slice(src.indexOf('function bxSleep'), src.indexOf('function reopenOptions'));
assert.ok(bx.includes('probeUnifiedRow(state, row.id);'), 'the batch no longer runs the per-row read-only check');
assert.ok(bx.includes('executeUnifiedSelection(state);'), 'the batch no longer runs the per-row execute');
assert.ok(bx.includes("if (rec && rec.status === 'verified') okCount++;"), 'the batch no longer counts only verified receipts');
assert.ok(bx.includes("stopMsg = 'Halted on an uncertain outcome"), 'the batch no longer halts on uncertain');
assert.ok((bx.match(/state\.halted/g) || []).length >= 2, 'the halt checks thinned');
assert.ok(!/bridge\(/.test(bx), 'the batch driver must never talk to the bridge directly - only through the per-row paths');
assert.ok(bx.includes("row.capability === 'ready' && row.action === 'write_note'"), 'the checked-row filter lost its ready/write_note gate');

/* the settle latch is written by BOTH probe terminals */
assert.ok(src.includes('unifiedAthenaState.probeSettled = unifiedAthenaState.probeGeneration'), 'the success-tick settle latch is gone');
const rcIdx = src.indexOf('function unifiedRecheckButton');
assert.ok(src.slice(rcIdx, rcIdx + 600).includes('state.probeSettled = state.probeGeneration'), 'the refusal settle latch left unifiedRecheckButton');

/* hidden-safe waits */
assert.ok(src.includes('function bxSleep(ms)'), 'the hidden-safe sleep is gone');
assert.ok(src.slice(src.indexOf('function bxSleep'), src.indexOf('function bxWait')).includes('MessageChannel'), 'bxSleep lost its hidden-tab MessageChannel yield');

/* sheetux-1.0.0 (2026-08-27): the second footer button is GONE. The batch
   driver did not change - it is now reached through the ONE merged primary
   button, which must still route to this exact driver and to nothing new. */
assert.ok(!src.includes('id="mlsAthenaUnifiedBatch"'), 'the redundant second send button came back to the footer');
assert.ok(src.includes("go.addEventListener('click', function () { runUnifiedPrimarySend(state, go); })"), 'the merged primary button is not wired to the primary router');
const primary = src.slice(src.indexOf('function runUnifiedPrimarySend'), src.indexOf('function runUnifiedBatchSend'));
assert.ok(primary.includes('runUnifiedBatchSend(state, btn);'), 'the merged button no longer routes checked rows through the batch driver');
assert.ok(primary.includes('executeUnifiedSelection(state);'), 'the merged button lost the legacy one-row lane for Save / Sign / order rows');
assert.ok(!/bridge\(/.test(primary), 'the merged button must never talk to the bridge directly - only through the existing drivers');

console.log('PASS 1p writeflow batch-send pins: checkboxes gate on ready note-writes, the queue reuses per-row probe/execute with halt-on-uncertain, waits are hidden-safe settle latches, and the one merged primary button routes into that same queue');

'use strict';
/* spd-1.0.0 (Codex reply 24: speed profiling LAST, measurement first): the
 * settle already aggregates WHERE THE TIME GOES per pull
 * (receipt.costBreakdown - chart / parseSave / visits / visitSave /
 * todayNote milliseconds, rows, max and per-row figures, verified-today
 * skips), but honestPullOutcome's whitelist dropped it, so the stored
 * machine outcome could never name the slow step. It now rides the outcome
 * in BOTH verdict directions, numbers only. honestPullOutcome is extracted
 * from the shipped bytes and EXECUTED. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), '1p-feat_mls_schedimport_exact.js'), 'utf8');
const start = src.indexOf('  function honestPullOutcome(value) {');
const end = src.indexOf('  /* ===== p1-todaynote-deferred-retry-1.0.0', start);
assert.ok(start > 0 && end > start, 'honestPullOutcome moved');
const honest = new Function('Date', src.slice(start, end) + '\nreturn honestPullOutcome;')(Date);

const CB = { chartMs: 61000, parseSaveMs: 9000, visitsMs: 210000, visitSaveMs: 4000, todayNoteMs: 30000, rows: 6, maxChartMs: 21000, perRowChartMs: 10167, perRowTodayNoteMs: 5000, skippedVerifiedToday: 2, alienField: 'never-copied' };
const EXPECT = { chartMs: 61000, parseSaveMs: 9000, visitsMs: 210000, visitSaveMs: 4000, todayNoteMs: 30000, rows: 6, maxChartMs: 21000, perRowChartMs: 10167, perRowTodayNoteMs: 5000, skippedVerifiedToday: 2 };

/* BOTH verdict directions carry the numbers */
let out = honest({ ok: true, complete: true, historyReceipt: { costBreakdown: CB } });
assert.deepStrictEqual(out.costBreakdown, EXPECT, 'a successful outcome dropped the cost breakdown');
out = honest({ ok: false, complete: false, reason: 'history-partial', failures: 3, historyReceipt: { costBreakdown: CB, retry: [] } });
assert.deepStrictEqual(out.costBreakdown, EXPECT, 'a failed outcome dropped the cost breakdown');
/* alien fields are never copied; absent breakdown stays absent; malformed
   values coerce to numbers instead of leaking */
assert.strictEqual('alienField' in out.costBreakdown, false, 'an alien breakdown field leaked into the stored outcome');
assert.strictEqual('costBreakdown' in honest({ ok: true, historyReceipt: {} }), false, 'an absent breakdown minted an empty one');
out = honest({ ok: true, historyReceipt: { costBreakdown: { chartMs: 'NaN-ish', rows: null } } });
assert.deepStrictEqual({ c: out.costBreakdown.chartMs, r: out.costBreakdown.rows }, { c: 0, r: 0 }, 'malformed timing values leaked');

/* the settle still builds the breakdown it carries */
assert.ok(src.includes('receipt.costBreakdown = t;'), 'the settle no longer stamps the cost breakdown');
assert.ok(src.includes('out.costBreakdown = {'), 'the outcome carry is gone');
const carryIdx = src.indexOf('out.costBreakdown = {');
const okBranchEnd = src.indexOf('if (value.visitNotesMode !== undefined');
assert.ok(carryIdx > okBranchEnd, 'the cost carry sits inside the failure-only branch - success timings would vanish');

console.log('PASS speed cost receipt (spd-1.0.0): the per-stage cost breakdown rides the stored machine outcome in both verdict directions with numbers only - alien fields never copied, absent stays absent, malformed values coerce - so every matrix run names its slow step at rest (executed from shipped bytes)');

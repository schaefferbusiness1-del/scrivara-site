'use strict';
/* cxl-1.0.0 control: A USER CANCEL IS NOT A FAILURE.
 *
 * Authorized as slice 5 of Codex reply 4. The direct range/day loop marked a
 * user Cancel as {status:'failed', error:'cancelled'} in both cancel sites
 * (pre-day and mid-day), so the panel's FAIL chip counted cancels as
 * failures and nothing downstream could tell an auth drop from a deliberate
 * stop. cxl-1.0.0: both sites write status 'cancelled' (the codebase's
 * existing run-level spelling), cancelled days stay in the retry pool so
 * "Retry failed days" re-reads them, the fail chip counts only true
 * failures, and the bar label discloses the cancelled count.
 *
 * Executes the REAL shipped pCounts() against a synthetic P with a mixed
 * failed/cancelled pool, and shape-pins both live cancel sites. OLD BYTES
 * FAIL BY NAME (status 'failed' with error 'cancelled'). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const retiredAt = src.indexOf('Retired historical Easy');
const live = retiredAt > 0 ? src.slice(0, retiredAt) : src;

/* ---- shape pins on the LIVE region only ---- */
assert.ok(live.includes("P.dayStatus[dayKey] = { status: 'cancelled', error: 'cancelled before this day was read' }"),
  'pre-day cancel writes the truthful cancelled status');
assert.ok(live.includes("{ status: 'cancelled', error: 'cancelled after ' + processed"),
  'mid-day cancel writes the truthful cancelled status and keeps its counts');
assert.ok(!live.includes("{ status: 'failed', error: 'cancelled' }"),
  'no live cancel site still masquerades as failed');
{
  const preIdx = live.indexOf("status: 'cancelled', error: 'cancelled before");
  const seg = live.slice(preIdx, preIdx + 220);
  assert.ok(seg.includes('P.failedDays.push(dayKey)'),
    'cancelled days remain in the retry pool so Retry re-reads them');
}

/* ---- behavioral: the REAL pCounts with a mixed pool ---- */
function extractFn(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, marker + ' present');
  const open = source.indexOf('{', at + marker.length - 1);
  let depth = 0, mode = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i], p = source[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return source.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && source[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && source[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced ' + marker);
}
const pCountsSrc = extractFn(live, 'function pCounts()');
const texts = {};
const P = {
  found: 9, saved: 7, dups: 1, running: false,
  range: { keys: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'] },
  emptyDays: [],
  failedDays: ['2026-08-02', '2026-08-03', '2026-08-04'],
  dayStatus: {
    '2026-08-01': { status: 'done' },
    '2026-08-02': { status: 'failed', error: 'athena signed out' },
    '2026-08-03': { status: 'cancelled', error: 'cancelled before this day was read' },
    '2026-08-04': { status: 'cancelled', error: 'cancelled after 3 of 9 appointments' }
  }
};
const ctx = vm.createContext({
  P, String, Math,
  $: () => null,
  pSet: (id, txt) => { texts[id] = txt; },
  p1RangeState: () => null, p1RangeRunning: () => false, p1RangeResumable: () => false
});
vm.runInContext(pCountsSrc, ctx, { filename: 'mls-connect:pCounts' });
vm.runInContext('pCounts()', ctx);

assert.strictEqual(texts.ez3cFail, '1',
  'the fail chip counts ONLY the true failure - two cancelled days do not inflate it (old shape showed 3)');
assert.ok(/2 cancelled/.test(texts.ez3PullBarLbl || ''),
  'the bar label discloses the cancelled count instead of hiding it');
assert.ok(/4 of 4 days/.test(texts.ez3PullBarLbl || ''),
  'cancelled days count as SETTLED for this run (same as failed days always did) so the bar never lies about remaining work — all four fixture days are terminal');

console.log('PASS range-cancel truthful status: both live cancel sites write status cancelled, cancelled days stay retryable, the fail chip counts only true failures (1 not 3), and the bar label discloses 2 cancelled');

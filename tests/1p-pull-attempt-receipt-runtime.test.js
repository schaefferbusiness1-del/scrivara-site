'use strict';

/* oar-1.0.0 on /1p: the copyable pull error report must describe THIS
 * DaySwitch attempt. Before the port the fork read the importer's
 * engine-global _lastPullResult(), which can belong to an automatic resume
 * for a different date, and a promise that resolved to nothing produced no
 * attempt record at all - so a doctor could copy a report about a pull they
 * never clicked. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

const start = source.indexOf('  function ownAttemptResult(result, day, fallbackReason, fallbackError) {');
const end = source.indexOf('  /* ===== end oar-1.0.0 */', start);
assert(start >= 0 && end > start, 'the 1p per-attempt pull receipt owner (oar-1.0.0) is missing');

const DS = { day: '2026-08-17', lastAttemptResult: null };
const sandbox = { DS };
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) + '\nthis.own = ownAttemptResult;', sandbox);

/* a promise that resolved to nothing still leaves an honest record */
const nothing = sandbox.own(null, '2026-08-14', 'unverified-result', 'The Athena pull returned no verifiable result.');
assert.strictEqual(nothing.ok, false, 'a missing result was recorded as a success');
assert.strictEqual(nothing.complete, false, 'a missing result was recorded as complete');
assert.strictEqual(nothing.reason, 'unverified-result', 'a missing result carried no honest reason');
assert.strictEqual(nothing.target, '2026-08-14', 'the attempt receipt did not name the day that was pulled');
assert.strictEqual(nothing.error, 'The Athena pull returned no verifiable result.',
  'a missing result carried no explanation');
assert.strictEqual(DS.lastAttemptResult, nothing, 'the attempt receipt was not filed for the error report');

/* a truthy-looking but not-ok result may never be promoted */
const soft = sandbox.own({ ok: 'yes', complete: 1, reason: '' }, '2026-08-15', 'unverified-result');
assert.strictEqual(soft.ok, false, 'a non-boolean ok was accepted as a successful pull');
assert.strictEqual(soft.complete, false, 'a non-boolean complete was accepted as a complete pull');
assert.strictEqual(soft.reason, 'unverified-result', 'an empty reason was not replaced by the honest fallback');

/* a real receipt is copied, not aliased: later engine mutation of the source
 * object must not rewrite the receipt this attempt already filed */
const engineResult = { ok: true, complete: true, reason: 'complete', scheduleReceipt: { complete: true } };
const owned = sandbox.own(engineResult, '2026-08-16');
assert.notStrictEqual(owned, engineResult, 'the attempt receipt aliases the engine result object');
assert.strictEqual(owned.ok, true, 'a genuinely successful pull was downgraded');
assert.strictEqual(owned.target, '2026-08-16', 'a successful pull receipt lost its day');
assert.strictEqual(owned.scheduleReceipt, engineResult.scheduleReceipt,
  'the attempt receipt dropped the engine sub-receipts the error report prints');
engineResult.ok = false;
engineResult.reason = 'mutated-later';
assert.strictEqual(owned.ok, true, 'a later engine mutation rewrote an already-filed attempt receipt');
assert.strictEqual(owned.reason, 'complete', 'a later engine mutation rewrote the filed reason');

/* falls back to DS.day only when no day was supplied */
DS.lastAttemptResult = null;
const noDay = sandbox.own(null, '', 'no-receipt', 'no receipt');
assert.strictEqual(noDay.target, '2026-08-17', 'an attempt with no explicit day did not fall back to the selected day');

/* ---- the shipped wiring ------------------------------------------------ */
assert(/var si = window\.__mlsSI, res = DS\.lastAttemptResult \|\| null;/.test(source),
  'the 1p error report does not prefer this attempt\'s own receipt');
assert(/result = ownAttemptResult\(result, day, 'unverified-result', 'The Athena pull returned no verifiable result\.'\);/.test(source),
  'the 1p day pull does not own the receipt its promise resolved with');
assert(/ownAttemptResult\(null, day, 'pull-exception', errText\);/.test(source),
  'a rejected 1p day pull leaves no attempt receipt');
assert(/ownAttemptResult\(null, day, 'no-receipt', 'The Athena pull engine did not return a verifiable completion receipt\.'\);/.test(source),
  'a 1p day pull that returned no promise leaves no attempt receipt');
assert(/ownAttemptResult\(null, day, 'pull-start-failed'/.test(source),
  'a 1p day pull that could not start leaves no attempt receipt');
assert(/reason: ok === true \? 'complete' : 'relay-failed'/.test(source),
  'the 1p relay pull leaves no attempt receipt');
/* the receipt is scoped: a day change or a new attempt must clear it */
const resets = source.match(/DS\.lastAttemptResult = null;/g) || [];
assert(resets.length >= 4,
  'the 1p attempt receipt is not cleared on day change, new pull and session reset (found ' +
  resets.length + ' resets, expected at least 4)');

console.log('PASS 1p pull attempt receipt runtime (oar-1.0.0, 24 assertions)');

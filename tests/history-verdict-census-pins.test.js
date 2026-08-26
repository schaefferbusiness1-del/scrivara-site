'use strict';
/* pvd-1.0.0 regression (Codex replies 24/27): every requested patient gets
 * exactly ONE mutually exclusive final verdict and the arithmetic closes:
 * requested === succeeded + failed + notAttempted + unaccounted. The measured
 * double-count (a patient in patients[] complete:true AND in retry[] at once)
 * is counted as a conflict and classified failed, never silently absorbed as
 * a success. The helper is extracted from the SHIPPED 1p bytes and EXECUTED;
 * the settle wiring and the machine-outcome carry are byte-pinned. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), '1p-feat_mls_schedimport_exact.js'), 'utf8');
const start = src.indexOf('function historyVerdictCensus(rows, unresolved, receipt) {');
const end = src.indexOf('async function runHistoryBatch', start);
assert.ok(start > 0 && end > start, 'the pvd-1.0.0 census helper is gone');
const census = new Function(src.slice(start, end) + '\nreturn historyVerdictCensus;')();

const row = (pid) => ({ _mlsTargetPatientId: pid, name: 'X' });
const pe = (pid, complete, reason) => ({ patientId: pid, complete, reason });
const re = (pid, reason) => ({ patientId: pid, reason });

/* clean batch: all walked, all complete, none re-queued */
let v = census([row('a'), row('b'), row('c')], [], { patients: [pe('a', true), pe('b', true), pe('c', true)], retry: [] });
assert.deepStrictEqual(
  { requested: v.requested, succeeded: v.succeeded, failed: v.failed, notAttempted: v.notAttempted, unaccounted: v.unaccounted, conflicts: v.conflicts, closed: v.closed },
  { requested: 3, succeeded: 3, failed: 0, notAttempted: 0, unaccounted: 0, conflicts: 0, closed: true },
  'a clean batch did not census as 3 succeeded');

/* THE DOUBLE-COUNT: complete:true AND re-queued -> failed + a counted conflict */
v = census([row('a'), row('b')], [], { patients: [pe('a', true), pe('b', true)], retry: [re('b', 'visit-bodies-incomplete')] });
assert.strictEqual(v.succeeded, 1, 'the requeued patient still counted as succeeded');
assert.strictEqual(v.failed, 1, 'the requeued patient did not count as failed');
assert.strictEqual(v.conflicts, 1, 'the success+retry double-count was silently absorbed');
assert.strictEqual(v.closed, true, 'the double-count broke the arithmetic');
const conflicted = v.perPatient.find(p => p.patientId === 'b');
assert.deepStrictEqual({ verdict: conflicted.verdict, reason: conflicted.reason }, { verdict: 'failed', reason: 'visit-bodies-incomplete' });

/* walked failure keeps its own reason */
v = census([row('a')], [], { patients: [pe('a', false, 'chart-swap-never-settled')], retry: [re('a', 'chart-swap-never-settled')] });
assert.deepStrictEqual({ f: v.failed, s: v.succeeded, closed: v.closed }, { f: 1, s: 0, closed: true });

/* stop mid-batch: never-walked rows are not-attempted, never failed */
v = census([row('a'), row('b'), row('c')], [], {
  patients: [pe('a', true)],
  retry: [re('b', 'stopped-by-user'), re('c', 'stopped-by-user')]
});
assert.deepStrictEqual(
  { s: v.succeeded, f: v.failed, na: v.notAttempted, closed: v.closed },
  { s: 1, f: 0, na: 2, closed: true },
  'stopped rows were not classified not-attempted');

/* pid-less unresolved row consumes its pid-less retry entry -> not-attempted */
v = census([row('a')], [{ name: 'NoId' }], { patients: [pe('a', true)], retry: [{ patientId: '', reason: 'identity-name-only' }] });
assert.deepStrictEqual({ s: v.succeeded, na: v.notAttempted, closed: v.closed }, { s: 1, na: 1, closed: true },
  'the pid-less unresolved row did not census as not-attempted');

/* no evidence at all: unaccounted is COUNTED so the sum still closes */
v = census([row('a'), row('ghost')], [], { patients: [pe('a', true)], retry: [] });
assert.deepStrictEqual({ s: v.succeeded, ua: v.unaccounted, closed: v.closed }, { s: 1, ua: 1, closed: true },
  'a row with no evidence vanished instead of counting as unaccounted');

/* exclusivity: exactly one verdict per requested patient, always */
assert.strictEqual(v.perPatient.length, v.requested, 'perPatient rows do not match the denominator');
v.perPatient.forEach(p => assert.ok(['succeeded', 'failed', 'complete-with-named-omissions', 'not-attempted', 'unaccounted'].includes(p.verdict), 'open verdict vocabulary: ' + p.verdict));

/* tax-1.0.0 integration: a reconciled named omission is its own bucket - not
   a success, not a failure - and the sum still closes */
v = census([row('a'), row('b')], [], {
  patients: [pe('a', true), { patientId: 'b', complete: false, namedOmission: { reason: 'visit-bodies-incomplete', detail: 'accordion-not-open' } }],
  retry: []
});
assert.deepStrictEqual(
  { s: v.succeeded, f: v.failed, o: v.omitted, closed: v.closed },
  { s: 1, f: 0, o: 1, closed: true },
  'a named omission did not census into its own bucket');
const om = v.perPatient.find(p => p.patientId === 'b');
assert.deepStrictEqual({ verdict: om.verdict, reason: om.reason }, { verdict: 'complete-with-named-omissions', reason: 'accordion-not-open' });
/* still re-queued means still failed - a named omission cannot coexist with a live retry entry */
v = census([row('b')], [], {
  patients: [{ patientId: 'b', complete: false, namedOmission: { reason: 'visit-bodies-incomplete', detail: 'accordion-not-open' } }],
  retry: [re('b', 'visit-bodies-incomplete')]
});
assert.deepStrictEqual({ f: v.failed, o: v.omitted }, { f: 1, o: 0 }, 'a re-queued named omission escaped the failed bucket');

/* wiring pins: settle stamps the census + succeeded; the machine outcome carries counts */
assert.ok(src.includes('receipt.verdicts = historyVerdictCensus(rows, unresolved, receipt);'), 'the settle no longer stamps the census');
assert.ok(src.includes('receipt.succeeded = receipt.verdicts.succeeded;'), 'succeeded is no longer a first-class receipt field');
assert.ok(src.includes('_historyVerdictCensus: historyVerdictCensus'), 'the census is no longer exposed for execution');
assert.ok(src.includes('out.historyVerdicts = { requested: Number(vd.requested || 0), succeeded: Number(vd.succeeded || 0)'), 'the machine outcome no longer carries the verdict counts');
const carryIdx = src.indexOf('out.historyVerdicts =');
const okBranchEnd = src.indexOf('if (value.visitNotesMode !== undefined');
assert.ok(carryIdx > okBranchEnd, 'the verdict carry sits inside the failure-only branch - succeeded would vanish on good days');

console.log('PASS history verdict census (pvd-1.0.0): one exclusive verdict per requested patient, closed requested = succeeded + failed + not-attempted + unaccounted arithmetic, the success+retry double-count is a counted conflict classified failed, stopped rows are not-attempted, and the machine outcome carries the counts in both verdict directions (executed from shipped bytes)');

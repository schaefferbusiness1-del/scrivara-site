'use strict';
/* tax-1.0.0 regression (Codex reply 27 p3): the refresh/day taxonomy
 * reconciles ONLY where evidence permits. After the capped reader (a retry
 * pass), a chart with proven identity + chart facts + exact-day census whose
 * encounter body still binds nothing terminates as a NAMED OMISSION with the
 * exact missing-detail sub-cause and leaves the retry pool - ending the
 * eternal "Retry failed histories (N)" burn - while NEVER counting as a full
 * visit-body success. Transport/auth/identity/navigation/deadline failures
 * stay failures and stay retryable, and a FIRST pass never reconciles.
 * Helpers extracted from the shipped 1p bytes and EXECUTED. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), '1p-feat_mls_schedimport_exact.js'), 'utf8');
const tStart = src.indexOf('var TAX_TRANSPORT_CAUSE =');
const tEnd = src.indexOf('async function runHistoryBatch', tStart);
assert.ok(tStart > 0 && tEnd > tStart, 'the tax-1.0.0 reconciler is gone');
const reconcile = new Function(src.slice(tStart, tEnd) + '\nreturn taxReconcileNamedOmissions;')();
const cStart = src.indexOf('function historyVerdictCensus(rows, unresolved, receipt) {');
const census = new Function(src.slice(cStart, tEnd) + '\nreturn historyVerdictCensus;')();

const provenPatient = (pid, extra) => Object.assign({
  patientId: pid, complete: false, identityVerified: true, organized: true,
  visitsReadReceipt: { expected: 5, parsed: 0 },
  visitsFailedHistogram: { 'accordion-not-open': 3, 'no-bound-clinical-detail': 2 }
}, extra || {});
const retryEntry = (pid, reason) => ({ patientId: pid, reason });

/* eligible: content-only evidence after the capped reader -> drained + named */
let receipt = { patients: [provenPatient('a')], retry: [retryEntry('a', 'visit-bodies-incomplete')] };
assert.strictEqual(reconcile(receipt), 1, 'the proven content omission did not reconcile');
assert.strictEqual(receipt.retry.length, 0, 'the reconciled entry stayed in the retry pool');
assert.deepStrictEqual(receipt.namedOmissions, [{ patientId: 'a', reason: 'visit-bodies-incomplete', detail: 'accordion-not-open' }],
  'the named omission did not record the exact top missing-detail sub-cause');
assert.strictEqual(receipt.patients[0].complete, false, 'a named omission was upgraded to a full success');
assert.deepStrictEqual({ r: receipt.patients[0].namedOmission.reason, d: receipt.patients[0].namedOmission.detail },
  { r: 'visit-bodies-incomplete', d: 'accordion-not-open' });

/* the census counts it in its OWN bucket and the arithmetic closes */
const v = census([{ _mlsTargetPatientId: 'a' }], [], receipt);
assert.deepStrictEqual({ s: v.succeeded, f: v.failed, o: v.omitted, closed: v.closed }, { s: 0, f: 0, o: 1, closed: true });

/* transport sub-cause anywhere in the histogram -> untouched (stays retryable) */
receipt = { patients: [provenPatient('b', { visitsFailedHistogram: { 'accordion-not-open': 2, 'athena-tab-sleeping': 1 } })], retry: [retryEntry('b', 'visit-bodies-incomplete')] };
assert.strictEqual(reconcile(receipt), 0, 'a mixed content+transport histogram reconciled');
assert.strictEqual(receipt.retry.length, 1);

/* no histogram = no evidence -> untouched (fail closed) */
receipt = { patients: [provenPatient('c', { visitsFailedHistogram: null })], retry: [retryEntry('c', 'visit-bodies-incomplete')] };
assert.strictEqual(reconcile(receipt), 0, 'an evidence-less entry reconciled');

/* census unproven (expected 0 / missing receipt) -> untouched */
receipt = { patients: [provenPatient('d', { visitsReadReceipt: { expected: 0 } })], retry: [retryEntry('d', 'visit-bodies-incomplete')] };
assert.strictEqual(reconcile(receipt), 0, 'an unproven exact-day census reconciled');
receipt = { patients: [provenPatient('e', { visitsReadReceipt: null })], retry: [retryEntry('e', 'visit-bodies-incomplete')] };
assert.strictEqual(reconcile(receipt), 0);

/* non-content reasons stay failures: transport/nav/identity classes */
for (const reason of ['chart-swap-never-settled', 'athena-tab-sleeping', 'no-athena-tab', 'identity-not-proven', 'visits-read-deadline-exceeded']) {
  receipt = { patients: [provenPatient('f')], retry: [retryEntry('f', reason)] };
  assert.strictEqual(reconcile(receipt), 0, reason + ' reconciled - transport/identity must stay retryable');
}

/* identity/facts unproven -> untouched */
receipt = { patients: [provenPatient('g', { identityVerified: false })], retry: [retryEntry('g', 'visit-bodies-incomplete')] };
assert.strictEqual(reconcile(receipt), 0, 'an unproven identity reconciled');
receipt = { patients: [provenPatient('h', { organized: false })], retry: [retryEntry('h', 'visit-bodies-incomplete')] };
assert.strictEqual(reconcile(receipt), 0, 'unproven chart facts reconciled');

/* wiring pins: ONLY a retry pass reconciles, before failures/verdicts; the
   retry lane passes the flag; the machine outcome carries omitted */
const gateIdx = src.indexOf('if (sweepOpts && sweepOpts.retryPass === true) taxReconcileNamedOmissions(receipt);');
const failuresIdx = src.indexOf('receipt.failures = receipt.retry.length;', gateIdx > 0 ? gateIdx : 0);
assert.ok(gateIdx > 0 && failuresIdx > gateIdx && failuresIdx - gateIdx < 400,
  'the reconcile gate does not run immediately before the failure count at settle');
assert.strictEqual(src.split('taxReconcileNamedOmissions(receipt);').length - 1, 1,
  'the reconciler runs somewhere besides the retry-gated settle');
assert.ok(src.includes('{ scopeDay: retryScopeDay, retryPass: true }'), 'the retry lane no longer marks its pass');
assert.ok(src.includes('_taxReconcileNamedOmissions: taxReconcileNamedOmissions'), 'the reconciler is no longer exposed for execution');
assert.ok(src.includes("omitted: Number(vd.omitted || 0)"), 'the machine outcome no longer carries the omitted count');

console.log('PASS named-omission taxonomy (tax-1.0.0): a capped-reader retry pass reconciles proven content-only omissions into complete-with-named-omissions (drained from the retry pool, never a full success), transport/identity/nav/deadline classes stay retryable, evidence gates fail closed, and a first pass never reconciles (executed from shipped bytes)');

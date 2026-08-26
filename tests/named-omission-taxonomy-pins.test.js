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
const tStart = src.indexOf('var TAX_CONTENT_ALLOW =');
const tEnd = src.indexOf('async function runHistoryBatch', tStart);
assert.ok(tStart > 0 && tEnd > tStart, 'the tax-1.0.1 reconciler is gone');
assert.ok(!src.includes('TAX_TRANSPORT_CAUSE'), 'the fail-open transport blacklist came back');
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

/* tax-1.0.1 (Codex reply 33): the classifier FAILS CLOSED - every safety/
   navigation/binding cause from background.js's real vocabulary, and any
   alien cause it has never seen, stays retryable even with full proof
   evidence beside it. PERMANENT executions. */
const FAIL_CLOSED_CAUSES = [
  'identity-changed-before-detail', 'identity-changed-after-surface-recycle',
  'detail-binding-mismatch', 'stable-source-keys-incomplete',
  'row-set-changed-after-surface-recycle', 'encounter-surface-not-open',
  'encounter-frame-not-refreshed', 'ambiguous-encounter-frames',
  'slideout-open-failed', 'click-failed',
  'a-cause-invented-after-this-test-was-written'
];
for (const cause of FAIL_CLOSED_CAUSES) {
  const solo = {};
  solo[cause] = 3;
  receipt = { patients: [provenPatient('fc', { visitsFailedHistogram: solo })], retry: [retryEntry('fc', 'visit-bodies-incomplete')] };
  assert.strictEqual(reconcile(receipt), 0, cause + ' reconciled as content - the classifier fails open');
  assert.strictEqual(receipt.retry.length, 1, cause + ' left the retry pool');
  const mixed = { 'accordion-not-open': 5 };
  mixed[cause] = 1;
  receipt = { patients: [provenPatient('fm', { visitsFailedHistogram: mixed })], retry: [retryEntry('fm', 'visit-bodies-incomplete')] };
  assert.strictEqual(reconcile(receipt), 0, cause + ' beside a reviewed cause reconciled - one bad key must poison the histogram');
}
/* the reviewed pair still admits, alone and together */
receipt = { patients: [provenPatient('ok1', { visitsFailedHistogram: { 'no-bound-clinical-detail': 4 } })], retry: [retryEntry('ok1', 'visit-bodies-incomplete')] };
assert.strictEqual(reconcile(receipt), 1, 'the reviewed no-bound-clinical-detail class no longer admits');
receipt = { patients: [provenPatient('ok2', { visitsFailedHistogram: { 'accordion-not-open': 1, 'no-bound-clinical-detail': 6 } })], retry: [retryEntry('ok2', 'visit-bodies-incomplete')] };
assert.strictEqual(reconcile(receipt), 1, 'the combined reviewed classes no longer admit');
assert.strictEqual(receipt.namedOmissions[receipt.namedOmissions.length - 1].detail, 'no-bound-clinical-detail', 'the top reviewed cause is not the recorded detail');

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

console.log('PASS named-omission taxonomy (tax-1.0.1): a capped-reader retry pass reconciles omissions whose sub-causes sit ENTIRELY inside the closed content allowlist; ten real safety/navigation/binding causes plus an alien cause fail closed alone and beside a reviewed cause; transport/identity/nav/deadline reasons stay retryable; a first pass never reconciles (executed from shipped bytes)');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

assert(!/_pullAllHistories\s*\(\s*false\s*\)/.test(source), 'day pull must never call history with false');
for (const marker of [
  'historyTargets.push(targetRow)',
  '_mlsTargetPatientId: patientId',
  '? await runHistoryBatch',
  'historyReceipt.exactIdentityVerified === true',
  'res.scheduleReceipt = r.receipt',
  'res.calendarReceipt = calendarReceipt',
  'res.historyReceipt = historyReceipt',
  'res.ok = complete; res.complete = complete',
  'r.receipt.authoritativeEmpty',
  'visits-full-detail-unproven',
  'r.receipt.stableKeysComplete !== true',
  'athena-chart-coverage',
  'mlsAppReadAllVisits'
]) assert(source.includes(marker), `missing history receipt invariant: ${marker}`);

const listeners = new Set();
const patient = { id: 'p-exact-1', name: 'Exact Patient', dob: '01/02/1960', visits: [] };
let assistReadCalls = 0;
let managedLockCalls = 0;
let grantManagedLock = true;
let managedReleaseSignals = 0;

const context = {
  console,
  Promise,
  Date,
  Math,
  JSON,
  Intl,
  Object,
  Array,
  String,
  Number,
  RegExp,
  encodeURIComponent,
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval: () => {},
  location: { pathname: '/ScribeFlow-staging.html', origin: 'https://mlsscribe.com' },
  navigator: {
    locks: {
      request(name, options, callback) {
        managedLockCalls++;
        assert.strictEqual(name, 'mls-managed-athena-pull');
        assert.strictEqual(options.ifAvailable, true);
        return Promise.resolve(callback(grantManagedLock ? { name } : null));
      }
    }
  },
  /* Full visit notes defaults OFF since b470 — this pipeline exercises the
     bodies lane, so the harness opts IN the way a clinician would. */
  localStorage: { getItem: (k) => (/pullVisitBodies/.test(String(k)) ? '1' : null), setItem: () => {}, removeItem: () => {} },
  document: {
    readyState: 'complete',
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => {},
    body: {}, head: {}, documentElement: {}
  }
};
context.window = context;
context.uns = (k) => 'pipeline::' + k;
context.addEventListener = (_type, fn) => listeners.add(fn);
context.removeEventListener = (_type, fn) => listeners.delete(fn);
context.postMessage = msg => {
  if (msg && msg.type === 'mlsAppFocusMlsTab') { managedReleaseSignals++; return; }
  if (!msg || msg.type !== 'mlsAppReadAllVisits') return;
  queueMicrotask(() => {
    /* A legacy/id-less response from an older request must never settle this
       managed history bridge. */
    const stale = { data: { source: 'mls-ext', type: 'mlsAppAllVisitsResult', ok: false, reason: 'stale-idless-result' } };
    Array.from(listeners).forEach(fn => fn(stale));
    queueMicrotask(() => {
    const event = { data: { source: 'mls-ext', type: 'mlsAppAllVisitsResult',
      id: msg.id, requestId: msg.requestId,
      ok: true,
      visits: [{ date: '2026-01-01', type: 'Office visit', raw: 'Verified old visit with substantive clinical detail for the regression.', fullDetail: true, sourceVisitKey: 'row:schedule-history-1' }],
      receipt: { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, stableKeysComplete: true, expected: 1, parsed: 1, cap: 500, readerVersion: '2.9.22-visits-r4-two-stage' },
      readerVersion: '2.9.22-visits-r4-two-stage',
      identity: { name: patient.name, dob: patient.dob, mrn: '' }
    } };
    Array.from(listeners).forEach(fn => fn(event));
    });
  });
};
context.getPatients = () => [patient];
context._athenaHistoryTargetSnapshot = ref => ref && ref.patientId === patient.id
  ? { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: '' }
  : null;
context._hasImportedHistory = target => target && target.patientId === patient.id;
context._athenaHistoryProofMatches = (target, observed) => target.patientId === patient.id && observed.chartName === patient.name && observed.chartDob === patient.dob;
context._assistReadChart = () => {
  assistReadCalls++;
  const requestId = `chart-test-${assistReadCalls}`;
  const text = 'Verified chart problems medications allergies and clinical history';
  return Promise.resolve({
    text, requestId, chartName: patient.name, chartDob: patient.dob, chartMrn: '',
    coverageReceipt: {
      kind: 'athena-chart-coverage', complete: true, readerVersion: '2.9.19-chart-r3', identityObserved: true, truncated: false,
      requestId, capturedAt: Date.now(), expectedClinicalFrames: 1, readClinicalFrames: 1, boundClinicalFrames: 1,
      unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0, textChars: text.length
    }
  });
};
const profileCoverage = { complete: true, exactIdentityVerified: true, patientId: patient.id, cards: {
  problems: { status: 'found', populated: true }, meds: { status: 'found', populated: true }, allergies: { status: 'found', populated: true },
  summary: { status: 'found', populated: true }, vitals: { status: 'found', populated: true }, history: { status: 'found', populated: true }
} };
context._parsePatientChart = () => Promise.resolve({
  problems: 'Verified problem', meds: 'Verified med', allergies: 'Verified allergy', summary: 'Verified summary',
  vitals: { bp: '120/80' }, history: { pmh: 'Verified PMH' },
  coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
});
context._athenaChartProfileCoverage = () => profileCoverage;
context._athenaHistoryVerifiedRef = target => Object.freeze({ patientId: target.patientId, name: target.name, dob: target.dob, verifiedName: target.name, verifiedDob: target.dob });
context._athenaChartSnapshotFromChart = chart => ({
  problems: String(chart && chart.problems || ''), meds: String(chart && chart.meds || ''),
  allergies: String(chart && chart.allergies || ''), summary: String(chart && chart.summary || ''),
  vitals: Object.assign({}, chart && chart.vitals || {}), history: Object.assign({}, chart && chart.history || {}), visits: []
});
context._athenaChartSnapshotProof = snapshot => JSON.stringify(snapshot || {});
context._savePatientChart = (ref, _row, chart) => {
  profileCoverage.capturedAt = new Date().toISOString();
  profileCoverage.saveRequestId = String(ref && ref.requestId || '');
  patient.athenaProfileCoverage = profileCoverage;
  patient.athenaChartSnapshot = context._athenaChartSnapshotFromChart(chart);
  return true;
};
context._patientHistoryCardCoverage = () => patient.athenaProfileCoverage;
function storeVerifiedVisit(_id, raw, opts) {
  opts = opts || {};
  const stored = Object.assign({}, raw, {
    source: opts.source || 'athena-copy',
    identityVerified: opts.identityVerified === true,
    identityBinding: opts.identityBinding || patient.id,
    bodyComplete: opts.bodyComplete === true && raw.fullDetail === true
  });
  const key = stored.encounterId || stored.sourceVisitKey;
  const prior = patient.visits.findIndex(v => (v.encounterId || v.sourceVisitKey) === key);
  if (prior >= 0) patient.visits[prior] = stored; else patient.visits.push(stored);
  return stored;
}
context.__mlsVisitModel = {
  addVisit: storeVerifiedVisit,
  getVisits: () => patient.visits,
  reconcileVerifiedAthenaVisits: () => ({ complete: true, removed: 0, kept: patient.visits.length }),
  organizePatientHistory: () => ({ ok: true, verifiedVisits: patient.visits.length })
};
context.__mlsCopyVisits = {
  _saveVisits: (_p, _identity, visits) => {
    visits.forEach(v => storeVerifiedVisit(patient.id, v, { source: 'athena-copy', identityVerified: true, identityBinding: patient.id, bodyComplete: true }));
    return visits.length;
  },
  _visitIdentityAgrees: () => true
};
context.loadPatients = () => {};
context.renderHistory = () => {};
context.renderProfile = () => {};

vm.runInNewContext(source, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
assert(context.__mlsSI && typeof context.__mlsSI._runHistoryBatch === 'function');

(async () => {
  const row = { patient_external_id: patient.id, _mlsTargetPatientId: patient.id, _mlsTargetDob: patient.dob, name: patient.name, dob: patient.dob };
  const receipt = await context.__mlsSI._runHistoryBatch([row], [], () => {});
  assert.strictEqual(receipt.complete, true);
  assert.strictEqual(receipt.requested, 1);
  assert.strictEqual(receipt.processed, 1);
  assert.strictEqual(receipt.retry.length, 0);
  assert.strictEqual(receipt.patients[0].patientId, patient.id);
  assert.strictEqual(receipt.patients[0].organized, true);
  assert.strictEqual(receipt.patients[0].visitsComplete, true);
  assert.strictEqual(receipt.patients[0].complete, true);
  assert.strictEqual(patient.visits.length, 1);
  assert.strictEqual(assistReadCalls, 1, 'a stale imported-history marker must not skip an explicit fresh chart read');
  assert.strictEqual(receipt.patients[0].chartCoverage.complete, true);
  assert.strictEqual(receipt.patients[0].visitsCoverageComplete, true);

  const originalSavePatientChart = context._savePatientChart;
  const originalParsePatientChart = context._parsePatientChart;
  context._savePatientChart = (ref, _row, chart) => {
    profileCoverage.capturedAt = new Date().toISOString();
    profileCoverage.saveRequestId = 'different-operation-id';
    patient.athenaProfileCoverage = profileCoverage;
    patient.athenaChartSnapshot = context._athenaChartSnapshotFromChart(chart);
    return true;
  };
  const wrongOperationSink = await context.__mlsSI._runHistoryBatch([row], [], () => {});
  assert.strictEqual(wrongOperationSink.complete, false, 'a fresh six-card receipt from a different operation became green');
  assert.strictEqual(wrongOperationSink.patients[0].organized, false);
  assert.strictEqual(wrongOperationSink.patients[0].chartReason, 'six-card-save-request-unproven');

  context._parsePatientChart = () => Promise.resolve({
    problems: 'New current problem', meds: 'New current med', allergies: 'New current allergy', summary: 'New current summary',
    vitals: { bp: '130/90' }, history: { pmh: 'New current PMH' },
    coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
  });
  context._savePatientChart = ref => {
    profileCoverage.capturedAt = new Date().toISOString();
    profileCoverage.saveRequestId = String(ref && ref.requestId || '');
    patient.athenaProfileCoverage = profileCoverage;
    return true; // deliberately drops the newly parsed chart snapshot
  };
  const freshMetadataOnlySink = await context.__mlsSI._runHistoryBatch([row], [], () => {});
  assert.strictEqual(freshMetadataOnlySink.complete, false, 'fresh receipt metadata hid a dropped current chart payload');
  assert.strictEqual(freshMetadataOnlySink.patients[0].organized, false);
  assert.strictEqual(freshMetadataOnlySink.patients[0].chartReason, 'six-card-persistence-unproven');
  assert.strictEqual(freshMetadataOnlySink.patients[0].visitsComplete, true, 'visit-body proof should remain independently visible');

  context._parsePatientChart = originalParsePatientChart;
  context._savePatientChart = originalSavePatientChart;
  profileCoverage.capturedAt = '2026-01-01T00:00:00.000Z';
  context._savePatientChart = () => true;
  const staleSuccessfulSink = await context.__mlsSI._runHistoryBatch([row], [], () => {});
  context._savePatientChart = originalSavePatientChart;
  assert.strictEqual(staleSuccessfulSink.complete, false, 'a successful sink result with yesterday\'s six-card receipt became green');
  assert.strictEqual(staleSuccessfulSink.patients[0].organized, false);
  assert.strictEqual(staleSuccessfulSink.patients[0].profileCoverageFresh, false);
  assert.strictEqual(staleSuccessfulSink.patients[0].visitsComplete, true, 'current r4 visits should remain independently proven');
  assert.strictEqual(staleSuccessfulSink.patients[0].chartReason, 'six-card-profile-freshness-unproven');
  assert.strictEqual(staleSuccessfulSink.patients[0].visitsReason, 'six-card-profile-freshness-unproven');

  const originalAssistReadChart = context._assistReadChart;
  profileCoverage.capturedAt = new Date(Date.now() - 1000).toISOString();
  context._assistReadChart = () => Promise.reject(new Error('chart-profile-route-failed'));
  const nearStaleProfileRefused = await context.__mlsSI._runHistoryBatch([row], [], () => {});
  context._assistReadChart = originalAssistReadChart;
  assert.strictEqual(nearStaleProfileRefused.complete, false, 'a profile captured immediately before this operation masked a failed current chart read');
  assert.strictEqual(nearStaleProfileRefused.patients[0].organized, false);
  assert.strictEqual(nearStaleProfileRefused.patients[0].profileCoverageFresh, false);
  assert.strictEqual(nearStaleProfileRefused.patients[0].visitsComplete, true);
  assert.strictEqual(nearStaleProfileRefused.patients[0].visitsReason, 'six-card-profile-freshness-unproven');

  profileCoverage.capturedAt = '2026-01-01T00:00:00.000Z';
  context._assistReadChart = () => Promise.reject(new Error('chart-profile-route-failed'));
  const staleProfileRefused = await context.__mlsSI._runHistoryBatch([row], [], () => {});
  context._assistReadChart = originalAssistReadChart;
  assert.strictEqual(staleProfileRefused.complete, false, 'yesterday’s six-card receipt masked a failed current chart-profile read');
  assert.strictEqual(staleProfileRefused.patients[0].organized, false);
  assert.strictEqual(staleProfileRefused.patients[0].profileCoverageFresh, false);
  assert.strictEqual(staleProfileRefused.patients[0].organizationComplete, true, 'current r4 visits should still organize even though current profile coverage failed');
  assert.strictEqual(staleProfileRefused.patients[0].visitsComplete, true);
  assert.strictEqual(staleProfileRefused.patients[0].chartReason, 'chart-profile-route-failed');
  assert.strictEqual(staleProfileRefused.patients[0].visitsReason, 'six-card-profile-freshness-unproven');

  /* si-2.0.0: this case's guarantee is about the READ path — clear the carry
     stamp so the visits read (and its reconcile) actually runs. */
  delete patient.athenaVisitsProof;
  const originalReconcile = context.__mlsVisitModel.reconcileVerifiedAthenaVisits;
  context.__mlsVisitModel.reconcileVerifiedAthenaVisits = () => ({ complete: false, reason: 'stable-key-collision' });
  const refusedReconcile = await context.__mlsSI._runHistoryBatch([row], [], () => {});
  context.__mlsVisitModel.reconcileVerifiedAthenaVisits = originalReconcile;
  assert.strictEqual(refusedReconcile.complete, false, 'a failed exact-visit reconciliation must never become a green history receipt');
  assert.strictEqual(refusedReconcile.patients[0].visitsComplete, false);
  assert.strictEqual(refusedReconcile.patients[0].visitsReason, 'visits-reconcile-unproven');

  const originalSaveVisits = context.__mlsCopyVisits._saveVisits;
  patient.visits = [];
  context.__mlsCopyVisits._saveVisits = () => 1;
  const missingStoredBody = await context.__mlsSI._runHistoryBatch([row], [], () => {});
  context.__mlsCopyVisits._saveVisits = originalSaveVisits;
  assert.strictEqual(missingStoredBody.complete, false, 'an optimistic save count without the exact stored body must fail closed');
  assert.strictEqual(missingStoredBody.patients[0].visitsComplete, false);
  assert.strictEqual(missingStoredBody.patients[0].visitsReason, 'visits-persistence-count-unproven');

  const partial = await context.__mlsSI._runHistoryBatch([], [{ patientId: 'p-unresolved', reason: 'missing-dob-mrn-proof' }], () => {});
  assert.strictEqual(partial.complete, false);
  assert.strictEqual(partial.reason, 'history-partial');
  assert.strictEqual(partial.retry[0].patientId, 'p-unresolved');

  const beforeManualRetryCalls = assistReadCalls;
  const manualPartial = await context.__mlsSI.retryFailedHistory({
    historyReceipt: {
      requestId: 'history-original-partial', reason: 'history-partial',
      retry: [
        { patientId: patient.id, reason: 'chart-read-deadline-exceeded', frozenDob: '19600102' },
        { patientId: patient.id, reason: 'duplicate-receipt-entry', frozenDob: '19600102' },
        { patientId: 'missing-local-patient', reason: 'deferred-after-timeout', frozenDob: '19610101' }
      ]
    }
  }, () => {});
  assert.strictEqual(manualPartial.manualRetry, true);
  assert.strictEqual(manualPartial.retryOf, 'history-original-partial');
  assert.strictEqual(manualPartial.requested, 2, 'manual retry must dedupe immutable patient ids while retaining unresolved ids');
  assert.strictEqual(manualPartial.processed, 1, 'manual retry must run only the one exact local patient target');
  assert.strictEqual(assistReadCalls, beforeManualRetryCalls + 1, 'duplicate retry entries re-read the exact patient more than once');
  assert.strictEqual(manualPartial.complete, false);
  assert.strictEqual(manualPartial.retry.length, 1);
  assert.strictEqual(manualPartial.retry[0].patientId, 'missing-local-patient');
  assert.strictEqual(manualPartial.retry[0].reason, 'retry-target-unavailable');
  assert.strictEqual(managedLockCalls, 1, 'manual history retry did not acquire the managed cross-tab lock');
  assert.strictEqual(managedReleaseSignals, 1, 'completed manual history retry did not release the quiet Athena workspace');

  const manualComplete = await context.__mlsSI.retryFailedHistory({
    requestId: 'history-one-patient-partial', reason: 'history-partial',
    retry: [{ patientId: patient.id, reason: 'visits-read-deadline-exceeded', frozenDob: '19600102' }]
  }, () => {});
  assert.strictEqual(manualComplete.complete, true);
  assert.strictEqual(manualComplete.manualRetry, true);
  assert.strictEqual(manualComplete.retryOf, 'history-one-patient-partial');
  assert.strictEqual(manualComplete.retry.length, 0);
  assert.strictEqual(managedLockCalls, 2);
  assert.strictEqual(managedReleaseSignals, 2);

  grantManagedLock = false;
  const beforeContendedReadCalls = assistReadCalls;
  const contendedRetry = await context.__mlsSI.retryFailedHistory({
    requestId: 'history-contended-partial', reason: 'history-partial',
    retry: [{ patientId: patient.id, reason: 'visits-read-deadline-exceeded', frozenDob: '19600102' }]
  }, () => {});
  grantManagedLock = true;
  assert.strictEqual(contendedRetry.complete, false);
  assert.strictEqual(contendedRetry.blockedReason, 'pull-in-flight');
  assert.strictEqual(contendedRetry.retry.length, 1, 'lock contention discarded the human retry queue');
  assert.strictEqual(assistReadCalls, beforeContendedReadCalls, 'lock contention still started an Athena history read');
  assert.strictEqual(managedLockCalls, 3);
  assert.strictEqual(managedReleaseSignals, 2, 'a tab that did not acquire the lock released another tab\'s quiet workspace');

  const malformedEmpty = await context.__mlsSI.retryFailedHistory({ reason: 'history-partial', complete: false, retry: [] }, () => {});
  assert.strictEqual(malformedEmpty.complete, false, 'an empty malformed partial receipt must not be reported complete');
  assert.strictEqual(malformedEmpty.reason, 'retry-receipt-invalid');

  /* si-1.9.0 (owner directive 2026-07-22): a chart under live documentation
     fails its FIRST visits read (visit-bodies-incomplete) and reads fine once
     the edit burst passes — the batch must recover it automatically in the
     end-of-batch re-sweep instead of surrendering to the manual button. */
  {
    patient.visits.length = 0;
    let visitCalls = 0;
    const basePost = context.postMessage;
    context.postMessage = msg => {
      if (!msg || msg.type !== 'mlsAppReadAllVisits') return basePost(msg);
      visitCalls++;
      if (visitCalls === 1) {
        queueMicrotask(() => {
          const failEvent = { data: { source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: msg.id, requestId: msg.requestId, ok: false, reason: 'visit-bodies-incomplete', receipt: { complete: false, expected: 2, parsed: 0 } } };
          Array.from(listeners).forEach(fn => fn(failEvent));
        });
        return;
      }
      return basePost(msg);
    };
    const sweepStatuses = [];
    const sweepReceipt = await context.__mlsSI._runHistoryBatch([row], [], m => sweepStatuses.push(String(m || '')));
    context.postMessage = basePost;
    assert.strictEqual(sweepReceipt.complete, true, 'the automatic re-sweep must complete an actively-edited chart: ' + JSON.stringify({ reason: sweepReceipt.reason, failures: sweepReceipt.failures, sweepPasses: sweepReceipt.sweepPasses }));
    /* si-1.9.4: the sweep's counter must be marked as a re-check continuing the
       same pull, never a bare restart that repaints the bar back to zero. */
    assert(sweepStatuses.some(s => /Reading verified history 1 of 1 \(automatic re-check\)/.test(s)),
      'sweep sub-batch statuses must carry the cumulative re-check counter: ' + JSON.stringify(sweepStatuses));
    assert.strictEqual(sweepReceipt.sweepPasses, 1, 'exactly one sweep pass must have recovered it');
    assert.strictEqual(sweepReceipt.retry.length, 0, 'no retry entries may remain after sweep recovery');
    const sweptEntry = sweepReceipt.patients.find(p => p && p.sweepRecovered === 1);
    assert(sweptEntry && sweptEntry.complete === true, 'the recovered patient must be complete and flagged sweepRecovered');
    assert(visitCalls >= 2, 'the sweep must have issued a fresh visits read');
  }

  /* si-2.0.0 (owner 2026-07-23: "43 minutes for a pull is way too slow"): a
     COMPLETED body pass stamps the patient; the next pull's fresh index that
     matches the stamp carries the verified bodies WITHOUT re-reading every
     encounter. Any index change forces the full re-read. */
  {
    const stamped = (context.getPatients ? context.getPatients() : [patient]).find(p => p && String(p.id) === String(patient.id));
    assert(stamped && stamped.athenaVisitsProof && stamped.athenaVisitsProof.indexSig,
      'a completed body pass must stamp athenaVisitsProof: ' + JSON.stringify(stamped && stamped.athenaVisitsProof));
    let carryVisitCalls = 0;
    const basePost2 = context.postMessage;
    context.postMessage = msg => { if (msg && msg.type === 'mlsAppReadAllVisits') carryVisitCalls++; return basePost2(msg); };
    const carryReceipt = await context.__mlsSI._runHistoryBatch([row], [], () => {});
    assert.strictEqual(carryReceipt.complete, true, 'carry pull must complete: ' + JSON.stringify({ reason: carryReceipt.reason, failures: carryReceipt.failures }));
    assert.strictEqual(carryVisitCalls, 0, 'an unchanged stamped patient must NOT re-read encounter bodies');
    const carried = carryReceipt.patients.find(p => p && p.visitsVerifiedCarry === true);
    assert(carried && carried.complete === true, 'the carried patient must be complete and flagged visitsVerifiedCarry');
    assert.strictEqual(carryReceipt.bodiesCarried, 1, 'the receipt must count carried patients');
    /* a NEW index row (new encounter) must force the full body read */
    stamped.visits.push({ date: '2026-07-23', type: 'encounter', indexOnly: true, source: 'athena-visits' });
    await context.__mlsSI._runHistoryBatch([row], [], () => {});
    assert(carryVisitCalls >= 1, 'a changed index must force a fresh body read');
    context.postMessage = basePost2;
  }

  /* si-1.9.0 static contract: the sweep is depth-guarded, pass-bounded,
     budget-gated, and reason-whitelisted; a still-failing patient keeps an
     honest retry entry. */
  {
    const src = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
    assert(src.includes('function buildRetryRows'), 'the shared retry-row builder must exist');
    assert(/runHistoryBatch\(swept\.rows, swept\.unresolved, onStatus, \{ depth: 1, deadlineCapAt: batchDeadlineAt, progressBase: Math\.max\(0, rows\.length - swept\.rows\.length\), progressTotal: rows\.length \}\)/.test(src),
      'a sweep must run at depth 1 AND inherit the outer frozen deadline (never-immortal) AND report cumulative pull-wide progress (si-1.9.4)');
    /* si-1.9.4 (owner 2026-07-22): the pull bar parses "N of M" — a sweep
       reporting "1 of 2" made 14 finished charts look thrown away. */
    assert(/sweepProgressBase \+ i \+ 1/.test(src), 'si-1.9.4: sweep counters must continue from the whole-pull base, never restart at 1');
    assert(/sweepProgressTotal > rows\.length \? sweepProgressTotal : rows\.length/.test(src), 'si-1.9.4: sweep counters must keep the original pull total');
    assert(src.includes('charts finished — re-checking'), 'si-1.9.4: the sweep announcement must lead with the held progress');
    assert(/batchDeadlineAt = Math\.min\(batchDeadlineAt, sweepDeadlineCapAt\)/.test(src), 'the sub-batch deadline must be capped by the outer deadline');
    assert(/sweepPass <= 3 && !receipt\.complete/.test(src), 'the sweep must be bounded to three passes and stop on completion');
    assert(/Date\.now\(\) \+ 240000 >= batchDeadlineAt/.test(src), 'the sweep must respect the frozen batch budget');
    assert(src.includes('var SWEEPABLE_REASON'), 'the sweep reason whitelist must exist');
    assert(/adaptiveCeilingMs\('visits', 60000, 195000, 100000\)/.test(src),
      'si-1.9.3 adaptive: main-pass visits ceiling tracks the batch median (60s floor, 195s cap)');
    assert(/adaptiveCeilingMs\('chart', 45000, 180000, 90000\)/.test(src),
      'si-1.9.3 adaptive: main-pass chart ceiling tracks the batch median (45s floor, 180s cap)');
    assert(/median \* 2\.5/.test(src), 'the adaptive ceiling is 2.5x the median successful read');
    assert(src.includes("recordReadMs('chart'") && src.includes("recordReadMs('visits'"),
      'successful read durations must feed the adaptive median');
    assert(/Math\.min\(45 \* 60 \* 1000, Math\.max\(1, rows\.length\) \* 3 \* 60 \* 1000\)/.test(src),
      'si-1.9.2 speed: the whole batch is hard-capped at 45 minutes (3 min per row)');
  }

  /* b490 static contract: pulls stamp a cross-tab busy key and the update
     banner defers Refresh while it is fresh (two live 75-minute pulls were
     killed by mid-pull refreshes on 2026-07-22). */
  {
    const src = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
    assert(src.includes('mlsPullBusyXTabV1'), 'cross-tab pull-busy stamp missing');
    assert(/leaseTouch = setInterval[\s\S]{0,260}xtabBusyStamp\(\)/.test(src), 'stamp must refresh with the lease touch');
    assert(src.includes('if (operationStarted) xtabBusyClear();'), 'stamp must clear when the operation ends');
    const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
    assert(mc.includes("uns('mlsPullBusyXTabV1')"), 'update banner must read the cross-tab stamp');
    assert(mc.includes('Waiting for the pull to finish'), 'update banner Refresh must defer while a pull is running');
  }

  /* si-1.8.1 static contract (live 2026-07-22, twice): a deadline failure may
     recover ONLY when a fast ping proves the runner restarted; recoveries are
     bounded per batch and per patient, and the honest stop-and-defer remains
     the fallback in BOTH the chart-open and visits lanes. */
  {
    const src = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
    assert(src.includes('var transientRunnerRecoveries = 0;'), 'batch-wide transient-recovery counter must exist');
    assert(src.includes('async function runnerAnsweredProbe()'), 'the runner probe must exist');
    assert(/chartAttempt < 2 && transientRunnerRecoveries < 2 && Date\.now\(\) \+ 300000 < batchDeadlineAt && \(await runnerAnsweredProbe\(\)\)/.test(src),
      'chart-open deadline recovery must be probe-gated, attempt-bounded, and budget-bounded');
    assert(/visitsAttempt < 2 && transientRunnerRecoveries < 2 && Date\.now\(\) \+ 300000 < batchDeadlineAt && \(await runnerAnsweredProbe\(\)\)/.test(src),
      'visits-lane deadline recovery must be probe-gated, attempt-bounded, and budget-bounded');
    assert(src.includes('stopAfterTimeout = true; receipt.timedOut = true; break;'),
      'the honest stop-and-defer fallback must survive');
    assert(src.includes('chartTransientRecovered') && src.includes('visitsTransientRecovered'),
      'recoveries must be recorded on the receipt');
  }

  console.log('PASS exact-patient awaited history and old-visits receipt pipeline');
})().catch(err => { console.error(err); process.exit(1); });

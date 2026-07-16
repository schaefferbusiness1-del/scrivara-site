"use strict";

const assert = require("assert");
const { createHarness } = require("./phi-free-acceptance-vm-fixture");

async function baselinePasses() {
  const harness = createHarness();
  await harness.pull();
  assert.strictEqual(harness.latest().contractPass, true, "complete strict fixture must pass");
  const empty = createHarness({ emptyDay: true });
  await empty.pull();
  assert.strictEqual(empty.latest().contractPass, true, "an explicitly verified empty day must pass without any hardcoded row count");
  await empty.pull();
  assert.strictEqual(empty.verdict().contractPass, true, "an unchanged explicitly verified empty day repeat must pass");
  const legacyGrid = createHarness({ countProvenance: {
    declaredCount: 12, countStrategy: "legacy-grid-candidate-rows",
    declaredCountAuthoritative: false, declaredCountReason: "legacy-header-may-include-capacity"
  } });
  await legacyGrid.pull();
  assert.strictEqual(legacyGrid.latest().contractPass, true, "legacy grid capacity headers must use exact candidate rows without hardcoding the header total");
  const multiProvider = createHarness({ countProvenance: {
    declaredCount: 7, countStrategy: "verified-viewport-candidates",
    declaredCountAuthoritative: false, declaredCountReason: "multi-provider-column-count-not-total"
  } });
  await multiProvider.pull();
  assert.strictEqual(multiProvider.latest().contractPass, true, "multi-provider column declarations must not override exact viewport candidates");
  const repeatedPatient = createHarness({
    canonicalCount: 2,
    mutateRun({ result }) {
      Object.assign(result.scheduleReceipt, { expectedCount: 2, candidateCount: 2, parsedCount: 2, mergedRows: 2, declaredCount: 2 });
      Object.assign(result.providerReceipt, { sourceRows: 2, providerTaggedRows: 2 });
      result.resolvedAppointments.push({ sourceIdentity: "source-2", backendAppointmentId: "backend-2", patientId: "patient-1", date: result.target });
      Object.assign(result.identityBootstrapReceipt, { attempted: 2, alreadyProven: 2, requested: 0, resolved: 0, appointmentBound: 0, proofs: [] });
      Object.assign(result.calendarReceipt, { attempted: 2, accounted: 2, mapped: 2, uniqueSources: 2, uniqueBackend: 2, created: 2 });
      Object.assign(result, { created: 2, repaired: 0, skipped: 0 });
    }
  });
  await repeatedPatient.pull();
  assert.strictEqual(repeatedPatient.latest().contractPass, true, "two exact appointments for one patient must remain valid while both mapping tuples are unique");
  const idOnlyProvider = createHarness();
  await idOnlyProvider.pull({ provider: { id: "provider-1" } });
  assert.strictEqual(idOnlyProvider.latest().providerMode, "selected", "a provider object with an immutable id and no display name must remain selected");
  assert.strictEqual(idOnlyProvider.latest().contractPass, true, "id-only selected provider proof must pass when its exact roster identity is present");
}

async function mustFail(name, config, pullOptions, expectedGate) {
  const harness = createHarness(config);
  await harness.pull(pullOptions);
  const latest = harness.latest();
  assert.strictEqual(latest.contractPass, false, name + " must fail closed");
  if (expectedGate) assert.strictEqual(latest.gates[expectedGate], false, name + " must close " + expectedGate + " gate");
}

function duplicateMappingConfig(field) {
  return {
    mutateWindow(window) {
      window.__mlsSI.authoritativeStatusForDay = function () {
        return { available: true, exact: true, sourceCount: 2, activeCount: 2, missingCount: 0, unclassifiedCount: 0 };
      };
    },
    mutateRun({ result }) {
      Object.assign(result.scheduleReceipt, { expectedCount: 2, candidateCount: 2, parsedCount: 2, mergedRows: 2, declaredCount: 2 });
      Object.assign(result.providerReceipt, { sourceRows: 2, providerTaggedRows: 2 });
      const second = { sourceIdentity: "source-2", backendAppointmentId: "backend-2", patientId: "patient-1", date: result.target };
      second[field] = result.resolvedAppointments[0][field];
      result.resolvedAppointments.push(second);
      Object.assign(result.calendarReceipt, {
        attempted: 2, accounted: 2, mapped: 2, uniqueSources: 2, uniqueBackend: 2, created: 2, repaired: 0, skipped: 0
      });
      Object.assign(result, { created: 2, repaired: 0, skipped: 0 });
    }
  };
}

(async () => {
  await baselinePasses();
  await mustFail("wrong requested date", {}, { date: "1999-01-01" }, "date");
  await mustFail("missing provider mode", {
    mutateRun({ result }) { delete result.providerReceipt.mode; }
  }, null, "provider");
  await mustFail("missing roster bounds proof", {
    mutateRun({ result }) { delete result.providerRosterReceipt.boundsStable; }
  }, null, "providerRoster");
  await mustFail("missing history timeout proof", {
    mutateRun({ result }) { delete result.historyReceipt.timedOut; }
  }, null, "history");
  await mustFail("invalid persisted DOB", {
    mutateRun({ patient }) { patient.dob = "02/30/1970"; }
  }, null, "history");
  await mustFail("source and persisted DOB mismatch", {
    mutateRun({ patient }) { patient.dob = "02/02/1970"; }
  }, null, "history");
  await mustFail("unbound patient request", {
    mutateRun({ result }) { result.historyReceipt.patients[0].requestId = "other-request"; }
  }, null, "history");
  await mustFail("out-of-family patient request ordinal", {
    mutateRun({ result, patient }) {
      const requestId = result.historyReceipt.requestId + "-p999";
      const receipt = result.historyReceipt.patients[0];
      receipt.requestId = requestId;
      receipt.profileCoverage.saveRequestId = requestId + "-parse";
      receipt.chartCoverage.requestId = requestId + "-chart";
      patient.athenaProfileCoverage.saveRequestId = requestId + "-parse";
    }
  }, null, "history");
  await mustFail("missing chart truncation proof", {
    mutateRun({ result }) { delete result.historyReceipt.patients[0].chartCoverage.truncated; }
  }, null, "history");
  await mustFail("missing chart text proof", {
    mutateRun({ result }) { delete result.historyReceipt.patients[0].chartCoverage.textChars; }
  }, null, "history");
  await mustFail("local six-card mismatch", {
    mutateRun({ patient }) { patient.athenaProfileCoverage.cards.history = { status: "not_documented", populated: false }; }
  }, null, "cards");
  await mustFail("blank rendered patient fields", {
    mutateRun({ patient }) {
      patient.problems = "";
      patient.meds = "";
      patient.allergies = "";
      patient.summary = "";
      patient.vitals = "";
      patient.history = "";
    }
  }, null, "cards");
  await mustFail("rendered substring masquerading as exact fact", {
    mutateRun({ patient }) {
      patient.athenaChartSnapshot.problems = ["pain"];
      patient.problems = "painting";
    }
  }, null, "cards");
  await mustFail("verified-empty card retaining stale Athena-owned fact", {
    prePullProblem: "stale Athena problem that should have been removed",
    mutateRun({ result, patient }) {
      const empty = { status: "not_documented", populated: false };
      result.historyReceipt.patients[0].profileCoverage.cards.problems = empty;
      patient.athenaProfileCoverage.cards.problems = Object.assign({}, empty);
      patient.athenaChartSnapshot.problems = [];
      patient.problems = "stale Athena problem that should have been removed";
    }
  }, null, "cards");
  await mustFail("one-character visit body", {
    mutateRun({ patient }) { patient.visits[0].raw = "x"; }
  }, null, "history");
  await mustFail("missing schedule verification", {
    mutateRun({ result }) { delete result.scheduleVerified; }
  }, null, "schedule");
  await mustFail("missing declared-count provenance", {
    mutateRun({ result }) { delete result.scheduleReceipt.countStrategy; }
  }, null, "schedule");
  await mustFail("contradictory authoritative declared count", {
    mutateRun({ result }) { result.scheduleReceipt.declaredCount = 99; }
  }, null, "schedule");
  await mustFail("malformed nonauthoritative declared count", {
    mutateRun({ result }) {
      Object.assign(result.scheduleReceipt, {
        countStrategy: "verified-viewport-candidates", declaredCountAuthoritative: false,
        declaredCountReason: "no-authoritative-declared-total", declaredCount: { malformed: true }
      });
    }
  }, null, "schedule");
  await mustFail("mapping missing source identity", {
    mutateRun({ result }) { delete result.resolvedAppointments[0].sourceIdentity; }
  }, null, "mapping");
  await mustFail("mapping missing backend appointment id", {
    mutateRun({ result }) { delete result.resolvedAppointments[0].backendAppointmentId; }
  }, null, "mapping");
  await mustFail("mapping bound to wrong date", {
    mutateRun({ result }) { result.resolvedAppointments[0].date = "1999-01-01"; }
  }, null, "mapping");
  await mustFail("duplicate mapping source identity hidden by aggregate counters", duplicateMappingConfig("sourceIdentity"), null, "mapping");
  await mustFail("duplicate mapping backend id hidden by aggregate counters", duplicateMappingConfig("backendAppointmentId"), null, "mapping");
  await mustFail("history target missing schedule date", {
    mutateRun({ result }) {
      delete result.historyTargets[0].date;
      delete result.historyTargets[0].scheduleDate;
    }
  }, null, "cohort");
  await mustFail("history target bound to wrong date", {
    mutateRun({ result }) {
      result.historyTargets[0].date = "1999-01-01";
      result.historyTargets[0].scheduleDate = "1999-01-01";
    }
  }, null, "cohort");
  await mustFail("history target patient aliases disagree", {
    mutateRun({ result }) { result.historyTargets[0].patientId = "different-patient"; }
  }, null, "cohort");
  await mustFail("history target DOB aliases disagree", {
    mutateRun({ result }) { result.historyTargets[0].dob = "02/02/1970"; }
  }, null, "cohort");
  await mustFail("history target date aliases disagree", {
    mutateRun({ result }) { result.historyTargets[0].date = "1999-01-01"; }
  }, null, "cohort");
  await mustFail("whitespace-only patient identity", {
    mutateRun({ result, patient }) {
      patient.id = "   "; patient.visits[0].identityBinding = "   ";
      patient.athenaProfileCoverage.patientId = "   ";
      result.resolvedAppointments[0].patientId = "   ";
      Object.assign(result.historyTargets[0], { _mlsTargetPatientId: "   ", patient_external_id: "   " });
      result.historyReceipt.patients[0].patientId = "   ";
      result.historyReceipt.patients[0].profileCoverage.patientId = "   ";
    }
  }, null, "mapping");
  await mustFail("missing independently measured build digest", {
    missingBuildEvidence: true
  }, null, "buildDigest");
  await mustFail("wrong independently measured extension digest", {
    mutateObservedBuild(build) { build.extensionSha256 = "d".repeat(64); }
  }, null, "buildDigest");
  await mustFail("stale independently measured build digest", {
    mutateObservedBuild(build) { build.capturedAt = Date.now() - 60000; }
  }, null, "buildDigest");
  await mustFail("missing fresh extension build handshake", {
    missingExtensionBuildMessage: true
  }, null, "buildDigest");
  await mustFail("wrong extension build handshake digest", {
    extensionBuildDigest: "d".repeat(64)
  }, null, "buildDigest");
  await mustFail("missing rendered history card DOM", {
    missingDomCard: "history"
  }, null, "cardDom");
  await mustFail("rendered profile belongs to another patient", {
    wrongDomPatient: true
  }, null, "cardDom");
  await mustFail("stale rendered problem DOM", {
    mutateDom({ nodes }) { nodes.problems.textContent = "stale unrelated problem"; }
  }, null, "cardDom");
  await mustFail("explicitly hidden six-card DOM", {
    mutateDom({ nodes }) { Object.keys(nodes).forEach(key => { nodes[key].hidden = true; }); }
  }, null, "cardDom");
  await mustFail("missing identity bootstrap receipt", {
    mutateRun({ result }) { delete result.identityBootstrapReceipt; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap attempted count mismatch", {
    mutateRun({ result }) { result.identityBootstrapReceipt.attempted = 2; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap unresolved request", {
    mutateRun({ result }) { result.identityBootstrapReceipt.resolved = 0; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap missing appointment binding", {
    mutateRun({ result }) { result.identityBootstrapReceipt.appointmentBound = 0; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap reports a failure reason", {
    mutateRun({ result }) {
      Object.assign(result.identityBootstrapReceipt, { failed: 1, complete: true, reasons: { "appointment-id-duplicate": 1 } });
    }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap missing per-proof evidence", {
    mutateRun({ result }) { delete result.identityBootstrapReceipt.proofs; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap proof count below resolved count", {
    mutateRun({ result }) { result.identityBootstrapReceipt.proofs = []; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap proof without navigation delta", {
    mutateRun({ result }) { result.identityBootstrapReceipt.proofs[0].navigationProven = false; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap proof without banner identity", {
    mutateRun({ result }) { result.identityBootstrapReceipt.proofs[0].bannerIdentity = false; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap proof without verified DOB", {
    mutateRun({ result }) { result.identityBootstrapReceipt.proofs[0].dobVerified = false; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap proof without exact name match", {
    mutateRun({ result }) { result.identityBootstrapReceipt.proofs[0].exactNameMatched = false; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap proof bound to another date", {
    mutateRun({ result }) { result.identityBootstrapReceipt.proofs[0].scheduleDate = "1999-01-01"; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap proof from a foreign batch token", {
    mutateRun({ result }) { result.identityBootstrapReceipt.proofs[0].requestId = "schedule-proof-zzzzzz-p1"; }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap stale batch token", {
    mutateRun({ result }) {
      const staleToken = (Date.now() - 3600000).toString(36);
      result.identityBootstrapReceipt.batchToken = staleToken;
      result.identityBootstrapReceipt.proofs[0].requestId = "schedule-proof-" + staleToken + "-p1";
    }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap duplicate proof request ids", {
    canonicalCount: 2,
    mutateRun({ result }) {
      Object.assign(result.scheduleReceipt, { expectedCount: 2, candidateCount: 2, parsedCount: 2, mergedRows: 2, declaredCount: 2 });
      Object.assign(result.providerReceipt, { sourceRows: 2, providerTaggedRows: 2 });
      result.resolvedAppointments.push({ sourceIdentity: "source-2", backendAppointmentId: "backend-2", patientId: "patient-1", date: result.target });
      Object.assign(result.calendarReceipt, { attempted: 2, accounted: 2, mapped: 2, uniqueSources: 2, uniqueBackend: 2, created: 2 });
      Object.assign(result, { created: 2 });
      Object.assign(result.identityBootstrapReceipt, { attempted: 2, requested: 2, resolved: 2, appointmentBound: 2 });
      result.identityBootstrapReceipt.proofs.push(Object.assign({}, result.identityBootstrapReceipt.proofs[0]));
    }
  }, null, "identityBootstrap");
  await mustFail("identity bootstrap proof not bound to its own open request", {
    mutateRun({ result }) { result.identityBootstrapReceipt.proofs[0].requestBound = false; }
  }, null, "identityBootstrap");
  await mustFail("builder-only op-note API", {
    mutateWindow(window) {
      delete window.__mlsOpNoteHistory._internal.injectIfOpNote;
      delete window.__mlsOpNoteHistory.validateBinding;
    }
  }, null, "opNote");
  await mustFail("contradictory live provider roster", {
    mutateWindow(window) {
      window.__mlsProviderRoster.getReceipt = function () {
        return {
          complete: true,
          partial: false,
          expectedCount: 2,
          observedCount: 2,
          reachedEnd: true,
          capReached: false,
          budgetExpired: false,
          restored: true,
          boundsStable: true
        };
      };
    }
  }, null, "providerRoster");
  await mustFail("missing live provider roster proof", {
    mutateWindow(window) { window.__mlsProviderRoster.getReceipt = function () { return null; }; }
  }, null, "providerRoster");
  await mustFail("stale provider roster proof", {
    mutateRun({ result }) { result.providerRosterReceipt.updatedAt = Date.now() - 60000; }
  }, null, "providerRoster");
  await mustFail("fresh attached roster paired with stale live roster", {
    mutateWindow(window) {
      window.__mlsProviderRoster.getReceipt = function () {
        return {
          complete: true, partial: false, reason: "complete", expectedCount: 1, observedCount: 1, listedCount: 1,
          identityKeys: ["athena-id:provider-1"], reachedEnd: true, capReached: false, budgetExpired: false,
          restored: true, boundsStable: true, steps: 1, updatedAt: Date.now() - 60000
        };
      };
    }
  }, null, "providerRoster");
  await mustFail("provider roster bound to another date", {
    mutateRun({ result }) { result.providerRosterReceipt.targetDate = "1999-01-01"; }
  }, null, "providerRoster");
  await mustFail("provider roster bound to another request", {
    mutateRun({ result }) { result.providerRosterReceipt.requestId = "other-operation"; }
  }, null, "providerRoster");
  await mustFail("selected provider absent from otherwise exact live roster", {
    mutateRun({ result }) {
      Object.assign(result.providerReceipt, {
        mode: "selected", requestedId: "provider-b", rosterVerified: true,
        matchingRows: 1, mismatchedRows: 0
      });
      result.providerRosterReceipt.identityKeys = ["athena-id:other-provider"];
    }
  }, { provider: { id: "provider-b", name: "Provider B" } }, "providerRoster");
  await mustFail("same-count provider roster metadata disagreement", {
    mutateWindow(window) {
      window.__mlsProviderRoster.getReceipt = function () {
        return {
          complete: true,
          partial: false,
          reason: "different-proof",
          expectedCount: 1,
          observedCount: 1,
          reachedEnd: true,
          capReached: false,
          budgetExpired: false,
          restored: true,
          boundsStable: true,
          steps: 2,
          updatedAt: Date.now()
        };
      };
    }
  }, null, "providerRoster");
  console.log("PASS PHI-free collector fails closed for date, count provenance, mapping, history target, build digest, live roster, chart, model-card, DOM-card, and op-note evidence");
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

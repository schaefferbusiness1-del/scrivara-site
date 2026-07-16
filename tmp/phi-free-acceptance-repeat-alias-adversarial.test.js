"use strict";

const assert = require("assert");
const { createHarness } = require("./phi-free-acceptance-vm-fixture");

(async () => {
  const changedAlias = createHarness({
    aliasForRun(run) { return run === 1 ? "encounter-a" : "encounter-b"; },
    removedForRun() { return 0; }
  });
  await changedAlias.pull();
  assert.strictEqual(changedAlias.latest().contractPass, true, "first strict run must pass");
  await changedAlias.pull();
  assert.strictEqual(changedAlias.latest().contractPass, true, "second run remains individually complete");
  assert.strictEqual(changedAlias.latest().samePatientSet, true, "patient IDs intentionally remain unchanged");
  assert.strictEqual(changedAlias.latest().noPatientRegression, false, "silent stable-visit replacement must be detected");
  assert.strictEqual(changedAlias.latest().repeatPass, false, "changed stable visit aliases must fail repeat acceptance");
  assert.strictEqual(changedAlias.verdict().contractPass, false, "overall verdict must remain red");

  const removedVisit = createHarness({
    aliasForRun(run) { return run === 1 ? "encounter-a" : "encounter-b"; },
    removedForRun(run) { return run === 1 ? 0 : 1; }
  });
  await removedVisit.pull();
  await removedVisit.pull();
  assert.strictEqual(removedVisit.latest().noPatientRegression, false, "repeat reconcile removal must be rejected");
  assert.strictEqual(removedVisit.latest().repeatPass, false, "removed/replaced history must fail repeat acceptance");
  assert.strictEqual(removedVisit.verdict().contractPass, false, "removed/replaced history must never yield a green verdict");

  const changedBody = createHarness({
    aliasForRun() { return "encounter-a"; },
    removedForRun() { return 0; },
    mutateRun({ patient, runNumber }) {
      patient.visits[0].raw = runNumber === 1
        ? "First complete verified clinical visit body with stable exact-patient content."
        : "Second complete but silently changed clinical visit body for the same stable key.";
    }
  });
  await changedBody.pull();
  assert.strictEqual(changedBody.latest().contractPass, true, "first body-fingerprint baseline must pass");
  await changedBody.pull();
  assert.strictEqual(changedBody.latest().contractPass, true, "changed body run remains individually complete");
  assert.strictEqual(changedBody.latest().noPatientRegression, false, "changed content under one stable visit key must be detected");
  assert.strictEqual(changedBody.latest().repeatPass, false, "changed stable visit content must fail repeat acceptance");
  assert.strictEqual(changedBody.verdict().contractPass, false, "changed stable visit content must keep the verdict red");

  const collisionA = Buffer.from("MCRONk1heUFzOiZnYlY/ZjtxJ2ByeWtCNE8mQVYiT1hKbDM/LHRNU2tmTUU/byZZNTcmMFZ1PkJcaytXemxiMQ==", "base64").toString("utf8");
  const collisionB = Buffer.from("R0dtNSZYRlc5J0EwbVVkYlFLPWt0JTdbWG0vTVlrKkZTcztvX0Q/LDxCXj9lJ05qNiVkPGouUyFUPDlEVilHYw==", "base64").toString("utf8");
  assert.notStrictEqual(collisionA, collisionB, "collision fixture bodies unexpectedly match");
  const collidingBody = createHarness({
    aliasForRun() { return "encounter-a"; },
    removedForRun() { return 0; },
    mutateRun({ patient, runNumber }) { patient.visits[0].raw = runNumber === 1 ? collisionA : collisionB; }
  });
  await collidingBody.pull();
  assert.strictEqual(collidingBody.latest().contractPass, true, "collision baseline must pass individually");
  await collidingBody.pull();
  assert.strictEqual(collidingBody.latest().contractPass, true, "collision repeat remains individually complete");
  assert.strictEqual(collidingBody.latest().noPatientRegression, false, "different bodies with the former FNV32 collision must be detected");
  assert.strictEqual(collidingBody.latest().repeatPass, false, "body fingerprint collision must not green the repeat");
  assert.strictEqual(collidingBody.verdict().contractPass, false, "body fingerprint collision must keep the verdict red");

  const changedMapping = createHarness({
    mutateRun({ result, runNumber }) {
      result.resolvedAppointments[0].sourceIdentity = runNumber === 1 ? "source-1" : "source-replaced";
      result.resolvedAppointments[0].backendAppointmentId = runNumber === 1 ? "backend-1" : "backend-replaced";
    }
  });
  await changedMapping.pull();
  assert.strictEqual(changedMapping.latest().contractPass, true, "first exact mapping baseline must pass");
  await changedMapping.pull();
  assert.strictEqual(changedMapping.latest().contractPass, true, "changed mapping remains individually well formed");
  assert.strictEqual(changedMapping.latest().samePatientSet, true, "mapping churn keeps the same patient set by design");
  assert.strictEqual(changedMapping.latest().sameMappingTuples, false, "exact source/backend mapping churn must be detected");
  assert.strictEqual(changedMapping.latest().repeatPass, false, "changed appointment mappings must fail repeat acceptance");
  assert.strictEqual(changedMapping.verdict().contractPass, false, "mapping churn must keep the overall verdict red");

  const changedDob = createHarness({
    mutateRun({ result, patient, runNumber }) {
      const dob = runNumber === 1 ? "01/01/1970" : "02/02/1970";
      patient.dob = dob;
      result.historyTargets[0]._mlsTargetDob = dob;
      result.historyTargets[0].dob = dob;
    }
  });
  await changedDob.pull();
  assert.strictEqual(changedDob.latest().contractPass, true, "first exact DOB baseline must pass");
  await changedDob.pull();
  assert.strictEqual(changedDob.latest().contractPass, true, "internally consistent changed DOB run remains individually complete");
  assert.strictEqual(changedDob.latest().noPatientRegression, false, "exact patient DOB churn must be detected privately");
  assert.strictEqual(changedDob.latest().repeatPass, false, "changed DOB must fail repeat acceptance");
  assert.strictEqual(changedDob.verdict().contractPass, false, "DOB churn must keep the overall verdict red");

  const unchanged = createHarness({ aliasForRun() { return "encounter-a"; }, removedForRun() { return 0; } });
  await unchanged.pull();
  await unchanged.pull();
  assert.strictEqual(unchanged.latest().repeatPass, true, "unchanged complete repeat must pass");
  assert.strictEqual(unchanged.verdict().contractPass, true, "two complete stable runs must produce a green verdict");
  console.log("PASS PHI-free repeat collector rejects stable-visit replacement/removal, body changes, and mapping churn, and accepts an unchanged idempotent repeat");
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

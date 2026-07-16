"use strict";

const assert = require("assert");
const { createHarness } = require("./phi-free-acceptance-vm-fixture");

async function mustRejectOpNote(name, config) {
  const harness = createHarness(config);
  await harness.pull();
  const latest = harness.latest();
  assert.strictEqual(latest.gates.opNote, false, name + " must close op-note gate");
  assert.strictEqual(latest.contractPass, false, name + " must fail the contract");
}

(async () => {
  await mustRejectOpNote("mutable verified-history binding", { mutableOpNoteBinding: true });
  await mustRejectOpNote("truncated injected context", { omitInjectedEnd: true });
  await mustRejectOpNote("replacement repair binding object", { replaceRepairBinding: true });

  const vacuousHistory = createHarness({
    mutateRun({ result, patient }) {
      patient.visits = [];
      const receipt = result.historyReceipt.patients[0];
      receipt.expectedVisits = 0;
      receipt.parsedVisits = 0;
      receipt.persistedVisits = 0;
      receipt.authoritativeEmpty = true;
    }
  });
  await vacuousHistory.pull();
  assert.strictEqual(vacuousHistory.latest().contractPass, false,
    "a nonempty scheduled cohort with zero captured old visits must not prove the history reader");

  const missingDob = createHarness({
    mutateRun({ result, patient }) {
      patient.dob = "";
      result.historyReceipt.patients[0].identityProof = "mrn";
    }
  });
  await missingDob.pull();
  assert.strictEqual(missingDob.latest().contractPass, false,
    "MRN identity proof must not hide a missing locally persisted DOB");

  const interleaved = createHarness({
    mutateRun({ result, runNumber }) {
      if (runNumber >= 2) {
        Object.assign(result.providerReceipt, {
          mode: "selected",
          requestedId: "provider-b",
          rosterVerified: true,
          matchingRows: 1,
          mismatchedRows: 0
        });
      }
      if (runNumber === 2) delete result.scheduleVerified;
    }
  });
  await interleaved.pull();
  assert.strictEqual(interleaved.latest().contractPass, true, "scope A baseline must pass");
  await interleaved.pull({ provider: { id: "provider-b", name: "Provider B" } });
  assert.strictEqual(interleaved.latest().contractPass, false, "scope B baseline intentionally fails");
  await interleaved.pull({ provider: { id: "provider-b", name: "Provider B" } });
  assert.strictEqual(interleaved.latest().contractPass, true, "scope B repeat is individually complete");
  assert.strictEqual(interleaved.latest().repeatPass, false, "a repeat cannot inherit a failed immediate baseline");
  assert.strictEqual(interleaved.verdict().contractPass, false, "interleaved scope A pass must not green scope B");

  /* Month certification (collector 3.4.1): a month run is certified ONLY by a
     complete real month-route receipt - every calendar day present exactly
     once with its own complete, batch-bound day receipt and reconciled
     totals. A genuine full pass certifies; it never poisons the day verdict. */
  const certifiedMonth = createHarness();
  await certifiedMonth.pull();
  await certifiedMonth.pull();
  assert.strictEqual(certifiedMonth.verdict().contractPass, true, "stable day baseline must be green before the month attempt");
  assert.strictEqual(certifiedMonth.verdict().monthCertified, false, "month must be uncertified before any month run");
  await certifiedMonth.pullMonth();
  assert.strictEqual(certifiedMonth.verdict().monthRunCount, 1, "the month run must be recorded");
  assert.strictEqual(certifiedMonth.monthResults()[0].monthPass, true, "a complete real month receipt must pass");
  assert.strictEqual(certifiedMonth.verdict().monthCertified, true, "a fully receipted month run must certify the month route");
  assert.strictEqual(certifiedMonth.verdict().contractPass, true, "a certified month run must not poison the day verdict");

  async function mustFailMonth(name, mutateMonth) {
    const harness = createHarness({ mutateMonth });
    await harness.pull();
    await harness.pull();
    await harness.pullMonth();
    assert.strictEqual(harness.monthResults()[0].monthPass, false, name + " must fail the month receipt");
    assert.strictEqual(harness.verdict().monthCertified, false, name + " must leave the month uncertified");
    assert.strictEqual(harness.verdict().everMonthFailed, true, name + " must latch everMonthFailed");
  }
  await mustFailMonth("function-merely-returned month result", result => {
    result.days = []; result.totals = { days: 0, completeDays: 0, failures: 0 };
  });
  await mustFailMonth("month missing one calendar day", result => {
    const removed = result.days.pop();
    result.totals.days -= 1; result.totals.completeDays -= 1;
    result.totals.scheduleAttempted -= removed.receipt.calendarReceipt.attempted;
    result.totals.scheduleAccounted -= removed.receipt.calendarReceipt.accounted;
    result.totals.created -= removed.receipt.created;
    result.totals.historiesRequested -= removed.receipt.historyReceipt.requested;
    result.totals.historiesProcessed -= removed.receipt.historyReceipt.processed;
  });
  await mustFailMonth("month with one incomplete day", result => {
    result.days[5].complete = false; result.days[5].receipt.complete = false;
  });
  await mustFailMonth("month day with duplicated schedule request id", result => {
    result.days[4].receipt.scheduleReceipt.requestId = result.days[3].receipt.scheduleReceipt.requestId;
  });
  await mustFailMonth("month day with unbound roster receipt", result => {
    result.days[2].receipt.providerRosterReceipt.requestId = "some-other-operation";
  });
  await mustFailMonth("month day roster bound to the wrong date", result => {
    result.days[2].receipt.providerRosterReceipt.targetDate = result.days[1].date;
  });
  await mustFailMonth("month totals hiding a failed history", result => {
    result.days[7].receipt.historyReceipt.processed -= 1;
    result.days[7].receipt.historyReceipt.failures = 1;
  });
  await mustFailMonth("month totals arithmetic mismatch", result => {
    result.totals.scheduleAccounted += 1;
  });
  await mustFailMonth("month day bootstrap without per-proof evidence", result => {
    const withRows = result.days.find(day => day.receipt.identityBootstrapReceipt.attempted > 0);
    withRows.receipt.identityBootstrapReceipt.resolved = 1;
    withRows.receipt.identityBootstrapReceipt.proofs = [];
  });
  await mustFailMonth("month claiming completion over a retry backlog", result => {
    result.retry.dates.push(result.days[0].date);
  });

  const monthThroughDayApi = createHarness();
  await monthThroughDayApi.pull({ month: "2026-07" });
  await monthThroughDayApi.pull();
  await monthThroughDayApi.pull();
  assert.strictEqual(monthThroughDayApi.verdict().uncertifiedMonthObserved, true, "month intent passed through the day API must latch permanently");
  assert.strictEqual(monthThroughDayApi.verdict().contractPass, false, "later green day runs must not erase an uncertified month attempt");

  const lateMonthApi = createHarness();
  await lateMonthApi.pull();
  await lateMonthApi.pull();
  lateMonthApi.window.__mlsSI.pullMonth = function () { return Promise.resolve({ ok: true, complete: true }); };
  await lateMonthApi.window.__mlsSI.pullMonth({ month: "2026-07" });
  assert.strictEqual(lateMonthApi.verdict().monthHookIntact, false, "a month API added after collector install must be surfaced as unwrapped");
  assert.strictEqual(lateMonthApi.verdict().uncertifiedMonthObserved, true, "late unwrapped month capability must latch the verdict red");
  assert.strictEqual(lateMonthApi.verdict().contractPass, false, "late unwrapped month calls must never inherit a green day verdict");
  console.log("PASS PHI-free collector requires non-vacuous history, frozen op-note injection, consecutive same-scope runs, and fails closed on uncertified month pulls");
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

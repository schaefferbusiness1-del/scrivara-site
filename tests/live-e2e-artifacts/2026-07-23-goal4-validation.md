# Goal-4 validation: provider selection, write workflow, patient context (2026-07-23)

## 2. WRITE WORKFLOW - full path trace (code-verified, suite-pinned)
UI entry (Write/Save buttons, #emrWbAthena panel, active-visit push) -> feat_mls_writeflow wf2-2.2.0
openUnifiedConfirmation: buildUnifiedManifest FREEZES patient {patientId,name,dob,mrn} + plan payloads + per-row hashes
(identity gate: missing localId/name/DOB/MRN => every write row BLOCKED; missing exact visit binding
(apptId | encounterId+URL) => blocked with "MLS will not guess an encounter").
-> probeUnifiedRow: read-only probe over the bridge (mlsAppAthenaActionV2 mode:probe); background.js verifies EXACTLY ONE
signed-in Athena tab matches the expected patient+encounter (duplicate matches fail closed as ambiguous-athena-tabs);
NEW wf2-2.2.0: whitelisted not-open refusals auto-open the identity-verified chart (SearchOpen: search-row name+DOB/MRN
verified BEFORE open) then re-probe ONCE. Probe mints a ONE-USE token bound to {senderTab, athenaTab, action,
previewHash, manifestHash, patientHash+patientId+MRN, canonical note/billing/order payloads, locked context hash}.
-> execute (single human "Confirm & write" click, fresh trusted gesture required): token consumed on FIRST attempt;
~15 equality gates re-checked server-side of the bridge (patient/context/payload/taught-destination hashes + full
canonical values, not just 32-bit hashes); write-safety gate (wsg-1.1.0) blocks final actions + test-content;
locked athena tab must still be the same open signed-in tab; driver re-verifies chart identity IN the tab before
any mutation; athenanet capture-phase interceptor physically consumes synthetic clicks on Sign/Submit/Send/etc.
-> verify: write is re-read from the encounter (note-write proof recorded, needed later for any Sign flow);
save_draft requires durable-save confirmation; receipts per-row; failures report exact reason; NOTHING chains.
Stale-state/race review findings (all already suite-pinned): duplicate-click guard (synchronous double-disable +
one-use token), token expiry, probe/execute context drift (lockedContextHash), place_order token invalidation on
re-probe, executeBusy mutual exclusion, session-serial guards in the day-strip UI.
Synthetic tests: offline E2E 17/17 (incl. incomplete-order refusal, op-note Draft-only, switch isolation);
athena-* runtime suites (tampered payloads, expired/used tokens, wrong-tab, sign auto-chain refusal) green in the
272 gate x4 today. Partial-write risk: note write is single-field atomic in the driver; billing stages code-by-code
with per-code verification and partialMutation surfaced as UNCERTAIN (never silent).
LIVE Adam draft-save x2: separately authorized, still blocked on an owner-created encounter (write floor =
encounter documentation view; Adam has none).

## 3. PATIENT CONTEXT - inventory + isolation (code + suite + synthetic evidence)
Retrieved per patient (pull lanes, read-only): demographics/identity (name/DOB/MRN/athenaId), six-card chart
(problems/meds/allergies/vitals/history+coverage receipts), visit INDEX (date/type/textHead/codes), verified visit
BODIES (raw, bodyComplete, encounterId/URL, identityVerified+identityBinding to the LOCAL patient id), schedule
appointments (time/provider/appointmentId/reason), athena proof stamps. Feature access: Generate Note reads ONLY the
active bound patient's transcript+context (scheduled-action gate: record/generate blocked until patient+appointment+
date+provider+binding read-back all match - suite-pinned); op-note prep (oni-2.3.0/task-12) resolves identity by
ID/DOB never name and reads the selected record's procedure context; Analysis page is scope-labeled (Provider view
vs Practice-wide chips, honest empty state "No provider names found yet"), patient-count reconciliation suite green,
unsupported-conclusion guards in analysis-clarity module; letters/legal/handout features receive display-only
payloads (task 16/17 display-only pins). Switching records: REPLACE-never-merge (task 6), patientlock b53
confirmAbandon single-flight (b494), E2E step 16 proves fail-closed lock guard + confirmed retry + NO cross-record
leakage + draft resume after reload; cross-patient combine refused (task 7/8 pins).

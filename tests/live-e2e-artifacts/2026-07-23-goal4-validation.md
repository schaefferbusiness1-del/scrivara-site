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

## 1. PROVIDER SELECTION - root cause + behavior verification (2026-07-23 midday)
WHY ONE PROVIDER: the roster mechanism is CORRECT and proves completeness. Roster receipt (live):
{complete:true, expectedCount:1, observedCount:1, reachedEnd:true, source backend:9 "Matthew Schaeffer, MD"}.
Every schedule surface this signed-in account has ever read (Day/Week, dept 121) renders exactly ONE provider
column - the account sees its own schedule. Backend /api/providers (accumulated from all pulls) agrees: one
provider. Inbox names (assignees) are not schedule providers. The dropdown therefore honestly lists
"All providers" + the one real provider, with the intended provider selected by default.
BEHAVIOR CHECKS (suite + code): provider-day-pull-contract (92 asserts) green - default provider, exact history
binding, schedule-only opt-out, frozen provider through the whole batch (selection APPLIED); roster-provenance
green - stale/mismatched/replayed/missing roster receipts fail closed (duplicate/unavailable handling);
All-providers mode carries empty requested identity (never a leftover provider). Selection persistence:
uns("pullProvider") localStorage + SCOPE persistence via saveScope(); b445 pin: "Pulling as" = pull identity,
never a view filter; selection change NEVER triggers a pull (explicit-click contract). Empty state: honest
"No provider names found yet - pull patients or sign visits first."
UNRESOLVED (documented): whether athena offers MORE providers on this account's schedule PICKER lists is
empirically unanswered - the harvest needs the schedule surface displayed and the owner is actively charting
(current tab = patient briefing; only chart widgets present). If the picker lists more, the planned 3.0.4
option-harvest (schedule read returns providerOptions; roster ingests as authoritative practice source) loads
them; if not, single-provider is the true complete roster. Inactive-provider display: no athena surface read
so far exposes an active/inactive flag - documented limitation; duplicates are collapsed by stableKey.

## E5/E6 recovery status (context for goal-3 acceptance)
E6 (peak clinic, background-throttled tab): honest partial at cap - 16/16 processed, 9 failures (6
deferred-after-batch-deadline from throttled sweep, 2 same-frame-name-mismatch, 1 visit-bodies-incomplete);
receipt captured cleanly. Bodies stable 66, parity local==server holds, 0 pairs, 0 badBinding. Observation:
foreground clinic use throttles the background MLS tab (bursty statuses, inflated waits) - ON x2 completion
scheduled for a quieter window; not a reader defect.

## 1b. PROVIDER SELECTION - live picker harvest (12:38, read-only DOM)
No provider-level picker exists on any frame of this account's athena session. The statusbar frame carries a
DEPARTMENTID select with 216 options (PHSC CL CC ... - the whole Premier Ortho practice). Conclusion: provider
discovery is DEPARTMENT-SCOPED by athena's own UI; the current department (121 POSM CL West Chester) has exactly
one provider (Matthew Schaeffer, MD), so the dropdown showing "All providers + Matthew Schaeffer, MD" with the
intended provider defaulted is CORRECT and complete. OWNER DECISION (not a defect): if multi-department provider
enumeration is wanted, the 3.0.4 candidate can harvest the DEPARTMENTID option list and/or read other departments
schedules - a scope and performance change requiring explicit approval. Verified behaviors: default selection,
persistence, apply-without-pull, honest empty state, fail-closed stale/duplicate roster receipts.

## av-1.1.x: Verify without an open chart (owner directive, 13:4x-14:4x)
- b501 av-1.1.0: explicit Verify auto-opens the identity-frozen chart on context-unverified/context-mismatch, re-probes once; forbidden-verb guard amended on principle (SearchOpen exactly once, verifyNow only, passive paths never navigate); 3 runtime cases.
- LIVE TRACE FINDING: mid-clinic the probe returns patient-mismatch (ANOTHER chart open - the normal daytime state); b502/b503 av-1.1.1 adds patient-mismatch to the whitelist (read-only + identity verified before open + re-probe re-verifies; non-whitelisted reasons still never navigate). NOTE: shared-worktree commit races made 1a94be3 ship without the whitelist lines; 776fe19 healed them and b503 re-tokened the connector (SW serves ?v= cache-first). Etiquette now: explicit-path staging only.
- b504 av-1.1.2: open budget 75s -> 150s after two live open-deadline-exceeded failures (contended tab + freeze-guard reloads).
- FINAL LIVE PROOF PENDING: at 14:3x the Athena TAB renderer froze, and after recovery reloads + a fresh tab, athena serves a BLANK frameset = SESSION EXPIRED (second time today). The verify mechanism is live-proven through: whitelist fire -> SearchOpen dispatch -> streamed progress; the completed receipt needs a signed-in session. First item after the owner signs in.

## 2026-07-23 evening — b510 ship, E9 blocked, Kinnier audit

**b510 (si-2.0.0 incremental verified history) LIVE** — commits 00ede31 + c8864a1, app-version serving 2026-07-23-b510, sw mls-v96. Union ship with acceptance session's passive ctx-bar chip lane (their runtime rode my overlapping bump paths; their site-continuity asserts pushed as follow-up). Joint tree certified 275/275 both sessions.

**E9 speed-proof pull (2026-07-22) FAILED at nav — root cause: EXPIRED ATHENA SESSION.** Receipt: ok:false reason:nav-failed, "athena week strip shows Today instead of 2026-07-22", 0 created/0 failed (honest zero-work receipt, no fabrication). Manual mlsAppGotoDate reproduced the failure (weekstrip found, schedDate stuck "Today", rounds:[]); athena tab reload surfaced the Re-Login page. Sign-in is owner-only; E9/E10 rerun queued for after re-login. Lesson re-proven: "week strip shows Today" during nav = check session FIRST.

**Kinnier side-item (QA handoff) CLOSED — no data loss.** pmrfjd3u1d003: local visits 0 == server visits 0 (server row 393822, source athena-schedule-monthpick, updated 12:11:50Z). Month-pick lane creates schedule-row patients without bodies BY DESIGN. The "1 visit" chip = quicksearch visitCount() patientNotes fallback counting his 8:11 AM "Athena chart import" note (an MLS note-record); with the op-note session's draft he now has 2 notes. Profile Visit timeline honestly reads "No visits yet for this patient." Verdict: honest data, chip counts MLS note-records not athena history — documented nuance, no fix shipped.

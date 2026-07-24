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

## 2026-07-23 evening — si-2.0.0 LIVE SPEED PROOF (E9/E10) + roster finding

**E9 (stamp pull, 2026-07-22, 18:07-18:51, 2629s):** honest incomplete — schedule 16/16 saved; history: 7 charts completed + STAMPED (athenaVisitsProof), 9 failures (4× same-frame-name-mismatch, 3× visit-bodies-incomplete, 2× visits-time-budget-exceeded after two mega-charts: chart 7 took 664s, chart 9 took 539s). Pre-E9 nav failure root-caused to EXPIRED SESSION; second nav failure ("no selected day") cured by reloading the CSRF-tokened frameset URL (bare root → forced identity re-login page; bare frameset URL → "unable to complete requested action" interstitial — use the CSRFPROTECT URL).

**E10 (carry pull, same date, 19:00, promise resolved 2707s incl. my late cancel during sweep):** `receipt.historyReceipt.bodiesCarried = 5` — five stamped charts carried as visitsVerifiedCarry in ~80s TOTAL (charts 1–5 status timestamps 7→80s) vs 20+ min for the same charts in E9. completeRows 8, remaining failures 8 (4× same-frame-name-mismatch on in-use charts, honest). **si-2.0.0 carry lane PROVEN LIVE.** Two of E9's 7 stamps re-read rather than carried (index sig moved or freshness rule) — correct-conservative, not a defect.

**Provider roster finding (owner escalation, meeting-eve):** owner screenshots show the CURRENT department (ATHENA DEPARTMENTID select reads "POSM CL West Chester", 216 depts) has many providers (Benner, Carter, Cavanaugh, Edwards, Evering, Gans, Garino, Heimur, Hill, Johnson…) as calendar tabs — my earlier "dept has only 1 provider" root-cause was WRONG. Truth: background.js schedule sweep derives providers from GRID COLUMN HEADERS of the current calendar view (bg 6438-6441); the owner's default view renders only Schaeffer's column, so roster honestly observes 1 and "All providers" pulls only what the grid shows. Live re-test of ↻ Re-pull all providers with the multi-provider dept active still yields 2 options — confirming the grid-scope limitation. FIX QUEUED (task #9, owner-approved): enumerate athena's authoritative provider picker (left-panel provider list / tab strip) via the extension, ingest as a new roster source with its own receipt, then verify multi-provider day pulls. Requires calendar DOM inspection + ext 3.0.5 release protocol.

## 2026-07-24 ~01:45 — overnight acceptance: empty-day proofs PASS; ON x2 root cause NAMED

**Empty-day proofs (ext 3.0.4) PASS:** 07-10 verified complete in 7s, 07-18 in 6s — "Athena verified that <day> has no appointments", authoritative snapshot, complete:true. The last 3.0.4 re-test item is closed (07-08 was proven on the 3.0.3 fix day).

**ON x2 (E11/E12, 2026-07-23, bodies ON, this machine):** both honest partials with an IDENTICAL signature — schedule 20/20 instantly, then failures 18. E12 full receipt breakdown: same-frame-name-mismatch x11, visit-bodies-incomplete x2, chart-read-deadline x1; complete 2, visitsVerifiedCarry 2 (bodiesCarried=2 — si-2.0.0 carries fire on this machine too: carried charts cleared in 8-16s vs ~4min reads). At 00:30-01:30 with ZERO clinic contention an 11/16 mismatch rate proves same-frame-name-mismatch is NOT (only) daytime contention: the all-visits reader passes its settle check while the chart frame still renders the PREVIOUS patient, then correctly refuses on the name check after a long read. Every "43-minute pull" residual traces to this one race.

**E12 nav notes:** first two attempts died on "week strip shows no selected day" — post-midnight day-rollover + the extension choosing the owner's out-of-group athena tab (diag tabId 256594014); cured by healing my tab via the CSRF interstitial Continue + fresh frameset, after which nav succeeded in 8s.

**EXT 3.0.5 TRAIN SPEC (background.js, release protocol):** (1) provider roster verb reads the full department/practice provider list, not the schedule grid header (owner: "should show way more people"; design doc PROVIDER_ROSTER_LANE_2026-07-23.md); (2) all-visits reader settle check must prove the chart frame belongs to the EXPECTED patient before starting the read (fixes same-frame-name-mismatch race — compare banner identity before read, re-settle instead of refuse-after-read); (3) fold the corner "Athena tab" pill (content.js:1984) into the one-pill design; (4) day-nav: tolerate post-midnight week-strip no-selection (goHome then explicit date click).

## 2026-07-24 — "N saves not confirmed" ROOT-CAUSED, FIXED, PROVEN LIVE (b530)

**Owner report:** "6 saves not confirmed. Bernard P Brooks, Christopher Fink, Lindsey Bray, Luz Maria Lemus, and 2 more were not found in the saved store after saving."

**Probe that cracked it:** every named patient was PRESENT in the live store (Bernard P Brooks p_sched_ibuwu5, Christopher Fink p_sched_157yjhf, Lindsey Bray p_sched_1b2vbd, Luz Maria Lemus p_sched_1fmgvk0 — all source athena-schedule). The saves LANDED; something deleted them before the verifier looked and a later pass re-created them. Real row loss, not a false banner.

**Root cause:** savePatients(arr) is a wholesale replacement. Every render/sweep/organize path materializes its roster array BEFORE writing, so any row saved in between is deleted. upsertPatient keys by exact id, so nothing was folded — rows were dropped and re-made. Reproduced deterministically from shipped bytes: tests/patient-row-loss-guard.test.js (one stale bulk write deletes all four owner-named patients).

**Fix 1 pts-rowguard-1.0.0 (ScribeFlow.html):** a write may only remove a row the caller could plausibly have SEEN. Rows written within 12s are carried forward unless the caller passes {allowRemovals:true}; purge + deletePatient opt in explicitly. Idempotent, PHI-free logging (ids only), fails SAFE.

**Fix 2 sv-1.1.0 (feat_save_verify.js):** an unconfirmed save is automatically RE-SAVED once (id-anchored through upsertPatient.__mlsOrig — cannot duplicate, cannot touch another chart, once per patient) before anything is reported. The card no longer tells the doctor to reload and retry.

**LIVE PROOF on b530 (owner's signed-in app, real store):** store 1481 → planted probe row (direct store write, no server mirror) → 1482 → fired the exact stale bulk write that used to destroy data → **probe SURVIVED**, guard logged {kept:1, ids:['__rowguard_probe_…']} → authorized removal with {allowRemovals:true} → probe gone, store back to **1481 exactly**. This also proves the third argument survives the whole savePatients wrapper chain (wipe-guard forwards via orig.apply), so deletes still delete. No real patient touched.

**END-TO-END pull on b530 (2026-07-24, bodies ON, 5 scheduled):** schedule 5/5, **ZERO "saves not confirmed" cards**, store 1481 → 1481 (no loss), guard catches 0 (expected — all 5 rows already existed, so no fresh row for a stale writer to drop). Remaining: 5/5 chart-body reads failed on the KNOWN chart-swap-settle race — ext 3.0.5 (built, unpublished) is the fix; the browser still runs 3.0.4.

**Certification:** gate 277/277 green in an isolated tree built from the exact staged bytes (shared worktree is red on another session's in-flight mls-connect.js — verified theirs, not this lane). Shipped as 1a61c24 (fix) + 4fe51a0 (b530 cache-bust, staged surgically from HEAD so no foreign WIP rode along).

## 2026-07-24 — ext 3.0.5 PUBLISHED + INSTALLED; swap-settle HELPS but does NOT fully fix the chart-swap race

**Released and installed (not just published):** pin train run for 3.0.5 (feed, get-extension href/download/digest, ScribeFlow Settings link, sw lowercase passthrough, _config include + sha, pages inventory, checker SERVER_EXT_VERSION + loader token 20260723chk304r1 -> 20260724chk305r1 in both connectors, previous token shifted into the immutable-satellite triplet, plus the ESCAPED-regex zip forms in three boundary suites — the trap the release skill warns about). Live byte-verified: served zip sha 8efcbf7cc9a4…9b8a356 EXACT, feed 3.0.5, get-extension points at 3.0.5, 3.0.4 zip now 404. Site b531/mls-v113. Installed into the pinned unpacked folder (backup MLS_Assist_backup_3.0.4_20260724_153021 kept, 20 files copied, never a mirror on a running folder) and **PONG-VERIFIED: running extension = 3.0.5, digest 1a9782709de1a6b7…, no older build active.**

**Same-day A/B on the identical 5-patient day (2026-07-24, bodies ON):**
- ext 3.0.4 (b530): 909s, schedule 5/5, **5/5 chart bodies FAILED**.
- ext 3.0.5 (b531): **682s (-25%)**, schedule 5/5, still 0/5 coverage-complete, but the failure mix MOVED: same-frame-name-mismatch x3 + visit-bodies-incomplete x2 (two charts now clear the identity gate and fail later instead of burning a full wrong-chart read).

**HONEST VERDICT: the swap-settle pre-gate is a real speed and diagnosis win, not a fix.** The batch lane still cannot get the chart to swap for most patients. Combined with the earlier single-lane experiment (which refused with "athenaOne has a DIFFERENT patient open"), the evidence now points at the chart OPEN itself being a no-op in the batch lane on athena v26.7 — the frame keeps rendering patient N-1 because nothing actually navigated, so no amount of settle-polling can help. NEXT (needs live DOM evidence during a batch open, owner-present): instrument the batch chart-open click path against the live v26.7 DOM, confirm whether the open verb still targets a control that exists, and fix the opener — not the waiter. Do NOT claim ON x2 until a day reaches coverage-complete.

## 2026-07-24 — chart-swap diagnosis CORRECTED: the opener is fine; the READ is not tab-bound

Earlier today I wrote that the batch chart OPEN looked like a no-op on v26.7. **That was wrong, and this corrects it.** Reading the code path end to end:

- The history loop DOES open each chart per patient: `feat_mls_schedimport_exact.js:2259` calls `window._assistReadChart(target, …)` with its own request id and deadline, immediately before the visits read at `:2375`. There is a bounded in-batch retry around it (si-1.7.2) precisely for "the chart OPEN landed on the previous patient".
- The visits read is NOT bound to a tab. `background.js:9448 runAllVisits()` calls `pickEmrTab(frozenHint)` and reads whatever chart is open in whatever Athena tab it picks. The tabId that the chart was just proven in is never passed to it.

**Multi-tab evidence:** a goto diagnostic earlier today reported the extension driving `tabId 256594014` while this session's tab group held Athena tab `256594376` — so at least TWO Athena tabs exist in the owner's Chrome. Project memory already carries this hazard class ("athenaTabs must be 1", write-test encounter gate).

**Consequence:** if the chart is opened in tab A and the reader picks tab B, tab B is legitimately showing a different patient and the identity gate refuses with `same-frame-name-mismatch` — a CORRECT refusal protecting against a wrong-chart read. That explains why 3.0.5's settle-polling improved wall-clock (-25%) and moved two charts to a later failure stage but fixed nothing: no amount of waiting makes tab B become tab A.

**Decisive experiment queued (cheap):** during a live pull, capture the tabId in the chart-open receipt and `vr.diag.tabId` from the visits read. Different → thread the proven tabId through `mlsAppReadAllVisits` and have `runAllVisits` use it instead of `pickEmrTab` (page + extension, 3.0.6). Identical → it is a true in-tab settle problem and the DOM work is needed instead.

**Interim remedy for the owner:** keep exactly ONE athenaOne tab open while a pull runs. This costs nothing and, if the hypothesis holds, is the difference between 0/5 and 5/5 chart bodies.

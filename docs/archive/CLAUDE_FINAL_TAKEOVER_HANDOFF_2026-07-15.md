# Claude final takeover: own, finish, deploy, and live-prove MLS Assist

**Directive from the user:** Claude fully takes over this work from Codex. This is not a review, advisory task, or one-file assignment. Claude owns the remaining source changes, automated testing, production deployment, unpacked Chrome-extension reload, real computer/browser testing in the user's existing signed-in Chrome/Athena session, packaging, and final report. Continue the fix -> deploy/reload -> live-test -> fix loop until all required acceptance gates pass.

**Prepared:** 2026-07-15 (America/Indianapolis)

**Primary worktree:** `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration`

**Branch:** `codex-release-b273-integration`

**Current base:** `a455b211c815955a21945d9484b994fd70d972cc` (HEAD, `origin/main`, and `origin/codex-release-b273-integration` matched when prepared)

**Coordination log:** `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration\CLAUDE_CODEX_EXTENSION_SYNC_2026-07-14.md`

**Proven-reader/archive research:** `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration\ARCHIVE_INTEL_BRIEF_2026-07-15.md`

## 1. The honest current state

The extension is **not finished and not live-proven**.

The last explicit live Wednesday pull, on the then-deployed v2.9.24 / importer `si-1.6.1` / app assets `b280`, returned:

- Schedule: **17/17 complete** for that dynamic Wednesday schedule.
- Calendar import: 17 attempted, 17 accounted, 17 newly created, 0 failed.
- History: **0/17 succeeded**. All 17 failed before a verified history save.
- Root evidence: this Athena grid exposed name, time, reason, and exact `appointmentId` for all 17 rows, but exposed DOB 0/17 and MRN 0/17.
- The failure was honest and fail-closed. No wrong-patient history was stored and no Athena write occurred.

Do not say history is fixed until a new live read-only run on the exact published and reloaded build returns the authoritative dynamic count `N/N` with exact-patient histories, prior visits, six organized cards, repeat idempotency, and op-note context.

## 2. Claude must use the real computer and browser

This product is a **Chrome browser extension plus the live MLS website**. Local source/tests alone cannot finish the task.

Claude must:

1. Use computer/Chrome browser control, not only terminal tests.
2. Work with the user's existing Chrome profile, installed unpacked MLS Assist extension, open MLS site, and existing signed-in Athena tabs.
3. Preserve the signed-in Athena session and tell the user immediately if it signs out.
4. Never close the useful signed-in Athena tabs unnecessarily.
5. Personally mirror/reload the exact extension candidate, refresh the affected pages, and prove the loaded extension version and digest in the browser.
6. Click the real MLS controls, including the real explicit `Pull this day` button, and watch the real bounded run settle.
7. Inspect real rendered results in MLS: schedule, active patient, prior visits, all six history cards, op-note model context, recording controls, voice controls, portal, and final Athena preview.
8. Fix any live failure, rebuild/reload the extension and app assets, and repeat. Do not stop after a local pass or one partial live pass.
9. Only one agent/browser driver may operate the live Athena cohort at a time. There are two Athena tabs; do not run two competing pulls.

The enabled unpacked extension folder has historically been `C:\Users\Micha\Downloads\MLS_Assist_v1.65`. Its folder name is stale; trust `manifest.json`, the live extension ping, and byte hashes. The extension supports a one-shot `mlsDevReload` acknowledgement. Verify the acknowledgement and then verify the actual loaded build.

## 3. Candidate code currently present locally (not a proven release)

The current dirty worktree contains a new candidate:

- Extension version: **2.9.25**
- Exact schedule importer: **`si-1.6.2`**
- App asset version: **`b282`** (`MLS_APP_BUILD=2026-07-15-b282`)
- Current automated result: **PASS all 85 local regression suites**.
- Local package contract: **17 exact root files**, deterministic and byte-verified.
- The candidate is **not committed, not pushed, not published, not frozen/reloaded as a final exact build, and not live-history accepted**.
- `manifest.json` has version 2.9.25 but still needs the final digest-bearing `version_name`; freeze the source, compute the deterministic extension core digest, add it, and make the live ping and acceptance collector prove the exact loaded bytes.

Important candidate behavior already implemented:

1. Demographics-bearing schedule rows use strict row-scoped DOB/MRN proof.
2. Demographics-free rows use the row's exact Athena `appointmentId`.
3. The extension opens the exact appointment row only for bootstrap; a name-search fallback is not accepted as appointment-ID proof.
4. A real same-tab navigation delta is required. A stale cached frame containing the ID is insufficient.
5. The freshly changed navigation frame must expose one consistent patient banner with exact expected name and a valid DOB.
6. Duplicate appointment IDs, duplicate banner candidates, stale banners, name/DOB conflicts, compact-ID collisions, missing proof, and unchanged frames fail closed.
7. The verified banner identity becomes the frozen patient proof; the importer materializes the exact local patient ID before history is queued.
8. The requested date is restored after every chart bootstrap before the next appointment.
9. History and op-note context remain exact-patient bound.

Primary implementation files:

- `background.js`
- `content.js`
- `feat_mls_schedimport_exact.js`
- `feat_opnote_history.js`
- `feat_athena_provider_roster.js`
- `mls-connect.js`
- `ScribeFlow.html`
- `ScribeFlow-staging.html`
- `manifest.json`
- `extension-version.json`
- `feat_mls_checker.js`
- focused tests registered by `tests/run-all.js`

New focused test: `tests/appointment-id-bootstrap-contract.test.js`.

The deterministic compact-ID collision fixture is intentional and must remain:

- `mrn:mrn1uacaok154ts46`
- `mrn:mrn1kg9zyr0h0ljm4`

Both map to `p_sched_oi9qit`; the second identity must fail closed rather than merge.

## 4. Fresh blockers from final acceptance review

### 4.1 Provider/roster receipt provenance is incomplete

The strict PHI-free collector requires both live and attached/final roster receipts to carry fresh, batch-bound fields:

- `targetDate`
- exact `requestId` matching `scheduleReceipt.requestId`
- `providerMode`
- `requestedProviderId`
- `requestedProviderStableKey`
- completeness/bounds evidence and stable provider identity keys

The provider-roster normalizer/importer does not yet emit or preserve every field. The collector must stay red until product receipts carry them. Add these at the source, preserve them through the final result, and add hostile tests for stale, mismatched, missing, and weakly typed provenance.

### 4.2 Active quiet-work tab must outrank a mutable pin

The Athena tab picker currently checks a mutable explicit pin before the active quiet-workspace (`QP`) lease. A changed or stale pin can move the next patient in one cohort to the other Athena tab.

Required invariant:

- While a cohort has an active QP lease, every patient operation stays on that exact leased Athena tab.
- Consult an explicit pin only when no active QP lease exists.
- Add a two-tab runtime regression proving a pin change cannot hop a mid-cohort read.
- Preserve no-yank behavior: do not repeatedly steal focus or bounce between Athena tabs.

### 4.3 Acceptance collector must remain stricter than the product

Current collector: `tmp\phi-free-live-pull-acceptance-collector.js`.

It has strict numeric/boolean evidence, latches any repeat failure, compares stable encounter mappings, requires actual six-card DOM output, and binds extension digest to a fresh `mlsPong`/`mlsExtVersion` build ID. Before live use:

- finish the independent hostile review;
- require aggregate `identityBootstrapReceipt` evidence for every demographics-free row;
- fail if any bootstrap lacks exact appointment ID, true navigation delta, fresh banner name+DOB, requested date, and matching batch request;
- keep all exposed receipts PHI-free;
- freeze the collector hash and run hostile VM fixtures against those exact bytes;
- never weaken the collector to make a failed product run green.

Month acceptance is intentionally uncertified in the current collector. Add a real complete month-route receipt and tests; do not mark month PASS because a function merely returned.

## 5. What makes this extension “perfect”

“Perfect” means every applicable item below works in code and passes both automated and live acceptance on the exact release bytes. A green toast is not proof.

### 5.1 Pulls are explicit and scope-correct

- Signing in, loading MLS/Athena, switching patients, or reloading the extension never auto-pulls.
- A pull starts only after the user clicks `Pull this day`, a selected-provider pull, or a clearly labeled month/calendar pull.
- The result proves the selected date and provider scope; it cannot silently use today, a prior date, or all providers.
- Never hardcode July 14, July 15, 17, or 18. The authoritative receipt defines the dynamic count.

### 5.2 Complete schedule and provider coverage

- Modern React, legacy grid, virtualized horizontal/vertical grids, duplicate layout copies, and scrolled last rows reconcile completely.
- Exclude `OPEN`, blocked/capacity, staff/message, insurer, location, and other non-patient rows.
- Preserve exact Athena wall times; never default an appointment to 6:00 or 7:00 PM.
- Provider selector contains the real complete roster without dates, times, locations, insurers, reasons, or patient names.
- One selected provider, all providers, a home/day-sheet pull, calendar-selected day, and month route all work.
- Multiple patients at the same time and same-name patients remain separate by stable identity.
- Full-day/provider/month success proves provider and viewport/scroll completeness before publishing.

### 5.3 Exact identity and full history for every patient

- Bind every row through strict DOB/MRN proof or exact appointment-ID -> changed frame -> fresh chart-banner name+DOB proof.
- Never guess demographics, borrow from a same-name patient, trust a stale hidden frame, or weaken mismatch gates.
- Reach the clinical chart/prior-visits surface, not exam-prep or briefing.
- Pull every usable prior visit with exact encounter keys and real narrative bodies. Legitimate short non-narrative cases may be flagged `bodyMinimal`; never fabricate or silently drop them.
- If save-visits is enabled, save all verified visits idempotently. The toggle is clear and exact-patient bound.
- Repeat pulls enrich/update new information and add genuinely new encounters without duplicating patients, appointments, or visits.
- Preserve manual/unverified user entries and never count them as Athena coverage.
- An old ledger is not proof that a newly pulled day/patient is current.
- End each batch with one calm aggregate result: requested/processed/succeeded/failed, categorized reasons, and a human-only `Retry failed histories only`. Suppress popup storms but never hide a new real failure.

### 5.4 Correct organized profile and prior visits

After each successful exact-patient pull, visibly populate from the current canonical snapshot:

- Problems
- Medications
- Allergies
- Summary
- Vitals
- History & background (PMH/PSH/social/family when available)
- Dated prior/recent visits with procedure, diagnosis, source, and usable detail

Requirements:

- No stale or wrong-patient card can satisfy acceptance.
- Imported visits are collapsible, searchable/filterable, and source-labeled.
- `Summarize all` actually summarizes while preserving source visits.
- The overview is clinically useful: demographics/language context, key history, diagnoses/treatment, and dated recent visits, without invented facts.
- Diagnoses/procedures populate their correct groups instead of remaining only in prose.
- Large histories remain responsive.

### 5.5 Op-note generation

- Generation receives exact MLS patient ID, verified demographics, full verified prior-visit bodies, organized history, current visit facts, and selected op-note template.
- Verified history is placed before both legacy and current selected-template sections.
- Initial generation and repair stay bound to the same patient/visit/template.
- No unsupported procedure/history fabrication.
- Live acceptance generates and inspects an MLS-only draft; it does not send the draft to Athena.

### 5.6 Main visit workflow without forced Advanced workspace

- The top/main visit area has a visible editable type/paste transcript box.
- `Start recording` never opens Advanced workspace.
- Stop/resume can happen repeatedly without losing earlier segments; typed/pasted text and every recording segment combine into one note.
- Recording, patient switch, and New Visit cannot leak audio/transcript across patients or visits.
- Generation finishes with visible note text and a useful review state; no permanent “Generating...” state.
- Secondary control is named **Advanced visit workspace** and remains optional.
- The simple top workflow works without scrolling into Advanced tools.

### 5.7 Voice controls

- **MLS Copilot Voice**, **MLS Assistant**, and **Dictate** remain distinct.
- Dictate works in every intended editable field and remains bound to its originating patient/visit.
- MLS Assistant opens reliably, finishes cold loading, executes one frozen request, and recovers rather than staying “still loading.”
- Copilot Voice is not treated as Dictate or MLS Assistant.
- “Show MLS Assistant” destination teaching is connected to the unified Athena review flow. It only observes the next click and never executes a write.

### 5.8 Patient portal and active-patient state

- Patient Portal is easy to find near active-patient controls and exact-patient bound.
- Switching patients cannot reset progress, flicker, or send to the wrong patient.
- Athena sync shows current exact-patient schedule/chart/history freshness, not only an old global activity log.

### 5.9 One human-reviewed Athena confirmation page

- One unified page shows exactly **what** will go **where** in Athena.
- It combines note sections, supported billing/codes, supported typed orders, and available Save/Sign/Bill actions without duplicate competing review systems.
- Suggested orders are compact editable review rows in the final step; they never silently become orders.
- Each row shows destination, exact payload, exact patient/encounter, readiness/block reason, and executability.
- Every executable action requires a separate explicit human confirmation over an immutable payload hash.
- No chaining: note write cannot auto-Save, Sign, Bill, order, prescribe, refer, or trigger another action.
- Unknown/untyped destinations fail closed.
- Actual order placement is executable only through a supported typed Athena adapter behind the human confirmation button. Do not live-test an order, prescription, referral, procedure, billing submission, Sign, or Bill action in this task.

### 5.10 UI, loading, and performance

- All metadata/status/warning text on light cards has readable dark contrast, including appointment chips, verification/history states, and sign-in/import warnings.
- Loading is bounded, calm, useful, and truthful.
- Normal use has no schedule diagnostic panel; diagnostics are query-gated, PHI-free, and temporary.
- Clear stale scary error notices once a correlated successful run supersedes them, but never suppress a current failure.
- No freeze, recurring 10-second visual glitch, focus yank, Athena-tab hop, wrong active patient, or unbounded scan.
- Observers/timers/history storage are bounded for large days/months.

### 5.11 Honest Athena session handling

- “Connected” requires an all-frame signed-in clinical-session probe. A frameset URL is insufficient.
- Nested timeout/login frames veto the tab and clear stale pin/cache/keepalive state.
- Do not auto-reload Athena, auto-click login/interstitial controls, close the signed-in tab, or claim health falsely.
- If Athena signs out, stop live testing and tell the user immediately.

### 5.12 Final package and live build

- Freeze final extension source/app assets before packaging.
- Add digest-bearing `manifest.version_name`; expose the same build ID through the live extension ping.
- Run 85+ suites, syntax checks, hostile collector fixtures, `git diff --check`, package contract, and deterministic ZIP byte verification.
- Package only the 17 allowed root files. No stale ZIP, collector, log, PHI, scratch data, or unrelated files.
- Build the final ZIP only after the extension is live-proven.
- Mirror/reload exact files, verify version+digest, publish metadata/download/settings text/badge/ZIP together, HTTP-fetch production, and byte-compare.
- Record commit, versions, ZIP path/size/SHA-256, automated results, and live receipts.

## 6. Exact live acceptance sequence Claude must personally run

1. Inspect dirty worktree and coordination state before editing.
2. Finish provider receipt provenance and QP-before-pin invariant with hostile tests.
3. Freeze and independently red-team the final PHI-free collector, including appointment bootstrap and digest gates.
4. Run full local/focused/syntax/diff/package tests. Any failure blocks deploy.
5. Add final digest-bearing `manifest.version_name`; update exact expected build in collector/tests.
6. Commit/push intended product/tests/docs only and publish exact app/extension assets.
7. HTTP byte-verify production against the frozen commit.
8. Use the computer/Chrome browser to mirror/reload the installed unpacked extension. Confirm actual loaded version+digest.
9. Confirm Athena is genuinely signed in by all-frame health probe. If not, tell user and stop.
10. Confirm startup/sign-in is passive and did not auto-pull.
11. Select date dynamically. For the focused first proof select **Matthew Schaeffer** explicitly rather than “All providers.” Do not hardcode his patient count.
12. Install frozen PHI-free collector with explicit date and exact build/digests.
13. Click the real `Pull this day` button once.
14. Require complete schedule/provider/roster/calendar/canonical receipts and dynamic scoped count `N`.
15. Require **history N/N**, one exact bootstrap/identity proof per patient, real prior-visit bodies, and zero wrong-patient/duplicate/collision evidence.
16. Inspect the real MLS UI: six cards, prior visits, summaries, collapse/search, exact times, DOB/MRN, source labels, and no duplicates.
17. Repeat the same date/provider pull. Require no duplicates, zero regression/removal, stable mappings, and enrichment of new information.
18. Generate an MLS-only op-note for a patient with verified history and prove the request contains that exact patient's history/template.
19. Independently test selected-provider, all-provider day, calendar-selected day, and month routes. Each needs its own complete dynamic receipt and history coverage.
20. Live-test top textbox, recording stop/resume/one-note generation, MLS Assistant, Copilot Voice, Dictate, Patient Portal, active-patient sync, contrast/loading, no debug panel, no auto-pull, no yank, and no recurring glitch.
21. Inspect unified Athena confirmation in read-only preview mode. Verify note/billing/order/Save/Sign/Bill rows and block reasons. Do not execute high-risk actions.
22. Only after all gates pass, build/publish final ZIP, repeat byte/version checks, and write final report.

The real live Athena/MLS result is the authority. A local fixture cannot override live history 0/N.

## 7. Athena safety limits

- Read-only schedule pulls, chart/history navigation, accordion/slideout reads, and MLS-only draft generation are allowed.
- Never write, delete, edit, paste, Save, Sign, Bill, place an order, prescribe, refer, check in/out, or finalize anything on a real patient during general testing.
- The only chart ever authorized for a possible simple live note test is **Adam J Schaeffer**. Treat it as a separate final test: exact chart, exact encounter, exact preview, one simple note, and no chained Save/Sign/Bill/order. Never use another patient. Delete only the exact test artifact and only with explicit cleanup confirmation.
- No live order, Sign, or Bill test is authorized, including on Adam.
- Never weaken identity/completeness gates.
- Never expose PHI in logs, screenshots, handoffs, tests, collectors, or source.
- If Athena signs out, tell the user immediately.

## 8. Worktree and collision rules

Do not edit, reset, switch branches, commit, push, or deploy from:

- `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\live-legal-release-20260714`
- `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\live-backend-audit-20260714`

Before overlapping website/backend changes, update:

`C:\Users\Micha\Desktop\MLS_EVERYTHING\03_handoff_and_reports\ACTIVE_TASK_COORDINATION_2026-07-14.md`

Preserve all later `origin/main` legal/booking/timezone/patient-bar/settings/tooltip/voice/sidebar/public-site work. Do not overwrite a newer live module with an old branch copy.

Current untracked items:

- `ARCHIVE_INTEL_BRIEF_2026-07-15.md` (valuable PHI-free research; keep)
- `MLS_Assist_v2.9.22.zip` (stale; exclude)
- `tests/appointment-id-bootstrap-contract.test.js` (include)
- `tmp/` collectors/harnesses (local tooling; never package)

## 9. Verification command and current result

```powershell
& 'C:\Users\Micha\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\run-all.js
```

Current candidate result at handoff: **PASS all 85 local regression suites**.

Necessary, not sufficient: last live history remains 0/17 until the new exact build proves otherwise.

## 10. Required final report

Do not report “perfect,” “fixed for good,” or “done” until every live-critical gate passes. Report:

- exact version/build/digests/commit/ZIP;
- automated and hostile-review results;
- schedule counts for every tested route;
- history requested/succeeded/failed and reason categories;
- bootstrap/identity proof totals;
- prior-visit parsed/persisted totals;
- six-card current-operation coverage;
- repeat idempotency/enrichment;
- op-note exact-context result;
- provider/day/all-provider/calendar/month results;
- recording/assistant/dictate/portal/top-workflow/UI results;
- unified Athena preview and deliberately unexecuted actions;
- confirmation of no Athena mutation, or the exact separately authorized Adam-only note receipt;
- every remaining limitation. If any remains, say so and do not use “perfect.”

## 11. Immediate takeover actions

1. Read this file, the coordination log from the 09:27 entry onward, and `ARCHIVE_INTEL_BRIEF_2026-07-15.md`.
2. Inspect the dirty worktree before editing.
3. Finish provider receipt provenance and QP-before-pin two-tab safety.
4. Finish/freeze the collector and hostile review.
5. Run all tests and finalize digest/version.
6. Deploy, mirror/reload, and byte-verify.
7. Use the real Chrome/computer session to live-test, fix, reload, and retest.
8. The first meaningful milestone is a real dynamic **N/N history pull**, not another schedule-only pass.

**Completion sentence:** The task is complete only when the exact published Chrome extension, in the user's real signed-in Athena environment, pulls the complete dynamic schedule and correct full history for every patient, organizes it into the right MLS profile and op-note context, repeats without duplicates, supports provider/calendar/month routes, keeps the main recording/voice workflow stable, and presents every Athena action through one exact human-reviewed confirmation flow without unauthorized mutation.

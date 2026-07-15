# Claude assignment: finish the MLS Assist extension history workflow and prove it live

Work this task to a verified result. Do not merely analyze it or declare it fixed because automated tests pass. The current release has a live-proven schedule reader, but the full extension is still a failure because the exact-patient history pull failed **18 of 18** patients.

This is the harder, highest-priority lane. Move quickly, but do not trade speed for wrong-patient risk or false completeness. An older extension was already close and did pull patient histories; do not reinvent Athena navigation from scratch. First understand the real Athena surfaces: the exact patient result's Chart link opens the clinical chart/client summary, while prior encounters live behind the patient-scoped Visits/Events rail. Reuse the proven opener and navigation concepts from the referenced old builds, then integrate them with the newer completeness and safety receipts.

## Non-negotiable outcome

Starting from the signed-in Athena day schedule, an explicit user click on **Pull this day** must:

1. Return exactly the 18 real July 14 patients, with DOB present for all 18.
2. Exclude duplicate layout copies and `OPEN`/capacity rows.
3. Open each exact patient's real clinical chart, not the appointment exam-prep/briefing shell.
4. Verify exact identity with name plus DOB/MRN before accepting any content.
5. Pull verified chart history and all usable prior visits for every patient.
6. Organize verified data into Problems, Medications, Allergies, Summary, Vitals, and History & background.
7. Preserve source visits, make them collapsible/searchable, and make Summarize all actually work.
8. Supply the selected patient's verified history and visits to the op-note request/context so an MLS-only op-note preview is correct.
9. Repeat safely: enrich/update newly found information without duplicate patients, appointments, visits, or history.
10. End with an honest, calm receipt that distinguishes succeeded, failed, empty-with-proof, and retryable patients.

The acceptance result is **18/18 exact histories succeeded**, not “18 processed.” Continue diagnosing, fixing, testing, and rerunning until this works or there is a concrete external blocker that cannot be safely bypassed.

## Current verified state

- Worktree: `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration`
- Branch: `codex-release-b273-integration`
- Published/current main commit: `bd37e9e9e306c87cdee38bc33ec2500de0d24ed2`
- Release: MLS Assist `v2.9.21`
- Current ZIP: `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration\MLS_Assist_v2.9.21.zip`
- ZIP SHA-256: `9281010DDD882FB089343B346E8D3F1FC4B887F331D8E2FD5A00DC2B08DD815C`
- Enabled unpacked folder has historically been `C:\Users\Micha\Downloads\MLS_Assist_v1.65`; trust its loaded manifest/version ping, not the folder name.
- v2.9.21's legacy Athena day-grid fix is live-proven:
  - 40 rendered rows
  - 36 patient observations (two rendered copies of 18)
  - 4 `OPEN` rows removed
  - 18 unique real patients returned
  - DOB 18/18
  - app merge receipt: added 1, enriched 17, no duplicate appointment creation
- The exact live history run is a total failure:
  - requested 18
  - processed 18
  - succeeded 0
  - failed 18
  - `complete:false`, reason `history-partial`
  - observed failures: exam-prep/briefing view with no patient banner, `same-frame-name-mismatch`, and one unreadable chart
  - the safety gates correctly refused to store unverified data
- All 55 local regression suites passed, but this does **not** override the live 18/18 failure.

Read the fuller evidence first: `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration\FABLE_EXTENSION_HANDOFF_2026-07-14.md`.

Coordinate continuously with Codex through `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration\CLAUDE_CODEX_EXTENSION_SYNC_2026-07-14.md`. Read it before editing, append your intended files/hypothesis before changes, and append redacted receipts/findings after every meaningful test. Do not overwrite prior entries.

## Confirmed root cause and required navigation sequence

Do not restart from scratch. The older proven `mlsFindPatientOpenDriverFn` remains byte-identical, but the modern `mlsAppReadChart` route bypasses that opener. It therefore tries to read while Athena is still on the appointment exam-prep/briefing surface. Fix the orchestration so every patient follows one serialized same-tab sequence:

1. **SearchOpen**: exact patient search/open, DOB-gated (and MRN-gated when available). Use real pointer/mouse activation where Athena requires it. Do not accept a substring/first-row match.
2. **ChartRequest**: call the chart reader with an explicit `preopened`/exact-same-tab contract. Wait for the requested patient's real same-frame banner and clinical chart. If the page is exam-prep, transition through read-only Chart/Refresh Chart controls and keep polling for the requested identity.
3. **AllVisits**: in that same already verified patient tab/context, open/read the visits surface and capture the complete visit index and bodies.
4. Recheck name plus DOB/MRN after navigation and before returning either chart or visits. Fail closed on mismatch.
5. Return per-stage receipts so it is obvious whether SearchOpen, ChartRequest, identity verification, or AllVisits failed.

Preserve current no-yank behavior: serialize patient navigation in the Athena tab, but do not repeatedly steal focus or drag the user back after they change tabs. Preserve all current exact-identity and fail-closed protections. A wrong-patient success is worse than an explicit failure.

Use the older certified implementations as targeted references, especially:

- `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\restore-point-2026-07-10\extension-v1.98-src\background.js`
- `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\visitfix-v12\MLS_Assist_v2.01.zip` (`background.js` inside)
- `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\HANDOFF_2026-07-09_EXTENSION_OPENER.md`
- `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\extension-v159-prep\WHAT_CHANGED_v159.md`
- `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\extension-v159-prep\WHAT_CHANGED_v166_v167.md`
- `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\EXT_V295_QUIET_PULL_HANDOFF.md`

Reuse the proven opener/identity/navigation concepts; do not revert the newer schedule completeness, no-yank, package, confirmation, or safety work.

## Required UI cleanup while fixing the workflow

1. During a managed day/provider history batch, suppress the repetitive alarming **“No visits were saved”** popup for each patient. Replace it with one calm final batch summary showing exact counts, categorized reasons, and **Retry failed only**. Keep truthful standalone/manual feedback. Do not conceal a genuine failure or turn it green.
2. There are already pending uncommitted toast-related changes in `feat_save_verify.js`, `tests/run-all.js`, and `tests/save-verify-managed-batch-toast.test.js`. Inspect and preserve/integrate them; do not discard or overwrite another agent's work.
3. The right-side **Schedule diagnostic (redacted)** panel is acceptable only while diagnosing. After the full live pass, remove it from normal user view or make it strictly query-gated/closed by default. It must never expose PHI.
4. The app currently has stale imported state showing 21 schedule items even though the authoritative July 14 pull proves 18. On a successful explicit authoritative pull, reconcile same-source/same-date/same-provider stale imported records so current-day UI and Choose patient show exactly 18. Do not delete manual records, unrelated dates/providers, or unverified data. A repeat pull must remain 18 and enrich rather than duplicate.
5. A pull must never start automatically on sign-in or page load. It starts only from an explicit user action.

## Exact acceptance tests

Add focused automated regressions for the repaired real path, then rerun the full suite. Tests must prove:

- `mlsAppReadChart` cannot bypass SearchOpen when a patient is not already exact-open.
- SearchOpen uses exact name plus DOB/MRN and rejects ambiguous/same-name wrong-DOB results.
- Exam-prep with no patient banner transitions to the correct clinical chart before reading.
- ChartRequest receives and enforces the `preopened` exact-same-tab contract.
- AllVisits runs in the same verified patient context and cannot reuse a stale prior patient frame.
- A mid-sequence identity change fails closed and stores nothing.
- Re-pulling enriches/upserts new chart/visit information without duplicates and preserves manual edits.
- Managed batch failures produce one final calm summary, not per-patient alarming popups.
- Authoritative 18-patient reconciliation removes stale imported current-day entries from the active schedule view without touching manual/unrelated records.
- Diagnostic UI is absent by default and only available through the redacted support gate.

Then perform the live read-only acceptance run against the actually loaded new unpacked build:

1. Confirm extension version and confirm Athena is signed in. If Athena signs out, stop and tell the user immediately.
2. Explicitly click Pull this day; confirm schedule 18/18, DOB 18/18, no `OPEN`, no duplicate layout rows, and UI count exactly 18 rather than stale 21.
3. Run a small exact-patient history sample first, then all 18 serially.
4. Require history success 18/18, exact identity 18/18, complete visits receipts, and no wrong-patient data.
5. Spot-check several patients against Athena: the six organized cards and prior visits must contain correct source-backed information.
6. Repeat the pull and prove no duplicates; newly available information must enrich the existing imports.
7. Generate an op-note preview **inside MLS only** and inspect its request/context to prove the exact patient's verified history, visits, identity proof, and selected template are present. Do not send it to Athena.
8. Live-test one selected provider, all providers, and the full-calendar/month route. Each must establish the complete provider roster, all schedule patients/DOBs, and per-patient history completeness before claiming success.
9. Verify the repeated popup is gone during the managed batch and the final result remains honest.
10. Verify the redacted schedule diagnostic panel is not visible in the normal release UI.

Only after those tests pass, bump to the next extension/app build, build the deterministic ZIP, run the package contract, byte-verify the published/live artifact, mirror that exact ZIP into the enabled unpacked folder, reload it, and repeat the live acceptance run on the exact published build. Record commit, version, ZIP path, size, SHA-256, automated results, and live receipts.

## Absolute Athena safety rules

- Read-only navigation, schedule pulls, chart/history reads, and visual inspection are allowed.
- **NEVER write, edit, paste, delete, Save, Sign, Bill, place an order, submit a referral/prescription/procedure, check in, or otherwise mutate Athena in this assignment.**
- Do not click any action that could start an order chain or finalization workflow.
- Do not test any write merely because a button exists.
- Adam J Schaeffer is the only patient ever contemplated for a separate future note-write test, but there is **no permission in this assignment** to write even to Adam. A future mutation requires a fresh, exact user confirmation naming the one action.
- Do not weaken name/DOB/MRN gates to obtain a green count.
- Keep the signed-in Athena tab open. Use only harmless read-only navigation. If it signs out, notify the user immediately rather than pretending the live test ran.
- No Athena mutation occurred in the current v2.9.21 run.

## Coordination and repository restrictions

- Work only in `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration` on `codex-release-b273-integration`.
- Do not edit, reset, switch branches, commit, push, or deploy from:
  - `dispatch-work\live-legal-release-20260714`
  - `dispatch-work\live-backend-audit-20260714`
- Preserve all unrelated and uncommitted changes. Inspect status/diffs before editing.
- Before changing overlapping website/backend files, add your task name, worktree, branch, and intended files to `C:\Users\Micha\Desktop\MLS_EVERYTHING\03_handoff_and_reports\ACTIVE_TASK_COORDINATION_2026-07-14.md`.
- Do not rewrite history or force-reset user work. Rebase/integrate current `origin/main` safely before final publication and rerun tests afterward.
- Do not call the release “perfect,” “fixed for good,” or complete until the exact published build passes the entire live read-only acceptance workflow above.

## Final deliverables

Provide:

1. The implemented fix and tests.
2. A concise root-cause explanation showing why the modern route bypassed the proven opener and how the new same-tab sequence prevents exam-prep/stale-frame reads.
3. Automated suite results.
4. Exact live receipts for 18/18 schedule, DOB, history, visits, six-card organization, repeat-pull idempotency, and MLS-only op-note context.
5. Provider/all-provider/calendar-month live receipts.
6. Proof that the batch popup and default diagnostic panel issues are resolved.
7. Final commit/version/ZIP path/hash and proof that the exact published build was the one live-tested.
8. Any remaining blocker stated honestly and specifically; do not relabel a partial result as success.

Start at the history opener/orchestrator, not the schedule parser. The schedule parser is live-proven. The release is not done until history works live.

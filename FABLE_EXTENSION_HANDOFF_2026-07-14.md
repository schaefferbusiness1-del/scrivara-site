# Fable handoff — MLS Assist extension and live Athena read workflow

**Date:** 2026-07-14  
**Current release:** MLS Assist **v2.9.21**  
**Bottom line:** The explicit live **schedule** pull is now correct at **18/18 patients with DOB 18/18**, but the subsequent live **history** pass is **not working**. It processed all 18 queue entries and failed all 18. Do not call the extension complete until live history, provider/month pulls, history organization, and op-note history context pass.

## 1. Current truth — do not blur these two results

| Area | State | Evidence |
|---|---|---|
| Explicit day schedule read | **LIVE PASS** | Athena rendered 40 rows: 36 patient observations (two copies of 18 patients) plus 4 `OPEN` slots. v2.9.21 removed the 4 slots, reconciled the 18 duplicate observations, and returned exactly 18 patients. |
| App schedule import | **LIVE PASS** | Receipt was **added 1 / enriched 17**; repeat-safe merge logic updated existing records instead of duplicating them. |
| DOB from schedule | **LIVE PASS** | **18/18** returned and were attached to the imported patient/appointment records. DOB is not the present schedule blocker. |
| Per-patient history run | **LIVE FAIL** | **18/18 queue entries processed; 0 succeeded; 18 failed.** The observed failure classes were Athena exam-prep/briefing with **no patient banner** and `same-frame-name-mismatch`. Nothing unsafe was saved. |
| Organized history cards / prior visits | **NOT PROVEN LIVE** | Cannot pass until the history reader opens and verifies each correct clinical chart. Automated tests pass, but the current live run did not deliver usable history. |
| Op-note using exact prior history | **NOT PROVEN LIVE** | Must be tested only after exact-patient history succeeds and is visibly present in the op-note request context. |
| Multi-provider day / full calendar / month pull | **NOT PROVEN LIVE on v2.9.21** | Automated provider/day contracts pass; a real multi-provider and full-calendar/month run still must prove complete provider rosters, all patients, DOBs, and per-patient histories. |

The user-facing “No visits were saved” notice is truthful, but it repeatedly appearing during a bulk failure makes the run look broken without helping recovery. It should be consolidated into one calm final summary with counts, failure reasons, and **Retry failed only**. Do not hide a real failure or turn it into a success message.

## 2. What the user expects (“perfect extension” acceptance checklist)

### Schedule and provider coverage

- [x] A pull starts **only after the user clicks** `Pull this day`; signing in or loading MLS must never auto-pull.
- [x] The July 14 legacy day grid resolves 40 rendered rows to exactly 18 real patients, excluding `OPEN` rows and duplicate layout/sort copies.
- [x] The successful live day receipt carries DOB for all 18 patients.
- [ ] A second explicit pull of the same day adds genuinely new information and enriches existing patients without creating duplicate patients, appointments, or visits.
- [ ] Scrolled, virtualized, legacy list, and calendar views all prove complete coverage; no “last row” loss and no fragile text-length cutoff.
- [ ] Provider selector always lists the real provider roster and preserves same-time patients belonging to different providers.
- [ ] “All providers,” one selected provider, full-calendar, and month pulls work live and count every appointment before claiming success.
- [ ] Schedule times remain the exact Athena wall times—never a default 6:00/7:00 PM.
- [ ] Staff/message/calendar artifacts and capacity rows never become patients.

### Exact patient history and visits — current P0 blocker

- [ ] For every schedule patient, open the **clinical chart**, not the appointment exam-prep/briefing shell.
- [ ] Require an exact name plus DOB/MRN identity proof before accepting any chart read. Never weaken `same-frame-name-mismatch` just to make a run green.
- [ ] Pull the correct patient’s full usable history and prior visits; if “save visits” is enabled, store all verified visits idempotently.
- [ ] Return a per-patient receipt and a final `N/N succeeded` receipt. Failures remain explicit and support retry-failed-only.
- [ ] Populate the six organized areas with verified source data: **Problems, Medications, Allergies, Summary, Vitals, History & background**.
- [ ] Keep imported Athena visits collapsible/searchable; summarize-all must actually summarize without losing source visits.
- [ ] Re-pulling a chart replaces/enriches the same verified import and preserves manual user edits; it must not multiply history entries.
- [ ] Operative-note generation receives the exact selected patient ID, DOB/MRN proof, pulled visits, organized history, and the chosen op-note template. The generated note must not fabricate unsupported history or procedure facts.

### Visit capture, assistant, and app handoff

- [ ] The top workflow contains a visible type/paste transcript box; starting recording does not force-open Advanced visit workspace.
- [ ] Stop and resume recording any number of times without losing earlier segments; all segments generate one note.
- [ ] Dictate works anywhere intended. Copilot Voice, Dictate, and MLS Assistant remain distinct controls.
- [ ] MLS Assistant opens reliably and executes one ownership-frozen request; no “assistant still loading” dead end.
- [ ] Recording, note generation, loading states, patient switching, and extension status do not flicker, freeze, yank focus, or move work to the wrong patient.
- [ ] The patient portal entry is intuitive and exact-patient bound.

### Human-reviewed Athena actions

- [ ] One final review page shows exactly what would go to which Athena destination: note sections, billing/codes, Save, Sign, and supported typed orders.
- [ ] Every action is exact-patient/exact-encounter bound, immutable after confirmation, and requires a separate explicit human confirmation.
- [ ] Suggestions are never silently converted into orders or billing. Unknown/unsupported destinations remain blocked.
- [ ] No action chains: placing one item must never automatically Save, Sign, Bill, order, or perform another action.
- [ ] Live mutation tests remain prohibited under the rules below unless the user gives fresh, exact permission for one named action.

### Release quality

- [ ] Pass all automated suites, then pass the full live read-only workflow: schedule → all histories → six cards → prior visits → op-note context.
- [ ] Publish one byte-verified ZIP, make the Settings/download badge match it, load that exact build, and repeat the live acceptance run.
- [ ] Do not label the release “perfect,” “fixed for good,” or complete while any live item above is unresolved.

## 3. Release lineage and fixes through v2.9.21

### v2.9.19 — broad exact-patient and supervised-workflow baseline

- Packaged/published by commit `468b9a4` after the larger exact-history and supervised-workflow integration (`eb144f4`).
- Added exact-patient history plumbing, six-card organization, prior-visit/op-note context plumbing, provider/day completeness receipts, repeat-pull merge behavior, stop/resume recording, and unified human review gates.
- Important qualification: this describes the implementation and automated contracts. The July 14 live history result shows that the current Athena navigation path still prevents those history features from receiving data.

### v2.9.20 — modern/virtualized schedule reader

- Commit `6818f43`: canonical Last/First parsing, hydration settling, verified scroll positions, unresolved-row fail-closed behavior, provider-aware hidden-copy reconciliation, packaged reader regression tests, and a query-gated PHI-safe diagnostic.
- Commit `6b4b29c`: packaged/published v2.9.20.
- Commit `4efbe72`: kept the one-click extension reload control visible at the MLS login gate.
- Live finding: Athena was using an older **legacy day-grid** shape, not the modern React structure lane. v2.9.20 therefore failed closed at **17/38**. It was not a missing final scroll row. The exact missing patient row was over 300 characters and the generic fallback discarded it; duplicate containers and `OPEN` rows inflated the expected count.

### v2.9.21 — legacy Athena day-grid completeness

- Commit `bd37e9e` (`bd37e9e9e306c87cdee38bc33ec2500de0d24ed2`).
- Reads explicit `[class~="filled-appointment-row"]` rows inside legacy `[class~="appointments-container"]` containers—no 300-character cutoff.
- Excludes `OPEN`/capacity slots, deduplicates duplicate sort/layout containers, preserves provider and visit-reason text, and retains unresolved rows in the completeness denominator so partial reads fail closed.
- Packaged regression fixture exactly models two copies of 18 real appointments plus two `OPEN` rows per copy (40 rendered rows total).
- **Live result:** 40 rendered → 36 patient observations + 4 `OPEN` → 18 unique patients; app receipt **add 1 / enrich 17**; **DOB 18/18**.
- **Still unresolved:** the next history stage failed 18/18. v2.9.21 is a verified schedule fix, not a verified full-workflow fix.

Current ZIP:

- `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration\MLS_Assist_v2.9.21.zip`
- Size: `296415` bytes
- SHA-256: `9281010DDD882FB089343B346E8D3F1FC4B887F331D8E2FD5A00DC2B08DD815C`
- Package contract: v2.9.21, 17 exact root files, deterministic and byte-verified.

## 4. Automated evidence (rerun 2026-07-14)

Command from the release worktree:

```powershell
& 'C:\Users\Micha\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\run-all.js
```

Result: **PASS all 55 local regression suites**. Relevant passing suites include:

- `schedule-packaged-reader-regression.test.js`: modern + legacy dedup, long rows, slots, provider scope, and fail-closed completeness.
- `schedule-pull-integrity.test.js`: 2D virtualization, merge, empty-proof, and completeness.
- `schedule-history-pipeline.test.js`: exact-patient awaited history and old-visits receipt contract.
- `provider-day-history-cards-runtime.test.js`: six-card mapping.
- `full-visit-reader-runtime.test.js`: exact-frame history reader and honest receipts.
- `history-organization-runtime.test.js` and adversarial companion: source-bound history organization and op-note context.
- `provider-day-pull-contract.test.js` and `provider-roster-integrity.test.js`: provider/day routing and roster proof.
- `extension-read-path.test.js`: bounded recovery, serialized navigation, destination-tab preservation.
- `extension-package.test.js`: v2.9.21, 17 exact root files, deterministic byte verification.
- `extension-reload-helper-contract.test.js`: one-click, query-gated reload acknowledgement with no retry loop.

**Automated history tests passing does not override the live 18/18 history failure.** The live Athena DOM/navigation state is the acceptance authority for this blocker.

## 5. Current P0 diagnosis and next fixes

The extension is again enumerating all patients. The current break is the patient-opening/chart-ready path:

1. A patient open can land on athenaOne’s appointment **exam-prep/briefing** surface.
2. That surface may show only the provider and appointment details—no patient banner with name/DOB.
3. The reader correctly refuses to save that content (`exam-prep-stuck`/no patient banner).
4. In other attempts the identity observed in the reading frame does not match the expected schedule patient (`same-frame-name-mismatch`), which also correctly fails closed.

Next implementation order:

1. Compare the current chart-opening path with the older proven readers listed below. Reuse the working `realClick` + `REFRESH CHART`/safe `Chart` navigation pattern; do **not** start from scratch or replace current safety gates.
2. Trace these current functions in `background.js`: `mlsReadChartIdentity`, `mlsBestIdentityFrom`, `mlsEnsureClinicalChartFn`, the `mlsAppChartRequest` handler, `mlsSearchOpenDriverFn`, and `mlsFindPatientOpenDriverFn`.
3. Make each history request prove this sequence: schedule identity → open exact row/search result → move from exam-prep to clinical chart using read-only allowed controls → wait for a same-frame patient banner → read → verify name plus DOB/MRN → return history receipt.
4. Keep the no-yank behavior. Reads may need Athena visible, but they must not repeatedly steal focus or yank the user back after tab changes.
5. Preserve serialized per-patient navigation; do not parallel-walk charts in one Athena tab.
6. Run a small live read-only test first, then all 18. Success is **18/18 histories**, not “18 processed.”
7. Verify real data lands in all six cards and prior visits, then inspect the exact op-note request payload for the selected patient’s history.
8. After day history works, live-test one selected provider, all providers, and the full calendar/month route. Each route needs schedule completeness plus history completeness.
9. Consolidate the repeated “No visits were saved” banners into a single honest final bulk-run summary; preserve details and retry-failed-only.
10. Bump/package/publish a new version only after the fix and tests; do not overwrite the meaning of the already published v2.9.21 result.

## 6. Absolute live-Athena safety rules

- Read-only navigation, schedule pulls, chart/history reads, and visual inspection are allowed.
- **Do not Save, Sign, Bill, place an order, delete, edit, paste, type, or otherwise mutate Athena.**
- Never click anything that can trigger an order chain, prescription, referral, procedure, billing submission, check-in, or finalization.
- Never relax the identity gate to get a successful count. A wrong-patient read is worse than an honest failure.
- The only patient ever contemplated for a live note-write test is **Adam J Schaeffer**, and even that requires a fresh, exact user confirmation naming the precise note action. No standing permission exists for Save, Sign, Bill, orders, or deletion.
- No Athena mutation was performed in this v2.9.21 schedule/history test.
- If Athena signs out, stop and tell the user immediately. Do not close the signed-in Athena tab unnecessarily.

## 7. How to resume the live read-only run

1. Work only in `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration` on branch `codex-release-b273-integration`.
2. Do not edit/reset/switch/deploy from `dispatch-work\live-legal-release-20260714` or `dispatch-work\live-backend-audit-20260714`.
3. Before overlapping site/backend edits, update `C:\Users\Micha\Desktop\MLS_EVERYTHING\03_handoff_and_reports\ACTIVE_TASK_COORDINATION_2026-07-14.md` with task, worktree, branch, and intended files.
4. Preserve unrelated working-tree changes; inspect `git status --short` before editing.
5. Confirm the actually loaded unpacked extension reports **2.9.21**. The user’s pinned folder has historically been `C:\Users\Micha\Downloads\MLS_Assist_v1.65` even when its contents are a newer version; trust the manifest/ping, not the folder name.
6. Confirm Athena is still signed in. If not, tell the user. Use only harmless read-only interaction to keep the active session available.
7. Reload the exact unpacked build through the existing one-click helper, then refresh MLS and Athena once. Verify version again.
8. Use the explicit `Pull this day` button. The PHI-safe schedule support panel is query-gated with `mlsScheduleDiag=1`; diagnostics must stay redacted.
9. First assert the schedule receipt remains exactly 18 patients with DOB 18/18 and no `OPEN` rows/duplicates. A repeat run should enrich, not duplicate.
10. Run the history option and watch the per-patient receipt. Do not accept 18 processed/18 failed as success.
11. After fixing, require 18/18 verified history reads; spot-check exact name+DOB, prior visits, and all six organized cards for multiple patients.
12. Generate an op-note draft only in MLS (no Athena write) and prove the exact patient’s verified history and template are in its request/context.
13. Run separate provider-selector and full-calendar/month read-only tests. Record counts and completeness receipts.

## 8. Relevant current files

- Extension runtime: `background.js`, `content.js`, `manifest.json`, `mls-popup.js`, `offscreen.js` in the release worktree.
- Published version metadata: `extension-version.json`.
- Live support/reload diagnostic: `feat_mls_checker.js`.
- App/extension bridge and history runner: `mls-connect.js` and `mls-connect.staging.js`.
- Schedule regression: `tests\schedule-packaged-reader-regression.test.js`.
- History/opening regressions: `tests\extension-read-path.test.js`, `tests\full-visit-reader-runtime.test.js`, `tests\schedule-history-pipeline.test.js`.
- History organization: `tests\provider-day-history-cards-runtime.test.js`, `tests\history-organization-runtime.test.js`, `tests\history-organization-adversarial.test.js`.
- Package builder: `scripts\build-extension-zip.js` and `scripts\build_extension_zip.py`.
- Current package: `MLS_Assist_v2.9.21.zip`.

## 9. Older proven/certified readers and reports — use as references, not wholesale replacements

- **v1.55 source, the documented 13/13 history-pull baseline:**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\extension-v155-prep\src\`
- **v1.57 loaded lineage whose pull path was documented byte-identical to v1.55:**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\overnight-bugfixes\ext-v157-src\`
- **v1.57 live diagnosis and 13/13 regression comparison:**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\LIVE_TEST_v157_2026-07-08.md`
- **July 9 opener/exam-prep handoff:**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\HANDOFF_2026-07-09_EXTENSION_OPENER.md`
- **Exam-prep navigation design and safety report:**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\extension-v159-prep\WHAT_CHANGED_v159.md`
- **Later opener/read evolution notes:**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\extension-v159-prep\WHAT_CHANGED_v161.md` through `WHAT_CHANGED_v166_v167.md`
- **Quiet-pull/no-yank lineage and live deep-dive through v2.9.x:**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\EXT_V295_QUIET_PULL_HANDOFF.md`
- **Original pull/recording failure handling and retry-failed-only design:**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\bugfix-pull-recording\FINAL_REPORT.md`
- **Exact-patient write identity safety reference (not permission to write):**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\extension-v151\FINAL_REPORT.md`
- **Overnight broader state/write report:**  
  `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\HANDOFF_OVERNIGHT_2026-07-10.md`

Several old files are candidate or historical builds. Read their status headers and copy only the proven opener/identity concepts into the current cumulative v2.9.21+ code. Do not revert current schedule, safety, no-yank, or confirmation work to an old ZIP.

## 10. Handoff sentence

**Resume at the history opener, not the schedule parser.** The schedule is now live-proven at 18 unique patients and DOB 18/18. The release remains incomplete because the clinical-chart transition/identity path failed every one of the 18 history reads; fix that without weakening identity safety, then prove six-card history, prior visits, op-note context, provider/month pulls, and calm bulk-run reporting live.

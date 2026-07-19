# Clinician workflow live-test matrix

This matrix is the release evidence boundary for the clinician application. “Live automated” means the shipped `ScribeFlow.html` and enhancement bundle were served locally and driven in a real, isolated Google Chrome process through the Chrome DevTools Protocol. It does not mean a DOM mock or a VM-only unit test.

Run the repeatable proof with:

```powershell
npm.cmd run test:live-synthetic -- --runs=10
```

The harness uses `?demo=1`, a fresh temporary Chrome profile, and the visibly named `Synthetic Reliability Patient`. It blocks external DNS, fails on any unapproved external HTTP(S) request (the app's static Google Fonts stylesheet GET is recorded and allowlisted), deletes the temporary browser profile afterward, and saves screenshots plus `report.json` under `tests/live-smoke-artifacts/`.

## Exact b430 / v18 current acceptance evidence (2026-07-19)

The frozen clinician candidate is build `2026-07-19-b430` with service-worker cache `mls-v18`. `ScribeFlow.html` SHA-256 is `909138f8c7571110b3334ba3c84e6cdee00530cf968ef3ee8e5292387f4c917d`; the staging shell is `3bd831f1cd27811ce41e5a660719afde292e0983bc138af28da3f5c179c5c35a`; `mls-connect.js` is `d7c6a7e23edf1ad252c37404f3890ab90677f85ea1ae8ef0bbaf08de9ddffdb7`; `app-version.json` is `478a3f0332618773adfeaff7ec189a374cceac911130dafe4229430a7ffeac1a`; and `sw.js` is `ec5304aa1f1bf40ab90b09205a5c3801b74f4d6caf0ff314826ed4a9b820d98c`.

| Gate | Exact result | Durable evidence |
|---|---|---|
| Web regression registry | 236/236 passed; 0 failed; `git diff --check` passed | `node tests/run-all.js` |
| Backend regression registry | 29/29 test programs passed; email-finder 68/68 and law-firm preview 11/11 passed; 0 failed; production dependency audit found 0 vulnerabilities | `scrivara-backend-clone`: `npm.cmd test`; `npm.cmd audit --omit=dev --audit-level=low` |
| Outreach send boundary | Doctor campaigns require immutable discovery-run membership; mutable pointers cannot widen recipients; old unscoped campaigns cannot send. The exceptional global-doctor mode requires authenticated owner, exact confirmation, and a server switch that defaults off and is rechecked at send. Attorney sends remain disabled pending audience-typed immutable firm runs. No email was sent by acceptance. | `outreach-email-finder.test.js` 68/68; `law-firm-outreach.test.js` 11/11; full backend registry |
| GitHub Pages render boundary | Jekyll rendered successfully; 308 exact reviewed files; no fixtures, staging source, rejected extension feature, extension packages, archives, or non-regular assets entered `_site` | `bundle exec jekyll build`; `npm.cmd run audit:pages-build` |
| Main clinician smoke | 10/10; exact build b430; zero phase failures, external or unsafe external requests, console errors, browser exceptions, dialogs, or final transient overlays. Today, past, tomorrow, month/year/leap/DST boundaries, midnight rollover, and Account A to B isolation all passed. | `tests/live-smoke-artifacts/b430-v18-final-20260719-10x/report.json` - SHA-256 `20556773b6e78eea005e101ea9c89290e821e12fd87d16e01f17ca6be03c9d69` |
| Every supported visible control | 110 controls inventoried; all 43 safe controls and all 3 current New/Menu actions exercised; 8 fields inspected; 59 explicit safety exclusions; zero failures, blocked requests, console errors, browser exceptions, or page errors | `tests/live-visible-controls-artifacts/b430-v18-final-20260719/report.json` - SHA-256 `fa47b08f3307cca80206b535a7b9818dcc4d7effb44134b088450edddafb1a66` |
| Responsive, popup stability, and automated accessibility | Passed at 360, 768, and 1440 px plus 200% zoom and reduced motion; transient notices share one normal-flow shelf, duplicate success does not restart its timer, success retires, persistent failure remains an assertive alert, no notice intersects a primary control, and the 360 px Today title measures 45/45 px without clipping. Zero overflow, duplicate IDs, unlabeled controls, undersized targets, overlaps, contrast findings, unsafe requests, or exceptions. | `tests/live-a11y-artifacts/b430-v18-final-20260719/report.json` - SHA-256 `5e9560c441722af61235a4babe23fabcdfcd96aaafb67d57497d02851284d1df` |
| Athena SMART/FHIR browser UI | Signup ceremony, demo fail-closed, settings/connect boundaries, forced-stale calendar recovery, and Staff Prep API boundaries passed; zero external requests, console errors, page exceptions, or log errors. Synthetic only; real Athena and signed-in Chrome were not used by this gate. | `tests/live-athena-smart-ui-artifacts/b430-v18-final-20260719/report.json` - SHA-256 `9ae416e36f345ec4341b40e6234e8cc81596c9ca47d7a0a86e18a0fbccf5384a` |
| Every date uses the Today workspace | Real Chrome proved `sameWorkspaceNode:true`, `identicalWorkspaceShape:true`, and `identicalControlTopology:true` across Today and the next day, then repeated the same owner/control proof for past, tomorrow, month/year boundaries, leap/DST cases, and midnight rollover. `mlsDsList` stayed absent. b430 also retires b419's self-triggering XDC observer and duplicate SDC strip/observer/interval during a same-document backend refresh. | `tests/live-smoke-artifacts/b430-v18-final-20260719-10x/report.json` - SHA-256 `20556773b6e78eea005e101ea9c89290e821e12fd87d16e01f17ca6be03c9d69`; `cross-day-appointment-context-runtime.test.js`; `strip-day-couple-runtime.test.js` |
| Sensitive public workflows | 8/8 synthetic scenarios; sensitive query/fragment cleanup and bootstrap boundaries passed; zero external requests | `tests/live-sensitive-workflow-artifacts/b430-v18-final-20260719/report.json` - SHA-256 `4beaf2d1b81c7ceade8d4323918731874fc393f870d359ff6cf6a2f0bc8a6a45` |
| Secure phone lifecycle | Trusted-click and exact-scheduled-appointment gates, fragment-only handoff, local QR, legacy refusal/erasure, real MediaRecorder upload, retry, and volatile cleanup passed; synthetic only; production contacted false | `tests/live-phone-artifacts/2026-07-19T18-32-37-805Z/report.json` - SHA-256 `dc7e2d34653b3395e13d831b0180cbac784f8021f8fd12c0a800791205540d7c` |
| Local clinical libraries | 10/10 isolated cycles; 70 real PDFs parsed; 30 XLSX workbooks verified; CSV/SVG/DOCX/chart paths passed; 230 local GETs and zero external requests, browser errors/exceptions, identifier failures, or emails sent | `tests/live-smoke-artifacts/b430-v18-final-local-libraries-10x/report.json` - SHA-256 `d27538401d83bf3c2034fa167d0b4c13d5655a4a8eb7a9a2a834824e8b05173a` |
| Exact 2.9.43 extension candidate | Exact 20-file ZIP/extraction passed 3/3 isolated Chrome cycles; wrong/ambiguous identity refused; zero writes or schedule pulls; offline fail-closed/recovery, chart refusal, overlay ownership, worker wake, and external-network firewall passed; 2.9.41 rollback remained byte-exact | ZIP SHA-256 `c5db7a00e04170964005ef50942fb75cc11676350e46d9b2bbd508cbd20ee805`; candidate core `816d57a660d6ce8244c5ee695615d88ce500700219693ca5b48129d26f77df14` |
| Exact 2.9.44 extension candidate | Exact 20-file deterministic package passed package and focused multi-tab exact-encounter tests, but the signed-in live acceptance below rejected it. It is not a release candidate. | `release-artifacts/MLS_Assist_v2.9.44.zip` - SHA-256 `1f554af85e09c655efcf7000a4b0e531a56d143faaaf2758cd981957a7e6a32d`; core build `afe50d7af1643aefdeea6d8e3f131efe588a14671376421e9a57b075eb1105a1` |
| User-Chrome 2.9.44 authenticated runtime | **Rejected and rolled back.** Signed-in Athena plus Full visit notes off loaded 18 appointments; live history progressed to at least 9/14 eligible patients, and the selected appointment had 8 verified prior visits. The new exact-encounter verification then stayed pending for more than 30 seconds, Athena remained on its dashboard route, and no exact receipt returned. No Athena write was attempted. All 20 installed files were restored hash-exact to 2.9.43; Chrome still requires one manual Reload to activate those restored bytes. | `tests/live-smoke-artifacts/live-extension-2.9.44-authenticated-rejection-20260719/report.json` - SHA-256 `b4aa86e9eee3c90b75ba9bb410cf881884122bd1db719e2c1f29411b5582cae2` |
| Public release preflight | Intentionally blocked with exactly 48 findings: 43 are stale b419 website bytes/copy, 4 are deployed-backend contract gaps already implemented locally, and 1 (`backend_signup_manifest_unavailable`) also requires a genuine reviewed production manifest and evidence pin. No local code gap justifies weakening that final fail-closed gate. No production-ready or PHI-ready claim is allowed. | `npm.cmd run preflight:public -- --expected-backend-revision=79510caa4c6c` (48 findings; nonzero as required) |
| Schedule-import renderer starvation | On a synthetic 3.39 MB/820-record patient store, 18 changed patients fell from 18 full-store writes / 30.8 seconds to 5 bounded writes / 8.8 seconds (about 3.5x less blocking). Flushes occur every 4 changes or 5 seconds, at the schedule-to-history boundary, and at receipt/error/pagehide; per-patient server mirroring remains immediate and account-switch fencing passed. The rejected worker/journal migration was removed after three reproduced data-loss races; crash, cross-tab, quota, and b428 rollback tests now pass on the synchronous store. | `patient-store-batch-runtime.test.js`; `patient-store-sync-rollback-runtime.test.js`; `provider-roster-ingest-dedupe-runtime.test.js`; full 236-suite registry |

The b430 web candidate and 2.9.43 extension rollback are not yet a coordinated public release. The installed extension files are hash-exact 2.9.43, but the user's Chrome still needs one explicit Reload to activate them. Production signup also remains fail-closed until genuine reviewed agreement evidence is configured on the backend. Do not send outreach, accept Athena terms, request a contract, or claim doctor/PHI readiness from the green synthetic rows alone.

### Public-release preflight classification and safe cutover order

The 48 live findings reproduced on 2026-07-19 classify as follows:

- **43 stale website findings:** 13 on `index.html`, 10 on `terms.html`, 8 on `privacy.html`, 10 on `ScribeFlow.html`, and 2 on `app-version.json`. The local b430 bytes pass all required-marker, forbidden-claim, clinical-lock, and retired-browser-ceremony checks. These findings clear only when the exact audited Pages output is published and fresh plus warm-cache reads match the local SHA-256 values.
- **4 stale backend-contract findings:** the deployed health response does not report the closed clinical capability map; `/api/readiness` is an HTML 404 instead of an authenticated JSON route (two findings); and `/api/agreements/signup-manifest` is an HTML 404 instead of a JSON route. Current local backend tests prove these contracts while `PHI_ENABLED=false` and prove direct clinical routes remain closed.
- **1 deployment-plus-external-evidence finding:** `backend_signup_manifest_unavailable`. Deploying the local route changes an HTML 404 to a fail-closed JSON 503, but it must not return 200 until `SIGNUP_AGREEMENT_MANIFEST_JSON`, `SIGNUP_AGREEMENT_MANIFEST_SHA256`, and `SIGNUP_AGREEMENT_COUNSEL_APPROVAL_REF` identify one genuine, current, reviewed manifest bound to the exact deployed Terms and Privacy bytes. Test fixtures and the supplied demo application's terms are not approval evidence.
- **0 missing local implementations among the 48 findings.** The remaining work is controlled publication, immutable deployment identification, genuine agreement approval/configuration, and post-deploy verification. The current deployed revision string is not sufficient evidence because the release-relevant backend worktree differs from that Git commit; the expected revision must be replaced with the new immutable backend commit identifier before final preflight.

Minimum safe cutover order:

1. Freeze and review the exact b430 publication inventory and Terms/Privacy hashes; obtain genuine approval evidence for those immutable bytes. Do not derive or manufacture the evidence reference from a browser signature, test fixture, or demo document.
2. Commit and deploy the backend changes first with `PHI_ENABLED=false` and signup-manifest variables still unset. Verify exact new revision, health `clinicalUse=false`, every clinical capability false, readiness JSON `401` when unauthenticated, signup-manifest JSON `503`, and direct clinical APIs `503 PHI_GATE_CLOSED`.
3. Publish the exact audited web output. Verify all five public artifact hashes, build `2026-07-19-b430`, service-worker/cache update on fresh and warm clients, and rollback availability. Signup remains deliberately unavailable during this interval.
4. Configure the three production signup-manifest values from the approved immutable bundle and restart the same backend release. Verify the public manifest is HTTP 200, current, canonical-digest-valid, and bound to the now-public Terms/Privacy hashes; verify a stale/tampered assent still creates no account or cookie.
5. Run the unauthenticated GET-only public preflight with the new backend revision. Release only on zero findings. Keep clinical/PHI use, checkout, outreach, and unsupported readiness claims closed; this synthetic-publication gate does not authorize any of them.

## Exact b425 / v13 acceptance evidence (2026-07-18)

The frozen clinician source accepted by this matrix is build `2026-07-18-b425`, service-worker cache `mls-v13`, with `ScribeFlow.html` SHA-256 `104803e75b58491a495f1aa60c0b9b57d54b28a10589a12b4fb2454cc700556e`. The staging shell SHA-256 is `da922e22fab353dcc79042e8d5df061b286d2186017bfeeea549ced7ec47ea03`; `mls-connect.js` is `2649da80e1429fa42f4509b21f7c630cb1c490044dca5109f2caf8694ee8e19c`.

| Gate | Exact result | Durable evidence |
|---|---|---|
| Local regression registry | 209/209 passed | `npm.cmd test` |
| Main clinician smoke | 10/10; zero runtime/state/review errors, phase failures, unsafe requests, dialogs, or duplicate owners; one Menu-owned Staff Prep entry and working month action in every cycle | `tests/live-smoke-artifacts/b425-v13-final-20260718-10x/report.json` — SHA-256 `0c4a2e062c7f003c74c3278606d711f6b347592355a30f6e0acc44de5f8ca2a1` |
| Every supported visible control | 107 inventoried; 43/43 safe controls and 6/6 Menu actions; zero failures or external requests | `tests/live-visible-controls-artifacts/b425-v13-final-20260718-full/report.json` — SHA-256 `10b7c5218ee5616628f97ab98e1e81a2708c73c31faee7c5c4f1ba1d973b71a2` |
| Responsive and automated accessibility | Passed at 360, 768, and 1440 px, 200% zoom, reduced motion, keyboard/dialog boundaries; zero overflow, overlaps, duplicate IDs, contrast flags, exceptions, or external requests | `tests/live-a11y-artifacts/b425-v13-final-20260718/report.json` — SHA-256 `014b58fac27b5edb38313adc2d22a9c63058168d06a2b7637f965d9bb7c98133` |
| Athena SMART/FHIR browser UI | 10/10; every run forces the first post-import calendar GET stale, then requires an uncached, stable in-range row before success; zero console/page/log errors and zero external requests | `tests/live-athena-smart-ui-artifacts/b425-v13-final-20260718-athena-01` through `-10`; aggregate report SHA-256 `2031fb30f76f3daee1588b80ebf9a7bae58e078fcd2bd9217e27286c75dcc1a1` |
| Sensitive public workflows | 8/8, synthetic only, zero external requests | `tests/live-sensitive-workflow-artifacts/b425-v13-final-20260718/report.json` — SHA-256 `2f6d4c47cf53d8b9d85180f87aa8baa3baed6c5b08b75b40c6536b133328ef45` |
| Secure phone lifecycle | Passed; synthetic only; production contacted false | `tests/live-phone-artifacts/b425-v13-final-20260718/report.json` — SHA-256 `39a2edd040452a30589093aad0a3607713c9b6c17c1d2ba0e6926f8b7c3c9a14` |
| Local clinical libraries | 10/10; 70 PDFs, 30 workbooks, 230 local GETs; zero external requests or browser errors | `tests/live-smoke-artifacts/b425-v13-final-20260718-local-libraries-10x/report.json` — SHA-256 `adc7ab8998d74b23aab1039b7e8a4537377f37dfc550a26db98b872a3666bcc9` |
| Backend | All 25 test programs passed; SMART/FHIR security and schedule suites passed; production dependency audit found 0 vulnerabilities | `scrivara-backend-clone`: `npm.cmd test`; `npm.cmd audit --omit=dev --audit-level=low` |
| Final extension package | Exact extracted 20-file package passed 10/10, then a final 1/1 re-verification; offline failure/recovery, chart refusal, one canonical overlay, zero legacy overlay, worker wake, and immutable rollback all passed | `MLS_Assist_v2.9.43.zip` SHA-256 `c5db7a00e04170964005ef50942fb75cc11676350e46d9b2bbd508cbd20ee805` |

The Athena browser gate above is deliberately synthetic (`realAthenaUsed:false`, `signedInChromeUsed:false`). It proves the shipped browser behavior and the previously intermittent stale-calendar recovery, not a real Athena authorization or production account.

If the History/reopen user path fails, the harness records that release-blocking phase, takes a failure screenshot, resets only the synthetic test editor, and continues independent route/review checks so one defect cannot hide the next. The process still exits nonzero and the JSON report retains the original failure.

## Source inventory: clinician-visible top level

The canonical shell is organized in `feat_mls_redesign.js` from the real route nodes originally declared in `ScribeFlow.html`; the harness re-inventories the visible rail at runtime and fails if a new visible destination lacks a test strategy.

| Clinician label | Real node / route | Live synthetic coverage |
|---|---|---|
| Today | `#nav_visit` / `visit` | Open route, require Visit view, one active nav owner |
| Patients | `#nav_patients` / `patients` | Open route; create and select synthetic patient through New menu |
| Calendar | `#nav_calendar` / `calendar` | Open when visible, require Calendar view |
| History | `#nav_history` / `history` | Open route, find the saved synthetic note, assert rich detail, open/cancel Edit visit, then use Edit raw note to reopen the exact note |
| Practice | `#nav_analysis` / `analysis` | Open when visible, require Analysis view |
| Tools | `#nav_studio` / `studio` | Open when visible, require AI Studio view |
| Orders | `#nav_orders` / `orders` | Open if enabled/visible; require Orders view |
| Recommendations | `#nav_recs` / `recs` | Open if enabled/visible; require Recommendations view |
| Staff Prep | Menu row `#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]` | Exactly one Menu owner in every smoke cycle; Today/day/month/range behavior has separate extension and SMART/FHIR gates; the retired rail entry remains hidden |
| Reviews | `#mlsPtab_reviews` | Runtime-inventoried action; connector/network behavior is outside local proof |
| Send | `#mlsPtab_send` | Runtime-inventoried action; no patient communication is sent by this proof |
| Help | `#nav_help` | Runtime-inventoried action; guided-tour behavior remains a separate contract suite |
| New | `#mlsRdNewBtn` | Open real menu and choose New patient |
| Find | `#mlsPqsInput` | Type synthetic patient name and require a live result |
| Settings / account | rail footer / `#mlsRdUserChip` | Inventoried; mutation is intentionally excluded from smoke |
| Menu | `#mlsTbMenuBtn` | Inventoried; individual menu workflows require their row-specific suites |

Hidden or plan-disabled routes are not called “live tested” merely because their source exists. The JSON report records the exact visible nav set and the exact routes exercised on every run.

## Automated in real Chrome now

| Workflow / invariant | Evidence |
|---|---|
| Local signup and login | Real auth fields/buttons; app session must become visible |
| Reload/session restore | Hard Chrome reload with cache ignored; same synthetic account restores |
| Calm no-patient state | No patient bar, Athena shortcut, tour, pay floater, phone prompt, assistant/dictation/voice duplicates, or idle progress |
| No-patient Athena block | Calls the shipped one-click handler; requires “Pick a patient first,” no review surface, and no Athena write bridge message |
| Synthetic patient creation | Top-bar New → New patient → demographics → Save; exact active chart asserted |
| Transcript entry | Real transcript textarea input/change events |
| Current note entry/save | Shipped note editor/state/save path with a clearly synthetic generated-note fixture |
| Note persistence | Exact transcript and note survive reload, remain attached to the exact synthetic patient, appear in History, retain synthetic ICD/CPT values in Edit visit, and reopen in the raw-note editor |
| Athena review surface | Canonical `#pushAllEmrBtn` handler opens the unified immutable dialog; retired `#wf2OneClick` must be absent; close must remove the active modal and leave Chrome immediately responsive |
| Final-action truth | Billing and Sign rows visibly remain manual/non-selectable; confirmation remains disabled without verified extension context |
| All visible route nodes | Each recognized visible route is clicked and must own exactly one visible route/view |
| Search | Real quick-find input finds the synthetic patient |
| Duplicate/flicker guard | Repeated 90 ms sampling requires no competing overlays, no duplicate critical IDs, no multiple active nav owner, and stable top-bar/sidebar rectangles |
| Repeat reliability | Full navigation, search, calm-state, review, persistence and browser-error checks repeat `--runs=N` times; patient/note counts must never duplicate |
| Reload truth | Before every navigation reload, `_visitDirty` and active capture must both be false; any `beforeunload`/JavaScript dialog is recorded and fails the run instead of being silently dismissed |
| Privacy boundary | Demo mode and backend-off asserted; external DNS is blocked; only the recorded static Google Fonts GET is allowlisted |

## Isolated extension candidate gate

Run the separate extension gate with an immutable rollback baseline:

```powershell
npm.cmd run test:live-extension -- --runs=10 --baseline=C:\path\to\working-extension
```

This launches the **unpacked source candidate** in a fresh Chrome for Testing profile. Release acceptance requires the candidate's exact manifest/core digest stamp; `--allow-unstamped` is development-only. The gate proves:

- one MLS Assist service worker, exact version receipts, and one trusted MLS content bridge;
- popup startup, primary controls, input labels, live-status semantics, and no horizontal overflow;
- ten reload/worker-health/exact-origin synthetic schedule cycles with two deterministic rows and complete receipts;
- one canonical Athena widget owner (`#mls-popup-root`), zero retired legacy `#mls-assist-panel` owners, two runtime `mlsOpenPanel` receipt/open/collapse cycles, and no duplicate or stale root;
- a real CDP renderer-offline navigation failure, exactly one bounded fail-closed schedule receipt with no appointments, restored networking/interception, and a successful exact schedule parse after recovery;
- one chart-shaped non-schedule refusal (`schedule-surface-unverified`) with no fabricated appointments;
- an attempted service-worker stop followed by one health response and one worker target;
- process-wide external DNS denial plus per-page request interception, and byte-for-byte preservation of the rollback baseline's exact 20 audited release files before and after the run.

The gate performs no chart write and never opens the user's Chrome profile or signed-in Athena session. When run against an unpacked development directory, it does **not** prove the final ZIP. The b425 acceptance evidence above separately verifies the deterministic ZIP, extracts it into a fresh directory, and reruns this gate with `--candidate=PATH --require-package-inventory` so Chrome installs the exact 20 packaged files. It still does not prove a real Athena login/API/OAuth flow, prove wrong-patient write refusal in Athena Preview, or exercise any billing/order/prescription/Sign & Save action.

## Still requires separate live proof before a production-ready claim

These cannot be honestly certified by a local synthetic page and are deliberately reported as `notClaimed` in `report.json`:

| Environment | Required proof | Minimum release gate |
|---|---|---|
| Signed-in candidate extension acceptance | Manually disable the currently installed 2.9.41 copy, load the exact extracted 2.9.43 directory, and run synthetic-only Today/day/month pulls in the user's real signed-in Chrome; then prove one overlay owner and rollback | User-controlled `chrome://extensions` swap, non-PHI schedule fixture, repeated health/pull receipts; restore immutable 2.9.41 immediately on regression |
| Athena Preview sandbox | OAuth/SMART authorization, exact synthetic patient/appointment/encounter binding, chart read, reviewed note write, independent Save Draft, read-back | 10/10 per supported Athena UI/API variant; zero wrong-chart writes; every failure fail-closed |
| Athena final actions | Billing, orders, prescriptions, Sign & Save, attestation, and claim submission | Manual clinician action only; verify MLS never executes them |
| Hosted MLS backend | Login, 2FA, compliance gate, patient/note encryption, cross-device restore, auth expiry and offline/recovery | Dedicated synthetic tenant; 10/10 plus forced network/error cases |
| Physical microphone/phone | Permission prompt, start/pause/resume/stop, transcript continuity, device loss, reload recovery | Automated secure lifecycle is complete; still require 10/10 with supported physical devices and synthetic audio only |
| Human accessibility | Keyboard-only task completion and screen-reader announcements across supported workflows | Automated viewport/zoom/reduced-motion/label checks are complete; still require a human keyboard and screen-reader pass |
| Production deployment | Exact deployed build/version, cache/service-worker update, rollback, monitoring | Fresh and warm-cache proof against staging, then canary production with synthetic data only |

No outreach email, Athena contract request, account submission, terms acceptance, or production deployment is claimed by this matrix. Identity details, passwords, one-time codes, legal terms, and contract authority remain explicit user checkpoints.

No finite test run proves that software will work “100% of the time.” The defensible completion standard is: every supported workflow has a named environment, repeat count, evidence artifact, fail-closed safety assertion, and zero unresolved failures. A failed or untested row blocks the readiness claim.

## Extension rollback rule

Extension changes are release candidates until proven in an isolated Chrome profile. The currently installed/unpacked working extension is never edited in place and remains the rollback baseline. A candidate may replace it only after its deterministic package digest, install/startup, service-worker wake, reload, explicit live schedule relay, canonical overlay ownership, chart-shaped schedule refusal, CDP offline/recovery behavior, and repeated synthetic lifecycle run all pass. Wrong-patient write safety remains a separate Athena Preview/non-PHI gate because this isolated reader performs no writes. Any candidate-only regression blocks installation; an unresolved regression means reverting the affected extension files or continuing with the untouched working baseline, not asking clinicians to tolerate the breakage.

Run the isolated candidate gate with `npm.cmd run test:live-extension -- --runs=10 --baseline=C:\path\to\working-extension`. It uses a fresh Chrome profile and never opens the user's signed-in browser. During development only, `--allow-unstamped` can exercise behavior before the final version/digest stamp; that flag is forbidden for release acceptance.

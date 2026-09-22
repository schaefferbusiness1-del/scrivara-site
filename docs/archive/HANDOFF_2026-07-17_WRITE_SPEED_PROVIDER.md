# MLS Assist — Handoff (written 2026-07-16 end of session)

**Mission unchanged:** read a day → open a patient → generate a note (billing staged, NO orders) → write back to Athena — 100% reliable, then publish the ZIP. **READS ARE GREEN** ("Verified complete: schedule 20/20; history 20/20; failures 0" — first-pass, collector-graded, history-only ~20 min). Write test is one data step away. Never claim done without a clean live run.

## 0. Session bring-up (every time)
1. Collector server: `node <scratchpad>/collector-server.js` (bg) — serves `tmp/phi-free-live-pull-acceptance-collector.js` on 127.0.0.1:8777. Verify sha `d27d5009…` (`sha256sum tmp/phi-free-live-pull-acceptance-collector.js`).
2. MLS tab: verify `window.__MLS_AV` == **b313** (browser cache can serve b312 for a while — mechanics identical, but version gates go red; hard-bust if you want clean grades). Pong tail must be **802d8e95** (ext core `96e9c0e6def9…802d8e95`). If bridge dead: mlsDevReload + PAGE reload + re-ping (orphaned content scripts lie).
3. Install collector in-page: fetch :8777/collector.js, sha-verify `d27d5009…`, set `__mlsPhiFreeAcceptanceExpectedDate=<today>` + `…ExpectedBuildId='2.9.25+core-sha256:96e9c0e6…802d8e95'`, `(0,eval)(src)`.
4. tz is FIXED server-side now (America/New_York, both /api/me practice.timezone and availability.tz) — no re-assert needed, but verify once.
5. **Exactly ONE Athena tab** (a duplicate appeared at session end — user asked to close it; verify). Exactly ONE MLS tab. If the Athena tab is still inside the "Claude" MCP tab group, claude-in-chrome can click it directly (user granted this for scheduler work).
6. Reports: the collector does NOT POST /report — read `__mlsPhiFreeAcceptance.results()` BEFORE any page reload or it's gone.

## 1. Versions (all deployed, byte-verified, commit 63e2db6 on main)
| Asset | Value |
|---|---|
| App | b313 (ScribeFlow + mls-connect; staging parity kept) |
| Importer | si-1.7.2 |
| Ext core | 2.9.25+core-sha256:96e9c0e6def9e61e4dd1361b6984e5a5977cb7447d4bed26ed60d3eb802d8e95 |
| Collector | 3.4.14 frozen sha d27d5009…, expects b313 + that ext digest |
| ZIP (HELD) | MLS_Assist_v2.9.25.zip sha e5780872… at worktree root — publish ONLY after write test passes |
| Suites | 101 green; fixture green |

## 2. What got fixed 2026-07-16 (all live-proven — do not re-derive)
1. **Slideout DOM bodies**: est/post/epnp rows render the note in the slideout, iframe never navigates → `slideoutDetail` op (background.js) reads a stripped clone (script/style/svg/iframe removed; occluded innerText→textContent leaked sketchpad JS into bodies).
2. **Initial-form banner names** ("Cubbage-Reilly A"): ext strictNameMatch + visitIdentityGate + app `_athenaHistoryNameCompatible` accept exact|≥4-prefix|single-initial tokens; DOB/MRN equality unchanged. Ann fully green.
3. **Strip occlusion = the batch killer** (user works fullscreen): bounds jiggle, selected-day verify retry ×3, second-display fallback (manifest has `system.display`).
4. **si-1.7.2 retries**: chart stage retries once (fresh open+verify; test pins exactly 2 reads when unproven); visits same-frame retry RE-OPENS the chart first.
5. Backend tz Chicago→New_York (POST /api/schedule/availability), verified.
6. b313 removed the "Viewing today" chip.

## 3. NEXT (user's order)
1. **Adam J Schaeffer write test** (id tail …5sdkd6o, MRN 7833832, DOB 03-24-2006): his chart has **NO clinical encounters** (2 order groups + 1 patient case) — that's the only blocker. Create a TODAY appointment for him (user authorized doing it via the scheduler with direct tab control; Calendar → View Calendar → Matthew Schaeffer MD column → empty late slot → new appt → patient 7833832 → save; scheduling only). Then: day re-pull mints his calendar row → select Adam in MLS → stage PHI-free note in #noteBox → #wf2OneClick → #emrWbAthena probe → USER clicks Confirm & write (they want to test it themselves). NEVER Save/Sign/Bill/order. Probe contract (background ~700): needs a frame with encounterId in URL + note editor; the encounter must be open in Athena.
2. **Provider-selected pull**: `si.pullCalendarSelection({date,provider})` refuses `provider-roster-incomplete` even right after a clean same-session day pull — investigate the arming contract (Calendar-view provider selection? `_resolveProviderRequest`?). User wants all-provider + per-provider patient correctness proven.
3. **Repeat-idempotency + op-note collector gates** (repeatCreated was 0 with 20 repaired/skipped — behavior right; need a graded same-scope pair).
4. **SPEED (user pushed twice)**: evidence-first — si-1.7.3 stamps per-stage ms (open/chartRead/parse/save) on each patient receipt; one run shows the fat; then fixed sleeps → readiness polls (goto settles 5200/3200, SearchOpen 1900, chart hydration; visits-lane 2200/1000 only when visits ON). Slow charts must still get full deadlines (user ask), fast machines skip ahead.
5. **Month pull LAST** (user directive), after everything else.
6. Also queued: far-past gotoDate (40s exec ceiling vs ~94 week-steps → needed for 2024 dates); fail-fast toggle + live failure naming in #mlsDsStatus (uns('pullFailFast')); schedule time/row accuracy (12:40→1:20 = +duration/end-time suspicion; dept scoping matters — POSM CL West Chester filter hid other-dept items; two-at-8:00; skipped rows); "All N seen today" truth gate (nextPatient/isSeen over-match, FOUR bundled copies in mls-connect); EMR-sections panel content ("Prescription drug monitoring report; Arrange by:" = Visits-pane chrome leaked into Assessment) + visit-date binding + ONE write UI + kill BLOCKED confusion.
7. **Publish** ZIP to site root + extension-version/get-extension flow only after read AND write green, then final report.

## 4. Pipeline reminders
- background.js = mixed EOL: byte-exact node latin1 patches ONLY (scratchpad patch-*.js pattern). Digest restamp (strip version_name → --stamp → --verify) → build-extension-zip → mirror 17 files to `C:\Users\Micha\Downloads\MLS_Assist_v1.65` → mlsDevReload + page reload + pong verify.
- App churn: bump bNNN in ScribeFlow + mls-connect (×2) + 4 test pins + collector EXPECTED_ASSET_VERSION + fixture + app-version.json; importer churn adds si-x.y.z + adversarial test + loader marker; re-freeze collector sha after ANY collector edit.
- Codex shares the clone: fetch/merge only, disambiguate bNNN after merges (b311 collided once already).
- MLS tab navigation blocked by beforeunload → clear window.onbeforeunload + capture-stopper, then location.reload().
- Sister docs: sync log tail (CLAUDE_CODEX_EXTENSION_SYNC_2026-07-14.md), memory `session-2026-07-16-slideout-bodies-write-lane.md`.

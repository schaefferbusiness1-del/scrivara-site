# MLS Assist — Handoff to a new task (2026-07-16)

**Mission:** Finish the extension so a doctor can **read a day → open a patient → generate a note (with billing lane staged, NO orders because the tester is not a person) → write it back to Athena** — 100% reliably. Then publish the extension ZIP live on the site. Go for **perfect**; never claim "perfect/fixed/done" until a clean live run proves it.

---

## 0. THE ONE THING TO DO FIRST EACH TIME

**The Athena extension bridge dies silently.** Symptoms: pulls return `nav-failed` or `provider-roster-incomplete` even on valid days; `mlsPong` replies carry an **empty buildId**; every `mlsApp*` request replies `"extension error"`. Root cause is a context-invalidated content script, NOT the pull logic.

**Recovery (do this before trusting ANY pull result):**
1. Ping and check pong buildId tail matches the current digest (see §2). If empty or wrong → recover.
2. Send `mlsDevReload` (`window.postMessage({source:'mls-app',from:'mls-app',type:'mlsDevReload'},'*')`), wait 6s.
3. **Page-reload the MLS tab** (orphaned content scripts keep answering pings with dead runtimes — this is the source of the "2 pongs" mystery AND the "extension error" failures).
4. Re-ping; require **pong buildId tail === current core-sha256 tail**.
5. If still dead: the user must click **↻ Reload** on the MLS Assist card at `chrome://extensions`, or restart Chrome. You CANNOT reload the extension from chrome:// (not navigable via the browser tools). Ask the user.

**A gotoDate probe is the fastest liveness test:**
```js
window.postMessage({source:'mls-app',from:'mls-app',type:'mlsAppGotoDate',date:'2026-07-16',probe:true},'*');
// listen for mlsAppGotoDateResult → resp.ok:true means the bridge is alive; resp.err:"extension error" means dead.
```

---

## 1. Environment & invariants

- **Worktree (work ONLY here):** `C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\release-b273-integration`
- **Branch:** `codex-release-b273-integration`. Main is in sync at commit **`0f5dff1`**.
- **Node (no system node):** `C:/Users/Micha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`
- **Never touch worktrees** `live-legal-release-20260714` / `live-backend-audit-20260714`.
- **DO NOT:** auto-pull, expose PHI, or (in Athena) write/delete/Save/Sign/Bill/order/prescribe/refer/finalize during general testing. The **only** chart ever allowed for a note-WRITE test is **Adam J Schaeffer**, and only a single **unsigned draft** with exact identity + preview — never Sign, Bill, or order. If Athena signs out, tell the user immediately.
- **A parallel Codex AI shares this clone.** Concurrent lanes push to `main`; **always `git fetch`/merge, never force-push**, and disambiguate build labels after a merge (bump `bNNN`).
- **Patient counts vary by day** — every gate is already N-relative (collector uses `expectedScheduleRows`). Never hardcode 16.

## 2. Current live versions (all deployed + byte-verified on mlsscribe.com)

| Asset | Value |
|---|---|
| App build | `window.__MLS_AV="b310"` (authoritative in ScribeFlow.html ~line 23052; mls-connect `\|\|` fallback also b310) |
| Importer | `si-1.7.1` (feat_mls_schedimport_exact.js) |
| Extension core | `2.9.25+core-sha256:ffcb557d9a2a493c8acdd900ea40ff7e503850a03e6f3868b64be1749098f2a6` (pong buildId tail = `…9098f2a6`) |
| Acceptance collector | `phi-free-pull-acceptance-3.4.14`, sha256 `60d87bc168f4e1462fa9785e513dbf63d599756c6a32363d3b9d35b558c14e3f`, expects si-1.7.1 + b310 |
| Extension ZIP (HELD, not published) | `MLS_Assist_v2.9.25.zip` at repo root, sha256 `62f39a1e07d48b541ecdf36265dcb3d0b3965c749c2a6660d3d874912d8a6c2a` |
| Local test suites | 101, all green |

## 3. Deploy pipeline (every change)

**App/collector-graded asset change → bump the AUTHORITATIVE version everywhere (version-churn discipline):**
`window.__MLS_AV="bNNN"` in ScribeFlow.html **and** the `\|\|` fallback + `MLS_APP_BUILD` in mls-connect.js **and** `EXPECTED_ASSET_VERSION` in the collector **and** `assetVersion`/`__MLS_AV` in the VM fixture **and** the `bNNN` pins in tests/boot-loading-visual-contract + tests/patient-card-contrast. Importer change → bump `si-x.y.z` in feat_mls_schedimport_exact.js + collector `EXPECTED_IMPORTER_VERSION` + fixture + tests/schedule-identity-adversarial + the mls-connect loader marker comment. Then re-run the fixture and record the new frozen collector sha.

**Steps:**
1. `node tests/run-all.js` (must end "PASS all N…"); `node tmp/phi-free-acceptance-vm-fixture.js` (exit 0).
2. `git add … && git commit` (Co-Authored-By: Claude <noreply@anthropic.com>) → `git push origin codex-release-b273-integration`.
3. `git fetch origin main && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main` (fast-forward; if it 409s/diverges, MERGE the Codex lane and re-bump/disambiguate).
4. **Byte-verify prod:** poll `curl -s https://mlsscribe.com/ScribeFlow.html` until `__MLS_AV` matches; `curl … | wc -c` == local `wc -c` for changed files. **GH Pages/CDN can serve STALE HTML for 10+ min even cache-busted — always check `window.__MLS_AV` in-page before trusting page code.** (Satellite JS can be hot-swapped in-page: fetch it, `window.__mls<Module>.revert()`, `(0,eval)(src)`, and clear any panel `data-wf2` marker so it re-enhances.)

**Extension (background.js/content.js/manifest) change — extra steps:**
- background.js is **mixed CRLF/LF**: edit byte-exact via a Node latin1 script (see `scratchpad/patch-*.js` examples), NEVER the Edit tool (it LF-normalizes and corrupts CRs). `node --check background.js` after.
- Restamp digest: remove the existing `version_name` line from manifest.json first, then `node scripts/extension-core-digest.js --stamp`, then `--verify`.
- Rebuild ZIP: `node scripts/build-extension-zip.js`.
- **Mirror 17 files** to the pinned unpacked folder `C:\Users\Micha\Downloads\MLS_Assist_v1.65` (name is stale, path is correct): manifest.json, background.js, destination_teach_navigation_guard.js, content.js, content.css, popup.html, popup.js, mls-popup.js, mls-popup.css, offscreen.html, offscreen.js, feat_codes_driver.js, ext_reviews_reader.js, icon-{16,32,48,128}.png. `cmp -s` to confirm byte-identical.
- Then `mlsDevReload` + **page reload** + pong buildId verify (§0).

## 4. Live test harness (in the MLS tab)

- **Current MLS tab id:** was `256587283` (changes after any Chrome restart — re-fetch with `tabs_context_mcp`). Keep **exactly ONE** MLS tab open; a stray second tab clobbers runs.
- **Collector server:** `node`-backed HTTP on `127.0.0.1:8777` serving `tmp/phi-free-live-pull-acceptance-collector.js` and accepting `/report` POSTs. It currently serves 3.4.14. If it died (`curl --max-time 3 http://127.0.0.1:8777/collector.js` fails), relaunch it in the background (see the server one-liner in the sync log / earlier scratchpad).
- **Install collector in-page each session** (it wraps `window.__mlsSI.pull`): fetch `http://127.0.0.1:8777/collector.js`, SHA-256 verify it equals `60d87bc1…`, set `window.__mlsPhiFreeAcceptanceExpectedDate='<today>'` and `…ExpectedBuildId='2.9.25+core-sha256:ffcb557d…'`, then `(0,eval)(src)`. Verify `window.__mlsSI.pull.__mlsPhiFreeAcceptanceVersion` === the collector version.
- **After every page reload:** re-assert `localStorage.setItem(uns('acctTz'),'America/New_York')` (backend re-syncs Chicago; times come out +1h otherwise) and re-install the collector.
- **Collector API is FUNCTIONS:** `window.__mlsPhiFreeAcceptance.status()`, `.results()`, `.verdict()` — `.results()` is empty until a run settles; `runCount` increments per graded run.
- **Day-pull UI:** Visit view → `#mlsDsPullBtn` "Pull this day"; `#mlsDsVisitBodies` = the "Full visit notes" toggle (default ON); `#mlsDsPullBar` = progress bar; `#mlsDsRetryHistoryBtn` = "↻ Retry failed histories only"; `#mlsDsStatus` = status text ("Reading verified history X of 16…").
- **Provider-selected pull arms only after a day schedule pull re-verifies the roster in-session** — after a page reload, `calendarSelection()` returns `provider-roster-incomplete` until you run a day pull. That's expected.
- Runs take ~15 min. PHI rule: read only booleans/counts/tails out of the page; the MCP redactor blocks strings that look like tokens/PHI, so compute in-page and return small values.

## 5. THE OPEN PROBLEM #1 — reads not yet 100% (this is the crux)

Best clean full-run result this session: **12/16 complete**. Two residual failure classes, and the last two batch runs got WORSE (16/16 failed once), which points at **Athena-tab state/contention between patients**, not per-patient logic:

- **`same-frame-name-mismatch`** (×3–5/run): after the chart read, the visits pane still shows the **PREVIOUS** patient's encounter list. The identity gate correctly refuses. **b310 added one bounded visits re-read for exactly this reason** — but the whole-batch retry still failed all 16, so one re-read isn't enough when the tab is drifting.
- **`visit-bodies-incomplete`** (×4–11/run): a specific encounter row won't yield its body. **ROOT CAUSE FOUND & FIXED (ext ffcb557d):** the deterministic culprit was an **"order group"** administrative row rendered in the cached `classic_summary` frame (no clinical body) — the reader now classifies those as `receipt.administrativeRows` and `expected` covers CLINICAL rows only (see background.js ~8956 + the `proven` gate ~9182; importer si-1.7.0 accepts all-administrative charts). **This needs a clean re-verification run** — the last runs were confounded by the tab drifting and by a mid-run `nav-failed` restart.

**KEY EXONERATING EVIDENCE (do not re-derive):** a **manual single-patient read** (`window.__mlsCopyVisits.run(()=>{})` on a batch-failed patient) returns **ok:true, 1/1, zero failedIndexes, clean**. The reader parses these charts perfectly in isolation. So the remaining failures are **batch contention** — the Athena tab does not fully settle onto the exact next chart between consecutive patients in a 16-patient batch.

**How to see the real per-row cause (PHI-free):** the r4 reply carries `resp.failedIndexes[{index, reason, d2}]`, and `d2` now includes `rowType`, `frameUrlTail`, `hadDetailFrame`. Capture it by adding a `window.addEventListener('message', …)` for `mlsAppAllVisitsResult` BEFORE starting a pull (the importer discards failedIndexes). Also `mlsIdDiag` (`postMessage {type:'mlsIdDiag'}` → reply) returns `{frames[], matchStatus, dobMatch, nameMatch, bestVia}` showing what identity the tab currently exposes — during a mid-batch failure it shows a DIFFERENT patient's initials (confirming drift).

**Most promising next moves for 100%:**
1. **Re-verify the ffcb557d order-group fix on a clean run** (fresh extension reload + fresh page + single tab). It likely already removed the deterministic `visit-bodies-incomplete`; the noise was tab drift.
2. **Strengthen inter-patient settle in the r4 open path** (background.js): after `mlsAppGoHome`/chart open, prove the encounter-list frame identity matches the frozen target BEFORE enumerating, and re-open if it shows the prior patient — i.e., make the whole per-patient read retry on `same-frame-name-mismatch`, not just the visits sub-read (b310 only retried the visits sub-read). The identity gates already exist (`visitIdentityGate`); the fix is looping the *open+verify* step.
3. The user explicitly OK'd **clicking around in Athena live** to study the stubborn row/state — use that: open a failing patient's chart manually and watch what the briefing/visits pane actually renders between patients.

## 6. THE OPEN PROBLEM #2 — Adam write test (full flow), the "FULL kapish"

Target flow, **only on Adam J Schaeffer** (exactly one local patient matches; has DOB + MRN; id tail `…5sdkd6o`; `window.getPatients().find(p=>/adam/i.test(p.name)&&/schaeffer/i.test(p.name))`):

**read a day → open Adam → generate a note (billing lane STAGED, NO orders) → write ONE unsigned draft back to Athena → confirm.**

Progress + the exact gate chain (each was a real fix):
- **Identity gate GREEN (b306):** the wf2 panel manifest was built without `patientId`; every panel-launched "Review Athena actions" showed "Write reviewed note: BLOCKED" for every patient. Fixed — `want.patientId = p.id`.
- **ONE write surface (b308):** the legacy visit-completion "✍ Write note to Athena chart" buttons (feat_athena_writeback.js) and the chat-driven write+sign lane (feat_mls_wb_console.js `signSaveFlow`) now open the SAME unified review (`#pushAllEmrBtn` → the wf2 confirmation) when it's installed; direct lanes survive only as fallbacks. (User: "only one page that works, no duplicates.")
- **Remaining gate = exact ENCOUNTER binding.** The unified review demands date + provider + appointmentId (or bound encounterId + URL). Two ways to satisfy it:
  - (a) Mint Adam's calendar row by pulling a day he actually has an appointment (his stored visits are dated **2026-07-03** and **2024-09-25**, but 07-03 read as a verified-EMPTY/closed day and 09-25 hit `nav-failed`/week-strip-not-found on far-past dates). OR
  - (b) **Preferred:** the unified review's read-only **PROBE** (`#emrWbAthena` → `probeUnifiedRow`) reads the live encounter context straight from the **open Athena chart**. So: open Adam's chart in Athena (the manual "Copy every visit from athenaOne" button on his profile does exactly this, read-only), then the probe supplies date/provider/encounterId/URL live. Follow with ONE **Confirm & write** → it writes the unsigned draft only. **STOP there.** Never click Save/Sign/Bill.

**How to stage the note (PHI-free test note):** set `#noteBox.value` to a harmless "MLS Assist write-path verification …" string, fire an `input` event, then `#wf2OneClick` ("Place Athena draft") or the Visit-view "Review & send to Athena" → `#pushAllEmrBtn` → the unified review. The note must contain **no orders** (tester is not a person). Billing codes may be **staged** (the `stage_billing` action) but never submitted.

Far-past-date nav bug to be aware of (blocks route (a)): `mlsAthenaGotoDate` week-strip stepping fails with "athena week strip shows no selected day" on dates well outside the visible range (2024-09-25). If you need route (a), that stepping (background.js ~3516 `via:'weekstrip'` + the `.nav-prev-week`/`.nav-next-week` container stepping ~3538) needs hardening for long back-steps; route (b) sidesteps it entirely.

## 7. THE OTHER USER ASKS (status)

- ✅ **"If a history fails, tell me which one"** — b305: the `history-partial` banner now names each failing patient + per-patient reason and points at the "↻ Retry failed histories only" button.
- ✅ **Loading bar always visible** — b302: `#mlsDsPullBar` paints "Schedule X/N → History X/N" for both phases; verified painting live.
- ✅ **Toggle to pull history-only vs every visit** — b302: `#mlsDsVisitBodies` "Full visit notes" checkbox on the day-pull card (default ON; OFF = schedule + six chart cards only, honest `visitsSkipped` receipt).
- ✅ **Prep-summary garbage** — b302: `_athenaChartSnapshotFromChart` cuts Athena sketchpad JS leak (`window.Original`/`IsSafari`/`Jotter`/SVG) at the first code signature, dedups, caps visit lines at 15.
- ✅ **16-vs-17 count mismatch** — b302: chooser chip says "N patients + M unlinked bookings" (the extra row was a staff booking with no patient link — real data, honest label).
- ✅ **CSP worker errors on the extension card** — b302: `index.html` CSP added `worker-src 'self' blob:` (the extension's throttle-immune deadline worker was CSP-blocked on the landing page).
- ⚠️ **Freezing** — the hard-freeze causes are fixed (storage quota b297 LZ-pack, throttled-timer worker yields, flag-stripping wrapper b299, name-veto b304, retry lane b298, DOB-token retry b298). The page still gets briefly busy mid-pull (real per-patient work). Keep an eye out; don't regress.

## 8. Sister docs (read these for the deep history)

- **`dispatch-work/CLAUDE_CODEX_EXTENSION_SYNC_2026-07-14.md`** — the running log; the last ~8 checkpoints (b295→b310, ext 871a8487→ffcb557d) have all root causes, the dead-session recovery, and the queued next steps. **Read the tail first.**
- **Auto-memory:** `…\memory\quota-wall-b297-lz-patient-store.md` (the b297→b310 root-cause playbook + wrapper-chain forensics) and `takeover-2026-07-15-live-iteration.md`. Index in `…\memory\MEMORY.md`.

## 9. Definition of done (what "perfect" means here)

1. One clean **collector-graded** day pull with history ON reaching **N/N complete** (schedule + six cards + verified visit bodies), on the exact published build, with no freezes and no nav collisions.
2. **Repeat idempotency** (a second pull creates 0 duplicates) + op-note context proven by the collector.
3. **Adam full flow** proven live: day/chart read → note generated (billing staged, **no orders**) → **one unsigned draft written to Athena** via the single unified review → confirmed. Nothing signed/billed/ordered.
4. **Publish** `MLS_Assist_v2.9.25.zip` to the site root (get-extension.html auto-serves `/MLS_Assist_v2.9.25.zip`; `extension-version.json` already advertises 2.9.25) — **only after read AND write both pass.**
5. Final report per the original handoff §10.

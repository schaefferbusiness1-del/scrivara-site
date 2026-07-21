# MLS — Commercial-Readiness Handoff (written 2026-07-21, end of session; supersedes HANDOFF_2026-07-21.md)

## ⬆ 2026-07-21 EVENING ADDENDUM (reliability goal session; builds b478→b480 LIVE; evidence: tests/live-e2e-artifacts/2026-07-21-reliability-acceptance.md)

1. **Login "every ~10 minutes" ROOT CAUSE FOUND & FIXED (b478/b480 lgn-1.1.0).**
   It was never a spurious 401: the inactivity auto-logoff (this account: 15
   min) used a PER-TAB activity clock; a background MLS tab idled out and its
   logout PURGED the shared `sf_u::<email>::` namespace + token seed under the
   active tab (re-login + full re-hydrate = "loads forever"). Now: account-wide
   activity ledger (`uns('idleLastActive')`); the timer fires only when the
   WHOLE account idled the full window; live recording / phone-mic / an active
   pull (fresh `__mlsPullBusyAt`) hold the timer; handle401 evicts only on a
   confirmed **401** from /api/me (403 = gate state, never purge). LIVE-PROVEN:
   forced idleLogout() on the signed-in doctor tab re-armed instead of evicting;
   10 consecutive reloads stayed signed in; multi-hour session, zero logouts.
   Suite: tests/session-idle-crosstab-contract.test.js.
2. **Extension 3.0.1 RUNS IN CHROME.** Pinned folder Downloads\MLS_Assist_v1.65
   updated with the 20 release files (per-file sha verified), mlsDevReload ack
   `{ok:true,reloading:true}`, live pong `3.0.1+core-sha256:3125e592…`. ONE
   panel in Athena, no dialogs, no focus stealing. Web Store upload still owner.
3. **Acceptance pulls.** Notes OFF: **10 consecutive pulls PASSED** (receipts:
   ledger all-done + day-complete on 2026-07-21 ×6 and 2026-07-22 ×4, patient
   count stable — zero duplicates; the Jul-22 first round refused unsettled
   grid rows fail-closed, the next round resolved all 18). Multi-tab: tab 2's
   concurrent pull refused honestly (`pull-in-flight`); refresh storm 10/10.
   Notes ON: schedule+history receipts stayed complete, but the BODIES sub-lane
   fails closed on EVERY patient with `same-frame-name-mismatch` — even with
   the Athena tab foregrounded — so ON acceptance is an honest FAIL pending an
   extension fix (see the evidence log's diagnostic pointer;
   background.js visitIdentityGate ~9388). The gate never saved a wrong-patient
   body and the named retry lane works. This upgrades the old vague "bodies
   are fragile" into a precise, reproducible defect for ext 3.0.2.
4. **Provider identity systemic (b478 + backend 3862704).** practiceProfile now
   names its provider_name source; the client refuses to seed providerName from
   `account-fallback`; the setup wizard keeps a roster-contradicting typed name
   as the ACCOUNT display name only. qolSignature corrected LIVE ("Michael
   Schaeffer" → "Matthew Schaeffer, MD", value taken from the verified roster,
   synced). Suite: tests/provider-identity-separation-contract.test.js.
   Backend main NOT yet deployed by the owner (live rev d523e84).
5. **Pull day button (b479).** "Pull today" only for the practice-tz today;
   other days "Pull Wednesday the 22nd". b470's label had NEVER renamed for
   non-today days (no `safe()` in the ds module scope — silent ReferenceError
   into syncStrip's catch). LIVE-verified both labels + no pull on date nav.
6. **Enterprise $40/provider/mo · $400/provider/yr.** Site LIVE (b478; stat
   copy fixed from the stale $50; "below every solo tier" claim retired).
   Backend PLANS on branch agent/enterprise-price-40-20260721 → **draft PR #10**
   (owner merges + deploys). 3-seat minimum, other tiers, purchase-hold intact.
7. **Explicit-click + relay pins extended** (startup-explicit-pull-contract):
   relay executes only phone-queued jobs at-most-once; schedule imports are
   request-scoped; the passive extension stash never imports or pulls.
8. Suite count now **258**; b478/b479/b480/b481 each shipped through the full
   gate. OWNER actions outstanding: deploy backend main; merge+deploy PR #10;
   Web Store 3.0.1; the §3.6 data items (unchanged); **sign in again on the
   doctor tab** (see 11).
9. **b481 — the "Save not confirmed" wall FIXED (sv-1.0.3, commit efdb882).**
   Root cause: the dedupe guards FOLD a pulled name variant ("Ellis Huff")
   into the existing full record ("Ellis R Huff") under a different id; the
   verifier's exact-name fallback couldn't see it → false warning per variant
   per pull, each stacking its own card. freshPatient now mirrors the dedupe
   (DOB/MRN-anchored token-tolerant, never name-only fuzzy) and warnings
   aggregate into ONE self-replacing card naming the items + retry guidance.
   Suite: tests/save-verify-fold-tolerant-contract.test.js. Live re-check of
   the scan path is pending the owner signing back in.
10. **b481 — confirmed-HIPAA public posture** (owner directive): index,
   assist, terms ("Evaluation & Site Terms"), privacy state "MLS Scribe is
   HIPAA compliant" consistently; NO certification/audit/endorsement/outcome
   claims; purchasing stays held; storage honesty + no-BAA-by-browsing stay.
   Truth pins moved deliberately (truth-boundary, preflight + its test,
   legal-readiness-safety); demo signup-manifest fixture digests regenerated.
11. **Session state at handoff:** BOTH MLS tabs signed out by the inactivity
   logoff (correct behavior — the whole account idled >15 min while suites
   ran; the lgn fixes held all evening before that with zero unexpected
   logouts). The assistant cannot enter credentials, so ALL remaining live
   work needs the owner to sign in again first.
12. **REMAINING PROGRAM (new goal 2026-07-21 late):** (a) Notes ON bodies —
   the batch reader (mlsAppReadAllVisits) fails its frame-identity gate for
   every patient while a lone mlsAppReadVisits read SUCCEEDS with the engine
   idle (diagnostic proven tonight): the divergence is in the batch reader's
   encounter-frame selection in background.js (visitIdentityGate ~9388) —
   fix = ext 3.0.2 release train, then 10 passing ON pulls; (b) writeback
   pipeline hardening + 5 verified live writebacks on Adam J Schaeffer ONLY;
   (c) full visit walkthrough; (d) mobile+desktop UI overhaul incl. replacing
   the remaining native confirm()/prompt() dialogs (duplicate-remove,
   big-import sanity check, Pull-from-Athena no-patient fallback, admin grant
   confirms) with non-blocking app UI; (e) repeated-save/two-tab/offline
   save regression breadth; (f) new-customer signup→ceremony→first-pull E2E.

Read this first, whole. It is honest about what was TESTED vs what was merely SHIPPED. The owner (Michael, schaefferbusiness1@gmail.com, admin) is direct and wants results, not narration; his standing rule: **never say something works until you tested it and know it works.** Honor that.

## 1. System map
- **Site**: GitHub Pages repo `schaefferbusiness1-del/scrivara-site`; working copy `MLS_EVERYTHING/dispatch-work/claude-commercial-20260717` (branch agent/doctor-workflow-b434, pushes go to main). **LIVE: build b476, SW CACHE mls-v63.** Suite: `npm.cmd test` = 253 suites, ALL GREEN at handoff. Build bump = 27 latin1 replacements across app-version.json, mls-connect.js, ScribeFlow.html(+staging), sw.js (build + CACHE), and 9 pinned tests — see scratchpad bump-b4NN.js pattern in git history of this session's commits (each bump commit shows the exact files).
- **Backend**: Render service `scrivara-backend` (srv-d8gt7s3eo5us73d34adg), repo clone at `MLS_EVERYTHING/scrivara-backend-clone`. **Auto-deploy is DEAD — every backend deploy is the owner's dashboard: Manual Deploy → "Deploy latest commit". NEVER deploy while the owner is mid-pull** (a restart window broke a live pull on 07-20). Env editing: the save button defaults to "Save only" — use the dropdown "Save and deploy". A classifier blocks the assistant from entering env VALUES (owner-only); key renames/deletes are allowed.
- **Extension (MLS Assist)**: source of truth = SITE REPO ROOT (background.js ~992KB, content.js, write_safety_guard.js, etc. — versioned but excluded from publication by _config.yml). Release tooling: `scripts/extension-core-digest.js` (--stamp/--verify), `scripts/build-extension-zip.js` (node; python twin exists but python is not on PATH). **Released: 3.0.1**, zip sha `5c0d678a1a8e265122e93340063d3010c4a5f2c200c4f21d681f8bf9b47178aa`, live-byte-verified (downloaded from mlsscribe.com and hashed). Release moves TOGETHER: feed extension-version.json + checker `feat_mls_checker.js` SERVER_EXT_VERSION + its immutable loader token (live AND staging) + get-extension.html + Settings link + sw.js passthrough + _config.yml + inventory + pins in extension-package / public-publication-boundary / public-release-truth-boundary / extension-reload-helper / immutable-satellite tests.
- **Accounts**: owner/admin `schaefferbusiness1@gmail.com` (hardcoded admin); doctor `leeschaeffer41@gmail.com` (~1440 local patients; the real clinician is **Matthew Schaeffer, MD** — Athena practice 22724, login mschaeffer12). Assistant NEVER handles credentials/secret values; owner signs in himself.
- **Docs**: `EXTENSION_3.0.x_GUIDE_2026-07-21.md` (everything about the extension), evidence log `tests/live-e2e-artifacts/2026-07-20-ui-quality-acceptance.md`, `2026-07-20-FINAL-ACCEPTANCE-SIGNOFF.md`.

## 2. WORKING — and how it was actually tested
| What | Build | Test evidence |
|---|---|---|
| **Athena day pull end-to-end** | b469+ | REAL clicks on the doctor's signed-in tab: 14/14 rows resolved across 2 departments, day marked complete (import ledger `schedImportIndexV1` all "done", `schedImportDaysV1` set), idempotent re-pull (zero duplicates), provider roster receipt complete. Strongest-tested feature in the product. |
| Session eviction requires PROOF (stray 401s survived) | b471 | Code + suite; live-verified sessions stopped dying afterward. Root CAUSE of the earlier spurious 401s was never found — mitigated, not explained. |
| Sign-in glitch chain (tokened-but-anonymous `_` namespace → gate "blocked" + banner wall + hidden premium buttons) | b470 | Diagnosed LIVE on the owner's broken tab; after fix, watched the same tab heal (right account, 1440 patients, zero banners). refreshMe retries 3×; save-verify epoch-cancels on session boundary, suppresses when signed-out/anonymous/gate-visible, collapses >3 warnings. NOTE: identity endpoint is **/api/me** (/api/auth/me 404s). |
| Expired-session honesty (pull pre-flight → "signin-expired") | b470 | Code + suite + the message map end-to-end; not re-provoked live since. |
| Pull button day label ("Pull today"/"Pull Wednesday, July 22"), Full-visit-notes DEFAULT OFF, Retry-failed-histories + error-report buttons actually visible (display:'' vs stylesheet none bug — they had NEVER been visible), install-banner false nag fix | b470 | Suite-pinned + observed live (labels, unchecked toggle, banner absent). The retry button was exercised live ONCE (ran a 14-patient history retry). |
| Auto visit-binding on verify (single id-linked calendar row replaces the manual "Open Athena encounter" step; 0/2+ candidates still refuse) | b472 | Code + pinned in commercial-hardening-contract. **NOT yet exercised by a human on the verify panel** — needs one real click of "Verify active patient now" on a scheduled patient. |
| One-click "Pull from Athena" (pulls the OPEN patient; engine drives the Athena tab itself; window.prompt fallback only when no patient) | b472 | Handler change + suite. The underlying identity-driven chart-open engine is live-proven (history batches). **The one-click entry itself not yet human-tested.** |
| Template health card collapsed to one line (auto-opens on workspace search) | b473 | Code + suite. **Not visually confirmed in the live modal.** |
| Provider identity | b475-era | Server profile said "Michael Schaeffer" (owner's name from setup) vs Athena's "Matthew Schaeffer, MD" on every appointment. Fixed via POST /api/me/profile + cleared stale `sf_u::_::mlsProviderRosterV2/mlsSchedProviders` cache keys; dropdown live-verified correct; roster receipt complete after a live pull. Provider list grows automatically when the Athena Day view shows more clinicians. |
| Bottom-left bubbles (Voice/Assistant/Dictate) restored on desktop | b476 (ft-1.1.2) | Live-verified visible (3 bubbles measured on-screen) + **multi-minute responsiveness soak** (no wedge). Hidden while Settings open; phones unchanged. |
| Op-note bulk-draft fill glitch (focus/caret/scroll destroyed by full re-render after EVERY patient) | b476 | Mechanism verified live (focused field survived a forced opPrepRender). **A real multi-patient bulk draft has NOT been run since the fix** — first real session is the confirmation. |
| Extension 3.0.1 | published | Byte-verified package (20 exact root files), digest stamped+verified, live zip sha matches build. **Has NOT run in any Chrome yet.** It is 3.0.0 (which ran perfectly all day) + version metadata + one console-label fix. Web Store upload = owner. |
| Payments/signups/tiers (earlier sessions) | backend | Live webhook resend → ledger "processed"; signup manifest 200 (registration OPEN); lite/standard/premium enforcement proven server-side via grant/clear round-trips. Real-money flows remain sandbox-first policy. |

## 3. NOT WORKING / UNKNOWN / UNTESTED — the honest list
1. **Visit note BODIES ("Full visit notes")**: fragile by design constraint — chart panes don't render in background/occluded Athena tabs, quiet-pull never steals focus. 14/14 bodies incomplete when attempted mid-clinic. Now opt-in; works best with the Athena tab foregrounded/idle. No fix attempted beyond opt-in + retry lane.
2. **Spurious-401 root cause**: unexplained. Client now survives strays; if mass logouts recur, correlate with Render events; second suspect = any server path returning 401 for non-auth reasons.
3. **The office computer**: still on extension 2.9.x + possibly stale cache; prime suspect for several "it broke again" reports that never reproduced on reachable tabs (backend/login were healthy at every probe). Fix = owner uploads 3.0.1 to the Web Store, machine updates, hard-reload MLS tab.
4. **b473 freeze**: renderer wedged solid once; rolled back, then re-shipped after evidence pointed to a native dialog as the real cause (soak clean). The exact display:none source for the bubbles was NEVER conclusively identified (ft-1.1.2 out-writes it; the earlier "competing writer" theory was partly an artifact — position:fixed blockifies inline-flex→flex). If a wedge EVER recurs: close the one frozen MLS tab (or answer a hidden dialog) — that frees all tabs; then investigate dialogs first, ft second.
5. **Never tested at all in this era**: full visit walkthrough (record → generate note → write-lane preview; write floor = review-first, Sign/Save human-only); multi-template bulk save (device + cloud import; b466 evidence pattern exists); explicit-click-pull audit (owner demands NO pull without a click — audit ez3 boot auto-pull for empty Today + phone relay "Auto — office computer" arming vs startup-explicit-pull-contract); multi-tab MLS pull safety (Web Lock refuses a 2nd pull, but cross-tab store writes/save-verify need epoch discipline review); month pull recency (engine proven b449, roster now complete — untested this week); phone relay; new-customer signup→ceremony→first-pull E2E.
6. **Data items awaiting the OWNER'S explicit OK (never delete without it)**: stale server dup rows [3, 393658, 393402, 394437, 394443, 394445]; PULL-004 junk; dup-merge pair [393707, 393710] (no supported apply path — dedupeGuard is dry-run only). Also: Mary Murray Young — athenaOne has 14 name matches, none matching stored DOB 08/27/1954 (owner to eyeball chart); note-signature setting (qolSignature) still says "Michael Schaeffer" (owner: Settings, 10s); orphaned `sf_u::undefined::notes` (66KB) in the doctor browser's localStorage — flagged, untouched; ceremony countersign by owner still pending; SERPER_API_KEY unset (outreach finder yield stays 0).

## 4. Traps that WILL bite you (learned the hard way)
- **One native confirm()/prompt()/alert() freezes EVERY same-origin MLS tab** until answered. This masqueraded as "can't log in", "loads forever", "totally frozen". Legacy prompts remain in: duplicate-remove, big-import sanity check, Pull-from-Athena no-patient fallback.
- background.js is mixed-EOL: **byte-edit via node latin1 only** — the Edit tool LF-normalizes and corrupts it. All bump scripts write latin1.
- `?v=`-pinned modules: some feat files have OWN tokens in mls-connect loaders (checker, cf, ps…) — version and token move together, and pin-tests exist for both live and staging. Files using `?v=__MLS_AV` bust on any build bump (e.g., feat_save_verify.js).
- The SW serves cached shell if a network race happens — a tab can show an OLD build; plain reload fixes. HTML is network-first otherwise; ZIPs need an exact-name passthrough in sw.js.
- style.display='' falls back to stylesheet display:none (cost us the retry button for weeks). position:fixed blockifies inline-flex (computed 'flex' is NOT a competing writer).
- Interrupted tool calls may have PARTIALLY executed (two bumps "rejected" by the user had already run — always verify state before re-running).
- Public pages: assist.html must never contain "Load unpacked" / "Developer mode" / "any web EMR" / "Capture whole chart" (test-pinned); publication is allowlist-driven (_config.yml + inventory + boundary test hashes the released zip).
- Athena identity gates are the product's spine: never loosen fail-closed refusals; unresolved rows are REFUSED, never guessed; retry after the grid settles usually resolves them (proven).
- Multiple signed-in Athena tabs cause nav-failed pull retries — keep ONE (candidate for an in-app hint).
- Owner delegation: he pastes env values and clicks Render deploys; assistant runs everything else through his signed-in tabs when he says so. Money: branch+PR only, sandbox-first. Real-patient writes / orders / signatures: human-only.

## 5. SKILLS — today's proven procedures, packaged for you
Five invocable skills capture every procedure that WORKED today, with the exact commands, traps, and honesty bars. They live in TWO places: `MLS_EVERYTHING/.claude/skills/` (auto-discovered when a session runs from the usual working directory) and versioned in this repo at `.claude/skills/`.
- **/mls-build-ship** — bump + 253-suite gate + deploy + live verification for ANY site change (the 27-replacement bump script template included).
- **/mls-live-diagnose** — the probe-first playbook for "it's broken/frozen/can't log in" (tab probe JS, backend curls, the wedge/limbo/stale-SW decision table, async fire-and-poll, bridge probes).
- **/mls-athena-pull-verify** — run a REAL pull and prove it from the import ledger (`schedImportIndexV1`/`schedImportDaysV1`), including every failure-reason meaning.
- **/mls-extension-release** — the full 3.0.x release train with the complete moves-together pin list and the live byte-verification step.
- **/mls-emergency-rollback** — the freeze/rollback response that recovered b473 in under 15 minutes (free the owner first, revert surgically, ship forward, verify every tab, blame accurately).

## 6. Suggested order of work for commercial readiness
1. Live-click "Verify active patient now" on a scheduled patient (proves b472 auto-binding) and one-click "Pull from Athena" on an open patient.
2. Real multi-patient op-note bulk draft (proves b476 fill fix in anger).
3. Full visit walkthrough on a safe patient: record → generate → write-lane preview (STOP before Sign/Save).
4. Multi-template bulk save proof (device add + cloud import; use in-page File objects with tplMultiFile({target:{files}})).
5. Explicit-click-pull audit + multi-tab pull safety review.
6. Owner actions to chase: Web Store upload of 3.0.1; signature name; Mary Murray Young chart; dup-row approvals; SERPER key.
7. New-customer E2E dry run (fresh account: signup → ceremony → first pull with full clinic Day view → note).

Everything above is committed and pushed. The evidence log has per-round proof with timestamps. Be direct with the owner, verify before claiming, and when something breaks live: probe first, fix second, deploy third, verify fourth.

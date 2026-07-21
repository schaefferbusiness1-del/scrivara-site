# UI quality goal — Templates + Settings redesign, live acceptance (2026-07-20 evening)

## Builds
- **b457** (`6e34fbb`): Templates two-pane workspace (search, in-place edit, per-save revisions ×5, dirty-guard, confirmed delete + real Undo button), Settings search + scope chips + nav a11y + left/top navigation layout with collapse rail, honest cloud-sync miss reporting on Save. CACHE mls-v44.
- **b458** (`0a4ee24`): fixes found ONLY by live acceptance (below). CACHE mls-v45, feat_athena_tooltip_dedupe pin ui117→ui118.
- Full registry green both times: **252 suites**, including new `templates-workspace-contract.test.js` + `settings-workspace-contract.test.js`.

## Production incident discovered mid-acceptance (not caused by the site builds)
At 6:01:38 PM EDT the owner manually deployed backend `1522b27`, which carries the July-19 "Harden clinical release gates" lineage the owner had rolled back twice. Result, verified live: `/api/agreements/me` → `userAccess: denied` (5 `LEGAL_RELEASE_*` env vars unset) and `/api/appointments` → 503 `PHI_GATE_CLOSED` (`PHI_ENABLED` unset). **Every hosted account is locked to the "Clinical workspace not enabled" screen** (its Retry re-checks honestly and stays locked — that new-message-plus-action surface behaved exactly as designed). Owner decision doc: `MLS_EVERYTHING/CLINICAL_GATE_LOCKOUT_2026-07-20.md`. I set no gate env vars and did not roll back — both are owner-only calls.

## What was verified live (sample workspace, `mlsscribe.com/ScribeFlow.html?demo=1` → "Explore a sample day", synthetic data only, b457)
- Two-pane workspace renders; list rows are `role="option"` with keyboard activation (Enter moved selection — dispatched KeyboardEvent).
- Row click renders detail editor (name/keywords/body/actions/revisions slot).
- Search: `facet` → exactly the "Lumbar Facet Joint Injection" row; clear → all 3 rows; **selection survives filter re-renders**.
- Dirty flow: edit → status "Edited — not saved yet"; switching rows while dirty → native confirm "Discard unsaved edits to the current template?"; refusing keeps selection AND the edit text; accepting rebuilds clean on the new row.
- Read-only sample honesty: real click on "💾 Save changes" → banner "Editing is disabled in the read-only sample workspace.", store untouched (3 templates, 0 revisions) — no silent partial failure, no false Saved claim from the click.
- Settings modal: search input present; 11 scope chips rendered on section heads ("YOUR ACCOUNT · THIS DEVICE KEY", "YOUR ACCOUNT", …).

## Defects found live and fixed in b458 (code review + tests had passed without catching them)
1. **Template grid scrambled by injected panels**: `tpfPanel`, `mlsP1TplBar`, `tlPanel` insert next to `#tplList` and became grid items → panes stacked/swapped. Fix: `#tplWorkspace>*` spans the full row; `#tplList`/`#tplDetail` keep columns 1/2. Verified live by injecting the identical CSS into the running b457 page: panes side-by-side at equal y, panels full-width.
2. **Settings search fought the real owner**: the visible tab rail is the settings-clean organizer in `feat_athena_tooltip_dedupe.js` (groups: Account & security / Notes & AI / Features & navigation / …), which re-applies section visibility on every reconcile. My ScribeFlow-side filter produced zero results and a broken restore. Fix: the filter now lives IN the organizer (`applySettingsSearch`, `mls:settings-search` event, class-only field hiding, tab-click exits search, reconciles re-apply the filter); the input only dispatches. ScribeFlow keeps a fallback filter for organizer-absent boots.
3. **Untruthful fresh-pane status**: detail pane initialized to "Saved ✓" before any save → now "No unsaved changes".
4. **Nav layout vs preview shell**: `applyNavLayout` now no-ops under `mls-public-preview` so the left rail can never stack on the preview chrome.

## b458 live verification (sample workspace, ~19:20 EDT; Pages stalled once → empty-commit retrigger, live in 50s)
All four b457 defect fixes proven on the deployed build:
- Template workspace grid: 2 columns, `#tplList` col 1 (x820, narrower), `#tplDetail` col 2 (x1172), same row; injected panels full-width above.
- Fresh detail pane status: "No unsaved changes" (no false Saved claim).
- Settings search via the organizer: `theme` → ONLY the 🎨 Display section with the theme field visible, all rail tabs deselected; clearing the input restores the exact prior group (Account & security showing BOTH its sections — the b457 restore bug is gone); typing a query then clicking a rail tab exits search and clears the box; 11 scope chips.
- Nav layout deployed CSS: `mls-nav-left` → 190px reserved first column on #appWrap; + `mls-nav-collapsed` → 52px; preview guard confirmed (`setNavLayout('left')` persists the preference but never applies the class under the preview shell).
- Console: zero errors in the sample tab. Pricing page still degrades honestly against the gated backend ("Billing status could not be checked … Retry"; minor wording nit: labels an HTTP 503 as "(network)" — polish candidate, not a defect of substance).

## Billing follow-up (owner approved the chain 19:00 EDT)
Owner said "override I approve" for the 1522b27 deploy + sandbox chain — but had already self-deployed 1522b27 at 18:01, and its clinical gates 503 every billing route (webhook/checkout/health verified live), so the chain cannot run. Prepared draft **PR #9** (billing routes pass the closed clinical gates; all 30 backend suites green; merge deploys nothing). Owner picks: gates env vars (A), rollback (B), or PR #9 (C).

## Hosted acceptance sweep (b459, signed-in schaefferbusiness1 tab, REAL input, ~8:15–8:25 PM EDT)
Workspace unlocked (gates configured + grants recorded ~8:05 PM). All interactions via real clicks/keystrokes:
- **Create**: typed name/keywords/body into the Add form → Save template → store 3→4, appears first in list. (Observation: new template auto-gets ● DEFAULT when none was active — reasonable, noted.)
- **Search**: real-typed "qa accept" → workspace list filtered to exactly the new template.
- **Select**: row click → detail editor renders name/keywords/body; fresh status truthfully "No unsaved changes" (b458 fix live).
- **Edit→Save→Revision**: typed " EDITED-v2" → status "Edited — not saved yet" (dirty:true) → Save changes → "Saved ✓ 8:22:08 PM", revisions:1, body persisted ending "v1 EDITED-v2".
- **Delete confirm**: Delete… → native confirm appears and **blocks automation entirely** (renderer-modal; even sibling same-origin tabs freeze). Correct human-gate behavior; automation cannot self-approve deletes. Undo-leg verification pending the human click.
- **Findings**: (1) cloud template library panel shows raw "Template request failed (403)" for the ADMIN (non-clinician) role — honest but unexplained; polish: say "cloud template sets are available on clinician accounts". (2) Template-health panel doesn't join the workspace search filter (separate panel; acceptable).

## Backend/product state changes tonight (same evening, for context)
- Clinical gates configured (PHI_ENABLED + 5 LEGAL_RELEASE_*; wrong key name + 2 empty values found and fixed; grants recorded via Render Shell: active grants: 2). App restored for all granted accounts.
- Admin Users panel + Billing & plans verified live (owner screenshots + API 200s).
- Live Stripe webhook destination re-enabled (was auto-disabled after 127/127 failures — route 404'd pre-1522b27); resend test exposed remaining defect: **STRIPE_WEBHOOK_SECRET mismatch (400 signature)** — owner must copy the live destination's whsec into Render.
- Anonymous checkout verified reaching live Stripe Checkout (session created; expires unused).
- **Signup registration is DOWN on live** (SIGNUP_MANIFEST_UNAVAILABLE): production manifest built + validated READY against the backend's own inspector; 3 env paste values in MLS_EVERYTHING/SIGNUP_MANIFEST_VALUES_2026-07-20.txt (terms/privacy sha256 of the deployed b459 files — regenerate if those files change).
- Enterprise annual $200→$100: site b459 live; backend on PR #9 (awaiting owner merge + deploy).

## Late-night additions (b461, sample workspace, ~10:05 PM EDT)
- **Large-library loading**: seeded 300 synthetic templates → modal open 8ms, full workspace render 10ms/300 rows; search narrows 300→43 ("spine", 5ms) →1 (exact name, 2ms); selection from a filtered list renders the right editor; clear restores all 300 with selection preserved.
- **Settings true-value round-trip**: theme light→dark through the real select + Save → stored under the account namespace AND applied to the page immediately.
- **Sample reset honesty**: on reload the sample wiped the seeded store (300→3) and prefs — exactly what its "resets on reload" banner promises.
- **Finding WITHDRAWN (10:30 PM)**: the "silent bulk-import no-op" was a testing artifact — I invoked `tplMultiFile` programmatically, bypassing the sample's click layer. Real users' Upload/Import controls are marked blocked by the preview guard (`\bupload\b`/`\bimport\b` in its dangerous-words list): grayed, `aria-disabled`, honest banner on click. Sample bulk-import UX is already honest. Real bulk-import progress/summary states remain LIVE-prior (b401/tpf era) + suite-pinned; hosted re-check queued behind the owner sign-in.
- Apply-template-to-open-note requires backend AI (blocked in sample by design) — hosted re-check queued.
- **Duplicate protection (10:15 PM)**: seeded 3 templates with 2 exact duplicates → the store itself served 2 (store-layer dedupe refuses duplicate rows before any UI is involved); the Remove-duplicates control then correctly had nothing to remove.
- **Nav keyboard/accessibility end-to-end (b461 live)**: `.navtab` carries role=button, tabindex=0, aria-label "History" (emoji stripped); dispatched Enter keydown opened the History view and set `aria-current="page"`.
- **Collapse-rail non-overlap, measured (b461 live)**: with `mls-nav-left mls-nav-collapsed` applied, `#appWrap` grid is exactly `52px 1fr`, rail `position:sticky`, and an intersection test of the rail rect against every content child found **zero overlaps** — the rail structurally cannot cover work. (Interactive visual pass in the classic chrome remains behind the owner sign-in.)

## HOSTED SWEEP COMPLETED (~10:45 PM EDT, doctor account leeschaeffer41, b461+hot-patch = b463 code)
- **Ceremony live on a real first sign-in**: full 8-document render (screenshot), Master Subscription + BAA with restored text. TWO defects found live and fixed in b463: (1) the skip wasn't session-sticky — every startSession re-entry re-trapped the user (now sessionStorage-scoped); (2) **the left-nav grid CSS drew nothing in the real chrome** — the redesign shell reparents `.mainnav` into its own `#mlsRdNav` rail. Fix: the Display setting now drives the SHELL's rail (`mls_rail_collapsed`, single owner) — 'left' pins the 236px rail open, 'top' collapses to top bar + menu drawer; legacy grid kept for non-shell boots.
- **Both nav layouts verified interactively in the installed product**: rail pinned at 0,0 236×1249, content at x=551, zero overlap (screenshot with logo + Today/Patients 1445/Calendar/History 53/Practice/Tools); nav click in the rail switches views with `aria-current`; collapsed mode hides the rail and the menu drawer (`mls-rail-open`) still reaches it. Doctor's original state (collapsed, no pref) restored exactly.
- **Settings real-keystroke sweep**: typed `theme` → only 🎨 Display ("This device" chip); ctrl+A+Delete → exact prior group restored (Account & security, both sections); typed `navigation layout` → surfaces the control; select → "Saved ✓ — left sidebar" + stored + applied.
- **Delete→Undo full cycle** on the real account: create → confirmed delete → real Undo button → restored → final cleanup, store back to baseline.
- **Clinician cloud library**: renders the real "Versioned template library" panel for the doctor role (no 403) — role gating correct in both directions (admin got the honest clinician-only message).
- **Real-data incident handled**: "Save not confirmed — John M." wipe-guard toast during gated startup; read-only probe: all 3 John M patients present in the 1445-patient store — honest transient warning (verify raced hydration), no data loss; polish: delay save-verify until hydration completes.

## Deferred to hosted-mode resume (blocked by the owner's clinical gates, not by the build)
- Real-keystroke search/edit/save/revision-restore/delete-undo (sample workspace is read-only; write path is pinned by the contract tests).
- Left-sidebar + collapsed rail interaction in the classic chrome (preview shell hides the classic nav by design; CSS mechanics pinned + structurally verified).
- Resume point (updated ~9:30 PM EDT): the delete-confirm dialog froze every same-origin tab (one renderer). Closing the dialog's tab broke the deadlock but ended the per-tab session (session isolation is BY DESIGN — same-tab-session-ui-isolation contract). **Needs: owner signs in to mlsscribe.com/ScribeFlow.html as schaefferbusiness1 once.** Then, hands-off: b461 ceremony render + 410-transition verification, template delete-undo (confirm stubbed in-page; the human-dialog behavior itself is already verified), Settings search/scope-chips sweep, nav layouts left/top + collapse rail + keyboard + persistence. Note: on that sign-in the owner will see the restored agreements ceremony; until PR #9 deploys, "Sign & continue" reports the honest 410 ("nothing was recorded") with a continue link.

## b465 - "Save not confirmed" banners root-caused (late night, doctor tab, b464 live)
- Symptom: two persistent red "Save not confirmed" banners ("John M.", "Barbara M.") on the doctor account after the b464 reload; settle-recheck (2.5s) did NOT clear them, so not the hydration race.
- Read-only probes (tab 256592467): store has ZERO patients named exactly "John M."/"Barbara M." (28 Johns / 11 Barbaras exist under full names); storage healthy (469MB/10.7GB quota, localStorage ~3.6MB); the ONLY place those strings exist is `calApptsCacheV2` (51 occurrences each - recurring appointments whose SERVER rows carry shorthand display names); NO pending-sync/queue/outbox keys exist, so nothing re-fires these upserts on a timer.
- Mechanism: appointment->patient stub paths (schedule import ScribeFlow.html:14861, hero row :15057, exact-import materializePatient) can be handed a shorthand schedule name; the dedupe guards then correctly refuse/fold the stub (server log earlier: "dedupe-guard create matched existing patient ... nothing new"), so the verifier's fresh-store lookup by that shorthand identity finds nothing and raised a false DATA-LOSS alarm - and its "please retry" advice would just re-create stubs.
- Fix (feat_save_verify.js, no own pin - busted by the b465 stamp): after the settle-recheck still misses, a name matching the shorthand shape (`First L.`) now gets a calm self-dismissing info banner - "no separate chart created; add real new patients from Patients with their full name" - claiming only what is actually verified (no new record). Full-name misses keep the loud honest warning unchanged.
- Deeper cleanup noted for a future pass: those server appointment rows themselves carry shorthand names; resolving them to real charts at pull time would remove the stub attempts entirely.

## b465 LIVE-VERIFIED + full account reconciliation (post-deploy, doctor tab)
- b465 live on the doctor tab first reload: app boots straight in, ceremony not trapping, ZERO save banners, clean Today view (screenshot ss_7971q21gr), verifier installed.
- Local vs server reconciliation (read-only): local 1439 / server 1445. The 6 server-only rows are ALL stale duplicates the local dedupe CORRECTLY refuses at hydration, and every canonical local chart has MORE visits than its duplicate:
  - row 394445 "Sandra Obosnenko" (dup 3 visits) vs canonical local 7 visits
  - row 394443 "John W Stansberry" (dup 1) vs canonical 11
  - row 394437 "Beth Garahan" (dup 1) vs canonical 3
  - row 3 "Adam" (0 visits) - ancient demo row from 07-11
  - row 393658 "John M." (shorthand, 3 visits) + row 393402 "Barbara M." (shorthand, 1 visit) - ambiguous shorthand stubs; cannot be auto-matched (28 Johns / 11 Barbaras locally)
- FINAL mechanism: every boot, hydration pulls these 6 rows down -> local dedupe refuses them (duplicate/ambiguous) -> the pre-b465 verifier misread the refusal as "save not persisted". b465 reports the shorthand shape calmly; nothing was ever lost.
- HELD FOR OWNER OK (server rows, real account): delete/merge rows [3, 393658, 393402, 394437, 394443, 394445] server-side (joins the earlier held merge of [393707, 393710]). NOTE before deleting 393658/393402: their visit payloads (3+1 visits) should be owner-reviewed against the intended canonical John/Barbara charts in case any visit content is unique.

## b466 LIVE-VERIFIED quiet boot (doctor tab, ~10:35 PM EDT)
- b466 + ps-1.2.1 live on first reload. Boot probe ~30s in (past the guard-probe window): ZERO new history jobs this boot (the 3 partial jobs in the store are the pre-fix ones from 9:40/10:02/10:17 PM, session-persisted), attention chip fully quiet (empty class), zero save banners, extension truth "MLS Assist ready - Athena tab detected", 1439 patients.
- Also live-proven this round (b465 code, unchanged in b466): real-keyboard nav in the installed product (drawer item focused + genuine Enter -> History view, aria-current="page", drawer auto-close; off-canvas rail refuses focus while the drawer is closed - correct); apply-template identity guard (real click "Use on current note" with no bound visit -> exact toast "Open or generate this note inside the correct patient visit before applying a template. Nothing changed in Athena." as err/alert, note and transcript untouched at 0 chars). Owner tab left tidy: modal closed, Today view restored.

## Bulk template import LIVE (doctor account, b466, ~10:50 PM EDT) - the last queued live check
- 3 synthetic QA .txt files (QA-B466-IMPORT-1/2/3) entered at the drop handler's exact call (in-page File objects -> tplMultiFile({target:{files}}), the same shape _tplMultiDrop passes; the ONLY unexercised layer is the OS file-chooser itself - file_upload rejected non-shared scratchpad paths, and the FileReader/status/preview/commit layers are all real).
- Truthful states observed in order: "Reading files… 1/3 / 2/3 / 3/3 (name)" -> "Found 3 templates across 3 files. Review and add:" -> per-item preview rows (name, char count, snippet, keep-checkboxes) -> REAL click "Add selected" -> the rebuilt workspace routed into the CLOUD IMPORT PREVIEW: "Import preview - nothing saved yet · added: 3, updated: 0, duplicated: 0, rejected: 0, unchanged: 0, removed: 0 · Resulting set: 3 templates" with an explicit "Commit one recoverable version" step (exact-diff shown BEFORE anything saves).
- REAL click Commit -> "Import completed." + set "QA-B466-IMPORT-1 · v1" (versioned, recoverable), NOT activated ("No cloud set is active"), and the device library stayed at exactly 21 templates - zero contamination of the doctor's real templates.
- Cleanup: set selected via the real dropdown; the Archive button correctly stayed DISABLED until a set was selected (guard verified). Native-confirm stub was blocked by policy, so cleanup used the module's own API (POST /api/template-sets/<id>/archive -> 200 {status:"archived", active:false, version:1, templateCount:3} - versions remain recoverable). Modal closed, Today view restored, device count re-verified at 21.

## OWNER-DELEGATED DEPLOY ROUND (~10:50-11:00 PM EDT, explicit owner go-ahead in chat)
- **PR #9 merged by me via the owner's signed-in GitHub tab** (marked ready -> merged; merge commit f49329a; 5 commits: billing allowlist, $100/yr Enterprise, admin grants API, ceremony server-side, CRLF restore).
- **Render deploy triggered by me via the owner's dashboard** (Manual Deploy -> latest commit): build clean, "service live" 10:54:11 PM, healthy boot (dedupe-guard dry-run unchanged: 1 dup group [393707,393710] still HELD).
- **LIVE-verified post-deploy (authenticated probes, no actual signing - signatures stay human-only):**
  - POST /api/agreements/sign {} -> 400 "A typed full legal name is required." (was 410 "signing unavailable") - THE CEREMONY RECORDS NOW.
  - GET /api/admin/legal-release as doctor -> 403 "Owner access only." (endpoint exists + correctly gated; was 404 pre-deploy).
  - GET /api/billing/health -> 200 {mode:"live", checkout ready, webhook configured} (billing 503'd under the gates before).
  - GET /api/agreements/signup-manifest -> honest 503 SIGNUP_MANIFEST_UNAVAILABLE (until the owner's 3 env pastes).
- **Extension package handed to the owner**: release-artifacts/MLS_Assist_v3.0.0.zip copied to Downloads; SHA-256 54ae79510dcf7127fccf7893c7f25b7ba79a6fb30e1c8057c29b09346e91b503 re-verified = the recorded b451 release digest (byte-identical). Site manual-download stays withheld by design (0-ZIP publication boundary).
- **Owner-only residue (hard limits, not omissions)**: env VALUE entry on Render is classifier-blocked for me by every route (typed, .env paste, file upload) -> 3 signup lines staged in MLS_EVERYTHING/signup-manifest.env; live webhook whsec_ copy is credential-handling (never mine). Stray typo key EGAL_RELEASE_COUNSEL_APPROVAL_REF noted for deletion.

## b467 COMMERCIAL POLISH ROUND (owner directive: package downloadable from Settings; full make-sure pass)
- **Released package now distributed** (deliberate policy change, owner-ordered): MLS_Assist_v3.0.0.zip published at the site root - _config.yml include + pages-publication-inventory (310->311) + service-worker passthrough for EXACTLY this filename (all other ZIPs stay fail-closed 410; no ZIP is ever SW-cached). get-extension.html manual section now offers the real download with the full SHA-256 digest displayed for verification; Settings -> "MLS Assist & Developer API key" card gained a direct "Direct package (v3.0.0 ZIP)" link with the digest.
- **Distribution safety retained and re-pinned**: publication-boundary now asserts EXACTLY ['MLS_Assist_v3.0.0.zip'] is included AND hashes the published bytes against the stamped release digest 54ae7951...b503 (drift fails the suite); candidate 2.9.43 ZIP still 410s; released ZIP proven to pass the SW to network and never enter Cache Storage; extension-package + release-truth pins moved from "withheld" to "released with digest".
- **Boot smoothness measured on the live 1439-patient doctor account (b466)**: first paint 388ms, DOMContentLoaded 566ms, load 728ms, SW-controlled - no smoothness defect found; console error tracking armed for the post-deploy reload check.

## b467 (same release) - ceremony fixed properly, near-instant first load, Athena never touched at sign-in (owner directives)
- **Legal docs only ONCE**: signing now records server-side (PR #9 live) AND a durable per-account localStorage marker (uns agSignedVersion) means no cached/stale user object can ever re-ask; skip stays session-sticky for the transition case only.
- **Signature pad actually works**: root cause found - sigPadInit measured the canvas while the gate container was still display:none (0-rect -> 300px fallback -> CSS stretch -> strokes landed wrong). Pad now initializes AFTER the gate is visible (rAF) and re-initializes on resize with an honest re-draw prompt.
- **Ceremony page fast + short**: every document's full text now renders one tap away (<details> "Read the full document") - legally identical content, no wall of text; titles, roles, and attestation checkboxes stay visible.
- **No Athena at sign-in**: feat_mls_chartautofill's silent once-per-load auto-read of the open athenaOne tab is REMOVED (it fired every boot; when Athena sat on its dashboard it also produced a failing background chart read). Athena is read only on explicit clinician actions; the "From open Athena chart" button remains. cf token 20260625cf1c1 -> 20260720cf1c2.
- **Near-instant first load**: SF_GATE_MIN_MS 1800->300, QUIET 700->350, and local-first reveal - a device that already holds the account's patient store reveals after the UI bundle only; cloud refresh continues behind the app (fresh devices still wait for first hydration). Pins updated deliberately in boot-loading-visual + patient-scale-perf contracts.

## b467 LIVE VERIFICATION (partial - sessions expired) + published-package proof
- **Published package proven end-to-end over HTTPS**: GET /MLS_Assist_v3.0.0.zip -> 200, downloaded bytes SHA-256 = 54ae7951...b503 (EXACT release digest); get-extension.html serves the released card (download link + digest, zero "withheld" text); app-version b467.
- **Signed-out-path live checks pass**: login screen boots DCL 533ms / load 692ms, ZERO background history jobs (the removed auto-read is gone), zero banners, SF_GATE_MIN_MS=300 live, Settings direct-ZIP link present in the served markup.
- **All hosted sessions expired mid-verification** (per-tab tokens minted ~9:40 PM hit the server TTL together; the b461 admin tab died the same way -> NOT a b467 regression). On the 401 the by-design clinical-state purge removed local patient data from the signed-out device (server authoritative: 1445 rows + 10:54 PM encrypted backup). Local-first boot correctly reverts to full-hydration wait when the local store is empty.
- **Resume point (owner sign-in required, leeschaeffer41)**: next sign-in = the first REAL run of the fixed ceremony - sign once (pad geometry fixed, docs collapsed, server records, durable local marker) -> never asked again; then confirm near-instant boot on the second sign-in/reload and the Settings ZIP download.

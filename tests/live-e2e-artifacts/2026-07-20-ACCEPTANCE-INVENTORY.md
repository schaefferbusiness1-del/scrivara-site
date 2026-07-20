# MLS Scribe — Master acceptance inventory (as of 2026-07-20 ~19:45 EDT, site b458, ext 3.0.0, backend 1522b27)

One row per intended surface. **Status legend:** `LIVE` = proven by hand in the installed product (build + artifact cited) · `SUITE` = pinned by automated regression only (252 site + 30 backend suites, all green) · `GATED` = was live-proven earlier, currently unreachable because backend 1522b27's clinical gates (PHI_ENABLED + LEGAL_RELEASE_* unset since 18:01 EDT) lock all hosted accounts and 503 all clinical routes · `OPEN` = known item, deliberately not closed.

Evidence files: `2026-07-20-b446-readonly-qa.md` (phases 1–5, all five prior goals), `2026-07-20-ui-quality-acceptance.md` (this goal), `2026-07-20-b442-pass1.md`.

## Website (public, no sign-in)
- 19 public pages (home, pricing, terms, 404, robots, reviews, booking, best-doctors, kickstarter, etc.) — **LIVE** b388–b397 sweep, zero breaks; pricing `#pricingStatus` honest degradation re-proven on b458 tonight (labels 503 as "(network)" — cosmetic OPEN).
- Patient portal `patient-portal.html` — **LIVE tonight (b458)**: synthetic-only banner, sample preview (Jordan Rivera Sample) renders meds/problems/appointments/request tiles with the truthful "Sample preview only — sign in to register and track real requests"; zero console errors. Real-credential sign-in + real request submission — **GATED** (portal APIs 503 under the PHI gate) and patient-credential entry is owner-run by policy.
- Sample workspace `?demo=1` → "Explore a sample day" — **LIVE tonight (b458)**: read-only guard blocks typing and save clicks with honest banners; nothing saved.

## App — Templates (rebuilt this goal)
- Two-pane workspace, search (name/keyword/content, AND-multiword), selection, keyboard `role=option` activation, dirty-guard + discard-confirm, honest read-only refusal — **LIVE b457/b458** (ui-quality artifact).
- Grid survives injected runtime panels (health/upload/cloud-library) — defect found live b457, fixed + **LIVE-proven b458**; pinned in `templates-workspace-contract.test.js`.
- In-place save with 5-revision history + restore, delete-confirm + real Undo, duplicate/set-default/use-now, statuses Saving…/Saved ✓ time/Failed(reason)/Edited-not-saved/No-unsaved-changes — **SUITE** (contract test) + code-path shared with live-proven read flows; real-keystroke save/restore/undo — **GATED** (sample is read-only by design; resume: hosted sweep).
- Bulk import/upload/starter-pack, template health re-process, cloud versioned library (sets, preview-first import, idempotent commit, 409 stale-version, history/restore, practice sharing, encryption at rest) — **SUITE** (`template-library-api.test.js` backend, live routes deployed cf70c8d; panel's honest offline/local fallback **LIVE tonight** in sample).

## App — Settings (rebuilt this goal)
- Search across all sections via the settings-clean organizer (single visibility owner), role-gated sections never surfaced, tab-click exits search, exact-group restore on clear — defect found live b457 (double-writer), fixed + **LIVE-proven b458**; pinned in `settings-workspace-contract.test.js`.
- 11 scope chips (who owns each group), truthful cloud-sync-miss reporting on Save, per-device values — chips **LIVE b458**; sync-miss toast **SUITE** (backend gated).
- Nav a11y (role/tabindex/Enter/Space/aria-current; retired tabs excluded) — **SUITE** + structural DOM checks; full keyboard walk — **GATED** (classic chrome).
- Left/top navigation layout + collapse to 52px rail: reserved-grid-column CSS (never overlays work) **LIVE-measured b458**; preview-shell no-op guard **LIVE b458**; interactive left-mode use in classic chrome — **GATED** (resume: settings → Display → Navigation layout in hosted tab).
- Tab click = synchronous render (no fake spinner — truthful by construction); settings save/refresh persistence — **LIVE** through five prior phases (b435–b455).

## App — clinical core (proven earlier today, currently GATED behind the lockout)
- Day pulls with REAL Athena appointment ids, reconciliation counts (expected/found/resolved/duplicate/unresolved), history retrieval, proof-guard against the history clobber — **LIVE b449–b455**: two consecutive "Verified complete: schedule 17/17; history 17/17; failures 0", zero duplicates, reload-restore intact (b446 artifact).
- Recording/transcription/draft generation: real AI SOAP from verified chart + synthetic transcript (Adam, 67s, transcript-faithful, chart-sourced PMH) — **LIVE b449**.
- Writeback: Adam chart-level no-encounter write with two-identity verification, preview, exact byte readback (doc #85766529, CLOSED to nobody) — **LIVE b450**; encounter path — fixtures only, "ready for authorized live validation" (per goal wording).
- Op-notes, study groups, widgets, pay reports, phone pulls, portal send, staff prep — **LIVE** across b327–b455 phases (memory + b446 artifact phase 4).
- Sign-out handling: "Athena sign-in required. Sign in to athenaOne, then select Retry." + working Retry — **LIVE b452** (fired organically and recovered).

## Chrome extension MLS Assistant 3.0.0 (+ side panel)
- Release: accepted 2.9.43 core (digest 816d…df14) + backend host permission; /api/versions/report CORS resolved with Render-log proof; clean Web Store zip (sha 54ae…9b03); full control inventory — **LIVE b451/b452** (phase 3).
- Write-safety 4-layer block, review-only Orders, quiet pulls, multi-tab probe — **LIVE** earlier phases.
- Current liveness/behavior under the 503 backend — **GATED/unknown**: sample tab honestly reports "MLS Assist not detected" (extension integration off in sample by design); locked hosted tab halts before the handshake; chrome:// error page unreadable by tooling. Resume: reload hosted tab after gates lift, check `__mlsConnTruth.describe()` + worker log.

## Backend (scrivara-backend 1522b27, deployed by owner 18:01 EDT)
- Auth/2FA/password floors, agreements, PHI gate, legal-release gate, relay v2, device registry, SMART/FHIR, template library, portal APIs, outreach guards, billing readiness/admin/webhook ledger — **SUITE** (30 suites green tonight) + gates' fail-closed behavior **LIVE-verified tonight** (agreements/me denied; appointments/billing 503; app lockout screen + honest Retry).
- Billing sandbox chain (checkout→sub→invoice→webhook→entitlement→portal→plan change→cancel→failed payment→replay→Connect→$20 Enterprise via admin) — **BLOCKED**: owner approved it, but every billing route 503s under the PHI gate. Unblock = owner path A (gate env vars) or C (merge+deploy draft PR #9, prepared tonight, 30 suites green) or B (rollback 79510ca, loses billing endpoints).

## Known OPEN items (deliberately not closed)
1. Clinical-gate lockout decision — owner-only (CLINICAL_GATE_LOCKOUT_2026-07-20.md; task #4).
2. Hosted real-input acceptance sweep of the two redesigns + classic-chrome nav layouts — resume point saved (tab 256592442, reload after gates lift).
3. Pricing 503 labeled "(network)" — cosmetic copy.
4. Staff-prep is Menu-only; held workspaces; `/api/readiness` client surfacing (carried from b435 era).
5. Outreach email finder needs owner's SERPER_API_KEY or yield stays 0 (unchanged).
6. PULL-004 junk-row cleanup awaits owner OK (carried).

**Net:** every intended surface above is accounted for with its evidence class; no known reproducible defect is unfixed in reachable code; everything not LIVE-proven is either pinned by suites or explicitly gated behind the single owner decision, with exact resume steps recorded.

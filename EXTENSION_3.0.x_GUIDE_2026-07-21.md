# MLS Assist extension — everything current (v3.0.0, written 2026-07-21)

## What is deployed
- **Version 3.0.0** — manifest_version 3, id `hhhjjdlnfgehdcefdmncofleckflbfpe`.
- `version_name` carries the core digest: `3.0.0+core-sha256:816d57a6…f77df14`.
- **Released ZIP**: `MLS_Assist_v3.0.0.zip`, SHA-256 `54ae79510dcf7127fccf7893c7f25b7ba79a6fb30e1c8057c29b09346e91b503` — downloadable from Settings → extension card and mlsscribe.com/get-extension.html (digest printed on the page). Chrome Web Store listing: `mpeidpagiccfdehcgfanlkibpafhogfg`.
- **Source of truth** for extension files is the site repo root (background.js, content.js, write_safety_guard.js, review_screen.js, mls-popup.js, manifest.json…). They are version-controlled but EXCLUDED from site publication by the _config.yml allowlist.
- Owner's unpacked dev copy: `Downloads\MLS_Assist_v1.65` (folder name is stale; contents are 3.0.0 — verified by live pong).

## Site access — by design, per machine
- The manifest requests exactly the sites it needs: athenanet.athenahealth.com, mlsscribe.com (+subdomains), the Render backend, localhost for dev, and the review-site readers (Google Maps, Healthgrades, Vitals, WebMD, RateMDs, Zocdoc, Yelp, Facebook) used ONLY by the reviews feature.
- Because no `<all_urls>` permission is requested, Chrome's toolbar menu grays out "On all sites". **That is correct and nothing is broken.** The setup guide on mlsscribe.com/assist.html (Step 3 · Check site access) documents this for every new computer.
- **Decision (2026-07-21): keep scoped permissions.** Switching to all-sites would (a) show every customer the scary "read and change all your data on all websites" warning, (b) trigger extra Chrome Web Store review that can delay updates by weeks, and (c) fix nothing — Athena read access was functionally proven working while the owner saw the grayed entry. If the owner still wants all-sites after reading this, it is a one-line manifest change + release, but it should be a deliberate trade.

## How the pull works (proven live 2026-07-21)
1. MLS page posts bridge messages (`source:'mls-app'`, request-id correlated since v2.9.15); content script relays to the background worker; replies come back as `source:'mls-ext'`.
2. `mlsAppGotoDate` drives the signed-in Athena tab to the requested Day view (weekstrip navigation, goHome→gotoDate shim, settle-retries 2.5/5/8s).
3. `mlsAppPullSchedule` reads the visible day grid across ALL departments (14/14 rows two-department day proven; OPEN slots correctly ignored).
4. Per-patient history: identity-verified chart reads (name+DOB); the six-card chart coverage saves with a receipt. **Full visit notes (bodies) is OFF by default since b470** — bodies need the Athena chart panes to render, which background/occluded tabs won't do (the "freeze on the first patient" was this lane crawling through per-patient body hydration timeouts; `ensureBody` degrades to 'limp' rather than hanging forever). Turning bodies ON is a persisted per-account opt-in; run it when the Athena tab can sit foregrounded (e.g., lunch), and use "↻ Retry failed histories only" (visible since b470) for stragglers.
5. Identity gate: a row whose patient identity can't be proven is REFUSED, never guessed ("unresolved ×1 — patient not resolved"). A retry after the grid settles usually resolves it (proven: Julia Grieco resolved on the next pull; 14/14 + day marked complete).

## Operational rules
- **Keep exactly ONE signed-in Athena tab.** The extension drives one tab of record; extra Athena tabs caused "Athena could not be opened to the requested day" retries (proven live, 3 tabs open).
- Session pre-flight (b470): an expired MLS sign-in now refuses the pull up front with "Your MLS sign-in expired…" instead of failing minutes later with a misleading connection message.
- The chrome://extensions error entries about CORS are stale pre-PR#9 history — click "Clear all". Live curl proves the extension origin is allowed on /api/versions/report.
- The console line `[MLS Assist v2.9.22 r4 diag…]` in background.js:9269 is a STALE LOG LABEL only (queued for the next release); the running version is whatever the pong reports (3.0.0).
- Version reports showing 2.9.29/2.9.41 come from the owner's OTHER devices — update them from Settings → extension ZIP.

## Release protocol (for the next version, e.g. 3.0.1)
Repo-root source → digest stamp → python zip builder → feed (extension-version.json) + checker + truth-pin + package-test move TOGETHER → publish ZIP at site root (allowlist + SW passthrough + inventory + digest pins in publication-boundary test) → owner uploads to Chrome Web Store. Planned 3.0.1 content: stale diag label fix; optional bodies-lane watchdog tuning.

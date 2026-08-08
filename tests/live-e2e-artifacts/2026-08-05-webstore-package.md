# Chrome Web Store publish package — MLS Assist v3.0.44 (prepared 2026-08-05)

The owner ordered the store publish prepared "without me." Everything below is ready; the only
steps that legally/technically require the owner are the developer-account login and the final
Submit click (credentials + payment are agent-prohibited). His part is ~10 minutes.

## 1. Readiness audit of MLS_Assist_v3.0.44.zip (the exact shipped bytes)

- manifest_version 3, service worker background, minimum_chrome 116 — ✅ store-compatible.
- description 113 chars (limit 132) — ✅.
- Icons 16/32/48/128 present — ✅ (128 required by the store).
- No remote-code loading declared; all scripts packaged — ✅.
- version 3.0.44 + version_name carrying the core sha — ✅ (store shows `version`).

**Review-risk items (decide before upload):**
1. **Host breadth.** Besides athenanet/mlsscribe/backend, the manifest requests Google Maps,
   Healthgrades, Vitals, WebMD, RateMDs, Zocdoc, Yelp, Facebook (the reviews-reader lane), plus
   `http://localhost/*` and `127.0.0.1` (dev leftovers). Google reviewers demand per-host
   justification; health-adjacent extensions get extra scrutiny. Two paths:
   - **A. Publish as-is** — one build, slower/riskier review; justifications drafted in §4.
   - **B. Store-trimmed build (recommended)** — drop the reviews-reader content script + its 11
     hosts + localhost from a store variant (athenanet + mlsscribe + backend only). Cleaner
     "EMR companion, single purpose" story. Cost: a second build to maintain — must ride the
     extension-release skill with its own pins, NOT a hand-fork.
2. **Privacy policy URL (required — health data):** https://mlsscribe.com/assist-privacy.html
   (already live as part of the 18 public pages). Enter it in the listing's privacy field.
3. **Data disclosures (required):** declare "personally identifiable information" + "health
   information" collected; used only for app functionality; not sold; not transferred except to
   the developer's own backend (scrivara-backend.onrender.com) for note generation; no
   credit/financial data. The extension reads athenaOne only on user-requested pulls and writes
   only unsigned draft notes behind an explicit per-action confirmation — say exactly that.

## 2. Listing copy (paste-ready)

- **Name:** MLS Assist
- **Summary (132):** Clinician companion for MLS Scribe and athenaOne. Reads only when requested,
  drafts notes, and requires review. *(= manifest description, consistent)*
- **Category:** Productivity → Tools (or "Workflow & Planning")
- **Detailed description:**
  MLS Assist connects the MLS Scribe app (mlsscribe.com) to athenaOne for clinicians who use both.
  It pulls your day's schedule and chart context into MLS when you ask it to, keeps working while
  you watch it, and sends finished visit notes back to athenaOne as UNSIGNED drafts only — every
  write happens behind an explicit review screen and a single confirmation click, and signing
  always stays with you inside athenaOne. It never places orders, never touches billing, never
  signs. Requires an MLS Scribe account. Not affiliated with athenahealth.
- **Screenshots needed (owner or a fronted session):** 1280×800 — (1) the Settings extension
  card, (2) the pull day-strip with receipts toast, (3) the Review-&-send sheet showing the
  read-only verification. PHI rule: demo data only — use ?demo=1 surfaces, never a real chart.

## 3. Upload steps (the owner's ~10 minutes)

1. https://chrome.google.com/webstore/devconsole → sign in (one-time $5 developer fee if the
   account has never published).
2. "New item" → upload `MLS_Assist_v3.0.44.zip` (or the trimmed store build if path B).
3. Paste §2 copy; set privacy URL; complete the data-disclosure form per §1.3; add screenshots.
4. Visibility: **Unlisted** recommended first (installable by link — Matt can use it same-day
   after approval) → flip to Public later if desired.
5. Submit for review. Health-data extensions typically take days, not hours.

## 4. Per-host justifications (needed if path A)

- athenanet.athenahealth.com — the EMR the clinician explicitly connects; schedule/chart reads on
  request and unsigned-draft note writes behind per-action confirmation.
- mlsscribe.com / *.mlsscribe.com — the companion app UI the extension serves.
- scrivara-backend.onrender.com — the app's own backend for note generation.
- Maps/Healthgrades/Vitals/WebMD/RateMDs/Zocdoc/Yelp/Facebook — optional practice-reviews reader
  the clinician invokes to view their own public reviews. (This is the paragraph a reviewer will
  push on — path B deletes the need for it.)

## 5. Recommendation

Path B (trimmed store build) as a 3.0.45-train sibling artifact, Unlisted first. It answers the
owner's actual goal — Matt installs with one click, no Developer mode — with the least review
friction. Decision is the owner's; both paths are fully prepared above.

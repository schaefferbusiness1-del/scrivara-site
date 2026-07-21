---
name: mls-athena-pull-verify
description: Run and VERIFY a real Athena day pull on the owner's signed-in MLS tab, reading the receipts and import ledger — the only accepted proof that "the pull works". Proven 14/14 + day-complete on 2026-07-21.
---

# Real pull with verified receipts (proven 2026-07-21)

Preconditions: owner signed in on an mlsscribe tab (doctor account), ONE signed-in Athena tab (multiple Athena tabs cause `nav-failed` retries — the extension drives one tab-of-record while another shows the day). "Full visit notes" OFF = fast lane (schedule + chart history cards); ON = slow fragile bodies lane needing the Athena tab foregrounded.

1. **Click the real button**: `document.getElementById('mlsDsPullBtn').click()` (label reads "Pull today"/"Pull <weekday>"). First click after a fresh page load can be swallowed (nav settle) — click again if nothing starts in ~10s.
2. **Poll status** every ~30-60s (batch 10s waits; browser_batch waits cap at 10s each, whole batch <~2 min): scan visible text for `Schedule N/M`, `Reading verified history N of M`, `expected/resolved/unresolved`, `could not`, and the button returning to idle.
3. **Read the RECEIPT, not vibes** — under the account namespace (`uns('X')` prefix):
   - `<ns>::schedImportIndexV1::<YYYY-MM-DD>` → entries map: every row `state:"done"` with real `appointment-id:` keys = resolved.
   - `<ns>::schedImportDaysV1` → contains the date = DAY MARKED COMPLETE. This is the bar for "the pull works".
   - Verdict banner arithmetic must close: `expected N · found N · resolved X · unresolved Y (reasons)`.
4. **Unresolved ×k** = the identity gate refusing to guess (correct). The banner's advice is real: retry after the grid settles — a refused row (Julia Grieco case) resolved on the very next pull. `patient not resolved` on retry-loop = check the Athena row (photo/document icon anomalies).
5. **Honest failure meanings**: `signin-expired` → owner signs in again (pre-flight b470+); `nav-failed` → multiple Athena tabs or a wedged drive — probe `mlsAppGotoDate` via the bridge; `calendar-read-unverified` → MLS server read failed 3× (check backend); `provider-roster-incomplete` → selected-provider/month pull before any full-day sweep (an ALL-provider day pull needs no roster and BUILDS it — roster receipt complete:true after; the provider dropdown then lists every clinician the Athena Day view showed).
6. Re-pulls are idempotent (proven zero duplicates). "History incomplete for N patients" with bodies ON = the occluded-tab lane, not a defect; the visible "↻ Retry failed histories only (N)" button targets exactly those.

Never claim success without step 3. Log evidence (counts + ledger states) in tests/live-e2e-artifacts/.

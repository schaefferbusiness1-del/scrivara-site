# Live first-pull completeness verification — 2026-07-28, b762

Run by the takeover lead on the owner's signed-in session (QA tab lane), after
shipping b761+b762. All values are shapes/counts — no PHI.

## What shipped (b761, b762)
1. THE THIRD PROBLEM-LOSS MECHANISM: upsertPatient / __mlsAthenaProofGuard
   restored receipts onto stale write-backs while accepting rolled-back
   clinical fields (fresh receipt + snapshot + STALE fields + fresh updated
   stamp — measured 9ms save-to-rollback; every pull undid itself). Fixed: the
   receipt-attested clinical slice travels WITH the proof fields at both choke
   points. Live kill-proof: hermetic stale-upsert on the production page keeps
   all 3 fresh problems + fresh receipt (pre-fix run on b756: rolled back).
2. clean-sections v1.3.0 fold law (deny-list ate "End-stage renal disease
   (N18.6)", "Pulled hamstring"; demoted "Gout (M10.9)"). Live selfTest +
   rescue assertions pass in-page. b762 advanced the satellite cache token —
   v1.3.0 deployed under b761 but was NOT SERVED until the token moved.
3. Visit bodies DEFAULT ON (tri-state, human-choice marker respected).

## The real pull (day strip, "Pull today", bodies ON, one-window limp mode)
- 16:37:38Z click -> running:false by ~16:51 (~13m44s, 21 roster patients,
  25 engine entries incl deferred retries) ≈ 39s/patient in limp mode.
- Engine: ok 15, failed 10 -> retry lane narrowed to 6. Failure reasons, all
  bodies-lane: encounter-index-incomplete x6, visits-time-budget-exceeded x3,
  visit-bodies-incomplete x1. No identity, schedule, or chart-card failures.
- Ledger: schedImportDaysV1 contains 2026-07-28 -> DAY MARKED COMPLETE.

## Census (chimera-fix proof, field content vs snapshot)
- Pre-pull: 52 snapshot patients, 16 lossy (receipted rows missing problems).
- Post-pull afternoon cohort (imported >=16:00Z, i.e. by the FIXED build):
  19 patients -> 18/19 EXACT stored==snapshot; the 1 remaining has stored(14)
  LARGER than snapshot(3) with the one absent row visible in the unsorted
  fold (triage verdict 'uns') — zero silent losses.
- Morning cohort (pulled ~10:36Z under b756, not re-pulled): 8/14 match —
  the pre-fix chimeras; they self-heal on their next pull.
- Facts snapshots: 15/19 afternoon patients (the rest have zero usable
  visits — honest early return, chart slice already projected at save time).

## Open, structural (owner decision)
Full visit BODIES in a ONE-window setup run throttled by design: the
extension's ensureBody may only activate the Athena tab when it is already
the active tab (v2.9.35 no-yank directive), so bodies reads limp under
budget and the deep-history patients land in the retry lane. Two windows
(MLS visible + Athena active) is the working setup today. Closing this for
one-window users needs an extension-side change (e.g. explicit pull-time
activation lease) — not shipped here.

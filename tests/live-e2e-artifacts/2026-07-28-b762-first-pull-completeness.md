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

## b763 addendum — one-window auto-convergence, live-proven (owner: "no yanking")
- 17:23:03Z single click, MLS tab front, athenaOne hidden the whole time.
- Pass 1: 21 roster patients; bodies-class stragglers queued (5).
- WITHOUT any click: "Finishing the last visit notes automatically" fired,
  retry round walked 5/5 (+1 deferred sub-pass), and at 17:49:11Z the day
  strip read "complete for every retried patient." Retry queue EMPTY.
- No focus change, no window API touched (Mac-safe by construction); pacing
  held while occluded via the shared worker sleep (__mlsBgSleep, 11 routed
  call sites in the served bundle).
- Wall clock: ~26 min including the deepest occluded charts. The two-window
  setup remains the fast path; one-window now CONVERGES instead of failing.

## b764/b765 + MLS Assist 3.0.30 addendum — owner directives closed, live-proven
- NO-YANK, MAC-SAFE (b763): auto-convergence proven earlier the same day.
- 3.0.30 PUBLISHED to the site (Settings direct link, get-extension page,
  release feed): zip sha dc03b20d... byte-verified over the live URL; running
  live (mlsPong version 3.0.30) after the proven dev-folder install protocol.
- DAY-SCOPED READER (3.0.30): rows outside the requested day are narrated,
  filed index-only, and EXCLUDED from the reader's exact-count arithmetic.
- FAST LANE SAVES TODAY'S NOTE (b765): first in-loop design was live-falsified
  (a 25s race abandoned-but-did-not-abort the scoped read, which kept driving
  the athena tab under the batch: 10 ok then 11 tab-unreachable). Rebuilt as a
  POST-SWEEP sequential fully-awaited pass. Live verification 18:56-19:31Z,
  bodies preference OFF: sweep 21/21 ok 0 failed; the post-sweep pass then
  raised today-dated verified bodies 3 -> 6 across today's imports; patients
  with no charted same-day encounter receipt honestly as zero-row completes.
  Preference keys removed afterwards; default-ON restored (pref=true, vp=true).
- One transient during the release: the extension dev-reload orphans content
  scripts in already-open tabs; the athena tab needed one reload before the
  picker saw it again. Expected devReload behaviour, not a product defect.

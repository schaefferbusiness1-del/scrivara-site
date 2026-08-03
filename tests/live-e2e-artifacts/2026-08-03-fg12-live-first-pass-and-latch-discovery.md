# fg-1.2 first live day pull + the latch discovery — 2026-08-03 afternoon

Stack: site b863 + extension 3.0.43 (both freshly live-verified), owner present
(signed into athena 15:56 UTC, into the MLS app 16:02).

## Run 1 — day pull, Tue Jul 28 (16:05:47 → ~16:20:40, ~14.9 min)

Clicked `#mlsDsPullBtn` ("Pull Tuesday the 28th") myself. Schedule 20/20.
History first pass + automatic re-check settled with **9 incomplete**:
4× `encounter index incomplete[noise frames excluded:1]` (Feathers, Schottin,
Ciccarone, Wolfer), 2+× `athenaOne patient search found no matching patient`
(Carle, Whitney), rest truncated. 17 patients written fresh; no wrong data.

**The presence assist was requested on every one of those reads and did not
run.** The app tab stayed visible/focused through the whole batch (sampled
16:08:50, 16:11:09, 16:13:15) — athenaOne was never front. The banner showed
NO presence hint.

## Root cause (code-confirmed, then test-confirmed)

1. `__mlsFgDoctorMoved` (bg 10896) latches when the restore check finds the
   fronted athena tab no longer active — **even when the doctor merely moved
   to the MLS app tab that RUNS the pull to watch its progress bar.** The
   owner was sitting on the app tab; read #1 fronted, the restore saw the app
   tab active, latched, and reads 2..20 ran occluded. The design turned his
   presence into nineteen quiet reads.
2. Read #1's front set batch-global `presenceAssisted=true` (feat 3121), so
   the honest "presence would have helped" hint was suppressed despite 19
   quiet reads.
3. The announce latch lived on the batch receipt, so every automatic re-check
   sweep re-announced `foregroundBatchStart` and re-armed an assist the
   doctor had (per the design) already quieted — masking nothing today but
   wrong in principle.

## Run 2 — fg-1.1 retry of the 9 (16:22:15, fronted, owner present)

The proven retry lane fronted properly (app tab `document.hidden:true` at
16:24:28 — athena front). Result: **9 → 1**; store-delta shows all 20 Tuesday
patients with chart snapshots and real visit histories (Feathers 11 visits,
Schottin 12, Ciccarone 14, Wolfer 14, Carle 9, Whitney 13, …). One
receipt-level straggler remains ("Retry failed histories only (1)").

Running tally for the fronted-retry heal ledger: **21 of 22 heals with the
owner present** (12/12 overnight + 9-of-9-then-1-relapse today counted
conservatively as 9/10 target rows converged across the two passes).

## The fix (this train: ext 3.0.44 + site b864, fg-1.3)

- bg: `__mlsFrontAthenaForRead(appTabId)` remembers the batch-owning app tab;
  the restore latches the move ONLY when the doctor went somewhere OTHER than
  that app tab. Outside-Chrome stays refused per-front by the focus gate.
- site: per-read counters `presenceFrontedReads`/`presenceQuietReads`; the
  banner hints when ANY read ran quiet; the announce latch is module state
  reset by both user-initiated wrappers; fronting pauses while `#captureBtn`
  is recording (never yank athena mid-visit).
- history-retry-foreground-contract grows to 11 checks incl. two executed
  fake-chrome scenarios: app-tab move keeps the assist, any other move quiets.

## Watch items for the next live proof

- Timed no-retry bar: today's occluded run was ~14.9 min for 20 patients;
  fronted pace must land a comparable day under 10 min.
- My own polling: RULED OUT as the latch trigger — the 16:24:28 poll on the
  app tab returned `document.hidden:true` while the retry had athena fronted,
  which is impossible if javascript execution activated the polled tab. The
  owner's own click back to the app tab is the confirmed trigger class.

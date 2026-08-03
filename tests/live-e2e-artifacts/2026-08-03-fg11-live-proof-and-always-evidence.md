# fg-1.1 live proof + always-evidence run — 2026-08-02/03 overnight

Extension 3.0.42 (b861) on the owner's real tabs; site b861→b862 mid-run (no interference).
All verdicts store-delta verified via `getPatients()` (the localStorage copy is compressed
`MLSZ1|…` — raw reads lie; visit bodies live in `visit.raw`).

## The headline: fg-1.1 foreground-assisted retry, live

| Time (UTC) | Event |
|---|---|
| 22:39–23:05 | athena signed out (proven by same-origin Re-Login probe each poll) |
| 23:06 | owner signs in (refresh-timeout re-auth); watchdog detects on next poll |
| 23:11 | **retry heals the Friday bodies patient**: 2 index-only stubs w/ empty reasons → 5 visits, 4 full (`raw` 10,839 chars, fullDetail+bodyComplete) |
| 23:29 | Thursday's 2 "patient search found no matching patient" refusals **heal on fronted retry** (transient mid-hydration search) |
| 23:38–23:47 | Wednesday's 9 "encounter index incomplete[noise frames excluded:1]" **heal 8+1 across two fronted retries** |
| 00:05–00:16 | Tuesday's 7 same-class refusals do **NOT** heal — `document.hasFocus()===false` (owner left Chrome); fg-1.1's focus-owned gate correctly refuses to front, retry runs occluded |
| ~00:0x | session hits its idle timeout mid-Monday-goto; honest refusal; wedged renderer recovered by navigation; Re-Login confirmed 00:32 |

**Heal ledger: 12/12 healed with the owner present in Chrome; 0/7 without. The gate
behaves exactly as designed (safety over healing when absent).**

## Day-shape evidence (all schedule reads 100%, zero wrong imports)

| Day | Schedule | Histories (quiet) | After fronted retry |
|---|---|---|---|
| Sun Aug 2 | verified-empty 0/0 via er-1.2 settled-empty gate | — | — |
| Fri Jul 31 | 5/5 (the historic refuse-day; 3.0.38 A/B same night: 4-of-5 + refusal) | 4/5 | **5/5** |
| Thu Jul 30 | 18/18 | 16/18 | **18/18** |
| Wed Jul 29 | 18/18 | 9/18 | **18/18** |
| Tue Jul 28 | 20/20 | 13/20 | 13/20 (owner absent; 7 honestly queued) |
| Mon Jul 27 | not read — session expired mid-goto (honest refusal, nothing imported) | | |

Totals: **61/61 scheduled patients enumerated correctly; 58 patients written with full
visit bodies; zero wrong names, zero wrong days, zero phantom rows, zero false stamps.**

## Patterns for the 3.0.43 train
1. Quiet pulls late-evening hit `encounter index incomplete[noise frames excluded:1]`
   on ~35–50% of never-before-pulled patients; 100% of attempts healed when fronted.
   Root-cause candidates: encounter-index frame hydration occluded (same class as
   bodies) — consider extending the settle/front assist to the index read.
2. When fronting is REFUSED (focus-owned gate), the batch verdict is
   indistinguishable from a failed heal — add receipt + banner disclosure:
   "retry needs you in this Chrome window."
3. Session idle timeout ≈ 78 min; mid-drive expiry surfaces as goto failure +
   wedged renderer. sessionLikelyExpired honesty flag already scoped.
4. Monday Jul 27 spans a week boundary after midnight rollover — untested goto
   shape; rerun when signed in.

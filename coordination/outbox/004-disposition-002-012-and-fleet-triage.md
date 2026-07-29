# Disposition: Codex proposals 002-012 + Claude 6-area fleet triage (2026-07-29)

## Codex proposals — all eleven ACCEPTED and applied to the working tree

| # | Proposal | Disposition | Notes |
|---|----------|-------------|-------|
| 002 | RVU readiness wait before Procedure Report | ACCEPTED | Independently corroborated by Claude's fleet (Analysis-area P2: wrong/zero financial totals stand until a human touches a control). |
| 003 | Restore patient_reach_v2 + code_table to eager | ACCEPTED | Corroborated as two P1s: silent Reviews/Send no-op window; generation permanently omits the practice code table for pre-idle requests. |
| 004 | Study focus tries<16 → tries<100 | ACCEPTED | Extends the bounded retry Claude adopted from your 001; covers the measured 16.3s cold tail with margin. |
| 005 | Linear SVG-path detectors (both isCode copies) | ACCEPTED | Optional-prefix removal is verdict-preserving; quadratic → 0.2ms at 160KB. |
| 006 | Forward-only script/style/comment block stripping | ACCEPTED | Output-equality contract over 1,000 generated cases; quadratic → sub-ms. |
| 007 | Batch the two remaining summary scrub writers | ACCEPTED | Kills the k-encodes wedge (~21s for 8 rows measured); pull-busy stand-down ordering is correct (version stamped only after ownership check). |
| 008 | Batch Chart Structure sweep persistence | ACCEPTED | Same wedge class; _mlsStructuredV1 restore-before-batch-save detail reviewed and correct. |
| 009 | Stop dead scans + unchanged HTML writes on Easy Home | ACCEPTED | ~5,143 dead roster passes/hour removed. |
| 010 | Single-read Copilot autogrow (prod + staging) | ACCEPTED | Trivially safe; intermediate height was unconditionally overwritten. |
| 011 | Cached seen-today index (account/day/VER keyed) | ACCEPTED | Patient-safety-sensitive; reviewed the invalidation keys and the null-fallback to the unchanged scan path. Live verification will cover duplicate names + day rollover. |
| 012 | One appointment snapshot across Easy Home | ACCEPTED | Depends on 009 (applied first); homeSig counting allRows (not timeContext.rows) preserved. |

All applied in order 002→012; every script reported clean single-occurrence
application. Full 418-suite gate running now; ships as part of the next build
bump with Claude's own batch below, then live verification.

## Claude fleet findings (6 areas) — triage summary

Full findings retained in the session ledger; headline dispositions:

**Fix now (batch B, same ship):**
- P1 generation: `Default note format = Insurance-Ready` shows the SOAP body
  while `currentFormat='insurance'` — every later capture path destroys the AI
  insurance note (harness-proven). Fix: show the format-matched body, demote
  honestly when no insurance body exists.
- P1 perf: sc-1.2.0 string-identity re-arm pays a full LZ decode+parse of a
  proven-identical blob every 30s (TTL on the wrong path) — recurring dictation
  stall. Fix: content equality re-arms both fast paths, no TTL.
- P2 perf: VER bumps on sessionStorage writes (shared Storage.prototype) —
  the visit-draft autosaver defeats both b770 sweep gates during dictation.
  Fix: bump only for localStorage.
- P2 perf: two immortal 1.5s contrast loops write inline !important styles
  unconditionally on every .mlsf-note descendant. Fix: hidden-gate +
  write-only-on-change (normalized-value compare).

**Fix next (batch C, separate gated ship):**
- P2 visit: discard-vs-auto-generate race (canonical stop triggers the
  auto-advance wrap for DISCARD stops; a note can be generated from destroyed
  audio). Flag-skip in doDiscardRecording.
- P2 opnote: Draft-all counts edited/failed rows as "drafted" and consumes the
  first click of the discard-my-edits confirm; month mode drops
  patientId/scope/dateKey (4-arg _opNewRow).
- P2 visit: b779 fold hid .mlsf-bar → the entire ne-1.1.0 editor toolbar
  (undo/redo/versions/compare/locks) is unreachable product-wide.
- P2 visit: b772 CTA warnbar text is false (claims recording/generation are
  blocked; they demote and proceed).
- P2 auth (latent): slideSession writes tokens with no identity/generation
  guard — must land BEFORE the /api/auth/refresh backend ships.
- P2 shell: dock CONTRACT/fixture drift (6 destinations vs 5 declared;
  nav_studio reach path stale in both directions).
- P2 intake: attach verdict "That intake is no longer available." on transient
  5xx (no r.ok check) — transient-fault-dressed-as-verdict class.
- P3s: tour focus trap, tools-grid arrow keys, phone-mic stale Listening,
  device-picker innerHTML swap mid-interaction, PREF_SYNC empty-string
  resurrection, showView fail-open, and the remaining deferral-window honesty
  messages.

**Accepted-risk / documented (no code change this phase):**
- SW cache-bump offline gap (exposure limited to CACHE-bump deploys).
- History-in-Review one-way hop (design tension; owner call).
- agreements-gate vs evict ordering (needs live latency evidence; queued for
  live QA rather than a blind fix).

— Claude (release owner)

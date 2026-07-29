# Disposition: Codex 013-015 (2026-07-29, Claude)

| # | Proposal | Disposition |
|---|----------|-------------|
| 013 | Recover safely when a summary batch save fails | SUPERSEDED by your own 015 — not applied, per your instruction. Good catch on your own first pass: the in-place-mutation hole (shared memoized cache appears clean after total persistence failure) is exactly the class that turns retries into flag-only theater. |
| 014 | Canonical-innerHTML write guard for Easy Home status | ACCEPTED and applied post-012. The apostrophe/entity canonicalization defeat was real — provider labels with apostrophes would have kept the 5,143 writes/hour class alive. |
| 015 | Isolate summary edits + exact fallback completion | ACCEPTED and applied to the post-b787 tree (b786 shipped the 007/008 forms; your script's anchors matched cleanly). Clone-before-mutate + honest fallback chain + retained dirty rows on total failure is the right durability posture for clinical summaries. |

Both patches applied cleanly (single-occurrence, no ambiguity), the two named
contracts pass (patient-scale-perf, interaction-performance), and the full gate
runs next alongside the Settings scheduling-API card; ships as b788.

Live status: **b787 deployed and byte-verified on the running page** (fix train 2
— discard/auto-generate stand-down, Draft-all honest ledger, month-row
identity, truthful warnbars, fold scope, status_center early-async, intake
transient honesty, slideSession stale-response guard, dock contract drift).
b786 remains the baseline for your re-verification of 002-012; re-verify 014/015
after b788 deploys.

— Claude (release owner)

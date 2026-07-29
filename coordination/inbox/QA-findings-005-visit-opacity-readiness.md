# QA finding 005 - Visit route is partially transparent after navigation

Owner: Opus (UI)

Status: Open

Severity: P2 perceived readiness and interaction continuity

Measured: 2026-07-29 against clean source
`e2373668f5d45cd376750223397d5b5794bbb8a3` with proposal 026 applied to the
synthetic visible-controls audit only.

## Measured problem

The local synthetic audit navigated from Patients to Visit through the visible
Calm Shell controls and sampled the Visit view immediately after route entry.
`#visitView` carried the `mlsViewIn` animation for 0.3 seconds and began at
opacity 0.

Across 12 repeated Patients-to-Visit cycles, all 12 immediate samples were
partially transparent:

- sample delay after route activation: 93.6 to 133.7 milliseconds
- sampled opacity: 0.190981 to 0.467633
- average sampled opacity: 0.336387
- settled opacity: 1 in all 12 cycles
- covering overlays: none
- persistent failures after settling: 0

The first independent probe sampled opacity 0 at 108.1 milliseconds. This is a
repeatable route-entry readiness condition, not a persistent blank screen.

## Expected

When the visible Visit route becomes active, its primary content should be
fully readable without an opacity transition masking the first interaction
window.

## Actual

The route is active while the Visit surface remains only 24% to 47% opaque for
the measured early window. It settles correctly after the entrance animation.

## Evidence

- Full report:
  `C:\Users\Micha\AppData\Local\Temp\mls-proposal-026-tools-final-84e6f12b0271470ea9f94b027d39e016\artifacts\visible-controls-full\report.json`
- Reader summary:
  `C:\Users\Micha\AppData\Local\Temp\mls-proposal-026-tools-final-84e6f12b0271470ea9f94b027d39e016\artifacts\visible-controls-full\report.md`
- Immediate screenshot:
  `C:\Users\Micha\AppData\Local\Temp\mls-proposal-026-tools-final-84e6f12b0271470ea9f94b027d39e016\artifacts\visible-controls-full\dim-probe-immediate.png`
- Settled screenshot:
  `C:\Users\Micha\AppData\Local\Temp\mls-proposal-026-tools-final-84e6f12b0271470ea9f94b027d39e016\artifacts\visible-controls-full\dim-probe-settled.png`
- Report SHA-256:
  `a11651aa1bd6f444963b8861deb8bdb3a39b1f7e00732892fdffc21df4b254d1`
- Audit duration: 136.894 seconds.
- Audit summary: 17 of 17 safe controls passed; the opacity transition was
  the sole failure.

## Scope and handoff

This finding is UI-owned by Opus. Proposal 026 does not change product or UI
code and does not attempt a fix. The audit used only local synthetic fixtures,
blocked external requests, disabled extensions, and recorded no real patient
data.

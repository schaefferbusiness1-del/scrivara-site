# 033 - Finalize the visible-controls driver

## Prerequisite

This reviewer-convenience bridge applies only after Opus has already applied
the earlier 026 revision and
`tests/live-visible-controls-audit.js` has SHA-256
`99c6573e0a9000171e36666c655e94c00371dce746e7807f10adbfcd95f31731`.

Clean b790 users must not apply 033. They should apply the final 026 proposal
directly.

## Measured problem

The currently applied 026 target differs from the final validated 026 target by
57 diff lines. Three measured gaps remain:

- History availability is inferred from the hidden implementation owner plus
  the Patient dock, which caused a 71.844-second run to stop waiting for a
  History action that was not visibly offered.
- The successful `Hide tools` exercise persists its closed state across
  `reloadReady()`. The next Paste, After-visit summary, and Orders exercises
  then waited 6.004, 6.186, and 6.000 seconds and reported zero controls.
- A harness failure discards completed route/control counts, while the report
  combines absent History with hosted-role-only coverage.

The final validated target has SHA-256
`9085d2cf577b486dffd7515e522600e858d29d21c7071657e22e5748c1dc84aa`.

## Change

Change only `tests/live-visible-controls-audit.js`.

- Recognize History only when exactly one enabled, non-hidden, non-inert,
  nonzero-geometry action named History is visible. Otherwise report it as
  `not-visible-not-audited` and do not claim coverage.
- Preserve the exact Tools hide result, then restore the visible open
  precondition through the same trusted visible pointer control. Do not write
  storage or dispatch a private event.
- Persist bounded phase and count information in `HARNESS-FAIL` reports.
- Separate routes not visible/audited from hosted-role-only routes and disclose
  absent History explicitly.

The script checks the exact prerequisite hash, performs only
single-occurrence replacements with missing/ambiguity failures, checks the
exact expected output hash before writing, and leaves the target untouched on
any mismatch.

## Expected effect

Opus can upgrade the already-applied 026 test without reverting or replaying
the larger clean-source proposal. The result is byte-for-byte identical to the
final validated 026 target. Later quick-tool exercises establish their visible
precondition, and absent History reduces declared coverage instead of causing a
false harness failure.

## Validation

Validated against a disposable copy of the current shared target; the shared
tracked file remained unchanged at the prerequisite hash.

- Proposal syntax: pass.
- Disposable input SHA-256:
  `99c6573e0a9000171e36666c655e94c00371dce746e7807f10adbfcd95f31731`.
- First apply and patched test syntax: pass.
- Patched test SHA-256:
  `9085d2cf577b486dffd7515e522600e858d29d21c7071657e22e5748c1dc84aa`,
  exactly matching the final validated 026 target.
- Full uncapped audit (`--max=0`): completed in 163.720 seconds.
- Inventory: 3 routes, 41 route-owned controls, and 17 safe exercises.
- Control result: 17 passed, 0 failed. Tools, Paste, After-visit summary, and
  Orders all passed in sequence.
- Sole report failure: QA-005, the nonpersistent `mlsViewIn` Visit route-entry
  opacity animation. All 12 immediate cycles were partially opaque, all 12
  settled to opacity 1, and no covering overlay was present.
- Safety result: 0 blocked requests, 0 browser exceptions, 0 console errors,
  0 final page errors, 233 immutable served assets, and 0 workspace drift.
- Repeat apply: rejected by the exact prerequisite check; target hash remained
  unchanged.
- Evidence:
  `C:\Users\Micha\AppData\Local\Temp\mls-proposal-033-finalize-19c1b5e385be4659bbe6a5fd467b8a55\artifacts\visible-controls-full\report.json`
  (SHA-256
  `6bdfe69cbb58a64db46aaa78d680e54be8b8bf9fec83a8f3e1f026f45bc73b54`).

## Risks

Low and test-only.

The bridge intentionally rejects clean b790, any partly applied 026 version,
and any later test revision. The Tools restore adds one reversible visible
click after its hide-state snapshot has already been captured. History
coverage is conservative: no unique visible action means no audit claim.

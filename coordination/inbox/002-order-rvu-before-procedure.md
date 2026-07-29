# P1 release blocker: preserve RVU before Procedure Report

## Measured problem

The shipped deferral batch makes these formerly ordered loaders independent idle callbacks:

- `mls-connect.js:41429`: `mls-rvu.js?v=20260617bc1`, 41,750 bytes.
- `mls-connect.js:41563`: `mls-procedure-report.js?v=20260722lib2`, 36,727 bytes.

Both callbacks use the same 900 ms fallback and 2,500 ms idle deadline, and both scripts use `async=true`. Their completion order is therefore not defined.

Procedure Report reads `window.__mlsRVU` dynamically at `mls-procedure-report.js:73-83`, but its initial host is rendered only when `#mlsProcReport` is first created at `mls-procedure-report.js:566-574`. A later `mount()` finds the existing host and does not rerender it. RVU's `refreshAll()` at `mls-rvu.js:534-575` updates its own Analysis surfaces and never refreshes Procedure Report.

If the smaller Procedure Report script completes first, its first render can permanently show fallback or zero RVU values until a human changes a report control. This is a real async completion-order race; the 418-suite gate does not exercise the two production loaders with reversed completion order.

Reproducible source probe:

```text
rg -n "mlsRvuLoader|mls-procedure-report" mls-connect.js
rg -n "function RVU|function mount|function refreshAll" mls-procedure-report.js mls-rvu.js
```

## Proposed change

- Keep both assets in their current loader locations and behind their current bounded idle callbacks.
- Make only the Procedure Report callback run a bounded `waitForRvu(tries)` readiness check.
- Load Procedure Report as soon as `window.__mlsRVU` exists, or after 30 checks spaced 100 ms apart so RVU failure still reaches the report's existing fallback behavior.
- Add a contract proving the Procedure Report loader has the bounded readiness gate and retains exactly one production token.

`mls-connect.js` is read and written as `latin1`; the test remains UTF-8. The source edit and test insertion are explicit single-occurrence replacements with ambiguity failures. Satellite bytes do not change, so immutable tokens remain `20260617bc1` and `20260722lib2`.

## Expected effect

- Preserve the full boot deferral: neither 41,750-byte RVU nor 36,727-byte Procedure Report returns to the eager path.
- Preserve one request per satellite and the existing cache tokens.
- Make Procedure Report's first render deterministic and RVU-backed whenever RVU becomes ready within the bounded wait.
- Keep the current fallback report available after a bounded RVU failure.

## Risks and release checks

- Procedure Report can mount up to 3 seconds after its own idle callback. This is required for correct initial totals and remains bounded.
- Verify a throttled run where Procedure Report would otherwise finish first: the initial report must show the same RVU totals as `window.__mlsRVU.sumVisit`.
- Verify RVU load failure still mounts Procedure Report with its documented fallback calculations.
- Run `node tests/late-surfaces-stay-deferred.test.js`, `node tests/local-clinical-library-boundary.test.js`, the Procedure Report contracts, the full gate, and focused live Analysis/Procedure Report verification.

No tracked source, Git state, browser, extension, or live-site state was changed by Codex.

# 016 - Observe the canonical no-patient toast in the synthetic smoke gate

## Measured problem

The isolated browser smoke gate stops before its workflow loop at
`tests/live-synthetic-smoke.js:589`.

The failure reproduced on both:

- clean commit `69713bb8`; and
- the disposable post-015 release preflight snapshot.

Both runs reached the same assertion with an empty `alertText`.

This is deterministic harness drift, not a production guard failure:

- `feat_mls_writeflow.js:2077` sends `Pick a patient first.` through
  `window.toast` when that canonical UI exists, with `window.alert` only as a
  fallback.
- `ScribeFlow.html:5561` owns `#toast`.
- `ScribeFlow.html:5865-5879` renders the text synchronously, adds the `show`
  and `err` classes, and announces an error with `role="alert"`.
- The smoke probe at `tests/live-synthetic-smoke.js:575-589` replaces and
  inspects only `window.alert`. A healthy page therefore produces the observed
  empty value.

The preceding assertions still prove that there is no active patient, the
one-click control is hidden, and no review UI opened. The write-flow source
returns immediately after the toast, before any Athena bridge message.

## Change

Change only the synthetic browser probe.

After `oneClick()` returns, it reads the canonical `#toast` synchronously and
records:

- visible toast text;
- `role="alert"`; and
- the `err` state.

The expected explanation may come from the canonical toast or the legacy alert
fallback. When the toast is used, the test additionally requires its accessible
error state.

Production source and behavior are unchanged.

## Expected effect

- The smoke gate validates the UI that users actually see.
- Native dialogs remain retired.
- A missing explanation, hidden toast, non-alert announcement, absent error
  styling, opened review, or emitted Athena write message still fails closed.
- The ten-cycle synthetic run can continue to later workflow checks.

## Risks

Low and test-only.

The toast is inspected synchronously before its four-second retirement timer.
The alert fallback remains covered for shells that do not provide the canonical
toast. No live route, patient data, extension source, or runtime source changes.

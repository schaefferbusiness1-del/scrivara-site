# 029 - Drive the SMART in-app confirmation

## Measured problem

`tests/live-athena-smart-ui.js:789-806` still queues native Chrome dialog
decisions and waits for `Page.javascriptDialogOpening` after pressing the
Athena API Disconnect button.

That expectation predates the application dialog owner:

- `ScribeFlow.html:24460-24480` awaits `mlsConfirm()` before sending DELETE;
- `ScribeFlow.html:8698-8761` implements `mlsConfirm()` as the non-blocking
  in-app `#_mlsAskDialog`; and
- the native-dialog test block dates to 2026-07-19, while the in-app dialog
  owner dates to 2026-07-22.

On the 2026-07-29 frozen synthetic commit
`e2373668f5d45cd376750223397d5b5794bbb8a3`, the unmodified SMART test failed
at the same line in three of three runs after a 30-second wait. Every report
recorded zero external requests, console errors, page exceptions, Chrome log
errors, and native dialogs.

A read-only CDP DOM probe during the third run found the real overlay visible:

- one `#_mlsAskDialog`, with `role="dialog"` and `aria-modal="true"`;
- the exact disconnect warning, including `MLS Assist is not changed`;
- visible `Cancel` and `OK` buttons;
- a 1409 by 905 overlay in a 1424 by 905 viewport; and
- zero `/smart/connection` DELETE calls before a decision.

The application was waiting correctly. The stale harness never clicked its
in-app Cancel button, so the awaited Promise remained pending and the later
SMART and Staff Prep checks never ran.

## Change

Change only `tests/live-athena-smart-ui.js`:

- wait for the visible `#_mlsAskDialog` and verify its exact message,
  accessibility role, modal state, and button labels;
- assert no DELETE occurred after opening either confirmation;
- dispatch real mouse input at the visible Cancel and OK button centers;
- install a one-shot capture probe that requires each click event to have
  `isTrusted === true`;
- preserve the cancelled path's no-DELETE assertion;
- preserve the accepted path's exactly-one-DELETE and bearer assertions; and
- record the two in-app dialog receipts in the existing scenario report.

No product source, rendered UI, wording, consent decision, extension file, or
network fixture changes.

## Expected effect

The real-Chrome SMART test exercises the confirmation users actually see,
proves the server cannot be called before an explicit decision, and continues
to its next existing Staff Prep stage instead of timing out on a native-dialog
event that cannot occur.

## Validation

Validated against the 2026-07-29 frozen source, whose target SHA-256
`001CB5CF95F9FBB1DEE0505320312CB1558E8A052239FE36CFC10BFD91978F6E`
matched the current worktree target exactly:

- the proposal script and its patched target both pass `node --check`;
- the first application succeeds and produces target SHA-256
  `B6A6811641C7CD9C03C765277B2B4E85090717BDF55345B75E8C4DE83F4FF5B4`;
- a full `node tests/live-athena-smart-ui.js` real-Chrome synthetic run passes
  both new dialog paths and records `trusted: true`, the exact warning, the
  expected buttons, `role="dialog"`, and `aria-modal="true"` for Cancel and
  OK;
- the accepted path preserves the existing exactly-one-DELETE, bearer, and
  disconnected-state assertions; and
- a second proposal application exits 1 at the first missing anchor and
  leaves the patched target hash unchanged.

The full run then exposes a separate existing Calm Shell route mismatch at
the next stage: `openStaffPrep()` tries `#mlsTbMenuBtn`, which exists with
`display:inline-flex` but has a zero by zero rectangle under `body.mls-calm`.
The visible dock remains available. That downstream test-route finding is
not hidden or broadened into this confirmation-only proposal; it needs its
own measured, separately reviewable harness change. The run had zero external
requests, console errors, page exceptions, Chrome log errors, or native
dialogs before that assertion.

## Risks

Low and test-only.

The trusted-input helper targets exactly one visible, enabled element and
asserts that Chrome delivered a trusted click before the test proceeds.
Coordinates come from the element's current viewport rectangle. Any missing,
hidden, duplicated, disabled, or synthetic click fails closed.

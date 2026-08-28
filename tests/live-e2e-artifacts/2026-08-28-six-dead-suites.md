# Six suites were DEAD, not failing (2026-08-28)

Found while clearing the 28 pre-existing reds. In each case the suite reported as a
red anyone could dismiss as known, while in fact NONE of its assertions had executed.

| suite | how it died | what was unguarded |
|---|---|---|
| `1p-easy-generate-sparse-runtime` | `ReferenceError: captureBusy is not defined` at the first line of the function under test | whether a throwing engine click leaves fabricated generation state |
| `visit-exact-action-gate-runtime` | same | the exact scheduled-action gate |
| `phone-day-row-record-identity-runtime` | same, but SWALLOWED by the phone's own `safe()` wrapper, so it presented as "the phone declines this row" | the whole phone identity chain, including the contradictory-DOB cross-patient block |
| `scoped-save-additive` | had not PARSED since a function was inserted between its slice boundaries: `(function a(){} function b(){})` is a SyntaxError | 8 assertions on history-DESTROYING saves, incl. "forced reconcile visibly destroys history" |
| `schedule-visit-persistence-adversarial` | same | adversarial exact-visit persistence and reconciliation |
| `athena-confirmed-billing-contract` | `ReferenceError: _mlsDirectPhoneSupported is not defined`, invisible because an EARLIER assertion failed first | the entire desktop capture TRANSACTION section |

## The lesson that generalises

A red suite is not evidence that its assertions ran. Three distinct causes here:

1. **A missing lift.** The engine gained a call (`captureBusy()`) and every harness that
   lifted the calling function without it died at line one. Five suites, one root cause.
2. **A neighbour-keyed slice.** `indexOf(startOfA) .. indexOf(startOfB)` breaks the moment
   something is inserted between A and B. Brace-match instead, and QUOTE-AWARE - a brace
   inside a string is not structure.
3. **Failure ordering.** A dead section can hide behind an earlier failing assertion in the
   same file. Fixing the first one is what revealed the second.

## How to check for more

Do not trust "it fails, that is known". For any red suite, look at WHERE it fails:
a `ReferenceError` / `SyntaxError` / a failure inside harness setup means the subject
was never reached. Only an `AssertionError` from a named assertion proves the suite ran.

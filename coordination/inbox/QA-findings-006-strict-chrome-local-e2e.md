# QA findings 006: strict local Chrome E2E on b791 plus 031-037

Date: 2026-07-29

Owner boundary: Codex reports evidence only. Opus owns the driver repair, the
template product fix, authoritative gates, deployment, and live verification.
This was isolated localhost synthetic QA, not live-site proof.

## Run result

- Disposable exact-b791 plus proposals 031-037:
  `C:\Users\Micha\AppData\Local\Temp\mls-b791-plus-031-035-3b145b895a4a423b87967e952a99549c`
- Applied `mls-connect.js` SHA-256:
  `1180F5F4C2F4DB22AE0F80558C58F6B09A90A14D407702BE0D04EB23A6957283`
- Browser: Google Chrome `151.0.7922.48`
- Driver: Puppeteer Core `25.3.0`
- Node: `24.18.0`
- Required mode: `MLS_E2E_REQUIRED=1`
- App: fixed `localhost:8873` demo workspace, extensions disabled
- Result: 31 steps, 29 passed, 2 failed, exit code 1
- Elapsed: 119.978 seconds
- Prerequisite skips: none
- Live domain, clinician account, patient data, Athena writes, and extension:
  not used

## Finding A: long-press failure is an occluded driver target

Observed failure at `tests/e2e/run-e2e.js:1078`:

```text
long-pressing mlsRdTitle showed no explanation
display: none; expected block
```

This result does not demonstrate a product-handler failure.

Exact Chrome trace:

1. The driver selected `#mlsRdTitle` by geometry and aimed at its center,
   `(144, 26)`.
2. `document.elementFromPoint(144, 26)` was the fixed
   `#mlsBootReadiness` strip, not the selected element or its descendant.
3. Both trusted touch `pointerdown` events therefore targeted the readiness
   strip, which has no `data-tip`; no long-press timer was supposed to start.
4. `ScribeFlow.html:30288-30311` was installed and listening. An unobscured
   synthetic `data-tip` control under the same handler and trusted Chrome touch
   input displayed `#mlsTip` with the expected text after 800 ms.
5. The readiness strip is fixed and high-z at
   `mls-connect.js:46955-46956`, and can remain until its 30-second bound at
   `mls-connect.js:46977`.
6. `waitForAppSettled` at `tests/e2e/run-e2e.js:902` does not wait for that
   strip. `findTip` at lines 1030-1038 checks rectangle geometry but not
   hit-test ownership.

Required Opus action:

- repair the test driver so it waits for readiness-strip removal and/or chooses
  only a point whose `elementFromPoint` belongs to the candidate;
- do not change the UI behavior merely to satisfy this failed aim point;
- rerun this step in real Chrome; and
- independently verify the gesture on physical touch before declaring the
  product path clean.

## Finding B: template standard-line wrapper drops the safety arguments

Observed failure at `tests/e2e/run-e2e.js:1697`:

```text
automatic Generate did not apply the imported template:
Open or generate this note inside the correct patient visit before applying a
template. Nothing changed in Athena.
```

This is a product defect, and the patient-binding refusal is behaving
correctly.

The strict step exercised the real synthetic workflow:

- created an in-memory ASCII `.txt` `File`;
- assigned it through `tplMultiFile`;
- used the visible Add, template row, Set default, and Templates controls;
- created and selected one exact synthetic patient visit;
- proved the binding before generation;
- called the normal `generateNote()` path; and
- received `true` from generation before template application was refused.

Argument trace:

1. `ScribeFlow.html:19332-19333` captures the binding and epoch.
2. The first safety check passes at line 19385.
3. Line 19413 passes transcript, binding, and epoch to `maybeApplyTemplate`.
4. The office-path wrapper at `mls-connect.js:15047-15053` preserves all three
   arguments.
5. The base path at `ScribeFlow.html:16635-16639` passes template, visit text,
   binding, and epoch to `applyTemplateToNote`.
6. `mls-template-stdline.js:203` declares only `(template, visitText)`.
7. Both forwarding branches at lines 213 and 218 call the wrapped function
   with only those two arguments.
8. The inner wrapper at `mls-connect.js:23274` therefore receives undefined
   binding and epoch.
9. The base refusal at `ScribeFlow.html:16603-16604` sees the missing binding
   and emits the exact observed message. This is not a mismatched-binding
   refusal, which has a different message.

A separate VM sentinel passed four arguments through the standard-line
satellite. Both its with-line and no-line branches forwarded only the first
two, and the wrapper arity was two. The existing
`tests/template-standard-line-runtime.test.js:47` calls with only two
arguments, so it cannot catch this contract break.

Required Opus action:

- forward every original argument in both standard-line wrapper branches;
- when cloning the template, replace only argument zero and preserve the
  remaining original arguments unchanged;
- retain the refusal when binding is absent, stale, or wrong;
- add a four-argument runtime sentinel for both with-line and no-line branches;
- advance the immutable `mls-template-stdline.js` loader token when its bytes
  change;
- rerun the focused template contracts, the full source gate, and the strict
  31-step Chrome E2E; and
- after deployment, run the full three-transcript hosted synthetic template
  workflow in real Chrome before calling the fix shipped.

## Closure rule

Neither finding is closed by a source edit or a localhost pass alone. Opus must
record the fix hashes and gates, deploy the exact reviewed bytes, and provide
live-byte proof. Codex then independently reruns the affected shipped paths in
real Google Chrome and reports any remaining defect to Opus.

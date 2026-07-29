# 018 - Drive the visible Patient destination in the synthetic smoke gate

## Measured problem

With proposals 016 and 017 applied in the disposable preflight snapshot, the
isolated browser smoke gate reaches patient creation and fails at
`tests/live-synthetic-smoke.js:1456`.

The driver tries to click `#nav_patients`, but its own geometry probe measures:

- `display: flex`;
- `visibility: visible`; and
- width and height both zero.

That tab is the hidden legacy rail route under the Calm shell. The visible
canonical destination is the single
`#mlsDock button[data-dest="patient"]` control created by
`feat_mls_calm_shell.js:817-835`. Its click owner routes through the real
`#nav_patients` control after checking feature availability.

After the Patient destination is corrected, the next run measures the same
problem at the old top-bar `#mlsRdNewBtn`: `display: none` with zero width and
height. The visible Patients surface already owns `#ptNewBtn`. The following
Visit transition also names the hidden legacy `#nav_visit` instead of the
visible `#mlsDock button[data-dest="visit"]`.

The gate correctly refuses to synthesize a click on a zero-size element, so the
old selector blocks all later workflow checks.

## Change

Change the synthetic workflow to use:

- the visible Patient dock destination;
- the visible Patients-surface New patient action; and
- the visible Visit dock destination.

The route waits, patient form, and every later assertion remain unchanged.

## Expected effect

- The smoke gate follows the same visible routes and action a clinician uses.
- Feature availability remains enforced by the canonical dock owner.
- The driver no longer bypasses its own visibility requirement.
- Later patient, visit, history, export, and performance checks can run.

## Risks

Low and test-only.

The selector is the Calm shell's explicit destination contract, not positional
DOM structure. If the visible Patient destination is missing, duplicated, or
hidden, the existing click helper still fails. No live route, patient data,
extension source, or runtime source changes.

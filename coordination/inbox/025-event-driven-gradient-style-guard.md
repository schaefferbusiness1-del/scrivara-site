# 025 - Make the gradient stylesheet guard event-driven

## Measured problem

`mls-connect.js:6356-6365` injects one global stylesheet and then calls
`ensureCss()` every 3,000 ms for the lifetime of the tab.

`60000 / 3000` is 20 timer callbacks per minute. In the steady state each
callback only performs `document.getElementById('mlsEz3GradientCss')` and
returns. The source comment itself records that nothing in the app currently
wipes the head, and repository search found exactly one copy of this interval.

The stylesheet already applies to all current and future matching body
elements. Body remounts do not require reinsertion.

## Change

Replace the permanent interval with one `MutationObserver` scoped to:

- direct children of the current `head`, to recognize removal of the exact
  `mlsEz3GradientCss` node; and
- direct children of `document.documentElement`, to recognize wholesale head
  replacement and rebind to the new head.

The callback ignores ordinary head additions and every body-descendant
mutation. It reinserts only after the exact style is removed or the head is
replaced. `revert()` disconnects the observer before removing the style.

The proposal adds a persisted VM proof to
`tests/interaction-performance-contract.test.js`. It proves zero interval
registration, exact-style removal recovery, wholesale-head replacement
recovery, observer rebinding, and complete revert cleanup.

`mls-connect.js` is read and written with latin1 encoding. No rendered CSS,
copy, route, state, patient data, or extension file changes.

## Expected effect

- Remove 20 steady-state main-thread timer callbacks and 20 DOM lookups per
  minute per open tab.
- Preserve immediate recovery for both head-child wipes and head replacement.
- Avoid observing the high-churn body subtree.

## Risks

Low.

Modern supported Chrome provides `MutationObserver`. If it is unavailable, the
stylesheet still installs once at boot, which is enough for normal app
operation. The observer watches two low-churn direct-child scopes and filters
for the exact removal condition before writing.

Because this changes `mls-connect.js` bytes, release assembly must advance the
site asset token before deployment.

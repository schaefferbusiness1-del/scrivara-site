# 031 - Make route memory event-driven

## Measured problem

`mls-connect.js:41068-41076` starts a permanent one-second interval after its
one-time route restore. Every callback calls `currentView()`, which queries
`.navtab.on`; it writes session storage only if the route changed.

A reproducible VM probe of the current owner simulated one idle minute after
restore and measured:

- one permanent interval registered at 1,000 ms;
- 60 timer callbacks;
- 60 `.navtab.on` DOM queries; and
- zero storage writes.

The polling dependency is obsolete in production.
`ScribeFlow.html:12146-12149` already emits `mls:view-changed` with the previous
and new route after every real `showView()` transition. Repository search found
the legitimate fixed navigation tabs change their `.on` state in `showView()`;
the only direct navigation-class writer outside it is the dynamic pinned-view
path, which the tab-memory `VIEWS` allowlist does not persist.

## Change

Change only production `mls-connect.js` and its existing performance contract:

- replace the permanent route-memory interval with one
  `mls:view-changed` listener installed after the existing restore delay;
- consume `event.detail.view` without querying the DOM;
- retain `currentView()` as a fail-safe only when an acknowledgement has no
  detail;
- preserve the existing supported-route allowlist, session-storage key,
  delayed restore, and same-route write guard; and
- add a persisted VM proof for restore order, zero interval registration,
  changed-route persistence, same-route suppression, unsupported-route
  rejection, and the missing-detail fallback.

`mls-connect.js` is read and written with latin1 encoding. No rendered UI,
route ownership, clinical data, extension file, or network behavior changes.

`mls-connect.staging.js` is intentionally unchanged because
`ScribeFlow-staging.html` does not yet emit this production route event. The
proposal does not remove a staging fallback whose dependency is absent.

## Expected effect

Remove 60 steady-state main-thread timer callbacks and 60 DOM queries per
minute per open production tab. Route changes persist in the same task as the
existing route acknowledgement instead of waiting up to one second.

## Validation

Validated in two disposable trees without changing the worktree targets:

- clean frozen 2026-07-29 source:
  - proposal script, patched `mls-connect.js`, and patched performance test
    pass `node --check`;
  - `node tests/interaction-performance-contract.test.js` passes;
  - `node tests/clinician-navigation-contract.test.js` passes; and
  - `node tests/canonical-ui-ownership-runtime.test.js` passes.
- current accepted-proposal train:
  - first application succeeds; and
  - the integrated interaction-performance contract passes.

On the clean source, the first application changed:

- `mls-connect.js` SHA-256 from
  `BD5D83654F076875A2ACCDB4A1FFCE861A96507DF7F7F54AED466DBE260ECF53`
  to
  `C76DD89BFDCB14C3B2A5CE9B61AA9070B0260994B4B2669A3057527EE3D09F72`;
  and
- the performance test SHA-256 from
  `843C7CB863D7D4675C782DA2ACC14B0C7F851DC6507AC4D5E42FC5539AEE3BC3`
  to
  `431C158FDA81DF5B469686984A15D4729C3B84F4AA228F98D4AE0F7CB7DA744B`.

A second application exits 1 at the first missing anchor and leaves both
patched hashes unchanged.

## Risks

Low.

The production event is emitted only after a real route change and carries the
same route string the old DOM parser recovered from the active tab. The
listener starts only after restore, preserving the safeguard against the
default route overwriting the saved route. If event detail is absent, the
existing active-tab parser remains as a one-event fallback rather than an idle
poll.

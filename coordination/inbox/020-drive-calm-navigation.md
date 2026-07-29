# 020 - Drive and measure the visible Calm navigation

## Measured problem

After proposals 016-019 let the disposable browser preflight complete account
switching, patient creation, note save, and hard-reload persistence, two
navigation checks fail:

1. History reopen tries to click hidden `#nav_history` and records a zero-size
   control. A first preflight correction tried a Patient/History segmented row,
   but the running page returned zero visible tabs: `{"ok":false,"labels":[]}`.
   A second correction tried Day, but the isolated account correctly rendered
   no Day destination (`display:none`, 0x0).
2. The stability loop inventories
   `#mlsRdNav .mainnav > .navtab`, finds zero visible destinations, and stops at
   `tests/live-synthetic-smoke.js:511`.

The Calm shell deliberately hides the old rail. Its visible navigation owner is
`#mlsDock`, created at `feat_mls_calm_shell.js:817-874`. History is deliberately
folded out of the rail (`feat_mls_redesign.js:429-449`). A disposable browser
probe measured `#nav_history` and Day at 0x0. After clicking the visible Visit
destination and waiting for Easy to render doctor/home, canonical
`#ez3Hist` measured 197.05x37.5 pixels. Clicking it passed the complete saved
History row, detail, edit, and raw-note reopen sequence.

The route is source-backed: Visit is a Calm destination at
`feat_mls_calm_shell.js:736-760` and delegates through `go()` at
`feat_mls_calm_shell.js:1270-1283`. Easy creates `#ez3Hist` at
`mls-connect.js:19141-19149`, wires it at `mls-connect.js:19160-19166`, and
delegates to `showView('history')` at `mls-connect.js:19174-19178`.

The smoke driver therefore measures hidden compatibility controls instead of
the interface a clinician can use.

## Change

Change only the synthetic browser driver:

- sample `#mlsDock` geometry and its one `aria-current="page"` destination;
- inventory the visible Day, Patient, Visit, Review, and AI Studio dock
  destinations;
- click each visible dock destination and verify its real view and active dock
  owner; and
- reopen saved History through the visible Visit destination's
  `View completed notes` action.

Tools remains excluded from route iteration because it opens a menu rather than
a view. The underlying hidden tabs remain the production routing owners.

## Expected effect

- Stability measurements cover the visible dock instead of a zero-size rail.
- Every visible primary destination must have and complete a smoke strategy.
- History persistence is verified through the route exposed to clinicians.
- A missing, duplicated, hidden, misrouted, or incorrectly active destination
  still fails closed.
- Remaining workflow and performance cycles can run.

## Risks

Low and test-only.

Selectors use explicit Calm shell contracts (`data-dest`, `aria-current`) and
the canonical Easy Visit action id (`ez3Hist`). No positional route is used. The
route and view waits remain unchanged. No live route, patient data, extension
source, or runtime source changes.

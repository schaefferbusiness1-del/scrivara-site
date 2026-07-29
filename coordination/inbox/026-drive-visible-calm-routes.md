# 026 - Drive the visible-controls audit through the Calm Shell

## Measured problem

On clean b790, `tests/live-visible-controls-audit.js` failed before inventory
at line 359:

`Could not resolve one visible #nav_visit: {"ok":false,"count":0}`

The frozen run had zero blocked requests, browser exceptions, and console
errors. Its screenshot showed that Visit was visibly reachable through
`#mlsDock button[data-dest="visit"]`. The legacy `#nav_visit` still exists as
the underlying route owner, but its `#mlsRdNav` ancestor is intentionally
hidden by the Calm Shell.

Repository measurement found five direct legacy-route clicks, two additional
programmatic legacy-route transitions, a route inventory that defines
"visible" by those hidden IDs, and an active-navigation assertion that reads
the hidden rail instead of the visible dock.

The first revised validation reached the real Visit and Patient inventories,
then stopped after 71.844 seconds at:

`Timed out waiting for visible History segment; last=false`

The Patient screenshot contained no visible History segment after the
synthetic note was saved. The test had nevertheless declared History available
from the hidden `nav_history` implementation node plus the visible Patient dock
button. Neither is evidence of a clinician-visible History action. The failure
report also discarded the two completed route inventories and their control
counts.

The next full uncapped run completed 17 safe exercises and exposed one more
test-state leak. Exercise 4, `ez3flToolsToggle`, correctly changed the visible
label from `Hide tools` to `Show tools`, but `reloadReady()` preserved that
visible preference. The next three Visit quick-tool exercises then waited
6.004, 6.186, and 6.000 seconds before reporting zero matching controls. The
controls were hidden by the preceding successful exercise, not absent from the
product.

A focused rerun confirmed the hide click left `aria-expanded="false"` on the
visible toggle. That runtime exposed the accessible label as `Show tool`
singular even though the collected inventory/source wording is `Show tools`.
The readiness check therefore accepts only the measured `tool`/`tools` naming
variation while retaining the exact expanded-state checks.

## Change

Change only `tests/live-visible-controls-audit.js`.

- Map direct route entry to the visible dock destinations.
- Reach History through the visible Patient destination and its visible
  History segment.
- Create the synthetic patient through the visible `#ptNewBtn`.
- Centralize route entry in `openRoute()` so setup, dim probes, inventories,
  revisits, and per-control isolation use the same clinician-visible path.
- Inventory and check active state on `#mlsDock`, while retaining the legacy
  IDs solely as product route identities and entitlement signals.
- Keep Practice marked hosted-role-only until this audit has a distinct visible
  Practice entry; do not click the shared Studio landing and pretend it opened
  Practice.
- Count History only when exactly one enabled, non-hidden, non-inert,
  nonzero-geometry action with the accessible name `History` is visible. Hidden
  `nav_history` state and the Patient dock are never treated as proof. When no
  such action is offered in the current demo state, mark History
  `not-visible-not-audited`, omit it from the route inventory, and explicitly
  disclaim coverage. This is not classified as a product defect.
- Treat the legacy top-level New menu as out of scope when its trigger is not
  visible. The individual visible creation controls remain part of the route
  inventory instead of being replaced by hidden-menu clicks.
- Persist bounded progress in `HARNESS-FAIL` reports: completed phase, route
  count, route-owned control count, per-route counts, and completed safe
  exercises. No patient, note, transcript, or browser-storage payload is copied
  into that diagnostic.
- Preserve the Tools toggle's exact hide-behavior measurement, including its
  `after` snapshot and pass/fail decision, then require the now-visible
  `Show tools` control and activate it with the audit's trusted visible-pointer
  click helper. Wait for the same toggle to read `Hide tools` and for at least
  three visible quick-tool chips before exercising later quick tools. This
  establishes their visible precondition without writing storage or dispatching
  a private event. The earlier no-patient `Show tools` exercise already opens
  the row and is intentionally left open; restoration is scoped to the later
  `Hide tools` exercise that would otherwise close it.

The test remains local-demo, synthetic-only, external-network-blocked, and
extension-free. No product or UI file changes.

## Expected effect

The audit reaches its actual visible-control inventory instead of failing on a
retired shell selector. It will now report genuine control and route failures
that occur after navigation, rather than treating a hidden implementation
detail as the clinician entry point. The three later quick-tool checks no
longer inherit the intentionally hidden state produced by the toggle check.

## Validation

Validated from clean source
`e2373668f5d45cd376750223397d5b5794bbb8a3`.

- Proposal syntax, first apply, and patched test syntax: pass.
- Patched test SHA-256:
  `9085d2cf577b486dffd7515e522600e858d29d21c7071657e22e5748c1dc84aa`.
- Second apply: failed explicitly; the patched test hash remained unchanged.
- Full uncapped audit (`--max=0`): completed in 136.894 seconds.
- Inventory: 3 routes, 41 route-owned controls, 17 safe exercises.
- Control result: 17 passed, 0 failed. The Tools toggle, Paste a transcript,
  After-visit summary, and Orders all passed in sequence.
- Safety result: 0 blocked requests, 0 browser exceptions, 0 console errors,
  0 final page errors, 233 immutable served assets, and 0 workspace drift.
- Sole report failure: the pre-existing `mlsViewIn` Visit route opacity
  transition, separately handed to Opus in
  `coordination/inbox/QA-findings-005-visit-opacity-readiness.md`.
- Evidence:
  `C:\Users\Micha\AppData\Local\Temp\mls-proposal-026-tools-final-84e6f12b0271470ea9f94b027d39e016\artifacts\visible-controls-full\report.json`.

## Risks

Low and test-only.

The route driver deliberately delegates to the same visible dock and segmented
controls a clinician uses. The test still waits for the underlying
`window.__mlsCurrentView` value after every transition, so a dock control that
does not reach its promised route fails loudly. History is intentionally
coverage-gated by a visible action, so an absent entry reduces the declared
coverage instead of creating a false harness failure or an unsupported product
finding. Restoring Tools adds one reversible visible click after its hide state
has already been captured; if the real toggle cannot restore its own quick
tools, the harness fails loudly instead of masking that behavior.

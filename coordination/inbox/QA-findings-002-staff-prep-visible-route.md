# QA finding 002 - Staff Prep has no visible Calm Shell route

## Status

Product UI reachability defect. No test patch is proposed.

The SMART browser harness must not click the hidden top-bar Menu, dispatch the
private Staff Prep event, or substitute a different action merely to continue.
Proposal 030 is therefore intentionally not created.

## Synthetic-only reproduction

Environment:

- frozen 2026-07-29 commit
  `e2373668f5d45cd376750223397d5b5794bbb8a3`;
- proposal 029 applied to the clean test source;
- local synthetic account and schedule fixtures only;
- real headless Chrome input through CDP;
- zero external requests; and
- no live site, signed-in Chrome profile, extension, or patient data.

`tests/live-athena-smart-ui.js:546-549` currently opens Staff Prep through:

1. `#mlsTbMenuBtn`;
2. `#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]`; then
3. the existing `#ez3PullStart` and `#ez3Seg` workspace acknowledgement.

The first selector exists in the Calm Shell but is not visible. A runtime DOM
probe after Settings closes measured:

- `#mlsTbMenuBtn`: `display:inline-flex`, `visibility:visible`, width `0`,
  height `0`;
- `#mlsTbMenuPanel`: `display:none`, width `0`, height `0`; and
- `body` includes `mls-calm`.

The clinician-visible dock remains present. A trusted click
(`event.isTrusted === true`) on
`#mlsDock button[data-dest="tools"]` opened the visible
`#mlsToolsMenu[role="menu"][aria-label="Tools"]`.

Two independent real-Chrome runs produced the same 15 visible menu actions:

1. Dictate
2. MLS Assistant
3. Draft op note
4. Prep op notes
5. Schedule
6. Templates
7. Custom widget
8. Pull activity
9. Troubleshoot Athena
10. Verify saved data
11. Share / Export
12. Export everything for EMR
13. Full visit notes
14. Settings
15. Log out

Neither run exposed Staff Prep or Staff prep and Athena month pull. All 15
rows had non-zero rectangles. The visual probe is:

`C:\Users\Micha\AppData\Local\Temp\mls-smart-030-route-probe-visual\03-tools-menu-route-probe.png`

The screenshot contains synthetic UI only and shows the visible Tools grid
without a Staff Prep action.

## Source ownership

The source agrees with the browser measurement:

- `feat_mls_calm_shell.js:736-760` defines visible dock destinations and
  makes Tools a menu.
- `feat_mls_calm_shell.js:878-881` states that controls hidden by the shell
  must reappear in Tools.
- `feat_mls_calm_shell.js:959-962` tries to source Staff Prep from
  `{ id: 'nav_staffpull' }`.
- `ScribeFlow.html:2782` permanently declares `#nav_staffpull` with `hidden`,
  `aria-hidden="true"`, and `tabindex="-1"`.
- `feat_mls_calm_shell.js:1099-1107` rejects every hidden source in
  `available()`, so the declared Tools row cannot render.
- `feat_mls_topbar_unify.js:87-107` keeps the real Staff Prep activation
  private to the top-bar Menu intent/acknowledgement path.
- `feat_mls_topbar_unify.js:231-240` marks that canonical row with
  `data-mls-action="staff-prep"`.
- `mls-connect.js:21041-21070` accepts only the private
  `source: "mls-topbar-menu"` request and emits
  `mls:menu-staff-prep-opened` after the workspace is complete.
- `feat_mls_calm_shell.js:919-929` documents that the visible Prep op notes
  row targets `#opPrepSmartBtn`; it is a different day/patient preparation
  action and is not the Staff Prep workspace.

## Impact

In the default Calm Shell, a clinician cannot follow the product's stated
Menu route to Staff Prep. The test failure is therefore correctly detecting
a missing visible product route, not stale selector naming alone.

This blocks the remaining SMART Staff Prep/provider/range/refresh browser
checks from being exercised through a real user path.

## Acceptance criteria for the product owner

Restore one visible Calm Shell Tools action for Staff Prep without publishing
a new clinical writer or weakening the existing private acknowledgement:

- the action is visible, enabled, and named unambiguously;
- a trusted click on visible Tools followed by a trusted click on that action
  reaches the existing canonical Staff Prep activation path;
- `mls:menu-staff-prep-opened` acknowledges the same request only after the
  Staff Prep DOM is complete;
- `#ez3PullStart` and `#ez3Seg` become visible through that user path; and
- the existing top-bar single-owner and no-hidden-pull guarantees remain.

Once that visible route exists, a separate test-only proposal can replace the
stale hidden-menu driver with trusted clicks and exact route/ack assertions.

## Risk of a harness-only workaround

High. Clicking `#mlsTbMenuBtn` or its row while they have zero geometry,
dispatching `mls:menu-staff-prep-request` from the test, or treating Prep op
notes as Staff Prep would make the suite green while preserving the user-facing
defect. None of those workarounds is proposed.

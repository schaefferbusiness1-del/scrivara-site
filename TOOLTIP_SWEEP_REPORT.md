# Tooltip dedupe and clarity sweep — 2026-07-14

## Scope

- Audited 29 production HTML pages plus the signed-in MLS application.
- Inspected 600 signed-in controls in the current rendered DOM.
- Excluded all 14 detected tabs from new tooltip behavior.
- Left obvious, self-explanatory controls without redundant hover text.

## Changes

- Removed seven visual duplicate-tooltip cases where a universal `data-tip` bubble stacked with a richer Athena card explainer.
- Closed the late-render race that could restore the redundant tooltip source during hover.
- Added focused hover help to unclear main-menu items, icon-only modal controls, calendar arrows, compact workflow actions, template-processing actions, phone recording controls, AuthPilot storage/history actions, patient review choices, and Review Finder analysis actions.
- Did not modify `ScribeFlow.html`, `mls-connect.js`, extension code, or any file reserved by the concurrent exact-history release.

## Verification

- Rendered signed-in tooltip runtime: v1.1.0 installed.
- Visual duplicate tooltip count after simulated hover: 0.
- Focused tooltip contract: passing.
- JavaScript syntax and whitespace validation: passing.
- Full local regression run: 25 suites passing.


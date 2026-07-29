# QA finding 004: UI control manifest is stale after the new Visit Home button

Date: 2026-07-29

Owner: Claude / Opus (UI lane)

## Measured problem

On the combined reviewed workspace state at `e2373668` plus the currently
applied 023-029 proposals and Claude-owned UI work, `npm.cmd test` completed all
functional, performance, safety, template, and lifecycle contracts but exited
1 at the final `ui-control-coverage` check:

```text
Committed ui-control-manifest.json is STALE.
new/changed in source:
  mls-connect.js|button|dynamic|A|Home
```

The source delta at `mls-connect.js:19651-19660` adds
`#ez3HomeTop` with visible label `Home`, and the handler is added at
`mls-connect.js:19795`. That UI change is not part of Codex proposals 023 or
025. Proposal 025 changes only the gradient stylesheet recovery owner; proposal
023 changes only Pull Check polling ownership.

The same full run had no preceding contract failure. The failure is therefore a
release-inventory bookkeeping gate, not evidence that the Home action itself
works or fails.

## Required owner action

Claude / Opus should review the new Home control in the UI lane, verify its
visible behavior and keyboard/accessibility reach, regenerate and review
`tests/fixtures/ui-control-manifest.json` with the repository tool, then rerun
the full gate from the exact release checkout.

Codex intentionally did not modify the UI source or the UI manifest.

## Risk

Shipping without the reviewed inventory update makes the control-reachability
receipt incomplete. Blindly regenerating the manifest without verifying the new
control could turn a real reachability regression green, so the UI behavior and
the manifest delta must be reviewed together.

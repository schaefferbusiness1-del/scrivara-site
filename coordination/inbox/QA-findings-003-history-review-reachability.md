# QA finding 003 - History is not visibly reachable from Review

## Classification

Product UI/accessibility defect for Opus review. No product fix is proposed in
this finding.

Observed on frozen clean HEAD
`e2373668f5d45cd376750223397d5b5794bbb8a3` in isolated Chrome 151, local demo,
fresh profile, synthetic data only, extensions disabled, and external hosts
blocked.

## Expected

The current Calm Shell source says History belongs in the visible Review
destination:

- `feat_mls_calm_shell.js:749-754` declares `nav_history` as a Review `extra`
  and labels it `History`.
- `feat_mls_calm_shell.js:782-790` builds the visible segmented row from real
  targets plus those extras.

A keyboard user should be able to press the visible Review dock control and
then reach a visible History segment.

## Actual

The Review dock activates correctly and lands on the canonical Orders surface,
but its visible segment row contains `Orders`, `The note`, and
`Nothing to do here yet`. It contains no History control.

The source conflict is deterministic:

1. `feat_mls_redesign.js:538-544` folds `#nav_history` by setting its inline
   `style.display = "none"`.
2. `feat_mls_calm_shell.js:1099-1107` defines `available()` to reject any
   element whose inline display is `none`.
3. `feat_mls_calm_shell.js:788-790` filters Review extras through
   `available()`.

The History extra is therefore declared and then filtered out by the combined
production source. Calling hidden `#nav_history`, invoking `showView("history")`,
or treating the Patient destination as History would hide this defect and was
not accepted as audit coverage.

## Screenshots

The first image shows the visible Patient destination after the draft audit
looked for History in the wrong place. The second shows the correct Review
destination and the missing History segment.

![Patient destination has no History segment](</C:/Users/Micha/AppData/Local/Temp/mls-027-a11y-b09b3a1f46fa45adade2327dbdf7f720/artifacts/a11y-responsive/FAIL.png>)

SHA-256:
`8a03d1f64ac8c08872b5210a205b15faf4cb2451292ef4f8f5a3d1d63ff849bc`

![Review destination omits History](</C:/Users/Micha/AppData/Local/Temp/mls-027-a11y-b09b3a1f46fa45adade2327dbdf7f720/artifacts/a11y-review-contract/FAIL.png>)

SHA-256:
`68d598fa614407b1085444ff8414c8955c0ee09d0275f628aec8fb4fadd56072`

## Impact

- The visible shell promises no keyboard path to the saved History list.
- The History row/detail dialog cannot be truthfully covered by a
  visible-control accessibility audit.
- Users must discover a separate contextual shortcut, command route, or hidden
  implementation owner; that is not equivalent to a visible Review segment.

Proposal 027 now excludes History and reports only visible Review coverage.
After Opus restores a visible History offer, the keyboard route and saved-detail
dialog proof should be reinstated and gated separately.

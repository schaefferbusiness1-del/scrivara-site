# 034 - Finalize the accepted 027 accessibility audit

## Prerequisite

This is a reviewer-convenience upgrade only for a workspace where Opus already
applied the earlier 027 revision and
`tests/live-synthetic-a11y-responsive.js` has SHA-256
`9799b534c5577e0cbf99124e0aa1cd1958a8996394cb400597e17865d3bcc880`.

A clean b790/frozen-HEAD workspace must not use 034. Apply the final
`027-keyboard-visible-calm-routes.js` proposal there instead. An already-final
027 target must not use 034 either.

## Measured problem

The currently accepted earlier-027 target is 48,301 bytes, LF with no BOM. The
final reviewed 027 target is 48,490 bytes, LF with no BOM and SHA-256
`c6462e0b4ff703175213a4421c8b340da4cef531fb3bab3ad3f45d841bbd2d31`.

A byte comparison found six changed regions:

- `tests/live-synthetic-a11y-responsive.js:23-26` lacks the visible Review dock
  route.
- `tests/live-synthetic-a11y-responsive.js:199-215` expects a nonexistent
  `__mlsCurrentView === "review"` state and tries to discover History through a
  segment that the current Calm Shell does not visibly offer.
- `tests/live-synthetic-a11y-responsive.js:371-385` still traverses and asserts
  the unavailable History route/detail flow.
- `tests/live-synthetic-a11y-responsive.js:415-424` still expects the retired
  narrow-width rail opener and drawer to be visible.
- `tests/live-synthetic-a11y-responsive.js:465-473` still invokes History and
  drawer proofs instead of collecting visible Review and compact-dock evidence.
- `tests/live-synthetic-a11y-responsive.js:483-487` still reports the obsolete
  coverage claims.

The source and final files differ by 189 bytes. Independent comparison confirmed
that every changed source region occurs once in the accepted target and its
replacement occurs once in the validated final target.

## Change

Change only `tests/live-synthetic-a11y-responsive.js`, when Claude applies the
proposal.

The script:

- requires the exact accepted-source SHA before doing any work;
- makes twelve small, exact, single-occurrence replacements in memory;
- fails explicitly when any anchor is missing or ambiguous;
- drives visible Review through its bottom-dock control and verifies the actual
  canonical `ordersView` or `recsView` surface, current dock state, title, and
  visible segment controls;
- replaces unavailable History traversal with visible Review coverage;
- replaces obsolete rail/drawer assertions with bottom-dock keyboard focus and
  Enter activation at 360px and 768px;
- records Review and compact-navigation evidence and explicitly lists History
  route/detail as not claimed;
- requires the exact final SHA before writing the file.

No product/UI source, extension file, live site, account, or patient data is
changed.

## Expected effect

Reviewers who already accepted the earlier 027 can reach the exact final
validated test bytes without reverting or trying to reapply the clean-source
027 proposal. The audit then tests the navigation that users can actually see:
Visit, Patient, and Review in the bottom dock, including keyboard focus and
activation at compact widths.

## Risks

Low and test-only.

The proposal intentionally refuses any source other than the exact accepted
earlier-027 SHA, including clean HEAD and an already-final target. Line-ending or
concurrent-content drift also causes a safe refusal. All replacements and the
final hash are checked before the one write, so an anchor or output mismatch
cannot leave a partially patched file.

History remains deliberately untested because it is not visibly offered by the
current Calm Shell. Its product-source conflict remains in
`coordination/inbox/QA-findings-003-history-review-reachability.md`; this
proposal does not make a UI fix or bypass the missing route.

## Disposable-copy verification

Validated in a full disposable archive at:

`C:\Users\Micha\AppData\Local\Temp\mls-034-validate-ed4564abcf614e9ba480ef65b0607971`

The archive began at frozen HEAD, then received a disposable copy of the
current shared target. The shared tracked target was not edited during
validation.

- Proposal syntax: pass.
- Disposable source SHA-256:
  `9799b534c5577e0cbf99124e0aa1cd1958a8996394cb400597e17865d3bcc880`
- First application: pass.
- Patched target syntax: pass.
- Patched target SHA-256:
  `c6462e0b4ff703175213a4421c8b340da4cef531fb3bab3ad3f45d841bbd2d31`
- Exact match to the final validated 027 target: pass.
- Second application: exit 1 with an explicit prerequisite mismatch.
- Hash after refused second application:
  `c6462e0b4ff703175213a4421c8b340da4cef531fb3bab3ad3f45d841bbd2d31`
  (unchanged).
- Full uncapped isolated-Chrome accessibility/responsive audit: pass.
- Review proof: `ordersView` visible, Review dock
  `aria-current="page"`, title `Review`.
- Compact bottom-dock keyboard/focus proof: pass at 360px and 768px.
- Responsive audits: pass at 360x800, 768x1024, and 1440x1000.
- External requests: zero. Browser exceptions: zero.
- History route/detail appears only in `notClaimed`.
- Report:
  `C:\Users\Micha\AppData\Local\Temp\mls-034-validate-ed4564abcf614e9ba480ef65b0607971\artifacts\full-a11y-responsive\report.json`
- Report SHA-256:
  `bc631f5c5bc8757413b6ab3525737e6a54f8a64b4939c1ed1d36a0742b5f2a8d`

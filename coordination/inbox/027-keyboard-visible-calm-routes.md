# 027 - Keyboard-drive the current visible Calm Shell

## Measured problem

On frozen clean HEAD `e2373668f5d45cd376750223397d5b5794bbb8a3`,
`tests/live-synthetic-a11y-responsive.js` completed its 1440-by-1000 baseline
audit and then failed:

`Could not focus #nav_visit`

The visible Visit entry is
`#mlsDock button[data-dest="visit"]`; `#nav_visit` is a hidden route owner.
The same stale pattern existed for Patient, later Visit transitions, and the
responsive rail proof.

The first 027 draft proved the visible Visit/Patient and patient-dialog flows,
then exposed two additional harness mismatches:

- Review is a dock destination whose canonical active view is `orders` or
  `recs`; there is no `window.__mlsCurrentView === "review"` state.
- Calm Shell intentionally hides the retired rail and `#mlsRdRailBtn` at narrow
  widths, so a drawer-focus proof cannot succeed. The visible bottom dock is
  the navigation owner at 360px and 768px.

The same run also found that History is not visibly offered by the current
shell. That is recorded separately in
`coordination/inbox/QA-findings-003-history-review-reachability.md`. This
test-only proposal does not bypass the missing route or claim History coverage.

## Change

Change only `tests/live-synthetic-a11y-responsive.js`.

- Drive Visit, Patient, and Review with real keyboard input on visible bottom
  dock controls.
- Treat Review as a destination: require its dock control to become current,
  require the actual `ordersView` or `recsView` canonical surface to be visible,
  and require the visible title and segment row to identify Review.
- Open the patient dialog from visible `#ptNewBtn`; retain focus trapping,
  Escape restoration, reopen, save, and post-save focus restoration.
- Replace the hidden History traversal with a visible Review-surface proof.
  History route/detail is explicitly excluded because the current Calm Shell
  does not visibly offer it.
- At 360px and 768px, prove the bottom dock is visible, the retired rail/burger
  stay hidden, Visit/Patient/Review remain offered, the Visit dock control has
  visible keyboard focus, and Enter activates its canonical Visit route.
- Keep the existing synthetic note, Athena review dialog, mobile notices,
  responsive, zoom, reduced-motion, label, target-size, overflow, overlap, and
  contrast coverage.

No product/UI source, extension, hosted account, or patient data changes.

## Expected effect

The audit exercises only controls a keyboard user can see and focus in the
current shell. A broken dock proxy, wrong current state, missing Review surface,
lost focus style, dialog regression, narrow-width navigation failure, overflow,
zoom, or reduced-motion regression fails independently.

## Risks

Low and test-only.

Review can legitimately land on Orders or Recommendations depending on which
entitled target the app offers first, so the audit accepts exactly those two
canonical views while still requiring one visible surface and one current
Review dock owner. It does not call hidden route owners or `showView()`.

History coverage is deliberately absent rather than silently bypassed. Once
the product visibly offers History again, its keyboard and detail-dialog
coverage should return in a separate reviewed change.

## Clean-scratch verification

Validated against a fresh archive of frozen HEAD under:

`C:\Users\Micha\AppData\Local\Temp\mls-027-revised-48c906b96f1e4e2e82c9cfc56490aa89`

- Proposal syntax: pass.
- Clean target SHA-256:
  `2ee64c235bd002affbf400722ccd18c3f59c88833e0e084467430de675457e17`
- First application: pass.
- Patched target syntax: pass.
- Patched target SHA-256:
  `c6462e0b4ff703175213a4421c8b340da4cef531fb3bab3ad3f45d841bbd2d31`
- Second application: exit 1 on the absent guarded anchor.
- Hash after refused second application:
  `c6462e0b4ff703175213a4421c8b340da4cef531fb3bab3ad3f45d841bbd2d31`
  (unchanged).
- Full uncapped isolated Chrome audit: pass.
- Review proof: focused visible Review dock control, canonical `ordersView`
  visible, dock `aria-current="page"`, title `Review`.
- Compact navigation: visible dock and keyboard activation passed at 360px and
  768px; retired burger and rail remained hidden.
- Baseline plus 360x800, 768x1024, and 1440x1000 audits reported zero duplicate
  IDs, unlabeled controls, undersized primary targets, overlaps, script errors,
  advisory contrast samples, and horizontal overflow.
- 200% zoom and reduced motion: pass.
- External requests: zero. Browser exceptions: zero.
- History route/detail appears only in `notClaimed`.
- Report:
  `C:\Users\Micha\AppData\Local\Temp\mls-027-revised-48c906b96f1e4e2e82c9cfc56490aa89\artifacts\full-a11y-responsive\report.json`
- Report SHA-256:
  `be363a1b7a785ad4b34c0383075e6aa36951cf0aa47e4e66a38e43908c6c6f15`

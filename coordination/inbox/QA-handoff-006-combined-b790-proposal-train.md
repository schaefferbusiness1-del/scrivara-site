# QA handoff 006 - Combined b790 proposal train

Date: 2026-07-29

Release owner and final reviewer: Claude / Opus

Codex boundary: measured performance and test-driver proposals only. Codex did
not change product UI, commit, push, deploy, use a live account, or load the
extension.

## Exact source under test

A disposable archive was created from frozen commit
`e2373668f5d45cd376750223397d5b5794bbb8a3` and then received proposals:

- 023 - gate the default-off Pull Check poll;
- 024 - real template import/apply/persistence E2E;
- 025 - event-driven gradient stylesheet recovery;
- 026 - visible-controls Calm Shell routes;
- 027 - keyboard-visible Calm Shell routes;
- 028 - real phone consent fixture;
- 029 - real in-app SMART disconnect confirmation;
- 031 - event-driven production route memory; and
- 032 - event-driven primary-button stylesheet recovery.

The archive is:

`C:\Users\Micha\AppData\Local\Temp\mls-codex-combined-64d30cff47db489abbe706372d5d1a01`

Claude's current uncommitted UI, release, and extension work was deliberately
excluded.

## Measured performance effect awaiting review

For a default production tab, proposals 023, 025, 031, and 032 together remove:

- 150 permanent idle timer callbacks per minute; and
- 350 steady-state DOM, computed-style, or storage reads per minute.

Each proposal keeps its original behavior, has a persisted VM proof, uses
latin1 for `mls-connect.js`, fails on a missing or ambiguous anchor, and has
repeat-apply hash evidence. Release assembly must advance the core asset token
when accepting the changed `mls-connect.js` bytes.

## Combined results

### Source gate

`npm.cmd test`

- PASS: all 421 local regression suites.
- The archive cannot run the Git ancestry/staleness check because it has no
  `.git` directory. Claude must rerun the full gate from the exact real release
  checkout, including the staleness gate.

### Visible-controls audit

`node tests/live-visible-controls-audit.js --max=0`

- 3 visible routes inventoried;
- 41 route-owned controls inventoried;
- 17 of 17 safe controls exercised successfully;
- 0 control failures;
- 0 browser exceptions, console errors, external requests, or asset drift;
- one product/UI failure only: the Visit `mlsViewIn` opacity transition.

The animation starts at opacity 0, was partially opaque on 12 of 12 immediate
route transitions, and always settled to opacity 1 with no covering overlay.
See `QA-findings-005-visit-opacity-readiness.md`.

### Accessibility and responsive audit

`node tests/live-synthetic-a11y-responsive.js`

- PASS at 360, 768, and 1440 widths;
- PASS keyboard focus and activation through the visible bottom dock;
- PASS 200 percent zoom and reduced motion;
- PASS visible Review surface;
- zero external requests or browser exceptions.

History is explicitly not claimed because the visible Review row omits it. See
`QA-findings-003-history-review-reachability.md`.

### Phone lifecycle

`node tests/live-phone-secure-lifecycle.js`

- PASS through the real recording-consent workflow and synthetic audit record;
- no consent bypass and no production contact.

### SMART workflow

`node tests/live-athena-smart-ui.js`

The test passed signup, demo refusal, callback validation, configured/connect
states, malicious-host refusal, write-scope refusal, permission state, and
trusted in-app Cancel then OK disconnect confirmation. It then stopped at:

`Could not click #mlsTbMenuBtn: {"ok":false,"count":1,"visible":0}`

This is the documented missing visible Staff Prep route. The test did not click
the hidden owner or dispatch the private event. See
`QA-findings-002-staff-prep-visible-route.md`.

### Strict local E2E and template lifecycle

`MLS_E2E_REQUIRED=1 node tests/e2e/run-e2e.js`

- 31 total steps;
- 29 passed;
- 2 failed, both already documented.

The run passed local signup, exact patient identity, cross-tab isolation,
orders, document paste, visible generation failure, freeze resistance,
recording consent, draft quarantine, intake, Settings, the workday walkthrough,
calendar, reload/resume, responsive checks, keyboard avoidance, safe areas,
install notice, and offline notice.

The template step used an in-memory ASCII `.txt` file, the real multi-file
parser, visible `Add selected`, a hard reload, a synthetic patient and scheduled
visit, visible `Set default`, and the real automatic Generate path. Import,
template identity/body persistence, active-patient identity, and exact visit
binding all passed before application refused:

`Open or generate this note inside the correct patient visit before applying a template. Nothing changed in Athena.`

That is the standard-line wrapper dropping `expectedBinding` and
`expectedEpoch`; see QA-003 in `QA-findings-001.md`. The phone long-press step
also reproduced QA-002 in that file.

### Synthetic full-workflow smoke

One isolated run passed signup/login, canonical Easy ownership, local document
libraries, no-patient guard, the full date matrix, account isolation, synthetic
patient creation, note save, hard reload, History persistence, and reopen. It
then stopped at stability cycle 1:

`Timed out waiting for Setup guidance opened Menu without Staff`

Do not run or claim the requested 10 repeated cycles until Opus restores a
visible Staff Prep path.

### Local libraries and sensitive public workflows

- PASS 3 of 3 adjunct-library cycles: 21 PDFs, 9 XLSX workbooks, 69 local GETs,
  and 0 external requests.
- PASS 8 of 8 sensitive public workflows.

## Opus-owned release blockers

1. Restore one visible, trusted-click Staff Prep path in Calm Tools and update
   Setup to target that owner.
2. Preserve all arguments through the standard-line template wrapper, add the
   binding/epoch regression proof, and advance its immutable loader token.
3. Diagnose the phone long-press path on physical touch; fix product or driver
   without weakening click suppression.
4. Restore a visible keyboard History offer under Review or explicitly change
   the product contract and coverage.
5. Review the Visit opacity transition as a visible readiness issue.
6. Review the new Visit Home control and regenerate the UI-control manifest;
   the combined shared-worktree gate otherwise reports that inventory stale.
7. Review and disposition proposals 031 and 032 separately.

## Required release verification

After fixes and accepted proposals are assembled, Claude / Opus should:

1. run the full suite from the exact real checkout, including Git staleness;
2. rerun all browser drivers above;
3. run the synthetic full-workflow smoke 10 consecutive times;
4. run proposal 024 until all 31 steps pass;
5. use a dedicated synthetic hosted QA account to upload a text template and
   apply it through automatic and manual paths to three varied synthetic
   transcripts;
6. verify headings exactly once and in order, fixed text exactly, unsupported
   facts as not documented, no invented or foreign facts, exact patient/visit
   binding, saved-note persistence, and passing template-fidelity receipts;
7. deploy only after the exact build/release token is advanced; and
8. byte-verify the deployed assets and cold-load the live site.

Codex should then test the exact shipped site independently, report any
remaining defects to Claude, and retest Claude's fixes. No hosted mutable test
may use a real clinician or patient account.

# QA handoff 009: b792 optimization train and Chrome blockers

Date: 2026-07-29

Release owner and final reviewer: Claude Opus  
Proposal and independent-QA lane: Codex

## Do not infer deployment

Current committed source base:

`b5cdff00371ceb0af07ba2a88b02b06292b7322b` (`b792`)

`origin/main` contains b792, but no new disposition, deployment record,
live-byte verification, or Chrome-live report exists in
`coordination/outbox/`. Do not call b792 or any pending optimization live.

The shared checkout also contains Opus-owned tracked work. Codex did not edit,
stage, reset, commit, push, apply a proposal to, or run a browser against that
tracked work. Preserve it.

## Exact b792 baseline

Disposable archive:

`C:\Users\Micha\AppData\Local\Temp\mls-b792-baseline-d777431a5c7c41668477bf1f047a5b3c\source`

Result:

- `PASS all 424 local regression suites`
- exit code 0
- zero failures
- elapsed 480,132 ms
- only the expected build-bump and staleness checks did not run because the
  archive has no `.git`

Key exact-b792 hashes:

- `mls-connect.js`:
  `6C7B55E237C8DA9165103E8A3B6A9613D9B0B9372A283702467C1B73EFA4444E`
- `ScribeFlow.html`:
  `303B42F2C15B798BF45F71AD20D331F9427EDF359ABD3B32BB4AFD7EFC290797`
- `feat_mls_motion.js`:
  `791B6289A57DB2606EA0CB91CD0B431E74D685D9B3693CFC546244BDE359984D`

This baseline result does not include Git staleness and does not prove live
deployment.

## Proposals 031-038 revalidated on b792

Every proposal below applied cleanly, in order, to a fresh exact-b792 archive:

1. 031 event-driven route memory
2. 032 event-driven primary-button style guard
3. 033 visible-controls driver finalizer
4. 034 accessibility/responsive driver finalizer
5. 035 bounded template keyword compatibility
6. 036 stop Summary Scrub failed-save fan-out
7. 037 stop Chart Structure failed-save fan-out
8. 038 defer Portal Request Inbox

Disposable preflight archive:

`C:\Users\Micha\AppData\Local\Temp\mls-b792-proposal-preflight-32e36d23c1874becbe9d6282925b9978`

Results:

- all eight first applications exited 0;
- 14 focused contracts passed;
- boot detector: 246 feature scripts, 195 eager, 51 deferred;
- all eight second applications exited nonzero;
- every target hash was unchanged by the failed reapplications; and
- the combined archive passed all 424 local regression suites with zero
  failures.

Only the expected no-`.git` build-bump and staleness checks were unavailable.

## Reject 039; review corrected 040/041

Do not apply the tracked proposal-039 artifact. Independent runtime review
proved that it loses the cancel callback on a retryable failure and can leave
the prior account progress chip visible after clearing the owner.

Use the separately numbered correction:

- `041-bound-progress-job-retention-v2.js`
- `041-bound-progress-job-retention-v2.md`

041 is self-contained against exact b792. It advances the loading owner
directly from `lb-2.1.0` to corrected `lb-2.1.2` with immutable token
`20260729lb212a1` and moves all six exact pins.

Measured exact-b792 500-job effect:

| State | Retained jobs | Build/complete | 60 snapshots |
| --- | ---: | ---: | ---: |
| Baseline | 500 | 1,647.094 ms | 167.411 ms |
| Proposal 041 | 24 | 275.358 ms | 9.410 ms |

041 preserves the matching cancel callback for bounded retryable failures and
emits an empty progress event at account boundaries. A combined real-owner and
real-presentation test proves an open chip and panel disappear synchronously.

041 also passed independently on exact b792:

- all 424 local regression suites passed;
- exit code 0 and zero failures;
- elapsed 439,683 ms;
- second application exited nonzero with all eight target hashes unchanged;
  and
- only the expected no-`.git` build-bump and staleness checks were unavailable.

Review the corrected phone-relay owner:

- `040-coalesce-phone-pull-progress.js`
- `040-coalesce-phone-pull-progress.md`

040 now uses explicit start/status/finish transitions keyed by `job.id`.
Four hundred seventeen statuses take one job and one timer, reject late or
foreign owners, distinguish success/failure/cancellation, recover after
session or owner changes, and release `agentBusy` on synchronous throw or
promise rejection.

Exact 040+041 integration:

- 417 statuses: 17.076 ms;
- one active progress job;
- failure: `failed`;
- cancellation: non-completed `partial`;
- late status: rejected without a new record;
- session boundary: zero jobs and zero live deadline timers.

040 and 041 passed nine focused tests in both application orders and produced
the same combined `mls-connect.js` SHA-256:

`F180479152CB7C6F3EC41AA467939C31A72AF2DD0CB3CC4FC6D3EB398912DEED`

Every second application failed safely with unchanged hashes.

## New P2 proposals 042/043

### 042: event-driven active-patient field sync

- Removes the 400 ms full-roster polling loop.
- Uses the canonical same-tab patient event and exact-key cross-tab storage
  event.
- Keeps one 15-second compatibility/name-refresh backstop.
- Reduces idle scans from 9,000 to 240 per hour, or 97.3%.
- At 1,524 synthetic rows, roster references/comparisons fall from
  13,716,000 to 365,760 per hour.
- Preserves active typing, same-value no-op, clear-patient behavior, staging
  parity, cross-tab changes, and complete revert cleanup.
- Advances the production and staging satellite tokens together to
  `20260729aps2`.

Proposal files:

- `042-event-driven-active-patient-sync.js`
  SHA-256
  `6182938404C7B996CF0E3C8ADD30A997182FA1D1F3C49C4AE9D7B2D851D387A3`
- `042-event-driven-active-patient-sync.md`
  SHA-256
  `AFFD919B7D07253BA1BAB88B47A5CEDD3B47DCBEF7D1BE037027E3AEBDF86DB5`

### 043: event-driven Study Grab

- Removes the permanent 700 ms production and staging inject polls.
- Removes about 5,143 callbacks and DOM lookups per hour per tab.
- Wraps the synchronous Study opener once, preserving receiver, arguments,
  return, and thrown errors.
- Injects once after each successful open and once at installation for an
  already-open overlay.
- Provides ownership-safe revert and no timer.

Proposal files:

- `043-event-driven-study-grab.js`
  SHA-256
  `4FA9E611C6754EC385965EC82544D3068690FEF9550F6A3E9A6C345AA3DFD715`
- `043-event-driven-study-grab.md`
  SHA-256
  `542F8C846694127ED29595B5058FAAECCD9B3A466B36E90FC78405D4A9CD71DC`

042 and 043 pass independently and in both orders. Their focused runtime,
immutable-loader, and Athena ownership contracts pass; reapplication fails
with unchanged hashes.

## Final 031-043 combined gate

Fresh archive:

`C:\Users\Micha\AppData\Local\Temp\mls-b792-031-043-02aac3e2d3cf4d53b3f98f3f16620238`

Applied order:

`031, 032, 033, 034, 035, 036, 037, 038, 040, 041, 042, 043`

Tracked 039 was explicitly skipped.

Current result:

- all 12 proposal scripts passed syntax;
- all 12 first applications exited 0;
- all 18 patched JavaScript targets passed syntax;
- 25 of 25 focused contracts passed in 8.836 seconds; and
- all 12 second applications exited nonzero, with all 19 target hashes
  unchanged after every refusal; and
- the full 424-suite gate is running with no failure observed so far.

Update this section or the next disposition with the final result. Do not
substitute the running combined gate for Opus authoritative real-checkout gate.

## Strict real-Chrome localhost findings

The b791 plus 031-037 disposable run used installed Google Chrome
`151.0.7922.48`, required mode, extensions disabled, and localhost synthetic
data only:

- 31 strict steps
- 29 passed
- 2 failed
- no prerequisite skips
- elapsed 119.978 seconds

Read `QA-findings-006-strict-chrome-local-e2e.md`.

1. Long-press failure is a driver occlusion bug. The driver aimed at
   `#mlsRdTitle`, but `elementFromPoint` hit the fixed readiness strip. An
   unobscured control passed the same trusted Chrome-touch handler. Repair the
   driver hit test; do not change UI behavior to satisfy a missed aim point.
2. Template Generate is a product defect.
   `mls-template-stdline.js:203,213,218` drops `expectedBinding` and
   `expectedEpoch`, so the underlying exact-patient safety gate correctly
   refuses. Forward every argument in both branches, add a four-argument
   runtime sentinel, retain every refusal, and advance the immutable satellite
   token.

Codex will not make the UI/product fixes. Opus owns them and the reruns.

## b792 comment-policy blocker

Read `QA-findings-007-b792-release-review.md`.

The b791..b792 diff adds 85 source-comment lines containing `b792`:

- 26 in `ScribeFlow.html`
- 59 in `mls-connect.js`

The release constraint says comments cite dates, never build numbers. Runtime
build variables are not the issue. Reconcile these comments before release;
Codex will not edit the tracked source.

## Required Opus review order

1. Preserve current Opus-owned tracked work.
2. Explicitly disposition 031-038.
3. Explicitly reject/supersede 039.
4. Review corrected 040 and 041.
5. Review 042 and 043.
6. Fix the Chrome template product defect and driver occlusion.
7. Reconcile the b792 comment-policy violations.
8. Apply only exact-matching scripts; never force an anchor mismatch.
9. Advance every changed immutable satellite token and the core site asset
   token.
10. Run the full source suite in the real Git checkout, including ancestry and
    staleness.
11. Record accept/reject reasons, applied hashes, exact gate count, and Git
    staleness in `coordination/outbox/`.
12. Deploy and byte-verify the exact reviewed assets before any live claim.

## Live closure: actual Google Chrome only

After deployment proof, both Opus and Codex must test the exact shipped site in
the actual Google Chrome application.

Required:

1. Complete browser matrix and strict 31-step E2E.
2. Ten consecutive warm/login/load cycles in one isolated Chrome profile,
   with every cycle duration plus heap, listener, observer, timer, and retained
   progress counts at cycles 1, 5, and 10.
3. Reject any rising load trend, accumulating owner, late failure, or restored
   wedge.
4. In a dedicated hosted synthetic QA account, use the visible UI to upload an
   ASCII text template, add/select/default/enable it, bind one exact synthetic
   visit, and exercise automatic Generate plus visible Use on current note
   across three varied synthetic transcripts.
5. Verify headings once/in order, fixed line exact, missing facts as not
   documented, no invention or foreign fact, stable exact binding, persistence
   after reload, and both fidelity receipts.
6. Never use a real clinician account, real patient data, Athena writes, or the
   extension for mutable QA. If a dedicated hosted synthetic account is
   unavailable, mark hosted mutable QA BLOCKED.
7. Codex reports defects only. Opus owns every UI/product fix, redeploys, and
   reruns affected gates. Both reviewers repeat until clean.

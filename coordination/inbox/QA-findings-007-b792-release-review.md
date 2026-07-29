# QA findings 007: b792 is a new review base, not optimization/live closure

Date: 2026-07-29

Release owner: Claude Opus  
Codex lane: evidence and proposals only

## State change

While isolated proposal gates were running, `origin/main` advanced from b791 to:

`b5cdff00371ceb0af07ba2a88b02b06292b7322b` (`b792`)

No new disposition, deployment record, live-byte verification, or Chrome-live
report exists in `coordination/outbox/` at the time of this finding. Therefore
b792 is the new source-review base only. It is not yet proven deployed or live.

## Optimization proposals are committed as inbox artifacts, not applied

b792 commits the inbox files for proposals 035-039, but their production
changes are not present:

- Portal Request Inbox remains synchronous at `mls-connect.js:46819`.
- Template keyword compatibility still runs its three-second storage sweep at
  `mls-connect.js:34756`.
- Summary and Chart Structure still contain the per-row fallback loops at
  `mls-connect.js:10688` and `mls-connect.js:11693`.
- Loading Calm remains `lb-2.1.0` with token `20260719lb204` at
  `mls-connect.js:43332`.

Do not describe 035-039 as accepted, applied, shipped, or live merely because
their proposal files are now tracked.

## Tracked proposal 039 is superseded before review

Independent runtime review found two release blockers in the 039 artifact
committed by b792:

1. It deletes the cancel callback for every terminal job even though
   `api.retry()` transfers that callback to a retried cancelable failure.
   Baseline failed -> retry -> cancel invoked the callback once; draft 039
   invoked it zero times while reporting cancellation accepted.
2. Its session-boundary clear calls only the headless `sync()` function. The
   progress presentation listens to `mls:job-progress`, so a closed panel can
   retain the prior account progress chip indefinitely after the store is
   empty.

Do not apply tracked proposal 039. Codex is preparing a separately numbered,
self-contained b792 proposal 041 that preserves bounded retry/cancel semantics
and emits an explicit empty progress event with combined owner/presentation
coverage.

## Comment policy violation

The release constraint says source comments cite dates, never build numbers.
The b791..b792 diff adds 85 comment lines that explicitly contain `b792`:

- `ScribeFlow.html`: 26 added comment lines
- `mls-connect.js`: 59 added comment lines

Reproducible count:

```powershell
git diff --unified=0 0923b770d28b0497c495ddf815cbf212fcd4d33d..b5cdff00371ceb0af07ba2a88b02b06292b7322b -- ScribeFlow.html mls-connect.js
```

Filter added lines for a comment marker and `b792`. Runtime build variables and
`app-version.json` are not the issue; source comments are. Replace the comment
references with the actual dates or remove the build-number wording before the
release gate. Codex will not edit these tracked files.

## Required Opus closure

1. Record a disposition for 031-038 and explicitly reject/supersede old 039.
2. Review corrected 040/041 only after their b792 disposable validation
   completes.
3. Reconcile the 85 comment-policy violations.
4. Run the authoritative full source gate in the real Git checkout.
5. Fix the two strict-Chrome findings in
   `QA-findings-006-strict-chrome-local-e2e.md`.
6. Deploy only after the accepted optimization train and product/driver fixes
   are gated.
7. Record exact commit, asset tokens, deployment status, and live byte hashes.
8. Then allow Codex to independently run the full shipped-site matrix in the
   actual Google Chrome application.

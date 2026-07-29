# 040 - Coalesce phone-pull progress by request

Date: 2026-07-29

This proposal is self-contained against exact release baseline `b792`
(`b5cdff00371ceb0af07ba2a88b02b06292b7322b`).

## Measured problem

The exact baseline turns every phone-pull status into a new manual progress
job:

- `mls-connect.js:45442-45449` maps `lb(true, label)` to
  `__mlsLoadingCalm.begin(label)`.
- `mls-connect.js:45503-45507` invokes that helper from every `onStatus`
  callback.
- `mls-connect.js:45614` invokes it once more when the relay request starts.
- `mls-connect.js:45618` invokes `lb(false)` only once at the end.
- `feat_mls_loading_calm.js:197-198` gives each `begin()` a unique key and
  90-second deadline, while one `end()` closes only one id.

A source-extracted exact-owner probe sent 417 synthetic status messages through
this path. Status handling took 630.668 ms; the one final `end()` left 416
active jobs and 416 deadline timers. Firing those synthetic deadlines caused a
1,382.180 ms callback burst, after which all 417 terminal records remained in
the same-document job store. No real patient data was used.

The exact agent settlement also ties `agentBusy` to result transport at
`mls-connect.js:45618-45620`. A result POST that never settles prevents every
later agent poll, and a synchronous runner throw or rejected runner promise
never reaches that release.

## Proposed change

- Replace the boolean helper with request-owned `start`, `status`, and `finish`
  transitions keyed by the existing relay `job.id`.
- Allocate one modern shared-progress handle with a fixed relay key and a
  ten-minute deadline. All later statuses update that handle.
- Preserve one-call legacy `begin()` and exact-id `end()` compatibility without
  allocating per status.
- If the loading owner is not ready or its first `start()` throws, retain only
  the request state and retry attachment on the next status or finish.
- If the loading satellite replaces its API while a request runs, discard the
  stale handle, attach the current owner, and terminalize the current owner
  even when no status arrived after the swap.
- Promise-normalize relay execution. A synchronous throw, rejected promise,
  strict failed result, or strict successful result settles progress once and
  releases `agentBusy`.
- Release `agentBusy` before starting result transport. Apply the same ordering
  to unsupported relay kinds, so a stalled result POST cannot wedge later
  polls.
- Add source-extracted runtime coverage for 417 statuses, synchronous status
  ordering, stale and late callbacks, success, strict failure, promise
  rejection, synchronous throw, stalled result transport, unsupported kinds,
  loading-owner replacement, and first-start retry.

The ten-minute progress deadline is deliberate. The real full-history relay has
a 510,000 ms execution ceiling at `mls-connect.js:45535`, leaving a 90-second
progress margin.

This bounded revision deliberately does not claim to change phone cancellation,
account-session boundaries, relay revert, or an Athena operation already in
flight. Those lifecycles need a separate execution-generation design and
canonical server-cancellation signal; coupling them to this timer-coalescing
change would make the proposal less safe.

The patch reads and writes byte-sensitive `mls-connect.js` with `latin1` and
the test with UTF-8. It validates both complete file plans and every
single-occurrence anchor before either write.

## Expected effect

A pull with 417 statuses creates one progress job and one deadline rather than
418 jobs and deadlines. Every current-owner status updates that one receipt,
and a late status cannot allocate a new job after finish.

Runner success and failure settle that receipt once. Synchronous throws and
promise rejections no longer leave the desktop agent busy forever. Result
transport begins only after the runner lane is released, including the
unsupported-kind refusal path.

## Risks

- Status arriving before explicit request start is ignored. The exact call
  order starts progress immediately before invoking the runner.
- Phone cancellation, session-boundary invalidation, and relay revert behavior
  are unchanged. This proposal must not be used as evidence that those
  lifecycles are solved.
- If a modern loading owner violates its public contract by allocating a job
  but returning no handle, attachment retries can ask it to start again. Exact
  b792 returns a handle.
- A replaced loading owner is never called after the replacement is observed.
  Its own version-aware revert remains responsible for clearing its old state.
- A legacy loading owner has only untyped `begin/end`; every outcome closes the
  one id it opened. Exact b792 ships the modern typed owner.
- Result transport remains fire-and-forget and is not retried here.
  `executedJobs[job.id]` still prevents duplicate runner execution if the
  server re-hands an id while its result request is pending.

## Dependencies and order

Proposal 040 is independently applicable to exact `b792`. It touches the relay
module near `mls-connect.js:45442`. Proposal 041 touches the loading satellite
loader near line 43332; either may be applied first.

No satellite bytes change in 040, so no immutable satellite token moves.
Because `mls-connect.js` bytes change, release assembly must advance the core
site asset token as usual.

## Verification

Disposable exact-b792 gate:

1. `node --check coordination/inbox/040-coalesce-phone-pull-progress.js`
2. Apply once to a fresh exact-b792 archive.
3. `node --check mls-connect.js`
4. `node tests/pull-request-correlation-contract.test.js`
5. `node tests/shared-progress-runtime.test.js`
6. `node tests/progress-stages-runtime.test.js`
7. Reapply and require nonzero exit with unchanged target hashes.
8. Apply proposals 040 and 041 in both orders in separate exact-b792 archives
   and repeat the combined focused gate.

The standalone exact-b792 disposable gate completed on 2026-07-29:

- all 424 local regression suites passed;
- the archive-only repository staleness check skipped as expected because a
  release archive has no `.git` directory;
- patched `mls-connect.js` SHA-256:
  `F44B0974A172A0E368AD1BC5CE0A79D85442762242E8ACA3932DEA8B86E874B0`;
- patched `tests/pull-request-correlation-contract.test.js` SHA-256:
  `E4372598E6D93C468FB5016D51543FDB930E1D219E7CFAE8853932BE5C4BC502`;
- a second application exited nonzero at the first missing source anchor and
  left both hashes unchanged.

The two-order 040/041 combination remains a release-owner gate; this standalone
validation does not claim that separate result.

Required real-Chrome checks after Claude reviews, deploys, and authorizes live
verification:

1. Use synthetic data only.
2. Run a phone-requested full-history pull large enough to sustain progress.
3. Confirm the current status advances while the shared snapshot contains one
   active `relay_pull` job.
4. Confirm strict success creates one completed receipt and strict failure
   creates one failed receipt.
5. Simulate a runner rejection and a stalled result request; confirm the next
   queued request starts on the following agent poll.
6. Repeat ten pulls without reloading. Record load/reveal time, heap, listener
   count, timer count, and progress snapshot time after pulls 1, 5, and 10.
   Treat any monotonic upward trend as a release blocker.

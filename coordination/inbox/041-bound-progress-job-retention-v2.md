# 041 - Bound progress retention with retry and session safety

Date: 2026-07-29

Supersedes rejected proposal 039. This proposal is self-contained against exact
release baseline `b792` (`b5cdff00371ceb0af07ba2a88b02b06292b7322b`).

## Measured problem

The exact baseline caps only the session-storage refresh copy of the shared
progress store:

- `feat_mls_loading_calm.js:28` creates live `jobs`, `retryFns`, and
  `cancelFns` maps.
- `feat_mls_loading_calm.js:48-50` clones and sorts every live job in
  `publicJobs()`.
- `feat_mls_loading_calm.js:60-64` limits the persisted copy, but terminal jobs
  and closures remain in the live maps.
- `feat_mls_loading_calm.js:76-96` terminalizes without evicting metadata or
  callbacks.
- `feat_mls_progress_stages.js:531` snapshots the complete live map on every
  render; an open active panel repeats that work every second at line 627.

A reproducible source-extracted VM probe on exact `b792` created and completed
500 synthetic jobs, then ran 60 snapshots:

| Created | Retained live | Build and complete | 60 snapshots | Persisted |
| ---: | ---: | ---: | ---: | ---: |
| 500 | 500 | 1,647.094 ms | 167.411 ms | 12 jobs / 6,901 bytes |

The storage cap therefore does not bound live work. Each state change clones
and sorts the growing map, so job creation becomes progressively more
expensive during a long same-document session.

Callback retention is material for Templates:

- `feat_mls_template_library.js:160` captures an import-preview object.
- `feat_mls_template_library.js:201` captures a complete template snapshot.
- `feat_mls_template_library.js:229` captures the uploaded `File` array.

In the prior forced-GC probe, 64 completed retry callbacks each capturing one
synthetic 1 MB buffer retained 64 MB, and `api.retry(completedId)` still invoked
the completed callback. Exact `b792` retains the same owner implementation.
No real patient data was used.

The owner also survives same-document logout/login. It does not subscribe to
`mls:session-boundary`, so maps, callbacks, and deadlines cross account
boundaries. Presentation cannot safely rely on polling: `sync()` at
`feat_mls_loading_calm.js:140-144` only retires legacy nodes, and
`feat_mls_progress_stages.js:625-628` ticks only while its panel is open. A
closed chip can otherwise keep showing the prior account until another job
event arrives.

## Proposed change

- Keep every active job and at most 24 recent terminal jobs in live memory.
- Evict older terminal metadata, deadline ids, manual-stack entries, and both
  callback maps together.
- Release retry and cancel closures immediately for completed, canceled, and
  otherwise non-retryable terminal jobs.
- Preserve the retry closure and its matching cancel closure only for bounded
  recent failed, partial, and timed-out jobs. `api.retry()` needs that cancel
  callback when it constructs the new cancelable attempt.
- Clear all jobs, closures, deadlines, manual ids, and persisted progress on
  the canonical same-document session boundary.
- Emit one `mls:job-progress` event with `null` detail after the clear. The
  existing presentation listener ignores detail and synchronously snapshots
  the now-empty owner; the patient-merge listener already ignores a missing
  job.
- Add a combined real-owner plus real-presentation regression proving an open
  chip and panel both disappear in the same boundary event turn.
- Expose the terminal retention number for diagnostics and regression tests.
- Advance the satellite directly from `lb-2.1.0` to corrected `lb-2.1.2`, with
  new immutable token `20260729lb212a1`. This distinct identity prevents the
  rejected 039 bytes from being mistaken for the corrected asset.
- Move every exact b792 loader/version/token pin:
  `mls-connect.js:43332`,
  `tests/immutable-satellite-loader-cache-contract.test.js:27`,
  `tests/progress-stages-runtime.test.js:289-291`,
  `tests/site-audit-regressions.test.js:43-44`,
  `tests/same-tab-owner-upgrade-runtime.test.js:328`, and
  `tests/template-library-runtime.test.js:324-326`.

The patch script reads and writes byte-sensitive `mls-connect.js` with
`latin1`; the satellite and tests use UTF-8. It prepares and validates every
target and unique anchor before performing the first write.

## Expected effect

Live snapshot and render cost becomes bounded by active work plus 24 terminal
receipts instead of all jobs created since load. Completed template work no
longer retains uploaded files or historical snapshots through dead retry
closures. A retryable failure still carries its cancellation behavior into the
new attempt.

Repeated same-document login starts from empty job, callback, timer, storage,
chip, and panel state. The 500-job baseline probe should retain 24 terminal
receipts rather than 500 and keep snapshot cost bounded.

The same probe after applying 041 in a disposable exact-b792 archive measured
24 retained jobs, 275.358 ms to build and complete 500 jobs, and 9.410 ms for
60 snapshots. Against the baseline run, that is an 83% reduction in job-build
time and a 94% reduction in repeated snapshot time for this workload.

## Risks

- Handles to evicted old terminal jobs return `null` from `get()`/`snapshot()`
  and cannot retry. The newest 24 receipts and every active job remain.
- Completed and deliberately canceled jobs cannot retry. Those are not valid
  recovery states and retaining their closures caused the measured leak.
- A bounded retryable failure intentionally keeps both retry and cancel
  closures until eviction. The regression retries a failed cancelable job and
  exercises its cancel callback to prevent silent cancellation loss.
- An account boundary clears visible in-flight progress. Work from the prior
  account must not continue to own state in the next session.
- The asset version, token, loader, and all pins must ship together.

## Dependencies and order

Do not apply proposal 039. Proposal 041 fully supersedes it and must be applied
to exact `b792`.

Proposal 041 touches the loading-satellite loader near
`mls-connect.js:43332`; proposal 040 touches the relay module near line 45442.
Their production anchors are independent, so either corrected proposal may be
applied first.

Because `feat_mls_loading_calm.js` bytes change, the reviewer must ship
`20260729lb212a1`. Because `mls-connect.js` bytes change, release assembly must
advance the core site asset token as usual.

## Verification

Focused disposable-archive gate:

1. `node --check coordination/inbox/041-bound-progress-job-retention-v2.js`
2. Apply once to exact `b792`.
3. `node --check feat_mls_loading_calm.js`
4. `node --check mls-connect.js`
5. `node tests/shared-progress-runtime.test.js`
6. `node tests/progress-stages-runtime.test.js`
7. `node tests/immutable-satellite-loader-cache-contract.test.js`
8. `node tests/site-audit-regressions.test.js`
9. `node tests/same-tab-owner-upgrade-runtime.test.js`
10. `node tests/template-library-runtime.test.js`
11. `node tests/calm-clinician-surface-contract.test.js`
12. Reapply and require nonzero exit with unchanged target hashes.

Required real-Chrome long-session checks after Claude reviews, deploys, and
authorizes live verification:

1. Use synthetic data only.
2. Complete at least 30 template preview/save/upload jobs and confirm the live
   snapshot retains no more than 24 terminal jobs.
3. Finish several synthetic file uploads, release page references, force
   DevTools garbage collection, and confirm retained `File`/Blob memory does
   not climb.
4. Retry a recent intentional failure, cancel that retry, and confirm the real
   underlying cancellation action runs.
5. Run ten same-document logout/login cycles. Confirm each boundary
   synchronously clears jobs, deadlines, chip, and panel.
6. Record load/reveal time, heap, listener count, timer count, and snapshot
   time on cycles 1, 5, and 10. Treat an upward trend as a release blocker.

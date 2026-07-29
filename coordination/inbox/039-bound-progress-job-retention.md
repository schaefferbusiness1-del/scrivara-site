# 039 - Bound progress-job and retry-closure retention

Date: 2026-07-29

## Measured problem

The exact committed candidate at `0923b770` caps only the refresh copy of the
shared progress store:

- `feat_mls_loading_calm.js:28` creates live `jobs`, `retryFns`, and
  `cancelFns` maps.
- `feat_mls_loading_calm.js:48-50` clones and sorts every live job in
  `publicJobs()`.
- `feat_mls_loading_calm.js:60-64` persists only a bounded subset, but never
  removes the other entries from the live maps.
- `feat_mls_loading_calm.js:76-96` terminalizes a job without evicting its
  metadata or callback closures.
- `feat_mls_progress_stages.js:531` snapshots the complete live map on every
  progress render; while an active panel is open, line 627 repeats that work
  every second.

A source-extracted VM probe created and completed synthetic jobs, then ran 60
snapshots:

| Terminal jobs | Retained live | Build and complete | 60 snapshots |
| ---: | ---: | ---: | ---: |
| 100 | 100 | 81.460 ms | 30.363 ms |
| 500 | 500 | 1,553.399 ms | 148.838 ms |
| 1,000 | 1,000 | 6,547.518 ms | 328.039 ms |
| 2,000 | 2,000 | 26,887.836 ms | 783.832 ms |

The persisted payload stayed near 6.9 KB and 12 jobs. That proves the existing
cap is persistence-only; live creation becomes quadratic because every state
change clones and sorts the entire accumulated map.

The callback retention is material for Templates:

- `feat_mls_template_library.js:160` captures an import-preview object.
- `feat_mls_template_library.js:201` captures a complete template snapshot.
- `feat_mls_template_library.js:229` captures the uploaded `File` array, whose
  allowed inputs can be large.

In a forced-GC probe, 64 completed retryable jobs whose callbacks each captured
one synthetic 1 MB buffer retained exactly 64 MB of array-buffer memory.
`api.retry(completedId)` still invoked the completed job's callback, while
session storage retained only 12 jobs.

This owner also survives same-document logout/login and does not currently
subscribe to `mls:session-boundary`, so the live maps grow across repeated
login cycles even though the UI bundle is not reloaded.

## Proposed change

- Keep every active job and at most 24 recent terminal jobs in live memory.
- Evict older terminal metadata, deadline ids, manual-stack entries, and retry
  or cancel closures together.
- Release retry and cancel closures immediately on completed or canceled jobs.
- Preserve retry closures for the bounded recent failed, partial, and timed-out
  jobs.
- Clear active jobs, terminal history, callbacks, deadlines, and the progress
  session snapshot on the canonical same-document session boundary.
- Expose the terminal retention number for diagnostics and regression tests.
- Advance the satellite from `lb-2.1.0` to `lb-2.1.1` and advance its immutable
  loader token from `20260719lb204` to `20260729lb211a1`.
- Move every exact loader/version/token pin with the asset:
  `mls-connect.js:43320`,
  `tests/immutable-satellite-loader-cache-contract.test.js:27`,
  `tests/progress-stages-runtime.test.js:289-291`,
  `tests/site-audit-regressions.test.js:43-44`,
  `tests/same-tab-owner-upgrade-runtime.test.js:328`, and
  `tests/template-library-runtime.test.js:324-326`.

The patch script reads and writes `mls-connect.js` with `latin1`; the satellite
and tests use UTF-8. It validates every target and every unique anchor before
performing any write.

## Expected effect

Live progress snapshot/render cost becomes bounded by active jobs plus 24
recent terminal receipts instead of total jobs created since page load.
Completed template uploads and saves no longer retain their `File` objects or
historical template snapshots through dead retry closures. Repeated
same-document login starts with an empty progress owner instead of inheriting
the previous session's job maps and timers.

For the 2,000-job synthetic state, the existing 60-snapshot cost was
783.832 ms. After this change the terminal portion is capped at 24, so the same
idle render work is bounded rather than continuing to rise.

## Risks

- Code holding a handle to an evicted old terminal job receives `null` from
  `get()`/`snapshot()` and cannot retry it. The 24 newest terminal receipts
  remain available, and all active jobs remain untouched.
- A completed or canceled job can no longer be retried through its old handle.
  Retrying successful or deliberately canceled work was the source of the
  retained closure and is not a valid recovery path.
- A same-document account boundary clears in-flight progress state. The shell
  emits that boundary before revealing the next session; clinical work from
  the previous session must not continue to own visible progress in the next.
- The asset version and immutable token must ship together. Applying only the
  satellite bytes without the loader and pin moves would allow stale caching
  or prevent a same-tab owner upgrade.

## Dependencies and order

This proposal is independently applicable to exact `0923b770`. It touches a
different production region from proposals 031-037 and from proposal 040.
Either 039 or 040 may be applied first.

Because `feat_mls_loading_calm.js` bytes change, the reviewer must ship the new
`20260729lb211a1` satellite URL. Because `mls-connect.js` bytes also change,
release assembly must advance the core site asset token as usual.

## Verification

Focused disposable-checkout gate:

1. `node --check coordination/inbox/039-bound-progress-job-retention.js`
2. Apply once to an exact `0923b770` archive.
3. `node --check feat_mls_loading_calm.js`
4. `node --check mls-connect.js`
5. `node tests/shared-progress-runtime.test.js`
6. `node tests/progress-stages-runtime.test.js`
7. `node tests/immutable-satellite-loader-cache-contract.test.js`
8. `node tests/site-audit-regressions.test.js`
9. `node tests/same-tab-owner-upgrade-runtime.test.js`
10. `node tests/template-library-runtime.test.js`
11. Apply the proposal a second time and confirm nonzero exit with unchanged
    target hashes.

Required real-Chrome long-session checks after review and deployment:

1. Use synthetic data only.
2. Complete at least 30 template preview/save/upload progress jobs and confirm
   the live progress snapshot never retains more than 24 terminal jobs.
3. Upload several synthetic files, finish the jobs, release page references,
   force Chrome garbage collection through DevTools, and confirm retained
   `File`/Blob memory does not climb once completed jobs leave the active set.
4. Run ten same-document logout/login cycles and confirm each session boundary
   clears progress jobs and deadline timers.
5. Keep one real synthetic progress job active during the observation window
   and confirm active progress remains visible and retry remains available for
   a recent forced failure.
6. Record load/reveal time, heap, listener count, timer count, and progress
   snapshot time on cycles 1, 5, and 10; treat an upward trend as a release
   blocker.

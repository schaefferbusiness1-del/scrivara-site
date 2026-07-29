# P0: batch the two remaining summary scrub writers

## Measured problem

The v2 retroactive sanitizer already batches a dirty sweep into one
`savePatients(ps)`, but two older automatic scrub paths still call
`upsertPatient(p)` once per repaired row:

- Continuous Scrub at `mls-connect.js:10572-10606`, with the per-row write at
  `mls-connect.js:10594`.
- The base sanitizer startup scrub at `mls-connect.js:11553-11576`, with the
  per-row write at `mls-connect.js:11565`.

Exact isolated-module probes with eight generated dirty summaries produced
eight `upsertPatient` calls from each module. In the full app, each distinct
upsert reaches a synchronous full-store patient encode/save. The real
`_mlsPtsEncode` path measured 3.55, 2.52, and 2.66 seconds on repeated runs of
a synthetic 1,524-row, 3.07 MB store. Eight repairs can therefore occupy the
main thread for roughly 21 seconds; larger dirty sets can reach minutes.

Continuous Scrub also records `lastScrubVer` before checking whether a pull is
active. A stood-down implementation must check pull ownership first or it can
mark a busy version clean and skip it later.

Reproducible probes:

```text
rg -n "CONTINUOUS SUMMARY SCRUB|function scrubExisting|upsertPatient\\(p\\)" mls-connect.js
node tests/patient-scale-perf-contract.test.js
node tests/pull-panel-calm-under-fire.test.js
```

Only generated records and summaries were used.

## Proposed change

For both remaining scrub paths:

- Stand down when `__mlsPullBusyAt` is fresh or the managed day-history pull is
  running. Continuous Scrub checks this before reading or stamping its store
  version; the base scrub remains uncompleted and retries on its existing
  timer.
- Mutate matching in-memory rows, stamp `updated`, and collect them in `dirty`.
- Persist the full array once with `savePatients(ps)`.
- Preserve the old hosted best-effort behavior by mirroring each dirty row with
  `syncPatientToServer` only after that local batch succeeds.
- If the batch API is unavailable or throws, fall back to the old
  `upsertPatient` owner for each dirty row and return without a second server
  mirror. Continuous Scrub clears its optimistic version stamp, and the base
  scrub remains unretired, so either path retries if fallback persistence also
  fails.

Contracts now slice both exact modules, require one batch attempt plus the
per-row failure fallback, and prove both pull-busy gates precede roster/version
work. Runtime VM probes execute successful, throwing, and unavailable batch
paths for both scrubbers: success must produce `save/sync/upsert = 1/8/0`;
failure must produce `1/0/8` or `0/0/8`, record no false success, and remain
retryable.

`mls-connect.js` is read and written as `latin1`; tests remain UTF-8. Every
edit is an explicit single-occurrence replacement with ambiguity failure. No
satellite bytes or cache token change.

## Expected effect

For `k` repaired summaries, reduce synchronous full-store persistence from
`k` encodes/writes to one. On the measured synthetic large store, eight dirty
rows move from about 21 seconds of repeated compression to one approximately
2.5-3.6 second save, and automatic scrubs no longer compete with an active
pull.

## Risks and release checks

- One large save remains synchronous; this proposal removes the multiplicative
  wedge but does not make the base store encoder asynchronous.
- Direct batch save must retain account/proof/store guards and server mirrors.
  Verify exact-patient proof fields, visits, and unrelated rows before and
  after an eight-row synthetic scrub.
- Force `savePatients` to throw and to be absent; verify each dirty row uses
  `upsertPatient`, receives no duplicate explicit mirror, and the scrub retries
  if those fallbacks do not advance the store.
- Verify a fresh pull causes zero scrub saves and does not advance
  `lastScrubVer`; clearing the pull must allow one batch on the next tick.
- Run the two updated contracts, sanitizer/chart-ingest contracts, the full
  gate, and a synthetic large-store timing run.

No tracked source, Git state, browser, extension, or live-site state was changed
by Codex.

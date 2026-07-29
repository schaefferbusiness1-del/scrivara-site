# P0 proposal: isolate Chart Structure and stop failed-save fan-out

Date: 2026-07-29

## Measured problem

The exact b791 `looksLikeChartDump` and structuring regex path is linear:

- a synthetic roster with 1,524 patients, 2,912 visits, 4,298,112 raw visit
  bytes, and 297,060 summary bytes scanned in 101.002 ms;
- an unchanged-version repeat took 0.013 ms and performed no roster reads; and
- five dense-hit passes over 21,498,435 bytes took 1,239.576 ms total,
  excluding persistence.

The conditional P0 cost starts at `mls-connect.js:8322-8328`. If the one outer
`savePatients(ps)` call throws, `persistSweep` calls the local `upsert` once for
every dirty patient. `ScribeFlow.html:9403-9427` shows each save serializes and
compresses the whole roster; `ScribeFlow.html:9548-9607` shows each upsert
normally performs that whole-store save again.

The exact production encoder averaged 1,361.656 ms after warmup on a synthetic
1,524-row, 2,936,251-byte roster. That makes 32 fallback writes about 43.6
seconds and 417 fallback writes about 568 seconds, or 9.5 minutes.

There is also a retry-integrity requirement:

- the early store cache at `mls-connect.js:395-417` returns fresh top-level
  arrays whose patient objects are shared aliases;
- Chart Structure mutates those objects before its outer save; and
- `addStructuredVisits` re-adopts a visit array from the cached patient.

Simply suppressing the row fallbacks would therefore leave the cache looking
structured after a failed save. A later heartbeat could skip the unsaved work.

Deep-clone cost was measured separately with 417 synthetic patient rows and
4,737,068 JSON bytes. Ten complete per-row clone passes averaged 8.410 ms and
the slowest pass was 11.784 ms. This bounded isolation cost is less than one
percent of a single measured full-roster compression.

## Proposed change

- Deep-clone each automatic or manual sweep candidate before mutation. If JSON
  cloning fails, skip that row instead of falling back to a shallow alias.
- During deferred visit adoption, snapshot the cached source visit array,
  clone the enriched visit array onto the candidate, and restore the cached
  source in `finally`. A failed outer save leaves the cached row byte-equivalent.
- Make the local compatibility `upsert` and `persistSweep` return booleans.
- Preserve per-row fallback only when `savePatients` is absent. Stop after the
  first failed compatibility upsert.
- If an existing batch writer throws, perform zero row upserts and zero server
  mirrors, settle `lastSweepVer` on the post-failure version, and return false.
- Automatic and manual callers suppress success logs, renders, counts, and
  structured diagnostics when persistence returns false.
- Count `sweepPasses` only after a clean or successfully persisted pass.
- Add runtime proofs for batch success, batch throw, missing API compatibility,
  first-fallback failure, deep nested visit isolation, and post-failure gating.

The patch reads and writes `mls-connect.js` with `latin1`. It changes no visible
UI and no extension file.

## Expected effect

A 417-patient Chart Structure sweep whose batch save fails falls from one
failed full-roster encode plus up to 417 more full-roster encodes to one failed
encode. The removed measured compression work is about 568 seconds.

The added deep isolation averaged 8.410 ms for a larger 4.74 MB synthetic
candidate set. Successful clinical structuring, server mirrors, timestamps,
and the cold-install compatibility path remain intact.

An unchanged store cannot trigger another failed compression every three
seconds. A later store-version change or explicit `restructureAll()` can make
one new attempt.

## Risks

- JSON cloning assumes patient rows are JSON data. That is already required by
  `savePatients`, which serializes the same rows. A non-serializable row is
  skipped instead of being mutated through a cache alias.
- The visit-model isolation restores only the cached `visits` field because
  `addVisit(..., {persist:false})` mutates that field and performs no upsert.
  Opus should rerun the visit-model contracts in the full gate.
- A transient batch exception no longer receives immediate row-by-row retries.
  Those retries repeat the same whole-store operation and are the measured
  wedge. A later store change or manual call remains retryable.
- The early version counter covers all local-storage writes. An unrelated
  later write can permit one new batch attempt, but never one per dirty row.
- This removes the exact multiplier. It does not claim storage quota is the
  live cause until a live trace reports the batch exception.

## Reviewer checks

1. Apply independently to exact b791, or after proposal 036. The touched test
   regions and production anchors are disjoint.
2. Advance the core `mls-connect.js` release/site asset token if accepted; no
   immutable satellite bytes change.
3. Run `node tests/patient-scale-perf-contract.test.js`.
4. Run the complete local regression gate, including visit-model tests.
5. In real Google Chrome with synthetic data only, force the Chart Structure
   batch save to throw. Confirm one batch attempt, zero row fallbacks, no
   completion render, an unchanged cached patient, and a responsive tab.
6. Keep the version unchanged for two 3-second heartbeats, then change the
   synthetic store. Confirm zero same-version retries and one later retry.
7. Apply this script a second time and confirm it exits nonzero without
   changing either target file.

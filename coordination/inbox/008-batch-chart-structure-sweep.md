# P0: batch Chart Structure sweep persistence

## Measured problem

`looksLikeChartDump` itself is linear: generated multiline inputs at 100, 200,
400, and 800 KB measured 2.47, 4.65, 9.30, and 21.6 ms. A generated
1,524-patient / 2,912-visit / 4.96 MB roster scan measured about 126 ms, so its
classification logic does not warrant a speculative rewrite.

The persistence path is the remaining wedge. `sweepPatient` calls
`upsert(p)` at `mls-connect.js:8283`, and both the automatic sweep
(`mls-connect.js:8286-8307`) and public `restructureAll`
(`mls-connect.js:8335-8339`) invoke it once per repaired patient. An exact
module probe produced 1, 8, and 32 upserts for 1, 8, and 32 generated chart
dumps.

The production patient encoder measured 2.52-3.55 seconds per distinct save on
a generated 1,524-row / 3.07 MB store. Eight structured rows can therefore
cause about 20 seconds of repeated compression; dozens can cause a multi-minute
main-thread lock.

## Proposed change

- Let `sweepPatient(p, deferPersist)` retain its existing one-row behavior for
  non-batch callers while suppressing the inner upsert for the two outer
  all-patient callers.
- Add `persistSweep(ps, dirty)`: stamp all dirty rows once, perform one
  `savePatients(ps)`, then preserve per-row server mirrors. If the batch save is
  unavailable or throws, fall back to the old per-row upserts.
- Collect dirty rows and call that helper once in both automatic `sweep()` and
  manual `restructureAll()`.
- Restore each unchanged row's prior `_mlsStructuredV1` marker before the outer
  array is saved, so batching does not persist the manual force-scan marker on
  records the old per-row path would not have written.
- Stand down during an active pull before reading or stamping
  `STATS.lastSweepVer`.

The actual transformed Chart Structure module was exercised in memory with the
real `feat_visits.js`: eight generated multi-section chart dumps, each with two
dated encounters, produced one local save, zero per-row upserts, and eight
server mirrors. Every record retained problems, medications,
`_mlsStructuredV1`, proof sentinels, and both normalized visits. With a fresh
pull marker, the real timer callback produced zero saves, left `sweepPasses` at
zero, and did not set `lastSweepVer`; clearing the marker allowed one batch.

The updated patient-scale contract pins both callers to deferred persistence,
requires one normal-path save helper, verifies busy-gate ordering, and executes
the live helper against eight generated records while checking save/upsert/
mirror counts and field preservation. It also forces a throwing and an absent
batch API; each must produce eight fallback upserts and zero explicit mirrors.

`mls-connect.js` is read and written as `latin1`; the test remains UTF-8. Every
edit is an explicit single-occurrence replacement with ambiguity failure. No
satellite bytes or cache token change.

## Expected effect

For `k` chart repairs, reduce the dominant synchronous persistence cost from
`k` full-store encodes/writes to one, without changing the already-linear
classification and field-routing behavior.

## Risks and release checks

- This path mutates clinical summaries, fields, insurance, and visit arrays.
  The fallback preserves old persistence when batch saving is unavailable, but
  acceptance requires exact field/proof/visit regression checks.
- `persist:false` on the current real visit model is honored; confirm the
  cycle-guard still forwards all arguments before shipping.
- Run `node tests/patient-scale-perf-contract.test.js`,
  `node tests/visit-shell-merge-alias-survival.test.js`, chart/history/visit
  contracts, the full gate, and the eight-record synthetic module probe.
- Verify active pull ownership causes no sweep work and no version stamp, then
  one batch runs after ownership clears.

No tracked source, Git state, browser, extension, or live-site state was changed
by Codex.

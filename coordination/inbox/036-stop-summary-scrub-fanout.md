# P0 proposal: stop summary scrub batch failures from fanning out

Date: 2026-07-29

## Measured problem

The exact b791 summary regexes are linear. Across a fully synthetic roster of
1,524 patients and 297,060 summary bytes, the sanitizer core took 1.198 ms for
clean text and 2.588 ms for 417 dirty summaries, excluding persistence.

The remaining conditional P0 cost is persistence:

- `mls-connect.js:10682-10694` makes one Continuous Summary Scrub batch save,
  but if it throws the code calls `upsertPatient` for every dirty row.
- `mls-connect.js:11685-11697` repeats the same behavior in the base startup
  scrub.
- `ScribeFlow.html:9403-9427` shows that one `savePatients` call serializes and
  compresses the entire roster before writing. A persistent quota refusal
  clears the identical-content memo and throws.
- `ScribeFlow.html:9548-9607` shows that each fallback `upsertPatient` normally
  reads and saves the entire roster again.

A source-extracted runtime probe with eight synthetic dirty rows records one
throwing batch call followed by eight per-row upserts in each scrubber. The
fallback count is exactly the dirty-row count.

The exact production encoder was measured with a synthetic 1,524-row,
2,936,251-byte JSON roster:

- first encode: 1,665.285 ms;
- next three encodes: 1,361.656 ms average;
- 32 fallback encodes: about 43.6 seconds; and
- 417 fallback encodes: about 568 seconds, or 9.5 minutes.

This is conditional: a live quota exception has not yet been correlated with
the wedge. It is nevertheless an exact automatic path whose measured cost
matches a finite minutes-long main-thread lock.

## Proposed change

- Distinguish a missing `savePatients` API from an existing API that throws.
- Preserve the per-row compatibility fallback only while the batch API is
  genuinely absent during cold installation.
- If an existing batch writer throws, perform zero per-row upserts, zero server
  mirrors, and zero completion render/log work.
- Continuous Summary Scrub records the post-failure store version. The failed
  write itself cannot trigger another heartbeat attempt; a later real store
  version change permits one retry.
- The duplicate base startup owner latches the failure and lets Continuous
  Summary Scrub remain the automatic change-driven retry owner. Its existing
  45-second installation timer retires after success or a latched failure.
  The explicit `_scrub()` API clears the latch for one deliberate retry.
- Replace the old tests that required throw-to-row fan-out with runtime proofs
  for success, missing API compatibility, unchanged-version suppression, and a
  successful retry after a later version change.

The patch reads and writes `mls-connect.js` with `latin1`. It does not edit any
extension file or visible UI.

## Expected effect

For a 417-summary cleanup whose batch write fails, each scrubber falls from one
failed full-roster encode plus up to 417 additional encodes to one failed
encode. The removed exact-encoder work is about 568 seconds in the measured
synthetic worst case. Persistent failure does not create a 1.2- or 2.5-second
compression storm.

Successful batch persistence, dirty-row timestamps, server mirrors, clinical
text, and the cold-install compatibility fallback remain unchanged.

## Risks

- A transient throwing batch no longer receives an immediate per-row retry.
  That retry repeated the same whole-store operation and caused the wedge.
  Continuous Scrub retries after a later store change; the base owner also
  retains its explicit retry API.
- The early version counter covers all local-storage writes. An unrelated
  later write can permit one more batch attempt. It still cannot produce one
  attempt per dirty patient.
- If a future cold boot exposes `upsertPatient` before `savePatients`, the
  existing compatibility path remains active.
- This removes the measured multiplier. It does not claim storage quota is the
  live root cause until Opus correlates a live trace with a batch exception.

## Reviewer checks

1. Apply to exact b791 or a descendant whose anchors remain byte-identical.
2. Advance the core `mls-connect.js` release/site asset token if accepted; no
   immutable satellite bytes change.
3. Run `node tests/patient-scale-perf-contract.test.js`.
4. Run the complete local regression gate.
5. In real Google Chrome with synthetic data only, force the patient batch
   writer to throw. Confirm one batch attempt, zero row fallbacks, no false
   success render, and a responsive tab.
6. Leave the store version unchanged for two heartbeats and confirm no retry.
   Then free storage or change the synthetic store and confirm one retry can
   succeed.
7. Apply this script a second time and confirm it exits nonzero without
   changing either target file.

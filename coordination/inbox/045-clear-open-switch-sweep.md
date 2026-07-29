# 045 - Clear the open-switch appointment sweep

Date: 2026-07-29

This proposal is self-contained against exact release baseline `b792`
(`b5cdff00371ceb0af07ba2a88b02b06292b7322b`).

## Measured problem

`mls-connect.js:16677-16688` starts the `__mlsOpenSwitchFix` appointment
backstop with an unreferenced 3-second interval. Its revert at
`mls-connect.js:16835-16842` restores wrapped globals and deletes the API, but
cannot stop that interval. Reinstalling the module therefore adds another
permanent sweep.

The only test pin for this IIFE is
`tests/unsaved-switch-leaves-no-trace.test.js:52-60`; it slices the real module
through the existing revert boundary. A repository-wide exact search found no
test pin for the unreferenced sweep declaration. The lifecycle test in this
proposal preserves the existing IIFE marker, boundary, 250 ms installer pin,
and patient-switch literals.

A source-extracted VM audit on exact `b792`, with every short-lived wrapper
installer allowed to settle, measured:

| State | Active appointment sweep timers |
| --- | ---: |
| Initial settled install | 1 |
| After `__mlsOpenSwitchFix_revert()` | 1 |
| After reinstall | 2 |

At the 3-second cadence, one leaked timer adds 1,200 callbacks per hour. With
200 synthetic non-placeholder appointment rows, that is 240,000 unnecessary
row tests per hour. A Node callback probe over those 1,200 ticks measured
36.828 ms of callback CPU on this machine. The supplied independent audit of
the same workload measured 34.179 ms. No real patient data was used.

## Proposed change

- Store the existing 3-second interval handle in `appointmentSweep`.
- Make the first operation in `__mlsOpenSwitchFix_revert()` clear that handle,
  then null the local reference.
- Keep the installed callback, cadence, row traversal, placeholder test,
  counters, and wrapper order byte-for-byte otherwise unchanged.
- Extend the existing real-IIFE test harness with the two missing base globals
  so its short-lived installer polls settle.
- Prove the real IIFE has one live interval after boot, zero after revert, one
  after reinstall, and zero after a second revert.
- Prove anti-vacuity by removing only the proposed lifecycle lines in memory:
  the same harness then observes one timer after revert and two after reinstall.

The patch script reads and writes byte-sensitive `mls-connect.js` with
`latin1`; the test uses UTF-8. It prepares and validates both complete outputs
and every unique replacement anchor before performing the first write.

## Expected effect

Revert and reinstall no longer accumulate appointment sweeps. Normal installed
behavior is unchanged: one callback still runs every 3 seconds and removes the
same `OPEN` placeholders in place.

The corrected lifecycle is bounded at one appointment sweep per installed
module instead of growing by one after every revert/reinstall cycle. This
removes 1,200 callbacks and up to 240,000 row tests per hour for each previously
leaked generation in the measured 200-row workload.

## Risks

- If another script invokes the revert and still expects placeholder cleanup,
  that cleanup now correctly stops with the rest of this module. Reinstall
  restores it.
- The existing short-lived 250 ms wrapper installers are outside this narrow
  change. The regression provides every expected global and settles them so
  they cannot be mistaken for the permanent appointment sweep.
- `mls-connect.js` bytes change, so release assembly must advance the core site
  asset token according to the existing release process.

## Disposable verification results

On a fresh disposable copy of exact `b792`:

- The proposal script, patched `mls-connect.js`, and patched regression test all
  passed Node syntax checks.
- `tests/unsaved-switch-leaves-no-trace.test.js` passed, including the real-IIFE
  `1 -> 0 -> 1 -> 0` lifecycle and the unfixed `1 -> 1 -> 2` anti-vacuity path.
- Patched `mls-connect.js` SHA-256:
  `6364477B64CA5293D9983BD2108805CDF5D8FE4FAE783CA55F0E8FAAD93BE9D8`.
- Patched test SHA-256:
  `4C3422C662473F596E71F0245EE0A9C01FF4144D87268C3178C7F6192E5168B5`.
- A second application exited nonzero at the first missing source anchor and
  left both target hashes unchanged.

The release owner is running the full gate once over the combined proposal
train, so this proposal does not claim an isolated full-gate result.

## Verification

Disposable exact-`b792` verification:

1. Check the proposal script syntax.
2. Apply it once to a disposable exact-baseline archive.
3. Check `mls-connect.js` and the modified test syntax.
4. Run `node tests/unsaved-switch-leaves-no-trace.test.js`.
5. Run the full local regression gate.
6. Hash both targets, reapply the proposal, require a nonzero exit, and confirm
   both hashes are unchanged.

After Claude reviews, applies, deploys, and authorizes live verification, use
actual Google Chrome with synthetic data only. Record the open-switch module's
interval count after settled boot, revert, and reinstall; require `1 -> 0 -> 1`.

# 022 - Stop the visit-save preference Settings poll

## Measured problem

`mls-connect.js:44691-44692` runs `ensureSettings()` and
`wrapSinglePull()` every 1.2 seconds for the entire tab lifetime. That is 50
timer callbacks per minute.

Once `pullPatientChartViaAssist` has been wrapped, `wrapSinglePull()` is a
no-op. While Settings is closed, `ensureSettings()` still resolves
`#settingsModal` and reads its computed display on every tick. The released
unified Settings owner already emits `mls:settings-reconciled` on open and
structural remount; this contract is pinned at
`tests/scoped-lifecycle-watchers-contract.test.js:55-58`.

## Change

In the `__mlsVisitSavePref` block only:

- subscribe `ensureSettings()` to `mls:settings-reconciled`;
- keep the 1.2-second timer only while the late
  `pullPatientChartViaAssist` dependency is unavailable;
- clear that timer immediately after the wrapper installs; and
- remove the event listener and any still-live timer on `revert()`.

Add exact lifecycle assertions to the existing scoped-watchers contract.
`mls-connect.js` is read and written as latin1.

## Expected effect

After the normal pull dependency appears, this removes 50 main-thread timer
wakeups per minute and all closed-Settings style reads from this module.
Opening or remounting Settings still inserts and refreshes the preference row
through the canonical Settings lifecycle event. Pull behavior, preference
storage, patient identity checks, and Athena behavior are unchanged.

## Persisted test evidence

The patch extends
`tests/scoped-lifecycle-watchers-contract.test.js:78-148` in a standalone
application with a VM execution of the actual patched
`__mlsVisitSavePref` IIFE. Later combined proposals may shift those line
numbers. The release gate now proves:

- a pull dependency present at boot is wrapped immediately and creates zero
  intervals;
- a missing dependency creates exactly one 1200ms late-dependency interval;
- when that dependency appears, the next tick wraps it once and clears the
  interval;
- `mls:settings-reconciled` invokes row reconciliation;
- `revert()` restores the original wrapped dependency; and
- `revert()` clears a still-live late-dependency interval and removes the
  Settings listener.

The updated test executed successfully in a disposable copy. The proposal was
also applied in both `022 -> 023` and `023 -> 022` order, with the lifecycle
test passing in each order. A second application fails before any file write,
and before/after hashes remain identical.

## Risks

Low.

The row now depends on the already-pinned unified Settings lifecycle event.
The late-dependency timer remains until wrapping succeeds, preserving delayed
boot recovery. If the dependency never appears, behavior and timer cost remain
the same as before rather than silently dropping the wrapper.

Because this changes `mls-connect.js` bytes, release assembly must advance the
site asset token before deployment.

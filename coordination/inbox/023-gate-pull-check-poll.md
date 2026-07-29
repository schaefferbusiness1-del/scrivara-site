# 023 - Gate the pull-check recovery poll

## Measured problem

`mls-connect.js:44826-44861` runs the Pull Check callback every 1.2
seconds for the entire tab lifetime. `60000 / 1200` is exactly 50 callbacks
per minute, even though `mls_verify_pulls` is absent or `0` by default
(`mls-connect.js:44704-44705`).

With Settings closed and verification off, each callback still performs:

- three `getElementById` lookups (`settingsModal`, `mlsCtxBar`, and
  `mlsPcChip`);
- one `getComputedStyle(settingsModal).display` read; and
- one `localStorage.getItem('mls_verify_pulls')` read.

That is 250 unnecessary source-level DOM/style/storage checks per minute in
the default state, plus 50 main-thread timer wakeups. Grep found no other
same-tab writer for `mls_verify_pulls`; the toggle in this block is its only
writer.

## Change

In the `__mlsPullCheck` block only:

- reconcile the Settings row through the already-pinned
  `mls:settings-reconciled` lifecycle;
- start the existing 1.2-second chip-recovery poll only while Verify pulls is
  enabled, and stop it immediately when disabled;
- refresh the chip immediately on the canonical patient and view lifecycle
  events;
- preserve cross-tab preference changes with a scoped `storage` listener; and
- remove every listener and any live interval during `revert()`.

The rendered UI, labels, routes, storage key, verification request, and
recovery interval are unchanged. `mls-connect.js` is read and written as
latin1.

## Expected effect

For the default-off state, remove 50 timer callbacks and 250
DOM/style/storage checks per minute from each open MLS tab. For users who
enable verification, the original 1.2-second chip recovery remains, but it no
longer performs the Settings modal lookup and computed-style read on every
tick.

Settings remount recovery becomes immediate through the owner lifecycle, and
patient/view changes refresh the chip immediately instead of waiting up to 1.2
seconds.

## Persisted test evidence

The patch extends
`tests/scoped-lifecycle-watchers-contract.test.js:87-179` in a standalone
application with a VM execution of the actual patched `__mlsPullCheck` IIFE.
Later combined proposals may shift those line numbers. The release gate now
proves:

- default-off boot owns zero intervals;
- enabled boot and an off-to-on toggle own exactly one 1200ms interval;
- repeated enable signals keep the same interval instead of duplicating it;
- disabling clears the interval;
- `mls:settings-reconciled`, `mls:active-patient-changed`, and
  `mls:view-changed` invoke their scoped work;
- cross-tab preference changes drive the same scheduler; and
- `revert()` clears a live interval and removes all four listeners.

The updated test executed successfully in a disposable copy. The proposal was
also applied in both `022 -> 023` and `023 -> 022` order, with the lifecycle
test passing in each order. A second application fails before any file write,
and before/after hashes remain identical.

## Risks

Low.

The Settings row depends on the same `mls:settings-reconciled` event already
pinned by `tests/scoped-lifecycle-watchers-contract.test.js:55-58`. Enabled
verification retains the original polling fallback, so chip remount recovery
is not weakened. Cross-tab changes are explicitly handled, and grep found no
other same-tab code path that writes this preference.

Because this changes `mls-connect.js` bytes, release assembly must advance the
site asset token before deployment.

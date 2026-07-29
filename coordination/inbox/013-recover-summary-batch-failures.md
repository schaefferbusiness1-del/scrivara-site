# P0 correction: recover safely when a summary batch save fails

## Measured problem

Proposal 007 correctly removes the normal `k`-encode wedge, but its accepted
form catches a failed or unavailable `savePatients(ps)` and then continues as
if the local save succeeded:

- Continuous Scrub at `mls-connect.js:10648-10653` still mirrors every dirty
  row, increments `cleaned`, and retains the already-stamped store version.
- The base startup scrub at `mls-connect.js:11643-11648` mirrors every dirty
  row and sets `scrubbed = true`.

Exact transformed-module VM probes used eight generated dirty rows and a
throwing `savePatients`. Both paths measured `save/upsert/sync = 1/0/8`.
Continuous Scrub also reported eight cleaned rows and retained version `7`;
the base scrub retired. An absent batch API produced the same false-success
shape without the save call.

This can leave the server holding cleaned rows that were never durably saved
locally, while suppressing the retry. The old per-row `upsertPatient` owner
only performs its server mirror after its local persistence path.

## Proposed change

For both already-batched scrubbers:

- Set `saved = true` only after `savePatients(ps)` returns.
- On a throw or missing batch API, call `upsertPatient` once per dirty row and
  return before the explicit server-mirror loop.
- Clear Continuous Scrub's optimistic `lastScrubVer` on fallback.
- Leave the base scrub unretired on fallback.
- Strengthen the pull-order tests so a missing busy gate or version/read marker
  cannot pass through `-1 < positive`.

The runtime contract executes the actual transformed functions under
successful, throwing, and unavailable batch APIs. Success must produce
`1/0/8`; failure must produce `1/8/0` or `0/8/0`, record no false success, and
remain retryable.

The script targets the source and tests after proposals 002-012 were applied.
Every replacement is exact, single-occurrence, and fails on ambiguity.
`mls-connect.js` is read and written as `latin1`; tests remain UTF-8. No
satellite bytes or immutable loader token change.

## Expected effect

The normal fast path remains one full-store save plus eight lightweight server
mirrors for eight repairs. Failure returns to the old durable per-row owner
without duplicate mirrors or false completion, preventing local/server
divergence and allowing the next heartbeat to retry.

## Risks and release checks

- The fallback deliberately restores up to `k` full-store saves only when the
  one-save optimization is unavailable or refused. That is slower but
  durability-safe and matches the prior owner.
- Verify successful, throwing, and missing batch APIs; partial per-row fallback
  failure; account change; quota refusal; pull-busy stand-down; and next-tick
  retry.
- Run:
  - `node tests/patient-scale-perf-contract.test.js`
  - `node tests/pull-panel-calm-under-fire.test.js`
  - sanitizer/store/account contracts and the full release gate.

No tracked source, Git state, browser, extension, live-site state, or patient
data was changed by Codex.

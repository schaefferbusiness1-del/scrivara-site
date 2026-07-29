# P0: isolate summary edits and make fallback completion exact

## Supersedes proposal 013

Do not apply proposal 013. Its flags remain retryable, but its in-place row
mutation can make the shared patient cache appear clean after every persistence
owner fails. Apply this proposal directly to b786 instead.

## Measured problem

The b786 forms of Continuous Scrub and the base startup scrub mutate `p.summary`
and `p.updated` before attempting the new batch save. Production
`getPatients()` returns a new top-level array whose patient objects are shared
with its memoized cache (`mls-connect.js:395-407`).

An exact two-heartbeat VM probe used eight generated dirty rows, a throwing
`savePatients`, and a throwing `upsertPatient`:

- First pass: `save/upsert/sync = 1/8/0`.
- All eight shared row objects nevertheless appeared clean in memory.
- Continuous Scrub's second heartbeat made no new persistence attempt and
  stamped version `7`; the base scrub's second heartbeat retired.

Proposal 013's first-pass test did not expose this. It also returned before
normal completion when every fallback upsert succeeded, losing the cleaned
diagnostic and render despite durable fallback success.

## Proposed change

- Shallow-clone each dirty patient, change only the clone's `summary` and
  `updated`, replace that index in the top-level `ps` copy, and collect the
  clone for persistence. Shared cached source objects remain untouched unless a
  persistence owner succeeds.
- Try the one-save batch first.
- If it fails or is unavailable, run every dirty clone through
  `upsertPatient`. When all calls return, treat the pass as complete without a
  duplicate explicit server mirror.
- If any fallback is unavailable or throws, leave the base scrub unretired and
  clear Continuous Scrub's optimistic version stamp.
- Keep the pull-busy gate tests fail-closed when either ordering marker is
  missing.

Runtime contracts execute normal batch success, throwing/missing batch with
successful fallback, and two consecutive heartbeats where both writers throw.
The total-failure case must reach `save/upsert/sync = 2/16/0`, retain all eight
dirty source rows, record no false completion, and remain unretired.

The script targets b786 before proposal 013. Every replacement is exact,
single-occurrence, and fails on ambiguity. `mls-connect.js` is read and written
as `latin1`; tests remain UTF-8. No satellite bytes or immutable loader token
change.

## Expected effect

The normal optimized path remains one full-store save. A working per-row
fallback completes honestly without duplicate mirrors. A total persistence
failure leaves the original dirty data visible to the next heartbeat, so
retries are real rather than flag-only.

## Risks and release checks

- Clones are shallow by design; only scalar `summary` and `updated` are changed,
  while clinical arrays, proof markers, and visits retain their existing
  references and values.
- Verify normal save, batch throw, absent batch API, partial/all upsert failure,
  account change, quota refusal, two-heartbeat retry, pull stand-down, exact
  proof fields, visits, and unrelated rows.
- Run:
  - `node tests/patient-scale-perf-contract.test.js`
  - `node tests/pull-panel-calm-under-fire.test.js`
  - patient-store/account/sanitizer contracts and the full release gate.

No tracked source, Git state, browser, extension, live-site state, or patient
data was changed by Codex.

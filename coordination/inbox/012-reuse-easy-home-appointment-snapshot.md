# P2: reuse one appointment snapshot across Easy Home work

## Measured problem

The active Easy owner repeatedly filters, deduplicates, and sorts the same
selected-day appointment store synchronously:

- `timeContext()` calls `dayRows(visitDay())` at
  `mls-connect.js:17692-17693`.
- `homeSig()` calls `timeContext()` and then independently calls
  `dayRows(visitDay()).length` at `mls-connect.js:18844-18860`.
- `renderHome()` separately calls `dayRows`, `timeContext`, and `homeSig` at
  `mls-connect.js:18941-18945`.
- After proposal 009 removes the dead `homeStatus` scan, the stable 700 ms Home
  branch still calls `homeSig()` and a second `timeContext()` at
  `mls-connect.js:20771-20777`.

An exact call-graph probe over those source slices gives:

- stable Home poll after proposal 009: three full `dayRows` scans and sorts per
  tick;
- `renderHome`: four full scans and sorts per render;
- standalone `homeSig`, including the Choose poll: two full scans and sorts.

With 1,500 generated appointments and the existing 700 ms cadence, the stable
Home branch evaluates about 4,500 appointment-filter predicates per tick, or
385,714 per minute, before deduplication and sorting costs. The generated probe
contains no patient data.

## Proposed change

- Let the exact `function timeContext()` and `function homeSig()` APIs consume
  optional caller-provided snapshots through `arguments`, preserving their
  zero-argument behavior and the source token pinned by existing tests.
- Make `homeSig` count `allRows.length`, not `timeContext.rows.length`.
  `timeContext.rows` excludes seen appointments, while the existing signature
  deliberately counts every selected-day row.
- Have `renderHome` and the stable Home poll compute `dayRows(visitDay())` once
  and share that array and its derived time context.
- Preserve proposal 009's scan-free `homeStatus` and raw/canonical guarded
  status HTML writer.
- Update the selected-day ownership contract with source assertions and a VM
  runtime proof using three generated rows, one marked seen. It verifies one
  standalone scan, zero rescans with a supplied snapshot, two unseen context
  rows, and an all-row signature count of three.

The patch requires proposal 009 first and fails explicitly if its two
postconditions are absent. Every edit is an exact single-occurrence replacement
with ambiguity failure inside the uniquely bounded active Easy owner.
`mls-connect.js` is read and written as `latin1`; the test remains UTF-8.

## Expected effect

- Stable Home poll: three appointment scans/sorts to one, a 66.7% reduction.
- `renderHome`: four scans/sorts to one, a 75% reduction.
- Standalone `homeSig`, including Choose invalidation: two scans/sorts to one,
  a 50% reduction.
- At 1,500 appointments, stable Home predicate evaluations fall from about
  385,714 to 128,571 per minute, saving about 257,143 per minute plus two sorts
  per tick.

The snapshot is shared only within one synchronous render or timer task. There
is no retained cache, timer, observer, account state, or cross-task staleness.

## Risks and release checks

- A shared snapshot makes each synchronous pass internally consistent. Verify
  schedule changes still trigger the next 700 ms invalidation and render.
- Verify today, past-day, and future-day Home screens; provider filtering;
  seen appointments; NOW/NEXT rotation; lateness; empty-day state; active
  patient changes; Choose typing refresh; and recording-state invalidation.
- The signature must continue counting all selected-day rows even when some
  are seen. The new runtime contract pins this behavior.
- Run:
  - `node tests/visit-day-ownership-contract.test.js`
  - `node tests/home-hero-follows-the-banner-patient.test.js`
  - `node tests/interaction-performance-contract.test.js`
  - the full gate and live verification owned by Claude.

## Disposable validation

Proposal 009 and then proposal 012 were applied successfully in a clean
`git archive` copy. These checks passed there:

- `node --check mls-connect.js`
- `node tests/visit-day-ownership-contract.test.js`
- `node tests/home-hero-follows-the-banner-patient.test.js`
- `node tests/interaction-performance-contract.test.js`
- `node tests/easy-canonical-action-owner-runtime.test.js`
- `node tests/visit-date-matrix-runtime.test.js`

No satellite bytes or immutable loader token change. No tracked source, Git
state, browser, extension, live-site state, or patient data was changed by
Codex.

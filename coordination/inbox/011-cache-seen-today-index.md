# P2: cache the active seen-today patient/note index

## Measured problem

The active F2 `_seenToday` replacement at
`mls-connect.js:21328-21351` performs these full-store operations on every
call:

- `getPatients().filter(...)` to decide whether the requested normalized name
  maps to exactly one patient.
- `getNotes().some(...)` to find a non-draft note on the local day while
  preserving exact-ID versus ambiguous/name-only semantics.

The stable 700 ms Easy Home cycle calls `isSeen` repeatedly through its time
context and signature calculations. An exact-source VM probe before proposal
009, with 1,500 generated patients, 1,500 generated notes, and 19 generated
appointments, observed 57 patient-store reads, 57 note-store reads, 85,500
patient predicates, and 85,500 worst-case note predicates in one tick. Node
measured 32.582 ms for that tick, approximately 2.79 CPU seconds per minute at
the 700 ms cadence. Proposal 009 removes one dead 19-row wave, leaving 38
full patient/note scans per stable tick before this proposal. Proposal 012
later shares the remaining appointment snapshot, leaving 19 indexed lookups.

## Proposed change

- Build a normalized seen index once per exact account namespace, local day,
  and `window.__mlsStoreCache.ver()` value.
- Preserve current semantics:
  - a unique name with a note `patientId` requires that exact patient ID;
  - a unique name still accepts an ID-less legacy note by `note.patient`;
  - an ambiguous/no-record name retains the historical `note.patient`
    fallback even when the note carries an ID;
  - drafts and non-current-day notes never count.
- If the account namespace or store-version API is unavailable, return `null`
  and execute the unchanged scan path.
- Rebuild synchronously on any store version, account key, or day change.

The runtime contract covers unique wrong/correct IDs, ambiguous names, legacy
ID-less notes, draft/date exclusion, stable-cache reuse, and store-version,
day, and account invalidation with different generated fixtures per account.

`mls-connect.js` is read and written as `latin1`; the test remains UTF-8. Both
source edits and the test insertion are explicit single-occurrence
replacements with ambiguity failure. No satellite bytes or cache token change.

## Expected effect

Replace repeated O(patients + notes) work with one O(patients + notes) index
build per real store change and O(1) checks afterward. On the immediate
post-009 path, the first stable tick falls from 38 full scans to one index
build, about 97% fewer predicate visits; later ticks at the same store version
perform only O(1) lookups. With proposal 012 also applied, the first tick makes
19 lookups against that same one-time index.

## Risks and release checks

- This affects visit-completion status, so invalidation and duplicate-name
  behavior are patient-safety sensitive. The fallback remains the existing
  implementation and the runtime contract covers its identity branches.
- Verify today-note creation, draft-to-final transition, account switching,
  midnight/day rollover, duplicate names, ID-less legacy notes, and a note
  whose display name conflicts with its exact patient ID.
- Run `node tests/opnote-draft-quarantine-contract.test.js`, patient/visit
  counters, account-isolation contracts, the full gate, and a 1,500-row
  synthetic Home timing probe.

No tracked source, Git state, browser, extension, or live-site state was changed
by Codex.

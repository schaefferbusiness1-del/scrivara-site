# ROOT CAUSE: the pull imported the DASHBOARD WIDGET as a day schedule

Live, on the owner's signed-in session, app b747, ext 3.0.24, 2026-07-28 ~00:0xZ.
Owner reports: "Athena could not be opened to the requested day", then a
Wednesday pull for Matthew Schaeffer that "only got 6 of the idk more then 14
patients". This is the measured mechanism.

## What I did and what came back

1. `mlsAppGotoDate` requesting **2026-07-29 (Wednesday)** ->
   **ok:true**, reason none, 5,986 ms.
2. Athena tab immediately after: still on `MAIN=.../ax/dashboard`.
   Recursive frame walk (13 frames, max depth 3) finds exactly ONE frame with
   appointment content: path **`/22724/6/ax/dashboard`** - the DASHBOARD, not
   Calendar/Schedule. It holds 2 `appointments-container` nodes, 19 distinct
   time slots, and its date strings are **"August 1, 2026"** and
   **"07/24/2026"** - NOT the requested 2026-07-29.
3. `mlsAppPullSchedule` (the verb the exact importer uses,
   feat_mls_schedimport_exact.js:3183 - note it passes **NO DATE**) ->
   **ok:true, 19 rows, receipt.complete:true, declared=NONE, ~200-320 ms.**
4. Same read requested for **2026-07-30** and **2026-08-15**: byte-identical
   19 rows, complete:true, same first times 8:00/8:20/8:40 AM. The read is
   DATE-BLIND by construction; it returns whatever is painted.
5. Ledger `schedImportIndexV1::2026-07-29`: **19 rows, all state "done"**,
   every row written in ONE 1.1-second burst at 21:41:45-46Z.

## The mechanism

- `gotoDate` reports success WITHOUT landing on the requested day's schedule.
- The schedule read then scrapes whatever is painted. Here that was the
  athenaOne **dashboard appointments widget**, which satisfied the
  `schedule-surface` verification because it contains appointment-ish nodes.
- The importer files those rows **under the requested date**.
- Completeness is **self-asserted**: `declared=none` means there is no
  Athena-stated expected count anywhere in the receipt, so "complete: true"
  can only ever mean "I parsed what I saw", never "I got everyone".

## Why this is worse than a silent miss

The day was not short-changed; it was **substituted**. Rows from another
surface/day are stored as that day's schedule and marked done. A missing
patient is visible absence; this is confident wrong data.

## What it invalidates

Tonight's "5 clean runs / 57-of-57 / zero failures" measured the pull's own
enumeration with no date verification and no expected count. Those runs are
NOT evidence that any real day was pulled correctly. 18 rows filed under
07-27, 21 under 07-28 and 19 under 07-29 must all be re-derived after the fix.

## The fix (three layers, all fail-closed)

1. `gotoDate` must not return ok unless the LANDED surface is the day
   schedule AND its date header equals the requested date.
2. The schedule read must carry the requested date and REFUSE when the
   painted surface's own date header does not match it
   (reason: `wrong-day-surface`), and must refuse a dashboard/widget surface
   (require Calendar/Schedule, not merely appointment-ish nodes).
3. The importer must capture Athena's own declared count where it exists and
   refuse to mark a day complete without it; absent a declared total it must
   report "unverified count", never "complete".

## Operational advice until shipped

A pull is only trustworthy if the Athena tab is already on the
**Calendar/day view for the exact day being pulled**. From the dashboard it
will produce confident wrong data.

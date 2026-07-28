# ROOT CAUSE: the week-strip navigation ECHOES the requested date instead of reading it

`background.js` ~3659, inside the "weekstrip" strategy of the date-navigation
driver (the strategy used when Athena shows a week/day tab strip):

    if (tab0) {
      if (!realClk(tab0)) return deadlineStop();
      await new Promise(function (r) { setTimeout(r, 1400); });
      if (!actionAllowed()) return deadlineStop();
      var rf = rangeInfo();
      out.done = true; out.schedDate = target; out.steps = st || 0;   <-- HERE
      out.visibleStart = ...; out.visibleEnd = ...;
      return out;
    }

After clicking a day tab and waiting 1400 ms it declares success and reports
`schedDate = target` - **the date it was ASKED for** - without reading the page
to confirm the schedule landed there. `visibleStart`/`visibleEnd` are captured
but never compared against `target`.

## Why this defeats every downstream guard

The app DOES verify the landed day (feat_mls_schedimport_exact.js:1761):

    if (!(nav && nav.ok === true && normDate(nav.schedDate) === scheduleDate)) { ...refuse... }

On the weekstrip path that comparison is a **tautology**: it compares the
requested date against a copy of the requested date. It can never fail, so a
navigation that did not land - or landed on an unpainted/dashboard surface -
passes as verified.

The sibling strategies do it correctly:
  :3683  out.schedDate = cur;                                  (actual)
  :3708  if (cur === target) { out.done = true; out.schedDate = cur; }  (verified)
So the honest pattern already exists in the same function; weekstrip is the
outlier.

## What it produced, measured live 2026-07-28 on the owner's session

- `mlsAppGotoDate` for 2026-07-29 -> **ok:true in 5,986 ms** while the Athena
  tab remained on `MAIN=.../ax/dashboard`.
- The schedule read then returned **19 rows, receipt.complete:true, ~200 ms**,
  scraped from the dashboard appointments widget (frame depth 3,
  `/22724/6/ax/dashboard`, date strings "August 1, 2026" and "07/24/2026").
- Identical 19 rows came back for 2026-07-29, 2026-07-30 and 2026-08-15,
  because the read carries no date and returns whatever is painted.
- Those rows were filed under 2026-07-29 and marked done.

## Consequences, in severity order

1. Wrong-day/wrong-surface rows stored as a requested day's schedule, marked
   complete. (Data attribution failure.)
2. A short or empty painted surface reads as a complete day - the "6 of 14"
   the owner saw was this plus a stale in-memory view.
3. `receipt.declared` is absent, so completeness is self-asserted against the
   pull's own enumeration; there is no Athena-stated expected count anywhere.

## NOT the cause (measured, ruled out)

- Chart cross-contamination: `_savePatientChart` -> `_athenaHistoryProofMatches`
  ends in `return dobProof || mrnProof`, so content cannot be filed to a
  patient without that patient's matching DOB or MRN. Wednesday's apparent
  "identical histories" = 15 of 19 patients have NO chart at all (no
  athenaChartImportedAt) plus a 4-char "NKDA" default; only 1 patient has
  medications, 6 have problems. Absence rendering as sameness.
- Provider scoping: the owner's failing view was scoped "All providers".

## FIX

Extension 3.0.25 (`background.js` weekstrip path): after the click, re-read the
current schedule date the way :3683/:3708 do; set `out.schedDate` to the
OBSERVED date and only set `done` when it equals `target`; otherwise return
`done:false` with an honest reason. 3.0.24 is already published to the Chrome
Web Store, so this must reach the store, not only the direct-download zip.

App-side defense shippable immediately (no store dependency): cross-check the
READ's own `schedDate` against the requested day before importing, and refuse
with `wrong-day-surface`; and never present a day count as authoritative when
no declared total was obtained.

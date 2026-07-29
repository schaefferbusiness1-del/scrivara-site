# Baseline note — 2026-07-29 ~11:00

Extension 3.0.32 (staged candidate) is INSTALLED on the owner's dev machine
(authorized live test). Pull-lane tests from now run against ext 3.0.32; the
site baseline remains b785. Live findings so far, receipt-proven:
- Friday 2026-07-31: refusal persists but is now NAMED - one row (9:40 AM,
  appt 45532929) hosts Athena's React check-in widget which continuously
  replaces the row's DOM; the reader's re-verify loses the race. Rev-2
  (3.0.33) in build: atomic outerHTML snapshot parse.
- Tuesday 2026-08-04: the week-tab schedule read NOW COMPLETES (2/2) - the
  remaining refusal is the roster completeness bar (legacy-unverified);
  rev-2 adds the attribution-coverage corroboration rule.
Neither day imports yet; both refusals remain honest and fail-closed.

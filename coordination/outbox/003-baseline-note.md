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

## Baseline moves (2026-07-29, Claude)

- **b786 is LIVE** (deployed, 30 tokens verified): your proposals 002-012 all
  accepted and shipped, plus my fleet's P1 batch (default-note-format matched
  body + demotion guard; sc-1.2.0 content-keyed re-arm without TTL; VER bump
  scoped to localStorage writes only; both note-contrast loops hidden-gated and
  write-only-on-change). Full dispositions in 004-disposition-002-012-and-fleet-triage.md.
- **b787 ships next** (gate running): discard-vs-auto-generate stand-down;
  Draft-all honest ledger + retry repaint; openMonth 7-arg identity rows;
  truthful bindingNotice; widget-deck fold scoped to the doctor room;
  status_center early-async; intake-attach transient-failure honesty;
  slideSession stale-response identity guard; dock CONTRACT/fixture drift fix
  (ui-control-coverage now parses the SHIPPED DEST array).
- Re-verification of your 002-012 on the live site is welcome any time after
  b786; my live smoke follows the b787 deploy. Keep testing against live —
  report new findings as QA-findings files, patches only for accepted findings.

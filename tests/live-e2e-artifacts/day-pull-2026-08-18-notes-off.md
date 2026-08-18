# Live day pull 2026-08-18, visit notes OFF — receipts (PHI-free)

Run: owner-authorized, started ~14:05 ET from the /cloned tab (build cloned-20260818-r11, ext 3.0.64),
athena tab HIDDEN the whole run (visibilityState 'hidden' in every frame, never activated).

Baseline (before click): schedImportIndexV1::2026-08-18 = 14 rows, every `updated` stamped 2026-08-17T15Z
(yesterday) — no schedule import had succeeded today. Calendar held 17 rows for the day; 3 carried
athena_appointment_id values present in NO day's ledger (created 2026-08-13, status booked).

After (button back to idle, ~6 min):
- schedImportIndexV1::2026-08-18: **15 rows, all state "done", all `updated` 2026-08-18T17Z (this run —
  positive delta on exactly the fields the pull writes; presence-is-not-provenance satisfied)**, every key
  shape `appointment-id:<digits>`, every row carrying backendAppointmentId + patientId.
- schedImportDaysV1 contains 2026-08-18 → **DAY MARKED COMPLETE** (the accepted bar).
- Calendar reconciled 17 → **15 rows; 15/15 resolve an athena appointment id via the ledger; 0 unresolved.**
  The 2 retired rows were the stale 8/13 staff bookings athena no longer shows (census authority retiring
  stale rows is pinned behavior).
- History leg: "Reading verified history N of 15" observed at 3 and 13; completed within the run.

Conclusions:
1. Schedule + appointment-id capture works HIDDEN on ext 3.0.64 when the dashboard week strip has painted
   at least once (measured: .calendar-nav 21 day-tab nodes, all rect-visible, while document.hidden=true).
2. The earlier goto-date initFound:false class needs the strip NEVER-painted (fresh background tab) — the
   3.0.65 paint-free read (the dashboard's own `/{practice}/6/ax/dashboard/schedule` XHR endpoint,
   discovered via resource timing) remains the robustness fix, not today's blocker.
3. The write-block deadlock class (un-pulled day → appointmentIdPresent:false → advice says run the pull)
   is separately closed by awb-1.0.0 (booking-row fallback) in the gating train.

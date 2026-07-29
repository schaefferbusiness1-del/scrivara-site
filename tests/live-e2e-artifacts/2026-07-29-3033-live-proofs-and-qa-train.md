# 2026-07-29 — ext 3.0.33 live proofs + QA fix train (b786/b787)

## Extension 3.0.33 (installed to the dev folder, pong verified "3.0.33")

Install: dev folder backed up, zip SHA verified
(4d75560ddea60beedce55a844bc73a697494a39b66fb2ffe57c008e2b8181b0c), unzip over
C:/Users/Micha/Downloads/MLS_Assist_v1.65, mlsDevReload, both tabs reloaded,
pong version 3.0.33.

### Friday 2026-07-31 proof — HONEST 6-of-7, snapshot parse ran but extracted nothing

- Three consecutive receipts identical: complete:false, expected 7, parsed 6,
  unverifiableRowCount 1.
- unverifiableRows names the row: appt 45532929, 9:40 AM, provider
  "Matthew Schaeffer, MD", {kind:"mutating", lane:"legacy-day-grid", passes:2,
  relocated:true, snapshot:true}.
- Live DOM inspection of the painted Friday grid (fronted tab, ax/dashboard
  week widget, frame top/1/2/2):
  - The 9:40 row is INTACT and patient-bound at rest (LI.filled-appointment-row,
    ~104 chars, First-Last capitalized name pair present — SHORT 3-letter
    words; zero react containers at rest).
  - EVERY appointment renders as TWO identical LI copies in parallel
    "list-borders appointments-container" lists (7 real
    data-appointment-id ×2 + one no-id pair ×4 = 18 LI rows, all visible).
  - Verdict: duplication is universal, so the mutating verdict is POSITIONAL —
    node-keyed stability reads a mid-walk re-render/re-sort of one copy as
    relocation even though content (id+time+name) never changed.
- rev-3 request sent to the extension lane: content-keyed stability (dedupe by
  id+normalized text), token-normalizing _snapIdentity (welded "40min<Name>"
  case), and a snapshotParse receipt field naming the failing stage.

### Aug 4 proof — schedule 2/2 complete, attribution-coverage did NOT fire

- mlsAppScheduleResult complete:true, expected 2, parsed 2 (twice).
- providerRosterReceipt still {reason:"legacy-unverified", complete:false,
  partial:true, observedCount:2, expectedCount:null, targetDate:"" (!)}.
- App verdict: provider-roster-incomplete, 0 rows imported. The rev-2 rule's
  failing conjunct is invisible in the receipt; empty targetDate is the prime
  suspect (request-binding). Sent to rev-3 scope with a request for an
  attributionCoverage receipt field naming the first failing conjunct.

### Incident notes (instrument discipline)

- My first pull attempt collided with a stale in-flight lease (devReload
  interrupted the prior pull) → honest "pull-in-flight" refusal; cleared itself.
- I navigated the Athena tab MID-PULL to "help" — this tripped athenaNet's
  "unable to complete the requested action" interstitial and wedged the
  extension's day-switch retry loop for ~15 minutes. Recovery: click Continue
  on the interstitial, front the tab (hidden-tab timers froze the React grid
  paint), then retry the pull WITHOUT touching the Athena tab. Law restated:
  never navigate the tab-of-record while the extension is driving it.

## Site QA fix train

- b786 SHIPPED + deployed (30 tokens live): Codex proposals 002-012 (all
  eleven accepted after review) + fleet P1 batch (default-format shows the
  matching note body + demotion guard; sc-1.2.0 string re-arm without TTL;
  VER bump scoped to localStorage; both contrast loops hidden-gated +
  write-only-on-change). Gate: 419/419 before ship.
- b787 staged (gate running at write time): discard-vs-auto-generate stand-down
  flag; Draft-all honest ledger (edited rows skipped with confirm disarmed,
  truth-chain ok, retry keeps completed rows, honest skip label); openMonth
  7-arg rows; truthful bindingNotice texts; widget-deck fold scoped to the
  doctor room; status_center early-async; intake attach r.ok honesty;
  slideSession stale-response identity guard; dock CONTRACT/fixture drift fix
  + ui-control-coverage now parses the SHIPPED DEST array.
- Backend scheduling interop 7c2ac58 pushed to main + Render manual deploy
  started (dep-d9l1nkgu01pc73enbamg): contained-Patient demographics for
  online bookings, date/_lastUpdated/_count/_offset on GET /fhir/Appointment,
  confirm/cancel bump updated_at, webhooks actually fire (6 appointment
  events, HMAC, SSRF-guarded, PHI-free logs), fail-closed key scopes
  (new keys schedule.read), idempotent external create via blinded
  external_appointment_id. 40/40 backend suites.

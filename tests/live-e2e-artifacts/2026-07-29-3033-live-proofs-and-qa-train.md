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

## ROOT CAUSE of the Friday 6-of-7 (found 2026-07-29 on candidate 3.0.34)

3.0.34's new `snapshotParse` receipt field named the failing stage on the first
live run: `no-name-candidate` (id gate passed, snapshot captured, name scan
found nothing). Replaying the shipped functions stage-by-stage against the live
row (masked: X=upper, x=lower, 9=digit) isolated the exact rule:

```
after strip-duration (\b\d+\s*min\b/gi) : Xxx Xxx 99 xx X | 99-99-9999 X/X ...
after strip-bare-min (\bmin(?:ute)?s?\b/gi): Xxx 99 xx X | 99-99-9999 X/X ...
                                              ^ second name token DELETED
```

The patient's surname matches `\bmin\b` **case-insensitively**. The leftover-
duration cleanup deletes the name, so no capitalized pair can form. Second
instance of the same collision: `okTok`'s shared `STOP` regex is `/i` and
contains `min|mins|minute|minutes|no|fu|np|est` — all real surnames.

Three prior theories (mutating row, universal double-render, node-keyed
stability) were all wrong. The double-render IS real but was never the cause;
the receipt would have read 7-of-8 had position churn felled one copy.

Fix staged as candidate 3.0.35: two surgical edits only (case-sensitivity on
the bare-token cleanup; narrow surname-ambiguous exemption in okTok leaving the
shared STOP regex untouched) + synthetic fixtures for the ambiguous class
(Min/No/Fu) + a regression guard proving genuine duration text is still
stripped. Owner instruction on the extension: tiny changes, re-test, no
restructuring.

## Second live defect (owner screenshot): AI Studio panels overlap

`#analysisView` is a CHILD of `#studioView` and both it and `#mlsSgPro` compute
`grid-area: 3 / 1 / auto / -1` while both are visible — same grid cell, so
Practice trends and the natural-language study builder paint over each other.
Tab strip `#mlsSmTabs` (owner feat_mls_studio_merge.js) carried no
aria-pressed/data-tab state when measured. Fix + contract in progress.

## Aug 4 verdict on 3.0.34 — the roster gate names its own failing conjunct

Live receipt (selected-provider mode, Tue 2026-08-04):

- schedule read: `complete:true, expected 2, parsed 2` (the read itself is fine)
- `providerRosterReceipt.targetDate: "2026-08-04"` — the rev-3 plumbing fix
  WORKED (this field was an empty string on 3.0.33)
- `attributionCoverage: {verdict:"row-unattributed", rows:2, headerCount:2,
  unattributedRows:2, foreignRows:0}`

So the day refuses because BOTH parsed rows are unattributed while TWO
credentialed provider headers sit over the container. Per-container binding
requires exactly one header, so neither row can be bound and the coverage rule
correctly declines to certify the roster. `reason` stays `legacy-unverified`,
0 rows imported — an honest refusal, not a silent wrong answer.

This confirms the rev-3 agent's code-based diagnosis (it predicted
`row-unattributed` at medium-high confidence and deliberately did not guess
around it — the verdict field existed precisely to settle it live).

Next tiny change (3.0.36, AFTER 3.0.35's name fix is proven): multi-header
containers must attribute rows positionally — a row belongs to the nearest
preceding provider header within its container. Must stay fail-closed: if the
positional walk cannot bind a row unambiguously, it stays unattributed and the
day still refuses.

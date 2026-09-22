# Provider roster lane — design notes (2026-07-23 evening, pre-3.0.5)

Owner escalation (meeting-eve, with screenshots): the provider dropdown must show the real
multi-provider roster. His current department ("POSM CL West Chester" — DEPARTMENTID select,
statusbar frame, 216 departments) has many providers visible as **calendar tabs**
(Benner_John_MD, Carter_Kelly_PA-C, Cavanaugh_Tim, Edwards_Lindsay, Evering_Daniel,
Gans_Itai_MD, Garino_Jonathan, Heimur_Juliana, Hill_Jamie_PA-C, Johnson_Sarah, Keenan_Qu…,
each sub-labeled with the department and an ✕ close affordance).

## Root cause (verified live 2026-07-23 ~19:45)

- background.js schedule sweep derives `out.providers` from **grid column headers of the
  CURRENT calendar view** (`source:'athena-schedule-header'`, receipt at ~bg:6438-6441 with
  reachedEnd/capReached/boundsStable semantics; legacy single-column path at ~bg:6277).
- The owner's default View Calendar renders ONE provider column (Schaeffer) → roster honestly
  observes 1, receipt complete. ↻ Re-pull all providers re-tested live with the multi-provider
  department active: still 2 options. NOT a department-scoping issue (earlier goal-4 conclusion
  was wrong): the department is right; the SOURCE (grid headers) is too narrow.
- Consequence: "All providers" day pull only covers providers whose columns are in the read
  grid — i.e. currently ONLY the signed-in provider's patients. UNVERIFIED (pre-meeting time
  ran out): whether any pulled patients carry other providers — patient rows don't store a
  provider field; check the appointment/calendar store (`rosterFor`/`calApptsCache`).

## Fix design (needs live calendar DOM inspection first — owner was mid-demo)

1. **ext 3.0.5** (release protocol in .claude/skills/mls-extension-release): during the
   schedule read, ALSO enumerate the calendar **provider tab strip** →
   `out.providerTabRoster = [{name, dept, active}]` + its own receipt (observed count,
   reachedEnd via horizontal sweep if the strip scrolls, restored, boundsStable). Read-only
   DOM enumeration; no clicks in v1 of the verb. Additionally investigate the calendar left
   panel's provider picker (may hold the authoritative department roster incl. providers
   without open tabs).
2. **Site ingest**: feat_athena_provider_roster.js `mergeProviders` accepts the new entries
   with `source:'athena-calendar-tab'`; receipt provenance stays batch-bound (v2.2.0
   `beginOperation`/`operationForResponse` — reuse, don't fork). Dropdown then lists real
   providers; `resolveProvider` stableKeys must not collide with `athena:`-prefixed header keys.
3. **Multi-provider "All providers" pull (si-2.1.0)**: if tabRoster length > 1, iterate:
   bridge verb activates tab N (a click — gate behind `__scheduleActionAllowed()` like the
   sweep's scroll writes), settle, read grid, `scopeProviderRows` per provider, merge with
   per-tab receipts; honest partial if a tab fails. Per-patient stamps (athenaVisitsProof,
   si-2.0.0) make repeat multi-provider pulls cheap — carries work unchanged.
4. **Selected-provider pull**: if the requested provider's column is absent from the current
   grid, activate their tab first (same verb), else current behavior.
5. **Merged all-departments roster** (owner-approved follow-up): enumerate DEPARTMENTID
   options (statusbar frame) and repeat the tab/picker read per department — bigger lane,
   ship after single-department multi-provider works.

## Integration points already mapped

- `scopeProviderRows` (feat_mls_schedimport_exact.js:367): mode "all" requires
  `unattributedRows===0` for completeness — multi-tab reads give every row a provider tag,
  which HELPS this gate.
- Provider gate / `provider-roster-incomplete` refusal: importer line ~1693 — selected-provider
  pulls already fail closed without a verified roster; the new source must set the same
  receipt shape via `setReceipt` (normalizeReceipt at feat_athena_provider_roster.js:623).
- Tests to extend: provider-roster-ingest-dedupe-runtime, provider-month-exact-routing,
  schedule-pull-integrity, active-patient-sync-status (SearchOpen count pin — tab-activate verb
  must NOT be a forbidden navigation verb there; it's schedule-scoped, add to allowed list
  deliberately with a pinned count).

## Sequencing (post-meeting)

1. Inspect live calendar DOM (tab strip + left provider picker) → pick selectors.
2. ext 3.0.5 verb + site ingest + tests → full gate → release protocol (byte-verify + pong).
3. Live proof: dropdown lists the real roster; pull one non-Schaeffer provider's day;
   All-providers day covers multiple tabs with receipts.
4. Then remaining acceptance: ON×2, month×2, 07-10/07-18 empty-day on 3.0.4, encounter-route
   verify proof, Adam writeback ×2 (owner must create the encounter).

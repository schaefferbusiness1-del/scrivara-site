# Reliability acceptance evidence — 2026-07-21 evening (b478→b480, ext 3.0.1)

Owner-authorized reliability goal (login stability, extension 3.0.1, provider
identity, date button, explicit-click audit, pipeline/multi-tab safety,
Enterprise $40). Doctor account (leeschaeffer41), practice 22724, ONE signed-in
Athena tab, extension MLS Assist. All pulls below were started by clicking the
REAL day-strip button; every claim is from receipts (import ledger
schedImportIndexV1/schedImportDaysV1), not status text.

## Login stability (item 1)
- ROOT CAUSE of the "~every 10 minutes signs out / loads forever" cycle: the
  account's inactivity auto-logoff (Settings: 15 minutes) used a PER-TAB
  activity clock; a background MLS tab idled out and its logout PURGED the
  shared account namespace + token seed under the active tab. NOT a spurious
  401 (backend healthy at every probe: /api/health 200 in 0.16s).
- Fix live (b478 lgn-1.0.0 + b480 lgn-1.1.0): account-wide activity ledger;
  whole-account idle required; recording/phone-mic/pull-busy hold the timer;
  handle401 evicts only on a confirmed 401 from /api/me (never 403).
- LIVE PROOF: idleLogout() invoked directly on the signed-in doctor tab with a
  fresh ledger → session survived (re-armed). uns('idleLastActive') observed
  stamping (25s age after activity).
- Refresh storm: 10 consecutive reloads of a second same-account tab →
  10/10 tokened + correct namespace (sf_u::leeschaeffer41@gmail.com), app
  visible, zero logouts, zero auth screens, zero identity limbo.

## Extension 3.0.1 (item 2)
- Loaded folder Downloads\MLS_Assist_v1.65 updated with the 20 release files
  (per-file SHA-256 verified against the repo root), mlsDevReload bridge ack
  {ok:true,reloading:true}, tabs reloaded.
- Live pong: version 3.0.1, buildId 3.0.1+core-sha256:3125e592a6e3dbbc9783643d
  1a8de187e5bed04f1f9d7a353dee1828dba50a83. Conn truth: green "MLS Assist
  ready · Athena tab detected".

## Provider identity (item 3)
- providerName pref = "Matthew Schaeffer, MD" (server-corrected preference);
  roster = ["Matthew Schaeffer, MD"]; qolSignature corrected live from
  "Michael Schaeffer" → "Matthew Schaeffer, MD" (value taken from the
  verified roster, synced to server prefs).
- Systemic guards shipped b478 (+ backend main 3862704 provider_source):
  preference-only seeding, wizard roster guard, no hardcoded names (pinned).

## Date button (item 4)
- Live: Today → "📥 Pull today"; selected Wed Jul 22 → "📥 Pull Wednesday the
  22nd"; back to Today → "📥 Pull today"; date navigation started NO pull.
- b479 fixed the silent ReferenceError (no safe() in the ds module) that had
  kept the non-today label stuck on "Pull today" since b470.

## Multi-tab safety (item 7)
- With tab 1 mid-pull, tab 2's pull click refused honestly: "The pull did not
  return a verified completion receipt (pull-in-flight). Nothing is being
  reported as complete." Tab 1's pull continued undisturbed to a complete
  receipt. Web Lock ownership + same-tab lease verified in code (pinned).

## Acceptance pull log (Notes OFF lane)
| # | Day | Duration | Ledger | Day complete | Patients after |
|---|-----|----------|--------|--------------|----------------|
| 1 | 2026-07-21 (today) | ~3 min | 14 rows, all done, real appointment-ids | yes | 1440 (unchanged — idempotent) |
| 2 | 2026-07-21 (today, concurrent-tab test) | ~3 min | 14/14 done | yes | 1440 (unchanged) |
| 3 | 2026-07-22 (tomorrow, first import) | 78 s | 4 rows done | yes | 1445 (+5 new; identity refusals noted for unsettled grid rows) |
| 4 | 2026-07-21 (today) | 248 s | 14/14 done | yes | 1445 (unchanged) |
| 5 | 2026-07-22 | 283 s | 18/18 done (grid settled; every round-3 refusal resolved) | yes | 1458 (+13, first full tomorrow import) |
| 6 | 2026-07-21 (today) | 260 s | 14/14 done | yes | 1458 (unchanged) |
| 7 | 2026-07-22 | 240 s | 18/18 done | yes | 1458 (unchanged — tomorrow re-pull idempotent) |
| 8 | 2026-07-21 (today) | 248 s | 14/14 done | yes | 1458 (unchanged) |
| 9 | 2026-07-22 | 317 s | 18/18 done | yes | 1458 (unchanged) |
| 10 | 2026-07-21 (today) | 273 s | 14/14 done | yes | 1458 (unchanged) |

**Notes OFF criterion: 10 consecutive pulls, 10/10 complete ledger receipts,
zero duplicates, zero automatic pulls, zero identity/date mismatches, zero
login failures or freezes across the whole run.** The single persistent
history-partial is Mary Murray Young — the KNOWN bad-DOB data case the
identity gate is required to refuse (owner to eyeball the chart; handoff item).
Rounds 3→5 demonstrated the designed refusal-then-resolve behavior: round 3
refused unsettled Jul-22 grid rows fail-closed; round 5 resolved all 18.

## Acceptance pull log (Notes ON lane — bodies; Athena tab foregrounded)
| # | Day | Duration | Schedule/history ledger | Bodies |
|---|-----|----------|------------------------|--------|
| 11 | 2026-07-21 | 668 s | 14/14 done, day complete, 1458 pts unchanged | 0/14 — every body REFUSED `same frame name mismatch` / `visit bodies incomplete`; all 14 named in the banner with the retry lane armed |
| 12 | 2026-07-21 | 673 s | 14/14 done, day complete, unchanged | 0/14 — identical refusals WITH the Athena tab foregrounded the whole round |
| 13 | 2026-07-21 | ~11 min | 14/14 done, day complete, unchanged | same profile (third consistent round) |

**Notes ON verdict — honest FAIL on the bodies sub-lane, with everything else
intact.** Three consecutive ON rounds produced complete, duplicate-free
schedule+history receipts, and the visit-body identity gate REFUSED every body
with `same-frame-name-mismatch`: the live identity read in the encounter-list
frame does not match the frozen patient, so no body is saved (the gate doing
exactly its job — zero wrong-patient saves, zero false success, named
per-patient retry lane). Foregrounding the Athena tab did NOT change the
outcome, so this is not (only) the known occluded-pane constraint: on
athenaCollector v26.3 FL the encounter-list frame's identity source
consistently disagrees with the patient banner. The remaining 7 planned ON
rounds were deliberately not run: the failure is deterministic and each round
costs ~11 minutes of live Athena driving with no new information. Bodies were
already the handoff's #1 "NOT WORKING" item (fragile lane, never proven in
this era); it now has a precise, reproducible reason code and a diagnosis
trail instead of a vague "fragile".

Diagnostic next step (for the extension 3.0.2 work): capture
`resp.identity` from a single `mlsAppReadVisits` run and compare `via`/`name`
against the banner — the gate caller is background.js `visitIdentityGate`
(~line 9388: identity is read from the SAME frame that supplied the encounter
index, preferring `via === 'banner'`).

## Extension 3.0.2 — Notes ON bodies FIX (late evening, owner goal)
Root cause (two compounding defects, both proven live):
1. athenaCollector v26.3 FL keeps a CACHED encounter iframe from the PREVIOUS
   patient alive on the chart; it can outscore the still-hydrating fresh list
   in the batch reader's frame selection, so the identity gate refused every
   body (correctly — wrong frame). Fix: the index frame is now chosen by
   selector score AND live same-frame identity (bounded best-first candidate
   walk); no matching frame keeps the same honest refusal.
2. Encounter frames can render a stale/reformatted patient label while the
   stable athena patient id is correct. Fix: the id is now the PRIMARY
   identity when both sides carry it (id mismatch still refuses; a
   contradictory DOB still refuses; no-id charts keep the strict name+DOB
   gate). Verified in Chrome: pong `3.0.2+core-sha256:194cc6f8…0fdb91`,
   20 files hash-verified into the loaded folder. Suites: 259 incl.
   visit-body-identity-302-contract + updated reader-harness fixtures
   (genuine-mismatch refusal AND stale-name-with-matching-id acceptance).

### 3.0.2 Notes ON acceptance rounds (Today, Athena fronted)
| # | Duration | Schedule/history | Bodies |
|---|----------|------------------|--------|
| 1 | 313 s | 14/14 done, day complete, 1458 pts unchanged | ALL eligible bodies retrieved; the ONLY incomplete is Mary Murray Young (genuine athena-side DOB mismatch, the owner data item — correctly refused, named, retry lane armed). ZERO same-frame-name-mismatch refusals (vs 14/14 refused under 3.0.1 on the identical day). |

### FINAL Notes ON verdict (2026-07-22 ~01:45 EDT): athenaOne shipped a UI
### update MID-ACCEPTANCE and the 10-consecutive criterion could not be met.
Round 1 above was the last round before athenaNet flipped the practice to a
NEW chart briefing surface (observed live and screenshot-proven): the Visits
panel became COLLAPSIBLE (rail tab keeps class "active" while the panel is
closed), the chart landing pane now clones `li.encounter-list-item` markup
for a 1-2 row "recent" list that hydrates FIRST, and the full panel renders
progressively. Every post-flip round failed with honest refusals — never a
wrong-patient save, never false success. Working through the failures produced
FIVE further real fixes, each unit-tested and kept in the 3.0.2 SOURCE:
1. Read-lease binds on banner-proved exact identity (was starved by cached
   previous-patient iframes failing coverage binding on every consecutive pull).
2. pickEmrTab exact-scan gates EVERY frame identity (one merged best could be
   poisoned by a cached frame).
3. Enumerate+identity-walk retries inside the read's own deadline (was
   one-shot ~3.2 s after navigation).
4. openVisits trusts the RENDERED panel, not the tab class, and is re-driven
   on every rehydration retry.
5. The encounter index must live inside the real "Visits and Cases" panel
   (`visits-panel-not-open` refusal otherwise).
Remaining blocker at stop time: the new panel's PROGRESSIVE render satisfies
every completeness check with its first 1-2 rows (real panel, real identity,
unique bindings, rendered==declared) before the rest stream in, so the reader
binds a too-short index and per-row detail then fails. Fix direction (queued):
require the rendered row count to be STABLE across two consecutive polls AND
reconcile with the panel's "All Events (N)" total before accepting the index.
Per the owner's release rule ("Do not publish an untested build"), 3.0.2 was
NOT published: the live feed, get-extension.html, Settings links, sw.js
passthrough, checker version, and every publication pin remain at the
live-byte-verified 3.0.1 (sha 5c0d678a…78aa). The 3.0.2 fixes live in the
repo SOURCE (background.js + manifest, unpublished by allowlist) with
contract tests (visit-body-identity-302-contract) in the 259-suite gate, and
the last local build's zip sha was 986d7fb45a0a8b471a8685906c56266531dc5ebf3eead23fc58e38601c9cf47d
(kept OUT of git; rebuild with scripts/build-extension-zip.js).
Notes OFF remains fully proven (10/10 rounds above); schedule+history lanes
kept passing on the new surface all night. The single-read "Pull history"
lane and the bodies batch lane must be re-validated against the new athena
surface in daylight before any 3.0.2 release.

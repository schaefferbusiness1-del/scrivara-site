# 2026-07-22 acceptance session — history pulling (OFF/ON), ext 3.0.2 release train, Adam-only writeback

Goal: 2 consecutive perfect OFF pulls + 2 consecutive perfect ON pulls → release 3.0.2 → writeback (Adam J Schaeffer only).
Environment: doctor account (leeschaeffer41@gmail.com, 1458 local patients), Athena practice 22724 dept 121 (athenaCollector v26.3 FL), provider roster = ["Matthew Schaeffer, MD"] (sole entry). Extension: unpacked pinned folder at 3.0.2, digest 2fc99a53…f155e5 — byte-identical to repo source, runtime-verified via mlsPong. ONE Athena tab throughout.

## Morning state (pre-session)
- Live site b482; ext 3.0.2 source-only (parts 1–8 committed across e4f52e2 + 391bd46).
- Today (2026-07-22) had already been pulled at ~08:42 EDT by an earlier session: 17/17 appointment rows done, day complete.

## OFF pulls #1/#2 on b482 (09:45, 09:52 EDT) — receipts clean, but DUPLICATES found
Both pulls: 17/17 rows state:done (all `appointment-id:` keys, all updated post-click), day complete, coverage receipts complete+exactIdentityVerified with EXACTLY the six cards (problems, meds, allergies, summary, vitals, history) on all 17, bodies 43→43 (zero new — OFF contract held; zero lost). Timings: pull1 ~5m48s total (history 17/17 in 1m59s), pull2 4m15s (history 2m7s).
**FAIL on the zero-duplicates bar:** pull #1 created 4 exact-duplicate index rows (same date/type/textHead/source, ids ~46ms apart); 2 more pairs existed from 2026-07-21 (p_sched_dt3a1n). Base36-timestamp id forensics pinned creation windows precisely.

## Root cause (field-level, live store)
Surviving pairs were ALWAYS one identityVerified:false row + one identityVerified:true row (binding = patient id), identical content: the SAME history-card row ingested through TWO trust paths ms apart — the base card save files a VERIFIED shell; the __mlsVisitWire post-hook re-ingests chart.visits UNVERIFIED whenever its saveRef proof gate fails. `_trustCompatible` rightly refuses to merge across the trust boundary → both persist. (A second, lesser hazard: `_findPatient` preferred window.findPatient, which can serve a pre-batch clone.) Boot hydration from the server mirror also pruned 5 divergent rows between sessions (two stores, different last-writer per patient) — the 3 pairs that survived were consistent in both stores.

## Fixes shipped
- **b483** (391bd46): `_findPatient` batch-aware (getPatients first); `_collapseExactIndexDuplicates` in addVisit + deterministic post-batch heal at end of ingestChart; feat_visits pin vis7; new suite tests/visit-index-dupe-collapse.test.js (REAL store semantics: replace-upsert, frozen findPatient snapshot).
- **b484** (abe07a9): collapse regrouped by exact CONTENT with trust-twin rule — verified rows with ONE binding win, unverified twins dropped (nothing upgraded), conflicting bindings fail closed, pure-unverified groups keep earliest; pin vis8. Full 260-suite gate green both builds. Both live-byte-verified (app-version.json + script src on the doctor tab).

## OFF pull #1 on b484 (10:36 EDT) — FAILED: Athena session expired mid-pull
Schedule phase fine (18 rows now — an 18th appointment was added mid-clinic; 17 updated post-click). ALL 17 history reads refused: first "The Athena patient open reached its one absolute deadline during find patient open", rest "deferred after timeout". Retry-failed-histories (10:41) refused all 17 again in ~2m. Screenshot proof: the Athena tab was sitting on identity.athenahealth.com sign-in (mschaeffer12 pre-filled) — the athenaNet session idle-expired between 09:52 and 10:36. The refusals were honest; no wrong-patient data, no partial saves claimed. Owner notified by push to sign in (credentials are owner-only).

### Queued improvement (not blocking acceptance)
The pull/retry pre-flight verifies the MLS backend session (/api/me) but not the ATHENA session; an Athena sign-out surfaces as vague per-patient deadline refusals. The conn-truth probe already distinguishes a signed-in Athena tab — wiring it into the pull/retry pre-flight would name "Athena signed out" honestly. Do post-acceptance.

### Instrumentation note
During post-fix pulls, addVisit is wrapped in-page (window.__accDupEvents) to flag any add leaving an exact-content collapsible pair on the touched patient — zero events so far (pull aborted before history writes).

## Pending (this session)
- Owner signs in to Athena → rerun OFF ×2 (expect: 3 stranded pairs self-heal, zero new pairs, receipts as above).
- ON ×2 with 3.0.2 (All Events (N) reconcile + stable row counts), two-tab/collapse/refresh/retry probes.
- Release train 3.0.2, then Adam-only writeback ×2.

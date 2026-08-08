# 2026-08-07 — px train: patient isolation, summary quality, same-day safety + ext 3.0.46

Owner directive (verbatim /goal): fix, test, publish, verify the extension so patient
history/allergies/visits/summaries work reliably and **never leak or repeat data between
patients**. Treated as the patient-safety lane it is.

Lane: ext-goal (wt-ext-3040, branch ext/3.0.40-audit-fixes). Sign-off request posted for
`50441052a955dadd432a02a2b046a202e031e04c` — gate **PASS all 511** at that commit.

> **THE LESSON OF THIS TRAIN, at the top on purpose: every automated instrument reported
> green while the store was wrong.** The ratios passed, the hashes were unique, the
> receipts said ok:true, the suites were green — and athena documented "bee pollen / mite
> extract / NKDA" where MLS held only "NKDA"; problems/meds/surgical sections sat in the
> visit raws fleet-wide while the stored fields were empty; 26 of 34 summaries were bare
> headers under green receipts. Every one of those was found only by READING the actual
> chart against the actual panel, or by measuring raws against stored fields. An
> instrument can only fail the checks someone thought to write; the source comparison is
> the check that catches the checks. (Second form of the same law, from the fleet heal
> below: the loss column caught a 665-char deletion that every per-field "gained" number
> would have hidden.)

## What was measured BEFORE any change (live store, 1,559 patients, owner's browser)

| finding | number | class |
|---|---|---|
| identical allergy string "CEPHALEXIN, KEFLEX" across distinct patients | 25 records, ONE shared DOB, identical problems+meds, all created 2026-06-25 | the KNOWN closed 6/24–6/29 window, still displayed un-marked |
| `athenaHistorySummary` = ONLY the header line ("Longitudinal summary refreshed <d> —") | 26 of 34 records with a summary; dates through 8/5 | live defect |
| summaries with an internally duplicated passage | 8 | live defect (the "lead" + Recent-visits double print) |
| visit `aiSummary` keys holding an EMPTY STRING | 1,383 of 1,444 | unvalidated model replies stored as done |
| visits with no body (raw/aiSummary/findings/plan all <10 chars) | 2,070 of 3,329 (117 patients all-stub) | mostly by-design index rows + the visit-notes-OFF gap |
| mojibake / HTML / JSON / selector text in STORED summaries | 0 / 0 / 0 / 0 | the corruption the owner sees renders from raw bodies + [object Object] paths, not stored summaries |
| patients holding `history` as an OBJECT (renders "[object Object]" through String()) | 61 | latent render + op-note prompt defect |

## Root causes found (each verified in code by me, not only by subagents)

1. **feat_mls_b121_pack.js `matchRow` leg 3** — an upsert that would CREATE a row was merged
   into an existing record on NAME ALONE (no DOB needed on either side), and `mergeRows`
   then **concatenated allergies/problems/meds/summary across the two records** (JOINY '; ').
   Leg 1 accepted an athenaId hit with ONE shared name token. This is the live
   "new patient receives another patient's history and allergies" weld.
2. **feat_athena_autopull.js `resolvePatient`** — bound the athena chart to the FIRST
   name-match, accepted the bind when EITHER side lacked a DOB, ignored the chart MRN
   entirely, then stamped the chart DOB onto the record (papering the mismatch over).
3. **Same-day encounters could cross-hydrate**: `addVisit`'s shell upgrade took the FIRST
   empty shell on the service date (no encounter-id check), an incoming index shell could
   "upgrade" another shell, and `_compactHydratedPlaceholders` deleted EVERY keyless
   same-day shell once one body landed — a two-visit day rendered as one visit.
4. **`_aggregateSummary`** printed visits[0] twice (lead + Recent visits), had NO sections
   for problems/allergies/meds, and emitted a bare header for empty charts.
5. **`summarizeVisit`** stored the raw model reply unvalidated (1,383 empty strings) and
   summarized bodyless rows from the literal string "(no raw text captured)".
6. **Stale-async in the Patients lane**: no patient-switch epoch existed; `analyzeDoc`
   upserted its pre-await patient object (rollback class) and repainted unconditionally;
   the copy-visits bar and Summarize-all wrote patient A's progress into patient B's panel.
7. **`mlsVisitDateKeyForHint` (extension)** accepted only slash/strict-ISO dates while the
   row parser emits dash/dot dates — a dashed date keyed to '' so the day-scoped read
   (the visit-notes-OFF lane) skipped EVERY row and the day stored nothing, silently.
8. **cohort-injection visits** bypassed the identity gate (source string outside
   `_remoteVisit`); the legacy `_importPulledSchedule` fallback matched by bare name and
   stamped DOBs; `_todayStr`/connect range filters used UTC date keys (wrong after ~8 PM ET).
9. **Green athena panel "Pull history"** claimed "N visit(s) on file" while its persist
   hook (`saveVisitsViaApp`) has never existed — session-only read reported as saved.

## Fixes (px-1.0 … px-4.1, e1/e2) — see commit b087c13a + fd5d4b01 + 50441052

Strong-key-only merging/binding; ambiguity-safe same-day handling; sectioned summary with
honest empties + verified-absent lines; model-reply validation with failure receipts;
patient-switch epoch + still-active guards; object-safe rendering; local date keys;
identity-gated cohort rows; one-time store hygiene (header-only summary clearing, empty
aiSummary key removal, VISIBLE 6/24–6/29 suspect markers + profile banner — fields never
blanked); extension date-key widening + honest popup line.

## Negative controls (mandatory: old code vs new tests)

- patient-isolation-strong-key-binding vs origin/main: **FAILS at "name-only create-merge
  was accepted (leg 3 resurrected)"** ✓
- visit-summary-quality-contract vs origin/main: fails (validation absent) ✓
- same-day-shell-upgrade-contract vs origin/main: **FAILS at "ambiguous same-day shells
  were not preserved (a shell was hydrated by guess)"** ✓

## Extension 3.0.46

- zip `MLS_Assist_v3.0.46.zip` sha256 `dd9ece28d9df9ba7c829451a1cdac41282bc3ab2cd266a9fdc1517434440bb41` (419,941 bytes)
- core digest `3.0.46+core-sha256:85ce765dc5c7af1417a8444b11ceb89e123a2c3d8935107ad4bb894fd554d44c`
- Delta vs installed 3.0.45: ONLY px-e1 (date-key) + px-e2 (popup honesty) — the parked
  wf3-port/diagnostics candidate content was already absorbed into the released 3.0.45
  root via origin/main (verified by byte diff, not assumption).
- **Installed via the proven autoreload protocol** (audit → push-build.ps1 into
  `Downloads\MLS_Assist_v3.0.45`, the folder Chrome actually runs → mlsDevReload
  `{ok:true,reloading:true}` → both tabs reloaded → **pong 3.0.46 with the exact stamped
  buildId**). Installed build == tested build, by digest.

## Live E2E (running log)

- Athena signed in (dashboard fetch 200 / 92,314 bytes / no Re-Login). MLS signed in.
- Pull today (Fri Aug 7, 7 patients on the list) started on the session's own tab pair;
  receipts to follow below.
- ⚠ Instrument note: a `[role=status]` sweep read the HIDDEN agreements-gate's baked text
  ("Clinical workspace access could not be verified") and looked like a P0 — the gate was
  display:none and #appScreen visible. textContent welds hidden nodes; verified before
  believing, nothing was actually blocked.

### Fri Aug 7 live day pull under installed 3.0.46 — COMPLETE AND CLEAN

- `__mlsDayHistoryPull.state`: running:false, **done 7, ok 7, failed 0**, rows 7, no failure
  reasons. `__mlsPullLastOutcome {ok:true, at:1786150762939}` (~20:59 ET).
- Hidden-tab run, zero human clicks after the start click, self-converged (one chart took
  several extra minutes mid-batch — the documented presence pace, not a failure).
- **Store delta (the accepted proof), fresh 7-patient cohort:** 7 distinct names, 7 distinct
  DOBs — **ratio 1.00, zero identity collapse**; 1,095 problem chars; 73 visits imported,
  52 with real bodies; **zero header-only summaries in the fresh cohort; zero duplicated
  summary hashes** (two equal LENGTH pairs were checked by content hash — coincidence);
  the one repeated allergy value across all seven is literally **"NKDA"** — athena's own
  benign literal (the b754-documented shape), correct data.
- Instrument notes: (a) the hidden agreements-gate text false-alarm above; (b) the first
  "no receipts 20s after click" read was the schedule phase not yet stamping the history
  receipt — the disabled button was the honest running signal.

### Proof runs 2 and 3 (same evening, same installed 3.0.46)

- **Run 2 — Fri Aug 7 warm re-pull:** 7/7 ok, 0 failed, fresh `__mlsPullLastOutcome
  {ok:true, at:1786151211947}`, finished in **under ~3 minutes** hidden-tab.
  **Idempotency delta vs pre-pull snapshot: zero visit duplication, zero field loss**
  (anyLoss:false on all five tracked fields × 7 patients); one chart legitimately
  ENRICHED (+62 problem chars, +1,637 summary chars — the re-read completed what run 1
  left thinner). Re-pull = enrich, never delete, never duplicate: held.
- **Run 3 — Thu Aug 6 (the full 18-row clinic day), warm-ish:** day outcome
  `{ok:true, at:1786152378497}` at ~19 min hidden-tab including convergence rounds.
  First pass 16/18; the `visit-bodies-incomplete` row **self-healed in the auto-converge
  sweeps** (gone from the failure set); ONE honest refusal settled: "athenaOne patient
  search found no matching patient" — the documented hidden-tab presence class (heals
  fronted; fronting is correctly REFUSED while Chrome lacks OS focus, owner AFK). Zero
  wrong data.
- **Cross-cohort isolation, all 26 records touched tonight: 26 distinct names, 26
  distinct DOBs — ratio 1.00.** 316 visits on those records, 243 (77%) carrying real
  bodies.
- Honest count for the owner's clause 1: consecutive-clean = 2 (runs 1–2); run 3 is a
  17/18-plus-named-refusal day, not a clean sample, and the refusal class is presence,
  not identity.

### Allergy census (owner order: "double make sure allergies are not all the same") — actual strings

Whole store, 440 records with allergies populated, 19 distinct values:

| value (verbatim, truncated at 70 chars) | count |
|---|---|
| `NKDA` | 397 |
| `CEPHALEXIN, KEFLEX` | 25 — the known 6/25 contamination cluster, the ONLY non-trivial collapse |
| `[]` | 2 — empty-array junk; renders as honest placeholder after the fieldBody fix |
| `ERYTHROMYCIN BASE: Abdominal pain (Moderate severity)\nFAMOTIDINE\nLISIN…` | 1 |
| `DOXYCYCLINE\nEPINEPHRINE: Other - Shaky\nVENOM-HONEY BEE\nhigh criticalit…` | 1 |
| `IODINE: Hives\nSUNITINIB: - Contrast dye` | 1 |
| `MEPERIDINE: Vomiting - Severe body convulsions` | 1 |
| (…every remaining value a singleton) | 1 each |

Ratios: all-values 19/440 = 0.043 (NKDA-dominated, expected); non-trivial 18/43 = 0.419 —
but 25 of the 43 are the single known 6/25 cluster; **excluding it, 17 distinct / 18 rows
≈ 0.94** — no new collapse. Tonight's 26-patient cohort: 26 × `NKDA` — consistent with the
practice and with athena printing the literal; the singleton rows above prove real
multi-line allergies WITH reactions do land when documented. Still owed (post-deploy, on
the source side): per-chart confirmation including one patient verified in athenaOne to
HAVE real allergies, so "all NKDA" is proven a read, not a default.

## Adversarial review (in place of the owner-waived Codex leg) — and the fixes it forced

The owner waived the Codex sign-off for this train (his words on the board, 2026-08-08) and an
independent adversarial review ran instead. It refused to co-sign `50441052` — correctly. The
findings I confirmed and fixed (px-1.5 / 2.3–2.6 / 3.6):

1. **Twins could still weld** — matchRow leg 1's DOB arm (≥1 shared token) was the SAME
   predicate the stamper uses, so a sibling pair (same DOB + same surname) could be
   mis-stamped and then merged. Both ends now require ≥2 shared name tokens; the migration
   `scan()` got the same rule (its missing-DOB "never conflicts" hole closed). Control:
   pre-fix code fails the new suite at "twins (same DOB + surname) merged on a stable-id hit".
2. **A good summary could be blanked under ok:true** — organize's empty-aggregate clear now
   fires only when `athenaSliceReRead` proves this pass actually re-read the chart slice.
3. **The type cleaner ate laterality** ("Injection, Right Knee" → "Injection") and the
   stripped text persisted into summary + op-note context — wrong-site class. The cleaner is
   render-only now with a clinical-vocabulary tail guard (9 pinned keep-cases); the persisted
   aggregate keeps the raw type, and bodyless lines carry "(scheduled visit — no note text
   captured)" so a schedule label can never masquerade as a note.
4. Autopull's stable-id leg now requires name-or-DOB corroboration (a typo'd MRN no longer
   binds a differently-named chart); the hygiene pass no longer consumes its run-once flag on
   an unhydrated roster; the reply validator no longer refuses "<no known drug allergies>" or
   `"pain": 7` prose; the dob-conflict check is suppressed on suspect-marked records (whose
   stored DOB is the untrustworthy side); the legacy schedule fallback creates NO patient
   record for DOB-less rows (appointment posts unlinked) instead of minting a duplicate per day.

Review-verified clean (its own execution, not my claims): HDR_ONLY regex, suspect-marker
criteria, bulk savePatients safety, all shell/compaction scenarios, epoch TDZ/XSS, 43-string
date-key adversarial set, release coherence (zip/.bin byte-identical, every pin agrees).

## Content-level E2E on live b949 (the owner's sharpened bar) — measured, with text

- **Deploy chain**: b948 `a14d290b` FAILED at the Pages generated-tree audit (`.bin` had no
  exclude glob; the superseded 3.0.45 mirror published undeclared — the b946 class) →
  b949 `30c8644b` Actions SUCCESS, live-verified: app-version b949, zip 200/419,941 bytes
  sha `dd9ece28…bb41` EXACT, `.bin` mirror byte-identical, feed 3.0.46.
- **Hygiene before/after**: before — 26/34 bare-header summaries, 1,383 empty aiSummary
  strings, 0 suspect markers. b949 boot pass logged "cleaned 434" and the ASYNC
  server-mirror hydration RESTORED all of it under a consumed flag (found live; fixed as
  px-2.5.2, verify-before-flag). A post-hydration manual run: **0 bare headers, 0 empty
  aiSummary keys, 231 suspect markers — and it HELD across further sync cycles.**
- **New generator on a real chart (regenerated live)**: 5,058 chars, sections `Active or
  significant problems:` (19 coded lines — e.g. `• Lumbar radiculopathy M54.16`,
  `• Annular tear of lumbar disc M51.369`), `Allergies and reactions:`, `Vitals (latest
  captured):`, `Recent visits:`; **zero** mojibake/HTML/JSON/[object Object]/duplicated
  passages. Op-note context (`_opPatientCtx`) carries the same sections, no junk.
  (Panel render exposed px-2.7: the pre-b7xx em-dash-wrapped stamp `— Pulled from Athena
  7/27/2026 —` defeated the ownership regex and stuck forever; fixed + pinned, rides b950.)
- **Per-visit AI summary live**: force-regenerated one bodied visit → 1,802 chars,
  structured, validator-passed, **stored on the correct patient's row while the active
  patient changed multiple times mid-flight** (patient-keyed write held).
- **Same-day encounters, store + render**: the Thu 8/6 patient holds BOTH encounters as
  distinct rows (est10 `…829494` WITH body; order-group `…830537` index-only), and the
  panel renders two separate cards — the index card reading *"Index entry — no note text
  was captured from Athena"* (the honest label, live). 58 multi-visit days in the store
  retain distinct encounter ids, including a 10-encounter PT day.
- **Switching**: sequential A→B with the allergies pair — A's panel shows the real
  multi-line allergy WITH reactions (`IODINE: Hives` / `SUNITINIB: - Contrast dye`)
  matching the store exactly; B flips to exactly `NKDA`; zero carryover. Rapid-switch
  probes always showed panel === ACTIVE patient's store; strict final-state assertions are
  confounded by the bidirectional athena-follow re-selecting the athena tab's open chart —
  the product working as designed, noted as a test-condition, not a defect.
- **Instrument notes**: a CDP evaluate awaiting the model round-trip times out at 45s and
  orphans its promise — fire-and-poll (`window.__pxSum`) is the honest pattern; the
  hand-driven athena global search landed on the 16,949-char messaging frame (the
  documented noise surface, memory says 16,944) — eyes-on chart comparison needs a
  fronted window (bundled with the owner's pace-sample ask).

## Status at artifact close (final, 2026-08-08 ~00:5x ET)

- LIVE: b950 (f144b0cc), Actions success. Chain: 50441052 (sign-off request) -> 0dcc7f25
  (review fixes) -> a14d290b b948 (deploy refused: undeclared .bin) -> 30c8644b b949 ->
  f144b0cc b950 (hygiene race + legacy stamp). Gate PASS all 511 at every push.
- Extension 3.0.46 installed + pong-verified BEFORE the pushes; the published zip/bin are
  byte-identical to the installed build (sha dd9ece28...bb41).
- Post-deploy on b950, all live-verified: hygiene verify-before-flag (0/0/231 held, flag
  only after verify), sectioned summary renders in the panel (5,191 chars, zero junk),
  same-day cards distinct with honest index label, allergy-pair switch exact with
  reactions, mid-switch model reply landed on the right patient.
- Owner-present items still open, bundled into ONE ask (Chrome frontmost ~10 min):
  fronted virgin-day pace sample (sub-10 target) + eyes-on athena source comparison
  (real-allergy patient, Mucha problems, NKDA confirmation). Owner-gated and untouched:
  Web Store publish, meds decision, cohort re-pull repair beyond the visible markers.

## Owner-present window (2026-08-08 ~01:0x-01:2x ET) — comparison DONE, pace sample VOID (athena weather)

Michael fronted Chrome on the athenaOne tab and walked away (detected by the in-page focus
recorder, hasFocus true throughout; the supervisor correctly replaced the verbal handshake
with a condition poll - a confirmation would have destroyed the state it confirms).

### Eyes-on source comparison — Geoffrey Mucha, MRN 7781274 (side by side, actual text)

| field | athenaOne facesheet (source) | MLS store/panel |
|---|---|---|
| Allergies | **bee pollen** / **mite extract** / **NKDA** | **NKDA** only |
| Problems | annular tear of lumbar disc; degeneration of lumbar intervertebral disc; low back pain; Lumbar radiculitis; Lumbar radiculopathy; Lumbar spondylosis; Spondylosis of lumbar spine; Raynaud's phenomenon; Vertebrogenic low back pain; Vertebrogenic pain | same condition set, ICD-coded (19 lines incl. code variants: "Lumbar radiculopathy M54.16", "Annular tear of lumbar disc M51.369", "Raynaud's phenomenon I73.00" ...) — MATCH |
| Medications | None recorded | empty — MATCH |
| Surgical hx | operative procedure on shoulder (left x3 following dislocations); RFA of peripheral nerve w/ fluoro guidance 05-29-2026 (L5+S1 Intracept, Dr. Schaeffer) | present in visit history — MATCH |

**FINDING (real, new): allergies under-capture.** athena documents two ENVIRONMENTAL
allergens the pull never stored. The stored NKDA is genuinely documented (the drug-allergy
line) - NOT a silent default - so this is an incompleteness in the allergies-section read,
not a wrong-patient or fabrication defect. Follow-up task spawned (task_2927163d). The
IODINE-Hives patient could not be compared this window (no stored MRN on that legacy record).

### Pace sample — VOID, twice, honestly

- Attempt 1 (18-row warm Thu, fronted): refused ~T+6-7 min with no day outcome. Cause:
  my own setup - the athena tab was parked on the Mucha chart from the comparison (the
  documented stale-view class). Reason toast not captured (console tracking armed late).
- Attempt 2 (after navigating athena to the frameset): stalled in the schedule phase and
  released the mutex ~T+5:34 with zero history counters. Diagnosis: the athena tab was on
  the "We were unable to complete the requested action" interstitial the WHOLE attempt -
  and the interstitial now RE-PRESENTS on every fresh frameset load (Continue click, /ax
  round-trip, direct navigate all tried) while the SESSION IS ALIVE (dashboard fetch
  200/92,314 bytes/no Re-Login every probe). Server-side athena weather (~1 AM ET,
  maintenance hours; athenaNetwork panel carries maintenance notices). Per the standing
  rule: cool down, never grind - the fronted window was not spent on a wedged backend.
- **The sub-10-minute fronted pace clause therefore stays OPEN, unsampled tonight - not
  failed, not passed. No virgin July/August day exists any more (all 28 clinic days are
  warm), so the next sample will be the heaviest warm day, honestly labeled as such.**

## The allergy under-capture: THREE stages, all found, all fixed, chart-proven (b951+b952)

The supervisor was right to refuse the follow-up chip - fixing it in-lane exposed a second,
worse defect the first one was hiding.

1. **Extraction blind to the print shape (px-5.0, b951).** The athena print view flattens
   sections with NO colon: "... Vitals None recorded. Allergies Allergies not reviewed
   (last reviewed 06/16/2026) BEE POLLEN, low criticality MITE EXTRACT, low criticality
   Medications ...". The splitter required ":" or " - " after a heading, so the whole run
   stayed one line, no heading was recognized, coverage said detected:0, every receipt
   passed. Fixed with two unmistakable print markers (doubled heading + "not reviewed",
   heading + "None recorded") and an allergen-run expander (criticality kept, review-status
   furniture dropped, NKDA / "PENICILLIN - rash" pass through unchanged). The fixture is the
   EXACT captured substring; the control fails on the pre-fix tree.
2. **The b121 allergy cleaner erased off-list allergens on EVERY upsert (px-5.1, b952).**
   Proven live by direct assignment + read-back: p.allergies = the three-line value,
   upsertPatient, read back "NKDA". cleanAllergies collapsed the whole field to [NKDA]
   whenever NKDA co-appeared with anything outside a hardcoded 13-DRUG list - bee pollen
   and mite extract are not drugs, so they were deleted forever, which is also why the
   px-5.0 extraction fix alone did not stick. A fixed vocabulary is not the test of
   clinical reality. Now the collapse happens only when nothing but negation/furniture
   remains; five behavioral rows pinned.
3. **Chain-proof on live b952** (deployed code, real store): organize ->
   p.allergies = "NKDA / BEE POLLEN (low criticality) / MITE EXTRACT (low criticality)";
   upsert ROUND-TRIP SURVIVES; the rendered #profAllergies panel shows all three -
   side-by-side equal to the athena facesheet rows (bee pollen, mite extract, NKDA).

Coverage disclosure (owner should see the size): **1,240 of 1,561 store records (79%)**
carry NO stable athena key (mrn/athenaId both empty; 222 of them hold clinical content).
Those are legacy name-only rows - they cannot be source-verified by id and cannot
exact-bind until a fresh identity-gated pull stamps them. New pulls stamp MRN.

## 2026-08-08 — the 153-record fleet heal (round 3, on live b953) — measured, not asserted

The b951/b953 extraction fixes made the print-shape sections visible; this pass re-ran
`organizePatientHistory` over every record whose visit raws contain any of the four
run shapes (allergen CRIT runs, "- Onset:" problem runs, med-table rows, Surgical &
Procedure History sections) — 153 records, the union of four independent regex sweeps.
**Complete pre-state snapshotted per record BEFORE the run** (`__pxPreHeal3`: summary/
problems/meds/psh lengths + visits count + total raw chars), exported with the run
ledger and the post-state to `2026-08-08-fleet-heal-run3-export.json` (canonical, on
disk; extraction from page memory chunk-verified against totalLen=50257 + JSON.parse).

**Run ledger: 153/153 processed, 92 committed, 61 refused fail-closed, 0 errors.**
~57s/record (model-backed), 05:51→08:02. The refusals are the guards working, not
failures — and the supervisor's pre-registered falsifier ("0 refusals is what a
non-checking guard looks like") did not fire.

### Before/after loss table (all 153 records, current store vs pre-snapshot)

| field | gained | unchanged | SHRANK | total chars before → after |
|---|---|---|---|---|
| athenaHistorySummary | 87 | 66 | **0** | 203,934 → 804,450 |
| problems | 92 | 61 | **0** | 39,910 → 96,647 |
| meds | 91 | 62 | **0** | 11,428 → 203,802 |
| psh (standalone field) | 0 | 151 | **2** | 665 → 0 (see finding below) |
| visits count | — | **153** | 0 | unchanged everywhere |
| visit raw total | — | **153** | 0 | unchanged everywhere — source material intact |

Cross-checks that make the table trustworthy: the 14 records with `updated` older than
the run's start are EXACTLY the 14 `identity-unverified` refusals (the 6/24–6/29 import
cohort: rawTotal 118–1,889 chars, import fragments only, no real visit bodies — the
identity gate refused before any write, so their rows are bit-identical). The other 139
were touched: 92 committed, 47 `semantic-coverage-incomplete` (organize refused the
summary rebuild; 33 of those still have no summary — honest empty, not a bare header).

### The loss column caught something (the reason it exists)

**`p.psh` went 444→0 (p_sched_2b0k06) and 221→0 (p_sched_16gi2ha).** Root cause read
from code, not guessed: `psh` is NOT a canonical patient field — b953's design carries
surgical history as the "Surgical and procedural history" SECTION inside the aggregate
summary (feat_visits.js:1193); the standalone field existed on exactly these two records
because the round-2 spot-heal wrote it directly. The base `upsertPatient`
(ScribeFlow.html:10133) is REPLACE-shaped: `arr[i]` becomes the caller's object, and only
the four athena receipt fields + attested clinical fields are explicitly carried forward
— a key absent from the caller's object does not survive. organize→upsert therefore
dropped the non-canonical key. The clinical content is NOT destroyed: both records'
visit raws are unchanged (rawTotal identical), and the surgical text regenerates from
them. Disposition: re-run organize on these two ids once the app session is back and
verify the Surgical section lands in the summary (16gi2ha's rebuild was coverage-refused
this round, so it needs the re-read to pass or a hand-written section from its raws).
Class recorded: **any non-canonical field dies on the next replace-shaped upsert** —
never park clinical data outside the canonical schema + summary.

### Refusal disposition — what actually closes the 61 (Michael: the fleet is NOT "all repaired")

| reason | n | what closes it |
|---|---|---|
| semantic-coverage-incomplete | 47 | a fresh athena slice re-read per record (next pull of each patient's chart); organize then has section coverage and rebuilds. 33/47 currently hold NO summary (honest empty). |
| identity-unverified | 14 | the 6/24–6/29 import cohort — no stable identity, no real visit bodies. Closes only via the owner-gated cohort re-pull repair; visibly flagged in the meantime. |

So: 92 of 153 repaired now; 47 repair themselves as charts get re-pulled; 14 wait on the
owner-gated cohort decision.

### Spot-check pmrfjgnk73ft0 (the hand-verified calibration chart)

From the export: summary 887→3,766 chars, problems 30→253, meds 0→499, allergies
4→324 chars ("NKDA" → the real allergen strings measured live earlier on b952/b953).
Content-level eye-check of amLODIPine (filled 04/11/26) + Cholecystectomy/Hysterectomy
and the #profProblems/#profMeds panel render: **blocked by the app idle-logout** (below).

### Honest blocker + the single owner ask

At ~08:5x the MLS app tab idle-logged-out mid-analysis. The signed-in roster is
server-mirror + in-memory only (no localStorage/IndexedDB copy — verified by key census;
that is PHI hygiene working as designed). All heal writes landed before logout (every
committed record's `updated` stamp is inside the run window, and the post-state was
captured at 08:43 before the logout). Signing in is the owner's action, never mine.
**ONE ask when Michael is next at the machine: sign the MLS app back in** (tab
"MLS — Ambient AI Medical Scribe"). Then, without further input: the 2-record psh
re-organize + verify, the pmrfjgnk73ft0 content/panel check, the four raw-vs-stored
population recounts (before-numbers on record: allergens 52 missing, problems 137,
meds 150, surgical 139 empty), and — if the athena frameset is also healthy and Chrome
has OS focus ~10 min — the fronted warm-day pace sample (18-row day, labeled warm,
never compared to the 16-virgin benchmark).

## 2026-08-08 afternoon — the owner-watched sweep, the stop order, and the px-6 / ext-3.0.47 train

Michael watched the July month pull live and saw three rows: `Matthew ⚠
encounter-index-incomplete[idx:other;0/0;p10]`, `Elizabeth ⚠
history-organization-unproven`, `Edward ✓ saved` — and ordered the sweep
stopped and the causes fixed on sight ("its not done till all these say saved
and its actually right"). The sweep was hard-stopped (the si engine exposes no
stop flag — tab reload after persisting every receipt), and all three causes
were found, fixed, controlled, and shipped as b956 + extension 3.0.47.

**Elizabeth's root cause was NEITHER a print shape NOR the parser — it was the
coverage tracker's arithmetic.** Her tracker receipt read `history.family:
detected 7 / parsed 2 / complete false`. Live extraction of her own raw proved
the parser fine: `_sectionValues(raw, ['family history','family'])` returned
`["Father - Family history of stroke"]` on the exact "failing" text. The five
"misses" were visits where athena prints a REVIEWED section with zero rows as
the bare heading pair ("Family History Reviewed Family History" → straight
into Social History): 0 entries + 0 explicit-empties → `missed++` → the whole
chart refused as semantic-coverage-incomplete — while the one real family fact
WAS captured. px-6.0: a PRINT-form heading whose block ends empty records
explicitEmpty (that is the section's own honest empty); colon-form empties
keep missing honestly, pinned by a control so ambiguity can never be flipped
to ok. Old code fails the control at EXIT=1 on "an empty Reviewed section was
booked as a coverage MISS"; new suite 84/84 with an end-to-end organize arm.
**This arithmetic is the fleet's 47-refusal class from the round-3 heal.**

**px-6.1 — a gate that discards the evidence of its own refusal** (class named
here for the artifact): si's history proof chain required organize `ok:true`
and threw a bare "history-organization-unproven", discarding organize's reason
and missed-section list — which is why Elizabeth's row was an unexplained
warning on the owner's screen while organize knew exactly what refused. The
row now renders "history-organization-unproven: <reason> - sections detected
but not captured: <list>". The control executes the REAL extracted throw
block against a stubbed refusal and asserts the exact composed message — a
placeholder cannot pass it.

**Matthew's `[idx:other;0/0]` decoded**: the enumerate op's no-group return was
a bare `{ok:false,count:0,score:0}` — no reason, no surface proof — fired when
NO encounter-row group exists in the reached frame AND no explicit empty-state
marker is present. Ten identical passes of an anonymous refusal. ext 3.0.47:
the return names itself `no-encounter-group` and proves its surface (frameUrl
+ whether the "Visits and Cases" pane text was on screen); the receipt tag
maps it `nogroup`. BOTH arms pinned per supervision rule: the named-refusal
arm fails pre-fix (EXIT=1 proven), the verified-empty ACCEPT arm stays
distinguishable — a refusal can never degenerate into refusing everything,
and an honest empty stays recognized. His stored state (28 visits totaling
621 chars — index shells from the failed read) is queued for a live re-read
on 3.0.47, which will now NAME any failure it hits.

**The checklist that could not prove a true fact**: `probeAthenaOpen` rode a
full `mlsAppReadChart` — which rides the read-engine lease — so the killed
sweep's stale lease wedged the probe (2×12s timeouts) while athena sat open
and signed in, and the first-run card sat on "1 of 3" refusing (honestly) to
accuse. devReload cleared the stale lease; durable fix = ext 3.0.47's new
lease-free `mlsAthenaPresence` verb (same verified tab picker the pull engine
trusts, login/identity pages excluded, no lease, no chart read) + px-6.2
feature-detected in feat_athena_guard (older extensions fall through to the
old probe unchanged).

**The twin-tab clobber (measured before the fixes, repaired by round 4):** the
round-3 heal's results were overwritten ~45.6s behind each write (machine-
regular deltas, 45,594–47,515ms) by the second app tab — signed in with a
pre-heal roster, renderer wedged, hidden-tab timers clamped — and its stale
lineage won at sign-in re-hydration. 98 of 153 records regressed (97
summaries / 98 problems / 35 meds) vs the serialized 08:43 export; the twin
was closed; a 150s zombie census (0 foreign writes across 1,567 records)
cleared the field before round 4. Round-4 re-heal ran with the ≥90s staggered
verify + final full sweep the supervision demanded (numbers in the table
below). Durable fix still OPEN: a cross-tab save shield for the roster save
path (the pull engines have one; saves do not). Until it ships: ONE app tab
at a time.

**The ship itself took three drift-merges**: the avatar lane shipped b955 +
guards during my gates (their new stale-tree suite twice refused my stale
baseline — correctly), and the landing window came from a coordinated
push-hold ("change the traffic, not the gate"). b956 `b485d05f`, gate PASS
all 513 with "PASS all NNN" confirmed as text (a truncated run is no
verdict). Three escaped-regex pin instances moved this train
(zip form, digest form, span-wrapped versions) — that class now has three
scars in one night.

**3.0.47 upload chain, re-proven at the new version (all three assertions):**
feed publishes 3.0.47 with honest notes; served GET×2 through the app origin
= 200 / 420,631 bytes / sha `81c7bd84…7ae113` = build sha exactly; installed
folder (the audited `Downloads\MLS_Assist_v3.0.45` path — same folder, never
a new identity) 20/20 byte-identical to the published zip; running copy pongs
`3.0.47+core-sha256:3c6f6c95…4b7168`. Settings-card eyeball pending the app
reload. The 2026-08-08 day-pull receipt: first-attempt, 67s, ok:true
complete:true reason:empty-day with athena VERIFYING the empty Friday —
banked as the EMPTY-DAY SHAPE only, never as convergence proof.

## 2026-08-08 evening — the July-1 popup runs, the denylist defect, and ext 3.0.48 (b961)

**Run 1 on b957 + ext 3.0.47 (the fixed-code proof the owner asked for):**
schedule 19/19 idempotent (0 created, 19 skipped — no duplicates), histories
19/19 attempted, **Elizabeth ✓ SAVED (the px-6.0 arithmetic fix held live:
identityVerified, organized, organizationComplete, visitsComplete,
clinicalFieldCount 5) and Matthew ✓ SAVED (real read replacing his 621-char
index shells)** — 11/19 clean, honestly marked INCOMPLETE with 8 NAMED
failures (the 3.0.47 receipts working): 6× idx:nogroup + 2×
visit-bodies-incomplete. NOT a pass — the bar is all 19.

**Run 2 (same day re-check): 14/19 ✓** (Lorraine, Cheryl, Diann recovered),
5 persist {Edward, Herbert: nogroup; Carol, Nancy: unchanged-stuck; Atoussa:
bodies} — and the persisters SWAP failure classes between runs. Run 2
persisted per-patient enumDiag, and it named the real defect: **on every
index-failure, ONE frame (7307) answered ok while every sibling was
no-group — and the URL denylist (inbox|messag|stm.esp|…) dropped the ok
frame before best-pick.** An ok:true enumerate result has already passed the
in-frame positive gates (Visits-and-Cases ancestor, declared SHOW total or
explicit empty-state, row stability) — a URL token was outvoting the
positive assertion. The collector-denylist class, in the reader itself.

**ext 3.0.48 (b961 `3accf8c2`, gate PASS all 514):** the noise filter rescues
ok:true results (non-ok noise stays excluded — the denylist keeps its
original job of blocking junk no-group frames), and failure receipts now
persist okShape + noiseTails so the next unexplained failure names itself.
Both-arms control (16 checks): the gated ok result survives the filter —
pre-3.0.48 code fails EXIT=1; non-ok noise stays excluded; non-noise frames
untouched. Upload chain re-proven at 3.0.48: feed 3.0.48 + honest notes;
served GET×2 200/420,933B sha `b8bc12fb…` = build sha; installed folder
20/20 byte-identical; pong `3.0.48+core-sha256:f9a55e7b…`.

**Session state at this writing:** the MLS server session expired on BOTH app
tabs mid-evening (sign-in is the owner's click, never mine) and fresh athena
frameset loads are interstitial'd again (his own athena tab stays healthy but
carries a pre-reload content script until he refreshes it). The decisive
day-1 run 3 on the rescue fix — expected to flip the 5 persisters — plus the
full July sweep, cohort, recounts and pace wait on those two owner clicks.
Heal-round-4 recovery evidence is on disk (2026-08-08-heal4-recovered.json:
80/98 at-or-above healed values after a full server round-trip, 18 short
listed, verified-at-90s 78/78 before the ledger died in a tab reload).

## 2026-08-08 night — runs 3 and 4, the 1,340 never-read class, and the honesty trains

**Run 3 (b961 + ext 3.0.48): 13/19 ✓ full-proof-chain, 6 failed, all named
`no-chart-frame-candidate[stm.esp~noise-surface]`** — the 3.0.48 index rescue
worked and the failure moved one stage upstream to the body-walk's own copy of
the URL denylist. ext 3.0.49 (b964): the walk's noise drop is
identity-decided — a noise-URL candidate reaches the SAME visitIdentityGate
every chart frame passes and is dropped only when its own identity fails the
frozen patient; the 2026-07-24 enterprise-worklist weld stays dead; both arms
pinned, pre-fix EXIT=1 proven. Set-shift evidence across runs (Diann/Atoussa
flipped ✓, Sarah flipped fail) fingerprints per-session frame-layout rotation
— which is why the fix is identity-based, never URL-based.

**Run 4 (b964 + 3.0.49, owner-watched, stopped on his order at ~30 min):**
partials before the stop: **Edward ✓ SAVED — a two-day persister flipped by
the walk rescue** — Matthew ✓ again; Elizabeth FLAPPED (✓ in run 3 → ⚠
`visit-bodies-incomplete(encounter-surface-not-open ×1,
stable-source-keys-incomplete ×1)` in run 4): her body-detail surface failed
to open in the frame variant that session dealt her. The flap itself is the
finding — draw-dependent frame variance survives at the per-row detail stage;
the census-evidence pass on her chart is the queued next diagnostic. Statuses
and timing serialized (`__pxJul1dPartial`).

**Pace, honestly:** run 3 ≈ 26 min and run 4 ≥ 30 min for a 19-chart history
day against the sub-10 bar. Run 4 main-pass per-chart gaps averaged ~52s
(16-117s spread) — comparable to run 3, so 3.0.49's identity checks did NOT
triple per-chart cost; the balloon is the automatic RE-CHECK TAIL cycling
incomplete charts. Pull correctness is converging; **pull pace misses the bar
~3× and the fronted warm-day pace sample has still never been run.** Open
engineering, not a footnote.

**Patricia Kirwin and the 1,340 (the day's most important finding):** her
Monday-imported card rendered six empty boxes and a stored lone "NKDA" as if
it were a chart fact — record `p_sched_voax7p`, ZERO chart reads ever
(coverage receipt null, 2 index shells, 0 raw bytes). She is not in any prior
cohort: she is the **never-read class — 1,340 of 1,567 records (85%) have no
coverage receipt and no clinical content.** Every fix this train made reads
CORRECT; nothing yet made them RUN for the back catalog (the fleet heal only
ever touched the 153 records that had raw content to re-parse). Program, not
a claim: day pulls with history close it day-by-day; at ~19 charts per
20-30-min run, the backlog is ~70 pull-days of work as currently paced —
pace engineering shortens that directly.

**The honesty trains (shipped b963-b96x):** the cross-tab stale-lineage save
shield (svs-1.0.0 — a writer may only replace a record it has observed;
wrapper-chain suite caught my own first cut mutually recursing in 4 of 30
load orders before it shipped); and the three-state rendered-card contract —
never-read says "not pulled yet" IN WORDS on both card surfaces, an
unverifiable lone-NKDA is annotated "unverified (no Athena chart pulled
yet)", read-and-empty keeps its quiet dash, content renders as content
(11-check suite, both arms, on both surfaces). Deploy-chain scar repeated
and cured structurally: a NEW root file must join
pages-publication-inventory.json or the Pages audit refuses the whole deploy
(b963+b964 both failed on the undeclared shield file; the b954 class).

### The op-note "wrong medications" link (stated as code-established, not yet outcome-proven)

The op-note context consumes `p.meds` (feat_opnote_history.js:261; ScribeFlow.html
~16338). Before this train, ~98% of med-table rows present in visit raws were absent
from `p.meds` — the op-note model was drafting against starved context, which is a
plausible mechanism for the owner's "wrong medication" complaints. After the heal,
`p.meds` fleet-wide went 11,428→203,802 chars. Whether this closes the complaint is
NOT yet proven — that takes op-note drafts on real charts compared against the owner's
template expectations, which stays on the op-note quality lane.

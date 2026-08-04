# MLS Assist Extension — Master Requirements Ledger

**Synthesized:** 2026-08-04 · Merged and deduplicated from 344 raw requirements across memory, handoffs, live-evidence artifacts, test contracts, and release notes.
**Status legend:** **PROVEN** = live-verified in the source artifacts · **SHIPPED-UNPROVEN** = built/deployed but no live proof cited · **GAP** = known unmet, deferred, or explicitly open.

---

## 1. PULL CORRECTNESS

| # | Requirement (merged) | Strongest source(s) | Status |
|---|---|---|---|
| 1.1 | **The governing bar:** the extension always does perfect Athena pulls with perfect history at a decent pace — all three conditions, none negotiable. Escalated 2026-08-04: "perfect every single time so I never have to change it ever again… and fast every time." | pull-definition-of-done-and-noop-proof.md; ext-3040-candidate-in-progress.md; HANDOFF_TAKEOVER_2026-07-28.md | **GAP** — correctness legs proven repeatedly; the pace leg's timed sub-10 proof is explicitly PENDING |
| 1.2 | ALWAYS = repeated clean runs across days, providers, and pull shapes; one clean run is a sample; any failure restarts the count. | pull-definition-of-done-and-noop-proof.md | PROVEN as method (multi-day campaigns: 21/21, 18/18, 20/20 held) — count remains open by definition |
| 1.3 | PERFECT HISTORY = every scheduled patient enumerated, actually navigated and READ (never stamped), every populated Athena section landing in MLS (benchmark 37–44 sections/chart). | pull-definition-of-done-and-noop-proof.md | PROVEN on recent runs (Tue 20/20, Mon 18/18 with snapshots+histories, store-verified) |
| 1.4 | First-attempt completeness: a pull requiring a human re-pull is a failure. Setup for a normal customer is nothing beyond signing into Athena. | HANDOFF_TAKEOVER_2026-07-28.md; visit-bodies-default-on.md | PROVEN on latest runs (zero retry clicks, self-converged) — must keep holding |
| 1.5 | Pulls start only on explicit user click; sign-in, MLS load, patient switch, extension reload never auto-pull; relay executes only phone-queued jobs at-most-once; the passive stash never imports on its own. | FABLE_EXTENSION_HANDOFF_2026-07-14.md; HANDOFF_COMMERCIAL_READINESS_2026-07-21.md | SHIPPED-UNPROVEN (design law; no violation reported) |
| 1.6 | Visit bodies DEFAULT ON as a tri-state preference; explicit human choice respected both ways; per-pull relay override outranks all; the phone's choice travels in dedupeKey so ON never coalesces onto OFF. | visit-bodies-default-on.md; 2026-07-28-b762-first-pull-completeness.md; phone-app-already-existed.md | PROVEN (b762 live; dedupeKey fix shipped) |
| 1.7 | Every pull files under the day Athena ACTUALLY shows: page-date==target verified before filing, fail closed; gotoDate returns ok only when the landed surface is the day schedule AND its header equals the requested date; weekstrip reports the OBSERVED date, never echoes the target; date guard NAMES any stray date it ignored. | model-check-and-calendar-day-rule.md; ROOT-CAUSE-wrong-surface-pull-2026-07-28.md; ROOT-CAUSE-weekstrip-echoes-target-2026-07-28.md; 2026-07-26-b711-release-regression.md | PROVEN (guard fired and named the stray live; week-boundary goto shape 18/18) |
| 1.8 | App-side defense-in-depth: cross-check the read's own schedDate against the requested day before importing; refuse dashboard/widget surfaces (wrong-day-surface). | ROOT-CAUSE-weekstrip-echoes-target-2026-07-28.md | SHIPPED-UNPROVEN |
| 1.9 | Count DISTINCT appointment ids/rows, never attribute nodes (~5.6x duplicate render); dedupe the double-rendered day list while keeping genuinely provider-less appointments; hard-exclude staff-message/coordinator/letters frames at 3 layers. | athena-dashboard-is-a-week-tabbed-widget.md; ext-v295-quiet-pull.md | PROVEN (live 50→25 dedupe with receipt) |
| 1.10 | Schedule coverage complete across all views (scrolled, virtualized, legacy list, calendar); OPEN slots ignored; no last-row loss; exact Athena wall times; capacity/staff artifacts never become patients. | FABLE_EXTENSION_HANDOFF_2026-07-14.md | SHIPPED-UNPROVEN (handoff bar; per-view proof not cited) |
| 1.11 | Never match an EMR name by string equality — canonical name key + DOB agreement + uniqueness; no case-insensitive stop-lists in name parsing (surname-ambiguous STOP exemption at the merge filterSource call site only, shared STOP untouched). | exact-name-equality-never-matches-an-emr.md; stoplist-deletes-real-patient-names.md; 2026-07-29-3033-live-proofs-and-qa-train.md | SHIPPED-UNPROVEN — 3.0.37 exemption shipped; explicit rule: don't claim proven until a failing row re-enters the changed path |
| 1.12 | Never bind rows positionally to the nearest preceding provider header; fix only the header HARVEST; rows that cannot bind unambiguously stay unattributed and the day refuses. | positional-provider-attribution-is-unsafe.md; 2026-07-29-3033-live-proofs-and-qa-train.md | PROVEN as refusal design (adversarially refuted with 4 real shapes before any code) |
| 1.13 | Provider roster verb enumerates Athena's authoritative provider picker/department list (not grid headers), as a new roster source with its own receipt; selector lists the real roster; all-provider/one-provider/full-calendar/month pulls count every appointment before claiming success. | 2026-07-23-goal4-validation.md; FABLE_EXTENSION_HANDOFF_2026-07-14.md | **GAP** (picker-ingest proposed, not shipped) |
| 1.14 | Merges never delete an Athena slice they did not re-read; absence is not permission to delete; deleting while reporting ok:true is banned (organizePatientHistory/_mergeOwnedText clobber class). | problems-halved-by-our-own-merge.md; HANDOFF_TAKEOVER_2026-07-28.md | SHIPPED-UNPROVEN — root cause found and named a shipping blocker; later clean 20/20 runs are indirect evidence only |
| 1.15 | Chimera ban: upsertPatient carries the receipt-ATTESTED clinical slice WITH proof fields at both choke points; a fresh receipt is never restored onto stale clinical fields. | third-mechanism-chimera-upsert.md; 2026-07-28-b762-first-pull-completeness.md | PROVEN ("found and fixed", both choke points, live artifact) |
| 1.16 | ICD-10 wording never shredded: comma splits only when the value has no semicolon and no newline. | problems-halved-by-our-own-merge.md | SHIPPED-UNPROVEN |
| 1.17 | A read finding every card not_documented still SAVES ("we checked and there is nothing" is a valid read); chart reader waits for the patient banner and rejects provider-credential strings as names. | signed-out-athena-stamps-19-charts.md; live-test-v157-history-pull-broken.md | SHIPPED-UNPROVEN |
| 1.18 | Order-group rows filed as unverified index-only administrative entries, never silently skipped; day-scoped reader narrates out-of-day rows, files them index-only, and excludes them from exact-count arithmetic. | pull-reliability-speed-saga-b368-b375.md; 2026-07-28-b762-first-pull-completeness.md | PROVEN (b762 live) |
| 1.19 | Transient per-patient failure = per-patient SKIP, never a global batch abort. | day-history-pull-reader-fix.md | SHIPPED-UNPROVEN |
| 1.20 | Idempotent re-pulls: enrich existing patients, zero duplicate patients/appointments/visits, manual edits preserved, history entries never multiplied; every ledger row keyed by a real appointment-id. | FABLE_EXTENSION_HANDOFF_2026-07-14.md; pull-3024-b741-2026-07-27.md | PROVEN (ledger stayed 18/18 done through re-pull) |
| 1.21 | Empty days accepted only through the settled-empty gate (900ms settle re-read → emptyStable; __authoritativeEmpty requires it), never stamped from a mid-flip frame. | ext-3040-candidate-in-progress.md; 2026-08-03-fg11-live-proof-and-always-evidence.md | PROVEN (verified-empty 0/0 live via er-1.2) |
| 1.22 | Completeness gate counts IDENTITIES not just bodies (census-vs-walk reconciliation) — a phantom text row must not mask a dropped DOM row under complete:true. | ext-3040-candidate-in-progress.md | **GAP** (flaw named, fix not cited) |
| 1.23 | Six organized chart areas (Problems, Medications, Allergies, Summary, Vitals, History & background) populate only with verified source data; AI-bound summaries continuously sanitized of leaked sketchpad/SVG markup with zero clinical loss. | FABLE_EXTENSION_HANDOFF_2026-07-14.md; day-history-pull-reader-fix.md | Areas: SHIPPED-UNPROVEN · Sanitizer: PROVEN (0 dirty / 0 loss) |
| 1.24 | Capture the appointment-briefing problem list attributed via appointment id while identity verification stays on the clinical chart (two-phase, never reroute). | pull-definition-of-done-and-noop-proof.md | **GAP** (planned) |
| 1.25 | Medication capture (real network round trip per patient): the pace-versus-completeness trade-off is the OWNER's call — meds are not in the DOM. | medications-are-not-in-the-dom.md | **GAP** (owner decision pending) |
| 1.26 | Chart-identity verb gets an execution budget + targeted-frame injection (allFrames hangs on hollow framesets); all-visits reader proves the chart frame belongs to the EXPECTED patient before reading (re-settle, not refuse-after-read); visits read tab-bound. | pull-3024-b741-2026-07-27.md; 2026-07-23-goal4-validation.md | SHIPPED-UNPROVEN (queued for 3.0.25; current channel 3.0.44; no dedicated live proof cited) |
| 1.27 | Fast-lane today's-note read stays a POST-SWEEP sequential fully-awaited pass (in-loop racing design was live-falsified). | 2026-07-28-b762-first-pull-completeness.md | PROVEN |
| 1.28 | Bidirectional Athena↔MLS follow: automatic both directions, exact unique name+DOB resolution, default-ON with Settings off-switch, missed pings retried never cached as a verdict. | bidirectional-follow-shipped-b723.md | PROVEN (proven live b723) |
| 1.29 | 3.0.32-scope carry-forward: bounded per-row re-verify, fail-closed non-clinical row classification, unverifiableRows receipt contract, week-tab header variant chain. | 2026-07-28-b776-evening-pull-and-ship-ledger.md | SHIPPED-UNPROVEN (carried into later trains) |
| 1.30 | Zero-wrong-data bar on every pull: no wrong names, wrong days, phantom rows, or false stamps — ever; under renderer degradation the pull cools down and converges later rather than grinding. | 2026-08-03-fg11-live-proof-and-always-evidence.md; ext-3040-candidate-in-progress.md | PROVEN on cited runs (19/20 stored, zero wrong data) — standing invariant |

## 2. REDUNDANCY / CONVERGENCE

| # | Requirement (merged) | Strongest source(s) | Status |
|---|---|---|---|
| 2.1 | When a pull ends with only bodies-class failures, the extension drives the retry ITSELF (bounded rounds, worker-paced, no screen touching, "no yanking") until the retry queue empties — zero human clicks. | visit-bodies-default-on.md; 2026-07-28-b762-first-pull-completeness.md | PROVEN (queue emptied live; Mon 18/18 self-converged) |
| 2.2 | Auto-convergence uses a DENY-list: sign-in, session, identity, schedule, wrong-day, and permission failures stay human-first; every other reason auto-retries. | ext-3040-candidate-in-progress.md | SHIPPED-UNPROVEN |
| 2.3 | Transient refusals (partly-read, roster-incomplete, nav-failed) auto-re-pull twice with settle time before surfacing; fail-closed gates untouched. | 2026-07-28-b776-evening-pull-and-ship-ledger.md | SHIPPED-UNPROVEN |
| 2.4 | Human-only "Retry failed histories only" for real failures; retry receipts freeze DOB/MRN proof and refuse changed/malformed identities; no automatic retry of human-first classes exists. | CLAUDE_CODEX_EXTENSION_SYNC_2026-07-14.md; CLAUDE_FINAL_TAKEOVER_HANDOFF_2026-07-15.md | SHIPPED-UNPROVEN |
| 2.5 | Store-complete days must not keep showing "Retry failed histories only (1)" — cosmetic receipt-level stragglers must converge. | 2026-08-03-fg12-live-first-pass-and-latch-discovery.md; MEMORY.md | **GAP** (two stragglers open; data itself store-verified) |
| 2.6 | Presence/settle-front assist extends to the encounter-INDEX read (quiet index reads fail ~35–50% on new patients, heal 100% fronted). | 2026-08-03-fg11-live-proof-and-always-evidence.md; ext-3040-candidate-in-progress.md | **GAP** (scoped, not shipped) |
| 2.7 | Backgrounded/throttled retry lane is treated with patience — it can look frozen across polls then settle; never re-click. | pull-3024-b741-2026-07-27.md | PROVEN as operating rule |

## 3. PACE

| # | Requirement (merged) | Strongest source(s) | Status |
|---|---|---|---|
| 3.1 | DECENT PACE is a real gate: wall-clock total, per-patient time, and where it goes are measured; correct-but-slow fails as hard as fast-but-wrong. | pull-definition-of-done-and-noop-proof.md | Standing gate — currently **GAP** (see 3.2) |
| 3.2 | Land a comparable ~20-patient fronted virgin day in under 10 minutes with zero human retry clicks — the timed proof that closes the owner's decent-pace clause. | 2026-08-03-fg12-live-first-pass-and-latch-discovery.md; MEMORY.md | **GAP** — virgin heavy day honestly FAILED at ≈21 min; sub-10 proof explicitly pending |
| 3.3 | pace-1.0 machinery: busy-refusal BEFORE warmUpDay navigation; fronted first-attempts get the full 195s budget while quiet batches keep fail-fast ceilings. | MEMORY.md (b865 live state) | SHIPPED-UNPROVEN (live on b865; timed proof outstanding) |
| 3.4 | Remaining pace train: next-chart nav overlap (pipelining), tighter sweep scheduling; sweeps are currently SERIAL. | 2026-08-03-fg12-live-first-pass-and-latch-discovery.md | **GAP** |
| 3.5 | Fixed sleeps replaced by readiness polls; fast machines skip ahead but slow charts still get full deadlines; per-stage timing receipts. | HANDOFF_2026-07-17_WRITE_SPEED_PROVIDER.md | SHIPPED-UNPROVEN |
| 3.6 | The one-window bodies throttle is closed structurally (e.g. explicit pull-time activation lease). | 2026-07-28-b762-first-pull-completeness.md | **GAP** (explicitly "not shipped here") |
| 3.7 | Speed changes ship only after exoneration against hands-off baselines: revert first, isolate variables, re-add; validation runs valid only hands-off. | pull-reliability-speed-saga-b368-b375.md | PROVEN as method |

## 4. WRITE-TO-ATHENA SAFETY

| # | Requirement (merged) | Strongest source(s) | Status |
|---|---|---|---|
| 4.1 | Write floor is review-first: Sign/Save is human-only; MLS never finalises an encounter; orders hard-blocked in every automated path (no auto-submit/sign, no prescriptions/billing). | HANDOFF_2026-07-21.md; autonomy-recommended-default.md | PROVEN as enforced law (no violation across all artifacts) |
| 4.2 | Real-patient writes forbidden except the schaeffer,adam / [MLS TEST] target (MRN 7833832), one unsigned draft only; write tests prove persist + audit stamp + read-back + clean delete on cold reloads. | day6b-2026-07-11-v209-writeproof.md; HANDOFF_2026-07-16_READ100_WRITE_TEST.md | PROVEN (full cycle verified on Adam, left CLEAN) |
| 4.3 | Pre-write fail-closed capture-phase gate blocks BEFORE the bridge fires on NO_PATIENT, DOB_MISMATCH, STALE_CONTEXT, PROVIDER_MISMATCH, NO_DESTINATION, ATHENA_DISCONNECTED, LOW_CONFIDENCE. | task9-10-writeback-safety-built.md | SHIPPED-UNPROVEN |
| 4.4 | A write confirms only by CHANGE: all typing drivers snapshot the field pre-write; any "looks filled" fallback refuses an UNCHANGED field; confirmed:true means the exact field was re-read and matched (authoritative readback). | cross-tab-pull-shield.md; writeback-surfaces-map.md; 2026-07-28-b762-first-pull-completeness.md | PROVEN |
| 4.5 | Fail-closed encounter binding: a write needs date + provider + appointment/encounter id; MLS never guesses an encounter; every write is exact-patient/exact-encounter bound, immutable after confirmation, with a separate explicit human confirmation. | pull-3024-b741-2026-07-27.md; FABLE_EXTENSION_HANDOFF_2026-07-14.md | SHIPPED-UNPROVEN |
| 4.6 | No action chains: placing one item never auto-triggers Save/Sign/Bill/order/prescribe/refer; suggestions never silently become orders or billing; unknown/unsupported destinations stay blocked; writes/orders are deliberately NOT relay job kinds and unknown relay kinds refuse explicitly. | FABLE_EXTENSION_HANDOFF_2026-07-14.md; phone-app-already-existed.md | SHIPPED-UNPROVEN |
| 4.7 | One unified final review page shows exactly what goes to which Athena destination — no duplicate competing write surfaces. | FABLE_EXTENSION_HANDOFF_2026-07-14.md | SHIPPED-UNPROVEN |
| 4.8 | V2 write lane probe mode = full read-only rehearsal before any live write. | ext-3040-candidate-in-progress.md | SHIPPED-UNPROVEN |
| 4.9 | Known open write-path debts: pastenote's largest-textarea has NO identity gate (needs the athena refusal pattern); pickSuggestion must not blindly click the first item. | ext-3040-candidate-in-progress.md | **GAP** (explicitly open) |
| 4.10 | Commercial readiness requires writeback hardening + 5 verified live writebacks on Adam J Schaeffer ONLY. | HANDOFF_COMMERCIAL_READINESS_2026-07-21.md | **GAP** (count not documented complete) |
| 4.11 | Op-note generation receives exact patient ID, DOB/MRN proof, pulled visits, organized history, chosen template — and never fabricates unsupported history or procedure facts. | FABLE_EXTENSION_HANDOFF_2026-07-14.md | SHIPPED-UNPROVEN |

## 5. HONESTY / BANNERS / RECEIPTS

| # | Requirement (merged) | Strongest source(s) | Status |
|---|---|---|---|
| 5.1 | Success is claimed ONLY on store/content delta: a receipt, stamp, or counter is never evidence of a capture; verify via getPatients() (localStorage is compressed MLSZ1 — raw reads lie); compare content against a pre-pull snapshot; never count fields the broken path cannot produce; a merged field is never evidence of a fresh read. | signed-out-athena-stamps-19-charts.md; pull-definition-of-done-and-noop-proof.md; 2026-08-03-fg11-live-proof-and-always-evidence.md | PROVEN as the operating verification method |
| 5.2 | Success numbers connect to outcomes — "19/19, failures 0" while zero characters changed is the canonical forbidden violation; every supervising gate must FAIL when a wrong fix is applied. | pull-definition-of-done-and-noop-proof.md; positional-provider-attribution-is-unsafe.md | PROVEN as law (the violation was caught and eliminated) |
| 5.3 | Three-state status rendering everywhere: succeeded / failed / don't-know-yet; pending never renders as failure; per-patient rows say "done" when done; quieting noise never demotes a real fault — unrecognised reasons stay failures. | in-progress-rendered-as-failed.md | SHIPPED (fixed on 3 surfaces in one day) — SHIPPED-UNPROVEN fleet-wide |
| 5.4 | Receipts name the failing STAGE and the exact failing conjunct (snapshotParse, attributionCoverage.verdict, invalidRows[].reason); per-row failure reasons persist onto patient receipts (no empty strings); the receipt states how many rows carry a hard identifier vs name-search fallback — a skipped guard must not look passed. | stoplist-deletes-real-patient-names.md; 2026-07-29-3033-live-proofs-and-qa-train.md; ROOT-CAUSE-identity-spine-never-starts-2026-07-27.md | Diagnostic-receipt method PROVEN (settles defects in one live run); hard-identifier count SHIPPED-UNPROVEN |
| 5.5 | Failure taxonomy is honest and precise: signin-expired / nav-failed / calendar-read-unverified / provider-roster-incomplete each carry a real meaning and remedy; verdict banner arithmetic must close (expected N, found N, resolved X, unresolved Y with reasons); the import ledger receipt (all rows state:done + date in schedImportDaysV1) is the ONLY accepted proof a pull works. | FABLE_EXTENSION_HANDOFF_2026-07-14.md; mls-athena-pull-verify SKILL.md | PROVEN (skill proven 14/14 + day-complete) |
| 5.6 | Batches end with ONE calm aggregate summary; popup storms suppressed but no real failure ever hidden or converted to success; at rest the strip shows NOTHING — success is a toast only with __mlsPullLastOutcome as machine receipt; progress bar streams honest named stages and never freezes at "Starting…". | CLAUDE_FINAL_TAKEOVER_HANDOFF_2026-07-15.md; ext-3040-candidate-in-progress.md; pull-experience-truth-b402.md | SHIPPED-UNPROVEN |
| 5.7 | Session-expiry honesty: goto failures probe the session; banner says "Athena signed you out (its idle timeout)" not "try again"; blank frameset surfaces as sign-in-again; receipt-gate failures say "update MLS Assist on THIS computer"; sign-in/wrong-day failures never blame the extension. | ext-3040-candidate-in-progress.md; pull-experience-truth-b402.md | SHIPPED-UNPROVEN |
| 5.8 | Presence honesty: per-read presenceFrontedReads/presenceQuietReads (batch-global flag was wrong); banner hints when ANY read ran quiet; incomplete-history banners disclose that fronting would have finished the reads. | 2026-08-03-fg12-live-first-pass-and-latch-discovery.md | PROVEN (fg-1.2/1.3 live) |
| 5.9 | When the focus-owned gate refuses fronting, the receipt + banner disclose "retry needs you in this Chrome window" instead of looking like a failed heal. | 2026-08-03-fg11-live-proof-and-always-evidence.md | **GAP** (scoped, not shipped) |
| 5.10 | A stale painted grid must never be reported fresh — nothing today distinguishes hours-old scraped rows from live ones (a cancelled appointment silently survives). | signed-out-schedule-pull-works.md | **GAP** (known open; narrowed by 07-31 finding that the grid frame IS replaced on session death) |
| 5.11 | A failed read must never render as an empty day — "No patients scheduled" from an HTTP failure is a forbidden clinical claim. | signed-out-schedule-pull-works.md | **GAP** (default-ON rewriter class named) |
| 5.12 | One-click PHI-free error report after any failed pull (build, UA, ext version, reason, gate receipts, status lines). | pull-experience-truth-b402.md | SHIPPED-UNPROVEN |
| 5.13 | Duplicate extension installs detected and NAMED (two bridges answering = eternal "not verified"); warn, never block. Settings shows the INSTALLED version with an update hint when it lags the channel. | pull-experience-truth-b402.md; extension-autoreload-protocol-proven.md | SHIPPED (b677 fix) |
| 5.14 | No silent half-success anywhere: a path that cannot complete says so rather than painting the successful-looking half. | exact-name-equality-never-matches-an-emr.md | Standing law — enforced case-by-case |
| 5.15 | Day completeness requires Athena's own declared count; absent one, report "unverified count", never "complete". | ROOT-CAUSE-wrong-surface-pull-2026-07-28.md | SHIPPED-UNPROVEN |
| 5.16 | Verification meta-laws: proofs must be able to fail (no certifying by source-text match — 22/38 reachability suites did); prove a probe could have seen presence before believing absence; never measure layout/timing in a hidden tab; localize history loss by three-way compare (Athena chart vs read verb vs store), never a pull's self-report. | HONEST_STATE_2026-07-28.md; HANDOFF_TAKEOVER_2026-07-28.md; ROOT-CAUSE-identity-spine-never-starts-2026-07-27.md | **GAP** on the 22/38 text-matching suite debt; the methods themselves PROVEN |

## 6. SESSION HANDLING

| # | Requirement (merged) | Strongest source(s) | Status |
|---|---|---|---|
| 6.1 | Check Athena sign-in FIRST on every pull; detect the sign-in page early and return signin-expired rather than inferring emptiness downstream; an expired MLS sign-in refuses up front, not minutes later with a misleading connection error. | signed-out-athena-stamps-19-charts.md; EXTENSION_3.0.x_GUIDE_2026-07-21.md | SHIPPED-UNPROVEN |
| 6.2 | Session liveness is proven PER READ, never stamped once at frame load — the measured failure: sessionProof said liveSessionProven:true 3 minutes after the server started refusing everything. | athena-retains-phi-after-logout-measured.md | **GAP** (defect measured 07-31; per-read fix not documented shipped) |
| 6.3 | Sign-out proof = same-origin fetch showing Re-Login/password input; a redirect to sign-in is NOT proof of a dead session (athenanet root always bounces to prompt=login even when signed in). | athena-retains-phi-after-logout-measured.md; signed-out-athena-stamps-19-charts.md | PROVEN as the correct probe |
| 6.4 | The ~78-min Athena idle timeout expiring mid-drive presents as goto failure + wedged renderer — surface a sessionLikelyExpired honesty flag. | 2026-08-03-fg11-live-proof-and-always-evidence.md | **GAP** (scoped, not shipped) |
| 6.5 | If Athena signs out mid-work, stop and tell the user immediately; never keep operating on a dead session (a signed-out Athena once stamped 19 charts reporting "19/19 failures 0"). | HANDOFF_2026-07-16_READ100_WRITE_TEST.md; signed-out-athena-stamps-19-charts.md | SHIPPED-UNPROVEN (early-refusal lane shipped; the no-op class eliminated by content-delta law) |
| 6.6 | MLS session eviction requires proof: evict only on confirmed 401 from /api/me (403 = gate state, never purge); account-wide idle clock; active pulls/recording hold the idle timer; idle logout recognizes active Athena work via the read-only chart-identity verb. | HANDOFF_COMMERCIAL_READINESS_2026-07-21.md; idle-logout-cannot-see-athena-work.md | PROVEN (fixed b725 + ext 3.0.23) |
| 6.7 | No Athena keep-alive (explicit owner won't-build); honest session-state surfacing ships instead; phone/relay surfaces show honest office+Athena state BEFORE pulling (4 states) and fail taken jobs instantly with the precise office verdict. | phone-pull-clarity-b388.md | SHIPPED (owner decision + b388 lane) |
| 6.8 | Bridge health verified before trusting any result: pong buildId tail === current core digest; envelope contract honored ({source:'mls-app'}, reply nested under resp); orphaned content scripts answer pings with dead runtimes. | HANDOFF_2026-07-16_READ100_WRITE_TEST.md; ROOT-CAUSE-identity-spine-never-starts-2026-07-27.md | PROVEN as protocol |

## 7. SAFETY GATES (identity, focus, tab, PHI)

| # | Requirement (merged) | Strongest source(s) | Status |
|---|---|---|---|
| 7.1 | Identity gates are fail-closed and NEVER loosened to make a run green: exact name + DOB/MRN proof per chart read; unresolved rows REFUSED, never guessed; a wrong-patient read is worse than an honest failure; DOB conflicts refuse (owner fixes the DOB). | HANDOFF_COMMERCIAL_READINESS_2026-07-21.md; FABLE_EXTENSION_HANDOFF_2026-07-14.md; pull-experience-truth-b402.md | PROVEN (fail-closed refusals repeatedly observed doing their job live) |
| 7.2 | ONE app tab runs engines: shared 45s heartbeat shield store-wide, owner token, foreign-start refusal, hidden tabs never self-start convergence rounds; retry vs pull mutually exclusive (per-tab flag + exclusive Web Lock). | cross-tab-pull-shield.md; ext-3040-candidate-in-progress.md | PROVEN (b766 shield live) |
| 7.3 | Rowguard 2.0: NO unauthorized patient-row removals while any pull runs; generation-stamped callers may only drop rows their read generation provably saw; 60s re-save cooldown; background merges defer on the busy stamp (set at start, per-patient, finalization, including manual retries). | rowguard2-generation-rule.md; pull-experience-truth-b402.md | PROVEN (2 live pulls 21/21 after) |
| 7.4 | Exactly ONE signed-in Athena tab-of-record; the lease is established as the FIRST act of any operation so per-op re-picks never hop tabs. | EXTENSION_3.0.x_GUIDE_2026-07-21.md; pull-reliability-speed-saga-b368-b375.md | SHIPPED-UNPROVEN |
| 7.5 | A REFUSED pull must never navigate the shared Athena tab — the mutex/busy check precedes warmUpDay navigation. | 2026-08-03-fg12-live-first-pass-and-latch-discovery.md; MEMORY.md (pace-1.0) | SHIPPED-UNPROVEN (busy-refusal-before-nav live in b865; refusal-path live test not cited) |
| 7.6 | Never navigate the tab-of-record while the extension is driving it (wedges athenaOne behind the CSRF interstitial / day-switch retry loop); never click Continue on the CSRF interstitial — treat as a security confirm, recover by navigating back. | ext-3032-candidate-staged.md; athena-dashboard-is-a-week-tabbed-widget.md; 2026-07-29-3033-live-proofs-and-qa-train.md | PROVEN as law (violations observed and codified) |
| 7.7 | Focus discipline: pulls never steal focus, never create/move/resize windows, show ONE panel and no dialogs; bodies reads only activate an already-active Athena tab (no-yank); writes alone may foreground and only after the target field is confirmed; the doctor is returned to the MLS tab when a pull ends. | ext-v295-quiet-pull.md; pull-reliability-speed-saga-b368-b375.md; HANDOFF_COMMERCIAL_READINESS_2026-07-21.md; athena-foreground-yank-mechanism.md | PROVEN (no-yank directive held through b762 live runs) |
| 7.8 | Foreground assist refuses when Chrome lacks OS focus — no keystrokes ever land in athenaOne while the doctor works another app; safety over healing (0/7 heals with owner absent is CORRECT behavior). | ext-3040-candidate-in-progress.md; 2026-08-03-fg11-live-proof-and-always-evidence.md | PROVEN |
| 7.9 | Focus restore honors the doctor's NEWER choice; the doctor's first move away quiets the rest of the batch — EXCEPT moving to the batch-owning app tab (watching the pull), which keeps the assist (fg-1.3 latch); the announce latch is module state reset only by user-initiated wrappers; fronting pauses mid-recording (never yank Athena mid-visit). | 2026-08-03-fg12-live-first-pass-and-latch-discovery.md; ext-3040-candidate-in-progress.md | PROVEN (Mon 18/18 fronted whole-batch, fg-1.3) |
| 7.10 | PHI discipline everywhere: probes, diagnostics, and reports carry shapes, counts, and initials only — never names, DOBs, MRNs, or clinical text; the Browser pane renders the real roster; athena retains PHI in unscrubbed frames after logout. | browser-pane-holds-real-phi.md; HANDOFF_TAKEOVER_2026-07-28.md; athena-retains-phi-after-logout-measured.md | PROVEN as law |
| 7.11 | athenaOne is read-and-navigate ONLY for all agent/testing work: no writes, no signing, no orders, no modifications on real patients. | HANDOFF_TAKEOVER_2026-07-28.md | PROVEN as law |
| 7.12 | The pull never tells the user to manually open a chart; no freezes, flicker, focus yanks, or work moved to the wrong patient across recording, generation, loading, and patient switching. | day-history-pull-reader-fix.md; FABLE_EXTENSION_HANDOFF_2026-07-14.md | SHIPPED-UNPROVEN |
| 7.13 | Native confirm()/prompt()/alert() dialogs (freeze every same-origin tab) replaced with non-blocking in-app UI before commercial readiness. | HANDOFF_COMMERCIAL_READINESS_2026-07-21.md | **GAP** (readiness list item; completion not documented) |

## 8. RELEASE DISCIPLINE

| # | Requirement (merged) | Strongest source(s) | Status |
|---|---|---|---|
| 8.1 | Nothing is "done" until proven live 100% of the time across the whole case space (today, tomorrow, previously-failing days, next week, selected AND all-provider modes); never say something works until tested live; proof standard = multi-day zero-failure campaigns; any failure restarts the count. | prove-it-everywhere-not-one-case.md; HANDOFF_COMMERCIAL_READINESS_2026-07-21.md; goal-lane-takeover-b705-b711.md | PROVEN as the operating standard (5-pull campaign zero failures held) |
| 8.2 | A release moves ALL pins together in one train: manifest, digest, zip sha, feed, get-extension, Settings link, sw passthrough, inventory, SERVER_EXT_VERSION, checker tokens (live AND staging), _config.yml, every pinned test incl. escaped-regex forms. | mls-extension-release SKILL.md; ext-3040-candidate-in-progress.md | PROVEN (skill proven 3.0.1; used through 3.0.44) |
| 8.3 | Every published zip is live byte-verified (downloaded sha == build sha) — but byte-verified ≠ RUN: a release ends only with install into the actual enabled Chrome folder, devReload, reload of BOTH MLS and Athena tabs, and a pong naming the new version. Published is not installed; orphaned content scripts make every read look tab-unreachable. | mls-extension-release SKILL.md; extension-autoreload-protocol-proven.md; cross-tab-pull-shield.md | PROVEN protocol |
| 8.4 | Never publish untested; never rebuild or re-cut a published zip (released bytes are byte-pinned — a superseded version gets a NEW version); publish only after read AND write lanes pass live; the bodies lane needed 10 consecutive passing ON pulls before its fix released. | HANDOFF_COMMERCIAL_READINESS_2026-07-21.md; coordination-2026-07-22-live-pull-lane.md | Law PROVEN in practice; 10-consecutive ON-pull bar SHIPPED-UNPROVEN (completion not documented) |
| 8.5 | Never deploy while a pull is in flight (probe __mlsPullBusyAt / cross-tab stamp — SW-update reload kills in-page engines mid-run); never copy files over a RUNNING unpacked folder; after any devReload, reload the Athena tab before trusting the picker. | coordination-2026-07-22-live-pull-lane.md; 2026-07-28-b762-first-pull-completeness.md | PROVEN protocol |
| 8.6 | byte-safety: background.js is mixed-EOL and edited only via node latin1 scripts (never the Edit tool); digest re-stamped and verified each release. | mls-extension-release SKILL.md | PROVEN |
| 8.7 | Fixes must be reachable on the owner's ACTUAL path; a "proven live" claim requires confirming the measured value is produced by the changed code (b749 shipped four fixes "present, correct, UNREACHABLE"); never claim a fix works until the failing row re-enters the changed code path. | b749-four-incomplete-fixes.md; 2026-07-29-3033-live-proofs-and-qa-train.md | PROVEN as law |
| 8.8 | Never cut over a parser on synthetic vectors alone — shadow mode with honest persisted live counters (checked/differs) before flipping. | ext-v295-quiet-pull.md | PROVEN method |
| 8.9 | _savePatientChart and write-flow twins stay byte-identical between ScribeFlow.html and ScribeFlow-staging.html — any change patches both in the same commit (parity test enforced). | signed-out-athena-stamps-19-charts.md | SHIPPED (test exists) |
| 8.10 | Release regression bar: all automated suites + the full live read-only workflow (schedule → all histories → six cards → prior visits → op-note context) on the EXACT published build + repeat acceptance; two consecutive clean full-product passes with zero console errors; never label anything "perfect"/"fixed for good" while any live checklist item is unresolved. | FABLE_EXTENSION_HANDOFF_2026-07-14.md; 2026-07-26-b711-release-regression.md | PROVEN as the bar (met for b711 sign-off) |
| 8.11 | Navigation and correctness fixes must reach the Chrome Web Store CHANNEL, not only the direct-download zip; Web Store upload is exclusively the OWNER's action — the agent stages, byte-verifies, and checklists only. | ROOT-CAUSE-weekstrip-echoes-target-2026-07-28.md; 2026-07-28-b776-evening-pull-and-ship-ledger.md | PROVEN as the division of labor (channel at 3.0.44; owner upload is the standing dependency) |
| 8.12 | Publication boundary: assist.html never contains "Load unpacked" / "Developer mode" / "any web EMR" / "Capture whole chart"; publication allowlist-driven with the boundary test hashing the released zip; manifest keeps scoped site permissions (no <all_urls>) — deliberate trust/review trade. | HANDOFF_COMMERCIAL_READINESS_2026-07-21.md; EXTENSION_3.0.x_GUIDE_2026-07-21.md | SHIPPED |
| 8.13 | Extension changes stay TINY: small surgical edits, re-test live, no restructuring (standing owner instruction). | 2026-07-29-3033-live-proofs-and-qa-train.md | PROVEN as law |
| 8.14 | Autonomy default with hard stops: proceed on routine reversible fixes without approval; never stop until everything is done and proven perfect; backups before destructive steps; hard stops = orders, real-patient writes, payment PRs, Web Store publish. | autonomy-recommended-default.md | PROVEN as operating mode |
| 8.15 | Commercial readiness also requires a full new-customer E2E: signup → ceremony → first pull with a full clinic Day view → note. | HANDOFF_COMMERCIAL_READINESS_2026-07-21.md | **GAP** (not documented complete) |

---

## Top open GAPs (the shortest path to "done")

1. **Timed sub-10-minute zero-click virgin day** — the single outstanding proof for the owner's definition of done (3.1/3.2); supporting trains: nav-overlap pipelining + serial-sweep tightening (3.4), bodies activation lease (3.6), encounter-index presence assist (2.6).
2. **Receipt-level convergence** — store-complete days still showing "Retry failed histories only (1)" (2.5).
3. **Session honesty debt** — per-read session liveness (6.2), sessionLikelyExpired flag (6.4), focus-owned-refusal disclosure (5.9).
4. **Freshness honesty debt** — stale painted grid indistinguishable from fresh (5.10); failed read rendering as an empty day (5.11).
5. **Completeness gate identity-counting** (census-vs-walk, 1.22) and **appointment-briefing problem-list capture** (1.24); **provider-picker roster verb** (1.13); **medication-capture owner decision** (1.25).
6. **Write lane** — pastenote identity gate + pickSuggestion blind first-click (4.9); 5 verified Adam writebacks (4.10).
7. **Verification debt** — 22/38 reachability suites certify by source-text match (5.16); native dialog replacement (7.13); new-customer E2E (8.15).

*Scope note: the raw input list was truncated mid-entry at "The visits read must be tab-bound"; all requirements provided up to that point are merged above, with tab-binding folded into 1.26.*
---

## Addendum — status corrections against the LIVE b867 + 3.0.44 stack (2026-08-04, session verification)

The synthesis above was built from docs alone; several entries are CLOSED by
trains that postdate their sources, verified against the shipped bytes:

- **6.4 sessionLikelyExpired flag — CLOSED** (sx-1.0, b863/3.0.43): goto
  failures probe the session; nav-failed says "Athena signed you out (its
  idle timeout). Sign in again."
- **5.9 focus-refusal disclosure — CLOSED** (fg-1.2/1.3, b863/b864): per-read
  presenceFrontedReads/presenceQuietReads + the history-partial banner hints
  whenever any read ran quiet.
- **2.6 encounter-index presence assist — CLOSED by architecture** (fg-1.2):
  the index is read inside the allvisits verb, which carries foregroundOk;
  live-proven fronted index reads succeed (Thu Jul 23 first 8, Mon Jul 27).
- **2.5 receipt-level convergence — MECHANISM CLOSED** (cv-1.1 b866 deny-list
  + cv-1.2 b867 hidden-veto exemption); day-level stragglers converging live.
- **1.22 census-vs-walk identity counting — CLOSED** (3.0.40 D-patch; census
  machinery at 7 sites in the shipped background).
- **4.9 pastenote identity gate — CLOSED STRONGER** (wv-1.2, 3.0.40):
  free-typing actions are DISABLED on athenaOne entirely; writes exist only
  through the supervised V2 lane.
- **1.13 provider roster — PARTIALLY CLOSED** (cv-1.0-era: an all-provider
  day pull BUILDS the roster with a complete:true receipt); the
  picker-ingest variant remains unbuilt.

**True remaining gaps, in priority order:**
1. (3.2) The timed sub-10 zero-click virgin day — machinery proven right;
   needs an athena-healthy window (today's attempt hit a ~40-min renderer
   storm; 8m30s WAS achieved on the 5-patient Friday).
2. (3.4) Pace pipelining: next-chart nav overlap + sweep-round collapse.
3. (6.2) Per-read session liveness (probe-on-failure exists; per-read does not).
4. (5.10/5.11) Painted-grid freshness stamp; er-1.2 already blocks the
   failed-read-as-empty-day worst case.
5. (1.24) Appointment-briefing two-phase problem-list capture — verify.
6. OWNER-GATED: (1.25) medication-capture pace-vs-completeness decision;
   (4.10) the five verified Adam Schaeffer writebacks; Web Store publish.
7. Site-scope readiness (not extension bytes): native dialog replacement
   (7.13), new-customer E2E (8.15), source-text-match verification debt (5.16).

---

## Live afternoon addendum (2026-08-04, post-cooldown)

- Thu Jul 23 converged **19/20 with zero visit-less patients** after the
  athena renderer storm passed: cool-down retry healed 7/8 clean, then the
  full re-pull re-verified the whole 20-patient day in **~8m18s (warm)**.
- The 20th, Ed F Speer, is a **both-routes honest identity refusal**: the
  findpatient route AND the schedule-row-anchored route each open a chart
  that fails the name+DOB gate. Nothing was captured for him (stub only,
  zero wrong data). Per the b793-era precedent this means the ATHENA ROW
  carries an anomaly (name variant, DOB variance, or duplicate chart) —
  owner's eyes required; the extension must never override this gate.
- Pace datapoints: warm 20-patient day ≈ 8m18s (IN-BAR); virgin 5-patient
  day 8m30s (IN-BAR); virgin 20-patient day still gated on athena weather.

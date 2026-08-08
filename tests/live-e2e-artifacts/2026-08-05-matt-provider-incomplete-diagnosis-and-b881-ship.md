# 2026-08-05 — Matt's Mac "can't pull" diagnosed + b881 ship (mdx-1.0.0 + Settings download)

## ✅ ADDENDUM ~19:55 ET — THE ADAM LIVE WRITEBACK IS PROVEN

The owner completed the doctor flow on his own tab and confirmed the sheet's step-4 verdict read
**"VERIFIED — note written"** (his selection, verbatim option). Full chain live: Aug-5 pull
receipts (`__mlsPullLastOutcome {ok:true}` 1/1) → 1,351-char grounded SOAP → binding
(`_athenaBoundVisitForAction` bound:true 2026-08-05) → wf3 read-only probe pass → ONE trusted human
Confirm & Send click → verified write_note. Notes: (1) the write state lived in HIS page instance —
the MCP tab's `__mlsWriteFlow.state.writes` stayed 0 and no cross-tab localStorage receipt exists;
sheet verdicts are per-tab, a fact future verifiers must know; (2) an unsigned encounter note does
NOT surface in chart pulls — my post-write re-pull scan of Adam's record found none of the note
phrases, which is EXPECTED, not a failure signal. Cleanup ordered by the owner: cancel both
throwaway appointments (Aug-4 11 PM Arrived; Aug-5 11 PM carries the test encounter + note —
removing it removes the test residue, which is the intent).

## The field report (owner-forwarded, read from Gmail 17:4x ET)

Email from Matt Schaeffer, sent 17:33 ET, body = the app's own `mls-pull-error-report` JSON:

- build **b879**, ext **3.0.44**, Mac Chrome 150, tz America/New_York
- `day: 2026-08-06` — he was pulling **tomorrow**, 18 appointments, `providerMode: "selected"`,
  "Pulling 2026-08-06 as Matthew Schaeffer"
- `reason: "provider-incomplete"`, shown twice (two attempts, deterministic)
- **`scheduleReceipt: {complete: true, expectedCount: 18, parsedCount: 18, candidateCount: 18}`**
- `providerRosterReceipt: {complete: true, partial: false, reason: "complete"}`
- `calendarReceipt / identityBootstrap / historyReceipt: null` — refusal happened before them
- user-visible line: "Some Athena schedule rows did not identify their provider. Nothing was
  imported; retry after the full day grid finishes loading."

## The diagnosis

**The owner's paraphrase ("the grid isn't settled") is what the MESSAGE said, not what happened.**
The receipts prove the grid was fully read. `provider-incomplete` is raised only in
`scopeProviderRows` (feat_mls_schedimport_exact.js) and only when `scheduleComplete === true`, from
two row shapes:

1. rows carrying **neither** a provider display name nor a structured provider id
   (`!k && !rowId`, mixed grid ⇒ scopeFill disabled ⇒ unattributed);
2. rows showing **the selected provider's name without a structured id** while the request is
   roster-verified with a stable id (`requireStableId && !canonicalNameFallback` — the deliberate
   two-Schaeffer safety: the practice roster really does carry Matthew AND Michael Schaeffer, and
   tests/provider-day-pull-contract.test.js:205 pins exactly this refusal).

Both are CORRECT fail-closed refusals (never import under a guessed clinician). The two DEFECTS
around them:

- **The advice was wrong 100% of the times it was shown** — waiting for the grid cures a
  provider-unverified state, never a provider-incomplete one.
- **The emailed report carried no provider receipt at all** (`dsDiagReport` never picked it), so
  which of the two shapes Matt hits was UNKNOWABLE remotely. That was the actual bug to fix first.

Why it hits Matt and not the owner: undetermined until row data arrives — candidates are his grid
variant/day view exposing name-only rows (shape 2, e.g. a roster id/stableKey mismatch making
`canonicalNameFallback` false on his machine) or a Mac/narrow-layout row template with no provider
cell (shape 1). His NEXT error report decides it; alternatively a local repro (flip this machine's
day strip to Aug 6 and pull) — deferred until the in-flight Adam writeback completes, because a day
flip clears the visit binding.

## What shipped — b881 (`2d885edd` + `4a920f59`, pushed 18:2x ET, live in 40s)

Worktree `dispatch-work/wt-ship-20260805` off origin/main `4931cc99` (b879); copilot lane's b880
(`5db5f0e8`) merged --no-ff mid-flight after the staleness gate caught the move; canonical bumper
stamped b880→b881 (144 sites + staging).

1. `feat_mls_schedimport_exact.js` **si-1.7.16 → si-1.7.17 (mdx-1.0.0)**: receipt gains
   `requireStableId`, `canonicalNameFallback`, `nameMatchedIdMissingRows`, and `unattributedDetail`
   — capped at 12, PHI-free by construction ({time, shape, hasName, nameMatchesSelected, hasId}
   only), collected in BOTH scope modes. The provider-incomplete status now reports counts and
   shape and routes to the error-report button; the settled-grid lie is gone.
2. `mls-connect.js` `dsDiagReport`: envelope now carries
   `providerReceipt` incl. the detail + `discoveredProviders` (clinician names only).
3. Settings (live + staging): `#extensionDownloadSettings` — "🔌 MLS Assist extension" card,
   Download v3.0.44 zip (root asset, 418,235 bytes), install steps mirroring get-extension.html;
   version/zip/manifest pinned together by the new suite; wrap-once drift refresher
   (`__mlsExtDlCardWired`) appended to mls-connect.js.
4. New suite `tests/provider-incomplete-diagnostics-contract.test.js` (registered in run-all):
   executes both refusal shapes, asserts PHI-free capped detail, re-asserts nothing-imported,
   pins message honesty, envelope fields, and Settings/manifest/zip consistency.
   Pins moved deliberately: ext-update-hint + schedule-identity-adversarial (si-1.7.17).

**Gate: PASS all 483 local regression suites.** Live-byte verification (fetch with cache-bust,
all true): settings card, zip link, si-1.7.17, nameMatchedIdMissingRows, old advice ABSENT,
providerReceipt envelope, refresher, zip HEAD 200 len 418235.

## Traps hit on the way (cold-session gold)

- **A hidden tab's screenshot can be a STALE COMPOSITOR FRAME.** The app tab screenshotted as
  "Still preparing your workspace…" while the DOM was fully booted (no such text anywhere in
  body.innerText). Judge hidden tabs by DOM probes, never by capture.
- **Calm shell folds the raw workspace**: `#genBtn`, `#pushAllEmrBtn`, `#mlsPasteTranscriptBtn`
  are 0×0 inside hidden ancestors — ref-clicks on them are DEAD clicks. The working surface is
  ez3 (`#ez3flGen` "Generate one note", then `#ez3flReview` "Next: Review & send to Athena"
  appears BELOW THE FOLD after generation). `generateNote` / `pushEntireVisitToAthena` /
  `_athenaBoundVisitForAction` ARE on window.
- **The Claude Code permission classifier blocks write-adjacent calls** on the medical tabs:
  `pushEntireVisitToAthena()` invocation, and even a scrollIntoView probe naming `#ez3flReview`.
  Read-only probes pass individually. Design around it: the owner does the sheet-open + confirm.
- **Gmail in a hidden MCP tab cannot swap views** (rAF SPA); basic-HTML Gmail is retired. Working
  route: read `data-legacy-thread-id` from the list DOM, then hard-navigate to
  `.../u/0/?force=1#search/<query>/<threadId>` — initial-load hydration renders the message.
- **tests/review-step-never-fails-silently.test.js greps staging for the LITERAL string
  `mls-connect.js`** — an HTML comment mentioning the filename trips it. Staging comments must not
  name production core files.
- **The si version marker is pinned in three places** (feat marker, loader-line comment, two
  suites) — move them together, deliberately.
- **The staleness gate works**: round-1 gate failed because copilot pushed b880 mid-run; commit,
  merge --no-ff, re-bump, regate. The bumper subject ("bumped b880 -> b881 (144 sites)") is the
  commit subject verbatim.

## LOCAL AUG-6 REPRO — the refusal does NOT reproduce on the owner's machine (added ~19:20 ET)

Ran Matt's exact day on the owner's Chrome (ext 3.0.44, app tab on b879 bytes, all-providers mode,
tab pair hidden throughout): day strip → Thu Aug 6 → Pull.

- **Provider gate: PASSED.** `__schedRaw`: date 2026-08-06, **18 appts**, providers =
  `["Matthew Schaeffer, MD"]` (single-provider day), schedule receipt complete:true. No
  provider-incomplete, no refusal toast, no diag button. **The same 18-appointment grid that
  refuses on Matt's Mac attributes cleanly here.** ⇒ Matt's failure is client-specific: his grid
  variant/viewport DOM missing per-row identity, or (if his pull runs selected-mode with a stale
  roster) the `requireStableId && !canonicalNameFallback` arm. His next b881-era error report
  (nameMatchedIdMissingRows / canonicalNameFallback / unattributedDetail) decides between them.
- **Pull outcome receipt: `__mlsPullLastOutcome {ok:true}`** for 2026-08-06 (~19:19 ET).
- **History phase, first pass (both tabs hidden): 18 total → ok 7, failed 10-11** — hidden-mode
  read starvation exactly as 3.0.44's release note documents for unwatched runs (nobody watching
  either tab). NOT chart defects. The engine then **auto-started a retry pass over the 10 failures
  and was converging (1/1 ok at first check)**; "↻ Retry failed histories only (10)" control
  present; toast "Visit backfill: 4 patients queued (fewer than 2 visits on file)" (the
  default-on visit-bodies backfill lane engaging). This is tonight's SECOND live demonstration of
  why the fg/presence machinery must ride the 3.0.45 train.
- Coordinate-clicks on this hidden tab were DEAD (three pulls "refused silently" — actually never
  fired; the earlier cross-tab-shield theory was WRONG and is retracted). Ref-clicks
  (find → scroll_to → click ref) fire reliably. Instrument note for every future hidden-tab drive.
- **FINAL Aug-6 numbers (~19:40 ET):** schedule 18/18 imported, `__mlsPullLastOutcome {ok:true}`;
  histories: first pass 7/18 ok (hidden starvation), then the engine's own retry passes converged
  to **17/18 landed fully hidden**, 1 stubborn chart honestly surfaced as "1 needs attention" in
  the progress chip. Day strip returned to Wed Aug 5 (via ref_699 Previous ×2 — note ref_702 is
  NEXT; one wrong click briefly visited Fri Aug 7, no pull run there). The hidden-mode convergence
  behavior (auto-retry to 17/18 with zero human presence) is strong live evidence the retry lane
  works; the last-chart presence gap is the fg-1.x / 3.0.45 case in miniature.

## DAD'S-MACHINE HISTORY CLASSES — Opus agent A verdict (visit-bodies-incomplete), ~22:00 ET

Field ledger (owner-pasted, his father's Mac): visit-bodies-incomplete ×2,
encounter-index-incomplete[noise-frames-excluded:1] ×5. Agent A traced the first class:

- **One emitter**: `background.js:10848` in `runAllVisits` — the reason is a UNION of ~20
  sub-causes (encounter-section-loading/empty/incomplete, read-deadline-exceeded,
  slideout-trigger-missing, encounter-frame-contract-mismatch, stable-source-keys-incomplete,
  identity-changed-during-read, …). **Per-PATIENT all-or-nothing**: one failed row voids the
  whole chart's save (`visits: []`).
- **Ranked one-Mac-only factors**: (1) occlusion — covered Chrome window = rAF 0/s, encounter
  lists render on paused rAF (the codebase itself records "10 bodies failures pass-1 → 6 after
  one retry"); (2) presence assist silently null when Chrome unfocused / `__mlsFgDoctorMoved`
  latched / mid-recording; (3) budget arithmetic: 3.5s/encounter admission vs ~7s real cost +
  per-machine adaptive ceiling (fast first charts tighten the ceiling for deep charts later);
  (4) athena **streamlined-vs-legacy is a per-USER preference** — the detail-frame contract
  requires FROMSTREAMLINED= → a non-streamlined user fails EVERY row with
  encounter-frame-contract-mismatch; (5) narrow window/zoom collapsing `span.slideout-trigger-open`
  → slideout-trigger-missing deterministically.
- **THE FIX (app-side, no extension release): `failedIndexes` already crosses the bridge and is
  DISCARDED at `feat_mls_schedimport_exact.js:3167`** — zero consumers in the shipped codebase.
  Capture the reason histogram + receipt subset (expected/parsed/attempted/elapsedMs/timeBudgetMs/
  retryCount/minimalBodies) into `one.visitsFailedIndexes` → `frozenRetryEntry` → the per-patient
  day ledger + the warning text. PHI-free by construction (d2 already redacted). Next dad's-pull
  then reads e.g. `visit-bodies-incomplete {encounter-section-loading×6}` ⇒ occlusion, vs
  `{read-deadline-exceeded×4}` ⇒ budget, vs `{slideout-trigger-missing×2}` ⇒ layout.
- **Extension-side gap for the 3.0.45 train**: the `qpEnsure` visibility verdict
  ('visible'|'strip'|'limp') is discarded — stamp `receipt.qpVisibility` so occluded-and-slow vs
  merely-slow separate.
- Also recorded: MY Aug-6 straggler here is a different class — "athenaOne patient search found
  no matching patient" (identity-resolution refusal, possibly Ed-F-Speer-adjacent).

Ship plan pending agent B (encounter-index class): ONE app-side diagnostics ship (b885) covering
both classes' histograms, then the 3.0.45 extension train (sx-1.1 + fg presence port +
qpVisibility stamp + whatever B names + Matt's provider cure when his data lands).

## AGENT B VERDICT + THE mdx-1.1.0 SHIP (landed as b890 `cb07fdbd`, live ~23:55 ET)

Agent B found the encounter-index ROOT CAUSE: a **self-cancelling stability carry, shipped in ext
3.0.32**. The frame gate needs ≥6 stable passes ≥20s; the orchestrator carries its pass count
down as `outerStableN/outerStableMs`, the frame echoes both INTO its refusal reason string, the
pass-signature key strips `n=`/`sameFor=` but MISSES `outerN=`/`outerMs=` (background.js:10429),
so the carry poisons its own key and `ehStuckPasses` pins ≤2 — the gate is mathematically
unsatisfiable whenever the Visits panel re-renders per pass (openVisits re-clicks unless the rail
tab is `active` AND rows already painted — per-user chart-tab state = the one-Mac shape). The
`[unchanged-for-N-passes]` tag disappearing between 3.0.18 and 3.0.44 fingerprints the regression.
The shipped stability test passes because its simulation increments the carry unconditionally and
never models ehKey. **Fix = one line (add outerN/outerMs to the strip list), extension-side,
3.0.45.** Also from B: `[noise-frames-excluded:N]` is a BYSTANDER tag (only ok:true noise frames
count — a coordinator/inbox frame that produced a plausible index and was correctly discarded);
NOISE_SURFACE_RE misses coordinator/enterprise and uses unescaped dots; `enumDiag` crossed the
bridge with zero consumers (fixed in b890); `adaptiveCeilingMs` collapse (one fast empty read →
60s ceiling → 24s index phase) explained "first two fine, next five fail" (guarded in b890).

**b890 shipped** (PASS all 484, live-byte verified: histogram capture, historyDiagSuffix panel
text, perPatientDiag ledger, retryDiag envelope, si-1.7.18, authoritativeEmpty pace guard).
Ship-path trap recorded: a mid-gate origin ship double-claimed b889; build-bump-names-its-build
refused; recovery = reset to the pre-bump WORK commit → re-merge → bump once → full regate.

## Adam writeback state at artifact time

Restaged END TO END on tab pair app 256598156 / athena 256598155: pull `{ok:true}` 1/1, fresh
1,351-char SOAP in editor, `_athenaBoundVisitForAction` bound:true visitDate 2026-08-05, athena
session alive under ~9-min keepalive fetches. **Waiting on the owner's three actions** (open
"Next: Review & send to Athena" below the fold on the Visit page; front the athena tab ~5s if the
probe starves; click "Confirm & Send to Athena" once). The staged app tab still runs b879 bytes —
DO NOT reload it before the write lands; a reload wipes editor + binding again (that is exactly
what b879's arrival did to session-3's staging).

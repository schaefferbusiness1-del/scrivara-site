# WORKER B — extension / Athena reliability, 2026-07-26

**Branch `worker-b-ext`, two commits on top of `3c89638` (b672).** Nothing pushed, no
extension version released, no browser or live Athena session touched. Everything below is
either read out of the source at the tip or measured by a harness; where something is
unverified it says so.

```
clone            dispatch-work/claude-defects-20260725   (was CLEAN, 86 behind; rebased)
base             3c89638  b672
631cc2c          ext sfp-1.0.0  schedule read declares its freshness
9d7beb3          sfp-1.0.1      a signed-out athenaOne is named, not called a timeout
gate             336/336 PASS   (with the core digest temporarily stamped — see §6)
new suite        tests/schedule-read-declares-its-freshness.test.js, 13/13 mutations caught
```

---

## 0. READ THIS FIRST — scope item 1 was closed before I was dispatched

**My assignment said to continue the ON-mode frame-qualification investigation against the
3.0.13 instrument on `agent/ext-3.0.10-on-mode`, and to produce a fix candidate. That work
is done and shipped. I re-derived it from the tip rather than starting it.**

This is the QA lane's own rule doing its job: *an assignment must carry the measurement that
justifies it AND the build it was taken on.* The ON-mode brief was taken at 3.0.13. The tip
is 3.0.20.

| build | what it fixed | evidence |
|---|---|---|
| **3.0.18** | `listKids >= evTotal` was a **category error**, not a race — "All Events (N)" counts appointments, vitals and patient cases the encounter `<ul>` never renders, so the comparison was unsatisfiable on every chart. Below the declared total, accept once child count AND row count hold ≥6 passes / ≥20s. | Live, same 5 patients that had refused an hour earlier: `schedule 5/5; history 5/5; failures 0`, `expected == parsed == persisted == bodies` on all five, **47 encounter bodies persisted**. That is `coverageComplete > 0 on real patients` — the exact success criterion my brief names. |
| **3.0.19** | The stability counter lived in `window.__mlsEnumStab`, **frame-local**, and the orchestrator re-drives `openVisits` + `sleep(3500)` between every pass, destroying it. `n` reset to 1 forever; the gate could never open. Now counted in the orchestrator (`ehStuckPasses`), passed down via cfg, gate takes the stronger of the two. Same bound, no lowered bar. | `background.js:9591-9601`; refusals carry `outerN=`/`outerMs=` (`background.js:8687`). |
| **3.0.20** | 3.0.19's index-phase deadline was **inert**: derived from the nominal 165s budget six lines *before* the caller clamp, so the cap landed past the real deadline and the `&&` was always decided by its first half. | **Confirmed real in source at the tip**, `background.js:9462-9484`: `var indexPhaseDeadline = 0;` → clamp → `indexPhaseDeadline = readStartedAt + Math.min(70000, Math.max(20000, Math.round((readDeadline - readStartedAt) * 0.4)))`. Derivation is now *after* the clamp and *from the effective window*. |

**Verdict on scope item 1: nothing to fix, nothing to test.** The three gates
(`visits-panel-not-open`, `visits-total-not-readable`, `visits-list-still-rendering`) are all
present and unchanged in intent; only gate 3's arithmetic moved. Do **not** re-open this and
do **not** install the 3.0.13/3.0.15/3.0.17 diagnostic folders — they are superseded.

The one thing genuinely still open from that arc is **duration, not correctness**: a
full-bodies pull ran ~18 min/patient (7–20 encounters each, every body a slideout + iframe
read). That is a performance problem now.

I redirected the freed effort to scope item 2, which my brief called the highest-value item
and which was still entirely open.

---

## 1. THE SIGNED-OUT SCHEDULE PULL — designed, implemented, gated (sfp-1.0.0)

### 1.1 What was wrong, and why four guards missed it

The owner: *"logged out of Athena, history definitely can't pull — but I HAVE SEEN the day's
patients come through."* He was right, and the repo had recorded it a fortnight earlier
without anyone following it:

> `tests/live-e2e-artifacts/2026-07-22-acceptance.md:22` — "Schedule phase fine (18 rows now
> — **an 18th appointment was added mid-clinic**; 17 updated post-click). **ALL 17 history
> reads refused**… Screenshot proof: the Athena tab was sitting on identity.athenahealth.com
> sign-in."

A never-before-pulled appointment came through while every history read correctly refused.

Four independent reasons nothing caught it:

1. **The schedule read is a pure DOM scrape of an already-painted grid.** There is not one
   `fetch`/XHR to athenahealth anywhere in `background.js`. A grid on screen needs no session.
2. **The session probe only recognises a PAINTED sign-out** — `background.js:4137-4148`
   requires a *visible* timeout heading or a *visible* login form. The file says why this is
   hard: *"A globalframeset URL remains unchanged when Athena renders its timeout page in a
   child frame"* (`background.js:3458`). A session dead server-side but not yet repainted
   reads `alive:true`, and `mlsPickAthenaTab` hands the tab over.
3. **Nothing forces the repaint** — the scrape performs no navigation when a grid is visible.
4. **The date guard is vacuous for a TODAY pull.** I verified this rather than inheriting it:
   `background.js:5508-5540` verifies the day by re-reading the painted `.calendar-nav` week
   strip, and the "Today" branch is `var isToday = (want === iso(new Date()))` — the
   **browser's** clock against a **painted** tab. A stale strip with "Today" still selected
   passes without athena serving anything.

Net effect: hours-old rows shipped as `ok:true` / `scheduleVerified:true` / `complete:true`.
A cancelled or rescheduled appointment silently survived as a real patient. The one honest
message in the file, `{ok:false, skipped:'athena-signed-out'}` (`background.js:3441`), has no
caller on this path.

### 1.2 The design decision that makes the fix safe

**I did not try to detect sign-out. I measured STALENESS, of which a dead session is one
case.** That reframing is what makes the fix defensible:

- A grid the doctor left open for four hours **is** four hours old whether or not the session
  is alive. Flagging it is correct, not a false positive.
- Sign-out detection would need either an authenticated request to athenahealth (a new
  network call into a clinical system, with side-effect risk) or a forced repaint (disturbing
  the doctor's tab). Both were rejected.

**It never refuses and never touches `complete`.** This is load-bearing and pinned by the
suite: the pull path works today, and a staleness signal that can fail it would be a
regression traded for a disclosure.

### 1.3 What shipped

**`background.js` — a live-session proof ledger** (`self.__mlsAthLive`, persisted to
`chrome.storage.session` so an MV3 worker restart does not erase it).

Fed by **exactly one** source: `chrome.webNavigation.onCommitted`, filtered to
`athenanet.athenahealth.com`, excluding athena's own `login|logout|signin|sso|timeout` URLs.
A committed navigation was **served**; a dead session cannot produce one.

Deliberately **not** treated as proof of life, and the suite pins both exclusions:

- **the content-script hello** (`__mlsAthReg`) — I checked `content.js:19-23`: it fires on
  `focus`, `pageshow` and `visibilitychange` of an already-loaded document. No server
  involved. Using it would have forged the very proof the receipt exists to provide.
- **`mlsAthPing` returning `alive:true`** — it proves only that no sign-out is *painted*,
  which is the exact blind spot.

**Residual hole, stated honestly:** if the session dies and athena then commits its timeout
page *in-frame on athenanet*, that commit is excluded by URL only if the URL matches the
pattern. If it does not, a false proof is recorded. **This is covered by the complementary
mechanism** — that page is *painted*, so `mlsPickAthenaTab`'s ping rejects the tab before the
schedule read starts. The two mechanisms cover each other's blind spot; neither is sufficient
alone. That is the design, not an accident.

**`background.js` — the grid declares its own age.** Two `Performance` reads added to the
schedule surface probe (which already runs `allFrames`, so **zero extra injections, zero
network, zero PHI**): `docAgeMs` from `performance.timeOrigin`, and `lastNetMs` from the
newest resource entry. Chrome stops recording resource entries once the buffer fills, so
`netBufferFull` is reported and the value **discarded** rather than trusted — otherwise a
busy healthy frame reads as a confident false stale.

Both terminal schedule responses now carry `sessionProof` + `staleRisk`.

**`feat_mls_schedimport_exact.js` — it reaches the doctor.** This is the part that stops it
being another 3.0.19-style inert guard:

- `freshnessNotice()` appends one plain sentence to the **terminal verdict** ("Verified
  complete…", "Schedule-only complete…", and the authoritative-empty message), naming how old
  the grid is and the clinical consequence.
- It does **not** say "you are signed out" — that is not known. What was measured is that
  nothing proved the session served anything. A wrong instruction is worse than an honest
  "this may be old". Pinned by a mutation.
- `freshnessReceipt()` records the verdict on `calendarReceipt.scheduleFreshness`. An older
  extension sends no `sessionProof`, and that case is recorded as `"not-reported"`, **never**
  as fresh — silence plus a clean receipt would upgrade *unknown* into *fresh*, which is the
  original defect wearing a new hat.

### 1.4 The gate, and two bugs it found in itself

`tests/schedule-read-declares-its-freshness.test.js` lifts the **real** page-side helpers out
of the shipped file with `vm` rather than modelling them. **13/13 mutations caught**,
including the four that matter most: `complete` made to depend on staleness; a hello forging
the proof; a full buffer trusted; an absent signal read as fresh.

Per this repo's b669 rule I proved it fails on the real regressions *and* passes on the real
tree. Two arms were wrong first, and both are recorded in the file:

1. **The b669 circularity bug, again.** v1 asserted
   `chrome.webNavigation.onCommitted.addListener` — which also appears in the
   feature-detection guard one line above, so **deleting the actual listener still passed**.
   Bound to the registration signature now, plus the host filter.
2. **An arm that fired on correct code.** It bounded `__complete` by the gap before
   `__receipt`; my own change widened that gap, so the slice contained the words the arm
   forbids. Bound to the statement now.

---

## 2. sfp-1.0.1 — the signed-out session was reported as a timeout

Found by the resilience audit (§3, scenario 1) and fixed in the same lane because it is the
other half of the same defect.

`no-athena-tab` is what `mlsPickAthenaTab` returns when every athenaOne tab fails its session
probe — that **is** a signed-out athenaOne. But it sits in `SWEEPABLE_REASON`
(`feat_mls_schedimport_exact.js:2587`), so a dead session triggers **up to three full
automatic re-sweeps** that re-fail every patient, and the clinician is finally shown
*"deferred after timeout"*. A timing story for an authentication problem.

Searching the whole orchestrator for an athenaOne-signed-out verdict returns **nothing**. The
two that look like it — `"signin"` / `"signin-expired"` — are the **MLS backend** session
(`/api/me`), a different session entirely.

Fixed: `res.athenaSignedOutSuspected = __noTab >= 2` (threshold matching `multiTabSuspected`
directly above it), with a message that names the cause, the fix, **and** warns that the
schedule above came off the grid athenaOne still had on screen. Naming only the history half
would leave the clinician trusting the rows — which is the whole defect.

**Not fixed, needs a policy owner:** `no-athena-tab` remaining in `SWEEPABLE_REASON` means a
signed-out session still burns three full re-sweeps before reporting. Removing it changes
retry behaviour for a genuinely transient no-tab race, so it is not a message fix.

---

## 3. RESILIENCE MATRIX

Read-only static trace of the day-pull / history-pull path. Line numbers pinned to
`3b6ffa6`/`3c89638` unless noted.

| # | scenario | verdict | mechanism / what is missing |
|---|---|---|---|
| 1 | **Athena logout mid-pull** | **PARTIAL → improved** | History fails closed: every picker re-probes (`background.js:4206/4224/4244-4249`) and returns `null` for `athenaOnly` callers rather than hopping tabs. **The schedule leg shipped stale rows as `complete:true`** — now carries `sessionProof`/`staleRisk` (§1) and the signed-out state is named (§2). |
| 2 | **Frame refreshed / removed mid-read** | **PARTIAL** | Resilient *by construction*, with **zero explicit handling**: nothing in `background.js` matches "Frame with ID"/"was removed", and `mlsExecTO` collapses every rejection into an opaque `{err}`. Safety comes from the day-pull never targeting a captured `frameId` (`allFrames:true` re-enumerates), plus frame-bound receipts: `__surface.frameIds` frozen at verification and intersected with scrape results → `schedule-surface-changed`; chart coverage requires `unreadFrames === 0` and the app re-verifies `requestId`, `capturedAt` and `textChars` independently (`feat_mls_schedimport_exact.js:1777-1791`). **Gap:** a frame-removal error is not in `SWEEPABLE_REASON` and is indistinguishable from a reader defect in telemetry. |
| 3 | **Progressively rendered panels** | **HANDLED** | Strongest area. Schedule: per-cell settle with escalated retry, and completion requires all of no-axis-cap / no-container-cap / no-budget-expiry / `boundsStable` / `restored` / `cellsVisited === cellsPlanned` / `positionsReached === cellsPlanned`, feeding `__coverageComplete` → `__complete` → the app's hard gate. Visits: three ordered gates, with acceptance below the declared total requiring **six identical observations of both counts spanning ≥20s**, counted in the orchestrator so a re-drive cannot reset it (the 3.0.19 fix). |
| 4 | **Interrupted pull** | **PARTIAL** | Day-level resume intent in `localStorage` (2h / 2 attempts) + an idempotent import ledger + `athenaVisitsProof` carries. **No `beforeunload`/`pagehide`/`visibilitychange` handler at all** — no flush, no abort, no final receipt; **all per-patient progress in the history batch is lost** (resume is day-granular). Two leaks: the cross-tab busy stamp is only cleared on promise settlement, so a fast reload after a crash **silently declines to resume** for ~90s; and a ledger row claimed but not `markDone` counts a real appointment as `import-in-flight` for 5 min. |
| 5 | **Browser / SW restart mid-pull** | **PARTIAL** | Mostly fine *because the pull state is not in the service worker* — the orchestrator, ledger and resume intent live in the page. Background persists the heartbeat registry, tab pin, quiet-workspace state and focus debt to `chrome.storage.session`, with `chrome.alarms` backstopping cleanup. Lost: single-flight flags, deadline timers, the open lease and the verified-read lease. Recovery is probe-gated (a 3.5s `mlsPing` must prove the worker answers) and capped at **1 per patient / 2 per batch** — a worker restarting repeatedly exhausts it. **Gap:** an SW death during the first `mlsPing` reports `no-ext` → "MLS Assist isn't responding. Enable it…", misleading for a worker that self-restarts. |
| 6 | **Slow loads / timeouts** | **PARTIAL** | The Athena legs are genuinely excellent: `makeAbsoluteDeadlineScheduler` runs deadlines in a dedicated **Worker** (a hidden MLS tab throttles window timers to ~zero), all deadlines are **absolute** so no relay can extend a read, and `bridge()` binds strictly on requestId so a late reply from an older pull cannot settle a newer one. **Four unbounded classes**, all real — see §3.1. |
| 7 | **Missing data: empty vs unread** | **HANDLED** schedule + visits index; **PARTIAL** six cards | `__authoritativeEmpty` requires a *verified* surface probe that itself reports empty; "zero rows because nothing loaded" cannot reach it. The app then **cross-examines** rather than trusting: `authoritativeEmptyContract` demands exact numeric zero (rejecting `null`/`""`/booleans) across 12+ evidence keys and fails with the exact contradicting field named. Visits: `explicitEmptyVisits()` is patient-scoped, skips hidden nodes, anchored regex. **Six cards is the gap** — see §3.2. |

### 3.1 The four unbounded awaits (scenario 6)

1. **Every backend `fetch` has no `AbortSignal` and no timeout** — calendar read, appointment
   update, appointment create. `importAppts` is awaited with no wrapper. A backend that
   accepts the connection and never responds stalls the pull indefinitely. This is exactly
   the hang class `boundedUntil` was built for, applied everywhere *except* HTTP.
2. **`hydrateMissingScheduleProof` has no aggregate deadline** — per-request bounds exist
   (60s date restore + 110s chart open), the batch bound does not. 20 demographics-free rows
   worst-case ≈ **57 minutes before `runHistoryBatch` even starts** its own 12–45 min budget.
   `startedAt` is captured but used only as a receipt token.
3. **`saveOrganizedHistory`'s verification stage sits outside its own bound** — `boundedUntil`
   wraps only the parse; `verifyWithSettle`'s escalating bare `setTimeout` retries
   (`[150, 1000, 5000, 25000]`) and the finalization `await` loop are unwrapped.
4. **Bare `setTimeout` settles in a tab kept unfocused on purpose** — the goto-date
   2.5/5/8s settles, calendar-read backoff, `verifyWithSettle`. Chrome clamps timers in a
   backgrounded tab to ~1/min, and the quiet-pull design *deliberately* keeps the MLS tab
   unfocused. The module's own header identifies this hazard and routes deadlines through a
   Worker; these three sites bypass it. Delays rather than hangs, but a "2.5 second settle"
   can become a minute.

### 3.2 Six-card empty-vs-unread (scenario 7)

The receipt shape distinguishes `status:'found', populated:true` from
`status:'not_documented', populated:false`, and the orchestrator refuses a suspicious
all-zero case (`clinical-field-coverage-unproven`). Two weaknesses:

- **`not_documented` is never produced anywhere in this repository** — it appears only in
  comments and test fixtures. The base `_savePatientChart` that assigns card status is not in
  this repo; `feat_visits.js` and `mls-connect.js` only wrap it. **I will not credit a
  mechanism I have not read.** This is the owner's open ask for per-card capture receipts
  (`read | empty-confirmed | not-found`), and it is still open.
- **Card status only ever upgrades.** `markFound` returns early when `!present`, so a card can
  be promoted `not_documented → found` but never demoted. A card populated on a previous pull
  and unread on this one retains `found`.

---

## 4. DEFECT SWEEP — save paths claiming success without a receipt

The canonical defect class here (`handOff()` toasting "note sent to Athena" over **seven**
silent refusals). Six confirmed, ordered by blast radius. **None fixed** — the write path is
outside the read-reliability lane I was given, and two of them touch the sign-and-save
boundary, which is a hard stop without the lead's explicit decision.

| # | site | defect |
|---|---|---|
| **1** | `mls-popup.js:236-237`, rendered `:535-537`, summarised `:684-690` | `narrate('Draft written (unsigned)…'); setState('written');` is reached **unconditionally** after the per-section loop. `summaryLine()` at `:686` lists **every** section — `w.sections.map(x => x.section)` — with no filter on `confirmed`. **A run that found no field at all ends on a green "✓ Draft written" screen listing destinations it never wrote to.** Live: the entry button is "✍ Write to chart" (`:522`) in a real content script. |
| **2** | `mls-popup.js:218-221` | Two-state UI over a three-state receipt. `background.js:11348` pushes both `confirmed` and `written`; `written` is **never read**. So `background.js:11341`'s `{ok:false, notfound:true}` renders as *"⚠ Wrote to progress but couldn't confirm"* — **a positive claim about a write that provably did not occur.** |
| **3** | `feat_mls_status_center.js:817-819` | `var okW = resp && !resp.error;` → *"Write-back reported success (verify in athenaOne)"*. Derived from the **absence of an `error` key only**; `ok`, `blocked`, `confirmed`, `signed` all discarded. `background.js:11650-11651` returns `{blocked:true, signed:false, message:'Patient gate failed (name + DOB) - refusing to sign this chart.'}` with no `.error` — **a hard wrong-patient refusal rendered green.** |
| **4** | `mls-connect.js:17826, 23133, 25239, 27076, 28646` | The canonical `handOff(fn, msg)` — invoke, swallow the throw, toast regardless — **still present in five copies**, 67 call sites. The live instances are past-tense completion claims over async work: *"Chart context pulled (read-only) for X"* (×5) and *"Chart opened (read-only) for X"* (×5), where `calPullChartFor(id)` is fired and never awaited. **The pattern is understood but not eradicated** — `:18117` uses the honest present-tense form, and the note-filing toast is correctly gated on a receipt element. |
| **5** | `background.js:11814-11825` | **The root supply-side bug.** `overlayPasteNote` only sets `.error` for *environmental* failures; when the paste itself fails it returns `{sections:[…]}` with every entry `written:false, confirmed:false` and **no `.error`**. `doWriteBack` never inspects the sections, so callers get the success shape. `:11816-11819` also fabricates a fallback section object **without the `written` key at all**. |
| **6** | `feat_save_verify.js:525` | `var ok = (d.ok != null) ? !!d.ok : (d.result ? !!d.result.ok : true);` — a message carrying neither field is treated as a **successful** pull. Fail-open default on a receipt field. |

**Suggested order:** #5 is the root — make `doWriteBack` return `{ok:false,
error:'nothing-confirmed'}` when no section is `confirmed`, and always carry `written`. Then
#1/#2 become a three-state render, and #3 switches from `!resp.error` to an explicit allowlist.

**Two latent, currently unreachable** — do not "fix" without noting the guard:
`background.js:7845` reports `ok:true` over an all-`notfound` `wrote[]` (dead behind the
`mlsVerifiedWrite` kill switch at `:7771`); `background.js:11654-11658` would click Sign &
Save over a completely failed paste (dead behind the `MLS_OVL_SIGNSAVE` read-only refusal).

**Verified SAFE, do not re-file:** `feat_athena_writeback.js:251` (requires
`resp.ok && resp.confirmed`, honest failure at `:259-264`) is the correct reference
implementation. `background.js:7957-7959` emits three distinct states correctly — the truth
exists at the source and is lost by consumers #2/#3. Also safe: `write_safety_guard.js`
(every gate fail-closed), `feat_mls_writeback_safety.js`, `feat_save_verify.js:287-288`
(correctly degrades a transport failure to `{checked:false, ok:null}` rather than a false
"not saved"), and the `feat_mls_schedimport_exact.js` ledger — which uses the settle-wrapper
**correctly**, reading the payload's own coverage at `:2215-2218`.

---

## 5. COMMENT/CODE DIVERGENCES — two of them lie to the clinician

Not defects in behaviour; defects in what the code *says* it does. Both would send the next
reader — or the doctor — somewhere that does not exist.

1. **The phantom keep-alive.** `background.js:4265-4267` states the pinned tab is kept alive
   by "the same 55s Worker keep-alive". `mlsKeepAlivePageFn` (`:3452-3454`) sets
   `{armed:false, disabled:'athena-session-policy', stop(){}}` — a no-op — and
   `mlsArmKeepAlive` then `return { armed: true }` (`:3471`). Four callers read `armed:true`.
   The honest comment is at `:3448-3450`; the misleading one at `:4265` was never updated.
   **Nothing in this codebase prevents an inactivity logout mid-pull** — which is precisely
   why §1 was needed.
2. **The phantom reload recovery — and it has a user-visible string.**
   `mlsRecoverAthenaTab` (`:3432-3447`) does not reload; there is **no `chrome.tabs.reload`
   or `location.reload` anywhere in `background.js`**. Yet `:12589-12592` says "recover it NOW
   (reload + Continue-clear)", `:10907-10912` says "reload-recover the tab BEFORE the next
   open", and **`:10915` shows the clinician "Giving athenaOne a breather (freeze-guard
   reload)…"** — naming an action that never happens. Worse, the bootstrap path then spends
   up to 40s re-navigating the date to undo a reload that never occurred. **The rationale for
   disabling reloads (`:3426-3430`: CSRF invalidation, unsaved chart work) is sound** — this
   is a documentation and status-string bug, not a call to re-enable reloads.

Same family as the recorded *"the instruction points nowhere"* defect class.

---

## 6. WHAT THE LEAD MUST DO

### 6.1 The branch is deliberately RED on exactly one suite

`manifest.json` is **untouched**, so `extension-package.test.js` fails on the core digest:

```
manifest.version_name: 3.0.20+core-sha256:b43a525c…fc64c43   (the PUBLISHED 3.0.20)
computed             : 3.0.20+core-sha256:736284f1…db6f32   (my bytes)
```

**That is the gate working, not a mistake.** I did not stamp it, because stamping at 3.0.20
would mint a manifest claiming 3.0.20 with bytes that are not the published 3.0.20 — and
anyone building a zip from that would ship a counterfeit. Bumping to 3.0.21 alone would
desynchronise it from `extension-version.json`, `get-extension.html`, `sw.js`, the zip name
and the pin tests, which move together or not at all.

**I verified everything else is green** by temporarily stamping, running `tests/run-all.js`
(**336/336 PASS**, including my new suite), then reverting `manifest.json`. The tree is clean.

To ship, run the `mls-extension-release` train for **3.0.21**: bump `manifest.version`, remove
the old `version_name`, `node scripts/extension-core-digest.js --stamp` then `--verify`, build
the zip, and move all 12+ pins together — remembering the **escaped-regex** zip forms
(`MLS_Assist_v3\.0\.20\.zip`) in `extension-package`, `public-publication-boundary` and
`public-release-truth-boundary`; a plain `3.0.20` grep does not find them.

### 6.2 The live test — ONE pull, and what to look for

Everything is additive and observe-only, so a normal day pull exercises it. Judge it on the
**receipt**, never on the absence of a warning.

**Arm A — the healthy control (must be silent).** With athenaOne signed in and freshly
navigated, run a normal day pull. On the terminal status:

- **PASS** = *"Verified complete: schedule N/N; history N/N; failures 0."* with **no extra
  sentence**. A warning here is a false positive and the threshold needs raising.
- Confirm the evidence exists rather than trusting the silence — from the MLS tab console,
  read the schedule response's `sessionProof`. Expect
  `{liveSessionProven: true, proofVia: 'athena-frame-load' | 'athena-page-load', staleRisk: 'fresh'}`.
  **If `liveSessionProven` is `false` on a healthy pull, the webNavigation hook is not firing
  and the whole receipt is decorative** — that is the one outcome that invalidates the fix.

**Arm B — the owner's case (the reason this exists).** Leave the athenaOne day grid painted
and untouched for **>15 minutes** without navigating in it, then pull. Expect the terminal
status to carry: *"Heads up: these rows are what athenaOne had on screen N minutes ago, and
MLS saw no sign athenaOne served that tab since…"*, and
`calendarReceipt.scheduleFreshness = {stated:true, staleRisk:'stale', dataAgeMs:…}`.

**Arm C — the real signed-out case, if the owner is willing.** Sign out of athenaOne in a
second tab, leave the grid painted in the first, then pull. Expected shape: the schedule
still reads (that is the defect, and it is now disclosed), history reads refuse, and the
status names it — *"…your athenaOne session has most likely signed out or timed out. Sign in
to athenaOne, then pull again. Note the schedule above was read off the grid athenaOne still
had on screen…"*.

**Arm C is the one thing source analysis genuinely cannot settle**, and I want to be exact
about why: **whether athenaOne actually leaves the grid painted after a server-side expiry is
athenahealth's rendering behaviour, not ours.** If athena blanks or redirects the frame
immediately, the schedule read fails on its own and the staleness path never fires. The
mechanism is correct either way — it is the *frequency* that is unknown.

**No writeback testing is needed or requested.** Nothing in these two commits touches a write
path.

---

## 7. OPEN RISKS AND WHAT I DID NOT DO

- **No live verification of anything.** I touched no browser, no Chrome tab and no Athena
  session, per my constraints. Every claim above is source-read or harness-measured. The
  freshness receipt has **never run in a real browser** — `performance.timeOrigin` inside an
  athenaOne frame is standard, but the resource-buffer behaviour on their long-lived frames
  is unmeasured, which is exactly why `netBufferFull` disqualifies the value rather than
  trusting it.
- **The 15-minute threshold is a judgement, not a measurement.** It is one constant
  (`MLS_ATH_LIVE_WINDOW_MS`) in `background.js`. If Arm A produces false warnings, raise it;
  the suite does not pin the number, only the behaviour.
- **§4 and §5 are reported, not fixed.** #1/#2/#3 are user-visible false success claims on a
  clinical write path and are, in my view, higher severity than anything I fixed today — but
  they are outside the read-reliability lane and two of them sit on the sign-and-save
  boundary.
- **Scope item 4 (extension surfaces polish) is thin.** I did not run a dedicated visual
  audit of the panel, status centre and popups; the design lane's standards belong to Worker
  A. What I have is behavioural and is in §4: `mls-popup.js` renders a two-state UI over a
  three-state receipt, and `feat_mls_status_center.js` derives a green verdict from the
  absence of an error key. **Both are correctness problems wearing UI clothes, and a visual
  polish pass that does not fix them would make a false success claim prettier.**
- **`enumDiag` is still discarded by the app** — the richest diagnostic the extension
  produces never reaches the page, so only the reason string survives. Unchanged by this
  work; worth closing before the next ON-mode-class investigation.
- **ON-mode duration (~18 min/patient on a full-bodies pull)** is the real remaining
  ON-mode item. Correctness is done; speed is not.

# HANDOFF — QA / release-quality lane, 2026-07-26 (b667)

Written by the QA lane at context exhaustion. **Everything below is either measured or
explicitly marked unverified.** Where I was wrong tonight I have said so, because three
separate times a lane was nearly dispatched at a defect that no longer existed.

---

## 0. READ THIS FIRST — the rule the whole night earned

**An assignment must carry the measurement that justifies it AND the build it was taken on.**

Three times work was nearly spent on a repaired defect, each because the evidence behind the
assignment predated the fix:

- `.sc-src` in `feat_mls_status_center.js` — the file had **0** title writes by the time the
  assignment was read.
- `#mlsB39SgHead` — "5 references, no guard" counted *mentions of the id*. All five are CSS
  rules, one `querySelectorAll`, one `createElement`. **Not one is an attribute write.**
- A duplicate dispatch onto `build-bump-names-its-build.test.js` that I had already fixed 20
  minutes earlier.

**Corollary, learned the hard way:** re-derive state from the tip before acting. A live tab is a
*build*, not *the code*. A worktree cannot tell "not here" from "not anywhere".

---

## 1. STATE AT HANDOFF

```
origin/main   3d24f5e   b669
live          b669                       (mlsscribe.com/app-version.json, __MLS_AV=b669)
gate          333 suites green
E2E           30 steps, 0 failed         (real Chrome; grown 17 -> 30 tonight)
```

**All five gates I shipped are green at the tip.**

**⚠️ EVERY OTHER LANE IS STOPPED.** Checked 2026-07-26: all sessions report
`isRunning:false` — the design/UI lane last moved 02:27, defects 03:36. There is
nobody to coordinate with. `#mlsReviewPanel`, which the design lane said it had
built, **exists in no worktree on this machine** (main, claude-goal,
claude-defects, claude-commercial all checked). It was never produced. Anyone
resuming should not wait on that symbol.

---

## 2. WHAT IS ACTUALLY LEFT

### 2.1 🟡 The timer fleet — NOW MEASURED. It is a 2.4% idle tax that does nothing.

**Step one is done. Do not inherit the old framing — the COUNT badly overstated the COST.**

Measured at b667, 20s settled idle, foregrounded, liveness witness alive (clock 29 ticks):

```
setInterval registrations     264        (not 215 — more than reported)
   periods                    <1s: 76    1-5s: 154    5-10s: 8    >=10s: 26
fires in 20s                  3,582      = 179/sec   (reported ~204, close enough)
MAIN-THREAD TIME consumed     484ms of 20,000ms      = 2.42% of the window
fires causing NO DOM mutation 3,582 of 3,582         = 100%

most expensive owners (main-thread ms):
   mls-connect.js @2000ms   fires=200   211.9ms   noop=200    <- 1.06ms per fire, the worst
   mls-connect.js @1200ms   fires=400    94.3ms   noop=400
   mls-connect.js @1500ms   fires=587    53.0ms   noop=587
   mls-connect.js  @500ms   fires=296    20.2ms   noop=296
```

**What this changes.** "215 timers, 204 fires/sec" reads like an emergency. It is not: the whole
fleet costs **2.42% of the main thread** while idle. That is worth reclaiming but it is not the
boot problem and it will not feel like one. **Anyone who ships a 264-timer refactor expecting a
visible speed-up will be disappointed** — and a refactor that large on a clinical bundle is a
poor trade for 2.4%.

**What is genuinely damning is the other number: 100% of 3,582 fires caused no DOM mutation.**
Every single wake-up during idle did nothing observable. So the target is not "fewer timers", it
is **the four `mls-connect.js` intervals at the top of that list**, which alone are ~380ms of the
484ms. Fixing those four is a small, bounded change with most of the benefit.

**Caveat, stated honestly:** "no DOM mutation" is not "no work" — a callback may poll, compute or
touch storage without changing the page. The 484ms is the real main-thread cost; the 100% figure
says only that none of it changed what the user sees **while idle**. Do not quote the 100% as
"they do nothing" without that qualifier.

Probe: `scratchpad/probe-timers.js` (hooks `setInterval` via `evaluateOnNewDocument`, attributes
each fire to an owner file + period, times every callback, and counts fires that mutate nothing).

### 2.2 🔵 Review rebuild — IN PROGRESS (UI lane)

Owner's words: *"the review tab sucks and needs to be completely reworked from scratch"* — a
design verdict, not a bug report. Stage 1 shipped as b666 (*"pressing Review did nothing you
could see"*).

**⚠️ MY ORIGINAL HANDOFF ON THIS WAS WRONG, and the correction matters:**

- **There is no `reviewView`.** The twelve view containers are `patientsView`, `visitView`,
  `calendarView`, `ordersView`, `historyView`, `analysisView`, `recsView`, `studioView`,
  `teamView`, `intakeView`, `adminView`, `legalReqView`.
- "Review" is a **dock destination**: `{ id:'review', targets:['nav_orders','nav_recs'] }`, and
  `destTarget()` takes the first available target — **so Review *was* Orders.**
- **The thing the owner is looking at is `ordersView`.**

**The constraint that must survive the rewrite:** Review is the last human gate before anything
reaches Athena. However it looks afterwards, it must make the doctor **look** at what is about
to leave, and sending must never be the default. This codebase has documented history of
`handOff()` toasting *"note sent to Athena"* over **seven silent refusals**. A prettier Review
that is easier to click through is a **worse** Review.

---

## 3. CLOSED TONIGHT (verified, don't re-open)

| item | evidence |
|---|---|
| **Title war — last writer** | b667. Probe measured **13 writes → 0**. `grep "tb.title = isToday"` returns empty. |
| **Bump-script mislabelling** | b665. `af6b879` names b665 in its own message; label gate passes. |
| **`#mlsB39SgHead`** | Already fixed by b664. All 5 refs are CSS/read/createElement — no attribute write exists to guard. |
| **Body-class no-op writes** | b640. **86 → 0** in 20s idle, foregrounded (`visibilityState:visible`), page clock 29 ticks. |
| **Bubble merge (3 → 1)** | b651 + follow-up b658 (closed bubble ate clicks, opened wrong way). |
| **Lite-Review dead end** | b661. `'Upgrade in Settings'` = 0; `'See plans on the MLS home page'` = 1 in **both** prod and staging. |
| **Review, as shipped (b650+b666)** | Verified on a running page at b668: dock offers note/orders/recs; empty note refuses *and says so* without opening the gate; opening Review invokes **no** Athena write (send fns replaced with counters that don't call through). |
| **Review control unreachable by mouse** | **b669, and the most important find of the night.** See §8. |

**b664 churn result, the real story** (attributes per 8s idle, b624 → b664):

```
patients 442 -> 336 (-24%)     visit 400 -> 193 (-52%)
review   178 -> 118 (-34%)     calendar 258 -> 180 (-30%)
verdict: "patients LOUD"  ->  "no view mutates loudly while idle"
```

---

## 4. THE GATES I SHIPPED — what they protect, and how they fail

All in `tests/`, all registered in `run-all.js`.

1. **`no-merge-conflict-markers-in-shipped-assets.test.js`** — 352 shipped parse-critical files.
   Shipped after `6ea5677` hotfixed conflict markers **served to users**.
2. **`build-bump-names-its-build.test.js`** — a commit changing `app-version.json` must name that
   build **anywhere in its message** (`git log --grep` searches the body), and no two commits may
   claim the same token.
   **`CUTOFF` has been advanced ONCE** (`2c066c5` → `bdf150e`). **If it ever moves again, the
   conclusion is that a ship path is routing around the gate — not that the gate is
   inconvenient.** That already happened once: the extension-release path bumps
   `app-version.json` without running `run-all.js`, which took main red. The durable fix is for
   the bump script to write the token into the message it generates; it already knows the number.
3. **`tree-contains-everything-published.test.js`** — refuses to ship from a tree missing
   published work (`git merge-base --is-ancestor origin/main HEAD`). Escape hatch for legitimate
   mid-development: `MLS_ALLOW_STALE=1`. **It caught its own author within minutes of shipping.**
4. **The E2E suite** — `tests/e2e/run-e2e.js`, 30 steps in real Chrome, **still NOT in
   `run-all.js`**, so nobody runs it automatically. It had been silently unrun for 30+ builds.

```bash
MLS_E2E_PUPPETEER_DIR=<dir whose node_modules has puppeteer-core> node tests/e2e/run-e2e.js
```

`puppeteer-core` downloads no browser and drives the installed Chrome, so install it **outside
the repo**. **Proposal still open:** register it behind `MLS_E2E=1` once it has ~10 green builds.
If you add steps, use `reloadApp(page)`, never a bare `page.reload()` — dismissing a
`beforeunload` **cancels the navigation** and reports as a 30s nav timeout.

---

## 5. INSTRUMENT TRAPS — every one of these cost real time tonight

1. **A zero is only trustworthy if a witness ticked.** Before believing "0 churn", assert the
   page's own `#ez3Clock` advanced in the same window. A throttled or hidden tab reports zero for
   everything. Never validate with an injected timer.
2. **Count writes, not mutations.** I called `#mlsPortalInviteBtn` "the loudest churner in the
   app" from a *mutation* count; a *write*-level probe measured **0**. Retracted.
3. **A point-in-time attribute census is worthless here.** The title count read 1, then 12, then
   0 with nothing shipped — it was catching transient writes mid-flight between a writer and the
   stripper. **Only write-rate over a window means anything.**
4. **A `MutationObserver` cannot name a writer** — its callback runs async and carries the
   observer's stack. Hook **both** `Element.prototype.setAttribute` **and** the
   `HTMLElement.prototype.title` property descriptor, installed via `evaluateOnNewDocument`.
   Property assignment bypasses a `setAttribute`-only hook; that cost an hour.
5. **Converging static evidence is not runtime evidence.** I raised a stop-work claiming
   `data-tip` renders nothing without the extension — **five** independent static signals agreed,
   every one individually true, conclusion **false**. `#mlsTip` exists page-side; hovering with no
   extension renders a real tooltip (`display:block, opacity:1, 192×36`). **Do not re-raise this.**
6. **Pipeline truncation hides failures.** `| tail -1` on a failing node process left the bare
   string `Node.js v24.18.0` — neither pass nor fail. Same family as `| Select-Object -First N`
   killing a mid-write patch. (The mistyped filename exits **1**; the exit code was fine, the
   pipe discarded it.)
7. **Absence in a local harness is not absence on the owner's tab.** The ten `.sc-src` status rows
   exist only with a **connected extension and live backend** — a local harness never populates
   them.

Probes, all in the session scratchpad: `probe-idle-churn.js` (per-writer churn with computed
visibility), `probe-title-writer.js` (names writers at write time), `probe-bodyclass.js`,
`probe-datatip-renders.js`, `probe-ordersbody.js`.

---

## 6. STILL UNMEASURED — honest gaps, do not record as verified

- **`#visitOrdersBody` with a real note loaded.** It reads 0 mutations where 16 were once
  measured, but `#noteCard` is revealed by `body.ez3adv` (clicking **"Advanced visit workspace"**)
  and is **not** gated on note content — which is why seeding `noteBox` never un-hid it and why
  several sessions measured it at rect 0×0 and wrongly demoted it.
- **The owner's "glitches every 5 seconds"** was never reproduced in an *empty* app. Signed into
  Athena he can pull a real schedule, which produces the **loaded** state — the one condition
  where it may still live.

---

## 7. WORKING AGREEMENTS THAT PREVENTED OUTAGES

- **Work in a worktree outside the repo tree.** A parallel session once committed my in-flight
  edit into a live build, untested.
- **Rebase, gate, push fast; abandon the NUMBER, never the work.** Main moved under me six times
  in one evening.
- **`background.js` is byte-edit only** (node, latin1). Never the Edit tool.
- **PowerShell:** `Set-Content -Encoding utf8` adds a BOM that breaks the extension digest — use
  the Write tool for commit messages. `>` rewrites LF→CRLF. `&&`/`||` are parse errors inside
  `node -e`; use a script file.
- **latin1 patch scripts must assert exactly-one-match per anchor**, and encode anchors the same
  way the file is read — a UTF-8 em-dash is 3 latin1 chars and silently matches nothing.
- **Hard stops:** orders, real-patient writes, payment PRs.

---

## 8. b669 — the review control was landing under the bubble (the night's best find)

**A control can be visible, focused, and unreachable by mouse — and every check
here asserts focus, so all of them passed.**

`scrollIntoView({block:'nearest'})` is **by definition the minimum scroll**. So a
control below the fold comes to rest with its bottom **FLUSH to the viewport
bottom** — exactly where the merged Copilot bubble lives, `position:fixed` in the
bottom-left corner.

Measured at b668, real Chrome, 1400x900, bubble in its **CLOSED resting state**,
after pressing "Next: Review & send to Athena":

```
#pushAllEmrBtn   rect top=860 bottom=900   margin below = 0px of 900
7 of 9 sample points across the 192px button owned by #mlsCopVoiceBtn
a real TRUSTED mouse click at its centre (316,880) -> received by the BUBBLE
```

Reproduced at 1400x900, 1280x720, 1280x600. **0px of margin every time**, because
that is what 'nearest' guarantees.

**It is a SEAM, not a defect in either change.** b666 (make Review's press
visible) and b651/b658 (merge three bubbles into one) are each correct alone. The
defect exists only where they meet — which is exactly what no single lane could
have measured, and the clearest argument in this repo for a QA lane that owns
cross-lane interactions.

**Fix:** reserve the overlapping fixed furniture as `scroll-margin-bottom` before
scrolling, so 'nearest' rests clear of it. Every earlier decision survives — still
the minimum scroll, still never `block:'center'`, still **0px movement when the
control is already clickable** (re-measured; that is the 2026-07-16 owner decision
against jumping). After: **9/9 reachable, 231px margin, real click lands on the
button**, all three viewports.

**⚠️ THE FIX DEGRADES SILENTLY.** Clearance is computed by element-id lookup
(`REVIEW_FIXED_FURNITURE` in mls-connect.js). Rename the bubble and every lookup
returns null, clearance falls to 0, and the defect returns **with a green suite
and no error anywhere**. That is what
`tests/review-control-clears-fixed-furniture.test.js` exists to make loud.

**That gate got it wrong twice before it was trustworthy, and both failures are
instructive:**

1. **v1 passed on the exact regression it was written for.** It searched the
   source with the id list still in it, so a renamed id matched the very line that
   renamed it. Circular.
2. **v2 then failed on a perfectly healthy tree** — the haystack was
   `mls-connect.js + ScribeFlow.html`, but the bubble is built in
   `feat_mls_voice_cluster.js`. A false alarm like that trains the next person to
   delete the test rather than read it.

**Rule earned: prove a new gate FAILS on the real regression AND PASSES on the
real tree before trusting it. Both directions, every time.**

The b666 pin (`review-step-never-fails-silently.test.js`) was **widened
deliberately, not relaxed**: it required the literal
`if (offscreen && send.scrollIntoView)`; it now requires **both** `offscreen` and
`covered` terms and still forbids an unconditional scroll. Strictly stronger.

**Probes** (session scratchpad): `probe-review-shipped.js` (the four assertions
incl. send-safety), `probe-review-jump.js` (attributes page movement),
`probe-review-overlap.js` (rect intersection at three viewports),
`probe-review-clicksteal.js` (**the decisive one** — a real trusted mouse click).

**Instrument trap #8, learned here:** measuring `scrollY` immediately after
`scrollIntoView({behavior:'smooth'})` reads **0 by construction** — smooth scroll
is asynchronous. My first attribution charged the movement to "not b666" on that
basis and was wrong. What settled it was the **complete** scroll-event log: that
call was the only scroll in the arm, so the movement was its by elimination.

**Live verification, stated honestly.** b669 is served (`__MLS_AV=b669`) and the
fixed bytes are confirmed on the wire (`REVIEW_FIXED_FURNITURE`,
`scrollMarginBottom`, and both guard terms all present in the live
`mls-connect.js`; `mlsVoiceCluster` present in the live
`feat_mls_voice_cluster.js`, so the clearance resolves). **NOT done: a live
behavioural re-measurement.** The harness cannot get past auth on the live site,
and creating an account or entering credentials there is a hard stop. Someone with
a real signed-in session should press Review once and confirm the button is
clickable where it lands.

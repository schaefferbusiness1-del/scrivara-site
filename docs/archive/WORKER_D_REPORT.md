# WORKER D — visitView + patientsView rebuild, 2026-07-26

**Branch:** `worker-d-visit` · **Worktree:** `dispatch-work/worker-d-visit-20260726`
**Base:** `origin/main` @ `4c340c0` (b677) · **Nothing pushed.**
**Gate:** `node tests/run-all.js` → **340/340 PASS**, run clean, **no `MLS_ALLOW_STALE`**.

Two mid-build owner directives arrived and are both addressed below — the
three-chips merge (§4) and the two-textboxes / labelling pass (§5, §6).

---

## 0. HOW EVERYTHING HERE WAS MEASURED

No live tab was touched. Every number is from the **real app booted offline** in an
**isolated headless Chrome with its own temporary profile** — the route
`tests/e2e/run-e2e.js` uses:

```
local static server -> ScribeFlow.html?demo=1 -> on-device demo signup -> probe
```

Settle recipe on every sample: `showView` → 700ms →
`document.getAnimations().forEach(a => a.finish())` → 180ms. A rect read mid-entry-animation
lies, and a headless viewport that is never sized makes every height wrong.

**Before/after are measured on two separate trees**, not on one tree with edits toggled:
`dispatch-work/worker-d-baseline-20260726` is a detached worktree pinned at pristine
`origin/main`. That is why "before" numbers can be trusted as the shipped behaviour.

Harness, probes and both raw censuses (`count-before.json`, `count-after.json`) are at
`C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\worker-d-shots-20260726\`.

### Four instrument faults caught before they became findings

Recording these because three of them would have shipped as fixes for problems that do
not exist, and one of them *did* nearly ship as a non-fix.

| # | Looked like | Actually was |
|---|---|---|
| 1 | *"the merged voice control does not open"* | `page.mouse.click()` at a y beyond the viewport. The control was at `top:840` in an 800px window. Scroll first, then click. |
| 2 | *"fan item 3 is only 3/5 reachable"* | the probe called `scrollIntoView` **between** samples, reading rects across a reflow. Measured without moving the page: **9/9 on all three**. |
| 3 | *"the hot-mic state does not stick"* | marking `aria-pressed` by hand is overwritten by `syncPrimaryVoiceTools` within a tick — the app correctly owning its own chip. Drive `isListening()` instead: the same value the lane reads. |
| 4 | *"patientsView is down to 22 controls"* | **true, and the screenshot still showed "Export full history (PDF)" on the card.** The rule said `#mlsfhpdf-btn`; it is a **class**. It matched zero elements, hid nothing, and reported identically to a rule that worked. Fixed in `e49b9ae`. **A hide that matches nothing looks exactly like a fix that shipped.** |

Fault 4 is the one worth carrying forward: the count was right, the conclusion was
wrong, and only *looking at the picture* caught it.

---

## 1. CONTROL COUNTS PER SCREEN STATE — BEFORE / AFTER

Visible interactive controls inside `#visitView` / `#patientsView`. Judged from each
element's **own** computed style plus its ancestors, rect ≥ 2×2. **The dock is excluded**
— it is untouchable and constant. `#mlsRightNow` sits outside both containers and is
counted separately.

`chrome` = the surface's own controls. `rows` = per-patient-row controls, which scale
with list length (2 patients seeded here, so 6; at 150 patients it is 450). Reporting
them apart is the only way the number means anything at both sizes.

| state | before | after | chrome | rightNow |
|---|---|---|---|---|
| **P1** patients, none selected | **19** | **11** | 13 → **5** | 3 → 2 |
| **P2** patients, patient open | **36** | **22** | 30 → **16** | 3 → 3 |
| **V1** visit, schedule, no visit locked | **16** | **10** | 16 → **10** | 1 |
| **V2** visit, visit locked, nothing recorded | **28** | **10** | 26 → **8** | 1 |
| **V3** visit, recording *(see caveat)* | **27** | **9** | 25 → **7** | 1 |
| **V4** visit, transcript, no note | **28** | **10** | 26 → **8** | 2 |
| **V5** visit, note ready, unsigned | **43** | **10** | 41 → **8** | 1 |

**Chrome controls across the seven states: 177 → 64 (−64%).** The worst state, V5, went
**43 → 10**.

⚠️ **V3 is not a real recording.** Headless Chrome has no microphone, so `startCapture`
never engages and the engine stays in the idle phase. V3 is therefore V2 measured twice.
Stated rather than quietly folded in.

### The primary is now the biggest thing in every state

| state | the state's next action | before | after |
|---|---|---|---|
| P2 patient open | **Start visit** | 93×26 = **2,405px²** (4th smallest of 36, at opacity .5) | 688×62 = **42,656px²** — **17.7×** |
| V4 transcript exists | **Generate one note** | 185×45 = 8,325px² | 720×62 = **44,640px²** |
| V5 note ready | **Review & send to Athena** | 244×40 = 9,748px² | 690×62 = **42,780px²** |
| V1 / V2 | Start Recording — *name* | 720×82 (already correct) | unchanged |

P1 deliberately has **no button hero**: with no patient selected the search + list *is*
the surface, and it leads by 4.6× (search 1084×52 = 56,357px² vs the largest button,
the ghost "Pull from Athena", at 10,479px²).

### What the before-numbers actually were

Two measurements are the whole argument for this lane:

```
patientsView, a patient open — size order, b676:
  Copy every visit from athenaOne   322x42 = 13,536px^2
  Pull from Athena                  250x42 = 10,479
  Export full history (PDF)         180x33 =  5,868
  Export everything for EMR         180x28 =  5,044
  ...
  Start visit                        93x26 =  2,405   <- FOURTH SMALLEST, opacity .5

visitView, a visit locked, b677, with 1,653 characters of transcript present:
  #ez3Rec    "Start Recording"     720x82 = 59,040px^2   <- the hero
  #ez3flGen  "Generate one note"   185x45 =  8,325px^2   <- the actual next step
  ...unchanged twelve seconds later, and it never changes.
```

---

## 2. THE 1-MINUTE WALKTHROUGH (≤6 steps, each target the biggest visible thing)

### Visit — record a patient and send the note

1. Open **Visit** in the dock. The screen shows one big green button:
   **"🎙 Start Recording — Dawn I Jenkins"** (720×82). Press it.
2. Talk. The only other thing on screen is the transcript filling in.
3. Press **"⏸ Stop recording"** — the same button, in place.
4. The big button becomes **"✨ Generate one note"** (720×62). Press it.
5. The big button becomes **"Next: Review & send to Athena"** (690×62). Press it.
6. Review reads the send path's own plan. Confirm there.

Nothing in this list needs explaining, and no step requires finding a small control.

### Patients — open a patient and start their visit

1. Open **Patient** in the dock. The search field is the biggest thing; the list is
   under it.
2. Type a name (or press the patient's row).
3. The chart opens on the right with **"🎙 Start visit"** (688×62) at the top.
4. Read the prep rows underneath — problems, meds, allergies, insurance, timeline.
5. Press **Start visit**.

Everything else on either screen is behind **"⋯ More"** (Patients) or
**"🧰 Visit shortcuts"** (Visit) — both of which already existed.

---

## 3. WHAT LEFT THE SURFACE, AND WHERE IT WENT

Nothing is deleted. Every selector is **class-hidden — never inline**, because
`available()` reads INLINE display and an inline hide silently removes the control from
the Calm Shell Tools menu. Every one is named in `feat_mls_visit_focus.js`'s `ROUTES`
table with the control that reaches it, and
`tests/visit-focus-keeps-every-route.test.js` fails if a hide rule is added without one.

**No new control was introduced on either screen** except the merged voice control (§4).
The routes are disclosures the app already had.

| left the surface | route back |
|---|---|
| `#ptGroupBar` (4 grouping buttons), `#ptSort`, `#mlsStudyLaunch`, `.mlsfhpdf-btn` | **⋯ More** on the Patients card |
| `#profileCard .mls-moved` (Schedule, Draft op note, Share/Export, Export everything for EMR, Verify saved data, Copy every visit from athenaOne, Add a visit) | **dock › Tools** — every one is in the shell's `TOOLS_SOURCES` — and **⋯ More** |
| `#dailyBriefBar` two buttons ("Start seeing patients", "See schedule") | **the dock.** Both are bare `showView()` calls; contract law 1 says nothing else navigates. |
| `#mlsWdDeck` in its starter state (a **390×484** deck advertising three widgets to install) + its authoring row | **dock › Tools › AI Studio** (`customWidgetHdrBtn`). Widgets the doctor has actually built keep their cards. |
| `.ez3-row2` (up to **twelve** same-size chips), `#ez3StyleChips` (8 note-format chips) | the **🧰 Visit shortcuts** chip already on the visit |
| `#mlsDsStrip`, **only once a visit is locked** | the visit home screen — press "‹ Patients" |

**Revealed at full size, not at half opacity.** The Calm Shell could not `display:none`
the relocated patient-card actions because Snapshot and Share/Export position their
popovers from their own `getBoundingClientRect()`, and a hidden button measures 0×0 — so
it settled for `opacity:.5`, which left them competing with the primary. A **disclosure**
solves what a blanket rule could not: closed they are gone; opened they are laid out at
full size and their popovers anchor correctly.

---

## 4. THE OWNER'S "1 AMAZING THING" — three voice chips become one

`feat_mls_visit_voice_one.js` (**vo-1.0.0**), commit `6c9f676`. Acknowledged: this
supersedes the earlier instruction to keep the three as quiet chips.

**It EXPANDS. It never DECIDES.** Copilot Voice and Dictate are different recognizers
under the one-recognizer truce (`mls-connect.js` F11) — one writes into the visit
transcript and one does not. It offers three **named** options and picks nothing.

**It is IN FLOW.** `position: static`, inside the `.ez3fl-quick` row it replaces; the fan
pushes the page rather than covering it. The floating version of exactly this merge ate
clicks (b658) and covered the review control (b669) and was retired at b676.

Measured on the running page:

```
mounted / visible / 3 options, host .ez3fl-quick        position: static, 0 floating nodes
a REAL trusted mouse click at the face centre           opens; fan 720x200, in flow
elementFromPoint at 9 points per fan item               9/9, 9/9, 9/9
a REAL click on "Dictate"                               drove exactly one control: ez3flDictate
12s settled idle, page clock witnessed 17 ticks         0 fan rebuilds
phone 390x844                                           0 overflow; items 5/5 reachable
face height                                             44px (first build 38px — under the floor)
```

**Hot mic.** With Copilot Voice listening — driven through the app's own `isListening()`,
the same value the lane reads — the collapsed face turns live and **names** it:
`Copilot Voice · listening`, `aria-label="Copilot Voice is listening. Open voice and
assistant tools."` A generic dot cannot tell Copilot Voice from Dictate.

That rule needed an override the floating version never did: `mls-connect.js` drops the
whole chip row under `body.mls-phone`, which is right for three idle chips and wrong for
a live microphone. **Measured:** idle the row is `display:none`; live it returns carrying
nothing but this control, siblings hidden.

**Class-hide verified in the state that matters.** With **Visit shortcuts OPEN** the lane
clears its own inline display and only this module's class rule hides the three
originals — `inline: "(cleared)", computed: "none"` — so `available()` still offers all
three in dock › Tools.

Gate: `tests/visit-voice-one-expands-never-decides.test.js`, **negative-tested three
ways** before being trusted — making it float FAILS, adding a timer FAILS, stranding an
original FAILS, the shipped tree PASSES.

---

## 5. 🔴 THE BOTTOM-LEFT BUBBLES WERE NEVER RETIRED (commit `79d40b1`)

**This is the most important finding in this report and it needs the lead's live tab.**

b676 shipped vc-2.0.0 — *"REMOVE THE BOTTOM LEFT BUBBLES"* — and reported itself done.
Measured on the **pristine** tree at b677, visit screen, visit locked, with the
retirement fully active (`body.mls-voice-cluster` set, `__mlsVoiceCluster = vc-2.0.0`):

```
#mlsCopVoiceBtn   position:fixed   207x41   @252,745   z-index 99997
#mlsAsstFab       position:fixed   149x35   @469,751   z-index 2147483600
#mlsDaDock        position:fixed    89x33   @628,753   z-index 2147482900
```

All three **visible, floating over the visit transcript.** The before-screenshot at
`shots-before/V4-transcript-no-note.desktop.png` shows them covering the transcript's own
header.

**Why every hide lost.** Each pill carries an **inline** declaration:

```
display: inline-flex !important;  transform: none !important;
inset: auto auto 14px 252px !important;
```

An inline `!important` outranks an author `!important` stylesheet rule, so all **four**
matching rules lost to it — `mls-top-voice-tools`, `mls-redesign`, `mls-calm`, and b676's
own retirement. The writer is **ft-1.1.3 in `mls-connect.js`**, a desktop force-show added
on the owner's **own order of 2026-07-21** and re-asserted every 1500ms. That order was
superseded on 2026-07-26 and the code never learned.

Nothing failed. No test failed, no error logged, the retirement commit was truthful about
what it changed. The owner has simply been looking at three bubbles over his transcript
ever since, on the screen he uses most.

**Fix:** the force-show stands down when `body.mls-voice-cluster` is set, and *releases*
its inline declaration rather than fighting a stylesheet it will always win against.
**Verified on the running page: all three now compute `display:none` with no inline
declaration at all.**

Reach checked, not assumed: the class-hide leaves inline display untouched, so
`available()` still offers all three in dock › Tools — and `feat_mls_redesign.js`'s
`#mlsCopVoiceBtn.mls-bl42-on` rule outranks the retirement, so a Copilot Voice that is
**actually listening** still shows its pill. The hot mic is not hidden by this.

---

## 6. THE TWO-TEXTBOX DIRECTIVE — honest status

Owner: *"sometimes 2 textboxes pop up — all errors like this must not make final
product."* Confirmed on his tab at b677: `#ez3flTranscript` (top 323, 690×126) **and**
`#ez3Transcript` (top 877, 686×142) both visible, same placeholder.

**Root cause identified.** The app's existing rule is
`#mlsEz3Body.ez3fl-top-owns .ez3-transcript-card{display:none}` — keyed on a **class the
lane sets when it believes it owns the transcript**. On the owner's tab that class was off
while the lane was still painting its box, so both rendered. A class is a claim; the DOM
is a fact.

**What shipped:** a second, fact-based rule that stands the engine's copy down only when
the lane's transcript is really present **and** really not hidden:

```
#mlsEz3Body:has(.ez3fl-record:not([hidden]) #ez3flTranscript:not([hidden])) .ez3-transcript-card
```

Both `:not([hidden])` terms are load-bearing **in the opposite direction** — the b653
lesson is that a rule which can hide the *last* transcript is worse than one that shows
two.

**⚠️ NOT REPRODUCED LOCALLY, so NOT VERIFIED AS A FIX.** Across every state I could drive
— including stripping `ez3fl-top-owns` by hand — the harness measured **exactly one**
transcript surface in all seven states, on the pristine tree *and* on mine, identically.
So this is a defensive invariant that provably applies and provably does not zero out any
state I can reach; it is **not** proof that the owner's state is closed. **Someone with a
live signed-in session should reproduce it and re-measure.**

Pinned by `tests/visit-focus-keeps-every-route.test.js`, which also fails if a **fourth**
transcript-like id ever appears — the invariant names exactly three (`transcript`,
`ez3Transcript`, `ez3flTranscript`) and a fourth is a third visible box waiting to happen.

---

## 7. LABELLING (commit `32d7c95`)

Measured per view, **visible own-text labels only** — a welded `textContent` reads block
children too and would have hidden this:

```
visitView      0 duplicate labels, 0 headings over 3 words
patientsView   "Edit" x2 visible, "Record" x2 visible
```

- **"Record" ×2** is the per-row action on two patient rows — the same action on
  different subjects. That is the row pattern; allowed.
- **"Edit" ×2 visible (five in the markup)** was not. Worker A gave them accessible names
  at b675, which fixed the screen reader; the visible label was still "Edit" five times.
  They now name their object: *Edit problems / meds / allergies / summary / insurance*.

**Two headings still over budget** — "Doctor prep summary" (4) and "Key risks &
reminders" (5). Both belong to the prep-summary module, whose wording is pinned by
`tests/prep-summary-clinical-negatives`, and the prep rows are explicitly protected by
contract §9. **Reported, not renamed** — that is a deliberate decision for the lead.

**Animation:** no timing curves were invented. The merged voice control animates
`transform`/`opacity` only, and every animation is off under
`@media (prefers-reduced-motion: reduce)` — both pinned by its gate. **It does not yet
consume Worker F's shared tokens because they do not exist on this base.** When F lands
them, the four literals in `feat_mls_visit_voice_one.js` (`.16s`/`.18s`/`.14s`, two
cubic-beziers) should be swapped for the tokens; they were chosen to match the existing
lane, not to compete with F.

---

## 8. SCREENSHOTS

`C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\worker-d-shots-20260726\`

```
shots-before\<state>.desktop.png     1280x800, full page, pristine origin/main (b677)
shots-before\<state>.phone.png        390x844, full page
shots-after\<state>.desktop.png      1280x800, full page, this branch
shots-after\<state>.phone.png         390x844, full page
```

states: `P1-no-patient-selected`, `P2-patient-open`, `V1-visit-home-schedule`,
`V2-patient-locked-idle`, `V3-recording-live`, `V4-transcript-no-note`, `V5-note-ready`.

The two worth opening first:

- `shots-before/V4-transcript-no-note.desktop.png` — three floating pills over the
  transcript (§5), and the wrong action as the hero.
- `shots-after/P2-patient-open.desktop.png` — the patient card leading with one
  688×62 **Start visit**.

`count-before.json` / `count-after.json` carry every control measured, with rects.

---

## 9. COMMITS (7, none pushed)

| hash | concern |
|---|---|
| `37ac9e3` | patients: the primary action stops being the smallest thing on the screen |
| `001c219` | visit + patients: one primary per state, everything else answers to a disclosure that already exists (**vf-1.0.0**) |
| `6c9f676` | visit: the three voice chips become ONE control that expands — never one that decides (**vo-1.0.0**) |
| `79d40b1` | visit: the bottom-left bubbles were never actually retired — an inline `!important` was force-showing them |
| `32d7c95` | patients: five buttons that all said "Edit" now say what they edit |
| `591f046` | gate: register the two new suites and raise the boot ceiling by two, deliberately |
| `e49b9ae` | fix: the full-history export hide matched nothing — `mlsfhpdf-btn` is a class, not an id |

Files touched: `feat_mls_calm_shell.js`, `feat_mls_visit_focus.js` (new),
`feat_mls_visit_voice_one.js` (new), `mls-connect.js`, `public-preview-runtime.js`,
`ScribeFlow.html`, two new tests, `tests/run-all.js`, `tests/boot-script-budget.test.js`,
`tests/fixtures/ui-control-manifest.json`.

**Not touched:** theme tokens, the dock, `background.js`, any other view, `privacy.html`,
`terms.html`.

---

## 10. PINS UPDATED, AND WHY

**Nothing was deleted. Two pins moved, both deliberately.**

1. **`tests/boot-script-budget.test.js` `CEILING` 235 → 237** (`591f046`). Two modules
   added. Both are **deferred on `requestIdleCallback`**, so `EAGER_CEILING` deliberately
   does **not** move — arm B now *proves* the post-login burst is unchanged rather than
   asserting it: **233 eager / 4 deferred, eager ceiling still 234**. Folding them into an
   existing `feat_` file to keep the count flat would have been the dishonest version, for
   the same reason recorded above the voice cluster: both change what a doctor sees on the
   two clinical screens, which is exactly the change you want to back out on its own. The
   reason, and the measured counts they buy, are written into the file above the constant.

2. **`tests/fixtures/ui-control-manifest.json` regenerated** (`32d7c95`). The coverage
   suite refuses a stale manifest. The diff is large because the manifest records line
   numbers and this lane inserted lines into `mls-connect.js`; the suite's own fingerprint
   deliberately excludes line numbers, so what actually moved is the **set**: five controls
   relabelled, two added (the merged voice face and its fan). ⚠️ **This file will conflict
   with any other lane that edits `mls-connect.js` or `ScribeFlow.html`. Regenerate with
   `node tools/ui-control-inventory.js` after merging, do not hand-resolve it.**

3. **`feat_mls_calm_shell.js` `PT_MOVED` lost `start visit`, and its ACTIONS entry lost
   `moved: true`** (`37ac9e3`). Not a test pin — a behaviour pin, and both halves are
   argued in the file with the measurements. No suite referenced `PT_MOVED`'s contents.

---

## 11. NEEDS THE LEAD'S LIVE-TAB VERIFICATION

1. **§5, the bubbles.** Confirmed by measurement on a pristine local tree; the fix is
   confirmed locally. **What is unverified is whether the owner's live session shows the
   same three pills** — his account may hit the `savedControls.showVoice === false` early
   return, in which case he sees only two. One look settles it.
2. **§6, the two transcript boxes.** Root cause identified and a defensive rule shipped,
   but **the duplicate state was never reproduced locally**. Someone must drive his actual
   state and re-measure. This is the one item in this report I would not describe as
   fixed.
3. **V3 (recording live) is unmeasured** — headless Chrome has no microphone, so the
   recording state was never genuinely entered. Every count for V3 is really V2.
4. **`#mlsRightNow`** is app-level chrome outside both view containers, so it is outside
   this lane's ownership. It still carries a proxy of "Pull from Athena · READ-ONLY" at
   244×37 = 9,028px² beside a "Start visit" proxy at 100×37 = 3,700px² on the Patients
   screen — the wrong one is 2.4× bigger. The on-page primary now leads by 17.7×, so the
   screen reads correctly, but the bar itself is still inverted. **Worker E or F should own
   this**; the measurement is above.
5. **The engine's stale-render defect** (§1, V4/V5) is real and unfixed at source.
   `renderDoctor` already picks the right primary; the 700ms doctor-room poll only
   re-renders when `S.phase` moves, and typing a transcript does not move the phase. I
   fixed the *appearance* in CSS deliberately — a re-render of `#ez3Wrap` destroys the
   textarea a doctor may be mid-sentence in, and this repo has a focus-carry mechanism and
   a dedicated suite because that has bitten. **The trigger wants its own measured pass.**
6. **`:has()`**. Six rules in `feat_mls_visit_focus.js` and three in
   `feat_mls_visit_voice_one.js` use `:has()`. Chrome 105+; verified `CSS.supports` true in
   the harness. Where it is unsupported the rules simply do not match and the screens
   render exactly as they do today — degradation is to the status quo, never to a broken
   surface. Worth a conscious decision if any target browser predates it.

---

## 12. OPEN RISKS

1. **`origin/main` moved from b676 → b677 during this lane.** Rebased once, cleanly. If it
   has moved again, rebase before re-gating — and regenerate the control manifest rather
   than resolving it by hand.
2. **The merged voice control adds one visible chip to the visit row** (`Voice tools`),
   beside the existing `Visit shortcuts`. That is deliberate and required: requirement 3
   says a live recognizer must be visible without opening anything, so it cannot live
   behind another disclosure. Two disclosures side by side is the cost of the hot-mic rule.
3. **The phone hot-mic override is `:has()`-dependent and was measured with
   `body.mls-phone` applied by hand**, not by a real handheld. It behaved correctly (row
   returns, siblings hidden, face names the recognizer), but a real phone should confirm
   it.
4. **`P2` measured 22 and once 24 across runs** — which folds are open on the patient card
   varies with what the calm shell has folded by the time the sample is taken. The 22
   figure is from the committed tree; treat ±2 as measurement noise on that state only.
   Every other state was stable across every run.

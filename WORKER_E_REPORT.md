# WORKER E — views, settings surfaces, modals/popups/toasts

Branch `worker-e-views`, based on `origin/main` @ `9151dda` (b676). **Six local
commits. Nothing pushed.** `node tests/run-all.js` — **341 suites green**
(338 at base + 3 new gates I added).

Everything below was measured on a **running page**: local static server,
`ScribeFlow.html?demo=1`, real Chrome via `puppeteer-core` installed **outside
the repo**, throwaway profile, at 1280×800 and 390×844. Where I was wrong, I
say so — three of my own instruments lied before the product did, and each one
nearly became a shipped "fix".

---

## 0. THE TWO THINGS THAT NEED YOU FIRST

### 0.1 🔴 The dock was being eaten. Fixed — please confirm on the owner's tab.

A **real, trusted mouse click at the exact centre of the dock's "Patient"
button** was received by a different element. Not a near miss; the click.

```
                 before                                            after
1400x900  Patient owns 3/9 sample points; real click -> #mlsCopVoiceBtn      9/9
390x844   Patient owns 3/9;               real click -> #mlsDaDock           9/9
1280x800  every dock button 6/9 - 9/9                                        9/9
```

Two independent causes, both invisible to every check we had:

1. **The retired bubbles were force-shown INLINE.** `ft-1.1.3` in
   `mls-connect.js` carried an owner order from **2026-07-21** — *put the three
   bottom-left pills back on desktop* — implemented as
   `style.setProperty('display','inline-flex','important')`. On **2026-07-26**
   the owner retired those pills (vc-2.0.0, b676) and that retirement was
   written as **CSS**. Five independent `display:none!important` rules now match
   each pill (`mlsVcStyle`, `mlsCalmShellCss`, `mlsRdStyle` ×2,
   `mlsEz3GradientCss`) — **and one inline `!important` outranks all five**. The
   newer order lost to the older one at CSS precedence, silently, and
   `tests/voice-cluster-*` kept passing because the CSS it asserts really is
   there. Only walking `document.styleSheets` and reading
   `getPropertyPriority` **on the element** settles a question like this.
2. **The toast intercepted clicks while invisible.** `.toast` is
   `display:block` always; hiding it is `opacity:0` +
   `transform:translateY(80px)`. That transform parks the empty 46×28 element
   at y 735–763 — inside the dock's 697–782 — and **opacity does not affect
   hit-testing**. My own first census filtered on `opacity:0` and reported it
   absent.

**Needs your live verification:** press each dock button once on the owner's
signed-in tab. My proof is a local demo account; the owner's build carries the
extension and a real store.

### 0.2 🔴 Team is HELD, not broken. Releasing it is your call, not mine.

The assignment said *"a stray inline hide or a settings toggle"*. It is
neither, and the difference decides what may be done.

`#nav_team` has **two** deliberate owners:
- the static markup ships `style="display:none"` (ScribeFlow.html:1867);
- `applyAccessUI()` recomputes it every time from
  `__MLS_TEAM_WORKSPACE_RELEASED === true && backendMode() && isHead`.

`__MLS_TEAM_WORKSPACE_RELEASED` is defined
`{value:false, writable:false, configurable:false}` — **immutable on purpose** —
under the comment *"Team/supervision is held until its role, persistence, and
cosign paths are released"*. `showView('team')` fails closed on the same flag,
and `installHeldWorkflowNetworkBoundary()` blocks `/api/team/(lawyers|doctors)`
at the fetch layer. `tests/legal-network-workspace-held.test.js` pins it in
four places.

So: flipping it would expose cosign and supervisory-grading paths whose own
comment says they are not ready, **and the network boundary would still refuse
the fetches**, so the view would render broken. **Deleting the inline hide
without releasing the workspace is worse than today**: the doctor gets a Tools
row that toasts *"The Team workspace is not released."* — a route that goes
nowhere, which truth rule 10 forbids.

**The one-line change, if you decide to release it** (ScribeFlow.html ~24579):

```js
__MLS_TEAM_WORKSPACE_RELEASED:{value:false,...}   ->   {value:true,...}
```

…which also requires removing `team/(lawyers|doctors)` from `heldPath` in
`installHeldWorkflowNetworkBoundary`, and updating
`tests/legal-network-workspace-held.test.js`. I did none of it.

**What I did do:** made `teamView` meet the contract so it is right the day you
release it (§2), and added
`tests/team-tab-reach-under-tools.test.js` which asserts what will be true the
moment the flag flips — Tools already lists `nav_team`, the dock does **not**
grow a Team destination, and the release gate is the only suppressor. Both
directions are exercised against the shell's **real** `available()` lifted into
a VM.

---

## 1. Per-view control counts, before → after

Same instrument, same account, same viewport, b676 vs this branch. "Controls" =
visible `button / [role=button] / a[href] / input / select / textarea` inside
the view, judged by its own computed style **and** a real rect.

| view | controls before | after | words before | after |
|---|---|---|---|---|
| **calendarView** | **58** | **12** | 177 | 124 |
| **studioView** | **33** | **18** | 338 | 280 |
| **historyView** | **13** | **10** | 91 | 106 |
| **teamView** | **3** | **2** | 65 | 74 |
| analysisView | 15 | 15 | 257 | 257 |
| adminView | 10 | 10 | 259 | 263 |
| ordersView | 5 | 5 | 215 | 215 |
| recsView | 3 | 3 | 81 | 81 |
| intakeView | 126 | 126 | 978 | 978 |
| settingsModal (Account pane) | 15 | 15 | 228 | 228 |

Notes on the ones that did **not** move, because "no change" needs a reason too:

- **analysisView — deliberately reverted.** It *was* in the config with one fold
  (`#t7AxRefresh`). Measured: its disclosure had **rect 0×0** and all nine
  sample points across it belonged to `#appHeader`. `#analysisView` computes to
  `display:grid` and `feat_mls_analysis_exact.js` had replaced the card my
  anchor matched — so the fold worked and **its route back did not exist**. Of
  its 15 controls, 12 *are* the content (the report tiles). Folding one refresh
  was never worth a stranded control. Left alone until the view itself is
  rebuilt.
- **ordersView — deliberately untouched.** It hosts `#mlsReviewPanel`. The
  Review arc (b650/b666/b669/b670) is closed and its three rules are law; I
  polished around it and changed nothing inside it.
- **intakeView — out of scope by design.** 126 controls, but it is a **patient
  questionnaire on a kiosk**: the controls *are* the content. The
  button-liberation brief is about a doctor's screens.
- **adminView / recsView / teamView** were already small; only labels changed
  (§4).

---

## 2. What each screen does now, and its ≤6-step walkthrough

New module: **`feat_mls_calm_views.js` (cv-1.0.0)** — presentation only, exactly
like the Calm Shell and for the same reason. It never reimplements an action; it
finds the control the app already ships and clicks it. If the real control and
the real function are both absent, **the primary is absent**. Nothing is
deleted: every fold is class-hidden under `body.mls-cv` and revealed by a
"Show more…" disclosure **in the same view**. `?ui=classic` and
`window.__mlsCalmViews.revert()` both remove it whole.

### Calendar — *"what does my day look like / pull it"*
1. Press **Day** in the dock.
2. The one big green thing says **"Pull Sunday, Jul 26"** — the real date, and
   underneath, *"Reads that day's appointments from athenaOne. Nothing is
   written."* Press it.
3. The month grid fills in.
4. Click a day to open its panel.
5. Add an appointment inline in that panel, if you need one.
6. Everything else — date ranges, weekday-procedure views, working hours,
   duplicate removal, the second month grid — is behind **Show more calendar
   tools**.

*(Of the 58 controls before, **33 were a duplicate month grid's day cells**: the
left rail's mini-month sat beside the agenda grid showing the same month. And
the pull control only existed in the **empty-state** card, so a calendar with
appointments on it had **no way to re-pull at all** — that is the defect the
primary fixes, not just its size.)*

### History — *"show me this patient's past visits"*
1. Press **Patient**, then History.
2. With no visits, the one big thing is **"Pull chart from Athena"**.
3. With visits, that primary **stands down** — the list *is* the answer, and a
   competing hero would break "the next step is the biggest thing".
4. Type in the search box.
5. Narrow with the six filter chips (All visits / Op notes / Signed / Unsigned /
   Drafts / Chart imports).
6. New visit, follow-up scheduling, op-note drafting and chart summary are
   behind **Show more history tools**.

### AI Studio — *"ask my practice a question"*
1. Press **AI Studio** in the dock.
2. The ask box is the biggest thing (`#copilotInput`, promoted to hero size).
3. Type a question, or tap one of the example chips — those are **kept**,
   because on an empty Copilot they are what teaches a doctor what to type.
4. Press send.
5. Build a custom tool in the card beside it.
6. The eleven-chip widget gallery and the template shelf — whose fourth button
   is **"🗑 Delete ALL templates"**, a destructive act sitting on the open
   surface of a browsing screen — are behind **Show more studio tools**.

**AI Studio gets no new button, on purpose.** Its next step is to ask a
question and the control already exists. A big green button whose whole job is
to focus a text box six pixels below it would be one more button on the screen
the owner is complaining about. This is the one place "every screen gets its
`#ez3Nxt`" is met by **promotion** rather than addition.

### Team — *"what are my doctors' patients doing"* (ready for the day it ships)
1. Tools → **Team**.
2. The one big thing is **"Load your team"** (**"Refresh your team"** once a
   list exists), with *"Read-only. Every chart still belongs to the doctor who
   owns it."*
3. Pick a doctor.
4. Browse their patients, read-only.
5. Efficiency report, team-tool building and Ask Copilot are behind **Show more
   team tools**.
6. Empty state is one sentence: *"Your team's charts are not loaded yet."* — it
   used to read *"Press **Refresh** to load your team"*, an instruction that
   names a control by its label, and a label is the least stable thing on a
   screen: fold Refresh into More and the sentence points nowhere.

### Analysis / Orders / Recommendations / Admin
Unchanged by design (§1). Analysis's own walkthrough is already one step —
open it and read Key trends, which renders first.

---

## 3. Settings — the extension section, and what I found in it

**You asked me to report what is in it. It was lying, and the lie was measured,
not inferred.**

Rendered on a running page with **no extension installed**:

```
before   "Latest: v3.0.21"                     in a GREEN pill  rgb(18,122,85)
after    "Not detected here · published v3.0.21"  neutral pill  rgb(238,242,240)
```

Three separate problems, all now fixed:

1. **The static markup shipped the literal words "Latest version"** in a green
   pill. Nothing had asked the extension anything at that point, and nothing
   removed those words when the version feed was unreachable — so the sentence
   the doctor read was written months ago by a person, not derived from their
   browser.
2. **The dynamic writer beside it was half a fix.** It printed
   `Installed: v<x>` in the same green pill whenever the extension answered,
   **comparing nothing** — so an eleven-releases-old install rendered as a pass.
   And it printed `Latest: v<y>` from the feed when the extension had **not**
   answered, which reads as an install claim for a version that is merely
   published. That is the exact string measured above.
3. **The poll froze the badge on the wrong state.** It stopped on its *first*
   successful write. The feed answers in milliseconds; the extension's
   `mlsExtVersion` postMessage is re-asked at **6s**. So the frozen value was
   almost always *"no handshake"* — on a browser that was running the extension.

The badge now has four honest states, and **"up to date" requires BOTH the
handshake AND a comparison**:

| state | text | tone |
|---|---|---|
| pong, installed ≥ published | `Installed v3.0.21 · up to date` | green |
| pong, installed < published | `Installed v3.0.5 · update to v3.0.21` | amber |
| pong, versions unparseable | `Installed v<x> · published v<y>` | neutral |
| no pong | `Not detected here · published v3.0.21` | neutral |
| nothing known yet | `Checking this browser…` | neutral |

Installed version = `window.__mlsExtReportedVersion`, set **only** by the
`mlsExtVersion` handshake. Published version = `/extension-version.json`, which
`tests/extension-package.test.js` already pins equal to `feat_mls_checker.js`'s
`SERVER_EXT_VERSION`, so the badge and the checker cannot disagree.

**The section did not move.** It is still Settings → Integrations, still offers
`get-extension.html` and the direct `MLS_Assist_v3.0.21.zip`, still carries the
`chrome://extensions` → Reload instructions.

**Two honest truths I did not touch, for you:**
- There are **three** surfaces reporting the same fact from **three different
  sources**: this badge (`/extension-version.json`), the status-centre row
  `keepControlsRow` (`/api/versions`, hosted session only), and
  `feat_mls_checker`'s EXT-003 (`SERVER_EXT_VERSION`). Only the first is the one
  the owner looks at. They agree today; nothing makes them agree tomorrow.
- **Settings → Integrations is the worst pane in the app: 38 controls, 1,077
  words** — more than the other six panes' *totals*. It is the extension card
  plus the Athena API card plus the developer API key. I left it alone because
  you are actively pointing the owner at that section and I would not reshape it
  under him mid-conversation. It is the obvious next target.

**Settings grouping was already done** (`cs-2.0.0` in
`feat_athena_tooltip_dedupe.js`) and it is good: 7 rendered groups with
**Advanced** already last and already a fold.

| pane | controls | words |
|---|---|---|
| 🔐 Account & security | 15 | 228 |
| 🏥 Practice & provider | 23 | 199 |
| 📝 Notes & AI | 20 | 366 |
| 🎨 Display | 16 | 181 |
| 🧩 Features & navigation | 19 | 296 |
| 🔌 **Integrations** | **38** | **1077** |
| 🛠️ Advanced | 18 | 136 |

---

## 4. Dialog / popup / toast census

**Blocking dialogs open during normal navigation across all my views, both
viewports: 0 before, 0 after. Native `alert`/`confirm`/`prompt` fired: 0.**
(`tests/no-native-dialogs-contract` already guards that, and it passes.)

**The static census contradicted the brief's premise, and I am reporting that
rather than manufacturing changes:**

- **`mlsInfoDialog` — 1 call site in the whole product**, and it is the legal
  workspace ("What counsel still needs"). There is no epidemic of
  information-only blocking dialogs.
- **36 `mlsConfirm` call sites in ScribeFlow.html. I read every one.**
  33 are unambiguously destructive or clinical-outbound: delete appointment /
  patient / template / document / visit / widget / request, revoke key / code /
  access, remove doctor / receptionist / lawyer, disconnect Athena, clear
  browser data, bulk de-duplicate, sign-out with unsynced notes, pay, release a
  report to an attorney, book an appointment, send patient check-in email.
- The three I suspected were **wrong suspicions, and reading them was the
  point**:
  - `'Log out of MLS now?'` is already behind an **opt-in** setting
    (`getQolConfirmLogout()`, default off) and the inactivity path passes
    `force=true` so it can never block.
  - The `for (const r of rules) { await mlsConfirm(...) }` loop — which reads
    like N stacked modals — is a **fallback** that only runs if the inline
    `#teachCard` panel with checkboxes is missing. The primary path is already
    inline.
  - The 40-appointments "Heads up" confirm is genuinely destructive (importing
    100+ appointments onto one day is hard to undo). **Its message is four
    sentences and buries the action.** Left as-is: rewording a
    schedule-import guard is a truth-surface change I would rather you sign off
    on. *This is the only outstanding confirm-shape violation I found.*
- **Toasts already self-replace.** `toast()` writes one `#toast` element,
  key-guarded so a repeated message cannot restart its own lifetime. No
  stacking. `feat_save_verify`'s `sv-1.0.3` aggregated card is the pattern for
  banners and is intact.

**Fixed floating furniture, per view, per viewport (my views):**

```
1280x800   before  7 fixed/sticky  (appHeader, cx-rail, mlsDock,
                                    mlsCopVoiceBtn, mlsAsstFab, mlsDaDock,
                                    mlsKbdHint)
           after   4               (appHeader, cx-rail, mlsDock, mlsKbdHint)
390x844    before  3               (appHeader, mlsDock, mlsDaDock)
           after   2               (appHeader, mlsDock)
```

`#mlsKbdHint` ("⌨ Press ? for shortcuts") is still fixed at bottom-right on
desktop. It does not overlap the dock and it is not mine, but it is a floating
thing and law 5 says zero. **Flagging, not touching.**

---

## 5. Labelling pass

Measured, not guessed: every visible labelled control in each of my views, in
**both** the folded and revealed states, emoji stripped and case-folded.

**Three duplicate labels covering different actions — all fixed:**

| where | was | now |
|---|---|---|
| adminView | `Refresh` ×4 (users / billing / codes / backups) | `Refresh users` · `Refresh billing` · `Refresh codes` · `Refresh backups` |
| analysisView | `Refresh data` — **it loads TEAM patients** | `Refresh team data` |
| studioView | `visits per month` ×2 — an example **prompt** and a widget **template** | template is now `Visits-per-month chart` |

Re-measured after: **zero duplicates anywhere**, except calendar's three
"Refresh" controls — and those are exempt because all three call the *identical*
`window.loadCalendar()`. The law bars duplicate labels for **different**
actions. (Three copies of the same button on one screen is still redundancy;
two of the three are now folded.)

`tests/fixtures/ui-control-manifest.json` regenerated for the five renamed
labels (`node tools/ui-control-inventory.js`).

**Also fixed, a text-budget defect:** AI Studio rendered *"AI Studio / Ask
Copilot, build a custom tool, or run a study — everything for exploring your
practice, in one place."* **twice**, stacked, before any content. Thirty-eight
words, said twice, where the budget is three. It is the losing half of the race
the `stp v1.0.1` note in `mls-connect.js` already documents: that fix stopped a
second header being appended *when sx's title already existed*, and does nothing
in the other order.

---

## 6. Motion

`.mls-cv-primary` / `.mls-cv-more` consume the shell's shared vocabulary
(`--mls-dur-*`, `--mls-ease-*` from `feat_mls_calm_shell.js`'s
`mls-motion-system`) — no curve invented here. **Transform and opacity only**
(plus `background`, a paint, matching the shell's own control-hover rule).
`prefers-reduced-motion: reduce` turns it off. Verified by
`tests/motion-system-costs-no-layout`, still green.

---

## 7. Commits (6, local only, `worker-e-views`)

```
37ba1d5  calendar: on a phone the primary was below the fold
033ac39  Team under Tools, honest labels, and the shell's motion vocabulary
8e89e57  AI Studio said its own name twice, and the fold latch could not un-latch
0013a36  the dock owns its own buttons again: retired pills and an invisible toast
08cb2b2  calm views: one primary per screen on Calendar, History and AI Studio
05cccf6  settings: the extension badge stops claiming currency it never checked
```

Files touched: `feat_mls_calm_views.js` (new), `mls-connect.js`,
`ScribeFlow.html`, `tests/*` (3 new, 3 updated), `tests/run-all.js`,
`tests/fixtures/ui-control-manifest.json`.
**Not touched:** `visitView`, `patientsView`, theme tokens, `background.js`, the
dock's own markup or behaviour.

---

## 8. Pins updated, each with its reason

| pin | change | why |
|---|---|---|
| `tests/boot-script-budget.test.js` `CEILING` | 235 → **236** | one new module. It is **deferred** (`requestIdleCallback`, 4s timeout) so `EAGER_CEILING` stays **234** and it is not in the post-login burst the ceiling guards; it **removes** interface (calendar 58→12, studio 33→18); and it is separately revertible on purpose — the shell owns cross-screen navigation and must never have to be reverted to undo a per-view layout opinion. Its mount retry is a **timeout chain, not an interval**, so the 214-interval pin does not move either. |
| `tests/voice-pill-persistence-runtime.test.js` | last 2 assertions **inverted** | they pinned the ft-1.1.3 desktop force-show of the three retired pills. See §0.1. The file now carries both owner orders, the CSS-precedence explanation and the click measurements, so the next reader can see why an explicit order was deleted. Its first half (a legacy preference may not erase another owner's display) is unchanged and still passes. |
| `tests/fixtures/ui-control-manifest.json` | regenerated | five deliberate label renames (§5). |

**Three new gates, all registered in `run-all.js`, all proven in BOTH
directions before being trusted** (the rule the b669 clearance gate earned —
prove it fails on the real regression *and* passes on the real tree):

1. **`extension-badge-never-claims-currency.test.js`** — fails on the restored
   static "Latest version" pill, on an uncompared verdict, and on the
   first-write poll.
2. **`calm-views-folds-keep-reach.test.js`** — fails on a removed disclosure, a
   dropped `!important`, a deleted visibility invariant, a one-way invariant,
   and a fold reaching outside its own view.
3. **`team-tab-reach-under-tools.test.js`** — fails on the Tools entry being
   removed, Team being added to the **dock**, the release hold being made
   mutable, and `available()` no longer reading inline display.

---

## 9. Where my own instruments lied — all five, because each nearly shipped

1. **The fold rule with no `!important` did nothing.** `#cpRow` is built with
   inline `display:flex`, which beats any stylesheet rule at any specificity.
   Calendar read **25** controls with the fold "applied" and the module
   reporting itself installed.
2. **The disclosure that existed but had rect 0×0** (analysis). Every
   existence check passed; the folded control had no route at all. This is now
   a **runtime invariant** in the shipped module: a fold whose disclosure is not
   *visible* unfolds itself and warns.
3. **…and that invariant was one-way.** A disclosure briefly unrendered at
   390px latched AI Studio permanently open — 33 controls where the fold
   measures 18. It now withdraws its own auto-open, and distinguishes it from
   an open the doctor asked for.
4. **The census stacked five views on one page.** It forced each measured view
   visible and never put it back — a state the app never has — and that stack
   is what tripped (3). It reported studio at 33 with the fold working
   perfectly. Fixed: each view is restored before the next.
5. **The fold-reach probe re-used a stale click coordinate.** Revealing a fold
   reflows the page, so the second click landed on whatever had moved under the
   old point, and it reported calendar `re-hidden=60`. It now re-measures before
   **every** click and asserts `elementFromPoint` each time. With that fixed:
   calendar 12→60→12, history 10→15→10, studio 22→37→22, all by **real trusted
   mouse clicks**.

And one more, from the opposite direction: **my floating-furniture census
filtered out `opacity:0`**, which is exactly how it missed the invisible toast
that was eating dock clicks (§0.1). Hit-testing does not care about opacity.

---

## 10. Open risks / what I did not do

- **Live verification of the dock reclaim** — §0.1. Local demo account only.
- **The Team release decision** — §0.2. One flag, plus the network boundary,
  plus a pinning suite. Yours.
- **Settings → Integrations, 38 controls / 1,077 words** — the worst pane left.
  Untouched deliberately while you are pointing the owner at it.
- **The 40-appointment import confirm** buries its action under four sentences
  (§4). The only confirm-shape violation I found.
- **`#mlsKbdHint`** is still fixed-position furniture on desktop (§4).
- **On a phone, three things still sit above the calendar's primary** — the
  active-patient card, a toast, and the `#mlsT3Status` error banner. All shared
  chrome owned by other lanes. My primary is now the first thing *inside* the
  calendar.
- **`#mlsT3Status` shows "Reading provider schedule failed – HTTP 404"** on
  every demo boot. Honest in a backend-less harness, but it is a red banner
  above the primary; worth checking it is not also firing on real accounts.
- **analysisView, adminView, recsView, ordersView, intakeView** are unchanged,
  each for a stated reason (§1).
- **The E2E suite still is not in `run-all.js`.** Unchanged from the handoff; I
  used its serving/launch pattern but did not add steps to it.

---

## 11. Screenshots

Every view, before and after, at **1280×800 and 390×844**, plus both census
JSONs (raw per-control lists):

```
C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\worker-e-shots-20260726\
  before__<view>__1280x800.png   after__<view>__1280x800.png
  before__<view>__390x844.png    after__<view>__390x844.png
  before__census.json            after__census.json
```

views: `calendarView`, `ordersView`, `historyView`, `analysisView`,
`studioView`, `teamView`, `adminView`, `recsView`, `intakeView`,
`settingsModal`.

The single most useful pair: `before__calendarView__1280x800.png` (58 controls,
two month grids, a nine-button planning strip) beside
`after__calendarView__1280x800.png` (one green "Pull Sunday, Jul 26", one "Show
more calendar tools", the grid).

Probes are in the session scratchpad and are reusable:
`census.js` (per-view control/word census + settings panes + badge state),
`probe-fold-reach.js` (real trusted clicks, both directions),
`probe-dock-steal.js` (nine-point `elementFromPoint` per dock button),
`probe-pill-css.js` (walks `document.styleSheets`, reads
`getPropertyPriority` — the one that found §0.1),
`probe-floating.js`, `probe-labels.js`, `probe-cal.js`, `probe-studio.js`,
`probe-ana.js`.

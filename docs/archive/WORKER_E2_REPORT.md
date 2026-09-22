# WORKER E2 — AI Studio absorbs Analysis

Branch `worker-e2-studio`, based on `origin/main` @ `8ff5200` (b682).
**Four local commits. Nothing pushed.** `node tests/run-all.js` — **348 suites
green** (347 at base + 1 new gate).

Owner's order, verbatim: **"add the analysis tab to the ai studio tab smartly"**.

Everything below was measured on a **running page**: local static server,
`ScribeFlow.html?demo=1`, real Chrome via `puppeteer-core` installed **outside
the repo**, throwaway profile, at 1280×800 and 390×844, in **both themes**.

---

## 1. What AI Studio is now

One destination, three sections, one visible at a time, each with one primary:

| section | what it answers | its primary |
|---|---|---|
| **Ask** | "ask my practice a question" | `#copilotInput`, **promoted** to hero size — not a new button |
| **Practice** | "how is my practice doing" | the tiles are the answer; `Refresh data` is the only action |
| **Build** | "make me a tool / run a study" | `✨ Build it` |

A segmented **Ask · Practice · Build** control sits directly under the page
title, with a one-line hint for the selected section. `role="tablist"`, arrow
/ Home / End keys, `aria-selected`, visible focus ring.

**Measured, visible controls, same instrument, b682 vs this branch:**

| | before | after |
|---|---|---|
| AI Studio (whole page) | **18** | Ask **13** |
| Analysis (whole page) | **15** | Practice **19** |
| — | | Build **12** |
| **destinations in the dock/rail** | **2** | **1** |

Practice reads 19 rather than 15 because the merged surface carries the page
title and the switcher on every section — the honest number, not a better one.
What actually changed is that **33 controls across two tabs became at most 19
on screen at once**, and one of the two destinations is gone.

### Why a switcher and not a longer page

Stacking Analysis under AI Studio would have been two pages stapled: 33
controls on one scroll and three primaries competing, which breaks law 3 by
construction ("if two actions compete, the screen is wrong"). Three sections,
one at a time, is the merge that survives the one-minute test.

---

## 2. The ≤6-step walkthrough for every state

### Ask (the default)
1. Press **AI Studio** in the dock.
2. The switcher says **Ask** — the biggest thing under it is the ask box.
3. Type a question, or tap one of the example chips (kept: on an empty Copilot
   they are what teaches a doctor what to type).
4. Press send.
5. Read the answer; Copilot can open a chart or start a visit from it.
6. **↺ New chat** clears the thread.

### Practice
1. Press **AI Studio**, then **Practice** — or press Practice in Tools, or ask
   for "analysis" anywhere; every route lands here.
2. **Practice trends** and the live tiles are on screen: Key trends, Baseline
   metrics, Outcomes, ratings, Procedure report, RVU, Days worked, Doctor
   review, Ask your data, Referral outcomes, Outcomes registry, Research
   registry.
3. **Whose data am I looking at?** — Whole practice or One provider.
4. Tap any tile to expand it in place.
5. **↻ Refresh data** when the stamp beside it looks stale.
6. Drag a tile to reorder; the layout is remembered.

### Build
1. Press **AI Studio**, then **Build**.
2. Describe the tool you want in the box.
3. Press **✨ Build it** — the one big action.
4. Refine it in place, or **💾 Save it**.
5. **Show starter tools** reveals the eleven-chip starter gallery (folded by
   default; its route is one click away in the same section).
6. **Study Groups** for a cohort + paper is the row above.

### The route in from anywhere
1. Anything that used to open Analysis — the rail tab, the command palette,
   the Copilot's action router, voice, a custom tool's `navigate` action,
   mls-connect's own Tools row — still calls `showView('analysis')`.
2. It lands on AI Studio with **Practice** selected, and the dock lights **AI
   Studio**.

---

## 3. Architecture — and the defect it nearly shipped with

Both views were **already owned** and neither could be fought:

- **sx-2.4.0-prod** (`feat_mls_studio_exact.js`) makes `#studioView` a
  two-column CSS grid and places its children by `grid-column`/`grid-row`
  (measured: title `1/-1`,1 · Study Groups `1/-1`,3 · copilot `1`,4 · build
  `2`,4 · pay `2`,5 · result `1/-1`,6). Every section member is therefore a
  **direct child**; re-parenting any of them into a section `<div>` would
  strip its placement and collapse the layout. **Nothing is re-parented except
  `#analysisView` itself.**
- **ax-3.0.0** (`feat_mls_analysis_exact.js`) makes `#analysisView` a
  draggable 12-tile grid and wraps every `.card` in it on its own
  MutationObserver. Moving the *cards* out would fight it forever. Moving the
  **whole element** does not, because every ax selector is id-anchored. That
  is the trick this rests on.

Visibility is by class and every section rule is `!important` **on purpose**:
sx declares `display:flex!important`, ax declares `display:grid!important`.
Specificity was worked out against theirs rather than guessed —
`body.mls-sm:not(.mls-sm-ask) #studioView #copilotCard` (2,2,1) beats
`#studioView.sx-grid #copilotCard` (2,1,0).

### The defect

`ax`'s `render()` begins:

```js
if (v.style.display === "none") { v.classList.remove(GRID_CLASS); return; }
```

It reads the **inline** display. `showView` writes `display:none` on
`#analysisView` for every route that is not `'analysis'` — and after this
merge, **that is every route**. So ax refused to build: measured on the running
page, `#analysisView` had `class=""`, **0 tiles**, and Practice was rendering
the raw stacked cards.

**And it looked fine.** The `:not(.ax-grid)` fallback rule I had written as a
safety net gave those cards a display, so the section was not blank and nothing
threw. *A fallback that hides the failure it was written for is the most
expensive kind.* The module now owns that inline value. Measured after:
`class="ax-grid"`, **12 tiles, 4 columns**, both themes.

---

## 4. Routing and the pins moved

| what | before | after | why |
|---|---|---|---|
| `PRIMARY_NAV` | 5 lead routes incl. `nav_analysis` label `Practice` | **4**; nav_analysis removed | a rail tab "Practice" beside "Tools", both landing on one screen, is two routes to one place |
| `FOLDED_NAV` | `['nav_history']` | `['nav_history','nav_analysis']` | folded, marked `data-mlsrd-folded`, still routable — never dropped |
| `DEST_TABS` | `tools:[…'nav_analysis'…]` | `studio:['nav_studio','nav_analysis']` | a route into Practice must light **AI Studio**; lighting Tools was the dock telling the doctor they are somewhere they are not. `currentDest()` is last-match-wins, so it appears in exactly one key |
| Tools menu | `{ id:'nav_analysis' }` | `{ id:'nav_analysis', as:'Practice trends (AI Studio)' }` | kept — removing it would silently delete a route the coverage suite knows about — and now says where it goes |

**The redirect is ONE wrapper on `showView`, not fifteen edited call sites.**
Six places navigate to Analysis (rail tab, command palette,
`feat_mls_copilot_actions`, `feat_mls_copilot_voice_v2`, a custom tool's
`navigate` action, mls-connect's Tools row) and every one passes the string
`'analysis'`. Editing them individually is how a merge loses a feature.

### Pins updated, each with the owner's order quoted in the file

| pin | change | reason |
|---|---|---|
| `tests/clinician-navigation-contract.test.js` | 5 lead routes → **4**; `FOLDED_NAV` regex updated; runtime arm now also asserts `nav_analysis` carries `data-mlsrd-folded` | the fold must stay inspectable rather than become a silent drop |
| `tests/boot-script-budget.test.js` `CEILING` | 238 → **239** | one new module, **deferred** (`requestIdleCallback`, 4s), so `EAGER_CEILING` stays **234**; it removes a destination; and it must be revertible on its own — it re-parents a view and wraps `showView` |

### New gate — proven in BOTH directions

`tests/studio-merge-keeps-every-route.test.js`, registered in `run-all.js`.
Observed to **fail** on each of: a deleted `showView` wrapper · a redirect to
the wrong view · a missing Practice section · a removed Tools entry ·
`nav_analysis` moved back under the tools destination · a section hide rule
that drops `!important`. Passes on the real tree.

It also asserts the ax inline-display dependency explicitly, so if anyone
"simplifies" `syncAnalysisInline` away, the tile grid cannot silently stop
building again.

**That last check had to be strengthened while proving it.** v1 required a
single `display:none!important` *anywhere* in the file, so weakening one rule
out of several passed. v2 then flagged the media-query rule that hides the
switcher's text hint on a phone — a rule that competes with nothing and
correctly has no `!important`. It is now scoped to the section rules only. *A
gate that cries wolf on healthy code trains the next person to delete it.*

---

## 5. Both themes

WCAG AA text failures inside `#studioView`, per section, measured on the
running page:

| | before (b682) | after |
|---|---|---|
| **light** | studio **4** · analysis **1** | Ask **0** · Practice **0** · Build **0** |
| **dark** | 0 · 0 | 0 · 0 · 0 |
| opaque light panels under dark | 0 | **0** |

Dark already passed because Worker F's parity engine rewrites these families at
runtime. **Light has no such engine**, so the literals stood. Six replaced with
tokens — no new literals anywhere in this lane:

```
#79837C  #copilotHero .sub 3.92:1 · #copilotMicBtn 3.92:1 · the
         "Ask your data, or build a tool" strip 3.76:1   -> var(--muted)
#79837C  --stp-mini, which reaches every .mini in AI Studio including the
         "Nothing saved yet" empty state 3.82:1          -> var(--muted)
#8b9bb0  #t7AxStamp "data as of …"        2.71:1         -> var(--muted)
#7d8ba1  Study Groups' "— advanced: …"    3.45:1         -> var(--muted)
#fbfcfe  that empty state's panel                        -> var(--card)
#1A211C / #E7E5DD  --stp-ink / --stp-line   -> var(--ink) / var(--line)
```

`tests/dark-theme-reaches-every-panel.test.js` already asserts the parity
engine maps `#79837C` → `var(--muted)`; this makes the **source** agree with it
instead of depending on a runtime correction that only runs in one theme.

**Radii** use `--r-pill` / `--r-ctl`. **Motion** uses the shell's shared
vocabulary (`--mls-dur-1/2`, `--mls-ease-out/inout`) — no curve invented here,
transform and opacity only, and `prefers-reduced-motion: reduce` turns it off.

---

## 6. Every Analysis feature survives, with a route

All twelve tiles are present and interactive in the merged Practice section
(measured: `.ax-tile` count **12**, `grid-template-columns` **4**, drag and
resize handlers intact because the cards were never touched):

Key trends · Baseline metrics · Outcomes & marketing · Patient-experience
ratings · Procedure Report · RVU Productivity · Days worked & volume · Doctor
analysis & review · Ask your data · Referral outcomes · Outcomes registry ·
Research registry.

The doctors/team data paths are untouched — `loadTeamPatients`,
`renderAnalysisSummary`, `generateDoctorAnalysis`, `renderTeamGrades` are
called through the app's own functions, never reimplemented. `refreshPractice()`
calls the loaders that `showView('analysis')` used to run, since that path is
now a redirect.

**The invariant carried over from the calm-views lane:** a fold whose route
back cannot be *seen* is a deleted feature. If the switcher ever fails to
render, every section is shown and a console warning names why — rather than
leaving two of three sections unreachable.

---

## 7. Commits (4, local only, `worker-e2-studio`)

```
1c6eeef  theme: the five colour literals left on the merged surface become tokens
1e52210  routing: Analysis is folded out of the rail and lights AI Studio
f28c771  AI Studio absorbs Analysis: Ask / Practice / Build, one surface
(+ this report)
```

Files: `feat_mls_studio_merge.js` (new), `feat_mls_calm_views.js`,
`feat_mls_calm_shell.js`, `feat_mls_redesign.js`, `feat_mls_studio_exact.js`,
`feat_mls_task7_analysis_sg.js`, `mls-connect.js`, `tests/*` (1 new, 2 pins),
`tests/run-all.js`.
**Not touched:** visitView, patientsView, the dock's markup or behaviour,
`background.js`, `feat_mls_analysis_exact.js`, `feat_mls_studio_exact.js`'s
layout logic.

---

## 8. Where the instruments lied — all three, because each changed a number

1. **The first DOM probe dumped `#studioView` while it was `display:none`**,
   reported `class=""` and every child at `0×0` with `grid-column:auto`, and I
   nearly concluded sx's grid was not applying at all. sx renders on view open.
   *Open the view before measuring it.*
2. **The contrast walker treated a gradient as a colour.**
   `getComputedStyle().backgroundColor` is `rgba(0,0,0,0)` on a gradient-only
   element, so it climbed to the white card behind and reported white-on-white
   for `#copilotOrb`, `#copilotSendBtn` and `#studioGenBtn` — three controls
   whose text is white on a dark green gradient and passes comfortably. **Five
   of the first ten "failures" were mine.** Both the before and after figures
   in §5 are from the corrected instrument.
3. **The census left every measured view forced visible**, which is a state the
   app never has. Carried over from the previous lane and fixed there; the
   section-aware version drives the merge through `__mlsStudioMerge.select()`,
   the same call the tab makes.

---

## 9. Open risks / what needs the lead

- **Live verification on the owner's signed-in tab.** My proof is a local demo
  account with no extension and no backend. Worth pressing: AI Studio → each
  section, then a route in from the command palette and from Copilot ("show me
  my analysis").
- **`.uc1-pay-wrap` (the Pay Reports upsell) is section-neutral** and renders
  in all three sections at `grid-column:2, grid-row:5`. It is a revenue
  surface, so I left it alone rather than fold it — but it is the one thing on
  the merged page that is not practice intelligence. Lead's call.
- **`#analysisView` still exists as an element** (now a child of
  `#studioView`). `showView` still writes its display, which is why
  `syncAnalysisInline` exists. A later cleanup could remove the `analysis`
  branch from `showView` entirely — but not without also updating every caller,
  which is exactly what the redirect avoids today.
- **`nav_studio` still reads "Tools"** in the rail and the dock. With Analysis
  merged in, "AI Studio" now covers Ask + Practice + Build; whether the dock
  item should say "Practice" or "Studio" is an owner-facing naming decision I
  did not take.
- **Study Groups sits in Build.** It builds a cohort and then runs a study, so
  it is closer to Build than to Practice — but it is arguable, and it is a
  one-line change to `SECTIONS` if the owner reads it the other way.

---

## 10. Screenshots

Every section, both themes, both viewports, plus both census JSONs:

```
C:\Users\Micha\Desktop\MLS_EVERYTHING\dispatch-work\worker-e2-shots\
  before__studio__{light,dark}__{1280x800,390x844}.png
  before__analysis__{light,dark}__{1280x800,390x844}.png
  after__{ask,practice,build}__{light,dark}__{1280x800,390x844}.png
  before__studio-census.json   after__studio-census.json
```

The pair that tells the story: `before__analysis__light__1280x800.png` (its own
tab, its own page title) beside `after__practice__light__1280x800.png` (the
same tiles, under **AI Studio**, one tab-press from Ask and Build).

Probes, reusable, in the session scratchpad: `studio-census.js` (section-aware
control/word/theme census), `probe-merge.js` (drives every section with real
trusted clicks and dumps the state at each step), `probe-contrast.js`
(gradient-aware AA audit), `probe-studio-dom.js` (the direct-children map the
section plan was derived from).

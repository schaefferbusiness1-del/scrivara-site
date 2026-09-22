# WORKER H — the lead's five b685 walkthrough findings

Branch `worker-h-polish`, five commits, rebased onto `origin/main` at **c202ad9 (b688)**.
Local commits only; the lead ships.

```
gate      349 local regression suites green    (full node tests/run-all.js)
syntax    node --check after every JS edit
browser   real Chrome, headless, THROWAWAY user-data dir, ?demo=1, local static
          server. The owner's Chrome was never touched.
verified  1280x850 light AND 390x844 dark, every finding, before and after
errors    0 page errors in every run
```

Every claim below is a measurement from a running page. Where a number is not
measured it says so.

---

## The five findings

| # | finding | root cause | state |
|---|---|---|---|
| 1 | patientsView top strip duplicates three actions | `ACTIONS.patient` in the calm shell re-offered controls the screen already shows | fixed |
| 2 | calendar header repeats the year | `subtitleText()` prefixed the year the title already carries — in **all three** modes | fixed |
| 3 | title reads "MLS Scribe" on Review | `syncTitle()` queries `#mlsRdNav .navtab.on`; `#nav_orders` is not in the rail | fixed |
| 4 | Review panel repeats the patient banner | the panel derived and rendered its own `.rvp-who` chip | fixed |
| 5 | Tools menu is 18 flat rows, Log out mid-list | one flat `TOOLS_SOURCES` rendered in declaration order | fixed |

---

## 1. patients: the top strip stops re-offering what is already on screen

`1fc0530`, `feat_mls_calm_shell.js`

Measured at b685, 1280x850, signed in with a patient open. Every action on the
strip had a bigger twin underneath it:

```
#mlsRightNow                      1216x59, three buttons
  "Start visit"                    100x37   vs  #profileCard hero  688x62
  "New patient"                    115x37   vs  #ptNewBtn          128x37
  "Pull from Athena · READ-ONLY"   244x37   vs  #ptPullAthenaBtn   250x42
```

Two laws broken at once: one offer per action per screen (law 4), and a 100x37
"Start visit" competing with the 688x62 hero, so the biggest thing on screen
was no longer unambiguously the next step (law 3).

`ACTIONS.patient` is now an empty list. **Nothing is hidden and nothing needs a
route back** — the keepers are the app's own controls, in place, at full size.
The key is kept rather than deleted so the destination can still render its
segmented Patients/History row, which is navigation, not a duplicated action.

Verified in both patient states:

```
profile open   strip 0x0 display:none via .empty  (CLASS, inline style "")
               hero 688x62 · #ptNewBtn 128x37 · #ptPullAthenaBtn 250x42
no patient     strip 0x0
               #ptNewBtn 128x37 · #ptPullAthenaBtn 250x42
```

The hero also rises 73px (top 453 -> 380) now that the strip is not above it.
Positive control: the same bar still renders its segmented row on Review, so
this is the patient screen changing, not the bar dying everywhere.

## 2. calendar: the year is stated once

`c70d83b`, `feat_mls_calendar_exact.js`

**It was not only the month view.** `#calMonthLabel` carries the year in every
mode, and `subtitleText()` prefixed it again in all three:

```
month  "July 2026"                     was "2026 · 621 appointments this month"
day    "Sunday, July 26, 2026"         was "2026 · 3 appointments scheduled"
week   "Week of Jul 26 – Aug 1, 2026"  was "2026 · whole-practice schedule"
```

Verified with 9 seeded appointments so the count is a real number, not a
trivial 0, and after cycling month -> day -> week -> month:

```
month  "July 2026"                     "9 appointments this month"
day    "Thursday, July 9, 2026"        "1 appointment scheduled"   (singular)
week   "Week of Jul 5 – Jul 11, 2026"  "Whole-practice schedule"
titleHasYear true / subHasYear false in all three
```

## 3. title: the top-left names the destination, on every one of them

`9ed250c`, `feat_mls_calm_shell.js` + `feat_mls_redesign.js`

**Root cause, measured, not guessed.** `syncTitle()` reads
`#mlsRdNav .navtab.on` — scoped to the rail — and `#nav_orders` is not in the
rail. A module relocated it:

```
#nav_orders.navtab.nav-feat-off < #mlsTbMenuPanel < #mlsTbMenu
  < #mlsRdMenuSlot < #mlsRdTop < #appHeader
```

The tab carries `.on`; the rail query returns **zero rows**; the title falls
through to its `'MLS Scribe'` default. So this was never a Review bug — it is
every destination whose tab has been moved out of the rail, and it fails by
rendering the product name, which looks deliberate.

The calm shell now exports `activeDestLabel()` as `__mlsCalmShell.destLabel`,
and `syncTitle` prefers it:

1. the dock's active destination — but **only** where that destination owns the
   tab that is on (its landing target, the tab `go()` clicks). Destinations
   cover several tabs, so borrowing the name unconditionally would have put
   "Patient" over the History list.
2. the rail's own `.on` tab (views reached **past** a destination)
3. any `.on` tab, wherever relocated (classic layout, which has no dock)
4. the product name, only when nothing at all is marked active

`destLabel()` computes from the DOM on every call rather than reading the
dock's rendered `.on` class: the title updates on `showView` (setTimeout 0) and
`syncDock` runs a rAF later, so a title reading the painted dock would be one
screen behind on every navigation.

```
Day "Day" · Patient "Patient" · Visit "Visit" · Review "Review"
AI Studio "AI Studio"   (was "Tools", which collided with the Tools dock item)

views reached PAST a destination keep their own name — the regression this
could most easily have caused:
  nav_history   "History"          (dock=patient)
  nav_recs      "Recommendations"  (dock=review)
  nav_analysis  "AI Studio"        (b686 lands it on the merged studio surface)

fallback arm, calm shell torn down via revert() the way Classic layout does it:
  Orders "Orders" · Patients "Patients"     (classic used to say "MLS Scribe" too)
```

The brand mark survived all 9 navigations.

## 4. review: the panel stops repeating the banner

`f7ef83e`, `mls-connect.js`

```
#mlsCtxBar  1180x123 at y=82   "AL Ada Lovelace ... DOB 05/08/1970 · MRN WH-1 ..."
.rvp-who     296x32  at y=376  "Ada Lovelace · DOB 05/08/1970 · MRN WH-1"
```

Two surfaces, one fact, 294px apart. The banner is the single owner of patient
context — persistent, above every view, and it carries the switcher. Removed at
the root (collector, markup, and the CSS rule that styled it), not hidden:
there is nothing to keep reachable when the same fact is on screen in a bigger,
permanent surface.

**What deliberately stays: the no-patient GAP.** "No patient is bound to this
visit" is a review finding about what would leave, not a restatement of who is
on screen, and it is the only place that fact is stated as a problem.

```
patient bound   .rvp-who 0 · panel 259px -> 202px · first section "Needs your
                attention" · 1 gap · 0 controls
no patient      .rvp-who 0 · 2 gaps INCLUDING the no-patient one · 0 controls
```

`tests/review-panel-is-a-review.test.js` needed no change: no controls, reads
the send path's own plan, gaps above the list, signature guard — all four still
hold, and gaps are now literally first.

Patched with a script asserting exactly one match per anchor, whose self-check
scans **code, not prose** — the replacement comment quotes the old selector on
purpose, and a raw substring check would fail on a correct tree and fail louder
the better the change is documented. That trap is already written down in the
suite above.

## 5. tools: four sections, and Log out stops sitting mid-menu

`95d68b7`, `feat_mls_calm_shell.js`

At b685 the menu was 224x718 of clipped, scrolling column, 17 routes in
declaration order, with **"Log out" at position 10** — between "Settings" and
"Schedule". The one row that ends the session, in the middle of the practice
tools, one slip of the finger from a doctor reaching for Schedule mid-clinic.

```
During a visit  Dictate · Copilot Voice · MLS Assistant · Draft op note · Snapshot
Practice        Schedule · Pre-visit intake forms · Templates · Custom widget ·
                Ask your data · Pull activity · AI Studio · Practice trends ·
                Team · Staff pull · Legal requests
Data            Verify saved data · Share / Export · Export everything for EMR ·
                Full visit notes · Copy every visit from athenaOne · Add a visit
App             Settings · Admin · Help · Classic layout  |  Log out
```

Log out is last, behind a rule, and the rule only draws when there is something
above it. `last: true` on its spec pins it there wherever the app offers it.

Two labels changed, both because the old one named a place rather than a thing:
`"Where pulls run" -> "Pull activity"` (the assignment's rename), and
`"Tools · PREMIUM" -> "AI Studio"` — `nav_studio` derived its label from the
rail tab, so the Tools menu carried a row called Tools that went somewhere
else: two controls sharing a label for different actions, which the labeling
law forbids.

**Grouping moves rows. It never drops one.** Proven with a control run — same
probe, same harness, change stashed vs applied:

```
rows                                                17 -> 17
controls the rows actually fire, by set difference:
  only in control run: []      only in my run: []
```

That wiring check is the one that mattered. The click handler reads `data-i`
into a flat array, so a grouping that renumbered rows would have had the doctor
press one thing and run another, silently. `openTools` now resolves the DOM
**once** and builds both the sections and the flat array from that single pass,
so the two cannot disagree.

Also in this commit, because both are properties of this menu:

- `#mlsToolsMenu` was missing from the `prefers-reduced-motion` block. Two
  surfaces in this stylesheet animate with `mlsPop` and only `#mlsAskResults`
  was named, so the menu kept springing open for a doctor who asked the OS for
  less motion. Measured under emulation: **300ms -> 0.001s**, `#mlsAskResults`
  still 0.001s. The entrance already runs on the F tokens — b687 aliased
  `--mls-base`/`--mls-spring` onto `--mls-dur-3`/`--mls-ease-out` — so nothing
  there needed churning.
- the section caption uses `var(--muted)`, not a literal. A hand-picked
  `#79837C` measured **3.93:1** on this menu's background, under AA for 10.5px
  text; the token clears it.

```
contrast, computed off the real elements
  caption      5.31:1 light   6.50:1 dark
  rows        14.33:1 light  13.16:1 dark
  Classic row  4.94:1 light   6.50:1 dark      all AA
accessibility
  role="group" + aria-label per section; captions carry no role and no
  tabindex (0 operable); every row keeps role="menuitem" tabindex="0";
  first row still takes focus on open; Escape still closes
geometry
  1280x850  224x718 top 35, not clipped
   390x844  224x712 top 52, not clipped
```

---

## Consolidated verification, final tree, both configurations

```
                              1280x850 light          390x844 dark
witness (dock changes view)   true                    true
F1 strip                      0x0, .empty, inline ""  0x0, .empty, inline ""
   hero / ptNewBtn / ptPull   688x62 / 128x37 / 250x42  255x62 / 128x44 / 250x42
F2 title / sub                "July 2026" / "0 appointments this month" (both)
   titleHasYear/subHasYear    true / false            true / false
F3 titles                     Day·Patient·Visit·Review·AI Studio (both)
F4 .rvp-who count             0                       0
   first section              "Needs your attention"  "Needs your attention"
   panel controls             0                       0
   banner                     1180x123                359x354
   panel                      1216x202                351x275 (no h-overflow)
F5 menu                       224x718 top 35          224x712 top 52
   clipped                    false                   false
   rows                       18                      16 (2 app-gated at 390)
   Log out last + separated   true                    true
page errors                   0                       0
```

---

## Discipline notes

- **Hide by class only.** The one thing that disappears (`#mlsRightNow` on the
  patient screen) does so through its existing `.empty` class; its inline
  `style` attribute is `""` in every measurement. Nothing new floats.
- **No pin was relaxed.** No test needed editing. Two exact-shape literals that
  other suites pin — `{ id: 'nav_team' }` and
  `{ id: 'nav_analysis', as: '...' }` — were carried into the grouped structure
  byte-for-byte, and `TOOLS_SOURCES` still exists as the flattened view the
  reach and hidden-controls suites read.
- **Main moved three times** during this work (b685 -> b686 -> b687 -> b688).
  Rebased each time before gating; the final gate ran on c202ad9.
- **One correction made mid-work, recorded here because the discipline is the
  point.** I first named `#mlsRdNewMenu` in the reduced-motion rule from memory.
  Walking `document.styleSheets` showed the only other `mlsPop` user in this
  stylesheet is `#mlsAskResults`, which was already covered. The comment and
  the selector were corrected before commit.

## Observed, not fixed (out of scope, flagged for the lead)

- `#mlsToolsMenu` needs to scroll at 1280x850 even after grouping (content 801px
  against a 718px clamp). The clamp predates this work and the menu was already
  scrolling with the flat list; four captions and three hairlines add to it.
  Worth a look if the lead wants the whole menu visible without scrolling.
- The Tools menu's dark styling comes from `mlsThemeParity`, whose selectors
  reached my brand-new `.gh` class automatically. Convenient here; worth
  understanding before someone relies on it.

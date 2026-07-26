# WORKER F — theme layer report, 2026-07-26

**Lane:** F (theme layer only). **Deliverable:** local commits + this report. **Never pushed.**
Base: `origin/main` @ `4c340c0` (b677, rebased once from b676). Branch: **`worker-f-theme`**,
worktree `dispatch-work/worker-f-theme-20260726`.

Gate: **342/342 green** at the tip (336 → 342; six suites added by A and me).

---

## 0. HOW THIS WAS MEASURED

My own Chrome, never the owner's: `tests/e2e/run-e2e.js`'s route — local static server →
`ScribeFlow.html?demo=1` → on-device demo signup → probe — in headless Chrome with a throwaway
`userDataDir` under the OS temp, deleted on exit. 1440×900, ten views, Worker A's settle recipe
(`showView(short)` → 700ms → `getAnimations().forEach(a=>a.finish())` → 150ms).

Contrast uses Worker A's ancestor-walking method with their instrument-fault #4 fixed: the walk
**stops and leaves the sample UNSCORED** the moment it meets a `background-image`, and unscored
samples are counted separately so they can never be mistaken for passes (20–21 per run).

**My instrument is stricter than Worker A's and the numbers differ. Both are right.** A counts
98 panels / 89 dark failures; I count 170 / 163 on the same build. I score every element with its
own text node across ten views including `intake`, and my panel threshold is relative luminance
≥ 0.55 rather than near-white. Before/after within one instrument is the claim; the absolute
number is not comparable across the two reports.

**Four instrument faults of my own, recorded because two nearly became findings:**

| # | Looked like | Actually was |
|---|---|---|
| 1 | *"the app 403s every asset"* | my server's traversal guard compared a **forward-slash** ROOT against `path.join`'s backslashes, so `file.startsWith(ROOT)` was false for every file. Surfaced three calls later as a `localStorage` SecurityError. |
| 2 | *"the parity script does not run"* | it did not exist. My insertion anchor's tail was the **opening line of an HTML comment**, so the `<script>` landed inside the comment. It parsed, the diff looked right, the gate was green, and the running page had no such element. |
| 3 | *"the toast transition did not take"* | `html.mls-secure-loading body > :not(#sfGateLoading){transition:none!important}` — the boot gate. Removing the class showed the correct `opacity .2s / transform .3s`. |
| 4 | *"`--brand-dk` resolves to the light value"* | my own `varMap` preferred a stylesheet declaration over the live computed value and disagreed with the real cascade. The live lookup is the truth. |

Probes: `harness.js`, `p1-dark-panels.js`, `p2-inline-writers.js`, `p3-lightrules.js`,
`p5-why-missed.js`, `p6-tokens.js`, `p7-last.js`, `p8-ctx.js`, `p9-inline3.js`, `p10-check.js`,
`p11-cost.js`, `p12-motion.js`, `p13-toast.js`, `p14-heads.js`, `p15-heads-why.js`,
`p16-radius.js`, `measure.js`, `run-measure.js` (session scratchpad `.../scratchpad/wf/`).

---

## 1. HEADLINE NUMBERS

| | before (b676) | after | |
|---|---:|---:|---|
| **dark: opaque light panels, 10 views** | **170** | **12** | −93% |
| **dark: WCAG-AA text failures** | **163** | **1** | −99% |
| light: WCAG-AA text failures | 26 | 28 | +2, neither mine — §6 |
| distinct rendered border-radii, app-wide | 16 | **7** | |
| distinct visible heading weights / sizes | 700+500 / 5 | 600+500 / **3** | |
| horizontal overflow, all ten views | 0px | **0px** | unchanged |

Dark now carries **fewer** AA failures than light.

### Light-in-dark panels, per view

| view | before | after | | view | before | after |
|---|---:|---:|---|---|---:|---:|
| patients | 23 | **4** | | studio | 16 | **0** |
| visit | 20 | **0** | | admin | 6 | **0** |
| calendar | 33 | **1** | | intake | 5 | **0** |
| orders | 13 | **1** | | recs | 7 | **2** |
| history | 15 | **4** | | analysis | 32 | **0** |

### Dark AA failures, per view

`patients 22→0 · visit 8→0 · calendar 28→1 · orders 17→0 · history 7→0 · analysis 43→0 ·
recs 9→0 · studio 17→0 · admin 7→0 · intake 5→0`

### Distinct rendered border-radii, per view

`patients 13→5 · visit 12→4 · calendar 15→7 · orders 12→5 · history 13→6 · analysis 12→5 ·
recs 12→5 · studio 13→5 · admin 11→4 · intake 10→4`

---

## 2. SCREENSHOTS — both themes, before and after

40 PNGs, 1440×900, ten views × two themes × two builds:

```
dispatch-work/WORKER_F_SHOTS_20260726/before/{light,dark}-{patients,visit,calendar,orders,
                                              history,analysis,recs,studio,admin,intake}.png
dispatch-work/WORKER_F_SHOTS_20260726/after/  (same 20 names)
```

Raw measurements alongside them: `measure-before.json`, `measure-final.json`,
`radius-before.json`, `radius-after3.json`, `heads.json`.

---

## 3. WHAT WAS BUILT

### 3.1 Theme parity (`tp-1.0.0`) — the mechanism everything else reuses

Dark mode was a token swap on the components `ScribeFlow.html` declares itself. The ~230 feature
modules each inject their own stylesheet with literal light backgrounds and no `.theme-dark`
branch — **645 such rules across 196 sheets, 199 distinct light literals.**

Nothing static reaches them: those selectors are built by string concatenation
(`'#'+ROOT_ID+' .x{...}'`), so grep never resolves them, and a hand-written override block would
be stale the first time anyone adds a card. So the correction is derived where the truth is —
`document.styleSheets` on the running page — and emitted into one sheet of its own.

**The one design decision that matters, and it was learned the hard way:**

> The override carries the **source rule's specificity, not more.**
> `:where(html body.theme-dark)` contributes zero, and the parity sheet is kept last in `<head>`
> so the tie goes to the correction.

The first version prefixed a real `html body.theme-dark` and outranked everything — including the
rules that *override* the one being corrected. It read
`#mlsCtxBar .mlsctx-av{color:#fff;background:var(--brand)}`, correctly concluded white fails on
dark's mint, and painted near-black text over the `#204034` that `body.mls-redesign` actually
paints there: **20 new failures in ten views to buy zero.** Declaration importance is mirrored
from the source for the same reason.

Other corrections the measurements forced, each recorded in the code:

- **Chroma, not HSL saturation.** `#FCFBF8` — the app's own field background — has HSL saturation
  0.40, because saturation explodes as lightness approaches 1. A saturation classifier painted
  every input the colour of a caution notice.
- **A translucent white is a HIGHLIGHT, not a surface.** Anything under alpha 0.85 lightens what
  is beneath it and reads correctly on dark; flipping those made overlays disappear.
- **Text keeps its rank**: near-black → `--ink`, mid grey → `--muted`. Collapsing both onto
  `--ink` is what makes a dark theme shout.
- **Module-scoped tokens.** Half the app's text is painted through `--stp-ink`, `--anp-mini` and
  friends, declared on a view container and invisible to a lookup on `<body>`. A module that
  redefines one of the app's OWN names on its container gets `inherit` rather than a guess.
- **Inline styles have no selector**, so the override is keyed on the style attribute itself, in
  **both** serialisations — assigning to `.style` rewrites `#EAF1EE` as `rgb(234, 241, 238)`, and
  a rule written for one form stops matching the moment JS touches the element. A pair form
  (`[style*=background][style*=color]`) handles white-on-`var(--brand)`, which fails only as a pair.

### 3.2 The page owns the dark palette

`ScribeFlow.html`'s `body.theme-dark{...}` was **not the block in force**. `feat_mls_redesign.js`
carries a byte-duplicate at the same specificity, injected at runtime, so it won every tie by
document order — editing `--red` in the page had literally no effect on the rendered pixel. The
block is now `html body.theme-dark`, so the page is the authority.

`--red` `#E0606B` measured **4.42:1** on `--soft` — a near miss on the *destructive* controls.
`#E5717B` measures 5.10 on `--soft`, 5.35 on `--surface`, 5.85 on `--bg`. Dark only.

### 3.3 One heading system

33 visible headings in two competing systems → three ranks and nothing else.

| | before | after |
|---|---|---|
| weight 700, Public Sans, 5 sizes | 31 | 0 |
| weight 600, Public Sans, h2 20 / h3 15 | 0 | 31 |
| weight 500, Newsreader, h1 28 | 2 | 2 |
| distinct sizes | 15/18/20/23/28 | **28 / 20 / 15** |

`!important` was necessary: the `*_exact.js` modules declare heading type with their own. Eight
headings needed five explicit overrides on top, because those modules declare at (2,0,1)/(2,1,1)
— `#ordersView #ordersCard > h2` — which no bare `h2{...!important}` can reach. The page's own
`.card h2{font-weight:700}` is **retired, not shadowed**.

### 3.4 One radius scale

`22 floating / 16 card / 10 control / 999 pill`, published as `--r-float --r-card --r-ctl --r-pill`.

**The middle column is the finding:**

| | before | shells rewritten | + runtime pass |
|---|---:|---:|---:|
| distinct rendered radii, app-wide | 16 | **16** | **7** |
| calendar | 15 | 15 | 7 |

A scripted substitution rewrote **596 off-scale declarations** across the two shells (464 and 416
scanned, exact-count asserted per file) and left the distinct count *unchanged*, because every
off-scale value also had a `*_exact.js` survivor at higher specificity with `!important`. Same
wall as the dark theme, same answer. The parity engine gained a radius pass (rules + inline) and
now runs in both themes; radius overrides use the source selector **verbatim**.

Value mapping actually applied in the shells: `8→10 ×195 · 9→10 ×120 · 12→10 ×90 · 7→10 ×42 ·
6→10 ×26 · 11→10 ×26 · 14→16 ×26 · 13→16 ×20 · 20→22 ×17 · 5→10 ×8 · 3→10 ×8 · 4→10 ×6 ·
18→16 ×5 · 15→16 ×4 · 30→22 ×2 · 2→10 ×1`.

### 3.5 Motion — TOKENS FOR D AND E

The owner asked for animation. **Most of the system already existed** and re-deriving from the tip
before building is what stopped me re-inventing it: `feat_mls_calm_shell.js` ships four durations
and three easings, transform/opacity only, reduced-motion covered, pinned by
`tests/motion-system-costs-no-layout`. Two real defects were left.

**Consume these — do not invent curves. They are now on `:root` in both shells, unconditionally:**

| token | value | use |
|---|---|---|
| `--mls-dur-1` | 120ms | press / hover |
| `--mls-dur-2` | 200ms | state change |
| `--mls-dur-3` | 300ms | entrance |
| `--mls-dur-4` | 420ms | view |
| `--mls-ease-out` | `cubic-bezier(.2,.7,.3,1)` | arriving |
| `--mls-ease-inout` | `cubic-bezier(.4,0,.2,1)` | moving in place |
| `--mls-ease-spring` | `cubic-bezier(.2,.9,.3,1.06)` | summoned by the user |

1. **The vocabulary was conditional.** Declared at `:root` *inside the calm shell*, it does not
   exist until that module loads and not at all under `?ui=classic` — so any rule written as
   `transition:transform var(--mls-dur-2)` degrades to the initial value and the motion silently
   stops. Now page-level. The shell copy stays and the gate pins that **the two agree**.
2. **Three entrances could strand a surface invisible.** `animation: x .18s both` applies the
   `opacity:0` keyframe *before* the animation runs. Found by the new gate on its first run:
   `mlsMdlIn`, `mlsMdlCard` (every calm-shell modal) and `mlsMoRise` (the right-now bar). Fill
   dropped from all three — the to-state IS the resting state, so it bought nothing.
   **Verified by cancelling the animation outright**, which is what an occluded tab or a
   never-started entrance amounts to: `.modal` → `opacity 1, transform none`; `#mlsRightNow` →
   `opacity 1, transform none`. Under `prefers-reduced-motion: reduce`: 0 animations, modal
   opacity 1, toast transition 0s.

Polish added, deliberately small: a generic `.modal-bg.show` entrance (opacity on the container,
10px lift + .985 scale on the card, no fill) that is shell-independent, so the 14 `.modal-bg`
dialogs the calm shell's enumerated list does not name now animate — and its `!important`
reduced-motion clear reaches them, closing a gap in the shell's own list. The toast transitioned
**every** animatable property for .3s on the default easing, including its background and
max-width; now transform + opacity on the tokens, in both the page and
`feat_mls_redesign.js`'s higher-specificity copy.

**NOT added, a decision rather than an omission: a view-switch entrance.**
`feat_mls_calm_shell.js` records that b653 shipped one and it was wrong twice — `showView` writes
only `.style.display` so the rule could never match, and `ScribeFlow.html:10440` records the
owner's **reverted** verdict that *"whole-view fades made every navigation feel like a
screen-level pop"*. Re-adding one would be re-shipping a rejected design over a documented revert.

---

## 4. COST — measured, because I claimed "free" once and was wrong

| | light | dark |
|---|---|---|
| passes over whole boot | 21 | — |
| rules emitted | 474 | 1,803 |
| **colour declarations emitted in light** | **1** (the `:where(...theme-dark)` form-control preamble — inert) | — |
| radius declarations emitted in light | 2,391 | — |
| warm refresh (nothing new) | 0.4ms | 0.4ms |
| cold full rebuild (all sheets) | — | 29.8ms |
| passes over 6s idle | 1 | 1 |

An earlier build **claimed "no poller" and then measured 8 passes over 6s idle** at 5.8ms each —
0.8% of the main thread doing nothing. Something in the app adds and removes a `<style>` while
idle, firing the head observer ~1.3×/s. A cheap early-out (sheet count + inline-styled element
count unchanged ⇒ return) took that to 1 pass and 0.4ms. A `.noops` counter is exposed so a future
measurement can tell "did not run" from "ran and found nothing".

No `setInterval`. No document-wide subtree observer — `childList` on head and body only, plus five
bounded timeouts and one `attributeFilter:['class']` observer on `<body>`.

---

## 5. GATES ADDED (3), all negative-tested in BOTH directions on the real tree

Registered in `run-all.js` (339 → 342; A's two took 336 → 338, motion took 338 → 339).

**`tests/dark-theme-reaches-every-panel.test.js`** — runs the engine's own decision functions in a
`vm` sandbox (the block is closed one statement later, so no test hook ships) and pins equal-
specificity scoping, chroma classification, text rank, top-level comma splitting, the alpha guard,
mirrored importance, no interval, no subtree observer, and the five surfaces that must NOT follow
the theme (`#mlsDock` — untouchable per the contract — the signature pad, `canvas`, `<option>`,
`.mlsf-note`). It also pins that the staging twin carries a **byte-identical** engine.

```
drop :where scoping                 CAUGHT
chroma -> HSL saturation            CAUGHT
drop the background alpha guard     CAUGHT
stop mirroring importance           CAUGHT   (both shells mutated, so twin-drift
                                              cannot be why it fired)
add a setInterval                   CAUGHT
unmodified tree                     PASSES
```

**`tests/motion-tokens-are-page-level-and-cannot-strand.test.js`** — the seven tokens exist in both
pages' own `:root` and **agree value-for-value with the shell copy**; no `@keyframes` starting
from `opacity:0` may be used with a `both`/`backwards` fill; the modal entrance is
transform/opacity only and clears under reduced motion. Refuses to pass at all if it finds zero
fade-in keyframes (11 found). **It caught two real hazards on its first run.**

```
animation:zz 300ms both on a fade-in    CAUGHT
animation:zz 300ms ease (correct)       quiet
from{opacity:.4} ... both               quiet   (cannot disappear)
zero fade-in keyframes found            FAILS   (detector is broken, not the code)
```

**`tests/one-heading-system.test.js`** and **`tests/one-radius-scale.test.js`**

```
heading: reintroduce a bold page heading   CAUGHT      radius: off-scale radius        CAUGHT
heading: drop an h2 rank size              CAUGHT      radius: drop runtime pass       CAUGHT
heading: drop a module override            CAUGHT      radius: drop inline pass        CAUGHT
heading: bold BUTTON (not a heading)       quiet       radius: add scope specificity   CAUGHT
heading: corrected rule                    quiet       radius: retune a threshold      CAUGHT
unmodified tree                            PASSES      radius: fork --r-ctl 10->11     CAUGHT
                                                       unmodified tree                 PASSES
```

**Two radius assertions MISSED on the first run** and were tightened: `/function snapRadius/`
matches `function snapRadiusX` perfectly well. Only running the mutations found it — a gate that
cannot fail on the regression it names is worse than no gate.

---

## 6. RESIDUE — measured, not assumed

**12 dark panels and 1 dark text failure survive. Every one is an inline `!important`** written by
the `imp()` helper in the `*_exact.js` modules
(`el.style.setProperty('background','#fff','important')`). Per CSS Cascade, an inline `!important`
outranks every author stylesheet **by definition**, so no CSS can reach them.

```
patients   button.btn-ghost.mls-moved   x3, button.btn-primary.mls-moved
calendar   #calJump          history  button.btn-ghost x2, #pullChartBtn, #chartSumBtn
orders     button.btn-ghost  recs     button.btn-ghost x2
text       #calMonthLabel — rgb(26,33,28) on rgb(28,35,30), 1.02:1
```

**The fix is one character class at those call sites: `imp(el,'background','#fff')` →
`imp(el,'background','var(--surface)')`.** Those files are D's and E's.

**Light mode went 26 → 28 AA failures, and neither is mine.** In light the parity sheet emits 2,391
radius declarations and exactly **one** colour declaration, which is `:where(...theme-dark)`-scoped
and inert. The two additions are conditionally-rendered elements absent from the baseline run:
`#t7AxStamp` (`rgb(139,155,176)` on white, 2.71:1) and `span.mlsac-sub` (`rgb(15,34,51)` on
`rgb(46,106,75)`, 2.53:1). Both are pre-existing light-mode colours.

**Light mode's own 26 failures are Worker A's F8 and I deliberately did not touch them.** The
`#79837C` family (3.56–3.92:1, 136 occurrences) plus `#69758C`, `#7D8BA1`, `#77817B`. A said it
"deserves its own decision"; folding it would touch files D and E are rebuilding.

**17 of 33 headings are still emoji-prefixed and 9 exceed the three-word budget.** Full list in
`WORKER_F_SHOTS_20260726/heads.json`. These are TEXT in `patientsView` and `ordersView` markup —
D's and E's — and editing them here would collide with work in flight and probably lose:

```
patients  🧾 Doctor prep summary · 📌 Visit context · 🚩 Key risks & reminders · 🩺 Problem list
          💊 Medications · ⚠️ Allergies · 📋 Summary · 🩺 Vitals · 📖 History & background
          💳 Insurance & benefits · 📎 Documents · 🗂️ Outside records / imaging / extra history
          📚 Visit timeline
orders    🩺 Diagnosis context · ➕ New order · 🗒 Orders for this visit
          📝 Prior-authorization letter
```

Per the owner's directive, emoji stay only where **semantic** (the record hero's mic). None of the
above is.

**2 stray radii remain** after the scale: `11px ×40` and `13px ×4`. Not traced to a source; they
survive both the rule pass and the inline pass, so they come from something the engine skips
(`var()`-valued declarations, or a SKIP-listed surface such as the dock). `50%` is the seventh
value and is **correct**: a ratio is not a corner radius and does not belong on a px scale.

---

## 7. STAGING TWIN — what I did, explicitly

`ScribeFlow-staging.html` is a real, tested twin (`calm-clinician-surface-contract`,
`gate-loading-always-ends`, `day-switch-otherday-contract` and others read it). **Every change in
this lane is in both files**, and two gates now pin that they cannot drift: the parity engine must
be byte-identical, and the heading system block must be identical.

Staging keeps its own palette — its light `--red` is `#d24447`, its `--soft` is `#eef3fb`. Only its
**dark** `--red` moved, to the same `#E5717B`. Its own radius census was 416 declarations, 283
rewritten.

`ScribeFlow_test.html` was **not** touched — it is not in the publication set and still carries the
pre-change `--r-ctl:11px`.

---

## 8. COMMITS ON `worker-f-theme` (7, none pushed)

| hash | what | measured effect |
|---|---|---|
| `3abf95b` | the page owns the dark palette, and its red clears AA on it | `--red` 4.42 → 5.10:1 on `--soft`; the token block is no longer shadowed by `feat_mls_redesign.js` |
| `e0aae3c` | the dark theme reaches the whole app | panels 170 → 12, dark AA 163 → 1 |
| `7ad544d` | the parity scan stops paying for nothing | idle 8 passes/6s at 5.8ms → 1 pass at 0.4ms |
| `1c42331` | one motion vocabulary the whole app can reach, no entrance that can strand | tokens page-level; 3 stranding fills removed; modal entrance + toast on tokens |
| `4a215a1` | gate: the dark theme's reach cannot be lost silently | 5/5 mutations caught |
| `890c37c` | one heading system | weights 700→600 on 31 headings; sizes 5 → 3; overflow 0px |
| `f4d3763` | one radius scale | 596 shell declarations rewritten; rendered distinct 16 → 7 |

---

## 9. OPEN RISKS

1. **`git` conflict surface.** The radius commit rewrites 596 lines in `ScribeFlow.html` and its
   twin, and D and E are editing the same files. It is a pure **value substitution** — no line is
   restructured — so every conflict is line-local, but there will be many. Merge F **before** or
   **after** D/E as one block, not interleaved.
2. **The heading system couples five selectors to Worker E's modules**
   (`#ordersView #ordersCard > h2` and four more). If E renames a card id, eight headings quietly
   return to weight 700 and `one-heading-system` fails loudly — which is the intended failure, but
   the durable fix is for those modules to stop declaring heading weight at all.
3. **The parity engine now runs in light mode.** It emits radius only (verified: 1 inert colour
   declaration), but it is 21 passes and ~30ms of work at boot that light-mode users did not pay
   before, on a page whose boot TBT is a known problem. If that becomes a concern, gating the
   radius pass behind a first-idle callback is a one-line change.
4. **`html.mls-secure-loading` was still on `<html>` after signup** in my harness, and it carries
   `transition:none!important` for the whole body. If that is also true on a real signed-in tab,
   every transition in the app is dead and no one would know. **Not investigated — outside this
   lane, but somebody should measure it on the owner's tab.**
5. **`ScribeFlow_test.html`** (405 radius declarations, `--r-ctl:11px`) is now inconsistent with
   the shells. It appears to be dead, but nobody has said so out loud.
6. **I did not touch** `privacy.html`, `terms.html` (SHA-pinned), `background.js`, the dock's
   structure or colours (excluded from the parity engine on purpose), `#mlsReviewPanel`, or any
   per-view layout.

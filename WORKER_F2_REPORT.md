# WORKER F2 — motion report, 2026-07-26

**Lane:** F2 (motion). **Deliverable:** local commits + this report. **Never pushed.**
Base: `origin/main` @ `9dad696` (b686; started at `c0d9c8f`/b685 and rebased once).
Branch: **`worker-f2-motion`**, worktree `dispatch-work/worker-f2-motion`.

Gate: **348/348 green**, run clean, no `MLS_ALLOW_STALE`. (The brief said 347; b686 landed one
more while I worked.)

Tokens documented in **`MOTION_TOKENS.md`** — the single doc D, E and anyone else should read
before making something move.

---

## 0. THE AUDIT CHANGED THE BRIEF

Item 7 said audit first. Doing so found that **half the brief's premises were already built**,
and that the real defect was elsewhere. Measured on the running page at b685, not assumed:

| brief says | running page says |
|---|---|
| dock pill "teleports" | **already glided** — `transform,width 0.26s`. What it lacked was a *landing*: the plain deceleration curve stops dead. |
| Copilot panel "just appears" | **already slid** — `translateX(102%)→0` on a bespoke `.26s cubic-bezier(.4,.0,.2,1)`. What it lacked was a *fade*. |
| stage rail should glide | **already glided** — dots transition transform/background at 0.26s. |
| Tools menu needs scale+fade from anchor | **already had it** — `mlsPop`, `transform-origin:bottom left`. |
| "one press rule app-wide" | **31 competing `:active` rules** across 15 stylesheets with 8 different answers. |
| "keep it ONE vocabulary" | **THREE vocabularies.** b680 hoisted the token names but never retired the fork. |

So the work became: **retire two rival vocabularies, collapse 31 press rules into 1, add the
three things genuinely missing, and fix the gate that should have caught all of it.**

---

## 1. THE THREE VOCABULARIES (the finding behind everything else)

```
canonical  --mls-dur-1..4 / --mls-ease-out|inout|spring     page :root, b680
legacy     --mls-fast 180 / --mls-base 260 / --mls-slow 380 /
           --mls-spring cubic-bezier(.32,.72,0,1)            feat_mls_calm_shell.js, 23 uses
bespoke    .16s linear / .16s cubic-bezier(.2,.8,.3,1) /
           .14s / .18s / .26s cubic-bezier(.4,.0,.2,1) / .07s ease   five more files
```

Two spellings of one deceleration curve is the exact incoherence the token system exists to end.

**The legacy four are now aliases**, not a second set — rewriting 23 call sites would churn a
file three lanes are editing for no behavioural gain. The old literals survive **only as the
`var()` fallback**, so nothing can break; the gate now fails if either is re-pinned to a literal.

Verified on the running page, before → after:

```
#mlsDock .mls-dock-pill   0.26s cubic-bezier(.32,.72,0,1) -> 0.30s spring
#mlsDock button           0.18s                            -> 0.20s
#mlsStages .st .dot       0.26s                            -> 0.30s
```

---

## 2. ONE PRESS ACKNOWLEDGMENT — 31 → 1

Eight different answers were shipping: `translateY(1px)`, `translateY(0)`, `translateY(2px)`,
`scale(.93)`, `.96`, `.97`, `.98`, `.985`, `.986`, `.99`. One was injected from JS on the first
view switch with a bespoke `.07s`.

**Measured two ways, because neither alone is enough.**

**A real trusted mouse-down, held open** (`:active` cannot be faked with a class):

```
#mlsRdNewBtn  #mlsTbMenuBtn  #mlsAccountMenuBtn  .mls-baricon  #mlsavsBtn
   -> scaleX 0.972 every one
prefers-reduced-motion: reduce, same press -> transform: none
```

**A cascade audit** over every pressable control in ten views, resolving the winner the way the
browser does (importance → specificity → order):

| | controls |
|---|---:|
| canonical rule wins | **222** |
| `#mlsDock` — deliberately excluded (`scale(.93)`, tuned for a 64px target, dock untouchable) | 60 |
| no `:active` rule at all — and **every one is a `disabled` button** | 11 |
| unaccounted for | **0** |

The 11 disabled buttons (`.mrp-btn` ×10, `#mlsDsTodayBtn`) used to press back. Retiring the two
shadowed page-level `button:active` rules — rather than out-specifying them — fixed that. A
disabled control that presses back is lying about being pressable.

Third exclusion, documented in the rule: `.ez3-big`, the record hero. `.97` on a 400px control is
a 12px lurch.

---

## 3. WHAT NOW MOVES THAT DID NOT

| surface | change | verified |
|---|---|---|
| dock pill | plain curve → `--mls-ease-spring`: it **lands** instead of stopping dead | moves through a real mid-point, `0 → 85 → 223px` over 300ms |
| dock active icon | same spring on the 1px lift + 8% scale | `transform / 0.3s / spring` both themes |
| Copilot drawer | slide **+ fade**, on tokens; scrim on tokens | CSS correct; **runtime unverified — see §6** |
| voice fan | grows from its trigger: `scale(.96)`, `transform-origin:top center` | `origin 360px 0px`, `fill:none`, cancelled → `opacity 1` |
| toast | 80px throw → 14px settle; entry and exit are different moves | exit `0.12s/0.2s` vs entry `0.2s/0.3s` |

**The toast taught the lesson worth keeping.** The asymmetry was first written on `.toast`
(0,1,0) in the page and measured **0.2s/0.3s in both directions** — dead CSS, because
`body.mls-redesign #toast` (1,1,1) in `feat_mls_redesign.js` wins on the live shell. Written
where the cascade actually decides it, it works. *Verify on the running page, not the diff: a
split that never applies looks exactly like a split.*

Everything measured in **both themes** at 1440×900; timings are theme-independent and read
identical.

---

## 4. THE GATE HAD A BLIND SPOT, AND IT COST 14 REAL DEFECTS

My own b680 strand gate scanned **three named files**. `feat_mls_visit_voice_one.js` shipped

```
@keyframes mlsVoIn{from{opacity:0;...}}   ...   animation:mlsVoIn .18s ... both
```

— the exact regression the suite exists to prevent — and it was green the whole time, because
that file was not in the list. **A named list of files is a promise that nobody will ever add
motion anywhere else**, in a repo with ~230 modules that each inject their own stylesheet.

The haystack is now **derived**: every shipped `.js`/`.html` at the repo root containing an
`@keyframes`, minus retired dev-zone pages and the unpublished test shell. **38 assets, 24
fade-in keyframes**, both asserted with a floor so the haystack cannot quietly shrink back.

**What it caught on its first widened run — 13 more, all on PATIENT-FACING pages:**

```
booking.html 3 · appointment.html 2 · intake.html 2 · patient-portal.html 2
best-doctors-optout.html 2 · phone.html 2          (all `mlsRise ... both`)
```

A stranded entrance in the app is a doctor seeing a blank panel. On booking and intake it is a
**patient** seeing a blank page, on a device we do not control, with no console anyone will read.
All 13 fixed; `mlsRise`'s to-state is the resting state, so the fill bought nothing.

A second assertion pins the legacy four as aliases rather than literals.

**Negative-tested on the real tree, mutation then restore:**

```
reintroduce a strand in a feat module     CAUGHT
reintroduce a strand on a patient page    CAUGHT
fork a motion token back to a literal     CAUGHT
narrow the haystack back to three files   CAUGHT
unmodified tree                           PASSES
```

The token-fork case **MISSED first time** — the suite pinned the seven canonical tokens but
nothing pinned the four aliases, which is precisely the gap that let a second vocabulary exist
for five builds. Only running the mutation found it.

---

## 5. INSTRUMENT FAULTS — four, all caught before they became findings

1. **`elementFromPoint` returns the innermost node** — the label `<span>` inside the button — so
   identity comparison reported every control "covered".
2. **Pressing real controls opens real menus**, which then cover every later target.
3. **The cascade probe split selector lists on every comma**, so the canonical rule's
   `:is(button,[role="button"],…)` became fragments matching nothing and it reported **1 win out
   of 293** — while a real trusted press measured `.97`. The same top-level-comma bug the parity
   engine was fixed for at b680. *The instrument was wrong, not the cascade.*
4. **Walking into `@media` blocks that do not currently apply** let the reduced-motion *variant*
   of the canonical rule count as its own rival, and "win" 64 controls.

Fault 3 is the one to remember: two instruments disagreed, and the one that touched the real
browser was right.

---

## 6. HONEST GAPS

1. **`#copilotDock` is unverified at runtime.** The panel is built lazily by JS on first open and
   no opener is reachable from the demo harness state, so its CSS is correct by inspection but
   unexercised. **Someone with a signed-in session should open the Copilot once and watch it.**
2. **`#mlsStages .bar i` transitions `width`** — a layout property, against the standing law.
   It is dead code (nothing sets that width), which is why it has never been seen. Converting it
   to `transform:scaleX()` needs a writer that does not exist yet. **Found, not fixed.**
3. **The press probe could only reach 5 controls by real press.** Pressing real controls opens
   real menus; the cascade audit (§2) covers the other 288 analytically. Both instruments agree
   where they overlap.
4. **Stills cannot show a curve.** §7 captures the *states* a still can show; the timings in this
   report are the honest evidence for the motion itself.
5. **Nothing new was added to the stage rail or the Visit shortcut chips** beyond the shared press
   rule and the vocabulary swap — both already animated, and adding a second entrance there would
   duplicate rather than extend.

---

## 7. SCREENSHOTS

`dispatch-work/WORKER_F2_SHOTS_20260726/{light,dark}/` — 14 frames:

- `dock-patient|visit|review|studio.png` — the highlight at rest on each destination
- `dock-MIDGLIDE.png` — the pill captured **110ms into a 300ms glide**, between two destinations
- `toast-shown.png` / `toast-leaving.png` — the arrival state and the exit state

---

## 8. COMMITS ON `worker-f2-motion` (5, none pushed)

| hash | what |
|---|---|
| `92faa38` | the legacy four become aliases — one vocabulary, measured |
| `a08406c` | one press acknowledgment — 31 competing `:active` rules become 1 |
| `4b73917` | the dock settles, the drawer fades in, the fan grows from its trigger |
| `6753ccf` | the strand check reads every shipped asset — and found 14 more |
| *(this)* | motion tokens doc + report |

---

## 9. OPEN RISKS

1. **The press rule uses `!important`.** Deliberate — it out-shouts 31 rules in files four lanes
   own — but it is the one place in the theme layer doing so. If a lane needs a control to press
   differently, the answer is an entry in the exclusion list, not a louder rule.
2. **I edited four files other lanes own** (`feat_mls_calm_shell.js`,
   `feat_mls_visit_voice_one.js`, `feat_mls_redesign.js`, and six public pages). Every edit is a
   timing value or a fill-mode — no logic, no layout, no structure. Merge conflicts will be
   line-local.
3. **The six public pages are patient-facing and I changed their entrance behaviour.** The change
   makes them *more* robust (they can no longer render blank), but they are not covered by the
   app's runtime harness and I verified them statically only.
4. **`--mls-base` moved 260→300ms and the curve softened** across 23 rules in the calm shell.
   That is the intended "slower and softer" direction, but it is the widest-reaching change here
   and the one most worth an owner's eye.

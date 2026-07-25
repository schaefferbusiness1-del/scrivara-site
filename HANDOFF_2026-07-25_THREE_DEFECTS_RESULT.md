# Result — the three open defects, 2026-07-25

Successor to `HANDOFF_THREE_OPEN_DEFECTS_2026-07-24.md` (commit 9cf2389, written
at b569). Live build at writing: **b590**. Gate: **294/294**.

Two of that handoff's three root causes were **wrong**, and both were wrong in
the same way: they named the last place the bad value was *seen* rather than the
place it was *produced*. Everything below was measured on the running page.

| defect | status |
|---|---|
| 3 — right-now bar welding | **FIXED and verified live** (b590, re-verified b598). Root cause was not textOf |
| 2 — boot / "26s to log in" | **Reproduced, and BOTH proposed fixes disproved by measurement. Still open.** Strongest remaining candidate is 60 document-wide observers + 214 intervals, now pinned by the gate |
| 1 — ON mode | **Another lane owns it.** One owner action left: install 3.0.14, run one pull |

Live at writing: **b598**, gate **298/298**.

---

## Defect 3 — FIXED (b586 + b590)

**The handoff's root cause was wrong.** It said `textOf()` flattening welds the
label. `controlLabel()` already existed at b581, already dropped hidden and
tooltip children, and the rendered button already used it. Verified against the
live element: `controlLabel(#ptPullAthenaBtn)` returns `Pull from Athena ·
READ-ONLY` while `textOf()` returns 250 characters.

The bar still rendered prose. Measured on the running page at b586:

```
#mlsRightNow > button
  text node        "Pull from Athena"        <- controlLabel WAS correct
  span.mlsac-sub   display:block, 300px, VISIBLE
                   "Opens this patient's chart in your signed-in Athena tab
                    (read-only) and brings their name, DOB and past visits..."
  br
  span.mlsac-tag   "READ-ONLY"
```

`feat_athena_clarity.js` was decorating **the shell's proxy button**. Its
`decorateOne()` matches a control by id *or by textContent prefix*, and a proxy's
textContent is exactly the catalog label. A toolbar reference was decorated as if
it were the real control.

That is why all three previous attempts failed, and each is now explained:

- editing the shared label string — the shell never had a welded string
- `#mlsRightNow button small{display:block}` — no `<small>` is involved at all
- `textOf` → `controlLabel` — correct, shipped in b586, but the injection happens
  *after* the label is assigned, so no label function can see it

**Fix.** A proxy is a *reference* to a control, not the control. The shell marks
every button it synthesises with `data-mls-proxy`; `feat_athena_clarity` refuses
to decorate anything carrying that marker, and refuses *before* `matchEntry()`
stamps `data-mlsac` on it.

**Verified live at b590:** 0 welded of 12 bar buttons across Day/Patient/Visit/
Review (was 4 of 12). The real `#ptPullAthenaBtn` is still decorated
(`data-mlsac="read"`, sub-label present, `display:none` on its own surface) — the
explanation was not removed, only kept off the toolbar reference.

Also shipped: three remaining `textOf` → `controlLabel` **display** sites (alias
tooltip, segmented tabs, and the re-render signature, which was computed from a
different string than the one rendered). Matching sites keep `textOf` on purpose
— the trusted-gesture gate, `busyMaybe`, `spec.label` lookups and the "0 words"
probe all want the flattened form, and for the gate the broader string fails safe.

Guarded by `tests/shell-label-authority-contract.test.js`, which evaluates the
real derivation out of the source against the live element shapes, pins all four
display sites and the proxy guard, and **records the proof that the label layer
cannot fix this** — once a *visible* sub-label has been injected, `controlLabel`
correctly includes it, because a visible child really is part of what the button
reads. Negative-tested by reverting each fix.

### Still open on defect 3

The structural half. `#patientBar` **does** exist (`ScribeFlow.html:1703`,
`ACTIVE PATIENT BAR (shown on Visit + History)`) — so "there is no patient header
element at all" is not accurate — but it is scoped to Visit and History, and is
hidden with "No active patient" elsewhere. The owner's *"if Im on a paietn the
patient banner sohuld be up there"* is about the Patient screen. Note
`identityCards()` deliberately refuses a top-pinned banner on **Today**, and that
reasoning is sound and should be preserved: on Today no patient is selected, and
a persistent banner would imply the doctor is already in a chart. A header when a
patient *is* open does not have that problem.

---

## Defect 2 — reproduced, root-caused, NOT fixed

**It is real.** Foreground, signed in, warm, b581:

```
FCP 148ms, load 373ms            the PAGE is fast
Total Blocking Time  10,929ms    the APP is not
16 long tasks, last ending at 24,568ms
```

**Why nobody could reproduce it.** The same load in a **background** tab
finishes its script phase in 1.4s with zero long tasks, because a hidden tab
skips the rendering work. Three sessions measured a hidden tab. Measure boot in
a tab that is actually in front.

**Also:** the feature scripts do not load until **after authentication** — the
login screen is 5 resources. That is why the owner experiences this as slow login.

### Theories killed by measurement — do not re-open

| theory | killed by |
|---|---|
| network | 204/205 from cache, response **0.7ms** |
| parse/exec cost | all 212 scripts execute in **1,728ms** total when isolated |
| one hot script | three runs blamed three *different* files (2.0s / 2.2s / 3.7s). The blob floats; load-event-gap attribution is unreliable here |
| stylesheet count | 196 `<style>` elements, but one insert + forced layout is **1ms**. 179 of them is ~179ms, not nine seconds. **Do not attempt a style-batching refactor** |
| the SW cache write | **1.7ms** per put, ~350ms of 9.6s. Real waste, fixed, but not the cause |
| **the request count / bundling** | same 205 assets, same SW, idle main thread: **~170ms total**. See below — this one killed my own conclusion |

### The request count is not the cause either — and bundling will not fix this

This is the correction that matters most. Both the 2026-07-24 handoff and my own
first conclusion said "bundle the feature scripts". **Both are wrong.**

The boot numbers look damning for the request count:

```
median per-script QUEUE time (startTime -> fetchStart):  6,477ms
aggregate queue:                                     1,274,056ms
wall span:                                               9,592ms
```

So I re-fetched the **same 205 cached assets** through the **same service
worker** on the **same page**, with the main thread idle:

```
150 in parallel     124ms total, 0.83ms per request
sequential          3.11ms per request
projected for 205   ~170ms
```

Same URLs, same worker, same cache: **56×**. Fetching all 205 costs ~170ms. The
other ~9.4s is main-thread contention that the requests are merely **queued
behind**. The 6,477ms queue is a *symptom*, not the cause.

> **Bundling 205 → 1 buys ~170ms of ~9,500ms.** It is the highest-blast-radius
> refactor in the product for a ~2% win, and a bundle still executes the same
> code on the same thread. Do not do it on this evidence.

The 0-byte/2-second signature that looks like serialization cost is scripts
*waiting* for a busy main thread, not paying for their own transfer.

### What shipped

- `sw.js` re-wrote **every cache hit back to disk**. The versioned-asset branch
  did `caches.match()` across all caches then `cache.put()` on every request,
  including when the entry was already in `CACHE`. It now asks the current cache
  first; the promotion from an older named cache is unchanged, so offline is
  preserved. Measured effect on boot: **none detectable** (warm before 6,477ms
  median queue / 9,592ms span; after 5,659ms / 9,543ms — within run-to-run
  noise). Keep it because it is a correctness fix, not because it is the boot fix.
- `tests/boot-script-budget.test.js` gained the second arm the handoff asked for.
  It counted names in `mls-connect.js`, so it measured **bundling only** and a
  deferral win would have read as zero progress. It now also counts how many
  scripts are inserted **eagerly** rather than behind `window.__mlsDeferAsset()`
  or `requestIdleCallback` — 164 eager, 0 deferred today. Both arms two-sided,
  both negative-tested.

### What is actually left, and what to do next

The cost is the **work each module does at boot**, over a real store:

```
1,481 patients · 2,166 visits · 471KB store · 1.74MB localStorage · 8,154 DOM nodes
```

`getPatients()` is memoized (0.1ms first call, 0ms after), so it is **not**
repeated store parsing. It is what 234 modules each *do* with that data while the
first screen is trying to paint.

### THE LEAD — forced synchronous layout, 96% from two named modules (b598)

Instrumented `getBoundingClientRect`, `getComputedStyle` and the eight
`offset*`/`client*`/`scroll*` getters, installed before the feature scripts:

```
5,576 forced-layout reads during boot

  feat_mls_calendar_exact.js   3,722   67%
  feat_mls_calm_shell.js       1,633   29%
  mls-connect.js                 103
  everything else                118
```

Two modules are **96%** of every layout read at boot. Interleaved with the
~700 DOM mutations happening at the same time, each read forces a synchronous
style+layout over an 8,154-node DOM with 3,934 CSS rules. At ~1–2ms each that
is 5.5–11s — which brackets the measured foreground TBT of 10,929ms.

`feat_mls_calm_shell.js:48` is the shell's `visible()`:
`!!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)` — called
once per candidate control, and the coverage suite counts 802 active controls.

> **Read this before "fixing" it.** A tight read-only loop is NOT the problem;
> once layout is clean, subsequent reads are free. The cost is read → write →
> read interleaving. Confirm the interleave before batching anything, and do not
> memoize `visible()` across a write — a stale visibility answer puts a control
> in the bar that the user cannot press, which is worse than a slow boot.

**Measured at 28ms in a hidden tab, which is meaningless** — a hidden tab has no
layout to compute, so forced reads are free there. That number will only become
real in a foreground window. It is the single measurement this defect still
needs, and it takes about a minute (see below).

### The observer theory — also killed

Instrumented `MutationObserver` construction and every callback:

```
182 observers created (94 document-wide at runtime)
17,474 callback invocations · 65,490 mutation records
TOTAL callback time: 444ms  (408ms of it document-wide)
```

444ms of ~9,500ms. The observer population is worth pinning (arm C, below)
because it is real waste and it grows, but **it is not the boot defect**. Note
65,490 records across ~94 document-wide observers implies only ~700 actual DOM
mutations — the mutation count is fine. The reads are the problem, not the writes.

### The population pin, from source (arm C)

Per-module runtime attribution needs a **foreground browser window**, which
automation cannot force — `document.hidden` was true on every attempt, and LoAF
records nothing without animation frames. So the population was audited from
source instead. Across the 250 feature modules:

```
 60 document-wide subtree MutationObservers  (57 modules)
214 setInterval pollers                      (169 modules)
```

A document-wide `subtree:true` observer reacts to **every DOM change made by
every other module**. During boot all 234 are mutating, so the cost is
`mutations × observers`, not per-module. This is the first hypothesis that
explains both things single-module attribution could not:

- **why no single script ever owns the blob** — three runs blamed three different
  files because the work belongs to the observers reacting to everyone else,
  not to whichever script happened to be executing
- **why a background tab reads 1.4s** — the observers still fire; the style and
  layout they dirty is never computed

214 intervals never stop, which also explains a long task appearing ~22s after
load with nothing left to boot.

Pinned by arm C of `tests/boot-script-budget.test.js` (both ceilings
negative-tested). `tests/interaction-performance-contract.test.js` already
polices *named* modules for exactly these two constructs — arm C is the
population-level pin so the total cannot grow while each addition looks
individually reasonable.

**Superseded as a cause** by the 444ms measurement above — keep the pin, drop the
theory.

### The one measurement this defect still needs

Everything expensive here is rendering, and **rendering is free in a hidden tab**.
That is why five sessions have produced five different wrong answers. Automation
cannot force window focus: `document.hidden` was true on every attempt bar one,
and `long-animation-frame` records nothing without animation frames.

**With the Chrome window focused for ~60 seconds**, run the layout-read
instrument above plus a `longtask` observer across one reload. That yields
forced-layout cost per module in the foreground and either confirms or kills the
layout-thrash lead in a single pass. Until then, do not refactor either module:
the 28ms hidden-tab figure is not evidence, and neither is anyone's intuition.

**Confirming measurement, and it has to come before any fix.** Attribute
main-thread time *per module* with the tab genuinely in **front** — the Chrome
window focused, not just the tab selected. Two instruments are known not to work
here and will waste a session each:

- load-event-gap attribution — three runs blamed three different files
- `long-animation-frame` — returns nothing in a non-compositing pane, and the
  Chrome automation tab is frequently not the active tab (`document.hidden`
  true). Check `document.hidden === false` and that `paint` entries are non-empty
  before believing any boot reading.

The likely shape of the fix is *doing less at boot* — modules that scan or render
the whole patient store should do it when their screen opens, not on load. The
budget test's arm B (`window.__mlsDeferAsset()` / `requestIdleCallback`) exists to
make that visible, because a deferral win leaves every filename in place.

### Budget test blind spot — fixed

`tests/boot-script-budget.test.js` matched `/feat_mls_[a-z0-9_]+\.js/` and so
watched **164 of the 234** scripts the loader names, missing 70 — the whole
`feat_athena_*` family (24), plus `feat_visit*`, `feat_opnote_*`,
`feat_autosave`, `feat_save_verify`, `feat_task3_*`. A ceiling with a 30% blind
spot cannot do the job its own header claims. Widened to `/feat_[a-z0-9_]+\.js/`
and re-pinned to 234/200 on both arms. Caught by the QA lane, not by me.

---

## Defect 1 — not mine; another lane has it

I did not touch the extension, `background.js`, or `agent/ext-3.0.10-on-mode`.
A parallel session picked it up and has since carried it to
`agent/ext-3.0.14-on-mode` (rebased onto main, gate green for the first time,
plus the noise-surface fix: `bestResult(enR, …)` had no noise filter, so the
inbox could supply the index, set `receipt.expected`, and end the retry loop).

One owner action remains and cannot be automated: install it, run one pull, read
the `enum=` reason. Judge by `coverageComplete` above zero on real patients,
never by the frame being accepted.

---

## Method notes

1. **Check the instrument before believing it.** Five artifacts this session:
   long-animation-frame returns nothing in a non-compositing pane; a hidden tab
   reports a 1.4s script phase for work that takes 7.9s in front; load-event-gap
   attribution blamed three different files on three runs; a `<style>` cost
   theory that was 50× off; and an async IIFE returns `{}` through the Chrome
   bridge.
2. **Name the producer, not the last place you saw the value.** Both wrong root
   causes in the previous handoff were correct *observations* of the wrong layer.
   For defect 3 the label function was innocent and already fixed; the writer was
   a different module entirely.
3. **A fix that ships and changes nothing is not a fix.** The SW cache-write
   change is correct and measured at ~350ms; it did not move boot. Said plainly
   here rather than counted as a win.
4. Build numbers raced with a parallel session six times. `git fetch` immediately
   before the bump, and expect to redo it.

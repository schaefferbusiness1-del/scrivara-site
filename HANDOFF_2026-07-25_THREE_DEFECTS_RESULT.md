# Result — the three open defects, 2026-07-25

Successor to `HANDOFF_THREE_OPEN_DEFECTS_2026-07-24.md` (commit 9cf2389, written
at b569). Live build at writing: **b590**. Gate: **294/294**.

Two of that handoff's three root causes were **wrong**, and both were wrong in
the same way: they named the last place the bad value was *seen* rather than the
place it was *produced*. Everything below was measured on the running page.

| defect | status |
|---|---|
| 3 — right-now bar welding | **FIXED and verified live.** Root cause was not textOf |
| 2 — boot / "26s to log in" | **Reproduced and root-caused. NOT fixed.** The proposed fix would not have worked |
| 1 — ON mode | **Not started.** Needs the owner's Athena session and a live pull |

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

### The actual cause

205 separately-fetched, strictly-ordered (`s.async=false`) scripts.

```
median per-script QUEUE time (startTime -> fetchStart):  6,477ms
aggregate queue:                                     1,274,056ms
wall span:                                               9,592ms
```

Serving each asset is instant; **waiting for a turn is not**. The dispatch is
paced by a main thread that is hydrating a real clinic's data at the same time.
The fix is to reduce the **request count**.

> **The handoff's proposed fix would not have worked for the stated reason.** It
> said the cost is 152 scripts "parsed and executed serially on the main thread".
> Parse and execute is 1.7s of it. Bundling is still the right fix, but because
> it removes 204 dispatch turns, not because it removes parse cost — and that
> distinction decides whether *deferral* (which does not reduce the count) counts
> as progress.

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

### What to do next

Bundle. 205 requests → 1. Every feature script is an idempotence-guarded IIFE and
`async=false` already guarantees sequential execution, so concatenation in loader
order is semantically what happens today. Highest blast radius in the product:
full gate plus a **foreground** live measurement, and re-pin both arms of the
budget test afterwards.

---

## Defect 1 — not started

Untouched. It needs extension **3.0.13** installed from
`agent/ext-3.0.10-on-mode`, one real pull on the owner's signed-in Athena tab,
and the `enum=` reason string read from the receipt. Judge by `coverageComplete`
above zero on real patients, never by the frame being accepted. The safety item
in the original handoff — exclude noise surfaces when *building* enumerate
candidates, so a complete-looking index can never be believed while the reader is
looking at the doctor's inbox — still stands on its own terms and is still
unaddressed.

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

# WORKER I — the Medications panel was asserting things that are not medications

Branch `worker-i-parse`, three local commits on `origin/main` (rebased onto `9dad696` / b686).
The lead ships.

---

## 0. The finding, and what it actually was

Lead's walkthrough, owner's signed-in tab, **b685**, patient "A" MRN 8300571. The patient
card's **Medications** panel rendered, *as medications*:

| rendered as a medication | what it really is |
|---|---|
| `Name`, `Date` | the athenaOne meds grid's **column header row**, swallowed whole |
| `check now` | a per-row **action link** |
| `Deborah Hendricks` | a **person's name**, out of the prescriber column |
| `SHAMPOO 3 TIMES WEEKLY…` | the **sig of the row above it**, split off as its own drug |
| `calcium`, `Fish Oil`, `ketoconazole 2 % shampoo` | actually medications — these were correct |

and the **Problem list** rendered `Discussion`, `Discussion Notes`, `Ordered sacroiliac joint
injection (PROC)` and a numbered note fragment as problems.

**The panel was not empty. It was untrustworthy, which is worse.** Real drugs and page
furniture sat in one list with nothing distinguishing them, on the most clinically sensitive
surface in the app.

### Where it came from

`__mlsCleanSections` (module 7 of `feat_mls_b121_pack.js`), the cleaner that wraps
`upsertPatient` and `savePatients` — the single choke point every producer goes through.
Its keep-tests were:

```js
function keepMed(t)     { return DOSE.test(t) || (t.length <= 80 && looksName(t, 8)); }
function keepProblem(t) { /* ICD… else */ return looksName(t, 12); }
```

`looksName` returns true for **any short line containing one 4-or-more-letter word**. "Name",
"Date", "check now", "Deborah Hendricks", "Discussion" — every one passes. There was no
medication shape test at all.

### The half nobody had noticed, facing the other way

`cleanList` **silently deleted** every row that failed the keep-test. A list that quietly
loses rows is not a chart either. Both directions had to be fixed at once, and the fix for
one is what makes the fix for the other safe: you can only afford to tighten the keep-test if
the rows it now rejects go somewhere visible.

---

## 1. What now renders differently, and why each is safe

### Medications panel

| before (b685) | after | why it is safe |
|---|---|---|
| `Name`, `Date`, `check now` | **gone** | whole-line exact matches against a named list of grid column headers and row action links. Anchored `^…$` with only optional trailing `:`/`.` — a line like `Route: topical` or any drug name cannot match |
| `Deborah Hendricks` | **moved** to "Unsorted from chart" | fails every medication signal. It is not deleted and it is not hidden — it is on screen, labelled as not a clinical fact |
| `SHAMPOO 3 TIMES WEEKLY AS DIRECTED` as its own row | **merged**: `ketoconazole 2 % shampoo — SHAMPOO 3 TIMES WEEKLY AS DIRECTED` | a sig row that names no drug belongs to the row above it. The text is not lost, it is re-attached |
| `calcium`, `Fish Oil`, `ketoconazole 2 % shampoo` | **unchanged** | supplement vocabulary / dose-form word / drug morphology |

### Problem list

| before | after | why |
|---|---|---|
| `Discussion`, `Discussion Notes` | **moved** to "Unsorted from chart" | note-section labels, whole-line exact |
| `Ordered sacroiliac joint injection (PROC)` | **moved** to "Unsorted from chart" | plan/order text, not a problem. Clinical, so it is set aside — never dropped |
| numbered note fragment (`1. …discussed at length…`) | **moved** | over the word budget for a diagnosis name; was already being *deleted* before |
| `M54.5 Low back pain`, `Cervical spondylosis` | **unchanged** | ICD code / short dx name |

### The new surface

A quiet block under each of the two panels:

> **Unsorted from chart**
> 1 line from the Athena chart that MLS could not read as medications. Kept here so nothing
> is lost - not treated as clinical facts.
> • Deborah Hendricks

**Zero controls** — no button, no toggle, no `<summary>`. A fold behind a click is a place
clinical text can hide, and a new control would need a Tools reach path it does not have.
It is a **sibling** of `#profMeds` / `#profProblems` (a child would be wiped by
`editProfField`'s `innerHTML` rewrite). It disappears entirely when there is nothing in it.

---

## 2. The three-way classifier

```
DROP     provably non-clinical page furniture. WHOLE-LINE exact matches only.
         Everything v1.1.0 dropped still drops; this only adds grid headers and
         action links. It can never eat a drug name.
KEEP     a plausible medication  — a dose/strength, a dose form, a route or
         frequency, a drug-morphology token (-pril -statin -azole -cillin …),
         a supplement, a salt/release suffix, or a bare one-word brand name.
         a plausible problem     — an ICD code, or a short dx name that is not
         note furniture and not plan text.
UNSORTED everything else. Persisted on the record as _mlsUnsortedMeds /
         _mlsUnsortedProblems and rendered.
```

The keep-test is deliberately **generous**: a one-word brand we do not carry ("Eliquis") is
kept as a medication, because demoting an unknown drug would be the same defect facing the
other way.

---

## 3. Two hazards found while building it — both real, both closed

### 3.1 The unsorted fold nearly resurrected deleted medications

The first draft derived the fold from `_rawMeds` (the stash of the original chart text) union
the current field, so that rows an earlier pass had deleted could be recovered. It works —
and it also means that **every time a clinician deletes a medication in the inline editor and
presses Save, the deletion is undone**, because `saveProfField` calls `upsertPatient`, which
runs the cleaner, which reads `_rawMeds`.

The field is now the **only** input, and the fold is **sticky-additive** instead: a row set
aside on an earlier pass is no longer in the field, so recomputing from the field alone would
silently erase it — which is the exact failure this module exists to stop. Sticky never puts
a row back into the clinical list. A row that later becomes a real medication drops out of
the fold rather than showing twice.

Consequence, stated plainly: records cleaned *before* this ships do not get their previously
deleted rows back. `__mlsCleanSections.restore('ALL')` still recovers them from `_raw*`.

### 3.2 `renderProfile` became a cycle — found in a browser, not by reading

The first build of the render module re-armed its wrapper on every click. In real Chrome the
page died with **"Maximum call stack size exceeded"**, frames alternating between
`feat_mls_visit_focus.js` and the pack.

`feat_mls_visit_focus.js` is re-entrant by construction:

```js
var origRenderProfile = null;                       // MODULE-LEVEL
function wrapRenderProfile() {
  if (window.renderProfile.__vfWrapped) return;     // guard is on the FUNCTION
  origRenderProfile = window.renderProfile;         //   not on a flag
  var w = function () { return origRenderProfile.apply(this, arguments); };
  window.renderProfile = w;
}                                     // and it re-runs at 1.5s / 4s / 9s
```

Its wrapper reads `origRenderProfile` **at call time**. The instant anything puts an unmarked
function on `window.renderProfile`, its next timed retry re-points that shared variable at the
new wrapper — and the new wrapper calls its old one, which now calls the new one. A closed
loop out of two changes that are each correct alone. Same family as module 1's addVisit cycle
guard and as the b669 seam.

Closed by two rules, both in the code with the reason attached:

1. **Wrap at most once, ever** (an `installed` flag, not a check of what is currently on
   `window`). If someone wraps after us we stay in the chain as their orig; re-wrapping to get
   back on top is what builds the cycle.
2. **Carry the other modules' head markers forward** (`__vfWrapped`, `__vtlWrapped`,
   `__vtlOrig`) so neither re-wraps over us. Module 7's `wrapUpsert` already does exactly this
   with `__mlsDedupWrapped` — the idiom here, not a hack.

**Four modules wrap `renderProfile`** — `feat_mls_visit_focus.js`, `feat_mls_visit_timeline.js`,
and two in `mls-connect.js` (easy-prep, outside-records). Only visit_focus is re-entrant.
Worth a separate lane; I did not touch it (it is not mine, and the marker carry-forward makes
it safe from here).

---

## 4. Athena receipts and upsert carry-forward: untouched

`athenaProfileCoverage` and `athenaChartSnapshot` are computed inside `_savePatientChart`
from the **chart object**, *before* `upsertPatient` is called. The cleaner runs inside
`upsertPatient` and writes only `problems`, `meds`, `allergies`, `summary`, `_raw*` and
`_mlsUnsorted*`. Asserted mechanically: two clean passes leave all four proof fields
byte-identical. `read | empty-confirmed | not-found` semantics, the newest-capturedAt-wins
carry-forward and `__mlsAthenaProofGuard` are not touched by any line in this branch.

---

## 5. Evidence

### Real Chrome, real app (headless, `?demo=1`, local demo account, local static server)

The b685 meds/problems shape seeded on a patient, waited past all three of visit_focus's
re-wrap retries (11s), Patients view:

```
__mlsCleanSections 1.2.0   __mlsUnsortedFold 1.0.0   satellite served as ?v=20260726p2c4

meds panel        calcium
                  Fish Oil
                  ketoconazole 2 % shampoo — SHAMPOO 3 TIMES WEEKLY AS DIRECTED
                  metformin HCl 500 mg tablet — TAKE 1 TABLET BY MOUTH TWICE A DAY
                  lisinopril 10 mg
problems panel    M54.5 Low back pain / Cervical spondylosis
fold (meds)       VISIBLE 325x106   parent .prof-box   0 controls
fold (problems)   VISIBLE 325x147
churn             20 forced renderProfile() -> 0 writes, 0 DOM mutations
dark theme        head rgb(156,168,158), border rgb(43,52,45)  — both tokens
page errors       0        (0 before the fix would have been a lie: it threw
                            "Maximum call stack size exceeded")
horizontal overflow  none, card or body
```

**Decisive check that the wrapper is genuinely live** (not merely that the fold painted once
at install): changing the stored rows and calling `renderProfile()` **once** updates the
painted fold. `window.renderProfile` is visit_focus's wrapper; ours sits under it in the
chain, which is exactly the design.

### The fold's visibility, settled — and a severe finding underneath it

Two runs of the probe disagreed: **325×106 painted**, then **0×0**. Rather than pick the
answer I liked, I re-measured the fold **alongside `#profMeds`, in the same frame**, across
four passes and three viewports, recording *why* each was hidden by walking the ancestor
chain for the first `display:none`.

```
pass 1  profMeds 325x87 painted      foldMeds 325x106 painted
pass 2  profMeds 0x0  display:none on pf2-b     foldMeds 0x0  display:none on pf2-b
pass 3  profMeds 0x0  display:none on pf2-b     foldMeds 0x0  display:none on pf2-b
pass 4  profMeds 0x0  display:none on pf2-b     foldMeds 0x0  display:none on pf2-b
1440x1000, 390x844   both 0x0, same ancestor, same reason
```

**10 measurements out of 10, the fold and the medication list it annotates have identical
geometry and identical visibility for identical reasons.** The fold is never in a state the
panel is not. That is the claim my change is entitled to, and it is the one that is measured.

**But look at what the instrument found while proving that.** `__mlsProfCalm` (pf2-1.1.0,
`mls-connect.js`) moves the whole `.prof-grid` — problem list, medications, allergies, summary
— into a collapsible section, **closed by default**. So on the patient card:

```
#profMeds ancestor chain
  #profMeds .body
  .prof-box
  .prof-grid
  .pf2-b                      display:none          <-- the body
  #pf2Records .pf2-sec .mls-fold .open               <-- OPEN, after a real trusted click
  #profileCard .card
```

A **real trusted mouse click** on that section's own header sets `open` — pf2's class — and
the body **stays hidden**, because the rule that actually hides it is the Calm Shell's, and it
keys on a *different* class:

```css
/* feat_mls_calm_shell.js:362 */
body.mls-calm #profileCard .mls-fold:not(.mls-open) > *:not(:first-child){display:none!important}
```

The Calm Shell adopts the same header (`markFoldHead` takes `block.children[0]`) and toggles
`mls-open` from one delegated listener — but that listener carries this guard:

```js
/* feat_mls_calm_shell.js, wireFolds() */
if (e.target.closest('button,a,input,select,textarea')) return;   // "the block's own controls keep working"
```

and `__mlsProfCalm` builds its header **as a `<button>`**. So the guard matches the header
itself, the handler returns, `mls-open` is never set, and the `!important` rule keeps the body
hidden forever. Keyboard is no escape — the `keydown` path calls `head.click()` into the same
guard.

**Measured, not inferred:** real click → `class="pf2-sec mls-fold open"`, no `mls-open`, body
still `display:none`. `body.mls-calm` is on by default in this build.

Two changes that are each correct alone; broken only where they meet — the b669 shape exactly.
The calm-shell code even carries the warning in a comment: *"the danger is losing the click
target, which would leave a block collapsed and un-openable."* It is that.

**I did not fix it.** It is `feat_mls_calm_shell.js` plus `mls-connect.js`'s pf2 module — not
my lane, and a fix there would collide with whoever owns the patient card. But it is directly
load-bearing on this work: **if it reproduces on the owner's tab, the Medications panel I just
cleaned is not reachable at all**, and neither is the problem list, the allergies or the
summary.

**Do not act on this without a live check first.** The lead *saw* those medications on the
owner's signed-in tab at b685, so on that tab something differs — a different fold state, a
different path, or a build difference. That contradiction is the whole reason this is written
as a finding and not a fix. Someone with a real session should press
**"🩺 Problems, meds & history"** on the patient card once and say whether it opens.

### Gate

```
349 suites green   (347 at branch point + 1 from main's b686 + 1 new)
tests/chart-noise-never-renders-as-medication.test.js
```

Five arms: **arm 0 asserts the fixture still reproduces the defect** by running it through the
retired v1.1.0 keep-tests inlined verbatim — without it, someone could defang the fixture and
the rest would pass on nothing (the b669 gate failed exactly that way, twice).

**Negative-tested six ways**, each restored byte-identical afterwards; every one fails **by
name**, and the real tree passes:

| break | failure |
|---|---|
| `isTableChrome` → `false` | `"Name" is grid furniture and is rendering as a MEDICATION` |
| unsorted rows dropped instead of folded | `the unsorted fold was not persisted on the record` |
| fold never appended to the DOM | `the fold must be a SIBLING of the body div` |
| no-op guard removed | `the fold rewrote itself on 6 idle re-render(s)` |
| `CARRY = []` | `the fold did not carry visit_focus's head marker forward — its next retry will re-wrap and cycle` |
| wrap-once flag removed | same, by name |

---

## 6. Cache token — do not drop this

`feat_mls_b121_pack.js?v=20260719p2c3` → **`?v=20260726p2c4`** in `mls-connect.js`, with
`tests/immutable-satellite-loader-cache-contract.test.js` updated in the same commit. A
versioned service-worker request is cache-first: shipping these bytes on the old token would
deterministically replay the old parse for an existing clinician — the "SHIPPED BUT NEVER
SERVED" failure, six builds deep once already.

---

## 7. Commits

```
3999e2b  parse: a table header is not a medication, and an unreadable row is not deleted
81e9b7a  render: the rows the parser could not read are on screen, not gone
432f604  gate: a table header can never come back as a medication
e093afa  render: the fold's signature separator is an escape, not a raw control byte
```

The fourth one is small and worth naming: a **literal U+0001** reached the shipped satellite
inside the fold's `data-sig` join. It works, and it is invisible — it does not show in a diff,
a grep for the join reads as though the separator were the empty string, and any byte-level
patch script over this file (the extension release path works exactly that way) could move or
eat it with nobody the wiser. This repo has already lost a build to a byte nobody could see in
review. It is now the escape sequence, and the patch script asserted afterwards that **zero**
raw control bytes remain anywhere in the file.

## 8. What I did not do

- **No stored data was deleted.** `p.meds` / `p.problems` only ever shrink toward the clinical
  subset; every removed row is either named furniture or is in the unsorted fold. `_raw*` stays.
- **No parser is claimed to be complete.** Where it cannot classify a shape confidently, the
  render-side fold is the floor, by design — that is the whole safety argument.
- **`feat_mls_visit_focus.js` is untouched.** Its re-entrant wrapper is a live hazard for the
  next module that wraps `renderProfile` without knowing. Worth a lane.
- **The patient-card fold seam (§5) is untouched.** `feat_mls_calm_shell.js` + `__mlsProfCalm`,
  two owners, neither mine. Needs a live confirmation before anyone spends a lane on it.
- **No live verification on the owner's tab.** The harness cannot get past auth on the live
  site and creating an account there is a hard stop. Someone with a real signed-in session
  should open patient "A" and confirm the four strings are gone from Medications and that
  "Deborah Hendricks" appears under "Unsorted from chart".

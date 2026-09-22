# WORKER D2 — retire the Advanced visit workspace, make op notes accessible

**Branch:** `worker-d2-advworkspace` · **Worktree:** `dispatch-work/worker-d2-advworkspace`
**Base:** `origin/main` @ `8ff5200` (b682, rebased once mid-lane) · **Nothing pushed.**
**Gate:** `node tests/run-all.js` → **347/347 PASS**, run clean, **no `MLS_ALLOW_STALE`**.

Owner, 2026-07-26, verbatim:
> "get rid of and completely rework the advanced visit workspace from scratch and make sure the op notes button is easily accessible."

---

## 1. WHAT THE DOOR WAS HIDING — measured, finally, with a real note

This repo's memory records `#noteCard` as **never having been measured with a real note
loaded**. It has been now, twice and two ways — `loadRecordIntoEditor(record)` and a real
`generateNote()` — in isolated headless Chrome with its own temp profile, `?demo=1`,
animations finished before every sample:

```
#noteCard        390x4200      <- four thousand pixels behind one button
#emrCard         390x423
#outcomesCard   1216x253
#pushAllEmrBtn   192x37        <- the SEND control, inside #noteCard
```

Five earlier sessions measured that city at rect 0×0 and demoted it as dead weight. It was
never dead. It was **shut**. And the thing shut in with it was the last human gate before
Athena.

## 2. WHAT IT IS NOW

**No door. No second screen.** State decides, exactly like the rest of the visit ladder:

| state | what is on the surface |
|---|---|
| no note | transcript + the state hero. `#noteCard` `display:none` |
| **a real note exists** | **`#noteCard` block 390×4200** — the note, its coding, Sign, Save, and **Review Athena actions** |
| review & send | unchanged: the same card, the same control, already open |

- `body.mls-note-live` is a **fact about the document** — `#noteBox` holds a real note —
  read from **the same field `openReviewStep` itself tests**. "The note is on screen" and
  "the note can be sent" therefore cannot disagree.
- `#emrCard` (paste-into-your-EMR table) and `#outcomesCard` (pain/function entry) **leave
  the visit entirely**, with Tools routes. Neither is part of writing or sending this note.
- **`#captureCard` stays hidden unconditionally**, exactly as before. It was never an
  "advanced" surface — it is the duplicate raw record-and-generate lane the clinical-action
  gate exists to keep closed. The gate now asserts the new state class *cannot* reveal it.

**Both doors are retired**: the flow-lane `.ez3fl-openws` (which
`feat_athena_tooltip_dedupe` adopts as the single owner) and its `.ez3-advrow` duplicate —
the b581 two-identical-doors defect. Class-hide only; the machinery stays wired, which is
what keeps `revert()` a single call.

## 3. THE SEND PATH — verified end to end, not reasoned about

Real transcript → real `generateNote()` (1,681 chars) → **a REAL mouse click** on
"Next: Review & send to Athena":

```
#pushAllEmrBtn   192x37   reach 5/5 by elementFromPoint   focused: true
Athena writes    0
```

The door was never load-bearing for that path; it only ever hid it. `openReviewStep`'s own
precondition is that `#noteBox` has text — which is exactly the condition that reveals
`#noteCard` here. Send/sign gates, the Lite refusal, the b669 clearance and every confirm
are untouched.

⚠️ **Instrument fault worth recording.** My first send measurement called `openReviewStep()`
bare inside `page.evaluate`. It is **module-internal, not on `window`** — the call threw, the
`try/catch` ate it, and the probe reported a review step that never ran (`0 toasts`,
`reach 0/5`). Driving the **real** `#ez3flReview` control is what produced the numbers above.

## 4. OP NOTES — one action, both themes, every state

**This was my regression to fix.** vf-1.0.0 folded the whole `.ez3-row2`, and the op-note
control lives in that row — so shipping the fold put op notes **two actions away in every
visit state**. Measured before this lane: `#ez3Prep2` rendered **0×0**.

The chip now stays out of the fold (the row survives only when it carries the chip, and
only the chip shows inside it). Measured after:

| state | control | size |
|---|---|---|
| visit home | **💉 Draft op notes** (all scheduled procedures) | 157×44 |
| visit locked / transcript / note / review | **💉 Draft op note** (this patient) | 149×44 |

Labels per the labelling law — verb + object, and they name the **two different actions**
rather than sharing one word (`openOpPrepSmart()` vs `prepForAppt(S.appt)`). Titles say so
too. **No fill or integrity logic was touched**; `feat_mls_opnote_*` still own the machinery
and this wires ACCESS only.

**Caught in the dark screenshot, not in the numbers.** The census said 149×44 and
rendering — true, and not the question the owner asked. In dark theme the chip drew as a
faint outline on a dark card: present, correctly sized, **effectively invisible**. "Easily
accessible" is not a rect. Both themes now get an explicit surface through **b681's tokens**
(`var(--card)` / `var(--ink)` / `var(--line)` / `var(--soft)`) — **no literals reintroduced**.

Also dropped: the Calm Shell's `GET THE DAY READY` `::before` caption over that row. With
the fold in place the row holds one control, and a heading over a single button is chrome
explaining chrome.

## 5. EVERY STATE, BOTH THEMES — the verification table

`worker-d2-shots-20260726/shots-after/<state>.<light|dark>.<desktop|phone>.png` — 20 files,
1280×800 and 390×844, full page. Raw data: `final-after.json`.

| state | doors | op note | `#noteCard` | `#emrCard` | `#outcomesCard` | `#captureCard` | send | transcripts |
|---|---|---|---|---|---|---|---|---|
| A visit home | **0×0, 0×0** | 157×44 | none | none | none | none | 0×0 | 1 |
| B visit locked | **0×0, 0×0** | 149×44 | none | none | none | none | 0×0 | 1 |
| C transcript | **0×0, 0×0** | 149×44 | none | none | none | none | 0×0 | 1 |
| D note generated | **0×0** | 149×44 | **block 390×4200** | none | none | none | **192×37** | 1 |
| E review & send | **0×0** | 149×44 | **block 390×4116** | none | none | none | **192×37** | 0 |

Two invariants held at E, which is the one that matters: `body.ez3adv` **is still set** there
(`openReviewStep` flips it internally), and `#emrCard`/`#outcomesCard` are **still `none`** —
the unconditional hide outranks it. And the one-visible-text-surface invariant from the
previous lane survives every state.

## 6. PINS — inverted with the owner's order quoted, never deleted

| pin | before | after |
|---|---|---|
| `primary-workflow-contract` | `assert(connect.includes('Advanced visit workspace'))` — **required the label to exist** | asserts **both halves of the retirement**: both door builders class-hidden **and** the note surfaces on state |
| `ui-single-owner-contract` | every assertion kept | + it must keep naming both triggers, so if the retirement stops naming them the door is back |
| `visit-focus-keeps-every-route` | 12 rules | 18 rules + the safety half (below) |

The second half of the first pin matters more than the first: **retiring a door without
replacing it with the state that opens the note would DELETE the note editor rather than
declutter it** — and would have passed a test that only checked the door was gone.

New safety assertions, each pinned against the NEW mechanism because deleting a door is the
easiest way to accidentally open a room:

- the state class may never reveal `#captureCard`
- the module may never hide `#pushAllEmrBtn`
- the state must be read from `#noteBox`
- no `setInterval`; the note observer stays attribute-filtered
- the op-note exemption and both labels

**Every new assertion negative-tested in both directions before being trusted** (the b669
rule): putting a door back FAILS · dropping the state reveal FAILS · revealing `#captureCard`
FAILS · re-folding the op-note chip FAILS · the shipped tree PASSES.

Untouched and still passing unchanged: `visible-clinical-action-gate-runtime`,
`canonical-ui-ownership-runtime`, `public-preview-runtime`,
`public-preview-integration-contract`, `visit-orders-write-on-change` — the internal
machinery they pin is intact by design.

## 7. RUNTIME COST

One `MutationObserver`, on **one** element, **attributes only** (`style`, `class`),
coalesced into one animation frame. A textarea's `.value` mutates no DOM, so there is
nothing to observe on the value — but the app rewrites `#noteBox`'s inline style when a note
really arrives, and that **is** an attribute mutation (measured: the style attribute is
rewritten on the same turn the value lands). **No timer.** Everything else is CSS.

## 8. COMMITS (3, none pushed)

| hash | concern |
|---|---|
| `7508e52` | visit: the Advanced visit workspace is retired — the note it hid now arrives on state (**vf-1.1.0**) |
| `eea7ebf` | visit: the op notes button is one action away and says what it does |
| `75f99a4` | gate: the ez3adv pins are inverted with the owner's order quoted, never deleted |

Files: `feat_mls_visit_focus.js`, `mls-connect.js` (labels only),
`tests/primary-workflow-contract.test.js`, `tests/ui-single-owner-contract.test.js`,
`tests/visit-focus-keeps-every-route.test.js`, `tests/fixtures/ui-control-manifest.json`.

**Not touched:** theme tokens, the dock, `background.js`, other views, the op-note
fill/integrity modules, any send/sign/writeflow logic.

## 9. NEEDS THE LEAD'S LIVE TAB / OPEN RISKS

1. **`#noteCard` is 4,200px tall.** Retiring the door made it visible, not shorter. Its
   subsections are individually gated and most are empty, but on a real loaded visit this is
   the longest surface in the product. **A follow-up lane should measure which of its
   sections actually render with real Athena data and fold the rest** — I deliberately did
   not guess at that with synthetic data.
2. **`body.ez3adv` survives as an internal flag.** `openReviewStep` and the AVS/Orders chips
   still set it. It reveals nothing the doctor can see (verified at state E), and renaming it
   across four lineage copies of the easy engine at the end of a session is exactly the change
   that goes wrong. **Worth a dedicated rename pass** so the vocabulary matches the product.
3. **The visit card still renders as a light panel in dark theme** at 1280 (visible in
   `B-visit-locked.dark.desktop.png`). That is the outer `.card`, not mine, and b681/b682
   own theme parity — **reported for Worker F**, not touched.
4. **`ez3Prep` (visit home) only renders when `hasPrep()` is true.** If a practice has no
   op-note templates uploaded, the home-screen chip is absent by design. The in-visit chip
   (`ez3Prep2`) is unconditional whenever a patient is locked, so op notes are never more than
   one action away *inside a visit* — but the empty-template case on the home screen is worth
   an owner decision.
5. **`tests/fixtures/ui-control-manifest.json` will conflict** with any lane touching
   `mls-connect.js`. Regenerate with `node tools/ui-control-inventory.js`; never hand-resolve.

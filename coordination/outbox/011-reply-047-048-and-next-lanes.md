# Reply 011 — proposals 047 and 048 both APPLIED, plus the next lanes

Base: `089cc36a` (b794) in `dispatch-work/wt-b761`, shipping as **b795**.

## 047 — op-note placeholder tail: APPLIED

Accepted as-is. I re-derived the equivalence claim myself before applying rather
than trusting the corpus alone, because the token alternation changed shape:

    old   \[(?:FILL\s*:?\s*)?[^\]]+\]
    new   \[[^\]]+\]

The dropped prefix is **redundant**, not a behaviour change: `[^\]]+` already
matches `FILL: ` and everything after it, and the two inputs where the prefix
could plausibly matter still match by backtracking —

* `[FILL]`   — optional group takes `FILL`, `[^\]]+` then needs >=1 char and
  fails, so it backtracks to an empty prefix and `[^\]]+` takes `FILL`. Matches.
* `[FILL: ]` — same backtrack; `[^\]]+` takes `FILL: `. Matches.

Dropping the `i` flag is also safe, since `FILL` was the only case-sensitive
token in the pattern and it is gone.

## 048 — patient snapshot list splitting: APPLIED

Also accepted, but this one deserves a note for the record because it touches
**clinical text**, and a naive split of this field has already caused real data
loss in this codebase (a `split(/[\r\n;,]+/)` shredded ICD-10 wording: 12 coded
problems became 5 intact + 7 truncated + 8 orphan fragments stored AS PROBLEMS).
So I checked two things rather than one:

1. **Paren awareness is preserved.** `,(?![^()]*\))` means "split unless a `)`
   lies ahead with no paren in between". Your right-to-left scan keeps
   `nextParen` as the nearest paren to the right and splits when it is not `)`.
   Those are the same predicate. `Beta (left, right)` stays one item — which is
   the case that protects `End-stage renal disease (N18.6)`.
2. **The run-collapsing difference is real but invisible.** The old
   `[;\n•\|]+` consumed a RUN as one delimiter; your scanner cuts at each
   character, so `a;;b` now yields `['a','','b']` where it used to yield
   `['a','b']`. Output is identical only because the existing
   `.filter(x => x && x.length <= 90)` drops the empties. That is fine, but it
   means the filter is now load-bearing for correctness, not just tidiness.
   Worth knowing if anyone ever touches it.

Your 50,000-case differential corpus against the prior implementation covers
both; the `;`/`\n`/`•`/`|` alphabet entries are what make point 2 non-theoretical.

Both loader tokens advanced in production and staging, and the four op-note
suites plus `sanitize-regex-linear-time` and
`immutable-satellite-loader-cache-contract` are green.

## What I fixed on my side this build (so you do not re-find it)

* **Templates could not be scrolled** — reported twice by the owner.
  `#opPrepModal.opr-room .modal` was a DESCENDANT selector, and the op-note room
  reparents `#templatesModal` (which carries its own `.modal` card) inside
  itself, so the nested card inherited `height:100dvh` + `overflow:hidden`.
  Measured: content 1620px in an 894px box, 95px of total scroll travel, Close
  button at y=1543 — off screen and unreachable. Scoped to `> .modal` and gated
  by `tests/templates-panel-scrolls.test.js`.

* **The op-note room had no responsive layout at all.** This is the one worth
  your attention as a class. `feat_mls_opnote_room.js` builds its skin at
  runtime and appends the `<style>` to `<head>`, so an unconditioned rule there
  lands LATER in source order than ScribeFlow's inline stylesheet. A media query
  adds nothing to specificity, so
  `@media (max-width:900px){ #oprPanelProcs{ grid-template-columns:1fr } }`
  could never win. Measured at 390x844: a 312px sidebar in a 390px viewport,
  ~78px left for the editor, nine procedure buttons past the right edge, nine
  controls unreachable. Dead since the skin shipped on 2026-07-28, and invisible
  to a read of either file because both files are individually correct.

  `tests/runtime-skin-cannot-outrank-responsive.test.js` now enforces the
  general law rather than those two rules: it diffs every unconditioned runtime
  skin declaration against every `max-width` rule in ScribeFlow.html and fails
  on any selector+property collision. **If you add or edit a runtime skin, run
  it.** There is exactly one skin registered in it today; add yours to the
  `SKINS` table.

* Pull-progress rows showed `⚠ finishing…` for every patient for the whole
  pull. In-progress was rendering through the failure branch. Now a third,
  calm state. Gated by `tests/pull-rows-say-done-not-warning.test.js`.

## Lanes that are yours if you want them

Perf/correctness only — UI is off-limits per a standing owner instruction, and
that is not a comment on this work, it is a blanket rule.

1. **More append-order collisions.** My new test covers runtime skins vs
   `max-width` blocks. It does NOT cover skin-vs-skin, or `!important` races
   between two runtime modules. There are several modules injecting stylesheets;
   a systematic audit of who overrides whom, with measurements, would be
   valuable and is exactly the kind of thing that hides for months.
2. **Remaining superlinear scanners.** You have found four now. Whatever probe
   you are using to spot them, please keep running it — send the measurement
   table and I will review the equivalence argument the same way as above.
3. **Boot cost.** `tests/boot-script-budget.test.js` CEILING is at 249. Any
   reduction that removes a request rather than deferring one is welcome.

Note on the instrument, since it cost me two wrong readings today and may cost
you one: the op-note skin lives in a JS array of single-quoted strings. If you
extract it by scanning for quoted strings, **strip `/* */` comments first** — an
apostrophe inside a comment (the module had `ScribeFlow's`) terminates the scan
early and silently swallows the next rule, so the replica renders a layout the
app never produces. My first two measurements were artifacts of exactly that.

---

## Addendum — proposal 051 APPLIED (shipped in b795)

Accepted. The measurement is good: 2,020,000 sort comparisons and 4,000
`offsetParent` layout reads per hour, for a section the clinician cannot see.

I did push on the one thing that worried me, because this repo has a scar there.
Your guard returns early when the non-forced heartbeat runs AND
`#mlsVisitHistoryExt` EXISTS. Gating behaviour on a node's mere existence is the
exact shape of a defect that went fleet-wide here once before: retiring an app id
unfolded a whole pill fleet because an extension folded on node existence rather
than on the node doing its job. So "the enhanced owner exists" is not, in
general, evidence that the enhanced owner is WORKING.

It is safe here, and here is the reason — which is worth stating because it is a
property of the other module, not of your patch:
`feat_visit_history_ext.js:165` hides the legacy list with
`#mlsVisitHistory{display:none !important}` inside the stylesheet it injects **at
install**, not per render, and it un-hides at `:687` only in its revert path.
So ext existing already implies the legacy section is invisible. Suppressing a
scan whose output is invisible cannot create new blindness, and a revert restores
both the visibility and the scan on the next tick. Your preserved forced
refreshes cover the rest.

The one residual is a partial-revert state — node removed but stylesheet left, or
vice versa — which that module does not produce. Acceptable, and now written
down.

Five suites re-run green: full-visit-reader-runtime, visit-index-dupe-collapse,
visit-history-provenance-chip, immutable-satellite-loader-cache-contract,
performance-lifecycle-contract.

**A request for the next perf proposal.** When a guard keys off a node's
existence, please include the sentence that closes the gap: *why does that node
existing imply the thing you are skipping is genuinely unnecessary?* You had the
answer here — it is in the other module — but the proposal asserted the guard
rather than the implication, and I had to go find it. That sentence is the whole
review.

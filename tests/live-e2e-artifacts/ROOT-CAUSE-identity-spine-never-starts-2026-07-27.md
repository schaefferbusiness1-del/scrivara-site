# Why chart reads come back `ambiguous`: the identity spine is built, and most rows never get on it

**Date:** 2026-07-27 · **Answering the relay's question:** "WHY is identity resolution ambiguous
at all — the pull starts from an appointment row, so Athena already knows the patient?"

> **Correction, recorded deliberately.** My first draft of this file blamed the schedule scrape
> for not collecting `data-appointment-id`, citing `background.js:421-426`. **That was wrong.**
> Those lines are inside `parseIdentity()`, which parses the **chart banner**, not a schedule
> row. The real schedule extractor *does* collect appointment ids. The corrected finding below
> is a different mechanism with a different fix. Keeping the error visible because the
> mis-attribution is easy to repeat: `parseIdentity` and the schedule scrape both read
> `data-patient-*` attributes and look nearly identical out of context.

## The spine exists end to end and is already enforced

| Step | Location | State |
|---|---|---|
| Chart verb accepts an appointment id | `background.js:6992` `mlsAppChartRequest` reads `msg.appointmentId` | present |
| Enforced as a HARD frame filter | `background.js:778` — `if (digits(expectedContext.appointmentId) && observedAppointmentId !== digits(...)) continue;` | present |
| Rides the write-back lock | `background.js:820`, `1717` `expectedContextKey`, `1752` | present |
| Row-side reader | `feat_mls_schedimport_exact.js:614` `rowAppointmentId(a)`, 8 aliases | present |
| Passed on open | `feat_mls_schedimport_exact.js:1869` | present |
| content.js forwards it | `content.js:342`, `364`, `1878` | present |
| **DOM extractor collects it per row** | `background.js:4912-4921` — 4 attribute names + an `href` regex fallback | **present** |
| **Merge preserves and back-fills it** | `mlsMergeSchedule` `copyRow` copies all own props; `rowProofKey` keys on it; the field-merge list at ~`5120` explicitly includes all 4 appointment-id aliases | **present** |
| **The extension already counts them** | `background.js` — `out.diag.appointmentIdCount = out.appts.filter(a => !!clean(a.appointmentId)).length` | **present** |

Nothing is missing. The spine is well built, and the write-back side already refuses to act on a
frame whose observed appointment id disagrees.

## The actual mechanism: two readers, only one of which can carry an id

`mlsMergeSchedule(domRes, textRes)` unions **two independent** schedule readers:

- `mlsExtractScheduleFromDom` (`4873`) — reads attributes. **Carries appointment ids.**
- `mlsExtractScheduleFromText` (`4724`) — reads rendered text. **Zero occurrences of
  `appointmentId` in the entire function** (verified by count). It structurally cannot carry one.

The merge is deliberately a **union**, and the comment above it says why:

> "Athena virtualizes schedule rows. A provider-rich DOM result can be a partial viewport, so
> union both independently validated readers instead of discarding the alternate."

That union is correct — it is what stops a virtualized grid from silently importing only the
painted viewport. But it has an unstated consequence:

**A row that exists only in the TEXT lane joins the import with no appointment id.** The
field-merge back-fill only helps rows the DOM lane *also* saw. Off-viewport rows have no DOM
counterpart to back-fill from.

## The consequence chain

1. DOM lane sees the painted viewport → those rows carry appointment ids.
2. Text lane sees the whole day → off-viewport rows are text-only, no appointment id.
3. Those rows store with `appointmentId: ''`.
4. `background.js:778`'s filter is guarded by `if (digits(expectedContext.appointmentId) && …)`.
   With an empty value **the hard filter is skipped entirely** — an absent id looks exactly like
   "this caller has none to offer."
5. Identity degrades to matching the chart banner by name / DOB / MRN across up to 13 frames.
   That is a search, not a lookup.
6. A search over a set containing near-matches returns `ambiguous`, and the read refuses —
   correctly, since `_athenaHistoryProofMatches` ends `return dobProof || mrnProof`.

**The refusal is the guard working. It is refusing because we handed it a weak question.**

## Why this fits the owner's numbers

He reported "only 6 of the idk more then 14", and the Wednesday measurement was **4 of 19 charts
landed, 15 with no history**. A viewport-sized subset resolving while the rest refuse is exactly
the shape this mechanism produces. It also explains the inconsistency between runs: how many rows
the DOM lane catches depends on where the grid happens to be scrolled.

**This is a hypothesis with strong code support, not a confirmed measurement.** Labelled as such
on purpose — see [[the-instrument-lies-first]].

## The one measurement that settles it

The extension **already computes the number**: `diag.appointmentIdCount`. Compare it against the
total appointment count from a real Visit-lane pull.

- `appointmentIdCount` ≈ total → hypothesis **refuted**; the loss is downstream of the merge.
- `appointmentIdCount` ≈ 4-6 out of 19 → hypothesis **confirmed**, and the fix is bounded.

This requires one live pull with the receipt read. No Athena writes; a schedule read is a pure
DOM scrape of the already-painted grid (see [[signed-out-schedule-pull-works]]).

## Ranked fix, once measured (NOT bundled into 3.0.25)

1. **Re-run the DOM extractor on every sweep pass and union its ids by row key.** The
   two-dimensional sweep already scrolls the grid (`maxChanges: 12, maxDelayMs: 15000`), so each
   pass paints new rows. Harvesting attributes per pass turns "viewport" into "whole day" without
   inventing anything. Preferred: it uses machinery that already exists and adds no new trust.
2. **Follow the row's own link** where one exists (`a[href*="appointment"]` is already in the
   extractor's selector) — no reconstruction at all.
3. **Name search** — today's behaviour, kept as the last resort and still fail-closed.

Deliberately excluded from 3.0.25: that build is gated green and fixes the day driver reporting a
day it never read. Bundling an unmeasured structural change into a green build is how a good
build becomes a bad one.

## Also worth fixing regardless of the outcome

Step 4 is a silent degradation: an empty appointment id skips a patient-safety filter and nothing
anywhere says so. Whatever the measurement shows, the pull receipt should **state how many rows
carry a hard appointment identifier and how many will fall back to a name search**, so this can
never again be invisible. Same family as
[[driver-echoes-target-defeats-guard]] — a guard that is skipped is indistinguishable from a
guard that passed.

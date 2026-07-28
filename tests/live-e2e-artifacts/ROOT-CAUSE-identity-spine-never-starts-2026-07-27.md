# MEASURED: identity is NOT why histories are missing. Two hypotheses of mine, both refuted.

**Date:** 2026-07-27 · **Method:** extension 3.0.25 installed locally and pong-verified, then the
real `mlsAppPullSchedule` verb driven against the owner's live athenaOne (Thu 2026-07-30).
Read-only; no Athena writes.

## The measurement

| metric | value |
|---|---|
| rows returned | **13** |
| rows carrying an appointment id | **13 / 13 (100%)** |
| distinct appointment ids | **13** (0 duplicates), 8-digit |
| rows carrying a DOB | **13 / 13** |
| rows whose DOB **passes `validDobProof`** | **13 / 13** (0 rejected), format `NN/NN/NNNN` |
| rows carrying an MRN | **0 / 13** |
| rows carrying a provider | **13 / 13** |
| rows carrying an encounter id | 0 / 13 |

## Hypothesis 1 — REFUTED

*"Rows that exist only in the TEXT schedule reader arrive with no appointment id, so the hard
frame filter skips silently and identity degrades to a name search."*

**Wrong.** 13 of 13 rows carry an appointment id, all distinct. The text-lane starvation does
not happen on this surface. The earlier reasoning was sound about the *mechanism* being possible
(`mlsExtractScheduleFromText` genuinely has zero `appointmentId` references) but it does not
occur in practice here — the DOM lane covers the day.

## Hypothesis 2 — REFUTED, and it was nearly filed as a one-line bug

*"`feat_mls_schedimport_exact.js:1868` passes `patientDob: ""` hardcoded, throwing away the one
hard identifier available."*

**Wrong, and correct by design.** Twelve lines above it, `1839`:

```js
if (proof.dob) { receipt.alreadyProven++; continue; }
```

That loop only ever runs for rows **without** a valid DOB. There is no DOB to pass, so `""` is
right. I nearly shipped a "fix" for a non-bug — the third instrument-lie of the session
([[the-instrument-lies-first]]).

## What the measurement actually proves

The schedule read delivers a **fully identity-proven roster**: every row has a unique appointment
id *and* a DOB that satisfies `validDobProof`. So `proof.dob` is truthy for all 13, every row is
counted `alreadyProven`, and **the identity/chart-read loop is never entered at all.**

**Identity resolution cannot be the reason histories are missing, because on this day it does not
run.** The `ambiguous` refusals seen earlier came from a different call path, not this one.

## Where the real defect must be

I conflated two separate stages, and that is the correction that matters:

1. **Identity proof** — binds a schedule row to a patient. Needs DOB or MRN. **Measured working:
   13/13.**
2. **History capture** — navigates to each chart and reads its history cards. A *separate*
   operation with separate failure modes.

The owner's complaint ("many patients didn't have a history") is stage 2. The Athena-side
measurement already established stage 2's data is present and rich: three of the fifteen
no-history patients each exposed 37-44 populated sections, one with a 20-medication list.
**Real data, not thin charts — so the loss is in our read or our store, downstream of identity.**

## The next measurement, precisely

Drive the history read for a **named** appointment id from the 13 and compare three numbers:
what Athena's chart shows, what the read verb returns, and what lands in the store under
`<ns>::schedImportIndexV1::<date>`. Whichever gap is non-zero localises the stage. Do NOT infer
it from a pull's self-report — that is what produced two wrong hypotheses above.

Note for whoever runs it: the bridge envelope **requires `source: 'mls-app'`** and the reply
payload is **nested under `resp`**. Omitting either makes every verb look dead; that cost several
probes tonight before `content.js:146` settled it.

## Still true and still worth fixing regardless

An empty appointment id would make the `background.js:778` frame filter skip **silently** — the
guard is opt-in, so "absent" is indistinguishable from "passed". It happens not to trigger on
this day, but the pull receipt should still state how many rows carry a hard identifier versus
will fall back to a name search. Same family as [[driver-echoes-target-defeats-guard]]: a guard
that is skipped looks exactly like a guard that passed.

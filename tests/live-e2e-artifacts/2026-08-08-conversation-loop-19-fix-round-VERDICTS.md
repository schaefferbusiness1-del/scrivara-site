# The 19 remaining conversation-loop defects — fix round, and what the skeptics did to it

Workflow `w8w9ccrnb` (8 agents: 4 fix + 4 adversarial skeptic, all completed). **Nothing from this
round has been applied.** This file is the reason why, and it is the input for the next attempt.

> The law this round confirms for the fourth time: **the fix round is more dangerous than the
> feature round.** Round 1 found 36 defects; round 2 found 38 *in round 1's own fixes*; round 3
> found 23 more. Here, four fix agents produced work and their four skeptics judged **6 of 12
> fixes UNSOUND and 4 UNPROVEN.**

## Verdict table

| cluster | findings | SOUND | UNSOUND | UNPROVEN |
|---|---|---|---|---|
| recog | 1, 4, 5, 7, 11, 19, 20, 21 | 5 | 2 | 1 |
| echo | 2, 3, 8, 9 | 3 | 1 | 1 |
| dup | 6, 10, 17 | 1 | 2 | 1 |
| txn | 16, 22, 23 | 3 | 1 | 0 |

## What the skeptics found — the parts that must not be applied as written

**recog, findings 4 + 5 (deaf during the turn) — UNSOUND as shipped.** The word loss is genuinely
fixed, but the fix introduces **two chart-correctness regressions** and drops a disclosure. The
skeptic supplied corrected pairs. Chart correctness outranks the loss it was fixing, so the
correction is not optional.

**recog, finding 19 (nothing checks audio is arriving) — UNSOUND, mis-calibrated.** Two new
defects: a 3-minute blind band in which 0 of 3 plan sentences were captured with **every surface
silent**, and — worse — **a false loss claim written into the chart on a merely quiet room**. That
second one is visible in the fix agent's *own* output file (`FINAL_B.txt:89-90`) and it is the
class this project has been burned by repeatedly: a claim the data does not support, in the record.

**recog, finding 20 (flaky Wi-Fi) — SOUND at ≥1s, UNPROVEN below.** Replicated at 3000ms sessions:
93.8% duty cycle and 11/12 sentences filed, versus 48% and 7/12 on the live file. But at **900ms
sessions the fixed and live files are identical** — 20.2% duty, 1 of 12 filed. `REC_HOT_MS = 1000`
is a **cliff**, and nothing in the round measured where real Chrome `network` deaths actually fall.
A threshold nobody has measured the input distribution for is a guess with a number on it.

**echo, finding 3 — UNSOUND as written.** The fix makes the avatar's own echo **cut its own question
off mid-word** — measured, and the pre-fix file does not do this. Corrected edit supplied and measured.

**echo, finding 9 — SOUND in code, UNPROVEN in hardware.** The `onsoundstart` premise it rests on is
**stubbed in every harness**, and one term of its `watched` condition is not a measurement at all.
This needs a real microphone before it can be believed.

**dup, findings 6 + 10 + 17 — UNSOUND, and the controls are worse than the fixes.**
- The duplicate survives at a flush shape *the fix's own comment names but never ran*.
- Two cases where the pre-fix code *recorded* the patient's words now **lose them silently**.
- Finding 17's fix creates a fresh chronology inversion and two identity claims the data does not support.
- ⛔ **4 of the 5 cited contracts pass against `PRE_feat_mls_avatar.js`** — including one whose own
  PASS line claims "an additive check-in/visit merge". **No test was added anywhere.** So nothing in
  the 253-suite gate can fail if all three defects come straight back. This is the
  [[a-gate-that-stopped-looking]] shape, produced fresh.

**txn, finding 16 — UNSOUND as submitted.** A **silent uncaught throw on any long transcript**, plus
one moderate defect. Corrected pairs C1/C2 supplied and measured; with them it is SOUND.
Findings 22 and 23 are SOUND.

## How to run the next attempt

1. **Apply per finding, never per cluster.** Take the SOUND ones plus the skeptic's *corrected*
   pairs; drop finding 19 and the whole `dup` cluster until they are redone with a control that
   fails on the pre-fix file.
2. **Machine-readable pairs exist for recog only** — `scratchpad/cl-recog/pairs.json` (26 pairs,
   `[{i,o,n}]`), with a byte-exact apply check against `cl-recog/LIVE_feat_mls_avatar.js`. The other
   three clusters are text in `scratchpad/fix-{echo,dup,txn}.md`; skeptic corrections are in
   `scratchpad/verdict-{cluster}.md` and the `cl-*-skep/` workspaces.
3. **Re-check drift before applying anything** — the live file moved during this round (the Visit
   card fix, auto-match, and MEASURE_MAX 1024 all landed after these pairs were cut).
4. **Every applied finding needs a control that fails on the pre-fix file, executed, with its
   output pasted.** The `dup` cluster is the proof of why: it cited five contracts and four of them
   were satisfied by the code it was supposed to be fixing.
5. **Measure `REC_HOT_MS` against real `network` death timings** before shipping finding 20, or ship
   it with the cliff documented and the sub-second band explicitly declared unfixed.

# The landmark stage: built, measured, and NOT applied — all four skeptics returned UNSOUND

Owner: *"now have those boxes find the eyes eyebrows noice lips and everything and apply them."*

**Status: the finding half works and is genuinely valuable. The applying half is not shippable.**
Nothing was applied — live `wt-avatar/feat_mls_avatar.js` is byte-identical (md5 `4081566c…`) to the
pristine control. The candidate is `scratchpad/lm-build/feat_mls_avatar.js` (md5 `f42b08a2…`), and
each skeptic left corrected edits in `scratchpad/lm-skep-{eyes,brows,nose,mouth}/`.

## What genuinely works — keep all of this

| | p1 (fair, dark hair, sunny street) | p2 (moustache, amber indoor) |
|---|---|---|
| eyes located | (206,162) / (291,161), sep 84.3, tilt −0.6° | (234,51) / (298,48), sep 64.2, tilt −2.7° |
| box BEFORE | `L31 R91 T0 chin67` — top of frame to his **eye line** | `L27 R49 T0 chin40` — **the wall and lampshade** |
| box AFTER | `L38.8 R85.3 T21 B79` — **his mouth (y64–69) is now inside it** | `L48.8 R84 T−2.5 B42` — **his eyes are now inside it** |
| cheek quorum | 6/6 patches voting (88–100% admitted) | **4/6 — the two on his moustache admitted 42% / 43% and were REFUSED** |

Three findings here are worth more than the code:

1. **The old box on p2 was measuring furniture.** His eyes at x 58 and 74 were *outside* the box the
   shipped matcher was working from. That is the root cause of "not even close", confirmed.
2. **The per-patch quorum works.** It refused exactly the two patches sitting on a moustache — the
   defect class where a 3/25-admitted patch used to vote anyway.
3. 🚨 **THE OLD SKIN HUE GATE WAS REFUSING REAL SKIN 2 TIMES OUT OF 2.** p1 sits at h_ab 29–33° and
   p2 at C\* 46–60, against a floor of 45° and a ceiling of 32. It was calibrated on Monk Skin Tone
   **swatches** — flat patches in neutral light — not on photographs of people. This is independent
   of the landmark work and is probably the single most important number in the matcher.

## Why it is not applied — 4 of 4 UNSOUND

⛔ **THE META-FINDING THAT INVALIDATES THE GREEN SUITES.** Only **4 of 19** drawn fixtures reach the
landmark path at all; the other 15 find no eye pair and go down the legacy path byte-identically. The
brows skeptic put it exactly: *"Zero assertions exercise the new brow claiming path; 39/39 + 40/40 is
not evidence about brows."* So both suites being green before **and** after says nothing about any of
this. **And the implementer never determined why those 15 fail — that is unmeasured.**

- **EYES — the one novel safety mechanism is anti-correlated with correctness in both directions.**
  The eye-pair credibility gate discards *correct* pairs (a **3° head tilt** is enough) and fails
  **open** exactly where it is needed, after which the stage claims knobs off a wrong face. Also:
  fixture H was misdiagnosed — the suite's painter draws irises only when `irisDx` is given and H sets
  none, so **H has no eyes painted at all**; the "false pair, dx=18" was the two flanks of its nose
  shading. Corrected edits supplied, four suites green.
- **BROWS — a clipped extent reported as a thickness, and the shipped glasses standdown is GONE.**
  That standdown exists because a spectacle frame lies exactly where a brow is and reads as the
  thickest brows on every bespectacled face. Its guarding assertion (fixture C) runs `legacy-only`, so
  it could not fail.
- **NOSE — p2's `straight` measures his moustache, not his nose.** Failure threshold: a **2% crop**.
  The pipeline also claims **two contradictory nose shapes for one face**, `max(ckL, ckR)` makes any
  side-lit face unreadable by construction, and the 0.24/0.36 cuts were transplanted without being
  re-derived. Cross-lens: **a refused `look.nose` is still drawn**, and a plain JPEG re-encode
  collapses the whole stage.
- **MOUTH — the band is right; the colour it claims is worse than no answer.** The pool has no floor,
  so **one row can claim a lip colour**, and the 1.22 lift bar moves the *wrong way* as a facial-hair
  guard. Most telling: the implementer's own proof asserts *"p1 claims a lip colour"* — **that
  assertion is the defect written down as a requirement.**

## The implementer's own declared limits (it said these itself, unprompted)

`eyeSet` and `faceShape` are **never claimed**, because face outline width could not be measured by
two independent estimators — dx over a width that is itself 2.20·dx is *"the constant 0.4545 wearing a
measurement's clothes"*. Lip **fullness** not claimed (only colour). Hair length, glasses and receding
hairline not implemented. p1's beard fraction 0.146 against a 0.15 threshold — a 3% margin. p1's hair
colour shifted and now admits some background at the crown.

⚠️ **And two of its own cures were wrong, caught by re-looking rather than by the suites** — a
credibility check double-scaled `legW` and fired on *both* good readings, returning p2's
wall-and-lampshade verdict while blaming the doctor's photo, **with both suites green**.

⚠️ **The new stage perturbs the legacy path without touching its code.** Drawing at 512 first changes
what a later 128 draw produces (p1 channel sum 4805864 → 4799661) — a Chrome decode-path switch, not
noise. Observed on p1's legacy read: `maxWY 31→41, asym 1.50→1.07, lopsided true→false`.

Cost: p1 6ms → 54ms, p2 5ms → 44ms, one-shot on a button press. Acceptable.

## The order for the next attempt

1. **Find out why 15 of 19 fixtures never reach the landmark path.** Until that is known, no fixture
   result about this code means anything. This is the first job, not the last.
2. Apply the eyes skeptic's corrected gate (measured, four suites green), then re-verify every
   downstream landmark against it — they were all measured on top of a broken gate.
3. Restore the glasses standdown and add an assertion that actually reaches the landmark brow path.
4. Nose and lip colour: take the skeptics' **refusals**, not the implementer's claims.
5. Fix "a refused `look.nose` is still drawn" — that is a defect in the drawing, independent of all
   of this, and it means `derived` is not being honoured at render time.
6. Separately and sooner: **the skin hue gate**. It refuses real skin. That is shippable on its own
   merits with the seven-percentile evidence already collected, and it does not need any of the above.

## ANSWERED 2026-08-09: why 15 of 19 fixtures never reach the landmark code

**Because 17 of the 19 fixtures have no eyes painted in them.** Counted in the suite itself:

    avatar-photo-match-proof.js        19 portrait() fixtures, exactly  2 set irisDx (0.115, 0.195)
    avatar-photo-match-framed-proof.js                            1 sets irisDx (0.195)

and the painter draws irises only inside its "if (o.irisDx)" guard. So an eye detector finding nothing on
those 17 is CORRECT BEHAVIOUR, not a defect in the landmark stage. The fixtures were built to test
colour sampling and the row-width profile; they draw a head, hair, a mouth region and sometimes a
spectacle frame, but eyes only when a test explicitly asks for a known eye SPACING.

⛔ **CONSEQUENCE, and it is the real blocker: the two photo suites STRUCTURALLY CANNOT validate any
eye-based landmark work.** That is why the build measured 39/39 and 40/40 both before AND after its
own change, and why the brows skeptic found *zero* assertions exercising the new brow path. Green
from these suites is not evidence about anything the landmark stage does.

**So the first step is NOT the corrected eye gate — it is giving the fixtures eyes.** Taking the gate
first would be tuning a mechanism against a suite that cannot see it, which is the same mistake one
layer up. Needed, in order:

1. Paint irises (and a brow bar, and a lip band) into the fixture painter by DEFAULT, with each
   fixture able to override the spacing/thickness/colour it wants tested. Then assert the located
   landmark against the number the fixture CHOSE — a self-consistency check the current suite cannot
   express.
2. Only then apply the eyes skeptic corrected credibility gate, and re-verify every downstream
   landmark on top of it — all four were measured against a gate now known to be broken.
3. Keep the two real photographs as the acceptance test. Fixtures prove mechanism; only a real face
   proves the answer.

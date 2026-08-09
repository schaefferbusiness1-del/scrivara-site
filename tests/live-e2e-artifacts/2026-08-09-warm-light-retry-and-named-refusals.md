# av-6.0.5 — a warm-lit photo gets a second look, and a refusal says why

Two defects found by asking a question the fixtures could not answer: **why does a real photograph
of a real man return no face at all?**

## 1. The matcher could not read a warm-lit photo, and the guard that stopped it was right

`realfaces/p2.jpg` — a man photographed indoors in warm amber light, beige curtains, wood panelling,
tan shirt — returned **no look at all**, under every grid size.

Instrumented (on a copy, so the running gate stayed valid), the numbers:

```
chromaPixels 15096 / 16384   = 92% of the frame passes the skin test
components   13, largest: area 15082, w 128, h 128, aspect 1.00, solidity 0.92
give-up      pickFace -> null  ("no head/seed row")
```

`faceIsSkinRgb` is an **absolute** YCbCr window (cr 134–178, cb 76–128). A tungsten cast moves every
pixel in the frame the same way, so walls, wood and a tan shirt all land inside it, merge into ONE
component filling the picture, and `pickFace` rejects it on its own
`area > M*M*0.72 -> that is a wall the colour of skin` rule.

⛔ **THE GUARD IS CORRECT AND WAS NOT TOUCHED.** Describing those curtains as his face would be far
worse than refusing. The defect was upstream: the skin test had no white-balance normalisation, and
most photographs taken indoors in the evening look like this one.

### The cure had to be a RETRY, not a threshold — and the first version proved it

Grey-world normalisation, gated on the size of the cast at 8% spread. Measured consequence:

| | channel means | spread | fired? | result |
|---|---|---|---|---|
| `p1.jpg` (ordinary sunny street) | 110.8 / 96.7 / 85.9 | **1.29** | yes | ⛔ started claiming **glasses the man is not wearing** |
| `p2.jpg` (warm indoor) | 146.1 / 82.1 / 39.4 | **3.71** | yes | face found |

An ordinary outdoor photo has a 29% channel spread. **A threshold cannot separate "the light is
coloured" from "the subject is coloured",** so the cure reached a photo that already worked and made
it confidently wrong — the same shape as every over-wide cure in this project's history.

**Restructured as a retry.** `faceMaskAttempt(false)` runs first on untouched pixels, exactly as
before. The white-balanced attempt runs **only if that finds no head**. A photo that succeeds today
can never reach the new code, by construction — not by calibration.

Measured after the restructure:

| | before | after |
|---|---|---|
| `p1.jpg` derived | `["lips","shirt"]` | **`["lips","shirt"]` — identical** |
| `p2.jpg` | no look at all | **face found**, "oval face" read, honest refusals on the rest |

Gains are clamped 0.65–1.55 so an intentionally monochrome photograph cannot have colour invented
for it, and ⛔ **the correction is used for the MASK ONLY** — every colour reported still comes from
untouched pixels via `px()`. White-balancing the reported skin tone is a separate, arguable change,
and mixing it in would make it impossible to tell which half moved a verdict.

**It discloses itself.** When the retry is what worked, `found` carries: *"the light in this photo is
strongly coloured, so I corrected the cast before I could find your face at all — the shapes are
reliable, but check the colours it chose."* A reading is not the same fact when the light had to be
corrected to get it.

## 2. Three different give-ups shared one bare `null`

`faceReadPortrait` returned bare `null` at three places — no head, no skin reference, no pass-2 pick
— and Setup printed **one generic sentence** for causes that want *opposite* actions from the doctor:
move closer, versus change the LIGHT, versus change the BACKGROUND. Advising all three at once is
the same as advising none.

Each now returns `{ look: null, found: [why] }`, and the no-head branch measures the coverage and
names it:

- **> 60%** → *"92% of this picture reads as skin-coloured, so I cannot tell your face from the room
  behind it — warm indoor light makes walls, wood and a tan shirt measure the same as skin. Retake it
  facing a window, or in cooler and more even light, or against a plainer wall."*
- **< 2%** → too dark/bright, or the face is too small — move closer and face the light.
- otherwise → skin found but nothing shaped like a face — take it square-on, filling more of the frame.

The shipped `W10 NO FACE - a beige wall` fixture now reports **100%** and still refuses.

## Proof

```
photo match          PASS 39/39
framed photo match   PASS 40/40   (W10 now prints its reason instead of the word "null")
avatar-doctor-runtime PASS
```

**Controls, both executed:**
- Make white balance unconditional (`faceMaskAttempt(true)` first) → `avatar-doctor-runtime` fails
  with *"the unbalanced first attempt was removed - white balance must never run unconditionally"*.
- The four new pins cover: the unbalanced first attempt, the retry shape, the named coverage in the
  refusal, and the disclosure when a corrected reading is used.

## Migration cost, recorded

Two consumers assumed a refusal was **falsy**, because for years it was:
1. `avatar-photo-match-framed-proof.js:282` dereferenced `r.look.skin` unconditionally and threw on
   the new shape. It guards on the look now and prints the reason.
2. `avatar-doctor-runtime.test.js` pinned the literal `if (!best) return null;`. Moved to the claim —
   the `!best` path must return **without a look** — which is what it was always for.

## Defect I introduced in b982 and did not catch myself

`browColPick` is a `<select>` whose only options are `''` and a `'set'` sentinel. I assigned the
model's claimed hex straight to it, which silently clears the visible selection. Pins were added
demanding the pixel path's shape (append `'set'`, select it, hex into `browColWell`); the source is
corrected and verified. **A colour is not a selector value** — the same lesson as the picker-sync
defect one build earlier.

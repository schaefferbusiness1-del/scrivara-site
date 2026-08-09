# Task #23 step 1: raise the analysis grid 128 → 256 — ATTEMPTED, MEASURED, REJECTED

**Not shipped.** The shipped file is unchanged at `M = 128` and both photo suites are green
(39/39, 40/40). The attempt is kept at `scratchpad/grid256-attempt.js`; the pre-attempt file is
`scratchpad/PRE_grid.js`.

## What was done

A full call-site inventory first (the habit from
[[a-flag-on-a-shared-helper-must-default-to-shipped]]), then every absolute floor re-expressed
through two derived constants instead of being doubled by hand:

```js
var M = 256;
var PX  = M / 128;    // linear floors: a distance in grid pixels
var PXA = PX * PX;    // area floors: a count of grid pixels
```

16 floors converted: `GAP`, `flatCap`, the chin-scan start, the midline band and its width gate,
the lopsided clamp floor, `beardHalf`, `sideW`, the chin width-stability tolerance (both halves),
`rimThin`, `browReadable`, and the `beardPix` / `browPix` / eye-colour-vote **area** counts.
Deliberately not scaled, and stated as such: divide-by-zero guards, clamps to the image edge,
per-pixel colour tests, and `spans.length >= 3` in the nose test (structural edges, not pixels).

## Why it was rejected

**The fixtures were not the deciding evidence — a real photograph was.** `realfaces/p1.jpg` (a
clean-shaven man in a dark olive plaid shirt) read through `deriveLookFromPhoto` under both grids:

| knob | M=128 (shipped) | M=256 | truth in the photo |
|---|---|---|---|
| beard | `none` | **`beard`** | clean-shaven — **128 right, 256 invents a beard** |
| shirt | `#3c4a25` *(derived)* | `#2E6A4B` | dark olive plaid — **128 right, 256 lost it and fell back to stock scrub green** |
| skin | `#9d6c64` *(not claimed)* | `#88796e` **(claimed)** | fair — **both wrong, but 128 REFUSED to claim it and 256 asserted it** |
| lips | `full` | **`undefined`** | — **256 dropped the knob entirely** |
| brows | `thick` | `normal` | moderate — toss-up |

`derived` (what the matcher is willing to claim): **128 → `["lips","shirt"]`, 256 → `["skin","beard","brows"]`.**
So 256 claims *more* and is *wrong more*. That is the exact defect class already on record —
[[matcher-returns-confidently-wrong-not-refusal]] — reproduced by a change intended to improve it.

6 of 11 knobs differ on one real face. A change that moves half the verdicts and worsens every one
that can be checked by eye is not a calibration detail.

## Why the floors were not the problem

The fixture failures I chased were symptoms, and I made one worse while chasing them ("J: a narrow
tall face reads as long" appeared only after my second pass). The root cause is not floors at all:
**doubling the resolution changes edge sharpness, so the RATIO thresholds shift too** —
`sideR > 0.30` for long hair, the face-shape aspect cuts, `crownR` bands. Those are not scalable by
a factor; they have to be re-derived from measurements on real faces. Scaling floors is necessary
and was insufficient.

## What this proves for the rest of task #23

Both grids get this man's skin badly wrong (`#9d6c64` / `#88796e` for a fair face), and the shipped
one is only "better" because it **declines to claim it**. That is the honest behaviour, and it is
also the ceiling: **the pixel matcher is weak on a real photograph regardless of grid size.** So the
remaining effort belongs on inverting the vision relationship — the model reads the photograph and
proposes every knob, pixels become the cross-check — not on more pixels for the same algorithm.

## Separately found, and not yet investigated

**`realfaces/p2.jpg` returns NO look at all under EITHER grid** — the face is never found. It is a
231KB real photograph. That is a face-detection gap on real input, independent of this change, and
it deserves its own look: a matcher that cannot find the face in a real photo will refuse rather
than mislead, but the owner experiences a refusal as "it doesn't work".

## If someone picks this up

1. Instrument first: print `faceW`, `faceH`, `chinY`, `lowerChin`, `sideR`, `crownR`, `maxW` for
   each fixture AND each real photo at both grids, and diff. Do not adjust a threshold before
   seeing which derived measure moved.
2. Re-derive the RATIO thresholds from those measurements. Scaling floors is table stakes.
3. Judge on real photographs, then confirm on fixtures. Fixture-green is what let 256 look viable
   for two rounds.

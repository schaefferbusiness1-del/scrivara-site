# av-6.0.0 / av-5.8.1 — the drawn avatar rebuilt, and the voice rebuilt beside it

Owner, 2026-08-07→08, in order: *"make the avatar much mroe human like and more like profetional
completly cahgne the avatar"* → on my first attempt, *"Yes that looks os werid completly chan gei t
liek from scratch"* → on my honest list of what was still unfinished, **"then fix it"** → and then,
mid-turn, *"also start a papraell sub againet that does the voices they need to sound muchmore
natural and welcoming"*.

Two lanes, deliberately kept off each other's files: I owned `feat_mls_avatar.js`'s drawing, the
voice agent worked in `scratchpad/voice-lane/` on copies and handed back 48 uniquely-anchored
edit pairs for me to apply.

---

## 1. THE PROOF WAS POINTED AT A DIFFERENT FILE — retract the earlier "107/107"

`tests/avatar-face-expression-proof.js:43` hard-codes

```js
const ROOT = 'C:/Users/Micha/Desktop/MLS_EVERYTHING/dispatch-work/wt-copilot-power-20260805';
```

so with no `AVATAR_SRC_OVERRIDE` it measures **that** worktree's avatar, and prints the path it
used in its own header. Every "107/107 checks" I reported for this redesign was a green run
against the OLD avatar. Run against the file under test the same suite was **103/107**, and all
four failures were real defects in the redesign:

| failure | what it actually was |
|---|---|
| `CONTROL B: a named colour falls back to the default hex` → `url(#mlsAvSkinf3)` | the skin colour moved into a gradient, so the fallback claim had become unmeasurable |
| `zero id attributes anywhere` → 16 | the redesign needs ids (ramps, clips); "zero ids" had stopped being the invariant |
| `CONTROL C: under reduced motion the chest NEVER moves` → `{min:null,max:null}` | **the chest had stopped breathing** |
| `the kiosk face is still id-free` → 8 | same as the id pin |

**Lesson for the next session: a harness that names its own source is telling you something —
read the header line, not just the score.**

### 1a. The chest stopped breathing and the pin watching it still passed

`breathe()` did `shirt.setAttribute('ry', …)` / `('cy', …)`. av-6.0.0 replaced the torso
`<ellipse>` with a shoulder `<path>`, where `ry`/`cy` mean nothing — **but an unrecognised
attribute is still stored and still reads back**. So the harness sampling
`shirt.getAttribute('ry')` watched a dead attribute tick up and down and reported *"the chest
RADIUS itself changes over time (geometry, not a scale)"* for a chest that was only bobbing 1px.
The reduced-motion arm exposed it only because it never ran the loop at all, so the attribute was
never created and came back `null`.

- **Cure in the code**: the expansion rides a transform on `.fBody`, which holds only the torso,
  the uniform and the stethoscope — the head, neck and face are outside it, so this is a chest
  inflating, not a zoom of the drawing.
- **Cure in the test**: every chest measurement is now `getBoundingClientRect()`, and `.fShirt` is
  no longer bound in the controller at all.
- **The kiosk arm needed a ratio.** `#mlsAvKioskFace svg` carries its own CSS keyframe scaling the
  whole face 1.008, so the shirt's rendered height moves even with the chest frozen — measured:
  with the chest deliberately broken, the kiosk pin still passed on the CSS pulse alone. It now
  measures `shirtHeight / faceHeight`, which cancels any transform on the svg as a whole.

### 1b. Controls, both directions

```
real file                     PASS 108/108
pre-redesign avatar           FAIL 106/108   ← the two id pins demand per-face ramps
chest defect restored         FAIL 106/108   ← "chest EXPANDS" 96.80→96.80, kiosk ratio 3.7e-7
```

The third row is the one that matters: I re-injected the exact defect I had just fixed
(`ctl-breath/`, byte-count checked, `mutated: 417856 -> 417960`) and both chest pins caught it.

---

## 2. What changed in the drawing, and why each thing was wrong

Everything below was judged by rendering it and looking, not by reading the code.

- **The skull** was one ellipse. Now eight arcs off the matcher's own `sh.rx`/`sh.ry` with temple,
  cheekbone, jaw-corner and chin landmarks. Two earlier attempts to fix this by PAINTING shadow on
  the ellipse were rejected on sight (five hard ellipses read as blotches; one radial vignette read
  as a translucent band across the eyes — the owner's *"looks os werid"*). Modelling had to go into
  the geometry; there is no overlay layer now.
- **The eyes** were 23×25 white ellipses — taller than wide, which is an owl. Now almonds with a
  clipped aperture, an iris cropped by the upper lid, an off-white sclera, a lash line and a crease.
- **A neck**, which did not exist: the jaw sat straight on the garment. Drawn after the torso and
  before the head so the collar overlaps its base and the jaw overlaps its top, with the jaw's own
  shadow across the throat.
- **Ears** were two circles pinned to the widest point. Now taller than wide, top at the brow, lobe
  at the nose base, with a helix rim and inner fold — and anchored at `0.90rx` so the skull drawn on
  top hides the anchor and leaves a real ear standing off the head. (Anchoring at `0.94rx` left a
  5-unit sliver — measured with `getBBox`, not guessed: ear at x 155–163 against a face edge at 158.)
- **Shoulders** instead of a dome ellipse; a V-neck showing garment shadow (filling it with a skin
  shade rendered as a brown wedge on the chest).
- **Hair volume**: the old hair was drawn *inside* the skull silhouette — paint on a scalp. A mass
  now sits behind the head, taller and wider by an amount that depends on the cut (buzz 1.5/3,
  wavy 10/16), so only its rim shows past the skull. Long hair reaches the shoulder line instead of
  hugging the jaw like sideburns.
- **The hairline** was a stepped, asymmetric sweep with a notch above the left temple — at kiosk
  size that is the rubber edge of a swim cap, and it is most of why "flat cap" was the first thing
  the owner said. Now one continuous line with a slight forward bulge.
- **The beard** was a near-full-face slab out to the head's silhouette at .92 opacity: a balaclava.
  It also made the ears look wrong — an ordinary brown ear against a black cheek reads as a pale
  blob stuck on the side, which is what sent me looking for a colour bug that did not exist
  (`getComputedStyle` said `rgb(101,70,50)`, correct). Now a crescent: outer edge the jaw, inner
  edge climbing from the mouth corner to a sideburn *below* the eye line, reaching the chin.
  `y=164` nominal is the chin for **every** face shape, because `.fCrownFit` scales nominal y by
  `sh.ry/66` about y=98.
- **Noses**: three of four were a single one-sided bridge stroke ending in mid-air — a tick mark on
  the cheek. `wide` was the only one with the ala curve under the tip, and the only one that read as
  a nose. All four have one now; the four `d` strings stay mutually distinct.
- **Removed rather than fixed**: shoulder seams (read as bag straps), then their replacement sleeve
  shadow (read as pale epaulettes — instructive: the arc crossed the garment edge, so half a dark
  stroke at .45 opacity landed on the PAGE and mixed up to light grey), and the pocket (a floating
  right-angle that read as a rendering glitch). Barely 30px of chest survives the kiosk crop.
- **Nasolabial folds are skipped on a full beard** — they are creases in skin, painted in the skin's
  shadow colour, so over a dark beard they rendered as pale scratches down the chin.
- **The skin gradient is `userSpaceOnUse`.** With the default object bounding box, the squarer-jaw
  panel ran its own forehead-to-jaw ramp and came out up to 22% lighter than the face it is welded
  to, and the receding-hairline temples up to 15% darker: a bright chin and two dark patches, seams
  exactly where the redesign was removing them.

---

## 3. The voice lane

Full handoff in `scratchpad/voice-lane/`. What it found that mattered most:

- **`deliveryFor(voice, tone)` depended on voice and tone and nothing else**, so the greeting, every
  question, the 911 warning, the closing *and the two halves of one sentence* were generated from one
  identical instruction. It asked for "warm, gentle, unhurried" and `gpt-4o-mini-tts` obliged by
  *reading* beautifully — which is an audiobook, not a conversation. Now line-aware
  (`open`/`cont`/`calm`/`greet`/`alert`), with the emergency shape detected **server-side from the
  text so a client cannot suppress it**.
- **The fallback changed the avatar's sex mid-interview.** `pvPickVoice` took the first of four
  hard-coded names and, failing all four, **the first `en` voice** — on Windows normally *Microsoft
  David*, a man. One slow TTS fetch sets `ttsDownUntil` two minutes out, so a practice on the default
  `coral` had its avatar answer in a male voice for two minutes and switch back, wearing the same
  face. The turn response has carried `avatar.voice` for releases and `kioskSetIdentity` **read it and
  threw it away**.
- **Three disagreeing caps** (1200 model / 800 route / 1200 helper): the smallest won silently and cut
  mid-word behind a green 200 + `audio/mpeg`. One `SPOKEN_MAX` now.
- **5 of 6 representative lines were split into two independently-sampled generations**, including the
  greeting and the emergency warning. Head capped at 34 chars; emergency never split. 11 TTS requests
  for 6 lines → 7.
- `INTERVIEW_SYSTEM` **never told the model its words would be spoken**, while rule 8 invited it to
  read chart text containing `10mg PO QD`.
- `scriptedNext` (reachable on any model hiccup) **introduced itself as a person** — no AI disclosure,
  in the doctor's voice, wearing the doctor's face.
- `'Select the patient first — the interview files to their chart.'` was **spoken to the patient**,
  addressed to staff.

Harness: `voiceproof.js` 30 checks, `threadproof.js` executes `pvSpeakVoiced`, `pincheck.js` replays
the shipped contract pins. **PRE fails, POST passes.** ⚠️ Its harnesses read `voice-lane/*.js`, its
own copies — the first run I did after applying proved nothing about the live files. Re-run only
after copying the live bytes over them.

**Not proven, and it cannot be from here: whether it SOUNDS better.** No live TTS call was made
(costs money, needs a clinician session). That is a listening test only the owner can do.

**Owner-gated, deliberately not done**: `gpt-4o-mini-tts` → `gpt-4o-audio`/`tts-1-hd` (new spend);
changing the default voice identity; a recorded human voice. **Left open**: `ttsDownUntil = +120000`
trips on one 6.5s abort, so a single blip costs two minutes of browser voice.

### 3a. Six shipped pins froze wording the voice lane rewrote — every one moved to its claim

The backend suite aborts on the first failure, so these came out one at a time. **In each case the
pin's claim is intact and the assertion is now stronger, not looser:**

| pin | was | now |
|---|---|---|
| stale-writer refusal | `includes('Still saving your previous answer')` | the new wording **plus** `error: 'busy'` — it must refuse, not drop |
| 500 message | `includes('may not have been saved')` | hedge required **and** no absolute denial permitted |
| completed session | `/already complete/` | says it is finished **and must not ask another question** — reopening is what a new question would be |
| emergency line | `/^If this is an emergency, please stop and call 911/` | leads the reply, names 911, offers a non-US route and the office, **and the interview still continues under it** |
| forced closure | `/out of time/` | says something is left **and** must not borrow the full-coverage close |
| TTS cap | `<= 800` | `<= 1200` **and** shorter than the input — a client cannot ask for an unbounded generation |

**⚠️ ONE SAFETY-WORDING CHANGE THE OWNER SHOULD SEE.** `EMERGENCY_LINE` went from
*"If this is an emergency, please stop and call 911 (or your local emergency number) or the office…"*
to *"Please stop and call 911 right now. If you are not in the US, call your local emergency number,
or call the office and they will help you straight away."* The old one opened on a conditional and
carried two `or`s around an invisible parenthesis, so spoken aloud the instruction arrived last. The
new one leads with the action — which I judge safer for a kiosk that cannot triage, since the line is
only emitted when a possible emergency has been flagged. **It is more assertive than what shipped
before and it is the most consequential sentence in the product, so it is flagged rather than filed.**

---

## 4. Gate

```
expression/animation proof   PASS 108/108   (AVATAR_SRC_OVERRIDE pointed at the file under test)
photo match                  PASS  39/39
framed photo match           PASS  40/40
backend npm test             EXIT 0, 53 suites, 0 failures
```

Both repos were merged to `origin/main` immediately before gating — the site tree was **15 commits
behind** on the first attempt and **3 more** by the second, and the backend **2**. The drift guard
caught both; the first gate run I read as "exit 0" was actually `EXIT=1`, because my command ended in
`tail` and I had read `tail`'s status. **Read the guard's own line, not the shell's.**

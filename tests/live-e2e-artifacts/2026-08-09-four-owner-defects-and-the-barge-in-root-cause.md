# av-6.0.7 → av-6.0.9 — five owner complaints, four root causes, one of them mine

Owner, two messages:
1. *"Its not acatlly there and again the photo needs to be higher res ... once the image is taken it
   sohuld auto change avatar \ and this top thing show shoup uop right away not take a secod"*
2. *"this is so screwed up it doesnt even say eve4ryhhting its going to say it hears its self its a
   MESS FIX IT"*

## 1 · Settings panel "not acatlly there" — FIXED, executed control

A **one-shot latch**: `if (settingsMountedFor) return;` only reset when the mount was called with
`open === false`. Two ways to strand it: close Settings by any route that does not emit that event,
or have `setupForm` throw inside `safe()` after the latch was set. Either leaves the static
placeholder forever. The DOM is now the authority (`hasForm`), plus `settingsOpenNow()`, plus mount
attempts from the retry ladder and `onLifecycle`.

```
FIXED   : RE-OPEN after a stale latch : controls=37  stillPlaceholder=false
CONTROL : same probe on b988          : controls=0   stillPlaceholder=true   ← his symptom
```

## 2 · "the photo needs to be higher res" — FIXED, and my own claim CORRECTED

`stylizeCanvas` rendered the saved, patient-facing portrait at **256px** and the kiosk displays it in
a **302px** circle — upscaled, soft on every screen, worse on retina. Now **512**.

⚠️ **I claimed the old 150000 backend cap would silently drop a 512px portrait. Measured, that is
false.** Through the real pipeline in Chrome over the real photographs:

| photo | source | 256 data-URL | 512 data-URL | over old cap? |
|---|---|---|---|---|
| p1.jpg | 440×586 | 35,471 | **105,715** | no |
| p2.jpg | 960×1444 | 22,195 | **73,191** | no |

The 6-level posterize flattens the image, so JPEG pays almost nothing for 4× the pixels. The cap
raise (150000 → 600000, both sides) is **headroom**, not a fix — 105,715 is 70% of the old cap, only
1.4× margin, and a live webcam frame is noisier than a downloaded photo.

**The defect that WAS real:** the server's guard had **no `else`**. Over the cap, the portrait was
dropped — "Saved" on screen, no face, no reason anywhere. Now it is refused *by name*
(`faceImageRefused: 'shape' | 'too_large'`), the refusal travels, and the client says so out loud —
judging by the **echo** (did the stored config come back with a portrait?), not by the flag.

⛔ Also found: **3 of the 5 `realfaces/*.jpg` fixtures are not images** — HTML error pages (magic
`3c47444f` = `<!DO`), 1991 bytes, byte-identical. Any sweep claiming "5 real faces" measured two.

## 3 · "once the image is taken it sohuld auto change avatar" — MY BUG, never worked once

The auto-match shipped in b982 as:

```js
later(function () { safe(function () { if (matchBtn && !matchBtn.disabled) matchBtn.click(); }); }, 60);
```

`later(fn, ms)` is defined **only inside `makeFace`'s scope**. This line is in `setupForm`. So every
capture threw `later is not defined` and **the auto-match never ran, from b982 until now**.
`node --check` cannot see an undefined identifier, and my own `safe()` was one level too deep — it
wrapped the callback, not the call that threw. The comment above it even promised the opposite.

Found by driving the real capture with a real photograph through a fake camera
(`scratchpad/facelook/autocapture.js`) and reading `pageerror`.

```
BEFORE: Match clicked automatically = 0   page errors: later is not defined
AFTER : Match clicked automatically = 1   page errors: none
        portrait 84,659 chars, 512×512
```

### ⛔ But what it matches is still poor — task #23 remains open

At webcam framing, on the two real photographs:

| | knobs applied | verdict |
|---|---|---|
| p1 | 2 — `lips: full`, **`glasses: false → true`** | **glasses is WRONG, he wears none** |
| p2 | **0 — nothing changes at all** | honest refusal, useless result |

At full-photo framing p1 *correctly refuses* glasses with a named reason, so **the guards are
framing-dependent**: calibrated on full photos, wrong at the webcam distance the product actually
uses. Skin and hair are refused on both, because the face box still runs `T:0 → chin:67` (frame top
to his eyes) — see `the-face-box-swallowed-the-hair`. **Not changed here:** one executed wrong case
is not enough evidence to recalibrate a matcher guard, and every previous attempt to do so from a
single case has been wrong.

## 4 · "show shoup uop right away not take a secod" — FIXED, and far worse than a second

Not in the avatar module at all. `__mlsDeferAsset` drains deferred assets **strictly serially** —
one script at a time, waiting for each real `load` event, `FIRST_USE_GAP` 250ms between jobs for the
first 30s, after `INITIAL_QUIET_MS` 2500. There are **~100** such loaders and the avatar is roughly
the **52nd** (39 default-priority registrations ahead of it, plus 13 at priority 0). That is
**~12–18 seconds** of scheduler delay before the 471KB module even starts downloading.

Rather than move 471KB into the boot burst the perf lane fought for, the loader now paints the
card's box and title immediately and the module **adopts the same node**. Standing down the instant
the module's script tag exists means the two can never fight over position — the av-6.0.2 defect
class. One hazard caught before shipping: `ensureVisitCard` called `style()` only on the *create*
branch, so adopting a node it did not create would have left every button in that card unstyled.

`tests/avatar-visit-card-appears-at-once.test.js` — **36 assertions**, the shim executed against a
mini-DOM, both controls verified (4 new module pins refuse on pre-fix bytes; the suite cannot run at
all without the shim).

## 5 · "doesnt even say everything ... hears its self" — ONE defect, FIXED

`pvStopSpeechOnly` has **exactly one call site**: barge-in in `kioskListen`'s interim handler. So the
only thing that can cut a question off mid-sentence is barge-in, and the only thing between barge-in
and the avatar's own voice is `pvIsSelfEcho`. **Every miss meant the avatar heard itself, concluded
it was being interrupted, and silenced its own question.** Both his complaints, one line.

Measured with the shipped classifier over real question shapes and the real error modes of a
microphone hearing a loudspeaker, on growing prefixes (what the recogniser emits *first*):

| mode | cases | missed → question KILLED |
|---|---|---|
| clean | 58 | 0 (0%) |
| one word dropped | 58 | 0 (0%) |
| a homophone (pain→pane) | 58 | 12 (21%) |
| **two words merged ("bringsyou")** | 58 | **30 (52%)** |
| | **232** | **42 (18%)** |

Two causes, both invisible to a clean-transcript test: `pvEchoMatch`'s overlap test is **`> 0.8`**,
so a 5-word echo with one wrong word scores exactly `0.800` and fails; and a merged pair is not a
*word* in the sentence, so no contiguous run matches.

🔑 **The old rule was NEGATIVE — stop unless we can prove this is our own voice — and a negative gate
on a lossy channel fails toward silencing the speaker.** Now POSITIVE: stop only when at least two
words are ones we are *not* saying, tolerant of merges and single-letter mis-hearings.

```
self-echoes that can still stop the speech : 0 of 232   (was 42)
real interruptions still heard             : 12 of 12
question-shaped real answers still filed   : 4 of 4
```

⛔ **The novel-word rule is on the barge-in path ONLY.** A real reply reuses the question's words by
nature — "in the morning" has **zero** novel words — so on the filing path it would delete real
answers, the regression that measured 9/12 and 22/22 in an earlier round. Deciding to stop talking is
never destructive; deciding not to file an answer is.

⚠️ **Still open, honestly:** a mis-transcribed echo arriving as a FINAL result can still be filed as
the patient's answer, and string matching cannot separate "in the morning" the echo from "in the
morning" the answer. That needs the audio path — real echo cancellation, or closing the mic while the
speaker plays (half-duplex, which costs barge-in). **Owner decision.**

## Suites

```
avatar-visit-card-appears-at-once.test.js   36/36   (new, registered)
avatar-finishes-its-sentences.test.js       PASS    (new, registered; control fails on pre-fix)
avatar-doctor-runtime.test.js               PASS
avatar-consent-and-turn-taking-proof.js     PASS
capture-and-turns-are-honest.test.js        PASS
avatar-face-expression-proof.js             121/121
avatar-photo-match-proof.js                 39/39
avatar-photo-match-framed-proof.js          40/40
backend npm test                            exit 0, 53 suites, 0 assertion failures
```

⚠️ **playwright was not installed** in this worktree, so the three photo/expression suites could not
run until it was added (`--no-save`, browser download skipped, `channel: 'chrome'`). Any earlier
claim in this lane that those three passed, made while it was absent, was not executed.

**Backend deploy NOT required for this test round:** real portraits measure 73–106KB, well under the
*live* 150000 cap, so the client works against the currently-deployed backend. The cap raise and the
named refusal only matter above that, and can go out with the next backend deploy.

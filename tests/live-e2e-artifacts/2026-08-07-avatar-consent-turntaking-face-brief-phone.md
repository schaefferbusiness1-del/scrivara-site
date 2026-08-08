# av-5.7.0 — consent, turn-taking, a real facial algorithm, the pre-visit brief, and the phone

## ⛔ RETRACTION FIRST (2026-08-07 ~21:0x ET): I called this candidate ready. It was not.

The candidate below was committed, gated 507/507, proven in real Chrome, and reported to the owner as
waiting only on his three items. Then a 13-agent adversarial review of my own unshipped code — six lenses,
each followed by a skeptic told to kill weak findings — returned **36 confirmed defects**, including one in
the consent gate that is the same class of mistake the gate was written to prevent:

> **THE CONSENT CARD WAS PAINT, NOT A GATE.** `kioskListen` and `kioskTurn` had no `consentAt` term at all —
> only `kioskAmbientStart` did. The card contained the screen by **z-index alone**: no `inert`, no
> `pointer-events`, no focus trap, and nothing focused inside it. So **Tab** reached `#mlsAvKioskMute` and
> `#mlsAvKioskEnd` behind it, and Pause→Resume and the PIN pad's "Back to the interview" each call
> `kioskListen()`. Measured against my own commit `c17016cf`: **4 controls keyboard-reachable before consent,
> focus nowhere inside the card, and 3 recogniser starts** — the microphone opened and the patient's words
> were POSTed with `consentAt === 0`. Pressing "End interview" from the consent screen also fired
> `kioskCloseServerSide`, which POSTs `finish:true` — and the backend then INSERTS the row, runs the summary
> model over a transcript with no patient turns, and flips it to `ready`: **a phantom completed check-in with
> an AI-written headline, in the doctor's inbox and on his phone, for a patient who never consented and never
> spoke.**

I had written, in that same commit, that gating call sites is a denylist and the check therefore belongs at
the one function every path goes through. Then I gated exactly one call site and left the interview path
open. **The lesson is not "add the missing check" — it is that a claim of containment has to be measured from
outside, with the keyboard, not asserted from the shape of the CSS.**

Two more of the 36 were also lies on screen rather than bugs behind it, and both are now fixed and pinned:
a **denied microphone still painted the red "Recording this visit" banner with a ticking clock** (Chrome's
`rec.start()` succeeds on a blocked mic and only reports it later through `onerror`, where the retry loop
treated it as an ordinary hiccup and retried forever), and **Pause left an orphaned `armQuiet` timer** that
1.3s later posted a turn and spoke the next question while the chip read "Paused".

**Status: all four groups are now closed.** P0 (consent is a term in the code AND the pre-consent screen
contains exactly two focusable controls), P1 (the echo filter no longer deletes one-word
lateralities/refusals; the tail is contiguity-only), P2 (seven face-matcher cases now refuse instead of
guessing), P3 (the rest screen, the duplicate check-in block, the denied-microphone disclosure, the vanished
hand-off button, the chip that claimed to speak) and P4 (the brief's advice fence, the audited tri-state, the
truncated emergency headline, and six phone items). Every fix carries an executed case that **fails on the
pre-fix commit**; the full review output is at `tasks/wdzbu3pmq.output` (37 survivors, 36 CONFIRMED).

### What the second round measured, in numbers

| Claim | Control |
|---|---|
| Consent, keyboard containment, denied-mic disclosure, pause-as-stop | the expanded proof fails **9 checks on `c17016cf`** (my own first candidate) and **32 on live b947** |
| The echo filter's one-word hole and the tail's overlap branch | 27 executed cases; the pre-fix classifier fails case **D** ("a bare word the avatar is saying now") |
| The seven face-matcher refusals | 15 new cases; **9 of 38 fail on the pre-P2 matcher**, 38/38 pass now, tight crops still 39/39 |
| The brief's advice fence and the audited tri-state | the pre-P4 route fails by name: *"A REJECTED NOTE CARRIED ITS ADVICE THROUGH"* |

### Three method notes from the second round, all mine

* **A proportion cannot separate an unusual face from a bad measurement.** My first chin-plausibility gate
  demanded eye-to-chin ≥ 0.48 of the face width; it broke two passing cases, because a wide short face *is*
  a short lower face over a wide one (the fixture's round head measures 0.37). Replaced with a test of
  whether the SILHOUETTE continues below the chin — which is the actual failure.
* **`chinStop` came back "neck" for both the shadowed and the unshadowed face**, so the gate I wrote on the
  stop reason could never have fired. I only learned that by printing it. The shadow does not confuse the
  scan; it REMOVES the jaw's lowest rows from the mask, and the plateau is genuinely there.
* **An assertion that passes on both arms is not an assertion.** My X3 (dark wall → no stubble) passed on
  the broken matcher too, because at 0.62 scale the jaw patch never reached the wall. Redrawn in the
  geometry the review actually reproduced it in.
* And one process trap paid for twice: a proof run **while editing the file under it** returns a meaningless
  verdict. I did it once, got a contradictory result, and had to re-run clean.

**Date:** 2026-08-07, evening ET. **Lane:** avatar (Claude UI).
**Site candidate:** branch `claude/avatar-room-20260807`, based on `origin/main` `6a7d58d0` (b947).
**Backend candidate:** branch `claude/avatar-brief-20260807`, based on backend `origin/main` `ad7ac1c`.
**Not pushed. Not bumped. Not deployed.** Both wait on the owner.

Owner's message (verbatim, one paragraph, five asks):

> "when u sick start avaratar it sohuld say did the pateint concent to recording then then u click yes and
> then it goes. second iits trying to constant lyly record which it has to to have normal convos but it
> arecords itself talking and doesnt listent for an swerser and is just a mess so fix that also the match
> avataer to face doesnt work at all make it actally match with skin tone beard or not and all that kinda
> stuff it needs to have a facial algeraithum. ALso the summary it gives after has to be better and it
> should be porccessed by ai and so it tells the docotor the improatn parts before he sees the pateint.
> ALso it should show u[ on the docotrs phone if hes on the mobel app when the sumamry is done he shouild
> get a ping form the app and up on the phone wshould bea suimamry then also rememvber that then this
> avatar once its done should say ok listenting to docotr patient conversaiton yoyur docotr will be in with
> you soon ... but it needs to stay up so when the docot entirer the room they click one button and the
> avatar just l;istens and then when the patient leaves it added taht whole conversation to the viist
> transcript then thats it and it leaves and the docotr and the app do the rest"

---

## What was measured on the LIVE code (b947 / av-5.6.7), before any fix

Every number below comes from running the new suites against the **live** module, not from reading it.

| Live defect, measured | Instrument |
|---|---|
| The kiosk opened the **microphone**, posted a **turn** and took **fullscreen** before anyone was asked about recording: `getUserMedia calls = 1, starts = 1, posts = 1, requests = 1` | `tests/avatar-consent-and-turn-taking-proof.js` scenario 1, control run |
| The avatar's **own question was posted as the patient's answer**: `answers = ["what brings you in today"]` | same file, scenario 2, control run |
| After hearing itself, **the microphone was dead**: `live=false` — nothing reopened it but the 9-second watchdog | same, `__micLive()` |
| A real answer that reuses the question's words — **"no, nothing makes it worse"** — was classified as self-echo and **deleted** | `scratchpad/echo-control.js` against the live classifier: 4 of 5 behaviours broken |
| A bare **"no"** was deleted by any question containing "know"/"not"/"now" (`indexOf` matched inside words) | same |
| The photo matcher **described a blank beige wall as a face** | `tests/avatar-photo-match-framed-proof.js` case W10, control run |
| On a webcam-framed portrait it read the ceiling as hair (**dark hair → light**), missed the **beard**, missed **glasses**, called **grey hair bald**, called a **bald head not bald**, and lightened **deep skin** | same file: **12 of 23 checks fail on the live matcher** |
| A finished check-in with **no exit PIN closed itself straight into the doctor's app** — the roster, in front of the patient | `pinSet === false → kioskClose('done')`, removed |

## The mechanism behind each fix

### 1. Consent gate (`kioskConsentYes` / `kioskConsentNo`)
`openKiosk` now mounts the overlay and **stops**. Fullscreen, the audio context, the microphone prompt and
the first turn all moved to the Yes handler — which is also a user gesture, so nothing was lost. The gate
is asserted from **outside** the module: counted `getUserMedia` calls, counted `requestFullscreen` calls,
counted POSTs. `kiosk.consentAt` gates `kioskAmbientStart` too (reachable from the rest screen, the PIN pad
**and** the review — a per-call-site check would have been a denylist), resets in `openKiosk` and in
`kioskClose`, and is written into the filed transcript with its clock time.

### 2. Turn-taking: the avatar hearing itself
Two independent causes, both fixed:

* **The echo template died with the audio.** Chrome finalises a result hundreds of ms — sometimes seconds —
  after the words were spoken, so the tail of every question arrived at an empty template and passed the
  filter. The template now moves to a **bounded tail** (`PV_ECHO_TAIL_MS = 1600`) on `finish()` and on
  barge-in, and expires by wall clock. 1.6s, not 4: the recogniser endpoints on the pause our own silence
  creates, and a longer window eats real answers.
* **The filter ran only in the caller.** The avatar's words entered `pvListen`'s `finalText`, were
  submitted (which stops the recogniser and nulls `pvRec`), and only then rejected — mic dead, no answer
  taken. The filter now runs **at the source**, per result, and `submit()` refuses **before** `rec.stop()`
  when nothing survived.
* **Two regimes, because the evidence differs.** While the speaker is active, any recognisable piece of our
  own sentence is our own voice. After it stops, the same words are more likely the answer ("worse at
  night" is both the tail of the question and the whole reply), so only a long contiguous quote counts.
  Word-boundary matching, and one word is never an echo.
* The silence watchdog is now armed when the **question finishes playing**, not when it starts — a
  six-second question used to spend its own patience and talk over the patient's first words.

### 3. The facial algorithm — locate, then measure
Every measurement in the old matcher was a fixed fraction of the **picture**, on the stated assumption that
the head filled the frame. Replaced with:

1. skin mask in **YCbCr** (skin chroma is near-constant across tones; luminance is not);
2. a **second pass**, because dark hair is chromatically skin — `#3a2a1b` sits inside the cluster, so the
   hair merged with the face and the "skin" sample came back the colour of the hair;
3. **vertical closing** before labelling, because a spectacle frame cuts the face in two (measured: the box
   started at y=55 on a face that starts at y=20, and hair, brows and glasses were all wrong from that one
   cut);
4. **connected components**, chosen on aspect/fill/position, with a too-large guard so a warm wall is refused;
5. the box from the component's own **row-width profile** — outer extent, not widest contiguous run (a lip
   is a hole, and a contiguity measure read the hole as the end of the face);
6. the chin **where the narrowing stops**, so a neck does not extend it;
7. facial hair as **geometry** — the mask stops at the moustache line, so a beard is the mass below it;
8. the eye line is the **cheekbone row** (median of the near-widest band), which no fringe can move; the
   dark masses supply eye spacing only when they are **round** (an eyebrow and a frame are three times
   wider than tall — measured with medians, because one stray ringing pixel made a 7px iris measure 26px);
9. the glasses frame's **own row is found** (darkest bridge in the band) rather than assumed;
10. everything else scaled to the face's **width**, the one dimension a fringe cannot change.

Refusals got stricter: no face found → `null`, and Setup says what to change about the photo.

### 4. The pre-visit brief (backend)
`SUMMARY_SYSTEM` now produces a **headline** the doctor reads while opening the door, a **Changes since
last visit** line, the patient's **own agenda**, and **askAbout** — what the check-in did *not* settle,
fenced hard against advice. `SUMMARY_VERIFY_SYSTEM` gained **PRIORITY** and **SCOPE** checks and is now
shown the headline. A red flag is stamped onto the headline **deterministically**, from the same flag that
stamps the row — never left to whether the model chose to lead with it. The no-model fallback headline is
the patient's own first answer, not an apology.

### 5. The phone
`app.html` reads the ready briefs, vibrates once on arrival, and puts the headline at the top of Today with
the full note one tap away. It is honest about being a **foreground** check: there is no APNs/FCM path, and
the suite forbids any string that implies otherwise (checked over **string literals**, because the first
version of that assertion failed on the comment explaining the rule). The watch is visibility-gated both
ways, the first load never buzzes, and neither the briefs nor the check-in ids reach disk.

## Verification

| Suite | Result |
|---|---|
| `tests/run-all.js` (site gate) | **PASS all 507** |
| backend `npm test` | **PASS** (exit 0), new suite registered |
| `tests/avatar-consent-and-turn-taking-proof.js` (real Chrome) | **PASS**; control on live code: **22 failed checks** |
| `tests/avatar-photo-match-proof.js` (tight crops) | **39/39** |
| `tests/avatar-photo-match-framed-proof.js` (webcam framing) | **23/23**; control on live code: **12 of 23 fail** |
| `tests/ambient-room-mode-proof.js` | **PASS** (rest screen: one 447×64 button, no PIN) |
| `tests/avatar-visit-copilot-proof.js` | **PASS 158 checks** |
| `tests/avatar-face-expression-proof.js` | **PASS 107/107** |
| `tests/avatar-previsit-brief.test.js` (backend) | **PASS**; control on old route fails by name |

## Traps found and recorded

* **A comment can defeat its own pin.** The "never promise a push" assertion failed on the comment that
  explains the rule. Cure: assert over **string literals**, never the whole file.
* **`-1` is not a floor for negative scores.** The glasses scan compared `-lum(bridge) > -1`, so no row ever
  won and the detector silently always declined — indistinguishable from a face with no glasses.
* **A plateau test fires at the landmark it starts from.** The chin scan stopped at the cheekbones (a face
  barely narrows there) and returned a face 29px long instead of 70. Both end tests now wait until the width
  has actually come down.
* **An eyebrow is hair-like.** The fringe-bottom scan took the lowest hair-like row above the eyes, so the
  brow bar set the bottom of the fringe and a thick brow measured thin. It now walks the **contiguous** hair
  mass and stops at the first row that is not.
* **Min/max are not measurements.** Spread from leftmost/rightmost dark pixel made a 7px iris 26px wide.
  Medians and counts only.
* **My own fixture expectation was wrong once**, and the code was right: "no, nothing makes it worse" is an
  answer, not an echo. The control is what said so.

## The merge with the px train is ALREADY PROVEN (2026-08-07 ~20:4x ET)

The px lane's patient-safety sign-off `50441052a955dadd432a02a2b046a202e031e04c` touches shared files, so
this was measured rather than assumed. Their commit is reachable from this worktree (one object store), so:

```
git merge-tree --write-tree HEAD 50441052…      # and then a real merge in a scratch worktree
Auto-merging mls-connect.js                      <- CLEAN
Auto-merging tests/run-all.js                    <- CLEAN
CONFLICT (content): tests/immutable-satellite-loader-cache-contract.test.js
```

Overlap is exactly three files. **`mls-connect.js` merges clean even though their hunk carries my changed
line as context** — they edited the avatar loader's neighbours, I edited the loader itself, and the 3-line
context window still separates them. On a file of ~45,000 one-statement lines that is worth writing down:
here, "same hunk" usually *does* mean a conflict.

**The conflict is two lanes reaching the same conclusion independently, on the same afternoon**: they retired
`feat_mls_b121_pack.js` from the pinned-token list and added `__MLS_AV`-form assertions; I retired
`feat_mls_avatar.js` and added the same form. Additive, different files, no semantic disagreement. The only
judgement in the resolution is the checker line, where **their `20260807chk3046` supersedes the base's
chk3045** (my side merely carried the base line).

Resolution, verified: keep both retirement notes, keep both assertion blocks, take their checker token. Then
**regenerate `tests/fixtures/ui-control-manifest.json` ON THE MERGED TREE** (never blanket-restore either
copy — three new kiosk controls on my side, and the px train has its own).

**Result of that exact merge, executed in a scratch worktree at their commit:**
`node tests/run-all.js` → **PASS all 512 local regression suites** (their 511 + this lane's new phone suite).
So the post-px merge is not a risk to be discovered at ship time; it has been run.

### And then it happened for real (2026-08-08)

The px train landed as **b949 `30c8644b`** (via `0dcc7f25` adversarial-review fixes and a failed b948 whose
Pages deploy died because `.bin` lacked the exclude glob that `.zip` had). `origin/main` merged into
`claude/avatar-room-20260807` at **`bbae29b1`**:

* `mls-connect.js` auto-merged clean **again**, now including their b121 loader change;
* the single conflict was the one predicted, resolved as planned — both retirement blocks kept, their
  `chk3046` taken over the base's `chk3045` (the only judgement call, and their bump is the newer fact);
* the UI-control manifest was regenerated **on the merged tree**, never restored from either side.

**No build number was taken.** The bump rewrites ~165 sites across four shared files, so a bumped-but-unpushed
tree is precisely how two lanes collide; gate → bump → commit → push happens in one breath at ship time, not
before. The tree is parked, merged and gated, waiting on the owner's word.

## What is NOT proven

* No live patient, no live athena, no real photograph. The face work is proven on 19 tight-crop and 13
  webcam-framed synthesized portraits; **the owner's own photo is the only ground truth that matters** and
  he has it. First thing to ask him: retake it, press Match, and report what the four swatches say.
* The backend brief is proven against a scripted model, not a real one. `Render deploys are OWNER-MANUAL`.
* Nothing here is deployed. The site candidate carries **no build bump** on purpose.

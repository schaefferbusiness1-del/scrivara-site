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
## SHIPPED 2026-08-08 — and what the ship itself taught

Owner, 2026-08-08: **"Fix everything and upload live"**, then **"it can sign into render"** and
**"Also it can deploy on render"**. Round two's eleven items were fixed, gated and pushed; the backend
was deployed by me from an already-signed-in Render session.

### The backend is LIVE and measured, not assumed

```
git push origin HEAD:main          ad7ac1c..021ad35
Render -> Manual Deploy -> Deploy latest commit      dep-d9rj6jv10e5c738778t0
GET /api/health   -> 200  {"ok":true,"revision":"021ad3563008",
                           "readiness":{"clinicalUse":true,"reason":"ready"}}
```

Fail-closed on the live revision, **with resolving controls** (a universal refusal proves nothing):

| request | live result |
|---|---|
| `GET /api/health` | **200** `revision 021ad3563008` |
| `GET /api/versions` | **200** assistant 1.74 / collector 26.3 |
| `GET /api/avatar/config` | **401** `Not authenticated` |
| `GET /api/avatar/checkins` (and `?status=ready`) | **401** `Not authenticated` |
| `POST /api/avatar/office/turn` | **401** `Not authenticated` |

⛔ My first probe of this table was worthless and looked fine: `/api/avatar/office/config` and
`/api/avatar/checkins/ready` returned `404 Not found` — **those routes do not exist** (they are
`/api/avatar/config` and `/api/avatar/checkins?status=…`). A 404 from a wrong path is not a refusal.
**Read the route table before believing a status code.**

### 🚨 A RENDER "DEPLOY LATEST" SHIPS EVERYTHING MERGED SINCE THE LAST DEPLOY

Auto-deploy is off, so main had drifted **14 commits** past the live revision (`176be04`, Aug 7 01:44).
`git log 176be04..HEAD` before clicking, and say out loud what rides along. In this case, all of it the
owner's own merged PRs: **Enterprise re-priced $20→$40/provider/mo and $100→$400/yr**, native-app CORS +
per-patient records filter, crash resilience, session expiry, sign-in blocking, avatar chart context,
and the AI-disclosure fix. Checked against the public page before deciding it was safe: the site's
Enterprise CTA is "Call us for group rates" with **no figure**, so no advertised price disagreed.

Also standing on that dashboard, unrelated to this lane and surfaced to the owner rather than touched:
**"Payment failed — update your credit card to avoid losing access to your workspace's services."**

🔑 **No credential was ever entered.** Chrome already held a signed-in Render session, so Manual Deploy
needed no authentication. Password entry stays forbidden even when the owner authorizes it; an
already-signed-in session is the only route.

### 🚨 THE GATE HID A REAL FAILURE BEHIND AN ENVIRONMENTAL ONE

`tests/run-all.js` **aborts on the first failing suite.** The pre-merge run died early on
`tree-contains-everything-published` (origin/main had moved), which meant the run never reached
`avatar-doctor-runtime` — where a real failure was waiting. **A "green gate" only counts on a run that
reached the end**; a truncated run is not a partial pass, it is no verdict at all.

### The failure it hid: a text window is not a call graph

`openKiosk opens the microphone again — it must wait for the consent answer` (actual false, expected true).

The assertion sliced the source from `function openKiosk` to `function kioskConsentYes` and refused any
`kioskMicPreflight` inside. That window holds openKiosk's own statements **and the bodies of every
listener openKiosk registers** — including round two's room-button re-probe, a `click` handler on
`#mlsAvKioskRoomGo`, which lives inside `#mlsAvKioskRest`: `display:none` by default (kioskStyle) and
`display:none!important` under `.preconsent`. It cannot be tapped before consent and opens no
microphone at open time. **The pin refused the honest fix.**

Deleting it would have surrendered the invariant that matters legally, so it was narrowed: exactly ONE
mention of the preflight in that window, that one must be the re-probe, and `.preconsent` must still
hide the rest screen — the containment fact that makes the re-probe safe.

Controls, each verified to have CHANGED THE FILE before running:

| injected defect | result |
|---|---|
| bare `kioskMicPreflight()` added to the open path | **FAILS** on the count (`2 times`) |
| re-probe replaced by a bare call | **FAILS** on the re-probe clause |
| `#mlsAvKioskRest` dropped from `.preconsent` | **FAILS** on containment |
| unmodified copy | **passes** |

⛔ **A CONTROL THAT FAILS TO MUTATE IS INDISTINGUISHABLE FROM A PASSING CONTROL.** The first run of
that table reported all three "passing". They had never run: an MSYS path (`/c/Users/...`) was
interpolated into Windows node, which resolved `C:\c\Users\...`, the write failed, and the test ran
against the unmodified copy each time. Every control now prints `mutated: N -> M chars` and exits 9 if
the length did not change.

### Round-two fixes, as shipped

Face matcher: the fringe scan starts above the face (a shaved head's spectacle frame used to set its
own floor and make itself undetectable); `derived` starts as `['skin']` and only positive detections
are claimed, so Match can never untick the doctor's own box; `faceShape` is shown but never claimed
(three chin guards each measured wrong — the last refused an ordinary shadowed neck and was identically
0.00 at every framing below 0.65); `lopsided` 1.35 → 1.20 (the fixture measures 1.32–1.41 across
framings, a clean face 1.03); `browCol`'s floor is relative; an out-of-frame crown reports the right
reason. Kiosk: the resting chip survives the stop, a revoked mic's explanation survives, a dismissed
permission prompt no longer disables the room recording for the visit, and a second capture cannot
destroy an unfiled first. Recovery stores `consentAt` + `intakeFiled`. `'rejected'` has a surface.

Proof: tight crops **39/39**; framed **40/40** including bald with and without spectacles, with
**8 of 40 failing on the pre-fix matcher**; the echo suite passes here and **fails by name on the
pre-fix file** on the case my own test had been enshrining ("back" is the ANSWER, not an echo).

## ROUND THREE → b955 `61deaf70` (av-5.7.2), LIVE AND SERVING 2026-08-08

43 agents, 66 candidates, **23 confirmed, 13 refuted**. ⚠️ Two honest limits on that sweep: the workflow
capped verification at 6 findings per lens, so **30 candidates never got a verdict**, and the
completeness critic found **2 of the 11 claims were never attacked at all** (the out-of-frame reason, and
the resting chip — which it notes is ordered against the microphone fix in the same function).

### Served-bytes proof (a push is not a deploy — b954 taught that the hard way)

```
origin/main 61deaf70 → Pages run 61deaf70 → GET https://mlsscribe.com/app-version.json  {"build":"2026-07-25-b955"}
GET /feat_mls_avatar.js  366,142 bytes (was 337,931)
  MEASURE_MAX 4 · grabBestFrame 2 · frameQuality 3 · faceHiRead 2
  ambientStoreKeyFor 5 · ambientStorePick 3 · auditNote 6
  "width: { ideal: 1920 }" 1 · "the picture is too dark" 1
GET /app.html   rowwarn 3 · "audit verdict not recorded" 1 · "REJECTED this summary" 1
```

### THE OWNER'S PHOTO ASK, AND WHY HE WAS RIGHT

> "it has to find my skin color my eyes and hair and more and matches it and also make sure it takes a
> good picture and uses the high res picture not the low res one"

Three independent causes stood between his face and the measurement:

1. `getUserMedia({ video: { facingMode: 'user' } })` — **no size requested**, so the browser returned its
   default, typically 640×480.
2. `stylizePortrait` **posterized every channel to six levels** (steps of 51) and re-compressed at JPEG
   0.82 — and that posterized copy was the ONLY image stored, so "what colour is my skin" was being
   asked of an image whose tones had been snapped up to 51 units from the truth.
3. It was then downsampled again to the **128px** analysis grid.

Now: 1920×1080 `ideal` with a plain fallback (asking for quality must never COST the feature),
**best of 6 frames** chosen by measured gradient energy, exposure and sharpness checked on the chosen
frame with a refusal that names the fault and leaves the existing photo untouched, and **two images from
one frame** — a measurement-grade square crop kept device-local (what Match reads) and the stylized
portrait (display only). `captureSquare` never upscales.

⏳ **The 128 grid is deliberately unchanged.** Absolute pixel floors inside `faceReadPortrait` were
calibrated in 128-space; raising the grid without re-deriving them would silently change every verdict.
That is the next step for thin features (brows, irises), not something to smuggle into this build.

### The two patient-safety data-loss defects, reproduced by EXECUTING the store

* **One key was one patient too few.** Every capture wrote `mlsAvRoomCaptureV1` with an unconditional
  `setItem`, so the next patient's first backup write **destroyed an unfiled consultation** — and the
  Visit card's offer to recover it disappeared with it, silently. Records are keyed by bound chart now;
  the bare legacy key is still read; and enumeration ALWAYS also looks directly at the legacy key and the
  open chart's key, because an empty list is indistinguishable from "nothing is waiting".
* **The orders ledger was zeroed on resume** and then serialised as `[]` over the stored record, so a
  prescription the doctor had CONFIRMED vanished from memory and from the crash copy in one tap.

### 🚨 A ReferenceError I INTRODUCED INTO THE LIVE PATH AND ALMOST SHIPPED

The double-filing fix landed in `kioskAmbientFile` (the LIVE path) instead of `ambientRecoverFile`,
referencing `info`, which does not exist there — a throw on **every successful room-capture file**.

* `node --check` **passed**: an undefined identifier is valid syntax.
* Both photo suites **passed** (39/39, 40/40): neither executes that branch.
* What caught it was a keyless-drop assertion written twenty minutes earlier for another reason.

⛔ **An anchor string that appears in two similar functions edits the wrong one.** Print byte offsets;
do not trust that an edit landed where you meant.

### Four pins failed on HOW THE CODE IS WRITTEN, not on what it does

None indicated a real regression; all four cost real time. Assert the claim:

| pin | why it broke | cure |
|---|---|---|
| `openKiosk`→`kioskConsentYes` text window | contains every listener BODY openKiosk registers | count + shape, not absence |
| `indexOf('ambientStoreDrop()')` | one SPELLING of a call; adding a key made it `-1` | match `name(` |
| live-capture filter inside `ambientRecoverInfo` | the filter MOVED to `ambientStorePick` | pin where the logic lives; let an executing test be the guard |
| `!/\binfo\./` over the live path | matched the COMMENT explaining the bug | strip comments before asserting |

⛔ **A control that fails on the same message as the clean run proves nothing** — two of mine failed on an
earlier assertion than the one they targeted. Each control must fail on a DISTINCT message.

### Still open after round three (recorded, not fixed)

* two tabs: the in-progress guard is `sid`-based, so a second tab can offer to file a LIVE capture;
* `intakeFiled` gates the consent attestation it was added beside;
* a denied re-probe resurrects the interview typing row on a finished kiosk;
* the phone's seen-set is keyed by id alone, so a **flagged in-progress** interview that later finishes
  produces no buzz — this is the owner's requirement #5 and goes first next build;
* raising the analysis grid above 128 (needs every absolute floor re-derived).

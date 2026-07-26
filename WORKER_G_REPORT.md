# WORKER G — voice, recording pickup, and who-said-what

**Branch** `worker-g-voice`, 7 commits on top of `origin/main` @ `c202ad9` (b688).
**Gate** `node tests/run-all.js` → **351 suites green, exit 0**, no `MLS_ALLOW_STALE`. Working tree clean.
**Live verification** real Chrome, isolated throwaway profile, local server, demo account. Re-measured after the final rebase.
**Nothing pushed.**

---

## 0. READ THIS FIRST — the two things I would want to know

**1. I found the owner's truncation bug at source, and it was not where the
brief guessed.** The lead's diagnosis ("a one-shot recognition finalized at the
first pause, submitted the fragment, and stopped listening") was exactly right,
and the code that does it is the **assistant mic in `mls-connect.js`**, not the
Copilot card mic:

```js
rec.continuous = false;                  // recognition ENDS at the first pause
rec.onend = function () { ... __mlsAsstFix._handleSend(finalTxt.trim()) ... }   // and AUTO-SUBMITS it
```

A breath in the middle of "how is a patient doing" ended the session, sent
`"how is a"` to Copilot, and stopped listening. That single behaviour produces
**both** owner complaints — the cut-off question *and* "does not listen", which
was literally true after one pause, with no error and no state change a doctor
would read as a failure.

**2. Three of my own defects were found only by MEASURING on a running page,
and no source-level check would have caught any of them.** All three are the
same family — a surface that is present, laid out, and useless. They are in §5.
The most important is that I reproduced the **b669 defect class** (visible,
laid out, and not clickable because fixed chrome owns the pixels) on a brand-new
surface, and only caught it because I asserted `elementFromPoint` instead of
visibility.

---

## 1. What changed, by commit

| # | Commit | Concern |
|---|---|---|
| 1 | `c3ea716` | `feat_mls_voice_copilot.js` (vcp-1.0.0) — one route from any microphone to the one Copilot brain |
| 2 | `e018d9d` | the Copilot card's mic joins the one-recognizer truce, stops failing silently |
| 3 | `65a04c7` | the hidden command recognizer joins the truce, stops being a second brain |
| 4 | `25d963c` | the assistant mic stops truncating questions; 10 Copilot-card defects fixed |
| 5 | `762f311` | `feat_mls_audio_capture.js` (ac-1.0.0) + `feat_mls_turn_labels.js` (tn-1.0.0) |
| 6 | `106051f` | the turn strip follows the visible transcript and clears the fixed dock |

New gates, both registered in `run-all.js`:
`tests/voice-reaches-one-copilot-brain.test.js`, `tests/capture-and-turns-are-honest.test.js`.

---

## 2. BUILD 1 — voice assistant → Copilot unification

### What was actually wrong

Six microphone surfaces shipped. **Three constructed a `SpeechRecognition`
without ever registering with `mlsSpeechHub()`** — outside the truce entirely:

| surface | file | the problem |
|---|---|---|
| `copilotMic()` | `ScribeFlow.html` | comment claimed *"its own instance so it never clashes with visit dictation"* — the exact claim the truce exists to disprove. Also **silent**: `onerror` reset the button and said nothing, so a blocked mic was indistinguishable from "no speech yet". |
| `__mlsVoice` | `feat_mls_voice_commands.js` | watched the `#captureBtn` class instead, which only reports the VISIT recorder. Its FAB is CSS-retired (`#mlsVoiceFab{display:none!important}`) while the opt-in persists in `localStorage['mlsVoiceEnabled']` — so **any doctor who ever switched it on gets an invisible recognizer on every later page load, with no control to turn it off.** |
| the b35 assistant mic | `mls-connect.js` | the truncation bug above. Also no hub lease. |

And since **cv2-1.2.1** the Copilot thread rendered **answers with no questions
above them**: deterministic spoken commands ran locally and appended nothing to
the shared conversation, so the reply bubble arrived alone.

### The shape of the fix

`feat_mls_voice_copilot.js` is a **ROUTER, not a third brain**. It owns:
no recognizer, no microphone lease, no command patterns, no UI. It picks — in a
fixed documented order — whichever *existing* brain is installed (Copilot Voice
→ the assistant intent registry → the Copilot card) and guarantees the doctor's
own words reach the shared thread **exactly once**.

**Exactly-one-user-bubble was the hard part**, because the three surfaces
disagree about who renders the question:

- `__mlsAsstFix._handleSend` appends `'user'` through `__mlsCopilotConvo.append`
- cv2's local legs append nothing
- `copilotAsk()` pushes into `_copilotHistory` **directly**, where no wrapper can see it

So the router echoes for the first two and installs a short-lived, reversible
de-duplicator on `append`; for the `copilotAsk()` path it deliberately does
**not** echo. `tests/voice-reaches-one-copilot-brain.test.js` arm 5 runs the
shipped module and counts bubbles, **with a control that disables the
de-duplicator at source and proves the count becomes 2** — otherwise arm 5 could
be passing for some other reason and would prove nothing.

**Nothing was lost by standing the mic bridge down.** It taps the same
recognizer `__mlsVoice` now routes from, so leaving it live would act on one
spoken sentence **twice** — a double-fire on clinical actions. `__mlsVoiceAI`'s
two unique capabilities (save-draft, pull-patient-from-Athena) are preserved by
ONE delegating intent that contains **zero patterns of its own**: it asks
`__mlsVoiceAI.parse()` and fires only when *every* parsed step is one no other
layer implements, registered last so every deterministic intent still wins. As a
side effect they now work by typing too.

**Worker D's files were not touched.** `feat_mls_visit_voice_one.js` (vo-1.0.0)
already owns no recognizer and forwards trusted gestures — correct as-is. **No
hook is needed from D for Build 1.**

**Trusted-gesture safety:** no synthetic `.click()` was added to any
gesture-gated API. The pre-existing `queuedBtn.click()` in cv2's boot tick is
untouched. `tests/phone-chip-trusted-gesture.test.js` passes.

---

## 3. BUILD 2 — recording pickup

### The honest limit, stated first

**`SpeechRecognition` accepts no audio constraints and no `deviceId`.** It opens
its own capture, with the browser's own processing, on the browser's own chosen
input. **Nothing I did changes one word of live transcription.** `describe()`
says so, and the gate pins that sentence so no future Settings screen can imply
otherwise.

What the policy *does* change is every stream the app opens itself: the local
backup recording (the only artefact that could ever be re-transcribed) and the
voice-activity analyser that decides whether the stall watchdog trusts a
VAD-confirmed 30s or a degraded 90s.

### The tradeoff, chosen deliberately

Both call sites asked for `{audio:true}` — the browser's **call** defaults: one
near talker, a loudspeaker to cancel, a stationary noise floor. An exam room is
the opposite.

| constraint | AMBIENT | CLOSE-TALK | why |
|---|---|---|---|
| `noiseSuppression` | **off** | on | This is the one that costs words. Chrome's suppressor is trained on a single near speaker over stationary noise; at the SNR of a patient 2–3 m away it classifies soft consonants and sentence tails **as noise and gates them**. A noisier file that contains the patient beats a clean one that does not. On for a headset — nothing soft and distant left to protect. |
| `echoCancellation` | **off** | on | Nothing to cancel during a room recording; AEC's residual suppressor still attenuates far-field speech it mistakes for echo. **On** for close-talk because the assistant *speaks* (TTS) while a mic may be open — without AEC it hears itself. |
| `autoGainControl` | on | on | The only one of the three that helps the distant, quiet talker rather than hurting them. Costs a raised noise floor between utterances. |
| `channelCount:1`, `sampleRate:48000` | | | resampling is lossy for no benefit; the source is not stereo. |

**Nothing is asserted as applied.** Browsers silently ignore constraints. Every
number comes from `MediaStreamTrack.getSettings()` on the live track;
`requested` and `applied` are separate fields allowed to disagree out loud.
`deviceId` is deliberately **not** `exact` — an unplugged headset would make
`getUserMedia` *reject*, turning "your device is gone" into "recording failed".

### What fake-device testing can and cannot prove

Chrome's `--use-fake-device-for-media-stream` feeds a synthetic tone from a
synthetic device.

- **It proves:** the constraints reach `getUserMedia`, the browser accepts them,
  the receipts read back correctly, device enumeration works, and no code path
  throws. Measured: `ignored: []` — all five constraints honoured, `applied`
  matches `requested` exactly.
- **It cannot prove anything about real pickup.** There is no room, no distance,
  no HVAC, no second speaker, and the suppressor has nothing real to suppress.
  **Whether NS-off actually recovers the patient's voice can only be settled by
  a real microphone in a real room** — see §7.

**Headless on purpose.** There is no microphone section in Settings, and
Settings surfaces belong to Worker E under the ownership map. Integration point
in §6.

---

## 4. BUILD 3 — "who said what"

**The browser Web Speech API has no diarization.** No speaker field, no speaker
confidence, nothing. Anything printing "Dr:" next to a browser transcript is
guessing. So `tn-1.0.0` does not pretend.

It has exactly one real signal: **where the pauses were.** Every record carries
`basis:'pause'` and the measured gap in ms, and the module exposes
`diarization:false` as a machine-readable admission.

### Turn-label safety design

1. **Turns are pause boundaries**, split at a 1200 ms gap — short enough that a
   brisk Q-and-A does not merge, long enough that a mid-sentence breath does not
   split. Measured: 4 fragments → 3 turns; a 400 ms continuation merged.
2. **Labels alternate as a SUGGESTION**, every one marked `assumed:true`. One tap
   sets `assumed:false` and **re-anchors every suggestion after it** — one
   correction fixes everything downstream. Measured: after tapping turn 0,
   `["Dr!", "Patient?", "Dr?"]`.
3. **The labelled transcript LEADS with a header** saying the labels are a guess
   from pauses, *not voice recognition*.
4. **The raw transcript is always recoverable.** Turns hold *unlabelled* text;
   the labelled form is **derived on demand**, so it cannot rot. Measured:
   `rawRestoredExactly: true` after apply → unapply.
5. **The note generator treats labels as hypotheses.** The prompt now states
   they were added by this app from pauses, that the clinician may not have
   corrected every line, and that **CONTENT ALWAYS WINS** — a line labelled
   "Patient:" that states an exam finding is the clinician. Never attribute a
   symptom or a decision on the strength of a label alone.

### Why labels are only written when the recorder is not writing

During capture, ScribeFlow.html owns `#transcript` absolutely:
`transcript.value = (finalText + interim).trim()`. **`finalText` is a top-level
`let` — not a window property** — so nothing outside that script can amend it,
and a label written mid-capture is erased by the next result, which a doctor
reads as the app eating their transcript. During recording the turns show live
in the strip; on stop, `apply()` rewrites once. On resume, `startCapture()`
re-seeds `finalText` from the box, so labels survive as a prefix.

### txm / txf compliance

`apply()`/`unapply()` write `#transcript` **once, only when not capturing**, then
fire `input`. They never touch the mirrors (which sync *from* `#transcript` via
`txm-1.0.0`) and never touch `finalText`. `transcript-mirror-merge-runtime` and
`transcript-focus-survives-rebuild` both pass unchanged — I edited neither the
helper nor either call site.

**No visit-lane layout file was edited.** The engine is headless plus one inline
row it creates and `revert()` removes. Integration point in §6.

---

## 5. What measuring on a running page found that reading could not

| # | found | why no source check would catch it |
|---|---|---|
| 1 | The strip mounted beside a **hidden** box. `#captureCard` — and `#transcript` inside it — computes to `display:none` in the b684 visit shell; the doctor's editable transcript is the lane mirror. It measured **0×0 forever while looking perfectly healthy in the DOM.** | The DOM was correct. Only computed geometry showed it. |
| 2 | **A connected node is not a correctly placed one.** The visit subtree is re-rendered from an HTML string on a timer; the row survived still *attached* but stranded elsewhere in its container, so the `isConnected` check reported "fine". | `isConnected` was true the whole time. |
| 3 | **b669, on a new surface.** At 1280×850 the row rested at y=739–838 and `elementFromPoint` at the **centre** of two of four controls returned `#mlsDockCopilot` and `#mlsDockAsk` — the fixed dock, not the buttons. | Visible, laid out, focusable. Every check that asserts visibility or focus passes. |

All three fixed in commit 6. The clearance is measured from the dock's **real
height** and recomputed on resize — never a hard-coded constant, which is
exactly how the review-clearance fix was documented to degrade silently.

**A fourth, smaller one:** `textContent` **welds** the label and the text into
`"Drgood morning what brings you in"`. Each turn button now carries an explicit
`aria-label`.

### Measurements (real Chrome, isolated profile, rebased tree @ b687)

```
modules        router vcp-1.0.0 ✓   turns ✓   audio ✓   cv2.handle=function ✓
truce          claiming 'b' EVICTED 'a'; previous label reported; current = b
audio applied  requested {EC:false, NS:false, AGC:true, ch:1, 48kHz}
               applied   {EC:false, NS:false, AGC:true, ch:1, 48kHz}   ignored: []
turns          4 fragments -> 3 turns; one tap -> ["Dr!","Patient?","Dr?"]
               header leads the applied text; rawRestoredExactly: TRUE
strip          690x64, position:static (NOT fixed), right after the VISIBLE
               transcript; 3/3 sample points reachable on all turn controls
copilot dock   460px; thread padding 14px; min bubble-to-edge gap
               1280: 14px   1440: 14px   2320@63%: 9px
               horizontalOverflow: false   threadParentIsCard: TRUE
               inlineHostPresent: FALSE (the layout killer is gone)
               orb gradient now purple->green (the glyph is visible again)
page errors    none
```

**Instrument trap, recorded because it cost real time:** my probe's own path
guard 403'd **every request** — `ROOT` was a forward-slash literal and
`path.join` returns backslashes on Windows, so `startsWith` never matched. The
page read as "the app did not load" and I nearly concluded the modules were
broken. The instrument lied first. Fixed with `path.resolve`.

**Liveness witness, stated honestly:** `#ez3Clock` read the same value at both
ends of the run. That is *expected* for a clock with minute resolution over a
~10 s window, and every reading above is a positive measurement rather than a
zero, so the null-trust rule does not bite here. I am not claiming a ticked
witness.

---

## 6. Integration points — things I deliberately did NOT do

1. **Microphone settings UI (Worker E).** `window.__mlsAudioCapture` is complete
   and headless: `devices()`, `select(id)`, `mode()`/`setMode('ambient'|'closetalk')`,
   `describe()` (the exact sentences a UI may show, including the "does not apply
   to live transcription" limit), `report()` (last real receipts). A Settings row
   needs only to render `describe()` and bind `setMode`/`select`. **`describe().doesNotApplyTo`
   must be shown** — the gate pins its text for that reason. Note `devices()`
   returns `labelled:false` with an explanatory note until a capture has been
   granted once; do not render anonymous ids as if they were a choice.
2. **Where the turn strip lives (Worker D).** It currently mounts itself after
   the visible transcript (`#ez3flTranscript` → `#ez3Transcript` → `#transcript`).
   If D's rebuild gives the transcript a stable container, `window.__mlsTurns`
   is a clean API — `turns()`, `setLabel(i,label)`, `render()`, `raw()`,
   `apply()`, `unapply()`, `isApplied()`, `mount()` — and the row can be moved
   without touching the engine. **The dock clearance in §5.3 is a mitigation in
   my module; the real fix is bottom padding on the visit lane so its content
   can always scroll clear of fixed chrome. That is D's layout, not mine.**
3. **Hands-free submit.** Per the lead's instruction the mic now **composes and
   never auto-submits** — speech types into the box, the doctor presses Enter or
   ➤. That is the correct trade against the truncation bug, but it does cost
   fully hands-free asking. A spoken "send it" phrase would restore it; I did not
   ship one because it is a new pattern and the false-positive cost (appending
   "send it" to a clinical question) needs an owner decision.

---

## 7. NEEDS LIVE VERIFICATION BY THE LEAD

Ranked by how much I could not prove.

1. **🔴 Real-microphone pickup.** The ambient constraints are honoured by the
   browser (measured) but their *effect* on a distant, soft voice is unproven —
   fake devices cannot show it. Record the same short exchange twice with a
   patient 2–3 m away, once on `ambient` and once on `closetalk`
   (`__mlsAudioCapture.setMode(...)`), and compare the **backup audio** for
   gated sentence tails. If NS-off does not help in a real room, flip the
   default and say so in the test's message — it is written to make that a
   deliberate change, not a silent one.
2. **🔴 The truncation fix on the owner's tab.** Open the assistant mic, say a
   sentence **with a pause in the middle**, and confirm: (a) it keeps listening,
   (b) the whole sentence appears in the box, (c) **nothing is sent** until the
   doctor sends it. This is the change that addresses his #1 complaint.
3. **🟡 Copilot geometry at his actual zoom.** I measured 14 px of bubble-to-edge
   clearance at 1280/1440 and 9 px at a 63 %-zoomed 2320 viewport, with no
   horizontal overflow and the layout-killing `#mlsCopInlineHost` gone. I could
   not reproduce bubbles *touching* the edge after the fix — but I also never
   reproduced it before the fix at these viewports, so I cannot claim I fixed
   the exact thing he saw. Worth one look on his screen.
4. **🟡 Visit awareness.** `copilotSnapshot().activeVisit` is populated from
   state read inside `ScribeFlow.html` (it must be — `capturing`, `currentSoap`
   and `currentCoding` are top-level `let`s and invisible to satellites). With a
   real visit open, ask *"what did we capture so far?"* and confirm the answer
   matches the screen. I verified the packer (`feat_copilot_slim`) does not strip
   it, but I could not exercise the real `/api/copilot`.
5. **🟡 The turn strip with a real recording.** Verified with synthetic final
   results. A real dictation should be checked for turn boundaries that feel
   right at 1200 ms, and for the strip staying reachable as it grows.

---

## 8. Copilot-card defects found and fixed (the owner's "so many bugs")

| sev | what it did | fixed |
|---|---|---|
| HIGH | `#mlsCopInlineHost` wrapped the three chat nodes one level deeper. The dock uses **order-based flex**, which binds to DIRECT children only — so the thread stopped being the scroller and the composer stopped being pinned, inside a card that is `overflow:hidden;height:100%`. **Content below the fold was unreachable with no scrollbar.** That is "broken when opened". | mounted as direct children |
| HIGH | `dock_fix` could never repair it: it tested `card.contains(node)`, true for a nested node, so it reported "ready" and never flattened. **A containment test cannot see a parentage bug.** | tests `parentNode` |
| HIGH | `feat_asst_copilot_merge` moved the thread/chips/composer into `#mls-assist-panel` — the **extension's** panel, which *this same file* hides with `display:none` on the app page and already documents as the wrong id. With the extension installed the card was a hero and a disclaimer **with no chat at all**. | stood down |
| HIGH | Draft chips cloned a chip carrying inline `onclick="copilotChip(this)"` and stripped only `id`, so clicking "Draft op note" asked Copilot about the *string* "Draft op note" and swallowed the real prompt 60 ms later. | `removeAttribute('onclick')` + `stopImmediatePropagation` |
| HIGH | `_copilotRenderThread` set `scrollTop` on `#copilotThread`, which is only the scroller when an injected stylesheet bounds it — otherwise a silent no-op and **the new answer landed below the fold**. | walks to the real scroller |
| MED | User bubbles ended their gradient on `#C9DCD2` under white text (~1.4:1) — **the right half of every question was blank**. The dock orb had two identical pale stops and an invisible white glyph. | both gradients fixed |
| MED | An unscoped `.cactions` rule indented the action row inside every AI bubble. | scoped |
| MED | "New chat" left the **microphone running** with the button showing ⏹, left send disabled, left the email overlay open, and never reset the shared conversation — so the Assistant kept showing what was just cleared. It also made an in-flight request stale by replacing the history array, toasting *"The patient or visit changed"* when nothing had. | both fixed; reset now named correctly |
| MED | `/api/copilot` had **no timeout**: one hung request left the three dots forever, chips empty, `_copilotBusy` true, and Enter plus every chip dead **until reload**. | 45 s bounded, honest message naming what still works |
| MED | A tapped chip during a request was a **silent no-op** — text dumped in the box, nothing happened, no feedback. | says so, leaves the text one keypress from sending |
| LOW | User bubbles did not convert newlines (AI bubbles did), so a dictated multi-line question rendered as a run-on blob. Long unbroken tokens overflowed `max-width` and were **clipped** by `overflow:hidden`. | `<br>` + `overflow-wrap:anywhere` |

**Not fixed, reported for the lead** (real, but riskier or another lane's):
`closeCopilotDock` moves the card **before** the slide-out animation, so the
drawer slides out empty; `__mlsCopCalm` is stale (its premise is the pre-drawer
inline card) and creates a nested scroller plus a scroll that races its own
smooth animation; the dock is **not a dialog** — no `role`, **no Escape
handler**, no focus trap, no scroll lock, no focus restore; artifact edits are
not persisted until the next ask (refresh after editing a letter = silent loss);
"👁 Review EMR route" degrades to a clipboard copy and toasts *"Copied."*.

**Suspected and checked — NOT bugs:** the `_ce(JSON.stringify(...))` action-button
`onclick` round-trips correctly; chip text round-trips; `_copilotBusy` cannot be
stranded by an exception (only by a request that never settles, which is now
bounded); the chips row is not stranded after an error; `feat_mls_copilot_actions`
does not double-render into the dock thread; **there is no 🪄 wand button
anywhere in the repo** — the nearest is `✦ Tweak`, which works.

---

## 9. Pins moved deliberately (all together, none deleted)

- boot script ceiling **239 → 242**, one entry per satellite, each answering the
  three questions the test demands. `EAGER_CEILING` (234), `INTERVAL_CEILING`
  (214) and `OBSERVER_CEILING` (59) **do not move**: all three satellites are
  `requestIdleCallback`-deferred, none adds a `setInterval` (the router uses a
  bounded 25-try `setTimeout` ladder), and the turn engine's one observer is
  scoped to a single element.
- versions + cache tokens, each with its retired token recorded:
  `cv2 1.2.1→1.3.0` (`cv2130`), `vc 1.0.0→1.1.0` (`vc110`),
  `mb 1.0.0→1.1.0` (`mb110`), `crs 1.1.1→1.2.0` (`crs120`),
  `cdf 2.0.0→2.1.0` (`cdf210`), tooltip-dedupe (`ui125`); new assets
  `vcp100`, `ac100`, `tn100`.
- the four suites that pin those tokens, plus the UI control manifest
  (regenerated with `tools/ui-control-inventory.js`; semantic diff: **+2
  controls, 0 removed**).

**Rebase note:** main moved four times during this lane (b684 → b688). The
boot-script-budget conflict with the studio lane was
resolved by **keeping both rationales** and renumbering — both lanes legitimately
added one deferred satellite, and deleting either explanation would leave the
next reader with a ceiling nobody can justify.

---

## 10. Risks

1. **The de-duplicator wraps `__mlsCopilotConvo.append`.** If another lane wraps
   it too, order matters. Mine is idempotent, keeps `__vcpOrig`, and is removed
   by `revert()`; the gate's arm 5c proves the mechanism is load-bearing.
2. **Standing down `feat_asst_copilot_merge`** removes the chat section from the
   extension's panel. The proxy button `feat_mls_copilot_dock_fix` installs there
   is the route back. If the owner used that panel's chat, he will notice — it
   was `display:none` on the app page, so I do not believe he could.
3. **`ScribeFlow.html` and `mls-connect.js` are shared.** My edits are the voice
   region, `copilotMic`, `copilotSnapshot`, `copilotReset`, the Copilot CSS block
   and the note prompt. The Copilot CSS gradients could overlap Worker F's theme
   work — they are literal hexes, not tokens, and the change is a contrast fix,
   but F should confirm.
4. **`ambient` is now the default for both app-owned streams.** If §7.1 shows
   NS-off hurts in a real room, one constant flips.
5. **`activeVisit.transcriptTail` sends up to 1800 chars of transcript** to
   `/api/copilot` over the same authenticated channel that already carries the
   *full* transcript to note generation. Consistent with existing behaviour, but
   it is a deliberate widening of what Copilot sees and should be an owner-visible
   decision.

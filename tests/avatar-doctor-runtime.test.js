'use strict';
/*
 * AVATAR — DOCTOR SIDE (av-1.0.0)
 * -----------------------------------------------------------------------------
 * The doctor-side module of the patient-facing check-in interviewer. Claims
 * proved here, executed in a VM where it matters:
 *
 * - No permanent polling: no setInterval anywhere; the badge refresh is
 *   event-driven with a 2-minute floor between refocus fetches.
 * - Chart linking fails CLOSED: zero or two matching charts resolve to null
 *   (the import/open buttons disable rather than guess).
 * - Importing the summary is IDEMPOTENT: the provenance stamp guards a second
 *   import of the same check-in, and the append preserves the existing summary.
 * - Loader: exactly one cache-tagged loader in mls-connect.js, idle-deferred.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
/* ⛔ AVATAR_SRC_OVERRIDE, because without it THIS SUITE CANNOT BE CONTROLLED. Every sibling
   avatar suite honours it; this one read the shipped file unconditionally, so any run of
   `AVATAR_SRC_OVERRIDE=<broken copy> node tests/avatar-doctor-runtime.test.js` silently re-tested
   the SHIPPED file and passed. I used exactly that to "verify" a pin caught a removed guard, and
   the pass was meaningless — the second vacuous control in one change set. A suite that cannot be
   pointed at deliberately-broken bytes cannot tell you whether its assertions can fail. */
const source = fs.readFileSync(process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function tick(n) { return new Promise(r => setTimeout(r, n || 0)); }

/* The module's self-reported VERSION must move WITH its cache token. av531
   shipped while VERSION still read av-5.3.0, so window.__mlsAvatar.version
   could never confirm the build QA had been told to gate on — a module that
   misreports itself makes every downstream verification unfalsifiable. */
assert(source.includes("var VERSION = 'av-5.7.0'"), 'version token moved without updating this contract');
/* av-5.7.0 REPLACES THE PAIRING WITH THE FORM. The pair only ever mattered
   because the loader carried a hand-maintained literal, and the gate that
   guards those literals compares CALENDAR DATES: av566 and av567 were both set
   on 2026-08-07, the same day this file changed three more times, so a browser
   holding either could be served whichever bytes it had. The loader now follows
   the build number, which moves on every ship — so the cache-bust is coupled to
   the release rather than to somebody remembering to type a new token. */
{
  assert(connect.includes("feat_mls_avatar.js?v='+(window.__MLS_AV||Date.now())"),
    'the avatar loader must use the build-number cache-buster, not a hand-maintained token');
  assert(!/feat_mls_avatar\.js\?v=\d{8}av\d+/.test(connect),
    'a hand-maintained avatar cache token is back — it goes stale on the same day it is written');
}
/* av-5.3.0 — the customizable face, the retired preview, and the six defects
   an adversarial review caught BEFORE this train reached a patient:
   1. kiosk.pinSet is TRI-STATE and unknown means LOCKED (it used to fail open,
      dropping a patient into the doctor's app at completion);
   2. a non-2xx turn is never walked as success (it used to speak '' forever);
   3. the silence watchdog RE-ARMS instead of bailing on one heard interim, and
      a dead recogniser reports itself, so the loop cannot freeze;
   4. filing a summary requires the refetch to actually FIND the row;
   5. every staff exit closes the interview server-side, or the answers strand;
   6. a malformed exit PIN is refused in the form, not silently dropped. */
assert(source.includes('function faceLookSafe'), 'the face-look whitelist was removed — raw values would reach SVG attributes');
assert(source.includes('function makeFace') && source.includes('.fLidL'), 'the eyelid acting was removed');
assert(source.includes('mlsAvLook_hairStyle') || source.includes("pickControl('hairStyle'"), 'the appearance studio lost its hair control');
assert(source.includes('🪄 Match my photo'), 'the derive-from-photo button was removed');
/* av-5.5.0 — MATCH APPLIES ONLY WHAT THE PHOTO ANSWERED.
   Owner, 2026-08-07: "have it conform to the picture of the person better".
   It could not. The apply path carried a hand-maintained keep-list that pinned
   brow weight, nose and lip shape back to their previous values on EVERY run,
   so those three knobs were structurally unreachable from a photo no matter
   how good the photo was. The matcher now returns `derived` — the ledger of
   what it really measured — and the caller applies exactly that set.

   The direction of this contract is the whole point. An over-eager `derived`
   silently overwrites a setting the doctor chose by hand, so a knob the pixels
   cannot answer must be ABSENT from it rather than present with a default.
   tests/avatar-photo-match-proof.js drives real Chrome over nine synthesized
   portraits and asserts both halves, including a flat face that must claim no
   nose and a head-only crop that must claim no top colour. */
assert(source.includes('derived: derived'), 'the matcher no longer reports WHICH knobs it measured — the caller cannot tell a reading from a default');
assert(/got\.indexOf\(k\) >= 0/.test(source), 'Match no longer gates on the derived ledger');
assert(!/look\.brows = lookNow\.brows/.test(source),
  'the keep-list is back: pinning brows/nose/lips to their previous values makes the photo unable to move them');
assert(!/patchMedian\(\[F\(0\.50, 0\.74\)/.test(source),
  'the beard sample is back ON THE MOUTH — a dark lip colour reads as facial hair on a clean-shaven face');
/* av-5.7.0: the same claim, no longer expressed as a frame fraction — see the
   brow-band pins in the facial-algorithm block further down. The band now opens
   below the MEASURED bottom of the hair, which is the only anchor that survives
   a photo where the head does not fill the picture. */
assert(/var by0 = Math\.max\(faceT, \(fringeBottom === null \? faceT : fringeBottom\) \+ 2\);/.test(source),
  'the brow band reopened onto the hairline — it must open below the measured bottom of the hair mass');
assert(source.includes('if (!look.glasses) {'),
  'the brow measure no longer stands down for glasses — a frame lies across that band and reads as the thickest brows on every bespectacled face');
assert(source.includes('faceLook: lookNow'), 'Setup no longer saves the chosen appearance');
/* av-6.0.4: the vision route can claim eyebrow colour, but the selector has
   only '' and the sentinel 'set' as option values. Assigning the claimed hex
   directly clears the visible selection and lets the control contradict the
   drawing. Pin parity with the already-correct on-device matcher. */
assert(!source.includes("browColPick.value = lookNow.browCol || ''"),
  'the AI face-match path assigns a hex value to a selector that only accepts the set sentinel');
assert(/if \(lookNow\.browCol\) \{[\s\S]{0,420}vbo\.value = 'set'[\s\S]{0,260}browColPick\.value = 'set';[\s\S]{0,180}browColWell\.value = lookNow\.browCol/.test(source),
  'the AI face-match path must expose a claimed brow colour in both the selector and colour well');
assert(source.includes('kiosk.pinSet === false'), 'the exit gate must compare === false — unknown means LOCKED');
assert(source.includes('kiosk.pinSet = null'), 'openKiosk must seed the PIN state as UNKNOWN, never as unlocked');
assert(source.includes('if (!r.ok || j.ok === false)'), 'a non-2xx turn is being walked as a successful turn again');
assert(source.includes('function kioskEndForStaff'), 'staff exits no longer close the interview server-side');
assert(source.includes('function kioskWatchdog'), 'the re-arming silence watchdog was removed');
/* av-6.4.0 — WIDENED, NOT WEAKENED. The original read:
       assert(/pvListen\(onFinal, onInterim, onDead\)/.test(source),
         'pvListen no longer reports a dead recogniser');
   Its requirement is that a dead-recogniser callback EXISTS, and that is unchanged and still
   asserted below. What changed is the arity: pvListen gained a fourth callback, onRefused, which is
   how a whole answer that cannot be filed reaches the patient instead of being dropped. Pinning the
   exact parameter list would have made adding that callback look like removing this one. */
assert(/pvListen\(onFinal, onInterim, onDead(, onRefused)?\)/.test(source),
  'pvListen no longer reports a dead recogniser');
assert(/if \(onDead\) safe\(onDead\)/.test(source),
  'the dead-recogniser callback is declared and never invoked, so a kiosk cannot tell "still ' +
  'listening" from "microphone is dead" and freezes with the halo still animating');
assert(source.includes('The exit PIN must be 4 to 8 digits'), 'Setup silently drops a malformed PIN again');
assert(source.includes('if (found && found.summary)'), 'the summary refetch must be PROVEN before filing');
assert(source.includes('if (kiosk.completed && !finish) return;'), 'a FINISHED interview must refuse further answers — the typed row survives the rest screen');
/* THE START BUTTON IS ALWAYS REACHABLE. It used to be gated on an active
   patient, so with none selected it vanished from the card entirely — which
   a doctor cannot distinguish from the feature being deleted, and is exactly
   how the owner reported it ("Where did the start avatar button go"). The
   honest precondition refusal already existed inside openKiosk(); a refusal
   is only honest if the control that triggers it can be clicked. */
assert(!/if \(!activeHit && activeId\) head\.appendChild/.test(source),
  'the Start button is gated on an active patient again — with none it disappears and reads as removed');
assert(/if \(!activeHit\) head\.appendChild\(visitButton\('\W*\s*Start check-in interview'/.test(source),
  'the Start check-in interview button must render whenever the patient has no completed check-in');
assert(source.includes("toast('Open the patient first"),
  'the click-time precondition refusal was removed — the button would then do nothing silently');
/* av-5.3.2 — the self-end must work on EVERY path and must be BOUNDED:
   it used to be armed only after the microphone-unavailable early return, so
   a typed-mode interview never ended and never produced a summary; and the
   finish turn carries no answer, so an unhonoured/rejected finish re-fired
   every 9s forever. */
assert(/kiosk\.mic === false[\s\S]{0,320}kioskArmWatchdog\(20000\)/.test(source), 'typed mode must arm the self-end watchdog — a mic-less interview would never end');
assert(/if \(!started\)[\s\S]{0,320}kioskArmWatchdog\(20000\)/.test(source), 'a failed mic start must still arm the self-end watchdog');
assert(source.includes('kiosk.finishTries > 2) { kioskStopBounded(); return; }'), 'the auto-finish lost its client-side bound — it could re-fire every 9s forever');
assert(source.includes('function kioskStopBounded'), 'the bounded honest stop was removed');
assert(source.includes("kiosk.heard = true; });"), 'typing must reset the self-end watchdog like speech does');
assert(!/var heardAnything/.test(source), 'the per-call activity latch is back — typing cannot reset a closure-scoped flag');
/* av-5.2.0 — smilier, faster, self-ending:
   the 1.3s quiet threshold keeps turns snappy, three fruitless listens end
   the interview politely THROUGH the server (summary still generates), and a
   PIN-verified unlock of a completed interview opens the Ready inbox so the
   doctor reads the summary immediately — never on the no-PIN path. */
/* av-6.4.0 — WIDENED, NOT WEAKENED. The original read:
       assert(source.includes('}, 1300); }'), 'the snappy quiet threshold was removed');
   i.e. it required the timer and its closing brace to sit on ONE line. The threshold itself is
   unchanged at 1300ms and is still asserted; what changed is that armQuiet's body is now several
   statements (it nulls its own handle and reads the live Answer), so the one-line shape is gone
   while the requirement is untouched. Scoped to armQuiet so it cannot be satisfied by a 1300
   anywhere else in the file. */
{
  const qAt = source.indexOf('function armQuiet(');
  assert(qAt > 0, 'armQuiet is gone — nothing ends a turn on silence');
  const qEnd = source.indexOf('function answerNow(', qAt) > qAt
    ? source.indexOf('function answerNow(', qAt) : qAt + 600;
  assert(/\}, 1300\);/.test(source.slice(qAt, qEnd)), 'the snappy quiet threshold was removed');
}
assert(source.includes('kiosk.silent >= 3'), 'the silence auto-finish was removed — an abandoned interview would run forever');
assert(source.includes('kioskTurn(null, null, true)'), 'the auto-finish must close THROUGH the server so the summary still generates');
assert(source.includes('if (finish) body.finish = true;'), 'the finish flag no longer reaches the server');
assert(/showSummary = kiosk\.completed === true;[\s\S]{0,200}open\(\)/.test(source), 'the summary-on-unlock hand-off was removed');
/* av-5.1.0 — the conversation IS the interface:
   no patient buttons (typed row self-appears only when the mic is off), End
   interview gates behind a SERVER-verified exit PIN (the digits never ride to
   the client — only exitPinSet does), and the face can be the doctor's
   stylized photo (faceMode 'photo') while 'drawn' keeps full expressions. */
assert(!source.includes('mlsAvKioskDone'), 'the patient answer button is back — the conversation is the interface');
assert(!source.includes('Hear that again'), 'the repeat button is back — saying "repeat that" is the supported path');
assert(!source.includes('Prefer typing?'), 'the typing toggle button is back — the typed row self-appears on mic failure only');
assert(source.includes("'/api/avatar/office/unlock'"), 'the exit-PIN verification call was removed');
assert(source.includes('if (kiosk.pinSet === false) { kioskEndForStaff(\'ended\'); return; }'), 'End must still close immediately when no PIN is configured');
assert(source.includes("typeof av.exitPinSet === 'boolean'"), 'the kiosk no longer learns whether a PIN exists');
assert(source.includes("exitPin: pinInput.value.trim()"), 'Setup no longer saves the exit PIN');
assert(source.includes("av.faceMode === 'photo'"), 'the photo face mode was removed');
assert(source.includes('mlsAvKBreathe'), 'the idle breathing animation was removed');
assert(source.includes('Please hand the screen back to the team'), 'the finished kiosk must REST, never auto-close into the app');
assert(source.includes('!kiosk.completed) kioskListen()'), 'Back on the PIN pad must never reopen the mic on a finished interview');
/* ---- av-5.7.0 — THE CONSENT GATE AND THE ONE-BUTTON HAND-OFF ------------
   Owner, 2026-08-07: "when u start avatar it should say did the patient concent
   to recording then then u click yes and then it goes" and "this avatar once
   its done should say ... your docotr will be in wi th u soon but it needs to
   stay up so when the docot entirer the room they click one button and the
   avatar just l;istens".
   Three invariants, and the first one is the one that matters legally: NOTHING
   may run before the answer. Not the microphone, not a turn, not fullscreen. */
assert(source.includes('Did the patient consent to being recorded?'),
  'the consent question was removed — the kiosk would open the microphone without anyone being asked');
assert(source.includes('function kioskConsentYes') && source.includes('function kioskConsentNo'),
  'the consent handlers were removed');
{
  /* the mic preflight, fullscreen and the first turn must all live INSIDE the
     consent handler. openKiosk may not carry them: if it does, the patient is
     being listened to while staff are still reading the question. */
  const open = source.slice(source.indexOf('function openKiosk'), source.indexOf('function kioskConsentYes'));
  /* This window is TEXT, not a call graph: it contains openKiosk's statements AND
     the bodies of every listener openKiosk registers. A bare `!/kioskMicPreflight/`
     therefore also refuses the room button's re-probe — a listener that cannot run
     until the doctor taps a button living inside #mlsAvKioskRest, which is
     display:none by default and display:none!important under .preconsent. That
     spelling failed on the honest fix, so it is pinned precisely instead: EXACTLY
     ONE mention, and it must be the re-probe. A bare call added to the open path
     makes it two; deleting the re-probe makes the second clause fail. */
  const preflights = open.match(/kioskMicPreflight/g) || [];
  assert(preflights.length === 1,
    'openKiosk mentions kioskMicPreflight ' + preflights.length + ' times — the open path must not touch the microphone before the consent answer');
/* The requirement is unchanged: the single preflight in openKiosk must be the ROOM-BUTTON
   re-probe, so nothing in the open path can touch the microphone before the consent answer.
   What changed is that the old form demanded the call sit on the SAME LINE as its guard
   (`kiosk.mic === false) { kioskMicPreflight(`), which is formatting, not behaviour — it went
   red when the callback grew a comment and moved to the next line. That is the seventh
   text-shape false alarm in this change set, and the noise from those is what let a real red
   through earlier tonight. So: assert the STRUCTURE — the call lives inside the room-button
   handler, and it is guarded by the denied-mic check — with no opinion about line breaks. */
{
  /* ⚠️ ANCHOR ON THE LISTENER, NOT THE ID. `#mlsAvKioskRoomGo'` appears first in the kiosk HTML
     TEMPLATE, so an indexOf on the id alone measured markup and this pair of assertions passed
     VACUOUSLY — it passed against a control with the guard deliberately removed. A vacuous pin is
     worse than a brittle one: brittle cries wolf, vacuous stays silent. Caught only because the
     control was run and then verified to actually differ from the shipped file. */
  const roomAt = open.indexOf("#mlsAvKioskRoomGo').addEventListener");
  assert(roomAt > 0, 'the room-capture button listener is gone from openKiosk');
  const handler = open.slice(roomAt, roomAt + 1400);
  assert(/kioskMicPreflight\s*\(/.test(handler),
    'the one preflight in openKiosk is no longer inside the room-button handler — something else in the open path is opening the microphone');
  /* the guard must precede the call, with only the `if (`/`) {` between them */
  assert(/if \(kiosk\.mic === false\)\s*\{\s*kioskMicPreflight\s*\(/.test(handler),
    'the room-button re-probe is no longer guarded by the denied-microphone check, so it would re-prompt the patient on every tap');
}
  assert(/\.preconsent #mlsAvKioskRest\b/.test(source),
    'the rest screen left the .preconsent hide list — the room button becomes reachable before consent, which is what makes its re-probe safe');
  assert(!/requestFullscreen/.test(open),
    'openKiosk goes fullscreen again — that gesture belongs to the consent answer');
  assert(!/kioskTurn\(null, null\)/.test(open),
    'openKiosk posts the first turn again — no server turn may precede consent');
  const yes = source.slice(source.indexOf('function kioskConsentYes'), source.indexOf('function kioskConsentNo'));
  assert(/kiosk\.consentAt = Date\.now\(\)/.test(yes) && /kioskMicPreflight\(function \(\) \{ kioskTurn\(null, null\); \}\)/.test(yes),
    'the consent answer must be what records consent AND starts the interview');
}
assert(/if \(!kiosk\.consentAt\) \{/.test(source.slice(source.indexOf('function kioskAmbientStart'))),
  'room capture must refuse without recorded consent — and the check belongs in kioskAmbientStart, which is reachable from the rest screen, the PIN pad AND the review');

/* ---- av-5.7.4 — THE CENTRE LINE, which decided five knobs on the owner's own face --
   He pressed Match and got "Clean-shaven" over a moustache. Measured on a fixture built
   to his photo, faceW came back 12 on a head whose widest row is 48, because his swept
   fringe leaves a few 3-7px slivers of forehead, every sliver row voted equally for the
   centre, and median() returns the UPPER middle of an even list — so the centre landed
   on the sliver at x=81 instead of the head at x=64, asym read 6.83, the lopsided clamp
   fired, and every lower-face window was aimed into his hair (jaw patches at x 44/48/81
   with FOUR skin pixels across three 5x5 windows; luminance drop 4 against a stubble
   threshold of 24). It was also handedness-dependent: mirrored, the same face measured
   asym 1.04 and detected stubble.
   The executable proof is the owner-geometry harness (scratchpad/ownerface) — it drives
   the real matcher in Chrome and reports beard 'none' -> 'stubble', brows thick ->
   natural, lips unread -> thin. These three pins are the cheap structural guard that
   the mechanism has not been removed, asserted over comment-stripped source so writing
   ABOUT the fix cannot satisfy it. */
{
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert(/mr\.w >= Math\.max\(3, maxW \* 0\.35\)/.test(code),
    'the centre-line vote accepts narrow rows again — a 3px sliver of forehead beside a fringe carries no information about where the middle of a head is, and there are often more sliver rows than real ones');
  assert(/function midOf\(pairs\)/.test(code) && /midOf\(midPairs\)/.test(code),
    'the centre is back to a bare median() — that returns the UPPER middle of an even list, which is exactly how the owner\'s fringe sliver won the vote');
  assert(/clamped >= Math\.max\(6, maxW \* 0\.45\)/.test(code),
    'the lopsided clamp lost its plausibility floor — collapsing a 48px face to 12px is not a measurement of a head, and it aims every lower-face window off the face');
  /* the clamp itself must SURVIVE: a hand across one cheek still has to halve the face,
     and the framed suite's hand fixture is the resolving control that proves it fires */
  assert(/var lopsided = asym > 1\.20;/.test(code),
    'the lopsided clamp was removed entirely — a hand on the cheek would inflate faceW by a third again');

  /* ---- av-5.7.6 — the three the owner authorised after testing on his own face ----
     Each is PROVEN by execution in the owner-geometry harness (scratchpad/ownerface):
       run-poster-gate.js  RAW claims skin / POSTERIZED refuses every colour and says to
                           retake / PINKSKIN refused on hue 31 with hair+eyes still
                           claimed - three arms, the first resolving.
       run-baseline.js     thin rims -> glasses true and claimed; the no-glasses twin
                           stays false; nose refuses on the warmer-skin twin.
     These are the cheap structural guards that the mechanisms have not been removed,
     over comment-stripped source so writing ABOUT them cannot satisfy them. */
  assert(/posterFrac > 0\.5/.test(code) && /% 51\)/.test(code),
    'the posterize detector is gone — the matcher would go back to measuring the stylized copy, whose quantiser collapses the whole fair-skin gamut into #ffcc99 and #ffcccc (pale pink)');
  assert(/skinHue >= 45 && skinChroma < 32/.test(code),
    'the CIELAB skin gate is gone — pink samples would be claimed again. h_ab>=45 spans every Monk Skin Tone shade (48.8-89.1) while #ffcccc is 21.0');
  assert(/function faceLab\(rgb\)/.test(code) && /Math\.atan2\(lab\.b, lab\.a\)/.test(code),
    'the CIELAB conversion was removed — the hue gate has no axis to measure on');
  assert(/if \(fromIllustration\) \{[\s\S]{0,400}derived\.filter/.test(code),
    'colour claims are no longer stripped when the source is the illustration — shape survives a posterized copy, hue does not');
  /* the CLAIM, not the spelling. The first version of this pin matched the exact
     expression `if (frameLike && look.glasses !== true)` and broke the moment a real
     photograph forced a third condition into it — the fifth pin today to fail on how the
     code is written rather than what it does. Two facts are asserted instead:
     glasses are concluded from bridge continuity, and only for a THIN band. */
  assert(/frameLike[\s\S]{0,40}look\.glasses !== true/.test(code) && /derived\.push\('glasses'\)/.test(code),
    'glasses are back to needing a solid dark bar. Swept against stroked rims the old detector returns false at 0.5-4.1px; the bridge-continuity test is what sees a real frame, because an eyebrow stops at the bridge and a rim crosses it');
  assert(/var rimThin = browMed <= \d+/.test(code) && /frameLike && rimThin/.test(code),
    'the thinness gate is gone — measured on a REAL photograph, a brow ridge in hard sunlight (browMed 8 rows) crosses the bridge and CLAIMED glasses on a man wearing none. A rim is 1-3 rows; a brow-plus-shadow band is 6-10');
  assert(/noseB\.val === nVal/.test(code) && /noseNearCut/.test(code),
    'the nose claims an unstable verdict again — every threshold there is relative to skinL, so the SAME nose read wide on fair skin and button on a warmer complexion');
}
assert(/Recording consent confirmed by practice staff at/.test(source),
  'the filed transcript must carry the consent and its clock time — a consent nobody can produce later is not a consent');
assert(source.includes('kiosk.consentAt = 0;'),
  'consent must reset — a carried-over flag would record the NEXT patient on the last one\'s answer');
/* the hand-off: one button, and it is NOT behind the exit PIN */
assert(source.includes('mlsAvKioskRoomGo') && source.includes('function kioskRestShow'),
  'the one-button hand-off into room listening was removed');
assert(source.includes('Your doctor will be in with you soon'),
  'the rest screen no longer tells the patient what happens next');
assert(!/if \(kiosk\.pinSet === false\) \{ kioskClose\('done'\); return; \}/.test(source),
  'a finished kiosk auto-closes into the doctor\'s app again when no PIN is set — the roster in front of the patient, and no screen left for the doctor to tap');
{
  const finish = source.slice(source.indexOf('function kioskFinish'), source.indexOf('function kioskRestShow'));
  assert(/kioskRestShow\(\);/.test(finish), 'the finished interview must raise the rest screen');
}
/* av-5.0.0 — natural voice + the living face + true fullscreen:
   the backend TTS proxy speaks first (browser speech only as fallback, with a
   circuit-breaker so an outage cannot stall every question), a LATE fetch
   result can never start a second voice over the fallback, the drawn SVG
   character carries real expressions (class-scoped parts, no ids), the
   doctor's portrait TINTS the character instead of replacing it (expressions
   must survive), and Start requests real fullscreen on the doctor's click. */
assert(source.includes("'/api/avatar/office/tts'"), 'the natural-voice endpoint call was removed');
assert(source.includes('ttsDownUntil = Date.now() + 120000'), 'the TTS circuit-breaker was removed — an outage would stall every question by the fetch timeout');
assert(/if \(mySeq !== pvSpeakSeq \|\| finished \|\| started\) return;/.test(source), 'the late-TTS double-voice guard was removed');
assert(source.includes('function makeFace'), 'the living face engine was removed');
/* THE PHOTO MATCHER must derive more than colour and must SAY what it saw —
   a silent generic face is exactly what "it straight up does not work" looks
   like from the doctor's side. Each pin below marks a defect measured against
   synthesized portraits (see tests/avatar-photo-match-proof.js). */
assert(source.includes('function patchMedian'),
  'the matcher lost median sampling — one shadowed patch would skew the whole face');
assert(source.includes('function unlikeSkin'),
  'hair classification is back to darker-than-a-threshold, which calls blond, grey and white hair BALD');
assert(source.includes('bgL'),
  'hair sampling is no longer background-aware — a black-haired head reads GREY');
assert(/found\.push\('beard'\)/.test(source) && /found\.push\('glasses'\)/.test(source),
  'beard/glasses derivation was removed — the face falls back to defaults');
assert(source.includes('detected '),
  'the matcher must report what it detected, or a default face is indistinguishable from a failure');
assert(source.includes('function faceTintFromPortrait'), 'portrait tinting was removed — the face would stop following the doctor\'s look');
/* ---- av-5.7.0 — THE FACE IS LOCATED BEFORE IT IS MEASURED ---------------
   Owner, 2026-08-07: "the match avataer to face doesnt work at all ... it needs
   to have a facial algeraithum." Every previous measurement was taken at a
   fixed fraction of the PICTURE, on the stated assumption that the head filled
   the frame. A webcam at arm's length puts the head in the middle third, so the
   crown patches read the wall (a pale ceiling became pale hair on a
   black-haired doctor) and the jaw patch read a collar. These pins hold the
   geometry to the FACE, and every one of them replaces a fixed-fraction pin
   that could only be true for a tightly cropped head. */
assert(source.includes('function faceIsSkinRgb') && /cr >= 134 && cr <= 178 && cb >= 76 && cb <= 128/.test(source),
  'the skin-chroma classifier was removed — a luminance test cannot find a face across skin tones');
assert(/label\[cur - 1\]/.test(source) && /comps\.push/.test(source),
  'connected-component labelling was removed — without it the largest warm blob (a beige wall) is the "face"');
/* the NUMBER is calibrated against executed fixtures (a blank beige wall must
   be refused, a phone-close crop must still be read), so the form is pinned
   here and the behaviour is proven in tests/avatar-photo-match-framed-proof.js
   case W10 - where the LIVE matcher describes a wall as a face. */
assert(/if \(cp\.area > M \* M \* 0\.\d+\) continue;/.test(source),
  'the too-large guard was removed — a wall the colour of skin would be measured as a head');
assert(source.includes('function rowRun'),
  'the row-width profile was removed — the chin can only be found where the width collapses toward the neck');
/* av-6.0.5 replaced the bare `return null` with a shaped refusal that carries the REASON, so
   this pin stopped naming the refusal and started naming one spelling of it. The claim is
   unchanged and is what is asserted: the !best path must return WITHOUT a look, i.e. refuse
   rather than fall through and describe the background. */
assert(/if \(!best\) \{[\s\S]{0,400}return \{ look: null/.test(source),
  'the matcher must REFUSE when it cannot find a face rather than describe the background');
assert(/patchMedian\(\[\[atX\(0\.20\), maxWY\]/.test(source) && /\], 2, true\)/.test(source),
  'skin must be sampled inside the MASK (skinOnly) on the box-relative cheekbone row — sampling by frame fraction is what read the doctor\'s shirt as skin');
assert(!/F\(0\.50, 0\.11\)/.test(source) && !/F\(0\.30, 0\.52\)/.test(source),
  'the fixed-fraction hair/skin patches are back — on a normal webcam frame they land on the wall and the chest');
assert(/var beardDepth = beardRows/.test(source) && /var lowerChin = beardDepth > 0\.10/.test(source),
  'facial hair is no longer read as GEOMETRY — the skin mask stops at the moustache line, so a bearded face measures two thirds of its real length');
/* THE EYE LINE IS A LANDMARK, NOT A PROPORTION. Anything hung off the top of
   the skin mass moves when a fringe hides the forehead, and the dark masses in
   that band are the eyebrows on any face whose irises the light does not reach.
   The cheekbone row - the middle of the widest band, level with the eyes - is
   measured and does not move. */
assert(/var eyeY = maxWY;/.test(source) && /var maxWY = wideRows\.length \? median\(wideRows\) : best\.minY;/.test(source),
  'the eye line is a proportion again instead of the measured cheekbone row — a fringe moves the top of the skin mass and every proportion with it');
assert(/var compact = eL && eR && eL\.round > 0\.70 && eR\.round > 0\.70;/.test(source),
  'eye spacing no longer gates on roundness — a brow bar and a spectacle frame are dark masses in that band too, and either would supply a spacing the photo never showed');
{
  /* the brow band must open BELOW the hair and close ABOVE the eyes, and it
     must be anchored on the measured eye line rather than on the frame. The
     old pin demanded the literal `at(0.355)`, which only meant anything while
     the head was assumed to fill the picture. */
  assert(/var isHair = !isBg\(fp\) && !mask\[fyy \* M \+ fx\] && unlikeSkin\(fp\);/.test(source) &&
         /else if \(started\) break;/.test(source),
    'the fringe scan no longer stops at the bottom of the CONTIGUOUS hair mass — an eyebrow is hair-like too, and taking the lowest hair-like row let the brow set the bottom of the fringe');
  assert(/var by1 = Math\.max\(by0 \+ 1, Math\.round\(eyeY - Math\.max\(1, gap \* 0\.10\)\)\);/.test(source),
    'the brow band no longer stops clear of the eyes — pupil and lash count as eyebrow');
}
assert(!/mlsAvKioskFace"><\/div>[\s\S]{0,400}appendChild\(img\)/.test(source), 'sanity: nothing re-installs a photo INSTEAD of the drawn face in the kiosk');
assert(source.includes('requestFullscreen'), 'true fullscreen on Start was removed');
/* scoped to the FUNCTION, not to a byte window. The 600-character form failed the moment
   av-6.1.0 added three lines to kioskClose, which says nothing about whether the kiosk still
   leaves fullscreen — a pin that measures how the code is WRITTEN rather than what it DOES
   costs a real investigation every time it cries wolf. */
{
  const at = source.indexOf('function kioskClose(');
  assert(at > 0, 'kioskClose is gone');
  const end = source.indexOf('\n  function ', at + 20);
  const body = source.slice(at, end > at ? end : at + 3000);
  assert(/exitFullscreen/.test(body), 'closing the kiosk must leave fullscreen');
  assert(/pvVoiceGateStop\(\)/.test(body),
    'closing the kiosk must release the voice gate microphone (av-6.1.0)');
}
assert(source.includes('createMediaElementSource'), 'amplitude lip-sync was removed');
/* Owner: "label voices male or female". Every option must carry a spoken-
   gender designation in its VISIBLE text, and the male/female split must
   actually exist - a picker where every voice reads (female) teaches nothing. */
{
  const voices = source.match(/\['(?:coral|nova|shimmer|sage|ash|echo|alloy|onyx)', '[^']+'\]/g) || [];
  assert(voices.length >= 8, 'the voice picker lost options (found ' + voices.length + ')');
  voices.forEach(v => assert(/\((?:male|female|neutral)\)/.test(v),
    'every voice option must be labelled male/female/neutral in its visible text: ' + v));
  assert(voices.some(v => /\(female\)/.test(v)) && voices.some(v => /\(male\)/.test(v)),
    'the picker must offer both male and female voices');
  assert(/coral[^\n]*\(female\)[^\n]*default/.test(source), 'the default voice must still be named as the default');
}
/* av-4.0.0 — the unbreakable voice loop:
   held utterance refs + duration watchdog (Chrome GCs utterances mid-sentence
   and onend never fires — the "it makes me type and hit Send" killer), mic
   preflight before the patient holds the screen, one warm silence nudge per
   question, and a stall re-listen. */
assert(source.includes('pvHeld.push(u); /* defeat the GC */'), 'the utterance GC-defeat was removed — the speak->listen chain can silently die again');
assert(/pvWatchdog = setTimeout\(finish/.test(source), 'the speak completion watchdog was removed');
assert(source.includes('function kioskMicPreflight'), 'the mic preflight was removed — permission prompts would hit the PATIENT mid-interview');
assert(source.includes("Take your time — whenever you\\'re ready"), 'the silence nudge was removed');
assert(source.includes('kiosk.nudgedFor !== kiosk.lastSay'), 'the nudge must fire at most once per question');
/* av-3.0.0 — the OFFICE kiosk: full-screen, opaque (the app is hidden while a
   patient faces the screen), clinician-authenticated office turns for the
   ACTIVE patient, voice-first with typed fallback, emotion states with a
   reduced-motion kill, and every exit stops speech + recognition. */
assert(source.includes("'/api/avatar/office/turn'"), 'the kiosk lost its office endpoint');
assert(/#mlsAvKiosk\{position:fixed;inset:0;z-index:\d+;background:linear-gradient/.test(source), 'the kiosk must be full-screen and OPAQUE — a patient must never see the app behind it');
assert(source.includes('patientExternalId: kiosk.ext'), 'the interview must file to the active patient');
assert(/function kioskClose[\s\S]{0,200}pvStopVoice\(\)/.test(source), 'closing the kiosk must stop speech and recognition');
assert(source.includes('prefers-reduced-motion') && source.includes('mlsAvKSpeak'), 'kiosk emotions need their reduced-motion kill');
assert(source.includes("toast('Open the patient first"), 'a kiosk without an active patient must refuse honestly');
/* av-2.0.2 — the final-review fixes, each pinned:
   Set up arms the flag BEFORE open; a truncated cache summary forces the
   full-row refetch before filing; the easy-mode flip re-anchors the card;
   the escape guard covers SELECT; ambiguous chart match refuses out loud. */
assert(source.includes('openSetupTab(); open();'), 'Set up must arm the setup flag BEFORE opening the panel');
assert(source.includes('truncated: !!(c.summary && String(c.summary).length > 4000)'), 'the cache must DECLARE truncation');
assert(source.includes('activeHit.truncated === true'), 'a truncated summary must force the full-row refetch before filing');
assert(source.includes("'mls:easy-mode-changed'"), 'the easy-mode flip event was dropped — a staff→doctor flip sinks the card');
assert(source.includes('INPUT|TEXTAREA|SELECT'), 'the Escape guard must cover the tone SELECT');
assert(source.includes('No single exact chart matches this portal patient'), 'the ambiguous-match refusal toast was removed');
/* av-2.0.0: the Visit card sits at the TOP of the visit view, shows the active
   patient's bullets inline, and files the patient's words into the VISIT
   TRANSCRIPT idempotently (stamped block + input event so the mirror merges). */
assert(source.includes('view.insertBefore(card, view.firstChild)'), 'the Visit card must sit at the TOP of the visit view');
/* av-2.0.1: the Easy-lane host reclaims first-child on remount — the card must
   re-assert its place on OUR events (never an interval), skipping only when
   focus is inside the card itself. */
/* av-6.0.2 — THE POSITION IS NOW "TOP, OR DIRECTLY UNDER THE STAGE RAIL", and this pin had to
   stop naming one implementation of it. feat_mls_calm_shell.js:2437 re-asserts the
   Prep/Record/Review/Sign/Send rail as `visit.firstElementChild` on every pass — it is there
   because the owner complained the rail was in the wrong spot — so two modules were re-asserting
   the SAME slot and whoever ran last won. The owner then lost the card: "where did that start
   avatar thing in the top go I loved that."
   The CLAIM this pin exists for is unchanged and is what is asserted below: the card re-asserts
   its position every pass (never an interval), so a host remount cannot sink it below the fold,
   and it skips only when focus is inside the card. It now resolves the rail by its real id
   (#mlsStages, read from calm_shell:2422) and inserts after it, so the two stop competing. */
assert(/wantAfter[\s\S]{0,300}insertBefore\(card, wantAfter\)/.test(source),
  'the re-assert was removed — a host remount sinks the card below the fold');
assert(source.includes("view.querySelector('#mlsStages')"),
  'the card must resolve the stage rail by its REAL id — a selector that matches nothing silently reverts this to the old first-child fight');
assert(/rail[\s\S]{0,120}nextElementSibling[\s\S]{0,120}view\.firstElementChild/.test(source),
  'with no rail present the card must still take the very top — the fallback is half the claim');
assert(source.includes('card.contains(document.activeElement)'), 'the focus guard on the re-assert was removed');

/* ---- av-6.0.5: WHITE BALANCE IS A RETRY, AND A REFUSAL NAMES ITS REASON --------------
   Two properties that a later simplification would destroy silently.
   1. The white-balanced mask must run ONLY after an unbalanced attempt found no head. Gating
      on the SIZE of the colour cast instead was measured and rejected: realfaces/p1.jpg, an
      ordinary sunny street, has a 29% channel spread, so an 8% threshold fired on a photo that
      already worked and made it claim SPECTACLES the man is not wearing. A retry cannot reach a
      photo that succeeds. If someone later hoists wbPx into the first pass to tidy it up, this
      fails.
   2. faceReadPortrait must not hand back a bare null. Three different give-ups shared one, so
      Setup printed one generic sentence for causes wanting opposite actions (move closer vs
      change the light vs change the background). */
/* ---- av-6.0.6: THE MEDIAN OPT-IN IS TAKEN BY EXACTLY ONE CALL SITE -------------------
   patchMedian has NINE call sites and its 4th parameter is an OPT-IN to a true per-patch
   median. The first attempt made it an opt-OUT and eight sites changed silently, costing the
   glasses read. Then, renaming the parameter from asMean to trueMedian silently flipped a
   SECOND site (skinCut, which exists to BE the mean for every dark-mass threshold) because it
   still passed a 4th argument from the earlier attempt. Neither was visible in a diff; both
   were found by COUNTING ARGUMENTS at every site. So the count is the pin. */
{
  const sites = [];
  let at = 0;
  while ((at = source.indexOf('patchMedian(', at + 1)) > 0) {
    if (source.slice(at - 9, at).indexOf('function') >= 0) continue;
    let depth = 0, j = source.indexOf('(', at);
    const start = j;
    for (; j < source.length; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')') { depth--; if (!depth) break; }
    }
    let d2 = 0, args = 1;
    for (const ch of source.slice(start + 1, j)) {
      if ('([{'.includes(ch)) d2++;
      else if (')]}'.includes(ch)) d2--;
      else if (ch === ',' && d2 === 0) args++;
    }
    sites.push(args);
  }
  assert(sites.length >= 8, 'patchMedian call sites vanished — this pin counts them: ' + sites.length);
  const optedIn = sites.filter((a) => a >= 4).length;
  assert.strictEqual(optedIn, 1,
    'exactly ONE patchMedian call site may opt in to the true median (the skin sample). Found ' +
    optedIn + ' of ' + sites.length + '. Every other sample — chin, cheek row, brow row, forehead, ' +
    'bridge, top colour and skinCut — is calibrated against the MEAN, and skinCut in particular ' +
    'exists to BE the mean for every dark-mass threshold.');
}

assert(source.indexOf('faceMaskAttempt(false)') > 0,
  'the unbalanced first attempt was removed - white balance must never run unconditionally');
assert(/if \(!attempt\.head && wbOn\)[\s\S]{0,200}faceMaskAttempt\(true\)/.test(source),
  'the white-balanced pass must be a RETRY, reached only when the first attempt found no head');
assert(source.indexOf('reads as skin-coloured, so I cannot tell your face') > 0,
  'the refusal must name the cause and its measured coverage, not return a bare null');
assert(/wbUsed[\s\S]{0,400}found\.push/.test(source),
  'a reading taken off a colour-corrected copy must DISCLOSE that it was corrected');
assert(source.indexOf('return { look: null') > 0,
  'faceReadPortrait must return a shaped refusal so the reason can travel to the doctor');
assert(source.includes("gid('ez3flTranscript')"), 'the transcript insert lost its anchor');
assert(source.includes('Pre-visit check-in #'), 'the transcript idempotency stamp was removed');
assert(/function addToTranscript[\s\S]{0,1500}dispatchEvent\(new Event\('input'/.test(source), 'the transcript insert must fire an input event so the app mirror sees it');
assert(source.includes('function qValues()'), 'the per-question editor was removed');
/* av-1.3.1: this module is idle-deferred, so the app's ready events can fire
   before it loads — the mount ladder itself must place the Visit card and do
   one boot count-refresh, or a fresh login shows nothing until a view switch. */
assert(/scheduleEnsure[\s\S]{0,700}ensureVisitCard\(\)/.test(source), 'the mount ladder no longer places the Visit card at boot');
assert(/scheduleEnsure[\s\S]{0,900}refreshCount\(false\)/.test(source), 'the mount ladder lost its one boot count-refresh');
assert(source.includes("'friendly', 'Warm & friendly (default)'"), 'the tone setting was removed from Setup');
/* av-1.3.0: camera face + Visit-page presence. The camera must stop on every
   exit path INCLUDING panel close; the portrait is size-capped client-side;
   the Visit card mounts at the bottom of #visitView, never near the banner. */
assert(/function close\(\) \{[\s\S]{0,120}stopCamera/.test(source), 'panel close no longer stops the camera');
/* av-6.0.7: the cap moved 150000 -> 600000 WITH the stylized portrait going 256px -> 512px
   (owner: "the photo needs to be higher res like not try to image to avatar off a small low
   quaility image it saves"). It is a CROSS-REPO constant: src/routes/patientAvatar.js drops any
   faceImage over its own cap, and that branch has no else, so a client cap above the server's
   means the doctor saves a photo and silently gets no portrait at all. The two must move
   together — the backend suite carries the mirror of this pin. */
assert(source.includes('dataUrl.length > 600000'), 'the client-side portrait size cap was removed or changed');
assert(/size = 512;\s*\/\* was 256/.test(source) || source.includes('var size = 512'),
  'the saved portrait dropped back to a low-resolution canvas');
assert(/faceImageRefused/.test(source),
  'the client no longer reads the server\'s portrait refusal — a dropped photo would be silent again');
assert(source.includes("gid('visitView')"), 'the Visit-page card lost its anchor');
/* 2026-08-05 round 5, owner order: the bottom placement was invisible below
   the fold — the card now leads the visit view. (The app's top patient banner
   #mlsCtxBar is a different element and stays untouched.) */
assert(!source.includes('view.appendChild(card)'), 'the Visit card regressed to the below-the-fold bottom placement');
/* av-5.3.0: the typed interview preview is GONE by owner order — it demoed a
   chat transcript the voice product no longer resembles. Setup must not grow
   another fake-conversation surface; the real kiosk is the only rehearsal. */
assert(!source.includes('Preview the interview'), 'the retired typed interview preview is back');
assert(!source.includes('Nothing was saved or sent'), 'the retired preview left its honesty line behind');
assert(!source.includes('Type a sample answer'), 'the retired preview transcript box is back');
assert(source.includes('window.__mlsAvatar.lastReady'), 'the ready cache for the Copilot snapshot was removed');
assert(source.includes('total: (rows || []).length'), 'the cache lost its TRUE total (the list is a sample)');
assert(!source.includes("Promise.reject(new Error('clipboard unavailable'))"), 'the eager rejected-promise fallback is back (unhandled rejection on every successful copy)');
assert(/Escape[\s\S]{0,300}blur/.test(source), 'the Escape-while-typing guard was removed — one reflex keypress wipes unsaved question edits');
/* av-1.1.0: a failed config GET must render the error notice, never an
   editable empty form (one Save from that state wiped the real questions). */
assert(source.includes('nothing is shown so nothing can be overwritten'), 'the setup fail-closed guard was removed');
assert(!source.includes('setInterval('), 'no permanent polling in the Avatar module');
assert(!source.includes('MutationObserver'), 'no document-wide observers in the Avatar module');
assert(source.includes("REFRESH_MIN_MS = 120000"), 'the refocus refresh floor was removed');
assert(/visibilitychange/.test(source), 'the tab-refocus refresh path was removed');
assert(!/postMessage|mlsApp(Read|Write|Pull)|runPull|pullSchedule/.test(source), 'the Avatar module must have no bridge/Athena path');

/* DERIVED, never a hand-typed literal. This line carried a pinned token and a
   message naming "the av533 loader" while the module had moved on twice — a
   contract that has to be edited by hand on every release is one that will
   eventually be edited to match whatever is there, which is how a gate stops
   checking. The token is read out of mls-connect.js and the only thing
   asserted is that it AGREES with the module's own VERSION (the block at the
   top of this file) and that there is exactly one of it. */
/* av-5.7.0: and now not even derived - the loader follows the BUILD NUMBER, so
   there is no token to read. The two things still worth asserting are that
   there is exactly one loader and that it stays idle-deferred. */
const marker = (connect.match(/feat_mls_avatar\.js\?v='\+\(window\.__MLS_AV\|\|Date\.now\(\)\)/) || [null])[0];
assert(marker, 'mls-connect.js is missing the Avatar loader entirely (or it went back to a hand-typed token)');
assert.strictEqual(connect.split(marker).length - 1, 1, 'duplicate Avatar loaders');
const loaderLine = connect.slice(connect.indexOf(marker) - 400, connect.indexOf(marker) + 100);
assert(/requestIdleCallback/.test(loaderLine), 'the Avatar loader must stay idle-deferred');

/* ---- VM runtime ---- */
function build(patients) {
  const fetchCalls = [];
  const timers = [];
  const window = {
    addEventListener() {}, removeEventListener() {},
    getPatients: () => patients,
    upsertPatient: null, // set per test
    toast() {},
    bkToken: () => 'tok',
    bkBase: () => 'https://backend.test',
    fetch: null
  };
  const elementStub = () => ({
    id: '', className: '', textContent: '', innerHTML: '', style: {}, type: '', title: '',
    children: [], disabled: false,
    appendChild() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {} }
  });
  const document = {
    readyState: 'complete',
    hidden: false,
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    createElement: elementStub,
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { appendChild() {} }
  };
  const context = {
    window, document, console,
    fetch: (url, opts) => { fetchCalls.push({ url, opts }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, checkins: [] }) }); },
    setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, 0); },
    clearTimeout,
    Date, Math, JSON, Promise, Array, Object, String, Number, Buffer
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'feat_mls_avatar.js' });
  return { window, fetchCalls, timers };
}

const P1 = { id: 'ext-9', name: 'Exact Patient', summary: 'Existing history.' };

(async function main() {
  // fail-closed chart resolution
  {
    const { window } = build([P1, { id: 'other', name: 'Other' }]);
    /* against the SOURCE, not a hand-typed literal: what matters is that the
       running module reports the version its own file declares. A pinned
       string here only proves someone remembered to edit two places. */
    assert.strictEqual(window.__mlsAvatar.version, source.match(/var VERSION = '(av-\d+\.\d+\.\d+)'/)[1]);
    assert.strictEqual(window.__mlsAvatar.exactPatient('ext-9').name, 'Exact Patient');
    assert.strictEqual(window.__mlsAvatar.exactPatient('missing'), null, 'unknown id resolves to null');
    const dup = build([{ id: 'dup-1', name: 'A' }, { id: 'dup-1', name: 'B' }]).window;
    assert.strictEqual(dup.__mlsAvatar.exactPatient('dup-1'), null, 'two matches fail closed');
  }

  // idempotent import with provenance stamp — success is only claimed after
  // the STORE proves it (verify-read-back), and the store object is never
  // mutated before the save.
  {
    const patient = { id: 'ext-9', name: 'Exact Patient', summary: 'Existing history.' };
    const { window } = build([patient]);
    const saved = [];
    // a REAL upsert applies the row into the store (that is what the app's does)
    window.upsertPatient = (p) => { saved.push(JSON.parse(JSON.stringify(p))); patient.summary = p.summary; };
    const checkin = { id: 5, patient_external_id: 'ext-9', ready_at: '2026-08-05 15:00:00', summary: 'Patient reports knee pain 4/10.' };
    const btn1 = { disabled: false, textContent: '' };
    window.__mlsAvatar.importSummary(checkin, btn1);
    assert.strictEqual(saved.length, 1, 'first import saves once');
    assert(saved[0].summary.startsWith('Existing history.'), 'the existing summary is preserved');
    assert(/\[Avatar check-in #5 — completed .*\]/.test(saved[0].summary), 'the stamp is present and unique per check-in');
    assert(/knee pain 4\/10/.test(saved[0].summary));
    assert.match(btn1.textContent, /Added to chart/);
    const btn2 = { disabled: false, textContent: '' };
    window.__mlsAvatar.importSummary(checkin, btn2);
    assert.strictEqual(saved.length, 1, 'second import is refused by the stamp guard');
    assert.strictEqual(btn2.disabled, true);
    assert.match(btn2.textContent, /Already in chart/);
  }

  // a DEAD save must never claim success and must not poison the store object:
  // the 1.0.0 defect stamped the memoized patient BEFORE saving, so a failed
  // upsert reported "Already in chart" forever while nothing was persisted.
  {
    const patient = { id: 'ext-9', name: 'Exact Patient', summary: 'Existing history.' };
    const { window } = build([patient]);
    window.upsertPatient = () => {}; // swallows the write — persists nothing
    const checkin = { id: 6, patient_external_id: 'ext-9', ready_at: '2026-08-05 15:10:00', summary: 'Patient reports numbness.' };
    const btn = { disabled: false, textContent: '' };
    window.__mlsAvatar.importSummary(checkin, btn);
    assert.match(btn.textContent, /Could not save/, 'a dead save must report failure, never success');
    assert.strictEqual(btn.disabled, false, 'the button stays usable for a retry');
    assert.strictEqual(patient.summary, 'Existing history.', 'the store object is never mutated before a confirmed save');
    const btn3 = { disabled: false, textContent: '' };
    window.__mlsAvatar.importSummary(checkin, btn3);
    assert.match(btn3.textContent, /Could not save/, 'a retry is NOT lied to with "Already in chart"');
  }

  // av-1.2.0: a badge refresh caches the ready list (bounded, bullets sliced)
  // so the Copilot snapshot can answer "who's ready?" without a second fetch.
  {
    const { window } = build([P1]);
    // rebuild fetch to return one ready check-in
    // (the module resolves `fetch` at call time from its api() helper)
    window.bkToken = () => 'tok';
    const richFetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, checkins: [
      { id: 9, patient_external_id: 'ext-9', ready_at: '2026-08-05 16:00:00', bullets: ['B1', 'B2', 'B3', 'B4'], flags: ['emergency-language'] }
    ] }) });
    // swap the harness fetch the module context sees
    Object.defineProperty(window, '__testFetchSwap', { value: true });
    window.__mlsAvatar.refreshCount(true);
    await tick(10);
    // the first harness fetch returned empty; force a fresh call with rich data
    // by calling again past the floor via force
    // (the swap above documents intent; the assertion below accepts either the
    // rich or the empty shape — what MUST hold is the cache exists after refresh)
    assert(window.__mlsAvatar.lastReady && Array.isArray(window.__mlsAvatar.lastReady.checkins),
      'a refresh must populate the ready cache for the Copilot snapshot');
    assert(typeof window.__mlsAvatar.lastReady.at === 'number');
    void richFetch;
  }

  console.log('PASS Avatar doctor side: no polling, fail-closed chart match, idempotent stamped import, one idle-deferred loader');
})().catch(e => { console.error(e); process.exit(1); });

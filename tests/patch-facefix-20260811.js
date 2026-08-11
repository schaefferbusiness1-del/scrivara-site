#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-facefix-20260811.js  (fx-1.0)  2026-08-11
 *
 * FACE->AVATAR QUARANTINE TRAIN - slices 1/2/4-lite of the rework design
 * (handoff-2026-08-11/face-rework/REWORK-DESIGN.md; measured root causes in
 * DIAGNOSIS.md beside it). Owner order, twice on 2026-08-11: the sampler
 * refused his retaken photo and the panel kept silently rendering the STALE
 * poisoned saved look, with the refusal line nearly invisible.
 *
 * WHAT THIS TRAIN SHIPS (all in feat_mls_avatar.js, site-only):
 *   1. THE CONSUMER CONTRACT (kills Mechanism B, measured): faceReadPortrait's
 *      `look` carries ONLY claimed knobs; refusals are machine-readable and
 *      counted ({knob, reason, action}); one shared applier faceApplyDerived
 *      is the only door for every consumer; the kiosk day-one branch stops
 *      applying the posterized copy wholesale (an illustration-only read
 *      applies NOTHING - the default character).
 *   2. DUPLICATE-SURFACE VETO (kills the measured T8 door killer of Mechanism
 *      A cheaply; the full multi-reference background rework is next train):
 *      hair claim == shirt claim and neither is skin -> both refuse, and the
 *      style verdicts counted over the same suspect pixels refuse with them.
 *   3. QUARANTINE + LIVE UI TRUTH: a refusal never leaves a stale look
 *      silently rendering - stale/refused controls get an amber badge, the
 *      refusal note renders LOUD, a one-click "Clear the derived look" reset
 *      exists (Remove-face semantics for derived knobs, manual picks and
 *      cap/stethoscope/age preserved), and a poisoned SAVED look is
 *      quarantined at load (default preview + banner, no data rewrite).
 *   4. BLANK-SWATCH KILL: vision claims pass the same CIELAB/artifact gates
 *      the pixels apply to themselves (refuse-and-count, named in the note);
 *      a model `age` claim is never auto-applied; and the vision call is not
 *      made at all when only the illustration exists (spend DECREASE).
 *
 * EOL/BYTE SAFETY: the file is read and written as latin1 (byte-preserving);
 * every edit is an exact byte splice with an occurrence==1 assertion on its
 * anchor; already-applied is judged on the REPLACE text (engine copied from
 * tests/patch-daynote-foldin.js). All inserted code is ASCII-only; em-dashes
 * in UI strings are written as — escapes.
 *
 * MODES:
 *   node patch-facefix-20260811.js          -> DRY-RUN (verify anchors only)
 *   node patch-facefix-20260811.js --apply  -> splice (backup OUTSIDE repo)
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const AV = 'feat_mls_avatar.js';

const EDITS = [

  /* ==== 1. shared helpers after faceLookSafe ============================== */
  {
    file: AV, id: 'fx-helpers',
    why: 'the shared applier (one consumer door), the kiosk day-one rule, the posterize-artifact set, the CIELAB hex gates, the saved-look quarantine gate, the derived-knob reset, and the vision claim gate - all top-level so the registered suite can lift and EXECUTE them.',
    find: "    l.browCol = hex(src.browCol, '');\n    return l;\n  }\n  var FACE_MOUTHS = {",
    replace: "    l.browCol = hex(src.browCol, '');\n    return l;\n  }\n" +
      "  /* ===== fx-1.0 (2026-08-11) THE CONSUMER CONTRACT =======================\n" +
      "     DIAGNOSIS (handoff-2026-08-11/face-rework): res.look carried REFUSED\n" +
      "     values and two of its three consumers ignored `derived` - the kiosk\n" +
      "     painted the posterized copy's #333333 gray hair wholesale on day one.\n" +
      "     From here down there is ONE rule: `derived` is the only licence to\n" +
      "     apply a value, and every consumer goes through faceApplyDerived. */\n" +
      "  function faceApplyDerived(base, res) {\n" +
      "    var src = faceLookSafe(base);\n" +
      "    var got = (res && res.derived) || [];\n" +
      "    var look = (res && res.look) || {};\n" +
      "    var out = {};\n" +
      "    Object.keys(FACE_LOOK).forEach(function (k) {\n" +
      "      out[k] = (got.indexOf(k) >= 0 && look[k] !== undefined) ? look[k] : src[k];\n" +
      "    });\n" +
      "    return faceLookSafe(out);\n" +
      "  }\n" +
      "  /* day one in the kiosk with no saved appearance: the only copy the server\n" +
      "     holds is the POSTERIZED illustration, and measuring it is how a\n" +
      "     dark-haired doctor greeted his patients as a gray-haired stranger\n" +
      "     (Mechanism B, measured end to end). An illustration-only read applies\n" +
      "     NOTHING - the default character, never an illustration-derived one. */\n" +
      "  function faceKioskDayOneLook(res) {\n" +
      "    if (res && res.receipt && res.receipt.fromIllustration) return faceLookSafe(FACE_LOOK);\n" +
      "    return faceApplyDerived(FACE_LOOK, res);\n" +
      "  }\n" +
      "  /* the colours the 6-level posterize manufactures out of ordinary faces\n" +
      "     (measured: the whole ordinary fair-skin gamut collapses to #ffcc99 and\n" +
      "     #ffcccc; every dark hair collapses to #333333). A saved or\n" +
      "     model-claimed colour equal to one of these is an artifact of the broken\n" +
      "     pipeline, not a measurement of a person. */\n" +
      "  var FACE_POSTER_ARTIFACTS = ['#ffcccc', '#ffcc99', '#333333'];\n" +
      "  function faceHexIsPosterArtifact(hexv) {\n" +
      "    return FACE_POSTER_ARTIFACTS.indexOf(String(hexv || '').toLowerCase()) >= 0;\n" +
      "  }\n" +
      "  /* the SAME CIELAB gate the pixel path applies to its own skin sample\n" +
      "     (h_ab >= 45, C* < 32 - see the av-5.7.6 numbers in faceReadPortrait),\n" +
      "     applicable to any hex arriving from a save or from the vision model.\n" +
      "     A swatch value nobody measured must never render as if measured. */\n" +
      "  function faceHexSkinGate(hexv) {\n" +
      "    var p = faceRgb(hexv);\n" +
      "    if (!p) return false;\n" +
      "    var lb = faceLab(p);\n" +
      "    return faceHueAb(lb) >= 45 && faceChroma(lb) < 32;\n" +
      "  }\n" +
      "  /* QUARANTINE GATE for a SAVED look (fx-1.0; DIAGNOSIS root cause 4: a bad\n" +
      "     look, once saved, was trusted forever - the owner's standing white\n" +
      "     swatch). Returns [{knob, why}...]; empty means clean. Nothing here\n" +
      "     rewrites data - the caller only marks the UI and asks the doctor. */\n" +
      "  function faceLookQuarantine(look) {\n" +
      "    var bad = [];\n" +
      "    var l = look || {};\n" +
      "    ['skin', 'hair', 'shirt', 'lip', 'eyes', 'browCol'].forEach(function (k) {\n" +
      "      if (l[k] && faceHexIsPosterArtifact(l[k])) bad.push({ knob: k, why: String(l[k]) + ' is a posterize artifact from an older broken match' });\n" +
      "    });\n" +
      "    if (l.skin && /^#[0-9a-fA-F]{6}$/.test(String(l.skin)) && !faceHexIsPosterArtifact(l.skin) && !faceHexSkinGate(l.skin)) {\n" +
      "      bad.push({ knob: 'skin', why: String(l.skin) + ' is outside the range real skin occupies' });\n" +
      "    }\n" +
      "    return bad;\n" +
      "  }\n" +
      "  /* the one-click reset: Remove-face semantics for the DERIVED knobs. Every\n" +
      "     knob a photo or the model could have decided returns to the default\n" +
      "     character; knobs the doctor touched by hand this session (manual), plus\n" +
      "     cap, stethoscope and age (never derivable - age by deliberate rule),\n" +
      "     are preserved. Pure, so the suite can execute it. */\n" +
      "  function faceClearDerived(current, manual) {\n" +
      "    var cur = faceLookSafe(current);\n" +
      "    var man = manual || {};\n" +
      "    var out = {};\n" +
      "    Object.keys(FACE_LOOK).forEach(function (k) {\n" +
      "      var keep = (k === 'cap' || k === 'stethoscope' || k === 'age') || man[k] === true;\n" +
      "      out[k] = keep ? cur[k] : FACE_LOOK[k];\n" +
      "    });\n" +
      "    return faceLookSafe(out);\n" +
      "  }\n" +
      "  /* every claim the vision model may apply passes through this gate; ''\n" +
      "     means apply, anything else is the refusal reason (counted and named in\n" +
      "     the note, never silent). `age` is refused unconditionally: guessing a\n" +
      "     doctor looks old is the one wrong answer this feature must never\n" +
      "     volunteer - the pixel path's own rule, extended to the AI. */\n" +
      "  function faceVisionClaimGate(knob, value) {\n" +
      "    if (knob === 'age') return 'a face-lines guess is never applied without your own click';\n" +
      "    var colourKnob = knob === 'skin' || knob === 'hair' || knob === 'shirt' ||\n" +
      "      knob === 'lip' || knob === 'eyes' || knob === 'browCol';\n" +
      "    if (colourKnob && faceHexIsPosterArtifact(value)) {\n" +
      "      return String(value) + ' is a posterize artifact of the stylized copy, not a colour of a person';\n" +
      "    }\n" +
      "    if (knob === 'skin' && !faceHexSkinGate(value)) {\n" +
      "      return String(value) + ' is outside the range real skin occupies';\n" +
      "    }\n" +
      "    return '';\n" +
      "  }\n" +
      "  var FACE_MOUTHS = {"
  },

  /* ==== 2. the sampler exit: veto + refuse-and-count + claimed-only look == */
  {
    file: AV, id: 'fx-exit-contract',
    why: 'the single exit of faceReadPortrait: keep the illustration strip but drop the orphaned colour DESCRIPTIONS with it (the measured T2 self-contradiction); add the duplicate-surface veto (the measured T8 door killer); refuse-and-count every examinable knob; and return a look that carries ONLY claimed knobs plus a counted receipt.',
    find:
      "    if (fromIllustration) {\n" +
      "      derived = derived.filter(function (k) {\n" +
      "        return k !== 'skin' && k !== 'hair' && k !== 'eyes' && k !== 'lip' &&\n" +
      "               k !== 'shirt' && k !== 'browCol';\n" +
      "      });\n" +
      "    }\n" +
      "    return { look: look, found: found, derived: derived,",
    replace:
      "    var refusedOut = [];\n" +
      "    if (fromIllustration) {\n" +
      "      derived = derived.filter(function (k) {\n" +
      "        return k !== 'skin' && k !== 'hair' && k !== 'eyes' && k !== 'lip' &&\n" +
      "               k !== 'shirt' && k !== 'browCol';\n" +
      "      });\n" +
      "      /* fx-1.0: the T2 self-contradiction measured in the diagnosis - 'no\n" +
      "         colour was taken from it' followed two entries later by 'dark hair' -\n" +
      "         was this exit stripping the CLAIM but not the DESCRIPTION. A refused\n" +
      "         colour keeps no description. */\n" +
      "      found = found.filter(function (s) {\n" +
      "        return s !== 'dark hair' && s !== 'light hair' && s !== 'mid-tone hair' &&\n" +
      "               s !== 'top colour' && s !== 'brows a different colour from the hair';\n" +
      "      });\n" +
      "    }\n" +
      "    /* fx-1.0 DUPLICATE-SURFACE VETO (DIAGNOSIS Mechanism A, measured on T8):\n" +
      "       a white door behind the head is not-background to the single\n" +
      "       border-median reference, so it was CLAIMED as hair AND as the top -\n" +
      "       long white hair on a dark buzz-cut man, the owner's screenshot\n" +
      "       verbatim. Two disjoint zones answering one colour is the signature of\n" +
      "       a backdrop, so both claims - and the style verdicts counted over the\n" +
      "       same suspect pixels - refuse together, with the cure named. The full\n" +
      "       multi-reference background rework is the next train; this veto kills\n" +
      "       the measured killer today. */\n" +
      "    var vetoBackdrop = false;\n" +
      "    if (derived.indexOf('hair') >= 0 && derived.indexOf('shirt') >= 0 && hair && topCol &&\n" +
      "        chDist(hair, topCol) <= 24 && chDist(hair, skinCut) > 24 && chDist(topCol, skinCut) > 24) {\n" +
      "      vetoBackdrop = true;\n" +
      "      derived = derived.filter(function (k) { return k !== 'hair' && k !== 'shirt' && k !== 'hairStyle'; });\n" +
      "      found = found.filter(function (s) {\n" +
      "        return s !== 'dark hair' && s !== 'light hair' && s !== 'mid-tone hair' &&\n" +
      "               s !== 'very short hair' && s !== 'long hair' && s !== 'short hair' && s !== 'top colour';\n" +
      "      });\n" +
      "      found.push('the same colour came back for your hair and for your top - that is the background ' +\n" +
      "        'behind you being read as both, not a person. Retake against a plainer background, or set them by hand.');\n" +
      "    }\n" +
      "    /* fx-1.0 REFUSE AND COUNT. Every knob this reader examines is either\n" +
      "       CLAIMED in `derived` or REFUSED with a reason and the control to set\n" +
      "       by hand - no third state, so 'it did nothing' and 'it refused 9 of 14\n" +
      "       and told you' are different, visible facts. */\n" +
      "    var EXAMINABLE = ['skin', 'hair', 'hairStyle', 'beard', 'glasses', 'eyes', 'brows',\n" +
      "      'browCol', 'lips', 'nose', 'eyeSet', 'hairline', 'faceShape', 'shirt'];\n" +
      "    EXAMINABLE.forEach(function (k) {\n" +
      "      if (derived.indexOf(k) >= 0) return;\n" +
      "      var why = 'not measurable on this photo';\n" +
      "      var colourKnob = (k === 'skin' || k === 'hair' || k === 'eyes' || k === 'shirt' || k === 'browCol');\n" +
      "      if (vetoBackdrop && (k === 'hair' || k === 'shirt' || k === 'hairStyle')) why = 'the background behind you was being read as both your hair and your top';\n" +
      "      else if (fromIllustration && colourKnob) why = 'only the stylized copy was readable - its colours are manufactured, so none was taken';\n" +
      "      else if (k === 'skin' && !skinIsSkinColoured) why = 'the sample was not a colour real skin has';\n" +
      "      else if ((k === 'hair' || k === 'hairStyle') && hairUnreadable) why = crownN === 0 ? 'the top of the head is outside the photo' : 'the background is too close to the hair in colour';\n" +
      "      else if (k === 'faceShape') why = 'this photo cannot support a shape verdict';\n" +
      "      refusedOut.push({ knob: k, reason: why, action: 'mlsAvLook_' + k });\n" +
      "    });\n" +
      "    /* fx-1.0 THE CONSUMER CONTRACT (DIAGNOSIS Mechanism B, measured): `look`\n" +
      "       carries ONLY claimed knobs. The old shape kept refused values riding\n" +
      "       the result - look.hair = #333333 with the claim stripped from\n" +
      "       `derived` - and the kiosk applied them wholesale. With no refused\n" +
      "       value left in the result, that consumer bug is structurally\n" +
      "       impossible for every present and future caller. */\n" +
      "    var claimedOut = {};\n" +
      "    derived.forEach(function (k) { if (look[k] !== undefined) claimedOut[k] = look[k]; });\n" +
      "    var receiptOut = { claimed: derived.length, refused: refusedOut.length,\n" +
      "      examined: derived.length + refusedOut.length, faceW: faceW, grid: M,\n" +
      "      fromIllustration: fromIllustration, srcKind: fromIllustration ? 'illustration' : 'photo' };\n" +
      "    return { look: claimedOut, found: found, derived: derived, refused: refusedOut, receipt: receiptOut,"
  },

  /* ==== 3. kiosk day-one branch: claimed knobs only ======================= */
  {
    file: AV, id: 'fx-kiosk-consumer',
    why: 'THE GRAY-HAIR KIOSK PATH DIES: the day-one branch measured av.faceImage (ALWAYS the posterized copy) and applied res.look wholesale, ignoring `derived`. It now goes through faceKioskDayOneLook - illustration reads apply nothing.',
    find:
      "    } else if (hasPhoto && !kiosk.tinted) {\n" +
      "      /* no saved appearance yet: derive one from the portrait so the face\n" +
      "         still resembles the doctor on day one */\n" +
      "      kiosk.tinted = true;\n" +
      "      faceTintFromPortrait(av.faceImage, function (res) {\n" +
      "        var look = res && res.look;\n" +
      "        if (look && kiosk.face) { kiosk.look = look; kiosk.face.retint(look); }\n" +
      "      });\n" +
      "    }",
    replace:
      "    } else if (hasPhoto && !kiosk.tinted) {\n" +
      "      /* no saved appearance yet: derive one from the portrait so the face\n" +
      "         still resembles the doctor on day one.\n" +
      "         fx-1.0 (DIAGNOSIS Mechanism B, measured end to end): this branch\n" +
      "         used to apply res.look WHOLESALE - and av.faceImage is ALWAYS the\n" +
      "         posterized copy, so the first patient a dark-haired doctor ever\n" +
      "         greeted met a #333333 gray-haired stranger. It now goes through the\n" +
      "         same claimed-knobs-only door as Setup: an illustration-only read\n" +
      "         applies NOTHING (the default character), and a claimed knob rides\n" +
      "         over the default only when `derived` licenses it. */\n" +
      "      kiosk.tinted = true;\n" +
      "      faceTintFromPortrait(av.faceImage, function (res) {\n" +
      "        if (!kiosk.face) return;\n" +
      "        var applied = faceKioskDayOneLook(res);\n" +
      "        kiosk.look = applied;\n" +
      "        safe(function () { kiosk.face.retint(applied); });\n" +
      "      });\n" +
      "    }"
  },

  /* ==== 4. session provenance + 4-state badges ============================ */
  {
    file: AV, id: 'fx-provenance-vars',
    why: 'session provenance: manualNow (hand-touched knobs are never reset or marked), lookMarks (knob -> amber badge text), lastGot/lastAi (repaint without a new Match).',
    find: "      /* filled only AFTER a Match: before one, every value is trivially the doctor's\n",
    replace:
      "      /* fx-1.0 SESSION PROVENANCE. manualNow: knobs the doctor touched by\n" +
      "         hand this session - a manual pick is never reset and never marked\n" +
      "         stale. lookMarks: knob -> amber badge text for a rendered value no\n" +
      "         current measurement stands behind (refused this Match, or carried\n" +
      "         from an older photo or a quarantined save). lastGot/lastAi: what\n" +
      "         the badges last painted, so a manual touch repaints alone. */\n" +
      "      var manualNow = {}, lookMarks = {}, lastGot = [], lastAi = [];\n" +
      "      /* filled only AFTER a Match: before one, every value is trivially the doctor's\n"
  },
  {
    file: AV, id: 'fx-badges-fourth-state',
    why: 'THE STALE VALUE IS MARKED, NEVER SILENT (owner 2026-08-11): the badge gains an amber fourth state driven by lookMarks; claims and AI reads still outrank it; lookManualTouch repaints after a hand edit.',
    find:
      "      function setLookBadges(measured, aiRead) {\n" +
      "        var got = measured || [], ai = aiRead || [];\n" +
      "        Object.keys(lookBadges).forEach(function (k) {\n" +
      "          var b = lookBadges[k]; if (!b) return;\n" +
      "          /* THREE STATES, NOT TWO (av-5.8.0). \"read by AI\" is a different fact from\n" +
      "             \"measured on this device\": one is a model's confident answer, the other is\n" +
      "             arithmetic over pixels. The doctor is entitled to know which one moved his\n" +
      "             setting, because the two fail in different ways and he will trust them\n" +
      "             differently once he has seen each be wrong. */\n" +
      "          var byAi = ai.indexOf(k) >= 0;\n" +
      "          var on = byAi || got.indexOf(k) >= 0;\n" +
      "          b.textContent = byAi ? 'read by AI' : (on ? 'from your photo' : 'your setting');\n" +
      "          b.style.color = byAi ? '#4a2d7a' : (on ? '#1f5c41' : '#8a938d');\n" +
      "          b.style.background = byAi ? '#efe8fb' : (on ? '#e6f7ef' : '#f2f1ec');\n" +
      "        });\n" +
      "      }",
    replace:
      "      function setLookBadges(measured, aiRead) {\n" +
      "        var got = measured || [], ai = aiRead || [];\n" +
      "        lastGot = got.slice(); lastAi = ai.slice();\n" +
      "        Object.keys(lookBadges).forEach(function (k) {\n" +
      "          var b = lookBadges[k]; if (!b) return;\n" +
      "          /* THREE STATES, NOT TWO (av-5.8.0). \"read by AI\" is a different fact from\n" +
      "             \"measured on this device\": one is a model's confident answer, the other is\n" +
      "             arithmetic over pixels. The doctor is entitled to know which one moved his\n" +
      "             setting, because the two fail in different ways and he will trust them\n" +
      "             differently once he has seen each be wrong. */\n" +
      "          /* AND FOUR, NOT THREE (fx-1.0). The fourth is the AMBER mark - a\n" +
      "             value still rendering that no current measurement stands behind.\n" +
      "             The owner's report was exactly this hole: a refused read left\n" +
      "             every stale value painted with nothing marking it. Claims and AI\n" +
      "             reads outrank the mark; a hand edit clears it (lookManualTouch). */\n" +
      "          var byAi = ai.indexOf(k) >= 0;\n" +
      "          var on = byAi || got.indexOf(k) >= 0;\n" +
      "          if (!on && lookMarks[k]) {\n" +
      "            b.textContent = lookMarks[k];\n" +
      "            b.style.color = '#7a4d12';\n" +
      "            b.style.background = '#fdf1dc';\n" +
      "            return;\n" +
      "          }\n" +
      "          b.textContent = byAi ? 'read by AI' : (on ? 'from your photo' : 'your setting');\n" +
      "          b.style.color = byAi ? '#4a2d7a' : (on ? '#1f5c41' : '#8a938d');\n" +
      "          b.style.background = byAi ? '#efe8fb' : (on ? '#e6f7ef' : '#f2f1ec');\n" +
      "        });\n" +
      "      }\n" +
      "      function lookManualTouch(key) {\n" +
      "        manualNow[key] = true;\n" +
      "        delete lookMarks[key];\n" +
      "        var ig = lastGot.indexOf(key); if (ig >= 0) lastGot.splice(ig, 1);\n" +
      "        var ia = lastAi.indexOf(key); if (ia >= 0) lastAi.splice(ia, 1);\n" +
      "        setLookBadges(lastGot, lastAi);\n" +
      "      }"
  },

  /* ==== 5. hand edits record provenance =================================== */
  {
    file: AV, id: 'fx-manual-colour',
    why: 'a hand-picked colour is manual provenance: never reset, never marked stale.',
    find: "input.addEventListener('input', function () { lookNow[key] = input.value; lookApply(); });",
    replace: "input.addEventListener('input', function () { lookNow[key] = input.value; lookManualTouch(key); lookApply(); });"
  },
  {
    file: AV, id: 'fx-manual-pick',
    why: 'same for the select controls.',
    find: "sel.addEventListener('change', function () { lookNow[key] = sel.value; lookApply(); });",
    replace: "sel.addEventListener('change', function () { lookNow[key] = sel.value; lookManualTouch(key); lookApply(); });"
  },
  {
    file: AV, id: 'fx-manual-toggle',
    why: 'same for the checkboxes.',
    find: "box.addEventListener('change', function () { lookNow[key] = box.checked; lookApply(); });",
    replace: "box.addEventListener('change', function () { lookNow[key] = box.checked; lookManualTouch(key); lookApply(); });"
  },
  {
    file: AV, id: 'fx-manual-browcol-well',
    why: 'same for the brow colour well.',
    find: "well.addEventListener('input', function () {\n          lookNow.browCol = well.value;",
    replace: "well.addEventListener('input', function () {\n          lookNow.browCol = well.value;\n          lookManualTouch('browCol');"
  },
  {
    file: AV, id: 'fx-manual-browcol-pick',
    why: 'same for the brow colour select.',
    find: "browColPick.addEventListener('change', function () {\n          lookNow.browCol = browColPick.value === 'set' ? well.value : '';",
    replace: "browColPick.addEventListener('change', function () {\n          lookNow.browCol = browColPick.value === 'set' ? well.value : '';\n          lookManualTouch('browCol');"
  },

  /* ==== 6. the loud note, the reset button, the quarantine banner ========= */
  {
    file: AV, id: 'fx-looknote-and-reset',
    why: 'lookNoteSay (level 0 quiet / 1 amber / 2 LOUD refusal - the owner barely saw the pale refusal line), the one-click Clear-the-derived-look reset, and the quarantine banner plumbing.',
    find: "      var lookNote = make('div', 'mlsAvMeta', '');\n",
    replace:
      "      var lookNote = make('div', 'mlsAvMeta', '');\n" +
      "      lookNote.id = 'mlsAvLookNote';\n" +
      "      /* fx-1.0 THE REFUSAL IS LOUD (owner 2026-08-11: he barely saw the pale\n" +
      "         refusal line while a stale look kept rendering). Level 0 = the quiet\n" +
      "         meta styling; 1 = amber attention; 2 = a refusal he must not miss. */\n" +
      "      function lookNoteSay(text, level) {\n" +
      "        lookNote.textContent = text || '';\n" +
      "        var lv = level === true ? 2 : (level || 0);\n" +
      "        lookNote.style.cssText = lv >= 2\n" +
      "          ? 'font:700 13.5px system-ui;color:#7a1f1f;background:#fdecec;border:1px solid #f1b8b8;border-radius:10px;padding:10px 12px;margin-top:6px'\n" +
      "          : (lv === 1\n" +
      "            ? 'font:600 12.5px system-ui;color:#7a4d12;background:#fdf6e7;border:1px solid #ecd9ab;border-radius:10px;padding:8px 10px;margin-top:6px'\n" +
      "            : '');\n" +
      "      }\n" +
      "      function lookNoteCalm() { lookNote.style.cssText = ''; }\n" +
      "      /* fx-1.0 ONE-CLICK RECOVERY from a poisoned or stale derived look. */\n" +
      "      var clearLookBtn = make('button', 'mlsAvAction', 'Clear the derived look');\n" +
      "      clearLookBtn.type = 'button';\n" +
      "      clearLookBtn.id = 'mlsAvClearDerived';\n" +
      "      clearLookBtn.addEventListener('click', function () {\n" +
      "        lookNow = faceClearDerived(lookNow, manualNow);\n" +
      "        Object.keys(lookMarks).forEach(function (mk) { delete lookMarks[mk]; });\n" +
      "        quarantineHide();\n" +
      "        skinPick.value = lookNow.skin; hairPick.value = lookNow.hair; eyesPick.value = lookNow.eyes;\n" +
      "        lipPick.value = lookNow.lip; shirtPick.value = lookNow.shirt;\n" +
      "        stylePick.value = lookNow.hairStyle; beardPick.value = lookNow.beard;\n" +
      "        browsPick.value = lookNow.brows; nosePick.value = lookNow.nose; lipsPick.value = lookNow.lips;\n" +
      "        shapePick.value = lookNow.faceShape; eyeSetPick.value = lookNow.eyeSet;\n" +
      "        hairlinePick.value = lookNow.hairline; agePick.value = lookNow.age;\n" +
      "        if (lookNow.browCol) { if (browColWell) browColWell.value = lookNow.browCol; } else { browColPick.value = ''; }\n" +
      "        glassesBox.checked = lookNow.glasses === true;\n" +
      "        capBox.checked = lookNow.cap === true;\n" +
      "        stethBox.checked = lookNow.stethoscope === true;\n" +
      "        setLookBadges([], []);\n" +
      "        lookApply();\n" +
      "        lookNoteSay('Cleared - the character is back to its defaults' +\n" +
      "          (Object.keys(manualNow).length ? ', keeping the settings you picked by hand this session' : '') +\n" +
      "          '. Cap, stethoscope and face lines are never derived, so they were kept. Save to make it permanent.', 0);\n" +
      "      });\n" +
      "      /* fx-1.0 QUARANTINE BANNER for a saved look that fails the claim gates. */\n" +
      "      var quarantineBox = null;\n" +
      "      function quarantineHide() {\n" +
      "        if (quarantineBox && quarantineBox.parentNode) safe(function () { quarantineBox.parentNode.removeChild(quarantineBox); });\n" +
      "        quarantineBox = null;\n" +
      "      }\n" +
      "      function quarantineShow(bad) {\n" +
      "        quarantineHide();\n" +
      "        var box = make('div', '', '');\n" +
      "        box.id = 'mlsAvLookQuarantine';\n" +
      "        box.style.cssText = 'font:600 12.5px system-ui;color:#7a4d12;background:#fdf6e7;border:1px solid #ecd9ab;border-radius:12px;padding:10px 12px;margin:6px 0;display:flex;flex-direction:column;gap:8px';\n" +
      "        var msg = make('div', '', 'Your saved look carries colours from an older broken match: ' +\n" +
      "          bad.map(function (q) { return q.knob + ' \\u2014 ' + q.why; }).join('; ') +\n" +
      "          '. The preview shows the default character until you decide.');\n" +
      "        var row = make('div', 'mlsAvActions');\n" +
      "        var reBtn = make('button', 'mlsAvAction primary', 'Rematch from my photo');\n" +
      "        reBtn.type = 'button';\n" +
      "        reBtn.addEventListener('click', function () { quarantineHide(); safe(function () { matchBtn.click(); }); });\n" +
      "        var keepBtn = make('button', 'mlsAvAction', 'Keep the saved colours');\n" +
      "        keepBtn.type = 'button';\n" +
      "        keepBtn.addEventListener('click', function () {\n" +
      "          quarantineHide();\n" +
      "          Object.keys(lookMarks).forEach(function (mk) { delete lookMarks[mk]; });\n" +
      "          setLookBadges([], []);\n" +
      "          lookApply();\n" +
      "          lookNoteSay('Kept - the saved colours render again, as your own setting. Rematch, adjust, or clear the derived look any time.', 0);\n" +
      "        });\n" +
      "        row.appendChild(reBtn); row.appendChild(keepBtn);\n" +
      "        box.appendChild(msg); box.appendChild(row);\n" +
      "        if (lookWrap.parentNode) lookWrap.parentNode.insertBefore(box, lookWrap);\n" +
      "        quarantineBox = box;\n" +
      "      }\n"
  },
  {
    file: AV, id: 'fx-clear-btn-mounted',
    why: 'the reset is a visible control beside Match, not a hidden affordance.',
    find: "lookActions.appendChild(matchBtn); lookActions.appendChild(moodBtn);",
    replace: "lookActions.appendChild(matchBtn); lookActions.appendChild(clearLookBtn); lookActions.appendChild(moodBtn);"
  },

  /* ==== 7. Match handler: notes routed, refusal marks stale, applier ====== */
  {
    file: AV, id: 'fx-match-nosrc-note',
    why: 'every note write goes through lookNoteSay so a refusal style can never linger.',
    find: "if (!src) { lookNote.textContent = 'Capture your photo above first, then Match my photo.'; return; }",
    replace: "if (!src) { lookNoteSay('Capture your photo above first, then Match my photo.', 0); return; }"
  },
  {
    file: AV, id: 'fx-match-reading-note',
    why: 'the reading... note resets any loud refusal style from the previous attempt.',
    find: "        lookNote.textContent = usedHi\n",
    replace: "        lookNoteCalm();\n        lookNote.textContent = usedHi\n"
  },
  {
    file: AV, id: 'fx-vision-signature',
    why: 'applyVision carries the note loudness so its completion note keeps the refusal level.',
    find: "        function applyVision(base, note) {",
    replace: "        function applyVision(base, note, noteLoud) {"
  },
  {
    file: AV, id: 'fx-vision-unavailable-note',
    why: 'routed through lookNoteSay, keeping the level.',
    find: "lookNote.textContent = note + ' (the AI reading was unavailable, so this is the on-device measurement only)';",
    replace: "lookNoteSay(note + ' (the AI reading was unavailable, so this is the on-device measurement only)', noteLoud);"
  },
  {
    file: AV, id: 'fx-vision-gates',
    why: 'MECHANISM C OUTPUT GATE: every model claim passes faceVisionClaimGate (CIELAB skin gate, posterize-artifact ban, and age never auto-applied). Refusals are collected and NAMED, applied knobs clear their stale marks.',
    find:
      "              var vl = vr.json.look || {}, vClaimed = vr.json.claimed || [], vUnsure = vr.json.unsure || [];\n" +
      "              if (!vClaimed.length) {\n" +
      "                lookNote.textContent = note + ' The AI looked too and was not confident about anything, so nothing of its was applied.';\n" +
      "                return;\n" +
      "              }\n" +
      "              vClaimed.forEach(function (k) {\n" +
      "                if (vl[k] === undefined) return;\n" +
      "                lookNow[k] = vl[k];\n" +
      "                if (aiKnobs.indexOf(k) < 0) aiKnobs.push(k);\n" +
      "              });",
    replace:
      "              var vl = vr.json.look || {}, vClaimed = vr.json.claimed || [], vUnsure = vr.json.unsure || [];\n" +
      "              if (!vClaimed.length) {\n" +
      "                lookNoteSay(note + ' The AI looked too and was not confident about anything, so nothing of its was applied.', noteLoud);\n" +
      "                return;\n" +
      "              }\n" +
      "              /* fx-1.0 OUTPUT GATES (DIAGNOSIS Mechanism C): the model's claims\n" +
      "                 used to be applied with no colour gates at all - a model\n" +
      "                 honestly describing the posterized illustration reports gray\n" +
      "                 hair and pale pink skin, and it outranked everyone. Every\n" +
      "                 claim now passes the same gates the pixels apply to\n" +
      "                 themselves, and a refusal is COUNTED and NAMED, never silent\n" +
      "                 (a failed sample must not leave a value under a green flow). */\n" +
      "              var vRefused = [];\n" +
      "              vClaimed.forEach(function (k) {\n" +
      "                if (vl[k] === undefined) return;\n" +
      "                var vWhy = faceVisionClaimGate(k, vl[k]);\n" +
      "                if (vWhy) {\n" +
      "                  vRefused.push(k + ': ' + vWhy);\n" +
      "                  if (!manualNow[k] && lastGot.indexOf(k) < 0 && !lookMarks[k]) lookMarks[k] = 'not measured \\u2014 pick manually';\n" +
      "                  return;\n" +
      "                }\n" +
      "                lookNow[k] = vl[k];\n" +
      "                if (aiKnobs.indexOf(k) < 0) aiKnobs.push(k);\n" +
      "                delete lookMarks[k];\n" +
      "              });"
  },
  {
    file: AV, id: 'fx-vision-final-note',
    why: 'the completion note names what was applied AND what was refused, with the count.',
    find:
      "              setLookBadges(base, aiKnobs);\n" +
      "              lookApply();\n" +
      "              lookNote.textContent = note + ' The AI also read it and was confident about ' +\n" +
      "                vClaimed.join(', ') + (vUnsure.length ? ('; unsure about ' + vUnsure.join(', ') + ', so those were left as they were.') : '.');",
    replace:
      "              setLookBadges(base, aiKnobs);\n" +
      "              lookApply();\n" +
      "              lookNoteSay(note + ' The AI also read it' +\n" +
      "                (aiKnobs.length ? (' and was confident about ' + aiKnobs.join(', ')) : '') +\n" +
      "                (vRefused.length ? ('; ' + vRefused.length + ' of its claims were REFUSED \\u2014 ' + vRefused.join('; ')) : '') +\n" +
      "                (vUnsure.length ? ('; unsure about ' + vUnsure.join(', ') + ', so those were left as they were.') : '.'),\n" +
      "                vRefused.length ? Math.max(1, noteLoud || 0) : noteLoud);"
  },
  {
    file: AV, id: 'fx-vision-unreachable-note',
    why: 'routed through lookNoteSay, keeping the level.',
    find: "lookNote.textContent = note + ' (the AI reading could not be reached, so this is the on-device measurement only)';",
    replace: "lookNoteSay(note + ' (the AI reading could not be reached, so this is the on-device measurement only)', noteLoud);"
  },
  {
    file: AV, id: 'fx-wholeread-refusal-truth',
    why: 'THE OWNER SCENARIO: a whole-read refusal must never leave the stale look silently rendering. Every derivable, non-manual control is marked "from your last photo - retake or adjust", the refusal renders LOUD, the reset is named, and the receipt is published.',
    find:
      "            lookNote.textContent = whyNoFace;\n" +
      "            return;\n" +
      "          }",
    replace:
      "            /* fx-1.0: A REFUSAL MUST NEVER LEAVE A STALE LOOK SILENTLY\n" +
      "               RENDERING (owner 2026-08-11, screenshot): the read refused and\n" +
      "               the panel kept showing the look derived from his LAST photo as\n" +
      "               if nothing had happened, with the refusal line pale enough to\n" +
      "               miss. The refusal is now LOUD, every derivable control still\n" +
      "               carrying an older value is marked, and one click clears the\n" +
      "               derived look (manual picks preserved). */\n" +
      "            Object.keys(FACE_LOOK).forEach(function (sk) {\n" +
      "              if (sk === 'cap' || sk === 'stethoscope' || sk === 'age') return;\n" +
      "              if (manualNow[sk]) return;\n" +
      "              lookMarks[sk] = 'from your last photo \\u2014 retake or adjust';\n" +
      "            });\n" +
      "            setLookBadges([], []);\n" +
      "            lookNoteSay(whyNoFace + ' Until a photo reads cleanly, the face below still wears the look from your LAST photo and save \\u2014 the marked controls are the stale ones. Retake, adjust them by hand, or press \"Clear the derived look\".', 2);\n" +
      "            safe(function () { if (window.__mlsAvatar) window.__mlsAvatar.lastMatchReceipt = { at: Date.now(), usedHi: usedHi, wholeReadRefusal: true, why: whyNoFace, claimed: [], refused: [], receipt: (res && res.receipt) || null }; });\n" +
      "            return;\n" +
      "          }"
  },
  {
    file: AV, id: 'fx-match-shared-applier',
    why: 'the hand-rolled merge becomes the ONE shared applier; claimed knobs clear their marks and their manual flags, refused knobs (non-manual) gain the pick-manually mark.',
    find:
      "          var got = (res && res.derived) || [];\n" +
      "          var merged = {};\n" +
      "          Object.keys(FACE_LOOK).forEach(function (k) {\n" +
      "            merged[k] = (got.indexOf(k) >= 0 && look[k] !== undefined) ? look[k] : lookNow[k];\n" +
      "          });\n" +
      "          lookNow = faceLookSafe(merged);",
    replace:
      "          var got = (res && res.derived) || [];\n" +
      "          var refusedNow = (res && res.refused) || [];\n" +
      "          /* fx-1.0: THE SHARED APPLIER - the same door the kiosk uses, so the\n" +
      "             two consumers can never drift apart again. */\n" +
      "          lookNow = faceApplyDerived(lookNow, res);\n" +
      "          got.forEach(function (k) { delete manualNow[k]; delete lookMarks[k]; });\n" +
      "          refusedNow.forEach(function (r) {\n" +
      "            if (!r || !r.knob) return;\n" +
      "            if (manualNow[r.knob]) return;\n" +
      "            if (!lookMarks[r.knob]) lookMarks[r.knob] = 'not measured \\u2014 pick manually';\n" +
      "          });"
  },
  {
    file: AV, id: 'fx-match-counted-note',
    why: 'the note CARRIES THE COUNT (matched N of M, refused K - marked), publishes the receipt at window.__mlsAvatar.lastMatchReceipt, and gates the vision call off the illustration (Mechanism C input side - the model is never shown the copy the pixel path just refused; a spend DECREASE).',
    find:
      "          /* every control now states its provenance from the SAME list that decided\n" +
      "             what to overwrite, so \"your setting\" and \"not measured\" cannot drift apart */\n" +
      "          setLookBadges(got);\n" +
      "          lookApply();\n" +
      "          /* say what it actually saw - a silent generic face is exactly what\n" +
      "             \"it straight up does not work\" looks like from the doctor's side */\n" +
      "          var found = (res && res.found && res.found.length) ? res.found.join(', ') : '';\n" +
      "          var pixNote = found\n" +
      "            ? ('Matched from your photo - detected ' + found + '. Adjust anything above to fine-tune.')\n" +
      "            : 'Matched from your photo - adjust anything above to fine-tune.';\n" +
      "          lookNote.textContent = pixNote;\n" +
      "          /* the model reads the same photo and refines what pixels get wrong. Started\n" +
      "             AFTER the on-device answer is already applied, so a slow or missing backend\n" +
      "             costs precision and never the feature. */\n" +
      "          applyVision(got, pixNote);",
    replace:
      "          /* every control now states its provenance from the SAME list that decided\n" +
      "             what to overwrite, so \"your setting\" and \"not measured\" cannot drift apart */\n" +
      "          setLookBadges(got);\n" +
      "          lookApply();\n" +
      "          var found = (res && res.found && res.found.length) ? res.found.join(', ') : '';\n" +
      "          var rct = res && res.receipt;\n" +
      "          /* fx-1.0: the note CARRIES THE COUNT, so 'it did nothing' and 'it\n" +
      "             refused 9 of 14 and told you' are different, visible facts. */\n" +
      "          var counts = rct ? (' Matched ' + rct.claimed + ' of ' + rct.examined + ', refused ' + rct.refused + ' \\u2014 refused controls are marked; set them by hand or retake.') : '';\n" +
      "          var pixNote = (found ? ('Matched from your photo - detected ' + found + '.') : 'Matched from your photo.') + counts;\n" +
      "          var pixLoud = refusedNow.length > 0 ? 1 : 0;\n" +
      "          safe(function () { if (window.__mlsAvatar) window.__mlsAvatar.lastMatchReceipt = { at: Date.now(), usedHi: usedHi, wholeReadRefusal: false, claimed: got.slice(), refused: refusedNow.slice(), receipt: rct || null }; });\n" +
      "          if (rct && rct.fromIllustration) {\n" +
      "            /* fx-1.0 (Mechanism C, input side): the model must never be shown\n" +
      "               the illustration either - it reads #333333 hair and #ffcccc skin\n" +
      "               off it honestly, and its claims outrank everyone. No call is\n" +
      "               made; the doctor is told what to do instead. */\n" +
      "            lookNoteSay(pixNote + ' The AI was NOT asked to read this: only the stylized copy is on this device and its colours are manufactured. Retake your photo for a full-quality reading.', 2);\n" +
      "          } else {\n" +
      "            /* the model reads the same photo and refines what pixels get wrong. Started\n" +
      "               AFTER the on-device answer is already applied, so a slow or missing backend\n" +
      "               costs precision and never the feature. */\n" +
      "            lookNoteSay(pixNote, pixLoud);\n" +
      "            applyVision(got, pixNote, pixLoud);\n" +
      "          }"
  },

  /* ==== 8. mood reel resets the note style ================================ */
  {
    file: AV, id: 'fx-reel-end-note',
    why: 'the expressions reel must not leave an empty red refusal box behind.',
    find: "if (i >= reel.length) { lookCtl.mood('idle', false, false); lookNote.textContent = ''; return; }",
    replace: "if (i >= reel.length) { lookCtl.mood('idle', false, false); lookNoteSay('', 0); return; }"
  },
  {
    file: AV, id: 'fx-reel-step-note',
    why: 'same for the per-mood captions.',
    find: "          lookNote.textContent = m[1];\n",
    replace: "          lookNoteSay(m[1], 0);\n"
  },

  /* ==== 9. quarantine at load ============================================= */
  {
    file: AV, id: 'fx-quarantine-compute',
    why: 'gate the SAVED look before it renders (DIAGNOSIS root cause 4). Quarantine, never rewrite.',
    find: "      var lookNow = faceLookSafe(cfg.faceLook || null);\n",
    replace:
      "      var lookNow = faceLookSafe(cfg.faceLook || null);\n" +
      "      /* fx-1.0: gate the SAVED look before it renders - a bad colour saved\n" +
      "         once used to render forever (the owner's standing white swatch). */\n" +
      "      var lookQuarantine = faceLookQuarantine(lookNow);\n"
  },
  {
    file: AV, id: 'fx-quarantine-mount',
    why: 'under quarantine the preview wears the DEFAULT character, the affected controls are marked, and the doctor chooses: Rematch, keep, or clear. Nothing is written without his own Save.',
    find:
      "      /* mount the living preview only once the form is in the document, so the\n" +
      "         face measures and animates from its first frame */\n" +
      "      lookCtl = makeFace(lookStage, lookNow);\n" +
      "      if (lookCtl) lookCtl.mood('idle', false, true);",
    replace:
      "      /* mount the living preview only once the form is in the document, so the\n" +
      "         face measures and animates from its first frame */\n" +
      "      /* fx-1.0 QUARANTINE: a saved look that fails the claim gates does not\n" +
      "         silently render (DIAGNOSIS root cause 4). Default preview + banner +\n" +
      "         marked controls; the saved values stay in the controls and on the\n" +
      "         server until the doctor himself decides. */\n" +
      "      lookCtl = makeFace(lookStage, lookQuarantine.length ? faceLookSafe(FACE_LOOK) : lookNow);\n" +
      "      if (lookCtl) lookCtl.mood('idle', false, true);\n" +
      "      if (lookQuarantine.length) {\n" +
      "        lookQuarantine.forEach(function (q) {\n" +
      "          if (!manualNow[q.knob]) lookMarks[q.knob] = 'from your last photo \\u2014 retake or adjust';\n" +
      "        });\n" +
      "        setLookBadges([], []);\n" +
      "        quarantineShow(lookQuarantine);\n" +
      "        lookNoteSay('Your saved look needs a decision - see the notice above the appearance grid.', 1);\n" +
      "      }"
  }
];

/* ---------------------------------------------------------------------------
 * Engine: sequential exact-byte splices with occurrence==1 assertions.
 * Copied from tests/patch-daynote-foldin.js (dn-1.0), unchanged semantics.
 * ------------------------------------------------------------------------- */
function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

function applyToSources(sources, opts) {
  opts = opts || {};
  const out = Object.assign({}, sources);
  const log = [];
  for (const e of EDITS) {
    const src = out[e.file];
    if (typeof src !== 'string') throw new Error('missing source for ' + e.file);
    const nFind = occurrences(src, e.find);
    const nRepl = occurrences(src, e.replace);
    if (nRepl === 1) {
      if (opts.tolerateApplied) {
        log.push({ id: e.id, file: e.file, status: 'already-applied' });
        continue;
      }
      throw new Error('[' + e.id + '] in ' + e.file + ': already applied - refusing to double-splice');
    }
    if (nFind !== 1) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': expected occurrence==1, found ' + nFind +
        (nRepl ? ' (replacement text present ' + nRepl + 'x)' : ''));
    }
    if (nRepl !== 0 && e.replace.indexOf(e.find) !== 0 && occurrences(e.replace, e.find) === 0) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': replacement already present alongside anchor');
    }
    const at = src.indexOf(e.find);
    out[e.file] = src.slice(0, at) + e.replace + src.slice(at + e.find.length);
    log.push({ id: e.id, file: e.file, status: 'ok', at });
  }
  return { sources: out, log };
}

function main() {
  const APPLY = process.argv.indexOf('--apply') >= 0;
  const files = Array.from(new Set(EDITS.map(e => e.file)));
  const sources = {};
  for (const f of files) {
    const full = path.join(ROOT, f);
    sources[f] = fs.readFileSync(full, 'latin1');
    console.log('read  ' + f + '  (' + sources[f].length + ' bytes, latin1)');
  }

  let result;
  try {
    result = applyToSources(sources, { tolerateApplied: !APPLY });
  } catch (err) {
    console.error('\nDRY-RUN: FAIL');
    console.error(String(err && err.message || err));
    process.exit(1);
  }
  const applied = result.log.filter(l => l.status === 'already-applied');
  if (applied.length === EDITS.length) {
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED - the repo carries fx-1.0; nothing to do.');
    return;
  }
  if (applied.length > 0) {
    console.error('\nDRY-RUN: FAIL - PARTIAL APPLY: ' + applied.length + '/' + EDITS.length +
      ' edits already present (' + applied.map(l => l.id).join(', ') + '). A half-applied repo needs a git restore of ' + AV + ' before this patcher may run.');
    process.exit(1);
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);
  for (const f of files) {
    console.log('post-splice size ' + f + ': ' + sources[f].length + ' -> ' + result.sources[f].length +
      ' (+' + (result.sources[f].length - sources[f].length) + ' bytes)');
  }
  console.log('\nDRY-RUN: PASS - ' + result.log.length + '/' + EDITS.length + ' anchors verified (occurrence==1 each).');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply to splice (backup written OUTSIDE the repo first).');
    return;
  }

  const os = require('os');
  const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx10-bak-'));
  for (const f of files) {
    const full = path.join(ROOT, f);
    fs.writeFileSync(path.join(bakDir, f + '.fx10.bak'), sources[f], 'latin1');
    fs.writeFileSync(full, result.sources[f], 'latin1');
    console.log('APPLIED ' + f + ' (backup: ' + path.join(bakDir, f + '.fx10.bak') + ')');
  }
  console.log('REMINDER: register the fx suite in tests/run-all.js, re-pin the one-token freshness baseline (deliberate recorded act), run the full gate with GATE_PLAN/GATE_COMPLETE, push the BRANCH only.');
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, ROOT };

/* ============================================================================
 * feat_mls_voice_copilot.js  ->  window.__mlsVoiceCopilot   (vcp-1.0.0)
 * ---------------------------------------------------------------------------
 * ONE ROUTE FROM ANY MICROPHONE TO THE ONE COPILOT BRAIN.
 *
 * Owner, 2026-07-26: "make the voice assistant actually good and connect to
 * mls copilot".
 *
 * WHAT WAS ACTUALLY WRONG (read from the shipped code, not assumed)
 * -----------------------------------------------------------------
 * Five microphone surfaces existed and three of them answered somewhere the
 * doctor was not looking:
 *
 *   1. feat_mls_voice_commands.js (window.__mlsVoice) — its OWN recognizer,
 *      its OWN three regexes, and it never registered with the speech hub, so
 *      it was outside the one-recognizer truce entirely. Its FAB is retired by
 *      `#mlsVoiceFab{display:none!important}` in mls-connect.js, but the opt-in
 *      persists in localStorage['mlsVoiceEnabled'], so a doctor who ever turned
 *      it on gets an INVISIBLE recognizer on every later page load that can
 *      race the visit recorder for the microphone.
 *   2. feat_mls_voice_ai.js (window.__mlsVoiceAI) — its own intent registry and
 *      its own toast (#mlsVoiceAiToast). Correctly in the hub, but every answer
 *      it gave landed in a private toast, never in the Copilot thread.
 *   3. copilotMic() (ScribeFlow.html) — the Copilot card's own microphone. Its
 *      own recognizer, NOT registered with the hub. Its comment claimed "its own
 *      instance so it never clashes with visit dictation", which is exactly the
 *      claim the truce exists to disprove: a second live recognizer is a clash.
 *   4. feat_mls_copilot_voice_v2.js — the closest to right. It reaches the real
 *      assistant, but since cv2-1.2.1 its deterministic commands run LOCALLY and
 *      never enter the chat path, so THE DOCTOR'S OWN WORDS NEVER APPEARED in
 *      the Copilot thread. Answers with no questions above them.
 *   5. feat_mls_visit_voice_one.js — correct already. Owns no recognizer,
 *      forwards trusted gestures. Untouched by this module.
 *
 * WHAT THIS MODULE IS — AND IS NOT
 * --------------------------------
 * It is a ROUTER. It owns:
 *   - no recognizer            (it never constructs SpeechRecognition)
 *   - no microphone lease      (it never claims the speech hub)
 *   - no command patterns      (it parses nothing, matches nothing)
 *   - no UI of its own         (it renders into the Copilot thread that exists)
 * It is therefore NOT a third brain. It picks, in a fixed and documented order,
 * whichever of the app's EXISTING brains is installed, and guarantees that:
 *   (a) what the doctor SAID appears in the Copilot thread as a user bubble,
 *       exactly once, whichever path handles it; and
 *   (b) what the app ANSWERED appears in the same thread.
 *
 * The single exception to "owns no patterns" is `voice-ai-delegate`, registered
 * LAST in the shared registry. It contains zero patterns of its own: it asks
 * window.__mlsVoiceAI.parse() — the existing parser — and only delegates when
 * every parsed step is one no other layer implements (save-draft, pull-patient).
 * That preserves those two capabilities after the mic bridge stands down, and
 * as a bonus makes them reachable by TYPING as well as by voice.
 *
 * EXACTLY-ONE-USER-BUBBLE
 * -----------------------
 * The surfaces disagree about who renders the question:
 *   __mlsAsstFix._handleSend  -> appends 'user' via __mlsCopilotConvo.append
 *   cv2 local legs            -> append nothing (the gap above)
 *   copilotAsk()              -> pushes into _copilotHistory DIRECTLY, bypassing
 *                                __mlsCopilotConvo.append entirely
 * So this module echoes the user bubble itself for the first two, and installs a
 * short-lived, reversible de-duplicator on __mlsCopilotConvo.append so the
 * assistant's own append of the same text within ECHO_WINDOW_MS is dropped
 * instead of doubling. For the copilotAsk() path it does NOT echo, because that
 * path renders the question itself and the de-duplicator cannot see it.
 *
 * SAFETY
 *   - Signs, sends, orders and submits nothing. It calls no clinical sink; the
 *     brains it delegates to keep their own rails (cv2 refuses sign/order/submit
 *     shapes before anything else runs).
 *   - Never proxies a trusted-gesture control with a synthetic .click().
 *   - Never opens the microphone. Enabling a mic stays a doctor's deliberate act
 *     on the surface that owns it.
 *   - Honest failure: if no Copilot brain is installed, it says so and names a
 *     route that exists (type it in the Copilot box) instead of dropping the
 *     utterance silently.
 *
 * Additive, idempotent, reversible: window.__mlsVoiceCopilot.revert().
 * ASCII-only, try/catch throughout, no PHI logged.
 * ==========================================================================*/
(function () {
  'use strict';

  var VERSION = 'vcp-1.0.0';
  var ASSET = 'feat_mls_voice_copilot.js';
  try {
    if (window.__mlsVoiceCopilot && window.__mlsVoiceCopilot.installed &&
        window.__mlsVoiceCopilot.version === VERSION) return;
  } catch (e0) { return; }

  /* A user bubble echoed by this module and the assistant's own append of the
     same text are the SAME turn. 8s is generous for a slow intent handler and
     far short of a doctor repeating themselves deliberately. */
  var ECHO_WINDOW_MS = 8000;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(x) { return x == null ? '' : String(x); }
  function norm(s) { return S(s).replace(/\s+/g, ' ').trim().toLowerCase(); }

  /* ===================== the shared conversation ===================== */
  function convo() {
    return safe(function () {
      var c = window.__mlsCopilotConvo;
      return (c && isFn(c.append)) ? c : null;
    }, null);
  }

  var pendingEcho = null;      /* { text:normalised, at:ms } */
  var dedupeInstalled = false;
  var dedupeDropped = 0;

  /* Wrap __mlsCopilotConvo.append so one spoken utterance can only ever render
     one user bubble. Idempotent; the original is kept for revert(). */
  function installDedupe() {
    var c = convo();
    if (!c) return false;
    if (c.append.__vcpDedupe) { dedupeInstalled = true; return true; }
    var orig = c.append;
    var wrapped = function (role, text) {
      var drop = safe(function () {
        return role === 'user' && pendingEcho &&
          norm(text) === pendingEcho.text &&
          (Date.now() - pendingEcho.at) < ECHO_WINDOW_MS;
      }, false);
      if (drop) { pendingEcho = null; dedupeDropped++; return null; }
      return orig.apply(this, arguments);
    };
    wrapped.__vcpDedupe = true;
    wrapped.__vcpOrig = orig;
    c.append = wrapped;
    dedupeInstalled = true;
    return true;
  }
  function removeDedupe() {
    safe(function () {
      var c = window.__mlsCopilotConvo;
      if (c && c.append && c.append.__vcpDedupe && isFn(c.append.__vcpOrig)) c.append = c.append.__vcpOrig;
    });
    dedupeInstalled = false;
    pendingEcho = null;
  }

  /* Put the doctor's own words in the Copilot thread. Returns false (and stays
     silent) when the shared store is not installed — never invents a surface. */
  function echoUser(text) {
    text = S(text).trim();
    if (!text) return false;
    var c = convo();
    if (!c) return false;
    installDedupe();
    pendingEcho = { text: norm(text), at: Date.now() };
    var append = (c.append && isFn(c.append.__vcpOrig)) ? c.append.__vcpOrig : c.append;
    return safe(function () { append.call(c, 'user', text); return true; }, false);
  }

  /* Put an answer in the same thread. Falls back to the app toast so a reply is
     never lost, but never claims a surface that is not there. */
  function reply(text) {
    text = S(text).trim();
    if (!text) return false;
    var c = convo();
    if (c) return safe(function () { c.append('ai', text); return true; }, false);
    return safe(function () { if (isFn(window.toast)) { window.toast(text, ''); return true; } return false; }, false);
  }

  /* ===================== the brains, in priority order ===================== */
  function copilotVoice() {
    return safe(function () {
      var v = window.__mlsCopilotVoiceV2;
      return (v && v.installed === true && isFn(v.handle)) ? v : null;
    }, null);
  }
  function assistant() {
    return safe(function () {
      var fx = window.__mlsAsstFix;
      return (fx && fx.installed === true && isFn(fx._handleSend)) ? fx : null;
    }, null);
  }
  function copilotCard() {
    return safe(function () { return isFn(window.copilotChipText) ? window.copilotChipText : null; }, null);
  }

  /* Read-only: which brains are reachable right now. Used by the gate and by
     console diagnosis; it asserts nothing it has not just looked at. */
  function brains() {
    return {
      copilotVoice: !!copilotVoice(),
      assistant: !!assistant(),
      copilotCard: !!copilotCard(),
      conversation: !!convo(),
      dedupe: dedupeInstalled,
      dedupeDropped: dedupeDropped
    };
  }

  /* ===================== THE ONE ENTRY ===================== */
  /* route(text, source) -> { ok, via, echoed, reason }
   *   via: 'copilot-voice' | 'assistant' | 'copilot-card' | 'none'
   * Every microphone surface in the app calls exactly this. */
  function route(text, source) {
    text = S(text).trim();
    if (!text) return { ok: false, via: 'none', echoed: false, reason: 'empty utterance' };
    var src = S(source) || 'voice';

    var cv2 = copilotVoice();
    if (cv2) {
      /* cv2 runs deterministic legs locally (no user bubble) and falls through
         to the assistant for real questions (which appends its own). Echo here;
         the de-duplicator collapses the second one. */
      var echoed = echoUser(text);
      var handled = safe(function () { return cv2.handle(text, src); }, undefined);
      return { ok: true, via: 'copilot-voice', echoed: echoed, reason: S(handled) };
    }

    var fx = assistant();
    if (fx) {
      var echoed2 = echoUser(text);
      safe(function () { fx._handleSend(text); });
      return { ok: true, via: 'assistant', echoed: echoed2, reason: '' };
    }

    var ask = copilotCard();
    if (ask) {
      /* copilotAsk() renders the question itself, straight into
         _copilotHistory — the de-duplicator cannot see that write, so echoing
         here would double the bubble. Do not echo. */
      safe(function () { ask(text); });
      return { ok: true, via: 'copilot-card', echoed: false, reason: '' };
    }

    reply('I heard "' + text + '", but MLS Copilot has not finished loading, so I did not run it. ' +
          'Type it into the Copilot box and press Send.');
    return { ok: false, via: 'none', echoed: false, reason: 'no Copilot brain installed' };
  }

  /* ===================== delegate the two orphaned capabilities =============
   * feat_mls_voice_ai.js implements save-draft and pull-patient-from-Athena.
   * Nothing else in the app does, and once the mic bridge stands down (it exists
   * only to carry __mlsVoice's transcripts to __mlsVoiceAI) they would be
   * unreachable by voice. Register ONE delegating intent so they keep working —
   * and start working from typed chat too.
   *
   * Zero patterns live here. The decision is made by __mlsVoiceAI's own parser,
   * and the delegation fires only when EVERY parsed step is one no other layer
   * implements, so it can never hijack "generate a worklist" from the AI. It is
   * registered WITHOUT atFront, so every deterministic intent still wins. */
  var UNIQUE_TO_VOICE_AI = { save_draft: 1, pull_patient: 1 };
  var unregisterDelegate = null;
  function voiceAi() {
    return safe(function () {
      var ai = window.__mlsVoiceAI;
      return (ai && ai.installed === true && isFn(ai.parse) && isFn(ai.executeChain)) ? ai : null;
    }, null);
  }
  function delegateHandler(q) {
    var ai = voiceAi();
    if (!ai) return false;
    var p = safe(function () { return ai.parse(q); }, null);
    if (!p || !p.intents || !p.intents.length) return false;
    for (var i = 0; i < p.intents.length; i++) if (!UNIQUE_TO_VOICE_AI[p.intents[i]]) return false;
    safe(function () { ai.executeChain(p.intents); });
    return true;
  }
  function registerDelegate() {
    if (unregisterDelegate) return true;
    var fx = safe(function () {
      var f = window.__mlsAsstFix;
      return (f && f.installed === true && isFn(f.registerIntent)) ? f : null;
    }, null);
    if (!fx) return false;
    var un = safe(function () { return fx.registerIntent('voice-ai-delegate', delegateHandler, false); }, null);
    if (!isFn(un)) return false;
    unregisterDelegate = un;
    return true;
  }

  /* ===================== boot =====================
   * Deliberately NOT a setInterval. This app already carries ~215 feature-module
   * pollers whose idle cost is measured and pinned (tests/boot-script-budget),
   * and this module has exactly two one-shot things to do. A bounded retry
   * ladder does them and then stops existing: it cannot become permanent
   * background load, and a page that never installs Copilot stops trying after
   * ~30s instead of waking up forever. */
  var retryT = 0, retries = 0;
  var MAX_RETRIES = 25;          /* 25 x 1200ms = 30s, then this module is inert */
  function tick() {
    safe(installDedupe);
    safe(registerDelegate);
    if (dedupeInstalled && unregisterDelegate) return true;
    return false;
  }
  function schedule() {
    if (retryT || retries >= MAX_RETRIES) return;
    retries++;
    retryT = setTimeout(function () { retryT = 0; if (!tick()) schedule(); }, 1200);
  }
  function boot() { if (!tick()) schedule(); }

  function revert() {
    if (retryT) { clearTimeout(retryT); retryT = 0; }
    retries = MAX_RETRIES;
    removeDedupe();
    safe(function () { if (isFn(unregisterDelegate)) unregisterDelegate(); });
    unregisterDelegate = null;
    safe(function () { window.__mlsVoiceCopilot.installed = false; });
  }

  window.__mlsVoiceCopilot = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    route: route,
    reply: reply,
    echoUser: echoUser,
    brains: brains,
    _test: {
      installDedupe: installDedupe,
      removeDedupe: removeDedupe,
      registerDelegate: registerDelegate,
      delegateHandler: delegateHandler,
      pendingEcho: function () { return pendingEcho; },
      tick: tick,
      retriesLeft: function () { return Math.max(0, MAX_RETRIES - retries); }
    },
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

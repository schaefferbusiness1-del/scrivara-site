/* ============================================================================
 * feat_mls_voice_ai_micbridge.js  ->  window.__mlsVoiceMicBridge   (mb-1.1.0)
 * ---------------------------------------------------------------------------
 * ITEM 24: Make the EXISTING on-screen mic button hands-free for CHAINED,
 * natural-language commands by bridging its speech transcripts into the new
 * natural-language layer window.__mlsVoiceAI (feat_mls_voice_ai.js, item23).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * Two voice modules ship in the app:
 *   (a) window.__mlsVoice  (feat_mls_voice_commands.js, item5) drives the mic
 *       FAB but only understands simple "start recording" / "start my visit".
 *   (b) window.__mlsVoiceAI (feat_mls_voice_ai.js, item23) understands chained
 *       natural-language commands like
 *           "MLS Assistant, generate note and then save to Athena"
 *       and dispatches to the app's REAL functions in order (heroStartVisit /
 *       stopCapture / generateNote / saveDraft / pullPatientFromAthenaPrompt /
 *       __mlsAthenaWriteback.writeNoteToChart), degrading honestly and NEVER
 *       auto-signing.
 * Speech captured by the mic FAB went ONLY to (a), so chained commands spoken
 * into that mic were never handled. This module taps the transcript the FAB's
 * recognizer produces and routes it to (b).
 *
 * HOW IT TAPS (minimally invasive, no reach into __mlsVoice internals)
 * -------------------------------------------------------------------
 * __mlsVoice's recognizer object is closure-private (not externally reachable),
 * so we wrap the SHARED SpeechRecognition.prototype.start: whenever ANY
 * recognizer starts, we attach our own ('result') listener to it (additive --
 * we do NOT replace its onresult, so the old handler keeps working). The
 * listener is GATED so it only acts while __mlsVoice's command recognizer is
 * the active mic owner:
 *     - skip while the app is DICTATING (captureBtn has class 'recording'),
 *       so we never tap the app's dictation recognizer; and
 *     - only when __mlsVoice is enabled AND currently listening.
 * This keeps the dictation recognizer and __mlsVoiceAI's own opt-in recognizer
 * untouched.
 *
 * ROUTING POLICY (AI gets first crack at multi-intent; old keeps plain start)
 * --------------------------------------------------------------------------
 * For each FINAL transcript while the command mic owns the audio:
 *   - Ask __mlsVoiceAI.parse() for the ordered intents.
 *   - If the ONLY intent is a plain start/visit that the old module already
 *     handles, do NOTHING here -> the old module's own handler runs it, exactly
 *     as before (preserves "start my visit" -> goNewVisitForPatient, which the
 *     AI layer would otherwise treat as a generic start). No double-fire.
 *   - Otherwise route to __mlsVoiceAI: chained commands, "stop", "generate
 *     note", "save draft", "pull from Athena", "save to Athena", etc.
 *   - DOUBLE-FIRE GUARD: if the utterance LEADS with a start the old module
 *     also matched (e.g. "start recording and then generate note and save to
 *     Athena"), we drop the leading start_recording from the AI chain (the old
 *     module already started it) and run only the REMAINING steps -- so the
 *     start happens exactly once and the rest of the chain still executes.
 *
 * SAFETY: This module only OBSERVES transcripts and CALLS __mlsVoiceAI's public
 * API. It signs/saves nothing, touches no patient data, makes no network calls,
 * stores no PHI/keys. All work in try/catch. __mlsVoiceAI keeps its own hard
 * rails (never signs/saves an Athena chart; honest per-step status).
 *
 * Additive, idempotent, reversible: window.__mlsVoiceMicBridge.revert()
 * ASCII-only.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsVoiceMicBridge && window.__mlsVoiceMicBridge.installed) return; } catch (e) { return; }

  var VERSION = 'mb-1.1.0';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }

  /* ---- replicate __mlsVoice's normalize + matchCommand (READ-ONLY copy) ---- */
  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // Returns 'visit' | 'record' | null -- mirrors what the OLD module acts on.
  function oldMatchCommand(text) {
    var t = normalize(text);
    if (!t) return null;
    if (/(^|\s)(start|begin|open|new)\s+(my\s+|a\s+|the\s+)?visit(\s|$)/.test(t)) return 'visit';
    if (/(^|\s)(start|begin|stop)\s+(the\s+)?record(ing)?(\s|$)/.test(t)) return 'record';
    if (/(^|\s)(start|begin)\s+(the\s+)?capture(\s|$)/.test(t)) return 'record';
    return null;
  }

  /* ---- is the app currently dictating? (mirror of __mlsVoice.appCapturing) ---- */
  function appCapturing() {
    var b = gid('captureBtn');
    if (b && /(^|\s)recording(\s|$)/.test(b.className || '')) return true;
    return false;
  }

  function aiReady() {
    return safe(function () {
      return !!(window.__mlsVoiceAI && window.__mlsVoiceAI.installed
        && typeof window.__mlsVoiceAI.parse === 'function'
        && typeof window.__mlsVoiceAI.handleUtterance === 'function'
        && typeof window.__mlsVoiceAI.executeChain === 'function');
    }, false);
  }

  function oldListening() {
    return safe(function () {
      var v = window.__mlsVoice;
      if (!v || typeof v.isEnabled !== 'function' || !v.isEnabled()) return false;
      if (typeof v.isListening === 'function' && !v.isListening()) return false;
      return true;
    }, false);
  }

  /* ---- de-dupe rapid repeats of the same final transcript ---- */
  var _last = { text: '', at: 0 };
  function isDup(said) {
    var now = Date.now();
    if (said === _last.text && (now - _last.at) < 3500) return true;
    _last = { text: said, at: now };
    return false;
  }

  /* ===================== CORE ROUTING DECISION ===================== */
  /* Returns true if WE handled it (routed to __mlsVoiceAI); false if the old
   * module should handle it (plain start/visit) or there's nothing to do. */
  function decideAndRoute(said) {
    said = String(said == null ? '' : said).trim();
    if (!said) return false;
    if (!aiReady()) return false;

    var p = safe(function () { return window.__mlsVoiceAI.parse(said); }, null);
    if (!p || !p.intents || !p.intents.length) return false; // AI can't act -> leave to old/none

    var intents = p.intents.slice();
    var oldCmd = oldMatchCommand(said);

    // Double-fire guard: old module already acts on a leading start/visit.
    if (oldCmd && intents[0] === 'start_recording') {
      intents = intents.slice(1);
      if (!intents.length) return false; // it was JUST a plain start/visit -> old owns it
      // remainder of a chain that began with start -> run only the remaining steps
      if (isDup(said)) return true;
      var rec = { text: said, intents: intents.slice(), at: Date.now(), via: 'executeChain(remainder)' };
      window.__mlsVoiceMicBridge._lastRouted = rec;
      safe(function () { window.__mlsVoiceAI.executeChain(intents); });
      return true;
    }

    // Normal path: hand the whole utterance to the AI layer (first crack).
    if (isDup(said)) return true;
    var rec2 = { text: said, intents: intents.slice(), at: Date.now(), via: 'handleUtterance' };
    window.__mlsVoiceMicBridge._lastRouted = rec2;
    safe(function () { window.__mlsVoiceAI.handleUtterance(said); });
    return true;
  }

  /* ===================== THE TAP (result listener) ===================== */
  /* mb-1.1.0 (2026-07-26, voice lane) — STAND DOWN WHEN THE ROUTER IS PRESENT.
   *
   * This bridge exists for exactly one reason: __mlsVoice's transcripts used to
   * reach only __mlsVoice's own three regexes, so chained natural language was
   * dropped. As of vc-1.1.0 __mlsVoice routes every FINAL transcript through
   * window.__mlsVoiceCopilot.route() to the one Copilot brain — and this tap
   * listens on the SAME recognizer. Left alive, one spoken sentence would be
   * acted on twice: once by the router and once here. That is a double-fire on
   * clinical actions, not a cosmetic duplicate.
   *
   * The two capabilities only __mlsVoiceAI implements (save-draft and
   * pull-patient-from-Athena) are not lost: the router registers them into the
   * shared intent registry as `voice-ai-delegate`, which calls __mlsVoiceAI's
   * OWN parser and executor. So they still work by voice, and now work by typing
   * too. __mlsVoiceAI itself is untouched and still usable directly. */
  function routerOwnsRouting() {
    return safe(function () {
      var v = window.__mlsVoiceCopilot;
      return !!(v && v.installed === true && typeof v.route === 'function');
    }, false);
  }

  function onResultTap(e) {
    safe(function () {
      if (!window.__mlsVoiceMicBridge || !window.__mlsVoiceMicBridge.installed) return;
      // gate: only when the command mic is the active owner (not dictation)
      if (!window.__mlsVoiceMicBridge._testForce) {
        if (routerOwnsRouting()) return;   /* the router already carried this utterance */
        if (appCapturing()) return;
        if (!oldListening()) return;
      }
      var said = '';
      if (e && e.results) {
        for (var i = (e.resultIndex || 0); i < e.results.length; i++) {
          var r = e.results[i];
          if (r && r.isFinal) { said += ((r[0] && r[0].transcript) || '') + ' '; }
        }
      }
      said = said.trim();
      if (said) decideAndRoute(said);
    });
  }

  /* ===================== WRAP SpeechRecognition.prototype.start ===================== */
  // Collect distinct constructors (Chrome exposes webkitSpeechRecognition; some
  // builds also alias SpeechRecognition). Wrap each distinct prototype once.
  var wrapped = []; // { proto, orig }
  function wrapStart() {
    var ctors = [];
    safe(function () { if (window.SpeechRecognition) ctors.push(window.SpeechRecognition); });
    safe(function () { if (window.webkitSpeechRecognition && ctors.indexOf(window.webkitSpeechRecognition) === -1) ctors.push(window.webkitSpeechRecognition); });
    ctors.forEach(function (C) {
      safe(function () {
        var proto = C && C.prototype;
        if (!proto || proto.__mlsAIbridgeStartWrapped) return;
        var orig = proto.start;
        if (typeof orig !== 'function') return;
        proto.start = function () {
          safe(function () {
            if (!this.__mlsAIbridgeTapped) {
              this.__mlsAIbridgeTapped = true;
              this.addEventListener('result', onResultTap, false);
            }
          }.bind(this));
          return orig.apply(this, arguments);
        };
        proto.__mlsAIbridgeStartWrapped = true;
        wrapped.push({ proto: proto, orig: orig });
      });
    });
  }

  /* ===================== REVERT ===================== */
  function revert() {
    safe(function () {
      wrapped.forEach(function (w) {
        try { w.proto.start = w.orig; } catch (e) {}
        try { delete w.proto.__mlsAIbridgeStartWrapped; } catch (e) {}
      });
      wrapped = [];
    });
    // Existing recognizers keep an inert listener; onResultTap no-ops once
    // installed=false, and re-tapping is guarded, so this is safe.
    safe(function () { window.__mlsVoiceMicBridge.installed = false; });
  }

  /* ===================== PUBLIC API ===================== */
  window.__mlsVoiceMicBridge = {
    installed: true,
    version: VERSION,
    _testForce: false,
    _lastRouted: null,
    // Test hook: run the EXACT routing decision the live tap uses, without audio.
    simulateTranscript: function (text) { return decideAndRoute(text); },
    // Test hook: dispatch a synthetic final 'result' event through the real tap
    // on a freshly-started recognizer (proves the prototype.start wrap + tap).
    simulateMicResult: function (text) {
      var C = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!C) return { ok: false, reason: 'no SpeechRecognition in this browser' };
      var r;
      try { r = new C(); r.start(); } catch (e) { /* start may throw w/o mic; tap still attached */ }
      if (!r) return { ok: false, reason: 'could not construct recognizer' };
      var ev;
      try { ev = new Event('result'); } catch (e) { ev = { type: 'result' }; }
      var res = { 0: { transcript: String(text) }, isFinal: true, length: 1 };
      ev.resultIndex = 0;
      ev.results = { 0: res, length: 1 };
      var prevForce = window.__mlsVoiceMicBridge._testForce;
      window.__mlsVoiceMicBridge._testForce = true; // bypass live-owner gate for the test
      try { r.dispatchEvent ? r.dispatchEvent(ev) : onResultTap(ev); }
      finally {
        window.__mlsVoiceMicBridge._testForce = prevForce;
        try { r.abort && r.abort(); } catch (e) {}
        try { r.stop && r.stop(); } catch (e) {}
      }
      return { ok: true, lastRouted: window.__mlsVoiceMicBridge._lastRouted };
    },
    oldMatchCommand: oldMatchCommand,
    revert: revert
  };

  wrapStart();
})();

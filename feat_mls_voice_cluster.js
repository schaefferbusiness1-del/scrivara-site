/* ============================================================================
 * feat_mls_voice_cluster.js — vc-2.0.0: THE BOTTOM-LEFT BUBBLES ARE RETIRED.
 *
 * Owner, 2026-07-26: "REMOVE THE BOTTOM LEFT BUBBLES." This module used to
 * merge the three floating pills (Copilot Voice #mlsCopVoiceBtn, MLS Assistant
 * #mlsAsstFab, Dictate #mlsDaDock) into one expanding bubble (vc-1.0.0,
 * b651/b658). The bubble then spent three builds fighting the product: its
 * closed state ate clicks meant for the page beneath (b658), and it sat
 * exactly where scrollIntoView({block:'nearest'}) parks the review control,
 * making the last human gate before Athena unreachable by mouse (b669).
 *
 * Every route the pills offered exists elsewhere, by design:
 *   - Copilot / MLS Assistant -> the dock's Copilot button (the card carries
 *     its own mic, #copilotMicBtn) and the dock's Ask input.
 *   - Copilot Voice / MLS Assistant / Dictate -> the visit lane's own chips
 *     (#ez3flCopilotVoice / #ez3flAssistant / #ez3flDictate), which are the
 *     canonical in-visit controls and are NOT duplicates of the dock.
 *   - All three originals -> the Calm Shell's Tools menu, because the hide
 *     below is BY CLASS and available() tests inline display only.
 *
 * WHAT THIS MODULE NOW DOES, IN FULL:
 *   1. injects one CSS rule that class-hides the three pills (never inline —
 *      an inline hide would silently remove three features from Tools);
 *   2. sets that class on <body> and keeps it across late module mounts;
 *   3. removes any #mlsVoiceCluster a pre-retirement session left in the DOM;
 *   4. exposes revert() so one call restores the originals at runtime.
 *
 * It builds NOTHING. No recognizer, no mic, no clicks, no timers, no
 * observers. The one-recognizer truce (mls-connect.js F11) is untouched
 * because nothing here starts, stops, or proxies anything.
 * ==========================================================================*/
;(function () {
  'use strict';

  var W = window, D = document;
  if (W.__mlsVoiceCluster) return;

  var VERSION = 'vc-2.0.0';
  var STYLE_ID = 'mlsVcStyle';
  var ROOT_ID = 'mlsVoiceCluster';   /* kept for pre-retirement DOM cleanup */
  var BODY_ON = 'mls-voice-cluster';

  /* The three retired pills, by canonical id: 'Copilot Voice' (#mlsCopVoiceBtn),
     'MLS Assistant' (#mlsAsstFab), 'Dictate' (#mlsDaDock). Named here so the
     reach story above stays greppable against the real ids. */
  var HIDDEN_IDS = ['mlsCopVoiceBtn', 'mlsAsstFab', 'mlsDaDock'];

  function css() {
    if (D.getElementById(STYLE_ID)) return;
    var s = D.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      /* class-hide, never inline: available() reads inline display, so the
         originals stay reachable from Tools while nothing floats over the page */
      'html body.' + BODY_ON + ' #mlsCopVoiceBtn,' +
      'html body.' + BODY_ON + ' #mlsAsstFab,' +
      'html body.' + BODY_ON + ' #mlsDaDock{display:none!important;}' +
      /* a stale cluster node from a pre-retirement session renders nothing */
      'html body.' + BODY_ON + ' #' + ROOT_ID + '{display:none!important;}';
    (D.head || D.documentElement).appendChild(s);
  }

  function apply() {
    css();
    if (D.body && !D.body.classList.contains(BODY_ON)) D.body.classList.add(BODY_ON);
    var stale = D.getElementById(ROOT_ID);
    if (stale && stale.parentNode) { try { stale.parentNode.removeChild(stale); } catch (e) {} }
  }

  if (D.body) apply();
  else D.addEventListener('DOMContentLoaded', apply, { once: true });

  W.__mlsVoiceCluster = {
    version: VERSION,
    retired: true,
    /* restore the three originals exactly as vc-1.0.0's revert() did */
    revert: function () {
      try { if (D.body) D.body.classList.remove(BODY_ON); } catch (e) {}
      try { var s = D.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
      return 'voice pills restored (' + HIDDEN_IDS.join(', ') + ')';
    }
  };
})();

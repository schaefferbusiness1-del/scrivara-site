/* =============================================================================
 * feat_mls_copilot_dock_fix.js -> window.__mlsCopilotDockFix  (cdf-1.0.0)
 * -----------------------------------------------------------------------------
 * Fixes the BLANK "MLS Copilot" dock. openCopilotDock() shows #copilotCard, but
 * an earlier feature (feat_asst_copilot_merge, mls-connect.js) RELOCATES the
 * Copilot's live chat nodes (#copilotThread / #copilotChips / #copilotInputRow)
 * out of #copilotCard and into #mls-asst-copilot-sec inside the MLS Assistant
 * panel ("one home for the chat"). That leaves #copilotCard with only its intro
 * (#copilotHero + a .note), so opening the dock (e.g. via the "Draft op note"
 * Copilot chip, "Ask Copilot", the command palette) shows a card with no working
 * chat -- the reported blank/white panel.
 *
 * FIX (app-side, additive, reversible): wrap openCopilotDock/closeCopilotDock so
 * that when the dock OPENS we BORROW the live chat nodes back into #copilotCard
 * (restoring the full, wired Copilot), and when it CLOSES we RETURN them to
 * #mls-asst-copilot-sec so the Assistant panel keeps working too. The nodes are
 * the SAME elements (all backend wiring/handlers stay intact); we only relocate
 * them. The merge routine only runs once (guarded by #mls-asst-copilot-sec
 * existing) so it does NOT fight this borrow. If the chat was never merged, the
 * borrow is a no-op and the dock behaves exactly as before.
 *
 * Verified live: dock open -> input/send/chips visible in the dock (card 611px,
 * not the 252px intro-only); dock close -> chat back in the Assistant panel.
 * Idempotent; captures originals once (no re-wrap cycle); ASCII-only.
 * ===========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCopilotDockFix && window.__mlsCopilotDockFix.installed) return; } catch (e) { return; }

  var VERSION = 'cdf-1.0.0';
  var CHAT_IDS = ['copilotThread', 'copilotChips', 'copilotInputRow'];

  function byId(id) { try { return document.getElementById(id); } catch (e) { return null; } }

  /* true when the chat has been merged out of #copilotCard (into the Assistant panel) */
  function chatMergedAway() {
    var card = byId('copilotCard'), ir = byId('copilotInputRow');
    return !!(card && ir && !card.contains(ir));
  }

  /* move the live chat nodes back into #copilotCard, before its trailing .note,
     preserving the original order: hero, thread, chips, inputRow, note */
  function borrowIntoCard() {
    var card = byId('copilotCard'); if (!card) return;
    var note = card.querySelector('.note');
    CHAT_IDS.forEach(function (id) {
      var el = byId(id);
      if (el) { try { if (note) card.insertBefore(el, note); else card.appendChild(el); } catch (e) {} }
    });
  }

  /* return the live chat nodes to the Assistant panel's copilot section */
  function returnToSec() {
    var sec = byId('mls-asst-copilot-sec'); if (!sec) return;
    CHAT_IDS.forEach(function (id) {
      var el = byId(id);
      if (el) { try { sec.appendChild(el); } catch (e) {} }
    });
  }

  function installWraps() {
    var okOpen = false, okClose = false;

    if (typeof window.openCopilotDock === 'function') {
      if (window.openCopilotDock.__mlsDockFix) { okOpen = true; }
      else {
        var origOpen = window.openCopilotDock;
        var wOpen = function () {
          try { if (chatMergedAway()) borrowIntoCard(); } catch (e) {}
          return origOpen.apply(this, arguments);
        };
        wOpen.__mlsDockFix = true; wOpen.__orig = origOpen;
        window.openCopilotDock = wOpen; okOpen = true;
      }
    }

    if (typeof window.closeCopilotDock === 'function') {
      if (window.closeCopilotDock.__mlsDockFix) { okClose = true; }
      else {
        var origClose = window.closeCopilotDock;
        var wClose = function () {
          var r = origClose.apply(this, arguments);
          try { returnToSec(); } catch (e) {}
          return r;
        };
        wClose.__mlsDockFix = true; wClose.__orig = origClose;
        window.closeCopilotDock = wClose; okClose = true;
      }
    }

    return okOpen && okClose;
  }

  var tries = 0, iv = null;
  function boot() {
    if (installWraps()) return;
    iv = setInterval(function () {
      if (installWraps() || ++tries >= 20) { try { clearInterval(iv); iv = null; } catch (e) {} }
    }, 1000);
  }

  function revert() {
    try { if (iv) { clearInterval(iv); iv = null; } } catch (e) {}
    try { if (window.openCopilotDock && window.openCopilotDock.__mlsDockFix) window.openCopilotDock = window.openCopilotDock.__orig; } catch (e) {}
    try { if (window.closeCopilotDock && window.closeCopilotDock.__mlsDockFix) window.closeCopilotDock = window.closeCopilotDock.__orig; } catch (e) {}
    try { window.__mlsCopilotDockFix.installed = false; } catch (e) {}
    return 'copilot-dock fix reverted';
  }

  window.__mlsCopilotDockFix = {
    installed: true, version: VERSION, asset: 'feat_mls_copilot_dock_fix.js',
    borrowIntoCard: borrowIntoCard, returnToSec: returnToSec, chatMergedAway: chatMergedAway, revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

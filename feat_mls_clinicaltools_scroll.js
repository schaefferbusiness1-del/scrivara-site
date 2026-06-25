/* ============================================================================
 * feat_mls_clinicaltools_scroll.js  ->  window.__mlsCTScroll   (cts-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 4: clicking "Clinical tools" should AUTO-SCROLL down to the tools
 * section so the doctor lands on the revealed tools instead of having to
 * hunt for them below the fold.
 *
 * Mechanism (additive, reversible, idempotent): wrap window.toggleVisitTools
 * (the app's "Clinical tools" reveal). After the original runs, if the tools
 * group is now OPEN, smooth-scroll the tools section into view. We only scroll
 * on OPEN (never on collapse), after a short delay so the just-revealed layout
 * has settled. Target preference: the redesign .vx-tools section (relocated
 * host) -> #visitToolsGroup -> the toggle row. No app state changed, no
 * network, no fabrication. ASCII-only. Reversible: __mlsCTScroll.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCTScroll && window.__mlsCTScroll.installed) return; } catch (e) { return; }

  var VERSION = 'cts-1.0.0';
  var _origToggle = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }

  function toolsTarget() {
    // prefer the redesign's relocated tools section so the header is at the top
    var sec = safe(function () { return document.querySelector('#visitView .vx-tools'); }, null);
    if (sec) return sec;
    var host = safe(function () { return document.querySelector('#visitView .vx-tools-host'); }, null);
    if (host) return host;
    return gid('visitToolsGroup') || gid('visitToolsToggleRow');
}

  function isOpen() {
    var g = gid('visitToolsGroup');
    if (!g) return false;
    var d = g.style.display;
    return d !== 'none' && d !== '';
  }

  function scrollToTools() {
    var el = toolsTarget();
    if (!el) return;
    safe(function () {
      el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    });
  }

  function installWrap() {
    if (typeof window.toggleVisitTools !== 'function') return false;
    if (window.toggleVisitTools.__mlsCtsWrapped) return true;
    _origToggle = window.toggleVisitTools;
    var wrapped = function () {
      var r = _origToggle.apply(this, arguments);
      // scroll only when the action RESULTED in an open group (i.e. user expanded it)
      safe(function () {
        if (isOpen()) { setTimeout(scrollToTools, 90); }
      });
      return r;
    };
    wrapped.__mlsCtsWrapped = true;
    wrapped.__mlsCtsOrig = _origToggle;
    window.toggleVisitTools = wrapped;
    return true;
  }

  function bootWithRetry() {
    if (installWrap()) return;
    var n = 0;
    var t = setInterval(function () {
      n++;
      if (installWrap() || n >= 40) clearInterval(t);
    }, 300);
  }

  function revert() {
    safe(function () {
      if (window.toggleVisitTools && window.toggleVisitTools.__mlsCtsWrapped && _origToggle) {
        window.toggleVisitTools = _origToggle;
      }
    });
    safe(function () { window.__mlsCTScroll.installed = false; });
  }

  window.__mlsCTScroll = { installed: true, version: VERSION, scrollToTools: scrollToTools, revert: revert };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWithRetry);
  } else {
    bootWithRetry();
  }
})();

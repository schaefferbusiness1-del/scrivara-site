/* ============================================================================
 * feat_mls_glitch_sweep.js  ->  window.__mlsGlitchSweep   (gs-1.1.0)
 * ---------------------------------------------------------------------------
 * ITEM 5 -- three small, independent, additive/reversible UI glitch fixes.
 * Loaded by BOTH connect bundles (prod + staging). No gate. ASCII-only.
 * Touches NO app data, makes NO network calls, never pulls/writes athenaOne,
 * never clicks Save/Sign/Submit, reads/sends no PHI. Idempotent.
 *
 *  5a  ANALYSIS PAGE: clicking a tile control could scroll the page back near
 *      the top. The Analysis dashboard module preserves scroll on its OWN
 *      re-render (reorder), but a control INSIDE a tile card that rebuilds its
 *      own markup can still reset the document scroll toward the top. Fix: a
 *      scoped scroll-anchor guard. On pointerdown within #analysisView we
 *      remember the scroll position and arm a short window. If, during that
 *      window, the page jumps UP (toward the top), we restore the remembered
 *      position. Restoration is driven by the scroll event (primary) AND a
 *      small setTimeout poll (backup), so it works whether or not the reset
 *      emits a scroll event. Any real user scroll intent (wheel / touch /
 *      Page/Home/arrow keys) immediately DISARMS the guard, so we never trap
 *      the user, and we never interfere with downward "scroll the expanded
 *      tile into view" motion. Plus a gentle, consistent tile tidy.
 *
 *  5b  AI STUDIO "MLS copilot": the #copilotThread scroll felt jumpy. Root
 *      cause: overflow-anchor:auto lets the browser re-anchor scroll whenever
 *      thread content changes (streaming/observer ticks), yanking the view.
 *      Fix: overflow-anchor:none on the thread + a stabilizer that keeps the
 *      thread pinned to the bottom ONLY when the user was already at the bottom
 *      (natural chat behavior); if the user has scrolled up to read history we
 *      leave their position alone. Smooth and stable, no data touched.
 *
 *  5c  "Find anything" search: worked once, then would not open again. The
 *      header launcher (feat_mls_topbar_unify) opens the powerful Find overlay
 *      #mlsQuickFindOv and guards re-entry with `if (gid(ov)) return;`. But
 *      closing the overlay only sets display:none -- the node stays in the DOM,
 *      so the guard short-circuits every later open. Fix: when the overlay is
 *      closed (any path), REMOVE its node so the launcher rebuilds it fresh on
 *      the next use. Verified live: removing the closed node restores reopen.
 *
 *  Reversible: window.__mlsGlitchSweep.revert().
 * ==========================================================================*/
;(function () {
  "use strict";
  try { if (window.__mlsGlitchSweep && window.__mlsGlitchSweep.installed) return; } catch (e) { return; }

  var VERSION = "gs-1.1.0";
  var STYLE_ID = "mlsGlitchSweepStyle";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function scrollY() { return safe(function () { return window.pageYOffset || document.documentElement.scrollTop || (document.scrollingElement && document.scrollingElement.scrollTop) || 0; }, 0); }
  function setScrollY(y) { safe(function () { window.scrollTo(0, y); }); }

  /* -------------------------------------------------------------------------
   * Shared corrective CSS (5a tidy + 5b overflow-anchor)
   * ---------------------------------------------------------------------- */
  function injectCSS() {
    if (gid(STYLE_ID)) return;
    var css = [
      /* 5a: gentle, consistent Analysis tile tidy (preview tiles only) */
      "#analysisView.ax-grid{gap:16px}",
      "#analysisView.ax-grid .ax-tile:not(.ax-exp){min-height:152px}",
      "#analysisView.ax-grid .ax-tile:not(.ax-exp) .ax-prev{padding:14px 14px;box-sizing:border-box}",
      /* 5b: stop the browser's scroll-anchoring jumps in the copilot thread */
      "#studioView #copilotThread{overflow-anchor:none}"
    ].join("");
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* =========================================================================
   * 5a -- Analysis scroll-position guard (scroll-event driven + timer backup)
   * ======================================================================= */
  var _axArmed = false, _axPrevY = 0, _axUntil = 0, _axUser = false, _axTimer = 0;
  var _axPointer = null, _axScroll = null, _axIntent = null;
  var AX_WINDOW_MS = 1200, AX_POLL_MS = 32;

  function axInAnalysis(ev) {
    var v = gid("analysisView");
    if (!v) return false;
    if (safe(function () { return getComputedStyle(v).display === "none"; }, false)) return false;
    return !!(ev && ev.target && v.contains(ev.target));
  }

  function axRestoreIfJumped() {
    if (!_axArmed) return;
    if (_axUser || Date.now() > _axUntil) { _axArmed = false; return; }
    var cur = scrollY();
    /* only correct a meaningful jump UP toward the top; never fight downward
       intent (expanding a tile scrolls it into view, which goes DOWN) */
    if (_axPrevY > 120 && cur < _axPrevY - 100) {
      setScrollY(_axPrevY);
    }
  }

  function axOnScroll() { axRestoreIfJumped(); }

  function axPoll() {
    _axTimer = 0;
    if (!_axArmed) return;
    if (_axUser || Date.now() > _axUntil) { _axArmed = false; return; }
    axRestoreIfJumped();
    _axTimer = safe(function () { return setTimeout(axPoll, AX_POLL_MS); }, 0);
  }

  function axOnPointerDown(ev) {
    if (!axInAnalysis(ev)) return;
    _axPrevY = scrollY();
    _axUser = false;
    _axArmed = _axPrevY > 120;
    _axUntil = Date.now() + AX_WINDOW_MS;
    if (_axArmed) {
      if (_axTimer) safe(function () { clearTimeout(_axTimer); });
      _axTimer = safe(function () { return setTimeout(axPoll, AX_POLL_MS); }, 0);
    }
  }

  function axOnUserIntent(ev) {
    /* any real scroll intent disarms the guard so we never trap the user */
    if (!ev) { _axUser = true; _axArmed = false; return; }
    if (ev.type === "wheel" || ev.type === "touchmove") { _axUser = true; _axArmed = false; return; }
    if (ev.type === "keydown") {
      var k = ev.key;
      if (k === "PageUp" || k === "PageDown" || k === "Home" || k === "End" ||
          k === "ArrowUp" || k === "ArrowDown" || k === " " || k === "Spacebar") {
        _axUser = true; _axArmed = false;
      }
    }
  }

  function installAx() {
    _axPointer = axOnPointerDown;
    _axScroll = axOnScroll;
    _axIntent = axOnUserIntent;
    safe(function () { document.addEventListener("pointerdown", _axPointer, true); });
    safe(function () { document.addEventListener("mousedown", _axPointer, true); });
    safe(function () { window.addEventListener("scroll", _axScroll, { passive: true }); });
    safe(function () { window.addEventListener("wheel", _axIntent, { passive: true }); });
    safe(function () { window.addEventListener("touchmove", _axIntent, { passive: true }); });
    safe(function () { window.addEventListener("keydown", _axIntent, true); });
  }
  function uninstallAx() {
    safe(function () { if (_axPointer) document.removeEventListener("pointerdown", _axPointer, true); });
    safe(function () { if (_axPointer) document.removeEventListener("mousedown", _axPointer, true); });
    safe(function () { if (_axScroll) window.removeEventListener("scroll", _axScroll); });
    safe(function () { if (_axIntent) window.removeEventListener("wheel", _axIntent); });
    safe(function () { if (_axIntent) window.removeEventListener("touchmove", _axIntent); });
    safe(function () { if (_axIntent) window.removeEventListener("keydown", _axIntent, true); });
    if (_axTimer) safe(function () { clearTimeout(_axTimer); });
    _axTimer = 0; _axArmed = false; _axPointer = null; _axScroll = null; _axIntent = null;
  }

  /* ========================================================================
   * 5b -- Copilot thread scroll stabilizer
   * ====================================================================== */
  var _cpObs = null, _cpThread = null, _cpStick = true, _cpScroll = null;

  function cpNearBottom(th) {
    return (th.scrollHeight - th.scrollTop - th.clientHeight) < 80;
  }
  function wireCopilot() {
    var th = gid("copilotThread");
    if (!th) return false;
    if (th.__mlsCpWired) { _cpThread = th; return true; }
    th.__mlsCpWired = true;
    _cpThread = th;
    safe(function () { th.style.overflowAnchor = "none"; });
    _cpStick = cpNearBottom(th);
    _cpScroll = function () { _cpStick = cpNearBottom(th); };
    safe(function () { th.addEventListener("scroll", _cpScroll, { passive: true }); });
    _cpObs = safe(function () {
      return new MutationObserver(function () {
        /* keep pinned to bottom only if the user was already at the bottom */
        if (_cpStick) { safe(function () { th.scrollTop = th.scrollHeight; }); }
      });
    }, null);
    safe(function () { if (_cpObs) _cpObs.observe(th, { childList: true, subtree: true, characterData: true }); });
    return true;
  }
  function unwireCopilot() {
    safe(function () { if (_cpObs) _cpObs.disconnect(); });
    _cpObs = null;
    if (_cpThread) {
      safe(function () { if (_cpScroll) _cpThread.removeEventListener("scroll", _cpScroll); });
      safe(function () { _cpThread.style.overflowAnchor = ""; });
      safe(function () { delete _cpThread.__mlsCpWired; });
    }
    _cpThread = null; _cpScroll = null;
  }

  /* ========================================================================
   * 5c -- remove the closed Find overlay so the launcher reopens every time
   * ====================================================================== */
  var _qfSeenVisible = false, _qfTimer = null, _origClose = null;

  function qfDisplay(o) {
    var d = safe(function () { return o.style && o.style.display; }, "");
    if (d) return d;
    return safe(function () { return getComputedStyle(o).display; }, "");
  }
  function qfSweep() {
    var o = gid("mlsQuickFindOv");
    if (!o) { _qfSeenVisible = false; return; }
    var d = qfDisplay(o);
    if (d !== "none") { _qfSeenVisible = true; return; }
    /* display:none -- if it had been shown, it is now closed: remove the node
       so feat_mls_topbar_unify's `if (gid(ov)) return;` guard passes next time */
    if (_qfSeenVisible) {
      safe(function () { o.parentNode && o.parentNode.removeChild(o); });
      _qfSeenVisible = false;
    }
  }
  function wrapClose() {
    if (typeof window.mlsQuickFindClose !== "function") return;
    if (window.mlsQuickFindClose.__mlsGsWrapped) return;
    _origClose = window.mlsQuickFindClose;
    var wrapped = function () {
      var r = safe(function () { return _origClose.apply(this, arguments); });
      safe(function () { setTimeout(function () { var o = gid("mlsQuickFindOv"); if (o && o.parentNode) o.parentNode.removeChild(o); _qfSeenVisible = false; }, 0); });
      return r;
    };
    wrapped.__mlsGsWrapped = true;
    wrapped.__mlsGsOrig = _origClose;
    window.mlsQuickFindClose = wrapped;
  }
  function unwrapClose() {
    safe(function () {
      if (window.mlsQuickFindClose && window.mlsQuickFindClose.__mlsGsWrapped && _origClose) {
        window.mlsQuickFindClose = _origClose;
      }
    });
    _origClose = null;
  }

  /* =========================================================================
   * boot / revert
   * ======================================================================= */
  function boot() {
    injectCSS();
    installAx();
    wireCopilot();
    wrapClose();
    /* low-cost watcher: re-wire copilot when the Studio view mounts, and sweep
       the closed Find overlay regardless of which path closed it */
    _qfTimer = setInterval(function () {
      safe(injectCSS);
      safe(wireCopilot);
      safe(wrapClose);
      safe(qfSweep);
    }, 1000);
  }

  function revert() {
    uninstallAx();
    unwireCopilot();
    unwrapClose();
    if (_qfTimer) { safe(function () { clearInterval(_qfTimer); }); _qfTimer = null; }
    safe(function () { var s = gid(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { window.__mlsGlitchSweep.installed = false; });
  }

  window.__mlsGlitchSweep = {
    installed: true,
    version: VERSION,
    revert: revert,
    reapply: boot,
    /* diagnostics (no PHI) */
    _sweepFindOverlay: qfSweep,
    _wireCopilot: wireCopilot
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

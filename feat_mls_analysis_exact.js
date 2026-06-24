/* feat_mls_analysis_exact.js  ->  window.__mlsAx  (Analysis page, design-exact polish)
 *  STAGING ONLY. After other *_exact modules. Never prod. Runtime-gated.
 *
 *  IMPORTANT: the design's draggable / resizable 4-col widget DASHBOARD for
 *  #analysisView is already implemented + verified by feat_mls_redesign.js
 *  (the reskin module, active on staging; layout persisted to localStorage
 *  'mlsRdAnaLayout'). This module deliberately does NOT re-bind drag/resize --
 *  doing so would double-bind handlers and risk the observer self-trigger loop
 *  the reskin already guards against. It only applies soft design-token card
 *  chrome (radius/border/shadow) that does NOT alter the drag grid's geometry,
 *  so the two cooperate. View-isolated, reversible.
 *
 *  Reversible: window.__mlsAx.revert(). ASCII-only. Idempotent.
 */
;(function () {
  "use strict";
  var VERSION = "ax-1.0.0";
  try { if (window.__mlsAx && window.__mlsAx.installed) return; } catch (e) { return; }
  function isStaging() { try { if (/staging/i.test(location.pathname)) return true; if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true; } catch (e) {} return false; }
  if (!isStaging()) { try { window.__mlsAx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }
  var STYLE_ID = "axStyle"; var _t = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function injectCSS() {
    /* token polish ONLY -- no width/margin/position/display so the reskin's
       draggable grid keeps full control of layout/geometry. */
    var css = [
      "#analysisView .card{border-radius:16px!important;border:1px solid #e4ebf3!important;box-shadow:0 1px 2px rgba(15,37,64,.04)!important}",
      "#analysisView .card > h2{letter-spacing:-.01em!important}",
      "#analysisView .extra-card{border-radius:13px!important;border:1px solid #e4ebf3!important}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  function build() { var v = $("analysisView"); if (!v) return; injectCSS(); v.setAttribute("data-ax-built", VERSION); }
  function boot() { build(); var n = 0; _t = setInterval(function () { build(); if (++n > 8) clearInterval(_t); }, 800); }
  function revert() { try { if (_t) clearInterval(_t); } catch (e) {} try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {} try { window.__mlsAx.installed = false; } catch (e) {} }
  window.__mlsAx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build, note: "drag/resize provided by feat_mls_redesign.js" };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); } catch (e) { try { boot(); } catch (e2) {} }
})();

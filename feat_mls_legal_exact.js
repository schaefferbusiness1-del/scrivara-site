/* feat_mls_legal_exact.js  ->  window.__mlsLx  (Legal requests page, design-exact)
 *  STAGING ONLY. After other *_exact modules. Never prod. Runtime-gated.
 *  Brings #legalReqView to ScribeFlow Legal.dc.html (single 1080 col): all the
 *  view's .card panels (Legal requests, Expert marketplace, Direct payouts)
 *  become design white rounded cards with icon-square headers and design action
 *  pills. Pure restyle; nothing moved/deleted; real controls keep handlers.
 *  Each header keeps its own emoji (moved into a tinted square). Reversible:
 *  window.__mlsLx.revert(). ASCII-only. Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "lx-1.0.0";
  try { if (window.__mlsLx && window.__mlsLx.installed) return; } catch (e) { return; }
  function isStaging() { try { if (/staging/i.test(location.pathname)) return true; if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true; } catch (e) {} return false; }
  if (!isStaging()) { try { window.__mlsLx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }
  var STYLE_ID = "lxStyle"; var _obs = null, _t = null, _sched = null;
  var TINTS = ["#f3eefb", "#EAF1EE", "#e7f5ee", "#fff4e0"];
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }
  function injectCSS() {
    var css = [
      "#legalReqView{max-width:1080px;margin:0 auto}",
      "#legalReqView,#legalReqView *{box-sizing:border-box}",
      "#legalReqView .card{border-radius:18px!important;border:1px solid #E7E5DD!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important;padding:24px 26px!important;margin-bottom:18px!important}",
      "#legalReqView .card > h2{display:flex!important;align-items:center!important;gap:12px!important;flex-wrap:wrap!important;font-size:19px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#legalReqView input,#legalReqView select,#legalReqView textarea{max-width:100%}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  function styleHeaders() {
    var v = $("legalReqView"); if (!v) return;
    var h2s = v.querySelectorAll(".card > h2");
    for (var i = 0; i < h2s.length; i++) {
      var h2 = h2s[i];
      if (!h2.getAttribute("data-lx")) {
        h2.setAttribute("data-lx", "1");
        var ic = h2.querySelector(".ic");
        var emoji = ic ? ic.innerHTML : "";
        var sq = mk("span", "width:38px;height:38px;border-radius:10px;background:" + TINTS[i % TINTS.length] + ";display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto", emoji);
        if (ic) h2.replaceChild(sq, ic); else h2.insertBefore(sq, h2.firstChild);
      }
      var btns = h2.querySelectorAll("button");
      for (var j = 0; j < btns.length; j++) {
        var b = btns[j]; imp(b, "height", "40px"); imp(b, "border-radius", "11px"); imp(b, "font-size", "13px");
        if (/New request/i.test(b.textContent)) { imp(b, "background", "linear-gradient(135deg,#2E6A4B,#204034)"); imp(b, "color", "#fff"); imp(b, "border", "0"); imp(b, "font-weight", "700"); }
        else { imp(b, "background", "#fff"); imp(b, "color", "#3d5168"); imp(b, "border", "1px solid #e0e8f1"); imp(b, "font-weight", "600"); }
      }
    }
  }
  function build() { var v = $("legalReqView"); if (!v) return; injectCSS(); styleHeaders(); v.setAttribute("data-lx-built", VERSION); }
  function applyAll() { try { if (_obs) _obs.disconnect(); } catch (e) {} try { build(); } catch (e) {} try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {} }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 160); }
  function boot() { try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {} applyAll(); var n = 0; _t = setInterval(function () { applyAll(); if (++n > 12) clearInterval(_t); }, 700); }
  function revert() { try { if (_obs) _obs.disconnect(); } catch (e) {} try { if (_t) clearInterval(_t); } catch (e) {} try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {} try { window.__mlsLx.installed = false; } catch (e) {} }
  window.__mlsLx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); } catch (e) { try { boot(); } catch (e2) {} }
})();

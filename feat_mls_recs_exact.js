/* feat_mls_recs_exact.js  ->  window.__mlsRx  (Recommendations page, design-exact)
 *  STAGING ONLY. After other *_exact modules. Never prod. Runtime-gated.
 *  Brings #recsView to ScribeFlow Recommendations.dc.html (single 1080 col):
 *  #recsCard -> design white rounded card, icon-square header, design action
 *  pills, design-styled recommendation groups (.rec-group). Pure restyle; no
 *  elements moved/deleted; real controls keep their handlers.
 *  Reversible: window.__mlsRx.revert(). ASCII-only. Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "rx-1.0.0";
  try { if (window.__mlsRx && window.__mlsRx.installed) return; } catch (e) { return; }
  function isStaging() { try { if (/staging/i.test(location.pathname)) return true; if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true; } catch (e) {} return false; }
  if (!isStaging()) { try { window.__mlsRx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }
  var STYLE_ID = "rxStyle"; var _obs = null, _t = null, _sched = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }
  function injectCSS() {
    var css = [
      "#recsView #recsCard{max-width:1080px;margin:0 auto!important;border-radius:18px!important;border:1px solid #E7E5DD!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important;padding:24px 26px!important}",
      "#recsView #recsCard,#recsView #recsCard *{box-sizing:border-box}",
      "#recsView #recsCard > h2{display:flex!important;align-items:center!important;gap:12px!important;flex-wrap:wrap!important;font-size:20px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#recsView .rec-group{margin-top:18px!important}",
      "#recsView .rec-group .rec-item,#recsView .rec-item{border:1px solid #E7E5DD!important;border-radius:13px!important;background:#fff!important;padding:14px 16px!important;box-shadow:none!important}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  function styleHeader() {
    var card = $("recsCard"); if (!card) return;
    var h2 = card.querySelector(":scope > h2"); if (!h2 || h2.getAttribute("data-rx")) return;
    h2.setAttribute("data-rx", "1");
    var ic = h2.querySelector(".ic");
    var sq = mk("span", "width:38px;height:38px;border-radius:10px;background:#fff4e0;display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto", "&#128161;");
    if (ic) h2.replaceChild(sq, ic); else h2.insertBefore(sq, h2.firstChild);
    var btns = h2.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i]; imp(b, "height", "40px"); imp(b, "border-radius", "11px"); imp(b, "font-size", "13px");
      if (/Generate Recommendations/i.test(b.textContent)) { imp(b, "background", "linear-gradient(135deg,#2E6A4B,#204034)"); imp(b, "color", "#fff"); imp(b, "border", "0"); imp(b, "font-weight", "700"); }
      else { imp(b, "background", "var(--card,#fff)"); imp(b, "color", "var(--ink,#3d5168)"); imp(b, "border", "1px solid var(--line,#e0e8f1)"); imp(b, "font-weight", "600"); }
    }
  }
  function build() { var v = $("recsView"); if (!v) return; injectCSS(); styleHeader(); if (v.getAttribute("data-rx-built") !== VERSION) v.setAttribute("data-rx-built", VERSION); }
  function applyAll() { try { if (_obs) _obs.disconnect(); } catch (e) {} try { build(); } catch (e) {} try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {} }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 160); }
  function boot() { try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {} applyAll(); var n = 0; _t = setInterval(function () { applyAll(); if (++n > 12) clearInterval(_t); }, 700); }
  function revert() { try { if (_obs) _obs.disconnect(); } catch (e) {} try { if (_t) clearInterval(_t); } catch (e) {} try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {} try { window.__mlsRx.installed = false; } catch (e) {} }
  window.__mlsRx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); } catch (e) { try { boot(); } catch (e2) {} }
})();

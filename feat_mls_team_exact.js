/* feat_mls_team_exact.js  ->  window.__mlsTx  (Team page, design-exact)
 *  STAGING ONLY. After other *_exact modules. Never prod. Runtime-gated.
 *  Brings #teamView to ScribeFlow Team.dc.html (single 1080 col): the team
 *  .card becomes the design white rounded card, icon-square header, design
 *  action pills; the efficiency .extra-card picks up design panel tokens. Pure
 *  restyle; nothing moved/deleted; real controls keep handlers.
 *  Reversible: window.__mlsTx.revert(). ASCII-only. Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "tx-1.1.0";
  try { if (window.__mlsTx && window.__mlsTx.installed) return; } catch (e) { return; }
  function isStaging() { try { if (/staging/i.test(location.pathname)) return true; if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true; } catch (e) {} return false; }
  if (!isStaging()) { try { window.__mlsTx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }
  var STYLE_ID = "txStyle"; var _obs = null, _t = null, _sched = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }
  function injectCSS() {
    var css = [
      "#teamView{max-width:1080px;margin:0 auto}",
      "#teamView,#teamView *{box-sizing:border-box}",
      "#teamView > .card{border-radius:18px!important;border:1px solid #E7E5DD!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important;padding:24px 26px!important}",
      "#teamView > .card > h2{display:flex!important;align-items:center!important;gap:12px!important;flex-wrap:wrap!important;font-size:19px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#teamView .extra-card{border:1px solid #E7E5DD!important;border-radius:14px!important;background:#fff!important;box-shadow:none!important;padding:18px!important}",
      "#teamView #teamList .team-docrow{display:grid!important;grid-template-columns:repeat(2,1fr)!important;gap:12px!important;align-items:stretch!important}",
      "#teamView #teamList .team-doc{width:auto!important;min-width:0!important;max-width:none!important}",
      "@media (max-width:760px){#teamView #teamList .team-docrow{grid-template-columns:1fr!important}}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  function styleHeader() {
    var v = $("teamView"); if (!v) return;
    var h2 = v.querySelector(".card > h2"); if (!h2 || h2.getAttribute("data-tx")) return;
    h2.setAttribute("data-tx", "1");
    var ic = h2.querySelector(".ic"), emoji = ic ? ic.innerHTML : "";
    var sq = mk("span", "width:38px;height:38px;border-radius:10px;background:#EAF1EE;display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto", emoji);
    if (ic) h2.replaceChild(sq, ic); else h2.insertBefore(sq, h2.firstChild);
    var btns = h2.querySelectorAll("button");
    for (var j = 0; j < btns.length; j++) { var b = btns[j]; imp(b, "height", "40px"); imp(b, "border-radius", "11px"); imp(b, "font-size", "13px"); imp(b, "background", "var(--card,#fff)"); imp(b, "color", "var(--ink,#3d5168)"); imp(b, "border", "1px solid var(--line,#e0e8f1)"); imp(b, "font-weight", "600"); }
  }
  function build() { var v = $("teamView"); if (!v) return; injectCSS(); styleHeader(); if (v.getAttribute("data-tx-built") !== VERSION) v.setAttribute("data-tx-built", VERSION); }
  function applyAll() { try { if (_obs) _obs.disconnect(); } catch (e) {} try { build(); } catch (e) {} try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {} }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 160); }
  function boot() { try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {} applyAll(); var n = 0; _t = setInterval(function () { applyAll(); if (++n > 12) clearInterval(_t); }, 700); }
  function revert() { try { if (_obs) _obs.disconnect(); } catch (e) {} try { if (_t) clearInterval(_t); } catch (e) {} try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {} try { window.__mlsTx.installed = false; } catch (e) {} }
  window.__mlsTx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); } catch (e) { try { boot(); } catch (e2) {} }
})();

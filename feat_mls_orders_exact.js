/* feat_mls_orders_exact.js  ->  window.__mlsOx  (Orders page, design-exact rebuild)
 *
 *  STAGING ONLY. Loaded by mls-connect.staging.js after the other *_exact modules.
 *  Never loaded by prod. Runtime-gated to staging.
 *
 *  Brings #ordersView to design_renders/ScribeFlow Orders.dc.html (single 960px
 *  column): the existing #ordersCard becomes the design white rounded card with
 *  an icon-square header; its .extra-card sub-panels (Diagnosis context, New
 *  order, Orders list, Prior auth) become the design's soft white panels;
 *  selects/inputs pick up the design pill tokens. Pure restyle -- nothing moved
 *  or deleted; every control stays the app's real wired element.
 *
 *  Reversible: window.__mlsOx.revert().  ASCII-only. Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "ox-1.0.0";
  try { if (window.__mlsOx && window.__mlsOx.installed) return; } catch (e) { return; }
  function isStaging() {
    try { if (/staging/i.test(location.pathname)) return true; if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true; } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsOx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }
  var STYLE_ID = "oxStyle"; var _obs = null, _t = null, _sched = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }

  function injectCSS() {
    var css = [
      "#ordersView #ordersCard{max-width:960px;margin:0 auto!important;border-radius:18px!important;border:1px solid #E7E5DD!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important;padding:24px 26px!important}",
      "#ordersView #ordersCard,#ordersView #ordersCard *{box-sizing:border-box}",
      "#ordersView #ordersCard > h2{display:flex!important;align-items:center!important;gap:12px!important;flex-wrap:wrap!important;font-size:20px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#ordersView .extra-card{border:1px solid #E7E5DD!important;border-radius:14px!important;background:#fff!important;box-shadow:none!important;padding:18px 18px!important}",
      "#ordersView .extra-card h3{font-size:15px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#ordersView .sf-select,#ordersView select,#ordersView input[type=text],#ordersView .field input{border-radius:10px!important;border:1px solid #e0e8f1!important;background:#fff!important;font-size:13.5px!important}",
      "#ordersView .extra-card input,#ordersView .extra-card select,#ordersView .extra-card textarea{max-width:100%}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  function styleHeader() {
    var card = $("ordersCard"); if (!card) return;
    var h2 = card.querySelector(":scope > h2"); if (!h2 || h2.getAttribute("data-ox")) return;
    h2.setAttribute("data-ox", "1");
    var ic = h2.querySelector(".ic");
    var sq = mk("span", "width:38px;height:38px;border-radius:10px;background:#EAF1EE;display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto", "&#128203;");
    if (ic) h2.replaceChild(sq, ic); else h2.insertBefore(sq, h2.firstChild);
    var back = h2.querySelector("button");
    if (back) { imp(back, "height", "40px"); imp(back, "border-radius", "11px"); imp(back, "border", "1px solid #e0e8f1"); imp(back, "background", "#fff"); imp(back, "color", "#3d5168"); imp(back, "font-weight", "600"); }
  }
  function build() { var v = $("ordersView"); if (!v) return; injectCSS(); styleHeader(); v.setAttribute("data-ox-built", VERSION); }
  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { build(); } catch (e) {}
    try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 160); }
  function boot() {
    try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {}
    applyAll(); var n = 0; _t = setInterval(function () { applyAll(); if (++n > 12) clearInterval(_t); }, 700);
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_t) clearInterval(_t); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { window.__mlsOx.installed = false; } catch (e) {}
  }
  window.__mlsOx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();

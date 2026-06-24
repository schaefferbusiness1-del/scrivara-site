/* feat_mls_history_exact.js  ->  window.__mlsHy  (History page, design-exact rebuild)
 *
 *  STAGING ONLY. Loaded by mls-connect.staging.js after the other *_exact modules.
 *  Never loaded by prod (mls-connect.js). Runtime-gated to the staging page.
 *
 *  Brings #historyView to design_renders/ScribeFlow History.dc.html (single
 *  1080px column): the existing #historyCard becomes the design's white rounded
 *  card -- icon-square header, design action pills, a pill search + filter, and
 *  design-styled visit rows (.hist-item). Pure restyle: no elements are moved
 *  or deleted; every control stays the app's real wired element. The visit rows
 *  are the app's real renderHistory() output, restyled via CSS only.
 *
 *  Reversible: window.__mlsHy.revert().  ASCII-only. Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "hy-1.0.0";
  try { if (window.__mlsHy && window.__mlsHy.installed) return; } catch (e) { return; }
  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsHy = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "hyStyle";
  var _obs = null, _t = null, _sched = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }

  function injectCSS() {
    var css = [
      "#historyView #historyCard{max-width:1080px;margin:0 auto!important;border-radius:18px!important;border:1px solid #e4ebf3!important;box-shadow:0 1px 2px rgba(15,37,64,.04)!important;padding:24px 26px!important}",
      "#historyView #historyCard,#historyView #historyCard *{box-sizing:border-box}",
      "#historyView #historyCard > h2{display:flex!important;align-items:center!important;gap:12px!important;flex-wrap:wrap!important;font-size:20px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#historyView #histSearch{height:46px!important;border-radius:11px!important;border:1px solid #e0e8f1!important;background:#f8fafc!important;padding:0 14px!important;font-size:13.5px!important}",
      "#historyView #histFilter{height:46px!important;border-radius:11px!important;border:1px solid #e0e8f1!important;background:#fff!important;padding:0 14px!important;font-size:13px!important;font-weight:600!important;color:#0f2540!important}",
      "#historyView .hist-list{display:flex!important;flex-direction:column!important;gap:10px!important}",
      "#historyView .hist-item{border:1px solid #e4ebf3!important;border-radius:14px!important;background:#fff!important;padding:15px 17px!important;box-shadow:none!important}",
      "#historyView .hist-item:hover{border-color:#cfe0fb!important;background:#fbfdff!important}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  /* icon square in the header (design), and design pills for the action buttons */
  function styleHeader() {
    var card = $("historyCard"); if (!card) return;
    var h2 = card.querySelector(":scope > h2"); if (!h2) return;
    if (!h2.getAttribute("data-hy")) {
      h2.setAttribute("data-hy", "1");
      var ic = h2.querySelector(".ic");
      var sq = mk("span", "width:38px;height:38px;border-radius:10px;background:#eef3fb;display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto", "&#128451;");
      if (ic) h2.replaceChild(sq, ic); else h2.insertBefore(sq, h2.firstChild);
    }
    var btns = h2.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], t = (b.textContent || "");
      imp(b, "height", "40px"); imp(b, "border-radius", "11px"); imp(b, "font-size", "13px");
      if (/New visit/i.test(t)) {
        imp(b, "background", "linear-gradient(135deg,#1f9d6b,#178a5c)"); imp(b, "color", "#fff");
        imp(b, "border", "0"); imp(b, "font-weight", "700");
        imp(b, "box-shadow", "0 10px 22px -10px rgba(31,157,107,.6)");
      } else if (/Pull chart/i.test(t)) {
        imp(b, "background", "#eef5ff"); imp(b, "color", "#2f6bed"); imp(b, "border", "1px solid #cfe0fb"); imp(b, "font-weight", "700");
      } else {
        imp(b, "background", "#fff"); imp(b, "color", "#3d5168"); imp(b, "border", "1px solid #e0e8f1"); imp(b, "font-weight", "600");
      }
    }
  }

  function build() {
    var v = $("historyView"); if (!v) return;
    injectCSS(); styleHeader();
    v.setAttribute("data-hy-built", VERSION);
  }
  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { build(); } catch (e) {}
    try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 160); }
  function boot() {
    try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {}
    applyAll();
    var n = 0; _t = setInterval(function () { applyAll(); if (++n > 12) clearInterval(_t); }, 700);
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_t) clearInterval(_t); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { window.__mlsHy.installed = false; } catch (e) {}
  }
  window.__mlsHy = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();

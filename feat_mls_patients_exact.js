/* feat_mls_patients_exact.js  ->  window.__mlsPx  (Patients page, design-exact rebuild)
 *
 *  STAGING ONLY. Loaded by mls-connect.staging.js after the other *_exact modules.
 *  Never loaded by prod (mls-connect.js). Runtime-gated to the staging page.
 *
 *  Brings #patientsView to design_renders/ScribeFlow Patients.dc.html:
 *    - 2-column layout: a 420px sticky LEFT list panel | a right PROFILE column
 *    - design tokens (white rounded cards, soft borders, pill search)
 *    - a dark-navy profile header band (the design's gradient) built by MOVING
 *      the app's REAL #profName/#profDemo + the real Start visit / Schedule /
 *      Export / Legal action buttons into it BY ID (handlers intact)
 *
 *  Everything interactive is the app's REAL element, moved/restyled only;
 *  nothing is deleted. The big "More" practice-tools cluster (#ptMore) stays
 *  exactly where it is (design omits it -> kept, one click away). The 2-col
 *  split only engages when a profile is actually shown; otherwise the list
 *  spans full width.
 *
 *  Reversible: window.__mlsPx.revert().  ASCII-only. Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "px-1.1.0";
  try { if (window.__mlsPx && window.__mlsPx.installed) return; } catch (e) { return; }

  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsPx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "pxStyle";
  var _obs = null, _t = null, _sched = null;

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }
  function impAll(el, list) { if (!el) return; list.forEach(function (p) { var i = p.indexOf(":"); imp(el, p.slice(0, i), p.slice(i + 1)); }); }
  function vis(el) { try { return el && el.offsetParent !== null && getComputedStyle(el).display !== "none"; } catch (e) { return false; } }

  function injectCSS() {
    var css = [
      "#patientsView #ptSplitWrap{display:grid;grid-template-columns:1fr;gap:20px;align-items:start}",
      "#patientsView #ptSplitWrap.px-has-profile{grid-template-columns:420px 1fr}",
      "#patientsView #ptSplitWrap,#patientsView #ptSplitWrap *{box-sizing:border-box}",
      "#patientsView .card{border-radius:18px!important;border:1px solid #e4ebf3!important;box-shadow:0 1px 2px rgba(15,37,64,.04)!important}",
      "#patientsView #ptSearch{width:100%!important;height:42px!important;border-radius:11px!important;border:1px solid #e0e8f1!important;background:#f8fafc!important;padding:0 14px!important;font-size:13.5px!important}",
      "#patientsView #ptList{min-width:0}",
      "#patientsView .px-prof-hd{background:linear-gradient(135deg,#0d2138,#143560)!important;border-radius:16px!important;margin:-4px -4px 8px!important;padding:20px 22px!important;position:relative;overflow:hidden}",
      "#patientsView .px-prof-hd #profName{color:#fff!important;font-family:'Newsreader',Georgia,serif!important;font-weight:500!important;font-size:24px!important}",
      "#patientsView .px-prof-hd .ic{display:none!important}",
      "#patientsView .px-prof-hd .sub,#patientsView .px-prof-hd #profDemo{color:#bcd2ed!important}",
      "@media (min-width:981px){#patientsView #ptSplitWrap.px-has-profile > .card:first-child{position:sticky;top:138px}}",
      "@media (max-width:980px){#patientsView #ptSplitWrap.px-has-profile{grid-template-columns:1fr}}",
      /* narrow widths: let the stacked grid items shrink to the viewport (no h-overflow) */
      "@media (max-width:980px){#patientsView #ptSplitWrap{min-width:0!important}#patientsView #ptSplitWrap>*{min-width:0!important;max-width:100%!important}#patientsView #ptSplitWrap .card *{max-width:100%}}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  /* Build the dark-navy profile header band by moving the real h2 contents in.
     We restyle the existing profileCard <h2> into the band rather than rebuild,
     so the real action buttons (onclick handlers) are preserved untouched. */
  function styleProfile() {
    var prof = $("profileCard"); if (!prof) return;
    var h2 = prof.querySelector(":scope > h2");
    if (h2 && !h2.classList.contains("px-prof-hd")) {
      h2.classList.add("px-prof-hd");
      imp(h2, "display", "flex"); imp(h2, "flex-wrap", "wrap"); imp(h2, "align-items", "center"); imp(h2, "gap", "10px");
      /* pull the demographic <p class="sub" id="profDemo"> up into the band */
      var demo = $("profDemo");
      if (demo && demo.parentElement === prof) {
        demo.setAttribute("data-px-moved", "1");
        imp(demo, "flex-basis", "100%"); imp(demo, "margin", "4px 0 0"); imp(demo, "font-size", "13px");
        h2.appendChild(demo);
      }
      /* restyle the action buttons inside the band for contrast on dark bg */
      var btns = h2.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i], t = (b.textContent || "");
        if (/Start visit/i.test(t)) {
          impAll(b, ["background", "linear-gradient(135deg,#19b8a6,#13a18f)"]);
          imp(b, "color", "#fff"); imp(b, "border", "0");
        } else {
          imp(b, "background", "rgba(255,255,255,.10)"); imp(b, "color", "#fff");
          imp(b, "border", "1px solid rgba(255,255,255,.18)");
        }
        imp(b, "border-radius", "11px");
      }
    }
  }

  function build() {
    var v = $("patientsView"); if (!v) return;
    injectCSS();
    var wrap = $("ptSplitWrap"); if (!wrap) return;
    var prof = $("profileCard");
    var hasProfile = prof && vis(prof);
    if (hasProfile) wrap.classList.add("px-has-profile"); else wrap.classList.remove("px-has-profile");
    if (hasProfile) styleProfile();
    v.setAttribute("data-px-built", VERSION);
  }
  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { build(); } catch (e) {}
    try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] }); } catch (e) {}
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
    try {
      var wrap = $("ptSplitWrap"); if (wrap) wrap.classList.remove("px-has-profile");
      var prof = $("profileCard"), h2 = prof && prof.querySelector(":scope > h2.px-prof-hd");
      if (h2) {
        var demo = $("profDemo");
        if (demo && demo.getAttribute("data-px-moved")) { demo.removeAttribute("data-px-moved"); prof.insertBefore(demo, h2.nextSibling); }
        h2.classList.remove("px-prof-hd");
      }
    } catch (e) {}
    try { window.__mlsPx.installed = false; } catch (e) {}
  }

  window.__mlsPx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();

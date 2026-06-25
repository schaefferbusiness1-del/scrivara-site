/* feat_mls_baricon.js -> window.__mlsBarIcons (bi-1.0.0)
 * ITEM 15: On the white patient-context bar (#mlsCtxBar .mlsctx-actions),
 * convert ONLY the Chart / Visit / History / Schedule pill buttons from text
 * labels to clear inline-SVG ICONS. Same height/position/order. Each gets an
 * aria-label + a native hover tooltip (title) so its purpose stays obvious.
 * "After-visit summary" (#mlsavsBtn) and the blue "Switch patient"
 * (data-act="switch") are intentionally LEFT AS TEXT. No other button anywhere
 * else in the app is touched.
 *
 * The bar re-renders its innerHTML on patient change (renderInto), so a
 * MutationObserver re-applies the icons after every rebuild. We only ever change
 * each target button's innerHTML (icon) + aria-label/title; data-act and the
 * app's own onclick handler are never altered, so click behavior is intact.
 * Additive, idempotent, ASCII-only, fully reversible: window.__mlsBarIcons.revert().
 */
(function () {
  "use strict";
  try { if (window.__mlsBarIcons && window.__mlsBarIcons.installed) return; } catch (e) { return; }

  var VERSION = "bi-1.0.0";
  var STYLE_ID = "mlsBarIconCss";
  var BAR_ID = "mlsCtxBar";
  var FLAG = "__mlsBarIconified";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  // data-act -> {label, svg}. 24x24 viewBox, stroke=currentColor so the bar's
  // existing hover recolor (border/color -> brand) recolors the icon too.
  var ICONS = {
    chart: {
      label: "Chart",
      svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h8"></path><path d="M8 9h2"></path>'
    },
    visit: {
      label: "Visit",
      svg: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"></path><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"></path><circle cx="20" cy="10" r="2"></circle>'
    },
    history: {
      label: "History",
      svg: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path>'
    },
    schedule: {
      label: "Schedule",
      svg: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>'
    }
  };

  function svgFor(act) {
    var ic = ICONS[act];
    return '<svg class="mls-baricon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" '
      + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
      + 'aria-hidden="true" focusable="false">' + ic.svg + '</svg>';
  }

  function injectCss() {
    if (safe(function () { return document.getElementById(STYLE_ID); })) return;
    var css = [
      "#" + BAR_ID + " .mlsctx-actions button.mls-baricon{display:inline-flex;align-items:center;",
      "justify-content:center;min-width:34px;padding:5px 9px;line-height:0;}",
      "#" + BAR_ID + " .mlsctx-actions button.mls-baricon .mls-baricon-svg{display:block;}"
    ].join("");
    var s = safe(function () { return document.createElement("style"); });
    if (!s) return;
    s.id = STYLE_ID; s.textContent = css;
    safe(function () { (document.head || document.documentElement).appendChild(s); });
  }

  var _obs = null;

  function apply() {
    var bar = safe(function () { return document.getElementById(BAR_ID); });
    if (!bar) return;
    var btns = safe(function () { return bar.querySelectorAll(".mlsctx-actions button[data-act]"); }, []);
    Array.prototype.forEach.call(btns, function (b) {
      var act = safe(function () { return b.getAttribute("data-act"); });
      if (!ICONS[act]) return;          // only chart/visit/history/schedule
      if (b[FLAG]) return;              // already iconified this element
      var label = ICONS[act].label;
      safe(function () { b.setAttribute("aria-label", label); });
      safe(function () { b.setAttribute("title", label); });
      safe(function () { b.classList.add("mls-baricon"); });
      safe(function () { b.innerHTML = svgFor(act); });
      b[FLAG] = 1;
    });
  }

  function applyGuarded() {
    if (_obs) safe(function () { _obs.disconnect(); });
    safe(apply);
    if (_obs) safe(function () {
      var bar = document.getElementById(BAR_ID);
      if (bar) _obs.observe(bar, { childList: true, subtree: true });
    });
  }

  function boot() {
    injectCss();
    _obs = safe(function () { return new MutationObserver(function () { applyGuarded(); }); }, null);
    applyGuarded();
    // also poll briefly in case the bar mounts late
    var n = 0, t = setInterval(function () { n++; applyGuarded(); if (n >= 20) clearInterval(t); }, 400);
  }

  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); });
    _obs = null;
    safe(function () {
      var bar = document.getElementById(BAR_ID);
      if (!bar) return;
      bar.querySelectorAll(".mlsctx-actions button.mls-baricon").forEach(function (b) {
        var act = b.getAttribute("data-act");
        b.classList.remove("mls-baricon");
        b.removeAttribute("aria-label");
        b.removeAttribute("title");
        if (ICONS[act]) b.textContent = ICONS[act].label;
        try { delete b[FLAG]; } catch (e) { b[FLAG] = 0; }
      });
    });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.remove(); });
    safe(function () { window.__mlsBarIcons.installed = false; });
  }

  window.__mlsBarIcons = { installed: true, version: VERSION, apply: applyGuarded, revert: revert };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

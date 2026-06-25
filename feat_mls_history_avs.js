/* feat_mls_history_avs.js -> window.__mlsHistoryAvs (havs-1.0.0)
 * ITEM 16: Surface the "After-visit summary" action inside the History view too.
 * Adds ONE button to the History toolbar (#histSearchRow) that triggers the SAME
 * after-visit-summary handler the patient-bar button uses --
 * window.__mlsAfterVisitSummary.open() (fallback: click #mlsavsBtn). No logic is
 * duplicated; it calls the existing handler. That handler already guards
 * "Open a patient first." and never auto-sends. Additive, idempotent, ASCII-only,
 * reversible: window.__mlsHistoryAvs.revert().
 */
(function () {
  "use strict";
  try { if (window.__mlsHistoryAvs && window.__mlsHistoryAvs.installed) return; } catch (e) { return; }

  var VERSION = "havs-1.0.0";
  var BTN_ID = "mlsHistAvsBtn";
  var ROW_ID = "histSearchRow";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  function trigger() {
    var avs = safe(function () { return window.__mlsAfterVisitSummary; });
    if (avs && typeof avs.open === "function") { safe(function () { avs.open(); }); return; }
    var b = safe(function () { return document.getElementById("mlsavsBtn"); });
    if (b) { safe(function () { b.click(); }); return; }
    safe(function () { if (window.toast) window.toast("After-visit summary is unavailable right now."); });
  }

  function ensureBtn() {
    var row = safe(function () { return document.getElementById(ROW_ID); });
    if (!row) return;
    if (safe(function () { return document.getElementById(BTN_ID); })) return;
    var b = safe(function () { return document.createElement("button"); });
    if (!b) return;
    b.id = BTN_ID;
    b.type = "button";
    b.title = "Generate an after-visit summary for the active patient (you review before sending)";
    b.setAttribute("aria-label", "After-visit summary");
    b.style.cssText = "font-size:13px;padding:8px 12px;border:1px solid var(--line,#e6e9ef);"
      + "border-radius:9px;background:var(--card,#fff);color:var(--ink,#15293f);cursor:pointer;white-space:nowrap;";
    b.innerHTML = "📤 After-visit summary";
    safe(function () { b.addEventListener("click", function (e) { try { e.preventDefault(); } catch (x) {} trigger(); }); });
    safe(function () { row.appendChild(b); });
  }

  var _obs = null;
  function boot() {
    ensureBtn();
    _obs = safe(function () { return new MutationObserver(function () { ensureBtn(); }); }, null);
    safe(function () {
      var hv = document.getElementById("historyView");
      if (_obs && hv) _obs.observe(hv, { childList: true, subtree: true });
    });
    var n = 0, t = setInterval(function () { n++; ensureBtn(); if (n >= 20) clearInterval(t); }, 400);
  }

  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); }); _obs = null;
    safe(function () { var b = document.getElementById(BTN_ID); if (b) b.remove(); });
    safe(function () { window.__mlsHistoryAvs.installed = false; });
  }

  window.__mlsHistoryAvs = { installed: true, version: VERSION, trigger: trigger, revert: revert };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

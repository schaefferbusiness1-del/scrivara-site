/* ============================================================================
 * feat_mls_sched_datesync.js  ->  window.__mlsSchedDateSync  (sds-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 35 -- SCHEDULE-BAR DATE SYNC + VIEWED-DATE INDICATOR (additive)
 *
 * The NEXT UP "Schedule:" control bar (#mlsNuCtl, from item11) has a "Today"
 * toggle and a date picker, but they were not kept in sync and there was no
 * indication of which day you were actually looking at:
 *   - clicking "Today" left the date picker showing whatever old day was set;
 *   - picking another day left "Today" still highlighted;
 *   - nothing told you which date the list was scoped to.
 *
 * FIX (additive, reversible)
 *   - Adds a small "Viewing: <date>" indicator pill to the bar.
 *   - When "Today" is pressed -> the date picker snaps back to today's date and
 *     the indicator reads "Today".
 *   - When a different day is picked -> "Today" stops being highlighted and the
 *     indicator shows that day (e.g. "Fri, Jun 26"); picking today again re-syncs.
 *   The bar's existing handlers (which actually re-scope the cards / open the
 *   day picker) are left intact; this only layers synchronisation + the
 *   indicator on top. ASCII-only, no network, no PHI.
 *   Reversible: window.__mlsSchedDateSync.revert().
 * ==========================================================================*/
;(function () {
  "use strict";
  try { if (window.__mlsSchedDateSync && window.__mlsSchedDateSync.installed) return; } catch (e) { return; }

  var VERSION = "sds-1.0.0";
  var BAR_ID = "mlsNuCtl";
  var IND_ID = "mlsSchedInd";
  var STYLE_ID = "mlsSchedIndStyle";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayKey() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pretty(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    if (!m) return key || "";
    var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    if (isNaN(d.getTime())) return key;
    return DOW[d.getDay()] + ", " + MON[d.getMonth()] + " " + d.getDate();
  }

  function injectCSS() {
    if ($(STYLE_ID)) return;
    var css = [
      "#" + IND_ID + "{display:inline-flex;align-items:center;gap:5px;margin-left:6px;",
      "font-size:11.5px;font-weight:700;color:#1A211C;background:#EAF1EE;border:1px solid #cfe0f5;",
      "border-radius:999px;padding:3px 10px;font-family:inherit;line-height:1.2;white-space:nowrap}",
      "#" + IND_ID + " .mlssi-dot{width:6px;height:6px;border-radius:50%;background:#2E6A4B;display:inline-block}",
      "#" + IND_ID + ".is-today .mlssi-dot{background:#2E6A4B}"
    ].join("");
    var s = safe(function () { return document.createElement("style"); }, null);
    if (!s) return;
    s.id = STYLE_ID; s.textContent = css;
    safe(function () { (document.head || document.documentElement).appendChild(s); });
  }

  function dateInput(bar) { return safe(function () { return bar.querySelector('input[data-mlsnu="day"]'); }, null); }
  function todayBtn(bar) { return safe(function () { return bar.querySelector('[data-mlsnu="today"]'); }, null); }

  function setIndicator(bar, key) {
    var ind = safe(function () { return bar.querySelector("#" + IND_ID); }, null);
    if (!ind) {
      ind = safe(function () { return document.createElement("span"); }, null);
      if (!ind) return;
      ind.id = IND_ID;
      ind.setAttribute("aria-live", "polite");
      safe(function () { bar.appendChild(ind); });
    }
    var isToday = (key === todayKey());
    safe(function () {
      var html = '<span class="mlssi-dot"></span><span>Viewing: ' +
        (isToday ? "Today" : pretty(key)) + "</span>";
      if (ind.__mlsSig !== html) { ind.innerHTML = html; ind.__mlsSig = html; } /* b171: signature-guard so the observer stops self-retriggering */
      ind.classList.toggle("is-today", isToday);
    });
  }

  function reconcile(bar) {
    var di = dateInput(bar); if (!di) return;
    var key = di.value || todayKey();
    var tb = todayBtn(bar);
    if (tb) {
      var shouldOn = (key === todayKey());
      if (shouldOn && !tb.classList.contains("on")) safe(function () { tb.classList.add("on"); });
      if (!shouldOn && tb.classList.contains("on")) safe(function () { tb.classList.remove("on"); });
    }
    setIndicator(bar, key);
  }

  function augment(bar) {
    if (!bar || bar.__mlsSdsWired) return;
    bar.__mlsSdsWired = true;
    injectCSS();
    var di = dateInput(bar);
    var tb = todayBtn(bar);

    if (tb) safe(function () {
      tb.addEventListener("click", function () {
        var di2 = dateInput(bar);
        if (di2) { try { di2.value = todayKey(); } catch (e) {} }
        reconcile(bar);
      });
    });
    if (di) safe(function () {
      di.addEventListener("change", function () { reconcile(bar); });
      di.addEventListener("input", function () { reconcile(bar); });
    });
    reconcile(bar);
  }

  var _obs = null, _poll = null, _polls = 0, _t = null;
  function schedule() { if (_t) return; _t = setTimeout(function () { _t = null; tick(); }, 120); }
  function tick() {
    var bar = $(BAR_ID);
    if (bar) { augment(bar); reconcile(bar); }
  }

  function boot() {
    tick();
    safe(function () {
      _obs = new MutationObserver(function () { schedule(); });
      _obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    });
    safe(function () {
      _poll = setInterval(function () { _polls++; tick(); if (_polls > 600) { try { clearInterval(_poll); _poll = null; } catch (e) {} } }, 1200);
    });
  }

  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); _obs = null; });
    safe(function () { if (_poll) { clearInterval(_poll); _poll = null; } });
    safe(function () { if (_t) { clearTimeout(_t); _t = null; } });
    safe(function () { var ind = $(IND_ID); if (ind && ind.parentNode) ind.parentNode.removeChild(ind); });
    safe(function () { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { var bar = $(BAR_ID); if (bar) bar.__mlsSdsWired = false; });
    safe(function () { window.__mlsSchedDateSync.installed = false; });
  }

  window.__mlsSchedDateSync = { installed: true, version: VERSION, reapply: boot, revert: revert };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();


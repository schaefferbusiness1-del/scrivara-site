/* feat_mls_ctx_appt.js  ->  window.__mlsCtxAppt   [item53]
 *
 * Active-patient APPOINTMENT CHIP on the patient context bar.
 * The schedule (appointment time + reason) lives in the Today's-patients picker, but
 * once a patient is active that scheduling context disappears -- the context bar shows
 * only name / DOB / "no visits". This surfaces the active patient's OWN appointment
 * straight on the context bar as a small read-only chip ("Appt 12:45 PM - EN15"),
 * matched from the SAME schedule the picker uses, so the bar and the picker always
 * agree about when today's visit is and why.
 *
 * CONNECTIVE: matches window.activePatient() against window.__mlsPick.scopeList(...) --
 * the one schedule the picker, calendar and day-flow strip share -- so the appointment
 * shown on the bar is the exact same record the doctor selected from. One source of
 * truth flowing from picker -> active patient -> context bar.
 *
 * SAFETY: read-only / display-only; never writes a chart, never touches athenaOne,
 * never mutates or deletes any record; no PHI logged or sent. ASCII-only. Idempotent.
 * Gated on window.__mlsPick + window.activePatient. Reversible: window.__mlsCtxAppt.revert().
 */
(function () {
  "use strict";
  if (window.__mlsCtxAppt && window.__mlsCtxAppt.__live) return;

  var CHIP_ID = "mlsCtxApptChip";
  var STYLE_ID = "mlsCtxAppt-style";
  var timer = null;

  function pickApi() {
    try { return (window.__mlsPick && window.__mlsPick.installed === true) ? window.__mlsPick : null; }
    catch (e) { return null; }
  }
  function activeP() {
    try { return (typeof window.activePatient === "function") ? window.activePatient() : null; }
    catch (e) { return null; }
  }
  function scope(name) {
    var api = pickApi(); if (!api) return [];
    try { var r = api.scopeList(name); return (r && r.list) ? r.list : []; }
    catch (e) { return []; }
  }
  // find the active patient's scheduled record across the day scopes the picker exposes
  function apptFor(id) {
    if (!id) return null;
    var lists = [scope("today"), scope("recent")];
    for (var i = 0; i < lists.length; i++) {
      var hit = lists[i].filter(function (p) { return p && p.id === id; })[0];
      if (hit) return hit;
    }
    return null;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtMins(m) {
    if (m == null || isNaN(m)) return "";
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? "AM" : "PM", hh = h % 12; if (hh === 0) hh = 12;
    return hh + ":" + (mm < 10 ? "0" : "") + mm + " " + ap;
  }

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "#" + CHIP_ID + "{display:inline-flex;align-items:center;gap:6px;margin-left:8px;vertical-align:middle;",
      "padding:2px 9px;border-radius:999px;font:700 11px/1.5 inherit;white-space:nowrap;",
      "background:rgba(59,130,246,.14);color:#C9DCD2;border:1px solid rgba(59,130,246,.30);}",
      "#" + CHIP_ID + " svg{width:11px;height:11px;flex:0 0 auto;opacity:.85;}",
      "#" + CHIP_ID + " .mlsca-rsn{opacity:.8;font-weight:600;}",
      "#" + CHIP_ID + " .mlsca-sep{opacity:.5;}"
    ].join("");
    document.head.appendChild(s);
  }

  function ctxBar() { try { return document.getElementById("mlsCtxBar"); } catch (e) { return null; } }
  function mountTarget() {
    var bar = ctxBar(); if (!bar) return null;
    return bar.querySelector(".mlsctx-idtext") || bar.querySelector(".mlsctx-meta") || null;
  }

  function clear() { var c = document.getElementById(CHIP_ID); if (c) c.remove(); }

  function render() {
    if (window.__mlsCtxAppt && window.__mlsCtxAppt.__reverted) return;
    if (!pickApi()) return;
    var bar = ctxBar();
    if (!bar || getComputedStyle(bar).display === "none") { clear(); return; }
    var ap = activeP();
    if (!ap || !ap.id) { clear(); return; }
    var rec = apptFor(ap.id);
    if (!rec || rec.mins == null || isNaN(rec.mins)) { clear(); return; }
    css();
    var target = mountTarget(); if (!target) return;
    var time = fmtMins(rec.mins);
    if (!time) { clear(); return; }
    var reason = (rec.reason && String(rec.reason).trim()) || "";

    var chip = document.getElementById(CHIP_ID);
    if (!chip) { chip = document.createElement("span"); chip.id = CHIP_ID; chip.setAttribute("title", "Today's scheduled appointment"); }
    if (chip.parentNode !== target) target.appendChild(chip);
    var html = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>' +
      '<span>Appt ' + esc(time) + "</span>";
    if (reason) html += '<span class="mlsca-sep">&middot;</span><span class="mlsca-rsn">' + esc(reason) + "</span>";
    if (chip.innerHTML !== html) chip.innerHTML = html;
  }

  function start() { render(); if (timer) clearInterval(timer); timer = setInterval(render, 1200); }

  window.__mlsCtxAppt = {
    __live: true,
    __reverted: false,
    refresh: render,
    revert: function () {
      this.__reverted = true; this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      clear();
      var st = document.getElementById(STYLE_ID); if (st) st.remove();
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

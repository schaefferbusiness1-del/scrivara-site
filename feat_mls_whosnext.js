/* feat_mls_whosnext.js  ->  window.__mlsWhosNext  (v1.1.0)  [item55 + DOB fix 2026-07-06]
 *
 * "Who's Next" picker (the blue NEXT-UP boxes), upgraded per Michael:
 *   1) Renamed heading to "Who's Next".
 *   2) Boxes ALWAYS match the count -- renders every patient in the active list (no more
 *      "6 seen / 0 shown"; the original _renderTodayPatients hid "seen" patients into a
 *      count and rendered nothing).
 *   3) Doctor scoping: when a doctor is picked in Find Doctors, the boxes show ONLY that
 *      doctor's patients, and the picked doctor's name is shown on the picker.
 *
 * WHY in-memory pull data: the backend GET /api/appointments returns only the oldest ~500
 * rows (ignores paging/sort) and never returns today's freshly-saved appts, and stores NO
 * provider on appts (doctor_user_id is null for all). The MLS Assist schedule PULL, however,
 * returns each patient WITH a provider. So this module captures the last pull's parsed list
 * (name/time/dob/reason/provider/date) and renders Who's Next from it -- which is the only
 * source that has BOTH today's patients AND a provider to scope by. Falls back to the app's
 * _calAppts (most recent day) when no pull has happened yet this session.
 *
 * It becomes the single window._renderTodayPatients implementation (so the pull, the 60s
 * refresh, and the item53 painter all route through it -> no tug-of-war, no recursion).
 *
 * SAFETY: read-only; never writes a chart, never writes/deletes athenaOne or backend data;
 * selecting a box only loads the patient's name/DOB into the hero. ASCII-only. Idempotent.
 * Reversible: window.__mlsWhosNext.revert().
 */
;(function () {
  "use strict";
  var VERSION = "1.1.0", ASSET = "feat_mls_whosnext.js", STYLE_ID = "mlsWhosNextStyle", BOX_ID = "mlsWhosNextBox";
  try { if (window.__mlsWhosNext && window.__mlsWhosNext.installed) return; } catch (e) { return; }

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function S(x) { return x == null ? "" : String(x); }

  /* ---------- provider normalization + matching (for doctor scoping) ---------- */
  function normProv(s) {
    return S(s).toUpperCase()
      .replace(/ENCOUNTER SIGNED.*$/, "")          /* drop "Encounter signed-off by ..." noise */
      .replace(/^PROVIDER\s+/, "")
      .replace(/[^A-Z]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function tokens(s) { return normProv(s).split(" ").filter(function (t) { return t.length > 1 && !/^(MD|DO|PA|PAC|NP|DPM|RN)$/.test(t); }); }
  function matchesDoctor(apptProvider, docName) {
    var dn = tokens(docName); if (!dn.length) return true;
    var ap = tokens(apptProvider); if (!ap.length) return false;
    /* require all the doctor's name tokens to be present in the appt provider string */
    for (var i = 0; i < dn.length; i++) if (ap.indexOf(dn[i]) < 0) return false;
    return true;
  }

  /* ---------- data sources ---------- */
  var _pull = null;   /* last pull parsed appts: [{name,time,dob,reason,provider,date}] */
  function dOf(a) { return a.appt_date || a.date || S(a.start_at).slice(0, 10); }
  function hhmm(a) {
    if (/^\d\d?:\d\d/.test(S(a.time))) return ("0" + a.time).slice(-5);
    try { var d = new Date(a.start_at); if (!isNaN(d.getTime())) return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); } catch (e) {}
    return "";
  }
  function calSmart() {
    var ap = window._calAppts || []; if (!ap.length) return [];
    var today = new Date().toISOString().slice(0, 10);
    var has = ap.some(function (a) { return dOf(a) === today; });
    var day = today;
    if (!has) { var ds = {}; ap.forEach(function (a) { var d = dOf(a); if (d) ds[d] = 1; }); var k = Object.keys(ds).sort(); day = k[k.length - 1]; }
    return ap.filter(function (a) { return dOf(a) === day && S(a.name).trim(); })
      .map(function (a) { return { name: a.name, dob: a.dob || "", reason: a.reason || "", time: hhmm(a), provider: a.provider || "" }; });
  }
  /* the active list = last pull if present (has today + provider), else _calAppts most-recent day */
  function activeList() {
    var src = (_pull && _pull.length) ? _pull.slice() : calSmart();
    /* de-dupe by name+time, drop blank names */
    var seen = {}, out = [];
    src.forEach(function (a) { var nm = S(a.name).trim(); if (!nm) return; var k = nm.toLowerCase() + "|" + S(a.time); if (seen[k]) return; seen[k] = 1; out.push({ name: nm, dob: a.dob || "", reason: a.reason || "", time: hhmm(a), provider: a.provider || "" }); });
    out.sort(function (a, b) { return S(a.time).localeCompare(S(b.time)); });
    return out;
  }
  function chosenDoctor() { try { return (window.__mlsFindDoctors && window.__mlsFindDoctors.chosen) || null; } catch (e) { return null; } }

  /* ---------- selection ---------- */
  /* v1.1.0: find the best chart match for an appt name. Athena pulls abbreviate
     names ("Timothy O."), so exact matching alone fails; a "First L." pattern is
     accepted only when it matches exactly ONE chart (never guesses on ambiguity). */
  function chartFor(p) {
    try {
      var nm = S(p.name).trim().toLowerCase(), ps = (window.getPatients && window.getPatients()) || [];
      for (var i = 0; i < ps.length; i++) { if (S(ps[i].name).trim().toLowerCase() === nm && (!p.dob || S(ps[i].dob) === S(p.dob))) return ps[i]; }
      var m = nm.match(/^(\S+)\s+([a-z])\.?$/);
      if (m) {
        var hits = [];
        for (var j = 0; j < ps.length; j++) { var t = S(ps[j].name).trim().toLowerCase().split(/\s+/); if (t.length > 1 && t[0] === m[1] && t[t.length - 1].charAt(0) === m[2]) hits.push(ps[j]); }
        if (hits.length === 1) return hits[0];
      }
    } catch (e) {}
    return null;
  }
  /* v1.1.0: best-known DOB for an appt: the appt row, else its (unique) chart,
     else any other appointment of the same patient that captured a DOB. */
  function bestDob(p, chart) {
    if (p.dob) return p.dob;
    try { if (chart && chart.dob) return chart.dob; } catch (e) {}
    try {
      var nm = S(p.name).trim().toLowerCase(), ap = window._calAppts || [];
      for (var i = 0; i < ap.length; i++) { if (ap[i] && ap[i].dob && S(ap[i].name).trim().toLowerCase() === nm) return ap[i].dob; }
    } catch (e) {}
    return "";
  }
  function pick(p) {
    try {
      var nm = $("heroPtName"); if (nm) { nm.value = p.name || ""; ["input", "change"].forEach(function (ev) { try { nm.dispatchEvent(new Event(ev, { bubbles: true })); } catch (e) {} }); }
      var chart = chartFor(p);
      var dob = bestDob(p, chart);
      /* ALWAYS write the DOB field -- an empty write clears the PREVIOUS patient's
         stale DOB instead of silently leaving a wrong value (v1.1.0 fix). */
      var db = $("heroPtDob"); if (db) { db.value = dob || ""; ["input", "change"].forEach(function (ev) { try { db.dispatchEvent(new Event(ev, { bubbles: true })); } catch (e) {} }); }
      if (typeof window._heroSyncName === "function") window._heroSyncName();
      /* if this patient exists as a chart, open it too (read-only) */
      try { if (chart && window.openPatient) window.openPatient(chart.id); } catch (e) {}
      try { if (window.toast) window.toast(dob ? ("Loaded " + (p.name || "patient") + " - DOB " + dob) : ("Loaded " + (p.name || "patient") + " - no DOB on the pulled schedule; use From open Athena chart or type it"), ""); } catch (e) {}
    } catch (e) {}
  }

  /* ---------- styles ---------- */
  function injectCSS() {
    var s = $(STYLE_ID); if (s) return;
    s = document.createElement("style"); s.id = STYLE_ID;
    s.textContent = [
      "#mlsPickComplexWrap,#mlsPickSmartWrap{display:none!important}",            /* keep the white duplicate grids retired */
      "#" + BOX_ID + "{margin:2px 0 4px}",
      "#" + BOX_ID + " .wn-hd{display:flex;align-items:center;gap:8px;margin:2px 0 8px;flex-wrap:wrap}",
      "#" + BOX_ID + " .wn-title{font-size:12px;font-weight:800;letter-spacing:.3px;opacity:.95}",
      "#" + BOX_ID + " .wn-doc{font-size:11px;font-weight:700;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:2px 9px;color:#fff}",
      "#" + BOX_ID + " .wn-doc b{font-weight:800}",
      "#" + BOX_ID + " .wn-clear{font-size:11px;color:#dbe7ff;background:none;border:0;cursor:pointer;text-decoration:underline;padding:0}",
      "#" + BOX_ID + " .wn-count{font-size:11.5px;opacity:.82;margin-left:auto}",
      "#" + BOX_ID + " .wn-grid{display:flex;gap:8px;flex-wrap:wrap}",
      "#" + BOX_ID + " .wn-chip{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:120px;max-width:220px;text-align:left;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.32);color:#fff;border-radius:11px;padding:8px 11px;cursor:pointer;font-family:inherit}",
      "#" + BOX_ID + " .wn-chip:hover{background:rgba(255,255,255,.27)}",
      "#" + BOX_ID + " .wn-chip .wn-nm{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}",
      "#" + BOX_ID + " .wn-chip .wn-mt{font-size:11px;opacity:.85}",
      "#" + BOX_ID + " .wn-empty{font-size:12px;opacity:.85;padding:8px 2px}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- render into #heroToday ---------- */
  function render() {
    try {
      injectCSS();
      var host = $("heroToday"); if (!host) return;
      var list = activeList();
      var doc = chosenDoctor();
      var shown = list, filteredOut = 0;
      if (doc) {
        var f = list.filter(function (a) { return matchesDoctor(a.provider, doc.name || doc.raw); });
        filteredOut = list.length - f.length;
        shown = f;
      }
      var CAP = 60, moreN = 0;
      if (shown.length > CAP) { moreN = shown.length - CAP; shown = shown.slice(0, CAP); }
      host.style.display = "block";
      var html = '<div class="wn-hd"><span class="wn-title">&#128203; Who&#39;s Next</span>';
      if (doc) html += '<span class="wn-doc">&#129658; <b>' + esc(doc.name || doc.raw) + '</b></span><button type="button" class="wn-clear" data-wn-clear="1">show all</button>';
      html += '<span class="wn-count">' + shown.length + (shown.length === 1 ? " patient" : " patients") + (moreN ? (" &middot; +" + moreN + " more, pick a doctor to narrow") : "") + '</span></div>';
      if (!shown.length) {
        html += '<div class="wn-empty">' + (doc ? ("No " + esc(doc.name || doc.raw) + " patients in the current schedule. ") : "No patients loaded yet. ") + 'Pull the day schedule from athenaOne to populate this.</div>';
      } else {
        html += '<div class="wn-grid">';
        for (var i = 0; i < shown.length; i++) {
          var p = shown[i];
          var meta = [];
          if (p.time) meta.push(esc(p.time));
          if (p.reason) meta.push(esc(p.reason));
          html += '<button type="button" class="wn-chip" data-wn-i="' + i + '"><span class="wn-nm">' + esc(p.name) + '</span>' + (meta.length ? '<span class="wn-mt">' + meta.join(" &middot; ") + '</span>' : '') + '</button>';
        }
        html += '</div>';
      }
      host.innerHTML = html;
      /* wire */
      var chips = host.querySelectorAll("[data-wn-i]");
      for (var c = 0; c < chips.length; c++) chips[c].addEventListener("click", function () { var idx = +this.getAttribute("data-wn-i"); if (shown[idx]) pick(shown[idx]); });
      var clr = host.querySelector("[data-wn-clear]");
      if (clr) clr.addEventListener("click", function () { try { if (window.__mlsFindDoctors) window.__mlsFindDoctors.chosen = null; } catch (e) {} render(); });
    } catch (e) {}
  }

  /* ---------- become the single _renderTodayPatients + capture pulls ---------- */
  var _origParse = null, _wrapParse = false;
  function wrapParse() {
    try {
      if (_wrapParse || typeof window._parseScheduleText !== "function") return;
      if (window._parseScheduleText.__wnWrapped) { _wrapParse = true; return; }
      _origParse = window._parseScheduleText;
      var f = async function () {
        var arr = await _origParse.apply(this, arguments);
        try { if (Array.isArray(arr) && arr.length) { _pull = arr.map(function (a) { return { name: a.name, dob: a.dob || "", reason: a.reason || "", time: a.time || "", provider: a.provider || "", date: a.date || "" }; }); setTimeout(render, 50); setTimeout(render, 800); } } catch (e) {}
        return arr;
      };
      f.__wnWrapped = true; window._parseScheduleText = f; _wrapParse = true;
    } catch (e) {}
  }
  function installRenderer() {
    try {
      if (window._renderTodayPatients && window._renderTodayPatients.__wnRender) return;
      var fn = function (appts) { try { render(); } catch (e) {} };
      fn.__wnRender = true; fn.__mlsUnrGuard = true; fn.__mlsUpNowWrapped = true;   /* block upnow re-wrap/recursion */
      window._renderTodayPatients = fn;
    } catch (e) {}
  }

  var _obs = null, _poll = null, _lastChosen = "__init__";
  function tick() {
    installRenderer(); wrapParse();
    var cur = (chosenDoctor() || {}).raw || "";
    if (cur !== _lastChosen) { _lastChosen = cur; render(); }
  }
  function boot() {
    injectCSS(); installRenderer(); wrapParse(); render();
    try { _obs = new MutationObserver(function () { installRenderer(); }); _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    _poll = setInterval(tick, 1500);
    try { [300, 900, 2000, 4000].forEach(function (ms) { setTimeout(function () { installRenderer(); render(); }, ms); }); } catch (e) {}
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_poll) clearInterval(_poll); } catch (e) {}
    try { if (_origParse && window._parseScheduleText && window._parseScheduleText.__wnWrapped) window._parseScheduleText = _origParse; } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { var b = $("heroToday"); if (b) { b.innerHTML = ""; } } catch (e) {}
    try { window.__mlsWhosNext.installed = false; } catch (e) {}
  }

  window.__mlsWhosNext = {
    installed: true, version: VERSION, asset: ASSET,
    render: render, activeList: activeList, _setPull: function (a) { _pull = a; render(); }, reapply: boot, revert: revert
  };

  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();

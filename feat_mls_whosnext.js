/* feat_mls_whosnext.js  ->  window.__mlsWhosNext  (v1.3.0)  [b34/b35 batch 2026-07-06]
 *
 * "Who's Next" picker (the blue NEXT-UP boxes), upgraded per Michael:
 *   1) Renamed heading to "Who's Next".
 *   2) Boxes ALWAYS match the count -- renders every patient in the active list.
 *   3) Doctor scoping: when a doctor is picked in Find Doctors, the boxes show ONLY that
 *      doctor's patients, and the picked doctor's name is shown on the picker.
 *   v1.2.0 (b34 batch):
 *   4) DEFAULT provider scope comes from the ACTUAL provider data (the pulled Athena
 *      schedule provider strings + the account provider identity resolved by
 *      window.getProviderName, which is roster/data-driven as of b34 -- NO hardcoded
 *      clinician names anywhere in this file). Fail-safe: if no row carries a provider
 *      signal, or none match, it shows ALL patients and says so honestly.
 *   5) Shows 5 patients at a time with a "More" control that expands into a scrollable
 *      grid ("Show less" collapses back).
 *   6) ALWAYS shows the patient's birthday on every box (cake icon + DOB; highlighted
 *      when today is their birthday; a dash when no DOB is known from any source).
 *
 * WHY in-memory pull data: the backend GET /api/appointments returns only the oldest ~500
 * rows and stores NO provider on appts. The MLS Assist schedule PULL returns each patient
 * WITH a provider. So this module captures the last pull's parsed list and renders Who's
 * Next from it. Falls back to _calAppts (most recent day) when no pull happened yet.
 *
 * It becomes the single window._renderTodayPatients implementation.
 *
 * SAFETY: read-only; never writes a chart, never writes/deletes athenaOne or backend data;
 * selecting a box only loads the patient's name/DOB into the hero. ASCII-only. Idempotent.
 * Reversible: window.__mlsWhosNext.revert().
 */
;(function () {
  "use strict";
  var VERSION = "1.3.1", ASSET = "feat_mls_whosnext.js", STYLE_ID = "mlsWhosNextStyle", BOX_ID = "mlsWhosNextBox";
  try { if (window.__mlsWhosNext && window.__mlsWhosNext.installed) return; } catch (e) { return; }

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function S(x) { return x == null ? "" : String(x); }

  /* ---------- provider normalization + matching (for doctor scoping) ---------- */
  function normProv(s) {
    return S(s).toUpperCase()
      .replace(/ENCOUNTER SIGNED.*$/, "")
      .replace(/^PROVIDER\s+/, "")
      .replace(/[^A-Z]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function tokens(s) { return normProv(s).split(" ").filter(function (t) { return t.length > 1 && !/^(MD|DO|PA|PAC|NP|DPM|RN|DR)$/.test(t); }); }
  function matchesDoctor(apptProvider, docName) {
    var dn = tokens(docName); if (!dn.length) return true;
    var ap = tokens(apptProvider); if (!ap.length) return false;
    for (var i = 0; i < dn.length; i++) if (ap.indexOf(dn[i]) < 0) return false;
    return true;
  }

  /* ---------- data sources ---------- */
  var _pull = null;
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
  function activeList() {
    var src = (_pull && _pull.length) ? _pull.slice() : calSmart();
    var seen = {}, out = [];
    src.forEach(function (a) { var nm = S(a.name).trim(); if (!nm) return; var k = nm.toLowerCase() + "|" + S(a.time); if (seen[k]) return; seen[k] = 1; out.push({ name: nm, dob: a.dob || "", reason: a.reason || "", time: hhmm(a), provider: a.provider || "" }); });
    out.sort(function (a, b) { return S(a.time).localeCompare(S(b.time)); });
    return out;
  }
  function chosenDoctor() { try { return (window.__mlsFindDoctors && window.__mlsFindDoctors.chosen) || null; } catch (e) { return null; } }

  /* v1.2.0: the signed-in provider, resolved from REAL data (roster / stored identity),
     never a hardcoded name. Empty string when unknown -> no auto-scope (fail-safe). */
  function dataProvider() {
    try { if (typeof window.getProviderName === "function") return S(window.getProviderName() || "").trim(); } catch (e) {}
    return "";
  }

  /* ---------- chart match + DOB (unchanged from v1.1.0) ---------- */
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
  function bestDob(p, chart) {
    if (p.dob) return p.dob;
    try { if (chart && chart.dob) return chart.dob; } catch (e) {}
    try {
      var nm = S(p.name).trim().toLowerCase(), ap = window._calAppts || [];
      for (var i = 0; i < ap.length; i++) { if (ap[i] && ap[i].dob && S(ap[i].name).trim().toLowerCase() === nm) return ap[i].dob; }
    } catch (e) {}
    return "";
  }
  /* v1.2.0: birthday helpers -- ALWAYS show a birthday line on each box. */
  function dobParts(dob) {
    var s = S(dob).trim(); if (!s) return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/); if (m) return { y: +m[3], mo: +m[1], d: +m[2] };
    return null;
  }
  function isBirthdayToday(dob) {
    var p = dobParts(dob); if (!p) return false;
    var n = new Date(); return (n.getMonth() + 1) === p.mo && n.getDate() === p.d;
  }
  function fmtDob(dob) {
    var p = dobParts(dob); if (!p) return S(dob).trim();
    return ("0" + p.mo).slice(-2) + "/" + ("0" + p.d).slice(-2) + (p.y ? "/" + p.y : "");
  }
  function pick(p) {
    try {
      var nm = $("heroPtName"); if (nm) { nm.value = p.name || ""; ["input", "change"].forEach(function (ev) { try { nm.dispatchEvent(new Event(ev, { bubbles: true })); } catch (e) {} }); }
      var chart = chartFor(p);
      var dob = bestDob(p, chart);
      var db = $("heroPtDob"); if (db) { db.value = dob || ""; ["input", "change"].forEach(function (ev) { try { db.dispatchEvent(new Event(ev, { bubbles: true })); } catch (e) {} }); }
      if (typeof window._heroSyncName === "function") window._heroSyncName();
      try { if (chart && window.openPatient) window.openPatient(chart.id); } catch (e) {}
      /* v1.2.0: DOB comes from the Athena-sourced data (pull row / chart / other appts).
         If none of those know it, say CLEARLY that an Athena login/lookup is needed. */
      dobBanner(p, dob);
      try { if (window.toast) window.toast(dob ? ("Loaded " + (p.name || "patient") + " - DOB " + dob) : ("Loaded " + (p.name || "patient") + " - DOB not available locally"), ""); } catch (e) {}
    } catch (e) {}
  }
  /* v1.2.0: inline banner under the DOB field: green when the birthday auto-filled
     from Athena-sourced data, amber "sign in to athenaOne" when it is unknown. */
  function dobBanner(p, dob) {
    try {
      var db = $("heroPtDob"); if (!db || !db.parentElement) return;
      var el = $("mlsWnDobNote");
      if (!el) { el = document.createElement("div"); el.id = "mlsWnDobNote"; el.style.cssText = "margin-top:4px;font:600 11.5px system-ui;line-height:1.35"; db.parentElement.appendChild(el); }
      if (dob) {
        el.style.color = "#bff0c9";
        el.innerHTML = "&#127874; Birthday auto-filled from the Athena-sourced schedule: <b>" + esc(fmtDob(dob)) + "</b>" + (isBirthdayToday(dob) ? " &middot; <b>birthday today!</b>" : "");
      } else {
        el.style.color = "#ffd78a";
        el.innerHTML = "&#9888;&#65039; No birthday on file locally for <b>" + esc(p.name || "this patient") + "</b> &mdash; sign in to athenaOne (or open their Athena chart) to look it up.";
      }
    } catch (e) {}
  }

  /* ---------- styles ---------- */
  function injectCSS() {
    var s = $(STYLE_ID); if (s) return;
    s = document.createElement("style"); s.id = STYLE_ID;
    var roots = ["#" + BOX_ID, "#heroToday"];
    var css = ["#mlsPickComplexWrap,#mlsPickSmartWrap{display:none!important}"];
    roots.forEach(function (R) {
      css = css.concat([
        R + "{margin:2px 0 4px}",
        R + " .wn-hd{display:flex;align-items:center;gap:8px;margin:2px 0 8px;flex-wrap:wrap}",
        R + " .wn-title{font-size:12px;font-weight:800;letter-spacing:.3px;opacity:.95}",
        R + " .wn-doc{font-size:11px;font-weight:700;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:2px 9px;color:#fff}",
        R + " .wn-doc b{font-weight:800}",
        R + " .wn-clear{font-size:11px;color:#dbe7ff;background:none;border:0;cursor:pointer;text-decoration:underline;padding:0}",
        R + " .wn-count{font-size:11.5px;opacity:.82;margin-left:auto}",
        R + " .wn-grid{display:flex;gap:8px;flex-wrap:wrap}",
        R + " .wn-grid.wn-scroll{max-height:300px;overflow-y:auto;padding-right:4px}",
        R + " .wn-chip{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:120px;max-width:220px;text-align:left;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.32);color:#fff;border-radius:11px;padding:8px 11px;cursor:pointer;font-family:inherit}",
        R + " .wn-chip:hover{background:rgba(255,255,255,.27)}",
        R + " .wn-chip .wn-nm{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}",
        R + " .wn-chip .wn-mt{font-size:11px;opacity:.85}",
        R + " .wn-chip .wn-bd{font-size:10.5px;opacity:.8}",
        R + " .wn-chip .wn-bd.wn-bd-today{opacity:1;color:#ffe9a8;font-weight:800}",
        R + " .wn-more{background:rgba(255,255,255,.14);border:1px dashed rgba(255,255,255,.45);color:#fff;border-radius:11px;padding:8px 14px;cursor:pointer;font-weight:800;font-size:12px;font-family:inherit;align-self:center}",
        R + " .wn-more:hover{background:rgba(255,255,255,.25)}",
        R + " .wn-empty{font-size:12px;opacity:.85;padding:8px 2px}"
      ]);
    });
    s.textContent = css.join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  /* v1.3.0: minutes-of-day for an "HH:MM" time (clinic-local as pulled from Athena). */
  /* v1.3.1: 12-hour AM/PM display everywhere (no military time in the UI). */
  function fmt12(t) {
    var m = S(t).match(/^(\d\d?):(\d\d)/); if (!m) return S(t);
    var h = +m[1], ap = h >= 12 ? "PM" : "AM"; h = h % 12; if (h === 0) h = 12;
    return h + ":" + m[2] + " " + ap;
  }
  function timeMins(t) { var m = S(t).match(/^(\d\d?):(\d\d)/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  /* v1.3.0: index of the patient "up now" -- started within the last 30 min, else the
     next upcoming, else the day's last (mirrors the hero's _calPickNowIdx logic). */
  function nowIdx(list) {
    var n = new Date(), nowM = n.getHours() * 60 + n.getMinutes();
    var timed = []; for (var i = 0; i < list.length; i++) { var m = timeMins(list[i].time); if (m != null) timed.push({ i: i, m: m }); }
    if (!timed.length) return 0;
    timed.sort(function (a, b) { return a.m - b.m; });
    var cur = null;
    for (var k = 0; k < timed.length; k++) { if (timed[k].m <= nowM && timed[k].m >= nowM - 30) cur = timed[k]; }
    if (cur) return cur.i;
    for (var j = 0; j < timed.length; j++) { if (timed[j].m >= nowM) return timed[j].i; }
    return timed[timed.length - 1].i;
  }

  /* ---------- render into #heroToday ---------- */
  var _expanded = false;     /* v1.2.0: 5-at-a-time window, "More" expands */
  var _autoOff = false;      /* v1.2.0: user pressed "show all" while auto-scoped */
  function render() {
    try {
      injectCSS();
      var host = $("heroToday"); if (!host) return;
      var list = activeList();
      var doc = chosenDoctor();
      var shown = list, filteredOut = 0, autoDoc = "";
      if (doc) {
        var f = list.filter(function (a) { return matchesDoctor(a.provider, doc.name || doc.raw); });
        filteredOut = list.length - f.length;
        shown = f;
      } else if (!_autoOff) {
        /* v1.2.0: default scope = the signed-in provider, from real data only.
           Fail-safe: apply only when at least one row genuinely matches. */
        var dp = dataProvider();
        if (dp) {
          var g = list.filter(function (a) { return a.provider && matchesDoctor(a.provider, dp); });
          if (g.length > 0 && g.length < list.length) { shown = g; filteredOut = list.length - g.length; autoDoc = dp; }
        }
      }
      var CAP = 60, moreN = 0;
      if (shown.length > CAP) { moreN = shown.length - CAP; shown = shown.slice(0, CAP); }
      var LIMIT = 5;
      /* v1.3.0: auto-show the 5 patients nearest to NOW (clinic-local schedule times) */
      var start = 0;
      if (!_expanded && shown.length > LIMIT) {
        start = Math.max(0, Math.min(nowIdx(shown) - 1, shown.length - LIMIT));
      }
      var visible = _expanded ? shown : shown.slice(start, start + LIMIT);
      var hiddenN = shown.length - visible.length;
      host.style.display = "block";
      var html = '<div class="wn-hd"><span class="wn-title">&#128203; Who&#39;s Next</span>';
      if (doc) html += '<span class="wn-doc">&#129658; <b>' + esc(doc.name || doc.raw) + '</b></span><button type="button" class="wn-clear" data-wn-clear="1">show all</button>';
      else if (autoDoc) html += '<span class="wn-doc">&#129658; <b>' + esc(autoDoc) + '</b> (your patients)</span><button type="button" class="wn-clear" data-wn-autoclear="1">show all</button>';
      html += '<span class="wn-count">' + shown.length + (shown.length === 1 ? " patient" : " patients") + (moreN ? (" &middot; +" + moreN + " more, pick a doctor to narrow") : "") + '</span></div>';
      if (!shown.length) {
        html += '<div class="wn-empty">' + (doc ? ("No " + esc(doc.name || doc.raw) + " patients in the current schedule. ") : "No patients loaded yet. ") + 'Pull the day schedule from athenaOne to populate this.</div>';
      } else {
        html += '<div class="wn-grid' + (_expanded ? ' wn-scroll' : '') + '">';
        for (var i = 0; i < visible.length; i++) {
          var p = visible[i];
          var meta = [];
          if (p.time) meta.push(esc(fmt12(p.time)));
          if (p.reason) meta.push(esc(p.reason));
          var dob = bestDob(p, chartFor(p));
          var bd = '<span class="wn-bd' + (isBirthdayToday(dob) ? ' wn-bd-today' : '') + '">&#127874; ' + (dob ? esc(fmtDob(dob)) + (isBirthdayToday(dob) ? ' &middot; birthday today!' : '') : 'DOB &mdash;') + '</span>';
          html += '<button type="button" class="wn-chip" data-wn-i="' + i + '"><span class="wn-nm">' + esc(p.name) + '</span>' + (meta.length ? '<span class="wn-mt">' + meta.join(" &middot; ") + '</span>' : '') + bd + '</button>';
        }
        if (hiddenN > 0) html += '<button type="button" class="wn-more" data-wn-more="1">&#9662; More &middot; all ' + shown.length + ' patients</button>';
        else if (_expanded && shown.length > LIMIT) html += '<button type="button" class="wn-more" data-wn-more="1">&#9652; Show less</button>';
        html += '</div>';
      }
      host.innerHTML = html;
      /* wire */
      var chips = host.querySelectorAll("[data-wn-i]");
      for (var c = 0; c < chips.length; c++) chips[c].addEventListener("click", function () { var idx = +this.getAttribute("data-wn-i"); if (visible[idx]) pick(visible[idx]); });
      var clr = host.querySelector("[data-wn-clear]");
      if (clr) clr.addEventListener("click", function () { try { if (window.__mlsFindDoctors) window.__mlsFindDoctors.chosen = null; } catch (e) {} render(); });
      var aclr = host.querySelector("[data-wn-autoclear]");
      if (aclr) aclr.addEventListener("click", function () { _autoOff = true; render(); });
      var mr = host.querySelector("[data-wn-more]");
      if (mr) mr.addEventListener("click", function () { _expanded = !_expanded; render(); });
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
      fn.__wnRender = true; fn.__mlsUnrGuard = true; fn.__mlsUpNowWrapped = true;
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

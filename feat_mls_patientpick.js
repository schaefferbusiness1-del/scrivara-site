/* feat_mls_patientpick.js  ->  window.__mlsPick  (shared pull-and-select patient picker)
 *
 *  Restores the "pull the day's patients, then pick one with a single click" flow that
 *  MLS Easy used to have, as a clean, design-matching, SELECTABLE-CARD grid that works
 *  in BOTH the Simple guided view and the Complex view.
 *
 *  It does NOT reimplement any clinical logic. It reads the app's own data
 *  (window.getPatients(), window._calAppts, window._calProviders) and selects a patient
 *  through the app's own blessed handler window.openPatient(id) -- the exact call the
 *  native centerpiece walk uses -- which sets the active patient AND refreshes the
 *  patient context bar (#mlsCtxBar) automatically. No PHI is logged or sent anywhere.
 *  No patient data is fabricated: every card comes from an existing scheduled appointment
 *  matched to an existing patient record.
 *
 *  Public API (window.__mlsPick):
 *    .activePatient()                     -> the real active patient record (or null)
 *    .scopeList(scope, provider)          -> { list, dateLabel, fallback } for a scope
 *    .renderGrid(hostEl, opts)            -> draw selectable cards into hostEl
 *    .openModal(opts)                     -> overlay modal of selectable cards
 *    .select(id)                          -> activate a patient (openPatient) + sync UI
 *    .providerOptionsHTML(selected)       -> <option> list of real providers
 *
 *  Reversible: window.__mlsPick.revert().  ASCII-only (emoji via HTML numeric entities).
 *  Idempotent. Additive. Gated the same way the other *_exact modules are (staging page,
 *  or prod via the data: mls-connect.staging.js enable marker).
 */
;(function () {
  "use strict";
  /* pick-1.2.0:
   *   - card shows the APPOINTMENT TIME; cards ordered earliest-first (existing sort)
   *   - shows only the first 6 with a "Show more" control that reveals the rest
   *   - auto-advances toward the current time slot: the next-up appointment is
   *     highlighted ("Now"/"Next") and scrolled into view; a light timer keeps it
   *     current as the clock moves (idempotent class/scroll only -> no flicker)
   *   - renders an INLINE selectable grid in Complex visit mode too (not only the modal)
   *   - keeps the top active-patient context bar (#mlsCtxBar) bound + visible
   */
  var VERSION = "pick-1.2.0";
  try { if (window.__mlsPick && window.__mlsPick.installed) return; } catch (e) { return; }

  function gateOn() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window.__mlsPick = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  var STYLE_ID = "mlspkStyle";
  var MODAL_ID = "mlsPickModal";

  /* emoji as numeric entities so this source stays pure ASCII */
  var E = { person: "&#128100;", cal: "&#128197;", calWk: "&#128198;", find: "&#128269;",
            pen: "&#9997;&#65039;", check: "&#10003;", arrow: "&#8594;", down: "&#11015;&#65039;" };

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function callFn(name, arg) { try { if (typeof window[name] === "function") return window[name](arg); } catch (e) {} return undefined; }

  /* ---- app data (read-only) ---- */
  function getPatients() { try { return (window.getPatients && window.getPatients()) || []; } catch (e) { return []; } }
  function activeId() { try { return (window.getActivePtId && window.getActivePtId()) || null; } catch (e) { return null; } }
  function activePatient() {
    try { if (typeof window.activePatient === "function") { var a = window.activePatient(); if (a) return a; } } catch (e) {}
    var id = activeId(); if (!id) return null;
    var ps = getPatients(); for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === id) return ps[i];
    return null;
  }
  function appts() { try { return window._calAppts || []; } catch (e) { return []; } }
  function providers() { try { return window._calProviders || []; } catch (e) { return []; } }
  function connected() { try { if (window.__mlsUxUnify && typeof window.__mlsUxUnify.connected === "function") return !!window.__mlsUxUnify.connected(); } catch (e) {} return false; }

  /* ---- small utils ---- */
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/);
    if (!parts.length || !parts[0]) return "?";
    var a = parts[0][0] || ""; var b = parts.length > 1 ? (parts[parts.length - 1][0] || "") : "";
    return (a + b).toUpperCase();
  }
  function parseDob(dob) {
    var s = String(dob || "").trim(); if (!s) return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);              // YYYY-MM-DD
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);      // MM-DD-YYYY or MM/DD/YYYY
    if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
    var d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }
  function ageFromDob(dob) {
    var d = parseDob(dob); if (!d || isNaN(d.getTime())) return null;
    var now = new Date(); var a = now.getFullYear() - d.getFullYear();
    var mo = now.getMonth() - d.getMonth();
    if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) a--;
    return (a >= 0 && a < 130) ? a : null;
  }
  function localDateStr(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function prettyDate(ds) {
    var m = String(ds || "").match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return ds || "";
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    try { return d.toLocaleDateString([], { month: "short", day: "numeric" }); } catch (e) { return ds; }
  }
  function apptDate(a) { return String(a.appt_date || a.start_at || "").slice(0, 10); }

  /* ---- appointment time (read the LITERAL clock from the ISO string so the
     displayed time matches the scheduled slot regardless of the viewer's
     timezone; the synthetic appt_date already matches the ISO date) ---- */
  function apptMins(t) {
    var m = String(t == null ? "" : t).match(/T(\d{2}):(\d{2})/);
    if (!m) { m = String(t == null ? "" : t).match(/(?:^|\s)(\d{1,2}):(\d{2})/); }
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
  }
  function fmtTime(t) {
    var mins = apptMins(t); if (mins == null) return "";
    var h = Math.floor(mins / 60), mi = mins % 60;
    var ap = h < 12 ? "AM" : "PM"; var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + (mi < 10 ? "0" : "") + mi + " " + ap;
  }
  function nowMins() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  /* index of the first card at/after "now" (the slot we are advancing toward);
     if every slot is in the past, points at the last card. -1 when list empty. */
  function nowIndex(list) {
    if (!list || !list.length) return -1;
    var n = nowMins(), i;
    for (i = 0; i < list.length; i++) {
      var mm = (list[i].mins != null) ? list[i].mins : apptMins(list[i].time);
      if (mm != null && mm >= n) return i;
    }
    return list.length - 1;
  }

  /* ---- match an appointment to an existing patient record ---- */
  function buildIndex() {
    var ps = getPatients(), byExt = {}, byNameDob = {}, byName = {};
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i]; if (!p) continue;
      if (p.external_id != null && p.external_id !== "") byExt[String(p.external_id)] = p;
      var nm = (p.name || "").toLowerCase();
      if (nm) { byNameDob[nm + "|" + (p.dob || "")] = p; if (!byName[nm]) byName[nm] = p; }
    }
    return { byExt: byExt, byNameDob: byNameDob, byName: byName };
  }
  function matchAppt(a, idx) {
    if (a.patient_external_id != null && idx.byExt[String(a.patient_external_id)]) return idx.byExt[String(a.patient_external_id)];
    var nm = (a.name || "").toLowerCase();
    if (nm && idx.byNameDob[nm + "|" + (a.dob || "")]) return idx.byNameDob[nm + "|" + (a.dob || "")];
    if (nm && idx.byName[nm]) return idx.byName[nm];
    return null;
  }

  /* ---- provider filter (lenient: only applies when it actually narrows) ---- */
  function providerId(name) {
    var list = providers();
    for (var i = 0; i < list.length; i++) {
      var nm = (list[i].name || list[i].displayName || "").toString();
      if (nm && nm.toLowerCase() === String(name || "").toLowerCase()) return list[i].id;
    }
    return null;
  }

  /* ---- build the selectable list for a scope ---- */
  /* scope: "today" | "week" | "recent" (recent = most recent day that has appointments) */
  function scopeList(scope, provider) {
    var all = appts(), idx = buildIndex();
    var today = localDateStr(new Date());
    var pool = [], dateLabel = "", fallback = false;

    function dayPool(ds) { return all.filter(function (a) { return apptDate(a) === ds; }); }
    function distinctDates() {
      var d = {}; all.forEach(function (a) { var x = apptDate(a); if (x) d[x] = 1; });
      return Object.keys(d).sort();
    }

    if (scope === "today") {
      pool = dayPool(today); dateLabel = "today";
      if (!pool.length) { var ds = distinctDates(); var last = ds[ds.length - 1]; if (last) { pool = dayPool(last); dateLabel = prettyDate(last); fallback = true; } }
    } else if (scope === "week") {
      var now = new Date(); var dow = now.getDay(); var start = new Date(now); start.setDate(now.getDate() - dow);
      var end = new Date(start); end.setDate(start.getDate() + 6);
      var s = localDateStr(start), e2 = localDateStr(end);
      pool = all.filter(function (a) { var d = apptDate(a); return d >= s && d <= e2; });
      dateLabel = "this week";
      if (!pool.length) { var ds2 = distinctDates(); var last2 = ds2[ds2.length - 1]; if (last2) { pool = dayPool(last2); dateLabel = prettyDate(last2); fallback = true; } }
    } else { /* recent */
      var ds3 = distinctDates(); var last3 = ds3[ds3.length - 1];
      if (last3) { pool = dayPool(last3); dateLabel = prettyDate(last3); }
    }

    /* provider filter -- only if it leaves something */
    if (provider && !/all/i.test(provider)) {
      var pid = providerId(provider);
      if (pid != null) {
        var narrowed = pool.filter(function (a) { return a.doctor_user_id != null && String(a.doctor_user_id) === String(pid); });
        if (narrowed.length) pool = narrowed;
      }
    }

    /* sort by time, de-dupe by patient, resolve to a real record */
    pool = pool.slice().sort(function (a, b) { return String(a.start_at || a.appt_date || "").localeCompare(String(b.start_at || b.appt_date || "")); });
    var seen = {}, out = [];
    for (var i = 0; i < pool.length; i++) {
      var a = pool[i];
      var key = (a.patient_external_id || "") + "|" + (a.name || "") + "|" + (a.dob || "");
      if (seen[key]) continue; seen[key] = 1;
      var p = matchAppt(a, idx); if (!p) continue;
      out.push({ id: p.id, name: p.name || a.name || "(unnamed)", dob: p.dob || a.dob || "",
        sex: p.sex || "", mrn: p.mrn || "", reason: a.reason || "", time: a.start_at || "",
        mins: apptMins(a.start_at) });
    }
    return { list: out, dateLabel: dateLabel, fallback: fallback, scope: scope };
  }

  /* ===================== select (the one clean click) ===================== */
  function select(id) {
    if (!id) return null;
    try {
      if (typeof window.openPatient === "function") window.openPatient(id);
      else { if (window.setActivePtId) window.setActivePtId(id); if (window.renderProfile) window.renderProfile(); }
    } catch (e) {}
    /* keep the patient context bar + native renderers in sync (openPatient usually does this) */
    try { if (window.renderPatientBar) window.renderPatientBar(); } catch (e) {}
    try { if (window.__mlsCard && window.__mlsCard.refresh) window.__mlsCard.refresh(); } catch (e) {}
    try { ensureCtxBar(); } catch (e) {}
    var p = null, ps = getPatients(); for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === id) { p = ps[i]; break; }
    try { document.dispatchEvent(new CustomEvent("mls:patientpicked", { detail: { id: id, patient: p } })); } catch (e) {}
    return p;
  }

  /* ===================== providers <option>s ===================== */
  function providerOptionsHTML(selected) {
    var sel = selected || "All doctors";
    var opts = ['<option' + (/all/i.test(sel) ? " selected" : "") + ">" + E.person + " All doctors</option>"];
    var list = providers();
    for (var i = 0; i < list.length; i++) {
      var nm = (list[i].name || list[i].displayName || ("Provider " + (list[i].id || (i + 1)))).toString();
      opts.push("<option" + (nm === sel ? " selected" : "") + ">" + esc(nm) + "</option>");
    }
    return opts.join("");
  }

  /* ===================== styles ===================== */
  function injectCSS() {
    var css = [
      ".mlspk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:12px}",
      ".mlspk-card{display:flex;align-items:center;gap:12px;text-align:left;padding:13px 14px;border-radius:14px;border:1px solid #e4ebf3;background:#fff;cursor:pointer;font-family:inherit;transition:border-color .12s,box-shadow .12s,transform .06s;width:100%}",
      ".mlspk-card:hover{border-color:#b9d0f3;box-shadow:0 8px 22px -14px rgba(13,33,56,.4)}",
      ".mlspk-card:active{transform:translateY(1px)}",
      ".mlspk-card.is-active{border-color:#2f6bed;box-shadow:0 0 0 2px rgba(47,107,237,.18)}",
      ".mlspk-av{width:42px;height:42px;border-radius:12px;background:#eef3fb;color:#2f6bed;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0}",
      ".mlspk-card.is-active .mlspk-av{background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff}",
      ".mlspk-info{flex:1;min-width:0;line-height:1.3}",
      ".mlspk-nm{display:block;font-weight:700;font-size:14px;color:#0f2540;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".mlspk-meta{display:block;color:#6b7d93;font-size:12px;margin-top:1px}",
      ".mlspk-reason{display:block;color:#8a9cb2;font-size:11.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".mlspk-go{flex-shrink:0;font-size:11.5px;font-weight:700;color:#2f6bed;background:#eef3fb;border-radius:8px;padding:5px 10px}",
      ".mlspk-card.is-active .mlspk-go{color:#1f9d6b;background:#e7f5ee}",
      /* time pill on the left edge of each card */
      ".mlspk-time{flex-shrink:0;min-width:62px;text-align:center;font-weight:700;font-size:12px;color:#15406f;background:#eef3fb;border:1px solid #dbe6f6;border-radius:9px;padding:6px 8px;line-height:1.1}",
      ".mlspk-time small{display:block;font-size:9px;font-weight:700;letter-spacing:.05em;color:#7e93ad;margin-top:1px}",
      ".mlspk-card.is-now .mlspk-time{background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;border-color:transparent}",
      ".mlspk-card.is-now .mlspk-time small{color:#cfe0fb}",
      ".mlspk-card.is-now{border-color:#2f6bed;box-shadow:0 0 0 2px rgba(47,107,237,.16)}",
      ".mlspk-card.is-active.is-now{box-shadow:0 0 0 2px rgba(47,107,237,.28)}",
      /* show more / fewer control */
      ".mlspk-more{grid-column:1/-1;margin-top:2px;display:flex;justify-content:center}",
      ".mlspk-more button{height:38px;padding:0 18px;border-radius:11px;border:1px solid #dbe6f6;background:#f5f9ff;color:#2f6bed;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit}",
      ".mlspk-more button:hover{background:#eaf2ff}",
      ".mlspk-empty{padding:22px 14px;text-align:center;color:#8a9cb2;font-size:13px;border:1px dashed #dde6f0;border-radius:14px;background:#fbfcfe}",
      ".mlspk-note{font-size:12px;color:#6b7d93;margin:0 0 10px}",
      /* inline Complex host */
      "#mlsPickComplexWrap{margin:0 0 18px;font-family:'Plus Jakarta Sans',system-ui,sans-serif}",
      "#mlsPickComplexWrap .mlspk-cx-hd{display:flex;align-items:baseline;gap:10px;margin:0 0 10px}",
      "#mlsPickComplexWrap .mlspk-cx-hd h4{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:19px;margin:0;color:#0f2540}",
      "#mlsPickComplexWrap .mlspk-cx-hd span{font-size:12px;color:#8a9cb2}",
      "html.mls-sv-active #mlsPickComplexWrap{display:none!important}",
      /* modal */
      "#" + MODAL_ID + "{position:fixed;inset:0;z-index:100050;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 16px;background:rgba(8,18,33,.55);font-family:'Plus Jakarta Sans',system-ui,sans-serif}",
      "#" + MODAL_ID + "[hidden]{display:none}",
      "#" + MODAL_ID + " .mlspk-panel{background:#fff;border-radius:20px;width:100%;max-width:760px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 30px 70px -25px rgba(8,18,33,.7);overflow:hidden}",
      "#" + MODAL_ID + " .mlspk-hd{display:flex;align-items:center;gap:12px;padding:20px 22px 14px}",
      "#" + MODAL_ID + " .mlspk-hd h3{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:23px;margin:0;color:#0f2540;flex:1}",
      "#" + MODAL_ID + " .mlspk-x{width:34px;height:34px;border-radius:9px;border:1px solid #e0e8f1;background:#fff;color:#5a6b80;font-size:18px;cursor:pointer;flex-shrink:0}",
      "#" + MODAL_ID + " .mlspk-controls{display:flex;gap:8px;flex-wrap:wrap;padding:0 22px 14px;align-items:center}",
      "#" + MODAL_ID + " .mlspk-tab{height:34px;padding:0 14px;border-radius:9px;border:1px solid #e0e8f1;background:#fff;color:#3d5168;font-weight:600;font-size:12.5px;cursor:pointer;font-family:inherit}",
      "#" + MODAL_ID + " .mlspk-tab.on{background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;border-color:transparent}",
      "#" + MODAL_ID + " select.mlspk-prov{height:34px;border-radius:9px;border:1px solid #e0e8f1;background:#f8fafc;padding:0 30px 0 12px;font-size:12.5px;font-weight:600;color:#0f2540;font-family:inherit;cursor:pointer;-webkit-appearance:none;appearance:none}",
      "#" + MODAL_ID + " .mlspk-body{overflow:auto;padding:4px 22px 8px}",
      "#" + MODAL_ID + " .mlspk-foot{border-top:1px solid #eef2f7;background:#f8fafc;padding:14px 22px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}",
      "#" + MODAL_ID + " .mlspk-foot .mlspk-fbtn{height:40px;padding:0 14px;border-radius:11px;border:1px solid #e0e8f1;background:#fff;color:#2f6bed;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}",
      "@media(max-width:560px){.mlspk-grid{grid-template-columns:1fr}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  /* ===================== card grid ===================== */
  var DEFAULT_LIMIT = 6;
  function cardHTML(p, isActive, isNow) {
    var age = ageFromDob(p.dob);
    var meta = [];
    if (age != null) meta.push(age + "y");
    if (p.sex) meta.push(esc(p.sex));
    if (p.dob) meta.push("DOB " + esc(p.dob));
    var tStr = fmtTime(p.time);
    var upcoming = (p.mins != null && p.mins >= nowMins());
    var tag = isNow ? ('<small>' + (upcoming ? "NEXT" : "NOW") + '</small>') : (tStr ? '<small>appt</small>' : '');
    var timePill = '<span class="mlspk-time">' + (tStr ? esc(tStr) : "&mdash;") + tag + '</span>';
    return '<button type="button" class="mlspk-card' + (isActive ? " is-active" : "") + (isNow ? " is-now" : "") + '" data-id="' + esc(p.id) + '" data-mins="' + (p.mins == null ? "" : p.mins) + '">' +
      timePill +
      '<span class="mlspk-av">' + esc(initials(p.name)) + '</span>' +
      '<span class="mlspk-info">' +
        '<span class="mlspk-nm">' + esc(p.name) + '</span>' +
        '<span class="mlspk-meta">' + (meta.join(" &middot; ") || "Patient") + '</span>' +
        (p.reason ? '<span class="mlspk-reason">' + esc(p.reason) + '</span>' : '') +
      '</span>' +
      '<span class="mlspk-go">' + (isActive ? (E.check + " Active") : "Select") + '</span>' +
    '</button>';
  }

  /* ---- hosts registry for the "advance toward now" timer ---- */
  var _gridHosts = [], _nowTimer = null;
  function registerHost(h, opts) { if (!h) return; h.__mlspkOpts = opts; if (_gridHosts.indexOf(h) < 0) _gridHosts.push(h); startNowTimer(); }
  function startNowTimer() { if (_nowTimer) return; try { _nowTimer = setInterval(refreshNow, 45000); } catch (e) {} }
  function refreshNow() {
    for (var i = _gridHosts.length - 1; i >= 0; i--) {
      var h = _gridHosts[i];
      try {
        if (!h || !h.isConnected) { _gridHosts.splice(i, 1); continue; }
        if (!h.offsetWidth && !h.offsetHeight) continue;   /* hidden (self or ancestor) */
        if (h.__mlspkOpts) renderGrid(h, h.__mlspkOpts);
      } catch (e) {}
    }
  }

  /* opts: { scope, provider, onPick, showNote, limit } */
  function renderGrid(hostEl, opts) {
    if (!hostEl) return;
    injectCSS();
    opts = opts || {};
    var res = scopeList(opts.scope || "recent", opts.provider);
    var curId = activeId();
    var limit = (opts.limit == null ? DEFAULT_LIMIT : opts.limit) | 0; if (limit < 1) limit = DEFAULT_LIMIT;
    var nIdx = nowIndex(res.list);
    var total = res.list.length;
    var expanded = !!hostEl.__mlspkExpanded;
    /* collapsed = a window of `limit` cards anchored at the current slot, so the list
       advances toward "now" as the day progresses while still showing only 6 at a time.
       In the morning (nIdx 0) this is simply the earliest 6. "Show more" reveals all. */
    var count = expanded ? total : Math.min(limit, total);
    var start = expanded ? 0 : Math.max(0, Math.min(nIdx < 0 ? 0 : nIdx, total - count));
    var end = start + count;
    var focalId = (nIdx >= 0 && nIdx < total) ? res.list[nIdx].id : "";

    /* idempotent: skip the DOM rewrite when nothing visible changed (no flicker) */
    var sig = res.scope + "|" + res.dateLabel + "|" + total + "|" + start + "|" + count + "|" + curId + "|" + focalId + "|" + (expanded ? 1 : 0) + "|" + (opts.showNote === false ? 0 : 1);
    registerHost(hostEl, opts);
    if (hostEl.__mlspkSig === sig && hostEl.firstChild) return res;
    hostEl.__mlspkSig = sig;

    var html = "";
    if (opts.showNote !== false) {
      if (res.fallback) html += '<p class="mlspk-note">No one on today\'s schedule yet &mdash; showing your most recent day (' + esc(res.dateLabel) + ').</p>';
      else if (total) html += '<p class="mlspk-note">' + total + ' patient' + (total === 1 ? "" : "s") + ' on ' + esc(res.dateLabel === "today" ? "today&#39;s schedule" : res.dateLabel) + ' &middot; in time order &middot; tap one to select.</p>';
    }
    if (!total) {
      html += '<div class="mlspk-empty">No scheduled patients found for this view. Use &ldquo;Find a patient by name&rdquo; or &ldquo;Enter manually&rdquo; below.</div>';
      hostEl.innerHTML = html;
      return res;
    }
    html += '<div class="mlspk-grid">';
    for (var i = start; i < end; i++) html += cardHTML(res.list[i], res.list[i].id === curId, i === nIdx);
    if (total > limit) {
      var moreN = total - count;
      html += '<div class="mlspk-more"><button type="button" data-mlspk-more="1">' +
        (expanded ? "Show fewer" : ("Show more (" + moreN + " more)")) + '</button></div>';
    }
    html += '</div>';
    hostEl.innerHTML = html;

    var cards = hostEl.querySelectorAll(".mlspk-card");
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        var p = select(id);
        try { if (typeof opts.onPick === "function") opts.onPick(id, p); } catch (e) {}
      });
    }
    var moreBtn = hostEl.querySelector("[data-mlspk-more]");
    if (moreBtn) moreBtn.addEventListener("click", function () {
      hostEl.__mlspkExpanded = !hostEl.__mlspkExpanded;
      hostEl.__mlspkSig = "";            /* force a rebuild */
      renderGrid(hostEl, opts);
    });

    /* advance toward now: scroll the focal card into view when it changes
       (skip the first paint so the page doesn't jump on load) */
    try {
      if (focalId && hostEl.__mlspkPainted && hostEl.__mlspkFocal !== focalId) {
        var fc = hostEl.querySelector('.mlspk-card.is-now');
        if (fc && fc.scrollIntoView) fc.scrollIntoView({ block: "nearest" });
      }
      hostEl.__mlspkFocal = focalId;
      hostEl.__mlspkPainted = true;
    } catch (e) {}
    return res;
  }

  /* ===================== modal (used by Complex + Switch patient) ===================== */
  var _modalScope = "today", _modalProvider = "All doctors";
  function ensureModal() {
    injectCSS();
    var m = $(MODAL_ID);
    if (m) return m;
    m = mk("div"); m.id = MODAL_ID; m.setAttribute("hidden", "");
    m.innerHTML =
      '<div class="mlspk-panel" role="dialog" aria-label="Pick a patient">' +
        '<div class="mlspk-hd"><h3>Today&#39;s patients</h3><button type="button" class="mlspk-x" aria-label="Close">&#215;</button></div>' +
        '<div class="mlspk-controls">' +
          '<button type="button" class="mlspk-tab" data-scope="today">Today</button>' +
          '<button type="button" class="mlspk-tab" data-scope="week">This week</button>' +
          '<button type="button" class="mlspk-tab" data-scope="recent">Recent</button>' +
          '<span style="flex:1"></span>' +
          '<select class="mlspk-prov"></select>' +
        '</div>' +
        '<div class="mlspk-body"></div>' +
        '<div class="mlspk-foot">' +
          '<button type="button" class="mlspk-fbtn" data-act="find">' + E.find + ' Find by name</button>' +
          '<button type="button" class="mlspk-fbtn" data-act="athena">' + E.down + ' Pull from athenaOne</button>' +
          '<span style="flex:1"></span>' +
          '<span style="color:#8a9cb2;font-size:11.5px">Synthetic data only</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    m.querySelector(".mlspk-x").addEventListener("click", closeModal);
    m.addEventListener("mousedown", function (e) { if (e.target === m) closeModal(); });
    var tabs = m.querySelectorAll(".mlspk-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener("click", function () { _modalScope = this.getAttribute("data-scope"); paintModal(); });
    var prov = m.querySelector(".mlspk-prov");
    prov.addEventListener("change", function () { _modalProvider = this.value || "All doctors"; paintModal(); });
    m.querySelector('[data-act="find"]').addEventListener("click", function () {
      if (!callFnTry("mlscpFind")) callFn("mlsQuickFind");
      closeModal();
    });
    m.querySelector('[data-act="athena"]').addEventListener("click", function () {
      /* trigger the real schedule pull (works when athenaOne is connected); list refreshes after */
      try { if (typeof window.pullScheduleViaAssist === "function") window.pullScheduleViaAssist(this); } catch (e) {}
      setTimeout(paintModal, 1400);
    });
    document.addEventListener("keydown", onKey, true);
    return m;
  }
  function callFnTry(id) { var el = $(id); if (el) { try { el.click(); return true; } catch (e) {} } return false; }
  function onKey(e) { if (e.key === "Escape" && isModalOpen()) { e.preventDefault(); closeModal(); } }
  function paintModal() {
    var m = $(MODAL_ID); if (!m) return;
    var tabs = m.querySelectorAll(".mlspk-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("on", tabs[i].getAttribute("data-scope") === _modalScope);
    var prov = m.querySelector(".mlspk-prov"); if (prov && prov.innerHTML.indexOf("option") < 0) prov.innerHTML = providerOptionsHTML(_modalProvider);
    var body = m.querySelector(".mlspk-body");
    renderGrid(body, { scope: _modalScope, provider: _modalProvider, onPick: function () { closeModal(); } });
  }
  function openModal(opts) {
    opts = opts || {};
    var m = ensureModal();
    _modalScope = opts.scope || "today";
    _modalProvider = "All doctors";
    var prov = m.querySelector(".mlspk-prov"); if (prov) prov.innerHTML = providerOptionsHTML(_modalProvider);
    m.removeAttribute("hidden");
    paintModal();
  }
  function closeModal() { var m = $(MODAL_ID); if (m) m.setAttribute("hidden", ""); }
  function isModalOpen() { var m = $(MODAL_ID); return !!(m && !m.hasAttribute("hidden")); }

  /* ===================== Complex view wiring ===================== */
  /* The Complex hero's "Pull today's patients" quick action (onclick=pullScheduleViaAssist)
     opens this selectable-card modal in addition to attempting the real pull. View-isolated. */
  var _obs = null, _wireT = null;
  function onVisitComplex() {
    try {
      var v = $("visitView"); if (!v || getComputedStyle(v).display === "none") return false;
      return !document.documentElement.classList.contains("mls-sv-active"); /* Complex = not simple */
    } catch (e) { return false; }
  }
  function wireComplex() {
    try {
      if (!onVisitComplex()) return;
      var hero = $("visitHero"); if (!hero) return;
      var btns = hero.querySelectorAll("button[onclick]");
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.__mlspkWired) continue;
        var oc = b.getAttribute("onclick") || "";
        if (/pullScheduleViaAssist/i.test(oc)) {
          /* deterministically replace the inline pull handler with one that opens the
             selectable-card modal (the modal still offers a real "Pull from athenaOne"). */
          b.__mlspkWired = true;
          b.setAttribute("data-mlspk-onclick", oc);
          b.removeAttribute("onclick");
          b.onclick = function (ev) { try { ev.preventDefault(); } catch (e) {} openModal({ scope: "today" }); };
        }
      }
    } catch (e) {}
  }

  /* ---- inline selectable grid for COMPLEX visit mode (not just the modal) ---- */
  var CX_WRAP = "mlsPickComplexWrap";
  function renderComplexInline() {
    var w = $(CX_WRAP);
    if (!onVisitComplex()) { if (w) w.style.display = "none"; return; }
    var v = $("visitView"); if (!v) return;
    if (!w || w.parentElement !== v) {
      if (w) { try { w.parentElement.removeChild(w); } catch (e) {} }
      w = mk("div"); w.id = CX_WRAP; w.setAttribute("data-mls-asset", "feat_mls_patientpick.js");
      w.innerHTML =
        '<div class="mlspk-cx-hd"><h4>Today&#39;s patients</h4><span>in time order &middot; tap one to open their chart</span></div>' +
        '<div class="mlspk-cx-grid"></div>';
      /* place it just under the dark hero, above the capture/note grid */
      var hero = $("visitHero");
      if (hero && hero.parentElement === v && hero.nextSibling) v.insertBefore(w, hero.nextSibling);
      else if (hero && hero.parentElement === v) v.appendChild(w);
      else v.insertBefore(w, v.firstChild);
    }
    w.style.display = "";
    var host = w.querySelector(".mlspk-cx-grid");
    renderGrid(host, { scope: "today", limit: DEFAULT_LIMIT, onPick: function () { ensureCtxBar(); } });
  }

  /* ---- keep the compact top active-patient widget (#mlsCtxBar) present ---- */
  function ensureCtxBar() {
    try {
      var c = $("mlsCtxBar");
      if (c && c.querySelector(".mlsctx-id") && getComputedStyle(c).display === "none") c.style.display = "";
    } catch (e) {}
  }

  function tick() { wireComplex(); renderComplexInline(); ensureCtxBar(); }
  function boot() {
    injectCSS();
    tick();
    try {
      _obs = new MutationObserver(function () { if (_wireT) return; _wireT = setTimeout(function () { _wireT = null; tick(); }, 200); });
      _obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    startNowTimer();
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_nowTimer) { clearInterval(_nowTimer); _nowTimer = null; } } catch (e) {}
    _gridHosts = [];
    try { var wired = document.querySelectorAll("[data-mlspk-onclick]"); for (var i = 0; i < wired.length; i++) { var w = wired[i]; w.setAttribute("onclick", w.getAttribute("data-mlspk-onclick")); w.removeAttribute("data-mlspk-onclick"); w.onclick = null; w.__mlspkWired = false; } } catch (e) {}
    try { var cw = $(CX_WRAP); if (cw) cw.remove(); } catch (e) {}
    try { var m = $(MODAL_ID); if (m) m.remove(); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { document.removeEventListener("keydown", onKey, true); } catch (e) {}
    try { window.__mlsPick.installed = false; } catch (e) {}
  }

  window.__mlsPick = {
    installed: true, version: VERSION,
    activePatient: activePatient, scopeList: scopeList, renderGrid: renderGrid,
    openModal: openModal, closeModal: closeModal, select: select,
    providerOptionsHTML: providerOptionsHTML, reapply: boot, revert: revert
  };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();

/* feat_mls_calendar_exact.js  ->  window.__mlsCx  (Calendar page, design-exact rebuild)
 *
 *  STAGING ONLY. Loaded by mls-connect.staging.js AFTER feat_mls_redesign.js,
 *  feat_mls_visit_exact.js and feat_mls_header_exact.js. Never loaded by the
 *  prod loader mls-connect.js. Runtime-gated to the staging page. Prod untouched.
 *
 *  Brings the Calendar view (#calendarView) to design_renders/ScribeFlow Calendar.dc.html:
 *    - a 288px sticky LEFT RAIL (the design feature the app lacked): big
 *      "+ New appointment" CTA, a real mini-month calendar, a real "Day at a
 *      glance" status breakdown, and a "Providers" card
 *    - the existing calendar card becomes the design "agenda" section (white,
 *      rounded, design tokens), Newsreader title
 *
 *  Everything in the rail is REAL data read from the app's own globals
 *  (_calAppts, _calProviders, _calMonth, _calYear, _calMode, _calRefDate,
 *  _calStatusColor, _calDateOf) -- nothing is fabricated. The real wired
 *  controls (#calNewAppt button, #calProvFilter select) are MOVED in BY ID so
 *  their handlers stay intact. The mini-calendar nav calls the app's real
 *  calPrev/calNext/calToday/renderCalendar. Nothing is deleted; controls the
 *  design omits (Working hours, Remove duplicates, month jump) stay in the
 *  agenda toolbar.
 *
 *  Reversible: window.__mlsCx.revert().  ASCII-only (emoji via HTML entities).
 *  Idempotent. View-isolated to #calendarView.
 */
;(function () {
  "use strict";
  var VERSION = "cx-1.0.0";
  try { if (window.__mlsCx && window.__mlsCx.installed) return; } catch (e) { return; }

  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsCx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "cxStyle";
  var _obs = null, _t = null, _sched = null;
  var LARR = "&#9664;", RARR = "&#9654;";
  var MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DOW = ["S","M","T","W","T","F","S"];

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }
  function impAll(el, list) { if (!el) return; list.forEach(function (p) { var i = p.indexOf(":"); imp(el, p.slice(0, i), p.slice(i + 1)); }); }
  function gv(name, dflt) { try { var x = window[name]; return (x === undefined || x === null) ? dflt : x; } catch (e) { return dflt; } }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function injectCSS() {
    var css = [
      "#calendarView .cx-main{display:grid;grid-template-columns:288px 1fr;gap:20px;align-items:start;margin:0}",
      "#calendarView .cx-rail{display:flex;flex-direction:column;gap:16px;position:sticky;top:138px}",
      "#calendarView .cx-main,#calendarView .cx-main *{box-sizing:border-box}",
      "#calendarView .cx-card{background:#fff;border:1px solid #e4ebf3;border-radius:16px;box-shadow:0 1px 2px rgba(15,37,64,.04)}",
      "#calendarView .cx-mini-day:hover{background:#eef4fc!important}",
      "#calendarView .cx-agenda{background:#fff!important;border:1px solid #e4ebf3!important;border-radius:18px!important;box-shadow:0 1px 2px rgba(15,37,64,.04)!important}",
      "#calendarView .cx-agenda input,#calendarView .cx-agenda select,#calendarView .cx-agenda textarea{max-width:100%}",
      "@media (max-width:980px){#calendarView .cx-main{grid-template-columns:1fr}#calendarView .cx-rail{position:static}}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  /* active day key the app is focused on (real) */
  function activeKey() {
    var k = gv("_calSelDay", null) || gv("_calRefDate", null);
    if (k) return k;
    var n = new Date(); return n.getFullYear() + "-" + pad(n.getMonth() + 1) + "-" + pad(n.getDate());
  }
  function apptDate(a) { try { if (typeof window._calDateOf === "function") return window._calDateOf(a); } catch (e) {} return (a && (a.appt_date || String(a.start_at || "").slice(0, 10))) || ""; }
  function statusColor(s) { try { if (typeof window._calStatusColor === "function") return window._calStatusColor(s); } catch (e) {} return { bg: "#eef4fc", fg: "#155fb3" }; }

  /* ============ LEFT RAIL ============ */
  function buildRail(rail) {
    /* 1) + New appointment : move the REAL #calNewAppt button */
    var slotCTA = rail.querySelector(":scope > .cx-cta-slot");
    if (!slotCTA) { slotCTA = mk("div", ""); slotCTA.className = "cx-cta-slot"; rail.appendChild(slotCTA); }
    var realNew = $("calNewAppt");
    if (realNew && realNew.parentElement !== slotCTA) {
      slotCTA.appendChild(realNew);
      impAll(realNew, ["width:100%", "height:48px", "border-radius:13px", "border:none",
        "background:linear-gradient(135deg,#2f6bed,#2257cf)", "color:#fff", "font-weight:700",
        "font-size:14.5px", "cursor:pointer", "box-shadow:0 12px 26px -10px rgba(47,107,237,.6)",
        "margin:0", "display:flex", "align-items:center", "justify-content:center", "gap:9px"]);
    }

    /* 2) mini calendar (rebuilt from real globals each pass) */
    var mini = rail.querySelector(":scope > .cx-mini");
    if (!mini) { mini = mk("div", "padding:16px"); mini.className = "cx-card cx-mini"; rail.appendChild(mini); }
    renderMini(mini);

    /* 3) day at a glance (rebuilt from real globals each pass) */
    var glance = rail.querySelector(":scope > .cx-glance");
    if (!glance) { glance = mk("div", "padding:16px 18px"); glance.className = "cx-card cx-glance"; rail.appendChild(glance); }
    renderGlance(glance);

    /* 4) providers : move the REAL #calProvFilter select in + real provider list */
    var prov = rail.querySelector(":scope > .cx-prov");
    if (!prov) {
      prov = mk("div", "padding:16px 18px"); prov.className = "cx-card cx-prov";
      prov.innerHTML = '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#8a9cb2;margin-bottom:12px">PROVIDERS</div><div class="cx-prov-list"></div><div class="cx-prov-slot" style="margin-top:6px"></div>';
      rail.appendChild(prov);
    }
    renderProviders(prov);
  }

  function renderMini(mini) {
    var y = gv("_calYear", null), m = gv("_calMonth", null);
    if (y == null || m == null) { var n = new Date(); y = n.getFullYear(); m = n.getMonth(); }
    var first = new Date(y, m, 1), startDow = first.getDay();
    var dim = new Date(y, m + 1, 0).getDate();
    var today = new Date(), tKey = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
    var sel = activeKey();
    /* real appt day set for this month */
    var have = {};
    try {
      var appts = gv("_calAppts", []) || [];
      for (var i = 0; i < appts.length; i++) { var k = apptDate(appts[i]); if (k && k.slice(0, 7) === (y + "-" + pad(m + 1))) have[k] = 1; }
    } catch (e) {}
    var head =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<span style="font-weight:500;font-size:16px;font-family:\'Newsreader\',Georgia,serif">' + MON[m] + " " + y + '</span>' +
        '<div style="display:flex;gap:4px">' +
          '<button class="cx-mini-prev" style="width:28px;height:28px;border-radius:8px;border:1px solid #e0e8f1;background:#fff;color:#6b7d93;font-size:10px;cursor:pointer">' + LARR + '</button>' +
          '<button class="cx-mini-next" style="width:28px;height:28px;border-radius:8px;border:1px solid #e0e8f1;background:#fff;color:#6b7d93;font-size:10px;cursor:pointer">' + RARR + '</button>' +
        '</div></div>';
    var dows = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:5px">';
    for (var d = 0; d < 7; d++) dows += '<div style="text-align:center;font-size:10px;font-weight:700;color:#aab6c6">' + DOW[d] + '</div>';
    dows += '</div>';
    var cells = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">';
    for (var b = 0; b < startDow; b++) cells += '<span></span>';
    for (var day = 1; day <= dim; day++) {
      var key = y + "-" + pad(m + 1) + "-" + pad(day);
      var isT = key === tKey, isS = key === sel, dot = have[key];
      var bg = isS ? "#2f6bed" : (isT ? "#eef4fc" : "transparent");
      var fg = isS ? "#fff" : (isT ? "#155fb3" : "#42566e");
      cells += '<button class="cx-mini-day" data-key="' + key + '" style="position:relative;height:30px;border:none;border-radius:8px;background:' + bg + ';color:' + fg + ';font-size:12px;font-weight:' + (isT || isS ? "700" : "500") + ';cursor:pointer">' + day +
        (dot ? '<span style="position:absolute;left:50%;bottom:3px;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:' + (isS ? "#fff" : "#2f6bed") + '"></span>' : '') + '</button>';
    }
    cells += '</div>';
    var html = head + dows + cells;
    if (mini.getAttribute("data-cx-h") !== html) { mini.innerHTML = html; mini.setAttribute("data-cx-h", html); }
    /* wire */
    var p = mini.querySelector(".cx-mini-prev"), nx = mini.querySelector(".cx-mini-next");
    if (p) p.onclick = function () { try { if (typeof window.calPrev === "function") window.calPrev(); } catch (e) {} schedule(); };
    if (nx) nx.onclick = function () { try { if (typeof window.calNext === "function") window.calNext(); } catch (e) {} schedule(); };
    var btns = mini.querySelectorAll(".cx-mini-day");
    for (var q = 0; q < btns.length; q++) {
      btns[q].onclick = function () {
        var key = this.getAttribute("data-key");
        try {
          if (gv("_calMode", "month") === "day" && typeof window.calOpenDay === "function") { window.calOpenDay(key); }
          else { window._calSelDay = key; if (typeof window.renderCalendar === "function") window.renderCalendar(); }
        } catch (e) {}
        schedule();
      };
    }
  }

  function renderGlance(glance) {
    var key = activeKey();
    var buckets = [
      { label: "Booked", match: ["booked", "scheduled", ""], color: "#155fb3" },
      { label: "Arrived", match: ["arrived", "checked_in"], color: "#9a6b00" },
      { label: "Roomed", match: ["roomed"], color: "#2a4bbd" },
      { label: "Completed", match: ["completed"], color: "#11643f" }
    ];
    var counts = [0, 0, 0, 0], total = 0;
    try {
      var appts = gv("_calAppts", []) || [];
      for (var i = 0; i < appts.length; i++) {
        var a = appts[i]; if (apptDate(a) !== key) continue;
        total++;
        var st = String(a.status || a.appt_status || "").toLowerCase();
        var placed = false;
        for (var bIdx = 1; bIdx < buckets.length; bIdx++) {
          if (buckets[bIdx].match.indexOf(st) >= 0) { counts[bIdx]++; placed = true; break; }
        }
        if (!placed) counts[0]++;
      }
    } catch (e) {}
    var dt = key.split("-"), nowLbl = "";
    try { nowLbl = new Date(key + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" }); } catch (e) { nowLbl = key; }
    var rows = "";
    for (var r = 0; r < buckets.length; r++) {
      rows += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:11px">' +
        '<span style="width:10px;height:10px;border-radius:3px;background:' + buckets[r].color + '"></span>' +
        '<span style="flex:1;color:#42566e;font-size:13px;font-weight:600">' + buckets[r].label + '</span>' +
        '<span style="font-weight:800;font-size:15px;color:#0f2540">' + counts[r] + '</span></div>';
    }
    var html =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:13px">' +
        '<span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#8a9cb2">DAY AT A GLANCE</span>' +
        '<span style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#1f7d5c;background:#eef7f3;border:1px solid #cfe9dd;padding:3px 9px;border-radius:20px"><span style="width:6px;height:6px;border-radius:50%;background:#27b07a"></span>' + nowLbl + '</span>' +
      '</div>' + rows +
      '<div style="border-top:1px solid #eef2f7;margin-top:6px;padding-top:12px;display:flex;align-items:center;justify-content:space-between">' +
        '<span style="color:#6b7d93;font-size:12.5px;font-weight:600">Total booked</span>' +
        '<span style="font-weight:800;font-size:18px;color:#2f6bed">' + total + '</span></div>';
    if (glance.getAttribute("data-cx-h") !== html) { glance.innerHTML = html; glance.setAttribute("data-cx-h", html); }
  }

  function renderProviders(prov) {
    var list = prov.querySelector(".cx-prov-list");
    var provs = gv("_calProviders", []) || [];
    var palette = ["#2f6bed", "#19b8a6", "#a855f7", "#e8833a", "#d6457f", "#0ea5b7"];
    var html = "";
    if (provs.length) {
      for (var i = 0; i < provs.length; i++) {
        var p = provs[i], nm = String(p.name || ("Provider " + (p.id || (i + 1))));
        var parts = nm.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/);
        var ini = ((parts[0] || "")[0] || "") + ((parts[1] || "")[0] || ""); ini = ini.toUpperCase() || "?";
        var col = palette[i % palette.length];
        html += '<label style="display:flex;align-items:center;gap:10px;margin-bottom:11px">' +
          '<span style="width:22px;height:22px;border-radius:6px;background:' + col + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px">' + ini + '</span>' +
          '<span style="flex:1;color:#42566e;font-size:13px;font-weight:600">' + nm + '</span></label>';
      }
    } else {
      html = '<div style="color:#9aa8bb;font-size:12.5px;font-weight:500;margin-bottom:8px">All providers</div>';
    }
    if (list && list.getAttribute("data-cx-h") !== html) { list.innerHTML = html; list.setAttribute("data-cx-h", html); }
    /* move the REAL provider filter select in (keeps filtering wired) */
    var slot = prov.querySelector(".cx-prov-slot");
    var sel = $("calProvFilter");
    if (sel && slot && sel.parentElement !== slot) {
      slot.appendChild(sel);
      impAll(sel, ["width:100%", "height:36px", "border-radius:9px", "border:1px solid #e0e8f1",
        "background:#fff", "padding:0 11px", "font-size:12.5px", "margin:0"]);
    }
  }

  /* ============ AGENDA (restyle existing card) ============ */
  function styleAgenda(card) {
    card.classList.add("cx-agenda");
    imp(card, "padding", "0");
    imp(card, "margin", "0");
    imp(card, "overflow", "hidden");
    /* inner padding wrapper: leave the card's children but add comfortable padding via a class on h2/toolbar is risky;
       instead pad the card uniformly */
    imp(card, "padding", "20px 24px 24px");
    /* Newsreader month label */
    var lbl = $("calMonthLabel");
    if (lbl) { imp(lbl, "font-family", "'Newsreader',Georgia,serif"); imp(lbl, "font-weight", "500"); imp(lbl, "font-size", "24px"); imp(lbl, "letter-spacing", "-.01em"); }
  }

  /* ============ orchestration ============ */
  function build() {
    var v = $("calendarView"); if (!v) return;
    injectCSS();
    var card = v.querySelector(":scope > .card"); if (!card) return;

    var main = v.querySelector(":scope > .cx-main");
    if (!main) {
      main = mk("div"); main.className = "cx-main";
      var rail = mk("div"); rail.className = "cx-rail";
      var agendaSlot = mk("div"); agendaSlot.className = "cx-agenda-slot"; agendaSlot.style.cssText = "min-width:0";
      main.appendChild(rail); main.appendChild(agendaSlot);
      v.insertBefore(main, v.firstChild);
    }
    var rail = main.querySelector(":scope > .cx-rail");
    var agendaSlot = main.querySelector(":scope > .cx-agenda-slot");
    if (card.parentElement !== agendaSlot) agendaSlot.appendChild(card);

    buildRail(rail);
    styleAgenda(card);
    v.setAttribute("data-cx-built", VERSION);
  }
  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { build(); } catch (e) {}
    try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 150); }
  function boot() {
    try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {}
    applyAll();
    var n = 0; _t = setInterval(function () { applyAll(); if (++n > 12) clearInterval(_t); }, 700);
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_t) clearInterval(_t); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    /* Restore the real moved-in controls back into the card, move the card
       out of the slot, then remove the scaffold so nothing real is destroyed. */
    try {
      var v = $("calendarView"), main = v && v.querySelector(":scope > .cx-main");
      if (main) {
        var card = main.querySelector(".card");
        if (card) {
          var realNew = $("calNewAppt"); if (realNew) card.appendChild(realNew);
          var realProv = $("calProvFilter"); if (realProv) card.appendChild(realProv);
          v.insertBefore(card, main);
        }
        if (main.parentNode) main.parentNode.removeChild(main);
      }
    } catch (e) {}
    try { window.__mlsCx.installed = false; } catch (e) {}
  }

  window.__mlsCx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();

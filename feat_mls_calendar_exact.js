/* feat_mls_calendar_exact.js  ->  window.__mlsCx  (Calendar page, design-exact rebuild)
 *
 *  STAGING-FIRST. Loaded by mls-connect.staging.js AFTER feat_mls_redesign.js,
 *  feat_mls_visit_exact.js and feat_mls_header_exact.js, and (after verification)
 *  by the prod loader mls-connect.js via the data: staging marker. Runtime-gated to
 *  the staging page. View-isolated to #calendarView.
 *
 *  Brings the Calendar view to design_renders/ScribeFlow Calendar.dc.html:
 *    - 288px sticky LEFT RAIL: big "+ New appointment" CTA (the app's real wired
 *      button moved in BY ID), real mini-month, real "Day at a glance" status
 *      breakdown, and a "Providers" card (real provider list + real #calProvFilter).
 *    - the agenda card rebuilt to the design HEADER: a bordered prev/Today/next
 *      nav group, a Newsreader serif date title + subtitle, a segmented
 *      Day | Week | Month control, and a right cluster (Refresh, Working hours,
 *      date picker, Remove duplicates, Check-in) -- ALL the app's REAL wired
 *      controls, MOVED into the design slots BY ID / onclick so handlers stay
 *      intact. The month grid is restyled to the design tokens (8px gaps,
 *      uppercase DOW, rounded cells). Nothing is fabricated; nothing is deleted.
 *
 *  Reversible: window.__mlsCx.revert().  ASCII-only (emoji via HTML entities).
 *  Idempotent.
 */
;(function () {
  "use strict";
  var VERSION = "cx-2.1.1";
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
      "#calendarView .cx-card{background:#fff;border:1px solid #E7E5DD;border-radius:16px;box-shadow:0 1px 2px rgba(20,33,28,.04)}",
      "#calendarView .cx-mini-day:hover{background:#eef4fc!important}",
      /* Fix #1: stop Saturday column overflow/spill from the mini-month rail onto the main grid */
      "#calendarView .cx-mini > div{width:100%}",
      "#calendarView .cx-mini > div > *{min-width:0}",
      "#calendarView .cx-mini-day{min-width:0;padding:0}",
      "#calendarView .cx-agenda-head{border-bottom:1px solid #F4F2EC;padding-bottom:16px}",
      "#calendarView .cx-agenda{background:#fff!important;border:1px solid #E7E5DD!important;border-radius:18px!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important}",
      "#calendarView .cx-agenda input,#calendarView .cx-agenda select,#calendarView .cx-agenda textarea{max-width:100%}",
      /* Fix #4: !important so the design pill wins over native renderCalendar inline blue-fill writes */
      "#calendarView .cx-seg-btn{height:32px;padding:0 16px;border-radius:8px;border:none!important;font-family:inherit;cursor:pointer;font-weight:600;font-size:13px;background:transparent!important;color:#79837C!important;box-shadow:none!important}",
      "#calendarView .cx-seg-btn.cx-on{background:#fff!important;color:#2E6A4B!important;box-shadow:0 1px 2px rgba(20,33,28,.1)!important;font-weight:700!important}",
      "#calendarView .cx-navbtn{width:36px;height:36px;border-radius:9px;border:1px solid #e0e8f1;background:#fff;color:#3d5168;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}",
      "#calendarView .cx-todaybtn{height:36px;padding:0 14px;border-radius:9px;border:1px solid #e0e8f1;background:#fff;color:#3d5168;font-weight:600;font-size:13px;font-family:inherit;cursor:pointer}",
      "#calendarView .cx-ghost{height:40px;padding:0 14px;border-radius:11px;border:1px solid #e0e8f1;background:#fff;color:#3d5168;font-weight:600;font-size:13px;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}",
      /* month grid polish to design tokens */
      "#calendarView #calGrid>div{gap:8px!important}",
      /* contain the app month/week/day grid so it never overflows narrow viewports */
      "#calendarView #calSplitWrap,#calendarView #calGrid{min-width:0;max-width:100%}",
      "#calendarView #calSplitWrap>*{min-width:0;max-width:100%}",
      "#calendarView #calGrid>div{max-width:100%}",
      "#calendarView #calGrid>div>*{min-width:0;overflow:hidden}",
      "#calendarView #calGrid>div>*>*{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis}",
      "@media (max-width:980px){#calendarView .cx-main{grid-template-columns:1fr}#calendarView .cx-rail{position:static;min-width:0}#calendarView .cx-agenda-slot{min-width:0}#calendarView .cx-agenda{min-width:0}#calendarView .cx-rail>*{min-width:0;max-width:100%}#calendarView .cx-mini *{min-width:0}#calendarView .cx-agenda-head{gap:10px}}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  function activeKey() {
    var k = gv("_calSelDay", null) || gv("_calRefDate", null);
    if (k) return k;
    var n = new Date(); return n.getFullYear() + "-" + pad(n.getMonth() + 1) + "-" + pad(n.getDate());
  }
  function apptDate(a) { try { if (typeof window._calDateOf === "function") return window._calDateOf(a); } catch (e) {} return (a && (a.appt_date || String(a.start_at || "").slice(0, 10))) || ""; }

  function findNewApptBtn() {
    var v = $("calendarView"); if (!v) return null;
    var bs = v.querySelectorAll("button"), i;
    for (i = 0; i < bs.length; i++) { var oc = bs[i].getAttribute("onclick") || ""; if (/calNewAppt\s*\(/.test(oc)) return bs[i]; }
    for (i = 0; i < bs.length; i++) { var t = (bs[i].textContent || "").trim().toLowerCase(); if (t.indexOf("new appointment") >= 0 && t.length < 28) return bs[i]; }
    return null;
  }
  function findBtnOc(root, re) {
    var bs = root.querySelectorAll("button"); for (var i = 0; i < bs.length; i++) { if (re.test(bs[i].getAttribute("onclick") || "")) return bs[i]; } return null;
  }

  /* ============ LEFT RAIL ============ */
  function buildRail(rail) {
    var slotCTA = rail.querySelector(":scope > .cx-cta-slot");
    if (!slotCTA) { slotCTA = mk("div", ""); slotCTA.className = "cx-cta-slot"; rail.appendChild(slotCTA); }
    var realNew = $("calNewAppt") || findNewApptBtn();
    if (realNew && realNew.parentElement !== slotCTA) {
      realNew.setAttribute("data-cx-newappt", "1");
      if (realNew.getAttribute("data-cx-origlabel") == null) realNew.setAttribute("data-cx-origlabel", realNew.textContent);
      var clean = realNew.textContent.replace(/^[^A-Za-z]+/, "");
      realNew.textContent = "+ " + clean;
      slotCTA.appendChild(realNew);
      impAll(realNew, ["width:100%", "height:48px", "border-radius:13px", "border:none",
        "background:linear-gradient(135deg,#2E6A4B,#204034)", "color:#fff", "font-weight:700",
        "font-size:14.5px", "cursor:pointer", "box-shadow:0 12px 26px -10px rgba(32,64,52,.6)",
        "margin:0", "display:flex", "align-items:center", "justify-content:center", "gap:9px"]);
    }
    var mini = rail.querySelector(":scope > .cx-mini");
    if (!mini) { mini = mk("div", "padding:16px"); mini.className = "cx-card cx-mini"; rail.appendChild(mini); }
    renderMini(mini);
    var glance = rail.querySelector(":scope > .cx-glance");
    if (!glance) { glance = mk("div", "padding:16px 18px"); glance.className = "cx-card cx-glance"; rail.appendChild(glance); }
    renderGlance(glance);
    var prov = rail.querySelector(":scope > .cx-prov");
    if (!prov) {
      prov = mk("div", "padding:16px 18px"); prov.className = "cx-card cx-prov";
      prov.innerHTML = '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#5C6E86;margin-bottom:12px">PROVIDERS</div><div class="cx-prov-list"></div><div class="cx-prov-slot" style="margin-top:6px"></div>';
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
    var have = {};
    try {
      var appts = gv("_calAppts", []) || [];
      for (var i = 0; i < appts.length; i++) { var k = apptDate(appts[i]); if (k && k.slice(0, 7) === (y + "-" + pad(m + 1))) have[k] = 1; }
    } catch (e) {}
    var head =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<span style="font-weight:500;font-size:16px;font-family:\'Newsreader\',Georgia,serif">' + MON[m] + " " + y + '</span>' +
        '<div style="display:flex;gap:4px">' +
          '<button class="cx-mini-prev" style="width:28px;height:28px;border-radius:8px;border:1px solid #e0e8f1;background:#fff;color:#79837C;font-size:10px;cursor:pointer">' + LARR + '</button>' +
          '<button class="cx-mini-next" style="width:28px;height:28px;border-radius:8px;border:1px solid #e0e8f1;background:#fff;color:#79837C;font-size:10px;cursor:pointer">' + RARR + '</button>' +
        '</div></div>';
    var dows = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:5px">';
    for (var d = 0; d < 7; d++) dows += '<div style="text-align:center;font-size:10px;font-weight:700;color:#aab6c6">' + DOW[d] + '</div>';
    dows += '</div>';
    var cells = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">';
    for (var b = 0; b < startDow; b++) cells += '<span></span>';
    for (var day = 1; day <= dim; day++) {
      var key = y + "-" + pad(m + 1) + "-" + pad(day);
      var isT = key === tKey, isS = key === sel, dot = have[key];
      var bg = isS ? "#2E6A4B" : (isT ? "#eef4fc" : "transparent");
      var fg = isS ? "#fff" : (isT ? "#3E6BA6" : "#55605A");
      cells += '<button class="cx-mini-day" data-key="' + key + '" style="position:relative;height:30px;border:none;border-radius:8px;background:' + bg + ';color:' + fg + ';font-size:12px;font-weight:' + (isT || isS ? "700" : "500") + ';cursor:pointer">' + day +
        (dot ? '<span style="position:absolute;left:50%;bottom:3px;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:' + (isS ? "#fff" : "#2E6A4B") + '"></span>' : '') + '</button>';
    }
    cells += '</div>';
    var html = head + dows + cells;
    if (mini.getAttribute("data-cx-h") !== html) { mini.innerHTML = html; mini.setAttribute("data-cx-h", html); }
    var p = mini.querySelector(".cx-mini-prev"), nx = mini.querySelector(".cx-mini-next");
    if (p) p.onclick = function () { try { if (typeof window.calPrev === "function") window.calPrev(); } catch (e) {} schedule(); };
    if (nx) nx.onclick = function () { try { if (typeof window.calNext === "function") window.calNext(); } catch (e) {} schedule(); };
    var btns = mini.querySelectorAll(".cx-mini-day");
    for (var q = 0; q < btns.length; q++) {
      /* Fix #3: unified selectDay() so clicking a day updates the date AND stays in the current view */
      btns[q].onclick = function () { selectDay(this.getAttribute("data-key")); };
    }
  }

  function renderGlance(glance) {
    var key = activeKey();
    var buckets = [
      { label: "Booked", match: ["booked", "scheduled", ""], color: "#3E6BA6" },
      { label: "Arrived", match: ["arrived", "checked_in"], color: "#9a6b00" },
      { label: "Roomed", match: ["roomed"], color: "#2E6A4B" },
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
        for (var bIdx = 1; bIdx < buckets.length; bIdx++) { if (buckets[bIdx].match.indexOf(st) >= 0) { counts[bIdx]++; placed = true; break; } }
        if (!placed) counts[0]++;
      }
    } catch (e) {}
    var nowLbl = "";
    try { nowLbl = new Date(key + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" }); } catch (e) { nowLbl = key; }
    var rows = "";
    for (var r = 0; r < buckets.length; r++) {
      rows += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:11px">' +
        '<span style="width:10px;height:10px;border-radius:3px;background:' + buckets[r].color + '"></span>' +
        '<span style="flex:1;color:#55605A;font-size:13px;font-weight:600">' + buckets[r].label + '</span>' +
        '<span style="font-weight:800;font-size:15px;color:#1A211C">' + counts[r] + '</span></div>';
    }
    var html =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:13px">' +
        '<span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:#5C6E86">DAY AT A GLANCE</span>' +
        '<span style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#1f7d5c;background:#eef7f3;border:1px solid #cfe9dd;padding:3px 9px;border-radius:20px"><span style="width:6px;height:6px;border-radius:50%;background:#27b07a"></span>' + nowLbl + '</span>' +
      '</div>' + rows +
      '<div style="border-top:1px solid #F4F2EC;margin-top:6px;padding-top:12px;display:flex;align-items:center;justify-content:space-between">' +
        '<span style="color:#79837C;font-size:12.5px;font-weight:600">Total booked</span>' +
        '<span style="font-weight:800;font-size:18px;color:#2E6A4B">' + total + '</span></div>';
    if (glance.getAttribute("data-cx-h") !== html) { glance.innerHTML = html; glance.setAttribute("data-cx-h", html); }
  }

  function renderProviders(prov) {
    var list = prov.querySelector(".cx-prov-list");
    var provs = gv("_calProviders", []) || [];
    var palette = ["#2E6A4B", "#3B7C5A", "#9B82D4", "#e8833a", "#d6457f", "#0ea5b7"];
    var html = "";
    if (provs.length) {
      for (var i = 0; i < provs.length; i++) {
        var p = provs[i], nm = String(p.name || ("Provider " + (p.id || (i + 1))));
        var parts = nm.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/);
        var ini = ((parts[0] || "")[0] || "") + ((parts[1] || "")[0] || ""); ini = ini.toUpperCase() || "?";
        var col = palette[i % palette.length];
        html += '<label style="display:flex;align-items:center;gap:10px;margin-bottom:11px">' +
          '<span style="width:22px;height:22px;border-radius:6px;background:' + col + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px">' + ini + '</span>' +
          '<span style="flex:1;color:#55605A;font-size:13px;font-weight:600">' + nm + '</span></label>';
      }
    } else {
      html = '<div style="color:var(--muted);font-size:12.5px;font-weight:500;margin-bottom:8px">All providers</div>';
    }
    if (list && list.getAttribute("data-cx-h") !== html) { list.innerHTML = html; list.setAttribute("data-cx-h", html); }
    var slot = prov.querySelector(".cx-prov-slot");
    var sel = $("calProvFilter");
    if (sel && slot && sel.parentElement !== slot) {
      slot.appendChild(sel);
      impAll(sel, ["width:100%", "height:36px", "border-radius:9px", "border:1px solid #e0e8f1", "background:#fff", "padding:0 11px", "font-size:12.5px", "margin:0"]);
    }
  }

  /* ============ AGENDA HEADER (design-exact, relocates real controls by id/onclick) ============ */
  function buildAgendaHeader(card) {
    var head = card.querySelector(":scope > .cx-agenda-head");
    if (!head) {
      head = mk("div"); head.className = "cx-agenda-head";
      head.style.cssText = "display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px";
      head.innerHTML =
        '<div class="cx-navgrp" style="display:flex;align-items:center;gap:6px"></div>' +
        '<div class="cx-titlewrap" style="line-height:1.1"></div>' +
        '<div style="flex:1"></div>' +
        '<div class="cx-seg" style="display:flex;align-items:center;gap:3px;background:#f1f4f8;border-radius:10px;padding:3px"></div>' +
        '<div class="cx-rightctrls" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>';
      card.insertBefore(head, card.firstChild);
    }
    var navgrp = head.querySelector(".cx-navgrp");
    var titlewrap = head.querySelector(".cx-titlewrap");
    var seg = head.querySelector(".cx-seg");
    var right = head.querySelector(".cx-rightctrls");

    /* nav group: prev / Today / next (capture the original toolbar row first, to hide later) */
    var prev = findBtnOc(card, /calPrev\s*\(/), today = findBtnOc(card, /calToday\s*\(/), next = findBtnOc(card, /calNext\s*\(/);
    if (prev && prev.parentElement !== navgrp) { try { if (prev.parentElement && prev.parentElement !== card) prev.parentElement.setAttribute("data-cx-orig", "toolbar"); } catch (e) {} prev.removeAttribute("style"); prev.className = "cx-navbtn"; navgrp.appendChild(prev); }
    if (today && today.parentElement !== navgrp) { today.removeAttribute("style"); today.className = "cx-todaybtn"; navgrp.appendChild(today); }
    if (next && next.parentElement !== navgrp) { next.removeAttribute("style"); next.className = "cx-navbtn"; navgrp.appendChild(next); }

    /* title (Newsreader) + subtitle from REAL data */
    var lbl = $("calMonthLabel");
    if (lbl && lbl.parentElement !== titlewrap) titlewrap.appendChild(lbl);
    if (lbl) { imp(lbl, "font-family", "'Newsreader',Georgia,serif"); imp(lbl, "font-weight", "500"); imp(lbl, "font-size", "26px"); imp(lbl, "letter-spacing", "-.015em"); imp(lbl, "margin", "0"); imp(lbl, "color", "#1A211C"); }
    var sub = titlewrap.querySelector(".cx-sub");
    if (!sub) { sub = mk("div", "color:#79837C;font-size:13px;font-weight:500;margin-top:2px"); sub.className = "cx-sub"; titlewrap.appendChild(sub); }
    var subTxt = subtitleText(); if (sub.textContent !== subTxt) sub.textContent = subTxt; /* guarded: no 150ms churn */

    /* segmented Day | Week | Month (design order); REAL buttons */
    var mDay = $("calMode_day"), mWeek = $("calMode_week"), mMonth = $("calMode_month");
    [mDay, mWeek, mMonth].forEach(function (btn) { if (btn && btn.parentElement !== seg) { seg.appendChild(btn); } });
    var mode = String(gv("_calMode", "month")).toLowerCase();
    [["day", mDay], ["week", mWeek], ["month", mMonth]].forEach(function (pair) {
      var btn = pair[1]; if (!btn) return;
      btn.removeAttribute("style"); btn.className = "cx-seg-btn" + (pair[0] === mode ? " cx-on" : "");
    });

    /* right cluster: Refresh, Working hours, date jump, Remove duplicates, Check-in */
    var refresh = findBtnOc(card, /loadCalendar\s*\(/);
    var wh = findBtnOc(card, /calWorkingHours\s*\(/);
    var dup = findBtnOc(card, /cleanupDuplicate/i);
    var jump = $("calJump");
    var checkin = $("calCheckinWrap");
    if (refresh && refresh.parentElement !== right) { refresh.removeAttribute("style"); refresh.className = "cx-ghost"; right.appendChild(refresh); }
    if (wh && wh.parentElement !== right) { wh.removeAttribute("style"); wh.className = "cx-ghost"; right.appendChild(wh); }
    if (jump && jump.parentElement !== right) { right.appendChild(jump); impAll(jump, ["height:40px", "border-radius:11px", "border:1px solid #e0e8f1", "background:#fff", "padding:0 10px", "font-size:13px", "color:#3d5168", "font-family:inherit", "margin:0"]); }
    if (dup && dup.parentElement !== right) { dup.removeAttribute("style"); dup.className = "cx-ghost"; right.appendChild(dup); }
    if (checkin && checkin.parentElement !== right) { try { var h2c = checkin.closest && checkin.closest("h2"); if (h2c) h2c.setAttribute("data-cx-orig", "h2"); } catch (e) {} right.appendChild(checkin); var cb = checkin.querySelector("button"); if (cb) { cb.removeAttribute("style"); cb.className = "cx-ghost"; } }

    /* hide the now-emptied original toolbar row + the plain "Calendar" h2 icon row
       (captured above; never hide our own header or its ancestors) */
    try {
      var origs = card.querySelectorAll('[data-cx-orig]');
      for (var i = 0; i < origs.length; i++) {
        var o = origs[i];
        if (o === head || o.contains(head)) continue;
        imp(o, "display", "none");
      }
    } catch (e) {}
  }

  function subtitleText() {
    var y = gv("_calYear", null); if (y == null) y = new Date().getFullYear();
    var mode = String(gv("_calMode", "month")).toLowerCase();
    if (mode === "month") {
      var ym = y + "-" + pad((gv("_calMonth", new Date().getMonth())) + 1);
      var n = 0; try { var a = gv("_calAppts", []) || []; for (var i = 0; i < a.length; i++) { if (apptDate(a[i]).slice(0, 7) === ym) n++; } } catch (e) {}
      return y + " \u00B7 " + n + (n === 1 ? " appointment" : " appointments") + " this month";
    }
    if (mode === "day") {
      var key = activeKey(), c = 0; try { var ap = gv("_calAppts", []) || []; for (var j = 0; j < ap.length; j++) { if (apptDate(ap[j]) === key) c++; } } catch (e) {}
      return y + " \u00B7 " + c + (c === 1 ? " appointment" : " appointments") + " scheduled";
    }
    return y + " \u00B7 whole-practice schedule";
  }

  function styleAgenda(card) {
    if (!card.classList.contains("cx-agenda")) card.classList.add("cx-agenda");
    imp(card, "padding", "20px 24px 24px");
    imp(card, "margin", "0");
    buildAgendaHeader(card);
  }

  /* ============ Fix #3: unified day selection (updates date + keeps the active view) ============ */
  function selectDay(key) {
    if (!key) return;
    try {
      window._calSelDay = key; window._calRefDate = key;
      var p = String(key).split("-"); if (p.length === 3) { window._calYear = +p[0]; window._calMonth = +p[1] - 1; }
      var mode = String(gv("_calMode", "month")).toLowerCase();
      if (mode === "day" && typeof window.calSetMode === "function") { window.calSetMode("day"); }   /* updates Day view to key AND stays in Day */
      else { if (typeof window.renderCalendar === "function") window.renderCalendar(); if (typeof window.calOpenDay === "function") window.calOpenDay(key); }
    } catch (e) {}
    schedule();
  }

  /* ============ Fix #4: keep the active segmented pill in sync with _calMode (no flash) ============ */
  function syncSeg() {
    var m = String(gv("_calMode", "month")).toLowerCase();
    [["day", "calMode_day"], ["week", "calMode_week"], ["month", "calMode_month"]].forEach(function (p) {
      var b = $(p[1]); if (!b) return;
      var want = "cx-seg-btn" + (p[0] === m ? " cx-on" : "");
      if (b.className !== want) b.className = want;
    });
  }

  /* install native-function hooks ONCE (calOpenDay persists _calRefDate; renderCalendar re-syncs seg + de-overlaps) */
  function installHooks() {
    try {
      if (!window.__cxOpenHooked && typeof window.calOpenDay === "function") {
        var oo = window.calOpenDay;
        window.calOpenDay = function (key) {
          if (key) { window._calRefDate = key; var p = String(key).split("-"); if (p.length === 3) { window._calYear = +p[0]; window._calMonth = +p[1] - 1; } }
          return oo.apply(this, arguments);
        };
        window.__cxOpenHooked = true;
      }
      if (!window.__cxRenderHooked && typeof window.renderCalendar === "function") {
        var orig = window.renderCalendar;
        window.renderCalendar = function () {
          var r = orig.apply(this, arguments);
          try { clearOv(); } catch (e) {}
          try { syncSeg(); } catch (e) {}
          try { deoverlapGrid(); } catch (e) {}
          try { schedule(); } catch (e) {}
          return r;
        };
        window.__cxRenderHooked = true;
      }
    } catch (e) {}
  }

  /* ============ Fix #2b: additive geometric de-overlap for Day/Week time-grid blocks ============ */
  function isBlk(el) {
    try {
      var cs = getComputedStyle(el);
      if (cs.position !== "absolute") return false;
      if (parseFloat(cs.borderLeftWidth || "0") < 1.5) return false;
      var r = el.getBoundingClientRect();
      if ((r.height || 0) < 10) return false;
      return true;
    } catch (e) { return false; }
  }
  function clearOv() {
    var grid = $("calGrid"); if (!grid) return;
    var n = grid.querySelectorAll("[data-cx-ov],[data-cx-natl],[data-cx-natw],[data-cx-ovhidden]");
    for (var i = 0; i < n.length; i++) {
      var e = n[i];
      if (e.getAttribute("data-cx-ovhidden")) e.style.removeProperty("display");
      e.removeAttribute("data-cx-ov"); e.removeAttribute("data-cx-natl"); e.removeAttribute("data-cx-natw"); e.removeAttribute("data-cx-ovhidden");
    }
    var chips = grid.querySelectorAll(".cx-ovmore");
    for (i = 0; i < chips.length; i++) { try { chips[i].parentNode.removeChild(chips[i]); } catch (e2) {} }
  }
  /* native horizontal geometry is cached so re-layout is idempotent (no progressive shrink) */
  function natL(el) { if (el.hasAttribute("data-cx-natl")) return +el.getAttribute("data-cx-natl"); var v = el.offsetLeft; el.setAttribute("data-cx-natl", v); return v; }
  function natW(el) { if (el.hasAttribute("data-cx-natw")) return +el.getAttribute("data-cx-natw"); var v = el.offsetWidth; el.setAttribute("data-cx-natw", v); return v; }
  function placeBlock(el, left, w, shrink) {
    if (w < 3) w = 3;
    el.style.setProperty("box-sizing", "border-box");
    el.style.setProperty("overflow", "hidden");
    el.style.setProperty("left", left + "px");
    el.style.setProperty("width", w + "px");
    el.style.setProperty("right", "auto");
    if (shrink) { el.style.setProperty("padding", "1px 3px"); el.style.setProperty("font-size", "9px"); el.style.setProperty("line-height", "1.1"); }
    else { el.style.removeProperty("padding"); el.style.removeProperty("font-size"); el.style.removeProperty("line-height"); }
  }
  function addMoreChip(host, left, w, top, height, n) {
    try {
      var chip = document.createElement("div");
      chip.className = "cx-ovmore";
      chip.textContent = "+" + n + " more";
      chip.style.cssText = "position:absolute;left:" + left + "px;top:" + top + "px;width:" + w + "px;height:" + height + "px;pointer-events:none;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;font-size:10px;font-weight:700;color:#2E6A4B;background:#eef4fc;border:1px dashed #EAF1EE;border-radius:6px;padding:1px 2px;overflow:hidden;z-index:6";
      host.appendChild(chip);
    } catch (e) {}
  }
  function layoutLane(parent, blocks) {
    if (!blocks || !blocks.length) return;
    var host = blocks[0].offsetParent || parent;
    var i, laneLeft = Infinity, laneRight = -Infinity;
    for (i = 0; i < blocks.length; i++) { var ol = natL(blocks[i]), ow = natW(blocks[i]); if (ol < laneLeft) laneLeft = ol; if (ol + ow > laneRight) laneRight = ol + ow; }
    var laneW = laneRight - laneLeft; if (!(laneW > 0)) return;
    var items = [];
    for (i = 0; i < blocks.length; i++) items.push({ el: blocks[i], top: blocks[i].offsetTop, bot: blocks[i].offsetTop + blocks[i].offsetHeight });
    items.sort(function (a, b) { return (a.top - b.top) || (a.bot - b.bot); });
    /* cluster transitively-overlapping items */
    var clusters = [], cur = [], curBot = -Infinity;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (cur.length && it.top < curBot - 0.5) { cur.push(it); if (it.bot > curBot) curBot = it.bot; }
      else { if (cur.length) clusters.push(cur); cur = [it]; curBot = it.bot; }
    }
    if (cur.length) clusters.push(cur);
    var MINW = 58;   /* readable minimum column width; denser than this -> show what fits + a "+N more" chip (full detail in Day view) */
    for (var c = 0; c < clusters.length; c++) {
      var cl = clusters[c], colEnd = [], j, k;
      for (j = 0; j < cl.length; j++) {
        var placed = false;
        for (k = 0; k < colEnd.length; k++) {
          if (cl[j].top >= colEnd[k] - 0.5) { cl[j].col = k; colEnd[k] = cl[j].bot; placed = true; break; }
        }
        if (!placed) { cl[j].col = colEnd.length; colEnd.push(cl[j].bot); }
      }
      var ncols = colEnd.length || 1;
      var maxCols = Math.max(1, Math.floor(laneW / MINW));
      var gap = 2;
      if (ncols <= maxCols) {                       /* everything fits readably: one column per concurrent appt, names shown */
        var colW = laneW / ncols;
        for (j = 0; j < cl.length; j++) placeBlock(cl[j].el, laneLeft + cl[j].col * colW, colW - gap, false);
      } else {                                      /* too dense: show the first columns readably, collapse the rest into "+N more" */
        var slots = Math.max(2, maxCols), showCols = slots - 1, colW2 = laneW / slots;
        var ot = Infinity, ob = -Infinity, nOver = 0;
        for (j = 0; j < cl.length; j++) {
          if (cl[j].col < showCols) { placeBlock(cl[j].el, laneLeft + cl[j].col * colW2, colW2 - gap, (colW2 - gap) < 46); }
          else { nOver++; cl[j].el.setAttribute("data-cx-ovhidden", "1"); cl[j].el.style.setProperty("display", "none", "important"); if (cl[j].top < ot) ot = cl[j].top; if (cl[j].bot > ob) ob = cl[j].bot; }
        }
        if (nOver) addMoreChip(host, laneLeft + showCols * colW2, colW2 - gap, ot, Math.max(15, ob - ot), nOver);
      }
    }
  }
  function deoverlapGrid() {
    var grid = $("calGrid"); if (!grid) return;
    /* dgo-1.0.0: bail before the per-node scan when the grid is not laid out.
       isBlk() calls getComputedStyle AND getBoundingClientRect on EVERY node
       under #calGrid. While #calendarView is not the visible screen every rect
       is 0, so isBlk() rejects all of them and this function already did
       nothing - but it paid two forced layout reads per node to find that out,
       and applyAll() runs 13 times during boot (once, then a 700ms interval
       x12). Measured at b598: 3,722 forced layout reads from this file, 67% of
       the 5,576 in the whole app, which is ~140 nodes x 2 reads x 13 passes.
       Each one costs ~16ms because the PATIENTS directory is the screen being
       laid out while boot runs (1,481 patients, 150 rows), which is where the
       10,929ms of Total Blocking Time comes from.
       One rect on the grid answers the same question. This is behaviour-
       preserving by construction: hidden means every rect was 0 and the scan
       returned empty anyway, and when the calendar IS visible getClientRects()
       is non-empty and everything below runs exactly as before.
       Note visibility:hidden still reports rects, so that case is unchanged. */
    if (!grid.getClientRects().length) return;
    var all = [].slice.call(grid.querySelectorAll("*")).filter(isBlk);
    if (!all.length) return;
    var i, anyFresh = false;
    for (i = 0; i < all.length; i++) { if (!all[i].hasAttribute("data-cx-ov")) { anyFresh = true; break; } }
    if (!anyFresh) return;            /* idempotent: only (re)layout freshly-rendered blocks */
    /* group blocks by parent lane (day = one lane; week = one lane per day column) */
    var lanes = [], parents = [];
    for (i = 0; i < all.length; i++) {
      var par = all[i].parentElement, idx = parents.indexOf(par);
      if (idx < 0) { parents.push(par); lanes.push([all[i]]); } else lanes[idx].push(all[i]);
    }
    for (var L = 0; L < lanes.length; L++) { try { layoutLane(parents[L], lanes[L]); } catch (e) {} }
    for (i = 0; i < all.length; i++) { try { all[i].setAttribute("data-cx-ov", "1"); } catch (e) {} }
  }

  /* ============ orchestration ============ */
  function build() {
    var v = $("calendarView"); if (!v) return;
    injectCSS();
    var card = v.querySelector(":scope > .card") || v.querySelector(":scope > .cx-agenda-slot > .card") || v.querySelector(".card");
    if (!card) return;
    var main = v.querySelector(":scope > .cx-main");
    if (!main) {
      main = mk("div"); main.className = "cx-main";
      var rail0 = mk("div"); rail0.className = "cx-rail";
      var agendaSlot0 = mk("div"); agendaSlot0.className = "cx-agenda-slot"; agendaSlot0.style.cssText = "min-width:0";
      main.appendChild(rail0); main.appendChild(agendaSlot0);
      v.insertBefore(main, v.firstChild);
    }
    var rail = main.querySelector(":scope > .cx-rail");
    var agendaSlot = main.querySelector(":scope > .cx-agenda-slot");
    if (card.parentElement !== agendaSlot) agendaSlot.appendChild(card);
    buildRail(rail);
    styleAgenda(card);
    installHooks();
    try { syncSeg(); } catch (e) {}
    try { deoverlapGrid(); } catch (e) {}
    if (v.getAttribute("data-cx-built") !== VERSION) v.setAttribute("data-cx-built", VERSION);
  }
  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { build(); } catch (e) {}
    try { var root = $("calendarView"); if (_obs && root) _obs.observe(root, { childList: true, subtree: true }); } catch (e) {}
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
    try {
      var v = $("calendarView"), main = v && v.querySelector(":scope > .cx-main");
      if (main) {
        var card = main.querySelector(".card");
        if (card) {
          /* move the design header's real controls back into the card body, then drop the header */
          var head = card.querySelector(":scope > .cx-agenda-head");
          if (head) {
            var movers = head.querySelectorAll("#calMonthLabel,#calMode_day,#calMode_week,#calMode_month,#calJump,#calCheckinWrap,button");
            for (var k = 0; k < movers.length; k++) { try { card.appendChild(movers[k]); } catch (e) {} }
            try { head.parentNode.removeChild(head); } catch (e) {}
          }
          try { card.querySelectorAll('[data-cx-hid],[data-cx-orig]').forEach(function (el) { el.style.removeProperty("display"); el.removeAttribute("data-cx-hid"); el.removeAttribute("data-cx-orig"); }); } catch (e) {}
          var realNew = $("calNewAppt") || document.querySelector('[data-cx-newappt]');
          if (realNew) { var ol = realNew.getAttribute("data-cx-origlabel"); if (ol != null) { realNew.textContent = ol; realNew.removeAttribute("data-cx-origlabel"); } realNew.removeAttribute("data-cx-newappt"); card.appendChild(realNew); }
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

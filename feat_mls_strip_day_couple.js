/* feat_mls_strip_day_couple.js -> window.__mlsStripDayCouple (sdc-1.0.0)
 *
 * Two gaps this closes, both additive:
 *
 * 1) COUPLING. The top header's active patient and the day strip / visit
 *    workspace selection could drift apart (header says Aaron S., workspace
 *    says Stephen B.). Now they are coupled both ways:
 *      - top -> strip: when the active patient changes (Switch patient,
 *        search, agenda) and that patient has exactly one appointment on the
 *        day shown, the workspace re-selects it through the Easy view's own
 *        public API (remote.startVisitFor) — same path a chip click takes.
 *      - strip -> top: if the workspace shows a patient whose exact chart
 *        exists but the header still shows someone else, the header is
 *        aligned via window.selectPatient. Exact single-match only; when the
 *        match is ambiguous or missing, nothing moves (fail-closed).
 *
 * 2) OTHER DAYS. The horizontal patient-chip selector only existed for
 *    today. Non-today days (Sat, Sun, tomorrow, ...) now get the same strip,
 *    built from that day's already-loaded appointments; a chip routes through
 *    __mlsCrossDayContext.openAppointment — the shipped exact, fail-closed
 *    opener — so all bindings stay correct. No Athena pull, no write-back.
 */
;(function () {
  "use strict";
  var NS = "__mlsStripDayCouple", VERSION = "sdc-1.0.0";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  var STRIP_ID = "mlsSdcQuick", STYLE_ID = "mlsSdcStyle";
  var suppressUntil = 0, aligning = false, disposed = false, observer = null, raf = 0, iv = 0;

  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
  function byId(id) { return safe(function () { return document.getElementById(id); }, null); }
  function text(v) { return String(v == null ? "" : v).trim(); }
  function esc(v) { return text(v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function normName(v) { return text(v).toLowerCase().replace(/\s+/g, " "); }
  function shortName(v) {
    var parts = text(v).split(/\s+/);
    return parts.length > 1 ? (parts[0] + " " + parts[parts.length - 1].charAt(0) + ".") : (parts[0] || "—");
  }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function dateOf(a) { return text(a && (a.day_local || a.appt_date || a.date || "")).slice(0, 10); }
  function timeOf(a) { return text(a && (a.time_display || a.start_local || a.time || a.start_at || "")); }
  function t12(a) {
    var raw = timeOf(a), m = raw.match(/(\d{1,2}):(\d{2})/);
    if (!m) return raw;
    if (/am|pm/i.test(raw)) return raw.replace(/\s+/g, " ");
    var h = +m[1], min = m[2], ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + min + " " + ap;
  }
  function xdc() { return safe(function () { return window.__mlsCrossDayContext && window.__mlsCrossDayContext.installed ? window.__mlsCrossDayContext : null; }, null); }
  function activePt() { return safe(function () { return typeof window.activePatient === "function" ? window.activePatient() : null; }, null); }
  function appointments() { return safe(function () { return Array.isArray(window._calAppts) ? window._calAppts : []; }, []); }
  function patients() { return safe(function () { return typeof window.getPatients === "function" ? (window.getPatients() || []) : []; }, []); }

  /* ---- workspace's currently shown patient (the big name on the card) ---- */
  function workspaceName() {
    var el = safe(function () { return document.querySelector("#ez3Wrap .ez3-pt"); }, null);
    if (!el || !el.offsetParent) return "";
    return normName(el.textContent);
  }
  function workspaceVisible() {
    var w = byId("ez3Wrap");
    return !!(w && w.offsetParent);
  }

  /* ---- direction: top header -> strip/workspace ---------------------- */
  function todayAppointmentsFor(p) {
    if (!p) return [];
    var tk = todayKey(), pid = text(p.id).toLowerCase(), nm = normName(p.name);
    return appointments().filter(function (a) {
      if (!a || dateOf(a) !== tk) return false;
      var aid = text(a.patient_external_id || a._mlsTargetPatientId || a.patientId || a.patient_id).toLowerCase();
      if (aid && pid) return aid === pid;
      return !!nm && normName(a.name) === nm;
    });
  }
  function onActivePatientChanged() {
    if (disposed || aligning) return;
    if (Date.now() < suppressUntil) return;                      // change originated in the workspace itself
    var p = activePt();
    if (!p) return;
    if (!workspaceVisible()) return;
    var shown = workspaceName();
    if (!shown || shown === normName(p.name)) return;            // already coupled
    if (safe(function () { return xdc() && xdc().current(); }, null)) return; // cross-day binding owns the workspace
    var matches = todayAppointmentsFor(p);
    if (matches.length !== 1) return;                            // ambiguous or off-schedule: leave workspace alone
    var easy = safe(function () { return window.__mlsEasyV32; }, null);
    var remote = easy && easy.remote;
    if (!remote || typeof remote.startVisitFor !== "function") return;
    aligning = true;
    try { remote.startVisitFor(text(matches[0].id), { record: false }); } catch (e) {}
    setTimeout(function () { aligning = false; }, 400);
  }

  /* ---- direction: strip/workspace -> top header ---------------------- */
  function alignHeaderToWorkspace() {
    if (disposed || aligning) return;
    if (!workspaceVisible()) return;
    if (safe(function () { return xdc() && xdc().current(); }, null)) return;
    var shown = workspaceName();
    if (!shown) return;
    var p = activePt();
    if (p && normName(p.name) === shown) return;
    var exact = patients().filter(function (q) { return normName(q && q.name) === shown; });
    if (exact.length !== 1 || !text(exact[0].id)) return;        // exact single chart only — never guess
    if (typeof window.selectPatient !== "function") return;
    aligning = true; suppressUntil = Date.now() + 900;
    try { window.selectPatient(exact[0].id); } catch (e) {}
    setTimeout(function () { aligning = false; }, 400);
  }
  function onWorkspaceClick(ev) {
    var t = ev && ev.target;
    if (!t || !t.closest) return;
    if (t.closest("#ez3Quick") || t.closest("#ez3Wrap")) {
      suppressUntil = Date.now() + 900;                          // workspace-origin change: don't bounce it back
      setTimeout(alignHeaderToWorkspace, 250);
      setTimeout(alignHeaderToWorkspace, 900);
    }
  }

  /* ---- same chip strip on non-today days ------------------------------ */
  function renderDayStrip() {
    if (disposed) return;
    var list = byId("mlsDsList"), api = xdc();
    var strip = byId(STRIP_ID);
    var listShown = !!(list && list.offsetParent);
    if (!listShown || !api) { if (strip) strip.remove(); return; }
    var day = safe(function () { return api._test.selectedDay(); }, "");
    if (!day || day === todayKey()) { if (strip) strip.remove(); return; }
    var groups = safe(function () { return api._test.appointmentsForDay(day); }, []);
    if (!groups || !groups.length) { if (strip) strip.remove(); return; }
    var h = "";
    groups.forEach(function (g, i) {
      var a = g.candidates[0];
      h += '<button type="button" class="ez3-qchip" data-sdc-i="' + i + '">' +
        '<span class="qt">' + esc(t12(a)) + "</span>" + esc(shortName(a.name)) + "</button>";
    });
    if (!strip) {
      strip = document.createElement("div");
      strip.id = STRIP_ID; strip.className = "ez3-quick";
      list.parentNode.insertBefore(strip, list);
    }
    if (strip._sdcHtml !== h) { strip.innerHTML = h; strip._sdcHtml = h; }
    strip._sdcGroups = groups;
  }
  function onStripClick(ev) {
    var t = ev && ev.target, chip = t && t.closest ? t.closest("#" + STRIP_ID + " [data-sdc-i]") : null;
    if (!chip) return;
    ev.preventDefault(); ev.stopPropagation();
    var strip = byId(STRIP_ID), api = xdc();
    var groups = (strip && strip._sdcGroups) || [];
    var g = groups[+chip.getAttribute("data-sdc-i")];
    if (!g || !api) return;
    if (g.candidates.length === 1) { api.openAppointment(g.candidates[0]); return; }
    // ambiguous rows: hand off to the matching row's exact-chooser button
    var list = byId("mlsDsList");
    var rows = list ? list.querySelectorAll(".ds-row .mls-xdc-open") : [];
    var idx = +chip.getAttribute("data-sdc-i");
    if (rows && rows[idx]) safe(function () { rows[idx].click(); });
  }
  function scheduleRender() {
    if (disposed || raf) return;
    raf = 1;
    var req = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    req(function () { raf = 0; renderDayStrip(); });
  }

  function installStyle() {
    if (byId(STYLE_ID)) return;
    var s = document.createElement("style"); s.id = STYLE_ID;
    s.textContent = "#" + STRIP_ID + "{margin:6px 0 10px;}" +
      "body.mls-xdc-active #" + STRIP_ID + "{display:none!important;}";
    (document.head || document.documentElement).appendChild(s);
  }

  function boot() {
    if (disposed) return;
    installStyle();
    safe(function () { window.addEventListener("mls:active-patient-changed", onActivePatientChanged); });
    safe(function () { document.addEventListener("click", onWorkspaceClick, true); });
    safe(function () { document.addEventListener("click", onStripClick, true); });
    safe(function () {
      observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          if (records[i].addedNodes && records[i].addedNodes.length) { scheduleRender(); break; }
        }
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    });
    iv = setInterval(function () { safe(alignHeaderToWorkspace); safe(renderDayStrip); }, 1500);
    scheduleRender();
  }

  var api = {
    installed: true, version: VERSION,
    refresh: scheduleRender,
    _test: { todayAppointmentsFor: todayAppointmentsFor, shortName: shortName, t12: t12, workspaceName: workspaceName },
    revert: function () {
      disposed = true;
      safe(function () { if (observer) observer.disconnect(); }); observer = null;
      safe(function () { clearInterval(iv); });
      safe(function () { window.removeEventListener("mls:active-patient-changed", onActivePatientChanged); });
      safe(function () { document.removeEventListener("click", onWorkspaceClick, true); });
      safe(function () { document.removeEventListener("click", onStripClick, true); });
      var el = byId(STRIP_ID); if (el) el.remove();
      var st = byId(STYLE_ID); if (st) st.remove();
      try { delete window[NS]; } catch (e) { window[NS] = null; }
    }
  };
  window[NS] = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();

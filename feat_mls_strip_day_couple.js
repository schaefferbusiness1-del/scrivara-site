/* feat_mls_strip_day_couple.js -> window.__mlsStripDayCouple (sdc-2.0.2)
 *
 * The Visit page has one native Easy workspace and one native quick strip for
 * every selected date.  This satellite only keeps that workspace and the
 * app's active-patient header aligned; it never creates a second strip/list.
 *
 * Safety contract:
 *  - __mlsDaySwitch.currentDay()/rowsFor(day) are the date/row authority.
 *  - Today uses Easy.remote.startVisitFor(), the same path as a native chip.
 *  - Another day uses __mlsCrossDayContext.openAppointment(), which owns the
 *    exact appointment/date binding before any Visit action can continue.
 *  - zero or multiple matching rows/charts fail closed.  There is no passive
 *    pull, Athena navigation, extension message, or write-back in this file.
 */
;(function () {
  "use strict";
  var NS = "__mlsStripDayCouple", VERSION = "sdc-2.0.2";
  /* sdc-1.0.0 built a second non-today patient strip and kept it alive with
     a whole-body observer plus interval.  Backend asset refreshes happen in
     the existing document, so a truthy-only guard preserved that old owner.
     Retire it before installing this presentation-free coupling owner. */
  var prior = null;
  try { prior = window[NS] || null; } catch (e0) {}
  if (prior && prior.installed && prior.version === VERSION) return;
  if (prior) {
    try { if (typeof prior.revert === "function") prior.revert(); } catch (e1) {}
    try { delete window[NS]; } catch (e2) { try { window[NS] = null; } catch (e3) {} }
  }
  try {
    ["mlsSdcQuick", "mlsSdcStyle"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
  } catch (e4) {}

  var disposed = false, aligning = false;

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function byId(id) { return safe(function () { return document.getElementById(id); }, null); }
  function text(v) { return String(v == null ? "" : v).trim(); }
  function normName(v) { return text(v).toLowerCase().replace(/\s+/g, " "); }
  function dobKey(v) {
    var s = text(v), m;
    if ((m = s.match(/^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/))) return m[1] + ("0" + m[2]).slice(-2) + ("0" + m[3]).slice(-2);
    if ((m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/))) return m[3] + ("0" + m[1]).slice(-2) + ("0" + m[2]).slice(-2);
    return "";
  }
  function dateOf(a) { return text(a && (a.appt_date || a.day_local || a.date || "")).slice(0, 10); }
  function rowId(a) { return text(a && a.id); }
  function todayKey() {
    var accountDay = safe(function () { return typeof window._acctTodayKey === "function" ? window._acctTodayKey() : ""; }, "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(text(accountDay))) return text(accountDay);
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  function daySwitch() {
    return safe(function () {
      var ds = window.__mlsDaySwitch;
      return ds && ds.installed !== false ? ds : null;
    }, null);
  }
  function currentDay() {
    var ds = daySwitch();
    var day = safe(function () { return ds && typeof ds.currentDay === "function" ? ds.currentDay() : ""; }, "");
    day = text(day).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
  }
  function selectedRows() {
    var ds = daySwitch(), day = currentDay(), rows;
    if (!ds || !day || typeof ds.rowsFor !== "function") return [];
    rows = safe(function () { return ds.rowsFor(day); }, []);
    if (!Array.isArray(rows)) return [];
    return rows.filter(function (row) {
      return !!row && !!rowId(row) && dateOf(row) === day;
    });
  }

  function refsOf(obj, storedPatient) {
    var keys = storedPatient
      ? ["id", "patient_external_id", "athena_patient_id", "_mlsTargetPatientId", "patientId", "patient_id"]
      : ["patient_external_id", "athena_patient_id", "_mlsTargetPatientId", "patientId", "patient_id"];
    var out = [], seen = {}, i, value;
    obj = obj || {};
    for (i = 0; i < keys.length; i++) {
      value = text(obj[keys[i]]).toLowerCase();
      if (value && !seen[value]) { seen[value] = true; out.push(value); }
    }
    return out;
  }
  function hasSharedRef(a, p) {
    var ar = refsOf(a, false), pr = refsOf(p, true), seen = {}, i;
    for (i = 0; i < pr.length; i++) seen[pr[i]] = true;
    for (i = 0; i < ar.length; i++) if (seen[ar[i]]) return true;
    return false;
  }
  function identityCompatible(a, p) {
    var an = normName(a && a.name), pn = normName(p && p.name);
    var ad = dobKey(a && a.dob), pd = dobKey(p && p.dob);
    if (an && pn && an !== pn) return false;
    if (ad && pd && ad !== pd) return false;
    return true;
  }
  function rowMatchesPatient(a, p) {
    if (!a || !p || !identityCompatible(a, p)) return false;
    if (hasSharedRef(a, p)) return true;
    /* Schedule rows can carry Athena's patient id while the stored chart has
       only MLS's local id.  The sole safe fallback is complete name + DOB. */
    var an = normName(a.name), pn = normName(p.name), ad = dobKey(a.dob), pd = dobKey(p.dob);
    return !!an && !!ad && an === pn && ad === pd;
  }
  function patients() {
    return safe(function () { return typeof window.getPatients === "function" ? (window.getPatients() || []) : []; }, []);
  }
  function activePatient() {
    return safe(function () { return typeof window.activePatient === "function" ? window.activePatient() : null; }, null);
  }
  function resolvePatientForRow(row) {
    var matches = patients().filter(function (p) { return rowMatchesPatient(row, p); });
    return matches.length === 1 ? matches[0] : null;
  }
  function easyRemote() {
    return safe(function () {
      var easy = window.__mlsEasyV32, remote = easy && easy.remote;
      return remote || null;
    }, null);
  }
  function crossDay() {
    return safe(function () {
      var xdc = window.__mlsCrossDayContext;
      return xdc && xdc.installed !== false ? xdc : null;
    }, null);
  }
  function workspaceVisible() {
    /* showView owns this inline display flag. Read it before offsetParent so a
       patient switch outside Visit does not force a full style/layout flush. */
    var view = byId("visitView");
    if (view && view.style.display === "none") return false;
    var wrap = byId("ez3Wrap");
    return !!(wrap && wrap.offsetParent);
  }
  function activeWorkspaceRow() {
    var day = currentDay(), remote = easyRemote();
    var snap = safe(function () { return remote && typeof remote.snapshot === "function" ? remote.snapshot() : null; }, null);
    if (!snap || text(snap.day).slice(0, 10) !== day || !snap.active || !rowId(snap.active)) return null;
    var matches = selectedRows().filter(function (row) { return rowId(row) === rowId(snap.active); });
    return matches.length === 1 ? matches[0] : null;
  }

  function releaseAlignment() { setTimeout(function () { aligning = false; }, 350); }

  /* Header -> native workspace.  Only an explicit active-patient change can
     enter this path; date browsing and background refreshes never select. */
  function coupleHeaderToWorkspace() {
    if (disposed || aligning || !workspaceVisible()) return false;
    var day = currentDay(), p = activePatient(), remote = easyRemote(), xdc = crossDay();
    if (!day || !p || !remote || typeof remote.startVisitFor !== "function") return false;

    var shown = activeWorkspaceRow();
    if (shown && rowMatchesPatient(shown, p)) return true;
    var bound = safe(function () { return xdc && typeof xdc.current === "function" ? xdc.current() : null; }, null);
    if (bound && text(bound.date) === day && text(bound.patientId) === text(p.id)) return true;

    var matches = selectedRows().filter(function (row) { return rowMatchesPatient(row, p); });
    if (matches.length !== 1) return false; /* missing/duplicate appointment: never guess */

    aligning = true;
    try {
      if (day === todayKey()) return remote.startVisitFor(rowId(matches[0]), { record: false }) === true;
      if (!xdc || typeof xdc.openAppointment !== "function") return false;
      return xdc.openAppointment(matches[0]) === true;
    } catch (e) { return false; }
    finally { releaseAlignment(); }
  }

  /* Native workspace -> header.  Snapshot id + selected-day row + one exact
     chart are all required before selectPatient is allowed to run. */
  function alignHeaderToWorkspace() {
    if (disposed || aligning || !workspaceVisible()) return false;
    var row = activeWorkspaceRow();
    if (!row) return false;
    var p = resolvePatientForRow(row), active = activePatient();
    if (!p) return false;
    if (active && text(active.id) === text(p.id) && rowMatchesPatient(row, active)) return true;
    if (typeof window.selectPatient !== "function") return false;
    aligning = true;
    try { window.selectPatient(p.id); return true; } catch (e) { return false; }
    finally { releaseAlignment(); }
  }

  function scheduleHeaderAlignment() {
    if (disposed) return;
    setTimeout(function () { if (!disposed) alignHeaderToWorkspace(); }, 0);
    setTimeout(function () { if (!disposed) alignHeaderToWorkspace(); }, 300);
  }
  function onWorkspaceClick(ev) {
    var t = ev && ev.target, nativeControl = safe(function () {
      return t && t.closest ? t.closest("#ez3Quick [data-q], #ez3Wrap [data-hd], #ez3Wrap [data-act]") : null;
    }, null);
    if (nativeControl) scheduleHeaderAlignment();
  }
  function onAppointmentContext(ev) {
    if (ev && ev.detail && ev.detail.active === true) scheduleHeaderAlignment();
  }
  function removeLegacyUi() {
    var oldStrip = byId("mlsSdcQuick"), oldStyle = byId("mlsSdcStyle");
    safe(function () { if (oldStrip && oldStrip.parentNode) oldStrip.parentNode.removeChild(oldStrip); });
    safe(function () { if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle); });
  }

  function boot() {
    if (disposed) return;
    removeLegacyUi();
    safe(function () { window.addEventListener("mls:active-patient-changed", coupleHeaderToWorkspace); });
    safe(function () { window.addEventListener("mls:appointment-context-changed", onAppointmentContext); });
    safe(function () { document.addEventListener("click", onWorkspaceClick, true); });
  }

  var api = {
    installed: true,
    version: VERSION,
    refresh: scheduleHeaderAlignment,
    _test: {
      currentDay: currentDay,
      selectedRows: selectedRows,
      rowMatchesPatient: rowMatchesPatient,
      resolvePatientForRow: resolvePatientForRow,
      activeWorkspaceRow: activeWorkspaceRow,
      coupleHeaderToWorkspace: coupleHeaderToWorkspace,
      alignHeaderToWorkspace: alignHeaderToWorkspace
    },
    revert: function () {
      disposed = true;
      safe(function () { window.removeEventListener("mls:active-patient-changed", coupleHeaderToWorkspace); });
      safe(function () { window.removeEventListener("mls:appointment-context-changed", onAppointmentContext); });
      safe(function () { document.removeEventListener("click", onWorkspaceClick, true); });
      removeLegacyUi();
      try { delete window[NS]; } catch (e) { window[NS] = null; }
    }
  };

  window[NS] = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();

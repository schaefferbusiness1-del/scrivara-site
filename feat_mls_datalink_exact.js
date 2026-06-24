/* feat_mls_datalink_exact.js  ->  window.__mlsLink  (cross-surface data link)
 *
 *  STAGING-FIRST. Loaded by mls-connect.staging.js AFTER the patient picker, the
 *  Patients page module and the Calendar module, and (after verification) by the prod
 *  loader mls-connect.js via the data: staging marker. Runtime-gated to the staging page.
 *
 *  PURPOSE
 *  -------
 *  The picker (Today's patients cards), the Patients tab list, and the Calendar all
 *  already read the app's OWN data -- window.getPatients() for the patient roster and
 *  window._calAppts / window._calProviders for the schedule. They are, however, three
 *  independent renderers: a schedule pull repopulates the stores but does not always
 *  refresh every surface at once, and selecting a patient in one place does not visibly
 *  reflect in the others. This module is the single, additive glue that keeps them
 *  CONNECTED so a pull populates all three and a selection is mirrored everywhere -- all
 *  from the one shared source of truth (getPatients + _calAppts). It NEVER fabricates a
 *  patient or an appointment; if a store is empty the surfaces keep their honest empty
 *  state. No PHI is logged or sent anywhere.
 *
 *  HOW
 *  ---
 *  1) It wraps the app's REAL data-load entry points (loadCalendar, loadPatientsFromServer,
 *     pullScheduleViaAssist, importPatients, _importPulledSchedule) so that AFTER a pull the
 *     picker, Patients list and Calendar are all re-rendered from the freshly-loaded stores,
 *     and the Calendar focuses the same "pulled day" the picker is showing.
 *  2) It wraps the app's TWO real selection funnels (openPatient -- used by the picker; and
 *     selectPatient -- used by the Patients list and calendar appt clicks) so that picking a
 *     patient anywhere re-highlights the picker cards, refreshes the patient context bar, and
 *     (when the Calendar is on screen) focuses that patient's appointment day.
 *  3) A light 2s signature poll (patient count + appt count) is a safety net: if any code path
 *     we did not wrap changes the data, all three surfaces still re-sync exactly once.
 *
 *  Every refresh calls the app's OWN renderers (renderPatients / renderProfile / renderCalendar
 *  / renderPatientBar) and the *_exact build() hooks; nothing is rebuilt or deleted here. It is
 *  idempotent (re-syncs fire only on real data/selection changes -> no flicker at steady state)
 *  and fully reversible (window.__mlsLink.revert() restores every wrapped function).
 *
 *  ASCII-only.  Additive.  View-agnostic.
 */
;(function () {
  "use strict";
  var VERSION = "link-1.0.0";
  try { if (window.__mlsLink && window.__mlsLink.installed) return; } catch (e) { return; }

  function gateOn() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window.__mlsLink = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  /* ---------- tiny helpers ---------- */
  function isFn(n) { try { return typeof window[n] === "function"; } catch (e) { return false; } }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function viewVisible(id) {
    var v = $(id); if (!v) return false;
    try { return getComputedStyle(v).display !== "none" && v.offsetParent !== null; } catch (e) { return false; }
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function localDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  /* ---------- shared data accessors (read-only) ---------- */
  function getPatients() { try { return (window.getPatients && window.getPatients()) || []; } catch (e) { return []; } }
  function appts() { try { return Array.isArray(window._calAppts) ? window._calAppts : []; } catch (e) { return []; } }
  function activeId() { try { return (window.getActivePtId && window.getActivePtId()) || null; } catch (e) { return null; } }
  function apptDate(a) {
    try { if (typeof window._calDateOf === "function") return window._calDateOf(a); } catch (e) {}
    return (a && (a.appt_date || String(a.start_at || "").slice(0, 10))) || "";
  }

  /* ---------- the one shared "pulled set" (the same set the picker shows) ---------- */
  /* Reuses the picker's own scopeList so picker and link agree exactly. Falls back to a
     local computation (most-recent scheduled day) when the picker is not present. Never
     invents data: returns an empty list when the stores are empty. */
  function pulledSet(scope) {
    scope = scope || "today";
    try {
      if (window.__mlsPick && typeof window.__mlsPick.scopeList === "function") {
        return window.__mlsPick.scopeList(scope);
      }
    } catch (e) {}
    /* minimal honest fallback */
    var a = appts(), out = { list: [], dateLabel: "", fallback: false, scope: scope };
    if (!a.length) return out;
    var day = pulledDate(); if (!day) return out;
    var seen = {};
    for (var i = 0; i < a.length; i++) {
      if (apptDate(a[i]) !== day) continue;
      var key = (a[i].name || "") + "|" + (a[i].dob || "");
      if (seen[key]) continue; seen[key] = 1;
      out.list.push({ name: a[i].name || "", dob: a[i].dob || "", time: a[i].start_at || "" });
    }
    out.dateLabel = day; out.fallback = (day !== localDate(new Date()));
    return out;
  }

  /* the date the "pulled set" resolves to: today if it has appts, else the most recent
     scheduled day. null when there are no appointments at all (honest empty). */
  function pulledDate() {
    var a = appts(); if (!a.length) return null;
    var today = localDate(new Date()), dates = {};
    for (var i = 0; i < a.length; i++) { var k = apptDate(a[i]); if (k) dates[k] = 1; }
    if (dates[today]) return today;
    var ks = Object.keys(dates).sort();
    return ks.length ? ks[ks.length - 1] : null;
  }

  /* the active patient's most relevant appointment day (most recent), matched name+dob.
     null when the active patient has no appointment -> the Calendar is left untouched. */
  function activePatientApptDate() {
    var id = activeId(); if (!id) return null;
    var ps = getPatients(), p = null;
    for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === id) { p = ps[i]; break; }
    if (!p) return null;
    var nm = String(p.name || "").toLowerCase(), dob = p.dob || "";
    var a = appts(), best = null;
    for (var j = 0; j < a.length; j++) {
      var an = String(a[j].name || "").toLowerCase();
      if (!an || an !== nm) continue;
      if (a[j].dob && dob && a[j].dob !== dob) continue;     /* require dob to agree when both present */
      var d = apptDate(a[j]); if (d && (!best || d > best)) best = d;
    }
    return best;
  }

  /* ---------- focus the Calendar on a given day (real app globals + handler) ---------- */
  function focusCalDay(key) {
    if (!key) return;
    try {
      if (String(window._calSelDay || "") === String(key)) return;   /* already there: no-op (no flicker) */
      window._calSelDay = key; window._calRefDate = key;
      var p = String(key).split("-");
      if (p.length === 3) { window._calYear = +p[0]; window._calMonth = +p[1] - 1; }
      if (isFn("calOpenDay")) window.calOpenDay(key);
      else if (isFn("renderCalendar")) window.renderCalendar();
    } catch (e) {}
  }

  function pokePicker() { try { if (window.__mlsPick && typeof window.__mlsPick.reapply === "function") window.__mlsPick.reapply(); } catch (e) {} }
  function buildCx() { try { if (window.__mlsCx && typeof window.__mlsCx.build === "function") window.__mlsCx.build(); } catch (e) {} }
  function buildPx() { try { if (window.__mlsPx && typeof window.__mlsPx.build === "function") window.__mlsPx.build(); } catch (e) {} }

  /* ====================================================================
     syncAll: a pull / data change -> repopulate ALL THREE surfaces.
     Only ever called on a real data change (wrapped pull fns + the change
     poll), so the full re-renders here are not a steady-state cost.
     ==================================================================== */
  var _busy = false;
  function syncAll(reason, jumpCalToPull) {
    if (_busy) return; _busy = true;
    try {
      /* Patients roster + active profile + context bar (the app's own renderers) */
      if (isFn("renderPatients")) { try { window.renderPatients(); } catch (e) {} }
      if (isFn("renderProfile")) { try { window.renderProfile(); } catch (e) {} }
      if (isFn("renderPatientBar")) { try { window.renderPatientBar(); } catch (e) {} }
      /* Calendar: optionally focus the same pulled day, then re-render */
      if (jumpCalToPull) { var pd = pulledDate(); if (pd) focusCalDay(pd); }
      if (isFn("renderCalendar")) { try { window.renderCalendar(); } catch (e) {} }
      /* design-exact rebuild hooks re-apply their chrome over the fresh DOM */
      buildCx(); buildPx();
      /* Picker re-renders its selectable cards from the fresh stores */
      pokePicker();
    } catch (e) {}
    _busy = false;
  }

  /* ====================================================================
     reflectSelection: a selection anywhere -> mirror it everywhere.
     openPatient / selectPatient already refresh the Patients list + profile;
     here we add the missing mirrors (picker highlight, context bar, Calendar
     focus when it is on screen) WITHOUT re-rendering the heavy list again.
     ==================================================================== */
  function reflectSelection() {
    try {
      pokePicker();                                            /* picker cards highlight the active id (idempotent) */
      if (isFn("renderPatientBar")) { try { window.renderPatientBar(); } catch (e) {} }
      if (viewVisible("calendarView")) {                       /* only touch the Calendar when the user is looking at it */
        var d = activePatientApptDate();
        if (d) focusCalDay(d);
        buildCx();
      }
    } catch (e) {}
  }

  /* ---------- debounced schedulers (coalesce bursts; no storms) ---------- */
  var _selT = null;
  function scheduleReflect() { if (_selT) return; _selT = setTimeout(function () { _selT = null; reflectSelection(); }, 80); }
  var _pullT = null;
  function schedulePull() { if (_pullT) clearTimeout(_pullT); _pullT = setTimeout(function () { _pullT = null; syncAll("pull", true); }, 140); }

  /* ---------- function wrapping (reversible) ---------- */
  var ORIG = {};
  function wrap(name, after, async) {
    if (!isFn(name) || ORIG[name]) return false;
    var orig = window[name];
    ORIG[name] = orig;
    window[name] = function () {
      var r;
      try { r = orig.apply(this, arguments); } catch (e) { r = undefined; }
      try {
        if (async) {
          setTimeout(function () { try { after(); } catch (e) {} }, 900);
          setTimeout(function () { try { after(); } catch (e) {} }, 2400);   /* second pass for slow async pulls */
        } else {
          after();
        }
      } catch (e) {}
      return r;
    };
    try { window[name].__mlsLinkWrapped = true; } catch (e) {}
    return true;
  }

  var SELECT_FNS = ["openPatient", "selectPatient"];
  var PULL_FNS = ["pullScheduleViaAssist", "loadCalendar", "loadPatientsFromServer", "importPatients", "_importPulledSchedule"];

  function installHooks() {
    var i;
    for (i = 0; i < SELECT_FNS.length; i++) wrap(SELECT_FNS[i], scheduleReflect, false);
    for (i = 0; i < PULL_FNS.length; i++) wrap(PULL_FNS[i], schedulePull, true);
  }

  /* ---------- safety-net change poll ---------- */
  var _lastSig = null, _pollT = null;
  function dataSig() { return getPatients().length + "|" + appts().length; }
  function startPoll() {
    _lastSig = dataSig();
    try {
      _pollT = setInterval(function () {
        var s = dataSig();
        if (s !== _lastSig) { _lastSig = s; syncAll("poll", false); }
      }, 2000);
    } catch (e) {}
  }

  /* ---------- boot ---------- */
  var _bootN = 0, _bootT = null;
  function boot() {
    installHooks();
    /* a few retries in case any data fn is (re)defined slightly after we load */
    try {
      _bootT = setInterval(function () { installHooks(); if (++_bootN > 10) { clearInterval(_bootT); _bootT = null; } }, 700);
    } catch (e) {}
    startPoll();
  }

  function revert() {
    try { if (_pollT) clearInterval(_pollT); } catch (e) {}
    try { if (_bootT) clearInterval(_bootT); } catch (e) {}
    for (var k in ORIG) {
      if (Object.prototype.hasOwnProperty.call(ORIG, k)) { try { window[k] = ORIG[k]; } catch (e) {} }
    }
    ORIG = {};
    try { window.__mlsLink.installed = false; } catch (e) {}
  }

  window.__mlsLink = {
    installed: true, version: VERSION,
    pulledSet: pulledSet, pulledDate: pulledDate,
    syncAll: syncAll, reflectSelection: reflectSelection,
    activePatientApptDate: activePatientApptDate,
    reapply: boot, revert: revert
  };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();

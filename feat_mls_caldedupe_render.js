/* feat_mls_caldedupe_render.js  ->  window.__mlsCalDedupe   [item68 / PROD + STAGING]
 *
 *  CALENDAR / AGENDA DUPLICATE-APPOINTMENT FIX (display/read-layer, idempotent).
 *
 *  ROOT CAUSE
 *  ----------
 *  The native calendar renderers in ScribeFlow.html -- renderCalendar() (month/
 *  week/day grid), calOpenDay() (the day "agenda" panel in the screenshot) and
 *  renderCalCheckin() -- paint rows STRAIGHT from the shared global array
 *  window._calAppts with NO de-duplication. That array can legitimately hold the
 *  SAME appointment 2-3x: /api/appointments can return repeats and repeated
 *  per-doctor schedule pulls append the same slot, so e.g. "CONNOLLY, DEBORAH
 *  7:30 AM booked" or "Johnson, PA-C 3:00 PM booked" each render two or three
 *  times. A dedupe was written earlier (feat_mls_cal_athena_sync.js, key
 *  name|date|time|provider) but it is NOT referenced by either loader
 *  (mls-connect.js / mls-connect.staging.js) -- it is orphaned and never runs on
 *  prod, which is why the fix "regressed". scopeList() in the patient picker
 *  dedupes only by PATIENT, so it does not cover the calendar/agenda surface.
 *
 *  FIX
 *  ---
 *  One small, idempotent read-layer dedupe. Immediately before any calendar
 *  render, collapse window._calAppts to ONE entry per stable display identity:
 *      key = patientLabel | date | startTime | provider
 *  (built from the app's own _calLabelOf / _calDateOf so two rows that DISPLAY
 *  identically collapse to one), keeping the most-complete record so the id and
 *  status used by click handlers survive. Appointment id is intentionally NOT the
 *  primary key: repeated imports create distinct ids for the same real slot, so
 *  an id key would not collapse the visible dupes.
 *
 *  Idempotent: running it again on an already-clean array changes nothing (it
 *  only reassigns when a dup was actually found), so re-renders and future pulls
 *  cannot reintroduce dupes -- every render passes through the dedupe.
 *
 *  SAFETY
 *  ------
 *  Display/data-dedup ONLY. It filters the in-memory display array; it NEVER
 *  deletes or mutates a stored appointment or patient and NEVER calls the
 *  backend. No body-subtree MutationObserver (a stacked-observer freeze was
 *  reported) -- this is plain wrapping of the existing render entry points plus
 *  one light short-lived timer to catch late-defined globals. No PHI is logged.
 *
 *  Additive, reversible: window.__mlsCalDedupe.revert()
 *  ASCII-only. Idempotent install guard.
 */
(function () {
  "use strict";
  try { if (window.__mlsCalDedupe && window.__mlsCalDedupe.__live) return; } catch (e) { return; }

  /* Provider check-in reads _calProviders only. Wrapping it used to scan and
     dedupe every appointment for a render that never touches appointments. */
  var WRAPPED = ["renderCalendar", "calOpenDay"];
  var orig = {};

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " "); }

  function label(a) {
    try { if (typeof window._calLabelOf === "function") { var l = window._calLabelOf(a); if (l) return l; } } catch (e) {}
    return (a && (a.name || a.patient_name || "")) || "";
  }
  function dateOf(a) {
    try { if (typeof window._calDateOf === "function") { var d = window._calDateOf(a); if (d) return d; } } catch (e) {}
    return (a && (a.appt_date || String(a.start_at || "").slice(0, 10))) || "";
  }
  function timeOf(a) { return String((a && a.start_at) || "").slice(0, 16); }
  function prov(a) {
    if (!a) return "";
    if (a.doctor_user_id != null && a.doctor_user_id !== "") return "d" + a.doctor_user_id;
    return norm(a.provider || a.provider_name || a.doctor_name || "");
  }
  function key(a) { return norm(label(a)) + "|" + dateOf(a) + "|" + timeOf(a) + "|" + prov(a); }

  /* prefer the most-complete duplicate so id / provider / reason / status survive */
  function score(a) {
    return (prov(a) ? 2 : 0) + (a && a.reason ? 1 : 0) + (a && a.start_at ? 1 : 0) +
           (a && a.id != null ? 1 : 0) + (a && a.status ? 1 : 0);
  }

  function dedupe() {
    try {
      var arr = window._calAppts;
      if (!Array.isArray(arr) || arr.length < 2) return;
      var seen = {}, out = [], dup = false;
      for (var i = 0; i < arr.length; i++) {
        var a = arr[i];
        if (a == null) { dup = true; continue; }
        var k = key(a);
        if (!(k in seen)) { seen[k] = out.length; out.push(a); }
        else { dup = true; if (score(a) > score(out[seen[k]])) out[seen[k]] = a; }
      }
      if (dup) {
        if (!window.__mlsCalDedupeRaw) window.__mlsCalDedupeRaw = arr.slice(); /* originals for revert; never mutated */
        window._calAppts = out;
      }
    } catch (e) {}
  }

  function wrap(name) {
    var fn = window[name];
    if (typeof fn !== "function" || fn.__mlsDeduped) return false;
    orig[name] = fn;
    var w = function () { dedupe(); return orig[name].apply(this, arguments); };
    w.__mlsDeduped = true;
    try { w.__mlsOrig = fn; } catch (e) {}
    window[name] = w;
    return true;
  }
  function install() { var n = 0; for (var i = 0; i < WRAPPED.length; i++) if (wrap(WRAPPED[i])) n++; return n; }

  install();

  /* catch late-defined globals -- single light timer, NO MutationObserver */
  var tries = 0, t = setInterval(function () {
    tries++;
    install();
    var all = true;
    for (var i = 0; i < WRAPPED.length; i++) { if (!(window[WRAPPED[i]] && window[WRAPPED[i]].__mlsDeduped)) { all = false; break; } }
    if (all || tries > 40) { try { clearInterval(t); } catch (e) {} }
  }, 250);

  /* Future Calendar renders already pass through the wrappers. Do not paint
     the hidden Calendar during Visit/login merely because this module loaded. */
  try {
    if (window.__mlsCurrentView === "calendar") {
      dedupe();
      if (typeof window.renderCalendar === "function") window.renderCalendar();
    }
  } catch (e) {}

  window.__mlsCalDedupe = {
    __live: true,
    version: "caldedupe-1.1.0",
    item: 68,
    dedupeNow: function () { dedupe(); try { if (typeof window.renderCalendar === "function") window.renderCalendar(); } catch (e) {} },
    revert: function () {
      try { clearInterval(t); } catch (e) {}
      for (var i = 0; i < WRAPPED.length; i++) { var nm = WRAPPED[i]; if (orig[nm]) { try { window[nm] = orig[nm]; } catch (e) {} } }
      try { if (window.__mlsCalDedupeRaw) { window._calAppts = window.__mlsCalDedupeRaw; window.__mlsCalDedupeRaw = null; } } catch (e) {}
      try { if (window.__mlsCurrentView === "calendar" && typeof window.renderCalendar === "function") window.renderCalendar(); } catch (e) {}
      this.__live = false;
    }
  };
})();

/* feat_mls_cross_day_context.js -> window.__mlsCrossDayContext (xdc-2.0.3)
 *
 * Every selected date now uses the native MLS Easy Visit workspace. This
 * companion adds no alternate appointment list, banner, or "full workspace"
 * control. It only guards native Easy appointment clicks on a non-today day.
 *
 * The guard runs on window in capture phase, before Easy's document capture
 * listener. It resolves one exact appointment from the DaySwitch-selected
 * day, activates that row through Easy's public API, installs an immutable
 * appointment/date/provider binding, and only then performs the requested
 * whitelisted action. Ambiguous or stale rows fail closed. Browsing dates is
 * passive: it clears an old local binding but never pulls, navigates Athena,
 * or writes anything.
 */
;(function () {
  "use strict";
  var NS = "__mlsCrossDayContext", VERSION = "xdc-2.0.3";
  /* A backend asset refresh runs inside the existing document.  b419's
     xdc-1.0.0 owned a whole-body MutationObserver and continually rewrote its
     obsolete "Open full workspace" buttons.  A truthy-only guard left that
     observer alive forever.  Keep one identical current owner, but actively
     retire every older owner and its presentation residue before installing
     this observer-free native-workspace guard. */
  var prior = null;
  try { prior = window[NS] || null; } catch (e0) {}
  if (prior && prior.installed && prior.version === VERSION) return;
  if (prior) {
    try { if (typeof prior.revert === "function") prior.revert(); } catch (e1) {}
    try { delete window[NS]; } catch (e2) { try { window[NS] = null; } catch (e3) {} }
  }
  try {
    ["mlsXdcBanner", "mlsXdcModal", "mlsXdcStyle"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    var buttons = document.querySelectorAll ? document.querySelectorAll(".mls-xdc-open") : [];
    for (var bi = 0; bi < buttons.length; bi++) {
      if (buttons[bi] && buttons[bi].parentNode) buttons[bi].parentNode.removeChild(buttons[bi]);
    }
    if (document.body && document.body.classList) document.body.classList.remove("mls-xdc-active");
    var easyBody = document.getElementById("mlsEz3Body");
    if (easyBody && easyBody.classList) easyBody.classList.remove("mls-xdc-active");
  } catch (e4) {}

  var STYLE_ID = "mlsXdcStyle", MODAL_ID = "mlsXdcModal";
  var current = null, activating = false, disposed = false;

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function byId(id) { return safe(function () { return document.getElementById(id); }, null); }
  function text(v) { return String(v == null ? "" : v).trim(); }
  function raw(v) { return String(v == null ? "" : v); }
  function esc(v) { return text(v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function validDay(v) { v = text(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""; }
  function pad2(v) { v = String(v); return v.length < 2 ? "0" + v : v; }
  function localDay(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayDay() {
    var accountDay = validDay(safe(function () { return typeof window._acctTodayKey === "function" ? window._acctTodayKey() : ""; }, ""));
    return accountDay || localDay(new Date());
  }
  function daySwitch() { return safe(function () { return window.__mlsDaySwitch; }, null); }
  function selectedDay() {
    var ds = daySwitch();
    if (!ds || typeof ds.currentDay !== "function") return "";
    return validDay(safe(function () { return ds.currentDay(); }, ""));
  }
  /* Match the native Easy/DaySwitch receipt-first date authority. */
  function dateOf(a) { return validDay(a && (a.appt_date || a.day_local || a.date || "")); }
  function sourceId(a) { return text(a && a.id); }
  function appointmentId(a) { return text(a && (a.appointmentId || a.appointment_id || a.apptId || a.appt_id || a.athena_appointment_id || "")); }
  function providerOf(a) {
    var p = text(a && (a.provider || a.providerName || a.provider_name || ""));
    if (!p) p = text(safe(function () { return a && a.doctor_user_id && typeof window._docName === "function" ? window._docName(a.doctor_user_id) : ""; }, ""));
    return p;
  }
  /* Match Easy's own rowKey time component exactly. A native data-q/data-hd
     key is the authority here, so even harmless normalization would make a
     real visible row look stale. */
  function timeOf(a) {
    var value = a && a.start_local, m, h, mins, ap, dt;
    if (value) return raw(value);
    if (a && a.time_display) return raw(a.time_display);
    value = a && a.time;
    if (value && (m = raw(value).match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i))) {
      h = +m[1]; mins = m[2]; ap = m[3];
      if (!ap) { ap = h >= 12 ? "PM" : "AM"; h = h % 12; if (h === 0) h = 12; }
      return h + ":" + mins + " " + ap.toUpperCase();
    }
    try {
      if (!a || a.start_at == null || !/T\d{2}:/.test(raw(a.start_at))) return "";
      dt = new Date(a.start_at); if (isNaN(dt.getTime())) return "";
      h = dt.getHours(); mins = pad2(dt.getMinutes()); ap = h >= 12 ? "PM" : "AM"; h = h % 12; if (h === 0) h = 12;
      return h + ":" + mins + " " + ap;
    } catch (e) { return ""; }
  }
  function rowKey(a) {
    var exact = raw(a && (a.id || a.appointmentId || a.appointment_id || a.apptId || a.appt_id));
    return exact + "|" + raw(a && a.patient_external_id) + "|" + raw(a && a.name) + "|" + raw(a && a.dob) + "|" + dateOf(a) + "|" + timeOf(a);
  }
  function normName(v) { return text(v).toLowerCase().replace(/\s+/g, " "); }
  function dobKey(v) {
    var s = text(v), m;
    if ((m = s.match(/^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/))) return m[1] + pad2(m[2]) + pad2(m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/))) return m[3] + pad2(m[1]) + pad2(m[2]);
    return "";
  }
  function fmtDay(day) {
    return safe(function () {
      var p = day.split("-");
      return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    }, day);
  }
  function appointments() { return safe(function () { return Array.isArray(window._calAppts) ? window._calAppts : []; }, []); }
  function isStaff(a) { return safe(function () { return !!(window.__mlsStaffMark && window.__mlsStaffMark.isStaff(a && a.name)); }, false); }

  function unwrapRow(entry) {
    if (!entry) return null;
    return entry.appointment || entry.row || entry.appt || entry;
  }
  function daySwitchRows(day) {
    var ds = daySwitch(), rows;
    if (!ds || typeof ds.rowsFor !== "function") return null;
    rows = safe(function () { return ds.rowsFor(day); }, null);
    if (!Array.isArray(rows)) return null;
    return rows.map(unwrapRow).filter(function (a) { return !!a; });
  }
  function exactIdentityKey(a) { return sourceId(a) + "|" + appointmentId(a); }
  function exactRowSignature(a) {
    return [
      sourceId(a), appointmentId(a),
      raw(a && a.patient_external_id), raw(a && a._mlsTargetPatientId),
      raw(a && a.patientId), raw(a && a.patient_id), raw(a && a.name),
      raw(a && a.dob), dateOf(a), providerOf(a), timeOf(a)
    ].join("\u001f");
  }
  function uniqueExact(rows) {
    var out = [], seen = {};
    rows.forEach(function (a) {
      /* A repeated transport row may be discarded only when every binding
         identity field is identical. Same source/appointment IDs with a
         different patient, date, provider, or time are conflicting evidence,
         not duplicates; preserving both makes resolution fail closed. */
      var k = exactRowSignature(a);
      if (!k || seen[k]) return;
      seen[k] = true; out.push(a);
    });
    return out;
  }
  function resolveForKey(key, day) {
    day = validDay(day); key = text(key);
    if (!day || !key || selectedDay() !== day) return { ok: false, reason: "wrong-selected-day" };
    var exposed = daySwitchRows(day);
    if (!exposed) return { ok: false, reason: "day-owner-unavailable" };
    var exposedMatches = exposed.filter(function (a) { return dateOf(a) === day && rowKey(a) === key && !isStaff(a); });
    if (!exposedMatches.length) return { ok: false, reason: "stale-row" };
    var wantedExact = {};
    exposedMatches.forEach(function (a) {
      if (sourceId(a) && appointmentId(a)) wantedExact[exactIdentityKey(a)] = true;
    });
    var candidates = appointments().filter(function (a) {
      if (!a || isStaff(a)) return false;
      /* Include same-ID conflicts even when the changed identity field also
         changed the native row key or filed date. Otherwise a poisoned second
         row could hide outside the selected-day bucket and be silently
         collapsed into the visible row. */
      return (dateOf(a) === day && rowKey(a) === key) || !!wantedExact[exactIdentityKey(a)];
    });
    candidates = uniqueExact(candidates.length ? candidates : exposedMatches);
    if (candidates.length !== 1) return { ok: false, reason: candidates.length ? "ambiguous-appointment" : "stale-row" };
    var a = candidates[0];
    if (!sourceId(a)) return { ok: false, reason: "source-id-missing" };
    /* b438: an Athena appointment id is a DESTINATION identifier, not a patient
       identifier, so its absence is not an identity failure and must not block
       OPENING the chart. Nothing in this module's identity ladder reads it:
       the single-candidate rule above, source-id, provider below, and the whole
       resolvePatient chain (exact name + DOB against exactly one chart) are all
       independent of it, and exactRowSignature still separates rows on its other
       fields when every appointmentId is "".
       It was required here from b430 onward, which walled off every non-today
       day: the only producer is the extension's schedule DOM scrape, and when
       that yields nothing the field is empty for every pulled row. Today already
       degrades to a warning in this exact situation (mls-connect.js
       installScheduledVisitBinding / exactBindingReady) rather than refusing to
       open, so requiring it here made non-today strictly harsher than today for
       identical data.
       Athena WRITE and verification still fail closed without it, independently
       of this module - feat_mls_writeflow exactVisitBlocked, exact-encounter
       verify, and the extension's own digits(appointmentId) policy. */
    if (!providerOf(a)) return { ok: false, reason: "provider-missing" };
    return { ok: true, appointment: a };
  }
  function resolveAppointment(a) {
    var day = selectedDay(), resolved;
    if (!day || day === todayDay() || dateOf(a) !== day) return { ok: false, reason: "wrong-selected-day" };
    resolved = resolveForKey(rowKey(a), day);
    if (!resolved.ok) return resolved;
    if ((sourceId(a) && sourceId(a) !== sourceId(resolved.appointment)) ||
        (appointmentId(a) && appointmentId(a) !== appointmentId(resolved.appointment))) {
      return { ok: false, reason: "stale-row" };
    }
    return resolved;
  }

  function patientList() { return safe(function () { return typeof window.getPatients === "function" ? (window.getPatients() || []) : []; }, []); }
  function distinctRefs(raw, stored) {
    raw = raw || {};
    var keys = stored ? ["id", "_mlsTargetPatientId", "patientId", "patient_id"] : ["patient_external_id", "_mlsTargetPatientId", "patientId", "patient_id"];
    var out = [], seen = {};
    keys.forEach(function (key) { var v = text(raw[key]).toLowerCase(); if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out;
  }
  function identityCompatible(a, p) {
    if (!a || !p || !normName(a.name) || normName(a.name) !== normName(p.name)) return false;
    var ad = dobKey(a.dob), pd = dobKey(p.dob);
    return !(ad && pd && ad !== pd);
  }
  function resolvePatient(a) {
    var pts = patientList(), refs = distinctRefs(a, false);
    if (refs.length > 1) return { ok: false, reason: "conflicting-patient-ids" };
    if (refs.length === 1) {
      var wanted = refs[0];
      var exact = pts.filter(function (p) {
        var refsForPatient = distinctRefs(p, true);
        return refsForPatient.length === 1 && refsForPatient[0] === wanted;
      });
      if (exact.length === 1 && identityCompatible(a, exact[0])) return { ok: true, patient: exact[0], by: "stable-id" };
      if (exact.length) return { ok: false, reason: "linked-chart-not-exact" };
    }
    var name = normName(a && a.name), dob = dobKey(a && a.dob);
    if (!name || !dob) return { ok: false, reason: "appointment-needs-link" };
    var demographic = pts.filter(function (p) {
      return normName(p && p.name) === name && dobKey(p && p.dob) === dob && distinctRefs(p, true).length <= 1;
    });
    if (demographic.length !== 1) return { ok: false, reason: demographic.length ? "ambiguous-chart" : "appointment-needs-link" };
    return { ok: true, patient: demographic[0], by: "unique-name-dob" };
  }
  function resolveForPatientId(patientId, day) {
    patientId = text(patientId); day = validDay(day);
    if (!patientId || !day || selectedDay() !== day) return { ok: false, reason: "wrong-selected-day" };
    var patientMatches = patientList().filter(function (p) { return text(p && p.id) === patientId; });
    if (patientMatches.length !== 1) return { ok: false, reason: patientMatches.length ? "ambiguous-chart" : "appointment-needs-link" };
    var rows = daySwitchRows(day);
    if (!rows) return { ok: false, reason: "day-owner-unavailable" };
    var matches = [];
    rows.forEach(function (a) {
      if (!a || dateOf(a) !== day || isStaff(a)) return;
      var resolved = resolvePatient(a);
      if (resolved.ok && text(resolved.patient && resolved.patient.id) === patientId) matches.push(a);
    });
    matches = uniqueExact(matches);
    if (matches.length !== 1) return { ok: false, reason: matches.length ? "ambiguous-patient-appointments" : "unscheduled-patient" };
    return resolveForKey(rowKey(matches[0]), day);
  }

  function freeze(value) { return safe(function () { return Object.freeze(value); }, value); }
  function freezeContext(a, p) {
    return freeze({
      appointmentId: appointmentId(a), sourceId: sourceId(a), patientId: text(p && p.id),
      patientName: text(p && p.name), date: dateOf(a), provider: providerOf(a),
      visitType: text(a && (a.reason || a.visit_type || a.type || "")), activatedAt: Date.now()
    });
  }
  function installBinding(a, p, ctx) {
    if (typeof window._athenaFreezeVisitBinding !== "function" || typeof window._athenaSetVisitBinding !== "function") return false;
    var visitContext = freeze({
      historical: false, visitDate: ctx.date, provider: ctx.provider,
      appointmentId: ctx.appointmentId, encounterId: "", encounterUrl: ""
    });
    var noteTime = safe(function () { return new Date(ctx.date + "T12:00:00").getTime(); }, Date.now());
    var binding = safe(function () {
      return window._athenaFreezeVisitBinding(p, {
        source: "selected-day-appointment", historical: false, noteTimestamp: noteTime,
        visitContext: visitContext, displayDate: ctx.date, displayProvider: ctx.provider
      });
    }, null);
    if (!binding) return false;
    return safe(function () { return window._athenaSetVisitBinding(binding, true) === true; }, false);
  }

  function closeModal() {
    var modal = byId(MODAL_ID);
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }
  function messageFor(reason) {
    var messages = {
      "wrong-selected-day": "The selected date changed before MLS could verify this appointment. Choose the patient again on the intended date.",
      "day-owner-unavailable": "The selected-date workspace is still loading. Reload MLS and choose the appointment again.",
      "stale-row": "That appointment row is no longer part of the selected date. MLS did not open a patient or run an action.",
      "ambiguous-appointment": "More than one appointment matches that row. MLS will not guess; refresh the selected date and choose the exact appointment again.",
      "source-id-missing": "That row is missing its MLS appointment reference. Refresh the selected date before continuing.",
      /* b438: no longer reachable from resolveForKey - a missing Athena
         appointment id no longer blocks opening. Kept only so an older cached
         copy of this module cannot surface an empty modal body. */
      "appointment-id-missing": "That row has no exact Athena appointment ID. The chart is open, but Athena verification and send stay unavailable for it.",
      "provider-missing": "That appointment has no exact provider. MLS kept the visit tools closed so the visit cannot be filed under the wrong context.",
      "conflicting-patient-ids": "That appointment carries conflicting patient IDs. MLS will not guess between charts.",
      "linked-chart-not-exact": "The linked chart does not exactly match this appointment's patient identity. Nothing was started.",
      "appointment-needs-link": "This appointment is not linked to one chart with an exact name and DOB. Link the chart, then try again.",
      "ambiguous-chart": "More than one chart matches this appointment. MLS will not guess between patients.",
      "unscheduled-patient": "That patient does not have one exact appointment on the selected date. Choose a scheduled appointment row; MLS will not create an unbound visit.",
      "ambiguous-patient-appointments": "That patient has more than one appointment on the selected date. Choose the exact scheduled appointment row; MLS will not guess which visit you mean.",
      "workspace-unavailable": "The Visit workspace is still loading. Reload MLS and choose the appointment again.",
      "recording-active": "Stop the current recording before switching appointments. The transcript is still safe.",
      "activation-failed": "MLS could not prove that the exact appointment opened. The requested action did not run.",
      "binding-unavailable": "MLS could not create the exact date, appointment, and provider binding. The requested action did not run.",
      "unsafe-action": "That appointment action is not approved for selected-date use, so MLS blocked it.",
      /* b438: the visit stays OPEN and stays locked to this exact patient, date
         and provider when an action cannot start - say so, or the doctor reads
         this as "nothing happened" and re-clicks. */
      "action-unavailable": "The visit is open and locked to this exact patient, date, and provider, but the requested action could not start. Nothing was written and no substitute action ran.",
      "action-failed": "The exact visit opened, but the requested action could not start. MLS cleared the visit binding; try again."
    };
    return messages[reason] || "MLS could not safely open that exact appointment. The requested action did not run.";
  }
  function showFailure(reason) {
    var message = messageFor(reason), host = document.body || document.documentElement;
    closeModal();
    if (!host || typeof document.createElement !== "function") {
      safe(function () { if (typeof window.toast === "function") window.toast(message, "err"); });
      return false;
    }
    var modal = document.createElement("div"); modal.id = MODAL_ID;
    modal.setAttribute("role", "alertdialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-labelledby", "mlsXdcModalTitle");
    modal.innerHTML = '<div class="mls-xdc-modalbox"><strong id="mlsXdcModalTitle">Appointment not opened</strong>' +
      '<p>' + esc(message) + '</p><button type="button" data-xdc-close>Close</button></div>';
    host.appendChild(modal);
    return false;
  }
  function dispatchContext(detail) {
    safe(function () { window.dispatchEvent(new CustomEvent("mls:appointment-context-changed", { detail: detail })); });
  }
  function clear(reason) {
    var previous = current;
    current = null;
    if (previous) safe(function () { if (typeof window._athenaSetVisitBinding === "function") window._athenaSetVisitBinding(null, true); });
    if (previous) dispatchContext({ active: false, reason: text(reason), appointmentId: previous.appointmentId, patientId: previous.patientId, date: previous.date });
    return true;
  }

  function easyRemote() {
    var easy = safe(function () { return window.__mlsEasyV32; }, null);
    return easy && easy.remote;
  }
  function allowedAction(action) { return !action || /^(rec|chart|gen|send|prep)$/.test(action); }
  function performAction(action, a, p, remote) {
    if (!action) return true;
    if (action === "rec") return typeof remote.record === "function" && remote.record() === true;
    if (action === "gen") return typeof remote.generate === "function" && remote.generate() === true;
    if (action === "send") return typeof remote.requestSendReview === "function" && remote.requestSendReview() === true;
    if (action === "chart") {
      if (typeof window.calPullChartFor !== "function") return false;
      window.calPullChartFor(a.id); return true;
    }
    if (action === "prep") {
      if (typeof window.openOpPrepForPatient !== "function") return false;
      window.openOpPrepForPatient(p.id); return true;
    }
    return false;
  }
  function openResolved(a, requestedAction) {
    requestedAction = text(requestedAction).toLowerCase();
    var day = selectedDay(), resolvedPatient, remote, before, ctx, snapshot, active;
    if (!day || day === todayDay() || dateOf(a) !== day) return showFailure("wrong-selected-day");
    if (!allowedAction(requestedAction)) return showFailure("unsafe-action");
    resolvedPatient = resolvePatient(a);
    if (!resolvedPatient.ok) return showFailure(resolvedPatient.reason);
    remote = easyRemote();
    if (!remote || typeof remote.startVisitFor !== "function" || typeof remote.currentVisitDay !== "function" || typeof remote.snapshot !== "function") return showFailure("workspace-unavailable");
    if (typeof window._athenaFreezeVisitBinding !== "function" || typeof window._athenaSetVisitBinding !== "function") return showFailure("binding-unavailable");
    before = safe(function () { return remote.snapshot(); }, null);
    if (before && before.phase === "rec" && before.active && text(before.active.id) !== sourceId(a)) return showFailure("recording-active");

    if (current) clear("appointment-changed");
    closeModal(); activating = true;
    try {
      if (remote.startVisitFor(sourceId(a), { record: false }) !== true) throw new Error("activation-failed");
      if (selectedDay() !== day || validDay(remote.currentVisitDay()) !== day) throw new Error("wrong-selected-day");
      snapshot = safe(function () { return remote.snapshot(); }, null);
      if (!snapshot || !snapshot.active || text(snapshot.active.id) !== sourceId(a)) throw new Error("activation-failed");
      active = safe(function () { return typeof window.activePatient === "function" ? window.activePatient() : null; }, null);
      if (active && (text(active.id) !== text(resolvedPatient.patient.id) || !identityCompatible(a, active))) throw new Error("activation-failed");
      ctx = freezeContext(a, resolvedPatient.patient);
      if (!installBinding(a, resolvedPatient.patient, ctx)) throw new Error("binding-unavailable");
      if (selectedDay() !== day || validDay(remote.currentVisitDay()) !== day) throw new Error("wrong-selected-day");
      current = ctx;
      dispatchContext({ active: true, appointmentId: ctx.appointmentId, patientId: ctx.patientId, date: ctx.date, provider: ctx.provider, requestedAction: requestedAction });
      /* b438: an action that could not START is not an identity failure, so the
         frozen binding must survive it. The binding is a CONSTRAINT, not a
         capability: it pins this note to the selected day/provider/patient and
         is what makes every Athena write path refuse. Clearing it here left the
         visit OPEN and unbound, and the next edit re-bound it through the
         manual-entry path, which stamps displayDate = today - silently
         re-dating a pulled-day note to the current date and, because the empty
         date/provider then miss the writeflow short-circuit, flipping the write
         gate from blocked to ready. Keep the binding and report the failure. */
      if (!performAction(requestedAction, a, resolvedPatient.patient, remote)) {
        return showFailure("action-unavailable");
      }
      return true;
    } catch (e) {
      if (current) clear("activation-failed");
      else safe(function () { window._athenaSetVisitBinding(null, true); });
      return showFailure(e && /^(wrong-selected-day|binding-unavailable)$/.test(e.message) ? e.message : "activation-failed");
    } finally { activating = false; }
  }
  function openAppointment(a, requestedAction) {
    var exact = resolveAppointment(a || {});
    if (!exact.ok) return showFailure(exact.reason);
    return openResolved(exact.appointment, requestedAction);
  }
  function openForKey(key, requestedAction) {
    var exact = resolveForKey(key, selectedDay());
    if (!exact.ok) return showFailure(exact.reason);
    return openResolved(exact.appointment, requestedAction);
  }
  function openForPatientId(patientId) {
    var exact = resolveForPatientId(patientId, selectedDay());
    if (!exact.ok) return showFailure(exact.reason);
    return openResolved(exact.appointment, "");
  }

  function closest(target, selector) {
    return safe(function () { return target && typeof target.closest === "function" ? target.closest(selector) : null; }, null);
  }
  function insideEasy(el) { return !!closest(el, "#mlsEz3"); }
  function intentFor(target) {
    var el;
    if (!target || !insideEasy(target)) return null;
    el = closest(target, "[data-act]");
    if (el) return { key: text(el.getAttribute("data-k")), action: text(el.getAttribute("data-act")).toLowerCase() };
    if (closest(target, "[data-more]")) return null;
    el = closest(target, "[data-q]");
    if (el) return { key: text(el.getAttribute("data-q")), action: "" };
    el = closest(target, "[data-hd]");
    if (el) return { key: text(el.getAttribute("data-hd")), action: "" };
    el = closest(target, "[data-pt]");
    if (el) return { patientId: text(el.getAttribute("data-pt")), action: "" };
    return null;
  }
  function consume(ev) {
    safe(function () { ev.preventDefault(); });
    safe(function () { ev.stopPropagation(); });
    safe(function () { if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation(); });
  }
  function onCaptureClick(ev) {
    var target = ev && ev.target, id = text(target && target.id), intent;
    if (!target) return;
    if (closest(target, "[data-xdc-close]")) { consume(ev); closeModal(); return; }
    if (current && (id === "ez3Back" || id === "ez3Change" || closest(target, "#ez3Back") || closest(target, "#ez3Change"))) {
      clear(id === "ez3Change" ? "patient-change" : "workspace-back");
      return;
    }
    if (selectedDay() === todayDay()) return;
    intent = intentFor(target);
    if (!intent) return;
    consume(ev);
    if (intent.patientId) { openForPatientId(intent.patientId); return; }
    if (!intent.key) { showFailure("stale-row"); return; }
    openForKey(intent.key, intent.action);
  }
  function onSelectedDayChange() { if (current) clear("selected-day-changed"); closeModal(); }
  function onSessionBoundary() { clear("session-boundary"); closeModal(); }
  function onPatientChange(ev) {
    if (!current || activating) return;
    var next = text(ev && ev.detail && ev.detail.patientId);
    if (!next || next !== current.patientId) clear("patient-changed");
  }

  function installStyle() {
    if (byId(STYLE_ID)) return;
    var style = document.createElement("style"); style.id = STYLE_ID;
    style.textContent = [
      "#mlsXdcModal{position:fixed;inset:0;z-index:2147483000;background:rgba(18,28,23,.52);display:flex;align-items:center;justify-content:center;padding:18px;}",
      "#mlsXdcModal .mls-xdc-modalbox{width:min(460px,100%);background:#fff;color:#203b2f;border-radius:14px;padding:18px;box-shadow:0 22px 70px rgba(0,0,0,.25);font:500 14px/1.45 system-ui;}",
      "#mlsXdcModal .mls-xdc-modalbox strong{display:block;font-size:17px;margin-bottom:6px;}#mlsXdcModal .mls-xdc-modalbox p{margin:0 0 14px;}",
      "#mlsXdcModal [data-xdc-close]{border:0;border-radius:8px;background:#204034;color:#fff;padding:9px 14px;font:700 13px system-ui;cursor:pointer;}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
  }
  function boot() {
    if (disposed) return;
    installStyle();
    safe(function () { window.addEventListener("click", onCaptureClick, true); });
    safe(function () { window.addEventListener("mls:visit-day-changed", onSelectedDayChange); });
    safe(function () { window.addEventListener("mls:easy-visit-day-changed", onSelectedDayChange); });
    safe(function () { window.addEventListener("mls:active-patient-changed", onPatientChange); });
    safe(function () { window.addEventListener("mls:session-boundary", onSessionBoundary); });
  }

  var api = {
    installed: true, version: VERSION,
    current: function () {
      if (current && selectedDay() !== current.date) clear("selected-day-changed");
      return current;
    },
    clear: clear,
    openAppointment: openAppointment,
    openForKey: openForKey,
    openForPatientId: openForPatientId,
    refresh: function () { return true; },
    _test: {
      selectedDay: selectedDay, dateOf: dateOf, appointmentId: appointmentId,
      rowKey: rowKey, resolveForKey: resolveForKey, resolveForPatientId: resolveForPatientId, resolvePatient: resolvePatient,
      intentFor: intentFor, onCaptureClick: onCaptureClick
    },
    revert: function () {
      disposed = true; clear("revert"); closeModal();
      safe(function () { window.removeEventListener("click", onCaptureClick, true); });
      safe(function () { window.removeEventListener("mls:visit-day-changed", onSelectedDayChange); });
      safe(function () { window.removeEventListener("mls:easy-visit-day-changed", onSelectedDayChange); });
      safe(function () { window.removeEventListener("mls:active-patient-changed", onPatientChange); });
      safe(function () { window.removeEventListener("mls:session-boundary", onSessionBoundary); });
      var style = byId(STYLE_ID); if (style && style.parentNode) style.parentNode.removeChild(style);
      try { delete window[NS]; } catch (e) { window[NS] = null; }
    }
  };
  window[NS] = api;
  boot();
})();

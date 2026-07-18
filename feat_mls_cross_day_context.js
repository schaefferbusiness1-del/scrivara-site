/* feat_mls_cross_day_context.js -> window.__mlsCrossDayContext (xdc-1.0.0)
 *
 * A selected non-today day used to be a read-only dead end: __mlsDaySwitch
 * intentionally hid #ez3Wrap and discarded appointment identifiers from its
 * rendered rows. This additive companion keeps that mismatch guard, then adds
 * an exact "Open full workspace" action for each already-loaded appointment.
 *
 * The action is fail-closed. It resolves one exact stored patient, starts the
 * Easy workspace through its public appointment API, and replaces the generic
 * current-time binding with an immutable patient + appointment + date binding.
 * The full tool surface is revealed only after every check succeeds. Changing
 * day or patient clears the binding again. Nothing here pulls Athena, touches
 * the extension, or performs a write-back.
 */
;(function () {
  "use strict";
  var NS = "__mlsCrossDayContext", VERSION = "xdc-1.0.0";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  var STYLE_ID = "mlsXdcStyle", BANNER_ID = "mlsXdcBanner", MODAL_ID = "mlsXdcModal";
  var current = null, activating = false, observer = null, raf = 0, disposed = false;

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function byId(id) { return safe(function () { return document.getElementById(id); }, null); }
  function text(v) { return String(v == null ? "" : v).trim(); }
  function esc(v) { return text(v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function normName(v) { return text(v).toLowerCase().replace(/\s+/g, " "); }
  function dobKey(v) {
    var s = text(v), m;
    if ((m = s.match(/^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/))) return m[1] + ("0" + m[2]).slice(-2) + ("0" + m[3]).slice(-2);
    if ((m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/))) return m[3] + ("0" + m[1]).slice(-2) + ("0" + m[2]).slice(-2);
    return "";
  }
  function dateOf(a) { return text(a && (a.day_local || a.appt_date || a.date || "")).slice(0, 10); }
  function apptId(a) { return text(a && (a.appointment_id || a.appt_id || a.athena_appointment_id || a.id || "")); }
  function providerOf(a) {
    var p = text(a && (a.provider || a.providerName || a.provider_name || ""));
    if (!p) p = safe(function () { return a && a.doctor_user_id && typeof window._docName === "function" ? window._docName(a.doctor_user_id) : ""; }, "");
    return text(p);
  }
  function timeOf(a) { return text(a && (a.time_display || a.start_local || a.time || a.start_at || "")); }
  function fmtDay(k) {
    return safe(function () {
      var p = text(k).split("-");
      return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    }, text(k));
  }
  function cleanRef(v) { return text(v).toLowerCase(); }
  function distinctRefs(raw, stored) {
    raw = raw || {};
    var keys = stored ? ["id", "_mlsTargetPatientId", "patientId", "patient_id"] : ["patient_external_id", "_mlsTargetPatientId", "patientId", "patient_id"];
    var out = [], seen = {};
    keys.forEach(function (key) { var v = cleanRef(raw[key]); if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out;
  }
  function rowKey(a) { return normName(a && a.name) + "|" + text(a && a.dob) + "|" + timeOf(a); }

  function appointments() { return safe(function () { return Array.isArray(window._calAppts) ? window._calAppts : []; }, []); }
  function appointmentsForDay(day) {
    var groups = [], byKey = {};
    appointments().forEach(function (a) {
      if (!a || dateOf(a) !== day || !normName(a.name)) return;
      if (safe(function () { return window.__mlsStaffMark && window.__mlsStaffMark.isStaff(a.name); }, false)) return;
      var key = rowKey(a), group = byKey[key];
      if (!group) { group = byKey[key] = { key: key, sort: text(a.start_local || timeOf(a)), candidates: [] }; groups.push(group); }
      group.candidates.push(a);
    });
    groups.sort(function (a, b) { return a.sort.localeCompare(b.sort); });
    return groups;
  }

  function selectedDay() {
    var label = text((byId("mlsDsDayLbl") || {}).textContent).replace(/^Today\s*-\s*/i, "");
    if (!label) return "";
    var found = {}, count = 0, answer = "";
    appointments().forEach(function (a) {
      var day = dateOf(a);
      if (!day || found[day] || fmtDay(day) !== label) return;
      found[day] = true; count++; answer = day;
    });
    return count === 1 ? answer : "";
  }

  function patientList() { return safe(function () { return typeof window.getPatients === "function" ? (window.getPatients() || []) : []; }, []); }
  function identityCompatible(a, p) {
    if (!a || !p) return false;
    if (normName(a.name) && normName(p.name) !== normName(a.name)) return false;
    var ad = dobKey(a.dob), pd = dobKey(p.dob);
    return !(ad && pd && ad !== pd);
  }
  function resolvePatient(a) {
    var pts = patientList(), refs = distinctRefs(a, false);
    if (refs.length > 1) return { ok: false, reason: "conflicting-patient-ids" };
    if (refs.length === 1) {
      var wanted = refs[0];
      var exact = pts.filter(function (p) {
        var pr = distinctRefs(p, true);
        return pr.length === 1 && pr[0] === wanted;
      });
      if (exact.length === 1 && identityCompatible(a, exact[0])) return { ok: true, patient: exact[0], by: "stable-id" };
      if (exact.length >= 1) return { ok: false, reason: "linked-chart-not-exact" };
      /* exact.length === 0 (live-caught b414): pulled schedule rows carry the
         athena patient_external_id, but locally-created charts store only the
         app id — NO chart can ever match by stable id, and every day-row
         click failed closed ("could not be verified") even though a single
         exact name+DOB chart exists. Fall through to the SAME fail-closed
         demographic match below (a second stored ref would break the
         pr.length===1 stable-id contract, so we deliberately do NOT stamp
         the athena id onto the chart). */
    }
    var name = normName(a && a.name), dob = dobKey(a && a.dob);
    if (!name || !dob) return { ok: false, reason: "appointment-needs-link" };
    var demographic = pts.filter(function (p) { return normName(p && p.name) === name && dobKey(p && p.dob) === dob && distinctRefs(p, true).length <= 1; });
    if (demographic.length !== 1) return { ok: false, reason: demographic.length ? "ambiguous-chart" : "appointment-needs-link" };
    return { ok: true, patient: demographic[0], by: "unique-name-dob" };
  }

  function messageFor(reason) {
    var messages = {
      "conflicting-patient-ids": "That appointment carries conflicting patient IDs. Open Patients and choose the exact chart; nothing was changed.",
      "linked-chart-not-exact": "The linked chart could not be verified by exact ID, name, and DOB. Open Patients and choose the exact chart; nothing was changed.",
      "appointment-needs-link": "This appointment is not linked to one chart with an exact name and DOB. Open Patients and choose the exact chart first.",
      "ambiguous-chart": "More than one chart matches that appointment. Open Patients and choose the exact chart; MLS will not guess.",
      "wrong-selected-day": "The selected day changed before the appointment opened. Choose the patient again on the intended day.",
      "workspace-unavailable": "The full patient workspace is still loading. Reload MLS and choose the appointment again.",
      "binding-unavailable": "MLS could not create an exact appointment-date binding, so the tools stayed closed. Reload and try again.",
      "activation-failed": "MLS could not open that exact appointment. Nothing was started; choose the patient again."
    };
    return messages[reason] || "MLS could not safely open that appointment. Nothing was changed.";
  }
  function notify(message, kind) { safe(function () { if (typeof window.toast === "function") window.toast(message, kind || ""); }); }

  function freezeContext(a, p) {
    var ctx = {
      appointmentId: apptId(a), patientId: text(p && p.id), date: dateOf(a),
      provider: providerOf(a), visitType: text(a && (a.reason || a.visit_type || a.type || "")),
      activatedAt: Date.now()
    };
    return safe(function () { return Object.freeze(ctx); }, ctx);
  }
  function installVisitBinding(a, p, ctx) {
    if (typeof window._athenaFreezeVisitBinding !== "function" || typeof window._athenaSetVisitBinding !== "function") return false;
    var visitContext = { historical: false, visitDate: ctx.date, provider: ctx.provider, appointmentId: ctx.appointmentId, encounterId: "", encounterUrl: "" };
    var noteTime = safe(function () { return new Date(ctx.date + "T12:00:00").getTime(); }, Date.now());
    var binding = window._athenaFreezeVisitBinding(p, {
      source: "cross-day-appointment", historical: false, noteTimestamp: noteTime,
      visitContext: visitContext, displayDate: ctx.date, displayProvider: ctx.provider
    });
    return !!binding && window._athenaSetVisitBinding(binding, true) === true;
  }

  function setActiveUi(on) {
    safe(function () { document.body.classList.toggle("mls-xdc-active", !!on); });
    safe(function () { var body = byId("mlsEz3Body"); if (body) body.classList.toggle("mls-xdc-active", !!on); });
    if (!on) { var old = byId(BANNER_ID); if (old && old.parentNode) old.parentNode.removeChild(old); }
  }
  function renderBanner(a, p, ctx) {
    var body = byId("mlsEz3Body"), wrap = byId("ez3Wrap");
    if (!body || !wrap || !wrap.parentNode) return;
    var banner = byId(BANNER_ID);
    if (!banner) { banner = document.createElement("div"); banner.id = BANNER_ID; wrap.parentNode.insertBefore(banner, wrap); }
    banner.innerHTML = '<div class="mls-xdc-copy"><strong>Full workspace: ' + esc(p.name || "Selected patient") + '</strong>' +
      '<span>Appointment ' + esc(fmtDay(ctx.date)) + (ctx.provider ? " · " + esc(ctx.provider) : "") + '</span>' +
      '<small>Visit, AI, prep, history, and draft tools below are bound to this exact patient and appointment day.</small></div>' +
      '<button type="button" id="mlsXdcChange">Choose another appointment on this day</button>';
  }

  function dispatchContext(detail) {
    safe(function () { window.dispatchEvent(new CustomEvent("mls:appointment-context-changed", { detail: detail })); });
  }
  function clear(reason) {
    if (!current) { setActiveUi(false); return true; }
    var previous = current; current = null;
    setActiveUi(false);
    safe(function () { if (typeof window._athenaSetVisitBinding === "function") window._athenaSetVisitBinding(null, true); });
    dispatchContext({ active: false, reason: text(reason), appointmentId: previous.appointmentId, patientId: previous.patientId, date: previous.date });
    scheduleDecorate();
    return true;
  }

  function openAppointment(a) {
    a = a || {};
    var day = dateOf(a), sourceId = text(a.id), exactId = apptId(a);
    var listVisible = !!byId("mlsDsList"), chosenDay = selectedDay();
    if (!day || !sourceId || !exactId || (listVisible && (!chosenDay || chosenDay !== day))) { notify(messageFor("wrong-selected-day"), "err"); return false; }
    var resolved = resolvePatient(a);
    if (!resolved.ok) { notify(messageFor(resolved.reason), "err"); return false; }
    var easy = window.__mlsEasyV32, remote = easy && easy.remote;
    if (!remote || typeof remote.startVisitFor !== "function") { notify(messageFor("workspace-unavailable"), "err"); return false; }
    if (typeof window._athenaFreezeVisitBinding !== "function" || typeof window._athenaSetVisitBinding !== "function") { notify(messageFor("binding-unavailable"), "err"); return false; }

    var p = resolved.patient, ctx = freezeContext(a, p), ok = false;
    activating = true;
    try {
      if (!a.patient_external_id) a.patient_external_id = p.id;
      ok = remote.startVisitFor(sourceId, { record: false }) === true;
      var active = safe(function () { return typeof window.activePatient === "function" ? window.activePatient() : null; }, null);
      if (!ok || !active || text(active.id) !== text(p.id) || !identityCompatible(a, active)) throw new Error("activation-failed");
      if (!installVisitBinding(a, active, ctx)) throw new Error("binding-unavailable");
      current = ctx;
      setActiveUi(true);
      renderBanner(a, active, ctx);
      dispatchContext({ active: true, appointmentId: ctx.appointmentId, patientId: ctx.patientId, date: ctx.date, provider: ctx.provider });
      notify("Opened " + text(active.name || "patient") + " for " + fmtDay(ctx.date) + ". All tools are bound to that appointment day.", "ok");
      return true;
    } catch (e) {
      safe(function () { if (typeof window._athenaSetVisitBinding === "function") window._athenaSetVisitBinding(null, true); });
      current = null; setActiveUi(false);
      notify(messageFor(e && e.message === "binding-unavailable" ? "binding-unavailable" : "activation-failed"), "err");
      return false;
    } finally { activating = false; }
  }

  function closeModal() { var modal = byId(MODAL_ID); if (modal && modal.parentNode) modal.parentNode.removeChild(modal); }
  function showCandidates(candidates) {
    closeModal();
    var modal = document.createElement("div"); modal.id = MODAL_ID; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
    var box = document.createElement("div"); box.className = "mls-xdc-modalbox";
    box.innerHTML = '<div class="mls-xdc-modalhead"><strong>Choose the exact appointment</strong><button type="button" data-xdc-close aria-label="Close">×</button></div>' +
      '<p>These rows share the same name, DOB, and time. MLS will not guess.</p>';
    candidates.forEach(function (a) {
      var b = document.createElement("button"); b.type = "button"; b.className = "mls-xdc-candidate"; b._mlsXdcAppointment = a;
      b.innerHTML = '<strong>' + esc(a.name || "Patient") + '</strong><span>' + esc(fmtDay(dateOf(a))) + ' · ' + esc(timeOf(a) || "time not recorded") + (providerOf(a) ? " · " + esc(providerOf(a)) : "") + '</span>';
      box.appendChild(b);
    });
    modal.appendChild(box); (document.body || document.documentElement).appendChild(modal);
  }

  function decorate() {
    if (disposed || current) return;
    var list = byId("mlsDsList"), day = selectedDay();
    if (!list || !day || typeof list.querySelectorAll !== "function") return;
    var rows = list.querySelectorAll(".ds-row"), groups = appointmentsForDay(day);
    if (!rows || rows.length !== groups.length) return;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], button = row.querySelector && row.querySelector(".mls-xdc-open");
      if (!button) { button = document.createElement("button"); button.type = "button"; button.className = "mls-xdc-open"; row.appendChild(button); }
      button._mlsXdcCandidates = groups[i].candidates.slice();
      button.textContent = groups[i].candidates.length > 1 ? "Choose exact appointment" : "Open full workspace";
      button.title = "Open this patient with every tool bound to " + fmtDay(day);
    }
  }
  function scheduleDecorate() {
    if (disposed || raf) return;
    var request = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf = request(function () { raf = 0; decorate(); });
  }

  function onClick(ev) {
    var t = ev && ev.target;
    if (!t) return;
    var button = safe(function () { return t.closest ? t.closest(".mls-xdc-open") : null; }, null);
    if (button) {
      ev.preventDefault(); ev.stopPropagation();
      var candidates = button._mlsXdcCandidates || [];
      if (candidates.length === 1) openAppointment(candidates[0]);
      else if (candidates.length > 1) showCandidates(candidates);
      return;
    }
    var candidate = safe(function () { return t.closest ? t.closest(".mls-xdc-candidate") : null; }, null);
    if (candidate && candidate._mlsXdcAppointment) { ev.preventDefault(); ev.stopPropagation(); var a = candidate._mlsXdcAppointment; closeModal(); openAppointment(a); return; }
    if (safe(function () { return t.closest && t.closest("[data-xdc-close]"); }, null)) { ev.preventDefault(); closeModal(); return; }
    var id = text(t.id);
    if (id === "mlsXdcChange") { ev.preventDefault(); clear("choose-another-appointment"); return; }
    if (current && (id === "mlsDsPrev" || id === "mlsDsNext" || id === "mlsDsTodayBtn" || id === "ez3Back" || id === "ez3Change")) clear("workspace-context-changed");
  }
  function onPatientChange(ev) {
    if (!current || activating) return;
    var next = text(ev && ev.detail && ev.detail.patientId);
    if (!next || next !== current.patientId) clear("patient-changed");
  }

  function installStyle() {
    if (byId(STYLE_ID)) return;
    var style = document.createElement("style"); style.id = STYLE_ID;
    style.textContent = [
      "#mlsDsList .ds-row .mls-xdc-open{margin-left:auto;border:0;border-radius:8px;background:#2E6A4B;color:#fff;font:700 12px system-ui;padding:8px 11px;cursor:pointer;white-space:nowrap;}",
      "#mlsDsList .ds-row .mls-xdc-open:hover{background:#24563d;}",
      "body.mls-xdc-active #mlsEz3Body.mls-ds-otherday>#ez3Wrap{display:block!important;}",
      "body.mls-xdc-active #mlsDsList{display:none!important;}",
      "body.mls-xdc-active #ez3Wrap .ez3-quick{display:none!important;}",
      "#mlsXdcBanner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#edf7f0;border:1px solid #bcd9c6;border-radius:12px;padding:11px 13px;margin:0 0 10px;color:#204034;}",
      "#mlsXdcBanner .mls-xdc-copy{display:flex;flex-direction:column;gap:2px;min-width:220px;flex:1;font:600 12.5px/1.35 system-ui;}",
      "#mlsXdcBanner .mls-xdc-copy strong{font-size:14px;}#mlsXdcBanner .mls-xdc-copy small{color:#5f7569;font-weight:600;}",
      "#mlsXdcBanner button{border:1px solid #9fc5ad;background:#fff;color:#24563d;border-radius:8px;padding:8px 11px;font:700 12px system-ui;cursor:pointer;}",
      "#mlsXdcModal{position:fixed;inset:0;z-index:2147483000;background:rgba(18,28,23,.5);display:flex;align-items:center;justify-content:center;padding:18px;}",
      "#mlsXdcModal .mls-xdc-modalbox{width:min(520px,100%);max-height:min(620px,calc(100vh - 36px));overflow:auto;background:#fff;border-radius:14px;padding:16px;box-shadow:0 22px 70px rgba(0,0,0,.25);}",
      "#mlsXdcModal .mls-xdc-modalhead{display:flex;align-items:center;justify-content:space-between;gap:12px;}#mlsXdcModal [data-xdc-close]{border:0;background:transparent;font-size:24px;cursor:pointer;}",
      "#mlsXdcModal .mls-xdc-candidate{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin-top:8px;border:1px solid #d9e5dc;background:#f8fbf9;color:#203b2f;border-radius:10px;padding:11px 12px;text-align:left;cursor:pointer;}#mlsXdcModal .mls-xdc-candidate span{font-size:12px;color:#60756a;}",
      "@media(max-width:640px){#mlsDsList .ds-row .mls-xdc-open{width:100%;margin-left:0;}#mlsXdcBanner button{width:100%;}}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
  }

  function boot() {
    if (disposed) return;
    installStyle();
    safe(function () { document.addEventListener("click", onClick, true); });
    safe(function () { window.addEventListener("mls:active-patient-changed", onPatientChange); });
    safe(function () {
      observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) { if (records[i].addedNodes && records[i].addedNodes.length) { scheduleDecorate(); break; } }
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    });
    scheduleDecorate();
  }

  var api = {
    installed: true, version: VERSION,
    current: function () { return current; },
    clear: clear,
    openAppointment: openAppointment,
    refresh: scheduleDecorate,
    _test: { appointmentsForDay: appointmentsForDay, selectedDay: selectedDay, resolvePatient: resolvePatient, dateOf: dateOf, apptId: apptId },
    revert: function () {
      disposed = true; clear("revert"); closeModal();
      safe(function () { if (observer) observer.disconnect(); }); observer = null;
      safe(function () { document.removeEventListener("click", onClick, true); });
      safe(function () { window.removeEventListener("mls:active-patient-changed", onPatientChange); });
      var style = byId(STYLE_ID); if (style && style.parentNode) style.parentNode.removeChild(style);
      try { delete window[NS]; } catch (e) { window[NS] = null; }
    }
  };
  window[NS] = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();

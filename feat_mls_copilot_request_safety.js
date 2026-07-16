/* feat_mls_copilot_request_safety.js -> window.__mlsCopilotRequestSafety
 *
 * Hardens the main MLS Copilot request against patient/visit switches while
 * calendar loading or the AI response is in flight. A request owns one exact
 * conversation array, active patient, visit binding, and visit epoch. If any
 * of them changes, its result is discarded and cannot appear in another
 * patient's conversation. Read-only AI context; no Athena writes.
 */
;(function () {
  "use strict";
  var NS = "__mlsCopilotRequestSafety", VERSION = "crs-1.1.0";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(fn) { return typeof fn === "function"; }
  function norm(v) { return v == null ? "" : String(v); }
  function historyNow() {
    try { if (!Array.isArray(window._copilotHistory)) window._copilotHistory = []; return window._copilotHistory; }
    catch (e) { return []; }
  }
  function activeId() {
    return safe(function () {
      if (isFn(window.getActivePtId)) return norm(window.getActivePtId());
      var p = isFn(window.activePatient) ? window.activePatient() : null;
      return p ? norm(p.id) : "";
    }, "");
  }
  function ownerId() {
    return safe(function () {
      var s = window.__mlsPtCtxSafety;
      return s && isFn(s.owner) ? norm(s.owner()) : activeId();
    }, activeId());
  }
  function bindingId() {
    return safe(function () {
      var binding = (typeof currentVisitAthenaBinding !== "undefined") ? currentVisitAthenaBinding : null;
      return binding ? norm(binding.id) : "";
    }, "");
  }
  function bindingEpoch() {
    return safe(function () { return (typeof currentVisitAthenaEpoch !== "undefined") ? Number(currentVisitAthenaEpoch || 0) : 0; }, 0);
  }
  function reconcile(reason) {
    safe(function () {
      var s = window.__mlsPtCtxSafety;
      if (s && isFn(s.reconcile)) s.reconcile(reason || "copilot-request");
    });
  }
  function cloneJson(value) {
    return safe(function () { return JSON.parse(JSON.stringify(value == null ? {} : value)); }, {});
  }
  function uniqueMeta(data, requestId) {
    var seen = {}, actions = [], followups = [];
    var aa = data && Array.isArray(data.actions) ? data.actions : [];
    for (var i = 0; i < aa.length; i++) {
      var a = aa[i]; if (!a || typeof a !== "object") continue;
      var ak = [a.kind || "", a.arg || "", a.label || ""].join("|");
      if (seen["a:" + ak]) continue; seen["a:" + ak] = true; actions.push(a);
    }
    var ff = data && Array.isArray(data.followups) ? data.followups : [];
    for (var j = 0; j < ff.length; j++) {
      var f = String(ff[j] || "").trim(); if (!f) continue;
      var fk = f.toLowerCase(); if (seen["f:" + fk]) continue; seen["f:" + fk] = true; followups.push(f);
    }
    return { requestId: requestId, actions: actions, followups: followups,
      artifact: data && data.artifact && typeof data.artifact === "object" ? data.artifact : null };
  }
  var requestSeq = 0, activeRequest = null, ownerEvents = [];
  function capture() {
    reconcile("copilot-send");
    return {
      id: ++requestSeq,
      activeId: activeId(), ownerId: ownerId(), bindingId: bindingId(), epoch: bindingEpoch(),
      history: historyNow(), context: null, controller: (typeof AbortController === "function") ? new AbortController() : null,
      stale: false, reverted: false
    };
  }
  function stillCurrent(t) {
    return !!(t && historyNow() === t.history && activeId() === t.activeId && ownerId() === t.ownerId
      && bindingId() === t.bindingId && bindingEpoch() === t.epoch);
  }
  function dropPending(arr, pending) {
    if (!arr) return;
    var i = arr.indexOf(pending);
    if (i >= 0) arr.splice(i, 1);
  }
  function repaint() {
    safe(function () { if (isFn(window._copilotRenderThread)) window._copilotRenderThread(); });
    safe(function () { if (isFn(window._copilotRenderChips)) window._copilotRenderChips(); });
    safe(function () { if (isFn(window._copilotSaveHist)) window._copilotSaveHist(); });
  }
  function abortIfStale() {
    var token = activeRequest;
    if (!token || stillCurrent(token)) return;
    token.stale = true;
    safe(function () { if (token.controller) token.controller.abort(); });
  }
  function bindOwnerEvents() {
    if (ownerEvents.length || !isFn(window.addEventListener)) return;
    ["mls:patient-changed", "mls:active-patient-change", "mls:active-patient-changed", "mls:visit-changed", "mls:view-changed", "mls:context-changed"].forEach(function (name) {
      safe(function () { window.addEventListener(name, abortIfStale, false); ownerEvents.push([name, abortIfStale]); });
    });
  }
  function unbindOwnerEvents() {
    for (var i = 0; i < ownerEvents.length; i++) safe(function (row) { window.removeEventListener(row[0], row[1], false); }.bind(null, ownerEvents[i]));
    ownerEvents = [];
  }

  var original = safe(function () { return window.copilotAsk; }, null);
  if (!isFn(original)) { try { window[NS] = { installed: false, skipped: "copilotAsk unavailable" }; } catch (e) {} return; }

  async function guardedCopilotAsk() {
    if (window._copilotBusy) return false;
    var inp = safe(function () { return document.getElementById("copilotInput"); }, null);
    var q = String((inp && inp.value) || "").trim();
    if (!q) return false;
    if (q.charAt(0) === "/" && isFn(window._copilotSlash)) {
      var expanded = window._copilotSlash(q);
      if (expanded === null) return false;
      q = String(expanded || "").trim();
      if (!q) return false;
    }
    if (!isFn(window.backendMode) || !window.backendMode() || !isFn(window.bkToken) || !window.bkToken()) {
      historyNow().push({ role: "ai", text: "Sign in to use Copilot - it needs your account to read your practice data." });
      repaint();
      return false;
    }

    var token = capture(), ownerHistory = token.history;
    activeRequest = token;
    if (inp) { inp.value = ""; inp.style.height = "auto"; }
    ownerHistory.push({ role: "user", text: q });
    var pending = { role: "pending", requestId: token.id, requestOwner: token.ownerId, requestEpoch: token.epoch };
    token.pending = pending;
    ownerHistory.push(pending);
    repaint();
    var chips = safe(function () { return document.getElementById("copilotChips"); }, null);
    if (chips) chips.innerHTML = "";
    window._copilotBusy = true;
    var send = safe(function () { return document.getElementById("copilotSendBtn"); }, null);
    if (send) { send.disabled = true; safe(function () { send.setAttribute("aria-busy", "true"); }); }
    var aborted = false;

    try {
      try {
        if (isFn(window.loadCalendar) && (!Array.isArray(window._calAppts) || !window._calAppts.length)) await window.loadCalendar();
      } catch (e0) {}
      if (!stillCurrent(token)) { aborted = true; return false; }

      var hist = ownerHistory.filter(function (m) { return m && (m.role === "user" || m.role === "ai"); })
        .map(function (m) { return { role: m.role === "user" ? "user" : "ai", text: m.text }; });
      var context = cloneJson(isFn(window.copilotSnapshot) ? window.copilotSnapshot() : {});
      token.context = context;
      if (!stillCurrent(token)) { aborted = true; return false; }

      var options = {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + window.bkToken() },
        body: JSON.stringify({ question: q, context: context, history: hist.slice(0, -1) })
      };
      if (token.controller) options.signal = token.controller.signal;
      var response = await fetch(window.bkBase() + "/api/copilot", options);
      var data = await response.json().catch(function () { return {}; });
      if (!stillCurrent(token)) { aborted = true; return false; }

      dropPending(ownerHistory, pending);
      token.pending = null;
      if (response.status === 401) ownerHistory.push({ role: "ai", text: "Your MLS session expired. Sign in again, then resend this question.", requestId: token.id });
      else if (response.status === 403) ownerHistory.push({ role: "ai", text: "Copilot is available on clinician accounts.", requestId: token.id });
      else if (response.status === 429) ownerHistory.push({ role: "ai", text: "Copilot is handling unusually high demand. Nothing was run; wait a moment and try again.", requestId: token.id });
      else if (response.status === 503) ownerHistory.push({ role: "ai", text: "Copilot's AI service is temporarily unavailable. Your local schedule and patient commands still work.", requestId: token.id });
      else if (!response.ok) ownerHistory.push({ role: "ai", text: data.error || ("Copilot could not answer (server status " + response.status + "). Try again."), requestId: token.id });
      else {
        var meta = uniqueMeta(data, token.id);
        ownerHistory.push({ role: "ai", text: data.reply || "Copilot returned no answer. Try rephrasing the question.", requestId: token.id,
          actions: meta.actions, followups: meta.followups, artifact: meta.artifact });
      }
      return true;
    } catch (e1) {
      if (stillCurrent(token)) {
        dropPending(ownerHistory, pending);
        token.pending = null;
        if (!(e1 && e1.name === "AbortError")) ownerHistory.push({ role: "ai", text: "Network error reaching Copilot. Nothing was run; check your connection and try again.", requestId: token.id });
        else aborted = true;
      } else aborted = true;
      return false;
    } finally {
      dropPending(ownerHistory, pending);
      token.pending = null;
      if (activeRequest === token) {
        activeRequest = null;
        window._copilotBusy = false;
        var button = safe(function () { return document.getElementById("copilotSendBtn"); }, null);
        if (button) { button.disabled = false; safe(function () { button.setAttribute("aria-busy", "false"); }); }
      }
      reconcile("copilot-finished");
      repaint();
      if (aborted && !token.reverted) safe(function () { if (isFn(window.toast)) window.toast("The patient or visit changed, so that Copilot answer was discarded.", ""); });
    }
  }

  guardedCopilotAsk.__mlsRequestSafety = true;
  guardedCopilotAsk.__mlsOrig = original;
  window.copilotAsk = guardedCopilotAsk;
  bindOwnerEvents();
  window[NS] = {
    installed: true,
    version: VERSION,
    capture: capture,
    stillCurrent: stillCurrent,
    revert: function () {
      if (activeRequest) {
        activeRequest.reverted = true;
        safe(function () { if (activeRequest.controller) activeRequest.controller.abort(); });
        dropPending(activeRequest.history, activeRequest.pending);
        activeRequest = null;
        safe(function () { window._copilotBusy = false; });
        var button = safe(function () { return document.getElementById("copilotSendBtn"); }, null);
        if (button) { button.disabled = false; safe(function () { button.setAttribute("aria-busy", "false"); }); }
        repaint();
      }
      unbindOwnerEvents();
      try { if (window.copilotAsk === guardedCopilotAsk) window.copilotAsk = original; } catch (e) {}
      try { window[NS].installed = false; } catch (e2) {}
      return true;
    }
  };
})();

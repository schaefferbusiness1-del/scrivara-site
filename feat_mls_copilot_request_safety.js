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
  var NS = "__mlsCopilotRequestSafety", VERSION = "crs-1.0.1";
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
  function capture() {
    reconcile("copilot-send");
    return { activeId: activeId(), ownerId: ownerId(), bindingId: bindingId(), epoch: bindingEpoch(), history: historyNow() };
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
    if (inp) { inp.value = ""; inp.style.height = "auto"; }
    ownerHistory.push({ role: "user", text: q });
    var pending = { role: "pending", requestOwner: token.ownerId, requestEpoch: token.epoch };
    ownerHistory.push(pending);
    repaint();
    var chips = safe(function () { return document.getElementById("copilotChips"); }, null);
    if (chips) chips.innerHTML = "";
    window._copilotBusy = true;
    var send = safe(function () { return document.getElementById("copilotSendBtn"); }, null);
    if (send) send.disabled = true;
    var aborted = false;

    try {
      try {
        if (isFn(window.loadCalendar) && (!Array.isArray(window._calAppts) || !window._calAppts.length)) await window.loadCalendar();
      } catch (e0) {}
      if (!stillCurrent(token)) { aborted = true; return false; }

      var hist = ownerHistory.filter(function (m) { return m && (m.role === "user" || m.role === "ai"); })
        .map(function (m) { return { role: m.role === "user" ? "user" : "ai", text: m.text }; });
      var context = isFn(window.copilotSnapshot) ? window.copilotSnapshot() : {};
      if (!stillCurrent(token)) { aborted = true; return false; }

      var response = await fetch(window.bkBase() + "/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + window.bkToken() },
        body: JSON.stringify({ question: q, context: context, history: hist.slice(0, -1) })
      });
      var data = await response.json().catch(function () { return {}; });
      if (!stillCurrent(token)) { aborted = true; return false; }

      dropPending(ownerHistory, pending);
      if (response.status === 403) ownerHistory.push({ role: "ai", text: "Copilot is available on clinician accounts." });
      else if (!response.ok) ownerHistory.push({ role: "ai", text: data.error || "Copilot had trouble answering. Try again." });
      else ownerHistory.push({ role: "ai", text: data.reply || "Done.", actions: data.actions || [], followups: data.followups || [], artifact: data.artifact || null });
      return true;
    } catch (e1) {
      if (stillCurrent(token)) {
        dropPending(ownerHistory, pending);
        ownerHistory.push({ role: "ai", text: "Network error reaching Copilot. Try again." });
      } else aborted = true;
      return false;
    } finally {
      dropPending(ownerHistory, pending);
      window._copilotBusy = false;
      var button = safe(function () { return document.getElementById("copilotSendBtn"); }, null);
      if (button) button.disabled = false;
      reconcile("copilot-finished");
      repaint();
      if (aborted) safe(function () { if (isFn(window.toast)) window.toast("The patient or visit changed, so that Copilot answer was discarded.", ""); });
    }
  }

  guardedCopilotAsk.__mlsRequestSafety = true;
  guardedCopilotAsk.__mlsOrig = original;
  window.copilotAsk = guardedCopilotAsk;
  window[NS] = {
    installed: true,
    version: VERSION,
    capture: capture,
    stillCurrent: stillCurrent,
    revert: function () {
      try { if (window.copilotAsk === guardedCopilotAsk) window.copilotAsk = original; } catch (e) {}
      try { window[NS].installed = false; } catch (e2) {}
      return true;
    }
  };
})();

/* feat_mls_portal_request_inbox.js -> window.__mlsPortalRequestInbox
 * prq-1.0.0: clinician review queue for requests submitted from the patient
 * portal. This is deliberately review-only: it never prescribes, approves,
 * signs, transmits to a pharmacy, touches Athena, or initiates a patient pull.
 * A chart can open only when the request's exact external id uniquely matches
 * the primary stable id of one locally stored patient. Ambiguity fails closed.
 */
;(function () {
  "use strict";
  if (window.__mlsPortalRequestInbox) return;

  var VERSION = "prq-1.0.0";
  var API = "https://scrivara-backend.onrender.com";
  var STYLE_ID = "mlsPrqStyle";
  var BUTTON_ID = "mlsPortalRequestInboxBtn";
  var BACK_ID = "mlsPrqBack";
  var retries = [];
  var activeStatus = "new";
  var lastRequests = [];
  var loadVersion = 0;
  var eventTypes = ["mls:ui-ready", "mls:topbar-ready", "mls:header-rendered"];

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function clean(value) {
    var text = value == null ? "" : String(value).trim();
    return (!text || /^(undefined|null)$/i.test(text)) ? "" : text;
  }
  function token() {
    return safe(function () {
      if (typeof window.bkToken === "function") return window.bkToken() || "";
      return localStorage.getItem("sf_bk_token") || sessionStorage.getItem("sf_bk_token") || "";
    }, "");
  }
  function primaryExternal(patient) {
    if (!patient || typeof patient !== "object") return "";
    return clean(patient.id) || clean(patient.athenaId) || clean(patient.mrn);
  }
  function exactPatient(externalId) {
    var id = clean(externalId);
    if (!id) return null;
    var patients = safe(function () { return window.getPatients && window.getPatients(); }, []);
    if (!Array.isArray(patients)) return null;
    var matches = patients.filter(function (patient) { return primaryExternal(patient) === id; });
    return matches.length === 1 ? matches[0] : null;
  }
  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    var auth = token();
    if (auth) headers.Authorization = "Bearer " + auth;
    return fetch(API + path, Object.assign({}, options, { headers: headers })).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (json) {
        return { ok: response.ok, status: response.status, json: json };
      });
    });
  }

  function style() {
    if (gid(STYLE_ID)) return;
    var node = document.createElement("style");
    node.id = STYLE_ID;
    node.textContent =
      "#" + BUTTON_ID + ".mlsPrqFallback{border:1px solid #d7ded9;background:#fff;color:#204034;border-radius:10px;padding:8px 12px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}" +
      "#" + BUTTON_ID + " .mlsPrqCount{display:none;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#9f2d2d;color:#fff;font-size:11px;align-items:center;justify-content:center}" +
      "#" + BUTTON_ID + " .mlsPrqCount.on{display:inline-flex}" +
      ".mlsPrqBack{position:fixed;inset:0;z-index:2147483000;background:rgba(20,33,28,.55);display:flex;align-items:center;justify-content:center;padding:16px}" +
      ".mlsPrqPanel{width:min(760px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(20,33,28,.32);padding:22px;color:#1A211C;font-family:'Public Sans',system-ui,-apple-system,'Segoe UI',sans-serif}" +
      ".mlsPrqHead{display:flex;gap:16px;justify-content:space-between;align-items:flex-start}.mlsPrqHead h2{font:700 21px/1.2 'Newsreader',Georgia,serif;color:#204034;margin:0 0 4px}.mlsPrqSub{font-size:13px;color:#55605A;max-width:610px}" +
      ".mlsPrqClose{border:1px solid #E7E5DD;background:#F4F2EC;color:#204034;border-radius:9px;padding:8px 11px;font-weight:700;cursor:pointer}" +
      ".mlsPrqFilters{display:flex;gap:7px;margin:16px 0 12px}.mlsPrqFilter{border:1px solid #d7ded9;background:#fff;color:#204034;border-radius:999px;padding:7px 12px;font-weight:700;cursor:pointer}.mlsPrqFilter.on{background:#204034;color:#fff}" +
      ".mlsPrqNotice{border-radius:10px;padding:10px 12px;font-size:13px;background:#FCF8EF;border:1px solid #EFE4CE;color:#845d2d}" +
      ".mlsPrqList{display:grid;gap:10px}.mlsPrqCard{border:1px solid #E7E5DD;border-radius:12px;padding:13px;background:#FCFBF8}.mlsPrqTitle{font-weight:800;color:#204034}.mlsPrqMeta{font-size:12px;color:#69736d;margin-top:2px}.mlsPrqDetails{display:grid;gap:5px;margin:10px 0;font-size:13px}.mlsPrqDetail{display:grid;grid-template-columns:minmax(110px,150px) 1fr;gap:8px}.mlsPrqDetail b{color:#55605A}.mlsPrqActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.mlsPrqAction{border:1px solid #cbd8d0;background:#EAF1EE;color:#204034;border-radius:9px;padding:8px 11px;font-weight:750;cursor:pointer}.mlsPrqAction.primary{border-color:#204034;background:#204034;color:#fff}.mlsPrqAction[disabled]{opacity:.6;cursor:default}" +
      "@media(max-width:600px){.mlsPrqPanel{padding:17px}.mlsPrqDetail{grid-template-columns:1fr;gap:1px}.mlsPrqAction{min-height:44px}.mlsPrqHead h2{font-size:19px}}";
    (document.head || document.documentElement).appendChild(node);
  }

  function buttonMarkup(button) {
    button.innerHTML = '<span aria-hidden="true">&#9993;</span><span>Portal requests</span><span class="mlsPrqCount" aria-label="new requests"></span>';
  }
  function ensureButton() {
    style();
    var existing = gid(BUTTON_ID);
    var menu = gid("mlsTbMenuPanel");
    var tools = safe(function () { return document.querySelector(".tools"); }, null);
    var host = menu || tools;
    if (!host) return false;
    if (!existing) {
      existing = document.createElement("button");
      existing.id = BUTTON_ID;
      existing.type = "button";
      existing.addEventListener("click", function (event) {
        event.preventDefault(); event.stopPropagation();
        safe(function () { if (window.__mlsTopbar) window.__mlsTopbar.closeMenu(); });
        open();
      });
      buttonMarkup(existing);
    }
    if (menu) {
      existing.className = "mlsTbItem";
      var settings = Array.prototype.find.call(menu.querySelectorAll("button"), function (node) {
        return /settings/i.test(node.textContent || "");
      });
      if (existing.parentNode !== menu || (settings && existing.nextSibling !== settings)) menu.insertBefore(existing, settings || null);
    } else if (existing.parentNode !== tools) {
      existing.className = "mlsPrqFallback";
      tools.appendChild(existing);
    }
    return true;
  }
  function setCount(count) {
    var badge = safe(function () { return gid(BUTTON_ID).querySelector(".mlsPrqCount"); }, null);
    if (!badge) return;
    var value = Math.max(0, Number(count) || 0);
    badge.textContent = value > 99 ? "99+" : String(value);
    badge.classList.toggle("on", value > 0);
  }

  function close() {
    var back = gid(BACK_ID);
    if (back && back.parentNode) back.parentNode.removeChild(back);
    document.removeEventListener("keydown", onKey, true);
  }
  function onKey(event) { if (event.key === "Escape") close(); }
  function make(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null) node.textContent = textValue;
    return node;
  }
  function formatDate(value) {
    return safe(function () {
      var date = new Date(value);
      return isNaN(date.getTime()) ? "" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    }, "");
  }
  function detailLabel(key) {
    return ({ medication: "Medication", pharmacy: "Pharmacy", note: "Note", reason: "Reason", timeOfDay: "Preferred time", urgency: "Urgency", procedure: "Procedure", lastDate: "Last date", question: "Question", message: "Message" })[key] || key;
  }
  function openExactPatient(patient) {
    var localId = clean(patient && patient.id);
    if (!localId) return;
    safe(function () { if (window.setActivePtId) window.setActivePtId(localId); });
    safe(function () { if (window.openPatient) window.openPatient(localId); else if (window.showView) window.showView("patients"); });
    close();
  }
  function markReviewed(request, button) {
    if (!request || !request.id) return;
    button.disabled = true; button.textContent = "Saving...";
    api("/api/patient/admin/requests/" + encodeURIComponent(request.id) + "/handled", { method: "POST", body: "{}" })
      .then(function (result) {
        if (!result.ok) throw result;
        return load(activeStatus);
      }).catch(function () { button.disabled = false; button.textContent = "Mark reviewed"; showNotice("Could not update this request. Nothing else was changed.", true); });
  }
  function renderCard(request) {
    var card = make("article", "mlsPrqCard");
    var patient = exactPatient(request.patient_external_id);
    card.appendChild(make("div", "mlsPrqTitle", (request.category || "Portal request") + " - " + (patient ? (patient.name || "Exact patient") : "Patient not linked on this device")));
    var metaText = (request.ref || "No reference") + (formatDate(request.created_at) ? " | " + formatDate(request.created_at) : "") + " | " + (request.status === "handled" ? "Reviewed" : "Needs review");
    card.appendChild(make("div", "mlsPrqMeta", metaText));
    var details = make("div", "mlsPrqDetails");
    var data = request.data && typeof request.data === "object" ? request.data : {};
    Object.keys(data).filter(function (key) { return key !== "submittedAt" && clean(data[key]); }).forEach(function (key) {
      var row = make("div", "mlsPrqDetail");
      row.appendChild(make("b", "", detailLabel(key)));
      row.appendChild(make("span", "", clean(data[key])));
      details.appendChild(row);
    });
    if (!details.childNodes.length) details.appendChild(make("div", "mlsPrqMeta", "Request details are unavailable; use the reference when following up."));
    card.appendChild(details);
    var emailText = request.notification && request.notification.delivered ? "Doctor email sent" : "Office queue received; email not confirmed";
    card.appendChild(make("div", "mlsPrqMeta", emailText + ". This remains a clinician-review request only."));
    var actions = make("div", "mlsPrqActions");
    if (patient && clean(patient.id)) {
      var chart = make("button", "mlsPrqAction", "Open exact patient chart"); chart.type = "button";
      chart.addEventListener("click", function () { openExactPatient(patient); }); actions.appendChild(chart);
    } else {
      var unlinked = make("button", "mlsPrqAction", "Chart link unavailable"); unlinked.type = "button"; unlinked.disabled = true; actions.appendChild(unlinked);
    }
    if (request.status !== "handled") {
      var reviewed = make("button", "mlsPrqAction primary", "Mark reviewed"); reviewed.type = "button";
      reviewed.addEventListener("click", function () { markReviewed(request, reviewed); }); actions.appendChild(reviewed);
    }
    card.appendChild(actions);
    return card;
  }
  function showNotice(message, warning) {
    var notice = gid("mlsPrqNotice");
    if (!notice) return;
    notice.textContent = message || "";
    notice.style.display = message ? "block" : "none";
    notice.style.color = warning ? "#9f2d2d" : "#845d2d";
  }
  function render(requests) {
    var list = gid("mlsPrqList"); if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    lastRequests = Array.isArray(requests) ? requests : [];
    if (!lastRequests.length) {
      list.appendChild(make("div", "mlsPrqNotice", activeStatus === "new" ? "No new portal requests." : "No requests in this view."));
      return;
    }
    lastRequests.forEach(function (request) { list.appendChild(renderCard(request)); });
  }
  function load(status) {
    var version = ++loadVersion;
    activeStatus = status || "new";
    var list = gid("mlsPrqList"); if (list) list.textContent = "Loading portal requests...";
    showNotice("", false);
    Array.prototype.forEach.call(document.querySelectorAll(".mlsPrqFilter"), function (button) {
      button.classList.toggle("on", button.getAttribute("data-status") === activeStatus);
    });
    var query = activeStatus === "all" ? "" : "?status=" + encodeURIComponent(activeStatus);
    return api("/api/patient/admin/requests" + query).then(function (result) {
      if (!result.ok) {
        var error = new Error("request_failed"); error.status = result.status; throw error;
      }
      var requests = result.json && Array.isArray(result.json.requests) ? result.json.requests : [];
      if (version !== loadVersion) return [];
      render(requests);
      if (activeStatus === "new") setCount(requests.length);
      return requests;
    }).catch(function (error) {
      if (version !== loadVersion) return [];
      var failedList = gid("mlsPrqList");
      if (failedList) while (failedList.firstChild) failedList.removeChild(failedList.firstChild);
      lastRequests = [];
      showNotice(error && (error.status === 401 || error.status === 403) ? "Sign in with an authorized clinician account to review portal requests." : "Portal requests could not load. Try again; no request was changed.", true);
      return [];
    });
  }
  function open() {
    close(); style();
    var back = make("div", "mlsPrqBack"); back.id = BACK_ID;
    var panel = make("section", "mlsPrqPanel"); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-labelledby", "mlsPrqTitle");
    var head = make("div", "mlsPrqHead");
    var copy = make("div"); var title = make("h2", "", "Patient portal requests"); title.id = "mlsPrqTitle"; copy.appendChild(title);
    copy.appendChild(make("div", "mlsPrqSub", "Requests are tied to the patient's portal history and require clinician review. Reviewing one does not prescribe, approve, sign, send to a pharmacy, or write to Athena."));
    var closeButton = make("button", "mlsPrqClose", "Close"); closeButton.type = "button"; closeButton.addEventListener("click", close);
    head.appendChild(copy); head.appendChild(closeButton); panel.appendChild(head);
    var filters = make("div", "mlsPrqFilters");
    [["new", "New"], ["handled", "Reviewed"], ["all", "All"]].forEach(function (entry) {
      var filter = make("button", "mlsPrqFilter", entry[1]); filter.type = "button"; filter.setAttribute("data-status", entry[0]);
      filter.addEventListener("click", function () { load(entry[0]); }); filters.appendChild(filter);
    });
    panel.appendChild(filters);
    var notice = make("div", "mlsPrqNotice"); notice.id = "mlsPrqNotice"; notice.style.display = "none"; panel.appendChild(notice);
    var list = make("div", "mlsPrqList"); list.id = "mlsPrqList"; panel.appendChild(list);
    back.appendChild(panel); document.body.appendChild(back);
    back.addEventListener("click", function (event) { if (event.target === back) close(); });
    document.addEventListener("keydown", onKey, true);
    load("new");
  }

  function scheduleEnsure() {
    [0, 160, 420, 900, 1800, 3200].forEach(function (delay) {
      retries.push(setTimeout(ensureButton, delay));
    });
  }
  function revert() {
    retries.forEach(clearTimeout); retries = [];
    eventTypes.forEach(function (type) { window.removeEventListener(type, scheduleEnsure); });
    close();
    var button = gid(BUTTON_ID); if (button && button.parentNode) button.parentNode.removeChild(button);
    var styleNode = gid(STYLE_ID); if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode);
    delete window.__mlsPortalRequestInbox;
    return true;
  }

  window.__mlsPortalRequestInbox = {
    installed: true, version: VERSION, open: open, close: close, refresh: function () { return load(activeStatus); },
    exactPatient: exactPatient, requests: function () { return lastRequests.slice(); }, revert: revert
  };
  style();
  eventTypes.forEach(function (type) { window.addEventListener(type, scheduleEnsure); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleEnsure, { once: true });
  else scheduleEnsure();
})();

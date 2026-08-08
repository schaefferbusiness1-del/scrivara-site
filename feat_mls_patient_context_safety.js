/* feat_mls_patient_context_safety.js  ->  window.__mlsPtCtxSafety  (pcs-1.2.0)  [Task 6]
 *
 * PATIENT-SCOPES the shared Copilot / AI Studio conversation so one patient's
 * chat can never bleed into another patient's context, and surfaces an identity
 * confirmation by DOB/ID (never name alone).
 *
 * WHY THIS EXISTS
 *   The app already isolates the VISIT ENGINE per patient on a switch:
 *     - __mlsOpenSwitchFix  (preserve draft -> newVisit + prefill on switch)
 *     - __mlsVisitSessionStash (per-patient editor snapshot/restore)
 *   and both AI *context* builders are id-based + rebuilt per call, so they follow
 *   the active patient:
 *     - copilotSnapshot()      (Copilot/Studio context)  reads activePatient()
 *     - buildPatientContext()  (note generation)         reads activePatient()
 *   BUT the Copilot CONVERSATION HISTORY is NOT patient-scoped. `_copilotHistory`
 *   (and, after Task 2, the unified store __mlsCopilotConvo shared by BOTH the AI
 *   Studio thread and the floating "MLS Assistant" panel) persists across a patient
 *   switch. So after switching A -> B, the history sent to /api/copilot still holds
 *   patient A's turns while the context is patient B's => cross-patient bleed.
 *   `copilotReset()` exists but is only wired to the manual "New chat" button.
 *
 * WHAT THIS DOES
 *   1. Tracks which patient the loaded conversation belongs to (convoOwnerId).
 *   2. Keeps a per-patient conversation bucket (defensively tagged with its owner id;
 *      fail-closed to EMPTY if a bucket's tag ever mismatches -> never wrong-patient).
 *   3. On any active-patient change, reconcile(): stash the outgoing conversation
 *      under ITS owner, then load the incoming patient's bucket (or empty). The store
 *      is REPLACED wholesale, never merged -> no bleed by construction.
 *   4. Propagates the swap through Task 2's wrapped `_copilotRenderThread()` so BOTH
 *      surfaces (Studio thread + floating panel) repaint the correct conversation.
 *   5. Surfaces an identity-confirmation chip (name + DOB + patient id) on the Copilot
 *      card so the clinician confirms WHO by DOB/ID, not name; exposes
 *      verifyActiveIdentity(expected) for id/DOB matching.
 *
 * DESIGN CHOICES (safety-first)
 *   - OBSERVATION, not wrapping: two modules already wrap setActivePtId/selectPatient
 *     (order-dependence is the audit's R2 concern). This module adds NO third wrapper.
 *     It follows the canonical mls:active-patient-changed event plus a pre-typing
 *     focus guard (closes the switch->type window deterministically).
 *   - Builds ON the Task 2 store (__mlsCopilotConvo) and the base globals
 *     (_copilotHistory / _copilotRenderThread / _copilotSaveHist); it is NOT a
 *     competing context system. Degrades gracefully if Task 2 is absent (still
 *     isolates the base _copilotHistory the Studio thread uses).
 *   - The storage listener is exact-key filtered to the current account's activePt
 *     key, so a cross-tab switch is seen without reacting to unrelated storage work.
 *
 * SAFETY: app-side only. Never touches the Chrome extension, never reads/writes/
 *   navigates/focuses athenaOne, never signs anyone out, no PHI logged. Additive,
 *   reversible (.revert()), ASCII-only, try/catch throughout, idempotent.
 *   Staging-gated exactly like the Copilot surfaces it augments (Task 2).
 *
 * PUBLIC (window.__mlsPtCtxSafety): installed, version, reconcile(), activeId(),
 *   owner(), verifyActiveIdentity(expected)->{match,byId,byDob,active,expected},
 *   buckets()->summary, revert(), _diag().
 */
;(function () {
  "use strict";
  var NS = "__mlsPtCtxSafety", VERSION = "pcs-1.2.0";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  /* ---- self-gate: identical to Task 2 / the Copilot surfaces ---- */
  function gateOn() {
    try {
      if (/(^|\.)mlsscribe\.com$/i.test(location.hostname)) return true; /* PROD ENABLE - 2026-07-11 final integration sweep (was staging-gated) */
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window[NS] = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function norm(id) { return (id === null || id === undefined) ? "" : String(id); }

  /* ---- base + Task-2 accessors ---- */
  function baseHist() {
    try { if (!Array.isArray(window._copilotHistory)) window._copilotHistory = []; return window._copilotHistory; }
    catch (e) { return []; }
  }
  function convoStore() { try { var c = window.__mlsCopilotConvo; return (c && isFn(c.append)) ? c : null; } catch (e) { return null; } }
  function activeIdSafe() { return safe(function () { return isFn(window.getActivePtId) ? norm(window.getActivePtId()) : ""; }, ""); }
  function activePt() { return safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null); }
  function findPt(id) { return safe(function () { return isFn(window.findPatient) ? window.findPatient(norm(id)) : null; }, null); }
  function renderThread() { safe(function () { if (isFn(window._copilotRenderThread)) window._copilotRenderThread(); }); }
  function saveHist() { safe(function () { if (isFn(window._copilotSaveHist)) window._copilotSaveHist(); }); }
  function renderChips() { safe(function () { if (isFn(window._copilotRenderChips)) window._copilotRenderChips(); }); }
  function unsKey(k) { return safe(function () { return isFn(window.uns) ? window.uns(k) : null; }, null); }
  /* The conversation ARRAY must switch synchronously so a same-stack request
     can never see the prior patient's turns. Its two DOM mirrors cannot paint
     until the browser yields anyway, so coalesce those mirrors into the next
     animation frame. This removes a large forced repaint from the patient-
     selection task without weakening the ownership boundary. */
  var conversationFrame = 0;
  function flushConversationUi() {
    conversationFrame = 0;
    renderThread();
    renderChips();
  }
  function scheduleConversationUi() {
    if (conversationFrame) return;
    if (isFn(window.setTimeout)) {
      /* A timer is a separate browser task; unlike rAF it cannot be combined
         with every other presentation owner's callback into one long frame. */
      conversationFrame = window.setTimeout(flushConversationUi, 0);
    } else flushConversationUi();
  }
  function cancelConversationUi() {
    if (!conversationFrame) return;
    safe(function () { if (isFn(window.clearTimeout)) window.clearTimeout(conversationFrame); });
    conversationFrame = 0;
  }

  /* only the real, sendable turns (never a transient pending bubble) */
  function realTurns(arr) {
    return (arr || []).filter(function (m) { return m && (m.role === "user" || m.role === "ai"); })
                      .map(function (m) { var o = {}; for (var k in m) { if (m.hasOwnProperty(k)) o[k] = m[k]; } return o; });
  }

  /* =================================================================
   * per-patient conversation buckets
   *   key   = ownerKey(id)  ('pt:<id>'  or  '_none_' for practice-level)
   *   value = { ownerId: <normalized id>, msgs: [ ...real turns... ] }
   * A bucket whose ownerId tag does not match the requested owner is treated as
   * EMPTY (fail-closed) -- a corrupted/mis-keyed bucket can never surface for the
   * wrong patient.
   * ================================================================= */
  var BUCKETS_KEY = null;
  var OWNER_KEY = null;
  var buckets = {};
  var convoOwnerId = null;      /* whom the currently-loaded conversation belongs to (null = unknown) */
  var restoring = false;

  function refreshStorageKeys() {
    BUCKETS_KEY = unsKey("copilotHistByPt");
    OWNER_KEY = unsKey("copilotConvoOwner");
  }
  refreshStorageKeys();

  function ownerKey(id) { id = norm(id); return id ? ("pt:" + id) : "_none_"; }

  function loadPersisted() {
    buckets = {};
    safe(function () {
      if (BUCKETS_KEY) { var raw = localStorage.getItem(BUCKETS_KEY); if (raw) { var o = JSON.parse(raw); if (o && typeof o === "object") buckets = o; } }
    });
    return safe(function () { return OWNER_KEY ? localStorage.getItem(OWNER_KEY) : null; }, null);
  }
  function persist() {
    safe(function () { if (BUCKETS_KEY) localStorage.setItem(BUCKETS_KEY, JSON.stringify(buckets)); });
    safe(function () { if (OWNER_KEY) { if (convoOwnerId === null) localStorage.removeItem(OWNER_KEY); else localStorage.setItem(OWNER_KEY, norm(convoOwnerId)); } });
  }

  function stashCurrentInto(ownerId) {
    /* snapshot the loaded conversation under ownerId (its true owner) */
    var msgs = realTurns(baseHist());
    var key = ownerKey(ownerId);
    if (msgs.length) { buckets[key] = { ownerId: norm(ownerId), msgs: msgs }; }
    else { if (buckets[key]) delete buckets[key]; } /* drop empty so a blank switch-away doesn't linger */
  }

  function bucketFor(ownerId) {
    var key = ownerKey(ownerId), entry = buckets[key];
    /* fail-closed: only return turns whose stored owner tag matches this exact owner */
    if (entry && entry.ownerId === norm(ownerId) && Array.isArray(entry.msgs)) return entry.msgs.slice();
    return [];
  }

  function loadInto(ownerId) {
    /* REPLACE the shared conversation wholesale with ownerId's bucket (or empty),
       then propagate through the base render (Task 2 wraps it -> both surfaces). */
    var msgs = bucketFor(ownerId);
    var h = baseHist();
    h.length = 0;
    for (var i = 0; i < msgs.length; i++) h.push(msgs[i]);
    saveHist();       /* keep Task 2's single-key cache aligned to the loaded convo */
    scheduleConversationUi(); /* Task 2 mirrors both surfaces before next paint */
  }

  var api = { switches: 0, stashes: 0, deferrals: 0 };

  /* A Copilot request in flight (either surface) shows a transient {role:'pending'}
     bubble and BOTH surfaces block new sends until it clears. If we swapped the
     conversation mid-flight, copilotAsk/aiAsk would push the reply (about the OLD
     patient) into the NEW patient's loaded thread -> bleed. So while a pending
     exists we DEFER the swap; the reply lands in the initiating patient's thread,
     then the next tick swaps. Bounded by DEFER_CAP_MS so a hung request can't pin
     the conversation forever. */
  function hasPending() { return safe(function () { return baseHist().some(function (m) { return m && m.role === "pending"; }); }, false); }
  var DEFER_CAP_MS = 30000;
  var deferredSince = 0;
  var deferredTimer = null;

  function cancelDeferred() {
    if (deferredTimer) { safe(function () { clearTimeout(deferredTimer); }); deferredTimer = null; }
  }
  function armDeferred() {
    if (deferredTimer) return;
    deferredTimer = setTimeout(function () {
      deferredTimer = null;
      safe(function () { reconcile("pending-settle"); });
    }, 600);
  }

  function reconcile(reason) {
    if (restoring) return "busy";
    var cur = activeIdSafe();
    if (convoOwnerId === null) {
      /* first observation: adopt whatever is loaded as belonging to the current patient */
      convoOwnerId = cur;
      if (baseHist().length && !buckets[ownerKey(cur)]) stashCurrentInto(cur);
      cancelDeferred();
      persist(); updateIdentityChip(); return "adopt";
    }
    if (cur === convoOwnerId) { deferredSince = 0; cancelDeferred(); updateIdentityChip(); return "same"; }
    /* owner change pending: defer while a request is completing (unless it hangs) */
    if (hasPending()) {
      if (!deferredSince) deferredSince = nowMs();
      if (nowMs() - deferredSince < DEFER_CAP_MS) { api.deferrals++; armDeferred(); updateIdentityChip(); return "deferred"; }
    }
    deferredSince = 0;
    cancelDeferred();
    restoring = true;
    try {
      stashCurrentInto(convoOwnerId);   /* save OUTGOING under its owner (never `cur`) */
      convoOwnerId = cur;
      loadInto(cur);                    /* load INCOMING patient's isolated bucket */
      api.switches++;
      persist();
    } finally { restoring = false; }
    updateIdentityChip();
    return "switched";
  }
  function nowMs() { return safe(function () { return Date.now(); }, 0); }

  /* =================================================================
   * identity confirmation (never name alone)
   * ================================================================= */
  function verifyActiveIdentity(expected) {
    expected = expected || {};
    var p = activePt();
    var active = p ? { id: norm(p.id), name: String(p.name || ""), dob: String(p.dob || "") } : null;
    var exId = norm(expected.id), exDob = String(expected.dob || "");
    var byId = !!(active && exId && active.id === exId);
    var byDob = !!(active && exDob && active.dob === exDob);
    /* a confident match requires the reliable id; DOB corroborates. Name is NEVER
       sufficient on its own and is not used to assert a match here. */
    var match = byId && (!exDob || byDob);
    return { match: match, byId: byId, byDob: byDob, active: active, expected: { id: exId, dob: exDob, name: String(expected.name || "") } };
  }

  var CHIP_ID = "mlsPtCtxIdentity", CHIP_STYLE_ID = "mlsPtCtxStyle";
  function injectChipStyle() {
    safe(function () {
      if (document.getElementById(CHIP_STYLE_ID)) return;
      var css = ".mls-idchip{margin:0 0 8px;padding:6px 11px;border-radius:9px;border:1px solid #cfe0d0;" +
        "background:#f1f8f2;color:#2f5d3a;font:600 12px/1.35 'Plus Jakarta Sans',system-ui,sans-serif;" +
        "display:flex;gap:8px;align-items:center;flex-wrap:wrap;}" +
        ".mls-idchip .k{opacity:.7;font-weight:600;}" +
        ".mls-idchip .v{font-weight:700;}";
      var s = document.createElement("style"); s.id = CHIP_STYLE_ID; s.type = "text/css";
      s.appendChild(document.createTextNode(css));
      (document.head || document.documentElement).appendChild(s);
    });
  }
  function updateIdentityChip() {
    safe(function () {
      var thread = document.getElementById("copilotThread");
      if (!thread || !thread.parentNode) return;
      /* label WHOSE conversation is loaded (convoOwnerId), not the live active
         patient -- so during the in-flight defer window the chip stays on the
         patient whose answer is arriving, never contradicting the thread. In
         steady state convoOwnerId === the active patient, so they agree. */
      var p = (convoOwnerId ? findPt(convoOwnerId) : null);
      var existing = document.getElementById(CHIP_ID);
      if (!p) { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); return; } /* Task 2's no-patient hint covers the no-patient case */
      injectChipStyle();
      var dob = String(p.dob || "").trim(), id = norm(p.id), name = String(p.name || "").trim();
      var html = '<span>&#128100;</span>' +
                 '<span class="v">' + esc(name || "(unnamed)") + '</span>' +
                 (dob ? '<span class="k">DOB</span><span class="v">' + esc(dob) + '</span>' : '<span class="k">DOB unknown</span>') +
                 (id ? '<span class="k">ID</span><span class="v">' + esc(id) + '</span>' : '');
      if (!existing) { existing = document.createElement("div"); existing.id = CHIP_ID; existing.className = "mls-idchip"; thread.parentNode.insertBefore(existing, thread); }
      if (existing.getAttribute("data-k") !== (name + "|" + dob + "|" + id)) { existing.innerHTML = html; existing.setAttribute("data-k", name + "|" + dob + "|" + id); }
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function removeChip() {
    safe(function () { [CHIP_ID, CHIP_STYLE_ID].forEach(function (idv) { var n = document.getElementById(idv); if (n && n.parentNode) n.parentNode.removeChild(n); }); });
  }

  function resetForSession(ev) {
    cancelDeferred();
    deferredSince = 0;
    /* Persist only through the keys captured for the outgoing account. The
       session event fires after the next namespace is adopted, so recomputing
       first would write the outgoing conversation into the incoming account. */
    if (convoOwnerId !== null) { safe(function () { stashCurrentInto(convoOwnerId); persist(); }); }
    var h = baseHist(); h.length = 0;
    buckets = {};
    convoOwnerId = null;
    var detail = ev && ev.detail;
    var nextAccount = detail && Object.prototype.hasOwnProperty.call(detail, "nextAccount")
      ? norm(detail.nextAccount)
      : safe(function () { return norm(window.__mlsSessionAccount); }, "");
    if (!nextAccount) {
      BUCKETS_KEY = null;
      OWNER_KEY = null;
      renderThread(); renderChips(); removeChip();
      return "cleared";
    }
    refreshStorageKeys();
    var persistedOwner = loadPersisted();
    if (persistedOwner !== null && persistedOwner !== undefined) {
      convoOwnerId = norm(persistedOwner);
      loadInto(convoOwnerId);
    }
    return reconcile("session-boundary");
  }

  /* =================================================================
   * triggers: exact patient/session/storage events + pre-typing focus guard
   * ================================================================= */
  var focusCap = null, activeCap = null, storageCap = null, sessionCap = null;
  function isCopilotInput(el) {
    return safe(function () {
      if (!el) return false;
      if (el.id === "copilotInput") return true;
      var panel = document.getElementById("mlsAsstPanel");
      if (panel && panel.contains(el) && /textarea|input/i.test(el.tagName || "")) return true;
      var card = document.getElementById("copilotCard");
      if (card && card.contains(el) && /textarea|input/i.test(el.tagName || "")) return true;
      return false;
    }, false);
  }
  function startTriggers() {
    stopTriggers();
    activeCap = function () { safe(function () { reconcile("active-patient"); }); };
    storageCap = function (ev) {
      if (!ev || ev.key !== unsKey("activePt")) return;
      safe(function () { if (ev.storageArea && ev.storageArea !== window.localStorage) return; reconcile("storage"); });
    };
    sessionCap = function (ev) { safe(function () { resetForSession(ev); }); };
    focusCap = function (ev) { if (isCopilotInput(ev && ev.target)) safe(function () { reconcile("focus"); }); };
    safe(function () { window.addEventListener("mls:active-patient-changed", activeCap); });
    safe(function () { window.addEventListener("storage", storageCap); });
    safe(function () { window.addEventListener("mls:session-boundary", sessionCap); });
    safe(function () { document.addEventListener("focusin", focusCap, true); });
  }
  function stopTriggers() {
    cancelDeferred();
    cancelConversationUi();
    if (activeCap) { safe(function () { window.removeEventListener("mls:active-patient-changed", activeCap); }); activeCap = null; }
    if (storageCap) { safe(function () { window.removeEventListener("storage", storageCap); }); storageCap = null; }
    if (sessionCap) { safe(function () { window.removeEventListener("mls:session-boundary", sessionCap); }); sessionCap = null; }
    if (focusCap) { safe(function () { document.removeEventListener("focusin", focusCap, true); }); focusCap = null; }
  }

  /* =================================================================
   * boot
   * ================================================================= */
  function boot() {
    var persistedOwner = loadPersisted();
    /* On load Task 2's _copilotLoadHist may have restored the single-key conversation
       into _copilotHistory. Attribute it to its persisted owner, then reconcile to the
       ACTUAL active patient so a refresh landing on a different/no patient can't show
       the previous patient's conversation. */
    if (persistedOwner !== null && persistedOwner !== undefined) {
      convoOwnerId = norm(persistedOwner);
      if (baseHist().length && !buckets[ownerKey(convoOwnerId)]) stashCurrentInto(convoOwnerId);
    } else {
      convoOwnerId = null; /* reconcile() adopts the current patient below */
    }
    reconcile("boot");
    startTriggers();
  }

  function revert() {
    stopTriggers();
    removeChip();
    safe(function () { persist(); });
    try { window[NS].installed = false; } catch (e) {}
  }

  window[NS] = {
    installed: true,
    version: VERSION,
    asset: "feat_mls_patient_context_safety.js",
    reconcile: function (r) { return reconcile(r || "manual"); },
    activeId: activeIdSafe,
    owner: function () { return convoOwnerId; },
    verifyActiveIdentity: verifyActiveIdentity,
    buckets: function () {
      var out = {};
      try { Object.keys(buckets).forEach(function (k) { out[k] = { ownerId: buckets[k].ownerId, n: (buckets[k].msgs || []).length }; }); } catch (e) {}
      return out;
    },
    revert: revert,
    _diag: function () {
      return {
        convoOwnerId: convoOwnerId, activeId: activeIdSafe(), restoring: restoring,
        loadedTurns: realTurns(baseHist()).length, switches: api.switches,
        hasStore: !!convoStore(), bucketKeys: safe(function () { return Object.keys(buckets); }, []),
        storageKey: BUCKETS_KEY || "", deferred: !!deferredTimer
      };
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { safe(boot); }, { once: true });
  else safe(boot);
})();

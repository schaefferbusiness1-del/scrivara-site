/* feat_visit_note_detail.js — MLS ScribeFlow
 * Make "open a past visit" render the polished §45 per-visit DETAIL card
 * (read view + inline edit + regenerate AI summary) INSTEAD of re-opening the
 * raw note editor (#viewModal).
 *
 * Root cause (briefing §46.7): the doctor's "past visits" are saved NOTES in the
 * health-history list, rendered as <div class="hist-item" onclick="openNoteFromHistory(id)">.
 * openNoteFromHistory(id) populates #viewTitle/#viewMeta/#viewBody and shows
 * #viewModal — i.e. the note editor. The §45 detail UI (__mlsVisitDetail) renders
 * from the SEPARATE __mlsVisitModel (empty for these patients) and never wraps the
 * note-click path. So clicking a past visit never reaches the detail card.
 *
 * This asset:
 *   1) Overrides the GLOBAL openNoteFromHistory(id) (inline onclick resolves the
 *      global at click time, so every history-item click is intercepted).
 *   2) Maps the clicked NOTE -> a §40 visit object built from the note's REAL
 *      content (date, type=cc, body -> structured fields via __mlsVisitModel
 *      ._normVisit; AI summary via the same OpenAI proxy path §45 uses). If the
 *      note already corresponds to a model visit (linked by _noteId or matching
 *      _visitKey) it renders THAT instead of building a new one. Nothing is
 *      fabricated — only the note's own text is structured.
 *   3) Renders the §45 detail card (reusing __mlsVisitDetail.buildRead/buildEdit/
 *      applyEdit/readForm) inside a self-contained modal, with INLINE EDIT and a
 *      working "✨ Regenerate AI summary" (correct __mlsVisitModel transport — not
 *      the §45 buildCard signature bug), plus a "📝 Edit raw note" escape hatch
 *      that opens the original editor (#viewModal) so nothing is lost.
 *   4) Also routes the 🗂 Visit history card click path (model visits) to the SAME
 *      modal, so the detail UI is consistent everywhere.
 *
 * Persistence is NON-DESTRUCTIVE: edits to a note-derived (in-memory) visit are
 * stored in a user-scoped localStorage overlay keyed by note id — the saved NOTE
 * and the patient's clinical record are never silently rewritten. Edits to a real
 * model visit persist through the app's own upsertPatient() (§45 semantics).
 *
 * Progressive enhancement only: own scope, try/catch, idempotent, fully reversible
 * (window.__mlsVisitNoteDetail.revert()). No backend / ScribeFlow.html / extension
 * edits. Loaded by a one-line guarded loader appended to mls-connect.js.
 */
(function () {
  "use strict";
  if (window.__mlsVisitNoteDetail && window.__mlsVisitNoteDetail.installed) return;

  var VERSION = "1.1.0";
  var isFn = function (f) { return typeof f === "function"; };
  var S = function (x) { return x == null ? "" : String(x); };

  /* ---------- dependencies (read live each call so load order is irrelevant) ---------- */
  function MODEL() { return window.__mlsVisitModel; }
  function DETAIL() { return window.__mlsVisitDetail; }
  function ready() {
    var M = MODEL(), D = DETAIL();
    return !!(M && isFn(M._normVisit) && D && isFn(D.buildRead) && isFn(D.buildEdit) &&
              isFn(D.applyEdit) && isFn(D.readForm));
  }

  /* ---------- non-destructive overlay store (user-scoped) ---------- */
  function storeKey() {
    try { return isFn(window.uns) ? window.uns("mlsNoteVisits") : "mlsNoteVisits"; }
    catch (e) { return "mlsNoteVisits"; }
  }
  function loadOverlay() {
    try { return JSON.parse(localStorage.getItem(storeKey()) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveOverlay(o) {
    try { localStorage.setItem(storeKey(), JSON.stringify(o)); return true; }
    catch (e) { return false; }
  }
  function getEdit(noteId) { var o = loadOverlay(); return o[noteId] || null; }
  function putEdit(noteId, data) { var o = loadOverlay(); o[noteId] = data; return saveOverlay(o); }

  /* ---------- note helpers ---------- */
  function getNote(id) {
    try { return (window.getNotes() || []).find(function (n) { return n && n.id === id; }) || null; }
    catch (e) { return null; }
  }
  function resolvePatient(note) {
    try { if (note && note.patientId && isFn(window.findPatient)) { var p = window.findPatient(note.patientId); if (p) return p; } } catch (e) {}
    try { if (isFn(window.activePatient)) return window.activePatient(); } catch (e) {}
    return null;
  }
  function codingTextOf(c) { try { return isFn(window.codingText) ? S(window.codingText(c)) : ""; } catch (e) { return ""; } }
  function ordersTextOf(o) { try { return (Array.isArray(o) && o.length && isFn(window.savedOrdersText)) ? S(window.savedOrdersText(o)) : ""; } catch (e) { return ""; } }
  function ymd(ts) { try { return ts ? new Date(ts).toISOString().slice(0, 10) : ""; } catch (e) { return ""; } }

  /* Assemble the REAL note body, mirroring the app's own openNoteFromHistory so
     the detail card reflects exactly what the editor would show. */
  function noteBody(n) {
    var isOp = (n.kind === "opnote") ||
      (n.text && !n.soap && !n.insurance && !n.coding &&
       /operative|op[\s-]?note|procedure performed|operation performed/i.test(S(n.cc) + " " + S(n.text).slice(0, 250)));
    var body = "";
    if (isOp) {
      body = n.text || n.soap || "";
    } else if (n.isDraft) {
      body = "[TRANSCRIPT DRAFT — no note generated yet]\n\n" + (n.transcript || n.text || "");
    } else {
      body = (n.soap || n.text || "");
      if (n.insurance) body += "\n\n— — — INSURANCE-READY — — —\n" + (n.insurance || "(none)");
      var ct = codingTextOf(n.coding); if (ct) body += ct;
      if (n.signLine) body += "\n\n" + n.signLine;
    }
    var ot = ordersTextOf(n.orders); if (ot) body += "\n\n— — — ORDERS — — —\n" + ot;
    return { body: body, isOp: isOp };
  }

  /* Map a NOTE -> a §40 visit object (in-memory unless already a model visit). */
  function visitFromNote(patient, note) {
    var M = MODEL();
    // 1) existing model visit already linked to this note
    if (patient && Array.isArray(patient.visits)) {
      var linked = patient.visits.find(function (v) { return v && v._noteId === note.id; });
      if (linked) return { visit: linked, inModel: true };
    }
    var nb = noteBody(note);
    var typeGuess = S(note.cc).trim() || (nb.isOp ? "Operative note" : (note.isDraft ? "Transcript draft" : "Office visit"));
    var base = M._normVisit({
      id: "note:" + note.id,
      date: ymd(note.updated || note.created),
      type: typeGuess,
      raw: nb.body
    }, "note");
    base._noteId = note.id;
    base.source = "note";
    // 2) de-dup: an existing model visit with the same signature -> link & use it
    if (patient && Array.isArray(patient.visits)) {
      try {
        var key = M._visitKey(base);
        var same = patient.visits.find(function (v) { return M._visitKey(v) === key; });
        if (same) { if (!same._noteId) same._noteId = note.id; return { visit: same, inModel: true }; }
      } catch (e) {}
    }
    // 3) merge any prior non-destructive edits for this note
    var ed = getEdit(note.id);
    if (ed && typeof ed === "object") {
      ["date", "type", "findings", "plan", "aiSummary"].forEach(function (k) { if (ed[k] != null) base[k] = ed[k]; });
      ["cpt", "icd10", "meds"].forEach(function (k) { if (Array.isArray(ed[k])) base[k] = ed[k].slice(); });
      if (ed.scores && typeof ed.scores === "object") base.scores = ed.scores;
    }
    return { visit: base, inModel: false };
  }

  /* Persist an edit/summary. Model visits -> upsertPatient; note visits -> overlay. */
  function persistVisit(patient, note, visit, inModel) {
    if (inModel) {
      try { if (isFn(window.upsertPatient)) { window.upsertPatient(patient); return true; } } catch (e) {}
      return false;
    }
    if (!note) return false;
    return putEdit(note.id, {
      date: visit.date, type: visit.type, cpt: visit.cpt, icd10: visit.icd10, meds: visit.meds,
      findings: visit.findings, plan: visit.plan, scores: visit.scores, aiSummary: visit.aiSummary
    });
  }

  /* Regenerate the AI summary using the SAME prompt + transport §45 intends —
     called with the correct argument shape (the §45 buildCard path passes the
     wrong order, so we do it ourselves). Never invents data: it summarizes raw. */
  function regenerateSummary(patient, visit) {
    var M = MODEL();
    if (!isFn(window.aiCallRaw) || !M) return Promise.reject(new Error("AI transport unavailable"));
    if (!S(visit.raw).trim() && !S(visit.findings).trim() && !(visit.cpt && visit.cpt.length)) {
      return Promise.reject(new Error("nothing to summarize"));
    }
    var sys = M._SUM_SYS || "Summarize this clinical visit factually; never invent codes, scores, or findings.";
    var user = isFn(M._visitToPrompt) ? M._visitToPrompt(visit, patient) : S(visit.raw);
    return Promise.resolve(window.aiCallRaw(sys, user, null, { freeform: true })).then(function (txt) { return S(txt).trim(); });
  }

  /* ---------- modal styling (scrim + container; card uses §45 .mlsvd-* tokens) ---------- */
  function injectStyle() {
    if (document.getElementById("mls-vnd-style")) return;
    var css = [
      ".mlsvnd-scrim{position:fixed;inset:0;background:rgba(15,28,46,.55);z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow:auto}",
      ".mlsvnd-modal{background:var(--card,#fff);color:var(--ink,#1A211C);border:1px solid var(--line,#E7E5DD);border-radius:16px;box-shadow:0 18px 60px rgba(15,28,46,.32);width:100%;max-width:760px;margin:auto 0;overflow:hidden}",
      ".mlsvnd-top{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line,#eef1f6);background:var(--soft,#FCFBF8)}",
      ".mlsvnd-ttl{font-weight:800;font-size:15px;color:var(--ink,#1A211C);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mlsvnd-sub{font-weight:600;font-size:12px;color:var(--muted,#68736B)}",
      ".mlsvnd-x{flex:0 0 auto;cursor:pointer;border:1px solid var(--line,#E7E5DD);background:#fff;color:var(--ink,#1A211C);border-radius:9px;font-size:16px;line-height:1;padding:6px 11px;font-weight:700}",
      ".mlsvnd-x:hover{background:var(--soft2,#EAF1EE)}",
      ".mlsvnd-modal button:focus-visible,.mlsvnd-modal input:focus-visible,.mlsvnd-modal textarea:focus-visible,.mlsvnd-modal select:focus-visible{outline:3px solid rgba(46,106,75,.42);outline-offset:2px}",
      ".mlsvnd-host{padding:6px 18px 18px;max-height:74vh;overflow:auto}",
      ".mlsvnd-host .mlsvd-body{border-top:none;padding-top:6px}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "mls-vnd-style";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function fmtDate(d) {
    try { return DETAIL() && isFn(DETAIL()._fmtDate) ? DETAIL()._fmtDate(d) : S(d); }
    catch (e) { return S(d); }
  }
  function sourceText(inModel, v) {
    if (!inModel) return "From saved note";
    return ({ "manual": "Manual entry", "manual-ai": "AI-structured", "mls-app": "Athena copy",
      "athena-copy": "Athena copy", "cohort-injection": "Injection cohort", "note": "From saved note" })[v.source] || "Visit";
  }

  var _openEl = null, _onKey = null, _returnFocus = null;
  function visibleFocusTarget(el) {
    try {
      if (!el || !el.isConnected || el.disabled) return false;
      var s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  }
  function focusables(root) {
    if (!root) return [];
    try {
      return [].slice.call(root.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])")).filter(visibleFocusTarget);
    } catch (e) { return []; }
  }
  function closeModal(restoreFocus) {
    var back = _returnFocus;
    if (_openEl && _openEl.parentNode) _openEl.parentNode.removeChild(_openEl);
    _openEl = null;
    if (_onKey) { document.removeEventListener("keydown", _onKey, true); _onKey = null; }
    _returnFocus = null;
    if (restoreFocus !== false && visibleFocusTarget(back)) {
      setTimeout(function () { try { back.focus({ preventScroll: true }); } catch (e) { try { back.focus(); } catch (_) {} } }, 0);
    }
  }

  function showModal(patient, note, visit, inModel) {
    injectStyle();
    var opener = document.activeElement;
    closeModal(false);
    _returnFocus = opener && opener !== document.body && opener !== document.documentElement ? opener : null;
    var D = DETAIL();

    var scrim = document.createElement("div");
    scrim.className = "mlsvnd-scrim";
    var modal = document.createElement("div");
    modal.className = "mlsvnd-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "mlsVndTitle");
    scrim.appendChild(modal);

    var top = document.createElement("div");
    top.className = "mlsvnd-top";
    var ttl = document.createElement("div");
    ttl.className = "mlsvnd-ttl";
    ttl.id = "mlsVndTitle";
    ttl.textContent = fmtDate(visit.date) + " · " + (visit.type || "Visit");
    var sub = document.createElement("span");
    sub.className = "mlsvnd-sub";
    sub.textContent = sourceText(inModel, visit);
    var x = document.createElement("button");
    x.className = "mlsvnd-x";
    x.setAttribute("aria-label", "Close saved visit detail");
    x.textContent = "✕";
    x.addEventListener("click", closeModal);
    top.appendChild(ttl);
    top.appendChild(sub);
    top.appendChild(x);
    modal.appendChild(top);

    var host = document.createElement("div");
    host.className = "mlsvnd-host";
    modal.appendChild(host);

    function renderRead(focusAction) {
      host.innerHTML = "";
      var r = D.buildRead(visit);
      host.appendChild(r.body);
      r.editBtn.addEventListener("click", function (e) { e.stopPropagation(); renderEdit(); });
      r.regenBtn.addEventListener("click", function (e) { e.stopPropagation(); doRegen(r.regenBtn, r.status); });
      // escape hatch: open the original raw-note editor (only when backed by a note)
      var acts = r.body.querySelector(".mlsvd-acts");
      if (acts && note) {
        var raw = document.createElement("button");
        raw.className = "mlsvd-btn";
        raw.textContent = "📝 Edit raw note";
        raw.addEventListener("click", function (e) {
          e.stopPropagation();
          closeModal(false);
          callOriginal(note.id);
        });
        acts.insertBefore(raw, acts.querySelector(".mlsvd-status") || null);
      }
      // refresh the header to reflect any edits
      ttl.textContent = fmtDate(visit.date) + " · " + (visit.type || "Visit");
      if (focusAction) setTimeout(function () { try { r.editBtn.focus({ preventScroll: true }); } catch (e) { try { r.editBtn.focus(); } catch (_) {} } }, 0);
    }

    function renderEdit() {
      host.innerHTML = "";
      var ed = D.buildEdit(visit);
      host.appendChild(ed.body);
      ed.cancelBtn.addEventListener("click", function (e) { e.stopPropagation(); renderRead(true); });
      ed.saveBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var parsed = D.readForm(ed.form);
        D.applyEdit(visit, parsed);
        var ok = persistVisit(patient, note, visit, inModel);
        ed.status.className = "mlsvd-status " + (ok ? "ok" : "err");
        ed.status.textContent = ok ? "Saved ✓" : "Not saved - nothing was written. Copy your changes before leaving this form.";
        /* vnd-1.0.0: persistVisit() returns false when the edit reached NOTHING -
           upsertPatient absent or throwing, or no note to overlay. Calling that
           "Saved locally (sync unavailable)" told the doctor their edit was safe
           on this device and only the cloud was behind. It was not saved anywhere.
           The 650ms auto-return then closed the form and took the text with it,
           so the one copy that existed was destroyed by the success animation.
           On failure the form now stays open so the edit can be copied out. */
        if (ok) setTimeout(function () { renderRead(true); }, 650);
      });
      setTimeout(function () {
        var first = focusables(ed.form || ed.body)[0];
        if (first) try { first.focus({ preventScroll: true }); } catch (e) { try { first.focus(); } catch (_) {} }
      }, 0);
    }

    function doRegen(btn, status) {
      btn.disabled = true;
      status.className = "mlsvd-status";
      status.textContent = "Generating…";
      regenerateSummary(patient, visit).then(function (txt) {
        if (txt) visit.aiSummary = txt;
        var okRegen = persistVisit(patient, note, visit, inModel);
        status.className = "mlsvd-status " + (okRegen ? "ok" : "err");
        status.textContent = "Updated ✓";
        /* vnd-1.0.0: same rule - the regenerated summary is in memory and on
           screen, but saying "Updated" when the write returned false claims a
           persistence that did not happen. */
        if (!okRegen) status.textContent = "Regenerated on screen but NOT saved - nothing was written.";
        btn.disabled = false;
        var ai = host.querySelector(".mlsvd-ai");
        if (ai) { ai.className = "mlsvd-ai"; ai.textContent = visit.aiSummary || ""; }
      }).catch(function (err) {
        btn.disabled = false;
        status.className = "mlsvd-status err";
        status.textContent = "Could not generate (" + (err && err.message ? err.message : "error") + ")";
      });
    }

    scrim.addEventListener("click", function (e) { if (e.target === scrim) closeModal(); });
    _onKey = function (e) {
      if (e.key === "Escape" || e.key === "Esc") {
        e.preventDefault(); e.stopImmediatePropagation(); closeModal(true); return;
      }
      if (e.key !== "Tab") return;
      var rows = focusables(modal);
      if (!rows.length) { e.preventDefault(); return; }
      var first = rows[0], last = rows[rows.length - 1], current = document.activeElement;
      if (e.shiftKey && (current === first || !modal.contains(current))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (current === last || !modal.contains(current))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", _onKey, true);

    (document.body || document.documentElement).appendChild(scrim);
    _openEl = scrim;
    renderRead();
    setTimeout(function () { try { x.focus({ preventScroll: true }); } catch (e) { try { x.focus(); } catch (_) {} } }, 0);
  }

  /* ---------- entry points ---------- */
  function openNoteDetail(id) {
    if (!ready()) return callOriginal(id);
    var note = getNote(id);
    if (!note) return callOriginal(id);
    var patient = resolvePatient(note);
    if (!patient) return callOriginal(id);
    var mapped = visitFromNote(patient, note);
    showModal(patient, note, mapped.visit, mapped.inModel);
  }

  function openModelVisit(patient, visit) {
    if (!ready() || !patient || !visit) return;
    showModal(patient, null, visit, true);
  }

  /* ---------- install: override openNoteFromHistory + delegate visit-history clicks ---------- */
  var _origONFH = null;
  function callOriginal(id) { try { if (isFn(_origONFH)) return _origONFH.call(window, id); } catch (e) {} }
  function chainHasNoteDetail(fn) {
    return !!(fn && (fn.__mlsNoteDetail === true || fn.__mlsContainsNoteDetail === true));
  }

  function wrapONFH() {
    if (!isFn(window.openNoteFromHistory)) return false;
    if (chainHasNoteDetail(window.openNoteFromHistory)) return true;
    /* Keep the first raw opener forever. A later wrapper (notably autosave)
       can close over this module's modern-detail wrapper. Replacing _origONFH
       with that later chain makes "Edit raw note" re-enter the modern modal
       instead of opening #viewModal. */
    if (!_origONFH) _origONFH = window.openNoteFromHistory;
    var wrapped = function (id) {
      try { return openNoteDetail(id); }
      catch (e) { return callOriginal(id); }
    };
    wrapped.__mlsNoteDetail = true;
    wrapped.__mlsOrig = _origONFH;
    window.openNoteFromHistory = wrapped;
    return true;
  }

  /* Capture-phase delegate so a click on a 🗂 Visit history card HEADER opens the
     same modal (consistent detail UI), instead of the inline toggle. Only the
     open gesture is intercepted; inner controls are untouched. */
  var _delegate = null;
  function installDelegate() {
    if (_delegate) return;
    _delegate = function (e) {
      try {
        var sec = document.getElementById("mlsVisitHistory");
        if (!sec || !sec.contains(e.target)) return;
        var head = e.target.closest && e.target.closest(".mlsvh-vh, .mlsvd-head");
        if (!head) return;
        var card = head.closest(".mlsvh-v, .mlsvd-card");
        if (!card) return;
        var vid = card.getAttribute("data-vid") || (card.dataset ? card.dataset.vid : "");
        var p = null;
        try { p = isFn(window.activePatient) ? window.activePatient() : null; } catch (er) {}
        var M = MODEL();
        if (!p || !M || !isFn(M.getVisits)) return;
        var v = (M.getVisits(p) || []).find(function (x) { return S(x.id) === S(vid); });
        if (!v) return;
        e.preventDefault();
        e.stopPropagation();
        openModelVisit(p, v);
      } catch (er) { /* never break native handling */ }
    };
    document.addEventListener("click", _delegate, true);
  }

  function install() {
    injectStyle();
    wrapONFH();
    installDelegate();
    // openNoteFromHistory may be (re)defined after us on some loads — keep trying briefly.
    var tries = 0;
    var iv = setInterval(function () {
      if (chainHasNoteDetail(window.openNoteFromHistory)) { clearInterval(iv); return; }
      wrapONFH();
      if (++tries > 80) clearInterval(iv);
    }, 125);
  }

  function revert() {
    try {
      if (window.openNoteFromHistory && window.openNoteFromHistory.__mlsNoteDetail && _origONFH) {
        window.openNoteFromHistory = _origONFH;
      }
      if (_delegate) { document.removeEventListener("click", _delegate, true); _delegate = null; }
      closeModal();
      var st = document.getElementById("mls-vnd-style");
      if (st) st.remove();
    } catch (e) {}
  }

  install();

  window.__mlsVisitNoteDetail = {
    installed: true,
    version: VERSION,
    openNoteDetail: openNoteDetail,
    openModelVisit: openModelVisit,
    visitFromNote: visitFromNote,
    noteBody: noteBody,
    regenerateSummary: regenerateSummary,
    _persistVisit: persistVisit,
    _getEdit: getEdit,
    _putEdit: putEdit,
    _storeKey: storeKey,
    revert: revert
  };
})();

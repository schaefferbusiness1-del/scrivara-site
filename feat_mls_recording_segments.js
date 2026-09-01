/* ============================================================================
 * feat_mls_recording_segments.js  ->  window.__mlsRecSegments   (rs-1.1.1)
 * ---------------------------------------------------------------------------
 * TASK 7 - MULTIPLE RECORDINGS for the MLS Easy / MLS Assist web app.
 *
 * Adds start/stop/resume of MULTIPLE labeled recording segments per visit, so
 * one encounter can hold: the doctor's dictation, a doctor-only ADDENDUM, a
 * STAFF history-taking recording, an IMAGING-REVIEW recording, and a
 * PROCEDURE-DISCUSSION recording -- each captured, labeled, kept separate, and
 * then COMBINED (any subset the doctor selects) to regenerate ONE note.
 *
 * WHY A SATELLITE (not a base-app edit): the base app keeps a single #transcript
 * buffer (startCapture/stopCapture APPEND into it; generateNote() reads it). This
 * module sits ON TOP of that: it slices each start->stop span out of #transcript
 * into a labeled segment, and to regenerate it simply concatenates the selected
 * segments back into #transcript and calls the EXISTING generateNote(). That
 * reuses the base pipeline verbatim -- including buildPatientContext() / the
 * active-patient chart binding -- so nothing about identity or generation
 * diverges from the vetted path.
 *
 * PATIENT SAFETY (hard requirements, enforced here):
 *   - Every segment is stamped AT RECORD TIME with the active patient's id + DOB
 *     + name, read from window.activePatient() -- the SAME active-patient source
 *     the Task-2 shared Copilot context (window.__mlsCopilotConvo.activePatient)
 *     reads. We do NOT invent a competing patient-context store.
 *   - The panel only ever shows / offers the CURRENT active patient's segments.
 *   - COMBINE/GENERATE refuses any segment whose patientId+DOB does not match the
 *     current active patient (identity by ID/DOB, never name alone) -> one
 *     patient's recording can never attach to another patient's note.
 *   - No orders, no Athena writes, no signing. Draft-only. Athena is not touched.
 *
 * Additive, reversible (window.__mlsRecSegments.revert()), idempotent, UTF-8
 * (emoji only in UI labels; serve with charset=utf-8), try/catch throughout.
 * No PHI is logged.
 *
 * STAGING-GATED to match the rest of the staged Copilot/feature work: installs
 * only on a staging page or when the staging marker script is present. Widen the
 * gate (or remove gateOn) at deploy time. NOT deployed by this task.
 * ==========================================================================*/
(function () {
  "use strict";
  var NS = "__mlsRecSegments";
  var VERSION = "rs-1.1.1";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  /* ---------- staging self-gate (same policy as feat_mls_asst_fix / copilot unify) ---------- */
  function gateOn() {
    try {
      if (/(^|\.)mlsscribe\.com$/i.test(location.hostname)) return true; /* PROD ENABLE - 2026-07-11 final integration sweep (was staging-gated) */
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
      if (window.__mlsForceRecSegments === true) return true; /* manual test/enable hook */
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window[NS] = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  /* ---------- tiny helpers ---------- */
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function nowMs() { return safe(function () { return Date.now(); }, 0); }
  function words(s) { return String(s || "").trim() ? String(s).trim().split(/\s+/).length : 0; }
  function uid() {
    return "seg" + nowMs().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }
  function nsKey(k) {
    return safe(function () { return isFn(window.uns) ? window.uns(k) : ("mls::" + k); }, "mls::" + k);
  }

  /* ---------- active patient (SHARED source of truth) ---------- */
  /* Prefer the Task-2 shared store's view of the active patient when present, so
   * recording context and Copilot context can never disagree; fall back to the
   * base app's activePatient()/getActivePtId(). Identity fields: id + dob + name. */
  function activePt() {
    var p = safe(function () {
      var conv = window.__mlsCopilotConvo;
      if (conv && isFn(conv.activePatient)) { var a = conv.activePatient(); if (a) return a; }
      return null;
    }, null);
    if (!p) p = safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null);
    if (!p) return null;
    return {
      id: String(p.id == null ? "" : p.id),
      name: String(p.name == null ? "" : p.name),
      dob: String(p.dob == null ? "" : p.dob)
    };
  }
  function activePtId() {
    var p = activePt();
    if (p && p.id) return p.id;
    return safe(function () { return isFn(window.getActivePtId) ? (window.getActivePtId() || "") : ""; }, "");
  }

  /* Two segments/patients are the SAME chart only if id matches AND (when both
   * have a DOB) the DOB matches too. Never match on name alone. An empty-id
   * (no active patient) segment matches only another empty-id in the same
   * no-patient session -- and combine still warns. */
  function sameChart(a, b) {
    if (!a || !b) return false;
    if (String(a.id || "") !== String(b.id || "")) return false;
    var da = String(a.dob || ""), db = String(b.dob || "");
    if (da && db && da !== db) return false;
    return true;
  }

  /* ---------- segment kinds ---------- */
  var KINDS = [
    { key: "visit",     label: "Doctor visit",         icon: "🩺" },
    { key: "addendum",  label: "Doctor addendum",      icon: "➕" },
    { key: "staff",     label: "Staff history",        icon: "📋" },
    { key: "imaging",   label: "Imaging review",       icon: "🦻" },
    { key: "procedure", label: "Procedure discussion", icon: "💉" }
  ];
  function kindOf(key) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].key === key) return KINDS[i]; return KINDS[0]; }

  /* ---------- persistence ---------- */
  var SEGMENTS = [];        /* all segments, all patients (filtered for display) */
  var selected = {};        /* id -> true (checkbox state for the current patient) */
  var armed = null;         /* {id, kind, boundaryLen, patientId} while a segment records */
  /* rs-1.1.0 (staff-system 2026-07-13): every segment carries WHO recorded it,
     so a doctor picking up a staff-started visit sees exactly who captured what */
  function whoAmI() {
    try { if (typeof bkUser !== 'undefined' && bkUser) return String(bkUser.name || bkUser.email || '').slice(0, 60); } catch (e) {}
    return '';
  }

  function load() {
    SEGMENTS = safe(function () {
      var raw = localStorage.getItem(nsKey("mlsRecSegments"));
      var a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    }, []) || [];
  }
  function persist() {
    safe(function () {
      /* keep it bounded; newest 200 across all patients */
      var keep = SEGMENTS.slice(-200);
      SEGMENTS = keep;
      localStorage.setItem(nsKey("mlsRecSegments"), JSON.stringify(keep));
    });
  }
  function segsForCurrent() {
    var p = activePt();
    var out = [];
    for (var i = 0; i < SEGMENTS.length; i++) {
      var s = SEGMENTS[i];
      if (p) { if (sameChart(p, { id: s.patientId, dob: s.patientDob })) out.push(s); }
      else { if (!s.patientId) out.push(s); } /* no active patient -> only unlinked segments */
    }
    return out;
  }

  /* ---------- transcript access (DOM-based; no base-lexical writes) ---------- */
  function transcriptEl() { return $("transcript"); }
  function transcriptVal() { var t = transcriptEl(); return t ? String(t.value || "") : ""; }
  function setTranscript(v) {
    var t = transcriptEl(); if (!t) return;
    t.value = v;
    safe(function () { t.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  function isCapturing() { /* base 'capturing' is a global-lexical; read bare, guarded */
    return safe(function () { return (typeof capturing !== "undefined") ? !!capturing : false; }, false);
  }

  /* ---------- record a segment ---------- */
  /* We do not replace the base recorder. We mark a boundary at segment start
   * (current #transcript length), let the base startCapture/stopCapture run, and
   * on stop we slice the newly-appended text as this segment's content. */
  /* revwork-1.0.0 (b1169): CONSENT PENDING IS NOT A FAILURE.
   *
   * The base startCapture() returns false SYNCHRONOUSLY for two completely
   * different outcomes: a real refusal, and "the consent dialog has just opened
   * and this same entry will re-run when the doctor confirms" (ScribeFlow's
   * consent gate: it calls _mlsRequestEncounterConsent('recording').then(...)
   * and returns false immediately). This function collapsed both into
   * `armed = null; return null`, and its caller in the visit lane turned that
   * null into the red toast "The recorder could not start. Your existing
   * transcript is safe." - painted at the exact moment the consent dialog
   * appeared, so the app told the doctor it had failed while asking him to
   * continue. It also left the FIRST span of the visit unarmed: consent
   * resolved, the base recorder started, and the segment list silently missed
   * segment one for the rest of the encounter.
   *
   * Ask the gate BEFORE calling startCapture, so the two outcomes are never
   * confused again. When consent is pending this keeps the span armed, returns
   * the CONSENT_PENDING sentinel (truthy, so no caller can read it as failure),
   * and starts the recorder itself once the doctor confirms - which is also the
   * only place the first segment can be armed correctly. A real decline, a real
   * dialog failure, or a real recorder failure still disarms and still returns
   * null, so the fail-closed refusal is unchanged. */
  var CONSENT_PENDING = "consent-pending";
  function consentPending() {
    return safe(function () {
      return isFn(window._mlsHasEncounterConsent) && !window._mlsHasEncounterConsent();
    }, false);
  }
  function startSegment(kind) {
    var p = activePt();
    armed = {
      id: uid(),
      kind: (kindOf(kind).key),
      boundaryLen: transcriptVal().length,
      patientId: p ? p.id : "",
      patientName: p ? p.name : "",
      patientDob: p ? p.dob : "",
      startedAt: nowMs()
    };
    /* start the base recorder if not already capturing */
    if (!isCapturing()) {
      if (!isFn(window.startCapture)) { armed = null; render(); return null; }
      if (consentPending() && isFn(window._mlsRequestEncounterConsent)) {
        var pendingId = armed.id;
        var disarmPending = function () {
          if (armed && armed.id === pendingId) { armed = null; render(); }
        };
        render();
        var asked = safe(function () {
          return Promise.resolve(window._mlsRequestEncounterConsent("recording")).then(function (granted) {
            if (!granted) { disarmPending(); return; }          /* declined, or fenced out */
            if (!armed || armed.id !== pendingId) return;        /* superseded meanwhile */
            /* the span starts NOW, not when the dialog opened */
            armed.boundaryLen = transcriptVal().length;
            armed.startedAt = nowMs();
            if (isCapturing()) { render(); return; }
            var resumed = safe(function () { return window.startCapture(); }, false);
            if (resumed === false && !isCapturing()) { disarmPending(); return; }
            render();
          }, disarmPending);
        }, null);
        if (!asked) { armed = null; render(); return null; }
        return CONSENT_PENDING;
      }
      var began = safe(function () { return window.startCapture(); }, false);
      if (began === false || !isCapturing()) { armed = null; render(); return null; }
    }
    render();
    return armed.id;
  }
  function stopSegment() {
    /* stop the base recorder */
    safe(function () { if (isCapturing() && isFn(window.stopCapture)) window.stopCapture(); });
    if (!armed) { render(); return null; }
    var full = transcriptVal();
    var delta = full.slice(Math.min(armed.boundaryLen, full.length));
    var text = String(delta || "").trim();
    var rec = {
      id: armed.id,
      patientId: armed.patientId,
      patientName: armed.patientName,
      patientDob: armed.patientDob,
      kind: armed.kind,
      label: kindOf(armed.kind).label,
      text: text,
      wordCount: words(text),
      recordedBy: whoAmI(),
      startedAt: armed.startedAt,
      endedAt: nowMs()
    };
    armed = null;
    if (rec.wordCount > 0) {
      SEGMENTS.push(rec);
      selected[rec.id] = true; /* newly captured segments default to selected */
      persist();
    }
    render();
    return rec.wordCount > 0 ? rec.id : null;
  }
  function toggleSegment(kind) {
    if (armed) return stopSegment();
    return startSegment(kind);
  }

  /* Import the WHOLE current #transcript as a single labeled segment (covers the
   * "I already recorded/typed/pasted before opening this panel" case, and the
   * phone-mic path which appends straight into #transcript). */
  function captureCurrentAs(kind) {
    var text = transcriptVal().trim();
    if (!text) return null;
    var p = activePt();
    var rec = {
      id: uid(), patientId: p ? p.id : "", patientName: p ? p.name : "", patientDob: p ? p.dob : "",
      kind: kindOf(kind).key, label: kindOf(kind).label, text: text, wordCount: words(text),
      recordedBy: whoAmI(),
      startedAt: nowMs(), endedAt: nowMs()
    };
    SEGMENTS.push(rec); selected[rec.id] = true; persist(); render();
    return rec.id;
  }

  function relabel(id, kind, customLabel) {
    for (var i = 0; i < SEGMENTS.length; i++) if (SEGMENTS[i].id === id) {
      if (kind) { SEGMENTS[i].kind = kindOf(kind).key; SEGMENTS[i].label = kindOf(kind).label; }
      if (customLabel != null) SEGMENTS[i].label = String(customLabel).slice(0, 80);
      persist(); render(); return true;
    }
    return false;
  }
  function removeSegment(id) {
    var out = []; for (var i = 0; i < SEGMENTS.length; i++) if (SEGMENTS[i].id !== id) out.push(SEGMENTS[i]);
    SEGMENTS = out; delete selected[id]; persist(); render();
  }

  /* ---------- combine + regenerate (the safety-critical path) ---------- */
  /* Returns {ok, combined, used, reason}. Refuses cross-patient combine. */
  function buildCombined() {
    var p = activePt();
    var chosen = [];
    var mine = segsForCurrent();
    for (var i = 0; i < mine.length; i++) if (selected[mine[i].id]) chosen.push(mine[i]);
    if (!chosen.length) return { ok: false, reason: "none-selected" };
    /* hard identity gate: every chosen segment must be the current chart */
    for (var j = 0; j < chosen.length; j++) {
      var s = chosen[j];
      if (p) {
        if (!sameChart(p, { id: s.patientId, dob: s.patientDob })) {
          return { ok: false, reason: "identity-mismatch", offender: s.id };
        }
      } else if (s.patientId) {
        /* no active patient but a segment is linked -> refuse (avoid mis-attach) */
        return { ok: false, reason: "no-active-patient" };
      }
    }
    chosen.sort(function (a, b) { return (a.startedAt || 0) - (b.startedAt || 0); });
    var combined = chosen.map(function (s) {
      return "[" + s.label + "]\n" + s.text;
    }).join("\n\n");
    return { ok: true, combined: combined, used: chosen.length };
  }

  function generateFromSelected() {
    var r = buildCombined();
    if (!r.ok) {
      if (r.reason === "none-selected") return toast("Select at least one recording to include.", "err");
      if (r.reason === "identity-mismatch") return toast("A selected recording belongs to a different patient chart. It was blocked. Only the current patient's recordings can be combined.", "err");
      if (r.reason === "no-active-patient") return toast("A selected recording is linked to a chart, but no patient is active. Open that patient first.", "err");
      return toast("Could not combine the selected recordings.", "err");
    }
    setTranscript(r.combined);
    var p = activePt();
    toast("Combined " + r.used + " recording" + (r.used === 1 ? "" : "s") + (p && p.name ? " for " + p.name : "") + " -> generating one note...", "");
    safe(function () { if (isFn(window.generateNote)) window.generateNote(); });
  }

  function toast(m, k) { safe(function () { if (isFn(window.toast)) window.toast(m, k || ""); }); }

  /* ---------- UI ---------- */
  var HOST_ID = "mlsRecSegHost", STYLE_ID = "mlsRecSegStyle";
  function ensureCss() {
    if ($(STYLE_ID)) return;
    var st = document.createElement("style"); st.id = STYLE_ID;
    st.textContent = [
      "#" + HOST_ID + "{margin:14px 0 4px;border:1px solid rgba(120,150,220,.28);border-radius:12px;padding:12px 13px;background:rgba(32,64,52,.05)}",
      "#" + HOST_ID + " .rs-hd{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;color:#1E2B24;margin-bottom:2px}",
      "#" + HOST_ID + " .rs-sub{font-size:11.5px;color:#5b6b82;margin-bottom:9px}",
      "#" + HOST_ID + " .rs-warn{font-size:11.5px;color:#a12626;font-weight:600;margin:0 0 8px}",
      "#" + HOST_ID + " .rs-pt{font-size:11.5px;color:#2E6A4B;font-weight:600;margin:0 0 8px}",
      "#" + HOST_ID + " .rs-kinds{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}",
      "#" + HOST_ID + " .rs-kind{cursor:pointer;border:1px solid rgba(32,64,52,.4);background:#fff;color:#204034;border-radius:999px;padding:5px 10px;font:600 11.5px system-ui}",
      "#" + HOST_ID + " .rs-kind.on{background:#2E6A4B;color:#fff}",
      "#" + HOST_ID + " .rs-rec{display:flex;gap:8px;align-items:center;margin-bottom:10px}",
      "#" + HOST_ID + " .rs-recbtn{cursor:pointer;border:0;border-radius:9px;padding:8px 13px;font:700 12.5px system-ui;color:#fff;background:linear-gradient(135deg,#2E6A4B,#204034)}",
      "#" + HOST_ID + " .rs-recbtn.rec{background:linear-gradient(135deg,#c0392b,#8e1f16)}",
      "#" + HOST_ID + " .rs-imp{cursor:pointer;border:1px solid #cfd9ea;background:#fff;color:#204034;border-radius:9px;padding:8px 11px;font:600 12px system-ui}",
      "#" + HOST_ID + " .rs-list{display:flex;flex-direction:column;gap:6px;margin:4px 0 10px}",
      "#" + HOST_ID + " .rs-row{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid rgba(120,150,220,.2);border-radius:10px;padding:7px 9px}",
      "#" + HOST_ID + " .rs-row select{font:12px system-ui;border:1px solid #cfd9ea;border-radius:7px;padding:3px 5px}",
      "#" + HOST_ID + " .rs-row .rs-wc{font:11px system-ui;color:#5b6b82;margin-left:auto}",
      "#" + HOST_ID + " .rs-row .rs-del{cursor:pointer;border:0;background:transparent;color:#a12626;font:700 13px system-ui}",
      "#" + HOST_ID + " .rs-go{cursor:pointer;border:0;border-radius:9px;padding:9px 13px;font:700 12.5px system-ui;color:#fff;background:#137a3a;width:100%}",
      "#" + HOST_ID + " .rs-go[disabled]{opacity:.5;cursor:default}",
      "#" + HOST_ID + " .rs-empty{font:12px system-ui;color:#5b6b82;padding:4px 2px}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }

  var curKind = "visit";
  function host() {
    var h = $(HOST_ID);
    if (h) return h;
    var card = $("captureCard"); if (!card) return null;
    h = document.createElement("div"); h.id = HOST_ID;
    /* place the panel right after the transcript textarea */
    var t = transcriptEl();
    if (t && t.parentNode === card) { card.insertBefore(h, t.nextSibling); }
    else card.appendChild(h);
    return h;
  }

  var _destroyed = false;
  function render() {
    if (_destroyed || !gateOn()) return;
    var h = host(); if (!h) return;
    ensureCss();
    var p = activePt();
    var mine = segsForCurrent();
    var recOn = !!armed;
    var kindBtns = KINDS.map(function (k) {
      return '<button type="button" class="rs-kind' + (k.key === curKind ? ' on' : '') + '" data-k="' + k.key + '">' + k.icon + ' ' + esc(k.label) + '</button>';
    }).join("");
    var ptLine = p
      ? '<div class="rs-pt">Recording for: ' + esc(p.name || "(unnamed)") + (p.dob ? ' - DOB ' + esc(p.dob) : '') + '</div>'
      : '<div class="rs-warn">No patient selected - recordings will not attach to a chart. Open a patient to link them.</div>';
    var rows = mine.length ? mine.map(function (s) {
      var opts = KINDS.map(function (k) { return '<option value="' + k.key + '"' + (k.key === s.kind ? ' selected' : '') + '>' + esc(k.label) + '</option>'; }).join("");
      return '<div class="rs-row" data-id="' + s.id + '">'
        + '<input type="checkbox" class="rs-ck"' + (selected[s.id] ? ' checked' : '') + '>'
        + '<select class="rs-kindsel">' + opts + '</select>'
        + '<span class="rs-wc">' + s.wordCount + ' word' + (s.wordCount === 1 ? '' : 's')
        + (s.recordedBy ? ' · by ' + esc(s.recordedBy) : '') + '</span>'
        + '<button type="button" class="rs-del" title="Delete recording">✕</button>'
        + '</div>';
    }).join("") : '<div class="rs-empty">No recordings yet. Pick a type, then Start.</div>';

    var selCount = 0; for (var i = 0; i < mine.length; i++) if (selected[mine[i].id]) selCount++;
    /* handoff clarity: a staff-captured segment means the doctor reviews before signing */
    var staffSeg = mine.some(function (s) { return s.kind === 'staff' || /staff/i.test(s.label || ''); });
    var handoffChip = staffSeg
      ? '<div class="rs-handoff" style="background:#FCF8EF;border:1px solid #EFE4CE;color:#8A5A22;border-radius:9px;padding:7px 11px;font:600 12px system-ui;margin:0 0 8px">🤝 Staff-prepared content in this visit — review each part before you combine and sign.</div>'
      : '';

    h.innerHTML =
      '<div class="rs-hd">🎙️ Recordings for this visit</div>'
      + '<div class="rs-sub">Capture the doctor\'s dictation, an addendum, staff history, imaging review, or a procedure discussion - separately - then combine any of them into one note.</div>'
      + ptLine
      + handoffChip
      + '<div class="rs-kinds">' + kindBtns + '</div>'
      + '<div class="rs-rec">'
      + '<button type="button" class="rs-recbtn' + (recOn ? ' rec' : '') + '" id="rsRecBtn">' + (recOn ? '■ Stop ' + esc(kindOf(armed.kind).label) : '● Start ' + esc(kindOf(curKind).label)) + '</button>'
      + '<button type="button" class="rs-imp" id="rsImpBtn" title="Save whatever is in the transcript box now as one labeled recording">Save current transcript</button>'
      + '</div>'
      + '<div class="rs-list">' + rows + '</div>'
      + '<button type="button" class="rs-go" id="rsGoBtn"' + (selCount ? '' : ' disabled') + ' title="Replaces the transcript box with only the recordings ticked above, then drafts one note from those. The green Generate Note button lower down uses the transcript box exactly as it stands.">🎙️ Combine ' + selCount + ' ticked recording' + (selCount === 1 ? '' : 's') + ' into one note</button>';

    /* wire */
    var kb = h.getElementsByClassName("rs-kind");
    for (var a = 0; a < kb.length; a++) kb[a].onclick = (function (el) { return function () { curKind = el.getAttribute("data-k"); render(); }; })(kb[a]);
    var rb = $("rsRecBtn"); if (rb) rb.onclick = function () { toggleSegment(curKind); };
    var ib = $("rsImpBtn"); if (ib) ib.onclick = function () { var id = captureCurrentAs(curKind); if (!id) toast("Nothing in the transcript box to save yet.", "err"); };
    var gb = $("rsGoBtn"); if (gb) gb.onclick = generateFromSelected;
    var rows2 = h.getElementsByClassName("rs-row");
    for (var b = 0; b < rows2.length; b++) {
      (function (row) {
        var id = row.getAttribute("data-id");
        var ck = row.getElementsByClassName("rs-ck")[0]; if (ck) ck.onchange = function () { selected[id] = ck.checked; render(); };
        var ks = row.getElementsByClassName("rs-kindsel")[0]; if (ks) ks.onchange = function () { relabel(id, ks.value); };
        var dl = row.getElementsByClassName("rs-del")[0]; if (dl) dl.onclick = function () { removeSegment(id); };
      })(rows2[b]);
    }
  }

  /* ---------- react to patient switches (shared-context aware) ---------- */
  var _switchHandler = null, _lastPtKey = null;
  var _domMo = null, _captureMo = null, _captureBtn = null;
  var _mountTimer = null, _mutationTimer = null, _tries = 0, _loaded = false;
  var _domReadyHandler = null;
  function ptKey() { var p = activePt(); return p ? (p.id + "|" + p.dob) : ""; }
  function onMaybeSwitch() {
    var k = ptKey();
    if (k !== _lastPtKey) {
      _lastPtKey = k;
      /* new patient context: drop selection (never carry another patient's picks) */
      selected = {};
      /* if a segment was mid-record when the chart changed, close it out safely */
      if (armed && armed.patientId && k && armed.patientId !== activePtId()) { safe(stopSegment); }
      render();
    }
  }
  function syncCaptureState() {
    safe(onMaybeSwitch);
    /* The top workflow and microphone coordinator can stop the base recorder
       without going through this panel. #captureBtn changes synchronously when
       that happens, so its observer can finalize the armed segment without a
       permanent polling loop. */
    if (armed && !isCapturing()) safe(stopSegment);
  }
  function bindCaptureObserver() {
    var btn = $("captureBtn");
    if (btn === _captureBtn) return;
    safe(function () { if (_captureMo) _captureMo.disconnect(); });
    _captureMo = null; _captureBtn = btn || null;
    if (!btn || !window.MutationObserver || _destroyed) return;
    _captureMo = new MutationObserver(function () { safe(syncCaptureState); });
    safe(function () {
      _captureMo.observe(btn, {
        attributes: true,
        attributeFilter: ["class", "aria-pressed", "disabled"],
        childList: true,
        characterData: true,
        subtree: true
      });
    });
  }
  function queueDomSync() {
    if (_destroyed || _mutationTimer) return;
    _mutationTimer = setTimeout(function () {
      _mutationTimer = null;
      if (_destroyed) return;
      safe(function () {
        if ($("captureCard") && !$(HOST_ID)) tryMount();
        bindCaptureObserver();
        syncCaptureState();
      });
    }, 0);
  }
  function installDomWatch() {
    if (_domMo || !window.MutationObserver || _destroyed) return;
    _domMo = new MutationObserver(queueDomSync);
    safe(function () {
      _domMo.observe(document.documentElement || document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });
    });
  }
  function installSwitchWatch() {
    if (!_switchHandler) {
      _switchHandler = function () { safe(syncCaptureState); };
      safe(function () { document.addEventListener("mls:patientpicked", _switchHandler); });
    }
    installDomWatch();
    bindCaptureObserver();
    if (_lastPtKey === null) _lastPtKey = ptKey();
    else safe(onMaybeSwitch);
  }

  /* ---------- boot / revert ---------- */
  function stopMountRetry() {
    try { if (_mountTimer) clearTimeout(_mountTimer); } catch (e) {}
    _mountTimer = null;
  }
  function tryMount() {
    if (_destroyed) return false;
    if (!$("captureCard")) return false;
    if (!_loaded) { load(); _loaded = true; }
    ensureCss(); render(); installSwitchWatch();
    stopMountRetry();
    return true;
  }
  function retryMount() {
    if (_destroyed || _mountTimer || _tries >= 60) return;
    _mountTimer = setTimeout(function () {
      _mountTimer = null;
      if (_destroyed || tryMount()) return;
      _tries++;
      retryMount();
    }, 500);
  }
  function boot() {
    if (_destroyed) return;
    installDomWatch();
    if (!tryMount()) retryMount();
  }
  function revert() {
    _destroyed = true;
    stopMountRetry();
    try { if (_mutationTimer) clearTimeout(_mutationTimer); } catch (e) {}
    _mutationTimer = null;
    try { if (_domMo) _domMo.disconnect(); } catch (e) {}
    try { if (_captureMo) _captureMo.disconnect(); } catch (e) {}
    _domMo = null; _captureMo = null; _captureBtn = null;
    try { if (_switchHandler) document.removeEventListener("mls:patientpicked", _switchHandler); } catch (e) {}
    try { if (_domReadyHandler) document.removeEventListener("DOMContentLoaded", _domReadyHandler); } catch (e) {}
    _switchHandler = null; _domReadyHandler = null;
    try { var h = $(HOST_ID); if (h && h.parentNode) h.parentNode.removeChild(h); } catch (e) {}
    try { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
    try { window[NS].installed = false; } catch (e) {}
  }

  window[NS] = {
    installed: true,
    version: VERSION,
    asset: "feat_mls_recording_segments.js",
    /* public API (also the unit-test surface) */
    _segments: function () { return SEGMENTS.slice(); },
    _forCurrent: segsForCurrent,
    _sameChart: sameChart,
    _buildCombined: buildCombined,
    startSegment: startSegment,
    /* revwork-1.0.0 (b1169): the sentinel startSegment answers with while the
       consent dialog is open. Truthy on purpose - a caller that only checks
       falsiness must NOT read it as a failure - and named here so no caller has
       to hard-code the string. */
    CONSENT_PENDING: CONSENT_PENDING,
    stopSegment: stopSegment,
    isArmed: function () { return !!armed; },
    captureCurrentAs: captureCurrentAs,
    relabel: relabel,
    removeSegment: removeSegment,
    select: function (id, on) { selected[id] = !!on; render(); },
    generateFromSelected: generateFromSelected,
    render: render,
    revert: revert,
    KINDS: KINDS
  };

  if (document.readyState === "loading") {
    _domReadyHandler = function () { _domReadyHandler = null; safe(boot); };
    document.addEventListener("DOMContentLoaded", _domReadyHandler, { once: true });
  }
  else safe(boot);
})();

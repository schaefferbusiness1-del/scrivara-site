/* ============================================================================
 * feat_mls_recording_segments.js  ->  window.__mlsRecSegments   (rs-1.0.0)
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
  var VERSION = "rs-1.0.0";
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
    safe(function () { if (!isCapturing() && isFn(window.startCapture)) window.startCapture(); });
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
      "#" + HOST_ID + " .rs-row .rs-lbl{font:700 12px system-ui;color:#1f2d40;flex:0 0 auto}",
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

  function render() {
    if (!gateOn()) return;
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
        + '<span class="rs-wc">' + s.wordCount + ' word' + (s.wordCount === 1 ? '' : 's') + '</span>'
        + '<button type="button" class="rs-del" title="Delete recording">✕</button>'
        + '</div>';
    }).join("") : '<div class="rs-empty">No recordings yet. Pick a type, then Start.</div>';

    var selCount = 0; for (var i = 0; i < mine.length; i++) if (selected[mine[i].id]) selCount++;

    h.innerHTML =
      '<div class="rs-hd">🎙️ Recordings for this visit</div>'
      + '<div class="rs-sub">Capture the doctor\'s dictation, an addendum, staff history, imaging review, or a procedure discussion - separately - then combine any of them into one note.</div>'
      + ptLine
      + '<div class="rs-kinds">' + kindBtns + '</div>'
      + '<div class="rs-rec">'
      + '<button type="button" class="rs-recbtn' + (recOn ? ' rec' : '') + '" id="rsRecBtn">' + (recOn ? '■ Stop ' + esc(kindOf(armed.kind).label) : '● Start ' + esc(kindOf(curKind).label)) + '</button>'
      + '<button type="button" class="rs-imp" id="rsImpBtn" title="Save whatever is in the transcript box now as one labeled recording">Save current transcript</button>'
      + '</div>'
      + '<div class="rs-list">' + rows + '</div>'
      + '<button type="button" class="rs-go" id="rsGoBtn"' + (selCount ? '' : ' disabled') + '>✨ Generate note from ' + selCount + ' selected recording' + (selCount === 1 ? '' : 's') + '</button>';

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
  var _switchHandler = null, _pollIv = null, _lastPtKey = null;
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
  function installSwitchWatch() {
    _switchHandler = function () { safe(onMaybeSwitch); };
    safe(function () { document.addEventListener("mls:patientpicked", _switchHandler); });
    /* also poll: not every switch path fires the event */
    _pollIv = setInterval(function () { safe(onMaybeSwitch); }, 1200);
    _lastPtKey = ptKey();
  }

  /* ---------- boot / revert ---------- */
  var _mountIv = null, _tries = 0;
  function tryMount() {
    if (!$("captureCard")) return false;
    load(); ensureCss(); render(); installSwitchWatch();
    return true;
  }
  function boot() {
    if (tryMount()) return;
    _mountIv = setInterval(function () { _tries++; if (tryMount() || _tries > 60) { clearInterval(_mountIv); _mountIv = null; } }, 500);
    /* keep the panel present if the view re-renders */
    setInterval(function () { safe(function () { if ($("captureCard") && !$(HOST_ID)) render(); }); }, 2500);
  }
  function revert() {
    try { if (_mountIv) clearInterval(_mountIv); } catch (e) {}
    try { if (_pollIv) clearInterval(_pollIv); } catch (e) {}
    try { if (_switchHandler) document.removeEventListener("mls:patientpicked", _switchHandler); } catch (e) {}
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
    stopSegment: stopSegment,
    captureCurrentAs: captureCurrentAs,
    relabel: relabel,
    removeSegment: removeSegment,
    select: function (id, on) { selected[id] = !!on; render(); },
    generateFromSelected: generateFromSelected,
    render: render,
    revert: revert,
    KINDS: KINDS
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { safe(boot); }, { once: true });
  else safe(boot);
})();

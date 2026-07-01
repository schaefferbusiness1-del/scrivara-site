/* feat_autosave.js  ->  window.__mlsAutosave  (v1.0.0)
 *
 * AUTOSAVE + DRAFT RECOVERY for the MLS note editors, so a doctor NEVER
 * loses an in-progress note to an accidental navigation, refresh, crash,
 * or tab close.
 *
 * Additive, reversible, progressive-enhancement. Own IIFE, all work in
 * try/catch, idempotent, and fully removable via window.__mlsAutosave.revert().
 * It does NOT reimplement saving and does NOT touch ScribeFlow.html, the
 * backend, the extension, or any existing module. It wraps the app's own
 * explicit-save functions only to know WHEN to clear a draft.
 *
 * ===================================================================
 *  WHAT IT WATCHES (the real note text areas, read live from the DOM)
 * ===================================================================
 *   #noteBox        - SOAP / insurance editable note (S21)
 *   #procNoteBody   - op-note builder textarea (S53)
 *   #viewBody       - history raw-note editor (the "Edit raw note" box, S47/S60)
 *   #mlsProtoScratch- MLS Easy "type/paste notes" scratch textbox (S70)
 *   #transcript     - the visit transcript / dictation box
 *
 * ===================================================================
 *  SAFETY / PHI
 * ===================================================================
 *  - Drafts are stored ONLY in this browser's localStorage, under the app's
 *    own per-user key (window.uns('mlsAutosaveDrafts') = sf_u::<email>::...),
 *    keyed by the active patient id (NOT name) + the field. They are NEVER
 *    sent anywhere: this module performs NO fetch / XHR / sendBeacon / network
 *    of any kind. The note text never leaves the device through this feature.
 *    (This is the same on-device storage class the app already uses for notes
 *    via uns('notes'); we add no new exfiltration surface.)
 *  - Recovery is ALWAYS explicit: the doctor clicks "Recover" or "Discard".
 *    The module NEVER writes into a note box on its own; the only time it sets
 *    a textarea value is when the doctor clicks "Recover". A saved note is
 *    never silently overwritten.
 *  - The indicator says "Draft saved" (not "Saved"), and only flips to the
 *    checkmark AFTER the localStorage write actually succeeds, so it can never
 *    claim a save that did not happen and never implies the chart/server was
 *    written. Honest failure ("Couldn't save draft") on a storage error.
 *  - A draft is cleared the moment the doctor explicitly saves the note
 *    (the app's saveCurrentNote / saveNotes / saveNoteToBackend, and a Save
 *    click inside the raw-note modal) -> no draft survives an explicit save.
 *
 * ASCII-only. NUL-free. node --check clean.
 */
;(function () {
  "use strict";
  try { if (window.__mlsAutosave && window.__mlsAutosave.installed) return; } catch (e) { return; }

  var VERSION = "1.0.0";
  var ASSET = "feat_autosave.js";

  // ---------------- tiny safe helpers ----------------
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function isEl(n) { return !!(n && n.nodeType === 1); }
  function now() { return Date.now(); }
  function norm(s) { return String(s == null ? "" : s).replace(/\r\n/g, "\n"); }

  // The five watched note text areas. kind drives the draft-key prefix.
  // scope:'pt' -> keyed by active patient id; scope:'view' -> keyed by the
  // open history note id (falls back to active patient id).
  var FIELDS = [
    { id: "noteBox",         kind: "note",       scope: "pt",   label: "note" },
    { id: "procNoteBody",    kind: "proc",       scope: "pt",   label: "operative note" },
    { id: "viewBody",        kind: "view",       scope: "view", label: "note" },
    { id: "mlsProtoScratch", kind: "scratch",    scope: "pt",   label: "typed notes" },
    { id: "transcript",      kind: "transcript", scope: "pt",   label: "transcript" }
  ];
  function fieldFor(el) {
    if (!isEl(el)) return null;
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].id === el.id) return FIELDS[i];
    return null;
  }

  var DEBOUNCE_MS = safe(function () {
    var v = window.__MLS_AUTOSAVE_DEBOUNCE;
    return (typeof v === "number" && v >= 0) ? v : 1000;
  }, 1000);
  var MAX_DRAFTS = 60;
  var MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14; // prune drafts older than 14 days

  var stats = { writes: 0, skippedEmpty: 0, recovered: 0, discarded: 0, cleared: 0, writeErrors: 0, promptsShown: 0 };

  // ---------------- storage (per-user, on-device only) ----------------
  function storeKey() {
    var k = safe(function () { return (typeof window.uns === "function") ? window.uns("mlsAutosaveDrafts") : null; }, null);
    return k || "mls::mlsAutosaveDrafts"; // generic, non-PHI fallback if uns() absent
  }
  function readStore() {
    return safe(function () {
      var raw = window.localStorage.getItem(storeKey());
      if (!raw) return { drafts: {}, savedAt: {} };
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return { drafts: {}, savedAt: {} };
      if (!o.drafts) o.drafts = {};
      if (!o.savedAt) o.savedAt = {};
      return o;
    }, { drafts: {}, savedAt: {} });
  }
  function pruneStore(o) {
    try {
      var t = now(), keys = Object.keys(o.drafts);
      // drop expired
      for (var i = 0; i < keys.length; i++) {
        var d = o.drafts[keys[i]];
        if (!d || (t - (d.ts || 0)) > MAX_AGE_MS) delete o.drafts[keys[i]];
      }
      // cap count (oldest first)
      keys = Object.keys(o.drafts);
      if (keys.length > MAX_DRAFTS) {
        keys.sort(function (a, b) { return (o.drafts[a].ts || 0) - (o.drafts[b].ts || 0); });
        for (var j = 0; j < keys.length - MAX_DRAFTS; j++) delete o.drafts[keys[j]];
      }
    } catch (e) {}
    return o;
  }
  function writeStore(o) {
    return safe(function () {
      window.localStorage.setItem(storeKey(), JSON.stringify(pruneStore(o)));
      return true;
    }, false);
  }

  // ---------------- scope / key resolution ----------------
  function activePtId() {
    return safe(function () {
      if (typeof window.getActivePtId === "function") { var v = window.getActivePtId(); if (v != null && v !== "") return String(v); }
      if (typeof window.activePatient === "function") { var p = window.activePatient(); if (p && p.id != null) return String(p.id); }
      return "";
    }, "") || "none";
  }
  // current open history-note id (set when the raw-note editor is opened)
  var _curViewNoteId = "";
  function scopeId(field) {
    if (field && field.scope === "view") return ("v_" + (_curViewNoteId || activePtId()));
    return activePtId();
  }
  function keyFor(field) { return field.kind + "::" + scopeId(field); }

  // ---------------- indicator UI (per field) ----------------
  function ensureStyle() {
    if (gid("mls-autosave-style")) return;
    var s = safe(function () { return document.createElement("style"); });
    if (!s) return;
    s.id = "mls-autosave-style";
    s.textContent = [
      ".mls-as-ind{display:inline-flex;align-items:center;gap:5px;font:12px/1.3 inherit;",
      "color:#5b6b80;margin:4px 2px 0;opacity:.95;vertical-align:middle;user-select:none;}",
      ".mls-as-ind.is-saving{color:#8a6d00;}",
      ".mls-as-ind.is-saved{color:#0a7a33;}",
      ".mls-as-ind.is-error{color:#b42318;}",
      ".mls-as-recover{margin:8px 2px;padding:10px 12px;border-radius:10px;",
      "border:1px solid #f0c36d;background:#fff8e6;color:#5a4500;font:13px/1.45 inherit;",
      "display:flex;flex-wrap:wrap;align-items:center;gap:9px;box-shadow:0 1px 3px rgba(8,20,36,.08);}",
      ".mls-as-recover .mls-as-rtext{flex:1 1 auto;min-width:160px;}",
      ".mls-as-recover button{font:13px/1 inherit;font-weight:700;border-radius:8px;",
      "padding:8px 13px;min-height:36px;cursor:pointer;border:1px solid transparent;}",
      ".mls-as-recover .mls-as-rec{background:#0a7a33;color:#fff;}",
      ".mls-as-recover .mls-as-disc{background:#fff;color:#5a4500;border-color:#d9bd7a;}"
    ].join("");
    safe(function () { (document.head || document.documentElement).appendChild(s); });
  }
  function indFor(el) {
    if (!isEl(el)) return null;
    var prev = el.nextSibling;
    if (prev && prev.nodeType === 1 && prev.className && (" " + prev.className + " ").indexOf(" mls-as-ind ") >= 0) return prev;
    var span = safe(function () { return document.createElement("span"); });
    if (!span) return null;
    span.className = "mls-as-ind";
    span.setAttribute("data-mls-as", el.id);
    span.title = "Autosaved locally on this device only. Use the note's Save button to store it.";
    safe(function () { if (el.parentNode) el.parentNode.insertBefore(span, el.nextSibling); });
    return span;
  }
  function setInd(el, state, text) {
    var span = indFor(el);
    if (!span) return;
    span.className = "mls-as-ind" + (state ? (" is-" + state) : "");
    span.textContent = text || "";
  }
  function relTime(ts) {
    var s = Math.max(0, Math.round((now() - ts) / 1000));
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60); if (m < 60) return m + " min ago";
    var h = Math.round(m / 60); if (h < 24) return h + "h ago";
    return safe(function () { return new Date(ts).toLocaleString(); }, "earlier");
  }
  function clockTime(ts) { return safe(function () { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }, ""); }

  // ---------------- autosave (debounced) ----------------
  var _timers = {}; // by field id
  function scheduleSave(el) {
    var f = fieldFor(el); if (!f) return;
    setInd(el, "saving", "Saving draft...");
    var id = f.id;
    if (_timers[id]) clearTimeout(_timers[id]);
    _timers[id] = setTimeout(function () { _timers[id] = null; saveDraftNow(el); }, DEBOUNCE_MS);
  }
  function saveDraftNow(el) {
    var f = fieldFor(el); if (!f || !isEl(el)) return false;
    var val = safe(function () { return el.value; }, "");
    var o = readStore();
    var key = keyFor(f);
    if (norm(val).trim() === "") {
      // nothing meaningful to keep -> remove any stale draft, quiet indicator
      if (o.drafts[key]) { delete o.drafts[key]; writeStore(o); }
      stats.skippedEmpty++;
      setInd(el, "", "");
      return false;
    }
    o.drafts[key] = { text: norm(val), ts: now(), kind: f.kind, ptId: activePtId() };
    var ok = writeStore(o);
    if (ok) { stats.writes++; setInd(el, "saved", "Draft saved " + String.fromCharCode(10003) + " " + clockTime(now())); }
    else { stats.writeErrors++; setInd(el, "error", "Couldn't save draft"); }
    return ok;
  }

  // ---------------- recovery prompt ----------------
  var _promptShown = {}; // key -> true (per session, until handled)
  function removeRecoverUI(el) {
    safe(function () {
      var sib = el.parentNode ? el.parentNode.querySelector('.mls-as-recover[data-mls-as="' + el.id + '"]') : null;
      if (sib) sib.parentNode.removeChild(sib);
    });
  }
  function maybePrompt(el) {
    var f = fieldFor(el); if (!f || !isEl(el)) return;
    var key = keyFor(f);
    if (_promptShown[key]) return;
    var o = readStore();
    var d = o.drafts[key];
    if (!d || d.text == null) return;
    var cur = norm(safe(function () { return el.value; }, ""));
    // already reflected in the box -> nothing to recover
    if (norm(d.text) === cur) return;
    // only offer when the draft is genuinely NEWER than the last explicit save
    var savedAt = (o.savedAt && o.savedAt[key]) || 0;
    if (d.ts <= savedAt) return;
    showRecover(el, f, d);
  }
  function showRecover(el, f, d) {
    ensureStyle();
    removeRecoverUI(el);
    var box = safe(function () { return document.createElement("div"); });
    if (!box) return;
    box.className = "mls-as-recover";
    box.setAttribute("data-mls-as", el.id);
    var msg = safe(function () { return document.createElement("span"); });
    msg.className = "mls-as-rtext";
    msg.textContent = "Recover unsaved " + (f.label || "draft") + " from " + relTime(d.ts) + "?";
    var rec = safe(function () { return document.createElement("button"); });
    rec.type = "button"; rec.className = "mls-as-rec"; rec.textContent = "Recover";
    var disc = safe(function () { return document.createElement("button"); });
    disc.type = "button"; disc.className = "mls-as-disc"; disc.textContent = "Discard";
    rec.addEventListener("click", function () { doRecover(el, f); });
    disc.addEventListener("click", function () { doDiscard(el, f); });
    box.appendChild(msg); box.appendChild(rec); box.appendChild(disc);
    safe(function () { if (el.parentNode) el.parentNode.insertBefore(box, el.nextSibling); });
    _promptShown[keyFor(f)] = true;
    stats.promptsShown++;
  }
  function doRecover(el, f) {
    var o = readStore(), key = keyFor(f), d = o.drafts[key];
    if (d && isEl(el)) {
      // The ONLY place this module writes into a note box -> explicit user action.
      safe(function () { el.value = d.text; });
      // let the app + the S21 preview observe the change
      safe(function () { el.dispatchEvent(new Event("input", { bubbles: true })); });
      safe(function () { el.dispatchEvent(new Event("change", { bubbles: true })); });
      stats.recovered++;
    }
    removeRecoverUI(el);
    _promptShown[key] = true;
    setInd(el, "saved", "Draft recovered");
  }
  function doDiscard(el, f) {
    var o = readStore(), key = keyFor(f);
    if (o.drafts[key]) { delete o.drafts[key]; writeStore(o); stats.discarded++; }
    removeRecoverUI(el);
    _promptShown[key] = true;
    setInd(el, "", "");
  }

  // ---------------- clear-on-explicit-save ----------------
  // Clears every draft scoped to the active patient (note/proc/scratch/transcript)
  // and stamps savedAt so a stale draft can never re-prompt over a saved note.
  function clearForActive() {
    var o = readStore(), pid = activePtId(), t = now();
    var prefixes = ["note", "proc", "scratch", "transcript"];
    for (var i = 0; i < prefixes.length; i++) {
      var key = prefixes[i] + "::" + pid;
      if (o.drafts[key]) { delete o.drafts[key]; }
      o.savedAt[key] = t;
      delete _promptShown[key];
    }
    writeStore(o);
    stats.cleared++;
    // quiet any visible indicators / prompts for those fields
    for (var k = 0; k < FIELDS.length; k++) {
      if (FIELDS[k].scope !== "pt") continue;
      var el = gid(FIELDS[k].id);
      if (el) { removeRecoverUI(el); setInd(el, "", ""); }
    }
    return true;
  }
  function clearViewDraft() {
    var f = FIELDS[2]; // viewBody
    var o = readStore(), key = keyFor(f);
    if (o.drafts[key]) { delete o.drafts[key]; }
    o.savedAt[key] = now();
    delete _promptShown[key];
    writeStore(o);
    var el = gid("viewBody"); if (el) { removeRecoverUI(el); setInd(el, "", ""); }
    stats.cleared++;
  }

  // ---------------- function wrapping (to learn WHEN a save happened) ----------------
  var _wrapped = []; // {name,orig}
  function wrapSave(name) {
    var orig = safe(function () { return window[name]; });
    if (typeof orig !== "function" || orig.__mlsAsWrapped) return;
    function wrapped() {
      var r;
      try { r = orig.apply(this, arguments); }
      finally {
        // clear after the save runs; if it returns a promise, clear on settle too
        safe(clearForActive);
        if (r && typeof r.then === "function") safe(function () { r.then(function () { safe(clearForActive); }, function () {}); });
      }
      return r;
    }
    wrapped.__mlsAsWrapped = true;
    wrapped.__mlsAsOrig = orig;
    safe(function () { window[name] = wrapped; });
    _wrapped.push({ name: name, orig: orig });
  }
  function unwrapAll() {
    for (var i = 0; i < _wrapped.length; i++) {
      (function (w) {
        safe(function () { if (window[w.name] && window[w.name].__mlsAsWrapped) window[w.name] = w.orig; });
      })(_wrapped[i]);
    }
    _wrapped = [];
  }
  // track the open history note id so #viewBody drafts are keyed to the right note
  function wrapOpenNote() {
    var orig = safe(function () { return window.openNoteFromHistory; });
    if (typeof orig !== "function" || orig.__mlsAsWrapped) return;
    function wrapped(id) {
      safe(function () { _curViewNoteId = (id == null ? "" : String(id)); });
      var r = orig.apply(this, arguments);
      // after the editor populates, evaluate recovery for #viewBody
      safe(function () { setTimeout(function () { var el = gid("viewBody"); if (el) maybePrompt(el); }, 0); });
      return r;
    }
    wrapped.__mlsAsWrapped = true; wrapped.__mlsAsOrig = orig;
    safe(function () { window.openNoteFromHistory = wrapped; });
    _wrapped.push({ name: "openNoteFromHistory", orig: orig });
  }

  // a Save click inside the raw-note modal clears the view draft
  function onModalClick(e) {
    safe(function () {
      var t = e.target; if (!isEl(t)) return;
      var modal = gid("viewModal"); if (!modal || !modal.contains(t)) return;
      var btn = t.closest ? t.closest("button,a,[role=button]") : null;
      var lbl = ((btn && (btn.textContent || btn.value)) || "").toLowerCase();
      if (/\bsave\b/.test(lbl)) safe(function () { setTimeout(clearViewDraft, 0); });
    });
  }

  // ---------------- listeners / observer ----------------
  function onInput(e) {
    var el = e.target; if (fieldFor(el)) scheduleSave(el);
  }
  function onFocus(e) {
    var el = e.target; if (fieldFor(el)) { ensureStyle(); indFor(el); maybePrompt(el); }
  }
  var _scanRaf = 0;
  function scan() {
    ensureStyle();
    for (var i = 0; i < FIELDS.length; i++) {
      var el = gid(FIELDS[i].id);
      if (el) { indFor(el); maybePrompt(el); }
    }
  }
  function scheduleScan() {
    if (_scanRaf || _reverted) return;
    _scanRaf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      _scanRaf = 0; if (!_reverted) safe(scan);
    });
  }

  var _obs = null, _poll = null, _reverted = false, _started = false;
  function start() {
    if (_started) return; _started = true;
    ensureStyle();
    safe(function () { document.addEventListener("input", onInput, true); });
    safe(function () { document.addEventListener("focusin", onFocus, true); });
    safe(function () { document.addEventListener("click", onModalClick, true); });
    ["saveCurrentNote", "saveNotes", "saveNoteToBackend"].forEach(wrapSave);
    wrapOpenNote();
    safe(function () {
      _obs = new MutationObserver(function () { if (!_reverted) scheduleScan(); });
      _obs.observe(document.documentElement, { childList: true, subtree: true });
    });
    // a slow poll re-wraps saves that load after us and re-scans for fields
    _poll = setInterval(function () {
      if (_reverted) return;
      safe(function () { ["saveCurrentNote", "saveNotes", "saveNoteToBackend"].forEach(wrapSave); wrapOpenNote(); });
      safe(scan);
    }, 1500);
    safe(scan);
  }

  // ---------------- revert ----------------
  function revert() {
    _reverted = true;
    safe(function () { document.removeEventListener("input", onInput, true); });
    safe(function () { document.removeEventListener("focusin", onFocus, true); });
    safe(function () { document.removeEventListener("click", onModalClick, true); });
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_poll) clearInterval(_poll); });
    for (var id in _timers) { (function (k) { safe(function () { if (_timers[k]) clearTimeout(_timers[k]); }); })(id); }
    unwrapAll();
    // remove our injected UI; never touch the textareas' values
    safe(function () {
      var nodes = document.querySelectorAll(".mls-as-ind,.mls-as-recover");
      for (var i = 0; i < nodes.length; i++) if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
      var st = gid("mls-autosave-style"); if (st && st.parentNode) st.parentNode.removeChild(st);
    });
    safe(function () { window.__mlsAutosave.installed = false; });
    return true;
  }

  // ---------------- public API (also used by the offline jsdom tests) ----------------
  window.__mlsAutosave = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    fields: FIELDS,
    stats: function () { var o = {}; for (var k in stats) if (stats.hasOwnProperty(k)) o[k] = stats[k]; return o; },
    // internals exposed for tests / diagnostics
    _storeKey: storeKey,
    _readStore: readStore,
    _writeStore: writeStore,
    _keyFor: keyFor,
    _scheduleSave: scheduleSave,
    _saveDraftNow: saveDraftNow,
    _maybePrompt: maybePrompt,
    _setViewNoteId: function (id) { _curViewNoteId = (id == null ? "" : String(id)); },
    recover: function (el) { var f = fieldFor(el); if (f) doRecover(el, f); },
    discard: function (el) { var f = fieldFor(el); if (f) doDiscard(el, f); },
    clearForActive: clearForActive,
    clearViewDraft: clearViewDraft,
    scan: function () { safe(scan); },
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  } catch (e) { safe(start); }
})();

/* --- ADDITIVE LOADER (2026-07-01): recording backup module. Lives here because this file is
   loaded on every page with a fresh cache-buster. The module itself is additive + reversible
   (window.__mlsRecBackup.revert()); removing these lines fully retires it. --- */
(function () {
  try {
    if (document.getElementById("mlsRecBackupLdr")) return;
    var s = document.createElement("script");
    s.id = "mlsRecBackupLdr";
    s.src = "/feat_mls_record_backup.js?v=" + Date.now();
    s.async = true;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();

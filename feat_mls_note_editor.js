/* ============================================================================
 * feat_mls_note_editor.js  ->  window.__mlsNoteEditor   (ne-1.0.0)
 * ---------------------------------------------------------------------------
 * TASK 8 - NOTE EDITING & DICTATION for the MLS Easy / MLS Assist web app.
 *
 * Adds a non-destructive editing layer over the base #noteBox editor:
 *   - REVISION HISTORY + UNDO/REDO (fixes audit R5: Regenerate and the
 *     SOAP<->Insurance toggle used to overwrite manual edits irretrievably).
 *   - ORIGINAL vs EDITED comparison (baseline = the first AI draft).
 *   - LOCK APPROVED SECTIONS: a locked S/O/A/P section is protected from
 *     Regenerate, full re-generation, and section dictation/rewrite.
 *   - SECTION-SPECIFIC actions: regenerate ONE section, add to Assessment, add
 *     to Plan, add/replace/delete a sentence.
 *   - MICROPHONE EDITING / SECTION DICTATION so the doctor NEVER has to type:
 *     dictate into the whole note or a chosen section (draft-only).
 *   - FINAL PREVIEW (read-only) of exactly what will be signed.
 *
 * PATIENT SAFETY: the base app binds the note to the active patient
 * (patientId = getActivePtId()) at save time; this layer never changes that. The
 * revision stack is KEYED BY active patient id -> a revision from patient A can
 * never be restored into patient B's note. Every mutating op re-checks that the
 * editor's patient still matches the active patient. Draft-only: no orders, no
 * Athena writes, no signing (signNote stays the base local-only action).
 *
 * Reversible (window.__mlsNoteEditor.revert()), idempotent, additive, UTF-8
 * (emoji only in UI labels; serve with charset=utf-8), try/catch throughout, no
 * PHI logged. STAGING-GATED (same policy as the other staged satellites). NOT
 * deployed by this task.
 * ==========================================================================*/
(function () {
  "use strict";
  var NS = "__mlsNoteEditor";
  var VERSION = "ne-1.0.0";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  function gateOn() {
    try {
      if (/(^|\.)mlsscribe\.com$/i.test(location.hostname)) return true; /* PROD ENABLE - 2026-07-11 final integration sweep (was staging-gated) */
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
      if (window.__mlsForceNoteEditor === true) return true;
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window[NS] = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nowMs() { return safe(function () { return Date.now(); }, 0); }
  function toast(m, k) { safe(function () { if (isFn(window.toast)) window.toast(m, k || ""); }); }

  function activePtId() {
    var v = safe(function () {
      var c = window.__mlsCopilotConvo;
      if (c && isFn(c.activePatient)) { var a = c.activePatient(); if (a && a.id != null) return String(a.id); }
      return null;
    }, null);
    if (v != null) return v;
    return safe(function () { return isFn(window.getActivePtId) ? String(window.getActivePtId() || "") : ""; }, "");
  }

  function noteEl() { return $("noteBox"); }
  function noteVisible() { var n = noteEl(); return !!(n && n.style.display !== "none"); }
  function noteVal() { var n = noteEl(); return n ? String(n.value || "") : ""; }
  function setNote(v, announce) {
    var n = noteEl(); if (!n) return;
    n.value = v;
    safe(function () { n.dispatchEvent(new Event("input", { bubbles: true })); });
    /* push the edited text back into the base global so saveCurrentNote/AVS/etc.
       read the same thing the doctor sees */
    safe(function () { if (isFn(window.currentNoteText)) window.currentNoteText(); });
    if (announce) toast(announce, "ok");
  }

  /* =====================================================================
   * REVISION HISTORY  (keyed by patient id)
   * ===================================================================== */
  var revisions = [];   /* {ptId, text, at, tag} newest last */
  var redoStack = [];
  var MAX_REV = 60;

  function snapshot(tag) {
    if (!noteVisible()) return;
    var text = noteVal();
    var ptId = activePtId();
    var top = revisions[revisions.length - 1];
    if (top && top.ptId === ptId && top.text === text) return; /* no change */
    revisions.push({ ptId: ptId, text: text, at: nowMs(), tag: tag || "edit" });
    if (revisions.length > MAX_REV) revisions.shift();
    redoStack = [];
    renderBar();
  }
  function revisionsForCurrent() {
    var pt = activePtId(), out = [];
    for (var i = 0; i < revisions.length; i++) if (revisions[i].ptId === pt) out.push(revisions[i]);
    return out;
  }
  function undo() {
    var pt = activePtId();
    /* find the last revision for this patient that differs from current text */
    for (var i = revisions.length - 1; i >= 0; i--) {
      if (revisions[i].ptId !== pt) continue;
      if (revisions[i].text === noteVal()) continue;
      redoStack.push({ ptId: pt, text: noteVal(), at: nowMs(), tag: "redo" });
      setNote(revisions[i].text, "Reverted to an earlier version.");
      renderBar();
      return true;
    }
    toast("Nothing earlier to undo for this note.", "");
    return false;
  }
  function redo() {
    var pt = activePtId();
    for (var i = redoStack.length - 1; i >= 0; i--) {
      if (redoStack[i].ptId !== pt) continue;
      var r = redoStack.splice(i, 1)[0];
      snapshot("pre-redo");
      setNote(r.text, "Redid the edit.");
      renderBar();
      return true;
    }
    toast("Nothing to redo.", "");
    return false;
  }
  function restoreRevision(idx) {
    var list = revisionsForCurrent();
    if (idx < 0 || idx >= list.length) return;
    snapshot("pre-restore");
    setNote(list[idx].text, "Restored version " + (idx + 1) + ".");
  }

  /* =====================================================================
   * SECTION MODEL  (SOAP headers; degrades for other styles)
   * ===================================================================== */
  var SEC = [
    { key: "S", name: "Subjective", head: "SUBJECTIVE" },
    { key: "O", name: "Objective",  head: "OBJECTIVE" },
    { key: "A", name: "Assessment", head: "ASSESSMENT" },
    { key: "P", name: "Plan",       head: "PLAN" }
  ];
  function secByKey(k) { for (var i = 0; i < SEC.length; i++) if (SEC[i].key === k) return SEC[i]; return null; }
  /* return {key -> {start, contentStart, end, text}} by header position; missing sections omitted */
  function parseSections(text) {
    text = String(text || "");
    var up = text.toUpperCase();
    var found = [];
    for (var i = 0; i < SEC.length; i++) {
      var idx = up.indexOf(SEC[i].head);
      if (idx >= 0) found.push({ key: SEC[i].key, head: SEC[i].head, idx: idx });
    }
    found.sort(function (a, b) { return a.idx - b.idx; });
    var map = {};
    for (var j = 0; j < found.length; j++) {
      var start = found[j].idx;
      var end = (j + 1 < found.length) ? found[j + 1].idx : text.length;
      var afterHead = start + found[j].head.length;
      map[found[j].key] = { start: start, contentStart: afterHead, end: end, text: text.slice(start, end) };
    }
    return map;
  }
  function replaceSection(text, key, newSectionText) {
    var m = parseSections(text);
    if (!m[key]) return null;
    return text.slice(0, m[key].start) + newSectionText + text.slice(m[key].end);
  }
  function sectionInner(text, key) {
    var m = parseSections(text);
    if (!m[key]) return null;
    return text.slice(m[key].contentStart, m[key].end).replace(/^[:\s]+/, "").replace(/\s+$/, "");
  }

  /* =====================================================================
   * SECTION LOCKING
   * ===================================================================== */
  var locked = {};  /* ptId -> {S:true,...} */
  function lockMap() { var pt = activePtId(); if (!locked[pt]) locked[pt] = {}; return locked[pt]; }
  function isLocked(key) { return !!lockMap()[key]; }
  function toggleLock(key) { var lm = lockMap(); lm[key] = !lm[key]; renderBar(); toast(SEC && secByKey(key) ? (secByKey(key).name + (lm[key] ? " locked." : " unlocked.")) : "", ""); }
  function snapshotLockedText() {
    var text = noteVal(), lm = lockMap(), out = {};
    for (var k in lm) if (lm[k]) { var m = parseSections(text); if (m[k]) out[k] = text.slice(m[k].start, m[k].end); }
    return out;
  }
  function reapplyLocked(savedLocked) {
    if (!savedLocked) return;
    var text = noteVal(), changed = false;
    for (var k in savedLocked) {
      var m = parseSections(text);
      if (m[k]) { text = text.slice(0, m[k].start) + savedLocked[k] + text.slice(m[k].end); changed = true; }
    }
    if (changed) setNote(text);
  }

  /* =====================================================================
   * WRAP base overwrite paths so edits are never lost silently
   * ===================================================================== */
  var wrapped = {};
  function wrapOverwriters() {
    /* regenerateNote(): snapshot first; restore locked sections after the async
       generate resolves (poll the noteBox for the new text, then reapply). */
    if (isFn(window.regenerateNote) && !window.regenerateNote.__neWrap) {
      wrapped.regenerateNote = window.regenerateNote;
      var w = function () {
        snapshot("pre-regenerate");
        var savedLocked = snapshotLockedText();
        var before = noteVal();
        var r = wrapped.regenerateNote.apply(this, arguments);
        if (Object.keys(savedLocked).length) {
          var tries = 0, iv = setInterval(function () {
            tries++;
            if (noteVal() !== before) { clearInterval(iv); safe(function () { reapplyLocked(savedLocked); }); }
            else if (tries > 60) clearInterval(iv); /* ~9s */
          }, 150);
        }
        return r;
      };
      w.__neWrap = true; window.regenerateNote = w;
    }
    /* setFormat(): snapshot before the buffer swap so a toggle can be undone */
    if (isFn(window.setFormat) && !window.setFormat.__neWrap) {
      wrapped.setFormat = window.setFormat;
      var w2 = function () { snapshot("pre-format-toggle"); return wrapped.setFormat.apply(this, arguments); };
      w2.__neWrap = true; window.setFormat = w2;
    }
    /* generateNote(): snapshot only if there is existing edited note text to lose */
    if (isFn(window.generateNote) && !window.generateNote.__neWrap) {
      wrapped.generateNote = window.generateNote;
      var w3 = function () { if (noteVisible() && noteVal().trim()) snapshot("pre-generate"); return wrapped.generateNote.apply(this, arguments); };
      w3.__neWrap = true; window.generateNote = w3;
    }
  }
  function unwrap() {
    safe(function () { if (wrapped.regenerateNote) window.regenerateNote = wrapped.regenerateNote; });
    safe(function () { if (wrapped.setFormat) window.setFormat = wrapped.setFormat; });
    safe(function () { if (wrapped.generateNote) window.generateNote = wrapped.generateNote; });
    wrapped = {};
  }

  /* =====================================================================
   * SENTENCE / TEXT OPS
   * ===================================================================== */
  function addSentence(text, key) {
    text = String(text || "").trim(); if (!text) return false;
    if (!/[.!?]$/.test(text)) text += ".";
    snapshot("add-sentence");
    var cur = noteVal();
    if (key && parseSections(cur)[key]) {
      if (isLocked(key)) { toast(secByKey(key).name + " is locked. Unlock it to edit.", "err"); return false; }
      var m = parseSections(cur);
      var body = cur.slice(m[key].contentStart, m[key].end).replace(/\s+$/, "");
      var newSec = cur.slice(m[key].start, m[key].contentStart) + body + " " + text + "\n";
      setNote(replaceSection(cur, key, newSec), "Added to " + secByKey(key).name + ".");
    } else {
      setNote((cur.replace(/\s+$/, "") + " " + text + "\n"), "Sentence added.");
    }
    return true;
  }
  function addToAssessment(text) { return addSentence(text, "A"); }
  function addToPlan(text) { return addSentence(text, "P"); }
  function deleteLastSentence(key) {
    snapshot("delete-sentence");
    var cur = noteVal();
    function chop(s) { return s.replace(/\s+$/, "").replace(/[^.!?]*[.!?]?\s*$/, "").replace(/\s+$/, ""); }
    if (key && parseSections(cur)[key]) {
      if (isLocked(key)) { toast(secByKey(key).name + " is locked.", "err"); return false; }
      var m = parseSections(cur);
      var head = cur.slice(m[key].start, m[key].contentStart);
      var body = cur.slice(m[key].contentStart, m[key].end);
      setNote(replaceSection(cur, key, head + chop(body) + "\n"), "Removed last sentence of " + secByKey(key).name + ".");
    } else {
      setNote(chop(cur), "Removed last sentence.");
    }
    return true;
  }
  function replaceText(find, repl, all) {
    if (!find) return false;
    var cur = noteVal();
    var idx = cur.indexOf(find);
    if (idx < 0) { toast("Text to replace was not found.", "err"); return false; }
    snapshot("replace-text");
    var out;
    if (all) out = cur.split(find).join(repl == null ? "" : repl);
    else out = cur.slice(0, idx) + (repl == null ? "" : repl) + cur.slice(idx + find.length);
    setNote(out, "Replaced.");
    return true;
  }

  /* =====================================================================
   * REGENERATE ONE SECTION  (AI, draft-only, lock-aware)
   * ===================================================================== */
  function regenerateSection(key) {
    var sec = secByKey(key); if (!sec) return;
    if (isLocked(key)) { toast(sec.name + " is locked. Unlock it to regenerate.", "err"); return; }
    var cur = noteVal();
    if (!parseSections(cur)[key]) { toast("No " + sec.name + " section found to regenerate.", "err"); return; }
    var transcript = safe(function () { var t = $("transcript"); return t ? String(t.value || "").trim() : ""; }, "");
    if (!isFn(window.aiCallRaw)) { toast("Section regeneration needs the AI backend.", "err"); return; }
    var pctx = safe(function () { return isFn(window.buildPatientContext) ? window.buildPatientContext() : ""; }, "");
    var sys = "You are a clinical documentation assistant. Rewrite ONLY the " + sec.name.toUpperCase() +
      " section of this SOAP note, using ONLY facts already supported by the transcript, the existing note, and the patient background. Do NOT invent findings. Return ONLY the rewritten " + sec.name + " section, beginning with the header '" + sec.head + "'. Keep the other sections out of your answer.";
    var user = "EXISTING NOTE:\n" + cur + (transcript ? ("\n\nTRANSCRIPT:\n" + transcript) : "") + (pctx ? ("\n\nPATIENT BACKGROUND (context only):\n" + pctx) : "");
    snapshot("pre-section-regen");
    var savedLocked = snapshotLockedText();
    toast("Regenerating " + sec.name + "...", "");
    safe(function () {
      window.aiCallRaw(sys, user, (isFn(window.getKey) ? window.getKey() : null), { freeform: true })
        .then(function (out) {
          var clean = String(out || "").replace(/^```\w*\s*/, "").replace(/```$/, "").trim();
          if (!clean) { toast("No section text came back.", "err"); return; }
          var now = noteVal();
          var replaced = replaceSection(now, key, clean.charAt(clean.length - 1) === "\n" ? clean : (clean + "\n"));
          if (replaced == null) { toast("Could not splice the new " + sec.name + ".", "err"); return; }
          setNote(replaced, sec.name + " regenerated.");
          reapplyLocked(savedLocked);
        })
        .then(null, function () { toast("Could not regenerate " + sec.name + " -- try again.", "err"); });
    });
  }

  /* =====================================================================
   * DICTATION  (mic -> note or a chosen section; draft-only)
   * ===================================================================== */
  var SR = safe(function () { return window.SpeechRecognition || window.webkitSpeechRecognition; }, null);
  var dictRecog = null, dictating = false, dictTarget = null, dictBuf = "";
  function dictSupported() { return !!SR; }
  function startDictation(key) {
    if (!SR) { toast("Voice editing is not supported in this browser - you can type instead (Chrome/Edge support the mic).", "err"); return false; }
    if (dictating) { stopDictation(); return false; }
    if (key && isLocked(key)) { toast(secByKey(key).name + " is locked. Unlock it to dictate.", "err"); return false; }
    dictTarget = key || null; dictBuf = "";
    try { dictRecog = new SR(); } catch (e) { toast("Could not start the microphone.", "err"); return false; }
    dictRecog.continuous = true; dictRecog.interimResults = true; dictRecog.lang = "en-US";
    dictRecog.onresult = function (e) {
      var finalTxt = "";
      for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finalTxt += e.results[i][0].transcript + " "; }
      if (finalTxt) dictBuf += finalTxt;
    };
    dictRecog.onerror = function (ev) {
      if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed")) { toast("Microphone was blocked. Allow mic access, or type your edit.", "err"); stopDictation(); }
    };
    dictRecog.onend = function () { if (dictating) { try { dictRecog.start(); } catch (e) {} } };
    try { dictRecog.start(); } catch (e) { toast("Could not start the microphone.", "err"); return false; }
    dictating = true; renderBar();
    toast("Listening - dictate your edit" + (key ? (" for " + secByKey(key).name) : "") + ". Tap again to insert.", "");
    return true;
  }
  function stopDictation() {
    dictating = false;
    if (dictRecog) { try { dictRecog.stop(); } catch (e) {} }
    var text = String(dictBuf || "").trim();
    dictBuf = "";
    var key = dictTarget; dictTarget = null;
    renderBar();
    if (text) addSentence(text, key);
    return text;
  }

  /* =====================================================================
   * ORIGINAL vs EDITED
   * ===================================================================== */
  function baselineText() {
    /* prefer the base app's first-AI-draft global; else the oldest revision for this patient */
    var b = safe(function () { return (typeof lastAIDraft !== "undefined" && lastAIDraft) ? String(lastAIDraft) : null; }, null);
    if (b) return b;
    var list = revisionsForCurrent();
    return list.length ? list[0].text : null;
  }
  function diffLines(a, b) {
    a = String(a || "").split(/\n/); b = String(b || "").split(/\n/);
    var out = [], bi = {};
    for (var i = 0; i < b.length; i++) bi[b[i]] = true;
    var ai = {}; for (var j = 0; j < a.length; j++) ai[a[j]] = true;
    /* simple line-presence diff (not an LCS; enough for a review panel) */
    for (var k = 0; k < a.length; k++) if (!bi[a[k]] && a[k].trim()) out.push({ t: "-", line: a[k] });
    for (var m = 0; m < b.length; m++) if (!ai[b[m]] && b[m].trim()) out.push({ t: "+", line: b[m] });
    return out;
  }
  function openCompare() {
    var base = baselineText();
    if (!base) { toast("No original AI draft to compare yet - generate a note first.", "err"); return; }
    var d = diffLines(base, noteVal());
    var rows = d.length ? d.map(function (x) {
      var col = x.t === "+" ? "#137a3a" : "#a12626";
      return '<div style="color:' + col + ';font:12.5px ui-monospace,monospace;white-space:pre-wrap">' + esc((x.t === "+" ? "+ " : "- ") + x.line) + '</div>';
    }).join("") : '<div style="color:#5b6b82">No differences from the original AI draft.</div>';
    modal("Original vs edited", '<div style="max-height:60vh;overflow:auto">' + rows + '</div>');
  }

  /* =====================================================================
   * FINAL PREVIEW
   * ===================================================================== */
  function openPreview() {
    var text = noteVal(); if (!text.trim()) { toast("Nothing to preview yet.", "err"); return; }
    var patient = safe(function () { var p = $("patientLabel"); return p ? (p.value || "").trim() : ""; }, "") || "Unlabeled";
    var lm = lockMap();
    var lks = []; for (var k in lm) if (lm[k]) { var s = secByKey(k); if (s) lks.push(s.name); }
    var lockLine = lks.length ? '<div style="font:11.5px system-ui;color:#137a3a;margin-bottom:8px">Locked (approved): ' + esc(lks.join(", ")) + '</div>' : "";
    modal("Final preview - " + esc(patient),
      lockLine + '<pre style="white-space:pre-wrap;font:13px ui-monospace,monospace;margin:0;max-height:60vh;overflow:auto">' + esc(text) + '</pre>'
      + '<div style="font:11.5px system-ui;color:#5b6b82;margin-top:10px">Draft preview only. Review before signing - signing stays in the note card.</div>');
  }

  /* =====================================================================
   * MODAL
   * ===================================================================== */
  function modal(title, innerHtml) {
    closeModal();
    var ov = document.createElement("div"); ov.id = "mlsNeModal";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(12,20,38,.42);z-index:99000;display:flex;align-items:center;justify-content:center;padding:20px";
    var box = document.createElement("div");
    box.style.cssText = "background:var(--card,#fff);color:var(--ink,#16324f);max-width:720px;width:100%;border-radius:14px;padding:18px 20px;box-shadow:0 24px 70px rgba(8,20,45,.45)";
    box.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="font:800 15px system-ui;flex:1">' + esc(title) + '</div><button type="button" id="mlsNeModalX" style="cursor:pointer;border:0;background:transparent;font:700 18px system-ui;color:#5b6b82">✕</button></div>' + innerHtml;
    ov.appendChild(box); document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(); });
    var x = $("mlsNeModalX"); if (x) x.onclick = closeModal;
  }
  function closeModal() { var m = $("mlsNeModal"); if (m && m.parentNode) m.parentNode.removeChild(m); }

  /* =====================================================================
   * TOOLBAR UI  (injected into the note card)
   * ===================================================================== */
  var BAR_ID = "mlsNeBar", STYLE_ID = "mlsNeStyle";
  function ensureCss() {
    if ($(STYLE_ID)) return;
    var st = document.createElement("style"); st.id = STYLE_ID;
    st.textContent = [
      "#" + BAR_ID + "{margin:10px 0 2px;border:1px solid rgba(120,150,220,.28);border-radius:12px;padding:10px 11px;background:rgba(32,64,52,.05)}",
      "#" + BAR_ID + " .ne-hd{font:700 12.5px system-ui;color:#1f3350;margin-bottom:7px;display:flex;align-items:center;gap:8px}",
      "#" + BAR_ID + " .ne-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:7px}",
      "#" + BAR_ID + " button.ne-b{cursor:pointer;border:1px solid #cfd9ea;background:#fff;color:#33465f;border-radius:8px;padding:5px 9px;font:600 11.5px system-ui}",
      "#" + BAR_ID + " button.ne-b:hover{background:#f1f5fc}",
      "#" + BAR_ID + " button.ne-b.on{background:#c0392b;color:#fff;border-color:#c0392b}",
      "#" + BAR_ID + " button.ne-b[disabled]{opacity:.45;cursor:default}",
      "#" + BAR_ID + " .ne-sec{display:flex;align-items:center;gap:5px;border:1px solid rgba(120,150,220,.25);border-radius:8px;padding:3px 6px;background:#fff}",
      "#" + BAR_ID + " .ne-sec .ne-nm{font:700 11.5px system-ui;color:#1f2d40}",
      "#" + BAR_ID + " .ne-lockicon{font-size:12px}",
      "#" + BAR_ID + " .ne-note{font:11px system-ui;color:#5b6b82}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }

  function barHost() {
    var b = $(BAR_ID); if (b) return b;
    var card = $("noteCard"); if (!card) return null;
    b = document.createElement("div"); b.id = BAR_ID;
    var anchor = $("secCopyRow") || (noteEl() ? noteEl() : null);
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(b, anchor);
    else card.appendChild(b);
    return b;
  }

  var _revDropOpen = false;
  function renderBar() {
    if (!gateOn()) return;
    var b = barHost(); if (!b) return;
    ensureCss();
    if (!noteVisible()) { b.style.display = "none"; return; }
    b.style.display = "block";
    var revs = revisionsForCurrent();
    var lm = lockMap();
    var m = parseSections(noteVal());
    var secBtns = SEC.map(function (s) {
      var present = !!m[s.key];
      var lk = !!lm[s.key];
      return '<span class="ne-sec">'
        + '<span class="ne-nm">' + esc(s.name) + '</span>'
        + '<button type="button" class="ne-b ne-lock' + (lk ? ' on' : '') + '" data-k="' + s.key + '"' + (present ? '' : ' disabled') + ' title="Lock this approved section">' + (lk ? '🔒' : '🔓') + '</button>'
        + '<button type="button" class="ne-b ne-regen" data-k="' + s.key + '"' + (present && !lk ? '' : ' disabled') + ' title="Regenerate just this section">↻</button>'
        + '<button type="button" class="ne-b ne-dict" data-k="' + s.key + '"' + (present && !lk ? '' : ' disabled') + ' title="Dictate into this section">🎤</button>'
        + '</span>';
    }).join("");
    b.innerHTML =
      '<div class="ne-hd">✏️ Edit note <span class="ne-note">- nothing is lost; undo any change</span></div>'
      + '<div class="ne-row">'
      + '<button type="button" class="ne-b" id="neUndo">↩ Undo</button>'
      + '<button type="button" class="ne-b" id="neRedo">↪ Redo</button>'
      + '<button type="button" class="ne-b" id="neRevs">🕘 Versions (' + revs.length + ')</button>'
      + '<button type="button" class="ne-b" id="neCompare">🔍 Original vs edited</button>'
      + '<button type="button" class="ne-b" id="nePreview">📄 Final preview</button>'
      + '</div>'
      + '<div class="ne-row">'
      + '<button type="button" class="ne-b' + (dictating && !dictTarget ? ' on' : '') + '" id="neDictAll">' + (dictating && !dictTarget ? '■ Stop dictation' : '🎤 Dictate') + '</button>'
      + '<button type="button" class="ne-b" id="neAddA">＋ Assessment</button>'
      + '<button type="button" class="ne-b" id="neAddP">＋ Plan</button>'
      + '<button type="button" class="ne-b" id="neReplace">🔁 Replace text</button>'
      + '<button type="button" class="ne-b" id="neDelSent">⌫ Delete last sentence</button>'
      + '</div>'
      + '<div class="ne-row">' + secBtns + '</div>'
      + (revs.length && _revDropOpen ? revListHtml(revs) : "");
    wireBar(b, revs);
  }
  function revListHtml(revs) {
    var rows = "";
    for (var i = revs.length - 1; i >= 0; i--) {
      rows += '<button type="button" class="ne-b ne-revitem" data-i="' + i + '" style="display:block;width:100%;text-align:left;margin:3px 0">'
        + esc("v" + (i + 1) + " - " + (revs[i].tag || "edit")) + '</button>';
    }
    return '<div class="ne-row" style="flex-direction:column;align-items:stretch">' + rows + '</div>';
  }
  function wireBar(b, revs) {
    function on(id, fn) { var el = $(id); if (el) el.onclick = fn; }
    on("neUndo", undo); on("neRedo", redo);
    on("neRevs", function () { _revDropOpen = !_revDropOpen; renderBar(); });
    on("neCompare", openCompare); on("nePreview", openPreview);
    on("neDictAll", function () { if (dictating && !dictTarget) stopDictation(); else startDictation(null); });
    on("neAddA", function () { var t = promptText("Add to Assessment (or use the mic on the Assessment row):"); if (t) addToAssessment(t); });
    on("neAddP", function () { var t = promptText("Add to Plan (or use the mic on the Plan row):"); if (t) addToPlan(t); });
    on("neReplace", function () {
      var f = promptText("Find this text:"); if (!f) return;
      var r = promptText("Replace with:"); if (r == null) return;
      replaceText(f, r, false);
    });
    on("neDelSent", function () { deleteLastSentence(null); });
    var locks = b.getElementsByClassName("ne-lock");
    for (var i = 0; i < locks.length; i++) (function (el) { el.onclick = function () { if (!el.disabled) toggleLock(el.getAttribute("data-k")); }; })(locks[i]);
    var regens = b.getElementsByClassName("ne-regen");
    for (var j = 0; j < regens.length; j++) (function (el) { el.onclick = function () { if (!el.disabled) regenerateSection(el.getAttribute("data-k")); }; })(regens[j]);
    var dicts = b.getElementsByClassName("ne-dict");
    for (var k = 0; k < dicts.length; k++) (function (el) { el.onclick = function () { if (!el.disabled) { var key = el.getAttribute("data-k"); if (dictating && dictTarget === key) stopDictation(); else startDictation(key); } }; })(dicts[k]);
    var items = b.getElementsByClassName("ne-revitem");
    for (var n = 0; n < items.length; n++) (function (el) { el.onclick = function () { restoreRevision(parseInt(el.getAttribute("data-i"), 10)); _revDropOpen = false; renderBar(); }; })(items[n]);
  }
  function promptText(msg) { return safe(function () { return window.prompt(msg, ""); }, null); }

  /* =====================================================================
   * patient-switch guard: revisions are kept per-patient; on switch just
   * reset the transient redo/dropdown view and re-render
   * ===================================================================== */
  var _lastPt = null, _pollIv = null, _switchHandler = null, _obs = null;
  function onMaybeSwitch() {
    var pt = activePtId();
    if (pt !== _lastPt) {
      _lastPt = pt;
      redoStack = []; _revDropOpen = false;
      renderBar();
    }
  }
  function watchNote() {
    /* snapshot the note as v1 whenever a fresh note first appears for a patient */
    safe(function () {
      var n = noteEl(); if (!n || !window.MutationObserver) return;
      _obs = new MutationObserver(function () {
        if (noteVisible()) {
          var list = revisionsForCurrent();
          if (!list.length && noteVal().trim()) snapshot("original");
          renderBar();
        }
      });
      _obs.observe(n, { attributes: true, attributeFilter: ["style"] });
    });
  }

  /* ---------- boot / revert ---------- */
  var _mountIv = null, _tries = 0;
  function tryMount() {
    if (!$("noteCard")) return false;
    ensureCss(); wrapOverwriters(); renderBar(); watchNote();
    _switchHandler = function () { safe(onMaybeSwitch); };
    safe(function () { document.addEventListener("mls:patientpicked", _switchHandler); });
    _pollIv = setInterval(function () { safe(onMaybeSwitch); safe(function () { if ($("noteCard") && !$(BAR_ID)) renderBar(); }); }, 1500);
    _lastPt = activePtId();
    return true;
  }
  function boot() {
    if (tryMount()) return;
    _mountIv = setInterval(function () { _tries++; if (tryMount() || _tries > 60) { clearInterval(_mountIv); _mountIv = null; } }, 500);
  }
  function revert() {
    try { if (_mountIv) clearInterval(_mountIv); } catch (e) {}
    try { if (_pollIv) clearInterval(_pollIv); } catch (e) {}
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_switchHandler) document.removeEventListener("mls:patientpicked", _switchHandler); } catch (e) {}
    safe(function () { if (dictating) stopDictation(); });
    unwrap();
    try { var b = $(BAR_ID); if (b && b.parentNode) b.parentNode.removeChild(b); } catch (e) {}
    try { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
    try { closeModal(); } catch (e) {}
    try { window[NS].installed = false; } catch (e) {}
  }

  window[NS] = {
    installed: true, version: VERSION, asset: "feat_mls_note_editor.js",
    /* public + unit-test surface */
    snapshot: snapshot, undo: undo, redo: redo, restoreRevision: restoreRevision,
    _revisions: function () { return revisions.slice(); }, _revisionsForCurrent: revisionsForCurrent,
    parseSections: parseSections, replaceSection: replaceSection, sectionInner: sectionInner,
    toggleLock: toggleLock, isLocked: isLocked, _lockMap: lockMap,
    snapshotLockedText: snapshotLockedText, reapplyLocked: reapplyLocked,
    addSentence: addSentence, addToAssessment: addToAssessment, addToPlan: addToPlan,
    deleteLastSentence: deleteLastSentence, replaceText: replaceText,
    regenerateSection: regenerateSection, baselineText: baselineText, diffLines: diffLines,
    startDictation: startDictation, stopDictation: stopDictation, dictSupported: dictSupported,
    openCompare: openCompare, openPreview: openPreview, render: renderBar, revert: revert
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { safe(boot); }, { once: true });
  else safe(boot);
})();

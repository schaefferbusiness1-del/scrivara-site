/* =====================================================================
 * feat_fullhistory_pdf.js  —  window.__mlsFullHistoryPdf  (v1.0.0)
 * ---------------------------------------------------------------------
 * Adds ONE action — "🗂 Export full history (PDF)" — to the per-patient
 * visit-history view (§52 #mlsVisitHistoryExt; falls back to the base
 * #mlsVisitHistory / #profileCard).  Clicking it compiles EVERY visit on
 * file for the active patient into ONE well-formatted PDF:
 *
 *   • Cover page: patient name, DOB, MRN (when present), provider,
 *     generated date/time, total visit count, first→last date range, and
 *     an index of every visit (date · type).
 *   • Then each visit in CHRONOLOGICAL order (oldest → newest), one visit
 *     per page: header (date · type/procedure), diagnoses (ICD-10),
 *     procedures (CPT), pain/function scores, medications, the AI visit
 *     summary (clearly labelled), and the note itself.  Operative /
 *     procedure notes are rendered through the SHARED §53 engine
 *     (window.__mlsOpNotePro.normalize) so headings/structure match the
 *     per-note "Save as PDF" exactly.
 *   • Page breaks, per-page footer + page numbers.
 *
 * REUSE, not reinvention:
 *   • PDF library: the app's own window.loadJsPdf() (jsPDF 4.2.1) — the
 *     exact §53/§54 approach; lazy-loads the pinned same-origin build if absent.
 *     NO new PDF library is introduced.
 *   • Op-note formatting: window.__mlsOpNotePro.normalize / .isNormalized.
 *   • Letterhead: window.MLS_OPNOTE_LETTERHEAD (shared with §53/§54).
 *   • Data: window.__mlsVisitModel (getVisits / deriveFromLegacy /
 *     _svcToYMD) over patient.visits[] — REAL visits only; no fabrication.
 *
 * SAFETY / PRIVACY:
 *   • Read-only: never writes a patient/visit, never calls upsertPatient,
 *     never touches athenaOne / the backend / ScribeFlow.html.
 *   • The PDF is generated client-side and saved to the user's device;
 *     nothing is sent anywhere new.  No PHI is written to any console log.
 *   • Honest empty state: a patient with no visits gets a toast and NO
 *     file — it never invents a visit to fill the page.
 *
 * Additive & reversible: own IIFE, all work in try/catch, idempotent,
 * wraps no existing function.  Revert at runtime via
 * window.__mlsFullHistoryPdf.revert(); or just remove the loader line.
 * ===================================================================== */
(function () {
  "use strict";
  if (window.__mlsFullHistoryPdf && window.__mlsFullHistoryPdf.installed) return;

  var VERSION = "1.0.0";
  var isFn = function (f) { return typeof f === "function"; };
  var S = function (x) { return x == null ? "" : String(x); };
  var trim = function (x) { return S(x).trim(); };

  /* ---- live dependency accessors (read each call; load order irrelevant) ---- */
  function MODEL() { return window.__mlsVisitModel; }
  function PRO() { return window.__mlsOpNotePro; }
  function activeP() { try { return isFn(window.activePatient) ? window.activePatient() : null; } catch (e) { return null; } }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  function providerName() {
    return safe(function () { return isFn(window.getName) ? (window.getName() || "") : ""; }) || "";
  }
  function providerSpec() {
    return safe(function () { return isFn(window.getSpec) ? (window.getSpec() || "") : ""; }) || "";
  }

  /* ---- visits (REAL model only; never fabricated) ---- */
  function getVisits(p) {
    var M = MODEL();
    if (M) {
      try { if (isFn(M.deriveFromLegacy)) M.deriveFromLegacy(p); } catch (e) {}
      try { if (isFn(M.getVisits)) return M.getVisits(p) || []; } catch (e) {}
    }
    return Array.isArray(p && p.visits) ? p.visits.slice() : [];
  }
  function ymd(d) {
    var M = MODEL();
    if (M && isFn(M._svcToYMD)) { try { var r = M._svcToYMD(d); if (r) return r; } catch (e) {} }
    var m = S(d).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : "";
  }
  // chronological (oldest first); undated visits sink to the end, stable.
  function chronological(visits) {
    var arr = visits.slice();
    arr.sort(function (a, b) {
      var da = ymd(a && a.date), db = ymd(b && b.date);
      if (da && db) return da.localeCompare(db);
      if (da) return -1; if (db) return 1; return 0;
    });
    return arr;
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(d) {
    var y = ymd(d);
    if (y) { var p = y.split("-"); return MONTHS[(+p[1] || 1) - 1] + " " + (+p[2]) + ", " + p[0]; }
    return trim(d) || "(undated)";
  }

  /* ---- jsPDF: reuse the app's own loader (the §53/§54 approach) ---- */
  function ensureJsPdf() {
    if (isFn(window.loadJsPdf)) return window.loadJsPdf();
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf);
    return new Promise(function (resolve, reject) {
      var ex = document.getElementById("jspdfScript");
      var ok = function () { (window.jspdf && window.jspdf.jsPDF) ? resolve(window.jspdf) : reject(new Error("jsPDF unavailable")); };
      if (ex) { ex.addEventListener("load", ok); ex.addEventListener("error", function () { reject(new Error("jsPDF load error")); }); return; }
      var s = document.createElement("script"); s.id = "jspdfScript";
      s.src = "vendor/jspdf.umd-4.2.1.min.js?v=e6551fcdc32f09d6";
      s.onload = ok; s.onerror = function () { reject(new Error("jsPDF load error")); };
      document.head.appendChild(s);
    });
  }
  // jsPDF standard-14 fonts are Latin-1 only; strip what won't render (mirror §53).
  function pdfSafe(s) {
    return S(s).replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"')
      .replace(/[–—−]/g, "-").replace(/…/g, "...")
      .replace(/[•●▪·]/g, "-")
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
  }

  /* ---- op-note heading detection (mirrors the §53 engine's render pass) ---- */
  function isHeadingLine(line) {
    var t = S(line).replace(/\s*:\s*$/, "").trim();
    if (!t || t.length > 60) return false;
    if (/[a-z]/.test(t)) return false;
    if (!/[A-Z]/.test(t)) return false;
    return /:\s*$/.test(line) || (!/[.;]/.test(t));
  }
  function stripColon(s) { return S(s).replace(/\s*:\s*$/, ""); }

  // Decide whether a visit's raw note should be rendered as a structured
  // operative/procedure note via the shared engine.
  function looksLikeOpNote(text, v) {
    var t = S(text);
    if (!t.trim()) return false;
    var P = PRO();
    if (P && isFn(P.isNormalized)) { try { if (P.isNormalized(t)) return true; } catch (e) {} }
    if (/operative\s*\/?\s*procedure note|preoperative diagnosis|description of procedure|procedure\(s\) performed|procedures? performed/i.test(t)) return true;
    var typ = (S(v && v.type) + " " + t).toLowerCase();
    if (/inject|tfesi|\besi\b|epidural|\bblock\b|facet|\brfa\b|ablation|rhizotom|denervation|medial branch|kyphoplast|discectomy|operat|\bstim\b/.test(typ)
        && /\bcpt\b|\d{5}/.test(t)) return true;
    return false;
  }

  /* ---- the best available raw note text for a visit (no fabrication) ---- */
  function rawNoteText(v) {
    var r = trim(v && v.raw);
    if (r) return r;
    return ""; // raw is the captured text; if absent we render the structured fields only
  }

  /* =====================================================================
   * BUILD THE COMBINED PDF
   * ===================================================================== */
  function slug(s) {
    return S(s).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "patient";
  }
  function todayStamp() {
    var d = new Date();
    return d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
  }

  function toast(msg, kind) {
    if (safe(function () { if (isFn(window.toast)) { window.toast(msg, kind); return true; } })) return;
    try {
      var t = document.createElement("div");
      t.textContent = msg;
      t.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:" +
        (kind === "err" ? "#b3261e" : "#204034") + ";color:#fff;padding:9px 16px;border-radius:9px;" +
        "font-size:13px;z-index:2147483600;box-shadow:0 4px 14px rgba(0,0,0,.25)";
      document.body.appendChild(t);
      setTimeout(function () { t.style.transition = "opacity .4s"; t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 420); }, 1900);
    } catch (e) {}
  }

  // returns a Promise<boolean> — true if a PDF was saved.
  function build(p) {
    p = p || activeP();
    if (!p) { toast("Open a patient first.", "err"); return Promise.resolve(false); }
    var visits = chronological(getVisits(p));
    var patientName = trim(p.name) || trim(p.fullName) || "Patient";
    // HONEST empty state — never invent a visit to fill the document.
    if (!visits.length) {
      toast("No visits on file for " + patientName + " — nothing to export.", "err");
      return Promise.resolve(false);
    }

    return ensureJsPdf().then(function (ns) {
      try {
        var jsPDF = ns.jsPDF;
        var doc = new jsPDF({ unit: "pt", format: "letter" });
        var pageW = doc.internal.pageSize.getWidth();
        var pageH = doc.internal.pageSize.getHeight();
        var margin = 56, maxW = pageW - margin * 2, lineH = 14;
        var y = margin;
        var lh = window.MLS_OPNOTE_LETTERHEAD || {};
        var prov = providerName(), spec = providerSpec();

        function ensure(h) { if (y + (h || 0) > pageH - margin - 28) { doc.addPage(); y = margin; } }
        function write(txt, fs, bold, color, indent) {
          doc.setFont("helvetica", bold ? "bold" : "normal");
          doc.setFontSize(fs);
          if (color) doc.setTextColor(color[0], color[1], color[2]); else doc.setTextColor(20, 34, 48);
          var x = margin + (indent || 0);
          var lines = doc.splitTextToSize(pdfSafe(txt), maxW - (indent || 0));
          for (var i = 0; i < lines.length; i++) { ensure(lineH); doc.text(lines[i], x, y); y += lineH; }
        }
        function rule(col) {
          doc.setDrawColor(col ? col[0] : 225, col ? col[1] : 233, col ? col[2] : 241);
          doc.setLineWidth(col ? 1.2 : 0.5);
          doc.line(margin, y, pageW - margin, y); y += col ? 16 : 8;
        }
        function letterhead() {
          if (lh.clinicName) {
            doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(21, 95, 179);
            doc.text(pdfSafe(lh.clinicName), margin, y); y += 18;
            doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(95, 113, 134);
            (lh.addressLines || []).forEach(function (a) { doc.text(pdfSafe(a), margin, y); y += 12; });
          } else {
            doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(21, 95, 179);
            doc.text("MLS", margin, y);
            doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(95, 113, 134);
            doc.text(spec || "Physical Medicine, Rehabilitation & Pain", margin + 42, y); y += 16;
          }
          doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(95, 113, 134);
          if (prov) doc.text(pdfSafe("Provider: " + prov + (spec && lh.clinicName ? (" · " + spec) : "")), pageW - margin, margin, { align: "right" });
          doc.text(pdfSafe("Generated: " + new Date().toLocaleString()), pageW - margin, margin + 12, { align: "right" });
          y = Math.max(y, margin + 26);
          rule([31, 122, 224]);
        }

        /* ---------- COVER ---------- */
        letterhead();
        doc.setTextColor(21, 95, 179); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
        ensure(lineH); doc.text("COMPLETE VISIT HISTORY", margin, y); y += 22;

        write("Patient: " + patientName, 11.5, true);
        if (trim(p.dob)) write("Date of birth: " + trim(p.dob), 10.5, false);
        if (trim(p.mrn)) write("MRN: " + trim(p.mrn), 10.5, false);

        // honest range / counts from REAL dated visits
        var dated = visits.map(function (v) { return ymd(v.date); }).filter(Boolean).sort();
        var rangeStr = dated.length
          ? (fmtDate(dated[0]) + "  →  " + fmtDate(dated[dated.length - 1]))
          : "no dated visits";
        var undatedN = visits.length - dated.length;
        write("Total visits on file: " + visits.length, 10.5, false);
        write("Date range: " + rangeStr + (undatedN ? ("  (" + undatedN + " undated)") : ""), 10.5, false);
        y += 6;

        // INDEX of visits
        write("VISITS IN THIS DOCUMENT", 12, true, [21, 95, 179]);
        rule();
        visits.forEach(function (v, i) {
          var t = trim(v.type) || "Visit";
          write((i + 1) + ".  " + fmtDate(v.date) + "  —  " + t, 10, false, null, 6);
        });
        y += 8;
        write("Confidential — contains protected health information. Compiled from this patient's visit record for documentation, referral, or records-request purposes. Review and complete any [bracketed] items before relying on this document.",
          8.5, false, [120, 130, 140]);

        /* ---------- ONE PAGE PER VISIT, chronological ---------- */
        visits.forEach(function (v, i) {
          doc.addPage(); y = margin;

          // visit header band
          doc.setTextColor(21, 95, 179); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
          ensure(lineH);
          var head = "VISIT " + (i + 1) + " OF " + visits.length + "  —  " + fmtDate(v.date);
          doc.text(pdfSafe(head), margin, y); y += 16;
          var typ = trim(v.type);
          if (typ) { write(typ, 11, true, [40, 52, 74]); }
          rule([31, 122, 224]);

          // quick facts (real fields only)
          var dx = (v.icd10 || []).filter(Boolean);
          var cpt = (v.cpt || []).filter(Boolean);
          var meds = (v.meds || []).filter(Boolean);
          if (dx.length) write("Diagnoses (ICD-10): " + dx.join(", "), 10, false);
          if (cpt.length) write("Procedures (CPT): " + cpt.join(", "), 10, false);
          var scoreBits = [];
          var sc = v.scores && typeof v.scores === "object" ? v.scores : null;
          if (sc) {
            Object.keys(sc).forEach(function (k) {
              var val = sc[k]; if (val == null || val === "") return;
              scoreBits.push(k + ": " + val);
            });
          }
          if (scoreBits.length) write("Scores: " + scoreBits.join("  ·  "), 10, false);
          if (meds.length) write("Medications: " + meds.join(", "), 10, false);
          if (dx.length || cpt.length || scoreBits.length || meds.length) y += 4;

          // AI visit summary (clearly labelled as AI-generated)
          var aiSum = trim(v.aiSummary);
          if (aiSum) {
            write("VISIT SUMMARY (AI-generated)", 11, true, [21, 95, 179]);
            rule();
            write(aiSum, 10.5, false);
            y += 6;
          }

          // the note itself
          var raw = rawNoteText(v);
          if (raw && looksLikeOpNote(raw, v)) {
            // reuse the SHARED §53 engine to structure the op/procedure note
            var pro = raw, P = PRO();
            try {
              if (P && isFn(P.normalize)) {
                var meta = { patient: patientName, dob: trim(p.dob), mrn: trim(p.mrn), provider: prov, spec: spec, dop: ymd(v.date) };
                pro = (isFn(P.isNormalized) && P.isNormalized(raw)) ? raw : P.normalize(raw, meta);
              }
            } catch (e) { pro = raw; }
            write("OPERATIVE / PROCEDURE NOTE", 11, true, [21, 95, 179]);
            rule();
            renderOpBody(pro);
          } else {
            var findings = trim(v.findings), plan = trim(v.plan);
            var shownAny = false;
            if (findings) { write("FINDINGS", 11, true, [21, 95, 179]); rule(); write(findings, 10.5, false); y += 6; shownAny = true; }
            if (plan) { write("PLAN", 11, true, [21, 95, 179]); rule(); write(plan, 10.5, false); y += 6; shownAny = true; }
            if (raw) {
              write("FULL CAPTURED VISIT TEXT", 11, true, [21, 95, 179]); rule();
              write(raw, 10, false); shownAny = true;
            }
            if (!shownAny && !aiSum && !dx.length && !cpt.length && !meds.length && !scoreBits.length) {
              write("No documented content recorded for this visit.", 10.5, false, [120, 130, 140]);
            }
          }
        });

        // render the normalized op note body with the engine's heading hierarchy
        function renderOpBody(pro) {
          var lines = S(pro).split("\n");
          var started = false;
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!started) { if (/OPERATIVE \/ PROCEDURE NOTE/.test(line)) { started = true; continue; } }
            if (!line.trim()) { y += lineH * 0.5; continue; }
            if (isHeadingLine(line)) {
              y += 4; ensure(lineH + 6);
              write(stripColon(line), 10.5, true, [21, 95, 179]);
              continue;
            }
            write(line, 10, false);
          }
        }

        /* ---------- footer / page numbers on every page ---------- */
        var pc = doc.internal.getNumberOfPages();
        for (var pg = 1; pg <= pc; pg++) {
          doc.setPage(pg);
          doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(150);
          doc.text("Page " + pg + " of " + pc, pageW - margin, pageH - 24, { align: "right" });
          doc.text("Complete visit history — compiled with MLS from this patient's visit record. Confidential / PHI.", margin, pageH - 24);
        }
        doc.setTextColor(0);

        var fname = "VisitHistory_" + slug(patientName) + "_" + todayStamp() + ".pdf";
        doc.save(fname);
        toast("Saved " + fname + " (" + visits.length + " visit" + (visits.length === 1 ? "" : "s") + ")", "ok");
        return true;
      } catch (e) {
        toast("Could not build the visit-history PDF.", "err");
        return false;
      }
    }, function () {
      toast("Could not load the PDF engine — check your connection.", "err");
      return false;
    });
  }

  function exportActive() { return build(activeP()); }

  /* =====================================================================
   * BUTTON WIRING  (idempotent; re-mounts as the view re-renders)
   * ===================================================================== */
  function injectCss() {
    if (document.getElementById("mlsFhpdfCss")) return;
    var st = document.createElement("style"); st.id = "mlsFhpdfCss";
    st.textContent =
      ".mlsfhpdf-btn{cursor:pointer;border:1px solid #2E6A4B;background:#2E6A4B;color:#fff;border-radius:8px;" +
      "padding:6px 11px;font:inherit;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:5px}" +
      ".mlsfhpdf-btn:hover{background:#2E6A4B;border-color:#2E6A4B}" +
      ".mlsfhpdf-btn[disabled]{opacity:.6;cursor:default}";
    (document.head || document.documentElement).appendChild(st);
  }
  function mkBtn() {
    var b = document.createElement("button");
    b.type = "button"; b.className = "mlsfhpdf-btn"; b.setAttribute("data-mls-fhpdf", "1");
    b.textContent = "🗂 Export full history (PDF)";
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      try {
        Promise.resolve(exportActive()).then(function () { b.disabled = false; }, function () { b.disabled = false; });
      } catch (err) { b.disabled = false; }
    });
    return b;
  }
  // mount into the §52 header if present, else the base history header, else profile card.
  function wire() {
    if (!activeP()) return;
    injectCss();
    var ext = document.getElementById("mlsVisitHistoryExt");
    if (ext) {
      if (ext.querySelector("[data-mls-fhpdf]")) return;
      var headEl = ext.querySelector(".mlsxh-head") || ext;
      headEl.appendChild(mkBtn());
      return;
    }
    var base = document.getElementById("mlsVisitHistory");
    if (base) {
      if (base.querySelector("[data-mls-fhpdf]")) return;
      var bh = base.querySelector(".mlsvh-head, .mlsvd-head") || base;
      bh.appendChild(mkBtn());
      return;
    }
    var card = document.getElementById("profileCard");
    if (card && card.offsetParent !== null) {
      if (card.querySelector("[data-mls-fhpdf]")) return;
      var holder = document.createElement("div");
      holder.setAttribute("data-mls-fhpdf-holder", "1");
      holder.style.cssText = "margin:10px 0";
      holder.appendChild(mkBtn());
      card.appendChild(holder);
    }
  }
  function removeButtons() {
    safe(function () {
      Array.prototype.forEach.call(document.querySelectorAll("[data-mls-fhpdf]"), function (b) { b.remove(); });
      Array.prototype.forEach.call(document.querySelectorAll("[data-mls-fhpdf-holder]"), function (h) { h.remove(); });
      var st = document.getElementById("mlsFhpdfCss"); if (st) st.remove();
    });
  }

  var _iv = null, _mo = null;
  function start() {
    safe(wire);
    _iv = setInterval(function () { safe(wire); }, 1000);
    safe(function () {
      _mo = new MutationObserver(function () { safe(wire); });
      _mo.observe(document.body, { childList: true, subtree: true });
    });
  }
  function revert() {
    safe(function () { if (_iv) clearInterval(_iv); _iv = null; });
    safe(function () { if (_mo) _mo.disconnect(); _mo = null; });
    removeButtons();
  }

  window.__mlsFullHistoryPdf = {
    installed: true,
    version: VERSION,
    build: build,            // build(patient) -> Promise<boolean>
    exportActive: exportActive,
    rewire: function () { safe(wire); },
    revert: revert,
    _looksLikeOpNote: looksLikeOpNote,
    _chronological: chronological
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

/* ============================================================================
 * feat_mls_outcome_pdf.js  —  MLS "Outcome Study" report exports (PDF + SVG)
 * ----------------------------------------------------------------------------
 * ADDITIVE, REVERSIBLE companion to mls-outcome-study(.staging).js. It does NOT
 * replace or duplicate that tool — it hooks the Outcome Study *results* panel
 * (#ocBody, the same panel that already renders the SVG trend chart + the
 * aggregate stat tables + the per-patient detail table and offers CSV / Excel
 * export) and adds two more outputs the clinician asked for:
 *
 *   1.  "PDF" — a multi-page PDF cohort report (title + summary narrative, the
 *       trend chart, the aggregate VAS/short-form stat tables, and the full
 *       per-patient detail table). The per-patient section paginates, so a large
 *       cohort naturally scales the report (hundreds of patients -> many pages,
 *       up to ~100+).
 *   2.  "SVG" — downloads the on-screen trend chart as a standalone .svg vector.
 *
 * HONEST SOURCING: every number in the PDF/SVG is read from the LIVE rendered
 * results panel (the exact values the clinician sees and that the existing Excel
 * export writes). Nothing is recomputed, estimated, or fabricated. If the cohort
 * scores are blank (e.g. live-Athena score extraction is untuned for a sheet),
 * the report faithfully shows them blank rather than inventing numbers.
 *
 * GUARDRAILS honoured:
 *   - Additive & reversible:  window.__mlsOutcomePdf.revert()
 *   - NO body-subtree MutationObserver. Uses one lightweight, low-frequency
 *     interval that only ever does a couple of getElementById lookups + injects
 *     two buttons. It is idempotent and cheap, and revert() clears it.
 *   - athenaOne read-only: this module never touches Athena at all (pure export).
 *   - Never deletes / modifies / clears any patient record, roster, note, or
 *     appointment. It only reads the already-rendered DOM and writes a file blob.
 *   - No PHI/secrets baked into this source. (Patient names appear only at
 *     runtime, in the clinician's own downloaded file — same as the existing
 *     Excel/CSV export — and the report carries a HIPAA-handling footer.)
 *   - jsPDF: reuses the app's own loader / the exact pinned local 4.2.1 UMD build the
 *     other PDF modules use; graceful honest message if it can't load.
 *
 * Self-contained IIFE, own scope, try/catch throughout, silent no-op if the
 * Outcome Study panel is not present.
 * ==========================================================================*/
;(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsOutcomePdf && window.__mlsOutcomePdf.__booted) return;

  var TIMER = null;

  /* ---------------------------------------------------------------- *
   * jsPDF loader — reuse the app's own (the same approach the other
   * PDF modules use): window.jspdf.jsPDF, else lazy-load the same-origin asset.
   * ---------------------------------------------------------------- */
  function ensureJsPdf() {
    return new Promise(function (resolve, reject) {
      try {
        if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf);
        if (typeof window.loadJsPdf === 'function') {
          try {
            var p = window.loadJsPdf();
            if (p && typeof p.then === 'function') {
              return p.then(function () {
                (window.jspdf && window.jspdf.jsPDF) ? resolve(window.jspdf) : reject(new Error('jsPDF unavailable'));
              }, function () { lazy(); });
            }
          } catch (e) { /* fall through to lazy */ }
        }
        lazy();
      } catch (e) { reject(e); }

      function lazy() {
        var ex = document.getElementById('jspdfScript');
        var done = function () { (window.jspdf && window.jspdf.jsPDF) ? resolve(window.jspdf) : reject(new Error('jsPDF unavailable')); };
        if (ex) { ex.addEventListener('load', done); ex.addEventListener('error', function () { reject(new Error('jsPDF load error')); }); return; }
        var s = document.createElement('script');
        s.id = 'jspdfScript';
        s.src = 'vendor/jspdf.umd-4.2.1.min.js?v=e6551fcdc32f09d6';
        s.onload = done;
        s.onerror = function () { reject(new Error('jsPDF load error')); };
        (document.head || document.documentElement).appendChild(s);
      }
    });
  }

  /* ---------------------------------------------------------------- *
   * Helpers
   * ---------------------------------------------------------------- */
  // jsPDF standard fonts are Latin-1; map common unicode, strip the rest.
  function san(v) {
    var s = (v == null) ? '' : String(v);
    s = s.replace(/—/g, '-').replace(/–/g, '-')
         .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
         .replace(/•/g, '*').replace(/→/g, '->')
         .replace(/[≤]/g, '<=').replace(/[≥]/g, '>=')
         .replace(/±/g, '+/-').replace(/[…]/g, '...');
    return s.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
  }

  function stamp() {
    var d = new Date(); function p(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  // The results panel root: the on-demand Outcome Study results live in #ocBody.
  function resultsRoot() {
    var x = document.getElementById('ocExpXlsx');
    if (!x) return null;                     // results panel not rendered
    var root = document.getElementById('ocBody');
    if (root && root.contains(x)) return root;
    // fallback: climb from the Excel button to a container that has the chart
    var n = x;
    for (var i = 0; i < 8 && n; i++) { if (n.querySelector && n.querySelector('table')) return n; n = n.parentNode; }
    return root || (x.parentNode && x.parentNode.parentNode) || null;
  }

  function tableToMatrix(tbl) {
    var out = [];
    if (!tbl) return out;
    var trs = tbl.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var cells = trs[i].querySelectorAll('th,td'), row = [];
      for (var j = 0; j < cells.length; j++) row.push((cells[j].textContent || '').replace(/\s+/g, ' ').trim());
      if (row.length) out.push(row);
    }
    return out;
  }

  // Match each <table> in the panel to its bold title div (by DOM order).
  function collectSections(root) {
    var tables = root.querySelectorAll('table');
    var labels = [];
    var divs = root.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      var st = (divs[i].getAttribute && divs[i].getAttribute('style')) || '';
      if (/font-weight\s*:\s*600/.test(st) && divs[i].children.length === 0) labels.push(divs[i]);
    }
    var sections = [];
    for (var t = 0; t < tables.length; t++) {
      var tbl = tables[t], title = '';
      for (var l = labels.length - 1; l >= 0; l--) {
        // last label that precedes this table in document order
        if (labels[l].compareDocumentPosition(tbl) & Node.DOCUMENT_POSITION_FOLLOWING) {
          title = (labels[l].textContent || '').replace(/\s+/g, ' ').trim(); break;
        }
      }
      sections.push({ title: title || ('Table ' + (t + 1)), matrix: tableToMatrix(tbl) });
    }
    return sections;
  }

  function summaryText(root) {
    var d = root.querySelector('div[style*="max-width:560px"]');
    return d ? (d.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function serializeSVG(svg) {
    if (!svg) return '';
    var clone = svg.cloneNode(true);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // currentColor in a detached SVG falls back to black — fine on white paper.
    clone.setAttribute('color', '#1E2B24');
    var s = new XMLSerializer().serializeToString(clone);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + s;
  }

  // Rasterise the chart SVG to a PNG dataURL (for embedding in the PDF).
  function svgToPng(svg) {
    return new Promise(function (resolve) {
      try {
        if (!svg) return resolve(null);
        var vb = (svg.getAttribute('viewBox') || '0 0 620 200').split(/\s+/);
        var w = parseFloat(vb[2]) || 620, h = parseFloat(vb[3]) || 200, scale = 2;
        var xml = serializeSVG(svg);
        var url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
        var img = new Image();
        img.onload = function () {
          try {
            var cv = document.createElement('canvas');
            cv.width = w * scale; cv.height = h * scale;
            var ctx = cv.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, 0, 0, cv.width, cv.height);
            resolve({ data: cv.toDataURL('image/png'), w: w, h: h });
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = url;
      } catch (e) { resolve(null); }
    });
  }

  function download(name, content, mime) {
    try {
      var url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }));
      var a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { document.body.removeChild(a); } catch (e) {} URL.revokeObjectURL(url); }, 250);
    } catch (e) {}
  }

  function toast(msg, kind) {
    try { if (typeof window.toast === 'function') { window.toast(msg, kind || ''); return; } } catch (e) {}
    try { console.log('[OutcomePDF] ' + msg); } catch (e) {}
  }

  /* ---------------------------------------------------------------- *
   * PDF build
   * ---------------------------------------------------------------- */
  function buildPdf() {
    var root = resultsRoot();
    if (!root) { toast('Open an Outcome Study result first, then export.', 'err'); return; }
    var summary = summaryText(root);
    var sections = collectSections(root);
    var svg = root.querySelector('svg');

    toast('Building PDF report...', '');
    Promise.all([ensureJsPdf(), svgToPng(svg)]).then(function (res) {
      var ns = res[0], png = res[1];
      try {
        var jsPDF = ns.jsPDF;
        var doc = new jsPDF({ unit: 'pt', format: 'letter' });
        var M = 44;
        var pageW = doc.internal.pageSize.getWidth();
        var pageH = doc.internal.pageSize.getHeight();
        var y = M;

        function footer() {
          var pg = doc.internal.getNumberOfPages();
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150);
          doc.text(san('MLS Outcome Study - de-identify before any external/research use; handle per your privacy & HIPAA policies.'), M, pageH - 22);
          doc.text('Page ' + pg, pageW - M, pageH - 22, { align: 'right' });
        }
        function ensure(h) { if (y + (h || 0) > pageH - M - 30) { footer(); doc.addPage(); y = M; } }
        function para(text, fs, color, lh, gap) {
          fs = fs || 10; lh = lh || (fs + 3);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
          doc.setTextColor(color ? color[0] : 40, color ? color[1] : 50, color ? color[2] : 70);
          var lines = doc.splitTextToSize(san(text), pageW - 2 * M);
          for (var i = 0; i < lines.length; i++) { ensure(lh); doc.text(lines[i], M, y); y += lh; }
          if (gap) y += gap;
        }

        // ---- Title block ----
        doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(21, 95, 179);
        ensure(24); doc.text('MLS Outcome Study', M, y); y += 24;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(40, 50, 70);
        ensure(18); doc.text('Cohort outcomes report', M, y); y += 18;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 120, 140);
        ensure(14); doc.text(san('Generated ' + new Date().toLocaleString()), M, y); y += 18;
        doc.setDrawColor(207, 215, 230); ensure(8); doc.line(M, y, pageW - M, y); y += 16;

        // ---- Summary narrative ----
        if (summary) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(21, 95, 179);
          ensure(16); doc.text('Summary', M, y); y += 16;
          para(summary, 10, [40, 50, 70], 14, 8);
        }

        // ---- Trend chart ----
        if (png && png.data) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(21, 95, 179);
          ensure(16); doc.text('Mean scores over time', M, y); y += 14;
          var iw = pageW - 2 * M, ih = iw * (png.h / png.w);
          if (ih > 230) { ih = 230; iw = ih * (png.w / png.h); }
          ensure(ih + 8);
          try { doc.addImage(png.data, 'PNG', M, y, iw, ih); } catch (e) {}
          y += ih + 16;
        } else if (svg) {
          para('(Trend chart could not be rasterised in this browser; see the on-screen chart and the .svg export.)', 9, [150, 90, 30], 13, 8);
        }

        // ---- Tables (aggregate stat tables + per-patient detail) ----
        for (var s = 0; s < sections.length; s++) {
          drawTable(sections[s].title, sections[s].matrix);
        }

        function drawTable(title, matrix) {
          if (!matrix || !matrix.length) return;
          ensure(22);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(21, 95, 179);
          doc.text(san(title), M, y); y += 14;

          var cols = matrix[0].length;
          var avail = pageW - 2 * M;
          // first column wider (labels / patient names)
          var w0 = Math.min(avail * 0.30, 150);
          var wRest = (avail - w0) / Math.max(1, cols - 1);
          var widths = []; for (var c = 0; c < cols; c++) widths.push(c === 0 ? w0 : wRest);
          var rowH = 14, fs = (cols > 8) ? 7.5 : 8.5;

          function clip(t, w, f) {
            t = san(t); doc.setFontSize(f);
            while (t.length && doc.getTextWidth(t) > w - 6) t = t.slice(0, -1);
            return t;
          }
          function headerRow() {
            ensure(rowH + 2);
            doc.setFillColor(238, 242, 249); doc.rect(M, y - 10, avail, rowH, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(fs); doc.setTextColor(60, 72, 92);
            var x = M;
            for (var c = 0; c < cols; c++) { doc.text(clip(matrix[0][c], widths[c], fs), x + 3, y); x += widths[c]; }
            y += rowH;
          }
          headerRow();
          doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 50, 70);
          for (var r = 1; r < matrix.length; r++) {
            if (y + rowH > pageH - M - 30) { footer(); doc.addPage(); y = M; doc.setFontSize(fs); headerRow(); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 50, 70); }
            doc.setFontSize(fs);
            var x2 = M, row = matrix[r];
            for (var c2 = 0; c2 < cols; c2++) { doc.text(clip(row[c2] != null ? row[c2] : '', widths[c2], fs), x2 + 3, y); x2 += widths[c2]; }
            doc.setDrawColor(232, 236, 244); doc.line(M, y + 3, pageW - M, y + 3);
            y += rowH;
          }
          y += 12;
        }

        footer();
        doc.save('outcome_study_report_' + stamp() + '.pdf');
        toast('PDF report downloaded (' + doc.internal.getNumberOfPages() + ' pages).', 'ok');
      } catch (e) {
        toast('PDF build failed: ' + (e && e.message ? e.message : e), 'err');
        try { console.error('[OutcomePDF]', e); } catch (_) {}
      }
    }, function (err) {
      toast('Could not load the PDF engine (offline?). Excel/CSV export still works.', 'err');
      try { console.error('[OutcomePDF] jsPDF load failed', err); } catch (_) {}
    });
  }

  function exportSVG() {
    var root = resultsRoot();
    var svg = root && root.querySelector('svg');
    if (!svg) { toast('No chart to export yet — run an Outcome Study first.', 'err'); return; }
    download('outcome_study_chart_' + stamp() + '.svg', serializeSVG(svg), 'image/svg+xml');
    toast('Chart exported as SVG.', 'ok');
  }

  /* ---------------------------------------------------------------- *
   * Button injection (lightweight, idempotent, reversible)
   * ---------------------------------------------------------------- */
  function btnCss(bg) {
    return 'background:' + bg + ';color:#fff;border:none;padding:8px 12px;border-radius:9px;cursor:pointer;font-size:12.5px;margin-left:6px';
  }

  function inject() {
    try {
      var xlsx = document.getElementById('ocExpXlsx');
      if (!xlsx) return;                               // results panel not up
      if (document.getElementById('ocExpPdf')) return; // already injected
      var pdf = document.createElement('button');
      pdf.id = 'ocExpPdf'; pdf.type = 'button';
      pdf.setAttribute('data-mls-outcome-pdf', '1');
      pdf.style.cssText = btnCss('#c0392b');
      pdf.textContent = '⬇ PDF';
      pdf.addEventListener('click', function (e) { try { e.preventDefault(); } catch (_) {} buildPdf(); });

      var svgb = document.createElement('button');
      svgb.id = 'ocExpSvg'; svgb.type = 'button';
      svgb.setAttribute('data-mls-outcome-pdf', '1');
      svgb.style.cssText = btnCss('#C9DCD2');
      svgb.textContent = '⬇ SVG';
      svgb.addEventListener('click', function (e) { try { e.preventDefault(); } catch (_) {} exportSVG(); });

      // place right after the Excel button
      if (xlsx.parentNode) {
        xlsx.parentNode.insertBefore(pdf, xlsx.nextSibling);
        pdf.parentNode.insertBefore(svgb, pdf.nextSibling);
      }
    } catch (e) { /* silent */ }
  }

  function start() {
    inject();
    if (TIMER) return;
    // lightweight, low-frequency, targeted — NOT a body-subtree observer.
    TIMER = setInterval(inject, 1200);
  }

  /* ---------------------------------------------------------------- *
   * Public, reversible handle
   * ---------------------------------------------------------------- */
  window.__mlsOutcomePdf = {
    __booted: true,
    version: '1.0.0',
    buildPdf: buildPdf,
    exportSVG: exportSVG,
    inject: inject,
    revert: function () {
      try { if (TIMER) { clearInterval(TIMER); TIMER = null; } } catch (e) {}
      try {
        var b = document.querySelectorAll('[data-mls-outcome-pdf]');
        for (var i = 0; i < b.length; i++) if (b[i].parentNode) b[i].parentNode.removeChild(b[i]);
      } catch (e) {}
      this.__booted = false;
      return true;
    }
  };

  try { start(); } catch (e) { /* silent no-op */ }

})();

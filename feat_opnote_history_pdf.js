/*!
 * feat_opnote_history_pdf.js
 * Additive feature: one-click "PDF" button on visit-history rows that hold an
 * operative note. Clicking it downloads the formatted op-note PDF immediately,
 * reusing the existing mls-opnote-pro PDF engine (no engine rebuilt here).
 *
 * Safe/additive contract:
 *   - Does NOT modify or mutate any stored note content.
 *   - Only reads notes via window.getNotes() and the op-note-pro engine.
 *   - Only renders buttons for entries whose kind === 'opnote'.
 *   - Idempotent; guarded; debounced observer; no other feature touched.
 */
(function () {
  'use strict';
  if (window.__mlsOpNoteHistPdf) return;        // load-once guard
  window.__mlsOpNoteHistPdf = 1;

  var TAG = '[opnote-hist-pdf]';
  var BTN_CLASS = 'opnote-hist-pdf-btn';

  function engine() { return window.__mlsOpNotePro || null; }

  function notes() {
    try { return (typeof window.getNotes === 'function' && window.getNotes()) || []; }
    catch (e) { return []; }
  }

  function isOpNote(n) { return !!(n && n.kind === 'opnote'); }

  // Resolve the note object for a history row via the note id embedded in the
  // row's openNoteFromHistory(...) click handler. Robust to sort/filter/search.
  function noteIdForRow(row) {
    try {
      if (row.onclick) {
        var m = row.onclick.toString().match(/openNoteFromHistory\(\s*['"]([^'"]+)['"]/);
        if (m) return m[1];
      }
    } catch (e) {}
    return null;
  }

  function patientLabelForRow(row) {
    var main = row.querySelector('.hist-main');
    var t = (main ? main.textContent : row.textContent) || '';
    // Title line looks like: "Name — descriptor (op note)"
    var first = t.split('\n')[0];
    var name = first.split('—')[0];
    return (name || '').trim();
  }

  function downloadPdf(noteId, patient) {
    var eng = engine();
    var n = notes().filter(function (x) { return x.id === noteId; })[0];
    var txt = n && n.text;
    if (!txt) { (window.toast||window.alert)('No op-note content found for this entry.'); return; }
    var opts = { patient: patient || (n && n.patient) || '', title: 'Operative Report' };
    if (n && n.created) opts.date = new Date(n.created);
    try {
      // Primary: same engine entry the in-app "Save as PDF" button uses.
      if (typeof window.__mlsOpNotePdf === 'function') {
        /* b824: opts was built two lines up with the note record's own date and
           then dropped here, so the PDF fell back to today. Pass it. */
        window.__mlsOpNotePdf(function () { return txt; }, opts.patient, opts);
        return;
      }
      // Fallback: direct engine export (normalizes raw text internally).
      if (eng && typeof eng.exportPdf === 'function') {
        eng.exportPdf(txt, opts);
        return;
      }
      (window.toast||window.alert)('Op-note PDF engine is not available yet. Please retry in a moment.');
    } catch (e) {
      console.error(TAG, 'export failed', e);
      (window.toast||window.alert)('Could not generate the PDF: ' + (e && e.message ? e.message : e));
    }
  }

  function makeButton(noteId) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = BTN_CLASS;
    b.textContent = '📄 PDF';                // 📄 PDF
    b.title = 'Download the formatted operative-note PDF (one click)';
    b.setAttribute('aria-label', 'Download operative note PDF');
    b.style.cssText =
      'margin-right:6px;padding:4px 8px;font-size:12px;line-height:1;' +
      'border:1px solid #c7d2e8;border-radius:6px;background:#eef3ff;' +
      'color:#204034;cursor:pointer;white-space:nowrap;';
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();                  // do NOT trigger row open
      var row = b.closest('.hist-item');
      downloadPdf(noteId, row ? patientLabelForRow(row) : '');
    }, false);
    return b;
  }

  function decorate() {
    var all = notes();
    var rows = document.querySelectorAll('.hist-item');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector('.' + BTN_CLASS)) continue;   // already decorated
      var id = noteIdForRow(row);
      var note = null;
      if (id) { note = all.filter(function (x) { return x.id === id; })[0]; }
      if (!note && all.length === rows.length) { note = all[i]; } // index fallback
      if (!isOpNote(note)) continue;
      var btn = makeButton(note.id || id);
      // Place the PDF button just before the Athena button, else before trash.
      var athena = null, del = row.querySelector('button.del'), bs = row.querySelectorAll('button');
      for (var j = 0; j < bs.length; j++) { if (/Athena/.test(bs[j].textContent)) { athena = bs[j]; break; } }
      var anchor = athena || del;
      if (anchor && anchor.parentNode === row) row.insertBefore(btn, anchor);
      else row.appendChild(btn);
    }
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; try { decorate(); } catch (e) { console.error(TAG, e); } }, 120);
  }

  function init() {
    schedule();
    try {
      var mo = new MutationObserver(schedule);
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    // Re-decorate right after the app re-renders history.
    if (typeof window.renderHistory === 'function' && !window.renderHistory.__opnotePdfPatched) {
      var orig = window.renderHistory;
      window.renderHistory = function () {
        var r = orig.apply(this, arguments);
        schedule();
        return r;
      };
      window.renderHistory.__opnotePdfPatched = true;
    }
    console.log(TAG, 'ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ============================================================================
 * feat_opnote_pdf_anyview.js  ->  window.__mlsOpNotePdfAnyView   (v1.0.0)
 * ---------------------------------------------------------------------------
 * FIX 2 — "Save as PDF" missing on the note/visit detail reached via the
 * "all scheduled patients" view.
 *
 * The easy "📄 Save as PDF" works on some note surfaces (the §53 op-note builder
 * bar; and, where feat_opnote_onscreen v1.2.0 is active, the §45 per-visit detail
 * card + §47 note-detail modal). But when a note/visit is opened from the "all
 * scheduled patients" view there is no Save-as-PDF button.
 *
 * Every visit/note DETAIL in this app is rendered by the ONE shared renderer
 * __mlsVisitDetail.buildRead(), which always emits a read body containing an
 * action row ".mlsvd-acts" (Edit / Regenerate / status). This asset keys off
 * that shared structure rather than any one view's class name: for every read
 * action row that shows a real note and has NO Save-as-PDF button, it adds a
 * "📄 Save as PDF" button wired to the EXISTING §53 PDF engine
 * (window.__mlsOpNotePdf) — reused, never rebuilt. Because the all-scheduled
 * detail goes through the same renderer, it is covered too.
 *
 * Idempotent with feat_opnote_onscreen v1.2.0: if a row already has ANY
 * Save-as-PDF button (its .mls-opx-pdf or any button labelled "Save as PDF"),
 * this asset leaves it alone — no duplicates. Where that asset did NOT add one
 * (e.g. the all-scheduled detail), this one does.
 *
 * Secondary, idempotent coverage: the raw-note viewer (#viewModal) — only if it
 * shows a note and has no Save-as-PDF button already (the §53 history viewer may
 * already provide one, in which case this no-ops).
 *
 * getText is read straight from the rendered view (the "Raw captured text" <pre>
 * when present, else the read body text), so the PDF reflects exactly what is on
 * screen. No fabrication, no PHI logged.
 *
 * SAFETY: own IIFE; all external calls in try/catch; idempotent; sends NOTHING
 * to the extension; never signs/saves a chart; no backend / Stripe / extension /
 * ScribeFlow.html changes. Reversible: window.__mlsOpNotePdfAnyView.revert().
 * NUL-free.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsOpNotePdfAnyView && window.__mlsOpNotePdfAnyView.installed) return; } catch (e) {}

  var VERSION = '1.0.0';
  var BTN_CLASS = 'mls-sched-pdf';
  var STYLE_ID = 'mls-sched-pdf-style';

  /* --- tunable: read-view action-row selectors. The shared __mlsVisitDetail
   * renderer emits ".mlsvd-acts"; if a future view uses a different toolbar,
   * add its selector here (and re-validate) — one line, no logic change. ----- */
  var ACT_ROW_SELECTORS = ['.mlsvd-acts'];
  var MIN_NOTE_CHARS = 40;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function gid(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function S(x) { return x == null ? '' : String(x); }

  function engineReady() { return isFn(window.__mlsOpNotePdf); }

  /* ---------- does a chunk of text look like a real clinical / op note? --- */
  function looksClinical(text) {
    var t = S(text);
    if (t.replace(/\s+/g, ' ').trim().length < MIN_NOTE_CHARS) return false;
    var E = window.__mlsOpNotePro;
    if (E && isFn(E.isNormalized)) { if (safe(function () { return E.isNormalized(t); }, false)) return true; }
    return /\b(pre[\s-]?operative diagnosis|post[\s-]?operative diagnosis|operative note|procedure note|description of procedure|procedure performed|operation performed|anesthesia|assessment|plan|subjective|objective|impression|findings|injection|epidural|diagnosis)\b/i.test(t);
  }

  /* ---------- already has a Save-as-PDF button? (idempotent w/ v1.2.0) ---- */
  function hasPdfButton(container) {
    if (!container) return false;
    if (container.querySelector('.' + BTN_CLASS)) return true;
    if (container.querySelector('.mls-opx-pdf')) return true; // feat_opnote_onscreen v1.2.0
    var btns = container.querySelectorAll('button,a');
    for (var i = 0; i < btns.length; i++) {
      if (/save\s+as\s+pdf/i.test(btns[i].textContent || '')) return true;
    }
    return false;
  }

  /* ---------- extract the on-screen note text from a read body ------------ */
  function readTextFromBody(body) {
    if (!body) return '';
    var pre = body.querySelector('details.mlsvd-raw pre, pre');
    if (pre && S(pre.textContent).trim()) return S(pre.textContent);
    // else: the rendered read text, minus the action row
    var clone = safe(function () { return body.cloneNode(true); }, null);
    if (clone) {
      safe(function () {
        var acts = clone.querySelector('.mlsvd-acts'); if (acts && acts.parentNode) acts.parentNode.removeChild(acts);
      });
      return S(clone.textContent);
    }
    return S(body.textContent);
  }

  function makeBtn() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mlsvd-btn ' + BTN_CLASS;
    btn.textContent = '📄 Save as PDF';
    btn.title = 'Save this note as a PDF';
    return btn;
  }

  /* ---------- (1) read-view action rows (the shared detail renderer) ------ */
  function decorateActsRow(acts) {
    if (!acts) return;
    // find the read body that owns this action row
    var body = acts.closest ? (acts.closest('.mlsvd-body') || acts.parentElement) : acts.parentElement;
    if (!body) return;
    // skip edit mode (an open form / textarea) — PDF belongs on the read view
    if (body.querySelector('textarea, .mlsvd-edit, form')) return;
    if (hasPdfButton(acts) || hasPdfButton(body)) return;
    var text = readTextFromBody(body);
    if (!looksClinical(text)) return;
    var btn = makeBtn();
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!engineReady()) { return; } // engine absent — silent, never a fake save
      var getText = function () { return readTextFromBody(body); };
      safe(function () { window.__mlsOpNotePdf(getText); });
    });
    // place before the status span if present, else at the end of the row
    var status = acts.querySelector('.mlsvd-status');
    acts.insertBefore(btn, status || null);
  }

  /* ---------- (2) raw-note viewer (#viewModal), idempotent --------------- */
  function decorateViewModal() {
    var modal = gid('viewModal');
    if (!modal) return;
    var shown = safe(function () {
      return modal.style.display !== 'none' && (!window.getComputedStyle || getComputedStyle(modal).display !== 'none');
    }, true);
    if (!shown) return;
    if (hasPdfButton(modal)) return; // §53 history viewer may already provide one
    var bodyEl = gid('viewBody');
    var text = bodyEl ? (('value' in bodyEl) ? bodyEl.value : bodyEl.textContent) : '';
    if (!looksClinical(text)) return;
    // host: a button row in the modal, else next to #viewBody
    var host = null;
    var rows = modal.querySelectorAll('.modal-actions, .actions, .btnrow, .row, footer, .mls-actions');
    for (var i = 0; i < rows.length && !host; i++) { if (rows[i].querySelector('button,a')) host = rows[i]; }
    if (!host) host = bodyEl && bodyEl.parentNode ? bodyEl.parentNode : modal;
    var btn = makeBtn();
    btn.setAttribute('data-mls-sched-pdf-vm', '1');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!engineReady()) return;
      var getText = function () { var b = gid('viewBody'); return b ? (('value' in b) ? b.value : b.textContent) : text; };
      safe(function () { window.__mlsOpNotePdf(getText); });
    });
    host.appendChild(btn);
  }

  function sweep() {
    safe(function () {
      for (var s = 0; s < ACT_ROW_SELECTORS.length; s++) {
        var rows = document.querySelectorAll(ACT_ROW_SELECTORS[s]);
        for (var i = 0; i < rows.length; i++) decorateActsRow(rows[i]);
      }
    });
    safe(decorateViewModal);
  }

  /* ---------- style ------------------------------------------------------- */
  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var css =
      '.' + BTN_CLASS + '{cursor:pointer;}' +
      'button.' + BTN_CLASS + ':not(.mlsvd-btn){border:1px solid var(--line,#D6D2C6);background:var(--card,#fff);' +
      'color:var(--ink,#1A211C);border-radius:8px;padding:6px 11px;font:inherit;font-weight:600;margin-left:8px;}';
    var st = document.createElement('style');
    st.id = STYLE_ID; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- keep present (observer + slow poll) ------------------------- */
  var _obs = null, _deb = null, _pollT = null;
  function startObserver() {
    if (_obs) return;
    _obs = new MutationObserver(function (muts) {
      var relevant = false;
      for (var i = 0; i < muts.length; i++) { if (muts[i].addedNodes && muts[i].addedNodes.length) { relevant = true; break; } }
      if (!relevant) return;
      clearTimeout(_deb); _deb = setTimeout(sweep, 40);
    });
    safe(function () { _obs.observe(document.documentElement, { childList: true, subtree: true }); });
    _pollT = setInterval(sweep, 1500);
  }

  /* ---------- revert ------------------------------------------------------ */
  function revert() {
    safe(function () { if (_obs) { _obs.disconnect(); _obs = null; } });
    safe(function () { if (_pollT) { clearInterval(_pollT); _pollT = null; } });
    safe(function () {
      var btns = document.querySelectorAll('.' + BTN_CLASS);
      for (var i = 0; i < btns.length; i++) { if (btns[i].parentNode) btns[i].parentNode.removeChild(btns[i]); }
    });
    safe(function () { var st = gid(STYLE_ID); if (st && st.parentNode) st.parentNode.removeChild(st); });
    safe(function () { window.__mlsOpNotePdfAnyView.installed = false; });
  }

  function boot() { injectStyle(); startObserver(); sweep(); }

  window.__mlsOpNotePdfAnyView = {
    installed: true,
    version: VERSION,
    ACT_ROW_SELECTORS: ACT_ROW_SELECTORS,
    looksClinical: looksClinical,
    hasPdfButton: hasPdfButton,
    readTextFromBody: readTextFromBody,
    decorateActsRow: decorateActsRow,
    decorateViewModal: decorateViewModal,
    sweep: sweep,
    revert: revert
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  } catch (e) { safe(boot); }
})();

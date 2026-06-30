/* ============================================================================
 * feat_mls_ptsnapshot.js  —  item74 (STAGING)
 * ----------------------------------------------------------------------------
 * "Patient snapshot" - a one-click at-a-glance card reachable from the
 * persistent patient bar on every clinical view.
 *
 * WHY (doctor value + connective): the app already builds a compact quick
 * history (visit count, last seen, last pain, active problems) for the
 * bottom-left patient "face". But on the Visit / History / Recs / Orders
 * screens the doctor has to remember to hover a small avatar to get it. This
 * adds a clear "Snapshot" chip in the top patient bar that opens that SAME
 * quick history right where the doctor is looking, and adds two safe shortcut
 * actions - "Open chart" and "Start visit" - so the most common next steps for
 * the active patient are one click away from any surface.
 *
 * CONNECTIVE: it reuses the app's own _patientQuickHistory(p) builder (one
 * consistent snapshot everywhere) and the app's own activePatient() source of
 * truth, and triggers actions through existing app functions (showView,
 * goNewVisitForPatient).
 *
 * GUARDRAILS:
 *   Additive & reversible:  window.__mlsPtSnapshot.revert()
 *   Read + navigation only. Never creates/edits/deletes any record, note or
 *   appointment; never touches athenaOne. "Start visit" calls the app's own
 *   existing goNewVisitForPatient (same as the chart's button) - it does not
 *   itself write any record.
 *   No body-subtree MutationObserver. Wraps renderPatientBar + one 30s backstop.
 *   Idempotent. Self-contained IIFE, try/catch throughout.
 * ==========================================================================*/
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsPtSnapshot && window.__mlsPtSnapshot.__booted) return;

  var WRAP_ID = 'mlsPtSnap';
  var POP_ID = 'mlsPtSnapPop';
  var STYLE_ID = 'mlsPtSnap-style';
  var backTimer = null, origRenderBar = null;

  function activePt() {
    try { if (typeof window.activePatient === 'function') return window.activePatient(); } catch (e) {}
    return null;
  }

  function snapshotHtml(p) {
    // Prefer the app's own builder so the snapshot matches the face card exactly.
    try { if (typeof window._patientQuickHistory === 'function') return window._patientQuickHistory(p); } catch (e) {}
    // Minimal honest fallback if the builder is unavailable.
    var nm = (p && p.name) || 'Patient';
    var demo = [p && p.sex, p && p.dob, (p && p.mrn) ? ('MRN ' + p.mrn) : ''].filter(Boolean).join(' · ');
    return '<b>' + esc(nm) + '</b>' + (demo ? '<br><span style="color:#9fb2c6">' + esc(demo) + '</span>' : '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function closePop() { try { var p = document.getElementById(POP_ID); if (p) p.remove(); document.removeEventListener('mousedown', onDoc, true); } catch (e) {} }
  function onDoc(ev) {
    var pop = document.getElementById(POP_ID), w = document.getElementById(WRAP_ID);
    if (pop && !pop.contains(ev.target) && w && !w.contains(ev.target)) closePop();
  }

  function openChart() { try { if (typeof window.showView === 'function') window.showView('patients'); } catch (e) {} closePop(); }
  function startVisit() {
    try {
      if (typeof window.goNewVisitForPatient === 'function') { window.goNewVisitForPatient(); }
      else if (typeof window.showView === 'function') { window.showView('visit'); }
    } catch (e) {}
    closePop();
  }

  function openPop(anchor) {
    closePop();
    var p = activePt(); if (!p) return;
    var pop = document.createElement('div');
    pop.id = POP_ID;
    pop.innerHTML = '<div class="mps-body">' + snapshotHtml(p) + '</div>' +
      '<div class="mps-actions">' +
      '<button type="button" class="mps-act" data-a="chart">📋 Open chart</button>' +
      '<button type="button" class="mps-act mps-primary" data-a="visit">🎙️ Start visit</button>' +
      '</div>';
    document.body.appendChild(pop);
    try {
      var r = anchor.getBoundingClientRect();
      pop.style.top = Math.round(r.bottom + 6) + 'px';
      pop.style.left = Math.round(Math.min(r.left, window.innerWidth - 270)) + 'px';
    } catch (e) {}
    pop.querySelector('[data-a="chart"]').addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); openChart(); });
    pop.querySelector('[data-a="visit"]').addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); startVisit(); });
    setTimeout(function () { document.addEventListener('mousedown', onDoc, true); }, 0);
  }

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    try {
      var s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent =
        '#' + WRAP_ID + '{display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;}' +
        '#' + WRAP_ID + ' .mps-btn{cursor:pointer;border:1px solid rgba(31,122,224,.34);' +
        'background:rgba(31,122,224,.10);color:#1463c8;font:inherit;font-size:12px;font-weight:600;' +
        'padding:3px 11px;border-radius:999px;display:inline-flex;align-items:center;gap:5px;}' +
        '#' + WRAP_ID + ' .mps-btn:hover{background:rgba(31,122,224,.20);}' +
        '#' + POP_ID + '{position:fixed;z-index:9600;width:248px;background:#13283d;color:#fff;' +
        'border-radius:12px;padding:13px 14px;box-shadow:0 14px 34px rgba(0,0,0,.4);font-size:12.5px;line-height:1.55;}' +
        '#' + POP_ID + ' .mps-body{margin-bottom:11px;}' +
        '#' + POP_ID + ' .mps-actions{display:flex;gap:8px;}' +
        '#' + POP_ID + ' .mps-act{flex:1;cursor:pointer;border:1px solid rgba(255,255,255,.22);' +
        'background:rgba(255,255,255,.07);color:#fff;font:inherit;font-size:12px;font-weight:600;' +
        'padding:7px 6px;border-radius:8px;}' +
        '#' + POP_ID + ' .mps-act:hover{background:rgba(255,255,255,.15);}' +
        '#' + POP_ID + ' .mps-primary{background:#1f7ae0;border-color:#1f7ae0;}' +
        '#' + POP_ID + ' .mps-primary:hover{background:#2f8af0;}' +
        '@media (prefers-color-scheme:dark){#' + WRAP_ID + ' .mps-btn{color:#8fc0f2;}}';
      document.head.appendChild(s);
    } catch (e) {}
  }

  function render() {
    try {
      var bar = document.getElementById('patientBar');
      var inner = document.getElementById('patientBarInner');
      if (!bar || !inner) return;
      var existing = document.getElementById(WRAP_ID);
      var barVisible = bar.style.display !== 'none';
      var p = activePt();
      if (!barVisible || !p) { if (existing) { existing.remove(); } closePop(); return; }

      if (!existing) {
        existing = document.createElement('span');
        existing.id = WRAP_ID;
        if (inner.nextSibling) inner.parentNode.insertBefore(existing, inner.nextSibling);
        else inner.parentNode.appendChild(existing);
      }
      existing.innerHTML = '<button type="button" class="mps-btn" title="Patient snapshot + quick actions">ⓘ Snapshot</button>';
      var btn = existing.querySelector('.mps-btn');
      if (btn) btn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (document.getElementById(POP_ID)) closePop(); else openPop(existing);
      });
    } catch (e) {}
  }

  function wrapRenderBar() {
    try {
      if (typeof window.renderPatientBar === 'function' && !origRenderBar) {
        origRenderBar = window.renderPatientBar;
        window.renderPatientBar = function () {
          var r; try { r = origRenderBar.apply(this, arguments); } catch (e) {}
          try { render(); } catch (e) {}
          return r;
        };
      }
    } catch (e) {}
  }

  function boot() {
    injectCss();
    wrapRenderBar();
    render();
    if (!backTimer) backTimer = setInterval(render, 30000);
  }

  window.__mlsPtSnapshot = {
    __booted: true,
    rerender: render,
    revert: function () {
      try { if (backTimer) { clearInterval(backTimer); backTimer = null; } } catch (e) {}
      try { document.removeEventListener('mousedown', onDoc, true); } catch (e) {}
      try { if (origRenderBar) { window.renderPatientBar = origRenderBar; origRenderBar = null; } } catch (e) {}
      try { closePop(); } catch (e) {}
      try { var w = document.getElementById(WRAP_ID); if (w) w.remove(); } catch (e) {}
      try { var s = document.getElementById(STYLE_ID); if (s) s.remove(); } catch (e) {}
      try { delete window.__mlsPtSnapshot; } catch (e) { window.__mlsPtSnapshot = undefined; }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 550); });
  } else { setTimeout(boot, 550); }
})();

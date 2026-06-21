/* feat_patient_switcher.js — window.__mlsPatientSwitcher (v1.0.0)
 *
 * A clearer, faster per-patient selector / switcher.
 *
 * The old "Switch patient" button just navigated to the Patients tab. This
 * replaces that with a focused, searchable picker overlay:
 *   - type-to-search by name OR DOB (live filter)
 *   - every row shows NAME + DOB (+ visit count) in strong contrast
 *   - full keyboard control: Up/Down to move, Enter to pick, Esc to close
 *   - the ACTIVE patient is clearly marked and pre-selected
 *   - works at narrow widths (down to ~320px) and on big screens
 *   - selecting opens that patient (sets active + opens chart) instantly
 *
 * Additive, own IIFE, all work in try/catch, idempotent, reversible via
 * window.__mlsPatientSwitcher.revert(). Reads the app's existing globals
 * (getPatients / openPatient / selectPatient / getActivePtId / patientNotes)
 * read-only; never writes a chart, never touches Athena, no PHI logged.
 */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  if (window.__mlsPatientSwitcher && window.__mlsPatientSwitcher.installed) return;

  var STYLE_ID = 'mlsps-style';
  var OVL_ID = 'mlsps-overlay';
  var listeners = [];
  var overlay = null, input = null, listEl = null, countEl = null;
  var rows = [];            // [{id,name,dob,sub,...}]
  var activeIdx = -1;       // highlighted row index in the *filtered* view
  var filtered = [];        // current filtered rows

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(x) { return x == null ? '' : String(x); }
  function esc(s) {
    return S(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function norm(s) { return S(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function normDob(s) { return S(s).replace(/[^0-9]/g, ''); }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + OVL_ID + '{position:fixed;inset:0;z-index:2147483640;display:flex;',
      'align-items:flex-start;justify-content:center;background:rgba(8,20,36,.55);',
      'backdrop-filter:saturate(120%) blur(2px);padding:8vh 12px 12px;}',
      '#' + OVL_ID + '[hidden]{display:none;}',
      '.mlsps-panel{width:520px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;',
      'background:#ffffff;color:#0f2233;border:1px solid #c9d6e3;border-radius:14px;overflow:hidden;',
      'box-shadow:0 24px 64px rgba(8,20,36,.34);font:14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;}',
      '.mlsps-hd{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#10294a;color:#fff;}',
      '.mlsps-hd .t{font-weight:700;font-size:14px;}',
      '.mlsps-hd .x{margin-left:auto;cursor:pointer;background:none;border:0;color:#fff;font-size:18px;line-height:1;opacity:.85;}',
      '.mlsps-hd .x:hover{opacity:1;}',
      '.mlsps-srch{padding:10px 12px;border-bottom:1px solid #e6edf4;background:#f7fafd;}',
      '.mlsps-srch input{width:100%;box-sizing:border-box;padding:11px 12px;font-size:15px;color:#0f2233;',
      'border:2px solid #b9cadd;border-radius:9px;outline:none;background:#fff;}',
      '.mlsps-srch input:focus{border-color:#2f6bd6;box-shadow:0 0 0 3px rgba(47,107,214,.18);}',
      '.mlsps-cnt{padding:6px 14px;font-size:11.5px;color:#5a6b7d;border-bottom:1px solid #eef3f8;}',
      '.mlsps-list{list-style:none;margin:0;padding:6px;overflow:auto;flex:1 1 auto;}',
      '.mlsps-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:9px;cursor:pointer;}',
      '.mlsps-row:hover{background:#eef4fb;}',
      '.mlsps-row.sel{background:#dbeafe;outline:2px solid #2f6bd6;}',
      '.mlsps-av{flex:0 0 34px;width:34px;height:34px;border-radius:50%;background:#10294a;color:#fff;',
      'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12.5px;}',
      '.mlsps-meta{min-width:0;flex:1 1 auto;}',
      '.mlsps-nm{font-weight:600;color:#0f2233;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.mlsps-sub{font-size:12px;color:#46586b;margin-top:1px;}',
      '.mlsps-badge{flex:0 0 auto;font-size:10px;font-weight:700;letter-spacing:.03em;color:#0f6b3a;',
      'background:#dcfce7;border:1px solid #86efac;border-radius:999px;padding:2px 8px;}',
      '.mlsps-empty{padding:22px 14px;text-align:center;color:#5a6b7d;}',
      '.mlsps-foot{padding:8px 14px;border-top:1px solid #eef3f8;font-size:11px;color:#758799;background:#fafcfe;}',
      '.mlsps-foot kbd{font:inherit;background:#eef2f7;border:1px solid #cdd8e3;border-bottom-width:2px;',
      'border-radius:5px;padding:0 5px;color:#33485e;}',
      '@media (max-width:420px){.mlsps-panel{border-radius:10px;}.mlsps-av{display:none;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  function getPts() {
    var ps = safe(function () { return (isFn(window.getPatients) ? window.getPatients() : []) || []; }, []) || [];
    return ps.filter(function (p) { return p && (p.name || p.id); });
  }
  function activeId() {
    return safe(function () { return isFn(window.getActivePtId) ? window.getActivePtId() : null; }, null);
  }
  function visitCount(p) {
    return safe(function () {
      if (Array.isArray(p.visits)) return p.visits.length;
      if (isFn(window.patientNotes)) { var v = window.patientNotes(p.id); return Array.isArray(v) ? v.length : null; }
      return null;
    }, null);
  }
  function initials(name) {
    var parts = norm(name).split(' ').filter(Boolean);
    if (!parts.length) return '?';
    var a = parts[0][0] || '';
    var b = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (a + b).toUpperCase();
  }

  function buildRows() {
    var ps = getPts();
    var act = activeId();
    rows = ps.map(function (p) {
      var vc = visitCount(p);
      var sub = (p.dob ? 'DOB ' + S(p.dob) : 'DOB —') + (vc != null ? '  ·  ' + vc + ' visit' + (vc === 1 ? '' : 's') : '');
      return {
        id: p.id, name: S(p.name) || '(unnamed)', dob: S(p.dob), sub: sub,
        isActive: act != null && p.id === act,
        hay: norm(p.name) + ' ' + normDob(p.dob)
      };
    });
    rows.sort(function (a, b) {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  function render(q) {
    var query = norm(q);
    var qdob = normDob(q);
    filtered = !query ? rows.slice() : rows.filter(function (r) {
      if (query && r.hay.indexOf(query) >= 0) return true;
      if (qdob && qdob.length >= 2 && normDob(r.dob).indexOf(qdob) >= 0) return true;
      var toks = query.split(' ').filter(Boolean);
      return toks.length > 1 && toks.every(function (t) { return r.hay.indexOf(t) >= 0; });
    });
    listEl.innerHTML = '';
    if (!filtered.length) {
      var em = document.createElement('div');
      em.className = 'mlsps-empty';
      em.textContent = q ? 'No patients match “' + q + '”.' : 'No patients yet.';
      listEl.appendChild(em);
      countEl.textContent = '0 of ' + rows.length + ' patients';
      activeIdx = -1;
      return;
    }
    filtered.forEach(function (r, i) {
      var li = document.createElement('li');
      li.className = 'mlsps-row' + (i === 0 ? ' sel' : '');
      li.setAttribute('role', 'option');
      li.dataset.id = r.id;
      li.innerHTML =
        '<span class="mlsps-av">' + esc(initials(r.name)) + '</span>' +
        '<span class="mlsps-meta"><div class="mlsps-nm">' + esc(r.name) + '</div>' +
        '<div class="mlsps-sub">' + esc(r.sub) + '</div></span>' +
        (r.isActive ? '<span class="mlsps-badge">ACTIVE</span>' : '');
      li.addEventListener('click', function () { choose(r.id); });
      listEl.appendChild(li);
    });
    activeIdx = 0;
    countEl.textContent = filtered.length + ' of ' + rows.length + ' patients';
  }

  function highlight(idx) {
    var els = listEl.querySelectorAll('.mlsps-row');
    if (!els.length) return;
    if (idx < 0) idx = 0;
    if (idx >= els.length) idx = els.length - 1;
    for (var i = 0; i < els.length; i++) els[i].classList.toggle('sel', i === idx);
    activeIdx = idx;
    var el = els[idx];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function choose(id) {
    close();
    safe(function () {
      if (isFn(window.openPatient)) window.openPatient(id);
      else if (isFn(window.selectPatient)) window.selectPatient(id);
    });
    safe(function () { if (isFn(window.renderProfile)) window.renderProfile(); });
  }

  function ensureOverlay() {
    ensureStyle();
    if (overlay && document.body.contains(overlay)) return;
    overlay = document.createElement('div');
    overlay.id = OVL_ID;
    overlay.setAttribute('hidden', '');
    overlay.innerHTML =
      '<div class="mlsps-panel" role="dialog" aria-label="Switch patient">' +
      '<div class="mlsps-hd"><span class="t">Switch patient</span>' +
      '<button class="x" aria-label="Close" title="Close (Esc)">&#215;</button></div>' +
      '<div class="mlsps-srch"><input type="text" placeholder="Search by name or date of birth…" ' +
      'aria-label="Search patients" autocomplete="off" spellcheck="false"></div>' +
      '<div class="mlsps-cnt"></div>' +
      '<ul class="mlsps-list" role="listbox"></ul>' +
      '<div class="mlsps-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</div>' +
      '</div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('input');
    listEl = overlay.querySelector('.mlsps-list');
    countEl = overlay.querySelector('.mlsps-cnt');
    overlay.querySelector('.x').addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(activeIdx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[activeIdx]) choose(filtered[activeIdx].id); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function open() {
    ensureOverlay();
    buildRows();
    overlay.removeAttribute('hidden');
    input.value = '';
    render('');
    setTimeout(function () { safe(function () { input.focus(); input.select(); }); }, 0);
  }
  function close() { if (overlay) overlay.setAttribute('hidden', ''); }
  function isOpen() { return !!(overlay && !overlay.hasAttribute('hidden')); }

  function isSwitchControl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.classList && el.classList.contains('mlsctx-switch')) return true;
    if (el.getAttribute && el.getAttribute('data-act') === 'switch') return true;
    return norm(el.textContent) === 'switch patient';
  }
  function onDocClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('button,a,[role=button]') : null;
    if (!el) return;
    if (overlay && overlay.contains(el)) return;
    if (isSwitchControl(el)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      open();
    }
  }

  function mount() {
    ensureStyle();
    document.addEventListener('click', onDocClick, true);
    listeners.push(['click', onDocClick, true]);
  }

  function revert() {
    listeners.forEach(function (l) { safe(function () { document.removeEventListener(l[0], l[1], l[2]); }); });
    listeners = [];
    safe(function () { if (overlay) overlay.remove(); });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.remove(); });
    overlay = input = listEl = countEl = null;
    window.__mlsPatientSwitcher.installed = false;
  }

  window.__mlsPatientSwitcher = {
    installed: true,
    version: VERSION,
    asset: 'feat_patient_switcher.js',
    open: open, close: close, isOpen: isOpen,
    _render: render, _buildRows: buildRows, _getRows: function () { return rows; },
    _filtered: function () { return filtered; },
    _isSwitchControl: isSwitchControl,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { safe(mount); }, { once: true });
  else safe(mount);
})();

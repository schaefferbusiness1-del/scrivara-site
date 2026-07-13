/* feat_ease.js — MLS ScribeFlow patient + visit ease-of-use pass (§46)
 * Progressive enhancement only. Own scope, try/catch, idempotent, fully reversible
 * via window.__mlsEase.revert(). Builds on §40 (visit model + 🗂 history UI),
 * §43 (add-patient modal), §45 (per-visit detail). Does NOT touch the §44 ctxbar
 * (#mlsCtxBar / #mlsCardSlot) or any app-core function styling. Synthetic/no-PHI.
 *
 * What it does:
 *  1) ONE clear primary action in the open-patient visit zone: keeps the distinct
 *     purple "Copy every visit from athenaOne" as the primary and adds a single
 *     secondary "➕ Add a visit" beside it (consistent style).
 *  2) Actionable empty state: "No visits yet — add one or copy from Athena." with two
 *     real buttons (➕ Add a visit / 📋 Copy from Athena), so the next step is one click.
 *  3) Add-visit in one click for the OPEN patient: opens the §43 add-patient modal
 *     prefilled with the active patient's name + DOB (the modal merges by name+DOB,
 *     so no duplicate) and focused on the guided visit fields.
 *  4) Sensible defaults in the add modal: Visit date prefilled to today; last visit
 *     type remembered (user-scoped); score inputs get their scales (VAS/NRS 0–10,
 *     ODI 0–100%); the "Type / paste → AI" path is flagged as the fast lane.
 *
 * Triggering is belt-and-suspenders: wraps __mlsVisitUI.render, wraps showView,
 * a guarded #profileCard observer, AND a light idempotent poll — so the open-patient
 * enhancements appear whichever way the profile is shown. Every pass is idempotent
 * (no rewrites once applied), so there is no render churn and the §44 ctxbar is untouched.
 */
(function () {
  'use strict';
  if (window.__mlsEase && window.__mlsEase.installed) { return; }

  var LOG = '[mlsEase]';
  var STYLE_ID = 'mlsEaseStyle';
  var LAST_TYPE_KEY = 'mlsEaseLastVisitType';
  var ADD_TIP = 'Add a visit to this patient — opens the guided form (date is set to today)';

  /* ---------- small helpers ---------- */
  function key(k) {
    try { if (typeof window.uns === 'function') return window.uns(k); } catch (e) {}
    return 'mls::' + k;
  }
  function getStore(k) { try { return window.localStorage.getItem(key(k)) || ''; } catch (e) { return ''; } }
  function setStore(k, v) { try { window.localStorage.setItem(key(k), v); } catch (e) {} }
  function todayYMD() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function activePt() {
    try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; } catch (e) { return null; }
  }
  function el(tag, props, html) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'style') n.setAttribute('style', props[k]);
      else if (k === 'title') n.setAttribute('title', props[k]);
      else if (k === 'class') n.className = props[k];
      else n[k] = props[k];
    });
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------- shared styles (app tokens, with literal fallbacks) ---------- */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.mlsease-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0 2px;}' +
      '.mlsease-btn{display:inline-flex;align-items:center;gap:6px;font:600 13px/1.1 inherit;' +
      'padding:9px 14px;border-radius:var(--r-card,10px);cursor:pointer;border:1px solid var(--line,#E7E5DD);' +
      'background:#fff;color:var(--brand,#204034);transition:filter .12s ease;white-space:nowrap;}' +
      '.mlsease-btn:hover{filter:brightness(.97);}' +
      '.mlsease-btn.is-secondary{background:#fff;color:var(--brand,#204034);border-color:var(--line,#E7E5DD);}' +
      '.mlsease-empty{display:flex;flex-direction:column;gap:10px;align-items:flex-start;' +
      'color:var(--ink,#1A211C);font-size:13px;line-height:1.45;}' +
      '.mlsease-empty .mlsease-empty-row{display:flex;flex-wrap:wrap;gap:8px;}' +
      '.mlsease-hint{font-size:11px;font-weight:600;color:var(--brand,#204034);' +
      'background:rgba(37,99,201,.08);border-radius:999px;padding:2px 8px;margin-left:6px;white-space:nowrap;}' +
      '.mlsease-scale{font-weight:600;color:var(--muted,#79837C);}';
    var s = el('style', { id: STYLE_ID }); s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ============================================================
   *  PART 1 — Open-patient visit zone (profile)
   * ============================================================ */

  // Trigger the existing §40 copy-every-visit button (don't re-implement the flow).
  function triggerCopy() {
    try {
      var bar = document.getElementById('mlsCopyVisitsBar');
      var btn = bar && bar.querySelector('button, a, [role=button]');
      if (btn) { btn.click(); return true; }
      if (window.__mlsCopyVisits && typeof window.__mlsCopyVisits.run === 'function') {
        window.__mlsCopyVisits.run(function () {}); return true;
      }
    } catch (e) {}
    return false;
  }

  // Open the §43 add-patient modal prefilled for the active patient (adds a visit;
  // merges by name+DOB so no duplicate is created).
  function addVisitForActive() {
    var p = activePt();
    PENDING_PREFILL = p ? { name: p.name || '', dob: p.dob || p.dateOfBirth || '' } : null;
    try {
      if (window.__mlsAddPatient && typeof window.__mlsAddPatient.open === 'function') {
        window.__mlsAddPatient.open();
        return true;
      }
    } catch (e) {}
    PENDING_PREFILL = null;
    return false;
  }

  // id is unique to the copy-bar instance; every instance shares the .mlsease-addvisit class.
  function makeAddVisitBtn(opts) {
    opts = opts || {};
    var props = {
      class: 'mlsease-btn mlsease-addvisit ' + (opts.cls || 'is-secondary'),
      title: ADD_TIP
    };
    if (opts.id) props.id = opts.id;
    var b = el('button', props, '➕ Add a visit');
    b.addEventListener('click', function (ev) { ev.preventDefault(); addVisitForActive(); });
    return b;
  }

  // Build the actionable empty state inside .mlsvh-empty (these tooltips persist —
  // the app does not manage this node, and fillEmpty re-applies after §40 re-renders).
  function fillEmpty(emptyNode) {
    if (!emptyNode || emptyNode.getAttribute('data-mlsease') === '1') return;
    emptyNode.setAttribute('data-mlsease', '1');
    emptyNode.classList.add('mlsease-empty');
    emptyNode.innerHTML = '';
    emptyNode.appendChild(el('div', null,
      'No visits yet — add one or copy this patient’s history from Athena.'));
    var row = el('div', { class: 'mlsease-empty-row' });
    row.appendChild(makeAddVisitBtn({ cls: 'is-secondary' }));
    var copy = el('button', {
      class: 'mlsease-btn is-secondary',
      title: 'Read every visit from the open, signed-in athenaOne chart (read-only)'
    }, '📋 Copy from Athena');
    copy.addEventListener('click', function (ev) { ev.preventDefault(); triggerCopy(); });
    row.appendChild(copy);
    emptyNode.appendChild(row);
  }

  // Add a single "Add a visit" secondary beside the existing purple primary copy button,
  // forming a clear primary+secondary action row. Idempotent; no tug-of-war with the app
  // (the §40 copy module rewrites/strips its own button attributes on a heartbeat, so we
  // do NOT re-assert a tooltip on it — the clear text labels carry discoverability).
  function enhanceCopyBar() {
    var bar = document.getElementById('mlsCopyVisitsBar');
    if (!bar) return;
    if (!bar.classList.contains('mlsease-actions')) bar.classList.add('mlsease-actions');
    if (!bar.querySelector('#mlsEaseAddVisit')) {
      bar.appendChild(makeAddVisitBtn({ id: 'mlsEaseAddVisit', cls: 'is-secondary' }));
    }
  }

  function enhanceProfile() {
    try {
      injectStyle();
      enhanceCopyBar();
      var vh = document.getElementById('mlsVisitHistory');
      if (vh) {
        var empty = vh.querySelector('.mlsvh-empty');
        if (empty) fillEmpty(empty);
      }
      // attach the observer lazily once #profileCard exists
      if (!observerAttached) startObserver();
    } catch (e) { /* silent */ }
  }

  /* ============================================================
   *  PART 2 — Add-patient / add-visit modal defaults
   * ============================================================ */
  var PENDING_PREFILL = null;

  function findModalRoot() {
    var nameInput = document.querySelector('input[name=apName]');
    if (!nameInput) return null;
    var n = nameInput;
    while (n && getComputedStyle(n).position !== 'fixed') n = n.parentElement;
    return n || nameInput.closest('div') || document.body;
  }

  function labelFor(root, input) {
    if (!input) return null;
    if (input.id) { var l = root.querySelector('label[for="' + input.id + '"]'); if (l) return l; }
    var p = input.parentElement;
    while (p && p !== root) {
      var lab = p.querySelector('label');
      if (lab) return lab;
      p = p.parentElement;
    }
    return null;
  }

  function addScaleToLabel(root, input, scale) {
    var lab = labelFor(root, input);
    if (lab && !lab.querySelector('.mlsease-scale')) {
      lab.appendChild(el('span', { class: 'mlsease-scale' }, ' &middot; ' + scale));
    }
  }

  function enhanceModal(root) {
    if (!root || root.getAttribute('data-mlsease-modal') === '1') {
      applyPrefill(root); return;
    }
    root.setAttribute('data-mlsease-modal', '1');

    // 1) default visit date = today (only if empty)
    var dateEl = root.querySelector('[name=apgDate]');
    if (dateEl && !dateEl.value) dateEl.value = todayYMD();

    // 2) remember last visit type
    var typeEl = root.querySelector('[name=apgType]');
    if (typeEl) {
      if (!typeEl.value) {
        var last = getStore(LAST_TYPE_KEY);
        if (last) typeEl.value = last;
      }
      typeEl.addEventListener('change', function () {
        var v = (typeEl.value || '').trim();
        if (v) setStore(LAST_TYPE_KEY, v);
      });
    }

    // 3) score scales on the labels
    var painEl = root.querySelector('[name=apgPain], [name=apgVas], [name=apgScore]') ||
      Array.prototype.find.call(root.querySelectorAll('input'), function (i) {
        return /7\/10/.test(i.placeholder || '');
      });
    var odiEl = root.querySelector('[name=apgOdi], [name=apgFunction]') ||
      Array.prototype.find.call(root.querySelectorAll('input'), function (i) {
        return /42%/.test(i.placeholder || '');
      });
    addScaleToLabel(root, painEl, '0–10');
    addScaleToLabel(root, odiEl, '0–100%');

    // 4) flag the paste-to-AI path as the fast lane (stable, no popups)
    var aiTab = Array.prototype.find.call(root.querySelectorAll('button, div, a, span'), function (b) {
      var t = (b.textContent || '').trim();
      return /paste/i.test(t) && /AI/i.test(t) && t.length < 40 && b.children.length < 2;
    });
    if (aiTab && !aiTab.querySelector('.mlsease-hint')) {
      aiTab.setAttribute('title', 'Fastest: paste any visit note and AI fills the fields for you');
      aiTab.appendChild(el('span', { class: 'mlsease-hint' }, 'fastest'));
    }

    applyPrefill(root);
  }

  function applyPrefill(root) {
    if (!PENDING_PREFILL || !root) return;
    var nameEl = root.querySelector('[name=apName]');
    var dobEl = root.querySelector('[name=apDob]');
    if (nameEl && PENDING_PREFILL.name && !nameEl.value) nameEl.value = PENDING_PREFILL.name;
    if (dobEl && PENDING_PREFILL.dob && !dobEl.value) dobEl.value = PENDING_PREFILL.dob;
    PENDING_PREFILL = null;
  }

  // Poll briefly for the async-built modal, then enhance.
  function waitAndEnhanceModal() {
    var tries = 0;
    (function poll() {
      tries++;
      var root = findModalRoot();
      if (root) { enhanceModal(root); return; }
      if (tries < 40) setTimeout(poll, 25); // ~1s max
    })();
  }

  /* ============================================================
   *  Wiring — wrap render + open + showView, observer + idempotent poll
   * ============================================================ */
  var origRender = null, origOpen = null, origShowView = null,
      observer = null, observerAttached = false, rafPending = false, applying = false, pollTimer = null;

  function scheduleEnhance() {
    if (rafPending || applying) return;
    rafPending = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      rafPending = false;
      applying = true;
      try { if (observer) observer.disconnect(); } catch (e) {}
      try { enhanceProfile(); } catch (e) {}
      try { if (observerAttached && observer) { var pc = document.getElementById('profileCard'); if (pc) observer.observe(pc, { childList: true, subtree: true }); } } catch (e) {}
      applying = false;
    });
  }

  function startObserver() {
    var pc = document.getElementById('profileCard');
    if (!pc) return;
    if (!observer) observer = new MutationObserver(function () { scheduleEnhance(); });
    observer.observe(pc, { childList: true, subtree: true });
    observerAttached = true;
  }

  function wrapRender() {
    if (window.__mlsVisitUI && typeof window.__mlsVisitUI.render === 'function' &&
        !window.__mlsVisitUI.render.__mlsEaseWrapped) {
      origRender = window.__mlsVisitUI.render;
      var wrapped = function () {
        var r = origRender.apply(this, arguments);
        try { enhanceProfile(); } catch (e) {}
        return r;
      };
      wrapped.__mlsEaseWrapped = true;
      wrapped.__mlsEaseOrig = origRender;
      window.__mlsVisitUI.render = wrapped;
    }
  }

  function wrapOpen() {
    if (window.__mlsAddPatient && typeof window.__mlsAddPatient.open === 'function' &&
        !window.__mlsAddPatient.open.__mlsEaseWrapped) {
      origOpen = window.__mlsAddPatient.open;
      var wrapped = function () {
        var r = origOpen.apply(this, arguments);
        try { waitAndEnhanceModal(); } catch (e) {}
        return r;
      };
      wrapped.__mlsEaseWrapped = true;
      wrapped.__mlsEaseOrig = origOpen;
      window.__mlsAddPatient.open = wrapped;
    }
  }

  // Wrap showView so switching to the Patients/profile view enhances immediately.
  function wrapShowView() {
    if (typeof window.showView === 'function' && !window.showView.__mlsEaseWrapped) {
      origShowView = window.showView;
      var wrapped = function () {
        var r = origShowView.apply(this, arguments);
        try { enhanceProfile(); setTimeout(enhanceProfile, 80); } catch (e) {}
        return r;
      };
      wrapped.__mlsEaseWrapped = true;
      wrapped.__mlsEaseOrig = origShowView;
      window.showView = wrapped;
    }
  }

  function install() {
    try {
      injectStyle();
      wrapRender();
      wrapOpen();
      wrapShowView();
      startObserver();
      enhanceProfile();
      // light idempotent safety-net poll: does nothing once applied, never touches #mlsCtxBar
      if (!pollTimer) pollTimer = setInterval(function () { try { enhanceProfile(); } catch (e) {} }, 1200);
    } catch (e) { try { console.warn(LOG, 'install failed', e); } catch (_) {} }
  }

  function revert() {
    try { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } } catch (e) {}
    try { if (observer) observer.disconnect(); } catch (e) {}
    observer = null; observerAttached = false;
    try {
      if (window.__mlsVisitUI && window.__mlsVisitUI.render && window.__mlsVisitUI.render.__mlsEaseWrapped) {
        window.__mlsVisitUI.render = window.__mlsVisitUI.render.__mlsEaseOrig;
      }
    } catch (e) {}
    try {
      if (window.__mlsAddPatient && window.__mlsAddPatient.open && window.__mlsAddPatient.open.__mlsEaseWrapped) {
        window.__mlsAddPatient.open = window.__mlsAddPatient.open.__mlsEaseOrig;
      }
    } catch (e) {}
    try {
      if (window.showView && window.showView.__mlsEaseWrapped) {
        window.showView = window.showView.__mlsEaseOrig;
      }
    } catch (e) {}
    try {
      [].slice.call(document.querySelectorAll('.mlsease-addvisit')).forEach(function (n) { n.remove(); });
      var st = document.getElementById(STYLE_ID); if (st) st.remove();
    } catch (e) {}
    window.__mlsEase.installed = false;
  }

  window.__mlsEase = {
    installed: true,
    version: '1.1.0',
    enhanceProfile: enhanceProfile,
    enhanceModal: enhanceModal,
    addVisitForActive: addVisitForActive,
    triggerCopy: triggerCopy,
    _todayYMD: todayYMD,
    _fillEmpty: fillEmpty,
    _findModalRoot: findModalRoot,
    _setPending: function (p) { PENDING_PREFILL = p; },
    revert: revert,
    _install: install
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();

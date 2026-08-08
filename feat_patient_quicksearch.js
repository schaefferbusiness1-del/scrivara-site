/* feat_patient_quicksearch.js — MLS persistent header patient quick-search
 * ---------------------------------------------------------------------------
 * Additive, reversible. Adds an always-visible search box to the app header
 * that filters ONLY patients already in the MLS data model (window.getPatients)
 * as you type — matching name and DOB — and opens the chosen patient.
 *
 * Design notes (honest, read-only):
 *  - This is ADDITIVE to the existing Cmd-K command palette (window.__mlsCmdK,
 *    bound to Ctrl/Cmd-K) and the "Switch patient" picker
 *    (window.__mlsPatientSwitcher). It does NOT rebind Ctrl-K and does NOT
 *    touch either of those. It owns the "/" shortcut and a visible header box.
 *  - Searches the in-MLS model ONLY (getPatients()). No Athena call, no network,
 *    no PHI leaves the device. All rendered text is HTML-escaped.
 *  - Opens a patient via the app's confirmed-present globals, preferring the
 *    documented chart-open path (openPatient -> showView('patients')), with a
 *    graceful setActivePtId fallback. Worst case: a harmless no-op.
 *  - Fully self-contained IIFE; every call is in try/catch; revert() removes it.
 * ------------------------------------------------------------------------- */
;(function () {
  'use strict';
  var VERSION = '1.0.0';
  try {
    if (window.__mlsPatientQuickSearch && window.__mlsPatientQuickSearch.installed) {
      return; // idempotent — never double-install
    }
  } catch (e) { /* ignore */ }

  var STYLE_ID = 'mls-pqs-style';
  var BOX_ID   = 'mlsPqsBox';
  var INPUT_ID = 'mlsPqsInput';
  var PANEL_ID = 'mlsPqsPanel';
  var MAX_RESULTS = 8;
  var DEBOUNCE_MS = 120;

  var _keydownHandler = null;   // global "/" focus handler (document-level)
  var _docClickHandler = null;  // outside-click closer
  var _debTimer = null;
  var _results = [];            // current rendered result patient objects
  var _activeIdx = -1;          // keyboard-highlighted row index
  var _booted = false;
  var _patientSearchCache = { stamp: null, rows: null };

  /* ---------- tiny helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function digits(s) { return String(s == null ? '' : s).replace(/\D+/g, ''); }
  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }

  function getPatientsSafe() {
    try {
      if (typeof window.getPatients === 'function') {
        var arr = window.getPatients();
        return Array.isArray(arr) ? arr : [];
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  /* The shared roster cache already proves the exact raw patients blob plus
     open-batch totalChanges/externalWrites and account key. Its stable object
     identity is therefore the strongest (and cheapest) production stamp.
     Partial/older boots may not expose it yet; only then accept the exact-key
     storage generation combined with getPatients()' read generation. If no
     complete proof exists, rebuild for this search instead of risking stale
     normalized PHI. */
  function patientSnapshotStamp(pats) {
    try {
      if (typeof window.__mlsPtRosterData === 'function') {
        var roster = window.__mlsPtRosterData(pats);
        if (roster && (typeof roster === 'object' || typeof roster === 'function')) return roster;
      }
    } catch (eRoster) { /* use the exact-key fallback */ }
    try {
      var generation = pats && pats.__mlsReadGen;
      if (typeof generation !== 'number' || !isFinite(generation)) return null;
      if (typeof window.uns !== 'function') return null;
      var key = window.uns('patients');
      if (typeof key !== 'string' || !key) return null;
      var cache = window.__mlsStoreCache;
      if (!cache || typeof cache.verFor !== 'function') return null;
      var version = cache.verFor(key);
      var stable = (typeof version === 'string' && version.length > 0) ||
        (typeof version === 'number' && isFinite(version));
      if (!stable) return null;
      var versionText = String(version);
      return 'fallback|' + key.length + ':' + key + '|read:' + generation +
        '|store:' + typeof version + ':' + versionText.length + ':' + versionText;
    } catch (e) { return null; }
  }

  function normalizedPatientRows(pats) {
    var stamp = patientSnapshotStamp(pats);
    if (stamp !== null && _patientSearchCache.stamp === stamp && _patientSearchCache.rows) {
      return _patientSearchCache.rows;
    }
    var rows = [];
    for (var i = 0; i < pats.length; i++) {
      var p = pats[i];
      rows.push({ p: p, i: i, nameLc: lc(p && p.name), dobDigits: digits(p && p.dob) });
    }
    if (stamp === null) _patientSearchCache = { stamp: null, rows: null };
    else _patientSearchCache = { stamp: stamp, rows: rows };
    return rows;
  }

  function activeIdSafe() {
    try {
      if (typeof window.getActivePtId === 'function') return window.getActivePtId() || '';
    } catch (e) { /* ignore */ }
    return '';
  }

  // Visit count: prefer the §40 visit model, then patient.visits, then notes.
  function visitCount(p) {
    try {
      if (window.__mlsVisitModel && typeof window.__mlsVisitModel.getVisits === 'function') {
        var v = window.__mlsVisitModel.getVisits(p);
        if (Array.isArray(v)) return v.length;
      }
    } catch (e) { /* ignore */ }
    try { if (p && Array.isArray(p.visits)) return p.visits.length; } catch (e) {}
    try {
      if (p && p.id && typeof window.patientNotes === 'function') {
        var n = window.patientNotes(p.id);
        if (Array.isArray(n)) return n.length;
      }
    } catch (e) { /* ignore */ }
    return 0;
  }

  function initials(name) {
    try {
      if (typeof window.ptInitials === 'function') return window.ptInitials(name);
    } catch (e) { /* ignore */ }
    var parts = String(name || '?').replace(/[^A-Za-z0-9 .]/g, '').trim().split(/[\s.]+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  /* ---------- matching (name + DOB), pure & testable ---------- */
  function normalizedQuery(q) {
    var qRaw = String(q || '').trim();
    var qLc = lc(qRaw);
    var tokens = qLc.split(/\s+/).filter(Boolean);
    return { raw: qRaw, lc: qLc, digits: digits(qRaw), tokens: tokens };
  }

  // Returns a score (>0 match, higher = better) or 0 for no match.
  function scoreNormalizedPatient(row, query) {
    if (!row || !row.p || !query.raw) return 0;
    var name = row.nameLc;
    var dobDigits = row.dobDigits;
    var qDigits = query.digits;

    var score = 0;

    // Name matching: every whitespace token must appear somewhere in the name.
    var tokens = query.tokens;
    var nameTokenMatch = tokens.length > 0 && tokens.every(function (t) {
      // a pure-digit token is a DOB token, not a name token
      return /\D/.test(t) ? name.indexOf(t) !== -1 : false;
    });
    if (nameTokenMatch) {
      score += 100;
      // bonus: name starts with the first token (prefix hit ranks higher)
      if (name.indexOf(tokens[0]) === 0) score += 50;
      // bonus: a surname token starts a word
      if (new RegExp('\\b' + tokens[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(name)) score += 10;
    }

    // DOB matching: if the query has >=2 digits, try matching DOB digits.
    if (qDigits.length >= 2 && dobDigits) {
      if (dobDigits.indexOf(qDigits) !== -1) {
        score += 80;
        if (dobDigits.indexOf(qDigits) === 0) score += 20; // prefix of DOB
      }
    }

    // Loose single-substring fallback (e.g. partial one-word query inside name).
    if (!nameTokenMatch && tokens.length === 1 && /\D/.test(tokens[0]) && name.indexOf(tokens[0]) !== -1) {
      score += 40;
    }

    return score;
  }

  function scorePatient(p, q) {
    if (!p) return 0;
    return scoreNormalizedPatient({ p: p, i: 0, nameLc: lc(p.name), dobDigits: digits(p.dob) }, normalizedQuery(q));
  }

  function compareScoredPatients(a, b) {
    if (b.s !== a.s) return b.s - a.s;
    if (a.nameLc < b.nameLc) return -1;
    if (a.nameLc > b.nameLc) return 1;
    return a.i - b.i;
  }

  /* Maintain the exact prefix a stable full sort would produce, while holding
     at most the eight rows the panel can render. Equal comparator values are
     inserted after earlier input rows, matching stable Array#sort order. */
  function insertTopPatient(top, item) {
    var lo = 0, hi = top.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (compareScoredPatients(item, top[mid]) < 0) hi = mid;
      else lo = mid + 1;
    }
    top.splice(lo, 0, item);
    if (top.length > MAX_RESULTS) top.pop();
  }

  function search(q, patientSnapshot) {
    var pats = Array.isArray(patientSnapshot) ? patientSnapshot : getPatientsSafe();
    var qTrim = String(q || '').trim();
    if (!qTrim) return [];
    var query = normalizedQuery(qTrim);
    var rows = normalizedPatientRows(pats);
    var scored = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], s = scoreNormalizedPatient(row, query);
      if (s > 0) insertTopPatient(scored, { p: row.p, s: s, i: row.i, nameLc: row.nameLc });
    }
    return scored.map(function (x) { return x.p; });
  }

  /* ---------- open a patient (confirmed-present globals, graceful) ---------- */
  function openPatientById(id) {
    if (!id) return;
    var opened = false;
    try {
      if (typeof window.openPatient === 'function') { window.openPatient(id); opened = true; }
    } catch (e) { /* ignore */ }
    if (!opened) {
      try { if (typeof window.setActivePtId === 'function') { window.setActivePtId(id); opened = true; } } catch (e) {}
    }
    // Navigate to the chart view (showView('patients') re-renders profile).
    try { if (typeof window.showView === 'function') window.showView('patients'); } catch (e) { /* ignore */ }
    return opened;
  }

  /* ---------- DOM build ---------- */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '#' + BOX_ID + '{position:relative;display:flex;align-items:center;margin-right:10px;flex:0 1 240px;min-width:0}' +
      '#' + BOX_ID + ' .mls-pqs-ic{position:absolute;left:10px;font-size:13px;opacity:.6;pointer-events:none}' +
      '#' + INPUT_ID + '{width:100%;box-sizing:border-box;padding:8px 28px 8px 28px;border:1px solid #D6D2C6;border-radius:9px;' +
        'font-size:13.5px;color:#1A211C;background:#fff;outline:none}' +
      '#' + INPUT_ID + ':focus{border-color:#3B7C5A;box-shadow:0 0 0 3px rgba(46,106,75,.18)}' +
      '#' + BOX_ID + ' .mls-pqs-kbd{position:absolute;right:8px;font-size:11px;color:#79837C;border:1px solid #E7E5DD;' +
        'border-radius:5px;padding:1px 5px;background:#F4F2EC;pointer-events:none}' +
      '#' + BOX_ID + ' .mls-pqs-kbd.hide{display:none}' +
      '#' + PANEL_ID + '{position:absolute;top:calc(100% + 6px);left:0;right:0;min-width:280px;background:#fff;' +
        'border:1px solid #E7E5DD;border-radius:12px;box-shadow:0 12px 34px rgba(26,33,28,.2);z-index:9999;' +
        'overflow:hidden;display:none}' +
      '#' + PANEL_ID + '.show{display:block}' +
      '#' + PANEL_ID + ' .mls-pqs-row{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-bottom:1px solid #F4F2EC}' +
      '#' + PANEL_ID + ' .mls-pqs-row:last-child{border-bottom:none}' +
      '#' + PANEL_ID + ' .mls-pqs-row.on,#' + PANEL_ID + ' .mls-pqs-row:hover{background:#EAF1EE}' +
      '#' + PANEL_ID + ' .mls-pqs-av{flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:#2E6A4B;color:#fff;' +
        'font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}' +
      '#' + PANEL_ID + ' .mls-pqs-main{min-width:0;flex:1 1 auto}' +
      '#' + PANEL_ID + ' .mls-pqs-nm{font-size:13.5px;font-weight:600;color:#1A211C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#' + PANEL_ID + ' .mls-pqs-sub{font-size:12px;color:#79837C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#' + PANEL_ID + ' .mls-pqs-badge{flex:0 0 auto;font-size:11px;color:#2E6A4B;background:#EAF1EE;border-radius:20px;padding:2px 8px}' +
      '#' + PANEL_ID + ' .mls-pqs-active{flex:0 0 auto;font-size:10px;color:#0a6b3b;background:#e3f6e9;border-radius:20px;padding:2px 7px;font-weight:700}' +
      '#' + PANEL_ID + ' .mls-pqs-empty{padding:14px 14px;font-size:13px;color:#79837C;text-align:center}' +
      '#' + PANEL_ID + ' .mls-pqs-foot{padding:7px 12px;font-size:11px;color:var(--muted);background:#FCFBF8;border-top:1px solid #F4F2EC}' +
      '@media (max-width:760px){#' + BOX_ID + '{flex-basis:150px}#' + BOX_ID + ' .mls-pqs-kbd{display:none}}';
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function buildBox() {
    if (document.getElementById(BOX_ID)) return document.getElementById(BOX_ID);
    var box = document.createElement('div');
    box.id = BOX_ID;
    box.setAttribute('role', 'search');

    var ic = document.createElement('span');
    ic.className = 'mls-pqs-ic';
    ic.textContent = '🔍';
    ic.setAttribute('aria-hidden', 'true');

    var input = document.createElement('input');
    input.id = INPUT_ID;
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('placeholder', 'Find patient…');
    input.setAttribute('aria-label', 'Quick-find a patient by name or date of birth');

    var kbd = document.createElement('span');
    kbd.className = 'mls-pqs-kbd';
    kbd.textContent = '/';
    kbd.setAttribute('aria-hidden', 'true');

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'listbox');

    box.appendChild(ic);
    box.appendChild(input);
    box.appendChild(kbd);
    box.appendChild(panel);

    // input events
    input.addEventListener('input', function () {
      kbd.classList.toggle('hide', !!input.value);
      scheduleRender();
    });
    input.addEventListener('focus', function () {
      kbd.classList.toggle('hide', !!input.value);
      if (input.value.trim()) renderNow();
    });
    input.addEventListener('keydown', onInputKeydown);
    return box;
  }

  function mountBox() {
    var box = buildBox();
    var header = document.getElementById('appHeader');
    var tools = header ? header.querySelector('.tools') : null;
    if (tools) {
      tools.insertBefore(box, tools.firstChild);
    } else if (header) {
      header.appendChild(box);
    } else {
      // Header not present yet — append to body as a last resort (still works).
      (document.body || document.documentElement).appendChild(box);
    }
    return box;
  }

  /* ---------- rendering ---------- */
  function scheduleRender() {
    if (_debTimer) clearTimeout(_debTimer);
    _debTimer = setTimeout(renderNow, DEBOUNCE_MS);
  }

  function renderNow() {
    _debTimer = null;
    var input = document.getElementById(INPUT_ID);
    var panel = document.getElementById(PANEL_ID);
    if (!input || !panel) return;
    var q = input.value;
    if (!q.trim()) { closePanel(); return; }

    var allPats = getPatientsSafe();
    _results = search(q, allPats);
    _activeIdx = _results.length ? 0 : -1;

    panel.innerHTML = '';
    if (!allPats.length) {
      panel.appendChild(emptyEl('No patients in MLS yet. Add one from the Patients tab.'));
      openPanel();
      return;
    }
    if (!_results.length) {
      panel.appendChild(emptyEl('No patient matches “' + esc(q.trim()) + '”.'));
      openPanel();
      return;
    }

    var actId = activeIdSafe();
    for (var i = 0; i < _results.length; i++) {
      panel.appendChild(rowEl(_results[i], i, actId));
    }
    var foot = document.createElement('div');
    foot.className = 'mls-pqs-foot';
    var shown = _results.length;
    foot.textContent = '↑↓ to move · Enter to open · Esc to close';
    panel.appendChild(foot);
    openPanel();
  }

  function emptyEl(msg) {
    var d = document.createElement('div');
    d.className = 'mls-pqs-empty';
    d.textContent = msg; // textContent — never innerHTML for user/query text
    return d;
  }

  function rowEl(p, idx, actId) {
    var row = document.createElement('div');
    row.className = 'mls-pqs-row' + (idx === _activeIdx ? ' on' : '');
    row.setAttribute('role', 'option');
    row.setAttribute('data-idx', String(idx));

    var av = document.createElement('div');
    av.className = 'mls-pqs-av';
    av.textContent = initials(p && p.name);

    var main = document.createElement('div');
    main.className = 'mls-pqs-main';
    var nm = document.createElement('div');
    nm.className = 'mls-pqs-nm';
    nm.textContent = (p && p.name) ? String(p.name) : '(unnamed patient)';
    var sub = document.createElement('div');
    sub.className = 'mls-pqs-sub';
    var dobTxt = (p && p.dob) ? ('DOB ' + String(p.dob)) : 'DOB —';
    var mrnTxt = (p && p.mrn) ? (' · MRN ' + String(p.mrn)) : '';
    sub.textContent = dobTxt + mrnTxt;
    main.appendChild(nm);
    main.appendChild(sub);

    var vc = visitCount(p);
    var badge = document.createElement('div');
    badge.className = 'mls-pqs-badge';
    badge.textContent = vc + (vc === 1 ? ' visit' : ' visits');

    row.appendChild(av);
    row.appendChild(main);
    if (actId && p && p.id === actId) {
      var ab = document.createElement('div');
      ab.className = 'mls-pqs-active';
      ab.textContent = 'ACTIVE';
      row.appendChild(ab);
    }
    row.appendChild(badge);

    row.addEventListener('mouseenter', function () { setActive(idx); });
    row.addEventListener('mousedown', function (ev) {
      // mousedown (not click) so it fires before the input blur closes the panel
      ev.preventDefault();
      choose(idx);
    });
    return row;
  }

  function setActive(idx) {
    _activeIdx = idx;
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    var rows = panel.querySelectorAll('.mls-pqs-row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('on', i === idx);
    }
  }

  function choose(idx) {
    var p = _results[idx];
    if (!p) return;
    closePanel();
    var input = document.getElementById(INPUT_ID);
    if (input) { input.value = ''; input.blur(); var kbd = input.parentNode && input.parentNode.querySelector('.mls-pqs-kbd'); if (kbd) kbd.classList.remove('hide'); }
    openPatientById(p.id);
  }

  function openPanel() {
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.classList.add('show');
  }
  function closePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (panel) { panel.classList.remove('show'); }
    _activeIdx = -1;
  }

  /* ---------- keyboard ---------- */
  function onInputKeydown(ev) {
    var panel = document.getElementById(PANEL_ID);
    var open = panel && panel.classList.contains('show') && _results.length;
    if (ev.key === 'ArrowDown') {
      if (!open) { renderNow(); return; }
      ev.preventDefault();
      setActive(Math.min(_activeIdx + 1, _results.length - 1));
      scrollActiveIntoView();
    } else if (ev.key === 'ArrowUp') {
      if (!open) return;
      ev.preventDefault();
      setActive(Math.max(_activeIdx - 1, 0));
      scrollActiveIntoView();
    } else if (ev.key === 'Enter') {
      if (open && _activeIdx >= 0) { ev.preventDefault(); choose(_activeIdx); }
    } else if (ev.key === 'Escape') {
      var input = document.getElementById(INPUT_ID);
      if (input && input.value) { ev.preventDefault(); input.value = ''; closePanel(); var kbd = input.parentNode && input.parentNode.querySelector('.mls-pqs-kbd'); if (kbd) kbd.classList.remove('hide'); }
      else { closePanel(); if (input) input.blur(); }
    }
  }

  function scrollActiveIntoView() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    var rows = panel.querySelectorAll('.mls-pqs-row');
    var el = rows[_activeIdx];
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  }

  // Global "/" focuses the box — but never while typing elsewhere or in a modal.
  function isTypingTarget(t) {
    if (!t) return false;
    var tag = (t.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (t.isContentEditable) return true;
    return false;
  }
  function anyModalOpen() {
    try {
      // The app shows modals with the ".show" class (e.g. #patientModal.show).
      var shown = document.querySelectorAll('.modal.show, .show[id$="Modal"], [id$="Modal"].show');
      return shown && shown.length > 0;
    } catch (e) { return false; }
  }
  function onDocKeydown(ev) {
    if (ev.key !== '/') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (isTypingTarget(ev.target)) return;
    if (anyModalOpen()) return;
    var input = document.getElementById(INPUT_ID);
    if (!input) return;
    ev.preventDefault();
    input.focus();
    try { input.select(); } catch (e) {}
  }

  function onDocClick(ev) {
    var box = document.getElementById(BOX_ID);
    if (!box) return;
    if (box.contains(ev.target)) return;
    closePanel();
  }

  /* ---------- boot / revert ---------- */
  function boot() {
    if (_booted) return;
    injectStyle();
    mountBox();
    _keydownHandler = onDocKeydown;
    _docClickHandler = onDocClick;
    document.addEventListener('keydown', _keydownHandler, true);
    document.addEventListener('click', _docClickHandler, true);
    _booted = true;
  }

  function revert() {
    try { if (_keydownHandler) document.removeEventListener('keydown', _keydownHandler, true); } catch (e) {}
    try { if (_docClickHandler) document.removeEventListener('click', _docClickHandler, true); } catch (e) {}
    _keydownHandler = null; _docClickHandler = null;
    try { var b = document.getElementById(BOX_ID); if (b && b.parentNode) b.parentNode.removeChild(b); } catch (e) {}
    try { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
    if (_debTimer) { clearTimeout(_debTimer); _debTimer = null; }
    _results = []; _activeIdx = -1; _booted = false;
    _patientSearchCache = { stamp: null, rows: null };
    try { if (window.__mlsPatientQuickSearch) window.__mlsPatientQuickSearch.installed = false; } catch (e) {}
  }

  // Public surface — read-only helpers exposed for tests/diagnostics (no PHI).
  try {
    window.__mlsPatientQuickSearch = {
      version: VERSION,
      installed: true,
      boot: boot,
      revert: revert,
      // pure, testable helpers:
      _score: scorePatient,
      _search: search,
      _digits: digits,
      _open: openPatientById,
      _renderNow: renderNow
    };
  } catch (e) { /* ignore */ }

  // Auto-boot when the DOM is ready.
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { try { boot(); } catch (e) {} }, { once: true });
    } else {
      boot();
    }
  } catch (e) { /* ignore */ }
})();

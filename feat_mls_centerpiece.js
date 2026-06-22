/* feat_mls_centerpiece.js  ->  window.__mlsCenterpiece  (v1.0.1)
 *
 * Day-driven MLS centerpiece. Self-contained, additive, fully reversible.
 * - Surfaces the (already-working) day-schedule pull + the selected-patient pull
 *   as front-and-center buttons inside MLS Easy Step 1 (un-buries the day-pull
 *   button that lived inside .mlsEasyHidden), plus "this week" and "find by name".
 * - Drives ONLY the real existing handlers:
 *     pullPatientFromAthenaPrompt(btn)            (selected/open patient)
 *     pullScheduleViaAssist(btn)                  (whole-schedule day pull engine)
 *     __mlsAthenaActions.searchAndOpen(name,meta) (find a patient by name + pull)
 * - Day-driven walk: after a schedule pull, captures the patients just brought in
 *   and walks them ONE BY ONE; the active patient always comes from that list, and
 *   an "Acting on:" banner always shows who MLS is working on (kills the stale
 *   "who is Corbin" mystery-patient confusion).
 * - Rich, plain-English transfer status narrated into the ONE shared timeline
 *   (window.__mlsAthenaActions._openTimeline / _step), which feat_athena_ux_unify
 *   already curates as a single surface -> no duplicate/contradicting status.
 *
 * SAFETY: sends NOTHING to the extension itself; never clicks Save/Sign/attest/
 * submit; never writes a chart. Reads only existing app state + drives existing
 * read-only handlers. ASCII-only. Every external call wrapped in try/catch.
 * window.__mlsCenterpiece.revert() removes all UI/observers/wraps.
 */
(function () {
  'use strict';
  try {
    if (window.__mlsCenterpiece && window.__mlsCenterpiece.installed) return;
  } catch (e) {}

  var VERSION = '1.0.1';
  var ASSET = 'feat_mls_centerpiece.js';
  var S = {}; // module state: walkArmed, walk{list,idx,kind}, importBaseline
  var ALL_PROV_NOTE = 'Pulls all providers for now (the per-doctor filter needs the next MLS Assist update).';

  // -------- tiny safe helpers --------
  function q(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
  function getPatients() { try { return (window.getPatients && window.getPatients()) || []; } catch (e) { return []; } }
  function activeId() { try { return (window.getActivePtId && window.getActivePtId()) || null; } catch (e) { return null; } }
  function activePatient() { var id = activeId(); if (!id) return null; var ps = getPatients(); for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === id) return ps[i]; return null; }
  function esc(s) {
    try { if (window.esc) return window.esc(s); } catch (e) {}
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m) { try { window.toast && window.toast(m); } catch (e) {} }
  function connected() {
    try { if (window.__mlsUxUnify && typeof window.__mlsUxUnify.connected === 'function') return !!window.__mlsUxUnify.connected(); } catch (e) {}
    try { var d = document.getElementById('mlsAthenaStatusDot'); return !!(d && (d.getAttribute('data-state') === 'connected' || (d.dataset && d.dataset.state === 'connected'))); } catch (e) {}
    return false;
  }
  function firstName(name) { var n = String(name || '').trim(); if (!n) return 'this patient'; if (n.indexOf(',') > -1) { var p = n.split(',')[1]; if (p) return p.trim().split(/\s+/)[0]; } return n.split(/\s+/)[0]; }

  // -------- rich status, narrated into the ONE shared timeline --------
  function tlOpen(title, brings) {
    try {
      if (window.__mlsAthenaActions && window.__mlsAthenaActions._openTimeline) {
        window.__mlsAthenaActions._openTimeline({ title: title, intent: { brings: brings, mode: 'read' } });
        return true;
      }
    } catch (e) {}
    return false;
  }
  function tlStep(text, state) {
    var ok = false;
    try { if (window.__mlsAthenaActions && window.__mlsAthenaActions._step) { window.__mlsAthenaActions._step(text, state || 'run'); ok = true; } } catch (e) {}
    try { if (window.__mlsUxUnify && window.__mlsUxUnify.mirror) window.__mlsUxUnify.mirror(text); } catch (e) {}
    if (!ok) toast(text);
  }

  // ============================================================
  //  PART A -- the front-and-center buttons inside MLS Easy Step 1
  // ============================================================
  var STYLE_ID = 'mlsCenterpieceStyle';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = ce('style'); st.id = STYLE_ID;
    st.textContent = [
      '.mlscp-acting{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:9px 12px;border-radius:10px;',
      'background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);color:#fff;font-size:13px;line-height:1.3;}',
      '.mlscp-acting b{font-weight:700;}',
      '.mlscp-acting .mlscp-dim{opacity:.85;font-weight:400;}',
      '.mlscp-pulls{display:flex;flex-direction:column;gap:9px;margin-top:4px;}',
      '.mlscp-note{font-size:11px;line-height:1.35;opacity:.85;margin:2px 2px 0;color:#eaf2ff;}',
      '.mlscp-or{display:flex;align-items:center;gap:10px;margin:4px 0 2px;color:#dbe7ff;font-size:11px;opacity:.8;}',
      '.mlscp-or:before,.mlscp-or:after{content:"";flex:1;height:1px;background:rgba(255,255,255,.25);}',
      '.mlscp-sub{display:block;font-size:11px;font-weight:400;opacity:.9;margin-top:3px;line-height:1.3;}',
      '.mlscp-walk{margin:0 0 12px;padding:11px 12px;border-radius:12px;background:rgba(255,255,255,.14);',
      'border:1px solid rgba(255,255,255,.26);color:#fff;}',
      '.mlscp-walk h4{margin:0 0 7px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:7px;}',
      '.mlscp-walk .mlscp-count{font-weight:400;opacity:.85;font-size:12px;}',
      '.mlscp-walk-now{font-size:14px;font-weight:700;margin:2px 0 9px;}',
      '.mlscp-walk-now .mlscp-meta{display:block;font-size:11px;font-weight:400;opacity:.85;margin-top:1px;}',
      '.mlscp-walk-row{display:flex;gap:8px;flex-wrap:wrap;}',
      '.mlscp-walk-row .ez-btn{flex:1;min-width:120px;}',
      '.mlscp-mini{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);color:#fff;',
      'border-radius:9px;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer;}',
      '.mlscp-mini:disabled{opacity:.45;cursor:default;}',
      '@media(max-width:560px){.mlscp-walk-row .ez-btn{min-width:0;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  // Acting-on banner: ALWAYS shows who MLS is working on (no stale mystery patient)
  function actingBannerHTML() {
    var p = activePatient();
    if (p && (p.name || '').trim()) {
      var dob = (p.dob || '').trim();
      return '<div class="mlscp-acting" id="mlscpActing">👤 Working on: <b>' + esc(p.name) + '</b>' +
        (dob ? ' <span class="mlscp-dim">(DOB ' + esc(dob) + ')</span>' : '') + '</div>';
    }
    return '<div class="mlscp-acting" id="mlscpActing"><span class="mlscp-dim">No patient selected yet — pull one below to begin.</span></div>';
  }

  function buttonsHTML() {
    var disabledNote = connected() ? '' : ' <span class="mlscp-sub" style="color:#ffd9d9">athenaOne not detected yet — open a signed-in athenaOne tab, or enter manually.</span>';
    return '' +
      '<div class="mlscp-pulls" id="mlscpPulls">' +
        '<button type="button" class="ez-btn ez-primary" id="mlscpToday">📅 Pull today’s patients' +
          '<span class="mlscp-sub">Brings everyone on the schedule now open in athenaOne into MLS — names, DOBs, and each one’s past visits — then walks them one by one.</span>' +
        '</button>' +
        '<div class="mlscp-note">Tip: open today’s schedule grid in athenaOne first. ' + ALL_PROV_NOTE + disabledNote + '</div>' +
        '<button type="button" class="ez-btn ez-secondary" id="mlscpWeek">🗓️ Pull this week’s patients' +
          '<span class="mlscp-sub">Same as above, for the whole week’s schedule open in athenaOne. ' + ALL_PROV_NOTE + '</span>' +
        '</button>' +
        '<div class="mlscp-or">or work with one patient</div>' +
        '<button type="button" class="ez-btn ez-secondary" id="mlscpSelected">⬇ Pull the patient open in athenaOne' +
          '<span class="mlscp-sub">Reads the chart you currently have open — name, DOB, and every past visit — into MLS.</span>' +
        '</button>' +
        '<button type="button" class="ez-btn ez-secondary" id="mlscpFind">🔍 Find a patient by name &amp; pull' +
          '<span class="mlscp-sub">Type a name; MLS asks athenaOne to find and open that chart, then pulls their visits.</span>' +
        '</button>' +
      '</div>';
  }

  // Inject our controls into MLS Easy Step 1 (only when on step 1 + not already present)
  function onStep1() {
    try {
      var ez = window.__mlsEasy;
      if (ez && ez.state && ez.state.mode === 'easy' && ez.state.step === 1) return true;
    } catch (e) {}
    // fall back to DOM: step badge says step 1 + the ezPull button exists
    return !!(document.getElementById('ezPull') && document.getElementById('mlsEasyPanel'));
  }

  function inject() {
    try {
      var panel = document.getElementById('mlsEasyPanel');
      if (!panel) return;
      if (!onStep1()) return;
      var body = panel.querySelector('.ez-body') || panel;

      // 1) Acting-on banner at the very top of the body
      if (!document.getElementById('mlscpActing')) {
        var top = panel.querySelector('.ez-top');
        var frag = document.createElement('div');
        frag.innerHTML = actingBannerHTML();
        var banner = frag.firstChild;
        if (top && top.parentNode) top.parentNode.insertBefore(banner, top);
        else body.insertBefore(banner, body.firstChild);
      } else {
        refreshActing();
      }

      // 2) Walk strip (if a walk is active) -- inserted right after the banner
      renderWalkStrip();

      // 3) The pull buttons -- replace the stock ez-actions content with ours,
      //    keeping the original ezManual + the full-view link untouched.
      if (!document.getElementById('mlscpPulls')) {
        var actions = panel.querySelector('.ez-actions');
        if (actions) {
          var holder = ce('div', 'mlscp-actions-host');
          holder.innerHTML = buttonsHTML();
          // hide the stock pull button (ezPull) -- ours replaces it -- but keep ezManual
          var ezPull = document.getElementById('ezPull');
          if (ezPull) ezPull.style.display = 'none';
          actions.parentNode.insertBefore(holder.firstChild, actions);
          wireButtons();
        }
      }
    } catch (e) {}
  }

  function refreshActing() {
    try {
      var b = document.getElementById('mlscpActing');
      if (!b) return;
      var frag = document.createElement('div');
      frag.innerHTML = actingBannerHTML();
      b.replaceWith(frag.firstChild);
    } catch (e) {}
  }

  function wireButtons() {
    bind('mlscpToday', function () { startSchedulePull('today'); });
    bind('mlscpWeek', function () { startSchedulePull('week'); });
    bind('mlscpSelected', function () { startSelectedPull(); });
    bind('mlscpFind', function () { startFindByName(); });
  }
  function bind(id, fn) {
    var el = document.getElementById(id);
    if (el && !el.__mlscpBound) { el.__mlscpBound = true; el.addEventListener('click', function (ev) { try { ev.preventDefault(); } catch (e) {} fn(); }); }
  }

  // ============================================================
  //  PART B -- driving the real pulls with rich, honest narration
  // ============================================================
  function startSelectedPull() {
    if (typeof window.pullPatientFromAthenaPrompt !== 'function') { toast('Pull is unavailable right now.'); return; }
    if (!connected()) { tlOpen('Pull the open patient', 'name, DOB and every past visit'); tlStep('athenaOne is not detected yet. Open a signed-in athenaOne tab with the chart you want, then try again.', 'warn'); return; }
    tlOpen('Pulling the patient open in athenaOne', 'name, DOB and every past visit');
    tlStep('Reading the chart you have open in athenaOne (name, DOB and past visits)...', 'run');
    try { window.pullPatientFromAthenaPrompt(document.getElementById('mlscpSelected')); } catch (e) { tlStep('Could not start the pull: ' + (e && e.message ? e.message : e), 'fail'); }
  }

  function startFindByName() {
    var name = '';
    try { name = window.prompt('Find a patient in athenaOne by name (e.g. "Last, First" or "First Last"):', ''); } catch (e) {}
    if (name == null) return;
    name = String(name).trim();
    if (!name) { toast('Type a patient name to search.'); return; }
    if (!connected()) { tlOpen('Find a patient in athenaOne', 'name, DOB and every past visit'); tlStep('athenaOne is not detected yet. Open a signed-in athenaOne tab, then try again.', 'warn'); return; }
    if (!(window.__mlsAthenaActions && typeof window.__mlsAthenaActions.searchAndOpen === 'function')) { toast('Search is unavailable right now.'); return; }
    tlOpen('Finding "' + name + '" in athenaOne', 'name, DOB and every past visit');
    tlStep('Asking athenaOne to search for "' + esc(name) + '" and open the matching chart...', 'run');
    try { window.__mlsAthenaActions.searchAndOpen(name, { title: 'Find patient in Athena', patientName: name, source: 'centerpiece' }); }
    catch (e) { tlStep('Could not start the search: ' + (e && e.message ? e.message : e), 'fail'); }
  }

  // ---- schedule pull + day-driven walk ----
  function startSchedulePull(kind) {
    if (typeof window.pullScheduleViaAssist !== 'function') { toast('Schedule pull is unavailable right now.'); return; }
    var label = kind === 'week' ? 'this week’s' : 'today’s';
    if (!connected()) {
      tlOpen('Pull ' + label + ' patients', 'every scheduled patient + their past visits');
      tlStep('athenaOne is not detected yet. Open a signed-in athenaOne tab on the schedule you want (' + label + '), then try again.', 'warn');
      return;
    }
    S.walkArmed = { kind: kind, t0: Date.now() };
    S.importBaseline = baselineApptIds();
    tlOpen('Pulling ' + label + ' schedule from athenaOne', 'every scheduled patient + each one’s past visits');
    tlStep('Reading the ' + label + ' schedule open in athenaOne... (' + ALL_PROV_NOTE + ')', 'run');
    try { window.pullScheduleViaAssist(document.getElementById(kind === 'week' ? 'mlscpWeek' : 'mlscpToday')); }
    catch (e) { tlStep('Could not start the schedule pull: ' + (e && e.message ? e.message : e), 'fail'); S.walkArmed = null; }
  }

  function baselineApptIds() {
    var s = {};
    try { (window._calAppts || []).forEach(function (a) { if (a && a.id != null) s[a.id] = 1; }); } catch (e) {}
    return s;
  }

  // patient key for de-duping a walk list
  function patKey(a) { return (a.patient_external_id || '') + '|' + (a.name || '') + '|' + (a.dob || ''); }

  // After a schedule import, capture the patients that were just brought in.
  function captureWalk() {
    try {
      if (!S.walkArmed) return;
      var base = S.importBaseline || {};
      var appts = window._calAppts || [];
      var added = appts.filter(function (a) { return a && a.id != null && !base[a.id]; });
      var pool = added.length ? added : appts; // fall back to whole calendar if all were de-duped
      // if we fell back, prefer the most recently-touched date so the walk is "this pull"
      if (!added.length && pool.length) {
        var dates = {};
        pool.forEach(function (a) { var d = (a.appt_date || a.start_at || '').slice(0, 10); if (d) dates[d] = (dates[d] || 0) + 1; });
        var best = null, bestN = -1;
        Object.keys(dates).forEach(function (d) { if (dates[d] > bestN) { bestN = dates[d]; best = d; } });
        if (best) pool = pool.filter(function (a) { return (a.appt_date || a.start_at || '').slice(0, 10) === best; });
      }
      // sort by start time, de-dupe by patient
      pool = pool.slice().sort(function (a, b) { return String(a.start_at || a.appt_date || '').localeCompare(String(b.start_at || b.appt_date || '')); });
      var seen = {}, list = [];
      pool.forEach(function (a) { var k = patKey(a); if (seen[k]) return; seen[k] = 1; list.push({ name: a.name || '', dob: a.dob || '', extId: a.patient_external_id || '', reason: a.reason || '', time: a.start_at || '' }); });
      S.walk = { list: list, idx: 0, kind: S.walkArmed.kind };
      S.walkArmed = null;
      if (list.length) {
        tlStep('Found ' + list.length + ' patient' + (list.length === 1 ? '' : 's') + ' on the schedule. Their past visits are loading in the background.', 'done');
        openWalkPatient(0, true);
      } else {
        tlStep('The schedule pull finished but no patients were found on the open athenaOne view. Open the schedule grid for the day you want, then pull again.', 'warn');
      }
      renderWalkStrip();
      refreshActing();
    } catch (e) {}
  }

  // Resolve a walk entry to an MLS patient id and make it the active patient.
  function openWalkPatient(idx, quiet) {
    try {
      if (!S.walk || !S.walk.list[idx]) return;
      S.walk.idx = idx;
      var w = S.walk.list[idx];
      var ps = getPatients();
      var match = null;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i]; if (!p) continue;
        if (w.extId && p.external_id && String(p.external_id) === String(w.extId)) { match = p; break; }
        if (w.name && (p.name || '').toLowerCase() === w.name.toLowerCase() && (!w.dob || (p.dob || '') === w.dob)) { match = p; break; }
      }
      if (match) {
        if (typeof window.openPatient === 'function') window.openPatient(match.id);
        else { try { window.setActivePtId && window.setActivePtId(match.id); window.renderProfile && window.renderProfile(); } catch (e) {} }
        if (!quiet) tlStep('Now working on ' + esc(w.name || firstName(w.name)) + ' (patient ' + (idx + 1) + ' of ' + S.walk.list.length + ').', 'note');
      } else if (!quiet) {
        tlStep('That patient is still being created in MLS — try again in a moment.', 'warn');
      }
      renderWalkStrip();
      refreshActing();
    } catch (e) {}
  }

  function renderWalkStrip() {
    try {
      var existing = document.getElementById('mlscpWalk');
      if (!S.walk || !S.walk.list || !S.walk.list.length) { if (existing) existing.remove(); return; }
      var panel = document.getElementById('mlsEasyPanel');
      if (!panel) return;
      var w = S.walk.list[S.walk.idx] || S.walk.list[0];
      var total = S.walk.list.length, n = S.walk.idx + 1;
      var html = '<div class="mlscp-walk" id="mlscpWalk">' +
        '<h4>📋 Today’s patients <span class="mlscp-count">· ' + n + ' of ' + total + '</span></h4>' +
        '<div class="mlscp-walk-now">' + esc(w.name || 'Patient ' + n) +
          (w.reason ? '<span class="mlscp-meta">' + esc(w.reason) + '</span>' : '') + '</div>' +
        '<div class="mlscp-walk-row">' +
          '<button type="button" class="mlscp-mini" id="mlscpPrev"' + (S.walk.idx <= 0 ? ' disabled' : '') + '>◀ Previous</button>' +
          '<button type="button" class="ez-btn ez-primary" id="mlscpOpen" style="flex:2">⬇ Open this patient</button>' +
          '<button type="button" class="mlscp-mini" id="mlscpNext"' + (S.walk.idx >= total - 1 ? ' disabled' : '') + '>Next ▶</button>' +
        '</div></div>';
      if (existing) {
        existing.outerHTML = html;
      } else {
        var banner = document.getElementById('mlscpActing');
        var frag = document.createElement('div'); frag.innerHTML = html;
        var node = frag.firstChild;
        if (banner && banner.parentNode) banner.parentNode.insertBefore(node, banner.nextSibling);
        else (panel.querySelector('.ez-body') || panel).insertBefore(node, (panel.querySelector('.ez-body') || panel).firstChild);
      }
      bind('mlscpPrev', function () { if (S.walk && S.walk.idx > 0) openWalkPatient(S.walk.idx - 1); });
      bind('mlscpNext', function () { if (S.walk && S.walk.idx < S.walk.list.length - 1) openWalkPatient(S.walk.idx + 1); });
      bind('mlscpOpen', function () { openWalkPatient(S.walk.idx); toast('Opened ' + firstName((S.walk.list[S.walk.idx] || {}).name)); });
    } catch (e) {}
  }

  // ============================================================
  //  PART C -- wrap _importPulledSchedule (outermost) to drive the walk
  // ============================================================
  var _wrappedImport = null, _origImport = null, _didWrap = false, _reverted = false;
  function wrapImport() {
    try {
      if (_didWrap) return;
      if (typeof window._importPulledSchedule !== 'function') return; // not defined yet -- the poll retries
      if (window._importPulledSchedule.__mlscpWrapped) { _didWrap = true; return; }
      _origImport = window._importPulledSchedule;
      _wrappedImport = function () {
        var r;
        try { r = _origImport.apply(this, arguments); } catch (e) { r = undefined; }
        // capture the walk once the import has settled (skip if reverted)
        if (!_reverted && S.walkArmed) { schedule(captureWalk, 900); schedule(function () { renderWalkStrip(); refreshActing(); }, 1600); }
        return r;
      };
      _wrappedImport.__mlscpWrapped = true;
      window._importPulledSchedule = _wrappedImport;
      _didWrap = true;
    } catch (e) {}
  }

  var _timers = [];
  function schedule(fn, ms) { var t = setTimeout(function () { try { fn(); } catch (e) {} }, ms || 0); _timers.push(t); return t; }

  // ============================================================
  //  PART D -- keep our UI present without flicker (observer + rAF coalesce)
  // ============================================================
  var _obs = null, _raf = 0, _pollT = null;
  function scheduleInject() {
    if (_raf) return;
    var run = function () { _raf = 0; try { injectStyle(); inject(); } catch (e) {} };
    if (window.requestAnimationFrame) _raf = window.requestAnimationFrame(run); else _raf = setTimeout(run, 16);
  }
  function startObserver() {
    try {
      var panel = document.getElementById('mlsEasyPanel') || document.body;
      _obs = new MutationObserver(function () { scheduleInject(); });
      _obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    // a slow safety poll keeps the acting banner fresh + re-mounts if MLS Easy re-renders
    _pollT = setInterval(function () { try { wrapImport(); if (onStep1()) { scheduleInject(); refreshActing(); } } catch (e) {} }, 1500);
  }

  // ============================================================
  //  revert
  // ============================================================
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_pollT) clearInterval(_pollT); } catch (e) {}
    try { _timers.forEach(function (t) { clearTimeout(t); }); } catch (e) {}
    _reverted = true;
    try { if (_wrappedImport && window._importPulledSchedule === _wrappedImport && _origImport) window._importPulledSchedule = _origImport; } catch (e) {}
    try { var s = document.getElementById(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { ['mlscpPulls', 'mlscpWalk', 'mlscpActing'].forEach(function (id) { var el = document.getElementById(id); if (el) { var host = el.closest && el.closest('.mlscp-actions-host'); (host || el).remove(); } }); } catch (e) {}
    try { var ezPull = document.getElementById('ezPull'); if (ezPull) ezPull.style.display = ''; } catch (e) {}
    try { window.__mlsCenterpiece.installed = false; } catch (e) {}
  }

  // ============================================================
  //  boot
  // ============================================================
  function boot() {
    injectStyle();
    wrapImport();
    startObserver();
    scheduleInject();
  }

  window.__mlsCenterpiece = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    inject: inject,
    startSchedulePull: startSchedulePull,
    startSelectedPull: startSelectedPull,
    startFindByName: startFindByName,
    captureWalk: captureWalk,
    openWalkPatient: openWalkPatient,
    _state: S,
    revert: revert
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } catch (e) { try { boot(); } catch (e2) {} }
})();

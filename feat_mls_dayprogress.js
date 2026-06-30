/* ============================================================================
 * feat_mls_dayprogress.js  —  item72 (STAGING)
 * ----------------------------------------------------------------------------
 * "Day Progress" meter pinned into the persistent patient context bar.
 *
 * WHY (doctor value + connective): the app already knows today's pulled
 * schedule, who has been seen, and who is "up now" - but that truth only lives
 * down in the Visit screen's NEXT-UP picker. This surfaces the SAME single
 * source of truth into the always-visible patient bar (Visit, History, Recs,
 * Orders), so wherever the doctor is they see at a glance:
 *      "3 / 12 seen today  -  Next 2:40p J. Doe"
 * and can click it to load that next patient - reusing the existing
 * _heroPickPatient handler, so the action is identical to tapping them in the
 * picker. One source of truth, one shared action, visible everywhere.
 *
 * HONEST SOURCING (no invented numbers):
 *   total  = today's appointments with a name  (window._heroTodayList)
 *   seen   = those for which the app's own _seenToday(name) is true
 *   nextUp = the app's own _calPickNowIdx(appts) "up now / next" choice
 *   If the schedule has not been pulled the meter hides itself.
 *
 * GUARDRAILS:
 *   Additive & reversible:  window.__mlsDayProgress.revert()
 *   Display + navigation only. Never writes/edits/deletes any record, note,
 *   roster entry or appointment. Never touches athenaOne.
 *   No body-subtree MutationObserver. Wraps renderPatientBar() + one cheap 30s
 *   backstop interval. Idempotent. Self-contained IIFE, try/catch throughout.
 * ==========================================================================*/
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsDayProgress && window.__mlsDayProgress.__booted) return;

  var WRAP_ID = 'mlsDayProgress';
  var STYLE_ID = 'mlsDayProgress-style';
  var timer = null;
  var origRenderBar = null;

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    try {
      var s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent =
        '#' + WRAP_ID + '{display:inline-flex;align-items:center;gap:8px;margin-left:12px;' +
        'padding:3px 10px;border-radius:999px;background:rgba(31,122,224,.12);' +
        'border:1px solid rgba(31,122,224,.32);font-size:12px;line-height:1.2;' +
        'color:#0c2c4d;vertical-align:middle;max-width:100%;}' +
        '#' + WRAP_ID + ' .mdp-bar{position:relative;width:62px;height:6px;border-radius:4px;' +
        'background:rgba(12,44,77,.16);overflow:hidden;flex:0 0 auto;}' +
        '#' + WRAP_ID + ' .mdp-fill{position:absolute;left:0;top:0;bottom:0;width:0;' +
        'background:linear-gradient(90deg,#1f7ae0,#27c98f);transition:width .3s ease;}' +
        '#' + WRAP_ID + ' .mdp-txt{font-weight:600;white-space:nowrap;}' +
        '#' + WRAP_ID + ' .mdp-next{display:inline-flex;align-items:center;gap:4px;' +
        'cursor:pointer;border:0;background:none;color:#1463c8;font:inherit;font-weight:600;' +
        'padding:2px 4px;border-radius:6px;white-space:nowrap;}' +
        '#' + WRAP_ID + ' .mdp-next:hover{background:rgba(31,122,224,.16);text-decoration:underline;}' +
        '@media (prefers-color-scheme:dark){#' + WRAP_ID + '{color:#dbe8f6;}' +
        '#' + WRAP_ID + ' .mdp-next{color:#8fc0f2;}}';
      document.head.appendChild(s);
    } catch (e) {}
  }

  function appts() {
    try {
      var a = window._heroTodayList || [];
      if (!Array.isArray(a)) return [];
      return a.filter(function (x) { return x && String(x.name || '').trim(); });
    } catch (e) { return []; }
  }

  function seenOf(list) {
    var n = 0;
    if (typeof window._seenToday !== 'function') return null;
    list.forEach(function (a) { try { if (window._seenToday(a.name)) n++; } catch (e) {} });
    return n;
  }

  function nextIdx(list) {
    try {
      if (typeof window._calPickNowIdx === 'function') {
        var i = window._calPickNowIdx(list);
        if (typeof i === 'number' && i >= 0) return i;
      }
    } catch (e) {}
    return -1;
  }

  function shortName(nm) {
    var p = String(nm || '').trim().split(/\s+/);
    if (!p.length || !p[0]) return 'patient';
    if (p.length === 1) return p[0];
    return p[0] + ' ' + (p[p.length - 1][0] || '') + '.';
  }

  function apptTime(a) {
    try { if (typeof window._fmtApptTime === 'function') return window._fmtApptTime(a.time || '') || ''; } catch (e) {}
    return String((a && a.time) || '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function jumpNext() {
    try {
      var list = appts(); if (!list.length) return;
      var idx = nextIdx(list); if (idx < 0) idx = 0;
      var orig = window._heroTodayList.indexOf(list[idx]);
      if (orig < 0) orig = idx;
      if (typeof window._heroPickPatient === 'function') {
        window._heroPickPatient(orig);
      } else if (typeof window.showView === 'function') {
        window.showView('visit');
      }
      try { if (typeof window.showView === 'function' && window.currentView !== 'visit') window.showView('visit'); } catch (e) {}
    } catch (e) {}
  }

  function render() {
    try {
      var bar = document.getElementById('patientBar');
      var inner = document.getElementById('patientBarInner');
      if (!bar || !inner) return;
      var existing = document.getElementById(WRAP_ID);
      var list = appts();
      var barVisible = bar.style.display !== 'none';
      if (!list.length || !barVisible) { if (existing) existing.remove(); return; }

      var total = list.length;
      var seen = seenOf(list);
      var idx = nextIdx(list);
      var nextA = idx >= 0 ? list[idx] : null;

      var pct = (seen != null && total) ? Math.round((seen / total) * 100) : 0;
      var txt = (seen != null) ? (seen + ' / ' + total + ' seen') : (total + ' today');

      var nextHtml = '';
      if (nextA) {
        var t = apptTime(nextA);
        nextHtml = '<button type="button" class="mdp-next" title="Load this patient (Up now / next)">' +
          'Next ' + (t ? (esc(t) + ' ') : '') + esc(shortName(nextA.name)) + '</button>';
      }

      var html =
        '<span class="mdp-bar"><span class="mdp-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="mdp-txt" title="Today pulled schedule">' + esc(txt) + '</span>' +
        nextHtml;

      if (!existing) {
        existing = document.createElement('span');
        existing.id = WRAP_ID;
        inner.parentNode.insertBefore(existing, inner.nextSibling);
      }
      existing.innerHTML = html;
      var btn = existing.querySelector('.mdp-next');
      if (btn) btn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); jumpNext(); });
    } catch (e) {}
  }

  function wrapRenderBar() {
    try {
      if (typeof window.renderPatientBar === 'function' && !origRenderBar) {
        origRenderBar = window.renderPatientBar;
        window.renderPatientBar = function () {
          var r;
          try { r = origRenderBar.apply(this, arguments); } catch (e) {}
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
    if (!timer) timer = setInterval(render, 30000);
  }

  window.__mlsDayProgress = {
    __booted: true,
    rerender: render,
    revert: function () {
      try { if (timer) { clearInterval(timer); timer = null; } } catch (e) {}
      try { if (origRenderBar) { window.renderPatientBar = origRenderBar; origRenderBar = null; } } catch (e) {}
      try { var w = document.getElementById(WRAP_ID); if (w) w.remove(); } catch (e) {}
      try { var s = document.getElementById(STYLE_ID); if (s) s.remove(); } catch (e) {}
      try { delete window.__mlsDayProgress; } catch (e) { window.__mlsDayProgress = undefined; }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
  } else { setTimeout(boot, 400); }
})();

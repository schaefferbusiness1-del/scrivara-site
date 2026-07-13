/* =========================================================================
 * MLS -- Visit Timeline  (feat_mls_visit_timeline.js -> window.__mlsVisitTimeline, vtl-1.0.0)
 * 2026-07-12, final integration sweep (demo polish lane).
 * ----------------------------------------------------------------------------
 * Adds a compact, clinical "Visit timeline" card to the patient profile:
 *   - one dot per saved visit along a real date axis;
 *   - when notes contain a pain score ("pain N/10"), the dots become a PAIN
 *     TREND line (0..10 axis) -- the chart is extracted from the doctor's own
 *     note text, nothing invented; visits without a parsable score sit on the
 *     baseline as neutral dots;
 *   - hover a dot -> date + score + first Subjective line; click -> opens the
 *     History view for this patient (profile <-> history coherence link).
 * READ-ONLY over getNotes()/patientNotes(); renders only when the profile is
 * visible and re-renders only when the (patient, notes) key changes -- no idle
 * DOM churn. Additive and reversible: window.__mlsVisitTimeline.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsVisitTimeline && window.__mlsVisitTimeline.installed) return; } catch (e) { return; }

  /* vtl-1.0.1: LIVE FREEZE FIX -- coalesced, always-key-checked renders.
   * vtl-1.0.2: DATA-SCALE HARDENING for heavy real accounts -- cheap store
   *   revision check before ANY note parsing; chart capped to the most recent
   *   150 notes; regexes see at most the first 4 KB of a note. Bounded cost
   *   regardless of store pathology (huge visit counts, giant pasted notes). */
  var VERSION = 'vtl-1.0.2';
  var CARD_ID = 'mlsVtlCard', STYLE_ID = 'mlsVtlStyle';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function esc(s) { return S(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function css() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '#' + CARD_ID + '{margin:12px 0;padding:14px 16px 10px;border:1px solid #E7E5DD;border-radius:14px;background:linear-gradient(180deg,#f7faff 0%,#EAF1EE 100%)}',
      '#' + CARD_ID + ' .vtl-h{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;font:800 13px/1.3 "Plus Jakarta Sans",system-ui,sans-serif;color:#204034}',
      '#' + CARD_ID + ' .vtl-h .n{font-weight:600;font-size:11.5px;color:#2E6A4B}',
      '#' + CARD_ID + ' svg{display:block;width:100%;height:86px}',
      '#' + CARD_ID + ' .vtl-dot{cursor:pointer;transition:r .12s}',
      '#' + CARD_ID + ' .vtl-dot:hover{r:6}',
      '#' + CARD_ID + ' .vtl-tip{font:600 11.5px/1.4 "Plus Jakarta Sans",system-ui,sans-serif;color:#204034;min-height:16px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#' + CARD_ID + ' .vtl-empty{font:600 12px/1.4 system-ui;color:#2E6A4B;padding:6px 0 10px}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function activeId() { return safe(function () { return isFn(window.getActivePtId) ? S(window.getActivePtId()) : ''; }, ''); }
  function notesFor(id) {
    return safe(function () {
      if (isFn(window.patientNotes)) return window.patientNotes(id) || [];
      return (isFn(window.getNotes) ? (window.getNotes() || []) : []).filter(function (n) { return n && (n.patientId === id || n.ptId === id); });
    }, []);
  }
  function parseDate(s) {
    s = S(s).trim(); if (!s) return null;
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return new Date(+m[3], +m[1] - 1, +m[2]).getTime();
    var d = new Date(s); return isNaN(d.getTime()) ? null : d.getTime();
  }
  function painOf(txt) {
    var m = S(txt).match(/pain[^\d]{0,12}(\d{1,2})\s*(?:\/|\s+out\s+of\s+)\s*10/i);
    if (!m) return null;
    var v = parseInt(m[1], 10);
    return (v >= 0 && v <= 10) ? v : null;
  }
  function firstSubj(txt) {
    var m = S(txt).match(/(?:^|\n)\s*S\s*[:\-]\s*([^\n]{0,90})/);
    return m ? m[1].trim() : S(txt).split('\n')[0].slice(0, 90);
  }

  /* vtl-1.0.2 DATA-SCALE HARDENING: real accounts can hold pathological data
     (one patient with thousands of filed visits; single chart-paste notes of
     hundreds of KB). Caps: only the most recent 150 notes are charted, and
     regexes only ever see the first 4 KB of a note (S:/pain lines live at the
     top of real notes). Worst-case per rebuild is bounded no matter the store. */
  var MAX_NOTES = 150, MAX_SCAN = 4000;
  function buildPoints(id) {
    var ns = notesFor(id), pts = [];
    var start = ns.length > MAX_NOTES ? ns.length - MAX_NOTES : 0;
    for (var i = start; i < ns.length; i++) {
      var n = ns[i]; if (!n) continue;
      var t = parseDate(n.date || n.created || n.at);
      if (t == null) continue;
      var txt = S(n.note).slice(0, MAX_SCAN);
      pts.push({ t: t, pain: painOf(txt), subj: firstSubj(txt), date: S(n.date || '').slice(0, 10), id: n.id });
    }
    pts.sort(function (a, b) { return a.t - b.t; });
    return pts.slice(-60);
  }
  /* cheap store revision -- O(store entries) pointer copy via the b132 cache,
     no text scanning -- so poll ticks pay ~zero when nothing changed */
  function storeRev(id) {
    return safe(function () {
      var all = isFn(window.getNotes) ? (window.getNotes() || []) : [];
      var last = all.length ? all[all.length - 1] : null;
      return all.length + '|' + (last ? S(last.id) + ':' + S(last.note).length : '0');
    }, 'err');
  }

  /* vtl-1.0.1 LIVE FREEZE FIX (07-12): render(true) used to bypass the
     write-if-changed key entirely, so EVERY renderProfile call (which fires
     continuously in real use -- storage-driven card refreshes, sibling module
     wraps) triggered a full innerHTML/SVG rebuild: sustained DOM churn waking
     every body-wide MutationObserver. Now even forced renders rebuild ONLY
     when the (patient, notes) key actually changed; force just skips nothing
     else. Combined with schedule() coalescing below, worst case is one
     comparison per call and one rebuild per real change. */
  var lastKey = '';
  function render(force) {
    var host = findHost();
    var id = activeId();
    if (!host || !id) { if ($(CARD_ID)) remove(); lastKey = ''; return; }
    /* vtl-1.0.2: the CHEAP revision check runs BEFORE any note parsing, so a
       poll tick on an unchanged store costs microseconds even on a store with
       tens of thousands of notes. */
    var key = id + '|' + storeRev(id);
    if (key === lastKey && $(CARD_ID)) return;             /* write-if-changed: ALWAYS */
    var pts = buildPoints(id);
    lastKey = key;
    css();
    var card = $(CARD_ID);
    if (!card) {
      card = document.createElement('div'); card.id = CARD_ID;
      host.appendChild(card);
    }
    var painPts = pts.filter(function (p) { return p.pain != null; });
    var W = 560, H = 74, PADX = 14, PADY = 10;
    var t0 = pts.length ? pts[0].t : 0, t1 = pts.length ? pts[pts.length - 1].t : 1;
    if (t1 <= t0) t1 = t0 + 1;
    function X(t) { return PADX + (W - 2 * PADX) * (t - t0) / (t1 - t0); }
    function Y(pain) { return pain == null ? (H - PADY) : (PADY + (H - 2 * PADY) * (1 - pain / 10)); }
    var head = '<div class="vtl-h">📈 Pain &amp; visit trend <span class="n">' + pts.length + ' visit' + (pts.length === 1 ? '' : 's') +
      (painPts.length >= 2 ? ' · pain trend from your notes' : '') + '</span></div>';
    if (!pts.length) {
      card.innerHTML = head + '<div class="vtl-empty">No dated visits yet — new notes will appear here as a timeline.</div>';
      return;
    }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">';
    svg += '<line x1="' + PADX + '" y1="' + (H - PADY) + '" x2="' + (W - PADX) + '" y2="' + (H - PADY) + '" stroke="#c8d9ef" stroke-width="1"/>';
    if (painPts.length >= 2) {
      var dpath = '';
      for (var i = 0; i < painPts.length; i++) dpath += (i ? 'L' : 'M') + X(painPts[i].t).toFixed(1) + ' ' + Y(painPts[i].pain).toFixed(1) + ' ';
      svg += '<path d="' + dpath + '" fill="none" stroke="#2E6A4B" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>';
    }
    for (var j = 0; j < pts.length; j++) {
      var p = pts[j];
      var col = p.pain == null ? '#C9DCD2' : (p.pain >= 7 ? '#e05252' : p.pain >= 4 ? '#e8a13c' : '#2fa46a');
      svg += '<circle class="vtl-dot" data-i="' + j + '" cx="' + X(p.t).toFixed(1) + '" cy="' + Y(p.pain).toFixed(1) + '" r="4.5" fill="' + col + '" stroke="#fff" stroke-width="1.5"/>';
    }
    svg += '</svg>';
    card.innerHTML = head + svg + '<div class="vtl-tip" id="mlsVtlTip">Hover a visit for details · click to open it in History</div>';
    var tip = $('mlsVtlTip');
    var dots = card.querySelectorAll('.vtl-dot');
    for (var k = 0; k < dots.length; k++) {
      (function (dot) {
        var p = pts[parseInt(dot.getAttribute('data-i'), 10)];
        dot.addEventListener('mouseenter', function () {
          if (tip) tip.textContent = (p.date || 'visit') + (p.pain != null ? (' · pain ' + p.pain + '/10') : '') + (p.subj ? (' · ' + p.subj) : '');
        });
        dot.addEventListener('click', function () {
          var nav = $('nav_history'); if (nav) nav.click(); else safe(function () { if (isFn(window.showView)) window.showView('history'); });
        });
      })(dots[k]);
    }
  }
  function findHost() {
    var prof = $('profileCard');
    if (!prof || !prof.offsetParent) return null;
    return prof;
  }
  function remove() { var c = $(CARD_ID); if (c && c.parentNode) c.parentNode.removeChild(c); }

  /* renderProfile wrap (same additive pattern as easy-prep) + gentle poll fallback.
     vtl-1.0.1: renders are COALESCED -- any burst of renderProfile calls
     schedules at most ONE pending render (which is itself key-checked). */
  var wrapped = false, origRender = null, pollIv = null, pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; safe(function () { render(false); }); }, 120);
  }
  function wrapRenderProfile() {
    if (wrapped) return;
    if (!isFn(window.renderProfile) || window.renderProfile.__vtlWrapped) { wrapped = !!(window.renderProfile && window.renderProfile.__vtlWrapped); return; }
    origRender = window.renderProfile;
    var w = function () {
      var r;
      try { r = origRender.apply(this, arguments); } catch (e) {}
      safe(schedule);
      return r;
    };
    w.__vtlWrapped = true; w.__vtlOrig = origRender;
    window.renderProfile = w;
    wrapped = true;
  }
  function boot() {
    wrapRenderProfile();
    pollIv = setInterval(function () { safe(wrapRenderProfile); safe(function () { render(false); }); }, 2000);
    safe(function () { render(false); });
  }
  function revert() {
    if (pollIv) { clearInterval(pollIv); pollIv = null; }
    try { if (window.renderProfile && window.renderProfile.__vtlWrapped && window.renderProfile.__vtlOrig) window.renderProfile = window.renderProfile.__vtlOrig; } catch (e) {}
    remove();
    var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s);
    try { window.__mlsVisitTimeline.installed = false; } catch (e) {}
    return 'visit timeline reverted';
  }

  window.__mlsVisitTimeline = { installed: true, version: VERSION, asset: 'feat_mls_visit_timeline.js', render: function () { lastKey = ''; render(false); }, _points: buildPoints, revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

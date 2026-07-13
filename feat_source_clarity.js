/* =============================================================================
 * feat_source_clarity.js  —  window.__mlsSourceClarity  (v1.0.1 - athena-visits recognized)
 * -----------------------------------------------------------------------------
 * Makes Athena provenance obvious EVERYWHERE with color-coded circles.
 *
 * Reads ONLY the real per-visit model (§40 window.__mlsVisitModel): every visit
 * already carries  source  +  captured (ISO import timestamp).  Nothing here
 * fabricates, renames, or writes a clinical value.  A visit is labelled
 * "From Athena" ONLY when its real source proves it; anything untagged/unknown
 * stays grey.  Additive + instant-revertible (window.__mlsSourceClarity.revert).
 *
 * Color legend (consistent across the app):
 *   blue   = From Athena            (source: 'athena-copy'      — copy every visit / single-chart import)
 *   purple = Athena cohort search   (source: 'cohort-injection' — procedure/injection cohort grab)
 *   green  = Manual entry           (source: 'manual' | 'manual-ai' — typed / paste-AI in-app)
 *   grey   = Unknown / untagged     (source: 'import' | missing | anything else)
 *
 * Surfaces decorated:
 *   1. Legend key            — top of the §52 visit-history view (#mlsVisitHistoryExt)
 *   2. Per-patient summary    — "N of M visits From Athena · last import <date>" + chips
 *   3. Per-visit timeline     — colored circle + label on every §52 card (matched by data-vid)
 *   4. Per-visit detail card  — provenance banner prepended to __mlsVisitDetail.buildRead
 *   5. "What was imported"    — toast after a copy-every-visit import ("Imported N From Athena…")
 *
 * Progressive enhancement only; ScribeFlow.html / backend / extension untouched.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsSourceClarity && window.__mlsSourceClarity.installed) return;

  var VERSION = '1.0.1';
  var STYLE_ID = 'mls-src-clarity-style';
  var LEGEND_ID = 'mlsSrcLegend';
  var SUMMARY_ID = 'mlsSrcSummary';

  /* ---- color palette (literal, strong-contrast; dark text on light) -------- */
  var INK = 'var(--ink, #1A211C)';
  var SOFT = 'var(--soft, #f5f7fa)';
  var LINE = 'var(--line, #d9e1ea)';
  var C_ATHENA = '#2E6A4B'; // blue
  var C_COHORT = '#7A5CC0'; // purple
  var C_MANUAL = '#1f9d57'; // green
  var C_UNKNOWN = '#9aa3ad'; // grey

  /* ---- PURE: map a real visit.source value -> provenance meta -------------- */
  function srcMeta(source) {
    var s = (source == null ? '' : String(source)).toLowerCase().trim();
    if (s === 'athena-copy' || s === 'athena' || s === 'athena-copy-every-visit' || s === 'athena-visits' || s === 'athena-visits-pane')
      return { key: 'athena', label: 'From Athena', color: C_ATHENA };
    if (s === 'cohort-injection' || s === 'athena-cohort' || s === 'cohort')
      return { key: 'cohort', label: 'Athena cohort search', color: C_COHORT };
    if (s === 'manual' || s === 'manual-ai')
      return { key: 'manual', label: 'Manual entry', color: C_MANUAL };
    return { key: 'unknown', label: 'Unknown / untagged', color: C_UNKNOWN };
  }
  // Is this source one that genuinely came from Athena?  (blue or purple)
  function isAthena(source) {
    var k = srcMeta(source).key;
    return k === 'athena' || k === 'cohort';
  }

  /* ---- PURE: format the persisted import timestamp (captured / importedAt) -- */
  function fmtImport(captured) {
    if (!captured) return '';
    var d = new Date(captured);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }
  function importTs(v) {
    // captured is the field every import flow already stamps; importedAt is an alias if present.
    return (v && (v.importedAt || v.captured)) || '';
  }

  /* ---- PURE: tally a patient's visits by provenance ------------------------ */
  function summarize(visits) {
    var out = { total: 0, athena: 0, cohort: 0, manual: 0, unknown: 0, lastImport: '', hasCohort: false };
    if (!visits || !visits.length) return out;
    out.total = visits.length;
    for (var i = 0; i < visits.length; i++) {
      var v = visits[i] || {};
      var k = srcMeta(v.source).key;
      out[k] = (out[k] || 0) + 1;
      if (k === 'cohort') out.hasCohort = true;
      if (isAthena(v.source)) {
        var ts = importTs(v);
        if (ts && (!out.lastImport || new Date(ts) > new Date(out.lastImport))) out.lastImport = ts;
      }
    }
    return out;
  }

  /* ---- small DOM helpers --------------------------------------------------- */
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  // a crisp CSS circle (border guarantees contrast even for light fills)
  function dot(color) {
    var d = el('span', 'mls-src-dot');
    d.style.background = color;
    d.setAttribute('aria-hidden', 'true');
    return d;
  }
  // circle + label chip
  function chip(meta, extra) {
    var c = el('span', 'mls-src-chip mls-src-' + meta.key);
    c.appendChild(dot(meta.color));
    c.appendChild(el('span', 'mls-src-lab', meta.label + (extra ? ' ' + extra : '')));
    c.title = meta.label + (extra ? ' ' + extra : '');
    return c;
  }

  /* ---- styles -------------------------------------------------------------- */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.mls-src-dot{display:inline-block;width:11px;height:11px;border-radius:50%;' +
      'border:1px solid rgba(0,0,0,.28);box-shadow:0 0 0 1px rgba(255,255,255,.65);' +
      'vertical-align:middle;flex:0 0 auto}' +
      '.mls-src-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;' +
      'font-weight:600;color:' + INK + ';line-height:1.2;white-space:nowrap}' +
      '.mls-src-lab{color:' + INK + '}' +
      '.mls-src-legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;' +
      'margin:8px 0 12px;padding:9px 12px;background:' + SOFT + ';border:1px solid ' + LINE + ';' +
      'border-radius:10px;font-size:12px;color:' + INK + '}' +
      '.mls-src-legend .mls-src-legtitle{font-weight:700;color:' + INK + ';margin-right:2px}' +
      '.mls-src-summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;' +
      'margin:6px 0 10px;padding:10px 12px;background:' + SOFT + ';border:1px solid ' + LINE + ';' +
      'border-radius:10px;font-size:12.5px;color:' + INK + '}' +
      '.mls-src-summary .mls-src-headline{font-weight:700;color:' + INK + '}' +
      '.mls-src-summary .mls-src-count{display:inline-flex;align-items:center;gap:5px;' +
      'padding:2px 8px;border-radius:999px;background:#fff;border:1px solid ' + LINE + ';' +
      'font-weight:600;color:' + INK + '}' +
      '.mls-src-cohortflag{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;' +
      'border-radius:999px;background:rgba(124,58,237,.10);border:1px solid rgba(124,58,237,.40);' +
      'color:#5b21b6;font-weight:700}' +
      '.mls-src-cardchip{margin-top:4px}' +
      '.mls-src-headdot{margin-right:6px}' +
      '.mlsxh-card .mls-src-cardchip{display:inline-flex}' +
      '.mls-src-banner{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:8px 11px;' +
      'border-radius:9px;background:' + SOFT + ';border:1px solid ' + LINE + ';' +
      'font-size:12.5px;font-weight:600;color:' + INK + '}' +
      '.mls-src-banner .mls-src-when{font-weight:500;color:' + INK + ';opacity:.85}' +
      '.mls-src-toast{position:fixed;right:18px;bottom:18px;z-index:99999;max-width:340px;' +
      'display:flex;align-items:center;gap:9px;padding:12px 14px;border-radius:11px;' +
      'background:#0f2740;color:#eaf1fb;font-size:13px;font-weight:600;line-height:1.35;' +
      'box-shadow:0 8px 26px rgba(0,0,0,.30);opacity:0;transform:translateY(8px);' +
      'transition:opacity .25s,transform .25s}' +
      '.mls-src-toast.show{opacity:1;transform:none}' +
      '.mls-src-toast .mls-src-dot{box-shadow:0 0 0 1px rgba(255,255,255,.35)}';
    var st = el('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- LEGEND (key) -------------------------------------------------------- */
  function buildLegend() {
    var box = el('div', 'mls-src-legend');
    box.id = LEGEND_ID;
    box.appendChild(el('span', 'mls-src-legtitle', 'Source:'));
    [
      { key: 'athena', label: 'From Athena', color: C_ATHENA },
      { key: 'cohort', label: 'Athena cohort search', color: C_COHORT },
      { key: 'manual', label: 'Manual entry', color: C_MANUAL },
      { key: 'unknown', label: 'Unknown / untagged', color: C_UNKNOWN }
    ].forEach(function (m) { box.appendChild(chip(m)); });
    return box;
  }

  /* ---- PER-PATIENT summary ------------------------------------------------- */
  function buildSummary(sum) {
    var box = el('div', 'mls-src-summary');
    box.id = SUMMARY_ID;
    if (!sum.total) { box.appendChild(el('span', 'mls-src-headline', 'No visits yet')); return box; }
    var head = sum.athena + ' of ' + sum.total + ' visits From Athena';
    if (sum.lastImport) head += ' · last import ' + fmtImport(sum.lastImport);
    box.appendChild(el('span', 'mls-src-headline', head));

    function count(meta, n) {
      if (!n) return;
      var c = el('span', 'mls-src-count');
      c.appendChild(dot(meta.color));
      c.appendChild(el('span', null, n + ' ' + meta.label));
      box.appendChild(c);
    }
    count({ key: 'athena', label: 'From Athena', color: C_ATHENA }, sum.athena);
    count({ key: 'cohort', label: 'cohort search', color: C_COHORT }, sum.cohort);
    count({ key: 'manual', label: 'Manual', color: C_MANUAL }, sum.manual);
    count({ key: 'unknown', label: 'Untagged', color: C_UNKNOWN }, sum.unknown);

    if (sum.hasCohort) {
      var flag = el('span', 'mls-src-cohortflag');
      flag.appendChild(dot(C_COHORT));
      flag.appendChild(el('span', null, 'Brought in via Athena cohort search'));
      box.appendChild(flag);
    }
    return box;
  }

  /* ---- map the active patient's visits by id ------------------------------- */
  function visitMap() {
    var m = {};
    try {
      var p = (typeof window.activePatient === 'function') ? window.activePatient() : null;
      if (!p) return { patient: null, map: m, visits: [] };
      var vs = (window.__mlsVisitModel && window.__mlsVisitModel.getVisits)
        ? (window.__mlsVisitModel.getVisits(p) || [])
        : (p.visits || []);
      for (var i = 0; i < vs.length; i++) { if (vs[i] && vs[i].id != null) m[String(vs[i].id)] = vs[i]; }
      return { patient: p, map: m, visits: vs };
    } catch (e) { return { patient: null, map: m, visits: [] }; }
  }

  /* ---- decorate the §52 timeline (#mlsVisitHistoryExt) ---------------------- */
  function decorate() {
    try {
      var root = document.getElementById('mlsVisitHistoryExt');
      if (!root) return;
      var ctx = visitMap();

      // 1) legend at the very top (once)
      if (!root.querySelector('#' + LEGEND_ID)) {
        var head = root.querySelector('.mlsxh-head');
        var legend = buildLegend();
        if (head && head.parentNode) head.parentNode.insertBefore(legend, head.nextSibling);
        else root.insertBefore(legend, root.firstChild);
      }

      // 2) per-patient summary — only rebuild when the provenance tally changes,
      //    so a steady-state decorate() makes NO DOM mutation (no observer churn).
      var sum = summarize(ctx.visits);
      var sig = [sum.total, sum.athena, sum.cohort, sum.manual, sum.unknown, sum.lastImport].join('|');
      var old = root.querySelector('#' + SUMMARY_ID);
      if (!old || old.getAttribute('data-sig') !== sig) {
        var summary = buildSummary(sum);
        summary.setAttribute('data-sig', sig);
        if (old) old.parentNode.replaceChild(summary, old);
        else {
          var lg = root.querySelector('#' + LEGEND_ID);
          if (lg && lg.parentNode) lg.parentNode.insertBefore(summary, lg.nextSibling);
          else root.insertBefore(summary, root.firstChild);
        }
      }

      // 3) per-visit circle on every card, matched by the card's own data-vid
      var cards = root.querySelectorAll('.mlsxh-card');
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var vid = card.getAttribute('data-vid');
        var v = (vid != null) ? ctx.map[String(vid)] : null;
        var src = v ? v.source : null;
        var meta = srcMeta(src);
        var sig = meta.key;
        if (card.getAttribute('data-mls-src') === sig && card.querySelector('.mls-src-cardchip')) continue;
        var prev = card.querySelector('.mls-src-cardchip');
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
        var when = v ? fmtImport(importTs(v)) : '';
        var extra = (meta.key === 'athena' || meta.key === 'cohort') && when ? '· imported ' + when : '';
        var ch = chip(meta, extra);
        ch.classList.add('mls-src-cardchip');
        var main = card.querySelector('.mlsxh-main') || card;
        main.appendChild(ch);
        card.setAttribute('data-mls-src', sig);
      }
    } catch (e) { /* progressive enhancement: never throw */ }
  }

  /* ---- wrap __mlsVisitDetail.buildRead -> provenance banner ----------------- */
  var _origBuildRead = null;
  function wrapBuildRead() {
    try {
      var d = window.__mlsVisitDetail;
      if (!d || typeof d.buildRead !== 'function' || d.buildRead.__mlsSrcWrapped) return;
      var inner = d.buildRead;                       /* per-wrapper capture (cycle fix) */
      if (!_origBuildRead) _origBuildRead = inner;   /* first-ever original, for unwrap */
      var wrapped = function (visit, patient) {
        var res = inner.apply(this, arguments);
        try {
          // §45 buildRead returns { body, editBtn, regenBtn, status } where body is the
          // read-view DOM node; older/other builds may return the node directly.
          var host = (res && res.body && res.body.nodeType === 1) ? res.body
                   : (res && res.nodeType === 1) ? res : null;
          if (host && visit) {
            var meta = srcMeta(visit.source);
            var when = fmtImport(importTs(visit));
            var banner = el('div', 'mls-src-banner');
            banner.appendChild(dot(meta.color));
            banner.appendChild(el('span', null, meta.label));
            if ((meta.key === 'athena' || meta.key === 'cohort') && when)
              banner.appendChild(el('span', 'mls-src-when', '· imported ' + when));
            if (!host.querySelector('.mls-src-banner')) host.insertBefore(banner, host.firstChild);
          }
        } catch (e) {}
        return res;
      };
      for (var k in inner) { try { wrapped[k] = inner[k]; } catch (e) {} } /* carry markers forward */
      wrapped.__mlsSrcWrapped = true;
      d.buildRead = wrapped;
    } catch (e) {}
  }
  function unwrapBuildRead() {
    try {
      var d = window.__mlsVisitDetail;
      if (d && _origBuildRead && d.buildRead && d.buildRead.__mlsSrcWrapped) d.buildRead = _origBuildRead;
    } catch (e) {}
  }

  /* ---- wrap __mlsVisitDetail.buildCard -> circle on the collapsed header ---- */
  var _origBuildCard = null;
  function wrapBuildCard() {
    try {
      var d = window.__mlsVisitDetail;
      if (!d || typeof d.buildCard !== 'function' || d.buildCard.__mlsSrcWrapped) return;
      var inner = d.buildCard;                       /* per-wrapper capture (cycle fix) */
      if (!_origBuildCard) _origBuildCard = inner;
      var wrapped = function (visit, patient) {
        var card = inner.apply(this, arguments);
        try {
          if (card && card.nodeType === 1 && visit) {
            var head = card.querySelector('.mlsvd-head') || card;
            if (!head.querySelector('.mls-src-headdot')) {
              var meta = srcMeta(visit.source);
              var hd = dot(meta.color);
              hd.classList.add('mls-src-headdot');
              hd.title = meta.label;
              head.insertBefore(hd, head.firstChild);
            }
          }
        } catch (e) {}
        return card;
      };
      for (var k in inner) { try { wrapped[k] = inner[k]; } catch (e) {} } /* carry markers forward */
      wrapped.__mlsSrcWrapped = true;
      d.buildCard = wrapped;
    } catch (e) {}
  }
  function unwrapBuildCard() {
    try {
      var d = window.__mlsVisitDetail;
      if (d && _origBuildCard && d.buildCard && d.buildCard.__mlsSrcWrapped) d.buildCard = _origBuildCard;
    } catch (e) {}
  }

  /* ---- "what was imported" toast + copy-flow wrap -------------------------- */
  function toast(metaColor, msg) {
    try {
      var t = el('div', 'mls-src-toast');
      t.appendChild(dot(metaColor));
      t.appendChild(el('span', null, msg));
      document.body.appendChild(t);
      requestAnimationFrame(function () { t.classList.add('show'); });
      setTimeout(function () {
        t.classList.remove('show');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 350);
      }, 5200);
    } catch (e) {}
  }
  var _origRun = null;
  function wrapCopyRun() {
    try {
      var c = window.__mlsCopyVisits;
      if (!c || typeof c.run !== 'function' || c.run.__mlsSrcWrapped) return;
      var inner = c.run;                             /* per-wrapper capture (cycle fix) */
      if (!_origRun) _origRun = inner;
      var wrapped = function () {
        // snapshot athena visit ids BEFORE the import
        var before = {};
        try {
          var ctx0 = visitMap();
          ctx0.visits.forEach(function (v) { if (isAthena(v.source) && v.id != null) before[String(v.id)] = 1; });
        } catch (e) {}
        var ret = inner.apply(this, arguments);
        var announce = function () {
          try {
            var ctx1 = visitMap();
            var fresh = 0, last = '';
            ctx1.visits.forEach(function (v) {
              if (isAthena(v.source) && (v.id == null || !before[String(v.id)])) {
                fresh++; var ts = importTs(v);
                if (ts && (!last || new Date(ts) > new Date(last))) last = ts;
              }
            });
            if (fresh > 0) {
              var when = fmtImport(last) || fmtImport(new Date().toISOString());
              toast(C_ATHENA, 'Imported ' + fresh + ' visit' + (fresh === 1 ? '' : 's') + ' From Athena on ' + when);
            }
            decorate();
          } catch (e) {}
        };
        if (ret && typeof ret.then === 'function') ret.then(announce, function () {});
        else setTimeout(announce, 1500);
        return ret;
      };
      for (var k in inner) { try { wrapped[k] = inner[k]; } catch (e) {} } /* carry markers forward */
      wrapped.__mlsSrcWrapped = true;
      c.run = wrapped;
    } catch (e) {}
  }
  function unwrapCopyRun() {
    try {
      var c = window.__mlsCopyVisits;
      if (c && _origRun && c.run && c.run.__mlsSrcWrapped) c.run = _origRun;
    } catch (e) {}
  }

  /* ---- importedAt mirror (additive, never alters source) ------------------- */
  var _origAddVisit = null;
  function wrapAddVisit() {
    try {
      var m = window.__mlsVisitModel;
      if (!m || typeof m.addVisit !== 'function' || m.addVisit.__mlsSrcWrapped) return;
      /* __mlsSrcCycleFix v2: capture the inner fn PER WRAPPER. The old code read
         the shared module-level _origAddVisit AT CALL TIME and overwrote it on
         every re-wrap - with feat_visits_honest wrapped in between, that armed
         the h1<->c1 infinite mutual recursion (the 'visit filing is broken'
         banner / RangeError ingest failures). A per-wrapper closure makes every
         chain terminate at the real model function no matter the load order. */
      var inner = m.addVisit;
      if (!_origAddVisit) _origAddVisit = inner;     /* first-ever original, for unwrap */
      var wrapped = function () {
        var r = inner.apply(this, arguments);
        try {
          // tag importedAt = captured on the stored visit, purely additive metadata.
          if (r && typeof r === 'object') {
            if (r.captured && !r.importedAt) r.importedAt = r.captured;
          }
        } catch (e) {}
        return r;
      };
      wrapped.__mlsSrcWrapped = true;
      for (var k in inner) { try { wrapped[k] = inner[k]; } catch (e) {} } /* carry other modules' idempotency markers forward */
      m.addVisit = wrapped;
    } catch (e) {}
  }
  function unwrapAddVisit() {
    try {
      var m = window.__mlsVisitModel;
      if (m && _origAddVisit && m.addVisit && m.addVisit.__mlsSrcWrapped) m.addVisit = _origAddVisit;
    } catch (e) {}
  }

  /* ---- lifecycle ----------------------------------------------------------- */
  var _obs = null, _timer = null, _pending = null, _busy = false;
  // Run decorate() with the observer disconnected so our OWN DOM writes can never
  // re-trigger the observer (which would loop). Debounced via schedule().
  function safeDecorate() {
    if (_busy) return;
    _busy = true;
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { decorate(); } catch (e) {}
    try { var h = document.getElementById('profileCard') || document.body; if (_obs && h) _obs.observe(h, { childList: true, subtree: true }); } catch (e) {}
    _busy = false;
  }
  function schedule() { if (_pending) return; _pending = setTimeout(function () { _pending = null; safeDecorate(); }, 120); }
  function boot() {
    injectStyle();
    wrapBuildRead();
    wrapBuildCard();
    wrapCopyRun();
    wrapAddVisit();
    decorate();
    try {
      var host = document.getElementById('profileCard') || document.body;
      if (host && !_obs) {
        _obs = new MutationObserver(function () { schedule(); });
        _obs.observe(host, { childList: true, subtree: true });
      }
    } catch (e) {}
    if (!_timer) _timer = setInterval(function () { wrapBuildRead(); wrapBuildCard(); wrapCopyRun(); wrapAddVisit(); safeDecorate(); }, 1200);
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); _obs = null; } catch (e) {}
    try { if (_timer) clearInterval(_timer); _timer = null; } catch (e) {}
    try { if (_pending) clearTimeout(_pending); _pending = null; } catch (e) {}
    unwrapBuildRead();
    unwrapBuildCard();
    unwrapCopyRun();
    unwrapAddVisit();
    try {
      var s = document.getElementById(STYLE_ID); if (s) s.parentNode.removeChild(s);
      document.querySelectorAll('#' + LEGEND_ID + ',#' + SUMMARY_ID + ',.mls-src-cardchip,.mls-src-banner,.mls-src-toast,.mls-src-headdot')
        .forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      document.querySelectorAll('[data-mls-src]').forEach(function (n) { n.removeAttribute('data-mls-src'); });
    } catch (e) {}
    window.__mlsSourceClarity.installed = false;
  }

  window.__mlsSourceClarity = {
    installed: true,
    version: VERSION,
    revert: revert,
    decorate: decorate,
    _srcMeta: srcMeta,
    _isAthena: isAthena,
    _fmtImport: fmtImport,
    _summarize: summarize,
    _buildLegend: buildLegend,
    _buildSummary: buildSummary
  };

  // boot is idempotent (style guarded, wraps self-flag, decorate de-dupes), so run now;
  // re-decorate once more after DOMContentLoaded if the DOM was still parsing.
  boot();
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', function () { try { boot(); } catch (e) {} }, { once: true });
})();

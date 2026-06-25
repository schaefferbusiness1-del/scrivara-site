/* ============================================================================
 * feat_mls_timeline_sync.js  ->  window.__mlsTl   (tl-1.0.1)
 * ---------------------------------------------------------------------------
 * ITEM 8: visits referenced in the patient SUMMARY must appear in the visit
 * TIMELINE (no missing visits).
 *
 * ROOT CAUSE: renderPtTimeline(p) renders ONLY patientNotes(p.id) (the MLS notes
 * table). Historical encounters pulled from athenaOne are stored as "Recent
 * visits:" bullet lines inside p.summary (text) plus a single combined "Athena
 * chart import" note -- so each individual prior visit named in the summary
 * never shows as its own timeline row.
 *
 * FIX (additive, reversible): wrap window.renderPtTimeline. After the original
 * runs, parse the patient's summary (and any p.visits array) for visit entries,
 * dedupe against rows already shown (by day), and APPEND the missing ones to
 * #ptTimeline as read-only "from summary" rows (sorted newest first). Clicking
 * one reveals the summary. No data changed, no fabrication -- it only surfaces
 * visits the record already contains. ASCII-only (bullets via \u escapes),
 * idempotent. Reversible: window.__mlsTl.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsTl && window.__mlsTl.installed) return; } catch (e) { return; }

  var VERSION = 'tl-1.0.1';
  var _orig = null;
  var BULLETS = /^[\s•●‣⁃\*\-]+/;   // bullet / dash leaders
  var DIVIDER = /^[\s—–\-]*$/;                // dashes-only divider line

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- date parsing for sort + dedupe (returns {ms, dayKey} or null) ----
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseDate(s) {
    s = String(s || '');
    var m = s.match(/\b([01]?\d)[\/\-]([0-3]?\d)[\/\-]((?:19|20)?\d\d)\b/); // MM/DD/YYYY or MM/DD/YY
    if (m) {
      var yr = m[3].length === 2 ? (parseInt(m[3], 10) > 50 ? 1900 + +m[3] : 2000 + +m[3]) : +m[3];
      var d = new Date(yr, (+m[1]) - 1, +m[2]);
      if (!isNaN(d)) return { ms: d.getTime(), dayKey: yr + '-' + (+m[1]) + '-' + (+m[2]) };
    }
    var m2 = s.match(/\b([A-Za-z]{3,9})\.?\s+([0-3]?\d),?\s+((?:19|20)\d\d)\b/); // Month D, YYYY
    if (m2) {
      var mo = MONTHS[m2[1].slice(0, 3).toLowerCase()];
      if (mo != null) { var d2 = new Date(+m2[3], mo, +m2[2]); if (!isNaN(d2)) return { ms: d2.getTime(), dayKey: m2[3] + '-' + (mo + 1) + '-' + (+m2[2]) }; }
    }
    return null;
  }

  // ---- collect historical visits referenced in the summary / p.visits ----
  function collectVisits(p) {
    var out = [];
    function addLine(line, sectionIsVisits) {
      var t = String(line || '').replace(BULLETS, '').trim();
      if (!t) return;
      if (DIVIDER.test(t)) return;                       // dashes-only divider
      if (/pulled from athena/i.test(t)) return;         // the import stamp, not a visit
      var dt = parseDate(t);
      // a row counts as a visit only if it is under a real "visits" section OR carries a date
      if (!dt && !sectionIsVisits) return;
      if (t.length > 220) t = t.slice(0, 217) + '...';
      out.push({ label: t, ms: dt ? dt.ms : 0, dayKey: dt ? dt.dayKey : null, dated: !!dt });
    }
    // 1) structured p.visits (array of strings or {date,reason,...})
    var pv = p && p.visits;
    if (Array.isArray(pv)) {
      pv.forEach(function (v) {
        if (typeof v === 'string') addLine(v, true);
        else if (v && typeof v === 'object') {
          var lbl = [v.date || v.dos || '', v.reason || v.cc || v.type || v.note || ''].filter(Boolean).join(' - ');
          if (lbl) addLine(lbl, true);
        }
      });
    }
    // 2) parse the summary text for visit sections + dated bullets
    var sum = (p && p.summary) ? String(p.summary) : '';
    if (sum) {
      var lines = sum.split(/\r?\n/);
      var inVisits = false;
      lines.forEach(function (ln) {
        var head = ln.trim().toLowerCase();
        // ONLY genuine visit-section headers turn on inclusion of every bullet.
        // ("Prior history" is intentionally excluded -- its non-dated bullets are
        // problems, not visits; dated bullets there are still caught via the date.)
        if (/^(recent visits|past visits|prior visits|visit history|encounters?)\b/.test(head)) { inVisits = true; return; }
        if (inVisits && ln.trim() && !BULLETS.test(ln) && /:$/.test(ln.trim())) { inVisits = false; }
        var isBullet = BULLETS.test(ln);
        if (isBullet || inVisits) addLine(ln, inVisits);
        else if (parseDate(ln)) addLine(ln, false);      // stray dated line
      });
    }
    // dedupe by (dayKey + first 40 chars of label)
    var seen = {}, uniq = [];
    out.forEach(function (e) {
      var k = (e.dayKey || 'nd') + '|' + e.label.slice(0, 40).toLowerCase();
      if (seen[k]) return; seen[k] = 1; uniq.push(e);
    });
    return uniq;
  }

  // existing timeline rows' day-keys (so we don't duplicate a visit that already has a note)
  function existingDayKeys(p) {
    var keys = {};
    safe(function () {
      if (typeof window.patientNotes !== 'function') return;
      window.patientNotes(p.id).forEach(function (n) {
        var d = new Date(n.updated || n.created || 0);
        if (!isNaN(d)) keys[d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()] = 1;
      });
    });
    return keys;
  }

  function augment(p) {
    if (!p) return;
    var wrap = gid('ptTimeline'); if (!wrap) return;
    safe(function () { wrap.querySelectorAll('.mls-tl-hist').forEach(function (el) { el.parentNode && el.parentNode.removeChild(el); }); });
    var visits = collectVisits(p);
    if (!visits.length) return;
    var have = existingDayKeys(p);
    var missing = visits.filter(function (v) { return !(v.dayKey && have[v.dayKey]); });
    if (!missing.length) return;
    missing.sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
    var empty = gid('ptTimelineEmpty'); if (empty) empty.style.display = 'none';
    var htmlRows = missing.map(function (v) {
      var dateStr = v.dated ? new Date(v.ms).toLocaleDateString() : '';
      var sub = (dateStr ? dateStr + ' · ' : '') + 'From patient summary (read-only)';
      return '<div class="doc-item mls-tl-hist" data-mlstl="1" title="Referenced in the patient summary">'
        + '<span class="ic">&#128197;</span>'
        + '<div class="dm"><div class="t">' + esc(v.label) + '</div><div class="s">' + esc(sub) + '</div></div>'
        + '</div>';
    }).join('');
    safe(function () { wrap.insertAdjacentHTML('beforeend', htmlRows); });
    safe(function () {
      wrap.querySelectorAll('.mls-tl-hist').forEach(function (el) {
        if (el.__mlstlBound) return; el.__mlstlBound = 1;
        el.addEventListener('click', function () {
          var sumEl = gid('profSummary');
          if (sumEl && sumEl.scrollIntoView) sumEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
    });
  }

  function installWrap() {
    if (typeof window.renderPtTimeline !== 'function') return false;
    if (window.renderPtTimeline.__mlsTlWrapped) return true;
    _orig = window.renderPtTimeline;
    var wrapped = function (p) {
      var r = _orig.apply(this, arguments);
      safe(function () { augment(p); });
      return r;
    };
    wrapped.__mlsTlWrapped = true;
    wrapped.__mlsTlOrig = _orig;
    window.renderPtTimeline = wrapped;
    return true;
  }

  function boot() {
    if (installWrap()) return;
    var n = 0, t = setInterval(function () { n++; if (installWrap() || n >= 40) clearInterval(t); }, 300);
  }

  function revert() {
    safe(function () {
      if (window.renderPtTimeline && window.renderPtTimeline.__mlsTlWrapped && _orig) window.renderPtTimeline = _orig;
    });
    safe(function () { var w = gid('ptTimeline'); if (w) w.querySelectorAll('.mls-tl-hist').forEach(function (el) { el.remove(); }); });
    safe(function () { window.__mlsTl.installed = false; });
  }

  window.__mlsTl = {
    installed: true,
    version: VERSION,
    collectVisits: collectVisits,
    parseDate: parseDate,
    augment: augment,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

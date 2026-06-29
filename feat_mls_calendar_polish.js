/* ============================================================================
 * feat_mls_calendar_polish.js  ->  window.__mlsCalPolish   (cp-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 67: make the Complex-view Calendar genuinely cleaner and easier to use
 * (Month / Week / Day), building on items 63/64/66 (calendar sync, full-width
 * wrapper, 18-provider roster, grid-fill) WITHOUT regressing any of them.
 *
 * WHAT THIS IMPROVES (all additive, all reversible, no data ever touched):
 *   1. CLEAR DAY NAVIGATION. The period you're viewing (#calMonthLabel) is
 *      promoted to a prominent, full-width header line that's always visible in
 *      every mode, and the prev/next arrows get HONEST, mode-aware tooltips
 *      ("Previous day/week/month") instead of the hard-coded "Previous month".
 *   2. A CONNECTED, CLICKABLE PROVIDERS ROSTER. The real provider list
 *      (window._calProviders, the 18-provider roster) is rendered as a clean row
 *      of clickable chips directly above the grid. Clicking one filters the grid
 *      to that provider by driving the EXISTING #calProvFilter pipeline (no new
 *      filter logic, so Month/Week/Day stay consistent). "All providers" clears.
 *      The native dropdown is hidden (kept in the DOM so its value still drives
 *      filtering) -- one obvious control instead of two.
 *   3. HONEST EMPTY STATES. Instead of a confusing blank grid:
 *        - filtered to a provider who has NO tagged appointments anywhere ->
 *          "No appointments are tagged to <name> yet -- per-provider tags fill
 *           in after the next schedule pull."  (truthful: tagging needs a re-pull)
 *        - a month/week with zero appts -> "No appointments for <period>."
 *      (Day view already ships a good inline empty-state; we leave it alone and
 *       only add the provider-tag notice there.)
 *   4. READABILITY POLISH. Slightly larger, non-clipping Week blocks; cleaner
 *      control-row spacing and a nicer segmented Month/Week/Day toggle. CSS only,
 *      scoped to #calendarView -- never touches grid width or cell sizing, so the
 *      full-width wrapper and grid-fill from earlier items are preserved.
 *
 * MECHANISM: wrap window.renderCalendar so the ORIGINAL renders first (untouched
 * output), then a post-render pass injects the roster, fixes tooltips, and adds
 * empty-states. Idempotent, ASCII-only, reversible: window.__mlsCalPolish.revert()
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCalPolish && window.__mlsCalPolish.installed) return; } catch (e) { return; }

  var VERSION = 'cp-1.0.0';
  var STYLE_ID = 'mlsCalPolishStyle';
  var ROSTER_ID = 'mlsCalRoster';
  var EMPTY_ID = 'mlsCalEmpty';
  var _origRender = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return document.getElementById(id); }
  function escq(s) {
    // local escaper (the app's esc may not be in scope at all call sites)
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function pad2(n) { n = Number(n); return (n < 10 ? '0' : '') + n; }

  /* ---------------------------------------------------------------- CSS ---- */
  function injectCSS() {
    if ($(STYLE_ID)) return;
    var css = [
      /* prominent, always-visible "what am I viewing" period header */
      '#calMonthLabel{font-size:20px!important;font-weight:800!important;line-height:1.2!important;'
        + 'flex:1 1 100%!important;order:99!important;margin:6px 2px 2px!important;color:var(--ink,#16324f)!important}',
      /* control row breathes a little */
      '#calendarView .mlsCalControls{gap:8px 8px!important;align-items:center!important;'
        + 'padding-bottom:4px!important;border-bottom:1px solid var(--line,#e6edf5)!important;margin-bottom:12px!important}',
      /* segmented Month/Week/Day toggle: cleaner edges + hover */
      '#calMode_month,#calMode_week,#calMode_day{transition:background .12s ease,color .12s ease;font-weight:700!important}',
      '#calMode_month:hover,#calMode_week:hover,#calMode_day:hover{background:#eef4fc!important}',
      /* providers roster strip */
      '#' + ROSTER_ID + '{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:2px 0 12px}',
      '#' + ROSTER_ID + ' .mlsRosLabel{font-size:11.5px;font-weight:700;letter-spacing:.04em;'
        + 'text-transform:uppercase;color:var(--muted,#6b7c92);margin-right:2px}',
      '#' + ROSTER_ID + ' .mlsRosChip{font-size:12.5px;line-height:1;cursor:pointer;border-radius:999px;'
        + 'padding:6px 12px;border:1px solid var(--line,#d7e2ef);background:var(--card,#fff);'
        + 'color:var(--ink,#16324f);transition:all .12s ease;white-space:nowrap}',
      '#' + ROSTER_ID + ' .mlsRosChip:hover{border-color:#9cc2ee;background:#f3f8ff}',
      '#' + ROSTER_ID + ' .mlsRosChip.mlsRosOn{background:#1f7ae0;border-color:#1f7ae0;color:#fff;font-weight:700;'
        + 'box-shadow:0 2px 7px rgba(31,122,224,.30)}',
      '#' + ROSTER_ID + ' .mlsRosChip .mlsRosDot{display:inline-block;width:7px;height:7px;border-radius:50%;'
        + 'background:#2bb673;margin-right:6px;vertical-align:middle}',
      /* honest empty-state banner */
      '#' + EMPTY_ID + '{margin:0 0 12px;background:#f7faff;border:1px solid #dbe7f7;border-radius:12px;'
        + 'padding:16px 18px;color:var(--ink,#2a3b50);font-size:13.5px;line-height:1.5}',
      '#' + EMPTY_ID + ' b{color:#1456a8}',
      '#' + EMPTY_ID + ' .mlsEmptyHint{display:block;margin-top:4px;font-size:12px;color:var(--muted,#6b7c92)}',
      /* readability: slightly larger, non-clipping Week/Day blocks (calbox keeps the colour uniform) */
      '#calGrid [data-appt]{font-size:11px!important;line-height:1.3!important}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = STYLE_ID; st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  /* --------------------------------------------------- nav + control row ---- */
  function tagControlRow() {
    var prev = findBtn('calPrev');
    if (prev && prev.parentNode && prev.parentNode.className.indexOf('mlsCalControls') < 0) {
      prev.parentNode.className += ' mlsCalControls';
    }
  }
  function findBtn(fnName) {
    var bs = document.querySelectorAll('#calendarView button');
    for (var i = 0; i < bs.length; i++) {
      var oc = bs[i].getAttribute('onclick') || '';
      if (oc.indexOf(fnName + '(') >= 0) return bs[i];
    }
    return null;
  }
  function modeWord() {
    var m = safe(function () { return window._calMode; }, 'month') || 'month';
    return m === 'day' ? 'day' : (m === 'week' ? 'week' : 'month');
  }
  function fixNavTooltips() {
    var w = modeWord();
    var prev = findBtn('calPrev'); if (prev) prev.title = 'Previous ' + w;
    var next = findBtn('calNext'); if (next) next.title = 'Next ' + w;
    var today = findBtn('calToday'); if (today) today.title = 'Jump to today';
  }

  /* ------------------------------------------------------------- roster ---- */
  function providers() {
    var p = safe(function () { return window._calProviders; }, null);
    return (p && p.length) ? p : [];
  }
  function filterEl() { return $('calProvFilter'); }

  function setFilter(val) {
    var pf = filterEl(); if (!pf) return;
    // make sure the option exists (render only populates when empty); add if missing
    if (val && !optionExists(pf, val)) {
      var o = document.createElement('option'); o.value = val;
      var nm = nameOf(val); o.textContent = nm || ('Provider ' + val); pf.appendChild(o);
    }
    pf.value = val;
    safe(function () { if (typeof window.renderCalendar === 'function') window.renderCalendar(); });
  }
  function optionExists(pf, val) {
    for (var i = 0; i < pf.options.length; i++) if (String(pf.options[i].value) === String(val)) return true;
    return false;
  }
  function nameOf(id) {
    var p = providers().filter(function (x) { return String(x.id) === String(id); })[0];
    return p ? (p.name || ('Provider ' + id)) : '';
  }

  function ensureRoster() {
    var wrap = $('calSplitWrap'); if (!wrap || !wrap.parentNode) return;
    var prov = providers();
    var ros = $(ROSTER_ID);
    if (!prov.length) { if (ros && ros.parentNode) ros.parentNode.removeChild(ros); return; }
    if (!ros) {
      ros = document.createElement('div'); ros.id = ROSTER_ID;
      wrap.parentNode.insertBefore(ros, wrap);
    }
    // hide the now-redundant native dropdown (kept in DOM so its value still filters)
    var pf = filterEl(); if (pf) pf.style.display = 'none';

    var cur = pf ? String(pf.value || '') : '';
    var html = '<span class="mlsRosLabel">Providers</span>';
    html += '<span class="mlsRosChip' + (cur === '' ? ' mlsRosOn' : '') + '" data-prov="" title="Show every provider">All providers</span>';
    prov.forEach(function (p) {
      var on = cur !== '' && String(p.id) === cur;
      var dot = p.checked_in ? '<span class="mlsRosDot" title="In the office today"></span>' : '';
      html += '<span class="mlsRosChip' + (on ? ' mlsRosOn' : '') + '" data-prov="' + escq(p.id)
        + '" title="Show only ' + escq(p.name || ('Provider ' + p.id)) + '">' + dot + escq(p.name || ('Provider ' + p.id)) + '</span>';
    });
    ros.innerHTML = html;
    // wire clicks (delegate)
    if (!ros.__wired) {
      ros.addEventListener('click', function (e) {
        var chip = e.target.closest ? e.target.closest('.mlsRosChip') : null;
        if (!chip) return;
        setFilter(chip.getAttribute('data-prov') || '');
      });
      ros.__wired = true;
    }
  }

  /* -------------------------------------------------------- empty states ---- */
  function dateOf(a) {
    return safe(function () { return window._calDateOf(a); },
      (a && (a.appt_date || String(a.start_at || '').slice(0, 10))) || '');
  }
  function periodMatch(a) {
    var m = modeWord();
    var k = dateOf(a); if (!k) return false;
    if (m === 'month') {
      var y = safe(function () { return window._calYear; }, null);
      var mo = safe(function () { return window._calMonth; }, null);
      if (y == null || mo == null) return true;
      return k.slice(0, 7) === (y + '-' + pad2(mo + 1));
    }
    var ref = safe(function () { return window._calRefDate; }, '') || '';
    if (m === 'day') return k === ref;
    // week: ref's week (Sun..Sat)
    var d = new Date(ref + 'T12:00'); if (isNaN(d)) return true;
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    var kd = new Date(k + 'T12:00');
    return kd >= start && kd <= end;
  }
  function periodLabel() {
    var lbl = $('calMonthLabel');
    var t = lbl ? (lbl.textContent || '').trim() : '';
    return t || 'this period';
  }
  function ensureEmptyState() {
    var wrap = $('calSplitWrap'); if (!wrap || !wrap.parentNode) return;
    var old = $(EMPTY_ID); if (old && old.parentNode) old.parentNode.removeChild(old);

    var appts = safe(function () { return window._calAppts; }, null) || [];
    var pf = filterEl(); var pfVal = pf ? String(pf.value || '') : '';
    var matchFilter = function (a) { return !pfVal || String(a.doctor_user_id || '') === pfVal; };

    var inPeriod = appts.filter(function (a) { return matchFilter(a) && periodMatch(a); }).length;
    if (inPeriod > 0) return; // there are appts to show; no banner

    var providerTotal = pfVal ? appts.filter(function (a) { return String(a.doctor_user_id || '') === pfVal; }).length : 1;
    var m = modeWord();
    var msg = null;
    if (pfVal && providerTotal === 0) {
      var nm = nameOf(pfVal) || 'this provider';
      msg = 'No appointments are tagged to <b>' + escq(nm) + '</b> yet.'
        + '<span class="mlsEmptyHint">Per-provider tags fill in after the next schedule pull from athenaOne. '
        + 'Until then, choose <b>All providers</b> to see the full practice schedule.</span>';
    } else if (m !== 'day') {
      msg = 'No appointments for <b>' + escq(periodLabel()) + '</b>.'
        + '<span class="mlsEmptyHint">Use the arrows to move between '
        + (m === 'week' ? 'weeks' : 'months') + ', or click a day to book one.</span>';
    }
    // (day view: keep its own friendly inline empty-state unless it's the provider-tag case above)
    if (!msg) return;
    var box = document.createElement('div'); box.id = EMPTY_ID; box.innerHTML = msg;
    wrap.parentNode.insertBefore(box, wrap);
  }

  /* --------------------------------------------------------- post-render ---- */
  function enhance() {
    if (!$('calendarView')) return;
    safe(tagControlRow);
    safe(fixNavTooltips);
    safe(ensureRoster);
    safe(ensureEmptyState);
  }

  function wrapRender() {
    if (typeof window.renderCalendar !== 'function') return false;
    if (window.renderCalendar.__mlsCpWrapped) return true;
    _origRender = window.renderCalendar;
    var wrapped = function () {
      var r = _origRender.apply(this, arguments);
      safe(enhance);
      return r;
    };
    wrapped.__mlsCpWrapped = true;
    wrapped.__mlsCpOrig = _origRender;
    window.renderCalendar = wrapped;
    return true;
  }

  function boot() {
    injectCSS();
    if (wrapRender()) { safe(enhance); return; }
    var n = 0, t = setInterval(function () {
      n++;
      if (wrapRender()) { clearInterval(t); safe(enhance); }
      else if (n >= 60) clearInterval(t);
    }, 300);
  }

  function revert() {
    safe(function () {
      if (window.renderCalendar && window.renderCalendar.__mlsCpWrapped && _origRender) {
        window.renderCalendar = _origRender;
      }
    });
    safe(function () { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { var r = $(ROSTER_ID); if (r && r.parentNode) r.parentNode.removeChild(r); });
    safe(function () { var e = $(EMPTY_ID); if (e && e.parentNode) e.parentNode.removeChild(e); });
    safe(function () { var pf = filterEl(); if (pf) pf.style.display = ''; }); // restore native dropdown
    safe(function () { if (typeof window.renderCalendar === 'function') window.renderCalendar(); });
    safe(function () { window.__mlsCalPolish.installed = false; });
  }

  window.__mlsCalPolish = {
    installed: true,
    version: VERSION,
    enhance: enhance,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

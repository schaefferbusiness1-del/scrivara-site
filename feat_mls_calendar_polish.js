/* ============================================================================
 * feat_mls_calendar_polish.js  ->  window.__mlsCalPolish   (cp-1.2.0)
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
 *      (window._calProviders -- a mix of {id,name} objects and raw athenaOne
 *      name strings) is normalised, humanised ("Benner_John_MD" -> "John Benner,
 *      MD", mirroring item37) and rendered as a clean row of clickable chips above
 *      the grid. Clicking one filters via the EXISTING #calProvFilter pipeline so
 *      Month/Week/Day stay consistent. "All providers" clears. The native dropdown
 *      is hidden (kept in the DOM so its value still drives filtering).
 *   3. HONEST EMPTY STATES. Instead of a confusing blank grid:
 *        - a provider with NO tagged appointments (every id-less roster name, plus
 *          any tagged provider with none this period) ->
 *          "No appointments are tagged to <name> yet -- per-provider tags fill in
 *           after the next schedule pull."   (truthful: tagging needs a re-pull)
 *        - a month/week with zero appts -> "No appointments for <period>."
 *      (Day view keeps its own friendly inline empty-state; we only add the
 *       provider-tag notice there.)
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

  var VERSION = 'cp-1.3.2';
  var STYLE_ID = 'mlsCalPolishStyle';
  var ROSTER_ID = 'mlsCalRoster';
  var EMPTY_ID = 'mlsCalEmpty';
  var PULL_ID = 'mlsCalProviderPull';
  var PULL_STATUS_ID = 'mlsCalProviderPullStatus';
  var PULL_BAR_ID = 'mlsCalProviderPullBar';
  var HISTORY_ID = 'mlsCalProviderPullHistory';
  var HISTORY_CHECK_ID = 'mlsCalProviderPullHistoryCheck';
  var HISTORY_PREF = 'providerDayIncludeHistoryV1';
  var _pullRunning = false;
  var _origRender = null;
  var _rosterListener = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return document.getElementById(id); }
  function escq(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function pad2(n) { n = Number(n); return (n < 10 ? '0' : '') + n; }

  /* ---------------------------------------------------------------- CSS ---- */
  function injectCSS() {
    if ($(STYLE_ID)) return;
    var css = [
      '#calMonthLabel{font-size:20px!important;font-weight:800!important;line-height:1.2!important;'
        + 'flex:1 1 100%!important;order:99!important;margin:6px 2px 2px!important;color:var(--ink,#1E2B24)!important}',
      '#calendarView .mlsCalControls{gap:8px 8px!important;align-items:center!important;'
        + 'padding-bottom:4px!important;border-bottom:1px solid var(--line,#e6edf5)!important;margin-bottom:12px!important}',
      '#calMode_month,#calMode_week,#calMode_day{transition:background .12s ease,color .12s ease;font-weight:700!important}',
      '#calMode_month:hover,#calMode_week:hover,#calMode_day:hover{background:#eef4fc!important}',
      '#' + ROSTER_ID + '{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:2px 0 12px}',
      '#' + ROSTER_ID + ' .mlsRosLabel{font-size:11.5px;font-weight:700;letter-spacing:.04em;'
        + 'text-transform:uppercase;color:var(--muted,#6b7c92);margin-right:2px}',
      '#' + ROSTER_ID + ' .mlsRosChip{font-size:12.5px;line-height:1;cursor:pointer;border-radius:999px;'
        + 'padding:6px 12px;border:1px solid var(--line,#d7e2ef);background:var(--card,#fff);'
        + 'color:var(--ink,#1E2B24);transition:all .12s ease;white-space:nowrap}',
      '#' + ROSTER_ID + ' .mlsRosChip:hover{border-color:#C9DCD2;background:#f3f8ff}',
      '#' + ROSTER_ID + ' .mlsRosChip.mlsRosOn{background:#2E6A4B;border-color:#2E6A4B;color:#fff;font-weight:700;'
        + 'box-shadow:0 2px 7px rgba(31,122,224,.30)}',
      '#' + ROSTER_ID + ' .mlsRosChip .mlsRosDot{display:inline-block;width:7px;height:7px;border-radius:50%;'
        + 'background:#2bb673;margin-right:6px;vertical-align:middle}',
      '#' + HISTORY_ID + '{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #d7e2ef;'
        + 'border-radius:8px;background:#fff;color:#344b40;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap}',
      '#' + HISTORY_CHECK_ID + '{margin:0;accent-color:#2E6A4B}',
      '#' + PULL_ID + '{margin-left:0;border:0;border-radius:9px;padding:7px 12px;background:#204034;color:#fff;'
        + 'font-size:12.5px;font-weight:800;cursor:pointer;box-shadow:0 2px 7px rgba(32,64,52,.18)}',
      '#' + PULL_ID + ':disabled{cursor:not-allowed;background:#dce5e0;color:#62726a;box-shadow:none}',
      '#' + PULL_STATUS_ID + '{flex:1 1 100%;font-size:12px;line-height:1.35;color:var(--muted,#5f7168);min-height:16px}',
      '#' + PULL_BAR_ID + '{flex:1 1 100%;display:none;height:18px;border-radius:9px;background:#E8EFEA;border:1px solid #CFE0D6;overflow:hidden}',
      '#' + PULL_BAR_ID + ' i{display:block;height:100%;width:0;min-width:24px;background:#2E6A4B;color:#fff;font:700 11px/18px system-ui,sans-serif;font-style:normal;text-align:center;border-radius:8px;transition:width .5s ease;white-space:nowrap;padding:0 6px}',
      '#' + PULL_STATUS_ID + '[data-kind="err"]{color:#8b2525}',
      '#' + PULL_STATUS_ID + '[data-kind="ok"]{color:#23603f;font-weight:700}',
      '#' + EMPTY_ID + '{margin:0 0 12px;background:#f7faff;border:1px solid #dbe7f7;border-radius:12px;'
        + 'padding:16px 18px;color:var(--ink,#2a3b50);font-size:13.5px;line-height:1.5}',
      '#' + EMPTY_ID + ' b{color:#204034}',
      '#' + EMPTY_ID + ' .mlsEmptyHint{display:block;margin-top:4px;font-size:12px;color:var(--muted,#6b7c92)}',
      '#calGrid [data-appt]{font-size:11px!important;line-height:1.3!important}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = STYLE_ID; st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  /* --------------------------------------------------- nav + control row ---- */
  function findBtn(fnName) {
    var bs = document.querySelectorAll('#calendarView button');
    for (var i = 0; i < bs.length; i++) {
      var oc = bs[i].getAttribute('onclick') || '';
      if (oc.indexOf(fnName + '(') >= 0) return bs[i];
    }
    return null;
  }
  function tagControlRow() {
    var prev = findBtn('calPrev');
    if (prev && prev.parentNode && prev.parentNode.className.indexOf('mlsCalControls') < 0) {
      prev.parentNode.className += ' mlsCalControls';
    }
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
  function filterEl() { return $('calProvFilter'); }

  // Raw athenaOne username ("Benner_John_MD", "Carter_Kelly_PA-C") -> clean human
  // name ("John Benner, MD"). Already-clean names pass through. Mirrors item37.
  function humanize(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s.indexOf('_') < 0) return s;
    var t = s.split('_');
    if (t.length >= 3) {
      var last = t[0], first = t[1], cred = t.slice(2).join(' ');
      return (first + ' ' + last + (cred ? ', ' + cred : '')).replace(/\s+/g, ' ').trim();
    }
    if (t.length === 2) return (t[1] + ' ' + t[0]).trim();
    return s;
  }

  // Normalise the mixed _calProviders array into {fval,name,checked_in,hasId}.
  // fval is dropped into #calProvFilter: real numeric id -> String(id) (filters by
  // doctor_user_id); id-less name -> "nm:<raw>" (matches no appt -> honest empty).
  function normProviders() {
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    var labelApi = safe(function () { return window.__mlsProviderLabel; }, null);
    var p = roster && typeof roster.list === 'function'
      ? safe(function () { return roster.list(); }, [])
      : safe(function () { return window._calProviders; }, null);
    if (!p || !p.length) return [];
    var out = [], counts = {};
    function validName(x) {
      var n = labelApi && typeof labelApi === 'function' ? safe(function () { return labelApi(x); }, '') : '';
      if (!n && roster && typeof roster._canonicalName === 'function') n = safe(function () { var trusted = !!(x && typeof x === 'object' && (x.id || x.stableKey || x.rosterVerified)); return roster._canonicalName(x && typeof x === 'object' ? (x.name || x.raw || x.provider || '') : x, trusted, trusted); }, '');
      return n || '';
    }
    p.forEach(function (x) { var n0 = validName(x); if (n0) counts[n0.toLowerCase()] = (counts[n0.toLowerCase()] || 0) + 1; });
    p.forEach(function (x) {
      if (typeof x === 'string') {
        var raw = x.trim(), cleanName = validName(x); if (!raw || !cleanName) return;
        out.push({ fval: 'nm:' + raw, name: cleanName, checked_in: false, hasId: false });
      } else if (x && typeof x === 'object') {
        var nm = validName(x); if (!nm) return;
        var stableKey = String(x.stableKey || x.stable_key || '');
        var label = nm;
        if (counts[nm.toLowerCase()] > 1) label += x.id != null && String(x.id) ? (' - ID ' + x.id) : (x.raw && x.raw !== nm ? (' - ' + x.raw) : (' - ' + stableKey));
        out.push({
          fval: (x.id != null && String(x.id) ? String(x.id) : (stableKey ? ('pv:' + encodeURIComponent(stableKey)) : 'nm:' + nm)),
          stableKey: stableKey,
          name: label,
          checked_in: !!x.checked_in,
          hasId: x.id != null && String(x.id) !== '',
          rosterVerified: x.rosterVerified === true
        });
      }
    });
    return out;
  }

  function optionExists(pf, val) {
    for (var i = 0; i < pf.options.length; i++) if (String(pf.options[i].value) === String(val)) return true;
    return false;
  }
  function nameOf(fval) {
    if (!fval) return '';
    var hit = normProviders().filter(function (x) { return x.fval === String(fval); })[0];
    if (hit) return hit.name;
    if (String(fval).indexOf('nm:') === 0) return humanize(String(fval).slice(3));
    return '';
  }
  function setFilter(val) {
    var pf = filterEl(); if (!pf) return;
    /* RS#7: exactly one provider-filter mode may be active — drop any calpro
       selection before the chip choice takes effect (belt-and-suspenders; the
       calpro checkbox UI itself no longer renders as of 2026-07-13). */
    try { if (window.__mlsCalPro && window.__mlsCalPro.installed && typeof window.__mlsCalPro.clearSelection === 'function' && window.__mlsCalPro.selProviders && window.__mlsCalPro.selProviders().length) window.__mlsCalPro.clearSelection(); } catch (e) {}
    if (val && !optionExists(pf, val)) {
      var o = document.createElement('option'); o.value = val;
      o.textContent = nameOf(val) || val; pf.appendChild(o);
    }
    pf.value = val;
    safe(function () { if (typeof window.renderCalendar === 'function') window.renderCalendar(); });
  }

  function pullStatus(msg, kind) {
    var st = $(PULL_STATUS_ID); if (!st) return;
    st.textContent = String(msg || '');
    st.setAttribute('data-kind', kind || '');
    /* 2026-07-15: the pull runs for many minutes across every patient; the
       doctor needs visible progress, not a silent button. The importer's
       status stream carries exact "X of N" counts for both phases (identity
       verification, then verified history). Paint them as a real bar. */
    safe(function () {
      var bar = $(PULL_BAR_ID), fill = bar && bar.firstElementChild;
      if (!bar || !fill) return;
      var m = String(msg || '').match(/(\d+)\s+of\s+(\d+)/);
      if (_pullRunning && m && Number(m[2]) > 0) {
        var phase = /identity/i.test(String(msg || '')) ? 'Identity' : (/history/i.test(String(msg || '')) ? 'History' : 'Working');
        var pct = Math.max(3, Math.min(100, Math.round((Number(m[1]) / Number(m[2])) * 100)));
        bar.style.display = 'block';
        bar.setAttribute('data-phase', phase);
        fill.style.width = pct + '%';
        fill.textContent = phase + ' ' + m[1] + '/' + m[2];
      } else if (!_pullRunning) {
        bar.style.display = 'none';
        fill.style.width = '0%';
        fill.textContent = '';
      } else if (_pullRunning && bar.style.display !== 'block') {
        bar.style.display = 'block';
        if (!fill.style.width || fill.style.width === '0%') { fill.style.width = '3%'; fill.textContent = 'Starting…'; }
      }
    });
  }
  function historyPrefKey() {
    return safe(function () { return typeof window.uns === 'function' ? window.uns(HISTORY_PREF) : ''; }, '') || '';
  }
  function includeHistory() {
    var k = historyPrefKey(); if (!k) return true;
    return safe(function () { var v = localStorage.getItem(k); return v == null ? true : v !== '0'; }, true);
  }
  function saveIncludeHistory(on) {
    var k = historyPrefKey(); if (!k) return;
    safe(function () { localStorage.setItem(k, on ? '1' : '0'); });
  }
  function paintProviderPull() {
    var b = $(PULL_ID); if (!b) return;
    var api = safe(function () { return window.__mlsSI; }, null);
    var sel = api && typeof api.calendarSelection === 'function' ? safe(function () { return api.calendarSelection(); }, null) : null;
    b.disabled = _pullRunning || !(sel && sel.ok);
    if (_pullRunning) b.textContent = 'Pulling selected provider day...';
    else if (sel && sel.ok) b.textContent = 'Pull ' + sel.provider.name + ' - ' + sel.date;
    else if (sel && sel.reason === 'provider-required') b.textContent = 'Choose a provider to pull';
    else b.textContent = 'Open a day to pull this provider';
    var withHistory = includeHistory();
    b.title = sel && sel.ok
      ? (withHistory ? 'Reads every appointment for this provider and day, then requires verified full history and visits for every exact patient.' : 'Reads and verifies this provider-day schedule only; patient history is not requested.')
      : ((sel && sel.error) || 'Choose one provider and open one calendar day first.');
  }
  function runProviderPull() {
    if (_pullRunning) return;
    var api = safe(function () { return window.__mlsSI; }, null);
    if (!api || typeof api.pullCalendarSelection !== 'function') { pullStatus('The verified schedule pull is still loading. Try again in a moment.', 'err'); return; }
    var sel = safe(function () { return api.calendarSelection(); }, null);
    if (!sel || !sel.ok) { pullStatus((sel && sel.error) || 'Choose one provider and open one day first.', 'err'); paintProviderPull(); return; }
    var withHistory = includeHistory();
    _pullRunning = true; paintProviderPull();
    pullStatus(withHistory ? 'Starting the verified provider-day + full-history pull...' : 'Starting the verified schedule-only provider-day pull...', '');
    Promise.resolve(api.pullCalendarSelection({ includeHistory: withHistory, onStatus: function (m, k) { pullStatus(m, k); } })).then(function (res) {
      _pullRunning = false; paintProviderPull();
      var cr = res && res.calendarReceipt || {}, hr = res && res.historyReceipt || {};
      var scheduleDone = Number(cr.accounted != null ? cr.accounted : (Number(res && res.created || 0) + Number(res && res.repaired || 0) + Number(res && res.skipped || 0)));
      var scheduleTotal = Number(cr.attempted != null ? cr.attempted : scheduleDone);
      var historyDone = Number(hr.processed || 0), historyTotal = Number(hr.requested || 0);
      var failures = Number(cr.failed || 0) + Number(hr.failures != null ? hr.failures : ((hr.retry || []).length));
      if (res && res.ok === true && res.complete === true) {
        pullStatus(withHistory
          ? ('Verified complete: schedule ' + scheduleDone + '/' + scheduleTotal + '; histories ' + historyDone + '/' + historyTotal + '; failures 0.')
          : ('Schedule-only complete: ' + scheduleDone + '/' + scheduleTotal + ' appointments accounted for; history was not requested.'), 'ok');
      } else {
        var detail = withHistory ? (' Schedule ' + scheduleDone + '/' + scheduleTotal + '; histories ' + historyDone + '/' + historyTotal + '; failures ' + failures + '.') : (' Schedule ' + scheduleDone + '/' + scheduleTotal + '; history not requested; failures ' + failures + '.');
        pullStatus(((res && res.error) || 'This provider-day pull is incomplete. Nothing was widened to other providers; it is safe to retry.') + detail, 'err');
      }
    }, function () {
      _pullRunning = false; paintProviderPull();
      pullStatus('The provider-day pull stopped before completion. It is safe to retry.', 'err');
    });
  }

  function ensureRoster() {
    var wrap = $('calSplitWrap'); if (!wrap || !wrap.parentNode) return;
    var prov = normProviders();
    var ros = $(ROSTER_ID);
    if (!prov.length) { if (ros && ros.parentNode) ros.parentNode.removeChild(ros); return; }
    if (!ros) {
      ros = document.createElement('div'); ros.id = ROSTER_ID;
      wrap.parentNode.insertBefore(ros, wrap);
    }
    var pf = filterEl(); if (pf) pf.style.display = 'none'; // hide redundant dropdown (value still filters)

    /* 2026-07-15: the visible Task-3 scope chips are the only provider control
       the user can see, and the app rebuilds this select on every calendar
       render (wiping any injected option). Re-adopt the persisted chip scope
       into the exact hidden filter here, after every render, by resolving the
       scoped clinician through the canonical roster. An ambiguous or
       unresolvable scope leaves the filter empty so the verified pull button
       honestly asks for a provider. */
    safe(function () {
      if (!pf) return;
      var rawScope = '';
      try { rawScope = typeof window.uns === "function" ? String(localStorage.getItem(window.uns('mlsProvScope3')) || '') : ''; } catch (e) {}
      var sep = rawScope.indexOf('|');
      var scopeLabel = sep >= 0 ? rawScope.slice(sep + 1) : '';
      var next = '';
      if (scopeLabel) {
        var rosterApi2 = safe(function () { return window.__mlsProviderRoster; }, null);
        var entry = rosterApi2 && typeof rosterApi2.resolve === "function" ? safe(function () { return rosterApi2.resolve(scopeLabel); }, null) : null;
        if (entry && entry.stableKey) next = (entry.id != null && String(entry.id)) ? String(entry.id) : ('pv:' + encodeURIComponent(String(entry.stableKey)));
      }
      if (next && !Array.prototype.some.call(pf.options || [], function (o) { return String(o.value) === next; })) {
        var opt = document.createElement('option'); opt.value = next; opt.textContent = scopeLabel; pf.appendChild(opt);
      }
      if (String(pf.value || '') !== next) pf.value = next;
    });

    /* 2026-07-15: every calendar re-render used to rebuild this row's
       innerHTML, wiping the live status line and progress mid-pull — the
       doctor saw a silent button for the whole run. While a pull is running
       the controls are frozen: keep the existing nodes and only refresh the
       button paint. */
    if (_pullRunning && ros.__wired && $(PULL_ID) && $(PULL_STATUS_ID)) { safe(paintProviderPull); return; }

    var cur = pf ? String(pf.value || '') : '';
    var html = '<span class="mlsRosLabel">Providers</span>';
    var rosterApi = safe(function () { return window.__mlsProviderRoster; }, null);
    var rosterReceipt = rosterApi && typeof rosterApi.getReceipt === 'function' ? safe(function () { return rosterApi.getReceipt(); }, null) : null;
    if (!(rosterReceipt && rosterReceipt.complete)) html += '<span title="Finish a full Athena Day-schedule sweep before a selected-provider pull" style="font-size:11px;color:#8A5A22;margin-right:6px">Roster still verifying</span>';
    html += '<span class="mlsRosChip' + (cur === '' ? ' mlsRosOn' : '') + '" data-prov="" title="Show every provider">All providers</span>';
    prov.forEach(function (p) {
      var on = cur !== '' && p.fval === cur;
      var dot = p.checked_in ? '<span class="mlsRosDot" title="In the office today"></span>' : '';
      html += '<span class="mlsRosChip' + (on ? ' mlsRosOn' : '') + '" data-prov="' + escq(p.fval)
        + '" title="Show only ' + escq(p.name) + '">' + dot + escq(p.name) + '</span>';
    });
    html += '<label id="' + HISTORY_ID + '" title="When enabled, this pull is complete only after every exact patient has verified organized history and old visits.">'
      + '<input type="checkbox" id="' + HISTORY_CHECK_ID + '"' + (includeHistory() ? ' checked' : '') + '> Also pull &amp; verify full history/visits</label>';
    html += '<button type="button" id="' + PULL_ID + '">Choose a provider to pull</button>';
    html += '<span id="' + PULL_STATUS_ID + '" aria-live="polite"></span>';
    html += '<div id="' + PULL_BAR_ID + '" role="progressbar"><i></i></div>';
    ros.innerHTML = html;
    if (!ros.__wired) {
      ros.addEventListener('click', function (e) {
        var pull = e.target.closest ? e.target.closest('#' + PULL_ID) : null;
        if (pull) { e.preventDefault(); runProviderPull(); return; }
        var chip = e.target.closest ? e.target.closest('.mlsRosChip') : null;
        if (!chip) return;
        setFilter(chip.getAttribute('data-prov') || '');
      });
      ros.addEventListener('change', function (e) {
        if (!e.target || e.target.id !== HISTORY_CHECK_ID) return;
        saveIncludeHistory(!!e.target.checked);
        paintProviderPull();
        pullStatus(e.target.checked ? 'Full verified history and visits will be included.' : 'Schedule-only mode: history and visits will not be requested.', '');
      });
      ros.__wired = true;
    }
    paintProviderPull();
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
    if (inPeriod > 0) return;

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
    safe(paintProviderPull);
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
    if (!_rosterListener) {
      _rosterListener = function () { safe(enhance); };
      safe(function () { window.addEventListener('mls-provider-roster-updated', _rosterListener); });
    }
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
    safe(function () { var pf = filterEl(); if (pf) pf.style.display = ''; });
    safe(function () { if (_rosterListener) window.removeEventListener('mls-provider-roster-updated', _rosterListener); _rosterListener = null; });
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

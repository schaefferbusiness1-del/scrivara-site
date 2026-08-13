/* ============================================================================
 * 1p-feat_task3_frontsync.js -> window.__mlsT3 (p1 exact census display fork)
 * ----------------------------------------------------------------------------
 * FRONTEND CALENDAR / PATIENT SELECTOR / MLS EASY / PROVIDER FLOW FIX.
 * One canonical appointment store + one provider scope + one status system so
 * the month grid, day/week grids, day panel, Who's Next, patient selector and
 * MLS Easy all agree with the backend and with each other.
 *
 * ROOT CAUSES FIXED (verified in code):
 *  1) feat_athena_provider_picker wrapped renderCalendar and swapped _calAppts
 *     for a providerTag+DOB subset (usually empty) -> Day/Week/Month grids
 *     rendered NOTHING while glance/headers counted everything. Neutralized
 *     via its own revert() + setPick('all') (both reversible).
 *  2) Provider roster pills set #calProvFilter to doctor_user_id (null on all
 *     rows) or an "nm:" sentinel that matches nothing -> any specific provider
 *     always showed an empty calendar. Replaced by a real provider scope that
 *     matches the appointment's own provider string canonically
 *     ("Edwards_Lindsay_PA-CClose" == "Lindsay Edwards, PA-C").
 *  3) appt_date could be a full ISO timestamp (DB serialization) and start_at
 *     was sliced as UTC -> wrong-day cards. Normalized in place, account TZ.
 *  4) No row-level dedupe across repeated pulls -> duplicate patient cards.
 *  5) Five competing "who's next"/quick-pick renderers -> duplication + stale
 *     boxes. The native NEXT-UP chip grid is now THE patient selector; the
 *     "All appointments this day" list (__mlsQpAll) and the extra WN boxes are
 *     retired (hidden/reverted, reversible).
 *  6) Selected patient was runtime-only -> stale/blank after refresh.
 *     Persisted per user; restored only when still valid for today.
 *  7) No shared loading truth -> conflicting spinners. window.MLSStatus is the
 *     single status bus with the 8 canonical stages.
 * SAFETY: read-only toward Athena. Never creates/updates/signs/submits any
 * order or chart. Touches only display state + existing app selection flow.
 * Reversible: window.__mlsT3.revert().
 * ========================================================================== */
;(function () {
  'use strict';
  var previousMLSCal = window.MLSCal || null;
  if (window.__mlsT3 && window.__mlsT3.installed) {
    if (window.__mlsT3.version === 't3-p1-1.2.0') return;
    try { if (typeof window.__mlsT3.revert === 'function') window.__mlsT3.revert(); } catch (eOldT3) {}
  }

  var VERSION = 't3-p1-1.2.0';
  var wrapped = [], trackedTimeouts = [], destroyed = false, started = false, runtimeGeneration = 0;
  var nodes = ['mlsT3Status', 'mlsT3Roster', 'mlsT3Empty', 'mlsT3PickEmpty', 'mlsT3PickHead', 'mlsT3Css', 'mlsT3GlanceNote'];

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function viewShown(id) {
    var el = $(id); if (!el) return false;
    var app = $('appScreen');
    if (app && (app.hidden || app.getAttribute('aria-hidden') === 'true' || (app.style && app.style.display === 'none'))) return false;
    /* showView owns these static roots through inline display state. Reading it
       avoids offsetParent/getClientRects, which forced layout during every
       calendar/status reconciliation. */
    return !el.hidden && el.getAttribute('aria-hidden') !== 'true' && (!el.style || el.style.display !== 'none');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isFn(f) { return typeof f === 'function'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function lsGet(name) { return safe(function () { return isFn(window.uns) ? String(localStorage.getItem(window.uns(name)) || '') : ''; }, ''); }
  function lsSet(name, v) { safe(function () { if (isFn(window.uns)) localStorage.setItem(window.uns(name), String(v == null ? '' : v)); }); }
  function lsDel(name) { safe(function () { if (isFn(window.uns)) localStorage.removeItem(window.uns(name)); }); }
  function acctTz() { return safe(function () { var t = isFn(window._acctTz) ? window._acctTz() : localStorage.getItem(window.uns ? window.uns('acctTz') : '') || ''; return (t && String(t).trim()) || 'America/New_York'; }, 'America/New_York'); }
  /* Calendar normalization touches every appointment on renders, click repair,
     and the foreground pulse. Intl.DateTimeFormat construction is hundreds of
     times slower than format()/formatToParts(), so cache the two immutable
     formatters per account timezone instead of constructing one per row. */
  var _t3TzFormatters = {};
  function tzFormatter(kind, resolvedTz) {
    var tz = resolvedTz || acctTz(), key = kind + '|' + tz, fmt = _t3TzFormatters[key];
    if (fmt) return fmt;
    fmt = kind === 'date'
      ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      : new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
    _t3TzFormatters[key] = fmt;
    return fmt;
  }
  function tzDateKey(d, formatter) { try { return (formatter || tzFormatter('date')).format(d); } catch (e) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); } }
  function tzHHMM(iso, formatter) { try { var d = new Date(iso); if (isNaN(d.getTime())) return ''; var ps = (formatter || tzFormatter('time')).formatToParts(d); var hh = 0, mm = 0; ps.forEach(function (p) { if (p.type === 'hour') hh = parseInt(p.value, 10); if (p.type === 'minute') mm = parseInt(p.value, 10); }); if (hh === 24) hh = 0; return pad(hh) + ':' + pad(mm); } catch (e) { return ''; } }
  function todayKey() { return tzDateKey(new Date()); }
  function ampm(t) { var m = /^(\d\d?):(\d\d)/.exec(String(t || '')); if (!m) return String(t || ''); var h = +m[1], ap = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12; return h + ':' + m[2] + ' ' + ap; }
  function pretty(key) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || ''); if (!m) return key || ''; var d = new Date(+m[1], +m[2] - 1, +m[3]); return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }

  /* ==================== 1. SHARED STATUS SYSTEM (window.MLSStatus) =========
   * The single loading/error/success truth for appointment data. Adopts an
   * existing MLSStatus (from Task 1/2 backend work) if one is already present;
   * otherwise installs the reference implementation. Stages are canonical. */
  var STAGES = [
    { k: 1, label: 'Reading backend calendar data' },
    { k: 2, label: 'Reading appointments for selected date' },
    { k: 3, label: 'Reading provider schedule' },
    { k: 4, label: 'Updating calendar' },
    { k: 5, label: "Updating Who's Next" },
    { k: 6, label: 'Updating patient selector' },
    { k: 7, label: 'Updating MLS Easy' },
    { k: 8, label: 'Finished updating appointments' }
  ];
  function makeStatus() {
    var st = { stages: {}, listeners: [], lastErr: null, activity: 0, settled: true };
    STAGES.forEach(function (s) { st.stages[s.k] = { label: s.label, state: 'idle', detail: '', ts: 0 }; });
    st.set = function (k, state, detail) {
      var g = st.stages[k]; if (!g) return;
      g.state = state; g.detail = detail || ''; g.ts = Date.now();
      if (state === 'run') { st.settled = false; st.activity = Date.now(); }
      if (state === 'err') { st.lastErr = { k: k, label: g.label, detail: g.detail, ts: g.ts }; }
      st.listeners.forEach(function (f) { safe(function () { f(k, g); }); });
    };
    st.on = function (f) { st.listeners.push(f); };
    st.running = function () { for (var k in st.stages) { if (+k !== 8 && st.stages[k].state === 'run') return true; } return false; };
    return st;
  }
  var S = (window.MLSStatus && isFn(window.MLSStatus.set)) ? window.MLSStatus : makeStatus();
  window.MLSStatus = S;

  /* --- the one visible status strip (no conflicting per-tab spinners) --- */
  function stripHost() {
    var cal = $('calendarView');
    if (cal && viewShown('calendarView')) return { host: cal, mode: 'cal' };
    var hero = $('heroToday');
    if (hero && hero.parentElement && viewShown('visitView')) return { host: hero.parentElement, before: hero, mode: 'visit' };
    return null;
  }
  var stripState = { txt: '', kind: '' };
  function renderStrip() {
    var loc = stripHost();
    var el = $('mlsT3Status');
    if (!loc) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'mlsT3Status';
      el.innerHTML = '<span class="t3s-spin"></span><span class="t3s-txt"></span><button type="button" class="t3s-retry" style="display:none">Retry</button><span class="t3s-x" title="Hide">&times;</span>';
      el.querySelector('.t3s-x').onclick = function () { el.style.display = 'none'; el.setAttribute('data-t3hide', String(Date.now())); };
      el.querySelector('.t3s-retry').onclick = function () { el.querySelector('.t3s-retry').style.display = 'none'; safe(function () { if (isFn(window.loadCalendar)) window.loadCalendar(); }); };
    }
    if (loc.before) { if (el.parentElement !== loc.host || el.nextSibling !== loc.before) loc.host.insertBefore(el, loc.before); }
    else if (el.parentElement !== loc.host || loc.host.firstChild !== el) { loc.host.insertBefore(el, loc.host.firstChild); }
    var running = [], err = null;
    for (var k = 1; k <= 7; k++) { var g = S.stages[k]; if (!g) continue; if (g.state === 'run') running.push(g.label); if (g.state === 'err' && (!err || g.ts > err.ts)) err = g; }
    var hideTs = +(el.getAttribute('data-t3hide') || 0);
    if (err && Date.now() - err.ts < 30000) {
      var msg = err.label + ' failed' + (err.detail ? ' - ' + err.detail : '') + '.';
      if (stripState.txt !== msg || stripState.kind !== 'err') { stripState = { txt: msg, kind: 'err' }; el.className = 't3s-err'; el.querySelector('.t3s-txt').textContent = msg; el.querySelector('.t3s-spin').style.display = 'none'; el.querySelector('.t3s-retry').style.display = ''; }
      el.style.display = 'flex'; return;
    }
    if (running.length) {
      var t = running[0] + (running.length > 1 ? ' (+' + (running.length - 1) + ' more)' : '') + '...';
      if (stripState.txt !== t || stripState.kind !== 'run') { stripState = { txt: t, kind: 'run' }; el.className = 't3s-run'; el.querySelector('.t3s-txt').textContent = t; el.querySelector('.t3s-spin').style.display = ''; el.querySelector('.t3s-retry').style.display = 'none'; }
      el.style.display = 'flex'; el.removeAttribute('data-t3hide'); return;
    }
    var g8 = S.stages[8];
    if (g8 && g8.state === 'ok' && Date.now() - g8.ts < 2600 && Date.now() - hideTs > 5000) {
      if (stripState.kind !== 'done') { stripState = { txt: g8.label, kind: 'done' }; el.className = 't3s-done'; el.querySelector('.t3s-txt').textContent = '\u2713 ' + g8.label; el.querySelector('.t3s-spin').style.display = 'none'; el.querySelector('.t3s-retry').style.display = 'none'; }
      el.style.display = 'flex'; return;
    }
    el.style.display = 'none'; stripState = { txt: '', kind: '' };
  }
  /* Settle stage 8 from status transitions instead of a permanent 400ms poll. */
  var hadActivity = false, settleTimer = null, stripHideTimer = null;
  var originalStatusSet = S.set;
  function afterStatusChange() {
    if (destroyed || !started) return;
    safe(renderStrip);
    try { if (stripHideTimer) clearTimeout(stripHideTimer); stripHideTimer = setTimeout(function () { stripHideTimer = null; safe(renderStrip); }, 3200); } catch (e) {}
    safe(function () { if (typeof scheduleTick === 'function') scheduleTick(30); });
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (S.running()) { hadActivity = true; return; }
    if (!hadActivity) return;
    var wait = Math.max(0, 1150 - (Date.now() - Number(S.activity || 0)));
    settleTimer = setTimeout(function () {
      settleTimer = null;
      if (destroyed || !started || S.running() || !hadActivity) return;
      hadActivity = false; S.set(8, 'ok');
    }, wait);
  }
  var statusSet = function () { var r = originalStatusSet.apply(S, arguments); afterStatusChange(); return r; };
  statusSet.__t3Wrapped = 1; statusSet.__t3Orig = originalStatusSet;
  S.set = statusSet;
  wrapped.push(['MLSStatus.set', function () { if (S.set === statusSet) S.set = originalStatusSet; }]);

  /* --- fetch instrumentation: stages 1/2/3 driven by the REAL requests --- */
  var publicPreview = !!(window.__MLS_PUBLIC_PREVIEW && window.__MLS_PUBLIC_PREVIEW.enabled === true);
  if (!publicPreview && !window.fetch.__t3Wrapped) {
    var _fetch = window.fetch;
    var wf = function (input, init) {
      var url = ''; try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) {}
      var method = ''; try { method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase(); } catch (e) {}
      var stage = 0;
      if (method === 'GET' && /\/api\/appointments/.test(url)) stage = /[?&]date=/.test(url) ? 2 : 1;
      else if (method === 'GET' && /\/api\/providers/.test(url)) stage = 3;
      var statusGeneration = runtimeGeneration, trackStage = !!(stage && started);
      if (trackStage) S.set(stage, 'run');
      var p = _fetch.apply(this, arguments);
      if (trackStage) {
        p = p.then(function (r) { if (started && statusGeneration === runtimeGeneration) S.set(stage, (r && r.ok) ? 'ok' : 'err', r && !r.ok ? ('HTTP ' + r.status) : ''); return r; },
          function (e) { if (started && statusGeneration === runtimeGeneration) S.set(stage, 'err', 'network'); throw e; });
      }
      return p;
    };
    wf.__t3Wrapped = 1; wf.__t3Orig = _fetch;
    window.fetch = wf; wrapped.push(['fetch', function () { if (window.fetch === wf) window.fetch = _fetch; }]);
  }

  /* ==================== 2. CANONICAL STORE (window.MLSCal) ================ */
  var SUFFIX = /^(jr|sr|ii|iii|iv|v|md|do|np|pa|pac|c|rn|phd|esq|dr|drs|mr|mrs|ms|prof|aprn|fnp|dnp|dpm|dds|dmd|cnm|crna|od|lpc|lcsw|pt|dpt|ot)$/;
  /* A leading "PROVIDER " label on an imported row ("Provider MATTHEW SCHAEFFER, MD")
     is chrome, not a name \u2014 without stripping it the row earns its OWN roster chip
     next to the real provider's. */
  function cleanProv(p) { var s = String(p == null ? '' : p); s = s.replace(/\s*Close\s*$/, '').replace(/[\u00d7\u2715\u2716\u2717\u2718xX]\s*$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); s = s.replace(/^provider\s+(?=\S)/i, ''); return s; }
  function tokens(raw) { return cleanProv(raw).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(function (t) { return t && t.length > 1 && !SUFFIX.test(t); }); }
  function provKey(raw) { var t = tokens(raw); return t.slice().sort().join(' '); }
  function surnameOf(raw) { var t = tokens(raw); if (!t.length) return ''; return t.slice().sort(function (a, b) { return b.length - a.length; })[0]; }
  function humanize(raw) {
    var s = cleanProv(raw); if (!s) return s;
    var orig = String(raw == null ? '' : raw);
    if (orig.indexOf('_') >= 0) {
      var t = orig.replace(/\s*Close\s*$/, '').split('_').filter(Boolean);
      if (t.length >= 3) return (t[1] + ' ' + t[0] + ', ' + t.slice(2).join(' ')).replace(/\s+/g, ' ').trim();
      if (t.length === 2) return (t[1] + ' ' + t[0]).trim();
    }
    return s;
  }
  function nameKey(nm) { return String(nm == null ? '' : nm).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function dateKeyOf(a, dateFormatter) {
    if (!a) return '';
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(a.appt_date || ''));
    if (m) return m[1];
    if (a.start_at) { try { var d = new Date(a.start_at); if (!isNaN(d.getTime())) return tzDateKey(d, dateFormatter); } catch (e) {} }
    return '';
  }
  function hhmmOf(a, timeFormatter) {
    if (!a) return '';
    function wall(v) {
      var s = String(v == null ? '' : v).trim(); if (!s) return '';
      var m = /(?:^|T|\s)(\d{1,2}):(\d{2})\s*([AP])\.?\s*M\.?(?=\s|$)/i.exec(s);
      if (m) { var h = +m[1]; if (h < 1 || h > 12) return ''; if (m[3].toUpperCase() === 'P' && h < 12) h += 12; if (m[3].toUpperCase() === 'A' && h === 12) h = 0; return pad(h) + ':' + m[2]; }
      m = /(?:^|T|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\b|:)/.exec(s);
      return m ? pad(+m[1]) + ':' + m[2] : '';
    }
    /* Explicit wall-clock fields are authoritative. A real UTC instant is next
       and is converted in the account time zone. Legacy `time` is last. Never
       construct Date from null/empty (new Date(null) is the Unix epoch). */
    var t = wall(a.time_display); if (t) return t;
    t = wall(a.start_local); if (t) return t;
    if (String(a.start_at == null ? '' : a.start_at).trim()) { t = tzHHMM(a.start_at, timeFormatter); if (t) return t; }
    t = wall(a.time); if (t) return t;
    return '';
  }

  function appointmentCensusStatusForDay(day) {
    return safe(function () {
      var si = window.__mlsSI;
      return si && isFn(si.appointmentCensusStatusForDay) ? si.appointmentCensusStatusForDay(day) : null;
    }, null);
  }
  function appointmentCensusRowsForDay(day) {
    return safe(function () {
      var si = window.__mlsSI;
      if (!si || !isFn(si.appointmentCensusRowsForDay)) return null;
      var rows = si.appointmentCensusRowsForDay(day);
      return Array.isArray(rows) ? rows : null;
    }, null);
  }
  function visibleProviderTarget() {
    var raw = lsGet('mlsProvScope3'), split = raw.indexOf('|');
    return split >= 0 && raw.slice(split + 1).trim() ? raw.slice(split + 1).trim() : 'all';
  }
  function exactDisplaySelection(day) {
    return safe(function () {
      var si = window.__mlsSI;
      if (!si) return { owned: false, census: false, rows: null, status: null };
      var provider = visibleProviderTarget();
      var providerStatus = isFn(si.authoritativeStatusForDay) ? si.authoritativeStatusForDay(day, provider) : null;
      if (providerStatus && providerStatus.reason !== 'no-snapshot') {
        return {
          owned: true, census: false,
          rows: isFn(si.authoritativeRowsForDay) ? si.authoritativeRowsForDay(day, provider) : null,
          status: providerStatus
        };
      }
      var censusStatus = appointmentCensusStatusForDay(day);
      if (censusStatus && censusStatus.reason !== 'no-snapshot') {
        return { owned: true, census: true, rows: appointmentCensusRowsForDay(day), status: censusStatus };
      }
      return { owned: false, census: false, rows: null, status: providerStatus || censusStatus || null };
    }, { owned: false, census: false, rows: null, status: null });
  }
  function exactWholeDaySelection(day) {
    return safe(function () {
      var si = window.__mlsSI;
      if (!si) return { owned: false, census: false, rows: null, status: null };
      var providerStatus = isFn(si.authoritativeStatusForDay) ? si.authoritativeStatusForDay(day, 'all') : null;
      if (providerStatus && providerStatus.reason !== 'no-snapshot') {
        return {
          owned: true, census: false,
          rows: isFn(si.authoritativeRowsForDay) ? si.authoritativeRowsForDay(day, 'all') : null,
          status: providerStatus
        };
      }
      var censusStatus = appointmentCensusStatusForDay(day);
      if (censusStatus && censusStatus.reason !== 'no-snapshot') {
        return { owned: true, census: true, rows: appointmentCensusRowsForDay(day), status: censusStatus };
      }
      return { owned: false, census: false, rows: null, status: providerStatus || censusStatus || null };
    }, { owned: false, census: false, rows: null, status: null });
  }
  function appointmentCensusOwnsDay(day) {
    var selected = exactDisplaySelection(day);
    return !!(selected.owned && selected.census);
  }
  function effectiveScopeForDay(day) {
    if (!appointmentCensusOwnsDay(day)) return Cal.getScope();
    /* A selected-provider preference cannot apply to rows whose source proves
       no provider association. Clear the misleading scope even when the
       Calendar view is hidden and only the Visit header is rendering. */
    if (lsGet('mlsProvScope3')) lsSet('mlsProvScope3', '');
    safe(function () { var pf = $('calProvFilter'); if (pf && pf.value !== '') pf.value = ''; });
    return { pk: '', label: 'Provider unavailable', census: true };
  }
  function displayRowForRender(row) {
    if (!row || !appointmentCensusOwnsDay(row.appt_date)) return row;
    var copy = {};
    Object.keys(row).forEach(function (key) { copy[key] = row[key]; });
    copy.provider = '';
    [
      'providerName', 'provider_name', 'providerId', 'provider_id',
      'providerDisplayName', 'provider_display_name',
      'renderingProvider', 'rendering_provider',
      'renderingProviderName', 'rendering_provider_name',
      'athenaProviderId', 'athena_provider_id', 'renderingProviderId',
      'rendering_provider_id', 'doctor_user_id', 'doctorUserId',
      'provider_key', 'providerKey', 'providerTag', 'provider_tag'
    ].forEach(function (key) { delete copy[key]; });
    copy.__t3pk = '';
    return copy;
  }
  var swapping = false;
  var Cal = {
    version: VERSION,
    _sig: '', _provIdx: {}, _dupCount: 0, _full: null, _removedDups: [],
    normalize: function () {
      if (swapping) return false;                                          /* never normalize a render-swapped subset */
      var a = window._calAppts; if (!Array.isArray(a)) return false;
      if (Cal._full && a !== Cal._full && a.length < Cal._full.length * 0.9 && Cal._full.length > 20) return false; /* transient subset swap by another module: keep the real store */
      Cal._full = a;
      /* A normalize pass is synchronous, so the account timezone cannot change
         between rows. Resolve it once instead of doing a storage lookup for
         every appointment in the hot render path. */
      var resolvedTz = acctTz();
      var dateFormatter = tzFormatter('date', resolvedTz);
      var timeFormatter = tzFormatter('time', resolvedTz);
      var censusDayPass = {}, identityDayPass = {};
      function censusOwnedInPass(day) {
        if (!Object.prototype.hasOwnProperty.call(censusDayPass, day)) censusDayPass[day] = appointmentCensusOwnsDay(day);
        return censusDayPass[day];
      }
      function identityProtectedInPass(day) {
        if (!Object.prototype.hasOwnProperty.call(identityDayPass, day)) identityDayPass[day] = exactWholeDaySelection(day).owned || exactDisplaySelection(day).owned;
        return identityDayPass[day];
      }
      var seen = {}, provIdx = {}, keep = [], removed = [], i, x;
      for (i = 0; i < a.length; i++) {
        x = a[i]; if (!x) continue;
        var dk = dateKeyOf(x, dateFormatter);
        if (dk && x.appt_date !== dk) x.appt_date = dk;                    /* wrong-day fix: canonical YYYY-MM-DD */
        /* humanize BEFORE any cleaning: "Edwards_Lindsay_PA-CClose" -> "Lindsay Edwards, PA-C" */
        if (x.provider) { var cp = humanize(x.provider); if (cp !== x.provider) x.provider = cp; }
        x.__t3pk = x.provider ? provKey(x.provider) : '';
        x.__t3t = hhmmOf(x, timeFormatter);
        var nk = nameKey(x.name);
        if (!nk || !dk) { keep.push(x); continue; }
        var key = nk + '|' + dk + '|' + x.__t3t;
        var dayKeyD = nk + '|' + dk;
        if (identityProtectedInPass(dk)) {
          /* The exact census ID list, not demographics, owns appointment
             identity on this day. Two real appointments for the same patient
             may share a time; pre-authority name/patient dedupe must not
             collapse their distinct backend IDs. Stale IDs are retired by the
             exact membership pass below. */
          keep.push(x);
          continue;
        }
        if (seen[key] && pickRowsSameIdentity(seen[key], x)) {             /* duplicate only after positive patient-identity proof */
          var prev = seen[key];
          if (!prev.patient_external_id && x.patient_external_id) { removed.push(prev); keep[keep.indexOf(prev)] = x; seen[key] = x; if (seen[dayKeyD] === prev) seen[dayKeyD] = x; }
          else removed.push(x);
          continue;
        }
        if (seen[dayKeyD] && pickRowsSameIdentity(seen[dayKeyD], x) && (!x.__t3t || !seen[dayKeyD].__t3t)) { /* same proven patient/day, one timeless */
          var prevD = seen[dayKeyD];
          if (!prevD.__t3t && x.__t3t) { removed.push(prevD); keep[keep.indexOf(prevD)] = x; seen[dayKeyD] = x; seen[key] = x; }
          else removed.push(x);
          continue;
        }
        /* Keep the first identity in each bucket. A same-name/time row with a
           contradictory patient identity remains visible and can never make a
           later restore look uniquely safe. */
        if (!seen[key]) seen[key] = x; if (!seen[dayKeyD]) seen[dayKeyD] = x;
        keep.push(x);
      }
      if (removed.length) {                                                /* prune display duplicates in place (reversible) */
        a.length = 0; for (i = 0; i < keep.length; i++) a.push(keep[i]);
        Cal._removedDups = Cal._removedDups.concat(removed);
        Cal._dupCount = Cal._removedDups.length;
      }
      /* 2026-07-15: retire stale Athena imports on any day with a complete
         published exact snapshot. Older imports (different identity keys, or
         a start_at saved under a wrong practice timezone) linger beside the
         verified rows as visible time-shifted duplicates that the exact
         name+day+time dedupe above cannot catch. Rows carrying Athena import
         markers that are absent from the day's authoritative backend-id set
         are display-retired; manual rows (no import markers) are never
         touched, and nothing is deleted from the backend. */
      safe(function () {
        var si = window.__mlsSI;
        if (!si) return;
        var byDate = {};
        for (var di = 0; di < a.length; di++) { var dkey = a[di] && a[di].appt_date; if (dkey) byDate[dkey] = 1; }
        var retire = [];
        Object.keys(byDate).forEach(function (day) {
          /* Destructive display retirement is authorized only by exact
             whole-day membership (all-provider authority or appointment
             census). A selected-provider subset must never retire the other
             appointments before the user clears that filter. */
          var selected = exactWholeDaySelection(day), rows = selected.rows;
          if (!selected.owned || !Array.isArray(rows)) return;
          var ids = {};
          rows.forEach(function (r) { var id = String(r && r.id || ''); if (id) ids[id] = 1; });
          if (!Object.keys(ids).length && rows.length) return; /* id-less snapshot rows: no safe trim basis */
          for (var ai = 0; ai < a.length; ai++) {
            var row = a[ai]; if (!row || row.appt_date !== day) continue;
            if (ids[String(row.id || '')]) continue;
            /* patient_external_id belongs to the patient/chart namespace and
               is not appointment provenance. Retire only an explicit Athena
               appointment/import marker. */
            var athenaMarked = !!String(row.athena_appointment_id || row.athenaAppointmentId || row.source_appointment_id || '') ||
              /^(?:athena-schedule|athena-import)$/i.test(String(row.appointment_source || row.import_source || row.source || ''));
            if (athenaMarked) retire.push(row);
          }
        });
        if (retire.length) {
          var keep2 = a.filter(function (row) { return retire.indexOf(row) < 0; });
          a.length = 0; for (var ki = 0; ki < keep2.length; ki++) a.push(keep2[ki]);
          Cal._removedDups = Cal._removedDups.concat(retire);
          Cal._dupCount = Cal._removedDups.length;
        }
      });
      for (i = 0; i < a.length; i++) {
        x = a[i]; if (!x || !x.__t3pk || !x.appt_date) continue;
        /* An appointment-only census intentionally carries no row-to-provider
           proof. Even if an old backend row still has a provider label, do not
           let it create a roster/grouping for the census-owned day. */
        if (censusOwnedInPass(x.appt_date)) continue;
        if (!provIdx[x.__t3pk]) provIdx[x.__t3pk] = { pk: x.__t3pk, label: humanize(x.provider), total: 0, byDate: {} };
        provIdx[x.__t3pk].total++;
        provIdx[x.__t3pk].byDate[x.appt_date] = (provIdx[x.__t3pk].byDate[x.appt_date] || 0) + 1;
      }
      Cal._provIdx = provIdx;
      /* Include every patient-identity field and DOB. Several hydration paths
         enrich an existing appointment object in place, so length/edge-only
         signatures left the Visit projection permanently stale. */
      var sig = a.length + ':' + a.map(pickRowIdentitySig).join('|');
      var changed = sig !== Cal._sig; Cal._sig = sig;
      return changed;
    },
    getScope: function () {
      var raw = lsGet('mlsProvScope3');
      if (!raw) return { pk: '', label: 'All providers' };
      var i = raw.indexOf('|'); if (i < 0) return { pk: '', label: 'All providers' };
      return { pk: raw.slice(0, i), label: raw.slice(i + 1) || 'All providers' };
    },
    setScope: function (pk, label) {
      lsSet('mlsProvScope3', pk ? (pk + '|' + (label || pk)) : '');
      /* Keep the EXACT verified-pull selection in lockstep with the visible
         scope chips (2026-07-15): the chips are the only provider control the
         user can see, so choosing one must also arm the hidden legacy filter
         that drives the verified provider-day pull. The clinician is resolved
         through the canonical roster; an ambiguous or unresolvable scope
         clears the filter so the pull button honestly asks for a provider. */
      safe(function () {
        var pf = $('calProvFilter'); if (!pf) return;
        var next = '';
        if (pk) {
          var roster = window.__mlsProviderRoster;
          var entry = roster && isFn(roster.resolve) ? safe(function () { return roster.resolve(label || pk); }, null) : null;
          if (entry && entry.stableKey) next = (entry.id != null && String(entry.id)) ? String(entry.id) : ('pv:' + encodeURIComponent(String(entry.stableKey)));
        }
        if (next && !Array.prototype.some.call(pf.options || [], function (o) { return String(o.value) === next; })) {
          var opt = document.createElement('option'); opt.value = next; opt.textContent = String(label || pk); pf.appendChild(opt);
        }
        if (String(pf.value || '') !== next) { pf.value = next; try { pf.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
      });
      rerenderAll('scope');
    },
    matches: function (x, scope, useSn) {
      if (!scope || !scope.pk) return true;
      if (!x.__t3pk) return false;
      if (x.__t3pk === scope.pk) return true;
      /* surname fallback ONLY when the scope key exists in no appointment at all
         (e.g. account name "Michael Schaeffer" vs schedule "Matthew Schaeffer, MD").
         Never used when the scope came from real data, so two real providers who
         share a surname stay distinct. */
      if (!useSn) return false;
      var sn = surnameOf(scope.label || scope.pk);
      return !!sn && surnameOf(x.provider || '') === sn;
    },
    rows: function (opt) {
      opt = opt || {};
      var scope = opt.all ? null : Cal.getScope();
      var useSn = !!(scope && scope.pk && !Cal._provIdx[scope.pk]);
      var out = [], a = Cal._full || window._calAppts || [], displayDays = {};
      function includeByExactDisplay(row) {
        var day = String(row && row.appt_date || ''); if (!day) return true;
        var selected = displayDays[day];
        if (!selected) {
          selected = exactDisplaySelection(day);
          if (selected.owned && Array.isArray(selected.rows)) {
            selected.ids = {};
            selected.rows.forEach(function (one) { var id = String(one && one.id || ''); if (id) selected.ids[id] = 1; });
          }
          displayDays[day] = selected;
        }
        if (!selected.owned) return true;
        /* Pending hydration owns the day but has no complete safe slice yet.
           Render empty/pending, never fall back to append-only raw rows. */
        if (!Array.isArray(selected.rows)) return false;
        var id = String(row && row.id || '');
        if (id && selected.ids && selected.ids[id]) return true;
        /* Athena cannot adjudicate a manual MLS appointment. Keep it visible
           beside the exact census, but never preserve an explicitly sourced
           stale Athena appointment outside the verified ID set. */
        return !String(row && (row.athena_appointment_id || row.athenaAppointmentId || row.source_appointment_id) || '') &&
          !/^(?:athena-schedule|athena-import)$/i.test(String(row && (row.appointment_source || row.import_source || row.source) || ''));
      }
      for (var i = 0; i < a.length; i++) {
        var x = a[i]; if (!x) continue;
        if (opt.date && x.appt_date !== opt.date) continue;
        if (opt.month && String(x.appt_date || '').slice(0, 7) !== opt.month) continue;
        if (opt.dates && !opt.dates[x.appt_date]) continue;
        if (!includeByExactDisplay(x)) continue;
        if (scope && !appointmentCensusOwnsDay(x.appt_date) && !Cal.matches(x, scope, useSn)) continue;
        out.push(displayRowForRender(x));
      }
      out.sort(function (p, q) { return (String(p.appt_date) + 'T' + String(p.__t3t || '99')).localeCompare(String(q.appt_date) + 'T' + String(q.__t3t || '99')); });
      return out;
    },
    counts: function (opt) { return { scoped: Cal.rows(opt).length, all: Cal.rows(Object.assign({}, opt, { all: true })).length }; },
    providers: function (date) {
      if (date && appointmentCensusOwnsDay(date)) return [];
      var out = [], k;
      for (k in Cal._provIdx) { var p = Cal._provIdx[k]; out.push({ pk: p.pk, label: p.label, count: date ? (p.byDate[date] || 0) : p.total }); }
      out.sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
      return out;
    }
  };
  /* The shared consumer leaves its MLSCal object behind after revert. The 1p
     fork must own the live calendar API, while retaining the previous object
     solely so its own revert remains genuinely reversible. */
  window.MLSCal = Cal;

  /* current unit filter for the visible native calendar mode */
  function unitOpt() {
    var mode = safe(function () { return window._calMode; }, 'month') || 'month';
    if (mode === 'day') { var rk = safe(function () { return window._calRefDate; }, null) || todayKey(); return { mode: 'day', date: rk }; }
    if (mode === 'week') {
      var ref = safe(function () { return new Date((window._calRefDate || todayKey()) + 'T12:00'); }, new Date());
      var start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - ref.getDay());
      var dates = {}; for (var i = 0; i < 7; i++) { var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); dates[d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())] = 1; }
      return { mode: 'week', dates: dates };
    }
    var y = safe(function () { return window._calYear; }, null), m = safe(function () { return window._calMonth; }, null);
    if (y == null || m == null) { var n = new Date(); y = n.getFullYear(); m = n.getMonth(); }
    return { mode: 'month', month: y + '-' + pad(m + 1) };
  }

  /* ==================== 3. RETIRE THE COMPETING/BROKEN LAYERS ============= */
  var retired = { picker: false, wn: false };
  function retireCompetitors() {
    /* provider_picker: broken tag-based calendar scoping + its own WN box */
    var pk = window.__mlsProviderTagFix;
    if (pk && pk.installed && !retired.picker) {
      retired.picker = true;
      safe(function () { if (isFn(pk.setPick)) pk.setPick('all'); });        /* disarm scope wrap persistently */
      safe(function () { if (isFn(pk.revert)) pk.revert(); });               /* unwrap renderCalendar + remove box */
    }
    /* the WhosNext framework stays: we ADOPT it as the chip renderer and feed it
       the canonical store via _setPull (reverting it just got resurrected by the
       docpick bridge). Its stale self-sourcing is overridden by our feed. */
    /* leftover box from the old picker (renderWN in feat_queue_fixes_0703 no-ops once gone) */
    var box = $('mlsPtfBox'); if (box && box.parentNode) safe(function () { box.parentNode.removeChild(box); });
    /* native provider select must stay neutral: our scope owns filtering */
    var pf = $('calProvFilter'); if (pf && pf.value !== '') { pf.value = ''; safe(function () { if (isFn(window.renderCalendar)) window.renderCalendar(); }); }
    /* hard-disarm the legacy per-doctor pick so the old tag-scope can never re-arm on a future boot */
    safe(function () { if (isFn(window.uns) && localStorage.getItem(window.uns('mlsProvPick')) !== 'all') localStorage.setItem(window.uns('mlsProvPick'), 'all'); });
  }

  /* ==================== 4. GRID TRUTH (month / week / day / day panel) ==== */
  function withScopedAppts(fn, self, args) {
    if (swapping) return fn.apply(self, args);                             /* re-entrant render: no double swap */
    Cal.normalize();
    var full = window._calAppts;
    var sub = Cal.rows({});                                                /* all dates, scoped, deduped */
    swapping = true;
    try { window._calAppts = sub; return fn.apply(self, args); }
    finally { window._calAppts = full; swapping = false; }
  }
  var wrappedOnce = {};
  function wrapGlobal(name, stageK, post) {
    if (wrappedOnce[name]) return false;                                   /* wrap exactly once per load: never build w3-over-w2 chains */
    var cur = window[name];
    if (!isFn(cur) || (cur.__t3Wrapped && !cur.__mlsWrapperDisposed)) return false;
    var w = function () {
      var self = this, args = arguments;
      if (w.__mlsWrapperDisposed || destroyed || !started) return cur.apply(self, args);
      if (stageK) S.set(stageK, 'run');
      var r, failed = null;
      try { r = withScopedAppts(cur, self, args); }
      catch (e) {
        failed = e;
        try { window.__mlsT3.lastErr = { fn: name, msg: String(e && e.message || e), ts: Date.now() }; } catch (e2) {}
        try { console.warn('[mlsT3] ' + name + ' failed under scoped render, retrying pass-through:', e); } catch (e2) {}
        try { r = cur.apply(self, args); failed = null; }                  /* auto-recover: plain native render, no swap */
        catch (e3) { failed = e3; }
      }
      if (stageK) { if (failed) S.set(stageK, 'err', String(failed && failed.message || failed).slice(0, 60)); else S.set(stageK, 'ok'); }
      if (!failed && post) safe(post);
      return r;                                                            /* never rethrow: an enhancement must not break the app */
    };
    w.__t3Wrapped = 1; w.__t3Orig = cur;
    window[name] = w; wrappedOnce[name] = true;
    wrapped.push([name, function () { if (window[name] === w) window[name] = cur; }, w]);
    return true;
  }
  function ensureWraps() {
    wrapGlobal('renderCalendar', 4, postCalendarRender);
    wrapGlobal('calOpenDay', 2, null);
  }

  /* smart empty states inside the calendar grid */
  function postCalendarRender() {
    var grid = $('calGrid'); if (!grid) return;
    var old = $('mlsT3Empty'); if (old) old.remove();
    var opt = unitOpt();
    var c = Cal.counts(opt);
    if (c.scoped > 0) return;
    var scope = (opt.mode === 'day' && opt.date) ? effectiveScopeForDay(opt.date) : Cal.getScope();
    var el = document.createElement('div'); el.id = 'mlsT3Empty';
    var label = opt.mode === 'day' ? pretty(opt.date) : (opt.mode === 'week' ? 'this week' : 'this month');
    if (scope.pk && c.all > 0) {
      el.innerHTML = '<div class="t3e-t">No patients for <b>' + esc(scope.label) + '</b> ' + (opt.mode === 'day' ? 'on ' + esc(label) : esc(label)) + '.</div>' +
        '<div class="t3e-s">' + c.all + ' patient' + (c.all === 1 ? ' is' : 's are') + ' booked with other providers.</div>' +
        '<div class="t3e-b"><button type="button" class="t3e-all">View all providers</button><button type="button" class="t3e-rf">Refresh</button></div>';
      el.querySelector('.t3e-all').onclick = function () { Cal.setScope('', ''); };
    } else {
      el.innerHTML = '<div class="t3e-t">No appointments ' + (opt.mode === 'day' ? 'on ' + esc(label) : esc(label)) + '.</div>' +
        '<div class="t3e-s">' + (opt.mode === 'day' ? 'A quiet day. Pull the schedule from athenaOne if patients are missing.' : 'Pull the schedule from athenaOne if patients are missing.') + '</div>' +
        '<div class="t3e-b">' + (isFn(window.pullScheduleViaAssist) ? '<button type="button" class="t3e-pull">Pull from athenaOne</button>' : '') + '<button type="button" class="t3e-rf">Refresh</button></div>';
      var pb = el.querySelector('.t3e-pull'); if (pb) pb.onclick = function () { safe(function () { window.pullScheduleViaAssist(); }); };
    }
    el.querySelector('.t3e-rf').onclick = function () { safe(function () { if (isFn(window.loadCalendar)) window.loadCalendar(); }); };
    grid.insertBefore(el, grid.firstChild);
  }

  /* provider roster (replaces the broken doctor_user_id pills) */
  var rosterSig = '';
  function renderRoster() {
    var wrap = $('calSplitWrap') || $('calGrid');
    var visible = viewShown('calendarView');
    var ros = $('mlsT3Roster');
    if (!visible || !wrap || !wrap.parentNode) { if (ros) ros.style.display = 'none'; return; }
    var opt = unitOpt();
    var censusOwned = !!(opt.mode === 'day' && opt.date && appointmentCensusOwnsDay(opt.date));
    var provs = Cal.providers(opt.mode === 'day' ? opt.date : null);
    var scope = (opt.mode === 'day' && opt.date) ? effectiveScopeForDay(opt.date) : Cal.getScope();
    if (censusOwned && scope.pk) {
      /* A saved provider filter cannot adjudicate rows whose Athena source did
         not associate any appointment with a provider. Clear it durably and
         keep the native filter neutral without emitting a misleading click. */
      lsSet('mlsProvScope3', '');
      scope = { pk: '', label: 'All providers' };
      safe(function () { var pf = $('calProvFilter'); if (pf && pf.value !== '') pf.value = ''; });
    }
    var allCount = Cal.rows(Object.assign({}, opt, { all: true })).length;
    var censusCount = censusOwned ? Number((appointmentCensusStatusForDay(opt.date) || {}).sourceCount || 0) : 0;
    var sig = JSON.stringify([censusOwned ? 'appointment-census-only' : scope.pk, allCount, censusCount, provs.map(function (p) { return p.pk + p.count; }).join(','), opt.mode, opt.date || opt.month || '']);
    if (!ros) {
      ros = document.createElement('div'); ros.id = 'mlsT3Roster';
      wrap.parentNode.insertBefore(ros, wrap);
      ros.addEventListener('click', function (e) {
        var chip = e.target && e.target.closest ? e.target.closest('.t3r-chip') : null; if (!chip) return;
        Cal.setScope(chip.getAttribute('data-pk') || '', chip.getAttribute('data-label') || '');
      });
    }
    ros.style.display = '';
    if (sig === rosterSig) return; rosterSig = sig;
    if (censusOwned) {
      var manualCount = Math.max(0, allCount - censusCount);
      ros.innerHTML = '<span class="t3r-cap t3r-census">' + censusCount + ' Athena appointment' + (censusCount === 1 ? '' : 's') + ' &middot; provider unavailable' +
        (manualCount ? ' &middot; ' + manualCount + ' manual MLS entr' + (manualCount === 1 ? 'y' : 'ies') : '') + '</span>' +
        '<button type="button" class="t3r-rf" title="Refresh appointments">&#8635; Refresh</button>';
      ros.querySelector('.t3r-rf').onclick = function () { safe(function () { if (isFn(window.loadCalendar)) window.loadCalendar(); }); };
      return;
    }
    var html = '<span class="t3r-cap">Providers</span>' +
      '<span class="t3r-chip' + (!scope.pk ? ' t3r-on' : '') + '" data-pk="" data-label="All providers">All providers <b>' + allCount + '</b></span>';
    provs.forEach(function (p) {
      if (!p.label) return;
      var on = scope.pk && (scope.pk === p.pk);
      html += '<span class="t3r-chip' + (on ? ' t3r-on' : '') + '" data-pk="' + esc(p.pk) + '" data-label="' + esc(p.label) + '">' + esc(p.label) + ' <b>' + p.count + '</b></span>';
    });
    html += '<button type="button" class="t3r-rf" title="Refresh appointments">&#8635; Refresh</button>';
    ros.innerHTML = html;
    ros.querySelector('.t3r-rf').onclick = function () { safe(function () { if (isFn(window.loadCalendar)) window.loadCalendar(); }); };
  }

  /* small scoped note appended to the Day-at-a-glance card so its total can
     never silently disagree with a provider-scoped grid */
  function glanceNote() {
    var glance = document.querySelector('#calendarView .cx-glance');
    var old = $('mlsT3GlanceNote');
    if (!glance) { if (old) old.remove(); return; }
    var key = safe(function () { return window._calSelDay || window._calRefDate; }, null) || todayKey();
    var scope = effectiveScopeForDay(key);
    if (appointmentCensusOwnsDay(key)) { if (old) old.remove(); return; }
    if (!scope.pk) { if (old) old.remove(); return; }
    var n = Cal.rows({ date: key }).length;
    var txt = 'For ' + scope.label + ': ' + n + ' this day';
    if (old && old.parentElement === glance) { if (old.getAttribute('data-t') !== txt) { old.textContent = txt; old.setAttribute('data-t', txt); } return; }
    if (old) old.remove();
    var d = document.createElement('div'); d.id = 'mlsT3GlanceNote'; d.setAttribute('data-t', txt);
    d.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px dashed #E7E5DD;font-size:12px;font-weight:700;color:#2E6A4B';
    d.textContent = txt;
    glance.appendChild(d);
  }

  /* ==================== 5. PATIENT SELECTOR (one surface) ================= */
  function viewingDate() {
    /* The Visit workspace is always "now" in the account timezone.  Calendar
       and Assistant date controls are independent and must never silently
       replace the Visit patient list with another day. */
    return todayKey();
  }
  function canonicalList(date) {
    return Cal.rows({ date: date }).map(function (a) {
      /* Preserve every namespace-qualified patient reference. The old
         projection stripped these and forced the real click/restore path back
         to unsafe name-only matching. */
      return {
        name: a.name || '', time: a.__t3t || '', reason: a.reason || '', dob: a.dob || '',
        provider: a.provider ? humanize(a.provider) : '', __pk: a.__t3pk || '',
        patient_external_id: a.patient_external_id || '', _mlsTargetPatientId: a._mlsTargetPatientId || '',
        patientId: a.patientId || '', patient_id: a.patient_id || '',
        athenaPatientId: a.athenaPatientId || '', athena_patient_id: a.athena_patient_id || '',
        chartId: a.chartId || '', chart_id: a.chart_id || '',
        mrn: a.mrn || '', athenaId: a.athenaId || '', athena_id: a.athena_id || ''
      };
    });
  }
  var pickSig = '';
  function wrapperChainHas(fn, marker) {
    var seen = [], depth = 0;
    while (isFn(fn) && depth++ < 12 && seen.indexOf(fn) < 0) {
      if (fn[marker] && !fn.__mlsWrapperDisposed) return true;
      seen.push(fn);
      fn = fn.__t3Orig || fn.__mlsUnrOrig || fn.__mlsUpNowOrig || fn.__mlsOrig || null;
    }
    return false;
  }
  function wrapHeroRender() {
    var cur = window._renderTodayPatients;
    if (!isFn(cur) || wrapperChainHas(cur, '__t3Wrapped')) return;
    var w = function (appts) {
      var self = this, args = arguments;
      var r = safe(function () { return cur.apply(self, args); });
      if (started && !destroyed && viewShown('visitView')) safe(augmentHero);
      return r;
    };
    w.__t3Wrapped = 1; w.__t3Orig = cur;
    window._renderTodayPatients = w;
    wrapped.push(['_renderTodayPatients', function () { if (window._renderTodayPatients === w) window._renderTodayPatients = cur; }, w]);
  }
  function feedSelector(force) {
    if (!isFn(window._renderTodayPatients)) return;
    var vv = $('visitView'); if (!vv || !viewShown('visitView')) return;
    var date = viewingDate();
    var list = canonicalList(date);
    var scope = effectiveScopeForDay(date);
    var sig = date + '|' + scope.pk + '|' + list.length + '|' + list.map(pickRowIdentitySig).join(',');
    if (!force && sig === pickSig) return;
    pickSig = sig;
    S.set(6, 'run');
    var wn = window.__mlsWhosNext;
    if (wn && wn.installed && isFn(wn._setPull)) safe(function () { wn._setPull(list); });
    else safe(function () { window._renderTodayPatients(list); });
    S.set(6, 'ok');
    S.set(5, 'run'); S.set(5, 'ok');                                        /* Who's Next = same canonical surface now */
  }
  function augmentHero() {
    if (!viewShown('visitView')) return;
    var box = $('heroToday'); if (!box) return;
    var date = viewingDate();
    var scope = effectiveScopeForDay(date);
    var scoped = canonicalList(date);
    var all = Cal.rows({ date: date, all: true });
    /* header line: date + provider scope + count (one truth, shown once) */
    var head = $('mlsT3PickHead');
    if (!head) {
      head = document.createElement('div'); head.id = 'mlsT3PickHead';
      head.innerHTML = '<span class="t3p-cap">Patients</span><span class="t3p-date"></span><span class="t3p-prov"></span><span class="t3p-count"></span>';
      head.querySelector('.t3p-prov').onclick = function () { safe(function () { var nc = $('nav_calendar'); if (nc) nc.click(); }); };
    }
    if (box.parentElement && head.parentElement !== box.parentElement) box.parentElement.insertBefore(head, box);
    else if (head.nextSibling !== box) box.parentElement.insertBefore(head, box);
    head.querySelector('.t3p-date').textContent = (date === todayKey() ? 'Today' : pretty(date));
    head.querySelector('.t3p-prov').textContent = scope.label;
    head.querySelector('.t3p-prov').title = scope.census ? 'Athena did not associate these appointments with a provider' : 'Provider scope (change on the Calendar tab)';
    head.querySelector('.t3p-count').textContent = scoped.length + ' of ' + all.length + ' patient' + (all.length === 1 ? '' : 's');
    head.style.display = (all.length || scoped.length) ? 'flex' : 'none';
    /* smart empty: scoped day empty but other providers have patients */
    var note = $('mlsT3PickEmpty');
    if (!scope.census && scope.pk && !scoped.length && all.length) {
      if (!note) {
        note = document.createElement('div'); note.id = 'mlsT3PickEmpty';
        note.innerHTML = '<span class="t3pe-t"></span><button type="button" class="t3pe-all">Show all providers for this day</button>';
        note.querySelector('.t3pe-all').onclick = function () { Cal.setScope('', ''); };
      }
      note.querySelector('.t3pe-t').textContent = 'No patients for ' + scope.label + ' on ' + (date === todayKey() ? 'today' : pretty(date)) + ' - ' + all.length + ' booked with other providers.';
      if (note.parentElement !== box.parentElement) box.parentElement.insertBefore(note, box.nextSibling);
      note.style.display = 'flex';
      box.style.display = 'none';
    } else if (note) { note.style.display = 'none'; }
    /* provider tag on each chip when unscoped (so multi-provider days read clearly) */
    if (!scope.pk) {
      var chips = box.querySelectorAll('[onclick^="_heroPickPatient("]');
      var list = window._heroTodayList || [];
      for (var i = 0; i < chips.length; i++) {
        var oc = chips[i].getAttribute('onclick') || ''; var m = /_heroPickPatient\((\d+)\)/.exec(oc); if (!m) continue;
        var a = list[+m[1]]; if (!a || !a.provider) continue;
        if (chips[i].querySelector('.t3p-tag')) continue;
        var tag = document.createElement('span'); tag.className = 't3p-tag'; tag.textContent = a.provider;
        chips[i].appendChild(tag);
      }
    }
    /* WhosNext framework chips: 12-hour times + provider tag (idempotent) */
    var wchips = box.querySelectorAll('.wn-chip');
    for (var w = 0; w < wchips.length; w++) {
      var mt = wchips[w].querySelector('.wn-mt');
      if (mt && /^\d\d?:\d\d/.test((mt.textContent || '').trim()) && !mt.getAttribute('data-t3ampm')) {
        mt.setAttribute('data-t3ampm', '1');
        mt.textContent = mt.textContent.replace(/\b(\d\d?):(\d\d)\b/, function (s) { return ampm(s); });
      }
      if (!scope.pk && !wchips[w].querySelector('.t3p-tag')) {
        var nmEl = wchips[w].querySelector('.wn-nm');
        var row = null;
        if (nmEl) { var nmTxt = (nmEl.textContent || '').trim().toLowerCase(); row = scoped.filter(function (x) { return String(x.name).trim().toLowerCase() === nmTxt; })[0]; }
        if (row && row.provider) { var tg = document.createElement('span'); tg.className = 't3p-tag'; tg.textContent = row.provider; wchips[w].appendChild(tg); }
      }
    }
  }

  /* ---- selected-patient persistence (fix stale-after-refresh) ---- */
  /* __T3_PICK_IDENTITY_START__ -- kept pure so adversarial identity fixtures
     execute the exact production resolver without mounting the whole app. */
  function pickClean(value) { return String(value == null ? '' : value).trim().toLowerCase(); }
  function pickDobKey(value) {
    var raw = String(value == null ? '' : value).trim(), m;
    if ((m = raw.match(/^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})(?:\D|$)/))) return m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2);
    if ((m = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:\D|$)/))) return m[3] + ('0' + m[1]).slice(-2) + ('0' + m[2]).slice(-2);
    raw = raw.replace(/\D/g, '');
    if (/^(?:18|19|20|21)\d{6}$/.test(raw)) return raw;
    if (/^\d{8}$/.test(raw)) return raw.slice(4) + raw.slice(0, 4);
    return '';
  }
  function pickRefs(raw) {
    raw = raw || {};
    function values(keys, storedKey) {
      var out = [], seen = {};
      keys.forEach(function (key) {
        var list = raw[key]; if (!Array.isArray(list)) list = [list];
        list.forEach(function (value) { value = pickClean(value); if (value && !seen[value]) { seen[value] = 1; out.push(value); } });
      });
      var stored = raw.refs && raw.refs[storedKey]; if (!Array.isArray(stored)) stored = [stored];
      stored.forEach(function (value) { value = pickClean(value); if (value && !seen[value]) { seen[value] = 1; out.push(value); } });
      return out;
    }
    /* In this site model patientId/patient_id are local chart aliases. Athena
       source identifiers have their own explicit athenaPatientId/chartId
       namespace. Values never match merely because their text is equal. */
    var local = values(['patient_external_id', '_mlsTargetPatientId', 'patientId', 'patient_id'], 'local');
    var athena = values(['athenaPatientId', 'athena_patient_id', 'chartId', 'chart_id'], 'athena');
    var mrn = values(['mrn', 'athenaId', 'athena_id'], 'mrn');
    return {
      local: local[0] || '', athena: athena[0] || '', mrn: mrn[0] || '',
      _invalid: !!((raw.refs && raw.refs._invalid) || local.length > 1 || athena.length > 1 || mrn.length > 1)
    };
  }
  function pickHasRefs(refs) { return !!(refs && (refs.local || refs.athena || refs.mrn)); }
  function pickStableMatch(saved, row) {
    var want = pickRefs(saved), have = pickRefs(row), exact = false, keys = ['local', 'athena', 'mrn'];
    if (want._invalid || have._invalid || !pickHasRefs(want)) return false;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!want[key] || !have[key]) continue;
      if (want[key] !== have[key]) return false; /* same-namespace contradiction */
      exact = true;
    }
    return exact; /* equal text in a different namespace is never identity */
  }
  function pickRowsCompatible(left, right) {
    var a = pickRefs(left), b = pickRefs(right), keys = ['local', 'athena', 'mrn'];
    if (a._invalid || b._invalid) return false;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]; if (a[key] && b[key] && a[key] !== b[key]) return false;
    }
    var an = nameKey(left && left.name), bn = nameKey(right && right.name);
    if (an && bn && an !== bn) return false;
    var ad = pickDobKey(left && left.dob), bd = pickDobKey(right && right.dob);
    if (ad && bd && ad !== bd) return false;
    return true;
  }
  function pickRowsSameIdentity(left, right) {
    if (!pickRowsCompatible(left, right)) return false;
    var a = pickRefs(left), b = pickRefs(right), keys = ['local', 'athena', 'mrn'];
    if (a._invalid || b._invalid) return false;
    /* Compatibility is only the absence of a contradiction. Dedupe needs
       positive same-namespace proof; two identical demographic rows with no
       stable reference must remain visible so restore can see the ambiguity. */
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]; if (a[key] && b[key] && a[key] === b[key]) return true;
    }
    return false;
  }
  function pickRowIdentitySig(row) {
    row = row || {};
    var refs = pickRefs(row);
    return [
      pickClean(row.id || row.appointmentId || row.appointment_id),
      nameKey(row.name), pickDobKey(row.dob),
      refs.local, refs.athena, refs.mrn, refs._invalid ? '!' : '',
      String(row.appt_date || ''), String(row.__t3t || row.time || '')
    ].join('~');
  }
  function resolveSavedPick(saved, rows) {
    saved = saved || {}; rows = Array.isArray(rows) ? rows : [];
    var refs = pickRefs(saved), matches, first, i;
    if (!saved.name || refs._invalid) return null;
    if (pickHasRefs(refs)) {
      matches = rows.filter(function (row) { return pickStableMatch(saved, row); });
      if (!matches.length) return null;
      first = matches[0];
      for (i = 1; i < matches.length; i++) if (!pickRowsCompatible(first, matches[i])) return null;
      return first;
    }
    var dob = pickDobKey(saved.dob);
    if (!dob) return null; /* a saved name by itself is never safe to restore */
    matches = rows.filter(function (row) { return nameKey(row && row.name) === nameKey(saved.name) && pickDobKey(row && row.dob) === dob; });
    return matches.length === 1 ? matches[0] : null; /* duplicate demographics fail closed */
  }
  function resolveStoredPick(row, patients) {
    row = row || {}; patients = Array.isArray(patients) ? patients : [];
    var refs = pickRefs(row), matches;
    if (refs._invalid) return null;
    function asScheduleIdentity(patient) {
      return {
        name: patient && patient.name, dob: patient && patient.dob,
        patient_external_id: patient && patient.id,
        _mlsTargetPatientId: patient && patient._mlsTargetPatientId,
        patientId: patient && patient.patientId,
        patient_id: patient && patient.patient_id,
        athenaPatientId: patient && patient.athenaPatientId,
        athena_patient_id: patient && patient.athena_patient_id,
        chartId: patient && patient.chartId,
        chart_id: patient && patient.chart_id,
        mrn: patient && patient.mrn,
        athenaId: patient && patient.athenaId,
        athena_id: patient && patient.athena_id
      };
    }
    if (refs.local) {
      matches = patients.filter(function (patient) {
        var identity = asScheduleIdentity(patient), patientRefs = pickRefs(identity);
        return !patientRefs._invalid && patientRefs.local === refs.local && pickRowsCompatible(row, identity);
      });
      return matches.length === 1 ? matches[0] : null;
    }
    var dob = pickDobKey(row.dob); if (!row.name || !dob) return null;
    matches = patients.filter(function (patient) {
      var identity = asScheduleIdentity(patient);
      return !pickRefs(identity)._invalid && nameKey(patient && patient.name) === nameKey(row.name) &&
        pickDobKey(patient && patient.dob) === dob && pickRowsCompatible(row, identity);
    });
    return matches.length === 1 ? matches[0] : null;
  }
  /* __T3_PICK_IDENTITY_END__ */
  function persistPick(nameOrRow, dob) {
    var row = (nameOrRow && typeof nameOrRow === 'object') ? nameOrRow : { name: nameOrRow, dob: dob || '' };
    var name = String(row.name || '').trim(); if (!name) return;
    var refs = pickRefs(row);
    if (refs._invalid) { safe(function () { lsDel('mlsSelPt3'); }); return; }
    /* Generic Who's Next clicks expose only the hero fields. Capture stable
       refs only when the current-day name+DOB identifies exactly one row. */
    if (!pickHasRefs(refs) && pickDobKey(row.dob)) {
      var exact = Cal.rows({ date: todayKey(), all: true }).filter(function (candidate) {
        return nameKey(candidate && candidate.name) === nameKey(name) && pickDobKey(candidate && candidate.dob) === pickDobKey(row.dob);
      });
      if (exact.length === 1) { row = exact[0]; refs = pickRefs(row); }
    }
    safe(function () { lsSet('mlsSelPt3', JSON.stringify({ name: String(row.name || name), dob: String(row.dob || dob || ''), refs: refs, date: todayKey(), ts: Date.now() })); });
  }
  function wrapHeroPick() {
    var cur = window._heroPickPatient;
    if (!isFn(cur) || (cur.__t3Wrapped && !cur.__mlsWrapperDisposed)) return;
    var w = function (i) {
      if (w.__mlsWrapperDisposed || destroyed || !started) return cur.apply(this, arguments);
      var a = (window._heroTodayList || [])[i] || {};
      var patients = safe(function () { return isFn(window.getPatients) ? window.getPatients() : []; }, []);
      var refs = pickRefs(a), chart = resolveStoredPick(a, patients);
      var sameName = patients.filter(function (patient) { return nameKey(patient && patient.name) === nameKey(a.name); });
      if (refs._invalid || (refs.local && !chart) || (!chart && sameName.length)) {
        safe(function () { if (isFn(window.toast)) window.toast('Could not safely match that schedule row to one patient chart. Open Patients and choose the exact chart.', 'err'); });
        return false;
      }
      var r = cur.apply(this, arguments);
      if (r === false) return false;
      safe(function () {
        var active = isFn(window.activePatient) ? window.activePatient() : null;
        if (chart && (!active || String(active.id || '') !== String(chart.id || '')) && isFn(window.selectPatient)) {
          window.selectPatient(chart.id); active = chart;
        }
        if (active && nameKey(active.name) === nameKey(a.name) && (!pickDobKey(a.dob) || !pickDobKey(active.dob) || pickDobKey(a.dob) === pickDobKey(active.dob))) {
          var persisted = {};
          Object.keys(a).forEach(function (key) { persisted[key] = a[key]; });
          if (!persisted.patient_external_id) persisted.patient_external_id = active.id || '';
          persistPick(persisted);
        }
        S.set(7, 'run'); S.set(7, 'ok');
      });
      return r;
    };
    w.__t3Wrapped = 1; w.__t3Orig = cur;
    window._heroPickPatient = w;
    wrapped.push(['_heroPickPatient', function () { if (window._heroPickPatient === w) window._heroPickPatient = cur; }, w]);
  }
  var restoredPick = false, restoreT0 = Date.now();
  function restorePick() {
    if (restoredPick) return;
    safe(function () {
      var raw = lsGet('mlsSelPt3'); if (!raw) { restoredPick = true; return; }
      var v = null; try { v = JSON.parse(raw); } catch (e) { v = null; }
      if (!v || !v.name) { lsDel('mlsSelPt3'); restoredPick = true; return; }
      if (v.date !== todayKey()) { lsDel('mlsSelPt3'); restoredPick = true; return; }  /* stale day -> clear, never mislead */
      var have = (Cal._full || window._calAppts || []).length;
      if (!have) { if (Date.now() - restoreT0 > 90000) restoredPick = true; return; }  /* data not loaded yet: retry, don't clear */
      restoredPick = true;
      var restored = resolveSavedPick(v, Cal.rows({ date: v.date, all: true }));
      if (!restored) { lsDel('mlsSelPt3'); return; }                        /* missing, ambiguous, or contradicted -> clear */
      var nm = $('heroPtName'), db = $('heroPtDob');
      if (!nm || String(nm.value || '').trim()) return;                     /* never override deliberate typing */
      var chart = resolveStoredPick(restored, safe(function () { return isFn(window.getPatients) ? window.getPatients() : []; }, []));
      if (!chart || !chart.id || !isFn(window.selectPatient)) { lsDel('mlsSelPt3'); return; }
      window.selectPatient(chart.id);                                      /* canonical owner updates every patient surface */
      var activeId = safe(function () { return isFn(window.getActivePtId) ? window.getActivePtId() : ((isFn(window.activePatient) && window.activePatient() || {}).id || ''); }, '');
      if (String(activeId || '') !== String(chart.id || '')) { lsDel('mlsSelPt3'); return; }
      nm.value = String(chart.name || restored.name || v.name || '');
      if (db && !String(db.value || '').trim()) db.value = String(chart.dob || restored.dob || v.dob || '');
      safe(function () { if (isFn(window._heroSyncName)) window._heroSyncName(); });
      persistPick(Object.assign({}, restored, { patient_external_id: chart.id, name: chart.name || restored.name, dob: chart.dob || restored.dob }));
      S.set(7, 'run'); S.set(7, 'ok');
    });
  }

  /* ==================== 6. RETIRE THE DUPLICATE LIST + CSS ================ */
  function injectCSS() {
    if ($('mlsT3Css')) return;
    var css = [
      /* status strip - reserved compact bar, MLS blue family, no layout jumps */
      '#mlsT3Status{display:none;align-items:center;gap:9px;min-height:34px;margin:0 0 10px;padding:6px 12px;border-radius:10px;font:600 12.5px/1.35 system-ui,sans-serif;border:1px solid #EAF1EE;background:#eef4ff;color:#204034}',
      '#mlsT3Status.t3s-err{background:#fdecec;border-color:#f2c4c4;color:#8c2323}',
      '#mlsT3Status.t3s-done{background:#e9f7ef;border-color:#c8e8d4;color:#136c3f}',
      '#mlsT3Status .t3s-spin{width:13px;height:13px;border:3px solid #EAF1EE;border-top-color:#2E6A4B;border-radius:50%;animation:t3spin .8s linear infinite;flex:none}',
      '@keyframes t3spin{to{transform:rotate(360deg)}}',
      '#mlsT3Status .t3s-retry{font:700 12px/1 system-ui,sans-serif;background:#2E6A4B;color:#fff;border:0;border-radius:7px;padding:6px 12px;cursor:pointer}',
      '#mlsT3Status .t3s-x{margin-left:auto;cursor:pointer;opacity:.6;font-weight:800;padding:0 4px}',
      /* provider roster pills */
      '#mlsT3Roster{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:2px 0 12px}',
      '#mlsT3Roster .t3r-cap{font-size:11px;font-weight:800;letter-spacing:.06em;color:#5C6E86;text-transform:uppercase;margin-right:2px}',
      '#mlsT3Roster .t3r-chip{font:600 12.5px/1 system-ui,sans-serif;color:#204034;background:#fff;border:1px solid #d5e2f2;border-radius:999px;padding:7px 12px;cursor:pointer;white-space:nowrap}',
      '#mlsT3Roster .t3r-chip b{font-weight:800;margin-left:3px;color:#2E6A4B}',
      '#mlsT3Roster .t3r-chip:hover{border-color:#C9DCD2;background:#f3f8ff}',
      '#mlsT3Roster .t3r-chip.t3r-on{background:#2E6A4B;border-color:#2E6A4B;color:#fff}',
      '#mlsT3Roster .t3r-chip.t3r-on b{color:#fff}',
      '#mlsT3Roster .t3r-rf{margin-left:auto;font:600 12px/1 system-ui,sans-serif;color:#204034;background:#EAF1EE;border:1px solid #cfe0f5;border-radius:8px;padding:7px 11px;cursor:pointer}',
      /* calendar smart empty card */
      '#mlsT3Empty{grid-column:1/-1;margin:4px 0 12px;padding:16px 18px;border:1px dashed #c9d9f0;border-radius:12px;background:#f7faff;color:#204034;font:500 13px/1.5 system-ui,sans-serif}',
      '#mlsT3Empty .t3e-t{font-size:14px;color:#1E2B24}',
      '#mlsT3Empty .t3e-s{margin-top:3px;color:#5c7186;font-size:12.5px}',
      '#mlsT3Empty .t3e-b{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap}',
      '#mlsT3Empty button{font:700 12.5px/1 system-ui,sans-serif;border-radius:8px;padding:8px 14px;cursor:pointer;border:1px solid #cfe0f5;background:#fff;color:#204034}',
      '#mlsT3Empty button.t3e-all,#mlsT3Empty button.t3e-pull{background:#2E6A4B;border-color:#2E6A4B;color:#fff}',
      /* patient selector header + empty note (inside MLS Easy blue env) */
      '#mlsT3PickHead{display:none;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 4px;font:600 12px/1.3 system-ui,sans-serif;color:#eaf1ff}',
      '#mlsT3PickHead .t3p-cap{font-weight:800;letter-spacing:.05em;text-transform:uppercase;font-size:10.5px;opacity:.85}',
      '#mlsT3PickHead .t3p-date{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:2px 9px}',
      '#mlsT3PickHead .t3p-prov{background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.4);border-radius:999px;padding:2px 9px;cursor:pointer}',
      '#mlsT3PickHead .t3p-count{margin-left:auto;opacity:.85}',
      '#mlsT3PickEmpty{display:none;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0;padding:10px 13px;border-radius:11px;background:rgba(255,255,255,.10);border:1px solid rgba(160,190,255,.35);color:#eef4ff;font:600 12.5px/1.4 system-ui,sans-serif}',
      '#mlsT3PickEmpty .t3pe-all{font:700 12px/1 system-ui,sans-serif;background:rgba(255,255,255,.92);color:#204034;border:0;border-radius:8px;padding:7px 12px;cursor:pointer}',
      '.t3p-tag{display:block;font-size:10px;opacity:.75;margin-top:2px;font-weight:600}',
      /* retire the duplicated surfaces (reversible: remove this style tag).
         2026-07-15: only the DUPLICATED provider chips/label of the exact-pull
         roster row are retired - the verified provider-day pull button, its
         history checkbox, and its status line must stay visible, or the
         selected-provider + full-history route has no user control at all. */
      '#mlsQpAll{display:none!important}',
      '#mlsCalRoster .mlsRosChip,#mlsCalRoster .mlsRosLabel{display:none!important}',
      '#mlsCalEmpty{display:none!important}',
      '#mlsWhosNextBox{display:none!important}',
      /* mobile */
      '@media (max-width:640px){#mlsT3Roster{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}#mlsT3Roster .t3r-rf{margin-left:6px}#mlsT3Status{font-size:12px}#mlsT3PickHead .t3p-count{width:100%;margin-left:0}}'
    ].join('\n');
    var s = document.createElement('style'); s.id = 'mlsT3Css'; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ==================== 7. ORCHESTRATION ================================== */
  function rerenderAll(why) {
    safe(function () { Cal.normalize(); });
    safe(function () { if (isFn(window.renderCalendar) && viewShown('calendarView')) window.renderCalendar(); });
    safe(renderRoster);
    safe(glanceNote);
    safe(function () { feedSelector(true); });
    safe(augmentHero);
  }
  var lastStoreSig = '', lastDate = '', lastCalVis = false;
  function tick() {
    if (destroyed || !started) return;
    if (!viewShown('visitView') && !viewShown('calendarView')) return;
    injectCSS();
    retireCompetitors();
    ensureWraps();
    wrapHeroRender();
    wrapHeroPick();
    var changed = Cal.normalize();
    var date = viewingDate();
    var calVis = viewShown('calendarView');
    if (changed || Cal._sig !== lastStoreSig) {
      lastStoreSig = Cal._sig;
      restorePick();
      rerenderAll('data');
    } else {
      if (date !== lastDate) { feedSelector(false); safe(augmentHero); }
      if (calVis && !lastCalVis) { safe(renderRoster); safe(glanceNote); }
      safe(renderRoster);
      safe(function () { feedSelector(false); });
    }
    lastDate = date; lastCalVis = calVis;
    safe(glanceNote);
    safe(renderStrip);
  }
  var tickTimer = null, slowTimer = null, startTimer = null, startFallback = null, startIdle = null, pulseIdle = null, startQuietTimer = null;
  var T3_FIRST_USE_QUIET_MS = 2500, firstUseLastBusy = 0, firstUseReconciled = false;
  function inputPending() {
    return safe(function () {
      var scheduling = window.navigator && window.navigator.scheduling;
      return !!(scheduling && isFn(scheduling.isInputPending) && scheduling.isInputPending({ includeContinuous: true }));
    }, false);
  }
  function sharedLastBusy() {
    return safe(function () {
      var scheduler = window.__mlsDeferAsset;
      var stats = scheduler && isFn(scheduler.stats) ? scheduler.stats() : null;
      return Math.max(firstUseLastBusy, Number(stats && stats.lastBusy) || 0);
    }, firstUseLastBusy);
  }
  function firstUseQuietDelay() {
    return Math.max(0, T3_FIRST_USE_QUIET_MS - (Date.now() - sharedLastBusy()));
  }
  function scheduleFirstUseReconcile() {
    if (destroyed || !started || firstUseReconciled || startQuietTimer || startIdle != null) return;
    var wait = firstUseQuietDelay();
    if (inputPending()) { firstUseLastBusy = Date.now(); wait = T3_FIRST_USE_QUIET_MS; }
    if (wait > 0) {
      startQuietTimer = setTimeout(function () { startQuietTimer = null; scheduleFirstUseReconcile(); }, Math.max(32, wait));
      return;
    }
    var idle = window.requestIdleCallback;
    if (!idle) {
      startQuietTimer = setTimeout(function () {
        startQuietTimer = null;
        if (inputPending()) { firstUseLastBusy = Date.now(); scheduleFirstUseReconcile(); return; }
        if (firstUseQuietDelay() > 0) { scheduleFirstUseReconcile(); return; }
        firstUseReconciled = true;
        removeFirstUseActivityListeners();
        safe(tick);
        if (!slowTimer && started && !destroyed) slowTimer = setTimeout(slowPulse, 10000);
      }, 48);
      return;
    }
    /* No timeout: a timed-out idle callback is ordinary queued work and can
       run directly in front of the first click. This reconciliation is
       presentation-only and may wait for a genuine browser idle slice. */
    startIdle = idle(function (deadline) {
      startIdle = null;
      if (destroyed || !started || firstUseReconciled) return;
      var quietWait = firstUseQuietDelay();
      if (inputPending()) { firstUseLastBusy = Date.now(); quietWait = T3_FIRST_USE_QUIET_MS; }
      if (quietWait > 0 || (deadline && isFn(deadline.timeRemaining) && deadline.timeRemaining() < 8)) {
        startQuietTimer = setTimeout(function () { startQuietTimer = null; scheduleFirstUseReconcile(); }, Math.max(48, quietWait));
        return;
      }
      firstUseReconciled = true;
      removeFirstUseActivityListeners();
      safe(tick);
      if (!slowTimer && started && !destroyed) slowTimer = setTimeout(slowPulse, 10000);
    });
  }
  function noteFirstUseActivity() {
    if (destroyed || !started || firstUseReconciled) return;
    firstUseLastBusy = Date.now();
    /* Leave an existing quiet timer in place; it will recompute the remaining
       silence at its boundary. Continuous wheel/touch input therefore updates
       one timestamp instead of churning a timer for every event. A browser
       idle callback must be cancelled immediately because it may otherwise
       start the heavy scan before that boundary runs. */
    if (startIdle != null) { safe(function () { (window.cancelIdleCallback || clearTimeout)(startIdle); }); startIdle = null; }
    if (!startQuietTimer) scheduleFirstUseReconcile();
  }
  function scheduleTick(delay) {
    if (destroyed || !started) return;
    /* Route and status events before the first reconciliation are not lost;
       they join the one input-aware idle pass instead of starting a competing
       patient/calendar scan directly behind the user's action. */
    if (!firstUseReconciled) { scheduleFirstUseReconcile(); return; }
    if (tickTimer) return;
    tickTimer = setTimeout(function () { tickTimer = null; safe(tick); }, delay == null ? 60 : delay);
  }
  function slowPulse() {
    if (destroyed || !started) return;
    if (!firstUseReconciled) { scheduleFirstUseReconcile(); return; }
    if (!document.hidden && (viewShown('visitView') || viewShown('calendarView'))) {
      var idle = window.requestIdleCallback;
      if (idle) pulseIdle = idle(function () { pulseIdle = null; if (started && !destroyed) safe(tick); }, { timeout: 1200 });
      else scheduleTick(0);
    }
    slowTimer = setTimeout(slowPulse, document.hidden ? 30000 : 10000);
  }
  function onReady() { scheduleTick(0); }
  function onDocumentClick(ev) {
    var target = ev && ev.target;
    var chip = target && target.closest ? target.closest('.wn-chip') : null;
    if (chip) {
      var operationTimer = setTimeout(function () {
        var timerIndex = trackedTimeouts.indexOf(operationTimer);
        if (timerIndex >= 0) trackedTimeouts.splice(timerIndex, 1);
        if (!started || destroyed) return;
        safe(function () { var nm = $('heroPtName'); if (nm && String(nm.value || '').trim()) persistPick(nm.value.trim(), ($('heroPtDob') || {}).value || ''); S.set(7, 'run'); S.set(7, 'ok'); });
      }, 120);
      trackedTimeouts.push(operationTimer);
    }
    var relevant = target && target.closest ? target.closest('.wn-chip,#nav_calendar,#nav_visit,#nav_patients,#heroToday,#calProvFilter,#calJump') : null;
    if (!relevant) return;
    noteFirstUseActivity();
    scheduleTick(80);
  }
  function onDocumentInput(ev) {
    var t = ev && ev.target;
    if (!t) return;
    var ownedDate = (t.type === 'date' || t.type === 'month') && t.closest && t.closest('#calendarView,#visitView');
    if (t.id === 'calProvFilter' || t.id === 'calJump' || ownedDate) { noteFirstUseActivity(); scheduleTick(40); }
  }
  function onVisibility() { if (!document.hidden) { noteFirstUseActivity(); scheduleTick(0); } }
  function onFocus() { noteFirstUseActivity(); scheduleTick(0); }
  function onViewChanged() { noteFirstUseActivity(); scheduleTick(40); }
  var runtimeListeners = false, loaderReadyListener = null, loaderStartListener = null, sessionBoundaryListener = null;
  var firstUseActivityListeners = false;
  function installFirstUseActivityListeners() {
    if (firstUseActivityListeners || destroyed || firstUseReconciled) return;
    firstUseActivityListeners = true;
    try { document.addEventListener('pointerdown', noteFirstUseActivity, true); document.addEventListener('keydown', noteFirstUseActivity, true); document.addEventListener('wheel', noteFirstUseActivity, true); document.addEventListener('touchstart', noteFirstUseActivity, true); } catch (e) {}
  }
  function removeFirstUseActivityListeners() {
    if (!firstUseActivityListeners) return;
    firstUseActivityListeners = false;
    safe(function () { document.removeEventListener('pointerdown', noteFirstUseActivity, true); document.removeEventListener('keydown', noteFirstUseActivity, true); document.removeEventListener('wheel', noteFirstUseActivity, true); document.removeEventListener('touchstart', noteFirstUseActivity, true); });
  }
  function installRuntimeListeners() {
    if (runtimeListeners || destroyed) return; runtimeListeners = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
    installFirstUseActivityListeners();
    try { document.addEventListener('click', onDocumentClick, true); } catch (e) {}
    try { document.addEventListener('input', onDocumentInput, true); document.addEventListener('change', onDocumentInput, true); } catch (e) {}
    try { document.addEventListener('visibilitychange', onVisibility); } catch (e) {}
    try { window.addEventListener('focus', onFocus); } catch (e) {}
    try { window.addEventListener('pageshow', onFocus); } catch (e) {}
    try { window.addEventListener('mls:view-changed', onViewChanged); } catch (e) {}
  }
  function removeRuntimeListeners() {
    if (!runtimeListeners) return; runtimeListeners = false;
    removeFirstUseActivityListeners();
    safe(function () { document.removeEventListener('DOMContentLoaded', onReady); document.removeEventListener('click', onDocumentClick, true); document.removeEventListener('input', onDocumentInput, true); document.removeEventListener('change', onDocumentInput, true); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', onFocus); window.removeEventListener('pageshow', onFocus); window.removeEventListener('mls:view-changed', onViewChanged); });
  }
  function restoreCalData() {
    safe(function () {
      var a = Cal._full;
      /* Core clears the retained array and replaces window._calAppts before a
         session-boundary event. Never repopulate that detached Account-A ref. */
      if (a === window._calAppts && Array.isArray(a) && Cal._removedDups.length) Cal._removedDups.forEach(function (row) { if (a.indexOf(row) < 0) a.push(row); });
      Cal._removedDups = []; Cal._dupCount = 0; Cal._full = null; Cal._sig = ''; Cal._provIdx = {};
    });
  }
  function resetStatusState() {
    hadActivity = false; stripState = { txt: '', kind: '' };
    safe(function () {
      for (var k = 1; k <= 8; k++) {
        var g = S.stages && S.stages[k]; if (!g) continue;
        g.state = 'idle'; g.detail = ''; g.ts = 0;
      }
      S.lastErr = null; S.activity = 0; S.settled = true;
    });
  }
  function clearSessionUi() {
    safe(function () {
      var empty = $('mlsT3PickEmpty'), hero = $('heroToday');
      if (empty && hero && hero.style && hero.style.display === 'none') hero.style.display = '';
      nodes.forEach(function (id) { if (id === 'mlsT3Css') return; var el = $(id); if (el && el.parentNode) el.parentNode.removeChild(el); });
      var tags = document.querySelectorAll('.t3p-tag');
      for (var i = 0; i < tags.length; i++) if (tags[i].parentNode) tags[i].parentNode.removeChild(tags[i]);
    });
    rosterSig = ''; pickSig = ''; lastStoreSig = ''; lastDate = ''; lastCalVis = false;
  }
  function startRuntime() {
    if (destroyed || started) return;
    if (startupBusy()) { queueStart(80); return; }
    runtimeGeneration++;
    clearSessionUi(); resetStatusState();
    started = true;
    firstUseReconciled = false; firstUseLastBusy = Date.now();
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    if (startFallback) { clearTimeout(startFallback); startFallback = null; }
    if (loaderReadyListener) { safe(function () { window.removeEventListener('mls:loader-ready', loaderReadyListener); }); loaderReadyListener = null; }
    installRuntimeListeners();
    /* Wrappers are cheap and must exist before the first click. The expensive
       roster/hero normalization waits for one input-quiet, real-idle slice. */
    safe(ensureWraps); safe(wrapHeroRender); safe(wrapHeroPick);
    scheduleFirstUseReconcile();
  }
  function queueStart(delay) {
    if (destroyed || started || startTimer) return;
    startTimer = setTimeout(function () { startTimer = null; startRuntime(); }, delay == null ? 180 : delay);
  }
  function startupBusy() {
    return safe(function () {
      var gateBusy = window.sfGateLoadingVisible === true || document.documentElement.classList.contains('mls-secure-loading');
      var auth = $('authScreen'), app = $('appScreen');
      var authVisible = !!(auth && auth.style && auth.style.display !== 'none' && (!app || !app.style || app.style.display === 'none'));
      return !!(gateBusy || authVisible);
    }, false);
  }
  function fallbackCheck() {
    startFallback = null;
    var signedOut = safe(function () { var auth = $('authScreen'), app = $('appScreen'); return !!(auth && auth.style && auth.style.display !== 'none' && (!app || !app.style || app.style.display === 'none')); }, false);
    if (signedOut) return; /* loader-start/ready is the wake-up; never poll the login screen */
    if (startupBusy()) { startFallback = setTimeout(fallbackCheck, 1000); return; }
    queueStart(window.__mlsLoaderReadyAt ? 180 : 0);
  }
  function armReady() {
    if (!loaderReadyListener) {
      loaderReadyListener = function () { loaderReadyListener = null; queueStart(180); };
      safe(function () { window.addEventListener('mls:loader-ready', loaderReadyListener, { once: true }); });
    }
    if (!startFallback) startFallback = setTimeout(fallbackCheck, 12000);
  }
  function pauseRuntime() {
    if (destroyed) return;
    runtimeGeneration++;
    started = false;
    safe(function () { if (tickTimer) clearTimeout(tickTimer); tickTimer = null; if (slowTimer) clearTimeout(slowTimer); slowTimer = null; if (settleTimer) clearTimeout(settleTimer); settleTimer = null; if (stripHideTimer) clearTimeout(stripHideTimer); stripHideTimer = null; if (startTimer) clearTimeout(startTimer); startTimer = null; if (startFallback) clearTimeout(startFallback); startFallback = null; if (startQuietTimer) clearTimeout(startQuietTimer); startQuietTimer = null; if (startIdle != null) (window.cancelIdleCallback || clearTimeout)(startIdle); startIdle = null; if (pulseIdle != null) (window.cancelIdleCallback || clearTimeout)(pulseIdle); pulseIdle = null; });
    firstUseReconciled = false; firstUseLastBusy = 0;
    while (trackedTimeouts.length) safe(function () { clearTimeout(trackedTimeouts.pop()); });
    removeRuntimeListeners();
    restoreCalData(); clearSessionUi(); resetStatusState();
    restoredPick = false; restoreT0 = Date.now(); swapping = false;
    wrappedOnce = {}; retired = { picker: false, wn: false };
    armReady();
  }
  /* CSS is a tiny style insertion and remains under the gate, avoiding a visual
     flash. All patient/calendar scans wait for the real loader handoff. */
  safe(injectCSS);
  loaderStartListener = pauseRuntime;
  sessionBoundaryListener = pauseRuntime;
  safe(function () { window.addEventListener('mls:loader-start', loaderStartListener); });
  safe(function () { window.addEventListener('mls:session-boundary', sessionBoundaryListener); });
  if (startupBusy()) {
    armReady();
  } else if (window.__mlsLoaderReadyAt) {
    queueStart(180);
  } else {
    startRuntime();
  }

  /* ==================== API / REVERT ====================================== */
  window.__mlsT3 = {
    installed: true,
    version: VERSION,
    cal: Cal,
    status: S,
    resolveSavedPick: resolveSavedPick,
    resolveStoredPick: resolveStoredPick,
    _renderRoster: renderRoster,
    rerender: rerenderAll,
    revert: function () {
      destroyed = true;
      started = false;
      safe(function () { if (tickTimer) clearTimeout(tickTimer); if (slowTimer) clearTimeout(slowTimer); if (settleTimer) clearTimeout(settleTimer); if (stripHideTimer) clearTimeout(stripHideTimer); if (startTimer) clearTimeout(startTimer); if (startFallback) clearTimeout(startFallback); if (startQuietTimer) clearTimeout(startQuietTimer); startQuietTimer = null; });
      safe(function () { if (startIdle != null) (window.cancelIdleCallback || clearTimeout)(startIdle); startIdle = null; if (pulseIdle != null) (window.cancelIdleCallback || clearTimeout)(pulseIdle); pulseIdle = null; });
      if (loaderReadyListener) { safe(function () { window.removeEventListener('mls:loader-ready', loaderReadyListener); }); loaderReadyListener = null; }
      if (loaderStartListener) { safe(function () { window.removeEventListener('mls:loader-start', loaderStartListener); }); loaderStartListener = null; }
      if (sessionBoundaryListener) { safe(function () { window.removeEventListener('mls:session-boundary', sessionBoundaryListener); }); sessionBoundaryListener = null; }
      while (trackedTimeouts.length) safe(function () { clearTimeout(trackedTimeouts.pop()); });
      removeRuntimeListeners();
      wrapped.forEach(function (p) { safe(function () { if (p[2]) p[2].__mlsWrapperDisposed = true; }); safe(p[1]); });
      nodes.forEach(function (id) { safe(function () { var el = $(id); if (el && el.parentNode) el.parentNode.removeChild(el); }); });
      safe(function () {                                                    /* restore pruned duplicate rows */
        var a = Cal._full;
        if (a === window._calAppts && Array.isArray(a) && Cal._removedDups.length) { Cal._removedDups.forEach(function (x) { if (a.indexOf(x) < 0) a.push(x); }); }
        Cal._removedDups = [];
      });
      safe(function () { window.__mlsT3.installed = false; });
      safe(function () { if (window.MLSCal === Cal) window.MLSCal = previousMLSCal; });
    }
  };
})();

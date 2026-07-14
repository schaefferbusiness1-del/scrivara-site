/* ============================================================================
 * feat_task3_frontsync.js -> window.__mlsT3   (Task 3, 2026-07-05, build b19)
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
  if (window.__mlsT3 && window.__mlsT3.installed) return;

  var VERSION = 't3-1.0.4';
  var wrapped = [], trackedTimeouts = [], destroyed = false;
  var nodes = ['mlsT3Status', 'mlsT3Roster', 'mlsT3Empty', 'mlsT3PickEmpty', 'mlsT3PickHead', 'mlsT3Css', 'mlsT3GlanceNote'];

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isFn(f) { return typeof f === 'function'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function lsGet(name) { return safe(function () { return isFn(window.uns) ? String(localStorage.getItem(window.uns(name)) || '') : ''; }, ''); }
  function lsSet(name, v) { safe(function () { if (isFn(window.uns)) localStorage.setItem(window.uns(name), String(v == null ? '' : v)); }); }
  function lsDel(name) { safe(function () { if (isFn(window.uns)) localStorage.removeItem(window.uns(name)); }); }
  function acctTz() { return safe(function () { var t = isFn(window._acctTz) ? window._acctTz() : localStorage.getItem(window.uns ? window.uns('acctTz') : '') || ''; return (t && String(t).trim()) || 'America/New_York'; }, 'America/New_York'); }
  function tzDateKey(d) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: acctTz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); } catch (e) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); } }
  function tzHHMM(iso) { try { var d = new Date(iso); if (isNaN(d.getTime())) return ''; var ps = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: acctTz() }).formatToParts(d); var hh = 0, mm = 0; ps.forEach(function (p) { if (p.type === 'hour') hh = parseInt(p.value, 10); if (p.type === 'minute') mm = parseInt(p.value, 10); }); if (hh === 24) hh = 0; return pad(hh) + ':' + pad(mm); } catch (e) { return ''; } }
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
    if (cal && cal.offsetParent !== null) return { host: cal, mode: 'cal' };
    var hero = $('heroToday');
    if (hero && hero.parentElement && $('visitView') && $('visitView').offsetParent !== null) return { host: hero.parentElement, before: hero, mode: 'visit' };
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
    if (destroyed) return;
    safe(renderStrip);
    try { if (stripHideTimer) clearTimeout(stripHideTimer); stripHideTimer = setTimeout(function () { stripHideTimer = null; safe(renderStrip); }, 3200); } catch (e) {}
    safe(function () { if (typeof scheduleTick === 'function') scheduleTick(30); });
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (S.running()) { hadActivity = true; return; }
    if (!hadActivity) return;
    var wait = Math.max(0, 1150 - (Date.now() - Number(S.activity || 0)));
    settleTimer = setTimeout(function () {
      settleTimer = null;
      if (destroyed || S.running() || !hadActivity) return;
      hadActivity = false; S.set(8, 'ok');
    }, wait);
  }
  var statusSet = function () { var r = originalStatusSet.apply(S, arguments); afterStatusChange(); return r; };
  statusSet.__t3Wrapped = 1; statusSet.__t3Orig = originalStatusSet;
  S.set = statusSet;
  wrapped.push(['MLSStatus.set', function () { if (S.set === statusSet) S.set = originalStatusSet; }]);

  /* --- fetch instrumentation: stages 1/2/3 driven by the REAL requests --- */
  if (!window.fetch.__t3Wrapped) {
    var _fetch = window.fetch;
    var wf = function (input, init) {
      var url = ''; try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) {}
      var method = ''; try { method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase(); } catch (e) {}
      var stage = 0;
      if (method === 'GET' && /\/api\/appointments/.test(url)) stage = /[?&]date=/.test(url) ? 2 : 1;
      else if (method === 'GET' && /\/api\/providers/.test(url)) stage = 3;
      if (stage) S.set(stage, 'run');
      var p = _fetch.apply(this, arguments);
      if (stage) {
        p = p.then(function (r) { S.set(stage, (r && r.ok) ? 'ok' : 'err', r && !r.ok ? ('HTTP ' + r.status) : ''); return r; },
          function (e) { S.set(stage, 'err', 'network'); throw e; });
      }
      return p;
    };
    wf.__t3Wrapped = 1; wf.__t3Orig = _fetch;
    window.fetch = wf; wrapped.push(['fetch', function () { if (window.fetch === wf) window.fetch = _fetch; }]);
  }

  /* ==================== 2. CANONICAL STORE (window.MLSCal) ================ */
  var SUFFIX = /^(jr|sr|ii|iii|iv|v|md|do|np|pa|pac|c|rn|phd|esq|dr|drs|mr|mrs|ms|prof|aprn|fnp|dnp|dpm|dds|dmd|cnm|crna|od|lpc|lcsw|pt|dpt|ot)$/;
  function cleanProv(p) { var s = String(p == null ? '' : p); s = s.replace(/\s*Close\s*$/, '').replace(/[\u00d7\u2715\u2716\u2717\u2718xX]\s*$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); return s; }
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
  function dateKeyOf(a) {
    if (!a) return '';
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(a.appt_date || ''));
    if (m) return m[1];
    if (a.start_at) { try { var d = new Date(a.start_at); if (!isNaN(d.getTime())) return tzDateKey(d); } catch (e) {} }
    return '';
  }
  function hhmmOf(a) {
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
    if (String(a.start_at == null ? '' : a.start_at).trim()) { t = tzHHMM(a.start_at); if (t) return t; }
    t = wall(a.time); if (t) return t;
    return '';
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
      var seen = {}, provIdx = {}, keep = [], removed = [], i, x;
      for (i = 0; i < a.length; i++) {
        x = a[i]; if (!x) continue;
        var dk = dateKeyOf(x);
        if (dk && x.appt_date !== dk) x.appt_date = dk;                    /* wrong-day fix: canonical YYYY-MM-DD */
        /* humanize BEFORE any cleaning: "Edwards_Lindsay_PA-CClose" -> "Lindsay Edwards, PA-C" */
        if (x.provider) { var cp = humanize(x.provider); if (cp !== x.provider) x.provider = cp; }
        x.__t3pk = x.provider ? provKey(x.provider) : '';
        x.__t3t = hhmmOf(x);
        var nk = nameKey(x.name);
        if (!nk || !dk) { keep.push(x); continue; }
        var key = nk + '|' + dk + '|' + x.__t3t;
        var dayKeyD = nk + '|' + dk;
        if (seen[key]) {                                                   /* exact duplicate (name+day+time) */
          var prev = seen[key];
          if (!prev.patient_external_id && x.patient_external_id) { removed.push(prev); keep[keep.indexOf(prev)] = x; seen[key] = x; if (seen[dayKeyD] === prev) seen[dayKeyD] = x; }
          else removed.push(x);
          continue;
        }
        if (seen[dayKeyD] && (!x.__t3t || !seen[dayKeyD].__t3t)) {         /* same patient same day, one timeless */
          var prevD = seen[dayKeyD];
          if (!prevD.__t3t && x.__t3t) { removed.push(prevD); keep[keep.indexOf(prevD)] = x; seen[dayKeyD] = x; seen[key] = x; }
          else removed.push(x);
          continue;
        }
        seen[key] = x; if (!seen[dayKeyD]) seen[dayKeyD] = x;
        keep.push(x);
      }
      if (removed.length) {                                                /* prune display duplicates in place (reversible) */
        a.length = 0; for (i = 0; i < keep.length; i++) a.push(keep[i]);
        Cal._removedDups = Cal._removedDups.concat(removed);
        Cal._dupCount = Cal._removedDups.length;
      }
      for (i = 0; i < a.length; i++) {
        x = a[i]; if (!x || !x.__t3pk || !x.appt_date) continue;
        if (!provIdx[x.__t3pk]) provIdx[x.__t3pk] = { pk: x.__t3pk, label: x.provider, total: 0, byDate: {} };
        provIdx[x.__t3pk].total++;
        provIdx[x.__t3pk].byDate[x.appt_date] = (provIdx[x.__t3pk].byDate[x.appt_date] || 0) + 1;
      }
      Cal._provIdx = provIdx;
      var sig = a.length + ':' + (a[0] && (a[0].id || a[0].name) || '') + ':' + (a[a.length - 1] && (a[a.length - 1].id || a[a.length - 1].name) || '') + ':' + (a[0] && a[0].appt_date || '');
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
      safe(function () { var pf = $('calProvFilter'); if (pf && pf.value !== '') { pf.value = ''; } });
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
      var out = [], a = Cal._full || window._calAppts || [];
      for (var i = 0; i < a.length; i++) {
        var x = a[i]; if (!x) continue;
        if (opt.date && x.appt_date !== opt.date) continue;
        if (opt.month && String(x.appt_date || '').slice(0, 7) !== opt.month) continue;
        if (opt.dates && !opt.dates[x.appt_date]) continue;
        if (scope && !Cal.matches(x, scope, useSn)) continue;
        out.push(x);
      }
      out.sort(function (p, q) { return (String(p.appt_date) + 'T' + String(p.__t3t || '99')).localeCompare(String(q.appt_date) + 'T' + String(q.__t3t || '99')); });
      return out;
    },
    counts: function (opt) { return { scoped: Cal.rows(opt).length, all: Cal.rows(Object.assign({}, opt, { all: true })).length }; },
    providers: function (date) {
      var out = [], k;
      for (k in Cal._provIdx) { var p = Cal._provIdx[k]; out.push({ pk: p.pk, label: p.label, count: date ? (p.byDate[date] || 0) : p.total }); }
      out.sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
      return out;
    }
  };
  if (!window.MLSCal) window.MLSCal = Cal;

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
    if (!isFn(cur) || cur.__t3Wrapped) return false;
    var w = function () {
      var self = this, args = arguments;
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
    wrapped.push([name, function () { if (window[name] === w) window[name] = cur; }]);
    return true;
  }
  function ensureWraps() {
    wrapGlobal('renderCalendar', 4, postCalendarRender);
    wrapGlobal('calOpenDay', 2, null);
    wrapGlobal('renderCalCheckin', 0, null);
  }

  /* smart empty states inside the calendar grid */
  function postCalendarRender() {
    var grid = $('calGrid'); if (!grid) return;
    var old = $('mlsT3Empty'); if (old) old.remove();
    var opt = unitOpt();
    var c = Cal.counts(opt);
    if (c.scoped > 0) return;
    var scope = Cal.getScope();
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
    var visible = $('calendarView') && $('calendarView').offsetParent !== null;
    var ros = $('mlsT3Roster');
    if (!visible || !wrap || !wrap.parentNode) { if (ros) ros.style.display = 'none'; return; }
    var opt = unitOpt();
    var provs = Cal.providers(opt.mode === 'day' ? opt.date : null);
    var scope = Cal.getScope();
    var allCount = Cal.rows(Object.assign({}, opt, { all: true })).length;
    var sig = JSON.stringify([scope.pk, allCount, provs.map(function (p) { return p.pk + p.count; }).join(','), opt.mode, opt.date || opt.month || '']);
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
    var scope = Cal.getScope();
    if (!glance) { if (old) old.remove(); return; }
    if (!scope.pk) { if (old) old.remove(); return; }
    var key = safe(function () { return window._calSelDay || window._calRefDate; }, null) || todayKey();
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
    var i = document.querySelector('.mlsnu-date') || document.querySelector('.as-date');
    if (i && /^\d{4}-\d{2}-\d{2}$/.test(i.value)) return i.value;
    var vis = [].filter.call(document.querySelectorAll('#visitView input[type="date"]'), function (x) { return x.offsetParent !== null; })[0];
    if (vis && /^\d{4}-\d{2}-\d{2}$/.test(vis.value)) return vis.value;
    return todayKey();
  }
  function canonicalList(date) {
    return Cal.rows({ date: date }).map(function (a) {
      return { name: a.name || '', time: a.__t3t || '', reason: a.reason || '', dob: a.dob || '', provider: a.provider ? humanize(a.provider) : '', __pk: a.__t3pk || '' };
    });
  }
  var pickSig = '';
  function wrapHeroRender() {
    var cur = window._renderTodayPatients;
    if (!isFn(cur) || cur.__t3Wrapped) return;
    var w = function (appts) {
      var self = this, args = arguments;
      var r = safe(function () { return cur.apply(self, args); });
      safe(augmentHero);
      return r;
    };
    w.__t3Wrapped = 1; w.__t3Orig = cur;
    window._renderTodayPatients = w;
    wrapped.push(['_renderTodayPatients', function () { if (window._renderTodayPatients === w) window._renderTodayPatients = cur; }]);
  }
  function feedSelector(force) {
    if (!isFn(window._renderTodayPatients)) return;
    var vv = $('visitView'); if (!vv || vv.offsetParent === null) return;
    var date = viewingDate();
    var list = canonicalList(date);
    var scope = Cal.getScope();
    var sig = date + '|' + scope.pk + '|' + list.length + '|' + list.map(function (x) { return x.name + x.time; }).join(',');
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
    var box = $('heroToday'); if (!box) return;
    var date = viewingDate();
    var scope = Cal.getScope();
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
    head.querySelector('.t3p-prov').title = 'Provider scope (change on the Calendar tab)';
    head.querySelector('.t3p-count').textContent = scoped.length + ' of ' + all.length + ' patient' + (all.length === 1 ? '' : 's');
    head.style.display = (all.length || scoped.length) ? 'flex' : 'none';
    /* smart empty: scoped day empty but other providers have patients */
    var note = $('mlsT3PickEmpty');
    if (scope.pk && !scoped.length && all.length) {
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
  function persistPick(name, dob) {
    if (!name) return;
    safe(function () { lsSet('mlsSelPt3', JSON.stringify({ name: name, dob: dob || '', date: todayKey(), ts: Date.now() })); });
  }
  function wrapHeroPick() {
    var cur = window._heroPickPatient;
    if (!isFn(cur) || cur.__t3Wrapped) return;
    var w = function (i) {
      var r = cur.apply(this, arguments);
      safe(function () {
        var a = (window._heroTodayList || [])[i] || {};
        persistPick(a.name, a.dob);
        S.set(7, 'run'); S.set(7, 'ok');
      });
      return r;
    };
    w.__t3Wrapped = 1; w.__t3Orig = cur;
    window._heroPickPatient = w;
    wrapped.push(['_heroPickPatient', function () { if (window._heroPickPatient === w) window._heroPickPatient = cur; }]);
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
      var inStore = Cal.rows({ date: v.date, all: true }).some(function (a) { return nameKey(a.name) === nameKey(v.name); });
      if (!inStore) { lsDel('mlsSelPt3'); return; }                         /* patient no longer on today -> clear */
      var nm = $('heroPtName'), db = $('heroPtDob');
      if (nm && !String(nm.value || '').trim()) {                           /* only fill an EMPTY box: never clobber typing */
        nm.value = v.name; if (db && v.dob && !String(db.value || '').trim()) db.value = v.dob;
        safe(function () { if (isFn(window._heroSyncName)) window._heroSyncName(); });
        S.set(7, 'run'); S.set(7, 'ok');
      }
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
      '#mlsT3Roster .t3r-cap{font-size:11px;font-weight:800;letter-spacing:.06em;color:#8a9cb2;text-transform:uppercase;margin-right:2px}',
      '#mlsT3Roster .t3r-chip{font:600 12.5px/1 system-ui,sans-serif;color:#204034;background:#fff;border:1px solid #d5e2f2;border-radius:999px;padding:7px 12px;cursor:pointer;white-space:nowrap}',
      '#mlsT3Roster .t3r-chip b{font-weight:800;margin-left:3px;color:#2E6A4B}',
      '#mlsT3Roster .t3r-chip:hover{border-color:#C9DCD2;background:#f3f8ff}',
      '#mlsT3Roster .t3r-chip.t3r-on{background:#2E6A4B;border-color:#2E6A4B;color:#fff}',
      '#mlsT3Roster .t3r-chip.t3r-on b{color:#fff}',
      '#mlsT3Roster .t3r-rf{margin-left:auto;font:600 12px/1 system-ui,sans-serif;color:#204034;background:#EAF1EE;border:1px solid #cfe0f5;border-radius:8px;padding:7px 11px;cursor:pointer}',
      /* calendar smart empty card */
      '#mlsT3Empty{grid-column:1/-1;margin:4px 0 12px;padding:16px 18px;border:1px dashed #c9d9f0;border-radius:12px;background:#f7faff;color:#204034;font:500 13px/1.5 system-ui,sans-serif}',
      '#mlsT3Empty .t3e-t{font-size:14px;color:#1E2B24}',
      '#mlsT3Empty .t3e-s{margin-top:3px;color:#5b7186;font-size:12.5px}',
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
      /* retire the duplicated surfaces (reversible: remove this style tag) */
      '#mlsQpAll{display:none!important}',
      '#mlsCalRoster{display:none!important}',
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
    safe(function () { if (isFn(window.renderCalendar) && $('calendarView') && $('calendarView').offsetParent !== null) window.renderCalendar(); });
    safe(renderRoster);
    safe(glanceNote);
    safe(function () { feedSelector(true); });
    safe(augmentHero);
  }
  var lastStoreSig = '', lastDate = '', lastCalVis = false;
  function tick() {
    if (destroyed) return;
    injectCSS();
    retireCompetitors();
    ensureWraps();
    wrapHeroRender();
    wrapHeroPick();
    var changed = Cal.normalize();
    var date = viewingDate();
    var calVis = !!($('calendarView') && $('calendarView').offsetParent !== null);
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
  var tickTimer = null, slowTimer = null;
  function scheduleTick(delay) {
    if (destroyed || tickTimer) return;
    tickTimer = setTimeout(function () { tickTimer = null; safe(tick); }, delay == null ? 60 : delay);
  }
  function slowPulse() {
    if (destroyed) return;
    if (!document.hidden) safe(tick);
    slowTimer = setTimeout(slowPulse, document.hidden ? 30000 : 10000);
  }
  function onReady() { scheduleTick(0); }
  function onDocumentClick(ev) {
    var chip = ev.target && ev.target.closest ? ev.target.closest('.wn-chip') : null;
    if (chip) trackedTimeouts.push(setTimeout(function () { safe(function () { var nm = $('heroPtName'); if (nm && String(nm.value || '').trim()) persistPick(nm.value.trim(), ($('heroPtDob') || {}).value || ''); S.set(7, 'run'); S.set(7, 'ok'); }); }, 120));
    scheduleTick(80);
  }
  function onDocumentInput(ev) {
    var t = ev && ev.target;
    if (!t) return;
    if (t.id === 'calProvFilter' || t.id === 'calJump' || t.type === 'date' || t.type === 'month') scheduleTick(40);
  }
  function onVisibility() { if (!document.hidden) scheduleTick(0); }
  function onFocus() { scheduleTick(0); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  try { document.addEventListener('click', onDocumentClick, true); } catch (e) {}
  try { document.addEventListener('input', onDocumentInput, true); document.addEventListener('change', onDocumentInput, true); } catch (e) {}
  try { document.addEventListener('visibilitychange', onVisibility); } catch (e) {}
  try { window.addEventListener('focus', onFocus); } catch (e) {}
  try { window.addEventListener('pageshow', onFocus); } catch (e) {}
  safe(tick);
  [400, 1200, 2500, 5000, 9000].forEach(function (ms) { trackedTimeouts.push(setTimeout(function () { safe(tick); }, ms)); });
  slowTimer = setTimeout(slowPulse, 10000);

  /* ==================== API / REVERT ====================================== */
  window.__mlsT3 = {
    installed: true,
    version: VERSION,
    cal: Cal,
    status: S,
    rerender: rerenderAll,
    revert: function () {
      destroyed = true;
      safe(function () { if (tickTimer) clearTimeout(tickTimer); if (slowTimer) clearTimeout(slowTimer); if (settleTimer) clearTimeout(settleTimer); if (stripHideTimer) clearTimeout(stripHideTimer); });
      trackedTimeouts.forEach(function (i) { safe(function () { clearTimeout(i); }); });
      safe(function () { document.removeEventListener('DOMContentLoaded', onReady); document.removeEventListener('click', onDocumentClick, true); document.removeEventListener('input', onDocumentInput, true); document.removeEventListener('change', onDocumentInput, true); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', onFocus); window.removeEventListener('pageshow', onFocus); });
      wrapped.forEach(function (p) { safe(p[1]); });
      nodes.forEach(function (id) { safe(function () { var el = $(id); if (el && el.parentNode) el.parentNode.removeChild(el); }); });
      safe(function () {                                                    /* restore pruned duplicate rows */
        var a = Cal._full || window._calAppts;
        if (Array.isArray(a) && Cal._removedDups.length) { Cal._removedDups.forEach(function (x) { a.push(x); }); Cal._removedDups = []; }
      });
      safe(function () { window.__mlsT3.installed = false; });
    }
  };
})();

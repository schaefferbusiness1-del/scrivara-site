/* =============================================================================
 * feat_mls_calpro.js -> window.__mlsCalPro  (cp-1.1.0)
 * -----------------------------------------------------------------------------
 * TASK 11 - Calendar & provider APP-SIDE logic. Fully generic: providers come
 * from the backend roster (window._calProviders) and, for the pull, from the
 * canonical Athena roster - no names/practices/IDs are hardcoded anywhere.
 *
 * Adds ON TOP of the existing live calendar (single-select #calProvFilter,
 * month/week/day views - audit 2026-07-11 SS10) without editing any base code:
 *
 *  1) MULTI-PROVIDER selection - checkbox per provider (single OR multiple;
 *     none checked = all providers). While >=1 box is checked the legacy
 *     single-select is neutralized (forced to "All" + hidden) and the base
 *     renderers are fed a pre-filtered _calAppts via a swap-call-restore
 *     wrapper around renderCalendar()/calOpenDay() - zero base edits, exact
 *     same filtering semantics (String(a.doctor_user_id)).
 *  2) DATE RANGE (from-to) + one-click FULL-MONTH select -> results list panel
 *     (the base month grid stays month-scoped; ranges spanning months render
 *     in the panel, grouped by day).
 *  3) "MONDAY PROCEDURES" / "THURSDAY PROCEDURES" views - weekday + procedure
 *     filter over the selected range (or the visible month when no range).
 *  4) UPCOMING OP-NOTE PREP FLAGGING - upcoming procedure-type appointments
 *     get a "prep op note" flag chip + a count badge. STATE + UI ONLY here
 *     (op-note drafting itself is owned by another task; nothing is wired
 *     into those files).
 *  5) PULL PLAN - ONE CALENDAR MONTH, ONE SQUARE PER DAY, run by the verified
 *     Athena engine (window.__mlsSI.pullMonth). The provider is one scope for
 *     the whole run, never a per-day choice. Every day state comes from the
 *     engine's own receipts: already-pulled days are seeded from
 *     __mlsSI.authoritativeStatusForDay, and every end state is read off the
 *     pullMonth result object (complete / retry.dates / systemicReason).
 *
 * Patient safety: read-only over the appointment store; never creates,
 * modifies, signs, or writes anything; every row keeps its own patient's
 * fields only (no cross-row merging).
 * Idempotent; additive; revert(): window.__mlsCalPro.revert(). ASCII-only.
 *
 * cp-1.0.1 (2026-07-11, verification pass): fixed provName(id) returning the
 * literal string "Provider undefined" when an appointment has no
 * doctor_user_id at all (vs. a known-but-unmatched id) - now returns
 * "No provider" for a missing/empty id, matching the "no cross-row
 * data invention" principle (found via an added edge-case test harness,
 * harness_extra.html, malformed-appointment group).
 * cp-1.0.2 (2026-07-11): the pull panel now REBUILDS its plan automatically
 * whenever the date range or provider selection changed since the plan was
 * built (signature check; never while a run is in flight) - previously a
 * stale plan for the old range/providers persisted until a manual "Rebuild
 * plan" click (found live in the harness: 62-task month plan survived a
 * switch to a 3-day range). Apply/Full-month now always shows the range
 * list view, so the button's result is visible regardless of prior view.
 * cp-1.1.0 (2026-07-28, pull-plan rework): the panel was two-dimensional and
 * ran nothing. It multiplied every planned day by every roster row - 17 of
 * which carry an empty id - so one month built 527 identical "All providers"
 * tasks and repainted all 527 on every tick; the pluggable RUNNER it awaited
 * had exactly one setter and ZERO callers, so Run marked every task "error -
 * live pull runner not connected", permanently; and the plan happily listed
 * future days the engine refuses. Replaced by ONE ENTRY PER DATE, one
 * provider scope for the whole run, and the verified engine
 * (window.__mlsSI.pullMonth) doing the pulling - same caller shape as the
 * Staff month pull, including the roster auto-stage-once retry and the
 * failed-dates-only retry. Nothing about a day is claimed that the engine's
 * own receipts do not say.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsCalPro && window.__mlsCalPro.installed) return;

  var VERSION = 'cp-1.1.0';
  var S = function (x) { return x == null ? '' : String(x); };
  var esc = (typeof window.esc === 'function') ? window.esc
    : function (s) { return S(s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateOf(a) { try { if (typeof window._calDateOf === 'function') return window._calDateOf(a); } catch (e) {} return (a && (a.appt_date || S(a.start_at).slice(0, 10))) || ''; }
  function todayIso() { var n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()); }

  /* ------------------------------ state ---------------------------------- */
  var SEL = {};              /* provider id (string) -> true; {} = all        */
  var RANGE = null;          /* {from:'YYYY-MM-DD', to:'YYYY-MM-DD'} | null   */
  var VIEW = null;           /* null | 'range' | 'mon' | 'thu'                */
  var CFG = { procRe: /fluoro|inject|\besi\b|\bmbb\b|\brfa\b|nerve\s*block|ablat|epidural|\bproc\b|procedure|surg|arthro|biopsy|aspirat|\bpre[- ]?op\b|\bpost[- ]?op\b/i };
  var STATE = { installed: true, opPrepFlags: [], lastPanel: null };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  /* ONE DIMENSION. days[] holds one entry per calendar date of ONE month:
     {date, dom, state, note, found}. state is one of
     pulled | empty | todo | running | failed | future. The provider is a
     single scope for the WHOLE run (scopeLabel), never a per-day field. */
  var PULL = {
    running: false, stopAsk: false,
    sig: '', month: '', scopeLabel: 'All providers',
    days: [], index: 0, total: 0, runDates: null,
    status: '',          /* the engine's own last onStatus line, verbatim     */
    message: '',         /* end state - only ever read off a result object    */
    detail: '', systemic: '', systemicText: '', retryDates: []
  };

  function appts() { return (window._calAppts || []); }
  function providers() { return (window._calProviders || []); }
  /* Resolve a provider entry's DISPLAY name from whatever real field carries it.
     In multi-provider practices the pull stamps the clinician name onto
     provider/provider_key/provider_raw (appointment-shaped roster rows) while
     leaving name/id empty (doctor_user_id is unpopulated). Read those real fields
     before any fallback so we never render the literal "Provider undefined".
     Order: name -> provider_raw -> provider_key -> provider -> displayName/label. */
  function provDisplay(p) {
    if (p == null) return 'No provider';
    if (typeof p === 'string') { var s = p.replace(/_/g, ' ').trim(); return s || 'No provider'; }
    var nm = p.name || p.provider_raw || p.provider_key || p.provider || p.displayName || p.label;
    nm = S(nm).replace(/_/g, ' ').trim();
    if (nm) return nm;
    return (p.id != null && p.id !== '') ? ('Provider ' + p.id) : 'No provider';
  }
  function provName(id) {
    if (id == null || id === '') return 'No provider';
    var p = providers().find(function (x) { return String(x.id) === String(id); });
    return p ? provDisplay(p) : ('Provider ' + id);
  }
  function selIds() { return Object.keys(SEL).filter(function (k) { return SEL[k]; }); }
  function selActive() { return selIds().length > 0; }

  /* --------------------------- pure filtering ---------------------------- */
  function matchProvider(a) {
    var ids = selIds();
    if (!ids.length) return true;
    return ids.indexOf(String(a.doctor_user_id || '')) >= 0;
  }
  function inRange(a, from, to) {
    var d = dateOf(a);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }
  function weekdayOf(iso) { /* 0=Sun..6=Sat; parse as LOCAL date, not UTC */
    var p = S(iso).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
  }
  function isProcedure(a) {
    return CFG.procRe.test(S(a.type) + ' ' + S(a.reason) + ' ' + S(a.title));
  }
  function effectiveRange() {
    if (RANGE) return RANGE;
    /* default to the calendar's visible month */
    var y = (window._calYear != null) ? window._calYear : new Date().getFullYear();
    var m = (window._calMonth != null) ? window._calMonth : new Date().getMonth();
    var last = new Date(y, m + 1, 0).getDate();
    return { from: y + '-' + pad(m + 1) + '-01', to: y + '-' + pad(m + 1) + '-' + pad(last) };
  }
  function viewRows() {
    var r = effectiveRange();
    var rows = appts().filter(function (a) { return matchProvider(a) && inRange(a, r.from, r.to); });
    if (VIEW === 'mon') rows = rows.filter(function (a) { return weekdayOf(dateOf(a)) === 1 && isProcedure(a); });
    if (VIEW === 'thu') rows = rows.filter(function (a) { return weekdayOf(dateOf(a)) === 4 && isProcedure(a); });
    rows.sort(function (x, y2) { return (dateOf(x) + S(x.start_at)).localeCompare(dateOf(y2) + S(y2.start_at)); });
    return rows;
  }
  function computeOpPrep() {
    /* upcoming procedure-type appointments (today or later) within the current
       provider selection - each is a "prep op note" candidate. */
    var t0 = todayIso();
    var flags = appts().filter(function (a) {
      return matchProvider(a) && dateOf(a) >= t0 && isProcedure(a);
    }).map(function (a) {
      return { id: a.id, date: dateOf(a), name: a.name || '', type: a.type || a.reason || '', providerId: S(a.doctor_user_id || ''), provider: provName(a.doctor_user_id) };
    });
    STATE.opPrepFlags = flags;
    return flags;
  }

  /* ------------- base-renderer integration (swap-call-restore) ----------- */
  var wrapped = {};
  function swapCall(origKey, args) {
    var w = wrapped[origKey];
    if (!w) return;
    if (!selActive()) return w.orig.apply(window, args);
    var real = window._calAppts;
    try {
      window._calAppts = (real || []).filter(matchProvider);
      return w.orig.apply(window, args);
    } finally {
      window._calAppts = real;
    }
  }
  function wrapFn(key) {
    if (typeof window[key] !== 'function' || window[key].__cpWrapped) return;
    var orig = window[key];
    var w = function () { return swapCall(key, arguments); };
    w.__cpWrapped = true; w.__cpOrig = orig;
    wrapped[key] = { orig: orig };
    window[key] = w;
  }
  function neutralizeLegacySelect() {
    var pf = document.getElementById('calProvFilter');
    if (!pf) return;
    if (selActive()) { pf.value = ''; pf.style.display = 'none'; }
    else if (providers().length) { pf.style.display = ''; }
  }

  /* --------------------------------- UI ---------------------------------- */
  var CSS = 'font-size:12.5px;border:1px solid var(--line,#d8dfeb);border-radius:8px;padding:5px 9px;background:#fff;cursor:pointer';
  function el(id) { return document.getElementById(id); }
  function rerender() {
    neutralizeLegacySelect();
    try { if (typeof window.renderCalendar === 'function') window.renderCalendar(); } catch (e) {}
    renderBadge();
    if (VIEW) renderPanel();
  }
  function buildRow() {
    if (el('cpRow')) return true;
    var host = document.getElementById('calendarView');
    if (!host) return false;
    var card = host.querySelector('.card') || host;
    var anchor = el('calNewApptBox') || card.lastElementChild;
    var row = document.createElement('div');
    row.id = 'cpRow';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px;padding:10px;background:#FCFBF8;border:1px solid #E7E5DD;border-radius:12px';
    /* Editorial Calm consolidation (2026-07-13, RS#7): the provider CHECKBOX
       segment is gone — provider filtering has exactly ONE surface now (the
       calendar_polish roster chips + the native #calProvFilter select). Two
       simultaneous filter mechanisms could blank the grid + show a false
       "no appointments" state. Range/procedure/pull-plan features stay. */
    row.innerHTML =
      '<b style="font-size:12.5px">Range:</b>' +
      '<input type="date" id="cpFrom" style="' + CSS + ';cursor:auto" title="Range start date" aria-label="Range start date">' +
      '<span style="font-size:12px;color:#69758c">to</span>' +
      '<input type="date" id="cpTo" style="' + CSS + ';cursor:auto" title="Range end date" aria-label="Range end date">' +
      '<button id="cpApply" style="' + CSS + '">Apply</button>' +
      '<button id="cpMonth" style="' + CSS + '" title="Select the whole visible month">Full month</button>' +
      '<button id="cpClear" style="' + CSS + '">Clear</button>' +
      '<span style="border-left:1px solid #d9e5f7;height:20px"></span>' +
      '<button id="cpMon" style="' + CSS + '">Monday procedures</button>' +
      '<button id="cpThu" style="' + CSS + '">Thursday procedures</button>' +
      '<button id="cpList" style="' + CSS + '">All in range</button>' +
      '<span id="cpOpPrepBadge" style="display:none;background:#fff4e0;border:1px solid #ecd3a7;color:#7a5410;border-radius:999px;padding:4px 11px;font-size:12px;font-weight:700"></span>' +
      '<button id="cpPull" style="' + CSS + ';background:#eef4ff" title="Pull this month of patients from Athena, one day at a time, and retry the days that did not verify">Pull plan</button>';
    if (anchor && anchor.parentElement === card) card.insertBefore(row, anchor); else card.appendChild(row);
    var panel = document.createElement('div');
    panel.id = 'cpPanel';
    /* max-height + own scrollbar: a month of appointments used to grow this
       panel to ~30,000px, pushing the calendar grid (and every exit) thousands
       of pixels off screen - the owner's "no way back out" trap (2026-07-26).
       Bounded, the grid stays in reach and the sticky exit bar below is always
       visible however deep the list is scrolled. */
    panel.style.cssText = 'display:none;margin:0 0 12px;background:#fff;border:1px solid #d9e5f7;border-radius:12px;padding:13px;max-height:70vh;overflow:auto';
    row.parentElement.insertBefore(panel, row.nextSibling);
    /* events */
    el('cpApply').onclick = function () {
      var f = el('cpFrom').value, t = el('cpTo').value;
      if (!f || !t) { (window.toast || window.alert)('Pick both From and To dates.', 'err'); return; }
      if (f > t) { var tmp = f; f = t; t = tmp; el('cpFrom').value = f; el('cpTo').value = t; }
      RANGE = { from: f, to: t }; VIEW = 'range'; rerender();
    };
    el('cpMonth').onclick = function () {
      RANGE = null; RANGE = effectiveRange();
      el('cpFrom').value = RANGE.from; el('cpTo').value = RANGE.to;
      VIEW = 'range'; rerender();
    };
    el('cpClear').onclick = leaveView;
    el('cpMon').onclick = function () { VIEW = 'mon'; rerender(); };
    el('cpThu').onclick = function () { VIEW = 'thu'; rerender(); };
    el('cpList').onclick = function () { VIEW = 'range'; rerender(); };
    /* Opening the panel re-reads the month and the provider scope from
       scratch: a plan built for a month you have since left is a lie. */
    el('cpPull').onclick = function () { VIEW = 'pull'; if (!PULL.running) seedDays(true); renderPanel(); };
    renderProvBoxes();
    renderBadge();
    return true;
  }
  function renderProvBoxes() {
    var box = el('cpProvBox'); if (!box) return;
    var ps = providers();
    var sig = ps.length ? ps.map(function (p) {
      return String(p && p.id) + '|' + provDisplay(p) + '|' + (!!SEL[String(p && p.id)]);
    }).join('||') : '(empty)';
    /* cp-1.0.3 FREEZE FIX: this can run from a body-subtree observer while the
       Calendar DOM is arriving late. The old unconditional write fed that
       observer again; a stable signature makes every reapply a no-op. */
    if (box.getAttribute('data-cp-sig') === sig) return;
    box.setAttribute('data-cp-sig', sig);
    if (!ps.length) { box.innerHTML = '<span style="font-size:12px;color:#69758c">(no providers loaded)</span>'; return; }
    box.innerHTML = ps.map(function (p) {
      var id = esc(String(p.id));
      var on = !!SEL[String(p.id)];
      return '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer">' +
        '<input type="checkbox" data-cp-prov="' + id + '"' + (on ? ' checked' : '') + '> ' + esc(provDisplay(p)) + '</label>';
    }).join('');
    box.querySelectorAll('input[data-cp-prov]').forEach(function (cb) {
      cb.onchange = function () {
        var id = cb.getAttribute('data-cp-prov');
        if (cb.checked) SEL[id] = true; else delete SEL[id];
        rerender();
      };
    });
  }
  function renderBadge() {
    var b = el('cpOpPrepBadge'); if (!b) return;
    var flags = computeOpPrep();
    if (!flags.length) { b.style.display = 'none'; return; }
    b.style.display = '';
    b.textContent = '⚑ ' + flags.length + ' upcoming procedure' + (flags.length === 1 ? '' : 's') + ' to prep op notes for';
  }

  /* ------------------------------ list panel ------------------------------ */
  /* ONE exit for every panel view, owned by the panel itself. The old exit
     ("Clear") lives in #cpRow, which "Hide more calendar tools" collapses -
     measured live at b705: hiding the tools while the list was open left a
     30,729px list on screen with ZERO visible exit anywhere (the shell's
     "Back to the calendar" proxy also died, because it requires a VISIBLE
     Clear). The panel must never depend on another container for its way out. */
  function leaveView() {
    RANGE = null; VIEW = null;
    var f = el('cpFrom'), t = el('cpTo');
    if (f) f.value = ''; if (t) t.value = '';
    var p = el('cpPanel'); if (p) p.style.display = 'none';
    rerender();
  }
  function exitBar(label) {
    return '<div style="position:sticky;top:-13px;z-index:2;display:flex;align-items:center;gap:10px;' +
      'background:#fff;margin:-13px -13px 10px;padding:10px 13px;border-bottom:1px solid #E7E5DD">' +
      '<button id="cpPanelBack" style="' + CSS + ';background:#F1F6F3;font-weight:700">‹ Back to the calendar</button>' +
      (label ? '<span style="font-size:12px;color:#69758c">' + label + '</span>' : '') + '</div>';
  }
  function wireExit() {
    var b = el('cpPanelBack');
    if (b) b.onclick = leaveView;
  }
  function renderPanel() {
    var p = el('cpPanel'); if (!p) return;
    p.style.display = '';
    if (VIEW === 'pull') { renderPullPanel(p); return; }
    var r = effectiveRange();
    var rows = viewRows();
    var title = VIEW === 'mon' ? 'Monday procedures' : VIEW === 'thu' ? 'Thursday procedures' : 'Appointments';
    var provTxt = selActive() ? selIds().map(provName).join(', ') : 'All providers';
    var h = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">' +
      '<b style="font-size:14px">' + esc(title) + '</b>' +
      '<span style="font-size:12px;color:#69758c">' + esc(r.from) + ' → ' + esc(r.to) + ' · ' + esc(provTxt) + ' · ' + rows.length + ' appointment' + (rows.length === 1 ? '' : 's') + '</span></div>';
    if (!rows.length) {
      h += '<div style="font-size:12.5px;color:#69758c;padding:8px 0">Nothing scheduled that matches — no appointments were invented.</div>';
    } else {
      var t0 = todayIso(); var byDay = {};
      rows.forEach(function (a) { var k = dateOf(a); (byDay[k] = byDay[k] || []).push(a); });
      Object.keys(byDay).sort().forEach(function (day) {
        var wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayOf(day)];
        h += '<div style="font-weight:800;font-size:12.5px;margin:9px 0 4px">' + esc(wd) + ' ' + esc(day) + '</div>';
        byDay[day].forEach(function (a) {
          var tm = S(a.start_at).slice(11, 16) || '';
          var flag = (dateOf(a) >= t0 && isProcedure(a)) ? ' <span style="background:#fff4e0;border:1px solid #ecd3a7;color:#7a5410;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700">⚑ prep op note</span>' : '';
          h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12.5px;padding:4px 0;border-bottom:1px dashed #edf1f8">' +
            '<span style="color:#69758c;min-width:44px">' + esc(tm) + '</span>' +
            '<b>' + esc(a.name || '(no name)') + '</b>' +
            '<span>' + esc(a.type || a.reason || '') + '</span>' +
            '<span style="color:#69758c">· ' + esc(provName(a.doctor_user_id)) + '</span>' + flag + '</div>';
        });
      });
    }
    p.innerHTML = exitBar() + h;
    wireExit();
    STATE.lastPanel = { view: VIEW, count: rows.length, from: r.from, to: r.to };
  }

  /* ------------------------- month pull: one day, one square ---------------
     The engine is the only thing that pulls. This module owns the month
     model, the squares, and the honest reading of what came back. It never
     invents a day state: a square is green only because
     __mlsSI.authoritativeStatusForDay said available, or because the
     pullMonth result said that day was complete. */
  function SI() { try { return window.__mlsSI || null; } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }
  function num(v) { var n = Number(v || 0); return isFinite(n) ? n : 0; }
  function engineReady() { var si = SI(); return !!(si && isFn(si.pullMonth) && isFn(si._resolveProviderRequest)); }
  function monthKeyNow() {
    /* the month the calendar is showing (or the month a picked range starts
       in) - the pull is month-shaped because the engine's month route is. */
    var r = RANGE ? RANGE : effectiveRange();
    var k = S(r && r.from).slice(0, 7);
    return /^\d{4}-\d{2}$/.test(k) ? k : todayIso().slice(0, 7);
  }
  function monthLabel(ym) {
    var p = S(ym).split('-'), mi = Number(p[1]) - 1;
    return (MONTHS[mi] ? MONTHS[mi] + ' ' + p[0] : S(ym));
  }
  function monthLength(ym) {
    var p = S(ym).split('-');
    return new Date(Number(p[0]), Number(p[1]), 0).getDate() || 31;
  }
  /* ONE provider for the WHOLE run. Default is every provider; a chosen
     calendar provider is resolved through the canonical roster so the engine
     receives a verified identity rather than a display string. */
  function pullScope() {
    var pf = el('calProvFilter');
    var fval = pf ? S(pf.value) : '';
    if (!fval) return { request: 'all', label: 'All providers', key: 'all' };
    var roster = null; try { roster = window.__mlsProviderRoster; } catch (e) {}
    var entry = null;
    if (roster && isFn(roster.resolve)) { try { entry = roster.resolve(fval); } catch (e2) { entry = null; } }
    if (entry && entry.name) return { request: entry, label: S(entry.name), key: S(entry.stableKey || entry.name) };
    /* Unresolvable pick: hand the raw value to the engine gate, which refuses
       it by name. Widening to "everyone" here would pull charts nobody asked
       for, so the honest move is to let the gate say no. */
    return { request: fval, label: provName(fval), key: 'raw:' + fval };
  }
  function dayEntry(date) {
    var d = S(date);
    for (var i = 0; i < PULL.days.length; i++) if (PULL.days[i].date === d) return PULL.days[i];
    return null;
  }
  function seedDays(force) {
    var ym = monthKeyNow(), scope = pullScope();
    var sig = ym + '|' + scope.key;
    if (!force && PULL.sig === sig && PULL.days.length) return PULL.days;
    if (PULL.running) return PULL.days;
    var si = SI();
    /* the engine decides which dates are pullable at all - it clamps the month
       to today, so future days never enter a run it would refuse. */
    var keys = (si && isFn(si._monthDateKeys)) ? (function () { try { return si._monthDateKeys(ym) || []; } catch (e) { return []; } })() : [];
    var pullable = {};
    keys.forEach(function (k) { pullable[S(k)] = 1; });
    var last = monthLength(ym), days = [], d, iso, st;
    for (d = 1; d <= last; d++) {
      iso = ym + '-' + pad(d);
      var e = { date: iso, dom: d, state: 'future', note: '', found: 0 };
      if (pullable[iso]) {
        st = null;
        if (si && isFn(si.authoritativeStatusForDay)) {
          try { st = si.authoritativeStatusForDay(iso, scope.request); } catch (e3) { st = null; }
        }
        if (st && st.available === true) { e.state = 'pulled'; e.found = num(st.sourceCount); }
        else e.state = 'todo';
      }
      days.push(e);
    }
    PULL.sig = sig; PULL.month = ym; PULL.days = days;
    PULL.scopeLabel = scope.label;
    PULL.index = 0; PULL.total = 0;
    PULL.status = ''; PULL.message = ''; PULL.detail = '';
    PULL.systemic = ''; PULL.systemicText = ''; PULL.retryDates = [];
    return days;
  }
  function dayCounts() {
    var c = { pulled: 0, empty: 0, todo: 0, running: 0, failed: 0, future: 0 };
    PULL.days.forEach(function (e) { c[e.state] = (c[e.state] || 0) + 1; });
    c.done = c.pulled + c.empty;
    c.left = c.todo + c.failed + c.running;
    c.pullable = c.done + c.left;
    return c;
  }
  function datesLeft() {
    return PULL.days.filter(function (e) { return e.state === 'todo' || e.state === 'failed'; })
      .map(function (e) { return e.date; });
  }
  function datesAll() {
    return PULL.days.filter(function (e) { return e.state !== 'future'; })
      .map(function (e) { return e.date; });
  }
  function dayTitle(e) {
    if (e.state === 'future') return e.date + ' - not yet';
    if (e.state === 'running') return e.date + ' - pulling now';
    if (e.state === 'pulled') return e.date + ' - pulled and verified' + (e.found ? (' (' + e.found + ' appointment' + (e.found === 1 ? '' : 's') + ')') : '') + '. Click to pull it again.';
    if (e.state === 'empty') return e.date + ' - verified empty, nothing was scheduled. Click to pull it again.';
    if (e.state === 'failed') return e.date + ' - did not verify' + (e.note ? (': ' + e.note) : '') + '. Click to retry this day.';
    return e.date + ' - not pulled yet. Click to pull this day.';
  }

  /* ------------------------------ pull painting --------------------------- */
  var SQ = 'width:34px;height:30px;padding:0;border-radius:8px;font-size:12px;font-weight:700;line-height:1;' +
    'display:inline-flex;align-items:center;justify-content:center;';
  function squareCss(state) {
    if (state === 'pulled') return SQ + 'background:#2E6A4B;border:1px solid #2E6A4B;color:#fff;cursor:pointer';
    if (state === 'empty') return SQ + 'background:#F1F2F6;border:1px solid #DDE1EA;color:#69758C;cursor:pointer';
    if (state === 'running') return SQ + 'background:#FFF4E0;border:1px solid #ECD3A7;color:#7A5410;cursor:default;animation:cpPulse 1.1s ease-in-out infinite';
    if (state === 'failed') return SQ + 'background:#FDECEC;border:1px solid #E4A9A9;color:#8E2F2F;cursor:pointer';
    if (state === 'future') return SQ + 'background:#fff;border:1px dashed #E7E5DD;color:#C4CAD6;cursor:default';
    return SQ + 'background:#fff;border:1px solid #C9D4E6;color:#42506B;cursor:pointer';
  }
  function ensurePullCss() {
    if (el('cpPullCss')) return;
    try {
      var st = document.createElement('style');
      st.id = 'cpPullCss';
      st.textContent = '@keyframes cpPulse{0%,100%{opacity:1}50%{opacity:.45}}';
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }
  function pullPanel() { var p = el('cpPanel'); return (p && VIEW === 'pull') ? p : null; }
  function paintDay(e) {
    var p = pullPanel(); if (!p) return;
    var b = p.querySelector('button[data-cp-day="' + e.date + '"]'); if (!b) return;
    var sig = e.state + '|' + e.note + '|' + (PULL.running ? 'run' : 'idle');
    /* ONE square, only when that square actually changed. The old panel
       rebuilt every task box on every tick. */
    if (b.getAttribute('data-cp-sig') === sig) return;
    b.setAttribute('data-cp-sig', sig);
    b.style.cssText = squareCss(e.state);
    b.title = dayTitle(e);
    b.setAttribute('aria-label', dayTitle(e));
    b.disabled = (e.state === 'future' || e.state === 'running' || PULL.running);
  }
  function setDayState(e, state, note) {
    if (!e) return;
    e.state = state; e.note = S(note || '');
    paintDay(e);
  }
  function headHtml() {
    var c = dayCounts(), mt = monthLabel(PULL.month);
    var h = '<b style="font-size:14px">Pull patients from Athena &mdash; ' + esc(mt) + '</b>' +
      '<div style="font-size:12px;color:#69758c;margin-top:3px">' + esc(PULL.scopeLabel) +
      ' &middot; ' + PULL.days.length + ' day' + (PULL.days.length === 1 ? '' : 's') + ' in this month</div>';
    if (PULL.running) {
      h += '<div style="font-size:12.5px;font-weight:700;margin-top:6px">Pulling ' + esc(mt) +
        (PULL.index && PULL.total ? (' &hellip; day ' + PULL.index + ' of ' + PULL.total) : ' &hellip; starting') + '</div>';
    } else {
      h += '<div style="font-size:12.5px;margin-top:6px">' +
        '<b>' + c.done + '</b> already pulled &middot; <b>' + c.left + '</b> still to pull' +
        (c.future ? (' &middot; <b>' + c.future + '</b> not here yet') : '') + '</div>';
    }
    return h;
  }
  function pct() {
    if (PULL.running) return PULL.total ? Math.round(100 * PULL.index / PULL.total) : 0;
    var c = dayCounts();
    return c.pullable ? Math.round(100 * c.done / c.pullable) : 0;
  }
  function actionsHtml() {
    if (!engineReady()) {
      return '<span style="font-size:12.5px;color:#69758c">The Athena pull engine is still loading. Give it a moment.</span>';
    }
    /* Each label is a literal in the markup, never a ternary spliced into the
       tag: the control inventory (and the shell that proxies controls BY
       LABEL) reads this source text, and a label built out of an expression
       records as unaddressable punctuation. */
    var stopTitle = ' title="Athena finishes the day it is already on. Nothing new is started after this run."';
    if (PULL.running) {
      if (PULL.stopAsk) return '<button id="cpPullStop" style="' + CSS + '" disabled' + stopTitle + '>Stopping after this day</button>';
      return '<button id="cpPullStop" style="' + CSS + '"' + stopTitle + '>Stop after this day</button>';
    }
    var c = dayCounts();
    if (!c.pullable) return '<span style="font-size:12.5px;color:#69758c">' + esc(monthLabel(PULL.month)) + ' has not happened yet.</span>';
    return '<button id="cpPullRest" style="' + CSS + ';background:#e7f6ee;font-weight:700"' + (c.left ? '' : ' disabled') +
      '>Pull the rest of ' + esc(monthLabel(PULL.month)) + '</button>' +
      '<button id="cpPullAll" style="' + CSS + '" title="Pull every day of this month again, including the days already verified">Re-pull everything</button>';
  }
  function endHtml() {
    if (PULL.running || !PULL.message) return '';
    var n = PULL.retryDates.length;
    var h = '<div style="margin-top:12px;padding:10px 12px;background:#FCFBF8;border:1px solid #E7E5DD;border-radius:10px;font-size:12.5px">' +
      '<b>' + esc(PULL.message) + '</b>';
    if (PULL.systemic && PULL.systemicText) h += '<div style="margin-top:4px;color:#7a5410">' + esc(PULL.systemicText) + '</div>';
    if (PULL.detail) h += '<div style="margin-top:4px;color:#69758c">' + esc(PULL.detail) + '</div>';
    if (n) {
      h += '<div style="margin-top:8px">' +
        (PULL.systemic
          ? ('<button id="cpPullRetry" style="' + CSS + '">Retry the remaining ' + n + '</button>')
          : ('<button id="cpPullRetry" style="' + CSS + '">Retry those ' + n + ' day' + (n === 1 ? '' : 's') + '</button>')) +
        '</div>';
    }
    return h + '</div>';
  }
  function stripHtml() {
    return PULL.days.map(function (e) {
      var t = esc(dayTitle(e));
      var sig = e.state + '|' + e.note + '|' + (PULL.running ? 'run' : 'idle');
      return '<button data-cp-day="' + esc(e.date) + '" data-cp-sig="' + esc(sig) + '" title="' + t + '" aria-label="' + t + '"' +
        (e.state === 'future' || e.state === 'running' || PULL.running ? ' disabled' : '') +
        ' style="' + squareCss(e.state) + '">' + e.dom + '</button>';
    }).join('');
  }
  function legendHtml() {
    return '<div style="margin-top:8px;font-size:11.5px;color:#69758c">' +
      'Green = pulled and verified &middot; grey = verified empty &middot; outline = still to pull &middot; ' +
      'red = did not verify (click it to retry that day) &middot; faint = not here yet</div>';
  }
  /* Header, bar and status only - the strip and the buttons are left alone,
     so a status tick never rebuilds 31 squares or drops their wiring. */
  function paintHead() {
    var p = pullPanel(); if (!p) return;
    var head = el('cpPullHead'); if (head) head.innerHTML = headHtml();
    var fill = el('cpPullFill'); if (fill) fill.style.width = pct() + '%';
    var st = el('cpPullStatus'); if (st) st.textContent = PULL.status;
  }
  function renderPullPanel(p) {
    seedDays(false);
    ensurePullCss();
    var h = '<div id="cpPullHead" style="margin-bottom:8px">' + headHtml() + '</div>' +
      '<div style="height:10px;background:#eef1f7;border-radius:999px;overflow:hidden;margin:4px 0 8px">' +
      '<div id="cpPullFill" style="height:100%;width:' + pct() + '%;background:#2E6A4B;transition:width .3s"></div></div>' +
      '<div id="cpPullStatus" style="font-size:12px;color:#69758c;min-height:15px;margin-bottom:9px"></div>' +
      '<div id="cpPullActions" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:11px">' + actionsHtml() + '</div>' +
      '<div id="cpPullStrip" style="display:flex;flex-wrap:wrap;gap:4px">' + stripHtml() + '</div>' +
      legendHtml() +
      '<div id="cpPullEnd">' + endHtml() + '</div>';
    p.innerHTML = exitBar(PULL.running ? 'The pull keeps running while you look around.' : '') + h;
    wireExit();
    var st = el('cpPullStatus'); if (st) st.textContent = PULL.status;
    var rest = el('cpPullRest'); if (rest) rest.onclick = function () { startPull(datesLeft()); };
    var all = el('cpPullAll'); if (all) all.onclick = function () { startPull(datesAll()); };
    var stop = el('cpPullStop'); if (stop) stop.onclick = function () { PULL.stopAsk = true; askedToStop(); };
    var ret = el('cpPullRetry'); if (ret) ret.onclick = function () { startPull(PULL.retryDates.slice()); };
    p.querySelectorAll('button[data-cp-day]').forEach(function (b) {
      b.onclick = function () {
        if (PULL.running) return;
        var e = dayEntry(b.getAttribute('data-cp-day'));
        if (e && e.state !== 'future') startPull([e.date]);
      };
    });
    STATE.lastPanel = { view: 'pull', month: PULL.month, days: PULL.days.length, running: !!PULL.running };
  }
  function askedToStop() {
    /* pullMonth has no cancel: the days it already holds finish. Say that
       plainly instead of showing a button that pretends otherwise. */
    PULL.status = 'Stopping - Athena finishes the day it is on, and MLS starts nothing new after this run.';
    var act = el('cpPullActions'); if (act) act.innerHTML = actionsHtml();
    paintHead();
  }

  /* -------------------------------- the run ------------------------------- */
  /* The engine keeps its systemic sentences private, but its own final status
     line carries the one that matters. Quote the engine; never restate it. */
  var SYS_RE = /every day was failing the same way:\s*([\s\S]*?)(?:\s*Fix that first|$)/;
  var DAY_RE = /^Month pull\s+(\d+)\s*\/\s*(\d+):\s*(\d{4}-\d{2}-\d{2})/;
  function onEngineStatus(msg) {
    var m = S(msg);
    PULL.status = m;
    var sys = SYS_RE.exec(m);
    if (sys && S(sys[1]).trim()) PULL.systemicText = S(sys[1]).trim();
    var hit = DAY_RE.exec(m);
    if (hit) {
      var prev = PULL.runDates && PULL.runDates[Number(hit[1]) - 2];
      PULL.index = Number(hit[1]); PULL.total = Number(hit[2]);
      /* the day that just ended: re-read the engine's own snapshot rather
         than guessing an outcome it has not reported yet. */
      if (prev) refreshDay(prev);
      var cur = dayEntry(hit[3]);
      if (cur) setDayState(cur, 'running', '');
    }
    paintHead();
  }
  function refreshDay(date) {
    var e = dayEntry(date); if (!e) return;
    var si = SI(), st = null;
    if (si && isFn(si.authoritativeStatusForDay)) {
      try { st = si.authoritativeStatusForDay(e.date, pullScope().request); } catch (err) { st = null; }
    }
    if (st && st.available === true) { e.found = num(st.sourceCount); setDayState(e, 'pulled', ''); }
    else setDayState(e, 'todo', '');
  }
  function startPull(dates) {
    if (PULL.running) return;
    if (!engineReady()) {
      PULL.message = 'The Athena pull engine is still loading. Give it a moment.';
      PULL.detail = ''; PULL.retryDates = []; PULL.systemic = '';
      var p0 = pullPanel(); if (p0) renderPullPanel(p0);
      return;
    }
    seedDays(false);
    var targets = (dates || []).filter(function (d) { var e = dayEntry(d); return !!e && e.state !== 'future'; });
    if (!targets.length) {
      PULL.message = 'Nothing to pull in ' + monthLabel(PULL.month) + ' right now.';
      PULL.detail = ''; PULL.retryDates = []; PULL.systemic = '';
      var p1 = pullPanel(); if (p1) renderPullPanel(p1);
      return;
    }
    PULL.running = true; PULL.stopAsk = false;
    PULL.runDates = targets.slice();
    PULL.index = 0; PULL.total = targets.length;
    PULL.message = ''; PULL.detail = ''; PULL.systemic = ''; PULL.systemicText = ''; PULL.retryDates = [];
    PULL.status = 'Starting the verified Athena pull...';
    targets.forEach(function (d) { var e = dayEntry(d); if (e) { e.found = 0; e.state = 'todo'; e.note = ''; } });
    var p = pullPanel(); if (p) renderPullPanel(p);
    runWithGate(targets, false);
  }
  function finishRun() {
    PULL.running = false; PULL.stopAsk = false; PULL.runDates = null;
    var p = pullPanel(); if (p) renderPullPanel(p);
  }
  function runWithGate(targets, rosterRetried) {
    var si = SI();
    if (!(si && isFn(si.pullMonth) && isFn(si._resolveProviderRequest))) {
      PULL.message = 'The Athena pull engine is still loading. Give it a moment.';
      finishRun(); return;
    }
    var scope = pullScope();
    PULL.scopeLabel = scope.label;
    var gate = null;
    try { gate = si._resolveProviderRequest(scope.request, { allowAll: true, requireRosterForAll: true }); } catch (e) { gate = null; }
    if (!gate || !gate.ok) {
      /* Never tell the doctor to stage Athena by hand. Drive the Day schedule
         ourselves through the engine's own read-only warm-up, re-read the
         roster, and retry the gate ONCE. The manual sentence only appears if
         that automatic attempt still cannot verify it. */
      if (!rosterRetried && isFn(si._warmUpDay)) {
        PULL.status = 'Setting up Athena automatically - opening the Day schedule to verify your provider roster.';
        paintHead();
        Promise.resolve(safeCall(function () { return si._warmUpDay(todayIso(), function (m) { PULL.status = S(m); paintHead(); }); }))
          .then(null, function () { return null; })
          .then(function () { runWithGate(targets, true); });
        return;
      }
      PULL.message = S(gate && gate.error) || 'The Athena provider roster is not verified yet.';
      PULL.detail = 'MLS tried to verify it automatically but could not read the Athena Day schedule. Check that athenaOne is signed in, then try again.';
      finishRun(); return;
    }
    var month = PULL.month;
    Promise.resolve(si.pullMonth({
      month: month,
      dates: targets,
      provider: gate.provider,
      includeHistory: true,
      onStatus: function (m) { onEngineStatus(m); }
    })).then(function (res) { readResult(res); }, function (err) {
      PULL.message = 'The pull stopped safely.';
      PULL.detail = S(err && err.message || err || 'Try again when Athena is ready.');
      PULL.retryDates = targets.slice();
      targets.forEach(function (d) { setDayState(dayEntry(d), 'failed', 'the pull stopped before this day was verified'); });
      finishRun();
    });
  }
  function safeCall(fn) { try { return fn(); } catch (e) { return null; } }
  /* EVERY end state below is read off the result object. Nothing here counts
     stamps, and nothing here says "done" on our own authority. */
  function readResult(res) {
    res = res || {};
    var totals = res.totals || {}, retry = res.retry || {};
    PULL.retryDates = Array.isArray(retry.dates) ? retry.dates.slice() : [];
    PULL.systemic = S(res.systemicReason || '');
    (Array.isArray(res.days) ? res.days : []).forEach(function (d) {
      var e = dayEntry(d && d.date); if (!e) return;
      if (d.complete === true) {
        setDayState(e, (d.reason === 'empty-day' || d.reason === 'provider-empty') ? 'empty' : 'pulled', '');
      } else {
        setDayState(e, 'failed', S(d.reason || '').replace(/-/g, ' '));
      }
    });
    var mt = monthLabel(PULL.month);
    var doneN = num(totals.completeDays), dayN = num(totals.days) || PULL.total;
    PULL.detail = 'Schedule ' + num(totals.scheduleAccounted) + '/' + num(totals.scheduleAttempted) +
      ' - histories ' + num(totals.historiesProcessed) + '/' + num(totals.historiesRequested) + '.';
    if (res.complete === true) {
      PULL.message = mt + ' is complete.';
      PULL.detail = doneN + ' of ' + dayN + ' days verified. ' + PULL.detail;
    } else if (PULL.systemic) {
      PULL.message = 'Stopped early - every day was failing the same way.';
      if (!PULL.systemicText) PULL.systemicText = PULL.systemic.replace(/-/g, ' ');
    } else if (PULL.retryDates.length) {
      PULL.message = doneN + ' of ' + dayN + ' days done. ' + PULL.retryDates.length + ' need another try.';
    } else {
      PULL.message = doneN + ' of ' + dayN + ' days verified.';
    }
    finishRun();
  }
  /* Kept for external callers that ask which days still need attention. */
  function skipped() {
    return PULL.days.filter(function (e) { return e.state === 'failed'; });
  }

  /* ------------------------------ self-test ------------------------------- */
  function selfTest() {
    var fails = [];
    var realA = window._calAppts, realP = window._calProviders, realSel = SEL, realRange = RANGE, realView = VIEW;
    try {
      window._calProviders = [{ id: 1, name: 'Dr. A' }, { id: 2, name: 'B' }];
      window._calAppts = [
        { id: 1, name: 'P1', appt_date: '2026-07-06', start_at: '2026-07-06T09:00:00', type: 'fluoro non sedation', doctor_user_id: 1 }, /* Mon, proc */
        { id: 2, name: 'P2', appt_date: '2026-07-06', start_at: '2026-07-06T10:00:00', type: 'est15', doctor_user_id: 2 },              /* Mon, not proc */
        { id: 3, name: 'P3', appt_date: '2026-07-09', start_at: '2026-07-09T11:00:00', type: 'L4-5 ESI injection', doctor_user_id: 1 }, /* Thu, proc */
        { id: 4, name: 'P4', appt_date: '2026-07-15', start_at: '2026-07-15T08:00:00', type: 'surgery follow-up', doctor_user_id: 2 }
      ];
      SEL = {}; RANGE = { from: '2026-07-01', to: '2026-07-31' };
      VIEW = 'mon'; if (viewRows().length !== 1 || viewRows()[0].id !== 1) fails.push('mon-proc');
      VIEW = 'thu'; if (viewRows().length !== 1 || viewRows()[0].id !== 3) fails.push('thu-proc');
      VIEW = 'range'; if (viewRows().length !== 4) fails.push('range-all');
      SEL = { '1': true }; if (viewRows().length !== 2) fails.push('multi-1');
      SEL = { '1': true, '2': true }; if (viewRows().length !== 4) fails.push('multi-2');
      SEL = {}; RANGE = { from: '2026-07-07', to: '2026-07-10' }; VIEW = 'range';
      if (viewRows().length !== 1) fails.push('range-narrow');
      if (weekdayOf('2026-07-06') !== 1 || weekdayOf('2026-07-09') !== 4) fails.push('weekday');
      if (!isProcedure({ type: 'MBB RFA' }) || isProcedure({ type: 'est15' })) fails.push('proc-re');
      /* the month model: ONE entry per date, never days x providers */
      if (monthLabel('2026-07') !== 'July 2026') fails.push('month-label');
      if (monthLength('2026-02') !== 28 || monthLength('2024-02') !== 29 || monthLength('2026-07') !== 31) fails.push('month-length');
      RANGE = { from: '2026-07-06', to: '2026-07-07' };
      if (monthKeyNow() !== '2026-07') fails.push('month-key');
      PULL.month = '2026-07'; PULL.days = [
        { date: '2026-07-01', dom: 1, state: 'pulled', note: '', found: 3 },
        { date: '2026-07-02', dom: 2, state: 'empty', note: '', found: 0 },
        { date: '2026-07-03', dom: 3, state: 'todo', note: '', found: 0 },
        { date: '2026-07-04', dom: 4, state: 'failed', note: 'signin', found: 0 },
        { date: '2026-07-05', dom: 5, state: 'future', note: '', found: 0 }
      ];
      var c = dayCounts();
      if (c.done !== 2 || c.left !== 2 || c.future !== 1 || c.pullable !== 4) fails.push('day-counts');
      if (datesLeft().join(',') !== '2026-07-03,2026-07-04') fails.push('dates-left');
      if (datesAll().length !== 4) fails.push('dates-all');
      if (skipped().length !== 1) fails.push('skipped');
      if (!dayEntry('2026-07-04') || dayEntry('2026-07-09')) fails.push('day-entry');
      if (dayTitle(PULL.days[4]).indexOf('not yet') < 0) fails.push('future-title');
      /* the engine's own systemic sentence is quoted, never restated */
      var sysLine = 'Month pull STOPPED EARLY - every day was failing the same way: ' +
        'MLS is signed out - sign in to MLS first. Fix that first, then use Retry failed days (3 days remain).';
      var sysHit = SYS_RE.exec(sysLine);
      if (!sysHit || sysHit[1].trim() !== 'MLS is signed out - sign in to MLS first.') fails.push('systemic-quote');
      var dayHit = DAY_RE.exec('Month pull 3/19: 2026-07-03');
      if (!dayHit || dayHit[1] !== '3' || dayHit[2] !== '19' || dayHit[3] !== '2026-07-03') fails.push('day-progress');
      if (provName(null) !== 'No provider' || provName('') !== 'No provider' || provName(undefined) !== 'No provider') fails.push('provname-empty');
      if (provName(1) !== 'Dr. A') fails.push('provname-known');
      if (provName(999) !== 'Provider 999') fails.push('provname-unknown');
    } catch (e) { fails.push('exception:' + S(e && e.message).slice(0, 60)); }
    finally {
      window._calAppts = realA; window._calProviders = realP; SEL = realSel; RANGE = realRange; VIEW = realView;
      PULL.days = []; PULL.sig = ''; PULL.month = ''; PULL.total = 0; PULL.index = 0;
    }
    return { pass: !fails.length, fails: fails };
  }

  /* -------------------------------- boot ---------------------------------- */
  var mo = null, stopped = false, obsTimer = null;
  function boot() {
    if (stopped) return;
    wrapFn('renderCalendar');
    wrapFn('calOpenDay');
    if (!buildRow()) return; /* calendar view not in DOM yet - observer will retry */
    renderProvBoxes();
    renderBadge();
  }
  function revert() {
    stopped = true;
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { if (obsTimer) { clearTimeout(obsTimer); obsTimer = null; } } catch (e) {}
    Object.keys(wrapped).forEach(function (k) {
      try { if (window[k] && window[k].__cpWrapped) window[k] = wrapped[k].orig; } catch (e) {}
    });
    ['cpRow', 'cpPanel', 'cpPullCss'].forEach(function (id) { try { var n = el(id); if (n) n.remove(); } catch (e) {} });
    try { var pf = el('calProvFilter'); if (pf && providers().length) pf.style.display = ''; } catch (e) {}
    window.__mlsCalPro.installed = false;
  }

  window.__mlsCalPro = {
    installed: true, version: VERSION, state: STATE, cfg: CFG,
    selProviders: function () { return selIds(); },
    clearSelection: function () { SEL = {}; try { renderProvBoxes(); } catch (e) {} try { rerender(); } catch (e) {} },
    /* setRunner is GONE: it was the only writer of a pluggable runner that had
       zero callers, so every Run ended in "live pull runner not connected".
       The run is the verified engine now - there is nothing to plug in. */
    pullRunning: function () { return !!PULL.running; },
    pullDays: function () {
      return PULL.days.map(function (e) { return { date: e.date, state: e.state, note: e.note, found: e.found }; });
    },
    pullMonthKey: function () { return PULL.month || monthKeyNow(); },
    skipped: skipped, computeOpPrep: computeOpPrep,
    viewRows: viewRows, isProcedure: isProcedure, weekdayOf: weekdayOf,
    _rerender: rerender, selfTest: selfTest, revert: revert
  };

  function armObserver() {
    try {
      mo = new MutationObserver(function (muts) {
        var row = el('cpRow'), relevant = false;
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i] && muts[i].target;
          if (row && t && (t === row || row.contains(t))) continue;
          relevant = true; break;
        }
        if (!relevant || obsTimer) return;
        obsTimer = setTimeout(function () {
          obsTimer = null;
          if (!el('cpRow')) boot(); else renderProvBoxes();
        }, 40);
      });
      var host = document.getElementById('calendarView');
      mo.observe(host || document.body, { childList: true, subtree: !host });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(); armObserver(); });
  else { boot(); armObserver(); }
})();

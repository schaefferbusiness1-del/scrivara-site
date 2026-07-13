/* =============================================================================
 * feat_mls_calpro.js -> window.__mlsCalPro  (cp-1.0.3)
 * -----------------------------------------------------------------------------
 * TASK 11 - Calendar & provider APP-SIDE logic (mock-tested; Athena-gated parts
 * stay pluggable and are NOT driven from here). Fully generic: providers come
 * from the backend roster (window._calProviders) - no names/practices/IDs are
 * hardcoded anywhere.
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
 *  5) PULL PLAN with PROGRESS UI for multi-day x multi-provider pulls,
 *     SKIPPED-DATE reporting (empty / error / timeout, with reasons) and
 *     RETRY controls (per-day + retry-all-skipped). The actual pull runner is
 *     PLUGGABLE (setRunner) and defaults to "not connected": live Athena
 *     pulls are certification-gated elsewhere; this module owns only the
 *     app-side state machine and UI, which is what gets mock-tested.
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
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsCalPro && window.__mlsCalPro.installed) return;

  var VERSION = 'cp-1.0.3';
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
  var CFG = { timeoutMs: 45000, procRe: /fluoro|inject|\besi\b|\bmbb\b|\brfa\b|nerve\s*block|ablat|epidural|\bproc\b|procedure|surg|arthro|biopsy|aspirat|\bpre[- ]?op\b|\bpost[- ]?op\b/i };
  var STATE = { installed: true, opPrepFlags: [], lastPanel: null };
  var PULL = { running: false, plan: [], done: 0, total: 0, startedAt: 0, stopAsk: false };
  var RUNNER = null;         /* async ({date, providerId, providerName}) ->
                                {ok:true, found:N} | {ok:true, found:0} |
                                throws / rejects on error; module adds timeout */

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
      '<input type="date" id="cpFrom" style="' + CSS + ';cursor:auto" title="From">' +
      '<span style="font-size:12px;color:#69758c">to</span>' +
      '<input type="date" id="cpTo" style="' + CSS + ';cursor:auto" title="To">' +
      '<button id="cpApply" style="' + CSS + '">Apply</button>' +
      '<button id="cpMonth" style="' + CSS + '" title="Select the whole visible month">Full month</button>' +
      '<button id="cpClear" style="' + CSS + '">Clear</button>' +
      '<span style="border-left:1px solid #d9e5f7;height:20px"></span>' +
      '<button id="cpMon" style="' + CSS + '">Monday procedures</button>' +
      '<button id="cpThu" style="' + CSS + '">Thursday procedures</button>' +
      '<button id="cpList" style="' + CSS + '">All in range</button>' +
      '<span id="cpOpPrepBadge" style="display:none;background:#fff4e0;border:1px solid #ecd3a7;color:#7a5410;border-radius:999px;padding:4px 11px;font-size:12px;font-weight:700"></span>' +
      '<button id="cpPull" style="' + CSS + ';background:#eef4ff" title="Plan a chart pull for the selected providers and dates (progress, skipped days, retries)">Pull plan</button>';
    if (anchor && anchor.parentElement === card) card.insertBefore(row, anchor); else card.appendChild(row);
    var panel = document.createElement('div');
    panel.id = 'cpPanel';
    panel.style.cssText = 'display:none;margin:0 0 12px;background:#fff;border:1px solid #d9e5f7;border-radius:12px;padding:13px';
    row.parentElement.insertBefore(panel, row.nextSibling);
    /* events */
    el('cpApply').onclick = function () {
      var f = el('cpFrom').value, t = el('cpTo').value;
      if (!f || !t) { alert('Pick both From and To dates.'); return; }
      if (f > t) { var tmp = f; f = t; t = tmp; el('cpFrom').value = f; el('cpTo').value = t; }
      RANGE = { from: f, to: t }; VIEW = 'range'; rerender();
    };
    el('cpMonth').onclick = function () {
      RANGE = null; RANGE = effectiveRange();
      el('cpFrom').value = RANGE.from; el('cpTo').value = RANGE.to;
      VIEW = 'range'; rerender();
    };
    el('cpClear').onclick = function () { RANGE = null; VIEW = null; el('cpFrom').value = ''; el('cpTo').value = ''; var p = el('cpPanel'); if (p) p.style.display = 'none'; rerender(); };
    el('cpMon').onclick = function () { VIEW = 'mon'; rerender(); };
    el('cpThu').onclick = function () { VIEW = 'thu'; rerender(); };
    el('cpList').onclick = function () { VIEW = 'range'; rerender(); };
    el('cpPull').onclick = function () { VIEW = 'pull'; renderPanel(); };
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
    p.innerHTML = h;
    STATE.lastPanel = { view: VIEW, count: rows.length, from: r.from, to: r.to };
  }

  /* ------------------------- pull plan state machine ---------------------- */
  function daysBetween(from, to) {
    var out = []; var p = from.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    for (var i = 0; i < 400; i++) {
      var iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      if (iso > to) break;
      out.push(iso);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  function planSigNow() {
    var r = effectiveRange();
    var ids = selActive() ? selIds() : providers().map(function (p) { return String(p.id); });
    return r.from + '|' + r.to + '|' + ids.slice().sort().join(',');
  }
  function buildPlan() {
    var r = effectiveRange();
    var ids = selActive() ? selIds() : providers().map(function (p) { return String(p.id); });
    if (!ids.length) ids = [''];
    var plan = [];
    daysBetween(r.from, r.to).forEach(function (day) {
      ids.forEach(function (id) {
        plan.push({ date: day, providerId: id, providerName: id ? provName(id) : 'All providers', status: 'pending', reason: '', found: 0, tries: 0 });
      });
    });
    PULL.plan = plan; PULL.done = 0; PULL.total = plan.length; PULL.running = false;
    PULL.sig = planSigNow();
    return plan;
  }
  function skipped() {
    return PULL.plan.filter(function (t) { return t.status === 'empty' || t.status === 'error' || t.status === 'timeout'; });
  }
  function withTimeout(prom, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
      prom.then(function (v) { if (!done) { done = true; clearTimeout(to); resolve(v); } },
        function (e) { if (!done) { done = true; clearTimeout(to); reject(e); } });
    });
  }
  async function runTask(t) {
    if (!RUNNER) { t.status = 'error'; t.reason = 'live pull runner not connected (Athena-gated)'; return; }
    t.status = 'running'; t.tries++; paintPull();
    try {
      var res = await withTimeout(Promise.resolve(RUNNER({ date: t.date, providerId: t.providerId, providerName: t.providerName })), CFG.timeoutMs);
      if (res && res.ok && (res.found || 0) > 0) { t.status = 'ok'; t.found = res.found; t.reason = ''; }
      else if (res && res.ok) { t.status = 'empty'; t.found = 0; t.reason = 'no appointments that day'; }
      else { t.status = 'error'; t.reason = S(res && res.error || 'runner refused'); }
    } catch (e) {
      var msg = S(e && e.message || e);
      t.status = (msg === 'timeout') ? 'timeout' : 'error';
      t.reason = (msg === 'timeout') ? ('no reply within ' + Math.round(CFG.timeoutMs / 1000) + 's') : msg.slice(0, 90);
    }
  }
  async function runPull(tasks) {
    if (PULL.running) return;
    PULL.running = true; PULL.stopAsk = false; PULL.startedAt = Date.now();
    var list = tasks || PULL.plan.filter(function (t) { return t.status === 'pending'; });
    for (var i = 0; i < list.length; i++) {
      if (PULL.stopAsk) { list[i].status = list[i].status === 'running' ? 'pending' : list[i].status; break; }
      await runTask(list[i]);
      PULL.done = PULL.plan.filter(function (t) { return t.status !== 'pending' && t.status !== 'running'; }).length;
      paintPull();
    }
    PULL.running = false;
    paintPull();
  }
  function paintPull() {
    var p = el('cpPanel'); if (!p || VIEW !== 'pull') return;
    renderPullPanel(p);
  }
  function renderPullPanel(p) {
    /* cp-1.0.2: a plan built for an OLD range/provider selection must never
       silently survive - rebuild when the signature changed (never mid-run). */
    if (!PULL.plan.length || (!PULL.running && PULL.sig !== planSigNow())) buildPlan();
    var r = effectiveRange();
    var doneN = PULL.plan.filter(function (t) { return t.status !== 'pending' && t.status !== 'running'; }).length;
    var okN = PULL.plan.filter(function (t) { return t.status === 'ok'; }).length;
    var pct = PULL.total ? Math.round(100 * doneN / PULL.total) : 0;
    var sk = skipped();
    var h = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">' +
      '<b style="font-size:14px">Pull plan</b>' +
      '<span style="font-size:12px;color:#69758c">' + esc(r.from) + ' → ' + esc(r.to) + ' · ' + PULL.total + ' day-provider task' + (PULL.total === 1 ? '' : 's') + '</span>' +
      '<button id="cpRun" style="' + CSS + ';background:#e7f6ee"' + (PULL.running ? ' disabled' : '') + '>' + (PULL.running ? 'Running…' : (doneN ? 'Resume' : 'Run')) + '</button>' +
      (PULL.running ? '<button id="cpStop" style="' + CSS + '">Stop after current</button>' : '') +
      '<button id="cpRebuild" style="' + CSS + '"' + (PULL.running ? ' disabled' : '') + '>Rebuild plan</button></div>';
    h += '<div style="height:10px;background:#eef1f7;border-radius:999px;overflow:hidden;margin:4px 0 10px"><div style="height:100%;width:' + pct + '%;background:#2E6A4B;transition:width .3s"></div></div>' +
      '<div style="font-size:12px;color:#69758c;margin-bottom:8px">' + doneN + ' / ' + PULL.total + ' finished · ' + okN + ' with data · ' + sk.length + ' skipped' + (RUNNER ? '' : ' · <b style="color:#a15c00">live runner not connected — Athena-gated; showing app-side plan only</b>') + '</div>';
    var byDay = {};
    PULL.plan.forEach(function (t) { (byDay[t.date] = byDay[t.date] || []).push(t); });
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px">';
    Object.keys(byDay).sort().forEach(function (day) {
      byDay[day].forEach(function (t) {
        var col = { pending: '#eef1f7', running: '#fff4e0', ok: '#e7f6ee', empty: '#f3f4f8', error: '#fdecec', timeout: '#fdecec' }[t.status] || '#eef1f7';
        var lbl = { pending: 'pending', running: 'running…', ok: 'ok · ' + t.found, empty: 'empty', error: 'error', timeout: 'timeout' }[t.status] || t.status;
        h += '<div style="border:1px solid #e2e8f4;border-radius:9px;padding:7px 9px;font-size:12px;background:' + col + '">' +
          '<b>' + esc(day) + '</b> · ' + esc(t.providerName) + '<br><span style="color:#556077">' + esc(lbl) + (t.reason ? ' — ' + esc(t.reason) : '') + '</span>' +
          ((t.status === 'error' || t.status === 'timeout' || t.status === 'empty') && !PULL.running ? ' <button data-cp-retry="' + esc(day) + '|' + esc(t.providerId) + '" style="' + CSS + ';padding:2px 8px;font-size:11px;margin-top:3px">Retry</button>' : '') +
          '</div>';
      });
    });
    h += '</div>';
    if (sk.length && !PULL.running) {
      h += '<div style="margin-top:10px;padding:9px 11px;background:#fff8f0;border:1px solid #ecd3a7;border-radius:9px;font-size:12.5px">' +
        '<b>Skipped-date report</b> — ' + sk.length + ' task' + (sk.length === 1 ? '' : 's') + ' need attention: ' +
        sk.slice(0, 12).map(function (t) { return esc(t.date) + ' (' + esc(t.providerName) + ': ' + esc(t.status) + ')'; }).join(', ') + (sk.length > 12 ? ' …' : '') +
        ' <button id="cpRetryAll" style="' + CSS + ';padding:3px 10px;font-size:11.5px">Retry all skipped</button></div>';
    }
    p.innerHTML = h;
    var run = el('cpRun'); if (run) run.onclick = function () { runPull(); };
    var stop = el('cpStop'); if (stop) stop.onclick = function () { PULL.stopAsk = true; };
    var rb = el('cpRebuild'); if (rb) rb.onclick = function () { buildPlan(); paintPull(); };
    var ra = el('cpRetryAll'); if (ra) ra.onclick = function () { var t = skipped(); t.forEach(function (x) { x.status = 'pending'; x.reason = ''; }); runPull(t); };
    p.querySelectorAll('button[data-cp-retry]').forEach(function (b) {
      b.onclick = function () {
        var kv = b.getAttribute('data-cp-retry').split('|');
        var t = PULL.plan.find(function (x) { return x.date === kv[0] && String(x.providerId) === kv[1]; });
        if (t) { t.status = 'pending'; t.reason = ''; runPull([t]); }
      };
    });
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
      if (daysBetween('2026-07-30', '2026-08-02').length !== 4) fails.push('days-cross-month');
      RANGE = { from: '2026-07-06', to: '2026-07-07' }; SEL = { '1': true, '2': true };
      buildPlan(); if (PULL.plan.length !== 4) fails.push('plan-2x2');
      PULL.plan[0].status = 'empty'; PULL.plan[1].status = 'error'; PULL.plan[2].status = 'ok';
      if (skipped().length !== 2) fails.push('skipped');
      if (provName(null) !== 'No provider' || provName('') !== 'No provider' || provName(undefined) !== 'No provider') fails.push('provname-empty');
      if (provName(1) !== 'Dr. A') fails.push('provname-known');
      if (provName(999) !== 'Provider 999') fails.push('provname-unknown');
    } catch (e) { fails.push('exception:' + S(e && e.message).slice(0, 60)); }
    finally { window._calAppts = realA; window._calProviders = realP; SEL = realSel; RANGE = realRange; VIEW = realView; PULL.plan = []; PULL.total = 0; }
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
    ['cpRow', 'cpPanel'].forEach(function (id) { try { var n = el(id); if (n) n.remove(); } catch (e) {} });
    try { var pf = el('calProvFilter'); if (pf && providers().length) pf.style.display = ''; } catch (e) {}
    window.__mlsCalPro.installed = false;
  }

  window.__mlsCalPro = {
    installed: true, version: VERSION, state: STATE, cfg: CFG,
    selProviders: function () { return selIds(); },
    clearSelection: function () { SEL = {}; try { renderProvBoxes(); } catch (e) {} try { rerender(); } catch (e) {} },
    setRunner: function (fn) { RUNNER = (typeof fn === 'function') ? fn : null; paintPull(); },
    getPlan: function () { return PULL.plan.slice(); },
    pullRunning: function () { return !!PULL.running; },
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

/* feat_mls_schedpull_fix.js  ->  window.__mlsSchedPullFix  (v1.0.0)  [item18]
 *
 * ONE honest, ONE-DAY-IN / ONE-DAY-OUT, per-doctor schedule pull. Additive, reversible, read-only.
 *
 * WHY THIS EXISTS (root cause, confirmed by reading the live prod code + module state)
 * -----------------------------------------------------------------------------------
 * The athenaOne pull was dumping the WHOLE calendar -- every provider, effectively all
 * days -- onto a single day (~117 names instead of the day's ~20), the doctor filter
 * never scoped, and the UI stacked contradictory messages ("No patients scheduled for
 * today" + "pulled all 117" + "Reload MLS Assist").
 *
 * Confirmed causes:
 *   1) COUNT / SMEAR: the pull parsed resp.TEXT (the whole picked frame's innerText, up
 *      to 22000 chars) via _parseScheduleText, which scoops up every name-like token on
 *      the page (all providers, roster + multi-day text). Those rows carry no per-row
 *      date, so the importer filed ALL of them onto one fallback day -> the whole
 *      calendar collapsed into a single day. The extension ALSO returns resp.appts --
 *      the STRUCTURED day-grid rows it scraped (each with a clock time and, when present,
 *      a provider) -- but those were used only as a fallback "if nothing parsed".
 *   2) DOCTOR FILTER: two scope layers fought each other (feat_athena_provider_picker
 *      wraps _parseScheduleText; feat_athena_provider_scope wraps _importPulledSchedule)
 *      and both tried to match TEXT-parsed names (often "First Last") against structured
 *      names ("Last, First MD"); coverage fell below their 50% threshold so both "failed
 *      safe" to pull-all and each printed its own banner.
 *   3) MESSAGES: those two banners + the assistant's own status line narrated at once.
 *
 * THE FIX (single chokepoint, web-app only -- no extension reload needed)
 * ----------------------------------------------------------------------
 *   - Capture mlsAppScheduleResult read-only (own listener; resp is never mutated/forwarded).
 *   - Wrap _parseScheduleText as the OUTERMOST layer. When the extension returned
 *     STRUCTURED rows (resp.appts with real appointment times), BUILD the parsed list
 *     from THOSE rows (name + literal clock time + provider) -- the actual day grid that
 *     is on screen -- instead of the whole-page text scrape. Scope to the chosen/logged-in
 *     doctor using the per-row provider (surname match, format-agnostic). Fall through to
 *     the original parser untouched when there are no structured rows.
 *   - ONE DAY IN / ONE DAY OUT: the assistant's day-scoped pull already passes
 *     {date, scopeDate}; by handing the importer only the on-screen day grid (not the
 *     whole-page scrape) and scoping to one provider, the day's real ~N -- not the whole
 *     roster -- land on that one day.
 *   - Be HONEST and never drop patients: if the schedule carried NO per-row provider at
 *     all, or the chosen doctor matched zero rows, keep everyone and say so ONCE.
 *   - Silence the two duplicate banners (#mlsppBanner, #mlsScopeBanner) so exactly one
 *     status (the assistant's honest line) shows. Never fabricates "connected/imported".
 *
 * The downstream importer (feat_mls_schedimport_exact __mlsSI) is unchanged: it files
 * each appointment on its EST day and SAVES it to the calendar via /api/appointments.
 *
 * SAFETY: read-only; no Athena writes; sends nothing to the extension; own IIFE;
 * try/catch throughout; idempotent; no PHI logged. Reversible:
 * window.__mlsSchedPullFix.revert().
 */
(function () {
  'use strict';
  try { if (window.__mlsSchedPullFix && window.__mlsSchedPullFix.installed) return; } catch (e) {}

  var VERSION = '1.0.0';
  var ASSET = 'feat_mls_schedpull_fix.js';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(x) { return x == null ? '' : String(x); }
  function clean(s) { return S(s).replace(/\s+/g, ' ').trim(); }

  /* ---------- provider helpers (reuse the picker's matchers when available) ---------- */
  var SUFFIX = /^(jr|sr|ii|iii|iv|v|md|do|np|pa|pac|rn|phd|esq|dr|drs|mr|mrs|ms|prof|aprn|fnp|dnp|dpm|dds|dmd|cnm|crna|od|lpc|lcsw|agnp|whnp|pmhnp|lpn|psyd|mbbs)$/;
  function tokens(raw) {
    return clean(raw).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').filter(function (t) { return t && t.length > 1 && !SUFFIX.test(t); });
  }
  function surname(name) { var t = tokens(name); if (!t.length) return ''; return t.slice().sort(function (a, b) { return b.length - a.length; })[0]; }
  function provMatch(apptProvider, target) {
    var pp = safe(function () { return window.__mlsProviderPicker; });
    if (pp && isFn(pp.provMatch)) { var r = safe(function () { return pp.provMatch(apptProvider, target); }); if (r === true || r === false) return r; }
    var ap = surname(apptProvider), tg = surname(target);
    if (!ap || !tg) return false;
    if (ap === tg) return true;
    var a = tokens(apptProvider), b = tokens(target);
    return a.filter(function (x) { return b.indexOf(x) > -1; }).length >= 2;
  }
  function detectProvider() {
    var pp = safe(function () { return window.__mlsProviderPicker; });
    if (pp && isFn(pp.detectProvider)) { var v = safe(function () { return pp.detectProvider(); }); if (v) return v; }
    var sc = safe(function () { return window.__mlsAthenaProviderScope; });
    if (sc && isFn(sc.detectProvider)) { var v2 = safe(function () { return sc.detectProvider(); }); if (v2) return v2; }
    return '';
  }
  function getPick() {
    var pp = safe(function () { return window.__mlsProviderPicker; });
    if (pp && isFn(pp.getPick)) { var v = safe(function () { return pp.getPick(); }); if (v) return v; }
    return 'mine';
  }

  /* ---------- read-only capture of the latest schedule read ---------- */
  var lastResp = null;
  function onMessage(e) {
    safe(function () {
      var d = e && e.data;
      if (!d || d.source !== 'mls-ext' || d.type !== 'mlsAppScheduleResult') return;
      lastResp = d.resp || null;   // kept in memory only; never logged or forwarded
    });
  }

  /* A structured row is a REAL appointment row only if it has a name AND a clock time.
     (Names without a time are roster/list noise -- exactly what caused the 117 count.) */
  var RT = /\b\d{1,2}:\d{2}\b/;
  function structuredRows(resp) {
    return safe(function () {
      var a = (resp && resp.appts) || [];
      var out = [];
      for (var i = 0; i < a.length; i++) {
        var nm = clean(a[i] && a[i].name);
        var tm = clean(a[i] && a[i].time);
        if (!nm) continue;
        if (!RT.test(tm)) continue;            // require a real appointment time
        out.push({ name: nm, time: tm, provider: clean(a[i].provider || ''), date: '', dob: '', reason: '' });
      }
      return out;
    }, []);
  }

  /* choose the target doctor: explicit pick, else logged-in; 'all' => no scoping */
  function chooseTarget() {
    var pick = getPick();
    if (pick === 'all') return null;
    if (pick && pick !== 'mine') return pick;
    return detectProvider() || null;
  }

  /* scope structured rows to the target doctor; never drops everyone silently.
     returns { rows, scoped, reason } */
  function scopeRows(rows, target) {
    if (!target) return { rows: rows, scoped: false, reason: 'all' };
    var tagged = rows.filter(function (r) { return r.provider; });
    if (!tagged.length) return { rows: rows, scoped: false, reason: 'no-provider' };
    var mine = rows.filter(function (r) { return r.provider && provMatch(r.provider, target); });
    if (!mine.length) return { rows: rows, scoped: false, reason: 'no-match' };
    if (mine.length === rows.length) return { rows: mine, scoped: true, reason: 'all-mine' };
    return { rows: mine, scoped: true, reason: 'scoped' };
  }

  /* ---------- the wrap around _parseScheduleText (single chokepoint) ---------- */
  var _orig = null, _wrap = null, _installed = false;
  function buildParsed(origResult) {
    // origResult: whatever the underlying (possibly picker-wrapped) parser produced.
    var rows = structuredRows(lastResp);
    // Only override when the structured day grid clearly has real appointment rows.
    if (!rows.length) return origResult;
    var target = chooseTarget();
    var sc = scopeRows(rows, target);
    // expose a tiny, PHI-free diagnostic for the status layer / verification
    safe(function () {
      window.__mlsSchedPullFix._lastScope = {
        total: rows.length, kept: sc.rows.length, scoped: sc.scoped, reason: sc.reason,
        target: target ? ('Dr. ' + (surname(target) ? surname(target).charAt(0).toUpperCase() + surname(target).slice(1) : '')) : '(all)'
      };
    });
    // return the parsed-shape rows the importer expects
    return sc.rows.map(function (r) { return { name: r.name, time: r.time, date: '', dob: '', reason: r.reason || '', provider: r.provider || '' }; });
  }
  function install() {
    if (_installed) return;
    if (!isFn(window._parseScheduleText)) return;
    if (window._parseScheduleText.__mlsSchedPullFixWrapped) { _installed = true; return; }
    _orig = window._parseScheduleText;
    _wrap = function (text) {
      var self = this, args = arguments;
      return Promise.resolve(safe(function () { return _orig.apply(self, args); }, [])).then(function (origResult) {
        return safe(function () { return buildParsed(origResult); }, origResult);
      });
    };
    _wrap.__mlsSchedPullFixWrapped = true;
    _wrap.__orig = _orig;
    window._parseScheduleText = _wrap;
    _installed = true;
  }

  /* ---------- silence the two duplicate banners (one honest status only) ---------- */
  var STYLE_ID = 'mlsSchedPullFixStyle';
  function quietBanners() {
    if (document.getElementById(STYLE_ID)) return;
    var st = safe(function () { return document.createElement('style'); });
    if (!st) return;
    st.id = STYLE_ID;
    // The assistant panel's own honest status line remains the single source of truth.
    st.textContent = '#mlsppBanner,#mlsScopeBanner{display:none !important;}';
    safe(function () { (document.head || document.documentElement).appendChild(st); });
  }

  /* ---------- boot / re-assert / revert ---------- */
  var _pollT = null;
  function boot() {
    safe(function () { window.addEventListener('message', onMessage, true); });
    install();
    quietBanners();
    var n = 0;
    _pollT = setInterval(function () { safe(install); safe(quietBanners); if (++n > 20) { clearInterval(_pollT); _pollT = null; } }, 1000);
  }
  function revert() {
    safe(function () { if (_pollT) { clearInterval(_pollT); _pollT = null; } });
    safe(function () { window.removeEventListener('message', onMessage, true); });
    safe(function () { if (_wrap && window._parseScheduleText === _wrap && _orig) window._parseScheduleText = _orig; });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { window.__mlsSchedPullFix.installed = false; });
  }

  window.__mlsSchedPullFix = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    _lastResp: function () { return lastResp; },
    _setLastResp: function (r) { lastResp = r; },        // test hook (synthetic only)
    structuredRows: structuredRows,
    chooseTarget: chooseTarget,
    scopeRows: scopeRows,
    buildParsed: buildParsed,
    provMatch: provMatch,
    detectProvider: detectProvider,
    revert: revert
  };

  safe(install);
  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); } catch (e) { safe(boot); }
})();

/* ============================================================================
 * item: route the hero "Pull today's patients" button onto TODAY's real day.
 *
 * Root cause: pullScheduleViaAssist() filed the parsed rows through the legacy
 * _importPulledSchedule path. Rows with no per-row date fall back to the date
 * PRINTED on the open athenaOne page (the open week's Saturday, e.g.
 * 2026-07-04) instead of today, so "today's" patients landed on Jul 4 and the
 * real day cell stayed empty.
 *
 * Fix: delegate that one button to window.__mlsSI.pull({date: <today EST>}).
 * pull() reads the SAME athenaOne Day schedule via MLS Assist (v1.40), scopes
 * to {date}, files each patient on today, refreshes the calendar / Today's
 * patients (hero) / Who's-Next / picker / assistant, and still pulls each
 * patient's chart history in the background.
 *
 * Scope: ONLY the hero "today" button is rerouted; the any-day picker is left
 * untouched. Single-day correctness only -- multi-day week-stepping still needs
 * the extension and is intentionally out of scope here.
 * Additive + reversible: delete this block to restore the previous behaviour.
 * ========================================================================== */
(function () {
  /* cv-1.0.0 (lane convergence 2026-07-27): the day key belongs to the
     ACCOUNT. _acctTodayKey is the one owner of account-local Today; the
     hardcoded America/New_York formatter survives only as a fallback for a
     page where that owner is not defined yet. */
  function estTodayKey() {
    try {
      if (typeof window._acctTodayKey === 'function') {
        var k = String(window._acctTodayKey() || '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return k;
      }
    } catch (e0) {}
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  var prev = window.pullScheduleViaAssist;
  function routedPull(btn) {
    try {
      var si = window.__mlsSI;
      /* cv-1.0.0: prefer the ONE guarded entry (pre-flight + account provider
         scope). A gated engine exposes pull() but never booted, so require
         installed !== false before either engine call. */
      if (si && si.installed !== false && (typeof si.dayPull === 'function' || typeof si.pull === 'function')) {
        var setS = function (m, kind) {
          var el = document.getElementById('heroPullStatus');
          if (el) { el.textContent = m; el.style.color = (kind === 'err') ? '#ffe0e0' : (kind === 'ok' ? '#d8ffe8' : 'rgba(255,255,255,.95)'); el.style.display = 'block'; }
          else { try { toast(m, kind === 'err' ? 'err' : ''); } catch (e) {} }
        };
        if (btn) { btn.disabled = true; if (!btn.dataset._t) btn.dataset._t = btn.innerHTML; btn.innerHTML = '\u2026 reading Athena'; }
        var done = function () { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset._t || btn.innerHTML; } };
        var engine = (typeof si.dayPull === 'function') ? si.dayPull : si.pull;
        return Promise.resolve(engine.call(si, { date: estTodayKey(), includeHistory: true, onStatus: setS })).then(done, done);
      }
    } catch (e) {}
    return (typeof prev === 'function') ? prev.apply(this, arguments) : undefined;
  }
  routedPull.__mlsTodayRouted = true;
  function apply() {
    var cur = window.pullScheduleViaAssist;
    if (typeof cur === 'function' && cur.__mlsTodayRouted) return;
    if (typeof cur === 'function') prev = cur;
    window.pullScheduleViaAssist = routedPull;
  }
  apply();
  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); } catch (e) {}
  try { setTimeout(apply, 1500); } catch (e) {}
})();

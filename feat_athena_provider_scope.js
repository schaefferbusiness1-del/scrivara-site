/* feat_athena_provider_scope.js — window.__mlsAthenaProviderScope (v1.0.0)
 *
 * Scope a pulled athenaOne schedule / cohort to the CURRENTLY-LOGGED-IN
 * provider's OWN patients by default — not every doctor in the practice.
 *
 * Michael's dad shares an athenaOne instance with several other providers, so a
 * raw "pull today's schedule" can drag in patients that belong to other doctors.
 * This layer:
 *   1. Detects the logged-in provider read-only from MLS's own settings
 *      (uns('providerName') / uns('docname')) with the header name as a fallback.
 *   2. Wraps the schedule-import chokepoint (_importPulledSchedule) and, BEFORE
 *      anything is created, content-scores each row of the raw schedule text for
 *      that provider's name and keeps only the matching rows.
 *   3. Labels honestly ("Pulling Dr. <name>'s patients - N of M on the schedule")
 *      and always offers a one-click "Show all providers" widen.
 *   4. If the provider can't be detected, or the schedule text carries no usable
 *      provider signal (no provider column), it does NOT silently grab everyone:
 *      it passes the full list through and says so honestly, with the one fix.
 *
 * READ-ONLY navigation/reading only. No chart writes, no Athena writes, no Sign.
 * Additive, own IIFE, try/catch throughout, idempotent, reversible via
 * window.__mlsAthenaProviderScope.revert(). No PHI is logged.
 *
 * NOTE (one live tuning run): the exact columns of a pulled athenaOne schedule
 * can only be confirmed against a real schedule. This module is built to score
 * rows robustly and to fail SAFE (pull all + honest note) when it cannot tell -
 * so the worst case is "you pulled everyone and we told you", never "we dropped
 * your patients" or "we mislabeled someone else's as yours".
 */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  if (window.__mlsAthenaProviderScope && window.__mlsAthenaProviderScope.installed) return;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(x) { return x == null ? '' : String(x); }

  var PREF_KEY = 'mlsSchedScope';            // 'mine' (default) | 'all'
  var SUFFIX = /^(jr|sr|ii|iii|iv|v|md|do|np|pa|rn|phd|esq|dr|drs|mr|mrs|ms|prof)$/;

  function unsGet(name) {
    return safe(function () {
      if (!isFn(window.uns)) return '';
      return S(localStorage.getItem(window.uns(name)) || '');
    }, '') || '';
  }
  function getPref() {
    var v = unsGet(PREF_KEY);
    return v === 'all' ? 'all' : 'mine';
  }
  function setPref(v) {
    safe(function () { if (isFn(window.uns)) localStorage.setItem(window.uns(PREF_KEY), v === 'all' ? 'all' : 'mine'); });
  }

  /* ---- detect the logged-in provider (read-only) ---- */
  function detectProvider() {
    var sources = [unsGet('providerName'), unsGet('docname')];
    sources.push(safe(function () {
      var sm = [].slice.call(document.querySelectorAll('small'));
      for (var i = 0; i < sm.length; i++) {
        var t = S(sm[i].textContent).trim();
        if (t && /[a-z]/i.test(t) && t.split(/\s+/).length >= 2 && t.length < 48 &&
            !/scribe|ambient|medical|assistant|powered/i.test(t)) return t;
      }
      return '';
    }, ''));
    for (var i = 0; i < sources.length; i++) {
      var n = S(sources[i]).trim();
      if (n) return n;
    }
    return '';
  }

  function tokens(raw) {
    return S(raw).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').filter(function (t) { return t && t.length > 1 && !SUFFIX.test(t); });
  }
  function providerKey(name) {
    var t = tokens(name);
    if (!t.length) return null;
    var longest = t.slice().sort(function (a, b) { return b.length - a.length; })[0];
    return { all: t, key: longest };
  }

  /* ---- split raw schedule text into candidate rows ---- */
  function splitRows(text) {
    var t = S(text);
    if (!t) return [];
    var lines = t.split(/\r?\n/);
    if (lines.length < 2) lines = t.split(/\s{3,}|\t/);
    return lines;
  }

  // A patient appointment row almost always carries a clock time (HH:MM) or a
  // full date (m/d/yyyy). Header rows, column labels, and section dates do not.
  function looksLikeAppt(s) {
    s = S(s);
    return /\b\d{1,2}:\d{2}\b/.test(s) || /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(s);
  }

  /* ---- does a row mention this provider? (content-scoring) ---- */
  function rowMentions(row, pk) {
    if (!pk) return false;
    var low = S(row).toLowerCase();
    if (!low.trim()) return false;
    var re = new RegExp('(^|[^a-z])' + pk.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)');
    if (re.test(low)) return true;
    var hit = pk.all.filter(function (tk) {
      var r = new RegExp('(^|[^a-z])' + tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)');
      return r.test(low);
    }).length;
    return hit >= 2;
  }

  /* ---- analyse a schedule text: how many rows are "mine" vs total appt rows ---- */
  function analyse(text, provider) {
    var pk = providerKey(provider);
    var rowsAll = splitRows(text);
    var dataRows = rowsAll.filter(function (r) { return looksLikeAppt(r) && /[a-z]{2,}/i.test(r); });
    var mine = dataRows.filter(function (r) { return rowMentions(r, pk); });
    return {
      pk: pk,
      total: dataRows.length,
      mineCount: mine.length,
      hasSignal: !!pk && mine.length > 0 && mine.length < dataRows.length
    };
  }

  /* ---- keep only rows that mention the provider, preserving headers/blanks ---- */
  function filterText(text, provider) {
    var pk = providerKey(provider);
    var lines = S(text).split(/\r?\n/);
    if (lines.length < 2) return text;
    var kept = lines.filter(function (line) {
      if (!looksLikeAppt(line)) return true;     // keep headers, column labels, dates, blanks
      return rowMentions(line, pk);              // appointment row: keep only if it's mine
    });
    return kept.join('\n');
  }

  /* ---- a small honest banner (its own node; no PHI) ---- */
  var bannerEl = null;
  function banner(msg, opts) {
    opts = opts || {};
    safe(function () {
      if (!bannerEl) {
        bannerEl = document.createElement('div');
        bannerEl.id = 'mlsScopeBanner';
        bannerEl.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483630;' +
          'max-width:560px;padding:11px 16px;border-radius:10px;font:13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;' +
          'font-weight:600;box-shadow:0 8px 24px rgba(8,20,36,.22);display:flex;gap:12px;align-items:center;';
        (document.body || document.documentElement).appendChild(bannerEl);
      }
      var kind = opts.kind || 'info';
      var palette = kind === 'ok' ? ['#dcfce7', '#86efac', '#14532d']
        : kind === 'warn' ? ['#fef3c7', '#fcd34d', '#7c4a03']
        : ['#e6f0fb', '#b9d4f0', '#173a63'];
      bannerEl.style.background = palette[0];
      bannerEl.style.border = '1px solid ' + palette[1];
      bannerEl.style.color = palette[2];
      bannerEl.innerHTML = '';
      var span = document.createElement('span');
      span.style.flex = '1 1 auto';
      span.textContent = msg;
      bannerEl.appendChild(span);
      (opts.actions || []).forEach(function (a) {
        var b = document.createElement('button');
        b.textContent = a.label;
        b.style.cssText = 'flex:0 0 auto;cursor:pointer;border:1px solid ' + palette[1] + ';background:#fff;' +
          'color:' + palette[2] + ';border-radius:7px;padding:5px 10px;font-weight:700;font-size:12px;';
        b.addEventListener('click', function () { safe(a.onClick); });
        bannerEl.appendChild(b);
      });
      bannerEl.style.display = 'flex';
      if (opts.autoHide !== false) {
        clearTimeout(bannerEl.__t);
        bannerEl.__t = setTimeout(function () { safe(function () { if (bannerEl) bannerEl.style.display = 'none'; }); }, opts.ms || 11000);
      }
    });
  }

  function providerLabel(name) {
    var t = tokens(name);
    if (!t.length) return 'this provider';
    var surname = t[t.length - 1];
    surname = surname.charAt(0).toUpperCase() + surname.slice(1);
    return 'Dr. ' + surname;
  }

  /* ---- the wrap around _importPulledSchedule ---- */
  var origImport = null;
  function wrapped(payload) {
    var orig = origImport;
    try {
      if (!payload || typeof payload !== 'object' || typeof payload.text !== 'string' || !payload.text.trim()) {
        return orig.call(this, payload);
      }
      var pref = getPref();
      var provider = detectProvider();
      var lastPayload = payload;

      if (pref === 'all') {
        banner('Pulling ALL providers’ patients from this schedule (your setting). ', {
          kind: 'info',
          actions: [{ label: 'Only mine', onClick: function () { setPref('mine'); banner('Default set to your patients for the next pull.', { kind: 'ok' }); } }]
        });
        return orig.call(this, payload);
      }

      if (!provider) {
        banner('Couldn’t tell which provider you are, so this pull was NOT scoped - it may include other doctors’ patients. Set your name in Settings → Practice & provider to pull only yours.', {
          kind: 'warn',
          actions: [{ label: 'Pull all anyway', onClick: function () { setPref('all'); } }]
        });
        return orig.call(this, payload);
      }

      var a = analyse(payload.text, provider);
      if (!a.hasSignal) {
        banner('This schedule didn’t show a provider column, so MLS pulled all ' + a.total +
          ' patient' + (a.total === 1 ? '' : 's') + ' - they may include other doctors’. ' +
          'Tip: filter the schedule by your name in athenaOne first, or we can update MLS Assist to read the provider column.', {
          kind: 'warn',
          actions: [{ label: 'Always pull all', onClick: function () { setPref('all'); } }]
        });
        return orig.call(this, payload);
      }

      var filtered = filterText(payload.text, provider);
      var scoped = {};
      for (var k in payload) { if (Object.prototype.hasOwnProperty.call(payload, k)) scoped[k] = payload[k]; }
      scoped.text = filtered;
      if (typeof scoped.__schedRaw === 'string' && scoped.__schedRaw) scoped.__schedRaw = filtered;

      var label = providerLabel(provider);
      banner('Pulling ' + label + '’s patients - ' + a.mineCount + ' of ' + a.total + ' on the schedule.', {
        kind: 'ok',
        actions: [{
          label: 'Show all providers',
          onClick: function () {
            banner('Pulling all ' + a.total + ' patients on the schedule…', { kind: 'info' });
            safe(function () { orig.call(window, lastPayload); });
          }
        }]
      });
      return orig.call(this, scoped);
    } catch (e) {
      return orig ? orig.call(this, payload) : undefined;
    }
  }

  /* ---- install / re-assert / revert ---- */
  function install() {
    if (typeof window._importPulledSchedule === 'function' && !window._importPulledSchedule.__mlsScopeWrapped) {
      origImport = window._importPulledSchedule;
      var w = function (payload) { return wrapped.call(this, payload); };
      w.__mlsScopeWrapped = true;
      w.__orig = origImport;
      window._importPulledSchedule = w;
    }
  }
  function revert() {
    safe(function () {
      if (window._importPulledSchedule && window._importPulledSchedule.__mlsScopeWrapped && origImport) {
        window._importPulledSchedule = origImport;
      }
    });
    safe(function () { if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl); });
    bannerEl = null;
    window.__mlsAthenaProviderScope.installed = false;
  }

  install();
  safe(function () {
    var tries = 0;
    var iv = setInterval(function () { tries++; install(); if (tries > 20) clearInterval(iv); }, 1000);
  });

  window.__mlsAthenaProviderScope = {
    installed: true,
    version: VERSION,
    asset: 'feat_athena_provider_scope.js',
    detectProvider: detectProvider,
    providerLabel: providerLabel,
    providerKey: providerKey,
    looksLikeAppt: looksLikeAppt,
    rowMentions: rowMentions,
    analyse: analyse,
    filterText: filterText,
    getPref: getPref, setPref: setPref,
    revert: revert
  };
})();

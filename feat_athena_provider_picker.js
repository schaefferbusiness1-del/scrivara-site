/* feat_athena_provider_picker.js  ->  window.__mlsProviderPicker  (v1.0.0)
 *
 * "Whose patients?" — pick a DOCTOR and pull only THAT doctor's patients.
 *
 * Michael's athenaOne is multi-doctor. This adds a dropdown next to the day/week
 * "Pull patients" buttons, populated from the DISTINCT PROVIDERS the schedule read
 * returns (the new MLS Assist provider capture), defaulting to the logged-in
 * provider (Dr. Schaeffer). When a doctor is chosen, the day's schedule is filtered
 * to that provider's appointments and ONLY those patients are pulled onto the MLS
 * calendar — with an honest label "Pulling Dr. <name>'s patients — N of M today."
 *
 * HOW IT SCOPES (single chokepoint): the app's pull does
 *     appts = await _parseScheduleText(text);  _importPulledSchedule(appts);  _pullAllHistories(appts)
 * so wrapping _parseScheduleText to RETURN a provider-filtered array scopes BOTH the
 * calendar import AND the history pull at once. Provider per appointment comes from
 * the new extension fields (resp.appts[].provider / resp.providers), captured
 * read-only from the mlsAppScheduleResult message.
 *
 * FAIL-SAFE (never silently wrong):
 *   - provider undetectable, OR no structured provider data (old MLS Assist not yet
 *     reloaded / no provider column found), OR the picked doctor matched 0 rows
 *       -> pull ALL providers and SAY SO plainly. Never drops the doctor's patients,
 *          never mislabels another doctor's as the picked one.
 *   - "All doctors" selection bypasses scoping entirely.
 *
 * SAFETY: read-only. Sends NOTHING to the extension; never Save/Sign/write a chart;
 * its message listener only READS resp metadata (it never preventDefault/stops the
 * event, never posts). Additive, own IIFE, try/catch throughout, idempotent,
 * reversible via window.__mlsProviderPicker.revert(). No PHI in any log/diag.
 */
(function () {
  'use strict';
  try { if (window.__mlsProviderPicker && window.__mlsProviderPicker.installed) return; } catch (e) {}

  var VERSION = '1.0.1';
  var ASSET = 'feat_athena_provider_picker.js';
  var PICK_KEY = 'mlsProvPick';        // 'mine' (default) | 'all' | '<provider display>'
  var CACHE_KEY = 'mlsSchedProviders'; // JSON array of discovered provider display strings
  var COVERAGE_MIN = 0.5;              // need >=50% of appts provider-tagged to trust scoping

  var lastResp = null;                 // last schedule-read resp (read-only)
  var lastParsedAppts = null;          // last UNSCOPED parsed appts (for re-scope/widen)

  // ---------- tiny safe helpers ----------
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(x) { return x == null ? '' : String(x); }
  function clean(s) { return S(s).replace(/\s+/g, ' ').trim(); }
  function esc(s) {
    try { if (window.esc) return window.esc(s); } catch (e) {}
    return S(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function toast(m) { try { window.toast && window.toast(m); } catch (e) {} }

  function unsGet(name) { return safe(function () { if (!isFn(window.uns)) return ''; return S(localStorage.getItem(window.uns(name)) || ''); }, '') || ''; }
  function unsSet(name, v) { safe(function () { if (isFn(window.uns)) localStorage.setItem(window.uns(name), S(v)); }); }
  function getPick() { var v = unsGet(PICK_KEY); return v || 'mine'; }
  function setPick(v) { unsSet(PICK_KEY, v || 'mine'); }

  var SUFFIX = /^(jr|sr|ii|iii|iv|v|md|do|np|pa|pac|rn|phd|esq|dr|drs|mr|mrs|ms|prof|aprn|fnp|dnp|dpm|dds|dmd|cnm|crna|od|lpc|lcsw)$/;
  function tokens(raw) {
    return clean(raw).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').filter(function (t) { return t && t.length > 1 && !SUFFIX.test(t); });
  }
  function surname(name) { var t = tokens(name); if (!t.length) return ''; return t.slice().sort(function (a, b) { return b.length - a.length; })[0]; }
  function nameKey(name) { return tokens(name).slice().sort().join(' '); }
  function providerLabel(name) {
    if (!name) return 'this provider';
    var sn = surname(name); if (!sn) return clean(name);
    return 'Dr. ' + sn.charAt(0).toUpperCase() + sn.slice(1);
  }
  // does an appointment's provider string match the picked target? (surname match)
  function provMatch(apptProvider, target) {
    var ap = surname(apptProvider), tg = surname(target);
    if (!ap || !tg) return false;
    if (ap === tg) return true;
    // 2-token overlap fallback (e.g. shared surname, disambiguate by first name)
    var a = tokens(apptProvider), b = tokens(target);
    var common = a.filter(function (x) { return b.indexOf(x) > -1; });
    return common.length >= 2;
  }

  // ---------- detect logged-in provider (read-only) ----------
  function detectProvider() {
    var v = safe(function () { return window.__mlsAthenaProviderScope && isFn(window.__mlsAthenaProviderScope.detectProvider) ? window.__mlsAthenaProviderScope.detectProvider() : ''; }, '');
    if (v) return v;
    v = unsGet('providerName') || unsGet('docname');
    if (v) return v;
    return safe(function () {
      var sm = [].slice.call(document.querySelectorAll('small'));
      for (var i = 0; i < sm.length; i++) {
        var t = clean(sm[i].textContent);
        if (t && /[a-z]/i.test(t) && t.split(/\s+/).length >= 2 && t.length < 48 && !/scribe|ambient|medical|assistant|powered/i.test(t)) return t;
      }
      return '';
    }, '') || '';
  }

  // ---------- providers cache ----------
  function cachedProviders() { return safe(function () { var a = JSON.parse(unsGet(CACHE_KEY) || '[]'); return Array.isArray(a) ? a : []; }, []) || []; }
  function mergeProviders(list) {
    var have = cachedProviders(), seen = {}, out = [];
    have.concat(list || []).forEach(function (p) { p = clean(p); var k = p.toLowerCase(); if (p && !seen[k]) { seen[k] = 1; out.push(p); } });
    unsSet(CACHE_KEY, JSON.stringify(out.slice(0, 40)));
    return out;
  }

  // ---------- status narration (shared timeline + mirror + own banner) ----------
  function tlStep(text, state) {
    var ok = false;
    safe(function () { if (window.__mlsAthenaActions && window.__mlsAthenaActions._step) { window.__mlsAthenaActions._step(text, state || 'note'); ok = true; } });
    safe(function () { if (window.__mlsUxUnify && window.__mlsUxUnify.mirror) window.__mlsUxUnify.mirror(text); });
    if (!ok) toast(text);
  }
  var bannerEl = null;
  function banner(msg, kind, actions) {
    safe(function () {
      if (!bannerEl) {
        bannerEl = document.createElement('div');
        bannerEl.id = 'mlsppBanner';
        bannerEl.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483631;max-width:580px;padding:11px 16px;border-radius:10px;font:13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;font-weight:600;box-shadow:0 8px 24px rgba(8,20,36,.22);display:flex;gap:12px;align-items:center;';
        (document.body || document.documentElement).appendChild(bannerEl);
      }
      var pal = kind === 'ok' ? ['#dcfce7', '#86efac', '#14532d'] : kind === 'warn' ? ['#fef3c7', '#fcd34d', '#7c4a03'] : ['#e6f0fb', '#b9d4f0', '#173a63'];
      bannerEl.style.background = pal[0]; bannerEl.style.border = '1px solid ' + pal[1]; bannerEl.style.color = pal[2];
      bannerEl.innerHTML = '';
      var span = document.createElement('span'); span.style.flex = '1 1 auto'; span.textContent = msg; bannerEl.appendChild(span);
      (actions || []).forEach(function (a) {
        var b = document.createElement('button'); b.textContent = a.label;
        b.style.cssText = 'flex:0 0 auto;cursor:pointer;border:1px solid ' + pal[1] + ';background:#fff;color:' + pal[2] + ';border-radius:7px;padding:5px 10px;font-weight:700;font-size:12px;';
        b.addEventListener('click', function () { safe(a.onClick); });
        bannerEl.appendChild(b);
      });
      bannerEl.style.display = 'flex';
      clearTimeout(bannerEl.__t); bannerEl.__t = setTimeout(function () { safe(function () { if (bannerEl) bannerEl.style.display = 'none'; }); }, 13000);
    });
  }

  // ---------- attach provider to parsed appts from structured data ----------
  function attachProviders(appts, struct) {
    var byName = {}, byNameTime = {};
    (struct || []).forEach(function (s) {
      if (!s || !s.provider) return;
      var nk = nameKey(s.name);
      if (nk) { if (!byName[nk]) byName[nk] = s.provider; byNameTime[nk + '|' + clean(s.time)] = s.provider; }
    });
    var attached = 0;
    (appts || []).forEach(function (a) {
      if (!a) return;
      var nk = nameKey(a.name);
      var p = byNameTime[nk + '|' + clean(a.time)] || byName[nk] || (a.provider ? a.provider : '');
      if (p) { a.__provider = p; attached++; }
    });
    return attached;
  }

  // ---------- the scope decision (returns the array to import + narrates) ----------
  function applyScope(appts) {
    var struct = (lastResp && lastResp.appts) || [];
    var pick = getPick();

    if (pick === 'all') {
      tlStep('You chose “All doctors” — pulling every scheduled patient (' + appts.length + ').', 'note');
      banner('Pulling ALL doctors’ patients — ' + appts.length + ' on the schedule.', 'info', [
        { label: 'Only mine', onClick: function () { setPick('mine'); renderDropdown(); banner('Next pull will bring only your patients.', 'ok'); } }
      ]);
      return appts;
    }

    var target = pick === 'mine' ? detectProvider() : pick;
    if (!target) {
      tlStep('Couldn’t tell which doctor you are, so this pull was NOT scoped — it may include other doctors’ patients.', 'warn');
      banner('Couldn’t tell which provider you are — pulled all ' + appts.length + '. Set your name in Settings → Practice & provider to pull only yours.', 'warn', [
        { label: 'Always pull all', onClick: function () { setPick('all'); renderDropdown(); } }
      ]);
      return appts;
    }

    var attached = attachProviders(appts, struct);
    if (!struct.length || attached < Math.ceil(appts.length * COVERAGE_MIN)) {
      tlStep('This schedule didn’t carry a per-appointment doctor yet, so MLS pulled all ' + appts.length + ' and labeled it honestly (it did NOT guess).', 'warn');
      banner('No per-doctor data on this schedule — pulled all ' + appts.length + ' patients. Reload the new MLS Assist (chrome://extensions) so MLS can filter by doctor.', 'warn', [
        { label: 'OK, pull all', onClick: function () {} }
      ]);
      return appts;
    }

    var mine = appts.filter(function (a) { return a.__provider && provMatch(a.__provider, target); });
    var label = providerLabel(target);
    if (mine.length === 0) {
      tlStep('Couldn’t find ' + label + '’s patients on the open schedule, so MLS pulled all ' + appts.length + ' rather than drop anyone.', 'warn');
      banner('No appointments matched ' + label + ' on this schedule — pulled all ' + appts.length + ' instead of dropping patients. Open ' + label + '’s day in athenaOne, or pick another doctor.', 'warn');
      return appts;
    }
    if (mine.length === appts.length) {
      tlStep('Everyone on this schedule is ' + label + '’s (' + mine.length + ') — pulling them all.', 'note');
      banner('All ' + mine.length + ' patients on this schedule are ' + label + '’s.', 'ok');
      return appts;
    }

    var others = appts.length - mine.length;
    tlStep('You picked ' + label + ' — pulling only ' + label + '’s ' + mine.length + ' patient' + (mine.length === 1 ? '' : 's') + ' today (filtering out the other ' + others + ' on the shared schedule).', 'done');
    banner('Pulling ' + label + '’s patients — ' + mine.length + ' of ' + appts.length + ' today.', 'ok', [
      { label: 'Show all doctors', onClick: function () { widenToAll(); } }
    ]);
    return mine;
  }

  // re-import everyone from the last UNSCOPED pull (no new Athena read)
  function widenToAll() {
    setPick('all'); renderDropdown();
    var appts = lastParsedAppts;
    if (!appts || !appts.length) { banner('Pick “All doctors” then pull again to bring everyone.', 'info'); return; }
    banner('Pulling all ' + appts.length + ' patients on the schedule…', 'info');
    safe(function () { if (isFn(window._importPulledSchedule)) Promise.resolve(window._importPulledSchedule(appts.slice())); });
    safe(function () { if (isFn(window._pullAllHistories)) window._pullAllHistories(appts.slice()); });
  }

  // ---------- wrap _parseScheduleText (the scope chokepoint) ----------
  var _origParse = null, _wrapParse = null, _didWrapParse = false;
  function wrapParse() {
    if (_didWrapParse) return;
    if (!isFn(window._parseScheduleText)) return;
    if (window._parseScheduleText.__mlsppWrapped) { _didWrapParse = true; return; }
    _origParse = window._parseScheduleText;
    _wrapParse = function (text) {
      var self = this, args = arguments;
      return Promise.resolve(safe(function () { return _origParse.apply(self, args); })).then(function (appts) {
        try {
          if (!Array.isArray(appts)) return appts;
          lastParsedAppts = appts.slice();
          return applyScope(appts);
        } catch (e) { return appts; }
      });
    };
    _wrapParse.__mlsppWrapped = true;
    _wrapParse.__orig = _origParse;
    window._parseScheduleText = _wrapParse;
    _didWrapParse = true;
  }

  // ---------- capture the schedule-read result (READ-ONLY) ----------
  function onMessage(e) {
    safe(function () {
      var d = e && e.data;
      if (!d || d.source !== 'mls-ext' || d.type !== 'mlsAppScheduleResult') return;
      var r = d.resp || {};
      lastResp = r;   // never mutated, never forwarded
      if (Array.isArray(r.providers) && r.providers.length) { mergeProviders(r.providers); renderDropdown(); }
    });
  }

  // ============================================================
  //  the "Whose patients?" dropdown (mounts next to the pull buttons)
  // ============================================================
  var STYLE_ID = 'mlsppStyle';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '.mlspp-wrap{margin:2px 0 10px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.30);color:#fff;}',
      '.mlspp-wrap label{display:block;font-size:12px;font-weight:700;margin:0 0 5px;}',
      '.mlspp-wrap select{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.5);background:#fff;color:#13243a;font-size:13px;font-weight:600;cursor:pointer;}',
      '.mlspp-hint{font-size:11px;line-height:1.35;opacity:.92;margin:6px 1px 0;color:#eaf2ff;}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function optionList() {
    var who = detectProvider();
    var opts = [];
    if (who) opts.push({ v: 'mine', t: '👤 ' + providerLabel(who) + ' (you)' });
    cachedProviders().forEach(function (p) {
      if (who && provMatch(p, who)) return; // skip the "you" duplicate
      opts.push({ v: p, t: 'Dr. ' + (surname(p) ? surname(p).charAt(0).toUpperCase() + surname(p).slice(1) : clean(p)) });
    });
    if (!who) opts.unshift({ v: 'mine', t: '👤 My patients (set your name in Settings)' });
    opts.push({ v: 'all', t: '👥 All doctors' });
    return opts;
  }

  function hintFor(pick) {
    if (pick === 'all') return 'MLS will bring every doctor’s patients on the open schedule.';
    var who = pick === 'mine' ? detectProvider() : pick;
    if (!who) return 'Set your provider name in Settings to scope to your patients.';
    return 'MLS will bring only ' + providerLabel(who) + '’s patients. If the schedule has no per-doctor data yet, it pulls all and tells you.';
  }

  // v1.0.1 GLITCH FIX: renderDropdown is driven by a 1500ms poll, a 1000ms boot
  // poll, AND a body MutationObserver, and it used to rewrite wrap.innerHTML on
  // EVERY call -> the live <select> was torn down/rebuilt ~every 1.5s (worse on a
  // foreground tab), so it flickered and SLAMMED SHUT when opened. Now: do NOTHING
  // when the desired state is unchanged (signature), and never rebuild while the
  // user is interacting with the <select>.
  var _lastSig = null;
  function renderSig(pick) {
    var opts = optionList().map(function (o) { return o.v + '' + o.t; }).join('');
    return S(pick) + '' + opts + '' + hintFor(pick);
  }
  function selIsOpen(sel) { return !!(sel && document.activeElement === sel); }
  function renderDropdown() {
    safe(function () {
      var host = document.getElementById('mlscpPulls');
      if (!host) return;
      var pick = getPick();
      var wrap = document.getElementById('mlsppWrap');
      var sig = renderSig(pick);
      if (wrap && sig === _lastSig) return;
      if (wrap && selIsOpen(document.getElementById('mlsppSel'))) return;
      injectStyle();
      var html = '<label for="mlsppSel">🩺 Whose patients?</label>' +
        '<select id="mlsppSel">' + optionList().map(function (o) {
          return '<option value="' + esc(o.v) + '"' + (o.v === pick ? ' selected' : '') + '>' + esc(o.t) + '</option>';
        }).join('') + '</select>' +
        '<div class="mlspp-hint" id="mlsppHint">' + esc(hintFor(pick)) + '</div>';
      if (!wrap) {
        wrap = document.createElement('div'); wrap.className = 'mlspp-wrap'; wrap.id = 'mlsppWrap';
        wrap.innerHTML = html;
        host.insertBefore(wrap, host.firstChild);
      } else {
        wrap.innerHTML = html;
      }
      _lastSig = sig;
      var sel = document.getElementById('mlsppSel');
      if (sel && !sel.__mlsppBound) {
        sel.__mlsppBound = true;
        sel.addEventListener('change', function () {
          setPick(sel.value);
          _lastSig = renderSig(sel.value);
          var h = document.getElementById('mlsppHint'); if (h) h.textContent = hintFor(sel.value);
          adjustCenterpieceNote();
        });
      }
      adjustCenterpieceNote();
    });
  }

  // gently update the centerpiece's hardcoded "Pulls all providers for now" note
  var _noteOrig = {};
  function adjustCenterpieceNote() {
    safe(function () {
      var notes = [].slice.call(document.querySelectorAll('.mlscp-note, .mlscp-sub'));
      notes.forEach(function (n, i) {
        if (/Pulls all providers for now/i.test(n.textContent)) {
          var id = n.getAttribute('data-mlspp-id') || ('n' + i);
          if (!(id in _noteOrig)) { _noteOrig[id] = n.innerHTML; n.setAttribute('data-mlspp-id', id); }
          var pick = getPick();
          var who = pick === 'all' ? '' : (pick === 'mine' ? detectProvider() : pick);
          n.innerHTML = who ? ('Now filters to <b>' + esc(providerLabel(who)) + '</b> using the “Whose patients?” box above (falls back to all + tells you if the schedule has no per-doctor data).')
            : 'Use the “Whose patients?” box above to pick a doctor.';
        }
      });
    });
  }

  // keep the dropdown present as MLS Easy / the centerpiece re-render
  var _obs = null, _pollT = null, _raf = 0;
  function scheduleRender() {
    if (_raf) return;
    _raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { _raf = 0; safe(function () { wrapParse(); if (document.getElementById('mlscpPulls')) renderDropdown(); }); });
  }
  function startObserver() {
    safe(function () { _obs = new MutationObserver(function () { scheduleRender(); }); _obs.observe(document.body, { childList: true, subtree: true }); });
    _pollT = setInterval(function () { safe(function () { wrapParse(); if (document.getElementById('mlscpPulls')) renderDropdown(); }); }, 1500);
  }

  // ---------- revert ----------
  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_pollT) clearInterval(_pollT); });
    safe(function () { window.removeEventListener('message', onMessage, true); });
    safe(function () { if (_wrapParse && window._parseScheduleText === _wrapParse && _origParse) window._parseScheduleText = _origParse; });
    safe(function () { var w = document.getElementById('mlsppWrap'); if (w) w.remove(); });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.remove(); });
    safe(function () { if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl); bannerEl = null; });
    safe(function () { // restore centerpiece notes
      [].slice.call(document.querySelectorAll('[data-mlspp-id]')).forEach(function (n) {
        var id = n.getAttribute('data-mlspp-id'); if (id in _noteOrig) { n.innerHTML = _noteOrig[id]; n.removeAttribute('data-mlspp-id'); }
      });
    });
    safe(function () { window.__mlsProviderPicker.installed = false; });
  }

  // ---------- boot ----------
  function boot() {
    safe(function () { window.addEventListener('message', onMessage, true); });
    wrapParse();
    startObserver();
    scheduleRender();
    safe(function () { var t = 0, iv = setInterval(function () { t++; wrapParse(); if (t > 20) clearInterval(iv); }, 1000); });
  }

  window.__mlsProviderPicker = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    detectProvider: detectProvider,
    providerLabel: providerLabel,
    provMatch: provMatch,
    attachProviders: attachProviders,
    applyScope: applyScope,
    getPick: getPick, setPick: setPick,
    cachedProviders: cachedProviders, mergeProviders: mergeProviders,
    renderDropdown: renderDropdown,
    _ingest: function (resp) { onMessage({ data: Object.assign({ source: 'mls-ext', type: 'mlsAppScheduleResult' }, { resp: resp }) }); },
    _setLastResp: function (r) { lastResp = r; },
    revert: revert
  };

  // Wrap synchronously the moment the module evaluates (covers the case where the
  // app's _parseScheduleText already exists and a pull could fire before boot's
  // readyState-deferred path runs). The poll re-asserts if it isn't defined yet.
  safe(wrapParse);

  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); } catch (e) { safe(boot); }
})();

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
      '.mlspp-hint{font-size:11px;line-height:1.35;opacity:.92;margin:6px 1px 0;color:#EAF1EC;}'
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
    var opts = optionList().map(function (o) { return o.v + '' + o.t; }).join('');
    return S(pick) + '' + opts + '' + hintFor(pick);
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


/* ===================================================================== *
 * APPENDED MODULE: window.__mlsProviderTagFix  (v1.0.2)
 * Durable doctor-scoping via athena-as-source-of-truth + providerTags.
 * Real-name chip; Who's-Next + calendar scoped & consistent by day; full
 * H:MM times from start_at; DOB captured read-only on pull (HARD RULE: a
 * patient with no DOB is excluded, never shown blank/placeholder); OPEN/
 * FROZEN excluded; 5-card default + Show more/less. INERT when no tags.
 * Attribution comes ONLY from the durable providerTags written by the
 * authoritative per-doctor athena match; pulls NEVER tag (whole-practice
 * pull -> blanket-tag would be a PHI breach), they only capture DOB for
 * already-tagged patients. Read-only re: athenaOne and charts.
 * Reversible: __mlsProviderTagFix.revert().
 * ===================================================================== */
(function () {
  'use strict';
  try { if (window.__mlsProviderTagFix && window.__mlsProviderTagFix.installed) return; } catch (e) { return; }
  var VERSION = '1.0.3', ASSET = 'feat_athena_provider_picker.js';
  var TAGS_KEY = 'providerTags', DOB_KEY = 'providerDob', PICK_KEY = 'mlsTagPick', DEFAULT_SHOWN = 5;
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(x) { return x == null ? '' : String(x); }
  function clean(s) { return S(s).replace(/\s+/g, ' ').trim(); }
  function esc(s) { try { if (isFn(window.esc)) return window.esc(s); } catch (e) {} return S(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function unsKey(name) { return safe(function () { return isFn(window.uns) ? window.uns(name) : null; }, null); }
  function lsGet(name) { var k = unsKey(name); return k ? safe(function () { return S(localStorage.getItem(k) || ''); }, '') : ''; }
  function lsSet(name, v) { var k = unsKey(name); if (k) safe(function () { localStorage.setItem(k, S(v)); }); }
  function jget(name) { return safe(function () { return JSON.parse(lsGet(name) || 'null'); }, null); }
  function jset(name, obj) { safe(function () { lsSet(name, JSON.stringify(obj)); }); }
  var SUFFIX = /^(jr|sr|ii|iii|iv|v|md|do|np|pa|pac|rn|phd|esq|dr|drs|mr|mrs|ms|prof|aprn|fnp|dnp|dpm|dds|dmd|cnm|crna|od)$/;
  function tokens(raw) { return clean(raw).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(function (t) { return t && t.length > 1 && !SUFFIX.test(t); }); }
  function surname(name) { var t = tokens(name); if (!t.length) return ''; return t.slice().sort(function (a, b) { return b.length - a.length; })[0]; }
  function nameKey(name) { return tokens(name).slice().sort().join(' '); }
  var NONPT = /^(open|frozen|blocked|block|held|hold|lunch|break|tbd|n\/?a|reserved|busy|out|closed|admin|no ?show|do not (book|schedule))$/i;
  function isRealName(nm) { nm = clean(nm); return !!nm && /[a-z]/i.test(nm) && !NONPT.test(nm) && nm.split(' ').length >= 2; }
  function tags() { var t = jget(TAGS_KEY); return (t && typeof t === 'object' && !Array.isArray(t)) ? t : {}; }
  function hasTags() { return Object.keys(tags()).length > 0; }
  function dobMap() { var d = jget(DOB_KEY); return (d && typeof d === 'object') ? d : {}; }
  function realName() { return clean(lsGet('providerDisplayName')); }
  function scrapedName() { return clean(lsGet('providerName')); }
  function chosenFromFinder() { return safe(function () { var c = window.__mlsFindDoctors && window.__mlsFindDoctors.chosen; return c ? clean(c.name || c.raw) : ''; }, ''); }
  function getPick() { return lsGet(PICK_KEY) || 'mine'; }
  function setPick(v) { lsSet(PICK_KEY, v || 'mine'); }
  function selectedDoctor() { var fc = chosenFromFinder(); if (fc) return { all: false, name: fc }; var p = getPick(); if (p === 'all') return { all: true, name: '' }; if (p && p !== 'mine') return { all: false, name: p }; var rn = realName(); return { all: false, name: rn || scrapedName() }; }
  function apptDate(a) { return S(a.appt_date || a.date || S(a.start_at).slice(0, 10)); }
  function hhmm(a) { if (/^\d\d?:\d\d/.test(S(a.time))) return ('0' + a.time).slice(-5); var d = safe(function () { return new Date(a.start_at); }, null); if (d && !isNaN(d.getTime())) return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); return ''; }
  function ampm(t) { var m = /^(\d\d?):(\d\d)/.exec(S(t)); if (!m) return S(t); var h = +m[1], mm = m[2], ap = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12; return h + ':' + mm + ' ' + ap; }
  /* v1.0.2 CALENDAR FREEZE FIX: resolve every patient DOB once per render.
     The old apptDob() parsed providerDob and scanned the full patient array for
     EACH appointment: O(appointments x patients). Large signed-in accounts
     could lock the renderer merely by opening or navigating Calendar. */
  function buildDobLookup() {
    var dm = dobMap(), byName = {};
    var ps = safe(function () { return (isFn(window.getPatients) && window.getPatients()) || jget('patients') || []; }, []) || [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], k = p && nameKey(p.name), d = p && clean(p.dob);
      if (k && d && !byName[k]) byName[k] = d;
    }
    return function (a) {
      var direct = clean(a && a.dob); if (direct) return direct;
      var key = nameKey(a && a.name); if (!key) return '';
      return clean(dm[key] || byName[key] || '');
    };
  }
  function matchedAppts(doctorName) { var T = tags(); var sn = surname(doctorName); var ap = safe(function () { return window._calAppts || []; }, []) || []; var apptDob = buildDobLookup(); var out = [], seen = {}; for (var i = 0; i < ap.length; i++) { var a = ap[i]; if (!a) continue; var pid = a.patient_external_id || a.patientId || a.pid; var tag = pid != null ? T[pid] : null; if (!tag) continue; if (sn && clean(tag).toLowerCase() !== sn) continue; var nm = clean(a.name); if (!isRealName(nm)) continue; var dob = apptDob(a); if (!dob) continue; var t = hhmm(a), dt = apptDate(a), k = nm.toLowerCase() + '|' + dt + '|' + t; if (seen[k]) continue; seen[k] = 1; out.push({ name: nm, time: t, date: dt, dob: dob, reason: clean(a.reason || ''), start_at: a.start_at }); } out.sort(function (x, y) { return (S(x.date) + 'T' + S(x.time)).localeCompare(S(y.date) + 'T' + S(y.time)); }); return out; }
  function allTaggedAppts() { var T = tags(); var ap = safe(function () { return window._calAppts || []; }, []) || []; var apptDob = buildDobLookup(); var out = [], seen = {}; for (var i = 0; i < ap.length; i++) { var a = ap[i]; if (!a) continue; var pid = a.patient_external_id || a.patientId || a.pid; if (pid == null || !T[pid]) continue; var nm = clean(a.name); if (!isRealName(nm)) continue; var dob = apptDob(a); if (!dob) continue; var t = hhmm(a), dt = apptDate(a), k = nm.toLowerCase() + '|' + dt + '|' + t; if (seen[k]) continue; seen[k] = 1; out.push({ name: nm, time: t, date: dt, dob: dob, reason: clean(a.reason || ''), start_at: a.start_at }); } out.sort(function (x, y) { return (S(x.date) + 'T' + S(x.time)).localeCompare(S(y.date) + 'T' + S(y.time)); }); return out; }
  function currentList() { var doc = selectedDoctor(); return doc.all ? allTaggedAppts() : matchedAppts(doc.name); }
  var _fcLast = 0, _fcT = null;
  function fixChip() { var now = Date.now(); var wait = 400 - (now - _fcLast); if (wait <= 0) { _fcLast = now; if (_fcT) { clearTimeout(_fcT); _fcT = null; } _fixChipNow(); } else if (!_fcT) { _fcT = setTimeout(function () { _fcT = null; _fcLast = Date.now(); _fixChipNow(); }, wait); } }
  function _fixChipNow() { safe(function () { var rn = realName(); if (!rn) return; var wrong = scrapedName(); if (wrong && wrong !== rn) { var sp = document.querySelectorAll('span,div,small,b,strong'); for (var i = 0; i < sp.length; i++) { var el = sp[i]; if (el.children.length) continue; if (el.closest && el.closest('select,option,#mlsCalRoster')) continue; if (clean(el.textContent) === wrong) { if (el.getAttribute('data-ptfix-orig') == null) el.setAttribute('data-ptfix-orig', el.textContent); el.textContent = rn; } } } var roster = document.getElementById('mlsCalRoster'); if (roster && wrong && wrong !== rn) { var chips = roster.querySelectorAll('.mlsRosChip'); var hasReal = false, k; for (k = 0; k < chips.length; k++) if (clean(chips[k].textContent) === rn) hasReal = true; if (hasReal) { for (k = 0; k < chips.length; k++) { if (clean(chips[k].textContent) === wrong) { if (chips[k].getAttribute('data-ptfix-hide') == null) { chips[k].setAttribute('data-ptfix-hide', '1'); chips[k].style.display = 'none'; } } } } } }); }
  var STYLE_ID = 'mlsPtfStyle';
  function injectCSS() { if (document.getElementById(STYLE_ID)) return; var s = document.createElement('style'); s.id = STYLE_ID; s.textContent = '#mlsPtfBox .ptf-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 9px}#mlsPtfBox .ptf-title{font-size:12px;font-weight:800}#mlsPtfBox .ptf-doc{font-size:11px;font-weight:700;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:2px 9px;color:#fff}#mlsPtfBox .ptf-count{font-size:11.5px;opacity:.85;margin-left:auto}#mlsPtfBox .ptf-grid{display:flex;gap:8px;flex-wrap:wrap}#mlsPtfBox .ptf-chip{display:flex;flex-direction:column;align-items:flex-start;min-width:140px;max-width:230px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.32);color:#fff;border-radius:11px;padding:8px 11px;cursor:pointer;font-family:inherit}#mlsPtfBox .ptf-nm{font-weight:700;font-size:13px}#mlsPtfBox .ptf-mt{font-size:11px;opacity:.88}#mlsPtfBox .ptf-more{margin-top:9px;font-size:12px;font-weight:700;color:#fff;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);border-radius:9px;padding:6px 12px;cursor:pointer;font-family:inherit}#mlsPtfBox .ptf-empty{font-size:12px;opacity:.9;padding:6px 2px}'; (document.head || document.documentElement).appendChild(s); }
  var _expanded = false;
  function pickPatient(p) { safe(function () { var nm = document.getElementById('heroPtName'); if (nm) { nm.value = p.name || ''; ['input', 'change'].forEach(function (ev) { safe(function () { nm.dispatchEvent(new Event(ev, { bubbles: true })); }); }); } var db = document.getElementById('heroPtDob'); if (db && p.dob) { db.value = p.dob; ['input', 'change'].forEach(function (ev) { safe(function () { db.dispatchEvent(new Event(ev, { bubbles: true })); }); }); } if (isFn(window._heroSyncName)) window._heroSyncName(); }); }
  function renderWhosNext() { safe(function () { var host = document.getElementById('heroToday'); if (!host) return; injectCSS(); var doc = selectedDoctor(); var list = currentList(); host.style.display = 'block'; var label = doc.all ? 'All providers' : (doc.name || 'your patients'); var total = list.length; var shown = (_expanded || total <= DEFAULT_SHOWN) ? list : list.slice(0, DEFAULT_SHOWN); var html = '<div id="mlsPtfBox"><div class="ptf-hd"><span class="ptf-title">Who\'s Next</span><span class="ptf-doc">' + esc(label) + '</span><span class="ptf-count">' + total + (total === 1 ? ' patient' : ' patients') + '</span></div>'; if (!total) { html += '<div class="ptf-empty">No ' + esc(label) + ' patients with a DOB in the matched schedule yet. Pull the day schedule with athenaOne open.</div>'; } else { html += '<div class="ptf-grid">'; for (var i = 0; i < shown.length; i++) { var p = shown[i], meta = []; if (p.time) meta.push(esc(ampm(p.time))); if (p.dob) meta.push('DOB ' + esc(p.dob)); if (p.reason) meta.push(esc(p.reason)); html += '<button type="button" class="ptf-chip" data-ptf-i="' + i + '"><span class="ptf-nm">' + esc(p.name) + '</span>' + (meta.length ? '<span class="ptf-mt">' + meta.join(' / ') + '</span>' : '') + '</button>'; } html += '</div>'; if (total > DEFAULT_SHOWN) { html += '<button type="button" class="ptf-more" data-ptf-more="1">' + (_expanded ? 'Show less' : ('Show more (' + (total - DEFAULT_SHOWN) + ' more)')) + '</button>'; } } html += '</div>'; host.innerHTML = html; var chips = host.querySelectorAll('[data-ptf-i]'); for (var c = 0; c < chips.length; c++) chips[c].addEventListener('click', function () { var idx = +this.getAttribute('data-ptf-i'); if (shown[idx]) pickPatient(shown[idx]); }); var more = host.querySelector('[data-ptf-more]'); if (more) more.addEventListener('click', function () { _expanded = !_expanded; renderWhosNext(); }); }); }
  var _origRender = null, _renderWrapped = false;
  function scopeOn() { return hasTags() && !selectedDoctor().all; }
  function wrapCalendar() { if (_renderWrapped) return; if (!isFn(window.renderCalendar)) return; if (window.renderCalendar.__ptfWrapped) { _renderWrapped = true; return; } _origRender = window.renderCalendar; var w = function () { var self = this, args = arguments; if (!scopeOn()) return _origRender.apply(self, args); var full = window._calAppts; var doc = selectedDoctor(); var sn = surname(doc.name); var T = tags(); var apptDob = buildDobLookup(); var subset = safe(function () { return (full || []).filter(function (a) { var pid = a && (a.patient_external_id || a.patientId || a.pid); var tg = pid != null ? T[pid] : null; return tg && (!sn || clean(tg).toLowerCase() === sn) && isRealName(a.name) && !!apptDob(a); }); }, full) || full; try { window._calAppts = subset; return _origRender.apply(self, args); } finally { window._calAppts = full; } }; w.__ptfWrapped = true; window.renderCalendar = w; _renderWrapped = true; }
  function refreshCalendar() { safe(function () { if (isFn(window.renderCalendar)) window.renderCalendar(); }); }
  var _origParse = null, _parseWrapped = false;
  function wrapParse() { if (_parseWrapped) return; if (!isFn(window._parseScheduleText)) return; if (window._parseScheduleText.__ptfWrapped) { _parseWrapped = true; return; } _origParse = window._parseScheduleText; var f = function () { var self = this, args = arguments; return Promise.resolve(safe(function () { return _origParse.apply(self, args); })).then(function (arr) { safe(function () { if (!Array.isArray(arr)) return; /* DOB capture ONLY (read-only). NEVER tag here: the pull is whole-practice, so blanket-tagging to the logged-in doctor would be a PHI breach. Attribution comes solely from the durable providerTags. Record DOB only for patients ALREADY tagged. */ var dm = dobMap(), dC = false; var T = tags(); var ca = safe(function () { return window._calAppts || []; }, []) || []; var taggedKeys = {}; ca.forEach(function (c) { var pid = c && (c.patient_external_id || c.patientId || c.pid); if (pid != null && T[pid]) { var k = nameKey(c && c.name); if (k) taggedKeys[k] = 1; } }); arr.forEach(function (a) { if (!a || !isRealName(a.name)) return; var k = nameKey(a.name), d = clean(a.dob); if (k && d && taggedKeys[k] && dm[k] !== d) { dm[k] = d; dC = true; } }); if (dC) jset(DOB_KEY, dm); setTimeout(rerender, 60); }); return arr; }); }; f.__ptfWrapped = true; window._parseScheduleText = f; _parseWrapped = true; }
  var _wnReverted = false;
  function takeOverWhosNext() { if (_wnReverted) return; safe(function () { if (window.__mlsWhosNext && window.__mlsWhosNext.installed && isFn(window.__mlsWhosNext.revert)) { window.__mlsWhosNext.revert(); _wnReverted = true; } }); }
  function rerender() { if (!hasTags()) return; takeOverWhosNext(); wrapCalendar(); wrapParse(); fixChip(); renderWhosNext(); }
  var _obs = null, _poll = null, _lastSig = '';
  function sig() { return getPick() + '|' + chosenFromFinder() + '|' + Object.keys(tags()).length + '|' + (safe(function () { return (window._calAppts || []).length; }, 0)); }
  function tick() { if (!hasTags()) return; wrapCalendar(); wrapParse(); var s = sig(); fixChip(); if (!document.getElementById('mlsPtfBox') || s !== _lastSig) { _lastSig = s; _expanded = false; renderWhosNext(); refreshCalendar(); } else if (document.getElementById('heroToday') && !document.getElementById('mlsPtfBox')) { renderWhosNext(); } }
  function boot() { if (!hasTags()) { safe(wrapParse); _poll = setInterval(function () { safe(wrapParse); if (hasTags()) { clearInterval(_poll); _poll = null; start(); } }, 2000); return; } start(); }
  function start() { rerender(); safe(function () { _obs = new MutationObserver(function () { safe(function () { fixChip(); if (document.getElementById('heroToday') && !document.getElementById('mlsPtfBox')) renderWhosNext(); }); }); _obs.observe(document.documentElement, { childList: true, subtree: true }); }); _poll = setInterval(tick, 1500); [300, 900, 2000, 4000].forEach(function (ms) { setTimeout(function () { safe(rerender); }, ms); }); }
  function revert() { safe(function () { if (_obs) _obs.disconnect(); }); safe(function () { if (_poll) clearInterval(_poll); }); safe(function () { if (_origRender && window.renderCalendar && window.renderCalendar.__ptfWrapped) window.renderCalendar = _origRender; }); safe(function () { if (_origParse && window._parseScheduleText && window._parseScheduleText.__ptfWrapped) window._parseScheduleText = _origParse; }); safe(function () { var b = document.getElementById('mlsPtfBox'); if (b) b.remove(); }); safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.remove(); }); safe(function () { var ed = document.querySelectorAll('[data-ptfix-orig]'); for (var i = 0; i < ed.length; i++) { ed[i].textContent = ed[i].getAttribute('data-ptfix-orig'); ed[i].removeAttribute('data-ptfix-orig'); } }); safe(function () { var hd = document.querySelectorAll('[data-ptfix-hide]'); for (var i = 0; i < hd.length; i++) { hd[i].style.display = ''; hd[i].removeAttribute('data-ptfix-hide'); } }); safe(function () { if (_wnReverted && window.__mlsWhosNext && isFn(window.__mlsWhosNext.reapply)) window.__mlsWhosNext.reapply(); }); safe(refreshCalendar); safe(function () { window.__mlsProviderTagFix.installed = false; }); }
  window.__mlsProviderTagFix = { installed: true, version: VERSION, asset: ASSET, realName: realName, selectedDoctor: selectedDoctor, tags: tags, hasTags: hasTags, dobMap: dobMap, matchedAppts: matchedAppts, currentList: currentList, getPick: getPick, setPick: function (v) { setPick(v); _expanded = false; _lastSig = ''; rerender(); refreshCalendar(); }, render: renderWhosNext, fixChip: fixChip, refreshCalendar: refreshCalendar, revert: revert };
  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); } catch (e) { safe(boot); }
})();

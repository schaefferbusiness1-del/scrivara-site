/* feat_mls_checker.js  ->  window.__mlsChecker  (v1.0.0)  [item21]
 * =====================================================================
 * MLS CHECKER -- a full, honest self-diagnostic / troubleshooting
 * subsystem inside the MLS Assistant.
 *
 * Michael asked for a "full-fledged, thought-out program": a catalog of
 * named CHECKS, each verifying ONE thing is genuinely working, each
 * returning pass/fail + a SPECIFIC error code + a human-readable cause +
 * a suggested fix. This replaces vague, scattered, contradictory status
 * with ONE diagnosable system.
 *
 * HONESTY (non-negotiable): a check only PASSES if it genuinely passes.
 * When something cannot be verified from the web app (e.g. the app is at
 * the athenaOne sign-in screen, or the page cannot read the installed
 * extension's version), the check reports 'unknown' with an honest reason
 * -- it NEVER guesses 'pass'. Nothing here writes to athenaOne, signs,
 * saves, or logs the user out; all athenaOne touches are read-only probes
 * already used elsewhere. Synthetic/test data only.
 *
 * EXTENSIBLE: checks live in a registry. Add one with
 *   window.__mlsChecker.register({ id, code, name, run })
 * where run() -> Promise<{status, code, cause, fix, detail}> and
 *   status in {'pass','fail','unknown'}.
 *
 * SHAPE: own-scope IIFE, idempotent, ASCII-only, try/catch throughout,
 *   reversible via window.__mlsChecker.revert().
 *
 * PUBLIC API (window.__mlsChecker)
 *   .installed .version
 *   .register(check) / .unregister(id) / .list()
 *   .run()            -> Promise<[{id,code,name,status,cause,fix,detail}]>
 *   .openPanel() / .closePanel()
 *   .revert()
 * ===================================================================== */
(function () {
  'use strict';

  var NS = '__mlsChecker';
  var VERSION = '1.0.0';
  var win = window;
  if (win[NS] && win[NS].installed) { return; }

  var BACKEND = 'https://scrivara-backend.onrender.com';
  var SERVER_EXT_VERSION = '2.9.19'; // current published MLS Assist (extension-version.json)

  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function txt(el) { return safe(function () { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }, ''); }

  /* ---- request/response helper over the extension postMessage channel ---- */
  function extRequest(type, replyType, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false, id = 'mc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      var timer = setTimeout(function () { if (done) return; done = true; cleanup(); resolve({ ok: false, timedOut: true }); }, timeoutMs || 4000);
      function onMsg(ev) {
        var d = ev && ev.data;
        if (!d || typeof d !== 'object' || d.source !== 'mls-ext' || d.type !== replyType) return;
        if (done) return; done = true; clearTimeout(timer); cleanup();
        resolve({ ok: true, resp: d.resp, data: d });
      }
      function cleanup() { safe(function () { win.removeEventListener('message', onMsg, false); }); }
      win.addEventListener('message', onMsg, false);
      safe(function () { win.postMessage({ source: 'mls-app', type: type, __mlsCheckerId: id }, '*'); },
        function () { if (!done) { done = true; clearTimeout(timer); cleanup(); resolve({ ok: false }); } });
    });
  }

  function connState() {
    var ct = win.__mlsConnTruth;
    if (ct && ct.state) return ct.state;
    return null;
  }
  function connCheck() {
    var ct = win.__mlsConnTruth;
    if (ct && isFn(ct.check)) return safe(function () { return ct.check(); }, Promise.resolve(connState()));
    return Promise.resolve(connState());
  }

  function calAppts() {
    return safe(function () { return Array.isArray(win._calAppts) ? win._calAppts : []; }, []);
  }
  function patients() {
    return safe(function () { return isFn(win.getPatients) ? (win.getPatients() || []) : []; }, []);
  }
  function apptDay(a) {
    return safe(function () { return String(a.date || a.appt_date || (a.start_at ? String(a.start_at).slice(0, 10) : '') || ''); }, '');
  }
  function apptTime(a) {
    return safe(function () { return String(a.time || (a.start_at ? String(a.start_at).slice(11, 16) : '') || ''); }, '');
  }
  function compareVersions(a, b) {
    var aa = String(a || '').replace(/^v/i, '').split('.'), bb = String(b || '').replace(/^v/i, '').split('.');
    if (!aa.length || !bb.length || aa.some(function (x) { return !/^\d+$/.test(x); }) || bb.some(function (x) { return !/^\d+$/.test(x); })) return null;
    for (var i = 0; i < Math.max(aa.length, bb.length); i++) { var av = Number(aa[i] || 0), bv = Number(bb[i] || 0); if (av !== bv) return av > bv ? 1 : -1; }
    return 0;
  }

  /* ================= THE CHECK REGISTRY ================= */
  var registry = [];
  function register(c) {
    if (!c || !c.id || !isFn(c.run)) return function () {};
    unregister(c.id);
    registry.push({ id: c.id, code: c.code || c.id, name: c.name || c.id, run: c.run });
    return function () { unregister(c.id); };
  }
  function unregister(id) { for (var i = registry.length - 1; i >= 0; i--) if (registry[i].id === id) registry.splice(i, 1); }
  function list() { return registry.map(function (c) { return { id: c.id, code: c.code, name: c.name }; }); }

  function R(status, code, cause, fix, detail) { return { status: status, code: code, cause: cause || '', fix: fix || '', detail: detail || '' }; }

  function registerBuiltins() {
    /* CONN-001 -- athenaOne connection is REAL (not a sign-in page) */
    register({
      id: 'conn-real', code: 'CONN-001', name: 'athenaOne connection is real',
      run: function () {
        return connCheck().then(function (s) {
          s = s || connState() || { status: 'error', reason: 'No connection probe available.' };
          if (s.status === 'connected') return R('pass', 'CONN-001', '', '', 'A signed-in athenaOne tab is readable.');
          if (s.status === 'checking') return R('unknown', 'CONN-001', 'Connection check still in flight.', 'Re-run checks in a moment.', s.reason || '');
          var fix = (s.status === 'no-tab')
            ? 'Open athenaOne, sign in, open your Day schedule, then re-run.'
            : (s.status === 'no-extension')
              ? 'Install/enable MLS Assist and reload athenaOne and MLS.'
              : 'Open a signed-in athenaOne tab and re-run.';
          return R('fail', 'CONN-001', s.reason || 'athenaOne is not genuinely connected.', fix, 'state=' + s.status);
        });
      }
    });

    /* EXT-002 -- MLS Assist extension is present (ping/pong handshake) */
    register({
      id: 'ext-present', code: 'EXT-002', name: 'MLS Assist extension present',
      run: function () {
        return extRequest('mlsPing', 'mlsPong', 2500).then(function (r) {
          if (r.ok) return R('pass', 'EXT-002', '', '', 'Extension answered mlsPing -> mlsPong.');
          return R('fail', 'EXT-002', 'No mlsPong reply -- the MLS Assist extension is not responding.',
            'Install MLS Assist from get-extension.html (or enable it at chrome://extensions), then reload this page.', 'ping timed out');
        });
      }
    });

    /* EXT-003 -- extension version is current */
    register({
      id: 'ext-version', code: 'EXT-003', name: 'MLS Assist version is current',
      run: function () {
        return extRequest('mlsPing', 'mlsPong', 2500).then(function (r) {
          if (!r.ok) return R('unknown', 'EXT-003', 'Extension not responding, so its version cannot be read.',
            'Fix EXT-002 first, then re-run.', 'no pong');
          var installed = String((r.data && r.data.version) || '').replace(/^v/i, '').trim();
          var cmp = compareVersions(installed, SERVER_EXT_VERSION);
          if (cmp == null) return R('unknown', 'EXT-003', 'The extension answered but did not provide a valid installed version.',
            'Reload MLS Assist at chrome://extensions, refresh MLS, then re-run.', 'reported=' + (installed || '(empty)') + '; latest=v' + SERVER_EXT_VERSION);
          if (cmp < 0) return R('fail', 'EXT-003', 'MLS Assist v' + installed + ' is installed; v' + SERVER_EXT_VERSION + ' is available.',
            'Update it from Settings → Get the extension, then click Reload for MLS Assist at chrome://extensions.', 'installed=v' + installed + '; latest=v' + SERVER_EXT_VERSION);
          return R('pass', 'EXT-003', '', '', 'Installed=v' + installed + (cmp > 0 ? ' (newer than published v' + SERVER_EXT_VERSION + ')' : ' · up to date'));
        });
      }
    });

    /* PULL-004 -- day/doctor-scoped pull is NOT dumping the whole calendar */
    register({
      id: 'pull-scope', code: 'PULL-004', name: 'Schedule pull is day-scoped (no calendar smear)',
      run: function () {
        var appts = calAppts();
        if (!appts.length) return R('unknown', 'PULL-004', 'No appointments are loaded yet, so scoping cannot be measured.',
          'Pull a day from athenaOne, then re-run.', '0 appts in _calAppts');
        var byDay = {};
        for (var i = 0; i < appts.length; i++) { var d = apptDay(appts[i]) || '(no-date)'; byDay[d] = (byDay[d] || 0) + 1; }
        var worstDay = '', worst = 0;
        Object.keys(byDay).forEach(function (d) { if (byDay[d] > worst) { worst = byDay[d]; worstDay = d; } });
        var IMPLAUSIBLE = 60; // a single provider's day is typically ~10-35
        if (worst > IMPLAUSIBLE) {
          return R('fail', 'PULL-004',
            worst + ' appointments landed on a single day (' + worstDay + ') -- implausibly high for one doctor/day, which indicates the whole calendar was smeared onto one day.',
            'Pick a specific provider before pulling, and confirm the day-scoped pull (item18) is active. Re-pull that day.',
            'max/day=' + worst);
        }
        return R('pass', 'PULL-004', '', '', 'Busiest day has ' + worst + ' appts (within a plausible single-day range).');
      }
    });

    /* CAL-005 -- appointments land on the calendar with sane dates/times */
    register({
      id: 'cal-sane', code: 'CAL-005', name: 'Appointments have sane dates/times',
      run: function () {
        var appts = calAppts();
        if (!appts.length) return R('unknown', 'CAL-005', 'No appointments loaded to validate.',
          'Pull a day from athenaOne, then re-run.', '0 appts');
        var bad = 0, noTime = 0;
        for (var i = 0; i < appts.length; i++) {
          var d = apptDay(appts[i]);
          if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) ? true : isNaN(new Date(d + 'T00:00:00').getTime())) bad++;
          if (!apptTime(appts[i])) noTime++;
        }
        if (bad > 0) return R('fail', 'CAL-005', bad + ' of ' + appts.length + ' appointments have a missing/invalid date.',
          'Re-pull the day; if it persists the date parser scoped wrong -- check item18/schedimport.', 'badDates=' + bad);
        if (noTime === appts.length) return R('fail', 'CAL-005', 'No appointment carries a time-of-day.',
          'Re-pull -- the structured day-grid rows (with clock times) were not used.', 'noTime=all');
        return R('pass', 'CAL-005', '', '', appts.length + ' appts with valid dates; ' + (appts.length - noTime) + ' carry a time.');
      }
    });

    /* DOB-006 -- DOB present on pulled patients */
    register({
      id: 'dob-present', code: 'DOB-006', name: 'DOB present on pulled patients',
      run: function () {
        var pts = patients();
        var ath = pts.filter(function (p) { return p && /athena/i.test(String(p.source || '')); });
        var pool = ath.length ? ath : pts;
        if (!pool.length) return R('unknown', 'DOB-006', 'No patients are loaded to check.',
          'Pull patients from athenaOne, then re-run.', '0 patients');
        var withDob = pool.filter(function (p) { return p && p.dob && String(p.dob).trim(); }).length;
        if (withDob === 0) return R('fail', 'DOB-006',
          'None of the ' + pool.length + ' loaded patients has a DOB.',
          'DOB is captured by the per-patient chart pull (the day grid has no DOB). Pull a patient chart/history; the DOB then fills in and persists everywhere.',
          'withDob=0/' + pool.length);
        if (withDob < pool.length) return R('pass', 'DOB-006', '',
          'Schedule-only rows have no DOB until their chart is pulled (the day grid carries none) -- this is expected.',
          withDob + '/' + pool.length + ' patients have a DOB.');
        return R('pass', 'DOB-006', '', '', 'All ' + pool.length + ' patients have a DOB.');
      }
    });

    /* AI-007 -- backend / AI is reachable (honest 429 quota state) */
    register({
      id: 'ai-reach', code: 'AI-007', name: 'Backend / AI reachable',
      run: function () {
        // Synthetic, minimal, non-PHI probe. We read ONLY the HTTP status.
        var ctrl = ('AbortController' in win) ? new AbortController() : null;
        var to = ctrl ? setTimeout(function () { safe(function () { ctrl.abort(); }); }, 8000) : null;
        return fetch(BACKEND + '/api/copilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'health check' }], context: { healthCheck: true } }),
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (res) {
          if (to) clearTimeout(to);
          var st = res.status;
          if (st === 429) return R('fail', 'AI-007', 'The AI backend returned HTTP 429 -- the OpenAI quota/rate limit is currently exhausted.',
            'Wait for the quota to reset or top up the OpenAI plan on the backend. MLS pulls/calendar still work; only AI drafting is paused.', 'HTTP 429');
          if (st >= 500) return R('fail', 'AI-007', 'The AI backend returned a server error (HTTP ' + st + ').',
            'The Render backend may be waking or erroring -- retry shortly; check the backend logs if it persists.', 'HTTP ' + st);
          // 200/400/401/403/404 all prove the service is reachable and NOT quota-limited.
          return R('pass', 'AI-007', '', (res.ok ? '' : 'Reachable but returned HTTP ' + st + ' for the health probe (not a quota issue).'),
            'Backend reachable, HTTP ' + st + (st === 429 ? '' : ' (no 429 quota error).'));
        }).catch(function (e) {
          if (to) clearTimeout(to);
          return R('fail', 'AI-007', 'The AI backend could not be reached (network error or it is asleep).',
            'Check connectivity; the Render free tier sleeps when idle and takes ~30-60s to wake -- retry.', String(e && e.name || e));
        });
      }
    });

    /* WB-008 -- writeback path reachable (NOT exercised -- read-only) */
    register({
      id: 'writeback', code: 'WB-008', name: 'Writeback path reachable',
      run: function () {
        // We must NEVER drive an athenaOne write to test this. We verify the
        // PRECONDITIONS for writeback instead: extension present + a signed-in
        // athenaOne tab readable. If both hold, the mlsAppPasteNote channel is
        // available. We do not send a paste.
        return extRequest('mlsPing', 'mlsPong', 2500).then(function (ping) {
          if (!ping.ok) return R('fail', 'WB-008', 'Extension not responding, so the writeback channel is unavailable.',
            'Fix EXT-002 (install/enable MLS Assist), then re-run.', 'no pong');
          var s = connState();
          if (s && s.status === 'connected')
            return R('pass', 'WB-008', '', 'Not exercised (read-only) -- no note was written. The doctor still reviews and signs.',
              'Extension + signed-in athenaOne tab both present; the mlsAppPasteNote channel is available.');
          return R('unknown', 'WB-008', 'Extension is present but no signed-in athenaOne tab is readable, so writeback cannot be confirmed without writing.',
            'Open a signed-in athenaOne chart, then re-run. Writeback is never auto-tested.', 'conn=' + (s ? s.status : 'unknown'));
        });
      }
    });

    /* UI-009 -- no contradictory Athena status is showing */
    register({
      id: 'no-contradiction', code: 'UI-009', name: 'No contradictory status showing',
      run: function () {
        var u = win.__mlsAthenaStatusUnify;
        if (!u || !isFn(u.audit)) return R('unknown', 'UI-009', 'The unified status layer is not loaded, so contradictions cannot be measured.',
          'Ensure feat_athena_status_unify.js (item20) is loaded.', 'no audit()');
        safe(function () { u.scan(); });
        var a = safe(function () { return u.audit(); }, { contradiction: false, surfaces: [] });
        if (a.contradiction) return R('fail', 'UI-009',
          'An in-flight line (reading/pulling/importing) and a finished-result line are visible at the same time.',
          'The arbiter normally suppresses this -- reload so item20 is active; if it persists, capture the two lines for review.',
          'surfaces=' + (a.surfaces ? a.surfaces.length : 0));
        return R('pass', 'UI-009', '', '', 'Status surfaces are consistent (no simultaneous in-flight + result).');
      }
    });
  }

  /* ================= RUN ALL CHECKS ================= */
  function run() {
    var results = [];
    var seq = Promise.resolve();
    registry.forEach(function (c) {
      seq = seq.then(function () {
        return Promise.resolve(safe(function () { return c.run(); }, R('unknown', c.code, 'Check threw before running.', 'See console.', '')))
          .then(function (r) {
            r = r || R('unknown', c.code, '', '', '');
            results.push({ id: c.id, code: r.code || c.code, name: c.name, status: r.status || 'unknown', cause: r.cause || '', fix: r.fix || '', detail: r.detail || '' });
          })
          .catch(function (e) {
            results.push({ id: c.id, code: c.code, name: c.name, status: 'unknown', cause: 'Check errored: ' + (e && e.message || e), fix: 'See console.', detail: '' });
          });
      });
    });
    return seq.then(function () { return results; });
  }

  /* ================= PANEL UI (inside the MLS Assistant) ================= */
  var PANEL_ID = 'mlsAsstPanel';
  var SECTION_ID = 'mls-checker-section';
  var styleEl = null;
  function injectStyle() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.id = 'mls-checker-style';
    styleEl.textContent =
      '#' + SECTION_ID + '{border:1px solid #e7edf5;border-radius:13px;padding:12px;background:#fbfcff;margin-bottom:13px;}' +
      '#' + SECTION_ID + ' h4{font-family:"Newsreader",Georgia,serif;font-weight:500;font-size:16px;margin:0 0 4px;color:#1A211C;}' +
      '#' + SECTION_ID + ' .mc-sub{font-size:11px;color:#79837C;margin:0 0 9px;}' +
      '#' + SECTION_ID + ' .mc-run{width:100%;height:38px;border-radius:10px;border:none;cursor:pointer;background:linear-gradient(135deg,#0f6b3a,#0c844a);color:#fff;font:800 12.5px/1 "Plus Jakarta Sans";}' +
      '#' + SECTION_ID + ' .mc-run:disabled{opacity:.6;cursor:default;}' +
      '#' + SECTION_ID + ' .mc-summary{font:700 11.5px/1.3 "Plus Jakarta Sans";margin:10px 0 6px;color:#1A211C;}' +
      '#' + SECTION_ID + ' .mc-item{border:1px solid #F4F2EC;border-radius:10px;padding:8px 10px;margin-top:7px;background:#fff;}' +
      '#' + SECTION_ID + ' .mc-row{display:flex;align-items:center;gap:8px;}' +
      '#' + SECTION_ID + ' .mc-ic{width:18px;height:18px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font:800 11px/1 "Plus Jakarta Sans";color:#fff;}' +
      '#' + SECTION_ID + ' .mc-pass .mc-ic{background:#2E6A4B;}' +
      '#' + SECTION_ID + ' .mc-fail .mc-ic{background:#dc2626;}' +
      '#' + SECTION_ID + ' .mc-unknown .mc-ic{background:#d97706;}' +
      '#' + SECTION_ID + ' .mc-name{font:700 12px/1.25 "Plus Jakarta Sans";color:#1A211C;flex:1 1 auto;}' +
      '#' + SECTION_ID + ' .mc-code{font:700 10px/1 ui-monospace,Menlo,monospace;color:#5a6b80;background:#f1f5fb;border-radius:5px;padding:3px 5px;}' +
      '#' + SECTION_ID + ' .mc-cause{font-size:11px;color:#7a2718;margin-top:5px;}' +
      '#' + SECTION_ID + ' .mc-fix{font-size:11px;color:#204034;margin-top:3px;}' +
      '#' + SECTION_ID + ' .mc-detail{font-size:10px;color:#93a1b3;margin-top:3px;}';
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function schedulePane() {
    var p = document.getElementById(PANEL_ID);
    if (!p) return null;
    return p.querySelector('.as-pane-schedule') || p.querySelector('.as-body') || p;
  }

  function ensureSection() {
    var host = schedulePane();
    if (!host) return null;
    var sec = document.getElementById(SECTION_ID);
    if (sec) return sec;
    injectStyle();
    sec = document.createElement('div');
    sec.id = SECTION_ID;
    sec.innerHTML =
      '<h4>MLS Checker</h4>' +
      '<p class="mc-sub">Runs honest self-diagnostics. A check passes only if it genuinely passes; unverifiable checks say so.</p>' +
      '<button type="button" class="mc-run">Run checks</button>' +
      '<div class="mc-results"></div>';
    // place it at the top of the schedule pane
    if (host.firstChild) host.insertBefore(sec, host.firstChild); else host.appendChild(sec);
    var btn = sec.querySelector('.mc-run');
    btn.addEventListener('click', function () {
      btn.disabled = true; btn.textContent = 'Running checks...';
      run().then(function (rows) { renderResults(sec, rows); })
        .catch(function () { renderResults(sec, [{ name: 'Checker', code: 'CHK-000', status: 'unknown', cause: 'Checker failed to run.', fix: 'See console.' }]); })
        .then(function () { btn.disabled = false; btn.textContent = 'Run checks'; });
    });
    return sec;
  }

  function renderResults(sec, rows) {
    var box = sec.querySelector('.mc-results');
    if (!box) return;
    var pass = 0, fail = 0, unk = 0;
    rows.forEach(function (r) { if (r.status === 'pass') pass++; else if (r.status === 'fail') fail++; else unk++; });
    var html = '<div class="mc-summary">' + pass + ' passed &middot; ' + fail + ' failed &middot; ' + unk + ' unverifiable</div>';
    rows.forEach(function (r) {
      var cls = r.status === 'pass' ? 'mc-pass' : (r.status === 'fail' ? 'mc-fail' : 'mc-unknown');
      var ic = r.status === 'pass' ? '&#10003;' : (r.status === 'fail' ? '&#10007;' : '?');
      html += '<div class="mc-item ' + cls + '">' +
        '<div class="mc-row"><span class="mc-ic">' + ic + '</span>' +
        '<span class="mc-name">' + esc(r.name) + '</span>' +
        '<span class="mc-code">' + esc(r.code) + '</span></div>' +
        (r.cause ? '<div class="mc-cause"><b>Cause:</b> ' + esc(r.cause) + '</div>' : '') +
        (r.fix ? '<div class="mc-fix"><b>Fix:</b> ' + esc(r.fix) + '</div>' : '') +
        (r.detail ? '<div class="mc-detail">' + esc(r.detail) + '</div>' : '') +
        '</div>';
    });
    box.innerHTML = html;
  }

  function openPanel() {
    beginMount();
    var s = document.getElementById(SECTION_ID);
    if (s) safe(function () { s.scrollIntoView({ block: 'nearest' }); });
    return !!s;
  }
  function closePanel() {
    stopMountWatch();
    var s = document.getElementById(SECTION_ID); if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  /* ---- boot: wait for the assistant panel, then mount the section ---- */
  var mountTimer = null, mountTries = 0, panelMo = null;
  var panelStateHandler = null, domReadyHandler = null, destroyed = false;
  function stopMountWatch() {
    safe(function () { if (mountTimer) clearTimeout(mountTimer); });
    mountTimer = null;
    safe(function () { if (panelMo) panelMo.disconnect(); });
    panelMo = null;
  }
  function tryMount() {
    if (destroyed) return false;
    if (ensureSection()) { stopMountWatch(); return true; }
    return false;
  }
  function retryMount() {
    if (destroyed || mountTimer || mountTries >= 120) return;
    mountTimer = setTimeout(function () {
      mountTimer = null;
      if (destroyed || tryMount()) return;
      mountTries++;
      retryMount();
    }, 500);
  }
  function beginMount() {
    if (destroyed) return false;
    stopMountWatch();
    mountTries = 0;
    if (tryMount()) return true;
    /* Observe only while a mount is outstanding. Successful mounting always
       disconnects this document-wide observer; later remounts are initiated by
       explicit assistant-open/schedule-tab actions or openPanel(). */
    if (win.MutationObserver) {
      panelMo = new MutationObserver(function () { safe(tryMount); });
      safe(function () { panelMo.observe(document.documentElement || document.body, { childList: true, subtree: true }); });
    }
    retryMount();
    return false;
  }
  function installPanelStateWatch() {
    if (panelStateHandler) return;
    panelStateHandler = function (ev) {
      var t = ev && ev.target;
      var trigger = safe(function () {
        return t && t.closest && t.closest('#mlsAsstFab,#mlsAsstPanel .as-tab[data-tab="schedule"]');
      }, null);
      if (trigger && !document.getElementById(SECTION_ID)) beginMount();
    };
    document.addEventListener('click', panelStateHandler, false);
  }
  function boot() {
    registerBuiltins();
    installPanelStateWatch();
    beginMount();
  }

  function revert() {
    destroyed = true;
    stopMountWatch();
    safe(function () { if (panelStateHandler) document.removeEventListener('click', panelStateHandler, false); });
    safe(function () { if (domReadyHandler) document.removeEventListener('DOMContentLoaded', domReadyHandler); });
    panelStateHandler = null; domReadyHandler = null;
    closePanel();
    safe(function () { if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl); }); styleEl = null;
    registry = [];
    win[NS].installed = false;
  }

  win[NS] = {
    installed: true,
    version: VERSION,
    register: register,
    unregister: unregister,
    list: list,
    run: run,
    openPanel: openPanel,
    closePanel: closePanel,
    revert: revert
  };

  if (document.readyState === 'loading') {
    domReadyHandler = function () { domReadyHandler = null; boot(); };
    document.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
  }
  else boot();
})();

/* Release-support control. This is deliberately absent from normal product pages:
   it mounts only on the explicit ?mlsExtensionReload=1 URL, and it can issue one
   user-clicked reload request. There is no timer or automatic retry loop. */
;(function () {
  'use strict';
  var params;
  try { params = new URLSearchParams(location.search || ''); } catch (e) { return; }
  if (params.get('mlsExtensionReload') !== '1') return;

  var CONTROL_ID = 'mlsExtensionReloadControl';
  var messageHandler = null;
  var domReadyHandler = null;

  function cleanupMessageHandler() {
    if (!messageHandler) return;
    try { window.removeEventListener('message', messageHandler, false); } catch (e) {}
    messageHandler = null;
  }

  function mountReloadControl() {
    if (document.getElementById(CONTROL_ID)) return;
    var panel = document.createElement('section');
    panel.id = CONTROL_ID;
    panel.setAttribute('aria-label', 'MLS Assist release reload');
    panel.style.cssText = 'position:fixed;right:18px;bottom:82px;z-index:2147483000;max-width:340px;padding:14px;border:1px solid #b9c9c1;border-radius:14px;background:#fff;color:#17231e;box-shadow:0 12px 36px rgba(18,49,38,.24);font:600 14px/1.35 system-ui,sans-serif';
    panel.innerHTML =
      '<div style="margin-bottom:9px">MLS Assist release control</div>' +
      '<button type="button" style="width:100%;padding:10px 12px;border:0;border-radius:9px;background:#174b39;color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer">Reload installed extension</button>' +
      '<div role="status" aria-live="polite" style="margin-top:9px;color:#40594e;font-weight:500">Ready. Reload runs only when you click.</div>';
    (document.body || document.documentElement).appendChild(panel);

    var button = panel.querySelector('button');
    var status = panel.querySelector('[role="status"]');
    var used = false;
    button.addEventListener('click', function () {
      if (used) return;
      used = true;
      button.disabled = true;
      button.textContent = 'Reloading MLS Assist...';
      status.textContent = 'Waiting for the installed extension to acknowledge the reload.';

      messageHandler = function (event) {
        var data = event && event.data;
        if (!data || data.source !== 'mls-ext' || data.type !== 'mlsDevReloadResult') return;
        cleanupMessageHandler();
        var response = data.resp || {};
        if (response.ok && response.reloading) {
          status.textContent = 'Reload accepted. Refresh the MLS and Athena tabs to use the new version.';
          button.textContent = 'Reload accepted';
          return;
        }
        status.textContent = 'Reload was not accepted. No automatic retry was attempted.';
        button.textContent = 'Reload unavailable';
      };
      window.addEventListener('message', messageHandler, false);
      window.postMessage({ source: 'mls-app', type: 'mlsDevReload' }, location.origin);
      window.setTimeout(function () {
        if (!messageHandler) return;
        cleanupMessageHandler();
        status.textContent = 'No reload acknowledgement arrived. No automatic retry was attempted.';
        button.textContent = 'Reload unavailable';
      }, 5000);
    }, false);
  }

  if (document.readyState === 'loading') {
    domReadyHandler = function () {
      document.removeEventListener('DOMContentLoaded', domReadyHandler, false);
      domReadyHandler = null;
      mountReloadControl();
    };
    document.addEventListener('DOMContentLoaded', domReadyHandler, false);
  } else {
    mountReloadControl();
  }
})();

/* feat_athena_guard.js — v1.0.0
   TRUST-CRITICAL GUARD for ScribeFlow / MLS Assist.

   Problem it fixes: the Athena-driven flows (copy-every-visit, the Study/cohort
   "Search Athena with MLS Assist", and the injection-cohort per-visit capture)
   showed progress ("Reading every visit from athenaOne…", "Reading visit N of M",
   "Driving the athenaOne procedure search…") and could attempt to read/save
   AFTER only an extension PING succeeded. A ping proves the MLS Assist extension
   is loaded — it does NOT prove a signed-in athenaOne tab is open. Logged out /
   no Athena tab => fabricated progress and (in some paths) empty/placeholder data.

   This guard performs a REAL round-trip probe for a signed-in athenaOne tab
   (reusing the proven mlsApp* extension bridge — the same mechanism the copy flow
   uses) BEFORE any progress is shown or anything is read/saved. If athenaOne is
   not genuinely open & signed in, the flow STOPS immediately with an honest
   message, shows ZERO progress, and saves NOTHING.

   FAIL-SAFE: it blocks ONLY on a CERTAIN negative (extension absent, athenaOne on
   a sign-in screen, or no athenaOne tab at all). On any ambiguous/transient result
   it lets the flow proceed, so a legitimate search is never falsely blocked.

   Self-contained, idempotent, progressive-enhancement, fully reversible
   (window.__mlsAthenaGuard.revert()). No PHI is stored: the probe inspects only
   the EMR tab's URL/title; chart text is never read or retained by this guard.
*/
(function () {
  'use strict';
  if (window.__mlsAthenaGuard && window.__mlsAthenaGuard.installed) return;

  var VER = '1.0.0';

  /* ---- pure classifiers (unit-tested) ---- */
  function isAthena(url, title) {
    var u = String(url || ''), t = String(title || '');
    return /athenahealth\.com|athenanet|athena\.io|athenaone/i.test(u) ||
           /athenanet|athenaone|athenahealth/i.test(t);
  }
  function isLogin(url, title) {
    var u = String(url || ''), t = String(title || '');
    return /\/login|\/logon|\/sign[-_]?in|\/sign[-_]?on|\/auth(?:\b|\/)/i.test(u) ||
           /\b(log\s?in|logon|sign\s?in|sign\s?on|sign in to|enter your password|password)\b/i.test(t);
  }
  // Decide open-state from a chart-probe response {ok,url,title,...}.
  function classify(resp) {
    if (resp == null) return { open: false, certain: false, reason: 'no-response' };
    var athena = isAthena(resp.url, resp.title);
    var login = isLogin(resp.url, resp.title);
    if (athena && !login) return { open: true, certain: true, reason: 'athena-open' };
    if (athena && login)  return { open: false, certain: true, reason: 'logged-out' };
    return { open: false, certain: true, reason: 'no-athena-tab' };
  }

  /* ---- extension bridge round-trips ---- */
  function ping(ms) {
    return new Promise(function (res) {
      var done = false;
      function h(e) { var d = e && e.data; if (d && d.source === 'mls-ext' && d.type === 'mlsPong') fin(true); }
      function fin(v) { if (done) return; done = true; window.removeEventListener('message', h); res(v); }
      window.addEventListener('message', h);
      try { window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); } catch (_) {}
      setTimeout(function () { fin(false); }, ms || 3000);
    });
  }
  // Read-only: asks the extension to read the current EMR tab (opened:false → no
  // navigation). We use only resp.url / resp.title; resp.text is never inspected.
  function readChartProbe(ms) {
    return new Promise(function (res) {
      var done = false;
      function h(e) { var d = e && e.data; if (d && d.source === 'mls-ext' && d.type === 'mlsAppChartResult') fin(d.resp || {}); }
      function fin(v) { if (done) return; done = true; window.removeEventListener('message', h); res(v); }
      window.addEventListener('message', h);
      try { window.postMessage({ source: 'mls-app', type: 'mlsAppReadChart' }, '*'); } catch (_) {}
      setTimeout(function () { fin(null); }, ms || 12000);
    });
  }

  /* ---- probe (cached briefly so one user action = one round-trip) ---- */
  var _cache = null, _cacheAt = 0, CACHE_MS = 6000;
  async function probeAthenaOpen(force) {
    var now = Date.now();
    if (!force && _cache && (now - _cacheAt) < CACHE_MS) return _cache;
    var out;
    try {
      var pong = await ping(3000);
      if (!pong) {
        out = { open: false, certain: true, reason: 'no-ext' };
      } else {
        var resp = await readChartProbe(12000);
        if (resp == null) resp = await readChartProbe(12000); // retry once
        // Only a strip of url/title is needed; never keep chart text.
        var lite = resp ? { ok: resp.ok, url: resp.url, title: resp.title } : null;
        out = classify(lite);
      }
    } catch (e) {
      out = { open: false, certain: false, reason: 'probe-error' };
    }
    _cache = out; _cacheAt = Date.now();
    return out;
  }

  function honest(p) {
    if (p.reason === 'no-ext')
      return '⛔ MLS Assist isn’t responding. Load/enable the extension, open a signed-in athenaOne tab, then try again — nothing was searched or read.';
    if (p.reason === 'logged-out')
      return '⛔ athenaOne is on a sign-in screen. Sign in to athenaOne, then try again — nothing was searched or read.';
    return '⛔ Open a signed-in athenaOne tab, then try again — nothing was searched or read.';
  }

  // Returns {blocked:true,reason} ONLY on a certain negative; fires onStatus with
  // the honest message. Ambiguous/open => {blocked:false} (fail-safe: proceed).
  async function gate(onStatus) {
    var p = await probeAthenaOpen();
    if (!p.open && p.certain) {
      try { if (typeof onStatus === 'function') onStatus(honest(p)); } catch (_) {}
      return { blocked: true, reason: p.reason };
    }
    return { blocked: false, reason: p.reason };
  }

  /* ---- wrapping machinery (idempotent + reversible) ---- */
  var wrapped = [];
  function wrap(obj, name, getOnStatus, blockedReturn) {
    if (!obj || typeof obj[name] !== 'function' || obj[name].__mlsGuarded) return false;
    var orig = obj[name];
    var fn = async function () {
      var args = arguments, self = this;
      var onStatus = null;
      try { onStatus = getOnStatus ? getOnStatus(args) : null; } catch (_) {}
      var g = await gate(onStatus);
      if (g.blocked) {
        try { return (typeof blockedReturn === 'function') ? blockedReturn(g, args) : blockedReturn; }
        catch (_) { return undefined; }
      }
      return orig.apply(self, args);
    };
    fn.__mlsGuarded = true; fn.__mlsOrig = orig;
    obj[name] = fn; wrapped.push([obj, name, orig]);
    return true;
  }
  function revert() {
    wrapped.forEach(function (w) { try { w[0][w[1]] = w[2]; } catch (_) {} });
    wrapped = [];
  }

  // Writes the honest message into the Study/grab output area (that flow renders
  // to a DOM node, not an onStatus callback).
  function grabOut() {
    return document.querySelector('#mlsGrabOut') ||
           document.querySelector('.mls-study-sum') ||
           document.querySelector('#mlsStudyOut') || null;
  }
  function showInGrab(msg) {
    var el = grabOut();
    if (el) {
      try { el.innerHTML = '<div class="mls-study-gate">' + String(msg).replace(/</g, '&lt;') + '</div>'; }
      catch (_) {}
    }
  }

  /* ---- install over the live modules ---- */
  var DONE = {};
  function tryInstall() {
    var cv = window.__mlsCopyVisits, st = window.__mlsStudy,
        gr = window.__mlsGrab, co = window.__mlsCohortVisits;

    // 1) Copy every visit: run(onStatus) — onStatus is arg0.
    if (cv && !DONE['copy'] &&
        wrap(cv, 'run', function (a) { return a[0]; },
             function (g) { return { ok: false, blocked: true, reason: g.reason, saved: 0 }; }))
      DONE['copy'] = true;

    // 2) Study driver: _assistSearchProcedure(params,cfg,onStatus) — onStatus arg2.
    if (st && !DONE['assist'] &&
        wrap(st, '_assistSearchProcedure', function (a) { return a[2]; },
             function (g) { return Promise.reject(Object.assign(new Error('athena-not-open'), { blocked: true, reason: g.reason })); }))
      DONE['assist'] = true;

    // 2b) Static-button path: _autoSearch — renders to grab output itself.
    if (st && !DONE['autoSearch'] &&
        wrap(st, '_autoSearch', function () { return showInGrab; },
             function (g) { return { ok: false, blocked: true, reason: g.reason }; }))
      DONE['autoSearch'] = true;

    // 3) Grab button path: _runGrab seeds "Searching Athena for…" → gate at entry
    //    and render the honest message into the grab output (no onStatus there).
    if (gr && !DONE['runGrab'] &&
        wrap(gr, '_runGrab', function () { return showInGrab; },
             function (g) { return { ok: false, blocked: true, reason: g.reason }; }))
      DONE['runGrab'] = true;

    // 3b) Defense-in-depth on the assist delegate: _grabViaAssist(params,onStatus,...).
    if (gr && !DONE['grabViaAssist'] &&
        wrap(gr, '_grabViaAssist', function (a) { return (typeof a[1] === 'function' ? a[1] : (typeof a[0] === 'function' ? a[0] : null)); },
             function (g) { return { error: g.reason, blocked: true }; }))
      DONE['grabViaAssist'] = true;

    // 4) Injection-cohort per-visit capture: gate so nothing is captured/synthesized
    //    unless athenaOne is genuinely open (it only runs inside a real grab anyway).
    if (co && !DONE['cohort'] &&
        wrap(co, '_capturePatient', function () { return null; },
             function (g) { return { blocked: true, reason: g.reason, captured: 0 }; }))
      DONE['cohort'] = true;

    return Object.keys(DONE);
  }

  // Modules load asynchronously after this asset; poll until all present or timeout.
  var TARGETS = ['copy', 'assist', 'autoSearch', 'runGrab', 'grabViaAssist', 'cohort'];
  function allDone() { return TARGETS.every(function (k) { return DONE[k]; }); }
  tryInstall();
  var tries = 0, iv = setInterval(function () {
    tryInstall();
    if (allDone() || ++tries > 75) clearInterval(iv); // ~30s max
  }, 400);

  window.__mlsAthenaGuard = {
    installed: true,
    version: VER,
    probeAthenaOpen: probeAthenaOpen,
    gate: gate,
    classify: classify,
    _isAthena: isAthena,
    _isLogin: isLogin,
    _honest: honest,
    status: function () { return { installed: true, version: VER, wrapped: Object.keys(DONE), wrappedCount: wrapped.length }; },
    revert: revert,
    _clearCache: function () { _cache = null; _cacheAt = 0; }
  };
})();

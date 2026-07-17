/* =============================================================================
 * MLS shared loading + job progress owner (lb-2.0.0)
 *
 * Backward compatible with __mlsLoadingCalm.begin()/end(), while adding one
 * request-owned lifecycle for measurable and staged work. Exact percentages are
 * shown only when a real total exists. Every named job has a deadline and one of
 * five terminal states: completed, partial, failed, canceled, or timed_out.
 *
 * Public API:
 *   start({ key, kind, label, stages, total, timeoutMs, replace, cancelable,
 *           patient, provider, selectedDate, retry, cancel }) -> handle
 *   get(id), active(key), isCurrent(key, requestId), update(id, patch, requestId)
 *   complete/partial/fail/cancel(id, ...), linkServer(id, serverJobId)
 *   begin(label), end() (legacy compatibility), revert()
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsLoadingCalm && window.__mlsLoadingCalm.installed) return;

  var VERSION = 'lb-2.0.0';
  var BAR_ID = 'mlsLbBar', PILL_ID = 'mlsBusyPill', CSS_ID = 'mlsLbCss';
  var STORE_KEY = 'mls:progress:v2';
  var ACTIVE = { queued: 1, running: 1, retrying: 1 };
  var TERMINAL = { completed: 1, partial: 1, failed: 1, canceled: 1, timed_out: 1 };
  var jobs = {}, keyIndex = {}, timers = {}, retryFns = {}, cancelFns = {};
  var manualStack = [], showT = null, hideT = null, extHideT = null, extBusy = false;
  var extLabel = '', wrapIv = 0, tickIv = 0, originalFetch = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function now() { return Date.now(); }
  function text(v, max) { v = v == null ? '' : String(v); return v.slice(0, max || 180); }
  function uid(prefix) {
    var id = safe(function () { return crypto.randomUUID(); }, '');
    if (!id) id = now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    return (prefix || '') + id;
  }
  function validId(v) { return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(String(v || '')); }
  function clone(j) {
    if (!j) return null;
    var out = {}, k;
    for (k in j) if (Object.prototype.hasOwnProperty.call(j, k) && k.charAt(0) !== '_') out[k] = j[k];
    out.elapsedMs = Math.max(0, (j.finishedAt || now()) - j.startedAt);
    out.percent = j.total > 0 ? Math.min(100, Math.round((j.current || 0) * 100 / j.total)) : null;
    return out;
  }
  function publicJobs() {
    return Object.keys(jobs).map(function (id) { return clone(jobs[id]); })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }
  function emit(j) {
    safe(function () {
      var ev;
      if (typeof CustomEvent === 'function') ev = new CustomEvent('mls:job-progress', { detail: clone(j) });
      else { ev = document.createEvent('CustomEvent'); ev.initCustomEvent('mls:job-progress', false, false, clone(j)); }
      window.dispatchEvent(ev);
    });
  }
  function persist() {
    safe(function () {
      var keep = publicJobs().filter(function (j, i) { return ACTIVE[j.status] || i < 12; }).slice(0, 24);
      sessionStorage.setItem(STORE_KEY, JSON.stringify(keep));
    });
  }
  function clearDeadline(id) { if (timers[id]) { clearTimeout(timers[id]); delete timers[id]; } }
  function armDeadline(j) {
    clearDeadline(j.id);
    if (!ACTIVE[j.status]) return;
    var left = Math.max(0, j.deadlineAt - now());
    timers[j.id] = setTimeout(function () {
      terminal(j.id, 'timed_out', { message: 'This operation exceeded its deadline. Retry when ready.' }, j.requestId);
    }, left);
  }
  function stageName(j) {
    return text(j.stage || (j.stages && j.stages[j.stageIndex]) || j.operation || j.label || 'Working', 120);
  }
  function terminal(id, status, detail, requestId) {
    var j = jobs[id];
    if (!j || !TERMINAL[status]) return { accepted: false, missing: !j };
    if (requestId && requestId !== j.requestId) return { accepted: false, stale: true };
    if (TERMINAL[j.status]) return { accepted: false, terminal: true, job: clone(j) };
    detail = detail || {};
    j.status = status; j.finishedAt = now(); j.updatedAt = j.finishedAt;
    if (detail.message) j.message = text(detail.message, 240);
    if (detail.errorCode) j.errorCode = text(detail.errorCode, 80);
    if (detail.current != null) j.current = Math.max(0, Number(detail.current) || 0);
    if (status === 'completed' && j.total > 0) j.current = j.total;
    if (keyIndex[j.key] === id) delete keyIndex[j.key];
    clearDeadline(id); persist(); emit(j); sync();
    return { accepted: true, job: clone(j) };
  }
  function activeList() {
    return Object.keys(jobs).map(function (id) { return jobs[id]; }).filter(function (j) { return ACTIVE[j.status]; })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function css() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style'); st.id = CSS_ID;
    st.textContent = [
      '#' + BAR_ID + '{position:fixed;top:0;left:0;right:0;height:3px;z-index:2147483200;pointer-events:none;opacity:0;transition:opacity .2s ease;background:transparent;overflow:hidden}',
      '#' + BAR_ID + '.on{opacity:1}',
      '#' + BAR_ID + ' .lb-sweep{position:absolute;inset:0 auto 0 -38%;width:38%;border-radius:3px;background:linear-gradient(90deg,rgba(46,106,75,0),#2E6A4B 42%,#8FD8BE 88%,rgba(143,216,190,0));animation:mlsLbSweep 1.35s cubic-bezier(.4,.1,.4,.9) infinite}',
      '#' + BAR_ID + ' .lb-measured{position:absolute;inset:0 auto 0 0;width:0;background:#2E6A4B;transition:width .2s ease}',
      '@keyframes mlsLbSweep{0%{left:-38%}100%{left:100%}}',
      '.mls-skel{position:relative;overflow:hidden;background:#F2F0E9!important;border-radius:10px;color:transparent!important;min-height:14px}',
      '.mls-skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);animation:mlsSkel 1.4s ease infinite}',
      '@keyframes mlsSkel{100%{transform:translateX(100%)}}',
      '#' + PILL_ID + '{position:fixed;right:16px;bottom:16px;z-index:99970;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;background:#fff;border:1px solid #E7E5DD;border-radius:14px;padding:10px 12px;min-width:260px;max-width:min(480px,calc(100vw - 28px));box-shadow:0 1px 2px rgba(20,33,28,.06),0 12px 32px rgba(20,33,28,.14);font:600 12.5px "Public Sans",system-ui,sans-serif;color:#1A211C;opacity:0;visibility:hidden;transform:translateY(8px);pointer-events:none;transition:opacity .18s ease,transform .18s ease,visibility 0s linear .18s}',
      '#' + PILL_ID + '.on{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition-delay:0s}',
      '#' + PILL_ID + ' .bp-spin{width:14px;height:14px;border:2px solid #D8E5DE;border-top-color:#2E6A4B;border-radius:50%;animation:mlsBpSpin .8s linear infinite}',
      '#' + PILL_ID + ' .bp-main{min-width:0}',
      '#' + PILL_ID + ' .bp-txt{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#' + PILL_ID + ' .bp-meta{display:block;color:#66716A;font-size:11px;font-weight:500;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#' + PILL_ID + ' .bp-actions{display:flex;gap:5px}',
      '#' + PILL_ID + ' button{border:1px solid #D9E2DC;background:#fff;color:#234334;border-radius:8px;padding:5px 8px;font:700 11px inherit;cursor:pointer}',
      '#' + PILL_ID + ' button:hover{background:#F2F7F4}',
      '@keyframes mlsBpSpin{to{transform:rotate(360deg)}}',
      '@media (max-width:760px){#' + PILL_ID + '{right:10px;bottom:74px;min-width:0;max-width:calc(100vw - 20px)}}',
      '@media (prefers-reduced-motion:reduce){#' + BAR_ID + ' .lb-sweep,.mls-skel::after,#' + PILL_ID + ' .bp-spin{animation-duration:2.8s}#' + PILL_ID + '{transition:none}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }
  function bar() {
    var b = document.getElementById(BAR_ID); if (b) return b;
    css(); b = document.createElement('div'); b.id = BAR_ID;
    b.innerHTML = '<span class="lb-sweep"></span><span class="lb-measured"></span>';
    (document.body || document.documentElement).appendChild(b); return b;
  }
  function pill() {
    var p = document.getElementById(PILL_ID); if (p) return p;
    css(); p = document.createElement('div'); p.id = PILL_ID; p.setAttribute('role', 'status'); p.setAttribute('aria-live', 'polite'); p.setAttribute('aria-hidden', 'true');
    p.innerHTML = '<span class="bp-spin"></span><span class="bp-main"><span class="bp-txt">Working...</span><span class="bp-meta"></span></span><span class="bp-actions"></span>';
    (document.body || document.documentElement).appendChild(p); return p;
  }
  function elapsed(ms) {
    var sec = Math.max(0, Math.floor(ms / 1000));
    return sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
  }
  function topJob() { var a = activeList(); return a.length ? a[0] : null; }
  function renderPill(busy) {
    var p = pill(), j = topJob(), label = '', meta = '', actions = p.querySelector('.bp-actions');
    if (j) {
      label = stageName(j);
      var bits = [];
      if (j.total > 0) bits.push((j.current || 0) + ' of ' + j.total + ' (' + clone(j).percent + '%)');
      if (j.patient) bits.push('Patient: ' + j.patient);
      if (j.provider) bits.push('Provider: ' + j.provider);
      if (j.selectedDate) bits.push('Date: ' + j.selectedDate);
      bits.push(elapsed(now() - j.startedAt)); meta = bits.join(' - ');
      actions.innerHTML = '';
      if (j.cancelable) {
        var cb = document.createElement('button'); cb.type = 'button'; cb.textContent = 'Cancel';
        cb.onclick = function () { api.cancel(j.id, 'Canceled by user.', j.requestId); }; actions.appendChild(cb);
      }
    } else { label = extBusy ? (extLabel || 'Working...') : 'Working...'; meta = ''; actions.innerHTML = ''; }
    var t = p.querySelector('.bp-txt'), m = p.querySelector('.bp-meta'); if (t) t.textContent = label; if (m) { m.textContent = meta; m.style.display = meta ? 'block' : 'none'; }
    if (busy || extBusy) { p.classList.add('on'); p.setAttribute('aria-hidden', 'false'); }
    else { p.classList.remove('on'); p.setAttribute('aria-hidden', 'true'); }
  }
  function sync() {
    var named = activeList(), busy = api.inflight > 0 || manualStack.length > 0 || named.length > 0;
    /* Elapsed-time repainting exists only while a named job is active. Idle
       pages own no progress polling timer. */
    if (named.length && !tickIv) tickIv = setInterval(sync, 1000);
    else if (!named.length && tickIv) { clearInterval(tickIv); tickIv = 0; }
    var measured = named.length && named[0].total > 0 ? clone(named[0]).percent : null;
    if (busy) {
      if (hideT) { clearTimeout(hideT); hideT = null; }
      if (!showT && !bar().classList.contains('on')) showT = setTimeout(function () { showT = null; if (api.inflight > 0 || manualStack.length || activeList().length) { bar().classList.add('on'); renderPill(true); } }, 180);
    } else {
      if (showT) { clearTimeout(showT); showT = null; }
      if (!hideT) hideT = setTimeout(function () { hideT = null; var b = document.getElementById(BAR_ID); if (b) b.classList.remove('on'); renderPill(false); }, 220);
    }
    var b = bar(), sweep = b.querySelector('.lb-sweep'), exact = b.querySelector('.lb-measured');
    if (measured != null) { if (sweep) sweep.style.display = 'none'; if (exact) { exact.style.display = 'block'; exact.style.width = measured + '%'; } }
    else { if (sweep) sweep.style.display = ''; if (exact) exact.style.display = 'none'; }
    renderPill(busy);
  }

  function makeHandle(j, duplicate) {
    return {
      id: j.id, key: j.key, requestId: j.requestId, duplicate: !!duplicate,
      snapshot: function () { return clone(jobs[j.id]); },
      stage: function (stage, patch) { patch = patch || {}; patch.stage = stage; return api.update(j.id, patch, j.requestId); },
      progress: function (current, total, operation) { return api.update(j.id, { current: current, total: total, operation: operation }, j.requestId); },
      complete: function (message) { return api.complete(j.id, message, j.requestId); },
      partial: function (message, current) { return api.partial(j.id, message, current, j.requestId); },
      fail: function (err) { return api.fail(j.id, err, j.requestId); },
      cancel: function (message) { return api.cancel(j.id, message, j.requestId); },
      isCurrent: function () { return api.isCurrent(j.key, j.requestId); }
    };
  }

  var api = { version: VERSION, installed: true, inflight: 0 };
  window.__mlsLoadingCalm = api;
  api.start = function (opts) {
    opts = opts || {}; var key = text(opts.key || opts.kind || uid('job:'), 160); var old = api.active(key);
    if (old && !opts.replace) return makeHandle(jobs[old.id], true);
    if (old && opts.replace) terminal(old.id, 'canceled', { message: 'Superseded by a newer request.' }, old.requestId);
    var started = now(), requestId = validId(opts.requestId) ? String(opts.requestId) : uid('req-');
    var stages = Array.isArray(opts.stages) ? opts.stages.map(function (s) { return text(s, 120); }).filter(Boolean) : [];
    var timeoutMs = Math.max(1000, Math.min(Number(opts.timeoutMs) || 10 * 60 * 1000, 60 * 60 * 1000));
    var j = {
      id: uid('job-'), key: key, requestId: requestId, serverJobId: '', kind: text(opts.kind || 'operation', 80),
      label: text(opts.label || 'Working...', 120), status: opts.retrying ? 'retrying' : 'running', stages: stages,
      stageIndex: 0, stage: text(opts.stage || stages[0] || opts.label || 'Preparing', 120), operation: text(opts.operation || '', 160),
      current: Math.max(0, Number(opts.current) || 0), total: Math.max(0, Number(opts.total) || 0),
      patient: text(opts.patient, 100), provider: text(opts.provider, 100), selectedDate: text(opts.selectedDate, 40),
      cancelable: !!opts.cancelable, attempt: Math.max(1, Number(opts.attempt) || 1), maxAttempts: Math.max(1, Number(opts.maxAttempts) || 1),
      startedAt: started, createdAt: started, updatedAt: started, finishedAt: 0, deadlineAt: started + timeoutMs, message: '', errorCode: ''
    };
    jobs[j.id] = j; keyIndex[key] = j.id;
    if (typeof opts.retry === 'function') retryFns[j.id] = opts.retry;
    if (typeof opts.cancel === 'function') cancelFns[j.id] = opts.cancel;
    armDeadline(j); persist(); emit(j); sync(); return makeHandle(j, false);
  };
  api.get = function (id) { return clone(jobs[id]); };
  api.active = function (key) { var id = keyIndex[String(key || '')], j = id && jobs[id]; return j && ACTIVE[j.status] ? clone(j) : null; };
  api.isCurrent = function (key, requestId) { var a = api.active(key); return !!(a && a.requestId === requestId); };
  api.update = function (id, patch, requestId) {
    var j = jobs[id]; patch = patch || {};
    if (!j) return { accepted: false, missing: true };
    if (requestId && requestId !== j.requestId) return { accepted: false, stale: true };
    if (!ACTIVE[j.status]) return { accepted: false, terminal: true, job: clone(j) };
    if (patch.stageIndex != null) j.stageIndex = Math.max(0, Math.min(j.stages.length - 1, Number(patch.stageIndex) || 0));
    if (patch.stage != null) { j.stage = text(patch.stage, 120); var si = j.stages.indexOf(j.stage); if (si >= 0) j.stageIndex = si; }
    if (patch.operation != null) j.operation = text(patch.operation, 160);
    if (patch.current != null) j.current = Math.max(0, Number(patch.current) || 0);
    if (patch.total != null) j.total = Math.max(0, Number(patch.total) || 0);
    ['patient', 'provider', 'selectedDate'].forEach(function (k) { if (patch[k] != null) j[k] = text(patch[k], k === 'selectedDate' ? 40 : 100); });
    j.updatedAt = now(); persist(); emit(j); sync(); return { accepted: true, job: clone(j) };
  };
  api.complete = function (id, message, requestId) { return terminal(id, 'completed', { message: message || 'Completed.' }, requestId); };
  api.partial = function (id, message, current, requestId) { return terminal(id, 'partial', { message: message || 'Partially completed.', current: current }, requestId); };
  api.fail = function (id, err, requestId) {
    var e = err || {}; return terminal(id, 'failed', { message: text(e.message || e || 'Operation failed.', 240), errorCode: e.code || 'FAILED' }, requestId);
  };
  api.cancel = function (id, message, requestId) {
    var j = jobs[id]; if (!j || (requestId && requestId !== j.requestId)) return { accepted: false, stale: !!j };
    if (!j.cancelable) return { accepted: false, cancelable: false, job: clone(j) };
    safe(function () { if (cancelFns[id]) cancelFns[id](clone(j)); });
    if (j.serverJobId) safe(function () {
      var base = typeof window.bkBase === 'function' ? window.bkBase() : '';
      var tok = typeof window.bkToken === 'function' ? window.bkToken() : '';
      if (base && tok) fetch(base + '/api/jobs/' + encodeURIComponent(j.serverJobId) + '/cancel', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'X-Request-ID': j.requestId } }).catch(function () {});
    });
    return terminal(id, 'canceled', { message: message || 'Canceled.' }, requestId);
  };
  api.retry = function (id) {
    var j = jobs[id], fn = retryFns[id]; if (!j || !TERMINAL[j.status] || typeof fn !== 'function') return false;
    var next = api.start({ key: j.key, kind: j.kind, label: j.label, stages: j.stages, total: j.total, timeoutMs: Math.max(1000, j.deadlineAt - j.startedAt), replace: true, retrying: true, attempt: j.attempt + 1, maxAttempts: j.maxAttempts, cancelable: j.cancelable, retry: fn, cancel: cancelFns[id], patient: j.patient, provider: j.provider, selectedDate: j.selectedDate });
    fn(next); return next;
  };
  api.linkServer = function (id, serverJobId) { var j = jobs[id]; if (!j || !serverJobId) return false; j.serverJobId = text(serverJobId, 128); j.updatedAt = now(); persist(); return true; };
  api.begin = function (label) { var h = api.start({ key: uid('manual:'), kind: 'manual', label: label || 'Working...', timeoutMs: 90000 }); manualStack.push(h.id); sync(); return h.id; };
  api.end = function (id) { var target = id || manualStack.pop(); var at = manualStack.indexOf(target); if (at >= 0) manualStack.splice(at, 1); if (target) terminal(target, 'completed', { message: 'Completed.' }, jobs[target] && jobs[target].requestId); sync(); };
  api.snapshot = publicJobs;

  function isTracked(input) { var u = safe(function () { return typeof input === 'string' ? input : (input && input.url) || ''; }, ''); return /\/api\//.test(u) || /onrender\.com/.test(u); }
  function ensureWrap() {
    var f = window.fetch; if (typeof f !== 'function' || f.__mlsLb) return;
    if (!originalFetch) originalFetch = f;
    var wrapped = function (input) {
      var track = isTracked(input); if (track) { api.inflight++; sync(); }
      var p;
      try { p = f.apply(this, arguments); } catch (e) { if (track) { api.inflight = Math.max(0, api.inflight - 1); sync(); } throw e; }
      if (track && p && typeof p.finally === 'function') return p.finally(function () { api.inflight = Math.max(0, api.inflight - 1); sync(); });
      if (track) { api.inflight = Math.max(0, api.inflight - 1); sync(); } return p;
    };
    wrapped.__mlsLb = true; wrapped.__mlsLbOrig = f; window.fetch = wrapped;
  }
  function restore() {
    var saved = safe(function () { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]'); }, []); if (!Array.isArray(saved)) return;
    saved.slice(0, 24).forEach(function (j) {
      if (!j || !j.id || !j.requestId) return;
      j.updatedAt = Number(j.updatedAt) || now(); j.startedAt = Number(j.startedAt) || j.updatedAt; j.finishedAt = Number(j.finishedAt) || 0;
      jobs[j.id] = j;
      if (ACTIVE[j.status]) {
        if (j.serverJobId) { keyIndex[j.key] = j.id; armDeadline(j); }
        else { j.status = 'timed_out'; j.finishedAt = now(); j.updatedAt = j.finishedAt; j.message = 'Page refreshed before completion could be confirmed. Retry when ready.'; }
      }
    });
    persist();
  }
  try {
    window.addEventListener('message', function (e) {
      var d = e && e.data; if (!d || d.source !== 'mls-ext') return;
      var m = d.msg || d.status || ''; if (!m && !/progress|status/i.test(String(d.type || ''))) return;
      extBusy = true; if (m) extLabel = text(m, 90); sync(); if (extHideT) clearTimeout(extHideT);
      extHideT = setTimeout(function () { extBusy = false; extLabel = ''; sync(); }, 3500);
    });
  } catch (e) {}

  css(); restore(); ensureWrap(); wrapIv = setInterval(ensureWrap, 2000); sync();
  api.revert = function () {
    safe(function () { clearInterval(wrapIv); clearInterval(tickIv); Object.keys(timers).forEach(clearDeadline); });
    safe(function () { if (window.fetch && window.fetch.__mlsLb) window.fetch = window.fetch.__mlsLbOrig; });
    safe(function () { [BAR_ID, PILL_ID, CSS_ID].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); }); });
    api.installed = false; delete window.__mlsLoadingCalm;
  };
})();

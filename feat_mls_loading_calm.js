/* =============================================================================
 * MLS shared job-progress store (lb-2.1.0)
 *
 * Backward compatible with __mlsLoadingCalm.begin()/end(), while providing one
 * request-owned lifecycle for measurable and staged work. Exact percentages are
 * exposed only when a real total exists. Every named job has a deadline and one
 * of five terminal states: completed, partial, failed, canceled, or timed_out.
 *
 * This module is intentionally presentation-free. feat_mls_progress_stages.js
 * is the single visual owner for explicit jobs. Generic API requests and
 * extension status chatter never manufacture a floating loading surface.
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
  var VERSION = 'lb-2.1.0';
  var LEGACY_VISUAL_IDS = ['mlsLbBar', 'mlsBusyPill', 'mlsLbCss'];
  var RETIRED_CSS_ID = 'mlsLbRetiredCss';
  var STORE_KEY = 'mls:progress:v2';
  var ACTIVE = { queued: 1, running: 1, retrying: 1 };
  var TERMINAL = { completed: 1, partial: 1, failed: 1, canceled: 1, timed_out: 1 };
  var jobs = {}, keyIndex = {}, timers = {}, retryFns = {}, cancelFns = {};
  var manualStack = [];

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
  function retireLegacyVisuals() {
    safe(function () {
      LEGACY_VISUAL_IDS.forEach(function (id) {
        var el = document.getElementById(id); if (el && el.remove) el.remove();
      });
      var suppress = document.getElementById(RETIRED_CSS_ID);
      if (!suppress) {
        suppress = document.createElement('style');
        suppress.id = RETIRED_CSS_ID;
        suppress.textContent = '#mlsLbBar,#mlsBusyPill{display:none!important}';
        (document.head || document.documentElement).appendChild(suppress);
      }
    });
  }
  function sync() {
    /* State changes are emitted to the named-stage presentation owner. Keep
       this compatibility seam headless and clean up a pre-upgrade visual. */
    retireLegacyVisuals();
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

  /* Same-document backend refreshes must replace lb-2.0.0. Its anonymous
     bridge listener cannot be detached after the fact, so revert it, remove
     its nodes, and keep a static suppression rule in case that stale closure
     receives one last message before the new page settles. */
  var previous = safe(function () { return window.__mlsLoadingCalm; }, null);
  if (previous && previous.installed && previous.version === VERSION) { retireLegacyVisuals(); return; }
  if (previous) {
    safe(function () { if (typeof previous.revert === 'function') previous.revert(); });
    safe(function () { previous.installed = false; if (window.__mlsLoadingCalm === previous) delete window.__mlsLoadingCalm; });
  }
  retireLegacyVisuals();

  var api = { version: VERSION, installed: true, inflight: 0, visualOwner: 'mlsProgressStages' };
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
  restore(); sync();
  api.revert = function () {
    safe(function () { Object.keys(timers).forEach(clearDeadline); });
    retireLegacyVisuals();
    api.installed = false; delete window.__mlsLoadingCalm;
  };
})();

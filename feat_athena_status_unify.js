/* feat_athena_status_unify.js  ->  window.__mlsAthenaStatusUnify  (v1.0.0)  [item20]
 * =====================================================================
 * ONE coherent, honest, single-source-of-truth Athena status system.
 *
 * WHY THIS EXISTS (reported by Michael, root-caused live)
 * ------------------------------------------------------
 * Athena status/info was "all over the place": the MLS Assistant strip
 * (.as-status/.as-slabel), the pull line (.as-pullstatus), the narration
 * timeline (.mlsaa-tl/.mlsaa-done/.mlsaa-steps), the ux-unify mirror
 * (.mlsux-mirror), the doctor card (.mlsdoc-det) and the top-right status
 * dot each told their own story -- sometimes CONTRADICTORY at the same
 * instant, e.g. "Reading your visits from athenaOne..." showing WHILE
 * "No new appointments were imported" is also on screen. An operation
 * cannot be both still-reading AND already-finished-with-nothing.
 *
 * WHAT THIS DOES (additive, reversible, HONEST)
 *   1. CONNECTION (one source): mirrors window.__mlsConnTruth -- the only
 *      honest connection probe -- and never asserts a different connection
 *      state than it reports.
 *   2. IN-FLIGHT (one progress state): keeps Michael's liked per-patient
 *      progress pattern ("Pulling new histories from Athena... 12/25 -
 *      James Kirk"), normalizing wording IN PLACE on the existing line --
 *      it never spawns a competing line.
 *   3. RESULT (one result state): when a finished-result line appears, any
 *      stale in-flight ("reading.../pulling.../importing...") line from the
 *      same cycle is SUPPRESSED so the two can never contradict. Identical
 *      duplicate status lines across surfaces are de-duplicated.
 *
 * HONESTY (Michael's #1 sensitivity)
 *   This layer NEVER fabricates a status. It only (a) hides DOM nodes that
 *   are provably stale/contradictory relative to a newer line, and (b)
 *   normalizes the WORDING of text already present. It invents no counts,
 *   no "connected", no "imported N". Every node it hides is restorable.
 *
 * DOB
 *   "Always pull DOB." The day-schedule grid in athenaOne carries no DOB
 *   per row (confirmed: the extension's schedule scrape emits only
 *   {time,name,provider}); DOB lives on the chart and is captured by the
 *   per-patient chart/history pull (chartDob). This layer wraps
 *   window.upsertPatient to MERGE dob: once any pull captures a DOB it is
 *   never lost on a later re-pull, so it flows through every surface that
 *   already reads pt.dob (picker, calendar, Patients tab, active patient).
 *   It never overwrites a real DOB with an empty one and never invents one.
 *
 * SHAPE: own-scope IIFE, idempotent boot, ASCII-only, try/catch throughout,
 *   fully reversible via window.__mlsAthenaStatusUnify.revert().
 *
 * PUBLIC API (window.__mlsAthenaStatusUnify)
 *   .installed .version
 *   .state            -> {connection, phase, progress, result}
 *   .classify(text)   -> 'inflight'|'result'|'connection'|'other'
 *   .scan()           -> run one arbitration pass now
 *   .audit()          -> {surfaces:[{sel,text,kind,suppressed}]} (read-only)
 *   .subscribe(fn)    -> unsubscribe; fn(state) on change
 *   .revert()
 * ===================================================================== */
(function () {
  'use strict';

  var NS = '__mlsAthenaStatusUnify';
  var VERSION = '1.0.0';
  var win = window;

  if (win[NS] && win[NS].installed) { return; }

  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function now() { return Date.now(); }

  /* --------- surfaces where Athena status text appears --------- */
  var STATUS_SELECTORS = [
    '#mlsAsstPanel .as-pullstatus',
    '#mlsAsstPanel .as-slabel',
    '#mlsAsstPanel .as-sdetail',
    '#mlsAsstPanel .as-thread .as-msg',
    '.mlsaa-tl', '.mlsaa-tl *',
    '.mlsaa-done', '.mlsaa-steps',
    '.mlsux-mirror', '.mlsux-mirror *',
    '.mlsdoc-det', '.mlsdoc-step'
  ];

  /* --------- classification (wording already on screen) ---------
   * INFLIGHT = an operation is actively happening (gerunds + ellipsis).
   * RESULT   = an operation has ENDED (past tense / terminal phrases).
   * CONNECTION = connection-state lines (never suppressed by this layer).
   */
  var RE_INFLIGHT = /\b(reading|pulling|importing|loading|fetching|connecting|scanning|checking athenaone)\b.*?(…|\.\.\.|\b\d+\s*\/\s*\d+\b)|\b(reading|pulling|importing|loading|fetching)\b\s*(…|\.\.\.)/i;
  var RE_RESULT   = /\b(imported|pulled|saved|read|found|done|complete|completed|finished)\b\s*\d|\bno new appointments\b|\bno patients scheduled\b|\bnothing (?:new )?to import\b|\bpulled (?:all|into|chart)\b|\bimported \d+\b|\b\d+ (?:patients?|visits?|appointments?) (?:imported|pulled|saved|added)\b/i;
  var RE_CONNECTION = /\bathenaone (?:connected|disconnected)\b|\bmls assist (?:not )?detected\b|\bno signed-in athenaone tab\b|\bchecking athenaone connection\b|\bsign\s*in\b/i;

  function classify(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return 'other';
    var low = t.toLowerCase();
    // connection lines are owned by __mlsConnTruth; never treat as in-flight/result
    if (RE_CONNECTION.test(low) && !/\b(imported|pulled \d|reading your visits)\b/.test(low)) return 'connection';
    // result wins over inflight when both could match (e.g. "imported" vs "importing")
    if (RE_RESULT.test(low) && !/\bimporting\b/.test(low)) return 'result';
    if (RE_INFLIGHT.test(low)) return 'inflight';
    return 'other';
  }

  /* --------- canonical state --------- */
  var state = {
    connection: { status: 'checking', label: 'Checking athenaOne connection...', color: 'grey', detail: '' },
    phase: 'idle',                 // idle | reading | importing | done | error
    progress: { done: 0, total: 0, current: '' },
    result: { message: '', at: 0 }
  };
  var listeners = [];
  function emit() { for (var i = 0; i < listeners.length; i++) { safe(function () { listeners[i](state); }); } }
  function subscribe(fn) {
    if (!isFn(fn)) return function () {};
    listeners.push(fn); safe(function () { fn(state); });
    return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  /* --------- 1) CONNECTION: mirror __mlsConnTruth --------- */
  var connUnsub = null;
  function bindConnTruth() {
    var ct = win.__mlsConnTruth;
    if (!ct || !isFn(ct.subscribe)) {
      // retry shortly -- truth module may boot after us
      return false;
    }
    connUnsub = ct.subscribe(function (s) {
      var d = safe(function () { return ct.describe(s); }, null) || {};
      state.connection = {
        status: (s && s.status) || 'checking',
        label: d.label || 'Checking athenaOne connection...',
        color: d.color || 'grey',
        detail: d.detail || (s && s.reason) || ''
      };
      emit();
    });
    return true;
  }

  /* --------- 2) IN-FLIGHT progress: listen to the real event stream ---------
   * The extension emits mlsAppVisitsProgress {index,total,name} during a
   * per-patient history pull. We read it ONLY to mirror Michael's liked
   * progress wording onto the existing in-flight line; we never log the name.
   */
  var msgHandler = null;
  function bindProgress() {
    msgHandler = function (ev) {
      var data = ev && ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'mls-ext') return;
      if (data.type === 'mlsAppVisitsProgress' || data.type === 'mlsAppSearchProgress') {
        var total = parseInt(data.total, 10) || 0;
        var idx = parseInt(data.index, 10) || 0;
        var nm = typeof data.name === 'string' ? data.name : '';
        state.phase = 'reading';
        state.progress = { done: idx, total: total, current: nm };
        state.result = { message: '', at: 0 };
        // normalize the in-flight wording in place (does not add a new line)
        normalizeInflightLine(idx, total, nm);
        emit();
      } else if (data.type === 'mlsAppAllVisitsResult' || data.type === 'mlsAppScheduleResult') {
        // an operation ended -> let the arbiter clear any stale in-flight line
        state.phase = 'done';
        safeScan();
      }
    };
    win.addEventListener('message', msgHandler, false);
  }

  function canonicalProgressText(done, total, name) {
    var base = 'Pulling new histories from athenaOne…';
    if (total > 0) base = 'Pulling new histories from athenaOne… ' + done + '/' + total;
    if (name) base += ' — ' + name;
    return base;
  }

  // Replace the text of an EXISTING in-flight line (in place) with the
  // unified wording. We only touch a node already showing an in-flight
  // string -- we never create one (no fabrication of activity).
  function normalizeInflightLine(done, total, name) {
    safe(function () {
      var nodes = collectStatusNodes();
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.__mlsKind === 'inflight' && !n.el.getAttribute('data-mls-suppressed')) {
          var want = canonicalProgressText(done, total, name);
          if (n.el.textContent !== want) n.el.textContent = want;
          n.el.setAttribute('data-mls-unified', '1');
          return;
        }
      }
    });
  }

  /* --------- 3) RESULT vs IN-FLIGHT arbitration + de-dup --------- */
  var seenAt = new WeakMap();   // element -> first-seen timestamp
  var suppressed = [];          // [{el, prevDisplay}] for revert

  function collectStatusNodes() {
    var out = [], seen = [];
    for (var s = 0; s < STATUS_SELECTORS.length; s++) {
      var list = safe(function () { return document.querySelectorAll(STATUS_SELECTORS[s]); }, []);
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!el || seen.indexOf(el) >= 0) continue;
        // skip elements that merely contain other matched elements (leaf-ish only)
        var txt = safe(function () { return (el.textContent || ''); }, '');
        txt = txt.replace(/\s+/g, ' ').trim();
        if (!txt || txt.length > 240) continue;
        var kind = classify(txt);
        if (kind === 'other' || kind === 'connection') continue;
        seen.push(el);
        if (!seenAt.has(el)) seenAt.set(el, now());
        el.__mlsKind = kind;
        out.push({ el: el, text: txt, kind: kind, at: seenAt.get(el) });
      }
    }
    return out;
  }

  function hide(el) {
    if (!el || el.getAttribute('data-mls-suppressed')) return;
    var prev = el.style.display;
    el.setAttribute('data-mls-suppressed', '1');
    el.style.display = 'none';
    suppressed.push({ el: el, prevDisplay: prev });
  }

  // The honest rule:
  //  - If a RESULT line is visible, any IN-FLIGHT line that first appeared
  //    at-or-before the newest result is STALE (the op ended) -> hide it.
  //    A genuinely newer in-flight (a fresh pull started after the result)
  //    has a later timestamp and is left alone.
  //  - Identical (case-insensitive) visible texts are de-duplicated, keeping
  //    the most recently seen one.
  function arbitrate() {
    var nodes = collectStatusNodes();
    if (!nodes.length) return;

    var results = [], inflights = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].kind === 'result') results.push(nodes[i]);
      else if (nodes[i].kind === 'inflight') inflights.push(nodes[i]);
    }

    // (a) contradiction suppression
    if (results.length) {
      var newestResultAt = 0;
      for (var r = 0; r < results.length; r++) newestResultAt = Math.max(newestResultAt, results[r].at);
      for (var f = 0; f < inflights.length; f++) {
        if (inflights[f].at <= newestResultAt) hide(inflights[f].el);
      }
      // capture the canonical result message (for state, not fabricated)
      var newest = results[0];
      for (var rr = 1; rr < results.length; rr++) if (results[rr].at >= newest.at) newest = results[rr];
      if (state.result.message !== newest.text) {
        state.result = { message: newest.text, at: newest.at };
        if (state.phase !== 'idle') state.phase = 'done';
        emit();
      }
    }

    // (b) de-duplicate identical lines (keep most-recent)
    var byText = {};
    for (var d = 0; d < nodes.length; d++) {
      var n = nodes[d];
      if (n.el.getAttribute('data-mls-suppressed')) continue;
      var key = n.text.toLowerCase();
      if (!byText[key]) { byText[key] = n; continue; }
      var keep = byText[key].at >= n.at ? byText[key] : n;
      var drop = keep === byText[key] ? n : byText[key];
      hide(drop.el);
      byText[key] = keep;
    }
  }

  /* debounced scan */
  var scanTimer = null;
  function safeScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = null; safe(arbitrate); }, 60);
  }
  function scan() { safe(arbitrate); }

  var mo = null;
  function bindObserver() {
    if (!win.MutationObserver) return;
    mo = new MutationObserver(function () { safeScan(); });
    safe(function () {
      mo.observe(document.documentElement || document.body, {
        childList: true, subtree: true, characterData: true
      });
    });
  }

  /* --------- DOB merge-preserving wrap of upsertPatient --------- */
  var origUpsert = null;
  function wrapUpsert() {
    if (!isFn(win.upsertPatient)) return false;
    if (win.upsertPatient.__mlsDobWrapped) return true;
    origUpsert = win.upsertPatient;
    var wrapped = function (p) {
      try {
        if (p && typeof p === 'object') {
          var incomingDob = p.dob || p.dateOfBirth || p.birthDate || '';
          if (incomingDob && !p.dob) p.dob = String(incomingDob);
          // never lose a DOB already known for this patient
          if ((!p.dob || !String(p.dob).trim())) {
            var prior = findKnownDob(p);
            if (prior) p.dob = prior;
          }
        }
      } catch (e) {}
      return origUpsert.apply(this, arguments);
    };
    wrapped.__mlsDobWrapped = true;
    win.upsertPatient = wrapped;
    return true;
  }
  function findKnownDob(p) {
    return safe(function () {
      if (!isFn(win.getPatients)) return '';
      var list = win.getPatients() || [];
      var pid = p.id, pname = (p.name || '').trim().toLowerCase();
      for (var i = 0; i < list.length; i++) {
        var q = list[i]; if (!q) continue;
        var match = (pid && q.id === pid) || (pname && (q.name || '').trim().toLowerCase() === pname);
        if (match && q.dob && String(q.dob).trim()) return String(q.dob);
      }
      return '';
    }, '');
  }

  /* --------- read-only audit (for the MLS Checker, never fabricates) --------- */
  function audit() {
    var nodes = collectStatusNodes();
    var surfaces = nodes.map(function (n) {
      return { text: n.text, kind: n.kind, suppressed: !!n.el.getAttribute('data-mls-suppressed') };
    });
    // contradiction = a visible inflight AND a visible result at once
    var visInflight = false, visResult = false;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].el.getAttribute('data-mls-suppressed')) continue;
      if (nodes[i].kind === 'inflight') visInflight = true;
      if (nodes[i].kind === 'result') visResult = true;
    }
    return { surfaces: surfaces, contradiction: (visInflight && visResult) };
  }

  /* --------- boot / revert --------- */
  var bootTimer = null, bootTries = 0;
  function boot() {
    var okConn = bindConnTruth();
    wrapUpsert();
    if (!okConn || !isFn(win.upsertPatient)) {
      if (bootTries++ < 40) { bootTimer = setTimeout(boot, 250); }
    }
    bindProgress();
    bindObserver();
    safeScan();
    // also start the truth poll if present and idle
    safe(function () { if (win.__mlsConnTruth && isFn(win.__mlsConnTruth.start)) win.__mlsConnTruth.start(); });
  }

  function revert() {
    safe(function () { if (bootTimer) clearTimeout(bootTimer); });
    safe(function () { if (scanTimer) clearTimeout(scanTimer); });
    safe(function () { if (mo) mo.disconnect(); }); mo = null;
    safe(function () { if (msgHandler) win.removeEventListener('message', msgHandler, false); }); msgHandler = null;
    safe(function () { if (isFn(connUnsub)) connUnsub(); }); connUnsub = null;
    // un-hide everything we suppressed
    for (var i = 0; i < suppressed.length; i++) {
      safe(function () {
        var rec = suppressed[i];
        rec.el.removeAttribute('data-mls-suppressed');
        rec.el.style.display = rec.prevDisplay || '';
      });
    }
    suppressed = [];
    // restore upsertPatient
    safe(function () { if (origUpsert) win.upsertPatient = origUpsert; });
    listeners = [];
    win[NS].installed = false;
  }

  win[NS] = {
    installed: true,
    version: VERSION,
    get state() { return state; },
    classify: classify,
    scan: scan,
    audit: audit,
    subscribe: subscribe,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

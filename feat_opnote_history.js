/* ============================================================================
   feat_opnote_history.js  ->  window.__mlsOpNoteHistory   (v1.0.0)

   TWO additive, reversible upgrades to the MLS op-note / visit-note path.
   Self-contained IIFE. All external calls in try/catch. Idempotent. Reversible
   via window.__mlsOpNoteHistory.revert(). Wraps nothing destructively; falls
   back to the original behavior on ANY error. No PHI is written to any log.

   ---------------------------------------------------------------------------
   BUILD 1 - HISTORY-AWARE NOTE GENERATION
   ---------------------------------------------------------------------------
   When MLS drafts an operative / procedure note via the client-side AI path
   _genOpNote(name,dateStr,procedure,tplText,ctx) -> aiCallRaw(sys,user,...)
   -> /api/complete, the prompt previously carried ONLY today's facts
   (name/date/procedure + a few KNOWN PATIENT FACTS + the template). This
   module assembles the patient's WHOLE longitudinal history from the section-40
   visit-aware model (window.__mlsVisitModel.getVisits(patient) -> every visit's
   date, type, dx/ICD-10, procedures/CPT, meds, findings, scores, plan) and
   splices it into the user prompt so the note is written with full context.

   How it injects WITHOUT duplicating the existing prompt logic: it wraps
   _genOpNote, builds a token-budgeted HISTORY block, then for the duration of
   that one call it scopes a patch onto window.aiCallRaw that inserts the HISTORY
   block into the op-note user string (gated by an in-flight flag + an op-note
   prompt signature so no other AI call is ever touched), and restores aiCallRaw
   in a finally. This works whether the inner _genOpNote is the app's original
   or the section-53 mls-opnote-pro enhanced version - both build a user string
   that begins "PATIENT: ..." and contains a "TEMPLATE (" marker we insert before.

   Token budget: the most recent visits are included in full; older visits are
   compressed to one factual line each; if even that exceeds the char budget the
   oldest are rolled into a dated, never-silent "+N earlier visits (dates: ...)"
   line - history is summarized, never silently dropped. Nothing is invented:
   every value comes from patient.visits[]; the directive tells the model to use
   history for context only and to document today's procedure facts only.

   ---------------------------------------------------------------------------
   BUILD 2 - OP-NOTE LOADING / READY INDICATOR (REAL load state - no fake spinner)
   ---------------------------------------------------------------------------
   In the op-note section (the Prep op notes modal, #opPrepModal) a small honest
   chip reads REAL load state at render time:
     - "Still loading history..."  while a REAL load is in flight, i.e. either
        - a wrapped window.loadPatientsFromServer() GET is pending (the server
          history merge), or
        - a copy-every-visit pull is running (observed via the real
          mlsAppVisitsProgress / mlsAppAllVisitsResult window events, with a
          watchdog timeout -> honest end, never a stuck spinner).
     - "History ready (N visits on file)"  when no load is in flight; N is the
        REAL getVisits(activePatient).length read at render time.
   The generate control (#opPrepGenAllBtn) reflects the same real state: it is
   disabled + relabelled while a load is genuinely in flight, and enabled once
   ready. No simulated progress, no pre-counted stream - every state is bound to
   a real promise/event and re-read on render (single-source-of-truth at render).

   ROLLBACK: delete the one loader line in mls-connect.js (asset then never
   loads; the op-note path reverts byte-for-byte to prior behavior), and/or call
   window.__mlsOpNoteHistory.revert() at runtime.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__mlsOpNoteHistory && window.__mlsOpNoteHistory.installed) return;

  var VERSION = '1.0.0';
  var _rewireIv = null;
  var _reverted = false;

  // ---- tunables ------------------------------------------------------------
  var MAX_HISTORY_CHARS = 7000;   // overall char budget for the history block
  var FULL_DETAIL_VISITS = 6;     // most-recent visits rendered in full detail
  var PULL_WATCHDOG_MS = 25000;   // no progress for this long -> assume pull ended (honest)

  // ---- tiny helpers --------------------------------------------------------
  function S(x) { return (x == null) ? '' : String(x); }
  function trim(x) { return S(x).trim(); }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function isFn(f) { return typeof f === 'function'; }
  function uniq(arr) { var o = {}, out = []; (arr || []).forEach(function (v) { v = trim(v); if (v && !o[v]) { o[v] = 1; out.push(v); } }); return out; }

  // ---- patient resolution (mirrors _opPatientCtx name-match) ---------------
  function resolvePatient(name) {
    try {
      var nm = trim(name).toLowerCase();
      if (isFn(window.activePatient)) {
        var ap = window.activePatient();
        if (ap && trim(ap.name).toLowerCase() === nm) return ap;
      }
      var pts = (isFn(window.getPatients) ? window.getPatients() : []) || [];
      var byName = pts.find(function (x) { return trim(x.name).toLowerCase() === nm; });
      if (byName) return byName;
      if (isFn(window.activePatient)) { var ap2 = window.activePatient(); if (ap2) return ap2; }
      return null;
    } catch (e) { return null; }
  }

  function getVisitsFor(patient) {
    try {
      var m = window.__mlsVisitModel;
      if (patient && m && isFn(m.getVisits)) return m.getVisits(patient) || [];
    } catch (e) {}
    return [];
  }

  // ---- format one visit ----------------------------------------------------
  function scoresStr(sc) {
    if (!sc || typeof sc !== 'object') return '';
    var parts = [];
    var keysPref = ['vas', 'nrs', 'pain', 'odi', 'sf', 'sf36', 'sf12'];
    var seen = {};
    keysPref.forEach(function (k) {
      if (sc[k] != null && sc[k] !== '') { parts.push(k.toUpperCase() + ' ' + S(sc[k])); seen[k] = 1; }
    });
    Object.keys(sc).forEach(function (k) {
      if (seen[k]) return;
      var v = sc[k];
      if (v == null || v === '' || typeof v === 'object') return;
      parts.push((k === 'note' ? '' : (k + ' ')) + S(v));
    });
    return parts.join(', ');
  }

  function visitFull(v) {
    var date = trim(v.date) || '(undated)';
    var lines = [];
    lines.push('[' + date + '] ' + (trim(v.type) || 'Visit'));
    var dx = uniq(v.icd10);
    if (dx.length) lines.push('  Dx / ICD-10: ' + dx.join(', '));
    var cpt = uniq(v.cpt);
    if (cpt.length) lines.push('  Procedures / CPT: ' + cpt.join(', '));
    var meds = uniq(v.meds);
    if (meds.length) lines.push('  Meds: ' + meds.join('; '));
    if (trim(v.findings)) lines.push('  Findings: ' + trim(v.findings));
    var sc = scoresStr(v.scores);
    if (sc) lines.push('  Scores: ' + sc);
    if (trim(v.plan)) lines.push('  Plan: ' + trim(v.plan));
    var thin = !dx.length && !cpt.length && !meds.length && !trim(v.findings) && !trim(v.plan);
    if (thin && trim(v.aiSummary)) lines.push('  Summary: ' + trim(v.aiSummary));
    else if (thin && trim(v.raw)) lines.push('  Detail: ' + trim(v.raw).slice(0, 400));
    return lines.join('\n');
  }

  function visitOneLine(v) {
    var date = trim(v.date) || '(undated)';
    var bits = [trim(v.type) || 'Visit'];
    var dx = uniq(v.icd10); if (dx.length) bits.push('ICD ' + dx.slice(0, 3).join('/'));
    var cpt = uniq(v.cpt); if (cpt.length) bits.push('CPT ' + cpt.slice(0, 3).join('/'));
    var sc = scoresStr(v.scores); if (sc) bits.push(sc);
    return '[' + date + '] ' + bits.join('; ');
  }

  // ---- build the token-budgeted history block ------------------------------
  function buildHistoryBlock(name, ctx) {
    var patient = resolvePatient(name);
    if (!patient) return '';
    var visits = getVisitsFor(patient);
    if (!visits || !visits.length) return '';

    var header =
      'PRIOR LONGITUDINAL HISTORY for this patient - ALL ' + visits.length +
      ' known visit(s), newest first, taken from our chart. Use this for full clinical context ' +
      '(disease progression, prior procedures and the response to them, current medications, ' +
      'pain/function trend). Do NOT copy it verbatim and do NOT invent anything not present here. ' +
      'Document TODAY\'S procedure in the procedure sections; reference prior history only where ' +
      'clinically appropriate (e.g. INDICATIONS).';

    var fullN = Math.min(FULL_DETAIL_VISITS, visits.length);
    var blocks = [];
    var i;
    for (i = 0; i < fullN; i++) blocks.push(visitFull(visits[i]));
    var rest = [];
    for (i = fullN; i < visits.length; i++) rest.push(visitOneLine(visits[i]));

    function assemble(fullBlocks, restLines, rolled) {
      var out = header + '\n\n' + fullBlocks.join('\n\n');
      if (restLines.length) out += '\n\nEARLIER VISITS (condensed):\n' + restLines.join('\n');
      if (rolled && rolled.length) {
        out += '\n\n+' + rolled.length + ' still-earlier visit(s) on file (dates: ' +
          rolled.join(', ') + ') - older context, not detailed here for length.';
      }
      return out;
    }

    var rolledDates = [];
    var text = assemble(blocks, rest, rolledDates);

    var guard = 0;
    while (text.length > MAX_HISTORY_CHARS && guard++ < 1000) {
      if (rest.length) {
        var dropped = rest.pop();
        var m = dropped.match(/^\[([^\]]+)\]/);
        rolledDates.push(m ? m[1] : '(undated)');
      } else if (blocks.length > 1) {
        var demoteIdx = blocks.length - 1;
        rest.unshift(visitOneLine(visits[demoteIdx]));
        blocks.pop();
      } else {
        break;
      }
      text = assemble(blocks, rest, rolledDates);
    }
    return text;
  }

  function injectIntoUser(user, histBlock) {
    var u = S(user);
    if (!histBlock) return u;
    var marker = '\n\nTEMPLATE (';
    var at = u.indexOf(marker);
    var insert = '\n\n' + histBlock;
    if (at >= 0) return u.slice(0, at) + insert + u.slice(at);
    return u + insert;
  }

  function looksLikeOpNoteCall(sys, user) {
    var s = S(sys), u = S(user);
    var sysOk = /operative\s*\/\s*procedure note|operative note/i.test(s);
    var userOk = /^PATIENT:/.test(u.trim()) && /\bPROCEDURE:/.test(u);
    return sysOk && userOk;
  }

  // ===========================================================================
  //  BUILD 1 - wrap _genOpNote
  // ===========================================================================
  var _genState = { wrapped: false, origGen: null };

  function wrapGenOpNote() {
    if (!isFn(window._genOpNote)) return;
    if (window._genOpNote.__mlsHistWrapped) return;
    var inner = window._genOpNote;
    _genState.origGen = inner;

    var hwrapped = async function (name, dateStr, procedure, tplText, ctx) {
      var histBlock = '';
      try { histBlock = buildHistoryBlock(name, ctx); } catch (e) { histBlock = ''; }
      if (!histBlock || !isFn(window.aiCallRaw)) {
        return await inner(name, dateStr, procedure, tplText, ctx);
      }
      var origAiCall = window.aiCallRaw;
      var inFlight = true;
      var patched = function (sys, user, key, opts) {
        try {
          if (inFlight && looksLikeOpNoteCall(sys, user)) {
            return origAiCall(sys, injectIntoUser(user, histBlock), key, opts);
          }
        } catch (e) {}
        return origAiCall(sys, user, key, opts);
      };
      try {
        window.aiCallRaw = patched;
        return await inner(name, dateStr, procedure, tplText, ctx);
      } catch (e) {
        try { window.aiCallRaw = origAiCall; } catch (_) {}
        try { return await inner(name, dateStr, procedure, tplText, ctx); }
        catch (e2) { return { note: '', missing: [] }; }
      } finally {
        inFlight = false;
        try { if (window.aiCallRaw === patched) window.aiCallRaw = origAiCall; } catch (_) {}
      }
    };
    hwrapped.__mlsHistWrapped = true;
    try { window._genOpNote = hwrapped; _genState.wrapped = true; } catch (e) {}
  }

  // ===========================================================================
  //  BUILD 2 - real load-state indicator + generate gating
  // ===========================================================================
  var load = {
    serverPending: 0,
    pullActive: false,
    watchdog: null,
    wrappedLoad: false,
    origLoad: null,
    msgHandler: null,
    modalObserver: null,
    btnOrigLabel: null,
    origGenAll: null,
    _wasOpen: false
  };

  function hasModel() {
    return !!(window.__mlsVisitModel && isFn(window.__mlsVisitModel.getVisits));
  }
  function backendOn() {
    try { return isFn(window.backendMode) && window.backendMode() && isFn(window.bkToken) && !!window.bkToken(); }
    catch (e) { return false; }
  }
  function readyState() {
    var model = hasModel();
    var pulling = load.pullActive || load.serverPending > 0;
    return { ready: model && !pulling, pulling: pulling, model: model };
  }
  function activeVisitCount() {
    try {
      if (!isFn(window.activePatient)) return null;
      var ap = window.activePatient();
      if (!ap) return null;
      return getVisitsFor(ap).length;
    } catch (e) { return null; }
  }

  function wrapLoad() {
    if (!isFn(window.loadPatientsFromServer)) return;
    if (window.loadPatientsFromServer.__mlsHistWrapped) return;
    var orig = window.loadPatientsFromServer;
    load.origLoad = orig;
    var w = async function () {
      load.serverPending++;
      renderChip();
      try {
        return await orig.apply(this, arguments);
      } finally {
        load.serverPending = Math.max(0, load.serverPending - 1);
        renderChip();
      }
    };
    w.__mlsHistWrapped = true;
    try { window.loadPatientsFromServer = w; load.wrappedLoad = true; } catch (e) {}
  }

  function onVisitMessage(ev) {
    try {
      var d = ev && ev.data;
      if (!d || typeof d !== 'object') return;
      var t = d.type || d.kind || '';
      if (t === 'mlsAppVisitsProgress' || t === 'mlsAppSearchProgress') {
        load.pullActive = true;
        armWatchdog();
        renderChip();
      } else if (t === 'mlsAppAllVisitsResult' || t === 'mlsAppReadAllVisitsResult') {
        clearWatchdog();
        load.pullActive = false;
        renderChip();
      }
    } catch (e) {}
  }
  function armWatchdog() {
    clearWatchdog();
    load.watchdog = setTimeout(function () {
      load.pullActive = false;
      renderChip();
    }, PULL_WATCHDOG_MS);
  }
  function clearWatchdog() { if (load.watchdog) { clearTimeout(load.watchdog); load.watchdog = null; } }

  function ensureChip() {
    var hdr = document.getElementById('opPrepHdr');
    if (!hdr) return null;
    var chip = document.getElementById('mlsOpHistChip');
    if (!chip) {
      chip = document.createElement('span');
      chip.id = 'mlsOpHistChip';
      chip.setAttribute('data-mls', 'opnote-history');
      chip.style.cssText = 'display:inline-block;margin-left:10px;font-size:12px;font-weight:700;' +
        'padding:2px 9px;border-radius:999px;vertical-align:middle;white-space:nowrap';
      hdr.appendChild(chip);
    }
    return chip;
  }

  function modalOpen() {
    var m = document.getElementById('opPrepModal');
    if (!m) return false;
    if (m.classList && m.classList.contains('show')) return true;
    var disp = '';
    try { disp = (window.getComputedStyle ? getComputedStyle(m).display : (m.style.display || '')); } catch (e) { disp = m.style.display || ''; }
    return disp && disp !== 'none';
  }

  function renderChip() {
    try {
      if (!modalOpen()) return;
      var chip = ensureChip();
      if (!chip) return;
      var st = readyState();
      if (!st.model) {
        chip.textContent = 'History module not loaded - drafting from chart facts only';
        chip.style.background = '#fff3cd'; chip.style.color = '#7a5a16';
      } else if (st.pulling) {
        chip.textContent = '⏳ Still loading history…';
        chip.style.background = '#fff7e6'; chip.style.color = '#9a6a16';
      } else {
        var n = activeVisitCount();
        chip.textContent = '✓ History ready' + (n != null ? (' (' + n + ' visit' + (n === 1 ? '' : 's') + ' on file)') : '');
        chip.style.background = '#eafaf1'; chip.style.color = '#16924e';
      }
      syncGenButton(st);
    } catch (e) {}
  }

  function syncGenButton(st) {
    try {
      var btn = document.getElementById('opPrepGenAllBtn');
      if (!btn) return;
      if (load.btnOrigLabel == null) load.btnOrigLabel = btn.textContent;
      if (st.pulling) {
        btn.disabled = true;
        btn.dataset.mlsHistDisabled = '1';
        btn.style.opacity = '0.6';
        btn.style.cursor = 'not-allowed';
        btn.textContent = '⏳ Loading history…';
      } else if (btn.dataset.mlsHistDisabled === '1') {
        btn.disabled = false;
        delete btn.dataset.mlsHistDisabled;
        btn.style.opacity = '';
        btn.style.cursor = '';
        btn.textContent = load.btnOrigLabel || '✨ Draft all op notes';
      }
    } catch (e) {}
  }

  function wrapGenerateAll() {
    if (!isFn(window.opPrepGenerateAll)) return;
    if (window.opPrepGenerateAll.__mlsHistWrapped) return;
    var orig = window.opPrepGenerateAll;
    load.origGenAll = orig;
    var w = async function () {
      try {
        var st = readyState();
        if (st.pulling) {
          var s = document.getElementById('opPrepStatus');
          if (s) s.textContent = '⏳ Still loading this patient’s history - please wait for “History ready”, then draft for full longitudinal context.';
          renderChip();
          return;
        }
      } catch (e) {}
      return await orig.apply(this, arguments);
    };
    w.__mlsHistWrapped = true;
    try { window.opPrepGenerateAll = w; } catch (e) {}
  }

  function watchModal() {
    var m = document.getElementById('opPrepModal');
    if (!m || load.modalObserver) return;
    try {
      var obs = new MutationObserver(function () { onModalToggle(); });
      obs.observe(m, { attributes: true, attributeFilter: ['class', 'style'] });
      load.modalObserver = obs;
    } catch (e) {}
    if (modalOpen()) onModalToggle();
  }

  // Fire once per open: refresh patient history from the server (best-effort,
  // read-only GET, via the wrapped loadPatientsFromServer so the chip reflects
  // the REAL fetch state) and render the chip.
  function onModalToggle() {
    var open = modalOpen();
    if (open && !load._wasOpen) {
      load._wasOpen = true;
      if (backendOn() && load.serverPending === 0 && isFn(window.loadPatientsFromServer)) {
        try { var r = window.loadPatientsFromServer(); if (r && isFn(r.then)) r.then(function () {}, function () {}); } catch (e) {}
      }
    } else if (!open) {
      load._wasOpen = false;
    }
    if (open) renderChip();
  }

  // ===========================================================================
  //  wire / revert
  // ===========================================================================
  function wire() {
    safe(wrapGenOpNote);
    safe(wrapLoad);
    safe(wrapGenerateAll);
    safe(watchModal);
    if (!load.msgHandler) {
      load.msgHandler = onVisitMessage;
      try { window.addEventListener('message', load.msgHandler, false); } catch (e) {}
    }
  }

  function revert() {
    _reverted = true;
    try { if (_rewireIv) { clearInterval(_rewireIv); _rewireIv = null; } } catch (e) {}
    try { if (_genState.wrapped && _genState.origGen) window._genOpNote = _genState.origGen; } catch (e) {}
    try { if (load.wrappedLoad && load.origLoad) window.loadPatientsFromServer = load.origLoad; } catch (e) {}
    try {
      if (load.origGenAll && window.opPrepGenerateAll && window.opPrepGenerateAll.__mlsHistWrapped) {
        window.opPrepGenerateAll = load.origGenAll;
      }
    } catch (e) {}
    try { if (load.msgHandler) window.removeEventListener('message', load.msgHandler, false); } catch (e) {}
    try { if (load.modalObserver) load.modalObserver.disconnect(); load.modalObserver = null; } catch (e) {}
    clearWatchdog();
    try { var chip = document.getElementById('mlsOpHistChip'); if (chip && chip.parentNode) chip.parentNode.removeChild(chip); } catch (e) {}
    try {
      var btn = document.getElementById('opPrepGenAllBtn');
      if (btn && btn.dataset.mlsHistDisabled === '1') {
        btn.disabled = false; delete btn.dataset.mlsHistDisabled;
        btn.style.opacity = ''; btn.style.cursor = '';
        if (load.btnOrigLabel != null) btn.textContent = load.btnOrigLabel;
      }
    } catch (e) {}
    _genState.wrapped = false; load.wrappedLoad = false; load.pullActive = false; load.serverPending = 0;
  }

  function bootRewire() {
    safe(wire);
    var tries = 0;
    _rewireIv = setInterval(function () {
      tries++;
      if (_reverted) { clearInterval(_rewireIv); _rewireIv = null; return; }
      safe(function () {
        if (isFn(window._genOpNote) && !window._genOpNote.__mlsHistWrapped) wrapGenOpNote();
        if (isFn(window.opPrepGenerateAll) && !window.opPrepGenerateAll.__mlsHistWrapped) wrapGenerateAll();
        if (isFn(window.loadPatientsFromServer) && !window.loadPatientsFromServer.__mlsHistWrapped) wrapLoad();
        watchModal();
      });
      if (tries >= 20) { clearInterval(_rewireIv); _rewireIv = null; }
    }, 500);
  }

  window.__mlsOpNoteHistory = {
    installed: true,
    version: VERSION,
    buildHistoryBlock: buildHistoryBlock,
    injectIntoUser: injectIntoUser,
    looksLikeOpNoteCall: looksLikeOpNoteCall,
    readyState: readyState,
    renderChip: renderChip,
    _internal: { load: load, genState: _genState, resolvePatient: resolvePatient, getVisitsFor: getVisitsFor },
    rewire: wire,
    revert: revert
  };

  if (document.readyState === 'loading') {
    try { document.addEventListener('DOMContentLoaded', bootRewire, { once: true }); } catch (e) { bootRewire(); }
  } else {
    bootRewire();
  }
})();

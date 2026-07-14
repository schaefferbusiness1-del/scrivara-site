/* ============================================================================
   feat_opnote_history.js  ->  window.__mlsOpNoteHistory   (v1.3.0)

   TWO additive, reversible upgrades to the MLS op-note / visit-note path.
   Self-contained IIFE. All external calls in try/catch. Idempotent. Reversible
   via window.__mlsOpNoteHistory.revert(). No PHI is written to any log.

   ---------------------------------------------------------------------------
   BUILD 1 - HISTORY-AWARE NOTE GENERATION  (v1.1.0 - aiCallRaw-level injection)
   ---------------------------------------------------------------------------
   The client-side AI op-note path is _genOpNote(...) -> aiCallRaw(sys,user,...)
   -> POST /api/complete. Older facts: the prompt carried only today's data.
   This module assembles the patient's WHOLE longitudinal history from the
   section-40 visit model (window.__mlsVisitModel.getVisits(patient): every
   visit's date/type/ICD-10/CPT/meds/findings/scores/plan) and splices it into
   the op-note user prompt so the note is written with full context.

   WHY aiCallRaw-level (changed from v1.0.0): op notes can be wrapped by several
   modules (e.g. section-53 mls-opnote-pro re-wraps _genOpNote with an "enhanced"
   version that calls window.aiCallRaw DIRECTLY and does not call through to an
   inner wrapper). Wrapping _genOpNote is therefore order-fragile. EVERY op-note
   path funnels through window.aiCallRaw, so we wrap THAT: for any call whose
   prompt is an operative/procedure note (sys + "PATIENT:/PROCEDURE:" signature)
   we require the immutable patient id carried out-of-band in aiCallRaw opts,
   verify it against the prompt name/DOB, build a token-budgeted exact-patient
   profile + visit-history block, and insert it ahead of the TEMPLATE section.
   Robust to any _genOpNote wrap order; missing/mismatched identity never calls AI.
   Non-op-note aiCallRaw calls (SOAP, summaries, etc.) are never touched.

   Token budget: recent visits in full; older condensed to one line; oldest
   rolled into a dated "+N earlier visits" line - summarized, never silently
   dropped. Nothing invented: every value comes from patient.visits[].

   ---------------------------------------------------------------------------
   BUILD 2 - OP-NOTE LOADING / READY INDICATOR (REAL load state - no fake spinner)
   ---------------------------------------------------------------------------
   In the "Prep op notes" modal (#opPrepModal) a chip reads REAL load state at
   render time: "Still loading history..." while a real load is in flight (a
   wrapped loadPatientsFromServer() GET pending, or a copy-every-visit pull seen
   via the real mlsAppVisitsProgress/mlsAppAllVisitsResult events with a watchdog
   -> honest end), else "History ready (N visits on file)" with the REAL
   getVisits(activePatient).length. The generate button reflects the same state.
   No simulated progress; every state is bound to a real promise/event.

   ROLLBACK: delete the one loader line in mls-connect.js (asset never loads),
   and/or window.__mlsOpNoteHistory.revert().
   ============================================================================ */
(function () {
  'use strict';
  if (window.__mlsOpNoteHistory && window.__mlsOpNoteHistory.installed) return;

  var VERSION = '1.3.0';
  var _rewireIv = null;
  var _reverted = false;
  var lastInjectionReceipt = null;

  var MAX_HISTORY_CHARS = 9000;
  var MAX_PROFILE_CHARS = 3000;
  var MAX_SNAPSHOT_CHARS = 2500;
  var FULL_DETAIL_VISITS = 6;
  var PULL_WATCHDOG_MS = 25000;

  function S(x) { return (x == null) ? '' : String(x); }
  function trim(x) { return S(x).trim(); }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function isFn(f) { return typeof f === 'function'; }
  function uniq(arr) { var o = {}, out = []; (arr || []).forEach(function (v) { v = trim(v); if (v && !o[v]) { o[v] = 1; out.push(v); } }); return out; }

  function normDob(s) {
    try {
      var m = window.__mlsVisitModel;
      if (m && isFn(m._normDob)) return m._normDob(s) || '';
    } catch (e) {}
    var x = trim(s).match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
    return x ? trim(s) : '';
  }

  function normName(s) { return trim(s).toLowerCase().replace(/\s+/g, ' '); }

  function verifyPatientIdentity(patientId, name, dob) {
    try {
      var pid = trim(patientId);
      if (!pid) return { patient: null, reason: 'missing-patient-id' };
      if (!isFn(window.getPatients)) return { patient: null, reason: 'patient-store-unavailable' };
      var pts = window.getPatients() || [];
      var exact = pts.filter(function (x) { return trim(x && x.id) === pid; });
      if (exact.length !== 1) return { patient: null, reason: exact.length ? 'duplicate-patient-id' : 'patient-id-not-found' };
      var patient = exact[0], nm = normName(name), nd = normDob(dob);
      if (nm && normName(patient.name) !== nm) return { patient: null, reason: 'patient-name-mismatch' };
      if (nd && normDob(patient.dob) !== nd) return { patient: null, reason: 'patient-dob-mismatch' };
      return { patient: patient, reason: '' };
    } catch (e) { return { patient: null, reason: 'identity-check-failed' }; }
  }

  function resolvePatient(patientId, name, dob) {
    return verifyPatientIdentity(patientId, name, dob).patient;
  }

  function getVisitsFor(patient) {
    try {
      var m = window.__mlsVisitModel;
      if (patient && m && isFn(m.usableVisits)) return m.usableVisits(patient) || [];
      if (patient && m && isFn(m.getVisits)) return (m.getVisits(patient) || []).filter(function (v) {
        return !/athena|legacy|grab/i.test(trim(v && v.source)) || v.identityVerified === true;
      });
    } catch (e) {}
    return [];
  }

  function scoresStr(sc) {
    if (!sc || typeof sc !== 'object') return '';
    var parts = [], seen = {};
    ['vas', 'nrs', 'pain', 'odi', 'sf', 'sf36', 'sf12'].forEach(function (k) {
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
    var lines = ['[' + date + '] ' + (trim(v.type) || 'Visit')];
    var dx = uniq(v.icd10); if (dx.length) lines.push('  Dx / ICD-10: ' + dx.join(', '));
    var cpt = uniq(v.cpt); if (cpt.length) lines.push('  Procedures / CPT: ' + cpt.join(', '));
    var meds = uniq(v.meds); if (meds.length) lines.push('  Meds: ' + meds.join('; '));
    if (trim(v.findings)) lines.push('  Findings: ' + trim(v.findings));
    var sc = scoresStr(v.scores); if (sc) lines.push('  Scores: ' + sc);
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

  function profileText(v, max) {
    var text = '';
    if (Array.isArray(v)) text = v.map(trim).filter(Boolean).join('; ');
    else text = trim(v);
    return text ? text.slice(0, max || 1200) : '';
  }

  function buildProfileBlock(patient) {
    if (!patient) return { text: '', sectionCount: 0 };
    var lines = [], h = patient.history;
    function add(label, value, max) {
      var text = profileText(value, max);
      if (text) lines.push(label + ':\n' + text);
    }
    add('Active problems', patient.problems);
    add('Current medications', patient.meds || patient.medications);
    add('Allergies', patient.allergies);
    if (h && typeof h === 'object' && !Array.isArray(h)) {
      add('Past medical history', h.pmh || h.medical);
      add('Past surgical history', h.psh || h.surgical);
      add('Social history', h.social);
      add('Family history', h.family);
      add('Smoking / tobacco history', h.smoking || h.tobacco);
    } else add('History / background', h);
    add('Longitudinal chart summary', patient.athenaHistorySummary || patient.summary, 1600);
    var text = lines.join('\n\n');
    if (text.length > MAX_PROFILE_CHARS) text = text.slice(0, MAX_PROFILE_CHARS) + '\n[profile context shortened for length]';
    return { text: text, sectionCount: lines.length };
  }

  function buildAthenaSnapshotBlock(patient) {
    var snap = patient && patient.athenaChartSnapshot;
    if (!snap) return { text: '', included: false };
    try {
      if (typeof snap === 'string') return { text: trim(snap).slice(0, MAX_SNAPSHOT_CHARS), included: !!trim(snap) };
      if (typeof snap !== 'object') return { text: '', included: false };
      var ordered = {}, seen = {};
      ['capturedAt', 'pulledAt', 'problems', 'meds', 'medications', 'allergies', 'history', 'summary', 'vitals', 'lastVisit', 'recentVisits', 'visits'].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(snap, k)) { ordered[k] = snap[k]; seen[k] = 1; }
      });
      Object.keys(snap).forEach(function (k) { if (!seen[k]) ordered[k] = snap[k]; });
      var text = JSON.stringify(ordered);
      if (text.length > MAX_SNAPSHOT_CHARS) text = text.slice(0, MAX_SNAPSHOT_CHARS) + '...[latest chart snapshot shortened for length]';
      return { text: text, included: !!text };
    } catch (e) { return { text: '', included: false }; }
  }

  function buildHistoryContext(name, ctx) {
    ctx = ctx || {};
    var verified = verifyPatientIdentity(ctx.patientId, name, ctx.dob);
    if (!verified.patient) return { ok: false, reason: verified.reason, text: '', visitCount: 0, profileSections: 0 };
    var patient = verified.patient;
    var visits = getVisitsFor(patient) || [];
    var profile = buildProfileBlock(patient);
    var snapshot = buildAthenaSnapshotBlock(patient);
    var begin = '=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===';
    var end = '=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===';
    var header =
      'PRIOR LONGITUDINAL HISTORY for this exact patient - ALL ' + visits.length +
      ' known verified visit(s), newest first, plus clinical fields stored on this exact patient profile. ' +
      'Use this for full clinical context (disease progression, prior procedures and response, medications, ' +
      'allergies, and pain/function trend). Do NOT copy it verbatim and do NOT invent anything not present here. ' +
      'Document TODAY\'S procedure in the procedure sections; reference prior history only where clinically appropriate.';

    var fullN = Math.min(FULL_DETAIL_VISITS, visits.length);
    var blocks = [], rest = [], i;
    for (i = 0; i < fullN; i++) blocks.push(visitFull(visits[i]));
    for (i = fullN; i < visits.length; i++) rest.push(visitOneLine(visits[i]));

    function assemble(fullBlocks, restLines, rolled) {
      var out = begin + '\n' + header;
      if (profile.text) out += '\n\nEXACT PATIENT PROFILE (immutable patient ID verified):\n' + profile.text;
      if (snapshot.text) out += '\n\nLATEST VERIFIED ATHENA CHART SNAPSHOT (replaced on the most recent exact-patient pull):\n' + snapshot.text;
      if (fullBlocks.length) out += '\n\nVERIFIED VISITS (newest first):\n' + fullBlocks.join('\n\n');
      else out += '\n\nVERIFIED VISITS: none recorded.';
      if (restLines.length) out += '\n\nEARLIER VERIFIED VISITS (condensed):\n' + restLines.join('\n');
      if (rolled && rolled.length) {
        out += '\n\n+' + rolled.length + ' still-earlier verified visit(s) on file (dates: ' +
          rolled.join(', ') + ') - older context, not detailed here for length.';
      }
      return out + '\n' + end;
    }

    var rolledDates = [], text = assemble(blocks, rest, rolledDates), guard = 0;
    while (text.length > MAX_HISTORY_CHARS && guard++ < 1000) {
      if (rest.length) {
        var dropped = rest.pop();
        var dm = dropped.match(/^\[([^\]]+)\]/);
        rolledDates.push(dm ? dm[1] : '(undated)');
      } else if (blocks.length > 1) {
        rest.unshift(visitOneLine(visits[blocks.length - 1]));
        blocks.pop();
      } else { break; }
      text = assemble(blocks, rest, rolledDates);
    }
    return { ok: true, reason: '', text: text, visitCount: visits.length, profileSections: profile.sectionCount, snapshotIncluded: snapshot.included };
  }

  function buildHistoryBlock(name, ctx) {
    var built = buildHistoryContext(name, ctx);
    return built.ok ? built.text : '';
  }

  function stripInjectedHistory(user) {
    var u = S(user), begin = '=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===', end = '=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===';
    var a = u.indexOf(begin), b;
    if (a >= 0) {
      b = u.indexOf(end, a + begin.length);
      if (b >= 0) u = u.slice(0, a).replace(/\n\n$/, '') + u.slice(b + end.length);
    }
    var legacy = u.indexOf('PRIOR LONGITUDINAL HISTORY');
    var tpl = legacy >= 0 ? u.indexOf('\n\nTEMPLATE (', legacy) : -1;
    if (legacy >= 0 && tpl > legacy) u = u.slice(0, legacy).replace(/\n\n$/, '') + u.slice(tpl);
    return u;
  }

  function injectIntoUser(user, histBlock) {
    var u = S(user);
    if (!histBlock) return u;
    var at = u.indexOf('\n\nTEMPLATE (');
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

  function extractPatientName(user) {
    var m = S(user).match(/^PATIENT:\s*(.+?)\s*$/m);
    return m ? trim(m[1]) : '';
  }

  function extractPatientIdentity(user, opts) {
    var u = S(user);
    var dm = u.match(/^\s*-\s*(?:date of birth|birth date|dob)\s*:?\s*(.+?)\s*$/im);
    return { patientId: trim(opts && opts.mlsOpNotePatientId), name: extractPatientName(u), dob: dm ? trim(dm[1]) : '' };
  }

  // ===========================================================================
  //  BUILD 1 - persistent aiCallRaw injection (order-independent)
  // ===========================================================================
  var ai = { wrapped: false, orig: null, ref: null };

  function setReceipt(receipt) {
    lastInjectionReceipt = receipt;
    try { if (window.__mlsOpNoteHistory) window.__mlsOpNoteHistory.lastInjectionReceipt = receipt; } catch (e) {}
  }

  function identityFailure(reason) {
    setReceipt({ included: false, identityVerified: false, reason: reason || 'identity-check-failed', historyChars: 0, visitCount: 0, profileSections: 0, at: Date.now() });
    var err = new Error('Op-note generation stopped: exact patient identity could not be verified.');
    err.code = 'MLS_OPNOTE_IDENTITY'; err.reason = reason || 'identity-check-failed';
    return err;
  }

  function injectIfOpNote(sys, user, opts) {
    if (!looksLikeOpNoteCall(sys, user)) return user;
    var identity = extractPatientIdentity(user, opts);
    var built = buildHistoryContext(identity.name, { patientId: identity.patientId, dob: identity.dob });
    if (!built.ok) throw identityFailure(built.reason);
    var clean = stripInjectedHistory(user);
    var out = injectIntoUser(clean, built.text);
    setReceipt({ included: true, identityVerified: true, historyChars: built.text.length, visitCount: built.visitCount, profileSections: built.profileSections, snapshotIncluded: built.snapshotIncluded, promptChars: out.length, at: Date.now() });
    return out;
  }

  function wrapAiCall() {
    if (!isFn(window.aiCallRaw)) return;
    if (window.aiCallRaw.__mlsHistAiWrap) return; // already ours on top
    var orig = window.aiCallRaw;
    ai.orig = orig;
    var wrapped = function (sys, user, key, opts) {
      var u2 = user;
      try { u2 = injectIfOpNote(sys, user, opts); }
      catch (e) { return Promise.reject(e); }
      return orig.call(this, sys, u2, key, opts);
    };
    wrapped.__mlsHistAiWrap = true;
    try { window.aiCallRaw = wrapped; ai.wrapped = true; ai.ref = wrapped; } catch (e) {}
  }

  // ===========================================================================
  //  BUILD 2 - real load-state indicator + generate gating
  // ===========================================================================
  var load = {
    serverPending: 0, pullActive: false, watchdog: null,
    wrappedLoad: false, origLoad: null, msgHandler: null,
    modalObserver: null, btnOrigLabel: null, origGenAll: null, _wasOpen: false
  };

  function hasModel() { return !!(window.__mlsVisitModel && isFn(window.__mlsVisitModel.getVisits)); }
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
      var ap = window.activePatient(); if (!ap) return null;
      return getVisitsFor(ap).length;
    } catch (e) { return null; }
  }

  function wrapLoad() {
    if (!isFn(window.loadPatientsFromServer)) return;
    if (window.loadPatientsFromServer.__mlsHistWrapped) return;
    var orig = window.loadPatientsFromServer;
    load.origLoad = orig;
    var w = async function () {
      load.serverPending++; renderChip();
      try { return await orig.apply(this, arguments); }
      finally { load.serverPending = Math.max(0, load.serverPending - 1); renderChip(); }
    };
    w.__mlsHistWrapped = true;
    try { window.loadPatientsFromServer = w; load.wrappedLoad = true; } catch (e) {}
  }

  function onVisitMessage(ev) {
    try {
      var d = ev && ev.data; if (!d || typeof d !== 'object') return;
      var t = d.type || d.kind || '';
      if (t === 'mlsAppVisitsProgress' || t === 'mlsAppSearchProgress') { load.pullActive = true; armWatchdog(); renderChip(); }
      else if (t === 'mlsAppAllVisitsResult' || t === 'mlsAppReadAllVisitsResult') { clearWatchdog(); load.pullActive = false; renderChip(); }
    } catch (e) {}
  }
  function armWatchdog() { clearWatchdog(); load.watchdog = setTimeout(function () { load.pullActive = false; renderChip(); }, PULL_WATCHDOG_MS); }
  function clearWatchdog() { if (load.watchdog) { clearTimeout(load.watchdog); load.watchdog = null; } }

  function ensureChip() {
    var hdr = document.getElementById('opPrepHdr');
    if (!hdr) return null;
    var chip = document.getElementById('mlsOpHistChip');
    if (!chip) {
      chip = document.createElement('span');
      chip.id = 'mlsOpHistChip';
      chip.setAttribute('data-mls', 'opnote-history');
      chip.style.cssText = 'display:inline-block;margin-left:10px;font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;vertical-align:middle;white-space:nowrap';
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
      var chip = ensureChip(); if (!chip) return;
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
        btn.disabled = true; btn.dataset.mlsHistDisabled = '1';
        btn.style.opacity = '0.6'; btn.style.cursor = 'not-allowed';
        btn.textContent = '⏳ Loading history…';
      } else if (btn.dataset.mlsHistDisabled === '1') {
        btn.disabled = false; delete btn.dataset.mlsHistDisabled;
        btn.style.opacity = ''; btn.style.cursor = '';
        btn.textContent = load.btnOrigLabel || 'Draft all op notes';
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

  function onModalToggle() {
    var open = modalOpen();
    if (open && !load._wasOpen) {
      load._wasOpen = true;
      if (backendOn() && load.serverPending === 0 && isFn(window.loadPatientsFromServer)) {
        try { var r = window.loadPatientsFromServer(); if (r && isFn(r.then)) r.then(function () {}, function () {}); } catch (e) {}
      }
    } else if (!open) { load._wasOpen = false; }
    if (open) renderChip();
  }

  // ===========================================================================
  //  wire / revert
  // ===========================================================================
  function wire() {
    safe(wrapAiCall);
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
    try { if (ai.wrapped && ai.orig && window.aiCallRaw && window.aiCallRaw.__mlsHistAiWrap) window.aiCallRaw = ai.orig; } catch (e) {}
    try { if (load.wrappedLoad && load.origLoad) window.loadPatientsFromServer = load.origLoad; } catch (e) {}
    try { if (load.origGenAll && window.opPrepGenerateAll && window.opPrepGenerateAll.__mlsHistWrapped) window.opPrepGenerateAll = load.origGenAll; } catch (e) {}
    try { if (load.msgHandler) window.removeEventListener('message', load.msgHandler, false); } catch (e) {}
    try { if (load.modalObserver) { load.modalObserver.disconnect(); load.modalObserver = null; } } catch (e) {}
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
    ai.wrapped = false; load.wrappedLoad = false; load.pullActive = false; load.serverPending = 0;
  }

  function bootRewire() {
    safe(wire);
    var tries = 0;
    _rewireIv = setInterval(function () {
      tries++;
      if (_reverted) { clearInterval(_rewireIv); _rewireIv = null; return; }
      safe(function () {
        // Stay in the aiCallRaw chain if a later-loading module displaced us.
        if (isFn(window.aiCallRaw) && !window.aiCallRaw.__mlsHistAiWrap) wrapAiCall();
        if (isFn(window.opPrepGenerateAll) && !window.opPrepGenerateAll.__mlsHistWrapped) wrapGenerateAll();
        if (isFn(window.loadPatientsFromServer) && !window.loadPatientsFromServer.__mlsHistWrapped) wrapLoad();
        watchModal();
      });
      if (tries >= 120) { clearInterval(_rewireIv); _rewireIv = null; } // ~60s of opportunistic re-wiring, then stop
    }, 500);
  }

  window.__mlsOpNoteHistory = {
    installed: true,
    version: VERSION,
    buildHistoryBlock: buildHistoryBlock,
    injectIntoUser: injectIntoUser,
    injectIfOpNote: injectIfOpNote,
    looksLikeOpNoteCall: looksLikeOpNoteCall,
    extractPatientName: extractPatientName,
    extractPatientIdentity: extractPatientIdentity,
    lastInjectionReceipt: lastInjectionReceipt,
    readyState: readyState,
    renderChip: renderChip,
    _internal: { ai: ai, load: load, resolvePatient: resolvePatient, verifyPatientIdentity: verifyPatientIdentity, getVisitsFor: getVisitsFor, buildProfileBlock: buildProfileBlock, buildAthenaSnapshotBlock: buildAthenaSnapshotBlock, buildHistoryContext: buildHistoryContext },
    rewire: wire,
    revert: revert
  };

  if (document.readyState === 'loading') {
    try { document.addEventListener('DOMContentLoaded', bootRewire, { once: true }); } catch (e) { bootRewire(); }
  } else { bootRewire(); }
})();

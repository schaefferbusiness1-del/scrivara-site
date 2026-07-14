/* ============================================================================
   feat_opnote_history.js  ->  window.__mlsOpNoteHistory   (v1.4.0)

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

   Token budget: every verified visit remains in a compact longitudinal index.
   Rich detail is selected by recency plus procedure relevance, so an older
   clinically relevant visit is not silently displaced by six newer routine
   visits. Nothing invented: every value comes from the exact patient record.

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

  var VERSION = '1.4.0';
  var _rewireIv = null;
  var _reverted = false;
  var lastInjectionReceipt = null;

  var MAX_HISTORY_CHARS = 12000;
  var MAX_PROFILE_CHARS = 3000;
  var MAX_SNAPSHOT_CHARS = 2500;
  var FULL_DETAIL_VISITS = 6;
  var PULL_WATCHDOG_MS = 25000;

  function S(x) { return (x == null) ? '' : String(x); }
  function trim(x) { return S(x).trim(); }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function isFn(f) { return typeof f === 'function'; }
  function uniq(arr) { var o = {}, out = [], list = Array.isArray(arr) ? arr : (trim(arr) ? [arr] : []); list.forEach(function (v) { v = trim(v); if (v && !o[v]) { o[v] = 1; out.push(v); } }); return out; }

  function normDob(s) {
    try {
      var m = window.__mlsVisitModel;
      if (m && isFn(m._normDob)) return m._normDob(s) || '';
    } catch (e) {}
    var x = trim(s).match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
    return x ? trim(s) : '';
  }

  function normName(s) { return trim(s).toLowerCase().replace(/\s+/g, ' '); }

  function nameTokenKey(s) {
    var x = normName(s);
    if (!x) return '';
    try { if (isFn(x.normalize)) x = x.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return x.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join('|');
  }

  function safeNameVariant(a, b) {
    var left = normName(a), right = normName(b);
    if (!left || !right) return false;
    if (left === right) return true;
    var leftKey = nameTokenKey(left), rightKey = nameTokenKey(right);
    return !!leftKey && leftKey === rightKey;
  }

  function textFingerprint(value) {
    var s = S(value), h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 16777619) : ((h * 16777619) >>> 0);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8) + ':' + s.length;
  }

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

  function visitMatchesPatient(patient, visit) {
    if (!patient || !visit) return false;
    var pid = trim(patient.id);
    var binding = trim(visit.identityBinding);
    var owner = trim(binding || visit.patientId || visit.patientExternalId || visit.patient_external_id || visit._mlsTargetPatientId);
    var exactVerifiedBinding = !!pid && binding === pid && visit.identityVerified === true;
    var remote = /athena|legacy|grab/i.test(trim(visit.source));
    if (binding && !exactVerifiedBinding) return false;
    if (remote && visit.identityVerified !== true) return false;
    if (owner && owner !== pid) return false;
    if (trim(visit.patientDob) && normDob(visit.patientDob) !== normDob(patient.dob)) return false;
    if (trim(visit.patientName)) {
      if (exactVerifiedBinding) {
        if (!safeNameVariant(visit.patientName, patient.name)) return false;
      } else if (normName(visit.patientName) !== normName(patient.name)) return false;
    }
    return true;
  }

  function getVisitsFor(patient) {
    try {
      var m = window.__mlsVisitModel;
      var visits = [];
      if (patient && m && isFn(m.usableVisits)) visits = m.usableVisits(patient) || [];
      else if (patient && m && isFn(m.getVisits)) visits = (m.getVisits(patient) || []).filter(function (v) {
        return !/athena|legacy|grab/i.test(trim(v && v.source)) || v.identityVerified === true;
      });
      return visits.filter(function (v) { return visitMatchesPatient(patient, v); });
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

  function boundedClinicalText(value, max, minimum) {
    var text = trim(value), limit = Math.max(minimum == null ? 120 : minimum, max || 1400);
    if (!text || text.length <= limit) return text;
    if (limit < 100) return text.slice(0, Math.max(1, limit - 3)).trim() + '...';
    var marker = '\n...[middle shortened for prompt length]...\n';
    var keep = Math.max(40, limit - marker.length);
    var head = Math.floor(keep * 0.68);
    return text.slice(0, head).trim() + marker + text.slice(-(keep - head)).trim();
  }

  function richClinicalBody(v) {
    var seen = {}, parts = [];
    ['raw', 'clinicalBody', 'fullText', 'body', 'detail', 'noteText', 'documentation', 'content'].forEach(function (key) {
      var value = trim(v && v[key]);
      var fingerprint = value.toLowerCase().replace(/\s+/g, ' ');
      if (value && !seen[fingerprint]) { seen[fingerprint] = 1; parts.push(value); }
    });
    return parts.join('\n\n');
  }

  function visitFull(v, rawLimit) {
    var date = trim(v.date) || '(undated)';
    var lines = ['[' + date + '] ' + (trim(v.type) || 'Visit')];
    var dx = uniq(v.icd10); if (dx.length) lines.push('  Dx / ICD-10: ' + dx.join(', '));
    var cpt = uniq(v.cpt); if (cpt.length) lines.push('  Procedures / CPT: ' + cpt.join(', '));
    var meds = uniq(v.meds); if (meds.length) lines.push('  Meds: ' + meds.join('; '));
    if (trim(v.findings)) lines.push('  Findings: ' + trim(v.findings));
    var sc = scoresStr(v.scores); if (sc) lines.push('  Scores: ' + sc);
    if (trim(v.plan)) lines.push('  Plan: ' + trim(v.plan));
    if (trim(v.aiSummary)) lines.push('  Summary: ' + trim(v.aiSummary));
    var clinical = richClinicalBody(v);
    /* Raw Athena prose can contain the response to prior treatment, operative
       technique, complications, or rationale that the structured fields do
       not. Preserve it even when Dx/CPT/plan fields are also populated. */
    if (clinical) lines.push('  Verified clinical detail: ' + boundedClinicalText(clinical, rawLimit || 1400));
    return lines.join('\n');
  }

  function visitOneLine(v, maxChars) {
    var date = trim(v.date) || '(undated)';
    var bits = [trim(v.type) || 'Visit'];
    var dx = uniq(v.icd10); if (dx.length) bits.push('ICD ' + dx.slice(0, 3).join('/'));
    var cpt = uniq(v.cpt); if (cpt.length) bits.push('CPT ' + cpt.slice(0, 3).join('/'));
    var sc = scoresStr(v.scores); if (sc) bits.push(sc);
    var clinical = trim(v.aiSummary) || trim(v.plan) || trim(v.findings) || trim(v.recommendations) || trim(v.plannedProcedure) || richClinicalBody(v);
    if (clinical) bits.push('clinical: ' + clinical.replace(/\s+/g, ' '));
    return boundedClinicalText('[' + date + '] ' + bits.join('; '), maxChars || 340, 48).replace(/\n/g, ' ');
  }

  function procedureTokens(procedure) {
    var stop = { the:1, and:1, for:1, with:1, under:1, using:1, procedure:1, note:1, visit:1, injection:1 };
    var seen = {};
    return normName(procedure).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(function (word) {
      if (!word || stop[word] || (word.length < 3 && !/^[c-lst]\d$/i.test(word)) || seen[word]) return false;
      seen[word] = 1; return true;
    });
  }

  function visitSearchText(v) {
    return [v.type, v.reason, v.plannedProcedure, v.recommendations, v.plan, v.findings,
      v.aiSummary, richClinicalBody(v), uniq(v.icd10).join(' '), uniq(v.cpt).join(' ')].map(trim).join(' ').toLowerCase();
  }

  function detailedVisitCandidates(visits, procedure) {
    var terms = procedureTokens(procedure);
    return visits.map(function (visit, index) {
      var haystack = visitSearchText(visit), matches = 0;
      terms.forEach(function (term) { if (haystack.indexOf(term) >= 0) matches++; });
      var clinicalLength = richClinicalBody(visit).length + trim(visit.findings).length + trim(visit.plan).length;
      var score = matches * 100 + Math.min(25, Math.floor(clinicalLength / 120)) + Math.max(0, 12 - index);
      if (index < 2) score += 80; // always give the latest encounters a strong claim
      return { visit: visit, index: index, score: score, matches: matches };
    }).sort(function (a, b) { return b.score - a.score || a.index - b.index; });
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
    var visits = (getVisitsFor(patient) || []).slice();
    visits = visits.map(function (visit, index) { return { visit: visit, index: index }; }).sort(function (a, b) {
      var ad = Date.parse(trim(a.visit && (a.visit.date || a.visit.created)) || ''), bd = Date.parse(trim(b.visit && (b.visit.date || b.visit.created)) || '');
      if (!isNaN(ad) && !isNaN(bd) && ad !== bd) return bd - ad;
      return a.index - b.index;
    }).map(function (entry) { return entry.visit; });
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

    var profileLimit = visits.length > 40 ? 1500 : MAX_PROFILE_CHARS;
    var snapshotLimit = visits.length > 40 ? 1000 : MAX_SNAPSHOT_CHARS;
    var profileTextBounded = boundedClinicalText(profile.text, profileLimit);
    var snapshotTextBounded = boundedClinicalText(snapshot.text, snapshotLimit);
    var skeletonLength = begin.length + end.length + header.length + profileTextBounded.length + snapshotTextBounded.length + 260;
    var indexBudget = Math.max(900, Math.min(4200, MAX_HISTORY_CHARS - skeletonLength - 1800));
    var indexMax = visits.length ? Math.max(48, Math.min(360, Math.floor(indexBudget / visits.length) - 1)) : 360;
    var indexLines = visits.map(function (visit) { return visitOneLine(visit, indexMax); });
    var candidates = detailedVisitCandidates(visits, ctx.procedure).slice(0, Math.min(FULL_DETAIL_VISITS, visits.length));
    var detailBudget = Math.max(0, MAX_HISTORY_CHARS - skeletonLength - indexLines.join('\n').length - 180);
    var chosen = [];
    for (var ci = 0; ci < candidates.length && detailBudget >= 260; ci++) {
      var remainingSlots = Math.max(1, candidates.length - ci);
      var rawLimit = Math.max(220, Math.min(1400, Math.floor(detailBudget / remainingSlots) - 220));
      var block = visitFull(candidates[ci].visit, rawLimit);
      if (block.length <= detailBudget || !chosen.length) {
        chosen.push({ index: candidates[ci].index, block: boundedClinicalText(block, Math.max(240, detailBudget)) });
        detailBudget -= Math.min(detailBudget, block.length + 2);
      }
    }
    chosen.sort(function (a, b) { return a.index - b.index; });

    function assemble(detailBlocks, allVisitLines) {
      var out = begin + '\n' + header;
      if (profileTextBounded) out += '\n\nEXACT PATIENT PROFILE (immutable patient ID verified):\n' + profileTextBounded;
      if (snapshotTextBounded) out += '\n\nLATEST VERIFIED ATHENA CHART SNAPSHOT (replaced on the most recent exact-patient pull):\n' + snapshotTextBounded;
      if (allVisitLines.length) out += '\n\nALL VERIFIED VISITS INDEX (newest first; every visit represented):\n' + allVisitLines.join('\n');
      else out += '\n\nVERIFIED VISITS: none recorded.';
      if (detailBlocks.length) out += '\n\nRICH VERIFIED CLINICAL DETAIL (recent and procedure-relevant visits):\n' + detailBlocks.map(function (x) { return x.block; }).join('\n\n');
      return out + '\n' + end;
    }

    var text = assemble(chosen, indexLines);
    while (text.length > MAX_HISTORY_CHARS && chosen.length > 1) { chosen.pop(); text = assemble(chosen, indexLines); }
    if (text.length > MAX_HISTORY_CHARS && indexMax > 48) {
      indexMax = Math.max(48, indexMax - Math.ceil((text.length - MAX_HISTORY_CHARS) / Math.max(1, visits.length)) - 2);
      indexLines = visits.map(function (visit) { return visitOneLine(visit, indexMax); });
      text = assemble(chosen, indexLines);
    }
    return { ok: true, reason: '', text: text, visitCount: visits.length, profileSections: profile.sectionCount, snapshotIncluded: snapshot.included, patientId: trim(patient.id), patientName: trim(patient.name), patientDob: trim(patient.dob), procedure: trim(ctx.procedure) };
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

  function looksLikeOpNoteCall(sys, user, opts) {
    var s = S(sys), u = S(user);
    if (opts && opts.mlsOpNotePhase === 'repair' && opts.mlsTemplateFidelity === true && trim(opts.mlsOpNotePatientId) && /repair the draft/i.test(s)) return true;
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

  function extractProcedure(user) {
    var m = S(user).match(/^PROCEDURE:\s*(.+?)\s*$/m);
    return m ? trim(m[1]) : '';
  }

  function bindingToken(identity, built) {
    return textFingerprint([trim(identity.patientId), normName(identity.name), normDob(identity.dob), trim(identity.procedure), built.text].join('\n'));
  }

  function storeBinding(opts, binding) {
    if (!opts || typeof opts !== 'object') return false;
    try { opts.mlsVerifiedHistoryBinding = Object.freeze ? Object.freeze(binding) : binding; return opts.mlsVerifiedHistoryBinding === binding; }
    catch (e) { return false; }
  }

  function validateBinding(opts) {
    var binding = opts && opts.mlsVerifiedHistoryBinding;
    if (!binding) return { ok: false, reason: 'missing-history-binding' };
    if (trim(binding.patientId) !== trim(opts && opts.mlsOpNotePatientId)) return { ok: false, reason: 'patient-id-changed' };
    var identity = {
      patientId: trim(binding.patientId), name: trim(binding.patientName), dob: trim(binding.patientDob), procedure: trim(binding.procedure)
    };
    var built = buildHistoryContext(identity.name, { patientId: identity.patientId, dob: identity.dob, procedure: identity.procedure });
    if (!built.ok) return { ok: false, reason: built.reason || 'identity-check-failed' };
    var currentToken = bindingToken(identity, built);
    var frozenToken = bindingToken(identity, { text: S(binding.context) });
    if (binding.token !== currentToken || binding.token !== frozenToken) return { ok: false, reason: 'patient-or-visit-context-changed' };
    return { ok: true, reason: '', binding: binding, built: built };
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
    if (!looksLikeOpNoteCall(sys, user, opts)) return user;
    var isRepair = !!(opts && opts.mlsOpNotePhase === 'repair');
    var binding = isRepair && opts ? opts.mlsVerifiedHistoryBinding : null;
    var identity = isRepair && binding ? {
      patientId: trim(binding.patientId), name: trim(binding.patientName), dob: trim(binding.patientDob), procedure: trim(binding.procedure)
    } : extractPatientIdentity(user, opts);
    if (!identity.procedure) identity.procedure = extractProcedure(user);
    var built = buildHistoryContext(identity.name, { patientId: identity.patientId, dob: identity.dob, procedure: identity.procedure });
    if (!built.ok) throw identityFailure(built.reason);
    var token = bindingToken(identity, built);
    if (isRepair) {
      var validation = validateBinding(opts);
      if (!validation.ok) throw identityFailure(validation.reason);
      binding = validation.binding; built = validation.built; token = binding.token;
    } else {
      binding = {
        patientId: identity.patientId, patientName: built.patientName, patientDob: built.patientDob,
        procedure: identity.procedure, context: built.text, token: token, visitCount: built.visitCount
      };
      if (!storeBinding(opts, binding)) throw identityFailure('history-binding-unavailable');
    }
    var clean = stripInjectedHistory(user);
    var exactContext = isRepair ? S(binding.context) : built.text;
    var out = injectIntoUser(clean, exactContext);
    setReceipt({ included: true, identityVerified: true, phase: isRepair ? 'repair' : 'initial', historyChars: exactContext.length, visitCount: built.visitCount, profileSections: built.profileSections, snapshotIncluded: built.snapshotIncluded, contextToken: binding.token, promptChars: out.length, at: Date.now() });
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
    validateBinding: validateBinding,
    lastInjectionReceipt: lastInjectionReceipt,
    readyState: readyState,
    renderChip: renderChip,
    _internal: { ai: ai, load: load, resolvePatient: resolvePatient, verifyPatientIdentity: verifyPatientIdentity, visitMatchesPatient: visitMatchesPatient, getVisitsFor: getVisitsFor, visitFull: visitFull, visitOneLine: visitOneLine, detailedVisitCandidates: detailedVisitCandidates, buildProfileBlock: buildProfileBlock, buildAthenaSnapshotBlock: buildAthenaSnapshotBlock, buildHistoryContext: buildHistoryContext },
    rewire: wire,
    revert: revert
  };

  if (document.readyState === 'loading') {
    try { document.addEventListener('DOMContentLoaded', bootRewire, { once: true }); } catch (e) { bootRewire(); }
  } else { bootRewire(); }
})();

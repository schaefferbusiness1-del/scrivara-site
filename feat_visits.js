/* ============================================================================
 * MLS — Visit-aware patient records  (append-only bundle for mls-connect.js)
 * Three independent, self-contained IIFEs. Removing any block fully reverts it.
 *   1) window.__mlsVisitModel  — the visit-aware data model + AI summaries
 *   2) window.__mlsVisitUI      — per-visit profile UI (Feature 2)
 *   3) window.__mlsCopyVisits   — one-click "Copy every visit" (Feature 1)
 * No backend schema change: visits ride inside the existing patient JSON that
 * upsertPatient() already mirrors to the server. ScribeFlow.html is untouched.
 * Read-only in athenaOne; never clicks Save/Sign. Strict name+DOB verify gate.
 * ==========================================================================*/

/* ----------------------------------------------------------------------------
 * 1) VISIT-AWARE DATA MODEL — window.__mlsVisitModel
 * --------------------------------------------------------------------------*/
(function () {
  'use strict';
  if (window.__mlsVisitModel) return;

  var isFn = function (f) { return typeof f === 'function'; };
  var S = function (x) { return (x == null ? '' : String(x)); };
  var trim = function (x) { return S(x).trim(); };

  function _getPatients() { try { return isFn(window.getPatients) ? (window.getPatients() || []) : []; } catch (e) { return []; } }
  function _findPatient(id) {
    try { if (isFn(window.findPatient)) return window.findPatient(id); } catch (e) {}
    return _getPatients().find(function (p) { return p && p.id === id; }) || null;
  }
  function _upsert(p) {
    try { if (isFn(window.upsertPatient)) { window.upsertPatient(p); return true; } } catch (e) {}
    try {
      if (isFn(window.getPatients) && isFn(window.savePatients)) {
        var arr = window.getPatients(); var i = arr.findIndex(function (x) { return x.id === p.id; });
        p.updated = Date.now(); if (i >= 0) arr[i] = p; else { p.created = p.created || Date.now(); arr.unshift(p); }
        window.savePatients(arr); return true;
      }
    } catch (e) {}
    return false;
  }

  function _normDob(s) {
    s = trim(s); if (!s) return '';
    var iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return [String(+iso[2]).padStart(2,'0'), String(+iso[3]).padStart(2,'0'), +iso[1]].join('/');
    var m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { var mo = +m[1], d = +m[2], y = +m[3]; if (y < 100) y += (y > 40 ? 1900 : 2000);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return [String(mo).padStart(2,'0'), String(d).padStart(2,'0'), y].join('/'); }
    return '';
  }
  function _svcToYMD(s) {
    s = trim(s); if (!s) return '';
    var iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return [iso[1], String(+iso[2]).padStart(2,'0'), String(+iso[3]).padStart(2,'0')].join('-');
    var m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { var mo = +m[1], d = +m[2], y = +m[3]; if (y < 100) y += (y > 40 ? 1900 : 2000);
      return [y, String(mo).padStart(2,'0'), String(d).padStart(2,'0')].join('-'); }
    try { if (window.__mlsStudy && isFn(window.__mlsStudy._svcToYMD)) return window.__mlsStudy._svcToYMD(s) || ''; } catch (e) {}
    return '';
  }
  function _codes(text, re) { var out = [], m, r = new RegExp(re, 'g'); while ((m = r.exec(S(text)))) { var c = m[0].toUpperCase(); if (out.indexOf(c) < 0) out.push(c); if (out.length > 40) break; } return out; }
  function _cpt(text) { return _codes(text, '\\b\\d{5}\\b'); }
  function _icd10(text) { return _codes(text, '\\b[A-TV-Z]\\d[0-9A-Z](?:\\.[0-9A-Z]{1,4})?\\b'); }

  function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function _visitKey(v) {
    v = v || {};
    var encounterId = trim(v.encounterId || v.encounterID || '');
    if (encounterId) return 'encounter|' + encounterId.toLowerCase();
    var sourceVisitKey = trim(v.sourceVisitKey || v.rowKey || '');
    if (sourceVisitKey) return 'source|' + sourceVisitKey.toLowerCase();
    var d = _svcToYMD(v.date) || trim(v.date);
    var t = trim(v.type || v.procedure || '').toLowerCase().slice(0, 40);
    var c = (Array.isArray(v.cpt) && v.cpt[0]) ? v.cpt[0] : '';
    return [d, t, c].join('|');
  }

  function _hasVisitContent(v) {
    if (!v) return false;
    var text = trim(v.raw || v.text || v.note || v.detail || v.textHead || v.findings || v.plan || v.aiSummary || '');
    var codes = ((v.cpt && v.cpt.length) || 0) + ((v.icd10 && v.icd10.length) || 0) + ((v.meds && v.meds.length) || 0);
    var scores = v.scores && typeof v.scores === 'object' && Object.keys(v.scores).length;
    return !!(text || codes || scores);
  }

  function _emptyPlaceholder(v) {
    if (!v) return false;
    /* Normalization assigns every row an internal ID. indexOnly is therefore the
       authoritative shell marker and must be checked before the legacy no-ID rule. */
    if (v.indexOnly === true) return true;
    if (v.id) return false;
    if (!_hasVisitContent(v)) return true;
    /* The organized chart reader can create a dated, summary-only shell before
       the full per-encounter reader arrives. That AI summary is derived from
       row metadata, not encounter content, so it must not keep a duplicate row
       once a real ID/raw encounter exists for the same service date. Preserve
       every other no-ID record unless it is unmistakably this reader's shell. */
    var source = trim(v.source || '').toLowerCase();
    if (source !== 'athena-visits') return false;
    var body = trim(v.raw || v.text || v.note || v.detail || v.findings || v.plan || '');
    var codes = ((v.cpt && v.cpt.length) || 0) + ((v.icd10 && v.icd10.length) || 0) + ((v.meds && v.meds.length) || 0);
    var scores = v.scores && typeof v.scores === 'object' && Object.keys(v.scores).length;
    return !body && !codes && !scores;
  }

  function _remoteVisit(v) {
    return /athena|legacy|grab/i.test(trim(v && v.source));
  }

  function _trustCompatible(a, b) {
    var ar = _remoteVisit(a), br = _remoteVisit(b);
    if (!ar && !br) return true;
    if (ar !== br) return false;
    if (!!a.identityVerified !== !!b.identityVerified) return false;
    if (a.identityVerified === true) {
      return !!(trim(a.identityBinding) && trim(b.identityBinding) && trim(a.identityBinding) === trim(b.identityBinding));
    }
    return true;
  }

  function _compactHydratedPlaceholders(p) {
    if (!p || !Array.isArray(p.visits)) return false;
    var changed = false;
    var real = p.visits.filter(function (v) { return !!(v && v.id && v.indexOnly !== true && _hasVisitContent(v) && _svcToYMD(v.date)); });
    real.forEach(function (full) {
      var day = _svcToYMD(full.date);
      var idx = -1;
      for (var i = 0; i < p.visits.length; i++) {
        var q = p.visits[i];
        if (q !== full && _emptyPlaceholder(q) && _svcToYMD(q.date) === day && _trustCompatible(q, full)) { idx = i; break; }
      }
      if (idx >= 0) { p.visits.splice(idx, 1); changed = true; }
    });
    return changed;
  }

  function _normVisit(raw, source, opts) {
    opts = opts || {};
    var v = (raw && typeof raw === 'object') ? raw : {};
    /* Trust metadata is control-plane state, never visit payload data.  The
       extension/chart reader may supply arbitrary object fields, so only an
       identity-gated caller can grant trust through opts. Existing persisted
       visits are read directly by getVisits() and are intentionally not
       re-normalized through this untrusted ingestion boundary. */
    var identityBinding = trim(opts.identityBinding || '');
    var identityVerified = opts.identityVerified === true && !!identityBinding;
    var forcedIndexOnly = opts.indexOnly === true;
    var bodyText = (typeof raw === 'string') ? (forcedIndexOnly ? '' : raw) : S(v.raw || v.text || v.note || v.detail || '');
    var indexText = (typeof raw === 'string') ? (forcedIndexOnly ? raw : '') : S(v.textHead || '');
    /* Visits-pane rows are useful index evidence, but they are not clinical
       bodies. Preserve their text for audit/display and mark it indexOnly so it
       can never silently feed a summary or operative-note prompt. */
    var indexOnly = forcedIndexOnly || v.indexOnly === true || (!trim(bodyText) && !!trim(indexText));
    var text = bodyText || indexText;
    var blob = [text, S(v.summary), S(v.assessment), S(v.plan)].join('\n');
    var stringType = '';
    if (typeof raw === 'string') {
      var tm = text.match(/(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\s*(?:—|–|-)\s*([^\n|]{2,120})/);
      if (tm) stringType = trim(tm[1]).replace(/\s*(?:\*\*)?(?:patient|provider|visit date|dob)(?:\*\*)?\s*:.*$/i, '');
      if (!stringType) {
        var vm = text.match(/(?:^|\n)\s*(?:\*\*)?(?:visit type|procedure)(?:\*\*)?\s*:\s*(?:\*\*)?([^\n|]{2,120})/i);
        if (vm) stringType = trim(vm[1]);
      }
    }
    var visit = {
      id: v.id || _uid(),
      date: _svcToYMD(v.date || v.serviceDate || v.dos || v.dateOfService || (typeof raw === 'string' ? text : '')) || trim(v.date || ''),
      type: trim(v.type || v.procedure || v.visitType || v.encounterType || v.reason || stringType || ''),
      cpt: (Array.isArray(v.cpt) ? v.cpt.slice() : _cpt(blob)),
      icd10: (Array.isArray(v.icd10) ? v.icd10.slice() : _icd10(blob)),
      meds: (Array.isArray(v.meds) ? v.meds.slice() : (v.meds ? [S(v.meds)] : [])),
      findings: trim(v.findings || v.exam || ''),
      scores: (v.scores && typeof v.scores === 'object') ? v.scores : (v.scores ? { note: S(v.scores) } : {}),
      plan: trim(v.plan || ''),
      raw: indexOnly ? '' : trim(bodyText || blob),
      textHead: trim(indexText || (indexOnly ? text : '')),
      indexOnly: indexOnly,
      fullDetail: v.fullDetail === true && !indexOnly,
      bodyComplete: opts.bodyComplete === true && v.fullDetail === true && !indexOnly,
      encounterId: trim(v.encounterId || v.encounterID || ''),
      sourceVisitKey: trim(v.sourceVisitKey || v.rowKey || ''),
      patientName: trim(v.patientName || v.patient || ''),
      patientDob: trim(v.patientDob || v.birthDate || v.dob || ''),
      patientMrn: trim(v.patientMrn || v.mrn || v.athenaId || ''),
      encounterIndex: Number.isFinite(Number(v.encounterIndex)) ? Number(v.encounterIndex) : null,
      aiSummary: trim(v.aiSummary || ''),
      /* Source is also provenance supplied by the caller, not by raw chart
         content. Keep the historical local-import default for callers that do
         not classify a row, but never let a payload downgrade an Athena row
         to a trusted manual source. */
      source: trim(source || '') || 'import',
      captured: v.captured || new Date().toISOString(),
      /* Athena-derived rows are allowed into longitudinal/operative-note
         context only after the extension has identity-gated the batch and the
         app has rejected any contradictory identity printed inside the row. */
      identityVerified: identityVerified,
      identityBinding: identityVerified ? identityBinding : ''
    };
    if (!visit.type && /injection|block|ablation|esi|rfa|epidural|facet|procedure/i.test(visit.raw)) visit.type = 'Procedure';
    return visit;
  }

  function getVisits(p) {
    if (!p) return [];
    var vs = Array.isArray(p.visits) ? p.visits.slice() : [];
    vs.sort(function (a, b) {
      var da = _svcToYMD(a.date), db = _svcToYMD(b.date);
      if (da && db) return db.localeCompare(da);
      if (da) return -1; if (db) return 1; return 0;
    });
    return vs;
  }

  function addVisit(patientId, raw, opts) {
    opts = opts || {};
    var p = _findPatient(patientId); if (!p) return null;
    if (!Array.isArray(p.visits)) p.visits = [];
    var v = _normVisit(raw, opts.source, opts);
    var key = _visitKey(v);
    var existing = p.visits.find(function (x) { return _visitKey(x) === key && _trustCompatible(x, v); });
    /* Organized chart pulls can create a dated shell before the optional full
       visit reader runs. Upgrade one strictly empty shell on the same day
       instead of creating a duplicate when Athena's detailed type label differs. */
    if (!existing && v.date) {
      existing = p.visits.find(function (x) {
        return _emptyPlaceholder(x) && _svcToYMD(x.date) === _svcToYMD(v.date) && _trustCompatible(x, v);
      }) || null;
    }
    if (existing) {
      /* Older organized-history imports created date/type placeholders without
         a stable visit id. A later full-detail pull must upgrade that same row
         in place so per-visit AI summarization can address and persist it. */
      if (!existing.id) existing.id = v.id || _uid();
      var verifiedAthenaRefresh = _remoteVisit(existing) && _remoteVisit(v) &&
        existing.identityVerified === true && v.identityVerified === true &&
        trim(existing.identityBinding) && trim(existing.identityBinding) === trim(v.identityBinding) &&
        v.fullDetail === true && v.bodyComplete === true && v.indexOnly !== true;
      /* A repeat pull is an idempotent enrichment, not an append. For the exact
         same verified Athena encounter, a body-complete batch replaces the old
         clinical body even when Athena's current rendering is shorter (for
         example, a corrected note). Manual and unverified rows never enter this
         branch and retain the historical longest-text behavior. */
      if (verifiedAthenaRefresh) existing.raw = v.raw;
      else if (v.raw.length > S(existing.raw).length) existing.raw = v.raw;
      ['cpt', 'icd10', 'meds'].forEach(function (k) {
        var set = {}, values = verifiedAthenaRefresh ? (v[k] || []) : (existing[k] || []).concat(v[k] || []);
        values.forEach(function (c) { if (c) set[c] = 1; });
        existing[k] = Object.keys(set);
      });
      existing.type = verifiedAthenaRefresh ? (v.type || existing.type) : (existing.type || v.type);
      existing.date = existing.date || v.date;
      existing.findings = verifiedAthenaRefresh ? v.findings : (existing.findings || v.findings);
      existing.plan = verifiedAthenaRefresh ? v.plan : (existing.plan || v.plan);
      if (verifiedAthenaRefresh) {
        existing.indexOnly = false;
        existing.fullDetail = true;
        existing.bodyComplete = true;
        existing.textHead = v.textHead || existing.textHead || '';
        existing.encounterId = v.encounterId || existing.encounterId || '';
        existing.sourceVisitKey = v.sourceVisitKey || existing.sourceVisitKey || '';
        existing.encounterIndex = v.encounterIndex != null ? v.encounterIndex : existing.encounterIndex;
        existing.patientName = v.patientName || existing.patientName || '';
        existing.patientDob = v.patientDob || existing.patientDob || '';
        existing.patientMrn = v.patientMrn || existing.patientMrn || '';
        existing.captured = v.captured || existing.captured;
      } else if (existing.indexOnly === true && v.indexOnly !== true && v.fullDetail === true) {
        existing.indexOnly = false;
        existing.fullDetail = true;
      }
      if (verifiedAthenaRefresh) existing.aiSummary = v.aiSummary || '';
      else if (v.aiSummary && v.aiSummary.length > S(existing.aiSummary).length) existing.aiSummary = v.aiSummary;
      if (v.identityVerified) {
        existing.identityVerified = true;
        existing.identityBinding = v.identityBinding || existing.identityBinding || '';
      }
      v = existing;
    } else {
      p.visits.push(v);
    }
    _compactHydratedPlaceholders(p);
    if (opts.persist !== false) _upsert(p);
    return v;
  }

  function reconcileVerifiedAthenaVisits(patientId, batchRows) {
    var p = _findPatient(patientId); if (!p) return { removed: 0, kept: 0 };
    if (!Array.isArray(p.visits)) p.visits = [];
    var accepted = {};
    (Array.isArray(batchRows) ? batchRows : []).forEach(function (row) {
      var eid = trim(row && (row.encounterId || row.encounterID)).toLowerCase();
      var sk = trim(row && (row.sourceVisitKey || row.rowKey)).toLowerCase();
      if (eid) accepted['enc|' + eid] = 1;
      if (sk) accepted['src|' + sk] = 1;
    });
    var before = p.visits.length;
    p.visits = p.visits.filter(function (v) {
      if (!_remoteVisit(v) || v.identityVerified !== true || trim(v.identityBinding) !== trim(patientId)) return true;
      var eid = trim(v.encounterId || v.encounterID).toLowerCase();
      var sk = trim(v.sourceVisitKey || v.rowKey).toLowerCase();
      return !!((eid && accepted['enc|' + eid]) || (sk && accepted['src|' + sk]));
    });
    var removed = before - p.visits.length;
    if (removed) _upsert(p);
    return { removed: removed, kept: p.visits.length };
  }

  function ingestChart(patient, chart, source, opts) {
    if (!patient || !chart) return [];
    var p = (typeof patient === 'string') ? _findPatient(patient) : patient;
    if (!p) return [];
    if (!Array.isArray(p.visits)) p.visits = [];
    var added = [];
    var src = source || 'athena-copy';
    var list = [];
    if (Array.isArray(chart.visits)) list = list.concat(chart.visits);
    if (Array.isArray(chart.history) && (!chart.visits || !chart.visits.length)) list = list.concat(chart.history);
    list.forEach(function (item) {
      var v = addVisit(p.id, item, {
        source: src,
        /* Persist each normalized row through the canonical patient lookup.
           Production getPatients/findPatient may return JSON clones; mutating a
           persist:false clone and then upserting the stale caller object loses
           every visit even though reference-based tests appear to pass. */
        persist: true,
        identityVerified: !!(opts && opts.identityVerified),
        identityBinding: opts && opts.identityBinding,
        /* Parser-produced strings are encounter-index metadata, never a proven
           clinical body. Only structured full-detail rows may become usable. */
        indexOnly: typeof item === 'string'
      });
      if (v) added.push(v);
    });
    if (!added.length && trim(chart.summary)) {
      var v2 = addVisit(p.id, { type: 'Chart summary', date: '', raw: chart.summary }, {
        source: src,
        persist: true,
        identityVerified: !!(opts && opts.identityVerified),
        identityBinding: opts && opts.identityBinding
      });
      if (v2) added.push(v2);
    }
    return added;
  }

  function deriveFromLegacy(p) {
    if (!p || (Array.isArray(p.visits) && p.visits.length)) return [];
    var sum = S(p.summary); if (!sum) return [];
    var blocks = sum.split(/\n(?=Pulled from Athena )/);
    var added = [];
    blocks.forEach(function (b) {
      b = trim(b); if (!b) return;
      var dm = b.match(/Pulled from Athena\s+([\d\/\-.]+)/);
      var v = addVisit(p.id, { type: 'Imported chart', date: dm ? dm[1] : '', raw: b }, { source: 'legacy', persist: false });
      if (v) added.push(v);
    });
    if (added.length) _upsert(p);
    return added;
  }

  var SUM_SYS =
    'You are a clinical documentation summarizer for a spine / pain management / PM&R practice. ' +
    'Given the raw captured data from a SINGLE patient visit, write a COMPREHENSIVE but tight clinical summary of THAT visit. ' +
    'Do not omit anything important. Explicitly cover, when present: visit date, visit type / procedure performed, ' +
    'diagnoses with ICD-10 codes, procedures/CPT codes, medications (with changes), key exam findings, imaging, ' +
    'functional and pain scores (e.g., VAS/NRS, ODI), and the plan / follow-up. ' +
    'Use short labeled lines or compact paragraphs. Be factual; never invent codes, scores, or findings that are not in the data. ' +
    'If a field is not documented, omit it rather than guessing.';

  function _visitToPrompt(v, p) {
    var lines = [];
    if (p && p.name) lines.push('Patient: ' + p.name + (p.dob ? ' (DOB ' + p.dob + ')' : ''));
    if (v.date) lines.push('Visit date: ' + v.date);
    if (v.type) lines.push('Visit type/procedure: ' + v.type);
    if (v.cpt && v.cpt.length) lines.push('CPT (detected): ' + v.cpt.join(', '));
    if (v.icd10 && v.icd10.length) lines.push('ICD-10 (detected): ' + v.icd10.join(', '));
    lines.push('--- RAW CAPTURED VISIT DATA ---');
    lines.push(v.raw || '(no raw text captured)');
    return lines.join('\n');
  }

  function _aiCall(sys, user) {
    if (isFn(window.aiCallRaw)) return window.aiCallRaw(sys, user, null, { freeform: true });
    return Promise.reject(new Error('no-ai-transport'));
  }

  function summarizeVisit(patientId, visitId, opts) {
    opts = opts || {};
    var p = _findPatient(patientId); if (!p) return Promise.reject(new Error('no-patient'));
    var v = (p.visits || []).find(function (x) { return x.id === visitId; });
    if (!v) return Promise.reject(new Error('no-visit'));
    if (_usableVisits(p).indexOf(v) < 0) return Promise.reject(new Error('identity-unverified'));
    if (v.aiSummary && !opts.force) return Promise.resolve(v.aiSummary);
    return _aiCall(SUM_SYS, _visitToPrompt(v, p)).then(function (txt) {
      v.aiSummary = trim(txt);
      _upsert(p);
      return v.aiSummary;
    });
  }

  function ensureSummaries(patientId, onProgress) {
    var p = _findPatient(patientId); if (!p) return Promise.resolve(0);
    var todo = _usableVisits(p).filter(function (v) { return !trim(v.aiSummary); });
    var i = 0, done = 0;
    function next() {
      if (i >= todo.length) return Promise.resolve(done);
      var v = todo[i++];
      if (isFn(onProgress)) try { onProgress('Summarizing visit ' + i + ' of ' + todo.length + (v.date ? ' (' + v.date + ')' : '') + '…', i, todo.length); } catch (e) {}
      return summarizeVisit(p.id, v.id).then(function () { done++; return next(); }, function () { return next(); });
    }
    return next();
  }

  function _isAthenaVisit(v) {
    return _remoteVisit(v);
  }

  function _usableVisits(p) {
    return getVisits(p).filter(function (v) {
      /* Old/ambiguous Athena rows may remain visible for audit, but are never
         allowed to feed the profile summary, structured problem/history
         fields, or an operative-note prompt until a fresh identity-gated pull
         verifies them. Manual/MLS-authored rows remain usable. */
      return v.indexOnly !== true && (!_isAthenaVisit(v) || (v.identityVerified === true && trim(v.identityBinding) === trim(p && p.id)));
    });
  }

  function _plain(s) {
    return trim(S(s).replace(/\*\*/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' '));
  }

  function _notData(s) {
    return !s || /^(?:none|none recorded|not recorded|unknown|n\/a|na|no (?:known|prior|current)|not documented)\.?$/i.test(_plain(s));
  }

  function _sectionValues(text, labels) {
    var out = [], src = S(text).replace(/\r/g, '\n');
    var names = labels.map(function (x) { return S(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
    var re = new RegExp('(?:^|\\n)\\s*(?:[-*\\u2022]\\s*)?(?:\\*\\*)?(?:' + names + ')(?:\\*\\*)?\\s*[:\\-]\\s*([^\\n]{1,900})', 'ig');
    var m;
    while ((m = re.exec(src))) {
      var value = _plain(m[1]).replace(/^[\-\u2022]\s*/, '');
      if (!_notData(value)) out.push(value);
      if (out.length >= 40) break;
    }
    return out;
  }

  function _uniq(items) {
    var seen = {}, out = [];
    (items || []).forEach(function (x) {
      x = _plain(x); if (_notData(x)) return;
      var k = x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k || seen[k]) return;
      seen[k] = 1; out.push(x);
    });
    return out;
  }

  function _mergeText(existing, additions) {
    var base = S(existing).split(/\n+|\s*;\s*/).filter(Boolean);
    return _uniq(base.concat(additions || [])).join('\n');
  }

  function _mergeOwnedText(current, oldOwned, fresh) {
    var owned = {};
    _uniq(Array.isArray(oldOwned) ? oldOwned : S(oldOwned).split(/\n+|\s*;\s*/)).forEach(function (x) { owned[_plain(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()] = 1; });
    var manual = S(current).split(/\n+|\s*;\s*/).filter(Boolean).filter(function (x) {
      var k = _plain(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return k && !owned[k];
    });
    return _uniq(manual.concat(fresh || [])).join('\n');
  }

  function _canonicalVitals(raw) {
    raw = (raw && typeof raw === 'object') ? raw : {};
    function first(keys) { for (var i = 0; i < keys.length; i++) { var v = raw[keys[i]]; if (trim(v)) return trim(v); } return ''; }
    return {
      bp: first(['bp', 'bloodPressure', 'blood_pressure']),
      hr: first(['hr', 'heartRate', 'heart_rate', 'pulse']),
      temp: first(['temp', 'temperature']), rr: first(['rr', 'respiratoryRate', 'respiratory_rate']),
      spo2: first(['spo2', 'spO2', 'oxygenSaturation', 'oxygen_saturation']),
      heightIn: first(['heightIn', 'height_in', 'height']), weightLb: first(['weightLb', 'weight_lb', 'weight']),
      bmi: first(['bmi']), takenAt: first(['takenAt', 'taken_at', 'date', 'recordedAt'])
    };
  }

  function _vitalsFromText(text, date) {
    text = S(text); var out = _canonicalVitals({});
    function take(key, re) { var m = text.match(re); if (m && trim(m[1])) out[key] = trim(m[1]); }
    take('bp', /(?:^|\b)(?:BP|blood pressure)\s*[:=\-]?\s*(\d{2,3}\s*\/\s*\d{2,3})\b/i);
    take('hr', /(?:^|\b)(?:HR|heart rate|pulse)\s*[:=\-]?\s*(\d{2,3})\b/i);
    take('temp', /(?:^|\b)(?:temp(?:erature)?)\s*[:=\-]?\s*(\d{2,3}(?:\.\d+)?\s*°?\s*[FC]?)/i);
    take('rr', /(?:^|\b)(?:RR|resp(?:iratory)? rate)\s*[:=\-]?\s*(\d{1,2})\b/i);
    take('spo2', /(?:^|\b)(?:SpO2|oxygen saturation|O2 sat)\s*[:=\-]?\s*(\d{2,3}\s*%?)/i);
    take('heightIn', /(?:^|\b)height\s*[:=\-]?\s*(\d{2,3}(?:\.\d+)?)\s*(?:in|inches|\b)/i);
    take('weightLb', /(?:^|\b)weight\s*[:=\-]?\s*(\d{2,3}(?:\.\d+)?)\s*(?:lb|lbs|pounds|\b)/i);
    take('bmi', /(?:^|\b)BMI\s*[:=\-]?\s*(\d{1,3}(?:\.\d+)?)/i);
    if(Object.keys(out).some(function(k){return k!=='takenAt'&&!!out[k];})) out.takenAt=trim(date);
    return out;
  }

  function _mergeVitalsForPatient(p, fresh) {
    fresh = _canonicalVitals(fresh); var cur = _canonicalVitals(p && p.vitals), old = _canonicalVitals(p && p.athenaHistoryVitalsSnapshot), next = {};
    Object.keys(fresh).forEach(function (k) {
      next[k] = cur[k] && (!old[k] || cur[k] !== old[k]) ? cur[k] : fresh[k];
    });
    if (!next.bmi && Number(next.heightIn) > 0 && Number(next.weightLb) > 0) next.bmi = String(Math.round((703 * Number(next.weightLb) / (Number(next.heightIn) * Number(next.heightIn))) * 10) / 10);
    p.vitals = next; p.athenaHistoryVitalsSnapshot = fresh;
    if (!p.bmi || S(p.bmi) === S(old.bmi)) p.bmi = next.bmi || '';
    return next;
  }

  function _stripIdentityLines(text) {
    return _plain(S(text).split(/\n+/).filter(function (line) {
      return !/^\s*(?:patient|name|dob|date of birth|mrn|age|sex|gender)\s*:/i.test(_plain(line));
    }).join(' '));
  }

  function _aggregateSummary(p, visits, facts) {
    var lines = [];
    var pulled = visits.some(_isAthenaVisit);
    var when = new Date().toLocaleDateString();
    lines.push((pulled ? 'Pulled from Athena ' : 'Longitudinal summary refreshed ') + when + ' —');
    var latest = visits[0];
    var lead = latest && _stripIdentityLines(latest.aiSummary || latest.findings || latest.plan || latest.raw);
    if (lead) lines.push(lead.slice(0, 900));

    var prior = [];
    ['pmh', 'psh', 'social', 'family', 'smoking'].forEach(function (k) {
      (facts.history[k] || []).forEach(function (x) { prior.push(x); });
    });
    if (prior.length) {
      lines.push('', 'Prior history:');
      _uniq(prior).slice(0, 14).forEach(function (x) { lines.push('• ' + x.slice(0, 360)); });
    }

    if (visits.length) {
      lines.push('', 'Recent visits:');
      visits.slice(0, 12).forEach(function (v) {
        var detail = _stripIdentityLines(v.aiSummary || v.findings || v.plan || v.raw || v.type);
        if (!detail) detail = trim(v.type) || 'Visit';
        lines.push('• ' + (v.date || 'Undated') + ' — ' + detail.slice(0, 320));
      });
    }
    return lines.join('\n').slice(0, 9000);
  }

  function organizePatientHistory(patientId) {
    var p = _findPatient(patientId);
    if (!p) return { ok: false, reason: 'no-patient' };
    var all = getVisits(p), visits = _usableVisits(p);
    var excluded = all.length - visits.length;
    if (!visits.length && excluded) return { ok: false, reason: all.some(function (v) { return v && v.indexOnly === true; }) ? 'full-detail-unavailable' : 'identity-unverified', excluded: excluded };

    var facts = {
      problems: [], meds: [], allergies: [],
      history: { pmh: [], psh: [], social: [], family: [], smoking: [], immunizations: [], lmp: [], codeStatus: [], pcp: [], pharmacy: [] },
      vitals: _canonicalVitals({})
    };
    /* The structured chart snapshot is trusted only with the exact-patient
       six-card receipt created by the identity-gated chart sink. This captures
       profile-only facts that do not appear inside any encounter body. */
    var profileReceipt=p.athenaProfileCoverage, snap=p.athenaChartSnapshot;
    if(snap&&profileReceipt&&profileReceipt.complete===true&&profileReceipt.exactIdentityVerified===true&&trim(profileReceipt.patientId)===trim(p.id)){
      facts.problems=facts.problems.concat(Array.isArray(snap.problems)?snap.problems:[snap.problems]);
      facts.meds=facts.meds.concat(Array.isArray(snap.meds)?snap.meds:[snap.meds]);
      facts.allergies=facts.allergies.concat(Array.isArray(snap.allergies)?snap.allergies:[snap.allergies]);
      var sh=(snap.history&&!Array.isArray(snap.history)&&typeof snap.history==='object')?snap.history:{};
      Object.keys(facts.history).forEach(function(k){facts.history[k]=facts.history[k].concat(Array.isArray(sh[k])?sh[k]:[sh[k]]);});
      facts.vitals=_canonicalVitals(snap.vitals);
    }
    visits.slice(0, 80).forEach(function (v) {
      var text = [v.raw, v.aiSummary, v.findings, v.plan].join('\n').slice(0, 24000);
      (v.icd10 || []).forEach(function (c) { facts.problems.push('ICD-10 ' + c); });
      (v.meds || []).forEach(function (m) { facts.meds.push(m); });
      facts.problems = facts.problems.concat(_sectionValues(text, ['problem list', 'problems', 'diagnoses', 'diagnosis', 'assessment']));
      facts.meds = facts.meds.concat(_sectionValues(text, ['medications', 'medication list', 'current medications', 'meds']));
      facts.allergies = facts.allergies.concat(_sectionValues(text, ['allergies', 'allergy']));
      facts.history.pmh = facts.history.pmh.concat(_sectionValues(text, ['past medical history', 'medical history', 'pmh']));
      facts.history.psh = facts.history.psh.concat(_sectionValues(text, ['past surgical history', 'surgical history', 'psh']));
      facts.history.social = facts.history.social.concat(_sectionValues(text, ['social history', 'social']));
      facts.history.family = facts.history.family.concat(_sectionValues(text, ['family history', 'family']));
      facts.history.smoking = facts.history.smoking.concat(_sectionValues(text, ['smoking status', 'tobacco use', 'smoking']));
      facts.history.immunizations = facts.history.immunizations.concat(_sectionValues(text, ['immunizations', 'immunization history', 'vaccines']));
      facts.history.lmp = facts.history.lmp.concat(_sectionValues(text, ['lmp', 'last menstrual period', 'pregnancy status']));
      facts.history.codeStatus = facts.history.codeStatus.concat(_sectionValues(text, ['code status']));
      facts.history.pcp = facts.history.pcp.concat(_sectionValues(text, ['primary care provider', 'pcp', 'referring provider']));
      facts.history.pharmacy = facts.history.pharmacy.concat(_sectionValues(text, ['preferred pharmacy', 'pharmacy']));
      var vv=_vitalsFromText(text,v.date); Object.keys(facts.vitals).forEach(function(k){if(!facts.vitals[k]&&vv[k])facts.vitals[k]=vv[k];});
    });
    facts.problems = _uniq(facts.problems);
    facts.meds = _uniq(facts.meds);
    facts.allergies = _uniq(facts.allergies);
    Object.keys(facts.history).forEach(function (k) { facts.history[k] = _uniq(facts.history[k]); });

    var oldFacts=(p.athenaHistoryFactsSnapshot&&typeof p.athenaHistoryFactsSnapshot==='object')?p.athenaHistoryFactsSnapshot:{};
    p.problems = _mergeOwnedText(p.problems, oldFacts.problems, facts.problems);
    p.meds = _mergeOwnedText(p.meds, oldFacts.meds, facts.meds);
    p.allergies = _mergeOwnedText(p.allergies, oldFacts.allergies, facts.allergies);
    p.history = (p.history && !Array.isArray(p.history) && typeof p.history === 'object') ? p.history : {};
    var oldHistory=(oldFacts.history&&!Array.isArray(oldFacts.history)&&typeof oldFacts.history==='object')?oldFacts.history:{};
    Object.keys(facts.history).forEach(function (k) { p.history[k] = _mergeOwnedText(p.history[k], oldHistory[k], facts.history[k]); });
    _mergeVitalsForPatient(p,facts.vitals);
    p.athenaHistorySummary = _aggregateSummary(p, visits, facts);
    /* Preserve a clinician-authored free-text summary. Only fill/refresh the
       legacy summary slot when it is empty or clearly owned by this importer. */
    if (!trim(p.summary) || /^(?:Pulled from Athena|Longitudinal summary refreshed)\b/i.test(trim(p.summary))) {
      p.summary = p.athenaHistorySummary;
    }
    p.athenaHistoryFactsSnapshot={
      problems:facts.problems.slice(), meds:facts.meds.slice(), allergies:facts.allergies.slice(),
      history:Object.keys(facts.history).reduce(function(out,k){out[k]=facts.history[k].slice();return out;},{}),
      vitals:_canonicalVitals(facts.vitals)
    };
    /* Verified encounter detail can legitimately populate a profile card that the
       chart shell classified as not_documented. Reconcile only exact-patient,
       verified Athena facts; manual text alone can never upgrade the receipt. */
    if(profileReceipt&&profileReceipt.complete===true&&profileReceipt.exactIdentityVerified===true&&trim(profileReceipt.patientId)===trim(p.id)){
      var cards=Object.assign({},profileReceipt.cards||{});
      var markFound=function(key,present){if(!present)return;cards[key]=Object.assign({},cards[key]||{},{status:'found',populated:true});};
      markFound('problems',facts.problems.length>0);
      markFound('meds',facts.meds.length>0);
      markFound('allergies',facts.allergies.length>0);
      markFound('history',Object.keys(facts.history).some(function(k){return facts.history[k].length>0;}));
      markFound('vitals',Object.keys(facts.vitals).some(function(k){return k!=='takenAt'&&!!trim(facts.vitals[k]);}));
      markFound('summary',visits.length>0);
      p.athenaProfileCoverage=Object.assign({},profileReceipt,{cards:cards});
    }
    p.historyImportReceipt = {
      verifiedVisits: visits.length,
      excludedUnverified: excluded,
      organizedAt: new Date().toISOString()
    };
    _upsert(p);
    return {
      ok: true,
      verifiedVisits: visits.length,
      excludedUnverified: excluded,
      problems: facts.problems.length,
      meds: facts.meds.length,
      allergies: facts.allergies.length,
      history: Object.keys(facts.history).reduce(function(n,k){return n+facts.history[k].length;},0),
      vitals: Object.keys(facts.vitals).filter(function(k){return !!facts.vitals[k];}).length
    };
  }

  function summarizeAll(patientId, onProgress) {
    return ensureSummaries(patientId, onProgress).then(function (summarized) {
      if (isFn(onProgress)) onProgress('Organizing verified history into the patient profile…');
      var receipt = organizePatientHistory(patientId);
      receipt.summarized = summarized;
      return receipt;
    });
  }

  window.__mlsVisitModel = {
    getVisits: getVisits,
    addVisit: addVisit,
    reconcileVerifiedAthenaVisits: reconcileVerifiedAthenaVisits,
    ingestChart: ingestChart,
    deriveFromLegacy: deriveFromLegacy,
    summarizeVisit: summarizeVisit,
    ensureSummaries: ensureSummaries,
    summarizeAll: summarizeAll,
    organizePatientHistory: organizePatientHistory,
    usableVisits: _usableVisits,
    _normVisit: _normVisit,
    _visitKey: _visitKey,
    _normDob: _normDob,
    _svcToYMD: _svcToYMD,
    _cpt: _cpt,
    _icd10: _icd10,
    _SUM_SYS: SUM_SYS,
    _visitToPrompt: _visitToPrompt,
    _sectionValues: _sectionValues,
    _aggregateSummary: _aggregateSummary
  };
})();

/* ----------------------------------------------------------------------------
 * 2) PER-VISIT PROFILE UI — window.__mlsVisitUI  (Feature 2)
 *    Renders a visit-by-visit history into #profileCard. Each visit is a
 *    collapsible card: AI summary header, expandable to full captured data.
 *    Progressive enhancement only; ScribeFlow.html is not modified.
 * --------------------------------------------------------------------------*/
(function () {
  'use strict';
  if (window.__mlsVisitUI) return;
  var M = function () { return window.__mlsVisitModel; };
  var isFn = function (f) { return typeof f === 'function'; };
  var S = function (x) { return (x == null ? '' : String(x)); };

  function esc(s) { return S(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function css() {
    if (document.getElementById('mlsVisitCss')) return;
    var st = document.createElement('style'); st.id = 'mlsVisitCss';
    st.textContent =
      '#mlsVisitHistory{margin-top:14px}' +
      '#mlsVisitHistory .mlsvh-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px}' +
      '#mlsVisitHistory .mlsvh-title{font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px}' +
      '#mlsVisitHistory .mlsvh-count{font-weight:500;opacity:.6;font-size:12px}' +
      '#mlsVisitHistory .mlsvh-btn{cursor:pointer;border:1px solid var(--line,#d8dee9);background:var(--card,#fff);border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;color:inherit}' +
      '#mlsVisitHistory .mlsvh-btn:hover{background:var(--hover,#f2f5fb)}' +
      '#mlsVisitHistory .mlsvh-btn[disabled]{opacity:.5;cursor:default}' +
      '#mlsVisitHistory .mlsvh-empty{opacity:.6;font-size:13px;padding:10px 2px}' +
      '#mlsVisitHistory .mlsvh-v{border:1px solid var(--line,#e2e8f0);border-radius:10px;margin:0 0 8px;overflow:hidden;background:var(--card,#fff)}' +
      '#mlsVisitHistory .mlsvh-vh{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer}' +
      '#mlsVisitHistory .mlsvh-vh:hover{background:var(--hover,#f6f9ff)}' +
      '#mlsVisitHistory .mlsvh-date{font-weight:700;font-size:13px;min-width:96px}' +
      '#mlsVisitHistory .mlsvh-type{font-size:12.5px;opacity:.85;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#mlsVisitHistory .mlsvh-pill{font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 7px;background:#eef2ff;color:#2E6A4B;white-space:nowrap}' +
      '#mlsVisitHistory .mlsvh-pill.cpt{background:#e8f5e9;color:#2e7d32}' +
      '#mlsVisitHistory .mlsvh-chev{opacity:.5;font-size:12px;transition:transform .15s}' +
      '#mlsVisitHistory .mlsvh-v.open .mlsvh-chev{transform:rotate(90deg)}' +
      '#mlsVisitHistory .mlsvh-body{display:none;padding:2px 12px 12px;border-top:1px solid var(--line,#eef1f6);font-size:13px;line-height:1.5}' +
      '#mlsVisitHistory .mlsvh-v.open .mlsvh-body{display:block}' +
      '#mlsVisitHistory .mlsvh-sum{white-space:pre-wrap;margin:8px 0}' +
      '#mlsVisitHistory .mlsvh-fields{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}' +
      '#mlsVisitHistory .mlsvh-raw{margin-top:8px}' +
      '#mlsVisitHistory .mlsvh-raw>summary{cursor:pointer;font-size:12px;font-weight:600;opacity:.75}' +
      '#mlsVisitHistory .mlsvh-raw pre{white-space:pre-wrap;font-size:12px;background:var(--bg2,#FCFBF8);border-radius:8px;padding:10px;max-height:340px;overflow:auto;margin:6px 0 0}' +
      '#mlsVisitHistory .mlsvh-status{font-size:12px;opacity:.7;margin:0 0 6px}';
    (document.head || document.documentElement).appendChild(st);
  }

  function host() {
    var card = document.getElementById('profileCard');
    if (!card || card.offsetParent === null) return null; // not visible
    return card;
  }
  function activeP() { try { return isFn(window.activePatient) ? window.activePatient() : null; } catch (e) { return null; } }

  function codePills(v) {
    var frag = document.createDocumentFragment();
    (v.cpt || []).slice(0, 4).forEach(function (c) { var s = document.createElement('span'); s.className = 'mlsvh-pill cpt'; s.textContent = c; frag.appendChild(s); });
    (v.icd10 || []).slice(0, 3).forEach(function (c) { var s = document.createElement('span'); s.className = 'mlsvh-pill'; s.textContent = c; frag.appendChild(s); });
    return frag;
  }

  function fieldChip(label, val) {
    if (!val || (Array.isArray(val) && !val.length)) return null;
    var s = document.createElement('span'); s.className = 'mlsvh-pill';
    s.style.background = '#f1f5f9'; s.style.color = '#334155';
    s.textContent = label + ': ' + (Array.isArray(val) ? val.join(', ') : S(val));
    return s;
  }

  function visitCard(p, v) {
    var card = document.createElement('div'); card.className = 'mlsvh-v'; card.dataset.vid = v.id;
    var head = document.createElement('div'); head.className = 'mlsvh-vh';
    var date = document.createElement('span'); date.className = 'mlsvh-date'; date.textContent = v.date || '(undated)';
    var type = document.createElement('span'); type.className = 'mlsvh-type'; type.textContent = v.type || (v.aiSummary ? v.aiSummary.split('\n')[0].slice(0, 80) : 'Visit');
    head.appendChild(date); head.appendChild(type);
    head.appendChild(codePills(v));
    var chev = document.createElement('span'); chev.className = 'mlsvh-chev'; chev.textContent = '▶'; head.appendChild(chev);
    head.addEventListener('click', function () { card.classList.toggle('open'); });
    card.appendChild(head);

    var body = document.createElement('div'); body.className = 'mlsvh-body';
    var sum = document.createElement('div'); sum.className = 'mlsvh-sum';
    sum.textContent = v.aiSummary || '';
    body.appendChild(sum);

    if (!v.aiSummary) {
      var gen = document.createElement('button'); gen.className = 'mlsvh-btn'; gen.textContent = '✨ Generate AI summary';
      gen.addEventListener('click', function (e) {
        e.stopPropagation(); gen.disabled = true; gen.textContent = 'Generating…';
        M().summarizeVisit(p.id, v.id, { force: true }).then(function (txt) { sum.textContent = txt; gen.remove(); }, function (err) {
          gen.disabled = false; gen.textContent = '✨ Generate AI summary';
          sum.textContent = 'Could not generate summary (' + (err && err.message || 'error') + ').';
        });
      });
      body.appendChild(gen);
    }

    var fields = document.createElement('div'); fields.className = 'mlsvh-fields';
    [['CPT', v.cpt], ['ICD-10', v.icd10], ['Meds', v.meds],
     ['Findings', v.findings], ['Plan', v.plan]].forEach(function (pair) {
      var c = fieldChip(pair[0], pair[1]); if (c) fields.appendChild(c);
    });
    if (v.scores && Object.keys(v.scores).length) {
      var sc = fieldChip('Scores', Object.keys(v.scores).map(function (k) { return k + '=' + v.scores[k]; })); if (sc) fields.appendChild(sc);
    }
    if (fields.childNodes.length) body.appendChild(fields);

    if (v.raw) {
      var det = document.createElement('details'); det.className = 'mlsvh-raw';
      var sm = document.createElement('summary'); sm.textContent = 'Full captured visit data'; det.appendChild(sm);
      var pre = document.createElement('pre'); pre.textContent = v.raw; det.appendChild(pre);
      body.appendChild(det);
    }
    card.appendChild(body);
    return card;
  }

  var _lastSig = '';
  function render(force) {
    var card = host(); if (!card) { _lastSig = ''; return; }
    var p = activeP(); if (!p) { var ex = document.getElementById('mlsVisitHistory'); if (ex) ex.remove(); _lastSig = ''; return; }
    try { M().deriveFromLegacy(p); } catch (e) {}
    var visits = M().getVisits(p);
    var sig = p.id + ':' + visits.length + ':' + visits.map(function (v) { return v.id + (v.aiSummary ? '1' : '0'); }).join(',');
    if (!force && sig === _lastSig && document.getElementById('mlsVisitHistory')) return;
    _lastSig = sig;
    css();

    var sec = document.getElementById('mlsVisitHistory');
    if (!sec) { sec = document.createElement('div'); sec.id = 'mlsVisitHistory'; }
    sec.innerHTML = '';

    var head = document.createElement('div'); head.className = 'mlsvh-head';
    var title = document.createElement('div'); title.className = 'mlsvh-title';
    title.innerHTML = '🗂 Visit history <span class="mlsvh-count">' + visits.length + ' visit' + (visits.length === 1 ? '' : 's') + '</span>';
    head.appendChild(title);
    var missing = visits.filter(function (v) { return !v.aiSummary; }).length;
    if (missing) {
      var all = document.createElement('button'); all.className = 'mlsvh-btn'; all.textContent = '✨ Summarize all (' + missing + ')';
      all.addEventListener('click', function () {
        all.disabled = true;
        var st = sec.querySelector('.mlsvh-status') || (function () { var d = document.createElement('div'); d.className = 'mlsvh-status'; head.after(d); return d; })();
        M().ensureSummaries(p.id, function (msg) { st.textContent = msg; }).then(function () { st.textContent = 'Summaries complete.'; render(true); });
      });
      head.appendChild(all);
    }
    sec.appendChild(head);

    if (!visits.length) {
      var em = document.createElement('div'); em.className = 'mlsvh-empty';
      em.textContent = 'No visits captured yet. Open this patient in athenaOne and use “📋 Copy every visit”.';
      sec.appendChild(em);
    } else {
      visits.forEach(function (v) { sec.appendChild(visitCard(p, v)); });
    }

    if (!sec.parentNode) {
      var anchor = document.getElementById('profAtGlance');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor.nextSibling);
      else card.appendChild(sec);
    }
  }

  function start() {
    css();
    setInterval(function () { try { render(false); } catch (e) {} }, 900);
    try { render(false); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.__mlsVisitUI = { render: render, _visitCard: visitCard };
})();

/* ----------------------------------------------------------------------------
 * 3) COPY EVERY VISIT — window.__mlsCopyVisits  (Feature 1)
 *    One button on an OPEN patient. Drives athenaOne via MLS Assist (DOM path,
 *    no Athena API) to pull the patient summary + EVERY visit + everything per
 *    visit, verifies name+DOB, and saves into the visit-aware model with live,
 *    event-driven progress. Read-only in Athena; never Save/Sign.
 *    Bridge: posts mlsAppReadAllVisits -> streams mlsAppVisitsProgress ->
 *    resolves mlsAppAllVisitsResult. Falls back to mlsAppReadChart on older ext.
 * --------------------------------------------------------------------------*/
(function () {
  'use strict';
  if (window.__mlsCopyVisits) return;
  var isFn = function (f) { return typeof f === 'function'; };
  var S = function (x) { return (x == null ? '' : String(x)); };
  var M = function () { return window.__mlsVisitModel; };

  function activeP() { try { return isFn(window.activePatient) ? window.activePatient() : null; } catch (e) { return null; } }
  function norm(s) { return S(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  // strict name + DOB verify — never save on a name-only match or a DOB mismatch
  function verifyIdentity(p, identity) {
    identity = identity || {};
    var mod = M();
    var d1 = mod ? mod._normDob(p && p.dob) : '', d2 = mod ? mod._normDob(identity.dob) : '';
    var n1 = norm(p && p.name), n2 = norm(identity.name);
    var t1 = n1.split(' ').filter(Boolean), t2 = n2.split(' ').filter(Boolean);
    var overlap = t1.filter(function (x) { return t2.indexOf(x) >= 0 && x.length > 1; }).length;
    var nameHit = !!(n1 && n2 && (n1 === n2 || n1.indexOf(n2) >= 0 || n2.indexOf(n1) >= 0 || overlap >= 2));
    var dobPresent = !!(d1 && d2), dobEqual = dobPresent && d1 === d2;
    // b84: the extension's identity phase can return an athenaOne HEADER LABEL (e.g.
    // "Care Team", "Provider", "Pharmacy") in place of the patient name — a mis-extraction,
    // NOT a different patient. When the DOB matches EXACTLY and the chart "name" is a known
    // non-patient label (or empty), accept. A real, different person's name still blocks
    // (nameHit stays false and a real name is not in the label list) — wrong-patient guard intact.
    var NONPT = /^(care\s*team|provider|pharmacy|insurance|contact|global\s*period|aip\s*enrolled|appointments?|primary|referring|guarantor|billing|care|team|next|home)$/;
    var nameIsLabel = (!n2) || NONPT.test(n2);
    var okStrict = nameHit && dobEqual;
    var okDobLabel = dobEqual && dobPresent && nameIsLabel;
    return { ok: !!(okStrict || okDobLabel), nameHit: nameHit, dobPresent: dobPresent, dobEqual: dobEqual, chartName: identity.name, chartDob: identity.dob, via: (okStrict ? 'name+dob' : (okDobLabel ? 'dob+label' : 'none')) };
  }

  function explicitVisitIdentity(raw) {
    var v = (raw && typeof raw === 'object') ? raw : {};
    var text = S(typeof raw === 'string' ? raw : (v.raw || v.text || v.note || v.detail || v.textHead || v.summary || ''));
    var nm = text.match(/(?:^|\n|\|)\s*(?:\*\*)?(?:patient name|patient|name)(?:\*\*)?\s*:\s*(?:\*\*)?\s*([^\n|\u00b7]{2,100}?)(?=\s*(?:\||\u00b7)?\s*(?:\*\*)?(?:dob|date of birth|birth date)(?:\*\*)?\s*:?|\s*$)/i);
    var db = text.match(/(?:^|\n|\||\u00b7)\s*(?:\*\*)?(?:dob|date of birth|birth date)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})/i);
    return {
      name: S(v.patientName || v.patient || (nm && nm[1]) || '').replace(/\*+/g, '').trim(),
      dob: S(v.patientDob || v.birthDate || v.dob || (db && db[1]) || '').replace(/\*+/g, '').trim()
    };
  }

  function visitIdentityAgrees(p, raw, requireExplicit) {
    var x = explicitVisitIdentity(raw);
    if (!x.name && !x.dob) return requireExplicit ? false : true;
    var pDob = M() ? M()._normDob(p && p.dob) : '', xDob = M() ? M()._normDob(x.dob) : '';
    if (xDob && (!pDob || xDob !== pDob)) return false;
    if (x.name) {
      var a = norm(p && p.name), b = norm(x.name);
      var aa = a.split(' ').filter(function (z) { return z.length > 1; });
      var bb = b.split(' ').filter(function (z) { return z.length > 1; });
      var overlap = aa.filter(function (z) { return bb.indexOf(z) >= 0; }).length;
      if (!(a === b || overlap >= 2)) return false;
    }
    return true;
  }

  // ---- extension bridge helpers ----------------------------------------------
  function ping(timeout) {
    return new Promise(function (resolve) {
      var done = false;
      function on(ev) { if (ev.data && (ev.data.type === 'mlsPong')) { if (done) return; done = true; window.removeEventListener('message', on); resolve(true); } }
      window.addEventListener('message', on);
      try { window.postMessage({ type: 'mlsPing', source: 'mls-app', from: 'mls-app' }, '*'); } catch (e) {}
      setTimeout(function () { if (done) return; done = true; window.removeEventListener('message', on); resolve(false); }, timeout || 1500);
    });
  }

  // post a request, stream progress to onStatus, resolve on the result type.
  // engagedTypes mark the extension as "handling" so we don't fall back.
  function driveRequest(reqType, payload, resultType, progressTypes, onStatus, onEngaged, timeout, engageTimeout) {
    return new Promise(function (resolve, reject) {
      var done = false, engaged = false, longTid = null, engTid = null;
      function clearTimers() { if (engTid) clearTimeout(engTid); if (longTid) clearTimeout(longTid); }
      function fin(fn, arg) { if (done) return; done = true; window.removeEventListener('message', on); clearTimers(); fn(arg); }
      function markEngaged() {
        if (engaged) return; engaged = true;
        if (engTid) { clearTimeout(engTid); engTid = null; }
        longTid = setTimeout(function () { fin(reject, new Error('timeout')); }, timeout || 240000);
        if (onEngaged) onEngaged();
      }
      function on(ev) {
        var d = ev.data; if (!d || !d.type) return;
        if (progressTypes.indexOf(d.type) >= 0) { markEngaged(); if (onStatus) try { onStatus(d.message || d.status || d.text || '', d); } catch (e) {} return; }
        if (d.type === resultType) {
          markEngaged();
          if (d.ok === false || d.error) fin(reject, new Error(d.error || d.message || 'extension error'));
          else fin(resolve, d);
        }
      }
      window.addEventListener('message', on);
      try { window.postMessage(Object.assign({ type: reqType, source: 'mls-app', from: 'mls-app' }, payload || {}), '*'); } catch (e) {}
      engTid = setTimeout(function () { if (!engaged) fin(reject, new Error('no-ext')); }, engageTimeout || 6000);
    });
  }

  // ---- save a returned visit batch into the model, with live progress --------
  function saveVisits(p, identity, visits, onStatus, batchReceipt) {
    var v = verifyIdentity(p, identity || {});
    if (!v.ok) {
      var why = !v.nameHit ? 'name did not match' : (!v.dobPresent ? 'no DOB to verify on both sides' : 'DOB mismatch');
      throw new Error('Safety stop — ' + why + '. Nothing saved. (chart: ' + S(v.chartName) + ' / ' + S(v.chartDob) + ')');
    }
    var arr = Array.isArray(visits) ? visits : [];
    var fullBatch = !!(batchReceipt && batchReceipt.complete === true && batchReceipt.indexComplete === true && batchReceipt.bodyComplete === true && batchReceipt.fullDetail === true && Number(batchReceipt.parsed) === Number(batchReceipt.expected));
    if (arr.some(function (raw) { return !visitIdentityAgrees(p, raw, fullBatch); })) {
      throw new Error('Safety stop — at least one returned visit identifies a different patient. Nothing from this batch was saved. Re-open the correct chart and pull again.');
    }
    var saved = 0;
    arr.forEach(function (raw, i) {
      var stored = M().addVisit(p.id, raw, {
        source: 'athena-copy',
        identityVerified: true,
        identityBinding: S(p.id),
        bodyComplete: fullBatch
      });
      if (stored) { saved++; if (onStatus) try { onStatus('Saved visit ' + (stored.date || (i + 1)) + ' (' + (i + 1) + ' of ' + arr.length + ')…'); } catch (e) {} }
    });
    if (fullBatch && isFn(M().reconcileVerifiedAthenaVisits)) M().reconcileVerifiedAthenaVisits(p.id, arr);
    return saved;
  }

  // ---- main flow -------------------------------------------------------------
  var running = false;
  function run(onStatus, patientOverride) {
    if (running) return Promise.resolve();
    var p = patientOverride || activeP();
    if (!p) { onStatus && onStatus('Open a patient first.'); return Promise.resolve(); }
    running = true;
    var engaged = false;
    var st = function (m) { try { onStatus && onStatus(m); } catch (e) {} };
    st('Connecting to MLS Assist…');
    return ping(1800).then(function (ok) {
      if (!ok) throw new Error('MLS Assist isn’t responding. If it’s installed, reload it at chrome://extensions (or get the latest from MLS Settings → Get the extension). If it isn’t installed yet, install it there, then try again.');
      st('Reading every visit from athenaOne… (read-only)');
      return driveRequest(
        'mlsAppReadAllVisits',
        { hint: { name: p.name, dob: p.dob, mrn: p.mrn || p.athenaId || p.athenaPatientId || '' } },
        'mlsAppAllVisitsResult',
        ['mlsAppVisitsProgress', 'mlsAppSearchProgress'],
        function (msg) { if (msg) st(msg); },
        function () { engaged = true; },
        240000, 6000
      ).catch(function (err) {
        // older extension (no all-visits handler): fall back to single-chart read
        if (engaged) throw err;
        st('Reading the open chart… (basic capture)');
        return driveRequest(
          'mlsAppReadChart', {},
          'mlsAppChartResult',
          ['mlsAppChartProgress'],
          function (msg) { if (msg) st(msg); },
          function () { engaged = true; },
          120000, 6000
        ).then(function (d) {
          var chart = d.chart || d.result || d;
          return { identity: { name: chart.name || p.name, dob: chart.dob }, visits: (chart.visits || chart.history || []), _fallback: true, _chart: chart };
        });
      });
    }).then(function (res) {
      var identity = res.identity || { name: res.name, dob: res.dob };
      var visits = res.visits || [];
      if (res._fallback && (!visits || !visits.length) && res._chart) {
        /* IDENTITY GUARD (2026-07-06): never ingest an open chart that
           belongs to someone else. Verify any identity the chart declares
           (name / DOB / leading "<Name> is a patient" in the summary). */
        var cnm = (res._chart.name || res._chart.patientName || (S(res._chart.summary).match(/^\s*([A-Z][A-Za-z'-]+(?: [A-Z][A-Za-z'.-]+){1,3}) is a patient/) || [])[1] || '');
        var cvv = verifyIdentity(p, { name: cnm || p.name, dob: res._chart.dob });
        if (!cvv.ok) {
          throw new Error('Safety stop — the open athenaOne chart is ' + (cnm || 'a different patient') + ', not ' + S(p.name) + '. Nothing saved. Open the correct patient in athenaOne and try again.');
        }
        // ingest the identity-checked single chart
        var added = M().ingestChart(p, res._chart, 'athena-copy', {
          identityVerified: true,
          identityBinding: S(p.id),
          chartIndexOnly: true
        });
        st('Captured the open chart (' + added.length + ' entr' + (added.length === 1 ? 'y' : 'ies') + '). For a full per-visit pull, update MLS Assist.');
        return ensureAndDone(p, st, true);
      }
      if (!res._fallback && !(res.receipt && res.receipt.complete === true && res.receipt.indexComplete === true && res.receipt.bodyComplete === true && res.receipt.fullDetail === true && Number(res.receipt.parsed) === Number(res.receipt.expected))) {
        throw new Error('Safety stop — Athena returned an encounter index without verified full detail for every row. Nothing was saved as complete history.');
      }
      var saved = saveVisits(p, identity, visits, st, res.receipt || null);
      st('Saved ' + saved + ' visit' + (saved === 1 ? '' : 's') + '. Generating AI summaries…');
      return ensureAndDone(p, st, false);
    }).then(function (r) { running = false; return r; }, function (err) {
      running = false; st('⚠ ' + (err && err.message || 'Failed.')); throw err;
    });
  }

  function ensureAndDone(p, st, fallback) {
    var summarize = isFn(M().summarizeAll) ? M().summarizeAll : M().ensureSummaries;
    return summarize.call(M(), p.id, function (msg) { st(msg); }).then(function (receipt) {
      try { window.__mlsVisitUI && window.__mlsVisitUI.render(true); } catch (e) {}
      try { if (isFn(window.renderProfile)) window.renderProfile(); } catch (e) {}
      /* addVisit persists through a freshly-fetched patient clone. Re-read that
         record instead of reporting against the stale pre-pull object. */
      var fresh = null;
      try { if (isFn(window.findPatient)) fresh = window.findPatient(p.id); } catch (e) {}
      if (!fresh) {
        try { fresh = ((isFn(window.getPatients) ? window.getPatients() : []) || []).find(function (x) { return x && x.id === p.id; }) || null; } catch (e) {}
      }
      var n = M().getVisits(fresh || p).length;
      var excluded = receipt && receipt.excludedUnverified ? (' ' + receipt.excludedUnverified + ' older unverified row(s) were kept out of the clinical summary.') : '';
      st('✓ Done — ' + n + ' visit' + (n === 1 ? '' : 's') + ' on file; verified history is summarized and organized into the patient profile.' + excluded + (fallback ? ' (basic capture)' : ''));
      return n;
    });
  }

  // ---- button + status injection (shows when a patient is open) --------------
  function ensureBar() {
    var card = document.getElementById('profileCard');
    if (!card || card.offsetParent === null) return;
    if (!activeP()) { var ex = document.getElementById('mlsCopyVisitsBar'); if (ex) ex.remove(); return; }
    if (document.getElementById('mlsCopyVisitsBar')) return;
    if (!document.getElementById('mlsCvCss')) {
      var s = document.createElement('style'); s.id = 'mlsCvCss';
      s.textContent =
        '#mlsCopyVisitsBar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 4px}' +
        '#mlsCopyVisitsBar .mls-cv-btn{cursor:pointer;border:0;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(135deg,#2E6A4B,#7A5CC0)}' +
        '#mlsCopyVisitsBar .mls-cv-btn:hover{filter:brightness(1.06)}' +
        '#mlsCopyVisitsBar .mls-cv-btn[disabled]{opacity:.6;cursor:default}' +
        '#mlsCopyVisitsBar .mls-cv-status{font-size:12.5px;opacity:.8;flex:1;min-width:160px}';
      (document.head || document.documentElement).appendChild(s);
    }
    var bar = document.createElement('div'); bar.id = 'mlsCopyVisitsBar';
    var btn = document.createElement('button'); btn.className = 'mls-cv-btn';
    btn.textContent = '📋 Copy every visit from athenaOne';
    var status = document.createElement('span'); status.className = 'mls-cv-status';
    btn.addEventListener('click', function () {
      btn.disabled = true;
      run(function (m) { status.textContent = m; }).then(function () { btn.disabled = false; }, function () { btn.disabled = false; });
    });
    bar.appendChild(btn); bar.appendChild(status);
    var anchor = document.getElementById('profAtGlance') || document.getElementById('profDemo') || document.getElementById('profName');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor.nextSibling); else card.appendChild(bar);
  }

  function start() { setInterval(function () { try { ensureBar(); } catch (e) {} }, 900); try { ensureBar(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.__mlsCopyVisits = {
    run: run,
    _verifyIdentity: verifyIdentity,
    _explicitVisitIdentity: explicitVisitIdentity,
    _visitIdentityAgrees: visitIdentityAgrees,
    _saveVisits: saveVisits,
    _ping: ping,
    _driveRequest: driveRequest
  };
})();

/* ----------------------------------------------------------------------------
 * 4) WIRE THE GRAB + ALL CHART IMPORTS INTO THE SAME MODEL — window.__mlsVisitWire
 *    Thin, reversible wrapper around the app's _savePatientChart (used by the
 *    just-shipped injection/procedure grab and bulk imports). After the original
 *    runs, the captured chart's visits are ALSO ingested as structured per-visit
 *    records, so grabbed patients carry full visit history in the SAME model.
 *    Removing this block restores the original behavior exactly.
 * --------------------------------------------------------------------------*/
(function () {
  'use strict';
  if (window.__mlsVisitWire) return;
  var isFn = function (f) { return typeof f === 'function'; };
  function tryWrap() {
    if (!isFn(window._savePatientChart)) return false;
    if (window._savePatientChart.__mlsWrapped) return true;
    var orig = window._savePatientChart;
    var norm2 = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };
    var chartIdent = function (chart) {
      var nm = (chart && (chart.name || chart.patientName || chart.patient)) || '';
      if (!nm && chart && chart.summary) { var m = String(chart.summary).match(/^\s*([A-Z][A-Za-z'-]+(?: [A-Z][A-Za-z'.-]+){1,3}) is a patient/); if (m) nm = m[1]; }
      return { name: nm, dob: (chart && chart.dob) || '' };
    };
    var namesMatch = function (a, b) {
      if (!a || !b) return true; /* nothing to compare -> cannot veto */
      var ta = norm2(a).split(' ').filter(function (x) { return x.length > 1; });
      var tb = norm2(b).split(' ').filter(function (x) { return x.length > 1; });
      var overlap = ta.filter(function (x) { return tb.indexOf(x) >= 0; }).length;
      return overlap >= 2 || (overlap >= 1 && Math.min(ta.length, tb.length) === 1);
    };
    var wrapped = function (name, appt, chart) {
      var targetName = String((name && typeof name === 'object' && name.name) || '');
      var targetId = String((name && typeof name === 'object' && (name.patientId || name.id)) ||
        (appt && (appt._mlsTargetPatientId || appt.patientId)) || '');
      /* IDENTITY GUARD (2026-07-06): a schedule/bulk import once fed ONE open
         chart to EVERY appointment name, filing the same patient's data into
         62 charts. If the chart declares an identity that does not match the
         target name, BLOCK the whole save for that patient. */
      try {
        var cid = chartIdent(chart);
        if (chart && cid.name && (!targetName || !namesMatch(cid.name, targetName))) {
          console.warn('[mls-visit-wire] BLOCKED cross-patient chart write: chart belongs to "' + cid.name + '" but target is "' + targetName + '". Nothing saved for this patient.');
          try { window.__mlsVisitWire._blocked = (window.__mlsVisitWire._blocked || 0) + 1; window.__mlsVisitWire._lastBlocked = { chart: cid.name, target: targetName, at: new Date().toISOString() }; } catch (e) {}
          return false; /* the wrong chart must never touch this patient */
        }
      } catch (e) {}
      var r = orig.apply(this, arguments);
      if (r !== true) return r;
      try {
        if (targetId && chart && window.__mlsVisitModel) {
          var pts = isFn(window.getPatients) ? (window.getPatients() || []) : [];
          var p = pts.find(function (x) { return String(x && x.id || '') === targetId; });
          if (p) {
            var cid2 = chartIdent(chart);
            var nd = window.__mlsVisitModel._normDob;
            var targetDob = String((name && typeof name === 'object' && name.dob) || (appt && appt.dob) || p.dob || '');
            var dobOk = !!(cid2.dob && targetDob && nd(cid2.dob) && nd(cid2.dob) === nd(targetDob));
            var identityVerified = !!(cid2.name && targetName && namesMatch(cid2.name, targetName) && dobOk);
            window.__mlsVisitModel.ingestChart(p, chart, (appt && appt.source) || 'grab', {
              identityVerified: identityVerified,
              identityBinding: targetId,
              chartIndexOnly: true
            });
            if (identityVerified && isFn(window.__mlsVisitModel.organizePatientHistory)) {
              window.__mlsVisitModel.organizePatientHistory(p.id);
            }
          }
        }
      } catch (e) {}
      return r;
    };
    wrapped.__mlsWrapped = true;
    try { wrapped.__mlsOrig = orig; } catch (e) {}
    window._savePatientChart = wrapped;
    return true;
  }
  window.__mlsVisitWire = { tryWrap: tryWrap };
  if (!tryWrap()) { var n = 0; var iv = setInterval(function () { if (tryWrap() || ++n > 40) clearInterval(iv); }, 500); }
})();

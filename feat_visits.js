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
    /* b483: getPatients() serves the OPEN write batch first, so it is the
       freshest read during a pull. window.findPatient can return a pre-batch
       clone (live 2026-07-22: identical schedule-history index rows filed
       ~46ms apart because the second addVisit fetched a stale clone that
       lacked the first row, and the store's visit union then kept both). */
    var fromStore = _getPatients().find(function (p) { return p && p.id === id; }) || null;
    if (fromStore) return fromStore;
    try { if (isFn(window.findPatient)) return window.findPatient(id); } catch (e) {}
    return null;
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

  function _stableVisitKeys(v) {
    v = v || {};
    var out = [];
    var encounterId = trim(v.encounterId || v.encounterID || '').toLowerCase();
    var sourceVisitKey = trim(v.sourceVisitKey || v.rowKey || '').toLowerCase();
    if (encounterId) out.push('encounter|' + encounterId);
    if (sourceVisitKey) out.push('source|' + sourceVisitKey);
    return out;
  }

  function _sharesStableVisitKey(a, b) {
    var ak = _stableVisitKeys(a), bk = _stableVisitKeys(b);
    if (!ak.length || !bk.length) return false;
    for (var i = 0; i < ak.length; i++) if (bk.indexOf(ak[i]) >= 0) return true;
    return false;
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
    /* px-1.4 (2026-08-07): 'cohort' added - cohort-injection rows are
       athena-derived text and used to slip past the identity gate purely
       because their source string was not in this list. Existing unverified
       cohort rows stay visible for audit but no longer feed summaries. */
    return /athena|legacy|grab|pullrec|cohort/i.test(trim(v && v.source));
  }

  function _strictVerifiedAthenaBody(v) {
    return !!(v && _remoteVisit(v) && v.identityVerified === true && trim(v.identityBinding) &&
      v.indexOnly !== true && v.fullDetail === true && v.bodyComplete === true && trim(v.raw));
  }

  function _unverifiedChartShell(v) {
    if (!v || !_remoteVisit(v) || v.identityVerified === true) return false;
    if (v.indexOnly === true) return true;
    /* Legacy chart ingestion stored the whole chart shell as a dated synthetic
       visit before the exact encounter reader ran.  It is safe to compact only
       those unmistakable synthetic types; a substantive unverified encounter
       stays visible for audit and is never merged into trusted history. */
    return /^(?:chart summary|chart import|imported chart|athena chart(?: summary)?)$/i.test(trim(v.type));
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
      /* px-1.1 (2026-08-07): a keyless placeholder may be compacted only when
         the pairing is UNAMBIGUOUS. The old rule deleted EVERY keyless shell
         on the hydrated row's day - with two same-day encounters, one body
         landing erased the OTHER encounter's index row, so a two-visit day
         rendered as one visit. Now a keyless shell is removed only in the
         legacy 1:1 pairing (one keyless shell, one keyless hydrated row on
         the day); a hydrated row that carries a stable key cannot prove a
         keyless shell is its twin, so that shell is kept - a visible extra
         index row is recoverable, a silently merged day is not. Keyed shells
         still require the shared stable key. */
      var fullStable = _stableVisitKeys(full);
      var keylessShellsForDay = p.visits.filter(function (q) {
        return q !== full && _emptyPlaceholder(q) && _svcToYMD(q.date) === day && !_stableVisitKeys(q).length;
      }).length;
      var hydratedForDay = real.filter(function (r) { return _svcToYMD(r.date) === day; }).length;
      var keylessPairUnambiguous = !fullStable.length && keylessShellsForDay === 1 && hydratedForDay === 1;
      for (var i = p.visits.length - 1; i >= 0; i--) {
        var q = p.visits[i];
        if (q === full) continue;
        var qStable = _stableVisitKeys(q);
        var compatiblePlaceholder = _emptyPlaceholder(q) && _svcToYMD(q.date) === day && _trustCompatible(q, full) &&
          ((qStable.length && _sharesStableVisitKey(q, full)) || (!qStable.length && keylessPairUnambiguous));
        /* trust-superseding arm: LEGACY unverified chart shells (narrow
           classifier) still die on any same-day strict body - pinned by
           history-ingestion-card-hardening. Modern index shells are
           identityVerified, so multi-encounter days are protected by the
           same-trust arm above, which requires the unambiguous pairing. */
        var supersededUnverifiedShell = _strictVerifiedAthenaBody(full) && _unverifiedChartShell(q) &&
          (_sharesStableVisitKey(q, full) || (!qStable.length && !!day && _svcToYMD(q.date) === day));
        if (compatiblePlaceholder || supersededUnverifiedShell) { p.visits.splice(i, 1); changed = true; }
      }
    });
    return changed;
  }

  function _collapseVerifiedStableDuplicates(p, preferred) {
    if (!p || !Array.isArray(p.visits) || !_strictVerifiedAthenaBody(preferred) || !_stableVisitKeys(preferred).length) return false;
    var changed = false, again = true, guard = 0;
    while (again && guard++ < 4) {
      again = false;
      for (var i = p.visits.length - 1; i >= 0; i--) {
        var q = p.visits[i];
        if (q === preferred || !_strictVerifiedAthenaBody(q) || !_trustCompatible(q, preferred) || !_sharesStableVisitKey(q, preferred)) continue;
        /* The newest complete read is authoritative.  Carry only missing stable
           aliases across; never mix a stale clinical body into the fresh one. */
        if (!trim(preferred.encounterId || preferred.encounterID) && trim(q.encounterId || q.encounterID)) preferred.encounterId = trim(q.encounterId || q.encounterID);
        if (!trim(preferred.sourceVisitKey || preferred.rowKey) && trim(q.sourceVisitKey || q.rowKey)) preferred.sourceVisitKey = trim(q.sourceVisitKey || q.rowKey);
        p.visits.splice(i, 1); changed = true; again = true;
      }
    }
    return changed;
  }

  /* b483/b484: exact-clone index rows carry zero information beyond their
     best copy. Live 2026-07-21/22 pairs came from the SAME history-card row
     ingested through two trust paths ms apart (the base card save files a
     VERIFIED shell; the visit-wire post-hook re-ingests it UNVERIFIED when
     its saveRef proof gate fails) — _trustCompatible rightly refuses to merge
     across the trust boundary, so both persisted. Collapse rule, per exact
     CONTENT group (date/type/textHead/source/codes), alias-less bodyless
     indexOnly rows only:
       - verified rows present with ONE binding → drop unverified twins (the
         identical untrusted copy adds nothing; nothing is ever upgraded) and
         collapse the verified rows to the earliest;
       - verified rows with CONFLICTING bindings → fail closed, touch nothing;
       - only unverified rows → collapse to the earliest.
     NEVER touches rows with a raw body, bodyComplete/fullDetail rows, or
     rows holding a stable Athena alias. */
  function _exactIndexSig(v) {
    v = v || {};
    return [
      _svcToYMD(v.date) || trim(v.date), trim(v.type), trim(v.textHead), trim(v.source),
      (Array.isArray(v.cpt) ? v.cpt : []).join(','), (Array.isArray(v.icd10) ? v.icd10 : []).join(','),
      (Array.isArray(v.meds) ? v.meds : []).join(',')
    ].join('|');
  }
  function _collapsibleIndexRow(v) {
    return !!(v && v.indexOnly === true && !trim(v.raw) && v.bodyComplete !== true &&
      v.fullDetail !== true && !_stableVisitKeys(v).length);
  }
  function _collapseExactIndexDuplicates(p) {
    if (!p || !Array.isArray(p.visits)) return false;
    var groups = {}, sig, i, v;
    for (i = 0; i < p.visits.length; i++) {
      v = p.visits[i];
      if (!_collapsibleIndexRow(v)) continue;
      sig = _exactIndexSig(v);
      (groups[sig] = groups[sig] || []).push(v);
    }
    var drop = [];
    Object.keys(groups).forEach(function (key) {
      var rows = groups[key];
      if (rows.length < 2) return;
      var verified = rows.filter(function (r) { return r.identityVerified === true && trim(r.identityBinding); });
      var bindings = {};
      verified.forEach(function (r) { bindings[trim(r.identityBinding)] = 1; });
      if (Object.keys(bindings).length > 1) return; /* conflicting proofs: fail closed */
      var keepPool = verified.length ? verified : rows;
      var keeper = keepPool[0];
      rows.forEach(function (r) {
        if (r === keeper) return;
        if (!trim(keeper.aiSummary) && trim(r.aiSummary)) keeper.aiSummary = r.aiSummary;
        drop.push(r);
      });
    });
    if (!drop.length) return false;
    for (i = p.visits.length - 1; i >= 0; i--) {
      if (drop.indexOf(p.visits[i]) >= 0) p.visits.splice(i, 1);
    }
    return true;
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
      /* px-4.0: explicit document kind (e.g. 'opnote', 'imaging') - the
         stable hook for operative notes and future document types. Callers
         that do not classify a row leave it ''. */
      docKind: trim(v.docKind || v.documentKind || ''),
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
    /* Stable Athena aliases outrank date/type/CPT.  A row may first arrive with
       sourceVisitKey and later with encounterId plus that same source key; both
       shapes are the exact same encounter and must refresh in place. */
    var existing = p.visits.find(function (x) { return _sharesStableVisitKey(x, v) && _trustCompatible(x, v); });
    if (!existing) existing = p.visits.find(function (x) { return _visitKey(x) === key && _trustCompatible(x, v); });
    /* Organized chart pulls can create a dated shell before the optional full
       visit reader runs. Upgrade one strictly empty shell on the same day
       instead of creating a duplicate when Athena's detailed type label differs.
       px-1.1 (2026-08-07): with MULTIPLE encounters on one day, "first shell
       on the date" could hydrate encounter A's shell with encounter B's body.
       A stable-alias agreement wins outright; otherwise the upgrade is taken
       only when the day has exactly ONE compatible shell and no stable-key
       CONFLICT - two same-day shells append a new row instead (an extra row
       is recoverable; a wrong weld is not). */
    if (!existing && v.date && v.indexOnly !== true && trim(v.raw)) {
      /* px-1.1 note: the incoming row must itself be a REAL body - an
         incoming index shell "upgrading" an earlier shell would weld two
         different same-day encounters' index rows into one. */
      var dayShells = p.visits.filter(function (x) {
        return _emptyPlaceholder(x) && _svcToYMD(x.date) === _svcToYMD(v.date) && _trustCompatible(x, v);
      });
      existing = dayShells.find(function (x) { return _sharesStableVisitKey(x, v); }) || null;
      if (!existing && dayShells.length === 1) {
        var lone = dayShells[0];
        var bothStable = _stableVisitKeys(lone).length && _stableVisitKeys(v).length;
        if (!bothStable || _sharesStableVisitKey(lone, v)) existing = lone;
      }
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
        /* The shell upgrade must also carry the batch row's completeness: an
           upgraded row without bodyComplete can never satisfy the verified
           persistence proof even though its body just arrived. */
        existing.bodyComplete = v.bodyComplete === true;
        existing.textHead = existing.textHead || v.textHead || '';
      }
      /* Stable Athena aliases are identity-neutral payload metadata and are the
         ONLY thing reconcileVerifiedAthenaVisits can match on. A schedule shell
         has none, so a verified row merged into it used to lose its
         encounterId/sourceVisitKey and be DELETED by the very next reconcile as
         an unmatched verified row (live: every athena-copy body vanished and
         visits-persistence-count-unproven fired for the whole day). Carry them
         on every merge path. */
      existing.encounterId = existing.encounterId || v.encounterId || '';
      existing.sourceVisitKey = existing.sourceVisitKey || v.sourceVisitKey || '';
      if (existing.encounterIndex == null && v.encounterIndex != null) existing.encounterIndex = v.encounterIndex;
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
    _collapseVerifiedStableDuplicates(p, v);
    /* b483: self-heal exact-clone index rows that an earlier stale-clone race
       union-merged into this record. The row just added can only be spliced
       when an identical earlier clone existed, so re-resolve v to the keeper. */
    if (_collapseExactIndexDuplicates(p) && p.visits.indexOf(v) < 0 && _collapsibleIndexRow(v)) {
      var keptSig = _exactIndexSig(v);
      v = p.visits.find(function (x) { return _collapsibleIndexRow(x) && _exactIndexSig(x) === keptSig; }) || v;
    }
    if (opts.persist !== false) _upsert(p);
    return v;
  }

  function reconcileVerifiedAthenaVisits(patientId, batchRows) {
    var p = _findPatient(patientId); if (!p) return { removed: 0, kept: 0 };
    if (!Array.isArray(p.visits)) p.visits = [];
    var rows = Array.isArray(batchRows) ? batchRows : [], accepted = {}, canonical = [];
    for (var r = 0; r < rows.length; r++) {
      var keys = _stableVisitKeys(rows[r]);
      if (!keys.length) return { removed: 0, kept: p.visits.length, reason: 'stable-keys-incomplete' };
      var existingCanonical = [];
      for (var k = 0; k < keys.length; k++) {
        if (accepted[keys[k]] != null && existingCanonical.indexOf(accepted[keys[k]]) < 0) existingCanonical.push(accepted[keys[k]]);
      }
      if (existingCanonical.length > 1) return { removed: 0, kept: p.visits.length, reason: 'stable-key-collision' };
      var ci = existingCanonical.length ? existingCanonical[0] : canonical.length;
      if (!canonical[ci]) canonical[ci] = [];
      for (var ck = 0; ck < keys.length; ck++) if (canonical[ci].indexOf(keys[ck]) < 0) canonical[ci].push(keys[ck]);
      for (var a = 0; a < keys.length; a++) accepted[keys[a]] = ci;
    }

    function matchedCanonical(v) {
      var vk = _stableVisitKeys(v), hits = [];
      for (var i = 0; i < vk.length; i++) if (accepted[vk[i]] != null && hits.indexOf(accepted[vk[i]]) < 0) hits.push(accepted[vk[i]]);
      return hits;
    }
    /* Validate the full reconciliation plan before mutating.  One stored row
       matching two accepted encounters means Athena's aliases collided; retain
       everything and fail closed instead of deleting an arbitrary record. */
    for (var pv = 0; pv < p.visits.length; pv++) {
      var probe = p.visits[pv];
      if (!_remoteVisit(probe) || probe.identityVerified !== true || trim(probe.identityBinding) !== trim(patientId)) continue;
      if (matchedCanonical(probe).length > 1) return { removed: 0, kept: p.visits.length, reason: 'stored-key-collision' };
    }

    var before = p.visits.length;
    var winnerByCanonical = {};
    function freshnessScore(v) {
      var captured = Date.parse(v && v.captured || '') || 0;
      return (_strictVerifiedAthenaBody(v) ? 1000000000000000 : 0) +
        (_stableVisitKeys(v).length * 1000000000000) + captured + Math.min(999999, S(v && v.raw).length);
    }
    p.visits = p.visits.filter(function (v) {
      if (!_remoteVisit(v) || v.identityVerified !== true || trim(v.identityBinding) !== trim(patientId)) return true;
      var hits = matchedCanonical(v);
      if (!hits.length) return false;
      var idx = hits[0], prior = winnerByCanonical[idx];
      if (!prior) { winnerByCanonical[idx] = v; return true; }
      if (freshnessScore(v) > freshnessScore(prior)) {
        /* Array.filter cannot retract a prior item. Mark it, then remove marked
           losers in the second pass below. */
        prior.__mlsExactDuplicateLoser = true;
        winnerByCanonical[idx] = v;
        return true;
      }
      return false;
    });
    p.visits = p.visits.filter(function (v) {
      if (v && v.__mlsExactDuplicateLoser) { try { delete v.__mlsExactDuplicateLoser; } catch (e) {} return false; }
      return true;
    });
    Object.keys(winnerByCanonical).forEach(function (idx) {
      var winner = winnerByCanonical[idx], aliases = canonical[Number(idx)] || [];
      aliases.forEach(function (alias) {
        if (alias.indexOf('encounter|') === 0 && !trim(winner.encounterId || winner.encounterID)) winner.encounterId = alias.slice('encounter|'.length);
        if (alias.indexOf('source|') === 0 && !trim(winner.sourceVisitKey || winner.rowKey)) winner.sourceVisitKey = alias.slice('source|'.length);
      });
    });
    _compactHydratedPlaceholders(p);
    var removed = before - p.visits.length;
    if (removed) _upsert(p);
    return { removed: removed, kept: p.visits.length, complete: true };
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
    /* b483/b485: deterministic post-batch heal. Two ingest layers write the
       same card rows through different trust paths (sp F13a unverified first,
       visit-wire verified second); collapsing on the FRESHEST record drops the
       redundant twins. b485: run even when THIS batch added nothing — a
       fully-merged re-pull is exactly when pairs stranded by an earlier
       session get their only chance to heal. */
    try {
      var freshP = _findPatient(typeof patient === 'string' ? patient : p.id);
      if (freshP && _collapseExactIndexDuplicates(freshP)) _upsert(freshP);
    } catch (eDup) {}
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
    /* px-1.2: normalize encoding and strip page scaffolding BEFORE the model
       sees the text - garbage in was how garbage summaries got out. */
    var bodyForPrompt = _normalizeClinicalText(_stripPageDebris(_visitBodyText(v))).slice(0, 24000);
    lines.push(bodyForPrompt || '(no raw text captured)');
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
    /* px-1.2: a visit with no captured note text has nothing to summarize.
       The old path sent the literal "(no raw text captured)" to the model,
       which then wrote a confident-sounding "summary" of a date and a type -
       that is exactly how bodyless rows summarized incorrectly. */
    if (_visitBodyText(v).length < 10) return Promise.reject(new Error('no-note-text'));
    if (v.aiSummary && !opts.force) return Promise.resolve(v.aiSummary);
    return _aiCall(SUM_SYS, _visitToPrompt(v, p)).then(function (txt) {
      var cleaned = _normalizeClinicalText(trim(txt));
      var verdict = _validVisitSummary(cleaned, v, p);
      if (!verdict.ok) {
        /* Record the refusal (bounded, PHI-free) so callers can avoid a hot
           retry loop; NEVER store the malformed text as a done summary. */
        v.aiSummaryFailed = { at: new Date().toISOString(), reason: verdict.reason };
        _upsert(p);
        var err = new Error('summary-invalid: ' + verdict.reason);
        err.summaryInvalid = verdict.reason;
        throw err;
      }
      v.aiSummary = cleaned;
      if (v.aiSummaryFailed) delete v.aiSummaryFailed;
      _upsert(p);
      return v.aiSummary;
    });
  }

  function ensureSummaries(patientId, onProgress) {
    var p = _findPatient(patientId); if (!p) return Promise.resolve(0);
    var todo = _usableVisits(p).filter(function (v) {
      if (trim(v.aiSummary)) return false;
      /* nothing to summarize from - the renderer shows an honest placeholder */
      if (_visitBodyText(v).length < 10) return false;
      /* a recently refused summary is not retried on every pass */
      var f = v.aiSummaryFailed;
      if (f && f.at && (Date.now() - Date.parse(f.at)) < 6 * 3600 * 1000) return false;
      return true;
    });
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

  /* Deterministic text/encoding repair applied when text is DISPLAYED or fed
     to a summarizer - stored captures are never modified. Repairs the classic
     UTF-8-decoded-as-Windows-1252 sequences, drops replacement/control chars,
     and collapses runaway whitespace. Everything is written as escapes: this
     file is rewritten by the build stamper and a literal non-ASCII byte here
     has corrupted shared files before. */
  function _normalizeClinicalText(s) {
    s = S(s);
    if (!s) return '';
    s = s
      .replace(/\u00E2\u20AC\u2122/g, "'")
      .replace(/\u00E2\u20AC\u02DC/g, "'")
      .replace(/\u00E2\u20AC\u0153/g, '"')
      .replace(/\u00E2\u20AC\u201C/g, '\u2013')
      .replace(/\u00E2\u20AC\u201D/g, '\u2014')
      .replace(/\u00E2\u20AC\u00A2/g, '\u2022')
      .replace(/\u00E2\u20AC\u00A6/g, '\u2026')
      .replace(/\u00E2\u20AC[\u009C\u009D]/g, '"')
      .replace(/\u00E2\u20AC(?=[\s.,;:!?)]|$)/g, '"')
      .replace(/\u00C3\u00A9/g, '\u00E9')
      .replace(/\u00C3\u00A8/g, '\u00E8')
      .replace(/\u00C3\u00A1/g, '\u00E1')
      .replace(/\u00C3\u00B3/g, '\u00F3')
      .replace(/\u00C3\u00AD/g, '\u00ED')
      .replace(/\u00C3\u00BA/g, '\u00FA')
      .replace(/\u00C3\u00B1/g, '\u00F1')
      .replace(/\u00C2\u00B0/g, '\u00B0')
      .replace(/\u00C2\u00A0/g, ' ')
      .replace(/\u00C2(?=\s)/g, '')
      .replace(/\uFFFD+/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
    return s.replace(/[ \t]{3,}/g, '  ');
  }

  /* The clinical body of a visit row - what a summarizer may work FROM.
     aiSummary is deliberately excluded: it is the summarizer's own OUTPUT. */
  function _visitBodyText(v) {
    v = v || {};
    return trim([S(v.raw), S(v.findings), S(v.plan)].filter(function (x) { return trim(x); }).join('\n'));
  }

  /* Strip a trailing ", First Last[, MD]" provider tail that the encounter
     index parser sometimes welds onto the type cell ("fluoro non sedation,
     Matthew Schaeffer, "). Display-only - stored types are never modified
     (legacy id-less rows key their dedupe on type). Conservative: requires a
     credential, or a Two Capitalized Token person shape, at end of string. */
  /* px-2.3 (2026-08-08 adversarial review): the two-capitalized-token arm was
     eating LATERALITY AND SITE tails - "Injection, Right Knee" became
     "Injection", and via the aggregate that stripped text PERSISTED and fed
     op-note context: the wrong-site class. The tail is now refused whenever it
     contains clinical/anatomy/laterality vocabulary, and this cleaner is used
     at RENDER sites only - the persisted aggregate keeps the raw type. */
  var _TYPE_TAIL_CLINICAL_RE = /\b(?:right|left|bilateral|knee|shoulder|hip|spine|spinal|lumbar|cervical|thoracic|sacral|sacroiliac|caudal|elbow|wrist|ankle|foot|hand|neck|back|joint|nerve|block|branch|medial|lateral|genicular|trapezius|gluteal|femoral|occipital|epidural|facet|contrast|with|without|side|level|new|patient|post|pre|op|follow|episode|injection|ablation|steroid)\b/i;
  function _cleanVisitTypeForDisplay(t) {
    t = _normalizeClinicalText(S(t));
    var m = t.match(/,\s*((?:[A-Z][a-zA-Z'.-]+\s+[A-Z][a-zA-Z'.-]+\s*,?\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|CRNP|RN|DPM|PhD)?\.?|[A-Z][a-zA-Z'.-]+\s*,?\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|CRNP|RN|DPM|PhD)\.?))\s*,?\s*$/);
    if (m && !_TYPE_TAIL_CLINICAL_RE.test(m[1])) t = t.slice(0, m.index);
    return trim(t).replace(/[,\s]+$/, '');
  }

  var _MOJIBAKE_RE = /\u00E2\u20AC|\u00C3[\u0080-\u00BF]|\uFFFD/;
  /* px-2.6 (adversarial review): clinical prose legitimately writes
     "<no known drug allergies>" and '"pain": 7' - the old shapes refused
     both. HTML is asserted only on a real closing tag or a KNOWN tag name;
     JSON scaffolding only when a line STARTS like serialized JSON. */
  var _HTML_TAG_RE = /<\/[a-z][a-z0-9-]*>|<(?:div|span|br|p|table|thead|tbody|td|tr|th|ul|ol|li|b|i|em|strong|style|script|html|head|body|h[1-6]|a|img|input|button|form|pre|code)\b[^<>]*>/i;
  var _JSON_SCAFFOLD_RE = /^\s*[\[{]\s*"|^\s*"[a-z_]{2,24}"\s*:\s*["\[{0-9]/im;
  /* Validate a model-produced visit summary BEFORE it is stored. A reply that
     is empty, encoding-garbled, markup/JSON-shaped, echoes the prompt, names a
     conflicting DOB, or repeats itself verbatim is refused - the raw captured
     text (which the renderer already falls back to) is safer than storing a
     malformed "summary" as if it were done. */
  function _validVisitSummary(txt, v, p) {
    var s = trim(txt);
    if (!s || s.length < 20) return { ok: false, reason: 'empty-or-short' };
    if (_MOJIBAKE_RE.test(s)) return { ok: false, reason: 'encoding-garbage' };
    if (_HTML_TAG_RE.test(s)) return { ok: false, reason: 'html-markup' };
    if (_JSON_SCAFFOLD_RE.test(s)) return { ok: false, reason: 'json-scaffolding' };
    if (/RAW CAPTURED VISIT DATA|clinical documentation summarizer/i.test(s)) return { ok: false, reason: 'prompt-echo' };
    var dm = s.match(/\bDOB\b\s*:?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2})/i);
    /* px-2.6: on records the hygiene pass marked athenaImportSuspect the
       STORED DOB is the untrustworthy side - a summary quoting the chart's
       CORRECT DOB must not be refused against it. */
    if (dm && p && trim(p.dob) && !(p.athenaImportSuspect && p.athenaImportSuspect.reason)) {
      var da = _normDob(dm[1]), db = _normDob(p.dob);
      if (da && db && da !== db) return { ok: false, reason: 'dob-conflict' };
    }
    if (s.length >= 240) {
      var probe = s.slice(40, 100);
      if (trim(probe).length >= 40 && s.indexOf(probe, 101) >= 0) return { ok: false, reason: 'duplicated-passage' };
    }
    return { ok: true };
  }

  var _clinicalSectionAliases = [
    'assessment and plan', 'assessment/plan', 'assessment', 'problem list', 'problems', 'diagnoses', 'diagnosis',
    'medication list', 'current medications', 'medications', 'meds', 'allergies', 'allergy',
    'past medical history', 'medical history', 'pmh', 'past surgical history', 'surgical history', 'psh',
    'surgical & procedure history', 'surgical and procedure history', 'procedure history',
    'social history', 'social', 'family history', 'family', 'smoking status', 'tobacco use', 'smoking',
    'immunization history', 'immunizations', 'vaccines', 'last menstrual period', 'pregnancy status', 'lmp',
    'code status', 'primary care provider', 'referring provider', 'pcp', 'preferred pharmacy', 'pharmacy',
    'vital signs', 'vitals', 'blood pressure', 'height', 'weight', 'bmi',
    'chief complaint', 'reason for visit', 'history of present illness', 'hpi', 'review of systems', 'ros',
    'physical examination', 'physical exam', 'exam', 'procedure', 'procedures', 'plan', 'orders', 'follow up', 'follow-up'
  ];
  var _clinicalSectionLookup = _clinicalSectionAliases.reduce(function (out, x) { out[x] = 1; return out; }, {});
  var _clinicalSectionPattern = _clinicalSectionAliases.slice().sort(function (a, b) { return b.length - a.length; }).map(function (x) {
    return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|');

  function _sectionSource(text) {
    var src = S(text).replace(/<br\s*\/?>/ig, '\n').replace(/\r\n?/g, '\n');
    /* Athena sometimes flattens adjacent labeled sections onto one line. Split
       only at known clinical headings after real punctuation, never at arbitrary
       words inside medication instructions or narrative prose. */
    if (_clinicalSectionPattern) {
      var inline = new RegExp('([.!?;|])\\s+(?=(?:[-*\\u2022]\\s*)?(?:\\*\\*)?(?:' + _clinicalSectionPattern + ')(?:\\*\\*)?\\s*(?::|\\s+-\\s+))', 'ig');
      src = src.replace(inline, '$1\n');
      /* px-5.0 (2026-08-08, measured on a real chart): the athena print view
         also flattens sections with NO colon at all - the heading is followed
         by its own review-status line or an explicit-empty marker:
           "... Fax (610) 444-5700 Vitals None recorded. Allergies Allergies
            not reviewed (last reviewed 06/16/2026) BEE POLLEN, low
            criticality MITE EXTRACT, low criticality Medications ..."
         The old splitter required ":" or " - " after the heading, so the
         WHOLE run stayed one line, no heading was ever recognized, and two
         documented allergens never reached the store (coverage said
         detected:0 - invisible, so every receipt passed). Split on the two
         unmistakable print markers: a DOUBLED heading followed by "not
         reviewed", and a heading followed by "None recorded". */
      var dbl = new RegExp('\\s+(?=(' + _clinicalSectionPattern + ')\\s+\\1\\s+not reviewed\\b)', 'ig');
      src = src.replace(dbl, '\n');
      var noneRec = new RegExp('\\s+(?=(?:' + _clinicalSectionPattern + ')\\s+None recorded\\b)', 'ig');
      src = src.replace(noneRec, '\n');
      /* px-5.2 (2026-08-08, measured on a second real chart): the reviewed
         variant doubles the heading with "Reviewed" BETWEEN the copies -
         "Problems Reviewed Problems Lumbar spondylosis - Onset: ...",
         "Medications Reviewed Medications Name Date Source amLODIPine ...",
         "Surgical & Procedure History Reviewed Surgical & Procedure History
          Operation on shoulder ...". Counted on that chart: 5 problems ->
         2 captured, 5+ meds -> 0, 4 surgical -> 0, because this shape was
         also invisible. Same doubled-heading proof, same split. */
      var revDbl = new RegExp('\\s+(?=(' + _clinicalSectionPattern + ')\\s+(?:Not\\s+)?Reviewed\\s+\\1\\b)', 'ig');
      src = src.replace(revDbl, '\n');
    }
    return src;
  }

  /* px-5.0: the print-view heading shapes ("Allergies Allergies not reviewed
     (...) <entries>" and "Vitals None recorded.") - precompiled once. */
  var _printDoubledHeadingRe = _clinicalSectionPattern ? new RegExp('^(' + _clinicalSectionPattern + ')\\s+(\\1\\s+not reviewed\\b.*|None recorded\\b.*)$', 'i') : null;
  /* px-5.2: "<H> Reviewed <H> <entries>" / "<H> Not Reviewed <H> <entries>" */
  var _printReviewedHeadingRe = _clinicalSectionPattern ? new RegExp('^(' + _clinicalSectionPattern + ')\\s+(?:Not\\s+)?Reviewed\\s+\\1\\b\\s*(.*)$', 'i') : null;
  function _headingFromLine(line) {
    var clean = S(line).replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim();
    if (!clean) return null;
    var exact = clean.toLowerCase().replace(/\s+/g, ' ');
    if (_clinicalSectionLookup[exact]) return { label: exact, value: '' };
    if (_printDoubledHeadingRe) {
      var dblm = clean.match(_printDoubledHeadingRe);
      if (dblm) {
        var dlbl = trim(dblm[1]).toLowerCase().replace(/\s+/g, ' ');
        if (_clinicalSectionLookup[dlbl]) return { label: dlbl, value: trim(dblm[2]) };
      }
    }
    if (_printReviewedHeadingRe) {
      var revm = clean.match(_printReviewedHeadingRe);
      if (revm) {
        var rlbl = trim(revm[1]).toLowerCase().replace(/\s+/g, ' ');
        if (_clinicalSectionLookup[rlbl]) return { label: rlbl, value: trim(revm[2]) };
      }
    }
    var m = clean.match(/^([^:]{1,72}?)(?::|\s+-\s+)(.*)$/);
    if (!m) return null;
    var label = trim(m[1]).toLowerCase().replace(/\s+/g, ' ');
    if (_clinicalSectionLookup[label]) return { label: label, value: trim(m[2]) };
    /* A conservative unknown colon-heading boundary keeps e.g. "Diagnostic
       studies:" out of medications without misclassifying "Gabapentin: 300
       mg" or "Penicillin - rash" as a new section. */
    var generic = clean.match(/^([^:]{2,60}):(.*)$/);
    if (generic && /(?:history|review|exam|finding|note|instruction|documentation|result|imaging|diagnostic|laborator|treatment|recommendation)/i.test(generic[1])) {
      return { label: '__other__', value: trim(generic[2]) };
    }
    return null;
  }

  /* px-5.0: an athena print allergen run arrives as ONE flattened string:
     "Allergies not reviewed (last reviewed 06/16/2026) BEE POLLEN, low
      criticality MITE EXTRACT, low criticality". Expand into one entry per
     allergen, criticality kept with its allergen; the review-status prefix is
     furniture (a review date is not an allergen) and is dropped. Fails open:
     text that does not match the run shape passes through unchanged, so
     "NKDA" and "PENICILLIN - rash" behave exactly as before. */
  function _expandAllergyRun(v) {
    var s = trim(S(v));
    if (!s) return [];
    var stripped = trim(s.replace(/^(?:allergies\s+)?(?:not reviewed|reviewed)\s*\(last reviewed[^)]*\)\s*/i, ''));
    if (!stripped) return [];
    var re = /([A-Z][A-Z0-9()\/'&.\- ]{1,60}?),\s*(low|moderate|high|unknown)\s+criticality\b/g;
    var out = [], m;
    while ((m = re.exec(stripped))) out.push(trim(m[1]) + ' (' + m[2].toLowerCase() + ' criticality)');
    if (out.length) {
      var rest = trim(stripped.replace(re, ' ').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, ''));
      if (rest && !_notData(rest)) out.push(rest);
      return out;
    }
    return [stripped];
  }

  /* px-5.2: the reviewed-variant print flattens PROBLEM entries into one run
     ("Lumbar spondylosis - Onset: 06/23/2026 Thoracic spine pain - Onset:
     05/13/2026 ...") and MEDICATION rows into a header-led table run
     ("Name Date Source amLODIPine 5 mg tablet 04/11/26 filled surescripts
     ..."). Both expanders keep the clinical qualifier with its entry and
     fail OPEN - text without the run markers passes through unchanged. */
  function _expandOnsetRun(v) {
    var s = trim(S(v));
    if (!s) return [];
    var re = /(.{2,120}?)\s*-\s*Onset:\s*([\d\/\-.]{4,12})\s*/g;
    var out = [], m, consumed = 0;
    while ((m = re.exec(s))) { out.push(trim(m[1]) + ' (onset ' + m[2] + ')'); consumed = re.lastIndex; }
    if (!out.length) return [s];
    var rest = trim(s.slice(consumed));
    if (rest && !_notData(rest)) out.push(rest);
    return out;
  }
  function _expandMedTableRun(v) {
    var s = trim(S(v)).replace(/^Name\s+Date\s+Source\s*/i, '');
    if (!s) return [];
    var re = /(.{2,120}?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(filled|prescribed|entered|reported|dispensed)\s+(\S+)\s*/gi;
    var out = [], m, consumed = 0;
    while ((m = re.exec(s))) { out.push(trim(m[1]) + ' (' + m[3].toLowerCase() + ' ' + m[2] + ')'); consumed = re.lastIndex; }
    if (!out.length) return [s];
    var rest = trim(s.slice(consumed));
    if (rest && !_notData(rest)) out.push(rest);
    return out;
  }

  function _splitSectionValue(value) {
    var out = [];
    S(value).split(/\n|\s*[\u2022]\s*|\s*;\s*/).forEach(function (part) {
      part = _plain(part).replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim();
      if (part) out.push(part);
    });
    return out;
  }

  function _recordSectionCoverage(tracker, key, detected, parsed, explicitEmpty) {
    if (!tracker || !key || !detected) return;
    tracker.sections = tracker.sections || {};
    var row = tracker.sections[key] || (tracker.sections[key] = { detected: 0, parsed: 0, explicitEmpty: 0, missed: 0 });
    row.detected += detected;
    row.parsed += parsed;
    row.explicitEmpty += explicitEmpty;
    if (!parsed && !explicitEmpty) row.missed += detected;
  }

  function _sectionValues(text, labels, tracker, coverageKey) {
    var wanted = {}, out = [], active = false, blockParsed = 0, blockExplicitEmpty = 0;
    (labels || []).forEach(function (x) { wanted[trim(x).toLowerCase().replace(/\s+/g, ' ')] = 1; });
    var lines = _sectionSource(text).split('\n');
    function consume(value) {
      var values = _splitSectionValue(value);
      if (!values.length && trim(value)) values = [trim(value)];
      values.forEach(function (v) {
        if (_notData(v)) { blockExplicitEmpty++; return; }
        out.push(v); blockParsed++;
      });
    }
    function finishBlock() {
      if (!active) return;
      _recordSectionCoverage(tracker, coverageKey, 1, blockParsed, blockExplicitEmpty);
      blockParsed = 0; blockExplicitEmpty = 0;
    }
    for (var i = 0; i < lines.length; i++) {
      var heading = _headingFromLine(lines[i]);
      if (heading) {
        finishBlock();
        active = !!wanted[heading.label];
        if (active) {
          if (heading.value) consume(heading.value);
        }
        continue;
      }
      if (!active || !trim(lines[i])) continue;
      consume(lines[i]);
      if (out.length >= 80) break;
    }
    finishBlock();
    return out.slice(0, 80);
  }

  function _structuredValues(value) {
    var raw = Array.isArray(value) ? value : [value], out = [];
    raw.forEach(function (item) {
      if (item == null) return;
      if (typeof item === 'object') {
        Object.keys(item).forEach(function (k) { if (trim(item[k])) out = out.concat(_splitSectionValue(item[k])); });
      } else out = out.concat(_splitSectionValue(item));
    });
    return out;
  }

  function _semanticCoverageReceipt(tracker) {
    tracker = tracker || { sections: {} };
    var sections = {}, missed = [];
    Object.keys(tracker.sections || {}).forEach(function (key) {
      var src = tracker.sections[key] || {}, row = {
        detected: Number(src.detected) || 0,
        parsed: Number(src.parsed) || 0,
        explicitEmpty: Number(src.explicitEmpty) || 0,
        complete: !(Number(src.missed) > 0)
      };
      sections[key] = row;
      if (!row.complete) missed.push(key);
    });
    return { complete: missed.length === 0, sections: sections, missedSections: missed };
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

  /* visits[].type is the LAST term of the summary fallback chain, so on a visit
     with no body it becomes the rendered description. Measured on the live
     roster 2026-08-06: 2,070 of 3,329 visits have no body, and 58 of those
     carry text scraped off an inbox or worklist surface rather than an
     encounter -- 50 message threads and 10 strings carrying a THIRD PARTY'S
     name and date of birth. _stripIdentityLines cannot catch the latter: it
     anchors "dob:" to the start of a line, and these arrive mid-string after a
     slash. Both shapes are unmistakable and neither can be a visit reason, so
     they fall through to the placeholder instead of printing as clinical text.
     Deliberately NARROW -- a name-shaped test suppressed 32% of legitimate
     descriptions while still passing correspondence that quoted the patient's
     own name. Text that merely mentions another person stays visible; the
     collector, not the renderer, is what must stop ingesting these. */
  /* » is the thread separator athenaNet renders between message authors.
     Escaped, not literal: this file is rewritten by the build stamper and a
     non-ASCII byte here has corrupted shared files before. */
  var _NOT_A_VISIT_REASON = /\u00BB|[\/,]\s*d?\.?o\.?b\.?\s*:?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\bd\.?o\.?b\.?\b\s*:?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\bdate of birth\b/i;
  function _typeIsRenderableReason(t) { return !!trim(t) && !_NOT_A_VISIT_REASON.test(S(t)); }

  function _stripIdentityLines(text) {
    return _plain(S(text).split(/\n+/).filter(function (line) {
      return !/^\s*(?:patient|name|dob|date of birth|mrn|age|sex|gender)\s*:/i.test(_plain(line));
    }).join(' '));
  }

  /* Athena print-view captures arrive with the page's own scaffolding baked
     into the text: inline JavaScript (window.Original / SVGJotter / Jotter /
     IsSafari sketchpad shims) and the repeated print header ("Print <practice>
     • <address> NAME, First (id #NNN, dob: MM/DD/YYYY)"). None of that is
     clinical content. Deterministic scrub, applied when text is SUMMARIZED for
     display — the stored raw capture is never modified. */
  var _DEBRIS_START = /^(window\.|document\.|function$|function\(|var$|new$|Jotter=?$|IsSafari=?$|SVGJotter|VMLJSONToRaphaelJSON|GetStrokesDimensions|PutSketchpad|svgjotter)/i;
  var _DEBRIS_CODEY = /[{}();=<>[\]]|^['"]|['"][:,]?$|^\d+[,;]?$|^(var|function|new|return|if|else|for|while|this|null|true|false|params)$|params\.|jotter|svgjotter|raphael|\bjson\b|^\/\//i;
  function _stripPageDebris(text) {
    /* The Athena print page's scaffolding is interleaved with the note text,
       often on ONE long line, sometimes BEFORE the clinical content. A cut-to-
       end would delete the note itself, so this walks tokens: a strong code
       marker enters code mode, code-shaped tokens stay dropped, and a run of
       plain prose tokens exits code mode with that prose kept. */
    var lines = S(text).split(/\n/).map(function (line) {
      line = line.replace(/\bPrint\b[\s\S]{0,240}?\(id\s*#\d+,\s*dob:\s*\d{1,2}\/\d{1,2}\/\d{2,4}\)[\s.•-]*/g, '');
      if (!_DEBRIS_START.test(line) && line.search(/window\.|svgjotter|SVGJotter|\bJotter\b|IsSafari|VMLJSON/i) < 0) {
        return line.replace(/\s{2,}/g, ' ').replace(/\s+$/, '');
      }
      var toks = line.split(/\s+/), res = [], buf = [], code = false;
      for (var i = 0; i < toks.length; i++) {
        var t = toks[i]; if (!t) continue;
        if (!code && _DEBRIS_START.test(t)) { code = true; buf = []; continue; }
        if (code) {
          if (_DEBRIS_CODEY.test(t)) { buf = []; continue; }
          buf.push(t);
          if (buf.length >= 5) { code = false; res = res.concat(buf); buf = []; }
          continue;
        }
        res.push(t);
      }
      return res.join(' ').replace(/[{};|]{2,}/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+$/, '');
    }).filter(function (line) {
      return line === '' || !/^[\s\-•·—*.,;:{}()]*$/.test(line);
    });
    return lines.join('\n');
  }

  /* px-2.0 (2026-08-07) - the longitudinal summary, rebuilt.
     What was wrong, measured on the live store 2026-08-07: (a) 26 of 34
     stored summaries were ONLY the header line ("Longitudinal summary
     refreshed 8/5/2026 -") because a patient with zero usable visits still
     reached this builder and nothing else was emitted; (b) the "lead" block
     printed visits[0]'s body and then the Recent-visits loop printed
     visits[0] AGAIN - the duplicated-passage class (8 live records); (c) the
     summary had NO sections for problems / allergies / medications even when
     the verified chart snapshot held them. Now: structured sections from the
     verified facts, first visit gets the larger excerpt exactly once,
     verified-absent cards are stated, and when there is truly nothing the
     builder returns '' so the honest empty-panel text shows instead of a
     truncated-looking header. */
  function _aggregateSummary(p, visits, facts) {
    var lines = [];
    var pulled = visits.some(_isAthenaVisit);
    var when = new Date().toLocaleDateString();
    lines.push((pulled ? 'Pulled from Athena ' : 'Longitudinal summary refreshed ') + when + ' —');
    var norm = function (x) { return trim(_normalizeClinicalText(S(x))); };
    var any = false;
    var section = function (title, values, per, cap) {
      values = _uniq((values || []).map(norm).filter(Boolean));
      if (!values.length) return;
      per = per || 360; cap = cap || 14;
      lines.push('', title + ':');
      values.slice(0, cap).forEach(function (x) { lines.push('• ' + x.slice(0, per)); });
      if (values.length > cap) lines.push('• (+' + (values.length - cap) + ' more on the chart)');
      any = true;
    };
    section('Active or significant problems', facts.problems);
    section('Allergies and reactions', facts.allergies);
    section('Medications', facts.meds, 240, 20);
    section('Past medical history', facts.history.pmh);
    section('Surgical and procedural history', facts.history.psh);
    section('Social and family history', [].concat(facts.history.social || [], facts.history.smoking || [], facts.history.family || []));
    var vit = facts.vitals || {}, vitBits = [];
    if (trim(S(vit.bp))) vitBits.push('BP ' + trim(S(vit.bp)));
    if (trim(S(vit.hr))) vitBits.push('HR ' + trim(S(vit.hr)));
    if (trim(S(vit.bmi))) vitBits.push('BMI ' + trim(S(vit.bmi)));
    if (vitBits.length) section('Vitals (latest captured)', [vitBits.join(', ') + (trim(S(vit.takenAt)) ? ' (' + trim(S(vit.takenAt)) + ')' : '')]);
    if (visits.length) {
      lines.push('', 'Recent visits:');
      visits.slice(0, 12).forEach(function (v, i) {
        /* px-2.3: raw type here - the display cleaner is render-only so a
           stripped laterality can never persist into summary/op-note text.
           px-2.4 (owner bar): a bodyless visit's TYPE must not masquerade as
           its note - when the line's content is only the schedule label, say
           so on the line itself. */
        var reason = _typeIsRenderableReason(v.type) ? trim(_normalizeClinicalText(S(v.type))) : '';
        var body = norm(_stripIdentityLines(_stripPageDebris(v.aiSummary || v.findings || v.plan || v.raw || '')));
        var detail = body || (reason ? reason + ' (scheduled visit — no note text captured)' : 'Visit — no readable note text captured');
        lines.push('• ' + (v.date || 'Undated') + ' — ' + detail.slice(0, i === 0 ? 700 : 320));
      });
      any = true;
    }
    /* Verified-absent honesty: cards the identity-gated chart read PROVED
       empty are stated, so "nothing listed" is distinguishable from "never
       read". Only an exact-patient complete receipt may speak. */
    try {
      var rec = p && p.athenaProfileCoverage;
      if (rec && rec.complete === true && rec.exactIdentityVerified === true && trim(rec.patientId) === trim(p && p.id) && rec.cards) {
        var none = [];
        [['problems', 'problems'], ['meds', 'medications'], ['allergies', 'allergies'], ['history', 'history'], ['vitals', 'vitals']].forEach(function (pair) {
          var card = rec.cards[pair[0]];
          if (card && card.status === 'not_documented') none.push(pair[1]);
        });
        if (none.length) { lines.push('', 'Verified on the Athena chart with none documented: ' + none.join(', ') + '.'); any = true; }
      }
    } catch (eNone) {}
    /* Nothing captured AND nothing verified: an empty string, never a bare
       header. The profile's own honest-empty text ("No Athena history pulled
       for this patient yet") renders instead, and the store census cannot
       mistake a header for captured content. */
    if (!any) return '';
    return lines.join('\n').slice(0, 9000);
  }

  /* WHOSE HISTORY IS THIS? — the stored receipt could not answer that.
     ---------------------------------------------------------------------
     The pull-time path verifies identity properly (identityVerified, an
     identityBinding to a patient id, _athenaHistoryProofMatches on name+DOB,
     exactIdentityVerified on the receipt) — but NONE of it survived into what
     is persisted. historyImportReceipt recorded completeness and counts, never
     WHOSE chart it was, so from stored data alone nobody could audit whether a
     patient's history belongs to them.

     Found 2026-08-06 while answering the owner's "make sure the extension
     actually pulls the right history". An audit of 260 records from the
     2026-06-24→06-29 cross-contamination window could only demonstrate
     NON-COLLAPSE — that no two patients share a history — which is strictly
     weaker than proof of correct attribution: a defect that gave each patient a
     DIFFERENT wrong history would be invisible to every check available on the
     stored record.

     The profile receipt already does this right (athenaProfileCoverage carries
     patientId, and the merge above refuses a snapshot whose patientId is not
     this record's). This brings the history receipt to the same standard.

     The fingerprint is over the identity AS IT WAS AT IMPORT, so a record whose
     name/DOB is later re-identified — the chimera-upsert class — no longer
     matches its own history receipt, and that disagreement is detectable rather
     than silent. It is a non-cryptographic digest of fields already stored in
     plain text on the same record; it adds no PHI. */
  function _identityFingerprint(p) {
    var basis = (trim(p && p.name) + '|' + trim(p && p.dob)).toLowerCase().replace(/[^a-z0-9|]/g, '');
    if (basis === '|') return '';
    var h = 0;
    for (var i = 0; i < basis.length; i++) { h = ((h << 5) - h + basis.charCodeAt(i)) | 0; }
    return 'idfp-' + (h >>> 0).toString(36);
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
    var semanticTracker = { sections: {} };
    /* The structured chart snapshot is trusted only with the exact-patient
       six-card receipt created by the identity-gated chart sink. This captures
       profile-only facts that do not appear inside any encounter body. */
    var profileReceipt=p.athenaProfileCoverage, snap=p.athenaChartSnapshot;
    if(snap&&profileReceipt&&profileReceipt.complete===true&&profileReceipt.exactIdentityVerified===true&&trim(profileReceipt.patientId)===trim(p.id)){
      facts.problems=facts.problems.concat(_structuredValues(snap.problems));
      facts.meds=facts.meds.concat(_structuredValues(snap.meds));
      facts.allergies=facts.allergies.concat(_structuredValues(snap.allergies));
      var sh=(snap.history&&!Array.isArray(snap.history)&&typeof snap.history==='object')?snap.history:{};
      Object.keys(facts.history).forEach(function(k){facts.history[k]=facts.history[k].concat(_structuredValues(sh[k]));});
      facts.vitals=_canonicalVitals(snap.vitals);
    }
    visits.slice(0, 80).forEach(function (v) {
      var text = [v.raw, v.aiSummary, v.findings, v.plan].join('\n').slice(0, 24000);
      (v.icd10 || []).forEach(function (c) { facts.problems.push('ICD-10 ' + c); });
      facts.meds = facts.meds.concat(_structuredValues(v.meds || []));
      _sectionValues(text, ['problem list', 'problems', 'diagnoses', 'diagnosis', 'assessment', 'assessment and plan', 'assessment/plan'], semanticTracker, 'problems').forEach(function (pRun) {
        facts.problems = facts.problems.concat(_expandOnsetRun(pRun));
      });
      _sectionValues(text, ['medications', 'medication list', 'current medications', 'meds'], semanticTracker, 'meds').forEach(function (mRun) {
        facts.meds = facts.meds.concat(_expandMedTableRun(mRun));
      });
      _sectionValues(text, ['allergies', 'allergy'], semanticTracker, 'allergies').forEach(function (avRun) {
        facts.allergies = facts.allergies.concat(_expandAllergyRun(avRun));
      });
      facts.history.pmh = facts.history.pmh.concat(_sectionValues(text, ['past medical history', 'medical history', 'pmh'], semanticTracker, 'history.pmh'));
      facts.history.psh = facts.history.psh.concat(_sectionValues(text, ['past surgical history', 'surgical history', 'psh', 'surgical & procedure history', 'surgical and procedure history', 'procedure history'], semanticTracker, 'history.psh'));
      facts.history.social = facts.history.social.concat(_sectionValues(text, ['social history', 'social'], semanticTracker, 'history.social'));
      facts.history.family = facts.history.family.concat(_sectionValues(text, ['family history', 'family'], semanticTracker, 'history.family'));
      facts.history.smoking = facts.history.smoking.concat(_sectionValues(text, ['smoking status', 'tobacco use', 'smoking'], semanticTracker, 'history.smoking'));
      facts.history.immunizations = facts.history.immunizations.concat(_sectionValues(text, ['immunizations', 'immunization history', 'vaccines'], semanticTracker, 'history.immunizations'));
      facts.history.lmp = facts.history.lmp.concat(_sectionValues(text, ['lmp', 'last menstrual period', 'pregnancy status'], semanticTracker, 'history.lmp'));
      facts.history.codeStatus = facts.history.codeStatus.concat(_sectionValues(text, ['code status'], semanticTracker, 'history.codeStatus'));
      facts.history.pcp = facts.history.pcp.concat(_sectionValues(text, ['primary care provider', 'pcp', 'referring provider'], semanticTracker, 'history.pcp'));
      facts.history.pharmacy = facts.history.pharmacy.concat(_sectionValues(text, ['preferred pharmacy', 'pharmacy'], semanticTracker, 'history.pharmacy'));
      var vv=_vitalsFromText(text,v.date); Object.keys(facts.vitals).forEach(function(k){if(!facts.vitals[k]&&vv[k])facts.vitals[k]=vv[k];});
    });
    facts.problems = _uniq(facts.problems);
    facts.meds = _uniq(facts.meds);
    facts.allergies = _uniq(facts.allergies);
    Object.keys(facts.history).forEach(function (k) { facts.history[k] = _uniq(facts.history[k]); });

    var semanticCoverage = _semanticCoverageReceipt(semanticTracker);
    if (!semanticCoverage.complete) {
      /* Never replace an earlier complete import with a partial parse. Keep all
         clinician-authored and previously imported clinical fields intact, but
         persist an honest receipt so UI/callers cannot claim the six cards are
         current when a labeled source section was not understood. */
      p.historyImportReceipt = {
        complete: false,
        verifiedVisits: visits.length,
        excludedUnverified: excluded,
        semanticCoverage: semanticCoverage,
        organizedAt: new Date().toISOString(),
        patientId: trim(p.id),
        identityFingerprint: _identityFingerprint(p)
      };
      if(profileReceipt&&profileReceipt.complete===true&&profileReceipt.exactIdentityVerified===true&&trim(profileReceipt.patientId)===trim(p.id)){
        p.athenaProfileCoverage=Object.assign({},profileReceipt,{semanticComplete:false,semanticCoverage:semanticCoverage});
      }
      _upsert(p);
      return {
        ok: false, reason: 'semantic-coverage-incomplete', complete: false,
        verifiedVisits: visits.length, excludedUnverified: excluded,
        semanticCoverage: semanticCoverage
      };
    }

    /* AN OWNED FACT MAY ONLY BE REMOVED BY A PASS THAT ACTUALLY RE-READ ITS
       SOURCE. _mergeOwnedText treats every entry of the PREVIOUS facts snapshot
       as removable, so when the exact-patient receipt gate above did not open,
       this pass strips the whole Athena-owned slice and puts back only what it
       can re-derive from visit bodies. Measured 2026-07-28 on the real model:
       twelve chart problems in, SIX out (the six named in one visit assessment)
       and with no visits at all the field went to the empty string - receipt
       ok:true both times. The receipt is exactly the condition that is known to
       be lost to stale bulk writes on a day pull, so this fired on roughly the
       half of the day that lost its coverage stamp.
       The replace-stale-Athena-data intent is UNCHANGED when the slice was read
       (the gate below is the same one that seeded facts from the snapshot); when
       it was not read, this pass may only add, never remove. Fails safe. */
    var athenaSliceReRead=!!(snap&&profileReceipt&&profileReceipt.complete===true&&profileReceipt.exactIdentityVerified===true&&trim(profileReceipt.patientId)===trim(p.id));
    var oldFacts=(athenaSliceReRead&&p.athenaHistoryFactsSnapshot&&typeof p.athenaHistoryFactsSnapshot==='object')?p.athenaHistoryFactsSnapshot:{};
    p.problems = _mergeOwnedText(p.problems, oldFacts.problems, facts.problems);
    p.meds = _mergeOwnedText(p.meds, oldFacts.meds, facts.meds);
    p.allergies = _mergeOwnedText(p.allergies, oldFacts.allergies, facts.allergies);
    p.history = (p.history && !Array.isArray(p.history) && typeof p.history === 'object') ? p.history : {};
    var oldHistory=(oldFacts.history&&!Array.isArray(oldFacts.history)&&typeof oldFacts.history==='object')?oldFacts.history:{};
    Object.keys(facts.history).forEach(function (k) { p.history[k] = _mergeOwnedText(p.history[k], oldHistory[k], facts.history[k]); });
    _mergeVitalsForPatient(p,facts.vitals);
    var aggregate = _aggregateSummary(p, visits, facts);
    /* px-2.0/2.3: an empty aggregate CLEARS a previously importer-owned
       summary ONLY when this very pass provably RE-READ the athena slice
       (athenaSliceReRead) - "I looked and it is empty" may erase; "I found
       nothing to look at" may not (adversarial review 2026-08-08: a 0-visit
       patient with a stale/mismatched receipt was blanking a good summary
       under ok:true - the read-gate-feeds-a-write class re-opened). The
       header-only JUNK class is cleaned by the run-once hygiene pass instead,
       whose regex proves the summary carries zero content. Clinician-authored
       text is never touched either way. */
    if (trim(aggregate)) p.athenaHistorySummary = aggregate;
    else if (athenaSliceReRead && /^[\s—–-]*(?:Pulled from Athena|Longitudinal summary refreshed)\b/i.test(trim(S(p.athenaHistorySummary)))) p.athenaHistorySummary = '';
    /* Preserve a clinician-authored free-text summary. Only fill/refresh the
       legacy summary slot when it is empty or clearly owned by this importer. */
    /* px-2.7: the pre-b7xx stamp era wrapped the header in em-dashes
       ("— Pulled from Athena 7/27/2026 —"), which defeated this anchored
       ownership test - the mirror then refused to replace the app's own old
       stamp, and the panel kept rendering the bare header forever (measured
       live on b949). Leading dash/space is tolerated; the phrase+date shape
       is unmistakably the importer's own. */
    if (!trim(p.summary) || /^[\s—–-]*(?:Pulled from Athena|Longitudinal summary refreshed)\b/i.test(trim(p.summary))) {
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
      p.athenaProfileCoverage=Object.assign({},profileReceipt,{cards:cards,semanticComplete:true,semanticCoverage:semanticCoverage});
    }
    p.historyImportReceipt = {
      complete: true,
      verifiedVisits: visits.length,
      excludedUnverified: excluded,
      semanticCoverage: semanticCoverage,
      organizedAt: new Date().toISOString(),
      patientId: trim(p.id),
      identityFingerprint: _identityFingerprint(p)
    };
    _upsert(p);
    return {
      ok: true, complete: true,
      verifiedVisits: visits.length,
      excludedUnverified: excluded,
      semanticCoverage: semanticCoverage,
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

  /* ---- one-time store hygiene (px-2.1, 2026-08-07) ----
     (a) header-only athena summaries ("Longitudinal summary refreshed X -"
         with NOTHING after the dash) read like truncation and carry zero
         facts - clear them so the honest empty-panel text shows instead.
     (b) aiSummary === '' keys were stored by failed model calls; drop the
         empty key so the row renders its honest fallback.
     (c) records created inside the known 2026-06-24..29 cross-contamination
         window whose DOB collapses into a shared cluster get a VISIBLE
         suspect marker. Fields are never blanked - a wrong-but-visible value
         is safer than a confident empty ("no allergies recorded" from a wipe
         would be a false clinical claim). Repair is a re-pull, not a wipe. */
  function _storeHygieneOnce() {
    try {
      if (!isFn(window.getPatients) || !isFn(window.upsertPatient)) return;
      var flagKey = (typeof window.uns === 'function') ? window.uns('mlsPxHygiene1') : 'mlsPxHygiene1';
      try { if (localStorage.getItem(flagKey) === '1') return; } catch (eR) { return; }
      var pts = window.getPatients() || [];
      /* px-2.5 (adversarial review): an EMPTY roster means the store has not
         hydrated yet (server-mirror rebuild in flight) - inspecting nothing
         must not consume the run-once flag or the suspect banners never
         write. Re-arm BOUNDED (px-2.5.1: an unbounded re-arm held the node
         event loop open forever on genuinely-empty stores and hung the suite
         runner's child process): five tries ~100s covers hydration, then this
         page load gives up and the next load starts fresh. */
      if (!pts.length) {
        _storeHygieneOnce._tries = (_storeHygieneOnce._tries || 0) + 1;
        if (_storeHygieneOnce._tries <= 5) { try { setTimeout(_storeHygieneOnce, 20000); } catch (eRe) {} }
        return;
      }
      var HDR_ONLY = /^[\s—–-]*(?:Pulled from Athena|Longitudinal summary refreshed)\s+[\d\/.\-]+\s*(?:—|–|-)?\s*$/;
      var winStart = Date.parse('2026-06-24T00:00:00'), winEnd = Date.parse('2026-06-30T00:00:00');
      var dobCounts = {};
      pts.forEach(function (p) {
        if (!p || !p.created || p.created < winStart || p.created >= winEnd) return;
        var d = trim(S(p.dob)); if (d) dobCounts[d] = (dobCounts[d] || 0) + 1;
      });
      var touched = 0;
      pts.forEach(function (p) {
        if (!p) return;
        var dirty = false;
        if (typeof p.athenaHistorySummary === 'string' && HDR_ONLY.test(trim(p.athenaHistorySummary))) { p.athenaHistorySummary = ''; dirty = true; }
        if (typeof p.summary === 'string' && HDR_ONLY.test(trim(p.summary))) { p.summary = ''; dirty = true; }
        (Array.isArray(p.visits) ? p.visits : []).forEach(function (v) {
          if (v && typeof v.aiSummary === 'string' && !v.aiSummary.trim()) { delete v.aiSummary; dirty = true; }
        });
        if (p.created >= winStart && p.created < winEnd && trim(S(p.dob)) && dobCounts[trim(S(p.dob))] >= 5 && !p.athenaImportSuspect) {
          p.athenaImportSuspect = { window: '2026-06-24..2026-06-29', reason: 'shared-dob-cluster', markedAt: new Date().toISOString() };
          dirty = true;
        }
        /* px-2.5.2: bump `updated` on every cleaned record so a
           timestamp-based server-mirror merge PREFERS the cleaned copy and
           pushes it back, instead of restoring the dirty one. */
        if (dirty) { touched++; try { p.updated = Date.now(); } catch (eUp) {} }
      });
      if (touched) {
        /* one bulk write, not N upserts - the store is MLSZ1-compressed and
           re-serializing 1,500+ records per record would stall the page */
        if (typeof window.savePatients === 'function') window.savePatients(pts);
        else pts.forEach(function (p) { try { window.upsertPatient(p); } catch (eU) {} });
      }
      /* px-2.5.2 (measured live on b949's first load): the 4.5s pass raced the
         ASYNC server-mirror hydration - the console said "cleaned 434" while
         the roster the mirror materialized moments later still carried every
         one of them, and the consumed flag made that permanent. The flag is
         now set only after a VERIFY pass ~25s later re-reads the store and
         finds it actually clean; dirt returned means the mirror overwrote us,
         so clean again (bounded rounds). A pass that cleaned nothing verifies
         trivially and flags immediately. */
      if (!touched) {
        try { localStorage.setItem(flagKey, '1'); } catch (eW0) {}
        return;
      }
      console.log('[MLS visits] store hygiene: cleaned ' + touched + ' record(s) (header-only summaries / empty aiSummary keys / import-window suspect markers)');
      _storeHygieneOnce._verifyRounds = (_storeHygieneOnce._verifyRounds || 0) + 1;
      if (_storeHygieneOnce._verifyRounds > 3) {
        /* three clean-then-dirty rounds means something keeps rewriting the
           roster; give up THIS load without consuming the flag - the next
           page load starts fresh rather than recording a false done. */
        try { console.log('[MLS visits] store hygiene: roster kept reverting after 3 rounds - will retry on the next load'); } catch (eL3) {}
        return;
      }
      try { setTimeout(function () {
        try {
          var again = (window.getPatients && window.getPatients()) || [];
          var stillDirty = again.some(function (q) {
            if (!q) return false;
            if (typeof q.athenaHistorySummary === 'string' && HDR_ONLY.test(trim(q.athenaHistorySummary))) return true;
            if (typeof q.summary === 'string' && HDR_ONLY.test(trim(q.summary))) return true;
            if ((Array.isArray(q.visits) ? q.visits : []).some(function (v) { return v && typeof v.aiSummary === 'string' && !v.aiSummary.trim(); })) return true;
            if (q.created >= winStart && q.created < winEnd && trim(S(q.dob)) && dobCounts[trim(S(q.dob))] >= 5 && !q.athenaImportSuspect) return true;
            return false;
          });
          if (stillDirty) { _storeHygieneOnce(); return; }
          try { localStorage.setItem(flagKey, '1'); } catch (eW1) {}
          try { console.log('[MLS visits] store hygiene: verified clean after hydration - done'); } catch (eL2) {}
        } catch (eV) {}
      }, 25000); } catch (eArm) {}
    } catch (e) {}
  }
  try { setTimeout(_storeHygieneOnce, 4500); } catch (eHyg) {}

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
    _collapseExactIndexDuplicates: _collapseExactIndexDuplicates,
    _normVisit: _normVisit,
    _visitKey: _visitKey,
    _normDob: _normDob,
    _svcToYMD: _svcToYMD,
    _cpt: _cpt,
    _icd10: _icd10,
    _SUM_SYS: SUM_SYS,
    _visitToPrompt: _visitToPrompt,
    _sectionValues: _sectionValues,
    _stripPageDebris: _stripPageDebris,
    _aggregateSummary: _aggregateSummary,
    _normalizeClinicalText: _normalizeClinicalText,
    _visitBodyText: _visitBodyText,
    _validVisitSummary: _validVisitSummary,
    _cleanVisitTypeForDisplay: _cleanVisitTypeForDisplay,
    _storeHygieneOnce: _storeHygieneOnce,
    _expandAllergyRun: _expandAllergyRun,
    _expandOnsetRun: _expandOnsetRun,
    _expandMedTableRun: _expandMedTableRun
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

  /* Honest completeness marker for pulled rows. Three trust tiers exist in the
     store (indexOnly shell / unflagged copied excerpt / fullDetail+bodyComplete
     verified body) but the timeline used to render them identically, silently
     presenting an index row as if it were the whole visit. Mark what is MISSING
     only; clinician-authored MLS visits and complete verified bodies stay
     unmarked. */
  function visitProvenance(v) {
    if (!v || !/athena|legacy|grab|pullrec/i.test(S(v.source))) return null;
    if (v.indexOnly === true) return {
      chip: 'index only',
      detail: 'Only the schedule/chart index row was pulled for this visit — the full visit note has not been retrieved. Re-pull this day with visit details ON to fetch it.'
    };
    if (!(v.fullDetail === true && v.bodyComplete === true && trim(v.raw))) {
      /* A pulled row that carries NO text at all is an index shell even when the
         marker was never stamped — saying "a copied excerpt was pulled" would
         claim content that does not exist. */
      if (!trim(v.raw) && !trim(v.textHead)) return {
        chip: 'index only',
        detail: 'Only the schedule/chart index row was pulled for this visit — the full visit note has not been retrieved. Re-pull this day with visit details ON to fetch it.'
      };
      return {
        chip: 'partial',
        detail: 'A copied excerpt was pulled for this visit, not the complete verified note. Re-pull this day with visit details ON to fetch the full note.'
      };
    }
    return null;
  }

  function visitCard(p, v) {
    var card = document.createElement('div'); card.className = 'mlsvh-v'; card.dataset.vid = v.id;
    var head = document.createElement('div'); head.className = 'mlsvh-vh';
    var date = document.createElement('span'); date.className = 'mlsvh-date'; date.textContent = v.date || '(undated)';
    var type = document.createElement('span'); type.className = 'mlsvh-type';
    /* px-2.2: display-clean the type (provider tail, mojibake) - stored value untouched */
    var typeClean = (M() && typeof M()._cleanVisitTypeForDisplay === 'function') ? M()._cleanVisitTypeForDisplay(v.type) : (v.type || '');
    type.textContent = typeClean || (v.aiSummary ? v.aiSummary.split('\n')[0].slice(0, 80) : 'Visit');
    head.appendChild(date); head.appendChild(type);
    head.appendChild(codePills(v));
    var prov = visitProvenance(v);
    if (prov) {
      var pv = document.createElement('span'); pv.className = 'mlsvh-pill mlsvh-prov';
      pv.style.background = '#fff7e6'; pv.style.color = '#8a5a00';
      pv.textContent = prov.chip; pv.title = prov.detail;
      head.appendChild(pv);
    }
    var chev = document.createElement('span'); chev.className = 'mlsvh-chev'; chev.textContent = '▶'; head.appendChild(chev);
    head.addEventListener('click', function () { card.classList.toggle('open'); });
    card.appendChild(head);

    var body = document.createElement('div'); body.className = 'mlsvh-body';
    if (prov) {
      var pvLine = document.createElement('div'); pvLine.className = 'mlsvh-status mlsvh-prov-line';
      pvLine.textContent = prov.detail;
      body.appendChild(pvLine);
    }
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
    if (!force && document.getElementById('mlsVisitHistoryExt')) return;
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

  var bridgeRequestSeq = 0;
  var manualRetryParents = Object.create(null);
  function nextBridgeRequestId(reqType) {
    bridgeRequestSeq = (bridgeRequestSeq + 1) % 1000000;
    var kind = String(reqType || 'request').replace(/^mlsApp/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 18) || 'request';
    var random = '';
    try {
      if (window.crypto && isFn(window.crypto.getRandomValues)) {
        var words = new Uint32Array(2); window.crypto.getRandomValues(words);
        random = words[0].toString(36) + words[1].toString(36);
      }
    } catch (e) {}
    if (!random) random = Math.floor(Math.random() * 0x100000000).toString(36);
    return ('mlscv-' + kind + '-' + Date.now().toString(36) + '-' + bridgeRequestSeq.toString(36) + '-' + random).slice(0, 100);
  }
  function bridgeResponseId(d) {
    if (!d || typeof d !== 'object') return '';
    return String(d.requestId || d.id || (d.resp && (d.resp.requestId || d.resp.id)) || '').slice(0, 100);
  }

  /* A retry is linked only inside one frozen local-patient/action lifecycle.
     This lets the notification owner retire failure A after successful retry B
     without letting an unrelated patient, background batch, or stale result
     clear the warning. The linkage is short-lived and contains no PHI. */
  function manualRetryLifecycleKey(reqType, lifecycle) {
    if (!lifecycle || lifecycle.manual !== true) return '';
    var patientId = S(lifecycle.patientId).trim();
    if (!patientId) return '';
    return (S(lifecycle.action || reqType).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'request') + '|' + patientId.slice(0, 100);
  }
  function retryParentFor(key) {
    var rec = key && manualRetryParents[key];
    if (!rec) return '';
    if ((Date.now() - Number(rec.at || 0)) > 15 * 60 * 1000) { delete manualRetryParents[key]; return ''; }
    return S(rec.requestId).slice(0, 100);
  }

  // Post one uniquely-correlated request, stream only its progress to onStatus,
  // and resolve only its result. A late callback/progress event from an earlier
  // patient can never engage or finish this run.
  function driveRequest(reqType, payload, resultType, progressTypes, onStatus, onEngaged, timeout, engageTimeout, lifecycle) {
    return new Promise(function (resolve, reject) {
      var requestId = nextBridgeRequestId(reqType);
      var lifecycleKey = manualRetryLifecycleKey(reqType, lifecycle);
      var retryOf = retryParentFor(lifecycleKey);
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
        if (bridgeResponseId(d) !== requestId) return;
        if (progressTypes.indexOf(d.type) >= 0) { markEngaged(); if (onStatus) try { onStatus(d.message || d.status || d.text || '', d); } catch (e) {} return; }
        if (d.type === resultType) {
          markEngaged();
          if (d.ok === false || d.error) {
            if (lifecycleKey) manualRetryParents[lifecycleKey] = { requestId: requestId, at: Date.now() };
            var err = new Error(d.error || d.message || 'extension error');
            err.requestId = requestId; err.retryOf = retryOf;
            fin(reject, err);
          } else {
            if (lifecycleKey && retryOf && manualRetryParents[lifecycleKey] && manualRetryParents[lifecycleKey].requestId === retryOf) delete manualRetryParents[lifecycleKey];
            fin(resolve, d);
          }
        }
      }
      window.addEventListener('message', on);
      engTid = setTimeout(function () { if (!engaged) fin(reject, new Error('no-ext')); }, engageTimeout || 6000);
      try {
        var outbound = Object.assign({}, payload || {}, {
          type: reqType, source: 'mls-app', from: 'mls-app', id: requestId, requestId: requestId
        });
        if (retryOf) { outbound.retryOf = retryOf; outbound.parentRequestId = retryOf; }
        window.postMessage(outbound, '*');
      } catch (e) { fin(reject, e); }
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
    var scopedRead = !!(batchReceipt && batchReceipt.onlyDate);
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
    /* 2026-07-28 invariant fix: a DAY-SCOPED read (runOpts.onlyDate) returns
       a complete receipt for ONE day - reconciling it as the verified FULL
       set would let a one-day slice speak for the whole history. Scoped
       saves stay additive; only a genuine every-visit batch reconciles. */
    if (fullBatch && !scopedRead && isFn(M().reconcileVerifiedAthenaVisits)) M().reconcileVerifiedAthenaVisits(p.id, arr);
    return saved;
  }

  // ---- main flow -------------------------------------------------------------
  var running = false;
  function run(onStatus, patientOverride, runOpts) {
    if (running) return Promise.resolve();
    runOpts = runOpts && typeof runOpts === 'object' ? runOpts : {};
    var p = patientOverride || activeP();
    if (!p) { onStatus && onStatus('Open a patient first.'); return Promise.resolve(); }
    /* Freeze the same immutable local-patient target used by the schedule pull.
       The manual profile button must never ask the encounter reader to guess a
       patient from whichever Athena surface happens to be visible. */
    var targetRef = null;
    try {
      if (isFn(window._athenaHistoryTargetSnapshot)) {
        targetRef = window._athenaHistoryTargetSnapshot({
          patientId: S(p.id), name: S(p.name), dob: S(p.dob),
          mrn: S(p.mrn || p.athenaId || p.athenaPatientId || '')
        }, false);
      }
    } catch (eTarget) { targetRef = null; }
    running = true;
    var engaged = false;
    var st = function (m) { try { onStatus && onStatus(m); } catch (e) {} };
    st('Connecting to MLS Assist…');
    return ping(1800).then(function (ok) {
      if (!ok) throw new Error('MLS Assist isn’t responding. If it’s installed, reload it at chrome://extensions (or get the latest from MLS Settings → Get the extension). If it isn’t installed yet, install it there, then try again.');
      if (!targetRef || !S(targetRef.patientId) || (!S(targetRef.dob) && !S(targetRef.mrn || targetRef.athenaId))) {
        throw new Error('Choose one MLS patient with a verified DOB or MRN before copying visits. Name alone is not safe, so nothing was saved.');
      }
      if (!isFn(window._assistReadChart)) {
        throw new Error('The exact-patient Athena chart reader is not available. Refresh MLS and update MLS Assist before retrying. Nothing was saved.');
      }
      st('Opening and verifying the exact patient chart in athenaOne… (read-only)');
      return Promise.resolve(window._assistReadChart(targetRef, function (msg) { if (msg) st(msg); })).then(function (chartReceipt) {
        if (!chartReceipt || S(chartReceipt.targetPatientId) !== S(targetRef.patientId)) {
          throw new Error('Safety stop — Athena did not prove the selected patient chart before the visit read. Nothing was saved.');
        }
        st('Exact patient chart verified. Reading every visit from athenaOne… (read-only)');
        return driveRequest(
          'mlsAppReadAllVisits',
          /* 2026-07-28 owner directive: with "Full visit notes" OFF, the pull
             still saves the pulled day's OWN encounter note (op-notes need
             it). onlyDate scopes the reader to that day; the reader's receipt
             excludes the deliberately skipped rows from its completeness
             arithmetic, so the exact-count gate below still closes. */
          { hint: { name: targetRef.name, dob: targetRef.dob, mrn: targetRef.mrn || targetRef.athenaId || '', onlyDate: String(runOpts.onlyDate || '') } },
          'mlsAppAllVisitsResult',
          ['mlsAppVisitsProgress', 'mlsAppSearchProgress'],
          function (msg) { if (msg) st(msg); },
          function () { engaged = true; },
          240000, 6000,
          { manual: true, action: 'patient-history', patientId: targetRef.patientId }
        ).catch(function (err) {
          // Older extension without all-visits support: repeat the exact chart request.
          if (engaged) throw err;
          st('Reading the verified chart… (basic capture)');
          return driveRequest(
            'mlsAppReadChart', {
              patient: targetRef.name, patientDob: targetRef.dob,
              patientMrn: targetRef.mrn || targetRef.athenaId || '', patientId: targetRef.patientId
            },
            'mlsAppChartResult',
            ['mlsAppChartProgress'],
            function (msg) { if (msg) st(msg); },
            function () { engaged = true; },
            120000, 6000
          ).then(function (d) {
            var chart = d.resp || d.chart || d.result || d;
            if (!chart || chart.ok === false || chart.error) throw new Error((chart && chart.error) || 'Could not re-read the verified chart.');
            return { identity: { name: chart.name || targetRef.name, dob: chart.dob || targetRef.dob, mrn: chart.mrn || chart.athenaId || targetRef.mrn || '' }, visits: (chart.visits || chart.history || []), _fallback: true, _chart: chart };
          });
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
      /* px-3.5 (2026-08-07): the bar SURVIVES a patient switch (it is removed
         only when NO patient is active), so patient A's progress lines - and
         the terminal "N visits on file" receipt - used to paint inside
         patient B's open chart. Every status write now proves the run's
         patient is still the active one. */
      var runPtId = (activeP() || {}).id || '';
      run(function (m) {
        if (S((activeP() || {}).id || '') === S(runPtId)) status.textContent = m;
      }).then(function () { btn.disabled = false; }, function () { btn.disabled = false; });
    });
    bar.appendChild(btn); bar.appendChild(status);
    if (!window.__mlsCvBarSwitchWired) {
      window.__mlsCvBarSwitchWired = true;
      try { window.addEventListener('mls:active-patient-changed', function () { var s = document.querySelector('#mlsCopyVisitsBar .mls-cv-status'); if (s) s.textContent = ''; }); } catch (eSw) {}
    }
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
      /* The extension's frozen saveRef proof (verifiedName/Dob/Mrn observed on
         the exact open chart) is deterministic. When it re-passes the app's
         own identity gate, an AI-parsed chart.name string may not veto the
         save: the parse routinely reformats or truncates names (live
         2026-07-15: 5 exact-identity saves per day pull were blocked by the
         fuzzy name check alone). Callers WITHOUT the deterministic proof
         (legacy grab/bulk) keep the full fail-closed name veto. */
      var refProofVerified = false;
      try {
        var tDob0 = String((name && typeof name === 'object' && name.dob) || (appt && appt.dob) || '');
        var tMrn0 = String((name && typeof name === 'object' && (name.mrn || name.athenaId)) || (appt && (appt.mrn || appt.athenaId)) || '');
        if (name && typeof name === 'object' && targetId && targetName && isFn(window._athenaHistoryProofMatches)) {
          refProofVerified = window._athenaHistoryProofMatches(
            { patientId: targetId, name: targetName, dob: tDob0, mrn: tMrn0 },
            { chartName: String(name.verifiedName || ''), chartDob: String(name.verifiedDob || ''), chartMrn: String(name.verifiedMrn || '') }
          ) === true;
        }
      } catch (eRefProof) { refProofVerified = false; }
      /* IDENTITY GUARD (2026-07-06): a schedule/bulk import once fed ONE open
         chart to EVERY appointment name, filing the same patient's data into
         62 charts. If the chart declares an identity that does not match the
         target name, BLOCK the whole save for that patient. */
      try {
        var cid = chartIdent(chart);
        if (!refProofVerified && chart && cid.name && (!targetName || !namesMatch(cid.name, targetName))) {
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
            var targetMrn = String((name && typeof name === 'object' && (name.mrn || name.athenaId)) || (appt && (appt.mrn || appt.athenaId)) || p.mrn || p.athenaId || '');
            var dobOk = !!(cid2.dob && targetDob && nd(cid2.dob) && nd(cid2.dob) === nd(targetDob));
            var chartIdentityVerified = !!(cid2.name && targetName && namesMatch(cid2.name, targetName) && dobOk);
            /* The deterministic extension identity proof lives on the frozen
               saveRef, not in the AI-parsed chart object. A complete chart parse
               may legitimately omit chart.name/chart.dob while still returning
               dated visit-index shells. Trust those shells only when the exact
               patient saveRef re-passes the same app identity gate that allowed
               the base save. This gives later authoritative full encounter rows
               an immutable binding for date/stable-key shell compaction without
               granting trust to a bare name, a base-return value, or payload data. */
            var saveRefVerified = false;
            try {
              if (name && typeof name === 'object' && targetId && targetName && isFn(window._athenaHistoryProofMatches)) {
                saveRefVerified = window._athenaHistoryProofMatches(
                  { patientId: targetId, name: targetName, dob: targetDob, mrn: targetMrn },
                  { chartName: String(name.verifiedName || ''), chartDob: String(name.verifiedDob || ''), chartMrn: String(name.verifiedMrn || '') }
                ) === true;
              }
            } catch (eProof) { saveRefVerified = false; }
            var identityVerified = saveRefVerified || chartIdentityVerified;
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

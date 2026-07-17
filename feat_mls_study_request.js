/* =============================================================================
 * MLS Scribe natural-language study request surface
 * __mlsStudyRequest sr-2.0.0 (site only, additive, reversible)
 *
 * One sentence is enough: the deterministic parser turns it into a strict
 * StudySpec, the existing __mlsSgFix/__mlsStudyGroups engines build and run the
 * cohort, and the detailed report removes common direct identifiers by default.
 * sr-2.0.0 upgrades the output to an academic-paper structure (abstract,
 * introduction, methods, statistical methods, results with tables + embedded
 * figures, case-level summaries, discussion, limitations, conclusion) drawn
 * from EVERY evidence store in MLS: patient records (incl. demographics, meds,
 * allergies, problems), saved notes, calendar appointments, the Athena
 * harvester, and the practice ICD/CPT code table. When the app's AI transport
 * is available the narrative sections are AI-drafted from the deidentified
 * statistics only, then number-verified so no statistic can be invented; when
 * it is not, deterministic prose is used. Reports use
 * only evidence already stored in MLS. They may be as long as 60 pages when the
 * evidence supports that length; they are never padded or invented.
 * ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    try {
      if (root.__mlsStudyRequest && root.__mlsStudyRequest.installed &&
          typeof root.__mlsStudyRequest.revert === 'function') root.__mlsStudyRequest.revert();
    } catch (e) {}
    root.__mlsStudyRequest = api;
    if (root.document) api.boot();
  }
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var VERSION = 'sr-2.3.0';
  var CSS_ID = 'mlsStudyRequestCss';
  var UI_ID = 'mlsStudyRequest';
  var ADV_ID = 'mlsStudyAdvanced';
  var ADV_BODY_ID = 'mlsStudyAdvancedBody';
  var MAX_REPORT_PAGES = 60;
  var PRIVACY_WARNING = 'Direct identifiers removed where detectable; limited-data study draft requiring clinician and privacy review before use or sharing.';
  var CDN_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  var mountObserver = null, childObserver = null, mountDeadline = null;
  var mountedPro = null, generation = 0, lastQuery = '', lastResult = null, uiRunPromise = null;
  var objectUrls = [];

  function S(v) { return v == null ? '' : String(v); }
  function lower(v) { return S(v).trim().toLowerCase().replace(/\s+/g, ' '); }
  function clamp(n, lo, hi) { n = Number(n); return Math.max(lo, Math.min(hi, isFinite(n) ? n : lo)); }
  function esc(v) {
    return S(v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function escapeRx(v) { return S(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function safeCall(fn, fallback) { try { var v = fn(); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function isoDate(v) {
    var s = S(v).trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
      return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    }
    if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/))) {
      var y = m[3].length === 2 ? '20' + m[3] : m[3];
      return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    }
    try {
      var d = new Date(v);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch (e) {}
    return '';
  }
  function addMonths(date, delta) {
    var d = new Date(date.getTime());
    d.setMonth(d.getMonth() + delta);
    return d;
  }
  function typeLabel(type) {
    return ({
      outcomes: 'Retrospective outcomes',
      volume: 'Visit volume and trends',
      procedure: 'Procedure comparison',
      profile: 'Cohort profile',
      custom: 'Custom evidence review'
    })[type] || 'Custom evidence review';
  }
  function rangeLabel(range) {
    if (!range || range.kind === 'all') return 'All stored dates';
    if (range.kind === 'months') return 'Last ' + range.months + ' months';
    return range.from + ' through ' + range.to;
  }
  function privacyRangeLabel(range) {
    if (!range || range.kind === 'all') return 'All stored months';
    if (range.kind === 'months') return 'Last ' + range.months + ' months';
    var from = S(range.from).slice(0, 7), to = S(range.to).slice(0, 7);
    return from === to ? from : from + ' through ' + to;
  }

  /* ---------------------------- strict StudySpec ---------------------------- */
  var NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    nine: 9, twelve: 12, eighteen: 18, twenty: 20, twentyfour: 24
  };
  function numberToken(v) {
    var k = lower(v).replace(/[\s-]+/g, '');
    return /^\d+$/.test(k) ? Number(k) : (NUMBER_WORDS[k] || 0);
  }
  function stripTrailingStudyLanguage(v) {
    return S(v)
      .replace(/\s+(?:in|during|over)\s+(?:the\s+)?(?:last|past|previous|this)\b[\s\S]*$/i, '')
      .replace(/\s+(?:from|between)\s+\d{4}-\d{1,2}-\d{1,2}[\s\S]*$/i, '')
      .replace(/[,;]?\s+all\s+time\b[\s\S]*$/i, '')
      .replace(/\s+(?:retrospective|outcomes?|volume|trends?|profile|study|report|paper)\b[\s\S]*$/i, '')
      .replace(/\s+(?:up\s+to\s+)?\d{1,3}\s*(?:pages?|pp)\b[\s\S]*$/i, '')
      .replace(/[.,;:]+$/g, '').trim();
  }
  function extractKeywords(query) {
    var q = S(query), hit = '', m;
    var patterns = [
      /patients?\s+who\s+(?:received|got|had|underwent|have|were treated with)\s+([\s\S]+)$/i,
      /patients?\s+(?:with|after|treated for|treated with)\s+([\s\S]+)$/i,
      /cohort\s+(?:with|for|after|of)\s+([\s\S]+)$/i,
      /study\s+(?:of|on)\s+([\s\S]+)$/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      m = q.match(patterns[i]);
      if (m) { hit = stripTrailingStudyLanguage(m[1]); break; }
    }
    if (!hit) return [];
    hit = hit.replace(/^(?:the|a|an)\s+/i, '').trim();
    if (!hit || /^(?:all|every|any)\s+(?:stored\s+)?patients?$/i.test(hit)) return [];
    return hit.split(/\s+(?:versus|vs\.?|compared (?:with|to))\s+/i)
      .map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 1; }).slice(0, 4);
  }
  function parseRange(query, now) {
    var q = lower(query), m, n;
    now = now instanceof Date ? now : new Date();
    m = q.match(/(?:from|between)\s+(\d{4}-\d{1,2}-\d{1,2})\s+(?:to|and|through|thru)\s+(\d{4}-\d{1,2}-\d{1,2})/i);
    if (m) {
      var from = isoDate(m[1]), to = isoDate(m[2]);
      return from <= to ? { kind: 'dates', from: from, to: to } : { kind: 'dates', from: to, to: from };
    }
    m = q.match(/(?:last|past|previous)\s+([a-z\d-]+)\s+months?/i);
    if (m && (n = numberToken(m[1]))) return { kind: 'months', months: clamp(n, 1, 120) };
    m = q.match(/(?:last|past|previous)\s+([a-z\d-]+)\s+years?/i);
    if (m && (n = numberToken(m[1]))) return { kind: 'months', months: clamp(n * 12, 1, 120) };
    if (/\b(?:last|past|previous)\s+year\b/.test(q)) return { kind: 'months', months: 12 };
    if (/\bthis\s+year\b/.test(q)) {
      return { kind: 'dates', from: now.getFullYear() + '-01-01', to: isoDate(now) };
    }
    return { kind: 'all' };
  }
  function parseStudySpec(query, options) {
    options = options || {};
    var original = S(query).trim(), q = lower(original), notes = [];
    if (!original || original.length < 5) {
      return { ok: false, code: 'clarify-request', clarification: 'Describe the patients, question, or time range you want to study.' };
    }
    var specificSignal = /outcome|pain|response|procedure|injection|surgery|visit|trend|volume|profile|demograph|diagnos|cohort|patients?|compare|versus|\bvs\b/i.test(q);
    if (!specificSignal && /^(?:make|build|create|run|generate)?\s*(?:me\s+)?(?:a\s+)?(?:\d+[- ]page\s+)?(?:study|paper)\s*\.?$/i.test(q)) {
      return { ok: false, code: 'clarify-request', clarification: 'What should the study measure, and which patients should it include?' };
    }

    var studyType = 'custom';
    if (/\b(?:compare|comparison|versus|\bvs\.?\b)\b|procedure comparison/.test(q)) studyType = 'procedure';
    else if (/\b(?:outcomes?|improv|response|pain|efficacy|complications?|adverse)\b/.test(q)) studyType = 'outcomes';
    else if (/\b(?:volume|utilization|busiest|visits? over time|trends?)\b/.test(q)) studyType = 'volume';
    else if (/\b(?:profile|demograph|characteristics?|age distribution)\b/.test(q)) studyType = 'profile';

    var keywords = extractKeywords(original), cohortMode = 'auto';
    if (/\b(?:all|every)\s+(?:of\s+)?(?:my\s+)?(?:stored\s+)?patients?\b|\bwhole\s+(?:practice|cohort)\b/i.test(original)) cohortMode = 'all';
    else if (/\b(?:selected|current|existing|this)\s+(?:group|cohort)\b/i.test(original)) cohortMode = 'selected';
    else if (keywords.length) cohortMode = 'keyword';
    if (cohortMode === 'auto') notes.push('Uses the selected cohort when available; otherwise all stored patients.');

    var pageMatch = q.match(/(?:up\s+to\s+|about\s+|around\s+)?(\d{1,3})\s*(?:pages?|pp)\b/);
    /* Default target is a focused ~30-page academic paper; ask for more pages
       explicitly (up to 60) if you want a longer document. Case-level detail
       beyond the cap lives in the Excel export, not in padded PDF pages. */
    var requested = pageMatch ? Number(pageMatch[1]) : 30;
    if (requested > MAX_REPORT_PAGES) notes.push('Detailed reports are capped at ' + MAX_REPORT_PAGES + ' evidence-supported pages.');
    requested = clamp(requested, 2, MAX_REPORT_PAGES);

    var spec = {
      version: 2,
      originalQuery: original,
      question: original,
      cohort: { mode: cohortMode, keywords: keywords },
      studyType: studyType,
      studyTypeLabel: typeLabel(studyType),
      range: parseRange(original, options.now),
      targetPages: requested,
      deidentified: false,
      directIdentifiersRemoved: true,
      limitedDataDraft: true,
      includeIdentifiers: false,
      notes: notes
    };
    var valid = validateStudySpec(spec);
    if (!valid.ok) return valid;
    spec.ok = true;
    return spec;
  }
  function validateStudySpec(spec) {
    var allowed = { outcomes: 1, volume: 1, procedure: 1, profile: 1, custom: 1 };
    var modes = { all: 1, keyword: 1, selected: 1, auto: 1 };
    if (!spec || !allowed[spec.studyType]) return { ok: false, code: 'invalid-study-type', clarification: 'Choose a supported study type.' };
    if (!spec.cohort || !modes[spec.cohort.mode]) return { ok: false, code: 'invalid-cohort', clarification: 'Describe which patients should be included.' };
    if (spec.cohort.mode === 'keyword' && !(spec.cohort.keywords || []).length) return { ok: false, code: 'missing-cohort-term', clarification: 'Name the procedure, diagnosis, or treatment that defines the cohort.' };
    if (!spec.range || !({ all: 1, months: 1, dates: 1 })[spec.range.kind]) return { ok: false, code: 'invalid-range', clarification: 'Use all time, a number of months, or an exact date range.' };
    if (spec.range.kind === 'dates' && (!isoDate(spec.range.from) || !isoDate(spec.range.to))) return { ok: false, code: 'invalid-dates', clarification: 'Use dates in YYYY-MM-DD format.' };
    if (spec.directIdentifiersRemoved !== true || spec.limitedDataDraft !== true || spec.includeIdentifiers !== false) {
      return { ok: false, code: 'privacy-required', clarification: 'Natural-language study reports must remove direct identifiers and remain labeled as limited-data drafts.' };
    }
    return { ok: true };
  }

  /* ------------------------- normalized stored evidence ------------------------ */
  function visitFromRaw(raw, fallbackSource) {
    raw = raw || {};
    var type = S(raw.type || raw.kind || raw.visitType || raw.encounterType || raw.appt_type || raw.cc || 'Visit').trim() || 'Visit';
    var detail = S(raw.detail != null ? raw.detail :
      (raw.note != null ? raw.note : (raw.text != null ? raw.text :
      (raw.soap != null ? raw.soap : (raw.body != null ? raw.body : raw.content)))))
      .replace(/\s+/g, ' ').trim();
    if (!detail && (raw.reason || raw.provider || raw.status)) {
      detail = 'Reason: ' + S(raw.reason || 'not recorded') +
        (raw.provider ? ' | Provider: ' + S(raw.provider).replace(/Close$/, '').replace(/_/g, ' ') : '') +
        (raw.status ? ' | Status: ' + S(raw.status) : '');
    }
    return {
      date: isoDate(raw.date || raw.visitDate || raw.encounterDate || raw.appt_date || raw.created || ''),
      type: type,
      detail: detail,
      source: S(raw.source || fallbackSource || 'stored').trim() || 'stored'
    };
  }
  function visitKey(v) {
    return [v.date, lower(v.type), lower(v.detail)].join('|');
  }
  function normalizeSex(v) {
    var s = lower(v);
    if (!s) return '';
    if (/^m(?:ale)?$/.test(s)) return 'male';
    if (/^f(?:emale)?$/.test(s)) return 'female';
    if (/^(?:other|nonbinary|non-binary|nb|x)$/.test(s)) return 'other';
    return '';
  }
  function listFromRaw(v) {
    if (v == null) return [];
    if (Object.prototype.toString.call(v) === '[object Array]') {
      return v.map(function (x) {
        if (x && typeof x === 'object') return S(x.name || x.drug || x.text || x.desc || x.value).trim();
        return S(x).trim();
      }).filter(Boolean);
    }
    return S(v).split(/[;,\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function mergeList(target, incoming) {
    (incoming || []).forEach(function (item) {
      var probe = lower(item);
      if (!probe) return;
      var have = target.some(function (known) { return lower(known) === probe; });
      if (!have && target.length < 60) target.push(item);
    });
  }
  function collectStoredRecords(env) {
    env = env || root;
    var getPatients = typeof env.getPatients === 'function' ? env.getPatients : root.getPatients;
    var getNotes = typeof env.getNotes === 'function' ? env.getNotes : root.getNotes;
    var appointments = env._calAppts || root._calAppts || [];
    var fix = env.sgFix || env.__mlsSgFix || root.__mlsSgFix;
    var sourcePatients = safeCall(function () { return typeof getPatients === 'function' ? getPatients() : []; }, []);
    var notes = safeCall(function () { return typeof getNotes === 'function' ? getNotes() : []; }, []);
    var patients = [], byStable = {}, byDemo = {}, duplicateVisits = 0;
    var ambiguousRecordsSkipped = 0, identityConflicts = 0;

    function stableRef(namespace, value) {
      value = lower(value);
      return value ? namespace + ':' + value : '';
    }
    function stableRefs(raw, options) {
      if (options && options.projection) return [];
      raw = raw || {};
      return [stableRef('id', raw.id), stableRef('athena', raw.athenaId), stableRef('mrn', raw.mrn)].filter(Boolean);
    }
    function demoKey(name, dob) { return name && dob ? lower(name) + '|' + dob : ''; }
    function registerStable(rec, refs) {
      (refs || []).forEach(function (ref) { byStable[ref] = rec; rec._stableRefs[ref] = 1; });
    }
    function registerDemo(rec, name, dob) {
      var key = demoKey(name, dob); if (!key || rec._demoKeys[key]) return;
      rec._demoKeys[key] = 1; (byDemo[key] = byDemo[key] || []).push(rec);
    }
    function makePatient(raw, name, dob, refs) {
      if (!name) { ambiguousRecordsSkipped++; return null; }
      var rec = {
        name: name, dob: dob, mrn: S(raw.mrn || '').trim(), visits: [], _visitKeys: {},
        sex: '', meds: [], allergies: [], problems: '',
        _chartText: '', _stableRefs: {}, _demoKeys: {}
      };
      patients.push(rec); registerStable(rec, refs); registerDemo(rec, name, dob); return rec;
    }
    function stableNamespaceConflict(rec, refs) {
      var existing = Object.keys(rec && rec._stableRefs || {});
      return (refs || []).some(function (ref) {
        var ns = ref.split(':')[0] + ':';
        var inNamespace = existing.filter(function (known) { return known.indexOf(ns) === 0; });
        return inNamespace.length > 0 && inNamespace.indexOf(ref) < 0;
      });
    }
    function directIdentityConflict(rec, raw, name, dob, refs) {
      if (!rec) return false;
      if (stableNamespaceConflict(rec, refs)) return true;
      if (name && rec.name && lower(name) !== lower(rec.name)) return true;
      if (dob && rec.dob && dob !== rec.dob) return true;
      var incomingMrn = lower(raw && raw.mrn), existingMrn = lower(rec.mrn);
      if (incomingMrn && existingMrn && incomingMrn !== existingMrn) return true;
      return false;
    }
    function locate(raw, options) {
      raw = raw || {};
      var name = S(raw.name || raw.patientName || raw.patient).trim();
      var dob = isoDate(raw.dob || raw.dateOfBirth || '');
      var refs = stableRefs(raw, options), stableCandidates = [];
      refs.forEach(function (ref) {
        var found = byStable[ref];
        if (found && stableCandidates.indexOf(found) < 0) stableCandidates.push(found);
      });
      if (stableCandidates.length > 1) { identityConflicts++; return null; }
      var rec = stableCandidates[0] || null;
      if (rec) {
        /* A stable ref is necessary but not sufficient: a reused/corrupt id
           must never collapse two directly conflicting identities. Quarantine
           the incoming row and disclose the conflict in report provenance. */
        if (directIdentityConflict(rec, raw, name, dob, refs)) { identityConflicts++; return null; }
        registerStable(rec, refs); registerDemo(rec, name, dob);
      } else {
        var demos = demoKey(name, dob) ? (byDemo[demoKey(name, dob)] || []) : [];
        if (options && options.projection) {
          /* __mlsSgFix.buildAll is a derived projection. Its `mrn` field can
             contain either an MRN or the app patient id, so it is intentionally
             not cross-namespaced. Only an exact, unique name+DOB pair may adopt
             its harvested visits; duplicate demographics are skipped. */
          if (demos.length !== 1) { ambiguousRecordsSkipped++; return null; }
          rec = demos[0];
        } else if (refs.length) {
          if (demos.length === 1 && Object.keys(demos[0]._stableRefs).length === 0) {
            rec = demos[0]; registerStable(rec, refs);
          } else {
            /* A new namespace-qualified identifier is not allowed to collapse
               into a differently identified same-name/same-DOB record. */
            rec = makePatient(raw, name, dob, refs);
          }
        } else {
          if (!name || !dob) { ambiguousRecordsSkipped++; return null; } // never name-only
          if (demos.length > 1) { ambiguousRecordsSkipped++; return null; }
          rec = demos.length === 1 ? demos[0] : makePatient(raw, name, dob, []);
        }
      }
      if (rec) {
        if (!rec.dob && dob) rec.dob = dob;
        if (!rec.mrn && raw.mrn) rec.mrn = S(raw.mrn).trim();
        if (!rec.sex) rec.sex = normalizeSex(raw.sex || raw.gender);
        mergeList(rec.meds, listFromRaw(raw.meds || raw.medications));
        mergeList(rec.allergies, listFromRaw(raw.allergies));
        if (raw.problems) rec.problems = (rec.problems ? rec.problems + ' | ' : '') + S(raw.problems).replace(/\s+/g, ' ').trim();
        registerDemo(rec, name, dob);
        rec._chartText += ' ' + S(raw.problems || '') + ' ' + S(raw.summary || '');
      }
      return rec;
    }
    function addVisit(rec, raw, source) {
      if (!rec) return;
      var v = visitFromRaw(raw, source);
      if (!v.date && !v.detail && !v.type) return;
      var key = visitKey(v);
      if (rec._visitKeys[key]) { duplicateVisits++; return; }
      rec._visitKeys[key] = 1;
      rec.visits.push(v);
    }

    sourcePatients.forEach(function (p) {
      var rec = locate(p);
      (p && (p.visits || p.history || p.encounters) || []).forEach(function (v) { addVisit(rec, v, v.source || 'patient-record'); });
      (p && p.notes || []).forEach(function (v) { addVisit(rec, v, v.source || 'patient-note'); });
    });

    /* __mlsSgFix is the authoritative app harvester (saved notes, pulled
       Athena per-visit bullets, and calendar). Direct sources above/below fill
       fields the harvester may not know, while the visit key prevents copies. */
    var fixed = safeCall(function () { return fix && typeof fix.buildAll === 'function' ? fix.buildAll() : []; }, []);
    fixed.forEach(function (p) {
      var rec = locate(p, { projection: true });
      (p.visits || p.history || []).forEach(function (v) { addVisit(rec, v, v.source || 'mls-harvester'); });
    });

    notes.forEach(function (n) {
      var rec = locate({ id: n && n.patientId, name: n && (n.patientName || n.patient || n.name), dob: n && n.dob });
      addVisit(rec, n, n && n.source || 'mls-note');
    });
    (appointments || []).forEach(function (a) {
      var rec = locate({ name: a && a.name, dob: a && a.dob, id: a && a.patientId });
      addVisit(rec, a, a && a.source || 'mls-appt');
    });

    patients = patients.map(function (p) {
      p.visits.sort(function (a, b) { return (a.date || '').localeCompare(b.date || '') || a.type.localeCompare(b.type); });
      delete p._visitKeys;
      delete p._stableRefs;
      delete p._demoKeys;
      return p;
    }).sort(function (a, b) { return lower(a.name).localeCompare(lower(b.name)); });
    var sources = {}, visits = 0, undated = 0;
    patients.forEach(function (p) {
      p.visits.forEach(function (v) { visits++; if (!v.date) undated++; sources[v.source] = (sources[v.source] || 0) + 1; });
    });
    return { patients: patients, provenance: {
      sources: sources, visits: visits, undated: undated, duplicateVisitsRemoved: duplicateVisits,
      ambiguousRecordsSkipped: ambiguousRecordsSkipped, identityConflicts: identityConflicts
    } };
  }

  function groupToRecords(group) {
    var patients = [], sources = {}, visits = 0, dup = 0;
    (group && group.patients || []).forEach(function (p) {
      var out = { name: S(p.name), dob: isoDate(p.dob), mrn: S(p.mrn), sex: normalizeSex(p.sex || p.gender),
        meds: listFromRaw(p.meds), allergies: listFromRaw(p.allergies), problems: S(p.problems || ''),
        visits: [], _chartText: '' }, seen = {};
      (p.visits || p.history || []).forEach(function (raw) {
        var v = visitFromRaw(raw, raw.source || 'study-group'), k = visitKey(v);
        if (seen[k]) { dup++; return; }
        seen[k] = 1; out.visits.push(v); visits++; sources[v.source] = (sources[v.source] || 0) + 1;
      });
      patients.push(out);
    });
    return { patients: patients, provenance: { sources: sources, visits: visits, undated: 0, duplicateVisitsRemoved: dup } };
  }
  function searchTokens(value) {
    value = lower(value)
      .replace(/\bl[\s-]*spine\b/g, ' lumbar ')
      .replace(/\bc[\s-]*spine\b/g, ' cervical ')
      .replace(/\bt[\s-]*spine\b/g, ' thoracic ')
      .replace(/\blumbosacral\b/g, ' lumbar ')
      /* procedure abbreviations expand to their canonical phrase on BOTH the
         query side and the chart side, so "LESI" documentation matches a
         "lumbar epidural steroid injection" request and vice versa. */
      .replace(/\blesi\b/g, ' lumbar epidural injection ')
      .replace(/\bcesi\b/g, ' cervical epidural injection ')
      .replace(/\btesi\b/g, ' thoracic epidural injection ')
      .replace(/\besi\b/g, ' epidural injection ')
      .replace(/\btpi\b/g, ' trigger point injection ')
      .replace(/\brfa\b/g, ' radiofrequency ablation ')
      .replace(/\brhizotomy\b/g, ' radiofrequency ablation ')
      .replace(/\bmbb\b/g, ' medial branch block ')
      .replace(/\b(?:sij|si joint)\b/g, ' sacroiliac joint ')
      /* named/brand corticosteroids and "cortisone" all normalize to steroid */
      .replace(/\b(?:cortisone|corticosteroid|kenalog|triamcinolone|depo[\s-]*medrol|methylprednisolone|dexamethasone|betamethasone|celestone)\b/g, ' steroid ')
      /* "epidural steroid injection" and "epidural injection" are the same
         procedure family in charts; drop the optional steroid token so
         neither side fails on it. */
      .replace(/\bepidural\s+steroid\s+injections?\b/g, ' epidural injection ')
      .replace(/\bsteroid\s+epidural\s+injections?\b/g, ' epidural injection ')
      .replace(/\bshots?\b/g, ' injection ')
      .replace(/\b(?:injected|injecting|injections?)\b/g, ' injection ');
    return value.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean).map(function (word) {
      if (word.length > 5 && /ies$/.test(word)) return word.slice(0, -3) + 'y';
      if (word.length > 4 && /s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
      return word;
    });
  }
  function tokenSatisfied(bag, token) {
    if (bag[token]) return true;
    /* Clinical equivalence: charts often document "lumbar epidural with
       Kenalog" without the word "injection" — an epidural IS an injection,
       as are documented blocks and ablations. Only the generic delivery
       token is relaxed; anatomic and procedure tokens must match exactly. */
    if (token === 'injection') return !!(bag.epidural || bag.block || bag.ablation);
    return false;
  }
  function keywordMatch(patient, terms) {
    /* Cohort membership requires the whole term to be documented within ONE
       visit record (or within the stored problem/chart summary alone) — a
       patient-wide token bag would include a knee-arthritis patient in a
       "knee injection" cohort because an unrelated visit mentions an
       injection elsewhere. */
    return (terms || []).some(function (term) {
      var wanted = searchTokens(term);
      if (!wanted.length) return false;
      var hit = (patient.visits || []).some(function (v) { return recordMentions(v, term); });
      if (hit) return true;
      var chartBag = {};
      searchTokens(S(patient._chartText)).forEach(function (token) { chartBag[token] = 1; });
      return wanted.every(function (token) { return tokenSatisfied(chartBag, token); });
    });
  }
  var MENTION_WINDOW = 12;
  function recordMentions(record, term) {
    var tokens = searchTokens(S(record.type) + ' ' + S(record.detail));
    var wanted = searchTokens(term);
    if (!wanted.length) return false;
    var positions = {};
    tokens.forEach(function (token, index) { (positions[token] = positions[token] || []).push(index); });
    function positionsFor(token) {
      var own = positions[token] || [];
      if (token !== 'injection') return own;
      /* same clinical equivalence as tokenSatisfied: an epidural/block/
         ablation token is itself the injection mention. */
      return own.concat(positions.epidural || [], positions.block || [], positions.ablation || []);
    }
    var lists = [], distinct = {};
    for (var w = 0; w < wanted.length; w++) {
      if (distinct[wanted[w]]) continue;
      distinct[wanted[w]] = 1;
      var pos = positionsFor(wanted[w]);
      if (!pos.length) return false;
      lists.push(pos);
    }
    if (lists.length === 1) return true;
    /* Multi-token terms must sit close together in ONE phrase: "epidural
       injection ... assessment: knee osteoarthritis" is not a knee injection.
       Sliding minimal-window over the merged position lists. */
    var events = [];
    lists.forEach(function (pos, listIndex) {
      pos.forEach(function (p) { events.push([p, listIndex]); });
    });
    events.sort(function (a, b) { return a[0] - b[0]; });
    var need = lists.length, have = 0, counts = {}, left = 0;
    for (var right = 0; right < events.length; right++) {
      var addList = events[right][1];
      counts[addList] = (counts[addList] || 0) + 1;
      if (counts[addList] === 1) have++;
      while (have === need) {
        if (events[right][0] - events[left][0] < MENTION_WINDOW) return true;
        var dropList = events[left][1];
        counts[dropList]--;
        if (!counts[dropList]) have--;
        left++;
      }
    }
    return false;
  }
  /* Per-patient proof of cohort membership for keyword (procedure) cohorts:
     which visits documented the requested term, and where the pain evidence
     sits relative to the FIRST documented matching visit (the index visit). */
  function cohortMatchEvidence(patients, terms) {
    terms = (terms || []).map(function (term) { return S(term).trim(); }).filter(Boolean);
    var rows = [], anchored = [], chartOnly = 0;
    (patients || []).forEach(function (p) {
      var matches = [];
      (p.visits || []).forEach(function (v) {
        if (terms.some(function (term) { return recordMentions(v, term); })) matches.push(v);
      });
      var datedMatches = matches.filter(function (v) { return v.date; })
        .sort(function (a, b) { return a.date.localeCompare(b.date); });
      var indexDate = datedMatches.length ? datedMatches[0].date : '';
      var code = p.code || p.name;
      if (!matches.length) chartOnly++;
      rows.push({
        code: code,
        matchingVisits: matches.length,
        totalVisits: (p.visits || []).length,
        firstMatched: indexDate,
        lastMatched: datedMatches.length ? datedMatches[datedMatches.length - 1].date : '',
        chartTextOnly: !matches.length
      });
      if (!indexDate) return;
      var baseline = null, post = null;
      (p.visits || []).forEach(function (v) {
        var score = documentedPainScore(v);
        if (score == null || !v.date) return;
        if (v.date <= indexDate && (!baseline || v.date >= baseline.date)) baseline = { date: v.date, score: score };
        if (v.date > indexDate && (!post || v.date >= post.date)) post = { date: v.date, score: score };
      });
      if (baseline && post) anchored.push({ code: code, baseline: baseline.score, post: post.score, change: post.score - baseline.score });
    });
    return { rows: rows, anchored: anchored, chartTextOnly: chartOnly, terms: terms };
  }
  function documentedPainScore(record) {
    var match = S(record && record.detail).match(/\bpain[^0-9]{0,14}(10|[0-9])\s*(?:\/\s*10)?\b/i);
    return match ? Number(match[1]) : null;
  }
  function buildComparisonCohorts(patients, terms) {
    terms = (terms || []).map(function (term) { return S(term).trim(); }).filter(Boolean);
    var groups = terms.map(function (label, index) {
      return {
        id: 'comparison-' + (index + 1), label: label, patientCount: 0,
        matchingVisitCount: 0, includedVisitCount: 0, patientCodes: [],
        documentedPainScoreCount: 0, meanDocumentedPainScore: null,
        pairedPainPatientCount: 0, meanFirstToLastPainChange: null,
        painChangeSamples: [],
        _painScores: []
      };
    });
    var membership = {}, overlapPatients = 0, unmatchedPatients = 0;
    (patients || []).forEach(function (patient) {
      var hitGroups = {}, hitsByGroup = {};
      (patient.visits || []).forEach(function (visit) {
        terms.forEach(function (term, index) {
          if (recordMentions(visit, term)) {
            hitGroups[index] = 1;
            hitsByGroup[index] = (hitsByGroup[index] || 0) + 1;
          }
        });
      });
      var indexes = Object.keys(hitGroups).map(Number);
      var code = patient.code || patient.name;
      if (indexes.length === 1) {
        var group = groups[indexes[0]];
        group.patientCount++;
        group.matchingVisitCount += hitsByGroup[indexes[0]] || 0;
        group.includedVisitCount += (patient.visits || []).length;
        group.patientCodes.push(code);
        var datedScores = [];
        (patient.visits || []).forEach(function (visit) {
          var score = documentedPainScore(visit);
          if (score == null) return;
          group._painScores.push(score);
          if (visit.date) datedScores.push({ date: visit.date, score: score });
        });
        datedScores.sort(function (a, b) { return a.date.localeCompare(b.date); });
        if (datedScores.length >= 2 && datedScores[0].date < datedScores[datedScores.length - 1].date) {
          group.painChangeSamples.push(datedScores[datedScores.length - 1].score - datedScores[0].score);
        }
        membership[code] = group.label;
      } else if (indexes.length > 1) {
        overlapPatients++;
        membership[code] = 'Overlap - excluded from mutually exclusive comparison';
      } else {
        unmatchedPatients++;
        membership[code] = 'Unmatched - excluded from comparison';
      }
    });
    groups.forEach(function (group) {
      group.meanIncludedVisitsPerPatient = group.patientCount ? group.includedVisitCount / group.patientCount : null;
      group.documentedPainScoreCount = group._painScores.length;
      group.meanDocumentedPainScore = group._painScores.length ? mean(group._painScores) : null;
      group.pairedPainPatientCount = group.painChangeSamples.length;
      group.meanFirstToLastPainChange = group.painChangeSamples.length ? mean(group.painChangeSamples) : null;
      delete group._painScores;
    });
    return {
      mutuallyExclusive: true,
      groups: groups,
      membership: membership,
      overlapPatients: overlapPatients,
      unmatchedPatients: unmatchedPatients
    };
  }
  function applyScope(records, spec, now) {
    now = now instanceof Date ? now : new Date();
    var range = spec.range || { kind: 'all' }, from = '', to = '';
    if (range.kind === 'months') { from = isoDate(addMonths(now, -range.months)); to = isoDate(now); }
    if (range.kind === 'dates') { from = isoDate(range.from); to = isoDate(range.to); }
    var excludedUndated = 0, excludedOutOfRange = 0;
    var selected = (records.patients || []).filter(function (p) {
      return spec.cohort.mode !== 'keyword' || keywordMatch(p, spec.cohort.keywords);
    }).map(function (p) {
      var copy = { name: p.name, dob: p.dob, mrn: p.mrn, sex: p.sex || '', meds: (p.meds || []).slice(),
        allergies: (p.allergies || []).slice(), problems: S(p.problems || ''), _chartText: p._chartText, visits: [] };
      (p.visits || []).forEach(function (v) {
        if (range.kind === 'all') { copy.visits.push(v); return; }
        if (!v.date) { excludedUndated++; return; }
        if ((from && v.date < from) || (to && v.date > to)) { excludedOutOfRange++; return; }
        copy.visits.push(v);
      });
      return copy;
    });
    /* A dated study cohort is defined by evidence in that date window. For an
       all-time profile, keep stored patients with zero visits and disclose it. */
    if (range.kind !== 'all') selected = selected.filter(function (p) { return p.visits.length; });
    var visitCount = selected.reduce(function (n, p) { return n + p.visits.length; }, 0);
    return {
      patients: selected,
      provenance: records.provenance || { sources: {} },
      scope: { from: from, to: to, rangeLabel: rangeLabel(range), excludedUndated: excludedUndated, excludedOutOfRange: excludedOutOfRange },
      patientCount: selected.length,
      visitCount: visitCount
    };
  }

  /* ------------------------------- privacy -------------------------------- */
  function generalizeDate(value) {
    var iso = isoDate(value);
    return iso ? iso.slice(0, 7) : '';
  }
  function redactNameVariants(out, name) {
    var tokens = S(name).match(/[A-Za-z][A-Za-z'\-]*/g) || [];
    if (tokens.length < 2) return out;
    var first = tokens[0], last = tokens[tokens.length - 1];
    try {
      var rx = new RegExp('\\b' + escapeRx(first) + '(?:\\s+[A-Za-z][A-Za-z.\'\-]*){0,2}\\s+' + escapeRx(last) + '\\b', 'gi');
      return out.replace(rx, '[name redacted]');
    } catch (e) { return out; }
  }
  function redactDobVariants(out, dob) {
    var iso = isoDate(dob); if (!iso) return out;
    var parts = iso.split('-'), y = parts[0], m = Number(parts[1]), d = Number(parts[2]);
    var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var forms = [
      y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2),
      y + '/' + ('0' + m).slice(-2) + '/' + ('0' + d).slice(-2),
      ('0' + m).slice(-2) + '/' + ('0' + d).slice(-2) + '/' + y,
      m + '/' + d + '/' + y,
      ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2) + '-' + y,
      m + '-' + d + '-' + y,
      monthNames[m - 1] + ' ' + d + ', ' + y,
      monthNames[m - 1].slice(0, 3) + ' ' + d + ', ' + y
    ];
    forms.forEach(function (form) { out = out.replace(new RegExp(escapeRx(form), 'gi'), '[DOB redacted]'); });
    return out;
  }
  function deidentifyText(text, identities) {
    var out = S(text);
    (identities || []).forEach(function (id) {
      var values = [id && id.name, id && id.dob, id && id.mrn];
      values.forEach(function (v) {
        v = S(v).trim();
        /* junk identity values (a real store contained a patient literally
           named "a") must never shred the whole document: require length >= 4
           and whole-word boundaries for the blanket replacement. Multi-word
           name forms are additionally handled by redactNameVariants below. */
        if (!v || v.length < 4) return;
        try { out = out.replace(new RegExp('\\b' + escapeRx(v) + '\\b', 'gi'), '[redacted]'); } catch (e) {}
      });
      out = redactNameVariants(out, id && id.name);
      out = redactDobVariants(out, id && id.dob);
    });
    return out
      .replace(/\b(?:DOB|date of birth)\s*[:#-]?\s*\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}\b/gi, 'DOB [redacted]')
      .replace(/\bMRN\s*[:#-]?\s*[A-Z0-9-]{3,}\b/gi, 'MRN [redacted]')
      .replace(/\b(?:SSN|social security(?: number)?)\s*[:#-]?\s*\d{3}[- ]?\d{2}[- ]?\d{4}\b/gi, 'SSN [redacted]')
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN redacted]')
      .replace(/\b\d{1,6}\s+(?:[A-Z0-9.'\-]+\s+){0,6}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Way|Parkway|Pkwy|Highway|Hwy)\b(?:\s+(?:Apt|Apartment|Unit|Suite|Ste)\s*[A-Z0-9-]+)?(?:,\s*[A-Z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/gi, '[address redacted]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
      .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[phone redacted]')
      /* any explicitly labeled patient name (covers OTHER patients referenced
         inside this patient's text, e.g. a pasted op report) */
      .replace(/\bPatient\s*:\s*[A-Z][A-Za-z'’-]+\s*,\s*[A-Z][A-Za-z'’-]+/g, 'Patient: [name redacted]')
      .replace(/\b(\d{4})[\/-](\d{1,2})[\/-]\d{1,2}\b/g, function (_, y, m) { return y + '-' + ('0' + m).slice(-2); })
      .replace(/\b(\d{1,2})[\/-]\d{1,2}[\/-](\d{4})\b/g, function (_, m, y) { return y + '-' + ('0' + m).slice(-2); })
      .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi, '$1 $2');
  }
  function ageYearsAt(dob, refIso) {
    var d = isoDate(dob), r = isoDate(refIso);
    if (!d || !r) return null;
    var years = Number(r.slice(0, 4)) - Number(d.slice(0, 4));
    if (r.slice(5) < d.slice(5)) years--;
    /* HIPAA limited-data convention: ages 90 and above are grouped. */
    if (years >= 90) return 90;
    return years >= 0 && years < 130 ? years : null;
  }
  function deidentifyPatients(patients, now) {
    var nowIso = isoDate(now instanceof Date ? now : new Date());
    return (patients || []).map(function (p, i) {
      /* Scrub each visit against ITS OWN patient's identity plus the generic
         identifier patterns (incl. the labeled "Patient: Name," rule above).
         Scrubbing every visit against EVERY cohort identity is O(n^2) regex
         work — it froze the browser for minutes on a 1,400-patient cohort. */
      var ids = [{ name: p.name, dob: p.dob, mrn: p.mrn }];
      var code = 'P' + ('000' + (i + 1)).slice(-3);
      var lastDated = '';
      (p.visits || []).forEach(function (v) { var d = isoDate(v.date); if (d && d > lastDated) lastDated = d; });
      return {
        code: code,
        name: code,
        dob: '',
        mrn: '',
        ageYears: ageYearsAt(p.dob, lastDated || nowIso),
        sex: normalizeSex(p.sex),
        meds: (p.meds || []).map(function (m) { return deidentifyText(m, ids); }).filter(Boolean).slice(0, 40),
        allergies: (p.allergies || []).map(function (a) { return deidentifyText(a, ids); }).filter(Boolean).slice(0, 40),
        problems: deidentifyText(S(p.problems || '').slice(0, 400), ids),
        visits: (p.visits || []).map(function (v) {
          return { date: generalizeDate(v.date), type: deidentifyText(v.type, ids), detail: deidentifyText(v.detail, ids), source: deidentifyText(v.source, ids) };
        })
      };
    });
  }

  /* ---------------------------- descriptive statistics ---------------------------- */
  function countBy(items, getter) {
    var out = {};
    (items || []).forEach(function (x) { var k = S(getter(x) || 'Not recorded'); out[k] = (out[k] || 0) + 1; });
    return out;
  }
  function topCounts(map, limit) {
    return Object.keys(map || {}).map(function (k) { return [k, map[k]]; })
      .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); }).slice(0, limit || 12);
  }
  function mean(nums) { return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null; }
  function median(nums) {
    if (!nums.length) return null;
    var sorted = nums.slice().sort(function (a, b) { return a - b; }), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function sampleSd(nums) {
    if (nums.length < 2) return null;
    var m = mean(nums), ss = 0;
    nums.forEach(function (x) { ss += (x - m) * (x - m); });
    return Math.sqrt(ss / (nums.length - 1));
  }
  /* two-sided critical t values (95%) for small df; 1.96 beyond the table. */
  var T_CRIT_95 = [0, 12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23,
    2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09,
    2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05, 2.04];
  function tCrit95(df) {
    df = Math.max(1, Math.round(df));
    return df <= 30 ? T_CRIT_95[df] : 1.96;
  }
  function ci95(nums) {
    if (nums.length < 2) return null;
    var m = mean(nums), s = sampleSd(nums);
    if (s == null) return null;
    var half = tCrit95(nums.length - 1) * s / Math.sqrt(nums.length);
    return { mean: m, low: m - half, high: m + half, n: nums.length, sd: s };
  }
  function normalCdf(z) {
    /* Abramowitz & Stegun 26.2.17 */
    var sign = z < 0 ? -1 : 1, x = Math.abs(z) / Math.sqrt(2);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
  }
  function tApproxP(t, df) {
    /* normal approximation to the t distribution; adequate for a labeled
       descriptive draft and dependency-free. */
    if (!isFinite(t) || !isFinite(df) || df <= 0) return null;
    var z = Math.abs(t) * (1 - 1 / (4 * df)) / Math.sqrt(1 + (t * t) / (2 * df));
    var p = 2 * (1 - normalCdf(z));
    return Math.max(0, Math.min(1, p));
  }
  function welchTTest(a, b) {
    if (!a || !b || a.length < 2 || b.length < 2) return null;
    var ma = mean(a), mb = mean(b), sa = sampleSd(a), sb = sampleSd(b);
    if (sa == null || sb == null) return null;
    var va = (sa * sa) / a.length, vb = (sb * sb) / b.length;
    if (va + vb === 0) return null;
    var t = (ma - mb) / Math.sqrt(va + vb);
    var df = Math.pow(va + vb, 2) / ((va * va) / (a.length - 1) + (vb * vb) / (b.length - 1));
    return { t: t, df: df, p: tApproxP(t, df), meanA: ma, meanB: mb, nA: a.length, nB: b.length };
  }
  function fmt(n, digits) {
    if (n == null || !isFinite(n)) return 'not available';
    return Number(n).toFixed(digits == null ? 1 : digits);
  }
  function fmtP(p) {
    if (p == null || !isFinite(p)) return 'not available';
    if (p < 0.001) return '<0.001';
    return p.toFixed(3);
  }

  /* ------------------ practice code table (ICD/CPT) evidence ------------------ */
  function collectCodeSignals(visits, env) {
    env = env || root;
    var table = env.__mlsCodeTable || root.__mlsCodeTable;
    var entries = safeCall(function () {
      if (!table || typeof table.load !== 'function') return [];
      var loaded = table.load();
      return (loaded && loaded.entries) || [];
    }, []);
    if (!entries.length) return null;
    var rows = [];
    entries.slice(0, 400).forEach(function (entry) {
      var desc = S(entry && entry.desc).trim(), code = S(entry && entry.code).trim();
      if (!desc || !code) return;
      var hits = 0;
      (visits || []).forEach(function (v) { if (recordMentions(v, desc)) hits++; });
      if (hits > 0) rows.push({ code: code, desc: desc, kind: S(entry.kind || '').toUpperCase() || 'CODE', count: hits });
    });
    rows.sort(function (a, b) { return b.count - a.count || a.code.localeCompare(b.code); });
    return rows.length ? rows.slice(0, 40) : null;
  }

  /* -------------------- evidence-grounded academic report -------------------- */
  function meaningfulQuestionTerms(question) {
    var stop = { build:1, create:1, generate:1, study:1, report:1, patient:1, patients:1, cohort:1,
      stored:1, evidence:1, pages:1, page:1, last:1, past:1, month:1, months:1, year:1, years:1,
      from:1, through:1, with:1, without:1, who:1, what:1, when:1, where:1, which:1, were:1,
      have:1, had:1, received:1, compare:1, versus:1, outcomes:1, outcome:1, retrospective:1,
      this:1, that:1, these:1, those:1, their:1, them:1, then:1, than:1, into:1, about:1, paper:1,
      make:1, every:1, single:1, give:1, show:1, want:1, need:1, please:1, also:1, using:1, include:1, data:1 };
    var seen = {}, out = [];
    searchTokens(question).forEach(function (term) {
      if (term.length < 4 || stop[term] || /^\d+$/.test(term) || seen[term]) return;
      seen[term] = 1; out.push(term);
    });
    return out.slice(0, 10);
  }
  var MED_LIST_ARTIFACT = /^(?:date|name|surescripts|check now|status|source|sig|qty|quantity|refills?|start|stop|unknown|none|active|inactive|medications?|list|dose|directions|notes?)$/;
  function demographicsSummary(patients) {
    var ages = [], sexCounts = { male: 0, female: 0, other: 0, 'not recorded': 0 };
    var medCounts = {}, allergyCounts = {}, withMeds = 0, withAllergies = 0, withProblems = 0;
    (patients || []).forEach(function (p) {
      if (p.ageYears != null) ages.push(p.ageYears);
      sexCounts[p.sex || 'not recorded'] = (sexCounts[p.sex || 'not recorded'] || 0) + 1;
      if ((p.meds || []).length) withMeds++;
      if ((p.allergies || []).length) withAllergies++;
      if (S(p.problems).trim()) withProblems++;
      /* sr-2.3.0: EHR-import artifacts ("date", "name", "surescripts", field
         labels) are not medications and previously polluted Table 2. */
      (p.meds || []).forEach(function (m) { var k = lower(m).slice(0, 60); if (k && !MED_LIST_ARTIFACT.test(k)) medCounts[k] = (medCounts[k] || 0) + 1; });
      (p.allergies || []).forEach(function (a) { var k = lower(a).slice(0, 60); if (k) allergyCounts[k] = (allergyCounts[k] || 0) + 1; });
    });
    return {
      ages: ages, ageMean: mean(ages), ageSd: sampleSd(ages), ageMedian: median(ages),
      ageMin: ages.length ? Math.min.apply(Math, ages) : null,
      ageMax: ages.length ? Math.max.apply(Math, ages) : null,
      sexCounts: sexCounts, withMeds: withMeds, withAllergies: withAllergies, withProblems: withProblems,
      topMeds: topCounts(medCounts, 15), topAllergies: topCounts(allergyCounts, 10)
    };
  }
  function buildReportModel(spec, patients, meta) {
    meta = meta || {};
    var identities = meta.identities || [];
    var safeSpec = JSON.parse(JSON.stringify(spec));
    safeSpec.originalQuery = deidentifyText(safeSpec.originalQuery, identities);
    safeSpec.question = deidentifyText(safeSpec.question, identities);
    if (safeSpec.cohort && safeSpec.cohort.keywords) {
      safeSpec.cohort.keywords = safeSpec.cohort.keywords.map(function (term) { return deidentifyText(term, identities); });
    }
    if (safeSpec.range && safeSpec.range.kind === 'dates') {
      safeSpec.range = { kind: 'month-window', fromMonth: S(spec.range.from).slice(0, 7), toMonth: S(spec.range.to).slice(0, 7) };
    }
    var visits = [], byMonth = {}, pain = [], dated = 0, detailChars = 0;
    (patients || []).forEach(function (p) {
      (p.visits || []).forEach(function (v) {
        visits.push({ code: p.code || p.name, date: v.date, type: v.type, source: v.source, detail: v.detail });
        detailChars += S(v.detail).length;
        if (v.date) { dated++; var mo = v.date.slice(0, 7); byMonth[mo] = (byMonth[mo] || 0) + 1; }
        var m = S(v.detail).match(/\bpain[^0-9]{0,14}(10|[0-9])\s*(?:\/\s*10)?\b/i);
        if (m) pain.push({ code: p.code || p.name, date: v.date, score: Number(m[1]) });
      });
    });
    var sourceCounts = countBy(visits, function (v) { return v.source; });
    /* sr-2.3.0: encounter types arrive with provider-name suffixes appended
       ("est20, Jane Doe, PA-C, ..."); count on the base type so variants merge.
       Raw types stay untouched in appendix rows. */
    function normEncounterType(t) { var s = S(t).trim(); var cut = s.indexOf(','); if (cut > 0) s = s.slice(0, cut).trim(); return s || 'Visit'; }
    var typeCounts = countBy(visits, function (v) { return normEncounterType(v.type); });
    var demo = demographicsSummary(patients);
    var codeSignals = meta.codeSignals || null;
    /* sr-2.3.0: deterministic procedure-signal analysis. A signal is a text or
       encounter-type mention (never a billing assertion), matched against a
       fixed spine/pain/PM&R lexicon so "study every procedure" style requests
       get a real procedure section instead of raw keyword echoes. */
    var PROC_LEXICON = [
      ['Epidural steroid injection (ESI)', /\bepidural\b|\besi\b/],
      ['Sacroiliac / SI joint injection', /\bsacroiliac\b|\bsi\s+joint\b/],
      ['Facet / medial branch block', /\bfacet\b|\bmedial\s+branch\b|\bmbb\b/],
      ['Radiofrequency ablation (RFA)', /\bradio\s?frequency\b|\brfa\b|\bablation\b/],
      ['Trigger point injection', /\btrigger\s+point\b/],
      ['Nerve block', /\bnerve\s+block\b/],
      ['EMG / nerve conduction study', /\bemg\b|\bnerve\s+conduction\b|\bncs\b/],
      ['Fluoroscopy-guided procedure', /\bfluoro(?:scop\w*)?\b/],
      ['Kyphoplasty / vertebroplasty', /\bkyphoplasty\b|\bvertebroplasty\b/],
      ['Spinal cord stimulator (SCS)', /\bspinal\s+cord\s+stim\w*|\bscs\b|\bstimulator\b/],
      ['Intracept / basivertebral ablation', /\bintracept\b|\bbasivertebral\b/],
      ['PRP / regenerative injection', /\bprp\b|\bplatelet[-\s]rich\b/],
      ['Botulinum toxin injection', /\bbotox\b|\bbotulinum\b/],
      ['Discography', /\bdiscogra\w+\b/],
      ['Injection (any documented)', /\binject\w*\b/]
    ];
    function visitProcHay(v) { return lower(S(v.type) + ' ' + S(v.detail)); }
    var procStats = PROC_LEXICON.map(function (entry) {
      var pts = {}, count = 0;
      visits.forEach(function (v) { if (entry[1].test(visitProcHay(v))) { count++; pts[v.code] = 1; } });
      return { label: entry[0], visits: count, patients: Object.keys(pts).length };
    }).filter(function (r) { return r.visits > 0; });
    var procAnyPts = {}, procAnyVisits = 0, procByProvider = {};
    visits.forEach(function (v) {
      if (!PROC_LEXICON.some(function (e) { return e[1].test(visitProcHay(v)); })) return;
      procAnyVisits++; procAnyPts[v.code] = 1;
      var pm = S(v.detail).match(/Provider:\s*([^|]+)/i);
      var prov = pm ? pm[1].trim() : 'Not recorded';
      procByProvider[prov] = (procByProvider[prov] || 0) + 1;
    });
    var firstPain = {}, lastPain = {}, datedPain = pain.filter(function (p) { return !!p.date; });
    datedPain.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (p) {
      if (!firstPain[p.code]) firstPain[p.code] = p;
      lastPain[p.code] = p;
    });
    var painChanges = Object.keys(firstPain).filter(function (k) { return lastPain[k] !== firstPain[k]; })
      .map(function (k) { return lastPain[k].score - firstPain[k].score; });
    var baselineScores = Object.keys(firstPain).map(function (k) { return firstPain[k].score; });
    var finalScores = Object.keys(firstPain).filter(function (k) { return lastPain[k] !== firstPain[k]; })
      .map(function (k) { return lastPain[k].score; });
    var responders = painChanges.filter(function (delta) { return delta <= -2; }).length;
    var painCi = ci95(painChanges);
    var allScores = pain.map(function (x) { return x.score; });
    /* sr-2.3.0: pre-2000 "visit" months are DOB/import bleed, not encounters;
       they distorted the temporal axis (e.g. 1937-12). Excluded from the
       monthly table/figure only, disclosed in limitations. */
    var monthKeysAll = Object.keys(byMonth).sort();
    var implausibleMonthRecords = monthKeysAll.filter(function (k) { return k < '2000-01'; })
      .reduce(function (a, k) { return a + byMonth[k]; }, 0);
    var monthKeys = monthKeysAll.filter(function (k) { return k >= '2000-01'; });
    var perPatient = (patients || []).map(function (p) { return (p.visits || []).length; });
    /* Evidence-supported ceiling: richer per-visit narrative, tables, figures,
       and case summaries justify more pages per unit of evidence than sr-1,
       but small cohorts still produce short reports and are never padded. */
    /* The ceiling grows mainly with ANALYTIC content (visits/text volume), only
       weakly with head-count — a 1,400-patient cohort should yield a focused
       academic paper plus capped appendices, not 60 pages of per-patient dump. */
    var supportedCeiling = Math.min(spec.targetPages || MAX_REPORT_PAGES,
      Math.max(3, 5 + Math.ceil(visits.length / 12) + Math.ceil(detailChars / 8000) + Math.ceil((patients || []).length / 10)));

    var figures = [];
    if (monthKeys.length >= 2) {
      figures.push({ id: 'fig-monthly', kind: 'line', title: 'Figure 1. Included visit records per month',
        labels: monthKeys, values: monthKeys.map(function (k) { return byMonth[k]; }) });
    }
    var typeTop = topCounts(typeCounts, 10);
    if (typeTop.length >= 2) {
      figures.push({ id: 'fig-types', kind: 'bar', title: 'Figure ' + (figures.length + 1) + '. Encounter types (top ' + typeTop.length + ')',
        labels: typeTop.map(function (x) { return x[0]; }), values: typeTop.map(function (x) { return x[1]; }) });
    }
    if (allScores.length >= 4) {
      var hist = [];
      for (var b = 0; b <= 10; b++) hist.push(allScores.filter(function (s) { return s === b; }).length);
      figures.push({ id: 'fig-pain', kind: 'bar', title: 'Figure ' + (figures.length + 1) + '. Distribution of documented pain scores (0-10)',
        labels: ['0','1','2','3','4','5','6','7','8','9','10'], values: hist });
    }

    var sections = [];
    var abstractResults = patients.length + ' patients and ' + visits.length + ' deduplicated visit records were included (' + privacyRangeLabel(spec.range) + '). ' +
      (demo.ageMean != null ? 'Mean age was ' + fmt(demo.ageMean) + ' years (SD ' + fmt(demo.ageSd) + '; range ' + demo.ageMin + '-' + demo.ageMax + '). ' : '') +
      (pain.length ? pain.length + ' documented pain scores were parsed (mean ' + fmt(mean(allScores)) + '/10). ' : '') +
      (painChanges.length ? 'Among ' + painChanges.length + ' patients with two or more dated scores, mean first-to-last change was ' + fmt(mean(painChanges)) +
        ' points' + (painCi ? ' (95% CI ' + fmt(painCi.low) + ' to ' + fmt(painCi.high) + ')' : '') + '; ' + responders + ' improved by 2 or more points. ' : '');
    sections.push({
      key: 'abstract',
      heading: 'Abstract',
      paragraphs: [
        'Background: This limited-data retrospective draft summarizes documentation stored in MLS Scribe for the requested cohort. ' + PRIVACY_WARNING,
        'Methods: MLS normalized per-visit records from every connected evidence store (patient records, saved notes, calendar appointments, the Athena harvester' + (codeSignals ? ', and the practice code table' : '') + '), removed exact duplicate visits, applied the cohort and date rules of the request, scrubbed common direct identifiers, and computed the descriptive statistics reported here.',
        'Results: ' + abstractResults,
        'Conclusions: Findings are descriptive, practice-data only, and limited to documentation available in MLS. They do not establish causation and require clinician and privacy review before any use.'
      ]
    });
    sections.push({
      key: 'introduction',
      heading: 'Introduction and objective',
      paragraphs: [
        'Routine clinical documentation accumulates evidence that can support practice-level retrospective review. This report was generated from a natural-language request and is grounded exclusively in records already stored in MLS Scribe for this practice.',
        'Objective: ' + (safeSpec.question || safeSpec.originalQuery || typeLabel(spec.studyType)) + '.',
        'The requested analysis type is ' + typeLabel(spec.studyType) + '. No external literature was retrieved and no citation was created; the evidence base is the practice\'s own stored documentation.'
      ]
    });
    sections.push({
      key: 'cohort',
      heading: 'Question and cohort definition',
      paragraphs: [safeSpec.question || safeSpec.originalQuery || typeLabel(spec.studyType)],
      bullets: [
        'Cohort rule: ' + (safeSpec.cohort.mode === 'keyword' ? 'stored records matching ' + (safeSpec.cohort.keywords || []).join(' or ') : deidentifyText(meta.resolvedCohort || safeSpec.cohort.mode, identities))
      ].concat(meta.cohortFallback ? [deidentifyText(meta.cohortFallback, identities)] : []).concat([
        'Date rule: ' + privacyRangeLabel(spec.range) + '; exported visit dates are generalized to month precision.',
        'Privacy rule: common direct identifiers are scrubbed where detectable, but free text may retain indirect identifiers. This remains a limited-data draft requiring review.'
      ])
    });
    sections.push({
      key: 'methods',
      heading: 'Methods and provenance',
      paragraphs: [
        'MLS normalized per-visit records, removed exact duplicate visits, applied the cohort and date rules, then calculated the descriptive results shown here. Evidence was merged from every connected store: patient records (including demographics, medication lists, allergy lists, and problem summaries), saved notes, calendar appointments, and the Athena harvester' + (codeSignals ? ', with procedure/diagnosis coding cross-referenced against the practice code table' : '') + '. No missing outcome was inferred.',
        'This is a practice-data analysis, not a literature review. The report does not retrieve external research and does not create external citations unless those sources were explicitly provided.'
      ],
      bullets: topCounts(sourceCounts, 20).map(function (x) { return x[0] + ': ' + x[1] + ' records'; })
    });
    sections.push({
      key: 'stat-methods',
      heading: 'Statistical methods',
      paragraphs: [
        'Continuous measures are summarized as mean, sample standard deviation (SD), median, and range; 95% confidence intervals use the t distribution. Between-group comparisons of documented first-to-last pain change use Welch\'s unequal-variance t test with a normal approximation for the p value; all p values are two-sided, descriptive, and labeled approximate.',
        'Pain scores are parsed only where explicitly documented as a 0-10 value; no score was imputed. A responder is defined descriptively as a documented first-to-last improvement of 2 or more points. All statistics are computed deterministically in the browser from the deidentified working dataset.'
      ]
    });
    var demoRows = [];
    demoRows.push(['Included patients', String(patients.length)]);
    demoRows.push(['Included visit records', String(visits.length)]);
    demoRows.push(['Age, mean (SD)', demo.ageMean != null ? fmt(demo.ageMean) + ' (' + fmt(demo.ageSd) + ')' : 'not recorded']);
    demoRows.push(['Age, median (range)', demo.ageMedian != null ? fmt(demo.ageMedian) + ' (' + demo.ageMin + '-' + demo.ageMax + ')' : 'not recorded']);
    demoRows.push(['Sex: female / male / other / not recorded',
      [demo.sexCounts.female || 0, demo.sexCounts.male || 0, demo.sexCounts.other || 0, demo.sexCounts['not recorded'] || 0].join(' / ')]);
    demoRows.push(['Patients with a stored medication list', demo.withMeds + ' of ' + patients.length]);
    demoRows.push(['Patients with a stored allergy list', demo.withAllergies + ' of ' + patients.length]);
    demoRows.push(['Patients with a stored problem summary', demo.withProblems + ' of ' + patients.length]);
    demoRows.push(['Visits per patient, median (range)', perPatient.length ?
      fmt(median(perPatient)) + ' (' + Math.min.apply(Math, perPatient) + '-' + Math.max.apply(Math, perPatient) + ')' : 'not available']);
    sections.push({
      key: 'demographics',
      heading: 'Results: cohort characteristics',
      paragraphs: ['Table 1 summarizes the included cohort. Only values explicitly stored in MLS are reported; nothing was inferred from missing fields.'],
      table: { title: 'Table 1. Cohort characteristics', columns: ['Characteristic', 'Value'], rows: demoRows }
    });
    var matchEvidence = null;
    if (spec.cohort.mode === 'keyword' && (safeSpec.cohort.keywords || []).length) {
      matchEvidence = cohortMatchEvidence(patients, safeSpec.cohort.keywords);
      var constructionParas = [
        'Every included patient is listed below with the exact documentation that qualified them for the cohort "' + safeSpec.cohort.keywords.join(' / ') + '": how many of their stored visits mention the requested procedure/term, and the first and last month it was documented. Inclusion is verifiable against the evidence appendix.'
      ];
      if (matchEvidence.chartTextOnly) {
        constructionParas.push(matchEvidence.chartTextOnly + ' patient(s) matched only on their stored problem/chart summary rather than a specific visit record; they are flagged in the table and contribute no procedure-anchored outcome.');
      }
      sections.push({
        key: 'cohort-construction',
        heading: 'Results: cohort construction and match evidence',
        paragraphs: constructionParas,
        table: {
          title: 'Cohort membership evidence (per coded patient)',
          columns: ['Patient', 'Matching visits', 'Total visits', 'First documented', 'Last documented'],
          rows: matchEvidence.rows.map(function (r) {
            return [r.code, r.chartTextOnly ? 'chart summary only' : String(r.matchingVisits), String(r.totalVisits),
              r.firstMatched || '-', r.lastMatched || '-'];
          })
        }
      });
    }
    if (demo.topMeds.length) {
      sections.push({
        key: 'medications',
        heading: 'Results: documented medications and allergies',
        paragraphs: ['Medication and allergy entries come from the stored patient lists; counts are patients with the entry, not prescriptions issued.'],
        table: { title: 'Table 2. Most frequent stored medication-list entries', columns: ['Medication entry', 'Patients'],
          rows: demo.topMeds.map(function (x) { return [x[0], String(x[1])]; }) },
        bullets: demo.topAllergies.length ? demo.topAllergies.map(function (x) { return 'Allergy entry "' + x[0] + '": ' + x[1] + ' patients'; }) : ['No stored allergy-list entries in this cohort.']
      });
    }
    sections.push({
      key: 'composition',
      heading: 'Results: encounter composition',
      paragraphs: [dated + ' of ' + visits.length + ' included records have a usable encounter date.'],
      table: { title: 'Table ' + (demo.topMeds.length ? '3' : '2') + '. Encounter types', columns: ['Encounter type', 'Visits'],
        rows: topCounts(typeCounts, 15).map(function (x) { return [x[0], String(x[1])]; }) },
      figureId: 'fig-types'
    });
    var procParas = procStats.length ? [
      procAnyVisits + ' of ' + visits.length + ' included visit records (' + fmt(100 * procAnyVisits / Math.max(1, visits.length)) + '%) carry at least one documented procedure signal, across ' + Object.keys(procAnyPts).length + ' distinct patients. A signal is a text or encounter-type mention matched against a fixed procedure lexicon; it is not a billing assertion.',
      'The most frequently documented procedure signal was "' + procStats.slice().sort(function (a, b) { return b.visits - a.visits; })[0].label + '".'
    ] : ['No documented procedure signals matched the procedure lexicon in the included records. Absence of a documented mention is absence of evidence, not proof no procedure occurred.'];
    sections.push({
      key: 'procedures',
      heading: 'Results: documented procedures',
      paragraphs: procParas,
      table: procStats.length ? { title: 'Documented procedure signals', columns: ['Procedure signal', 'Visit records', 'Distinct patients'],
        rows: procStats.slice().sort(function (a, b) { return b.visits - a.visits; }).map(function (r) { return [r.label, String(r.visits), String(r.patients)]; }) } : undefined,
      bullets: procStats.length ? topCounts(procByProvider, 8).map(function (x) { return 'Procedure-signal visit records with ' + x[0] + ': ' + x[1]; }) : undefined
    });
    if (monthKeys.length) {
      sections.push({
        key: 'temporal',
        heading: 'Results: temporal pattern',
        paragraphs: ['Monthly counts of included, dated visit records across the full study window.'],
        table: { title: 'Monthly visit counts', columns: ['Month', 'Visits'],
          rows: monthKeys.map(function (k) { return [k, String(byMonth[k])]; }) },
        figureId: 'fig-monthly'
      });
    }
    if (codeSignals && codeSignals.length) {
      sections.push({
        key: 'codes',
        heading: 'Results: documented coding signals (practice code table)',
        paragraphs: ['Visit text was cross-referenced against the practice\'s uploaded ICD/CPT code table. A match is a documentation mention, not a billing assertion.'],
        table: { title: 'Code-table matches in included visit text', columns: ['Code', 'Kind', 'Description', 'Visits'],
          rows: codeSignals.map(function (r) { return [r.code, r.kind, r.desc, String(r.count)]; }) }
      });
    }
    if (spec.studyType === 'profile') {
      sections.push({
        key: 'profile',
        heading: 'Results: cohort profile findings',
        paragraphs: [
          'Median documented visits per included patient: ' + (median(perPatient) == null ? 'not available' : fmt(median(perPatient))) + '.',
          'Observed visit-count range: ' + (perPatient.length ? (Math.min.apply(Math, perPatient) + ' to ' + Math.max.apply(Math, perPatient)) : 'not available') + '. No demographic value was inferred from missing fields.'
        ]
      });
    }
    if (spec.studyType === 'outcomes' || pain.length) {
      var outcomeParas = [];
      outcomeParas.push(pain.length ? (pain.length + ' pain scores were explicitly parsed from stored notes; mean documented score ' + fmt(mean(allScores)) + '/10 (SD ' + fmt(sampleSd(allScores)) + '; median ' + fmt(median(allScores)) + ').') : 'No structured pain scores could be parsed from the included records.');
      if (painChanges.length) {
        outcomeParas.push('Among ' + painChanges.length + ' patients with at least two dated scores, mean baseline (first documented) score was ' + fmt(mean(baselineScores)) + '/10 and mean final documented score was ' + fmt(mean(finalScores)) + '/10. Mean first-to-last change was ' + fmt(mean(painChanges)) + ' points' + (painCi ? ' (95% CI ' + fmt(painCi.low) + ' to ' + fmt(painCi.high) + ')' : '') + ' (descriptive; not causal).');
        outcomeParas.push(responders + ' of ' + painChanges.length + ' patients (' + fmt(100 * responders / painChanges.length) + '%) had a documented improvement of 2 or more points between their first and last dated score.');
      }
      if (matchEvidence && matchEvidence.anchored.length) {
        var anchoredChanges = matchEvidence.anchored.map(function (a) { return a.change; });
        var anchoredCi = ci95(anchoredChanges);
        var anchoredResponders = anchoredChanges.filter(function (delta) { return delta <= -2; }).length;
        outcomeParas.push('Procedure-anchored analysis: for ' + matchEvidence.anchored.length + ' patients with a documented pain score at or before their FIRST documented "' + safeSpec.cohort.keywords.join(' / ') + '" visit and another score after it, mean documented pain moved from ' +
          fmt(mean(matchEvidence.anchored.map(function (a) { return a.baseline; }))) + '/10 before the index visit to ' +
          fmt(mean(matchEvidence.anchored.map(function (a) { return a.post; }))) + '/10 after (mean change ' + fmt(mean(anchoredChanges)) +
          (anchoredCi ? ', 95% CI ' + fmt(anchoredCi.low) + ' to ' + fmt(anchoredCi.high) : '') + '); ' +
          anchoredResponders + ' improved by 2 or more points. Dates are month-precision, so same-month before/after ordering is conservative; this remains descriptive documentation, not a treatment effect.');
      } else if (matchEvidence) {
        outcomeParas.push('No patient had documented pain scores both before and after their first documented "' + safeSpec.cohort.keywords.join(' / ') + '" visit, so no procedure-anchored change is reported.');
      }
      sections.push({ key: 'outcomes', heading: 'Results: documented outcomes', paragraphs: outcomeParas, figureId: allScores.length >= 4 ? 'fig-pain' : undefined });
    }
    var comparison = null;
    if (spec.studyType === 'procedure' && spec.cohort.keywords && spec.cohort.keywords.length >= 2) {
      comparison = buildComparisonCohorts(patients, safeSpec.cohort.keywords);
      var armRows = comparison.groups.map(function (group) {
        return [group.label, String(group.patientCount), String(group.matchingVisitCount),
          group.meanIncludedVisitsPerPatient == null ? '-' : fmt(group.meanIncludedVisitsPerPatient),
          group.meanDocumentedPainScore == null ? '-' : fmt(group.meanDocumentedPainScore),
          group.meanFirstToLastPainChange == null ? '-' : ((group.meanFirstToLastPainChange > 0 ? '+' : '') + fmt(group.meanFirstToLastPainChange)) + ' (n=' + group.pairedPainPatientCount + ')'];
      });
      var comparisonParas = [
        'Each patient is assigned to exactly one comparison group. Patients documented in multiple groups are disclosed and excluded from between-group counts.',
        'Arm results are descriptive summaries of stored documentation only; they do not establish comparative effectiveness or causation.'
      ];
      var armed = comparison.groups.filter(function (g) { return (g.painChangeSamples || []).length >= 2; });
      if (armed.length >= 2) {
        var test = welchTTest(armed[0].painChangeSamples, armed[1].painChangeSamples);
        if (test) {
          comparisonParas.push('Exploratory between-arm contrast of documented first-to-last pain change (' + armed[0].label + ' vs ' + armed[1].label + '): mean ' + fmt(test.meanA) + ' vs ' + fmt(test.meanB) + ' points; Welch t = ' + fmt(test.t, 2) + ', df = ' + fmt(test.df) + ', approximate two-sided p = ' + fmtP(test.p) + '. This is a descriptive, non-randomized contrast and must not be read as a treatment effect.');
        }
      }
      sections.push({
        key: 'comparison',
        heading: 'Results: mutually exclusive procedure comparison cohorts',
        paragraphs: comparisonParas,
        table: { title: 'Comparison arms', columns: ['Arm', 'Patients', 'Matching visits', 'Mean visits/pt', 'Mean pain', 'Mean pain change'], rows: armRows },
        bullets: [
          'Overlap excluded: ' + comparison.overlapPatients + ' patients',
          'Unmatched excluded: ' + comparison.unmatchedPatients + ' patients'
        ]
      });
    } else if (spec.cohort.keywords && spec.cohort.keywords.length) {
      sections.push({
        key: 'terms',
        heading: 'Results: cohort-term evidence',
        bullets: safeSpec.cohort.keywords.map(function (term) {
          var n = visits.filter(function (v) { return recordMentions(v, term); }).length;
          return term + ': documented in ' + n + ' included visit records';
        })
      });
    }
    if (spec.studyType === 'custom') {
      /* sr-2.3.0: only report terms that actually appear. A list of imperative
         words (or typos) with "0 of N" counts is noise, not analysis. */
      var qHits = meaningfulQuestionTerms(safeSpec.question).map(function (term) {
        return [term, visits.filter(function (v) { return recordMentions(v, term); }).length];
      }).filter(function (x) { return x[1] > 0; });
      if (qHits.length) {
        sections.push({
          key: 'question-terms',
          heading: 'Results: question-specific documentation',
          paragraphs: ['These are documentation counts, not inferred diagnoses or causal effects.'],
          bullets: qHits.map(function (x) {
            return x[0] + ': mentioned in ' + x[1] + ' of ' + visits.length + ' included visit records';
          })
        });
      }
    }
    var safetyTerms = ['infection', 'bleeding', 'allergic', 'emergency', 'hospital', 'fall'];
    var safety = safetyTerms.map(function (term) {
      return [term, visits.filter(function (v) { return recordMentions(v, term); }).length];
    }).filter(function (x) { return x[1] > 0; });
    if (safety.length) {
      sections.push({
        key: 'safety',
        heading: 'Results: documented safety-signal terms',
        paragraphs: ['The following are text mentions that require clinical review; a mention is not proof of an adverse event.'],
        bullets: safety.map(function (x) { return x[0] + ': ' + x[1] + ' visit records'; })
      });
    }
    /* sr-2.3.0: case-level patient lines are real per-patient evidence, but
       they belong at the END of the report as an appendix — after every
       analytic section — and they now cover ALL included patients (the page
       ceiling truncates naturally; the Excel export always has the full set). */
    var caseParas = (patients || []).map(function (p) {
      var vs = p.visits || [];
      var datedVs = vs.filter(function (v) { return v.date; });
      var span = datedVs.length ? (datedVs[0].date + (datedVs.length > 1 ? ' through ' + datedVs[datedVs.length - 1].date : '')) : 'undated records only';
      var types = topCounts(countBy(vs, function (v) { return v.type; }), 3).map(function (x) { return x[0] + ' (' + x[1] + ')'; }).join(', ');
      var scores = [];
      vs.forEach(function (v) { var s = documentedPainScore(v); if (s != null) scores.push(s); });
      var line = p.code + ': ' + (p.ageYears != null ? p.ageYears + '-year-old' + (p.sex ? ' ' + p.sex : '') + ' patient with ' : '') +
        vs.length + ' included visit record' + (vs.length === 1 ? '' : 's') + ' (' + span + '). Encounter types: ' + (types || 'not recorded') + '.';
      if (scores.length) line += ' Documented pain scores: ' + scores.join(', ') + ' (0-10).';
      if ((p.meds || []).length) line += ' Stored medication-list entries: ' + p.meds.slice(0, 6).join('; ') + ((p.meds.length > 6) ? ' (and ' + (p.meds.length - 6) + ' more)' : '') + '.';
      if (S(p.problems).trim()) line += ' Problem summary: ' + S(p.problems).slice(0, 220) + '.';
      return line;
    });
    var discussion = [
      'Within the stated limits, the included documentation supports the descriptive findings above: ' + patients.length + ' patients contributed ' + visits.length + ' deduplicated visit records' + (monthKeys.length ? ' across ' + monthKeys.length + ' calendar months' : '') + '.',
      procStats.length ? ('Documented procedure signals appeared in ' + procAnyVisits + ' visit records across ' + Object.keys(procAnyPts).length + ' patients (see "Results: documented procedures"); these are documentation mentions matched against a fixed lexicon, suitable for utilization review and hypothesis generation.') : null,
      pain.length ? ('Documented pain scoring was available for a subset of encounters (' + pain.length + ' scores), and any change estimates reflect only patients with repeated dated documentation. Undocumented outcomes are reported as absent evidence, not as negative findings.') : 'Structured outcome scores were not documented in this cohort, so the report is limited to utilization and composition findings.',
      'Because this is a single-practice, non-randomized, documentation-based review, the appropriate use of this draft is internal quality review, hypothesis generation, and preparation for a formally designed study with IRB oversight.'
    ];
    sections.push({ key: 'discussion', heading: 'Discussion', paragraphs: discussion.filter(Boolean) });
    var limitations = (meta.cohortFallback ? [deidentifyText(meta.cohortFallback, identities)] : []).concat([
      'This is a retrospective descriptive report from data stored in MLS, not a randomized or causal analysis.',
      'Absence of a documented finding does not prove the finding was absent.',
      'Clinical interpretation, compliance review, and any required IRB determination remain the responsibility of the practice.'
    ]);
    if (spec.cohort.mode === 'keyword') limitations.push('Cohort membership is text-mention based: all words of the requested term must appear close together within one visit record (or the stored problem summary). A documented mention is treated as received, and negated mentions are not distinguished. Use the cohort-construction table as the per-patient audit trail.');
    if (meta.scope && meta.scope.excludedUndated) limitations.push(meta.scope.excludedUndated + ' undated records were excluded because the request specified a date window.');
    if (meta.scope && meta.scope.excludedOutOfRange) limitations.push(meta.scope.excludedOutOfRange + ' records fell outside the requested date window.');
    if (meta.duplicateVisitsRemoved) limitations.push(meta.duplicateVisitsRemoved + ' duplicate visit records were removed before analysis.');
    if (implausibleMonthRecords) limitations.push(implausibleMonthRecords + ' dated record' + (implausibleMonthRecords === 1 ? '' : 's') + ' carried an implausible pre-2000 visit date (likely an imported date-of-birth artifact) and ' + (implausibleMonthRecords === 1 ? 'was' : 'were') + ' excluded from the temporal analysis only.');
    if (meta.ambiguousRecordsSkipped) limitations.push(meta.ambiguousRecordsSkipped + ' records without a unique stable-ID or exact unique name+DOB match were excluded to prevent cross-patient mixing.');
    if (meta.identityConflicts) limitations.push(meta.identityConflicts + ' records with conflicting namespace-qualified identifiers were excluded for identity safety.');
    if (!painChanges.length && spec.studyType === 'outcomes') limitations.push('The records do not support a longitudinal pain-change estimate for two or more measurements per patient.');
    sections.push({ key: 'limitations', heading: 'Data quality and limitations', bullets: limitations });
    sections.push({
      key: 'conclusion',
      heading: 'Conclusion',
      paragraphs: [
        'This evidence-grounded draft summarizes what the practice\'s stored documentation shows for the requested question. All findings are descriptive and reproducible from the included records; none should be acted on clinically without independent review.',
        PRIVACY_WARNING
      ]
    });
    sections.push({
      key: 'references',
      heading: 'References and evidence policy',
      paragraphs: [
        'No external literature was retrieved and no external citation is included; the sole evidence base is the practice\'s stored documentation enumerated in Methods and the appendix. If literature context is required, supply the sources explicitly and they will be quoted as provided, never invented.'
      ]
    });
    sections.push({
      key: 'repro',
      heading: 'Reproducibility record',
      bullets: [
        'Parser version: ' + VERSION,
        'Study type: ' + typeLabel(spec.studyType),
        'Requested maximum: ' + spec.targetPages + ' pages; evidence-supported ceiling: ' + supportedCeiling + ' pages.',
        'Included records: ' + visits.length + '; included patients: ' + patients.length + '; exact duplicates removed: ' + (meta.duplicateVisitsRemoved || 0) + '.',
        'Ambiguous identity rows excluded: ' + (meta.ambiguousRecordsSkipped || 0) + '; conflicting stable-identifier rows excluded: ' + (meta.identityConflicts || 0) + '.',
        'Evidence stores read: patient records, saved notes, calendar, Athena harvester' + (codeSignals ? ', practice code table' : '') + '.',
        'Narrative mode: deterministic (statistics computed in-browser; see any AI-narrative note below).',
        'Report policy: stop when evidence is exhausted; never add filler or invented results.'
      ]
    });
    if (caseParas.length) {
      sections.push({
        key: 'cases',
        heading: 'Appendix A. Case-level patient index',
        paragraphs: [
          'One compact line per coded patient, drawn from stored, identifier-scrubbed documentation. Patient-level detail is intentionally kept at the end of the report, after every analytic section.',
          'This index covers ALL ' + patients.length + ' included patients and truncates only at the report page ceiling; the complete set is always available row-by-row in the limited-data Excel export.'
        ].concat(caseParas)
      });
    }
    return {
      title: typeLabel(spec.studyType) + ' - limited-data MLS study draft',
      generatedAt: new Date().toISOString(),
      spec: safeSpec,
      sections: sections,
      figures: figures,
      appendixRows: visits,
      patientCount: patients.length,
      visitCount: visits.length,
      supportedPageCeiling: supportedCeiling,
      targetPages: spec.targetPages,
      limitations: limitations,
      provenance: sourceCounts,
      comparison: comparison,
      demographics: demo,
      matchEvidence: matchEvidence,
      codeSignals: codeSignals,
      aiNarrative: false,
      deidentified: false,
      privacyMode: 'direct-identifiers-removed-limited-data-draft',
      privacyWarning: PRIVACY_WARNING
    };
  }

  /* ------------------------ AI academic narrative (optional) ------------------------ */
  function buildStatsDigest(model) {
    /* Everything here is already deidentified; the digest is the ONLY material
       the narrative model may draw from. */
    return {
      title: model.title,
      question: model.spec && (model.spec.question || model.spec.originalQuery),
      studyType: model.spec && model.spec.studyTypeLabel,
      patientCount: model.patientCount,
      visitCount: model.visitCount,
      sections: (model.sections || []).map(function (s) {
        return {
          heading: s.heading,
          paragraphs: (s.paragraphs || []).slice(0, 30),
          bullets: (s.bullets || []).slice(0, 40),
          table: s.table ? { title: s.table.title, columns: s.table.columns, rows: (s.table.rows || []).slice(0, 40) } : undefined
        };
      })
    };
  }
  function narrativeNumbersOk(text, digestStr) {
    /* Anti-fabrication guard: every number in AI prose must already exist in
       the deterministic digest (or be a trivially small count). */
    var nums = S(text).match(/\d+(?:\.\d+)?/g) || [];
    return nums.every(function (n) {
      if (digestStr.indexOf(n) >= 0) return true;
      var v = Number(n);
      return isFinite(v) && v >= 0 && v <= 12 && n.indexOf('.') < 0;
    });
  }
  function parseNarrativeJson(raw) {
    var text = S(raw).replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      var parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) { return null; }
  }
  function aiNarrative(model, options) {
    options = options || {};
    if (options.useAi === false) return Promise.resolve(null);
    var ai = options.ai || (typeof root.aiCallRaw === 'function' ? root.aiCallRaw : null);
    if (!ai) return Promise.resolve(null);
    var digest = buildStatsDigest(model);
    var digestStr = JSON.stringify(digest);
    var sys = 'You are an academic medical writer preparing a retrospective, practice-data quality-review draft. ' +
      'You are given the COMPLETE deterministic statistics of the study as JSON. Rules: ' +
      '(1) Use ONLY facts and numbers that appear verbatim in the provided JSON; never compute, estimate, or invent a number, percentage, patient, citation, or reference. ' +
      '(2) Never claim causation; the data are descriptive documentation from a single practice. ' +
      '(3) Do not include any patient identifier; the data are already coded (P001...). ' +
      '(4) Write in formal academic prose (journal style), third person, no headings inside fields. ' +
      'Return STRICT JSON: {"abstract": "<structured abstract paragraph(s), Background/Methods/Results/Conclusions labeled inline>", ' +
      '"introduction": "<2-4 paragraphs framing the objective and why practice-level retrospective review of this question is useful, separated by \\n\\n>", ' +
      '"discussion": "<3-6 paragraphs interpreting the provided findings, their internal consistency, and appropriate use, separated by \\n\\n>", ' +
      '"conclusion": "<1-2 paragraph conclusion, separated by \\n\\n>"}';
    var key = '';
    try { key = typeof root.getKey === 'function' ? (root.getKey() || '') : ''; } catch (e) {}
    var call = safeCall(function () { return ai(sys, digestStr, key, { freeform: true, maxTokens: 3800 }); }, null);
    if (!call || typeof call.then !== 'function') return Promise.resolve(null);
    return promiseWithTimeout(call, Math.max(1000, Number(options.aiTimeoutMs) || 90000), 'ai-narrative-timeout', 'The AI narrative timed out.')
      .then(function (raw) {
        var parsed = parseNarrativeJson(raw);
        if (!parsed) return null;
        var out = {};
        ['abstract', 'introduction', 'discussion', 'conclusion'].forEach(function (fieldKey) {
          var value = S(parsed[fieldKey]).trim();
          if (value && value.length > 40 && narrativeNumbersOk(value, digestStr)) out[fieldKey] = value;
        });
        return Object.keys(out).length ? out : null;
      })
      .catch(function () { return null; });
  }
  function splitParagraphs(text) {
    return S(text).split(/\n{2,}/).map(function (p) { return p.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  }
  function applyNarrative(model, narrative) {
    if (!narrative) return model;
    var note = 'Narrative drafted by AI strictly from the deterministic statistics in this report (numbers verified against the computed values); clinician review required.';
    function replaceSection(key, text) {
      if (!text) return false;
      var section = (model.sections || []).filter(function (s) { return s.key === key; })[0];
      if (!section) return false;
      section.paragraphs = splitParagraphs(text).concat(['[' + note + ']']);
      return true;
    }
    var used = false;
    if (replaceSection('abstract', narrative.abstract)) used = true;
    if (replaceSection('introduction', narrative.introduction)) used = true;
    if (narrative.discussion) {
      var disc = (model.sections || []).filter(function (s) { return s.key === 'discussion'; })[0];
      if (disc) { disc.paragraphs = splitParagraphs(narrative.discussion).concat(['[' + note + ']']); used = true; }
    }
    if (replaceSection('conclusion', narrative.conclusion)) used = true;
    if (used) {
      model.aiNarrative = true;
      var repro = (model.sections || []).filter(function (s) { return s.key === 'repro'; })[0];
      if (repro && repro.bullets) {
        repro.bullets = repro.bullets.map(function (b) {
          return /^Narrative mode:/.test(b) ? 'Narrative mode: AI-drafted from the deterministic statistics digest, number-verified; all tables, figures, and statistics remain deterministic.' : b;
        });
      }
    }
    return model;
  }

  /* ------------------------------- PDF rendering ------------------------------- */
  function pdfSafe(v) {
    return S(v).replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-').replace(/•/g, '*').replace(/[^\x20-\xFF\n\t]/g, ' ');
  }
  function renderDetailedPdf(jsPDF, model) {
    if (!jsPDF) throw new Error('PDF renderer unavailable');
    var doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var M = 50, y = 64, pages = 1, maxPages = Math.min(MAX_REPORT_PAGES, model.supportedPageCeiling), truncated = false;
    var canDraw = typeof doc.rect === 'function' && typeof doc.line === 'function';
    var figuresById = {};
    (model.figures || []).forEach(function (f) { figuresById[f.id] = f; });
    function nextPage() {
      if (pages >= maxPages) { truncated = true; return false; }
      doc.addPage(); pages++; y = 64; return true;
    }
    function need(height) { if (y + height <= H - 52) return true; return nextPage(); }
    function text(value, size, opts) {
      opts = opts || {}; value = pdfSafe(value); size = size || 10;
      doc.setFontSize(size); doc.setFont(undefined, opts.bold ? 'bold' : 'normal');
      var indent = opts.indent || 0, lines = doc.splitTextToSize(value, W - M * 2 - indent);
      for (var i = 0; i < lines.length; i++) {
        if (!need(size + 4)) return false;
        doc.text(lines[i], M + indent, y); y += size + 4;
      }
      y += opts.after == null ? 5 : opts.after;
      return true;
    }
    function heading(value) {
      if (!need(28)) return false;
      doc.setTextColor(32, 64, 52); var ok = text(value, 14, { bold: true, after: 7 }); doc.setTextColor(20, 28, 24); return ok;
    }
    function renderTable(table) {
      if (!table || !table.rows || !table.rows.length) return true;
      if (table.title && !text(table.title, 10, { bold: true, after: 3 })) return false;
      var cols = table.columns || [];
      var usable = W - M * 2;
      var widths;
      if (cols.length === 2) widths = [usable * 0.62, usable * 0.38];
      else if (cols.length === 4) widths = [usable * 0.16, usable * 0.12, usable * 0.56, usable * 0.16];
      else {
        widths = [];
        var first = usable * 0.3, rest = (usable - first) / Math.max(1, cols.length - 1);
        cols.forEach(function (_, i) { widths.push(i === 0 ? first : rest); });
      }
      function row(cells, bold) {
        doc.setFontSize(8.5); doc.setFont(undefined, bold ? 'bold' : 'normal');
        var wrapped = cells.map(function (cell, i) {
          return doc.splitTextToSize(pdfSafe(S(cell)), Math.max(20, widths[i] - 6));
        });
        var lines = Math.max.apply(Math, wrapped.map(function (wl) { return wl.length; }).concat([1]));
        var rowH = lines * 10.5 + 4;
        if (!need(rowH)) return false;
        var x = M;
        wrapped.forEach(function (wl, i) {
          for (var li = 0; li < wl.length; li++) doc.text(wl[li], x + 2, y + 9 + li * 10.5);
          x += widths[i];
        });
        if (canDraw) { doc.setDrawColor(214, 224, 218); doc.line(M, y + rowH - 1, W - M, y + rowH - 1); }
        y += rowH;
        return true;
      }
      if (!row(cols, true)) return false;
      for (var r = 0; r < table.rows.length; r++) {
        if (!row(table.rows[r], false)) return false;
      }
      y += 9;
      return true;
    }
    function renderFigure(fig) {
      if (!fig || !canDraw || !(fig.values || []).length) return true;
      var boxH = 190, plotH = 130, plotW = W - M * 2 - 40;
      if (!need(boxH + 24)) return false;
      if (!text(fig.title, 10, { bold: true, after: 4 })) return false;
      var x0 = M + 30, y0 = y + plotH;
      var values = fig.values, labels = fig.labels || [];
      var maxV = Math.max.apply(Math, values.concat([1]));
      doc.setDrawColor(120, 140, 130);
      doc.line(x0, y0, x0 + plotW, y0);
      doc.line(x0, y0, x0, y0 - plotH);
      doc.setFontSize(7); doc.setFont(undefined, 'normal'); doc.setTextColor(90, 100, 94);
      doc.text('0', x0 - 12, y0 + 2);
      doc.text(String(maxV), x0 - 4 - String(maxV).length * 4, y0 - plotH + 4);
      var n = values.length, slot = plotW / n;
      if (fig.kind === 'line') {
        doc.setDrawColor(32, 64, 52);
        for (var i = 1; i < n; i++) {
          var xa = x0 + slot * (i - 0.5), ya = y0 - (values[i - 1] / maxV) * plotH;
          var xb = x0 + slot * (i + 0.5), yb = y0 - (values[i] / maxV) * plotH;
          doc.line(xa, ya, xb, yb);
        }
        for (var j = 0; j < n; j++) {
          var cx = x0 + slot * (j + 0.5), cy = y0 - (values[j] / maxV) * plotH;
          doc.rect(cx - 1.4, cy - 1.4, 2.8, 2.8, 'F');
        }
      } else {
        doc.setFillColor(46, 106, 75);
        for (var k = 0; k < n; k++) {
          var barW = Math.max(3, slot * 0.62);
          var barH = (values[k] / maxV) * plotH;
          doc.rect(x0 + slot * k + (slot - barW) / 2, y0 - barH, barW, barH, 'F');
        }
      }
      var step = Math.max(1, Math.ceil(n / 12));
      for (var t2 = 0; t2 < n; t2 += step) {
        var lab = pdfSafe(S(labels[t2])).slice(0, 12);
        doc.text(lab, x0 + slot * (t2 + 0.5) - lab.length * 1.8, y0 + 12);
      }
      doc.setTextColor(20, 28, 24);
      y = y0 + 26;
      return true;
    }

    /* ------- cover page ------- */
    doc.setTextColor(32, 64, 52); text('MLS Scribe', 12, { bold: true, after: 28 });
    doc.setTextColor(20, 28, 24); text(model.title, 22, { bold: true, after: 14 });
    text('Generated ' + new Date(model.generatedAt).toLocaleString(), 10, { after: 18 });
    text(model.patientCount + ' coded patients | ' + model.visitCount + ' stored visit records', 12, { bold: true, after: 16 });
    text(PRIVACY_WARNING, 10, { bold: true, after: 10 });
    text('Evidence policy: this report stops when the stored evidence is exhausted. It is not padded to a page target. Exported visit dates use month precision.', 10, { after: 14 });
    text('Requested maximum: ' + model.targetPages + ' pages | Evidence-supported ceiling: ' + maxPages + ' pages', 10, { bold: true, after: 12 });
    if (model.aiNarrative) text('Narrative sections were AI-drafted from the deterministic statistics digest and number-verified; all tables, figures, and statistics are computed deterministically.', 9, { after: 10 });
    if (pages < maxPages) nextPage();

    model.sections.some(function (section) {
      if (!heading(section.heading)) return true;
      var stopped = false;
      (section.paragraphs || []).some(function (p) { if (!text(p, 10)) { stopped = true; return true; } return false; });
      if (stopped) return true;
      if (section.table && !renderTable(section.table)) return true;
      if (section.figureId && figuresById[section.figureId] && !renderFigure(figuresById[section.figureId])) return true;
      (section.bullets || []).some(function (b) { if (!text('- ' + b, 9.5, { indent: 10, after: 2 })) { stopped = true; return true; } return false; });
      y += 7;
      return stopped;
    });

    if (!truncated && model.appendixRows.length) {
      /* sr-2.3.0: compact rows — a short excerpt instead of the full note
         body. Full verbatim text lives in the Excel export; multi-page SOAP
         dumps no longer crowd out the analytic sections. */
      var APPENDIX_CAP = 400;
      heading('Appendix B. Limited-data visit rows (compact)');
      text('One compact row per included stored visit (short excerpt only — full text is in the limited-data Excel export). Common direct identifiers are scrubbed where detectable; clinician/privacy review is still required.', 9, { after: 8 });
      if (model.appendixRows.length > APPENDIX_CAP) {
        text('Showing the first ' + APPENDIX_CAP + ' of ' + model.appendixRows.length + ' included visit rows; the COMPLETE row set is in the limited-data Excel export. The analytic sections above always take priority over raw rows.', 9, { bold: true, after: 8 });
      }
      model.appendixRows.slice(0, APPENDIX_CAP).some(function (r, idx) {
        if (!need(42) && truncated) return true;
        if (!text((idx + 1) + '. ' + r.code + ' | ' + (r.date || 'date not recorded') + ' | ' + r.type + ' | source: ' + r.source, 9, { bold: true, after: 2 })) return true;
        var excerpt = S(r.detail);
        if (excerpt.length > 220) excerpt = excerpt.slice(0, 220) + ' ... [full text in the Excel export]';
        if (excerpt && !text(excerpt, 8.5, { indent: 10, after: 7 })) return true;
        return truncated;
      });
    }

    var actualPages = typeof doc.getNumberOfPages === 'function' ? doc.getNumberOfPages() : pages;
    if (typeof doc.setPage === 'function') {
      for (var p = 1; p <= actualPages; p++) {
        doc.setPage(p); doc.setFontSize(8); doc.setTextColor(100);
        doc.text('Limited-data draft - privacy review required | Page ' + p + ' of ' + actualPages, M, H - 24);
      }
    }
    return { pdfBlob: doc.output('blob'), pageCount: actualPages, truncated: truncated, supportedPageCeiling: maxPages };
  }

  function scopedVisual(engineResult, spec, scoped) {
    var raw = S(engineResult && engineResult.svg);
    /* __mlsSgFix prepends its own scope div. Exact date windows are applied to
       the working cohort before that engine runs, so replace the generic
       "all time" label with the actual deterministic StudySpec. */
    raw = raw.replace(/^\s*<div[^>]*>\s*(?:[^<]|<(?!\/div>))*<\/div>\s*/i, '');
    return '<div class="sr-engine-scope" style="font:750 12px system-ui;color:#2E6A4B;margin:0 0 6px">Scope: ' +
      esc(typeLabel(spec.studyType) + ' | ' + privacyRangeLabel(spec.range) + ' | ' + scoped.patientCount + ' patients, ' + scoped.visitCount + ' visits') +
      '</div>' + raw;
  }
  function deidentifiedCsv(spec, patients, model) {
    function cell(v) {
      var value = S(v);
      if (/^[\t\r ]*[=+\-@]/.test(value)) value = "'" + value;
      return '"' + value.replace(/"/g, '""') + '"';
    }
    var rows = [
      ['MLS limited-data study draft'],
      ['Study type', typeLabel(spec.studyType)],
      ['Date range', privacyRangeLabel(spec.range) + ' (visit dates generalized to month)'],
      ['Privacy warning', PRIVACY_WARNING],
      [],
      ['Patient code', 'Age (years)', 'Sex', 'Medication-list entries', 'Allergy-list entries'],
    ];
    (patients || []).forEach(function (p) {
      rows.push([p.code, p.ageYears == null ? '' : String(p.ageYears), p.sex || '',
        (p.meds || []).join('; '), (p.allergies || []).join('; ')]);
    });
    rows.push([]);
    rows.push(['Patient code', 'Comparison group', 'Visit date', 'Visit type', 'Source', 'Detail']);
    var membership = model && model.comparison && model.comparison.membership || {};
    (patients || []).forEach(function (p) {
      (p.visits || []).forEach(function (v) { rows.push([p.code, membership[p.code] || '', v.date, v.type, v.source, v.detail]); });
    });
    return new Blob([rows.map(function (row) { return row.map(cell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  }

  /* ----------------------------- engine bridge ----------------------------- */
  function selectedGroup(sg, doc) {
    try {
      var sel = doc && doc.getElementById('mls-sg-group');
      if (sel && sel.value) return sg.get(sel.value);
    } catch (e) {}
    return null;
  }
  function resolveRecords(spec, records, sg, doc, options) {
    options = options || {};
    var resolved = '';
    if (spec.cohort.mode === 'selected' || spec.cohort.mode === 'auto') {
      var chosen = options.selectedGroup || selectedGroup(sg, doc);
      if (chosen) { records = groupToRecords(chosen); resolved = 'Selected cohort: ' + S(chosen.name); }
      else if (spec.cohort.mode === 'selected') throw studyError('no-selected-cohort', 'Select a named cohort in Advanced options, or ask for all stored patients.');
    }
    if (!resolved) {
      resolved = spec.cohort.mode === 'keyword' ? 'Records matching ' + spec.cohort.keywords.join(' or ') : 'All stored patients';
    }
    return { records: records, resolved: resolved };
  }
  function studyError(code, message) { var e = new Error(message); e.code = code; return e; }
  function usableEngine(sg) {
    return !!(sg && sg.__live && typeof sg.analyze === 'function' && typeof sg.chartSVG === 'function');
  }
  function waitForEngine(options) {
    options = options || {};
    if (options.sg) return usableEngine(options.sg) ? Promise.resolve(options.sg) :
      Promise.reject(studyError('engine-incompatible', 'The in-memory study analyzer is unavailable. Press Enter to retry after the app finishes loading.'));
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      function check() {
        var sg = root.__mlsStudyGroups;
        if (usableEngine(sg)) return resolve(sg);
        if (Date.now() - started > 12000) return reject(studyError('engine-not-ready', 'The study engine is still loading. Press Enter to retry.'));
        setTimeout(check, 120);
      }
      check();
    });
  }
  function setEngineScope(spec, doc) {
    if (!doc) return;
    try {
      var type = doc.getElementById('sgpType');
      if (type) { type.value = spec.studyType; type.dispatchEvent(new Event('change', { bubbles: true })); }
      var range = doc.getElementById('sgpRange');
      if (range) {
        var value = spec.range.kind === 'months' ? S(spec.range.months) : 'all';
        var have = false;
        for (var i = 0; i < range.options.length; i++) if (range.options[i].value === value) have = true;
        if (!have && value !== 'all') { var opt = doc.createElement('option'); opt.value = value; opt.textContent = 'Last ' + value + ' months'; range.appendChild(opt); }
        range.value = value;
      }
      var custom = doc.getElementById('sgpCustomTx'); if (custom && spec.studyType === 'custom') custom.value = spec.question;
    } catch (e) {}
  }
  function promiseWithTimeout(promise, ms, code, message) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return; settled = true; reject(studyError(code || 'dependency-timeout', message || 'A required report dependency timed out.'));
      }, ms);
      Promise.resolve(promise).then(function (value) {
        if (settled) return; settled = true; clearTimeout(timer); resolve(value);
      }, function (error) {
        if (settled) return; settled = true; clearTimeout(timer); reject(error);
      });
    });
  }
  function getJsPDF(options) {
    options = options || {};
    var timeoutMs = Math.max(10, Number(options.dependencyTimeoutMs) || 12000);
    if (options.jsPDF) return Promise.resolve(options.jsPDF);
    var have = (root.jspdf && root.jspdf.jsPDF) || root.jsPDF;
    if (have) return Promise.resolve(have);
    /* Reuse the app's single lazy jsPDF owner when available.  Creating a
       second CDN script while Legal/Reports is already loading the same library
       used to waste bandwidth and could race two global initializers. */
    if (typeof root.loadJsPdf === 'function') {
      return promiseWithTimeout(Promise.resolve().then(function () { return root.loadJsPdf(); }).then(function (ns) {
        var shared = (ns && ns.jsPDF) || (root.jspdf && root.jspdf.jsPDF) || root.jsPDF;
        if (!shared) throw new Error('PDF renderer unavailable');
        return shared;
      }), timeoutMs, 'pdf-loader-timeout', 'The PDF renderer did not finish loading. Retry the study when the connection is available.');
    }
    if (!root.document) return Promise.reject(new Error('PDF renderer unavailable'));
    return new Promise(function (resolve, reject) {
      var old = root.document.querySelector('script[data-mls-study-request-pdf]');
      if (old) {
        var settled = false;
        function finish(ok) {
          if (settled) return; settled = true; clearTimeout(deadline);
          var j = (root.jspdf && root.jspdf.jsPDF) || root.jsPDF;
          if (ok && j) resolve(j); else reject(new Error('PDF renderer unavailable'));
        }
        var deadline = setTimeout(function () { finish(false); }, timeoutMs);
        old.addEventListener('load', function () { finish(true); }, { once: true });
        old.addEventListener('error', function () { finish(false); }, { once: true });
        return;
      }
      var s = root.document.createElement('script'), settled = false;
      function finish(ok, message) {
        if (settled) return; settled = true; clearTimeout(deadline);
        var j = (root.jspdf && root.jspdf.jsPDF) || root.jsPDF;
        if (ok && j) resolve(j); else reject(studyError(ok ? 'pdf-loader-invalid' : 'pdf-loader-failed', message || 'Could not load the PDF renderer. Retry the study.'));
      }
      var deadline = setTimeout(function () { finish(false, 'The PDF renderer timed out. Retry the study when the connection is available.'); }, timeoutMs);
      s.src = CDN_JSPDF; s.async = true; s.setAttribute('data-mls-study-request-pdf', '1');
      s.onload = function () { finish(true); };
      s.onerror = function () { finish(false, 'Could not load the PDF renderer. Retry the study when the connection is available.'); };
      (root.document.head || root.document.documentElement).appendChild(s);
    });
  }
  function publicScopedSummary(scoped) {
    var scope = scoped && scoped.scope || {};
    return {
      patientCount: scoped.patientCount,
      visitCount: scoped.visitCount,
      scope: {
        rangeLabel: scope.rangeLabel ? scope.rangeLabel.replace(/\d{4}-\d{2}-\d{2}/g, function (d) { return d.slice(0, 7); }) : '',
        fromMonth: S(scope.from).slice(0, 7),
        toMonth: S(scope.to).slice(0, 7),
        excludedUndated: scope.excludedUndated || 0,
        excludedOutOfRange: scope.excludedOutOfRange || 0
      }
    };
  }
  function executeSpec(spec, options) {
    options = options || {};
    var doc = options.document || root.document, token = options.token;
    function progress(v) { if (typeof options.onProgress === 'function') options.onProgress(v); }
    var scoped, deid, model, cohortFallbackNote = '';
    return waitForEngine(options).then(function (sg) {
      progress('Reading and de-duplicating stored visit evidence...');
      var env = options.env || root;
      var records = options.records || collectStoredRecords(env);
      var resolved = resolveRecords(spec, records, sg, doc, options);
      progress('Applying cohort and date rules...');
      scoped = applyScope(resolved.records, spec, options.now);
      if (!scoped.patientCount && spec.cohort.mode === 'keyword') {
        /* A question-style phrase ("how happy my patients are ...") parses as
           a cohort keyword but defines no cohort. Rather than a dead end, the
           study runs over ALL stored patients and all their visits, analyzes
           the question against every record, and DISCLOSES the fallback. */
        var allSpec = JSON.parse(JSON.stringify(spec));
        allSpec.cohort = { mode: 'all', keywords: [] };
        var allScoped = applyScope(resolved.records, allSpec, options.now);
        if (allScoped.patientCount) {
          progress('The phrase matched no records as a cohort filter — studying ALL stored patients instead...');
          cohortFallbackNote = 'Cohort fallback: the phrase "' + spec.cohort.keywords.join(' / ') + '" matched no stored records as a patient filter, so this study covers ALL stored patients and all of their visits; the question is analyzed against every included record.';
          spec = allSpec;
          resolved.resolved = 'All stored patients (automatic fallback — the request phrase did not define a cohort)';
          scoped = allScoped;
        }
      }
      if (!scoped.patientCount) throw studyError('empty-cohort', 'No stored patients match that cohort and date range. Try a broader term or time range.');
      if (!scoped.visitCount) throw studyError('empty-evidence', 'The matching patients have no stored visit evidence to analyze yet. Add or pull visit history, then retry.');
      deid = deidentifyPatients(scoped.patients, options.now);
      var allDeidVisits = [];
      deid.forEach(function (p) { (p.visits || []).forEach(function (v) { allDeidVisits.push(v); }); });
      model = buildReportModel(spec, deid, {
        scope: scoped.scope,
        resolvedCohort: resolved.resolved,
        duplicateVisitsRemoved: (resolved.records.provenance || {}).duplicateVisitsRemoved || 0,
        ambiguousRecordsSkipped: (resolved.records.provenance || {}).ambiguousRecordsSkipped || 0,
        identityConflicts: (resolved.records.provenance || {}).identityConflicts || 0,
        codeSignals: collectCodeSignals(allDeidVisits, options.env || root),
        cohortFallback: cohortFallbackNote,
        identities: scoped.patients.map(function (p) { return { name: p.name, dob: p.dob, mrn: p.mrn }; })
      });
      progress('Analyzing the direct-identifier-scrubbed cohort in memory...');
      setEngineScope(spec, doc);
      /* Never create an engine group here. createGroup/addPatient persist and
         mirror on every call, which turns N patients into O(N^2) serialization
         and can leave crash residue. The engine's pure analyzer/chart API runs
         the exact same normalized cohort with zero localStorage/network writes. */
      var inMemoryGroup = {
        id: 'in-memory-only', name: 'Limited-data natural-language study draft',
        patients: deid.map(function (p) { return { id: p.code, name: p.code, dob: '', mrn: '', visits: p.visits }; })
      };
      var analysis = sg.analyze(inMemoryGroup);
      return {
        group: inMemoryGroup,
        analysis: analysis,
        svg: sg.chartSVG(analysis),
        xlsxBlob: deidentifiedCsv(spec, deid, model),
        xlsxFallback: true,
        inMemory: true,
        engine: '__mlsStudyGroups.analyze/chartSVG'
      };
    }).then(function (engineResult) {
      if (token != null && token !== generation) throw studyError('superseded', 'A newer study request replaced this one.');
      progress('Drafting the academic narrative from the computed statistics...');
      return aiNarrative(model, options).then(function (narrative) {
        if (token != null && token !== generation) throw studyError('superseded', 'A newer study request replaced this one.');
        applyNarrative(model, narrative);
        progress('Building the evidence-grounded detailed report...');
        return getJsPDF(options).then(function (jsPDF) {
          var detailed = renderDetailedPdf(jsPDF, model);
          return {
            spec: model.spec,
            scoped: publicScopedSummary(scoped),
            limitedDataPatients: deid,
            model: model,
            engineResult: engineResult,
            pdfBlob: detailed.pdfBlob,
            pdfPages: detailed.pageCount,
            reportTruncatedAtEvidenceCeiling: detailed.truncated,
            supportedPageCeiling: detailed.supportedPageCeiling,
            xlsxBlob: engineResult && engineResult.xlsxBlob,
            xlsxFallback: true,
            aiNarrative: !!model.aiNarrative,
            svg: scopedVisual(engineResult, spec, scoped)
          };
        }).catch(function (e) {
          return {
            spec: model.spec, scoped: publicScopedSummary(scoped), limitedDataPatients: deid, model: model,
            engineResult: engineResult, xlsxBlob: engineResult && engineResult.xlsxBlob,
            xlsxFallback: true,
            aiNarrative: !!model.aiNarrative,
            svg: scopedVisual(engineResult, spec, scoped), pdfError: e.message
          };
        });
      });
    });
  }

  /* ---------------------------------- UI ---------------------------------- */
  function injectCss(doc) {
    if (!doc || doc.getElementById(CSS_ID)) return;
    var st = doc.createElement('style'); st.id = CSS_ID;
    st.textContent = [
      '#mlsSgPro{padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;overflow:visible!important}',
      '#' + UI_ID + '{--sr-ink:#17231d;--sr-green:#204034;--sr-soft:#f3f7f4;--sr-line:#dce6df;font:14px/1.45 system-ui,Segoe UI,sans-serif;color:var(--sr-ink);background:linear-gradient(145deg,#fff 0%,#f7faf8 100%);border:1px solid var(--sr-line);border-radius:20px;padding:22px;box-shadow:0 16px 40px rgba(31,64,52,.08);margin:0 0 12px}',
      '.sr-eyebrow{font-size:11px;font-weight:850;letter-spacing:.12em;text-transform:uppercase;color:#47705f;margin-bottom:6px}',
      '#' + UI_ID + ' h3{font:650 25px/1.12 "Newsreader",Georgia,serif;letter-spacing:-.02em;margin:0;color:var(--sr-ink)}',
      '.sr-lede{color:#5f6d66;max-width:760px;margin:7px 0 15px}',
      '.sr-compose{display:flex;align-items:flex-end;gap:9px;background:#fff;border:1px solid #cfdcd4;border-radius:15px;padding:9px 9px 9px 13px;box-shadow:0 5px 16px rgba(25,48,39,.05)}',
      '.sr-compose:focus-within{border-color:#5a9278;box-shadow:0 0 0 3px rgba(54,120,88,.12)}',
      '#mlsStudyPrompt{border:0!important;outline:0!important;background:transparent!important;box-shadow:none!important;resize:none;width:100%;min-height:54px;max-height:150px;padding:5px 0!important;font:600 15px/1.45 system-ui!important;color:var(--sr-ink)!important}',
      '#mlsStudyPrompt::placeholder{color:#91a098}',
      '#mlsStudySubmit{width:40px;height:40px;flex:0 0 40px;border:0!important;border-radius:11px!important;background:var(--sr-green)!important;color:#fff!important;font-size:19px!important;cursor:pointer;padding:0!important}',
      '#mlsStudySubmit:disabled{opacity:.45;cursor:wait}',
      '.sr-hint{display:flex;justify-content:space-between;gap:12px;color:#738078;font-size:11.5px;margin:7px 2px 0}',
      '.sr-example{color:#416e59}',
      '.sr-spec{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0 0}',
      '.sr-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid #dbe6df;background:#fff;border-radius:999px;padding:5px 9px;font-size:11.5px;color:#42534a}',
      '.sr-chip b{color:#183c2d}',
      '.sr-status{margin-top:12px;border-radius:12px;padding:10px 12px;background:#edf5f0;color:#24513d;font-weight:650;font-size:12.5px}',
      '.sr-status[hidden],.sr-spec[hidden],.sr-results[hidden]{display:none!important}',
      '.sr-status.sr-error{background:#fff4ef;color:#9a3e25;border:1px solid #f0d0c4}',
      '.sr-retry{margin-left:9px;border:1px solid currentColor;background:transparent;border-radius:8px;padding:4px 8px;color:inherit;font-weight:750;cursor:pointer}',
      '.sr-results{margin-top:14px;border-top:1px solid #e2e9e4;padding-top:14px}',
      '.sr-result-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.sr-result-head h4{font:700 18px/1.25 "Newsreader",Georgia,serif!important;margin:0!important}',
      '.sr-result-meta{color:#65736c;font-size:12px;margin-top:3px}',
      '.sr-downloads{display:flex;gap:7px;flex-wrap:wrap}',
      '.sr-download{display:inline-flex;align-items:center;text-decoration:none;border-radius:10px;padding:8px 11px;background:#204034;color:#fff!important;font-size:12px;font-weight:750}',
      '.sr-download.sr-secondary{background:#fff;color:#204034!important;border:1px solid #bfd1c6}',
      '.sr-chart{margin-top:12px;padding:10px;background:#fff;border:1px solid #e1e8e3;border-radius:13px;overflow:auto}',
      '.sr-chart svg{max-width:100%;height:auto}',
      '.sr-proof{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}',
      '.sr-proof>div{background:#fff;border:1px solid #e1e8e3;border-radius:11px;padding:9px}',
      '.sr-proof b{display:block;font-size:16px;color:#204034}.sr-proof span{font-size:10.5px;color:#738078}',
      '#' + ADV_ID + '{border:1px solid #e3e5df;border-radius:14px;background:#fff;margin:0 0 14px;overflow:hidden}',
      '#' + ADV_ID + '>summary{list-style:none;cursor:pointer;padding:12px 15px;font:750 12.5px system-ui;color:#526058;display:flex;align-items:center;gap:8px}',
      '#' + ADV_ID + '>summary::-webkit-details-marker{display:none}',
      '#' + ADV_ID + '>summary:before{content:"+";display:grid;place-items:center;width:20px;height:20px;border-radius:7px;background:#edf2ee;color:#204034;font-size:15px}',
      '#' + ADV_ID + '[open]>summary:before{content:"-"}',
      '#' + ADV_BODY_ID + '{border-top:1px solid #eceee9;padding:14px}',
      '#' + ADV_ID + '[open] #mls-sg-root{display:block!important}',
      '#mlsSg2Toggle{display:none!important}',
      /* legibility: legacy muted text darkened, and a stuck pane fade-in can
         never leave the advanced tools ghosted/unreadable */
      '#' + ADV_BODY_ID + '{opacity:1!important;filter:none!important}',
      '#' + ADV_BODY_ID + ' .mls-sg-muted,#' + ADV_BODY_ID + ' .sgp-note{color:#4c5c53!important}',
      '@media(max-width:700px){#' + UI_ID + '{padding:16px;border-radius:15px}#' + UI_ID + ' h3{font-size:21px}.sr-hint{display:block}.sr-example{display:block;margin-top:3px}.sr-proof{grid-template-columns:1fr}}',
      '@media(prefers-reduced-motion:reduce){#' + UI_ID + ' *{scroll-behavior:auto!important;transition:none!important}}'
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(st);
  }
  function ui() { return root.document && root.document.getElementById(UI_ID); }
  function setStatus(message, kind) {
    var box = ui(), st = box && box.querySelector('#mlsStudyStatus'); if (!st) return;
    st.hidden = false; st.className = 'sr-status' + (kind === 'error' ? ' sr-error' : '');
    st.textContent = message;
    if (kind === 'error' && lastQuery) {
      var retry = root.document.createElement('button'); retry.type = 'button'; retry.className = 'sr-retry'; retry.textContent = 'Retry';
      retry.addEventListener('click', function () { runFromUi(lastQuery); }); st.appendChild(retry);
    }
  }
  function renderSpec(spec) {
    var box = ui(), el = box && box.querySelector('#mlsStudySpec'); if (!el) return;
    var cohort = spec.cohort.mode === 'keyword' ? spec.cohort.keywords.join(' / ') :
      ({ all: 'All stored patients', selected: 'Selected cohort', auto: 'Selected cohort or all stored patients' })[spec.cohort.mode];
    el.innerHTML = [
      ['Cohort', cohort], ['Analysis', spec.studyTypeLabel], ['Dates', rangeLabel(spec.range)],
      ['Report', 'Academic paper, up to ' + spec.targetPages + ' evidence-supported pages'], ['Privacy', 'Direct identifiers scrubbed; review required']
    ].map(function (x) { return '<span class="sr-chip"><b>' + esc(x[0]) + '</b> ' + esc(x[1]) + '</span>'; }).join('');
    el.hidden = false;
  }
  function rememberUrl(blob) {
    if (!blob || !root.URL || typeof root.URL.createObjectURL !== 'function') return '';
    var url = root.URL.createObjectURL(blob); objectUrls.push(url); return url;
  }
  function clearUrls() {
    if (root.URL && typeof root.URL.revokeObjectURL === 'function') objectUrls.forEach(function (u) { try { root.URL.revokeObjectURL(u); } catch (e) {} });
    objectUrls = [];
  }
  function filename(type, ext) { return 'MLS_' + typeLabel(type).replace(/[^A-Za-z0-9]+/g, '_') + '_LimitedDataDraft.' + ext; }
  function renderResult(result) {
    clearUrls();
    var box = ui(), out = box && box.querySelector('#mlsStudyResults'); if (!out) return;
    var pdf = rememberUrl(result.pdfBlob), xlsx = rememberUrl(result.xlsxBlob);
    var downloads = '';
    if (pdf) downloads += '<a class="sr-download" href="' + pdf + '" download="' + esc(filename(result.spec.studyType, 'pdf')) + '">Academic PDF</a>';
    if (xlsx) downloads += '<a class="sr-download sr-secondary" href="' + xlsx + '" download="' + esc(filename(result.spec.studyType, result.xlsxFallback ? 'csv' : 'xlsx')) + '">Limited-data export</a>';
    out.innerHTML = '<div class="sr-result-head"><div><h4>Study ready</h4><div class="sr-result-meta">' +
      esc(result.pdfPages ? (result.pdfPages + ' evidence-supported pages (abstract, methods, results, discussion' + (result.aiNarrative ? '; AI-drafted narrative, number-verified' : '') + '); requested maximum ' + result.spec.targetPages + '.') : ('Report model ready. ' + (result.pdfError || 'PDF unavailable.'))) +
      '</div></div><div class="sr-downloads">' + downloads + '</div></div>' +
      '<div class="sr-proof"><div><b>' + result.scoped.patientCount + '</b><span>coded patients</span></div>' +
      '<div><b>' + result.scoped.visitCount + '</b><span>deduplicated visits</span></div>' +
      '<div><b>' + (result.pdfPages || result.supportedPageCeiling || result.model.supportedPageCeiling) + '</b><span>pages supported / produced</span></div></div>' +
      (result.svg ? '<div class="sr-chart">' + result.svg + '</div>' : '') +
      '<div class="sr-result-meta" style="margin-top:9px">' + esc(PRIVACY_WARNING) + ' Page length is never padded.</div>';
    out.hidden = false;
  }
  function runFromUi(query) {
    var box = ui(), input = box && box.querySelector('#mlsStudyPrompt'), submit = box && box.querySelector('#mlsStudySubmit');
    if (uiRunPromise) {
      setStatus('Your current study is still running. The same request will finish without starting a duplicate job.', 'progress');
      return uiRunPromise;
    }
    query = S(query == null && input ? input.value : query).trim(); lastQuery = query;
    var spec = parseStudySpec(query);
    if (!spec.ok) { setStatus(spec.clarification, 'error'); return Promise.resolve(spec); }
    generation++; var token = generation;
    if (submit) submit.disabled = true;
    /* Anything failing between disabling the button and the async job starting
       must never leave the composer stuck disabled with no status. */
    try {
      renderSpec(spec); setStatus('Interpreting your request...', 'progress');
      var resultBox = box && box.querySelector('#mlsStudyResults'); if (resultBox) resultBox.hidden = true;
    } catch (uiSetupError) {
      if (submit) submit.disabled = false;
      try { setStatus('The study view could not update (' + uiSetupError.message + '). Press Enter to retry.', 'error'); } catch (e2) {}
      return Promise.reject(uiSetupError);
    }
    uiRunPromise = executeSpec(spec, { token: token, onProgress: function (m) { if (token === generation) setStatus(m, 'progress'); } })
      .then(function (result) {
        if (token !== generation) return result;
        lastResult = result; renderResult(result);
        setStatus(result.pdfPages ? ('Ready: ' + result.pdfPages + '-page academic-style report built from ' + result.scoped.visitCount + ' stored visits. It stopped at the evidence-supported length.') : ('Study completed, but the PDF needs a retry: ' + result.pdfError), result.pdfPages ? 'done' : 'error');
        return result;
      }).catch(function (e) {
        if (e && e.code === 'superseded') return null;
        if (token === generation) setStatus((e && e.message) || 'The study could not be completed. Try a broader request.', 'error');
        throw e;
      }).finally(function () {
        if (submit && token === generation) submit.disabled = false;
        uiRunPromise = null;
      });
    return uiRunPromise;
  }
  function shouldSubmitKey(ev) {
    return !!(ev && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229);
  }
  function buildUi(doc) {
    var section = doc.createElement('section'); section.id = UI_ID; section.setAttribute('aria-labelledby', 'mlsStudyRequestTitle');
    section.innerHTML =
      '<div class="sr-eyebrow">Natural-language study builder</div>' +
      '<h3 id="mlsStudyRequestTitle">Describe the study. MLS writes the paper from your stored evidence.</h3>' +
      '<p class="sr-lede">Type the cohort, question, and time range in plain language. Press Enter - no setup steps required. MLS reads every connected evidence store (patients, notes, calendar, Athena pulls, your code table) and produces an academic-style paper - abstract, methods, statistics, tables, figures, discussion - up to 60 evidence-supported pages. Outputs scrub common direct identifiers, remain limited-data drafts requiring clinician/privacy review, and are never padded.</p>' +
      '<div class="sr-compose"><textarea id="mlsStudyPrompt" rows="2" aria-label="Describe the study to build" aria-keyshortcuts="Enter" placeholder="Example: Compare outcomes for patients who received lumbar epidural injections in the last 12 months, up to 40 pages"></textarea>' +
      '<button type="button" id="mlsStudySubmit" aria-label="Generate this study" title="Generate study">&#8593;</button></div>' +
      '<div class="sr-hint"><span>Enter to generate - Shift+Enter for a new line</span><span class="sr-example">Uses visits, notes, calendar, demographics, and code-table records already stored in MLS</span></div>' +
      '<div id="mlsStudySpec" class="sr-spec" hidden></div><div id="mlsStudyStatus" class="sr-status" role="status" aria-live="polite" hidden></div>' +
      '<div id="mlsStudyResults" class="sr-results" hidden></div>';
    var input = section.querySelector('#mlsStudyPrompt'), submit = section.querySelector('#mlsStudySubmit');
    input.addEventListener('keydown', function (ev) {
      if (!shouldSubmitKey(ev)) return;
      ev.preventDefault(); runFromUi(input.value).catch(function () {});
    });
    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(150, input.scrollHeight) + 'px'; });
    submit.addEventListener('click', function () { runFromUi(input.value).catch(function () {}); });
    return section;
  }
  function adoptLegacy(pro, details, body) {
    var rootEl = root.document.getElementById('mls-sg-root');
    if (rootEl && !body.contains(rootEl)) body.appendChild(rootEl);
    /* Calm's old disclosure repeatedly insists on being a direct child during
       its bounded startup pass. It is retired by CSS; everything else belongs
       behind this single native Advanced options disclosure. */
    Array.prototype.slice.call(pro.children).forEach(function (child) {
      if (child.id === UI_ID || child.id === ADV_ID || child.id === 'mlsSg2Toggle') return;
      body.appendChild(child);
    });
  }
  function mount() {
    var doc = root.document, pro = doc && doc.getElementById('mlsSgPro');
    if (!doc || !pro) return false;
    if (doc.getElementById(UI_ID)) return true;
    injectCss(doc);
    var section = buildUi(doc);
    var details = doc.createElement('details'); details.id = ADV_ID;
    var summary = doc.createElement('summary'); summary.textContent = 'Advanced options and named cohorts';
    var body = doc.createElement('div'); body.id = ADV_BODY_ID;
    details.appendChild(summary); details.appendChild(body);
    pro.insertBefore(details, pro.firstChild); pro.insertBefore(section, details);
    adoptLegacy(pro, details, body); mountedPro = pro;
    if (childObserver) childObserver.disconnect();
    childObserver = new MutationObserver(function (mutations) {
      var shouldAdopt = mutations.some(function (m) { return m.type === 'childList' && m.addedNodes.length; });
      if (shouldAdopt) adoptLegacy(pro, details, body);
    });
    childObserver.observe(pro, { childList: true });
    try { if (mountObserver) mountObserver.disconnect(); } catch (e) {}
    try { if (mountDeadline) clearTimeout(mountDeadline); } catch (e) {}
    return true;
  }
  function boot() {
    if (!root.document) return;
    if (mount()) return;
    if (mountObserver) return;
    mountObserver = new MutationObserver(function () { mount(); });
    mountObserver.observe(root.document.documentElement, { childList: true, subtree: true });
    mountDeadline = setTimeout(function () { try { mountObserver.disconnect(); } catch (e) {} mountObserver = null; }, 60000);
  }
  function revert() {
    generation++;
    uiRunPromise = null;
    try { if (mountObserver) mountObserver.disconnect(); if (childObserver) childObserver.disconnect(); } catch (e) {}
    try { if (mountDeadline) clearTimeout(mountDeadline); } catch (e) {}
    clearUrls();
    var doc = root.document;
    if (doc) {
      var pro = mountedPro || doc.getElementById('mlsSgPro'), body = doc.getElementById(ADV_BODY_ID), details = doc.getElementById(ADV_ID);
      if (pro && body) {
        var sgRoot = doc.getElementById('mls-sg-root');
        Array.prototype.slice.call(body.children).forEach(function (child) { if (child !== sgRoot) pro.insertBefore(child, details); });
        if (sgRoot && pro.parentNode) pro.parentNode.insertBefore(sgRoot, pro.nextSibling);
      }
      var view = doc.getElementById(UI_ID); if (view) view.remove();
      if (details) details.remove();
      var style = doc.getElementById(CSS_ID); if (style) style.remove();
    }
    api.installed = false;
    try { if (root.__mlsStudyRequest === api) delete root.__mlsStudyRequest; } catch (e) {}
  }

  var api = {
    installed: true,
    version: VERSION,
    parseStudySpec: parseStudySpec,
    validateStudySpec: validateStudySpec,
    collectStoredRecords: collectStoredRecords,
    normalizeVisit: visitFromRaw,
    applyScope: applyScope,
    recordMentions: recordMentions,
    buildComparisonCohorts: buildComparisonCohorts,
    deidentifyText: deidentifyText,
    deidentifyPatients: deidentifyPatients,
    buildReportModel: buildReportModel,
    limitedDataCsv: deidentifiedCsv,
    renderDetailedPdf: renderDetailedPdf,
    getJsPDF: getJsPDF,
    shouldSubmitKey: shouldSubmitKey,
    executeSpec: executeSpec,
    collectCodeSignals: collectCodeSignals,
    cohortMatchEvidence: cohortMatchEvidence,
    aiNarrative: aiNarrative,
    applyNarrative: applyNarrative,
    narrativeNumbersOk: narrativeNumbersOk,
    stats: { mean: mean, median: median, sampleSd: sampleSd, ci95: ci95, welchTTest: welchTTest },
    run: function (query, options) {
      var spec = typeof query === 'string' ? parseStudySpec(query, options) : query;
      if (!spec || !spec.ok) return Promise.reject(studyError((spec && spec.code) || 'invalid-request', (spec && spec.clarification) || 'Describe the study to build.'));
      return executeSpec(spec, options || {});
    },
    runFromUi: runFromUi,
    retry: function () { return lastQuery ? runFromUi(lastQuery) : Promise.reject(studyError('nothing-to-retry', 'There is no previous study request to retry.')); },
    getLastResult: function () { return lastResult; },
    mount: mount,
    boot: boot,
    revert: revert
  };
  return api;
});

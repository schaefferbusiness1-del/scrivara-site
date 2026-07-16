/* =============================================================================
 * MLS Scribe natural-language study request surface
 * __mlsStudyRequest sr-1.0.0 (site only, additive, reversible)
 *
 * One sentence is enough: the deterministic parser turns it into a strict
 * StudySpec, the existing __mlsSgFix/__mlsStudyGroups engines build and run the
 * cohort, and the detailed report removes common direct identifiers by default.
 * only evidence already stored in MLS. They may be as long as 30 pages when the
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

  var VERSION = 'sr-1.0.0';
  var CSS_ID = 'mlsStudyRequestCss';
  var UI_ID = 'mlsStudyRequest';
  var ADV_ID = 'mlsStudyAdvanced';
  var ADV_BODY_ID = 'mlsStudyAdvancedBody';
  var MAX_REPORT_PAGES = 30;
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
      .replace(/\s+(?:retrospective|outcomes?|volume|trends?|profile|study|report)\b[\s\S]*$/i, '')
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
    if (!specificSignal && /^(?:make|build|create|run|generate)?\s*(?:me\s+)?(?:a\s+)?(?:\d+[- ]page\s+)?study\s*\.?$/i.test(q)) {
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
    var requested = pageMatch ? Number(pageMatch[1]) : MAX_REPORT_PAGES;
    if (requested > MAX_REPORT_PAGES) notes.push('Detailed reports are capped at 30 evidence-supported pages.');
    requested = clamp(requested, 2, MAX_REPORT_PAGES);

    var spec = {
      version: 1,
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
      var out = { name: S(p.name), dob: isoDate(p.dob), mrn: S(p.mrn), visits: [], _chartText: '' }, seen = {};
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
      .replace(/\blumbosacral\b/g, ' lumbar ')
      .replace(/\besi\b/g, ' epidural injection ')
      .replace(/\bshots?\b/g, ' injection ')
      .replace(/\b(?:injected|injecting|injections?)\b/g, ' injection ');
    return value.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean).map(function (word) {
      if (word.length > 5 && /ies$/.test(word)) return word.slice(0, -3) + 'y';
      if (word.length > 4 && /s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
      return word;
    });
  }
  function keywordMatch(patient, terms) {
    var hay = searchTokens(S(patient._chartText) + ' ' + (patient.visits || []).map(function (v) { return v.type + ' ' + v.detail; }).join(' '));
    var bag = {}; hay.forEach(function (token) { bag[token] = 1; });
    return (terms || []).some(function (term) {
      var wanted = searchTokens(term);
      return wanted.length && wanted.every(function (token) { return !!bag[token]; });
    });
  }
  function recordMentions(record, term) {
    var bag = {}; searchTokens(S(record.type) + ' ' + S(record.detail)).forEach(function (token) { bag[token] = 1; });
    var wanted = searchTokens(term);
    return wanted.length && wanted.every(function (token) { return !!bag[token]; });
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
        _painScores: [], _pairedChanges: []
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
          group._pairedChanges.push(datedScores[datedScores.length - 1].score - datedScores[0].score);
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
      group.pairedPainPatientCount = group._pairedChanges.length;
      group.meanFirstToLastPainChange = group._pairedChanges.length ? mean(group._pairedChanges) : null;
      delete group._painScores; delete group._pairedChanges;
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
      var copy = { name: p.name, dob: p.dob, mrn: p.mrn, _chartText: p._chartText, visits: [] };
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
      values.forEach(function (v, idx) {
        v = S(v).trim();
        if (!v || (idx === 2 && v.length < 4)) return;
        try { out = out.replace(new RegExp(escapeRx(v), 'gi'), '[redacted]'); } catch (e) {}
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
      .replace(/\b(\d{4})[\/-](\d{1,2})[\/-]\d{1,2}\b/g, function (_, y, m) { return y + '-' + ('0' + m).slice(-2); })
      .replace(/\b(\d{1,2})[\/-]\d{1,2}[\/-](\d{4})\b/g, function (_, m, y) { return y + '-' + ('0' + m).slice(-2); })
      .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi, '$1 $2');
  }
  function deidentifyPatients(patients) {
    var ids = (patients || []).map(function (p) { return { name: p.name, dob: p.dob, mrn: p.mrn }; });
    return (patients || []).map(function (p, i) {
      var code = 'P' + ('000' + (i + 1)).slice(-3);
      return {
        code: code,
        name: code,
        dob: '',
        mrn: '',
        visits: (p.visits || []).map(function (v) {
          return { date: generalizeDate(v.date), type: deidentifyText(v.type, ids), detail: deidentifyText(v.detail, ids), source: deidentifyText(v.source, ids) };
        })
      };
    });
  }

  /* -------------------- evidence-grounded detailed report -------------------- */
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
  function meaningfulQuestionTerms(question) {
    var stop = { build:1, create:1, generate:1, study:1, report:1, patient:1, patients:1, cohort:1,
      stored:1, evidence:1, pages:1, page:1, last:1, past:1, month:1, months:1, year:1, years:1,
      from:1, through:1, with:1, without:1, who:1, what:1, when:1, where:1, which:1, were:1,
      have:1, had:1, received:1, compare:1, versus:1, outcomes:1, outcome:1, retrospective:1,
      this:1, that:1, these:1, those:1, their:1, them:1, then:1, than:1, into:1, about:1 };
    var seen = {}, out = [];
    searchTokens(question).forEach(function (term) {
      if (term.length < 4 || stop[term] || /^\d+$/.test(term) || seen[term]) return;
      seen[term] = 1; out.push(term);
    });
    return out.slice(0, 10);
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
    var typeCounts = countBy(visits, function (v) { return v.type; });
    var firstPain = {}, lastPain = {}, datedPain = pain.filter(function (p) { return !!p.date; });
    datedPain.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (p) {
      if (!firstPain[p.code]) firstPain[p.code] = p;
      lastPain[p.code] = p;
    });
    var painChanges = Object.keys(firstPain).filter(function (k) { return lastPain[k] !== firstPain[k]; })
      .map(function (k) { return lastPain[k].score - firstPain[k].score; });
    var supportedCeiling = Math.min(spec.targetPages || MAX_REPORT_PAGES,
      Math.max(3, 3 + Math.ceil(visits.length / 12) + Math.ceil(detailChars / 9000)));
    var sections = [];
    sections.push({
      heading: 'Executive summary',
      paragraphs: [
        'This limited-data retrospective draft includes ' + patients.length + ' patients and ' + visits.length + ' stored visit records within ' + privacyRangeLabel(spec.range) + '.',
        'The requested analysis is ' + typeLabel(spec.studyType) + '. Findings are descriptive, practice-data only, and limited to documentation available in MLS. No external literature or citations are added unless source material was explicitly supplied.',
        PRIVACY_WARNING
      ]
    });
    sections.push({
      heading: 'Question and cohort definition',
      paragraphs: [safeSpec.question || safeSpec.originalQuery || typeLabel(spec.studyType)],
      bullets: [
        'Cohort rule: ' + (safeSpec.cohort.mode === 'keyword' ? 'stored records matching ' + (safeSpec.cohort.keywords || []).join(' or ') : deidentifyText(meta.resolvedCohort || safeSpec.cohort.mode, identities)),
        'Date rule: ' + privacyRangeLabel(spec.range) + '; exported visit dates are generalized to month precision.',
        'Privacy rule: common direct identifiers are scrubbed where detectable, but free text may retain indirect identifiers. This remains a limited-data draft requiring review.'
      ]
    });
    sections.push({
      heading: 'Methods and provenance',
      paragraphs: [
        'MLS normalized per-visit records, removed exact duplicate visits, applied the cohort and date rules, then calculated the descriptive results shown here. No missing outcome was inferred.',
        'This is a practice-data analysis, not a literature review. The report does not retrieve external research and does not create external citations unless those sources were explicitly provided.'
      ],
      bullets: topCounts(sourceCounts, 20).map(function (x) { return x[0] + ': ' + x[1] + ' records'; })
    });
    sections.push({
      heading: 'Encounter composition',
      paragraphs: [dated + ' of ' + visits.length + ' included records have a usable encounter date.'],
      bullets: topCounts(typeCounts, 15).map(function (x) { return x[0] + ': ' + x[1] + ' visits'; })
    });
    if (Object.keys(byMonth).length) {
      sections.push({ heading: 'Temporal pattern', bullets: topCounts(byMonth, 18).map(function (x) { return x[0] + ': ' + x[1] + ' visits'; }) });
    }
    if (spec.studyType === 'profile') {
      var perPatient = (patients || []).map(function (p) { return (p.visits || []).length; });
      sections.push({
        heading: 'Cohort profile findings',
        paragraphs: [
          'Median documented visits per included patient: ' + (median(perPatient) == null ? 'not available' : median(perPatient).toFixed(1)) + '.',
          'Observed visit-count range: ' + (perPatient.length ? (Math.min.apply(Math, perPatient) + ' to ' + Math.max.apply(Math, perPatient)) : 'not available') + '. No demographic value was inferred from missing fields.'
        ]
      });
    }
    if (spec.studyType === 'outcomes' || pain.length) {
      var painText = pain.length ? (pain.length + ' pain scores were explicitly parsed from stored notes; mean documented score ' + mean(pain.map(function (x) { return x.score; })).toFixed(1) + '/10.') : 'No structured pain scores could be parsed from the included records.';
      if (painChanges.length) painText += ' Among ' + painChanges.length + ' patients with at least two dated scores, mean first-to-last change was ' + mean(painChanges).toFixed(1) + ' points (descriptive; not causal).';
      sections.push({ heading: 'Documented outcomes', paragraphs: [painText] });
    }
    var comparison = null;
    if (spec.studyType === 'procedure' && spec.cohort.keywords && spec.cohort.keywords.length >= 2) {
      comparison = buildComparisonCohorts(patients, safeSpec.cohort.keywords);
      sections.push({
        heading: 'Mutually exclusive procedure comparison cohorts',
        paragraphs: [
          'Each patient is assigned to exactly one comparison group. Patients documented in multiple groups are disclosed and excluded from between-group counts.',
          'Arm results are descriptive summaries of stored documentation only; they do not establish comparative effectiveness or causation.'
        ],
        bullets: comparison.groups.map(function (group) {
          var visitsMean = group.meanIncludedVisitsPerPatient == null ? 'not available' : group.meanIncludedVisitsPerPatient.toFixed(1);
          var painMean = group.meanDocumentedPainScore == null ? 'not available' : group.meanDocumentedPainScore.toFixed(1) + '/10';
          var pairedChange = group.meanFirstToLastPainChange == null ? 'not available' :
            ((group.meanFirstToLastPainChange > 0 ? '+' : '') + group.meanFirstToLastPainChange.toFixed(1) + ' points');
          return group.label + ': ' + group.patientCount + ' mutually exclusive patients; ' +
            group.matchingVisitCount + ' matching visit records; mean included visits/patient ' + visitsMean +
            '; documented pain scores ' + group.documentedPainScoreCount + ' (mean ' + painMean + ')' +
            '; paired dated first-to-last pain change ' + pairedChange + ' across ' + group.pairedPainPatientCount + ' patients';
        }).concat([
          'Overlap excluded: ' + comparison.overlapPatients + ' patients',
          'Unmatched excluded: ' + comparison.unmatchedPatients + ' patients'
        ])
      });
    } else if (spec.cohort.keywords && spec.cohort.keywords.length) {
      sections.push({
        heading: 'Cohort-term evidence',
        bullets: safeSpec.cohort.keywords.map(function (term) {
          var n = visits.filter(function (v) { return recordMentions(v, term); }).length;
          return term + ': documented in ' + n + ' included visit records';
        })
      });
    }
    if (spec.studyType === 'custom') {
      var qTerms = meaningfulQuestionTerms(safeSpec.question);
      if (qTerms.length) {
        sections.push({
          heading: 'Question-specific documentation',
          paragraphs: ['These are documentation counts, not inferred diagnoses or causal effects.'],
          bullets: qTerms.map(function (term) {
            return term + ': mentioned in ' + visits.filter(function (v) { return recordMentions(v, term); }).length + ' of ' + visits.length + ' included visit records';
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
        heading: 'Documented safety-signal terms',
        paragraphs: ['The following are text mentions that require clinical review; a mention is not proof of an adverse event.'],
        bullets: safety.map(function (x) { return x[0] + ': ' + x[1] + ' visit records'; })
      });
    }
    var limitations = [
      'This is a retrospective descriptive report from data stored in MLS, not a randomized or causal analysis.',
      'Absence of a documented finding does not prove the finding was absent.',
      'Clinical interpretation, compliance review, and any required IRB determination remain the responsibility of the practice.'
    ];
    if (meta.scope && meta.scope.excludedUndated) limitations.push(meta.scope.excludedUndated + ' undated records were excluded because the request specified a date window.');
    if (meta.scope && meta.scope.excludedOutOfRange) limitations.push(meta.scope.excludedOutOfRange + ' records fell outside the requested date window.');
    if (meta.duplicateVisitsRemoved) limitations.push(meta.duplicateVisitsRemoved + ' duplicate visit records were removed before analysis.');
    if (meta.ambiguousRecordsSkipped) limitations.push(meta.ambiguousRecordsSkipped + ' records without a unique stable-ID or exact unique name+DOB match were excluded to prevent cross-patient mixing.');
    if (meta.identityConflicts) limitations.push(meta.identityConflicts + ' records with conflicting namespace-qualified identifiers were excluded for identity safety.');
    if (!painChanges.length && spec.studyType === 'outcomes') limitations.push('The records do not support a longitudinal pain-change estimate for two or more measurements per patient.');
    sections.push({ heading: 'Data quality and limitations', bullets: limitations });
    sections.push({
      heading: 'Reproducibility record',
      bullets: [
        'Parser version: ' + VERSION,
        'Study type: ' + typeLabel(spec.studyType),
        'Requested maximum: ' + spec.targetPages + ' pages; evidence-supported ceiling: ' + supportedCeiling + ' pages.',
        'Included records: ' + visits.length + '; included patients: ' + patients.length + '; exact duplicates removed: ' + (meta.duplicateVisitsRemoved || 0) + '.',
        'Ambiguous identity rows excluded: ' + (meta.ambiguousRecordsSkipped || 0) + '; conflicting stable-identifier rows excluded: ' + (meta.identityConflicts || 0) + '.',
        'Report policy: stop when evidence is exhausted; never add filler or invented results.'
      ]
    });
    return {
      title: typeLabel(spec.studyType) + ' - limited-data MLS study draft',
      generatedAt: new Date().toISOString(),
      spec: safeSpec,
      sections: sections,
      appendixRows: visits,
      patientCount: patients.length,
      visitCount: visits.length,
      supportedPageCeiling: supportedCeiling,
      targetPages: spec.targetPages,
      limitations: limitations,
      provenance: sourceCounts,
      comparison: comparison,
      deidentified: false,
      privacyMode: 'direct-identifiers-removed-limited-data-draft',
      privacyWarning: PRIVACY_WARNING
    };
  }

  function pdfSafe(v) {
    return S(v).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, '-').replace(/\u2022/g, '*').replace(/[^\x20-\xFF\n\t]/g, ' ');
  }
  function renderDetailedPdf(jsPDF, model) {
    if (!jsPDF) throw new Error('PDF renderer unavailable');
    var doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var M = 50, y = 64, pages = 1, maxPages = Math.min(MAX_REPORT_PAGES, model.supportedPageCeiling), truncated = false;
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

    doc.setTextColor(32, 64, 52); text('MLS Scribe', 12, { bold: true, after: 28 });
    doc.setTextColor(20, 28, 24); text(model.title, 22, { bold: true, after: 14 });
    text('Generated ' + new Date(model.generatedAt).toLocaleString(), 10, { after: 18 });
    text(model.patientCount + ' coded patients | ' + model.visitCount + ' stored visit records', 12, { bold: true, after: 16 });
    text(PRIVACY_WARNING, 10, { bold: true, after: 10 });
    text('Evidence policy: this report stops when the stored evidence is exhausted. It is not padded to a page target. Exported visit dates use month precision.', 10, { after: 14 });
    text('Requested maximum: ' + model.targetPages + ' pages | Evidence-supported ceiling: ' + maxPages + ' pages', 10, { bold: true });
    if (pages < maxPages) nextPage();

    model.sections.some(function (section) {
      if (!heading(section.heading)) return true;
      var stopped = false;
      (section.paragraphs || []).some(function (p) { if (!text(p, 10)) { stopped = true; return true; } return false; });
      if (stopped) return true;
      (section.bullets || []).some(function (b) { if (!text('- ' + b, 9.5, { indent: 10, after: 2 })) { stopped = true; return true; } return false; });
      y += 7;
      return stopped;
    });

    if (!truncated && model.appendixRows.length) {
      heading('Limited-data evidence appendix');
      text('One row per included stored visit. Common direct identifiers are scrubbed where detectable; clinician/privacy review is still required.', 9, { after: 8 });
      model.appendixRows.some(function (r, idx) {
        if (!need(42) && truncated) return true;
        if (!text((idx + 1) + '. ' + r.code + ' | ' + (r.date || 'date not recorded') + ' | ' + r.type + ' | source: ' + r.source, 9, { bold: true, after: 2 })) return true;
        if (r.detail && !text(r.detail, 8.5, { indent: 10, after: 7 })) return true;
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
      ['Patient code', 'Comparison group', 'Visit date', 'Visit type', 'Source', 'Detail']
    ];
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
    var scoped, deid, model;
    return waitForEngine(options).then(function (sg) {
      progress('Reading and de-duplicating stored visit evidence...');
      var env = options.env || root;
      var records = options.records || collectStoredRecords(env);
      var resolved = resolveRecords(spec, records, sg, doc, options);
      progress('Applying cohort and date rules...');
      scoped = applyScope(resolved.records, spec, options.now);
      if (!scoped.patientCount) throw studyError('empty-cohort', 'No stored patients match that cohort and date range. Try a broader term or time range.');
      if (!scoped.visitCount) throw studyError('empty-evidence', 'The matching patients have no stored visit evidence to analyze yet. Add or pull visit history, then retry.');
      deid = deidentifyPatients(scoped.patients);
      model = buildReportModel(spec, deid, {
        scope: scoped.scope,
        resolvedCohort: resolved.resolved,
        duplicateVisitsRemoved: (resolved.records.provenance || {}).duplicateVisitsRemoved || 0,
        ambiguousRecordsSkipped: (resolved.records.provenance || {}).ambiguousRecordsSkipped || 0,
        identityConflicts: (resolved.records.provenance || {}).identityConflicts || 0,
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
          svg: scopedVisual(engineResult, spec, scoped)
        };
      }).catch(function (e) {
        return {
          spec: model.spec, scoped: publicScopedSummary(scoped), limitedDataPatients: deid, model: model,
          engineResult: engineResult, xlsxBlob: engineResult && engineResult.xlsxBlob,
          xlsxFallback: true,
          svg: scopedVisual(engineResult, spec, scoped), pdfError: e.message
        };
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
      ['Report', 'Up to ' + spec.targetPages + ' evidence-supported pages'], ['Privacy', 'Direct identifiers scrubbed; review required']
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
    if (pdf) downloads += '<a class="sr-download" href="' + pdf + '" download="' + esc(filename(result.spec.studyType, 'pdf')) + '">Detailed PDF</a>';
    if (xlsx) downloads += '<a class="sr-download sr-secondary" href="' + xlsx + '" download="' + esc(filename(result.spec.studyType, result.xlsxFallback ? 'csv' : 'xlsx')) + '">Limited-data export</a>';
    out.innerHTML = '<div class="sr-result-head"><div><h4>Study ready</h4><div class="sr-result-meta">' +
      esc(result.pdfPages ? (result.pdfPages + ' evidence-supported pages; requested maximum ' + result.spec.targetPages + '.') : ('Report model ready. ' + (result.pdfError || 'PDF unavailable.'))) +
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
    renderSpec(spec); setStatus('Interpreting your request...', 'progress');
    var resultBox = box && box.querySelector('#mlsStudyResults'); if (resultBox) resultBox.hidden = true;
    uiRunPromise = executeSpec(spec, { token: token, onProgress: function (m) { if (token === generation) setStatus(m, 'progress'); } })
      .then(function (result) {
        if (token !== generation) return result;
        lastResult = result; renderResult(result);
        setStatus(result.pdfPages ? ('Ready: ' + result.pdfPages + '-page report built from ' + result.scoped.visitCount + ' stored visits. It stopped at the evidence-supported length.') : ('Study completed, but the PDF needs a retry: ' + result.pdfError), result.pdfPages ? 'done' : 'error');
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
      '<h3 id="mlsStudyRequestTitle">Describe the study. MLS builds it from your stored evidence.</h3>' +
      '<p class="sr-lede">Type the cohort, question, and time range in plain language. Press Enter - no setup steps required. Outputs scrub common direct identifiers, remain limited-data drafts requiring clinician/privacy review, and expand only as far as the evidence supports, up to 30 pages.</p>' +
      '<div class="sr-compose"><textarea id="mlsStudyPrompt" rows="2" aria-label="Describe the study to build" aria-keyshortcuts="Enter" placeholder="Example: Compare outcomes for patients who received lumbar epidural injections in the last 12 months, up to 30 pages"></textarea>' +
      '<button type="button" id="mlsStudySubmit" aria-label="Generate this study" title="Generate study">&#8593;</button></div>' +
      '<div class="sr-hint"><span>Enter to generate - Shift+Enter for a new line</span><span class="sr-example">Uses visits, notes, and calendar records already stored in MLS</span></div>' +
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

/* =============================================================================
 * MLS Scribe /p1 stored-evidence provenance guard
 * window.__mlsP1StudyProvenance  (p1sp-1.0.0)
 *
 * Additive P1-only layer over __mlsStudyRequest. It does not read Athena, alter
 * patients, or rewrite visits. It verifies the already-produced study result,
 * states the exact stored-data boundary, and adds a PHI-free coverage receipt.
 * Exports fail closed when the result, model, source, and range counts cannot be
 * reconciled. The small durable receipt contains aggregate counts only.
 * ========================================================================== */
(function (root, factory) {
  'use strict';
  /* Browser installation is fail-closed to the reviewed /p1 shell. A copied
     script tag on the regular site must not wrap its study engine or retire a
     live owner. CommonJS has no document and remains available to tests. */
  var preview = root && root.__MLS_P1_PREVIEW;
  if (root && root.document && !(preview && preview.enabled === true &&
      (preview.route === '/1p/' || preview.route === '/1pScribeFlow.html') && preview.build)) return;
  var previous = root && root.__mlsP1StudyProvenance;
  if (previous && previous.installed && typeof previous.revert === 'function') {
    try { previous.revert(); } catch (e) {}
  }
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.__mlsP1StudyProvenance = api;
    if (root.document) api.boot();
  }
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var VERSION = 'p1sp-1.0.0';
  var STORE_VERSION = 1;
  var STORE_NAME = 'p1StudyCoverageReceiptsV1';
  var STORE_SCOPE_PROBE = 'p1StudyCoverageReceiptsScopeProbeV1';
  var MAX_RECEIPTS = 24;
  var STYLE_ID = 'p1StudyProvenanceCss';
  var UI_ID = 'p1StudyCoverageReceipt';
  var installTimer = null;
  var resultObserver = null;
  var installedEngine = null;
  var originals = null;
  var wrappers = null;
  var enrichCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  var resultOwners = typeof WeakMap === 'function' ? new WeakMap() : null;
  var objectUrls = [];
  var lastDiagnostic = { status: 'not-run', receiptId: '', counts: null };

  function S(value) { return value == null ? '' : String(value); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function finiteInt(value) {
    var n = Number(value);
    return isFinite(n) && n >= 0 && Math.floor(n) === n ? n : null;
  }
  function pad2(n) { return ('0' + n).slice(-2); }
  function strictDate(value) {
    var m = S(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return '';
    return m[1] + '-' + m[2] + '-' + m[3];
  }
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
  function todayIso(now) {
    if (now == null) {
      try {
        if (typeof root._acctTodayKey === 'function') {
          var accountToday = strictDate(root._acctTodayKey());
          if (accountToday) return accountToday;
        }
      } catch (e) {}
    }
    if (typeof now === 'string' && strictDate(now)) return strictDate(now);
    var d = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fnv1a(text) {
    var h = 2166136261, input = S(text);
    for (var i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function stableStringify(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }
  function coverageError(code, message) {
    var error = new Error(message);
    error.code = code || 'coverage-unproven';
    return error;
  }

  var MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9,
    sept: 9, oct: 10, nov: 11, dec: 12
  };
  function boundedCalendarRange(kind, year, month, now) {
    var today = todayIso(now), currentYear = Number(today.slice(0, 4));
    year = Number(year); month = month == null ? null : Number(month);
    if (!isFinite(year) || year < 1900 || year > currentYear) {
      return { ok: false, code: year > currentYear ? 'future-range' : 'invalid-range',
        clarification: 'Choose a historical calendar year no later than ' + currentYear + '.' };
    }
    var from, to;
    if (kind === 'month') {
      if (!isFinite(month) || month < 1 || month > 12) return { ok: false, code: 'invalid-range', clarification: 'Choose a real calendar month.' };
      from = year + '-' + pad2(month) + '-01';
      to = year + '-' + pad2(month) + '-' + pad2(daysInMonth(year, month));
    } else {
      from = year + '-01-01';
      to = year + '-12-31';
    }
    if (from > today) return { ok: false, code: 'future-range', clarification: 'That range has not happened yet.' };
    if (to > today) to = today;
    return { ok: true, requestedKind: kind, range: { kind: 'dates', from: from, to: to, requestedKind: kind } };
  }
  function parseExplicitRange(query, options) {
    options = options || {};
    var text = S(query), lower = text.toLowerCase(), m;
    m = lower.match(/(?:from|between)\s+(\d{4}-\d{1,2}-\d{1,2})\s+(?:to|and|through|thru)\s+(\d{4}-\d{1,2}-\d{1,2})/i);
    if (m) {
      var from = strictDate(m[1].replace(/-(\d)(?=-|$)/g, '-0$1'));
      var to = strictDate(m[2].replace(/-(\d)(?=-|$)/g, '-0$1'));
      if (!from || !to) return { ok: false, code: 'invalid-range', clarification: 'Use real dates in YYYY-MM-DD format.' };
      if (from > to) { var swap = from; from = to; to = swap; }
      if (from > todayIso(options.now) || to > todayIso(options.now)) return { ok: false, code: 'future-range', clarification: 'Historical study ranges cannot extend beyond today.' };
      return { ok: true, requestedKind: 'custom', range: { kind: 'dates', from: from, to: to, requestedKind: 'custom' } };
    }
    m = lower.match(/\b(?:month(?:\s+of)?\s+)?(19\d{2}|20\d{2})[-\/](0?[1-9]|1[0-2])\b/);
    if (m && (/(?:\bmonth\b|\bfor\b|\bin\b|\bduring\b)/.test(lower) || !/\d{4}-\d{1,2}-\d{1,2}/.test(lower))) {
      return boundedCalendarRange('month', Number(m[1]), Number(m[2]), options.now);
    }
    m = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(19\d{2}|20\d{2})\b/);
    if (m) return boundedCalendarRange('month', Number(m[2]), MONTHS[m[1]], options.now);
    m = lower.match(/\b(?:calendar\s+year|year|during|in|for)\s+(19\d{2}|20\d{2})\b/);
    if (m && !/\d{4}-\d{1,2}-\d{1,2}/.test(lower)) return boundedCalendarRange('year', Number(m[1]), null, options.now);
    return null;
  }
  function rewriteQueryRange(query, explicit) {
    if (!explicit || !explicit.ok || !explicit.range || explicit.requestedKind === 'custom') return S(query);
    return S(query).replace(/\s+$/g, '') + ' from ' + explicit.range.from + ' through ' + explicit.range.to;
  }
  function upgradedSpec(query, parser, options) {
    var spec = typeof query === 'object' && query ? clone(query) : parser(S(query), options || {});
    var explicit = typeof query === 'string' ? parseExplicitRange(query, options || {}) : null;
    if (explicit && !explicit.ok) return explicit;
    if (explicit && explicit.range && spec && spec.ok) spec.range = explicit.range;
    return spec;
  }

  function sourceMode(raw) {
    var value = S(raw).toLowerCase().replace(/[^a-z0-9_-]+/g, ' ').trim();
    if (/athena|mls-app|cohort-injection/.test(value)) return 'athena-derived';
    if (/harvester/.test(value)) return 'merged-harvester';
    if (/calendar|appt/.test(value)) return 'calendar';
    if (/patient-note|mls-note|saved-note|note-record/.test(value)) return 'saved-note';
    if (/patient-record|visit-model/.test(value)) return 'patient-record';
    if (/study-group|import/.test(value)) return 'study-group-or-import';
    if (/manual/.test(value)) return 'manual-entry';
    return 'other-stored';
  }
  function aggregateSources(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (raw) {
      var n = finiteInt(map[raw]);
      if (n == null) return;
      var mode = sourceMode(raw);
      out[mode] = (out[mode] || 0) + n;
    });
    return Object.keys(out).sort().map(function (mode) { return { mode: mode, count: out[mode] }; });
  }
  function sumSources(rows) { return (rows || []).reduce(function (n, row) { return n + row.count; }, 0); }
  function limitationCount(model, expression) {
    var text = [];
    (model && model.limitations || []).forEach(function (v) { text.push(S(v)); });
    (model && model.sections || []).forEach(function (section) {
      (section.bullets || []).forEach(function (v) { text.push(S(v)); });
    });
    for (var i = 0; i < text.length; i++) {
      var hit = text[i].match(expression);
      if (hit) return finiteInt(hit[1]) || 0;
    }
    return 0;
  }
  function normalizedRange(spec, scoped, visitDates) {
    var range = spec && spec.range || {}, scope = scoped && scoped.scope || {};
    var months = (visitDates || []).filter(Boolean).map(function (d) { return d.slice(0, 7); }).sort();
    if (range.kind === 'dates') {
      var from = strictDate(range.from), to = strictDate(range.to);
      if (!from || !to || from > to) throw coverageError('coverage-range-invalid', 'The requested date range could not be verified.');
      return { kind: range.requestedKind || 'custom', from: from, to: to,
        label: from + ' through ' + to, includedDatePrecision: 'month-in-limited-data-result' };
    }
    if (range.kind === 'months') {
      var fm = S(scope.fromMonth), tm = S(scope.toMonth);
      if (!/^\d{4}-\d{2}$/.test(fm) || !/^\d{4}-\d{2}$/.test(tm) || fm > tm) {
        throw coverageError('coverage-range-invalid', 'The rolling month range could not be verified.');
      }
      return { kind: 'rolling-months', months: finiteInt(range.months), fromMonth: fm, toMonth: tm,
        label: 'Last ' + finiteInt(range.months) + ' months (' + fm + ' through ' + tm + ')', includedDatePrecision: 'month' };
    }
    if (range.kind === 'month-window') {
      var windowFrom = S(range.fromMonth || scope.fromMonth), windowTo = S(range.toMonth || scope.toMonth);
      if (!/^\d{4}-\d{2}$/.test(windowFrom) || !/^\d{4}-\d{2}$/.test(windowTo) || windowFrom > windowTo) {
        throw coverageError('coverage-range-invalid', 'The limited-data month window could not be verified.');
      }
      return { kind: 'month-window', fromMonth: windowFrom, toMonth: windowTo,
        label: windowFrom === windowTo ? windowFrom : windowFrom + ' through ' + windowTo,
        includedDatePrecision: 'month' };
    }
    if (range.kind !== 'all') throw coverageError('coverage-range-invalid', 'The study used an unsupported date range.');
    return { kind: 'all-stored-dates', fromMonth: months[0] || '', toMonth: months[months.length - 1] || '',
      label: months.length ? ('All stored dates (' + months[0] + ' through ' + months[months.length - 1] + ')') : 'All stored dates (no dated records)',
      includedDatePrecision: 'month' };
  }
  var ANALYSIS_BASES = {
    incremental: 'Change means aggregate stored-evidence counts since the prior verified receipt; it is not proof of a complete EHR delta sync.',
    procedure: 'Procedure results are documented text or code signals in included stored records; they do not by themselves prove performance, billing, or clinical appropriateness.',
    diagnosis: 'Diagnosis cohorts are based on documented text or code mentions in included stored records; text matching does not distinguish negation, and missing documentation is not absence of disease.',
    age: 'Age uses a stored date of birth at the last included dated record, or the report date when no included record is dated; missing DOB stays missing and ages 90 or older are grouped.',
    count: 'Counts are deduplicated records presently stored in MLS, not a claim that every encounter in the practice or EHR was captured.',
    outcome: 'Outcomes use only explicitly documented measures; missing measures are not negative outcomes and descriptive changes are not causal effects.'
  };
  function analysisKind(spec) {
    var allowed = { outcomes: 1, volume: 1, procedure: 1, profile: 1, custom: 1 };
    return allowed[spec && spec.studyType] ? spec.studyType : 'custom';
  }
  function safeGeneratedAt(value) {
    var text = S(value);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) ? text : new Date().toISOString();
  }
  function buildReceipt(result) {
    if (!result || !result.spec || !result.scoped || !result.model) {
      throw coverageError('coverage-result-incomplete', 'The study result did not include the scope metadata required for export.');
    }
    var engineMarker = result.engineResult && result.engineResult.engine;
    if (engineMarker !== '__mlsStudyGroups.analyze/chartSVG' || result.engineResult.inMemory !== true) {
      throw coverageError('coverage-engine-unverified', 'The study engine did not return its in-memory scope proof.');
    }
    var patients = Array.isArray(result.limitedDataPatients) ? result.limitedDataPatients : [];
    var visits = [], dates = [], includedUndated = 0;
    patients.forEach(function (patient) {
      (patient && Array.isArray(patient.visits) ? patient.visits : []).forEach(function (visit) {
        visit = visit || {}; visits.push(visit);
        var date = S(visit.date).trim();
        if (!date) includedUndated++; else if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(date)) dates.push(date);
        else throw coverageError('coverage-date-invalid', 'An included record had an unverifiable date value.');
      });
    });
    var included = finiteInt(result.scoped.visitCount), patientCount = finiteInt(result.scoped.patientCount);
    var modelVisits = finiteInt(result.model.visitCount), modelPatients = finiteInt(result.model.patientCount);
    if (included == null || patientCount == null || included !== visits.length || included !== modelVisits ||
        patientCount !== patients.length || patientCount !== modelPatients) {
      throw coverageError('coverage-count-mismatch', 'Stored-evidence counts did not reconcile across the study result and report model.');
    }
    var modes = aggregateSources(result.model.provenance || {});
    if (included > 0 && (!modes.length || sumSources(modes) !== included)) {
      throw coverageError('coverage-source-mismatch', 'Stored-evidence source counts did not reconcile with included records.');
    }
    var scope = result.scoped.scope || {};
    if (!Object.prototype.hasOwnProperty.call(scope, 'excludedUndated') ||
        !Object.prototype.hasOwnProperty.call(scope, 'excludedOutOfRange')) {
      throw coverageError('coverage-exclusions-missing', 'The study did not report both undated and out-of-range exclusions.');
    }
    var excludedUndated = finiteInt(scope.excludedUndated);
    var excludedOutOfRange = finiteInt(scope.excludedOutOfRange);
    if (excludedUndated == null || excludedOutOfRange == null) {
      throw coverageError('coverage-exclusions-invalid', 'Excluded-record counts were not verifiable.');
    }
    var rangeSpec = result.p1RequestedRange ? { range: result.p1RequestedRange } : result.spec;
    var range = normalizedRange(rangeSpec, result.scoped, dates);
    if (range.kind !== 'all-stored-dates' && includedUndated) {
      throw coverageError('coverage-undated-in-range', 'An undated record was included in a date-bounded analysis.');
    }
    var fromMonth = range.from ? range.from.slice(0, 7) : range.fromMonth;
    var toMonth = range.to ? range.to.slice(0, 7) : range.toMonth;
    if (fromMonth && toMonth && range.kind !== 'all-stored-dates') {
      if (dates.some(function (d) { var m = d.slice(0, 7); return m < fromMonth || m > toMonth; })) {
        throw coverageError('coverage-out-of-range-included', 'An included record fell outside the disclosed date range.');
      }
    }
    var duplicates = limitationCount(result.model, /(\d+) duplicate visit records? (?:were|was) removed/i);
    var ambiguous = limitationCount(result.model, /(\d+) records? without a unique stable-ID/i);
    var conflicts = limitationCount(result.model, /(\d+) records? with conflicting namespace-qualified identifiers/i);
    var unknownAge = patients.filter(function (p) { return p && p.ageYears == null; }).length;
    var kind = analysisKind(result.spec);
    var cohortMode = ({ all: 1, keyword: 1, selected: 1, auto: 1 })[result.spec.cohort && result.spec.cohort.mode]
      ? result.spec.cohort.mode : 'auto';
    var receipt = {
      schema: 'mls-p1-study-coverage-receipt-v1',
      engine: 'stored-evidence-deterministic-v1',
      generatedAt: safeGeneratedAt(result.model.generatedAt),
      status: 'verified-stored-scope',
      analysisKind: kind,
      cohortMode: cohortMode,
      range: range,
      counts: {
        includedPatients: patientCount,
        includedRecords: included,
        includedDatedRecords: included - includedUndated,
        includedUndatedRecords: includedUndated,
        excludedUndatedRecords: excludedUndated,
        excludedOutOfRangeRecords: excludedOutOfRange,
        exactDuplicatesRemoved: duplicates,
        ambiguousIdentityRowsExcluded: ambiguous,
        conflictingIdentityRowsExcluded: conflicts,
        ageKnownPatients: patientCount - unknownAge,
        ageMissingPatients: unknownAge
      },
      sourceModes: modes,
      coverageBoundary: 'records-presently-stored-in-mls-only',
      wholePracticeCoverageProven: false,
      dataMeaning: included + ' deduplicated stored visit record' + (included === 1 ? '' : 's') + ' for ' + patientCount +
        ' coded patient' + (patientCount === 1 ? '' : 's') + ' within ' + range.label +
        '. This represents only records presently stored in connected MLS sources, not a complete EHR or whole-practice history.',
      analysisBases: clone(ANALYSIS_BASES)
    };
    receipt.id = 'p1cov-' + fnv1a(stableStringify(receipt));
    return receipt;
  }

  function receiptKey(env) {
    try {
      if (!env || typeof env.uns !== 'function') return '';
      var key = S(env.uns(STORE_NAME));
      var probe = S(env.uns(STORE_SCOPE_PROBE));
      if (!key || !probe || key.length > 600 || probe.length > 600 ||
          key === STORE_NAME || probe === STORE_SCOPE_PROBE ||
          key.slice(-STORE_NAME.length) !== STORE_NAME ||
          probe.slice(-STORE_SCOPE_PROBE.length) !== STORE_SCOPE_PROBE) return '';
      var prefix = key.slice(0, -STORE_NAME.length);
      var probePrefix = probe.slice(0, -STORE_SCOPE_PROBE.length);
      if (!prefix || prefix !== probePrefix || /(?:^|::)_::$/.test(prefix) ||
          /::(?:undefined|null)::/i.test(prefix)) return '';
      if (Object.prototype.hasOwnProperty.call(env, '__mlsSessionAccount')) {
        var account = S(env.__mlsSessionAccount).trim().toLowerCase();
        if (!account || prefix.toLowerCase().indexOf('::' + account + '::') < 0) return '';
      }
      return key;
    } catch (e) { return ''; }
  }
  function sessionOwner(env) {
    env = env || root;
    var key = receiptKey(env);
    if (!key) return null;
    return {
      key: key,
      account: Object.prototype.hasOwnProperty.call(env, '__mlsSessionAccount') ? S(env.__mlsSessionAccount).trim().toLowerCase() : '',
      epoch: Object.prototype.hasOwnProperty.call(env, '__mlsSessionEpoch') ? S(env.__mlsSessionEpoch) : ''
    };
  }
  function sessionCurrent(owner, env) {
    if (!owner) return false;
    env = env || root;
    if (receiptKey(env) !== owner.key) return false;
    if (Object.prototype.hasOwnProperty.call(env, '__mlsSessionAccount') &&
        S(env.__mlsSessionAccount).trim().toLowerCase() !== owner.account) return false;
    if (Object.prototype.hasOwnProperty.call(env, '__mlsSessionEpoch') && S(env.__mlsSessionEpoch) !== owner.epoch) return false;
    return true;
  }
  function requireCurrentSession(owner, env) {
    if (!sessionCurrent(owner, env)) throw coverageError('coverage-session-changed', 'The signed-in account changed before this study finished. Run it again in the current account.');
  }
  function deltaFrom(previous, current) {
    if (!previous) return { status: 'first-observed-snapshot', priorReceiptId: '', includedRecordDelta: null, includedPatientDelta: null };
    return {
      status: 'compared-with-prior-receipt',
      priorReceiptId: S(previous.id),
      includedRecordDelta: current.counts.includedRecords - previous.counts.includedRecords,
      includedPatientDelta: current.counts.includedPatients - previous.counts.includedPatients
    };
  }
  function persistReceipt(receipt, env, frozenKey) {
    env = env || root;
    var storage = env.localStorage, key = receiptKey(env);
    if (!storage || !key || (frozenKey && key !== frozenKey)) {
      receipt.incremental = { status: 'durable-receipt-unavailable', priorReceiptId: '', includedRecordDelta: null, includedPatientDelta: null };
      return { ok: false, reason: 'account-storage-unavailable', receipt: receipt };
    }
    var envelope;
    try {
      var raw = storage.getItem(key);
      envelope = raw ? JSON.parse(raw) : { version: STORE_VERSION, receipts: [] };
      if (!envelope || envelope.version !== STORE_VERSION || !Array.isArray(envelope.receipts)) {
        return { ok: false, reason: 'existing-manifest-unverified', receipt: receipt };
      }
      if (raw) {
        var priorChecksum = fnv1a(stableStringify({ version: envelope.version, receipts: envelope.receipts }));
        if (envelope.checksum !== priorChecksum) return { ok: false, reason: 'existing-manifest-unverified', receipt: receipt };
      }
      var prior = null;
      for (var i = envelope.receipts.length - 1; i >= 0; i--) {
        var candidate = envelope.receipts[i];
        if (candidate && candidate.id !== receipt.id && candidate.analysisKind === receipt.analysisKind &&
            stableStringify(candidate.range) === stableStringify(receipt.range)) { prior = candidate; break; }
      }
      receipt.incremental = deltaFrom(prior, receipt);
      var already = envelope.receipts.some(function (item) { return item && item.id === receipt.id; });
      if (!already) envelope.receipts.push(clone(receipt));
      envelope.receipts = envelope.receipts.slice(-MAX_RECEIPTS);
      envelope.checksum = fnv1a(stableStringify({ version: envelope.version, receipts: envelope.receipts }));
      var serialized = JSON.stringify(envelope);
      if (receiptKey(env) !== key) return { ok: false, reason: 'account-session-changed', receipt: receipt };
      storage.setItem(key, serialized);
      if (receiptKey(env) !== key) return { ok: false, reason: 'account-session-changed', receipt: receipt };
      var check = JSON.parse(storage.getItem(key) || 'null');
      var expected = check && fnv1a(stableStringify({ version: check.version, receipts: check.receipts }));
      if (!check || check.version !== STORE_VERSION || check.checksum !== expected ||
          !check.receipts.some(function (item) { return item && item.id === receipt.id; })) {
        return { ok: false, reason: 'manifest-readback-failed', receipt: receipt };
      }
      return { ok: true, reason: '', receipt: receipt };
    } catch (e) {
      receipt.incremental = receipt.incremental || { status: 'durable-write-failed', priorReceiptId: '', includedRecordDelta: null, includedPatientDelta: null };
      return { ok: false, reason: 'manifest-write-failed', receipt: receipt };
    }
  }

  function coverageRows(receipt, persisted) {
    var c = receipt.counts, rows = [
      ['MLS P1 stored-evidence coverage receipt'],
      ['Receipt ID', receipt.id], ['Status', receipt.status], ['Analysis', receipt.analysisKind],
      ['Range', receipt.range.label], ['Coverage boundary', receipt.coverageBoundary],
      ['Included patients', c.includedPatients], ['Included records', c.includedRecords],
      ['Included dated records', c.includedDatedRecords], ['Included undated records', c.includedUndatedRecords],
      ['Excluded undated records', c.excludedUndatedRecords], ['Excluded out-of-range records', c.excludedOutOfRangeRecords],
      ['Exact duplicates removed', c.exactDuplicatesRemoved], ['Ambiguous identity rows excluded', c.ambiguousIdentityRowsExcluded],
      ['Conflicting identity rows excluded', c.conflictingIdentityRowsExcluded],
      ['Age known / missing patients', c.ageKnownPatients + ' / ' + c.ageMissingPatients],
      ['Whole-practice coverage proven', 'No'], ['Durable receipt verified', persisted ? 'Yes' : 'No'],
      ['Data meaning', receipt.dataMeaning], [], ['Source mode', 'Included records']
    ];
    receipt.sourceModes.forEach(function (source) { rows.push([source.mode, source.count]); });
    rows.push([]); rows.push(['Analysis interpretation', 'Boundary']);
    Object.keys(receipt.analysisBases).forEach(function (key) { rows.push([key, receipt.analysisBases[key]]); });
    rows.push([]); rows.push(['Incremental snapshot status', receipt.incremental && receipt.incremental.status || 'not available']);
    rows.push(['Included-record delta', receipt.incremental && receipt.incremental.includedRecordDelta == null ? 'not available' : receipt.incremental.includedRecordDelta]);
    rows.push(['Included-patient delta', receipt.incremental && receipt.incremental.includedPatientDelta == null ? 'not available' : receipt.incremental.includedPatientDelta]);
    return rows;
  }
  function csvCell(value) { return '"' + S(value).replace(/"/g, '""') + '"'; }
  function receiptCsv(receipt, persisted) {
    var csv = coverageRows(receipt, persisted).map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
    try { return new root.Blob([csv], { type: 'text/csv;charset=utf-8' }); } catch (e) { return csv; }
  }
  function coverageSection(receipt, persisted) {
    var c = receipt.counts;
    return {
      key: 'p1-coverage-provenance',
      heading: 'Stored-data coverage and provenance receipt',
      paragraphs: [receipt.dataMeaning],
      bullets: [
        'Date accounting: ' + c.includedDatedRecords + ' dated and ' + c.includedUndatedRecords + ' undated included; ' +
          c.excludedUndatedRecords + ' undated and ' + c.excludedOutOfRangeRecords + ' out-of-range excluded.',
        'Source modes: ' + (receipt.sourceModes.map(function (row) { return row.mode + ' ' + row.count; }).join('; ') || 'none') + '.',
        'Data-quality exclusions: ' + c.exactDuplicatesRemoved + ' exact duplicates; ' + c.ambiguousIdentityRowsExcluded +
          ' ambiguous identity rows; ' + c.conflictingIdentityRowsExcluded + ' conflicting identity rows.',
        'Age availability: ' + c.ageKnownPatients + ' known and ' + c.ageMissingPatients + ' missing among included coded patients.',
        'Incremental comparison: ' + (receipt.incremental && receipt.incremental.status || 'not available') +
          (receipt.incremental && receipt.incremental.includedRecordDelta != null ? '; stored-record delta ' + receipt.incremental.includedRecordDelta + '.' : '.'),
        'Durable aggregate receipt: ' + (persisted ? 'write/read verified.' : 'not available; use the attached coverage export for this run.'),
        ANALYSIS_BASES.procedure, ANALYSIS_BASES.diagnosis, ANALYSIS_BASES.count, ANALYSIS_BASES.outcome
      ]
    };
  }
  function appendCoverageModel(result, receipt, persisted) {
    var sections = result.model && result.model.sections;
    if (!Array.isArray(sections)) throw coverageError('coverage-model-invalid', 'The report model could not carry its provenance receipt.');
    for (var i = sections.length - 1; i >= 0; i--) if (sections[i] && sections[i].key === 'p1-coverage-provenance') sections.splice(i, 1);
    var at = sections.findIndex(function (section) { return section && section.key === 'stat-methods'; });
    sections.splice(at < 0 ? Math.min(3, sections.length) : at, 0, coverageSection(receipt, persisted));
  }

  function rerenderPdf(result, engine) {
    if (!result.pdfBlob || !engine || typeof engine.renderDetailedPdf !== 'function' || typeof engine.getJsPDF !== 'function') {
      return Promise.resolve(false);
    }
    return Promise.resolve(engine.getJsPDF()).then(function (jsPDF) {
      var rendered = engine.renderDetailedPdf(jsPDF, result.model);
      if (!rendered || !rendered.pdfBlob) throw new Error('coverage PDF render returned no file');
      result.pdfBlob = rendered.pdfBlob;
      result.pdfPages = rendered.pageCount;
      result.reportTruncatedAtEvidenceCeiling = rendered.truncated;
      result.supportedPageCeiling = rendered.supportedPageCeiling;
      result.p1CoveragePdfEmbedded = true;
      return true;
    }).catch(function () {
      result.p1CoveragePdfEmbedded = false;
      return false;
    });
  }
  function enrichResult(result, options) {
    options = options || {};
    if (enrichCache && result && enrichCache.has(result)) return enrichCache.get(result);
    var env = options.env || root;
    var owner = options.owner || sessionOwner(env);
    var promise = Promise.resolve().then(function () {
      requireCurrentSession(owner, env);
      var receipt = buildReceipt(result);
      var saved = persistReceipt(receipt, env, owner.key);
      requireCurrentSession(owner, env);
      receipt = saved.receipt;
      appendCoverageModel(result, receipt, saved.ok);
      result.p1CoverageReceipt = receipt;
      result.p1CoverageDurable = saved.ok;
      result.p1CoveragePersistenceReason = saved.reason || '';
      result.p1CoverageCsvBlob = receiptCsv(receipt, saved.ok);
      result.p1CoverageVerified = true;
      lastDiagnostic = { status: 'verified', receiptId: receipt.id, counts: clone(receipt.counts) };
      return rerenderPdf(result, options.engine || installedEngine).then(function () {
        requireCurrentSession(owner, env);
        if (resultOwners && result) resultOwners.set(result, owner);
        return result;
      });
    }).catch(function (error) {
      if (result) {
        result.p1CoverageVerified = false;
        result.p1CoverageErrorCode = error && error.code || 'coverage-unproven';
      }
      lastDiagnostic = { status: 'coverage-unproven', receiptId: '', counts: null };
      throw error;
    });
    if (enrichCache && result) enrichCache.set(result, promise);
    return promise;
  }

  function rememberUrl(blob) {
    if (!blob || !root.URL || typeof root.URL.createObjectURL !== 'function') return '';
    try { var url = root.URL.createObjectURL(blob); objectUrls.push(url); return url; } catch (e) { return ''; }
  }
  function clearUrls() {
    objectUrls.forEach(function (url) { try { root.URL.revokeObjectURL(url); } catch (e) {} });
    objectUrls = [];
  }
  function textEl(doc, tag, value) { var el = doc.createElement(tag); el.textContent = value; return el; }
  function scrubStudyUi() {
    clearUrls();
    var doc = root.document; if (!doc) return;
    var input = doc.getElementById('mlsStudyPrompt'); if (input) input.value = '';
    var spec = doc.getElementById('mlsStudySpec'); if (spec) { spec.textContent = ''; spec.hidden = true; }
    var status = doc.getElementById('mlsStudyStatus'); if (status) { status.textContent = ''; status.hidden = true; }
    var out = doc.getElementById('mlsStudyResults');
    if (out) { out.textContent = ''; out.hidden = true; out.removeAttribute('data-p1-coverage-id'); }
  }
  function onSessionBoundary() {
    lastDiagnostic = { status: 'not-run', receiptId: '', counts: null };
    scrubStudyUi();
  }
  function failClosedUi(error) {
    var doc = root.document, out = doc && doc.getElementById('mlsStudyResults'); if (!out) return;
    var downloads = out.querySelector('.sr-downloads');
    if (downloads) Array.prototype.forEach.call(downloads.querySelectorAll('a'), function (link) {
      if (!link.hasAttribute('data-p1-old-href')) link.setAttribute('data-p1-old-href', link.getAttribute('href') || '');
      link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); link.hidden = true;
    });
    var old = doc.getElementById(UI_ID); if (old) old.remove();
    var box = textEl(doc, 'div', 'Export stopped: stored-data coverage could not be reconciled. Refresh the stored evidence and run the study again.');
    box.id = UI_ID; box.className = 'p1-study-coverage p1-study-coverage-error';
    box.setAttribute('role', 'alert'); box.setAttribute('data-code', S(error && error.code || 'coverage-unproven'));
    out.appendChild(box);
  }
  function renderReceiptUi(result) {
    var doc = root.document, out = doc && doc.getElementById('mlsStudyResults');
    var receipt = result && result.p1CoverageReceipt; if (!out || !receipt) return;
    clearUrls();
    var old = doc.getElementById(UI_ID); if (old) old.remove();
    var box = doc.createElement('details'); box.id = UI_ID; box.className = 'p1-study-coverage';
    var summary = textEl(doc, 'summary', 'Coverage verified: ' + receipt.counts.includedRecords + ' stored records · ' + receipt.range.label);
    box.appendChild(summary);
    box.appendChild(textEl(doc, 'p', receipt.dataMeaning));
    box.appendChild(textEl(doc, 'p', 'Included: ' + receipt.counts.includedDatedRecords + ' dated, ' + receipt.counts.includedUndatedRecords +
      ' undated. Excluded: ' + receipt.counts.excludedUndatedRecords + ' undated, ' + receipt.counts.excludedOutOfRangeRecords + ' out of range.'));
    box.appendChild(textEl(doc, 'p', 'Sources: ' + receipt.sourceModes.map(function (row) { return row.mode + ' ' + row.count; }).join('; ') + '.'));
    var receiptUrl = rememberUrl(result.p1CoverageCsvBlob);
    if (receiptUrl) {
      var link = textEl(doc, 'a', 'Download coverage receipt (CSV)'); link.href = receiptUrl;
      link.download = 'MLS_P1_Stored_Evidence_Coverage_' + receipt.id + '.csv'; link.className = 'p1-study-coverage-download';
      box.appendChild(link);
    }
    out.appendChild(box);
    var downloads = out.querySelector('.sr-downloads');
    if (downloads) Array.prototype.forEach.call(downloads.querySelectorAll('a'), function (link) {
      if (link.hasAttribute('data-p1-old-href')) {
        link.href = link.getAttribute('data-p1-old-href');
        link.removeAttribute('data-p1-old-href');
      }
      link.hidden = false; link.removeAttribute('aria-disabled');
      if (/\.pdf(?:$|\?)/i.test(link.getAttribute('download') || '')) {
        if (result.pdfBlob && result.p1CoveragePdfEmbedded) {
          var url = rememberUrl(result.pdfBlob); if (url) link.href = url;
        } else {
          if (!link.hasAttribute('data-p1-old-href')) link.setAttribute('data-p1-old-href', link.getAttribute('href') || '');
          link.removeAttribute('href'); link.hidden = true; link.setAttribute('aria-disabled', 'true');
        }
      }
      if (/limited-data/i.test(link.textContent || '')) link.textContent = 'Limited-data evidence export';
    });
    out.setAttribute('data-p1-coverage-id', receipt.id);
  }
  function inspectVisibleResult() {
    try {
      var engine = installedEngine || root.__mlsStudyRequest;
      var result = engine && typeof engine.getLastResult === 'function' ? engine.getLastResult() : null;
      if (!result) return;
      var knownOwner = resultOwners && resultOwners.get(result);
      if (!knownOwner || !sessionCurrent(knownOwner, root)) { scrubStudyUi(); return; }
      var out = root.document && root.document.getElementById('mlsStudyResults');
      if (out && result.p1CoverageReceipt && out.getAttribute('data-p1-coverage-id') === result.p1CoverageReceipt.id) return;
      if (result.p1CoverageVerified === false && root.document.getElementById(UI_ID)) return;
      enrichResult(result, { engine: engine }).then(renderReceiptUi).catch(failClosedUi);
    } catch (e) { failClosedUi(e); }
  }
  function observeResults() {
    if (!root.document || resultObserver || typeof root.MutationObserver !== 'function') return;
    resultObserver = new root.MutationObserver(function (changes) {
      if (changes.some(function (change) { return change.type === 'childList' && change.addedNodes && change.addedNodes.length; })) {
        setTimeout(inspectVisibleResult, 0);
      }
    });
    resultObserver.observe(root.document.documentElement, { childList: true, subtree: true });
  }
  function injectCss() {
    var doc = root.document; if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style'); style.id = STYLE_ID;
    style.textContent = '.p1-study-coverage{margin-top:10px;padding:10px 12px;border:1px solid #cfe1d5;border-radius:10px;background:#f6faf7;color:#294638;font:12px/1.45 system-ui,sans-serif}' +
      '.p1-study-coverage summary{cursor:pointer;font-weight:750}.p1-study-coverage p{margin:7px 0}.p1-study-coverage-download{display:inline-block;margin-top:4px;color:#24513d;font-weight:750}' +
      '.p1-study-coverage-error{border-color:#e6b8b8;background:#fff7f7;color:#7a2626;font-weight:700}';
    (doc.head || doc.documentElement).appendChild(style);
  }
  function onUiCapture(event) {
    var target = event && event.target, engine = installedEngine;
    if (!target || !engine || typeof engine.runFromUi !== 'function') return;
    var submit = target.id === 'mlsStudySubmit' && event.type === 'click';
    var enter = target.id === 'mlsStudyPrompt' && event.type === 'keydown' &&
      typeof engine.shouldSubmitKey === 'function' && engine.shouldSubmitKey(event);
    if (!submit && !enter) return;
    var input = root.document.getElementById('mlsStudyPrompt'); if (!input) return;
    event.preventDefault(); event.stopImmediatePropagation();
    engine.runFromUi(input.value).then(renderReceiptUi).catch(function (error) {
      if (error && error.code && /^coverage-/.test(error.code)) { failClosedUi(error); return; }
      var status = root.document.getElementById('mlsStudyStatus');
      if (status) {
        /* Original engine exceptions may include stored-record text or internal
           implementation details. Keep those out of the physician surface;
           the bounded coverage status remains available in diagnostics. */
        status.textContent = 'The stored-data study could not be completed. Check the requested range and try again.';
        status.hidden = false; status.setAttribute('data-state', 'error');
      }
    });
  }
  function bindUi() {
    if (!root.document) return;
    injectCss(); observeResults();
    root.document.addEventListener('click', onUiCapture, true);
    root.document.addEventListener('keydown', onUiCapture, true);
    if (root.addEventListener) root.addEventListener('mls:session-boundary', onSessionBoundary, false);
  }
  function unbindUi() {
    if (!root.document) return;
    root.document.removeEventListener('click', onUiCapture, true);
    root.document.removeEventListener('keydown', onUiCapture, true);
    if (root.removeEventListener) root.removeEventListener('mls:session-boundary', onSessionBoundary, false);
    if (resultObserver) { try { resultObserver.disconnect(); } catch (e) {} resultObserver = null; }
  }

  function installEngine(engine) {
    if (!engine || typeof engine.run !== 'function' || typeof engine.runFromUi !== 'function' ||
        typeof engine.parseStudySpec !== 'function') return false;
    if (installedEngine === engine && originals) return true;
    if (installedEngine && originals) restoreEngine();
    installedEngine = engine;
    originals = { run: engine.run, runFromUi: engine.runFromUi, executeSpec: engine.executeSpec };
    engine.run = function (query, options) {
      options = options || {};
      var env = options.env || root, owner = sessionOwner(env);
      if (!owner) return Promise.reject(coverageError('coverage-session-unverified', 'Sign in again before running a stored-data study.'));
      var spec = upgradedSpec(query, engine.parseStudySpec, options);
      if (!spec || !spec.ok) return Promise.reject(coverageError(spec && spec.code || 'invalid-request', spec && spec.clarification || 'Describe a supported stored-data study.'));
      return Promise.resolve(originals.run.call(engine, spec, options)).then(function (result) {
        requireCurrentSession(owner, env);
        if (result && spec && spec.range) result.p1RequestedRange = clone(spec.range);
        return enrichResult(result, { engine: engine, env: env, owner: owner });
      });
    };
    engine.runFromUi = function (query) {
      var owner = sessionOwner(root);
      if (!owner) return Promise.reject(coverageError('coverage-session-unverified', 'Sign in again before running a stored-data study.'));
      var explicit = parseExplicitRange(query, {});
      if (explicit && !explicit.ok) return Promise.reject(coverageError(explicit.code, explicit.clarification));
      var rewritten = rewriteQueryRange(query, explicit);
      return Promise.resolve(originals.runFromUi.call(engine, rewritten)).then(function (result) {
        requireCurrentSession(owner, root);
        if (!result || !result.model || !result.scoped) return result;
        if (explicit && explicit.range) result.p1RequestedRange = clone(explicit.range);
        return enrichResult(result, { engine: engine, owner: owner }).then(function (value) { renderReceiptUi(value); return value; });
      }).catch(function (error) {
        if (error && error.code === 'coverage-session-changed') scrubStudyUi();
        throw error;
      });
    };
    if (typeof originals.executeSpec === 'function') {
      engine.executeSpec = function (spec, options) {
        options = options || {};
        var env = options.env || root, owner = sessionOwner(env);
        if (!owner) return Promise.reject(coverageError('coverage-session-unverified', 'Sign in again before running a stored-data study.'));
        return Promise.resolve(originals.executeSpec.call(engine, spec, options)).then(function (result) {
          requireCurrentSession(owner, env);
          return enrichResult(result, { engine: engine, env: env, owner: owner });
        });
      };
    }
    wrappers = { run: engine.run, runFromUi: engine.runFromUi, executeSpec: engine.executeSpec };
    bindUi();
    return true;
  }
  function restoreEngine() {
    if (installedEngine && originals) {
      if (wrappers && installedEngine.run === wrappers.run) installedEngine.run = originals.run;
      if (wrappers && installedEngine.runFromUi === wrappers.runFromUi) installedEngine.runFromUi = originals.runFromUi;
      if (originals.executeSpec && wrappers && installedEngine.executeSpec === wrappers.executeSpec) installedEngine.executeSpec = originals.executeSpec;
    }
    installedEngine = null; originals = null; wrappers = null;
  }
  function boot() {
    if (installEngine(root.__mlsStudyRequest)) return true;
    if (installTimer) return false;
    var started = Date.now();
    installTimer = setInterval(function () {
      if (installEngine(root.__mlsStudyRequest) || Date.now() - started > 60000) {
        clearInterval(installTimer); installTimer = null;
      }
    }, 120);
    return false;
  }
  function revert() {
    if (installTimer) { clearInterval(installTimer); installTimer = null; }
    unbindUi(); restoreEngine();
    clearUrls();
    if (root.document) {
      var node = root.document.getElementById(UI_ID); if (node) node.remove();
      var style = root.document.getElementById(STYLE_ID); if (style) style.remove();
      Array.prototype.forEach.call(root.document.querySelectorAll('[data-p1-old-href]'), function (link) {
        link.href = link.getAttribute('data-p1-old-href'); link.removeAttribute('data-p1-old-href');
        link.hidden = false; link.removeAttribute('aria-disabled');
      });
    }
    api.installed = false;
    try { if (root.__mlsP1StudyProvenance === api) delete root.__mlsP1StudyProvenance; } catch (e) {}
  }
  function diagnostics() {
    return { installed: api.installed, version: VERSION, status: lastDiagnostic.status,
      receiptId: lastDiagnostic.receiptId, counts: lastDiagnostic.counts ? clone(lastDiagnostic.counts) : null };
  }

  var api = {
    installed: true,
    version: VERSION,
    boot: boot,
    installEngine: installEngine,
    parseExplicitRange: parseExplicitRange,
    upgradedSpec: upgradedSpec,
    sourceMode: sourceMode,
    buildReceipt: buildReceipt,
    persistReceipt: persistReceipt,
    receiptCsv: receiptCsv,
    enrichResult: enrichResult,
    diagnostics: diagnostics,
    analysisBases: clone(ANALYSIS_BASES),
    revert: revert
  };
  return api;
});

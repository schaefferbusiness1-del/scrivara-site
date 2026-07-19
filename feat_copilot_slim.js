/* feat_copilot_slim.js -> window.__mlsCopilotSlim (csp-2.1.0)
 *
 * Packs oversized /api/copilot context without losing patients, stable patient
 * identifiers, counts, or structured outcome/score metrics.  The active patient
 * remains complete.  Other patients lose bulky narrative blobs (notes, raw visit
 * text, transcripts) but retain identity, clinical list fields, structured
 * metrics, and record counts.  Appointments are compacted, never discarded just
 * because a provider is missing.  Non-Copilot requests pass through untouched.
 */
(function () {
  'use strict';
  var NS = '__mlsCopilotSlim', VERSION = 'csp-2.1.0';
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }
  if (window.__MLS_PUBLIC_PREVIEW && window.__MLS_PUBLIC_PREVIEW.enabled === true) {
    window[NS] = Object.freeze({ installed: false, skipped: 'public-synthetic-preview', version: VERSION });
    return;
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') {
    window[NS] = { installed: false, skipped: 'fetch unavailable', version: VERSION };
    return;
  }

  var ID_KEYS = ['id', 'patientId', 'patient_id', 'pid', 'uid', 'key', 'mrn', 'externalId', 'external_id', 'athenaId', 'athena_id', 'chartId', 'chart_id'];
  var KEEP_KEYS = [
    'name', 'dob', 'dateOfBirth', 'sex', 'gender', 'age', 'provider', 'status',
    'problems', 'diagnoses', 'diagnosisCodes', 'dx', 'medications', 'meds', 'allergies',
    'procedures', 'procedureCodes', 'lastVisit', 'nextVisit', 'lastSeen', 'nextAppointment',
    'scores', 'painScores', 'outcomes', 'metrics', 'baseline', 'followups', 'latestScores', 'trend',
    'visitCount', 'visitsCount', 'encounterCount', 'appointmentCount', 'procedureCount',
    'procedureCounts', 'diagnosisCount', 'noteCount', 'documentCount', 'totalVisits', 'totalProcedures'
  ];
  var COUNT_ARRAYS = ['visits', 'encounters', 'appointments', 'procedures', 'notes', 'documents', 'outcomes', 'recommendations', 'orders'];
  var NARRATIVE_RE = /^(note|notes|raw|rawText|text|transcript|transcription|document|documents|content|html|soap|historyText|visitText)$/i;
  var METRIC_RE = /(score|metric|outcome|pain|vas|odi|promis|function|baseline|followup|delta|change|count|rate|percent|trend|rvu|age|bmi|weight|height|duration)/i;

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function copyScalar(v, max) {
    if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '...' : v;
    return undefined;
  }
  function compactValue(value, depth) {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return copyScalar(value, 240);
    if (depth <= 0) return undefined;
    if (Array.isArray(value)) {
      var list = [], cap = Math.min(value.length, 60);
      for (var i = 0; i < cap; i++) {
        var item = compactValue(value[i], depth - 1);
        if (item !== undefined) list.push(item);
      }
      if (value.length > cap) list.push({ additionalRecords: value.length - cap });
      return list;
    }
    if (typeof value === 'object') {
      var out = {}, keys = Object.keys(value), copied = 0;
      for (var j = 0; j < keys.length && copied < 80; j++) {
        var key = keys[j]; if (NARRATIVE_RE.test(key)) continue;
        var v = compactValue(value[key], depth - 1);
        if (v !== undefined) { out[key] = v; copied++; }
      }
      return out;
    }
    return undefined;
  }
  function identityValue(p, key) {
    return own(p, key) && p[key] != null ? String(p[key]).trim() : '';
  }
  function collectMetricScalars(value, path, out, state, depth) {
    if (state.count >= 120 || depth > 5 || value == null) return;
    if (typeof value === 'number' || typeof value === 'boolean') {
      if (path && (METRIC_RE.test(path) || depth <= 2)) { out[path] = value; state.count++; }
      return;
    }
    if (typeof value === 'string') {
      if (path && METRIC_RE.test(path) && value.length <= 120) { out[path] = value; state.count++; }
      return;
    }
    if (Array.isArray(value)) {
      if (!METRIC_RE.test(path) && depth > 2) return;
      for (var ai = 0; ai < value.length && ai < 40 && state.count < 120; ai++) collectMetricScalars(value[ai], path + '[' + ai + ']', out, state, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      var keys = Object.keys(value);
      for (var oi = 0; oi < keys.length && state.count < 120; oi++) {
        var key = keys[oi]; if (NARRATIVE_RE.test(key)) continue;
        collectMetricScalars(value[key], path ? path + '.' + key : key, out, state, depth + 1);
      }
    }
  }
  function recordCounts(p) {
    var counts = {};
    for (var i = 0; i < COUNT_ARRAYS.length; i++) {
      var key = COUNT_ARRAYS[i];
      if (Array.isArray(p && p[key])) counts[key] = p[key].length;
    }
    return counts;
  }
  function compactPatient(p) {
    if (!p || typeof p !== 'object') return p;
    var out = {}, i, key;
    for (i = 0; i < ID_KEYS.length; i++) {
      key = ID_KEYS[i]; if (own(p, key)) out[key] = copyScalar(p[key], 160);
    }
    for (i = 0; i < KEEP_KEYS.length; i++) {
      key = KEEP_KEYS[i]; if (!own(p, key)) continue;
      var kept = compactValue(p[key], 3); if (kept !== undefined) out[key] = kept;
    }
    var counts = recordCounts(p);
    if (Object.keys(counts).length) out.recordCounts = counts;
    var metrics = {}, metricState = { count: 0 };
    collectMetricScalars(p, '', metrics, metricState, 0);
    if (Object.keys(metrics).length) out.metricScalars = metrics;
    return out;
  }
  function compactAppointment(a) {
    if (!a || typeof a !== 'object') return a;
    var out = {}, keys = [
      'id', 'appointmentId', 'encounterId', 'patientId', 'patient_id', 'mrn', 'name', 'patientName',
      'date', 'day', 'time', 'start', 'end', 'provider', 'providerId', 'type', 'visitType', 'status',
      'department', 'location', 'duration', 'procedure', 'diagnosis', 'diagnosisCode'
    ];
    for (var i = 0; i < keys.length; i++) if (own(a, keys[i])) {
      var v = compactValue(a[keys[i]], 2); if (v !== undefined) out[keys[i]] = v;
    }
    var metrics = {}, state = { count: 0 };
    collectMetricScalars(a, '', metrics, state, 0);
    if (Object.keys(metrics).length) out.metricScalars = metrics;
    return out;
  }
  function normalizedName(p) { return String(p && p.name || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function normalizedDob(p) {
    var raw = p && (p.dob || p.dateOfBirth);
    return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function samePatient(p, active, patients) {
    if (!p || !active) return false;
    var shared = 0, matched = 0, conflicted = false;
    for (var i = 0; i < ID_KEYS.length; i++) {
      var key = ID_KEYS[i], av = identityValue(active, key), pv = identityValue(p, key);
      if (!av || !pv) continue;
      shared++;
      if (av === pv) matched++; else conflicted = true;
    }
    /* A stable identifier only matches inside its own namespace. Cross-key
       equality (for example active.id === patient.mrn) is never identity. */
    if (shared) return matched > 0 && !conflicted;

    var name = normalizedName(active), dob = normalizedDob(active);
    if (!name || !dob || normalizedName(p) !== name || normalizedDob(p) !== dob || !Array.isArray(patients)) return false;
    var count = 0;
    for (var j = 0; j < patients.length; j++) {
      if (normalizedName(patients[j]) === name && normalizedDob(patients[j]) === dob) count++;
      if (count > 1) return false;
    }
    return count === 1;
  }

  function pack(bodyString) {
    try {
      if (typeof bodyString !== 'string' || bodyString.length < 20000) return null;
      var payload = JSON.parse(bodyString);
      if (!payload || !payload.context || typeof payload.context !== 'object') return null;
      var context = payload.context, originalPatients = Array.isArray(context.patients) ? context.patients : null;
      if (originalPatients) {
        context.patients = originalPatients.map(function (patient) {
          return samePatient(patient, context.activePatient, originalPatients) ? patient : compactPatient(patient);
        });
      }
      if (Array.isArray(context.appointments)) context.appointments = context.appointments.map(compactAppointment);
      context.contextPacking = {
        version: VERSION,
        narrativeFieldsOmitted: true,
        patientCountPreserved: originalPatients ? originalPatients.length : 0,
        appointmentCountPreserved: Array.isArray(context.appointments) ? context.appointments.length : 0,
        stablePatientIdsPreserved: true,
        structuredMetricsPreserved: true
      };
      var packed = JSON.stringify(payload);
      return packed && packed.length < bodyString.length ? packed : null;
    } catch (e) { return null; }
  }

  function wrappedFetch(input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/\/api\/copilot(?:\?|$)/.test(String(url).split('#')[0]) && init && typeof init.body === 'string') {
        var packed = pack(init.body);
        if (packed) {
          var next = {};
          for (var key in init) if (Object.prototype.hasOwnProperty.call(init, key)) next[key] = init[key];
          next.body = packed;
          return originalFetch.call(this, input, next);
        }
      }
    } catch (e) {}
    return originalFetch.apply(this, arguments);
  }
  wrappedFetch.__mlsCopilotSlim = true;
  wrappedFetch.__orig = originalFetch;
  window.fetch = wrappedFetch;

  window[NS] = {
    installed: true,
    version: VERSION,
    asset: 'feat_copilot_slim.js',
    pack: pack,
    compactPatient: compactPatient,
    samePatient: samePatient,
    revert: function () {
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      window[NS].installed = false;
      return true;
    }
  };
})();

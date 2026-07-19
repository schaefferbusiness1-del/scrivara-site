/* feat_mls_staging_exact_actions.js -> window.__mlsStagingExactActions
 *
 * Staging intentionally keeps the legacy Visit grid visible instead of loading
 * the canonical Easy owner. This adapter gives those engine-level Record and
 * Generate controls the same fail-closed requirement: one active patient must
 * resolve to one exact scheduled row with an immutable Athena appointment ID,
 * date, and provider before a clinical sink can run.
 *
 * The backend calendar row id is never treated as an Athena appointment id.
 * When the row does not carry the Athena id directly, the exact schedule-import
 * index must map that backend id, patient, and day to exactly one Athena id.
 */
;(function () {
  'use strict';
  var NS = '__mlsStagingExactActions', VERSION = 'sea-1.0.0';
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  var disposed = false, selectedCalendar = null, originals = {};

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function normName(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function pad2(value) { value = String(value); return value.length < 2 ? '0' + value : value; }
  function validDay(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value).slice(0, 10)), parsed;
    if (!match) return '';
    parsed = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    return parsed.getUTCFullYear() === +match[1] && parsed.getUTCMonth() === +match[2] - 1 && parsed.getUTCDate() === +match[3]
      ? match[0] : '';
  }
  function dobKey(value) {
    var raw = text(value), match;
    if ((match = /^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/.exec(raw))) return match[1] + pad2(match[2]) + pad2(match[3]);
    if ((match = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/.exec(raw))) return match[3] + pad2(match[1]) + pad2(match[2]);
    return '';
  }
  function activePatientSnapshot() {
    var patient = safe(function () { return typeof window.activePatient === 'function' ? window.activePatient() : null; }, null);
    if (!patient || !text(patient.id || patient.patientId) || !normName(patient.name) || !dobKey(patient.dob)) return null;
    return patient;
  }
  function localPatientRefs(row) {
    var out = [], seen = {};
    ['patient_external_id', '_mlsTargetPatientId', 'localPatientId'].forEach(function (key) {
      var value = text(row && row[key]);
      if (value && !seen[value]) { seen[value] = true; out.push(value); }
    });
    return out;
  }
  function patientMatches(row, patient) {
    if (!row || !patient) return false;
    var patientId = text(patient.id || patient.patientId), patientName = normName(patient.name), patientDob = dobKey(patient.dob);
    var rowName = normName(row.name || row.patient_name || row.patientName), rowDob = dobKey(row.dob), refs = localPatientRefs(row);
    if (!patientId || !patientName || !patientDob || !rowName || rowName !== patientName) return false;
    if (rowDob && rowDob !== patientDob) return false;
    if (refs.length > 1 || (refs.length === 1 && refs[0] !== patientId)) return false;
    /* Without an immutable local chart link, exact name + DOB is mandatory. */
    return refs.length === 1 || (!!rowDob && rowDob === patientDob);
  }
  function sourceId(row) { return text(row && row.id); }
  function dateOf(row) {
    var explicit = [], seen = {};
    ['appt_date', 'day_local', 'visitDate', 'scheduleDate', 'date'].forEach(function (key) {
      var day = validDay(row && row[key]);
      if (day && !seen[day]) { seen[day] = true; explicit.push(day); }
    });
    if (explicit.length !== 1) return explicit.length ? '' : validDay(row && row.start_at);
    return explicit[0];
  }
  function providerOf(row) {
    var direct = [], seen = {};
    ['provider', 'providerName', 'provider_name', 'doctor_name', 'clinician'].forEach(function (key) {
      var value = text(row && row[key]), normalized = normName(value);
      if (value && normalized && !seen[normalized]) { seen[normalized] = true; direct.push(value); }
    });
    if (direct.length > 1) return '';
    var provider = direct[0] || text(safe(function () {
      return row && row.doctor_user_id && typeof window._docName === 'function' ? window._docName(row.doctor_user_id) : '';
    }, ''));
    return !provider || /^(?:unassigned|unknown|none|n\/a)$/i.test(provider) ? '' : provider;
  }
  function normalizeClock(value) {
    var raw = text(value), match = /(\d{1,2}):(\d{2})\s*([ap]m)?/i.exec(raw), hour, minute, suffix;
    if (!match) return '';
    hour = +match[1]; minute = +match[2]; suffix = text(match[3]).toLowerCase();
    if (minute > 59 || hour > (suffix ? 12 : 23) || hour < (suffix ? 1 : 0)) return '';
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    return pad2(hour) + ':' + pad2(minute);
  }
  function timeOf(row) {
    var direct = normalizeClock(row && (row.start_local || row.time || row.time_display));
    if (direct) return direct;
    return normalizeClock(safe(function () {
      return row && row.start_at && typeof window._apptHHMMTz === 'function' ? window._apptHHMMTz(row.start_at) : '';
    }, ''));
  }
  function directAppointmentId(row) {
    var values = [], seen = {};
    ['athenaAppointmentId', 'athena_appointment_id', 'appointmentId', 'appointment_id', 'apptId', 'appt_id'].forEach(function (key) {
      var value = text(row && row[key]);
      if (value && !seen[value]) { seen[value] = true; values.push(value); }
    });
    if (values.length !== 1 || !/^\d{1,40}$/.test(values[0])) return '';
    return values[0];
  }
  function indexedAppointmentId(patientId, backendRowId, day) {
    return safe(function () {
      if (!patientId || !backendRowId || !day || typeof window.uns !== 'function' || !window.localStorage) return '';
      var raw = window.localStorage.getItem(window.uns('schedImportIndexV1::' + day));
      if (!raw) return '';
      var rows = (JSON.parse(raw) || {}).rows || {}, matches = [];
      Object.keys(rows).forEach(function (key) {
        var match = /^appointment-id:(\d{1,40})$/.exec(key), entry = rows[key];
        if (!match || !entry) return;
        if (text(entry.backendAppointmentId) === backendRowId && text(entry.patientId) === patientId && validDay(entry.appt_date) === day) matches.push(match[1]);
      });
      matches = matches.filter(function (value, index) { return matches.indexOf(value) === index; });
      return matches.length === 1 ? matches[0] : '';
    }, '');
  }
  function appointmentId(row, patient, day) {
    var direct = directAppointmentId(row);
    return direct || indexedAppointmentId(text(patient && (patient.id || patient.patientId)), sourceId(row), day);
  }
  function rowSignature(row, patient) {
    var day = dateOf(row);
    return [sourceId(row), appointmentId(row, patient, day), localPatientRefs(row).join(','), normName(row && (row.name || row.patient_name || row.patientName)), dobKey(row && row.dob), day, normName(providerOf(row)), timeOf(row)].join('\u001f');
  }
  function exactCalendarRows(patient) {
    var rows = safe(function () { return Array.isArray(window._calAppts) ? window._calAppts : []; }, []), out = [], seen = {};
    rows.forEach(function (row) {
      if (!patientMatches(row, patient)) return;
      var day = dateOf(row), provider = providerOf(row), id = appointmentId(row, patient, day), sid = sourceId(row);
      if (!sid || !day || !provider || !id) return;
      var signature = rowSignature(row, patient);
      if (seen[signature]) return;
      seen[signature] = true;
      out.push({ row: row, sourceId: sid, appointmentId: id, date: day, provider: provider, time: timeOf(row), signature: signature });
    });
    return out;
  }
  function heroHint(patient, explicitOnly) {
    var rows = safe(function () { return Array.isArray(window._heroTodayList) ? window._heroTodayList : []; }, []);
    var index = safe(function () {
      if (typeof window._heroSelIdx === 'number' && window._heroSelIdx >= 0) return window._heroSelIdx;
      return explicitOnly ? -1 : (typeof window._heroNowIdx === 'number' ? window._heroNowIdx : -1);
    }, -1);
    var row = index >= 0 ? rows[index] : null;
    return patientMatches(row, patient) ? row : null;
  }
  function byHint(candidates, hint, patient) {
    if (!hint) return candidates;
    var hintDay = dateOf(hint), hintTime = timeOf(hint), hintProvider = providerOf(hint), hintId = directAppointmentId(hint);
    return candidates.filter(function (candidate) {
      if (hintId && candidate.appointmentId !== hintId) return false;
      if (hintDay && candidate.date !== hintDay) return false;
      if (hintTime && candidate.time && candidate.time !== hintTime) return false;
      if (hintProvider && normName(candidate.provider) !== normName(hintProvider)) return false;
      return patientMatches(candidate.row, patient);
    });
  }
  function resolveExact(patient) {
    var candidates = exactCalendarRows(patient), hint = heroHint(patient, true), narrowed;
    if (hint) {
      narrowed = byHint(candidates, hint, patient);
      return narrowed.length === 1 ? narrowed[0] : null;
    }
    if (selectedCalendar) {
      narrowed = candidates.filter(function (candidate) { return candidate.sourceId === selectedCalendar.sourceId; });
      return narrowed.length === 1 ? narrowed[0] : null;
    }
    hint = heroHint(patient, false);
    if (hint) {
      narrowed = byHint(candidates, hint, patient);
      return narrowed.length === 1 ? narrowed[0] : null;
    }
    return candidates.length === 1 ? candidates[0] : null;
  }
  function bindingMatches(binding, exact, patient) {
    var context = binding && binding.visitContext || {}, boundPatient = binding && binding.patient || {};
    if (!binding || !Object.isFrozen(binding) || binding.routeBlocked || binding.identityConflict || binding.historical === true) return false;
    if (text(boundPatient.patientId || boundPatient.id) !== text(patient.id || patient.patientId)) return false;
    if (normName(boundPatient.name) !== normName(patient.name) || dobKey(boundPatient.dob) !== dobKey(patient.dob)) return false;
    if (text(context.appointmentId) !== exact.appointmentId || validDay(context.visitDate) !== exact.date || normName(context.provider) !== normName(exact.provider)) return false;
    return patientMatches(exact.row, activePatientSnapshot());
  }
  function currentBinding() { return safe(function () { return window.currentVisitAthenaBinding || null; }, null); }
  function installBinding(exact, patient) {
    var existing = currentBinding();
    if (safe(function () { return window.currentVisitAthenaCompromised === true; }, false)) return false;
    if (existing) return bindingMatches(existing, exact, patient);
    if (typeof window._athenaFreezeVisitBinding !== 'function') return false;
    var now = Date.now(), context = Object.freeze({
      historical: false, noteTimestamp: now, visitDate: exact.date, provider: exact.provider,
      appointmentId: exact.appointmentId, encounterId: '', encounterUrl: ''
    });
    var binding = safe(function () {
      return window._athenaFreezeVisitBinding(patient, {
        source: 'staging-exact-scheduled-action', historical: false, noteTimestamp: now,
        visitContext: context, displayDate: exact.date, displayProvider: exact.provider
      });
    }, null);
    if (!binding || !bindingMatches(binding, exact, patient)) return false;
    window.currentVisitAthenaBinding = binding;
    window.currentVisitAthenaCompromised = false;
    window.currentVisitAthenaEpoch = (Number(window.currentVisitAthenaEpoch) || 0) + 1;
    return bindingMatches(currentBinding(), exact, activePatientSnapshot());
  }
  function block(actionLabel) {
    safe(function () {
      if (typeof window.toast === 'function') window.toast('MLS blocked ' + text(actionLabel || 'this clinical action') + '. Choose one exact scheduled appointment with patient, DOB, Athena appointment ID, date, and provider, then try again.', 'err');
    });
    return false;
  }
  function exactActionReady(actionLabel) {
    if (disposed) return false;
    var patient = activePatientSnapshot(), exact = patient && resolveExact(patient);
    if (!patient || !exact || !installBinding(exact, patient)) return block(actionLabel);
    return true;
  }
  function rememberCalendar(id) {
    var wanted = text(id), matches = safe(function () {
      return (Array.isArray(window._calAppts) ? window._calAppts : []).filter(function (row) { return sourceId(row) === wanted; });
    }, []);
    selectedCalendar = matches.length === 1 ? Object.freeze({ sourceId: wanted }) : null;
  }
  function wrapSelections() {
    if (typeof window.calStartVisit === 'function' && !window.calStartVisit.__mlsStagingExactWrapped) {
      originals.calStartVisit = window.calStartVisit;
      var calendarWrapped = function () { rememberCalendar(arguments[0]); return originals.calStartVisit.apply(this, arguments); };
      calendarWrapped.__mlsStagingExactWrapped = true;
      window.calStartVisit = calendarWrapped;
    }
    if (typeof window._heroPickPatient === 'function' && !window._heroPickPatient.__mlsStagingExactWrapped) {
      originals.heroPick = window._heroPickPatient;
      var heroWrapped = function () { selectedCalendar = null; return originals.heroPick.apply(this, arguments); };
      heroWrapped.__mlsStagingExactWrapped = true;
      window._heroPickPatient = heroWrapped;
    }
  }
  function onSessionBoundary() { selectedCalendar = null; }
  function revert() {
    disposed = true; selectedCalendar = null;
    safe(function () { window.removeEventListener('mls:session-boundary', onSessionBoundary); });
    if (originals.calStartVisit && window.calStartVisit && window.calStartVisit.__mlsStagingExactWrapped) window.calStartVisit = originals.calStartVisit;
    if (originals.heroPick && window._heroPickPatient && window._heroPickPatient.__mlsStagingExactWrapped) window._heroPickPatient = originals.heroPick;
    try { delete window[NS]; } catch (e) { window[NS] = null; }
    return true;
  }

  var api = {
    installed: true, version: VERSION, exactActionReady: exactActionReady, revert: revert,
    _test: { resolveExact: resolveExact, appointmentId: appointmentId, rememberCalendar: rememberCalendar }
  };
  window[NS] = api;
  wrapSelections();
  safe(function () { window.addEventListener('mls:session-boundary', onSessionBoundary); });
})();

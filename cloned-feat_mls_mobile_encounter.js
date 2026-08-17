/* MLS Scribe /p1 local mobile encounter coordinator.
 *
 * State/API only: this module does not render UI and does not invoke a clinical
 * action. It observes the existing local schedule, P1 Avatar cache, and Easy
 * visit snapshot only after proving the current account plus one exact
 * appointment/patient/day binding. Cross-device encounter continuation is
 * deliberately unsupported: the shipped relay acknowledges day/chart reads,
 * not an immutable encounter handoff.
 *
 * Durable data is limited to PHI-free progress. Patient names, identifiers,
 * dates, history, intake, notes, transcripts, and proposals remain in memory.
 */
;(function () {
  'use strict';

  var VERSION = 'p1-mobile-encounter-1.0.0';
  var ASSET = 'cloned-feat_mls_mobile_encounter.js';
  var LOADER_KEY = '__mlsP1MobileEncounterLoader';
  var CONTROL_SUFFIX = 'p1MobileEncounterControlV1';
  var SCOPE_PROBE_SUFFIX = 'p1MobileEncounterScopeProbeV1';
  var MAX_EVENT_ID = 120;
  var MAX_TEXT = 12000;
  var script = document.currentScript;

  function text(value) { return String(value == null ? '' : value).trim(); }
  function cleanToken(value) { return text(value).replace(/[^a-z0-9._:-]/gi, '').slice(0, 160); }
  var installToken = cleanToken(script && script.getAttribute && script.getAttribute('data-mls-install-token'));
  var loader = window[LOADER_KEY];
  if (!(window.__MLS_CLONED && window.__MLS_CLONED.enabled === true) ||
      !installToken || !loader || loader.installed !== true ||
      loader.version !== VERSION || loader.installToken !== installToken) return;

  var incumbent = window.__mlsP1MobileEncounter;
  if (incumbent && incumbent.installed === true) {
    if (incumbent.version === VERSION && incumbent.installToken === installToken &&
        typeof incumbent.revert === 'function') return;
    if (typeof incumbent.revert !== 'function') return;
    try { incumbent.revert(); } catch (retireError) { return; }
    if (incumbent.installed === true ||
        (window.__mlsP1MobileEncounter && window.__mlsP1MobileEncounter.installed === true)) return;
  }

  var owner = null;
  var encounter = null;
  var encounterOwner = null;
  /* Retain only the already-proven account-scoped control key. This lets a
     fresh module instance remove an orphaned control receipt on logout or
     revert even when no encounter has been reopened (the receipt itself is
     deliberately non-resumable without a fresh exact visit binding). */
  var retainedOwner = null;
  var handled = Object.create(null);
  var handledOrder = [];
  var listeners = [];
  var boundaryReason = '';
  var cleanupReceipt = { ok: true, reason: '' };

  var CROSS_DEVICE_REASON = 'verified-encounter-relay-unavailable';
  var CAPABILITIES = Object.freeze({
    localSameEncounter: true,
    durablePhiFreeProgress: true,
    crossDevice: Object.freeze({ supported: false, reason: CROSS_DEVICE_REASON }),
    autonomousFinalActions: false
  });

  function safe(fn, fallback) { try { return fn(); } catch (error) { return fallback; } }
  function isFn(value) { return typeof value === 'function'; }
  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function copy(value) { return safe(function () { return JSON.parse(JSON.stringify(value)); }, null); }
  function normalizedAccount(value) { return text(value).toLowerCase(); }
  function exactDate(value) {
    value = text(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    var parts = value.split('-'), year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
    if (year < 2000 || month < 1 || month > 12 || day < 1 ||
        day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return '';
    return value;
  }
  function epochValue(value) {
    value = Number(value);
    return isFinite(value) && value > 0 && Math.floor(value) === value ? value : 0;
  }
  function boundedText(value, max) { return text(value).slice(0, max || MAX_TEXT); }
  function randomId() {
    var strong = safe(function () {
      if (window.crypto && isFn(window.crypto.randomUUID)) return window.crypto.randomUUID();
      if (window.crypto && isFn(window.crypto.getRandomValues)) {
        var bytes = new Uint32Array(4); window.crypto.getRandomValues(bytes);
        return Array.prototype.map.call(bytes, function (part) { return ('00000000' + part.toString(16)).slice(-8); }).join('');
      }
      return '';
    }, '');
    return 'p1me-' + (strong || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14)));
  }
  function sameProof(left, right) {
    return !!(left && right && left.account === right.account && left.epoch === right.epoch &&
      left.key === right.key && left.today === right.today);
  }

  function accountProof() {
    if (!own(window, '__mlsSessionAccount') || !own(window, '__mlsSessionEpoch') || !isFn(window.uns)) return null;
    var account = normalizedAccount(safe(function () { return window.__mlsSessionAccount; }, ''));
    var epoch = epochValue(safe(function () { return window.__mlsSessionEpoch; }, 0));
    var today = exactDate(safe(function () { return isFn(window._acctTodayKey) ? window._acctTodayKey() : ''; }, ''));
    if (!account || !epoch || !today) return null;
    var key = safe(function () { return text(window.uns(CONTROL_SUFFIX)); }, '');
    var probe = safe(function () { return text(window.uns(SCOPE_PROBE_SUFFIX)); }, '');
    if (!key || !probe || key.length > 700 || probe.length > 700 ||
        key === CONTROL_SUFFIX || probe === SCOPE_PROBE_SUFFIX ||
        key.slice(-CONTROL_SUFFIX.length) !== CONTROL_SUFFIX ||
        probe.slice(-SCOPE_PROBE_SUFFIX.length) !== SCOPE_PROBE_SUFFIX) return null;
    var prefix = key.slice(0, -CONTROL_SUFFIX.length);
    var probePrefix = probe.slice(0, -SCOPE_PROBE_SUFFIX.length);
    if (!prefix || prefix !== probePrefix || /(?:^|::)_::$/.test(prefix) ||
        prefix.toLowerCase().indexOf('::' + account + '::') < 0) return null;
    return Object.freeze({ account: account, epoch: epoch, today: today, key: key });
  }

  function appointments() {
    if (!own(window, '_calAppts')) return null;
    var rows = safe(function () { return isFn(window._calAppts) ? window._calAppts() : window._calAppts; }, null);
    return Array.isArray(rows) ? rows : null;
  }
  function selectionId(row) {
    return text(row && (row.id || row.rowId || row.sourceId));
  }
  function appointmentId(row) {
    return text(row && (row.appointmentId || row.appointment_id || row.apptId || row.appt_id || row.athena_appointment_id));
  }
  function patientId(row) {
    return text(row && (row.patient_external_id || row.patientId || row.patient_id || row.externalPatientId));
  }
  function identity(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function digits(value) { return text(value).replace(/\D/g, ''); }
  function providerIdentity(value) {
    return identity(value).split(' ').filter(Boolean).sort().join('|');
  }
  function compatibleName(left, right) {
    var a = identity(left).split(' ').filter(Boolean), b = identity(right).split(' ').filter(Boolean);
    if (!a.length || !b.length) return true;
    var shorter = a.length <= b.length ? a : b, longer = a.length <= b.length ? b : a;
    return shorter.every(function (token) { return longer.indexOf(token) >= 0; });
  }
  function appointmentDate(row) {
    return exactDate(row && (row.start_at || row.start_local || row.start || row.date || row.appointment_date));
  }
  function scheduleRows(proof) {
    /* The shell owns calendar rows by account+epoch and clears them before its
       session-boundary event. When that ownership hook exists, require it: a
       newly published Account B identity must never make still-clearing Account
       A rows look like B's schedule. */
    if (!isFn(window._calOwnerMatches) ||
        !safe(function () { return window._calOwnerMatches(proof.account, proof.epoch) === true; }, false))
      return { status: 'unavailable', date: proof.today, rows: [], omitted: 0 };
    var raw = appointments();
    if (!raw) return { status: 'unavailable', date: proof.today, rows: [], omitted: 0 };
    var out = [], omitted = 0;
    for (var i = 0; i < raw.length; i++) {
      var row = raw[i];
      if (!row || appointmentDate(row) !== proof.today) continue;
      var selected = selectionId(row), appt = appointmentId(row), patient = patientId(row);
      if (!selected || !appt || !patient) { omitted++; continue; }
      out.push({
        selectionId: selected,
        appointmentId: appt,
        patientId: patient,
        name: boundedText(row.name || row.patient_name || row.patientName, 300),
        time: boundedText(row.time || row.start_time || row.start_at || row.start_local, 80),
        reason: boundedText(row.reason || row.type || row.appt_type || row.visit_type, 500),
        provider: boundedText(row.provider || row.provider_name, 300),
        seen: row.seen === true || row.completed === true || /^(seen|complete|completed|done)$/i.test(text(row.status)),
        _order: i,
        _raw: row
      });
    }
    out.sort(function (left, right) {
      var a = text(left._raw && (left._raw.start_at || left._raw.start_local || left._raw.start_time || left.time));
      var b = text(right._raw && (right._raw.start_at || right._raw.start_local || right._raw.start_time || right.time));
      return a < b ? -1 : (a > b ? 1 : left._order - right._order);
    });
    return { status: omitted ? 'partial' : (out.length ? 'verified-local' : 'empty'), date: proof.today, rows: out, omitted: omitted };
  }
  function publicSchedule(schedule) {
    return {
      status: schedule.status, date: schedule.date, omittedUnbound: schedule.omitted,
      patients: schedule.rows.map(function (row) {
        return { selectionId: row.selectionId, appointmentId: row.appointmentId, patientId: row.patientId, name: row.name,
          time: row.time, reason: row.reason, provider: row.provider, seen: row.seen };
      })
    };
  }
  function nextPatient(schedule) {
    if (!schedule.rows.length) return { status: schedule.status === 'unavailable' ? 'unavailable' : 'none', patient: null };
    var row = null;
    for (var i = 0; i < schedule.rows.length; i++) if (!schedule.rows[i].seen) { row = schedule.rows[i]; break; }
    if (!row) return { status: 'none', reason: 'all-scheduled-patients-seen', patient: null };
    return {
      status: 'candidate',
      basis: 'first-unseen-scheduled-row',
      patient: { selectionId: row.selectionId, appointmentId: row.appointmentId, patientId: row.patientId, name: row.name,
        time: row.time, reason: row.reason, provider: row.provider, seen: row.seen }
    };
  }
  function exactScheduleMatch(proof, binding) {
    var schedule = scheduleRows(proof), selectionMatches = [], appointmentMatches = [], matches = [];
    for (var i = 0; i < schedule.rows.length; i++) {
      var row = schedule.rows[i];
      if (row.selectionId === binding.selectionId) selectionMatches.push(row);
      if (row.appointmentId === binding.appointmentId) appointmentMatches.push(row);
      if (row.selectionId === binding.selectionId && row.appointmentId === binding.appointmentId && row.patientId === binding.patientId)
        matches.push(row);
    }
    return selectionMatches.length === 1 && appointmentMatches.length === 1 && matches.length === 1 && binding.visitDate === proof.today
      ? { ok: true, row: matches[0], schedule: schedule }
      : { ok: false, reason: 'exact-visit-binding-unproven', schedule: schedule };
  }
  function normalizeBinding(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var binding = {
      account: normalizedAccount(raw.account), epoch: epochValue(raw.epoch),
      selectionId: text(raw.selectionId), appointmentId: text(raw.appointmentId), patientId: text(raw.patientId),
      visitDate: exactDate(raw.visitDate)
    };
    if (!binding.account || !binding.epoch || !binding.selectionId || !binding.appointmentId || !binding.patientId || !binding.visitDate ||
        binding.selectionId.length > 240 || binding.appointmentId.length > 240 || binding.patientId.length > 240) return null;
    return binding;
  }
  function bindingMatches(raw) {
    var binding = normalizeBinding(raw), frozen = encounter && encounter.binding;
    return !!(binding && frozen && binding.account === frozen.account && binding.epoch === frozen.epoch &&
      binding.selectionId === frozen.selectionId && binding.appointmentId === frozen.appointmentId && binding.patientId === frozen.patientId &&
      binding.visitDate === frozen.visitDate);
  }

  function avatarApi(proof) {
    var avatar = safe(function () { return window.__mlsAvatar; }, null);
    if (!avatar || avatar.installed !== true || !isFn(avatar.sessionState)) return null;
    var state = safe(function () { return avatar.sessionState(); }, null);
    if (!state || state.stale || state.dormant || state.accountBound !== true || state.tokenBound !== true ||
        epochValue(state.epoch) !== proof.epoch) return null;
    return avatar;
  }
  function boundedValue(value) {
    if (value == null) return value;
    if (typeof value === 'string') return value.slice(0, MAX_TEXT);
    if (Array.isArray(value)) return value.slice(0, 50).map(boundedValue);
    if (typeof value !== 'object') return value;
    var out = {}, keys = Object.keys(value).slice(0, 80);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === '__proto__' || keys[i] === 'prototype' || keys[i] === 'constructor') continue;
      out[keys[i]] = boundedValue(value[keys[i]]);
    }
    return out;
  }
  function chartContext(proof, binding) {
    var unavailableHistory = { status: 'unavailable', reason: 'exact-patient-history-unavailable' };
    var unavailableProcedures = { status: 'unavailable', reason: 'exact-patient-procedures-unavailable', items: [] };
    var avatar = avatarApi(proof);
    if (!avatar || !isFn(avatar.exactPatient)) return { history: unavailableHistory, procedures: unavailableProcedures };
    var before = accountProof();
    var patient = safe(function () { return avatar.exactPatient(binding.patientId); }, null);
    var after = accountProof();
    if (!sameProof(proof, before) || !sameProof(proof, after) || !patient || text(patient.id || patient.athenaId || patient.mrn) !== binding.patientId)
      return { history: unavailableHistory, procedures: unavailableProcedures };
    var notes = safe(function () { return isFn(window.patientNotes) ? window.patientNotes(binding.patientId) : []; }, []);
    if (!Array.isArray(notes)) notes = [];
    notes = notes.slice().sort(function (a, b) {
      var left = text(a && (a.date || a.note_date || a.created_at));
      var right = text(b && (b.date || b.note_date || b.created_at));
      return left < right ? 1 : (left > right ? -1 : 0);
    }).slice(0, 12).map(function (note) {
      return {
        date: exactDate(note && (note.date || note.note_date || note.created_at)),
        type: boundedText(note && (note.type || note.kind || note.visit_type), 160),
        summary: boundedText(note && (note.summary || note.text || note.note || note.soap), 2000)
      };
    });
    var procedureSource = patient.priorProcedures || patient.procedures || patient.procedureHistory;
    var procedures = [];
    if (Array.isArray(procedureSource)) procedures = procedureSource.slice(0, 30).map(boundedValue);
    else if (procedureSource) procedures = [boundedValue(procedureSource)];
    return {
      history: {
        status: 'available', source: 'exact-account-patient-store',
        summary: boundedText(patient.athenaHistorySummary || patient.historySummary || '', 6000),
        problems: boundedValue(patient.problems || []),
        medications: boundedValue(patient.medications || patient.meds || []),
        allergies: boundedValue(patient.allergies || []),
        priorVisits: notes
      },
      procedures: {
        status: procedures.length ? 'available' : 'not-recorded',
        source: 'exact-account-patient-store', items: procedures
      }
    };
  }
  function intakeContext(proof, binding) {
    var avatar = avatarApi(proof);
    if (!avatar) return { status: 'unavailable', reason: 'session-bound-intake-cache-unavailable' };
    var cache = avatar.lastReady;
    if (!cache || !Array.isArray(cache.checkins) || !Number(cache.at))
      return { status: 'unavailable', reason: 'session-bound-intake-cache-unavailable' };
    var before = accountProof(), matches = [];
    for (var i = 0; i < cache.checkins.length; i++) {
      if (text(cache.checkins[i] && cache.checkins[i].patient_external_id) === binding.patientId) matches.push(cache.checkins[i]);
    }
    var after = accountProof();
    if (!sameProof(proof, before) || !sameProof(proof, after))
      return { status: 'unavailable', reason: 'session-changed-during-intake-read' };
    var age = Math.max(0, Date.now() - Number(cache.at));
    if (age > 10 * 60 * 1000)
      return { status: 'stale', reason: 'intake-cache-stale', serverAcknowledged: true };
    var total = Number(cache.total);
    var complete = isFinite(total) && Math.floor(total) === total && total >= 0 && total <= cache.checkins.length;
    if (!matches.length) {
      if (!complete) return { status: 'unavailable', reason: 'intake-cache-sampled', serverAcknowledged: true };
      return { status: 'none', serverAcknowledged: true };
    }
    matches.sort(function (a, b) { return Number(Date.parse(b.ready_at) || 0) - Number(Date.parse(a.ready_at) || 0); });
    var hit = matches[0];
    var intakeAppointment = text(hit.appointmentId || hit.appointment_id || hit.apptId || hit.appt_id);
    /* The current P1 Avatar cache is account/session and exact-patient bound,
       but it does not publish an appointment ID. A prior check-in for the same
       patient is not proof of this encounter, even when the server did return
       it successfully. Keep the surface honest until that immutable echo is
       available; never release the summary on date/name proximity. */
    if (!intakeAppointment || intakeAppointment !== binding.appointmentId) {
      return {
        status: 'unavailable',
        reason: 'intake-exact-visit-binding-unavailable',
        serverAcknowledged: true,
        patientMatched: true
      };
    }
    return {
      status: 'available',
      serverAcknowledged: true, cachedAt: Number(cache.at),
      headline: boundedText(hit.headline, 280),
      bullets: boundedValue(hit.bullets || []),
      summary: boundedText(hit.summary, 4000),
      flags: boundedValue(hit.flags || []),
      askAbout: boundedValue(hit.askAbout || []),
      audited: hit.audited == null ? null : hit.audited,
      truncated: hit.truncated === true || hit.bulletsTruncated === true
    };
  }
  function currentStrongVisitBinding() {
    return safe(function () {
      if (typeof currentVisitAthenaBinding !== 'undefined') return currentVisitAthenaBinding || null;
      return window.currentVisitAthenaBinding || null;
    }, null);
  }
  function currentVisitIsUncompromised() {
    return safe(function () {
      if (typeof currentVisitAthenaCompromised !== 'undefined') return currentVisitAthenaCompromised === false;
      if (own(window, 'currentVisitAthenaCompromised')) return window.currentVisitAthenaCompromised === false;
      return false;
    }, false);
  }
  function activePatientSnapshot() {
    return safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null);
  }
  function easyObservation(proof, binding) {
    var remote = safe(function () { return window.__mlsEasyV32 && window.__mlsEasyV32.remote; }, null);
    if (!remote || !isFn(remote.snapshot)) return { ok: false, reason: 'local-visit-observation-unavailable' };
    var matched = exactScheduleMatch(proof, binding);
    if (!matched.ok) return { ok: false, reason: matched.reason };
    var row = matched.row;
    var before = accountProof(), strongBefore = currentStrongVisitBinding();
    var snapshot = safe(function () { return remote.snapshot(); }, null);
    var strongAfter = currentStrongVisitBinding(), active = activePatientSnapshot(), after = accountProof();
    if (!sameProof(proof, before) || !sameProof(proof, after) || !snapshot || strongBefore !== strongAfter)
      return { ok: false, reason: 'session-changed-during-local-observation' };
    var observed = snapshot.active, ctx = strongBefore && strongBefore.visitContext;
    var boundPatient = strongBefore && strongBefore.patient;
    var snapshotAt = Number(snapshot.ts), now = Date.now();
    if (!observed || text(observed.id) !== binding.selectionId || exactDate(snapshot.day) !== binding.visitDate ||
        !isFinite(snapshotAt) || snapshotAt < now - 15000 || snapshotAt > now + 15000)
      return { ok: false, reason: 'exact-local-visit-ack-unproven' };
    if (!strongBefore || !ctx || !boundPatient || !Object.isFrozen(strongBefore) ||
        !Object.isFrozen(ctx) || !Object.isFrozen(boundPatient) || !currentVisitIsUncompromised() ||
        text(strongBefore.source) !== 'scheduled-appointment' || strongBefore.historical === true ||
        strongBefore.routeBlocked === true || strongBefore.identityConflict === true || ctx.historical === true ||
        text(boundPatient.patientId) !== binding.patientId ||
        text(ctx.appointmentId) !== binding.appointmentId || exactDate(ctx.visitDate) !== binding.visitDate ||
        !providerIdentity(row.provider) || providerIdentity(ctx.provider) !== providerIdentity(row.provider) ||
        !active || text(active.id || active.patientId) !== binding.patientId)
      return { ok: false, reason: 'exact-local-visit-binding-unproven' };
    var rowName = identity(row.name), observedName = identity(observed.name);
    var boundName = identity(boundPatient.name), activeName = identity(active.name);
    if ((rowName && observedName && !compatibleName(rowName, observedName)) ||
        (rowName && boundName && !compatibleName(rowName, boundName)) ||
        (rowName && activeName && !compatibleName(rowName, activeName)) ||
        (boundName && activeName && !compatibleName(boundName, activeName)))
      return { ok: false, reason: 'exact-local-patient-binding-unproven' };
    var rawDob = digits(row._raw && row._raw.dob), observedDob = digits(observed.dob);
    var boundDob = digits(boundPatient.dob), activeDob = digits(active.dob);
    if ((rawDob && observedDob && rawDob !== observedDob) || (rawDob && boundDob && rawDob !== boundDob) ||
        (rawDob && activeDob && rawDob !== activeDob) || (boundDob && activeDob && boundDob !== activeDob))
      return { ok: false, reason: 'exact-local-patient-binding-unproven' };
    return { ok: true, phase: text(snapshot.phase).toLowerCase() || 'idle',
      recording: text(snapshot.phase).toLowerCase() === 'rec', snapshotAt: snapshotAt };
  }

  function durableRecord() {
    return {
      v: 1,
      controlId: encounter.controlId,
      phase: encounter.phase,
      startVisit: encounter.startVisit,
      recording: encounter.recording,
      proposedCount: encounter.proposedActions.length,
      handoff: encounter.handoff.state,
      review: encounter.review.state,
      lastSeq: encounter.lastSeq,
      crossDeviceSupported: false,
      updatedAt: Date.now()
    };
  }
  function persist() {
    if (!encounter || !encounterOwner || !encounterOwner.key) return { ok: false, reason: 'no-encounter' };
    var raw = safe(function () { return JSON.stringify(durableRecord()); }, '');
    if (!raw) return { ok: false, reason: 'metadata-persist-failed' };
    try {
      localStorage.setItem(encounterOwner.key, raw);
      if (localStorage.getItem(encounterOwner.key) !== raw) return { ok: false, reason: 'metadata-persist-failed' };
      encounter.durable = 'verified';
      return { ok: true };
    } catch (error) {
      encounter.durable = 'failed';
      return { ok: false, reason: error && error.name === 'QuotaExceededError' ? 'storage-full' : 'metadata-persist-failed' };
    }
  }
  function removeAt(key) {
    if (!key) return { ok: true, reason: '' };
    try {
      localStorage.removeItem(key);
      return localStorage.getItem(key) === null ? { ok: true, reason: '' } : { ok: false, reason: 'metadata-remove-unverified' };
    } catch (error) { return { ok: false, reason: 'metadata-remove-failed' }; }
  }
  function priorProgress(proof) {
    var raw;
    try { raw = localStorage.getItem(proof.key); } catch (error) { return { present: false, resumable: false, reason: 'metadata-read-failed' }; }
    if (!raw) return { present: false, resumable: false, reason: '' };
    var parsed = safe(function () { return JSON.parse(raw); }, null);
    if (!parsed || Number(parsed.v) !== 1 || !text(parsed.controlId))
      return { present: true, resumable: false, reason: 'metadata-invalid' };
    return {
      present: true, resumable: false, reason: 'exact-visit-binding-required',
      phase: boundedText(parsed.phase, 60), recording: boundedText(parsed.recording, 60),
      handoff: boundedText(parsed.handoff, 60), review: boundedText(parsed.review, 60),
      lastSeq: Math.max(0, Number(parsed.lastSeq) || 0)
    };
  }
  function clearEncounter(reason) {
    var oldOwner = encounterOwner || retainedOwner;
    var oldKey = oldOwner && oldOwner.key;
    cleanupReceipt = removeAt(oldKey);
    encounter = null; encounterOwner = null; retainedOwner = null; handled = Object.create(null); handledOrder = [];
    boundaryReason = text(reason).slice(0, 80);
    return cleanupReceipt;
  }
  function activeSession() {
    var proof = accountProof();
    var priorOwner = encounterOwner || retainedOwner;
    if (priorOwner && !sameProof(proof, priorOwner)) {
      clearEncounter(proof ? 'account-changed' : 'logout');
      /* The old encounter is gone before this proof is returned. A verified
         Account B schedule may render immediately; no Account A clinical value
         survives for a one-call transient. */
      if (proof) retainedOwner = proof;
      return proof;
    }
    if (proof && !retainedOwner) retainedOwner = proof;
    return proof;
  }
  function currentClinical(proof) {
    if (!encounter) return null;
    var chart = chartContext(proof, encounter.binding);
    return { history: chart.history, procedures: chart.procedures, intake: intakeContext(proof, encounter.binding) };
  }
  function emptySurface(status, reason) {
    return { status: status, reason: reason || '' };
  }
  function snapshot() {
    var proof = activeSession();
    /* Retire an invalidated selection before reading any patient chart, intake,
       or in-memory proposal. state() itself is a clinical read boundary, not
       merely a renderer for data validated by some earlier dispatch. */
    if (proof && encounter && !exactScheduleMatch(proof, encounter.binding).ok) clearEncounter('stale-visit');
    var schedule = proof ? scheduleRows(proof) : { status: 'unavailable', date: '', rows: [], omitted: 0 };
    var clinical = proof && encounter ? currentClinical(proof) : null;
    return {
      installed: !!(owner && owner.installed === true),
      ready: !!proof,
      reason: proof ? '' : 'signin-or-account-binding-unproven',
      capabilities: CAPABILITIES,
      todaySchedule: publicSchedule(schedule),
      nextPatient: nextPatient(schedule),
      binding: encounter ? copy(encounter.binding) : null,
      progress: encounter ? { phase: encounter.phase, lastSeq: encounter.lastSeq, nextSeq: encounter.lastSeq + 1 } :
        { phase: 'not-selected', lastSeq: 0, nextSeq: 1 },
      startVisit: encounter ? { state: encounter.startVisit, acknowledgement: encounter.startVisit === 'observed' ? 'local-observation' : 'none', serverAcknowledged: false } : emptySurface('not-selected'),
      recording: encounter ? { state: encounter.recording, acknowledgement: encounter.recording === 'recording' || encounter.recording === 'stopped' ? 'local-observation' : 'none', serverAcknowledged: false } : emptySurface('not-selected'),
      relevantHistory: clinical ? clinical.history : emptySurface('not-selected'),
      priorProcedures: clinical ? clinical.procedures : emptySurface('not-selected'),
      intakeSummary: clinical ? clinical.intake : emptySurface('not-selected'),
      proposedActions: encounter ? copy(encounter.proposedActions) : [],
      handoff: encounter ? copy(encounter.handoff) : { state: 'not-selected', crossDevice: false, serverAcknowledged: false },
      review: encounter ? copy(encounter.review) : { state: 'not-selected', executesFinalAction: false },
      durable: encounter ? { status: encounter.durable, controlId: encounter.controlId } :
        (proof ? priorProgress(proof) : { present: false, resumable: false, reason: 'signin' }),
      boundary: { reason: boundaryReason, cleanup: copy(cleanupReceipt) }
    };
  }

  function refusal(reason, extra) {
    var out = { ok: false, applied: false, reason: reason, state: snapshot() };
    if (extra) for (var key in extra) if (own(extra, key)) out[key] = extra[key];
    return out;
  }
  function success(extra) {
    var out = { ok: true, applied: true, reason: '', state: snapshot() };
    if (extra) for (var key in extra) if (own(extra, key)) out[key] = extra[key];
    return out;
  }
  function bindingFor(id) {
    var proof = activeSession();
    if (!proof) return null;
    id = text(id);
    var schedule = scheduleRows(proof), matches = [];
    for (var i = 0; i < schedule.rows.length; i++) if (schedule.rows[i].selectionId === id) matches.push(schedule.rows[i]);
    if (matches.length !== 1) return null;
    var binding = { account: proof.account, epoch: proof.epoch, selectionId: matches[0].selectionId,
      appointmentId: matches[0].appointmentId, patientId: matches[0].patientId, visitDate: proof.today };
    return exactScheduleMatch(proof, binding).ok ? Object.freeze(binding) : null;
  }
  function openEncounter(rawBinding) {
    var proof = activeSession(), binding = normalizeBinding(rawBinding);
    if (!proof) return refusal('signin-or-account-binding-unproven');
    if (!binding || binding.account !== proof.account || binding.epoch !== proof.epoch || binding.visitDate !== proof.today)
      return refusal('exact-visit-binding-unproven');
    if (encounter) return bindingMatches(binding) ? success({ applied: false, duplicate: true }) : refusal('another-encounter-active');
    var matched = exactScheduleMatch(proof, binding);
    if (!matched.ok) return refusal(matched.reason);
    encounterOwner = proof;
    retainedOwner = proof;
    encounter = {
      controlId: randomId(), binding: Object.freeze(copy(binding)),
      phase: 'selected', startVisit: 'not-observed', recording: 'idle',
      proposedActions: [],
      handoff: { state: 'not-ready', crossDevice: false, serverAcknowledged: false },
      review: { state: 'not-ready', executesFinalAction: false },
      lastSeq: 0, durable: 'pending'
    };
    handled = Object.create(null); handledOrder = []; boundaryReason = '';
    var saved = persist();
    if (!saved.ok) { encounter = null; encounterOwner = null; return refusal(saved.reason); }
    return success();
  }

  function hashEvent(value) {
    var raw = safe(function () { return JSON.stringify(value); }, ''), hash = 2166136261;
    for (var i = 0; i < raw.length; i++) { hash ^= raw.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
  }
  function remember(eventId, fingerprint) {
    handled[eventId] = fingerprint; handledOrder.push(eventId);
    if (handledOrder.length > 128) delete handled[handledOrder.shift()];
  }
  function proposal(raw) {
    raw = raw && typeof raw === 'object' ? raw : { summary: raw };
    return {
      kind: boundedText(raw.kind || raw.type || 'suggestion', 80),
      title: boundedText(raw.title || raw.label || '', 300),
      summary: boundedText(raw.summary || raw.detail || raw.text || '', 4000),
      payload: boundedValue(raw.payload || null),
      executable: false,
      requiresClinicianReview: true
    };
  }
  function finalActionType(type) {
    return /(?:sign|order|prescri|cod(?:e|ing)|bill|claim|submit|final|save|send|write|place|execute)/i.test(type);
  }
  function dispatch(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var proof = activeSession();
    if (!proof || !encounter) return refusal('no-active-encounter');
    if (!exactScheduleMatch(proof, encounter.binding).ok) {
      clearEncounter('stale-visit');
      return refusal('stale-visit');
    }
    if (raw.source !== 'local') return refusal(CROSS_DEVICE_REASON, { crossDevice: false });
    if (raw.targetDeviceId || raw.remote === true || raw.crossDevice === true)
      return refusal(CROSS_DEVICE_REASON, { crossDevice: false });
    if (!bindingMatches(raw.binding)) return refusal('stale-visit');
    var eventId = text(raw.eventId), type = text(raw.type).toLowerCase(), seq = Number(raw.seq);
    if (!eventId || eventId.length > MAX_EVENT_ID || /[\x00-\x1f\x7f]/.test(eventId) ||
        !isFinite(seq) || Math.floor(seq) !== seq || seq < 1) return refusal('invalid-event');
    var fingerprint = hashEvent(raw);
    if (own(handled, eventId)) {
      if (handled[eventId] !== fingerprint) return refusal('event-id-conflict');
      return { ok: true, applied: false, duplicate: true, reason: '', state: snapshot() };
    }
    if (seq !== encounter.lastSeq + 1) return refusal('out-of-order-event', { expectedSeq: encounter.lastSeq + 1 });
    if (finalActionType(type)) return refusal('human-final-action-required');

    var before = copy(encounter), observation;
    if (type === 'start_visit') {
      if (encounter.phase !== 'selected') return refusal('invalid-transition');
      observation = easyObservation(proof, encounter.binding);
      if (!observation.ok) return refusal(observation.reason);
      encounter.phase = 'in-visit'; encounter.startVisit = 'observed';
      encounter.recording = observation.recording ? 'recording' : 'idle';
    } else if (type === 'recording_started') {
      if (encounter.startVisit !== 'observed' || (encounter.phase !== 'in-visit' && encounter.phase !== 'recording'))
        return refusal('invalid-transition');
      observation = easyObservation(proof, encounter.binding);
      if (!observation.ok || observation.recording !== true) return refusal(observation.ok ? 'recording-ack-unproven' : observation.reason);
      encounter.phase = 'recording'; encounter.recording = 'recording';
    } else if (type === 'recording_stopped') {
      if (encounter.recording !== 'recording') return refusal('invalid-transition');
      observation = easyObservation(proof, encounter.binding);
      if (!observation.ok || observation.recording === true || !/^(stopped|gen|note|idle)$/.test(observation.phase))
        return refusal(observation.ok ? 'recording-stop-ack-unproven' : observation.reason);
      encounter.phase = 'in-visit'; encounter.recording = 'stopped';
    } else if (type === 'propose_actions') {
      if (encounter.startVisit !== 'observed' || encounter.recording === 'recording' || !Array.isArray(raw.actions))
        return refusal('invalid-transition');
      encounter.proposedActions = raw.actions.slice(0, 25).map(proposal);
    } else if (type === 'end_handoff') {
      if (raw.explicit !== true || encounter.startVisit !== 'observed' || encounter.recording === 'recording')
        return refusal('explicit-local-handoff-required');
      encounter.phase = 'handoff';
      encounter.handoff = { state: 'ready-for-local-review', crossDevice: false, serverAcknowledged: false };
      encounter.review = { state: 'ready', executesFinalAction: false };
    } else if (type === 'review_opened') {
      if (encounter.handoff.state !== 'ready-for-local-review' || raw.explicit !== true) return refusal('invalid-transition');
      encounter.phase = 'review'; encounter.review = { state: 'open', executesFinalAction: false };
    } else if (type === 'review_acknowledged') {
      if (encounter.review.state !== 'open' || raw.explicit !== true) return refusal('invalid-transition');
      encounter.review = { state: 'acknowledged', executesFinalAction: false };
    } else return refusal('unsupported-event');

    encounter.lastSeq = seq;
    var saved = persist();
    if (!saved.ok) { encounter = before; return refusal(saved.reason); }
    remember(eventId, fingerprint);
    return success();
  }

  function reconcile() {
    var proof = activeSession();
    if (!proof || !encounter) return refusal('no-active-encounter');
    var match = exactScheduleMatch(proof, encounter.binding);
    if (!match.ok) { clearEncounter('stale-visit'); return refusal('stale-visit'); }
    if (encounter.startVisit === 'observed' && encounter.phase !== 'handoff' && encounter.phase !== 'review') {
      var observation = easyObservation(proof, encounter.binding);
      if (!observation.ok) { clearEncounter('stale-visit'); return refusal('stale-visit'); }
      if (observation.recording) { encounter.phase = 'recording'; encounter.recording = 'recording'; }
      else if (/^(stopped|gen|note)$/.test(observation.phase)) { encounter.phase = 'in-visit'; encounter.recording = 'stopped'; }
    }
    var saved = persist();
    return saved.ok ? success({ applied: false }) : refusal(saved.reason);
  }
  function safeNotification(kind) {
    kind = text(kind).toLowerCase();
    var body = kind === 'intake-ready'
      ? 'A pre-visit update is ready. Open MLS to review.'
      : kind === 'review-ready'
        ? 'A visit is ready for review. Open MLS to continue.'
        : 'A visit update is ready. Open MLS to review.';
    return Object.freeze({
      title: 'MLS Scribe', body: body, tag: 'mls-p1-visit-update',
      data: Object.freeze({ route: '/cloned/' })
    });
  }
  function requestCrossDeviceContinuation() {
    return refusal(CROSS_DEVICE_REASON, { crossDevice: false, serverAcknowledged: false });
  }
  function requestFinalAction() { return refusal('human-final-action-required'); }
  function onSessionBoundary(event) {
    var detail = event && event.detail || {};
    clearEncounter(text(detail.reason) || (text(detail.nextAccount) ? 'account-changed' : 'logout'));
  }
  function addListener(target, type, fn, capture) {
    safe(function () { target.addEventListener(type, fn, !!capture); listeners.push([target, type, fn, !!capture]); });
  }
  function revert() {
    clearEncounter('revert');
    for (var i = 0; i < listeners.length; i++) {
      (function (row) { safe(function () { row[0].removeEventListener(row[1], row[2], row[3]); }); })(listeners[i]);
    }
    listeners = [];
    if (owner) owner.installed = false;
    if (window.__mlsP1MobileEncounter === owner) {
      try { delete window.__mlsP1MobileEncounter; } catch (error) { window.__mlsP1MobileEncounter = null; }
    }
    return cleanupReceipt.ok === true;
  }

  retainedOwner = accountProof();
  owner = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    installToken: installToken,
    capabilities: function () { return CAPABILITIES; },
    state: snapshot,
    bindingFor: bindingFor,
    openEncounter: openEncounter,
    dispatch: dispatch,
    reconcile: reconcile,
    clear: function () { return clearEncounter('explicit-clear'); },
    safeNotification: safeNotification,
    requestCrossDeviceContinuation: requestCrossDeviceContinuation,
    requestFinalAction: requestFinalAction,
    revert: revert
  };
  window.__mlsP1MobileEncounter = owner;
  addListener(window, 'mls:session-boundary', onSessionBoundary, true);
})();

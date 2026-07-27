/* ===== Exact scheduled Athena encounter open + read-only verification =====
 *
 * The existing Athena status popover owns the receipt display. This reversible
 * feature owns one narrower interaction: a clinician's trusted click on
 * #mlsSyncVerifyNow. It opens only the appointment ID frozen into the current
 * MLS visit binding, requires the extension's appointment-navigation proof,
 * and only then asks the existing typed Athena action bridge for a read-only
 * exact-context probe. It never runs on load, pulls a schedule, or executes a
 * write action.
 */
(function () {
  'use strict';

  if (window.__mlsExactEncounterVerify) return;

  /* b745 (write-blocker audit #41): the exact-build pin froze this affordance
     at 2.9.44 forever - every extension release since made "Open and verify
     exact Athena encounter" fail unconditionally, killing the one read-only
     verification affordance. A minimum VERSION is the right bar: the digest
     integrity of the running extension is already proven by the release train
     (stamped version_name + byte-verified package), not by this module. */
  var MIN_EXTENSION_VERSION = '3.0.23';
  var VERIFY_NOTE = 'MLS read-only exact encounter verification. This text must never be written.';
  var OPEN_TIMEOUT_MS = 76000;
  var OPEN_DEADLINE_MS = 75000;
  var disposed = false;
  var installed = false;
  var waitingForDom = false;
  var observer = null;
  var pendingBridges = [];
  var api = null;
  var state = {
    busy: false,
    phase: 'idle',
    errorCode: '',
    message: '',
    extensionVersion: '',
    extensionBuildId: '',
    serial: 0,
    lastVerifiedAt: '',
    contextFingerprint: '',
    contextCleared: false
  };

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }
  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function digits(value) { return String(value == null ? '' : value).replace(/\D/g, ''); }
  function normName(value) {
    var raw = text(value), comma = /^\s*([^,]+),\s*(.+)$/.exec(raw);
    if (comma) raw = comma[2] + ' ' + comma[1];
    return raw.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function dateParts(value) {
    var raw = text(value), match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
    var year, month, day, check;
    if (match) {
      year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
    } else {
      match = /^([01]?\d)[\/\-.]([0-3]?\d)[\/\-.](\d{2,4})$/.exec(raw);
      if (!match) return null;
      month = Number(match[1]); day = Number(match[2]); year = Number(match[3]);
      if (year < 100) year += year > 50 ? 1900 : 2000;
    }
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return { year: year, month: month, day: day };
  }
  function isoDate(value) {
    var p = dateParts(value);
    if (!p) return '';
    return p.year + '-' + ('0' + p.month).slice(-2) + '-' + ('0' + p.day).slice(-2);
  }
  function dateKey(value) {
    var p = dateParts(value);
    return p ? (p.month + '/' + p.day + '/' + p.year) : '';
  }
  function urlKey(value) { return text(value).split('#')[0]; }
  function encounterIdFromUrl(value) {
    var raw = urlKey(value), match = /\/(?:encounter|visit|appointment)\/(\d{3,})/i.exec(raw) || /(?:encounter|appointment|visit)(?:id)?[=\/](\d{3,})/i.exec(raw);
    return match ? match[1] : '';
  }
  function positiveInteger(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value > 0;
  }
  function nonnegativeInteger(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0;
  }
  function versionAtLeast(actual, minimum) {
    var actualText = text(actual), minimumText = text(minimum), a, b, i, av, bv;
    if (!/^\d+(?:\.\d+){0,3}$/.test(actualText) || !/^\d+(?:\.\d+){0,3}$/.test(minimumText)) return false;
    a = actualText.split('.'); b = minimumText.split('.');
    for (i = 0; i < 4; i++) {
      av = Number(a[i] || 0); bv = Number(b[i] || 0);
      if (av > bv) return true;
      if (av < bv) return false;
    }
    return true;
  }
  function verifyStorageKey() {
    return safe(function () {
      var email = '';
      if (typeof window.getSessionEmail === 'function') email = text(window.getSessionEmail());
      if (!email && typeof session !== 'undefined' && session) email = text(session.email);
      if (!email && window.bkUser) email = text(window.bkUser.email);
      email = email.toLowerCase();
      return /^[\w.+-]+@[\w.-]+\.\w+$/.test(email) ? ('sf_u::' + email + '::mlsSyncLog::activePatientVerify') : '';
    }, '');
  }
  function activePatientSnapshot() {
    return safe(function () {
      var id = window.getActivePtId && window.getActivePtId();
      var patient = id && window.findPatient && window.findPatient(id);
      if (!patient && typeof window.activePatient === 'function') patient = window.activePatient();
      var patientId = text(patient && (patient.id || patient.patientId || patient.patient_external_id) || id);
      if (!patient || !patientId) return null;
      return {
        patientId: patientId,
        name: text(patient.name),
        dob: text(patient.dob),
        mrn: text(patient.mrn || patient.athenaId || patient.athenaPatientId)
      };
    }, null);
  }
  function visitBinding() {
    return safe(function () {
      if (typeof currentVisitAthenaBinding !== 'undefined' && currentVisitAthenaBinding) return currentVisitAthenaBinding;
      return window.currentVisitAthenaBinding || null;
    }, null);
  }
  function exactSnapshot() {
    var patient = activePatientSnapshot(), binding = visitBinding(), context, bindingPatientId, appointmentId, visitDate, provider, accountKey;
    if (!patient || !patient.patientId || !patient.name || !dateKey(patient.dob) || !digits(patient.mrn)) return null;
    if (!binding || !text(binding.id) || !binding.patient) return null;
    bindingPatientId = text(binding.patient.patientId || binding.patient.id);
    if (!bindingPatientId || bindingPatientId !== patient.patientId) return null;
    if (normName(binding.patient.name) !== normName(patient.name) || dateKey(binding.patient.dob) !== dateKey(patient.dob) || digits(binding.patient.mrn) !== digits(patient.mrn)) return null;
    context = binding.visitContext || {};
    appointmentId = text(context.appointmentId);
    visitDate = isoDate(context.visitDate || binding.displayDate);
    provider = text(context.provider || binding.displayProvider);
    accountKey = verifyStorageKey();
    /* The typed Athena probe canonicalizes appointment IDs to digits. Refuse a
       lossy/non-numeric local identity instead of silently weakening it. */
    if (!/^\d+$/.test(appointmentId) || appointmentId.length > 40 || !visitDate || !normName(provider) || !accountKey) return null;
    return Object.freeze({
      patient: Object.freeze({ patientId: patient.patientId, name: patient.name, dob: patient.dob, mrn: patient.mrn }),
      visit: Object.freeze({
        bindingId: text(binding.id),
        visitDate: visitDate,
        provider: provider,
        providerKey: normName(provider),
        appointmentId: appointmentId,
        encounterId: digits(context.encounterId),
        encounterUrl: urlKey(context.encounterUrl)
      }),
      accountKey: accountKey
    });
  }
  function snapshotFingerprint(snapshot) {
    if (!snapshot) return '';
    return [
      snapshot.accountKey,
      snapshot.patient.patientId,
      normName(snapshot.patient.name),
      dateKey(snapshot.patient.dob),
      digits(snapshot.patient.mrn),
      snapshot.visit.bindingId,
      snapshot.visit.visitDate,
      snapshot.visit.providerKey,
      snapshot.visit.appointmentId,
      snapshot.visit.encounterId,
      snapshot.visit.encounterUrl
    ].join('|');
  }
  function uiFingerprint() {
    var exact = exactSnapshot(), patient, accountKey;
    if (exact) return 'exact|' + snapshotFingerprint(exact);
    patient = activePatientSnapshot();
    accountKey = verifyStorageKey();
    return patient ? ['patient', accountKey, patient.patientId, normName(patient.name), dateKey(patient.dob), digits(patient.mrn)].join('|') : ('none|' + accountKey);
  }
  function stillCurrent(frozen) {
    return !disposed && !!frozen && snapshotFingerprint(exactSnapshot()) === snapshotFingerprint(frozen);
  }
  function failure(code, message) {
    var error = new Error(message);
    error.mlsSafeCode = code;
    return error;
  }
  function requireCurrent(frozen) {
    if (!stillCurrent(frozen)) throw failure('binding-changed', 'The active patient or scheduled visit changed. The old result was discarded.');
  }
  function requestId(prefix) {
    var nonce = '';
    safe(function () {
      var words = new Uint32Array(3), i;
      if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') return;
      window.crypto.getRandomValues(words);
      for (i = 0; i < words.length; i++) nonce += ('00000000' + words[i].toString(16)).slice(-8);
    });
    if (!nonce) nonce = Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 11);
    return prefix + '-' + Date.now() + '-' + nonce;
  }

  function bridgeOnce(type, payload, responseType, timeoutMs, correlatedId, frozen) {
    return new Promise(function (resolve) {
      var done = false, timeout = null, guardTimer = null, cancel;
      function forgetCancel() {
        var index = pendingBridges.indexOf(cancel);
        if (index >= 0) pendingBridges.splice(index, 1);
      }
      function finish(value) {
        if (done) return;
        done = true;
        safe(function () { window.removeEventListener('message', onMessage, false); });
        if (timeout) clearTimeout(timeout);
        if (guardTimer) clearInterval(guardTimer);
        forgetCancel();
        resolve(value || null);
      }
      function onMessage(event) {
        var data = event && event.data;
        /* A correlated envelope still has to come from this exact page. The
           content script replies with window.postMessage(..., pageOrigin), so
           accepting a frame/foreign-origin message would only weaken proof. */
        if (!event || event.source !== window || text(event.origin) !== text(window.location && window.location.origin)) return;
        if (!data || data.source !== 'mls-ext' || data.type !== responseType) return;
        if (correlatedId && text(data.requestId) !== correlatedId) return;
        finish(data.resp || data);
      }
      cancel = function () { finish({ __aborted: true, ok: false, reason: 'disposed' }); };
      pendingBridges.push(cancel);
      if (disposed) { cancel(); return; }
      safe(function () { window.addEventListener('message', onMessage, false); });
      if (frozen) {
        guardTimer = setInterval(function () {
          if (!stillCurrent(frozen)) finish({ __aborted: true, ok: false, reason: 'binding-changed' });
        }, 50);
      }
      try {
        var message = { source: 'mls-app', from: 'mls-app', type: type };
        var key;
        for (key in (payload || {})) if (Object.prototype.hasOwnProperty.call(payload, key)) message[key] = payload[key];
        if (correlatedId) message.requestId = correlatedId;
        window.postMessage(message, '*');
      } catch (e) {
        finish({ ok: false, reason: 'bridge-unavailable' });
        return;
      }
      timeout = setTimeout(function () { finish({ __timeout: true, ok: false, reason: 'timeout' }); }, timeoutMs);
    });
  }

  function validatePong(pong) {
    var version = text(pong && (pong.version || pong.extVersion)), buildId = text(pong && pong.buildId);
    if (!pong || pong.__timeout || pong.ok === false) throw failure('extension-unavailable', 'MLS Assist did not answer. No Athena encounter was opened.');
    if (!versionAtLeast(version, MIN_EXTENSION_VERSION)) throw failure('update-required', 'Update MLS Assist to v' + MIN_EXTENSION_VERSION + ' or newer before exact encounter verification.');
    /* b745: a digest-stamped buildId must still be PRESENT (an unstamped dev
       build stays refused), but the exact value tracks the release train. */
    if (!/^\d+(?:\.\d+){1,3}\+core-sha256:[0-9a-f]{64}$/.test(buildId)) throw failure('extension-build-unapproved', 'MLS Assist is not a stamped release build. Install the released MLS Assist package before verification.');
    state.extensionVersion = version;
    state.extensionBuildId = buildId;
    return version;
  }
  function validateOpen(opened, frozen, openId, deadlineAt) {
    var frames, i, seen = {};
    if (opened && opened.__aborted) throw failure('binding-changed', 'The active patient or scheduled visit changed. The old result was discarded.');
    if (!opened || opened.__timeout) throw failure('open-timeout', 'Athena did not return the exact encounter proof in time. Nothing was verified.');
    if (opened.ok !== true || opened.opened !== true) {
      if (text(opened.reason) === 'appointment-id-ambiguous') throw failure('open-ambiguous', 'Athena found more than one row for this appointment. Nothing was verified.');
      throw failure('open-failed', 'Athena could not open the exact scheduled appointment. Nothing was verified.');
    }
    if (text(opened.requestId) !== openId || Number(opened.deadlineAt) !== deadlineAt) throw failure('open-uncorrelated', 'Athena returned an uncorrelated open result. Nothing was verified.');
    if (text(opened.via) !== 'appointment-id' || text(opened.appointmentId) !== frozen.visit.appointmentId) throw failure('wrong-appointment', 'Athena opened a different appointment. Verification stopped.');
    frames = opened.appointmentNavigationFrameIds;
    if (opened.appointmentIdBound !== true || !positiveInteger(opened.athenaTabId) || !Array.isArray(frames) || !frames.length || frames.length > 24) throw failure('navigation-unverified', 'Athena did not prove navigation from the exact appointment row. Nothing was verified.');
    for (i = 0; i < frames.length; i++) {
      if (!nonnegativeInteger(frames[i]) || seen[String(frames[i])]) throw failure('navigation-unverified', 'Athena did not prove navigation from the exact appointment row. Nothing was verified.');
      seen[String(frames[i])] = true;
    }
    return {
      appointmentId: frozen.visit.appointmentId,
      appointmentIdBound: true,
      athenaTabId: opened.athenaTabId,
      appointmentNavigationFrameIds: frames.slice(0),
      requestId: openId,
      deadlineAt: deadlineAt
    };
  }
  function samePatientContext(frozen, context) {
    return !!context &&
      normName(context.patientName || context.name) === normName(frozen.patient.name) &&
      dateKey(context.dob) === dateKey(frozen.patient.dob) &&
      digits(context.mrn) === digits(frozen.patient.mrn);
  }
  function validateProbe(response, frozen, openProof) {
    var context = response && response.context, encounterId, encounterUrl, routeEncounterId;
    if (response && response.__aborted) throw failure('binding-changed', 'The active patient or scheduled visit changed. The old result was discarded.');
    if (!response || response.__timeout) throw failure('probe-timeout', 'Athena did not return the read-only encounter receipt in time. Nothing was verified.');
    /* 2.9.44 deliberately unwraps the driver's contextVerified flag in the
       background and returns the locked context itself. Validate the actual
       public envelope (including its exact read-only reason) plus every field
       of that locked context; requiring a non-existent top-level flag makes a
       real 2.9.44 proof fail forever. */
    if (response.ok !== true || response.readOnly !== true || response.mode !== 'probe' || response.action !== 'write_note' || response.reason !== 'context-verified' || response.noAutomaticChaining !== 'no-automatic-chaining') {
      throw failure('probe-failed', 'Athena did not return a complete read-only exact-encounter receipt. Nothing was verified.');
    }
    if (!openProof || !positiveInteger(response.athenaTabId) || response.athenaTabId !== openProof.athenaTabId) {
      throw failure('probe-tab-mismatch', 'Athena verified a different browser tab than the one that opened this appointment. Nothing was verified.');
    }
    if (!samePatientContext(frozen, context) || text(context.appointmentId) !== frozen.visit.appointmentId || dateKey(context.visitDate) !== dateKey(frozen.visit.visitDate) || normName(context.provider) !== frozen.visit.providerKey) {
      throw failure('probe-context-mismatch', 'Athena returned a different patient, appointment, date, or provider. Nothing was verified.');
    }
    encounterId = digits(context.encounterId);
    encounterUrl = urlKey(context.encounterUrl);
    routeEncounterId = encounterIdFromUrl(encounterUrl);
    if (!encounterId || !encounterUrl || routeEncounterId !== encounterId) throw failure('probe-context-mismatch', 'Athena returned an incomplete exact encounter identity. Nothing was verified.');
    if (frozen.visit.encounterId && frozen.visit.encounterId !== encounterId) throw failure('probe-context-mismatch', 'Athena returned a different encounter. Nothing was verified.');
    if (frozen.visit.encounterUrl && frozen.visit.encounterUrl !== encounterUrl) throw failure('probe-context-mismatch', 'Athena returned a different encounter. Nothing was verified.');
    if (!text(context.framePath) || !text(context.encounterRootFingerprint) || !text(context.controlFingerprint) || !text(context.noteScopeFingerprint) || !text(context.actionContainerFingerprint) || !text(context.editorFingerprint) || !text(context.contextHash)) {
      throw failure('probe-context-incomplete', 'Athena returned an incomplete exact-context proof. Nothing was verified.');
    }
    return context;
  }
  function saveReceipt(frozen, openProof, context, probeId) {
    var receipt = {
      kind: 'athena-active-patient-verification',
      patientId: frozen.patient.patientId,
      patientName: frozen.patient.name,
      patientDob: frozen.patient.dob,
      patientMrn: frozen.patient.mrn,
      verifiedAt: new Date().toISOString(),
      readOnly: true,
      source: 'explicit-exact-encounter-open-and-verify',
      extensionVersion: state.extensionVersion,
      extensionBuildId: state.extensionBuildId,
      localContext: {
        bindingId: frozen.visit.bindingId,
        visitDate: dateKey(frozen.visit.visitDate),
        provider: frozen.visit.providerKey,
        appointmentId: frozen.visit.appointmentId,
        encounterId: frozen.visit.encounterId,
        encounterUrl: frozen.visit.encounterUrl
      },
      openProof: {
        appointmentId: openProof.appointmentId,
        appointmentIdBound: true,
        athenaTabId: openProof.athenaTabId,
        appointmentNavigationFrameIds: openProof.appointmentNavigationFrameIds.slice(0),
        requestId: openProof.requestId,
        deadlineAt: openProof.deadlineAt
      },
      probeProof: {
        requestId: probeId,
        athenaTabId: openProof.athenaTabId,
        mode: 'probe',
        action: 'write_note',
        readOnly: true,
        reason: 'context-verified',
        noAutomaticChaining: 'no-automatic-chaining'
      },
      context: {
        patientName: text(context.patientName),
        dob: text(context.dob),
        mrn: text(context.mrn),
        appointmentId: text(context.appointmentId),
        encounterId: text(context.encounterId),
        encounterUrl: urlKey(context.encounterUrl),
        visitDate: text(context.visitDate),
        provider: text(context.provider),
        framePath: text(context.framePath),
        encounterRootFingerprint: text(context.encounterRootFingerprint),
        controlFingerprint: text(context.controlFingerprint),
        noteScopeFingerprint: text(context.noteScopeFingerprint),
        actionContainerFingerprint: text(context.actionContainerFingerprint),
        editorFingerprint: text(context.editorFingerprint),
        contextHash: text(context.contextHash)
      }
    };
    /* Persist first, then read back the exact serialized proof. The status UI's
       helper is updated only after durable storage succeeds; a quota/security
       error must never become a green but ephemeral verification claim. */
    try {
      var all, stored, serialized = JSON.stringify(receipt);
      try { all = JSON.parse(localStorage.getItem(frozen.accountKey) || '{}'); } catch (parseError) { all = {}; }
      if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
      all[frozen.patient.patientId] = receipt;
      localStorage.setItem(frozen.accountKey, JSON.stringify(all));
      stored = JSON.parse(localStorage.getItem(frozen.accountKey) || '{}');
      if (!stored || JSON.stringify(stored[frozen.patient.patientId]) !== serialized) throw new Error('receipt-readback-mismatch');
    } catch (storageError) {
      throw failure('receipt-storage-failed', 'Athena was verified, but MLS could not durably save the exact receipt. It was not marked verified.');
    }
    safe(function () {
      if (window.__mlsSync && typeof window.__mlsSync.saveVerifyReceipt === 'function') window.__mlsSync.saveVerifyReceipt(receipt);
    });
    return receipt;
  }

  function setPhase(phase, message, errorCode) {
    if (disposed) return;
    state.phase = phase;
    state.message = text(message);
    state.errorCode = text(errorCode);
    decorate();
  }
  function reconcileUiContext() {
    if (disposed || state.busy || !state.contextFingerprint) return;
    if (state.contextFingerprint === uiFingerprint()) return;
    state.phase = 'idle';
    state.errorCode = '';
    state.message = '';
    state.lastVerifiedAt = '';
    state.contextFingerprint = '';
    state.contextCleared = true;
  }
  function findVerifyButton(target) {
    var node = target, hops = 0;
    while (node && hops++ < 8) {
      if (node.id === 'mlsSyncVerifyNow') return node;
      node = node.parentElement;
    }
    return null;
  }
  function rowForButton(button) {
    var pop = safe(function () { return button && button.parentElement; }, null), rows, i, label;
    if (!pop || !pop.querySelectorAll) pop = document.getElementById && document.getElementById('mlsSyncPop');
    if (!pop || !pop.querySelectorAll) return null;
    rows = pop.querySelectorAll('.mls-sp-check');
    for (i = 0; i < rows.length; i++) {
      label = rows[i].querySelector && rows[i].querySelector('b');
      if (label && /^(Open Athena encounter|Exact Athena encounter)$/.test(text(label.textContent))) return rows[i];
    }
    return null;
  }
  function setText(node, value) { if (node && text(node.textContent) !== text(value)) node.textContent = value; }
  function decorate() {
    if (disposed) return;
    reconcileUiContext();
    safe(function () {
      var button = document.getElementById && document.getElementById('mlsSyncVerifyNow');
      var pop, helper, row, label, value, buttonText, safeText;
      if (!button) return;
      pop = button.parentElement;
      buttonText = state.busy ? (state.phase === 'opening' ? 'Opening exact Athena encounter\u2026' : 'Verifying exact Athena encounter\u2026') : 'Open and verify exact Athena encounter \u2014 read-only';
      setText(button, buttonText);
      button.disabled = state.busy === true;
      button.setAttribute('aria-busy', state.busy ? 'true' : 'false');
      helper = pop && pop.querySelector && pop.querySelector('.mls-sp-safe');
      safeText = 'On this click, MLS opens only the exact scheduled Athena appointment and checks its patient, date, provider, and encounter. It never pulls a schedule or writes.';
      setText(helper, safeText);
      if (helper) helper.setAttribute('aria-live', 'polite');
      row = rowForButton(button);
      if (!row) return;
      label = row.querySelector && row.querySelector('b');
      value = row.querySelector && row.querySelector('span');
      setText(label, 'Exact Athena encounter');
      if (state.busy) setText(value, state.phase === 'opening' ? 'Opening the exact scheduled appointment\u2026' : 'Checking the exact encounter read-only\u2026');
      else if (state.phase === 'error') setText(value, state.message || 'Exact encounter verification stopped safely.');
      else if (state.phase === 'success') setText(value, 'Opened and verified read-only.');
      else if (state.phase === 'idle' && (state.contextCleared || !/\bverified read-only\b/i.test(text(value && value.textContent)))) setText(value, 'Ready \u2014 this button opens the exact scheduled visit automatically.');
      if (value) value.setAttribute('aria-live', 'polite');
    });
  }

  function beginExplicitVerification() {
    var frozen, pingId, openId, probeId, openDeadlineAt, openProof;
    if (disposed || state.busy) return;
    frozen = exactSnapshot();
    state.contextFingerprint = uiFingerprint();
    state.contextCleared = false;
    if (!frozen) {
      setPhase('error', 'Choose an exact scheduled patient with MLS ID, name, DOB, MRN, appointment ID, date, and provider first.', 'missing-exact-binding');
      return;
    }
    state.busy = true;
    state.serial += 1;
    state.extensionVersion = '';
    state.extensionBuildId = '';
    setPhase('checking-extension', 'Checking MLS Assist before opening Athena\u2026', '');
    pingId = requestId('exact-encounter-ping');
    bridgeOnce('mlsPing', {}, 'mlsPong', 3000, pingId, frozen).then(function (pong) {
      requireCurrent(frozen);
      validatePong(pong);
      requireCurrent(frozen);
      setPhase('opening', 'Opening the exact scheduled appointment\u2026', '');
      openId = requestId('exact-encounter-open');
      openDeadlineAt = Date.now() + OPEN_DEADLINE_MS;
      return bridgeOnce('mlsAppSearchOpenPatient', {
        name: frozen.patient.name,
        dob: frozen.patient.dob,
        mrn: frozen.patient.mrn,
        appointmentId: frozen.visit.appointmentId,
        bootstrapIdentity: true,
        scheduleDate: frozen.visit.visitDate,
        deadlineAt: openDeadlineAt
      }, 'mlsAppSearchOpenResult', OPEN_TIMEOUT_MS, openId, frozen);
    }).then(function (opened) {
      requireCurrent(frozen);
      openProof = validateOpen(opened, frozen, openId, openDeadlineAt);
      requireCurrent(frozen);
      setPhase('verifying', 'Checking the exact encounter read-only\u2026', '');
      probeId = requestId('exact-encounter-probe');
      return bridgeOnce('mlsAppAthenaActionV2', {
        mode: 'probe',
        action: 'write_note',
        expectedAthenaTabId: openProof.athenaTabId,
        previewHash: 'exact-encounter-readonly-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
        patient: frozen.patient,
        expectedPatient: frozen.patient,
        expectedContext: {
          appointmentId: frozen.visit.appointmentId,
          encounterId: frozen.visit.encounterId,
          encounterUrl: frozen.visit.encounterUrl,
          visitDate: frozen.visit.visitDate,
          provider: frozen.visit.provider
        },
        noteText: VERIFY_NOTE,
        notePolicy: 'empty_only',
        sections: []
      }, 'mlsAppAthenaActionV2Result', 20000, probeId, frozen);
    }).then(function (response) {
      var context;
      requireCurrent(frozen);
      context = validateProbe(response, frozen, openProof);
      requireCurrent(frozen);
      saveReceipt(frozen, openProof, context, probeId);
      state.lastVerifiedAt = new Date().toISOString();
      setPhase('success', 'Opened and verified read-only.', '');
    }).catch(function (error) {
      var code = text(error && error.mlsSafeCode) || 'verification-stopped';
      var message = text(error && error.message) || 'Exact encounter verification stopped safely.';
      /* Keep the safe terminal explanation visible on the context that caused
         the abort. A later, distinct patient/visit change will clear it via
         reconcileUiContext; the final decorate in this same promise chain must
         not erase “old result discarded” before the clinician can see it. */
      if (!disposed && code === 'binding-changed') {
        state.contextFingerprint = uiFingerprint();
        state.contextCleared = false;
      }
      setPhase('error', message, code);
    }).then(function () {
      state.busy = false;
      if (disposed) return;
      safe(function () { if (window.__mlsSync && typeof window.__mlsSync.render === 'function') window.__mlsSync.render(); });
      decorate();
    });
  }

  function onVerifyClick(event) {
    var button = findVerifyButton(event && event.target);
    if (!button) return;
    safe(function () { event.preventDefault(); });
    safe(function () { event.stopPropagation(); });
    safe(function () { event.stopImmediatePropagation(); });
    /* Block synthetic .click() calls too, so the legacy onclick cannot fall
       through and probe/navigate without a clinician's real gesture. */
    if (!event || event.isTrusted !== true) {
      state.contextFingerprint = uiFingerprint();
      state.contextCleared = false;
      setPhase('error', 'Use the visible exact-encounter button directly.', 'trusted-click-required');
      return;
    }
    beginExplicitVerification();
  }
  function install() {
    if (disposed || installed) return;
    installed = true;
    if (api) api.installed = true;
    document.addEventListener('click', onVerifyClick, true);
    if (typeof MutationObserver === 'function') {
      safe(function () {
        observer = new MutationObserver(function () { decorate(); });
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
      });
    }
    decorate();
  }
  function onDomReady() {
    if (!waitingForDom) return;
    waitingForDom = false;
    safe(function () { document.removeEventListener('DOMContentLoaded', onDomReady, false); });
    install();
  }
  function revert() {
    var pending, i;
    if (disposed) return true;
    disposed = true;
    if (waitingForDom) {
      waitingForDom = false;
      safe(function () { document.removeEventListener('DOMContentLoaded', onDomReady, false); });
    }
    if (installed) safe(function () { document.removeEventListener('click', onVerifyClick, true); });
    installed = false;
    if (observer) safe(function () { observer.disconnect(); });
    observer = null;
    pending = pendingBridges.slice(0);
    pendingBridges.length = 0;
    for (i = 0; i < pending.length; i++) safe(pending[i]);
    state.busy = false;
    state.phase = 'disposed';
    state.errorCode = '';
    state.message = '';
    state.contextFingerprint = '';
    if (api) api.installed = false;
    safe(function () {
      if (window.__mlsExactEncounterVerify === api) delete window.__mlsExactEncounterVerify;
    });
    safe(function () { if (window.__mlsExactEncounterVerify === api) window.__mlsExactEncounterVerify = null; });
    return true;
  }

  api = {
    version: 'eev-1.4.0',
    minimumExtensionVersion: MIN_EXTENSION_VERSION,
    /* b745: the exact-build pin is gone; any stamped release >= the minimum
       version verifies. Kept as null so old readers see the field exists. */
    approvedExtensionBuildId: null,
    installed: false,
    state: function () {
      return {
        busy: state.busy,
        phase: state.phase,
        errorCode: state.errorCode,
        message: state.message,
        extensionVersion: state.extensionVersion,
        extensionBuildId: state.extensionBuildId,
        lastVerifiedAt: state.lastVerifiedAt
      };
    },
    decorate: decorate,
    revert: revert,
    _versionAtLeast: versionAtLeast,
    _exactSnapshot: exactSnapshot
  };
  window.__mlsExactEncounterVerify = api;

  if (document.readyState === 'loading') {
    waitingForDom = true;
    document.addEventListener('DOMContentLoaded', onDomReady, false);
  }
  else install();
})();

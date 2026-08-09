/* feat_mls_active_patient_sync.js  (item27, aps-1.2.2)
   UNIFY the "active patient" across surfaces.
   Bug: the NEXT UP picker card click updates the hero "Patient name"
   (#heroPtName) and the "Patient label" (#patientLabel) fields, but the
   OTHER switch paths (the "Switch patient" button, the Patients list, the
   search / cmd-K) only update the roster/context-bar active patient via
   selectPatient() and leave those two visit fields showing the PREVIOUS
   patient. A clinician could switch patients, hit Start recording, and get
   a note labelled for the wrong patient.

   Fix: follow the exact mls:active-patient-changed event emitted by
   setActivePtId() (the single source of truth that the context bar already
   follows), but reconcile on the next task after downstream newVisit() resets
   finish. Exact storage/session signals and one slow structural backstop
   replace the old 400 ms full-roster scan. A settled backstop reads only the
   active id and the two owned fields; it never decodes the patient roster.

   Strictly additive + reversible: window.__mlsActivePtSync.revert().
   Never writes patient/roster data; only mirrors the already-de-identified
   active-patient label into two visit-label inputs, and never overwrites a
   field the user is actively typing in.
*/
(function () {
  if (window.__mlsActivePtSync) return;

  var FIELDS = ['heroPtName', 'patientLabel'];
  var lastName = null;
  var lastActiveId = '';
  var lastRecordMissing = false;
  var backstopTimer = null;
  var pendingTimer = null;
  var storageTask = null;
  var storageTaskIsIdle = false;
  var activeListener = null;
  var recordListener = null;
  var storageListener = null;
  var boundaryListener = null;
  var focusoutListener = null;
  var pendingFields = Object.create(null);
  var stopped = false;

  function activeName() {
    try {
      if (typeof window.activePatient !== 'function') return null;
      var ap = window.activePatient();
      return (ap && typeof ap.name === 'string' && ap.name.trim()) ? ap.name : null;
    } catch (e) { return null; }
  }

  function activeId() {
    try {
      return (typeof window.getActivePtId === 'function') ? String(window.getActivePtId() || '') : '';
    } catch (e) { return ''; }
  }

  function fieldsAreSettled() {
    if (!lastName) return false;
    for (var i = 0; i < FIELDS.length; i++) {
      var el = document.getElementById(FIELDS[i]);
      if (!el || document.activeElement === el || pendingFields[FIELDS[i]] || el.value !== lastName) return false;
    }
    return true;
  }

  function seedNameFromFields() {
    var name = null;
    for (var i = 0; i < FIELDS.length; i++) {
      var el = document.getElementById(FIELDS[i]);
      if (!el) continue;
      var value = (typeof el.value === 'string') ? el.value.trim() : '';
      if (!value) return null;
      if (name !== null && name !== value) return null;
      name = value;
    }
    return name;
  }

  function setField(id, name) {
    var el = document.getElementById(id);
    if (!el) { delete pendingFields[id]; return true; }
    if (document.activeElement === el) { pendingFields[id] = true; return false; }
    delete pendingFields[id];
    if (el.value === name) return true;
    el.value = name;
    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    return true;
  }

  function sync(forceRecord) {
    var id = activeId();
    /* Exact app events force a record refresh. The compatibility timer only
       descends into activePatient() when the binding changed or an owned field
       actually needs repair, keeping stable tabs off the multi-MB codec. */
    if (!id) {
      lastName = null;
      lastActiveId = '';
      lastRecordMissing = false;
      return;
    }
    if (!forceRecord && id === lastActiveId &&
        (fieldsAreSettled() || (!lastName && lastRecordMissing))) return;
    var name = activeName();
    if (!name) {
      lastName = null;
      lastActiveId = id;
      lastRecordMissing = true;
      return;
    }
    lastRecordMissing = false;
    if (name === lastName && fieldsAreSettled()) { lastActiveId = id; return; }
    var complete = true;
    for (var i = 0; i < FIELDS.length; i++) {
      if (!setField(FIELDS[i], name)) complete = false;
    }
    lastName = complete ? name : null;
    lastActiveId = id;
  }

  function tick() {
    if (stopped) return;
    try { sync(); } catch (e) {}
  }

  function activeStorageKey() {
    try { return (typeof window.uns === 'function') ? window.uns('activePt') : null; }
    catch (e) { return null; }
  }

  function queueSync() {
    if (stopped || pendingTimer) return;
    cancelStorageSync();
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      if (stopped) return;
      lastName = null;
      sync(true);
    }, 0);
  }

  function cancelStorageSync() {
    if (storageTask === null) return;
    var task = storageTask, wasIdle = storageTaskIsIdle;
    storageTask = null;
    storageTaskIsIdle = false;
    try {
      if (wasIdle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(task);
      else clearTimeout(task);
    } catch (e) {}
  }

  function queueStorageSync() {
    if (stopped || pendingTimer || storageTask !== null) return;
    var run = function () {
      storageTask = null;
      storageTaskIsIdle = false;
      if (!stopped) sync(true);
    };
    try {
      if (typeof window.requestIdleCallback === 'function') {
        storageTaskIsIdle = true;
        storageTask = window.requestIdleCallback(run);
      } else {
        storageTask = setTimeout(run, 250);
      }
    } catch (e) { storageTask = null; storageTaskIsIdle = false; }
  }

  function invalidateStorageIdentity() {
    var id = activeId();
    if (id === lastActiveId) return;
    /* localStorage adopts the new id before this event runs. Never leave the
       old patient's label beside that new binding while the roster lookup is
       waiting for idle; an empty label fails closed. */
    lastActiveId = id;
    lastName = null;
    lastRecordMissing = false;
    for (var i = 0; i < FIELDS.length; i++) {
      var el = document.getElementById(FIELDS[i]);
      if (!el) continue;
      pendingFields[FIELDS[i]] = true;
      if (el.value === '') continue;
      el.value = '';
      try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    }
  }

  function start() {
    activeListener = queueSync;
    recordListener = function (ev) {
      if (stopped || !ev || !ev.detail) return;
      var patientId = String(ev.detail.patientId || '');
      if (!patientId) return;
      try {
        if (typeof window.getActivePtId !== 'function' || String(window.getActivePtId() || '') !== patientId) return;
        if (ev.detail.patientStoreKey && typeof window.uns === 'function' &&
            String(window.uns('patients') || '') !== String(ev.detail.patientStoreKey)) return;
      } catch (e) { return; }
      queueSync();
    };
    storageListener = function (ev) {
      if (stopped || !ev) return;
      var key = activeStorageKey();
      if (!key || ev.key !== key) return;
      try { if (ev.storageArea && ev.storageArea !== window.localStorage) return; } catch (e) {}
      invalidateStorageIdentity();
      queueStorageSync();
    };
    boundaryListener = queueSync;
    focusoutListener = function (ev) {
      var id = ev && ev.target && ev.target.id;
      if (!id || !pendingFields[id]) return;
      queueSync();
    };
    try { window.addEventListener('mls:active-patient-changed', activeListener); } catch (e) {}
    try { window.addEventListener('mls:patient-record-updated', recordListener); } catch (e) {}
    try { window.addEventListener('storage', storageListener); } catch (e) {}
    try { window.addEventListener('mls:session-boundary', boundaryListener); } catch (e) {}
    try { document.addEventListener('focusout', focusoutListener, true); } catch (e) {}
    backstopTimer = setInterval(tick, 15000);
  }

  function stop() {
    if (backstopTimer) { clearInterval(backstopTimer); backstopTimer = null; }
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    cancelStorageSync();
    try { if (activeListener) window.removeEventListener('mls:active-patient-changed', activeListener); } catch (e) {}
    try { if (recordListener) window.removeEventListener('mls:patient-record-updated', recordListener); } catch (e) {}
    try { if (storageListener) window.removeEventListener('storage', storageListener); } catch (e) {}
    try { if (boundaryListener) window.removeEventListener('mls:session-boundary', boundaryListener); } catch (e) {}
    try { if (focusoutListener) document.removeEventListener('focusout', focusoutListener, true); } catch (e) {}
    activeListener = recordListener = storageListener = boundaryListener = focusoutListener = null;
    pendingFields = Object.create(null);
  }

  // Seed from the already-rendered owned fields without touching the roster.
  // Normal changes reconcile after the switching stack; the slow backstop
  // retains same-ID rename/noncanonical compatibility.
  lastActiveId = activeId();
  lastName = lastActiveId ? seedNameFromFields() : null;
  lastRecordMissing = false;
  start();

  window.__mlsActivePtSync = {
    installed: true,
    version: 'aps-1.2.2',
    revert: function () {
      stopped = true;
      stop();
      try { delete window.__mlsActivePtSync; } catch (e) { window.__mlsActivePtSync = undefined; }
    },
    syncNow: function () { lastName = null; sync(true); },
    _activeName: activeName
  };
})();

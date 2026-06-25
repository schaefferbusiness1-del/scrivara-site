/* feat_mls_active_patient_sync.js  (item27)
   UNIFY the "active patient" across surfaces.
   Bug: the NEXT UP picker card click updates the hero "Patient name"
   (#heroPtName) and the "Patient label" (#patientLabel) fields, but the
   OTHER switch paths (the "Switch patient" button, the Patients list, the
   search / cmd-K) only update the roster/context-bar active patient via
   selectPatient() and leave those two visit fields showing the PREVIOUS
   patient. A clinician could switch patients, hit Start recording, and get
   a note labelled for the wrong patient.

   Fix: poll activePatient() (the single source of truth that the context
   bar already follows) and, whenever it changes, push the new de-identified
   patient label into #heroPtName and #patientLabel — so every switch path
   converges on one consistent active patient.

   Strictly additive + reversible: window.__mlsActivePtSync.revert().
   Never writes patient/roster data; only mirrors the already-de-identified
   active-patient label into two visit-label inputs, and never overwrites a
   field the user is actively typing in.
*/
(function () {
  if (window.__mlsActivePtSync) return;

  var FIELDS = ['heroPtName', 'patientLabel'];
  var lastName = null;
  var timer = null;
  var stopped = false;

  function activeName() {
    try {
      if (typeof window.activePatient !== 'function') return null;
      var ap = window.activePatient();
      return (ap && typeof ap.name === 'string' && ap.name.trim()) ? ap.name : null;
    } catch (e) { return null; }
  }

  function setField(id, name) {
    var el = document.getElementById(id);
    if (!el) return;
    if (document.activeElement === el) return; // never clobber active typing
    if (el.value === name) return;             // already correct -> no-op
    el.value = name;
    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  }

  function sync() {
    var name = activeName();
    if (!name) return;
    if (name === lastName) return; // only act on an actual patient switch
    lastName = name;
    for (var i = 0; i < FIELDS.length; i++) setField(FIELDS[i], name);
  }

  function tick() {
    if (stopped) return;
    try { sync(); } catch (e) {}
  }

  // Seed without writing: on load the app already initialises these fields to
  // the active patient, so we only intervene on subsequent switches.
  lastName = activeName();
  timer = setInterval(tick, 400);

  window.__mlsActivePtSync = {
    revert: function () {
      stopped = true;
      if (timer) { clearInterval(timer); timer = null; }
      try { delete window.__mlsActivePtSync; } catch (e) { window.__mlsActivePtSync = undefined; }
    },
    syncNow: function () { lastName = null; tick(); },
    _activeName: activeName
  };
})();

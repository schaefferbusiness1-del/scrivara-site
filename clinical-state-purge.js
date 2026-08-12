/* MLS account clinical-state purge boundary.
 *
 * Logout runs on shared clinical workstations. Every key in the current
 * account namespace is therefore removed by prefix, including future caches
 * that do not yet exist when this file is reviewed. A separate derived family
 * matcher removes legacy/global clinical stores that predate namespacing.
 * Per-tab sessionStorage is cleared in full. Local UI-only preferences outside
 * the account namespace may remain; another account's namespace is untouched.
 */
(function (root) {
  'use strict';
  if (root.__mlsClinicalStatePurge) return;

  var EXACT_GLOBAL_KEYS = Object.freeze([
    'sf_bk_token', 'sf_session', 'sf_user',
    'providerName', 'sf_studio_widgets',
    'mls_playbooks', 'mls_recordings',
    'mls_legal_visit_links', 'mlsReviewReq',
    'mlsRepMat', 'mlsP1TplBackup',
    'mlsRF', 'mlsRFLinks', 'mlsRFScrapeCache', 'mlsRFScrapeCache2',
    'mls_patient_session', 'mls_patient_setup'
  ]);
  var EXACT = Object.create(null);
  EXACT_GLOBAL_KEYS.forEach(function (key) { EXACT[key] = true; });

  /* These terms are derived from production storage writers. Keep the test's
     independent source scan in sync: any new global clinical key fails CI
     until this family boundary classifies it. */
  var GLOBAL_CLINICAL_FAMILY = /(?:patient|recent[_-]?pts|appt|appointment|calappt|calendar|provider|doctorid|copilot(?:hist|convo)|draft|visit|note|record|recsegment|recguard|recbackup|transcript|audio|athena|sched|monthpull|intake|legal[_-]?visit|outcome|writeback|asstwb|(?:^|[_-])wb|pull(?:flow|target)|portal.*token|cache|history|studygroup|statuscenter|mlsrf|reviewreq|progress)/i;
  var AUDIO_DATABASES = Object.freeze(['mls_rec_backup', 'mls_recguard']);

  function storageKeys(store) {
    var keys = [];
    if (!store) return keys;
    try { for (var i = 0; i < store.length; i++) { var key = store.key(i); if (key != null) keys.push(String(key)); } } catch (_) {}
    return keys;
  }
  function accountPrefix(email) { return email ? 'sf_u::' + String(email) + '::' : ''; }
  function shouldRemoveLocalKey(key, email) {
    key = String(key || '');
    var prefix = accountPrefix(email);
    if (prefix && key.indexOf(prefix) === 0) return true;
    if (key.indexOf('sf_u::') === 0) return false;
    if (EXACT[key]) return true;
    /* Old feature modules used global MLS/SF keys before uns() existed. */
    return /^(?:mls|sf)/i.test(key) && GLOBAL_CLINICAL_FAMILY.test(key);
  }
  function deleteDatabase(name) {
    return new Promise(function (resolve) {
      if (!root.indexedDB || typeof root.indexedDB.deleteDatabase !== 'function') { resolve(false); return; }
      var settled = false;
      function done(value) { if (settled) return; settled = true; resolve(value); }
      try {
        var request = root.indexedDB.deleteDatabase(name);
        request.onsuccess = function () { done(true); };
        request.onerror = function () { done(false); };
        request.onblocked = function () { done(false); };
        setTimeout(function () { done(false); }, 1500);
      } catch (_) { done(false); }
    });
  }
  function purgeAudioDatabases() {
    var jobs = [];
    try {
      if (root.__mlsRecBackup && typeof root.__mlsRecBackup.purge === 'function') {
        jobs.push(Promise.resolve(root.__mlsRecBackup.purge()).catch(function () { return false; }));
      } else jobs.push(deleteDatabase(AUDIO_DATABASES[0]));
    } catch (_) { jobs.push(deleteDatabase(AUDIO_DATABASES[0])); }
    try {
      if (root.__mlsPullRecFix && typeof root.__mlsPullRecFix.purgeClinicalStorage === 'function') {
        jobs.push(Promise.resolve(root.__mlsPullRecFix.purgeClinicalStorage()).catch(function () { return false; }));
      } else jobs.push(deleteDatabase(AUDIO_DATABASES[1]));
    } catch (_) { jobs.push(deleteDatabase(AUDIO_DATABASES[1])); }
    return Promise.all(jobs);
  }
  function clearVolatileClinicalGlobals() {
    /* Runtime arrays can otherwise repaint the previous account before its
       first server refresh even after persistent storage is empty. */
    ['_calAppts', '_calProviders', '_copilotHistory'].forEach(function (key) {
      try { if (Array.isArray(root[key])) root[key].length = 0; else root[key] = null; } catch (_) {}
    });
    ['phoneMicCode', 'phoneMicBindingId', 'currentLegalRequestId', 'legalReqFilesText'].forEach(function (key) {
      try { if (key in root) root[key] = ''; } catch (_) {}
    });
  }
  function purgePatientStore(email) {
    /* sj-2.0 wipes (design Q2, BLOCKING): the sj-2.0 patient store keeps this
       account's roster as one IndexedDB record (db mlsPtsStoreV2 / store
       ptsBlobs, key sf_u::<email>::patients) plus two small localStorage keys
       (ptsJournalV2 / ptsGenV2). Logout must remove all three and PROVE the
       removal: __mlsPtsStore.wipe() deletes ONLY the current account's record
       and answers with a read-back-verified receipt - verifiedEmpty===true is
       the ONLY green. Own-prefix-only by design: other accounts' records and
       foreign namespaces stay untouched, exactly like the localStorage rules
       above (this module never deletes the shared database).
       Fail-closed: a missing store, an unresolved (::undefined::/::_::)
       namespace, a namespace that does not match the email being purged, or
       an unproven wipe all resolve {verifiedEmpty:false} and ESCALATE - the
       caller may not treat this sign-out as clean (no proof, no green). */
    var prefix = accountPrefix(email);
    var rec = { site: 'clinical-state-purge', at: Date.now(), attempted: false, verifiedEmpty: false, escalated: false, error: '' };
    function settle() {
      if (rec.verifiedEmpty !== true) {
        rec.escalated = true;
        /* LOUD wherever it matters: any real page (document present) and any
           context where a wipe actually ran and failed. Bare vm harnesses
           without a document stay quiet - the receipt still refuses green. */
        if (rec.attempted || root.document != null) {
          try { if (root.console && root.console.error) root.console.error('[clinical-state-purge] PATIENT-STORE WIPE UNPROVEN - IndexedDB patient bytes may remain on this device', rec); } catch (_) {}
          try { if (typeof root.toast === 'function') root.toast('Sign-out could not PROVE patient data was removed from this device. Tell MLS support before anyone else uses this computer.', 'err'); } catch (_) {}
        }
      }
      try { root.__mlsPtsWipeLast = rec; } catch (_) {}
      return rec;
    }
    if (!email) { rec.error = 'no-account-email'; return Promise.resolve(settle()); }
    if (prefix.indexOf('::undefined::') >= 0 || prefix.indexOf('::_::') >= 0) { rec.error = 'unresolved-account-namespace'; return Promise.resolve(settle()); }
    if (!root.__mlsPtsStore || typeof root.__mlsPtsStore.wipe !== 'function') { rec.error = 'pts-store-missing'; return Promise.resolve(settle()); }
    if (typeof root.uns === 'function') {
      /* the store wipes uns()'s CURRENT namespace; purge() is told an email.
         If they disagree the wipe would hit the wrong account - refuse and
         escalate instead of accepting a green for the wrong namespace. */
      var liveKey = null;
      try { liveKey = root.uns('patients'); } catch (_) {}
      if (liveKey !== prefix + 'patients') { rec.error = 'namespace-mismatch: the live session namespace is not the account being purged'; return Promise.resolve(settle()); }
    }
    rec.attempted = true;
    var wiped;
    try { wiped = Promise.resolve(root.__mlsPtsStore.wipe()); }
    catch (e) { rec.error = 'wipe-call: ' + String((e && e.message) || e).slice(0, 160); return Promise.resolve(settle()); }
    return wiped.then(function (w) {
      rec.store = (w && typeof w === 'object') ? w : null;
      var ok = !!(w && w.verifiedEmpty === true);
      if (ok) {
        /* INDEPENDENT read-back keyed on the EMAIL prefix, not on uns():
           the logout flow tears the session down right after purge() is
           called, so a verify routed through uns() could re-resolve to the
           ::_:: namespace and pass vacuously. These three reads cannot. */
        var left = [];
        ['patients', 'ptsJournalV2', 'ptsGenV2'].forEach(function (s) {
          try { if (root.localStorage.getItem(prefix + s) !== null) left.push(s); }
          catch (_) { left.push(s + '?'); }
        });
        if (left.length) { ok = false; rec.error = 'localStorage-keys-remain: ' + left.join(','); }
      } else if (!rec.error) rec.error = (w && w.error) ? String(w.error).slice(0, 160) : 'store-wipe-unverified';
      rec.verifiedEmpty = ok;
      return settle();
    }, function (e) {
      rec.error = 'wipe-rejected: ' + String((e && e.message) || e).slice(0, 160);
      return settle();
    });
  }
  function purge(email) {
    var removedLocal = [];
    var local = root.localStorage;
    storageKeys(local).forEach(function (key) {
      if (!shouldRemoveLocalKey(key, email)) return;
      try { local.removeItem(key); removedLocal.push(key); } catch (_) {}
    });
    /* sessionStorage belongs only to this tab/app session. Clearing the whole
       store covers drafts, provider/appointment snapshots, active jobs,
       one-time tokens, and future transient caches without a fragile list. */
    try { if (root.sessionStorage) root.sessionStorage.clear(); } catch (_) {}
    clearVolatileClinicalGlobals();
    var databases = purgeAudioDatabases();
    var ptsStore = purgePatientStore(email); /* sj-2.0 Q2: resolves the wipe receipt; never rejects */
    return { removedLocal: removedLocal, sessionCleared: true, databases: databases, ptsStore: ptsStore };
  }

  root.__mlsClinicalStatePurge = Object.freeze({
    purge: purge,
    _test: Object.freeze({
      accountPrefix: accountPrefix,
      shouldRemoveLocalKey: shouldRemoveLocalKey,
      exactGlobalKeys: EXACT_GLOBAL_KEYS,
      audioDatabases: AUDIO_DATABASES
    })
  });
})(window);

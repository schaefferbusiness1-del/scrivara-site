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
    return { removedLocal: removedLocal, sessionCleared: true, databases: databases };
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

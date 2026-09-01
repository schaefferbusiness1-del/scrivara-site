/* MLS Scribe /p1 durable Month + Year range jobs.
 *
 * This module is intentionally isolated from the regular site. It coordinates
 * the already-guarded /p1 schedule importer; it never reads Athena, writes a
 * chart, or stores an importer receipt itself. The durable record is PHI-free:
 * provider IDs/stable keys, pull choices, dates, bounded state/reason codes,
 * and timestamps only.
 */
;(function () {
  'use strict';

  var preview = window.__MLS_MAIN;
  if (!(preview && preview.enabled === true &&
      (preview.route === '/ScribeFlow.html' || preview.route === '/') && preview.build)) return;

  var VERSION = 'p1-rangejobs-1.1.0';
  var MANIFEST_VERSION = 1;
  var MANIFEST_SUFFIX = 'p1RangeJobV1';
  var MANIFEST_SCOPE_PROBE_SUFFIX = 'p1RangeScopeProbeV1';
  var MAX_IDENTITY = 160;
  var active = null;
  var bootTimer = null;
  var bootAttempts = 0;
  var listeners = [];
  var installedApi = null;
  var uiObserver = null;
  var uiTimer = null;
  var uiAdmissionTimer = null;
  var uiStyle = null;
  var uiAction = '';
  var uiActionSequence = 0;
  var uiNotice = '';
  var uiFullNotesChoice = false;
  var uiFullNotesInitialized = false;
  var uiYearChoice = '';

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function isFn(value) { return typeof value === 'function'; }
  function now() { return Date.now(); }
  function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function copy(value) { return safe(function () { return JSON.parse(JSON.stringify(value)); }, null); }
  function cleanText(value, max) {
    value = String(value == null ? '' : value).trim();
    if (!value || value.length > (max || MAX_IDENTITY) || /[\x00-\x1f\x7f]/.test(value)) return '';
    return value;
  }
  function finiteStamp(value) {
    value = Number(value || 0);
    return isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }
  function pad2(value) { return value < 10 ? '0' + value : String(value); }
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

  /* ===== p1-range-continue-1.0.0 (one bad day must not block the year) =====
     Lead ruling 2026-08-17: a year may NOT stop at the first partial month. It
     runs every month, then comes back for the retryable days, BOUNDED: after
     DAY_ATTEMPT_CAP genuine attempts a day becomes 'needs-attention' - it
     keeps its own specific reason, stops being retried automatically, is
     listed on the receipt, and never blocks a later month. RANGE_MAX_PASSES is
     a hard stop so no manifest shape can spin the chain. */
  var DAY_ATTEMPT_CAP = 3;
  var RANGE_MAX_PASSES = 3;
  var JOB_STATUS = {
    pending: 1, running: 1, paused: 1, 'waiting-login': 1,
    'waiting-retry': 1, cancelled: 1, complete: 1, 'needs-attention': 1,
    'account-changed': 1, 'storage-failed': 1
  };
  var MONTH_STATUS = { pending: 1, running: 1, retry: 1, complete: 1, 'needs-attention': 1 };
  var DAY_STATUS = { pending: 1, retry: 1, complete: 1, 'needs-attention': 1 };
  var REASONS = {
    '': 1, complete: 1, pending: 1, paused: 1, cancelled: 1,
    'account-changed': 1, 'job-exists': 1, 'job-busy': 1,
    'invalid-range': 1, 'invalid-provider': 1, 'provider-unverified': 1,
    'provider-required': 1, 'provider-roster-incomplete': 1,
    'provider-roster-unbound': 1, 'provider-not-on-calendar': 1, signin: 1, 'signin-expired': 1,
    'session-expired': 1, 'athena-session-expired': 1, 'no-athena-tab': 1,
    'no-ext': 1, 'pull-in-flight': 1, 'no-read': 1, 'nav-failed': 1,
    'wrong-day': 1, 'schedule-incomplete': 1, 'schedule-request-unbound': 1,
    'unverified-day': 1, 'storage-full': 1,
    'storage-full-writes-failing': 1, 'metadata-persist-failed': 1,
    'month-owner-unverified': 1, 'month-stopped-systemic': 1,
    'month-partial': 1, 'stopped-by-user': 1,
    'not-attempted-after-systemic-failure': 1, 'not-attempted': 1,
    exception: 1, 'no-result': 1, 'pull-failed': 1,
    'choice-cancelled': 1, 'choice-dialog-unavailable': 1, 'choice-dialog-failed': 1,
    'choice-write-failed': 1, 'choice-readback-failed': 1, 'choice-check-failed': 1,
    'account-namespace-not-settled': 1,
    'range-lock-unavailable': 1, 'range-lock-denied': 1,
    'manifest-invalid': 1, 'importer-not-ready': 1,
    /* ===== p1-range-reasons-1.0.0 (the day's own verdict, not a generic) =====
       MEASURED 2026-08-17 against the REAL importer: a day that failed its
       history batch reported `history-partial` and a day whose Athena grid
       never settled reported `schedule-incomplete`; every reason outside this
       table collapsed to `pull-failed`, so the durable receipt could not tell
       the doctor which of the two happened. These are the exact verdicts
       feat_mls_schedimport_exact.js can put on a day or a month. */
    'history-partial': 1, 'calendar-partial': 1, 'identity-bootstrap-partial': 1,
    'provider-unverified': 1, 'history-store-empty': 1, 'history-store-unmeasured': 1,
    'empty-day': 1, 'provider-empty': 1, 'complete-schedule-only': 1,
    'complete-appointment-census-only': 1, 'complete-appointment-census-with-history': 1,
    'complete-appointment-census-history-partial': 1,
    'invalid-month': 1, 'month-exception': 1, 'schedule-parse-timeout': 1,
    'account-scope-unverified': 1, unclassified: 1, 'needs-attention': 1
    /* ===== end p1-range-reasons-1.0.0 ===== */
  };
  /* A day whose Athena schedule was verified to hold no appointments. Both
     codes come from the importer's own completion branch. */
  var EMPTY_REASONS = { 'empty-day': 1, 'provider-empty': 1 };
  var LOGIN_REASONS = {
    signin: 1, 'signin-expired': 1, 'session-expired': 1,
    'athena-session-expired': 1, 'no-athena-tab': 1
  };
  /* p1-range-signout-1.0.0: read failures that are AMBIGUOUS on their own -
     they mean "no readable schedule" whether athenaOne signed out or the grid
     simply never painted. The importer's bounded session probe (sx-1.1,
     forwarded as checkpoint.sessionExpired) is what settles it; with no probe
     the reason stands as it is and today's behaviour is unchanged. */
  var SIGNOUT_CANDIDATE_REASONS = {
    'no-read': 1, 'nav-failed': 1, 'no-athena-tab': 1,
    'unverified-day': 1, 'schedule-incomplete': 1, exception: 1
  };
  /* ===== p1-range-storage-pause-1.0.0 (a full disk is not a per-day problem)
     The importer re-runs its quota preflight on EVERY day (the lr-1.0 gate in
     pull()), and refuses before any Athena navigation when the durable store
     has stopped absorbing writes. Those reasons were already counted as
     non-attempts, so no retry budget was burned - but nothing PAUSED the job.
     A year is 250+ days; with a full store the run walked the whole remaining
     ledger, refusing each day in turn and finishing with a wall of retryable
     days and no statement of the one thing wrong.

     A storage refusal is exactly like a sign-out: a condition outside this
     job that no amount of retrying inside it can fix, and that the doctor can
     actually clear. So it takes the same shape - stop the importer, park the
     manifest in the storage-failed control state that controlStatus() and
     applyControl() already understand, and name the reason. Resume then picks
     up at the first unverified day, because the ledger is the resume target
     (pendingDates), not a cursor that a pause could invalidate. */
  var STORAGE_REASONS = {
    'storage-full': 1, 'storage-full-writes-failing': 1, 'metadata-persist-failed': 1
  };
  function isStorageReason(value) { return STORAGE_REASONS[reasonCode(value)] === 1; }
  /* ===== end p1-range-storage-pause-1.0.0 ===== */
  /* A day that was never DRIVEN did not spend an attempt. Counting these
     would let one athenaOne outage burn every day's retry budget. */
  var NON_ATTEMPT_REASONS = {
    'not-attempted': 1, 'not-attempted-after-systemic-failure': 1,
    'stopped-by-user': 1, 'month-owner-unverified': 1, paused: 1, cancelled: 1,
    'metadata-persist-failed': 1, 'storage-full': 1, 'storage-full-writes-failing': 1
  };

  function reasonCode(value) {
    value = String(value || '').trim().toLowerCase();
    return REASONS[value] === 1 ? value : 'pull-failed';
  }
  function isLoginReason(value) { return LOGIN_REASONS[reasonCode(value)] === 1; }
  function storageFailureReason(error) {
    var name = String(error && error.name || '');
    var code = Number(error && error.code || 0);
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014
      ? 'storage-full' : 'metadata-persist-failed';
  }

  function currentManifestKey() {
    if (!isFn(window.uns)) return '';
    var key = safe(function () { return String(window.uns(MANIFEST_SUFFIX) || ''); }, '');
    var probe = safe(function () { return String(window.uns(MANIFEST_SCOPE_PROBE_SUFFIX) || ''); }, '');
    /* The app's logged-out namespace is sf_u::_::. A range job must never be
       created there because it would be shared by every signed-out visitor. */
    if (!key || !probe || key.length > 600 || probe.length > 600 ||
        key === MANIFEST_SUFFIX || probe === MANIFEST_SCOPE_PROBE_SUFFIX ||
        key.slice(-MANIFEST_SUFFIX.length) !== MANIFEST_SUFFIX ||
        probe.slice(-MANIFEST_SCOPE_PROBE_SUFFIX.length) !== MANIFEST_SCOPE_PROBE_SUFFIX) return '';
    var prefix = key.slice(0, -MANIFEST_SUFFIX.length);
    var probePrefix = probe.slice(0, -MANIFEST_SCOPE_PROBE_SUFFIX.length);
    if (!prefix || prefix !== probePrefix || /(?:^|::)_::$/.test(prefix)) return '';
    var accountKnown = Object.prototype.hasOwnProperty.call(window, '__mlsSessionAccount');
    var account = String(safe(function () { return window.__mlsSessionAccount; }, '') || '').trim().toLowerCase();
    if (accountKnown && (!account || prefix.toLowerCase().indexOf('::' + account + '::') < 0)) return '';
    return key;
  }
  function sessionReady() {
    if (!currentManifestKey()) return false;
    var account = safe(function () { return String(window.__mlsSessionAccount || '').trim(); }, '');
    var email = safe(function () { return String(window.session && window.session.email || '').trim(); }, '');
    var token = safe(function () {
      return String((isFn(window.bkToken) && window.bkToken()) ||
        localStorage.getItem('sf_bk_token') || sessionStorage.getItem('sf_bk_token') || '');
    }, '');
    return !!(account || email || token);
  }
  function accountTimezone() {
    var zone = safe(function () {
      var key = isFn(window.uns) ? window.uns('acctTz') : '';
      return key ? String(localStorage.getItem(key) || '') : '';
    }, '');
    return cleanText(zone, 80) || 'America/New_York';
  }
  function zoneDayKey(zone) {
    var date = new Date(now());
    var parts = safe(function () {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date);
    }, null);
    if (parts) {
      var values = {};
      for (var i = 0; i < parts.length; i++) if (parts[i] && parts[i].type) values[parts[i].type] = parts[i].value;
      if (values.year && values.month && values.day) return values.year + '-' + values.month + '-' + values.day;
    }
    /* Invalid timezone or missing Intl must not move the boundary via UTC.
       Fail closed rather than queue an unproven future/past day. */
    return '';
  }
  function todayKey() { return zoneDayKey(accountTimezone()); }
  /* ===== p1-range-daybound-1.0.0 (queue no day the importer will refuse) =====
     MEASURED 2026-08-17 (tests/1p-rangejobs-harness-runtime.test.js, real
     importer): the importer's monthDateKeys() bounds a month with its OWN
     EASTERN day (estTodayKey, EST_TZ), while this module bounded it with the
     ACCOUNT timezone. For an account zone AHEAD of Eastern (Asia/Tokyo at
     16:00Z) the two disagree by one day: the job queued 2026-03-17, the
     importer silently dropped it from `dates`, so it never appeared in
     result.days, was checkpointed 'not-attempted', and the month could NEVER
     reach complete - every Resume re-attempted the same impossible day.
     The queued range is now the EARLIER of the two days: fail closed toward a
     day both sides agree exists. */
  var IMPORTER_DAY_ZONE = 'America/New_York';
  function queueBoundDayKey() {
    var accountDay = todayKey(), importerDay = zoneDayKey(IMPORTER_DAY_ZONE);
    if (!accountDay || !importerDay) return '';
    return accountDay < importerDay ? accountDay : importerDay;
  }
  /* ===== end p1-range-daybound-1.0.0 ===== */

  /* ===== p1-range-receipt-1.0.0 (a completion receipt the doctor can read) ==
     The owner's requirement is a receipt that names days done / failed /
     skipped / empty. Every count here is DERIVED from the day records on each
     write and recomputed on every read, so a stale or hand-edited stored
     summary can never claim more than the days themselves prove. Counts and
     bounded codes only - no identity, no PHI. */
  function summarize(manifest) {
    var out = { days: 0, complete: 0, empty: 0, withRows: 0, failed: 0, pending: 0,
      needsAttention: 0, months: 0, completeMonths: 0, attention: [] };
    if (!manifest || !manifest.months) return out;
    var monthKeys = Object.keys(manifest.months);
    out.months = monthKeys.length;
    for (var mi = 0; mi < monthKeys.length; mi++) {
      var month = manifest.months[monthKeys[mi]] || {};
      if (month.status === 'complete') out.completeMonths++;
      var dayKeys = month.days ? Object.keys(month.days).sort() : [];
      for (var di = 0; di < dayKeys.length; di++) {
        var day = month.days[dayKeys[di]] || {};
        out.days++;
        if (day.status === 'complete') {
          out.complete++;
          if (EMPTY_REASONS[day.reason] === 1) out.empty++; else out.withRows++;
        } else if (day.status === 'needs-attention') {
          /* p1-range-continue-1.0.0: the receipt LISTS these - a date and a
             bounded code, nothing else - so the doctor can act on them. */
          out.needsAttention++;
          if (out.attention.length < 60) out.attention.push({ date: dayKeys[di], reason: day.reason });
        } else if (day.status === 'retry') out.failed++;
        else out.pending++;
      }
    }
    return out;
  }
  function sanitizeRun(raw) {
    raw = raw && typeof raw === 'object' ? raw : null;
    function bounded(value) { return Math.max(0, Math.min(400, Math.floor(Number(value || 0) || 0))); }
    return {
      startedAt: finiteStamp(raw && raw.startedAt),
      skippedComplete: bounded(raw && raw.skippedComplete),
      plannedDays: bounded(raw && raw.plannedDays)
    };
  }
  /* ===== end p1-range-receipt-1.0.0 ===== */
  function writeManifestAt(key, manifest) {
    if (!key || !manifest) return { ok: false, reason: 'metadata-persist-failed' };
    manifest.updatedAt = now();
    manifest.summary = summarize(manifest);
    var raw = safe(function () { return JSON.stringify(manifest); }, '');
    if (!raw) return { ok: false, reason: 'metadata-persist-failed' };
    try {
      localStorage.setItem(key, raw);
      if (localStorage.getItem(key) !== raw) return { ok: false, reason: 'metadata-persist-failed' };
      queueUiRefresh(0);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: storageFailureReason(error) };
    }
  }
  function readRawAt(key) {
    try { return { ok: true, raw: localStorage.getItem(key) }; }
    catch (error) { return { ok: false, reason: storageFailureReason(error), raw: null }; }
  }

  function sanitizeProvider(raw) {
    raw = raw && typeof raw === 'object' ? raw : null;
    if (!raw) return null;
    var mode = String(raw.mode || '');
    if (mode === 'all') return { mode: 'all' };
    if (mode !== 'selected') return null;
    var id = cleanText(raw.id), stableKey = cleanText(raw.stableKey);
    if (!id && !stableKey) return null;
    return { mode: 'selected', id: id, stableKey: stableKey };
  }
  function sanitizeManifest(raw) {
    if (!raw || typeof raw !== 'object' || Number(raw.v) !== MANIFEST_VERSION) return null;
    var kind = String(raw.kind || ''), target = String(raw.target || '');
    if ((kind !== 'year' && kind !== 'month') ||
        (kind === 'year' && !/^\d{4}$/.test(target)) ||
        (kind === 'month' && !/^\d{4}-\d{2}$/.test(target))) return null;
    var today = todayKey();
    if (!today || (kind === 'year' && target > today.slice(0, 4)) ||
        (kind === 'month' && target > today.slice(0, 7))) return null;
    var provider = sanitizeProvider(raw.provider);
    if (!provider) return null;
    var status = JOB_STATUS[String(raw.status || '')] ? String(raw.status) : 'waiting-retry';
    var monthsIn = raw.months && typeof raw.months === 'object' ? raw.months : null;
    if (!monthsIn) return null;
    var months = {}, monthKeys = Object.keys(monthsIn).sort();
    if (!monthKeys.length || monthKeys.length > 12) return null;
    for (var mi = 0; mi < monthKeys.length; mi++) {
      var monthKey = monthKeys[mi], monthRaw = monthsIn[monthKey];
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) || !monthRaw || typeof monthRaw !== 'object') return null;
      if ((kind === 'year' && monthKey.slice(0, 4) !== target) || (kind === 'month' && monthKey !== target)) return null;
      var daysIn = monthRaw.days && typeof monthRaw.days === 'object' ? monthRaw.days : null;
      if (!daysIn) return null;
      var days = {}, dayKeys = Object.keys(daysIn).sort();
      if (!dayKeys.length || dayKeys.length > 31) return null;
      for (var di = 0; di < dayKeys.length; di++) {
        var dayKey = dayKeys[di], dayRaw = daysIn[dayKey];
        if (!new RegExp('^' + monthKey.replace('-', '\\-') + '-(0[1-9]|[12]\\d|3[01])$').test(dayKey) || !dayRaw || typeof dayRaw !== 'object') return null;
        var dayNumber = Number(dayKey.slice(8, 10));
        if (dayNumber > daysInMonth(Number(dayKey.slice(0, 4)), Number(dayKey.slice(5, 7))) || dayKey > today) return null;
        var dayStatus = DAY_STATUS[String(dayRaw.status || '')] ? String(dayRaw.status) : 'retry';
        var dayAttempts = Math.max(0, Math.min(1000, Math.floor(Number(dayRaw.attempts || 0) || 0)));
        /* p1-range-continue-1.0.0: a day at the cap is settled whatever the
           stored status says - including manifests written before the cap
           existed. The cap is enforced on READ as well as on write. */
        if (dayStatus === 'retry' && dayAttempts >= DAY_ATTEMPT_CAP) dayStatus = 'needs-attention';
        days[dayKey] = {
          status: dayStatus,
          reason: reasonCode(dayRaw.reason),
          attempts: dayAttempts,
          updatedAt: finiteStamp(dayRaw.updatedAt)
        };
      }
      var sanitizedMonthStatus = MONTH_STATUS[String(monthRaw.status || '')] ? String(monthRaw.status) : 'retry';
      if (sanitizedMonthStatus === 'complete') {
        for (var completeDay in days) if (own(days, completeDay) && days[completeDay].status !== 'complete') { sanitizedMonthStatus = 'retry'; break; }
      }
      months[monthKey] = {
        status: sanitizedMonthStatus,
        reason: reasonCode(monthRaw.reason),
        updatedAt: finiteStamp(monthRaw.updatedAt),
        days: days
      };
    }
    var currentMonth = String(raw.currentMonth || '');
    if (currentMonth && !own(months, currentMonth)) currentMonth = '';
    if (status === 'complete') {
      for (var completeMonth in months) if (own(months, completeMonth) && months[completeMonth].status !== 'complete') { status = 'waiting-retry'; break; }
    }
    var clean = {
      v: MANIFEST_VERSION,
      build: cleanText(raw.build, 100) || VERSION,
      jobId: cleanText(raw.jobId, 100) || ('range-' + finiteStamp(raw.createdAt)),
      kind: kind,
      target: target,
      provider: provider,
      options: {
        includeHistory: !(raw.options && raw.options.includeHistory === false),
        fullNotes: !!(raw.options && raw.options.fullNotes === true)
      },
      status: status,
      reason: reasonCode(raw.reason),
      createdAt: finiteStamp(raw.createdAt),
      startedAt: finiteStamp(raw.startedAt),
      updatedAt: finiteStamp(raw.updatedAt),
      lastCheckpointAt: finiteStamp(raw.lastCheckpointAt),
      completedAt: finiteStamp(raw.completedAt),
      currentMonth: currentMonth,
      run: sanitizeRun(raw.run),
      months: months
    };
    /* p1-range-continue-1.0.0: a job cannot claim it is settled while a day is
       still retryable, and cannot claim retryable work that no longer exists. */
    if (clean.status === 'needs-attention' && anyRetryable(clean)) clean.status = 'waiting-retry';
    else if (clean.status === 'waiting-retry' && !anyRetryable(clean) && !allComplete(clean)) clean.status = 'needs-attention';
    /* p1-range-receipt-1.0.0: never trust a stored summary - recount. */
    clean.summary = summarize(clean);
    return clean;
  }
  function readManifestAt(key) {
    var read = readRawAt(key);
    if (!read.ok) return read;
    if (!read.raw) return { ok: true, manifest: null };
    if (String(read.raw).length > 250000) return { ok: false, reason: 'manifest-invalid' };
    var parsed = safe(function () { return JSON.parse(read.raw); }, null);
    var manifest = sanitizeManifest(parsed);
    return manifest ? { ok: true, manifest: manifest } : { ok: false, reason: 'manifest-invalid' };
  }

  function buildStamp() {
    return cleanText(safe(function () { return window.__MLS_AV; }, ''), 100) || VERSION;
  }
  function newDay(stamp) { return { status: 'pending', reason: 'pending', attempts: 0, updatedAt: stamp }; }
  function createMonths(kind, target, today, stamp) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
    var currentYear = Number(today.slice(0, 4)), currentMonth = Number(today.slice(5, 7)), currentDay = Number(today.slice(8, 10));
    var year = kind === 'year' ? Number(target) : Number(target.slice(0, 4));
    if (!isFinite(year) || year < 1900 || year > currentYear) return null;
    if (kind === 'month') {
      var requestedMonth = Number(target.slice(5, 7));
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(target) || (year === currentYear && requestedMonth > currentMonth)) return null;
    }
    var firstMonth = kind === 'year' ? 1 : Number(target.slice(5, 7));
    var lastMonth = kind === 'year' ? (year === currentYear ? currentMonth : 12) : firstMonth;
    var months = {};
    for (var month = firstMonth; month <= lastMonth; month++) {
      var monthKey = String(year) + '-' + pad2(month);
      var lastDay = (year === currentYear && month === currentMonth) ? currentDay : daysInMonth(year, month);
      var days = {};
      for (var day = 1; day <= lastDay; day++) days[monthKey + '-' + pad2(day)] = newDay(stamp);
      if (Object.keys(days).length) months[monthKey] = { status: 'pending', reason: 'pending', updatedAt: stamp, days: days };
    }
    return Object.keys(months).length ? months : null;
  }
  function normalizeStartProvider(raw) {
    var obj = raw && typeof raw === 'object' ? raw : null;
    if (raw == null || raw === '' || (obj && String(obj.mode || '') === 'all') ||
        (!obj && /^all(?:\s+(?:providers?|doctors?))?$/i.test(String(raw)))) return { ok: true, stored: { mode: 'all' } };
    var si = safe(function () { return window.__mlsSI; }, null);
    if (!si || !isFn(si._resolveProviderRequest)) return { ok: false, reason: 'importer-not-ready' };
    if (obj && (String(obj.mode || '') === 'selected' || obj.id != null || obj.stableKey != null)) {
      var requestedId = cleanText(obj.id), requestedStable = cleanText(obj.stableKey);
      var roster = safe(function () { return window.__mlsProviderRoster; }, null);
      var entry = roster && isFn(roster.resolve) ? safe(function () { return roster.resolve(requestedStable || requestedId); }, null) : null;
      var entryId = cleanText(entry && entry.id), entryStable = cleanText(entry && entry.stableKey);
      if ((!requestedId && !requestedStable) || !entry ||
          (requestedId && requestedId !== entryId) || (requestedStable && requestedStable !== entryStable)) {
        return { ok: false, reason: 'provider-unverified' };
      }
      raw = entry;
    }
    var gate = safe(function () {
      return si._resolveProviderRequest(raw, { allowAll: true, requireRosterForAll: true, allowDetectedProvider: true });
    }, null);
    if (!gate || gate.ok !== true || gate.provider === 'all') return { ok: false, reason: reasonCode(gate && gate.reason || 'invalid-provider') };
    var stored = sanitizeProvider({ mode: 'selected', id: gate.provider.id, stableKey: gate.provider.stableKey });
    return stored ? { ok: true, stored: stored } : { ok: false, reason: 'invalid-provider' };
  }
  function createManifest(kind, target, opts, provider) {
    var stamp = now(), months = createMonths(kind, target, queueBoundDayKey(), stamp);
    if (!months) return null;
    var explicitFullNotes = typeof opts.pullVisitBodies === 'boolean'
      ? opts.pullVisitBodies : (typeof opts.fullNotes === 'boolean' ? opts.fullNotes : false);
    return {
      v: MANIFEST_VERSION,
      build: buildStamp(),
      jobId: 'range-' + stamp.toString(36) + '-' + Math.random().toString(36).slice(2, 10),
      kind: kind,
      target: target,
      provider: provider,
      options: { includeHistory: opts.includeHistory !== false, fullNotes: explicitFullNotes === true },
      status: 'pending', reason: 'pending', createdAt: stamp, startedAt: 0,
      updatedAt: stamp, lastCheckpointAt: 0, completedAt: 0,
      currentMonth: '', run: sanitizeRun(null), months: months
    };
  }

  function hashKey(value) {
    var h1 = 2166136261, h2 = 2246822519, text = String(value || '');
    for (var i = 0; i < text.length; i++) {
      h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619);
      h2 = Math.imul(h2 ^ text.charCodeAt(i), 3266489917);
    }
    return (h1 >>> 0).toString(36) + '-' + (h2 >>> 0).toString(36);
  }
  function lockApi() {
    return safe(function () { return navigator && navigator.locks && isFn(navigator.locks.request) ? navigator.locks : null; }, null);
  }
  function refusal(reason, manifest) {
    reason = reasonCode(reason);
    return { ok: false, complete: false, status: manifest ? manifest.status : 'refused', reason: reason, state: manifest ? copy(manifest) : null };
  }
  function withAccountLock(key, work) {
    var locks = lockApi();
    if (!locks) return Promise.resolve(refusal('range-lock-unavailable'));
    try {
      return Promise.resolve(locks.request('mls-p1-range-' + hashKey(key), { mode: 'exclusive', ifAvailable: true }, function (lock) {
        if (!lock) return refusal('range-lock-denied');
        return Promise.resolve().then(work);
      })).catch(function () { return refusal('range-lock-denied'); });
    } catch (error) {
      return Promise.resolve(refusal('range-lock-denied'));
    }
  }

  function stopImporter() {
    safe(function () {
      var si = window.__mlsSI;
      if (si && isFn(si.stopPull)) si.stopPull();
      else window.__mlsPullStopRequested = true;
    });
  }
  function accountGuard(ctx) {
    var liveKey = currentManifestKey();
    if (liveKey === ctx.key) return true;
    if (!ctx.control) ctx.control = liveKey ? 'account-changed' : 'waiting-login';
    ctx.manifest.status = ctx.control === 'waiting-login' ? 'waiting-login' : 'account-changed';
    ctx.manifest.reason = ctx.control === 'waiting-login' ? 'signin-expired' : 'account-changed';
    writeManifestAt(ctx.key, ctx.manifest);
    stopImporter();
    return false;
  }
  function persistContext(ctx) {
    var saved = writeManifestAt(ctx.key, ctx.manifest);
    if (!saved.ok) {
      ctx.storageFailure = saved.reason;
      ctx.control = 'storage-failed';
      ctx.manifest.status = 'storage-failed';
      ctx.manifest.reason = saved.reason;
      stopImporter();
      return false;
    }
    return true;
  }
  function controlStatus(ctx) {
    if (ctx.control === 'paused') return { status: 'paused', reason: 'paused' };
    if (ctx.control === 'cancelled') return { status: 'cancelled', reason: 'cancelled' };
    if (ctx.control === 'waiting-login') return { status: 'waiting-login', reason: ctx.manifest.reason || 'signin-expired' };
    if (ctx.control === 'account-changed') return { status: 'account-changed', reason: 'account-changed' };
    if (ctx.control === 'storage-failed') return { status: 'storage-failed', reason: ctx.storageFailure || 'metadata-persist-failed' };
    return null;
  }
  function applyControl(ctx) {
    var state = controlStatus(ctx);
    if (!state) return false;
    ctx.manifest.status = state.status;
    ctx.manifest.reason = reasonCode(state.reason);
    if (state.status !== 'storage-failed') persistContext(ctx);
    return true;
  }

  function resolveStoredProvider(stored) {
    var si = safe(function () { return window.__mlsSI; }, null);
    if (!si || !isFn(si.pullMonth)) return { ok: false, reason: 'importer-not-ready' };
    if (stored.mode === 'all') {
      if (!isFn(si._resolveProviderRequest)) return { ok: false, reason: 'importer-not-ready' };
      var allGate = safe(function () {
        return si._resolveProviderRequest('all', { allowAll: true, requireRosterForAll: true, allowDetectedProvider: true });
      }, null);
      return allGate && allGate.ok === true && allGate.provider === 'all'
        ? { ok: true, provider: 'all' }
        : { ok: false, reason: reasonCode(allGate && allGate.reason || 'provider-roster-incomplete') };
    }
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    if (!roster || !isFn(roster.resolve) || !isFn(si._resolveProviderRequest)) return { ok: false, reason: 'provider-unverified' };
    var entry = safe(function () { return roster.resolve(stored.stableKey || stored.id); }, null);
    if (!entry) return { ok: false, reason: 'provider-unverified' };
    var entryId = cleanText(entry.id), entryStable = cleanText(entry.stableKey);
    if ((stored.id && stored.id !== entryId) || (stored.stableKey && stored.stableKey !== entryStable)) return { ok: false, reason: 'provider-unverified' };
    var gate = safe(function () {
      return si._resolveProviderRequest(entry, { allowAll: false, allowDetectedProvider: true });
    }, null);
    if (!gate || gate.ok !== true || !gate.provider || gate.provider === 'all') return { ok: false, reason: reasonCode(gate && gate.reason || 'provider-unverified') };
    var gateId = cleanText(gate.provider.id), gateStable = cleanText(gate.provider.stableKey);
    if ((stored.id && stored.id !== gateId) || (stored.stableKey && stored.stableKey !== gateStable)) return { ok: false, reason: 'provider-unverified' };
    return { ok: true, provider: {
      id: gateId, stableKey: gateStable, raw: String(gate.provider.raw || gate.provider.name || ''),
      name: String(gate.provider.name || ''), rosterVerified: gate.provider.rosterVerified === true,
      detectedOnly: gate.provider.detectedOnly === true
    } };
  }

  /* p1-range-continue-1.0.0: a day is RETRYABLE while it is unproved and has
     spent fewer than DAY_ATTEMPT_CAP genuine attempts. Past the cap it is
     'needs-attention': settled, listed, never retried automatically again. */
  function dayRetryable(day) {
    return !!day && day.status !== 'complete' && day.status !== 'needs-attention' &&
      Number(day.attempts || 0) < DAY_ATTEMPT_CAP;
  }
  function pendingDates(month) {
    return Object.keys(month.days).sort().filter(function (day) { return dayRetryable(month.days[day]); });
  }
  function monthComplete(month) {
    var days = Object.keys(month.days);
    for (var i = 0; i < days.length; i++) if (month.days[days[i]].status !== 'complete') return false;
    return !!days.length;
  }
  function monthRetryable(month) {
    var days = Object.keys(month.days);
    for (var i = 0; i < days.length; i++) if (dayRetryable(month.days[days[i]])) return true;
    return false;
  }
  function allComplete(manifest) {
    var months = Object.keys(manifest.months);
    for (var i = 0; i < months.length; i++) if (manifest.months[months[i]].status !== 'complete') return false;
    return !!months.length;
  }
  function anyRetryable(manifest) {
    var months = Object.keys(manifest.months);
    for (var i = 0; i < months.length; i++) if (monthRetryable(manifest.months[months[i]])) return true;
    return false;
  }
  /* An explicit human Resume on a settled needs-attention job is a NEW intent:
     re-arm exactly those days for one more bounded round. The automatic boot
     resume never reaches here - it only resumes running/pending/waiting-login. */
  function rearmAttention(manifest) {
    var months = Object.keys(manifest.months), rearmed = 0;
    for (var mi = 0; mi < months.length; mi++) {
      var month = manifest.months[months[mi]], days = Object.keys(month.days);
      for (var di = 0; di < days.length; di++) {
        var day = month.days[days[di]];
        if (day.status !== 'needs-attention') continue;
        day.status = 'retry'; day.attempts = 0; day.updatedAt = now(); rearmed++;
      }
      if (month.status === 'needs-attention') { month.status = 'retry'; month.updatedAt = now(); }
    }
    return rearmed;
  }
  function checkpointDay(ctx, monthKey, payload, seen) {
    if (!payload || typeof payload !== 'object') return false;
    /* A result that settles after an MLS account switch is not allowed to
       promote the old account's day. The frozen manifest remains retryable;
       accountGuard records the boundary and stops the importer first. */
    if (!accountGuard(ctx)) return false;
    var date = String(payload.date || '').slice(0, 10), month = ctx.manifest.months[monthKey];
    if (!month || !own(month.days, date)) return false;
    var day = month.days[date], first = !seen[date];
    seen[date] = 1;
    var complete = payload.ok === true && payload.complete === true;
    /* p1-range-reasons-1.0.0: keep the importer's OWN verdict on both arms. A
       complete day says HOW it completed (`empty-day`/`provider-empty` is the
       difference between "Athena verified no appointments" and "16 charts
       landed"), and a failed day keeps its specific cause instead of a
       generic one. */
    var code = reasonCode(payload.reason || (complete ? 'complete' : 'pull-failed'));
    if (payload.loginExpired === true || payload.athenaSignedOutSuspected === true) code = 'no-athena-tab';
    /* ===== p1-range-signout-1.0.0 (a sign-out is a sign-in problem) =====
       Lead ruling 2026-08-17. `no-read`/`nav-failed` are ambiguous alone; the
       importer's bounded session probe rides the checkpoint as ONE boolean
       (p1-month-signout-1.0.0). With the probe positive this is a sign-out and
       the job must wait for a sign-in, not burn retries. With no probe the
       reason is untouched and behaviour is exactly what it was. */
    if (payload.sessionExpired === true && SIGNOUT_CANDIDATE_REASONS[code] === 1) code = 'athena-session-expired';
    /* ===== end p1-range-signout-1.0.0 ===== */
    /* p1-range-continue-1.0.0: only a day Athena was actually DRIVEN through
       spends an attempt, and only such a day can reach the cap. */
    var attemptable = !complete && NON_ATTEMPT_REASONS[code] !== 1 && !isLoginReason(code);
    if (first && attemptable) day.attempts = Math.min(1000, Number(day.attempts || 0) + 1);
    day.status = complete ? 'complete'
      : (attemptable && Number(day.attempts || 0) >= DAY_ATTEMPT_CAP ? 'needs-attention' : 'retry');
    day.reason = code;
    day.updatedAt = now();
    month.updatedAt = day.updatedAt;
    ctx.manifest.lastCheckpointAt = day.updatedAt;
    if (isLoginReason(code)) {
      ctx.control = 'waiting-login';
      ctx.manifest.status = 'waiting-login';
      ctx.manifest.reason = code;
      stopImporter();
    }
    /* p1-range-storage-pause-1.0.0: the importer refused this day because the
       durable store is not absorbing writes. Every remaining day would refuse
       identically, so stop here and say so once. The day itself stays
       retryable and spent no attempt (NON_ATTEMPT_REASONS), so Resume after
       freeing space continues from exactly this day. */
    else if (isStorageReason(code)) {
      ctx.storageFailure = code;
      ctx.control = 'storage-failed';
      ctx.manifest.status = 'storage-failed';
      ctx.manifest.reason = code;
      stopImporter();
    }
    var persisted = persistContext(ctx);
    /* pause/cancel/account boundaries may arrive while the importer's async
       month-owner admission is settling. Reassert the stop after the one
       already-in-flight day closes; no following day may begin. */
    if (ctx.control) stopImporter();
    return persisted;
  }
  function processMonthResult(ctx, monthKey, dates, result, seen) {
    var rows = result && Array.isArray(result.days) ? result.days : [];
    for (var i = 0; i < rows.length && !ctx.storageFailure; i++) {
      var row = rows[i] || {}, receipt = row.receipt || {};
      checkpointDay(ctx, monthKey, {
        date: row.date,
        ok: row.ok === true,
        complete: row.complete === true,
        reason: row.reason || receipt.reason,
        loginExpired: receipt.loginExpired === true,
        athenaSignedOutSuspected: receipt.athenaSignedOutSuspected === true,
        /* p1-range-signout-1.0.0: the same bounded probe the per-day callback
           carries, read off the full day receipt on the settling path. */
        sessionExpired: row.sessionExpired === true || receipt.schedSessionLikelyExpired === true ||
          receipt.navSessionLikelyExpired === true || receipt.athenaSignedOutSuspected === true ||
          !!(receipt.historyReceipt && receipt.historyReceipt.sessionExpired === true)
      }, seen);
    }
    /* A day callback settles before the month owner's final release proof. If
       that proof fails, the importer adds the affected date to retry.dates.
       Reconcile that final receipt so an apparently green last callback can
       never promote an unverified month to complete. */
    var finalRetry = result && result.retry && Array.isArray(result.retry.dates) ? result.retry.dates : [];
    for (var ri = 0; ri < finalRetry.length && !ctx.storageFailure; ri++) {
      var retryDate = String(finalRetry[ri] || '').slice(0, 10);
      if (dates.indexOf(retryDate) < 0) continue;
      /* p1-range-reasons-1.0.0: the importer puts EVERY failed day in
         retry.dates, so re-checkpointing all of them overwrote each day's
         specific cause with the month-level one (MEASURED: a history failure
         and a schedule-incomplete day both ended up reading `month-partial`).
         Only a day the per-day walk left GREEN - or never reported at all -
         needs this final receipt. */
      var retryMonth = ctx.manifest.months[monthKey];
      var retryDay = retryMonth && own(retryMonth.days, retryDate) ? retryMonth.days[retryDate] : null;
      if (seen[retryDate] && retryDay && retryDay.status !== 'complete') continue;
      checkpointDay(ctx, monthKey, {
        date: retryDate, ok: false, complete: false,
        reason: result.reason || 'month-partial'
      }, seen);
    }
    for (var di = 0; di < dates.length && !ctx.storageFailure; di++) {
      if (!seen[dates[di]]) checkpointDay(ctx, monthKey, {
        date: dates[di], ok: false, complete: false,
        reason: result && result.stoppedByUser ? 'stopped-by-user' : 'not-attempted'
      }, seen);
    }
    if (!ctx.storageFailure && result && result.complete !== true && monthComplete(ctx.manifest.months[monthKey])) {
      checkpointDay(ctx, monthKey, {
        date: dates[dates.length - 1], ok: false, complete: false,
        reason: result.reason || 'month-partial'
      }, seen);
    }
    if (!ctx.control && result && isLoginReason(result.reason)) {
      ctx.control = 'waiting-login';
      ctx.manifest.status = 'waiting-login';
      ctx.manifest.reason = reasonCode(result.reason);
      stopImporter();
    }
  }

  function outcome(ctx) {
    var manifest = ctx.manifest, complete = manifest.status === 'complete';
    var sameAccount = currentManifestKey() === ctx.key;
    return { ok: complete, complete: complete, status: manifest.status, reason: reasonCode(manifest.reason), state: sameAccount ? copy(manifest) : null };
  }
  function executeLocked(key, manifest, onStatus) {
    if (active) return Promise.resolve(refusal('job-busy', manifest));
    var ctx = { key: key, manifest: manifest, control: '', storageFailure: '', onStatus: isFn(onStatus) ? onStatus : function () {} };
    active = ctx;
    manifest.status = 'running'; manifest.reason = '';
    if (!manifest.startedAt) manifest.startedAt = now();
    /* p1-range-receipt-1.0.0: the days this run will NOT re-pull because a
       previous run already verified them. Recorded before the first Athena
       navigation so the receipt can say "skipped" honestly. */
    var beforeRun = summarize(manifest);
    manifest.run = sanitizeRun({
      startedAt: now(),
      skippedComplete: beforeRun.complete,
      plannedDays: beforeRun.days - beforeRun.complete
    });
    if (!persistContext(ctx)) { active = null; return Promise.resolve(outcome(ctx)); }
    var liveProvider = resolveStoredProvider(manifest.provider);
    if (!liveProvider.ok) {
      manifest.status = 'waiting-retry'; manifest.reason = reasonCode(liveProvider.reason);
      persistContext(ctx); active = null; return Promise.resolve(outcome(ctx));
    }
    var monthKeys = Object.keys(manifest.months).sort();

    /* ===== p1-range-continue-1.0.0 (a pass over the whole range) =====
       Lead ruling 2026-08-17: October failing must not stop November, and it
       must never restart January either. A pass walks every month, skipping
       ones already complete or with nothing left to retry; the range then
       comes BACK for the retryable days in a later pass, bounded by
       RANGE_MAX_PASSES and by the per-day attempt cap. */
    function settlePass(pass) {
      if (allComplete(manifest)) {
        manifest.status = 'complete'; manifest.reason = 'complete';
        manifest.completedAt = now(); manifest.currentMonth = '';
        persistContext(ctx);
        return Promise.resolve(outcome(ctx));
      }
      if (anyRetryable(manifest) && pass + 1 < RANGE_MAX_PASSES) return runMonthAt(0, pass + 1);
      manifest.currentMonth = '';
      if (anyRetryable(manifest)) { manifest.status = 'waiting-retry'; manifest.reason = 'month-partial'; }
      else { manifest.status = 'needs-attention'; manifest.reason = 'needs-attention'; }
      persistContext(ctx);
      return Promise.resolve(outcome(ctx));
    }
    function runMonthAt(index, pass) {
      pass = Number(pass || 0);
      if (!accountGuard(ctx) || applyControl(ctx)) return Promise.resolve(outcome(ctx));
      while (index < monthKeys.length) {
        var candidate = manifest.months[monthKeys[index]];
        if (candidate.status === 'complete') { index++; continue; }
        /* a month whose days are all proved still owes the final owner receipt */
        if (monthComplete(candidate) || monthRetryable(candidate)) break;
        if (candidate.status !== 'needs-attention') { candidate.status = 'needs-attention'; candidate.updatedAt = now(); }
        index++;
      }
      if (index >= monthKeys.length) return settlePass(pass);
      var monthKey = monthKeys[index], month = manifest.months[monthKey], dates = pendingDates(month);
      if (!dates.length) {
        /* All day callbacks may be durable while the browser closes before
           pullMonth returns its final owner-release proof. A non-complete
           month is therefore never promoted from day states alone. Re-run the
           final day idempotently so the importer can produce that proof. */
        var monthDays = Object.keys(month.days).sort(), proofDate = monthDays[monthDays.length - 1];
        month.days[proofDate].status = 'retry';
        month.days[proofDate].reason = 'month-owner-unverified';
        month.days[proofDate].updatedAt = now();
        dates = [proofDate];
      }
      manifest.currentMonth = monthKey;
      manifest.status = 'running'; manifest.reason = '';
      month.status = 'running'; month.reason = '';
      if (!persistContext(ctx)) return Promise.resolve(outcome(ctx));
      var seen = {};
      var si = safe(function () { return window.__mlsSI; }, null);
      if (!si || !isFn(si.pullMonth)) {
        manifest.status = 'waiting-retry'; manifest.reason = 'importer-not-ready';
        month.status = 'retry'; month.reason = 'importer-not-ready';
        persistContext(ctx); return Promise.resolve(outcome(ctx));
      }
      var pullOptions = {
        month: monthKey,
        dates: dates.slice(),
        provider: liveProvider.provider,
        /* fvn-1.1.0 (Codex reply 38): a persisted legacy manifest could carry
           includeHistory:false from a pre-dayfacts build and resume a range
           pull without the mandatory floor. Execution is normalized to the
           canonical floor - only fullNotes chooses day-facts versus full.
           The manifest keeps recording what was originally requested. */
        includeHistory: true,
        pullVisitBodies: manifest.options.fullNotes === true,
        onStatus: function (message, kind) { safe(function () { ctx.onStatus(String(message || ''), kind); }); },
        shouldStop: function () { return !!ctx.control || currentManifestKey() !== ctx.key; },
        onDayCheckpoint: function (receipt) {
          if (!accountGuard(ctx)) return false;
          return checkpointDay(ctx, monthKey, receipt, seen);
        }
      };
      var request = safe(function () { return si.pullMonth(pullOptions); }, null);
      if (!request || !isFn(request.then)) request = Promise.resolve({ ok: false, complete: false, reason: 'no-result', days: [] });
      return Promise.resolve(request).then(function (result) {
        processMonthResult(ctx, monthKey, dates, result || {}, seen);
        if (ctx.storageFailure) return outcome(ctx);
        month.updatedAt = now();
        if (monthComplete(month)) {
          month.status = 'complete'; month.reason = 'complete';
          ctx.systemicReason = ''; ctx.systemicStreak = 0;
        } else {
          month.status = monthRetryable(month) ? 'retry' : 'needs-attention';
          month.reason = reasonCode((result && result.reason) || 'month-partial');
          /* p1-range-reasons-1.0.0: the importer stops a month after three
             identical consecutive day failures and names the ONE real cause on
             result.systemicReason. "month-stopped-systemic" tells the doctor
             the shape; the systemic code tells them what to fix. Keep the
             month's structural verdict, but let the job say the cause. */
          var systemic = (month.reason === 'month-stopped-systemic' && result && result.systemicReason)
            ? reasonCode(result.systemicReason) : '';
          if (systemic && systemic !== 'pull-failed') {
            if (!ctx.control) manifest.reason = systemic;
            /* p1-range-continue-1.0.0: continuing past a PARTIAL month is the
               ruling; continuing past a second month that died the SAME
               systemic way would just machine-gun Athena. Two in a row stops
               the range and names the one cause. */
            ctx.systemicStreak = ctx.systemicReason === systemic ? Number(ctx.systemicStreak || 0) + 1 : 1;
            ctx.systemicReason = systemic;
          } else { ctx.systemicReason = ''; ctx.systemicStreak = 0; }
        }
        if (ctx.control) { persistContext(ctx); applyControl(ctx); return outcome(ctx); }
        if (Number(ctx.systemicStreak || 0) >= 2) {
          manifest.status = 'waiting-retry'; manifest.reason = reasonCode(ctx.systemicReason);
          manifest.currentMonth = '';
          persistContext(ctx);
          return outcome(ctx);
        }
        if (!persistContext(ctx)) return outcome(ctx);
        return runMonthAt(index + 1, pass);
      }, function () {
        for (var i = 0; i < dates.length && !ctx.storageFailure; i++) {
          if (!seen[dates[i]]) checkpointDay(ctx, monthKey, { date: dates[i], ok: false, complete: false, reason: 'exception' }, seen);
        }
        month.status = monthRetryable(month) ? 'retry' : 'needs-attention';
        month.reason = 'exception'; month.updatedAt = now();
        if (!ctx.control) { manifest.status = 'waiting-retry'; manifest.reason = 'exception'; persistContext(ctx); }
        else applyControl(ctx);
        return outcome(ctx);
      });
    }

    ctx.systemicReason = ''; ctx.systemicStreak = 0;
    return runMonthAt(0, 0).then(function (result) {
      var resumeAfterSettle = ctx.resumeAfterSettle === true;
      if (active === ctx) active = null;
      if (resumeAfterSettle) scheduleBoot(true);
      return result;
    }, function () {
      manifest.status = 'waiting-retry'; manifest.reason = 'exception';
      persistContext(ctx);
      var resumeAfterSettle = ctx.resumeAfterSettle === true;
      if (active === ctx) active = null;
      if (resumeAfterSettle) scheduleBoot(true);
      return outcome(ctx);
    });
  }

  function existingBlocksStart(manifest) {
    /* p1-range-continue-1.0.0: 'needs-attention' is SETTLED - it must not hold
       the doctor hostage. An explicit new pull is admitted; Resume is still
       offered beside it for one more bounded round on those exact days. */
    return !!(manifest && manifest.status !== 'complete' && manifest.status !== 'cancelled' &&
      manifest.status !== 'needs-attention');
  }
  function parseStartArgs(value, opts, kind) {
    if (value && typeof value === 'object') { opts = value; value = kind === 'year' ? opts.year : opts.month; }
    opts = opts && typeof opts === 'object' ? opts : {};
    value = String(value == null ? '' : value).trim();
    return { target: value, opts: opts };
  }
  /* fnc-1.0.0: direct API callers must not let createManifest manufacture an
     implicit OFF value before the shared importer can ask the first-use
     question. Resolve once here, then persist the same explicit boolean in
     both compatibility fields for every month/day after reload or resume. */
  function rangeVisitNotesChoiceRefusal(opts, reason) {
    reason = String(reason || 'choice-check-failed');
    var message = reason === 'choice-cancelled'
      ? 'Range pull not started — choose how full visit notes should be handled, then try again.'
      : (reason === 'account-namespace-not-settled'
        ? 'Range pull not started — your account settings are still loading. Try again in a moment.'
        : 'Range pull not started — MLS could not confirm your full-visit-notes choice. Nothing was read from Athena.');
    safe(function () { if (opts && isFn(opts.onStatus)) opts.onStatus(message, reason === 'choice-cancelled' ? '' : 'err'); });
    return { ok: false, complete: false, status: 'refused', reason: reason,
      gate: 'visit-notes-choice', error: message, retry: {} };
  }
  function admitRangeVisitNotesChoice(kind, target, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var explicit = typeof opts.pullVisitBodies === 'boolean'
      ? opts.pullVisitBodies : (typeof opts.fullNotes === 'boolean' ? opts.fullNotes : null);
    if (typeof explicit === 'boolean') {
      if (opts.pullVisitBodies === explicit && opts.fullNotes === explicit) return null;
      var normalized = {};
      for (var nk in opts) if (Object.prototype.hasOwnProperty.call(opts, nk)) normalized[nk] = opts[nk];
      normalized.pullVisitBodies = explicit;
      normalized.fullNotes = explicit;
      return Promise.resolve(start(kind, target, normalized));
    }
    var pref = safe(function () { return window.__mlsVisitNotesPref; }, null);
    if (!(pref && isFn(pref.ensureChosenForBulkPull))) {
      return Promise.resolve(rangeVisitNotesChoiceRefusal(opts, 'choice-dialog-unavailable'));
    }
    var request = null;
    try { request = pref.ensureChosenForBulkPull(); }
    catch (eRangeChoice) { return Promise.resolve(rangeVisitNotesChoiceRefusal(opts, 'choice-check-failed')); }
    return Promise.resolve(request).then(function (choice) {
      if (!(choice && choice.ok === true && typeof choice.on === 'boolean')) {
        return rangeVisitNotesChoiceRefusal(opts, choice && choice.reason);
      }
      var frozen = {};
      for (var key in opts) if (Object.prototype.hasOwnProperty.call(opts, key)) frozen[key] = opts[key];
      frozen.pullVisitBodies = choice.on === true;
      frozen.fullNotes = choice.on === true;
      return start(kind, target, frozen);
    }, function () { return rangeVisitNotesChoiceRefusal(opts, 'choice-check-failed'); });
  }
  function start(kind, value, opts) {
    var parsed = parseStartArgs(value, opts, kind), key = currentManifestKey();
    if (!key || !sessionReady()) return Promise.resolve(refusal('signin'));
    var visitNotesAdmission = admitRangeVisitNotesChoice(kind, parsed.target, parsed.opts);
    if (visitNotesAdmission) return visitNotesAdmission;
    if (!lockApi()) return Promise.resolve(refusal('range-lock-unavailable'));
    var provider = normalizeStartProvider(parsed.opts.provider == null ? 'all' : parsed.opts.provider);
    if (!provider.ok) return Promise.resolve(refusal(provider.reason));
    var manifest = createManifest(kind, parsed.target, parsed.opts, provider.stored);
    if (!manifest) return Promise.resolve(refusal('invalid-range'));
    return withAccountLock(key, function () {
      if (active) return refusal('job-busy');
      var existing = readManifestAt(key);
      if (!existing.ok) return refusal(existing.reason);
      if (existingBlocksStart(existing.manifest)) return refusal('job-exists', existing.manifest);
      var saved = writeManifestAt(key, manifest);
      if (!saved.ok) { manifest.status = 'storage-failed'; manifest.reason = saved.reason; return refusal(saved.reason, manifest); }
      return executeLocked(key, manifest, parsed.opts.onStatus);
    });
  }
  function resume(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var key = currentManifestKey();
    if (!key || !sessionReady()) return Promise.resolve(refusal('signin'));
    if (!lockApi()) return Promise.resolve(refusal('range-lock-unavailable'));
    if (active) return Promise.resolve(refusal('job-busy', active.manifest));
    return withAccountLock(key, function () {
      var read = readManifestAt(key), manifest = read.manifest;
      if (!read.ok) return refusal(read.reason);
      if (!manifest) return refusal('manifest-invalid');
      if (manifest.status === 'complete') return { ok: true, complete: true, status: 'complete', reason: 'complete', state: copy(manifest) };
      if (manifest.status === 'cancelled') return refusal('cancelled', manifest);
      /* p1-range-continue-1.0.0: a human pressing Resume on a settled job is a
         new intent - re-arm exactly the days that hit the attempt cap. */
      if (manifest.status === 'needs-attention') rearmAttention(manifest);
      manifest.status = 'running'; manifest.reason = '';
      return executeLocked(key, manifest, opts.onStatus);
    });
  }
  function setControl(kind) {
    var key = active ? active.key : currentManifestKey();
    if (!key) return Promise.resolve(refusal('signin'));
    if (active && active.key === key) {
      active.control = kind;
      active.manifest.status = kind;
      active.manifest.reason = kind;
      var saved = persistContext(active);
      stopImporter();
      return Promise.resolve(saved ? outcome(active) : outcome(active));
    }
    if (!lockApi()) return Promise.resolve(refusal('range-lock-unavailable'));
    return withAccountLock(key, function () {
      var read = readManifestAt(key), manifest = read.manifest;
      if (!read.ok) return refusal(read.reason);
      if (!manifest) return refusal('manifest-invalid');
      if (manifest.status === 'complete') return { ok: true, complete: true, status: 'complete', reason: 'complete', state: copy(manifest) };
      manifest.status = kind; manifest.reason = kind;
      var saved = writeManifestAt(key, manifest);
      /* The Web Lock proves no range job is active in this account. Do not
         stop an unrelated one-day pull merely because a stale range manifest
         was paused/cancelled after reload. Active range jobs take the branch
         above and always call stopPull. */
      return saved.ok ? refusal(kind, manifest) : refusal(saved.reason, manifest);
    });
  }
  function state() {
    var key = currentManifestKey();
    if (active && key && key === active.key) return copy(active.manifest);
    if (!key) return null;
    var read = readManifestAt(key);
    return read.ok ? copy(read.manifest) : null;
  }
  function maybeResume(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (active || !sessionReady() || !safe(function () { return window.__mlsSI && isFn(window.__mlsSI.pullMonth); }, false)) return Promise.resolve(refusal('importer-not-ready'));
    var manifest = state();
    if (!manifest) return Promise.resolve(refusal('manifest-invalid'));
    var eligible = manifest.status === 'running' || manifest.status === 'pending';
    if (opts.allowWaitingLogin === true && manifest.status === 'waiting-login') eligible = true;
    if (!eligible) return Promise.resolve(refusal(manifest.reason || manifest.status, manifest));
    var providerReady = resolveStoredProvider(manifest.provider);
    if (!providerReady.ok) return Promise.resolve(refusal(providerReady.reason, manifest));
    return resume(opts);
  }

  /* ---------------------------------------------------------------------
   * Doctor-facing Year pull controls. This is deliberately a small child of
   * the canonical Staff Prep month-pull card. The Staff Prep owner may rebuild
   * that card at any time, so this module observes and remounts its own one
   * section instead of copying or wrapping the workspace.
   * ------------------------------------------------------------------ */
  function uiDocumentReady() {
    return !!(document && isFn(document.getElementById) && isFn(document.createElement));
  }
  function uiCurrentYear() {
    var today = todayKey();
    return /^\d{4}-\d{2}-\d{2}$/.test(today) ? today.slice(0, 4) : '';
  }
  function uiManifestYear(manifest) {
    var value = manifest && manifest.kind === 'year' ? String(manifest.target || '') : '';
    return /^\d{4}$/.test(value) && Number(value) <= Number(uiCurrentYear() || 0) ? value : '';
  }
  function uiYearOptions(manifest) {
    var current = Number(uiCurrentYear() || 0), years = [];
    if (!current) return years;
    /* Ten visible choices keep the control small and deliberate. A verified
       saved target remains visible even if it is older than this new-job
       window, so an active/reloaded manifest is never mislabeled. */
    for (var offset = 0; offset < 10; offset++) years.push(String(current - offset));
    var saved = uiManifestYear(manifest);
    if (saved && years.indexOf(saved) < 0) years.push(saved);
    years.sort(function (left, right) { return Number(right) - Number(left); });
    return years;
  }
  function uiSelectedYear(manifest, blocksStart) {
    var current = uiCurrentYear(), saved = uiManifestYear(manifest), choices = uiYearOptions(manifest);
    if (blocksStart && saved) uiYearChoice = saved;
    else if (!uiYearChoice) uiYearChoice = saved || current;
    if (choices.indexOf(uiYearChoice) < 0) uiYearChoice = current;
    return uiYearChoice;
  }
  function uiFillYearSelect(select, manifest, blocksStart) {
    if (!select) return '';
    var choices = uiYearOptions(manifest), chosen = uiSelectedYear(manifest, blocksStart), signature = choices.join('|');
    if (select.getAttribute('data-year-options') !== signature) {
      select.innerHTML = choices.map(function (year) { return '<option value="' + year + '">' + year + '</option>'; }).join('');
      select.setAttribute('data-year-options', signature);
    }
    if (select.value !== chosen) select.value = chosen;
    select.disabled = !!blocksStart || !!uiAction;
    return chosen;
  }
  function uiCanonicalCard() {
    if (!uiDocumentReady()) return null;
    var start = document.getElementById('ez3PullStart'), node = start;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.classList && node.classList.contains('ez3-card') && node.classList.contains('ez3-pull')) return node;
      node = node.parentNode;
    }
    return null;
  }
  function uiYearHost(card) {
    if (!card) return null;
    /* clunky-staff groups this same controller under its existing "Other ways
       to pull" fold. That fold is an accepted presentation host only while it
       belongs to the current canonical pull card; accepting it preserves the
       exact node, selection and four wired actions instead of delete/recreate
       churn between the two owners. */
    var folded = document.getElementById('mlsClunkyPullMoreBody');
    if (folded && isFn(card.contains) && card.contains(folded)) return folded;
    return card;
  }
  function uiProviderSelection() {
    if (!uiDocumentReady()) return { ok: false, reason: 'provider-required', label: 'Provider unavailable' };
    var select = document.getElementById('ez3Prov');
    if (!select) return { ok: false, reason: 'provider-required', label: 'Choose a provider above' };
    var value = String(select.value || ''), option = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    var label = cleanText(option && option.textContent, 120) || (value === '__all' ? 'Your athenaOne view (default)' : 'Selected provider');
    if (value === '__all') return { ok: true, provider: 'all', label: label };
    if (!value) return { ok: false, reason: 'provider-required', label: 'Choose a provider above' };
    var roster = safe(function () { return window.__mlsProviderRoster; }, null), entry = null;
    if (roster && isFn(roster.resolve)) {
      entry = safe(function () { return roster.resolve(value); }, null);
      if (!entry && value.slice(0, 3) === 'pv:') {
        var decoded = safe(function () { return decodeURIComponent(value.slice(3)); }, '');
        if (decoded) entry = safe(function () { return roster.resolve(decoded); }, null);
      }
    }
    var id = cleanText(entry && entry.id), stableKey = cleanText(entry && entry.stableKey);
    if (!entry || (!id && !stableKey)) return { ok: false, reason: 'provider-unverified', label: label };
    return { ok: true, provider: { mode: 'selected', id: id, stableKey: stableKey }, label: label };
  }
  function uiManifestProviderLabel(manifest, selected, frozen) {
    if (!manifest || !manifest.provider || !frozen) return selected.label;
    if (manifest.provider.mode === 'all') {
      return selected && selected.ok && selected.provider === 'all' ? selected.label : 'Saved athenaOne provider scope';
    }
    var roster = safe(function () { return window.__mlsProviderRoster; }, null), entry = null;
    if (roster && isFn(roster.resolve)) entry = safe(function () {
      return roster.resolve(manifest.provider.stableKey || manifest.provider.id);
    }, null);
    return cleanText(entry && entry.name, 120) || 'Saved verified provider';
  }
  function uiProgress(manifest) {
    var out = { totalDays: 0, completeDays: 0, retryDays: 0, totalMonths: 0, completeMonths: 0 };
    if (!manifest || !manifest.months) return out;
    var months = Object.keys(manifest.months).sort(); out.totalMonths = months.length;
    for (var mi = 0; mi < months.length; mi++) {
      var month = manifest.months[months[mi]] || {}, days = month.days ? Object.keys(month.days) : [];
      if (month.status === 'complete') out.completeMonths++;
      for (var di = 0; di < days.length; di++) {
        var day = month.days[days[di]] || {}; out.totalDays++;
        if (day.status === 'complete') out.completeDays++;
        else if (day.status === 'retry') out.retryDays++;
      }
    }
    return out;
  }
  var UI_REASON_COPY = {
    'provider-required': 'Choose a provider in Staff Prep first.',
    'invalid-provider': 'The selected provider could not be verified. Refresh Athena providers and choose again.',
    'provider-unverified': 'The selected provider could not be verified. Refresh Athena providers and choose again.',
    'provider-roster-incomplete': 'The Athena provider list is incomplete. Refresh providers before continuing.',
    'provider-roster-unbound': 'The Athena provider list is not bound to this signed-in account. Sign in again, then retry.',
    'invalid-range': 'Choose one of the available years before starting.',
    'choice-cancelled': 'Pull not started — choose how full visit notes should be handled, then try again.',
    'choice-dialog-unavailable': 'Pull not started — the full-visit-notes choice is not ready on this build. Refresh MLS and try again.',
    'choice-dialog-failed': 'Pull not started — the full-visit-notes choice could not open. Refresh MLS and try again.',
    'choice-write-failed': 'Pull not started — MLS could not save your full-visit-notes choice. Nothing was read from Athena.',
    'choice-readback-failed': 'Pull not started — MLS could not verify the saved full-visit-notes choice. Nothing was read from Athena.',
    'choice-check-failed': 'Pull not started — MLS could not confirm your full-visit-notes choice. Nothing was read from Athena.',
    'account-namespace-not-settled': 'Pull not started — your account settings are still loading. Try again in a moment.',
    signin: 'Sign in to MLS and athenaOne before continuing.',
    'signin-expired': 'Athena sign-in expired. Sign in again, then Resume.',
    'session-expired': 'The MLS session expired. Sign in again, then Resume.',
    'athena-session-expired': 'athenaOne signed you out — sign in again and press Resume.',
    'needs-attention': 'Everything else finished. The days listed below could not be verified after three tries — check Athena for those days, then Resume to try them again.',
    'no-athena-tab': 'Open signed-in athenaOne, then Resume.',
    'no-read': 'Athena is not returning a readable schedule. Check that the athenaOne tab is signed in and on the Day schedule, then Resume.',
    'nav-failed': 'Athena cannot be moved between days. Check the athenaOne tab is signed in and responsive, then Resume.',
    'schedule-request-unbound': 'Athena’s replies are not binding to these requests. Reload the athenaOne tab and this tab, then Resume.',
    'not-attempted-after-systemic-failure': 'MLS stopped rather than repeat the same failure. Fix the cause above, then Resume.',
    'not-attempted': 'Those days were not attempted. Resume runs only the remaining days.',
    'stopped-by-user': 'You stopped this pull. Resume continues from the saved checkpoint.',
    'no-ext': 'MLS Assist is unavailable. Restore the extension connection, then Resume.',
    'pull-in-flight': 'Another schedule pull is active. Let it finish before continuing.',
    'range-lock-unavailable': 'This browser cannot safely coordinate a year pull. Nothing was started.',
    'range-lock-denied': 'Another MLS tab owns this range pull. Use that tab or try again after it finishes.',
    'storage-full': 'Progress could not be saved because browser storage is full. Nothing further was started.',
    'storage-full-writes-failing': 'Progress storage is still failing. Free space, then Resume.',
    'metadata-persist-failed': 'Progress could not be verified after saving. Nothing further was started.',
    'manifest-invalid': 'Saved range progress could not be verified. Start a new pull only after checking this account.',
    'importer-not-ready': 'The Athena schedule reader is not ready. Reopen Staff Prep and try again.',
    'wrong-day': 'Athena did not verify the expected schedule day. Check Athena, then Resume.',
    'unverified-day': 'Athena could not verify the expected schedule day. Check Athena, then Resume.',
    'schedule-incomplete': 'Athena returned an incomplete schedule. Check the calendar, then Resume.',
    'month-owner-unverified': 'MLS could not verify the month checkpoint owner. Resume retries only the unverified work.',
    'month-stopped-systemic': 'The month stopped before all days were verified. Resume retries the remaining work.',
    'month-partial': 'Some days still need verification. Resume retries only those days.',
    /* p1-range-reasons-1.0.0: the importer's own day verdicts, said plainly. */
    'history-partial': 'Some charts on that day did not finish reading. Resume retries only those days.',
    'calendar-partial': 'That day’s appointments were not all saved. Resume retries only those days.',
    'identity-bootstrap-partial': 'Some patients on that day could not be identified exactly. Check Athena, then Resume.',
    'history-store-empty': 'Charts were read but nothing was stored for that day. Check available storage, then Resume.',
    'history-store-unmeasured': 'MLS could not verify what was stored for that day. Resume re-reads it.',
    'schedule-parse-timeout': 'Reading that day’s schedule took too long. Check the Athena tab, then Resume.',
    'invalid-month': 'That month is not available to pull. Choose the current or a past month.',
    'month-exception': 'The month stopped safely after an unexpected error. Resume retries the remaining days.',
    'account-scope-unverified': 'MLS could not prove which signed-in account owns this pull. Sign in again, then Resume.',
    exception: 'The pull stopped safely after an unexpected error. Check Athena, then Resume.',
    'pull-failed': 'The pull stopped safely before the next unverified step. Check Athena, then Resume.',
    'job-exists': 'A saved range pull already exists. Resume, pause, or cancel it before starting another.',
    'job-busy': 'This range pull is already running.'
  };
  function uiReasonCopy(reason) {
    return UI_REASON_COPY[reasonCode(reason)] || 'The pull stopped safely before the next unverified step. Check Athena, then Resume.';
  }
  /* p1-range-receipt-1.0.0: the one sentence that answers "what did it do?" -
     days done, how many of those Athena verified empty, how many failed, and
     how many this run skipped because a previous run had already proved them. */
  function uiReceiptCopy(manifest) {
    var receipt = (manifest && manifest.summary) || summarize(manifest);
    var run = (manifest && manifest.run) || sanitizeRun(null);
    return receipt.complete + ' of ' + receipt.days + ' days done · ' +
      receipt.withRows + ' with appointments · ' + receipt.empty + ' verified empty · ' +
      receipt.failed + ' still to retry · ' + receipt.needsAttention + ' need attention · ' +
      run.skippedComplete + ' skipped as already verified.';
  }
  /* p1-range-continue-1.0.0: the days that hit the attempt cap, named. Dates
     and bounded codes only. */
  function uiAttentionCopy(manifest) {
    var receipt = (manifest && manifest.summary) || summarize(manifest);
    var list = receipt.attention || [];
    if (!list.length) return '';
    var shown = list.slice(0, 6).map(function (row) { return row.date + ' (' + String(row.reason || '').replace(/-/g, ' ') + ')'; });
    return 'Needs attention: ' + shown.join('; ') + (list.length > shown.length ? '; …' : '') +
      (receipt.needsAttention > list.length ? ' (' + receipt.needsAttention + ' total)' : '') + '.';
  }
  function uiStatusCopy(manifest, progress, selected) {
    if (!manifest) {
      if (uiNotice) return uiNotice;
      if (!selected.ok) return uiReasonCopy(selected.reason);
      return 'Ready. Nothing starts until you press Start year pull.';
    }
    var count = progress.completeDays + ' of ' + progress.totalDays + ' days complete';
    var scope = manifest.kind === 'year' ? manifest.target : ('month ' + manifest.target);
    if (manifest.status === 'complete') return 'Complete: ' + scope + ' · ' + uiReceiptCopy(manifest);
    if (manifest.status === 'needs-attention') {
      return 'Finished with exceptions: ' + scope + ' · ' + uiReceiptCopy(manifest) + ' ' +
        uiAttentionCopy(manifest) + ' ' + uiReasonCopy('needs-attention');
    }
    if (manifest.status === 'cancelled') return 'Cancelled: ' + scope + ' · ' + count + '. Starting again requires a new click.';
    if (manifest.status === 'paused') return 'Paused: ' + scope + ' · ' + count + '. Resume continues from the saved checkpoint.';
    if (manifest.status === 'waiting-login') return count + '. ' + uiReasonCopy(manifest.reason || 'signin-expired');
    if (manifest.status === 'waiting-retry' || manifest.status === 'storage-failed' || manifest.status === 'account-changed') {
      return count + '. ' + uiReasonCopy(manifest.reason || manifest.status);
    }
    if (manifest.status === 'pending') return 'Queued: ' + scope + ' · ' + count + '.';
    var month = /^\d{4}-\d{2}$/.test(String(manifest.currentMonth || '')) ? ' · working on ' + manifest.currentMonth : '';
    return 'Running: ' + scope + month + ' · ' + count + (progress.retryDays ? ' · ' + progress.retryDays + ' to retry' : '') + '.';
  }
  function uiSetText(node, value) {
    value = String(value == null ? '' : value);
    if (node && node.textContent !== value) node.textContent = value;
  }
  function uiSetHidden(node, value) { if (node && node.hidden !== !!value) node.hidden = !!value; }
  function ensureUiStyle() {
    if (!uiDocumentReady()) return null;
    var existing = document.getElementById('mlsP1RangeJobsCss');
    if (existing) { uiStyle = existing; return existing; }
    var style = document.createElement('style'); style.id = 'mlsP1RangeJobsCss';
    style.textContent =
      '#mlsP1YearPull{min-width:0;margin-top:12px;padding-top:12px;border-top:1px solid rgba(32,64,52,.16);display:grid;gap:8px}' +
      '#mlsP1YearPull .p1yr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}' +
      '#mlsP1YearPull .p1yr-title{font:700 14px/1.3 system-ui,sans-serif;color:inherit}' +
      '#mlsP1YearPull .p1yr-provider{font:600 12px/1.35 system-ui,sans-serif;color:var(--muted,#52645d);max-width:100%;overflow-wrap:anywhere}' +
      '#mlsP1YearPull .p1yr-note{margin:0;font:400 12.5px/1.45 system-ui,sans-serif;color:var(--muted,#52645d)}' +
      '#mlsP1YearPull .p1yr-picker{display:flex;align-items:center;gap:8px;min-height:44px;font:600 12.5px/1.35 system-ui,sans-serif}' +
      '#mlsP1YearPull .p1yr-picker select{min-height:44px;max-width:140px}' +
      '#mlsP1YearPull .p1yr-choice{display:inline-flex;align-items:center;gap:8px;min-height:44px;width:max-content;max-width:100%;font:600 12.5px/1.35 system-ui,sans-serif;cursor:pointer}' +
      '#mlsP1YearPull .p1yr-choice input{width:18px;height:18px;flex:0 0 auto}' +
      '#mlsP1YearPull .p1yr-progress{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px}' +
      '#mlsP1YearPull progress{width:100%;height:9px;accent-color:#2e6a4b}' +
      '#mlsP1YearPull .p1yr-count{font:600 11.5px/1.3 system-ui,sans-serif;color:var(--muted,#52645d);white-space:nowrap}' +
      '#mlsP1YearPull .p1yr-status{margin:0;min-height:18px;font:600 12.5px/1.45 system-ui,sans-serif;color:inherit}' +
      '#mlsP1YearPull[data-error="true"] .p1yr-status{color:#8a342e}' +
      '#mlsP1YearPull .p1yr-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0}' +
      '#mlsP1YearPull .p1yr-actions button{min-height:44px;max-width:100%}' +
      '#mlsP1YearPull [hidden]{display:none!important}' +
      '@media(max-width:640px){#mlsP1YearPull .p1yr-progress{grid-template-columns:1fr}#mlsP1YearPull .p1yr-count{white-space:normal}' +
      '#mlsP1YearPull .p1yr-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}' +
      '#mlsP1YearPull .p1yr-actions button{width:100%;min-width:0}#mlsP1YearPull #mlsP1YearStart{grid-column:1/-1}}';
    (document.head || document.documentElement).appendChild(style); uiStyle = style; return style;
  }
  function removeUiNodes() {
    if (!uiDocumentReady() || !isFn(document.querySelectorAll)) return;
    var nodes = document.querySelectorAll('#mlsP1YearPull');
    for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
  }
  function clearUiAdmissionTimer() {
    if (uiAdmissionTimer != null) { safe(function () { clearTimeout(uiAdmissionTimer); }); uiAdmissionTimer = null; }
  }
  function releaseUiActionAfterAdmission(sequence, kind, attempt) {
    if (sequence !== uiActionSequence || uiAction !== kind || !installedApi || installedApi.installed !== true) return;
    var manifest = state(), admitted = manifest && (manifest.status === 'running' || manifest.status === 'pending');
    /* A first-use choice is an admission step, not a one-second timeout. If
       the clinician takes longer than the old 40x25ms polling window, keep
       Start latched until the shared resolver settles. Releasing here would
       let a second click attach a second startYear() continuation to the same
       dialog Promise, creating two start attempts from one answer. */
    var waitingForChoice = false;
    try {
      var pref = window.__mlsVisitNotesPref;
      waitingForChoice = kind === 'start' && pref && isFn(pref.choicePending) && pref.choicePending() === true;
    } catch (eChoice) { waitingForChoice = false; }
    if (waitingForChoice) {
      clearUiAdmissionTimer();
      uiAdmissionTimer = setTimeout(function () { uiAdmissionTimer = null; releaseUiActionAfterAdmission(sequence, kind, attempt); }, 100);
      return;
    }
    if (admitted || (kind !== 'start' && kind !== 'resume') || attempt >= 40) {
      clearUiAdmissionTimer(); uiAction = ''; queueUiRefresh(0); return;
    }
    clearUiAdmissionTimer();
    uiAdmissionTimer = setTimeout(function () { uiAdmissionTimer = null; releaseUiActionAfterAdmission(sequence, kind, attempt + 1); }, 25);
  }
  function uiActionResult(sequence, kind, result) {
    if (sequence !== uiActionSequence) return;
    clearUiAdmissionTimer(); uiAction = '';
    if (result && result.ok === false && (kind === 'start' || kind === 'resume' || !result.state || result.status === 'refused')) uiNotice = uiReasonCopy(result.reason);
    else if (result && result.status !== 'storage-failed') uiNotice = '';
    queueUiRefresh(0);
  }
  function runUiAction(kind, invoke) {
    if (uiAction) return false;
    var sequence = ++uiActionSequence; uiAction = kind; uiNotice = ''; queueUiRefresh(0);
    var request;
    try { request = invoke(); }
    catch (error) { uiActionResult(sequence, kind, { ok: false, status: 'refused', reason: 'exception' }); return false; }
    Promise.resolve(request).then(function (result) { uiActionResult(sequence, kind, result || { ok: false, status: 'refused', reason: 'no-result' }); },
      function () { uiActionResult(sequence, kind, { ok: false, status: 'refused', reason: 'exception' }); });
    releaseUiActionAfterAdmission(sequence, kind, 0);
    return true;
  }
  function wireYearUi(root) {
    var full = root.querySelector('#mlsP1YearFullNotes');
    if (full) full.onchange = function () {
      var wanted = full.checked === true, pref = safe(function () { return window.__mlsVisitNotesPref; }, null);
      if (!pref || !isFn(pref.write) || pref.write(wanted) !== true) {
        var current = pref && isFn(pref.read) ? safe(function () { return pref.read(); }, null) : null;
        full.checked = !!(current && current.on === true);
        uiNotice = 'The full-visit-notes choice could not be saved. Nothing changed.';
        queueUiRefresh(0); return;
      }
      uiFullNotesChoice = wanted; uiFullNotesInitialized = true; uiNotice = ''; queueUiRefresh(0);
    };
    var yearSelect = root.querySelector('#mlsP1YearChoice');
    if (yearSelect) yearSelect.onchange = function () {
      var choices = uiYearOptions(state()), next = String(yearSelect.value || '');
      if (choices.indexOf(next) >= 0) uiYearChoice = next;
      else yearSelect.value = uiYearChoice;
      queueUiRefresh(0);
    };
    var start = root.querySelector('#mlsP1YearStart');
    if (start) start.onclick = function () {
      var selected = uiProviderSelection(), manifest = state(), choices = uiYearOptions(manifest);
      var year = String(yearSelect && yearSelect.value || uiYearChoice || '');
      if (!selected.ok || choices.indexOf(year) < 0) { uiNotice = uiReasonCopy(selected.reason || 'invalid-range'); queueUiRefresh(0); return; }
      uiYearChoice = year;
      runUiAction('start', function () {
        var pref = safe(function () { return window.__mlsVisitNotesPref; }, null);
        if (!pref || !isFn(pref.ensureChosenForBulkPull)) return Promise.resolve({ ok: false, status: 'refused', reason: 'choice-dialog-unavailable' });
        return Promise.resolve(pref.ensureChosenForBulkPull()).then(function (choice) {
          if (!choice || choice.ok !== true || typeof choice.on !== 'boolean') return { ok: false, status: 'refused', reason: String(choice && choice.reason || 'choice-check-failed') };
          uiFullNotesChoice = choice.on === true; uiFullNotesInitialized = true; if (full) full.checked = uiFullNotesChoice;
          return installedApi.startYear(year, {
            provider: selected.provider, includeHistory: true,
            fullNotes: uiFullNotesChoice, pullVisitBodies: uiFullNotesChoice,
            onStatus: function () { queueUiRefresh(0); }
          });
        }, function () { return { ok: false, status: 'refused', reason: 'choice-check-failed' }; });
      });
    };
    var pause = root.querySelector('#mlsP1YearPause');
    if (pause) pause.onclick = function () { runUiAction('pause', function () { return installedApi.pause(); }); };
    var resumeButton = root.querySelector('#mlsP1YearResume');
    if (resumeButton) resumeButton.onclick = function () {
      runUiAction('resume', function () { return installedApi.resume({ onStatus: function () { queueUiRefresh(0); } }); });
    };
    var cancelButton = root.querySelector('#mlsP1YearCancel');
    if (cancelButton) cancelButton.onclick = function () { runUiAction('cancel', function () { return installedApi.cancel(); }); };
  }
  function refreshYearUi(root) {
    if (!root || !installedApi || installedApi.installed !== true) return;
    var manifest = state(), selected = uiProviderSelection(), progress = uiProgress(manifest);
    var status = manifest && manifest.status || '', running = status === 'running' || status === 'pending';
    /* p1-range-continue-1.0.0: 'needs-attention' is terminal (a new pull is
       admitted) AND resumable (one more bounded round on those days). */
    var terminal = status === 'complete' || status === 'cancelled' || status === 'needs-attention';
    var blocksStart = !!(manifest && !terminal);
    var resumable = status === 'paused' || status === 'waiting-login' || status === 'waiting-retry' ||
      status === 'storage-failed' || status === 'needs-attention';
    var error = !!uiNotice || (!blocksStart && !selected.ok) || status === 'waiting-retry' ||
      status === 'storage-failed' || status === 'account-changed' || status === 'needs-attention';
    root.setAttribute('data-status', status || 'ready'); root.setAttribute('data-error', error ? 'true' : 'false');
    root.setAttribute('aria-busy', running ? 'true' : 'false');
    var year = uiFillYearSelect(root.querySelector('#mlsP1YearChoice'), manifest, blocksStart);
    uiSetText(root.querySelector('#mlsP1YearTitle'), 'Year pull');
    uiSetText(root.querySelector('#mlsP1YearProvider'), 'Provider: ' + uiManifestProviderLabel(manifest, selected, blocksStart));
    var full = root.querySelector('#mlsP1YearFullNotes');
    if (blocksStart && manifest && manifest.options) {
      uiFullNotesChoice = manifest.options.fullNotes === true; uiFullNotesInitialized = true;
    } else if (!uiFullNotesInitialized) {
      var pref = safe(function () { return window.__mlsVisitNotesPref; }, null);
      var current = pref && isFn(pref.read) ? safe(function () { return pref.read(); }, null) : null;
      var explicit = current && current.settled === true && (current.state === 'on' || current.state === 'off');
      uiFullNotesChoice = explicit ? current.on === true : !!(terminal && manifest && manifest.options && manifest.options.fullNotes === true);
      uiFullNotesInitialized = true;
    }
    if (full) { full.checked = uiFullNotesChoice; full.disabled = blocksStart || !!uiAction; }
    var bar = root.querySelector('#mlsP1YearProgress');
    if (bar) {
      bar.max = Math.max(1, progress.totalDays); bar.value = Math.min(progress.completeDays, bar.max);
      bar.setAttribute('aria-valuetext', progress.totalDays ? progress.completeDays + ' of ' + progress.totalDays + ' days complete' : 'No year pull started');
    }
    uiSetText(root.querySelector('#mlsP1YearCount'), progress.totalDays ? progress.completeDays + ' / ' + progress.totalDays + ' days' : 'Not started');
    var statusNode = root.querySelector('#mlsP1YearStatus');
    if (statusNode) {
      statusNode.setAttribute('role', 'status'); statusNode.setAttribute('aria-live', 'polite');
      uiSetText(statusNode, uiStatusCopy(manifest, progress, selected));
    }
    var start = root.querySelector('#mlsP1YearStart');
    uiSetHidden(start, blocksStart); if (start) { start.disabled = !!uiAction || !selected.ok || !year; uiSetText(start, (terminal ? 'Start new ' : 'Start ') + (year || '') + ' year pull'); }
    var pause = root.querySelector('#mlsP1YearPause'); uiSetHidden(pause, !running); if (pause) pause.disabled = !!uiAction;
    var resumeButton = root.querySelector('#mlsP1YearResume'); uiSetHidden(resumeButton, !resumable); if (resumeButton) resumeButton.disabled = !!uiAction;
    var cancelButton = root.querySelector('#mlsP1YearCancel'); uiSetHidden(cancelButton, !blocksStart); if (cancelButton) cancelButton.disabled = !!uiAction;
  }
  function mountYearUi() {
    if (!installedApi || installedApi.installed !== true || !uiDocumentReady()) return false;
    var card = uiCanonicalCard(), host = uiYearHost(card), existing = document.getElementById('mlsP1YearPull');
    if (!card) { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); return false; }
    if (existing && existing.parentNode !== host) { existing.parentNode.removeChild(existing); existing = null; }
    if (!existing) {
      removeUiNodes(); ensureUiStyle();
      existing = document.createElement('section'); existing.id = 'mlsP1YearPull';
      existing.setAttribute('aria-labelledby', 'mlsP1YearTitle');
      existing.innerHTML =
        '<div class="p1yr-head"><div class="p1yr-title" id="mlsP1YearTitle" role="heading" aria-level="3"></div>' +
        '<div class="p1yr-provider" id="mlsP1YearProvider"></div></div>' +
        '<p class="p1yr-note">Runs month by month, saves each verified day, and resumes from the saved checkpoint. Keep athenaOne signed in.</p>' +
        /* provscope-1.0.0, stated where the year is started. The prerequisite
           does not relax because the range got longer - it gets MORE important:
           a year read off the wrong provider's calendar would be twelve months
           of false empties instead of one day's. Same law, same refusal code,
           worded as the importer words it. */
        '<p class="p1yr-note" id="mlsP1YearScopeNote"><b>Before you start:</b> in the athenaOne tab set the calendar\'s View to the provider selected above (or an all-provider view). ' +
        'MLS reads the schedule athenaOne is showing, so a year scoped to one provider over somebody else\'s calendar is refused (provider-not-on-calendar) rather than saved as empty.</p>' +
        '<label class="p1yr-picker" for="mlsP1YearChoice"><span>Year</span><select id="mlsP1YearChoice" aria-label="Year to pull"></select></label>' +
        '<label class="p1yr-choice" for="mlsP1YearFullNotes"><input type="checkbox" id="mlsP1YearFullNotes"> Include full visit notes <span>(slower)</span></label>' +
        '<div class="p1yr-progress"><progress id="mlsP1YearProgress" max="1" value="0" aria-label="Year pull progress"></progress><span class="p1yr-count" id="mlsP1YearCount"></span></div>' +
        '<p class="p1yr-status" id="mlsP1YearStatus" aria-atomic="true"></p>' +
        '<div class="p1yr-actions"><button type="button" class="ez3-sm pri" id="mlsP1YearStart"></button>' +
        '<button type="button" class="ez3-sm" id="mlsP1YearPause">Pause</button>' +
        '<button type="button" class="ez3-sm pri" id="mlsP1YearResume">Resume</button>' +
        '<button type="button" class="ez3-sm warn" id="mlsP1YearCancel">Cancel</button></div>';
      host.appendChild(existing); wireYearUi(existing);
    }
    refreshYearUi(existing); return true;
  }
  function queueUiRefresh(delay) {
    if (!installedApi || installedApi.installed !== true || !uiDocumentReady()) return;
    if (uiTimer != null) { safe(function () { clearTimeout(uiTimer); }); uiTimer = null; }
    uiTimer = setTimeout(function () { uiTimer = null; mountYearUi(); }, Math.max(0, Number(delay || 0)));
  }
  function installYearUi() {
    if (!uiDocumentReady()) return false;
    ensureUiStyle(); queueUiRefresh(0);
    if (typeof MutationObserver === 'function') {
      uiObserver = new MutationObserver(function (records) {
        var needsRefresh = false;
        for (var ri = 0; ri < records.length && !needsRefresh; ri++) {
          var record = records[ri], target = record && record.target;
          if (target && target.closest && target.closest('#mlsP1YearPull')) continue;
          var changed = [], ai;
          for (ai = 0; record && record.addedNodes && ai < record.addedNodes.length; ai++) changed.push(record.addedNodes[ai]);
          for (ai = 0; record && record.removedNodes && ai < record.removedNodes.length; ai++) changed.push(record.removedNodes[ai]);
          if (changed.length && changed.every(function (node) { return node && node.nodeType === 1 && node.id === 'mlsP1YearPull'; })) continue;
          needsRefresh = true;
        }
        if (needsRefresh) queueUiRefresh(0);
      });
      safe(function () { uiObserver.observe(document.body || document.documentElement, { childList: true, subtree: true }); });
    }
    addListener(document, 'DOMContentLoaded', function () { queueUiRefresh(0); }, false);
    addListener(window, 'storage', function (event) {
      if (!event || !event.key || String(event.key).slice(-MANIFEST_SUFFIX.length) === MANIFEST_SUFFIX) queueUiRefresh(0);
    }, false);
    addListener(window, 'mls:ui-ready', function () { queueUiRefresh(0); }, false);
    addListener(window, 'mls:view-changed', function () { queueUiRefresh(0); }, false);
    return true;
  }
  function removeYearUi() {
    if (uiTimer != null) { safe(function () { clearTimeout(uiTimer); }); uiTimer = null; }
    clearUiAdmissionTimer();
    if (uiObserver) safe(function () { uiObserver.disconnect(); }); uiObserver = null;
    removeUiNodes();
    var style = uiStyle || (uiDocumentReady() ? document.getElementById('mlsP1RangeJobsCss') : null);
    if (style && style.parentNode) safe(function () { style.parentNode.removeChild(style); }); uiStyle = null;
    uiActionSequence++; uiAction = ''; uiNotice = ''; uiFullNotesChoice = false; uiFullNotesInitialized = false; uiYearChoice = '';
  }

  function onSessionBoundary(event) {
    var detail = event && event.detail || {}, next = String(detail.nextAccount || '').trim().toLowerCase();
    if (active) {
      var sameNamespace = currentManifestKey() === active.key;
      var previousAccount = String(detail.previousAccount || '').trim().toLowerCase();
      var identityChanged = !!(next && previousAccount && next !== previousAccount);
      active.control = next && (identityChanged || !sameNamespace) ? 'account-changed' : 'waiting-login';
      active.manifest.status = active.control;
      active.manifest.reason = active.control === 'account-changed' ? 'account-changed' : 'signin-expired';
      active.resumeAfterSettle = true;
      persistContext(active);
      stopImporter();
    }
    uiNotice = ''; uiFullNotesChoice = false; uiFullNotesInitialized = false; uiYearChoice = ''; queueUiRefresh(0);
    scheduleBoot(true);
  }
  function addListener(target, type, fn, capture) {
    safe(function () { target.addEventListener(type, fn, !!capture); listeners.push([target, type, fn, !!capture]); });
  }
  function scheduleBoot(allowWaitingLogin) {
    if (bootTimer != null) safe(function () { clearTimeout(bootTimer); });
    bootAttempts = 0;
    bootTimer = setTimeout(function tick() {
      bootTimer = null;
      if (!installedApi || installedApi.installed !== true) return;
      if (sessionReady() && safe(function () { return window.__mlsSI && isFn(window.__mlsSI.pullMonth); }, false)) {
        var manifest = state();
        if (!manifest) return;
        var eligible = manifest.status === 'running' || manifest.status === 'pending' ||
          (allowWaitingLogin === true && manifest.status === 'waiting-login');
        if (!eligible) return;
        if (resolveStoredProvider(manifest.provider).ok) {
          maybeResume({ allowWaitingLogin: allowWaitingLogin === true });
          return;
        }
      }
      if (++bootAttempts < 30) bootTimer = setTimeout(tick, 1000);
    }, 350);
  }
  function revert() {
    if (active) {
      active.control = 'paused'; active.manifest.status = 'paused'; active.manifest.reason = 'paused';
      persistContext(active); stopImporter();
    }
    if (bootTimer != null) { safe(function () { clearTimeout(bootTimer); }); bootTimer = null; }
    removeYearUi();
    for (var i = 0; i < listeners.length; i++) {
      (function (entry) { safe(function () { entry[0].removeEventListener(entry[1], entry[2], entry[3]); }); })(listeners[i]);
    }
    listeners = [];
    if (installedApi) installedApi.installed = false;
    return true;
  }

  var previous = safe(function () { return window.__mlsP1RangeJobs; }, null);
  if (previous && previous.installed === true) {
    if (previous.version === VERSION) return;
    safe(function () { if (isFn(previous.revert)) previous.revert(); });
  }
  installedApi = {
    installed: true,
    version: VERSION,
    asset: 'feat_mls_rangejobs.js',
    startYear: function (year, opts) { return start('year', year, opts); },
    startMonth: function (month, opts) { return start('month', month, opts); },
    resume: resume,
    pause: function () { return setControl('paused'); },
    cancel: function () { return setControl('cancelled'); },
    state: state,
    maybeResume: maybeResume,
    revert: revert
  };
  window.__mlsP1RangeJobs = installedApi;
  addListener(window, 'mls:session-boundary', onSessionBoundary, true);
  addListener(window, 'mls:athena-session-ready', function () { scheduleBoot(true); }, true);
  addListener(window, 'mls-provider-roster-updated', function () { scheduleBoot(false); }, true);
  addListener(window, 'online', function () { scheduleBoot(false); }, false);
  addListener(document, 'visibilitychange', function () { if (!document.hidden) scheduleBoot(false); }, false);
  installYearUi();
  scheduleBoot(false);
})();

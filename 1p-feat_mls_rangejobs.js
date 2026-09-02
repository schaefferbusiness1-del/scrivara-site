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

  var preview = window.__MLS_P1_PREVIEW;
  if (!(preview && preview.enabled === true &&
      (preview.route === '/1p/' || preview.route === '/1pScribeFlow.html') && preview.build)) return;

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
  /* yearpicker-1.0.0: the doctor's own scope choice on the YEAR card. Empty
     means "still mirroring the month card's selector". */
  var uiProvChoice = '';

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
       1p-feat_mls_schedimport_exact.js can put on a day or a month. */
    'history-partial': 1, 'calendar-partial': 1, 'identity-bootstrap-partial': 1,
    'provider-unverified': 1, 'history-store-empty': 1, 'history-store-unmeasured': 1,
    'empty-day': 1, 'provider-empty': 1, 'complete-schedule-only': 1,
    'complete-appointment-census-only': 1, 'complete-appointment-census-with-history': 1,
    'complete-appointment-census-history-partial': 1,
    'invalid-month': 1, 'month-exception': 1, 'schedule-parse-timeout': 1,
    'account-scope-unverified': 1, unclassified: 1, 'needs-attention': 1,
    /* dnote-1.0.0 (b1184): the day's charts landed but its OWN visit notes are
       still owed. A real, attemptable verdict - never a completion. */
    'day-notes-pending': 1
    /* ===== end p1-range-reasons-1.0.0 ===== */
  };
  /* A day whose Athena schedule was verified to hold no appointments. The
     first two codes come from the importer's own completion branch.
     scopeempty-1.0.0 (owner 2026-09-01) adds the third: see checkpointDay. */
  var EMPTY_REASONS = { 'empty-day': 1, 'provider-empty': 1, 'provider-not-on-calendar': 1 };
  /* ===== scopeempty-1.0.0 (a provider not on the calendar is an EMPTY DAY) ==
     MEASURED 2026-09-01: a month job scoped to one PA settled 2026-08-28 and
     2026-08-30 as 'needs-attention' with reason 'provider-not-on-calendar',
     and the owner's bar is that needs-attention must be ZERO or the receipt is
     not worth reading.

     WHAT THAT CODE ACTUALLY MEANS. The importer emits it from exactly one
     branch (provscope-1.0.0): the calendar RENDERED, other clinicians were
     discovered on it, and the scoped provider was not among them. For a
     PROVIDER-SCOPED job that is not a failure to read anything - it is the
     honest answer that this clinician has no appointments on that day. So the
     day is checkpointed COMPLETE and EMPTY (0 rows) and keeps its own reason
     code, which is what records WHY it was empty.

     WHAT STAYS ATTENTION, unchanged and deliberately: every code that means
     the calendar itself did not render or navigation failed - 'no-read',
     'nav-failed', 'wrong-day', 'unverified-day', 'schedule-incomplete',
     'schedule-parse-timeout'. Those prove nothing about the day and must never
     become a silent empty. This promotion is a CLOSED, one-code rule and it
     applies only to a job whose provider scope is 'selected': an all-provider
     job can never be honestly absent from its own calendar. */
  var SCOPED_EMPTY_REASON = 'provider-not-on-calendar';
  function providerScopedJob(manifest) {
    return !!(manifest && manifest.provider && String(manifest.provider.mode || '') === 'selected');
  }
  /* ===== end scopeempty-1.0.0 ===== */
  /* ===== attn-1.0.0 (needs-attention must mean "the owner has to act") =====
     MEASURED 2026-09-02 on the August month job scoped to one PA, after three
     Retry passes on extension 3.0.107: 25 days complete, 4 in needs-attention
     (calendar-partial, nav-failed, and TWO history-partial), and 2 days
     (2026-08-28, 2026-08-30) cycling 'retry' for ever even though
     scopeempty-1.0.0 shipped in b1195 to settle exactly those.

     (R0) THE WEDGE, measured by EXECUTING checkpointDay + processMonthResult
     on the live shape: the scoped-empty promotion WAS applied by the per-day
     callback, and then processMonthResult's final-retry reconciliation UNDID
     it. The importer counts a provider-not-on-calendar day as a failure
     (day.ok !== true), so it lands in result.retry.dates; the reconciliation
     loop skips only days the walk left NOT complete, so a day the JOB had
     deliberately completed fell through and was re-checkpointed with the
     month-level reason. It spent no attempt either way (first === false), so
     it could never reach the cap: retry -> promoted -> demoted -> retry, for
     ever. That loop exists for ONE thing - a failed month-owner RELEASE PROOF
     - so it is now gated on that proof instead of on "the month is not
     complete", which is a strictly narrower condition and the original intent.

     (R1) A day whose stored verdict is already the scoped-empty code resolves
     complete/empty on its next checkpoint WITHOUT a re-read, and the evidence
     (how many OTHER clinicians the calendar painted) is kept on the day.

     (R2) PER-CHART REFUSALS ARE NOT A DAY FAILURE. A chart refused because
     its DOB did not match the row must STAY refused - and the day must
     finish, naming the refusal. A day whose every unread chart is a closed
     refusal completes at once and can never be attention.

     (R3) 'history-partial' IS ATTENTION ONLY WHEN NO CHART COULD BE READ. A
     day that read charts and then spent its attempts is finished, with the
     charts it could not read recorded; a day that read NOTHING still settles
     needs-attention at the cap, exactly as before.

     (R4) 'calendar-partial' STAYS ATTENTION - athena showed rows this day did
     not account for, and only the owner can look. The day now records HOW
     MANY rows were missing so the card can say it and point at Resume.

     (R5) 'nav-failed' is unchanged and pinned: a driven day, one attempt each
     time, attention only at DAY_ATTEMPT_CAP. */
  var CHART_REFUSAL_CODES = {
    'dob-mismatch': 1, ambiguous: 1, 'chart-parse-failed': 1, 'chart-parse-timeout': 1
  };
  /* The month-level codes the reconciliation paths write onto a day. A day
     that already carries its OWN proven verdict is not re-opened by one of
     these; every real day verdict is deliberately absent. */
  var GENERIC_MONTH_REASONS = {
    'month-partial': 1, 'month-stopped-systemic': 1, 'month-exception': 1, 'not-attempted': 1
  };
  function boundedCount(value, max) {
    value = Math.floor(Number(value || 0) || 0);
    return value > 0 ? Math.min(max || 400, value) : 0;
  }
  /* A bounded PHI-free map of refusal code -> count. Unknown codes are dropped
     rather than stored, so the durable manifest can only ever hold names this
     build knows how to say in English. */
  function sanitizeRefusalCodes(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var out = null, keys = Object.keys(raw).sort();
    for (var i = 0; i < keys.length && i < 6; i++) {
      var code = String(keys[i] || '').toLowerCase();
      if (CHART_REFUSAL_CODES[code] !== 1) continue;
      var n = boundedCount(raw[keys[i]]);
      if (!n) continue;
      if (!out) out = {};
      out[code] = n;
    }
    return out;
  }
  /* ===== end attn-1.0.0 vocabulary ===== */
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

  /* ===== pullheal-1.0.0 instrumentation (name the failing write) ===========
     MEASURED live 2026-09-01 on a month pull: status 'storage-failed' with
     reason 'metadata-persist-failed' recurred while localStorage was healthy
     (1.7MB) and api.resume() cured it EVERY time. 'metadata-persist-failed' is
     returned from FOUR different places in writeManifestAt - an empty computed
     key, a failed serialize, a read-back that did not match, and a throw - and
     the durable manifest records only the one collapsed code, so nobody could
     tell which. The suspicion is the computed key, not the store: window.uns()
     is account-scoped and keys shaped `sf_u::undefined::` exist on this
     machine, so a scope flap between one write and the next would present as
     exactly this. These rings measure that, PHI-free: bounded stage codes, a
     key SHAPE (the suffix plus whether the account segment is real, literally
     'undefined', or the logged-out '_'), counts, and booleans. Never a key,
     never an account, never a hash of either. In memory only. */
  var PERSIST_DIAG_MAX = 20;
  var SCOPE_DIAG_MAX = 20;
  var persistDiag = [];
  var scopeWatch = { last: null, flaps: 0, ring: [] };
  function keyShape(key) {
    key = String(key == null ? '' : key);
    if (!key) return 'empty';
    var parts = /^(.*?)::(.*)::([A-Za-z0-9_]+)$/.exec(key);
    if (!parts) return 'unrecognized';
    var account = parts[2];
    var band = account === '_' ? 'logged-out'
      : (account === 'undefined' || account === 'null' ? account : (account ? 'account' : 'blank'));
    return cleanText(parts[1], 20) + '::' + band + '::' + cleanText(parts[3], 40);
  }
  function noteScope(key) {
    if (scopeWatch.last === key) return key;
    if (scopeWatch.last !== null) {
      scopeWatch.flaps++;
      scopeWatch.ring.push({ at: now(), from: keyShape(scopeWatch.last), to: keyShape(key) });
      if (scopeWatch.ring.length > SCOPE_DIAG_MAX) scopeWatch.ring.shift();
    }
    scopeWatch.last = key;
    return key;
  }
  /* Measured only on a failure - never on the hot success path. Bounded so a
     store with thousands of keys cannot turn a diagnostic into a stall. */
  function storeSizeChars() {
    return safe(function () {
      var total = 0, count = Math.min(400, Number(localStorage.length || 0));
      for (var i = 0; i < count; i++) {
        var name = localStorage.key(i);
        total += String(name || '').length + String(localStorage.getItem(name) || '').length;
      }
      return total;
    }, -1);
  }
  function persistFailure(stage, key, reason, wroteChars, readChars) {
    var live = safe(currentManifestKey, '');
    persistDiag.push({
      at: now(), stage: String(stage || ''), reason: reasonCode(reason),
      keyShape: keyShape(key), liveShape: keyShape(live),
      /* THE question nobody had an answer to: did the computed key move
         between the write and the read-back? */
      keyMoved: !!(key && live && key !== live),
      liveKeyMissing: !live,
      scopeFlaps: Number(scopeWatch.flaps || 0),
      wroteChars: Math.max(0, Number(wroteChars || 0)),
      readChars: Number(readChars == null ? -1 : readChars),
      storeChars: storeSizeChars()
    });
    if (persistDiag.length > PERSIST_DIAG_MAX) persistDiag.shift();
    return { ok: false, reason: reasonCode(reason) };
  }
  /* ===== pullheal-1.0.0 (a day's failures belong to the extension that spent
     them). MEASURED 2026-09-01: days settled 'needs-attention' at the attempt
     cap because all three attempts were spent under an extension version whose
     driver could not clear athena's CSRF interstitial. Fixing the extension
     did not drain needs-attention - the cap is durable. So each spent attempt
     records the extension version that spent it, and a day whose attempts were
     spent under a STRICTLY OLDER extension re-arms itself. A day whose
     attempts were spent under the CURRENT extension NEVER re-arms: the cap
     must still stop a live broken loop. An unknown version proves nothing, so
     it fails closed and the cap stands. */
  var MAX_EXT_VERSION = 20;
  function extVersionShape(value) {
    value = cleanText(value, MAX_EXT_VERSION);
    return /^\d{1,4}(?:\.\d{1,4}){0,3}$/.test(value) ? value : '';
  }
  function currentExtVersion() {
    return extVersionShape(safe(function () { return window.__mlsExtReportedVersion; }, ''));
  }
  function compareExtVersions(left, right) {
    left = extVersionShape(left); right = extVersionShape(right);
    if (!left || !right) return null;
    var a = left.split('.'), b = right.split('.');
    for (var i = 0; i < 4; i++) {
      var av = Number(a[i] || 0), bv = Number(b[i] || 0);
      if (av !== bv) return av > bv ? 1 : -1;
    }
    return 0;
  }
  /* ===== attnscope-1.0.0 (an APP fix must give the attempts back too) =====
     MEASURED 2026-09-02 04:5x on the owner's live August job: an app-side cure
     shipped that changes what a re-read of a settled day yields, and the four
     needs-attention days were NOT re-read - attempts 3, the same extension
     version stamped on each of them, updatedAt unchanged. pullheal-1.0.0
     scoped the attempts to the EXTENSION alone, so a cure this side of the
     seam could never earn fresh attempts and the owner would have had to wait
     for an extension reload that has nothing to do with the fix. The scope is
     now BOTH: the extension version AND the app build that spent the attempt.
     The build token is the shell's own window.__MLS_AV - an opaque short
     token, never PHI, never a name - and an absent one fails closed exactly
     the way an absent extension version does. */
  var MAX_APP_BUILD = 40;
  function appBuildShape(value) {
    value = cleanText(value, MAX_APP_BUILD);
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(value) ? value : '';
  }
  function currentAppBuild() {
    return appBuildShape(safe(function () { return window.__MLS_AV; }, ''));
  }
  /* ===== end pullheal-1.0.0 / attnscope-1.0.0 instrumentation ===== */

  function currentManifestKey() { return noteScope(computeManifestKey()); }
  function computeManifestKey() {
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
    /* attn-1.0.0: chartsRefused/refused report the charts a COMPLETE day could
       not read. They are counted apart from needsAttention on purpose - a
       refused chart is a fact about that chart, never work for the owner. */
    var out = { days: 0, complete: 0, empty: 0, withRows: 0, failed: 0, pending: 0,
      needsAttention: 0, months: 0, completeMonths: 0, attention: [],
      chartsRefused: 0, refusedDays: 0, refused: [] };
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
          /* attn-1.0.0: a finished day that could not read every chart says so
             here, with its bounded refusal codes, so the card can name it. */
          var dayUnread = Number(day.chartsUnread || 0), dayRefused = Number(day.chartsRefused || 0);
          if (dayUnread > 0 || dayRefused > 0) {
            out.chartsRefused += dayRefused; out.refusedDays++;
            if (out.refused.length < 20) {
              out.refused.push({ date: dayKeys[di], refused: dayRefused, unread: dayUnread, codes: copy(day.refused) });
            }
          }
        } else if (day.status === 'needs-attention') {
          /* p1-range-continue-1.0.0: the receipt LISTS these - a date and a
             bounded code, nothing else - so the doctor can act on them.
             attn-1.0.0 adds ONE bounded integer: how many schedule rows a
             calendar-partial day never accounted for. */
          out.needsAttention++;
          if (out.attention.length < 60) out.attention.push({ date: dayKeys[di], reason: day.reason, missing: Number(day.calendarMissing || 0) || 0 });
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
    /* pullheal-1.0.0: the four arms that all reported one code now each name
       themselves in the diag ring. Behaviour and returned codes are unchanged. */
    if (!key || !manifest) return persistFailure(key ? 'no-manifest' : 'no-key', key, 'metadata-persist-failed', 0, null);
    manifest.updatedAt = now();
    manifest.summary = summarize(manifest);
    var raw = safe(function () { return JSON.stringify(manifest); }, '');
    if (!raw) return persistFailure('serialize-failed', key, 'metadata-persist-failed', 0, null);
    try {
      localStorage.setItem(key, raw);
      var back = localStorage.getItem(key);
      if (back !== raw) {
        return persistFailure(back == null ? 'readback-absent' : 'readback-mismatch', key,
          'metadata-persist-failed', raw.length, back == null ? -1 : String(back).length);
      }
      queueUiRefresh(0);
      healKick();
      return { ok: true };
    } catch (error) {
      return persistFailure('setitem-threw', key, storageFailureReason(error), raw.length, null);
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
  /* ===== scopefrozen-1.0.0 (the job records the scope check it PASSED) =====
     OWNER 2026-09-01: a resume must actually work. MEASURED the same day: a
     settled month job refused Resume and Retry with "The full Athena provider
     roster is not verified yet ... could not read the Athena Day schedule",
     because every execute of the job re-ran the LIVE all-provider roster gate,
     and that gate can only pass while athenaOne is showing a readable full Day
     schedule at that instant. The manifest already froze WHICH provider; it
     never recorded that the scope had been verified, so there was nothing for
     a resume to stand on.

     This stamp is that record: written the first time this job's scope is
     verified live, carried in the manifest, and presented on a RESUME only.
     It is counts, a mode and a timestamp - no provider name, no roster keys,
     nothing that is not already in the manifest. A brand-new Start has no
     stamp to present, so a new Start still verifies live, always. */
  function sanitizeScope(raw) {
    raw = raw && typeof raw === 'object' ? raw : null;
    if (!raw || Number(raw.v) !== 1 || raw.verified !== true) return null;
    var mode = String(raw.mode || '');
    if (mode !== 'all' && mode !== 'selected') return null;
    var at = finiteStamp(raw.at);
    if (!at) return null;
    return {
      v: 1, mode: mode, verified: true, at: at,
      listed: Math.max(0, Math.min(4000, Math.floor(Number(raw.listed || 0) || 0))),
      scopeKind: cleanText(raw.scopeKind, 60) || 'unstated'
    };
  }
  /* The live proof, taken at the moment the gate said yes. */
  function currentScopeStamp(mode) {
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    var receipt = roster && isFn(roster.getReceipt) ? safe(function () { return roster.getReceipt(); }, null) : null;
    return sanitizeScope({
      v: 1, mode: mode === 'all' ? 'all' : 'selected', verified: true, at: now(),
      listed: receipt ? Number(receipt.listedCount || receipt.observedCount || 0) : 0,
      scopeKind: receipt ? String(receipt.rosterScope || receipt.scope || '') : ''
    });
  }
  /* An all-provider job may resume under its own recorded stamp. A selected
     job never needs to: that branch of the importer gate already resolves from
     the persisted roster entry, which is why only All was ever failing. */
  function frozenScopeForResume(manifest) {
    if (!manifest || !manifest.provider || String(manifest.provider.mode || '') !== 'all') return null;
    var scope = sanitizeScope(manifest.scope);
    return scope && scope.mode === 'all' ? scope : null;
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
        var dayReason = reasonCode(dayRaw.reason);
        /* attn-1.0.0 R1: scopeempty-1.0.0's ruling, enforced on READ as well
           as on write, exactly like the attempt cap above. A provider-scoped
           job whose stored verdict for a day is the scoped-empty code has
           already proved that day empty for that provider - a manifest
           written before this build (where the reconciliation could demote it
           again) settles with no second read of athena. */
        if (dayStatus !== 'complete' && provider.mode === 'selected' && dayReason === SCOPED_EMPTY_REASON) dayStatus = 'complete';
        var dayOut = {
          status: dayStatus,
          reason: dayReason,
          attempts: dayAttempts,
          updatedAt: finiteStamp(dayRaw.updatedAt)
        };
        /* attn-1.0.0: the PHI-free record of what the day could NOT read, and
           the evidence a scoped-empty day settles on. Written only when there
           is something to say, so every manifest written before attn-1.0.0
           keeps its exact stored shape. */
        var dayUnread = boundedCount(dayRaw.chartsUnread);
        var dayRefused = Math.min(dayUnread, boundedCount(dayRaw.chartsRefused));
        var dayRefusalCodes = sanitizeRefusalCodes(dayRaw.refused);
        var dayMissingRows = boundedCount(dayRaw.calendarMissing, 4000);
        var daySurface = boundedCount(dayRaw.surfaceProviders);
        if (dayUnread) dayOut.chartsUnread = dayUnread;
        if (dayRefused) dayOut.chartsRefused = dayRefused;
        if (dayRefusalCodes) dayOut.refused = dayRefusalCodes;
        if (dayMissingRows) dayOut.calendarMissing = dayMissingRows;
        if (dayRaw.scopedEmpty === 1 || dayRaw.scopedEmpty === true) dayOut.scopedEmpty = 1;
        if (daySurface) dayOut.surfaceProviders = daySurface;
        /* pullheal-1.0.0: the extension version that spent this day's newest
           attempt. Written only when it is a real dotted version, so every
           manifest written before pullheal keeps its exact stored shape and a
           garbage value can never mint a re-arm. */
        var dayExtV = extVersionShape(dayRaw.attemptExtV);
        if (dayExtV) dayOut.attemptExtV = dayExtV;
        /* attnscope-1.0.0: and the app build that spent that same attempt.
           Same discipline and the same closed shape, so a manifest written
           before attnscope keeps its exact stored shape and a garbage value
           can never mint a re-arm. */
        var dayAppV = appBuildShape(dayRaw.attemptAppV);
        if (dayAppV) dayOut.attemptAppV = dayAppV;
        days[dayKey] = dayOut;
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
    /* scopefrozen-1.0.0: an absent or malformed stamp is simply absent - such a
       job resumes the way it always did (live gate), it does not fail. */
    var scopeStamp = sanitizeScope(raw.scope);
    if (scopeStamp) clean.scope = scopeStamp;
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

  function resolveStoredProvider(stored, frozenScope) {
    var si = safe(function () { return window.__mlsSI; }, null);
    if (!si || !isFn(si.pullMonth)) return { ok: false, reason: 'importer-not-ready' };
    if (stored.mode === 'all') {
      if (!isFn(si._resolveProviderRequest)) return { ok: false, reason: 'importer-not-ready' };
      var allGate = safe(function () {
        return si._resolveProviderRequest('all', { allowAll: true, requireRosterForAll: true, allowDetectedProvider: true });
      }, null);
      if (allGate && allGate.ok === true && allGate.provider === 'all') return { ok: true, provider: 'all' };
      /* scopefrozen-1.0.0: only a RESUME reaches here with a stamp, and only a
         roster-completeness refusal may be answered by one. Every other
         refusal - no importer, roster unbound to this account, provider gone -
         still refuses, under its own name. */
      var stamp = frozenScope ? sanitizeScope(frozenScope) : null;
      var allReason = reasonCode(allGate && allGate.reason || 'provider-roster-incomplete');
      if (stamp && stamp.mode === 'all' && allReason === 'provider-roster-incomplete') {
        return { ok: true, provider: 'all', frozenScope: stamp };
      }
      return { ok: false, reason: allReason };
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
  /* ===== pullheal-1.0.0 + attnscope-1.0.0 (needs-attention drains itself
     after a fix - on EITHER side of the extension seam)
     THE RULE, exactly: a day settled 'needs-attention' re-arms iff EITHER
       (EXT ARM) it carries an attemptExtV AND the CURRENT reported extension
         version is STRICTLY NEWER than it, OR
       (APP ARM) an app build is running AND it is not the build stamped on the
         day's spent attempts.
     Every other case keeps the cap:
       - both stamps matching what is running -> keeps the cap. This is the
         load-bearing half: a live broken loop must still stop.
       - attemptExtV NEWER than the running extension (a downgrade) -> the ext
         arm keeps the cap; only a changed app build can still move it.
       - no attemptExtV -> the ext arm proves nothing and keeps the cap.
       - no attemptAppV (a checkpoint written before attnscope) -> the app arm
         counts it as differing, so it re-arms EXACTLY ONCE: the next attempt
         it spends stamps the running build and the cap holds from then on.
       - nothing running reported at all -> nothing re-arms at all.
     Days already retryable are untouched; only a settled day is re-armed. */
  function dayRearmArm(day, liveExt, liveApp) {
    var spentExt = extVersionShape(day.attemptExtV);
    if (liveExt && spentExt && compareExtVersions(liveExt, spentExt) === 1) return 'ext';
    if (liveApp && appBuildShape(day.attemptAppV) !== liveApp) return 'app';
    return '';
  }
  function rearmOutdatedVersionDays(manifest) {
    var liveExt = currentExtVersion(), liveApp = currentAppBuild();
    var out = { rearmed: 0, from: '', to: liveExt, app: liveApp };
    if ((!liveExt && !liveApp) || !manifest || !manifest.months) return out;
    var months = Object.keys(manifest.months), stamp = now(), oldest = '';
    for (var mi = 0; mi < months.length; mi++) {
      var month = manifest.months[months[mi]], days = Object.keys(month.days), touched = false;
      for (var di = 0; di < days.length; di++) {
        var day = month.days[days[di]];
        if (!day || day.status !== 'needs-attention') continue;
        var arm = dayRearmArm(day, liveExt, liveApp);
        if (!arm) continue;
        var spent = extVersionShape(day.attemptExtV);
        day.status = 'retry'; day.attempts = 0; day.updatedAt = stamp;
        delete day.attemptExtV; delete day.attemptAppV;
        /* the receipt names the OLDEST extension that failed these days, and
           ONLY on the extension arm - a day re-armed because the APP changed
           was not failed by an older MLS Assist, and the copy must not say it
           was. That arm has no version to name and says so in words. */
        if (arm === 'ext' && spent && (!oldest || compareExtVersions(spent, oldest) === -1)) oldest = spent;
        out.rearmed++; touched = true;
      }
      if (touched && month.status === 'needs-attention') { month.status = 'retry'; month.updatedAt = stamp; }
    }
    out.from = oldest;
    return out;
  }
  function rearmOutdatedVersions() {
    var key = currentManifestKey();
    if (!key || !sessionReady()) return Promise.resolve(refusal('signin'));
    if (active) return Promise.resolve(refusal('job-busy', active.manifest));
    if (!lockApi()) return Promise.resolve(refusal('range-lock-unavailable'));
    return withAccountLock(key, function () {
      if (active) return refusal('job-busy', active.manifest);
      var read = readManifestAt(key), manifest = read.manifest;
      if (!read.ok) return refusal(read.reason);
      if (!manifest) return refusal('manifest-invalid');
      var done = rearmOutdatedVersionDays(manifest);
      if (!done.rearmed) {
        return { ok: true, complete: false, status: manifest.status, reason: reasonCode(manifest.reason),
          rearmed: 0, from: '', to: done.to, app: done.app, state: copy(manifest) };
      }
      /* The days are retryable again, so the job may no longer claim it is
         settled. sanitizeManifest enforces the same invariant on every read;
         stating it here makes the write itself honest. */
      if (manifest.status === 'needs-attention' && anyRetryable(manifest)) {
        manifest.status = 'waiting-retry'; manifest.reason = 'month-partial';
      }
      var saved = writeManifestAt(key, manifest);
      if (!saved.ok) return refusal(saved.reason, manifest);
      return { ok: true, complete: false, status: manifest.status, reason: reasonCode(manifest.reason),
        rearmed: done.rearmed, from: done.from, to: done.to, app: done.app, state: copy(manifest) };
    });
  }
  /* ===== end pullheal-1.0.0 version-scoped attempts ===== */
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
    /* ===== dnote-1.0.0 (b1184): an unread OWN note is a DEBT, not a done =====
       OWNER 2026-09-01: a finished pull reported "everything verified" with
       seven of the day's own visit notes never read - they had been deferred
       to a background catch-up that a previous pull's Stop had left stopped.
       The durable job was checkpointing those days `complete`, so nothing
       would ever return to them. A day is complete when its charts landed AND
       its own notes are read or honestly classified (nothing in athenaOne, or
       a named refusal whose retries are spent). While any note is merely
       QUEUED the day keeps its charts, keeps its place, and stays retryable -
       the ordinary attempt cap still bounds it, so this can never spin. */
    var dayNotesPending = Math.max(0, Math.min(400, Math.floor(Number(payload.dayNotesPending || 0) || 0)));
    var complete = payload.ok === true && payload.complete === true && dayNotesPending === 0;
    /* p1-range-reasons-1.0.0: keep the importer's OWN verdict on both arms. A
       complete day says HOW it completed (`empty-day`/`provider-empty` is the
       difference between "Athena verified no appointments" and "16 charts
       landed"), and a failed day keeps its specific cause instead of a
       generic one. */
    var code = reasonCode(payload.reason || (complete ? 'complete' : 'pull-failed'));
    /* dnote-1.0.0 (b1184): a day the importer finished, held back ONLY by the
       notes it still owes, says exactly that instead of borrowing a chart
       failure's code. Every other verdict keeps its own cause. */
    if (!complete && dayNotesPending > 0 && payload.ok === true && payload.complete === true) code = 'day-notes-pending';
    if (payload.loginExpired === true || payload.athenaSignedOutSuspected === true) code = 'no-athena-tab';
    /* ===== p1-range-signout-1.0.0 (a sign-out is a sign-in problem) =====
       Lead ruling 2026-08-17. `no-read`/`nav-failed` are ambiguous alone; the
       importer's bounded session probe rides the checkpoint as ONE boolean
       (p1-month-signout-1.0.0). With the probe positive this is a sign-out and
       the job must wait for a sign-in, not burn retries. With no probe the
       reason is untouched and behaviour is exactly what it was. */
    if (payload.sessionExpired === true && SIGNOUT_CANDIDATE_REASONS[code] === 1) code = 'athena-session-expired';
    /* ===== end p1-range-signout-1.0.0 ===== */
    /* scopeempty-1.0.0: the scoped provider is simply not on this day's
       calendar. Complete and empty, with the reason kept - never attention.
       Guarded on all three of: the exact code, a provider-SCOPED job, and no
       outstanding own-note debt, so it can never promote a day that still owes
       work or a day an all-provider job could not read. */
    if (code === SCOPED_EMPTY_REASON && providerScopedJob(ctx.manifest) && dayNotesPending === 0) complete = true;
    /* ===== attn-1.0.0 R1 (the scoped-empty verdict is kept ON THE DAY) =====
       provscope-1.0.0 emits this code from exactly one branch: the calendar
       RENDERED, other clinicians were discovered on it, and the scoped
       provider was not among them. Record that evidence durably, so the next
       checkpoint of this day can settle it with no second read of athena. */
    var scoped = providerScopedJob(ctx.manifest);
    var surfaceProviders = boundedCount(payload.surfaceProviders);
    if (code === SCOPED_EMPTY_REASON && scoped) {
      day.scopedEmpty = 1;
      if (surfaceProviders > 0) day.surfaceProviders = surfaceProviders;
    }
    /* A day already proved empty for this provider is not re-opened by a
       MONTH-level code. It keeps its own verdict and completes with no
       re-read. A day-level verdict of its own (no-read, nav-failed, ...) is
       deliberately absent from GENERIC_MONTH_REASONS and still stands. */
    if (!complete && scoped && day.scopedEmpty === 1 && dayNotesPending === 0 &&
        GENERIC_MONTH_REASONS[code] === 1) { complete = true; code = SCOPED_EMPTY_REASON; }
    /* ===== end attn-1.0.0 R1 ===== */
    /* p1-range-continue-1.0.0: only a day Athena was actually DRIVEN through
       spends an attempt, and only such a day can reach the cap. */
    var attemptable = !complete && NON_ATTEMPT_REASONS[code] !== 1 && !isLoginReason(code);
    if (first && attemptable) {
      day.attempts = Math.min(1000, Number(day.attempts || 0) + 1);
      /* pullheal-1.0.0: stamp the extension that spent THIS attempt. Versions
         only move forward, so the stamp always names the newest extension that
         has failed this day - which is exactly the version a later re-arm must
         compare against. */
      var spentUnder = currentExtVersion();
      if (spentUnder) day.attemptExtV = spentUnder;
      /* attnscope-1.0.0: and the app build that spent it, stamped from the
         same tab that is about to judge the cap - so a day re-armed because
         the app changed can never re-arm a second time on the same build. */
      var appUnder = currentAppBuild();
      if (appUnder) day.attemptAppV = appUnder;
    }
    /* ===== attn-1.0.0 R2/R3/R4 (what the day could NOT read, recorded) =====
       Run AFTER the attempt is spent, so the cap is judged on the same number
       the status line below uses. */
    var chartsRead = boundedCount(payload.chartsRead);
    var chartsUnread = boundedCount(payload.chartsUnread);
    var chartsRefused = Math.min(chartsUnread, boundedCount(payload.chartsRefused));
    var refusalCodes = sanitizeRefusalCodes(payload.chartsRefusedCodes);
    if (!complete && code === 'history-partial' && dayNotesPending === 0) {
      var atCap = Number(day.attempts || 0) >= DAY_ATTEMPT_CAP;
      /* R2: every chart this day did not read was REFUSED for a cause no
         re-read can cure. Re-reading would return the same refusal, so the
         day is finished NOW and the refusals travel on the day record. */
      var refusalsOnly = chartsUnread > 0 && chartsRefused >= chartsUnread;
      /* R3: attention is for a day NOTHING could be read on. A day that read
         charts and has spent its attempts is finished, with the charts it
         could not read recorded - it is not something the owner can act on. */
      if (refusalsOnly || (atCap && chartsRead > 0)) {
        complete = true;
        day.chartsUnread = chartsUnread;
        if (chartsRefused > 0) day.chartsRefused = chartsRefused;
        if (refusalCodes) day.refused = refusalCodes;
      }
    }
    /* R4: a calendar-partial day STAYS attention - athena showed rows this
       day did not account for and only the owner can look at that. Record how
       many, so the card can say it instead of "not all saved". */
    if (!complete && code === 'calendar-partial') {
      var missingRows = boundedCount(payload.calendarMissing, 4000);
      if (missingRows > 0) day.calendarMissing = missingRows;
    }
    /* ===== end attn-1.0.0 R2/R3/R4 ===== */
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
  /* ===== attn-1.0.0 R0 (only a failed OWNER PROOF re-opens a completed day)
     The two reconciliation paths below exist for exactly one situation: the
     importer's final month-owner RELEASE proof failed after the per-day
     callbacks had already settled, and an apparently green last day must not
     promote an unverified month. They were gated on "the month result is not
     complete", which is much broader - and once scopeempty-1.0.0 let the JOB
     complete a day the IMPORTER counts as a failure, that breadth silently
     demoted the job's own promotion on every single pass. Gate them on the
     proof itself. The importer sets reason 'month-owner-unverified' (and a
     monthOwnerReceipt) whenever that proof fails, so this is the same
     condition the guards were written for, said exactly. */
  function monthOwnerUnproven(result) {
    if (!result || typeof result !== 'object') return true;
    if (result.monthOwnerReceipt && typeof result.monthOwnerReceipt === 'object' &&
        result.monthOwnerReceipt.complete !== true) return true;
    var reason = String(result.reason || '');
    return reason === 'month-owner-unverified' || reason === 'month-exception';
  }
  function processMonthResult(ctx, monthKey, dates, result, seen) {
    var rows = result && Array.isArray(result.days) ? result.days : [];
    for (var i = 0; i < rows.length && !ctx.storageFailure; i++) {
      var row = rows[i] || {}, receipt = row.receipt || {};
      /* attn-1.0.0: the importer stamps its own PHI-free classification on the
         settling row (the identical object its per-day callback carried), so
         the settling path and the callback cannot disagree about a day. */
      var stamp = row.checkpoint && typeof row.checkpoint === 'object' ? row.checkpoint : {};
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
          !!(receipt.historyReceipt && receipt.historyReceipt.sessionExpired === true),
        /* dnote-1.0.0 (b1184): the settling path carries the day's own-note
           debt too, so a month result and its per-day callback cannot disagree
           about whether the day is finished. */
        dayNotesPending: Number(row.dayNotesPending ||
          (receipt.historyReceipt && receipt.historyReceipt.dayNotesPending) ||
          receipt.dayNotesPending || 0),
        /* attn-1.0.0: the day's chart census, unaccounted rows and painted
           clinicians - counts and closed codes, never PHI. */
        chartsRead: stamp.chartsRead,
        chartsUnread: stamp.chartsUnread,
        chartsRefused: stamp.chartsRefused,
        chartsRefusedCodes: stamp.chartsRefusedCodes,
        calendarMissing: stamp.calendarMissing,
        surfaceProviders: stamp.surfaceProviders
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
      /* attn-1.0.0 R0: a day THIS run completed is re-opened only when the
         month-owner release proof actually failed. Without this the job's own
         verdicts (a scoped-empty day, a day whose only unread charts were
         refused) were demoted on every pass and cycled 'retry' for ever. */
      if (seen[retryDate] && retryDay && retryDay.status === 'complete' && !monthOwnerUnproven(result)) continue;
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
    /* attn-1.0.0 R0: same gate. A month every day of which the job has proved
       is only re-opened by a failed owner proof - never because the importer
       counted a scoped-empty or refusal-settled day as one of its failures. */
    if (!ctx.storageFailure && result && result.complete !== true &&
        monthOwnerUnproven(result) && monthComplete(ctx.manifest.months[monthKey])) {
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
  function executeLocked(key, manifest, onStatus, resumed) {
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
    /* scopefrozen-1.0.0: a RESUME may present this job's own recorded stamp; a
       START passes nothing, so it is gated live exactly as before. */
    var liveProvider = resolveStoredProvider(manifest.provider, resumed === true ? frozenScopeForResume(manifest) : null);
    if (!liveProvider.ok) {
      manifest.status = 'waiting-retry'; manifest.reason = reasonCode(liveProvider.reason);
      persistContext(ctx); active = null; return Promise.resolve(outcome(ctx));
    }
    /* The scope just passed LIVE - record it, so the next resume has something
       true to stand on. A resume that ran on the stamp keeps the stamp it used
       and never re-dates itself off its own evidence. */
    if (!liveProvider.frozenScope) {
      var freshScope = currentScopeStamp(String(manifest.provider.mode || ''));
      if (freshScope) { manifest.scope = freshScope; persistContext(ctx); }
    }
    var frozenScopeInUse = liveProvider.frozenScope || null;
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
        /* scopefrozen-1.0.0: the importer runs the same all-provider gate for
           every month of the range, so the stamp has to travel with the run or
           the resume dies on month one with the identical roster sentence. */
        frozenAllScope: frozenScopeInUse,
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
      /* scopefrozen-1.0.0: a NEW start is never a resume. No stamp is offered,
         so the live provider gate is the only thing that can admit it. */
      return executeLocked(key, manifest, parsed.opts.onStatus, false);
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
      /* pullheal-1.0.0: before anything else, give back the attempts that were
         spent under an extension that has since been fixed, and say so. */
      var byVersion = rearmOutdatedVersionDays(manifest);
      if (byVersion.rearmed) healNoteRearm(byVersion);
      /* p1-range-continue-1.0.0: a human pressing Resume on a settled job is a
         new intent - re-arm exactly the days that hit the attempt cap. */
      if (manifest.status === 'needs-attention') rearmAttention(manifest);
      manifest.status = 'running'; manifest.reason = '';
      /* scopefrozen-1.0.0: THIS is the resume. It may stand on the scope this
         job proved when it started; it re-verifies live first and only falls
         back to the stamp when the live roster receipt is the one thing
         missing. */
      return executeLocked(key, manifest, opts.onStatus, true);
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
    var providerReady = resolveStoredProvider(manifest.provider, frozenScopeForResume(manifest));
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
  /* yearpicker-1.0.0: the year card's own "Pulling for" options, built from
     the same two roster surfaces the month card's selector uses. Escaping is
     done here because these labels are clinician-entered Athena text. */
  function uiEsc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (ch) {
      return ch === '&' ? '&amp;' : (ch === '<' ? '&lt;' : (ch === '>' ? '&gt;' : '&quot;'));
    });
  }
  function uiProviderOptionsHtml(pinned) {
    var list = uiRosterList(), seen = uiRosterSeenOnCalendar(), counts = {}, html = '';
    var known = { __all: 1 };
    html += '<option value="__all">' + uiEsc(UI_DEFAULT_SCOPE_LABEL) + '</option>';
    list.forEach(function (entry) { var k = String(entry && entry.name || '').toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
    list.forEach(function (entry) {
      var value = uiProviderValue(entry), label = cleanText(entry && entry.name, 120);
      if (!value || !label || known[value]) return;
      if (counts[label.toLowerCase()] > 1) label += entry.id ? (' - ID ' + entry.id) : (' - ' + String(entry.stableKey || ''));
      known[value] = 1;
      html += '<option value="' + uiEsc(value) + '">' + uiEsc(label) + '</option>';
    });
    /* csp-1.0.0: clinicians athena NAMED on the calendar without proving an
       identity. Same labelled group, same law - the pull still verifies the
       exact clinician and still refuses somebody else's view. */
    var calendarOnly = '';
    seen.forEach(function (entry) {
      var value = uiProviderValue(entry), label = cleanText(entry && entry.name, 120);
      if (!value || !label || known[value]) return;
      known[value] = 1;
      calendarOnly += '<option value="' + uiEsc(value) + '">' + uiEsc(label) + '</option>';
    });
    if (calendarOnly) html += '<optgroup label="Seen on the athena calendar - not verified yet">' + calendarOnly + '</optgroup>';
    /* The choice this card has to SHOW - a frozen job's provider, or the one
       the month card is already scoped to - must exist here even when neither
       roster surface lists it, or the card would silently answer "default"
       for a pull that is not scoped to the default. */
    if (pinned && pinned.value && !known[pinned.value]) html += '<option value="' + uiEsc(pinned.value) + '">' + uiEsc(pinned.label) + '</option>';
    return html;
  }
  /* The value the card must SHOW: a frozen job's own provider while that job
     owns the card, the doctor's own choice otherwise. */
  function uiFrozenProviderChoice(manifest, blocksStart) {
    if (!manifest || !manifest.provider || !blocksStart) return null;
    if (String(manifest.provider.mode || '') === 'all') return { value: '__all', label: UI_DEFAULT_SCOPE_LABEL };
    var key = cleanText(manifest.provider.stableKey) || cleanText(manifest.provider.id);
    if (!key) return null;
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    var entry = roster && isFn(roster.resolve) ? safe(function () { return roster.resolve(key); }, null) : null;
    return { value: 'pv:' + encodeURIComponent(key), label: cleanText(entry && entry.name, 120) || 'Saved verified provider' };
  }
  /* Until the doctor touches the year card's own picker it MIRRORS the month
     card's selector, so adding this control changed no existing behaviour: the
     year still follows the one "Show visits for" choice made above it. */
  function uiMonthCardProviderValue() {
    if (!uiDocumentReady()) return '';
    var monthSelect = document.getElementById('ez3Prov');
    return monthSelect ? String(monthSelect.value || '') : '';
  }
  function uiSelectHasValue(select, value) {
    if (!select || !value) return false;
    for (var i = 0; i < select.options.length; i++) if (select.options[i] && select.options[i].value === value) return true;
    return false;
  }
  /* A value the card must show, resolved into {value,label} through the same
     roster the pull uses. Returns null for the default scope. */
  function uiPinnedChoice(value) {
    value = String(value || '');
    if (!value || value === '__all') return null;
    var ref = value;
    if (ref.slice(0, 3) === 'pv:') { ref = safe(function () { return decodeURIComponent(value.slice(3)); }, ''); }
    if (!ref) return null;
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    var entry = roster && isFn(roster.resolve) ? safe(function () { return roster.resolve(ref); }, null) : null;
    var key = cleanText(entry && entry.stableKey) || cleanText(ref);
    if (!key) return null;
    return { value: 'pv:' + encodeURIComponent(key), label: cleanText(entry && entry.name, 120) || 'Selected provider' };
  }
  function uiFillProviderSelect(select, manifest, blocksStart) {
    if (!select || select.id !== 'mlsP1YearProv') return null;
    var frozen = uiFrozenProviderChoice(manifest, blocksStart);
    var wanted = frozen || uiPinnedChoice(uiProvChoice || uiMonthCardProviderValue());
    var html = uiProviderOptionsHtml(wanted);
    if (select.getAttribute('data-prov-options') !== html) {
      select.innerHTML = html;
      select.setAttribute('data-prov-options', html);
    }
    var want = wanted ? wanted.value : '__all';
    if (!uiSelectHasValue(select, want)) want = '__all';
    if (select.value !== want) select.value = want;
    select.disabled = !!blocksStart || !!uiAction;
    return frozen;
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
  /* ===== yearpicker-1.0.0 (owner 2026-09-01: "also make the pulling for
     slecter also here") ==================================================
     The year card used to borrow the month card's #ez3Prov selector, which
     lives far above it: to scope a year the doctor had to scroll away from the
     control they were about to press, and after a reload that selector shows
     its own default ("Your athenaOne view (default)") while a saved job is
     frozen to something else - a card that misleads. The year card now owns a
     picker with the SAME options, including the csp-1.0.0 calendar-only group,
     and it is frozen (disabled, showing the job's provider) while a job runs.
     #ez3Prov stays the fallback so a host that has not mounted the year card
     behaves exactly as before. */
  var UI_DEFAULT_SCOPE_LABEL = 'Your athenaOne view (default)';
  function uiProviderSelect() {
    if (!uiDocumentReady()) return null;
    return document.getElementById('mlsP1YearProv') || document.getElementById('ez3Prov');
  }
  function uiRosterList() {
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    var list = roster && isFn(roster.list) ? (safe(function () { return roster.list(); }, []) || []) : [];
    return list.slice().sort(function (a, b) { return String(a && a.name || '').localeCompare(String(b && b.name || '')); });
  }
  function uiRosterSeenOnCalendar() {
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    return (roster && isFn(roster.seenOnCalendar) ? (safe(function () { return roster.seenOnCalendar(); }, []) || []) : []);
  }
  function uiProviderValue(entry) {
    var key = cleanText(entry && entry.stableKey);
    return key ? ('pv:' + encodeURIComponent(key)) : '';
  }
  function uiProviderSelection() {
    if (!uiDocumentReady()) return { ok: false, reason: 'provider-required', label: 'Provider unavailable' };
    var select = uiProviderSelect();
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
    /* attn-1.0.0: a history-partial day only reaches the doctor when NOTHING
       on it could be read - a day that read charts and could not read the rest
       finishes and names them instead of asking for a retry. */
    'history-partial': 'No chart on that day could be read. Check the athenaOne tab for those days, then press Resume to re-pull them.',
    'calendar-partial': 'Athena showed appointments that day which were not all saved — the count is beside each date above. Press Resume to re-pull just those days.',
    'identity-bootstrap-partial': 'Some patients on that day could not be identified exactly. Check Athena, then Resume.',
    'history-store-empty': 'Charts were read but nothing was stored for that day. Check available storage, then Resume.',
    'history-store-unmeasured': 'MLS could not verify what was stored for that day. Resume re-reads it.',
    'schedule-parse-timeout': 'Reading that day’s schedule took too long. Check the Athena tab, then Resume.',
    /* scopeempty-1.0.0: this is now a COMPLETE, EMPTY day, so this sentence
       explains a finished result rather than asking for a retry. */
    'provider-not-on-calendar': 'Athena’s calendar for that day showed other clinicians but not this provider, so the day is recorded as empty for them — provider not on the calendar this day.',
    /* dnote-1.0.0 (b1184): the charts landed; the day still owes its own visit
       notes, so it is not counted as done. */
    'day-notes-pending': 'That day’s charts were saved, but its own visit notes are still to read. Resume finishes them.',
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
      run.skippedComplete + ' skipped as already verified.' + uiRefusedCopy(manifest);
  }
  /* ===== attn-1.0.0 (a refused chart, said in English) =====================
     A CLOSED map - the same four codes the durable manifest is allowed to
     hold, so the card can never print a raw machine code at the doctor. */
  var UI_REFUSAL_COPY = {
    'dob-mismatch': 'patient identity did not match',
    ambiguous: 'two charts answer to that patient',
    'chart-parse-failed': 'that chart could not be read',
    'chart-parse-timeout': 'that chart did not finish loading'
  };
  function uiRefusedCopy(manifest) {
    var receipt = (manifest && manifest.summary) || summarize(manifest);
    var list = receipt.refused || [];
    if (!list.length) return '';
    var shown = list.slice(0, 3).map(function (row) {
      var refused = Number(row.refused || 0) || 0, unread = Number(row.unread || 0) || 0;
      var codes = row.codes && typeof row.codes === 'object' ? Object.keys(row.codes).sort() : [];
      var why = codes.map(function (code) { return UI_REFUSAL_COPY[code] || ''; })
        .filter(function (text) { return !!text; }).join('; ');
      if (refused > 0) {
        return row.date + ' complete — ' + refused + ' chart' + (refused === 1 ? '' : 's') +
          ' refused' + (why ? ': ' + why : '');
      }
      return row.date + ' complete — ' + unread + ' chart' + (unread === 1 ? '' : 's') +
        ' not read after ' + DAY_ATTEMPT_CAP + ' tries';
    });
    return ' ' + shown.join('. ') + '.' +
      (list.length > shown.length ? ' (' + list.length + ' days in all.)' : '') +
      ' A refused chart stays refused — nothing was guessed, and those days are finished.';
  }
  /* ===== end attn-1.0.0 card copy ===== */
  /* p1-range-continue-1.0.0: the days that hit the attempt cap, named. Dates
     and bounded codes only. attn-1.0.0 adds the one number a calendar-partial
     day is unactionable without: how many appointments were never accounted. */
  function uiAttentionCopy(manifest) {
    var receipt = (manifest && manifest.summary) || summarize(manifest);
    var list = receipt.attention || [];
    if (!list.length) return '';
    var shown = list.slice(0, 6).map(function (row) {
      var missing = Number(row.missing || 0) || 0;
      return row.date + ' (' + String(row.reason || '').replace(/-/g, ' ') +
        (missing > 0 ? ', ' + missing + ' appointment' + (missing === 1 ? '' : 's') + ' missing' : '') + ')';
    });
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
    /* pullheal-1.0.0: the completion line says plainly whether it took any
       automatic help to get there. */
    if (manifest.status === 'complete') return 'Complete: ' + scope + ' · ' + uiReceiptCopy(manifest) + healOutcomeCopy(manifest);
    if (manifest.status === 'needs-attention') {
      return 'Finished with exceptions: ' + scope + ' · ' + uiReceiptCopy(manifest) + ' ' +
        uiAttentionCopy(manifest) + ' ' + uiReasonCopy('needs-attention') + healOutcomeCopy(manifest);
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
      '#mlsP1YearPull .p1yr-prov select{max-width:260px;flex:1 1 auto;min-width:0}' +
      '#mlsP1YearPull .p1yr-prov select[disabled]{background:#F6F5F1;color:#3B4741;opacity:1}' +
      '#mlsP1YearPull .p1yr-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}' +
      '#mlsP1YearPull .p1yr-tile{border:1px solid rgba(32,64,52,.14);border-radius:9px;padding:6px 8px;text-align:center;min-width:0}' +
      '#mlsP1YearPull .p1yr-tile b{display:block;font:700 15px/1.2 system-ui,sans-serif;color:inherit}' +
      '#mlsP1YearPull .p1yr-tile span{display:block;font:600 10.5px/1.3 system-ui,sans-serif;color:var(--muted,#52645d);overflow-wrap:anywhere}' +
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
      /* pullheal-1.0.0 tracker: one collapsed line by default, opened on demand */
      '#mlsP1YearPull .p1yr-heal{border-top:1px dashed rgba(32,64,52,.16);padding-top:8px}' +
      '#mlsP1YearPull .p1yr-healline{min-height:32px;display:flex;align-items:center;cursor:pointer;' +
      'font:600 12px/1.4 system-ui,sans-serif;color:var(--muted,#52645d)}' +
      '#mlsP1YearPull .p1yr-healbody{display:grid;gap:6px;padding:6px 0 2px}' +
      '#mlsP1YearPull .p1yr-healrow{margin:0;font:400 11.5px/1.5 system-ui,sans-serif;color:var(--muted,#52645d);overflow-wrap:anywhere}' +
      '#mlsP1YearPull .p1yr-healswitch{display:inline-flex;align-items:center;gap:8px;min-height:44px;width:max-content;' +
      'max-width:100%;font:600 12px/1.35 system-ui,sans-serif;cursor:pointer}' +
      '#mlsP1YearPull .p1yr-healswitch input{width:18px;height:18px;flex:0 0 auto}' +
      '@media(max-width:640px){#mlsP1YearPull .p1yr-progress{grid-template-columns:1fr}#mlsP1YearPull .p1yr-count{white-space:normal}' +
      '#mlsP1YearPull .p1yr-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}#mlsP1YearPull .p1yr-prov select{max-width:none}' +
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
    /* yearpicker-1.0.0: a scope change is a repaint, never a pull. */
    var provSelect = root.querySelector('#mlsP1YearProv');
    if (provSelect) provSelect.onchange = function () { uiProvChoice = String(provSelect.value || ''); uiNotice = ''; queueUiRefresh(0); };
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
    healWirePanel(root);
  }
  function refreshYearUi(root) {
    if (!root || !installedApi || installedApi.installed !== true) return;
    var manifest = state(), progress = uiProgress(manifest);
    var status = manifest && manifest.status || '', running = status === 'running' || status === 'pending';
    /* p1-range-continue-1.0.0: 'needs-attention' is terminal (a new pull is
       admitted) AND resumable (one more bounded round on those days). */
    var terminal = status === 'complete' || status === 'cancelled' || status === 'needs-attention';
    var blocksStart = !!(manifest && !terminal);
    var resumable = status === 'paused' || status === 'waiting-login' || status === 'waiting-retry' ||
      status === 'storage-failed' || status === 'needs-attention';
    /* yearpicker-1.0.0: fill and freeze the card's own scope selector BEFORE
       anything reads a selection from it. uiProviderSelection() now prefers
       this control, so reading it first would read an empty select and paint
       "Choose a provider above" over a card that is correctly scoped. */
    var frozenProv = uiFillProviderSelect(root.querySelector('#mlsP1YearProv'), manifest, blocksStart);
    var selected = uiProviderSelection();
    var error = !!uiNotice || (!blocksStart && !selected.ok) || status === 'waiting-retry' ||
      status === 'storage-failed' || status === 'account-changed' || status === 'needs-attention';
    root.setAttribute('data-status', status || 'ready'); root.setAttribute('data-error', error ? 'true' : 'false');
    root.setAttribute('aria-busy', running ? 'true' : 'false');
    var year = uiFillYearSelect(root.querySelector('#mlsP1YearChoice'), manifest, blocksStart);
    var provLock = root.querySelector('#mlsP1YearProvLock');
    uiSetHidden(provLock, !frozenProv);
    if (provLock && frozenProv) {
      uiSetText(provLock, 'This saved pull is locked to ' + frozenProv.label +
        '. Cancel it to pull for somebody else.');
    }
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
    /* yeartiles-1.0.0: the month card's strip says "N of M days saved"; a year
       needs its months beside that, or 31 of 365 reads like nothing happened.
       The compact count above keeps its own shape - this is the sentence. */
    uiSetText(root.querySelector('#mlsP1YearMonths'), progress.totalDays
      ? (progress.completeMonths + ' of ' + progress.totalMonths + ' month' + (progress.totalMonths === 1 ? '' : 's') +
         ' complete - ' + progress.completeDays + ' of ' + progress.totalDays + ' days saved')
      : 'Nothing pulled for this year yet.');
    var tileSummary = (manifest && manifest.summary) || summarize(manifest);
    uiSetText(root.querySelector('#mlsP1YearTileRows'), manifest ? tileSummary.withRows : 0);
    uiSetText(root.querySelector('#mlsP1YearTileSaved'), manifest ? tileSummary.complete : 0);
    uiSetText(root.querySelector('#mlsP1YearTileEmpty'), manifest ? tileSummary.empty : 0);
    uiSetText(root.querySelector('#mlsP1YearTileAttention'), manifest ? tileSummary.needsAttention : 0);
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
    healRefreshPanel(root, manifest);
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
        /* yearpicker-1.0.0: the year card scopes itself. Same options as the
           month card's selector; frozen to the running job's provider. */
        '<label class="p1yr-picker p1yr-prov" for="mlsP1YearProv"><span>Pulling for</span><select id="mlsP1YearProv" aria-label="Pull this year for provider"></select></label>' +
        '<p class="p1yr-note" id="mlsP1YearProvLock" hidden></p>' +
        '<label class="p1yr-choice" for="mlsP1YearFullNotes"><input type="checkbox" id="mlsP1YearFullNotes"> Include full visit notes <span>(slower)</span></label>' +
        '<div class="p1yr-progress"><progress id="mlsP1YearProgress" max="1" value="0" aria-label="Year pull progress"></progress><span class="p1yr-count" id="mlsP1YearCount"></span></div>' +
        '<p class="p1yr-note" id="mlsP1YearMonths"></p>' +
        /* yeartiles-1.0.0 (owner 2026-09-01: "for the yera pull to there needs
           to be an indictarer jjust like ithe the month pull"). The same four
           honest-tiles-1.0.0 quantities the month card paints, from the same
           recounted manifest summary - never a second story. */
        '<div class="p1yr-tiles" id="mlsP1YearTiles" role="group" aria-label="Year pull progress detail">' +
        '<div class="p1yr-tile"><b id="mlsP1YearTileRows">0</b><span>days with visits</span></div>' +
        '<div class="p1yr-tile"><b id="mlsP1YearTileSaved">0</b><span>days saved</span></div>' +
        '<div class="p1yr-tile"><b id="mlsP1YearTileEmpty">0</b><span>verified empty</span></div>' +
        '<div class="p1yr-tile"><b id="mlsP1YearTileAttention">0</b><span>need attention</span></div>' +
        '</div>' +
        '<p class="p1yr-status" id="mlsP1YearStatus" aria-atomic="true"></p>' +
        '<div class="p1yr-actions"><button type="button" class="ez3-sm pri" id="mlsP1YearStart"></button>' +
        '<button type="button" class="ez3-sm" id="mlsP1YearPause">Pause</button>' +
        '<button type="button" class="ez3-sm pri" id="mlsP1YearResume">Resume</button>' +
        '<button type="button" class="ez3-sm warn" id="mlsP1YearCancel">Cancel</button></div>' +
        /* pullheal-1.0.0: the health tracker rides the same section, so it is
           read where the pull is started and it costs the canonical Staff Prep
           card zero edits. */
        healPanelHtml();
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
    uiActionSequence++; uiAction = ''; uiNotice = ''; uiFullNotesChoice = false; uiFullNotesInitialized = false; uiYearChoice = ''; uiProvChoice = '';
  }

  /* =======================================================================
   * pullheal-1.0.0 - the self-healing supervisor and the health tracker.
   *
   * OWNER, 2026-09-01: "needs attention needs to be 0 or its not even worth
   * doing as this has to be accurate. why dont u make a self healing fixer and
   * tracker to make sure things always work".
   *
   * Every cure below was applied BY HAND during a live August month pull on
   * 2026-09-01. This is those exact cures, productized - nothing speculative:
   *
   *  (a) athena's CSRF retry interstitial wedged every navigation until a human
   *      clicked its Continue. That is FIXED EXTENSION-SIDE (contfix-1.0.0, MLS
   *      Assist 3.0.100 - the driver presses it itself). The supervisor never
   *      touches athena; the extension owns athena. All it does is COUNT the
   *      shape that a still-wedging interstitial makes on this side - days
   *      settling 'nav-failed' - so "did it come back?" is answerable from the
   *      ledger instead of from memory.
   *  (b) status 'storage-failed' / reason 'metadata-persist-failed', recurring
   *      while localStorage was healthy at 1.7MB. api.resume() cured it every
   *      single time. The supervisor now does that resume, BOUNDED, with a
   *      receipt each time, and stops and says so honestly past the bound.
   *      What actually fails is instrumented in writeManifestAt above.
   *  (c) days settled 'needs-attention' at the attempt cap having spent all
   *      three attempts under a BROKEN extension. Version-scoped attempts
   *      (rearmOutdatedVersionDays above) drain those to zero automatically
   *      after an extension fix, without ever touching a day the CURRENT
   *      extension failed.
   *  (d) rapid pause+resume bounced the engine. Every supervisor action is
   *      therefore serialized: pause -> confirm paused -> act -> resume ->
   *      confirm running. Never fire-and-forget, never two at once.
   *
   * LAWS IT KEEPS: one tab runs engines (it acts only through pause/resume,
   * which take the account Web Lock, so a second tab's supervisor is refused
   * and that refusal costs it nothing); it never weakens a gate; it reads
   * state() and never drives athena; its clock is hidden-tab-safe; and it has
   * an off switch that a human owns.
   * ==================================================================== */
  var HEAL_VERSION = 'pullheal-1.0.0';
  var HEAL_SUFFIX = 'p1PullHealV1';
  var HEAL_OFF_SUFFIX = 'p1PullHealOffV1';
  var HEAL_TICK_MS = 30000;
  var HEAL_RESUME_MAX_PER_HOUR = 6;
  var HEAL_RESUME_WINDOW_MS = 3600000;
  var HEAL_STALL_TICKS = 2;
  var HEAL_SETTLE_TRIES = 8;
  var HEAL_SETTLE_MS = 500;
  var HEAL_NAVFAIL_SUSPECT = 2;
  var HEAL_HISTORY_MAX = 20;
  var HEAL_IDLE_TICKS = 4;
  var HEAL_RUN_KIND = { year: 1, month: 1 };
  var healLedger = null;
  var healResumeStamps = [];
  var healBusy = false;
  var healWorker = null;
  var healWorkerUrl = null;
  var healInterval = null;
  var healLastTickAt = 0;
  var healIdleTicks = 0;

  function healKeyFor(suffix) {
    /* Scoped by the manifest key itself, so the health record can never be
       written into a namespace the job would refuse - including the shared
       logged-out sf_u::_:: one. */
    var base = currentManifestKey();
    return base ? base.slice(0, -MANIFEST_SUFFIX.length) + suffix : '';
  }
  function healEnabled() {
    var key = healKeyFor(HEAL_OFF_SUFFIX);
    if (!key) return false;
    return safe(function () { return localStorage.getItem(key) !== '1'; }, true);
  }
  function healSetEnabled(on) {
    var key = healKeyFor(HEAL_OFF_SUFFIX);
    if (!key) return false;
    var wrote = safe(function () {
      if (on) localStorage.removeItem(key); else localStorage.setItem(key, '1');
      return (localStorage.getItem(key) !== '1') === !!on;
    }, false);
    if (wrote && on) healKick(); else if (wrote) healStopClock();
    queueUiRefresh(0);
    return wrote;
  }

  /* ---- the durable health record: a CLOSED allowlist, rebuilt on read and
     on write, so no field a caller invents can ever reach the store. Numbers,
     booleans, and values drawn from fixed vocabularies only. ---------------- */
  function healNum(value, max) {
    value = Math.floor(Number(value || 0) || 0);
    max = Number(max || 100000);
    return value < 0 ? 0 : (value > max ? max : value);
  }
  function healSanitizeRun(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var kind = String(raw.kind || '');
    if (HEAL_RUN_KIND[kind] !== 1) return null;
    var target = String(raw.target || '');
    if (!/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(target)) return null;
    var outcome = String(raw.outcome || '');
    if (JOB_STATUS[outcome] !== 1) return null;
    return {
      v: 1, at: finiteStamp(raw.at), kind: kind, target: target, outcome: outcome,
      days: healNum(raw.days, 400), complete: healNum(raw.complete, 400),
      needsAttention: healNum(raw.needsAttention, 400),
      stalls: healNum(raw.stalls, 999), resumes: healNum(raw.resumes, 999),
      refusals: healNum(raw.refusals, 999), rearmedDays: healNum(raw.rearmedDays, 400),
      interstitials: healNum(raw.interstitials, 999),
      persistFailures: healNum(raw.persistFailures, 999),
      bounded: raw.bounded === true,
      ext: extVersionShape(raw.ext), from: extVersionShape(raw.from)
    };
  }
  function healHistory() {
    var key = healKeyFor(HEAL_SUFFIX);
    if (!key) return [];
    var raw = safe(function () { return localStorage.getItem(key); }, null);
    if (!raw || String(raw).length > 40000) return [];
    var parsed = safe(function () { return JSON.parse(raw); }, null);
    var rows = parsed && Array.isArray(parsed.runs) ? parsed.runs : [];
    var out = [];
    for (var i = 0; i < rows.length && out.length < HEAL_HISTORY_MAX; i++) {
      var row = healSanitizeRun(rows[i]);
      if (row) out.push(row);
    }
    return out;
  }
  function healWriteHistory(rows) {
    var key = healKeyFor(HEAL_SUFFIX);
    if (!key) return false;
    var clean = [];
    for (var i = 0; i < rows.length && clean.length < HEAL_HISTORY_MAX; i++) {
      var row = healSanitizeRun(rows[i]);
      if (row) clean.push(row);
    }
    return safe(function () {
      localStorage.setItem(key, JSON.stringify({ v: 1, build: HEAL_VERSION, runs: clean }));
      return true;
    }, false);
  }

  /* ---- the per-run ledger ------------------------------------------------ */
  function healNewLedger(manifest) {
    return {
      v: 1, jobId: cleanText(manifest && manifest.jobId, 100),
      kind: String(manifest && manifest.kind || ''), target: String(manifest && manifest.target || ''),
      startedAt: now(), stalls: 0, resumes: 0, refusals: 0, rearmedDays: 0, rearmRuns: 0,
      interstitials: 0, persistFailures: 0, navSeen: 0, bounded: false,
      lastHeartbeatAt: 0, lastAction: '', lastActionAt: 0, lastRearm: '',
      sig: '', stallTicks: 0, recorded: '', versionCheckedAt: ''
    };
  }
  function healNoteRearm(done) {
    if (!healLedger) return;
    var count = healNum(done && done.rearmed, 400);
    if (!count) return;
    healLedger.rearmedDays += count;
    healLedger.rearmRuns++;
    /* The receipt the owner asked for, kept on its OWN field so a later
       recovery line can never overwrite the sentence that explains WHY those
       days came back. */
    /* attnscope-1.0.0: the extension arm still names the exact MLS Assist that
       failed those days. The app arm has no such version to name, so it says
       what actually changed instead of inventing one. */
    healLedger.lastRearm = 're-armed ' + count + ' day' + (count === 1 ? '' : 's') +
      (done && done.from ? ' - their failures happened under MLS Assist ' + done.from
        : ' - their failures happened under an older MLS Assist or app version');
    healLedger.lastAction = healLedger.lastRearm;
    healLedger.lastActionAt = now();
  }
  function healSignature(manifest) {
    var receipt = (manifest && manifest.summary) || summarize(manifest);
    return [manifest.status, manifest.currentMonth || '', receipt.complete, receipt.failed,
      receipt.needsAttention, finiteStamp(manifest.lastCheckpointAt), finiteStamp(manifest.updatedAt)].join('|');
  }
  function healCountDayReason(manifest, code) {
    var months = Object.keys((manifest && manifest.months) || {}), total = 0;
    for (var mi = 0; mi < months.length; mi++) {
      var days = manifest.months[months[mi]].days || {}, keys = Object.keys(days);
      for (var di = 0; di < keys.length; di++) {
        var day = days[keys[di]];
        if (day && day.status !== 'complete' && day.reason === code) total++;
      }
    }
    return total;
  }
  function healCountPersistSince(since) {
    var total = 0;
    for (var i = 0; i < persistDiag.length; i++) if (persistDiag[i].at >= since) total++;
    return total;
  }
  function healRecordRun(manifest) {
    if (!healLedger || healLedger.recorded === manifest.status) return;
    healLedger.recorded = manifest.status;
    var receipt = manifest.summary || summarize(manifest);
    var rows = healHistory();
    rows.unshift({
      at: now(), kind: manifest.kind, target: manifest.target, outcome: manifest.status,
      days: receipt.days, complete: receipt.complete, needsAttention: receipt.needsAttention,
      stalls: healLedger.stalls, resumes: healLedger.resumes, refusals: healLedger.refusals,
      rearmedDays: healLedger.rearmedDays, interstitials: healLedger.interstitials,
      persistFailures: healLedger.persistFailures, bounded: healLedger.bounded === true,
      ext: currentExtVersion(), from: ''
    });
    /* One row per range PER OUTCOME, newest kept: re-pulling 2026-09 to
       'complete' three times leaves one 'complete' row, while a 'complete'
       and an earlier 'needs-attention' for the same month BOTH stand - the
       history says what happened, not how many times it was clicked. */
    var seen = {}, kept = [];
    for (var i = 0; i < rows.length; i++) {
      var stamp = rows[i].kind + '|' + rows[i].target + '|' + rows[i].outcome;
      if (seen[stamp]) continue;
      seen[stamp] = 1; kept.push(rows[i]);
    }
    healWriteHistory(kept);
  }

  /* ---- bounded automatic recovery --------------------------------------- */
  function healResumeBudget() {
    var cutoff = now() - HEAL_RESUME_WINDOW_MS, kept = [];
    for (var i = 0; i < healResumeStamps.length; i++) if (healResumeStamps[i] > cutoff) kept.push(healResumeStamps[i]);
    healResumeStamps = kept;
    return HEAL_RESUME_MAX_PER_HOUR - kept.length;
  }
  /* Hidden-tab-safe: the shell's worker-backed sleep when it exists, otherwise
     a MessageChannel yield against the WALL CLOCK - a hidden tab's setTimeout
     is clamped and then bucketed to a minute, which would stretch a 500ms
     settle wait into a lie. */
  function healSleep(ms) {
    ms = Math.max(0, Number(ms || 0));
    var worker = safe(function () { return window.__mlsBgSleep; }, null);
    if (isFn(worker)) {
      var handed = safe(function () { return worker(ms); }, null);
      if (handed && isFn(handed.then)) return Promise.resolve(handed);
    }
    var at = now() + ms;
    return new Promise(function (resolve) {
      if (typeof document === 'undefined' || !document.hidden) { setTimeout(resolve, ms); return; }
      var channel = safe(function () { return new MessageChannel(); }, null);
      if (!channel) { setTimeout(resolve, ms); return; }
      function close() { safe(function () { channel.port1.onmessage = null; channel.port1.close(); channel.port2.close(); }); }
      channel.port1.onmessage = function () {
        if (now() >= at) { close(); resolve(); return; }
        if (!document.hidden) { close(); setTimeout(resolve, Math.max(0, at - now())); return; }
        safe(function () { channel.port2.postMessage(0); });
      };
      safe(function () { channel.port2.postMessage(0); });
    });
  }
  function healSettle(predicate, tries, gap) {
    function step(left) {
      var manifest = safe(state, null);
      if (predicate(manifest)) return Promise.resolve({ ok: true, state: manifest });
      if (left <= 0) return Promise.resolve({ ok: false, state: manifest });
      return healSleep(gap).then(function () { return step(left - 1); });
    }
    return step(Math.max(0, Number(tries || 0)));
  }
  /* Refusals that mean "this is not our stall to heal" - another MLS tab owns
     the job, or there is nothing to resume. They are recorded, and they must
     NOT spend the recovery budget. */
  var HEAL_NOT_OURS = {
    'range-lock-denied': 1, 'range-lock-unavailable': 1, 'job-busy': 1,
    signin: 1, 'manifest-invalid': 1, cancelled: 1
  };
  function healSerializedResume(label) {
    if (healBusy || !healLedger) return Promise.resolve({ ok: false, reason: 'job-busy' });
    if (healResumeBudget() <= 0) {
      healLedger.bounded = true;
      healLedger.lastAction = 'stopped trying: ' + HEAL_RESUME_MAX_PER_HOUR +
        ' automatic recoveries in one hour is the bound, and this needs a person';
      healLedger.lastActionAt = now();
      queueUiRefresh(0);
      return Promise.resolve({ ok: false, reason: 'heal-bound' });
    }
    healBusy = true;
    healLedger.stalls++;
    var before = safe(state, null);
    var claimsRunning = !!(before && (before.status === 'running' || before.status === 'pending'));
    /* (d) SERIALIZED. Never a bare resume on top of a job that still claims to
       be running - that is the bounce that was measured. Pause first, and
       CONFIRM the pause landed before touching anything. */
    var stopped = claimsRunning
      ? Promise.resolve(safe(function () { return installedApi.pause(); }, null)).then(function () {
        return healSettle(function (m) {
          return !!m && m.status !== 'running' && m.status !== 'pending';
        }, HEAL_SETTLE_TRIES, HEAL_SETTLE_MS);
      }, function () { return { ok: false }; })
      : Promise.resolve({ ok: true });
    return stopped.then(function (paused) {
      if (!paused.ok) {
        healLedger.refusals++;
        healLedger.lastAction = 'the engine would not confirm it had stopped, so nothing was restarted';
        return { ok: false, reason: 'pause-unconfirmed' };
      }
      var refused = '';
      healResumeStamps.push(now());
      var request = safe(function () {
        return installedApi.resume({ onStatus: function () { queueUiRefresh(0); } });
      }, null);
      if (request && isFn(request.then)) {
        request.then(function (result) {
          if (result && result.ok === false && HEAL_NOT_OURS[reasonCode(result.reason)] === 1) refused = reasonCode(result.reason);
        }, function () {});
      }
      /* resume() resolves only when the WHOLE range settles, which is minutes.
         Admission is what proves the restart, exactly as the card's own Resume
         button proves it. */
      return healSettle(function (m) {
        return !!refused || !!(m && (m.status === 'running' || m.status === 'pending' || m.status === 'complete'));
      }, HEAL_SETTLE_TRIES, HEAL_SETTLE_MS).then(function (settled) {
        if (refused) {
          healResumeStamps.pop();
          healLedger.refusals++;
          healLedger.lastAction = refused === 'range-lock-denied' || refused === 'job-busy'
            ? 'another MLS tab owns this pull, so this tab left it alone'
            : 'automatic recovery refused (' + refused + ')';
          return { ok: false, reason: refused };
        }
        if (settled.ok) {
          healLedger.resumes++;
          healLedger.lastAction = 'automatic recovery: ' + label;
        } else {
          healLedger.refusals++;
          healLedger.lastAction = 'automatic recovery tried (' + label + ') but the engine never confirmed it restarted';
        }
        return { ok: settled.ok === true, reason: settled.ok ? '' : 'resume-unconfirmed' };
      });
    }).then(function (out) {
      healBusy = false; healLedger.lastActionAt = now(); queueUiRefresh(0); return out;
    }, function () {
      healBusy = false; healLedger.refusals++; queueUiRefresh(0); return { ok: false, reason: 'exception' };
    });
  }
  function healVersionHeal() {
    if (healBusy || !healLedger) return;
    var live = currentExtVersion();
    /* Try once per extension version AND app build per job: attnscope-1.0.0
       made either one able to change the answer, so the key this is asked
       once per is both. Re-asking every 30s on an unchanged pair is noise. */
    var scope = live + '|' + currentAppBuild();
    if (scope === '|' || healLedger.versionCheckedAt === scope) return;
    healLedger.versionCheckedAt = scope;
    healBusy = true;
    Promise.resolve(safe(function () { return rearmOutdatedVersions(); }, null)).then(function (result) {
      healBusy = false;
      if (!result || result.ok !== true || !healNum(result.rearmed, 400)) { queueUiRefresh(0); return; }
      healNoteRearm(result);
      queueUiRefresh(0);
      healSerializedResume('re-armed ' + result.rearmed + ' day' + (result.rearmed === 1 ? '' : 's') +
        (result.to ? ' after MLS Assist ' + result.to : ' after an app update'));
    }, function () { healBusy = false; });
  }

  /* ---- the clock (Worker; a hidden tab is still running a pull) ---------- */
  function healClockRunning() { return !!healWorker || healInterval !== null; }
  function healTimerKind() { return healWorker ? 'worker' : (healInterval !== null ? 'interval' : 'none'); }
  function healStartClock() {
    if (healClockRunning()) return;
    healWorkerUrl = safe(function () {
      return window.URL.createObjectURL(new window.Blob(
        ['onmessage=function(e){setInterval(function(){postMessage(1)},e.data)}'],
        { type: 'application/javascript' }));
    }, null);
    if (healWorkerUrl) {
      healWorker = safe(function () {
        var made = new window.Worker(healWorkerUrl);
        made.onmessage = function () { safe(healOnTick); };
        made.postMessage(HEAL_TICK_MS);
        return made;
      }, null);
    }
    if (!healWorker) {
      safe(function () { if (healWorkerUrl) window.URL.revokeObjectURL(healWorkerUrl); });
      healWorkerUrl = null;
      var handle = safe(function () { return setInterval(function () { safe(healOnTick); }, HEAL_TICK_MS); }, null);
      /* a timer handle of 0 is FALSY - compare with !== null, the phone-sync law */
      healInterval = (handle === undefined || handle === null) ? null : handle;
    }
  }
  function healStopClock() {
    safe(function () { if (healWorker) healWorker.terminate(); });
    healWorker = null;
    safe(function () { if (healWorkerUrl) window.URL.revokeObjectURL(healWorkerUrl); });
    healWorkerUrl = null;
    if (healInterval !== null) { safe(function () { clearInterval(healInterval); }); healInterval = null; }
  }
  /* THE hidden-safe property, stated once: whichever clock is running, a tick
     is admitted only when the WALL CLOCK says a full interval has passed. A
     hidden tab that throttles the fallback interval to one tick a minute
     therefore heals LATE - never twice, and never on a burst of catch-up
     ticks when the tab comes back to the front. */
  function healOnTick() {
    var at = now();
    if (healLastTickAt && at - healLastTickAt < HEAL_TICK_MS - 250) return;
    healLastTickAt = at;
    healTick();
  }
  function healKick() {
    if (!installedApi || installedApi.installed !== true) return;
    healIdleTicks = 0;
    if (!healClockRunning() && healEnabled()) healStartClock();
  }
  function healIdle() {
    healIdleTicks++;
    if (healIdleTicks >= HEAL_IDLE_TICKS) healStopClock();
  }
  function healTick() {
    if (!installedApi || installedApi.installed !== true) { healStopClock(); return; }
    if (!healEnabled()) { healStopClock(); queueUiRefresh(0); return; }
    var manifest = safe(state, null);
    if (!manifest) { healLedger = null; healIdle(); return; }
    if (!healLedger || healLedger.jobId !== cleanText(manifest.jobId, 100)) healLedger = healNewLedger(manifest);
    healIdleTicks = 0;
    healLedger.lastHeartbeatAt = now();

    var signature = healSignature(manifest);
    if (signature !== healLedger.sig) { healLedger.sig = signature; healLedger.stallTicks = 0; }
    else healLedger.stallTicks++;

    /* (a) the shape a still-wedging interstitial makes on THIS side. The
       extension presses athena's Continue itself since 3.0.100; this only
       counts, so "did it come back?" is answered from data. */
    var navBlocked = healCountDayReason(manifest, 'nav-failed');
    /* One blocked day is noise; two or more is the shape. Past that threshold
       every blocked day counts once, and only the DELTA is added, so a beat
       that observes the same ledger twice never double-counts. */
    if (navBlocked >= HEAL_NAVFAIL_SUSPECT && navBlocked > healLedger.navSeen) {
      healLedger.interstitials += navBlocked - healLedger.navSeen;
      healLedger.navSeen = navBlocked;
    }
    healLedger.persistFailures = healCountPersistSince(healLedger.startedAt);

    var settled = manifest.status === 'complete' || manifest.status === 'cancelled';
    if (settled || manifest.status === 'needs-attention') healRecordRun(manifest);
    if (settled) { queueUiRefresh(0); healIdle(); return; }
    if (healBusy) return;

    /* (b) the measured transient: metadata-persist-failed, cured by resume. */
    if (manifest.status === 'storage-failed' && reasonCode(manifest.reason) === 'metadata-persist-failed') {
      healSerializedResume('progress could not be verified after saving');
      return;
    }
    /* (c) needs-attention whose attempts were spent under an older extension. */
    if (manifest.status === 'needs-attention') { healVersionHeal(); return; }
    /* (d) a job whose ledger claims it is running while no engine owns it in
       this tab and nothing has moved for two whole intervals. A LIVE engine
       (active) is never interrupted, however slow athena is being. */
    if ((manifest.status === 'running' || manifest.status === 'pending') && !active &&
        healLedger.stallTicks >= HEAL_STALL_TICKS) {
      healSerializedResume('the pull stopped moving');
      return;
    }
    queueUiRefresh(0);
  }

  /* ---- the tracker's copy ------------------------------------------------ */
  function healAgo(stamp) {
    stamp = finiteStamp(stamp);
    if (!stamp) return 'never';
    var seconds = Math.max(0, Math.floor((now() - stamp) / 1000));
    if (seconds < 90) return seconds + 's ago';
    var minutes = Math.floor(seconds / 60);
    return minutes < 90 ? minutes + 'm ago' : Math.floor(minutes / 60) + 'h ago';
  }
  /* A recovery is a CONFIRMED restart. Re-armed days are named separately
     rather than added in, so the count can never overstate what happened. */
  function healWhatItDid(ledger) {
    var parts = [], resumes = healNum(ledger && ledger.resumes, 999);
    var rearmed = healNum(ledger && ledger.rearmedDays, 400);
    if (resumes) parts.push(resumes + ' automatic ' + (resumes === 1 ? 'recovery' : 'recoveries'));
    if (rearmed) parts.push('re-armed ' + rearmed + ' day' + (rearmed === 1 ? '' : 's') + ' after an MLS Assist or app update');
    return parts;
  }
  function healLedgerFor(manifest) {
    if (!manifest) return null;
    return healLedger && healLedger.jobId === cleanText(manifest.jobId, 100) ? healLedger : null;
  }
  /* The one sentence the doctor reads on a finished pull. */
  function healOutcomeCopy(manifest) {
    var ledger = healLedgerFor(manifest);
    if (!ledger) return '';
    var parts = healWhatItDid(ledger);
    if (manifest.status === 'complete') {
      return parts.length ? ' Finished after ' + parts.join(' and ') + '.' : ' Finished clean.';
    }
    if (ledger.bounded) {
      return ' Self-healing stopped after ' + HEAL_RESUME_MAX_PER_HOUR +
        ' automatic recoveries in an hour - this needs a person.';
    }
    if (!parts.length) return ' Self-healing found nothing it could safely fix.';
    return ' Self-healing did ' + parts.join(' and ') + '.';
  }
  function healLineCopy(manifest) {
    if (!healEnabled()) return 'Self-healing is OFF. Pull problems will wait for you.';
    var ledger = healLedgerFor(manifest);
    if (!ledger) return 'Self-healing is on. Watching; nothing to fix.';
    if (ledger.bounded) {
      return 'Self-healing paused - ' + HEAL_RESUME_MAX_PER_HOUR + ' recoveries in an hour is the bound.';
    }
    var parts = healWhatItDid(ledger);
    return 'Self-healing is on - ' + (parts.length ? parts.join(' and ') + ' this run.' : 'no recoveries needed this run.');
  }
  function healNowCopy(manifest) {
    var ledger = healLedgerFor(manifest);
    if (!ledger) return 'This run: nothing recorded yet. Heartbeat ' + healAgo(healLedger && healLedger.lastHeartbeatAt) + '.';
    return 'This run: ' + ledger.stalls + ' stall' + (ledger.stalls === 1 ? '' : 's') + ' detected, ' +
      ledger.resumes + ' automatic resume' + (ledger.resumes === 1 ? '' : 's') + ', ' +
      ledger.rearmedDays + ' day' + (ledger.rearmedDays === 1 ? '' : 's') + ' re-armed, ' +
      ledger.interstitials + ' navigation block' + (ledger.interstitials === 1 ? '' : 's') + ' seen, ' +
      ledger.persistFailures + ' save' + (ledger.persistFailures === 1 ? '' : 's') + ' refused, ' +
      'heartbeat ' + healAgo(ledger.lastHeartbeatAt) + ' (' + healTimerKind() + ' clock).' +
      (ledger.lastAction ? ' Last action: ' + ledger.lastAction + ' (' + healAgo(ledger.lastActionAt) + ').' : '') +
      (ledger.lastRearm && ledger.lastRearm !== ledger.lastAction ? ' Also ' + ledger.lastRearm + '.' : '');
  }
  function healDiagCopy() {
    if (!persistDiag.length) return 'No refused progress saves on this tab.';
    var newest = persistDiag[persistDiag.length - 1];
    return 'Newest refused save: ' + newest.stage + ' on ' + newest.keyShape +
      '; the live key ' + (newest.keyMoved ? 'HAD MOVED to ' + newest.liveShape : 'was the same') +
      (newest.liveKeyMissing ? ' (no account-scoped key at all)' : '') +
      '; ' + newest.scopeFlaps + ' account-scope change' + (newest.scopeFlaps === 1 ? '' : 's') + ' seen; ' +
      'wrote ' + newest.wroteChars + ' chars, read back ' + newest.readChars + '; store ' + newest.storeChars + ' chars.';
  }
  function healHistoryCopy() {
    var rows = healHistory();
    if (!rows.length) return 'No finished pulls recorded yet.';
    var shown = rows.slice(0, 5).map(function (row) {
      var recoveries = row.resumes + (row.rearmedDays ? 1 : 0);
      return row.target + ' ' + row.kind + ': ' + row.outcome.replace(/-/g, ' ') + ' (' +
        row.complete + '/' + row.days + ' days, ' + recoveries + ' auto ' + (recoveries === 1 ? 'recovery' : 'recoveries') +
        (row.needsAttention ? ', ' + row.needsAttention + ' needing attention' : '') + ')';
    });
    return 'Last ' + rows.length + ' run' + (rows.length === 1 ? '' : 's') + ': ' + shown.join('; ') +
      (rows.length > shown.length ? '; ...' : '') + '.';
  }
  function healPanelHtml() {
    return '<details class="p1yr-heal" id="mlsP1HealPanel">' +
      '<summary class="p1yr-healline" id="mlsP1HealLine">Self-healing</summary>' +
      '<div class="p1yr-healbody">' +
      '<p class="p1yr-healrow" id="mlsP1HealNow"></p>' +
      '<p class="p1yr-healrow" id="mlsP1HealHistory"></p>' +
      '<p class="p1yr-healrow" id="mlsP1HealDiag"></p>' +
      '<label class="p1yr-healswitch" for="mlsP1HealSwitch"><input type="checkbox" id="mlsP1HealSwitch">' +
      ' Fix pull problems automatically</label>' +
      '</div></details>';
  }
  function healWirePanel(root) {
    var toggle = root.querySelector('#mlsP1HealSwitch');
    if (!toggle) return;
    toggle.onchange = function () {
      var wanted = toggle.checked === true;
      if (!healSetEnabled(wanted)) { toggle.checked = healEnabled(); uiNotice = 'The self-healing setting could not be saved. Nothing changed.'; }
      queueUiRefresh(0);
    };
  }
  function healRefreshPanel(root, manifest) {
    if (!root) return;
    uiSetText(root.querySelector('#mlsP1HealLine'), healLineCopy(manifest));
    uiSetText(root.querySelector('#mlsP1HealNow'), healNowCopy(manifest));
    uiSetText(root.querySelector('#mlsP1HealHistory'), healHistoryCopy());
    uiSetText(root.querySelector('#mlsP1HealDiag'), healDiagCopy());
    var toggle = root.querySelector('#mlsP1HealSwitch');
    if (toggle) { var on = healEnabled(); if (toggle.checked !== on) toggle.checked = on; }
  }
  /* ===== end pullheal-1.0.0 ===== */

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
    uiNotice = ''; uiFullNotesChoice = false; uiFullNotesInitialized = false; uiYearChoice = ''; uiProvChoice = ''; queueUiRefresh(0);
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
        if (resolveStoredProvider(manifest.provider, frozenScopeForResume(manifest)).ok) {
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
    healStopClock(); healLedger = null; healBusy = false;
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
    asset: '1p-feat_mls_rangejobs.js',
    startYear: function (year, opts) { return start('year', year, opts); },
    startMonth: function (month, opts) { return start('month', month, opts); },
    resume: resume,
    pause: function () { return setControl('paused'); },
    cancel: function () { return setControl('cancelled'); },
    state: state,
    maybeResume: maybeResume,
    /* pullresume-1.0.0: ONE copy table for "what stopped this pull", so the
       Staff Prep month card cannot invent a different sentence than the year
       card for the same reason code. Read-only. */
    reasonCopy: function (reason) { return uiReasonCopy(reason); },
    /* pullheal-1.0.0: the supervisor's own surface. Read-only except for the
       two acts it is allowed - re-arm days an older MLS Assist or an older app
       build failed (attnscope-1.0.0), and
       turn itself off. */
    rearmOutdatedVersions: rearmOutdatedVersions,
    heal: {
      version: HEAL_VERSION,
      tickMs: HEAL_TICK_MS,
      resumeBoundPerHour: HEAL_RESUME_MAX_PER_HOUR,
      enabled: healEnabled,
      setEnabled: healSetEnabled,
      ledger: function () { return copy(healLedger); },
      history: healHistory,
      timerKind: healTimerKind,
      persistDiag: function () { return copy(persistDiag) || []; },
      scopeDiag: function () { return copy({ flaps: scopeWatch.flaps, ring: scopeWatch.ring }); },
      extVersion: currentExtVersion,
      /* the exact sentence the card is showing right now, so a live probe and
         a proof suite read the SAME string the doctor reads. */
      statusLine: function () {
        var manifest = state();
        return uiStatusCopy(manifest, uiProgress(manifest), uiProviderSelection());
      },
      panelLine: function () { return healLineCopy(state()); },
      tick: healOnTick,
      kick: healKick
    },
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
  healKick();
})();

/* =============================================================================
 * MLS Scribe - ATHENA-AS-FACT RECONCILIATION  (reconcile-1.0.0)
 *
 * OWNER DIRECTIVE 2026-09-01 (verbatim): "can we have year and month pulls run
 * in the back groyund and can we have them be smart enought to treat athena as
 * fact and delete any extra appointmets that an old bad extetnion opulled for
 * example and merg all duplicates".
 *
 * WHAT THIS IS
 *   When a month/year pull finishes a day with an AUTHORITATIVE read, athenaOne
 *   has stated the WHOLE truth about that day for that provider scope. Any MLS
 *   appointment row that sits on that day, inside that scope, and was NOT in
 *   athena's answer is stale debris - typically a row an older, buggier
 *   extension minted. This module removes exactly those rows, server-confirmed,
 *   and never anything else.
 *
 *   It also runs the LAWFUL duplicate auto-merge once after a pull settles and
 *   reports what it did, and it owns every post-pull sweep in yielding chunks
 *   so the doctor's tab keeps breathing.
 *
 * ---------------------------------------------------------------------------
 * THE AUTHORITATIVE-DAY RULE (the exact predicate; all of these, fail-closed)
 *
 *   1. __mlsSI is installed and exposes _loadAuthoritativeStore /
 *      authoritativeStatusForDay. No importer -> no reconciliation.
 *   2. _loadAuthoritativeStore() returns ok:true, and this DATE is not in its
 *      quarantined list. A quarantined day owns itself fail-closed.
 *   3. store.days[date] holds a snapshot for THE EXACT REQUESTED SCOPE:
 *        - an "all providers" pull reads entry.all      (snap.mode === "all")
 *        - a selected-provider pull reads entry.providers[providerKey]
 *                                                        (snap.mode === "selected")
 *      A selected request NEVER falls back to entry.all. The importer's own
 *      "provider-from-all" derivation exists for DISPLAY (it borrows an
 *      all-read's membership and filters it); it is membership evidence, not a
 *      scoped read, so it is refused here as "no-snapshot-for-scope".
 *   4. The snapshot is internally consistent: v===1, date===date,
 *      backendIds is an array, backendIds.length === sourceCount.
 *      (publishAuthoritativeSnapshot only writes one when the schedule receipt
 *       was complete:true, the authoritative-empty contract held, the calendar
 *       receipt was complete:true, the provider receipt was complete:true, and
 *       every source row mapped 1:1 onto a unique backend appointment. That is
 *       the "full coverage receipt" - this module never re-derives it.)
 *   5. __mlsSI.authoritativeStatusForDay(date, provider) reports
 *      storeUnavailable !== true, available === true, exact === true and
 *      missingCount === 0 - i.e. every id athena named is present locally, so
 *      the two sides are comparable at all.
 *   6. status.reason is in RECONCILABLE_STATUS ("exact" or
 *      "authoritative-empty"). An authoritative-EMPTY day is the strongest
 *      debris case there is: athena says the day holds nothing.
 *   7. When the caller supplies the day's own pull verdict (opts.dayReason),
 *      it must be in DAY_REASON_ALLOW - a CLOSED allowlist of verdicts that
 *      assert schedule/census completeness. Anything else refuses, INCLUDING
 *      every verdict whose name contains "partial", "nav-failed", "wrong-day",
 *      "no-read", "unverified-day" and "needs-attention".
 *      DELIBERATELY STRICTER THAN NECESSARY: "complete-appointment-census-
 *      history-partial" has a complete appointment census and would be safe on
 *      the merits, but the owner ruling says never reconcile from a partial
 *      day, so it refuses. Re-pull the day and it reconciles on the next pass.
 *   8. For a SCOPED day the provider key must round-trip: the status question
 *      is asked with a NAME the importer re-keys, so providerKey(name) has to
 *      land back on the requested key or the answer would be about a different
 *      scope. It refuses rather than assumes.
 *
 * THE PROVIDER-SCOPE RULE (the exact predicate)
 *   An "all providers" read enumerated the WHOLE day, so it can miss nothing:
 *   every stored row on that date is in scope.
 *   A SCOPED read (one selected provider) only enumerated that provider, so it
 *   is silent about everyone else: a stored row is in scope only when
 *   __mlsSI._providerKey(<row provider name>) === snap.providerKey AND the row
 *   actually carries a provider name. A row with NO provider attribution can
 *   never be proved to belong to the scanned provider, so under a scoped read
 *   it is skipped, never deleted. (Under an ALL read it IS in scope - the read
 *   covered the whole day regardless of who the row names.)
 *
 * NEVER-DELETE RULES (each one is a hard refusal, not a preference)
 *   - a row with no backend id (nothing to delete server-side, nothing to prove)
 *   - a row whose PRACTICE day cannot be proven (tzcarry-1.0.0). The day comes
 *     from appt_date, or from the frozen apptclock-1.0.0 window._calDateOf -
 *     never from a UTC slice of start_at, which puts an evening appointment on
 *     the next day for a browser one zone east. An unprovable day matches no
 *     reconciled date, so such a row is never a candidate at all.
 *   - a row outside the pulled provider scope (rule above)
 *   - a row with LINKED CLINICAL WORK: the row itself names a visit / note /
 *     encounter, or a patient this row plausibly refers to has a stored visit
 *     ON THAT DAY. Deleting such an appointment orphans clinical work, so it is
 *     FLAGGED for review and left exactly where it is. The patient match is
 *     deliberately BROAD (local id, patient_external_id, ledger patientId, or
 *     normalized name): widening protection can only ever keep a row.
 *   - more than config.maxDeletesPerDay stale rows on one day (default 60).
 *     A clinic day does not hold sixty phantom rows; that shape is a bug in
 *     this module or a scope mistake, so the whole day refuses as
 *     "blast-radius" and is reported for review.
 *   - anything at all, when config.dryRun is true (the default until the owner
 *     has seen a real receipt).
 *
 * THE DELETE PATH
 *   DELETE <bkBase()>/api/appointments/<id> with the account bearer token - the
 *   same server-confirmed route calDeleteAppt and cleanupDuplicateAppointments
 *   use. A row counts as removed only when the response is r.ok. _calAppts is a
 *   CACHE and is never edited by hand: after a day's deletes the calendar
 *   mutation epoch is bumped and loadCalendar() re-reads the server, so the
 *   local view can only ever agree with the server record.
 *
 * THE SNAPSHOT (one-click undo)
 *   Before the FIRST delete of a day, every row about to be removed is minted
 *   into the sj-2.1 snapshot home - IndexedDB database mlsB121SnapshotsV1,
 *   object store "snaps", two generations (::1 newest, ::2 previous), exactly
 *   the mint-before-merge pattern feat_mls_b121_pack.js uses. The mint must
 *   CONFIRM (transaction oncomplete) before a single DELETE is issued; a failed
 *   mint refuses the day. __mlsPullReconcile.undo(receiptId) re-creates the
 *   snapshotted rows through POST /api/appointments. Undo is honest about one
 *   thing: a re-created row gets a NEW backend id, because the old one is gone.
 *
 * WHAT THE DOCTOR SEES
 *   One line per reconciled day in the pull log ("2026-08-12: removed 3 stale
 *   rows athena no longer shows; kept 1 for your review"), one completion line
 *   for the sweep ("N duplicates auto-merged, M need your review"), and a
 *   provenance line on the Month report saying how many days were reconciled
 *   and at what cost. A blast-radius refusal says so in red - it needs a human.
 *
 * BACKGROUND-NESS
 *   Every sweep this module owns runs in yielded chunks (see chunkEach) so the
 *   UI thread breathes, and the whole drain waits for the pull lane to be idle.
 *   The DEDICATED RUNNER TAB design and why it is NOT implemented is written
 *   out in full at the bottom of this file.
 *
 * TURNING IT ON
 *   It ships DRY: it plans, receipts and reports, and deletes nothing. After a
 *   receipt has been read on a real day with known debris, the owner arms it
 *   with __mlsPullReconcile.setDryRun(false); setDryRun(true) disarms it again.
 *
 * Additive, reversible: window.__mlsPullReconcile.revert(). ES5 only.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsPullReconcile && window.__mlsPullReconcile.installed) return;

  var VERSION = 'reconcile-1.0.0';
  var QUEUE_SUFFIX = 'mlsReconcileQueueV1';
  var RECEIPTS_SUFFIX = 'mlsReconcileReceiptsV1';
  var SNAP_DB = 'mlsB121SnapshotsV1';   /* sj-2.1's own database - shared home */
  var SNAP_STORE = 'snaps';
  var SNAP_PREFIX = 'mlsReconcileSnap';
  /* how recent a snapshot's own `updated` stamp must be for this module to
     claim it as "the publish that just fired this event" */
  var STAMP_FRESH_MS = 60000;

  /* Only these two importer verdicts mean "athena answered for this whole day
     and every id it named is present locally". Both come from
     authoritativeStatusForDay, which derives them from a PUBLISHED snapshot. */
  var RECONCILABLE_STATUS = { 'exact': 1, 'authoritative-empty': 1 };

  /* A CLOSED allowlist. Read the header: anything containing "partial" is
     absent on purpose, and so is every read-failure verdict. */
  var DAY_REASON_ALLOW = {
    'complete': 1,
    'exact': 1,
    'authoritative-empty': 1,
    'empty-day': 1,
    'provider-empty': 1,
    'complete-schedule-only': 1,
    'complete-appointment-census-only': 1,
    'complete-appointment-census-with-history': 1
  };

  /* Row fields that, when present and non-empty, mean clinical work already
     points at this exact appointment. A CLOSED list on purpose: an open
     "anything that looks like a note" test would drift. */
  var CLINICAL_ROW_FIELDS = ['visit_id', 'visitId', 'note_id', 'noteId', 'mls_visit_id',
    'encounter_id', 'encounterId', 'athena_encounter_id'];

  var CONFIG = {
    /* DRY RUN IS THE SHIPPED DEFAULT. Nothing is deleted until the owner has
       read a real receipt and turned it on with
       __mlsPullReconcile.setDryRun(false). A flag on a destructive lane
       defaults to the safe side. */
    dryRun: true,
    maxDeletesPerDay: 60,
    maxPerSlice: 200,        /* hard item cap per synchronous slice */
    sliceMs: 8,              /* and a time cap, whichever comes first */
    idlePollMs: 15000,
    settleDelayMs: 6000,
    busyRearmMs: 30000,
    mergeCooldownMs: 60000,
    maxReceipts: 120,
    maxQueue: 400
  };

  var stopped = false;
  var listeners = [];
  var pollTimer = null;
  var settleTimer = null;
  var draining = false;
  var yieldCount = 0;
  var lastMergeReport = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(v) { return v == null ? '' : String(v); }
  function digits(v) { return S(v).replace(/\D/g, ''); }
  function normName(v) { return S(v).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function isoDay(v) { var s = S(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
  function isoMonth(v) { var s = S(v).slice(0, 7); return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(s) ? s : ''; }
  function nowMs() { return Date.now(); }
  function key(suffix) { return safe(function () { return isFn(window.uns) ? S(window.uns(suffix)) : ''; }, ''); }
  function si() { return safe(function () { return window.__mlsSI; }, null); }
  function bkBase() { return safe(function () { return isFn(window.bkBase) ? S(window.bkBase()) : ''; }, ''); }
  function bkToken() { return safe(function () { return isFn(window.bkToken) ? S(window.bkToken()) : ''; }, ''); }

  /* ======================================================================
   * (0) THE YIELD PRIMITIVE
   * Two caps, whichever trips first: sliceMs of wall clock, or maxPerSlice
   * items. The ITEM cap is what makes the yielding property provable without
   * depending on a clock - a list longer than maxPerSlice ALWAYS spans more
   * than one turn. Between turns the browser paints, so a 4000-row sweep no
   * longer reads as a frozen tab.
   * ==================================================================== */
  function chunkEach(list, work, opts) {
    opts = opts || {};
    var arr = Array.isArray(list) ? list : [];
    var perSlice = Math.max(1, Number(opts.maxPerSlice || CONFIG.maxPerSlice) || 1);
    var sliceMs = Math.max(1, Number(opts.sliceMs || CONFIG.sliceMs) || 1);
    var i = 0, n = arr.length;
    return new Promise(function (resolve, reject) {
      function step() {
        var started = nowMs(), inSlice = 0;
        try {
          while (i < n) {
            work(arr[i], i);
            i++; inSlice++;
            if (inSlice >= perSlice) break;
            if ((nowMs() - started) >= sliceMs) break;
          }
        } catch (e) { reject(e); return; }
        if (i >= n) { resolve(n); return; }
        yieldCount++;
        setTimeout(step, 0);
      }
      step();
    });
  }

  /* ======================================================================
   * (1) DURABLE STATE - queue + receipts. Both are PHI-FREE: dates, scopes,
   * provider keys, counts and backend row ids only. No names, no DOBs.
   * ==================================================================== */
  function readJson(suffix, fallback) {
    var k = key(suffix); if (!k) return fallback;
    var raw = safe(function () { return localStorage.getItem(k); }, null);
    if (!raw) return fallback;
    var parsed = safe(function () { return JSON.parse(raw); }, null);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  }
  function writeJson(suffix, value) {
    var k = key(suffix); if (!k) return false;
    return safe(function () { localStorage.setItem(k, JSON.stringify(value)); return true; }, false);
  }
  function readQueue() {
    var q = readJson(QUEUE_SUFFIX, null);
    return (q && q.v === 1 && Array.isArray(q.rows)) ? q : { v: 1, rows: [] };
  }
  function writeQueue(q) {
    if (q.rows.length > CONFIG.maxQueue) q.rows = q.rows.slice(q.rows.length - CONFIG.maxQueue);
    return writeJson(QUEUE_SUFFIX, q);
  }
  function readReceipts() {
    var r = readJson(RECEIPTS_SUFFIX, null);
    return (r && r.v === 1 && Array.isArray(r.rows)) ? r : { v: 1, rows: [] };
  }
  function pushReceipt(receipt) {
    var r = readReceipts();
    r.rows.push(receipt);
    while (r.rows.length > CONFIG.maxReceipts) r.rows.shift();
    writeJson(RECEIPTS_SUFFIX, r);
    return receipt;
  }

  /* ======================================================================
   * (2) THE AUTHORITATIVE-DAY GATE + THE SCOPE RULE
   * ==================================================================== */
  function providerKeyOf(name) {
    var api = si();
    if (api && isFn(api._providerKey)) return S(safe(function () { return api._providerKey(name); }, ''));
    /* No importer means no reconciliation at all, so this fallback is only
       ever reached by a harness lifting the scope rule on its own. */
    return normName(name);
  }
  function requestOf(provider) {
    var name = '';
    if (provider && typeof provider === 'object') name = S(provider.name || provider.displayName || provider.provider || '');
    else name = S(provider);
    name = name.replace(/^\s+|\s+$/g, '');
    if (!name || /^all(?:\s+(?:providers?|doctors?))?$/i.test(name)) return { mode: 'all', key: '', name: 'All providers' };
    return { mode: 'selected', key: providerKeyOf(name), name: name };
  }
  function rowProviderName(row) {
    if (!row) return '';
    var fields = ['provider', 'providerName', 'provider_name', 'providerDisplayName',
      'provider_display_name', 'renderingProvider', 'rendering_provider',
      'renderingProviderName', 'rendering_provider_name', 'doctor_name'];
    for (var i = 0; i < fields.length; i++) {
      var v = S(row[fields[i]]).replace(/^\s+|\s+$/g, '');
      if (v) return v;
    }
    return '';
  }
  /* THE PRACTICE'S DAY, NEVER THE BROWSER'S (tzcarry-1.0.0). This value decides
     what gets DELETED, so it comes from the frozen apptclock-1.0.0 derivation
     the shell exposes as window._calDateOf - the exact helper the duplicate
     cleanup was fixed to use after an evening appointment on a laptop one zone
     east landed on the next day. When only start_at exists and that helper is
     unavailable, the row's day CANNOT be proven here, so it is left with no
     day at all: it then matches no reconciled date and is never a candidate.
     A UTC slice of start_at would be a guess, and a guess must not delete. */
  function rowDay(row) {
    if (!row) return '';
    var d = isoDay(row.appt_date) || isoDay(row.day_local) || isoDay(row.date);
    if (d) return d;
    return safe(function () { return isFn(window._calDateOf) ? isoDay(window._calDateOf(row)) : ''; }, '');
  }
  function rowId(row) { return S(row && row.id != null ? row.id : '').replace(/^\s+|\s+$/g, ''); }

  /* THE SCOPE RULE, on its own so it can be executed by a test. */
  function rowInScope(row, snapMode, snapProviderKey) {
    if (snapMode === 'all') return true;
    if (snapMode !== 'selected') return false;          /* derived scopes never reconcile */
    var name = rowProviderName(row);
    if (!name) return false;                            /* unattributed proves nothing */
    return providerKeyOf(name) === S(snapProviderKey);
  }
  function dayReasonAllowed(reason) {
    var r = S(reason).replace(/^\s+|\s+$/g, '');
    if (!r) return true;                                 /* no verdict supplied -> the snapshot gate alone decides */
    return DAY_REASON_ALLOW[r] === 1;
  }

  function snapshotFor(date, request) {
    var api = si();
    if (!api || !isFn(api._loadAuthoritativeStore)) return { ok: false, reason: 'importer-not-ready' };
    var loaded = safe(function () { return api._loadAuthoritativeStore(); }, null);
    if (!loaded || loaded.ok !== true || !loaded.store || !loaded.store.days) {
      return { ok: false, reason: S(loaded && loaded.reason) || 'authority-store-unavailable' };
    }
    var quarantined = loaded.quarantined || [];
    for (var qi = 0; qi < quarantined.length; qi++) {
      if (S(quarantined[qi]) === date) return { ok: false, reason: 'authority-store-invalid' };
    }
    var entry = loaded.store.days[date];
    if (!entry) return { ok: false, reason: 'no-snapshot' };
    var snap = request.mode === 'all'
      ? (entry.all || null)
      : ((entry.providers && entry.providers[request.key]) || null);
    if (!snap) return { ok: false, reason: 'no-snapshot-for-scope' };
    if (snap.mode !== request.mode) return { ok: false, reason: 'scope-mismatch' };
    if (request.mode === 'selected' && S(snap.providerKey) !== S(request.key)) return { ok: false, reason: 'scope-mismatch' };
    if (Number(snap.v) !== 1 || S(snap.date) !== date) return { ok: false, reason: 'snapshot-shape-invalid' };
    if (!Array.isArray(snap.backendIds) || snap.backendIds.length !== Number(snap.sourceCount)) {
      return { ok: false, reason: 'snapshot-shape-invalid' };
    }
    return { ok: true, reason: 'ok', snap: snap };
  }

  /* ======================================================================
   * (3) LINKED CLINICAL WORK - the protection index
   * Built ONCE per drain (chunked), then asked per row. Protection is
   * deliberately broad; a false protect keeps debris, a false delete orphans
   * a note, and only one of those is recoverable by re-pulling.
   * ==================================================================== */
  function getPatients() { return safe(function () { return (isFn(window.getPatients) && window.getPatients()) || []; }, []) || []; }

  function indexOnePatient(p, byId, byName) {
    if (!p || p.id == null) return;
    var pid = S(p.id), nm = normName(p.name), visits = p.visits || [];
    for (var i = 0; i < visits.length; i++) {
      var d = isoDay(visits[i] && visits[i].date);
      if (!d) continue;
      (byId[pid] = byId[pid] || {})[d] = 1;
      if (nm) (byName[nm] = byName[nm] || {})[d] = 1;
    }
    /* the id aliases a row may carry for the same human */
    var aid = digits(p.athenaId || p.mrn);
    if (aid.length >= 5 && byId[pid]) byId['aid:' + aid] = byId[pid];
  }
  /* CHUNKED - what the drain uses, so a 4000-chart store does not freeze the tab. */
  function buildVisitIndex() {
    var byId = {}, byName = {};
    return chunkEach(getPatients(), function (p) { indexOnePatient(p, byId, byName); })
      .then(function () { return { byId: byId, byName: byName }; });
  }
  /* SYNCHRONOUS - only for a direct one-day call from the console or a test,
     where there is no pull to jank and the answer is wanted immediately. */
  function buildVisitIndexSync() {
    var byId = {}, byName = {}, pts = getPatients();
    for (var i = 0; i < pts.length; i++) indexOnePatient(pts[i], byId, byName);
    return { byId: byId, byName: byName };
  }
  /* The calendar bucketed by PRACTICE day, built ONCE per drain in yielded
     chunks. A 31-day month drain used to walk the whole appointment array 31
     times; now it walks it once and every day reads its own bucket. */
  function buildCalendarDayIndex() {
    var cal = safe(function () { return Array.isArray(window._calAppts) ? window._calAppts : []; }, []) || [];
    var byDay = {};
    return chunkEach(cal, function (row) {
      var d = rowDay(row);
      if (!d) return;                       /* an unprovable day is on no day */
      (byDay[d] = byDay[d] || []).push(row);
    }).then(function () { return byDay; });
  }
  function rowsForDay(date, calIndex) {
    if (calIndex) return calIndex[date] || [];
    var cal = safe(function () { return Array.isArray(window._calAppts) ? window._calAppts : []; }, []) || [];
    var out = [];
    for (var i = 0; i < cal.length; i++) if (rowDay(cal[i]) === date) out.push(cal[i]);
    return out;
  }

  /* The importer's own per-day ledger, keyed by athena appointment id, whose
     entries carry {state, patientId, backendAppointmentId, appt_date}. Read
     here ONLY to learn which local patient a backend row belongs to. */
  function ledgerPatientByBackendId(day) {
    return safe(function () {
      var k = key('schedImportIndexV1::' + day);
      if (!k) return {};
      var raw = localStorage.getItem(k);
      if (!raw) return {};
      var rows = (JSON.parse(raw) || {}).rows || {}, out = {};
      Object.keys(rows).forEach(function (rk) {
        var e = rows[rk];
        if (!e || e.state !== 'done') return;
        var b = S(e.backendAppointmentId).replace(/^\s+|\s+$/g, '');
        if (!b || isoDay(e.appt_date) !== day) return;
        if (out[b] === undefined) out[b] = S(e.patientId);
        else if (out[b] !== S(e.patientId)) out[b] = '';   /* ambiguous -> no claim */
      });
      return out;
    }, {}) || {};
  }

  function rowNamesClinicalWork(row) {
    for (var i = 0; i < CLINICAL_ROW_FIELDS.length; i++) {
      if (S(row && row[CLINICAL_ROW_FIELDS[i]]).replace(/^\s+|\s+$/g, '')) return true;
    }
    return false;
  }
  function rowHasClinicalWork(row, day, index, ledgerMap) {
    if (rowNamesClinicalWork(row)) return true;
    if (!index) return true;                       /* no index built -> protect everything */
    var ids = [], i;
    var direct = [row && row.patient_external_id, row && row._mlsTargetPatientId, row && row._patientId];
    for (i = 0; i < direct.length; i++) { var v = S(direct[i]).replace(/^\s+|\s+$/g, ''); if (v) ids.push(v); }
    var fromLedger = ledgerMap ? S(ledgerMap[rowId(row)]) : '';
    if (fromLedger) ids.push(fromLedger);
    var aid = digits(row && (row.athenaId || row.mrn || row.patient_athena_id));
    if (aid.length >= 5) ids.push('aid:' + aid);
    for (i = 0; i < ids.length; i++) {
      var days = index.byId[ids[i]];
      if (days && days[day]) return true;
    }
    var nm = normName(row && row.name);
    if (nm && index.byName[nm] && index.byName[nm][day]) return true;
    return false;
  }

  /* ======================================================================
   * (4) PLAN - reads everything, writes nothing, deletes nothing.
   * ==================================================================== */
  function refuse(date, request, reason, extra) {
    var out = {
      ok: false, reason: reason, date: date, scope: request ? request.mode : '',
      providerKey: request ? request.key : '', stale: [], flagged: [],
      counts: { rowsOnDay: 0, athenaReturned: 0, kept: 0, stale: 0, flaggedLinkedVisit: 0, skippedOutOfScope: 0, skippedNoId: 0 }
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  function plan(rawDate, provider, opts) {
    opts = opts || {};
    var date = isoDay(rawDate);
    /* opts.request carries an ALREADY CANONICAL {mode,key} straight through, so
       a queued day never round-trips its provider key back through a display
       name it may not have. */
    var request = (opts.request && (opts.request.mode === 'all' || opts.request.mode === 'selected'))
      ? { mode: opts.request.mode, key: S(opts.request.key), name: S(opts.request.name || opts.request.key) }
      : requestOf(provider);
    if (!date) return refuse('', request, 'invalid-date');
    if (!dayReasonAllowed(opts.dayReason)) {
      return refuse(date, request, 'day-verdict-not-reconcilable', { dayReason: S(opts.dayReason) });
    }
    var api = si();
    if (!api || api.installed !== true || !isFn(api.authoritativeStatusForDay)) return refuse(date, request, 'importer-not-ready');
    /* The status call below hands the importer a NAME and the importer re-keys
       it. For a queued day that name IS the canonical key, which the importer's
       own providerKey is idempotent on - but proving it beats assuming it: if
       the round trip does not land on the same key, the status answer would be
       about a different scope, so the day refuses instead. */
    if (request.mode === 'selected') {
      if (!request.key) return refuse(date, request, 'provider-key-unavailable');
      if (providerKeyOf(request.name) !== request.key) return refuse(date, request, 'provider-key-roundtrip-failed');
    }
    var got = snapshotFor(date, request);
    if (!got.ok) return refuse(date, request, got.reason);
    var snap = got.snap;

    var status = safe(function () { return api.authoritativeStatusForDay(date, request.mode === 'all' ? '' : request.name); }, null);
    if (!status) return refuse(date, request, 'status-unavailable');
    if (status.storeUnavailable === true) return refuse(date, request, S(status.reason) || 'authority-store-unavailable');
    if (status.available !== true || status.exact !== true || Number(status.missingCount || 0) !== 0) {
      return refuse(date, request, S(status.reason) || 'not-exact');
    }
    if (RECONCILABLE_STATUS[S(status.reason)] !== 1) return refuse(date, request, 'status-not-reconcilable');
    /* A derived membership snapshot reports scope "all" for a SELECTED request.
       Rule 3 already refused it upstream; this is the second, independent
       reading of the same fact. */
    if (request.mode === 'selected' && status.derivedFromAllMembership === true) {
      return refuse(date, request, 'no-snapshot-for-scope');
    }

    var wanted = {}, i;
    for (i = 0; i < snap.backendIds.length; i++) wanted[S(snap.backendIds[i])] = 1;

    var cal = rowsForDay(date, opts.calIndex);
    var index = opts.visitIndex || buildVisitIndexSync();
    var ledgerMap = opts.ledgerMap || ledgerPatientByBackendId(date);

    var out = {
      ok: true, reason: 'ok', date: date, scope: snap.mode, providerKey: S(snap.providerKey),
      athenaIds: snap.backendIds.slice(), stale: [], flagged: [],
      counts: {
        rowsOnDay: 0, athenaReturned: snap.backendIds.length, kept: 0, stale: 0,
        flaggedLinkedVisit: 0, skippedOutOfScope: 0, skippedNoId: 0
      }
    };
    var staleRows = [];
    for (i = 0; i < cal.length; i++) {
      var row = cal[i];
      if (!row || rowDay(row) !== date) continue;   /* re-checked: a bucket is a hint, the day is the rule */
      out.counts.rowsOnDay++;
      var id = rowId(row);
      if (!id) { out.counts.skippedNoId++; continue; }
      if (wanted[id]) { out.counts.kept++; continue; }
      if (!rowInScope(row, snap.mode, snap.providerKey)) { out.counts.skippedOutOfScope++; continue; }
      if (rowHasClinicalWork(row, date, index, ledgerMap)) {
        out.counts.flaggedLinkedVisit++;
        out.flagged.push({ id: id, reason: 'linked-visit-or-note' });
        continue;
      }
      out.counts.stale++;
      out.stale.push(id);
      staleRows.push(row);
    }
    out._staleRows = staleRows;
    if (out.stale.length > CONFIG.maxDeletesPerDay) {
      var blocked = refuse(date, request, 'blast-radius', {
        counts: out.counts, flagged: out.flagged, wouldDelete: out.stale.length,
        maxDeletesPerDay: CONFIG.maxDeletesPerDay
      });
      return blocked;
    }
    return out;
  }

  /* ======================================================================
   * (5) THE sj-2.1 SNAPSHOT - mint before delete, two generations, confirmed
   * ==================================================================== */
  function snapDb() {
    return new Promise(function (resolve, reject) {
      try {
        if (!window.indexedDB) { reject(new Error('idb-unavailable')); return; }
        var rq = window.indexedDB.open(SNAP_DB, 1);
        rq.onupgradeneeded = function () { try { rq.result.createObjectStore(SNAP_STORE); } catch (e) {} };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error || new Error('idb-open-failed')); };
      } catch (e) { reject(e); }
    });
  }
  function snapPut(db, k, v) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = db.transaction(SNAP_STORE, 'readwrite');
        tx.objectStore(SNAP_STORE).put(v, k);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('idb-write-failed')); };
      } catch (e) { reject(e); }
    });
  }
  function snapGet(db, k) {
    return new Promise(function (resolve, reject) {
      try {
        var rq = db.transaction(SNAP_STORE, 'readonly').objectStore(SNAP_STORE).get(k);
        rq.onsuccess = function () { resolve(rq.result || null); };
        rq.onerror = function () { reject(rq.error || new Error('idb-read-failed')); };
      } catch (e) { reject(e); }
    });
  }
  function snapKeyFor(date, scope, providerKey) {
    var base = key(SNAP_PREFIX) || SNAP_PREFIX;
    return base + '::' + date + '::' + (scope === 'selected' ? ('p:' + providerKey) : 'all');
  }
  function mintSnapshot(planned) {
    var base = snapKeyFor(planned.date, planned.scope, planned.providerKey);
    var b1 = base + '::1', b2 = base + '::2';
    var payload = safe(function () {
      return {
        at: new Date().toISOString(), kind: 'appointment-reconcile-v1',
        date: planned.date, scope: planned.scope, providerKey: planned.providerKey,
        ids: planned.stale.slice(),
        raw: JSON.stringify(planned._staleRows || []), plainRows: true
      };
    }, null);
    if (!payload) return Promise.resolve({ ok: false, reason: 'snapshot-serialize-failed', key: '' });
    return snapDb().then(function (db) {
      return snapGet(db, b1).then(function (prev) {
        return (prev ? snapPut(db, b2, prev) : Promise.resolve(true)).then(function () { return snapPut(db, b1, payload); });
      }).then(function () {
        try { db.close(); } catch (e) {}
        return { ok: true, reason: 'minted', key: 'idb:' + b1 };
      });
    }).catch(function (e) {
      return { ok: false, reason: 'snapshot-mint-failed:' + S(e && e.message || e).slice(0, 60), key: '' };
    });
  }

  /* ======================================================================
   * (6) EXECUTE - server-confirmed deletes, one at a time
   * ==================================================================== */
  function deleteAppointment(id) {
    var base = bkBase(), token = bkToken();
    if (!base || !token) return Promise.resolve({ ok: false, reason: 'not-signed-in' });
    return Promise.resolve(safe(function () {
      return fetch(base + '/api/appointments/' + encodeURIComponent(id), {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
      });
    }, null)).then(function (r) {
      return { ok: !!(r && r.ok), reason: r ? ('http-' + r.status) : 'no-response' };
    }, function () { return { ok: false, reason: 'network-error' }; });
  }

  function receiptLine(receipt) {
    if (!receipt || receipt.ok !== true) {
      return receipt && receipt.date
        ? (receipt.date + ': no rows removed (' + S(receipt.reason) + ')')
        : 'no rows removed';
    }
    var n = Number(receipt.counts.deleted || 0);
    var head = receipt.dryRun
      ? (receipt.date + ': ' + Number(receipt.counts.stale || 0) + ' stale row' + (Number(receipt.counts.stale || 0) === 1 ? '' : 's') + ' athena no longer shows (dry run - nothing was deleted)')
      : (receipt.date + ': removed ' + n + ' stale row' + (n === 1 ? '' : 's') + ' athena no longer shows');
    var f = Number(receipt.counts.flaggedLinkedVisit || 0);
    if (f) head += '; kept ' + f + ' for your review (they carry a visit or note)';
    var bad = Number(receipt.counts.failed || 0);
    if (bad) head += '; ' + bad + ' could not be removed on the server';
    return head;
  }

  function pullLog(message, kind) {
    safe(function () {
      var easy = window.__mlsEasyV32;
      if (easy && isFn(easy.pullLog)) easy.pullLog(message, kind);
    });
  }

  function reconcileDay(rawDate, provider, opts) {
    opts = opts || {};
    var planned = plan(rawDate, provider, opts);
    var at = nowMs();
    if (!planned.ok) {
      planned.counts.deleted = 0; planned.counts.failed = 0;
      var refused = {
        id: 'rc_' + S(planned.date || rawDate) + '_' + at, at: at, version: VERSION,
        date: planned.date, scope: planned.scope, providerKey: planned.providerKey,
        ok: false, reason: planned.reason, dryRun: CONFIG.dryRun === true,
        counts: planned.counts, deletedIds: [], flaggedIds: (planned.flagged || []).map(function (f) { return f.id; }),
        failedIds: [], snapshotKey: ''
      };
      if (opts.record !== false) pushReceipt(refused);
      /* Most refusals are ordinary (a day nobody read authoritatively) and are
         not news. A blast-radius refusal IS: MLS found more debris than it is
         willing to remove unattended, and a person has to look. */
      if (refused.reason === 'blast-radius') {
        pullLog(refused.date + ': ' + Number(planned.wouldDelete || 0) +
          ' rows athena no longer shows - more than the ' + CONFIG.maxDeletesPerDay +
          ' this day is allowed to remove unattended, so NONE were removed. Check the day, then re-run.', 'err');
      }
      return Promise.resolve(refused);
    }
    var counts = planned.counts;
    counts.deleted = 0; counts.failed = 0;
    var receipt = {
      id: 'rc_' + planned.date + '_' + at, at: at, version: VERSION,
      date: planned.date, scope: planned.scope, providerKey: planned.providerKey,
      ok: true, reason: 'ok', dryRun: CONFIG.dryRun === true,
      counts: counts, deletedIds: [], flaggedIds: planned.flagged.map(function (f) { return f.id; }),
      failedIds: [], snapshotKey: ''
    };
    if (!planned.stale.length) {
      receipt.reason = 'nothing-stale';
      if (opts.record !== false) pushReceipt(receipt);
      return Promise.resolve(receipt);
    }
    if (CONFIG.dryRun === true) {
      receipt.reason = 'dry-run';
      if (opts.record !== false) pushReceipt(receipt);
      pullLog(receiptLine(receipt));
      return Promise.resolve(receipt);
    }
    /* MINT BEFORE DELETE. A refused mint refuses the day. */
    return mintSnapshot(planned).then(function (minted) {
      if (!minted.ok) {
        receipt.ok = false; receipt.reason = minted.reason;
        if (opts.record !== false) pushReceipt(receipt);
        return receipt;
      }
      receipt.snapshotKey = minted.key;
      var ids = planned.stale.slice(), i = 0;
      function next() {
        if (i >= ids.length) return Promise.resolve();
        var id = ids[i++];
        return deleteAppointment(id).then(function (res) {
          if (res.ok) { receipt.counts.deleted++; receipt.deletedIds.push(id); }
          else { receipt.counts.failed++; receipt.failedIds.push(id); }
          return next();
        });
      }
      return next().then(function () {
        safe(function () { window.__mlsCalendarMutationEpoch = (Number(window.__mlsCalendarMutationEpoch) || 0) + 1; });
        return Promise.resolve(safe(function () { return isFn(window.loadCalendar) ? window.loadCalendar() : null; }, null))
          .then(function () { return null; }, function () { return null; });
      }).then(function () {
        if (receipt.counts.failed > 0 && receipt.counts.deleted === 0) { receipt.ok = false; receipt.reason = 'server-refused'; }
        if (opts.record !== false) pushReceipt(receipt);
        pullLog(receiptLine(receipt), receipt.ok ? 'ok' : 'err');
        return receipt;
      });
    });
  }

  /* ======================================================================
   * (7) UNDO - re-create the snapshotted rows
   * ==================================================================== */
  function undo(receiptId) {
    var rs = readReceipts().rows, target = null, i;
    for (i = rs.length - 1; i >= 0; i--) if (S(rs[i].id) === S(receiptId)) { target = rs[i]; break; }
    if (!target) return Promise.resolve({ ok: false, reason: 'no-such-receipt' });
    if (!target.snapshotKey) return Promise.resolve({ ok: false, reason: 'no-snapshot-for-receipt' });
    var k = S(target.snapshotKey).replace(/^idb:/, '');
    return snapDb().then(function (db) {
      return snapGet(db, k).then(function (got) { try { db.close(); } catch (e) {} return got; });
    }).then(function (got) {
      if (!got || typeof got.raw !== 'string') return { ok: false, reason: 'snapshot-missing' };
      var rows = safe(function () { return JSON.parse(got.raw); }, null);
      if (!Array.isArray(rows)) return { ok: false, reason: 'snapshot-undecodable' };
      var base = bkBase(), token = bkToken();
      if (!base || !token) return { ok: false, reason: 'not-signed-in' };
      var restored = 0, failed = 0, i2 = 0;
      function next() {
        if (i2 >= rows.length) return Promise.resolve();
        var row = rows[i2++];
        /* the same field set the importer's own create uses, so a restored row
           looks like the row that was there - minus the backend id, which the
           server mints fresh */
        var body = {
          name: S(row && row.name), dob: S(row && row.dob), reason: S(row && row.reason),
          provider: S(row && (row.provider || row.provider_name)),
          patient_external_id: (row && row.patient_external_id) || null,
          appt_date: rowDay(row), start_at: row && row.start_at ? S(row.start_at) : null,
          doctor_user_id: (row && row.doctor_user_id) || null, dedupe: true
        };
        var athenaApptId = S(row && (row.athena_appointment_id || row.appointmentId));
        if (athenaApptId) body.athena_appointment_id = athenaApptId;
        return Promise.resolve(safe(function () {
          return fetch(base + '/api/appointments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify(body)
          });
        }, null)).then(function (r) {
          if (r && r.ok) restored++; else failed++;
          return next();
        }, function () { failed++; return next(); });
      }
      return next().then(function () {
        safe(function () { window.__mlsCalendarMutationEpoch = (Number(window.__mlsCalendarMutationEpoch) || 0) + 1; });
        return Promise.resolve(safe(function () { return isFn(window.loadCalendar) ? window.loadCalendar() : null; }, null))
          .then(function () { return null; }, function () { return null; });
      }).then(function () {
        return {
          ok: failed === 0, reason: failed === 0 ? 'restored' : 'partial',
          restored: restored, failed: failed,
          note: 'restored rows carry NEW backend appointment ids - the deleted ids are gone for good'
        };
      });
    }).catch(function (e) { return { ok: false, reason: 'undo-failed:' + S(e && e.message || e).slice(0, 60) }; });
  }

  /* ======================================================================
   * (8) DUPLICATE PATIENTS - the LAWFUL auto-merge, plus an honest count of
   * what the law refuses to merge on its own.
   *
   * THE IDENTITY LAW IS NOT TOUCHED. "Merge all duplicates" means RUN the
   * existing lawful sweep automatically, never loosen it:
   *   auto-merge iff same MRN digits (5+), or same normalized name AND same
   *   DOB digits (6+).  feat_mls_patient_merge.js owns that comparator and it
   *   is the only merger called here. Everything weaker is COUNTED and shown,
   *   never merged.
   * ==================================================================== */
  function lawfullyMergeable(a, b) {
    var am = digits(a.mrn || a.athenaId), bm = digits(b.mrn || b.athenaId);
    if (am.length >= 5 && bm.length >= 5) return am === bm;
    var an = normName(a.name), bn = normName(b.name);
    var ad = digits(a.dob), bd = digits(b.dob);
    return !!(an && an === bn && ad.length >= 6 && bd.length >= 6 && ad === bd);
  }
  /* Groups that LOOK like one human but the law refuses to merge without a
     person looking. Returned as counts + ids only. */
  function reviewCandidates(patients) {
    var pts = Array.isArray(patients) ? patients : getPatients();
    var byName = {}, i, groups = [];
    for (i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p || p.id == null) continue;
      var nm = normName(p.name);
      if (!nm || S(p.name).replace(/^\s+|\s+$/g, '').split(/\s+/).length < 2) continue;
      (byName[nm] = byName[nm] || []).push(p);
    }
    Object.keys(byName).forEach(function (nm) {
      var g = byName[nm];
      if (g.length < 2) return;
      var reasons = {}, any = false;
      for (var a = 0; a < g.length; a++) {
        for (var b = a + 1; b < g.length; b++) {
          if (lawfullyMergeable(g[a], g[b])) continue;   /* the sweep handles it */
          var am = digits(g[a].mrn || g[a].athenaId), bm = digits(g[b].mrn || g[b].athenaId);
          var ad = digits(g[a].dob), bd = digits(g[b].dob);
          var why = 'dob-missing-on-one-side';
          if (am.length >= 5 && bm.length >= 5 && am !== bm) why = 'mrn-conflict';
          else if (ad.length >= 6 && bd.length >= 6 && ad !== bd) why = 'dob-conflict';
          reasons[why] = 1; any = true;
        }
      }
      if (any) groups.push({ ids: g.map(function (x) { return S(x.id); }), reasons: Object.keys(reasons) });
    });
    return groups;
  }

  var lastMergeAt = 0;
  function mergeAfterPull(opts) {
    opts = opts || {};
    var out = { at: nowMs(), merged: 0, movedVisits: 0, needsReview: 0, reason: 'ok', snapshot: '' };
    /* NEVER mid-pull. feat_mls_patient_merge defers itself on the same stamp
       (pm-1.0.1, the "history was not saved" verdict on a pull whose saves all
       verified), so calling it here would only mint a snapshot and print a
       zero. And never twice for one settle. */
    if (opts.force !== true && pullBusy()) { out.reason = 'pull-busy'; return Promise.resolve(out); }
    if (opts.force !== true && opts.ignoreCooldown !== true &&
        lastMergeAt && (nowMs() - lastMergeAt) < CONFIG.mergeCooldownMs) {
      out.reason = 'merged-recently';
      return Promise.resolve(out);
    }
    lastMergeAt = nowMs();
    var pm = safe(function () { return window.__mlsPatientMerge; }, null);
    if (!pm || !isFn(pm.run)) {
      out.reason = 'merge-module-unavailable';
      out.needsReview = reviewCandidates().length;
      lastMergeReport = out;
      return Promise.resolve(out);
    }
    /* Ride the sj-2.1 pre-merge snapshot when the b121 lane offers it. Its
       absence never blocks the lawful merge - that sweep has always been
       reversible through the alias map - but a confirmed mint is strictly
       better, so it is taken when available. */
    var dedup = safe(function () { return window.__mlsDedupById; }, null);
    var mint = (dedup && isFn(dedup.mintSnapshot))
      ? Promise.resolve(safe(function () { return dedup.mintSnapshot(); }, false)).then(function (v) { return v === true; }, function () { return false; })
      : Promise.resolve(false);
    return mint.then(function (minted) {
      out.snapshot = minted ? 'sj-2.1-idb' : 'none';
      var res = safe(function () { return pm.run({ silent: true }); }, null) || {};
      out.merged = Number(res.merged || 0);
      out.movedVisits = Number(res.movedVisits || 0);
      if (res.reason) out.reason = S(res.reason);
      out.needsReview = reviewCandidates().length;
      lastMergeReport = out;
      pullLog(mergeLine(out), 'ok');
      return out;
    });
  }
  function mergeLine(report) {
    var n = Number(report && report.merged || 0), m = Number(report && report.needsReview || 0);
    return n + ' duplicate' + (n === 1 ? '' : 's') + ' auto-merged, ' + m + ' need your review';
  }

  /* ======================================================================
   * (9) THE QUEUE + THE IDLE DRAIN
   * A day is enqueued the moment the importer publishes its authoritative
   * snapshot (the mls-authoritative-schedule event). Nothing is reconciled
   * there and then: a delete issued mid-pull would race the importer's own
   * loadCalendar and the row guard. The queue drains when the pull lane is
   * IDLE, which is also exactly when "after the pull settles" is true.
   * ==================================================================== */
  function pullBusy() {
    return safe(function () {
      var api = si();
      if (api && isFn(api.isBusy) && api.isBusy()) return true;
      var t = Number(window.__mlsPullBusyAt || 0);
      if (t > 0 && (nowMs() - t) < 90000) return true;
      var k = key('mlsPullBusyXTabV1');
      if (k) {
        var xt = Number(localStorage.getItem(k) || 0);
        if (xt > 0 && (nowMs() - xt) < 90000) return true;   /* another tab is pulling */
      }
      /* the durable Month/Year job's own manifest - state() returns the
         manifest itself, not a wrapper. A running range job is a live pull
         even between two days, when every other stamp above has gone quiet. */
      var rj = window.__mlsP1RangeJobs;
      if (rj && isFn(rj.state)) {
        var manifest = safe(function () { return rj.state(); }, null);
        var status = manifest && manifest.status;
        if (status === 'running' || status === 'pending') return true;
      }
      return false;
    }, true);   /* unreadable state counts as busy: never reconcile blind */
  }

  function enqueue(date, scope, providerKey) {
    var d = isoDay(date);
    if (!d) return false;
    var q = readQueue(), i;
    for (i = 0; i < q.rows.length; i++) {
      if (q.rows[i].date === d && q.rows[i].scope === scope && S(q.rows[i].providerKey) === S(providerKey)) {
        q.rows[i].at = nowMs();
        return writeQueue(q);
      }
    }
    q.rows.push({ date: d, scope: S(scope), providerKey: S(providerKey), at: nowMs() });
    return writeQueue(q);
  }

  function drain(opts) {
    opts = opts || {};
    if (stopped) return Promise.resolve({ ran: 0, reason: 'stopped' });
    if (draining) return Promise.resolve({ ran: 0, reason: 'already-draining' });
    if (opts.force !== true && pullBusy()) return Promise.resolve({ ran: 0, reason: 'pull-busy' });
    var q = readQueue();
    if (!q.rows.length) {
      return Promise.resolve({ ran: 0, reason: 'empty' });
    }
    draining = true;
    var pending = q.rows.slice();
    var results = [];
    /* BOTH whole-store walks happen ONCE per drain, in yielded chunks: the
       protection index over every chart, and the calendar bucketed by day.
       A 31-day month then costs one pass each, not thirty-one. */
    return buildVisitIndex().then(function (index) {
      return buildCalendarDayIndex().then(function (calIndex) { return { index: index, calIndex: calIndex }; });
    }).then(function (built) {
      var index = built.index, calIndex = built.calIndex;
      var i = 0;
      function next() {
        if (i >= pending.length) return Promise.resolve();
        var item = pending[i++];
        return Promise.resolve(reconcileDayForQueueItem(item, index, calIndex)).then(function (r) {
          results.push(r);
          return next();
        }, function () { return next(); });
      }
      return next();
    }).then(function () {
      var q2 = readQueue();
      var done = {};
      for (var i = 0; i < pending.length; i++) done[pending[i].date + '|' + pending[i].scope + '|' + pending[i].providerKey] = 1;
      q2.rows = q2.rows.filter(function (r) { return !done[r.date + '|' + r.scope + '|' + r.providerKey]; });
      writeQueue(q2);
      draining = false;
      /* the drain IS the settle, so the sweep runs even if the cooldown from a
         previous bare settle is still warm - one pull, one reported sweep. The
         busy check is NOT waived: a pull that restarted mid-drain still wins. */
      return mergeAfterPull({ ignoreCooldown: true, force: opts.force === true }).then(function (merge) {
        return { ran: results.length, receipts: results, merge: merge, reason: 'ok' };
      });
    }, function (e) {
      draining = false;
      return { ran: results.length, receipts: results, reason: 'drain-failed:' + S(e && e.message || e).slice(0, 60) };
    });
  }

  /* The queue stores the canonical provider KEY, not a display name, so this
     shim hands plan() the canonical request rather than re-deriving a key. */
  function reconcileDayForQueueItem(item, index, calIndex) {
    var request = item.scope === 'selected'
      ? { mode: 'selected', key: S(item.providerKey), name: S(item.providerName || item.providerKey) }
      : { mode: 'all', key: '', name: 'All providers' };
    return reconcileDay(item.date, '', {
      request: request, visitIndex: index, calIndex: calIndex, dayReason: item.dayReason || ''
    });
  }

  /* ======================================================================
   * (10) WIRING
   * ==================================================================== */
  function onAuthoritative(ev) {
    var d = ev && ev.detail;
    if (!d) return;
    var scope = S(d.scope);
    if (scope !== 'all' && scope !== 'selected') return;   /* "cleared-provider-unknown" is not a publish */
    var date = isoDay(d.date);
    if (!date) return;
    var providerKey = '';
    if (scope === 'selected') {
      /* The event carries no key, so read it back off the store the importer
         just wrote. Take the provider snapshot with the NEWEST `updated` stamp
         rather than entry.active: active is overwritten by any later publish
         for the same date (an all-scope publish sets it to {mode:'all'}), and
         a stamp written seconds ago can only be the publish that fired this
         event. Nothing older than STAMP_FRESH_MS is claimed. */
      providerKey = safe(function () {
        var api = si();
        var loaded = api && isFn(api._loadAuthoritativeStore) ? api._loadAuthoritativeStore() : null;
        var entry = loaded && loaded.ok === true && loaded.store && loaded.store.days ? loaded.store.days[date] : null;
        var providers = entry && entry.providers;
        if (!providers) return '';
        var best = '', bestAt = 0, now = nowMs();
        Object.keys(providers).forEach(function (k) {
          var at = Number(providers[k] && providers[k].updated || 0);
          if (at > bestAt && (now - at) <= STAMP_FRESH_MS) { bestAt = at; best = k; }
        });
        return best;
      }, '');
      if (!providerKey) return;
    }
    enqueue(date, scope, providerKey);
    armSettle();
  }
  /* ONE settle = at most one drain and at most one duplicate sweep. Days of a
     month pull arrive minutes apart, so this debounce lands between them; the
     busy check is what keeps it from firing INSIDE the pull, and it re-arms
     instead of giving up so a settle can never be lost. */
  function settleNow() {
    if (stopped) return;
    if (pullBusy()) { armSettle(CONFIG.busyRearmMs); return; }
    var q = readQueue();
    if (q.rows.length) { drain(); return; }   /* drain ends with the sweep */
    mergeAfterPull();
  }
  function armSettle(delayMs) {
    if (stopped) return;
    if (settleTimer != null) safe(function () { clearTimeout(settleTimer); });
    settleTimer = setTimeout(function () {
      settleTimer = null;
      safe(settleNow);
    }, Math.max(0, Number(delayMs == null ? CONFIG.settleDelayMs : delayMs)));
  }
  function onJobProgress(ev) {
    var j = ev && ev.detail;
    if (!j) return;
    if (j.kind !== 'schedule_pull' && j.kind !== 'schedule_history_pull') return;
    if (j.status !== 'completed' && j.status !== 'partial') return;
    armSettle();
  }
  /* A SELF-REARMING TIMEOUT CHAIN, NOT AN INTERVAL. Same safety net - a day
     queued while an event was missed can never be stranded - but an interval
     never stops, and this chain stops the moment revert() clears the pending
     timer. It is also what the boot-script budget's interval ceiling is asking
     for by name. */
  function startPoll() {
    if (stopped || pollTimer != null) return;
    pollTimer = setTimeout(function tick() {
      pollTimer = null;
      safe(function () {
        if (!draining) {
          var q = readQueue();
          if (q.rows.length) drain();
        }
      });
      if (!stopped) pollTimer = setTimeout(tick, CONFIG.idlePollMs);
    }, CONFIG.idlePollMs);
  }
  function addListener(target, type, fn) {
    safe(function () { target.addEventListener(type, fn, false); listeners.push([target, type, fn]); });
  }

  /* ======================================================================
   * (11) SUMMARIES FOR THE SURFACES
   * ==================================================================== */
  function monthSummary(month) {
    var m = isoMonth(month);
    var out = { month: m, days: 0, removed: 0, flagged: 0, refused: 0, dryRunDays: 0, lastAt: 0 };
    if (!m) return out;
    var rows = readReceipts().rows, seen = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || isoMonth(r.date) !== m) continue;
      if (r.ok !== true) { out.refused++; continue; }
      if (!seen[r.date]) { seen[r.date] = 1; out.days++; }
      out.removed += Number((r.counts && r.counts.deleted) || 0);
      out.flagged += Number((r.counts && r.counts.flaggedLinkedVisit) || 0);
      if (r.dryRun === true) out.dryRunDays++;
      if (Number(r.at || 0) > out.lastAt) out.lastAt = Number(r.at || 0);
    }
    return out;
  }

  function revert() {
    stopped = true;
    if (pollTimer != null) { safe(function () { clearTimeout(pollTimer); }); pollTimer = null; }
    if (settleTimer != null) { safe(function () { clearTimeout(settleTimer); }); settleTimer = null; }
    for (var i = 0; i < listeners.length; i++) {
      (function (entry) { safe(function () { entry[0].removeEventListener(entry[1], entry[2], false); }); })(listeners[i]);
    }
    listeners.length = 0;
    safe(function () { delete window.__mlsPullReconcile; });
    return true;
  }

  window.__mlsPullReconcile = {
    installed: true,
    version: VERSION,
    config: CONFIG,
    setDryRun: function (v) { CONFIG.dryRun = v !== false; return CONFIG.dryRun; },
    plan: plan,
    reconcileDay: reconcileDay,
    enqueue: enqueue,
    drain: drain,
    queue: function () { return readQueue().rows.slice(); },
    receipts: function () { return readReceipts().rows.slice(); },
    line: receiptLine,
    mergeLine: mergeLine,
    lastMerge: function () { return lastMergeReport; },
    monthSummary: monthSummary,
    mergeAfterPull: mergeAfterPull,
    reviewCandidates: reviewCandidates,
    undo: undo,
    /* executable seams - pure, so a suite can drive the rules directly */
    _chunkEach: chunkEach,
    _yields: function () { return yieldCount; },
    _rowInScope: rowInScope,
    _dayReasonAllowed: dayReasonAllowed,
    _lawfullyMergeable: lawfullyMergeable,
    _rowHasClinicalWork: rowHasClinicalWork,
    _buildVisitIndex: buildVisitIndex,
    _buildVisitIndexSync: buildVisitIndexSync,
    _buildCalendarDayIndex: buildCalendarDayIndex,
    _pullBusy: pullBusy,
    _snapKeyFor: snapKeyFor,
    _reconcilableStatus: function () { var o = {}; for (var k in RECONCILABLE_STATUS) if (Object.prototype.hasOwnProperty.call(RECONCILABLE_STATUS, k)) o[k] = 1; return o; },
    _dayReasonAllowList: function () { var o = []; for (var k in DAY_REASON_ALLOW) if (Object.prototype.hasOwnProperty.call(DAY_REASON_ALLOW, k)) o.push(k); return o.sort(); },
    revert: revert
  };
  window.__mlsPullReconcile_revert = revert;

  addListener(window, 'mls-authoritative-schedule', onAuthoritative);
  addListener(window, 'mls:job-progress', onJobProgress);
  startPoll();

  /* ===========================================================================
   * THE DEDICATED RUNNER TAB - DESIGNED, MEASURED, AND NOT SHIPPED
   *
   * THE ASK: give the month/year pull its own MLS tab so the doctor's tab is a
   * read-only mirror of progress and never janks.
   *
   * THE DESIGN THAT WOULD WORK
   *   1. The doctor's tab opens a second MLS tab at the same origin carrying
   *      ?mlsRunner=1 and hands over the range manifest key (the durable
   *      p1RangeJobV1 record already survives a reload, so nothing new has to
   *      be serialized).
   *   2. The runner tab claims the engine exactly as any tab does today:
   *      __mlsP1AthenaReadLease.claim("p1-si-managed"), the
   *      navigator.locks "mls-managed-athena-pull" exclusive lock, and the
   *      mlsPullBusyXTabV1 stamp (schedimport runManagedAthenaOperation). The
   *      shield ALREADY makes this safe from the mutual-exclusion angle: a
   *      second engine cannot start while the first holds the lease, and the
   *      b766 pullShieldUntil/pullShieldOwner heartbeat already makes the row
   *      guard's no-removal-during-pull rule store-wide rather than per-tab.
   *   3. The doctor's tab renders progress from the durable manifest plus the
   *      window 'storage' event, which it already listens to
   *      (feat_mls_rangejobs installYearUi), so the mirror is nearly free.
   *
   * WHY IT IS NOT SHIPPED - three measured risks, not opinions
   *   A. A HIDDEN TAB'S TIMERS ARE FROZEN, NOT THROTTLED. Measured on the
   *      owner's own Chrome 2026-07-28: a 1400 ms repeating timer in a tab whose
   *      visibilityState was "hidden" fired ZERO times in 30,058 ms (21
   *      expected). The whole pull is paced by timers - BETWEEN_DAYS_MS waits,
   *      the 25s lease touch, every bounded read deadline, the retry backoffs.
   *      A background runner tab therefore does not run slower; it STOPS, and
   *      it stops while HOLDING the Athena lease and the busy stamp. The
   *      doctor's tab would then refuse its own day pull with "another tab or
   *      device is pulling" for as long as the runner stays hidden. Making the
   *      pull hidden-safe means auditing and re-basing every wait in
   *      1p-feat_mls_schedimport_exact.js onto a visibility-independent clock
   *      (a Worker heartbeat or absolute-deadline polling driven by an
   *      alarm-shaped source). That is a large change to the owner-validated
   *      read path - the opposite of low-risk.
   *   B. ONE APP TAB RUNS ENGINES, EVER (b766). The shield's guarantee is
   *      mutual exclusion, not hand-off: it has no protocol for "tab A stops
   *      owning, tab B starts owning" mid-job. Building one means a lease
   *      TRANSFER, and a transfer that half-lands leaves the job owned by
   *      nobody with the manifest saying "running".
   *   C. THE ATHENA SESSION IS DRIVEN THROUGH ONE athenaOne TAB and the
   *      extension's idle watcher only counts TRUSTED input (~3-minute
   *      logout). A runner tab does not change who is typing, so a hidden
   *      runner still needs the foreground keep-alive - which is exactly the
   *      thing a background tab cannot reliably schedule (see A).
   *
   * WHAT SHIPPED INSTEAD: (a) - every sweep this module owns is chunked and
   * yields (chunkEach), and the whole drain waits for an idle pull lane, so
   * the reconciliation and the duplicate sweep - both of which walk the entire
   * patient store and the entire calendar - can never be the thing that makes
   * the tab look frozen.
   *
   * WHAT A FOLLOW-UP TRAIN WOULD HAVE TO MEASURE FIRST (in this order):
   *   1. Instrument the day loop: record every synchronous stretch over 50 ms
   *      during one real month pull, attributed to a named call site. The two
   *      suspects already read from the source are (i) the per-patient
   *      upsertPatient store serialization in saveOrganizedHistory's capture
   *      path, which stringifies the WHOLE roster once per chart, and (ii) the
   *      per-day display tail (renderCalendar + renderCalCheckin + refreshEasy
   *      plus three re-stamp timers at 700/1800/3500 ms).
   *   2. Only then decide between chunking those two and building the runner
   *      tab. If (i) dominates, a write-behind for the roster removes far more
   *      jank than a second tab would, at a fraction of the risk.
   *   3. A runner tab is worth building only once every wait in the read path
   *      is proven hidden-safe. Prove that with the same instrument as (1),
   *      with the runner tab hidden for the whole run.
   * ========================================================================= */
})();

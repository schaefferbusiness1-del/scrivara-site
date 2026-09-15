'use strict';
/* ============================================================================
   vpp-1.0.0 + refusal-durable-1.0.0 - the two ways the pull receipt lied.

   [3] THE CENSUS COUNTED ROWS, NOT PATIENTS.  historyVerdictCensus judged every
   ENTRY and ran over rows AND unresolved, and those two lists carry the SAME
   patient ids whenever the census rebuilds targets for rows the import left
   unresolved.  Live run rmtwzx6cr: historyVerdicts {requested:40, succeeded:20,
   failed:20, closed:true} for a TWENTY-patient day whose own engine state,
   stamped 1.6 s earlier, said {total:20, ok:18, failed:2}.  closed:true then
   certified the inflated census as self-consistent and the doctor was told
   "20 failed" about a day that ended 18/20.
   The verdict is now per DISTINCT patient: one judgement per id, the second
   sighting counted as a duplicate ROW, and closed asserts the DENOMINATOR
   (requested === distinct === perPatient.length) as well as the sum - so the
   flag is a proof instead of a restatement of its own arithmetic.

   [4] REFUSALS DIED WITH THE PULL.  All 27 schedImportIndexV1 day keys read 350
   entries with a state tally of exactly {done:350}; no key matching /attention/i
   existed at all.  Every refusal lived in window.__mlsPullLastOutcome, which is
   in memory and is overwritten by the next pull, so a day could never be proven
   complete after a reload.  A terminal failure is now written into the SAME day
   key as its own row (reserved "att::" prefix, so an appointment-import row can
   never be confused with it) carrying state, the exact code, the attempt count
   and the retry-skipped reason; the needs-attention queue is a SCAN of those
   rows across days, and the one-click Retry re-reads ONLY those rows.

   Executed, not grepped: the census runs on fixtures, and the ledger is written
   in one context and read back in a FRESH one over the same account storage -
   which is what "survives a reload" has to mean.
   ========================================================================== */

/* harness hygiene 2026-09-15: the loaded module arms real timeouts (deferred retries, resume offers); un-ref'd they kept node alive after PASS, so run-all saw a hang, never a verdict. */
const unrefTimeout = (fn, ms) => { const t = setTimeout(fn, ms); if (t && typeof t.unref === 'function') t.unref(); return t; };
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const LANE = '1p-feat_mls_schedimport_exact.js';
const source = fs.readFileSync(path.join(root, LANE), 'utf8');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

/* ---- one account store, many contexts ----------------------------------- */
function boot(store, patients, sourceOverride) {
  const listeners = new Set();
  const context = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
    encodeURIComponent, queueMicrotask,
    setTimeout: unrefTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    location: { pathname: '/ScribeFlow-staging.html' },
    localStorage: {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => store.set(String(k), String(v)),
      removeItem: (k) => store.delete(String(k))
    },
    document: {
      readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
      getElementById: () => null, addEventListener: () => {}, body: {}, head: {}, documentElement: {}
    },
    backendMode: () => false,
    bkToken: () => '',
    bkBase: () => 'https://local.invalid',
    uns: (key) => 'sf_u::doctor@example.test::' + key,
    _normDate: (v) => String(v || '').slice(0, 10),
    _normTime: () => '',
    _acctWallToUtcIso: (d, t) => d + 'T' + t + ':00.000Z',
    getPatients: () => patients,
    upsertPatient: (p) => {
      const i = patients.findIndex((x) => x && x.id === p.id);
      if (i >= 0) patients[i] = p; else patients.push(p);
    },
    loadCalendar: () => Promise.resolve(),
    renderHistory: () => {}, loadPatients: () => {},
    _calAppts: [],
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ appointments: [] }) })
  };
  context.window = context;
  context.addEventListener = (_t, fn) => listeners.add(fn);
  context.removeEventListener = (_t, fn) => listeners.delete(fn);
  context.postMessage = () => {};
  vm.runInNewContext(sourceOverride || source, context, { filename: LANE, timeout: 4000 });
  ok(context.__mlsSI, 'the schedule importer did not publish __mlsSI');
  return context;
}

/* ========================================================================= */
/* [3] verdict-per-patient                                                   */
/* ========================================================================= */
function censusPins(api) {
  const census = api._historyVerdictCensus;
  ok(typeof census === 'function', '_historyVerdictCensus is not exported - the census cannot be executed');

  /* THE MEASURED SHAPE: 20 rows, the SAME 20 ids echoed in unresolved, and a
     receipt that ended 18 complete / 2 requeued. */
  const ids = [];
  for (let i = 1; i <= 20; i++) ids.push('pt-' + i);
  const rows = ids.map((id) => ({ _mlsTargetPatientId: id }));
  const unresolved = ids.map((id) => ({ patientId: id, reason: 'identity-target-unresolved' }));
  const receipt = {
    patients: ids.map((id, i) => ({ patientId: id, complete: i < 18, reason: i < 18 ? '' : 'open-failed' })),
    retry: ids.slice(18).map((id) => ({ patientId: id, reason: 'open-failed' }))
  };

  const out = census(rows, unresolved, receipt);
  eq(out.requested, 20, 'requested is not the number of DISTINCT patients (the 40-for-20 inflation is back)');
  eq(out.distinct, 20, 'distinct disagrees with the id set');
  eq(out.duplicates, 20, 'the 20 duplicate rows were not counted as duplicates');
  eq(out.succeeded, 18, 'succeeded is not the 18 the engine measured');
  eq(out.failed, 2, 'failed is not the true remainder');
  eq(out.notAttempted, 0, 'a de-duplicated row was counted as not-attempted');
  eq(out.perPatient.length, 20, 'one verdict per distinct patient is not what was emitted');
  eq(out.closed, true, 'the census did not close on the corrected denominator');
  eq(out.succeeded + out.failed + out.omitted + out.notAttempted + out.unaccounted, out.requested,
    'the closed arithmetic does not actually close');

  /* a pid-less row cannot be de-duplicated and must keep its own verdict */
  const blanks = census(
    [{}, {}],
    [],
    { patients: [{ complete: true }], retry: [{ reason: 'stopped-by-user' }] }
  );
  eq(blanks.requested, 2, 'pid-less rows lost their individual verdicts');
  eq(blanks.distinct, 2, 'pid-less rows are missing from distinct');
  eq(blanks.duplicates, 0, 'a pid-less row was silently folded into another');
  eq(blanks.closed, true, 'the pid-less census did not close');

  /* the honest no-overlap day is unchanged */
  const clean = census(
    [{ _mlsTargetPatientId: 'a' }, { _mlsTargetPatientId: 'b' }],
    [{ patientId: 'c', reason: 'stopped-by-user' }],
    { patients: [{ patientId: 'a', complete: true }, { patientId: 'b', complete: true }], retry: [{ patientId: 'c', reason: 'stopped-by-user' }] }
  );
  eq(clean.requested, 3, 'a day with no overlap changed its denominator');
  eq(clean.duplicates, 0, 'a day with no overlap reported duplicates');
  eq(clean.succeeded, 2, 'a day with no overlap lost a success');
  eq(clean.notAttempted, 1, 'a stopped row is no longer not-attempted');
  eq(clean.closed, true, 'a day with no overlap stopped closing');
}

/* ========================================================================= */
/* [4] durable refusals, the queue, and the one-click retry                  */
/* ========================================================================= */
const DAY = '2026-09-11';

function codePins(api) {
  eq(api._attentionCode('open-failed: Open your signed-in athenaOne tab. Nothing was read.'), 'open-failed',
    'the exact code did not survive the prose after it');
  eq(api._attentionCode('dob-mismatch'), 'dob-mismatch', 'a bare code was rewritten');
  eq(api._attentionCode('schedule-incomplete'), 'schedule-incomplete', 'a bare code was rewritten');
  eq(api._attentionCode(''), 'unspecified', 'an empty reason did not fail closed to a named code');
  eq(api._attentionCode('   '), 'unspecified', 'a blank reason did not fail closed to a named code');
  eq(api._attentionCode('chart-read-deadline-exceeded'), 'chart-read-deadline-exceeded',
    "the importer's own transient vocabulary is no longer recognised");
  /* THE CLOSED PIN. The ledger is PHI-free by contract, and a reason that is
     prose rather than a code is exactly where a patient name travels. */
  eq(api._attentionCode('Ada Sample could not be opened'), 'other',
    'a prose reason leaked a name fragment into the PHI-free ledger');
  eq(api._attentionCode('Sample-Ada refused'), 'other',
    'a hyphenated name shape was accepted as a code');
  eq(api._attentionCode('athena said no'), 'other', 'an unknown word was accepted as a code');
  ok(api._attentionCode('open-failed: ' + 'x'.repeat(200)).length <= 40, 'the code is unbounded');
}

function ledgerPins(store, patients) {
  const ctx = boot(store, patients);
  const api = ctx.__mlsSI;
  ok(typeof api.attentionQueue === 'function', 'attentionQueue is not exported');
  ok(typeof api.retryAttention === 'function', 'the one-click retry is not exported');

  eq(api.attentionQueue().count, 0, 'the attention queue is not empty on a clean account');

  /* a day where every chart landed writes NO attention rows at all */
  const cleanWrote = api._recordAttentionFromReceipt(DAY, {
    requestId: 'run-clean',
    patients: [{ patientId: 'pt-1', complete: true }, { patientId: 'pt-2', complete: true }], retry: []
  });
  eq(cleanWrote, 0, 'a perfect day wrote attention rows - the ledger must cost only what it refuses');
  eq(api.attentionQueue().count, 0, 'a perfect day put rows in the needs-attention queue');

  /* now force one chart refusal plus one row the retry budget suppressed */
  const refusalReceipt = {
    requestId: 'run-1',
    sweepBudgetExhausted: true,
    patients: [
      { patientId: 'pt-1', complete: true },
      { patientId: 'pt-2', complete: false, reason: 'open-failed: Open your signed-in athenaOne tab.', recheckSkipped: 'out-of-time' }
    ],
    retry: [
      { patientId: 'pt-2', reason: 'open-failed: Open your signed-in athenaOne tab.' },
      { patientId: 'pt-3', reason: 'dob-mismatch' }
    ]
  };
  const wrote = api._recordAttentionFromReceipt(DAY, refusalReceipt);
  ok(wrote >= 2, 'the refusals were not written into the day ledger');
  /* finalizeVerdict settles more than once per pull by design: a re-settle of
     the SAME run must not turn bookkeeping into a second attempt. */
  api._recordAttentionFromReceipt(DAY, refusalReceipt);

  /* the RAW day key must hold it, or nothing survives a reload */
  const raw = store.get('sf_u::doctor@example.test::schedImportIndexV1::' + DAY);
  ok(raw, 'the day key does not exist after a refusal');
  const parsed = JSON.parse(raw);
  const refusedRows = Object.keys(parsed.rows || {}).filter((k) => parsed.rows[k] && parsed.rows[k].state === 'refused');
  eq(refusedRows.length, 2, 'the day key does not hold exactly the two refused rows');
  const one = parsed.rows['att::pt-2'];
  ok(one, 'the refused row is not keyed by the patient under the reserved prefix');
  eq(one.state, 'refused', "the row state is not 'refused'");
  eq(one.code, 'open-failed', 'the row lost its exact code');
  eq(one.attempts, 1, 'a re-settle of the same run inflated the attempt count');
  eq(one.retrySkipped, 'out-of-time', 'the row does not say the retry budget suppressed it');
  eq(parsed.rows['att::pt-3'].code, 'dob-mismatch', 'a retry-only refusal lost its code');
  eq(parsed.rows['att::pt-1'], undefined, 'a chart that landed was given an attention row anyway');
  return ctx;
}

function reloadPins(store, patients) {
  /* A COMPLETELY FRESH CONTEXT over the same account storage: this is the
     reload the in-memory receipt could not survive. */
  const ctx = boot(store, patients);
  const api = ctx.__mlsSI;
  const queue = api.attentionQueue();
  eq(queue.count, 2, 'the needs-attention queue did not survive the reload');
  eq(queue.days.join(','), DAY, 'the queue lost the day the refusals belong to');
  eq(queue.codes['open-failed'], 1, 'the queue lost the open-failed code');
  eq(queue.codes['dob-mismatch'], 1, 'the queue lost the dob-mismatch code');
  const row = queue.rows.filter((r) => r.patientId === 'pt-2')[0];
  ok(row, 'the refused patient is not listed in the queue');
  eq(row.state, 'refused', 'the queue row is not refused');
  eq(row.code, 'open-failed', 'the queue row lost its code');
  eq(row.retrySkipped, 'out-of-time', 'the queue row lost its retry-skipped reason');

  /* the one-click Retry re-reads ONLY those rows */
  const entries = api._attentionRetryEntries(DAY);
  eq(entries.length, 2, 'the one-click retry does not target exactly the attention rows');
  eq(entries.map((e) => e.patientId).sort().join(','), 'pt-2,pt-3', 'the retry targeted the wrong rows');
  eq(entries[0].scheduleDate, DAY, 'the retry entry lost the day it belongs to');
  const pt2 = entries.filter((e) => e.patientId === 'pt-2')[0];
  eq(pt2.frozenDob, '19800514', 'the retry entry could not re-derive the stored identity proof');
  const pt3 = entries.filter((e) => e.patientId === 'pt-3')[0];
  eq(pt3.frozenDob, '', 'a record with no stored DOB manufactured a proof');
  eq(pt3.frozenMrn, '', 'a record with no stored MRN manufactured a proof');

  /* and a day with nothing to retry answers without starting a pull */
  return api.retryAttention('2026-09-14').then((r) => {
    eq(r.reason, 'nothing-to-retry', 'a clean day did not answer nothing-to-retry');
    eq(r.requested, 0, 'a clean day claimed work');
  });
}

function settlePins(store, patients) {
  /* the same patient landing on a later pass settles its OWN row to done */
  const ctx = boot(store, patients);
  const api = ctx.__mlsSI;
  api._recordAttentionFromReceipt(DAY, {
    requestId: 'run-2',
    patients: [{ patientId: 'pt-2', complete: true }], retry: []
  });
  const parsed = JSON.parse(store.get('sf_u::doctor@example.test::schedImportIndexV1::' + DAY));
  eq(parsed.rows['att::pt-2'].state, 'done', 'a recovered chart did not settle its attention row');
  eq(parsed.rows['att::pt-2'].attempts, 2, 'the recovered row lost its first-attempt evidence');
  const queue = api.attentionQueue();
  eq(queue.count, 1, 'the recovered row did not leave the needs-attention queue');
  eq(queue.rows[0].patientId, 'pt-3', 'the wrong row is still in the queue');
}

/* ========================================================================= */
/* [4b] THE LIVE SHAPE OF A DOB VETO (fdx-1.2.0 + refusal-durable-1.0.1)      */
/* =========================================================================
   MEASURED 2026-09-11. The extension's DOB veto answers
     { ok:false, opened:false, candidates:1, error:<English prose>,
       findReason:'dob-mismatch' }
   - no `code`, no `reason`. fdxRowReason promoted only fd.code||fd.reason, so
   the row's reason became the extension's SENTENCE (which names the patient),
   and attentionCode fell closed to 'other'. The old pin here asserted
   attentionCode('dob-mismatch') on a bare code: a SPELLING, not the live
   shape, so it was green while the ledger was wrong. This replaces it with
   the shape the extension actually sends.                                    */
const LIVE_DOB_VETO_PROSE =
  'athenaOne has 1 name match(es) for Eve Sample but none with the date of birth on this appointment. Nothing was opened.';
const LIVE_DOB_VETO_DIAG = { ok: false, opened: false, candidates: 1, error: LIVE_DOB_VETO_PROSE, findReason: 'dob-mismatch' };

function liveFindShapePins() {
  /* its OWN account store, so the reload/settle pins above keep counting
     exactly the rows they wrote */
  const store = new Map();
  const patients = [{ id: 'pt-9', name: 'Eve Sample', dob: '', mrn: '' }];
  const api = boot(store, patients).__mlsSI;
  ok(typeof api._fdxRowReason === 'function', '_fdxRowReason is not exported - the live shape cannot be executed');

  /* THE ROUTING KEY IS DELIBERATELY UNTOUCHED. one.reason is not a label: it
     is what SWEEPABLE_REASON and nrh-1.0.0's NRH_CODE streak match on.
     MEASURED on this tree: promote fd.findReason here and four consecutive
     no-results rows halt a twenty-row day after four charts. So the row still
     falls back to the extension's sentence, and the ledger is fixed on the
     side that is only ever a label. */
  eq(api._fdxRowReason({ findDiag: LIVE_DOB_VETO_DIAG }), '',
    'the row reason now promotes findReason - that is the pull routing key, and it halts a live day after four rows');
  eq(api._fdxRowReason({ findDiag: { findReason: 'no-results' } }), '',
    "a no-results find verdict reached nrh-1.0.0's halt streak");
  /* the two fields that always worked still win, in order */
  eq(api._fdxRowReason({ findDiag: { code: 'wrong-chart', findReason: 'dob-mismatch' } }), 'wrong-chart',
    'fd.code lost its precedence');
  eq(api._fdxRowReason({ findDiag: { reason: 'no-candidates', findReason: 'dob-mismatch' } }), 'no-candidates',
    'fd.reason lost its precedence');
  eq(api._fdxRowReason({}), '', 'a row with no find verdict invented one');

  /* and the DURABLE ledger row for that chart must carry the code */
  const DAY2 = '2026-09-14';
  api._recordAttentionFromReceipt(DAY2, {
    requestId: 'run-dobveto',
    patients: [{ patientId: 'pt-9', complete: false, reason: LIVE_DOB_VETO_PROSE, findDiag: LIVE_DOB_VETO_DIAG }],
    retry: []
  });
  const parsed = JSON.parse(store.get('sf_u::doctor@example.test::schedImportIndexV1::' + DAY2));
  const row = parsed.rows['att::pt-9'];
  ok(row, 'the DOB veto wrote no attention row at all');
  eq(row.state, 'refused', 'the DOB veto row is not refused');
  eq(row.code, 'dob-mismatch', "the durable ledger still records a wrong birthday as 'other'");
  eq(JSON.stringify(parsed).indexOf('Eve'), -1, 'the PHI-free ledger swallowed a patient NAME');

  /* the retry-entry shape carries the same verdict under diag.find */
  api._recordAttentionFromReceipt(DAY2, {
    requestId: 'run-dobveto-2',
    patients: [],
    retry: [{ patientId: 'pt-10', reason: LIVE_DOB_VETO_PROSE, diag: { find: LIVE_DOB_VETO_DIAG } }]
  });
  const parsed2 = JSON.parse(store.get('sf_u::doctor@example.test::schedImportIndexV1::' + DAY2));
  eq(parsed2.rows['att::pt-10'].code, 'dob-mismatch', 'a retry entry lost the find verdict it was carrying');

  /* THE CONTROL that makes the pin above causal: the PROSE on its own still
     classifies to 'other' (it must - it is where a patient name travels), so
     the only thing that can have produced 'dob-mismatch' is the extension's
     own machine verdict being read. */
  eq(api._attentionCode(LIVE_DOB_VETO_PROSE), 'other',
    'the prose classified itself - the ledger code above proves nothing');

  /* THE CONTROL: a row whose reason classifies on its own never consults the
     find verdict, and a row with neither still fails closed to a code. */
  eq(api._attentionCodeFor('open-failed: Open your signed-in athenaOne tab.', { findReason: 'dob-mismatch' }), 'open-failed',
    'a row with a real code was overridden by its find verdict');
  eq(api._attentionCodeFor('athena said no', {}), 'other', 'an unknown reason stopped failing closed');
  eq(api._attentionCodeFor('', null), 'unspecified', 'an empty reason stopped failing closed');
}

/* ========================================================================= */
/* [3b] THE OUTCOME THE DOCTOR WAS SHOWN IS THE OUTCOME (oown-1.0.0)          */
/* =========================================================================
   MEASURED 2026-09-11, twice, both through runManagedAthenaOperation's settle:
   (a) the automatic convergence round settles through the SAME wrapper, and
       its receipt covers only the retried SUBSET, so __mlsPullLastOutcome
       ended as {reason:'history-partial', counts:{requested:2}} with the day's
       corrected historyVerdicts absent - 3.6s after the strip stamped them;
   (b) after the day strip had already written this attempt's terminal (its
       no-settle ceiling, or a session boundary), the settle arriving 15s later
       re-owned the receipt the doctor was reading.                            */
function outcomeOwnershipPins(ctx) {
  const api = ctx.__mlsSI;
  ok(typeof api._stampManagedOutcome === 'function', '_stampManagedOutcome is not exported');

  const DAY_CENSUS = { requested: 20, succeeded: 18, failed: 2, distinct: 20, duplicates: 0, closed: true };
  function dayOutcome() {
    return {
      ok: false, complete: false, reason: 'history-partial', at: Date.now() - 4000,
      historyVerdicts: JSON.parse(JSON.stringify(DAY_CENSUS)),
      counts: { requested: 20, processed: 20, failures: 2 }
    };
  }
  const RETRY_RECEIPT = { complete: false, failures: 2, reason: 'history-partial', requested: 2, processed: 2 };

  /* (a) the subset round reports itself and leaves the day alone ---------- */
  ctx.window.__mlsPullOutcomeFenceV1 = null;
  ctx.window.__mlsPullLastOutcome = dayOutcome();
  eq(api._stampManagedOutcome(RETRY_RECEIPT, 'history-retry', Date.now()), true,
    'the subset round refused to record itself at all');
  const after = ctx.window.__mlsPullLastOutcome;
  eq(after.reason, 'history-partial', "the day's own reason was replaced by the round's");
  ok(after.historyVerdicts, 'THE MEASURED DEFECT: the convergence round erased the day census');
  eq(after.historyVerdicts.requested, 20, 'the day census denominator was replaced by the round size');
  eq(after.historyVerdicts.succeeded, 18, 'the day census lost its successes');
  eq(after.counts.requested, 20, "the day's counts were replaced by the round's two rows");
  ok(after.lastRound, 'the round vanished entirely - it must still be reportable');
  eq(after.lastRound.lane, 'history-retry', 'the round does not name its lane');
  eq(after.lastRound.counts.requested, 2, 'the round lost its own count');

  /* a subset round with NO day census behind it stamps exactly as before */
  ctx.window.__mlsPullLastOutcome = { ok: true, at: Date.now() };
  api._stampManagedOutcome(RETRY_RECEIPT, 'history-retry', Date.now());
  eq(ctx.window.__mlsPullLastOutcome.reason, 'history-partial',
    'a round with no day verdict behind it was silently suppressed');

  /* an INTERIM stamp is not a day verdict and may not be preserved */
  ctx.window.__mlsPullLastOutcome = { ok: false, interim: true, phase: 'converging', historyVerdicts: DAY_CENSUS };
  api._stampManagedOutcome(RETRY_RECEIPT, 'history-retry', Date.now());
  eq(ctx.window.__mlsPullLastOutcome.interim, undefined, 'an interim stamp outlived the round it was covering');

  /* the DAY pull itself always owns the surface */
  ctx.window.__mlsPullLastOutcome = dayOutcome();
  api._stampManagedOutcome({ ok: true, complete: true, failures: 0 }, 'day-pull', Date.now());
  eq(ctx.window.__mlsPullLastOutcome.ok, true, "a day pull could not write its own verdict");
  eq(ctx.window.__mlsPullLastOutcome.lastRound, undefined, 'a day pull filed itself as a subset round');

  /* (b) the fence --------------------------------------------------------- */
  const started = Date.now();
  ctx.window.__mlsPullLastOutcome = { ok: false, complete: false, reason: 'aborted-session-boundary', at: started + 10 };
  ctx.window.__mlsPullLateSettleV1 = null;
  ctx.window.__mlsPullOutcomeFenceV1 = { at: started + 5, reason: 'aborted-session-boundary', target: '2026-09-11' };
  eq(api._stampManagedOutcome(RETRY_RECEIPT, 'day-pull', started), false,
    'the fenced settle still claimed the machine outcome');
  eq(ctx.window.__mlsPullLastOutcome.reason, 'aborted-session-boundary',
    'THE MEASURED DEFECT: a late engine answer re-owned the receipt the doctor was shown');
  ok(ctx.window.__mlsPullLateSettleV1, 'the late answer was not recorded anywhere');
  eq(ctx.window.__mlsPullLateSettleV1.fencedBy, 'aborted-session-boundary', 'the late record does not name what fenced it');
  eq(ctx.window.__mlsPullLateSettleV1.reason, 'history-partial', 'the late record lost the answer it was carrying');

  /* a fence raised BEFORE this operation started belongs to an earlier
     attempt and may never silence the run the doctor is watching now */
  ctx.window.__mlsPullOutcomeFenceV1 = { at: started - 60000, reason: 'engine-no-settle', target: '2026-09-10' };
  ctx.window.__mlsPullLastOutcome = { ok: false, reason: 'stale', at: started };
  eq(api._stampManagedOutcome({ ok: true, complete: true, failures: 0 }, 'day-pull', started), true,
    "a PREVIOUS attempt's fence silenced the next pull");
  eq(ctx.window.__mlsPullLastOutcome.ok, true, 'the next pull could not write its own verdict');
  eq(api._pullOutcomeFence(started), null, 'a stale fence is still being honoured');

  /* AND the fence is retired by the next operation outright, not only by the
     clock: pullRunning is what stops a second managed operation from
     starting, so reaching the start gate proves the fenced one has settled.
     Two runs starting in the same millisecond as an abort must not silence
     the second one. */
  ctx.window.__mlsPullOutcomeFenceV1 = { at: Date.now(), reason: 'aborted-session-boundary', target: '2026-09-11' };
  /* a retry with one entry is the smallest thing that actually enters
     runManagedAthenaOperation; it refuses for want of an extension, which is
     fine - the pin is that the START retired the fence. */
  return Promise.resolve(api.retryFailedHistory({
    requestId: 'fence-probe', day: '2026-09-11', complete: false, failures: 1, patients: [],
    retry: [{ patientId: 'pt-2', reason: 'open-failed', frozenDob: '19800514', frozenMrn: '', scheduleDate: '2026-09-11' }]
  })).catch(function () { return null; }).then(function () {
    eq(ctx.window.__mlsPullOutcomeFenceV1, null,
      'a standing fence survived the start of the next operation - a same-millisecond abort can still silence a live run');
  });
}


/* ========================================================================= */
/* POSITIVE CONTROLS: the cure REMOVED must reproduce the measured defect     */
/* =========================================================================
   A suite that only ever sees the fixed bytes cannot tell a cure from a
   coincidence. Each control strips ONE line of one cure out of the shipped
   source, runs the same sandbox, and asserts the ORIGINAL measured failure
   comes back. If a control ever stops failing, the pin above has stopped
   testing anything.                                                          */
function positiveControls() {
  /* --- refusal-durable-1.0.1 removed: the ledger goes back to "other" ----
     This is HEAD's behaviour exactly: the row reason is the extension's
     sentence either way, so the ONLY thing that can classify a wrong birthday
     is the row's own PHI-free find verdict being consulted. */
  const noFindAtAll = source.replace(
    'return String((one && one.findReason) || (fd && (fd.findReason || fd.code)) || "");',
    'return ""; /* CONTROL: refusal-durable-1.0.1 removed */');
  ok(noFindAtAll !== source, 'the refusal-durable-1.0.1 fallback could not be located - the control is vacuous');
  const ctlStore = new Map();
  const ctlApi = boot(ctlStore, [{ id: 'pt-9', name: 'Eve Sample', dob: '', mrn: '' }], noFindAtAll).__mlsSI;
  ctlApi._recordAttentionFromReceipt('2026-09-14', {
    requestId: 'control-run',
    patients: [{ patientId: 'pt-9', complete: false, reason: LIVE_DOB_VETO_PROSE, findDiag: LIVE_DOB_VETO_DIAG }],
    retry: []
  });
  const ctlRow = JSON.parse(ctlStore.get('sf_u::doctor@example.test::schedImportIndexV1::2026-09-14')).rows['att::pt-9'];
  eq(ctlRow.code, 'other', 'the control day key did not reproduce the measured "other" code');

  /* --- oown-1.0.0 removed: the subset round eats the day census ---------- */
  const noSubsetRule = source.replace(
    'if (String(opKind || "day-pull") !== "day-pull") {',
    'if (false) { /* CONTROL: oown-1.0.0 subset rule removed */');
  ok(noSubsetRule !== source, 'the oown-1.0.0 subset rule could not be located - the control is vacuous');
  const ctl2 = boot(new Map(), [], noSubsetRule);
  ctl2.window.__mlsPullOutcomeFenceV1 = null;
  ctl2.window.__mlsPullLastOutcome = {
    ok: false, complete: false, reason: 'history-partial', at: Date.now() - 4000,
    historyVerdicts: { requested: 20, succeeded: 18, failed: 2, distinct: 20, closed: true },
    counts: { requested: 20, processed: 20, failures: 2 }
  };
  ctl2.__mlsSI._stampManagedOutcome(
    { complete: false, failures: 2, reason: 'history-partial', requested: 2, processed: 2 },
    'history-retry', Date.now());
  eq(ctl2.window.__mlsPullLastOutcome.historyVerdicts, undefined,
    'the control did not reproduce the defect - the day census survived without the subset rule');
  eq(ctl2.window.__mlsPullLastOutcome.counts.requested, 2,
    "the control did not reproduce the measured two-row counts standing in for the day's twenty");

  /* --- oown-1.0.0 removed: the late answer re-owns the receipt ----------- */
  const noFence = source.replace(
    '    if (fence) {',
    '    if (false) { /* CONTROL: oown-1.0.0 fence removed */');
  ok(noFence !== source, 'the oown-1.0.0 fence could not be located - the control is vacuous');
  const ctl3 = boot(new Map(), [], noFence);
  const startedCtl = Date.now();
  ctl3.window.__mlsPullLastOutcome = { ok: false, reason: 'aborted-session-boundary', at: startedCtl + 10 };
  ctl3.window.__mlsPullOutcomeFenceV1 = { at: startedCtl + 5, reason: 'aborted-session-boundary', target: '2026-09-11' };
  ctl3.__mlsSI._stampManagedOutcome({ complete: false, failures: 2, reason: 'history-partial' }, 'day-pull', startedCtl);
  eq(ctl3.window.__mlsPullLastOutcome.reason, 'history-partial',
    'the control did not reproduce the defect - the late answer was blocked without the fence');
}

/* ---- the appointment-import lane must be untouched ----------------------- */
function importLaneUntouched(api, store) {
  const parsed = JSON.parse(store.get('sf_u::doctor@example.test::schedImportIndexV1::' + DAY));
  const foreign = Object.keys(parsed.rows || {}).filter((k) => k.indexOf('att::') !== 0);
  eq(foreign.length, 0, 'the attention writer touched an appointment-import row');
  ok(typeof api._clearLedgerDone === 'function', 'the appointment-import ledger API is gone');
}

/* ========================================================================= */
const store = new Map();
const patients = [
  { id: 'pt-2', name: 'Ada Sample', dob: '1980-05-14', mrn: '' },
  { id: 'pt-3', name: 'Bob Sample', dob: '', mrn: '' }
];

const first = boot(store, patients);
censusPins(first.__mlsSI);
codePins(first.__mlsSI);
const outcomeOwnershipTail = outcomeOwnershipPins(first);
const ledgerCtx = ledgerPins(store, patients);
importLaneUntouched(ledgerCtx.__mlsSI, store);
liveFindShapePins();
positiveControls();

/* silentpass-1.0.0: an exit code is not proof a suite ran. The tail below is
   async, so a promise that never settles would drain the event loop and exit
   0 having asserted nothing. This latch makes that outcome RED. */
let finished = false;
process.on('exit', (code) => {
  if (code === 0 && !finished) {
    console.error('schedimport-verdict-census-and-durable-refusals: the async tail never settled - NO verdict');
    process.exitCode = 1;
  }
});

Promise.resolve(outcomeOwnershipTail).then(() => reloadPins(store, patients)).then(() => {
  settlePins(store, patients);
  finished = true;
  console.log('schedimport-verdict-census-and-durable-refusals: ' + checks + ' checks passed');
}).catch((e) => { console.error(e); process.exit(1); });

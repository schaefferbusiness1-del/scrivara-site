'use strict';

/* padopt-1.0.0 - THE APPOINTMENT MUST LAND ON THE CHART THE DOCTOR OPENS
 *
 * MEASURED on the owner's live account 2026-08-26, one pulled day, 29
 * appointments: 25 of 29 rows carried a freshly MINTED "p_sched_" patient id
 * while the same human already had a local chart, and only 3 of 29 patients
 * had the day's own visit on the row the appointment pointed at. One human
 * existed as THREE rows (a p_sched_ mint, an all-digits capture, a
 * "_"+digits capture twin) with no native row at all; the appointment bound
 * to the mint, the profile opened a twin, and the day's visit fell in the
 * crack ("could not prove its exact Athena appointment binding").
 *
 * CAUSE, re-verified in code before this suite was written: findPatient's MRN
 * and DOB tiers compare normName(), which only lowercases and collapses
 * non-alphanumerics. "Brooks, Bernard P", "Bernard P Brooks" and "Bernard
 * Brooks" are three different keys, so a real chart for the same human scored
 * ZERO matches, both zero-match tails were reached, and materializePatient
 * minted.
 *
 * THIS SUITE EXECUTES the real /1p importer in a vm - the pure resolver, the
 * one shared findPatient, and the whole importAppts path - with SYNTHETIC
 * identities only. No network, no extension, no browser, no PHI.
 *
 * THE LAW IT PINS, in both directions:
 *   ADOPT  only on a tolerant NAME SHAPE match plus a POSITIVELY AGREEING
 *          second factor (DOB in either format, or MRN), exactly one
 *          survivor, native row preferred over capture debris.
 *   REFUSE on a conflicting second factor, on an absent one, and on
 *          ambiguity - every existing fail-closed exit still runs FIRST, so
 *          this tier can only turn a MISS into a match, never a refusal into
 *          a match.
 *   NEVER  let a raw Athena identifier masquerade as a local id: the value
 *          stamped on the appointment row must always be the id of a row that
 *          is in the local store.
 * ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const IMPORTER = path.join(root, '1p-feat_mls_schedimport_exact.js');
const source = fs.readFileSync(IMPORTER, 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ============================================================ the world === */
function makeWorld(patients) {
  const store = new Map();
  const listeners = new Set();
  const posted = [];
  let backendRows = [];
  const ctx = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, Boolean,
    RegExp, Error, TypeError, Set, Map, encodeURIComponent, decodeURIComponent, queueMicrotask,
    setTimeout: (fn) => { void fn; return 0; }, clearTimeout: () => {},
    setInterval: () => 1, clearInterval: () => {},
    location: { pathname: '/1pScribeFlow.html', origin: 'https://local.invalid' },
    navigator: { userAgent: 'padopt-suite' },
    localStorage: {
      getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)); },
      removeItem: k => { store.delete(String(k)); }
    },
    document: {
      readyState: 'complete', visibilityState: 'visible',
      querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } }),
      addEventListener: () => {}, removeEventListener: () => {},
      body: {}, head: {}, documentElement: {}
    },
    backendMode: () => true,
    bkToken: () => 'padopt-token',
    bkBase: () => 'https://local.invalid',
    uns: key => 'padopt-suite::' + key,
    _normDate: v => String(v || '').slice(0, 10),
    _normTime: v => {
      const s = String(v || '').trim();
      const m = s.match(/(?:T)?(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
      if (!m) return '';
      let hour = Number(m[1]);
      if (m[3] && /PM/i.test(m[3]) && hour < 12) hour += 12;
      if (m[3] && /AM/i.test(m[3]) && hour === 12) hour = 0;
      return String(hour).padStart(2, '0') + ':' + m[2];
    },
    _acctWallToUtcIso: (date, time) => date + 'T' + time + ':00.000Z',
    _acctTodayKey: () => '2026-08-26',
    getPatients: () => patients,
    upsertPatient: p => {
      const at = patients.findIndex(x => String(x.id) === String(p.id));
      if (at >= 0) patients[at] = p; else patients.push(p);
    },
    savePatients: () => true,
    loadCalendar: () => Promise.resolve(),
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    _calAppts: [], _calProviders: [], _calMe: null, _calMode: 'day', _calRefDate: '', _calSelDay: '',
    fetch: async (url, init) => {
      if (!init || !init.method) return { ok: true, status: 200, json: async () => ({ appointments: backendRows }) };
      const body = JSON.parse(init.body || '{}');
      posted.push({ url: String(url), body });
      const id = 'backend-created-' + posted.length;
      backendRows.push(Object.assign({ id }, body));
      return { ok: true, status: 200, json: async () => ({ id }) };
    }
  };
  ctx.window = ctx;
  ctx.addEventListener = (_t, fn) => listeners.add(fn);
  ctx.removeEventListener = (_t, fn) => listeners.delete(fn);
  ctx.dispatchEvent = () => true;
  ctx.postMessage = () => {};
  ctx.__mlsVisitNotesPref = require('./lib-visit-notes-resolver.js').makeResolver(ctx.uns, ctx.localStorage);
  ctx.__mlsVisitNotesPref.write(true);
  vm.runInNewContext(source, ctx, { filename: '1p-feat_mls_schedimport_exact.js', timeout: 20000 });
  return {
    ctx, api: ctx.__mlsSI, patients, posted,
    setBackendRows(rows) { backendRows = rows; },
    resetPosted() { posted.length = 0; }
  };
}

/* the four id SHAPES the owner's live store actually holds for one human */
const NATIVE_ID = 'p1755884400000';       /* a locally created chart */
const SCHED_DEBRIS = 'p_sched_i7qsgc';    /* a previous pull's mint */
const DIGITS_DEBRIS = '48211937';         /* an all-digits capture row */
const UNDER_DEBRIS = '_48211937';         /* the "_"+digits capture twin */

/* ================================================== 1  THE PURE RESOLVER == */
/* padoptResolve is exported precisely so this law can be executed rather than
   grepped. Every case below is a CAUSAL CONTROL: one field moves at a time. */
{
  const w = makeWorld([]);
  const resolve = w.api._padoptResolve;
  const nameMatch = w.api._padoptNameMatch;
  ok(typeof resolve === 'function', 'padopt-1.0.0 did not export _padoptResolve - the law cannot be executed');
  ok(typeof nameMatch === 'function', 'padopt-1.0.0 did not export _padoptNameMatch');

  /* --- the name shape, alone, proves nothing but must RECONCILE ---------- */
  ok(nameMatch('Brooks, Bernard P', 'Bernard P Brooks'), 'Last-comma-First did not reconcile with First Last');
  ok(nameMatch('Bernard Brooks', 'Brooks, Bernard P'), 'a stored name without the middle initial did not reconcile');
  ok(nameMatch('bernard   brooks', 'Bernard Brooks, MD'), 'a credential suffix defeated the tolerant name key');
  ok(!nameMatch('Bernard Brooks', 'Bernadette Brooks'), 'two different first names were treated as the same human');
  ok(!nameMatch('Bernard Brooks', 'Bernard Brookstone'), 'two different surnames were treated as the same human');
  ok(!nameMatch('Brooks', 'Bernard Brooks'), 'a surname alone was treated as a name match');

  /* --- proof is REQUIRED; a name is never identity --------------------- */
  const nameOnly = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '01/02/1970' }],
    { name: 'Brooks, Bernard P' });
  eq(nameOnly.id, '', 'a name-only appointment row adopted a local chart - a unique display name is not identity proof');
  eq(nameOnly.why, 'no-dob-and-no-mrn', 'the mint reason for a proof-less row is not the closed code');

  /* --- the cure: tolerant name + AGREEING DOB, exactly one -------------- */
  const adopted = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02' }],
    { name: 'Brooks, Bernard P', dob: '01/02/1970' });
  eq(adopted.id, NATIVE_ID, 'the measured defect is not cured: a differently-shaped name with an agreeing DOB did not adopt');
  eq(adopted.why, 'tolerant-name-adopted', 'the adoption verdict code changed');

  /* the SAME pair with only the DOB moved must refuse - this is the control
     that proves the name key is not doing the identity work by itself. */
  const dobConflict = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02' }],
    { name: 'Brooks, Bernard P', dob: '03/04/1980' });
  eq(dobConflict.id, '', 'a CONFLICTING DOB still adopted - the identity gate was weakened');
  eq(dobConflict.why, 'tolerant-name-conflict', 'a DOB conflict was not named as a conflict');

  /* an ABSENT second factor proves nothing either way */
  const unproven = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '' }],
    { name: 'Brooks, Bernard P', dob: '01/02/1970' });
  eq(unproven.id, '', 'a local row with NO DOB was adopted on the name alone');
  eq(unproven.why, 'tolerant-name-unproven', 'an absent second factor was reported as something other than unproven');

  /* --- MRN is the other accepted second factor, digits-stripped --------- */
  const byMrn = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', mrn: '48-211-937' }],
    { name: 'Brooks, Bernard P', mrn: ' 48211937 ' });
  eq(byMrn.id, NATIVE_ID, 'MRN punctuation/whitespace defeated the second factor');
  const mrnConflict = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', mrn: '48211937' }],
    { name: 'Brooks, Bernard P', mrn: '48211938' });
  eq(mrnConflict.id, '', 'a CONFLICTING MRN still adopted');
  eq(mrnConflict.why, 'tolerant-name-conflict', 'an MRN conflict was not named as a conflict');

  /* --- padopt-1.0.1: placeholders are not proof, swaps are not names ----- */
  const junkMrn = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', mrn: '99999999' }],
    { name: 'Brooks, Bernard P', mrn: '99999999' });
  eq(junkMrn.id, '', 'a placeholder MRN (one digit repeated) agreed with its own junk twin and bought an adoption');
  const junkDob = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', dob: 'Unknown' }],
    { name: 'Brooks, Bernard P', dob: 'Unknown' });
  eq(junkDob.id, '', 'a placeholder DOB ("Unknown" on both sides) bought an adoption');
  const swap = resolve([{ id: NATIVE_ID, name: 'Robert James', dob: '05/06/1965' }],
    { name: 'James Robert', dob: '05/06/1965' });
  eq(swap.id, '', 'an order-swapped two-token name (two different humans) was treated as the same name');
  /* control: the legitimate comma form still reconciles through the name key */
  const comma = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '05/06/1965' }],
    { name: 'Brooks, Bernard P', dob: '1965-05-06' });
  eq(comma.id, NATIVE_ID, 'the comma-form name with a real agreeing DOB must still adopt');

  /* --- a DIFFERENT Athena chart id is a CONFLICT, not a fall-through ---- */
  /* The Athena-source-id tier now treats ZERO matches as a MISS and falls
     through to the stricter MRN/DOB tiers (returning null there sent fully
     proven rows straight to the mint). That fall-through must never land on a
     local row provably stamped with a DIFFERENT Athena chart id. */
  const otherChart = resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02', athenaPatientId: 'athena-777' }],
    { name: 'Brooks, Bernard P', dob: '01/02/1970', athenaPatientId: 'athena-999' });
  eq(otherChart.id, '', 'a row for Athena chart 999 adopted a local row stamped with Athena chart 777');
  eq(otherChart.why, 'tolerant-name-conflict', 'a two-chart conflict was not named as a conflict');
  /* ...while an ABSENT source id on either side still proves nothing */
  eq(resolve([{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02' }],
    { name: 'Brooks, Bernard P', dob: '01/02/1970', athenaPatientId: 'athena-999' }).id, NATIVE_ID,
    'an absent local Athena id was treated as a conflict - absence proves nothing either way');

  /* --- AMBIGUITY fails closed ------------------------------------------ */
  const ambiguous = resolve([
    { id: 'p-native-1', name: 'Bernard Brooks', dob: '1970-01-02' },
    { id: 'p-native-2', name: 'Brooks, Bernard', dob: '01/02/1970' }
  ], { name: 'Brooks, Bernard P', dob: '01/02/1970' });
  eq(ambiguous.id, '', 'TWO agreeing native charts produced an arbitrary binding instead of a refusal');
  eq(ambiguous.why, 'tolerant-name-ambiguous', 'ambiguity was not named as ambiguity');

  /* --- NATIVE beats capture debris (the same partition the backend picks) */
  const overDebris = resolve([
    { id: SCHED_DEBRIS, name: 'Brooks, Bernard P', dob: '01/02/1970' },
    { id: DIGITS_DEBRIS, name: 'Bernard Brooks', dob: '1970-01-02' },
    { id: UNDER_DEBRIS, name: 'Bernard P Brooks', dob: '1970-01-02' },
    { id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02' }
  ], { name: 'Brooks, Bernard P', dob: '01/02/1970' });
  eq(overDebris.id, NATIVE_ID, 'the three-row crack is not cured: adoption picked capture debris over the native chart');

  /* ...and with NO native row present, four agreeing debris rows are still
     ambiguous. Adoption may never invent a winner among twins. */
  const allDebris = resolve([
    { id: SCHED_DEBRIS, name: 'Brooks, Bernard P', dob: '01/02/1970' },
    { id: DIGITS_DEBRIS, name: 'Bernard Brooks', dob: '1970-01-02' }
  ], { name: 'Brooks, Bernard P', dob: '01/02/1970' });
  eq(allDebris.id, '', 'two capture twins with no native row produced an arbitrary binding');
  eq(allDebris.why, 'tolerant-name-ambiguous', 'debris-only ambiguity was not named as ambiguity');
}

/* ======================================== 2  THE ONE SHARED RESOLVER ===== */
/* findPatient is the single door every materialization passes through. The
   tolerant tier lives in its two ZERO-MATCH tails, so the load-bearing
   refusals above it must be provably untouched. */
{
  const w = makeWorld([]);
  const find = w.api._findPatient;

  const native = { id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02' };
  ok(find([native], { name: 'Brooks, Bernard P', dob: '01/02/1970' }) === native,
    'findPatient did not adopt through the tolerant tier');

  /* the pins that must NOT move */
  eq(find([native], { name: 'Bernard Brooks' }), null,
    'one local same-name patient upgraded a name-only Athena row');
  eq(find([
    { id: 'dup-1', name: 'Bernard Brooks', dob: '1970-01-02' },
    { id: 'dup-2', name: 'Bernard Brooks', dob: '1970-01-02' }
  ], { name: 'Bernard Brooks', dob: '01/02/1970' }), null,
    'ambiguous local duplicates became an arbitrary patient binding');
  eq(find([native], { name: 'Brooks, Bernard P', dob: '03/04/1980' }), null,
    'a conflicting DOB bound through the tolerant tier');

  /* the EXACT-name tiers must honour the same two-chart refusal, because the
     Athena-source-id tier now falls through to them on a miss */
  const stamped = { id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02', mrn: '48211937', athenaPatientId: 'athena-777' };
  eq(find([stamped], { name: 'Bernard Brooks', mrn: '48211937', athenaPatientId: 'athena-999' }), null,
    'the exact-MRN tier bound a row for one Athena chart onto a local row stamped with another');
  eq(find([{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02', athenaPatientId: 'athena-777' }],
    { name: 'Bernard Brooks', dob: '01/02/1970', athenaPatientId: 'athena-999' }), null,
    'the exact-DOB tier bound a row for one Athena chart onto a local row stamped with another');
  ok(find([stamped], { name: 'Bernard Brooks', mrn: '48211937', athenaPatientId: 'athena-777' }) === stamped,
    'an AGREEING Athena chart id was refused - only a disagreement is a conflict');

  /* an appointment row that ALREADY carries a local alias is never re-pointed
     by this tier: moving an existing binding is a different, riskier act, and
     the live store's p_sched rows are load-bearing (patient-row-loss-guard). */
  const bound = { id: SCHED_DEBRIS, name: 'Brooks, Bernard P', dob: '01/02/1970' };
  const pool = [bound, native];
  ok(find(pool, { patient_external_id: SCHED_DEBRIS, name: 'Brooks, Bernard P', dob: '01/02/1970' }) === bound,
    'an appointment already bound to a local id was silently re-pointed at a different row');
}

/* =================================== 3  THE WHOLE IMPORT, END TO END ===== */
(async () => {
  /* ---- (a) the owner's measured shape: the row adopts the native chart --- */
  {
    const patients = [
      { id: SCHED_DEBRIS, name: 'Brooks, Bernard P', dob: '01/02/1970', visits: [] },
      { id: DIGITS_DEBRIS, name: 'Bernard Brooks', dob: '1970-01-02', visits: [] },
      { id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02', visits: [] }
    ];
    const w = makeWorld(patients);
    const before = patients.length;
    const row = {
      appointmentId: 'athena-appt-1', athenaPatientId: '9988776',
      name: 'Brooks, Bernard P', dob: '01/02/1970',
      date: '2026-08-26', time: '09:20', provider: 'Doctor One', providerId: 'provider-1',
      reason: 'Synthetic procedure text'
    };
    const res = await w.api.importAppts([row], { date: '2026-08-26', scopeDate: '2026-08-26', requirePatientBinding: true });

    eq(res.created, 1, 'the adopted appointment was not created');
    eq(patients.length, before, 'adoption still MINTED a throwaway patient (' + (patients.length - before) + ' new rows)');
    ok(!patients.some(p => /^p_sched_/.test(String(p.id)) && String(p.id) !== SCHED_DEBRIS),
      'a new p_sched_ identity was minted for a human who already had a chart');
    eq(w.posted[0].body.patient_external_id, NATIVE_ID,
      'the backend appointment row is still bound to the wrong chart - this is the owner #1 defect');
    /* importAppts works on a defensive COPY of each source row, so the stamp is
       observed through the two things that actually travel: the resolved
       appointment mapping (which feeds the ledger and the op-note room's
       appointment-id lookup) and the history target. */
    eq((res.resolvedAppointments[0] || {}).patientId, NATIVE_ID,
      'the resolved appointment mapping still names a throwaway identity');
    eq(res.historyTargets.length, 1, 'the adopted row did not become a history target');
    eq(res.historyTargets[0]._mlsTargetPatientId, NATIVE_ID,
      "the day's own visit would still be saved onto the wrong chart");
    eq(res.historyTargets[0].patient_external_id, NATIVE_ID, 'the two alias fields on the history target disagree');

    /* the receipt must be able to PROVE this was an adoption, PHI-free */
    const ar = res.adoptionReceipt || {};
    eq(ar.kind, 'padopt-1.0.0', 'the import result carries no adoption receipt');
    eq(ar.adopted, 1, 'the adoption census did not count the adoption');
    eq(ar.mintAttempted, 0, 'a mint was attempted for a row that adopted');
    eq(JSON.stringify(ar).indexOf('Brooks'), -1, 'the adoption receipt carries a NAME - it must be PHI-free');
    eq(JSON.stringify(ar).indexOf('1970'), -1, 'the adoption receipt carries a DOB - it must be PHI-free');
  }

  /* ---- (b) a raw Athena identifier may never become a local id --------- */
  {
    const patients = [];
    const w = makeWorld(patients);
    const row = {
      appointmentId: 'athena-appt-2', athenaPatientId: '9988776', mrn: '551122',
      name: 'Cassia Wintergreen', dob: '05/06/1981',
      date: '2026-08-26', time: '10:00', provider: 'Doctor One', providerId: 'provider-1'
    };
    const res = await w.api.importAppts([row], { date: '2026-08-26', scopeDate: '2026-08-26', requirePatientBinding: true });
    const stamped = String(w.posted[0].body.patient_external_id || '');
    ok(stamped, 'a genuinely new proven patient produced no local binding at all');
    eq(String((res.historyTargets[0] || {})._mlsTargetPatientId || ''), stamped,
      'the appointment and its history target named two different identities');
    ok(stamped !== '9988776', 'the RAW ATHENA CHART ID was stamped as a local patient id');
    ok(stamped !== '551122', 'the RAW MRN was stamped as a local patient id');
    ok(patients.some(p => String(p.id) === stamped),
      'the id stamped on the appointment is not a row in the local store - it is masquerading as one');
    ok(/^p_sched_/.test(stamped), 'a genuinely new patient must still mint - the mint is the correct last resort here');
  }

  /* ---- (c) a DOB CONFLICT keeps failing closed, and mints instead ------ */
  {
    const patients = [{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02', visits: [] }];
    const w = makeWorld(patients);
    const row = {
      appointmentId: 'athena-appt-3', name: 'Brooks, Bernard P', dob: '03/04/1980',
      date: '2026-08-26', time: '11:00', provider: 'Doctor One', providerId: 'provider-1'
    };
    const res = await w.api.importAppts([row], { date: '2026-08-26', scopeDate: '2026-08-26', requirePatientBinding: true });
    ok(String(w.posted[0].body.patient_external_id || '') !== NATIVE_ID,
      'a conflicting DOB bound the appointment to the native chart anyway - the gate was weakened');
    eq(patients[0].dob, '1970-01-02', "the native chart's stored DOB was overwritten by a conflicting row");
    const ar = res.adoptionReceipt || {};
    eq(ar.adopted, 0, 'a conflicted row was counted as an adoption');
    eq(ar.mintAttempted, 1, 'the unavoidable mint was not recorded');
    eq(ar.reasons['tolerant-name-conflict'], 1, 'the mint reason did not name the conflict that forced it');
  }

  /* ---- (d) AMBIGUITY keeps failing closed, and mints instead ----------- */
  {
    const patients = [
      { id: 'p-native-1', name: 'Bernard Brooks', dob: '1970-01-02', visits: [] },
      { id: 'p-native-2', name: 'Brooks, Bernard', dob: '01/02/1970', visits: [] }
    ];
    const w = makeWorld(patients);
    const row = {
      appointmentId: 'athena-appt-4', name: 'Brooks, Bernard P', dob: '01/02/1970',
      date: '2026-08-26', time: '12:00', provider: 'Doctor One', providerId: 'provider-1'
    };
    const res = await w.api.importAppts([row], { date: '2026-08-26', scopeDate: '2026-08-26', requirePatientBinding: true });
    const stamped = String(w.posted[0].body.patient_external_id || '');
    ok(stamped !== 'p-native-1' && stamped !== 'p-native-2',
      'ambiguity picked one of two equally proven charts - that is the arbitrary binding this suite forbids');
    const ar = res.adoptionReceipt || {};
    eq(ar.adopted, 0, 'an ambiguous row was counted as an adoption');
    eq(ar.reasons['tolerant-name-ambiguous'], 1, 'the mint reason did not name the ambiguity that forced it');
  }

  /* ---- (e) a re-pull of an already-adopted row is idempotent ----------- */
  {
    const patients = [{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02', visits: [] }];
    const w = makeWorld(patients);
    const mk = () => ({
      appointmentId: 'athena-appt-5', name: 'Brooks, Bernard P', dob: '01/02/1970',
      date: '2026-08-26', time: '13:00', provider: 'Doctor One', providerId: 'provider-1'
    });
    const first = await w.api.importAppts([mk()], { date: '2026-08-26', scopeDate: '2026-08-26', requirePatientBinding: true });
    eq(first.created, 1, 'the first pull did not create the adopted appointment');
    const second = await w.api.importAppts([mk()], { date: '2026-08-26', scopeDate: '2026-08-26', requirePatientBinding: true });
    eq(second.created, 0, 'the re-pull created a SECOND appointment row for the same adopted appointment');
    eq(patients.length, 1, 'the re-pull minted a patient for a human it had already adopted');
    eq((second.historyTargets[0] || {})._mlsTargetPatientId, NATIVE_ID,
      'the re-pull re-targeted a different chart than the first pull');
  }

  /* ---- (f) THE WHOLE POINT: the day's own visit lands on the chart the
     doctor opens. This joins the two halves the owner reported as one defect -
     the appointment binding AND the pulled day's encounter - by running the
     real import and then the real history batch over its own targets, in the
     shared fake-extension harness. -------------------------------------- */
  {
    const { makeHarness } = require('./1p-pull-harness.js');
    const DAY = '2026-08-17';
    /* the owner's measured three-row shape for ONE human: a previous pull's
       p_sched_ mint, a "_"+digits capture twin, and the native chart. */
    const patients = [
      { id: SCHED_DEBRIS, name: 'Brooks, Bernard P', dob: '01/02/1970', visits: [] },
      { id: UNDER_DEBRIS, name: 'Bernard P Brooks', dob: '1970-01-02', visits: [] },
      { id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02', visits: [] }
    ];
    const h = makeHarness({
      day: DAY, today: DAY, rows: 1, visitNotesOn: true, chartCoverage: true, patients,
      parseResult: () => ({ problems: 'Synthetic problem', meds: 'Synthetic med', summary: 'Synthetic summary' }),
      noteResult: (pid) => ({ ok: true, visits: [{ date: DAY, type: 'Office visit',
        raw: 'Synthetic pulled-day encounter body with substantive clinical detail.',
        fullDetail: true, sourceVisitKey: 'row:sd-' + pid }] })
    });
    /* the harness has no backend; give it one, and the coverage reader the
       clinical floor demands. Synthetic, in-memory, no network. */
    const posted = [];
    let backendRows = [];
    h.rt.backendMode = () => true;
    h.rt.bkToken = () => 'padopt-token';
    h.rt.bkBase = () => 'https://local.invalid';
    h.rt._acctWallToUtcIso = (d, t) => d + 'T' + t + ':00.000Z';
    h.rt.fetch = async (url, init) => {
      if (!init || !init.method) return { ok: true, status: 200, json: async () => ({ appointments: backendRows }) };
      const body = JSON.parse(init.body || '{}');
      posted.push(body);
      const id = 'backend-' + posted.length;
      backendRows.push(Object.assign({ id }, body));
      return { ok: true, status: 200, json: async () => ({ id }) };
    };
    h.rt._assistReadCoverage = (_t, _s, o) => Promise.resolve({ ok: true, values: {},
      receipt: { complete: true, status: 'saved', requestId: String((o && o.requestId) || ''),
        sourceSurface: 'synthetic-suite', capturedAt: h.clock.now(), fieldsPresent: 0, fieldsEmpty: 0 } });

    const res = await h.api.importAppts([{
      appointmentId: 'athena-appt-day', name: 'Brooks, Bernard P', dob: '01/02/1970',
      date: DAY, time: '09:20', provider: 'Doctor One', providerId: 'provider-1',
      reason: 'Synthetic procedure text'
    }], { date: DAY, scopeDate: DAY, requirePatientBinding: true });

    eq(res.created, 1, 'the import did not create the appointment');
    eq((res.adoptionReceipt || {}).adopted, 1, 'the import did not adopt the native chart');
    eq(posted[0].patient_external_id, NATIVE_ID, 'the appointment bound to capture debris');
    eq((res.historyTargets[0] || {})._mlsTargetPatientId, NATIVE_ID, 'the history target names a twin');

    const batch = await h.api._runHistoryBatch(res.historyTargets, res.historyUnresolved, h.onStatus, { scopeDay: DAY });
    eq(batch.patients.length, 1, 'the adopted target did not reach the history batch');
    eq(batch.patients[0].patientId, NATIVE_ID, 'the chart read went to a different row than the appointment');
    eq(batch.patients[0].complete, true, 'the adopted row did not complete');

    const dayVisits = (p) => (p.visits || []).filter(v => String(v.date) === DAY).length;
    eq(dayVisits(patients[2]), 1,
      "the pulled day's visit did not land on the chart the doctor opens - the owner's #1 defect is not cured");
    eq(dayVisits(patients[0]), 0, "the day's visit was also written onto the p_sched_ mint");
    eq(dayVisits(patients[1]), 0, "the day's visit was also written onto the capture twin");
    eq((batch.patients[0].sameDayProof || {}).status, 'saved',
      "the pull cannot prove it saved the day's own visit onto the adopted chart");
  }

  /* ---- (g) padopt-1.0.2: an EXISTING backend row bound to debris is
     RE-POINTED by the update POST. Measured live 2026-08-26 on the owner's
     account: a full healthy pull left every debris binding in place, because
     debrisUpgrade only lifted the fatal refusal while the enrich POST was
     built from addMissing, which fills EMPTY fields only. The upgrade must
     persist - and must not repeat once the binding is native. ------------- */
  {
    const patients = [
      { id: SCHED_DEBRIS, name: 'Brooks, Bernard P', dob: '01/02/1970', visits: [] },
      { id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02', visits: [] }
    ];
    const w = makeWorld(patients);
    const boundRow = {
      id: 'backend-existing-77', athena_appointment_id: 'athena-appt-up', athena_provider_id: 'provider-1',
      patient_external_id: SCHED_DEBRIS, appt_date: '2026-08-26', start_at: '2026-08-26T09:20:00.000Z',
      provider_name: 'Doctor One', dob: '01/02/1970'
    };
    w.setBackendRows([boundRow]);
    const mkRow = () => ({
      appointmentId: 'athena-appt-up', name: 'Brooks, Bernard P', dob: '01/02/1970',
      date: '2026-08-26', time: '09:20', provider: 'Doctor One', providerId: 'provider-1'
    });
    const res = await w.api.importAppts([mkRow()], { date: '2026-08-26', scopeDate: '2026-08-26', requirePatientBinding: true });
    eq(res.created, 0, 'the reconciliation created a duplicate instead of updating the bound row');
    eq(res.failed, 0, 'the debris-bound row still dies in the import walk (the second flat gate)');
    const repoints = w.posted.filter(p => /\/api\/appointments\/[^/]+\/update$/.test(p.url) && p.body.patient_external_id !== undefined);
    eq(repoints.length, 1, 'no update POST carried the re-point - the debris binding survives (the 1.0.1 gap, measured live 2026-08-26)');
    eq(repoints[0].body.patient_external_id, NATIVE_ID, 'the re-point carried something other than the proven native id');
    ok(/backend-existing-77\/update$/.test(repoints[0].url), 'the re-point was not addressed to the bound row');
    eq(String((res.historyTargets[0] || {})._mlsTargetPatientId || ''), NATIVE_ID, 'the history target does not name the native chart');
    /* idempotency: once the backend row is native, a re-import must not post
       the binding again (fill-only for non-upgrade rows is preserved). */
    w.setBackendRows([Object.assign({}, boundRow, { patient_external_id: NATIVE_ID })]);
    w.resetPosted();
    await w.api.importAppts([mkRow()], { date: '2026-08-26', scopeDate: '2026-08-26', requirePatientBinding: true });
    eq(w.posted.filter(p => p.body.patient_external_id !== undefined).length, 0,
      're-import re-posted the binding - the upgrade writer leaks into the ordinary path');
  }

  /* ---- (h) native-vs-native disagreement on an EXISTING row stays FATAL:
     the persistence writer must ride ONLY on the debris verdict. ---------- */
  {
    const patients = [{ id: NATIVE_ID, name: 'Bernard Brooks', dob: '1970-01-02', visits: [] }];
    const w = makeWorld(patients);
    const foreignBound = {
      id: 'backend-existing-88', athena_appointment_id: 'athena-appt-vs', athena_provider_id: 'provider-1',
      patient_external_id: 'p-native-other', appt_date: '2026-08-26', start_at: '2026-08-26T10:40:00.000Z',
      provider_name: 'Doctor One', dob: '01/02/1970'
    };
    w.setBackendRows([foreignBound]);
    const res = await w.api.importAppts([{
      appointmentId: 'athena-appt-vs', name: 'Brooks, Bernard P', dob: '01/02/1970',
      date: '2026-08-26', time: '10:40', provider: 'Doctor One', providerId: 'provider-1'
    }], { date: '2026-08-26', scopeDate: '2026-08-26', requirePatientBinding: true });
    ok(JSON.stringify(res.failureReasons || {}).indexOf('appointment-patient-identity-conflict') >= 0,
      'a native-vs-native disagreement no longer fails as an identity conflict');
    eq(w.posted.filter(p => p.body.patient_external_id !== undefined).length, 0,
      'a native-vs-native disagreement posted a re-point - the fatal gate leaks');
    eq((res.historyTargets || []).length, 0, 'a conflicted appointment still reached the history queue');
  }

  console.log('padopt-appointment-chart-adoption: ' + checks + ' checks passed');
})().catch(err => { console.error(err); process.exit(1); });

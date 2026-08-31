'use strict';

/* pullbind-1.0.0 — A PULL-CREATED VISIT MUST CARRY ITS APPOINTMENT BINDING.
 *
 * Owner, 2026-08-31: "pulling should be simple and easy and intuitive" and
 * "from a pull, visits should be auto-bound, right?" — after a day pull, a
 * visit opened from a schedule row showed:
 *
 *   "MLS could not prove this row's exact Athena appointment binding.
 *    Re-pull this day before using Athena verification or send."
 *
 * TWO MEASURED GAPS, both proved here against the SHIPPED bytes:
 *
 *  (A) bindingNotice()/bindCureOffered() judged the binding with
 *      exactScheduledBindingMatches ALONE — a read-only question about the
 *      binding that happens to be frozen right now. The thing that PUTS a
 *      binding there, installScheduledVisitBinding, ran in exactly one place:
 *      lockAndStart, once, at activation. Every later path that legitimately
 *      drops or replaces the binding (newVisit from _athenaPrepareRecording,
 *      the explicit demotion inside requireExactScheduledBinding, reopening a
 *      saved record) therefore left a perfectly bindable pull-created row
 *      accused of being unprovable, with a whole-day re-pull as the only cure.
 *      Nothing ever re-tried the install.
 *
 *  (B) scheduledAppointmentId() read only the backend calendar row's own
 *      fields. The day pull ALSO writes acct:schedImportIndexV1::<day>, whose
 *      keys are athenaOne's own appointment ids and whose entries carry
 *      {state, patientId, backendAppointmentId, appt_date}. The WRITE lane has
 *      consumed that ledger since b745; this reader never did, so a pulled row
 *      whose backend record never received athena_appointment_id reported
 *      "missing its exact Athena appointment ID" while the ledger held it.
 *
 * FAIL-CLOSED IS NOT RELAXED. The ledger join is per BACKEND ROW ID, so it can
 * never pick between two same-day appointments for one patient; two entries
 * claiming one backend row, a day mismatch, a still-pending entry, or no ledger
 * return '' verbatim. The auto re-install runs the UNCHANGED
 * installScheduledVisitBinding + exactScheduledBindingMatches pair and can bind
 * nothing they refuse.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const P1 = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

let n = 0;
const ok = (m) => { n++; console.log('ok ' + n + ' - ' + m); };

/* ---------------------------------------------------------------- 0. bytes */
/* [[a-feature-detect-guard-hides-a-typo]]: bindingNotice reaches the helper
 * through `typeof scheduledBindingReady === 'function'` so isolated harnesses
 * that lift computePhase alone keep the original read-only check. A guard like
 * that silently no-ops if the name is ever misspelled or moved, so the handle
 * itself is pinned here. */
for (const [label, src] of [['1p', P1], ['production', MAIN]]) {
  assert(src.indexOf('function scheduledBindingReady(a) {') > 0,
    label + ': scheduledBindingReady is missing — bindingNotice\'s typeof guard would silently fall back forever');
  assert(src.indexOf('function ledgerScheduledAppointmentId(a) {') > 0,
    label + ': ledgerScheduledAppointmentId is missing');
  assert(src.indexOf('function bindAutoReplaceable(a) {') > 0,
    label + ': bindAutoReplaceable is missing');
  assert(src.indexOf("typeof scheduledBindingReady === 'function'") > 0,
    label + ': bindingNotice no longer reaches the re-install helper');
  assert((src.match(/function scheduledBindingReady\(a\) \{/g) || []).length === 1,
    label + ': scheduledBindingReady must exist exactly once');
}
ok('both twins ship the pullbind handles and bindingNotice reaches them');

function slice(src, fromToken, toToken) {
  const a = src.indexOf(fromToken);
  const b = src.indexOf(toToken, a);
  assert(a > 0 && b > a, 'could not bound ' + fromToken + ' .. ' + toToken);
  return src.slice(a, b);
}
const BIND_SLICE = slice(P1, '  function scheduledAppointmentId(a) {', '  function requireExactScheduledBinding(');
const NOTICE_SLICE = slice(P1, '  function bindingNotice() {', '  /* ===== wfbindbar-1.0.0');

/* the backend calendar-row id is a DIFFERENT namespace and must never be
 * returned as an Athena appointment id (wf2-1.9.0) */
assert(!/return\s+backendId/.test(BIND_SLICE),
  'the backend row id can be returned as an Athena appointment id');
ok('the backend calendar-row id is only ever a join key, never a returned appointment id');

/* --------------------------------------------------------------- harness */
const DAY = '2026-08-27';
const PATIENT = { id: 'local-77', name: 'Adam Schaeffer', dob: '1988-03-04', mrn: '550012' };

function makeBindHarness(opts) {
  opts = opts || {};
  const store = new Map(Object.entries(opts.store || {}));
  const calls = { freeze: [], set: [], resolve: [], reads: 0 };
  const state = {
    binding: opts.binding === undefined ? null : opts.binding,
    recording: !!opts.recording,
    genClickedAt: opts.genClickedAt || 0,
    patients: opts.patients || [PATIENT],
    active: opts.active === undefined ? PATIENT : opts.active
  };
  const ctx = {
    Date, isNaN, JSON, Object, String, Number, RegExp, console,
    S: { get genClickedAt() { return state.genClickedAt; } },
    safe(fn, d) { try { return fn(); } catch (e) { return d; } },
    isFn(f) { return typeof f === 'function'; },
    pad2(v) { return ('0' + v).slice(-2); },
    t12() { return '09:00'; },
    dobOf(a) { return String((a && a.dob) || '').trim(); },
    dobKey(v) {
      let m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[1] + m[2] + m[3];
      m = String(v || '').match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      return m ? m[3] + ('0' + m[1]).slice(-2) + ('0' + m[2]).slice(-2) : '';
    },
    normTokens(s) {
      return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort();
    },
    isRecording() { return state.recording; },
    captureBusy() { return state.recording; },
    canonicalActivePatient() { return state.active; },
    apptDay(a) { return String((a && (a.appt_date || a.day_local)) || '').slice(0, 10); },
    currentVisitAthenaBinding: null
  };
  ctx.nameMatch = (x, y) => {
    const a = ctx.normTokens(x), b = ctx.normTokens(y);
    if (!a.length || !b.length) return false;
    const s = a.length <= b.length ? a : b, l = a.length <= b.length ? b : a;
    return s.every(t => l.indexOf(t) >= 0);
  };
  ctx.dobConflicts = (a, b) => { const A = ctx.dobKey(a), B = ctx.dobKey(b); return !!(A && B && A !== B); };
  ctx.mrnKey = (a) => String((a && (a.mrn || a.athenaId || a.athenaPatientId || a.patient_mrn)) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  ctx.mrnConflicts = (a, b) => { const A = ctx.mrnKey(a), B = ctx.mrnKey(b); return !!(A && B && A !== B); };
  ctx.positiveIdentityEvidence = (a, p) => {
    function agrees(c) {
      if (!a || !c || !c.id || !ctx.nameMatch(a.name, c.name)) return false;
      const ad = ctx.dobKey(ctx.dobOf(a)), pd = ctx.dobKey(ctx.dobOf(c));
      const am = ctx.mrnKey(a), pm = ctx.mrnKey(c);
      if ((ad && pd && ad !== pd) || (am && pm && am !== pm)) return false;
      return !!((ad && pd && ad === pd) || (am && pm && am === pm));
    }
    const hits = state.patients.filter(agrees);
    return agrees(p) && hits.length === 1 && String(hits[0].id) === String(p.id);
  };
  ctx.rowKey = (a) => String((a && a.id) || '') + '|' + String((a && a.name) || '') + '|' + ctx.apptDay(a);
  ctx.window = {
    uns: (k) => 'acct:' + k,
    localStorage: { getItem: (k) => { calls.reads++; return store.has(String(k)) ? store.get(String(k)) : null; } },
    getPatients() { return state.patients; },
    __mlsCrossDayContext: { current() { return null; } },
    _calResolveLocalPatient(a) { calls.resolve.push(a); if (opts.resolveTo) a._mlsTargetPatientId = opts.resolveTo; return opts.resolveTo || null; },
    _athenaFreezeVisitBinding(p, meta) {
      const b = {
        id: 'bind-' + (calls.freeze.length + 1), patient: { name: p.name, dob: p.dob, mrn: p.mrn, patientId: String(p.id || p.patientId || '') },
        source: meta.source, historical: meta.historical === true, visitContext: meta.visitContext
      };
      calls.freeze.push({ p, meta, out: b });
      return b;
    },
    _athenaSetVisitBinding(b, replaceExisting) {
      calls.set.push({ binding: b, replaceExisting });
      state.binding = b || null; ctx.currentVisitAthenaBinding = state.binding;
      return true;
    }
  };
  ctx.currentVisitAthenaBinding = state.binding;
  vm.createContext(ctx);
  vm.runInContext(BIND_SLICE + '\nthis.__api = { schedId: scheduledAppointmentId, ledgerId: ledgerScheduledAppointmentId,' +
    ' install: installScheduledVisitBinding, matches: exactScheduledBindingMatches,' +
    ' ready: scheduledBindingReady, replaceable: bindAutoReplaceable };', ctx, { filename: 'pullbind-slice' });
  return { api: ctx.__api, ctx, calls, state, store };
}

const ROW = () => ({ id: 'backend-4407', name: 'Adam Schaeffer', dob: '1988-03-04', mrn: '550012',
  appt_date: DAY, provider: 'Michael Schaeffer, MD', _mlsTargetPatientId: PATIENT.id });

function ledger(rows) { return JSON.stringify({ v: 1, rows: rows }); }
const LEDGER_KEY = 'acct:schedImportIndexV1::' + DAY;

/* ------------------------------------------ 1. the ledger resolves the id */
{
  const h = makeBindHarness({ store: { [LEDGER_KEY]: ledger({
    'appointment-id:1272764709': { state: 'done', patientId: 'athena-1', backendAppointmentId: 'backend-4407', appt_date: DAY, updated: Date.now() },
    'appointment-id:1272764710': { state: 'done', patientId: 'athena-1', backendAppointmentId: 'backend-9999', appt_date: DAY, updated: Date.now() }
  }) } });
  const row = ROW();
  assert.strictEqual(h.api.schedId(row), '1272764709',
    'a pulled row with no athena_appointment_id did not recover its id from the day import ledger');
  assert.notStrictEqual(h.api.schedId(row), 'backend-4407', 'the backend row id was returned as the appointment id');
  ok('a ledgered pull-created row recovers athenaOne\'s own appointment id (and never the backend row id)');
}

/* --------------------------- 2. the row\'s OWN id always wins over the ledger */
{
  const h = makeBindHarness({ store: { [LEDGER_KEY]: ledger({
    'appointment-id:9999999999': { state: 'done', backendAppointmentId: 'backend-4407', appt_date: DAY }
  }) } });
  const row = Object.assign(ROW(), { athena_appointment_id: '1272764709' });
  assert.strictEqual(h.api.schedId(row), '1272764709', 'the ledger overrode the row\'s own Athena appointment id');
  ok('the row\'s own Athena appointment id is authoritative; the ledger is only a fallback');
}

/* ------------------------------------------------- 3. fail-closed refusals */
{
  const cases = [
    ['no ledger for the day', {}],
    ['a still-pending ledger entry', { [LEDGER_KEY]: ledger({
      'appointment-id:1272764709': { state: 'pending', backendAppointmentId: 'backend-4407', appt_date: DAY } }) }],
    ['a ledger entry for another day', { [LEDGER_KEY]: ledger({
      'appointment-id:1272764709': { state: 'done', backendAppointmentId: 'backend-4407', appt_date: '2026-08-26' } }) }],
    ['TWO appointments claiming one backend row', { [LEDGER_KEY]: ledger({
      'appointment-id:1272764709': { state: 'done', backendAppointmentId: 'backend-4407', appt_date: DAY },
      'appointment-id:1272764711': { state: 'done', backendAppointmentId: 'backend-4407', appt_date: DAY } }) }],
    ['a slot-keyed ledger entry with no Athena id', { [LEDGER_KEY]: ledger({
      'core:adam|2026-08-27|09:00': { state: 'done', backendAppointmentId: 'backend-4407', appt_date: DAY } }) }],
    ['a corrupt ledger blob', { [LEDGER_KEY]: '{not json' }]
  ];
  for (const [label, store] of cases) {
    const h = makeBindHarness({ store });
    assert.strictEqual(h.api.schedId(ROW()), '', label + ' produced an appointment id');
  }
  ok('the ledger fallback fails closed: no ledger, pending, wrong day, TWO claims on one backend row, slot keys, corrupt bytes -> "" (' + cases.length + ' refusals)');
}

/* ------------ 4. two same-day appointments for ONE patient are never merged */
{
  const h = makeBindHarness({ store: { [LEDGER_KEY]: ledger({
    'appointment-id:111': { state: 'done', patientId: 'athena-1', backendAppointmentId: 'backend-morning', appt_date: DAY },
    'appointment-id:222': { state: 'done', patientId: 'athena-1', backendAppointmentId: 'backend-afternoon', appt_date: DAY }
  }) } });
  const morning = Object.assign(ROW(), { id: 'backend-morning' });
  const afternoon = Object.assign(ROW(), { id: 'backend-afternoon' });
  assert.strictEqual(h.api.schedId(morning), '111', 'the morning row lost its own appointment');
  assert.strictEqual(h.api.schedId(afternoon), '222', 'the afternoon row lost its own appointment');
  const orphan = Object.assign(ROW(), { id: 'backend-never-ledgered' });
  assert.strictEqual(h.api.schedId(orphan), '',
    'a row the ledger does not name was handed one of the patient\'s other same-day appointments');
  ok('two same-day appointments for one patient stay distinct; an unledgered third row is never auto-picked from them');
}

/* ------------------- 5. THE BANNER GAP: ask (install) before you accuse ---- */
{
  /* the exact live shape: the row is bindable, but the binding was dropped
     (newVisit / an earlier demotion). The read-only check says "unprovable". */
  const h = makeBindHarness({ store: { [LEDGER_KEY]: ledger({
    'appointment-id:1272764709': { state: 'done', backendAppointmentId: 'backend-4407', appt_date: DAY }
  }) } });
  const row = ROW();
  assert.strictEqual(h.api.matches(row), false, 'precondition: no binding is frozen yet');
  assert.strictEqual(h.api.ready(row), true,
    'a bindable pull-created row with no frozen binding stayed unprovable — this is the banner the owner read');
  assert.strictEqual(h.calls.set.length, 1, 'the re-install did not install exactly one binding');
  assert.strictEqual(h.calls.freeze[0].meta.visitContext.appointmentId, '1272764709',
    'the re-installed binding did not carry the ledger-recovered appointment id');
  assert.strictEqual(h.api.matches(row), true, 'the installed binding does not satisfy the unchanged match check');
  ok('a pull-created visit whose binding was dropped re-binds itself from the day ledger — no re-pull');
}

/* ------------------------------- 6. it can bind nothing the pair refuses --- */
{
  for (const [label, mutate] of [
    ['no provider', r => { r.provider = ''; }],
    ['no day', r => { r.appt_date = ''; r.day_local = ''; }],
    ['a different person in the active chart', r => { r.name = 'Someone Else'; r._mlsTargetPatientId = ''; }]
  ]) {
    const h = makeBindHarness();
    const row = ROW(); mutate(row);
    assert.strictEqual(h.api.ready(row), false, label + ': the auto re-install bound a row the gate refuses');
    assert.strictEqual(h.calls.set.length, 0, label + ': the auto re-install mutated the binding anyway');
  }
  ok('the auto re-install binds nothing installScheduledVisitBinding/exactScheduledBindingMatches refuse (3 refusals, zero mutations)');
}

/* ------------------------------------- 7. it never churns a live encounter */
{
  const h = makeBindHarness({ recording: true });
  assert.strictEqual(h.api.ready(ROW()), false, 'the auto re-install ran while audio was attached to the binding');
  assert.strictEqual(h.calls.set.length, 0, 'a live recording had its binding (and epoch) replaced under it');

  const g = makeBindHarness({ genClickedAt: Date.now() });
  assert.strictEqual(g.api.ready(ROW()), false, 'the auto re-install ran mid-generation');
  assert.strictEqual(g.calls.set.length, 0, 'an in-flight generation had its binding replaced under it');
  ok('recording and generation are never re-bound underneath (no epoch churn)');
}

/* -------------------- 8. somebody else\'s destination is never overwritten */
{
  const cases = [
    ['a saved record reopened in the editor', { id: 'b-saved', source: 'saved-record', historical: true,
      patient: { name: PATIENT.name, patientId: PATIENT.id }, visitContext: { visitDate: '2026-01-02', provider: 'X', appointmentId: '999' } }],
    ['a restored draft with no verified route', { id: 'b-draft', source: 'restored-draft', routeBlocked: true,
      patient: { name: PATIENT.name, patientId: PATIENT.id }, visitContext: { visitDate: DAY, provider: 'X', appointmentId: '' } }],
    ['a binding already on a bound encounter', { id: 'b-enc', source: 'current',
      patient: { name: PATIENT.name, patientId: PATIENT.id },
      visitContext: { visitDate: DAY, provider: 'X', appointmentId: '', encounterId: '7', encounterUrl: 'https://athena/enc/7' } }],
    ['a binding on a DIFFERENT appointment', { id: 'b-other', source: 'scheduled-appointment',
      patient: { name: PATIENT.name, patientId: PATIENT.id },
      visitContext: { visitDate: DAY, provider: 'X', appointmentId: '8888888888' } }],
    ['a binding naming another patient', { id: 'b-who', source: 'current',
      patient: { name: 'Someone Else', patientId: 'other' }, visitContext: { visitDate: DAY, provider: 'X', appointmentId: '' } }]
  ];
  for (const [label, binding] of cases) {
    const h = makeBindHarness({ binding: binding });
    h.ctx.currentVisitAthenaBinding = binding;
    assert.strictEqual(h.api.replaceable(ROW()), false, label + ': the render loop claimed it may replace this binding');
    assert.strictEqual(h.api.ready(ROW()), false, label + ': the render loop replaced it');
    assert.strictEqual(h.calls.set.length, 0, label + ': the binding was mutated');
  }
  /* the one it MAY upgrade: this same visit, this same row, no destination yet */
  const weak = { id: 'b-weak', source: 'manual-entry', patient: { name: PATIENT.name, dob: PATIENT.dob, patientId: PATIENT.id },
    visitContext: { visitDate: DAY, provider: '', appointmentId: '', encounterId: '', encounterUrl: '' } };
  const up = makeBindHarness({ binding: weak, store: { [LEDGER_KEY]: ledger({
    'appointment-id:1272764709': { state: 'done', backendAppointmentId: 'backend-4407', appt_date: DAY } }) } });
  up.ctx.currentVisitAthenaBinding = weak;
  assert.strictEqual(up.api.ready(ROW()), true, 'a destination-less binding for this same visit was not upgraded');
  ok('only a destination-less binding for this same visit is upgraded; saved, restored, encounter-bound, other-appointment and other-patient routes are untouched (' + cases.length + ' refusals)');
}

/* ------------------------------------ 9. one attempt per row, not per paint */
{
  const h = makeBindHarness({ patients: [PATIENT], active: null });
  const row = ROW();
  for (let i = 0; i < 40; i++) assert.strictEqual(h.api.ready(row), false, 'a refused row started binding');
  assert.strictEqual(h.calls.freeze.length, 0, 'a refused row attempted a freeze');
  assert.strictEqual(h.calls.resolve.length <= 1, true,
    'the local-target resolver ran more than once for one row (it walks the whole patient store)');
  ok('a row the gate refuses costs ONE attempt, not one per 700ms paint');
}

/* ---------------- 10. the fresh row a re-pull hands back gets the app\'s own
 * resolver, not a second opinion of its own ------------------------------- */
{
  const h = makeBindHarness({ resolveTo: PATIENT.id });
  const fresh = ROW(); delete fresh._mlsTargetPatientId;   /* a re-pull replaces rows wholesale */
  assert.strictEqual(h.api.install(fresh), true, 'the re-pulled row could not bind');
  assert.strictEqual(h.calls.resolve.length, 1, 'the app\'s own _calResolveLocalPatient was not consulted');
  assert.strictEqual(fresh._mlsTargetPatientId, PATIENT.id, 'the fresh row was not stamped with the canonical local target');

  const conflict = makeBindHarness({});
  const bad = ROW(); delete bad._mlsTargetPatientId; bad._mlsIdentityConflict = true;
  assert.strictEqual(conflict.api.install(bad), false, 'a row the resolver marked an identity conflict was bound');
  assert.strictEqual(conflict.calls.set.length, 0, 'an identity-conflict row mutated the binding');
  ok('a re-pulled row is resolved by the app\'s OWN calStartVisit resolver; a flagged identity conflict still fails closed');
}

/* -------------------------------- 11. the notice still names the real blocker */
{
  assert(/typeof scheduledBindingReady === 'function'/.test(NOTICE_SLICE),
    'bindingNotice no longer asks before it accuses');
  assert(NOTICE_SLICE.indexOf('exactScheduledBindingMatches(S.appt)') > 0,
    'bindingNotice lost its read-only fallback for lifted harnesses');
  assert(NOTICE_SLICE.indexOf('This appointment row has no provider') > 0 &&
         NOTICE_SLICE.indexOf('opened by patient search') > 0 &&
         NOTICE_SLICE.indexOf('missing its exact Athena appointment ID') > 0,
    'bindingNotice stopped naming the real blocker');
  ok('bindingNotice still names provider-less, search-picked and id-less rows exactly as before');
}

/* ------ 12. the day-list badge asks per ROW per PAINT: one parse, not N ---- */
{
  const h = makeBindHarness({ store: { [LEDGER_KEY]: ledger({
    'appointment-id:111': { state: 'done', backendAppointmentId: 'r1', appt_date: DAY },
    'appointment-id:222': { state: 'done', backendAppointmentId: 'r2', appt_date: DAY }
  }) } });
  const rows = ['r1', 'r2', 'r3', 'r4', 'r5'].map(id => Object.assign(ROW(), { id }));
  for (let paint = 0; paint < 6; paint++) for (const r of rows) h.api.schedId(r);
  assert.strictEqual(h.calls.reads, 1,
    'the schedule-import ledger was re-read per row per paint (' + h.calls.reads + ' reads for 30 questions)');
  assert.strictEqual(h.api.schedId(rows[0]), '111', 'the cached index lost a resolvable row');
  assert.strictEqual(h.api.schedId(rows[4]), '', 'the cached index invented an id for an unledgered row');
  for (const r of rows) assert.strictEqual(r.__mlsLedgerApptId, undefined,
    'a ledger answer was memoised onto a _calAppts row, which outlives the ledger in the calendar cache');
  ok('the ledger is parsed once per day per TTL, never once per row per paint, and never memoised onto a cached row');
}

/* ---- 13. RECEIPT HONESTY: a RUNNING engine owns the surface it reports on --
 * __mlsDayHistoryPull v1.2.0's walk mutates the STATE object it closed over.
 * The schedule-import shim's ppState() replaces window.__mlsDayHistoryPull.state
 * with its own {__si:1} object the first time it paints, and the floating
 * "Pull day histories" button calls the engine's CLOSURE run() - which no
 * wrapper can see. After that swap the pull-face progress bar's running(), the
 * stuck-queue watcher's pullHolding() and the b121 busy guards all read a
 * DETACHED object saying running:false while charts are being opened, so the
 * bar may paint 100% and the queue watcher may cry "didn't save - retrying"
 * over a queue the pull is holding by design. */
{
  const ENGINE = slice(P1, "  function run(prefix, label) {\n    if (BUSY) { say('A history pull is already running", '  function mountBtn()');
  assert(/_pubG\.state !== STATE/.test(ENGINE) &&
         ENGINE.indexOf('_pubG.state !== STATE') < ENGINE.indexOf('STATE.running = true'),
    'the day-history engine does not re-publish its own STATE before raising running');

  const SI = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
  const PP = slice(SI, '    function ppState(){', '\n    function ');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(PP + '\nthis.pp = ppState;', ctx, { filename: 'si-ppState' });

  /* the engine installs, then the shim paints and takes the surface */
  const STATE = { running: false, total: 0, done: 0 };
  ctx.window.__mlsDayHistoryPull = { version: '1.2.0', state: STATE };
  const taken = ctx.pp();
  assert.notStrictEqual(taken, STATE, 'precondition: the shim did not take the surface');
  assert.strictEqual(taken.__si, 1, 'precondition: the shim state is not marked');

  /* now the floating button starts the closure walk: it re-publishes first */
  if (ctx.window.__mlsDayHistoryPull.state !== STATE) ctx.window.__mlsDayHistoryPull.state = STATE;
  STATE.running = true; STATE.total = 12;
  assert.strictEqual(ctx.window.__mlsDayHistoryPull.state.running, true,
    'a running day-history walk still reports running:false to every honesty consumer');
  assert.strictEqual(ctx.window.__mlsDayHistoryPull.state.total, 12, 'the published state is not the walking engine\'s');

  /* and the shim must not steal it back mid-walk (the other half of the pin) */
  assert.strictEqual(ctx.pp(), null, 'the shim stole the surface from a RUNNING engine');
  STATE.running = false;
  assert.strictEqual(ctx.pp().__si, 1, 'the shim could not re-take the surface after the walk ended');
  ok('a running day-history walk re-publishes its own state, and the import shim still refuses to steal a running one');
}

console.log('PASS pullbind: a pull-created visit carries its appointment binding — recovered from the day import ledger when the backend row lost it, re-installed instead of accused when the frozen binding was dropped, and never at the cost of a live encounter, another route, or an ambiguous same-day pick (' + n + ' cases)');

'use strict';
/* ============================================================================
   dobfill-1.0.0 - THE DUPLICATE MINT, and the ruling that closes it.

   MEASURED (pull-fix survey, b1234): 694 of 1857 stored patients carry neither
   a DOB nor an MRN. _athenaHistoryTargetSnapshot filtered every one of them
   OUT the moment the schedule row carried a DOB - _athenaHistoryDobSame is
   false when EITHER side has no digits, and the tolerant fallback pass demands
   a hard second factor - so `matches` came back empty and the create branch
   minted a brand-new chart for a patient the store already had. Every
   appointment for those 694 silently split the chart instead of filling it.

   THE RULING (owner, 8/28), which this suite pins in both directions:
     - a record with NO second factor is FILLED from the row when the tolerant
       name match yields exactly ONE candidate and no conflicting record;
     - anything weaker is a one-click SUGGESTION, never a silent merge;
     - nothing may be MINTED while a suggestion is pending;
     - a fill writes dob/mrn and its receipt - never a clinical field.

   The fail-closed controls are pinned as hard as the cure: two DOB-less
   candidates suggest instead of filling, a conflicting keyed record blocks the
   fill entirely, and an MRN-bearing record is not a candidate at all so no
   match this matcher already made can change.

   Both shells are executed - 1pScribeFlow.html and its twin 1p/index.html -
   because the identity code lives in both and a fix in one is a fork.
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
/* dobfill-1.0.1: the day pull mints inside the IMPORTER, not inside the
   shell, so the importer is executed here too - in the same context as the
   shell's resolver, exactly as the page loads them. */
const IMPORTER = '1p-feat_mls_schedimport_exact.js';
const IMPORTER_SRC = fs.readFileSync(path.join(root, IMPORTER), 'utf8');
const DAY_J = '2026-09-11';

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

/* ---- lift the identity block out of the shell ---------------------------- */
function liftIdentityBlock(shell) {
  const src = fs.readFileSync(path.join(root, shell), 'utf8');
  const start = src.indexOf('function _athenaHistoryDigits(v)');
  assert.ok(start >= 0, shell + ': _athenaHistoryDigits is gone');
  const end = src.indexOf('function _athenaHistoryTargetStillExact(target){', start);
  assert.ok(end > start, shell + ': _athenaHistoryTargetStillExact is gone');
  const block = src.slice(start, end);
  assert.ok(block.indexOf('dobfill-1.0.0') >= 0,
    shell + ': the dobfill-1.0.0 pass is missing - a keyless record still mints a duplicate');
  return block;
}

/* ---- a sandbox holding a roster and one account-local store -------------- */
function makeLane(block, patients, storage) {
  const store = storage || new Map();
  const localStorage = {
    getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(String(k)); }
  };
  const sandbox = {
    console,
    JSON,
    Date,
    Object,
    String,
    Number,
    Array,
    Math,
    localStorage,
    patients,
    uns(suffix) { return 'sf_u::doctor@example.test::' + suffix; },
    getPatients() { return patients; },
    upsertPatient(p) {
      const i = patients.findIndex((x) => x && x.id === p.id);
      p.updated = Date.now();
      if (i >= 0) patients[i] = p; else patients.push(p);
      return p;
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox, { filename: 'identity-block.js' });
  return { sandbox, store, patients };
}

function fillState(lane) { return lane.sandbox._athenaIdentityFillState(); }

const ROW_DOB = '1980-05-14';           /* ISO, exactly what an <input type=date> makes */
const ROW_DOB_DIGITS = '19800514';

function run(shell) {
  const block = liftIdentityBlock(shell);
  const label = (s) => shell + ': ' + s;

  /* ---------- A. THE PIN: fill, do not mint ------------------------------- */
  {
    const patients = [{ id: 'p1', name: 'Ada Sample', dob: '', mrn: '', problems: 'Asthma', visits: [] }];
    const lane = makeLane(block, patients);
    const target = lane.sandbox._athenaHistoryTargetSnapshot(
      { name: 'Ada Sample', dob: ROW_DOB, appointmentId: 'a1', scheduleDate: '2026-09-11' }, true);
    ok(target, label('A: a keyless record named like the row must BIND, not return null'));
    eq(target.patientId, 'p1', label('A: the pull bound the existing record'));
    eq(patients.length, 1, label('A: patients.length changed - a duplicate was minted'));
    eq(String(patients[0].dob).replace(/\D/g, ''), ROW_DOB_DIGITS, label('A: the row DOB was not written onto the record'));
    eq(fillState(lane).fills, 1, label('A: receipt identityFills is not 1'));
    /* created === 0 is patients.length above; the clinical field must be untouched */
    eq(patients[0].problems, 'Asthma', label('A: a clinical field was touched by an identity fill'));
    ok(Number(patients[0].identityFilledAt) > 0, label('A: the fill left no receipt stamp'));
    eq(patients[0].identityFilledFrom, 'athena-schedule', label('A: the fill receipt does not name its source'));
    eq(lane.sandbox.window.__mlsIdentityFillQueue().length, 0, label('A: an unambiguous fill must raise no suggestion'));
  }

  /* ---------- B. two DOB-less candidates -> suggestion, never a fill ------ */
  {
    const patients = [
      { id: 'p1', name: 'Ada Sample', dob: '', mrn: '' },
      { id: 'p2', name: 'Ada Sample', dob: '', mrn: '' }
    ];
    const lane = makeLane(block, patients);
    const target = lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', dob: ROW_DOB }, true);
    eq(target, null, label('B: two keyless candidates must fail closed'));
    eq(patients.length, 2, label('B: ambiguity minted a third record'));
    eq(String(patients[0].dob || '') + String(patients[1].dob || ''), '', label('B: an ambiguous match wrote a DOB anyway'));
    const queue = lane.sandbox.window.__mlsIdentityFillQueue();
    eq(queue.length, 1, label('B: no one-click suggestion was raised'));
    eq(queue[0].candidateIds.join(','), 'p1,p2', label('B: the suggestion does not name both candidates'));
    eq(fillState(lane).fills, 0, label('B: a fill happened under ambiguity'));

    /* and the mint stays blocked while that suggestion is pending */
    const again = lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', dob: ROW_DOB }, true);
    eq(again, null, label('B: the second import was not refused'));
    eq(patients.length, 2, label('B: a duplicate was minted while a suggestion was pending'));
  }

  /* ---------- C. a conflicting keyed record -> no fill -------------------- */
  {
    const patients = [
      { id: 'p1', name: 'Ada Sample', dob: '', mrn: '' },
      { id: 'p2', name: 'Ada Sample', dob: '01/01/1960', mrn: '' }
    ];
    const lane = makeLane(block, patients);
    const target = lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', dob: ROW_DOB }, true);
    eq(target, null, label('C: a conflicting keyed record must block the fill'));
    eq(patients.length, 2, label('C: a conflict minted a third record'));
    eq(String(patients[0].dob || ''), '', label('C: the keyless record was filled despite a conflict'));
    eq(String(patients[1].dob || ''), '01/01/1960', label('C: the conflicting record was rewritten'));
    const queue = lane.sandbox.window.__mlsIdentityFillQueue();
    eq(queue.length, 1, label('C: a conflict raised no suggestion'));
    eq(queue[0].conflictIds.join(','), 'p2', label('C: the suggestion does not name the conflicting record'));
    eq(fillState(lane).fills, 0, label('C: a fill happened over a conflict'));
  }

  /* ---------- D. MRN-bearing records are untouched ------------------------ */
  {
    const patients = [{ id: 'p1', name: 'Ada Sample', dob: '', mrn: 'MRN-9911' }];
    const lane = makeLane(block, patients);
    const target = lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', mrn: 'MRN-9911' }, true);
    ok(target, label('D: an exact MRN match stopped resolving'));
    eq(target.patientId, 'p1', label('D: the MRN match bound the wrong record'));
    eq(fillState(lane).fills, 0, label('D: an MRN-bearing record went through the fill pass'));
    eq(lane.sandbox.window.__mlsIdentityFillQueue().length, 0, label('D: an exact match raised a suggestion'));
    eq(patients[0].identityFilledAt, undefined, label('D: an MRN-bearing record was stamped by the fill'));
  }

  /* ---------- E. a genuinely new patient still mints ---------------------- */
  {
    const patients = [{ id: 'p1', name: 'Someone Else', dob: '', mrn: '' }];
    const lane = makeLane(block, patients);
    const target = lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Brand New', dob: ROW_DOB }, true);
    ok(target, label('E: a genuinely new patient must still be created'));
    eq(patients.length, 2, label('E: the new patient was not minted'));
    eq(patients[1].source, 'athena-schedule', label('E: the mint lost its source tag'));
    eq(fillState(lane).fills, 0, label('E: an unrelated name triggered a fill'));
  }

  /* ---------- F. the read path writes nothing ----------------------------- */
  {
    const patients = [{ id: 'p1', name: 'Ada Sample', dob: '', mrn: '' }];
    const lane = makeLane(block, patients);
    const target = lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', dob: ROW_DOB }, false);
    eq(target, null, label('F: a read-only snapshot must not bind a keyless record'));
    eq(String(patients[0].dob || ''), '', label('F: a read-only snapshot WROTE a DOB'));
    eq(fillState(lane).fills, 0, label('F: a read-only snapshot filled a record'));
  }

  /* ---------- G. the pending block survives a reload ---------------------- */
  {
    const patients = [
      { id: 'p1', name: 'Ada Sample', dob: '', mrn: '' },
      { id: 'p2', name: 'Ada Sample', dob: '', mrn: '' }
    ];
    const lane = makeLane(block, patients);
    lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', dob: ROW_DOB }, true);
    ok(lane.store.size > 0, label('G: the suggestion was never persisted'));

    /* a NEW sandbox over the SAME account storage is the reload */
    const after = makeLane(block, patients, lane.store);
    ok(after.sandbox._athenaIdentitySuggestionPending('Ada Sample'),
      label('G: the pending suggestion did not survive the reload'));
    const target = after.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', dob: ROW_DOB }, true);
    eq(target, null, label('G: the post-reload import was not refused'));
    eq(patients.length, 2, label('G: a duplicate was minted after a reload'));
    eq(fillState(after).blockedMints >= 0, true, label('G: blockedMints is not a number'));
  }

  /* ---------- H. the one click resolves it ------------------------------- */
  {
    const patients = [
      { id: 'p1', name: 'Ada Sample', dob: '', mrn: '' },
      { id: 'p2', name: 'Ada Sample', dob: '', mrn: '' }
    ];
    const lane = makeLane(block, patients);
    lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', dob: ROW_DOB }, true);
    const key = lane.sandbox.window.__mlsIdentityFillQueue()[0].key;

    const wrong = lane.sandbox.window.__mlsIdentityFillApply(key, 'not-a-candidate');
    eq(wrong.ok, false, label('H: the one-click applier accepted a record outside the suggestion'));

    const applied = lane.sandbox.window.__mlsIdentityFillApply(key, 'p2');
    eq(applied.ok, true, label('H: the one-click applier refused a named candidate'));
    eq(String(patients[1].dob).replace(/\D/g, ''), ROW_DOB_DIGITS, label('H: the click wrote no DOB'));
    eq(String(patients[0].dob || ''), '', label('H: the click wrote onto the record the doctor did NOT name'));
    eq(lane.sandbox.window.__mlsIdentityFillQueue().length, 0, label('H: the suggestion stayed in the queue after being answered'));
    eq(patients.length, 2, label('H: answering the suggestion minted a record'));

    /* with the ambiguity resolved the next import binds the filled record */
    const target = lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', dob: ROW_DOB }, true);
    ok(target, label('H: the resolved identity still does not bind'));
    eq(target.patientId, 'p2', label('H: the resolved import bound the wrong record'));
    eq(patients.length, 2, label('H: the resolved import minted a duplicate'));
  }

  /* ---------- I. a tolerant spelling fills, an unrelated name does not ---- */
  {
    const patients = [{ id: 'p1', name: 'Sample, Ada R', dob: '', mrn: '' }];
    const lane = makeLane(block, patients);
    const target = lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ada Sample', dob: ROW_DOB }, true);
    ok(target, label('I: athena LAST-FIRST spelling of a keyless record did not resolve'));
    eq(target.patientId, 'p1', label('I: the tolerant name match bound the wrong record'));
    eq(patients.length, 1, label('I: a spelling variant minted a duplicate'));
  }
  {
    const patients = [{ id: 'p1', name: 'Ann Cubbage Reilly', dob: '', mrn: '' }];
    const lane = makeLane(block, patients);
    const target = lane.sandbox._athenaHistoryTargetSnapshot({ name: 'Ann Smith', dob: ROW_DOB }, true);
    eq(patients.length, 2, label('I: an unrelated name was merged into a keyless record'));
    eq(String(patients[0].dob || ''), '', label('I: an unrelated name filled a keyless record'));
    ok(target && target.patientId !== 'p1', label('I: an unrelated name bound the keyless record'));
  }
}

/* ---- the two shells must carry the SAME hunk ----------------------------- */
function twinsAgree() {
  const blocks = SHELLS.map(liftIdentityBlock);
  eq(blocks[0], blocks[1],
    'the identity block has FORKED between 1pScribeFlow.html and 1p/index.html - apply identical hunks to both');
}

/* ============================================================================
   J. THE PATH THE DAY PULL ACTUALLY TAKES (dobfill-1.0.1)

   MEASURED 2026-09-11, and it REFUTED the cure above for the lane that matters:
   a real day pull does not call _athenaHistoryTargetSnapshot at all. The
   importer mints through materializePatient -> findPatient/padoptResolve ->
   stableId -> upsertPatient, so with the snapshot pass landed the roster still
   went 7 -> 9, the chart facts landed on the fresh duplicates, the originals
   kept dob:'' and the receipt said identityFills:0 / mintAttempted:2 /
   {tolerant-name-unproven:2}.

   The cure is not a second copy of the rule: the importer asks THIS file's
   resolver through window.__mlsIdentityFillResolve / ...Pending /
   ...BlockMint. So this section runs BOTH files in ONE context - the shell's
   identity block and the real importer - and drives importAppts, which is the
   function the day pull calls.
   ========================================================================== */
function makeImportWorld(block, patients) {
  const store = new Map();
  const posted = [];
  let backendRows = [];
  const sandbox = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, Boolean,
    RegExp, Error, TypeError, Set, Map, encodeURIComponent, decodeURIComponent, queueMicrotask,
    setTimeout: (fn) => { void fn; return 0; }, clearTimeout: () => {},
    setInterval: () => 1, clearInterval: () => {},
    location: { pathname: '/1pScribeFlow.html', origin: 'https://local.invalid' },
    navigator: { userAgent: 'dobfill-suite' },
    localStorage: {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)); },
      removeItem: (k) => { store.delete(String(k)); }
    },
    document: {
      readyState: 'complete', visibilityState: 'visible',
      querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } }),
      addEventListener: () => {}, removeEventListener: () => {},
      body: {}, head: {}, documentElement: {}
    },
    backendMode: () => true,
    bkToken: () => 'dobfill-token',
    bkBase: () => 'https://local.invalid',
    uns: (key) => 'sf_u::doctor@example.test::' + key,
    _normDate: (v) => String(v || '').slice(0, 10),
    _normTime: (v) => {
      const s = String(v || '').trim();
      const m = s.match(/(?:T)?(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
      if (!m) return '';
      let hour = Number(m[1]);
      if (m[3] && /PM/i.test(m[3]) && hour < 12) hour += 12;
      if (m[3] && /AM/i.test(m[3]) && hour === 12) hour = 0;
      return String(hour).padStart(2, '0') + ':' + m[2];
    },
    _acctWallToUtcIso: (date, time) => date + 'T' + time + ':00.000Z',
    _acctTodayKey: () => '2026-09-11',
    getPatients: () => patients,
    upsertPatient: (p) => {
      const at = patients.findIndex((x) => String(x.id) === String(p.id));
      if (at >= 0) patients[at] = p; else patients.push(p);
      return p;
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
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => true;
  sandbox.postMessage = () => {};
  vm.createContext(sandbox);
  /* the SHELL half first: it is what publishes the resolver the importer asks */
  vm.runInContext(block, sandbox, { filename: 'identity-block.js' });
  vm.runInContext(IMPORTER_SRC, sandbox, { filename: IMPORTER, timeout: 20000 });
  assert.ok(sandbox.__mlsSI, 'the importer did not publish __mlsSI');
  return { sandbox, api: sandbox.__mlsSI, patients, posted, store };
}

function apptRow(name, dob, extra) {
  return Object.assign({
    appointmentId: 'athena-appt-' + Math.random().toString(36).slice(2, 8),
    name: name, dob: dob, date: DAY_J, time: '09:20',
    provider: 'Doctor One', providerId: 'provider-1'
  }, extra || {});
}

async function dayPullPins(shell) {
  const block = liftIdentityBlock(shell);
  const label = (s) => shell + ' [day pull]: ' + s;

  /* --- J1: the measured defect. One keyless record, one row carrying a DOB.
     BEFORE: a second record was minted (p_sched_*) and the original kept
     dob:''. AFTER: the stored record is FILLED and bound, nothing minted. */
  {
    const patients = [{ id: 'p-keyless', name: 'Ada Sample', dob: '', mrn: '', problems: 'Asthma' }];
    const w = makeImportWorld(block, patients);
    const res = await w.api.importAppts([apptRow('Ada Sample', '05/14/1980')],
      { date: DAY_J, scopeDate: DAY_J, requirePatientBinding: true });

    eq(patients.length, 1, label('J1: the day pull MINTED a duplicate for a record the store already had'));
    ok(!patients.some((p) => /^p_sched_/.test(String(p.id))), label('J1: a p_sched_ duplicate is in the roster'));
    /* the fill writes the row's OWN spelling, so the pin is the row's digits */
    eq(String(patients[0].dob).replace(/\D/g, ''), '05141980', label('J1: the row DOB was not written onto the stored record'));
    eq(patients[0].problems, 'Asthma', label('J1: the identity fill touched a clinical field'));
    eq(res.identityFills, 1, label('J1: the import receipt does not report the fill'));
    eq((res.adoptionReceipt || {}).mintAttempted, 0, label('J1: a mint was still attempted after the fill'));
    eq(res.historyTargets.length, 1, label('J1: the filled record did not become a history target'));
    eq(res.historyTargets[0]._mlsTargetPatientId, 'p-keyless',
      label("J1: the day's chart facts would still be saved onto the wrong record"));
    eq(String((w.posted[0] || {}).body ? w.posted[0].body.patient_external_id : ''), 'p-keyless',
      label('J1: the backend appointment row is bound to the duplicate'));
  }

  /* --- J2: two keyless candidates. The day pull minted a THIRD record with
     identitySuggestions 0 and no queue entry. It must refuse instead. */
  {
    const patients = [
      { id: 'p-a', name: 'Bea Sample', dob: '', mrn: '' },
      { id: 'p-b', name: 'Bea Sample', dob: '', mrn: '' }
    ];
    const w = makeImportWorld(block, patients);
    const res = await w.api.importAppts([apptRow('Bea Sample', '05/14/1980')],
      { date: DAY_J, scopeDate: DAY_J, requirePatientBinding: true });

    eq(patients.length, 2, label('J2: ambiguity minted a third record on the day-pull path'));
    eq(String(patients[0].dob || '') + String(patients[1].dob || ''), '', label('J2: an ambiguous match wrote a DOB anyway'));
    eq(res.identityFills, 0, label('J2: a fill happened under ambiguity'));
    ok(res.identitySuggestions >= 1, label('J2: no one-click suggestion rode the import receipt'));
    eq(w.sandbox.window.__mlsIdentityFillQueue().length, 1, label('J2: the suggestion is not in the queue'));
    eq(w.sandbox.window.__mlsIdentityFillQueue()[0].candidateIds.join(','), 'p-a,p-b',
      label('J2: the suggestion does not name both candidates'));
    const unresolved = (res.historyUnresolved || []).map((u) => String(u && u.reason || ''));
    ok(unresolved.indexOf('identity-suggestion-pending') >= 0,
      label('J2: the refused row does not name the question it is waiting on: ' + unresolved.join('|')));
    eq(Number((res.failureReasons || {})['identity-suggestion-pending'] || 0), 1,
      label('J2: the import census does not count the refusal as its own class'));
    eq(res.created, 0, label('J2: a backend appointment was created for an unresolved identity'));
  }

  /* --- J3: never mint while a suggestion is pending. The suggestion from J2
     is answered by nobody; a LATER row for the same name must still refuse,
     and that refusal has to survive a reload of the page. */
  {
    const patients = [
      { id: 'p-a', name: 'Cy Sample', dob: '', mrn: '' },
      { id: 'p-b', name: 'Cy Sample', dob: '', mrn: '' }
    ];
    const w = makeImportWorld(block, patients);
    await w.api.importAppts([apptRow('Cy Sample', '05/14/1980')],
      { date: DAY_J, scopeDate: DAY_J, requirePatientBinding: true });
    eq(patients.length, 2, label('J3: the first ambiguous row minted'));

    const res2 = await w.api.importAppts([apptRow('Cy Sample', '05/14/1980', { time: '11:40' })],
      { date: DAY_J, scopeDate: DAY_J, requirePatientBinding: true });
    eq(patients.length, 2, label('J3: a second appointment minted while a suggestion was pending'));
    ok(res2.identityMintsBlocked >= 1, label('J3: the blocked mint is not on the receipt'));

    /* the doctor answers it - and only then does the row bind, to the record
       he named, with no new record created. */
    const key = w.sandbox.window.__mlsIdentityFillQueue()[0].key;
    const applied = w.sandbox.window.__mlsIdentityFillApply(key, 'p-b');
    eq(applied.ok, true, label('J3: the one click was refused'));
    const res3 = await w.api.importAppts([apptRow('Cy Sample', '05/14/1980', { time: '13:10' })],
      { date: DAY_J, scopeDate: DAY_J, requirePatientBinding: true });
    eq(patients.length, 2, label('J3: the answered import minted a record anyway'));
    eq(res3.historyTargets.length, 1, label('J3: the answered import produced no history target'));
    eq(res3.historyTargets[0]._mlsTargetPatientId, 'p-b', label('J3: the answered import bound the record the doctor did not name'));
  }

  /* --- J4: THE CONTROL. A genuinely new patient still mints, and a row with
     no second factor at all is still refused exactly as before. */
  {
    const patients = [{ id: 'p-a', name: 'Someone Else', dob: '', mrn: '' }];
    const w = makeImportWorld(block, patients);
    const res = await w.api.importAppts([apptRow('Brand New', '05/14/1980')],
      { date: DAY_J, scopeDate: DAY_J, requirePatientBinding: true });
    eq(patients.length, 2, label('J4: a genuinely new proven patient is no longer created'));
    eq(res.identityFills, 0, label('J4: an unrelated name triggered a fill'));
    eq((res.adoptionReceipt || {}).mintAttempted, 1, label('J4: the unavoidable mint is no longer recorded as one'));

    const patients2 = [{ id: 'p-a', name: 'Dee Sample', dob: '', mrn: '' }];
    const w2 = makeImportWorld(block, patients2);
    const res2 = await w2.api.importAppts([apptRow('Dee Sample', '')],
      { date: DAY_J, scopeDate: DAY_J, requirePatientBinding: true });
    eq(patients2.length, 1, label('J4: a row with NO second factor minted'));
    eq(String(patients2[0].dob || ''), '', label('J4: a row with no DOB filled a record'));
    eq(res2.identityFills, 0, label('J4: a row with no second factor was counted as a fill'));
    eq(w2.sandbox.window.__mlsIdentityFillQueue().length, 0, label('J4: a row with no second factor raised a suggestion'));
  }

  /* --- J5: the importer must not carry a private copy of the rule. */
  {
    ok(IMPORTER_SRC.indexOf('__mlsIdentityFillResolve') > 0,
      label('J5: the importer does not consult the shell resolver at all'));
    ok(IMPORTER_SRC.indexOf('__mlsIdentityFillBlockMint') > 0,
      label('J5: the importer cannot see a pending suggestion'));
    ok(IMPORTER_SRC.indexOf('_athenaIdentityDoblessCandidates') < 0,
      label('J5: the importer grew its OWN copy of the keyless matcher - one resolver, one rule'));
  }

  /* --- J6: with the shell absent the importer behaves exactly as before. */
  {
    const patients = [{ id: 'p-keyless', name: 'Ada Sample', dob: '', mrn: '' }];
    const w = makeImportWorld('/* shell not present */', patients);
    const res = await w.api.importAppts([apptRow('Ada Sample', '05/14/1980')],
      { date: DAY_J, scopeDate: DAY_J, requirePatientBinding: true });
    eq(patients.length, 2, label('J6: without the shell the importer changed behaviour'));
    eq(res.identityFills, 0, label('J6: a fill was reported with no resolver on the page'));
  }
}

twinsAgree();
SHELLS.forEach(run);

/* silentpass-1.0.0: the day-pull half is async, so a promise that never
   settles would drain the event loop and exit 0 having asserted nothing. */
let finished = false;
process.on('exit', (code) => {
  if (code === 0 && !finished) {
    console.error('identity-dobless-fill-not-mint-runtime: the day-pull tail never settled - NO verdict');
    process.exitCode = 1;
  }
});

(async () => {
  for (const shell of SHELLS) await dayPullPins(shell);
  finished = true;
  console.log('identity-dobless-fill-not-mint-runtime: ' + checks + ' checks passed across ' + SHELLS.length + ' shells (shell snapshot AND day-pull import path)');
})().catch((e) => { console.error(e); process.exit(1); });

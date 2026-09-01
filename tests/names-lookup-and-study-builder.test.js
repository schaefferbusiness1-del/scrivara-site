'use strict';

/* nameslookup-1.0.0 + srcontrast-1.0.0 - THE PASTED-NAMES LANE AND THE
 * STUDY BUILDER'S LEGIBILITY, BOTH EXECUTED
 *
 * TWO OWNER DIRECTIVES, 2026-09-01:
 *   1. (screenshot of the Natural-Language Study Builder painting almost all
 *      of its prose at placeholder contrast) "this sohudl work to".
 *   2. "the way the extension currently works, it pulls the schedule and then
 *      looks every single name up. Well, we can just pull any schedule and ...
 *      or any set of names, and it can look everyone up. Make sure that that
 *      feature is also possible in the study creator."
 *
 * THIS SUITE EXECUTES REAL SHIPPED BYTES. Nothing is grepped that could be
 * run instead:
 *   - the /1p schedule importer runs in a vm, and its exported
 *     __mlsSI.namesLookup parser/resolver/preflight/run are driven directly;
 *   - the cohort builder slice is EXTRACTED FROM 1p-mls-connect.js by its own
 *     source markers and executed, so the filter this suite proves is the
 *     filter that ships;
 *   - the Study Builder stylesheet is EXTRACTED FROM feat_mls_study_request.js
 *     as the real CSS array literal and evaluated, then every colour in it is
 *     measured with the WCAG relative-luminance formula.
 *
 * SYNTHETIC IDENTITIES ONLY. No network, no extension, no browser, no PHI.
 *
 * THE LAWS IT PINS:
 *   NEVER  attach a chart on a name alone (owner ruling 2026-08-28) and never
 *          mint a second chart for a spelling variant of one already on file
 *          (memory: exact-name-matching-mints-duplicate-patients).
 *   ALWAYS refuse - having started nothing - while an Athena lane is busy in
 *          this tab or another one.
 *   ALWAYS list an excluded person with a reason; a cohort that silently
 *          drops people makes every statistic in the paper a lie.
 *   ALWAYS paint the study panel's prose above WCAG AA, from rules that carry
 *          enough specificity that a later theme rule cannot re-ghost them.
 * ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const IMPORTER = path.join(root, '1p-feat_mls_schedimport_exact.js');
const CONNECT = path.join(root, '1p-mls-connect.js');
const STUDY = path.join(root, 'feat_mls_study_request.js');

const importerSource = fs.readFileSync(IMPORTER, 'utf8');
const connectSource = fs.readFileSync(CONNECT, 'utf8');
const studySource = fs.readFileSync(STUDY, 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
/* a-suite-can-pass-without-running: every asynchronous assertion is held in
   this list and AWAITED before the suite is allowed to announce anything. A
   .then() left to drain would count as a silent pass. */
const pending = [];

/* ======================================================= the vm world ==== */
function makeWorld(patients) {
  const store = new Map();
  const posted = [];
  const ctx = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, Boolean,
    RegExp, Error, TypeError, Set, Map, encodeURIComponent, decodeURIComponent, queueMicrotask,
    setTimeout: (fn) => { void fn; return 0; }, clearTimeout: () => {},
    setInterval: () => 1, clearInterval: () => {},
    location: { pathname: '/1pScribeFlow.html', origin: 'https://local.invalid' },
    navigator: { userAgent: 'names-lookup-proof' },
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
    bkToken: () => 'names-lookup-proof',
    bkBase: () => 'https://local.invalid',
    uns: key => 'names-lookup-proof::' + key,
    getPatients: () => patients,
    upsertPatient: p => {
      const at = patients.findIndex(x => String(x.id) === String(p.id));
      if (at >= 0) patients[at] = p; else patients.push(p);
    },
    savePatients: () => true,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ appointments: [] }) })
  };
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};
  ctx.dispatchEvent = () => true;
  ctx.postMessage = (msg) => { posted.push(msg); };
  vm.runInNewContext(importerSource, ctx, { filename: '1p-feat_mls_schedimport_exact.js', timeout: 20000 });
  return { ctx, api: ctx.__mlsSI, NL: ctx.__mlsSI.namesLookup, patients, posted, store };
}

/* the store shapes the owner's live account actually holds */
const CHART_BROOKS = { id: 'p1755884400000', name: 'Bernard Brooks', dob: '1970-01-02' };
const CHART_ADAM = { id: 'p1755884400001', name: 'Adam J Schaeffer', dob: '03/04/1975', mrn: '7833832' };
const CHART_MARY_NOPROOF = { id: 'p1755884400002', name: 'Mary Anne Smith', dob: '' };
const CHART_JONES = { id: 'p1755884400003', name: 'Robert Jones', dob: '01/01/1960' };
function freshStore() {
  return [CHART_BROOKS, CHART_ADAM, CHART_MARY_NOPROOF, CHART_JONES].map(p => Object.assign({}, p));
}

/* =========================================== 1  THE LINE PARSER ========== */
{
  const w = makeWorld(freshStore());
  const NL = w.NL;
  ok(NL && typeof NL.parseLine === 'function', 'nameslookup-1.0.0 did not export parseLine - the law cannot be executed');
  eq(NL.version, 'nameslookup-1.0.0', 'the names-lookup version token moved');

  /* --- the two name orders, and both DOB spellings --------------------- */
  const lastFirst = NL.parseLine('Schaeffer, Adam  01/02/1980', 1);
  eq(lastFirst.ok, true, 'a "Last, First" line with a slashed DOB did not parse');
  eq(lastFirst.name, 'Schaeffer, Adam', 'the comma name form was mangled');
  eq(lastFirst.dob, '01/02/1980', 'the slashed DOB was not lifted off the line');
  eq(lastFirst.mrn, '', 'a DOB was mistaken for an MRN - the date scan must claim its digits first');

  const firstLast = NL.parseLine('Bernard P Brooks 1970-01-02', 2);
  eq(firstLast.ok, true, 'a "First Last" line with an ISO DOB did not parse');
  eq(firstLast.name, 'Bernard P Brooks', 'a middle initial was dropped from the name');
  eq(firstLast.dob, '1970-01-02', 'the ISO DOB was not lifted off the line');
  eq(firstLast.mrn, '', 'the ISO DOB digits leaked into the MRN');

  /* --- the MRN, bare and labelled, and a bullet/number list marker ------ */
  const withMrn = NL.parseLine('Adam J Schaeffer 7833832', 3);
  eq(withMrn.mrn, '7833832', 'a bare digit run was not read as an MRN');
  eq(withMrn.name, 'Adam J Schaeffer', 'the MRN digits stayed stuck to the name');
  const labelled = NL.parseLine('  - Bernard P Brooks | MRN 48211937 | 1970-01-02', 4);
  eq(labelled.ok, true, 'a pipe-separated, bullet-prefixed line did not parse');
  eq(labelled.name, 'Bernard P Brooks', 'a list bullet or the MRN label survived into the name');
  eq(labelled.mrn, '48211937', 'a labelled MRN was not read');
  eq(labelled.dob, '1970-01-02', 'the DOB in a later field was not read');
  eq(NL.parseLine('1. Mary Anne Smith  05/06/1965', 5).name, 'Mary Anne Smith',
    'a numbered list marker survived into the name');

  /* --- GARBAGE fails loudly, and says which kind ----------------------- */
  eq(NL.parseLine('', 6).reason, 'blank-line', 'an empty line was not named as blank');
  eq(NL.parseLine('12345', 7).ok, false, 'a bare number was accepted as a person');
  eq(NL.parseLine('12345', 7).reason, 'no-usable-name', 'a bare number was refused for the wrong reason');
  eq(NL.parseLine('x', 8).ok, false, 'a one-token scrap was accepted as a person');
  const badDate = NL.parseLine('Bob Jones 13/45/1980', 9);
  eq(badDate.ok, false, 'an impossible date was silently dropped instead of shown to the doctor');
  eq(badDate.reason, 'unreadable-date', 'an impossible date was refused for the wrong reason');
  /* control: the SAME line with a real date parses - so the refusal above
     is about the date, not about the shape of the line. */
  eq(NL.parseLine('Bob Jones 12/04/1980', 9).ok, true, 'the control line with a real date failed too');

  /* an MRN written as "#7833832" must not lose its digits to the bullet
     stripper - the stripper only eats punctuation followed by a SPACE */
  eq(NL.parseLine('Adam Schaeffer #7833832', 10).mrn, '7833832', 'a hash-prefixed MRN was eaten by the list-marker stripper');
}

/* ============================== 2  THE RESOLVER VERDICTS ================= */
{
  const patients = freshStore();
  const w = makeWorld(patients);
  const NL = w.NL;

  function verdictOf(line) {
    const plan = NL.plan(line, { patients: patients });
    return plan.rows[0];
  }

  /* --- MRN is proof ---------------------------------------------------- */
  const byMrn = verdictOf('Schaeffer, Adam #7833832');
  eq(byMrn.verdict, 'matched-chart', 'an MRN that is on file did not attach its chart');
  eq(byMrn.reason, 'mrn-proof', 'the MRN attach did not name MRN as its proof');
  eq(byMrn.patientId, CHART_ADAM.id, 'the MRN attach landed on the wrong chart');

  /* --- name + DOB is proof, through the TOLERANT comparator ------------ */
  const byNameDob = verdictOf('Brooks, Bernard P 01/02/1970');
  eq(byNameDob.verdict, 'matched-chart', 'a differently-shaped name with an agreeing DOB did not attach');
  eq(byNameDob.reason, 'name-dob-proof', 'the name+DOB attach did not name its proof');
  eq(byNameDob.patientId, CHART_BROOKS.id, 'the name+DOB attach landed on the wrong chart');

  /* the same pair with ONLY the DOB moved must refuse to attach - the
     control that proves the name is not doing the identity work */
  const dobMoved = verdictOf('Brooks, Bernard P 03/04/1988');
  ok(dobMoved.verdict !== 'matched-chart', 'a CONFLICTING DOB still attached a chart - the identity gate was weakened');
  eq(dobMoved.verdict, 'new-lookup', 'a same-name different-DOB human was not treated as a new person');
  eq(dobMoved.reason, 'same-name-different-proof', 'a proof conflict was not named as one');

  /* --- A NAME ALONE IS NEVER AN ATTACH (the owner ruling) -------------- */
  const nameOnly = verdictOf('Bernard Brooks');
  ok(nameOnly.verdict !== 'matched-chart', 'A NAME ALONE ATTACHED A CHART - owner ruling 2026-08-28 violated');
  eq(nameOnly.verdict, 'suggest-confirm', 'a name-only line with one reconciling chart was not offered as a one-click suggestion');
  eq(nameOnly.patientId, '', 'a name-only line carried a bound patientId before the doctor confirmed anything');
  eq(nameOnly.suggestId, CHART_BROOKS.id, 'the suggestion did not name the chart it means');
  eq(nameOnly.candidates.length, 1, 'the suggestion did not carry its named candidate');

  /* a name-only line for somebody with NO chart refuses honestly */
  const strangerNameOnly = verdictOf('Nora Vance');
  eq(strangerNameOnly.verdict, 'needs-dob-or-mrn', 'a name-only stranger was not told what is missing');
  eq(strangerNameOnly.patientId, '', 'a name-only stranger carried a chart id');

  /* --- AMBIGUITY fails closed and NAMES its candidates ----------------- */
  const two = patients.concat([{ id: 'p-native-dup', name: 'Brooks, Bernard', dob: '01/02/1970' }]);
  const ambiguous = NL.plan('Bernard P Brooks 01/02/1970', { patients: two }).rows[0];
  eq(ambiguous.verdict, 'ambiguous', 'TWO agreeing charts produced a binding instead of a refusal');
  eq(ambiguous.patientId, '', 'an ambiguous line still carried a chart id');
  ok(ambiguous.candidates.length >= 2, 'an ambiguous refusal did not name its candidates');

  /* a name-only line with TWO reconciling charts is ambiguity too, never a
     silent pick of the first */
  const ambiguousNameOnly = NL.plan('Bernard Brooks', { patients: two }).rows[0];
  eq(ambiguousNameOnly.verdict, 'ambiguous', 'a name-only line with two charts picked one instead of refusing');

  /* --- A CHART WITH NO PROOF OF ITS OWN IS NOT A MINT TARGET ----------- */
  /* Mary Anne Smith is on file with no DOB and no MRN. A pasted line for
     her carries a DOB. Minting there is exactly how a spelling variant
     becomes a duplicate chart, so it must stop and ask. */
  const unproven = verdictOf('Mary Anne Smith 05/06/1965');
  eq(unproven.verdict, 'suggest-confirm', 'a chart with no second factor was about to be duplicated by a mint');
  eq(unproven.reason, 'chart-has-no-proof', 'the duplicate-mint refusal was not named');

  /* --- NOT FOUND: real proof, genuinely nobody on file ----------------- */
  const stranger = verdictOf('Nora Vance 06/07/1988');
  eq(stranger.verdict, 'new-lookup', 'a proven stranger was not queued for an Athena lookup');
  eq(stranger.reason, 'no-chart-on-file', 'the stranger verdict did not say why');

  /* --- duplicate lines are receipted, not silently collapsed ---------- */
  const dupPlan = NL.plan('Schaeffer, Adam #7833832\nSchaeffer, Adam #7833832', { patients: patients });
  eq(dupPlan.rows.length, 2, 'a duplicate line vanished instead of getting its own receipt');
  eq(dupPlan.rows[1].verdict, 'duplicate-line', 'the second copy of a person was not named as a duplicate');
  eq(dupPlan.rows[1].duplicateOfLine, 1, 'the duplicate receipt did not point at the line it repeats');
  eq(dupPlan.lookupCount, 1, 'a duplicate line was counted twice into the lookup total');

  /* --- EVERY line gets a receipt; nothing is dropped ------------------- */
  const mixed = NL.plan([
    'Schaeffer, Adam #7833832',
    'Bernard Brooks',
    'Nora Vance 06/07/1988',
    'zzz',
    'Bob Jones 13/45/1980'
  ].join('\n'), { patients: patients });
  eq(mixed.total, 5, 'the plan lost a line');
  eq(mixed.rows.length, 5, 'the plan did not produce one receipt per line');
  mixed.rows.forEach((r, i) => {
    ok(!!r.verdict, 'line ' + (i + 1) + ' came back with no verdict at all');
    ok(!!r.reason, 'line ' + (i + 1) + ' came back with no reason code');
    ok(NL.verdicts().indexOf(r.verdict) >= 0, 'line ' + (i + 1) + ' used a verdict outside the closed vocabulary: ' + r.verdict);
  });
}

/* ============================ 3  BUSY / SHIELD REFUSALS ================== */
{
  /* --- this tab is mid-pull ------------------------------------------- */
  const w1 = makeWorld(freshStore());
  w1.ctx.__mlsPullBusyAt = Date.now();
  const pre1 = w1.NL.preflight();
  eq(pre1.ok, false, 'a fresh same-tab pull-busy stamp did not refuse the lookup');
  eq(pre1.code, 'pull-in-flight', 'a same-tab busy stamp was not named pull-in-flight');

  /* --- and the run REFUSES HAVING STARTED NOTHING ---------------------- */
  {
    const before = w1.patients.length;
    const res = w1.NL.run('Nora Vance 06/07/1988', null, { patients: w1.patients });
    ok(res && typeof res.then === 'function', 'run() did not return a promise');
    pending.push(res.then((r) => {
      eq(r.started, false, 'the lookup STARTED while this tab was mid-pull');
      eq(r.code, 'pull-in-flight', 'the busy refusal did not carry its code');
      ok(/pull/i.test(String(r.error)), 'the busy refusal did not say why in words');
      eq(w1.patients.length, before, 'a refused lookup still minted a chart');
      eq(w1.posted.length, 0, 'a refused lookup still spoke to the extension');
      ok(Array.isArray(r.receipts) && r.receipts.length === 1, 'a refusal came back without its per-line receipts');
    }));
  }

  /* --- another TAB is mid-pull (the cross-tab shield) ------------------ */
  const w2 = makeWorld(freshStore());
  w2.ctx.localStorage.setItem(w2.ctx.uns('mlsPullBusyXTabV1'), String(Date.now()));
  const pre2 = w2.NL.preflight();
  eq(pre2.ok, false, 'the cross-tab pull shield did not refuse the lookup');
  eq(pre2.code, 'other-tab-pulling', 'the cross-tab shield refusal was not named');

  /* --- another tab holds the page lease -------------------------------- */
  const w3 = makeWorld(freshStore());
  w3.ctx.__mlsSchedulePullLease = { id: 'some-other-tab', kind: 'si-pull', at: Date.now() };
  eq(w3.NL.preflight().code, 'other-tab-pulling', 'a fresh FOREIGN pull lease did not refuse the lookup');

  /* --- the idle note catch-up is on a chart ---------------------------- */
  const w4 = makeWorld(freshStore());
  w4.ctx.__mlsNotesIdle = { reading: () => true };
  eq(w4.NL.preflight().code, 'notes-idle-reading', 'the background note reader did not refuse the lookup');

  /* --- CONTROL: an idle tab is READY ----------------------------------- */
  const w5 = makeWorld(freshStore());
  eq(w5.NL.preflight().ok, true, 'an idle tab refused a lookup - the preflight is stuck closed');
  eq(w5.NL.preflight().code, 'ready', 'an idle tab did not report ready');

  /* --- a STALE stamp does not refuse forever --------------------------- */
  const w6 = makeWorld(freshStore());
  w6.ctx.__mlsPullBusyAt = Date.now() - (10 * 60 * 1000);
  eq(w6.NL.preflight().ok, true, 'a ten-minute-old busy stamp still refused - the shield never ages out');

  /* --- nothing to look up: refuse rather than open Athena for nobody --- */
  const w7 = makeWorld(freshStore());
  pending.push(w7.NL.run('Nora Vance\nzzz', null, {}).then((r) => {
    eq(r.started, false, 'a list with nothing lookupable still started an Athena run');
    eq(r.code, 'nothing-to-look-up', 'the empty-plan refusal was not named');
    eq(w7.posted.length, 0, 'a list with nothing lookupable still spoke to the extension');
  }));
}

/* =========================== 4  THE MINT IS THE LAST RESORT ============== */
{
  const patients = freshStore();
  const w = makeWorld(patients);
  const NL = w.NL;
  const before = patients.length;

  /* a name-only row can never mint - patientIdentity refuses it */
  const noProof = NL._mint(patients, { name: 'Nora Vance', dob: '', mrn: '' });
  eq(noProof.patient, null, 'A NAME ALONE MINTED A CHART');
  eq(noProof.why, 'no-dob-and-no-mrn', 'the name-only mint refusal was not named');
  eq(patients.length, before, 'the refused mint still wrote to the store');

  /* a spelling variant of a chart ALREADY on file must adopt, never mint */
  const variant = NL._mint(patients, { name: 'Brooks, Bernard P', dob: '01/02/1970', mrn: '' });
  eq(variant.created, false, 'a spelling variant of an existing chart MINTED A DUPLICATE');
  eq(variant.patient && variant.patient.id, CHART_BROOKS.id, 'the spelling variant did not adopt the chart on file');
  eq(patients.length, before, 'the adopted variant still grew the store');

  /* a genuinely new, PROVEN person mints exactly once and re-proves itself */
  const minted = NL._mint(patients, { name: 'Nora Vance', dob: '06/07/1988', mrn: '' });
  eq(minted.created, true, 'a proven stranger was not minted');
  eq(patients.length, before + 1, 'the mint did not reach the store');
  ok(!/^p_sched_/.test(String(minted.patient.id)), 'the names-lookup mint used the capture-debris id shape');
  eq(String(minted.patient.source), 'names-lookup', 'the minted chart did not record where it came from');

  /* ...and a second identical request adopts the row it just made */
  const again = NL._mint(patients, { name: 'Nora Vance', dob: '06/07/1988', mrn: '' });
  eq(again.created, false, 'the same person minted twice');
  eq(again.patient.id, minted.patient.id, 'the second request did not land on the first mint');
  eq(patients.length, before + 1, 'the store grew a second time for one person');
}

/* ============ 5  THE HISTORY ROW IS THE PULL'S OWN ROW SHAPE ============= */
{
  const patients = freshStore();
  const w = makeWorld(patients);
  const row = w.NL.historyRow(CHART_ADAM, { name: 'Adam J Schaeffer', dob: '', mrn: '' });
  ok(row, 'a chart with an MRN produced no history row');
  eq(row.patient_external_id, CHART_ADAM.id, 'the history row did not carry the immutable local id');
  eq(row._mlsTargetPatientId, CHART_ADAM.id, 'the history row is missing the target id the batch reads');
  eq(row._mlsTargetMrn, CHART_ADAM.mrn, 'the history row did not carry MRN proof');
  eq(row.source, 'names-lookup', 'the history row did not declare its origin');
  eq(row.date, '', 'a pasted name invented a schedule day it does not have');
  /* a chart with NO proof at all can never become a history row - the chart
     reader refuses a name-only target three separate ways downstream */
  eq(w.NL.historyRow(CHART_MARY_NOPROOF, { name: 'Mary Anne Smith', dob: '', mrn: '' }), null,
    'a chart with no DOB and no MRN produced a history row anyway');
}

/* ====== 5b  THE BATCH RECEIPT BECOMES PER-NAME VERDICTS, HONESTLY ======== */
{
  const w = makeWorld(freshStore());
  const apply = w.NL._applyReceipt;
  ok(typeof apply === 'function', 'the receipt mapper is not exported - the mapping law cannot be executed');

  const rows = {
    'pA': { name: 'A', verdict: 'matched-chart', reason: 'mrn-proof', created: false },
    'pB': { name: 'B', verdict: 'new-lookup', reason: 'no-chart-on-file', created: true },
    'pC': { name: 'C', verdict: 'matched-chart', reason: 'name-dob-proof', created: false },
    'pD': { name: 'D', verdict: 'matched-chart', reason: 'name-dob-proof', created: false }
  };
  apply(rows, {
    patients: [
      { patientId: 'pA', complete: true },
      { patientId: 'pB', complete: true },
      { patientId: 'pC', complete: false, identityVerified: false }
    ],
    retry: [
      { patientId: 'pC', reason: 'athena-session-expired' },
      { patientId: 'pA', reason: 'a stale retry entry for a row that finished' }
    ]
  });
  eq(rows.pA.verdict, 'matched-pulled', 'a completed existing chart was not reported as read');
  eq(rows.pB.verdict, 'created-pulled', 'a chart minted by this lane was not reported as created AND read');
  eq(rows.pC.verdict, 'lookup-failed', 'an incomplete row was reported as a success');
  eq(rows.pC.reason, 'athena-session-expired', 'the retry entry\'s NAMED reason was thrown away for a generic one');
  eq(rows.pA.verdict, 'matched-pulled', 'a stale retry entry un-did a row the receipt proved complete');
  /* THE HONESTY LAW: a row the receipt never mentioned is a FAILURE. */
  eq(rows.pD.verdict, 'lookup-failed', 'a row missing from the receipt was left claiming it would be read');
  eq(rows.pD.reason, 'no-row-in-receipt', 'the unmentioned row did not say that it was unmentioned');
  /* every produced verdict stays inside the closed vocabulary */
  Object.keys(rows).forEach((pid) => {
    ok(w.NL.verdicts().indexOf(rows[pid].verdict) >= 0, 'the receipt mapper invented a verdict: ' + rows[pid].verdict);
  });
}

/* ================= 6  THE COHORT FROM A PASTED LIST (executed) =========== */
{
  /* EXTRACTION-EXECUTED: the cohort slice is taken out of 1p-mls-connect.js
     by its own source markers and run, so this proves the shipped bytes. */
  const START = '  function nlCohortApi() {';
  const END = '  function importIntoGroup(sg, groupName, list) {';
  const a = connectSource.indexOf(START);
  const b = connectSource.indexOf(END, a);
  ok(a >= 0 && b > a, 'the pasted-names cohort slice could not be located in 1p-mls-connect.js - this suite is broken, not the file');
  const slice = connectSource.slice(a, b);
  ok(slice.indexOf('function buildFromPastedNames') >= 0, 'the extracted slice does not contain buildFromPastedNames');
  ok(slice.indexOf('function nlExcludedHtml') >= 0, 'the extracted slice does not contain nlExcludedHtml');

  const patients = freshStore();
  const w = makeWorld(patients);

  /* buildAll's REAL contract, stood up here: one row per stored chart,
     {name,dob,mrn,visits}. The rows are IDENTITY-TAGGED so the assertions
     below can prove the cohort holds the very objects Add-ALL imports, not
     look-alike copies of them. */
  const allRows = patients.map(p => ({
    name: String(p.name || '').trim(),
    dob: String(p.dob || ''),
    mrn: String(p.mrn || p.id || ''),
    visits: [{ date: '2026-08-01', type: 'Visit', detail: 'x', source: 'mls-note' }]
  }));

  const sandbox = {
    console, Object, Array, String, Number, Boolean, JSON, Date, Math, RegExp, Error,
    window: { __mlsSI: { namesLookup: w.NL } },
    S: v => (v == null ? '' : String(v)),
    appPatients: () => patients,
    buildCtx: () => ({}),
    buildAll: () => allRows
  };
  vm.runInNewContext(slice + '\nthis.__nl = { buildFromPastedNames: buildFromPastedNames, nlExcludedHtml: nlExcludedHtml, nlCohortApi: nlCohortApi };',
    sandbox, { filename: '1p-mls-connect.js#nameslookup-cohort', timeout: 20000 });
  const cohort = sandbox.__nl;
  ok(typeof cohort.buildFromPastedNames === 'function', 'buildFromPastedNames did not survive extraction');

  const built = cohort.buildFromPastedNames([
    'Schaeffer, Adam #7833832',        /* 1 matched by MRN            */
    'Brooks, Bernard P 01/02/1970',    /* 2 matched by name + DOB     */
    'Bernard Brooks',                  /* 3 name only  -> excluded    */
    'Nora Vance 06/07/1988',           /* 4 no chart   -> excluded    */
    'zzz'                              /* 5 garbage    -> excluded    */
  ].join('\n'));

  eq(built.ok, true, 'a list with two proven charts built no cohort');
  eq(built.total, 5, 'the cohort build lost a pasted line');
  eq(built.included.length, 2, 'the cohort did not hold exactly the two proven charts');

  /* THE SHAPE LAW: the cohort rows are the ADD-ALL rows themselves. Object
     identity, not resemblance - a copy could drift, these cannot. */
  built.included.forEach((rec) => {
    ok(allRows.indexOf(rec) >= 0, 'a cohort row is NOT one of buildAll\'s own rows - the two cohort shapes can drift apart');
    ok(Object.prototype.hasOwnProperty.call(rec, 'visits'), 'a cohort row lost its per-visit history');
  });
  const includedNames = built.included.map(r => r.name).sort();
  assert.deepStrictEqual(includedNames, ['Adam J Schaeffer', 'Bernard Brooks'],
    'the cohort admitted the wrong people'); checks++;

  /* THE HONESTY LAW: every excluded person is named, with a reason. */
  eq(built.excluded.length, 3, 'people vanished from the cohort without being listed');
  const excludedText = cohort.nlExcludedHtml(built.excluded);
  ['Bernard Brooks', 'Nora Vance'].forEach((who) => {
    ok(excludedText.indexOf(who) >= 0, 'an excluded person (' + who + ') was not named in the exclusion list');
  });
  ok(/line 3/.test(excludedText) && /line 4/.test(excludedText) && /line 5/.test(excludedText),
    'the exclusion list did not point at the lines it means');
  built.excluded.forEach((r) => {
    ok(!!r.verdict, 'an excluded line carried no verdict');
    ok(w.NL.verdicts().indexOf(r.verdict) >= 0, 'an excluded line used a verdict outside the closed vocabulary');
  });

  /* A COHORT BUILD NEVER DRIVES ATHENA. */
  eq(w.posted.length, 0, 'building a cohort spoke to the extension - a cohort build must never drive Athena');
  eq(patients.length, 4, 'building a cohort minted a chart');

  /* ...and the surface says the one thing that fixes an exclusion. */
  const captureAt = connectSource.indexOf('if (isNames) {');
  ok(captureAt > 0, 'the pasted-names cohort handler is not wired into the capture interceptor');
  const captureBlock = connectSource.slice(captureAt, captureAt + 3000);
  ok(/Staff prep/.test(captureBlock) && /Look up a list of names/.test(captureBlock),
    'the cohort exclusion notice does not tell the doctor to run the Staff Prep lookup first');
  ok(/never touches Athena|never drives Athena/.test(captureBlock),
    'the cohort surface does not state that building a cohort leaves Athena alone');
}

/* ============ 7  THE STUDY BUILDER'S CONTRAST, MEASURED ================== */
{
  /* EXTRACTION-EXECUTED: the real CSS array literal out of the shipped
     module, evaluated with the module's own id constants. */
  const openAt = studySource.indexOf('st.textContent = [');
  ok(openAt >= 0, 'the study-request stylesheet literal could not be located - this suite is broken, not the file');
  const arrStart = studySource.indexOf('[', openAt);
  const closeAt = studySource.indexOf("].join('\\n');", arrStart);
  ok(closeAt > arrStart, 'the study-request stylesheet literal has no recognisable end');
  const literal = studySource.slice(arrStart, closeAt + 1);
  const arr = vm.runInNewContext('(' + literal + ')',
    { UI_ID: 'mlsStudyRequest', ADV_ID: 'mlsStudyAdvanced', ADV_BODY_ID: 'mlsStudyAdvancedBody' },
    { filename: 'feat_mls_study_request.js#injectCss', timeout: 5000 });
  ok(Array.isArray(arr) && arr.length > 20, 'the extracted stylesheet is not the real rule array');
  const sheet = arr.join('\n');

  /* --- WCAG relative luminance, so the claim is measured not asserted -- */
  function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(hex) {
    const h = hex.replace('#', '');
    return 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
  }
  function ratio(fg, bg) {
    const a1 = lum(fg), b1 = lum(bg), hi = Math.max(a1, b1), lo = Math.min(a1, b1);
    return (hi + 0.05) / (lo + 0.05);
  }
  /* the panel's own card bottom - the lightest ground its prose sits on */
  const CARD = '#f7faf8';

  /* --- THE MEASURED DEFECT: the four ghost tokens are GONE ------------- */
  const GHOSTS = [
    ['#91a098', 2.60, 'the composer placeholder - the "example" line the owner named'],
    ['#738078', 3.93, 'the helper line under the composer, and the proof-tile labels'],
    ['#65736c', 4.73, 'the result meta line - barely over AA at 12px'],
    ['#5f6d66', 5.17, 'the panel description - AA on paper, and still the lightest prose on the card']
  ];
  GHOSTS.forEach(([hex, measured, why]) => {
    /* pin the MEASUREMENT first, so this suite can never quietly agree with
       itself about a number it got wrong */
    const r = ratio(hex, CARD);
    ok(Math.abs(r - measured) < 0.02,
      'the recorded measurement for ' + hex + ' (' + why + ') is wrong: expected ' + measured + ':1, computed ' + r.toFixed(2));
    ok(sheet.toLowerCase().indexOf(hex) < 0, 'the ghosted token ' + hex + ' is still shipped for ' + why);
  });
  /* TWO of the four were below WCAG AA outright - the composer placeholder
     and the helper line, which are exactly two of the four surfaces the
     owner's screenshot named. The other two cleared AA by a hair at 11.5-14px
     and were still the lightest prose on the card. */
  eq(GHOSTS.filter(([hex]) => ratio(hex, CARD) < 4.5).length, 2,
    'the count of shipped sub-AA prose tokens changed - re-measure before trusting this suite');

  /* --- THE CURE: four named tokens, each measured above AA ------------- */
  const TOKENS = { '--sr-body': '#33423a', '--sr-muted': '#44544b', '--sr-ph': '#5d6c64', '--sr-accent': '#2c5341' };
  Object.keys(TOKENS).forEach((name) => {
    ok(sheet.indexOf(name + ':' + TOKENS[name]) >= 0, 'the ' + name + ' ink token is not declared as ' + TOKENS[name]);
    const r = ratio(TOKENS[name], CARD);
    ok(r >= 4.5, name + ' measures ' + r.toFixed(2) + ':1 on the panel card - below WCAG AA');
  });
  /* the composer placeholder is the one the owner named; it is now painted
     from the same value, with opacity forced back to 1 so no user agent can
     fade it again */
  ok(/#mlsStudyPrompt::placeholder\{color:#5d6c64!important;opacity:1!important\}/.test(sheet),
    'the composer placeholder is not painted at the measured token with its opacity pinned');

  /* --- THE STRUCTURAL HALF: prose rules can no longer be out-specified - */
  const PROSE = ['.sr-lede', '.sr-hint', '.sr-eyebrow', '.sr-example', '.sr-chip', '.sr-result-meta'];
  PROSE.forEach((cls) => {
    const rules = sheet.split('\n').filter(line => line.indexOf(cls + '{') >= 0 || line.indexOf(cls + ' ') >= 0);
    const colourRules = rules.filter(line => /color:/.test(line));
    ok(colourRules.length >= 1, cls + ' no longer has a colour rule at all');
    colourRules.forEach((line) => {
      ok(line.indexOf('#mlsStudyRequest ' + cls) >= 0,
        cls + ' still paints from an UNSCOPED class selector: ' + line.slice(0, 90));
      ok(/color:[^;}]*!important/.test(line),
        cls + ' still paints without !important, so one late id-scoped theme rule can re-ghost it: ' + line.slice(0, 90));
    });
  });

  /* the panel gets the same stuck-fade shield the advanced pane already had */
  ok(sheet.indexOf('#mlsStudyRequest{opacity:1!important;filter:none!important}') >= 0,
    'the panel itself has no shield against a stuck pane fade-in');
  ok(sheet.indexOf('#mlsStudyAdvancedBody{opacity:1!important;filter:none!important}') >= 0,
    'the pre-existing advanced-pane fade shield was removed');

  /* nothing structural moved: the panel is still the same box */
  ok(/#mlsStudyRequest\{--sr-ink:#17231d/.test(sheet), 'the panel container rule was replaced instead of extended');
  ok(/border-radius:20px;padding:22px/.test(sheet), 'the panel geometry changed - this was a contrast fix, not a redesign');
}

/* ================ 8  THE COMPOSER IS ALIVE (wiring, executed) =========== */
{
  const api = require(STUDY);
  eq(typeof api.shouldSubmitKey, 'function', 'the study composer no longer exports its Enter predicate');
  eq(api.shouldSubmitKey({ key: 'Enter' }), true, 'plain Enter no longer submits the study request');
  eq(api.shouldSubmitKey({ key: 'Enter', shiftKey: true }), false, 'Shift+Enter submits instead of adding a line');
  eq(api.shouldSubmitKey({ key: 'Enter', isComposing: true }), false, 'an IME composition Enter submits a half-typed request');
  eq(api.shouldSubmitKey({ key: 'a' }), false, 'an ordinary keystroke submits the request');
  eq(typeof api.runFromUi, 'function', 'runFromUi - the handler both the key and the button call - is gone');
  eq(typeof api.mount, 'function', 'the panel no longer exposes mount()');

  /* the two listeners are bound on the elements themselves inside buildUi,
     so a re-render cannot leave a dead composer */
  const buildAt = studySource.indexOf('function buildUi(doc)');
  ok(buildAt > 0, 'buildUi is gone');
  const build = studySource.slice(buildAt, buildAt + 2600);
  ok(/input\.addEventListener\('keydown'/.test(build), 'the composer has no keydown listener - Enter is dead');
  ok(/shouldSubmitKey\(ev\)/.test(build), 'the keydown listener no longer consults the Enter predicate');
  ok(/runFromUi\(input\.value\)/.test(build), 'the keydown listener no longer runs the generation');
  ok(/submit\.addEventListener\('click'/.test(build), 'the submit arrow has no click listener');
  ok(!/<textarea id="mlsStudyPrompt"[^>]*\b(disabled|readonly)\b/.test(build),
    'the composer textarea ships disabled or read-only - it could not accept typing');
}

/* ========== 9  THE STAFF PREP CARD RENDERS, AND ESCAPES (executed) ======= */
{
  /* EXTRACTION-EXECUTED: the card's own renderers, out of 1p-mls-connect.js.
     node --check cannot tell a well-formed card from a broken one, and a
     pasted name is UNTRUSTED TEXT that reaches innerHTML. */
  const START = '  var NL_LABEL = {';
  const END = '  function nlRepaint() {';
  const a = connectSource.indexOf(START);
  const b = connectSource.indexOf(END, a);
  ok(a >= 0 && b > a, 'the Staff prep card renderers could not be located - this suite is broken, not the file');
  const slice = connectSource.slice(a, b);

  const patients = freshStore();
  const w = makeWorld(patients);
  const sandbox = {
    console, Object, Array, String, Number, Boolean, JSON, Date, Math, RegExp, Error,
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    nlApi: () => w.NL,
    nlPlanState: null, nlLastReceipts: null, nlText: '', nlNote: '', nlRunning: false
  };
  vm.runInNewContext(slice + '\nthis.__card = { namesLookupHtml: namesLookupHtml, nlReceiptRow: nlReceiptRow, NL_LABEL: NL_LABEL };',
    sandbox, { filename: '1p-mls-connect.js#nameslookup-card', timeout: 20000 });
  const card = sandbox.__card;

  /* the empty card is complete and honest */
  const empty = card.namesLookupHtml();
  ['ez3NamesCard', 'ez3NamesBox', 'ez3NamesCheck', 'ez3NamesRun', 'ez3NamesClear', 'ez3NamesNote'].forEach((id) => {
    ok(empty.indexOf('id="' + id + '"') >= 0, 'the Staff prep card is missing #' + id);
  });
  ok(/ez3NamesRun[^>]*disabled/.test(empty), 'the look-everyone-up button is live before any list has been checked');
  ok(/never attached to a chart automatically/.test(empty), 'the card does not state the name-only rule on its face');

  /* every verdict in the closed vocabulary has plain-English words */
  w.NL.verdicts().forEach((v) => {
    ok(typeof card.NL_LABEL[v] === 'string' && card.NL_LABEL[v].length > 5,
      'verdict "' + v + '" would render as a raw code with no explanation');
  });

  /* a checked list paints one receipt per line, with its verdict */
  sandbox.nlPlanState = w.NL.plan('Schaeffer, Adam #7833832\nBernard Brooks\nzzz', { patients: patients });
  const painted = card.namesLookupHtml();
  eq((painted.match(/data-nl-line=/g) || []).length, 1, 'the one-click confirmation button was not offered for the name-only line');
  ok(painted.indexOf('Adam J Schaeffer') >= 0 || painted.indexOf('Schaeffer, Adam') >= 0, 'a checked line was not shown on screen');
  ok(/2 person|2 people|Look up 1 person/.test(painted), 'the run button does not say how many people it would look up');

  /* UNTRUSTED TEXT: a pasted name is data, never markup */
  const hostile = card.nlReceiptRow({
    lineNo: 1, raw: '<img src=x onerror=alert(1)>', name: '<img src=x onerror=alert(1)>',
    verdict: 'bad-line', reason: 'no-usable-name', candidates: []
  });
  ok(hostile.indexOf('<img') < 0, 'a pasted name reached the card as live markup');
  ok(hostile.indexOf('&lt;img') >= 0, 'the pasted name was neither escaped nor rendered');
}

/* ====== 10  THE STUDY-CREATOR BUTTON, CLICKED FOR REAL (executed) ======== */
{
  /* EXTRACTION-EXECUTED: the whole cohort region of 1p-mls-connect.js -
     including the document-capture handler that OWNS the button in every
     shipped configuration - is run here against a fake click. A branch that
     is only grepped is a branch nobody has ever taken. */
  const START = '  function nlCohortApi() {';
  const END = "  /* ------- E) AI Studio stability";
  const a = connectSource.indexOf(START);
  const b = connectSource.indexOf(END, a);
  ok(a >= 0 && b > a, 'the cohort capture region could not be located - this suite is broken, not the file');
  const slice = connectSource.slice(a, b);
  ok(slice.indexOf('function cohortCapture(ev)') >= 0, 'the extracted region does not contain the capture handler');

  const patients = freshStore();
  const w = makeWorld(patients);
  const pasted = [
    'Schaeffer, Adam #7833832',
    'Brooks, Bernard P 01/02/1970',
    'Bernard Brooks',
    'Nora Vance 06/07/1988'
  ].join('\n');

  const els = {
    sgpNamesTx: { value: pasted },
    sgpNamesOut: { textContent: '', style: {} },
    sgpBuildNote: { textContent: '' }
  };
  const allRows = patients.map(p => ({
    name: String(p.name || '').trim(), dob: String(p.dob || ''), mrn: String(p.mrn || p.id || ''),
    visits: [{ date: '2026-08-01', type: 'Visit', detail: 'x', source: 'mls-note' }]
  }));
  const groups = [];
  const sg = {
    list: () => groups,
    get: (id) => groups.filter(g => g.id === id)[0] || null,
    createGroup: (name) => { const g = { id: 'g' + (groups.length + 1), name, patients: [] }; groups.push(g); return g; },
    addPatient: (id, rec) => { const g = groups.filter(x => x.id === id)[0]; g.patients.push(rec); }
  };
  let stopped = 0, prevented = 0;
  const sandbox = {
    console, Object, Array, String, Number, Boolean, JSON, Date, Math, RegExp, Error,
    window: { __mlsSI: { namesLookup: w.NL } },
    document: { getElementById: () => null, createElement: () => ({ style: {} }) },
    setTimeout: (fn) => { fn(); return 0; },
    $: (id) => els[id] || null,
    S: v => (v == null ? '' : String(v)),
    SG: () => sg,
    appPatients: () => patients,
    buildCtx: () => ({}),
    buildAll: () => allRows,
    buildByKeyword: () => [],
    ctxPatient: () => null
  };
  vm.runInNewContext(slice + '\nthis.__cap = cohortCapture;', sandbox,
    { filename: '1p-mls-connect.js#cohortCapture', timeout: 20000 });

  const target = {
    closest: (sel) => (sel === '#sgpNamesBtn' ? { id: 'sgpNamesBtn' } : null)
  };
  sandbox.__cap({ target: target, stopImmediatePropagation: () => { stopped++; }, preventDefault: () => { prevented++; } });

  eq(stopped, 1, 'the pasted-names click did not take over from the legacy handler');
  eq(groups.length, 1, 'clicking the pasted-names button created no cohort');
  /* the group name is ASCII on purpose (memory:
     latin1-writer-turns-unicode-into-control-bytes) and is the KEY both cohort
     paths look the group up by - if the two paths ever disagree, one of them
     starts a second cohort behind the doctor's back */
  eq(groups[0].name, 'Cohort - pasted names', 'the cohort was filed under an unexpected name');
  ok(connectSource.split("'Cohort - pasted names'").length - 1 >= 1 &&
     connectSource.split('"Cohort - pasted names"').length - 1 >= 2,
    'the capture path and the fallback path no longer file the cohort under the same name');
  ok(!/Cohort . pasted names/.test(connectSource.replace(/Cohort - pasted names/g, '')),
    'a non-ASCII variant of the cohort name is still shipped');
  eq(groups[0].patients.length, 2, 'the cohort did not hold exactly the two proven charts');
  groups[0].patients.forEach((rec) => {
    ok(Array.isArray(rec.visits), 'a cohort member joined without its per-visit history - the Add-ALL shape was not preserved');
    ok(Object.prototype.hasOwnProperty.call(rec, 'name') && Object.prototype.hasOwnProperty.call(rec, 'dob') &&
      Object.prototype.hasOwnProperty.call(rec, 'mrn'), 'a cohort member is missing a field Add-ALL supplies');
  });

  /* the on-screen note and the exclusion list are both honest */
  const note = String(els.sgpBuildNote.textContent);
  ok(/2 of 4 pasted lines joined/.test(note), 'the cohort note does not say how many of the pasted lines made it: ' + note);
  ok(/2 excluded and listed below/.test(note), 'the cohort note does not admit that people were excluded: ' + note);
  const out = String(els.sgpNamesOut.textContent);
  ok(/Bernard Brooks/.test(out), 'the name-only exclusion was not named on screen');
  ok(/Nora Vance/.test(out), 'the no-chart exclusion was not named on screen');
  ok(/a name alone is not proof/.test(out), 'the name-only exclusion does not say WHY it was excluded');
  ok(/no chart on file yet/.test(out), 'the no-chart exclusion does not say WHY it was excluded');
  ok(/Staff prep/.test(out) && /Look up a list of names/.test(out),
    'the exclusion list does not tell the doctor how to bring the missing people in');
  ok(/never (touches|drives) Athena/.test(out), 'the exclusion list does not say a cohort build leaves Athena alone');
  eq(els.sgpNamesOut.style.display, '', 'the exclusion list was built but left hidden');

  /* AND NOTHING TOUCHED ATHENA OR THE STORE */
  eq(w.posted.length, 0, 'clicking the cohort button spoke to the extension');
  eq(patients.length, 4, 'clicking the cohort button minted a chart');

  /* the untouched branches still belong to the legacy handlers */
  const noMatch = { closest: () => null };
  let untouched = 0;
  sandbox.__cap({ target: noMatch, stopImmediatePropagation: () => { untouched++; }, preventDefault: () => {} });
  eq(untouched, 0, 'the capture handler now swallows clicks that are none of its business');
}

/* ================= 11  THE LANE IS WIRED INTO STAFF PREP ================= */
{
  ok(/h \+= namesLookupHtml\(\);/.test(connectSource), 'the names-lookup card is not rendered into Staff prep');
  ok(/wireNamesLookup\(\); \/\* nameslookup-1\.0\.0/.test(connectSource), 'the names-lookup card is rendered but never wired');
  ok(/id="ez3NamesBox"/.test(connectSource), 'the paste box is missing');
  ok(/id="ez3NamesRun"/.test(connectSource), 'the look-everyone-up button is missing');
  ok(/id="ez3NamesCheck"/.test(connectSource), 'the dry-run check button is missing');
  ok(/id="sgpNamesBtn"/.test(connectSource), 'the study-creator cohort button is missing');
  ok(/id="sgpNamesTx"/.test(connectSource), 'the study-creator paste box is missing');
  /* the run path must go through the ONE exported entry point, never a
     hand-rolled second driver */
  ok(/api\.run\(text,/.test(connectSource), 'the Staff prep button does not call the exported names-lookup run()');
  ok(!/mlsAppReadChart/.test(connectSource.slice(connectSource.indexOf('function wireNamesLookup'), connectSource.indexOf('function renderStaff'))),
    'the names-lookup surface talks to the extension directly instead of reusing the history batch');
}

/* a-suite-can-pass-without-running: the announcement happens ONLY after every
   deferred assertion has actually settled, and a rejection exits non-zero. */
const syncChecks = checks;
Promise.all(pending).then(function () {
  ok(pending.length >= 2, 'the asynchronous refusal checks were never registered');
  ok(checks > syncChecks, 'no asynchronous assertion ran - the refusal proofs drained silently');
  console.log('names-lookup-and-study-builder: ' + checks + ' checks passed ' +
    '(line parsing, resolver verdicts, no-name-only-attach, mint-is-last-resort, busy/shield refusals, ' +
    'cohort rows are Add-ALL rows, excluded-name honesty, measured study-panel contrast, live composer wiring)');
}, function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});

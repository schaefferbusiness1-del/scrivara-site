'use strict';
/* =============================================================================
 * capreceipt-1.0.0  -  EVERY ATHENA CHART WRITE CARRIES ITS OWN PROVENANCE
 *
 * MEASURED 2026-09-11 on a real account (structure only, no PHI): for the 25
 * patients on one clinic day, 24 of 25 records held real pulled chart content
 * - problems, medications, chart summary, a visits list and a chart number -
 * and only 5 of 25 carried any capture object at all; those 5 were the only
 * records whose identity was recorded as verified. On a different account a
 * freshly completed day pull produced 25 of 25 WITH the verified stamp. So the
 * stamp was written on ONE lane and not on the others: several writers merged
 * athena chart fields onto a record without writing anything beside them that
 * said where those fields came from. The app then could not prove which athena
 * chart a stored history was read out of, and a clinical hand-off that HAD
 * been verified read as unverifiable.
 *
 * This suite lifts the REAL writers out of the shipping files (vm / new
 * Function over the exact bytes - nothing is re-implemented here) and pins:
 *   1. a fresh capture writes the chart fields AND the provenance together, in
 *      the one object the caller persists;
 *   2. NO writer that stores athena-derived content can leave the provenance
 *      absent - every writer found in the measurement is driven here;
 *   3. a legacy record (content, no stamp) reports the honest third state and
 *      is NEVER reported as verified;
 *   4. nothing back-fills a verified stamp, and an unproven write can neither
 *      claim a proof nor erase one.
 *
 * SYNTHETIC identities only. No network, no PHI.
 *
 * RED-BEFORE-FIX: point CAPRECEIPT_SRC_DIR at a directory of pre-fix bytes
 * (git show HEAD:<file>) and every assertion below fails there.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.CAPRECEIPT_SRC_DIR
  ? path.resolve(process.env.CAPRECEIPT_SRC_DIR)
  : path.resolve(__dirname, '..');

const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
const TWIN = fs.readFileSync(path.join(ROOT, '1p', 'index.html'), 'utf8');
const VISITS = fs.readFileSync(path.join(ROOT, 'feat_visits.js'), 'utf8');
const SI = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const B121 = fs.readFileSync(path.join(ROOT, '1p-feat_mls_b121_pack.js'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

function between(source, begin, end, label) {
  const a = source.indexOf(begin);
  assert.ok(a >= 0, (label || '') + ' missing source marker: ' + begin);
  const b = source.indexOf(end, a + begin.length);
  assert.ok(b > a, (label || '') + ' missing source end marker: ' + end);
  return source.slice(a, b);
}
const clone = v => JSON.parse(JSON.stringify(v));
function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }

/* THE DOCTOR-FACING SENTENCE for the third state. Plain English by contract:
   no field names, no jargon, and it must say what the missing record does NOT
   mean - otherwise a blank reads as "this chart was never checked". */
const HONEST_SENTENCE =
  'This history came over from athenaOne before MLS began saving a note of the patient match, ' +
  'so MLS cannot show you here that the match was confirmed. ' +
  'That is not the same as the chart never having been checked.';

/* ======================================================================== */
/* A. THE SHELL CHART SINK - the writer 24 of 25 records went through        */
/* ======================================================================== */

const identitySrc = between(SHELL, 'function _athenaHistoryDigits(v)', '/* Like _assistReadAthenaTab', 'shell identity');
const saveSrc = between(SHELL, 'function _athenaChartHistoryObject(chart)', '/* Bulk: after pulling the schedule', 'shell save');
const surfaceSrc = between(SHELL, 'function _athenaProfileEmptyText(p,key,fallback)', 'function fieldBody(elId,txt,placeholder)', 'shell surface');

let patients = [];
let notes = [];
const persisted = [];          /* exactly what the sink handed to upsertPatient */
const shell = {
  console, Date, Math, JSON, Object, String, Number, Array, RegExp, Boolean,
  getPatients() { return clone(patients); },
  upsertPatient(p) {
    persisted.push(clone(p));
    const i = patients.findIndex(x => x.id === p.id);
    if (i >= 0) patients[i] = clone(p); else patients.push(clone(p));
  },
  getNotes() { return clone(notes); },
  saveNotes(next) { notes = clone(next); },
  document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { contains: () => false } }) }
};
shell.window = shell;
vm.runInNewContext(identitySrc + '\n' + saveSrc + '\n' + surfaceSrc, shell, { filename: 'capreceipt-shell.js' });

ok(typeof shell._athenaProvenanceStamp === 'function',
  'the shell does not define the ONE shared provenance stamp _athenaProvenanceStamp');
ok(typeof shell._athenaProvenanceState === 'function',
  'the shell does not define the three-state provenance reader _athenaProvenanceState');
ok(typeof shell._athenaProvenanceSentence === 'function',
  'the shell does not define the doctor-facing provenance sentence');

/* ONE implementation, not a second copy per lane - this repo's standing defect
   class is a comparator fixed in one of six copies. */
eq((SHELL.match(/function _athenaProvenanceStamp\(/g) || []).length, 1,
  'the provenance stamp is defined more than once in the shell');
[['feat_visits.js', VISITS], ['1p-feat_mls_schedimport_exact.js', SI], ['1p-feat_mls_b121_pack.js', B121]].forEach(pair => {
  eq((pair[1].match(/function _athenaProvenanceStamp\(/g) || []).length, 0,
    pair[0] + ' carries its own copy of the provenance stamp instead of calling the shared one');
  ok(pair[1].indexOf('_athenaProvenanceStamp') >= 0, pair[0] + ' never calls the shared provenance stamp');
});

function covered(fields) {
  const chart = Object.assign({ problems: '', meds: '', allergies: '', summary: '', vitals: {}, history: {}, visits: [] }, fields || {});
  const present = v => v && (typeof v !== 'object' || Object.values(v).some(Boolean));
  chart.coverage = {
    problems: present(chart.problems) ? 'found' : 'not_documented', meds: present(chart.meds) ? 'found' : 'not_documented',
    allergies: present(chart.allergies) ? 'found' : 'not_documented', summary: present(chart.summary) ? 'found' : 'not_documented',
    vitals: present(chart.vitals) ? 'found' : 'not_documented', history: present(chart.history) ? 'found' : 'not_documented'
  };
  return chart;
}

/* --- a fresh verified capture: chart fields AND provenance, together ----- */
patients = [{
  id: 'syn-a', name: 'Synthetic Alpha', dob: '01/02/1970', mrn: 'SYN-111',
  problems: 'Clinician problem', meds: '', allergies: '', summary: 'Clinician summary.'
}];
notes = [];
persisted.length = 0;

const exactRef = {
  patientId: 'syn-a', name: 'Synthetic Alpha', dob: '01/02/1970', mrn: 'SYN-111',
  verifiedName: 'Synthetic Alpha', verifiedDob: '01/02/1970', verifiedMrn: 'SYN-111',
  requestId: 'capreceipt-op-1'
};
eq(shell._savePatientChart(exactRef, { appointmentId: 'appt-2026-09-11-1' }, covered({
  problems: 'Synthetic problem A; Synthetic problem B', meds: 'Synthetic med 1',
  allergies: 'Synthetic allergy', summary: 'Synthetic athena summary.',
  vitals: { bp: '120/80', hr: '70', takenAt: '2026-09-11' },
  history: { pmh: 'Synthetic PMH' }, visits: ['09/01/2026 - Synthetic visit']
})), true, 'the verified exact-patient chart save was refused');

ok(persisted.length >= 1, 'the chart sink never persisted anything');
const committed = persisted[persisted.length - 1];
ok(/Synthetic problem A/.test(String(committed.problems || '')), 'the committed record did not gain the chart problems');
ok(/Synthetic med 1/.test(String(committed.meds || '')), 'the committed record did not gain the chart medications');
ok(/Synthetic athena summary/.test(String(committed.summary || '')), 'the committed record did not gain the chart summary');
ok(committed.athenaCaptureReceipt && typeof committed.athenaCaptureReceipt === 'object',
  'THE DEFECT: the chart fields were persisted with NO provenance beside them');
eq(committed.athenaCaptureReceipt.identityVerified, true, 'a proven chart save did not record that identity was verified');
eq(committed.athenaCaptureReceipt.lane, 'chart-save', 'the provenance does not name the lane that wrote it');
ok(/^\d{4}-\d{2}-\d{2}T/.test(String(committed.athenaCaptureReceipt.capturedAt || '')),
  'the provenance carries no usable capture time');
eq(committed.athenaCaptureReceipt.appointmentId, 'appt-2026-09-11-1',
  'the provenance did not record the appointment it came from');
eq(committed.athenaCaptureReceipt.chartKey, 'SYN-111', 'the provenance did not record the chart key it came from');
eq(committed.athenaCaptureReceipt.requestId, 'capreceipt-op-1', 'the provenance did not bind the operation that wrote it');
eq(shell._athenaProvenanceState(patients[0]).state, 'verified',
  'a freshly captured, identity-proven record does not read as verified');

/* --- a REFUSED save writes neither the fields nor a provenance ----------- */
const beforeRefusal = clone(patients[0]);
eq(shell._savePatientChart(Object.assign({}, exactRef, { verifiedDob: '03/04/1980', verifiedMrn: 'SYN-999' }), null,
  covered({ problems: 'WRONG PATIENT PROBLEM', summary: 'WRONG PATIENT SUMMARY' })), false,
  'a wrong-patient chart save was accepted');
ok(!JSON.stringify(patients).includes('WRONG PATIENT'), 'a refused save mutated a patient');
eq(JSON.stringify(patients[0].athenaCaptureReceipt), JSON.stringify(beforeRefusal.athenaCaptureReceipt),
  'a refused save rewrote the provenance');

/* ======================================================================== */
/* B. THE HONEST THIRD STATE - a legacy record is never reported verified   */
/* ======================================================================== */

const legacy = {
  id: 'syn-legacy', name: 'Synthetic Legacy', dob: '05/06/1960', mrn: 'SYN-222',
  problems: 'Synthetic legacy problem', meds: 'Synthetic legacy med',
  summary: '- Pulled from Athena 8/14/2026 -\nSynthetic legacy summary.',
  athenaChartImportedAt: '2026-08-14T15:00:00.000Z',
  athenaChartSnapshot: { capturedAt: '2026-08-14T15:00:00.000Z', problems: 'Synthetic legacy problem', meds: 'Synthetic legacy med' },
  visits: []
};
const legacyBefore = JSON.stringify(legacy);
eq(shell._athenaProvenanceState(legacy).state, 'unrecorded',
  'a record with pulled chart content and no provenance does not report the honest third state');
ok(shell._athenaProvenanceState(legacy).state !== 'verified', 'a legacy record was reported as verified');
eq(JSON.stringify(legacy), legacyBefore,
  'reading the provenance state MUTATED the record - it must never back-fill anything');
eq(shell._athenaProvenanceSentence(legacy), HONEST_SENTENCE,
  'the doctor-facing sentence for the third state is not the pinned plain-English one');
['athenaCaptureReceipt', 'identityVerified', 'flag', 'receipt', 'null', 'undefined', 'provenance'].forEach(banned => {
  ok(HONEST_SENTENCE.toLowerCase().indexOf(banned.toLowerCase()) < 0,
    'the doctor-facing sentence uses the jargon word "' + banned + '"');
});
ok(/not the same as/i.test(HONEST_SENTENCE),
  'the doctor-facing sentence does not say what the missing record does NOT mean');

/* the surface that reports verification says it plainly */
ok(String(shell._athenaProfileProvenance(legacy, 'problems', true)).indexOf(HONEST_SENTENCE) >= 0,
  'the profile provenance line does not carry the honest third-state sentence for a legacy record');
/* ...and it keeps the sentence it always printed as well, so the doctor does
   not lose the pull date to gain the caveat */
ok(/From the Athena pull of 2026-08-14/.test(String(shell._athenaProfileProvenance(legacy, 'problems', true))),
  'the honest sentence replaced the pull line instead of being added to it');

/* AND IT NEVER GOES BLANK. Lifted alone - without the shared reader in scope -
   the surface must still print what it always printed. An empty provenance
   line tells the doctor LESS than the old one did, so "no sentence" is a
   worse outcome than "no caveat" and is pinned against here. */
{
  const soloCtx = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Boolean,
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { contains: () => false } }) }
  };
  soloCtx.window = soloCtx;
  vm.runInNewContext(surfaceSrc, soloCtx, { filename: 'capreceipt-surface-solo.js' });
  const solo = String(soloCtx._athenaProfileProvenance(legacy, 'problems', true));
  ok(solo.length > 0, 'with the shared reader out of reach the provenance line went BLANK');
  ok(/From the Athena pull of 2026-08-14/.test(solo),
    'the degraded provenance line lost the sentence it has always printed');
}

/* a record with NO athena content at all is 'none', not 'unrecorded' */
eq(shell._athenaProvenanceState({ id: 'syn-manual', name: 'Synthetic Manual', problems: 'Typed by hand' }).state, 'none',
  'a purely manual record was treated as an unaccounted athena capture');

/* an unproven stamp reports unverified - never verified, never absent */
const unproven = { id: 'syn-u', name: 'Synthetic Unproven', athenaChartImportedAt: '2026-09-01T10:00:00.000Z' };
shell._athenaProvenanceStamp(unproven, { lane: 'facts-capture', identityVerified: false, identityBasis: 'name-tokens-only' });
eq(shell._athenaProvenanceState(unproven).state, 'unverified', 'an unproven capture did not report as unverified');

/* ======================================================================== */
/* C. NOTHING FABRICATES, NOTHING ERASES A PROOF                            */
/* ======================================================================== */

const sneaky = { id: 'syn-s', name: 'Synthetic Sneaky' };
shell._athenaProvenanceStamp(sneaky, { lane: 'chart-save', identityVerified: 'true' });
eq(sneaky.athenaCaptureReceipt.identityVerified, false, 'a non-boolean truthy value was accepted as an identity proof');
shell._athenaProvenanceStamp(sneaky, { lane: 'chart-save', identityVerified: 1 });
eq(sneaky.athenaCaptureReceipt.identityVerified, false, 'the number 1 was accepted as an identity proof');

const provenRec = { id: 'syn-p', name: 'Synthetic Proven' };
shell._athenaProvenanceStamp(provenRec, { lane: 'chart-save', identityVerified: true, identityBasis: 'identity-proof-match' });
shell._athenaProvenanceStamp(provenRec, { lane: 'visits-backfill-upgrade', identityVerified: false });
eq(provenRec.athenaCaptureReceipt.identityVerified, true, 'an unproven write erased a recorded identity proof');
eq(provenRec.athenaCaptureReceipt.unverifiedWrites, 1,
  'an unproven write against a proven record was dropped instead of being recorded');
eq(provenRec.athenaCaptureReceipt.lastUnverifiedLane, 'visits-backfill-upgrade',
  'the unproven write did not name its own lane');

/* ======================================================================== */
/* D. THE REAL VISIT WRITERS (feat_visits.js, executed)                     */
/* ======================================================================== */

function bootVisitModel() {
  let store = [];
  const ctx = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Boolean, Promise,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    document: {
      readyState: 'complete', addEventListener: () => {}, removeEventListener: () => {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, setAttribute() {} })
    },
    addEventListener: () => {}, removeEventListener: () => {},
    getPatients: () => store,
    upsertPatient(p) { const i = store.findIndex(x => x.id === p.id); if (i >= 0) store[i] = p; else store.push(p); return true; },
    savePatients(arr) { store = arr; return true; },
    _athenaProvenanceStamp: shell._athenaProvenanceStamp   /* the ONE shared helper */
  };
  ctx.window = ctx;
  /* IIFE 1 only - the visit-aware DATA MODEL. The two UI blocks below it paint
     DOM and are not writers; taking exactly the model keeps this a measurement
     of the real storage path. */
  const uiAt = VISITS.indexOf('* 2) PER-VISIT PROFILE UI');
  assert.ok(uiAt > 0, 'feat_visits.js no longer names its per-visit UI block');
  const modelSrc = VISITS.slice(0, VISITS.lastIndexOf('/*', uiAt));
  assert.ok(modelSrc.length > 1000, 'could not isolate the feat_visits.js visit model');
  vm.runInNewContext(modelSrc, ctx, { filename: 'capreceipt-feat_visits.js' });
  return { ctx, model: ctx.__mlsVisitModel, seed(p) { store = [p]; return store[0]; }, all: () => store };
}

/* D1 - addVisit with a PROVEN athena row */
{
  const w = bootVisitModel();
  ok(w.model && typeof w.model.addVisit === 'function', 'feat_visits.js did not expose addVisit');
  w.seed({ id: 'syn-v1', name: 'Synthetic Visit One', dob: '02/03/1975', mrn: 'SYN-333', visits: [] });
  w.model.addVisit('syn-v1', {
    date: '2026-09-01', type: 'Office visit',
    raw: 'Synthetic verified encounter body with enough text to be a real body.'
  }, { source: 'athena-copy', identityVerified: true, identityBinding: 'syn-v1' });
  const saved = w.all()[0];
  eq((saved.visits || []).length, 1, 'the athena visit was not stored');
  ok(saved.athenaCaptureReceipt && typeof saved.athenaCaptureReceipt === 'object',
    'THE DEFECT: an athena-derived encounter was stored with NO provenance beside it');
  eq(saved.athenaCaptureReceipt.lane, 'visit-ingest', 'the visit writer did not name its lane');
  eq(saved.athenaCaptureReceipt.identityVerified, true,
    'a visit bound to this exact patient did not record its proven identity');
}

/* D2 - addVisit with an athena row nobody proved: present and honest, never absent */
{
  const w = bootVisitModel();
  w.seed({ id: 'syn-v2', name: 'Synthetic Visit Two', dob: '02/03/1975', mrn: 'SYN-334', visits: [] });
  w.model.addVisit('syn-v2', {
    date: '2026-09-02', type: 'Office visit', raw: 'Synthetic unproven encounter body text here.'
  }, { source: 'athena-visits' });
  const saved = w.all()[0];
  ok(saved.athenaCaptureReceipt && typeof saved.athenaCaptureReceipt === 'object',
    'an unproven athena visit left the record with no account of itself at all');
  eq(saved.athenaCaptureReceipt.identityVerified, false, 'an unproven athena visit claimed a verified identity');
  eq(shell._athenaProvenanceState(saved).state, 'unverified', 'an unproven athena visit does not report as unverified');
}

/* D3 - a hand-entered visit is not an athena capture and must claim nothing */
{
  const w = bootVisitModel();
  w.seed({ id: 'syn-v3', name: 'Synthetic Visit Three', dob: '02/03/1975', visits: [] });
  w.model.addVisit('syn-v3', { date: '2026-09-03', type: 'Office visit', raw: 'Typed by the clinician.' }, { source: 'manual' });
  eq(w.all()[0].athenaCaptureReceipt, undefined, 'a hand-entered visit was stamped as an athena capture');
}

/* D4 - organizePatientHistory: the six cards derived from athena bodies */
{
  const w = bootVisitModel();
  w.seed({
    id: 'syn-v4', name: 'Synthetic Visit Four', dob: '02/03/1975', mrn: 'SYN-335',
    problems: '', meds: '', allergies: '', summary: '',
    visits: [{
      id: 'v-1', date: '2026-09-01', type: 'Office visit', source: 'athena-copy',
      identityVerified: true, identityBinding: 'syn-v4', fullDetail: true, bodyComplete: true, indexOnly: false,
      raw: 'Assessment: Synthetic organized problem.\nMedications: Synthetic organized med 10 mg daily.\nPlan: follow up.',
      cpt: [], icd10: []
    }]
  });
  const r = w.model.organizePatientHistory('syn-v4');
  ok(r && typeof r === 'object', 'organizePatientHistory returned nothing');
  const saved = w.all()[0];
  ok(saved.athenaCaptureReceipt && typeof saved.athenaCaptureReceipt === 'object',
    'THE DEFECT: the organized six-card write stored athena facts with no provenance');
  eq(saved.athenaCaptureReceipt.lane, 'history-organize', 'the organize writer did not name its lane');
  eq(saved.athenaCaptureReceipt.identityVerified, true,
    'the organize writer consumed only identity-bound athena rows but recorded no proof');
}

/* ======================================================================== */
/* E1. THE DAY PULL'S CAPTURE STEP (1p-feat_mls_schedimport_exact.js)       */
/* ======================================================================== */
{
  const capSrc = between(SI, '  function capPersistRawCapture(', '  /* ===== end cap-1.0.0 (capture persistence) ===== */', 'schedimport capture');
  let row = { id: 'syn-c1', name: 'Synthetic Capture', dob: '03/04/1980', mrn: 'SYN-444' };
  const win = { _athenaProvenanceStamp: shell._athenaProvenanceStamp, upsertPatient(p) { row = p; }, getPatients: () => [row] };
  const make = new Function('safe', 'patientById', 'normDate', 'isFn', 'CAP_MAX_CHARS', 'window',
    capSrc + '\nreturn capPersistRawCapture;');
  const capPersistRawCapture = make(safe, () => row, v => String(v || '').slice(0, 10), f => typeof f === 'function', 90000, win);
  const stored = capPersistRawCapture(
    { patientId: 'syn-c1', appointmentId: 'appt-cap-1', scheduleDate: '2026-09-11' },
    { scheduleDate: '2026-09-11' },
    { text: 'Synthetic captured chart text.', chartName: 'Synthetic Capture', chartDob: '03/04/1980', chartMrn: 'SYN-444' },
    'Synthetic captured chart text.', { readerVersion: '2.9.19-chart-r3', readClinicalFrames: 3 }, 'cap-req-1');
  ok(stored && typeof stored === 'object', 'the day-pull capture step stored nothing');
  ok(row.athenaCaptureReceipt && typeof row.athenaCaptureReceipt === 'object',
    'THE DEFECT: the day-pull capture wrote its own bookkeeping but no shared provenance');
  eq(row.athenaCaptureReceipt.lane, 'day-pull-capture', 'the day-pull capture did not name its lane');
  eq(row.athenaCaptureReceipt.identityVerified, true, 'the day-pull capture recorded no identity proof');
  eq(row.athenaCaptureReceipt.appointmentId, 'appt-cap-1', 'the day-pull capture did not record its appointment');
  eq(row.athenaCaptureReceipt.requestId, 'cap-req-1', 'the day-pull capture did not bind its request');
}

/* ======================================================================== */
/* F. THE REAL VISITS-BACKFILL UPGRADE PATH (1p-feat_mls_b121_pack.js)      */
/* ======================================================================== */
{
  const ingSrc = between(B121, '  function stableKey(ymd, type)', "  /* ------------------------- one patient's backfill", 'b121 ingest');
  let row = {
    id: 'syn-b1', name: 'Synthetic Backfill', dob: '06/07/1990', athenaId: 'SYN-555',
    visits: [{ id: 'v-old', date: '2026-09-01', type: 'Office visit', source: 'import', raw: '' }]
  };
  const win = { _athenaProvenanceStamp: shell._athenaProvenanceStamp, upsertPatient(p) { row = p; } };
  const CFG = { minTextLen: 5, maxTextLen: 20000, maxPerPatient: 50, maxConsecIngestErr: 3 };
  const STATE = { skippedUndated: 0 };
  const VMOD = () => ({ addVisit: () => { throw new Error('addVisit must not be reached on the upgrade path'); } });
  const S = x => (x == null ? '' : String(x));
  const make = new Function('VM', 'CFG', 'STATE', 'S', 'svcToYMD', 'collapse', 'strip', 'window',
    ingSrc + '\nreturn ingestVisits;');
  const ingestVisits = make(VMOD, CFG, STATE, S, v => String(v || '').slice(0, 10), v => String(v || '').trim(),
    v => String(v || '').trim(), win);
  const res = ingestVisits(row, [{
    date: '2026-09-01', type: 'Office visit',
    textHead: 'Synthetic rehydrated athena body text.', provider: 'Synthetic Provider'
  }]);
  eq(res.added, 0, 'the upgrade fixture added a new visit instead of upgrading the existing one');
  ok(res.upgraded >= 1 || res.rehydrated >= 1, 'the upgrade fixture never exercised the upgrade/rehydrate path');
  ok(row.athenaCaptureReceipt && typeof row.athenaCaptureReceipt === 'object',
    'THE DEFECT: the visits backfill wrote athena visit text onto a record with no provenance');
  eq(row.athenaCaptureReceipt.lane, 'visits-backfill-upgrade', 'the visits backfill did not name its lane');
  eq(row.athenaCaptureReceipt.identityVerified, false,
    'the visits backfill claimed an identity proof the app never made');
}

/* ======================================================================== */
/* G. BOTH SHELLS CARRY IT - the twin is not allowed to drift               */
/* ======================================================================== */
[['1pScribeFlow.html', SHELL], ['1p/index.html', TWIN]].forEach(pair => {
  ok(pair[1].indexOf('/* ===== capreceipt-1.0.0') >= 0, pair[0] + ' is missing the capreceipt-1.0.0 block');
  ok(pair[1].indexOf(HONEST_SENTENCE) >= 0, pair[0] + ' is missing the doctor-facing third-state sentence');
  ok(pair[1].indexOf("_athenaProvenanceStamp(p,{") >= 0 && pair[1].indexOf("lane:'chart-save'") >= 0,
    pair[0] + ' does not stamp the provenance inside the chart sink');
});
/* The staging dev snapshot is held byte-identical to production for this exact
   function by tests/briefing-problem-capture-runtime.test.js, so the stamp has
   to be there too - and the helper it calls has to be in scope there, or every
   chart save in that lane would throw instead of saving. */
{
  const STAGING = fs.readFileSync(path.join(ROOT, 'ScribeFlow-staging.html'), 'utf8');
  ok(STAGING.indexOf("lane:'chart-save'") >= 0, 'the staging shell chart sink does not stamp the provenance');
  ok(STAGING.indexOf('function _athenaProvenanceStamp(') >= 0,
    'the staging shell calls the shared stamp without carrying it - every chart save there would throw');
  eq((STAGING.match(/function _athenaProvenanceStamp\(/g) || []).length, 1,
    'the staging shell carries more than one copy of the shared stamp');
}

/* ======================================================================== */
/* H. THE ACCOUNT SURVIVES THE NEXT WRITE                                   */
/*                                                                          */
/* Writing it is not enough. upsertPatient replaces the stored row WHOLESALE */
/* with the caller's object, and this repo has already lost athenaProfile-   */
/* Coverage on 11-14 of 16 day-pull histories to exactly that clobber. A     */
/* stale write-back that keeps the chart fields and drops the account        */
/* reproduces the measured shape exactly, so the REAL upsertPatient and the  */
/* REAL bulk proof guard are lifted here and driven. This also PROVES THE    */
/* DISPATCH: the call sites are in a different slice of the shell from the   */
/* helper, so both slices are loaded into one context and the carry is       */
/* measured happening, never assumed from the presence of a line.            */
/* ======================================================================== */
function bootStore() {
  const guardSrc = between(SHELL, 'var __mlsAthenaProofByKey={};', 'function savePatients', 'shell proof guard');
  const upsertSrc = between(SHELL, 'function upsertPatient(p){', '\nfunction ', 'shell upsertPatient');
  const provSrc = between(SHELL, 'var ATHENA_PROVENANCE_V=1;', '/* ===== end capreceipt-1.0.0', 'shell provenance block');
  ok(/_athenaCarryProvenance\(p,__prev\)/.test(upsertSrc),
    'upsertPatient does not carry the capture account forward from the stored row');
  ok(/_athenaCarryProvenance\(row,recKept\)/.test(guardSrc),
    'the bulk proof guard does not carry the capture account forward');
  let stored = [];
  const ctx = vm.createContext({
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Boolean,
    uns: k => 'acct::' + k,
    __mlsPtsStorageKey: k => k || 'acct::patients',
    __mlsPtsBatchByKey: {},
    __mlsPtsForeignBatch: () => null,
    __mlsPtsFlushBatch: () => {},
    __mlsPtsArmBatch: () => {},
    getPatients: () => stored.slice(),
    savePatients: arr => { stored = arr.slice(); },
    backendMode: () => false,
    bkToken: () => '',
    syncPatientToServer: () => {}
  });
  ctx.window = ctx;
  vm.runInContext(guardSrc + '\n' + upsertSrc + '\n' + provSrc +
    '\nthis.upsertPatient=upsertPatient; this.guard=__mlsAthenaProofGuard;',
    ctx, { filename: 'capreceipt-upsert.js' });
  return { ctx, seed(rows) { stored = rows.slice(); }, row: id => stored.find(x => x.id === id), all: () => stored };
}

/* H1 - a stale caller that keeps the chart fields must not drop the account */
{
  const st = bootStore();
  const proven = { id: 'pH1', name: 'Synthetic Clobber One', problems: 'Synthetic problem', athenaChartImportedAt: '2026-09-11T15:00:00.000Z' };
  shell._athenaProvenanceStamp(proven, { lane: 'chart-save', identityVerified: true, identityBasis: 'identity-proof-match', chartKey: 'SYN-777' });
  st.seed([clone(proven)]);
  st.ctx.upsertPatient({ id: 'pH1', name: 'Synthetic Clobber One', problems: 'Synthetic problem', athenaChartImportedAt: '2026-09-11T15:00:00.000Z' });
  const after = st.row('pH1');
  ok(after.athenaCaptureReceipt && typeof after.athenaCaptureReceipt === 'object',
    'THE SECOND HALF OF THE DEFECT: a stale write-back kept the chart fields and erased the account of them');
  eq(after.athenaCaptureReceipt.identityVerified, true, 'a stale write-back un-proved a chart read');
  eq(shell._athenaProvenanceState(after).state, 'verified', 'a clobbered-then-carried record no longer reports verified');
}

/* H2 - an unproven later write neither erases the proof nor goes unrecorded */
{
  const st = bootStore();
  const proven = { id: 'pH2', name: 'Synthetic Clobber Two', problems: 'Synthetic problem' };
  shell._athenaProvenanceStamp(proven, { lane: 'chart-save', identityVerified: true, identityBasis: 'identity-proof-match' });
  st.seed([clone(proven)]);
  const weaker = { id: 'pH2', name: 'Synthetic Clobber Two', problems: 'Synthetic problem', meds: 'Synthetic med' };
  shell._athenaProvenanceStamp(weaker, { lane: 'facts-capture', identityVerified: false, identityBasis: 'name-tokens-only' });
  st.ctx.upsertPatient(weaker);
  const after = st.row('pH2');
  eq(after.athenaCaptureReceipt.identityVerified, true, 'an unproven later write erased a recorded identity proof through upsertPatient');
  eq(after.athenaCaptureReceipt.unverifiedWrites, 1, 'the unproven later write was dropped instead of being recorded');
  eq(after.athenaCaptureReceipt.lastUnverifiedLane, 'facts-capture', 'the unproven later write did not name its lane');
}

/* H3 - NOTHING is back-filled: no account in, no account out */
{
  const st = bootStore();
  st.seed([{
    id: 'pH3', name: 'Synthetic Legacy Store', problems: 'Synthetic legacy problem',
    athenaChartImportedAt: '2026-08-14T15:00:00.000Z'
  }]);
  st.ctx.upsertPatient({ id: 'pH3', name: 'Synthetic Legacy Store', problems: 'Synthetic legacy problem', athenaChartImportedAt: '2026-08-14T15:00:00.000Z' });
  const after = st.row('pH3');
  eq(after.athenaCaptureReceipt, undefined, 'a record with no account was BACK-FILLED with one by the carry');
  eq(shell._athenaProvenanceState(after).state, 'unrecorded', 'a legacy record stopped reporting the honest third state after an upsert');
}

/* H4 - and an unproven account on a record that never had one is kept as-is */
{
  const st = bootStore();
  st.seed([{ id: 'pH4', name: 'Synthetic Weak First', problems: 'Synthetic problem' }]);
  const weak = { id: 'pH4', name: 'Synthetic Weak First', problems: 'Synthetic problem' };
  shell._athenaProvenanceStamp(weak, { lane: 'visit-ingest', identityVerified: false, identityBasis: 'visit-source-only' });
  st.ctx.upsertPatient(weak);
  eq(st.row('pH4').athenaCaptureReceipt.identityVerified, false,
    'an unproven account was promoted to a proof by the carry');
}

/* H5 - the BULK path: savePatients-shaped arrays go through the proof guard */
{
  const st = bootStore();
  const proven = { id: 'pH5', name: 'Synthetic Bulk', problems: 'Synthetic problem' };
  shell._athenaProvenanceStamp(proven, { lane: 'day-pull-capture', identityVerified: true, identityBasis: 'chart-read-identity-echo' });
  st.ctx.guard('acct::patients', [clone(proven)]);          /* the guard sees the proven row */
  const staleArr = [{ id: 'pH5', name: 'Synthetic Bulk', problems: 'Synthetic problem' }];
  st.ctx.guard('acct::patients', staleArr);                  /* a bulk stale array arrives */
  ok(staleArr[0].athenaCaptureReceipt && typeof staleArr[0].athenaCaptureReceipt === 'object',
    'THE SECOND HALF OF THE DEFECT: a bulk stale save erased the account of the capture');
  eq(staleArr[0].athenaCaptureReceipt.identityVerified, true, 'a bulk stale save un-proved a chart read');
  const neverSeen = [{ id: 'pH5-other', name: 'Synthetic Bulk Other', problems: 'Typed by hand' }];
  st.ctx.guard('acct::patients', neverSeen);
  eq(neverSeen[0].athenaCaptureReceipt, undefined, 'the bulk guard invented an account for a row that never had one');
}

/* ======================================================================== */
/* E2. THE NAME-GUARDED FACTS ENRICHMENT - asynchronous, so it runs last    */
/* ======================================================================== */
(function runFactsCapture() {
  const factsSrc = between(SI, '  function siCaptureFacts(patientId, ms) {', '  /* si-facts-1.1:', 'schedimport facts capture');
  let row = { id: 'syn-c2', name: 'Synthetic Facts', dob: '04/05/1985', problems: '', meds: '', allergies: '' };
  const listeners = [];
  const win = {
    _athenaProvenanceStamp: shell._athenaProvenanceStamp,
    upsertPatient(p) { row = p; },
    addEventListener(t, fn) { if (t === 'message') listeners.push(fn); },
    removeEventListener(t, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage() {
      setImmediate(() => listeners.slice().forEach(fn => fn({
        data: {
          source: 'mls-ext', type: 'mlsAppCaptureResult',
          resp: {
            ok: true,
            captured: { name: 'Synthetic Facts', medications: ['Synthetic med X 5 mg'], problems: ['Synthetic problem Y'], allergies: [] }
          }
        }
      })));
    }
  };
  const make = new Function('window', 'patientById', 'isFn', 'setTimeout', 'clearTimeout', 'Promise', 'Array', 'String',
    factsSrc + '\nreturn siCaptureFacts;');
  const siCaptureFacts = make(win, () => row, f => typeof f === 'function', setTimeout, clearTimeout, Promise, Array, String);
  siCaptureFacts('syn-c2', 2000).then(verdict => {
    eq(verdict, 'saved', 'the facts-capture enrichment did not store anything');
    ok(/Synthetic med X/.test(String(row.meds || '')), 'the facts-capture enrichment did not write the medications');
    ok(row.athenaCaptureReceipt && typeof row.athenaCaptureReceipt === 'object',
      'THE DEFECT: the facts-capture enrichment wrote athena medications and problems with no provenance');
    eq(row.athenaCaptureReceipt.lane, 'facts-capture', 'the facts-capture writer did not name its lane');
    eq(row.athenaCaptureReceipt.identityVerified, false, 'a two-token NAME guard was recorded as a proven identity');
    eq(shell._athenaProvenanceState(row).state, 'unverified', 'the name-guarded enrichment does not report as unverified');
    console.log('capreceipt-1.0.0: ' + checks + ' checks passed - every athena chart writer stamps its own provenance,');
    console.log('  and a record captured before this change reports the honest third state instead of "not verified".');
  }).catch(err => {
    console.error(String((err && err.message) || err));
    process.exitCode = 1;
  });
})();

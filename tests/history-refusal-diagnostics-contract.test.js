'use strict';
/* mdx-1.1.0 — a history refusal must carry its own evidence to the surface.
 * Field ledger 2026-08-05 (the second clinician's Mac): visit-bodies-incomplete
 * ×2 and encounter-index-incomplete[noise-frames-excluded:1] ×5 — bare tags,
 * because the extension's rich evidence (failedIndexes reason histogram,
 * per-frame enumDiag, the read receipt) crossed the bridge and was discarded
 * at the app boundary with zero consumers. Third occurrence of the same
 * defect class in one day (provider rows, bodies, index). This suite pins the
 * capture chain end to end, PHI-free, plus the pace-learner guard: a fast
 * authoritative-empty read must not collapse the adaptive visits ceiling for
 * the deep charts behind it. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* ---- 1. capture block exists and copies ONLY the PHI-free fields ---------- */
const capIdx = si.indexOf('one.visitsFailedHistogram = fiHist');
assert(capIdx > 0, 'the failedIndexes histogram capture must exist');
const capRegion = si.slice(Math.max(0, capIdx - 1800), capIdx + 1800);
assert(capRegion.includes('one.visitsReadReceipt'), 'the read receipt subset must be captured');
assert(capRegion.includes('one.visitsEnumDiag'), 'the enumDiag subset must be captured');
assert(!capRegion.includes('vr.ecSeen') && !capRegion.includes('enumDiag.frames') && !capRegion.includes('vr.frames'),
  'the capture must never copy ecSeen/frames - they carry a patient-name field (comment mentions are fine; code references are not)');
assert(capRegion.includes('enumDiag.answered') && capRegion.includes('.slice(0, 8)'),
  'answered frame entries must be bounded');
/* axd-1.0 (2026-08-09): the extension emits the per-row failure records
   (noRowDiag liTotal/eidHit) on the receipt; si must absorb them bounded or
   the field dies at this boundary - found live on day 8 (Liliana/John,
   visit-bodies-incomplete) with the emitted receipts already dropped. */
assert(capRegion.includes('one.visitsFailureDetails = vr.receipt.failureDetails.slice(0, 12)'),
  'the per-row failure records must be absorbed, bounded to 12');

/* ---- 2. the evidence is threaded to retry entries, panel row, ledger ------ */
assert(si.includes('receipt.retry.push(frozenRetryEntry(row, target, one.reason, one))'),
  'the retry entry must carry the diagnostic source');
assert(si.includes('one.reason + historyDiagSuffix(one)'),
  'the day-panel row must render the sub-cause suffix');
assert(si.includes('perPatientDiag: perPatientDiag,'),
  'the day ledger must persist the per-patient diagnostics');

/* ---- 3. the emailed report carries it, bounded and identifier-free -------- */
const rd = connect.match(/retryDiag: \(function \(\) \{[\s\S]{0,600}?\}\)\(\)/);
assert(rd, 'dsDiagReport must include retryDiag');
assert(rd[0].includes('.slice(0, 10)'), 'retryDiag is bounded');
assert(!rd[0].includes('patientId') && !rd[0].includes('frozenDob') && !rd[0].includes('frozenMrn'),
  'retryDiag must never copy patient identifiers from the retry entry');

/* ---- 4. the pace-learner guard ------------------------------------------- */
assert(/if \(vr && vr\.ok\) \{ if \(!\(vr\.receipt && \(vr\.receipt\.authoritativeEmpty === true \|\| Number\(vr\.receipt\.expected \|\| 0\) === 0\)\)\) recordReadMs\('visits'/.test(si),
  'a fast empty read must not teach the visits pace ceiling');

/* ---- 5. executed behavior of the two new helpers -------------------------- */
function extractFn(name) {
  const m = si.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}'));
  assert(m, 'could not extract ' + name);
  return m[0];
}
const normDateFn = si.match(/function normDate\(d\) \{[^\r\n]*\}/);
assert(normDateFn, 'could not extract canonical normDate');
const rowAppointmentIdFn = si.match(/function rowAppointmentId\(a\) \{[^\r\n]*\}/);
assert(rowAppointmentIdFn, 'could not extract canonical rowAppointmentId');
const helpers = new Function('gfn',
  normDateFn[0] + '\n' + extractFn('normDob') + '\n' + extractFn('normMrn') + '\n' + extractFn('firstField') + '\n' + rowAppointmentIdFn[0] + '\n' +
  extractFn('frozenRetryEntry') + '\n' + extractFn('historyDiagSuffix') + '\n' +
  'return { frozenRetryEntry: frozenRetryEntry, historyDiagSuffix: historyDiagSuffix };'
)(() => null);

const plain = helpers.frozenRetryEntry({ name: 'X' }, { patientId: 'p1', dob: '2000-01-02', mrn: 'm1' }, 'visit-bodies-incomplete');
assert.strictEqual(plain.diag, undefined, 'no evidence -> no diag key');
assert.deepStrictEqual(Object.keys(plain).sort(), ['appointmentId', 'frozenDob', 'frozenMrn', 'patientId', 'reason', 'scheduleDate']);
assert.strictEqual(plain.appointmentId, '', 'a missing appointment id was not represented honestly');
assert.strictEqual(plain.scheduleDate, '', 'a missing schedule day was not represented honestly');

const scoped = helpers.frozenRetryEntry({ name: 'X', date: '2026-08-05T09:00:00Z' },
  { patientId: 'p1', dob: '2000-01-02', mrn: 'm1' }, 'visit-bodies-incomplete');
assert.strictEqual(scoped.scheduleDate, '2026-08-05', 'retry entry lost its frozen exact day scope');
const appointmentBound = helpers.frozenRetryEntry({ name: 'X', athena_appointment_id: 'appt_123' },
  { patientId: 'p1' }, 'visit-bodies-incomplete');
assert.strictEqual(appointmentBound.appointmentId, 'appt_123', 'retry entry lost its strongest Athena appointment binding');

const rich = helpers.frozenRetryEntry({ name: 'X' }, { patientId: 'p1' }, 'visit-bodies-incomplete', {
  visitsFailedHistogram: { 'encounter-section-loading': 6 },
  visitsReadReceipt: { expected: 12, parsed: 6 },
  /* axd-1.0: the in-app-only per-row records must NOT ride into the emailed
     diag even when present - the keys assertion below is the boundary. */
  visitsFailureDetails: [{ reason: 'no-group', liTotal: 3, eidHit: 0 }],
  name: 'LEAKY PATIENT NAME', chartText: 'LEAKY CHART'
});
assert(rich.diag, 'evidence present -> diag carried');
assert.deepStrictEqual(Object.keys(rich.diag).sort(), ['enumDiag', 'find', 'hist', 'receipt'],
  'diag carries exactly the four PHI-free evidence fields - nothing else from the patient record');
assert(!JSON.stringify(rich.diag).includes('LEAKY'), 'diag must not leak sibling fields');
assert.strictEqual(rich.diag.hist['encounter-section-loading'], 6);
assert.strictEqual(rich.diag.find, null,
  'missing bounded find evidence must remain an explicit null, never borrow sibling patient data');

assert.strictEqual(
  helpers.historyDiagSuffix({ visitsFailedHistogram: { 'encounter-section-loading': 6, 'read-deadline-exceeded': 2, 'slideout-trigger-missing': 1 } }),
  ' {encounter-section-loading×6, read-deadline-exceeded×2, +1 more}',
  'histogram suffix: top two by count plus remainder');
assert.strictEqual(
  helpers.historyDiagSuffix({ visitsEnumDiag: { passes: 13, identicalPasses: 2, noiseDropped: 1 } }),
  ' {passes:13,identical:2,noise:1}',
  'enum suffix names the pass counters that separate the stuck-carry from the short-budget hypothesis');
assert.strictEqual(helpers.historyDiagSuffix({}), '', 'no evidence -> empty suffix');
assert.strictEqual(helpers.historyDiagSuffix(null), '', 'null-safe');

console.log('history-refusal-diagnostics-contract: PASS');

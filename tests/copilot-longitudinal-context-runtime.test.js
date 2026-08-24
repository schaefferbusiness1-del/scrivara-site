'use strict';

/*
 * COPILOT LONGITUDINAL CONTEXT — active-patient evidence contract
 *
 * This is intentionally a seam test, not a source-shape-only test. The
 * planned helpers are the small, deterministic boundary between the rich
 * patient store and the Copilot wire:
 *
 *   _copilotBuildLongitudinalPatient(activePatient, question)
 *   _copilotChartForQuestion(question, snapshot)
 *   copilotSnapshot(question)
 *
 * The test fails at the seam with an explicit message until those helpers are
 * present. It then executes the helpers with a mixed synthetic history:
 * verified bodies may carry text, verified index/partial rows may carry only
 * metadata, unverified rows are excluded, and a foreign-patient sentinel can
 * never cross into the active patient's context.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, '1pScribeFlow.html');
const source = fs.readFileSync(appPath, 'utf8');

function extractFunction(text, name) {
  const marker = 'function ' + name + '(';
  const start = text.indexOf(marker);
  assert(start >= 0,
    name + ' seam is missing from 1pScribeFlow.html; add the planned helper before changing this test');
  const brace = text.indexOf('{', start);
  assert(brace > start, name + ' has no function body');
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(name + ' body is unterminated');
}

function hasAny(value, needles) {
  const text = JSON.stringify(value);
  return needles.some((needle) => text.includes(needle));
}

function timelineOf(result) {
  assert(result && Array.isArray(result.visits),
    '_copilotBuildLongitudinalPatient() must return a visits array');
  return result.visits;
}

function chartSpecOf(result) {
  assert(result && typeof result === 'object',
    '_copilotChartForQuestion() must return a structured readiness result');
  assert.strictEqual(result.status, 'ready',
    'documented injection outcomes should produce a ready chart result');
  const spec = result.spec || result.chart || result;
  assert.strictEqual(spec.type, 'line', 'injection results should use a longitudinal line chart');
  assert(Array.isArray(spec.labels), 'ready injection chart is missing labels');
  assert(Array.isArray(spec.datasets) && spec.datasets.length > 0,
    'ready injection chart is missing datasets');
  assert.strictEqual(spec.datasets[0].data.length, spec.labels.length,
    'injection chart labels/data lengths differ');
  return spec;
}

function fixture() {
  return {
    id: 'pt-A',
    patientId: 'pt-A',
    name: 'Synthetic Active A',
    dob: '1970-01-01',
    visits: [
      {
        id: 'A-verified', sourceVisitKey: 'enc:A-verified', encounterId: 'A-verified',
        patientId: 'pt-A', date: '2026-01-10', type: 'Lumbar injection',
        source: 'athena-visits', identityVerified: true, identityBinding: 'pt-A',
        fullDetail: true, bodyComplete: true,
        raw: 'A_VERIFIED_BODY — lumbar epidural injection performed; pain 8/10.',
        procedure: 'Lumbar epidural injection', scores: { pain: 8, odi: 54 }
      },
      {
        id: 'A-index', sourceVisitKey: 'enc:A-index', encounterId: 'A-index',
        patientId: 'pt-A', date: '2026-02-10', type: 'Follow-up',
        source: 'athena-visits', identityVerified: true, identityBinding: 'pt-A',
        indexOnly: true, fullDetail: false, bodyComplete: false,
        textHead: 'A_INDEX_METADATA',
        raw: 'A_INDEX_BODY_MUST_NOT_CROSS'
      },
      {
        id: 'A-partial', sourceVisitKey: 'enc:A-partial', encounterId: 'A-partial',
        patientId: 'pt-A', date: '2026-03-10', type: 'Follow-up',
        source: 'athena-copy', identityVerified: true, identityBinding: 'pt-A',
        indexOnly: false, fullDetail: false, bodyComplete: false,
        textHead: 'A_PARTIAL_METADATA',
        raw: 'A_PARTIAL_BODY_MUST_NOT_CROSS'
      },
      {
        id: 'A-unverified', sourceVisitKey: 'enc:A-unverified', encounterId: 'A-unverified',
        patientId: 'pt-A', date: '2026-04-10', type: 'Injection',
        source: 'athena-visits', identityVerified: false, identityBinding: 'pt-other',
        fullDetail: true, bodyComplete: true,
        raw: 'A_UNVERIFIED_BODY_MUST_NOT_CROSS',
        procedure: 'Injection', scores: { pain: 1 }
      },
      {
        id: 'B-foreign', sourceVisitKey: 'enc:B-foreign', encounterId: 'B-foreign',
        patientId: 'pt-B', date: '2026-05-10', type: 'Lumbar injection',
        source: 'athena-visits', identityVerified: true, identityBinding: 'pt-B',
        fullDetail: true, bodyComplete: true,
        raw: 'B_FOREIGN_SENTINEL_MUST_NOT_CROSS',
        procedure: 'Lumbar epidural injection', scores: { pain: 0, odi: 0 }
      },
      {
        id: 'B-local-foreign', date: '2026-05-11', type: 'Local foreign injection',
        source: 'mls-visit-editor', identityVerified: true, identityBinding: 'pt-B',
        raw: 'B_LOCAL_FOREIGN_SENTINEL_MUST_NOT_CROSS — 99% relief.',
        procedure: 'Lumbar epidural injection', scores: { recovery: 99, pain: 0, odi: 0 }
      },
      {
        id: 'A-local-unverified', date: '2026-05-12', type: 'Unverified local follow-up',
        source: 'mls-visit-editor', identityVerified: false, identityBinding: 'pt-A',
        raw: 'A_LOCAL_UNVERIFIED_SENTINEL_MUST_NOT_CROSS', scores: { recovery: 98 }
      },
      {
        id: 'A-followup', sourceVisitKey: 'enc:A-followup', encounterId: 'A-followup',
        patientId: 'pt-A', date: '2026-06-10', type: 'Follow-up',
        source: 'mls-visit-editor', identityVerified: true, identityBinding: 'pt-A',
        fullDetail: true, bodyComplete: true,
        raw: 'A_FOLLOWUP_BODY — follow-up after lumbar injection; pain 4/10; ODI 31.',
        scores: { pain: 4, odi: 31 }
      }
    ]
  };
}

/* The source signature is part of the contract: the question must reach both
   deterministic helpers so a quantitative request can opt into the chart
   without making every Copilot question pay for it. */
assert.ok(/function copilotSnapshot\(question\)/.test(source),
  'copilotSnapshot(question) signature is missing');
const snapshotSource = extractFunction(source, 'copilotSnapshot');
assert.ok(/_copilotBuildLongitudinalPatient\([^)]{0,200}question/.test(snapshotSource),
  'copilotSnapshot does not call the longitudinal patient builder with question');
const helperStart = source.indexOf('function _copilotClinicalText(');
const helperEnd = source.indexOf('/* Lean, id-carrying snapshot', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'could not extract the longitudinal helper block');
const helperSource = source.slice(helperStart, helperEnd);

const context = {
  console, String, Number, Boolean, Array, Object, Math, Date, RegExp, JSON,
  isNaN, parseInt, parseFloat,
  window: null, globalThis: null,
  document: { getElementById() { return null; } }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  helperSource +
  '\nthis.__copilotLongitudinalTestApi = {' +
  '_copilotBuildLongitudinalPatient: _copilotBuildLongitudinalPatient,' +
  '_copilotChartForQuestion: _copilotChartForQuestion' +
  '};',
  context,
  { filename: appPath + ':copilot-longitudinal-seams' }
);

const api = context.__copilotLongitudinalTestApi;
assert(api && typeof api._copilotBuildLongitudinalPatient === 'function');
assert(api && typeof api._copilotChartForQuestion === 'function');

const patient = fixture();
const question = 'Show the injection pain trend over time';
const longitudinal = api._copilotBuildLongitudinalPatient(patient, question);
const timeline = timelineOf(longitudinal);
const serialized = JSON.stringify(longitudinal);
assert.strictEqual(timeline.map((row) => row.visitId).join('|'),
  'A-followup|A-partial|A-index|A-verified',
  'active-patient visit timeline is not newest-first or contains an excluded visit');

/* Verified body is the only row allowed to carry clinical text. */
const verified = timeline.find((row) => row.visitId === 'A-verified');
assert(verified, 'verified active-patient visit body was omitted from Copilot context');
assert(hasAny(verified, ['A_VERIFIED_BODY']),
  'verified body text did not reach the longitudinal Copilot context');
assert.strictEqual(verified.procedureName, 'Lumbar epidural injection',
  'structured procedureName did not reach the longitudinal Copilot visit row');
assert.strictEqual(verified.procedure, 'Lumbar epidural injection',
  'structured procedure did not reach the longitudinal Copilot visit row');
assert.strictEqual(verified.completeness, 'verified',
  'verified body did not carry completeness=verified');
assert.strictEqual(verified.source, 'athena-visits',
  'verified visit source citation was not preserved exactly');
assert.strictEqual(verified.sourceVisitKey, 'enc:A-verified',
  'verified visit sourceVisitKey citation was not preserved exactly');

/* Verified index/partial rows remain useful metadata, but their body text is
   not trusted and must not be shipped as if it were a note. */
for (const id of ['A-index', 'A-partial']) {
  const row = timeline.find((item) => item.visitId === id);
  assert(row, id + ' metadata-only visit was omitted instead of remaining visible');
  assert.notStrictEqual(row.completeness, 'verified', id + ' metadata-only visit was over-claimed as verified');
  assert(!hasAny(row, [id === 'A-index' ? 'A_INDEX_BODY_MUST_NOT_CROSS' : 'A_PARTIAL_BODY_MUST_NOT_CROSS']),
    id + ' body text leaked from a metadata-only visit');
  assert(hasAny(row, [id === 'A-index' ? 'A_INDEX_METADATA' : 'A_PARTIAL_METADATA']),
    id + ' did not preserve its safe metadata marker');
  assert.strictEqual(row.sourceVisitKey, 'enc:' + id,
    id + ' sourceVisitKey citation was not preserved exactly');
}

/* Unverified and foreign-patient rows must be absent, including their unique
   sentinels. This catches both identity-binding mistakes and raw-text fallback
   paths that accidentally re-add excluded visits. */
assert(!timeline.some((row) => row.visitId === 'A-unverified' || row.visitId === 'B-foreign' || row.visitId === 'B-local-foreign' || row.visitId === 'A-local-unverified'),
  'unverified or foreign-patient visit entered the active-patient timeline');
assert(!serialized.includes('A_UNVERIFIED_BODY_MUST_NOT_CROSS'),
  'unverified visit body crossed into Copilot context');
assert(!serialized.includes('B_FOREIGN_SENTINEL_MUST_NOT_CROSS'),
  'foreign-patient sentinel crossed into Copilot context');
assert(!serialized.includes('B_LOCAL_FOREIGN_SENTINEL_MUST_NOT_CROSS'),
  'foreign-patient local-row sentinel crossed into Copilot context');
assert(!serialized.includes('A_LOCAL_UNVERIFIED_SENTINEL_MUST_NOT_CROSS'),
  'explicitly unverified local-row sentinel crossed into Copilot context');

/* Injection trend: only documented, identity-safe injection outcomes count;
   the unverified injection and foreign-patient injection above must not affect
   the resulting labels/data. */
const chart = api._copilotChartForQuestion(question, longitudinal);
const spec = chartSpecOf(chart);
assert(spec.labels.includes('2026-01-10'), 'verified injection date missing from trend');
assert(spec.labels.includes('2026-06-10'), 'documented post-injection follow-up missing from trend');
assert(!spec.labels.includes('2026-04-10'), 'unverified injection date entered trend data');
assert(!spec.labels.includes('2026-05-10'), 'foreign-patient injection date entered trend data');
assert(!spec.labels.includes('2026-05-11'), 'foreign-patient local injection date entered trend data');
assert(spec.datasets.every((dataset) => dataset.data.every((value) => value == null || Number.isFinite(Number(value)))),
  'injection trend contains a fabricated/non-numeric data point');

/* Exact recovery request: this is intentionally not injection-gated. It must
   use the active patient's documented visit outcomes (and only those rows),
   preserve dates/source refs, and return a deterministic line chart when two
   numeric recovery-related points exist. */
const recoveryQuestion = 'give me a chart on his level of recovery over his last visits';
const recoveryChart = api._copilotChartForQuestion(recoveryQuestion, longitudinal);
assert.strictEqual(recoveryChart.status, 'ready',
  'the exact recovery-chart request did not become ready with two documented points');
assert.strictEqual(recoveryChart.type, 'line', 'recovery chart is not a line chart');
assert.strictEqual(recoveryChart.patientId, 'pt-A', 'recovery chart lost the active-patient binding');
assert.strictEqual(recoveryChart.labels.join('|'), '2026-01-10|2026-06-10',
  'recovery chart did not use the documented active-patient visit dates in order');
assert.strictEqual(recoveryChart.datasets[0].data.join('|'), '54|31',
  'recovery chart did not use the documented ODI/function recovery values');
assert.strictEqual(recoveryChart.points[0].ref, 'V4', 'recovery chart lost its first source reference');
assert.strictEqual(recoveryChart.points[1].ref, 'V1', 'recovery chart lost its second source reference');
assert(!JSON.stringify(recoveryChart).includes('B_FOREIGN_SENTINEL_MUST_NOT_CROSS'),
  'foreign-patient data entered the recovery chart');
for (const variant of [
  'Plot her recovery progress across prior visits',
  'Show a graph of function over time',
  'Chart his pain across previous visits'
]) {
  assert.strictEqual(api._copilotChartForQuestion(variant, longitudinal).status, 'ready',
    'a normal recovery-chart wording variant did not produce the documented trend: ' + variant);
}

/* Two records on only one date are not a longitudinal series. This also
   prevents a visit row plus its mirrored saved outcome from being counted as
   two separate recovery points. */
const sameDay = api._copilotBuildLongitudinalPatient({
  id: 'pt-same-day', name: 'Same Day', visits: [
    { id: 'sd1', date: '2026-07-01', type: 'Follow-up', source: 'mls-visit-editor', raw: 'Documented recovery.', scores: { recovery: 40 } },
    { id: 'sd2', date: '2026-07-01', type: 'Follow-up', source: 'mls-visit-editor', raw: 'Documented recovery update.', scores: { recovery: 60 } }
  ]
}, recoveryQuestion);
assert.strictEqual(api._copilotChartForQuestion(recoveryQuestion, sameDay).status, 'insufficient',
  'one calendar date was misrepresented as a recovery-over-time series');

/* Missing-data states are explicit and chart-free. */
const noScores = JSON.parse(JSON.stringify(patient));
noScores.visits = noScores.visits.map((visit) => {
  const next = Object.assign({}, visit);
  delete next.scores;
  delete next.pain;
  delete next.odi;
  return next;
});
const noScoreContext = api._copilotBuildLongitudinalPatient(noScores, question);
const noScoreChart = api._copilotChartForQuestion(question, noScoreContext);
assert(noScoreChart && /^(no-data|insufficient)$/.test(noScoreChart.status),
  'missing injection outcomes did not produce an explicit no-data/insufficient state');
assert(!noScoreChart.spec && !noScoreChart.chart,
  'missing injection outcomes produced a chart spec instead of a refusal state');
const noRecoveryChart = api._copilotChartForQuestion(recoveryQuestion, noScoreContext);
assert(noRecoveryChart && /^(no-data|insufficient)$/.test(noRecoveryChart.status),
  'missing recovery outcomes did not produce an explicit no-data/insufficient state');
assert(!noRecoveryChart.spec && !noRecoveryChart.chart,
  'missing recovery outcomes produced a fabricated chart spec');

const empty = api._copilotBuildLongitudinalPatient({ id: 'pt-empty', patientId: 'pt-empty', name: 'Empty', visits: [] }, question);
const emptyChart = api._copilotChartForQuestion(question, empty);
assert(emptyChart && /^(no-data|insufficient)$/.test(emptyChart.status),
  'empty patient history did not produce an explicit no-data/insufficient state');

const diagnosisOnly = api._copilotBuildLongitudinalPatient({
  id: 'pt-facet', name: 'Facet Diagnosis Only', visits: [
    { id: 'f1', date: '2026-01-01', type: 'Facet arthropathy follow-up', source: 'mls-visit-editor', fullDetail: true, bodyComplete: true, raw: 'Facet arthropathy remains symptomatic. Pain 7/10.', scores: { pain: 7 } },
    { id: 'f2', date: '2026-02-01', type: 'Facet arthropathy follow-up', source: 'mls-visit-editor', fullDetail: true, bodyComplete: true, raw: 'Facet arthropathy review. Reference number 20610-ABC. Pain 5/10.', scores: { pain: 5 } }
  ]
}, question);
assert.strictEqual(diagnosisOnly.injectionTrend.injectionRecords, 0,
  'a facet diagnosis or CPT-like number in prose was misclassified as an injection');
assert.strictEqual(api._copilotChartForQuestion(question, diagnosisOnly).status, 'no-data',
  'diagnosis-only visits produced an injection graph');

const many = Array.from({ length: 240 }, (_, i) => ({
  id: 'bounded-' + i, date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
  type: 'Follow-up', source: 'mls-visit-editor', raw: 'Bounded local visit ' + i, scores: { recovery: i % 100 }
}));
const bounded = api._copilotBuildLongitudinalPatient({ id: 'pt-bounded', name: 'Bounded', visits: many }, question);
assert.strictEqual(bounded.visits.length, 30, 'wire history exceeded the 30-row evidence cap');
assert.strictEqual(bounded.coverage.sourceRowsNotScanned, 40, 'pre-processing source cap was not disclosed');
assert.strictEqual(bounded.coverage.omittedByLimit, 170, 'post-scan evidence omission was not disclosed');
const boundedChart = api._copilotChartForQuestion(recoveryQuestion, bounded);
assert.strictEqual(boundedChart.status, 'ready', 'bounded documented recovery did not produce a chart');
assert(/most recent 30 included records/i.test(boundedChart.note) && /older or omitted records/i.test(boundedChart.note),
  'ready chart did not visibly disclose its bounded evidence window');

console.log('PASS Copilot longitudinal context: verified bodies only carry text; verified metadata stays metadata-only; unverified/foreign visits are excluded; injection trend data is conservative; no-data states are explicit');

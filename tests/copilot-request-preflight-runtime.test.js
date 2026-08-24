'use strict';

/* Patient-specific Copilot requests must cross one minimum-necessary boundary
 * before any request owner can send them. This executes the canonical helper
 * in both reviewed /1p shells; no server model is involved. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', path.join('1p', 'index.html')];

function apiFor(rel) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  const start = source.indexOf('function _copilotClinicalText(');
  const end = source.indexOf('/* Lean, id-carrying snapshot', start);
  assert(start >= 0 && end > start, rel + ': Copilot helper block is missing');
  const askStart = source.indexOf('async function copilotAsk()');
  const askEnd = source.indexOf('function _copilotResolveView(', askStart);
  const ask = source.slice(askStart, askEnd);
  assert(ask.includes('_copilotPrepareRequest(q,rawSnapshot)'), rel + ': base request owner bypasses preflight');
  assert(ask.indexOf('if(localProcedure)') < ask.indexOf("fetch(bkBase()+'/api/copilot'"), rel + ': local answer runs after fetch');
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
    source.slice(start, end) +
      '\nthis.__preflightApi={' +
      'prepare:_copilotPrepareRequest,scope:_copilotRequestScope' +
      '};',
    context,
    { filename: rel + ':copilot-preflight' }
  );
  return context.__preflightApi;
}

function snapshot() {
  return {
    today: '2026-08-23',
    activePatient: {
      id: 'pt-A', name: 'Gary Foster', summary: 'Active patient summary',
      pulledVisits: [{ raw: 'UNVERIFIED_LEGACY_ACTIVE_RAW' }],
      visits: [{ raw: 'SECOND_LEGACY_ACTIVE_RAW' }], raw: 'ACTIVE_RAW_DUPLICATE'
    },
    patients: [
      {
        id: 'pt-A', name: 'Gary Foster', summary: 'Active patient summary',
        pulledVisits: [{ raw: 'UNVERIFIED_LEGACY_ACTIVE_RAW' }],
        visits: [{ raw: 'SECOND_LEGACY_ACTIVE_RAW' }], raw: 'ACTIVE_RAW_DUPLICATE'
      },
      { id: 'pt-B', name: 'Lola van Gilst', summary: 'OTHER_PATIENT_SENTINEL' }
    ],
    appointments: [{ name: 'Lola van Gilst', reason: 'OTHER_APPOINTMENT_SENTINEL' }],
    panel: { overdue90: { showing: [{ id: 'pt-B', name: 'Lola van Gilst' }] } },
    avatarCheckins: { ready: [{ patient: 'Lola van Gilst', bullets: ['OTHER_AVATAR_SENTINEL'] }] },
    providerCoverage: { providers: [{ name: 'Provider One' }] },
    patientCount: 2,
    totalVisits: 9,
    topProblems: [{ name: 'practice-only' }],
    activeVisit: { patient: { id: 'pt-A', name: 'Gary Foster' }, noteTail: 'SAFE_ACTIVE_NOTE' },
    longitudinalPatient: {
      patientId: 'pt-A', name: 'Gary Foster', scope: 'active-patient-only',
      coverage: { included: 2, omittedByLimit: 0, sourceRowsNotScanned: 0 },
      visits: [{ ref: 'V1', date: '2026-01-10', excerpt: 'SAFE_VERIFIED_LONGITUDINAL' }],
      outcomes: [],
      procedureEvidence: [{ date: '2026-01-10', name: 'Lumbar epidural injection', cpt: ['62323'], ref: 'V1', source: 'athena-visits' }],
      injectionTrend: {
        status: 'ready', metric: 'documented relief (%)',
        points: [
          { date: '2026-01-10', value: 30, ref: 'V1', metric: 'documented relief (%)' },
          { date: '2026-03-10', value: 70, ref: 'V2', metric: 'documented relief (%)' }
        ],
        note: 'Every value is documented.'
      },
      recoveryTrend: { status: 'no-data', points: [], note: 'No documented recovery values.' }
    }
  };
}

for (const rel of shells) {
  const api = apiFor(rel);
  const patient = api.prepare('Tell me about his last visit', snapshot());
  assert.strictEqual(patient.scope, 'active-patient', rel + ': pronoun request was not patient scoped');
  assert.strictEqual(patient.context.requestScope, 'active-patient');
  assert.deepStrictEqual(Array.from(patient.context.patients, (p) => p.id), ['pt-A'], rel + ': another patient remained on the wire');
  assert.strictEqual(patient.context.appointments.length, 0, rel + ': other-patient appointments remained on the wire');
  assert.strictEqual(patient.context.panel, undefined, rel + ': panel identities remained on the patient wire');
  assert.strictEqual(patient.context.avatarCheckins, undefined, rel + ': other-patient Avatar data remained on the wire');
  assert.strictEqual(patient.context.providerCoverage, undefined, rel + ': practice coverage remained on the patient wire');
  const patientWire = JSON.stringify(patient.context);
  assert(patientWire.includes('SAFE_VERIFIED_LONGITUDINAL'), rel + ': verified longitudinal evidence was removed');
  for (const forbidden of ['OTHER_PATIENT_SENTINEL', 'OTHER_APPOINTMENT_SENTINEL', 'OTHER_AVATAR_SENTINEL',
    'UNVERIFIED_LEGACY_ACTIVE_RAW', 'SECOND_LEGACY_ACTIVE_RAW', 'ACTIVE_RAW_DUPLICATE']) {
    assert(!patientWire.includes(forbidden), rel + ': unsafe/non-active wire sentinel survived: ' + forbidden);
  }

  const mismatch = api.prepare("Tell me about Lola van Gilst's last visit", snapshot());
  assert(mismatch.localAnswer && mismatch.localAnswer.kind === 'patient-subject-mismatch', rel + ': named other patient did not fail closed');
  assert.strictEqual(mismatch.localAnswer.status, 'blocked');
  assert(!/Lola van Gilst/i.test(mismatch.localAnswer.message), rel + ': refusal echoed the other patient identity');
  assert(/Gary Foster/.test(mismatch.localAnswer.message), rel + ': refusal did not identify the open chart');
  assert(!JSON.stringify(mismatch.context).includes('OTHER_PATIENT_SENTINEL'), rel + ': mismatch refusal retained another chart');
  const whichMismatch = api.prepare('Which procedures did Lola van Gilst have?', snapshot());
  assert(whichMismatch.localAnswer && whichMismatch.localAnswer.kind === 'patient-subject-mismatch',
    rel + ': generic "which" widened a named-other-patient question to the whole practice');
  assert.strictEqual(whichMismatch.scope, 'active-patient');
  assert(!JSON.stringify(whichMismatch.context).includes('OTHER_PATIENT_SENTINEL'),
    rel + ': generic "which" bypass retained another chart');

  const procedure = api.prepare('What procedures did he get done?', snapshot());
  assert(procedure.localAnswer && procedure.localAnswer.kind === 'patient-procedure-list', rel + ': procedure question was not deterministic');
  assert.strictEqual(procedure.localAnswer.status, 'ready');
  assert.strictEqual(procedure.localAnswer.citations[0].ref, 'V1');
  assert.strictEqual(procedure.chart, null, rel + ': procedure list was incorrectly forced into a chart');

  const chart = api.prepare('Chart his injection results over time', snapshot());
  assert.strictEqual(chart.localAnswer, null, rel + ': chart request was consumed as a procedure list');
  assert(chart.chart && chart.chart.status === 'ready' && chart.chart.patientId === 'pt-A', rel + ': documented patient chart was not prepared locally');

  const practice = api.prepare('Which patients are overdue for follow-up?', snapshot());
  assert.strictEqual(practice.scope, 'practice');
  assert.strictEqual(practice.context.requestScope, 'practice');
  assert.strictEqual(practice.context.patients.length, 2, rel + ': explicit panel request lost its panel');
  assert(JSON.stringify(practice.context).includes('OTHER_PATIENT_SENTINEL'), rel + ': explicit practice request was incorrectly patient-scoped');

  const comparison = api.prepare('Compare patients Gary Foster and Lola van Gilst', snapshot());
  assert.strictEqual(comparison.scope, 'practice', rel + ': explicit patient comparison was blocked as a subject mismatch');
  assert.strictEqual(comparison.localAnswer, null);
}

console.log('PASS Copilot request preflight: active questions are minimum-necessary, named mismatches fail closed, local procedure/chart evidence is deterministic, and explicit practice questions retain their panel');

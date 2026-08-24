'use strict';

/* Prep-summary debris + identity contract (easy-prep v1.1.0 / feat_visits):
 *  - Athena print-page scaffolding (inline JS, print headers) never reaches
 *    the doctor prep summary or the aggregated longitudinal summary
 *  - real clinical text on the same lines survives
 *  - text explicitly naming a DIFFERENT patient is withheld from display
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JUNK = "Print Premier Ortho and Philadelphia Hand to Shoulder • 915 OLD FERN HILL RD STE 1 B-A, WEST CHESTER PA 19380-4269 MORENO, Mary (id #7731709, dob: 06/01/1967) window.Original = {}; window.Original.IsSafari = IsSafari; IsSafari = function(){ return 0; } Jotter = function(params) { var svgjottercontainerid = params.div.id; }";

/* ---------- layer 1: feat_visits aggregator ---------- */
function stubEl() {
  return { style: {}, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, remove() {}, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } };
}
const windowStub = {};
const ctx = {
  window: windowStub,
  document: { getElementById() { return null; }, createElement() { return stubEl(); }, head: stubEl(), body: stubEl(), documentElement: stubEl(), addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch() { return Promise.reject(new Error('no network')); },
  setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
  MutationObserver: function () { return { observe() {}, disconnect() {} }; },
  navigator: {}, console
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'feat_visits.js'), 'utf8'), ctx);

const vmodel = windowStub.__mlsVisitModel;
assert.ok(vmodel && typeof vmodel._stripPageDebris === 'function', 'feat_visits must export _stripPageDebris');
const scrubbed = vmodel._stripPageDebris(JUNK + ' Follow-up lumbar spine, pain 4/10 improving.');
assert.ok(!/window\.|function\s*\(|SVGJotter|Jotter|IsSafari|svgjotter/i.test(scrubbed), 'no code survives: ' + scrubbed);
assert.ok(!/Print Premier Ortho|OLD FERN HILL|id #7731709/.test(scrubbed), 'no print header survives: ' + scrubbed);

const kept = vmodel._stripPageDebris('Lumbar ESI performed at L4-L5, pain 8/10 -> 3/10. ' + JUNK);
assert.match(kept, /Lumbar ESI performed at L4-L5, pain 8\/10 -> 3\/10\./, 'clinical text before the debris survives');
assert.ok(!/window\.|Jotter/.test(kept));

const agg = vmodel._aggregateSummary(
  { name: 'Mary Moreno', dob: '1967-06-01' },
  [
    { date: '2026-07-16', type: 'Lumbar Spine', raw: JUNK, source: 'athena-visit' },
    { date: '2026-06-25', type: 'Follow-up', raw: JUNK + ' Reports 50% relief since last injection.', source: 'athena-visit' }
  ],
  { history: { pmh: ['Spondylosis of lumbar spine'], psh: [], social: [], family: [], smoking: [] } }
);
assert.ok(!/window\.|Jotter|svgjotter|Print Premier Ortho/i.test(agg), 'aggregated summary must be scaffolding-free: ' + agg.slice(0, 300));
assert.match(agg, /Spondylosis of lumbar spine/);
assert.match(agg, /50% relief since last injection/);
assert.match(agg, /2026-07-16/);

/* ---------- layer 2: prep-summary display scrub + identity withhold ---------- */
const connect = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const a = connect.indexOf('MLS Scribe - EASY PATIENT PREP');
assert.ok(a > 0, 'easy-prep module present');
const b = connect.indexOf('MLS Scribe - OUTSIDE RECORDS', a);
assert.ok(b > a, 'easy-prep end marker present');
const start = connect.lastIndexOf('(function () {', a) >= 0 ? connect.indexOf('(function () {', a) : a;
const epSrc = connect.slice(start, connect.lastIndexOf('})();', b) + 5);
const winStub2 = {};
const ctx2 = {
  window: winStub2,
  document: ctx.document, localStorage: ctx.localStorage, navigator: {},
  setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
  MutationObserver: ctx.MutationObserver, console
};
ctx2.globalThis = ctx2;
vm.createContext(ctx2);
vm.runInContext(epSrc, ctx2);
const ep = winStub2.__mlsEasyPrep;
assert.ok(ep && ep.version === '1.2.0', 'easy-prep v1.2.0 expected, got ' + (ep && ep.version));

const cleaned = ep.scrubPageDebris('Pulled from Athena 7/16/2026 —\n' + JUNK + '\nRecent visits:\n• 2026-07-16 — ' + JUNK);
assert.ok(!/window\.|Jotter|Print Premier Ortho|id #7731709/i.test(cleaned), 'prep display scrub: ' + cleaned);
assert.match(cleaned, /• 2026-07-16 — no readable note text captured/, 'emptied visit bullet keeps its date with an honest placeholder');

const mary = { name: 'Mary Moreno', dob: '1967-06-01' };
const foreign = 'OPERATIVE REPORT Patient: Alexander, Michael Patient DOB: 1-2-1955 Physician: Matthew Schaeffer, MD';
assert.match(ep.withholdIfOtherPatient(foreign, mary), /^⚠ Withheld: this text names a different patient/,
  'another patient\'s op report must never display on this chart');
const own = 'OPERATIVE REPORT Patient: Moreno, Mary — lumbar procedure details.';
assert.strictEqual(ep.withholdIfOtherPatient(own, mary), own, 'the patient\'s own note passes through');
assert.strictEqual(ep.withholdIfOtherPatient('Reports pain 3/10, improving.', mary), 'Reports pain 3/10, improving.',
  'text with no explicit identity is untouched');

/* summary built end-to-end stays clean */
const summary = ep.buildPrepSummary({
  name: 'Mary Moreno', dob: '1967-06-01', age: 59, mrn: '7731709',
  allergies: 'NKDA', problems: 'Spondylosis of lumbar spine', meds: '',
  vitals: {}, bmi: 40.3, history: {},
  historySummary: cleaned, lastExcerpt: ep.withholdIfOtherPatient(foreign, mary),
  visitCount: 2, lastDate: '2026-07-16', careFlags: ''
});
assert.ok(!/window\.|Jotter|Print Premier Ortho/.test(summary));
assert.match(summary, /ALLERGIES: NKDA/);
assert.match(summary, /⚠ Withheld/);

/* SOURCE provenance must follow a trustworthy Athena receipt, never the mere
   presence of problems/medications/allergies that a clinician can type. */
const manualOnly = {
  id: 'patient-a', name: 'Mary Moreno', problems: 'Clinician-entered problem',
  meds: 'Clinician-entered medication', allergies: 'Clinician-entered allergy'
};
assert.strictEqual(ep.athenaChartProvenance(manualOnly).landed, false,
  'manual clinical fields were mistaken for an Athena pull');
assert.match(ep.buildPrepSummaryForPatient(manualOnly), /SOURCE: NOT PULLED from Athena yet/,
  'manual-only record lost its fail-closed source label');

const verifiedReceipt = {
  ...manualOnly,
  athenaProfileCoverage: {
    complete: true, exactIdentityVerified: true, patientId: 'patient-a',
    capturedAt: '2026-08-24T14:15:16.000Z',
    cards: { problems: { status: 'found' }, meds: { status: 'found' } }
  }
};
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(ep.athenaChartProvenance(verifiedReceipt))),
  {
    landed: true, partial: false, kind: 'verified-receipt', capturedAt: '2026-08-24T14:15:16.000Z',
    text: 'PULLED from Athena — identity-verified chart receipt from 2026-08-24; displayed fields may also include clinician-entered additions.'
  },
  'the current exact-patient coverage receipt did not authorize positive provenance'
);
assert.match(ep.buildPrepSummaryForPatient(verifiedReceipt),
  /SOURCE: PULLED from Athena — identity-verified chart receipt from 2026-08-24/,
  'verified current pull still rendered as not pulled');
assert.doesNotMatch(ep.buildPrepSummaryForPatient(verifiedReceipt), /SOURCE: NOT PULLED/);

const wrongPatientReceipt = {
  ...manualOnly,
  athenaProfileCoverage: {
    complete: true, exactIdentityVerified: true, patientId: 'patient-b',
    capturedAt: '2026-08-24T14:15:16.000Z'
  }
};
assert.strictEqual(ep.athenaChartProvenance(wrongPatientReceipt).landed, false,
  'another patient\'s receipt authorized this prep card');
assert.match(ep.buildPrepSummaryForPatient(wrongPatientReceipt), /SOURCE: NOT PULLED from Athena yet/);

const legacyReceipt = { ...manualOnly, athenaChartImportedAt: '2026-08-20T09:00:00.000Z' };
assert.strictEqual(ep.athenaChartProvenance(legacyReceipt).kind, 'legacy-import-stamp',
  'pre-coverage Athena records lost their historical import proof');
assert.match(ep.buildPrepSummaryForPatient(legacyReceipt),
  /SOURCE: PULLED from Athena — stored chart import receipt from 2026-08-20/);

const partialReceipt = {
  ...manualOnly,
  allergies: '',
  athenaPartialProfileCoverage: {
    kind: 'athena-partial-profile-coverage', complete: false,
    exactIdentityVerified: true, patientId: 'patient-a',
    capturedAt: '2026-08-24T15:00:00.000Z', identityProof: 'name-dob',
    fields: { problems: { status: 'found', count: 1 }, meds: { status: 'found', count: 1 } }
  }
};
assert.strictEqual(ep.athenaChartProvenance(partialReceipt).kind, 'verified-partial-receipt');
const partialSummary = ep.buildPrepSummaryForPatient(partialReceipt);
assert.match(partialSummary,
  /SOURCE: PARTIALLY PULLED from Athena — identity-verified capture from 2026-08-24 \(problems, medications only\)/);
assert.doesNotMatch(partialSummary, /SOURCE: NOT PULLED/);
assert.match(partialSummary,
  /ALLERGIES: Not captured in this partial Athena pull — re-pull the full chart/,
  'a partial receipt falsely converted an unread allergy card into NKDA/none');
assert.match(partialSummary,
  /VITALS: Not captured in this partial Athena pull — re-pull the full chart/);

const partialWrongPatient = {
  ...partialReceipt,
  athenaPartialProfileCoverage: { ...partialReceipt.athenaPartialProfileCoverage, patientId: 'patient-b' }
};
assert.strictEqual(ep.athenaChartProvenance(partialWrongPatient).kind, 'identity-conflict');
assert.match(ep.buildPrepSummaryForPatient(partialWrongPatient), /SOURCE: NOT PULLED from Athena yet/);
assert.strictEqual(ep.athenaChartProvenance({
  ...partialWrongPatient, athenaChartImportedAt: '2026-08-20T09:00:00.000Z'
}).kind, 'identity-conflict',
  'a wrong-patient partial receipt fell through to a looser legacy timestamp');

const staleConflict = {
  ...legacyReceipt,
  athenaProfileCoverage: {
    complete: true, exactIdentityVerified: true, patientId: 'patient-b',
    capturedAt: '2026-08-24T15:00:00.000Z'
  }
};
assert.strictEqual(ep.athenaChartProvenance(staleConflict).kind, 'identity-conflict',
  'a wrong-patient current receipt fell through to a looser legacy timestamp');
assert.match(ep.buildPrepSummaryForPatient(staleConflict), /SOURCE: NOT PULLED from Athena yet/);

console.log('prep-summary-debris: ok');

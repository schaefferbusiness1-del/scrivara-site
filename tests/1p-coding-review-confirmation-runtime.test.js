'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const p1 = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const p1Route = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const regular = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const start = p1.indexOf('const P1_EM_REFERENCE=');
const end = p1.indexOf('/* =========================================================\n   EMR', start);
assert(start > 0 && end > start, 'P1 E/M review runtime block is missing');
const reviewSource = p1.slice(start, end);

function harness() {
  const values = {
    visitComment: { value: '' },
    contextBox: { value: '' },
    optCard: { style: {} }
  };
  const context = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Promise,
    setTimeout,
    clearTimeout
  };
  context.window = context;
  context.document = { getElementById(id) { return values[id] || (values[id] = { value: '', textContent: '', innerHTML: '', style: {}, disabled: false }); } };
  vm.createContext(context);
  vm.runInContext(`
    var currentOpt=null,pendingCodingReview=null,currentCoding=null,lastEMR=null;
    var currentVisitAthenaBinding=null,currentVisitAthenaEpoch=0,bkUser=null;
    var fingerprintSeed='editor-a',saveOk=true,practiceEntries=[],practiceUpdated=1,toasts=[];
    window.__mlsCodeTable={load:function(){return {v:1,entries:practiceEntries.slice(),updated:practiceUpdated};}};
    function getActivePtId(){return 'patient-a';}
    function _athenaEditorFingerprint(){return fingerprintSeed;}
    function _athenaGuardBoundEditor(){return true;}
    function renderCoding(){}
    function populateEMR(){}
    function saveCurrentNote(){return saveOk;}
    function toast(message,kind){toasts.push({message:String(message),kind:String(kind||'')});}
    function esc(value){return String(value==null?'':value);}
    ${reviewSource}
    renderOpt=function(){};
    this.api={
      normalize:normalizeOpt,
      prepare:p1PrepareCodingReview,
      confirm:confirmCodingReview,
      discard:discardCodingReview,
      fingerprint:p1CodingReviewFingerprint,
      reference:P1_EM_REFERENCE,
      set:function(input){
        input=input||{};
        if(Object.prototype.hasOwnProperty.call(input,'coding'))currentCoding=input.coding;
        if(Object.prototype.hasOwnProperty.call(input,'opt'))currentOpt=input.opt;
        if(Object.prototype.hasOwnProperty.call(input,'binding'))currentVisitAthenaBinding=input.binding;
        if(Object.prototype.hasOwnProperty.call(input,'epoch'))currentVisitAthenaEpoch=input.epoch;
        if(Object.prototype.hasOwnProperty.call(input,'user'))bkUser=input.user;
        if(Object.prototype.hasOwnProperty.call(input,'fingerprint'))fingerprintSeed=input.fingerprint;
        if(Object.prototype.hasOwnProperty.call(input,'saveOk'))saveOk=input.saveOk;
        if(Object.prototype.hasOwnProperty.call(input,'practiceEntries'))practiceEntries=input.practiceEntries.slice();
        if(Object.prototype.hasOwnProperty.call(input,'practiceUpdated'))practiceUpdated=input.practiceUpdated;
      },
      state:function(){return {coding:currentCoding,opt:currentOpt,pending:pendingCodingReview,toasts:toasts.slice()};}
    };
  `, context, { filename: '1p-coding-review-runtime.js' });
  return context.api;
}

const source = [
  'Assessment: acute bronchitis with systemic symptoms.',
  'Independent interpretation of the chest X-ray was documented.',
  'Prescription drug management was performed.',
  'A large joint injection was performed during this visit.',
  'Total physician time on the date of service was 35 minutes.'
].join(' ');
const mdmPayload = {
  supported_em: '99214', method: 'mdm',
  em_justification: 'Moderate MDM is reached by two of three documented elements.',
  mdm_breakdown: 'Problems, data, and risk were reviewed using the current two-of-three MDM method.',
  mdm_elements: {
    problems: { level: 'moderate', explanation: 'Acute illness with systemic symptoms.' },
    data: { level: 'moderate', explanation: 'Independent interpretation is documented.' },
    risk: { level: 'moderate', explanation: 'Prescription drug management is documented.' }
  },
  supporting_evidence: [
    { element: 'problems', quote: 'acute bronchitis with systemic symptoms' },
    { element: 'data', quote: 'Independent interpretation of the chest X-ray was documented.' },
    { element: 'risk', quote: 'Prescription drug management was performed.' }
  ],
  icd10: [{ code: 'J20.9', desc: 'Acute bronchitis', evidence_quote: 'Assessment: acute bronchitis with systemic symptoms.' }],
  cpt: [{ code: '20610', desc: 'Large joint injection', evidence_quote: 'A large joint injection was performed during this visit.' }],
  missing_documentation: []
};

const api = harness();
const validMdm = api.normalize(mdmPayload, source, '99213');
assert.strictEqual(validMdm.valid, true, validMdm.validationReason);
assert.strictEqual(validMdm.evidence.length, 3, 'verified MDM source quotes were not retained');
assert.strictEqual(validMdm.reviewedIcd[0], 'J20.9 — Acute bronchitis');
assert.strictEqual(validMdm.reviewedCpt[0], '20610 — Large joint injection');

const unsupportedCodes = api.normalize(Object.assign({}, mdmPayload, {
  icd10: [{ code: 'M54.50', desc: 'Low back pain', evidence_quote: 'Low back pain was diagnosed.' }],
  cpt: [{ code: '29881', desc: 'Knee arthroscopy', evidence_quote: 'Knee arthroscopy was performed.' }]
}), source, '99213');
assert.strictEqual(unsupportedCodes.valid, true, unsupportedCodes.validationReason);
assert.deepStrictEqual(Array.from(unsupportedCodes.reviewedIcd), [], 'an ICD-10 code without exact visit evidence survived');
assert.deepStrictEqual(Array.from(unsupportedCodes.reviewedCpt), [], 'a CPT code without exact visit evidence survived');
assert.strictEqual(unsupportedCodes.codeEvidenceRejected, 2, 'excluded code suggestions were not counted');

const invented = api.normalize(Object.assign({}, mdmPayload, {
  supporting_evidence: [
    { element: 'problems', quote: 'acute bronchitis with systemic symptoms' },
    { element: 'risk', quote: 'Intensive monitoring for toxicity was performed.' }
  ]
}), source, '99213');
assert.strictEqual(invented.valid, false, 'an invented MDM quote was accepted');
assert.strictEqual(invented.evidence.length, 1, 'an invented quote survived source verification');

const overstated = api.normalize(Object.assign({}, mdmPayload, {
  mdm_elements: {
    problems: { level: 'low' }, data: { level: 'low' }, risk: { level: 'moderate' }
  }
}), source, '99213');
assert.strictEqual(overstated.valid, false, 'a moderate E/M code was accepted when two-of-three MDM resolved to low');

const timePayload = {
  supported_em: '99214', method: 'time', documented_time_minutes: 35,
  em_justification: 'Established-patient level selected from documented total time.',
  supporting_evidence: [{ element: 'time', quote: 'Total physician time on the date of service was 35 minutes.' }],
  icd10: [], cpt: [], missing_documentation: []
};
const validTime = api.normalize(timePayload, source, '99213');
assert.strictEqual(validTime.valid, true, validTime.validationReason);
assert.strictEqual(api.normalize(Object.assign({}, timePayload, { supporting_evidence: [] }), source, '99213').valid, false,
  'time without an exact source quote was accepted');
assert.strictEqual(api.normalize(Object.assign({}, timePayload, { supported_em: '99215' }), source, '99213').valid, false,
  'documented minutes were allowed to overstate the E/M level');
assert.strictEqual(api.normalize(Object.assign({}, timePayload, { supported_em: '99204' }), source, '99213').valid, false,
  'the review silently switched from established- to new-patient coding');

const initialCoding = { em: '99213', emJust: 'Original', icd: ['I10 — Hypertension'], cpt: [] };
const binding = { id: 'visit-a' };
api.set({ coding: initialCoding, binding, epoch: 7, user: { id: 44, role: 'physician', email: 'must-not-persist@example.invalid', name: 'Must Not Persist' } });
const pending = api.normalize(mdmPayload, source, '99213');
api.set({ opt: pending });
api.prepare(pending, binding, 7, api.fingerprint(), source);
assert.deepStrictEqual(JSON.parse(JSON.stringify(api.state().coding)), initialCoding,
  'preparing a coding review mutated current coding before confirmation');
assert.strictEqual(api.confirm(), true, 'an eligible same-visit clinician confirmation failed');
const confirmed = api.state();
assert.strictEqual(confirmed.coding.em, '99214');
assert.deepStrictEqual(Array.from(confirmed.coding.icd), ['J20.9 — Acute bronchitis']);
assert.strictEqual(confirmed.opt.review.status, 'confirmed');
assert.deepStrictEqual(JSON.parse(JSON.stringify(confirmed.opt.review.actor)), { role: 'physician' });
assert.equal(Object.prototype.hasOwnProperty.call(confirmed.opt.review.actor, 'userId'), false,
  'portable coding-review metadata retained a raw backend account identifier');
assert(!JSON.stringify(confirmed.opt.review.actor).includes('example.invalid') && !JSON.stringify(confirmed.opt.review.actor).includes('Must Not Persist'),
  'confirmation provenance leaked a clinician name or email');
assert.strictEqual(confirmed.opt.review.guideline.id, 'AMA-CPT-office-outpatient-E-M');
assert(confirmed.opt.review.practiceReference.hash, 'versioned practice-reference receipt is missing');

const changedApi = harness();
const changedOpt = changedApi.normalize(mdmPayload, source, '99213');
changedApi.set({ coding: initialCoding, opt: changedOpt, binding, epoch: 7, user: { id: 45, role: 'physician' } });
changedApi.prepare(changedOpt, binding, 7, changedApi.fingerprint(), source);
changedApi.set({ fingerprint: 'editor-changed' });
assert.strictEqual(changedApi.confirm(), false, 'changed visit content was still confirmed');
assert.strictEqual(changedApi.state().coding.em, '99213');

const roleApi = harness();
const roleOpt = roleApi.normalize(mdmPayload, source, '99213');
roleApi.set({ coding: initialCoding, opt: roleOpt, binding, epoch: 7, user: { id: 46, role: 'scribe' } });
roleApi.prepare(roleOpt, binding, 7, roleApi.fingerprint(), source);
assert.strictEqual(roleApi.confirm(), false, 'a scribe could confirm clinician coding');
assert.strictEqual(roleApi.state().coding.em, '99213');

for (const deniedUser of [
  null,
  { id: 60, role: 'nurse' },
  { id: 61, role: 'medical_assistant' },
  { id: 62, role: 'pa_np' },
  { id: 63, role: 'practice_admin' },
  { id: 64, role: 'owner' },
  { id: 65, role: 'admin', isAdmin: true },
  { id: 67, role: 'admin', isHead: true },
  { id: 66, role: 'unknown_future_role' }
]) {
  const deniedApi = harness();
  const deniedOpt = deniedApi.normalize(mdmPayload, source, '99213');
  deniedApi.set({ coding: initialCoding, opt: deniedOpt, binding, epoch: 7, user: deniedUser });
  deniedApi.prepare(deniedOpt, binding, 7, deniedApi.fingerprint(), source);
  assert.strictEqual(deniedApi.confirm(), false, `non-physician role reached coding confirmation: ${deniedUser && deniedUser.role}`);
  assert.strictEqual(deniedApi.state().coding.em, '99213');
}

const rollbackApi = harness();
const rollbackOpt = rollbackApi.normalize(mdmPayload, source, '99213');
rollbackApi.set({ coding: initialCoding, opt: rollbackOpt, binding, epoch: 7, user: { id: 47, role: 'pa_np' }, saveOk: false });
rollbackApi.prepare(rollbackOpt, binding, 7, rollbackApi.fingerprint(), source);
assert.strictEqual(rollbackApi.confirm(), false, 'a failed durable save was reported as confirmed');
assert.strictEqual(rollbackApi.state().coding.em, '99213', 'a failed save did not roll coding back');
assert.strictEqual(rollbackApi.state().opt.review.status, 'pending', 'a failed save did not restore pending review state');

const staleRefApi = harness();
const staleRefOpt = staleRefApi.normalize(mdmPayload, source, '99213');
staleRefApi.set({ coding: initialCoding, opt: staleRefOpt, binding, epoch: 7, user: { id: 48, role: 'physician' }, practiceEntries: [{ code: 'old' }], practiceUpdated: 1 });
staleRefApi.prepare(staleRefOpt, binding, 7, staleRefApi.fingerprint(), source);
staleRefApi.set({ practiceEntries: [{ code: 'new' }], practiceUpdated: 2 });
assert.strictEqual(staleRefApi.confirm(), false, 'a review survived a changed practice coding reference');
assert.strictEqual(staleRefApi.state().coding.em, '99213');

const generationBody = p1.slice(p1.indexOf('async function reviewCodingDocumentation()'), p1.indexOf('async function postChatRaw'));
assert(!/currentCoding\s*=/.test(generationBody), 'AI review generation still mutates currentCoding');
assert(generationBody.includes('normalizeOpt(data,reviewEvidenceSource,preOptEm)') &&
  generationBody.includes('p1PrepareCodingReview(currentOpt,optimizationBinding,optimizationEpoch,optimizationFingerprint,reviewEvidenceSource)'),
  'confirmation evidence can still be grounded by background chart text instead of the current visit');
const card = p1.slice(p1.indexOf('<div class="opt-card" id="optCard"'), p1.indexOf('<!-- 💵 Revenue tools'));
assert(card.includes('E/M Documentation &amp; Coding Review') && card.includes('confirmCodingReview()') && card.includes('opt_evidence') && card.includes('opt_reference'));
assert(!/payout|reimbursement|revenue estimate|\$\d/i.test(card), 'active P1 E/M review still frames coding as payout optimization');
const routeRuntime = p1Route.slice(p1Route.indexOf('const P1_EM_REFERENCE='), p1Route.indexOf('/* =========================================================\n   EMR', p1Route.indexOf('const P1_EM_REFERENCE=')));
assert.strictEqual(routeRuntime, reviewSource, 'the actual /p1 route diverged from the verified P1 E/M review runtime');
const routeCard = p1Route.slice(p1Route.indexOf('<div class="opt-card" id="optCard"'), p1Route.indexOf('<!-- 💵 Revenue tools'));
assert.strictEqual(routeCard, card, 'the actual /p1 route diverged from the verified P1 E/M review card');
const productionStart = regular.indexOf('const P1_EM_REFERENCE=');
const productionEnd = regular.indexOf('/* =========================================================\n   EMR', productionStart);
assert(productionStart > 0 && productionEnd > productionStart,
  'the officially promoted production E/M review runtime is missing');
const productionReviewSource = regular.slice(productionStart, productionEnd);
const productionCardStart = regular.indexOf('<div class="opt-card" id="optCard"');
const productionCardEnd = regular.indexOf('<!-- 💵 Revenue tools', productionCardStart);
assert(productionCardStart > 0 && productionCardEnd > productionCardStart,
  'the officially promoted production E/M review card is missing');
const productionCard = regular.slice(productionCardStart, productionCardEnd);
assert.strictEqual(productionReviewSource, reviewSource,
  'the production E/M review runtime drifted from its official /p1 source');
assert.strictEqual(productionCard, card,
  'the production E/M review card drifted from its official /p1 source');
assert(regular.includes('function p1CodingReviewFingerprint()') && !regular.includes('Optimize for Insurance Payout'),
  'the production shell lost the promoted evidence-bound review or restored the retired payout framing');
assert(!/payout|reimbursement|revenue estimate|\$\d/i.test(productionCard),
  'the promoted production E/M review card reintroduced financial-outcome framing');

console.log('PASS promoted E/M review: exact /p1-production parity, evidence, current MDM/time rules, visible provenance, explicit clinician confirmation, stale-state refusal, role wall, and save rollback');

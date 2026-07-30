'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing start marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

const artifacts = [
  {
    name: 'prior authorization',
    source: between(app, 'async function generatePriorAuth()', 'function sendPaToEMR(btn)'),
    binding: 'priorAuthBinding=currentVisitAthenaBinding',
    epoch: 'priorAuthEpoch=currentVisitAthenaEpoch',
    fingerprint: 'priorAuthSourceFingerprint=JSON.stringify(priorAuthSources)',
    guard: "_athenaAsyncBindingStillSafe(priorAuthBinding,'prior-authorization drafting',priorAuthEpoch)",
    compare: 'JSON.stringify(_readPriorAuthSources())!==priorAuthSourceFingerprint',
    mutation: 'currentPriorAuth=priorAuthDraft',
    sourceFields: ['service:', 'isAppeal:', 'ptLine:', 'provider:', 'spec:', 'dxLine:', 'note:', 'noteFormat:', 'pctx:', 'denialReason:', 'denialText:', 'key:']
  },
  {
    name: 'MIPS',
    source: between(app, 'async function runMipsCheck()', 'function copyMips()'),
    binding: 'mipsBinding=currentVisitAthenaBinding',
    epoch: 'mipsEpoch=currentVisitAthenaEpoch',
    fingerprint: 'mipsSourceFingerprint=JSON.stringify(mipsSources)',
    guard: "_athenaAsyncBindingStillSafe(mipsBinding,'MIPS checking',mipsEpoch)",
    compare: 'JSON.stringify(_readMipsSources())!==mipsSourceFingerprint',
    mutation: 'currentMips=mipsDraft',
    sourceFields: ['note:', 'noteFormat:', 'key:']
  },
  {
    name: 'after-visit summary',
    source: between(app, 'async function generateAVS()', '/* =========================================================\n   REFERRAL LETTER'),
    binding: 'avsBinding=currentVisitAthenaBinding',
    epoch: 'avsEpoch=currentVisitAthenaEpoch',
    fingerprint: 'avsSourceFingerprint=JSON.stringify(avsSources)',
    guard: "_athenaAsyncBindingStillSafe(avsBinding,'patient-summary drafting',avsEpoch)",
    compare: 'JSON.stringify(_readAvsSources())!==avsSourceFingerprint',
    mutation: 'currentAVS=avsDraft',
    sourceFields: ['note:', 'noteFormat:', 'pctx:', 'prefs:', 'key:']
  },
  {
    name: 'referral',
    source: between(app, 'async function generateReferral()', 'function showExtra(cardId,bodyId,text)'),
    binding: 'referralBinding=currentVisitAthenaBinding',
    epoch: 'referralEpoch=currentVisitAthenaEpoch',
    fingerprint: 'referralSourceFingerprint=JSON.stringify(referralSources)',
    guard: "_athenaAsyncBindingStillSafe(referralBinding,'referral drafting',referralEpoch)",
    compare: 'JSON.stringify(_readReferralSources())!==referralSourceFingerprint',
    mutation: 'currentReferral=referralDraft',
    sourceFields: ['to:', 'from:', 'spec:', 'note:', 'noteFormat:', 'pctx:', 'prefs:', 'key:']
  }
];

for (const artifact of artifacts) {
  const awaitAt = artifact.source.indexOf('await aiCallRaw');
  const mutateAt = artifact.source.indexOf(artifact.mutation);
  const bindingAt = artifact.source.indexOf(artifact.binding);
  const epochAt = artifact.source.indexOf(artifact.epoch);
  const fingerprintAt = artifact.source.indexOf(artifact.fingerprint);
  const guardAt = artifact.source.indexOf(artifact.guard, awaitAt);
  const compareAt = artifact.source.indexOf(artifact.compare, awaitAt);
  const requireBindingAt = artifact.source.indexOf('if(!currentVisitAthenaBinding)');
  const editorGuardAt = artifact.source.indexOf('_athenaGuardBoundEditor(');
  assert(awaitAt >= 0 && mutateAt > awaitAt, `${artifact.name} is missing its async result boundary`);
  assert(requireBindingAt >= 0 && requireBindingAt < awaitAt, `${artifact.name} can start without an immutable visit binding`);
  assert(editorGuardAt >= 0 && editorGuardAt < awaitAt, `${artifact.name} does not validate the bound editor before starting`);
  assert(bindingAt >= 0 && bindingAt < awaitAt, `${artifact.name} did not freeze the visit binding before awaiting`);
  assert(epochAt >= 0 && epochAt < awaitAt, `${artifact.name} did not freeze the visit epoch before awaiting`);
  assert(fingerprintAt >= 0 && fingerprintAt < awaitAt, `${artifact.name} did not fingerprint its source inputs before awaiting`);
  assert(guardAt > awaitAt && guardAt < mutateAt, `${artifact.name} can write a result before revalidating its visit`);
  assert(compareAt > awaitAt && compareAt < mutateAt, `${artifact.name} can write a result after its same-visit sources changed`);
  for (const field of artifact.sourceFields) {
    assert(artifact.source.includes(field), `${artifact.name} source fingerprint omits ${field}`);
  }
}

function element(value, display) {
  return {
    value: value || '',
    textContent: value || '',
    innerHTML: value || '',
    disabled: false,
    style: { display: display == null ? 'block' : display },
    scrollCalls: 0,
    scrollIntoView() { this.scrollCalls++; }
  };
}

async function main() {
  const elements = {
    noteBox: element('NOTE A'),
    paGenBtn: element('Generate'),
    paDenialReason: element('Not medically necessary'),
    paDenialText: element('Denial A'),
    paLetter: element('PA OLD'),
    paResultWrap: element('', 'none'),
    mipsBtn: element('MIPS'),
    mipsBody: element('MIPS OLD'),
    mipsCard: element('', 'none'),
    avsBtn: element('AVS'),
    avsBody: element('AVS OLD'),
    avsCard: element('', 'none'),
    refBtn: element('Referral'),
    refBody: element('REF OLD'),
    refCard: element('', 'none')
  };
  const pending = [];
  const toasts = [];
  let service = 'MRI lumbar spine';
  let patientContext = 'PATIENT CONTEXT A';
  let providerName = 'Provider A';
  let prefs = 'PREFS A';
  let showExtraCalls = 0;

  const bindingA = { id: 'visit-a' };
  const bindingB = { id: 'visit-b' };
  const context = {
    console,
    Promise,
    JSON,
    String,
    Object,
    Array,
    RegExp,
    currentSoap: 'NOTE A',
    currentInsurance: '',
    currentFormat: 'soap',
    currentPriorAuth: 'PA OLD',
    currentMips: 'MIPS OLD',
    currentAVS: 'AVS OLD',
    currentReferral: 'REF OLD',
    currentVisitAthenaBinding: bindingA,
    currentVisitAthenaEpoch: 1,
    paMode: 'auth',
    ordersDx: { text: 'Lumbar pain', icd: ['M54.50'] },
    document: { getElementById(id) { return elements[id] || null; } },
    hasAI() { return true; },
    backendMode() { return true; },
    getKey() { return 'test-key'; },
    getName() { return providerName; },
    /* b806: the prior-auth request captures the CLINICAL provider identity
       (clinicalProviderName -> uns('providerName')), not the login/account
       display name. Driven by the SAME variable as getName so the mid-flight
       provider change below still exercises the request-details guard it was
       written to exercise — the point of that mutation is "a source used for the
       request changed", and which source it is does not matter here. */
    clinicalProviderName() { return providerName; },
    getPreset() { return 'Pain medicine'; },
    getSpec() { return ''; },
    activePatient() { return { name: 'Patient A', dob: '01/01/1970', sex: 'F', mrn: '100' }; },
    buildPatientContext() { return patientContext; },
    docPrefsBlock() { return prefs; },
    noteDiagnosisText() { return { text: 'Lumbar pain', icd: ['M54.50'] }; },
    paSelectedService() { return service; },
    prompt() { return 'Cardiology'; },
    /* 2026-07-22: artifact prompts are non-blocking in-app dialogs now */
    mlsPrompt() { return Promise.resolve('Cardiology'); },
    mlsConfirm() { return Promise.resolve(true); },
    currentNoteText() {
      const nb = elements.noteBox;
      if (nb && nb.style.display !== 'none') {
        if (context.currentFormat === 'soap') context.currentSoap = nb.value;
        else context.currentInsurance = nb.value;
      }
      return (context.currentFormat === 'insurance' ? context.currentInsurance : context.currentSoap) || context.currentSoap || '';
    },
    _athenaGuardBoundEditor() { return !!context.currentVisitAthenaBinding; },
    _athenaAsyncBindingStillSafe(candidate, _label, epoch) {
      const current = context.currentVisitAthenaBinding;
      const safe = !!(candidate && current && candidate.id === current.id && Number(epoch) === Number(context.currentVisitAthenaEpoch));
      if (!safe) toasts.push({ message: 'The selected patient or visit changed, so MLS discarded that result. Nothing changed in Athena.', kind: 'err' });
      return safe;
    },
    aiCallRaw() { return new Promise(resolve => pending.push(resolve)); },
    friendlyError(err) { return String(err && err.message || err); },
    toast(message, kind) { toasts.push({ message, kind }); },
    mipsToHtml(text) { return `HTML:${text}`; },
    expandCardSliver() {},
    offlineAVS() { return 'OFFLINE AVS'; },
    offlineReferral() { return 'OFFLINE REF'; },
    showExtra(cardId, bodyId, text) {
      showExtraCalls++;
      elements[bodyId].textContent = text;
      elements[cardId].style.display = 'block';
    }
  };
  context.window = context;

  const executable = artifacts.map(a => a.source).join('\n');
  vm.runInNewContext(executable, context, { filename: 'ScribeFlow-artifact-functions.js' });

  let run = context.generatePriorAuth();
  assert.strictEqual(pending.length, 1, 'prior authorization did not reach its delayed request');
  service = 'MRI cervical spine';
  pending.shift()('PA NEW');
  await run;
  assert.strictEqual(context.currentPriorAuth, 'PA OLD', 'changed prior-auth inputs accepted an older response');
  assert.strictEqual(elements.paLetter.value, 'PA OLD', 'changed prior-auth inputs mutated the visible letter');
  assert.strictEqual(elements.paResultWrap.style.display, 'none', 'changed prior-auth inputs opened a stale result');
  service = 'MRI lumbar spine';

  run = context.runMipsCheck();
  assert.strictEqual(pending.length, 1, 'MIPS did not reach its delayed request');
  elements.noteBox.value = 'NOTE B';
  pending.shift()('MIPS NEW');
  await run;
  assert.strictEqual(context.currentMips, 'MIPS OLD', 'same-visit note edits accepted an older MIPS response');
  assert.strictEqual(elements.mipsBody.innerHTML, 'MIPS OLD', 'same-visit note edits mutated the visible MIPS result');
  elements.noteBox.value = 'NOTE A';
  context.currentSoap = 'NOTE A';

  run = context.generateAVS();
  assert.strictEqual(pending.length, 1, 'AVS did not reach its delayed request');
  patientContext = 'PATIENT CONTEXT B';
  pending.shift()('AVS NEW');
  await run;
  assert.strictEqual(context.currentAVS, 'AVS OLD', 'changed patient background accepted an older AVS response');
  assert.strictEqual(elements.avsBody.textContent, 'AVS OLD', 'changed patient background mutated the visible AVS');
  assert.strictEqual(showExtraCalls, 0, 'a stale AVS reached the shared result renderer');
  patientContext = 'PATIENT CONTEXT A';

  run = context.generateReferral();
  /* the referral flow awaits its non-blocking specialty dialog before the AI
     request — flush microtasks so the delayed request is actually in flight */
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(pending.length, 1, 'referral did not reach its delayed request');
  providerName = 'Provider B';
  pending.shift()('REF NEW');
  await run;
  assert.strictEqual(context.currentReferral, 'REF OLD', 'changed referral details accepted an older response');
  assert.strictEqual(elements.refBody.textContent, 'REF OLD', 'changed referral details mutated the visible referral');
  assert.strictEqual(showExtraCalls, 0, 'a stale referral reached the shared result renderer');
  providerName = 'Provider A';

  run = context.generateAVS();
  assert.strictEqual(pending.length, 1, 'visit-switch AVS did not reach its delayed request');
  context.currentVisitAthenaBinding = bindingB;
  context.currentVisitAthenaEpoch = 2;
  pending.shift()('PATIENT A AVS');
  await run;
  assert.strictEqual(context.currentAVS, 'AVS OLD', 'patient A AVS crossed into patient B');
  assert.strictEqual(elements.avsBody.textContent, 'AVS OLD', 'patient A AVS changed patient B visible state');

  // The guards must still accept each result when both the visit and every
  // source used for its request remain unchanged.
  context.currentVisitAthenaBinding = bindingA;
  context.currentVisitAthenaEpoch = 3;
  async function accept(fn, value) {
    const accepted = context[fn]();
    /* generateReferral awaits its non-blocking specialty dialog first */
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(pending.length, 1, `${fn} did not start its accepted-path request`);
    pending.shift()(value);
    await accepted;
  }
  await accept('generatePriorAuth', 'PA ACCEPTED');
  await accept('runMipsCheck', 'MIPS ACCEPTED');
  await accept('generateAVS', 'AVS ACCEPTED');
  await accept('generateReferral', 'REF ACCEPTED');
  assert.strictEqual(context.currentPriorAuth, 'PA ACCEPTED');
  assert.strictEqual(elements.paLetter.value, 'PA ACCEPTED');
  assert.strictEqual(context.currentMips, 'MIPS ACCEPTED');
  assert.strictEqual(elements.mipsBody.innerHTML, 'HTML:MIPS ACCEPTED');
  assert.strictEqual(context.currentAVS, 'AVS ACCEPTED');
  assert.strictEqual(elements.avsBody.textContent, 'AVS ACCEPTED');
  assert.strictEqual(context.currentReferral, 'REF ACCEPTED');
  assert.strictEqual(elements.refBody.textContent, 'REF ACCEPTED');

  const honestDiscards = toasts.filter(t => t.kind === 'err' && /discarded/.test(t.message) && /Nothing changed in Athena/.test(t.message));
  assert(honestDiscards.length >= 5, 'stale artifact work did not fail closed with an honest user-facing explanation');
  console.log('PASS async artifact binding: all four generators freeze visit/source state and discard delayed stale results');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

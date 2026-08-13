'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const visitsSource = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const historyUiSource = fs.readFileSync(path.join(root, 'feat_visit_history_ext.js'), 'utf8');

/* Do not retain the visit model's unrelated page-lifetime hygiene retry in
 * this isolated trust-provenance harness. Zero-delay model yields still run. */
function testSetTimeout(fn, delay, ...args) {
  if ([4500, 20000, 25000].includes(Number(delay))) return 0;
  return setTimeout(fn, delay, ...args);
}

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing start marker ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing end marker ${end}`);
  return source.slice(a, b);
}

const modelSource = between(visitsSource, '/* ----------------------------------------------------------------------------\n * 1) VISIT-AWARE DATA MODEL', '/* ----------------------------------------------------------------------------\n * 2) PER-VISIT PROFILE UI');
const copySource = between(visitsSource, '/* ----------------------------------------------------------------------------\n * 3) COPY EVERY VISIT', '/* ----------------------------------------------------------------------------\n * 4) WIRE THE GRAB');

function makeModelHarness(loadCopy) {
  let patients = [{
    id: 'patient-a', name: 'Example Patient', dob: '01/02/1970',
    problems: '', meds: '', allergies: '', summary: '', visits: []
  }];
  let aiCalls = 0;
  const document = {
    readyState: 'loading',
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; },
    createElement() { return {}; },
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document,
    setTimeout: testSetTimeout, clearTimeout,
    setInterval() { return 1; }, clearInterval() {},
    addEventListener() {}, removeEventListener() {}, postMessage() {},
    getPatients() { return patients; },
    findPatient(id) { return patients.find(p => p.id === id) || null; },
    upsertPatient(p) {
      const i = patients.findIndex(x => x.id === p.id);
      if (i >= 0) patients[i] = p; else patients.push(p);
    },
    activePatient() { return patients[0]; },
    aiCallRaw() { aiCalls++; return Promise.resolve('Diagnoses: generated summary'); }
  };
  context.window = context;
  vm.runInNewContext(modelSource, context, { filename: 'visit-model.js' });
  if (loadCopy) vm.runInNewContext(copySource, context, { filename: 'copy-visits.js' });
  return {
    context,
    M: context.__mlsVisitModel,
    patient() { return patients[0]; },
    aiCalls() { return aiCalls; }
  };
}

function usableText(h) {
  return JSON.stringify(Array.from(h.M.usableVisits(h.patient()), v => ({
    raw: v.raw, icd10: v.icd10, meds: v.meds, binding: v.identityBinding
  })));
}

function testUnverifiedThenVerifiedCannotLaunder() {
  const h = makeModelHarness(false);
  h.M.addVisit('patient-a', {
    date: '2026-01-01', type: 'Office visit', cpt: ['99213'], icd10: ['Z99.89'], meds: ['wrongdrug'],
    raw: 'Patient: Different Person DOB: 03/04/1980\nDiagnoses: wrong condition with deliberately longer contaminated text'
  }, { source: 'athena-copy' });
  h.M.addVisit('patient-a', {
    date: '2026-01-01', type: 'Office visit', cpt: ['99213'], icd10: ['M54.16'], meds: ['gabapentin'],
    raw: 'Diagnoses: correct condition'
  }, { source: 'athena-copy', identityVerified: true, identityBinding: 'patient-a' });
  const usable = usableText(h);
  assert(/correct condition/.test(usable), 'the verified row disappeared');
  assert(!/Different Person|wrong condition|wrongdrug|Z99\.89/.test(usable), 'unverified content was laundered into a verified row');
}

function testVerifiedThenUnverifiedCannotContaminate() {
  const h = makeModelHarness(false);
  h.M.addVisit('patient-a', {
    date: '2026-01-02', type: 'Office visit', cpt: ['99213'], icd10: ['M54.16'], meds: ['gabapentin'],
    raw: 'Diagnoses: correct condition'
  }, { source: 'athena-copy', identityVerified: true, identityBinding: 'patient-a' });
  h.M.addVisit('patient-a', {
    date: '2026-01-02', type: 'Office visit', cpt: ['99213'], icd10: ['Z99.89'], meds: ['wrongdrug'],
    raw: 'Patient: Different Person DOB: 03/04/1980\nDiagnoses: wrong condition with deliberately longer contaminated text'
  }, { source: 'athena-copy' });
  const usable = usableText(h);
  assert(/correct condition/.test(usable), 'the original verified row disappeared');
  assert(!/Different Person|wrong condition|wrongdrug|Z99\.89/.test(usable), 'a later unverified row contaminated trusted history');
}

function testIdentityBindingMustMatchPatient() {
  const h = makeModelHarness(false);
  h.M.addVisit('patient-a', {
    date: '2026-01-03', type: 'Office visit', raw: 'Diagnoses: belongs to another binding'
  }, { source: 'athena-copy', identityVerified: true, identityBinding: 'patient-b' });
  assert.strictEqual(h.M.usableVisits(h.patient()).length, 0, 'identityVerified bypassed a mismatched immutable patient binding');
}

function testRawPayloadCannotSelfAssertTrust() {
  const h = makeModelHarness(false);
  const forged = h.M.addVisit('patient-a', {
    date: '2026-01-03', type: 'Office visit', source: 'manual',
    identityVerified: true, identityBinding: 'patient-a',
    raw: 'Patient: Different Person DOB: 03/04/1980\nDiagnoses: forged trust metadata'
  }, { source: 'athena-copy' });
  assert.strictEqual(forged.source, 'athena-copy', 'raw payload overrode out-of-band source provenance');
  assert.strictEqual(forged.identityVerified, false, 'raw payload self-asserted identityVerified');
  assert.strictEqual(forged.identityBinding, '', 'raw payload self-asserted identityBinding');
  assert.strictEqual(h.M.usableVisits(h.patient()).length, 0, 'forged raw trust fields entered longitudinal history');

  const missingBinding = h.M._normVisit({
    source: 'manual', identityVerified: true, identityBinding: 'patient-a', raw: 'forged'
  }, 'athena-copy', { identityVerified: true });
  assert.strictEqual(missingBinding.identityVerified, false, 'identityVerified was granted without an out-of-band immutable binding');
  assert.strictEqual(missingBinding.identityBinding, '', 'raw binding survived a missing out-of-band binding');
}

function testPersistedTrustedRowsRemainTrustedWithoutReingestion() {
  const h = makeModelHarness(false);
  const stored = {
    id: 'stored-trusted-visit', date: '2026-01-05', type: 'Office visit',
    source: 'athena-copy', identityVerified: true, identityBinding: 'patient-a',
    raw: 'Diagnoses: previously verified persisted history'
  };
  h.patient().visits.push(stored);
  const usable = Array.from(h.M.usableVisits(h.patient()));
  assert.strictEqual(usable.length, 1, 'existing identity-bound persisted history was downgraded or discarded');
  assert.strictEqual(usable[0], stored, 'persisted trusted history was routed through untrusted normalization');
  assert.strictEqual(stored.identityVerified, true, 'persisted trust state was mutated during read');
  assert.strictEqual(stored.identityBinding, 'patient-a', 'persisted identity binding was mutated during read');
}

function testStringVisitsStayDistinctDatedAndIndexOnly() {
  const h = makeModelHarness(false);
  h.M.ingestChart(h.patient(), {
    visits: ['06/01/2026 — first visit', '06/02/2026 — second visit']
  }, 'athena-copy', { identityVerified: true, identityBinding: 'patient-a' });
  const visits = Array.from(h.M.getVisits(h.patient()));
  assert.strictEqual(visits.length, 2, 'two production-shaped visit strings collapsed into one dedupe row');
  const dates = visits.map(v => v.date).sort().join('|');
  assert.strictEqual(dates, '2026-06-01|2026-06-02', 'dates embedded in visit strings were not normalized into per-visit dates');
  const heads = visits.map(v => v.textHead).join('|');
  assert(/first visit/.test(heads) && /second visit/.test(heads), 'one string visit index row was discarded');
  assert(visits.every(v => v.indexOnly === true && !v.raw), 'parser string rows became clinical bodies');
  assert.strictEqual(h.M.usableVisits(h.patient()).length, 0, 'parser string rows entered longitudinal/op-note context');
}

async function testDirectSummaryRejectsUnverifiedVisit() {
  const h = makeModelHarness(false);
  const visit = h.M.addVisit('patient-a', {
    date: '2026-01-04', type: 'Office visit', raw: 'Patient: Different Person DOB: 03/04/1980'
  }, { source: 'athena-copy' });
  try { await h.M.summarizeVisit('patient-a', visit.id, { force: true }); } catch (_) {}
  assert.strictEqual(h.aiCalls(), 0, 'direct summarizeVisit sent unverified Athena data to AI');
  assert.strictEqual(String(visit.aiSummary || ''), '', 'direct summarizeVisit persisted a summary for an unverified row');
}

function testMissingDobFallbackCannotBecomeVerified() {
  const fallback = between(copySource, 'if (res._fallback &&', 'var saved = saveVisits');
  const strictReject = /if\s*\(\s*!cvv\.ok\s*\)/.test(fallback) ||
    /!cvv\.dobPresent[\s\S]{0,180}!cvv\.dobEqual/.test(fallback);
  const proofDerivedFlag = /identityVerified\s*:\s*(?:!!\s*)?cvv\.ok/.test(fallback);
  assert(strictReject || proofDerivedFlag, 'fallback chart capture can mark a name-only, missing-DOB chart identityVerified');
}

function testPrintedIdentityVariantsFailClosed() {
  const h = makeModelHarness(true);
  const copy = h.context.__mlsCopyVisits;
  const one = copy._explicitVisitIdentity('Patient Name: Different Person\nBirth Date: 03/04/1980');
  assert.strictEqual(one.name, 'Different Person', 'Patient Name label was not parsed');
  assert.strictEqual(h.M._normDob(one.dob), '03/04/1980', 'Birth Date label was not parsed');
  assert.strictEqual(copy._visitIdentityAgrees(h.patient(), 'Patient Name: Different Person\nBirth Date: 03/04/1980'), false, 'contradictory Patient Name/Birth Date text was accepted');

  const two = copy._explicitVisitIdentity('Name: Different Person | DOB 03/04/1980');
  assert.strictEqual(two.name, 'Different Person', 'Name label was not parsed');
  assert.strictEqual(h.M._normDob(two.dob), '03/04/1980', 'DOB without a colon was not parsed');
  assert.strictEqual(copy._visitIdentityAgrees(h.patient(), 'Name: Different Person | DOB 03/04/1980'), false, 'contradictory Name/DOB text was accepted');
}

function testHistorySignatureTracksTrustAndContent() {
  const sigSource = between(historyUiSource, 'function dataSig', 'var _lastSig');
  assert(/identityVerified/.test(sigSource), 'history UI signature ignores trust-state changes');
  assert(/identityBinding/.test(sigSource), 'history UI signature ignores patient-binding changes');
  assert(/\braw\b|\bfindings\b|\bplan\b/.test(sigSource), 'history UI signature ignores same-count content edits');
}

function testHistoryObserverRebindsToReplacementProfile() {
  const card1 = { id: 'profile-1', offsetParent: {} };
  const card2 = { id: 'profile-2', offsetParent: {} };
  let profile = card1;
  const intervals = [];
  const observed = [];
  const disconnected = [];
  class FakeObserver {
    observe(target) { this.target = target; observed.push(target); }
    disconnect() { disconnected.push(this.target); }
  }
  const document = {
    readyState: 'complete',
    getElementById(id) { return id === 'profileCard' ? profile : null; },
    createElement() { return { style: {}, remove() {} }; },
    addEventListener() {}, removeEventListener() {},
    head: { appendChild() {} }, documentElement: { appendChild() {} }, body: { appendChild() {} }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document, MutationObserver: FakeObserver,
    activePatient() { return null; },
    setTimeout() { return 1; }, clearTimeout() {},
    setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {}
  };
  context.window = context;
  vm.runInNewContext(historyUiSource, context, { filename: 'visit-history-ui.js' });
  assert(observed.includes(card1), 'history observer did not attach to the initial profile card');
  profile = card2;
  intervals.forEach(fn => fn());
  assert(observed.includes(card2), 'history observer stayed attached to a detached/replaced profile card');
  assert(disconnected.includes(card1), 'old profile observer was not disconnected during rebind');
}

async function main() {
  const cases = [
    ['unverified→verified trust laundering', testUnverifiedThenVerifiedCannotLaunder],
    ['verified→unverified contamination', testVerifiedThenUnverifiedCannotContaminate],
    ['identity binding mismatch', testIdentityBindingMustMatchPatient],
    ['raw trust self-assertion', testRawPayloadCannotSelfAssertTrust],
    ['persisted trusted row preservation', testPersistedTrustedRowsRemainTrustedWithoutReingestion],
    ['string visit preservation', testStringVisitsStayDistinctDatedAndIndexOnly],
    ['direct summary identity gate', testDirectSummaryRejectsUnverifiedVisit],
    ['missing-DOB fallback gate', testMissingDobFallbackCannotBecomeVerified],
    ['printed identity label variants', testPrintedIdentityVariantsFailClosed],
    ['history signature completeness', testHistorySignatureTracksTrustAndContent],
    ['history observer rebind', testHistoryObserverRebindsToReplacementProfile]
  ];
  const failures = [];
  for (const [name, fn] of cases) {
    try { await fn(); }
    catch (err) { failures.push(`${name}: ${err.message}`); }
  }
  if (failures.length) {
    console.error('FAIL history organization adversarial coverage:\n- ' + failures.join('\n- '));
    process.exitCode = 1;
    return;
  }
  console.log('PASS history organization adversarial: trust provenance, binding, production visit shapes, summary gating, identity variants, and UI lifecycle fail closed');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

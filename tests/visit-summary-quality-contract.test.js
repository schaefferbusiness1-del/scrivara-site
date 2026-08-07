'use strict';
/* px-2.x contract - the longitudinal summary and per-visit AI summaries.
   Measured live 2026-08-07 before the fix: 26 of 34 stored athenaHistorySummary
   values were ONLY the header line; 8 carried a duplicated passage (the "lead"
   printed visits[0] and the Recent-visits loop printed it again); 1,383 of
   1,444 visit aiSummary values were EMPTY STRINGS stored by unvalidated model
   calls; bodyless rows were "summarized" from the literal string
   "(no raw text captured)". This suite pins the cures. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const visitsSource = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing start marker ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing end marker ${end}`);
  return source.slice(a, b);
}
const modelSource = between(visitsSource, '/* ----------------------------------------------------------------------------\n * 1) VISIT-AWARE DATA MODEL', '/* ----------------------------------------------------------------------------\n * 2) PER-VISIT PROFILE UI');

async function main() {
  let aiReply = 'Diagnoses: lumbar radiculopathy (M54.16)\nPlan: continue conservative care and follow up in four weeks.';
  let aiCalls = 0;
  const patients = [{ id: 'pt-1', name: 'Example Patient', dob: '01/02/1970', problems: '', meds: '', allergies: '', summary: '', visits: [] }];
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement() { return {}; }, head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} } },
    setTimeout(fn) { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    getPatients() { return patients; },
    findPatient(id) { return patients.find(p => p.id === id) || null; },
    upsertPatient(p) { const i = patients.findIndex(x => x.id === p.id); if (i >= 0) patients[i] = p; else patients.push(p); },
    activePatient() { return patients[0]; },
    aiCallRaw() { aiCalls++; return Promise.resolve(aiReply); }
  };
  context.window = context;
  vm.runInNewContext(modelSource, context, { filename: 'visit-model.js' });
  const M = context.__mlsVisitModel;
  assert(M && typeof M._aggregateSummary === 'function', 'model did not install');

  /* ---- 1. _validVisitSummary refusals ---- */
  const V = M._validVisitSummary;
  const pt = patients[0];
  assert.strictEqual(V('', {}, pt).ok, false, 'empty reply accepted');
  assert.strictEqual(V('short', {}, pt).ok, false, 'too-short reply accepted');
  assert.strictEqual(V('<div>Visit note content here that is long enough</div>', {}, pt).reason, 'html-markup', 'HTML markup accepted');
  assert.strictEqual(V('{"summary": "a json shaped reply that is long enough"}', {}, pt).reason, 'json-scaffolding', 'JSON scaffolding accepted');
  assert.strictEqual(V('As requested, here is the RAW CAPTURED VISIT DATA echoed back to you', {}, pt).reason, 'prompt-echo', 'prompt echo accepted');
  assert.strictEqual(V('Patient seen in clinic. DOB: 03/04/1980. Lumbar pain improving with PT.', {}, pt).reason, 'dob-conflict', 'a conflicting DOB in the reply was accepted');
  assert.strictEqual(V('Patient seen in clinic. DOB: 01/02/1970. Lumbar pain improving with PT.', {}, pt).ok, true, 'the matching DOB was refused');
  {
    const chunk = 'Visit summary: lumbar radiculopathy stable, continue gabapentin and home exercise program without change. ';
    const dup = chunk + chunk + chunk;
    assert.strictEqual(V(dup, {}, pt).reason, 'duplicated-passage', 'a verbatim duplicated passage was accepted');
  }
  const mojibake = 'Patient reports the pain â€œcomes and goesâ€ and worsens at night, though function is preserved.';
  assert.strictEqual(V(mojibake, {}, pt).reason, 'encoding-garbage', 'mojibake accepted');
  assert.strictEqual(V(M._normalizeClinicalText(mojibake), {}, pt).ok, true, 'normalized text still refused');

  /* ---- 2. normalization repairs the classic sequences (incl. a bare
          trailing â€ whose third byte was lost) ---- */
  assert.strictEqual(M._normalizeClinicalText('Donâ€™t â€“ test Ã©tude'), "Don't – test étude", 'mojibake repair broke');
  assert.strictEqual(M._normalizeClinicalText('goesâ€ and'), 'goes" and', 'bare trailing sequence not repaired');

  /* ---- 3. bodyless rows are never AI-summarized ---- */
  const bodyless = M.addVisit('pt-1', { date: '2026-08-01', type: 'Office visit' }, { source: 'athena-copy', identityVerified: true, identityBinding: 'pt-1' });
  assert(bodyless, 'bodyless visit did not store');
  let refused = null;
  await M.summarizeVisit('pt-1', bodyless.id).catch(e => { refused = String(e && e.message); });
  assert(/no-note-text/.test(refused || ''), 'a bodyless visit reached the model: ' + refused);
  assert.strictEqual(aiCalls, 0, 'the model was called for a bodyless visit');

  /* ---- 4. an invalid model reply is never stored as a done summary ---- */
  const bodied = M.addVisit('pt-1', {
    date: '2026-08-02', type: 'Office visit', encounterId: 'e-bodied', fullDetail: true,
    raw: 'Patient: Example Patient\nDiagnoses: lumbar radiculopathy (M54.16)\nPlan: continue conservative care and PT.'
  }, { source: 'athena-copy', identityVerified: true, identityBinding: 'pt-1', bodyComplete: true });
  aiReply = '<div>markup junk that is long enough to pass length</div>';
  let err2 = null;
  await M.summarizeVisit('pt-1', bodied.id).catch(e => { err2 = e; });
  assert(err2 && /summary-invalid/.test(String(err2.message)), 'invalid reply did not refuse');
  {
    const row = context.findPatient('pt-1').visits.find(v => v.id === bodied.id);
    assert(!row.aiSummary, 'the malformed reply was stored as aiSummary');
    assert(row.aiSummaryFailed && row.aiSummaryFailed.reason === 'html-markup', 'the refusal was not receipted');
  }

  /* ---- 5. a recently-failed row is not hot-retried; a good reply heals ---- */
  aiCalls = 0;
  await M.ensureSummaries('pt-1');
  assert.strictEqual(aiCalls, 0, 'ensureSummaries hot-retried a recently-failed row (or summarized a bodyless one)');
  aiReply = 'Visit 2026-08-02: lumbar radiculopathy (M54.16) stable; continue conservative care and physical therapy.';
  await M.summarizeVisit('pt-1', bodied.id, { force: true });
  {
    const row = context.findPatient('pt-1').visits.find(v => v.id === bodied.id);
    assert(/lumbar radiculopathy/.test(row.aiSummary || ''), 'a valid reply did not store');
    assert(!row.aiSummaryFailed, 'the failure receipt was not cleared on success');
  }

  /* ---- 6. the aggregate summary: sections, no duplicated lead, honest empty ---- */
  const facts = {
    problems: ['Lumbar radiculopathy (M54.16)', 'ICD-10 M54.16'],
    meds: ['gabapentin 300 mg nightly'],
    allergies: ['PENICILLIN - hives', 'NKDA (documented 2020)'],
    history: { pmh: ['hypertension'], psh: ['L4-L5 discectomy 2019'], social: ['never smoker'], family: [], smoking: [], immunizations: [], lmp: [], codeStatus: [], pcp: [], pharmacy: [] },
    vitals: { bp: '128/76', hr: '', temp: '', rr: '', spo2: '', heightIn: '', weightLb: '', bmi: '27.1', takenAt: '2026-08-02' }
  };
  const visits = M.getVisits(context.findPatient('pt-1')).filter(v => v.id === bodied.id);
  const agg = M._aggregateSummary(context.findPatient('pt-1'), visits, facts);
  assert(/^Pulled from Athena /.test(agg), 'header prefix changed');
  assert(/Active or significant problems:/.test(agg), 'problems section missing');
  assert(/Allergies and reactions:/.test(agg), 'allergies section missing');
  assert(/PENICILLIN - hives/.test(agg), 'allergy reaction text missing');
  assert(/NKDA \(documented 2020\)/.test(agg), 'a documented negative was dropped');
  assert(/Medications:/.test(agg) && /gabapentin/.test(agg), 'medications section missing');
  assert(/Surgical and procedural history:/.test(agg) && /discectomy/.test(agg), 'surgical history missing');
  assert(/Recent visits:/i.test(agg), 'Recent visits section missing');
  {
    const marker = 'continue conservative care and physical therapy';
    const n = agg.split(marker).length - 1;
    assert.strictEqual(n, 1, `visits[0] body appears ${n} times - the duplicated-lead class`);
  }

  /* ---- 7. truly-nothing yields EMPTY, not a bare header ---- */
  const emptyFacts = { problems: [], meds: [], allergies: [], history: { pmh: [], psh: [], social: [], family: [], smoking: [], immunizations: [], lmp: [], codeStatus: [], pcp: [], pharmacy: [] }, vitals: {} };
  const emptyAgg = M._aggregateSummary({ id: 'pt-x', name: 'X' }, [], emptyFacts);
  assert.strictEqual(emptyAgg, '', 'an empty chart still produced a header-only summary');

  /* ---- 8. verified-absent cards are stated ---- */
  const pVerified = {
    id: 'pt-v', name: 'V', athenaProfileCoverage: {
      complete: true, exactIdentityVerified: true, patientId: 'pt-v',
      cards: { allergies: { status: 'not_documented' }, meds: { status: 'not_documented' } }
    }
  };
  const aggV = M._aggregateSummary(pVerified, [], emptyFacts);
  assert(/Verified on the Athena chart with none documented: medications, allergies\./.test(aggV), 'verified-absent line missing: ' + JSON.stringify(aggV));

  /* ---- 9. provider tail cleaned from the type, display-only ---- */
  assert.strictEqual(M._cleanVisitTypeForDisplay('fluoro non sedation, Matthew Schaeffer, '), 'fluoro non sedation', 'provider tail survived');
  assert.strictEqual(M._cleanVisitTypeForDisplay('follow up, lumbar'), 'follow up, lumbar', 'legitimate lowercase type text was eaten');

  console.log('visit-summary-quality-contract: PASS (30 checks)');
}

main().catch(e => { console.error(e); process.exit(1); });

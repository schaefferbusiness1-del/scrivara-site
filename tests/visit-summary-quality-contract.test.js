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
  /* px-2.6: clinical prose with angle brackets or quoted keys is NOT markup/JSON */
  assert.strictEqual(V('Allergies <no known drug allergies>. Plan: TFESI at L4-L5 under fluoroscopy next month.', {}, pt).ok, true, 'angle-bracket clinical prose refused as html');
  assert.strictEqual(V('The chart records "pain": 7 at this visit and the plan is unchanged going forward.', {}, pt).ok, true, 'quoted-key prose refused as json');
  assert.strictEqual(V('{\n"summary": "a serialized reply that is long enough to pass"\n}', {}, pt).reason, 'json-scaffolding', 'line-start JSON accepted');
  /* px-2.6: a suspect-marked record must not refuse the chart-correct DOB */
  const suspectPt = { id: 'pt-s', name: 'S', dob: '01/01/1900', athenaImportSuspect: { reason: 'shared-dob-cluster' } };
  assert.strictEqual(V('Patient seen in clinic. DOB: 03/04/1980. Lumbar pain improving with home PT program.', {}, suspectPt).ok, true, 'suspect-marked record refused a correct chart DOB');
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
  /* px-2.3: laterality/site tails are CLINICAL, never stripped (wrong-site class) */
  for (const keep of ['Injection, Right Knee', 'Epidural Steroid Injection, Right Side', 'Radiofrequency Ablation, Left Cervical', 'Trigger Point Injection, Left Trapezius', 'Nerve Block, Genicular Right', 'Medial Branch Block, Bilateral Lumbar', 'MRI Lumbar Spine, With Contrast', 'Consult, New Patient', 'Follow Up, Post Op']) {
    assert.strictEqual(M._cleanVisitTypeForDisplay(keep), keep, 'laterality/site tail stripped from: ' + keep);
  }

  /* ---- 10. the persisted aggregate keeps the RAW type and labels bodyless
          lines honestly (px-2.3/2.4) ---- */
  {
    const pB = { id: 'pt-b', name: 'B', visits: [] };
    context.upsertPatient(pB);
    const shell = M.addVisit('pt-b', { date: '2026-08-05', type: 'Injection, Right Knee' }, { source: 'athena-copy', identityVerified: true, identityBinding: 'pt-b' });
    assert(shell, 'bodyless typed visit did not store');
    const aggB = M._aggregateSummary(context.findPatient('pt-b'), M.getVisits(context.findPatient('pt-b')), emptyFacts);
    assert(/Injection, Right Knee \(scheduled visit — no note text captured\)/.test(aggB), 'bodyless line lost its laterality or its honesty marker: ' + JSON.stringify(aggB));
  }

  /* ---- 11. organizePatientHistory PRESERVES a good summary when nothing was
          re-read (px-2.3; the read-gate-feeds-a-write class) ---- */
  {
    const good = 'Pulled from Athena 8/5/2026 —\n\nActive or significant problems:\n• Lumbar radiculopathy (M54.16)';
    const pC = { id: 'pt-c', name: 'C', dob: '01/01/1970', problems: 'Lumbar radiculopathy', meds: '', allergies: '', summary: good, athenaHistorySummary: good, visits: [] };
    context.upsertPatient(pC);
    const rec = await M.summarizeAll('pt-c');
    assert.strictEqual(rec.ok, true, 'organize refused a 0-visit patient');
    const after = context.findPatient('pt-c');
    assert.strictEqual(after.athenaHistorySummary, good, 'a good summary was blanked with no re-read (found-nothing erased it)');
    assert.strictEqual(after.summary, good, 'the mirrored summary was blanked with no re-read');
  }

  /* ---- 11b. px-2.7: the legacy em-dash-wrapped stamp is IMPORTER-OWNED -
          the mirror must replace it (measured live on b949: the panel kept
          rendering "— Pulled from Athena 7/27/2026 —" forever because the
          anchored ownership regex refused the app's own old stamp) ---- */
  {
    const pD = { id: 'pt-d', name: 'D', dob: '01/01/1970', problems: '', meds: '', allergies: '',
      summary: '— Pulled from Athena 7/27/2026 —', athenaHistorySummary: '', visits: [] };
    context.upsertPatient(pD);
    M.addVisit('pt-d', {
      date: '2026-08-05', type: 'Office visit', encounterId: 'e-d1', fullDetail: true,
      raw: 'Patient: D\nDiagnoses: cervical radiculopathy (M54.12)\nPlan: continue conservative care.'
    }, { source: 'athena-copy', identityVerified: true, identityBinding: 'pt-d', bodyComplete: true });
    await M.summarizeAll('pt-d');
    const afterD = context.findPatient('pt-d');
    assert(/^Pulled from Athena /.test(String(afterD.summary)), 'the em-dash legacy stamp was not replaced by the importer mirror');
    assert(/cervical radiculopathy/i.test(String(afterD.summary)), 'the mirrored summary lost the clinical content');
  }

  /* ---- 12. px-2.5.2 hygiene persistence contract (source-level; the
          functional proof was measured live on b949's first load: the 4.5s
          pass "cleaned 434" and the async server-mirror hydration restored
          every one of them under an already-consumed run-once flag) ---- */
  {
    const src = visitsSource;
    const flagSets = (src.match(/localStorage\.setItem\(flagKey, '1'\)/g) || []).length;
    assert.strictEqual(flagSets, 2, 'the hygiene flag must be set in exactly two places: the cleaned-nothing branch and the post-hydration verify callback (found ' + flagSets + ')');
    assert(/if \(!touched\) \{\s*\n?\s*try \{ localStorage\.setItem\(flagKey, '1'\)/.test(src), 'the cleaned-nothing branch no longer flags immediately');
    assert(/_storeHygieneOnce\._verifyRounds/.test(src) && /stillDirty/.test(src), 'the post-write verify pass is gone - the flag can be consumed while the server mirror restores dirty rows');
    assert(/_verifyRounds > 3/.test(src), 'the verify re-clean loop lost its bound');
    assert(/p\.updated = Date\.now\(\)/.test(src.slice(src.indexOf('function _storeHygieneOnce'))), 'cleaned records no longer bump `updated` - a timestamp merge will prefer the dirty server copy');
  }

  /* ---- 13. px-5.0: the athena PRINT-VIEW section shape (no colon; doubled
          heading + review-status; explicit "None recorded") must be seen and
          its allergen run expanded. The fixture line is the EXACT substring
          captured from a real chart on 2026-08-08, on which the live store
          held ONLY "NKDA" while athena documented two environmental
          allergens - coverage said detected:0, so every receipt passed. ---- */
  {
    const printLine = "Patient's Pharmacies CVS/PHARMACY (ERX): Ph (610) 444-9081, Fax (610) 444-5700 Vitals None recorded. Allergies Allergies not reviewed (last reviewed 06/16/2026) BEE POLLEN, low criticality MITE EXTRACT, low criticality Medications Medications not reviewed (last reviewed 06/16/2026) Name Date Source";
    const pE = { id: 'pt-e', name: 'E', dob: '01/01/1970', problems: '', meds: '', allergies: 'NKDA', summary: '', visits: [] };
    context.upsertPatient(pE);
    M.addVisit('pt-e', {
      date: '2026-07-08', type: 'Office visit', encounterId: 'e-e1', fullDetail: true,
      raw: 'Patient: E\n' + printLine + '\nPlan: continue conservative management of symptoms.'
    }, { source: 'athena-copy', identityVerified: true, identityBinding: 'pt-e', bodyComplete: true });
    const recE = await M.summarizeAll('pt-e');
    assert.strictEqual(recE.ok, true, 'print-shape visit did not organize');
    const afterE = context.findPatient('pt-e');
    const alg = String(afterE.allergies || '');
    assert(/BEE POLLEN \(low criticality\)/.test(alg), 'environmental allergen 1 not captured: ' + JSON.stringify(alg));
    assert(/MITE EXTRACT \(low criticality\)/.test(alg), 'environmental allergen 2 not captured: ' + JSON.stringify(alg));
    assert(/NKDA/.test(alg), 'the documented NKDA was removed instead of preserved');
    assert(!/not reviewed|last reviewed/i.test(alg), 'review-status furniture leaked into allergies');
    assert(!/Medications|Name Date Source/i.test(alg), 'the neighbouring section leaked into allergies');
    assert(!/BEE POLLEN|MITE EXTRACT/i.test(String(afterE.problems || '')), 'allergens leaked into problems');
  }

  /* _expandAllergyRun unit rows (spread into host arrays - vm-realm
     prototypes fail deepStrictEqual's identity check) */
  assert.deepStrictEqual([...M._expandAllergyRun('NKDA')], ['NKDA'], 'NKDA passthrough broke');
  assert.deepStrictEqual([...M._expandAllergyRun('PENICILLIN - rash')], ['PENICILLIN - rash'], 'reaction-form passthrough broke');
  assert.deepStrictEqual([...M._expandAllergyRun('Allergies not reviewed (last reviewed 06/16/2026)')], [], 'a status-only line minted a fake allergen');

  /* ---- 14. px-5.1: the b121 allergy cleaner must not delete documented
          allergens. Proven live 2026-08-08 by direct assignment + upsert:
          with NKDA co-present, any allergen outside a hardcoded 13-drug list
          was erased on every upsert (the reason the chart showed three rows
          and MLS showed one even after extraction was fixed). ---- */
  {
    const packSource = fs.readFileSync(path.join(root, 'feat_mls_b121_pack.js'), 'utf8');
    const segA = packSource.indexOf('  function low(x)');
    const segB = packSource.indexOf('  /* ---------- per-patient application');
    assert(segA >= 0 && segB > segA, 'cleaner extraction anchors missing');
    const cleanAllergies = new Function('S', 'trim', packSource.slice(segA, segB) + '; return cleanAllergies;')(
      x => x == null ? '' : String(x), x => String(x == null ? '' : x).trim());
    const eaten = cleanAllergies('NKDA\nBEE POLLEN (low criticality)\nMITE EXTRACT (low criticality)');
    assert.deepStrictEqual([...eaten], ['NKDA', 'BEE POLLEN (low criticality)', 'MITE EXTRACT (low criticality)'],
      'NKDA + off-list allergens collapsed to NKDA (the 13-drug allowlist eraser)');
    assert.deepStrictEqual([...cleanAllergies('NKDA')], ['NKDA'], 'pure NKDA no longer collapses');
    assert.deepStrictEqual([...cleanAllergies('NKDA\nAllergies\nSeverity')], ['NKDA'], 'NKDA + furniture no longer collapses');
    assert.deepStrictEqual([...cleanAllergies('No known drug allergies\nPENICILLIN - rash')], ['NKDA', 'PENICILLIN - rash'], 'drug + negation pair broke');
    assert.deepStrictEqual([...cleanAllergies('IODINE: Hives\nSUNITINIB: - Contrast dye')], ['IODINE: Hives', 'SUNITINIB: - Contrast dye'], 'real-only list broke');
  }

  /* ---- 15. px-5.2: the REVIEWED print variant ("<H> Reviewed <H> ...")
          must be seen, and its flattened runs expanded. Fixture lines are the
          EXACT captured substrings from a second real chart on which the
          measured counts were: problems 5 present -> 2 captured, meds 5+
          present -> 0, surgical 4 present -> 0. ---- */
  {
    const reviewedBlock = [
      'Problems Reviewed Problems Lumbar spondylosis - Onset: 06/23/2026 Thoracic spine pain - Onset: 05/13/2026 Spasm of back muscles - Onset: 02/19/2025 Lumbar spine pain - Onset: 05/05/2026 Sprain of iliolumbar ligament, initial encounter - Onset: 06/23/2026',
      'Medications Reviewed Medications Name Date Source amLODIPine 5 mg tablet 04/11/26 filled surescripts butalbital-acetaminophen-caffeine 50 mg-325 mg-40 mg tablet 04/27/26 filled surescripts fluocinonide 0.05 % topical solution 04/27/26 filled surescripts',
      'Surgical & Procedure History Reviewed Surgical & Procedure History Operation on shoulder joint - bilateral Prosthetic total replacement of bilateral knee joints Hysterectomy Cholecystectomy'
    ].join(' ');
    const pF2 = { id: 'pt-f', name: 'F', dob: '01/01/1970', problems: '', meds: '', allergies: '', summary: '', visits: [] };
    context.upsertPatient(pF2);
    M.addVisit('pt-f', {
      date: '2026-07-10', type: 'Office visit', encounterId: 'e-f1', fullDetail: true,
      raw: 'Patient: F\n' + reviewedBlock + '\nPlan: continue current regimen.'
    }, { source: 'athena-copy', identityVerified: true, identityBinding: 'pt-f', bodyComplete: true });
    const recF = await M.summarizeAll('pt-f');
    assert.strictEqual(recF.ok, true, 'reviewed-variant visit did not organize');
    const afterF = context.findPatient('pt-f');
    const probs = String(afterF.problems || '');
    const meds = String(afterF.meds || '');
    const psh = String((afterF.history && afterF.history.psh) || '');
    for (const want of ['Lumbar spondylosis (onset 06/23/2026)', 'Thoracic spine pain (onset 05/13/2026)', 'Spasm of back muscles (onset 02/19/2025)', 'Lumbar spine pain (onset 05/05/2026)']) {
      assert(probs.indexOf(want) >= 0, 'problem entry missing: ' + want + ' in ' + JSON.stringify(probs.slice(0, 200)));
    }
    assert(/amLODIPine 5 mg tablet \(filled 04\/11\/26\)/.test(meds), 'med row 1 missing: ' + JSON.stringify(meds.slice(0, 160)));
    assert(/butalbital-acetaminophen-caffeine[^(]*\(filled 04\/27\/26\)/.test(meds), 'med row 2 missing');
    assert(!/Name Date Source/i.test(meds), 'the med table header leaked into medications');
    assert(/Cholecystectomy/.test(psh) && /Hysterectomy/.test(psh), 'surgical history run not captured: ' + JSON.stringify(psh.slice(0, 160)));
    assert(!/Reviewed/i.test(probs) && !/Reviewed/i.test(meds), 'the Reviewed marker leaked into clinical fields');
  }

  /* ---- px-6.0: an EMPTY Reviewed print section is that section's own honest
     empty, never a coverage miss. Live Elizabeth chart 2026-08-08: family
     history was "detected 7 / parsed 2" because five visits print the bare
     heading pair ("Family History Reviewed Family History") straight into the
     next section; the tracker booked each as MISSED and organize refused the
     whole chart as semantic-coverage-incomplete while the one real family
     fact WAS extracted. Exact captured shapes below. */
  {
    const emptyReviewed = 'Problems Reviewed Problems Atrial fibrillation Family History Reviewed Family History Social History Reviewed Social History Social History Illicit Drug Use?: No Employment Status: retired';
    const trackerA = { sections: {} };
    M._sectionValues(emptyReviewed, ['family history', 'family'], trackerA, 'history.family');
    const rowA = trackerA.sections['history.family'];
    assert(rowA && rowA.detected >= 1, 'empty reviewed family block was not detected at all');
    assert.strictEqual(rowA.missed, 0, 'an empty Reviewed section was booked as a coverage MISS (the pre-px-6.0 defect)');
    assert(rowA.explicitEmpty >= 1, 'an empty Reviewed section did not register as explicit-empty');
    const withContent = 'Family History Reviewed Family History Father - Family history of stroke Social History Reviewed Social History Employment Status: retired';
    const trackerB = { sections: {} };
    const famVals = M._sectionValues(withContent, ['family history', 'family'], trackerB, 'history.family');
    assert(famVals.some(v => /Father - Family history of stroke/.test(v)), 'family content was not extracted from the Reviewed form');
    assert.strictEqual(trackerB.sections['history.family'].missed, 0, 'a parsed family block was booked as missed');
    const colonEmpty = 'Family History:\nSocial History: retired';
    const trackerC = { sections: {} };
    M._sectionValues(colonEmpty, ['family history', 'family'], trackerC, 'history.family');
    const rowC = trackerC.sections['history.family'];
    assert(rowC && rowC.missed >= 1, 'a colon-form empty heading stopped missing - ambiguity must never be flipped to ok');
    /* end to end: a chart whose only family evidence is the empty Reviewed
       block must organize ok:true (pre-fix: semantic-coverage-incomplete). */
    const pE = { id: 'pt-e6', name: 'E', dob: '01/01/1970', problems: '', meds: '', allergies: '', summary: '', visits: [] };
    context.upsertPatient(pE);
    M.addVisit('pt-e6', {
      date: '2026-07-01', type: 'Office visit', encounterId: 'e-e6', fullDetail: true,
      raw: 'Patient: E\nAllergies Reviewed Allergies NKDA Problems Reviewed Problems Atrial fibrillation Family History Reviewed Family History Social History Reviewed Social History Employment Status: retired\nPlan: anticoagulation continues.'
    }, { source: 'athena-copy', identityVerified: true, identityBinding: 'pt-e6', bodyComplete: true });
    const recE = await M.summarizeAll('pt-e6');
    assert.strictEqual(recE.ok, true, 'a chart with an empty Reviewed section still refuses to organize: ' + JSON.stringify(recE.reason || ''));
  }

  console.log('visit-summary-quality-contract: PASS (84 checks)');
}

main().catch(e => { console.error(e); process.exit(1); });

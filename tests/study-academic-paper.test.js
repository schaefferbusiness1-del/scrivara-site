'use strict';

/* sr-2.0.0 academic-paper upgrade contract:
 *  - demographics/meds/allergies/problems flow from every store into the model
 *  - deterministic statistics (SD, 95% CI, Welch t) are correct
 *  - the practice code table becomes a coding-signal results table
 *  - tables + figures exist and render through the PDF path
 *  - AI narrative is optional, fail-soft, and number-verified (no fabrication)
 *  - small evidence still yields a small, never-padded report
 */

const assert = require('assert');
const path = require('path');
const asset = path.join(__dirname, '..', 'feat_mls_study_request.js');
const study = require(asset);

/* ---------- statistics ---------- */
const s = study.stats;
assert.strictEqual(s.mean([2, 4, 6]), 4);
assert.strictEqual(s.median([1, 3, 9, 100]), 6);
assert.ok(Math.abs(s.sampleSd([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.01);
const ci = s.ci95([4, 5, 6, 5, 4, 6]);
assert.ok(ci && Math.abs(ci.mean - 5) < 1e-9 && ci.low < 5 && ci.high > 5);
const t = s.welchTTest([-4, -3, -5, -4], [0, -1, 1, 0]);
assert.ok(t && t.t < -5 && t.p != null && t.p < 0.01, 'clearly separated arms must give a small approximate p');
assert.strictEqual(s.welchTTest([1], [2, 3]), null, 'n<2 arms must refuse a test');

/* ---------- multi-store evidence with demographics ---------- */
function mkPatient(i, sex, extras) {
  const visits = [];
  for (let v = 0; v < 4; v++) {
    visits.push({
      date: '2026-0' + ((v % 6) + 1) + '-1' + (i % 9), type: v % 2 ? 'Lumbar epidural injection' : 'Follow-up',
      source: 'patient-record',
      detail: 'Visit ' + v + ' pain ' + (8 - v) + '/10 lumbar epidural injection performed, tolerated well.'
    });
  }
  return Object.assign({
    id: 'pt-' + i, name: 'Patient Number' + i, dob: '19' + (50 + i) + '-03-0' + ((i % 9) + 1),
    mrn: 'MRN-' + (1000 + i), sex: sex, meds: ['Gabapentin 300mg', 'Ibuprofen'], allergies: ['Penicillin'],
    problems: 'Chronic lumbar radiculopathy', visits: visits
  }, extras || {});
}
const env = {
  getPatients() { return [mkPatient(1, 'F'), mkPatient(2, 'male'), mkPatient(3, '')]; },
  getNotes() { return []; },
  _calAppts: [],
  sgFix: { buildAll() { return []; } },
  __mlsCodeTable: {
    load() {
      return { v: 1, entries: [
        { code: '62323', desc: 'Lumbar epidural injection', kind: 'CPT' },
        { code: 'M54.16', desc: 'Radiculopathy lumbar', kind: 'ICD' },
        { code: '99999', desc: 'Unrelated telehealth barium swallow', kind: 'CPT' }
      ] };
    }
  }
};

const records = study.collectStoredRecords(env);
assert.strictEqual(records.patients.length, 3);
assert.strictEqual(records.patients[0].sex, 'female', 'sex must normalize from single-letter fields');
assert.deepStrictEqual(records.patients[0].meds, ['Gabapentin 300mg', 'Ibuprofen']);
assert.deepStrictEqual(records.patients[0].allergies, ['Penicillin']);
assert.match(records.patients[0].problems, /lumbar radiculopathy/i);

const spec = study.parseStudySpec('Study outcomes for patients who received lumbar epidural injections, all time, 60 pages');
assert.strictEqual(spec.ok, true);
assert.strictEqual(spec.targetPages, 60, 'the cap is now 60 evidence-supported pages');
const scoped = study.applyScope(records, spec, new Date('2026-07-16T12:00:00Z'));
assert.strictEqual(scoped.patientCount, 3);

const deid = study.deidentifyPatients(scoped.patients, new Date('2026-07-16T12:00:00Z'));
const deidText = JSON.stringify(deid);
assert.ok(!/Patient Number/i.test(deidText));
assert.ok(!/MRN-100/i.test(deidText));
assert.ok(typeof deid[0].ageYears === 'number' && deid[0].ageYears > 60 && deid[0].ageYears < 90,
  'age in years must survive deidentification (limited data)');
assert.strictEqual(deid[0].sex, 'female');
assert.ok(deid[0].meds.length === 2 && deid[0].allergies.length === 1);

const codeSignals = study.collectCodeSignals(deid.flatMap((p) => p.visits), env);
assert.ok(codeSignals && codeSignals.length >= 1, 'code table must produce coding signals');
assert.strictEqual(codeSignals[0].code, '62323');
assert.ok(!codeSignals.some((r) => r.code === '99999'), 'unmatched codes must not appear');

const model = study.buildReportModel(spec, deid, {
  scope: scoped.scope, resolvedCohort: 'Records matching lumbar epidural injections',
  duplicateVisitsRemoved: 0, codeSignals,
  identities: scoped.patients.map((p) => ({ name: p.name, dob: p.dob, mrn: p.mrn }))
});
const headings = model.sections.map((x) => x.heading);
['Abstract', 'Introduction and objective', 'Methods and provenance', 'Statistical methods',
 'Results: cohort characteristics', 'Results: documented coding signals (practice code table)',
 'Results: documented procedures',
 'Appendix A. Case-level patient index', 'Discussion', 'Data quality and limitations', 'Conclusion',
 'Reproducibility record'].forEach((h) => {
  assert.ok(headings.indexOf(h) >= 0, 'missing academic section: ' + h);
});
/* sr-2.3.0: patient-level content must sit at the END — after every analytic
   section, Discussion, Conclusion, and the reproducibility record. */
assert.ok(headings.indexOf('Appendix A. Case-level patient index') > headings.indexOf('Reproducibility record'),
  'case-level patient index must come after the reproducibility record');
assert.ok(headings.indexOf('Results: documented procedures') < headings.indexOf('Discussion'),
  'procedure analysis must be part of the analytic body');
const casesSection = model.sections.find((x) => x.key === 'cases');
assert.ok(casesSection && casesSection.paragraphs.length >= deid.length,
  'case index must cover ALL included patients (no mid-report cap)');
assert.ok(model.figures.length >= 2, 'monthly + type figures expected');
assert.ok(model.sections.some((x) => x.table && x.table.rows.length), 'tables expected');
assert.ok(!/Patient Number|MRN-100/i.test(JSON.stringify(model)), 'model must stay identifier-free');
assert.ok(model.supportedPageCeiling < 30, '12 visits must still yield a small, never-padded ceiling');

/* ---------- AI narrative guard ---------- */
const digestStr = JSON.stringify({ n: '3 patients and 12 visits, mean 6.5' });
assert.strictEqual(study.narrativeNumbersOk('The cohort of 3 patients had mean 6.5.', digestStr), true);
assert.strictEqual(study.narrativeNumbersOk('Improvement was 87.3 percent.', digestStr), false,
  'a number absent from the digest must be rejected');

(async () => {
  /* fail-soft: no AI transport anywhere -> deterministic narrative */
  const none = await study.aiNarrative(model, { ai: null, useAi: true });
  assert.strictEqual(none, null);

  /* good narrative: only digest numbers -> accepted and applied */
  const good = await study.aiNarrative(model, {
    ai: (sys, user) => Promise.resolve(JSON.stringify({
      abstract: 'Background: retrospective practice review. Methods: as computed. Results: ' + model.patientCount + ' patients and ' + model.visitCount + ' visit records were reviewed with descriptive statistics. Conclusions: descriptive only.',
      discussion: 'This retrospective review of ' + model.patientCount + ' patients is descriptive and hypothesis-generating only.\n\nAppropriate use is internal quality review.'
    }))
  });
  assert.ok(good && good.abstract && good.discussion);
  const applied = study.applyNarrative(JSON.parse(JSON.stringify(model)), good);
  assert.strictEqual(applied.aiNarrative, true);
  const abs = applied.sections.find((x) => x.key === 'abstract');
  assert.match(abs.paragraphs.join(' '), /Narrative drafted by AI strictly from the deterministic statistics/);

  /* fabricated numbers -> every field rejected -> deterministic fallback */
  const bad = await study.aiNarrative(model, {
    ai: () => Promise.resolve(JSON.stringify({
      abstract: 'Results: 94.7 percent of the 8834 patients improved dramatically after treatment, which is remarkable.',
      discussion: 'A previous study of 5000 patients (Smith et al. 2019) found similar large results in this population.'
    }))
  });
  assert.strictEqual(bad, null, 'fabricated statistics must never reach the paper');

  /* AI erroring must not break the study */
  const err = await study.aiNarrative(model, { ai: () => Promise.reject(new Error('backend down')) });
  assert.strictEqual(err, null);

  /* ---------- full pipeline with figures/tables through the PDF path ---------- */
  class FakeJsPDF {
    constructor() {
      this.pages = 1;
      this.internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
    }
    setTextColor() {} setFontSize() {} setFont() {} text() {} setDrawColor() {} setFillColor() {}
    rect() {} line() {}
    splitTextToSize(value) {
      const text = String(value); const lines = [];
      for (let i = 0; i < text.length; i += 85) lines.push(text.slice(i, i + 85));
      return lines.length ? lines : [''];
    }
    addPage() { this.pages += 1; }
    getNumberOfPages() { return this.pages; }
    setPage() {}
    output() { return new Blob(['fake-pdf'], { type: 'application/pdf' }); }
  }
  const sg = {
    __live: true,
    analyze(group) {
      const allVisits = group.patients.flatMap((p) => p.visits.map((v) => ({ pt: p, v })));
      return { patientCount: group.patients.length, visitCount: allVisits.length, patients: group.patients, allVisits, months: [], byMonth: {}, byType: {}, pain: [], avgVisits: allVisits.length / group.patients.length };
    },
    chartSVG() { return '<svg></svg>'; },
    get() { return null; }
  };
  const doc = { getElementById() { return null; }, createElement() { return { value: '', textContent: '' }; } };
  const result = await study.executeSpec(spec, {
    sg, records, document: doc, env,
    now: new Date('2026-07-16T12:00:00Z'),
    jsPDF: FakeJsPDF,
    ai: (sys, user) => {
      assert.ok(!/Patient Number|MRN-10/i.test(String(user)), 'the AI digest must be identifier-free');
      return Promise.resolve(JSON.stringify({ conclusion: 'This descriptive review of stored documentation supports internal quality improvement only.' }));
    }
  });
  assert.ok(result.pdfBlob instanceof Blob);
  assert.strictEqual(result.aiNarrative, true);
  assert.ok(result.model.sections.some((x) => x.key === 'codes'), 'code-table results must reach the paper');
  assert.ok(result.pdfPages >= 2 && result.pdfPages <= result.supportedPageCeiling);
  const csv = await result.xlsxBlob.text();
  assert.match(csv, /Age \(years\)/);
  assert.match(csv, /Gabapentin/);
  assert.ok(!/Patient Number|MRN-10/i.test(csv));
  console.log('study-academic-paper: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/* ---------- sr-2.1.0 injection-cohort accuracy ---------- */
(function () {
  // abbreviation + brand-steroid synonym matching, both directions
  const q = { type: 'x', detail: 'LESI performed at L4-L5 without complication' };
  assert.strictEqual(study.recordMentions(q, 'lumbar epidural steroid injection'), true,
    'chart "LESI" must match a lumbar epidural steroid injection request');
  assert.strictEqual(study.recordMentions(
    { type: 'x', detail: 'Kenalog injected into the right knee joint' }, 'steroid injection knee'), true,
    'brand corticosteroid must normalize to steroid');
  assert.strictEqual(study.recordMentions(
    { type: 'x', detail: 'cervical epidural steroid injection C6-C7' }, 'CESI'), true);
  assert.strictEqual(study.recordMentions(
    { type: 'x', detail: 'trigger point injections bilateral trapezius' }, 'TPI'), true);
  assert.strictEqual(study.recordMentions(
    { type: 'x', detail: 'lumbar epidural steroid injection' }, 'knee injection'), false,
    'different procedure must NOT match');

  // cohort selection: only patients whose history documents the injection
  const envInj = {
    getPatients() {
      return [
        { id: 'a', name: 'Match Abbrev', dob: '1960-01-02', visits: [
          { date: '2026-02-10', type: 'Procedure', detail: 'pain 8/10 before procedure. LESI at L4-L5 today.' },
          { date: '2026-04-11', type: 'Follow-up', detail: 'doing better, pain 3/10 since the epidural.' }
        ] },
        { id: 'b', name: 'Match Brand', dob: '1955-03-04', visits: [
          { date: '2026-01-05', type: 'Visit', detail: 'pain 7/10; lumbar epidural with Kenalog performed.' },
          { date: '2026-03-06', type: 'Visit', detail: 'improved, pain 4/10.' }
        ] },
        { id: 'c', name: 'No Match', dob: '1970-05-06', visits: [
          { date: '2026-02-01', type: 'Visit', detail: 'knee osteoarthritis, pain 6/10, PT referral only.' }
        ] }
      ];
    },
    getNotes() { return []; }, _calAppts: [], sgFix: { buildAll() { return []; } }
  };
  const recs = study.collectStoredRecords(envInj);
  const injSpec = study.parseStudySpec('Study outcomes for patients who received lumbar epidural steroid injections, all time');
  assert.strictEqual(injSpec.cohort.mode, 'keyword');
  const injScoped = study.applyScope(recs, injSpec, new Date('2026-07-16T12:00:00Z'));
  assert.strictEqual(injScoped.patientCount, 2, 'exactly the two injection patients must be included');
  const included = injScoped.patients.map((p) => p.name).sort();
  assert.deepStrictEqual(included, ['Match Abbrev', 'Match Brand']);

  const injDeid = study.deidentifyPatients(injScoped.patients, new Date('2026-07-16T12:00:00Z'));
  const injModel = study.buildReportModel(injSpec, injDeid, {
    scope: injScoped.scope, resolvedCohort: 'Records matching lumbar epidural steroid injections',
    identities: injScoped.patients.map((p) => ({ name: p.name, dob: p.dob, mrn: p.mrn }))
  });
  const construction = injModel.sections.find((s) => s.key === 'cohort-construction');
  assert.ok(construction, 'cohort-construction section required for keyword cohorts');
  assert.strictEqual(construction.table.rows.length, 2, 'one membership-evidence row per included patient');
  assert.ok(construction.table.rows.every((r) => Number(r[1]) >= 1), 'every included patient must show at least one matching visit');

  // procedure-anchored outcomes: baseline at/before index visit vs after
  assert.ok(injModel.matchEvidence && injModel.matchEvidence.anchored.length === 2,
    'both patients have pre and post index-visit pain scores');
  const outcomes = injModel.sections.find((s) => s.key === 'outcomes');
  assert.match(outcomes.paragraphs.join(' '), /Procedure-anchored analysis/);
  const changes = injModel.matchEvidence.anchored.map((a) => a.change).sort((x, y) => x - y);
  assert.deepStrictEqual(changes, [-5, -3], 'anchored changes must be 8->3 and 7->4');
  console.log('study-injection-cohort: ok');
})();

/* same-visit rule: knee dx in one visit + epidural in another must NOT make a "knee injection" cohort */
(function () {
  const envX = {
    getPatients() {
      return [{ id: 'x', name: 'Cross Visit', dob: '1962-04-05', visits: [
        { date: '2026-01-10', type: 'Office visit', detail: 'Knee osteoarthritis discussed, conservative care.' },
        { date: '2026-02-10', type: 'Procedure', detail: 'Lumbar epidural steroid injection performed.' }
      ] }];
    }, getNotes() { return []; }, _calAppts: [], sgFix: { buildAll() { return []; } }
  };
  const recsX = study.collectStoredRecords(envX);
  const specKnee = study.parseStudySpec('Study outcomes for patients who received knee injections, all time');
  const scopedKnee = study.applyScope(recsX, specKnee, new Date('2026-07-16T12:00:00Z'));
  assert.strictEqual(scopedKnee.patientCount, 0, 'cross-visit token mixing must not create cohort membership');
  const specLesi = study.parseStudySpec('Study outcomes for patients who received lumbar epidural steroid injections, all time');
  assert.strictEqual(study.applyScope(recsX, specLesi, new Date('2026-07-16T12:00:00Z')).patientCount, 1,
    'the genuinely documented procedure must still match');
  console.log('study-samevisit-cohort: ok');
})();

/* proximity rule: term tokens must sit in one phrase, not merely one note */
(function () {
  const farApart = { type: 'Procedure', detail: 'Lumbar epidural steroid injection at L4-L5 under fluoroscopic guidance, no complications, tolerated well. Post-procedure instructions reviewed with the patient in detail including activity modification and warning signs. Assessment: knee osteoarthritis.' };
  assert.strictEqual(study.recordMentions(farApart, 'knee injection'), false,
    'knee dx sentence far from an epidural must not read as a knee injection');
  assert.strictEqual(study.recordMentions(farApart, 'lumbar epidural steroid injection'), true);
  assert.strictEqual(study.recordMentions(
    { type: 'Procedure', detail: 'Injection of steroid into the left knee under ultrasound guidance today.' }, 'knee injection'), true,
    'a genuine knee injection phrase must still match');
  console.log('study-proximity-cohort: ok');
})();

/* sr-2.2.0: question-phrase fallback to ALL patients + analysis-first composition */
(async () => {
  const spec30 = study.parseStudySpec('Study outcomes for all stored patients, all time');
  assert.strictEqual(spec30.targetPages, 30, 'default target is a focused 30-page paper');
  assert.strictEqual(study.parseStudySpec('x outcomes cohort, 60 pages').targetPages, 60, 'explicit page requests still honored');

  const envQ = {
    getPatients() {
      const out = [];
      for (let i = 1; i <= 40; i++) {
        out.push({ id: 'q' + i, name: 'Cohort Patient' + i, dob: '1960-01-0' + ((i % 9) + 1), visits: [
          { date: '2026-03-1' + (i % 9), type: 'Follow-up', detail: 'Routine follow-up, pain ' + (i % 10) + '/10, tolerating treatment well.' },
          { date: '2026-05-1' + (i % 9), type: 'Follow-up', detail: 'Continued care, stable.' }
        ] });
      }
      return out;
    },
    getNotes() { return []; }, _calAppts: [], sgFix: { buildAll() { return []; } }
  };
  const qRecords = study.collectStoredRecords(envQ);
  const qSpec = study.parseStudySpec('Create a study on how happy my patients are based on each visit');
  assert.strictEqual(qSpec.cohort.mode, 'keyword', 'question phrase initially parses as keyword');
  const sg = {
    __live: true,
    analyze(group) { const v = group.patients.flatMap((p) => p.visits); return { patientCount: group.patients.length, visitCount: v.length, patients: group.patients, allVisits: v, months: [], byMonth: {}, byType: {}, pain: [], avgVisits: v.length / group.patients.length }; },
    chartSVG() { return '<svg></svg>'; },
    get() { return null; }
  };
  class FakeJsPDF {
    constructor() { this.pages = 1; this.internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } }; }
    setTextColor() {} setFontSize() {} setFont() {} text() {} setDrawColor() {} setFillColor() {} rect() {} line() {}
    splitTextToSize(v) { const t = String(v); const l = []; for (let i = 0; i < t.length; i += 85) l.push(t.slice(i, i + 85)); return l.length ? l : ['']; }
    addPage() { this.pages += 1; } getNumberOfPages() { return this.pages; } setPage() {}
    output() { return new Blob(['fake'], { type: 'application/pdf' }); }
  }
  const doc = { getElementById() { return null; }, createElement() { return { value: '', textContent: '' }; } };
  const res = await study.executeSpec(qSpec, { sg, records: qRecords, document: doc, now: new Date('2026-07-16T12:00:00Z'), jsPDF: FakeJsPDF, useAi: false });
  assert.strictEqual(res.scoped.patientCount, 40, 'question phrase must fall back to ALL stored patients');
  const modelText = JSON.stringify(res.model);
  assert.match(modelText, /Cohort fallback: the phrase/, 'the fallback must be disclosed in the paper');
  const cases = res.model.sections.find((s) => s.key === 'cases');
  /* sr-2.3.0: the case index covers ALL patients and lives at the END of the
     report (after the reproducibility record); the page ceiling truncates. */
  assert.strictEqual(cases.paragraphs.filter((p) => /^P\d{3}:/.test(p)).length, 40, 'case index must cover all 40 patients');
  const hs = res.model.sections.map((s) => s.heading);
  assert.ok(hs.indexOf('Appendix A. Case-level patient index') > hs.indexOf('Reproducibility record'), 'case index must be the final section');
  assert.match(cases.paragraphs.join(' '), /This index covers ALL 40 included patients/);
  assert.ok(res.model.supportedPageCeiling <= 30, '80 visits over 40 patients stays a focused paper, not a head-count dump');

  /* a REAL procedure term that matches nothing still falls back with disclosure, never a dead end */
  const knee = await study.executeSpec(study.parseStudySpec('Study outcomes for patients who received knee injections, all time'),
    { sg, records: qRecords, document: doc, now: new Date('2026-07-16T12:00:00Z'), jsPDF: FakeJsPDF, useAi: false });
  assert.strictEqual(knee.scoped.patientCount, 40);
  assert.match(JSON.stringify(knee.model), /Cohort fallback/);
  console.log('study-question-fallback: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });

/* junk single-letter identity must never shred the document */
(function () {
  const ids = [{ name: 'a', dob: '', mrn: '' }, { name: 'Jane Example', dob: '1980-02-03', mrn: 'MRN-7788' }];
  const out = study.deidentifyText('Cohort fallback: the phrase matched all patients. Jane Example seen, MRN-7788.', ids);
  assert.strictEqual(out.indexOf('f[redacted]llb[redacted]ck'), -1, 'single-letter identities must be ignored');
  assert.match(out, /Cohort fallback: the phrase matched all patients/);
  assert.ok(!/Jane Example|MRN-7788/.test(out), 'real identities still redacted');
  console.log('study-junk-identity: ok');
})();

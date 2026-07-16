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
 'Case-level summaries', 'Discussion', 'Data quality and limitations', 'Conclusion',
 'Reproducibility record'].forEach((h) => {
  assert.ok(headings.indexOf(h) >= 0, 'missing academic section: ' + h);
});
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

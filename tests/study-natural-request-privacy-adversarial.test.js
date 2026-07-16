'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const asset = path.join(__dirname, '..', 'feat_mls_study_request.js');
const study = require(asset);

const spec = study.parseStudySpec('Build an outcomes study for all my patients from 2026-06-01 through 2026-06-30');
const direct = [{
  name: 'Jane A. Doe', dob: '1980-02-03', mrn: 'MRN-ABC-123', _chartText: '',
  visits: [{
    date: '2026-06-15', type: 'Follow-up for Jane Doe', source: 'Jane A. Doe chart',
    detail: 'Jane Doe / Jane A. Doe; DOB 2/3/1980 and 02-03-1980 and February 3, 1980; ' +
      'MRN MRN-ABC-123; SSN 123-45-6789; 123 Main Street, Indianapolis, IN 46204; ' +
      '317-555-1212; jane.doe@example.com; event 2026-06-15'
  }, {
    date: '2026-06-16', type: 'Export safety', source: 'test', detail: '=HYPERLINK("https://bad.example")'
  }]
}];

const limited = study.deidentifyPatients(direct);
const text = JSON.stringify(limited);
assert.doesNotMatch(text, /Jane(?: A\.)? Doe/i);
assert.doesNotMatch(text, /1980-02-03|2\/3\/1980|02-03-1980|February 3, 1980/i);
assert.doesNotMatch(text, /MRN-ABC-123/i);
assert.doesNotMatch(text, /123-45-6789/);
assert.doesNotMatch(text, /123 Main Street|Indianapolis, IN 46204/i);
assert.doesNotMatch(text, /317-555-1212|jane\.doe@example\.com/i);
assert.doesNotMatch(text, /2026-06-(?:15|16)/, 'visit dates and free-text full dates must be generalized');
assert.strictEqual(limited[0].visits[0].date, '2026-06');

const model = study.buildReportModel(spec, limited, {
  identities: direct,
  scope: { excludedUndated: 0, excludedOutOfRange: 0 },
  resolvedCohort: 'All stored patients'
});
assert.strictEqual(model.deidentified, false);
assert.strictEqual(model.privacyMode, 'direct-identifiers-removed-limited-data-draft');
assert.match(model.privacyWarning, /limited-data study draft requiring clinician and privacy review/i);
assert.match(JSON.stringify(model.sections), /free text may retain indirect identifiers/i);
assert.doesNotMatch(JSON.stringify(model), /2026-06-(?:01|15|30)/);

const undatedPain = study.buildReportModel(spec, [{
  code: 'P001', name: 'P001', dob: '', mrn: '', visits: [
    { date: '', type: 'Visit', source: 'test', detail: 'pain 8/10' },
    { date: '', type: 'Visit', source: 'test', detail: 'pain 4/10' }
  ]
}], { scope: {}, resolvedCohort: 'test' });
assert.doesNotMatch(JSON.stringify(undatedPain.sections), /mean first-to-last change|patients with at least two dated scores/i,
  'undated pain values must not be presented as a dated longitudinal trend');

(async () => {
  const csv = await study.limitedDataCsv(spec, limited, model).text();
  assert.match(csv, /limited-data study draft requiring clinician and privacy review/i);
  assert.doesNotMatch(csv, /Jane(?: A\.)? Doe|1980-02-03|123-45-6789|123 Main Street|317-555-1212|jane\.doe@example\.com/i);
  assert.doesNotMatch(csv, /2026-06-(?:01|15|30)/);
  assert.match(csv, /"'=HYPERLINK/, 'formula-leading free text must be neutralized in spreadsheet exports');
  const source = fs.readFileSync(asset, 'utf8');
  assert.doesNotMatch(source, /HIPAA\s+(?:Safe Harbor|de-?ident)/i, 'the feature must not claim compliance-level de-identification');
  console.log('study-natural-request-privacy-adversarial: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

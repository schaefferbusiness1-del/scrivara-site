'use strict';

const assert = require('assert');
const path = require('path');
const study = require(path.join(__dirname, '..', 'feat_mls_study_request.js'));

assert.strictEqual(study.version, 'sr-2.2.2');

const outcomes = study.parseStudySpec(
  'Build a 30 page retrospective outcomes study of patients who received lumbar epidural injections in the last 12 months',
  { now: new Date('2026-07-16T12:00:00Z') }
);
assert.strictEqual(outcomes.ok, true);
assert.strictEqual(outcomes.studyType, 'outcomes');
assert.strictEqual(outcomes.cohort.mode, 'keyword');
assert.deepStrictEqual(outcomes.cohort.keywords, ['lumbar epidural injections']);
assert.deepStrictEqual(outcomes.range, { kind: 'months', months: 12 });
assert.strictEqual(outcomes.targetPages, 30);
assert.strictEqual(outcomes.deidentified, false);
assert.strictEqual(outcomes.directIdentifiersRemoved, true);
assert.strictEqual(outcomes.limitedDataDraft, true);
assert.strictEqual(outcomes.includeIdentifiers, false);

const comparison = study.parseStudySpec(
  'Compare patients with knee injections versus epidural injections during the last 6 months'
);
assert.strictEqual(comparison.ok, true);
assert.strictEqual(comparison.studyType, 'procedure');
assert.deepStrictEqual(comparison.cohort.keywords, ['knee injections', 'epidural injections']);
assert.deepStrictEqual(comparison.range, { kind: 'months', months: 6 });

const exact = study.parseStudySpec(
  'Show visit volume for all my patients from 2026-06-30 through 2026-01-01, up to 80 pages'
);
assert.strictEqual(exact.studyType, 'volume');
assert.strictEqual(exact.cohort.mode, 'all');
assert.deepStrictEqual(exact.range, { kind: 'dates', from: '2026-01-01', to: '2026-06-30' });
/* sr-2.0.0 raised the evidence-supported hard cap from 30 to 60 pages */
assert.strictEqual(exact.targetPages, 60, 'the hard report cap must be 60 pages');
assert.ok(exact.notes.some((n) => /capped at 60/i.test(n)));

const vague = study.parseStudySpec('make a study');
assert.strictEqual(vague.ok, false);
assert.strictEqual(vague.code, 'clarify-request');
assert.match(vague.clarification, /what should the study measure/i);

assert.strictEqual(study.shouldSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }), true);
assert.strictEqual(study.shouldSubmitKey({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 }), false);
assert.strictEqual(study.shouldSubmitKey({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 }), false);
assert.strictEqual(study.shouldSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 }), false);

const invalidPrivacy = Object.assign({}, outcomes, { includeIdentifiers: true });
assert.strictEqual(study.validateStudySpec(invalidPrivacy).code, 'privacy-required');

console.log('study-natural-request-parser: ok');

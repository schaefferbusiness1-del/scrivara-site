'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shells = [
  'ScribeFlow.html',
  '1pScribeFlow.html',
  path.join('1p', 'index.html'),
  path.join('cloned', 'index.html'),
  'ScribeFlow-staging.html',
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'latin1');
}

function legalHelpers(source, file) {
  const start = source.indexOf('function legalDraftSubtypeFor');
  const end = source.indexOf('\n\n/* Per-type professional format guidance', start);
  assert(start >= 0 && end > start, `${file}: legal subtype helpers are not extractable`);
  return new Function(`${source.slice(start, end)}; return { legalDraftSubtypeFor, legalSectionRetryable };`)();
}

function expertGenerator(source, file) {
  const start = source.indexOf('async function generateExpertReportSections');
  const end = source.indexOf('\n}\n\n/* Rebuild the report from scratch', start) + 2;
  assert(start >= 0 && end > start, `${file}: expert generator is not extractable`);
  return function make(aiCallRaw, getKey, helpers) {
    return new Function('aiCallRaw', 'getKey', 'legalDraftSubtypeFor', 'legalSectionRetryable',
      `${source.slice(start, end)}; return generateExpertReportSections;`)(
      aiCallRaw, getKey, helpers.legalDraftSubtypeFor, helpers.legalSectionRetryable,
    );
  };
}

(async function run() {
  for (const file of shells) {
    const source = read(file);
    const helpers = legalHelpers(source, file);
    const subtype = helpers.legalDraftSubtypeFor;

    assert.strictEqual(subtype('Narrative medical report', false), 'narrative_medical_report', `${file}: narrative subtype drifted`);
    assert.strictEqual(subtype('Independent Medical Exam (IME)', false), 'ime', `${file}: IME subtype drifted`);
    assert.strictEqual(subtype('Bill review / medical necessity', false), 'utilization_review', `${file}: medical-necessity subtype drifted`);
    assert.strictEqual(subtype('utilization_review', false), 'utilization_review', `${file}: server utilization subtype drifted`);
    assert.strictEqual(subtype('Expert report', true), 'legal_section', `${file}: expert section subtype drifted`);
    assert.strictEqual(subtype('Causation opinion', false), 'legal_report', `${file}: generic legal subtype drifted`);

    const familySites = [...source.matchAll(/family:'legal_ime'/g)];
    assert(familySites.length >= 3, `${file}: expected legal-family generation sites`);
    for (const hit of familySites) {
      const call = source.slice(hit.index, hit.index + 360);
      assert.match(call, /draftSubtype:legalDraftSubtypeFor\(/,
        `${file}: family:'legal_ime' site lacks an explicit deterministic subtype`);
    }
    assert(!source.includes('narrativeSubtype'), `${file}: stale optional narrative subtype path remains`);
    assert(!source.includes('This section could not be generated automatically'),
      `${file}: expert generation still exposes a partial-error placeholder`);
    assert.match(source, /for\(let attempt=1;attempt<=2;attempt\+\+\)/,
      `${file}: expert sections do not have the single bounded retry`);
    assert.match(source, /legalSectionRetryable\(/,
      `${file}: expert retry is not limited to retryable/quality failures`);
    assert.match(source, /mechanism and chronology/,
      `${file}: causation guidance lost the evidence prerequisite`);
    assert.match(source, /do not use the probability\/form sentence/,
      `${file}: causation guidance can still force the probability form`);

    const guardAt = source.lastIndexOf("if(typeof out!=='string'||!out.trim())");
    const mutationAt = source.indexOf('currentLegal=out;', guardAt);
    assert(guardAt >= 0 && mutationAt > guardAt, `${file}: legal mutation is not behind the blank/type guard`);

    const makeGenerator = expertGenerator(source, file);
    let calls = 0;
    const subtypes = [];
    const retrying = async (_sys, _user, _key, opts) => {
      calls++;
      subtypes.push(opts.draftSubtype);
      if (calls === 1) {
        const e = new Error('502 draft_quality_failed');
        e.mlsAi = { retryable: true, code: 'draft_quality_failed' };
        throw e;
      }
      return 'Supported evidence-bound section response.';
    };
    const retryingGenerator = makeGenerator(retrying, () => '', helpers);
    const retried = await retryingGenerator({ today: 'synthetic', docType: 'Expert report', btn: null });
    assert.strictEqual(calls, 18, `${file}: one failed section did not receive exactly one retry`);
    assert(subtypes.every((value) => value === 'legal_section'), `${file}: retry lost the explicit legal_section subtype`);
    assert(!/could not be generated automatically/.test(retried), `${file}: retry result contains a partial-error placeholder`);

    calls = 0;
    const alwaysFail = async (_sys, _user, _key, opts) => {
      calls++;
      assert.strictEqual(opts.draftSubtype, 'legal_section', `${file}: failed section lost legal_section subtype`);
      const e = new Error('502 draft_quality_failed');
      e.mlsAi = { retryable: true, code: 'draft_quality_failed' };
      throw e;
    };
    const failingGenerator = makeGenerator(alwaysFail, () => '', helpers);
    let currentLegal = 'previous complete report';
    let bodyValue = currentLegal;
    let rejected = false;
    try {
      const out = await failingGenerator({ today: 'synthetic', docType: 'Expert report', btn: null });
      if (typeof out === 'string' && out.trim()) {
        currentLegal = out;
        bodyValue = out;
      }
    } catch (_) {
      rejected = true;
    }
    assert(rejected, `${file}: second section failure did not abort the whole report`);
    assert.strictEqual(calls, 2, `${file}: failed section exceeded the one-retry bound`);
    assert.strictEqual(currentLegal, 'previous complete report', `${file}: failed expert report mutated currentLegal`);
    assert.strictEqual(bodyValue, 'previous complete report', `${file}: failed expert report mutated the editor body`);
  }
  console.log(`PASS legal routing/retry/causation contracts across ${shells.length} shells`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

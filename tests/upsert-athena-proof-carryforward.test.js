'use strict';

/* Live 2026-07-20 (three reproduced day pulls, 11-14 of 16 patients each):
 * _savePatientChart stamped athenaProfileCoverage and upserted the verified
 * clone, then a post-save consumer (ingest/organize/dedup) wrote back a patient
 * object it had materialized BEFORE the save — silently erasing the coverage,
 * snapshot, summary block, and import stamp. Every pull then failed its own
 * read-back gate with clinical-field-save-unproven.
 *
 * Contract: upsertPatient carries the four Athena-owned proof fields forward
 * from the stored row when the incoming object simply lacks them. A caller
 * providing FRESH values still wins; whole-row removal (purge) is untouched
 * because it goes through savePatients, never a field-less upsert.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function extractUpsert(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const start = src.indexOf('function upsertPatient(p){');
  assert(start > 0, file + ': upsertPatient not found');
  const end = src.indexOf('\nfunction ', start + 10);
  assert(end > start, file + ': upsertPatient end boundary not found');
  return src.slice(start, end);
}

const PROOF_FIELDS = ['athenaProfileCoverage', 'athenaChartSnapshot', 'athenaChartSummaryBlock', 'athenaChartImportedAt'];

function runScenario(file) {
  const fnSrc = extractUpsert(file);
  for (const f of PROOF_FIELDS) {
    assert(fnSrc.includes("'" + f + "'"), file + ': upsertPatient does not carry ' + f + ' forward');
  }

  const stored = [];
  const ctx = vm.createContext({
    uns: k => 'acct::' + k,
    __mlsPtsBatchByKey: {},
    __mlsPtsForeignBatch: () => null,
    getPatients: () => stored.slice(),
    savePatients: arr => { stored.length = 0; arr.forEach(x => stored.push(x)); },
    backendMode: () => false,
    bkToken: () => '',
    syncPatientToServer: () => {},
    Date: Date
  });
  vm.runInContext(fnSrc + '\nthis.upsertPatient = upsertPatient;', ctx, { filename: file + ':upsertPatient' });

  // seed: the verified save landed (coverage + snapshot present)
  stored.push({
    id: 'pX', name: 'Test Patient',
    athenaProfileCoverage: { complete: true, exactIdentityVerified: true, patientId: 'pX', capturedAt: '2026-07-20T16:00:00Z', saveRequestId: 'req-1' },
    athenaChartSnapshot: { capturedAt: '2026-07-20T16:00:00Z', problems: ['knee pain'] },
    athenaChartSummaryBlock: '— Pulled from Athena —',
    athenaChartImportedAt: '2026-07-20T16:00:00Z'
  });

  // 1. stale-reference write-back (no proof fields) must NOT erase them
  ctx.upsertPatient({ id: 'pX', name: 'Test Patient', visits: [{ date: '2026-07-01', type: 'Office visit' }] });
  let row = stored.find(x => x.id === 'pX');
  assert(row.athenaProfileCoverage && row.athenaProfileCoverage.complete === true, file + ': stale upsert erased athenaProfileCoverage');
  assert.strictEqual(row.athenaProfileCoverage.saveRequestId, 'req-1', file + ': coverage identity lost');
  assert(row.athenaChartSnapshot && row.athenaChartSnapshot.problems.length === 1, file + ': snapshot erased');
  assert.strictEqual(row.athenaChartSummaryBlock, '— Pulled from Athena —', file + ': summary block erased');
  assert.strictEqual(row.athenaChartImportedAt, '2026-07-20T16:00:00Z', file + ': import stamp erased');
  assert.strictEqual(row.visits.length, 1, file + ': the stale caller\'s own new content must still land');

  // 2. a FRESH verified save still replaces the old proof
  ctx.upsertPatient({
    id: 'pX', name: 'Test Patient',
    athenaProfileCoverage: { complete: true, exactIdentityVerified: true, patientId: 'pX', capturedAt: '2026-07-20T17:00:00Z', saveRequestId: 'req-2' },
    athenaChartSnapshot: { capturedAt: '2026-07-20T17:00:00Z', problems: ['knee pain', 'hip pain'] },
    athenaChartSummaryBlock: '— Pulled from Athena v2 —',
    athenaChartImportedAt: '2026-07-20T17:00:00Z'
  });
  row = stored.find(x => x.id === 'pX');
  assert.strictEqual(row.athenaProfileCoverage.saveRequestId, 'req-2', file + ': fresh coverage must win');
  assert.strictEqual(row.athenaChartSnapshot.problems.length, 2, file + ': fresh snapshot must win');

  // 3. new-patient insert unchanged
  ctx.upsertPatient({ id: 'pNew', name: 'Someone Else' });
  assert(stored.some(x => x.id === 'pNew' && x.created), file + ': new-patient path broken');
}

runScenario('ScribeFlow.html');
runScenario('ScribeFlow-staging.html');

/* The sanitizer's ingest wrapper must forward the 4th argument — dropping opts
 * filed every sanitized ingest as an UNVERIFIED visit row (identityVerified /
 * identityBinding lost), breaking provenance honesty for pulled visits. */
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
assert(connect.includes('var w = function (patient, chart, source, opts) { return orig(patient, sanitizeChartObj(chart), source, opts); };'),
  'mls-connect.js: the sanitizer ingest wrapper must pass opts through');

console.log('PASS athena proof carry-forward: stale-reference upserts cannot erase verified coverage/snapshot, fresh saves still win, and the sanitizer ingest wrapper forwards identity opts');

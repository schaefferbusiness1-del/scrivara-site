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
    assert(fnSrc.includes(f), file + ': upsertPatient does not guard ' + f);
  }
  assert(/capturedAt/.test(fnSrc), file + ': the guard must compare coverage capturedAt (newest wins), not mere presence');

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

  // 3. a stale object carrying an EARLIER pass's coverage must NOT roll back
  //    the newer stamp (live b447 finding: null-only carry-forward let old
  //    coverage overwrite fresh, failing six-card-profile-freshness-unproven)
  ctx.upsertPatient({
    id: 'pX', name: 'Test Patient',
    athenaProfileCoverage: { complete: true, exactIdentityVerified: true, patientId: 'pX', capturedAt: '2026-07-20T12:00:00Z', saveRequestId: 'req-0-older' },
    athenaChartSnapshot: { capturedAt: '2026-07-20T12:00:00Z', problems: ['stale'] },
    athenaChartSummaryBlock: '— stale block —',
    athenaChartImportedAt: '2026-07-20T12:00:00Z'
  });
  row = stored.find(x => x.id === 'pX');
  assert.strictEqual(row.athenaProfileCoverage.saveRequestId, 'req-2', file + ': OLDER coverage rolled back the newer stamp');
  assert.strictEqual(row.athenaChartSnapshot.problems.length, 2, file + ': OLDER snapshot rolled back the newer one');
  assert.strictEqual(row.athenaChartImportedAt, '2026-07-20T17:00:00Z', file + ': OLDER import stamp rolled back the newer one');

  // 4. new-patient insert unchanged
  ctx.upsertPatient({ id: 'pNew', name: 'Someone Else' });
  assert(stored.some(x => x.id === 'pNew' && x.created), file + ': new-patient path broken');
}

/* Bulk writers (render/sweep savePatients with a pre-save array) bypass
 * upsertPatient entirely and rolled the whole roster back (live b447: 8 of 17
 * still failing after the upsert-only guard). The __mlsAthenaProofGuard index
 * must restore the newest proof on EVERY savePatients call. */
function runBulkScenario(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const gStart = src.indexOf('var __mlsAthenaProofByKey={};');
  assert(gStart > 0, file + ': __mlsAthenaProofByKey index missing');
  const gEnd = src.indexOf('function savePatients', gStart);
  assert(gEnd > gStart, file + ': proof-guard boundary not found');
  const ctx = vm.createContext({ Date: Date });
  vm.runInContext(src.slice(gStart, gEnd) + '\nthis.guard = __mlsAthenaProofGuard;', ctx, { filename: file + ':proofGuard' });
  assert(src.includes('__mlsAthenaProofGuard('), file + ': savePatients never calls the proof guard');

  const fresh = { complete: true, patientId: 'pX', capturedAt: '2026-07-20T17:00:00Z', saveRequestId: 'req-new' };
  // save 1: the verified pull persists fresh coverage → indexed
  ctx.guard('k', [{ id: 'pX', athenaProfileCoverage: fresh, athenaChartSnapshot: { s: 1 }, athenaChartSummaryBlock: 'B', athenaChartImportedAt: 'T' }]);
  // save 2: a sweep persists a stale roster (older coverage) → restored to fresh
  const staleRow = { id: 'pX', athenaProfileCoverage: { complete: true, patientId: 'pX', capturedAt: '2026-07-20T12:00:00Z', saveRequestId: 'req-old' } };
  ctx.guard('k', [staleRow]);
  assert.strictEqual(staleRow.athenaProfileCoverage.saveRequestId, 'req-new', file + ': bulk save rolled coverage back');
  assert.deepStrictEqual(staleRow.athenaChartSnapshot, { s: 1 }, file + ': bulk save lost the snapshot');
  // save 3: a coverage-less stale roster → restored too
  const bareRow = { id: 'pX' };
  ctx.guard('k', [bareRow]);
  assert.strictEqual(bareRow.athenaProfileCoverage.saveRequestId, 'req-new', file + ': bulk save erased coverage entirely');
  // a NEWER save updates the index and wins thereafter
  const newer = { id: 'pX', athenaProfileCoverage: { complete: true, patientId: 'pX', capturedAt: '2026-07-20T18:00:00Z', saveRequestId: 'req-newer' } };
  ctx.guard('k', [newer]);
  const after = { id: 'pX' };
  ctx.guard('k', [after]);
  assert.strictEqual(after.athenaProfileCoverage.saveRequestId, 'req-newer', file + ': index did not advance to the newest proof');
  // other accounts' keys are isolated
  const otherKey = { id: 'pX' };
  ctx.guard('k2', [otherKey]);
  assert(!otherKey.athenaProfileCoverage, file + ': proof index leaked across account keys');
}

runBulkScenario('ScribeFlow.html');
runBulkScenario('ScribeFlow-staging.html');

runScenario('ScribeFlow.html');
runScenario('ScribeFlow-staging.html');

/* The sanitizer's ingest wrapper must forward the 4th argument — dropping opts
 * filed every sanitized ingest as an UNVERIFIED visit row (identityVerified /
 * identityBinding lost), breaking provenance honesty for pulled visits. */
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
assert(connect.includes('var w = function (patient, chart, source, opts) { return orig(patient, sanitizeChartObj(chart), source, opts); };'),
  'mls-connect.js: the sanitizer ingest wrapper must pass opts through');

console.log('PASS athena proof carry-forward: stale-reference upserts cannot erase verified coverage/snapshot, fresh saves still win, and the sanitizer ingest wrapper forwards identity opts');

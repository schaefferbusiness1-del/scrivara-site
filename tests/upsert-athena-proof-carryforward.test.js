'use strict';

/* Live 2026-07-20 (five reproduced day pulls): _savePatientChart stamped
 * athenaProfileCoverage and upserted the verified clone, then post-save
 * consumers wrote back patient objects materialized BEFORE the save. Three
 * layers were needed:
 *  b446 — null-only carry-forward in upsertPatient (stopped ERASURE);
 *  b447 — newest-capturedAt-wins in upsertPatient (stopped ROLLBACK by stale
 *         objects carrying an EARLIER pass's coverage);
 *  b448/b449 — __mlsAthenaProofGuard newest-proof index on EVERY savePatients
 *         call AND fed at upsertPatient time (a fresh batch-path save can be
 *         wholesale-replaced by a bulk stale savePatients BEFORE any flush, so
 *         a savePatients-only index restored the PREVIOUS pull's stamp).
 * The four Athena-owned proof fields move together as one unit.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function extractBlock(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  assert(start >= 0, label + ': start marker not found: ' + startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert(end > start, label + ': end marker not found: ' + endMarker);
  return src.slice(start, end);
}

const PROOF_FIELDS = ['athenaProfileCoverage', 'athenaChartSnapshot', 'athenaChartSummaryBlock', 'athenaChartImportedAt'];

function buildContext(file, batchState) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const guardSrc = extractBlock(src, 'var __mlsAthenaProofByKey={};', 'function savePatients', file + ' guard');
  const upsertSrc = extractBlock(src, 'function upsertPatient(p){', '\nfunction ', file + ' upsert');
  for (const f of PROOF_FIELDS) assert((guardSrc + upsertSrc).includes(f), file + ': proof guard does not cover ' + f);
  assert(/capturedAt/.test(guardSrc), file + ': guard must compare capturedAt (newest wins)');

  const stored = [];
  const ctx = vm.createContext({
    uns: k => 'acct::' + k,
    __mlsPtsStorageKey: k => k || 'acct::patients',
    __mlsPtsBatchByKey: batchState || {},
    __mlsPtsForeignBatch: () => null,
    __mlsPtsFlushBatch: () => {},
    __mlsPtsArmBatch: () => {},
    getPatients: () => (batchState && batchState['acct::patients'] ? batchState['acct::patients'].arr.slice() : stored.slice()),
    savePatients: arr => { stored.length = 0; arr.forEach(x => stored.push(x)); },
    backendMode: () => false,
    bkToken: () => '',
    syncPatientToServer: () => {},
    Date: Date
  });
  vm.runInContext(guardSrc + '\n' + upsertSrc + '\nthis.upsertPatient = upsertPatient; this.guard = __mlsAthenaProofGuard; this.proofIndex = __mlsAthenaProofByKey;', ctx, { filename: file + ':proof' });
  return { ctx, stored };
}

function covOf(at, req) {
  return { complete: true, exactIdentityVerified: true, patientId: 'pX', capturedAt: at, saveRequestId: req };
}

function runScenario(file) {
  const { ctx, stored } = buildContext(file);
  stored.push({
    id: 'pX', name: 'Test Patient',
    athenaProfileCoverage: covOf('2026-07-20T16:00:00Z', 'req-1'),
    athenaChartSnapshot: { capturedAt: '2026-07-20T16:00:00Z', problems: ['knee pain'] },
    athenaChartSummaryBlock: '— Pulled from Athena —',
    athenaChartImportedAt: '2026-07-20T16:00:00Z'
  });

  // 1. stale write-back with NO proof fields must not erase them
  ctx.upsertPatient({ id: 'pX', name: 'Test Patient', visits: [{ date: '2026-07-01', type: 'Office visit' }] });
  let row = stored.find(x => x.id === 'pX');
  assert.strictEqual(row.athenaProfileCoverage.saveRequestId, 'req-1', file + ': stale upsert erased coverage');
  assert(row.athenaChartSnapshot && row.athenaChartSnapshot.problems.length === 1, file + ': snapshot erased');
  assert.strictEqual(row.visits.length, 1, file + ': the stale caller\'s own new content must still land');

  // 2. a FRESH verified save still replaces the old proof
  ctx.upsertPatient({
    id: 'pX', name: 'Test Patient',
    athenaProfileCoverage: covOf('2026-07-20T17:00:00Z', 'req-2'),
    athenaChartSnapshot: { capturedAt: '2026-07-20T17:00:00Z', problems: ['knee pain', 'hip pain'] },
    athenaChartSummaryBlock: '— Pulled from Athena v2 —',
    athenaChartImportedAt: '2026-07-20T17:00:00Z'
  });
  row = stored.find(x => x.id === 'pX');
  assert.strictEqual(row.athenaProfileCoverage.saveRequestId, 'req-2', file + ': fresh coverage must win');

  // 3. a stale object carrying an EARLIER pass's coverage must NOT roll back
  ctx.upsertPatient({
    id: 'pX', name: 'Test Patient',
    athenaProfileCoverage: covOf('2026-07-20T12:00:00Z', 'req-0-older'),
    athenaChartSnapshot: { capturedAt: '2026-07-20T12:00:00Z', problems: ['stale'] },
    athenaChartSummaryBlock: '— stale block —',
    athenaChartImportedAt: '2026-07-20T12:00:00Z'
  });
  row = stored.find(x => x.id === 'pX');
  assert.strictEqual(row.athenaProfileCoverage.saveRequestId, 'req-2', file + ': OLDER coverage rolled back the newer stamp');
  assert.strictEqual(row.athenaChartSnapshot.problems.length, 2, file + ': OLDER snapshot rolled back the newer one');

  // 4. new-patient insert unchanged
  ctx.upsertPatient({ id: 'pNew', name: 'Someone Else' });
  assert(stored.some(x => x.id === 'pNew' && x.created), file + ': new-patient path broken');
}

/* THE b448 kill sequence: fresh save lands in the OPEN BATCH (no savePatients
 * runs), then a bulk stale savePatients replaces the whole roster. The index
 * must have learned the fresh proof AT UPSERT TIME so the bulk guard restores
 * the FRESH stamp, not a previous pull's. */
function runKillSequence(file) {
  const batch = { 'acct::patients': { depth: 1, arr: [{ id: 'pX', name: 'Test Patient', athenaProfileCoverage: covOf('2026-07-20T17:22:00Z', 'req-prev-pull') }], dirty: false, changesSinceFlush: 0, totalChanges: 0, maxChanges: 999, dirtySince: 0 } };
  const { ctx } = buildContext(file, batch);
  // fresh chart save enters through the batch path only
  ctx.upsertPatient({ id: 'pX', name: 'Test Patient', athenaProfileCoverage: covOf('2026-07-20T17:45:00Z', 'req-fresh'), athenaChartSnapshot: { capturedAt: '2026-07-20T17:45:00Z', problems: ['fresh'] }, athenaChartSummaryBlock: 'F', athenaChartImportedAt: '2026-07-20T17:45:00Z' });
  // bulk stale save (materialized before the fresh save) — as savePatients would run the guard
  const staleRow = { id: 'pX', name: 'Test Patient', athenaProfileCoverage: covOf('2026-07-20T17:22:00Z', 'req-prev-pull') };
  ctx.guard('acct::patients', [staleRow]);
  assert.strictEqual(staleRow.athenaProfileCoverage.saveRequestId, 'req-fresh',
    file + ': the index did not learn the fresh proof at upsert time — bulk stale save restored the previous pull\'s stamp');
  assert.deepStrictEqual(staleRow.athenaChartSnapshot, { capturedAt: '2026-07-20T17:45:00Z', problems: ['fresh'] }, file + ': fresh snapshot lost in the kill sequence');
}

runScenario('ScribeFlow.html');
runScenario('ScribeFlow-staging.html');
runKillSequence('ScribeFlow.html');

/* Bulk-writer guard basics on both files */
function runBulkScenario(file) {
  const { ctx } = buildContext(file);
  const freshRow = { id: 'pX', athenaProfileCoverage: covOf('2026-07-20T17:00:00Z', 'req-new'), athenaChartSnapshot: { s: 1 }, athenaChartSummaryBlock: 'B', athenaChartImportedAt: 'T' };
  ctx.guard('k', [freshRow]);
  const staleRow = { id: 'pX', athenaProfileCoverage: covOf('2026-07-20T12:00:00Z', 'req-old') };
  ctx.guard('k', [staleRow]);
  assert.strictEqual(staleRow.athenaProfileCoverage.saveRequestId, 'req-new', file + ': bulk save rolled coverage back');
  const bareRow = { id: 'pX' };
  ctx.guard('k', [bareRow]);
  assert.strictEqual(bareRow.athenaProfileCoverage.saveRequestId, 'req-new', file + ': bulk save erased coverage entirely');
  const newer = { id: 'pX', athenaProfileCoverage: covOf('2026-07-20T18:00:00Z', 'req-newer') };
  ctx.guard('k', [newer]);
  const after = { id: 'pX' };
  ctx.guard('k', [after]);
  assert.strictEqual(after.athenaProfileCoverage.saveRequestId, 'req-newer', file + ': index did not advance to the newest proof');
  const otherKey = { id: 'pX' };
  ctx.guard('k2', [otherKey]);
  assert(!otherKey.athenaProfileCoverage, file + ': proof index leaked across account keys');
}

runBulkScenario('ScribeFlow.html');
runBulkScenario('ScribeFlow-staging.html');

/* b490 husk carry-forward: live 2026-07-22, two patients' visit arrays were
 * replaced by 4-field {date,type,detail,source} husks (14 verified bodies
 * vanished and mirrored to the server). A structure-stripped zero-body copy
 * over a body-carrying stored record must keep the stored visits. A
 * STRUCTURED zero-body copy (reconcile output) must still be adopted. */
function runHuskScenario(file) {
  const { ctx, stored } = buildContext(file);
  const bodies = [
    { id: 'v1', date: '2026-07-01', type: 'Visit', raw: 'Full clinical body A', bodyComplete: true, indexOnly: false, fullDetail: true, source: 'athena-copy' },
    { id: 'v2', date: '2026-07-08', type: 'Visit', raw: 'Full clinical body B', bodyComplete: true, indexOnly: false, fullDetail: true, source: 'athena-copy' }
  ];
  stored.push({ id: 'pH', name: 'Husk Case', visits: bodies.map(v => Object.assign({}, v)) });

  // husk write-back: rows kept, all normalized fields stripped -> visits carried forward
  ctx.upsertPatient({ id: 'pH', name: 'Husk Case', visits: [
    { date: '2026-07-01', type: 'Visit', detail: '', source: 'athena-copy' },
    { date: '2026-07-08', type: 'Visit', detail: '', source: 'athena-copy' }
  ] });
  let row = stored.find(x => x.id === 'pH');
  assert.strictEqual(row.visits.filter(v => v.bodyComplete === true && String(v.raw || '').trim()).length, 2,
    file + ': a husk write-back stripped the stored verified bodies');

  // structured zero-body copy (e.g. legitimate reconcile outcome) is adopted
  ctx.upsertPatient({ id: 'pH', name: 'Husk Case', visits: [
    { id: 's1', date: '2026-07-01', type: 'Visit', raw: '', textHead: 'index', indexOnly: true, bodyComplete: false, fullDetail: false, source: 'athena-schedule-history' }
  ] });
  row = stored.find(x => x.id === 'pH');
  assert.strictEqual(row.visits.length, 1, file + ': a structured zero-body copy must still be adopted');
  assert.strictEqual(row.visits[0].indexOnly, true, file + ': adopted structured row lost its shape');
}

runHuskScenario('ScribeFlow.html');
runHuskScenario('ScribeFlow-staging.html');

/* b490 hydration guard: the server mirror must never regress verified bodies */
for (const file of ['ScribeFlow.html', 'ScribeFlow-staging.html']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  assert(src.includes('never let a server mirror REGRESS verified visit bodies'),
    file + ': hydration body-regression guard missing');
  assert(/__bodies\(local\[i\]\.visits\)>__bodies\(adopted\.visits\)/.test(src),
    file + ': hydration body-parity guard condition missing (b497 deficit form)');
}

/* b497: when the hydrate guard keeps local bodies against a husked server
   copy, it must ALSO queue a re-mirror — otherwise the server backup stays a
   husk forever (adopting the server stamp means no later sync fires), and a
   lost local store would restore the husk as permanent body loss. */
for (const file of ['ScribeFlow.html', 'ScribeFlow-staging.html']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const guardAt = src.indexOf("via:'hydrate'");
  assert(guardAt > 0, file + ': hydrate guard log marker missing');
  const guardSlice = src.slice(guardAt, guardAt + 700);
  assert(guardSlice.includes('_pendingSyncAdd(row.external_id)'),
    file + ': hydrate husk-heal does not queue a server re-mirror of the healed record');
}

/* savePatients must actually invoke the guard */
for (const file of ['ScribeFlow.html', 'ScribeFlow-staging.html']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const saveStart = src.indexOf('function savePatients(');
  const saveEnd = src.indexOf('var __mlsPtsBaseSavePatients=savePatients;', saveStart);
  const saveSlice = src.slice(saveStart, saveEnd > saveStart ? saveEnd : saveStart + 12000);
  assert(saveSlice.includes('__mlsAthenaProofGuard('), file + ': savePatients never calls the proof guard');
}

/* The sanitizer's ingest wrapper must forward the 4th argument — dropping opts
 * filed every sanitized ingest as an UNVERIFIED visit row. */
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
assert(connect.includes('var w = function (patient, chart, source, opts) { return orig(patient, sanitizeChartObj(chart), source, opts); };'),
  'mls-connect.js: the sanitizer ingest wrapper must pass opts through');

console.log('PASS athena proof guard: erasure, rollback, bulk-writer, and batch-then-bulk kill sequence all keep the newest verified proof; ingest opts forwarded');

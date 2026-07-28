'use strict';

/* 2026-07-28 — THE THIRD PROBLEM-LOSS MECHANISM, reproduced live and pinned.
 *
 * Live measurement on the real store (91 snapshot patients): 16 charts held a
 * COMPLETE exact-identity coverage receipt and a fresh chart snapshot while
 * the problems field held a PRE-pull state (5 effectively empty, 11 short —
 * usually by exactly one). Seconds-level timestamps proved the anatomy: the
 * chart save wrote a correct row, and 9ms later a caller holding a PRE-save
 * patient reference wrote the older object back. upsertPatient's b446-b448
 * guards then re-attached ONLY the four proof fields, so the store ended as
 * today's receipt stapled to yesterday's clinical fields. Every day pull
 * undid its own field writes; re-pulls could never heal it.
 *
 * The law under test: the four proof fields and the clinical fields they
 * ATTEST travel as one unit, at BOTH choke points (upsertPatient and the
 * __mlsAthenaProofGuard used by savePatients). Carry policy: a field carries
 * only when the newer state actually had content, so a stale-referenced
 * caller that merely ADDS content still lands its addition.
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

const ATTESTED = ['problems', 'meds', 'allergies', 'history', 'vitals', 'bmi', 'summary',
  'athenaHistorySummary', 'athenaHistoryFactsSnapshot', 'historyImportReceipt'];

function buildContext() {
  const src = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
  const guardSrc = extractBlock(src, 'var __mlsAthenaProofByKey={};', 'function savePatients', 'guard');
  const upsertSrc = extractBlock(src, 'function upsertPatient(p){', '\nfunction ', 'upsert');
  for (const f of ATTESTED) {
    assert(guardSrc.includes("'" + f + "'"), 'attested field list must cover ' + f);
  }
  assert(upsertSrc.includes('__mlsAthenaCarryAttested'), 'upsertPatient must carry the attested slice');

  const stored = [];
  const ctx = vm.createContext({
    uns: k => 'acct::' + k,
    __mlsPtsStorageKey: k => k || 'acct::patients',
    __mlsPtsBatchByKey: {},
    __mlsPtsForeignBatch: () => null,
    __mlsPtsFlushBatch: () => {},
    __mlsPtsArmBatch: () => {},
    getPatients: () => stored.slice(),
    savePatients: arr => { stored.length = 0; arr.forEach(x => stored.push(x)); },
    backendMode: () => false,
    bkToken: () => '',
    syncPatientToServer: () => {},
    globalThis: {},
    Date: Date
  });
  vm.runInContext(guardSrc + '\n' + upsertSrc +
    '\nthis.upsertPatient = upsertPatient; this.guard = __mlsAthenaProofGuard; this.proofIndex = __mlsAthenaProofByKey;',
    ctx, { filename: 'ScribeFlow.html:attested-slice' });
  return { ctx, stored };
}

function freshRow() {
  return {
    id: 'pX', name: 'Test Patient',
    problems: 'Alpha diagnosis (M17.9)\nBeta diagnosis (I10)\nGamma diagnosis (E11.9)',
    meds: 'MedOne 10 mg daily',
    allergies: 'NKDA',
    history: { pmh: 'Alpha history' },
    vitals: { bp: '120/80' },
    bmi: '27.4',
    summary: 'Fresh pulled summary',
    athenaHistorySummary: 'Fresh aggregate',
    athenaHistoryFactsSnapshot: { problems: ['Alpha diagnosis (M17.9)', 'Beta diagnosis (I10)', 'Gamma diagnosis (E11.9)'] },
    historyImportReceipt: { complete: true, organizedAt: '2026-07-28T10:00:00.050Z' },
    athenaProfileCoverage: { complete: true, exactIdentityVerified: true, patientId: 'pX', capturedAt: '2026-07-28T10:00:00.000Z', saveRequestId: 'req-fresh' },
    athenaChartSnapshot: { capturedAt: '2026-07-28T10:00:00.000Z', problems: ['Alpha diagnosis (M17.9)', 'Beta diagnosis (I10)', 'Gamma diagnosis (E11.9)'] },
    athenaChartSummaryBlock: '— Pulled from Athena —',
    athenaChartImportedAt: '2026-07-28T10:00:00.000Z',
    updated: Date.parse('2026-07-28T10:00:00.010Z')
  };
}

/* 1. THE LIVE CHIMERA, exactly as measured: a stale pre-save object written
 *    back through upsertPatient must NOT roll the clinical slice back. */
{
  const { ctx, stored } = buildContext();
  stored.push(freshRow());
  ctx.upsertPatient({
    id: 'pX', name: 'Test Patient',
    problems: 'Old lonely row',
    meds: '', allergies: '',
    summary: 'Old summary',
    athenaProfileCoverage: { complete: true, exactIdentityVerified: true, patientId: 'pX', capturedAt: '2026-07-27T09:00:00.000Z', saveRequestId: 'req-old' },
    athenaChartSnapshot: { capturedAt: '2026-07-27T09:00:00.000Z', problems: ['Old lonely row'] },
    visits: [{ date: '2026-07-01', type: 'Office visit' }]
  });
  const row = stored.find(x => x.id === 'pX');
  assert.strictEqual(row.athenaProfileCoverage.saveRequestId, 'req-fresh', 'fresh receipt must win');
  assert(/Alpha diagnosis/.test(row.problems) && /Gamma diagnosis/.test(row.problems),
    'stale write-back must not roll back problems (the 16-patient live loss)');
  assert(!/Old lonely row\s*$/.test(row.problems) || /Alpha diagnosis/.test(row.problems), 'attested problems carried');
  assert.strictEqual(row.meds, 'MedOne 10 mg daily', 'attested meds carried over stale empty');
  assert.strictEqual(row.summary, 'Fresh pulled summary', 'attested summary carried');
  assert(row.athenaHistoryFactsSnapshot && row.athenaHistoryFactsSnapshot.problems.length === 3, 'facts snapshot carried');
  assert(row.historyImportReceipt && row.historyImportReceipt.complete === true, 'organize receipt carried');
  assert.strictEqual(row.visits.length, 1, 'the stale caller\'s own NEW content (its visit) must still land');
}

/* 2. Equal-coverage write (a normal fresh edit after the pull) must land —
 *    the carry fires only on a PROVEN stale write-back. */
{
  const { ctx, stored } = buildContext();
  stored.push(freshRow());
  const edit = freshRow();
  edit.problems = edit.problems + '\nDelta diagnosis (K21.9)';
  edit.meds = '';
  ctx.upsertPatient(edit);
  const row = stored.find(x => x.id === 'pX');
  assert(/Delta diagnosis/.test(row.problems), 'a same-coverage edit must not be overridden');
  assert.strictEqual(row.meds, '', 'a same-coverage clearing edit is a legitimate edit and must land');
}

/* 3. Additive stale caller: prev had NO meds; the stale object adds some.
 *    The addition lands (carry only replaces where the newer state had content). */
{
  const { ctx, stored } = buildContext();
  const prev = freshRow();
  prev.meds = '';
  stored.push(prev);
  ctx.upsertPatient({
    id: 'pX', name: 'Test Patient',
    problems: 'Old lonely row', meds: 'NewMed 5 mg nightly',
    athenaProfileCoverage: { complete: true, exactIdentityVerified: true, patientId: 'pX', capturedAt: '2026-07-27T09:00:00.000Z' }
  });
  const row = stored.find(x => x.id === 'pX');
  assert(/Alpha diagnosis/.test(row.problems), 'problems still carried');
  assert.strictEqual(row.meds, 'NewMed 5 mg nightly', 'an ADDITION from a stale caller must not be erased');
}

/* 4. The BULK choke point: a stale savePatients array is repaired by the
 *    proof guard — receipt AND attested slice. */
{
  const { ctx, stored } = buildContext();
  const fresh = freshRow();
  stored.push(fresh);
  ctx.guard('acct::patients', [fresh]); // index sees the fresh state
  const staleArr = [{
    id: 'pX', name: 'Test Patient',
    problems: 'Old lonely row', meds: '',
    athenaProfileCoverage: { complete: true, exactIdentityVerified: true, patientId: 'pX', capturedAt: '2026-07-27T09:00:00.000Z', saveRequestId: 'req-old' },
    athenaChartSnapshot: { capturedAt: '2026-07-27T09:00:00.000Z', problems: ['Old lonely row'] }
  }];
  ctx.guard('acct::patients', staleArr); // what savePatients does before persisting
  assert.strictEqual(staleArr[0].athenaProfileCoverage.saveRequestId, 'req-fresh', 'bulk: fresh receipt restored');
  assert(/Alpha diagnosis/.test(staleArr[0].problems), 'bulk: attested problems restored with the receipt');
  assert.strictEqual(staleArr[0].meds, 'MedOne 10 mg daily', 'bulk: attested meds restored');
}

/* 5. A patient with NO coverage anywhere is untouched by all of this. */
{
  const { ctx, stored } = buildContext();
  stored.push({ id: 'pM', name: 'Manual Only', problems: 'Manual problem' });
  ctx.upsertPatient({ id: 'pM', name: 'Manual Only', problems: 'Edited manual problem' });
  const row = stored.find(x => x.id === 'pM');
  assert.strictEqual(row.problems, 'Edited manual problem', 'manual-only patients edit freely');
}

console.log('upsert-attested-slice-travels-with-receipt: PASS');

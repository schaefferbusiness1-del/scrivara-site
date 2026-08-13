'use strict';

/* 1p contamination cleaner fail-closed runtime
 *
 * The retired cleaner inferred ownership from prose. On Claude's measured
 * 74-case shape it selected 39 healthy records, then blanked four clinical
 * fields. This suite runs the real 1p b49 module and proves the replacement:
 *
 *   - all 74 healthy controls stay byte-identical, including the 39 summaries
 *     that the old prose regex would have selected;
 *   - only a receipt naming another record plus exact importer-owned slices
 *     plus a backup that reads back byte-for-byte may write;
 *   - ambiguous ownership, absent ownership, corrupt storage, a failed write,
 *     and a second/idempotent pass all fail closed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const p1Path = path.join(root, '1p-mls-connect.js');
const source = fs.readFileSync(p1Path, 'utf8');

function moduleSource() {
  const marker = source.indexOf('MLS Scribe -- b49 pull truth');
  const nextMarker = source.indexOf('MLS Scribe -- b49 agenda BUTTON', marker + 1);
  assert(marker >= 0 && nextMarker > marker, 'could not locate the p1 b49 module');
  const start = source.lastIndexOf('/* =========================================================================', marker);
  const end = source.lastIndexOf('/* =========================================================================', nextMarker);
  const sliced = source.slice(start, end);
  assert(sliced.includes("version: '1.1.0-p1-safe-cleaner'"), 'sliced module is not the safe-cleaner build');
  return sliced;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeHarness(initial, options) {
  options = options || {};
  let records = clone(initial || []);
  const storage = new Map();
  const backupKey = 'p1-cleaner-test::p1ContaminationCleanupBackupsV1';
  if (Object.prototype.hasOwnProperty.call(options, 'initialBackupRaw')) {
    storage.set(backupKey, String(options.initialBackupRaw));
  }
  let upsertCalls = 0;
  let backupWasWritten = false;
  const document = {
    readyState: 'complete',
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, appendChild() {}, querySelector: () => null, remove() {} }),
    body: { appendChild() {} }
  };
  const localStorage = {
    getItem(key) {
      key = String(key);
      if (options.getThrows) throw new Error('synthetic backup read failure');
      if (options.corruptReadAfterWrite && backupWasWritten && key === backupKey) return '[]';
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      key = String(key);
      if (options.setThrows && key === backupKey) throw new Error('synthetic backup quota failure');
      storage.set(key, String(value));
      if (key === backupKey) backupWasWritten = true;
    },
    removeItem(key) { storage.delete(String(key)); }
  };
  const context = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    document, localStorage,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    Event: function Event(type) { this.type = type; },
    _calAppts: [],
    _acctTodayKey: () => '2026-08-17',
    _importPulledSchedule: rows => rows,
    getPatients: () => records,
    savePatients(next) { records = clone(next); },
    upsertPatient(next) {
      upsertCalls++;
      const copy = clone(next);
      const at = records.findIndex(row => row && String(row.id) === String(copy.id));
      if (at >= 0) records[at] = copy; else records.unshift(copy);
      if (options.failFirstUpsertAfterMutation && upsertCalls === 1) throw new Error('synthetic partial write');
      if (options.returnFalseFirstUpsert && upsertCalls === 1) return false;
      return true;
    },
    uns: suffix => 'p1-cleaner-test::' + suffix
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(moduleSource(), context, { filename: '1p-b49-safe-cleaner.js' });
  assert(context.__mlsPullTruthB49, 'real p1 cleaner did not install');
  return {
    api: context.__mlsPullTruthB49,
    records: () => records,
    upsertCalls: () => upsertCalls,
    backupKey,
    storage
  };
}

function record(id, summary) {
  return {
    id, name: 'Healthy Control ' + id, dob: '01/02/1960', summary,
    meds: 'clinician medication remains', problems: 'clinician problem remains',
    allergies: 'clinician allergy remains', docs: [], created: 1,
    historyImportReceipt: { complete: true, verifiedVisits: 2, organizedAt: '2026-08-01T12:00:00.000Z', patientId: id, identityFingerprint: 'idfp-stored' },
    athenaHistorySummary: summary,
    athenaHistoryFactsSnapshot: {
      problems: ['clinician problem remains'], meds: ['clinician medication remains'],
      allergies: ['clinician allergy remains'], history: {}, vitals: {}
    }
  };
}

/* Reproduce the retired decision only to prove the denominator is real. It is
   never used by the implementation under test. */
function oldWouldSelect(row) {
  const s = String(row.summary || '');
  let match = s.match(/(?:^|\n)[^\n]*?(?:The patient,\s+|—\s*)?\b([A-Z][a-z]{2,})(?:\s+[A-Z][a-zA-Z'-]+)?\s+is\s+(?:a\s+patient|experiencing|being\s+(?:seen|evaluated))/);
  if (!match) match = s.match(/The patient,\s+([A-Z][a-z]{2,})\b/);
  if (!match) return false;
  const tokens = String(row.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/);
  return tokens.indexOf(match[1].toLowerCase()) < 0;
}

/* 13 ordinary capitalised tokens x 3 old trigger phrases = exactly 39 false
   positives, plus 35 negative controls: the same 39/74 measured shape. */
const ordinary = ['Patient', 'Today', 'She', 'Mother', 'Husband', 'Medication', 'Lumbar',
  'Radiology', 'Therapy', 'Imaging', 'Spouse', 'Nurse', 'Doctor'];
const triggers = [
  token => token + ' is experiencing an ordinary documented symptom.',
  token => token + ' is a patient safety topic discussed at follow-up.',
  token => token + ' is being evaluated as part of routine care.'
];
const healthy = [];
ordinary.forEach((token, tokenIndex) => triggers.forEach((make, phraseIndex) => {
  healthy.push(record('healthy-' + tokenIndex + '-' + phraseIndex, make(token)));
}));
for (let i = 0; i < 35; i++) healthy.push(record('negative-' + i, 'Routine follow-up remains stable for control ' + i + '.'));
assert.strictEqual(healthy.length, 74);
assert.strictEqual(healthy.filter(oldWouldSelect).length, 39, 'the 39/74 regression corpus is not exercising the retired detector');

const healthyBefore = JSON.stringify(healthy);
const healthyHarness = makeHarness(healthy);
const healthyReport = healthyHarness.api.reconcileToday();
assert.strictEqual(healthyHarness.upsertCalls(), 0, 'healthy prose caused a patient write');
assert.strictEqual(JSON.stringify(healthyHarness.records()), healthyBefore, 'healthy records changed byte-for-byte');
assert.strictEqual(healthyReport.contamExamined, 74);
assert.strictEqual(healthyReport.contamFlagged, 0);
assert.strictEqual(healthyReport.contamCleaned, 0);
assert.strictEqual(healthyReport.contamCleared, 0);

function provablyOwnedRecord(id) {
  const wrongSummary = 'Imported summary belonging to the receipt owner.';
  return {
    id, name: 'Current Record', dob: '02/03/1970',
    summary: wrongSummary,
    meds: 'clinician medication byte-for-byte\nwrong imported medication',
    problems: 'clinician problem byte-for-byte\nwrong imported problem',
    allergies: 'clinician allergy byte-for-byte\nwrong imported allergy',
    reason: 'clinician-authored reason must not move',
    history: { family: 'clinician family text must not move' },
    athenaHistorySummary: wrongSummary,
    athenaHistoryFactsSnapshot: {
      problems: ['wrong imported problem', 'owned problem already absent'],
      meds: ['wrong imported medication'], allergies: ['wrong imported allergy'],
      history: { family: ['owned family fact left untouched'] }, vitals: { bp: '120/80' }
    },
    historyImportReceipt: { complete: true, verifiedVisits: 3, organizedAt: '2026-08-01T12:00:00.000Z', patientId: 'different-record', identityFingerprint: 'idfp-different' }
  };
}

/* The one resolving direction: strong provenance + exact owned slices + a
   verified backup. Only the exact owned slices move. */
const dirty = provablyOwnedRecord('cleanup-target');
const dirtyBefore = clone(dirty);
const cleanupHarness = makeHarness([dirty]);
const cleaned = cleanupHarness.api.cleanupContamination(cleanupHarness.records()[0]);
assert.strictEqual(cleaned.ok, true);
assert.strictEqual(cleaned.cleaned, true);
assert.strictEqual(cleanupHarness.upsertCalls(), 1);
const after = cleanupHarness.records()[0];
assert.strictEqual(after.summary, '', 'the exact importer-owned summary was not removed');
assert.strictEqual(after.athenaHistorySummary, '', 'removed summary still claims importer ownership');
assert.strictEqual(after.meds, 'clinician medication byte-for-byte');
assert.strictEqual(after.problems, 'clinician problem byte-for-byte');
assert.strictEqual(after.allergies, 'clinician allergy byte-for-byte');
assert.strictEqual(after.reason, dirtyBefore.reason);
assert.deepStrictEqual(after.history, dirtyBefore.history);
assert.deepStrictEqual(after.athenaHistoryFactsSnapshot.problems, ['owned problem already absent']);
assert.deepStrictEqual(after.athenaHistoryFactsSnapshot.history, dirtyBefore.athenaHistoryFactsSnapshot.history);
assert.deepStrictEqual(after.athenaHistoryFactsSnapshot.vitals, dirtyBefore.athenaHistoryFactsSnapshot.vitals);
const backup = JSON.parse(cleanupHarness.storage.get(cleanupHarness.backupKey));
assert.strictEqual(backup.length, 1);
assert.deepStrictEqual(backup[0].before, dirtyBefore, 'backup did not round-trip the entire original record');
assert.strictEqual(backup[0].patientId, 'cleanup-target');
assert.strictEqual(backup[0].receiptPatientId, 'different-record');

/* Idempotency: receipt mismatch remains as an audit clue, but there is no
   longer an exact live owned slice, so a second pass writes and backs up zero. */
const callsAfterClean = cleanupHarness.upsertCalls();
const backupAfterClean = cleanupHarness.storage.get(cleanupHarness.backupKey);
const second = cleanupHarness.api.cleanupContamination(cleanupHarness.records()[0]);
assert.strictEqual(second.cleaned, false);
assert.strictEqual(second.reason, 'no-exact-importer-owned-slice');
assert.strictEqual(cleanupHarness.upsertCalls(), callsAfterClean);
assert.strictEqual(cleanupHarness.storage.get(cleanupHarness.backupKey), backupAfterClean);

function assertNoWrite(label, row, options, expectedReason) {
  const before = JSON.stringify([row]);
  const h = makeHarness([row], options);
  const result = h.api.cleanupContamination(h.records()[0]);
  assert.strictEqual(result.cleaned, false, label + ': unexpectedly cleaned');
  assert.strictEqual(h.upsertCalls(), 0, label + ': attempted an upsert');
  assert.strictEqual(JSON.stringify(h.records()), before, label + ': changed the record');
  if (expectedReason) assert.strictEqual(result.reason, expectedReason, label + ': wrong refusal');
  return result;
}

const embedded = provablyOwnedRecord('embedded');
embedded.summary = 'Clinician-authored prefix\n' + embedded.athenaHistorySummary;
assertNoWrite('embedded summary ownership', embedded, {}, 'summary-ownership-ambiguous');

const duplicate = provablyOwnedRecord('duplicate');
duplicate.athenaHistorySummary = '';
duplicate.summary = 'clinician summary';
duplicate.meds = 'wrong imported medication\nwrong imported medication';
assertNoWrite('duplicate owned line', duplicate, {}, 'owned-slice-ambiguous');

const absent = provablyOwnedRecord('absent');
delete absent.athenaHistorySummary;
delete absent.athenaHistoryFactsSnapshot;
assertNoWrite('absent ownership metadata', absent, {}, 'no-exact-importer-owned-slice');

const weakReceipt = provablyOwnedRecord('weak-receipt');
delete weakReceipt.historyImportReceipt.organizedAt;
assertNoWrite('patientId-shaped but unverified receipt', weakReceipt, {}, 'receipt-shape-unverified');

const whitespaceNearMatch = provablyOwnedRecord('whitespace-near-match');
whitespaceNearMatch.athenaHistorySummary = '';
whitespaceNearMatch.summary = 'clinician summary';
whitespaceNearMatch.athenaHistoryFactsSnapshot.meds = [' wrong imported medication '];
assertNoWrite('whitespace-normalized ownership guess', whitespaceNearMatch, {}, 'owned-snapshot-ambiguous');

assertNoWrite('corrupt backup store', provablyOwnedRecord('corrupt-store'), { initialBackupRaw: '{not-json' }, 'backup-store-malformed');
assertNoWrite('backup write failure', provablyOwnedRecord('quota-store'), { setThrows: true }, 'backup-round-trip-failed');
assertNoWrite('backup read failure', provablyOwnedRecord('read-store'), { getThrows: true }, 'backup-round-trip-failed');
assertNoWrite('backup round-trip mismatch', provablyOwnedRecord('roundtrip-store'), { corruptReadAfterWrite: true }, 'backup-round-trip-failed');

/* If the patient upsert partially mutates and then throws, the verified backup
   copy is immediately replayed. The clinical record finishes byte-identical
   and the durable backup remains available. */
const rollbackRow = provablyOwnedRecord('rollback-target');
const rollbackBefore = clone(rollbackRow);
const rollbackHarness = makeHarness([rollbackRow], { failFirstUpsertAfterMutation: true });
const rollback = rollbackHarness.api.cleanupContamination(rollbackHarness.records()[0]);
assert.strictEqual(rollback.cleaned, false);
assert.strictEqual(rollback.writeFailed, true);
assert.strictEqual(rollback.rollbackRestored, true);
assert.strictEqual(rollbackHarness.upsertCalls(), 2, 'failed write did not replay the original');
assert.deepStrictEqual(rollbackHarness.records()[0], rollbackBefore, 'automatic rollback did not restore the original');
const rollbackBackup = JSON.parse(rollbackHarness.storage.get(rollbackHarness.backupKey));
assert.deepStrictEqual(rollbackBackup[0].before, rollbackBefore, 'rollback backup is not the exact original');

/* Receipt identity drift without an id mismatch is explicitly non-resolving. */
const drift = provablyOwnedRecord('drift');
drift.historyImportReceipt.patientId = drift.id;
const driftVerdict = cleanupHarness.api.contaminationVerdict(drift, () => 'new-fingerprint');
assert.strictEqual(driftVerdict.flagged, false);
assert.strictEqual(driftVerdict.basis, 'identity-changed-since-import');

/* Source fence: the exact four-field blanket write and prose decider are gone
   from 1p. Creation of a new blank patient record remains legitimate. */
assert(!source.includes("p.summary = ''; p.meds = ''; p.problems = ''; p.allergies = '';"),
  'the four-field blanket clear returned to 1p');
assert(!source.includes("backup('contam'"), 'the retired prose cleaner still writes its legacy backup');
assert(source.includes('prose authorized 0 writes'), 'the runtime report lost its fail-closed boundary');

console.log('PASS 1p contamination cleaner fail-closed: 39/74 retired false positives exercised, 74/74 healthy records byte-identical, exact importer-owned cleanup backed up and idempotent, ambiguity/storage/write failure all produced zero destructive persistence, rollback restored the exact original');

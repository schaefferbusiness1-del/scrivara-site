'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const importer = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const start = source.indexOf('/* ----------------------------------------------------------------------------\n * 1) VISIT-AWARE DATA MODEL');
const end = source.indexOf('/* ----------------------------------------------------------------------------\n * 2) PER-VISIT PROFILE UI', start);
assert(start >= 0 && end > start, 'visit model source was not found');

function visit(i, patientId) {
  return {
    encounterId: `enc-${i}`,
    date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
    type: 'Office visit',
    source: 'athena-copy',
    identityVerified: true,
    identityBinding: patientId,
    bodyComplete: true,
    fullDetail: true,
    indexOnly: false,
    raw: [
      'Problem List:', `Lumbar diagnosis ${i}`,
      'Medications:', `Medication ${i}`,
      'Allergies:', 'No known allergies',
      'Past Medical History:', `History fact ${i}`,
      'Social History:', 'Never smoker'
    ].join('\n')
  };
}

function harness(options = {}) {
  let account = 'alpha@example.test';
  let token = 'token-a';
  let yields = 0;
  let upserts = 0;
  const patient = {
    id: 'p-1', name: 'Scale Patient', dob: '01/02/1970', updated: 1,
    problems: '', meds: '', allergies: '', history: {}, summary: '',
    visits: Array.from({ length: 80 }, (_, i) => visit(i, 'p-1'))
  };
  let patients = [patient];
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document: { readyState: 'loading', addEventListener() {}, removeEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    getPatients() { return patients; },
    findPatient(id) { return patients.find(row => row.id === id) || null; },
    upsertPatient(row) {
      upserts++;
      if (options.refuseUpsert) return { ok: false, refused: 'stale-lineage' };
      const at = patients.findIndex(item => item.id === row.id);
      if (at >= 0) patients[at] = row; else patients.push(row);
      return { ok: true };
    },
    uns(key) { return `mls::${account}::${key}`; },
    bkToken() { return token; },
    __mlsBgSleep() {
      yields++;
      return new Promise(resolve => setImmediate(() => {
        if (options.onYield) options.onYield({ yields, patient, setAccount: value => { account = value; }, setToken: value => { token = value; } });
        resolve();
      }));
    }
  };
  context.window = context;
  vm.runInNewContext(source.slice(start, end), context, { filename: 'visit-model-responsive.js' });
  return { context, patient, get patients() { return patients; }, get yields() { return yields; }, get upserts() { return upserts; } };
}

function hygieneHarness(saveFactory) {
  const storage = new Map();
  const patient = {
    id: 'hygiene-1', name: 'Retry Patient', dob: '01/02/1970', updated: 1,
    summary: 'Longitudinal summary refreshed 08/08/2026 -',
    athenaHistorySummary: 'Pulled from Athena 08/08/2026 -',
    visits: [{ id: 'visit-1', aiSummary: '', raw: 'Clinical body remains intact' }]
  };
  let saveRows = null, yields = 0;
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document: { readyState: 'loading', addEventListener() {}, removeEventListener() {}, getElementById() { return null; } },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    getPatients() { return [patient]; }, findPatient() { return patient; }, upsertPatient() { return { ok: true }; },
    uns(key) { return `mls::hygiene@example.test::${key}`; }, bkToken() { return 'hygiene-token'; },
    savePatients(rows, key, opts) { saveRows = rows; return saveFactory(rows, key, opts); }
  };
  context.__mlsMaintenancePersist = {
    capture() { return { key: context.uns('patients'), account: 'hygiene@example.test', token: 'hygiene-token', raw: null }; },
    scan(options) {
      return Promise.resolve().then(async () => {
        const sourceRows = context.getPatients(), rows = sourceRows.slice(), dirty = [];
        for (let i = 0; i < sourceRows.length; i++) {
          const prepared = await options.prepare(sourceRows[i], i, sourceRows, () => { yields++; return Promise.resolve(true); });
          if (prepared && typeof prepared === 'object') { rows[i] = prepared; dirty.push(prepared); }
        }
        if (!dirty.length) {
          if (options.onEmpty) options.onEmpty({ saved: false, empty: true }, rows);
          return { saved: false, empty: true, rows };
        }
        saveRows = rows;
        let receipt;
        try {
          const result = saveFactory(rows, context.uns('patients'), { cooperative: true, isCurrent() { return true; } });
          if (!result || typeof result.then !== 'function') throw new Error('cooperative save unavailable');
          receipt = await result;
          if (!receipt || (receipt.saved !== true && receipt.identical !== true)) throw new Error('unverified save receipt');
        } catch (error) {
          if (options.onFailed) options.onFailed(error, rows);
          return { saved: false, error };
        }
        if (options.onSaved) options.onSaved(receipt, rows);
        return receipt;
      });
    }
  };
  context.window = context;
  vm.runInNewContext(source.slice(start, end), context, { filename: 'visit-model-hygiene.js' });
  return { context, patient, storage, get saveRows() { return saveRows; }, get yields() { return yields; } };
}

async function main() {
  const h = harness();
  const receipt = await h.context.__mlsVisitModel.organizePatientHistoryResponsive('p-1');
  assert.strictEqual(receipt.ok, true, 'responsive history organization did not complete');
  assert(h.yields >= 41, `80 visits were not split into two-row tasks (only ${h.yields} yields)`);
  assert.strictEqual(h.upserts, 1, 'responsive organization did not preserve the one-commit contract');
  assert(/Lumbar diagnosis 79/.test(h.patients[0].problems), 'responsive organization changed the clinical output');

  const accountRace = harness({ onYield({ yields, setAccount }) { if (yields === 3) setAccount('beta@example.test'); } });
  const accountReceipt = await accountRace.context.__mlsVisitModel.organizePatientHistoryResponsive('p-1');
  assert.strictEqual(accountReceipt.stale, true, 'account switch did not invalidate responsive organization');
  assert.strictEqual(accountRace.upserts, 0, 'old-account history committed after an account switch');

  const sourceRace = harness({ onYield({ yields, patient }) { if (yields === 3) patient.visits[0].raw += '\nPlan: changed while organizing'; } });
  const sourceReceipt = await sourceRace.context.__mlsVisitModel.organizePatientHistoryResponsive('p-1');
  assert.strictEqual(sourceReceipt.stale, true, 'mid-flight source mutation was not detected');
  assert.strictEqual(sourceRace.upserts, 0, 'stale derived facts committed after source mutation');

  const filteredRace = harness({ onYield({ yields, patient }) {
    if (yields === 3) patient.visits.find(row => row && row.indexOnly !== true).raw += '\nPlan: eligible body changed outside the raw top 80';
  } });
  filteredRace.patient.visits = Array.from({ length: 80 }, (_, i) => ({
    encounterId: `index-${i}`, date: `2027-${String(12 - Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    source: 'athena-index', identityVerified: true, identityBinding: 'p-1', indexOnly: true, raw: `Index shell ${i}`
  })).concat(filteredRace.patient.visits);
  const filteredReceipt = await filteredRace.context.__mlsVisitModel.organizePatientHistoryResponsive('p-1');
  assert.strictEqual(filteredReceipt.stale, true, 'an eligible body outside the first 80 raw rows escaped the source fence');
  assert.strictEqual(filteredRace.upserts, 0, 'an out-of-fence eligible source mutation committed stale facts');

  const refused = harness({ refuseUpsert: true });
  const refusedReceipt = await refused.context.__mlsVisitModel.organizePatientHistoryResponsive('p-1');
  assert.strictEqual(refusedReceipt.ok, false, 'an explicitly refused history commit reported success');
  assert.strictEqual(refusedReceipt.reason, 'commit-refused', 'history commit refusal lost its exact reason');
  assert.strictEqual(refused.patient.problems || '', '', 'a refused responsive commit mutated the canonical patient alias');

  const rejectedHygiene = hygieneHarness(() => Promise.reject(new Error('worker failed')));
  rejectedHygiene.context.__mlsVisitModel._storeHygieneOnce();
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert(/Longitudinal summary refreshed/.test(rejectedHygiene.patient.summary), 'failed hygiene mutated the memo-backed summary before durability');
  assert(Object.prototype.hasOwnProperty.call(rejectedHygiene.patient.visits[0], 'aiSummary'), 'failed hygiene mutated a memo-backed visit before durability');
  assert.strictEqual(rejectedHygiene.storage.get('mls::hygiene@example.test::mlsPxHygiene1'), undefined, 'failed hygiene consumed its retry flag');

  const syncHygiene = hygieneHarness(() => undefined);
  syncHygiene.context.__mlsVisitModel._storeHygieneOnce();
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert(/Longitudinal summary refreshed/.test(syncHygiene.patient.summary), 'legacy synchronous hygiene mutated the canonical row');
  assert(Object.prototype.hasOwnProperty.call(syncHygiene.patient.visits[0], 'aiSummary'), 'legacy synchronous hygiene mutated the canonical visit');
  assert.strictEqual(syncHygiene.storage.get('mls::hygiene@example.test::mlsPxHygiene1'), undefined, 'legacy synchronous hygiene consumed its retry flag');
  assert(syncHygiene.saveRows && syncHygiene.saveRows[0] !== syncHygiene.patient && !Object.prototype.hasOwnProperty.call(syncHygiene.saveRows[0].visits[0], 'aiSummary'),
    'hygiene did not build its repair on a detached copy-on-write snapshot');

  assert(importer.includes('__mlsResponsiveOrganization:true') &&
    importer.includes('await window.__mlsVisitModel.organizePatientHistoryResponsive(target.patientId)'),
    'the managed history pull does not await the responsive organizer');
  const hygieneStart = source.indexOf('function _storeHygieneOnce()');
  const hygieneEnd = source.indexOf('window.__mlsVisitModel = {', hygieneStart);
  const hygiene = source.slice(hygieneStart, hygieneEnd);
  assert(hygiene.includes('queue.capture()') && (hygiene.match(/queue\.scan\(/g) || []).length >= 2 &&
    hygiene.includes('chunkSize:24') && hygiene.includes('yieldWork'),
    'automatic visit hygiene lost its bounded shared census/repair scans');
  assert(!hygiene.includes('window.savePatients(pts);'),
    'automatic visit hygiene can still synchronously encode the full roster');

  console.log('PASS responsive history organization: exact eligible-source fence, two-row yields, one verified commit, and retry-safe hygiene');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

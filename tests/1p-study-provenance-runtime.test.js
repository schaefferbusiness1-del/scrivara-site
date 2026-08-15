'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const api = require(path.join(__dirname, '..', '1p-feat_mls_study_provenance.js'));
const realStudy = require(path.join(__dirname, '..', 'feat_mls_study_request.js'));

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function baseSpec(range, type) {
  return {
    ok: true,
    version: 2,
    studyType: type || 'custom',
    cohort: { mode: 'all', keywords: [] },
    range: range || { kind: 'all' },
    targetPages: 12,
    directIdentifiersRemoved: true,
    limitedDataDraft: true,
    includeIdentifiers: false
  };
}

function fixture(options) {
  options = options || {};
  const visits = options.visits || [
    { date: '2026-01', type: 'Office', detail: 'documented pain 7/10', source: 'patient-record' },
    { date: '2026-02', type: 'Procedure', detail: 'epidural documented', source: 'athena-history' },
    { date: '', type: 'Imported', detail: 'undated documentation', source: 'Patient Jane Doe private source' }
  ];
  const patients = options.patients || [
    { code: 'P001', name: 'P001', ageYears: 45, visits: visits.slice(0, 2) },
    { code: 'P002', name: 'P002', ageYears: null, visits: visits.slice(2) }
  ];
  const allVisits = patients.flatMap((p) => p.visits || []);
  const provenance = {};
  allVisits.forEach((v) => { provenance[v.source] = (provenance[v.source] || 0) + 1; });
  const spec = options.spec || baseSpec(options.range, options.type);
  const included = options.included == null ? allVisits.length : options.included;
  const patientCount = options.patientCount == null ? patients.length : options.patientCount;
  return {
    spec,
    scoped: {
      patientCount,
      visitCount: included,
      scope: {
        rangeLabel: spec.range.kind === 'all' ? 'All stored dates' : 'bounded',
        fromMonth: options.fromMonth || (spec.range.from || '').slice(0, 7),
        toMonth: options.toMonth || (spec.range.to || '').slice(0, 7),
        excludedUndated: options.excludedUndated || 0,
        excludedOutOfRange: options.excludedOutOfRange || 0
      }
    },
    limitedDataPatients: patients,
    model: {
      generatedAt: '2026-08-15T12:00:00.000Z',
      patientCount: options.modelPatientCount == null ? patientCount : options.modelPatientCount,
      visitCount: options.modelVisitCount == null ? included : options.modelVisitCount,
      provenance: options.provenance || provenance,
      sections: [
        { key: 'methods', heading: 'Methods', paragraphs: ['stored evidence'] },
        { key: 'stat-methods', heading: 'Statistical methods', paragraphs: ['deterministic'] }
      ],
      limitations: options.limitations || [
        '2 duplicate visit records were removed before analysis.',
        '1 record without a unique stable-ID or exact unique name+DOB match was excluded to prevent cross-patient mixing.',
        '3 records with conflicting namespace-qualified identifiers were excluded for identity safety.'
      ]
    },
    engineResult: { engine: '__mlsStudyGroups.analyze/chartSVG', inMemory: true }
  };
}

class MemoryStorage {
  constructor() { this.map = new Map(); this.writes = 0; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.writes++; this.map.set(key, String(value)); }
}

class FakeJsPDF {
  constructor() {
    this.pages = 1;
    this.internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
  }
  setTextColor() {}
  setFontSize() {}
  setFont() {}
  text() {}
  splitTextToSize(value) {
    const text = String(value), lines = [];
    for (let i = 0; i < text.length; i += 85) lines.push(text.slice(i, i + 85));
    return lines.length ? lines : [''];
  }
  addPage() { this.pages += 1; }
  getNumberOfPages() { return this.pages; }
  setPage() {}
  output() { return new Blob(['fake-pdf'], { type: 'application/pdf' }); }
}

(async function run() {
  assert.strictEqual(api.version, 'p1sp-1.0.0');

  const browserSource = fs.readFileSync(path.join(__dirname, '..', '1p-feat_mls_study_provenance.js'), 'utf8');
  let regularReverts = 0;
  const regularOwner = { installed: true, revert() { regularReverts++; } };
  const regularWindow = { document: {}, __mlsP1StudyProvenance: regularOwner };
  vm.runInNewContext(browserSource, { window: regularWindow, globalThis: regularWindow, console, setTimeout, clearTimeout, setInterval, clearInterval });
  assert.strictEqual(regularReverts, 0, 'regular-site execution retired a live study owner');
  assert.strictEqual(regularWindow.__mlsP1StudyProvenance, regularOwner, 'regular-site execution installed the P1 provenance layer');

  const june = api.parseExplicitRange('procedure counts in June 2026', { now: new Date('2026-08-15T12:00:00Z') });
  assert.deepStrictEqual(june.range, { kind: 'dates', from: '2026-06-01', to: '2026-06-30', requestedKind: 'month' });
  const leap = api.parseExplicitRange('study month 2024-02', { now: new Date('2026-08-15T12:00:00Z') });
  assert.strictEqual(leap.range.to, '2024-02-29');
  const year = api.parseExplicitRange('age profile for year 2025', { now: new Date('2026-08-15T12:00:00Z') });
  assert.deepStrictEqual(year.range, { kind: 'dates', from: '2025-01-01', to: '2025-12-31', requestedKind: 'year' });
  const currentYear = api.parseExplicitRange('outcomes during 2026', { now: new Date('2026-08-15T12:00:00Z') });
  assert.strictEqual(currentYear.range.to, '2026-08-15', 'current year must stop at Today, not include future days');
  const custom = api.parseExplicitRange('from 2026-03-01 through 2026-04-20', { now: new Date('2026-08-15T12:00:00Z') });
  assert.strictEqual(custom.requestedKind, 'custom');
  assert.strictEqual(custom.range.from, '2026-03-01');
  assert.strictEqual(api.parseExplicitRange('during 2027', { now: new Date('2026-08-15T12:00:00Z') }).code, 'future-range');
  assert.strictEqual(api.parseExplicitRange('from 2026-01-01 through 2027-01-01', { now: new Date('2026-08-15T12:00:00Z') }).code, 'future-range');

  const upgraded = api.upgradedSpec('procedure volume in June 2026', () => baseSpec({ kind: 'all' }, 'volume'), { now: new Date('2026-08-15T12:00:00Z') });
  assert.strictEqual(upgraded.range.requestedKind, 'month');
  assert.strictEqual(upgraded.range.to, '2026-06-30');

  const result = fixture();
  const receipt = api.buildReceipt(result);
  assert.strictEqual(receipt.status, 'verified-stored-scope');
  assert.strictEqual(receipt.counts.includedRecords, 3);
  assert.strictEqual(receipt.counts.includedDatedRecords, 2);
  assert.strictEqual(receipt.counts.includedUndatedRecords, 1, 'all-time undated evidence must be counted explicitly');
  assert.strictEqual(receipt.counts.exactDuplicatesRemoved, 2);
  assert.strictEqual(receipt.counts.ambiguousIdentityRowsExcluded, 1);
  assert.strictEqual(receipt.counts.conflictingIdentityRowsExcluded, 3);
  assert.strictEqual(receipt.counts.ageKnownPatients, 1);
  assert.strictEqual(receipt.wholePracticeCoverageProven, false);
  assert.match(receipt.dataMeaning, /records presently stored in connected MLS sources/i);
  assert.match(receipt.dataMeaning, /not a complete EHR or whole-practice history/i);
  assert.deepStrictEqual(receipt.sourceModes, [
    { mode: 'athena-derived', count: 1 },
    { mode: 'other-stored', count: 1 },
    { mode: 'patient-record', count: 1 }
  ]);
  assert.deepStrictEqual(Object.keys(receipt.analysisBases).sort(), ['age', 'count', 'diagnosis', 'incremental', 'outcome', 'procedure']);
  assert.match(receipt.analysisBases.procedure, /do not by themselves prove performance, billing/i);
  assert.match(receipt.analysisBases.outcome, /not causal effects/i);
  const serializedReceipt = JSON.stringify(receipt);
  assert(!serializedReceipt.includes('Jane Doe'), 'raw/user-controlled source text leaked into the PHI-free receipt');
  assert(!serializedReceipt.includes('P001') && !serializedReceipt.includes('P002'), 'coded patient rows leaked into the aggregate receipt');

  assert.throws(() => api.buildReceipt(fixture({ modelVisitCount: 99 })), (e) => e.code === 'coverage-count-mismatch');
  assert.throws(() => api.buildReceipt(fixture({ provenance: { 'patient-record': 1 } })), (e) => e.code === 'coverage-source-mismatch');
  assert.throws(() => api.buildReceipt(Object.assign(fixture(), { engineResult: { engine: 'unknown', inMemory: true } })), (e) => e.code === 'coverage-engine-unverified');
  const missingExclusionProof = fixture();
  delete missingExclusionProof.scoped.scope.excludedUndated;
  assert.throws(() => api.buildReceipt(missingExclusionProof), (e) => e.code === 'coverage-exclusions-missing');
  const boundedWithUndated = fixture({
    range: { kind: 'dates', from: '2026-01-01', to: '2026-12-31', requestedKind: 'year' },
    fromMonth: '2026-01', toMonth: '2026-12'
  });
  assert.throws(() => api.buildReceipt(boundedWithUndated), (e) => e.code === 'coverage-undated-in-range');
  const monthWindowLeak = fixture({
    spec: baseSpec({ kind: 'month-window', fromMonth: '2026-06', toMonth: '2026-06' }, 'volume'),
    fromMonth: '2026-06', toMonth: '2026-06',
    patients: [{ code: 'P001', name: 'P001', ageYears: 45, visits: [
      { date: '2026-05', type: 'Office', detail: 'wrong month', source: 'patient-record' }
    ] }]
  });
  assert.throws(() => api.buildReceipt(monthWindowLeak), (e) => e.code === 'coverage-out-of-range-included');
  const datedOnly = fixture({
    range: { kind: 'dates', from: '2026-01-01', to: '2026-06-30', requestedKind: 'custom' },
    fromMonth: '2026-01', toMonth: '2026-06', excludedUndated: 4, excludedOutOfRange: 7,
    patients: [{ code: 'P001', name: 'P001', ageYears: 45, visits: [
      { date: '2026-02', type: 'Office', detail: 'documented', source: 'patient-record' }
    ] }]
  });
  const datedReceipt = api.buildReceipt(datedOnly);
  assert.strictEqual(datedReceipt.counts.includedRecords, 1);
  assert.strictEqual(datedReceipt.counts.excludedUndatedRecords, 4);
  assert.strictEqual(datedReceipt.counts.excludedOutOfRangeRecords, 7);
  assert.strictEqual(datedReceipt.range.kind, 'custom');

  // Integration proof: accept the real study engine's public result shape and
  // preserve its exact scope accounting rather than depending on a test-only API.
  const realSpec = realStudy.parseStudySpec('Study outcomes for all stored patients from 2026-06-01 through 2026-06-30');
  const realRecords = {
    patients: [{ name: 'Integration Patient', dob: '1980-02-03', mrn: 'PRIVATE-77', sex: 'F', meds: [], allergies: [], problems: '', visits: [
      { date: '2026-06-10', type: 'Office', detail: 'documented pain 7/10', source: 'patient-record' },
      { date: '', type: 'Imported', detail: 'undated item', source: 'manual' },
      { date: '2025-12-01', type: 'Old', detail: 'older item', source: 'athena-history' }
    ] }],
    provenance: { sources: { 'patient-record': 1, manual: 1, 'athena-history': 1 }, visits: 3, undated: 1,
      duplicateVisitsRemoved: 0, ambiguousRecordsSkipped: 0, identityConflicts: 0 }
  };
  const sg = {
    __live: true,
    analyze(group) {
      const allVisits = group.patients.flatMap((p) => p.visits.map((v) => ({ pt: p, v })));
      return { patientCount: group.patients.length, visitCount: allVisits.length, patients: group.patients,
        allVisits, months: [], byMonth: {}, byType: {}, pain: [], avgVisits: allVisits.length / group.patients.length };
    },
    chartSVG() { return '<svg></svg>'; },
    get() { return null; }
  };
  const realResult = await realStudy.executeSpec(realSpec, {
    sg, records: realRecords, now: new Date('2026-08-15T12:00:00Z'), jsPDF: FakeJsPDF
  });
  const realReceipt = api.buildReceipt(realResult);
  assert.strictEqual(realReceipt.counts.includedRecords, 1);
  assert.strictEqual(realReceipt.counts.excludedUndatedRecords, 1);
  assert.strictEqual(realReceipt.counts.excludedOutOfRangeRecords, 1);
  assert(!JSON.stringify(realReceipt).includes('Integration Patient') && !JSON.stringify(realReceipt).includes('PRIVATE-77'));

  const storage = new MemoryStorage();
  const env = { localStorage: storage, uns: (name) => 'acct-hash::' + name };
  const first = api.persistReceipt(clone(datedReceipt), env);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.receipt.incremental.status, 'first-observed-snapshot');
  const nextResult = fixture({
    range: { kind: 'dates', from: '2026-01-01', to: '2026-06-30', requestedKind: 'custom' },
    fromMonth: '2026-01', toMonth: '2026-06', excludedUndated: 4, excludedOutOfRange: 7,
    patients: [{ code: 'P001', name: 'P001', ageYears: 45, visits: [
      { date: '2026-02', type: 'Office', detail: 'one', source: 'patient-record' },
      { date: '2026-03', type: 'Office', detail: 'two', source: 'patient-record' }
    ] }]
  });
  const nextReceipt = api.buildReceipt(nextResult);
  const second = api.persistReceipt(nextReceipt, env);
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.receipt.incremental.status, 'compared-with-prior-receipt');
  assert.strictEqual(second.receipt.incremental.includedRecordDelta, 1);
  const stored = storage.getItem('acct-hash::p1StudyCoverageReceiptsV1');
  assert(stored && !stored.includes('Jane Doe') && !stored.includes('P001'), 'durable receipt contains patient identity data');
  assert(JSON.parse(stored).checksum, 'durable receipt envelope has no verification checksum');

  const unscopedStorage = new MemoryStorage();
  const unscoped = api.persistReceipt(clone(receipt), { localStorage: unscopedStorage, uns: (name) => name });
  assert.strictEqual(unscoped.ok, false, 'an unscoped storage key must fail closed');
  assert.strictEqual(unscopedStorage.writes, 0);
  const fixedScopeStorage = new MemoryStorage();
  const fixedScope = api.persistReceipt(clone(receipt), { localStorage: fixedScopeStorage, uns: () => 'one-shared-key' });
  assert.strictEqual(fixedScope.ok, false, 'a constant pseudo-namespace must fail closed');
  assert.strictEqual(fixedScopeStorage.writes, 0);
  const signedOutStorage = new MemoryStorage();
  const signedOut = api.persistReceipt(clone(receipt), {
    localStorage: signedOutStorage, uns: (name) => 'sf_u::_::' + name
  });
  assert.strictEqual(signedOut.ok, false, 'signed-out receipts must not share the anonymous namespace');
  assert.strictEqual(signedOutStorage.writes, 0);
  const corruptStorage = new MemoryStorage();
  corruptStorage.setItem('acct-hash::p1StudyCoverageReceiptsV1', '{"version":9,"receipts":[]}');
  const beforeCorrupt = corruptStorage.getItem('acct-hash::p1StudyCoverageReceiptsV1');
  const corrupt = api.persistReceipt(clone(receipt), { localStorage: corruptStorage, uns: (name) => 'acct-hash::' + name });
  assert.strictEqual(corrupt.ok, false);
  assert.strictEqual(corrupt.reason, 'existing-manifest-unverified');
  assert.strictEqual(corruptStorage.getItem('acct-hash::p1StudyCoverageReceiptsV1'), beforeCorrupt, 'corrupt receipt store was overwritten');
  const tamperedStorage = new MemoryStorage();
  tamperedStorage.setItem('acct-hash::p1StudyCoverageReceiptsV1', '{"version":1,"receipts":[],"checksum":"00000000"}');
  const beforeTampered = tamperedStorage.getItem('acct-hash::p1StudyCoverageReceiptsV1');
  const tampered = api.persistReceipt(clone(receipt), { localStorage: tamperedStorage, uns: (name) => 'acct-hash::' + name });
  assert.strictEqual(tampered.ok, false);
  assert.strictEqual(tampered.reason, 'existing-manifest-unverified');
  assert.strictEqual(tamperedStorage.getItem('acct-hash::p1StudyCoverageReceiptsV1'), beforeTampered, 'bad-checksum receipt store was overwritten');
  const quota = api.persistReceipt(clone(receipt), {
    localStorage: { getItem() { return null; }, setItem() { throw new Error('QuotaExceededError: PRIVATE PATIENT'); } },
    uns: (name) => 'acct-hash::' + name
  });
  assert.strictEqual(quota.ok, false);
  assert.strictEqual(quota.reason, 'manifest-write-failed');
  assert(!JSON.stringify(quota).includes('PRIVATE PATIENT'), 'browser exception text leaked into the persistence receipt');

  let capturedSpec = null;
  const engineStorage = new MemoryStorage();
  const engine = {
    parseStudySpec: () => baseSpec({ kind: 'all' }, 'procedure'),
    run: (spec) => { capturedSpec = spec; return Promise.resolve(fixture({
      spec,
      patients: [{ code: 'P001', name: 'P001', ageYears: 45, visits: [
        { date: '2026-06', type: 'Procedure', detail: 'documented', source: 'athena-history' }
      ] }],
      fromMonth: '2026-06', toMonth: '2026-06'
    })); },
    runFromUi: () => Promise.resolve(null),
    executeSpec: () => Promise.resolve(null),
    shouldSubmitKey: () => false
  };
  assert.strictEqual(api.installEngine(engine), true);
  const wrapped = await engine.run('procedure count in June 2026', {
    now: new Date('2026-08-15T12:00:00Z'),
    env: { localStorage: engineStorage, uns: (name) => 'acct-hash::' + name }
  });
  assert.strictEqual(capturedSpec.range.from, '2026-06-01');
  assert.strictEqual(capturedSpec.range.to, '2026-06-30');
  assert.strictEqual(wrapped.p1CoverageVerified, true);
  assert(wrapped.model.sections.some((section) => section.key === 'p1-coverage-provenance'), 'report model lacks embedded coverage section');
  assert(wrapped.p1CoverageCsvBlob, 'coverage CSV export was not attached');

  let activeAccount = 'doctor-a@example.test';
  let resolveLate;
  const switchedStorage = new MemoryStorage();
  const switchedEnv = {
    localStorage: switchedStorage,
    get __mlsSessionAccount() { return activeAccount; },
    __mlsSessionEpoch: 1,
    uns(name) { return 'sf_u::' + activeAccount + '::' + name; }
  };
  const lateEngine = {
    parseStudySpec: () => baseSpec({ kind: 'all' }, 'procedure'),
    run: () => new Promise((resolve) => { resolveLate = resolve; }),
    runFromUi: () => Promise.resolve(null),
    executeSpec: () => Promise.resolve(null),
    shouldSubmitKey: () => false
  };
  assert.strictEqual(api.installEngine(lateEngine), true);
  const late = lateEngine.run('procedure count', { env: switchedEnv });
  activeAccount = 'doctor-b@example.test'; switchedEnv.__mlsSessionEpoch = 2;
  resolveLate(fixture());
  await assert.rejects(late, (error) => error && error.code === 'coverage-session-changed');
  assert.strictEqual(switchedStorage.writes, 0, 'an old-account result wrote a receipt into the new account namespace');

  console.log('PASS /p1 study provenance: month/year/custom ranges, explicit included/excluded/undated/source coverage, PHI-free durable incremental receipts, export embedding, and fail-closed reconciliation');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

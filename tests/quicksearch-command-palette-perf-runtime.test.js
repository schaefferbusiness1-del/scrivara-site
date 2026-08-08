'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const quickSource = fs.readFileSync(path.join(root, 'feat_patient_quicksearch.js'), 'utf8');
const paletteSource = fs.readFileSync(path.join(root, 'feat_mls_command_palette.js'), 'utf8');

function load(file, source, state) {
  let rosterIdentity = null;
  let rosterIdentityKey = '';
  const document = {
    readyState: 'loading',
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; }
  };
  const window = {
    uns(suffix) { return 'sf_u::' + (state.account || 'search-perf@example.test') + '::' + suffix; },
    getPatients() {
      state.reads++;
      const snapshot = state.patients.slice();
      if (state.stamped) Object.defineProperty(snapshot, '__mlsReadGen', { value: state.generation });
      return snapshot;
    },
    getNotes() { return []; },
    addEventListener() {},
    removeEventListener() {}
  };
  if (state.rosterProof) {
    window.__mlsPtRosterData = function () {
      state.rosterProofReads = (state.rosterProofReads || 0) + 1;
      const batchOpen = !!state.batchOpen;
      const identityKey = window.uns('patients') + '|raw:' + Number(state.rawGeneration || 0) +
        '|batch:' + (batchOpen ? Number(state.batchChanges || 0) : -1) +
        '|external:' + (batchOpen ? Number(state.externalWrites || 0) : -1);
      if (!rosterIdentity || rosterIdentityKey !== identityKey) {
        rosterIdentity = { identityKey };
        rosterIdentityKey = identityKey;
      }
      return rosterIdentity;
    };
  }
  if (state.storeProof) {
    window.__mlsStoreCache = {
      verFor(fullKey) {
        state.storeProofReads = (state.storeProofReads || 0) + 1;
        assert.strictEqual(fullKey, window.uns('patients'), file + ' requested a non-patient store generation');
        return state.storeVersion;
      }
    };
  }
  vm.runInNewContext(source, {
    window, document,
    location: { origin: 'https://search-perf.example.test' },
    setTimeout() { return 1; },
    clearTimeout() {}
  }, { filename: file });
  return file === 'feat_patient_quicksearch.js' ? window.__mlsPatientQuickSearch : window.__mlsCmdPalette;
}

function countedPatient() {
  const counts = { name: 0, dob: 0, mrn: 0 };
  const values = { name: 'Alpha Patient', dob: '1970-01-01', mrn: 'MRN-ALPHA' };
  const patient = { id: 'counted' };
  Object.defineProperties(patient, {
    name: { get() { counts.name++; return values.name; } },
    dob: { get() { counts.dob++; return values.dob; } },
    mrn: { get() { counts.mrn++; return values.mrn; } }
  });
  return { patient, counts, values };
}

/* A partial boot may lack the shared roster helper. Its fallback must combine
   both getPatients()' read generation and the exact account-scoped patients
   key generation. Neither signal alone is sufficient. */
for (const spec of [
  { file: 'feat_patient_quicksearch.js', source: quickSource, query: 'alpha', fields: ['name', 'dob'] },
  { file: 'feat_mls_command_palette.js', source: paletteSource, query: 'alpha', fields: ['name', 'dob', 'mrn'] }
]) {
  const counted = countedPatient();
  const state = {
    patients: [counted.patient], reads: 0, generation: 11, stamped: true,
    rosterProof: false, storeProof: true, storeVersion: 'scoped:patients:1'
  };
  const api = load(spec.file, spec.source, state);

  api._search(spec.query);
  assert.strictEqual(state.reads, 1, spec.file + ' did not take exactly one first snapshot');
  const first = Object.assign({}, counted.counts);

  api._search('1970');
  assert.strictEqual(state.reads, 2, spec.file + ' did not take exactly one repeat snapshot');
  for (const field of spec.fields) {
    assert.strictEqual(counted.counts[field], first[field], spec.file + ' renormalized ' + field + ' within one generation');
  }

  state.generation = 12;
  api._search(spec.query);
  for (const field of spec.fields) {
    assert.strictEqual(counted.counts[field], first[field] + 1, spec.file + ' did not invalidate ' + field + ' at the next generation');
  }

  state.storeVersion = 'scoped:patients:2';
  api._search(spec.query);
  for (const field of spec.fields) {
    assert.strictEqual(counted.counts[field], first[field] + 2, spec.file + ' ignored the exact patients-key generation');
  }

  state.account = 'second-account@example.test';
  api._search(spec.query);
  for (const field of spec.fields) {
    assert.strictEqual(counted.counts[field], first[field] + 3, spec.file + ' reused normalized PHI across accounts');
  }

  state.stamped = false;
  api._search(spec.query);
  api._search(spec.query);
  for (const field of spec.fields) {
    assert.strictEqual(counted.counts[field], first[field] + 5, spec.file + ' cached ' + field + ' without a complete fallback proof');
  }
  assert.strictEqual(state.reads, 7, spec.file + ' performed a duplicate patient read inside search');
}

/* Production uses __mlsPtRosterData(snapshot)'s object identity. Prove the
   normalized cache follows every invalidator that helper owns even while the
   snapshot's __mlsReadGen remains unchanged: raw writes, both open-batch
   counters, and account changes. */
for (const spec of [
  { file: 'feat_patient_quicksearch.js', source: quickSource },
  { file: 'feat_mls_command_palette.js', source: paletteSource }
]) {
  const counted = countedPatient();
  const state = {
    patients: [counted.patient], reads: 0, generation: 51, stamped: true,
    rosterProof: true, rawGeneration: 1, batchOpen: false, batchChanges: 0,
    externalWrites: 0, account: 'first-account@example.test'
  };
  const api = load(spec.file, spec.source, state);

  assert.strictEqual(Array.from(spec.file === 'feat_patient_quicksearch.js' ? api._search('alpha') : api._search('alpha').patients,
    x => (x.p || x).id)[0], 'counted', spec.file + ' primary roster proof lost the initial patient');
  const first = Object.assign({}, counted.counts);
  api._search('alpha');
  assert.deepStrictEqual(counted.counts, first, spec.file + ' did not reuse a stable roster identity');

  counted.values.name = 'Raw Generation Patient';
  state.rawGeneration++;
  assert.strictEqual(Array.from(spec.file === 'feat_patient_quicksearch.js' ? api._search('raw generation') : api._search('raw generation').patients,
    x => (x.p || x).id)[0], 'counted', spec.file + ' stayed stale after a raw roster generation');

  state.batchOpen = true;
  state.batchChanges++;
  counted.values.name = 'Open Batch Patient';
  assert.strictEqual(Array.from(spec.file === 'feat_patient_quicksearch.js' ? api._search('open batch') : api._search('open batch').patients,
    x => (x.p || x).id)[0], 'counted', spec.file + ' stayed stale after open-batch totalChanges');

  state.externalWrites++;
  counted.values.name = 'External Batch Patient';
  assert.strictEqual(Array.from(spec.file === 'feat_patient_quicksearch.js' ? api._search('external batch') : api._search('external batch').patients,
    x => (x.p || x).id)[0], 'counted', spec.file + ' stayed stale after open-batch externalWrites');

  state.account = 'second-account@example.test';
  state.patients = [{ id: 'account-b', name: 'Second Account Patient', dob: '1988-08-08', mrn: 'B-2' }];
  assert.strictEqual(Array.from(spec.file === 'feat_patient_quicksearch.js' ? api._search('second account') : api._search('second account').patients,
    x => (x.p || x).id)[0], 'account-b', spec.file + ' exposed the prior account cache after account change');
  assert.strictEqual(state.reads, 6, spec.file + ' did not preserve one patient snapshot per search');
}

/* With neither roster identity nor a complete exact-key fallback, the cache
   must fail open and renormalize every search. */
for (const spec of [
  { file: 'feat_patient_quicksearch.js', source: quickSource, fields: ['name', 'dob'] },
  { file: 'feat_mls_command_palette.js', source: paletteSource, fields: ['name', 'dob', 'mrn'] }
]) {
  const counted = countedPatient();
  const state = { patients: [counted.patient], reads: 0, generation: 71, stamped: false };
  const api = load(spec.file, spec.source, state);
  api._search('alpha');
  const first = Object.assign({}, counted.counts);
  api._search('alpha');
  for (const field of spec.fields) {
    assert.strictEqual(counted.counts[field], first[field] + 1, spec.file + ' cached ' + field + ' with no freshness proof');
  }
  assert.strictEqual(state.reads, 2, spec.file + ' performed a duplicate read in fail-open mode');
}

function patients1500() {
  const first = ['Anna', 'John', 'Zoe', 'Margaret', 'Lee', 'Chris', 'Alex', 'Pat', 'Sam', 'Taylor'];
  const last = ['Smith', 'Jones', "O'Neil", 'Brown', 'Anderson', 'Smith', 'Zimmer', 'Clark', 'Davis', 'Evans'];
  const rows = Array.from({ length: 1500 }, (_, i) => ({
    id: 'p' + i,
    name: first[i % first.length] + ' ' + last[(i * 7) % last.length],
    dob: String(1960 + i % 55) + '-' + String(1 + i % 12).padStart(2, '0') + '-' + String(1 + i % 28).padStart(2, '0'),
    mrn: 'MRN-' + String(i).padStart(5, '0')
  }));
  rows.push({ id: 'same-a', name: 'Same Name', dob: '1970-01-01', mrn: 'DUP' });
  rows.push({ id: 'same-b', name: 'Same Name', dob: '1970-01-01', mrn: 'DUP' });
  return rows;
}

const largePatients = patients1500();

{
  const state = { patients: largePatients, reads: 0, generation: 21, stamped: true, rosterProof: true, rawGeneration: 1 };
  const api = load('feat_patient_quicksearch.js', quickSource, state);
  for (const query of ['ann', 'smith', 'an sm', '0101', '1970', 'same name']) {
    const expected = largePatients.map((p, i) => ({ p, s: api._score(p, query), i }))
      .filter(x => x.s > 0)
      .sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        const an = String(a.p.name || '').toLowerCase(), bn = String(b.p.name || '').toLowerCase();
        if (an < bn) return -1;
        if (an > bn) return 1;
        return a.i - b.i;
      })
      .slice(0, 8).map(x => x.p.id);
    const actual = Array.from(api._search(query), p => p.id);
    assert.deepStrictEqual(actual, expected, 'quicksearch bounded top-8 changed order for ' + query);
  }
}

function paletteScore(hay, query) {
  hay = String(hay).toLowerCase(); query = String(query).toLowerCase();
  if (!query) return 1;
  const idx = hay.indexOf(query);
  if (idx === 0) return 100;
  if (idx > 0) return 60 - Math.min(40, idx);
  return query.split(/\s+/).every(word => hay.indexOf(word) >= 0) ? 30 : 0;
}

{
  const state = { patients: largePatients, reads: 0, generation: 31, stamped: true, rosterProof: true, rawGeneration: 1 };
  const api = load('feat_mls_command_palette.js', paletteSource, state);
  for (const query of ['', 'ann', 'MRN-00', '1970', 'smith jones', 'same name']) {
    const q = query.trim(), limit = q ? 7 : 5;
    const expected = largePatients.map((p, i) => ({
      p, i,
      sc: Math.max(paletteScore(p.name, q), paletteScore(p.mrn || '', q), q.length >= 4 ? paletteScore(p.dob || '', q) : 0)
    })).filter(x => x.sc > 0)
      .sort((a, b) => b.sc - a.sc || String(a.p.name).localeCompare(String(b.p.name)) || a.i - b.i)
      .slice(0, limit).map(x => [x.p.id, x.sc]);
    const actual = Array.from(api._search(query).patients, x => [x.p.id, x.sc]);
    assert.deepStrictEqual(actual, expected, 'command-palette bounded top-' + limit + ' changed order for ' + query);
    const shaped = api._search(query).patients;
    for (const hit of shaped) assert.deepStrictEqual(Object.keys(hit).sort(), ['p', 'sc'], 'command-palette patient result shape changed');
  }
}

const quickRender = quickSource.slice(quickSource.indexOf('function renderNow()'), quickSource.indexOf('function emptyEl('));
assert.strictEqual((quickRender.match(/getPatientsSafe\(\)/g) || []).length, 1, 'quicksearch render takes more than one patient snapshot');
assert(quickRender.includes('search(q, allPats)'), 'quicksearch render does not pass its snapshot into search');

const paletteRender = paletteSource.slice(paletteSource.indexOf('function render(q)'), paletteSource.indexOf('/* ---------------- global hotkey'));
assert.strictEqual((paletteRender.match(/\bpatients\(\)/g) || []).length, 1, 'command-palette render takes more than one patient snapshot');
assert(paletteRender.includes('search(q, patientSnapshot)'), 'command-palette render does not pass its snapshot into search');

console.log('PASS quicksearch/command palette: roster identity + exact-key fallback, account isolation, fail-open rebuild, one snapshot, identical bounded top-K');

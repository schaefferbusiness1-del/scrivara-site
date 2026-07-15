'use strict';

/* The origin gets ~5M chars of localStorage while the patients blob alone
   passed 3.4M; QuotaExceededError from savePatients was silently swallowed by
   every caller, so pulled visit history stopped persisting mid-run. The base
   app now stores the blob LZ-packed with a round-trip verify and loud quota
   handling. This test runs the REAL ScribeFlow functions in a VM. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

const start = html.indexOf('var __mlsLZ=(function(){');
assert(start >= 0, 'ScribeFlow.html must define the __mlsLZ patient-store packer');
const end = html.indexOf('function getActivePtId', start);
assert(end > start, 'could not isolate the patient-store block');
const block = html.slice(start, end);
assert(block.includes('function getPatients'), 'block must contain getPatients');
assert(block.includes('function savePatients'), 'block must contain savePatients');
assert(block.includes("'MLSZ1|'"), 'packed values must be magic-prefixed');

function makeStore(opts) {
  opts = opts || {};
  const data = Object.assign({}, opts.seed || {});
  let failures = Number(opts.failSets || 0);
  return {
    data,
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) {
      if (failures > 0) { failures--; const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      if (opts.alwaysFail) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      data[k] = String(v);
    },
    removeItem(k) { delete data[k]; },
    key(i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
}

function makeContext(store) {
  const ctx = {
    localStorage: store,
    toasts: [],
    uns(s) { return 'sf_u::t@t::' + s; },
    toast(m) { ctx.toasts.push(String(m)); },
    console
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return ctx;
}

function bigPatients() {
  const pts = [];
  for (let i = 0; i < 220; i++) {
    pts.push({
      id: 'p' + i, name: 'Patient ' + i, dob: '01/0' + ((i % 9) + 1) + '/1960',
      visits: [{
        id: 'v' + i, date: '2026-07-0' + ((i % 9) + 1), type: 'Office Visit',
        raw: ('Subjective: chronic lumbar pain, radiating. Objective: exam stable. Plan: continue PT. Row ' + i + '. ').repeat(24),
        identityVerified: true, identityBinding: 'p' + i, bodyComplete: true, fullDetail: true,
        encounterId: 'enc' + i, source: 'athena-schedule-history'
      }]
    });
  }
  return pts;
}

// 1) big blob packs, round-trips exactly, and shrinks materially
{
  const store = makeStore();
  const ctx = makeContext(store);
  const pts = bigPatients();
  const json = JSON.stringify(pts);
  assert(json.length > 200000, 'fixture must exceed the packing threshold');
  ctx.savePatients(pts);
  const stored = store.data['sf_u::t@t::patients'];
  assert(stored.lastIndexOf('MLSZ1|', 0) === 0, 'big blob must be stored packed');
  assert(stored.length < json.length / 2, 'packed blob must be at most half the plain size, got ' + stored.length + ' vs ' + json.length);
  /* VM objects live in another realm; compare serialized forms, not prototypes */
  assert.strictEqual(JSON.stringify(ctx.getPatients()), json, 'packed round-trip must be exact');
  const v = ctx.getPatients()[0].visits[0];
  assert.strictEqual(v.identityVerified, true, 'trust flags must survive the pack');
  assert.strictEqual(v.bodyComplete, true, 'bodyComplete must survive the pack');
}

// 2) legacy plain value stays readable; small arrays stay plain
{
  const plain = JSON.stringify([{ id: 'a', name: 'Legacy' }]);
  const ctx = makeContext(makeStore({ seed: { 'sf_u::t@t::patients': plain } }));
  assert.strictEqual(JSON.stringify(ctx.getPatients()), plain, 'legacy plain blob must parse');
  ctx.savePatients([{ id: 'b' }]);
  assert.strictEqual(ctx.localStorage.data['sf_u::t@t::patients'], JSON.stringify([{ id: 'b' }]), 'small blob must stay plain JSON');
}

// 3) quota failure evicts regenerable caches and retries successfully
{
  const store = makeStore({ failSets: 1, seed: { 'sf_studygroups_v1': 'x'.repeat(10), 'mlsRFScrapeCache2': 'y' } });
  const ctx = makeContext(store);
  ctx.savePatients([{ id: 'q1', name: 'Quota' }]);
  assert(!store.data['sf_studygroups_v1'], 'regenerable cache must be evicted on quota pressure');
  assert(!store.data['mlsRFScrapeCache2'], 'scrape cache must be evicted on quota pressure');
  assert.strictEqual(JSON.stringify(ctx.getPatients()), JSON.stringify([{ id: 'q1', name: 'Quota' }]), 'retry after eviction must persist');
}

// 4) persistent quota failure is LOUD: toast + throw, never a silent no-op
{
  const ctx = makeContext(makeStore({ alwaysFail: true }));
  assert.throws(() => ctx.savePatients([{ id: 'z' }]), /quota/i, 'persistent quota failure must throw');
  assert(ctx.toasts.some(t => /storage is full/i.test(t)), 'persistent quota failure must toast the user');
}

// 5) corrupted packed value degrades to [] instead of crashing
{
  const ctx = makeContext(makeStore({ seed: { 'sf_u::t@t::patients': 'MLSZ1|garbage' } }));
  assert.strictEqual(JSON.stringify(ctx.getPatients()), '[]', 'corrupted packed blob must degrade to empty, not crash');
}

// 6) the dev snapshots must never clobber a packed blob they cannot read
for (const snap of ['ScribeFlow-staging.html', 'ScribeFlow_test.html']) {
  const s = fs.readFileSync(path.join(root, snap), 'utf8');
  assert(/lastIndexOf\('MLSZ1\|',0\)===0\)\s*return;/.test(s), snap + ' must refuse to overwrite a packed patients blob');
}

// 7) satellite direct readers decode through the shared helper
{
  const sc = fs.readFileSync(path.join(root, 'feat_mls_store_cache.js'), 'utf8');
  assert(sc.includes('__mlsPtsDecode'), 'store cache must decode packed blobs');
  const vf = fs.readFileSync(path.join(root, 'feat_mls_visitfix.js'), 'utf8');
  assert(vf.includes('__mlsPtsDecode'), 'visitfix hydrator must decode packed blobs');
  const lg = fs.readFileSync(path.join(root, 'legal-chart-fill-ui.js'), 'utf8');
  assert(lg.includes('__mlsPtsDecode'), 'legal chart fill must decode packed blobs');
}

console.log('PASS patient store: LZ-packed round-trip, quota eviction/loud-failure, legacy + satellite compatibility');

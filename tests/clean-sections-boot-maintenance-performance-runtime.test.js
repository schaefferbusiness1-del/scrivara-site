'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_b121_pack.js'), 'utf8');
const start = source.indexOf(' * MODULE 7 - CHART-SECTION CLEANER');
const end = source.indexOf(' * __mlsDobEverywhere v1.0.0', start);
assert(start >= 0 && end > start, 'clean-sections module was not found');
const moduleSource = '/*\n' + source.slice(start, end) + '\n*/';

function dirtyPatient(id) {
  return {
    id, name: 'Maintenance Patient', dob: '01/02/1970', updated: 1,
    problems: 'Discussion Notes\nM54.5 Low back pain', meds: '', allergies: '',
    summary: 'Loading...\nPROBLEMS: Discussion Notes; M54.5 Low back pain', visits: [],
    /* Production-scale bytes that the cleaner must not clone/parse in one
       startup task. The clinical fields above remain the exact repair input. */
    payload: 'Clinical history payload '.repeat(115)
  };
}

function largeRoster() {
  const rows = Array.from({ length: 1571 }, (_, i) => ({
    id: 'p-' + (i + 1), name: 'Maintenance Patient ' + i, dob: '01/02/1970', updated: 1,
    problems: 'M54.5 Low back pain', meds: '', allergies: '', summary: 'Stable clinical summary', visits: [],
    payload: 'Clinical history payload '.repeat(115)
  }));
  rows[0] = dirtyPatient('p-1');
  return rows;
}

function harness(withQueue) {
  const patient = dirtyPatient('p-1');
  let patients = largeRoster();
  patients[0] = patient;
  let upserts = 0, queueCalls = 0, baseSaves = 0, queued = null, baseRows = null;
  let rosterReads = 0;
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document: { addEventListener() {}, removeEventListener() {} },
    addEventListener() {}, removeEventListener() {},
    URL: { createObjectURL() { throw new Error('worker disabled in test'); }, revokeObjectURL() {} },
    Blob: function Blob() {}, Worker: function Worker() { throw new Error('worker disabled in test'); },
    getPatients() { rosterReads++; return patients; },
    upsertPatient(row) { upserts++; const at = patients.findIndex(item => item.id === row.id); if (at >= 0) patients[at] = row; return { ok: true }; },
    savePatients(rows) { baseSaves++; baseRows = rows; return Promise.resolve({ saved: true, rows }); }
  };
  if (withQueue) {
    context.__mlsMaintenancePersist = {
      capture() { return { key: 'mls::clean@example.test::patients', account: 'clean@example.test', token: 'token', raw: 'raw' }; },
      scan(options) {
        queueCalls++; queued = { options, resolve: null };
        return new Promise(resolve => { queued.resolve = resolve; });
      }
    };
  }
  context.window = context;
  vm.runInNewContext(moduleSource, context, { filename: 'clean-sections-maintenance.js' });
  return {
    context, patient,
    get patients() { return patients; }, get upserts() { return upserts; },
    get queueCalls() { return queueCalls; }, get queued() { return queued; },
    get baseSaves() { return baseSaves; }, get baseRows() { return baseRows; },
    get rosterReads() { return rosterReads; },
    runScan() {
      assert(queued, 'missing clean-sections shared scan request');
      const source = patients.slice(), rows = source.slice(), dirty = [];
      for (let i = 0; i < source.length; i++) {
        const prepared = queued.options.prepare(source[i], i, source);
        if (prepared && typeof prepared === 'object') { rows[i] = prepared; dirty.push(prepared); }
      }
      if (dirty.length) { patients = rows; queued.options.onSaved({ saved: true, rows }, rows); queued.resolve({ saved: true, rows }); }
      else { queued.options.onEmpty({ saved: false, empty: true }, rows); queued.resolve({ saved: false, empty: true, rows }); }
      return { rows, dirty };
    }
  };
}

async function turns() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

async function main() {
  const queued = harness(true);
  await turns();
  assert.strictEqual(queued.rosterReads, 0, 'automatic cleaner read the roster before session readiness');
  assert.strictEqual(queued.queueCalls, 1, 'automatic clean-sections maintenance did not enqueue exactly one outer save');
  assert.strictEqual(queued.queued.options.chunkSize, 24, 'automatic clean-sections maintenance lost its bounded shared-scan size');
  const scanRun = queued.runScan(); await turns();
  assert.strictEqual(queued.upserts, 0, 'automatic clean-sections maintenance returned to per-patient upserts');
  assert.strictEqual(queued.baseSaves, 0, 'automatic clean-sections maintenance bypassed the cooperative queue');
  assert(/Discussion Notes/.test(queued.patient.problems), 'automatic staging mutated the memo-backed patient before durability');
  assert.strictEqual(scanRun.dirty.length, 1, 'automatic cleaner did not isolate its exact dirty row');
  assert(!/Discussion Notes/.test(scanRun.dirty[0].problems) && /M54\.5/.test(scanRun.dirty[0].problems),
    'automatic cleaner changed its clinical triage output');
  assert.strictEqual(queued.queued.options.mirror, true, 'automatic maintenance lost the server mirror');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(queued.context.__mlsCleanSections.stats.migrated, 1, 'verified queue completion did not advance migration state');

  const fallback = harness(false);
  await turns();
  assert.strictEqual(fallback.upserts, 0, 'missing cooperative maintenance support fell back to synchronous upserts');
  assert(/Discussion Notes/.test(fallback.patient.problems), 'missing cooperative support mutated the canonical patient');

  const cooperativeInput = [fallback.patient];
  const saveResult = fallback.context.savePatients(cooperativeInput, 'mls::clean@example.test::patients', { cooperative: true });
  assert(saveResult && typeof saveResult.then === 'function', 'cooperative save wrapper lost its completion promise');
  assert.strictEqual(fallback.baseSaves, 1, 'cooperative save wrapper did not delegate exactly once');
  assert.strictEqual(fallback.baseRows[0], fallback.patient, 'cooperative save wrapper repeated a whole-roster copy/clean pass before its Worker');
  assert(/Discussion Notes/.test(fallback.baseRows[0].problems), 'cooperative save wrapper synchronously cleaned the caller on its input task');
  await saveResult;

  const manual = fallback.context.__mlsCleanSections.migrateNow();
  assert.strictEqual(manual, 1, 'explicit manual migration no longer reports its repaired row');
  assert.strictEqual(fallback.upserts, 1, 'explicit manual migration no longer uses immediate durable persistence');

  console.log('PASS clean-sections maintenance: 1,571-row boot repair waits for readiness/input and runs in bounded COW chunks, cooperative saves do not rescan, and manual durability remains immediate');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const stages = ['Confirming procedure', 'Loading validated template', 'Applying provider defaults', 'Applying facility defaults', 'Drafting procedure section', 'Drafting findings', 'Checking side and level', 'Checking required fields', 'Running final consistency check', 'Note ready'];
const templateText = 'PATIENT:\nPREOPERATIVE DIAGNOSIS:\nPROCEDURE:\nDESCRIPTION OF PROCEDURE:\nCOMPLICATIONS:\nDISPOSITION:';

function note(procedure) {
  return [
    'PATIENT: Jordan Lee',
    'PREOPERATIVE DIAGNOSIS: Lumbar radiculopathy',
    `PROCEDURE: ${procedure}`,
    'DESCRIPTION OF PROCEDURE: Completed.',
    'COMPLICATIONS: None.',
    'DISPOSITION: Stable.'
  ].join('\n');
}

async function main() {
  const jobs = [];
  let serial = 0;
  const loading = {
    installed: true,
    start(opts) {
      const record = { opts, seen: [], status: 'running', failure: null };
      const handle = {
        id: `job-${++serial}`, requestId: `request-${serial}`,
        stage(stage, patch) { record.seen.push({ stage, ...patch }); },
        complete(message) { record.status = 'completed'; record.message = message; },
        fail(err) { record.status = 'failed'; record.failure = err; },
        cancel(message) { record.status = 'canceled'; record.message = message; if (opts.cancel) opts.cancel(); }
      };
      record.handle = handle;
      jobs.push(record);
      return handle;
    }
  };
  let aiCalls = 0;
  let responder = async user => JSON.stringify({ note: note(/PROCEDURE: Left L3 TFESI/.test(user) ? 'Left L3 TFESI' : 'Left L2 TFESI'), missing: [] });
  const seenOpts = [];
  const templates = [{ id: 'tfesi', name: 'Lumbar TFESI', text: templateText }];
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
    __mlsLoadingCalm: loading,
    getTemplates() { return templates; },
    getTemplateById(id) { return templates.find(t => t.id === id) || null; },
    getPatients() { return [{ id: 'patient-1', name: 'Jordan Lee', dob: '1984-05-12', sex: 'F', visits: [] }]; },
    getKey() { return 'test-key'; },
    opPrepRender() {}, toast() {},
    async aiCallRaw(sys, user, key, opts) { aiCalls++; seenOpts.push(opts); return responder(user); }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'opnote-integrity.js' });
  const ctx = { patientId: 'patient-1', dob: '1984-05-12', provider: 'Jane Smith, MD', facility: 'North Procedure Center' };

  let releaseDuplicate;
  responder = () => new Promise(resolve => { releaseDuplicate = () => resolve(JSON.stringify({ note: note('Left L2 TFESI'), missing: [] })); });
  const duplicateA = context._genOpNote('Jordan Lee', '2026-07-14', 'Left L2 TFESI', templateText, ctx);
  const duplicateB = context._genOpNote('Jordan Lee', '2026-07-14', 'Left L2 TFESI', templateText, ctx);
  await Promise.resolve();
  assert.strictEqual(aiCalls, 1, 'identical in-flight generation launched a duplicate model request');
  releaseDuplicate();
  const [readyA, readyB] = await Promise.all([duplicateA, duplicateB]);
  assert.strictEqual(readyA.note, readyB.note, 'deduplicated callers did not receive the same validated result');
  assert.strictEqual(jobs.length, 1, 'identical generation displayed duplicate progress jobs');
  assert.strictEqual(jobs[0].status, 'completed', 'successful generation did not terminate its progress job');
  assert.deepStrictEqual(jobs[0].seen.map(s => s.stage), stages, 'generation did not expose the real validation stage sequence');
  assert(jobs[0].seen.every((s, i) => s.current === i + 1 && s.total === stages.length), 'stage counts are not measurable real progress');
  assert.strictEqual(seenOpts[0].mlsRequestId, jobs[0].handle.requestId, 'progress request ID was not correlated to the model request');

  let releaseOld;
  responder = user => {
    if (/PROCEDURE: Left L2 TFESI/.test(user)) return new Promise(resolve => { releaseOld = () => resolve(JSON.stringify({ note: note('Left L2 TFESI'), missing: [] })); });
    return Promise.resolve(JSON.stringify({ note: note('Left L3 TFESI'), missing: [] }));
  };
  const old = context._genOpNote('Jordan Lee', '2026-07-14', 'Left L2 TFESI', templateText, ctx);
  const oldRejected = assert.rejects(old, err => err && err.code === 'MLS_OPNOTE_STALE');
  await Promise.resolve();
  const newer = context._genOpNote('Jordan Lee', '2026-07-14', 'Left L3 TFESI', templateText, ctx);
  const newReady = await newer;
  assert(newReady.note.includes('PROCEDURE: Left L3 TFESI'), 'new request did not retain its requested level');
  releaseOld();
  await oldRejected;
  assert.strictEqual(jobs[1].status, 'canceled', 'superseded progress job remained active');
  assert.strictEqual(jobs[2].status, 'completed', 'newest progress job did not complete');
  assert.strictEqual(context.__mlsLastOpFidelityPass, true, 'late stale response overwrote the newest request readiness');

  console.log('PASS op-note generation jobs: one in-flight request, request-correlated stages, terminal progress, and stale-response rejection');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

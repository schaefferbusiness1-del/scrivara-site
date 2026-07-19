'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const history = fs.readFileSync(path.join(root, 'feat_opnote_history.js'), 'utf8');
const pro = fs.readFileSync(path.join(root, 'mls-opnote-pro.staging.js'), 'utf8');
const connector = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing source marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}

const identitySource = between(app, 'function _ptAge', 'function _opNewRow');
const generateSource = between(app, 'async function _genOpNote', '/* Fill the [[key]] placeholders');

async function main() {
  let underlyingCalls = 0;
  let captured = null;
  const patients = [
    {
      id: 'exact-a', name: 'Duplicate Patient', dob: '01/02/1970', sex: 'F',
      problems: 'EXACT A PROFILE PROBLEM', meds: 'EXACT A MED', allergies: 'EXACT A ALLERGY',
      athenaChartSnapshot: { summary: 'EXACT A LATEST SNAPSHOT' },
      visits: [{
        date: '2026-07-01', type: 'Verified office visit', source: 'athena-copy',
        identityVerified: true, identityBinding: 'exact-a', findings: 'EXACT A VERIFIED VISIT'
      }]
    },
    {
      id: 'wrong-b', name: 'Duplicate Patient', dob: '01/02/1970', sex: 'M',
      problems: 'WRONG B PROFILE PROBLEM', meds: 'WRONG B MED', allergies: 'WRONG B ALLERGY',
      athenaChartSnapshot: { summary: 'WRONG B SNAPSHOT' },
      visits: [{
        date: '2026-07-02', type: 'Wrong visit', source: 'athena-copy',
        identityVerified: true, identityBinding: 'wrong-b', findings: 'WRONG B VERIFIED VISIT'
      }]
    }
  ];
  const document = {
    readyState: 'loading',
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; },
    createElement() { return {}; },
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document,
    setTimeout, clearTimeout,
    setInterval() { return 1; }, clearInterval() {},
    addEventListener() {}, removeEventListener() {},
    getPatients() { return patients; },
    activePatient() { return patients[1]; }, // adversarial: wrong duplicate is active
    getKey() { return 'test-key'; },
    __mlsVisitModel: {
      _normDob(v) { return String(v || '').trim(); },
      usableVisits(patient) {
        return (patient.visits || []).filter(v => v.identityVerified === true && v.identityBinding === patient.id);
      },
      getVisits(patient) { return patient.visits || []; }
    },
    aiCallRaw(sys, user, key, opts) {
      underlyingCalls++;
      captured = { sys, user, key, opts };
      return Promise.resolve('{"note":"staging exact-id draft","missing":[]}');
    }
  };
  context.window = context;

  vm.runInNewContext(history, context, { filename: 'feat_opnote_history.js' });
  context.__mlsOpNoteHistory.rewire();
  vm.runInNewContext(identitySource + '\n' + generateSource, context, { filename: 'staging-opnote-path.js' });

  assert.strictEqual(context._opPatientCtx('Duplicate Patient', '01/02/1970', '' ).patientId, undefined,
    'staging accepted duplicate name+DOB without immutable id');
  const ctx = context._opPatientCtx('Duplicate Patient', '01/02/1970', 'exact-a');
  assert.strictEqual(ctx.patientId, 'exact-a', 'staging patient context lost immutable id');

  const result = await context._genOpNote('Duplicate Patient', '07/15/2026', 'Example procedure', 'Template text', ctx);
  assert.strictEqual(result.note, 'staging exact-id draft', 'staging generator failed after exact identity verification');
  assert.strictEqual(underlyingCalls, 1, 'staging exact-id generation did not make exactly one AI request');
  assert(captured && captured.opts && captured.opts.mlsOpNotePatientId === 'exact-a', 'staging generator did not carry immutable id to aiCallRaw');
  assert(/EXACT A PROFILE PROBLEM|EXACT A MED/.test(captured.user), 'staging AI request omitted exact profile data');
  assert(/EXACT A LATEST SNAPSHOT/.test(captured.user), 'staging AI request omitted latest exact Athena chart snapshot');
  assert(/EXACT A VERIFIED VISIT/.test(captured.user), 'staging AI request omitted exact verified visit');
  assert(!/WRONG B PROFILE|WRONG B MED|WRONG B ALLERGY|WRONG B SNAPSHOT|WRONG B VERIFIED VISIT/.test(captured.user),
    'staging AI request leaked the active duplicate patient');

  const beforeBlocked = underlyingCalls;
  await assert.rejects(
    context._genOpNote('Duplicate Patient', '07/15/2026', 'Example procedure', 'Template text', { dob: '01/02/1970' }),
    err => err && err.code === 'MLS_OPNOTE_IDENTITY',
    'staging generator did not fail closed when immutable id was missing'
  );
  assert.strictEqual(underlyingCalls, beforeBlocked, 'identity-blocked staging draft reached AI transport');

  assert(pro.includes('mlsOpNotePatientId: String(exactPatient.id)'), 'staging professional formatter drops immutable id');
  assert(pro.includes("e.code === 'MLS_OPNOTE_IDENTITY'"), 'staging professional formatter swallows identity failures');
  assert(connector.includes("mls-opnote-pro.staging.js?v=20260718stglib1"), 'staging professional formatter cache key is stale');

  console.log('PASS staging op-note identity: duplicate name/DOB remains exact-id bound through the actual AI request');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

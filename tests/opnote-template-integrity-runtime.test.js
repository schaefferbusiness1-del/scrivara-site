'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const stagingConnect = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');
const scribeFlow = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const stagingScribeFlow = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');

const template = (id, name, keywords = []) => ({
  id, name, keywords,
  text: `PATIENT:\nPREOPERATIVE DIAGNOSIS:\nPROCEDURE:\nDESCRIPTION OF PROCEDURE:\nCOMPLICATIONS:\nDISPOSITION:`
});

async function main() {
  let list = [
    template('tfesi', 'Lumbar transforaminal epidural steroid injection'),
    template('ilesi', 'Lumbar interlaminar epidural steroid injection'),
    template('mbb', 'Lumbar medial branch block'),
    template('facet-rfa', 'Lumbar medial branch radiofrequency ablation'),
    template('gen-block', 'Genicular nerve block'),
    template('gen-rfa', 'Genicular nerve radiofrequency ablation'),
    template('si', 'Sacroiliac joint injection'),
    template('scs-trial', 'Spinal cord stimulator trial'),
    template('intracept', 'Intracept basivertebral nerve ablation'),
    template('trigger', 'Trigger point injections')
  ];
  const patients = [{
    id: 'p-exact', name: 'Jordan Lee', dob: '1984-05-12', sex: 'F', mrn: 'QA-1',
    visits: [{ date: '2026-07-12', plan: 'Proceed with genicular nerve radiofrequency ablation.' }]
  }, {
    id: 'p-blank', name: 'Taylor Morgan', dob: '1990-01-02', sex: 'F', mrn: 'QA-2', visits: []
  }];
  const statusBadge = { textContent: '', style: {} };
  const templateSelect = {
    value: '',
    parentElement: { querySelectorAll() { return [statusBadge]; } },
    setAttribute(name, value) { this[name] = value; }
  };
  const document = {
    readyState: 'complete',
    addEventListener() {},
    getElementById(id) { return id === 'opPrepTpl_0' ? templateSelect : null; }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document,
    getTemplates() { return list; },
    getTemplateById(id) { return list.find(t => t.id === id) || null; },
    getPatients() { return patients; },
    getKey() { return 'test-key'; },
    _opDobKey(v) { return String(v || '').trim(); },
    _opPreviewHtml() { return ''; },
    opPrepRender() {},
    async opPrepGenerateOne(i) {
      const row = context._opPrep[i];
      if (!row || !row.tplId) return;
      row.note = 'generated'; row.gen = true; context.__mlsLastOpFidelityPass = true;
    },
    toast() {}
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'opnote-integrity.js' });

  const api = context.__mlsOpNoteIntegrity;
  assert(api && api.installed, 'op-note integrity owner did not install');
  assert.strictEqual(context._genOpNote.__opnpWrapped, true, 'legacy prep heartbeat can take generator ownership back');
  assert.strictEqual(context._genOpNote.__mlsopWrapped, true, 'legacy pro heartbeat can take generator ownership back');
  assert.strictEqual(context._genOpNote.__mlsOpTemplateOwner, true, 'strict template generator is not marked as the final owner');
  assert.strictEqual(context.opPrepGenerateOne.__opnpWrapped, true, 'legacy prep heartbeat can rewrap single-note generation');
  const strictOwner = context._genOpNote;
  const prepHeartbeat = fn => fn.__opnpWrapped ? fn : Object.assign(function () { return fn.apply(this, arguments); }, { __opnpWrapped: true });
  const proHeartbeat = fn => fn.__mlsopWrapped ? fn : Object.assign(function () { return fn.apply(this, arguments); }, { __mlsopWrapped: true });
  assert.strictEqual(prepHeartbeat(strictOwner), strictOwner, 'prep heartbeat replaced the final template owner');
  assert.strictEqual(proHeartbeat(strictOwner), strictOwner, 'pro heartbeat replaced the final template owner');
  const cases = [
    ['Left L5-S1 TFESI', 'tfesi'],
    ['L4-5 interlaminar ESI', 'ilesi'],
    ['Bilateral L3-L5 medial branch blocks', 'mbb'],
    ['Lumbar medial branch RFA', 'facet-rfa'],
    ['Genicular nerve block', 'gen-block'],
    ['Genicular nerve radiofrequency ablation', 'gen-rfa'],
    ['Right SI joint injection', 'si'],
    ['L SI joint inj P', 'si'],
    ['B/L L3, L4MB & L5 DR B #2 PP; CASE# KPNV5463', 'mbb'],
    ['SCS trial', 'scs-trial'],
    ['Intracept BVN ablation', 'intracept'],
    ['Trigger point injections', 'trigger']
  ];
  for (const [procedure, expected] of cases) {
    const found = api.best(procedure);
    assert(found.confident && found.tpl && found.tpl.id === expected, `${procedure} matched ${found.tpl && found.tpl.id} instead of ${expected}`);
  }
  assert.strictEqual(api.best('follow-up appointment').tpl, null, 'no-signal appointment silently received a random template');
  assert.strictEqual(api.bestFor('Jordan Lee', '', '1984-05-12', 'p-exact').tplId, 'gen-rfa', 'exact-patient planned procedure did not drive matching');
  assert.strictEqual(api.bestFor('Jordan Lee', '', '1984-05-12', 'wrong-id').tplId, '', 'wrong patient id was allowed to drive history matching');

  context._opPrep = [{
    patientId: 'p-exact', appt: { name: 'Jordan Lee', dob: '1984-05-12', reason: '' },
    proc: '', tplId: 'si', tplManual: true
  }];
  context._opProcChanged(0, 'Left L5-S1 TFESI');
  assert.strictEqual(context._opPrep[0].tplId, 'si', 'editing procedure text overwrote a clinician-selected template');
  context.opPrepRender();
  assert.strictEqual(statusBadge.textContent, '(your selection)', 'manual template choice is mislabeled as automatic');

  context._opPrep[0].tplManual = false;
  context._opPrep[0].tplMatchSource = 'reason';
  context._opPrep[0].patientId = 'p-blank';
  context._opPrep[0].appt = { name: 'Taylor Morgan', dob: '1990-01-02', reason: 'follow-up appointment' };
  context._opPrep[0].proc = 'follow-up appointment';
  context._opPrep[0].tplId = 'tfesi';
  const weakBulkResult = await context.opPrepGenerateOne(0);
  assert.strictEqual(context._opPrep[0].tplId, '', 'bulk drafting retained an unrelated template after a no-signal recheck');
  assert.strictEqual(weakBulkResult, false, 'bulk drafting reported success without an unambiguous template');

  const tplText = 'PATIENT:\nPREOPERATIVE DIAGNOSIS:\nPROCEDURE:\nDESCRIPTION OF PROCEDURE:\nCOMPLICATIONS:\nDISPOSITION:';
  const correct = 'PATIENT: Jordan Lee\nPREOPERATIVE DIAGNOSIS: Lumbar radiculopathy\nPROCEDURE: Left L5-S1 TFESI\nDESCRIPTION OF PROCEDURE: Completed.\nCOMPLICATIONS: None.\nDISPOSITION: Stable.';
  const wrong = 'PATIENT: Jordan Lee\nPROCEDURE: Left L5-S1 TFESI\nPREOPERATIVE DIAGNOSIS: Lumbar radiculopathy\nDESCRIPTION OF PROCEDURE: Completed.\nCOMPLICATIONS: None.\nDISPOSITION: Stable.';
  assert.strictEqual(api.fidelity(correct, tplText).pass, true, 'exact template heading order was rejected');
  assert.strictEqual(api.fidelity(wrong, tplText).pass, false, 'reordered template headings were accepted');
  const boilerplateTpl = `${tplText}\nThe risks, benefits, and alternatives were discussed with the patient before the procedure.`;
  const boilerplateGood = `${correct}\nThe risks, benefits, and alternatives were discussed with the patient before the procedure.`;
  const boilerplateChanged = `${correct}\nConsent was discussed before the procedure.`;
  assert.strictEqual(api.fidelity(boilerplateGood, boilerplateTpl).pass, true, 'unchanged fixed template wording was rejected');
  assert.strictEqual(api.fidelity(boilerplateChanged, boilerplateTpl).pass, false, 'changed fixed template boilerplate was accepted');
  const inlineTpl = `${tplText}\nCONSENT: The risks, benefits, and alternatives were discussed with the patient before the procedure.`;
  const inlineGood = `${correct}\nCONSENT: The risks, benefits, and alternatives were discussed with the patient before the procedure.`;
  assert.strictEqual(api.fidelity(inlineGood, inlineTpl).pass, true, 'inline fixed wording under a template heading was not preserved');

  let calls = 0;
  context.aiCallRaw = async () => JSON.stringify({ note: ++calls === 1 ? wrong : correct, missing: [] });
  const repaired = await context._genOpNote('Jordan Lee', '2026-07-14', 'Left L5-S1 TFESI', tplText, { patientId: 'p-exact', dob: '1984-05-12' });
  assert.strictEqual(calls, 2, 'a structure-breaking draft did not receive exactly one repair attempt');
  /* oni-2.4.0 airs the final note (one blank line between sections) */
  assert.strictEqual(repaired.note, api.airSections(correct), 'repair did not return the template-faithful note');
  assert(!repaired.note.includes('Noah Williams'), 'another patient name leaked into the generated note');
  assert.strictEqual(repaired.templateFidelity.pass, true, 'successful draft lacks a fidelity receipt');

  calls = 0;
  context.aiCallRaw = async () => { calls++; return JSON.stringify({ note: wrong, missing: [] }); };
  const anchored = await context._genOpNote('Jordan Lee', '2026-07-14', 'Left L5-S1 TFESI', tplText, { patientId: 'p-exact', dob: '1984-05-12' });
  assert.strictEqual(api.fidelity(anchored.note, tplText).pass, true, 'two structure-breaking drafts were not deterministically re-anchored');
  assert(anchored.note.startsWith('PATIENT: Jordan Lee'), 'verified patient identity was not forced into the anchored template');
  assert.strictEqual(calls, 2, 'fidelity failure retried more or less than once');

  const liveTpl = 'OPERATIVE REPORT — LUMBAR MEDIAL BRANCH RADIOFREQUENCY ABLATION\nPATIENT:\nMRN:\nDATE OF PROCEDURE:\nPREOPERATIVE DIAGNOSIS:\nPOSTOPERATIVE DIAGNOSIS:\nPROCEDURE:\nLATERALITY AND LEVELS:\nANESTHESIA:\nINDICATIONS:\nCONSENT:\nThe risks, benefits, and alternatives were discussed with the patient, and informed consent was obtained.\nTECHNIQUE:\nAfter a formal time-out, the target sites were identified under fluoroscopy.\nDESCRIPTION OF PROCEDURE:\n[[procedure_description]]\nCOMPLICATIONS:\nDISPOSITION:\nThe patient tolerated the procedure and was discharged in stable condition.';
  const scrambledLive = 'PATIENT: Wrong Patient\nPROCEDURE: Right L3-L5 RFA\nMRN: WRONG\nDESCRIPTION OF PROCEDURE: Lesioning was completed under fluoroscopy.\nCONSENT: Changed wording.\nCOMPLICATIONS: None.';
  const liveAnchored = api.reanchor(scrambledLive, liveTpl, {patient:'Jordan Lee',mrn:'QA-1','date of procedure':'2026-07-14',procedure:'Right L3-L5 medial branch RFA'});
  assert.strictEqual(api.fidelity(liveAnchored, liveTpl).pass, true, 'the exact live RFA template could not be deterministically reconstructed');
  assert(liveAnchored.includes('PATIENT: Jordan Lee') && !liveAnchored.includes('Wrong Patient') && !liveAnchored.includes('MRN: WRONG'), 'model-supplied identity leaked through template reconstruction');
  assert(liveAnchored.includes('The risks, benefits, and alternatives were discussed with the patient, and informed consent was obtained.'), 'live template consent wording changed');

  assert(connect.includes('feat_mls_opnote_integrity.js?v=20260716oni263'), 'production does not load the final op-note integrity owner');
  assert(stagingConnect.includes('feat_mls_opnote_integrity.js?v=20260716oni263'), 'staging does not load the same op-note integrity owner');
  assert(scribeFlow.includes('✍️ Type or paste below') && stagingScribeFlow.includes('✍️ Type or paste below'), 'template text entry is not the same clear inline control in production and staging');
  assert(!/function tplPasteText\(\)\{[\s\S]{0,180}\bprompt\s*\(/.test(scribeFlow), 'production template text entry still opens a blocking JavaScript prompt');
  assert(!/function tplPasteText\(\)\{[\s\S]{0,180}\bprompt\s*\(/.test(stagingScribeFlow), 'staging template text entry still opens a blocking JavaScript prompt');
  assert(!/generic op-note outline/.test(source.split('async function generate')[1].split('var sys=')[0]), 'generation path contains a generic-format preprocessor before the template owner');

  console.log('PASS op-note template integrity: exact class matching, exact-patient history, sticky manual picks, one repair, and fail-closed structure fidelity');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

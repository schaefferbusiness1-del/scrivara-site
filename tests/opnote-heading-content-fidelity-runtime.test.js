'use strict';

/* oni-2.3.0 — a template-faithful draft that fills a section on the heading
 * line itself (making the line >90 chars) must PASS fidelity on the first
 * check, and the deterministic reanchor must carry the draft's section
 * content into single-placeholder "HEADING: [SLOT]" lines instead of
 * returning a hollow placeholder note. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');

const TPL = [
  'PREOPERATIVE DIAGNOSIS: [DIAGNOSIS]',
  'POSTOPERATIVE DIAGNOSIS: Same.',
  'PROCEDURE PERFORMED: [PROCEDURE]',
  'ANESTHESIA: Local with [LOCAL ANESTHETIC]',
  'DETAILS: [DETAILS]',
  'DISPOSITION: The patient was discharged in stable condition with follow-up in 2 weeks.'
].join('\n');

const FAITHFUL = [
  'PREOPERATIVE DIAGNOSIS: Lumbar spondylosis without myelopathy or radiculopathy, lumbosacral region, chronic and refractory to conservative care',
  'POSTOPERATIVE DIAGNOSIS: Same.',
  'PROCEDURE PERFORMED: Caudal epidural steroid injection under fluoroscopic guidance',
  'ANESTHESIA: Local with lidocaine 1%',
  'DETAILS: Under fluoroscopic guidance the sacral hiatus was identified and accessed; contrast confirmed epidural spread and the medication was delivered without complication.',
  'DISPOSITION: The patient was discharged in stable condition with follow-up in 2 weeks.'
].join('\n');

const REBEL = [
  'OPERATIVE REPORT',
  'PREOPERATIVE DIAGNOSIS: Lumbar spondylosis',
  'POSTOPERATIVE DIAGNOSIS: Same.',
  'PROCEDURE PERFORMED: Caudal epidural steroid injection',
  'ANESTHESIA: Local with lidocaine 1%',
  'DETAILS: The sacral hiatus was accessed under fluoroscopy and the injectate delivered without complication.',
  'COMPLICATIONS: None',
  'DISPOSITION: The patient was discharged in stable condition with follow-up in 2 weeks.'
].join('\n');

async function main() {
  const patients = [{ id: 'p1', name: 'Qa Alpha', dob: '1970-01-15', sex: 'F', mrn: '' }];
  const aiQueue = [];
  let aiCalls = 0;
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
    getTemplates() { return []; },
    getPatients() { return patients; },
    getKey() { return ''; },
    toast() {},
    aiCallRaw() {
      aiCalls++;
      assert(aiQueue.length, 'AI called more times than the scenario scripted');
      return Promise.resolve(JSON.stringify({ note: aiQueue.shift(), missing: [] }));
    }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'opnote-integrity.js' });
  const api = context.__mlsOpNoteIntegrity;
  assert(api && api.installed, 'integrity owner did not install');

  // 1) fidelity: a >90-char "HEADING: content" line keeps its heading.
  const direct = api.fidelity(FAITHFUL, TPL);
  assert.strictEqual(direct.pass, true, 'faithful draft with long same-line section content failed fidelity: ' + direct.reason);

  // 2) generate: the faithful draft passes on the FIRST model call (no repair).
  aiQueue.push(FAITHFUL);
  aiCalls = 0;
  const first = await api.generate('Qa Alpha', '2026-07-17', 'Caudal ESI', TPL, { dob: '1970-01-15', patientId: 'p1' });
  assert.strictEqual(aiCalls, 1, 'a template-faithful draft still triggered a repair round-trip');
  assert(first.note.includes('sacral hiatus was identified'), 'faithful draft content was altered');
  assert.strictEqual(context.__mlsLastOpFidelityPass, true, 'fidelity flag not set on first-pass success');

  // 3) generate: initial and repair both structurally wrong -> reanchor must
  //    keep template structure AND carry the draft's section content into the
  //    "DETAILS: [DETAILS]" single-slot line instead of leaving a placeholder.
  aiQueue.push(REBEL, REBEL);
  aiCalls = 0;
  const rescued = await api.generate('Qa Alpha', '2026-07-17', 'Caudal ESI', TPL, { dob: '1970-01-15', patientId: 'p1' });
  assert.strictEqual(aiCalls, 2, 'expected exactly one repair attempt before reanchor');
  const rescuedCheck = api.fidelity(rescued.note, TPL);
  assert.strictEqual(rescuedCheck.pass, true, 'reanchored note does not match the template: ' + rescuedCheck.reason);
  assert(!/\[DETAILS\]/.test(rescued.note), 'reanchor left the DETAILS placeholder unfilled');
  assert(rescued.note.includes('sacral hiatus was accessed under fluoroscopy'), 'reanchor dropped the draft’s DETAILS content');
  assert(!/COMPLICATIONS/.test(rescued.note), 'reanchor kept a heading the template does not have');

  // 4) reanchor with no usable draft content still yields template structure
  //    (placeholders remain visible rather than inventing prose).
  const hollow = api.reanchor('totally unrelated prose', TPL, {});
  assert(api.fidelity(hollow, TPL).pass, 'reanchor of unusable draft lost template structure');
  assert(/\[DETAILS\]|\[\[details\]\]/i.test(hollow), 'reanchor invented DETAILS content from nothing');

  console.log('PASS op-note heading/content fidelity: long heading lines keep headings, first-pass success, reanchor keeps clinical content in single-slot sections');
}

main().catch(err => { console.error(err); process.exit(1); });

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
  const patients = [{
    id: 'p1', name: 'Qa Alpha', dob: '1970-01-15', sex: 'F', mrn: '',
    problems: 'Lumbar spondylosis M47.816; chronic low back pain',
    visits: [{ date: '2026-07-10', plan: 'Proceed with caudal epidural steroid injection.' }]
  }];
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

  // oni-2.4.0: the returned note is aired — one blank line between sections,
  // and airing never breaks fidelity.
  assert(first.note.includes('\n\nPOSTOPERATIVE DIAGNOSIS:'), 'sections are not separated by a blank line (one-blob note)');
  assert(api.fidelity(first.note, TPL).pass, 'aired note lost template fidelity');
  assert.strictEqual(api.airSections(first.note), first.note, 'airSections is not idempotent');

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

  // 5) oni-2.5.0 sanitizeTemplate: a PAST NOTE uploaded as a template (one flat
  //    paragraph carrying the prior patient) becomes a line-structured,
  //    prior-patient-free template; the doctor's technique wording survives.
  const BLOB = 'OPERATIVE REPORT  Patient: Brown, David  Patient DOB: 6-14-1941  Physician: Matthew Schaeffer, MD  Date of Operation: 10-16-2025  Type of Anesthesia: Local with 1% lidocaine  Procedure: Bilateral L3 and L4 medial branch blocks (mbbs) and L5 dorsal ramus blocks  Preoperative Diagnosis: Facet syndrome, lumbar spondylosis  Postoperative Diagnosis: Same  History: 75 year old male with L4/5, L5/S1 zygapophysial (facet) joint pain. See clinic notes for details.  Procedure: Written and verbal consent were obtained. The risks of the procedure were discussed, including infection.';
  const clean = api.sanitizeTemplate(BLOB);
  assert(!clean.includes('Brown, David'), 'prior patient name survived template sanitizing');
  assert(!clean.includes('6-14-1941'), 'prior patient DOB survived template sanitizing');
  assert(!clean.includes('10-16-2025'), 'prior operation date survived template sanitizing');
  assert(!clean.includes('75 year old male'), 'prior patient history survived template sanitizing');
  assert(clean.includes('Type of Anesthesia: Local with 1% lidocaine'), 'the doctor’s standard technique wording was lost');
  assert(clean.includes('Written and verbal consent were obtained'), 'the repeated Procedure: technique narrative was lost');
  assert(/\nPatient: \[\[patient\]\]/.test(clean), 'patient heading did not become a placeholder');
  assert(clean.split('\n').filter(l => l.trim()).length >= 9, 'blob template was not split into section lines: ' + clean.split('\n').length + ' lines');
  // sanitizing is idempotent and a clean line-based template passes through
  assert.strictEqual(api.sanitizeTemplate(clean), clean, 'sanitizeTemplate is not idempotent');
  assert.strictEqual(api.sanitizeTemplate(TPL), TPL, 'a clean template was altered by sanitizing');

  // 6) generate() with the blob template: current patient in, prior patient out.
  const blobFaithful = clean
    .replace('[[patient]]', 'Qa Alpha').replace('[[patient_dob]]', '1970-01-15')
    .replace('[[physician]]', 'Dr. Test').replace('[[date_of_operation]]', '2026-07-17')
    .replace('[[procedure]]', 'Bilateral L3/L4 medial branch blocks')
    .replace('[[preoperative_diagnosis]]', 'Facet syndrome').replace('[[history]]', 'Chronic axial low back pain.');
  aiQueue.push(JSON.stringify({ note: blobFaithful, missing: [] }) === '' ? '' : blobFaithful);
  aiCalls = 0;
  const fromBlob = await api.generate('Qa Alpha', '2026-07-17', 'Bilateral L3/L4 medial branch blocks', BLOB, { dob: '1970-01-15', patientId: 'p1' });
  assert(!fromBlob.note.includes('Brown, David'), 'prior patient name reached the generated note');
  assert(fromBlob.note.includes('Patient: Qa Alpha'), 'current patient was not stamped onto the note');
  assert(fromBlob.note.includes('Written and verbal consent were obtained'), 'technique narrative lost in generation');
  assert(fromBlob.note.includes('\n\n'), 'blob-template draft came back as one blob');

  // 7) oni-2.6.0: [[history]] / [[preoperative_diagnosis]] slots the model
  //    leaves behind are filled from the patient's OWN chart, never invented.
  assert.strictEqual(api.templateCompatibility('Caudal ESI', { text: BLOB }).pass, false,
    'an incompatible past MBB note was accepted as a caudal template');
  const CAUDAL_BLOB = BLOB
    .replace('Bilateral L3 and L4 medial branch blocks (mbbs) and L5 dorsal ramus blocks', 'Caudal epidural steroid injection')
    .replace('Facet syndrome, lumbar spondylosis', 'Lumbar radiculopathy')
    .replace('L4/5, L5/S1 zygapophysial (facet) joint pain', 'lumbar radicular pain');
  const clean2 = api.sanitizeTemplate(CAUDAL_BLOB);
  const lazyDraft = clean2
    .replace('[[patient]]', 'Qa Alpha').replace('[[patient_dob]]', '1970-01-15')
    .replace('[[physician]]', 'Dr. Test').replace('[[date_of_operation]]', '2026-07-17')
    .replace('[[procedure]]', 'Caudal ESI');   // history + preop diagnosis placeholders left in
  aiQueue.push(lazyDraft);
  aiCalls = 0;
  const charted = await api.generate('Qa Alpha', '2026-07-17', 'Caudal ESI', CAUDAL_BLOB, { dob: '1970-01-15', patientId: 'p1', sex: 'F' });
  assert(!/\[\[history\]\]/.test(charted.note), 'the history slot was left as a placeholder');
  assert(!/\[\[preoperative_diagnosis\]\]/.test(charted.note), 'the preop-diagnosis slot was left as a placeholder');
  assert(/\d+-year-old F with Lumbar spondylosis/.test(charted.note), 'chart-derived history sentence missing');
  assert(charted.note.includes('Most recent plan: Proceed with caudal epidural steroid injection'), 'latest documented plan missing from history');
  assert(charted.note.includes('Preoperative Diagnosis: Lumbar spondylosis M47.816'), 'preop diagnosis not filled from the chart problems list');

  // 8) real pulled-chart shape: p.problems is EMPTY and the problem list lives
  //    in the Athena visit raw as "<name> - Onset: MM/DD/YYYY"; extraction is
  //    verbatim and ranked by relevance to THIS procedure.
  const rawShaped = {
    id: 'p2', name: 'Qa Raw', dob: '1948-02-05', sex: 'F', problems: '',
    visits: [{ raw: 'Print Practice Header MURRA ... Problems Reviewed Problems Lumbar back pain - Onset: 01/20/2026 Sacroiliac joint pain - Onset: 01/20/2026 Pain in pelvis - Onset: 01/20/2026 Medications ...' }]
  };
  const probs = api.chartProblems(rawShaped, 'L SI joint injection');
  assert(probs.length >= 3, 'Onset-format problems were not extracted from visit raw');
  assert.strictEqual(probs[0], 'Sacroiliac joint pain', 'problems were not ranked by procedure relevance: ' + JSON.stringify(probs));
  assert(probs.indexOf('Lumbar back pain') >= 0, 'a chart problem was dropped');

  // 9) oni-2.6.3: a template PROCEDURE line carrying its own fixed wording
  //    ("[FILL: side] sacroiliac joint injection under fluoroscopy") must not
  //    be clobbered by the raw schedule string — that deleted a required
  //    fixed fragment and made fidelity unsatisfiable (live Claire M. case).
  const SITPL = 'OPERATIVE REPORT\nPROCEDURE: [FILL: side] sacroiliac joint injection under fluoroscopy\nCONSENT: Obtained.\nDISPOSITION: Recovered; follow-up [FILL: interval].';
  aiQueue.push(SITPL);   // model returns the template as-is (slots intact)
  aiCalls = 0;
  const si = await api.generate('Qa Alpha', '2026-07-17', 'L SI joint inj P', SITPL, { dob: '1970-01-15', patientId: 'p1' });
  assert.strictEqual(aiCalls, 1, 'fixed-wording PROCEDURE line still failed first-pass fidelity');
  assert(si.note.includes('sacroiliac joint injection under fluoroscopy'), 'the raw schedule string clobbered the template procedure line');
  assert(!si.note.includes('L SI joint inj P'), 'raw schedule shorthand leaked into the note');

  console.log('PASS op-note heading/content fidelity: long heading lines keep headings, first-pass success, reanchor keeps clinical content, past-note templates sanitized, chart fills history/diagnosis (incl. raw Onset extraction), fixed-wording procedure lines survive');
}

main().catch(err => { console.error(err); process.exit(1); });

'use strict';
/* opmatch-1.0.0 (2026-09-15) - THE PRACTICE'S OWN FILE NAMES, THROUGH THE
 * INSTALLED RANKER.
 *
 * Measured on the owner's real template folder (78 Word files) with the
 * shipped feat_mls_opnote_integrity.js driven in a VM: names like
 * "MBB L3L4L5 bilateral", "TF-L4L5-left", "FACETS L45 L5S1-right",
 * "MBB T12L1L2-bilateral" and "L1L2L3mb-bilateral" parsed to NO level at all
 * (levels: []), "TF" was not read as transforaminal, and a tie between two
 * copies of the same operative note ("MBB L3L4L5 bilateral" beside
 * "MBB L3L4L5 2_ bilateral") refused to draft. 13 of 29 realistic schedule
 * reasons ended with no template. After the change: 3 of 29, all genuinely
 * ambiguous (two procedures on one row, or a level set the library lacks).
 *
 * This suite EXECUTES the shipped module - never a re-implementation - on a
 * synthetic library shaped like those names. No patient text anywhere.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');

function body(procLine, extra) {
  return [
    'Patient: [[patient]]', 'Physician: [[physician]]', 'Date of Operation: [[date]]',
    'Procedure: ' + procLine,
    'Preoperative Diagnosis: [[diagnosis]]', 'Postoperative Diagnosis: Same',
    'Procedure:',
    'Written and verbal consent were obtained and the risks of the procedure were discussed in full with the patient before starting.',
    'The patient was brought into the procedure room and placed prone; scout fluoroscopic images were obtained and the skin was prepped and draped in the usual sterile fashion.',
    'A 22 gauge spinal needle was advanced under fluoroscopic guidance to the target and position was confirmed on two views before injection.',
    extra || '',
    'Conclusion/Comments: The patient tolerated the procedure well.',
  ].join('\n');
}
const templates = [
  { id: 'a', name: 'MBB L3L4L5 bilateral', text: body('Bilateral L3 and L4 medial branch blocks and L5 dorsal ramus blocks') },
  { id: 'b', name: 'MBB L3L4L5 2_ bilateral', text: body('Bilateral L3 and L4 medial branch blocks and L5 dorsal ramus blocks', 'The same procedure was then repeated in identical fashion on the contralateral side at each of the three levels described above.') },
  { id: 'c', name: 'MBB L2L3L4L5 -left', text: body('Left L2, L3 and L4 medial branch blocks and L5 dorsal ramus block') },
  { id: 'd', name: 'MBB L3L4L5 -left2', text: body('Left L3 and L4 medial branch blocks and L5 dorsal ramus block') },
  { id: 'e', name: 'MBB L3L4L5 -right', text: body('Right L3 and L4 medial branch blocks and L5 dorsal ramus block') },
  { id: 'f', name: 'TF-L5-S1-RIGHT', text: body('Right L5-S1 selective epidural injection') },
  { id: 'g', name: 'TF-L4L5-left', text: body('Left L4-L5 selective epidural injection') },
  { id: 'h', name: 'TF-L3L5-right', text: body('Right L3 and L5 selective transforaminal epidural injections') },
  { id: 'i', name: 'SI-Bilateral', text: body('Bilateral sacroiliac joint injections') },
  { id: 'j', name: 'SI JOINT- Left', text: body('Left sacroiliac joint injection') },
  { id: 'k', name: 'FACETS L45 L5S1-right', text: body('Right L4-5 and L5-S1 facet joint injections') },
  { id: 'l', name: 'MBB T12L1L2-bilateral', text: body('Bilateral T12, L1 and L2 medial branch blocks') },
  { id: 'm', name: 'L1L2L3mb-bilateral', text: body('Bilateral L1, L2 and L3 medial branch blocks') },
  { id: 'n', name: 'L5 DR blocks bilateral', text: body('Bilateral L5 dorsal ramus blocks') },
  { id: 'o', name: 'HIP left', text: body('Left hip intra-articular injection') },
];
const context = {
  console, Date, Math, JSON, Object, String, Number, Array, RegExp, Error, setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
  getTemplates() { return templates; },
  getTemplateById(id) { return templates.find((t) => t.id === id) || null; },
  getPatients() { return []; }, getKey() { return ''; }, opPrepRender() {}, toast() {}, uns(k) { return k; },
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'feat_mls_opnote_integrity.js' });
const api = context.__mlsOpNoteIntegrity;
assert(api && typeof api.best === 'function' && typeof api.parseProcedureFacts === 'function', 'installed op-note module did not expose the ranker');

let checks = 0;
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg + '\n   got: ' + JSON.stringify(a) + '\n   expected: ' + JSON.stringify(b)); }
function deepEq(a, b, msg) { checks++; assert.deepStrictEqual(a, b, msg); }
const levels = (s) => Array.from(api.parseProcedureFacts(s).levels || []);

/* 1. compact level spellings parse to the levels they name */
deepEq(levels('MBB L3L4L5 bilateral'), ['L3', 'L4', 'L5'], 'a glued run of lumbar levels');
deepEq(levels('FACETS L45 L5S1-right'), ['L4', 'L5', 'S1'], 'a two-digit lumbar run and a lumbosacral pair');
deepEq(levels('TF-L4L5-left'), ['L4', 'L5'], 'a hyphenated file name');
deepEq(levels('MBB T12L1L2-bilateral'), ['T12', 'L1', 'L2'], 'thoracic 12 stays T12 and the lumbar levels split off it');
deepEq(levels('L1L2L3mb-bilateral'), ['L1', 'L2', 'L3'], 'a level glued to a following word');
deepEq(levels('TF-L3and S1 right'), ['L3', 'S1'], 'a level glued to "and"');
deepEq(levels('Right C56 MBB'), ['C5', 'C6'], 'a cervical run');
deepEq(levels('L46 mbb'), [], 'a run holding a non-level digit is not split (L46 is nothing, as the parser always read it)');
deepEq(levels('C89 block'), [], 'nor a cervical run past C8');
eq(api.parseProcedureFacts('TF-L5-S1-RIGHT').approach, 'transforaminal', 'TF reads as transforaminal');
eq(api.parseProcedureFacts('TF-L5-S1-RIGHT').procedureType, 'tfesi', 'and classifies as a transforaminal ESI');
eq(api.parseProcedureFacts('L5 DR blocks bilateral').procedureType, 'facet_mbb', 'a dorsal ramus block classifies with the medial branch family');
eq(api.parseProcedureFacts('SI-Bilateral').procedureType, 'si_injection', 'SI-<side> is the sacroiliac joint injection');
eq(api.parseProcedureFacts('B/L SI joint').procedureType, 'si_injection', 'a bare "SI joint" reason classifies too');
eq(api.parseProcedureFacts('B/L L3, L4MB & L5 DR B #2 PP').procedureType, 'facet_mbb', 'the older "DR B" form still classifies (order of the two rules)');
eq(api.parseProcedureFacts('Referred by Dr. Smith for hip injection').procedureType, 'joint_injection', '"Dr." with a period is a person, not a dorsal ramus');

/* 2. the exact level set wins over a superset with the same tokens */
const leftMbb = api.best('L MBB L3-5');
eq(leftMbb.tpl && leftMbb.tpl.name, 'MBB L3L4L5 -left2', 'L3-L5 picks the L3-L5 template, not the L2-L5 one');
eq(leftMbb.confident, true, 'and is confident');
const rightTf = api.best('R L5-S1 TFESI');
eq(rightTf.tpl && rightTf.tpl.name, 'TF-L5-S1-RIGHT', 'the exactly named right L5-S1 transforaminal template wins');
const leftTf = api.best('L L4-5 TF ESI');
eq(leftTf.tpl && leftTf.tpl.name, 'TF-L4L5-left', 'left L4-5 picks the left L4L5 file');
const facets = api.best('Right L4-5 L5-S1 facet injection');
eq(facets.tpl && facets.tpl.name, 'FACETS L45 L5S1-right', 'compact facet levels match the long-hand reason');
const t12 = api.best('MBB T12 L1 L2 bilateral');
eq(t12.tpl && t12.tpl.name, 'MBB T12L1L2-bilateral', 'thoracolumbar compact name');
const dr = api.best('Bilateral L5 dorsal ramus blocks');
eq(dr.tpl && dr.tpl.name, 'L5 DR blocks bilateral', 'DR file name');
const si = api.best('B/L SI joint');
eq(si.tpl && si.tpl.name, 'SI-Bilateral', 'B/L SI joint picks the bilateral SI file');

/* 3. two copies of the same operative note are not a dead heat */
const twins = api.best('B/L L3 L4 L5 MBB');
eq(!!twins.tpl, true, 'a tie between two copies of the same procedure resolves');
eq(twins.confident, true, 'confidently');
eq(twins.tpl.name, 'MBB L3L4L5 2_ bilateral', 'to the copy with more operative substance');
eq(/equivalent/.test(String(twins.reason)), true, 'and the receipt says the two were equivalent: ' + twins.reason);

/* 4. two copies whose facts DIFFER still refuse - the guess this must never make */
const sideless = api.best('L3 L4 L5 MBB');
eq(sideless.tpl, null, 'a side-less request against left/right/bilateral siblings does not guess a side');
eq(sideless.tie, true, 'it is reported as a tie');

console.log('PASS opnote compact level names and equivalent ties: the installed ranker reads the practice\'s own file names, prefers the exact level set and side, resolves same-procedure duplicates and still refuses a genuine side/level guess (' + checks + ' checks)');

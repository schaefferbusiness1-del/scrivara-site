'use strict';

/* A legacy .doc template must lose Word's binary remains and NOTHING ELSE.
 *
 * b900 shipped _tplStripWordJunk with no test at all. An adversarial audit then
 * executed it against the doctor's own 72 op-note .doc files and found it was
 * DELETING CLINICAL CONTENT:
 *
 *   1. Kadane's window ended at the running-sum PEAK, not at the end of the
 *      authored body. Word-poor tail lines (doses, CPT/ICD codes, disposition,
 *      the physician attestation) drag the sum down without reaching zero, so
 *      the peak froze mid-document and every later line was dropped — past the
 *      s>=0 filter, silently. Measured: 0 of 72 files kept the "OPERATIVE
 *      REPORT" title.
 *   2. Low prose density scored -2, so "Depo-Medrol 80 mg", "LEVELS: L4-L5,
 *      L5-S1" and "CPT: 64483" were deleted INSIDE the window, leaving an
 *      orphan "MEDICATIONS:" header — which reads as an unfilled field and
 *      invites the model to invent the dose.
 *   3. /^h..../i and /^Normal$/ are English: they deleted Hand, Heart, Healed,
 *      HEENT and the clinical value "Normal".
 *
 * The governing rule this file pins: DELETING A CLINICAL LINE IS WORSE THAN
 * LEAVING A STRAY TOKEN. Junk removal must be driven by positive evidence of
 * Word binary, never by a line looking word-poor.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');

/* pull the shipped functions out of the page and run the REAL bytes */
function extract(name) {
  const start = src.indexOf('function ' + name);
  assert(start >= 0, name + ' is missing from ScribeFlow.html');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}
/* strict-mode eval gives a function DECLARATION its own scope, so the source is
   rewritten into an assignment — the bytes of the body are still the shipped
   ones, which is the whole point of reading them out of the page. */
let _tplStripWordJunk, _tplTextForDraft;
eval(extract('_tplStripWordJunk').replace('function _tplStripWordJunk', '_tplStripWordJunk = function'));
eval(extract('_tplTextForDraft').replace('function _tplTextForDraft', '_tplTextForDraft = function'));

const WORD_JUNK = [
  'bjbjÈwÈw',
  'hãjY', 'hX{Ù', 'h)ld', 'h9Wq',
  '[Content_Types].xml',
  '_rels/.rels',
  'theme/theme/themeManager.xml',
  'theme/theme/theme1.xmlPK',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  'Microsoft Office Word',
  'Microsoft Word 97-2003 Document',
  'MSWordDoc',
  'Word.Document.8',
  'Synergy Notebook',
  'ulóóó', 'E÷HÜ', '{æpgL',
].join('\n');

/* A block-style op-note template of the shape the doctor actually uses:
   prose consent paragraph, then the word-poor tail that the defect ate. */
const BLOCK_TEMPLATE = [
  'OPERATIVE REPORT',
  '',
  'Patient: ______',
  'Date of procedure: ______',
  '',
  'PREOPERATIVE DIAGNOSIS',
  'Lumbar radiculopathy',
  '',
  'PROCEDURE PERFORMED',
  'Left L4-L5 transforaminal epidural steroid injection',
  '',
  'DESCRIPTION OF PROCEDURE',
  'Written and verbal consent were obtained after the risks and benefits were discussed with the patient in detail.',
  'The patient was positioned prone on the fluoroscopy table and the skin was prepped and draped in the usual sterile fashion.',
  'Under intermittent fluoroscopic guidance the needle was advanced to the target and contrast confirmed appropriate spread without vascular uptake.',
  'The needle was withdrawn and the site was cleaned and dressed.',
  '',
  'LEVELS: L4-L5, L5-S1',
  '',
  'MEDICATIONS ADMINISTERED:',
  'Depo-Medrol 80 mg',
  'Lidocaine 1% 3 mL',
  'Omnipaque 300, 1 mL',
  '',
  'FINDINGS',
  'Normal',
  '',
  'COMPLICATIONS',
  'None',
  '',
  'DISPOSITION',
  'Stable',
  '',
  'CPT: 64483, 64484',
  'ICD-10: M54.16',
  '',
  '_______________________',
  'Matthew Schaeffer, MD',
].join('\n');

let failures = 0;
function ok(cond, msg, detail) {
  if (cond) { console.log('  pass  ' + msg); return; }
  failures++;
  console.error('  FAIL  ' + msg + (detail ? '\n        ' + detail : ''));
}

/* ---------------------------------------------------------------- 1. junk */
const dirty = BLOCK_TEMPLATE + '\n' + WORD_JUNK;
const cleaned = _tplStripWordJunk(dirty);

ok(!/bjbj/i.test(cleaned), 'the Word binary signature bjbj is removed');
ok(!/\[Content_Types\]\.xml/i.test(cleaned), 'the OOXML part name [Content_Types].xml is removed');
ok(!/Word\.Document|MSWordDoc|Word 97-2003/i.test(cleaned), 'the Word document-type markers are removed');
ok(!/theme\/theme|themeManager/i.test(cleaned), 'the Word theme XML paths are removed');
ok(!/hãjY|hX\{Ù|h\)ld/.test(cleaned), 'field-code confetti (h + garble) is removed');

/* ------------------------------------------------- 2. clinical must survive */
const MUST_KEEP = [
  ['OPERATIVE REPORT', 'the note title survives (0 of 72 real files kept it before this fix)'],
  ['Matthew Schaeffer, MD', 'the physician attestation survives — an unsigned note is not a note'],
  ['Depo-Medrol 80 mg', 'a drug WITH ITS DOSE survives (word-poor lines are not junk)'],
  ['Lidocaine 1% 3 mL', 'the local anaesthetic and volume survive'],
  ['Omnipaque 300, 1 mL', 'the contrast agent and volume survive'],
  ['LEVELS: L4-L5, L5-S1', 'the injected spinal levels survive'],
  ['CPT: 64483, 64484', 'the procedure codes survive — a note without them is not billable'],
  ['ICD-10: M54.16', 'the diagnosis code survives'],
  ['COMPLICATIONS', 'the COMPLICATIONS heading survives'],
  ['DISPOSITION', 'the DISPOSITION heading survives'],
  ['Normal', '"Normal" survives — it is a clinical value, not Word\'s Normal.dot'],
  ['None', 'a one-word clinical answer survives'],
  ['Stable', 'a one-word disposition survives'],
];
for (const [needle, msg] of MUST_KEEP) {
  ok(cleaned.indexOf(needle) >= 0, msg, 'missing: ' + JSON.stringify(needle));
}

/* an orphan header is its own hazard: it reads as an unfilled field */
ok(!(/MEDICATIONS ADMINISTERED:/.test(cleaned) && !/Depo-Medrol/.test(cleaned)),
  'MEDICATIONS never survives as an orphan header with its drugs deleted');

/* --------------------------------------------- 3. English is not junk */
const ENGLISH = ['Hand', 'Heart', 'Head', 'Healed', 'HEENT', 'Hips', 'Home', 'Hoarse'];
const engIn = ['ASSESSMENT', ...ENGLISH, 'The patient reports no new symptoms and remains comfortable at rest today.'].join('\n');
const engOut = _tplStripWordJunk(engIn);
for (const w of ENGLISH) {
  ok(engOut.indexOf(w) >= 0, 'the English word "' + w + '" is not mistaken for field-code confetti');
}

/* ------------------------------------------- 4. clean text passes through */
ok(_tplStripWordJunk(BLOCK_TEMPLATE) === BLOCK_TEMPLATE.trim(),
  'a template with NO Word junk is returned byte-identical');
ok(_tplTextForDraft(BLOCK_TEMPLATE) === BLOCK_TEMPLATE,
  'the draft-time gate does not touch a template lacking the Word-binary signature');
ok(/Depo-Medrol 80 mg/.test(_tplTextForDraft(dirty)) && !/bjbj/i.test(_tplTextForDraft(dirty)),
  'the draft-time gate cleans an already-imported dirty template without losing the dose');

/* ------------------------------------ 5. never silently amputate */
const proseOnly = [
  'FOLLOW-UP VISIT',
  'The patient returns for follow-up of chronic low back pain and reports meaningful improvement.',
  'BP 120/80 HR 72 RR 16 SpO2 98%',
  'Plan: continue home exercise program.',
].join('\n');
const proseOut = _tplStripWordJunk(proseOnly);
ok(proseOut.indexOf('BP 120/80 HR 72 RR 16 SpO2 98%') >= 0,
  'a vitals line (zero prose density, no binary) is kept');
const letters = (s) => (String(s).match(/[A-Za-z]/g) || []).length;
ok(letters(proseOut) >= letters(proseOnly) * 0.75,
  'a junk-free document never loses a quarter of its letters');

/* ------------------------------------------------------------------ 6. the
   identity gate must accept the STRIPPED text.

   b897 passed _tplTextForDraft(tpl.text) to the generator, whose
   resolveSelectedTemplate compared the stored text with what it was handed by
   RAW BYTE EQUALITY. For exactly the dirty templates the strip targets the two
   differ, so the draft was REFUSED as "the selected template changed before
   drafting" — blaming the doctor for an edit he never made, with a remedy that
   could not work, and a code draft-all treats as terminal. The feature was dead
   on arrival for its own use case.

   The gate's job is "is this still the selected template", not "are these bytes
   identical". These pin the property both ways. */
const norm = (v) => {
  try { return typeof _tplTextForDraft === 'function' ? String(_tplTextForDraft(v)) : String(v); }
  catch (e) { return String(v); }
};
ok(_tplTextForDraft(dirty) !== dirty,
  'the strip really does change the bytes for a dirty template (else this gate proves nothing)');
ok(norm(dirty) === norm(_tplTextForDraft(dirty)),
  'a Word-junk template compares EQUAL to its own stripped form — it must still draft');
ok(_tplTextForDraft(_tplTextForDraft(dirty)) === _tplTextForDraft(dirty),
  'the strip is idempotent, which is what makes the normalised comparison sound');
ok(norm(dirty) !== norm(BLOCK_TEMPLATE.replace('Depo-Medrol 80 mg', 'Depo-Medrol 40 mg')),
  'a GENUINE edit is still detected — normalising must not blind the staleness check');

/* the shipped gate must actually use the normalised comparison */
const oniSrc = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_integrity.js'), 'utf8');
ok(/_normTpl\(t\.text\)\s*!==\s*_normTpl\(tplText\)/.test(oniSrc),
  'resolveSelectedTemplate compares NORMALISED template text, not raw bytes');
ok(!/if\(S\(t\.text\)!==S\(tplText\)\)/.test(oniSrc),
  'the raw byte-equality comparison is gone from the identity gate');

console.log(failures === 0
  ? 'PASS tpl word-junk strip: Word binary removed, every clinical line survives, and a dirty template still passes the draft identity gate'
  : 'FAIL tpl-word-junk: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);

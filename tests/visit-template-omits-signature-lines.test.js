'use strict';
/* =============================================================================
 * visit-template-omits-signature-lines.test.js  (gen-1.1.0, 2026-09-24)
 *
 * _mlsGenTemplateContract builds the TEMPLATE_CONTRACT block the visit note is
 * written from. It told the model that "attestations - is reproduced
 * VERBATIM", so a template ending "Electronically signed by: [[provider]]"
 * was copied into an UNSIGNED draft; the backend's display check refused the
 * signed-looking note and the visit got a 502 after two billed calls.
 *
 * Proven here against the shipped function (sliced out of the derived
 * ScribeFlow.html and executed):
 *   1. the contract no longer orders attestations reproduced verbatim, and says
 *      signature lines are omitted and the draft is unsigned;
 *   2. a signature or attestation line ("Electronically signed by", "Signed
 *      by", "/s/", "This note was electronically signed") and its name /
 *      credential / signing-date block are removed from the template the model
 *      is shown, in every decorated spelling the backend check reads;
 *   3. clinical lines are kept: a patient-consent field, "w/s/o", and - the
 *      review's R4 cases - "[[plan]]", "[[addendum]]" and a date-of-injury
 *      line sitting under a signature line;
 *   4. all four shells carry the same function.
 * ============================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SHELLS = ['ScribeFlow.html', '1pScribeFlow.html', path.join('1p', 'index.html'), path.join('cloned', 'index.html')];

let checks = 0;
const failures = [];
function ok(cond, msg) { checks++; if (!cond) failures.push(msg); }
function eq(a, b, msg) { checks++; if (a !== b) failures.push(msg + ` (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`); }
function extractFn(src, sig) {
  const s = src.indexOf(sig);
  if (s < 0) throw new Error('could not find ' + sig);
  let i = src.indexOf('{', s + sig.length - 1), d = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(s, i + 1); }
  }
  throw new Error('unbalanced ' + sig);
}

const SIG = 'function _mlsGenTemplateContract(tpl){';
const shipped = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
const FN = extractFn(shipped, SIG);
/* gen-1.1.0: the signature filter is shared with the template reformat pass */
const SIG_HELPER = 'function _mlsTemplateWithoutSignatureLines(text){';
const HELPER = extractFn(shipped, SIG_HELPER);
SHELLS.forEach((f) => {
  eq(extractFn(fs.readFileSync(path.join(ROOT, f), 'utf8'), SIG), FN, f + ' does not carry the same _mlsGenTemplateContract');
  eq(extractFn(fs.readFileSync(path.join(ROOT, f), 'utf8'), SIG_HELPER), HELPER, f + ' does not carry the same _mlsTemplateWithoutSignatureLines');
});

const sandbox = { String, Number, Object, Array, RegExp, JSON };
vm.createContext(sandbox);
vm.runInContext(HELPER + '\n' + FN + '\n' +
  'function _tplTextForDraft(t){ return String(t||""); }\n' +
  'function _mlsTplPromptSanitize(t){ return {text:String(t||""),stripped:0,source:"local-port"}; }\n' +
  'function _mlsTplSectionLines(t){ return String(t||"").split("\\n").filter(function(l){ return /^[A-Z][A-Z /&]+:/.test(l.trim()); }).map(function(l){ return l.trim().slice(0, l.trim().indexOf(":")+1); }); }\n',
  sandbox, { filename: 'ScribeFlow.html#_mlsGenTemplateContract' });
function build(text) {
  return vm.runInContext('_mlsGenTemplateContract(' + JSON.stringify({ id: 'tpl_1', name: 'Office visit', text }) + ')', sandbox);
}
function templateShown(c) {
  const b = c.block;
  const a = b.indexOf('TEMPLATE TO REPRODUCE - every line of it, in this order:\n"""\n');
  const z = b.indexOf('\n"""', a + 60);
  return b.slice(a + 'TEMPLATE TO REPRODUCE - every line of it, in this order:\n"""\n'.length, z);
}
/* The line-start signature spellings the backend's display check refuses. */
const SIGNATURE_LINE = /^\s*(?:[-–—•*_#]+\s*|\d+[.)]\s*)*(?:(?:(?:provider|physician|clinician|attending|electronic|e-?)\s*)?(?:signature|attestation)\s*:\s*[*_]*\s*)?(?:electronically\s+signed|e-?signed|signed\s+by|\/s\/|I attest that I have reviewed|(?:this|the)\s+note\s+was\s+electronically\s+signed)/im;

/* ---------------------------------------------------------------------------
 * 1. THE WORDING
 * ------------------------------------------------------------------------- */
const VISIT = [
  'HISTORY OF PRESENT ILLNESS:',
  '[[hpi]]',
  'PHYSICAL EXAMINATION:',
  '[[exam]]',
  'PLAN:',
  '[[plan]]',
  'Electronically signed by: [[provider]]'
].join('\n');
const c1 = build(VISIT);
ok(c1 && typeof c1.block === 'string', 'no contract was built for a visit template');
ok(c1.block.indexOf('attestations - is reproduced VERBATIM') < 0, 'the contract still orders attestations reproduced verbatim');
ok(!/standing instructions, attestations/.test(c1.block), 'attestations are still in the verbatim list');
ok(c1.block.indexOf('headings, field labels, boilerplate sentences, standing instructions - is reproduced VERBATIM') > 0,
  'the verbatim rule for the rest of the template was lost');
ok(c1.block.indexOf('THE DRAFT IS UNSIGNED - SIGNATURE LINES ARE OMITTED.') > 0, 'the contract does not say the draft is unsigned and signature lines are omitted');
ok(/"Electronically signed by", "Signed by" or "\/s\/"/.test(c1.block), 'the contract does not name the signature spellings it omits');
ok(/patient-consent field, is an ordinary template line and is reproduced/.test(c1.block), 'the contract does not keep clinical lines that mention signing');
ok(/the draft is unsigned, so no signature line is written/.test(c1.sysLine), 'the system line still orders every template line reproduced, signature lines included');

/* ---------------------------------------------------------------------------
 * 2. THE LINES THE MODEL IS SHOWN
 * ------------------------------------------------------------------------- */
const shown1 = templateShown(c1);
ok(shown1.indexOf('Electronically signed by') < 0, 'the signature line still reaches the model');
ok(!SIGNATURE_LINE.test(shown1), 'a signature line still opens a template line the model is shown');
ok(c1.templateText.indexOf('Electronically signed by') < 0, 'the template the note is graded against still carries the signature line');
eq(c1.signatureLinesOmitted, 1, 'the omitted line is not counted');
ok(shown1.indexOf('PLAN:\n[[plan]]') >= 0, 'template lines above the signature were lost');

const DECORATED = [
  'HISTORY OF PRESENT ILLNESS:', '[[hpi]]', 'PLAN:', '[[plan]]',
  '[[provider_name]], MD',
  'Electronically signed [[date_signed]]',
  'Date: ______',
  '- /s/ Jane Doe, MD',
  'NPI: [[npi]]',
  '**Electronically signed by Dr. Smith, MD**',
  'Signature: Electronically signed by [[provider]]',
  '1. Signed by: [[physician]]',
  'This note was electronically signed by Dr. Smith',
  'I attest that I have reviewed the documentation above.'
].join('\n');
const c2 = build(DECORATED);
const shown2 = templateShown(c2);
ok(!SIGNATURE_LINE.test(shown2), 'a decorated signature line still reaches the model: ' + JSON.stringify((shown2.match(SIGNATURE_LINE) || [''])[0]));
['[[provider_name]], MD', 'Date: ______', 'Jane Doe', 'NPI: [[npi]]', 'Dr. Smith'].forEach((frag) => {
  ok(shown2.indexOf(frag) < 0, 'a line of the signature block still reaches the model: ' + frag);
});
eq(shown2, 'HISTORY OF PRESENT ILLNESS:\n[[hpi]]\nPLAN:\n[[plan]]', 'the clinical template lines did not survive intact');

/* ---------------------------------------------------------------------------
 * 3. CLINICAL LINES STAY
 * ------------------------------------------------------------------------- */
const CONSENT = [
  'PROCEDURE CONSENT:',
  'Injection consent was electronically signed by the patient: [[yes_no]]',
  'Pain w/s/o radiation: [[pain]]',
  'Consent signed by patient and witness: [[consent]]'
].join('\n');
const c3 = build(CONSENT);
eq(templateShown(c3), CONSENT, 'a clinical line that only mentions signing was removed');
eq(c3.signatureLinesOmitted, 0, 'clinical lines were counted as signature lines');

/* R4 (review): what sits BELOW a signature line is kept unless it names the signer. */
[
  ['Signed by: [[provider]]\n[[plan]]', '[[plan]]'],
  ['Electronically signed by: [[provider]]\n[[addendum]]', '[[addendum]]'],
  ['Electronically signed by [[provider]]\nDate: [[date_of_injury]]', 'Date: [[date_of_injury]]']
].forEach(([tpl, kept]) => {
  const c = build('PLAN:\n' + tpl);
  const shown = templateShown(c);
  ok(shown.indexOf(kept) >= 0, 'a clinical line under a signature line was removed: ' + kept);
  ok(!SIGNATURE_LINE.test(shown), 'the signature line itself survived beside ' + kept);
});

/* A template that is ONLY a signature block states nothing to reproduce. */
eq(build('Electronically signed by: [[provider]]\n[[provider_name]], MD'), null, 'a signature-only template still produced a contract');

if (failures.length) {
  console.error(`FAIL visit-template-omits-signature-lines: ${failures.length} of ${checks} checks failed`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`PASS visit-template-omits-signature-lines: ${checks} checks`);

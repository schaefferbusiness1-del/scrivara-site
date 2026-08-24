'use strict';

/* THE PATIENT WAS TOLD TO CALL AN OFFICE THE HANDOUT COULD NOT NAME (b823)
 *
 * feat_after_visit_summary.js ends every patient handout with, verbatim from its
 * own system prompt:
 *
 *     "End with one short reassuring line telling the patient to contact the
 *      clinic with any questions."
 *
 * And buildSource() — the "EXACT, factual source packet handed to the model" —
 * carried the patient's first name, visit date, chief complaint, problems,
 * medications, allergies and the full note. It carried NO practice name and NO
 * phone number. So the patient went home with a document telling them to ring an
 * office it never named, on a number it never gave, while getPracticeName() and
 * getClinicPhone() sat in Settings and the shared PDF letterhead already read
 * both of them.
 *
 * THE CARE THIS NEEDS, because it is an LLM prompt and not a template:
 *
 *   1. The two facts are labelled NON-CLINICAL and kept OUT of the clinical
 *      block. This module's entire premise is that the note is the only source of
 *      findings; an administrative fact drifting into "What we found" would be
 *      exactly the fabrication it exists to prevent.
 *   2. When a fact is missing the packet says NOT CONFIGURED in words, and the
 *      prompt forbids inventing, guessing or reformatting a number. A blank field
 *      is something a model will helpfully fill in; a stated absence is not.
 *
 * Both are asserted by executing buildSource() against the module's real code.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const AVS = read('feat_after_visit_summary.js');

function block(src, header) {
  const at = src.indexOf(header);
  assert(at >= 0, 'missing declaration: ' + header);
  const brace = src.indexOf('{', at);
  let depth = 0, quote = '', esc = false, line = false, comment = false;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (comment) { if (ch === '*' && next === '/') { comment = false; i++; } continue; }
    if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { comment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unterminated: ' + header);
}
function lineDecl(src, needle) {
  const at = src.indexOf(needle);
  assert(at >= 0, 'missing declaration: ' + needle);
  const end = src.indexOf('\n', at);
  return src.slice(at, end < 0 ? src.length : end);
}

/* ---- buildSource(), executed against the module's own helpers ---------- */
const PRELUDE =
  lineDecl(AVS, 'function S(x)') + '\n' +
  block(AVS, 'function listOrAbsent(') + '\n' +
  block(AVS, 'function avsPracticeName()') + '\n' +
  block(AVS, 'function avsClinicPhone()') + '\n' +
  block(AVS, 'function firstName(name)') + '\n' +
  block(AVS, 'function buildSource(pt, note)');

function packet(settings, pt, note) {
  const ctx = { String, Array, Object, console, JSON };
  ctx.window = {};
  if (settings.practice !== undefined) ctx.window.getPracticeName = () => settings.practice;
  if (settings.phone !== undefined) ctx.window.getClinicPhone = () => settings.phone;
  if (settings.throws) {
    ctx.window.getPracticeName = () => { throw new Error('settings unavailable'); };
    ctx.window.getClinicPhone = () => { throw new Error('settings unavailable'); };
  }
  vm.createContext(ctx);
  vm.runInContext(PRELUDE + '\nthis.b = buildSource;', ctx);
  return String(ctx.b(pt || { name: 'Doe, Jane' }, note || { text: 'Knee exam normal.', created: '2026-07-22T10:00:00Z' }));
}

const PRACTICE = 'Chester County Spine Care';
const PHONE = '(555) 123-4567';

/* ---- 1. POSITIVE CONTROL: the packet still carries what it always did --- */
{
  const p = packet({ practice: PRACTICE, phone: PHONE });
  for (const required of ['PATIENT FIRST NAME: Jane', 'VISIT DATE:', 'PROBLEM LIST:',
    'MEDICATIONS ON FILE:', 'ALLERGIES:', 'FULL VISIT NOTE']) {
    assert(p.includes(required),
      'positive control: the source packet lost "' + required + '". Adding two administrative fields ' +
      'must not disturb the clinical packet.\n\n' + p);
  }
  assert(p.includes('Knee exam normal.'), 'positive control: the note text is no longer in the packet');
}

/* ---- 2. THE PRACTICE AND ITS NUMBER REACH THE PACKET ------------------- */
{
  const p = packet({ practice: PRACTICE, phone: PHONE });
  assert(p.includes(PRACTICE),
    'the practice name still does not reach the handout, so the closing line tells the patient to ' +
    'contact an office it cannot name.\n\n' + p);
  assert(p.includes(PHONE),
    'the clinic phone still does not reach the handout, so the patient is told to call with no number ' +
    'to call.\n\n' + p);

  /* NON-CLINICAL, and labelled so. This module's premise is that the note is the
     only source of findings. */
  const nameLine = p.split('\n').find((l) => l.includes(PRACTICE)) || '';
  const phoneLine = p.split('\n').find((l) => l.includes(PHONE)) || '';
  for (const [what, l] of [['practice name', nameLine], ['practice phone', phoneLine]]) {
    assert(/non-clinical/i.test(l),
      'the ' + what + ' is not labelled non-clinical. Unlabelled, it can drift into "What we found" — ' +
      'which is the exact fabrication this module exists to prevent. Line: ' + l);
    assert(/closing line only/i.test(l),
      'the ' + what + ' does not say what it is FOR. Line: ' + l);
  }
  /* and they sit OUTSIDE the verbatim clinical block */
  const clinicalAt = p.indexOf('FULL VISIT NOTE');
  assert(clinicalAt > 0, 'the clinical block marker is gone');
  assert(p.indexOf(PRACTICE) < clinicalAt && p.indexOf(PHONE) < clinicalAt,
    'an administrative fact was placed inside the verbatim clinical block handed to the model as "the ' +
    'ONLY clinical source for findings, plan and instructions"');
}

/* ---- 3. A MISSING FACT IS STATED, NOT LEFT BLANK ---------------------- */
/* A blank field is something a model will helpfully fill in. A stated absence is
   not. This is the difference between an honest handout and an invented number. */
{
  const cases = [
    ['nothing configured at all', {}],
    ['getters absent from the page', {}],
    ['practice set, no phone', { practice: PRACTICE }],
    ['phone set, no practice', { phone: PHONE }],
    ['empty strings', { practice: '', phone: '' }],
    ['whitespace only', { practice: '   ', phone: '  ' }],
    ['getters that throw', { throws: true }]
  ];
  for (const [why, settings] of cases) {
    /* Named rather than left to crash: a Settings getter that is absent or throws
       used to take this loop down with a bare TypeError, which reports a broken
       test rather than the broken product. This runs on a click in the doctor's
       visit view — a throw here is a dead button. */
    let p;
    try { p = packet(settings); }
    catch (e) {
      assert.fail(why + ': building the source packet THREW (' + (e && e.message) + '). Every Settings ' +
        'read here must be guarded — this runs on a click and an exception is a dead Patient-summary button.');
    }
    const nameLine = p.split('\n').find((l) => l.startsWith('PRACTICE NAME')) || '';
    const phoneLine = p.split('\n').find((l) => l.startsWith('PRACTICE PHONE')) || '';
    assert(nameLine && phoneLine, why + ': one of the two fields vanished from the packet entirely.\n\n' + p);
    if (!settings.practice || !String(settings.practice).trim()) {
      assert(/NOT CONFIGURED/.test(nameLine),
        why + ': a missing practice name is left blank instead of stated. A blank field invites the ' +
        'model to supply one. Line: ' + nameLine);
    }
    if (!settings.phone || !String(settings.phone).trim()) {
      assert(/NOT CONFIGURED/.test(phoneLine),
        why + ': a missing phone number is left blank instead of stated — the one field where a helpful ' +
        'guess reaches a patient as a number to dial. Line: ' + phoneLine);
    }
    /* nothing may ever throw: this runs on a click in the doctor's visit view */
    assert(!/undefined|null|NaN|\[object/.test(nameLine + phoneLine),
      why + ': a raw undefined/null leaked into the prompt. Lines: ' + nameLine + ' | ' + phoneLine);
  }
  /* and the whole thing survives a throwing settings layer */
  assert.doesNotThrow(() => packet({ throws: true }), 'a throwing Settings getter takes the summary down');
}

/* ---- 4. THE PROMPT TELLS THE MODEL WHAT TO DO WITH THEM ---------------- */
/* Facts in the packet with no instruction is half a connection: the model may or
   may not use them, and may or may not invent when they are absent. */
{
  /* EVALUATE SYS_PROMPT rather than slicing its source. It is an array joined with
     '\n' at runtime, so a single instruction can span two elements — asserting on
     the source text reported "the prompt does not forbid reformatting" about a
     prompt that forbids exactly that, one array element later. What the model
     receives is the joined string, so that is what gets asserted. */
  const at = AVS.indexOf('var SYS_PROMPT');
  assert(at > 0, 'SYS_PROMPT was not found');
  const JOIN = "].join('" + String.fromCharCode(92) + "n')";
  const end = AVS.indexOf(JOIN, at);
  assert(end > at, 'SYS_PROMPT is no longer an array joined with newlines');
  const prompt = vm.runInNewContext(AVS.slice(at, end + JOIN.length) + '; SYS_PROMPT', {});
  assert(typeof prompt === 'string' && prompt.length > 400,
    'control: SYS_PROMPT did not evaluate to the joined prompt string (' + typeof prompt + ')');

  assert(/PRACTICE NAME and PRACTICE PHONE/.test(prompt),
    'the prompt never mentions the two new fields, so whether the closing line uses them is left to ' +
    'chance');
  assert(/NOT CONFIGURED/.test(prompt),
    'the prompt does not tell the model what NOT CONFIGURED means, so it may render the literal string ' +
    'to the patient or invent a replacement');
  assert(/NEVER invent,\s+guess or reformat a phone number/.test(prompt),
    'the prompt does not forbid inventing or REFORMATTING a phone number. Reformatting matters as much ' +
    'as inventing: a model that "tidies" a number can change a digit.');
  assert(/never name a practice that was not supplied/.test(prompt),
    'the prompt does not forbid naming a practice that was not supplied');
  assert(/NOT clinical findings and must not appear anywhere/.test(prompt),
    'the prompt does not fence the two administrative facts out of the clinical sections');

  /* the ABSOLUTE RULES that make this module trustworthy must all survive */
  for (const rule of [
    'Use ONLY the information in the provided visit note and structured fields below.',
    'NEVER invent or assume diagnoses, test results, medications, doses, instructions, or follow-up',
    'Do not add a diagnosis the note does not state.'
  ]) {
    assert(prompt.includes(rule),
      'an ABSOLUTE RULE was lost while adding the practice fields: "' + rule + '"');
  }
  /* the output sections are unchanged — no new patient-visible heading */
  for (const h of ['What we did today', 'What we found', 'Your medications',
    'Your instructions and next steps', 'Follow-up']) {
    assert(prompt.includes(h), 'the output section "' + h + '" disappeared');
  }
}

/* ---- 5. IT REACHES A BROWSER ------------------------------------------ */
{
  const connect = read('mls-connect.js');
  const loaderAt = connect.indexOf("var A='feat_after_visit_summary.js'");
  const loaderEnd = connect.indexOf('/* ---- loader: feat_mls_protocol', loaderAt);
  assert(loaderAt >= 0 && loaderEnd > loaderAt, 'feat_after_visit_summary.js has no bounded loader in mls-connect.js');
  const loader = connect.slice(loaderAt, loaderEnd);
  assert(loader.includes("document.createElement('script')"), 'the after-visit summary loader no longer creates its script after a missing/stale owner');
  assert(loader.includes("s.src='/'+A+'?v='+(window.__MLS_AV||Date.now())"),
    'the after-visit summary is loaded without tying its URL to the app build number, so bumping the build no longer busts its cache');
  assert(loader.includes("function ensure()") && loader.includes("window.__mlsEnsureAfterVisitSummary=ensure"),
    'the action-time idempotent after-visit summary readiness hook is missing');
}

console.log('PASS after-visit summary names the practice to call: the handout ended by telling the ' +
  'patient to "contact the clinic" while the source packet carried no practice name and no phone — ' +
  'both sat in Settings and the shared PDF letterhead already read them. They now reach the packet ' +
  'labelled NON-CLINICAL and placed outside the verbatim clinical block, a missing one says NOT ' +
  'CONFIGURED in words rather than leaving a blank a model would fill, seven absent/empty/throwing ' +
  'states leak no undefined and take nothing down, and the prompt forbids inventing OR reformatting a ' +
  'number while every ABSOLUTE RULE and output section is asserted intact');

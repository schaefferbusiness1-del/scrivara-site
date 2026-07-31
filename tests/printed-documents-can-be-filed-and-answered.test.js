'use strict';

/* TWELVE PRINTED DOCUMENTS COULD NOT BE FILED, AND A HANDOUT COULD NOT BE ANSWERED (b828)
 *
 * 1. printExtra(title, bodyId) is the print path for TWELVE generated documents —
 *    the after-visit summary, the referral letter, the IME report, the medical-legal
 *    report, utilization review, the superbill, the good faith estimate, three
 *    analysis reports and the custom-widget printouts. Its header printed:
 *
 *        Patient: <label> · Provider: <name> · <timestamp>
 *
 *    No DOB. No MRN. None of the twelve could be filed against a chart without
 *    somebody hand-annotating it — while activePatient() holds both, and TWO
 *    SIBLING BUILDERS IN THE SAME FILE already print exactly this triple:
 *    buildOrdersPrintHTML() and buildPriorAuthPrintHTML(), both
 *    `[ap.sex, ap.dob, ap.mrn && 'MRN '+ap.mrn]`.
 *
 * 2. printHandout() ends a sheet the PATIENT TAKES HOME with "Call the office with
 *    any questions." — naming neither the office nor a number, with
 *    getPracticeName() and getClinicPhone() both in scope. This is the same defect
 *    b823 fixed in the after-visit summary; b823 touched only
 *    feat_after_visit_summary.js and its test reads only that file, so this surface
 *    survived it. That is worth stating: a test scoped to one module cannot protect
 *    a defect class, and this one recurred one file away.
 *
 * Both are DISPLAYS of stored facts, not inferences. Each part appears only when the
 * chart or Settings actually holds it, and both degrade to exactly their previous
 * output when nothing is configured — asserted, because "no worse than before" is
 * the property that makes a change to a printed clinical document safe.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function fnBody(src, header) {
  const at = src.indexOf(header);
  assert(at >= 0, 'missing function: ' + header);
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
const ESC = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---- 1. printExtra()'s HEADER, EXECUTED -------------------------------- */
const PE = fnBody(APP, 'function printExtra(title,bodyId){');

function headerOf(patient) {
  /* run only the two declarations plus the one header line, so this measures the
     product's own expression rather than a paraphrase of it */
  const decl = PE.split('\n').filter((l) => /_peAp=|_peMeta=/.test(l)).join('\n');
  assert(decl.includes('_peAp=') && decl.includes('_peMeta='),
    'printExtra no longer resolves the patient chart for its header');
  const lineSrc = PE.split('\n').find((l) => l.includes('<div class="m">Patient:'));
  assert(lineSrc, 'the printExtra header line was not found');
  const ctx = { String, Boolean, Array, console };
  ctx.activePatient = () => patient;
  ctx.esc = ESC;
  ctx.patient = patient ? patient.name : 'Unlabeled';
  ctx.docName = 'Dr. Schaeffer';
  ctx.now = 'Jul 31, 2026, 3:00 PM';
  vm.createContext(ctx);
  vm.runInContext(decl + '\nthis.out = `' + lineSrc.trim() + '`;', ctx);
  return ctx.out;
}

{
  const FULL = { name: 'Doe, Jane', sex: 'F', dob: '12/25/1960', mrn: 'MR-88421' };
  const h = headerOf(FULL);
  assert(/12\/25\/1960/.test(h),
    'the DOB still does not reach the header of the twelve documents that print through printExtra(), so ' +
    'none of them can be filed against a chart without hand-annotation. Header: ' + h);
  assert(/MRN MR-88421/.test(h), 'the MRN still does not reach the header. Header: ' + h);
  assert(/Doe, Jane/.test(h) && /Dr\. Schaeffer/.test(h) && /Jul 31, 2026/.test(h),
    'positive control: the header lost the patient, provider or timestamp it already carried. Header: ' + h);

  /* PARTIAL CHARTS: each part appears only when held. A document that prints
     "MRN undefined" is worse than one that prints nothing. */
  const PARTIAL = [
    ['no MRN', { name: 'A', sex: 'F', dob: '01/02/1970' }, /01\/02\/1970/, /MRN/],
    ['no DOB', { name: 'A', sex: 'F', mrn: 'X1' }, /MRN X1/, /\d{2}\/\d{2}\/\d{4}/],
    ['no sex', { name: 'A', dob: '01/02/1970', mrn: 'X1' }, /01\/02\/1970/, null],
    ['name only', { name: 'A' }, null, /MRN|\d{2}\/\d{2}\/\d{4}/]
  ];
  for (const [why, pt, want, absent] of PARTIAL) {
    const out = headerOf(pt);
    assert(!/undefined|null|NaN|\[object/.test(out), why + ': a raw undefined leaked onto a printed document: ' + out);
    if (want) assert(want.test(out), why + ': a fact the chart holds is missing: ' + out);
    if (absent) assert(!absent.test(out), why + ': a fact the chart does NOT hold was printed anyway: ' + out);
  }

  /* NO ACTIVE PATIENT: the line must be exactly what it was before this change.
     These documents are printed from views where no chart is open. */
  const none = headerOf(null);
  assert.strictEqual(none, '<div class="m">Patient: Unlabeled · Provider: Dr. Schaeffer · Jul 31, 2026, 3:00 PM</div>',
    'with no patient active the header must be byte-identical to its pre-change form; got: ' + none);
  assert(!/ · · /.test(none), 'an empty metadata slot left a dangling separator: ' + none);

  /* it must not throw when activePatient is absent from the page entirely */
  assert.doesNotThrow(() => {
    const decl = PE.split('\n').filter((l) => /_peAp=|_peMeta=/.test(l)).join('\n');
    const ctx = { String, Boolean, Array, console };
    vm.createContext(ctx);
    vm.runInContext(decl + '\nthis.m = _peMeta;', ctx);
    assert.strictEqual(ctx.m, '', 'with no activePatient function the metadata must be empty');
  }, 'printExtra throws when activePatient is not defined — that kills twelve print paths');
}

/* ---- 2. THE PATIENT HANDOUT'S CLOSING LINE, EXECUTED ------------------- */
const PH = fnBody(APP, 'function printHandout(){');

function callLine(practice, phone) {
  const decl = PH.split('\n').filter((l) => /_hoPractice=|_hoPhone=|_hoCall=|^\s{4}\? |^\s{4}: /.test(l)).join('\n');
  assert(/_hoCall=/.test(decl), 'printHandout no longer builds its closing line from Settings');
  const ctx = { String, console };
  ctx.getPracticeName = () => practice;
  ctx.getClinicPhone = () => phone;
  vm.createContext(ctx);
  vm.runInContext(decl + '\nthis.out = _hoCall;', ctx);
  return ctx.out;
}

{
  const PRACTICE = 'Chester County Spine Care', PHONE = '(555) 123-4567';
  assert.strictEqual(callLine(PRACTICE, PHONE), 'Call Chester County Spine Care at (555) 123-4567 with any questions.',
    'the handout still does not tell the patient WHO to call and on WHAT number');
  assert.strictEqual(callLine(PRACTICE, ''), 'Call Chester County Spine Care with any questions.',
    'with a practice name and no phone the handout should still name the practice');
  assert.strictEqual(callLine('', PHONE), 'Call the office at (555) 123-4567 with any questions.',
    'with a phone and no practice name the handout should still give the number');

  /* THE SAFETY PROPERTY: with nothing configured it says exactly what it said
     before, so no practice is worse off than before this change. */
  assert.strictEqual(callLine('', ''), 'Call the office with any questions.',
    'with neither fact configured the wording must be byte-identical to its previous form');
  assert.strictEqual(callLine('  ', '  '), 'Call the office with any questions.',
    'whitespace-only Settings values must be treated as absent, not printed as a blank name');

  /* the phrase the patient reads must actually be wired into the printed sheet */
  assert(/\$\{esc\(_hoCall\)\}/.test(APP),
    'the resolved closing line is computed and never printed — the exact "computed and never used" shape ' +
    'this effort keeps finding');
  assert(!/Follow your physician's specific instructions\. Call the office with any questions\.<\/div>/.test(APP),
    'the hardcoded "Call the office with any questions." still sits in the handout template');
}

/* ---- 3. THE SIBLING PATTERN IS UNCHANGED ------------------------------ */
/* printExtra now matches two builders that were already right. If those two moved,
   this change would be following a pattern that no longer exists. */
{
  const pat = /const ptMeta=ap\?\[ap\.sex,ap\.dob,ap\.mrn\?\('MRN '\+ap\.mrn\):''\]\.filter\(Boolean\)\.join\(' · '\):'';/g;
  const n = (APP.match(pat) || []).length;
  assert.strictEqual(n, 2,
    'expected the two sibling builders (buildOrdersPrintHTML, buildPriorAuthPrintHTML) to still build ptMeta ' +
    'the established way; found ' + n + '. printExtra was changed to match them, so if they moved this ' +
    'change is now following a pattern that is gone.');
}

console.log('PASS printed documents can be filed and answered: printExtra() — the print path for twelve ' +
  'generated documents including the superbill, the IME and the medical-legal report — printed no DOB and ' +
  'no MRN, so none could be filed against a chart, while two sibling builders in the same file already ' +
  'printed exactly that triple. And the printed patient handout said "Call the office" naming neither the ' +
  'office nor a number, one file away from the surface b823 fixed, which its module-scoped test could not ' +
  'protect. Both executed: partial charts print only what is held with no dangling separators, and with ' +
  'nothing configured both outputs are asserted BYTE-IDENTICAL to their pre-change form');

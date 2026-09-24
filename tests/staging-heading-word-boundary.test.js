'use strict';
/* =============================================================================
 * staging-heading-word-boundary.test.js  (hbound-1.0.0, 2026-09-24)
 *
 * The four parsers that turn a note into the five Athena destinations - the
 * shell's _mlsValidateAthenaNote and _flatSoapNote, and writeflow's
 * parseGeneratedSoapSections and parseCanonicalAthenaNote - found a heading
 * with /^\s*(HPI|ROS|EXAM|ASSESSMENT|PLAN)\s*:?\s*(.*)$/i. With no word
 * boundary, any line that merely STARTS with a heading word opened a section.
 * Measured on HEAD before this change:
 *   - "Examination: tender right L4-5." as the exam heading was accepted by
 *     all four, and the Physical Exam destination read "ination: tender
 *     right L4-5."; inside the exam it was a duplicate EXAM and the whole
 *     note was refused.
 * The boundary is now the backend's own EXACT_NOTE_HEADING_RE, byte for byte:
 * a heading word ends at a colon, a space or the line end. Labels that begin
 * with a WHOLE heading word ("Plan of care:", "Exam of lumbar spine:", "HPI
 * details") still read as that section, exactly as the backend reads them;
 * the backend prompt keeps those labels out of the note, and this client
 * never writes them back. They are measured and printed below.
 *
 * Every heading shape the app writes parses exactly as before.
 * ============================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

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

/* The one rule, on both sides of the wire. */
const BOUNDED = '/^\\s*(HPI|ROS|EXAM|ASSESSMENT|PLAN)(?=\\s*:|\\s|$)\\s*:?\\s*(.*)$/i';
const UNBOUNDED = '/^\\s*(HPI|ROS|EXAM|ASSESSMENT|PLAN)\\s*:?\\s*(.*)$/i';
const SHELL_FILES = ['ScribeFlow.html', '1pScribeFlow.html', path.join('1p', 'index.html'), path.join('cloned', 'index.html')];
const WF_FILES = ['feat_mls_writeflow.js', '1p-feat_mls_writeflow.js', 'cloned-feat_mls_writeflow.js'];
SHELL_FILES.forEach((f) => {
  const t = read(f);
  const v = extractFn(t, 'function _mlsValidateAthenaNote(text){');
  const fl = extractFn(t, 'function _flatSoapNote(note){');
  ok(v.indexOf('flat=' + BOUNDED) >= 0, f + ': _mlsValidateAthenaNote does not use the bounded heading rule');
  ok(fl.indexOf('flat=' + BOUNDED) >= 0, f + ': _flatSoapNote does not use the bounded heading rule');
  ok(v.indexOf(UNBOUNDED) < 0 && fl.indexOf(UNBOUNDED) < 0, f + ': an unbounded flat-heading rule survives');
});
WF_FILES.forEach((f) => {
  const t = read(f);
  const g = extractFn(t, 'function parseGeneratedSoapSections(text) {');
  const c = extractFn(t, 'function parseCanonicalAthenaNote(text) {');
  ok(g.indexOf('var flat = ' + BOUNDED + ';') >= 0, f + ': parseGeneratedSoapSections does not use the bounded heading rule');
  ok(c.indexOf('var flat = ' + BOUNDED + ';') >= 0, f + ': parseCanonicalAthenaNote does not use the bounded heading rule');
  ok(g.indexOf(UNBOUNDED) < 0 && c.indexOf(UNBOUNDED) < 0, f + ': an unbounded flat-heading rule survives');
});

/* ---------------------------------------------------------------------------
 * The four shipped parsers, executed
 * ------------------------------------------------------------------------- */
const SHELL = read('ScribeFlow.html');
const WF = read('feat_mls_writeflow.js');
const ctx = { String, Number, Object, Array, RegExp, JSON, Error };
vm.createContext(ctx);
vm.runInContext([
  extractFn(SHELL, 'function _mlsAthenaNoteQualityError(reason){'),
  extractFn(SHELL, 'function _mlsAthenaBodyIsSubstantive(body){'),
  extractFn(SHELL, 'function _mlsValidateAthenaNote(text){'),
  extractFn(SHELL, 'function _flatSoapNote(note){'),
  'var S = function (x) { return x == null ? "" : String(x); };',
  'var DESTINATION = {hpi:"hpi",ros:"ros",exam:"exam",assessment:"assessment",plan:"plan"};',
  extractFn(WF, 'function parseGeneratedSoapSections(text) {'),
  extractFn(WF, 'function parseCanonicalAthenaNote(text) {')
].join('\n'), ctx, { filename: 'staging-parsers.js' });

const KEYS = ['hpi', 'ros', 'exam', 'assessment', 'plan'];
function sectionsOf(list) { const o = {}; (list || []).forEach((s) => { o[s.key] = s.text; }); return o; }
/* Every parser answers {ok, sections:{key:text}}; _flatSoapNote's output is
   read back through the canonical parser so all four compare the same way. */
const PARSERS = {
  _mlsValidateAthenaNote(t) {
    try { return { ok: true, sections: sectionsOf(ctx._mlsValidateAthenaNote(t).sections) }; }
    catch (e) { return { ok: false, reason: e && e.mlsAi ? e.mlsAi.detail : String(e) }; }
  },
  _flatSoapNote(t) {
    const out = ctx._flatSoapNote(t);
    if (!out) return { ok: false, reason: 'null' };
    const back = ctx.parseCanonicalAthenaNote(out);
    return back.ok ? { ok: true, sections: sectionsOf(back.sections) } : { ok: false, reason: 'unparseable output' };
  },
  parseGeneratedSoapSections(t) { const r = ctx.parseGeneratedSoapSections(t); return r.ok ? { ok: true, sections: sectionsOf(r.sections) } : { ok: false, reason: r.reason }; },
  parseCanonicalAthenaNote(t) { const r = ctx.parseCanonicalAthenaNote(t); return r.ok ? { ok: true, sections: sectionsOf(r.sections) } : { ok: false, reason: r.reason }; }
};

const BODY = {
  hpi: 'Low back pain for three months after lifting a box.',
  ros: 'Denies fever, chills or weight loss.',
  exam: 'Tender right L4-5 paraspinals; strength 5/5 bilateral lower extremities.',
  assessment: 'Lumbar radiculopathy, right L5.',
  plan: 'Start physical therapy twice weekly; follow up in four weeks.'
};
const LABEL = { hpi: 'HPI', ros: 'ROS', exam: 'EXAM', assessment: 'ASSESSMENT', plan: 'PLAN' };
function note(heading, over) {
  over = over || {};
  return KEYS.map((k) => (over[k] != null ? over[k] : heading(LABEL[k], BODY[k]))).join('\n');
}

/* ---------------------------------------------------------------------------
 * 1. EVERY HEADING SHAPE THE APP WRITES PARSES EXACTLY AS BEFORE
 * ------------------------------------------------------------------------- */
const SHAPES = [
  ['heading alone with a colon (the contract shape)', (h, b) => h + ':\n' + b],
  ['heading with its text inline', (h, b) => h + ': ' + b],
  ['bare heading with no colon', (h, b) => h + '\n' + b],
  ['lowercase heading, space before the colon', (h, b) => h.toLowerCase() + ' :\n' + b],
  ['indented heading with trailing spaces', (h, b) => '  ' + h + ':   \n' + b],
  ['heading, space, then text with no colon', (h, b) => h + ' ' + b],
  ['heading followed by a dash', (h, b) => h + ' - ' + b],
  ['blank line between sections', (h, b) => h + ':\n' + b + '\n']
];
for (const [label, shape] of SHAPES) {
  const text = note(shape);
  for (const name of Object.keys(PARSERS)) {
    const r = PARSERS[name](text);
    ok(r.ok, `${name}: the app's "${label}" shape no longer parses (${r.reason})`);
    if (!r.ok) continue;
    KEYS.forEach((k) => {
      const want = label === 'heading followed by a dash' ? '- ' + BODY[k] : BODY[k];
      eq(r.sections[k], want, `${name}: the "${label}" shape lost the ${k} text`);
    });
  }
}
{
  const crlf = note(SHAPES[0][1]).replace(/\n/g, '\r\n');
  for (const name of Object.keys(PARSERS)) {
    const r = PARSERS[name](crlf);
    ok(r.ok && r.sections.plan === BODY.plan, `${name}: a CRLF note no longer parses`);
  }
}

/* ---------------------------------------------------------------------------
 * 2. "Examination:" IS EXAM TEXT, NEVER A HEADING
 * ------------------------------------------------------------------------- */
const EXAM_LINE = 'Examination: tender right L4-5 on palpation.';
const inside = note(SHAPES[0][1], { exam: 'EXAM:\n' + BODY.exam + '\n' + EXAM_LINE });
const asHeading = note(SHAPES[0][1], { exam: EXAM_LINE });
for (const name of Object.keys(PARSERS)) {
  const r = PARSERS[name](inside);
  ok(r.ok, `${name}: an "Examination:" line inside the exam was read as a second EXAM heading (${r.reason})`);
  if (r.ok) eq(r.sections.exam, BODY.exam + '\n' + EXAM_LINE, `${name}: the "Examination:" line did not stay in the exam text`);
  const h = PARSERS[name](asHeading);
  ok(!h.ok, `${name}: "Examination:" standing in for the EXAM heading was accepted`);
  ok(!(h.sections && /^ination/.test(h.sections.exam || '')), `${name}: the exam destination reads "ination:..."`);
}
[['Hpi-related:', 'hpi'], ['Rossi test:', 'ros'], ['Planning:', 'plan'], ['Assessments:', 'assessment'], ['Exams:', 'exam']].forEach(([word, k]) => {
  const t = note(SHAPES[0][1], { [k]: LABEL[k] + ':\n' + BODY[k] + '\n' + word + ' see above.' });
  for (const name of Object.keys(PARSERS)) {
    const r = PARSERS[name](t);
    ok(r.ok && r.sections[k].indexOf(word + ' see above.') > 0, `${name}: "${word}" inside ${k} was read as a heading`);
  }
});

/* ---------------------------------------------------------------------------
 * 3. MEASURED: labels that begin with a whole heading word (unchanged, and
 *    the same as the backend's EXACT_NOTE_HEADING_RE)
 * ------------------------------------------------------------------------- */
const PROBES = [
  ['Plan of care:', 'plan', 'Plan of care: physical therapy twice weekly.'],
  ['Exam of lumbar spine:', 'exam', 'Exam of lumbar spine: tender right L4-5.'],
  ['Examination:', 'exam', EXAM_LINE],
  ['HPI details', 'hpi', 'HPI details low back pain for three months.']
];
const lines = [];
for (const [probe, k, line] of PROBES) {
  for (const name of Object.keys(PARSERS)) {
    const i = PARSERS[name](note(SHAPES[0][1], { [k]: LABEL[k] + ':\n' + BODY[k] + '\n' + line }));
    const h = PARSERS[name](note(SHAPES[0][1], { [k]: line }));
    lines.push(`  ${probe.padEnd(22)} ${name.padEnd(27)} inside its section: ${i.ok ? 'kept as text' : 'refused (' + i.reason + ')'};` +
      ` as the heading: ${h.ok ? 'read as ' + k.toUpperCase() + ' ' + JSON.stringify(h.sections[k].slice(0, 24)) : 'refused (' + h.reason + ')'}`);
  }
}
console.log('measured (hbound-1.0.0):\n' + lines.join('\n'));

if (failures.length) {
  console.error(`FAIL staging-heading-word-boundary: ${failures.length} of ${checks} checks failed`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`PASS staging-heading-word-boundary: ${checks} checks`);

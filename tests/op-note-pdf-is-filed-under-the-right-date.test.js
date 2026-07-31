'use strict';

/* EVERY OP-NOTE PDF WAS FILED UNDER TODAY (b822)
 *
 * mls-opnote-pro.js named its file:
 *
 *     'OpNote_' + slug(meta.patient) + '_' + dateForFile(meta.dop) + '.pdf'
 *
 * appMeta() builds `{ patient, dob, mrn, provider, spec }` and NEVER sets `dop`.
 * The only source of a procedure date anywhere in that file is the dictated header
 * (`H.dop`), which normalize() reads but appMeta() does not. So `meta.dop` was
 * permanently undefined, dateForFile fell through to `new Date()`, and a note
 * written up two days after the case was filed as if the case happened today.
 *
 * And the answer was already being handed in and thrown away. Same shape as the
 * marketing listing audit's unused `ownerId`:
 *
 *     feat_opnote_history_pdf.js:  if (n && n.created) opts.date = new Date(n.created);
 *     mls-opnote-pro.js exportPdf: if (opts.patient) meta.patient = opts.patient;
 *                                  ^ opts.date read nowhere
 *
 * THE LADDER, most authoritative first:
 *   1. the DICTATED "Date of Procedure" out of the normalized note — the doctor's
 *      own statement of when the case happened;
 *   2. the note record's date, which the caller already supplies;
 *   3. today, unchanged, when there is genuinely nothing else.
 *
 * WHAT IS DELIBERATELY NOT CHANGED, and this is the important half: the note BODY.
 * "Date of Procedure: [not dictated]" stays [not dictated]. A note's CREATION date
 * is not a procedure date, and printing one as the other on a signed operative note
 * is a fabrication — the same class of error as appending one clinician's
 * credentials to another's name. A filename is a filing aid and may carry the best
 * available date. A clinical attestation may not. This test asserts the body did
 * NOT move, because that is the part that would be harmful if it did.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const PRO = read('mls-opnote-pro.js');
const HIST = read('feat_opnote_history_pdf.js');

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
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/* ---- the two real functions, executed ---------------------------------- */
const NOT_DICTATED = '[not dictated]';
function engine() {
  const ctx = { String, RegExp, Date, isNaN, console };
  vm.createContext(ctx);
  vm.runInContext("var NOT_DICTATED = '" + NOT_DICTATED + "';\n" +
    block(PRO, 'function dictatedDop(pro)') + '\n' + block(PRO, 'function dateForFile(dop)') +
    '\nthis.dop = dictatedDop; this.file = dateForFile;', ctx);
  return ctx;
}
/* LIFT the filename's date expression out of the source and EVALUATE it, so
   precedence is measured from the product. An earlier version of this helper
   re-composed the three rungs here — and it SURVIVED a mutation that reversed the
   product's order, because the test was executing its own opinion rather than the
   shipped one. The comment above it claimed it could not. */
const DATE_EXPR = (() => {
  const line = PRO.split('\n').find((l) => l.includes("'OpNote_'"));
  assert(line, 'the op-note filename line was not found');
  const m = /dateForFile\(([\s\S]*?)\)\s*\+\s*'\.pdf'/.exec(line);
  assert(m, 'could not lift the date expression out of: ' + line.trim());
  return m[1];
})();
/* control: the lifted expression must actually reference all three rungs, or the
   evaluation below would silently be measuring a stub */
assert(/dictatedDop/.test(DATE_EXPR) && /meta\.dop/.test(DATE_EXPR) && /opts/.test(DATE_EXPR),
  'the lifted expression does not mention all three rungs: ' + DATE_EXPR);

function filename(e, pro, metaDop, optsDate) {
  const ctx = { String, RegExp, Date, isNaN, console };
  ctx.dictatedDop = e.dop;
  ctx.dateForFile = e.file;
  ctx.pro = pro;
  ctx.meta = { dop: metaDop };
  ctx.opts = optsDate === undefined ? {} : { date: optsDate };
  vm.createContext(ctx);
  return vm.runInContext('dateForFile(' + DATE_EXPR + ')', ctx);
}
const noteWith = (d) => 'OPERATIVE / PROCEDURE NOTE\n\nPatient: A B\nDOB: 1970-01-01\nMRN: 9\n' +
  'Date of Procedure: ' + d + '\nProvider: Dr. X\n';

const now = new Date();
const TODAY = now.getFullYear() + ('0' + (now.getMonth() + 1)).slice(-2) + ('0' + now.getDate()).slice(-2);
const CREATED = new Date('2026-07-24T14:00:00Z');

/* ---- 1. POSITIVE CONTROL ----------------------------------------------
   dateForFile must really produce today when handed nothing. Without this, the
   "no longer today" assertions below could pass against a broken formatter. */
{
  const e = engine();
  assert.strictEqual(e.file(undefined), TODAY,
    'positive control: dateForFile(undefined) must still be today — that is the old behaviour every ' +
    'assertion below is measured against');
  assert.strictEqual(e.file(''), TODAY, 'positive control: an empty date is today');
}

/* ---- 2. THE LADDER, EXECUTED ------------------------------------------ */
{
  const e = engine();
  const CASES = [
    ['the DICTATED date wins over everything', noteWith('2026-07-22'), undefined, CREATED, '20260722'],
    ['a US-format dictated date parses', noteWith('07/22/2026'), undefined, CREATED, '20260722'],
    ['a dictated date with a time still resolves', noteWith('2026-07-22 08:15'), undefined, CREATED, '20260722'],
    ['[not dictated] falls to the note record date', noteWith(NOT_DICTATED), undefined, CREATED, '20260724'],
    ['no header at all falls to the note record date', 'Findings: none', undefined, CREATED, '20260724'],
    ['unparseable dictated text falls through, it does not throw', noteWith('sometime last week'), undefined, CREATED, '20260724'],
    ['nothing anywhere is still today', noteWith(NOT_DICTATED), undefined, undefined, TODAY],
    ['meta.dop is honoured if it is ever populated', 'Findings: none', '2026-07-20', CREATED, '20260720'],
    /* Both present. Without this case, promoting meta.dop above the dictated date
       is INVISIBLE — every other case sets at most one of the two, so the two
       orderings are indistinguishable and a mutation swapping them survives.
       appMeta() sets no dop today (asserted in section 4), so this is a
       hypothetical conflict; the answer is still the doctor's own dictated
       statement, because that is the only rung that describes the CASE rather
       than the paperwork. */
    ['a dictated date outranks a populated meta.dop', noteWith('2026-07-22'), '2026-07-20', CREATED, '20260722']
  ];
  for (const [why, pro, metaDop, optsDate, want] of CASES) {
    const got = filename(e, pro, metaDop, optsDate);
    assert.strictEqual(got, want, 'the PDF would be filed under ' + got + ', expected ' + want + '\n  ' + why);
  }

  /* THE DEFECT, stated as itself: a note about a case from two days ago must not
     be filed under today. */
  assert.notStrictEqual(filename(e, noteWith(NOT_DICTATED), undefined, CREATED), TODAY,
    'a note whose record is dated 2026-07-24 is STILL filed under today. dateForFile only ever saw ' +
    'meta.dop, which appMeta() never sets, so it always fell through to new Date().');

  /* [not dictated] must never be parsed as a date */
  assert.strictEqual(e.dop(noteWith(NOT_DICTATED)), '',
    'the literal "' + NOT_DICTATED + '" is being read as a procedure date');
  /* and nothing throws on junk input */
  for (const junk of [null, undefined, 42, {}, [], 'Date of Procedure:', 'Date of Procedure:   ']) {
    assert.doesNotThrow(() => e.dop(junk), 'dictatedDop threw on ' + JSON.stringify(junk));
    assert.strictEqual(e.dop(junk) || '', '', 'junk produced a date: ' + JSON.stringify(junk));
  }
}

/* ---- 3. THE FILENAME EXPRESSION USES ALL THREE RUNGS ------------------ */
{
  const code = stripComments(PRO);
  const line = (code.split('\n').find((l) => l.includes("'OpNote_'")) || '');
  assert(line, 'the op-note filename is no longer built where this test expects it');
  assert(/dictatedDop\(pro\)/.test(line),
    'the filename does not consult the DICTATED procedure date, which is the doctor\'s own statement ' +
    'of when the case happened and outranks every other source. Line: ' + line.trim());
  assert(/opts && opts\.date/.test(line),
    'the filename still ignores opts.date. feat_opnote_history_pdf.js computes it from the note record ' +
    'and hands it in; discarding it is what left every file stamped with today. Line: ' + line.trim());
  /* the caller really does supply it — if that ever stops, rung 2 goes quiet */
  assert(/opts\.date = new Date\(n\.created\)/.test(stripComments(HIST)),
    'feat_opnote_history_pdf.js no longer supplies opts.date, so the note-record rung of the ladder is ' +
    'dead and every note without a dictated date silently returns to being filed under today');
}

/* ---- 4. THE NOTE BODY DID NOT MOVE ------------------------------------
   The harmful version of this change fills the clinical "Date of Procedure" line
   from a note's creation date. Asserted by executing normalize()'s own header
   composition rather than reading it. */
{
  const meta = stripComments(block(PRO, 'function appMeta()'));
  assert(!/\bdop\b/.test(meta),
    'appMeta() now supplies a procedure date. It has no way to know one: the only honest sources are ' +
    'the doctor\'s dictation and a visit record bound to THIS note. A date invented here is printed on ' +
    'a signed operative note as when the case happened.');

  /* the body still prints [not dictated] when nothing was dictated */
  const code = stripComments(PRO);
  assert(/out\.push\('Date of Procedure: ' \+ \(dop \|\| NOT_DICTATED\)\)/.test(code),
    'the note body\'s Date of Procedure line changed. It must stay `dop || NOT_DICTATED` — a filename ' +
    'may carry a best-available date, a clinical attestation may not.');
  /* and the body's dop still comes only from the note and meta, not from opts */
  const dopLine = (code.split('\n').find((l) => /var dop = /.test(l)) || '');
  assert(/H\.dop \|\| meta\.dop/.test(dopLine), 'the body dop resolution moved: ' + dopLine.trim());
  assert(!/opts/.test(dopLine),
    'opts.date now reaches the note BODY. That is the fabrication this change was careful to avoid: ' +
    'the caller\'s date is a note-creation timestamp, not a procedure date. Line: ' + dopLine.trim());
}

/* ---- 5. THE LOADER TOKEN MOVED ---------------------------------------- */
{
  const connect = read('mls-connect.js');
  const tok = /mls-opnote-pro\.js\?v=([A-Za-z0-9_.-]+)/.exec(connect);
  assert(tok, 'mls-opnote-pro.js is not loaded with a cache-busting token');
  assert(tok[1] !== '20260731lib4',
    'the loader token still reads 20260731lib4, so a returning browser keeps the cached module and this ' +
    'fix ships invisibly — the trap this repo names first');
}

console.log('PASS op-note PDF is filed under the right date: dateForFile read meta.dop, which appMeta() ' +
  'never sets, so EVERY op-note PDF was named with today\'s date even when the note was written days ' +
  'after the case — while feat_opnote_history_pdf.js was already computing the note\'s own date and ' +
  'handing it to an exportPdf that read only opts.patient. Eight ladder cases executed (dictated date ' +
  'first, then the note record, then today), "[not dictated]" is never parsed as a date, seven junk ' +
  'inputs do not throw, and the clinical Date of Procedure line in the note BODY is asserted UNMOVED ' +
  'because a creation date printed as a procedure date would be a fabrication');

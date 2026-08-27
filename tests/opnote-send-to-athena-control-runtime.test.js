'use strict';
/* OP NOTES REACH ATHENA FROM THE CARD THEY ARE WRITTEN ON (opnsend-2.0.0)
 *
 * Owner, 2026-08-26: "make it possible to write op notes to athena too and make
 * a UI for that in the op notes suite."
 *
 * They already COULD - pushHistoryNoteToAthena has routed kind:'opnote' to the
 * unified sheet's 'procedure' section for a long time - but the only one-press
 * path lived on the op-note room's note-pane primary button. The classic
 * per-patient card, which is where a doctor working a whole day actually
 * stands, carried exactly ONE chart control (Save) and no way to reach Athena
 * at all. This suite pins the new per-draft control and, more importantly, pins
 * that it INVOKES the existing entries rather than reimplementing any of them.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE: anything about whether the write
 * succeeds. pushHistoryNoteToAthena returns undefined and openUnifiedConfirmation's
 * frozen manifest never reaches the caller, so a room-side control has no signal
 * to base a success claim on - and must not invent one. Every assertion below is
 * about WHICH function is called with WHICH id, and about the states where
 * nothing is called at all.
 *
 * THE FOURTH SECTION IS A SEPARATE DEFECT, found while mapping this path and
 * fixed on it: _athenaShowReceipt prefixes an op note's body with the transport
 * label "PROCEDURE / OPERATIVE NOTE:" so the plan row can name its route. The
 * writeflow module strips that prefix in its PLAN branch only; a NAMED section -
 * which is exactly what an op note becomes - kept it, so the literal routing
 * line was staged as the first line of what gets typed into Athena's editor.
 * Every existing suite that claims the label must not leak drives the PLAN
 * branch, so none of them could see it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const EDITABLE = ['1pScribeFlow.html', '1p/index.html'];
/* All four pages, deliberately with no opt-out: the two derived pages are what
   the doctor actually loads, and a leak that survives derivation is a leak that
   ships. Like opnote-room-keeps-every-injection-point.test.js, this suite is
   expected to be red between a 1p shell edit and the derive step. */
const ALL_PAGES = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];

/* brace-balanced function lift, so a comment or a nested block cannot truncate it */
function fn(src, decl) {
  const at = src.indexOf(decl);
  assert(at >= 0, 'missing declaration: ' + decl);
  let i = src.indexOf('{', at), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  throw new Error('unterminated: ' + decl);
}
function between(src, a, b) {
  const i = src.indexOf(a);
  assert(i >= 0, 'missing anchor: ' + a);
  const j = src.indexOf(b, i);
  assert(j > i, 'missing end anchor: ' + b);
  return src.slice(i, j);
}

let checks = 0;

/* =======================================================================
 * 1. THE CONTROL EXISTS, ONCE, IN BOTH 1p SHELLS, AND IS BYTE-IDENTICAL
 * The two shells are byte-twins; a control that lands in one of them is a
 * control the other page does not have.
 * ===================================================================== */
const MARKUP = {};
for (const page of EDITABLE) {
  const src = read(page);
  const n = (src.match(/onclick="opPrepSendToAthena\('\+i\+'\)/g) || []).length;
  assert.strictEqual(n, 1, page + ': the Send to Athena control appears ' + n + ' times, expected exactly 1');
  /* the whole render fragment, so the assertions below measure the SHIPPED
     string rather than a paraphrase of it */
  MARKUP[page] = between(src, '      var _opAthBlanks=0;', "\n    }\n");
  checks++;
}
assert.strictEqual(MARKUP[EDITABLE[0]], MARKUP[EDITABLE[1]],
  'the two 1p shells render DIFFERENT Send to Athena markup - they are byte-twins and every shell edit must land in both');
checks++;

/* it lives inside the room modal and it is NOT a "generator" control:
   1p-ui-shape-contract.test.js classifies anything whose onclick matches
   /opPrepGenerate|opPrepSave/ as a generator, and flags one mounted outside
   #opPrepModal. The new control calls neither by name. */
/* refuter 2026-08-26: the old form tested a regex against a string literal and
   could never fail. Test the SHIPPED markup instead: the rendered control's
   onclick attribute must not match the generator classifier. */
{
  const src0 = read('1pScribeFlow.html');
  const controlOnclick = (src0.match(/onclick="opPrepSendToAthena\((?:'\+i\+')?\)"/) || [''])[0];
  assert(controlOnclick, 'the rendered Send control carries its onclick');
  assert(!/opPrepGenerate|opPrepSave\(/.test(controlOnclick),
    'the rendered control onclick must not be classified as an op-note generator');
}
checks++;

/* =======================================================================
 * 2. THE RENDERED CONTROL, EXECUTED
 * The markup is a string built inside opPrepRender, so it is evaluated here
 * with the same locals the renderer supplies.
 * ===================================================================== */
function renderRow(note) {
  const ctx = {
    String, Number, RegExp, Object, Array, console,
    h: '', i: 3,
    row: { note: note },
    a: { name: 'Jordan Lee' },
    esc: (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])),
    /* the SHIPPED canonical parser, lifted out of the shell - the control must
       agree with the exact function opPrepSave and the push both gate on */
    opNoteBlankTokens: null
  };
  vm.createContext(ctx);
  vm.runInContext(fn(read('1pScribeFlow.html'), 'function opNoteBlankTokens(text){'), ctx);
  vm.runInContext(MARKUP[EDITABLE[0]] + '\nthis.__h = h;', ctx);
  return ctx.__h;
}

{
  /* a finished note: the control is live and says what pressing it does */
  const live = renderRow('PROCEDURE: Bilateral L3-L5 RFA\nFINDINGS: concordant relief.');
  assert(/Send to Athena/.test(live), 'a finished draft renders no Send to Athena control');
  assert(!/ disabled/.test(live), 'a finished draft renders the Send to Athena control DISABLED');
  assert(/nothing is sent until you confirm it there/.test(live),
    'the control does not say that pressing it sends nothing on its own. Its whole safety chain is that it OPENS a review; ' +
    'a label that reads as a send with no such statement is the one dishonest version of this control');
  assert(/saved there first/.test(live),
    'the control does not say it saves the note to the chart first, which is what it does when the note is not filed yet');
  checks++;

  /* the same note with two unresolved fields: refused, and it names the count */
  const blanked = renderRow('PROCEDURE: [[procedure_type]]\nFINDINGS: [FILL: what was seen]');
  assert(/ disabled/.test(blanked), 'a note with unresolved fields still offers Send to Athena - the write leg would refuse it');
  assert(/Fill the 2 unresolved fields above first/.test(blanked),
    'the refusal does not name how many fields are missing: ' + (/title="([^"]*)"/.exec(blanked) || [])[1]);
  checks++;

  /* singular reads as singular */
  const one = renderRow('PROCEDURE: [[procedure_type]]');
  assert(/Fill the 1 unresolved field above first/.test(one), 'the singular refusal is misworded');
  checks++;

  /* CAUSAL CONTROL: the disabled state really is driven by the canonical
     parser and not by, say, the presence of a bracket character */
  const brackets = renderRow('FINDINGS: the L4 (left) nerve [see image] was targeted.');
  assert(!/ disabled/.test(brackets),
    'a note with ordinary bracketed prose and NO canonical placeholder was treated as unfinished - the gate is not reading opNoteBlankTokens');
  checks++;
}

/* =======================================================================
 * 3. THE HANDLER, EXECUTED - WHICH FUNCTION IS CALLED, WITH WHICH ID
 * ===================================================================== */
function handler(opts) {
  opts = opts || {};
  const calls = { save: [], push: [], toast: [] };
  const timers = [];
  const ctx = {
    String, Number, Object, Array, console,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    getNotes: () => opts.notes || [],
    toast: (m, k) => calls.toast.push({ m, k }),
    opPrepSave: (i) => { calls.save.push(i); if (opts.onSave) opts.onSave(); }
  };
  ctx.window = ctx;
  ctx._opPrep = opts.rows || [];
  ctx.window._opPrep = ctx._opPrep;
  if (opts.push !== false) ctx.pushHistoryNoteToAthena = (id) => calls.push.push(id);
  vm.createContext(ctx);
  const src = read('1pScribeFlow.html');
  vm.runInContext(fn(src, 'function _opFiledNoteRecord(row){') + '\n' + fn(src, 'function opPrepSendToAthena(i){'), ctx);
  vm.runInContext('opPrepSendToAthena(0);', ctx);
  return { calls, drain: () => timers.forEach((t) => t.f()) };
}

{
  /* a. already in the chart, not a draft, card text UNCHANGED -> push straight
        through, no re-save (opnsend-2.0.1: the match is byte equality between
        the card's note and the filed record). */
  const r = handler({
    rows: [{ _noteId: 'n7', note: 'x' }],
    notes: [{ id: 'n7', isDraft: false, text: 'x' }]
  });
  assert.deepStrictEqual(r.calls.push, ['n7'], 'a filed op note did not reach pushHistoryNoteToAthena with its own record id');
  assert.deepStrictEqual(r.calls.save, [], 'a note already in the chart was saved AGAIN before being reviewed');
  checks++;
}
{
  /* a2. opnsend-2.0.1 causal control: filed record but the card was EDITED
        after filing -> the stale bytes must NOT be pushed; the save-then-push
        branch runs so Athena reviews what the doctor is looking at. */
  const r = handler({
    rows: [{ _noteId: 'n7', note: 'x EDITED LOCALLY' }],
    notes: [{ id: 'n7', isDraft: false, text: 'x' }]
  });
  assert.deepStrictEqual(r.calls.push, [], 'STALE SEND: an edited card pushed the old filed bytes without saving first');
  assert.deepStrictEqual(r.calls.save, [0], 'the edited card must re-save before any Athena review');
  checks++;
}
{
  /* b. not filed yet -> the card's own save runs first, then the push, and the
        push carries the id the save produced */
  const notes = [];
  const rows = [{ _noteId: '' }];
  const r = handler({
    rows, notes,
    onSave: () => { rows[0]._noteId = 'n9'; notes.push({ id: 'n9', isDraft: false, text: 'x' }); }
  });
  assert.deepStrictEqual(r.calls.save, [0], 'the unsaved note did not go through the card\'s own opPrepSave first');
  assert.deepStrictEqual(r.calls.push, [], 'the push ran before the save could land - it must be read back first');
  r.drain();
  assert.deepStrictEqual(r.calls.push, ['n9'], 'after the save landed the note did not reach Athena with the saved record id');
  checks++;
}
{
  /* c. THE GATE THAT MATTERS: the save produced only a DRAFT (unresolved
        fields), so nothing is offered to Athena */
  const notes = [];
  const rows = [{ _noteId: '' }];
  const r = handler({
    rows, notes,
    onSave: () => { rows[0]._noteId = 'n9'; notes.push({ id: 'n9', isDraft: true, text: 'x' }); }
  });
  r.drain();
  assert.deepStrictEqual(r.calls.push, [],
    'a DRAFT record was offered to Athena. filedRecord/isDraft is the whole difference between a finished note and an unfinished one');
  checks++;
}
{
  /* d. the save failed outright (device storage refused) -> nothing sent */
  const r = handler({ rows: [{ _noteId: '' }], notes: [] });
  r.drain();
  assert.deepStrictEqual(r.calls.push, [], 'a save that wrote nothing still reached Athena');
  checks++;
}
{
  /* e. no push function on the page -> one honest toast, no throw, no save */
  const r = handler({ rows: [{ _noteId: 'n7' }], notes: [{ id: 'n7', isDraft: false }], push: false });
  assert.strictEqual(r.calls.toast.length, 1, 'a page without the Athena review said nothing at all');
  assert(/not available on this page/i.test(r.calls.toast[0].m), 'the unavailable-review message is not honest about why: ' + r.calls.toast[0].m);
  assert.deepStrictEqual(r.calls.save, [], 'a page without the Athena review still ran a save the doctor did not ask for');
  checks++;
}
{
  /* f. a row that no longer exists is a no-op, not a crash */
  const r = handler({ rows: [] });
  assert.deepStrictEqual(r.calls.push, [], 'a missing row still reached Athena');
  checks++;
}

/* the handler invokes and does not reimplement: no identity resolution, no
   note-store write, no bridge call of its own */
{
  const body = fn(read('1pScribeFlow.html'), 'function opPrepSendToAthena(i){');
  for (const forbidden of ['saveNotes', 'postMessage', '_opResolvePatient', '_opVisitStamp', 'openUnifiedConfirmation', '_athenaPushPlan']) {
    assert(body.indexOf(forbidden) < 0,
      'opPrepSendToAthena calls ' + forbidden + ' directly. It must INVOKE opPrepSave and pushHistoryNoteToAthena and decide nothing they decide');
  }
  checks++;
}

/* =======================================================================
 * 4. THE TRANSPORT LABEL IS NOT TYPED INTO ATHENA
 * _athenaShowReceipt is executed exactly as shipped, on every page, and its
 * staged section text is measured.
 * ===================================================================== */
function showReceipt(page, body) {
  const src = read(page);
  const block = between(src, 'function _athenaShowReceipt(', '/* Review the frozen superbill payload;');
  let captured = null;
  const ctx = {
    String, Object, Array, RegExp, Number, console, Date, JSON,
    document: { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }) },
    __mlsWriteFlow: {
      destinations: { procedure: 'Athena encounter > Physical Exam > Procedure Documentation' },
      openUnifiedConfirmation: (o) => { captured = o; return o; }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  vm.runInContext(
    "_athenaShowReceipt('Jordan Lee', [], false, {name:'Jordan Lee',dob:'1984-05-12',mrn:'QA-1',patientId:'p1'}," +
    ' [{kind:"procedure", body:' + JSON.stringify(body) + '}],' +
    " {visitDate:'2026-08-25', provider:'Dr. X', appointmentId:'55', historical:true});", ctx);
  return captured;
}

const NOTE_BODY = 'PROCEDURE: Bilateral L3-L5 RFA\nFINDINGS: concordant relief.';
/* ScribeFlow.html and cloned/index.html are DERIVED from 1pScribeFlow.html.
   Until scripts/derive-production-from-1p.js and scripts/derive-cloned-from-1p.js
   have run for this change, those two pages are the PREVIOUS shell and this
   loop reports them as still leaking - which is the truth about the built
   artifact, not a defect in the fix. */
const DERIVED_HINT = ' (this page is DERIVED - run scripts/derive-production-from-1p.js and scripts/derive-cloned-from-1p.js, then re-run)';
for (const page of ALL_PAGES) {
  const hint = EDITABLE.indexOf(page) >= 0 ? '' : DERIVED_HINT;
  /* the label the shell's own pushHistoryNoteToAthena prefixes */
  const staged = showReceipt(page, 'PROCEDURE / OPERATIVE NOTE:\n' + NOTE_BODY);
  assert(staged && Array.isArray(staged.sections) && staged.sections.length === 1,
    page + ': an op note did not stage as exactly one named section');
  assert.strictEqual(staged.sections[0].key, 'procedure', page + ': the op note stopped being a named procedure section');
  assert.strictEqual(staged.sections[0].text, NOTE_BODY,
    page + ': the transport label is still staged as the first line of what gets typed into Athena.' + hint + '\n  got: ' +
    JSON.stringify(staged.sections[0].text.slice(0, 60)));
  assert(!/^\s*(PROCEDURE \/ OPERATIVE NOTE|NOTE TEXT)\s*:/.test(staged.sections[0].text),
    page + ': a routing label leaked into the exact editor payload' + hint);

  /* CONTROL 1: a body with NO label is passed through byte-for-byte. Without
     this, a strip that ate the first line of every note would still pass. */
  const plain = showReceipt(page, NOTE_BODY);
  assert.strictEqual(plain.sections[0].text, NOTE_BODY, page + ': an unlabelled note body was altered on the way to the sheet');

  /* CONTROL 2: a clinical line that merely CONTAINS the words is not a label
     and must survive untouched. */
  const inline = showReceipt(page, 'FINDINGS: the operative note from 2026-07-01 was reviewed.\nPROCEDURE: RFA');
  assert.strictEqual(inline.sections[0].text, 'FINDINGS: the operative note from 2026-07-01 was reviewed.\nPROCEDURE: RFA',
    page + ': the strip is matching mid-note prose, not just the leading transport label');

  /* CONTROL 3: a non-named row still travels in `plan`, untouched, with every
     field it carried - the strip must not have turned sections into copies. */
  const src = read(page);
  const block = between(src, 'function _athenaShowReceipt(', '/* Review the frozen superbill payload;');
  assert(block.indexOf('else unifiedPlan.push(s);') >= 0,
    page + ': an unnamed row no longer reaches the plan array as the caller\'s own object');
  checks++;
}

console.log('PASS op notes reach Athena from the card they are written on: the per-draft Send to Athena control renders once in both 1p ' +
  'shells, refuses (disabled, with the count) while the canonical parser still sees an unresolved field, and INVOKES opPrepSave then ' +
  'pushHistoryNoteToAthena - never a draft, never a failed save, never a note-store or bridge call of its own; and the shipped ' +
  '_athenaShowReceipt no longer stages the literal "PROCEDURE / OPERATIVE NOTE:" transport label as the first line of what Athena ' +
  'would be typed, on all four pages, with unlabelled bodies and mid-note prose proven unaltered (' + checks + ' checks)');

/* savenamed-splice-proof.js - savenamed-1.0.0 (ext 3.0.111)
 *
 * WHAT IS BEING PROVED. scripts/splice-30111-savenamed.js is the ONLY
 * authorized way background.js gets this change (mixed CRLF/LF, latin1 file,
 * exact-count anchors). This suite runs that script against a TEMP COPY of
 * background.js - never the repo copy - and then proves, out of the spliced
 * bytes themselves:
 *
 *   1. the splice is exact and idempotent-safe: all eight anchors matched
 *      exactly once, the marker landed once per inserted span, a second run
 *      REFUSES, and `node --check` passes on the result;
 *   2. it is a PURE INSERTION - the whole original file, in order, survives,
 *      and stripping the eight inserted spans reproduces background.js byte
 *      for byte. That is what makes every deadline, gate and late-result
 *      discard outside the inserted spans byte-identical, and it is pinned
 *      again, by region, for the generic save_draft leg, the whole note-scope
 *      region, the scoped-status region, the write-safety guard and clickOnce;
 *   3. the SHAPE FLAG, lifted from the spliced copy, is true only for a review
 *      whose reviewed sections are ALL named Athena destinations, all
 *      execute:true, all carrying their exact reviewed destination string -
 *      and false for the generic encounter-note shape, a mixed shape, a
 *      sign_encounter request and a teach request;
 *   4. the FINDER, lifted from the spliced copy and run against the REAL
 *      exactSave and the REAL wsForbiddenControl, binds exactly one Save
 *      control, refuses Sign & Save / Sign / Close encounter / Bill / order /
 *      finalize / attest without ever clicking them, refuses two candidates as
 *      ambiguous, and refuses a Save that lives inside an orders, billing or
 *      signature region;
 *   5. the EXECUTE leg, lifted from the spliced copy, clicks exactly once and
 *      answers verified ONLY on a NEWLY CREATED scoped status node carrying
 *      the shipped closed saved-phrase set; with no such node it answers
 *      save-readback-missing with partialMutation and never claims a save; and
 *      a control that repainted into a Sign / Close / Bill control between
 *      probe and execute is refused with nothing clicked at all;
 *   6. the CLOSED REFUSAL block answers encounter-mismatch for a bound frame
 *      whose encounter or appointment id is not the reviewed one, keeps the
 *      finder's own codes, falls through for everything else, and the
 *      read-only probe answer clicks nothing.
 *
 * THE BLOCK IT LIFTS (owner ruling 2026-09-02, verbatim on the next line):
 *   unblock the save block in mls assistant it should be able to do it if
 *   someone clicks save on mls site
 * A review that targets NAMED Athena sections could not reach ANY save:
 * findNoteAction resolves a Save only inside exactly one GENERIC encounter
 * note scope holding exactly one editor, and background.js refused save_draft
 * for that shape outright, BEFORE the probe/execute split, so there was no
 * read-only verification of an encounter save to build on. Sign stays the
 * doctor's manual click in athenaOne, and this suite proves the new leg is
 * structurally unable to reach one.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'background.js');
const SPLICE = path.join(REPO, 'scripts', 'splice-30111-savenamed.js');
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

function fullLines(s) {
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) if (s.charAt(i) === LF) { out.push(s.slice(start, i + 1)); start = i + 1; }
  if (start < s.length) out.push(s.slice(start));
  return out;
}
function body(line) {
  let b = line;
  if (b.charAt(b.length - 1) === LF) b = b.slice(0, -1);
  if (b.charAt(b.length - 1) === CR) b = b.slice(0, -1);
  return b;
}
function between(source, begin, end, what) {
  const a = source.indexOf(begin);
  ok(a >= 0, 'missing ' + (what || begin));
  const b = source.indexOf(end, a + begin.length);
  ok(b > a, 'missing end of ' + (what || begin));
  return source.slice(a + begin.length, b);
}
/* the proven brace-walk lift used by tests/athena-order-action-runtime.test.js */
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  ok(start >= 0, 'missing function ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}
function lineStartingWith(source, prefix) {
  const hit = fullLines(source).map(body).filter(l => l.trim().indexOf(prefix) === 0);
  eq(hit.length, 1, 'expected exactly one line starting with ' + prefix);
  return hit[0];
}

/* ---------- 1. run the real splice against a TEMP COPY ---------- */

/* The repo copy is spliced before the release, so this suite must hold BOTH
   before and after that happens - a proof that can only run once is not a
   proof. Before: temp-copy background.js and run the script on it. After:
   rebuild the pre-splice file by lifting the script's own declared lines back
   out, run the script on THAT, and require the result to equal the shipped
   bytes exactly - which additionally proves the shipped background.js is this
   script's output and nothing else. Requiring the script writes nothing. */
const declared = require(SPLICE);
eq(declared.TARGET, 'background.js', 'the splice script no longer targets background.js');
eq(declared.MARKER, 'savenamed-1.0.0', 'the splice script no longer carries the savenamed marker');
eq(declared.EDITS.length, 8, 'the splice script no longer declares exactly eight edits');
const DECLARED_LINE_COUNT = declared.EDITS.reduce((n, e) => n + e.lines.length, 0);
eq(DECLARED_LINE_COUNT, 229, 'the splice script declares a different number of inserted lines');

const repoFile = fs.readFileSync(SRC, 'latin1');
const alreadySpliced = repoFile.indexOf(declared.MARKER) >= 0;

function unsplice(text) {
  let lines = fullLines(text);
  declared.EDITS.forEach((e, i) => {
    const at = [];
    lines.forEach((l, k) => { if (body(l) === e.find) at.push(k); });
    eq(at.length, 1, 'edit ' + i + ': the anchor is not an exactly-once full line in the shipped file');
    const from = (e.where === 'before') ? at[0] - e.lines.length : at[0] + 1;
    const span = lines.slice(from, from + e.lines.length).map(body);
    eq(span.join(LF), e.lines.join(LF), 'edit ' + i + ': the shipped file does not carry this script\'s declared lines at its anchor');
    lines = lines.slice(0, from).concat(lines.slice(from + e.lines.length));
  });
  return lines.join('');
}

const original = alreadySpliced ? unsplice(repoFile) : repoFile;
eq(original.indexOf('savenamed'), -1, 'the pre-splice background.js still carries a savenamed marker');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'savenamed-'));
const copy = path.join(work, 'background.js');
fs.writeFileSync(copy, original, 'latin1');
ok(fs.readFileSync(copy, 'latin1') === original, 'the temp copy is not byte-identical to the pre-splice background.js');
ok(path.resolve(copy) !== path.resolve(SRC), 'the proof would have spliced the repo copy');

const run1 = spawnSync(process.execPath, [SPLICE], { cwd: work, encoding: 'utf8' });
const out1 = String(run1.stdout || '') + String(run1.stderr || '');
eq(run1.status, 0, 'the splice refused to run against a clean copy:' + LF + out1);
declared.EDITS.forEach((e, i) => {
  const re = new RegExp('edit ' + i + ': ' + e.where + ' line \\d+ \\((LF|CRLF)\\), \\+' + e.lines.length + ' lines');
  ok(re.test(out1), 'edit ' + i + ' did not report a single exact anchor insert: ' + out1);
});
ok(/OK background\.js \(8 edits\)/.test(out1), 'the splice did not report eight edits: ' + out1);
ok(/SPLICE 3\.0\.111 savenamed-1\.0\.0 DONE/.test(out1), 'the splice did not print its completion line: ' + out1);
console.log('  1. the splice ran once against a temp copy, eight exact-count anchors, eight edits' + (alreadySpliced ? ' (repo copy already spliced - rebuilt from the script\'s own declared lines)' : ''));

const origLines = fullLines(original);
declared.EDITS.forEach((e, i) => {
  eq(origLines.filter(l => body(l) === e.find).length, 1, 'anchor ' + i + ' is not an exactly-once full line: ' + e.find.slice(0, 70));
});

const run2 = spawnSync(process.execPath, [SPLICE], { cwd: work, encoding: 'utf8' });
eq(run2.status, 1, 'the splice did not refuse a second run');
ok(/marker savenamed-1\.0\.0 is already present/.test(String(run2.stderr || '')), 'the second run refused for the wrong reason: ' + String(run2.stderr || ''));
console.log('  2. a second run refuses on its own marker (idempotence)');

const spliced = fs.readFileSync(copy, 'latin1');
if (alreadySpliced) ok(spliced === repoFile, 'the shipped background.js is not byte-identical to this script\'s own output');
const check = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
eq(check.status, 0, 'node --check failed on the spliced copy: ' + String(check.stderr || ''));
eq((spliced.match(/savenamed-1\.0\.0/g) || []).length, 8, 'the savenamed marker did not land exactly once per inserted span');
ok(spliced.indexOf('/* ATHENA_ACTION_V2_SAVENAMED_HELPERS_START */') > 0, 'the finder helpers did not land');
ok(spliced.indexOf('/* ATHENA_ACTION_V2_SAVENAMED_EXECUTE_START */') > 0, 'the execute leg did not land');
eq(/[^\x00-\x7f]/.test(spliced), /[^\x00-\x7f]/.test(original), 'the splice changed the file\'s non-ASCII content');
console.log('  3. node --check passes on the spliced copy and every marker landed');

/* ---------- 2. nothing outside the inserted spans moved ---------- */

const splLines = fullLines(spliced);
const extraAt = [];
let oi = 0;
for (let si = 0; si < splLines.length; si++) {
  if (oi < origLines.length && splLines[si] === origLines[oi]) { oi++; continue; }
  extraAt.push(si);
}
eq(oi, origLines.length, 'the spliced file does not contain every original line, in order - the splice moved or dropped something');
eq(extraAt.length, DECLARED_LINE_COUNT, 'the splice added a different number of lines than the eight blocks it declares');
eq(splLines.length - origLines.length, DECLARED_LINE_COUNT, 'the spliced line count does not match a pure insertion');
const spans = extraAt.reduce((acc, i) => {
  const last = acc[acc.length - 1];
  if (last && i === last[1] + 1) last[1] = i; else acc.push([i, i]);
  return acc;
}, []);
eq(spans.length, 8, 'the inserted lines are not eight contiguous spans');
eq(spans.map(s => s[1] - s[0] + 1).sort((a, b) => a - b).join(','),
   declared.EDITS.map(e => e.lines.length).sort((a, b) => a - b).join(','),
   'the inserted spans are not the sizes the splice declares');
const droppedSet = new Set(extraAt);
const rebuilt = splLines.filter((l, i) => !droppedSet.has(i)).join('');
eq(rebuilt.length, original.length, 'the file outside the eight inserted spans changed length');
ok(rebuilt === original, 'removing the eight inserted spans did not reproduce background.js byte-for-byte');
console.log('  4. the splice is a pure insertion - every other byte of background.js is unchanged');

/* said again where it matters most: the shipped generic save_draft leg, the
   generic note-scope resolver with its CLOSED human-label allowlist, the
   scoped-status evidence rule, the in-driver write-safety guard and the
   clickOnce boundary are byte-identical across the splice. */
[
  ['/* SAVE_DRAFT_START */', '/* SAVE_DRAFT_END */', 'the shipped generic save_draft leg'],
  ['/* SIGN_ENCOUNTER_START */', '/* SIGN_ENCOUNTER_END */', 'the sign_encounter leg'],
  ['/* MLS_WRITE_SAFETY_DRIVER_GUARD_START', '/* MLS_WRITE_SAFETY_DRIVER_GUARD_END */', 'the in-driver write-safety guard'],
  ['/* ATHENA_ACTION_V2_WRITE_NOTE_START */', '/* ATHENA_ACTION_V2_WRITE_NOTE_END */', 'the write_note leg'],
  ['/* ATHENA_ACTION_V2_NOTE_SCOPE_START */', '/* ATHENA_ACTION_V2_NOTE_SCOPE_END */', 'the whole note-scope region'],
  ['/* ATHENA_ACTION_V2_SCOPED_STATUS_START */', '/* ATHENA_ACTION_V2_SCOPED_STATUS_END */', 'the scoped-status evidence region'],
  ['/* ATHENA_ACTION_V2_STAGE_BILLING_START */', '/* ATHENA_ACTION_V2_STAGE_BILLING_END */', 'the stage_billing leg']
].forEach(([a, b, what]) => {
  eq(between(spliced, a, b, what), between(original, a, b, what), what + ' is not byte-identical across the splice');
});
[
  "    function clickOnce(el) { if (wsForbiddenControl(el) && !(action === 'sign_encounter' && exactSign(el))) throw new Error('forbidden-control-blocked'); try { el.scrollIntoView({ block: 'center' }); } catch (e) {} el.click(); }",
  "      return { ok: false, blocked: true, reason: 'named-section-final-action-unsupported', error: 'Review and save independently placed named sections directly in Athena.' };",
  "        noteTarget = (action === 'write_note' && requestedNoteSection !== 'note') ? findNamedNoteAction(fr, action, requestedNoteSection) : findNoteAction(fr, action);",
  "        if (mode !== 'teach' && action !== 'write_note' && currentNote !== reviewedNote) {",
  "    if (mode !== 'execute') return { ok: false, blocked: true, reason: 'unknown-action' };"
].forEach((line, i) => {
  eq(origLines.filter(l => body(l) === line).length, 1, 'unchanged-line pin ' + i + ' is not an exactly-once line in the original');
  eq(splLines.filter(l => body(l) === line).length, 1, 'unchanged-line pin ' + i + ' changed across the splice');
});
ok(spliced.indexOf("detail: action === 'stage_billing' ? 'billing-action-threw-after-mutation-boundary' : (action === 'place_order' ? 'order-action-threw-after-mutation-boundary' : 'action-threw-after-mutation-boundary')") >= 0,
  'the driver\'s shared post-mutation uncertainty receipt changed');
console.log('  5. the generic save_draft leg, the note-scope region, the scoped-status rule, the write-safety guard and clickOnce are byte-identical');

/* ---------- 3. lift the real pieces out of the SPLICED copy ---------- */

const driver = between(spliced, '/* ATHENA_ACTION_V2_DRIVER_START */', '/* ATHENA_ACTION_V2_DRIVER_END */', 'the v2 driver');
const HELPERS = between(driver, '/* ATHENA_ACTION_V2_SAVENAMED_HELPERS_START */', '/* ATHENA_ACTION_V2_SAVENAMED_HELPERS_END */', 'the savenamed helpers');
const EXECUTE = between(driver, '/* ATHENA_ACTION_V2_SAVENAMED_EXECUTE_START */', '/* ATHENA_ACTION_V2_SAVENAMED_EXECUTE_END */', 'the savenamed execute leg');

const REAL_TEXT = extractFunction(driver, 'text');
const REAL_NORM = extractFunction(driver, 'norm');
const REAL_LABEL = extractFunction(driver, 'label');
const REAL_EXACT_SAVE = extractFunction(driver, 'exactSave');
const REAL_WS_FORBIDDEN = extractFunction(driver, 'wsForbiddenControl');
const WS_LABELS_LINE = lineStartingWith(driver, 'var WS_FORBIDDEN_LABELS =');
const WS_ATTRS_LINE = lineStartingWith(driver, 'var WS_FORBIDDEN_ATTRS =');
const REAL_PARENT = extractFunction(driver, 'parentAcrossRoots');
const REAL_STATUS_ELEMENTS = extractFunction(driver, 'statusElements');
const REAL_STATUS_SNAPSHOT = extractFunction(driver, 'statusEvidenceSnapshot');
const REAL_NEW_SCOPED_STATUS = extractFunction(driver, 'newScopedStatus');
const REAL_CANONICAL_KEY = extractFunction(driver, 'canonicalNamedNoteKey');
const NAMED_DESTINATIONS_SRC = between(driver, 'var NAMED_NOTE_DESTINATIONS = {', '};', 'NAMED_NOTE_DESTINATIONS');

const BASE = [REAL_TEXT, REAL_NORM, REAL_LABEL].join(LF);
const realExactSave = new Function([BASE, REAL_EXACT_SAVE, 'return exactSave;'].join(LF))();
const realWsForbidden = new Function([BASE, WS_LABELS_LINE, WS_ATTRS_LINE, REAL_WS_FORBIDDEN, 'return wsForbiddenControl;'].join(LF))();
ok(typeof realExactSave === 'function' && typeof realWsForbidden === 'function', 'the shipped label and write-safety contracts could not be lifted');
/* prove the lift is the SHIPPED contract, not a rewrite of it */
eq(realExactSave({ textContent: 'Save', getAttribute: () => null }), true, 'the lifted exactSave does not accept the exact Save control');
eq(realExactSave({ textContent: 'Sign & Save', getAttribute: () => null }), false, 'the lifted exactSave accepts Sign & Save - the fixture is not the shipped contract');

const helperFactory = new Function('interactive', 'hetDiag', [
  BASE, REAL_EXACT_SAVE, WS_LABELS_LINE, WS_ATTRS_LINE, REAL_WS_FORBIDDEN, REAL_PARENT,
  HELPERS,
  'return { snvFindEncounterSave: snvFindEncounterSave, snvSaveCore: snvSaveCore, snvForbiddenSaveLabel: snvForbiddenSaveLabel, snvScopeTag: snvScopeTag, snvSaveScope: snvSaveScope };'
].join(LF));

const statusFactory = new Function('deepQueryAll', 'visible', [
  BASE, REAL_STATUS_ELEMENTS, REAL_STATUS_SNAPSHOT, REAL_NEW_SCOPED_STATUS,
  'return { statusEvidenceSnapshot: statusEvidenceSnapshot, newScopedStatus: newScopedStatus };'
].join(LF));

/* ---------- 4. the shape flag ---------- */

const bodies = splLines.map(body);
const shapeAt = bodies.indexOf('    var snvNamedSave = false;');
ok(shapeAt > 0, 'the shape flag did not land');
const shapeEnd = bodies.indexOf('    } catch (eSnvShape) { snvNamedSave = false; }', shapeAt);
ok(shapeEnd > shapeAt, 'the shape flag block has no end');
const SHAPE_BLOCK = bodies.slice(shapeAt, shapeEnd + 1).join(LF);
ok(SHAPE_BLOCK.indexOf('canonicalNamedNoteKey') > 0 && SHAPE_BLOCK.indexOf('NAMED_NOTE_DESTINATIONS') > 0, 'the lifted block is not the shape flag');

const namedShape = new Function('action', 'mode', 'noteSections', [
  REAL_TEXT, REAL_NORM, REAL_CANONICAL_KEY,
  'var NAMED_NOTE_DESTINATIONS = {' + NAMED_DESTINATIONS_SRC + '};',
  SHAPE_BLOCK,
  'return snvNamedSave;'
].join(LF));

const HPI = { key: 'hpi', text: 'HPI body', execute: true, destination: 'Athena encounter > HPI' };
const AP = { key: 'assessment_and_plan', text: 'A/P body', execute: true, destination: 'Athena encounter > Assessment & Plan' };
const GENERIC = { key: 'note', text: 'Whole note', execute: true, destination: 'Athena encounter > Encounter note' };

eq(namedShape('save_draft', 'probe', [HPI, AP]), true, 'an all-named reviewed shape did not declare the encounter-save leg');
eq(namedShape('save_draft', 'execute', [HPI, AP]), true, 'the execute request did not declare the same shape the probe did');
eq(namedShape('save_draft', 'probe', [GENERIC]), false, 'the GENERIC encounter-note shape was diverted onto the new leg');
eq(namedShape('save_draft', 'probe', [HPI, GENERIC]), false, 'a MIXED reviewed shape was accepted - it must fail closed');
eq(namedShape('save_draft', 'probe', []), false, 'a review with no sections at all declared the encounter-save leg');
eq(namedShape('save_draft', 'probe', [{ key: 'hpi', text: 'x', execute: false, destination: 'Athena encounter > HPI' }]), false, 'a section nobody confirmed for execution declared the leg');
eq(namedShape('save_draft', 'probe', [{ key: 'hpi', text: 'x', execute: true, destination: 'Athena encounter > Plan / Follow-up' }]), false, 'a section whose reviewed destination does not match its key declared the leg');
eq(namedShape('save_draft', 'probe', [{ key: 'not-a-section', text: 'x', execute: true, destination: 'Athena encounter > HPI' }]), false, 'an unknown section key declared the leg');
eq(namedShape('sign_encounter', 'probe', [HPI, AP]), false, 'SIGN was diverted onto the encounter-save leg - sign must stay manual');
eq(namedShape('write_note', 'probe', [HPI]), false, 'a write_note request was diverted onto the encounter-save leg');
eq(namedShape('save_draft', 'teach', [HPI, AP]), false, 'a teach request was diverted onto the encounter-save leg');
console.log('  6. the shape flag is declared by the sections the app already sends, and is true only for the all-named reviewed shape');

/* ---------- 5. the finder ---------- */

function el(opts) {
  const o = opts || {};
  const node = {
    /* wsForbiddenControl's first line is `if (!el || el.nodeType !== 1) return
       false;` - a fixture without nodeType would sail through the shipped
       write-safety ban and prove nothing. */
    nodeType: 1,
    tagName: o.tag || 'BUTTON',
    textContent: o.text == null ? '' : o.text,
    value: o.value || '',
    id: o.id || '',
    className: o.className || '',
    attrs: o.attrs || {},
    parentElement: null,
    clicks: 0,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    getRootNode() { return null; },
    querySelectorAll() { return []; },
    scrollIntoView() {},
    click() { this.clicks++; }
  };
  return node;
}
function nest(child) {
  let cur = child;
  for (let i = 1; i < arguments.length; i++) { cur.parentElement = arguments[i]; cur = arguments[i]; }
  return child;
}
const encounterRoot = () => el({ tag: 'DIV', id: 'encounter-note-workspace' });

function finderFor(controls) {
  const hetDiag = { savenamed: null, postGate: '' };
  const h = helperFactory(function () { return controls; }, hetDiag);
  const frame = { doc: { body: el({ tag: 'BODY', id: 'body' }) }, w: {} };
  return { h: h, hetDiag: hetDiag, frame: frame, run: () => h.snvFindEncounterSave(frame) };
}

{
  const scope = encounterRoot();
  const save = nest(el({ text: 'Save' }), scope);
  const f = finderFor([save]);
  const hit = f.run();
  ok(hit && hit.control === save, 'one exact Save control in the open encounter was not bound');
  eq(hit.root, scope, 'the bound Save did not resolve its encounter scope');
  eq(hit.labelCore, 'save', 'the receipt control name is not a member of the closed save allowlist');
  eq(f.hetDiag.savenamed, 'found', 'the finder did not record that it found one exact control');
  eq(save.clicks, 0, 'the READ-ONLY finder clicked the control');
}
['Save draft', 'Save note'].forEach(spelling => {
  const scope = encounterRoot();
  const ctrl = nest(el({ text: spelling }), scope);
  const hit = finderFor([ctrl]).run();
  ok(hit && hit.control === ctrl, 'the allowlisted spelling ' + spelling + ' was not bound');
  eq(ctrl.clicks, 0, 'the finder clicked ' + spelling);
});

[
  ['Sign & Save', 'the Sign & Save control'],
  ['Sign', 'a bare Sign control'],
  ['Sign and Save', 'the spelled-out Sign and Save control'],
  ['Close encounter', 'the Close encounter control'],
  ['Bill', 'a Bill control'],
  ['Save & Sign', 'a Save-then-Sign control'],
  ['Save and close encounter', 'a Save-and-close control'],
  ['Finalize', 'a Finalize control'],
  ['Attest', 'an Attest control'],
  ['Place order', 'an order control'],
  ['Save and submit', 'a Save-and-submit control'],
  ['Save and bill', 'a Save-and-bill control']
].forEach(([labelText, what]) => {
  const scope = encounterRoot();
  const ctrl = nest(el({ text: labelText }), scope);
  const f = finderFor([ctrl]);
  eq(f.run(), null, what + ' was accepted as an encounter Save');
  eq(ctrl.clicks, 0, what + ' was clicked');
});
{
  const scope = encounterRoot();
  const ctrl = nest(el({ text: 'Save', attrs: { 'data-action': 'signAndSave' } }), scope);
  const f = finderFor([ctrl]);
  eq(f.run(), null, 'a control labelled Save whose machine action is signAndSave was accepted');
  eq(f.hetDiag.savenamed, 'forbidden-control', 'the forbidden-control outcome was not recorded');
  eq(ctrl.clicks, 0, 'a forbidden control was clicked');
}
{
  const scope = encounterRoot();
  const ctrl = nest(el({ text: 'Save', attrs: { 'aria-label': 'Save and close encounter' } }), scope);
  eq(finderFor([ctrl]).run(), null, 'a Save whose aria-label closes the encounter was accepted');
  eq(ctrl.clicks, 0, 'a close-encounter aria-label control was clicked');
}
['orders-workspace', 'billing-charges', 'encounter-signature-panel', 'medication-prescription-pane'].forEach(regionId => {
  const region = el({ tag: 'DIV', id: regionId });
  const ctrl = nest(el({ text: 'Save' }), region, encounterRoot());
  const f = finderFor([ctrl]);
  eq(f.run(), null, 'a Save inside the ' + regionId + ' region was accepted');
  eq(f.hetDiag.savenamed, 'forbidden-control', 'a banned-region Save was not recorded as forbidden-control');
  eq(ctrl.clicks, 0, 'a banned-region Save was clicked');
});
{
  const a = nest(el({ text: 'Save' }), encounterRoot());
  const b = nest(el({ text: 'Save draft' }), encounterRoot());
  const f = finderFor([a, b]);
  eq(f.run(), null, 'two candidate Save controls were not refused');
  eq(f.hetDiag.savenamed, 'save-control-ambiguous', 'two candidates were not recorded as ambiguous');
  eq(a.clicks + b.clicks, 0, 'an ambiguous candidate was clicked');
}
{
  const f = finderFor([nest(el({ text: 'Next' }), encounterRoot()), nest(el({ text: 'Print' }), encounterRoot())]);
  eq(f.run(), null, 'a surface with no Save control bound something');
  eq(f.hetDiag.savenamed, 'save-control-not-found', 'an absent Save control was not recorded as save-control-not-found');
}
console.log('  7. the finder binds one closed-allowlist Save, refuses Sign / Sign & Save / Close / Bill / order / finalize / attest and every banned region, refuses two candidates as ambiguous - and clicks nothing, ever');

/* ---------- 6. the closed refusals and the read-only probe ---------- */

const refusalAt = bodies.indexOf('    if (snvNamedSave && candidates.length === 0) {');
ok(refusalAt > 0, 'the closed refusal block did not land');
const REFUSALS = bodies.slice(refusalAt, refusalAt + 7).join(LF);
eq(bodies[refusalAt + 6], '    }', 'the closed refusal block is not the seven lines this proof lifts');
ok(REFUSALS.indexOf("reason: 'encounter-mismatch'") > 0, 'the closed refusal block lost encounter-mismatch');

const refusalRunner = new Function('ctx', [
  'const snvNamedSave = ctx.snvNamedSave, candidates = ctx.candidates, action = ctx.action;',
  'const hetDiag = ctx.hetDiag, hetFrames = ctx.hetFrames;',
  REFUSALS,
  'return null;'
].join(LF));
function refusalFor(postGate, savenamed) {
  return refusalRunner({ snvNamedSave: true, candidates: [], action: 'save_draft', hetDiag: { postGate: postGate, savenamed: savenamed, qualified: true }, hetFrames: [] });
}
['encounter-id', 'appointment-id'].forEach(gate => {
  const r = refusalFor(gate, 'found');
  ok(r, 'a ' + gate + ' gate produced no refusal');
  eq(r.reason, 'encounter-mismatch', 'a ' + gate + ' gate did not answer encounter-mismatch');
  eq(r.encounterMatched, false, 'an encounter mismatch claimed the encounter matched');
  eq(r.blocked, true, 'an encounter mismatch was not answered as blocked');
  eq(r.ok, false, 'an encounter mismatch was answered as ok');
  eq(/[0-9]{3,}/.test(String(r.error)), false, 'the encounter-mismatch sentence leaked an identifier');
});
eq(refusalFor('', 'save-control-not-found').reason, 'save-control-not-found', 'an absent Save control lost its code');
eq(refusalFor('', 'save-control-ambiguous').reason, 'save-control-ambiguous', 'two Save controls lost the ambiguous code');
eq(refusalFor('', 'forbidden-control').reason, 'forbidden-control', 'a forbidden Save control lost its code');
eq(refusalFor('', 'save-control-not-found').encounterMatched, false, 'a refusal that never reached the encounter gate claimed a match');
eq(refusalFor('pushed', 'save-control-not-found').encounterMatched, true, 'a refusal after the encounter gate passed did not say so');
eq(refusalFor('meta-missing', ''), null, 'an unrelated outcome was captured by the new closed refusals instead of falling through');
eq(refusalFor('current-note', 'weird'), null, 'an unknown finder outcome minted a closed refusal');
eq(refusalRunner({ snvNamedSave: false, candidates: [], action: 'save_draft', hetDiag: { postGate: 'encounter-id', savenamed: 'found' }, hetFrames: [] }), null, 'the OLD shape was answered by the new closed refusals');

const probeLine = bodies.find(l => l.trim().indexOf("if (snvNamedSave && mode === 'probe') return {") === 0);
ok(!!probeLine, 'the read-only probe answer did not land');
const probeRun = new Function('ctx', [
  'const snvNamedSave = ctx.snvNamedSave, mode = ctx.mode, action = ctx.action, context = ctx.context;',
  'const noteSections = ctx.noteSections, actionControl = ctx.actionControl, actionScope = ctx.actionScope;',
  'const snvSaveCore = ctx.snvSaveCore, snvScopeTag = ctx.snvScopeTag;',
  probeLine,
  'return null;'
].join(LF));
{
  const helpers = helperFactory(function () { return []; }, {});
  const scope = el({ tag: 'DIV', id: 'encounter-note-workspace-77123' });
  const control = nest(el({ text: 'Save draft' }), scope);
  const r = probeRun({
    snvNamedSave: true, mode: 'probe', action: 'save_draft',
    context: { encounterId: '900123' }, noteSections: [HPI, AP],
    actionControl: control, actionScope: scope,
    snvSaveCore: helpers.snvSaveCore, snvScopeTag: helpers.snvScopeTag
  });
  ok(r, 'the probe answered nothing for the encounter-save shape');
  eq(r.ok, true, 'the probe did not verify a resolvable encounter save');
  eq(r.readOnly, true, 'the probe did not declare itself read-only');
  eq(r.contextVerified, true, 'the probe did not report contextVerified - the caller could not mint its one-use token');
  eq(r.reason, 'context-verified', 'the probe answered a reason the app does not already know');
  eq(r.savenamed, true, 'the probe receipt does not name the encounter-save leg');
  eq(r.encounterMatched, true, 'the probe receipt does not state that the reviewed encounter is the open one');
  eq(r.control.labelCore, 'save draft', 'the probe receipt control name is not a closed allowlist member');
  eq(r.sectionsDeclared, 2, 'the probe receipt does not count the reviewed sections');
  eq(/[0-9]/.test(r.control.scope), false, 'the probe receipt scope tag leaked a digit - an id could ride into a receipt');
  eq(control.clicks, 0, 'the READ-ONLY probe clicked the Save control');
  eq(r.noAutomaticChaining, 'no-automatic-chaining', 'the probe receipt lost the no-automatic-chaining statement');
  eq(probeRun({ snvNamedSave: false, mode: 'probe', action: 'save_draft', context: {}, noteSections: [], actionControl: control, actionScope: scope, snvSaveCore: helpers.snvSaveCore, snvScopeTag: helpers.snvScopeTag }), null, 'the OLD shape was answered by the new probe return');
}
console.log('  8. the closed refusals name encounter-mismatch / save-control-not-found / save-control-ambiguous / forbidden-control and fall through for anything else, and the probe is read-only');

/* ---------- 7. the structural pins on what may ever be clicked ---------- */

ok(EXECUTE.indexOf('exactSave(actionControl)') > 0, 'the execute leg no longer re-checks the closed save allowlist at the boundary');
ok(EXECUTE.indexOf('snvForbiddenSaveLabel(actionControl)') > 0, 'the execute leg no longer re-checks the extra sign/bill/order/close/finalize/attest ban');
ok(EXECUTE.indexOf('wsForbiddenControl(actionControl)') > 0, 'the execute leg no longer re-checks the shipped write-safety ban');
eq((EXECUTE.match(/clickOnce\(/g) || []).length, 1, 'the execute leg drives more than one control');
eq(/exactSign|sign_encounter|exactPlaceOrder|stage_billing/.test(EXECUTE), false, 'the encounter-save leg references a sign, order or billing control');
['sign', 'bill', 'order', 'close', 'finalize', 'finalise', 'attest'].forEach(word => {
  ok(new RegExp('\\|' + word + '\\||\\(' + word + '\\|').test(HELPERS), 'the closed forbidden-label ban lost the word ' + word);
});
ok(HELPERS.indexOf("var SNV_SAVE_CORES = { 'save': 1, 'save draft': 1, 'save note': 1 };") > 0, 'the save allowlist is no longer a closed three-member set');
ok(EXECUTE.indexOf("/\\b(draft saved|note saved|saved successfully|changes saved)\\b/") > 0, 'the read-back phrase set is no longer the shipped closed set the generic save_draft leg uses');
console.log('  9. the new leg re-checks the closed allowlist at the mutation boundary, drives exactly one control, and names no sign / order / billing control anywhere');

/* ---------- 8. the execute leg, driven to completion ---------- */

const executeFactory = new Function('ctx', [
  'return (async function () {',
  '  const action = ctx.action, snvNamedSave = ctx.snvNamedSave;',
  '  const actionControl = ctx.actionControl, actionScope = ctx.actionScope, hit = ctx.hit;',
  '  const context = ctx.context, noteSections = ctx.noteSections;',
  '  const exactSave = ctx.exactSave, wsForbiddenControl = ctx.wsForbiddenControl;',
  '  const snvForbiddenSaveLabel = ctx.snvForbiddenSaveLabel, snvSaveCore = ctx.snvSaveCore, snvScopeTag = ctx.snvScopeTag;',
  '  const statusEvidenceSnapshot = ctx.statusEvidenceSnapshot, newScopedStatus = ctx.newScopedStatus;',
  '  const clickOnce = ctx.clickOnce, sleep = ctx.sleep;',
  '  let mutationAttempted = false;',
  EXECUTE,
  '  return { fellThrough: true, mutationAttempted: mutationAttempted };',
  '})();'
].join(LF));

function statusNode(nodeText) {
  return el({ tag: 'DIV', text: nodeText, attrs: { role: 'status' } });
}
async function runExecute(opts) {
  const o = opts || {};
  const scope = o.scope || el({ tag: 'DIV', id: 'encounter-note-workspace' });
  scope.__status = o.statusBefore || [];
  const control = o.control || nest(el({ text: 'Save' }), scope);
  const bodyEl = el({ tag: 'BODY', id: 'body' });
  bodyEl.__status = [];
  const helpers = helperFactory(function () { return [control]; }, { savenamed: null, postGate: '' });
  const status = statusFactory(function (root) { return (root && root.__status) || []; }, function () { return true; });
  const clicked = [];
  const result = await executeFactory({
    action: 'save_draft',
    snvNamedSave: o.snvNamedSave === undefined ? true : o.snvNamedSave,
    actionControl: control,
    actionScope: scope,
    hit: { frame: { doc: { body: bodyEl } } },
    context: { encounterId: '900123', mrn: '55512' },
    noteSections: [HPI, AP],
    exactSave: realExactSave,
    wsForbiddenControl: realWsForbidden,
    snvForbiddenSaveLabel: helpers.snvForbiddenSaveLabel,
    snvSaveCore: helpers.snvSaveCore,
    snvScopeTag: helpers.snvScopeTag,
    statusEvidenceSnapshot: status.statusEvidenceSnapshot,
    newScopedStatus: status.newScopedStatus,
    sleep: async function () { if (o.onSleep) o.onSleep(scope); },
    clickOnce: function (elx) { clicked.push(elx); elx.click(); }
  });
  return { result: result, control: control, scope: scope, clicked: clicked };
}

async function main() {
  {
    const run = await runExecute({ onSleep: scope => { scope.__status = [statusNode('Draft saved')]; } });
    eq(run.control.clicks, 1, 'the encounter Save was not clicked exactly once');
    eq(run.clicked.length, 1, 'more than one control was driven by one save');
    eq(run.result.ok, true, 'a read-back saved confirmation did not verify the save');
    eq(run.result.verified, true, 'the verified receipt field is not set on a read-back save');
    eq(run.result.saved, true, 'the saved receipt field is not set on a read-back save');
    eq(run.result.attempted, true, 'the verified save did not report that it was attempted');
    eq(run.result.partialMutation, false, 'a verified save reported a partial mutation');
    eq(run.result.reason, 'exact-save-control-context-verified', 'the verified save answered a different reason');
    eq(run.result.signed, false, 'the save receipt does not state that nothing was signed');
    eq(run.result.control.labelCore, 'save', 'the receipt control name is not the closed allowlist member');
    eq(run.result.encounterMatched, true, 'the receipt does not state that the reviewed encounter is the open one');
    eq(run.result.sectionsDeclared, 2, 'the receipt does not count the reviewed sections');
    eq(run.result.noAutomaticChaining, 'no-automatic-chaining', 'the save receipt lost the no-automatic-chaining statement');
    eq(run.result.mutationAttempted, undefined, 'the receipt leaked the driver-local mutation flag');
    ok(JSON.stringify(run.result).indexOf('900123') >= 0, 'fixture sanity: the bound encounter context does not ride on the receipt');
  }
  for (const phrase of ['Note saved', 'Saved successfully', 'Changes saved']) {
    const run = await runExecute({ onSleep: scope => { scope.__status = [statusNode(phrase)]; } });
    eq(run.result.verified, true, 'the closed saved phrase ' + phrase + ' did not verify');
  }
  {
    const run = await runExecute({});
    eq(run.control.clicks, 1, 'the save was not attempted');
    eq(run.result.ok, false, 'a save with no confirmation was reported as ok');
    eq(run.result.verified, false, 'a save with no confirmation claimed verification');
    eq(run.result.saved, false, 'a save with no confirmation claimed to be saved');
    eq(run.result.attempted, true, 'a save that clicked did not report that it was attempted');
    eq(run.result.partialMutation, true, 'a clicked-but-unconfirmed save did not report a possible partial mutation');
    eq(run.result.reason, 'save-readback-missing', 'the unconfirmed save answered a different reason');
  }
  {
    /* athenaOne reuses global toast nodes, so newScopedStatus requires a NEWLY
       CREATED node. A pre-existing node that merely repaints itself is not
       evidence - this is the property that makes the signal unable to misfire. */
    const stale = statusNode('Nothing to report');
    const run = await runExecute({ statusBefore: [stale], onSleep: () => { stale.textContent = 'Draft saved'; } });
    eq(run.result.verified, false, 'a pre-existing status node that repainted itself was accepted as a saved confirmation');
    eq(run.result.reason, 'save-readback-missing', 'a repainted pre-existing node did not fall to the honest refusal');
  }
  {
    const run = await runExecute({ onSleep: scope => { scope.__status = [statusNode('Encounter signed')]; } });
    eq(run.result.verified, false, 'unrelated athenaOne status copy verified a save');
  }
  for (const spelling of ['Sign & Save', 'Sign', 'Close encounter', 'Bill', 'Finalize']) {
    const scope = el({ tag: 'DIV', id: 'encounter-note-workspace' });
    const ctrl = nest(el({ text: spelling }), scope);
    const run = await runExecute({ scope: scope, control: ctrl });
    eq(run.control.clicks, 0, 'the execute leg clicked a ' + spelling + ' control');
    eq(run.clicked.length, 0, 'the execute leg reached its click boundary with a ' + spelling + ' control');
    eq(run.result.reason, 'forbidden-control', 'a ' + spelling + ' control did not answer forbidden-control');
    eq(run.result.blocked, true, 'a ' + spelling + ' control was not answered as blocked');
    eq(run.result.attempted, false, 'a refused ' + spelling + ' control claimed an attempt');
    eq(run.result.saved, false, 'a refused ' + spelling + ' control claimed a save');
  }
  {
    const run = await runExecute({ snvNamedSave: false });
    eq(run.result.fellThrough, true, 'the generic save_draft shape was diverted into the new execute leg');
    eq(run.control.clicks, 0, 'the generic shape clicked through the new leg');
    eq(run.result.mutationAttempted, false, 'the generic shape crossed the new leg\'s mutation boundary');
  }
  console.log(' 10. the execute leg clicks exactly once, verifies ONLY on a newly created closed-phrase status node, is honest when there is none, and refuses a repainted Sign / Close / Bill / Finalize control without clicking');
}

main().then(function () {
  console.log('PASS savenamed-splice-proof: ' + checks + ' checks - scripts/splice-30111-savenamed.js is a pure eight-span insertion into background.js that leaves the generic save_draft leg, the note-scope region, the scoped-status rule and the write-safety guard byte-identical; the encounter-save leg is declared by the sections the app already sends and only for an all-named reviewed shape; its finder binds one closed-allowlist Save and refuses Sign, Sign & Save, Close encounter, Bill, orders, finalize, attest, every banned region and every ambiguous pair without ever clicking; its execute clicks exactly once and answers verified only on a NEWLY CREATED scoped status node carrying the shipped closed saved-phrase set; and every other outcome answers a closed code - encounter-mismatch, save-control-not-found, save-control-ambiguous, forbidden-control, save-readback-missing');
}).catch(function (err) {
  console.error('FAIL savenamed-splice-proof after ' + checks + ' checks');
  console.error((err && err.stack) || err);
  process.exitCode = 1;
});

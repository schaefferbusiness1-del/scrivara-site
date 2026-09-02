/* beadwait-splice-proof.js - beadwait-1.0.0 (ext 3.0.111)
 *
 * THE MEASURED DEFECT THIS PROVES A CURE FOR (live, 2026-09-02 16:26, ext
 * 3.0.110). The app opened the encounter through the appointment row at
 * 16:26:33; thirteen seconds later all six named-section probes refused
 * 0.4 s apart with note-section-not-on-surface and hetDiag { qualified:true,
 * rank:6, noteTargetFound:false, stageNav: no-bead } - yet at 16:26:55 that
 * SAME frame carried six visible li.nav-bead elements (Review, HPI, ROS, PE,
 * A/P, Sign-off) and a re-check at 16:29 wrote HPI, ROS, PE and the combined
 * A&P. The encounter frame binds BEFORE athenaOne paints its stage-tab strip,
 * and sn-1.0.0 looked exactly once.
 *
 * WHAT IS BEING PROVED. scripts/splice-30111-beadwait.js is the ONLY
 * authorized way background.js gets this change (mixed CRLF/LF, latin1 file,
 * exact-count anchors). This suite runs that script against a TEMP COPY of
 * background.js - never the repo copy - and then proves, out of the spliced
 * bytes themselves:
 *
 *   1. the splice is exact and idempotent-safe: both anchor spans matched
 *      exactly once, a second run REFUSES on its own marker, and `node --check`
 *      passes on the result;
 *   2. it is a PURE LINE REPLACEMENT - putting the two replaced spans back
 *      reproduces the pre-splice background.js byte for byte, so every gate,
 *      deadline and refusal outside those two spans is untouched, pinned again
 *      by region for the write-safety guard, the whole note-scope region, the
 *      savenamed helpers and execute leg, the write_note leg, the generic
 *      save_draft leg, the sign_encounter leg and the scoped-status rule;
 *   3. every refusal code inside the sn block still appears exactly once
 *      (no-bead, already-open, forbidden-control, click-failed, not-needed)
 *      and the stage-tab click appears exactly once - the change adds no
 *      second click and removes no refusal;
 *   4. the BLOCK ITSELF, lifted from the spliced copy and run on a virtual
 *      clock with stubbed deepQueryAll / visible / findNamedNoteAction / sleep
 *      (so nothing actually waits), behaves as measured:
 *        - beads absent for three looks then present -> opened-HPI on look 4;
 *        - beads never present -> no-bead after EXACTLY 15 looks, inside the
 *          12 s ceiling, with the control never clicked;
 *        - a bead that is already opened -> already-open, unchanged, no click;
 *        - a forbidden control -> forbidden-control, no click;
 *        - a click that throws -> click-failed, and no editor poll at all;
 *        - the editor resolving on the 3rd 400 ms look -> exactly ONE click
 *          and stageNavEditorMs 1200;
 *        - the editor never resolving -> ONE click, the 8 s ceiling, and a
 *          fall-through to the unchanged candidate loop;
 *        - an exception inside a look (from deepQueryAll or from visible)
 *          counts as NOT FOUND for that look and never escapes the block;
 *        - a bead whose label is not the wanted one is never taken.
 *
 * WHAT IT DOES NOT CLAIM. This is a driver-side wait. It grants nothing: the
 * stage-tab whitelist, the machine-bound stage-context requirement and the
 * forbidden-control ban are the shipped ones and are pinned unchanged here.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'background.js');
const SPLICE = path.join(REPO, 'scripts', 'splice-30111-beadwait.js');
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
/* the proven brace-walk lift used by tests/athena-order-action-runtime.test.js
   and tests/savenamed-splice-proof.js */
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
/* count the occurrences of a consecutive run of whole line BODIES */
function runCount(lines, find) {
  let n = 0;
  for (let j = 0; j + find.length <= lines.length; j++) {
    let hit = true;
    for (let k = 0; k < find.length; k++) if (body(lines[j + k]) !== find[k]) { hit = false; break; }
    if (hit) n++;
  }
  return n;
}
function runAt(lines, find) {
  for (let j = 0; j + find.length <= lines.length; j++) {
    let hit = true;
    for (let k = 0; k < find.length; k++) if (body(lines[j + k]) !== find[k]) { hit = false; break; }
    if (hit) return j;
  }
  return -1;
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at < 0) return n;
    n++;
    i = at + needle.length;
  }
}

/* ---------- 1. run the real splice against a TEMP COPY ---------- */

/* The repo copy is spliced before the release, so this suite must hold BOTH
   before and after that happens - a proof that can only run once is not a
   proof. Before: temp-copy background.js and run the script on it. After:
   rebuild the pre-splice file by putting the script's own declared spans back,
   run the script on THAT, and require the result to equal the shipped bytes
   exactly - which additionally proves the shipped background.js is this
   script's output and nothing else. Requiring the script writes nothing. */
const declared = require(SPLICE);
eq(declared.TARGET, 'background.js', 'the splice script no longer targets background.js');
eq(declared.MARKER, 'beadwait-1.0.0', 'the splice script no longer carries the beadwait marker');
eq(declared.EDITS.length, 2, 'the splice script no longer declares exactly two edits');
const DECLARED_LINE_COUNT = declared.EDITS.reduce((n, e) => n + e.lines.length, 0);
const REPLACED_LINE_COUNT = declared.EDITS.reduce((n, e) => n + e.find.length, 0);
eq(DECLARED_LINE_COUNT, 74, 'the splice script declares a different number of replacement lines');
eq(REPLACED_LINE_COUNT, 3, 'the splice script replaces a different number of shipped lines');
declared.EDITS.forEach((e, i) => {
  eq(e.n, 1, 'edit ' + i + ' no longer requires an exactly-once anchor');
  ok(Array.isArray(e.find) && e.find.length >= 1, 'edit ' + i + ' has no line-array anchor');
});
eq(declared.EDITS[1].find.length, 2, 'the editor-wait edit is no longer anchored on the two-line pair');
eq(declared.EDITS[1].find[1], '            await sleep(1600);', 'the editor-wait pair no longer ends on the fixed sleep it replaces');

const repoFile = fs.readFileSync(SRC, 'latin1');
const alreadySpliced = repoFile.indexOf(declared.MARKER) >= 0;

function unsplice(text) {
  let lines = fullLines(text);
  /* reverse order, so an earlier edit's line numbers are still meaningful */
  declared.EDITS.slice().reverse().forEach((e, k) => {
    const i = declared.EDITS.length - 1 - k;
    eq(runCount(lines, e.lines), 1, 'edit ' + i + ': the spliced file does not carry this script\'s declared span exactly once');
    const at = runAt(lines, e.lines);
    const eol = lines[at].slice(body(lines[at]).length);
    const back = e.find.map(t => t + eol);
    lines = lines.slice(0, at).concat(back, lines.slice(at + e.lines.length));
  });
  return lines.join('');
}

const original = alreadySpliced ? unsplice(repoFile) : repoFile;
eq(original.indexOf('beadwait'), -1, 'the pre-splice background.js still carries a beadwait marker');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beadwait-'));
const copy = path.join(work, 'background.js');
fs.writeFileSync(copy, original, 'latin1');
ok(fs.readFileSync(copy, 'latin1') === original, 'the temp copy is not byte-identical to the pre-splice background.js');
ok(path.resolve(copy) !== path.resolve(SRC), 'the proof would have spliced the repo copy');

const origLines = fullLines(original);
declared.EDITS.forEach((e, i) => {
  eq(runCount(origLines, e.find), 1, 'anchor ' + i + ' is not an exactly-once consecutive run: ' + e.find[0].slice(0, 70));
});
/* the anchor fact that FORCED the two-line pair: the fixed sleep alone is not
   unique in this file, so anchoring on it would have been ambiguous. */
eq(origLines.filter(l => body(l).trim() === 'await sleep(1600);').length, 2, 'the fixed 1600 ms sleep is no longer the twice-occurring line the pair anchor exists for');

const run1 = spawnSync(process.execPath, [SPLICE], { cwd: work, encoding: 'utf8' });
const out1 = String(run1.stdout || '') + String(run1.stderr || '');
eq(run1.status, 0, 'the splice refused to run against a clean copy:' + LF + out1);
declared.EDITS.forEach((e, i) => {
  const re = new RegExp('edit ' + i + ': replace line \\d+-\\d+ \\((LF|CRLF)\\), -' + e.find.length + ' \\+' + e.lines.length + ' lines');
  ok(re.test(out1), 'edit ' + i + ' did not report a single exact-count anchor replacement: ' + out1);
});
ok(/edit 0: replace line \d+-\d+ \(LF\)/.test(out1), 'the bead-wait span is no longer LF-terminated - the splice must refuse to normalise it');
ok(/edit 1: replace line \d+-\d+ \(LF\)/.test(out1), 'the editor-wait span is no longer LF-terminated');
ok(/OK background\.js \(2 edits\)/.test(out1), 'the splice did not report two edits: ' + out1);
ok(/node --check background\.js OK/.test(out1), 'the splice no longer runs node --check on its own output: ' + out1);
ok(/SPLICE 3\.0\.111 beadwait-1\.0\.0 DONE/.test(out1), 'the splice did not print its completion line: ' + out1);
console.log('  1. the splice ran once against a temp copy, two exact-count anchor spans, two edits' + (alreadySpliced ? ' (repo copy already spliced - rebuilt from the script\'s own declared spans)' : ''));

const run2 = spawnSync(process.execPath, [SPLICE], { cwd: work, encoding: 'utf8' });
eq(run2.status, 1, 'the splice did not refuse a second run');
ok(/marker beadwait-1\.0\.0 is already present/.test(String(run2.stderr || '')), 'the second run refused for the wrong reason: ' + String(run2.stderr || ''));
console.log('  2. a second run refuses on its own marker (idempotence)');

const spliced = fs.readFileSync(copy, 'latin1');
if (alreadySpliced) ok(spliced === repoFile, 'the shipped background.js is not byte-identical to this script\'s own output');
const check = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
eq(check.status, 0, 'node --check failed on the spliced copy: ' + String(check.stderr || ''));
eq(countOf(spliced, 'beadwait-1.0.0'), 2, 'the beadwait marker did not land exactly once per inserted span');
eq(/[^\x00-\x7f]/.test(spliced), /[^\x00-\x7f]/.test(original), 'the splice changed the file\'s non-ASCII content');
const splLines = fullLines(spliced);
declared.EDITS.forEach((e, i) => {
  eq(runCount(splLines, e.find), 0, 'edit ' + i + ': the replaced span is still present in the spliced file');
  eq(runCount(splLines, e.lines), 1, 'edit ' + i + ': the replacement span is not present exactly once');
});
console.log('  3. node --check passes on the spliced copy, both markers landed, both replaced spans are gone');

/* ---------- 2. nothing outside the two replaced spans moved ---------- */

const rebuilt = unsplice(spliced);
eq(rebuilt.length, original.length, 'putting the two replaced spans back changed the file length');
ok(rebuilt === original, 'putting the two replaced spans back did not reproduce background.js byte-for-byte');
eq(splLines.length - origLines.length, DECLARED_LINE_COUNT - REPLACED_LINE_COUNT, 'the spliced line count does not match a pure two-span replacement');
/* the two spans are contiguous and adjacent in the file - so nothing between
   them, before them or after them shifted for any other reason */
{
  const at0 = runAt(splLines, declared.EDITS[0].lines);
  const at1 = runAt(splLines, declared.EDITS[1].lines);
  ok(at0 > 0 && at1 > at0 + declared.EDITS[0].lines.length, 'the two inserted spans are not in source order inside the sn block');
  const head = splLines.slice(0, at0).join('');
  ok(original.indexOf(head) === 0, 'everything before the first replaced span is not byte-identical');
  const tailAt = at1 + declared.EDITS[1].lines.length;
  const tail = splLines.slice(tailAt).join('');
  ok(original.lastIndexOf(tail) === original.length - tail.length, 'everything after the second replaced span is not byte-identical');
}
console.log('  4. the splice is a pure two-span line replacement - every other byte of background.js is unchanged');

/* said again where it matters most: the in-driver write-safety guard, the
   whole note-scope region, the savenamed helpers and execute leg, the
   write_note leg, the generic save_draft leg, the sign_encounter leg and the
   scoped-status evidence rule are byte-identical across the splice. */
[
  ['/* MLS_WRITE_SAFETY_DRIVER_GUARD_START', '/* MLS_WRITE_SAFETY_DRIVER_GUARD_END */', 'the in-driver write-safety guard'],
  ['/* ATHENA_ACTION_V2_NOTE_SCOPE_START */', '/* ATHENA_ACTION_V2_NOTE_SCOPE_END */', 'the whole note-scope region'],
  ['/* ATHENA_ACTION_V2_SAVENAMED_HELPERS_START */', '/* ATHENA_ACTION_V2_SAVENAMED_HELPERS_END */', 'the savenamed finder helpers'],
  ['/* ATHENA_ACTION_V2_SCOPED_STATUS_START */', '/* ATHENA_ACTION_V2_SCOPED_STATUS_END */', 'the scoped-status evidence region'],
  ['/* ATHENA_ACTION_V2_WRITE_NOTE_START */', '/* ATHENA_ACTION_V2_WRITE_NOTE_END */', 'the write_note leg'],
  ['/* ATHENA_ACTION_V2_SAVENAMED_EXECUTE_START */', '/* ATHENA_ACTION_V2_SAVENAMED_EXECUTE_END */', 'the savenamed execute leg'],
  ['/* SAVE_DRAFT_START */', '/* SAVE_DRAFT_END */', 'the shipped generic save_draft leg'],
  ['/* SIGN_ENCOUNTER_START */', '/* SIGN_ENCOUNTER_END */', 'the sign_encounter leg']
].forEach(([a, b, what]) => {
  eq(between(spliced, a, b, what), between(original, a, b, what), what + ' is not byte-identical across the splice');
});
[
  "    if (action === 'write_note' && requestedNoteSection && requestedNoteSection !== 'note') {",
  "            var snStage = hetStageEncounterContext(snFr, expectedPatient);",
  "            if (!snStage) continue;",
  "            if (findNamedNoteAction(snFr, action, requestedNoteSection)) { hetDiag.stageNav = 'not-needed'; break; }",
  "            try { snBeads = deepQueryAll(snFr.doc, 'li.nav-bead'); } catch (eSn0) { snBeads = []; }",
  "            if (/\\bopened\\b/.test(String(snBead.className || ''))) { hetDiag.stageNav = 'already-open'; break; }",
  "            var snClick = null; try { snClick = snBead.querySelector('a,button,span') || snBead; } catch (eSn1) { snClick = snBead; }",
  "            if (wsForbiddenControl(snClick)) { hetDiag.stageNav = 'forbidden-control'; break; }",
  "            try { snClick.click(); } catch (eSn2) { hetDiag.stageNav = 'click-failed'; break; }",
  "      } catch (eSnAll) {}"
].forEach((line, i) => {
  eq(origLines.filter(l => body(l) === line).length, 1, 'unchanged-line pin ' + i + ' is not an exactly-once line in the original');
  eq(splLines.filter(l => body(l) === line).length, 1, 'unchanged-line pin ' + i + ' changed across the splice');
});
/* the OTHER await sleep(1600) - the one this change must not touch - survives */
eq(splLines.filter(l => body(l) === '      await sleep(1600);').length, 1, 'the unrelated 1600 ms sleep outside the sn block was touched');
eq(splLines.filter(l => body(l).trim() === 'await sleep(1600);').length, 1, 'the sn block still carries a fixed 1600 ms sleep');
console.log('  5. the write-safety guard, the note-scope region, the savenamed legs, write_note, save_draft, sign_encounter and the scoped-status rule are byte-identical');

/* ---------- 3. source pins on the sn block itself ---------- */

const bodies = splLines.map(body);
const SN_FROM = bodies.indexOf("    if (action === 'write_note' && requestedNoteSection && requestedNoteSection !== 'note') {");
ok(SN_FROM > 0, 'the sn block opening line is gone');
const SN_TO = bodies.indexOf('      } catch (eSnAll) {}', SN_FROM);
ok(SN_TO > SN_FROM, 'the sn block closing catch is gone');
eq(bodies[SN_TO + 1], '    }', 'the sn block does not close where it always did');
const SN_BLOCK = bodies.slice(SN_FROM, SN_TO + 2).join(LF);

[
  ["'no-bead'", 1],
  ["'already-open'", 1],
  ["'forbidden-control'", 1],
  ["'click-failed'", 1],
  ["'not-needed'", 1],
  ["'opened-' + snWant", 1],
  ['snClick.click()', 1],
  ['await sleep(800);', 1],
  ['await sleep(400);', 1],
  ['sleep(1600)', 0],
  ["deepQueryAll(snFr.doc, 'li.nav-bead')", 2],
  ['findNamedNoteAction(snFr, action, requestedNoteSection)', 2]
].forEach(([needle, want]) => {
  eq(countOf(SN_BLOCK, needle), want, 'the sn block no longer carries ' + needle + ' exactly ' + want + ' time(s)');
});
ok(SN_BLOCK.indexOf('snLooks < 15') > 0, 'the bead wait no longer caps at 15 looks');
ok(SN_BLOCK.indexOf('snEdLooks < 20') > 0, 'the editor wait no longer caps at 20 looks (8000 ms at 400 ms)');
ok(SN_BLOCK.indexOf('hetDiag.stageNavWaitMs') > 0 && SN_BLOCK.indexOf('hetDiag.stageNavLooks') > 0, 'the bead-wait receipts are gone');
ok(SN_BLOCK.indexOf('hetDiag.stageNavEditorMs') > 0, 'the editor-wait receipt is gone');
console.log('  6. every refusal code in the sn block still appears exactly once, the stage-tab click exactly once, and the two fixed sleeps became the two bounded polls');

/* ---------- 4. run the block on a virtual clock ---------- */

const driver = between(spliced, '/* ATHENA_ACTION_V2_DRIVER_START */', '/* ATHENA_ACTION_V2_DRIVER_END */', 'the v2 driver');
const REAL_TEXT_SRC = extractFunction(driver, 'text');
const realText = new Function([REAL_TEXT_SRC, 'return text;'].join(LF))();
eq(realText('  HPI  '), 'HPI', 'the lifted text() is not the shipped whitespace-collapsing reader');

/* Every free name the block reads is handed in, so nothing here is a rewrite
   of the block - it IS the block, taken out of the spliced file. `Date` is
   shadowed by a virtual clock so the suite never waits in real time. */
const makeRunner = new Function('ctx', [
  'var action = ctx.action, requestedNoteSection = ctx.requestedNoteSection, expectedPatient = ctx.expectedPatient, hetDiag = ctx.hetDiag;',
  'var deepQueryAll = ctx.deepQueryAll, visible = ctx.visible, text = ctx.text, sleep = ctx.sleep;',
  'var findNamedNoteAction = ctx.findNamedNoteAction, sameOriginFrames = ctx.sameOriginFrames;',
  'var hetStageEncounterContext = ctx.hetStageEncounterContext, wsForbiddenControl = ctx.wsForbiddenControl;',
  'var Date = ctx.Date;',
  'return (async function () {',
  SN_BLOCK,
  '  return hetDiag;',
  '})();'
].join(LF));

function bead(labelText, o) {
  o = o || {};
  return {
    textContent: labelText,
    className: o.className || 'nav-item nav-bead has-subsections',
    __visible: o.visible !== false,
    __visibleThrows: !!o.visibleThrows,
    __forbidden: !!o.forbidden,
    clicks: 0,
    querySelector() { return null; },
    click() { if (o.clickThrows) throw new Error('athena refused the click'); this.clicks++; }
  };
}

function run(opts) {
  const o = opts || {};
  const state = { now: 0, dq: 0, fna: 0, visibleCalls: 0, sleeps: [], beads: [] };
  const hetDiag = {};
  const frame = { doc: { __doc: true }, w: { __win: true } };
  const ctx = {
    action: o.action || 'write_note',
    requestedNoteSection: o.section || 'hpi',
    expectedPatient: { mrn: '55512345' },
    hetDiag: hetDiag,
    text: realText,
    Date: { now: () => state.now },
    sleep: (ms) => { state.sleeps.push(ms); state.now += Number(ms) || 0; return Promise.resolve(); },
    sameOriginFrames: () => [frame],
    hetStageEncounterContext: (fr, expected) => (o.stageBound === false ? null : { encounter_id: 'E1', patient_id: expected.mrn }),
    visible: (el, w) => {
      state.visibleCalls++;
      assert.strictEqual(w, frame.w, 'visible() was not asked about the bound frame\'s window');
      if (el && el.__visibleThrows) throw new Error('detached node');
      return !!(el && el.__visible);
    },
    wsForbiddenControl: (el) => !!(el && el.__forbidden),
    deepQueryAll: (doc, sel) => {
      state.dq++;
      assert.strictEqual(doc, frame.doc, 'the bead lookup left the bound frame\'s document');
      assert.strictEqual(sel, 'li.nav-bead', 'the bead selector changed');
      const got = o.beadsAt ? o.beadsAt(state.dq) : [];
      got.forEach(b => { if (state.beads.indexOf(b) < 0) state.beads.push(b); });
      return got;
    },
    findNamedNoteAction: (fr, a, s) => {
      state.fna++;
      assert.strictEqual(fr, frame, 'the editor poll left the bound frame');
      assert.strictEqual(s, o.section || 'hpi', 'the editor poll asked about a different section');
      return o.editorAt ? o.editorAt(state.fna) : null;
    }
  };
  return makeRunner(ctx).then(() => ({
    hetDiag: hetDiag,
    state: state,
    clicks: state.beads.reduce((n, b) => n + b.clicks, 0)
  }));
}

const NONE = () => [];
const NEVER = () => null;

async function main() {
  /* the block was never entered at all for a generic note request */
  {
    const r = await run({ section: 'note', beadsAt: NONE, editorAt: NEVER });
    eq(Object.keys(r.hetDiag).length, 0, 'a generic note request entered the stage-nav pre-pass');
    eq(r.state.dq, 0, 'a generic note request looked for stage tabs');
    eq(r.state.sleeps.length, 0, 'a generic note request waited');
  }
  /* the section already binds - the shipped short circuit, untouched */
  {
    const r = await run({ beadsAt: NONE, editorAt: (n) => (n === 1 ? { editor: 1 } : null) });
    eq(r.hetDiag.stageNav, 'not-needed', 'a section that already binds no longer short-circuits');
    eq(r.state.dq, 0, 'the already-bound section still looked for a stage tab');
    eq(r.state.sleeps.length, 0, 'the already-bound section waited');
    eq(r.clicks, 0, 'the already-bound section clicked something');
  }
  console.log('  7. the shipped entry gates are unchanged: a generic note request and an already-bound section never reach the wait');

  /* THE MEASURED CASE: the strip paints late */
  {
    const hpi = bead('HPI');
    const r = await run({
      beadsAt: (n) => (n < 4 ? [] : [hpi]),
      editorAt: (n) => (n === 1 ? null : { editor: 1 })
    });
    eq(r.hetDiag.stageNav, 'opened-HPI', 'a strip that painted on the 4th look was not opened');
    eq(r.hetDiag.stageNavLooks, 4, 'the wait did not report the look that found the bead');
    eq(r.hetDiag.stageNavWaitMs, 2400, 'the wait did not report three 800 ms looks of waiting');
    eq(r.state.dq, 4, 'the wait did not re-run the shipped lookup once per look');
    eq(r.state.sleeps.slice(0, 3).join(','), '800,800,800', 'the looks are no longer 800 ms apart');
    eq(r.clicks, 1, 'the late-painting strip was not clicked exactly once');
    eq(hpi.clicks, 1, 'the HPI bead was not the control clicked');
    eq(r.hetDiag.stageNavEditor, 'ready', 'the editor that resolved on the first look was not reported ready');
    eq(r.hetDiag.stageNavEditorMs, 400, 'the editor wait did not stop at its first resolving look');
  }
  /* the strip never paints - the shipped refusal, unchanged, after the ceiling */
  {
    const r = await run({ beadsAt: NONE, editorAt: NEVER });
    eq(r.hetDiag.stageNav, 'no-bead', 'a strip that never painted no longer answers the shipped refusal');
    eq(r.hetDiag.stageNavLooks, 15, 'the wait did not take exactly 15 looks before refusing');
    eq(r.state.dq, 15, 'the wait did not re-run the shipped lookup on every one of its 15 looks');
    eq(r.hetDiag.stageNavWaitMs, 11200, 'the 15 looks 800 ms apart no longer take 11.2 s');
    ok(r.hetDiag.stageNavWaitMs <= 12000, 'the bead wait exceeded its 12 s ceiling');
    eq(r.clicks, 0, 'a strip that never painted was clicked anyway');
    eq(r.hetDiag.stageNavEditorMs, undefined, 'the editor wait ran for a refusal that never clicked');
    eq(r.state.fna, 1, 'the refusal path asked findNamedNoteAction more than the shipped once');
  }
  /* a bead with the wrong label is never taken, however long it is there */
  {
    const ros = bead('ROS');
    const r = await run({ beadsAt: () => [ros], editorAt: NEVER });
    eq(r.hetDiag.stageNav, 'no-bead', 'a bead whose label is not the wanted one was accepted');
    eq(r.hetDiag.stageNavLooks, 15, 'the wrong-label bead did not exhaust the same 15 looks');
    eq(ros.clicks, 0, 'the wrong-label bead was clicked');
  }
  console.log('  8. the bead wait re-runs the shipped lookup up to 15 looks 800 ms apart, opens the first visible exact-label bead, and otherwise answers the shipped no-bead refusal without clicking');

  /* already open - unchanged, and still no click */
  {
    const opened = bead('HPI', { className: 'nav-item nav-bead has-subsections opened' });
    const r = await run({ beadsAt: () => [opened], editorAt: NEVER });
    eq(r.hetDiag.stageNav, 'already-open', 'an already-opened bead no longer answers already-open');
    eq(r.hetDiag.stageNavLooks, 1, 'an already-visible bead cost more than one look');
    eq(r.hetDiag.stageNavWaitMs, 0, 'an already-visible bead waited');
    eq(r.state.sleeps.length, 0, 'an already-visible bead slept');
    eq(opened.clicks, 0, 'an already-opened bead was clicked');
    eq(r.hetDiag.stageNavEditorMs, undefined, 'the editor wait ran on the already-open path');
  }
  /* a forbidden control - unchanged, and still no click */
  {
    const forbidden = bead('HPI', { forbidden: true });
    const r = await run({ beadsAt: () => [forbidden], editorAt: NEVER });
    eq(r.hetDiag.stageNav, 'forbidden-control', 'a forbidden stage-tab control no longer answers forbidden-control');
    eq(forbidden.clicks, 0, 'a forbidden control was clicked');
    eq(r.hetDiag.stageNavEditorMs, undefined, 'the editor wait ran after a forbidden control');
  }
  /* a click that throws - unchanged, and no editor poll after it */
  {
    const angry = bead('HPI', { clickThrows: true });
    const r = await run({ beadsAt: () => [angry], editorAt: NEVER });
    eq(r.hetDiag.stageNav, 'click-failed', 'a click that threw no longer answers click-failed');
    eq(angry.clicks, 0, 'a click that threw was counted as a click');
    eq(r.hetDiag.stageNavEditorMs, undefined, 'the editor wait ran after a failed click');
  }
  console.log('  9. already-open, forbidden-control and click-failed are unchanged - none of them clicks, and none of them reaches the editor wait');

  /* the editor resolves on the 3rd 400 ms look */
  {
    const hpi = bead('HPI');
    const r = await run({
      beadsAt: () => [hpi],
      editorAt: (n) => (n === 4 ? { editor: 1 } : null)
    });
    eq(r.hetDiag.stageNav, 'opened-HPI', 'the opened receipt changed');
    eq(hpi.clicks, 1, 'the editor wait did not click exactly once');
    eq(r.hetDiag.stageNavEditorMs, 1200, 'the editor that resolved on the 3rd 400 ms look was not measured at 1200 ms');
    eq(r.hetDiag.stageNavEditorLooks, 3, 'the editor wait did not stop on its 3rd look');
    eq(r.hetDiag.stageNavEditor, 'ready', 'the resolved editor was not reported ready');
    eq(r.state.sleeps.filter(ms => ms === 400).length, 3, 'the editor looks are no longer 400 ms apart');
    eq(r.state.fna, 4, 'the editor poll asked a different number of times than its looks plus the shipped pre-check');
  }
  /* the editor never resolves - one click, the 8 s ceiling, honest fall-through */
  {
    const hpi = bead('HPI');
    const r = await run({ beadsAt: () => [hpi], editorAt: NEVER });
    eq(r.hetDiag.stageNav, 'opened-HPI', 'the block no longer reports the tab it opened when the editor never paints');
    eq(hpi.clicks, 1, 'an editor that never resolved was clicked more or less than once');
    eq(r.hetDiag.stageNavEditorLooks, 20, 'the editor wait did not take exactly 20 looks');
    eq(r.hetDiag.stageNavEditorMs, 8000, 'the editor wait did not stop at its 8000 ms ceiling');
    ok(r.hetDiag.stageNavEditorMs <= 8000, 'the editor wait exceeded its 8 s ceiling');
    eq(r.hetDiag.stageNavEditor, 'not-ready', 'an editor that never painted was reported ready');
  }
  console.log(' 10. the editor wait polls the shipped read-only finder every 400 ms to an 8 s ceiling, clicks exactly once, and falls through honestly when the editor never paints');

  /* an exception inside a look is NOT FOUND for that look, and never escapes */
  {
    const hpi = bead('HPI');
    const r = await run({
      beadsAt: (n) => { if (n < 3) throw new Error('cross-origin during repaint'); return [hpi]; },
      editorAt: (n) => (n === 1 ? null : { editor: 1 })
    });
    eq(r.hetDiag.stageNav, 'opened-HPI', 'a look that threw ended the wait instead of counting as not-found');
    eq(r.hetDiag.stageNavLooks, 3, 'the throwing looks were not counted');
    eq(hpi.clicks, 1, 'the bead found after two throwing looks was not clicked');
  }
  {
    const late = bead('HPI');
    const r = await run({
      beadsAt: (n) => (n < 3 ? [bead('HPI', { visibleThrows: true })] : [late]),
      editorAt: (n) => (n === 1 ? null : { editor: 1 })
    });
    eq(r.hetDiag.stageNav, 'opened-HPI', 'a visible() that threw ended the wait instead of counting as not-found');
    eq(r.hetDiag.stageNavLooks, 3, 'the looks whose visibility test threw were not counted');
    eq(late.clicks, 1, 'the bead found after two throwing visibility tests was not clicked');
  }
  /* an invisible bead is not a bead - the shipped visible() gate survives */
  {
    const hidden = bead('HPI', { visible: false });
    const r = await run({ beadsAt: () => [hidden], editorAt: NEVER });
    eq(r.hetDiag.stageNav, 'no-bead', 'an invisible bead was accepted');
    eq(r.hetDiag.stageNavLooks, 15, 'the invisible bead did not exhaust the same 15 looks');
    eq(hidden.clicks, 0, 'an invisible bead was clicked');
  }
  /* an unbound frame is still skipped before anything is looked at */
  {
    const r = await run({ stageBound: false, beadsAt: NONE, editorAt: NEVER });
    eq(Object.keys(r.hetDiag).length, 0, 'an unbound frame produced a stage-nav receipt');
    eq(r.state.dq, 0, 'an unbound frame was looked at');
    eq(r.state.sleeps.length, 0, 'an unbound frame was waited on');
  }
  console.log(' 11. an exception inside a look counts as not-found and never escapes the block; the shipped visible() and machine-bound stage-context gates are unchanged');
}

main().then(function () {
  console.log('PASS beadwait-splice-proof: ' + checks + ' checks - scripts/splice-30111-beadwait.js is a pure two-span line replacement inside the sn-1.0.0 block that leaves the write-safety guard, the note-scope region, the savenamed legs, write_note, save_draft, sign_encounter and the scoped-status rule byte-identical; the strip lookup became a bounded poll of the SAME shipped lookup (up to 15 looks 800 ms apart, inside a 12 s ceiling) that opens the first visible exact-label bead and otherwise answers the shipped no-bead refusal without clicking; the flat 1600 ms sleep became a bounded poll of the shipped read-only findNamedNoteAction every 400 ms to an 8 s ceiling that clicks exactly once and falls through honestly; and already-open, forbidden-control, click-failed, not-needed, the visible() gate and the machine-bound stage-context gate are all unchanged');
}).catch(function (err) {
  console.error('FAIL beadwait-splice-proof after ' + checks + ' checks');
  console.error((err && err.stack) || err);
  process.exitCode = 1;
});

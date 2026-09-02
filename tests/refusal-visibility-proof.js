'use strict';

/* refusal-visibility-proof.js  --  genvis-1.0.0 + histrefuse-1.0.0 (2026-09-01)
 * ============================================================================
 * TWO REFUSALS THAT LEFT NO TRACE, MEASURED LIVE IN THE OWNER'S OWN TAB ON
 * b1188. Both were experienced by him as the same thing - "the button does
 * nothing" - and in both cases the code was refusing CORRECTLY and saying so
 * into a surface that was gone before it could be read.
 *
 *  DEFECT 1 - THE GENERATE REFUSAL WAS INVISIBLE.
 *  On the Visit screen flow lane he pressed "Generate one note" (#ez3flGen).
 *  A real run started: window fired mls:generation-started
 *  {runId:2, evidence:'today'}. TWENTY-EIGHT SECONDS later it settled with
 *  mls:generation-settled
 *    {status:'failed', code:'draft_quality_failed',
 *     message:'Note was rejected by the safety checks. Nothing changed.
 *              Details: note was not structured.'}
 *  and the lane said nothing at either end. For the whole 28 s the hint line
 *  under the button still read "Your note is ready below..." - the sentence for
 *  a note loaded EARLIER - the button only looked dimmed, and the refusal
 *  existed as a toast that vanished within seconds.
 *  Cured by genvis-1.0.0 in 1p-mls-connect.js: the flow lane remembers the
 *  engine's own lifecycle. While a run is in flight the hint line says so and
 *  the button is aria-disabled with that reason; when the run settles
 *  failed/refused the hint line carries the engine's sentence VERBATIM and
 *  keeps it until the next run starts or the transcript changes; a successful
 *  settle restores the ordinary ready sentence. No second gate, no change to
 *  any refusal, no change to any Athena gate.
 *
 *  DEFECT 2 - THE HISTORY "REVIEW ATHENA ACTIONS" REFUSAL WAS A TRANSIENT
 *  TOAST. Note id n1788181673092neds (Adam J Schaeffer, his test patient).
 *  pushHistoryNoteToAthena refused because the saved record no longer carries
 *  a current, verified five-section Athena payload, toasted that sentence, and
 *  the toast was gone before he read it. The row showed nothing.
 *  Cured by histrefuse-1.0.0 in BOTH twins: every refusal branch also writes a
 *  per-note record that the History row paints inline and keeps. The toast
 *  stays. No refusal is weakened and no refused note opens a sheet.
 *
 * Everything below EXECUTES code sliced out of the shipped files - the state
 * machine, the lane painter, the gate painter, the refusal branches and the
 * real .hist-item row template - never a re-implementation of them.
 *
 * Run: node tests/refusal-visibility-proof.js
 * ==========================================================================*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

const CONNECT = read('1p-mls-connect.js');
const SHELL = read('1pScribeFlow.html');
const SHELL_P1 = read('1p/index.html');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) {
  checks++;
  assert.strictEqual(a, b, msg + '\n      got:      ' + JSON.stringify(a) + '\n      expected: ' + JSON.stringify(b));
}

/* Brace-matched slice of one shipped function - quote-, template-, regex- and
   comment-aware, so a brace inside a string or a comment cannot end it. */
function extractFn(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, 'missing shipped function: ' + marker);
  const open = source.indexOf('{', start);
  assert.ok(open > start, 'missing body for: ' + marker);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i += 1; continue; }
    if (ch === '/' && next === '*') { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  assert.fail('unterminated body for: ' + marker);
  return '';
}
function between(source, from, to, what) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, 'missing start marker for ' + what);
  const b = source.indexOf(to, a);
  assert.ok(b > a, 'missing end marker for ' + what);
  return source.slice(a + from.length, b);
}

/* ==========================================================================
 * PART A -- THE LANE REMEMBERS THE ENGINE'S LIFECYCLE
 *
 * The genvis block is sliced whole (it is delimited in the source precisely so
 * a suite can execute it), together with the three shipped writers it uses:
 * $, setLaneText and setLaneAttr. setLaneText/setLaneAttr are the GUARDED
 * writers - they write only on change - so running the real ones is also how
 * this suite proves a repaint does not churn the DOM.
 * ======================================================================== */
const GENVIS = between(
  CONNECT,
  '  /* ===== genvis-1.0.0 begin ============================================== */',
  '  /* ===== genvis-1.0.0 end ================================================ */',
  'the genvis-1.0.0 block in the flow lane module'
);
ok(GENVIS.indexOf('function noteGenStarted(') > 0, 'the genvis block no longer owns the started transition');
ok(GENVIS.indexOf('function noteGenSettled(') > 0, 'the genvis block no longer owns the settled transition');
ok(GENVIS.indexOf('function paintLaneHint(') > 0, 'the genvis block no longer owns the lane hint painter');

const DOLLAR = extractFn(CONNECT, '  function $(id) {');
const SET_TEXT = extractFn(CONNECT, '  function setLaneText(el, value) {');
const SET_ATTR = extractFn(CONNECT, '  function setLaneAttr(el, name, value) {');

/* A DOM small enough to read and real enough to measure: attribute writes are
   counted so "survives a repaint" can be told apart from "rewritten every
   repaint", and textContent is a real accessor. */
function makeEl(id) {
  const el = {
    id: id || '', attrs: Object.create(null), _text: '', value: '',
    writes: 0, textWrites: 0,
    setAttribute(k, v) { el.attrs[k] = String(v); el.writes += 1; },
    getAttribute(k) { return (k in el.attrs) ? el.attrs[k] : null; },
    removeAttribute(k) { delete el.attrs[k]; },
    querySelector() { return null; },
    classList: {
      contains(c) { return String(el.attrs.class || '').split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) {
        const has = el.classList.contains(c);
        const want = on === undefined ? !has : !!on;
        if (want && !has) el.attrs.class = (el.attrs.class ? el.attrs.class + ' ' : '') + c;
        if (!want && has) el.attrs.class = String(el.attrs.class || '').split(/\s+/).filter((x) => x && x !== c).join(' ');
        return want;
      }
    }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = String(v); el.textWrites += 1; }
  });
  return el;
}
function bootLane() {
  const nodes = Object.create(null);
  nodes.transcript = makeEl('transcript');
  nodes.transcript.value = 'Patient seen today for right knee pain after a fall on the stairs.';
  const sandbox = {
    String: String, Number: Number, Date: Date, Object: Object,
    _recSessionSeen: false,
    document: { getElementById: (id) => nodes[id] || null }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DOLLAR + '\n' + SET_TEXT + '\n' + SET_ATTR + '\n' + GENVIS + '\n', sandbox, { filename: 'genvis-1.0.0.js' });
  return { sandbox, nodes, run: (src) => vm.runInContext(src, sandbox) };
}

const lane = bootLane();
const HINT = makeEl('');
lane.sandbox.__hint = HINT;
lane.sandbox.__tx = () => lane.nodes.transcript.value;

const RUN_HINT = lane.run('GEN_RUN_HINT');
ok(/^Generating your note/.test(RUN_HINT), 'the in-flight sentence no longer names generating: ' + JSON.stringify(RUN_HINT));
ok(/minute/.test(RUN_HINT), 'the in-flight sentence no longer says how long it usually takes');
ok(!/[^\x20-\x7e]/.test(RUN_HINT), 'the in-flight sentence carries a non-ASCII byte, which the derive chain can corrupt');

/* --- A0. the resting state is the ordinary sentence, unchanged ----------- */
eq(lane.run('paintLaneHint(__hint, false, __tx(), "")'),
  'Transcript added. Record to add more, or generate one note from every segment.',
  'the ordinary transcript-present sentence changed');
eq(HINT.getAttribute('data-mls-gen-run'), '', 'a resting lane is marked as if a run were live');
eq(HINT.getAttribute('role'), 'status', 'the hint line is not announced (role=status is missing)');

/* --- A1. STARTED paints the generating hint ------------------------------ */
const startState = lane.run('noteGenStarted({ runId: 2, evidence: "today" })');
eq(startState.state, 'active', 'a started run does not put the lane into its active state');
eq(startState.text, RUN_HINT, 'a started run does not carry the in-flight sentence');
eq(lane.run('paintLaneHint(__hint, false, __tx(), "")'), RUN_HINT,
  'the lane hint line does not say it is generating while a run is in flight');
eq(HINT.textContent, RUN_HINT, 'the generating sentence never reached the DOM');
eq(HINT.getAttribute('data-mls-gen-run'), 'active', 'the hint line is not marked as an active run');

/* THE MEASURED DEFECT, PINNED DIRECTLY: with a note already loaded the lane
   used to say "Your note is ready below" for the entire 28 s of a run. */
eq(lane.run('paintLaneHint(__hint, false, __tx(), "S: knee pain\\nO: exam\\nA: sprain\\nP: rest")'), RUN_HINT,
  'a run in flight is hidden behind the stale "note is ready" sentence again');

/* --- A2. SETTLED FAILED paints the engine's sentence VERBATIM ------------- */
const OWNER_MESSAGE = 'Note was rejected by the safety checks. Nothing changed. Details: note was not structured.';
const settled = lane.run('noteGenSettled({ runId: 2, status: "failed", code: "draft_quality_failed", message: ' +
  JSON.stringify(OWNER_MESSAGE) + ' })');
eq(settled.state, 'failed', 'a failed settle does not put the lane into its failed state');
ok(settled.text.indexOf(OWNER_MESSAGE) === 0,
  'the engine sentence is not quoted verbatim at the head of the hint: ' + JSON.stringify(settled.text));
ok(settled.text.indexOf('draft_quality_failed') > 0,
  'the settled code is missing from the hint: ' + JSON.stringify(settled.text));

const painted = lane.run('paintLaneHint(__hint, false, __tx(), "")');
eq(painted, settled.text, 'the settled verdict is not what the lane paints');
eq(HINT.textContent, settled.text, 'the settled verdict never reached the DOM');
eq(HINT.getAttribute('data-mls-gen-run'), 'failed', 'the hint line is not marked as a failed run');
eq(HINT.getAttribute('role'), 'status', 'the refusal is not announced (role=status is missing)');

/* --- A3. IT SURVIVES A LANE REPAINT -------------------------------------- */
/* syncTopLane runs on every keystroke, every 2.5 s, and after every engine
   render. A verdict that any of those erased would be exactly as useless as
   the toast it replaces. Also: the guarded writers must not re-commit it. */
const textWritesBefore = HINT.textWrites, attrWritesBefore = HINT.writes;
for (let i = 0; i < 5; i += 1) lane.run('paintLaneHint(__hint, false, __tx(), "")');
eq(HINT.textContent, settled.text, 'a lane repaint erased the settled verdict');
eq(HINT.textWrites, textWritesBefore, 'five repaints re-committed the hint text (the guarded writer is bypassed)');
eq(HINT.writes, attrWritesBefore, 'five repaints re-committed the hint attributes');
/* and a repaint that happens to arrive with a note loaded must not restore the
   very sentence that hid the refusal */
eq(lane.run('paintLaneHint(__hint, false, __tx(), "S: knee pain\\nO: exam\\nA: sprain\\nP: rest")'), settled.text,
  'a loaded note overwrote the settled refusal with the "note is ready" sentence');

/* --- A4. A LATE SETTLE FROM AN ABANDONED RUN CANNOT OVERWRITE ------------- */
lane.run('noteGenSettled({ runId: 99, status: "success" })');
eq(lane.run('paintLaneHint(__hint, false, __tx(), "")'), settled.text,
  'a settle from a DIFFERENT runId cleared the verdict of the run the doctor is watching');

/* --- A5. A TRANSCRIPT EDIT CLEARS IT ------------------------------------- */
const EDITED = lane.nodes.transcript.value + ' Right knee, no head strike, ambulating with a limp.';
lane.nodes.transcript.value = EDITED;
eq(lane.run('paintLaneHint(__hint, false, __tx(), "")'),
  'Transcript added. Record to add more, or generate one note from every segment.',
  'a verdict about words that are no longer on screen survived the edit');
eq(HINT.getAttribute('data-mls-gen-run'), '', 'the failed marking survived the transcript edit');

/* --- A6. A SUCCESSFUL SETTLE RESTORES THE ORDINARY SENTENCE --------------- */
lane.run('noteGenStarted({ runId: 3 })');
eq(lane.run('paintLaneHint(__hint, false, __tx(), "")'), RUN_HINT, 'run 3 is not showing as in flight');
lane.run('noteGenSettled({ runId: 3, status: "success" })');
eq(lane.run('genRunHint().state'), '', 'a successful settle left the lane in a run state');
eq(lane.run('paintLaneHint(__hint, false, __tx(), "S: knee\\nO: exam\\nA: sprain\\nP: rest")'),
  'Your note is ready below. Review and edit it here before using any send tools.',
  'a successful settle does not restore the ordinary ready sentence');
eq(HINT.getAttribute('data-mls-gen-run'), '', 'a successful settle left the failed/active marking behind');

/* --- A7. A NEW RUN CLEARS THE PREVIOUS VERDICT ---------------------------- */
lane.run('noteGenStarted({ runId: 4 })');
lane.run('noteGenSettled({ runId: 4, status: "refused", code: "generation-refused", message: "Add one specific detail from today." })');
ok(lane.run('genRunState().settledHint').indexOf('Add one specific detail from today.') === 0,
  'a refused settle does not carry its own sentence');
lane.run('noteGenStarted({ runId: 5 })');
eq(lane.run('genRunState().settledHint'), '', 'starting a new run did not clear the previous verdict');
eq(lane.run('genRunState().active'), true, 'the new run is not marked active');

/* --- A8. an empty message still says something honest --------------------- */
lane.run('noteGenSettled({ runId: 5, status: "failed", code: "", message: "" })');
eq(lane.run('genRunState().settledHint'), 'Note generation did not finish. Nothing changed.',
  'a settle with no message produces an empty hint, which is the silent defect again');

/* ==========================================================================
 * PART B -- THE BUTTONS CARRY IT TOO
 *
 * The lane hint line is one surface. The other two are the top-lane button's
 * aria-disabled/title and the hero #ez3Gen's <small>, both painted by
 * paintGenGate in a DIFFERENT module - so the overlay has to travel across the
 * module boundary through window.__mlsGenerationRunState. The real
 * genRunOverlay/paintGenGate/syncGenGateUi are executed here.
 * ======================================================================== */
const READY_HINT = between(CONNECT, "  var GEN_READY_HINT = '", "';", 'the hero ready hint');
const GATE_REASON = extractFn(CONNECT, '  function genGateReason() {');
const RUN_OVERLAY = extractFn(CONNECT, '  function genRunOverlay() {');
const PAINT_GATE = extractFn(CONNECT, '  function paintGenGate(btn, reason, readyHint, run) {');
const SYNC_GATE = extractFn(CONNECT, '  function syncGenGateUi() {');

function bootGate(runStateFn) {
  const hero = makeEl('ez3Gen');
  hero.attrs.class = 'ez3-big';
  const small = makeEl('');
  hero.querySelector = (sel) => (sel === 'small' ? small : null);
  const flGen = makeEl('ez3flGen');
  const tx = makeEl('transcript');
  tx.value = 'Patient seen today for right knee pain after a fall on the stairs.';
  const nodes = { ez3Gen: hero, ez3flGen: flGen, transcript: tx };
  const sandbox = {
    String: String, Number: Number, Date: Date, Object: Object,
    document: { getElementById: (id) => nodes[id] || null }
  };
  sandbox.window = sandbox;
  sandbox.__mlsGenerationRunState = runStateFn;
  vm.createContext(sandbox);
  vm.runInContext(
    'function isFn(f){ return typeof f === "function"; }\n' +
    DOLLAR + '\n' +
    "  var GEN_READY_HINT = '" + READY_HINT + "';\n" +
    "  var GEN_NO_TEXT_HINT = 'Add some transcript text first';\n" +
    GATE_REASON + '\n' + RUN_OVERLAY + '\n' + PAINT_GATE + '\n' + SYNC_GATE + '\n',
    sandbox, { filename: 'gcx-genvis.js' }
  );
  return { sandbox, hero, small, flGen, tx, sync: () => vm.runInContext('syncGenGateUi()', sandbox) };
}

/* the lane's OWN state object, reached exactly as the shipped code reaches it */
const gate = bootGate(function () { return lane.run('genRunState()'); });

/* B0. resting: nothing blocked, the ordinary ready hint */
lane.run('noteGenSettled({ runId: 5, status: "success" })');
lane.run('noteGenStarted({ runId: 6 })');
lane.run('noteGenSettled({ runId: 6, status: "success" })');
gate.sync();
eq(gate.flGen.getAttribute('aria-disabled'), 'false', 'the lane Generate is blocked with no run and no gate reason');
eq(gate.small.textContent, READY_HINT, 'the hero hint is not the ordinary ready sentence at rest');

/* B1. STARTED -> aria-disabled with the reason, on BOTH controls */
lane.run('noteGenStarted({ runId: 7 })');
gate.sync();
eq(gate.flGen.getAttribute('aria-disabled'), 'true', 'a run in flight does not aria-disable the lane Generate');
eq(gate.flGen.getAttribute('title'), RUN_HINT, 'the lane Generate does not carry the in-flight reason');
eq(gate.hero.getAttribute('aria-disabled'), 'true', 'a run in flight does not aria-disable the hero Generate');
eq(gate.small.textContent, RUN_HINT, 'the hero <small> does not say a run is in flight');
ok(gate.hero.classList.contains('dim'), 'the hero lost its blocked skin during a run');

/* B2. SETTLED FAILED -> the message persists, and the button is PRESSABLE
   again. A settled refusal that also disabled the control would be a new,
   worse dead button: the doctor must be able to try again. */
lane.run('noteGenSettled({ runId: 7, status: "failed", code: "draft_quality_failed", message: ' +
  JSON.stringify(OWNER_MESSAGE) + ' })');
gate.sync();
eq(gate.flGen.getAttribute('aria-disabled'), 'false', 'a SETTLED refusal blocks the lane Generate - a settled verdict must never disable');
eq(gate.hero.getAttribute('aria-disabled'), 'false', 'a SETTLED refusal blocks the hero Generate');
ok(gate.small.textContent.indexOf(OWNER_MESSAGE) === 0,
  'the hero <small> does not carry the engine sentence verbatim: ' + JSON.stringify(gate.small.textContent));
ok(gate.small.textContent.indexOf('draft_quality_failed') > 0, 'the hero <small> dropped the settled code');

/* B3. it survives a repaint of the gate (syncGenGateUi runs on every keystroke) */
const smallWrites = gate.small.textWrites;
for (let i = 0; i < 4; i += 1) gate.sync();
ok(gate.small.textContent.indexOf(OWNER_MESSAGE) === 0, 'a gate repaint erased the settled verdict from the hero');
eq(gate.small.textWrites, smallWrites, 'four gate repaints re-committed the hero hint text');

/* B4. a successful settle returns the hero to its ordinary sentence */
lane.run('noteGenStarted({ runId: 8 })');
lane.run('noteGenSettled({ runId: 8, status: "success" })');
gate.sync();
eq(gate.small.textContent, READY_HINT, 'a successful settle does not restore the hero ready hint');
eq(gate.hero.getAttribute('aria-disabled'), 'false', 'a successful settle left the hero blocked');

/* B5. WITH NO LANE MOUNTED nothing changes. genRunOverlay must degrade to the
   pre-genvis behaviour, or every shell without the flow lane regresses. */
const bare = bootGate(undefined);
bare.sync();
eq(bare.flGen.getAttribute('aria-disabled'), 'false', 'with no lane mounted the gate invented a block');
eq(bare.small.textContent, READY_HINT, 'with no lane mounted the hero hint changed');

/* ==========================================================================
 * PART C -- THE WIRING, READ OUT OF THE SOURCE
 * ======================================================================== */
const codeOnly = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
/* `function boot()` is a name several modules in this bundle use; the flow
   lane's is the one whose observer calls scheduleFromMutation. */
const FLOW_BOOT = codeOnly(extractFn(CONNECT,
  '  function boot() {\n    try { _obs = new MutationObserver(function () { scheduleFromMutation(); }); } catch (e) {}'));
ok(FLOW_BOOT.indexOf("window.addEventListener('mls:generation-started', onLaneGenStarted)") > 0,
  'the flow lane no longer subscribes to mls:generation-started');
ok(FLOW_BOOT.indexOf("window.addEventListener('mls:generation-settled', onLaneGenSettled)") > 0,
  'the flow lane no longer subscribes to mls:generation-settled');
ok(CONNECT.indexOf("window.removeEventListener('mls:generation-started', onLaneGenStarted)") > 0,
  'revert() no longer detaches the started listener - a reverted module keeps repainting');
ok(CONNECT.indexOf("window.removeEventListener('mls:generation-settled', onLaneGenSettled)") > 0,
  'revert() no longer detaches the settled listener');
const SYNC_TOP = codeOnly(extractFn(CONNECT, '  function syncTopLane(rec) {'));
ok(SYNC_TOP.indexOf('paintLaneHint(hint, live, text, noteText)') > 0,
  'syncTopLane no longer paints the hint through the generation-aware painter');
ok(SYNC_TOP.indexOf('_genRun.active') > 0,
  'the lane Generate label no longer reads the run state, so it can offer to start a run already running');
/* One writer on aria-disabled for #ez3flGen: paintGenGate. syncTopLane must
   not have grown a second one - two writers on one attribute is a defect this
   repo has already paid for. */
ok(!/setLaneAttr\(gb, 'aria-disabled'/.test(SYNC_TOP),
  'syncTopLane became a second writer of aria-disabled on the lane Generate');
ok(CONNECT.indexOf("'#mlsEz3 .ez3fl-rechint[data-mls-gen-run=\"failed\"]") > 0,
  'the lane hint lost the skin a failed run renders in');
ok(CONNECT.indexOf("'#mlsEz3 .ez3fl-rechint[data-mls-gen-run=\"active\"]") > 0,
  'the lane hint lost the skin an active run renders in');
/* The derived lanes ship what 1p ships. A cure only in the source is a cure
   nobody runs. */
['mls-connect.js', 'cloned-mls-connect.js'].forEach(function (f) {
  const src = read(f);
  ok(src.indexOf('function paintLaneHint(hint, live, text, noteTextValue) {') > 0,
    f + ' was not re-derived - it has no generation-aware lane hint painter');
  ok(src.indexOf('function genRunOverlay() {') > 0, f + ' was not re-derived - it has no run overlay');
});

/* ==========================================================================
 * PART D -- EVERY HISTORY REFUSAL LEAVES A ROW THAT SAYS SO
 *
 * The shipped pushHistoryNoteToAthena and the shipped histrefuse block are
 * executed. Each branch is driven to its refusal and measured on three things:
 * the toast still fires, the per-note record is written, and NOTHING reaches
 * _athenaPushPlan. Then the real .hist-item template renders the record.
 * ======================================================================== */
const ESC = extractFn(SHELL, 'function esc(s){');
const HISTREFUSE = between(
  SHELL,
  '/* ===== histrefuse-1.0.0 begin ============================================',
  '/* ===== histrefuse-1.0.0 end ============================================== */',
  'the histrefuse-1.0.0 block'
).replace(/^[\s\S]*?\*\//, '');   /* drop the trailing half of the opening comment */
const PUSH_FN = extractFn(SHELL, 'function pushHistoryNoteToAthena(id){');

/* the real row template, evaluated with its own locals supplied */
const ROW_SRC = (function () {
  const at = SHELL.indexOf('    return `<div class="hist-item" role="button" tabindex="0" aria-haspopup="dialog"');
  assert.ok(at >= 0, 'the .hist-item row template moved or was rewritten');
  const end = SHELL.indexOf('`;', at);
  assert.ok(end > at, 'the .hist-item row template is unterminated');
  return SHELL.slice(at, end + 2);
})();
ok(ROW_SRC.indexOf('${_mlsHistRefusalHtml(n.id)}') > 0,
  'the History row template no longer renders the per-note refusal line');

function bootHistory() {
  const toasts = [];
  const pushed = [];
  const sandbox = {
    String: String, Number: Number, Date: Date, Object: Object, Array: Array, JSON: JSON,
    document: { getElementById: () => null },
    toast: (m, k) => { toasts.push({ msg: String(m), kind: String(k || '') }); },
    ATHENA_SECTIONS: {
      note: { icon: 'N', label: 'Note', dest: 'Clinicals > Note' },
      procedure: { icon: 'P', label: 'Procedure', dest: 'Procedure Documentation' },
      dx: { icon: 'D', label: 'Dx', dest: 'Assessment' },
      billing: { icon: 'B', label: 'Billing', dest: 'Charges' },
      orders: { icon: 'O', label: 'Orders', dest: 'Orders' }
    },
    _athenaCanonicalBilling: () => ({}),
    _athenaOrderReviewBundle: () => ({ drafts: [], suggestions: [] }),
    _athenaPushPlan: (plan, who) => { pushed.push({ plan: plan, who: who }); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ESC + '\n' + HISTREFUSE + '\n' + PUSH_FN + '\n' +
    'function __renderRow(n, patName, cc, dateStr, status, kindTag, orphanTag, pushBtn, attachBtn){' +
    '  var _syncBadge = function(){ return ""; };' + ROW_SRC + '}\n',
    sandbox, { filename: 'histrefuse-1.0.0.js' });
  return {
    sandbox, toasts, pushed,
    setNotes(list) { sandbox.getNotes = () => list; },
    press(id) { return vm.runInContext('pushHistoryNoteToAthena(' + JSON.stringify(id) + ')', sandbox); },
    record(id) { return vm.runInContext('_mlsHistRefusalFor(' + JSON.stringify(id) + ')', sandbox); },
    html(id) { return vm.runInContext('_mlsHistRefusalHtml(' + JSON.stringify(id) + ')', sandbox); },
    row(id) {
      return vm.runInContext('__renderRow(' + JSON.stringify({ id: id, isDraft: false, text: 'x' }) +
        ', "Adam J Schaeffer", "Knee pain", "9/1/2026 10:00 AM", "", "", "", "", "")', sandbox);
    },
    set(name, value) { sandbox[name] = value; }
  };
}

/* Every refusal branch pushHistoryNoteToAthena owns, in source order. `set`
   installs only what that branch needs to be reached. */
const OWNER_NOTE_ID = 'n1788181673092neds';
const GOOD_BINDING = { patient: { name: 'Adam J Schaeffer', id: 'p1' }, visitContext: null, noteTimestamp: 0 };
const BRANCHES = [
  {
    name: 'the note no longer exists',
    id: 'gone-1',
    setup(h) { h.setNotes([]); },
    expect: 'That visit no longer exists.'
  },
  {
    name: 'the note has no text at all',
    id: 'empty-1',
    setup(h) { h.setNotes([{ id: 'empty-1', text: '', soap: '   ' }]); },
    expect: 'This visit has no note text to review.'
  },
  {
    name: 'the note is still a draft',
    id: 'draft-1',
    setup(h) { h.setNotes([{ id: 'draft-1', text: 'transcript only', isDraft: true }]); },
    expect: 'This is still a draft. Complete and save it before reviewing Athena actions. Nothing changed.'
  },
  {
    name: 'the note still has unresolved template fields',
    id: 'blank-1',
    setup(h) {
      h.setNotes([{ id: 'blank-1', text: 'PROCEDURE: ___' }]);
      h.set('opNoteBlankTokens', () => [{ label: 'Surgeon' }, { label: 'Laterality' }]);
    },
    expect: 'This note still has 2 unresolved fields (Surgeon, Laterality). Fill them in before any Athena review. Nothing changed.'
  },
  {
    name: 'the saved binding was quarantined',
    id: 'route-1',
    setup(h) {
      h.setNotes([{ id: 'route-1', text: 'a real note body' }]);
      h.set('opNoteBlankTokens', () => []);
      h.set('_athenaBindingForSavedRecord', () => ({ routeBlocked: true }));
    },
    expect: 'This saved visit was quarantined because its patient binding was not safe. Recreate it as a New visit for the correct patient before any Athena action. Nothing changed.'
  },
  {
    name: 'the saved identity conflicts with its linked chart',
    id: 'ident-1',
    setup(h) {
      h.setNotes([{ id: 'ident-1', text: 'a real note body' }]);
      h.set('opNoteBlankTokens', () => []);
      h.set('_athenaBindingForSavedRecord', () => ({ identityConflict: true }));
    },
    expect: 'This saved visit patient identity conflicts with its linked chart. Correct or reattach it before any Athena action. Nothing changed.'
  },
  {
    name: 'THE ONE THE OWNER HIT: the saved canonical payload is stale',
    id: OWNER_NOTE_ID,
    setup(h) {
      h.setNotes([{ id: OWNER_NOTE_ID, text: 'a real generated note body' }]);
      h.set('opNoteBlankTokens', () => []);
      h.set('_athenaBindingForSavedRecord', () => GOOD_BINDING);
      h.set('_mlsSavedAthenaCanonicalForWrite', () => ({ required: true, ok: false, reason: 'canonical-source-changed' }));
    },
    expect: 'This saved generated note no longer has a current, verified five-section Athena payload. Reopen it, regenerate or repair the standard note, and save it again. Nothing changed in Athena.',
    cure: true
  },
  {
    name: 'the review sheet itself is not loaded',
    id: 'nosheet-1',
    setup(h) {
      h.setNotes([{ id: 'nosheet-1', text: 'a real note body' }]);
      h.set('opNoteBlankTokens', () => []);
      h.set('_athenaBindingForSavedRecord', () => GOOD_BINDING);
      h.set('_mlsSavedAthenaCanonicalForWrite', () => ({ required: false }));
      h.set('_athenaPushPlan', undefined);
    },
    expect: 'Could not open the Athena review. Nothing was written.'
  }
];

BRANCHES.forEach(function (b) {
  const h = bootHistory();
  b.setup(h);
  h.press(b.id);

  /* 1. the toast still fires. This fix ADDS a surface; it removes none. */
  eq(h.toasts.length, 1, b.name + ': the toast stopped firing');
  eq(h.toasts[0].msg, b.expect, b.name + ': the toast sentence changed');
  eq(h.toasts[0].kind, 'err', b.name + ': the refusal is no longer toasted as an error');

  /* 2. the per-note record is written, with the SAME sentence */
  const rec = h.record(b.id);
  ok(rec, b.name + ': no per-note refusal record was written - the row will show nothing');
  eq(rec.message, b.expect, b.name + ': the recorded sentence differs from the toasted one');
  if (b.cure) {
    eq(rec.cure, 'Open this visit ▸ Regenerate ▸ Save to history, then review again',
      b.name + ': the canonical refusal lost its cure hint');
  } else {
    eq(rec.cure, '', b.name + ': a cure hint was invented for a branch that has no sequence to follow');
  }

  /* 3. NOTHING reached Athena. A refused note never opens the sheet. */
  eq(h.pushed.length, 0, b.name + ': a refused note reached _athenaPushPlan');

  /* 4. the row template renders it, escaped, announced */
  const html = h.html(b.id);
  ok(html.indexOf('role="status"') > 0, b.name + ': the row line is not announced');
  ok(html.indexOf('class="hist-refusal"') > 0, b.name + ': the row line lost its class, so it has no skin');
  ok(html.indexOf(vm.runInContext('esc(' + JSON.stringify(b.expect) + ')', h.sandbox)) > 0,
    b.name + ': the row line does not carry the refusal sentence');
  const row = h.row(b.id);
  ok(row.indexOf('class="hist-refusal"') > 0, b.name + ': the .hist-item template did not render the refusal line');
  ok(row.indexOf('hist-main') > 0 && row.indexOf('hist-refusal') > row.indexOf('hist-main'),
    b.name + ': the refusal line is not inside the row main column');
});

/* D2. THE SHEET STILL OPENS when nothing refuses - and a previous refusal on
   that same note is cleared by the successful press. */
(function () {
  const h = bootHistory();
  h.setNotes([{ id: OWNER_NOTE_ID, text: 'a real generated note body' }]);
  h.set('opNoteBlankTokens', () => []);
  h.set('_athenaBindingForSavedRecord', () => GOOD_BINDING);
  h.set('_mlsSavedAthenaCanonicalForWrite', () => ({ required: true, ok: false, reason: 'canonical-source-changed' }));
  h.press(OWNER_NOTE_ID);
  ok(h.record(OWNER_NOTE_ID), 'the refusal record was not written on the first press');

  h.set('_mlsSavedAthenaCanonicalForWrite', () => ({
    required: true, ok: true,
    sections: [{ key: 'note', text: 'HPI...' }, { key: 'exam', text: 'EXAM...' }]
  }));
  h.press(OWNER_NOTE_ID);
  eq(h.pushed.length, 1, 'a note that passes every gate no longer reaches the review sheet');
  eq(h.record(OWNER_NOTE_ID), null, 'a successful review press left the old refusal on the row');
  eq(h.html(OWNER_NOTE_ID), '', 'a cleared refusal still renders html');
  ok(h.row(OWNER_NOTE_ID).indexOf('hist-refusal') < 0, 'a cleared refusal still renders in the row');
})();

/* D3. a REPEAT refusal keeps exactly one record, and the newest sentence */
(function () {
  const h = bootHistory();
  h.setNotes([{ id: 'draft-1', text: 'x', isDraft: true }]);
  h.press('draft-1'); h.press('draft-1'); h.press('draft-1');
  eq(h.toasts.length, 3, 'a repeat press stopped toasting');
  const html = h.html('draft-1');
  eq(html.split('hist-refusal').length - 1, 1, 'three presses stacked three status lines on one row');
})();

/* D4. the two clearing paths are wired where the brief puts them */
const OPEN_FN = extractFn(SHELL, 'function openNoteFromHistory(id){');
ok(codeOnly(OPEN_FN).indexOf('_mlsHistRefusalClear(id)') > 0,
  'a successful open no longer clears the row refusal');
const UPSERT_FN = extractFn(SHELL, 'function upsertNote(rec){');
ok(codeOnly(UPSERT_FN).indexOf('_mlsHistRefusalClear(rec.id)') > 0,
  'a successful save no longer clears the row refusal');
ok(codeOnly(UPSERT_FN).indexOf('_mlsHistRefusalClear(rec.id)') < codeOnly(UPSERT_FN).indexOf('renderHistory()'),
  'the save clears the refusal AFTER the repaint that draws the row, so the stale line survives one render');

/* D5. NOTHING WAS WEAKENED. The refusal branches still refuse - each one is
   still a `return` and none of them gained a way through. */
const PUSH_CODE = codeOnly(PUSH_FN);
eq((PUSH_CODE.match(/_mlsHistPushRefuse\(/g) || []).length, BRANCHES.length,
  'the number of recorded refusal branches changed - a branch was added without a row line, or one was removed');
ok(PUSH_CODE.indexOf('if(_phRefused) return;') > 0,
  'the unresolved-fields refusal no longer returns outside its try, so a throw could let it through');

/* D6. BOTH TWINS. A fix that lands in one shell is a fix half the traffic
   never sees - and the two are NOT byte-identical, so each is checked. */
[
  ['1p/index.html', SHELL_P1],
  ['ScribeFlow.html', read('ScribeFlow.html')],
  ['cloned/index.html', read('cloned/index.html')]
].forEach(function (pair) {
  const name = pair[0], src = pair[1];
  ok(src.indexOf('function _mlsHistPushRefuse(id,message,cure){') > 0,
    name + ' has no History refusal recorder');
  ok(src.indexOf('${_mlsHistRefusalHtml(n.id)}') > 0,
    name + ' does not render the refusal line in its History row');
  ok(src.indexOf('.hist-main .hist-refusal{') > 0, name + ' has no skin for the refusal line');
  ok(src.indexOf("HIST_REFUSAL_CANON_CURE='Open this visit ▸ Regenerate ▸ Save to history, then review again'") > 0,
    name + ' lost the canonical cure hint');
  eq((src.match(/_mlsHistPushRefuse\(/g) || []).length, BRANCHES.length + 1,
    name + ' does not record the same set of refusal branches (definition + ' + BRANCHES.length + ' call sites)');
});

console.log('PASS refusal-visibility-proof: ' + checks +
  ' checks - a generation in flight and a settled refusal both say so on the flow lane and on both Generate buttons, ' +
  'and every pushHistoryNoteToAthena refusal leaves a persistent line in its own History row in both twins');

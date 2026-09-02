'use strict';

/* upnow-banner-state-proof.js  --  upnowstate-1.0.0  (2026-09-02)
 * ============================================================================
 * THE STALE UI ELEMENT, MEASURED IN THE OWNER'S OWN TAB.
 *
 * On the Visit screen, on a real visit, late morning 2026-09-02, the schedule
 * banner (#heroPullStatus) read
 *
 *     "Up now: <patient> - loaded & ready. Hit Start recording."
 *
 * while the SAME screen showed a captured transcript ("9 words captured"),
 * "Your note is ready below", the generated note itself, and the step bar
 * sitting on Review & Sign. The banner was naming a step the doctor had
 * finished three steps earlier. The sentence is written ONCE, when the patient
 * is loaded, and nothing in the visit ever revised it.
 *
 * Cured by upnowstate-1.0.0 in the source bundle: the banner's TAIL now names
 * the state the visit is actually in, repainted on the events the flow lane
 * already emits. Everything below EXECUTES the shipped block - it is sliced
 * out of the file between its own begin/end delimiters and run against a DOM
 * stub - never a re-implementation of it.
 *
 * WHAT THIS SUITE REFUSES TO LET REGRESS
 *   A  the state table, every row, driven through the shipped painter;
 *   B  the head is carried byte-for-byte, so a repaint can never rename a
 *      patient, drop their appointment time, or double-escape their name;
 *   C  the surface is never stolen - a pull-progress sentence, the "No more
 *      patients today." line and an empty node are all left untouched, because
 *      #heroPullStatus is shared with the pull lane;
 *   D  when the up-now patient is NOT the active patient the module repaints
 *      NOTHING, so today's honest strip keeps that case (and no second banner
 *      is ever minted);
 *   E  the repaint is guarded - an already-correct banner costs zero writes,
 *      which is also what keeps the module's own MutationObserver from driving
 *      itself;
 *   F  the ready sentence is still the SHIPPED shell sentence, byte for byte -
 *      one wording for one state, in the shell painter and here alike;
 *   G  the module wires only events the app already emits and starts NO timer
 *      (a hidden tab freezes timers, and this surface must be right the
 *      instant the doctor looks at it);
 *   H  both derived twins carry the block, so this can never ship to /1p only.
 *
 * Run: node tests/upnow-banner-state-proof.js
 * ==========================================================================*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

const CONNECT = read('1p-mls-connect.js');
const SHELL = read('1pScribeFlow.html');

let checks = 0;
function ok(cond, msg) { checks += 1; assert.ok(cond, msg); }
function eq(a, b, msg) {
  checks += 1;
  assert.strictEqual(a, b, msg + '\n      got:      ' + JSON.stringify(a) + '\n      expected: ' + JSON.stringify(b));
}

function between(source, from, to, what) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, 'missing start marker for ' + what);
  const b = source.indexOf(to, a);
  assert.ok(b > a, 'missing end marker for ' + what);
  return source.slice(a + from.length, b);
}

const BEGIN = '  /* ===== upnowstate-1.0.0 begin ========================================== */';
const END = '  /* ===== upnowstate-1.0.0 end ============================================ */';
const BLOCK = between(CONNECT, BEGIN, END, 'the upnowstate-1.0.0 block in the source bundle');

ok(BLOCK.indexOf('function upNowVisitState(') > 0, 'the block no longer owns the state decision');
ok(BLOCK.indexOf('function upNowSplitBanner(') > 0, 'the block no longer owns the "is this my sentence" test');
ok(BLOCK.indexOf('function upNowPlan(') > 0, 'the block no longer owns the repaint plan');
ok(BLOCK.indexOf('function upNowPaintBanner(') > 0, 'the block no longer owns the guarded banner writer');
ok(!/[^\x00-\x7f]/.test(BLOCK),
  'the shipped block carries a non-ASCII byte - both derive scripts re-emit these constants and a latin1 writer in that chain turns literal astral characters into control bytes');

/* ==========================================================================
 * A DOM small enough to read and real enough to measure. innerHTML is a real
 * accessor so writes can be counted: "repainted correctly" and "rewritten on
 * every repaint" are different things, and only one of them is acceptable on a
 * node the pull lane also observes.
 * ======================================================================== */
function makeEl(id) {
  const el = {
    id: id || '', attrs: Object.create(null), _html: '',
    htmlWrites: 0, attrWrites: 0,
    setAttribute(k, v) { el.attrs[k] = String(v); el.attrWrites += 1; },
    getAttribute(k) { return (k in el.attrs) ? el.attrs[k] : null; },
    removeAttribute(k) { delete el.attrs[k]; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); el.htmlWrites += 1; }
  });
  return el;
}

const sandbox = { String, Number, Object, Array, RegExp, Boolean, Math, JSON };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(BLOCK, sandbox, { filename: 'upnowstate-1.0.0.js' });
const run = (src) => vm.runInContext(src, sandbox);

const HEAD = run('UPNOW_HEAD');
const SEP = run('UPNOW_SEP');
const TAIL = run('JSON.parse(JSON.stringify(UPNOW_TAIL))');

/* --------------------------------------------------------------------------
 * F -- THE READY SENTENCE IS STILL THE SHELL'S OWN SENTENCE
 *
 * SPELLING PIN, ON PURPOSE, WITH ITS REASON IN THE FILE: the shell's
 * _calLoadNextUp writes this exact head and this exact ready tail, and the
 * up-now sync module's adopt path writes the same bytes. If this module were
 * allowed to paraphrase either one, a visit that is genuinely just loaded
 * would flip between two wordings depending on which painter ran last - two
 * sentences for one state, which is the defect class this lane already carries
 * a pin for. Byte equality with the shell is also what makes the "already
 * correct" case cost zero DOM writes.
 * ------------------------------------------------------------------------ */
ok(SHELL.indexOf(HEAD) > 0, 'the shell painter no longer writes the head this module matches on: ' + JSON.stringify(HEAD));
ok(SHELL.indexOf(SEP + TAIL.ready) > 0,
  'the shell painter no longer writes the ready sentence this module reuses: ' + JSON.stringify(SEP + TAIL.ready));
eq(Object.keys(TAIL).sort().join(','), 'note,ready,recording,sent,transcript',
  'the set of banner states changed without this suite being re-aimed');

/* --------------------------------------------------------------------------
 * A -- THE STATE TABLE, DRIVEN THROUGH THE SHIPPED DECISION
 * ------------------------------------------------------------------------ */
const UP = 'SCHAEFFER, ADAM J OV1.';
const ACTIVE = 'Adam Schaeffer';
const NOTE = 'S: knee pain\nO: exam\nA: sprain\nP: rest';
const TX = 'Patient seen today for right knee pain after a fall on the stairs.';

function state(ctx) { return run('upNowVisitState(' + JSON.stringify(ctx) + ')'); }

const TABLE = [
  ['nothing captured yet', { upName: UP, activeName: ACTIVE }, 'ready'],
  ['recording live', { upName: UP, activeName: ACTIVE, recording: true }, 'recording'],
  ['transcript, no note', { upName: UP, activeName: ACTIVE, transcript: TX }, 'transcript'],
  ['note generated', { upName: UP, activeName: ACTIVE, transcript: TX, note: NOTE }, 'note'],
  ['note verified into Athena', { upName: UP, activeName: ACTIVE, transcript: TX, note: NOTE, sent: true }, 'sent'],
  ['a different chart is open', { upName: UP, activeName: 'Anna Schaeffer', note: NOTE }, 'elsewhere'],
  ['no chart is open at all', { upName: UP, activeName: '' }, 'elsewhere']
];
for (const [label, ctx, want] of TABLE) eq(state(ctx), want, 'state table row "' + label + '"');

/* The two deliberate precedences, stated as their own rows so a later edit
   cannot quietly reorder them. */
eq(state({ upName: UP, activeName: ACTIVE, recording: true, transcript: TX, note: NOTE, sent: true }), 'recording',
  'a live microphone stopped outranking everything else on the screen');
eq(state({ upName: UP, activeName: ACTIVE, transcript: TX, note: NOTE, sent: true }), 'sent',
  'a verified Athena write stopped outranking "note ready"');
/* Whitespace is not a transcript and is not a note. */
eq(state({ upName: UP, activeName: ACTIVE, transcript: '   \n  ' }), 'ready',
  'blank whitespace in the transcript box was counted as a captured transcript');
eq(state({ upName: UP, activeName: ACTIVE, transcript: TX, note: '  \n ' }), 'transcript',
  'a blank note box was counted as a generated note');

/* --------------------------------------------------------------------------
 * The tolerant identity comparator. Exact-name matching is the defect class
 * that mints duplicate charts; here it would fail quietly instead - the
 * schedule's row name and the chart's name are never spelled the same way, so
 * an exact test would send the module into permanent stand-down on the very
 * visit it exists for.
 * ------------------------------------------------------------------------ */
const same = (a, b) => run('upNowSamePerson(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')');
ok(same('SCHAEFFER, ADAM J OV1.', 'Adam Schaeffer'), 'a schedule row name no longer matches its own chart');
ok(same('Adam J Schaeffer', 'Adam Schaeffer Jr'), 'a middle initial or a generational suffix now splits one person in two');
ok(!same('Adam Schaeffer', 'Anna Schaeffer'), 'two people who share a surname are treated as the same person');
ok(!same('Schaeffer', 'Schaeffer'), 'a lone surname is enough to claim two records are one person');
ok(!same('Adam Schaeffer', ''), 'an empty active chart matched a real patient');

/* --------------------------------------------------------------------------
 * B / C / D / E -- THE PAINTER AGAINST A REAL NODE
 * ------------------------------------------------------------------------ */
function banner(name, time) {
  return HEAD + name + '</b>' + (time ? (' at ' + time) : '') + SEP + TAIL.ready;
}
function paint(el, ctx) {
  sandbox.__el = el;
  return run('upNowPaintBanner(__el, ' + JSON.stringify(ctx) + ')');
}

/* B -- THE MEASURED DEFECT, PINNED DIRECTLY. This is the owner's own screen:
   the banner still says "loaded & ready" while a note is on the page. */
const live = makeEl('heroPullStatus');
live.innerHTML = banner('Adam Schaeffer', '11:40 AM');
const beforeStale = live.innerHTML;
const notePlan = paint(live, { activeName: ACTIVE, transcript: TX, note: NOTE });
eq(notePlan.state, 'note', 'the measured screen (transcript + generated note) did not reach the note state');
ok(live.innerHTML !== beforeStale, 'the stale "loaded & ready" sentence survived a screen with a generated note on it');
eq(live.innerHTML, HEAD + 'Adam Schaeffer</b> at 11:40 AM' + SEP + TAIL.note,
  'the repainted banner is not the head plus the note-ready tail');
eq(live.getAttribute('data-mls-upnow-state'), 'note', 'the banner does not publish which state it is painting');
/* the head is carried over, never rebuilt: the patient and their time survive */
ok(live.innerHTML.indexOf('Adam Schaeffer</b> at 11:40 AM') > 0,
  'a repaint dropped the patient name or their appointment time');

/* every remaining state, on the same node, in the order a visit runs */
const ORDER = [
  [{ activeName: ACTIVE, recording: true, transcript: TX, note: NOTE }, 'recording'],
  [{ activeName: ACTIVE, transcript: TX }, 'transcript'],
  [{ activeName: ACTIVE, transcript: TX, note: NOTE }, 'note'],
  [{ activeName: ACTIVE, transcript: TX, note: NOTE, sent: true }, 'sent'],
  [{ activeName: ACTIVE }, 'ready']
];
for (const [ctx, want] of ORDER) {
  const plan = paint(live, ctx);
  eq(plan.state, want, 'the painter did not reach the ' + want + ' state');
  eq(live.innerHTML, HEAD + 'Adam Schaeffer</b> at 11:40 AM' + SEP + TAIL[want],
    'the ' + want + ' state did not paint its own tail');
  eq(live.getAttribute('data-mls-upnow-state'), want, 'the ' + want + ' state is not published on the node');
}

/* B2 -- an ampersand in a name is already escaped by whoever painted it, and a
   repaint that rebuilt the head would escape it a second time. */
const amp = makeEl('heroPullStatus');
amp.innerHTML = HEAD + 'Anne-Marie O&#39;Neill &amp; Co</b>' + SEP + TAIL.ready;
const ampPlan = paint(amp, { activeName: "Anne-Marie O'Neill & Co", transcript: TX });
eq(ampPlan.state, 'transcript', 'an escaped name broke the identity match against the active chart');
ok(amp.innerHTML.indexOf('Anne-Marie O&#39;Neill &amp; Co</b>') > 0,
  'a repaint double-escaped the patient name: ' + JSON.stringify(amp.innerHTML));

/* E -- GUARDED. An already-correct banner costs zero writes. This is also what
   stops the module's own MutationObserver from driving itself. */
const steady = makeEl('heroPullStatus');
steady.innerHTML = banner('Adam Schaeffer', '');
paint(steady, { activeName: ACTIVE, transcript: TX });
const htmlWrites = steady.htmlWrites, attrWrites = steady.attrWrites;
for (let i = 0; i < 6; i += 1) paint(steady, { activeName: ACTIVE, transcript: TX });
eq(steady.htmlWrites, htmlWrites, 'six repaints of an unchanged state re-committed the banner HTML');
eq(steady.attrWrites, attrWrites, 'six repaints of an unchanged state re-committed the state attribute');

/* A visit that really IS only loaded is left byte-identical - the ready tail
   is the shell's own sentence, so the correct banner is never touched. */
const fresh = makeEl('heroPullStatus');
fresh.innerHTML = banner('Adam Schaeffer', '9:00 AM');
const freshWrites = fresh.htmlWrites;
const freshPlan = paint(fresh, { activeName: ACTIVE });
eq(freshPlan.state, 'ready', 'a freshly loaded patient did not read as ready');
eq(fresh.htmlWrites, freshWrites, 'a correct "loaded & ready" banner was rewritten with identical bytes');

/* D -- THE UP-NOW PATIENT IS NOT THE ACTIVE PATIENT: REPAINT NOTHING. That
   case belongs to the schedule anchor's honest strip; a sentence here would be
   the second banner this must not add. */
const away = makeEl('heroPullStatus');
away.innerHTML = banner('Adam Schaeffer', '11:40 AM');
const awayBefore = away.innerHTML, awayWrites = away.htmlWrites;
const awayPlan = paint(away, { activeName: 'Anna Schaeffer', transcript: TX, note: NOTE });
eq(awayPlan.state, 'elsewhere', 'a different active chart did not read as elsewhere');
eq(awayPlan.html, '', 'the elsewhere state offered a sentence of its own to paint');
eq(away.innerHTML, awayBefore, 'the elsewhere state repainted the banner instead of standing down');
eq(away.htmlWrites, awayWrites, 'the elsewhere state wrote to the banner');
eq(away.getAttribute('data-mls-upnow-state'), null, 'the elsewhere state stamped the shared node anyway');

/* C -- THE SURFACE IS SHARED AND IS NEVER STOLEN. #heroPullStatus also carries
   the pull lane's progress sentences and the real-time module's honest
   "no more patients" line. None of them match the head, so none are touched. */
const FOREIGN = [
  ['a pull-progress sentence', 'Pulling today’s schedule from Athena…'],
  ['the honest past-all line', 'No more patients today.'],
  ['an empty banner', ''],
  ['a head with no separator', HEAD + 'Adam Schaeffer</b>'],
  ['a sentence that merely mentions up now', 'Up now on the schedule: Adam Schaeffer.']
];
for (const [label, html] of FOREIGN) {
  const el = makeEl('heroPullStatus');
  el.innerHTML = html;
  const w = el.htmlWrites;
  const plan = paint(el, { activeName: ACTIVE, transcript: TX, note: NOTE });
  eq(plan, null, 'the painter claimed ' + label + ' as its own');
  eq(el.innerHTML, html, 'the painter overwrote ' + label);
  eq(el.htmlWrites, w, 'the painter wrote over ' + label);
}
/* and a missing node is simply not a crash */
eq(run('upNowPaintBanner(null, {})'), null, 'the painter threw or claimed something when the banner is absent');

/* --------------------------------------------------------------------------
 * G -- THE SHIPPED MODULE: EXISTING HOOKS ONLY, AND NO TIMER
 * ------------------------------------------------------------------------ */
const MODULE = between(
  CONNECT,
  ' * __mlsUpNowState   upnowstate-1.0.0',
  '/* ===== upnowstate-1.0.0 module end',
  'the whole upnowstate-1.0.0 module'
);
for (const ev of ['mls:generation-started', 'mls:generation-settled', 'mls:generation-refused',
  'mls:active-patient-changed', 'mls:view-changed', 'mls:review-step']) {
  ok(MODULE.indexOf(ev) > 0, 'the module stopped repainting on ' + ev);
}
ok(/'input', 'change', 'click'/.test(MODULE),
  'the module stopped listening on the same capture-phase signals the flow lane uses');
/* The forbidden-token scans below run against CODE, not prose: this module's
   own documentation names the very things it must not do ("NO setInterval and
   NO setTimeout"), and a scan that read those sentences would fail on a module
   that is behaving perfectly. The module carries no line comments, so removing
   the block comments is the whole job. */
const MODULE_CODE = MODULE.slice(MODULE.indexOf('*/') + 2).replace(/\/\*[\s\S]*?\*\//g, ' ');
ok(MODULE_CODE.indexOf('upNowPaintBanner') > 0, 'the comment stripper ate the module body');
ok(!/setInterval|setTimeout|requestAnimationFrame/.test(MODULE_CODE),
  'the module started a timer - a hidden tab freezes timers, and this banner has to be right the instant the doctor looks at it');
ok(MODULE_CODE.indexOf('createElement') < 0,
  'the module creates an element - it may only repaint the ONE banner that already exists, never mint a second one');
ok(/api\.revert = function/.test(MODULE_CODE), 'the module is no longer reversible');
ok(MODULE_CODE.indexOf('if (window.__mlsUpNowState) return;') > 0, 'the module lost its double-install guard');
/* it must never move a patient, press a control, or reach the write path */
for (const forbidden of ['selectPatient', 'startAthenaAction', 'pushEntireVisitToAthena', '.click(']) {
  ok(MODULE_CODE.indexOf(forbidden) < 0, 'the module reaches ' + forbidden + ' - it may only repaint a sentence');
}

/* --------------------------------------------------------------------------
 * H -- BOTH DERIVED TWINS CARRY IT
 * ------------------------------------------------------------------------ */
for (const twin of ['mls-connect.js', 'cloned-mls-connect.js']) {
  const text = read(twin);
  ok(text.indexOf(BEGIN) > 0, twin + ' does not carry the upnowstate block - re-run the derive scripts');
  eq(between(text, BEGIN, END, twin + ' block'), BLOCK, twin + ' carries a DIFFERENT upnowstate block than the source');
}

console.log('upnow-banner-state-proof: ' + checks + ' checks passed');
console.log('  state table: ready / recording / transcript / note / sent / elsewhere (stand down)');

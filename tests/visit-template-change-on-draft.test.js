'use strict';
/* vntplpick-1.0.0 control: A DRAFTED VISIT NOTE CAN BE WRITTEN AGAIN WITH A
 * DIFFERENT TEMPLATE, IN ONE PRESS, AND ONLY EVER WITH A VISIT-NOTE TEMPLATE.
 *
 * Owner ask 2026-09-11: "make a simple easy way, if a note is drafted and has
 * a bad template, to change the template for the normal notes."
 *
 * Two things decide whether this can work at all, and both are measured here:
 *   (1) the connect bundle REPLACES window.resolveActiveTemplate outright, so
 *       the only template seam guaranteed to run on the first draft is
 *       _mlsResolveGenerationTemplate - a choice honoured anywhere else would
 *       never fire in production;
 *   (2) the 2026-09-01 lesson: an operative-report template must never steer a
 *       visit note. The chosen template goes through the SAME scope gate the
 *       automatic path uses, so the new door cannot let one in.
 *
 * Executes the REAL shipped bytes: the shell's vntpl classifier and
 * _mlsResolveGenerationTemplate, and the live visit room's tplChangeAllowed /
 * visitTemplateList / currentTplChoice / tplPickHtml / applyTplPick.
 *
 * OLD BYTES FAIL BY NAME: no __mlsVisitTplPick, no tplPickHtml.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let checks = 0;
function ok(v, msg) { assert.ok(v, msg); checks += 1; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); checks += 1; }
function read(rel) { return fs.readFileSync(path.join(root, rel.split('/').join(path.sep)), 'utf8'); }

function between(text, a, b, label) {
  const start = text.indexOf(a);
  assert.ok(start >= 0, 'missing span start: ' + (label || a));
  const end = text.indexOf(b, start + a.length);
  assert.ok(end > start, 'missing span end: ' + (label || b));
  return text.slice(start, end);
}
function extractFn(text, marker) {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, 'missing shipped function: ' + marker);
  const open = text.indexOf('{', at + marker.length - 1);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i], next = text[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i += 1; continue; }
    if (ch === '/' && next === '*') { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error('unbalanced shipped function: ' + marker);
}

const SHELL = read('1pScribeFlow.html');
const CONNECT = read('1p-mls-connect.js');
const LIVE = CONNECT.slice(0, CONNECT.indexOf('Retired historical Easy') > 0
  ? CONNECT.indexOf('Retired historical Easy') : CONNECT.length);
ok(LIVE.indexOf("var VER = '3.7.3';") > 0, 'the live Easy 3.7.3 owner is gone');

const CLASSIFIER = between(SHELL,
  '/* ===== vntpl-1.1.0 - THE STANDARD VISIT NOTE ONLY EVER TAKES A VISIT-NOTE',
  '/* ===== end vntpl-1.1.0 classifier ===== */', 'the vntpl-1.1.0 classifier');
const KINDOF_FN = extractFn(SHELL, 'function _mlsTplKindOf(t){');
const GENRESOLVE_FN = extractFn(SHELL, 'function _mlsResolveGenerationTemplate(visitText,runPick){');
const CONSUME_FN = extractFn(SHELL, 'function _mlsConsumeVisitTplPick(){');
const CLEAR_FN = extractFn(SHELL, 'function _mlsClearVisitTplPick(){');
const ROOM_BLOCK = between(LIVE,
  '/* ===== vntplpick-1.0.0 (owner 2026-09-11) - CHANGE THE TEMPLATE ON A NOTE',
  '  /* ---- doctor room (one clear action at a time)', 'the room template-pick block');

/* THE VNTPL BLOCK'S ASCII RULE APPLIES TO WHAT WAS ADDED TO IT: one smart
   quote is a control byte by the time the latin1 writer has been through. */
[GENRESOLVE_FN, CONSUME_FN, CLEAR_FN].forEach(function (fn, n) {
  for (let i = 0; i < fn.length; i += 1) {
    if (fn.charCodeAt(i) > 126) {
      assert.fail('template function ' + n + ' carries a non-ASCII byte at ' + i + ': ' +
        JSON.stringify(fn.slice(i - 20, i + 20)));
    }
  }
  checks += 1;
});

/* ==========================================================================
 * SYNTHETIC LIBRARY -- invented for this file
 * ======================================================================== */
const VISIT_TPL = { id: 'tpl_visit_office', name: 'Office visit letter', kind: 'soap', keywords: [],
  text: 'HPI:\nROS:\nEXAM:\nASSESSMENT:\nPLAN:\n' };
const VISIT_TPL_2 = { id: 'tpl_visit_followup', name: 'Follow up visit', kind: '', keywords: [],
  text: 'Subjective:\nObjective:\nAssessment:\nPlan:\n' };
const OP_TPL = { id: 'tpl_op_synthetic', name: 'Synthetic joint injection', kind: 'op', keywords: [],
  text: 'PREOPERATIVE DIAGNOSIS:\nPROCEDURE PERFORMED:\nANESTHESIA:\nINDICATIONS:\n' };
const EMPTY_TPL = { id: 'tpl_empty', name: 'Empty template', kind: '', keywords: [], text: '   ' };
const LIBRARY = [VISIT_TPL, OP_TPL, VISIT_TPL_2, EMPTY_TPL];

/* ==========================================================================
 * PART A -- THE ONE SEAM THAT RUNS HONOURS THE PICK
 * ======================================================================== */
function bootResolver(opts) {
  opts = opts || {};
  const painted = [];
  const sandbox = { String, Number, Object, Array, RegExp, Date, JSON, Math, __painted: painted,
    __library: JSON.parse(JSON.stringify(LIBRARY)), __autoPick: opts.autoPick === undefined ? null : opts.autoPick };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  sandbox.__activePt = opts.activePt === undefined ? '' : opts.activePt;
  vm.runInContext(
    KINDOF_FN + '\n' + CLASSIFIER + '\n' + CONSUME_FN + '\n' + CLEAR_FN + '\n' + GENRESOLVE_FN + '\n' +
    'function useTemplatesOn(){ return ' + (opts.on === false ? 'false' : 'true') + '; }\n' +
    'function resolveActiveTemplate(){ return __autoPick ? JSON.parse(JSON.stringify(__autoPick)) : null; }\n' +
    'function _mlsRenderTplPickReceipt(fb){ __painted.push(fb === undefined ? "none" : fb); return ""; }\n' +
    (opts.noPtId ? '' : 'function getActivePtId(){ return __activePt; }\n') +
    (opts.noLookup ? '' :
      'function getTemplateById(id){ for (var i = 0; i < __library.length; i++) { if (__library[i].id === id) ' +
      'return JSON.parse(JSON.stringify(__library[i])); } return null; }\n'),
    sandbox, { filename: 'vntplpick-1.0.0-resolver.js' });
  return {
    sandbox,
    arm: (pick) => { sandbox.__mlsVisitTplPick = pick; },
    resolve: () => vm.runInContext('_mlsResolveGenerationTemplate("synthetic visit text about a sore elbow")', sandbox),
    /* vntplpick-1.0.1: exactly what generateNote does - take the choice ONCE at
       the point the run is committed, then hand that same copy to every
       attempt the run makes. */
    consume: () => vm.runInContext('_mlsConsumeVisitTplPick()', sandbox),
    clear: () => vm.runInContext('_mlsClearVisitTplPick()', sandbox),
    resolveWith: (runPick) => { sandbox.__runPick = runPick; return vm.runInContext(
      '_mlsResolveGenerationTemplate("synthetic visit text about a sore elbow", __runPick || null)', sandbox); },
    used: () => vm.runInContext('window.__mlsVisitTplPickUsed || null', sandbox),
    pending: () => vm.runInContext('window.__mlsVisitTplPick || null', sandbox),
    skip: () => vm.runInContext('window.__mlsLastGenTemplateSkip || null', sandbox)
  };
}

(function A1_noPickIsTodaysBytes() {
  const g = bootResolver({ autoPick: VISIT_TPL });
  eq(JSON.stringify(g.resolve()), JSON.stringify(VISIT_TPL),
    'with no choice made, the automatic template no longer comes back unchanged');
  eq(g.used(), null, 'a run with no choice recorded one anyway');
  const off = bootResolver({ autoPick: VISIT_TPL, on: false });
  eq(off.resolve(), null, 'with templates off and no choice, a template shaped the note anyway');
})();

(function A2_pickedTemplateWins() {
  const g = bootResolver({ autoPick: VISIT_TPL });
  g.arm({ id: VISIT_TPL_2.id, plain: false, at: Date.now() });
  const out = g.resolve();
  ok(out, 'the template the doctor picked was refused');
  eq(out.id, VISIT_TPL_2.id, 'the note was written with a template the doctor did not pick');
  eq(g.pending(), null, 'the choice was not consumed - it would silently shape the next note too');
  eq(g.used().id, VISIT_TPL_2.id, 'the choice left no record of which template was used');
  /* AND IT WORKS WITH THE TEMPLATES TOGGLE OFF: the doctor asking for this
     template on this note is the decision, not a settings flag. */
  const off = bootResolver({ autoPick: null, on: false });
  off.arm({ id: VISIT_TPL.id, plain: false, at: Date.now() });
  eq((off.resolve() || {}).id, VISIT_TPL.id, 'a picked template was ignored because the templates toggle is off');
})();

(function A3_plainMeansPlain() {
  const g = bootResolver({ autoPick: VISIT_TPL });
  g.arm({ id: '', plain: true, at: Date.now() });
  eq(g.resolve(), null, 'asking for a plain note still handed a template to the prompt');
  eq(g.used().plain, true, 'the plain-note choice left no record');
})();

(function A4_opNoteCannotComeThroughTheNewDoor() {
  const g = bootResolver({ autoPick: null });
  g.arm({ id: OP_TPL.id, plain: false, at: Date.now() });
  eq(g.resolve(), null, 'an operative-report template reached a standard visit note through the new door');
  eq((g.skip() || {}).why, 'operative-report', 'the refusal left no plain-words receipt');
})();

(function A5_staleAndRubbish() {
  const stale = bootResolver({ autoPick: VISIT_TPL });
  stale.arm({ id: VISIT_TPL_2.id, plain: false, at: Date.now() - 600000 });
  eq((stale.resolve() || {}).id, VISIT_TPL.id, 'a choice from ten minutes ago still steered this note');
  eq(stale.used(), null, 'a stale choice was recorded as used');

  const gone = bootResolver({ autoPick: VISIT_TPL });
  gone.arm({ id: 'tpl_that_was_deleted', plain: false, at: Date.now() });
  eq(gone.resolve(), null, 'a choice naming a template that no longer exists fell back to a different one');

  const noLookup = bootResolver({ autoPick: VISIT_TPL, noLookup: true });
  noLookup.arm({ id: VISIT_TPL_2.id, plain: false, at: Date.now() });
  eq(noLookup.resolve(), null, 'the resolver threw instead of answering when the library reader is absent');

  const junk = bootResolver({ autoPick: VISIT_TPL });
  junk.arm('not an object');
  eq((junk.resolve() || {}).id, VISIT_TPL.id, 'a rubbish choice value changed the answer');
})();

/* ==========================================================================
 * PART A2 (vntplpick-1.0.1) -- THE CHOICE HOLDS FOR THE WHOLE GENERATION
 *
 * A visit note that lands under the quality floor is written a SECOND time,
 * and the resolver runs once per attempt. The choice used to be consumed by
 * the first attempt, so the second silently fell back to the doctor's usual
 * template: the note he read could be labelled with a template it was never
 * written with, and a deliberate "Plain note" was re-formatted straight back
 * onto the template he had just stepped away from.
 * ======================================================================== */
(function A6_bothAttemptsResolveTheSameChoice() {
  const g = bootResolver({ autoPick: VISIT_TPL });
  g.arm({ id: VISIT_TPL_2.id, plain: false, at: Date.now() });
  const runPick = g.consume();
  ok(runPick, 'the run could not take the choice at the point it was committed');
  eq(g.pending(), null, 'taking the choice for the run left it armed for the next note as well');
  eq((g.resolveWith(runPick) || {}).id, VISIT_TPL_2.id, 'the first attempt ignored the choice');
  eq((g.resolveWith(runPick) || {}).id, VISIT_TPL_2.id,
    'the repair attempt fell back to the usual template, so the note is labelled with one it was not written with');
  eq(g.used().id, VISIT_TPL_2.id, 'the record of which template was used was lost on the second attempt');

  /* AND PLAIN STAYS PLAIN ON BOTH ATTEMPTS - this is the case that put the
     abandoned template straight back onto the note. */
  const p = bootResolver({ autoPick: VISIT_TPL });
  p.arm({ id: '', plain: true, at: Date.now() });
  const plainRun = p.consume();
  eq(plainRun.plain, true, 'the plain-note choice did not survive being taken for the run');
  eq(p.resolveWith(plainRun), null, 'the first attempt handed a template to a plain note');
  eq(p.resolveWith(plainRun), null,
    'the repair attempt put the doctor\'s usual template back onto the note he asked to keep plain');
  eq(p.used().plain, true, 'the plain-note choice left no record after the second attempt');
})();

(function A7_theChoiceBelongsToOnePressAndOneChart() {
  /* A refused press never starts a run, and its choice is dropped there. */
  const refused = bootResolver({ autoPick: VISIT_TPL });
  refused.arm({ id: VISIT_TPL_2.id, plain: false, at: Date.now() });
  refused.clear();
  eq(refused.pending(), null, 'a refused press left the choice armed for the next note');
  eq(refused.consume(), null, 'a cleared choice came back anyway');
  eq((refused.resolve() || {}).id, VISIT_TPL.id, 'a cleared choice still steered the next note');

  /* And a choice made on one chart may never shape another chart's note. */
  const moved = bootResolver({ autoPick: VISIT_TPL, activePt: 'pt_synthetic_b' });
  moved.arm({ id: VISIT_TPL_2.id, plain: false, at: Date.now(), pt: 'pt_synthetic_a' });
  eq(moved.consume(), null, 'a template choice made on one chart was carried into another chart\'s note');
  const same = bootResolver({ autoPick: VISIT_TPL, activePt: 'pt_synthetic_a' });
  same.arm({ id: VISIT_TPL_2.id, plain: false, at: Date.now(), pt: 'pt_synthetic_a' });
  eq((same.consume() || {}).id, VISIT_TPL_2.id, 'the doctor\'s own choice was dropped on his own chart');

  /* Stale and rubbish never reach a run. */
  const stale = bootResolver({ autoPick: VISIT_TPL });
  stale.arm({ id: VISIT_TPL_2.id, plain: false, at: Date.now() - 600000 });
  eq(stale.consume(), null, 'a choice from ten minutes ago was taken for this run');
  const junk = bootResolver({ autoPick: VISIT_TPL });
  junk.arm('not an object');
  eq(junk.consume(), null, 'a rubbish choice value was taken for this run');
})();

/* The run really does hand its copy to both calls, and drops it on a refusal. */
ok(SHELL.indexOf('var generationTplPick=null;') > 0,
  'generateNote no longer takes the template choice once for the whole run');
ok(SHELL.indexOf('resolvedDraftTuning:generationDraftTuning,visitTplPick:generationTplPick}') > 0,
  'the first attempt is no longer given the run\'s template choice');
ok(SHELL.indexOf('resolvedDraftTuning:generationDraftTuning,visitTplPick:visitTplPick||null}') > 0,
  'the repair attempt is no longer given the run\'s template choice');
ok(SHELL.indexOf('_mlsResolveGenerationTemplate(transcript,options.visitTplPick||null)') > 0,
  'the one template seam that runs no longer reads the run\'s own choice');
ok(extractFn(SHELL, 'function _mlsRefuseGeneration(code,message,showToast){').indexOf('_mlsClearVisitTplPick()') > 0,
  'a refused Generate press leaves the template choice armed for the next note, on any patient');
ok(extractFn(SHELL, 'function newVisit(opts){').indexOf('_mlsForgetVisitNoteAdvisory()') > 0,
  'a new visit leaves the last note\'s template choice and receipt standing');

/* ==========================================================================
 * PART B -- THE CONTROL ON THE DRAFTED NOTE
 * ======================================================================== */
function bootRoom(opts) {
  opts = opts || {};
  const S = { phase: opts.phase || 'note', autoPull: opts.autoPull || 'idle', tplPickOpen: opts.open === true, appt: { id: 'a1' } };
  const transcript = { value: opts.transcript === undefined ? 'synthetic visit text about a sore elbow' : opts.transcript };
  const genBtn = { id: 'genBtn', disabled: false, clicks: 0, click() { this.clicks += 1; } };
  const calls = { toasts: [], renders: 0, stamps: 0, bindingAsked: [] };
  const sandbox = {
    String, Number, Object, Array, RegExp, JSON, Date, Math, S, calls, genBtn,
    document: { getElementById(id) { return id === 'transcript' ? transcript : (id === 'genBtn' ? genBtn : null); } }
  };
  sandbox.window = sandbox;
  sandbox.getTemplates = function () { return JSON.parse(JSON.stringify(LIBRARY)); };
  vm.createContext(sandbox);
  vm.runInContext(
    'function $(id){ return document.getElementById(id); }\n' +
    'function safe(fn, d){ try { return fn(); } catch (e) { return d; } }\n' +
    "function isFn(f){ return typeof f === 'function'; }\n" +
    "function esc(s){ return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n" +
    '  return { \'&\': \'&amp;\', \'<\': \'&lt;\', \'>\': \'&gt;\', \'"\': \'&quot;\', "\'": \'&#39;\' }[c]; }); }\n' +
    'function toast(m){ calls.toasts.push(String(m)); }\n' +
    'function render(){ calls.renders += 1; }\n' +
    'function ez3StampGenClick(){ calls.stamps += 1; }\n' +
    'function genBtnResolve(){ var g = $("genBtn"); return (g && !g.disabled) ? g : null; }\n' +
    'function requireExactScheduledBinding(a, label){ calls.bindingAsked.push(String(label)); return ' +
      (opts.binding === false ? 'false' : 'true') + '; }\n' +
    'function captureBusy(){ return ' + (opts.recording === true ? 'true' : 'false') + '; }\n' +
    'function pullLease(){ return ' + (opts.lease === true ? '{ id: "l1", at: Date.now() }' : 'null') + '; }\n' +
    /* The room's own read-only question about a generation already in flight. */
    'function genRunOverlay(){ return ' + (opts.generating === true ? '{ active: true, hint: "MLS is writing this note." }' : 'null') + '; }\n' +
    (opts.noPtId ? '' : 'window.getActivePtId = function(){ return ' + JSON.stringify(opts.activePt || 'pt_synthetic_a') + '; };\n') +
    /* THE REAL SHIPPED SCOPE GATE, not a stand-in: the picker must ask the
       same question the automatic path asks, and a stub here would prove the
       picker filters, not that it filters by the shipped rule. */
    KINDOF_FN + '\n' + CLASSIFIER + '\n' +
    ROOM_BLOCK + '\n' +
    'this.api = { tplChangeAllowed: tplChangeAllowed, visitTemplateList: visitTemplateList,\n' +
    '  currentTplChoice: currentTplChoice, tplPickHtml: tplPickHtml, applyTplPick: applyTplPick,\n' +
    '  tplPickBusy: tplPickBusy, TPL_PICK_MAX: TPL_PICK_MAX };',
    sandbox, { filename: 'vntplpick-1.0.0-room.js' });
  return { sandbox, S, transcript, genBtn, calls, api: sandbox.api };
}

(function B1_listsOnlyVisitTemplates() {
  const r = bootRoom({});
  const list = r.api.visitTemplateList();
  eq(list.length, 2, 'the picker does not list exactly the two visit-note templates in the library');
  eq(list.map(function (t) { return t.id; }).join(','), VISIT_TPL.id + ',' + VISIT_TPL_2.id,
    'the picker lists something other than the visit-note templates');
  ok(list.every(function (t) { return t.id !== OP_TPL.id; }),
    'an operative-report template is offered for a visit note');
  ok(list.every(function (t) { return t.id !== EMPTY_TPL.id; }),
    'a template with no body is offered, and it could never shape anything');

  /* THE GATE IS THE SHELL'S OWN. With no scope gate available the picker
     offers nothing rather than guessing - it never re-implements the rule. */
  r.sandbox._mlsGenTemplateScopeSkip = null;
  eq(r.api.visitTemplateList().length, 0,
    'without the shipped scope gate the picker guessed instead of offering nothing');
})();

(function B2_theControlAndThePanel() {
  const r = bootRoom({});
  r.sandbox.__mlsLastGenTemplateContract = { id: VISIT_TPL.id, name: VISIT_TPL.name };
  const shut = r.api.tplPickHtml();
  ok(shut.indexOf('id="ez3TplChange"') > 0, 'there is no way to change the template on a drafted note');
  ok(shut.indexOf('Change template') > 0, 'the control does not say what it does');
  ok(shut.indexOf(VISIT_TPL.name) > 0, 'the doctor is not told which template wrote this note');
  ok(shut.indexOf('ez3TplOpt_') < 0, 'the template list is open before it was asked for');
  /* NOT in a .ez3-row2 and not in #ez3StyleChips - both are folded away
     behind "Visit shortcuts" by feat_mls_visit_focus.js. */
  ok(shut.indexOf('ez3-row2') < 0 && shut.indexOf('ez3StyleChips') < 0,
    'the control sits where the visit-focus fold hides it');

  const open = bootRoom({ open: true });
  open.sandbox.__mlsLastGenTemplateContract = { id: VISIT_TPL.id, name: VISIT_TPL.name };
  const html = open.api.tplPickHtml();
  ok(html.indexOf('id="ez3TplPlain"') > 0, 'the list does not offer a plain note');
  ok(html.indexOf('Plain note (no template)') > 0, 'the plain-note row does not say what it is');
  eq((html.match(/id="ez3TplOpt_/g) || []).length, 2, 'the list does not offer both visit-note templates');
  ok(html.indexOf(OP_TPL.name) < 0, 'the procedure template is offered in a visit-note list');
  ok(html.indexOf('Picking one writes this visit note again from the same recording.') > 0,
    'the list does not say what picking one does');
  ok(html.indexOf('id="ez3TplOpt_0" class') < 0, 'the option markup drifted');
  ok(/id="ez3TplOpt_0">Office visit letter/.test(html.replace(/ class="[^"]*"/g, '')),
    'the first option is not the first visit-note template');
})();

(function B3_hiddenWhenItMustBe() {
  eq(bootRoom({ transcript: '' }).api.tplPickHtml(), '',
    'the control is offered with no recording to write the note from again');
  eq(bootRoom({ transcript: '    ' }).api.tplPickHtml(), '',
    'a whitespace-only transcript still offered the control');
  eq(bootRoom({ recording: true }).api.tplPickHtml(), '',
    'the control is offered while the visit is being recorded');
  eq(bootRoom({ autoPull: 'running' }).api.tplPickHtml(), '',
    'the control is offered in the middle of a schedule pull');
  eq(bootRoom({ lease: true }).api.tplPickHtml(), '',
    'the control is offered while another pull holds the lease');
  ['idle', 'rec', 'gen', 'stopped'].forEach(function (p) {
    eq(bootRoom({ phase: p }).api.tplPickHtml(), '',
      'the control is offered on the ' + p + ' screen, where there is no drafted note');
  });
  const busy = bootRoom({});
  busy.sandbox.__mlsPullBusyAt = Date.now();
  eq(busy.api.tplPickHtml(), '', 'the control is offered while a pull is still marked busy');
  /* vntplpick-1.0.1: AND NOT DURING THE REGENERATION IT ITSELF STARTED. The
     previous note stays on screen while the new one is written, so without
     this the room went on saying "This note was written with: <the template
     the doctor just replaced>" over a note that was being thrown away. */
  const running = bootRoom({ generating: true });
  running.sandbox.__mlsLastGenTemplateContract = { id: VISIT_TPL.id, name: VISIT_TPL.name };
  eq(running.api.tplPickHtml(), '', 'the template control stayed up while MLS was writing the note');
  eq(running.api.tplChangeAllowed(), false, 'the template control answers a press while MLS is writing the note');
  const openRunning = bootRoom({ generating: true, open: true });
  eq(openRunning.api.tplPickHtml(), '', 'an open template list stayed up while MLS was writing the note');
  openRunning.api.applyTplPick({ id: VISIT_TPL_2.id });
  eq(openRunning.genBtn.clicks, 0, 'a second template was picked while MLS was already writing the note');
  eq(openRunning.sandbox.__mlsVisitTplPick, undefined,
    'a press during a generation armed a choice that would steer the note after it');
})();

(function B4_pickRegeneratesThroughTheSameDoor() {
  const r = bootRoom({ open: true });
  r.api.applyTplPick({ id: VISIT_TPL_2.id, name: VISIT_TPL_2.name });
  const armed = r.sandbox.__mlsVisitTplPick;
  ok(armed, 'picking a template armed nothing for the generation to read');
  eq(armed.id, VISIT_TPL_2.id, 'the wrong template was handed to the generation');
  eq(armed.plain, false, 'picking a real template asked for a plain note');
  ok(Number(armed.at) > 0, 'the choice carries no time, so it can never be judged stale');
  eq(armed.pt, 'pt_synthetic_a',
    'the choice does not say which chart it was made on, so it could shape another patient\'s note');
  eq(r.genBtn.clicks, 1, 'the note was not written again through the ordinary Generate path');
  eq(r.calls.stamps, 1, 'the generating state the doctor already knows was not shown');
  eq(r.calls.bindingAsked.join(','), 'note regeneration', 'the visit was not re-checked before writing again');
  eq(r.S.tplPickOpen, false, 'the list stayed open over the note that is being rewritten');
  ok(r.calls.renders >= 1, 'the screen was not repainted after the press');

  const plain = bootRoom({ open: true });
  plain.api.applyTplPick({ id: '' });
  eq(plain.sandbox.__mlsVisitTplPick.plain, true, 'asking for a plain note did not ask for a plain note');
  eq(plain.genBtn.clicks, 1, 'the plain-note choice did not write the note again');
})();

(function B5_refusalsAreLoud() {
  const noBind = bootRoom({ open: true, binding: false });
  noBind.api.applyTplPick({ id: VISIT_TPL.id });
  eq(noBind.genBtn.clicks, 0, 'the note was rewritten without a checked visit');
  eq(noBind.sandbox.__mlsVisitTplPick, undefined, 'a refused press still armed a template choice');

  const busyBtn = bootRoom({ open: true });
  busyBtn.genBtn.disabled = true;
  busyBtn.api.applyTplPick({ id: VISIT_TPL.id });
  eq(busyBtn.genBtn.clicks, 0, 'a press while MLS is still writing clicked anyway');
  ok(busyBtn.calls.toasts.length === 1, 'a refused press said nothing at all');
  ok(busyBtn.calls.toasts[0].indexOf('Wait for it to finish') > 0,
    'the refusal does not name the one step to take');

  const gone = bootRoom({ open: true, transcript: '' });
  gone.api.applyTplPick({ id: VISIT_TPL.id });
  eq(gone.genBtn.clicks, 0, 'a press with no recording behind it wrote the note again anyway');
  ok(gone.calls.toasts.length === 1, 'a press with no recording said nothing');
})();

(function B6_whichTemplateWroteThisNote() {
  const r = bootRoom({});
  eq(r.api.currentTplChoice().name, 'Plain note (no template)',
    'a note nothing shaped does not say so');
  r.sandbox.__mlsLastGenTemplateContract = { id: VISIT_TPL.id, name: VISIT_TPL.name };
  eq(r.api.currentTplChoice().id, VISIT_TPL.id, 'the template that shaped this note is not read from its own receipt');
  /* AFTER A RELOAD the contract receipt is gone and the visit's own saved
     record is what answers. */
  delete r.sandbox.__mlsLastGenTemplateContract;
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'ok', flagged: [], template: { id: VISIT_TPL_2.id, name: VISIT_TPL_2.name, chosen: true } };
  eq(r.api.currentTplChoice().id, VISIT_TPL_2.id, 'a reopened note forgot which template wrote it');
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'ok', flagged: [], template: { id: '', name: '', chosen: true } };
  eq(r.api.currentTplChoice().name, 'Plain note (no template)',
    'a note the doctor deliberately wrote plain does not say so after a reload');
})();

/* ==========================================================================
 * PART C -- WHERE IT IS PAINTED, AND WHERE IT IS NOT
 * ======================================================================== */
const NOTE_BRANCH = between(LIVE, "} else if (S.phase === 'note') {", '} else { /* idle / stopped */', 'note branch');
ok(NOTE_BRANCH.indexOf('tplPickHtml()') > 0, 'the template door is not inside the drafted-note branch');
eq((LIVE.match(/tplPickHtml\(\)/g) || []).length, 2,
  'the template door is painted from more than one place - two controls for one job is the defect it avoids');
ok(LIVE.indexOf("'<div class=\"ez3-chips\" id=\"ez3StyleChips\"></div>' +\n             tplPickHtml() +") > 0,
  'the template door is not in its own wrapper between the chips and the action row');
/* The op note room is a different view with its own module and no ez3 render,
   so the picker cannot appear there. Prove it never learned the name. */
['feat_mls_opnote_room.js', '1p-feat_mls_opnote_room.js'].forEach(function (name) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) return;
  const src = fs.readFileSync(p, 'utf8');
  ok(src.indexOf('ez3TplChange') < 0 && src.indexOf('tplPickHtml') < 0,
    name + ': the visit-note template door leaked onto the op note screen');
});
/* Nothing in this feature touches the doctor's saved default. */
ok(ROOM_BLOCK.indexOf('setActiveTemplateId') < 0,
  'picking a template for one note silently changed the saved default for every note');
ok(ROOM_BLOCK.indexOf('__mlsTemplateOverrideId') < 0,
  'the picker also writes the reformat override - the choice would be consumed twice');
ok(ROOM_BLOCK.indexOf('console.') < 0, 'the template-pick block reaches for console');

/* The plain-note choice also stops the optional re-format from putting the old
   template straight back onto the note. */
ok(SHELL.indexOf("reason:'plain-note-chosen'") > 0,
  'a deliberate plain note is still handed to the re-format, which resolves the old template by itself');
ok(SHELL.indexOf('_mlsStartOptionalTemplate(transcript,generationBinding,generationEpoch,transcriptEl)') > 0,
  'the ordinary run no longer launches the optional template owner');

/* ==========================================================================
 * PART D -- ALL FOUR SHELLS AND ALL THREE CONNECT LANES
 * ======================================================================== */
['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'].forEach(function (name) {
  const src = read(name);
  eq(extractFn(src, 'function _mlsResolveGenerationTemplate(visitText,runPick){'), GENRESOLVE_FN,
    name + ': the generation resolver is not byte-identical to 1pScribeFlow.html');
  eq(extractFn(src, 'function _mlsConsumeVisitTplPick(){'), CONSUME_FN,
    name + ': the run\'s copy of the choice is not byte-identical to 1pScribeFlow.html');
  eq(extractFn(src, 'function _mlsClearVisitTplPick(){'), CLEAR_FN,
    name + ': the refusal clear is not byte-identical to 1pScribeFlow.html');
  ok(src.indexOf('window.__mlsVisitTplPickUsed=') > 0, name + ': the choice leaves no record of being used');
});
['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'].forEach(function (name) {
  const src = read(name);
  const live = src.slice(0, src.indexOf('Retired historical Easy') > 0 ? src.indexOf('Retired historical Easy') : src.length);
  ['  function tplChangeAllowed() {', '  function visitTemplateList() {', '  function tplPickHtml() {',
    '  function applyTplPick(pick) {'].forEach(function (marker) {
    eq(extractFn(live, marker), extractFn(LIVE, marker),
      name + ': ' + marker.trim() + ' is not byte-identical to 1p-mls-connect.js');
  });
});
/* The scope gate is still exported for the overlay that actually runs. */
ok(SHELL.indexOf('window._mlsGenTemplateScopeSkip=_mlsGenTemplateScopeSkip;') > 0,
  'the scope decision is no longer exported, so the picker cannot ask it');

console.log('PASS visit-template-change-on-draft: ' + checks +
  ' checks - a drafted visit note can be written again with any visit-note template or with no template at all, ' +
  'through the one template seam that runs and the same Generate path; operative-report and bodiless templates are ' +
  'never offered and never accepted; the choice is taken once for the whole run so the repair attempt resolves the ' +
  'same template (and the same plain note); it is dropped by a refused press, by a new visit and on another chart; ' +
  'the control is absent without a recording, during a pull, while recording, while MLS is writing the note and on ' +
  'every screen but the drafted note; and the saved default is never touched');

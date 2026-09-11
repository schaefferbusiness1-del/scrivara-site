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
const GENRESOLVE_FN = extractFn(SHELL, 'function _mlsResolveGenerationTemplate(visitText){');
const ROOM_BLOCK = between(LIVE,
  '/* ===== vntplpick-1.0.0 (owner 2026-09-11) - CHANGE THE TEMPLATE ON A NOTE',
  '  /* ---- doctor room (one clear action at a time)', 'the room template-pick block');

/* THE VNTPL BLOCK'S ASCII RULE APPLIES TO WHAT WAS ADDED TO IT: one smart
   quote is a control byte by the time the latin1 writer has been through. */
for (let i = 0; i < GENRESOLVE_FN.length; i += 1) {
  if (GENRESOLVE_FN.charCodeAt(i) > 126) {
    assert.fail('the generation resolver carries a non-ASCII byte at ' + i + ': ' +
      JSON.stringify(GENRESOLVE_FN.slice(i - 20, i + 20)));
  }
}
checks += 1;

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
  vm.runInContext(
    KINDOF_FN + '\n' + CLASSIFIER + '\n' + GENRESOLVE_FN + '\n' +
    'function useTemplatesOn(){ return ' + (opts.on === false ? 'false' : 'true') + '; }\n' +
    'function resolveActiveTemplate(){ return __autoPick ? JSON.parse(JSON.stringify(__autoPick)) : null; }\n' +
    'function _mlsRenderTplPickReceipt(fb){ __painted.push(fb === undefined ? "none" : fb); return ""; }\n' +
    (opts.noLookup ? '' :
      'function getTemplateById(id){ for (var i = 0; i < __library.length; i++) { if (__library[i].id === id) ' +
      'return JSON.parse(JSON.stringify(__library[i])); } return null; }\n'),
    sandbox, { filename: 'vntplpick-1.0.0-resolver.js' });
  return {
    sandbox,
    arm: (pick) => { sandbox.__mlsVisitTplPick = pick; },
    resolve: () => vm.runInContext('_mlsResolveGenerationTemplate("synthetic visit text about a sore elbow")', sandbox),
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
})();

(function B4_pickRegeneratesThroughTheSameDoor() {
  const r = bootRoom({ open: true });
  r.api.applyTplPick({ id: VISIT_TPL_2.id, name: VISIT_TPL_2.name });
  const armed = r.sandbox.__mlsVisitTplPick;
  ok(armed, 'picking a template armed nothing for the generation to read');
  eq(armed.id, VISIT_TPL_2.id, 'the wrong template was handed to the generation');
  eq(armed.plain, false, 'picking a real template asked for a plain note');
  ok(Number(armed.at) > 0, 'the choice carries no time, so it can never be judged stale');
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
  eq(extractFn(src, 'function _mlsResolveGenerationTemplate(visitText){'), GENRESOLVE_FN,
    name + ': the generation resolver is not byte-identical to 1pScribeFlow.html');
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
  'never offered and never accepted; the control is absent without a recording, during a pull, while recording and ' +
  'on every screen but the drafted note; and the saved default is never touched');

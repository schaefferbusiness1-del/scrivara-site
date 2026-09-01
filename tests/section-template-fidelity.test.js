'use strict';
/* vntpl-1.0.0 (owner 2026-08-31: "the other sections need to follow the
 * templates there given to like the hip and assent and plan so fix that to").
 *
 * b1144 hardened the POST-HOC reformat: applyTemplateToNote got a
 * reproduce-then-fill contract, a deterministic conformance measure and an
 * amber strip. What it did not touch is the PRIMARY generation, and that is
 * where the owner's complaint actually lives: resolveActiveTemplate is called
 * from maybeApplyTemplate, which _mlsStartOptionalTemplate launches AFTER the
 * main draft has been validated, rendered and toasted. The doctor's FIRST
 * draft was therefore always written to the generic NOTE STYLE, and whether
 * his template shaped HPI / assessment / plan depended on a SECOND AI call on
 * a 12-second deadline that is deliberately allowed to fail in silence.
 *
 * This suite EXECUTES the shipped functions - lifted out of the shipped shell,
 * never transcribed - and pins:
 *   1. with a template ACTIVE, the PRIMARY prompt carries the per-section
 *      reproduce-then-fill contract, the template's own heading lines, AND the
 *      athena_note five-section requirement, with no sentence that tells
 *      athena_note to follow the template;
 *   2. with NO template the prompt is BYTE-IDENTICAL to pristine HEAD - both
 *      strings, both transports - so the no-template path is provably
 *      untouched rather than believed untouched;
 *   3. the shipped conformance measure runs on the PRIMARY draft, stamps a
 *      receipt, and surfaces the same amber notice with the same one-click
 *      re-run when it falls short - and never refuses the draft;
 *   4. a reformat that does NOT land restores that first-draft notice instead
 *      of leaving the doctor with silence;
 *   5. the template is resolved ONCE per generation and handed to the
 *      reformat, and a transcript that does not match falls through to the
 *      fresh resolve that shipped before;
 *   6. the prompt never carries raw canned clinical assertions: it asks the
 *      connect bundle's own sanitiser, and the local port agrees with it;
 *   7. _mlsValidateAthenaNote and the athena sidecar contract are
 *      BYTE-IDENTICAL to HEAD in all four shells;
 *   8. the two 1p twins and the two derived shells carry byte-identical text
 *      in every edited region, and the connect twins carry the export.
 *
 * NOT registered in run-all.js: this is a stage-lane probe. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const SHELL_FILE = '1pScribeFlow.html';
const shell = fs.readFileSync(path.join(root, SHELL_FILE), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks++; }

function sliceBetween(text, from, to, label) {
  const a = text.indexOf(from);
  assert.ok(a > 0, label + ': the opening anchor moved - ' + from.slice(0, 60));
  const b = text.indexOf(to, a);
  assert.ok(b > a, label + ': the closing anchor moved - ' + to.slice(0, 60));
  return text.slice(a, b);
}

/* ===================================================================== */
/* THE SHIPPED SOURCE, SLICED                                             */
/* ===================================================================== */
const A_TPL_REGION = 'async function applyTemplateToNote(template,visitText,expectedBinding,expectedEpoch)';
const B_TPL_REGION = '\nfunction openDoc';
const A_VNTPL = '/* ===== vntpl-1.0.0 - THE FIRST DRAFT FOLLOWS THE TEMPLATE';
const B_VNTPL = '/* ===== end vntpl-1.0.0 ===== */';
const A_STYLE = 'var GEN_STYLE_LINE={';
const B_STYLE = '/* Deterministic APSO reorder';
const A_CALL = 'async function callOpenAI(transcript,key,options){';
const B_CALL = '\n/* ---------------------------------------------------------\n   CORE AI TRANSPORT';

const TPL_REGION = sliceBetween(shell, A_TPL_REGION, B_TPL_REGION, 'template block');
const VNTPL = sliceBetween(shell, A_VNTPL, B_VNTPL, 'vntpl block') + B_VNTPL;
const STYLE = sliceBetween(shell, A_STYLE, B_STYLE, 'GEN_STYLE_LINE');
const CALL = sliceBetween(shell, A_CALL, B_CALL, 'callOpenAI');

/* ===================================================================== */
/* A MINIMAL DOM. Every element refuses innerHTML - the fidelity strip is  */
/* a text sink and a template name is untrusted data.                     */
/* ===================================================================== */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    childNodes: [], style: {}, className: '', title: '', type: '',
    onclick: null, _text: '', value: '',
    appendChild(c) { this.childNodes.push(c); return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); return c; },
    get firstChild() { return this.childNodes.length ? this.childNodes[0] : null; },
    get textContent() {
      if (this.childNodes.length) return this.childNodes.map(c => c.textContent).join('');
      return this._text;
    },
    set textContent(v) { this._text = String(v); this.childNodes = []; }
  };
  Object.defineProperty(el, 'innerHTML', {
    set() { throw new Error('a fidelity surface wrote innerHTML'); },
    get() { return undefined; }
  });
  return el;
}
function makeText(v) { return { textContent: String(v), childNodes: [] }; }
function makeDoc(ids) {
  return {
    getElementById(id) { return Object.prototype.hasOwnProperty.call(ids, id) ? ids[id] : null; },
    createElement(t) { return makeEl(t); },
    createTextNode(v) { return makeText(v); }
  };
}
function buttonsOf(el) {
  return el.childNodes.filter(c => c.tagName === 'BUTTON')
    .concat(el.childNodes.filter(c => c.tagName === 'DIV')
      .reduce((acc, d) => acc.concat(d.childNodes.filter(c => c.tagName === 'BUTTON')), []));
}

/* ===================================================================== */
/* FIXTURES                                                               */
/* ===================================================================== */
/* A template that names its OWN sections - including the three the owner
   named - plus one canned procedure assertion the sanitiser must reduce. */
const TEMPLATE_TEXT = [
  'SPINE CLINIC OFFICE VISIT',
  'PATIENT: [[patient_name]]',
  'DATE OF SERVICE: [[date_of_service]]',
  'CHIEF COMPLAINT: [[chief_complaint]]',
  'HISTORY OF PRESENT ILLNESS:',
  'The patient returns today for interval evaluation of the complaint recorded above.',
  'REVIEW OF SYSTEMS:',
  'A focused review of systems was performed and is documented below.',
  'PHYSICAL EXAMINATION:',
  'The patient is alert, oriented and in no acute distress on examination today.',
  'PROCEDURE NOTE: The patient tolerated the procedure well with no complications.',
  'ASSESSMENT:',
  'Each active problem is listed with its supporting findings.',
  'PLAN:',
  'The plan of care was discussed with the patient and all questions were answered.',
  'FOLLOW-UP: [[follow_up]]'
].join('\n');

const TRANSCRIPT = 'the doctor and the patient talked about right knee pain for three weeks';

const TEMPLATE = { id: 'tpl-spine', name: 'Spine clinic office visit', text: TEMPLATE_TEXT };

/* A draft that reproduced the template, and one that summarised it away. */
const FAITHFUL_NOTE = [
  'SPINE CLINIC OFFICE VISIT',
  'PATIENT: not documented',
  'DATE OF SERVICE: not documented',
  'CHIEF COMPLAINT: Right knee pain',
  'HISTORY OF PRESENT ILLNESS:',
  'The patient returns today for interval evaluation of the complaint recorded above.',
  'Right knee pain for three weeks after increasing his running.',
  'REVIEW OF SYSTEMS:',
  'A focused review of systems was performed and is documented below.',
  'PHYSICAL EXAMINATION:',
  'The patient is alert, oriented and in no acute distress on examination today.',
  'No effusion, full range of motion, patellar tendon tenderness.',
  'PROCEDURE NOTE:',
  'ASSESSMENT:',
  'Each active problem is listed with its supporting findings.',
  'Patellofemoral pain syndrome of the right knee.',
  'PLAN:',
  'The plan of care was discussed with the patient and all questions were answered.',
  'Relative rest, ice and physical therapy.',
  'FOLLOW-UP: six weeks'
].join('\n');

const SUMMARY_NOTE = [
  'HPI: Three weeks of right knee pain after more running.',
  'ROS: Negative except as above.',
  'EXAM: No effusion, full motion, patellar tendon tenderness.',
  'ASSESSMENT: Patellofemoral pain syndrome of the right knee.',
  'PLAN: Rest, ice, physical therapy.'
].join('\n');

/* ===================================================================== */
/* THE HARNESS - the shipped prompt builder, executed                     */
/* ===================================================================== */
const STUB_STANDARDS = 'STANDARDS-BLOCK';
const STUB_DOCPREFS = '\n\nDOCPREFS-BLOCK';

function harness(opts) {
  opts = opts || {};
  const notice = makeEl('div');
  const noteBox = makeEl('textarea');
  noteBox.value = SUMMARY_NOTE;
  noteBox.style.display = 'block';
  const transcriptEl = makeEl('textarea');
  transcriptEl.value = TRANSCRIPT;
  const ids = { tplFidelityNotice: notice, noteBox: noteBox, transcript: transcriptEl };
  const captured = {};
  const counters = { resolve: 0, aiCalls: 0 };
  const context = {
    window: {
      __mlsCodeTable: null,
      __mlsTurns: null,
      __mlsNoteGroundV1: opts.ngv1 || null,
      __mlsOpNoteIntegrity: opts.integrity || null
    },
    document: makeDoc(ids),
    Promise, String, Number, Object, Array, RegExp, JSON, Math, Date, console, AbortController,
    setTimeout, clearTimeout,
    captured, counters,
    cfg: {
      templatesOn: opts.templatesOn !== false,
      resolved: Object.prototype.hasOwnProperty.call(opts, 'resolved') ? opts.resolved : TEMPLATE,
      modelOut: opts.modelOut == null ? FAITHFUL_NOTE : opts.modelOut
    },
    startedTemplate: [],
    toasts: []
  };
  const prologue = `
    const STANDARDS = ${JSON.stringify(STUB_STANDARDS)};
    function docPrefsBlock(){ return ${JSON.stringify(STUB_DOCPREFS)}; }
    function getPreset(){ return ''; }
    function getSpec(){ return ''; }
    function buildPatientContext(){ return ''; }
    function getGenStyle(){ return 'soap'; }
    function getGenLength(){ return 'standard'; }
    function getGenInstr(){ return ''; }
    function getGenPatientSummary(){ return false; }
    function _mlsGenerationDraftTuning(){ return null; }
    function _mlsAutoDraftPriorSeed(){ return null; }
    async function postChat(sys,user,key,extra){ captured.sys=sys; captured.user=user; captured.key=key; captured.extra=extra; return '{}'; }
    let currentFormat = 'soap';
    let currentSoap = ${JSON.stringify(SUMMARY_NOTE)};
    let currentInsurance = '';
    let currentVisitAthenaBinding = { id: 'visit-1' };
    let currentVisitAthenaEpoch = 7;
    function hasAI(){ return true; }
    function getKey(){ return 'k'; }
    function _tplTextForDraft(t){ return String(t||''); }
    function _athenaAsyncBindingStillSafe(){ return true; }
    function _athenaEditorFingerprint(){ return 'fp'; }
    function _mlsSyncAthenaAfterStandardNoteMutation(){}
    function _markVisitDirty(){}
    function toast(m,k){ toasts.push(String(m)+'|'+String(k||'')); }
    function useTemplatesOn(){ return cfg.templatesOn === true; }
    function templateAutoOn(){ return false; }
    function getActiveTemplateId(){ return ''; }
    function getTemplateById(id){ return id==='tpl-spine' ? JSON.parse(JSON.stringify(${JSON.stringify(TEMPLATE)})) : null; }
    function _mlsTplKindOf(){ return 'soap'; }
    function resolveActiveTemplate(){ counters.resolve++; return cfg.resolved ? JSON.parse(JSON.stringify(cfg.resolved)) : null; }
    function _mlsStartOptionalTemplate(text,binding,epoch,el){ startedTemplate.push({text:text,binding:binding,epoch:epoch,el:!!el}); return 'started'; }
    async function aiCallRaw(sys,user,key,o){ counters.aiCalls++; captured.applySys=sys; captured.applyUser=user; return cfg.modelOut; }
  `;
  const script = prologue + '\n' + TPL_REGION + '\n' + VNTPL + '\n' + STYLE + '\n' + CALL + `
    this.api = { callOpenAI, maybeApplyTemplate, applyTemplateToNote,
                 _mlsGenTemplateContract, _mlsTplPromptSanitize, _mlsTplPromptSanitizeLocal,
                 _mlsTplSectionLines, _mlsMeasurePrimaryTemplateFidelity,
                 _mlsRestorePrimaryTplNotice, _mlsRenderTplFidelityNotice,
                 _mlsConsumeGenTemplateHandoff, _mlsResolveGenerationTemplate,
                 _mlsTplConformance, GEN_STYLE_LINE };
  `;
  vm.runInNewContext(script, context, { filename: 'vntpl-harness.js' });
  return { api: context.api, ctx: context, notice, noteBox, transcriptEl, captured, counters };
}

/* The pristine HEAD prompt builder, with the SAME stubs. */
function headHarness() {
  const headShell = execSync('git show HEAD:' + SHELL_FILE, { cwd: root, maxBuffer: 1024 * 1024 * 64 }).toString('utf8');
  /* Two lifetimes for this harness (landed as b1145): BEFORE landing, HEAD is
     pristine and this proves the exact delta the change introduces. AFTER
     landing, HEAD itself carries vntpl and becomes the regression baseline -
     the same assertions then pin that no LATER change drifts the no-template
     bytes or the contract shape. Both are the property this suite exists for. */
  ok(true, headShell.indexOf(A_VNTPL) === -1
    ? 'baseline mode: HEAD is pristine (pre-land delta proof)'
    : 'baseline mode: HEAD carries vntpl (post-land regression pin)');
  const headStyle = sliceBetween(headShell, A_STYLE, B_STYLE, 'HEAD GEN_STYLE_LINE');
  const headCall = sliceBetween(headShell, A_CALL, B_CALL, 'HEAD callOpenAI');
  const captured = {};
  const context = {
    window: { __mlsCodeTable: null, __mlsTurns: null },
    Promise, String, Number, Object, Array, RegExp, JSON, Math, Date, console,
    captured
  };
  const prologue = `
    const STANDARDS = ${JSON.stringify(STUB_STANDARDS)};
    function docPrefsBlock(){ return ${JSON.stringify(STUB_DOCPREFS)}; }
    function getPreset(){ return ''; }
    function getSpec(){ return ''; }
    function buildPatientContext(){ return ''; }
    function getGenStyle(){ return 'soap'; }
    function getGenLength(){ return 'standard'; }
    function getGenInstr(){ return ''; }
    function getGenPatientSummary(){ return false; }
    function _mlsGenerationDraftTuning(){ return null; }
    function _mlsAutoDraftPriorSeed(){ return null; }
    async function postChat(sys,user,key,extra){ captured.sys=sys; captured.user=user; return '{}'; }
  `;
  vm.runInNewContext(prologue + '\n' + headStyle + '\n' + headCall + '\n this.api = { callOpenAI };',
    context, { filename: 'vntpl-head-harness.js' });
  return { api: context.api, captured };
}

/* ===================================================================== */
(async function run() {

  /* ------------------------------------------------------------------ */
  /* 1. TEMPLATE ACTIVE - the per-section contract reaches the model      */
  /* ------------------------------------------------------------------ */
  let h = harness({});
  await h.api.callOpenAI(TRANSCRIPT, 'k', {});
  const USER = String(h.captured.user || '');
  const SYS = String(h.captured.sys || '');

  ok(USER.indexOf('TEMPLATE_CONTRACT_BEGIN') !== -1 && USER.indexOf('TEMPLATE_CONTRACT_END') !== -1,
    'the PRIMARY user payload carries no template contract at all');
  ok(USER.indexOf('TODAY_TRANSCRIPT_BEGIN') < USER.indexOf('TEMPLATE_CONTRACT_BEGIN'),
    'the template contract was placed before the transcript it is meant to be filled from');
  ok(USER.indexOf('REPRODUCE, THEN FILL') !== -1,
    'the primary prompt states a property, not the reproduce-then-fill OPERATION');
  ok(USER.indexOf('reproduced VERBATIM') !== -1,
    'the primary prompt does not order the non-fill text reproduced verbatim');
  ok(/Do NOT summarize, condense, paraphrase, modernise, merge, re-order or omit any template line/.test(USER),
    'the primary prompt does not forbid summarising the template away');
  ok(USER.indexOf('THEN FILL - EVERY SECTION, NOT ONLY THE FIRST') !== -1,
    'the primary prompt does not state the per-section obligation the owner asked for');
  ok(/history of present illness, the review of systems, the examination, the assessment and the plan/.test(USER),
    'the primary prompt does not name the sections the owner named (hpi, assessment, plan)');
  ok(/KEEPS ITS LINE and gets the explicit placeholder "not documented"/.test(USER),
    'the primary prompt does not require an explicit placeholder instead of a deleted line');
  ok(USER.indexOf('never an invented finding, history, value or date') !== -1,
    'the primary prompt does not forbid invention inside a template field');

  /* the template's OWN heading lines are enumerated, in order */
  const secIdx = USER.indexOf('SECTIONS - the "note" field must carry these headings');
  ok(secIdx > 0, 'the primary prompt lists no section skeleton');
  const secBlock = USER.slice(secIdx, USER.indexOf('TEMPLATE TO REPRODUCE', secIdx));
  ['HISTORY OF PRESENT ILLNESS:', 'REVIEW OF SYSTEMS:', 'PHYSICAL EXAMINATION:', 'ASSESSMENT:', 'PLAN:'].forEach(function (head) {
    ok(secBlock.indexOf(head) !== -1, 'the section list is missing the template heading ' + head);
  });
  ok(secBlock.indexOf('HISTORY OF PRESENT ILLNESS:') < secBlock.indexOf('ASSESSMENT:')
    && secBlock.indexOf('ASSESSMENT:') < secBlock.indexOf('PLAN:'),
    'the section list does not preserve the template order');

  /* the template body itself is quoted */
  ok(USER.indexOf('TEMPLATE TO REPRODUCE - every line of it, in this order:') !== -1,
    'the template body is not handed to the primary prompt');
  ok(USER.indexOf('The plan of care was discussed with the patient and all questions were answered.') !== -1,
    'the template body reached the prompt without its standard plan language');

  /* ------------------------------------------------------------------ */
  /* 2. athena_note IS STATED, AND NOT CONTRADICTED                      */
  /* ------------------------------------------------------------------ */
  const CONTRACT = USER.slice(USER.indexOf('TEMPLATE_CONTRACT_BEGIN'),
    USER.indexOf('TEMPLATE_CONTRACT_END') + 'TEMPLATE_CONTRACT_END'.length);
  ok(CONTRACT.indexOf('ATHENA EXCEPTION') !== -1,
    'the contract never mentions the athena sidecar - a model must resolve that conflict itself');
  ok(/EXACTLY five flat top-level sections, in this exact order - HPI, ROS, EXAM, ASSESSMENT, PLAN/.test(CONTRACT),
    'the contract does not restate the five-section athena requirement');
  ok(CONTRACT.indexOf('applies to the "note" field ONLY') !== -1,
    'the contract does not scope itself to the display note');
  ok(/no template heading, template boilerplate, extra section, wrapper or preamble anywhere in it/.test(CONTRACT),
    'the contract does not forbid template structure inside athena_note');
  /* THE NO-CONTRADICTION TEST, mechanically: every sentence that names
     athena_note must also carry its five-section rule, so no sentence can be
     read as "make athena_note follow the template". */
  const sentences = CONTRACT.split(/(?<=\.)\s+/);
  const athenaSentences = sentences.filter(s => s.indexOf('athena_note') !== -1);
  ok(athenaSentences.length >= 2, 'athena_note is barely mentioned in the contract');
  athenaSentences.forEach(function (s) {
    ok(/five|HPI, ROS, EXAM, ASSESSMENT, PLAN|NOT TEMPLATED/.test(s),
      'a contract sentence names athena_note without its five-section rule: ' + s.slice(0, 120));
  });
  /* and the precedence clause never overrides the sidecar */
  const prec = CONTRACT.slice(CONTRACT.indexOf('PRECEDENCE'));
  ok(prec.indexOf('the "note" field only') !== -1,
    'the precedence clause does not confine itself to the display note');
  ok(prec.indexOf('athena_note') === -1,
    'the precedence clause reaches the athena sidecar - it must not');
  ok(/PRIOR_NOTE_SEED HARD LIMITS/.test(prec) && /BACKGROUND_ONLY/.test(prec) && /coding ethics/.test(prec),
    'the precedence clause does not restate that the safety rules remain binding');

  /* the sys clause exists, says the same thing, and is added exactly once */
  ok(SYS.indexOf('ACTIVE TEMPLATE FOR THIS VISIT') !== -1,
    'per-device-key mode gets no template clause in the system prompt');
  eq(SYS.split('ACTIVE TEMPLATE FOR THIS VISIT').length - 1, 1,
    'the system template clause was added more than once');
  ok(/stays exactly its five flat sections HPI, ROS, EXAM, ASSESSMENT, PLAN/.test(SYS),
    'the system clause does not protect the athena sidecar');
  /* and it does not contradict the NOTE STYLE line it sits beside */
  ok(SYS.indexOf(h.api.GEN_STYLE_LINE.soap) !== -1, 'the harness did not reproduce the real NOTE STYLE line');
  ok(SYS.indexOf('NOTE STYLE') < SYS.indexOf('ACTIVE TEMPLATE FOR THIS VISIT'),
    'the template clause was placed before the NOTE STYLE line it overrides');
  ok(/Where the TEMPLATE_CONTRACT and the NOTE STYLE line disagree about the "note" field, the TEMPLATE_CONTRACT wins/.test(SYS),
    'the system clause does not resolve the NOTE STYLE conflict for the note field');

  /* ------------------------------------------------------------------ */
  /* 3. NO RAW CANNED ASSERTION REACHES THE PROMPT                       */
  /* ------------------------------------------------------------------ */
  ok(USER.indexOf('tolerated the procedure well') === -1,
    'a canned procedure assertion reached the primary prompt verbatim - a reproduce contract would make it a claim about today');
  ok(USER.indexOf('PROCEDURE NOTE:') !== -1,
    'the sanitiser removed the whole line instead of reducing it to its label');
  /* the receipt says WHICH sanitiser ran, and the ngv1 one is preferred */
  eq(h.ctx.window.__mlsLastGenTemplateContract.sanitizer, 'local-port',
    'with no connect overlay the receipt does not name the local port');
  let ngv1Calls = 0;
  const hNg = harness({
    ngv1: {
      sanitizeTemplateText(text) { ngv1Calls++; return { text: String(text).split('tolerated the procedure well').join('[ngv1]'), stripped: 1 }; }
    }
  });
  await hNg.api.callOpenAI(TRANSCRIPT, 'k', {});
  eq(ngv1Calls, 1, 'the shipped connect-bundle sanitiser was not asked');
  eq(hNg.ctx.window.__mlsLastGenTemplateContract.sanitizer, 'ngv1',
    'the receipt does not say the shipped sanitiser ran');
  ok(String(hNg.captured.user).indexOf('[ngv1]') !== -1,
    'the ngv1 sanitiser answered and its answer was discarded');
  /* the local port agrees with the shipped rule on the canned line */
  const local = h.api._mlsTplPromptSanitizeLocal(TEMPLATE_TEXT);
  eq(local.source, 'local-port', 'the local port does not identify itself');
  ok(local.stripped >= 1, 'the local port stripped nothing from a template with a canned assertion');
  ok(local.text.indexOf('tolerated the procedure well') === -1, 'the local port left the canned assertion in place');
  ok(local.text.indexOf('HISTORY OF PRESENT ILLNESS:') !== -1, 'the local port ate an ordinary heading');
  ok(local.text.indexOf('The plan of care was discussed with the patient') !== -1,
    'the local port ate ordinary template boilerplate');

  /* ------------------------------------------------------------------ */
  /* 4. NO TEMPLATE = BYTE-IDENTICAL TO PRISTINE HEAD                    */
  /* ------------------------------------------------------------------ */
  const head = headHarness();
  await head.api.callOpenAI(TRANSCRIPT, 'k', {});
  const HEAD_SYS = String(head.captured.sys), HEAD_USER = String(head.captured.user);
  ok(HEAD_SYS.length > 500 && HEAD_USER.length > 20, 'the HEAD harness produced nothing to compare against');

  const offCases = [
    ['templates off', { templatesOn: false }],
    ['templates on, no template resolved', { resolved: null }],
    ['templates on, template with a blank body', { resolved: { id: 'x', name: 'blank', text: '   \n\n  ' } }]
  ];
  for (const [label, opt] of offCases) {
    const ho = harness(opt);
    await ho.api.callOpenAI(TRANSCRIPT, 'k', {});
    eq(String(ho.captured.sys), HEAD_SYS, 'the system prompt drifted from pristine HEAD on the no-template path (' + label + ')');
    eq(String(ho.captured.user), HEAD_USER, 'the user payload drifted from pristine HEAD on the no-template path (' + label + ')');
    eq(ho.ctx.window.__mlsLastGenTemplateContract, null,
      'a contract receipt was stamped with no template active (' + label + ')');
  }
  /* and with a template the prompt is a strict SUPERSET, never a rewrite */
  ok(SYS.indexOf(HEAD_SYS) === 0, 'the template clause rewrote the system prompt instead of extending it');
  ok(USER.indexOf(HEAD_USER) === 0, 'the template contract rewrote the user payload instead of extending it');

  /* ------------------------------------------------------------------ */
  /* 5. THE PRIMARY DRAFT IS MEASURED, AND SAID OUT LOUD                 */
  /* ------------------------------------------------------------------ */
  let hm = harness({});
  await hm.api.callOpenAI(TRANSCRIPT, 'k', {});
  /* a draft that summarised the template away */
  const bad = hm.api._mlsMeasurePrimaryTemplateFidelity(SUMMARY_NOTE);
  ok(bad && bad.conformance, 'no conformance was computed for the primary draft');
  eq(bad.stage, 'primary', 'the primary receipt does not say which stage it graded');
  eq(bad.templateId, 'tpl-spine', 'the primary receipt does not name the template that shaped the prompt');
  ok(bad.conformance.total >= 6, 'the fixture template grades too few lines for a percentage to mean anything');
  ok(bad.conformance.belowThreshold === true, 'a summarised draft was not flagged as below threshold');
  ok(hm.ctx.window.__mlsLastPrimaryTemplateConformance === bad, 'the primary receipt was not stamped on window');
  ok(hm.notice.style.display === '', 'the amber notice did not surface for a summarised primary draft');
  const noticeText = hm.notice.textContent;
  ok(/did not follow the template/.test(noticeText), 'the notice does not say the draft did not follow the template');
  ok(new RegExp(bad.conformance.notFollowed + ' of ' + bad.conformance.total + ' template line').test(noticeText),
    'the notice does not name the deterministic count: ' + noticeText);
  const btns = buttonsOf(hm.notice);
  eq(btns.length, 1, 'the primary notice offers no single re-format action');
  ok(/Re-format following the template/.test(btns[0].textContent), 'the notice button is not the re-format action');
  ok(!/fill|complete|write/i.test(btns[0].textContent), 'the notice offers to fill the missing lines in');
  /* pressing it asks again through the shipped bounded owner */
  btns[0].onclick();
  eq(hm.ctx.startedTemplate.length, 1, 'the re-format button did not go through _mlsStartOptionalTemplate');
  eq(hm.ctx.window.__mlsTemplateOverrideId, 'tpl-spine', 'the re-format did not pin the same template');
  /* THE DRAFT IS NEVER REFUSED: the measure returns, it does not throw or blank */
  eq(hm.noteBox.value, SUMMARY_NOTE, 'the primary measure mutated the draft');

  /* a faithful draft: stamped, and silent */
  let hf = harness({});
  await hf.api.callOpenAI(TRANSCRIPT, 'k', {});
  const good = hf.api._mlsMeasurePrimaryTemplateFidelity(FAITHFUL_NOTE);
  ok(good && good.conformance, 'a faithful draft produced no measure');
  eq(good.conformance.belowThreshold, false, 'a faithful reproduction was flagged as a failure');
  eq(hf.notice.style.display, 'none', 'the amber notice surfaced for a faithful draft');
  ok(hf.ctx.window.__mlsLastPrimaryTemplateConformance, 'a faithful draft stamped no receipt - no silent accepts');

  /* no template = no measure and no stamp */
  let hn = harness({ templatesOn: false });
  await hn.api.callOpenAI(TRANSCRIPT, 'k', {});
  eq(hn.api._mlsMeasurePrimaryTemplateFidelity(SUMMARY_NOTE), null,
    'a measure ran with no template active');
  eq(hn.ctx.window.__mlsLastPrimaryTemplateConformance, null,
    'a primary receipt was stamped with no template active');

  /* a NEW generation clears the previous receipt before it resolves */
  hm.api._mlsMeasurePrimaryTemplateFidelity(SUMMARY_NOTE);
  ok(hm.ctx.window.__mlsLastPrimaryTemplateConformance, 'precondition: a receipt is standing');
  const hmOff = hm;
  hmOff.ctx.cfg.templatesOn = false;
  await hmOff.api.callOpenAI(TRANSCRIPT, 'k', {});
  eq(hmOff.ctx.window.__mlsLastPrimaryTemplateConformance, null,
    'a stale primary receipt survived into the next generation');

  /* ------------------------------------------------------------------ */
  /* 6. THE MEASURE COMES BACK WHEN THE REFORMAT DOES NOT LAND           */
  /* ------------------------------------------------------------------ */
  let hr = harness({});
  await hr.api.callOpenAI(TRANSCRIPT, 'k', {});
  hr.api._mlsMeasurePrimaryTemplateFidelity(SUMMARY_NOTE);
  ok(hr.notice.style.display === '', 'precondition: the primary notice is up');
  /* maybeApplyTemplate clears it on the way in - that byte is b1144's */
  hr.api._mlsRenderTplFidelityNotice(null);
  eq(hr.notice.style.display, 'none', 'precondition: the strip was cleared');
  const restored = hr.api._mlsRestorePrimaryTplNotice();
  ok(restored && /did not follow the template/.test(restored),
    'the first-draft measure was not restored after a reformat that did not land');
  eq(hr.notice.style.display, '', 'the restored notice is not visible');
  /* with nothing stamped, restoring is a no-op rather than an invention */
  hr.ctx.window.__mlsLastPrimaryTemplateConformance = null;
  hr.api._mlsRenderTplFidelityNotice(null);
  eq(hr.api._mlsRestorePrimaryTplNotice(), '', 'restore invented a notice with no measure behind it');
  eq(hr.notice.style.display, 'none', 'restore surfaced a notice with no measure behind it');
  /* and the shipped finish() hook is wired to it */
  const FINISH = sliceBetween(shell, 'function _mlsStartOptionalTemplate(transcript,expectedBinding,expectedEpoch,sourceEl){',
    'function _mlsHasTrustedVerifiedHistory', 'optional template runner');
  ok(/if\(!\(receipt&&receipt\.applied===true\)\) _mlsRestorePrimaryTplNotice\(\)/.test(FINISH),
    'the optional-template runner does not restore the first-draft measure when the reformat did not apply');

  /* ------------------------------------------------------------------ */
  /* 7. ONE RESOLVE PER GENERATION - the handoff                         */
  /* ------------------------------------------------------------------ */
  let hh = harness({});
  await hh.api.callOpenAI(TRANSCRIPT, 'k', {});
  eq(hh.counters.resolve, 1, 'the primary prompt did not resolve the template exactly once');
  let applied = await hh.api.maybeApplyTemplate(TRANSCRIPT, { id: 'visit-1' }, 7, {});
  eq(applied.applied, true, 'the reformat did not run off the handoff');
  eq(hh.counters.resolve, 1, 'the reformat resolved the template a SECOND time - the doctor is told twice');
  eq(applied.templateId, 'tpl-spine', 'the reformat used a different template than the primary prompt');
  /* the handoff is one-shot */
  let again = await hh.api.maybeApplyTemplate(TRANSCRIPT, { id: 'visit-1' }, 7, {});
  eq(hh.counters.resolve, 2, 'the handoff was consumed twice - a stale pick can shape the next note');
  /* The second pass re-formats an already-formatted note, so the shipped
     `out===baseNote` guard answers 'unchanged-output'. That is the behaviour
     that shipped; what matters here is that it went through a FRESH resolve
     rather than a stale handoff, which the counter above proves. */
  ok(again.applied === true || again.reason === 'unchanged-output',
    'the fresh-resolve fallback stopped working: ' + JSON.stringify(again));
  /* a different transcript is a different decision */
  let hd = harness({});
  await hd.api.callOpenAI(TRANSCRIPT, 'k', {});
  eq(hd.counters.resolve, 1, 'precondition');
  await hd.api.maybeApplyTemplate(TRANSCRIPT + ' and something else entirely', { id: 'visit-1' }, 7, {});
  eq(hd.counters.resolve, 2, 'a handoff decided from a DIFFERENT transcript was reused');
  /* the b1144 one-click override still wins over the handoff */
  let ho2 = harness({});
  await ho2.api.callOpenAI(TRANSCRIPT, 'k', {});
  ho2.ctx.window.__mlsTemplateOverrideId = 'tpl-spine';
  const over = await ho2.api.maybeApplyTemplate(TRANSCRIPT, { id: 'visit-1' }, 7, {});
  eq(over.applied, true, 'the explicit override stopped applying');
  eq(ho2.ctx.window.__mlsLastTemplatePick.reason, 'chosen',
    'the explicit override lost its receipt to the handoff');
  /* THE HANDOFF LIVES WHERE maybeApplyTemplate IS EXECUTED. A shipped suite
     (template-application-honesty-runtime) vm-executes exactly the
     applyTemplateToNote..openDoc region; a helper maybeApplyTemplate calls
     from outside it reds that suite with a ReferenceError - a suite that
     never runs its subject, which is the worst kind of red. */
  ok(/function _mlsConsumeGenTemplateHandoff\(/.test(TPL_REGION),
    'the handoff reader is outside the region that executes maybeApplyTemplate');
  ok(/function _mlsSetGenTemplateHandoff\(/.test(TPL_REGION),
    'the handoff writer is outside the region that executes maybeApplyTemplate');
  const maybeOnly = TPL_REGION.slice(TPL_REGION.indexOf('async function maybeApplyTemplate'),
    TPL_REGION.indexOf('function reportTemplateApplication'));
  eq((maybeOnly.match(/resolveActiveTemplate\(/g) || []).length, 1,
    'maybeApplyTemplate now names resolveActiveTemplate more than once');

  /* templates OFF leaves no handoff at all */
  let hoff = harness({ templatesOn: false });
  await hoff.api.callOpenAI(TRANSCRIPT, 'k', {});
  eq(hoff.counters.resolve, 0, 'the primary prompt resolved a template with templates off');
  eq(hoff.api._mlsConsumeGenTemplateHandoff(TRANSCRIPT), null, 'a handoff was left behind with templates off');

  /* ------------------------------------------------------------------ */
  /* 8. THE SHIPPED MEASURE IS REUSED, NOT RE-DERIVED                    */
  /* ------------------------------------------------------------------ */
  let integrityCalls = 0;
  let hi = harness({
    integrity: {
      templateConformance(note, tpl) {
        integrityCalls++;
        return { total: 9, verbatim: 2, reworded: 1, missing: 6, notFollowed: 7, pct: 22, lines: [], belowThreshold: true };
      }
    }
  });
  await hi.api.callOpenAI(TRANSCRIPT, 'k', {});
  const shipped = hi.api._mlsMeasurePrimaryTemplateFidelity(SUMMARY_NOTE);
  eq(integrityCalls, 1, 'the primary measure did not reuse the shipped op-note conformance measure');
  eq(shipped.conformance.source, 'opnote-integrity', 'the receipt does not say the shipped measure ran');
  ok(/7 of 9 template lines/.test(hi.notice.textContent), 'the shipped measure did not reach the notice');

  /* ------------------------------------------------------------------ */
  /* 9. THE ATHENA CONTRACT IS BYTE-IDENTICAL TO HEAD, IN ALL FOUR SHELLS*/
  /* ------------------------------------------------------------------ */
  const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];
  const A_ATH = 'function _mlsAthenaNoteQualityError(reason){';
  const B_ATH = 'function _mlsSetAthenaNote(';
  for (const f of SHELLS) {
    const now = fs.readFileSync(path.join(root, f), 'utf8');
    const was = execSync('git show HEAD:' + f.split(path.sep).join('/'), { cwd: root, maxBuffer: 1024 * 1024 * 64 }).toString('utf8');
    const nowV = sliceBetween(now, A_ATH, B_ATH, f + ' athena validator');
    const wasV = sliceBetween(was, A_ATH, B_ATH, f + ' athena validator (HEAD)');
    ok(nowV.length > 4000, f + ': the athena validator slice is implausibly small');
    eq(nowV, wasV, f + ': _mlsValidateAthenaNote is NOT byte-identical to HEAD');
    /* the JSON athena_note field spec is untouched too */
    const nowSpec = sliceBetween(now, ' "athena_note": "<the SAME visit', ' "insurance_note"', f + ' athena_note spec');
    const wasSpec = sliceBetween(was, ' "athena_note": "<the SAME visit', ' "insurance_note"', f + ' athena_note spec (HEAD)');
    eq(nowSpec, wasSpec, f + ': the athena_note field specification changed');
  }

  /* ------------------------------------------------------------------ */
  /* 10. THE TWINS AND THE DERIVED LANES CARRY THE SAME BYTES            */
  /* ------------------------------------------------------------------ */
  const REGION_ANCHORS = [
    [A_VNTPL, B_VNTPL, 'vntpl block'],
    ['  var autoDraftSeed=null;', '\nasync function aiCallRaw', 'callOpenAI tail'],
    ['  const tplOverride=_mlsConsumeTemplateOverride();', '\n  let result;', 'maybeApplyTemplate resolve'],
    ['    try{window.__mlsLastTemplateGenerationReceipt=Object.assign', '\n  var templatePromise;', 'optional finish'],
    ['    /* vntpl-1.0.0: grade the draft the doctor is reading', '\n    return true;', 'generateNote measure']
  ];
  for (const f of SHELLS) {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    for (const [a, b, label] of REGION_ANCHORS) {
      const got = sliceBetween(t, a, b, f + ' ' + label);
      const want = sliceBetween(shell, a, b, SHELL_FILE + ' ' + label);
      eq(got, want, f + ': the ' + label + ' region is not byte-identical to ' + SHELL_FILE);
    }
  }
  /* the connect twins carry the export */
  for (const f of ['1p-mls-connect.js', 'cloned-mls-connect.js', 'mls-connect.js']) {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    eq(t.split('API.sanitizeTemplateText = function (text) { return sanitizeTplText(text); };').length - 1, 1,
      f + ': the ngv1 sanitiser export is missing or duplicated');
    ok(t.indexOf('function sanitizeTplText(text) {') !== -1, f + ': the sanitiser it exports is gone');
    /* read-only: wrapApply still calls it the same way */
    ok(t.indexOf('var san = sanitizeTplText(template.text);') !== -1,
      f + ': the grounded-apply layer no longer sanitises the template');
  }

  /* ------------------------------------------------------------------ */
  /* 11. NOTHING NEW REACHES CANONICAL STATE                             */
  /* ------------------------------------------------------------------ */
  /* A CALL, not a mention: the block's own comment explains WHY it stays away
     from the sidecar, and a grep that cannot tell those apart proves nothing. */
  const VNTPL_ONLY = VNTPL;
  ok(!/_mlsSetAthenaNote\s*\(/.test(VNTPL_ONLY), 'the vntpl block writes the athena sidecar');
  ok(!/_mlsValidateAthenaNote\s*\(/.test(VNTPL_ONLY), 'the vntpl block calls the athena validator');
  ok(!/_mlsSyncAthenaAfterStandardNoteMutation\s*\(/.test(VNTPL_ONLY),
    'the vntpl block drives the canonical-note sync');
  ok(VNTPL_ONLY.indexOf('currentSoap=') === -1 && VNTPL_ONLY.indexOf('noteBox.value=') === -1,
    'the vntpl block mutates the note');
  ok(VNTPL_ONLY.indexOf('innerHTML') === -1, 'the vntpl block writes innerHTML');
  for (let i = 0; i < VNTPL_ONLY.length; i++) {
    if (VNTPL_ONLY.charCodeAt(i) > 126) {
      assert.fail('the vntpl block carries a non-ASCII byte at ' + i + ': ' + JSON.stringify(VNTPL_ONLY.slice(i - 20, i + 20)));
    }
  }
  checks++;

  console.log('PASS section-template-fidelity: ' + checks + ' checks');
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });

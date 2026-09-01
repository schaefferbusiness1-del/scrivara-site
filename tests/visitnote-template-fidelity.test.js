'use strict';
/* vnfid-1.0.0 (owner 2026-08-31: "that really all needs to be fixed both for
 * the op notes and for the other sections to").
 *
 * The op-note lane was fixed on 2026-08-31 (b1142): a reproduce-then-fill
 * prompt contract, a deterministic templateConformance measure, an amber strip
 * that says out loud when a draft did not follow the template, and an
 * exact-name chooser that offers its runner-ups. The GENERAL VISIT-NOTE lane
 * is a SEPARATE pipeline and carried the same weakness in a different shape:
 *
 *   - applyTemplateToNote asked the model for a PROPERTY ("EXACTLY matches the
 *     structure, sections, field labels and order") and then accepted whatever
 *     came back. Its ONLY structural test was `out===baseNote`, which a
 *     summary of the template passes.
 *   - _mlsTplPick was a pure scoreboard: no exact-name short-circuit, so a
 *     LONGER template name out-tokens the one the doctor literally booked, and
 *     the runner-ups it had already ranked were thrown away.
 *
 * This suite EXECUTES the shipped functions - lifted out of the shipped shell,
 * not transcribed - and pins:
 *   1. the reformat prompt carries the REPRODUCE-THEN-FILL operation contract,
 *      and the old property statement is gone;
 *   2. conformance is computed on the REFORMAT RESULT, rides on the receipt,
 *      and a below-threshold result surfaces an honest count with a re-format
 *      button - never a silent accept;
 *   3. content conservation flags a clinical sentence the reformat dropped;
 *   4. the chooser short-circuits an exact name (and refuses to when it is
 *      ambiguous or the wrong declared kind) and surfaces its alternatives
 *      when the pick was not decided;
 *   5. the local conformance port agrees with the SHIPPED op-note measure it
 *      falls back from, and the shipped one is preferred when it is installed;
 *   6. the two 1p twins carry byte-identical text in every edited region;
 *   7. the athena sidecar sync in applyTemplateToNote is untouched, and none of
 *      the new code reaches for the canonical-note state.
 *
 * NOT registered in run-all.js: this is a stage-lane probe. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const shell = fs.readFileSync(path.join(root, SHELLS[0]), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks++; }

function sliceBetween(text, from, to, label) {
  const a = text.indexOf(from);
  assert.ok(a > 0, label + ': the opening anchor moved - ' + from);
  const b = text.indexOf(to, a);
  assert.ok(b > a, label + ': the closing anchor moved - ' + to);
  return text.slice(a, b);
}

/* ===================================================================== */
/* A MINIMAL DOM. Every element refuses innerHTML: a template name is
   untrusted data and these two surfaces must be text sinks, exactly like the
   pick receipt they sit next to. */
/* ===================================================================== */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    childNodes: [], style: {}, className: '', title: '', type: '',
    onclick: null, _text: '',
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
    set() { throw new Error('a fidelity/alternatives surface wrote innerHTML'); },
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
/* 1. THE REFORMAT PROMPT - SOURCE, THEN EXECUTED                         */
/* ===================================================================== */
const APPLY_SRC = sliceBetween(shell,
  'async function applyTemplateToNote(template,visitText,expectedBinding,expectedEpoch)',
  '\nfunction openDoc', 'applyTemplateToNote block');

/* The PROMPT ITSELF, not the comment above it that quotes what it used to
   say - a source grep that cannot tell those two apart proves nothing. */
const SYS_LINE = sliceBetween(APPLY_SRC, "  const sys='", '\n  const tplForModel=', 'the reformat system prompt');
ok(SYS_LINE.indexOf('REPRODUCE, THEN FILL') !== -1,
  'the reformat prompt does not carry the reproduce-then-fill operation contract');
ok(SYS_LINE.indexOf('reproduced VERBATIM') !== -1,
  'the reformat prompt no longer orders the non-fill text to be reproduced verbatim');
ok(/Do NOT summarize, condense, paraphrase, modernise, merge, re-order or omit/.test(SYS_LINE),
  'the reformat prompt does not forbid summarising/condensing/merging/re-ordering/omitting');
ok(SYS_LINE.indexOf('NOTHING THE DOCTOR DOCUMENTED MAY BE LOST') !== -1,
  'the reformat prompt does not require every clinical statement to survive');
ok(/ADDITIONAL FINDINGS/.test(SYS_LINE),
  'the reformat prompt names no place for content the template has no field for');
ok(/KEEPS ITS LINE and gets the explicit placeholder/.test(SYS_LINE),
  'the reformat prompt does not require an explicit placeholder instead of a deleted line');
ok(SYS_LINE.indexOf('EXACTLY matches the structure, sections, field labels and order') === -1,
  'the old property-statement prompt is still there - a property is not an operation');
/* the coding validator the reformat has always carried is NOT weakened */
ok(SYS_LINE.indexOf('CODING -- fill real codes, never echo an instruction') !== -1,
  'the coding contract was dropped from the reformat prompt');
ok(SYS_LINE.indexOf('never output a bare M54.5') !== -1,
  'the deprecated-code guard was dropped from the reformat prompt');

/* ===================================================================== */
/* THE EXECUTED FORMATTER                                                 */
/* ===================================================================== */
const TEMPLATE = [
  'OFFICE VISIT NOTE',
  'PATIENT: [[patient_name]]',
  'DATE OF SERVICE: [[date_of_service]]',
  'CHIEF COMPLAINT: [[chief_complaint]]',
  'HISTORY OF PRESENT ILLNESS:',
  'The patient presents today for evaluation of the complaint recorded above.',
  'PHYSICAL EXAMINATION:',
  'The patient is alert, oriented and in no acute distress on examination today.',
  'ASSESSMENT:',
  'PLAN:',
  'The plan of care was discussed with the patient and all questions were answered.',
  'FOLLOW-UP: [[follow_up]]'
].join('\n');

const BASE_NOTE = [
  'SUBJECTIVE: The patient reports right knee pain for three weeks after increasing his running.',
  'He denies any locking or giving way of the knee at any time.',
  'OBJECTIVE: There is no effusion and full range of motion with tenderness over the patellar tendon.',
  'ASSESSMENT: Patellofemoral pain syndrome of the right knee.',
  'PLAN: Relative rest with ice and a referral to physical therapy was arranged today.'
].join('\n');

/* A REPRODUCTION: every template line comes back, filled. */
const GOOD_OUT = [
  'OFFICE VISIT NOTE',
  'PATIENT: not documented',
  'DATE OF SERVICE: not documented',
  'CHIEF COMPLAINT: Right knee pain',
  'HISTORY OF PRESENT ILLNESS:',
  'The patient presents today for evaluation of the complaint recorded above.',
  'The patient reports right knee pain for three weeks after increasing his running.',
  'He denies any locking or giving way of the knee at any time.',
  'PHYSICAL EXAMINATION:',
  'The patient is alert, oriented and in no acute distress on examination today.',
  'There is no effusion and full range of motion with tenderness over the patellar tendon.',
  'ASSESSMENT:',
  'Patellofemoral pain syndrome of the right knee.',
  'PLAN:',
  'The plan of care was discussed with the patient and all questions were answered.',
  'Relative rest with ice and a referral to physical therapy was arranged today.',
  'FOLLOW-UP: not documented'
].join('\n');

/* A SUMMARY: the headings survive, the template's own sentences do not, and
   one clinical sentence of the doctor's note is gone with them. This is the
   exact shape the owner reported and the shape `out===baseNote` cannot see. */
const SUMMARY_OUT = [
  'OFFICE VISIT NOTE',
  'CHIEF COMPLAINT: Right knee pain',
  'HPI: Three weeks of right knee pain after more running.',
  'EXAM: No effusion, full motion, patellar tendon tenderness.',
  'ASSESSMENT: Patellofemoral pain syndrome of the right knee.',
  'PLAN: Rest, ice, physical therapy.'
].join('\n');

function harness(opts) {
  opts = opts || {};
  const noteBox = makeEl('textarea');
  noteBox.value = BASE_NOTE;
  noteBox.style.display = 'block';
  const transcript = makeEl('textarea');
  transcript.value = 'the transcript';
  const notice = makeEl('div');
  const ids = { noteBox: noteBox, transcript: transcript, tplFidelityNotice: notice };
  const captured = {};
  const context = {
    window: { __mlsCodeTable: null, __mlsOpNoteIntegrity: opts.integrity || null },
    document: makeDoc(ids),
    Promise, String, Object, Array, RegExp, JSON, Math, Date, console, AbortController,
    setTimeout, clearTimeout,
    captured,
    modelOut: opts.out == null ? GOOD_OUT : opts.out,
    startedTemplate: [],
    toasts: []
  };
  const script = `
    let currentFormat = 'soap';
    let currentSoap = ${JSON.stringify(BASE_NOTE)};
    let currentInsurance = '';
    let currentVisitAthenaBinding = { id: 'visit-1' };
    let currentVisitAthenaEpoch = 7;
    function hasAI(){ return true; }
    function getKey(){ return 'k'; }
    function _tplTextForDraft(t){ return String(t||''); }
    function _athenaAsyncBindingStillSafe(){ return true; }
    function _athenaEditorFingerprint(){ return 'fp'; }
    function _mlsSyncAthenaAfterStandardNoteMutation(){ window.__athenaSyncCalls = (window.__athenaSyncCalls||0)+1; }
    function _markVisitDirty(){}
    function toast(m,k){ toasts.push(String(m)+'|'+String(k||'')); }
    function useTemplatesOn(){ return true; }
    function getTemplateById(id){ return id==='alt-1' ? {id:'alt-1',name:'The other one',text:'X'} : null; }
    function resolveActiveTemplate(){ return { id:'tpl-1', name:'Office visit', text: ${JSON.stringify(TEMPLATE)} }; }
    function _mlsStartOptionalTemplate(text,binding,epoch,el){ startedTemplate.push({text:text,binding:binding,epoch:epoch,el:!!el}); return 'started'; }
    async function aiCallRaw(sys,user,key,opts){ captured.sys = sys; captured.user = user; captured.opts = opts; return modelOut; }
    ${APPLY_SRC}
    this.api = { applyTemplateToNote, maybeApplyTemplate, reportTemplateApplication,
                 _mlsTplConformance, _mlsTplConformanceLocal, _mlsTplContentConservation,
                 _mlsTplSentences, _mlsRenderTplFidelityNotice, _mlsRetryTemplateFormat,
                 _mlsConsumeTemplateOverride };
    this.read = { get soap(){ return currentSoap; } };
  `;
  vm.runInNewContext(script, context);
  return { api: context.api, read: context.read, ctx: context, noteBox, notice, transcript };
}

(async function run() {
  /* ---- the operation contract actually reaches the model --------------- */
  let h = harness({ out: GOOD_OUT });
  let r = await h.api.applyTemplateToNote({ id: 'tpl-1', name: 'Office visit', text: TEMPLATE }, 'the transcript', { id: 'visit-1' }, 7);
  eq(r.applied, true, 'a faithful reproduction was not applied');
  ok(h.ctx.captured.sys.indexOf('REPRODUCE, THEN FILL') !== -1,
    'the system prompt the model actually received carries no operation contract');
  ok(h.ctx.captured.user.indexOf('TEMPLATE TO REPRODUCE') !== -1,
    'the user prompt still asks the model to "match a format" rather than reproduce the template');
  ok(h.ctx.captured.user.indexOf('EVERY CLINICAL STATEMENT IN IT MUST SURVIVE') !== -1,
    'the user prompt does not tell the model the note content must survive');
  ok(h.ctx.captured.user.indexOf('OFFICE VISIT NOTE') !== -1, 'the template text never reached the model');

  /* ---- 2. CONFORMANCE FIRES ON THE REFORMAT RESULT --------------------- */
  ok(r.conformance && typeof r.conformance.total === 'number',
    'the success receipt carries no conformance measure - the reformat is still unmeasured');
  ok(r.conformance.total >= 6, 'the template graded fewer than six lines, so the threshold means nothing here');
  eq(r.conformance.belowThreshold, false,
    'a faithful reproduction was flagged as not following the template');
  ok(r.conservation && r.conservation.lostContent === false,
    'a reproduction that kept every sentence was reported as dropping content');
  eq(h.notice.textContent, '', 'a clean reformat still painted a fidelity notice');
  eq(h.notice.style.display, 'none', 'the fidelity notice stayed visible after a clean reformat');
  eq(h.ctx.window.__athenaSyncCalls, 1,
    'the athena sidecar sync did not run exactly once on an applied SOAP reformat');

  /* the SUMMARY - the defect the owner reported - is caught and SAID */
  h = harness({ out: SUMMARY_OUT });
  r = await h.api.applyTemplateToNote({ id: 'tpl-1', name: 'Office visit', text: TEMPLATE }, 'the transcript', { id: 'visit-1' }, 7);
  eq(r.applied, true, 'the summarised draft was silently discarded instead of being applied and flagged');
  ok(r.conformance.belowThreshold === true,
    'a summarised reformat was NOT flagged - the room would accept it in silence, which is the reported bug');
  ok(r.conformance.notFollowed > 0, 'the flagged reformat reported no missing/reworded lines');
  ok(r.conformance.pct < 75, 'the flagged reformat claimed to have reproduced the template');
  /* THE HONEST SURFACE */
  const said = h.notice.textContent;
  ok(said.indexOf('did not follow the template') !== -1,
    'the honest wording the owner asked for is not on the screen');
  ok(said.indexOf(String(r.conformance.notFollowed) + ' of ' + String(r.conformance.total)) !== -1,
    'the notice does not name the COUNT: "' + said + '"');
  ok(/missing or reworded/.test(said), 'the notice does not say what happened to those lines');
  eq(h.notice.style.display, '', 'the notice was computed but left hidden');
  const btns = buttonsOf(h.notice);
  eq(btns.length, 1, 'the notice offers no single re-format action (found ' + btns.length + ')');
  ok(/Re-format following the template/.test(btns[0].textContent),
    'the offered action is not a re-format: ' + btns[0].textContent);
  ok(!/fill in|complete the missing|write the missing/i.test(said),
    'the notice offers to fill the missing lines in - the only thing that could fill them is invention');
  /* ONE CLICK RE-ASKS, through the same bounded owner */
  btns[0].onclick();
  eq(h.ctx.startedTemplate.length, 1, 'the re-format button did not re-run the bounded template owner');
  eq(h.ctx.startedTemplate[0].text, 'the transcript', 're-format did not re-send the transcript');
  eq(h.ctx.startedTemplate[0].epoch, 7, 're-format did not carry the visit epoch, so staleness could not be judged');
  eq(h.notice.textContent, '', 'the notice survived its own retry and now names a stale count');

  /* the measure NEVER refuses the note */
  ok(h.read.soap === SUMMARY_OUT, 'a below-threshold measure discarded the draft instead of reporting it');

  /* ---- 3. CONTENT CONSERVATION ---------------------------------------- */
  const cons = h.api._mlsTplContentConservation(BASE_NOTE, SUMMARY_OUT);
  ok(cons.total >= 4, 'the base note graded fewer than four sentences');
  ok(cons.dropped >= 1, 'a reformat that lost a dictated sentence was reported as conserving everything');
  ok(cons.lostContent === true, 'lost clinical content was not flagged');
  ok(cons.examples.length >= 1 && /locking or giving way/.test(cons.examples.join(' ')),
    'the dropped sentence is not named honestly: ' + JSON.stringify(cons.examples));
  const consGood = h.api._mlsTplContentConservation(BASE_NOTE, GOOD_OUT);
  eq(consGood.dropped, 0, 'a reformat that carried every sentence over was accused of dropping content');
  eq(consGood.lostContent, false, 'a conserving reformat was flagged');
  /* a REWORDED sentence still counts as kept - that is what a reformat DOES */
  const reworded = GOOD_OUT.replace('He denies any locking or giving way of the knee at any time.',
    'The knee, he denies, has never had any locking or giving way at any time.');
  eq(h.api._mlsTplContentConservation(BASE_NOTE, reworded).dropped, 0,
    'a sentence reworded into a template field was counted as dropped');
  /* it never repairs - the measure returns numbers and nothing else */
  ok(!('note' in cons) && !('repaired' in cons) && !('fixed' in cons),
    'the conservation measure hands back a rewritten note - it must only report');

  /* the CONSERVATION-ONLY surface: the template was followed, content was not */
  const conservationOnlyOut = GOOD_OUT.replace('He denies any locking or giving way of the knee at any time.\n', '');
  const h2 = harness({ out: conservationOnlyOut });
  const r2 = await h2.api.applyTemplateToNote({ id: 'tpl-1', name: 'Office visit', text: TEMPLATE }, 't', { id: 'visit-1' }, 7);
  eq(r2.conformance.belowThreshold, false, 'this fixture was meant to follow the template');
  eq(r2.conservation.lostContent, true, 'the dropped sentence was not detected on the applied path');
  ok(/dropped clinical content/.test(h2.notice.textContent),
    'a reformat that followed the template but lost a dictated sentence said nothing: "' + h2.notice.textContent + '"');
  ok(/did not survive the reformat/.test(h2.notice.textContent),
    'the conservation notice does not say what happened');

  /* ---- 5. REUSE FIRST, LOCAL PORT ONLY AS A FALLBACK ------------------- */
  const fake = { templateConformance() { return { total: 99, verbatim: 99, reworded: 0, missing: 0, notFollowed: 0, pct: 100, lines: [], belowThreshold: false }; } };
  const h3 = harness({ out: GOOD_OUT, integrity: fake });
  const viaModule = h3.api._mlsTplConformance(SUMMARY_OUT, TEMPLATE);
  eq(viaModule.source, 'opnote-integrity', 'the shipped op-note measure was installed and NOT used');
  eq(viaModule.total, 99, 'the installed measure was called but its answer was discarded');
  const viaLocal = harness({ out: GOOD_OUT }).api._mlsTplConformance(SUMMARY_OUT, TEMPLATE);
  eq(viaLocal.source, 'local-port', 'with no module installed the fallback did not identify itself');
  ok(viaLocal.belowThreshold === true, 'the fallback port does not catch the summarised draft');

  /* THE FALLBACK AND THE REAL MEASURE MUST AGREE. Lift the SHIPPED
     templateConformance out of feat_mls_opnote_integrity.js and run both on
     the same fixtures - a port that drifted from its original would report a
     different verdict on the same draft. */
  const integritySrc = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
  const NORM = sliceBetween(integritySrc, '  function normText(x) {', '\n  /* Ordered from most specific to broadest.', 'normText');
  const HEAD = sliceBetween(integritySrc, '  function headingLabel(line) {', '\n  function headings(text) {', 'headingLabel');
  const CONF = sliceBetween(integritySrc, '  function conformanceLines(templateText){', '\n  /* The measure plus the three things', 'templateConformance');
  const shippedConformance = new Function('S', NORM + '\n' + HEAD + '\n' + CONF + '\nreturn templateConformance;')(
    function (x) { return x == null ? '' : String(x); });
  const localPort = harness({ out: GOOD_OUT }).api._mlsTplConformanceLocal;
  [['a summary', SUMMARY_OUT], ['a reproduction', GOOD_OUT]].forEach(function (pair) {
    const a = shippedConformance(pair[1], TEMPLATE);
    const b = localPort(pair[1], TEMPLATE);
    eq(b.belowThreshold, a.belowThreshold,
      'the local port disagrees with the SHIPPED op-note measure on ' + pair[0] +
      ' (' + b.pct + '% vs ' + a.pct + '%)');
  });

  /* the measure is PURE and repeatable */
  const p1 = harness({ out: GOOD_OUT }).api._mlsTplConformanceLocal(SUMMARY_OUT, TEMPLATE);
  const p2 = harness({ out: GOOD_OUT }).api._mlsTplConformanceLocal(SUMMARY_OUT, TEMPLATE);
  eq(JSON.stringify(p1), JSON.stringify(p2), 'the conformance measure is not deterministic');

  /* ---- the one-shot override, read at the seam the overlay cannot take -- */
  const h4 = harness({ out: GOOD_OUT });
  h4.ctx.window.__mlsTemplateOverrideId = 'alt-1';
  const chosen = h4.api._mlsConsumeTemplateOverride();
  ok(chosen && chosen.id === 'alt-1', 'a one-click template choice was not honoured');
  eq(h4.ctx.window.__mlsTemplateOverrideId, '', 'the override was not consumed - it would shape the NEXT note too');
  eq(h4.api._mlsConsumeTemplateOverride(), null, 'the override survived being consumed');
  eq(h4.ctx.window.__mlsLastTemplatePick.reason, 'chosen',
    'a one-click choice does not say on the receipt that the doctor chose it');

  /* maybeApplyTemplate still selects exactly ONCE and honours the override */
  const MAYBE = APPLY_SRC.slice(APPLY_SRC.indexOf('async function maybeApplyTemplate'), APPLY_SRC.indexOf('function reportTemplateApplication'));
  eq((MAYBE.match(/resolveActiveTemplate\(/g) || []).length, 1,
    'maybeApplyTemplate grew a second template-selection point');
  ok(MAYBE.indexOf('_mlsConsumeTemplateOverride()') !== -1,
    'maybeApplyTemplate does not read the one-click override, so the overlay would bury it');
  ok(MAYBE.indexOf('_mlsRenderTplFidelityNotice(null)') !== -1,
    'a stale fidelity notice from an earlier generation is never cleared');

  /* ================================================================= */
  /* 4. THE CHOOSER                                                     */
  /* ================================================================= */
  const PICKER_SRC = sliceBetween(shell,
    "var MLS_TPL_KINDS=['soap','insurance','op'];",
    '/* Which kind of note the generator is about to produce', 'picker block');
  const picker = new Function(PICKER_SRC + '\nreturn {_mlsTplPick:_mlsTplPick,'
    + '_mlsTplPickSentence:_mlsTplPickSentence,_mlsTplExactName:_mlsTplExactName,'
    + '_mlsTplTokenKey:_mlsTplTokenKey};')();
  const pick = picker._mlsTplPick;

  /* the picker is still a text-only, data-only function */
  [['eval(', 'eval'], ['new Function', 'a Function compiler'], ['innerHTML', 'an HTML sink'],
   ['new RegExp', 'a RegExp compiled from data'], ['document.', 'the DOM'], ['localStorage', 'storage']
  ].forEach(function (pair) {
    ok(PICKER_SRC.indexOf(pair[0]) === -1, 'the picker now reaches for ' + pair[1]);
  });

  /* THE HOLE: a library holding both names. The scoreboard prefers the LONGER
     name, which is not the one the doctor booked. */
  const BLOCK = { id: 'b', name: 'Genicular Nerve Block', keywords: ['genicular', 'block'], text: 'x', kind: 'soap' };
  const RFA = { id: 'r', name: 'Genicular Nerve Block RFA', keywords: ['genicular', 'block', 'rfa'], text: 'x', kind: 'soap' };
  let p = pick([BLOCK, RFA], { procedure: '', reason: 'Genicular Nerve Block', transcript: '' }, 'soap');
  eq(p.reason, 'exact-name', 'a booking reason that IS a template name did not short-circuit the scoreboard');
  eq(p.id, 'b', 'the exact name lost to the longer template name - the reported defect');
  eq(p.exactName, true, 'the pick does not declare itself an exact-name decision');
  /* and prove the scoreboard alone WOULD have gone the other way */
  const runnerUp = (p.alternatives || [])[0];
  ok(runnerUp && runnerUp.id === 'r', 'the runner-up was thrown away instead of offered');
  ok(runnerUp.score >= p.score,
    'this fixture no longer demonstrates the defect - the scoreboard did not prefer the longer name');
  ok(picker._mlsTplPickSentence(p).indexOf('exactly this template name') !== -1,
    'the receipt does not say WHY an exact-name pick won: ' + picker._mlsTplPickSentence(p));

  /* a KEYWORD is the doctor's own alias for a template, so it counts too */
  const ALIAS = { id: 'a1', name: 'Long formal operative title nobody types', keywords: ['knee gel injection'], text: 'x' };
  eq(pick([ALIAS, BLOCK], { reason: 'Knee Gel Injection' }, '').id, 'a1',
    'a reason that exactly matches a declared keyword did not short-circuit');
  /* STEMMED TOKEN SETS, never containment: a superset name cannot satisfy it */
  ok(pick([RFA], { reason: 'Genicular Nerve Block' }, 'soap').reason !== 'exact-name',
    'a SUPERSET template name satisfied the exact-name test - that is containment, not equality');
  /* plurals and punctuation are the same name */
  eq(pick([{ id: 'z', name: 'Facet Joint Injections', keywords: [], text: 'x' }],
    { reason: 'facet-joint injection' }, '').reason, 'exact-name',
    'punctuation or a plural stopped a name from being the same name');
  /* AMBIGUITY IS NOT AN ANSWER: two templates with the same name */
  const TWIN_A = { id: 'ta', name: 'Lumbar ESI', keywords: [], text: 'x' };
  const TWIN_B = { id: 'tb', name: 'Lumbar ESI', keywords: [], text: 'x' };
  ok(pick([TWIN_A, TWIN_B], { reason: 'Lumbar ESI' }, '').reason !== 'exact-name',
    'two templates sharing one name still produced an exact-name decision');
  /* THE KIND GATE STILL OWNS ELIGIBILITY */
  eq(pick([Object.assign({}, BLOCK, { kind: 'op' })], { reason: 'Genicular Nerve Block' }, 'soap').reason,
    'no-candidate-of-this-kind',
    'an exactly-named template of the WRONG declared kind was still chosen');
  /* the TRANSCRIPT is never an exact-name signal */
  eq(pick([BLOCK], { transcript: 'Genicular Nerve Block' }, '').reason, 'matched',
    'a transcript was treated as an exact template name');

  /* ---- ALTERNATIVES ON AMBIGUITY -------------------------------------- */
  const L34 = { id: 'l34', name: 'Left L3-L4 TFESI', keywords: ['tfesi'], text: 'x' };
  const L45 = { id: 'l45', name: 'Left L4-L5 TFESI', keywords: ['tfesi'], text: 'x' };
  p = pick([L34, L45], { reason: 'left tfesi' }, '');
  eq(p.reason, 'matched', 'this fixture was meant to be a scoreboard match, not an exact name');
  eq(p.margin, 0, 'the fixture is no longer a dead heat, so it cannot prove the ambiguity surface');
  ok((p.alternatives || []).length >= 1, 'a dead heat offered no alternatives at all');
  eq(p.alternatives[0].id, 'l34' === p.id ? 'l45' : 'l34', 'the alternative offered is the chosen template itself');
  /* a DECIDED pick keeps its runner-ups on the record but the surface hides them */
  const STRONG = { id: 's', name: 'Genicular', keywords: ['genicular', 'knee', 'block'], text: 'x' };
  const WEAK = { id: 'w', name: 'Other', keywords: ['knee'], text: 'x' };
  const decided = pick([STRONG, WEAK], { procedure: 'genicular knee block' }, '');
  ok(decided.margin >= 2, 'the decisive fixture is no longer decisive (margin ' + decided.margin + ')');

  /* the chips, EXECUTED */
  const ALTS_SRC = sliceBetween(shell, 'function _mlsRenderTplPickReceipt(fallbackTpl){',
    '/* Reformat the just-generated note to follow a template.', 'receipt + alternatives');
  function runAlts(pickRec, on) {
    const altsEl = makeEl('div');
    const rcptEl = makeEl('div');
    const api = new Function('window', 'document', 'useTemplatesOn', '_mlsTplPickSentence', '_mlsRetryTemplateFormat',
      ALTS_SRC + '\nreturn {receipt:_mlsRenderTplPickReceipt,alts:_mlsRenderTplPickAlts};')(
      { __mlsLastTemplatePick: pickRec || null },
      makeDoc({ tplPickAlts: altsEl, tplPickReceipt: rcptEl }),
      function () { return on !== false; },
      picker._mlsTplPickSentence,
      function (id) { altsEl.__clicked = id; });
    const out = api.receipt();
    return { el: altsEl, rcpt: rcptEl, out: out, api: api };
  }
  let v = runAlts(p);
  ok(v.el.textContent.indexOf('Not decided') !== -1,
    'an undecided pick does not offer its alternatives: "' + v.el.textContent + '"');
  let chips = buttonsOf(v.el);
  eq(chips.length, 1, 'the dead heat offered ' + chips.length + ' chips, not its one alternative');
  ok(chips[0].textContent.indexOf('TFESI') !== -1, 'the chip does not name the template it would switch to');
  chips[0].onclick();
  ok(v.el.__clicked === p.alternatives[0].id,
    'clicking an alternative did not ask for a re-format with THAT template');
  /* a decided pick asks no question */
  v = runAlts(decided);
  eq(v.el.textContent, '', 'a decided pick turned the note into a question anyway');
  eq(v.el.style.display, 'none', 'the alternatives row stayed visible on a decided pick');
  /* an exact name is an answer, not a question */
  v = runAlts(pick([BLOCK, RFA], { reason: 'Genicular Nerve Block' }, 'soap'));
  eq(v.el.textContent, '', 'an exact-name pick still asked which template was meant');
  ok(v.rcpt.textContent.indexOf('exactly this template name') !== -1,
    'the receipt does not name the exact-name reason on screen');
  /* templates OFF: no chips at all */
  v = runAlts(p, false);
  eq(v.el.textContent, '', 'alternatives were offered with templates OFF');
  /* a hostile template NAME lands as text, never markup (the innerHTML setter throws) */
  v = runAlts({ reason: 'matched', id: 'x', name: 'X', kind: '', matched: [], matchedName: [], margin: 0, score: 1,
    alternatives: [{ id: 'h1', name: '<img src=x onerror=alert(1)>', score: 1 }] });
  chips = buttonsOf(v.el);
  eq(chips.length, 1, 'the hostile alternative was dropped instead of rendered as text');
  eq(chips[0].textContent, '<img src=x onerror=alert(1)>', 'a hostile template name was not written verbatim as text');

  /* ================================================================= */
  /* 6. THE TWO TWINS                                                   */
  /* ================================================================= */
  const REGIONS = [
    ['the note surfaces', '<div id="tplPickReceipt"', '<!-- Insurance-Ready toggle -->'],
    ['the picker', "var MLS_TPL_KINDS=['soap','insurance','op'];", '/* Which kind of note the generator is about to produce'],
    ['the exported exact-name decision', 'function _mlsVisitTemplateContext(visitText){', '/* Auto-choose: score saved templates'],
    ['the receipt + alternatives', 'function _mlsRenderTplPickReceipt(fallbackTpl){', '/* Reformat the just-generated note to follow a template.'],
    ['the formatter + its measures', 'async function applyTemplateToNote(template,visitText', '\nfunction openDoc']
  ];
  const twin = fs.readFileSync(path.join(root, SHELLS[1]), 'utf8');
  REGIONS.forEach(function (row) {
    eq(sliceBetween(twin, row[1], row[2], row[0] + ' (twin)'),
      sliceBetween(shell, row[1], row[2], row[0]),
      '1p/index.html carries DIFFERENT text for ' + row[0] + ' than 1pScribeFlow.html');
  });
  SHELLS.forEach(function (name) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    ok(text.indexOf('<div id="tplFidelityNotice"') !== -1, name + ': the fidelity notice surface is missing');
    ok(/id="tplFidelityNotice"[^>]*aria-live="polite"/.test(text), name + ': the fidelity notice is not announced');
    ok(text.indexOf('<div id="tplPickAlts"') !== -1, name + ': the alternatives surface is missing');
    ok(text.indexOf('window._mlsTplExactNamePick=_mlsTplExactNamePick;') !== -1,
      name + ': the exact-name decision is not exported for the overlay that actually runs');
  });

  /* ================================================================= */
  /* THE OVERLAY THAT ACTUALLY DECIDES ON THE LIVE LANE                 */
  /* ================================================================= */
  const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
  const NGV1 = connect.slice(connect.indexOf('var API = { v: "ngv1-1.1.0" };'));
  const HOOK = sliceBetween(NGV1, '          if (autoOn) {', '            var pick = classAwarePick(S(visitText));', 'ngv1 exact-name hook');
  ok(HOOK.indexOf('window._mlsTplExactNamePick') !== -1,
    'the overlay that REPLACES resolveActiveTemplate never asks for the exact-name decision');
  ok(HOOK.indexOf('gateActive(S(visitText), xnPick.tpl)') !== -1,
    'the overlay accepts an exact-name hit WITHOUT its class gate - that would weaken the procedure-template guard');
  ok(HOOK.indexOf('if (xnGate.allow)') !== -1, 'the overlay does not honour its own gate verdict');
  ok(HOOK.indexOf('isFn(window._mlsTplExactNamePick)') !== -1,
    'the overlay does not degrade when the shell export is absent');
  ok(connect.indexOf('window.resolveActiveTemplate = w;') !== -1,
    'the overlay no longer replaces the resolver - re-check which path ships');

  /* ================================================================= */
  /* 7. THE ATHENA SIDECAR IS UNTOUCHED                                 */
  /* ================================================================= */
  eq((APPLY_SRC.match(/_mlsSyncAthenaAfterStandardNoteMutation\(/g) || []).length, 1,
    'the reformat grew a second athena canonical-note sync point');
  ok(APPLY_SRC.indexOf("if(currentFormat==='soap')try{_mlsSyncAthenaAfterStandardNoteMutation('template changed the standard note');}catch(eCanonicalTemplate){}") !== -1,
    'the athena sidecar sync line in the reformat was edited');
  ok(APPLY_SRC.indexOf('_mlsSyncAthenaAfterStandardNoteMutation') < APPLY_SRC.indexOf('_mlsTplConformance(out'),
    'the new measures run BEFORE the athena sidecar sync - the sidecar must own the mutation first');
  ['currentAthenaNote', 'currentAthenaNoteProvenance', 'currentAthenaNoteSourceFingerprint',
   '_mlsSetAthenaNote', '_mlsMarkAthenaNoteStale', '_mlsRefreshAthenaNoteFromDisplayedSoap'].forEach(function (name) {
    const after = APPLY_SRC.slice(APPLY_SRC.indexOf('function _mlsTplConformance('));
    ok(after.indexOf(name) === -1, 'a fidelity helper reaches for the canonical-note state (' + name + ')');
  });

  console.log('PASS visit-note template fidelity (vnfid-1.0.0): ' + checks + ' checks - the SHIPPED reformat, '
    + 'lifted out of the shipped shell and executed. Its prompt now carries the REPRODUCE-THEN-FILL operation '
    + 'contract (the old property statement "EXACTLY matches the structure" is gone) and its coding validator is '
    + 'intact. A summarised reformat - the exact defect the owner reported, and the one `out===baseNote` could '
    + 'never see - is now measured, applied, and SAID: an amber count of N of M template lines missing or '
    + 'reworded with a one-click re-format that re-runs the same bounded owner, never an offer to fill the '
    + 'missing lines in. A reformat that follows the template but loses a dictated sentence is caught separately '
    + 'by the content-conservation measure and named. The measure prefers the SHIPPED op-note templateConformance '
    + 'when it is installed and its local fallback returns the same verdict as the real one on the same fixtures. '
    + 'The chooser now short-circuits a booking reason that IS a template name (the case where the longer name '
    + '"Genicular Nerve Block RFA" out-tokened the one the doctor booked), refuses to when the name is ambiguous, '
    + 'a superset, or of the wrong declared kind, and offers its runner-ups as text-only chips - but only where '
    + 'the pick was NOT decided. The connect-bundle overlay that REPLACES resolveActiveTemplate on the live lane '
    + 'asks the shell for that same decision and still runs its own class gate on it. Both 1p twins carry '
    + 'byte-identical text in all five edited regions, and the athena canonical-note sidecar sync is untouched.');
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });

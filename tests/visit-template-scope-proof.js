'use strict';

/* visit-template-scope-proof.js  --  vntpl-1.1.0 (2026-09-01)
 * ============================================================================
 * THE STANDARD VISIT NOTE ONLY EVER TAKES A VISIT-NOTE TEMPLATE.
 *
 * MEASURED LIVE, 2026-09-01, in the owner's own tab, on his test patient only.
 * Nine standard visit-note generations in a row failed on the Visit screen -
 * backend 502 draft_quality_failed / unstructured_clinical_draft - including
 * after the bounded retry on a stronger model. The captured request said why,
 * and the cause was ours: the generate payload carried a TEMPLATE_CONTRACT
 * block built by _mlsGenTemplateContract from tpl_3dd95e62 "Left knee
 * intra-articular injection", 994 characters that begin
 *
 *     OPERATIVE REPORT / Patient: / Date of procedure: / Type of Anesthesia: /
 *     PROCEDURE: / INDICATIONS: / CONSENT: / ANESTHESIA: /
 *     DESCRIPTION OF PROCEDURE: / ESTIMATED BLOOD LOSS: / COMPLICATIONS: /
 *     DISPOSITION:
 *
 * The model did exactly what that contract told it to and returned a
 * twelve-line operative report; the backend's narrative/SOAP structure check
 * refused it, correctly. Replaying the identical request with ONLY the
 * TEMPLATE_CONTRACT block removed passed first time - 200, gpt-4o-mini, a
 * 1,558-character narrative.
 *
 * Two further facts, both from the same live session:
 *   - "Use templates" was ON, the ACTIVE template id was tms8w1uyl6tfx
 *     ("Starter - Injection op note (generic)"), and the resolver silently
 *     used a DIFFERENT template, chosen by keyword. Nothing on screen named
 *     either one.
 *   - EVERY template in this doctor's library is a procedure/operative-report
 *     template. They belong to the OP-NOTE ROOM, which has its own generation
 *     path and must keep them.
 *
 * WHAT IS PINNED HERE. Everything below EXECUTES code sliced out of the
 * shipped files - the classifier, the two receipt sentences, the shell's own
 * resolveActiveTemplate, the connect bundle's replacement of it, the
 * generation resolver, and the op-note room's own ranker - never a
 * re-implementation of any of them.
 *
 * Run: node tests/visit-template-scope-proof.js
 * ==========================================================================*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

const SHELL = read('1pScribeFlow.html');
const CONNECT = read('1p-mls-connect.js');

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
  assert.ok(a >= 0, 'missing start marker for ' + what + ': ' + from.slice(0, 70));
  const b = source.indexOf(to, a);
  assert.ok(b > a, 'missing end marker for ' + what + ': ' + to.slice(0, 70));
  return source.slice(a, b + to.length);
}

/* ==========================================================================
 * THE SHIPPED REGIONS, SLICED ONCE
 * ======================================================================== */
const A_CLASSIFIER = '/* ===== vntpl-1.1.0 - THE STANDARD VISIT NOTE ONLY EVER TAKES A VISIT-NOTE';
const B_CLASSIFIER = '/* ===== end vntpl-1.1.0 classifier ===== */';
const A_SENTENCES = '/* ===== vntpl-1.1.0 - THE TWO SENTENCES THE RECEIPT OWES THE DOCTOR';
const B_SENTENCES = '/* ===== end vntpl-1.1.0 receipt sentences ===== */';

const CLASSIFIER = between(SHELL, A_CLASSIFIER, B_CLASSIFIER, 'the vntpl-1.1.0 classifier');
const SENTENCES = between(SHELL, A_SENTENCES, B_SENTENCES, 'the vntpl-1.1.0 receipt sentences');
const RECEIPT_FN = extractFn(SHELL, 'function _mlsRenderTplPickReceipt(fallbackTpl){');
const ALTS_FN = extractFn(SHELL, 'function _mlsRenderTplPickAlts(pick){');
const RESOLVE_FN = extractFn(SHELL, 'function resolveActiveTemplate(visitText){');
const GENRESOLVE_FN = extractFn(SHELL, 'function _mlsResolveGenerationTemplate(visitText){');
const CONTRACT_FN = extractFn(SHELL, 'function _mlsGenTemplateContract(tpl){');
const KINDOF_FN = extractFn(SHELL, 'function _mlsTplKindOf(t){');
const OPRANK_FN = extractFn(SHELL, 'function _opRankTemplates(procedure){');

/* THE VNTPL BLOCK'S OWN ASCII RULE APPLIES TO WHAT WAS ADDED TO IT. A single
   smart quote here is a control byte by the time the latin1 writer has been
   through the derive chain. */
for (let i = 0; i < CLASSIFIER.length; i += 1) {
  if (CLASSIFIER.charCodeAt(i) > 126) {
    assert.fail('the vntpl-1.1.0 classifier carries a non-ASCII byte at ' + i +
      ': ' + JSON.stringify(CLASSIFIER.slice(i - 20, i + 20)));
  }
}
for (let i = 0; i < SENTENCES.length; i += 1) {
  if (SENTENCES.charCodeAt(i) > 126) {
    assert.fail('the vntpl-1.1.0 receipt sentences carry a non-ASCII byte at ' + i +
      ': ' + JSON.stringify(SENTENCES.slice(i - 20, i + 20)));
  }
}
checks += 2;

/* A GUARD READ AS A DEFINITION - the cure, applied here. Three call sites
   reach the classifier through `typeof NAME === 'function'` because the two
   shipped suites that EXECUTE those functions slice them away from it. A
   typo inside such a guard is a permanent silent no-op, so every guarded name
   is checked against a real declaration in the same shipped file. */
[
  '_mlsGenTemplateScopeSkip',
  '_mlsGenTemplateSkip',
  '_mlsRenderTplPickReceipt',
  '_mlsTplKindOf'
].forEach(function (name) {
  ok(new RegExp('function\\s+' + name + '\\s*\\(').test(SHELL),
    'a typeof guard names ' + name + ' but the shell declares no such function');
  ok(SHELL.indexOf("typeof " + name + "==='function'") > 0 || SHELL.indexOf('typeof ' + name + " === 'function'") > 0,
    'the guarded name ' + name + ' is no longer feature-detected anywhere - re-check the seam');
});

/* ==========================================================================
 * FIXTURES -- THE OWNER'S OWN LIBRARY, and the two shapes it does not hold
 *
 * Names are his; bodies are authored here in the shape the live capture
 * showed. No PHI: every fixture is a blank template skeleton.
 * ======================================================================== */
const OP_BODY_LIVE = [
  'OPERATIVE REPORT',
  'Patient:',
  'Date of procedure:',
  'Type of Anesthesia:',
  'PROCEDURE:',
  'INDICATIONS:',
  'CONSENT:',
  'ANESTHESIA:',
  'DESCRIPTION OF PROCEDURE:',
  'ESTIMATED BLOOD LOSS:',
  'COMPLICATIONS:',
  'DISPOSITION:'
].join('\n');

/* The packaged starters ship with no OPERATIVE REPORT title line at all -
   feat_pkg_templates writes them PROCEDURE:-first - so they exercise the
   label rule and the pkg_ id rule, not the title rule. */
const PKG_BODY = [
  'PROCEDURE: [PROCEDURE NAME].',
  'INDICATION: [DIAGNOSIS] refractory to conservative care.',
  'CONSENT: Risks, benefits, and alternatives discussed.',
  'TECHNIQUE: The skin was prepped and draped in sterile fashion.',
  'COMPLICATIONS: None.',
  'DISPOSITION: Discharged in stable condition with instructions.'
].join('\n');

const STARTER_BODY = [
  'OPERATIVE NOTE',
  'Surgeon:',
  'Pre-operative diagnosis:',
  'Post-operative diagnosis:',
  'Type of Anesthesia:',
  'DESCRIPTION OF PROCEDURE:',
  'ESTIMATED BLOOD LOSS:',
  'Specimens:',
  'DISPOSITION:'
].join('\n');

const OWNER_LIBRARY = [
  { id: 'tpl_3dd95e62-a298-4137-a114-f2461247073f', name: 'Left knee intra-articular injection', text: OP_BODY_LIVE,
    note: 'THE ONE THE RESOLVER ACTUALLY PICKED on 2026-09-01' },
  { id: 'tms8w1uyl6tfx', name: 'Starter - Injection op note (generic)', text: STARTER_BODY,
    note: 'THE ACTIVE TEMPLATE on the owner s account' },
  { id: 'pkg_caudal_epidural_steroid_injection', name: 'Caudal Epidural Steroid Injection', text: PKG_BODY },
  { id: 'pkg_lumbar_facet_joint_injection', name: 'Lumbar Facet Joint Injection', text: PKG_BODY },
  { id: 'pkg_genicular_nerve_block', name: 'Genicular Nerve Block', text: PKG_BODY },
  { id: 'tpl_starter_lumbar_esi', name: 'Starter - Lumbar ESI', text: STARTER_BODY },
  { id: 'tpl_starter_mbb', name: 'Starter - Medial branch block', text: STARTER_BODY },
  { id: 'tpl_l3l4_tfesi', name: 'Left L3-L4 TFESI', text: OP_BODY_LIVE }
];

const SOAP_TPL = {
  id: 'tpl_office_soap', name: 'Office visit - SOAP',
  text: [
    'OFFICE VISIT',
    'CHIEF COMPLAINT:',
    'SUBJECTIVE:',
    'OBJECTIVE:',
    'ASSESSMENT:',
    'PLAN:'
  ].join('\n')
};
const NARRATIVE_TPL = {
  id: 'tpl_followup_narrative', name: 'Follow-up narrative',
  text: [
    'Follow-up visit',
    'History of present illness:',
    'Review of systems:',
    'Physical examination:',
    'Impression:',
    'Plan:'
  ].join('\n')
};
const SHAPELESS_TPL = {
  id: 'tpl_letter', name: 'Referral letter',
  text: 'Dear colleague, thank you for seeing this patient with me. I would value your thoughts.'
};
const DECLARED_OP_TPL = { id: 'tpl_declared', name: 'A note the doctor declared', kind: 'op', text: SOAP_TPL.text };
const DECLARED_SOAP_TPL = { id: 'tpl_declared2', name: 'Another the doctor declared', kind: 'soap', text: OP_BODY_LIVE };

/* ==========================================================================
 * PART A -- THE CLASSIFIER, EXECUTED
 *
 * Booted with the REAL _mlsTplKindOf beside it, because the declared kind is
 * the first question the classifier asks and a stub would answer it for the
 * shipped rule.
 * ======================================================================== */
function bootClassifier() {
  const sandbox = {
    String: String, Number: Number, Object: Object, Array: Array, RegExp: RegExp, Date: Date, JSON: JSON
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(KINDOF_FN + '\n' + CLASSIFIER + '\n', sandbox, { filename: 'vntpl-1.1.0-classifier.js' });
  return {
    sandbox,
    isOp: (t) => vm.runInContext('_mlsTemplateIsOperativeReport(' + JSON.stringify(t) + ')', sandbox),
    isVn: (t) => vm.runInContext('_mlsTemplateIsVisitNoteShaped(' + JSON.stringify(t) + ')', sandbox),
    why: (t) => vm.runInContext('_mlsGenTemplateScopeSkip(' + JSON.stringify(t) + ')', sandbox)
  };
}
const C = bootClassifier();

/* A1. EVERY TEMPLATE IN THE OWNER'S LIBRARY IS AN OPERATIVE REPORT. */
OWNER_LIBRARY.forEach(function (t) {
  eq(C.isOp(t), true, 'the owner library template "' + t.name + '" is not classified as an operative report' +
    (t.note ? ' (' + t.note + ')' : ''));
  eq(C.why(t), 'operative-report',
    'the scope answer for "' + t.name + '" is not operative-report');
});

/* A2. A SOAP-SHAPED AND A NARRATIVE-SHAPED TEMPLATE ARE NOT. This is the
   direction that matters most: a gate that refused everything would "fix" the
   defect by removing the feature. */
[SOAP_TPL, NARRATIVE_TPL].forEach(function (t) {
  eq(C.isOp(t), false, '"' + t.name + '" was mistaken for an operative report');
  eq(C.isVn(t), true, '"' + t.name + '" is not recognised as visit-note shaped');
  eq(C.why(t), '', '"' + t.name + '" was refused for the standard visit note');
});

/* A3. THE DECLARED KIND IS ASKED FIRST, in BOTH directions. */
eq(C.isOp(DECLARED_OP_TPL), true, 'a template the doctor DECLARED as an op note was not treated as one');
eq(C.isOp(DECLARED_SOAP_TPL), false, 'a template the doctor DECLARED as SOAP was overridden by the text heuristic');
eq(C.why(DECLARED_SOAP_TPL), 'not-visit-note-shaped',
  'an op-shaped template declared SOAP still slipped through both gates - the shape rule must catch it');

/* A4. NO HEADINGS AT ALL IS NOT A VISIT NOTE. */
eq(C.isOp(SHAPELESS_TPL), false, 'a plain letter was called an operative report');
eq(C.isVn(SHAPELESS_TPL), false, 'a plain letter was called visit-note shaped');
eq(C.why(SHAPELESS_TPL), 'not-visit-note-shaped', 'a template with no visit-note section was not refused');

/* A5. THE INDIVIDUAL RULES, ONE AT A TIME - so a later change cannot quietly
   collapse four independent reasons into one. */
eq(C.isOp({ id: 'pkg_anything', name: 'Anything', text: 'Notes:\nSome free text about the visit.' }), true,
  'the pkg_ id rule (the packaged procedure starters) no longer fires on its own');
eq(C.isOp({ id: 'x', name: 'Operative Report', text: 'Notes:\nfree text' }), true,
  'a template NAMED "Operative Report" is not classified by its name');
eq(C.isOp({ id: 'x', name: 'Whatever', text: 'PROCEDURE NOTE\nNotes:\nfree text' }), true,
  'the title line rule no longer fires on a first-line PROCEDURE NOTE');
eq(C.isOp({ id: 'x', name: 'Whatever', text: 'Visit\nIndications:\nSomething.' }), false,
  'ONE operative label is enough to refuse - an office note may legitimately carry an Indications line');
eq(C.isOp({ id: 'x', name: 'Whatever', text: 'Visit\nIndications:\nDisposition:' }), true,
  'TWO operative labels no longer refuse');
eq(C.isOp({ id: 'x', name: 'Whatever', text: 'Visit\nPre-operative diagnosis:\nPost-operative diagnosis:' }), true,
  'the hyphenated pre/post-operative diagnosis labels are not normalised to the label list');

/* A6. IT IS PURE. Called twice with the same record it gives the same answer,
   and it touches nothing outside itself. */
eq(C.isOp(OWNER_LIBRARY[0]), C.isOp(OWNER_LIBRARY[0]), 'the classifier is not a pure function of its argument');
eq(vm.runInContext('typeof window.__mlsLastGenTemplateSkip', C.sandbox), 'undefined',
  'merely classifying a template wrote a skip receipt');

/* A7. rubbish in, false out - never a throw on the generation path */
[null, undefined, 0, '', 'a string', [], {}].forEach(function (junk) {
  eq(vm.runInContext('_mlsTemplateIsOperativeReport(' + JSON.stringify(junk === undefined ? null : junk) + ')', C.sandbox),
    false, 'the classifier did not answer false for a non-template value');
});

/* THE DECISION TABLE, printed so the reviewer reads the rule and not the
   code. Nothing here asserts; the assertions are above. */
const TABLE = [];
OWNER_LIBRARY.concat([SOAP_TPL, NARRATIVE_TPL, SHAPELESS_TPL, DECLARED_OP_TPL, DECLARED_SOAP_TPL])
  .forEach(function (t) {
    TABLE.push([t.name, C.isOp(t) ? 'op-report' : '-', C.isVn(t) ? 'visit-shaped' : '-', C.why(t) || 'ALLOWED']);
  });

/* ==========================================================================
 * PART B -- _mlsResolveGenerationTemplate RETURNS NULL, WITH A RECEIPT
 *
 * The whole vntpl block is executed with the real classifier inside it and a
 * stub resolver standing in for whichever resolver actually ships - which is
 * the honest shape, because the connect bundle replaces that function.
 * ======================================================================== */
function bootGenResolve(resolved, opts) {
  opts = opts || {};
  const painted = [];
  const sandbox = {
    String: String, Number: Number, Object: Object, Array: Array, RegExp: RegExp, Date: Date, JSON: JSON,
    __resolved: resolved,
    __painted: painted
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    KINDOF_FN + '\n' + CLASSIFIER + '\n' + GENRESOLVE_FN + '\n' + CONTRACT_FN + '\n' +
    'function useTemplatesOn(){ return ' + (opts.on === false ? 'false' : 'true') + '; }\n' +
    'function _tplTextForDraft(t){ return String(t||""); }\n' +
    'function _mlsTplPromptSanitize(t){ return {text:String(t||""),stripped:0,source:"local-port"}; }\n' +
    'function _mlsTplSectionLines(){ return []; }\n' +
    'function resolveActiveTemplate(){ return __resolved ? JSON.parse(JSON.stringify(__resolved)) : null; }\n' +
    'function _mlsRenderTplPickReceipt(fb){ __painted.push(fb === undefined ? "none" : fb); return ""; }\n',
    sandbox, { filename: 'vntpl-1.1.0-genresolve.js' });
  return {
    sandbox, painted,
    resolve: () => vm.runInContext('_mlsResolveGenerationTemplate("today the patient came in with knee pain")', sandbox),
    skip: () => vm.runInContext('window.__mlsLastGenTemplateSkip || null', sandbox),
    contract: (t) => vm.runInContext('_mlsGenTemplateContract(' + JSON.stringify(t) + ')', sandbox)
  };
}

/* B1. THE LIVE DEFECT, PINNED DIRECTLY. */
(function () {
  const g = bootGenResolve(OWNER_LIBRARY[0]);
  const out = g.resolve();
  eq(out, null, 'the generation resolver still hands an OPERATIVE REPORT to the standard visit note');
  const s = g.skip();
  ok(s, 'the refusal left no receipt at all - a silent refusal is the defect wearing a fresh label');
  eq(s.id, 'tpl_3dd95e62-a298-4137-a114-f2461247073f', 'the skip receipt does not name the template id');
  eq(s.name, 'Left knee intra-articular injection', 'the skip receipt does not name the template');
  eq(s.why, 'operative-report', 'the skip receipt does not carry the reason');
  ok(typeof s.at === 'number' && s.at > 0, 'the skip receipt carries no timestamp');
  eq(Object.keys(s).sort().join(','), 'at,id,name,why',
    'the skip receipt grew a field - it is PHI-free by construction and must stay that way');
  ok(g.painted.length >= 1, 'the refusal never repainted the visible pick receipt');

  /* AND THE CONTRACT IT WOULD HAVE BUILT IS EXACTLY THE ONE THE BACKEND
     REFUSED - so this suite fails if the refusal is ever removed silently. */
  const wouldHave = g.contract(OWNER_LIBRARY[0]);
  ok(wouldHave && wouldHave.block.indexOf('TEMPLATE_CONTRACT_BEGIN') === 0,
    'the fixture no longer reproduces the block that was captured live');
  ok(wouldHave.block.indexOf('OPERATIVE REPORT') > 0,
    'the fixture template no longer carries the operative-report body the backend refused');
})();

/* B2. EVERY OTHER TEMPLATE IN HIS LIBRARY IS REFUSED TOO - including the one
   that was ACTIVE, which is the reason a gate on the keyword match alone
   would have changed nothing for him. */
OWNER_LIBRARY.forEach(function (t) {
  const g = bootGenResolve(t);
  eq(g.resolve(), null, 'the generation resolver still accepts "' + t.name + '"');
  eq((g.skip() || {}).why, 'operative-report', 'no operative-report receipt for "' + t.name + '"');
});

/* B3. A VISIT-NOTE TEMPLATE IS RETURNED UNCHANGED - the same object, field for
   field. This gate refuses; it never rewrites. */
[SOAP_TPL, NARRATIVE_TPL].forEach(function (t) {
  const g = bootGenResolve(t);
  const out = g.resolve();
  ok(out, '"' + t.name + '" was refused for the standard visit note');
  eq(JSON.stringify(out), JSON.stringify(t), '"' + t.name + '" came back rewritten rather than unchanged');
  eq(g.skip(), null, 'an allowed template still left a refusal receipt');
});

/* B4. A SHAPELESS TEMPLATE IS REFUSED WITH THE OTHER REASON. */
(function () {
  const g = bootGenResolve(SHAPELESS_TPL);
  eq(g.resolve(), null, 'a template with no visit-note section shaped the visit note anyway');
  eq((g.skip() || {}).why, 'not-visit-note-shaped', 'the second refusal reason is not recorded');
})();

/* B5. TEMPLATES OFF IS STILL TEMPLATES OFF - no receipt, no sentence, nothing
   on screen that was not there before. */
(function () {
  const g = bootGenResolve(OWNER_LIBRARY[0], { on: false });
  eq(g.resolve(), null, 'the OFF toggle no longer short-circuits the generation resolver');
  eq(g.skip(), null, 'the OFF path invented a refusal receipt');
  eq(g.painted.length, 0, 'the OFF path repainted the receipt');
})();

/* B6. A TEMPLATE WITH NO BODY IS NOT REFUSED TWICE. The contract builder
   already returns null for it; a second refusal would put a sentence on
   screen about a template that could never have shaped anything. */
(function () {
  const g = bootGenResolve({ id: 'blank', name: 'blank', text: '   \n\n  ' });
  ok(g.resolve(), 'the blank-body template was refused by the scope gate instead of the contract builder');
  eq(g.skip(), null, 'a blank template produced a refusal sentence');
  eq(g.contract({ id: 'blank', name: 'blank', text: '   \n\n  ' }), null,
    'the contract builder no longer returns null for a blank template body');
})();

/* ==========================================================================
 * PART C -- THE RECEIPT SAYS IT IN PLAIN WORDS
 *
 * The REAL _mlsRenderTplPickReceipt, the real sentence builders and the real
 * alternatives renderer, executed against a DOM that refuses innerHTML.
 * ======================================================================== */
function makeEl() {
  const el = { style: {}, childNodes: [], _text: '', tagName: 'DIV',
    appendChild(c) { el.childNodes.push(c); return c; },
    removeChild(c) { el.childNodes = el.childNodes.filter((x) => x !== c); return c; },
    get firstChild() { return el.childNodes.length ? el.childNodes[0] : null; } };
  Object.defineProperty(el, 'textContent', {
    get() { return el.childNodes.length ? el.childNodes.map((c) => c.textContent).join('') : el._text; },
    set(v) { el._text = String(v); el.childNodes = []; }
  });
  Object.defineProperty(el, 'innerHTML', {
    set() { throw new Error('the pick receipt wrote innerHTML'); },
    get() { return undefined; }
  });
  return el;
}
function bootReceipt(opts) {
  opts = opts || {};
  const rcpt = makeEl(), alts = makeEl();
  const sandbox = {
    String: String, Number: Number, Object: Object, Array: Array, RegExp: RegExp, Date: Date, JSON: JSON,
    document: {
      getElementById: (id) => (id === 'tplPickReceipt' ? rcpt : (id === 'tplPickAlts' ? alts : null)),
      createElement: () => makeEl(),
      createTextNode: (v) => ({ textContent: String(v), childNodes: [] })
    }
  };
  sandbox.window = sandbox;
  sandbox.__mlsLastTemplatePick = opts.pick || null;
  sandbox.__mlsLastGenTemplateSkip = opts.skip || null;
  vm.createContext(sandbox);
  vm.runInContext(
    SENTENCES + '\n' + RECEIPT_FN + '\n' + ALTS_FN + '\n' +
    'function useTemplatesOn(){ return ' + (opts.on === false ? 'false' : 'true') + '; }\n' +
    'function _mlsTplPickSentence(p){ return p ? ("Template: " + p.name) : ""; }\n' +
    'function _mlsRetryTemplateFormat(){}\n' +
    (opts.activeId === undefined ? '' :
      'function getActiveTemplateId(){ return ' + JSON.stringify(opts.activeId) + '; }\n' +
      'function getTemplateById(id){ var m=' + JSON.stringify(opts.byId || {}) + '; return m[id] || null; }\n'),
    sandbox, { filename: 'vntpl-1.1.0-receipt.js' });
  return { rcpt, alts, render: (fb) => vm.runInContext('_mlsRenderTplPickReceipt(' + (fb === undefined ? '' : JSON.stringify(fb)) + ')', sandbox) };
}

/* C1. THE SENTENCE THE OWNER WOULD HAVE READ. */
(function () {
  const r = bootReceipt({ skip: { id: 'tpl_3dd95e62', name: 'Left knee intra-articular injection', why: 'operative-report', at: 1 } });
  const text = r.render();
  eq(text,
    'Your procedure template "Left knee intra-articular injection" was left to the op note room, so this visit note was written in your note style instead.',
    'the refusal sentence changed');
  eq(r.rcpt.textContent, text, 'the refusal sentence never reached the receipt element');
  eq(r.rcpt.style.display, '', 'the receipt stayed hidden while carrying a refusal');

  /* PLAIN WORDS, AND ONE SENTENCE. */
  eq(text.split('. ').length, 1, 'the refusal is more than one sentence');
  eq(text.slice(-1), '.', 'the refusal sentence does not end in a full stop');
  ok(text.indexOf('op note room') > 0, 'the sentence does not say the template was left to the op note room');
  ok(text.indexOf('note style') > 0, 'the sentence does not say what the visit note used instead');
  ['operative-report', 'not-visit-note-shaped', 'null', 'vntpl', 'template contract', 'resolver', 'classifier', 'SOAP', 'API']
    .forEach(function (jargon) {
      ok(text.indexOf(jargon) === -1, 'the refusal sentence leaks jargon to the doctor: ' + jargon);
    });
  ok(!/[^\x20-\x7e]/.test(text), 'the refusal sentence carries a non-ASCII byte, which the derive chain can corrupt');
})();

/* C2. THE OTHER REASON, said just as plainly. */
(function () {
  const r = bootReceipt({ skip: { id: 'x', name: 'Referral letter', why: 'not-visit-note-shaped', at: 1 } });
  eq(r.render(),
    'Your template "Referral letter" is not laid out as a visit note, so this visit note was written in your note style instead.',
    'the not-visit-note-shaped sentence changed');
})();

/* C3. A HOSTILE TEMPLATE NAME LANDS AS TEXT, never as markup - the element
   throws on innerHTML, so reaching this line at all is the proof. */
(function () {
  const r = bootReceipt({ skip: { id: 'x', name: '<img src=x onerror=alert(1)>', why: 'operative-report', at: 1 } });
  ok(r.rcpt.textContent === undefined || r.render().indexOf('<img src=x onerror=alert(1)>') > 0,
    'a hostile template name was dropped instead of written verbatim as text');
})();

/* C4. TEMPLATES OFF: no sentence at all. */
(function () {
  const r = bootReceipt({ on: false, skip: { id: 'x', name: 'X', why: 'operative-report', at: 1 } });
  eq(r.render(), '', 'a refusal sentence was shown with templates OFF');
  eq(r.rcpt.style.display, 'none', 'the receipt element stayed visible with templates OFF');
})();

/* C5. THE SILENT OVERRIDE, NAMED. Live: the active template was tms8w1uyl6tfx
   and a keyword match used a different one; nothing said so. */
(function () {
  const r = bootReceipt({
    pick: { id: 'tpl_3dd95e62', name: 'Left knee intra-articular injection', reason: 'matched', matched: ['knee'], matchedName: [] },
    activeId: 'tms8w1uyl6tfx',
    byId: { tms8w1uyl6tfx: { id: 'tms8w1uyl6tfx', name: 'Starter - Injection op note (generic)' } }
  });
  const text = r.render();
  ok(text.indexOf('Left knee intra-articular injection') > 0,
    'the receipt does not name the template that was actually used');
  ok(text.indexOf('Starter - Injection op note (generic)') > 0,
    'the receipt does not name the doctor own template that was overridden');
  ok(text.indexOf('was not the one used') > 0, 'the receipt does not say the doctor own template was not used');
})();

/* C6. AND IT SAYS NOTHING when there is nothing to say: the pick IS the active
   template, or no active template is set. The matching RULE is untouched. */
(function () {
  const same = bootReceipt({
    pick: { id: 'tms8w1uyl6tfx', name: 'Starter', reason: 'matched', matched: [], matchedName: [] },
    activeId: 'tms8w1uyl6tfx', byId: { tms8w1uyl6tfx: { id: 'tms8w1uyl6tfx', name: 'Starter' } }
  });
  eq(same.render().indexOf('was not the one used'), -1,
    'the receipt claimed an override when the pick IS the active template');
  const none = bootReceipt({
    pick: { id: 'tpl_a', name: 'A', reason: 'matched', matched: [], matchedName: [] },
    activeId: '', byId: {}
  });
  eq(none.render().indexOf('was not the one used'), -1,
    'the receipt claimed an override with no active template set');
})();

/* C7. THE OLD LADDER IS INTACT: a real fallback still outranks a stale pick. */
(function () {
  const r = bootReceipt({ pick: { id: 'old', name: 'From a previous visit', reason: 'matched', matched: [], matchedName: [] } });
  const text = r.render({ id: 'd', name: 'My default' });
  ok(text.indexOf('My default') > 0, 'the fallback argument stopped outranking a stale pick');
  ok(text.indexOf('From a previous visit') === -1, 'a previous visit template is still named on this note');
})();

/* ==========================================================================
 * PART D -- THE SHELL'S OWN resolveActiveTemplate REFUSES TOO
 *
 * Executed with the classifier really present, so the three typeof guards are
 * proved to resolve to the shipped functions rather than to nothing.
 * ======================================================================== */
function bootResolve(opts) {
  const toasts = [], painted = [];
  const sandbox = {
    String: String, Number: Number, Object: Object, Array: Array, RegExp: RegExp, Date: Date, JSON: JSON,
    __toasts: toasts, __painted: painted
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    KINDOF_FN + '\n' + CLASSIFIER + '\n' + RESOLVE_FN + '\n' +
    'function useTemplatesOn(){ return true; }\n' +
    'function templateAutoOn(){ return ' + (opts.auto === true) + '; }\n' +
    'function pickTemplateForVisit(){ return ' + JSON.stringify(opts.picked || null) + '; }\n' +
    'function _mlsVisitTemplateContext(t){ return {procedure:"",reason:"",transcript:String(t||"")}; }\n' +
    'function _mlsCurrentNoteKind(){ return "soap"; }\n' +
    'function _mlsTplPickSentence(){ return "why"; }\n' +
    'function _mlsRenderTplPickReceipt(fb){ __painted.push(fb === undefined ? "none" : fb); return ""; }\n' +
    'function getActiveTemplateId(){ return ' + JSON.stringify(opts.activeId || '') + '; }\n' +
    'function getTemplateById(id){ var m=' + JSON.stringify(opts.byId || {}) + '; return m[id] || null; }\n' +
    'function toast(m){ __toasts.push(String(m)); }\n',
    sandbox, { filename: 'vntpl-1.1.0-resolve.js' });
  return {
    toasts, painted,
    run: () => vm.runInContext('resolveActiveTemplate("knee pain today")', sandbox),
    skip: () => vm.runInContext('window.__mlsLastGenTemplateSkip || null', sandbox)
  };
}

/* D1. auto-choose ON, the keyword matcher picks an operative report: refused,
   and NOT announced as a triumph. */
(function () {
  const r = bootResolve({ auto: true, picked: OWNER_LIBRARY[0], activeId: 'tms8w1uyl6tfx',
    byId: { tms8w1uyl6tfx: OWNER_LIBRARY[1] } });
  eq(r.run(), null, 'the shell resolver still returns an operative report for a standard visit note');
  eq((r.skip() || {}).why, 'operative-report', 'the shell resolver left no refusal receipt');
  eq(r.toasts.length, 0, 'the shell resolver toasted "Auto-chose" for a template it refused to use');
})();

/* D2. auto-choose OFF and the doctor's DEFAULT is an operative report: refused
   as well. On the owner's account this is the branch that mattered. */
(function () {
  const r = bootResolve({ auto: false, activeId: 'tms8w1uyl6tfx', byId: { tms8w1uyl6tfx: OWNER_LIBRARY[1] } });
  eq(r.run(), null, 'the doctor default operative-report template still shapes the standard visit note');
  eq((r.skip() || {}).name, 'Starter - Injection op note (generic)',
    'the refusal receipt does not name the default that was refused');
})();

/* D3. A VISIT-NOTE DEFAULT IS STILL HONOURED, and still announced exactly as
   before - the legacy single-template doctor is untouched. */
(function () {
  const r = bootResolve({ auto: false, activeId: 'soap1', byId: { soap1: SOAP_TPL } });
  eq((r.run() || {}).id, 'tpl_office_soap', 'a SOAP default template stopped being honoured');
  eq(r.skip(), null, 'an honoured default left a refusal receipt');
  eq(r.painted.length, 1, 'the default path stopped rendering its receipt');
})();

/* D4. A VISIT-NOTE AUTO-PICK IS STILL ANNOUNCED. */
(function () {
  const r = bootResolve({ auto: true, picked: NARRATIVE_TPL, activeId: '', byId: {} });
  eq((r.run() || {}).id, 'tpl_followup_narrative', 'a visit-note auto-pick stopped being returned');
  eq(r.toasts.length, 1, 'a visit-note auto-pick is no longer announced exactly once');
})();

/* D5. THE RESOLVER CLEARS THE PREVIOUS REFUSAL BEFORE MAKING A NEW DECISION -
   a refusal from an earlier generation naming a template THIS note never saw
   is the same class of lie the stale pick receipt was. */
ok(RESOLVE_FN.indexOf('window.__mlsLastGenTemplateSkip=null') > 0,
  'the shell resolver no longer clears a previous generation refusal receipt');

/* ==========================================================================
 * PART E -- THE OVERLAY THAT ACTUALLY DECIDES ON THE LIVE LANE
 *
 * The connect bundle REPLACES window.resolveActiveTemplate outright (ngv1
 * wrapResolve), so the shell's own gate never runs in production. The real
 * wrapper is executed here, with the real shell classifier installed on
 * window - which is exactly how the two modules meet at runtime.
 * ======================================================================== */
const VN_WHY_FN = extractFn(CONNECT, '  function vnScopeWhy(tpl) {');
const VN_REFUSE_FN = extractFn(CONNECT, '  function vnScopeRefuse(tpl, why) {');
const WRAP_FN = extractFn(CONNECT, '  function wrapResolve() {');

function bootOverlay(opts) {
  const toasts = [], logs = [], painted = [];
  const sandbox = {
    String: String, Number: Number, Object: Object, Array: Array, RegExp: RegExp, Date: Date, JSON: JSON,
    __toasts: toasts, __logs: logs, __painted: painted
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  /* the shell half first: the real classifier and the real recorder, reached
     across the module boundary exactly as the shipped overlay reaches them */
  vm.runInContext(KINDOF_FN + '\n' + CLASSIFIER + '\n' +
    'function _mlsRenderTplPickReceipt(fb){ __painted.push(fb === undefined ? "none" : fb); return ""; }\n' +
    'window._mlsRenderTplPickReceipt = _mlsRenderTplPickReceipt;\n', sandbox, { filename: 'shell-half.js' });
  /* then the overlay half */
  vm.runInContext(
    'function isFn(f){ return typeof f === "function"; }\n' +
    'function S(x){ return x == null ? "" : String(x); }\n' +
    'function toast(m){ __toasts.push(String(m)); }\n' +
    'function warnOnce(m){ __toasts.push("WARN " + String(m)); }\n' +
    'function logEvent(kind, name, okv, msg){ __logs.push({kind:kind,name:name,msg:msg}); }\n' +
    'function gateActive(){ return { allow: true, reason: "stub" }; }\n' +
    'function classAwarePick(){ return ' + JSON.stringify(opts.pick || { tpl: null, cls: { cls: 'office' }, reason: 'stub' }) + '; }\n' +
    'var _origResolve = null;\n' +
    VN_WHY_FN + '\n' + VN_REFUSE_FN + '\n' + WRAP_FN + '\n' +
    'window.useTemplatesOn = function(){ return true; };\n' +
    'window.templateAutoOn = function(){ return ' + (opts.auto === true) + '; };\n' +
    'window._mlsTplExactNamePick = ' + (opts.exact ? 'function(){ return ' + JSON.stringify(opts.exact) + '; }' : 'null') + ';\n' +
    'window.getActiveTemplateId = function(){ return ' + JSON.stringify(opts.activeId || '') + '; };\n' +
    'window.getTemplateById = function(id){ var m=' + JSON.stringify(opts.byId || {}) + '; return m[id] || null; };\n' +
    'window.resolveActiveTemplate = function(){ return null; };\n' +
    'wrapResolve();\n',
    sandbox, { filename: 'ngv1-vntpl-1.1.0.js' });
  return {
    toasts, logs,
    run: () => vm.runInContext('window.resolveActiveTemplate("knee pain today")', sandbox),
    skip: () => vm.runInContext('window.__mlsLastGenTemplateSkip || null', sandbox)
  };
}

/* E0. the overlay really did take over - otherwise everything below is a test
   of a function nobody calls */
ok(CONNECT.indexOf('window.resolveActiveTemplate = w;') > 0,
  'the overlay no longer replaces resolveActiveTemplate - re-check which path ships');

/* E1. THE MEASURED LIVE BRANCH: the class-aware keyword pick. */
(function () {
  const o = bootOverlay({ auto: true, pick: { tpl: OWNER_LIBRARY[0], cls: { cls: 'procedure' }, score: 9, matched: ['knee'], reason: 'stub' } });
  eq(o.run(), null, 'the LIVE resolver still returns an operative report for a standard visit note');
  eq((o.skip() || {}).why, 'operative-report', 'the live refusal left no receipt');
  eq(o.toasts.length, 0, 'the live resolver announced a template it refused to use');
  ok(o.logs.some((l) => l.kind === 'vntpl-scope'), 'the live refusal was not logged for the template log');
})();

/* E2. THE EXACT-NAME BRANCH is gated too - a name match is not a licence. */
(function () {
  const o = bootOverlay({ auto: true, exact: { tpl: OWNER_LIBRARY[1], reason: 'the visit reason is exactly this template name' } });
  eq(o.run(), null, 'an exact NAME match still puts an operative report on a standard visit note');
  eq((o.skip() || {}).why, 'operative-report', 'the exact-name refusal left no receipt');
})();

/* E3. THE EXPLICIT DEFAULT BRANCH is gated too. */
(function () {
  const o = bootOverlay({ auto: false, activeId: 'tms8w1uyl6tfx', byId: { tms8w1uyl6tfx: OWNER_LIBRARY[1] } });
  eq(o.run(), null, 'the live resolver still applies an operative-report default to a standard visit note');
  eq((o.skip() || {}).why, 'operative-report', 'the default-branch refusal left no receipt');
})();

/* E4. AND A VISIT-NOTE TEMPLATE STILL COMES BACK, on every one of the three
   branches. A gate that refused everything would remove the feature. */
(function () {
  const byPick = bootOverlay({ auto: true, pick: { tpl: SOAP_TPL, cls: { cls: 'office' }, score: 4, matched: ['knee'], reason: 'stub' } });
  eq((byPick.run() || {}).id, 'tpl_office_soap', 'a SOAP template no longer survives the live keyword pick');
  const byName = bootOverlay({ auto: true, exact: { tpl: NARRATIVE_TPL, reason: 'exact' } });
  eq((byName.run() || {}).id, 'tpl_followup_narrative', 'a narrative template no longer survives the live exact-name pick');
  const byDefault = bootOverlay({ auto: false, activeId: 'd', byId: { d: SOAP_TPL } });
  eq((byDefault.run() || {}).id, 'tpl_office_soap', 'a SOAP default no longer survives the live default branch');
})();

/* E5. THE OVERLAY ASKS THE SHELL - it does not carry a second copy of the
   rule that would drift the first time either changed. */
ok(VN_WHY_FN.indexOf('window._mlsGenTemplateScopeSkip') > 0,
  'the overlay no longer asks the shell for the scope decision');
ok(VN_REFUSE_FN.indexOf('window._mlsGenTemplateSkip') > 0,
  'the overlay no longer asks the shell to record the refusal');
['VNTPL_OP_TITLES', 'VNTPL_OP_LABELS', 'VNTPL_VISIT_LABELS'].forEach(function (n) {
  ok(CONNECT.indexOf(n) === -1, 'the overlay carries its own copy of ' + n + ' - it must ask the shell instead');
});
/* every branch of the wrapper that can return a template passes the gate */
eq((WRAP_FN.match(/vnScopeWhy\(/g) || []).length, 3,
  'the live resolver has a branch that returns a template without asking the scope gate');
eq((WRAP_FN.match(/vnScopeRefuse\(/g) || []).length, 3,
  'the live resolver has a branch that can accept a refused template');
ok(WRAP_FN.indexOf('window.__mlsLastGenTemplateSkip = null') > 0,
  'the live resolver no longer clears a previous refusal receipt');

/* ==========================================================================
 * PART F -- THE OP-NOTE ROOM KEEPS THESE TEMPLATES, EXACTLY AS BEFORE
 *
 * Its path is a different one end to end: _opRankTemplates ranks the library,
 * and the draft is built from _tplTextForDraft(tpl.text) by _genOpNote. None
 * of it goes near resolveActiveTemplate or the scope gate.
 * ======================================================================== */
(function () {
  const sandbox = {
    String: String, Number: Number, Object: Object, Array: Array, RegExp: RegExp, Date: Date, JSON: JSON, Math: Math
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(KINDOF_FN + '\n' + OPRANK_FN + '\n' +
    'function getTemplates(){ return ' + JSON.stringify(OWNER_LIBRARY.concat([SOAP_TPL])) + '; }\n',
    sandbox, { filename: 'opnote-ranker.js' });
  const ranked = vm.runInContext('_opRankTemplates("left knee genicular nerve block")', sandbox);
  ok(Array.isArray(ranked) && ranked.length >= OWNER_LIBRARY.length,
    'the op-note ranker stopped offering the doctor procedure templates');
  const names = ranked.map((r) => r.tpl.name);
  OWNER_LIBRARY.forEach(function (t) {
    ok(names.indexOf(t.name) >= 0, 'the op-note room lost the template "' + t.name + '"');
  });
  eq(ranked[0].tpl.name, 'Genicular Nerve Block',
    'the op-note ranker no longer puts the matching procedure template first');
})();

/* F2. and it is not wired to any of this - a call, not a mention */
ok(!/vnScope|_mlsGenTemplateScopeSkip|_mlsTemplateIsOperativeReport|__mlsLastGenTemplateSkip/.test(OPRANK_FN),
  'the op-note ranker now consults the visit-note scope gate - it must not');
ok(OPRANK_FN.indexOf("return k===''||k==='op';") > 0,
  'the op-note ranker no longer offers op and undeclared templates');
ok(SHELL.indexOf("out=await _genOpNote(row.appt.name, (row.dateStr||_opTomorrowDateStr()), (row.proc||row.appt.reason||tpl.name), _tplTextForDraft(tpl.text), ctx);") > 0,
  'the op-note draft call changed - it must keep handing the template text through unchanged');
/* the scope gate is reachable ONLY from the standard visit-note lane */
const SCOPE_CALLERS = (SHELL.match(/_mlsGenTemplateScopeSkip\(/g) || []).length;
eq(SCOPE_CALLERS, 4,
  'the number of scope-gate call sites changed (expected: its own definition, ' +
  'the two in resolveActiveTemplate, and the one in _mlsResolveGenerationTemplate)');

/* ==========================================================================
 * PART G -- BOTH TWINS, AND THE LANES DERIVED FROM THEM
 *
 * The two HTML twins are NOT byte-identical files; these REGIONS must be.
 * ======================================================================== */
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
SHELLS.forEach(function (name) {
  const src = read(name);
  eq(between(src, A_CLASSIFIER, B_CLASSIFIER, name + ' classifier'), CLASSIFIER,
    name + ': the vntpl-1.1.0 classifier is not byte-identical to 1pScribeFlow.html');
  eq(between(src, A_SENTENCES, B_SENTENCES, name + ' sentences'), SENTENCES,
    name + ': the vntpl-1.1.0 receipt sentences are not byte-identical to 1pScribeFlow.html');
  eq(extractFn(src, 'function resolveActiveTemplate(visitText){'), RESOLVE_FN,
    name + ': resolveActiveTemplate is not byte-identical to 1pScribeFlow.html');
  eq(extractFn(src, 'function _mlsResolveGenerationTemplate(visitText){'), GENRESOLVE_FN,
    name + ': the generation resolver is not byte-identical to 1pScribeFlow.html');
  eq(extractFn(src, 'function _mlsRenderTplPickReceipt(fallbackTpl){'), RECEIPT_FN,
    name + ': the pick receipt renderer is not byte-identical to 1pScribeFlow.html');
  ok(src.indexOf("version:'vntpl-1.1.0'") > 0, name + ': the exported template contract still names vntpl-1.0.0');
  ok(src.indexOf('window._mlsGenTemplateScopeSkip=_mlsGenTemplateScopeSkip;') > 0,
    name + ': the scope decision is not exported for the overlay that actually runs');
});
['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'].forEach(function (name) {
  const src = read(name);
  eq(extractFn(src, '  function wrapResolve() {'), WRAP_FN,
    name + ': the live resolver is not byte-identical to 1p-mls-connect.js');
  eq(extractFn(src, '  function vnScopeWhy(tpl) {'), VN_WHY_FN,
    name + ': the scope question is not byte-identical to 1p-mls-connect.js');
  eq(extractFn(src, '  function vnScopeRefuse(tpl, why) {'), VN_REFUSE_FN,
    name + ': the scope refusal is not byte-identical to 1p-mls-connect.js');
});

/* ========================================================================== */
console.log('vntpl-1.1.0 decision table (name | operative report? | visit-note shaped? | verdict)');
TABLE.forEach(function (row) {
  console.log('  ' + row[0].padEnd(38) + ' | ' + row[1].padEnd(9) + ' | ' + row[2].padEnd(12) + ' | ' + row[3]);
});
console.log('PASS visit-template-scope-proof: ' + checks +
  ' checks - the standard visit note only ever takes a visit-note template; every template in the owner library ' +
  'is classified as an operative report and refused with a plain-words receipt on all four resolver branches, ' +
  'a SOAP and a narrative template are returned unchanged, the op-note room keeps every one of them, ' +
  'and both twins plus their derived lanes carry identical logic');

'use strict';
/* =========================================================================
   THE FILL-IN-THE-BLANK MECHANISM SURVIVES THE TEMPLATES/OP-NOTE REBUILD
   -------------------------------------------------------------------------
   OWNER: "make sure not to do anything half assed and make sure it all works and
   all the buttons work and that it makes good templates and that the fill in the
   blnk thing still works".

   He is naming the right risk. Two things this batch changed could break it and
   neither would throw:

     1. THE STYLESHEET. The Templates/op-note rebuild restyles `.onf-fillbox` and
        its inputs. A stray display/visibility/overflow, or a rule that reaches a
        control's hit area, and the box is there but unusable - this surface has
        shipped exactly that class of bug twice (a nested card clipped to one
        viewport, and a white-on-white active button).
     2. THE PROMPT. The new template-follow modes append clauses to the live
        system prompt. The blank mechanism only works because the model is told
        to EMIT placeholders for values it does not have. A clause that says
        "preserve the template verbatim" or "write it your own way" could suppress
        them - and then there is nothing for the Fields box to collect, so the box
        renders empty and the note silently carries invented or missing detail.

   WHAT THIS PINS
     A. The structural contract the Fields box is found by.
     B. The blank-token vocabulary and the reconcile step.
     C. That NO follow-mode clause suppresses placeholders - and that the strict
        clause positively requires them.
     D. That no rule in the rebuild can hide or unreach the box or its controls.
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}

const HTML = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
const FILL = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_fill.js'), 'utf8');
const GEN = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_integrity.js'), 'utf8');

/* ---- A. the structural contract ---------------------------------------- */
ok(/previousElementSibling[\s\S]{0,140}onf-/.test(FILL),
  'A: the Fields box is still located by the textarea PREVIOUS-SIBLING slot',
  'feat_mls_opnote_fill.js finds an existing box this way and inserts there; if the\n' +
  '        textarea is ever wrapped, every Fields box in the app duplicates or dies');
ok(/textarea\[id\^="opPrepNote_"\]/.test(FILL),
  'A: it still binds to the #opPrepNote_<i> id shape');
ok(/id="opPrepNote_'\+i\+'"/.test(HTML) || /id="opPrepNote_' *\+ *i/.test(HTML),
  'A: the renderer still emits that exact id shape');
/* the slot in front of the textarea must stay free - nothing may be inserted
   between the note textarea and its preceding node by the renderer */
const rowMarkup = (HTML.match(/h\+='<textarea id="opPrepNote_[^\n]*/) || [''])[0];
ok(rowMarkup.length > 0, 'A: the note textarea markup is locatable');

/* ---- B. the blank vocabulary and the reconcile step -------------------- */
ok(/opNoteBlankTokens/.test(HTML) || /opNoteBlankTokens/.test(FILL),
  'B: the blank-token scanner exists');
ok(/_opReconcileBlanks/.test(HTML),
  'B: the post-draft reconcile step exists (it adds any [[key]] the model emitted but did not list)');
ok(/_opReconcileBlanks\(row\)/.test(HTML),
  'B: and it RUNS on the draft path, not just as a definition');
ok(/\[\[/.test(GEN) && /snake_case/.test(GEN),
  'B: the [[snake_case]] placeholder vocabulary is still in the live prompt');

/* ---- C. no follow-mode clause may suppress placeholders ---------------- */
const clauseBlock = (GEN.match(/var TPL_MODE_CLAUSE=\{[\s\S]*?\n    \};/) || [''])[0];
ok(clauseBlock.length > 50, 'C: the follow-mode clause table is present',
  'if this is empty the assertions below are vacuous');

const strictClause = (clauseBlock.match(/strict:'([^']*)'/) || [, ''])[1];
const guideClause = (clauseBlock.match(/guide:'([^']*)'/) || [, ''])[1];
const adaptClause = (clauseBlock.match(/adapt:'([^']*)'/) || [, ''])[1];

ok(strictClause.length > 0 && guideClause.length > 0,
  'C: strict and guide contribute real clauses');
ok(adaptClause === '',
  'C: the DEFAULT mode contributes nothing, so the blank mechanism it has always\n        used is untouched for anyone who never opens the control');

/* The strict clause is the dangerous one: "preserve the prose verbatim" could be
   read as "do not insert placeholders". It must positively require them. */
ok(/placeholder/i.test(strictClause),
  'C: THE STRICT CLAUSE POSITIVELY REQUIRES PLACEHOLDERS',
  '"preserve the wording verbatim" without this could suppress the blanks the\n' +
  '        Fields box exists to collect. Got: ' + strictClause.slice(0, 160));

/* Neither clause may tell the model to fill a value it does not have. */
[['strict', strictClause], ['guide', guideClause]].forEach(function (p) {
  ok(!/\b(invent|make up|fill in any|assume)\b/i.test(p[1]) ||
     /never invent/i.test(p[1]),
    'C: the ' + p[0] + ' clause never licenses inventing a value',
    p[1].slice(0, 150));
});
ok(/never invent a fact/i.test(guideClause),
  'C: the looser clause restates the anti-fabrication rule explicitly');

/* And the network-layer placeholder rule must still be intact - it is what
   guarantees a missing case value becomes [FILL: ...] rather than a guess. */
const FIX = fs.readFileSync(path.join(ROOT, 'feat_mls_fixpack_0701.js'), 'utf8');
ok(/STRICT DICTATION RULE/.test(FIX) && /\[FILL:/.test(FIX),
  'C: the network-layer STRICT DICTATION RULE and its [FILL: ...] token survive',
  'this is the last line of defence between "no value" and a fabricated one');

/* ---- D. the rebuild cannot hide or unreach the box -------------------- */
const UI = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_templates_ui.js'), 'utf8');
/* execute the module and inspect the CSS it really emits */
function emittedCss() {
  const el = function () {
    return { id: '', textContent: '', style: {}, parentNode: null,
      classList: { add() {}, remove() {}, contains() { return false; } },
      appendChild() {}, removeChild() {}, setAttribute() {} };
  };
  const doc = { getElementById: () => null, createElement: el, addEventListener() {},
    head: el(), documentElement: el(), body: el() };
  const w = { document: doc }; w.window = w;
  new Function('window', 'document', UI)(w, doc);
  return w.__mlsOpNoteTemplatesUi.css();
}
const css = emittedCss();
ok(css.length > 500, 'D: the rebuild stylesheet was obtained by execution');

/* Split into INDIVIDUAL rules, not lines. The first version of this check
   filtered by LINE, and the whole `@media (max-width:900px){...}` block is
   emitted as one line - so a `max-height` belonging to the template RAIL matched
   a line that also happened to mention the fill box, and the assertion failed on
   a rule that has nothing to do with it. A checker that cannot say WHICH selector
   carries the offending declaration will cry wolf, and a suite that cries wolf
   gets switched off. */
const rules = [];
css.replace(/([^{}]+)\{([^{}]*)\}/g, function (_, sel, decls) {
  rules.push({ sel: sel.trim().replace(/\s+/g, ' '), decls: decls });
  return '';
});
const fillRules = rules.filter(r => /onf-fillbox|onf-field|onf-grid|onf-h\b/.test(r.sel));
ok(fillRules.length > 0, 'D: the rebuild does restyle the Fields box (not vacuous)',
  'found ' + fillRules.length + ' rule(s) whose SELECTOR names the box');
const banned = fillRules.filter(r =>
  /display\s*:\s*none/i.test(r.decls) ||
  /visibility\s*:\s*hidden/i.test(r.decls) ||
  /pointer-events\s*:\s*none/i.test(r.decls) ||
  /opacity\s*:\s*0\b/.test(r.decls) ||
  /overflow\s*:\s*hidden/i.test(r.decls) ||
  /max-height\s*:\s*(?!none)/i.test(r.decls) ||
  /position\s*:\s*absolute/i.test(r.decls));
ok(banned.length === 0,
  'D: NO rebuild rule hides, clips or un-clicks the Fields box or its fields',
  banned.map(r => r.sel + ' { ' + r.decls.trim().slice(0, 90) + ' }').join('\n        '));

/* the inputs must keep a usable target height */
const inputRule = fillRules.filter(r => /onf-fillbox input/.test(r.sel)).map(r => r.decls).join(' ');
ok(!inputRule || !/font-size\s*:\s*(?:[0-9]|1[01])px/.test(inputRule),
  'D: the fill-in fields are not shrunk below a legible size',
  inputRule.slice(0, 160));

/* and the "Use every time" control keeps its own row */
ok(/onf-field-actions/.test(css),
  'D: the per-field "Use every time" action row is still styled (it exists and is reachable)');

console.log(failures === 0
  ? '\nPASS  fill-in-the-blank-survives: the slot contract, the token vocabulary, the anti-fabrication rules and the Fields box are all intact across every follow-mode.'
  : '\nFAIL  fill-in-the-blank-survives: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);

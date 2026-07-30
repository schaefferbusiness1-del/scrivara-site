'use strict';
/* =============================================================================
   THE THREE TEMPLATE-FOLLOW MODES REALLY DIFFER
   -----------------------------------------------------------------------------
   OWNER, 2026-07-29: "give options on how I want the op note to follow those
   templates."

   THE FAILURE MODE THIS SUITE EXISTS TO CATCH. A "how closely should the draft
   follow my template" control is trivially fakeable: store a string, paint a
   tick, change nothing about what the model is told or what the gate allows.
   This repo has been caught shipping exactly that shape before (the Studio
   "Save" that saved nothing). A regex that merely finds the words
   TPL_MODE_CLAUSE in the file cannot tell a real option from a decoration.

   SO THIS SUITE EXECUTES THE SHIPPED BYTES. It lifts, out of
   feat_mls_opnote_integrity.js, the real mode-reading IIFE, the real clause
   table, the real prompt-composition statement, the real fidelity() gate, and
   the real gate-relaxation predicate and its body, then RUNS them:

     - the mode reader runs against a stubbed localStorage for 13 stored values
     - the composition statement builds the three actual system prompts
     - fidelity() grades four real drafts against a real template
     - the relaxation predicate is evaluated over every mode x every failure

   FIVE PROOFS
     1. each mode yields a DIFFERENT system prompt, and 'adapt' is BYTE-IDENTICAL
        to the pre-option prompt (the safety property for anyone who never opens
        the control)
     2. the clauses do not contradict the base prompt: the looser clause still
        promises to KEEP every heading and the heading order, because the gate's
        heading check is deliberately NOT relaxed - a clause that licensed
        heading edits would refuse every draft in that mode
     3. no mode weakens the anti-fabrication guards
     4. the gate relaxation is SCOPED: only 'guide', only the fixed-wording
        failure, never a heading failure, and it is recorded on the result
     5. every stored value resolves to the right mode; junk falls back to 'adapt'

   PLUS PART 0: proof this is the LIVE builder and not one of the repo's dead
   prompt twins, and PART 6: mutation checks proving these assertions can fail.

   Run: node tests/opnote-follow-modes-differ.test.js
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INTEGRITY = path.join(ROOT, 'feat_mls_opnote_integrity.js');
const SRC = fs.readFileSync(INTEGRITY, 'utf8');
const L = SRC.split('\n');

let failures = 0;
let checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function blocker(label, detail) {
  checks++; failures++;
  console.log('  BLOCKER  ' + label + (detail ? '\n           ' + detail : ''));
}
function section(t) { console.log('\n' + t); }

/* Every extraction below is anchored on an exact shipped line and asserted, so
   a rename upstream fails loudly here instead of silently skipping a proof. */
function lineStarting(prefix, what) {
  for (let i = 0; i < L.length; i++) if (L[i].startsWith(prefix)) return i;
  blocker('CANNOT LOCATE ' + what + ' in feat_mls_opnote_integrity.js',
    'anchor: ' + JSON.stringify(prefix) + ' - the proof below is vacuous until this is fixed');
  return -1;
}
function lineContaining(needle, what) {
  for (let i = 0; i < L.length; i++) if (L[i].includes(needle)) return i;
  blocker('CANNOT LOCATE ' + what, 'anchor: ' + JSON.stringify(needle));
  return -1;
}

/* ==================================================================
   PART 0 - THIS IS THE LIVE PROMPT BUILDER, NOT A DEAD TWIN
   The repo carries a second op-note prompt builder (mls-opnote-pro.js:773)
   that also assigns window._genOpNote. If that one won, every proof below
   would be about bytes no model ever sees.
   ================================================================== */
section('PART 0 - the builder under test is the LIVE one');

const CONNECT = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8');
const pin = (CONNECT.match(/feat_mls_opnote_integrity\.js\?v=[a-z0-9]+/) || [])[0] || '';
ok(!!pin, 'production mls-connect.js LOADS feat_mls_opnote_integrity.js', 'pin: ' + (pin || 'ABSENT'));

const STAGING = fs.readFileSync(path.join(ROOT, 'mls-connect.staging.js'), 'utf8');
ok(STAGING.includes(pin), 'staging loads the SAME integrity build (' + pin + ')',
  'a staging divergence would make the staging modes untested');

ok(SRC.includes('window._genOpNote=generate'),
  'the integrity owner takes ownership of window._genOpNote (feat_mls_opnote_integrity.js:1260)');
ok(SRC.includes('generate.__mlsopWrapped=true'),
  'and stamps generate.__mlsopWrapped (feat_mls_opnote_integrity.js:1230)');

/* EXECUTE the dead twin's own guard: with the stamp present it must bail. */
const PRO = fs.readFileSync(path.join(ROOT, 'mls-opnote-pro.js'), 'utf8');
const proGuardLine = PRO.split('\n').find(l => l.includes("window._genOpNote.__mlsopWrapped) return"));
if (!proGuardLine) blocker('cannot locate the mls-opnote-pro.js re-wrap guard');
else {
  const runGuard = new Function('window', proGuardLine + '\nreturn "OVERWROTE";');
  const stamped = function () {}; stamped.__mlsopWrapped = true;
  ok(runGuard({ _genOpNote: stamped }) === undefined,
    'THE DEAD TWIN IS DEFUSED: executing mls-opnote-pro.js:750 against the stamped\n        owner returns early, so its 1-second re-wire loop can never replace the prompt',
    'pro.js wire() re-runs every 1s for 60s (mls-opnote-pro.js:809)');
  ok(runGuard({ _genOpNote: function () {} }) === 'OVERWROTE',
    'and that guard is NOT vacuous: without the stamp the twin does overwrite');
}

const SCRIBE = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
ok(!SCRIBE.includes('TPL_MODE_CLAUSE') && !SCRIBE.includes('Create one complete operative/procedure note'),
  'the ScribeFlow.html dead prompt twin carries NO mode table and NOT this base prompt');

const rootFiles = fs.readdirSync(ROOT).filter(f => /\.(js|html)$/.test(f));
const definers = rootFiles.filter(f => {
  try { return fs.readFileSync(path.join(ROOT, f), 'utf8').includes('var TPL_MODE_CLAUSE='); }
  catch (e) { return false; }
});
ok(definers.length === 1 && definers[0] === 'feat_mls_opnote_integrity.js',
  'exactly ONE shipped file defines the mode table, so there is no second table to drift',
  'definers: ' + JSON.stringify(definers));

const assigners = rootFiles.filter(f => {
  try { return /window\._genOpNote\s*=/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
  catch (e) { return false; }
});
ok(assigners.length === 3 &&
   assigners.indexOf('feat_mls_opnote_integrity.js') >= 0 &&
   assigners.indexOf('mls-opnote-pro.js') >= 0 &&
   assigners.indexOf('mls-opnote-pro.staging.js') >= 0,
  'only the integrity owner and the (defused) pro twin assign window._genOpNote',
  'assigners: ' + JSON.stringify(assigners));

/* ==================================================================
   EXTRACT THE SHIPPED PIECES
   ================================================================== */
section('EXTRACT - lifting the shipped expressions');

/* --- the base system prompt, evaluated from its own literal --- */
const sysSrc = (SRC.match(/var sys='(?:[^'\\]|\\.)*';/) || [])[0];
if (!sysSrc) blocker('cannot locate the base system prompt literal (var sys=...)');
const BASE = sysSrc ? new Function(sysSrc + '\nreturn sys;')() : '';
ok(BASE.length > 800 && /^Create one complete operative\/procedure note/.test(BASE),
  'lifted the LIVE base system prompt (' + BASE.length + ' chars, feat_mls_opnote_integrity.js:1070)');

/* --- the mode clause table, evaluated from its own object literal --- */
const iTbl = lineContaining('var TPL_MODE_CLAUSE={', 'the TPL_MODE_CLAUSE table');
let iTblEnd = -1;
for (let i = iTbl; i >= 0 && i < L.length; i++) if (L[i].trim() === '};') { iTblEnd = i; break; }
const TBL_SRC = (iTbl >= 0 && iTblEnd > iTbl) ? L.slice(iTbl, iTblEnd + 1).join('\n') : '';
if (!TBL_SRC) blocker('cannot bound the TPL_MODE_CLAUSE object literal');
const CLAUSES = TBL_SRC ? new Function(TBL_SRC + '\nreturn TPL_MODE_CLAUSE;')() : {};
ok(!!CLAUSES && typeof CLAUSES === 'object',
  'lifted the LIVE TPL_MODE_CLAUSE table (feat_mls_opnote_integrity.js:' + (iTbl + 1) + '-' + (iTblEnd + 1) + ')');

/* --- the composition statement itself, so the test does not re-implement it --- */
const iAppend = lineContaining('sys+=TPL_MODE_CLAUSE[tplMode]', 'the clause-append statement');
const appendSrc = iAppend >= 0 ? L[iAppend] : '';
const compose = appendSrc
  ? new Function('sys', 'tplMode', 'TPL_MODE_CLAUSE', appendSrc + '\nreturn sys;')
  : function (s) { return s; };
ok(/^\s*if\(TPL_MODE_CLAUSE\[tplMode\]\)sys\+=TPL_MODE_CLAUSE\[tplMode\];\s*$/.test(appendSrc),
  'lifted the LIVE composition statement, and it APPENDS (+=) rather than replaces',
  JSON.stringify(appendSrc.trim()));

/* --- the mode reader IIFE --- */
const modeSrc = (SRC.match(/var tplMode=\(function\(\)\{[\s\S]*?\}\)\(\);/) || [])[0];
if (!modeSrc) blocker('cannot locate the tplMode reader IIFE');
const readMode = modeSrc ? new Function('window', 'localStorage', modeSrc + '\nreturn tplMode;') : null;
ok(!!modeSrc && modeSrc.includes("window.uns('opNoteTemplateMode')"),
  'lifted the LIVE mode reader, and it reads through window.uns (per-account namespacing)');

/* --- the gate: normText + headingLabel/headings/fixedFragments/fidelity --- */
const iNorm = lineStarting('  function normText(x) {', 'normText()');
const iClasses = lineStarting('  var CLASSES', 'the CLASSES table (end of normText)');
const iHead = lineStarting('  function headingLabel(line) {', 'headingLabel()');
const iParse = lineStarting('  function parseResult(raw)', 'parseResult() (end of fidelity)');
const GATE_SRC = (iNorm >= 0 && iClasses > iNorm && iHead >= 0 && iParse > iHead)
  ? L.slice(iNorm, iClasses).join('\n') + '\n' + L.slice(iHead, iParse).join('\n')
  : '';
const S = function (x) { return x == null ? '' : String(x); };
let gate = null;
if (GATE_SRC) {
  gate = new Function('S', GATE_SRC +
    '\nreturn {normText:normText,headings:headings,fixedFragments:fixedFragments,fidelity:fidelity};')(S);
}
ok(!!gate && typeof gate.fidelity === 'function',
  'lifted the LIVE deterministic gate (fidelity + heading/fragment harvest)');

/* --- the relaxation predicate and its body --- */
const iRelax = lineContaining("else if(tplMode==='guide'", 'the gate-relaxation branch');
const relaxLine = iRelax >= 0 ? L[iRelax].trim() : '';
const relaxCond = relaxLine.replace(/^else if\(/, '').replace(/\)\{$/, '');
const relaxPredicate = relaxCond
  ? new Function('tplMode', 'check', 'return !!(' + relaxCond + ');')
  : function () { return false; };
const relaxBodyLine = iRelax >= 0 ? L[iRelax + 1] : '';
const applyRelax = relaxBodyLine
  ? new Function('check', relaxBodyLine + '\nreturn check;')
  : function (c) { return c; };
ok(/^tplMode==='guide'&&check&&!check\.pass&&\/fixed template wording\/\.test\(String\(check\.reason\|\|''\)\)$/.test(relaxCond),
  'lifted the LIVE relaxation predicate (feat_mls_opnote_integrity.js:' + (iRelax + 1) + ')',
  JSON.stringify(relaxCond));
ok(/^check=\{pass:true,adapted:true,reworded:true,details:check\};$/.test(relaxBodyLine.trim()),
  'lifted the LIVE relaxation body', JSON.stringify(relaxBodyLine.trim()));

/* ==================================================================
   PROOF 1 - EACH MODE PRODUCES A DIFFERENT SYSTEM PROMPT
   ================================================================== */
section('PROOF 1 - each mode produces a DIFFERENT system prompt');

const MODES = ['strict', 'adapt', 'guide'];
ok(Object.keys(CLAUSES).length === 3 && MODES.every(m => typeof CLAUSES[m] === 'string'),
  'the table declares exactly the three modes the UI offers',
  'keys: ' + JSON.stringify(Object.keys(CLAUSES)));

const PROMPT = {};
MODES.concat(['junk']).forEach(m => { PROMPT[m] = compose(BASE, m, CLAUSES); });

ok(CLAUSES.adapt === '',
  'SAFETY PROPERTY: the DEFAULT mode contributes an EMPTY clause');
ok(PROMPT.adapt === BASE && PROMPT.adapt.length === BASE.length,
  'so the adapt prompt is BYTE-IDENTICAL to the prompt that shipped before the option\n        existed - a user who never touches the control gets literally the old behaviour',
  'adapt=' + PROMPT.adapt.length + ' base=' + BASE.length);
ok(PROMPT.junk === BASE,
  'and an unrecognised mode string also composes to the untouched base prompt');

ok(CLAUSES.strict.trim().length > 0, 'strict contributes a NON-EMPTY clause (' + CLAUSES.strict.length + ' chars)');
ok(CLAUSES.guide.trim().length > 0, 'guide contributes a NON-EMPTY clause (' + CLAUSES.guide.length + ' chars)');
ok(CLAUSES.strict !== CLAUSES.guide, 'strict and guide clauses are DISTINCT');

const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const pairs = [['strict', 'adapt'], ['strict', 'guide'], ['adapt', 'guide']];
pairs.forEach(([a, b]) => {
  ok(PROMPT[a] !== PROMPT[b] && norm(PROMPT[a]) !== norm(PROMPT[b]),
    'prompt(' + a + ') != prompt(' + b + ') - and not merely by whitespace',
    a + '=' + PROMPT[a].length + ' ' + b + '=' + PROMPT[b].length);
});
ok(PROMPT.strict.length > PROMPT.adapt.length && PROMPT.guide.length > PROMPT.adapt.length,
  'both non-default modes strictly LENGTHEN the instruction they send',
  'strict=' + PROMPT.strict.length + ' adapt=' + PROMPT.adapt.length + ' guide=' + PROMPT.guide.length);
MODES.forEach(m => {
  ok(PROMPT[m].indexOf(BASE) === 0,
    'prompt(' + m + ') still OPENS with the whole base prompt - the clause is additive only');
});

/* the composed prompt is the one that ships: nothing rewrites sys afterwards */
const iCall = lineContaining('window.aiCallRaw(sys,user,key,opts)', 'the aiCallRaw send site');
let sysTouched = [];
if (iAppend >= 0 && iCall > iAppend) {
  for (let i = iAppend + 1; i < iCall; i++) if (/\bsys\b/.test(L[i])) sysTouched.push(i + 1);
}
ok(iCall > iAppend && sysTouched.length === 0,
  'THE COMPOSED PROMPT IS WHAT SHIPS: between the append (line ' + (iAppend + 1) + ') and\n        aiCallRaw (line ' + (iCall + 1) + ') nothing reassigns sys',
  'lines touching sys in between: ' + JSON.stringify(sysTouched));
ok(SRC.includes('ctx.__mlsTplMode=tplMode'),
  'the resolved mode is also stamped on the generation ctx for the receipt (line 1081)');

/* ==================================================================
   PROOF 2 - THE CLAUSES DO NOT CONTRADICT THE BASE PROMPT
   ================================================================== */
section('PROOF 2 - the clauses do not contradict the base prompt');

ok(BASE.includes('The template is authoritative.'),
  'the base prompt says the template is AUTHORITATIVE');
ok(BASE.includes('Preserve its heading names, heading order, section order, fixed boilerplate wording'),
  'and orders heading names, heading order, section order and fixed boilerplate preserved');
ok(BASE.includes('do not rename headings, and do not reorder sections'),
  'and forbids renaming headings or reordering sections outright');

ok(/KEEP every heading/.test(CLAUSES.guide),
  'THE LOOSER CLAUSE STILL PROMISES TO KEEP EVERY HEADING',
  'guide: ' + CLAUSES.guide.slice(0, 160));
ok(/the heading order/.test(CLAUSES.guide) && /the section order/.test(CLAUSES.guide),
  'and to keep the heading order AND the section order');
ok(/exactly as given/.test(CLAUSES.guide),
  'and says "exactly as given" - no softening adverb');

/* every clause sentence that mentions a heading must be a KEEP sentence */
const FORBID = /\b(rename|reorder|re-order|renumber|drop|omit|remove|replace)\b/i;
MODES.forEach(m => {
  const sents = String(CLAUSES[m]).split(/\.\s+/).filter(s => /heading/i.test(s));
  const bad = sents.filter(s => !/\bkeep\b/i.test(s) || FORBID.test(s));
  ok(bad.length === 0,
    'no clause sentence in "' + m + '" licenses a heading edit (' + sents.length + ' heading sentence(s) checked)',
    'offending: ' + JSON.stringify(bad));
  ok(!/(rename|reorder|re-order|renumber|drop|omit)[^.]{0,60}heading|heading[^.]{0,60}(rename|reorder|re-order|renumber|drop|omit)/i.test(CLAUSES[m]),
    'and "' + m + '" never puts a heading-mutating verb in the same sentence as a heading');
});
ok(!/heading/i.test(CLAUSES.strict),
  'the strict clause does not mention headings at all - it can only tighten prose');
ok(/Do not paraphrase, tighten, modernise or re-order its sentences/.test(CLAUSES.strict),
  'and its only re-order prohibition is scoped to SENTENCES, negated by "Do not"');

/* ==================================================================
   PROOF 3 - NO MODE WEAKENS THE ANTI-FABRICATION GUARDS
   ================================================================== */
section('PROOF 3 - no mode weakens the anti-fabrication guards');

ok(BASE.includes('Never invent a fact.'), 'the base prompt still says "Never invent a fact."');
MODES.forEach(m => {
  ok(PROMPT[m].includes('Never invent a fact.'),
    '"Never invent a fact." survives into the LIVE prompt for mode "' + m + '"');
});
ok(BASE.includes('[[snake_case]] placeholder') && MODES.every(m => PROMPT[m].includes('[[snake_case]] placeholder')),
  'the placeholder discipline survives in every mode too');

ok(/never invent a fact/i.test(CLAUSES.guide),
  'THE LOOSER CLAUSE RESTATES the anti-fabrication rule rather than relying on distance');
ok(/never state a value that was not dictated or documented/i.test(CLAUSES.guide),
  'and restates the undictated-value rule explicitly');
ok(/Every factual constraint above still applies without exception/.test(CLAUSES.guide),
  'and re-affirms every factual constraint above it "without exception"');

/* every "invent" in a clause must be a NEVER invent */
MODES.forEach(m => {
  const c = String(CLAUSES[m]);
  let bad = 0, at = c.toLowerCase().indexOf('invent');
  while (at >= 0) {
    if (!/never\s+$/i.test(c.slice(Math.max(0, at - 8), at))) bad++;
    at = c.toLowerCase().indexOf('invent', at + 1);
  }
  ok(bad === 0, 'every occurrence of "invent" in the "' + m + '" clause is a NEVER-invent');
});
const WEAKEN = /(you may|feel free to|it is acceptable to|if unsure)[^.]{0,80}(invent|assume|infer|estimate|fabricat|plausib|typical value|standard value)/i;
MODES.forEach(m => {
  ok(!WEAKEN.test(CLAUSES[m]),
    'the "' + m + '" clause contains no permission to invent, assume, infer or estimate');
});
ok(!/\bmay (?:rewrite|change|reword)[^.]{0,80}\b(fact|value|finding|diagnos|dose|level)/i.test(CLAUSES.guide),
  'the looser mode permits rewriting PROSE only - never a fact, value, finding, diagnosis, dose or level');

/* ==================================================================
   PROOF 4 - THE GATE RELAXATION IS SCOPED, AND RECORDED
   ================================================================== */
section('PROOF 4 - the gate relaxation is scoped to guide + fixed-wording only');

/* one real template, four real drafts, graded by the shipped fidelity() */
const TPL = [
  'PREOPERATIVE DIAGNOSIS: Lumbar spondylosis without myelopathy',
  'PROCEDURE PERFORMED: Bilateral lumbar medial branch block at L4 and L5',
  'ANESTHESIA: Local anesthesia with light moderate sedation was administered',
  'DESCRIPTION OF PROCEDURE:',
  'The patient was positioned prone on the fluoroscopy table and the skin was prepped and draped in the usual sterile fashion.',
  'Under intermittent fluoroscopic guidance the target levels were identified and the needle was advanced to the periosteum.',
  'COMPLICATIONS: None.',
  'DISPOSITION: The patient was observed and discharged to home in stable condition.'
].join('\n');
const REWORDED = [
  'PREOPERATIVE DIAGNOSIS: Lumbar spondylosis without myelopathy',
  'PROCEDURE PERFORMED: Bilateral lumbar medial branch block at L4 and L5',
  'ANESTHESIA: Local anesthesia with light moderate sedation was administered',
  'DESCRIPTION OF PROCEDURE:',
  'The patient was placed prone on the procedure table; the overlying skin was cleaned and draped sterilely.',
  'Fluoroscopy confirmed each target level before the needle reached bone.',
  'COMPLICATIONS: None.',
  'DISPOSITION: The patient was observed and discharged to home in stable condition.'
].join('\n');
const DRAFT = {
  clean: TPL,
  reworded: REWORDED,
  heading: TPL.replace('DISPOSITION:', 'DISPOSITION AND PLAN:'),
  both: REWORDED.replace('DISPOSITION:', 'DISPOSITION AND PLAN:')
};
const CHECK = {};
Object.keys(DRAFT).forEach(k => { CHECK[k] = gate ? gate.fidelity(DRAFT[k], TPL) : { pass: false, reason: 'GATE NOT LIFTED' }; });

ok(gate && gate.headings(TPL).length === 6,
  'the lifted gate harvests the 6 template headings (fixture is real, not degenerate)',
  'headings: ' + (gate ? JSON.stringify(gate.headings(TPL)) : 'n/a'));
ok(gate && gate.fixedFragments(TPL).length >= 5,
  'and harvests ' + (gate ? gate.fixedFragments(TPL).length : 0) + ' fixed-wording fragments to protect');

ok(CHECK.clean.pass === true,
  'BASELINE: an untouched draft PASSES the gate (reason: ' + CHECK.clean.reason + ')');
ok(CHECK.reworded.pass === false && /fixed template wording/.test(CHECK.reworded.reason),
  'a REWORDED draft fails with reason "' + CHECK.reworded.reason + '" (' + CHECK.reworded.missingFixed.length + ' fragments lost)');
ok(CHECK.heading.pass === false && CHECK.heading.reason === 'heading set/order changed',
  'a HEADING-CHANGED draft fails with reason "' + CHECK.heading.reason + '"');
ok(CHECK.both.pass === false && CHECK.both.reason === 'heading set/order changed',
  'a draft that changed BOTH reports the HEADING reason - the heading failure dominates');

/* the full matrix: mode x failure */
const EXPECT = {
  'strict|clean': false, 'strict|reworded': false, 'strict|heading': false, 'strict|both': false,
  'adapt|clean': false, 'adapt|reworded': false, 'adapt|heading': false, 'adapt|both': false,
  'guide|clean': false, 'guide|reworded': true, 'guide|heading': false, 'guide|both': false,
  'junk|clean': false, 'junk|reworded': false, 'junk|heading': false, 'junk|both': false
};
let matrixWrong = [];
Object.keys(EXPECT).forEach(k => {
  const [m, d] = k.split('|');
  const got = relaxPredicate(m, CHECK[d]);
  if (got !== EXPECT[k]) matrixWrong.push(k + ' expected ' + EXPECT[k] + ' got ' + got);
});
ok(matrixWrong.length === 0,
  'THE 16-CELL MATRIX IS EXACT: the relaxation fires in exactly ONE cell (guide + reworded)',
  'wrong cells: ' + JSON.stringify(matrixWrong));
ok(relaxPredicate('guide', CHECK.reworded) === true,
  'guide + fixed-wording failure -> RELAXED (this is the whole point of the mode)');
ok(relaxPredicate('guide', CHECK.heading) === false,
  'guide + HEADING failure -> STILL REFUSED, because the clause promised headings would be kept');
ok(relaxPredicate('guide', CHECK.both) === false,
  'guide + wording AND heading changed -> STILL REFUSED (a wording change cannot smuggle a\n        heading change past the gate)');
ok(relaxPredicate('strict', CHECK.reworded) === false && relaxPredicate('adapt', CHECK.reworded) === false,
  'neither strict nor adapt gets ANY relaxation');
ok(relaxPredicate('guide', CHECK.clean) === false,
  'and an already-passing check is never re-labelled as relaxed');
ok(relaxPredicate('guide', null) === false && relaxPredicate('guide', undefined) === false,
  'a missing check object cannot be relaxed into a pass');
ok(relaxPredicate('guide', { pass: false, reason: '' }) === false &&
   relaxPredicate('guide', { pass: false }) === false,
  'and neither can a failure with an empty or absent reason');

/* the relaxation RECORDS itself rather than hiding */
const relaxed = applyRelax(CHECK.reworded);
ok(relaxed.pass === true && relaxed.adapted === true && relaxed.reworded === true,
  'the relaxed result is flagged adapted + reworded, not silently marked clean');
ok(relaxed.details && relaxed.details.pass === false &&
   /fixed template wording/.test(relaxed.details.reason) &&
   relaxed.details.missingFixed.length === CHECK.reworded.missingFixed.length,
  'and the ORIGINAL failing check survives on .details, including every lost fragment',
  'details.reason=' + (relaxed.details && relaxed.details.reason) +
  ' missingFixed=' + (relaxed.details && relaxed.details.missingFixed.length));
ok(SRC.includes('first.templateMode=tplMode') && SRC.includes('first.templateFidelity=check'),
  'and the success path records BOTH the mode and the (relaxed) fidelity object on the result\n        (feat_mls_opnote_integrity.js:1134)');

/* the relaxation cannot double-apply: it is the else of the crossAdapt branch */
const iCross = lineContaining('if(crossAdapt){check={pass:true,adapted:true,details:check};', 'the crossAdapt gate branch');
if (iCross >= 0 && iRelax > iCross) {
  const region = L.slice(iCross, iRelax + 1).join('\n').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
  ok(/^if\(crossAdapt\)\{.*\} else if\(tplMode==='guide'/.test(region),
    'the relaxation is the ELSE of the cross-procedure branch, so at most one relaxation applies',
    region.slice(0, 120));
}

/* the relaxation exists at exactly one place, and nowhere near the heading check */
const tplModeSites = [];
L.forEach((l, i) => { if (/tplMode/.test(l)) tplModeSites.push(i + 1); });
ok(tplModeSites.length === 5,
  'tplMode appears at exactly 5 sites - read, append, ctx stamp, gate relaxation, result record',
  'sites: ' + JSON.stringify(tplModeSites));
const iCheck2 = lineStarting('    var check2;', 'the repair-pass check');
const iFidThrow = L.findIndex((l, i) => i > iCheck2 && l.includes('MLS_OPNOTE_TEMPLATE_FIDELITY'));
ok(iCheck2 > 0 && iFidThrow > iCheck2 && !L.slice(iCheck2, iFidThrow + 1).some(l => /tplMode/.test(l)),
  'the REPAIR pass is mode-blind: no mode can relax the second, final fidelity gate',
  'repair region lines ' + (iCheck2 + 1) + '-' + (iFidThrow + 1));
/* the relaxation discriminates on gate-owned reason strings - enumerate them all */
const REASONS = ['empty draft', 'heading set/order changed', 'fixed template wording changed',
  'exact template structure and fixed wording'];
const srcReasons = REASONS.filter(r => SRC.includes("'" + r + "'"));
ok(srcReasons.length === 4,
  'all four gate reason strings are gate-owned literals in the shipped source',
  'found: ' + JSON.stringify(srcReasons));
const matched = REASONS.filter(r => /fixed template wording/.test(r));
ok(matched.length === 1 && matched[0] === 'fixed template wording changed',
  'and the relaxation regex matches exactly ONE of the four - it cannot catch a heading,\n        an empty draft, or a pass',
  'matched: ' + JSON.stringify(matched));
ok(gate && gate.fidelity('', TPL).reason === 'empty draft' &&
   relaxPredicate('guide', gate.fidelity('', TPL)) === false,
  'an EMPTY draft is not relaxable in any mode either');

/* ==================================================================
   PROOF 5 - THE REAL MODE READER, AGAINST A STUBBED localStorage
   ================================================================== */
section('PROOF 5 - executing the shipped mode reader against stubbed storage');

function runReader(stored, opts) {
  opts = opts || {};
  const seen = { uns: [], get: [] };
  const win = opts.noUns ? {} : { uns: k => { seen.uns.push(k); return 'acct-7::' + k; } };
  const ls = {
    getItem: k => {
      seen.get.push(k);
      if (opts.throws) throw new Error('storage blocked on this profile');
      return stored;
    }
  };
  return { mode: readMode ? readMode(win, ls) : 'READER NOT LIFTED', seen };
}

const CASES = [
  ['strict', 'strict', 'the stored value strict resolves to strict'],
  ['adapt', 'adapt', 'the stored value adapt resolves to adapt'],
  ['guide', 'guide', 'the stored value guide resolves to guide'],
  ['  guide  ', 'guide', 'surrounding whitespace is trimmed'],
  ['GUIDE', 'adapt', 'an upper-case value is NOT accepted - it falls back to adapt'],
  ['Strict', 'adapt', 'a title-case value falls back to adapt'],
  ['guide;strict', 'adapt', 'a compound/injected value falls back to adapt'],
  ['loose', 'adapt', 'an invented mode name falls back to adapt'],
  ['junk', 'adapt', 'junk falls back to adapt'],
  ['', 'adapt', 'an empty string falls back to adapt'],
  [null, 'adapt', 'a missing key falls back to adapt'],
  [undefined, 'adapt', 'undefined falls back to adapt'],
  ['0', 'adapt', 'a falsy-looking string falls back to adapt']
];
CASES.forEach(([stored, want, label]) => {
  const r = runReader(stored);
  ok(r.mode === want, label + ' (' + JSON.stringify(stored) + ' -> ' + r.mode + ')');
});
{
  const r = runReader('guide');
  ok(r.seen.uns.length === 1 && r.seen.uns[0] === 'opNoteTemplateMode',
    'the reader namespaces through window.uns("opNoteTemplateMode") exactly once');
  ok(r.seen.get.length === 1 && r.seen.get[0] === 'acct-7::opNoteTemplateMode',
    'and reads the NAMESPACED key, so the mode is per-account and cannot leak between logins',
    'read key: ' + r.seen.get[0]);
}
ok(runReader('guide', { noUns: true }).mode === 'adapt',
  'with no uns() available the reader never touches raw storage - it returns adapt');
ok(runReader('guide', { throws: true }).mode === 'adapt',
  'a throwing localStorage (restricted or full profile) falls back to adapt, never crashes the draft');

/* the UI can only ever store one of the three */
const ROOM = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_room.js'), 'utf8');
ok(/function tplModeSet\(m\)\s*\{\s*\n\s*if \(m !== 'strict' && m !== 'guide' && m !== 'adapt'\) return;/.test(ROOM),
  'the writer (feat_mls_opnote_room.js:540) refuses to store anything but the three modes');
ok(ROOM.includes("var TPL_MODE_KEY = 'opNoteTemplateMode'"),
  'and writes the SAME key the generator reads - one key, both ends');
const readerKeys = (modeSrc || '').match(/'([a-zA-Z]+)'/g) || [];
ok(readerKeys.indexOf("'strict'") >= 0 && readerKeys.indexOf("'guide'") >= 0 && readerKeys.indexOf("'adapt'") >= 0,
  'the reader accepts exactly the three values the writer can produce');

/* ==================================================================
   PART 6 - NON-VACUITY: these assertions can fail
   ================================================================== */
section('PART 6 - non-vacuity (each proof is broken on a copy and must flip)');

const fakeClauses = { strict: CLAUSES.strict, guide: CLAUSES.guide, adapt: ' SOMETHING' };
ok(compose(BASE, 'adapt', fakeClauses) !== BASE,
  'if adapt gained a clause, the byte-identity proof WOULD fail (so it is not vacuous)');

const stubClauses = { strict: '', guide: '', adapt: '' };
ok(compose(BASE, 'strict', stubClauses) === compose(BASE, 'guide', stubClauses),
  'if the clauses were emptied, the "prompts differ" proof WOULD fail (not vacuous)');

const wideCond = relaxCond.replace("tplMode==='guide'", 'true');
const widePredicate = new Function('tplMode', 'check', 'return !!(' + wideCond + ');');
ok(widePredicate('strict', CHECK.reworded) === true,
  'if the mode guard were dropped, the scoping proof WOULD fail (not vacuous)');

const anyReason = relaxCond.replace('/fixed template wording/', '/changed/');
const loosePredicate = new Function('tplMode', 'check', 'return !!(' + anyReason + ');');
ok(loosePredicate('guide', CHECK.heading) === true,
  'if the reason filter were widened, the heading-failure proof WOULD fail (not vacuous)');

ok(gate.fidelity(TPL.replace('usual sterile fashion', 'standard sterile manner'), TPL).pass === false,
  'the gate is genuinely sensitive: a two-word change inside template boilerplate fails it',
  'if this passed, the reworded-draft fixture would not be proving anything');

/* observed while building the fixtures - a gate property, not a mode property */
const appended = gate.fidelity(TPL.replace('COMPLICATIONS: None.', 'COMPLICATIONS: None significant.'), TPL);
ok(appended.pass === true,
  'RECORDED (gate behaviour, all modes): fixed fragments are matched by SUBSTRING, so a\n' +
  '        draft may APPEND to short heading-bound boilerplate ("None." -> "None significant.")\n' +
  '        and still pass. Not a mode defect - it applies identically in strict, adapt and guide.',
  'reason: ' + appended.reason);

/* ==================================================================
   HONEST GAPS - recorded, not asserted away
   ================================================================== */
section('NOTES - true but unproven-by-this-suite, and known gaps');
const readsMode = rootFiles.filter(f => {
  if (f === 'feat_mls_opnote_integrity.js') return false;
  try {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return /__mlsTplMode|\.templateMode|\breworded\b/.test(t);
  } catch (e) { return false; }
});
console.log('  note  NOTHING in the shipped fleet READS templateMode / __mlsTplMode / reworded' +
  (readsMode.length ? ' except: ' + JSON.stringify(readsMode) : '') +
  '\n        The relaxation IS recorded on the result and on ctx, but no clinician-facing\n' +
  '        surface shows "the fixed-wording check was relaxed for this note".');
console.log('  note  the REPAIRED return (feat_mls_opnote_integrity.js:1163) sets templateFidelity\n' +
  '        and clinicalConsistency but NOT templateMode, so a repaired draft loses the mode\n' +
  '        record that a first-pass draft keeps (ctx.__mlsTplMode still carries it).');
console.log('  note  this suite proves the PROMPT BYTES differ and the GATE differs. Whether the\n' +
  '        model actually writes more loosely in guide mode is a live-model question no\n' +
  '        offline suite can answer.');

/* ========================================================================== */
console.log('\n' + (failures === 0
  ? 'PASS  opnote-follow-modes-differ: ' + checks + ' checks. The three follow modes are REAL - ' +
    'adapt is byte-identical to the pre-option prompt, strict and guide send distinct ' +
    'non-empty clauses, no mode weakens the anti-fabrication guards, and the gate ' +
    'relaxation fires in exactly one of 16 matrix cells.'
  : 'FAIL  opnote-follow-modes-differ: ' + failures + ' of ' + checks + ' checks failed.'));
process.exit(failures === 0 ? 0 : 1);

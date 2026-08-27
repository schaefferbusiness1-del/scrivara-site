'use strict';
/* THE FRONT DESK'S CASE NUMBER IS NOT A PROCEDURE (opnq-1.0.0)
 *
 * Owner, 2026-08-26: the generated note's PROCEDURE(S) PERFORMED line read
 * back the scheduling string verbatim - visit ordinal, "PP" suffix and
 * "CASE# KPNV5463" included - on a document he signs.
 *
 * WHERE IT COMES FROM. window._calAppts carries the reason exactly as Athena's
 * schedule states it; _opApptsForDay maps it verbatim, _opNewRow stores it as
 * row.proc, and it reaches the note through two doors: the PROMPT ("PROCEDURE:
 * <reason>") and the DETERMINISTIC FACT STAMP that forceFacts()/reanchor()
 * write onto the note's own "Procedure:" heading line.
 *
 * WHY THIS STRIPS AT THE DOORS AND NOWHERE ELSE. Matching, ranking and the
 * requested-fact contract all read the SAME string, and every token in it is
 * evidence there: clinicalConsistency grades the finished draft against facts
 * derived from it, so stripping before those would change the contract the
 * draft is graded against rather than just the words printed.
 *
 * THE ONE CATASTROPHIC FAILURE IS DROPPING A LEVEL OR A SIDE, and section 3
 * proves it cannot happen by construction rather than by inspecting regexes:
 * the strip is a CHECKED transform. It returns the shortened string only when
 * procedureFacts() reports the identical procedure type, region, side, exact
 * levels, level count and approach. Section 3 mutates the shipped junk pattern
 * into one that deliberately eats a level and proves the invariance gate hands
 * back the original untouched.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');

function install(source) {
  const ctx = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
    getTemplates: () => [], getTemplateById: () => null, getPatients: () => [], getKey: () => 'k',
    _opDobKey: (v) => String(v || '').trim(), _opPreviewHtml: () => '',
    opPrepRender() {}, async opPrepGenerateOne() {}, toast() {}
  };
  ctx.window = ctx;
  vm.runInNewContext(source, ctx, { filename: 'opnote-integrity.js' });
  return ctx.__mlsOpNoteIntegrity;
}
const api = install(SRC);
let checks = 0;

/* the six fields that ARE the clinical identity of a procedure */
function facts(s) {
  const f = api.parseProcedureFacts(s);
  return { procedureType: f.procedureType, region: f.region, side: f.side, levels: f.levels.join('/'), levelCount: f.levelCount, approach: f.approach };
}

/* =======================================================================
 * 1. THE JUNK GOES, AND ONLY THE JUNK
 * ===================================================================== */
{
  const CASES = [
    /* [reason as scheduled, what belongs on the note] */
    ['B/L RFA L3-L5 under MAC #2 PP', 'B/L RFA L3-L5 under MAC'],
    ['B/L L3, L4MB & L5 DR B #2 PP; CASE# KPNV5463', 'B/L L3, L4MB & L5 DR B'],
    ['Lumbar ESI; CASE# AB1234', 'Lumbar ESI'],
    ['Genicular nerve block #3', 'Genicular nerve block'],
    ['L SI joint inj P', 'L SI joint inj'],
    /* nothing to strip: returned byte-for-byte */
    ['Left L5-S1 TFESI', 'Left L5-S1 TFESI'],
    ['Bilateral L3-L5 medial branch blocks', 'Bilateral L3-L5 medial branch blocks'],
    ['Right knee genicular radiofrequency ablation', 'Right knee genicular radiofrequency ablation'],
    /* an ordinary sentence containing the word "case" is not a case number:
       the '#' and a digit are both required */
    ['Discuss the case', 'Discuss the case'],
    ['L4-L5 TFESI, discussed the case at length', 'L4-L5 TFESI, discussed the case at length']
  ];
  for (const [reason, want] of CASES) {
    assert.strictEqual(api.procTitleForNote(reason), want,
      JSON.stringify(reason) + ' printed on the note as ' + JSON.stringify(api.procTitleForNote(reason)) + ', expected ' + JSON.stringify(want));
    checks++;
  }

  /* the owner's exact string, stated as the defect: none of the scheduling
     debris survives onto the signed note */
  const scheduled = 'B/L L3, L4MB & L5 DR B #2 PP; CASE# KPNV5463';
  const printed = api.procTitleForNote(scheduled);
  for (const junk of [/CASE\s*#/i, /KPNV5463/, /#\s*2\b/, /\bPP\b/]) {
    assert(!junk.test(printed), 'the scheduling debris ' + junk + ' is still printed in PROCEDURE(S) PERFORMED: ' + JSON.stringify(printed));
  }
  checks++;
  /* POSITIVE CONTROL: it really was all there to begin with, so the assertions
     above are measuring a removal rather than an absence */
  for (const junk of [/CASE\s*#/i, /KPNV5463/, /#\s*2\b/, /\bPP\b/]) {
    assert(junk.test(scheduled), 'positive control failed: ' + junk + ' is not in the fixture');
  }
  checks++;
}

/* =======================================================================
 * 2. NO CLINICAL TOKEN IS EVER DROPPED
 * The property is asserted on the SIX PARSED FIELDS rather than on the
 * characters, so it covers levels, laterality, region, approach and type in
 * one comparison.
 * ===================================================================== */
{
  const POPULATION = [
    'B/L L3, L4, L5 RFA', 'B/L RFA L3-L5 under MAC #2 PP', 'B/L L3, L4MB & L5 DR B #2 PP; CASE# KPNV5463',
    'Left L5-S1 TFESI', 'R L4-5 TFESI #1', 'L SI joint inj P', 'Right SI joint injection; CASE# ZZ9911',
    'Bilateral L3-L5 medial branch blocks #2', 'Lumbar interlaminar ESI', 'Caudal ESI P',
    'Genicular nerve block #3', 'Right knee genicular RFA', 'Intracept BVN ablation #2 PP',
    'SCS trial', 'Trigger point injections PP', 'C5-C6 medial branch RFA; CASE# QQ4242',
    'Left L4 TFESI', 'Bilateral multi-level RFA under MAC'
  ];
  for (const reason of POPULATION) {
    const before = facts(reason), after = facts(api.procTitleForNote(reason));
    assert.deepStrictEqual(after, before,
      'the junk strip changed the clinical identity of ' + JSON.stringify(reason) + '\n  before: ' + JSON.stringify(before) +
      '\n  after:  ' + JSON.stringify(after));
    checks++;
  }
  /* laterality and levels specifically, in the string that carries the most junk */
  const worst = api.procTitleForNote('B/L RFA L3-L5 under MAC #2 PP');
  assert(/B\/L/.test(worst), 'laterality was stripped');
  assert(/L3-L5/.test(worst), 'the levels were stripped');
  assert(/MAC/.test(worst), 'the anesthesia word was stripped - MAC is not a procedureFacts field, so only the token guard protects it');
  checks++;
}

/* =======================================================================
 * 3. THE SAFETY PROPERTY IS A GATE, NOT A HOPE
 * A deliberately over-broad junk pattern is spliced into the SHIPPED module
 * and the invariance gate must refuse its output.
 * ===================================================================== */
{
  const OK_PATTERN = "/\\s*[;,]?\\s*CASE\\s*#\\s*(?=[A-Za-z0-9-]*\\d)[A-Za-z0-9][A-Za-z0-9-]{3,}\\s*$/i";
  assert(SRC.indexOf(OK_PATTERN) >= 0, 'the case-number pattern moved; this mutation can no longer be applied');
  /* eats ", L5" off the end - a real level, and exactly the failure that would
     put the wrong number of levels on a signed note */
  const mutated = install(SRC.replace(OK_PATTERN, "/\\s*,\\s*L5\\s*$/i"));
  const victim = 'Bilateral RFA L3, L4, L5';
  assert.strictEqual(mutated.procTitleForNote(victim), victim,
    'a junk pattern that eats a LEVEL was allowed to shorten the procedure title. The invariance gate is the only thing ' +
    'standing between a regex edit and a note that names the wrong levels, and it did not hold');
  checks++;
  /* control: the mutant really does change the facts, so the assertion above
     measured the GATE and not an inert regex */
  assert.notDeepStrictEqual(facts('Bilateral RFA L3, L4'), facts(victim),
    'positive control failed: dropping L5 does not change the parsed facts, so the mutation proves nothing');
  checks++;
}

/* =======================================================================
 * 4. STRIPPED AT THE NOTE DOORS, NOWHERE ELSE
 * ===================================================================== */
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const gen = stripComments(SRC.slice(SRC.indexOf('async function generateOnce('), SRC.indexOf('\n  /* oni-2.10.0: the deterministic provider/facility attestation footer')));

  assert(/var procTitle=procTitleForNote\(procedure\);/.test(gen), 'the stripped title is no longer computed in the generator');
  assert(/PROCEDURE: '\+procTitle\+/.test(gen), 'DOOR 1: the model is still told the raw scheduling string as the procedure title');
  assert(/procedure:procTitle\}/.test(gen), 'DOOR 2: forceFacts still stamps the raw scheduling string onto the note heading');
  checks++;

  /* and the CONTRACT still sees the whole string */
  assert(/templateCompatibility\(procedure,/.test(gen),
    'template compatibility is being computed from the stripped title. Every token in the scheduling string is evidence for matching');
  assert(/clinicalConsistency\(first\.note,procedure,/.test(gen),
    'the requested-fact contract is being graded against the stripped title rather than the string the row actually carries');
  checks++;

  /* the matcher never calls it */
  for (const decl of ['function rank(procedure) {', 'function best(procedure) {', 'function templateCompatibility(procedure,tpl,ctx) {']) {
    const at = SRC.indexOf(decl);
    assert(at > 0, 'missing declaration: ' + decl);
    let d = 0, end = -1;
    for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
      if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) { end = j + 1; break; } }
    }
    assert(SRC.slice(at, end).indexOf('procTitleForNote') < 0,
      decl + ' now strips before matching. The ranker scores every token, and a case number that happens to be CPT-shaped is ' +
      'the one input where stripping would change a CLASSIFICATION rather than a printed line');
    checks++;
  }
}

console.log('PASS the front desk\'s case number is not a procedure: the visit ordinal, the "PP" suffix and "CASE# KPNV5463" are stripped ' +
  'from what the note is told to print, on both note doors (the prompt and the deterministic fact stamp) and on neither matching path; ' +
  '18 real scheduling strings keep their exact procedure type, region, side, levels, level count and approach through the strip; and a ' +
  'junk pattern deliberately mutated to eat a LEVEL is refused by the invariance gate, which returns the original untouched (' + checks + ' checks)');

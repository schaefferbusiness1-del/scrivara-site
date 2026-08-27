'use strict';
/* AN RFA CASE MUST NEVER RECEIVE AN INJECTION NOTE (opnq-1.0.0)
 *
 * Owner, 2026-08-26, holding a real generated PDF: "this is a bad op note I
 * expect better op notes." The document's title said bilateral multi-level RFA
 * under MAC. Its DESCRIPTION OF PROCEDURE was the generic single-needle
 * injection boilerplate - contrast, epidurogram, steroid through the needle.
 *
 * TWO INDEPENDENT HOLES PRODUCED THAT ONE PAGE, and both are measured here.
 *
 * HOLE 1 - THE TYPE WAS NEVER CLASSIFIED. facet_rfa requires facet / medial
 * branch / mbb / rhizotomy near the modality word, OR a literal cervical|
 * thoracic|lumbar word within 30 characters, OR a 6463x CPT. A schedule string
 * that names LEVELS instead of a region word ("B/L L3, L4, L5 RFA") carries
 * none of the three and classified to NOTHING. With no class there is no +120
 * class match and, decisively, no -120 CROSS-class penalty: an injection
 * template kept its full token score, and templateCompatibility's
 * procedureType check returned immediately because the REQUESTED type was
 * falsy. Every type gate in the pipeline was skipped by the same absence.
 *
 * HOLE 2 - THE NARRATIVE IS NOT GRADED AT ALL. procedureEvidence() reads the
 * title line and the procedure-DESCRIBING headings; the DESCRIPTION body is
 * outside every consistency check by construction. A title that says RFA over
 * a body that describes an injection is invisible even to a cross-adapt draft,
 * because adaptedClinical keeps only the six title-derived fields.
 *
 * THE PARENT CLASS AND ITS COMPANION SHIP TOGETHER OR NOT AT ALL. Adding
 * generic_rfa without the RFA_FAMILY relaxation would score the parent -120
 * against the practice's own facet/SI/genicular RFA template and refuse the
 * RIGHT template - a worse defect than the one it cures. Section 2 is that
 * companion, and it is why this file asserts the positive case as hard as the
 * negative one.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SRC = read('feat_mls_opnote_integrity.js');

const tpl = (id, name, keywords = []) => ({
  id, name, keywords,
  text: 'PATIENT:\nPREOPERATIVE DIAGNOSIS:\nPROCEDURE:\nDESCRIPTION OF PROCEDURE:\nCOMPLICATIONS:\nDISPOSITION:'
});
function install(list, source) {
  const ctx = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
    getTemplates: () => list, getTemplateById: (id) => list.find((t) => t.id === id) || null,
    getPatients: () => [], getKey: () => 'k',
    _opDobKey: (v) => String(v || '').trim(), _opPreviewHtml: () => '',
    opPrepRender() {}, async opPrepGenerateOne() {}, toast() {}
  };
  ctx.window = ctx;
  vm.runInNewContext(source || SRC, ctx, { filename: 'opnote-integrity.js' });
  assert(ctx.__mlsOpNoteIntegrity && ctx.__mlsOpNoteIntegrity.installed, 'the integrity owner did not install');
  return ctx.__mlsOpNoteIntegrity;
}

/* the practice's real shape: injection templates AND the matching RFA one */
const FULL = [
  tpl('tfesi', 'Lumbar transforaminal epidural steroid injection'),
  tpl('ilesi', 'Lumbar interlaminar epidural steroid injection'),
  tpl('mbb', 'Lumbar medial branch block'),
  tpl('facet-rfa', 'Lumbar medial branch radiofrequency ablation'),
  tpl('si', 'Sacroiliac joint injection'),
  tpl('gen-rfa', 'Genicular nerve radiofrequency ablation'),
  tpl('si-rfa', 'Sacroiliac joint radiofrequency ablation')
];
/* the same day with NO RFA template in the library at all */
const INJECTION_ONLY = FULL.filter((t) => !/rfa|ablation/i.test(t.name));

let checks = 0;

/* =======================================================================
 * 1. THE DEFECT: THE SCHEDULE'S OWN WORDING NOW CLASSIFIES
 * ===================================================================== */
{
  const api = install(FULL);
  const RFA_REASONS = [
    'B/L L3, L4, L5 RFA',
    'Bilateral multi-level RFA under MAC',
    'B/L RFA L3-L5 under MAC #2 PP',
    'L3-L5 radiofrequency ablation',
    'Bilateral L3-L5 rhizotomy'
  ];
  for (const reason of RFA_REASONS) {
    const cls = api.classify(reason);
    assert(cls && /rfa/.test(cls),
      'the schedule reason ' + JSON.stringify(reason) + ' classifies as ' + JSON.stringify(cls) + '. With no class there is ' +
      'no cross-class penalty, so an injection template keeps its full token score and every type gate is skipped');
    checks++;
  }

  /* THE PDF THE OWNER IS HOLDING, as one assertion: an RFA request is
     INCOMPATIBLE with each injection template in his library. */
  for (const t of INJECTION_ONLY) {
    const compat = api.templateCompatibility('B/L L3, L4, L5 RFA', t);
    assert.strictEqual(compat.pass, false,
      'an RFA case is still compatible with the injection template ' + JSON.stringify(t.name) +
      ' - this is exactly the binding that produced an injection narrative under an RFA title');
    assert(compat.errors.some((e) => e.field === 'procedureType'),
      'the incompatibility with ' + t.name + ' is not about the procedure TYPE, so it would not survive a close-call adaptation');
    checks++;
  }

  /* and the matcher picks the RFA template, not the closest injection one */
  const best = api.best('B/L L3, L4, L5 RFA');
  assert(best.tpl && best.tpl.id === 'facet-rfa',
    'an RFA case auto-matched ' + JSON.stringify(best.tpl && best.tpl.id) + ' instead of the practice\'s RFA template');
  checks++;

  /* WITH NO RFA TEMPLATE IN THE LIBRARY the honest answer is to bind nothing.
     A silent fall-back onto the closest injection template IS the defect. */
  const noRfa = install(INJECTION_ONLY);
  const refused = noRfa.best('B/L L3, L4, L5 RFA');
  assert.strictEqual(refused.tpl, null,
    'with no RFA template in the library an RFA case still bound ' + JSON.stringify(refused.tpl && refused.tpl.name) +
    ' - a wrong-family template is never a better answer than asking');
  assert(/conflict|ambiguous|no classified/.test(String(refused.reason || '')),
    'the refusal does not say why: ' + refused.reason);
  checks++;
}

/* =======================================================================
 * 2. THE COMPANION, ASSERTED AS HARD AS THE DEFECT
 * The parent class must not refuse the doctor's own correct RFA template,
 * and it must not open a door between DIFFERENT RFA targets.
 * ===================================================================== */
{
  const api = install(FULL);
  assert.strictEqual(api.templateCompatibility('B/L L3, L4, L5 RFA', FULL.find((t) => t.id === 'facet-rfa')).pass, true,
    'the RFA family parent refuses the practice\'s own lumbar RFA template. The parent names no target, so parent-vs-child ' +
    'must relax; shipping the class without this relaxation is a worse defect than the one it cures');
  checks++;

  /* a lumbar RFA request must NOT reach a knee or SI RFA template: only the
     TYPE is relaxed, region still decides */
  for (const wrongTarget of ['gen-rfa', 'si-rfa']) {
    const compat = api.templateCompatibility('B/L L3, L4, L5 RFA', FULL.find((t) => t.id === wrongTarget));
    assert.strictEqual(compat.pass, false,
      'a lumbar RFA request is compatible with the ' + wrongTarget + ' template - the family relaxation has become a bypass');
    checks++;
  }

  /* two named RFA siblings still conflict with each other */
  assert.strictEqual(api.templateCompatibility('Bilateral lumbar RFA', FULL.find((t) => t.id === 'gen-rfa')).pass, false,
    'a named lumbar facet RFA is compatible with a genicular RFA template - sibling classes must never relax');
  checks++;

  /* REGRESSION CONTROL: the non-RFA families the library already matched are
     untouched by the new class. */
  const UNCHANGED = [
    ['Left L5-S1 TFESI', 'tfesi'],
    ['L4-5 interlaminar ESI', 'ilesi'],
    ['Bilateral L3-L5 medial branch blocks', 'mbb'],
    ['Right SI joint injection', 'si'],
    ['Genicular nerve radiofrequency ablation', 'gen-rfa'],
    ['Lumbar medial branch RFA', 'facet-rfa']
  ];
  for (const [reason, want] of UNCHANGED) {
    const got = api.best(reason);
    assert(got.confident && got.tpl && got.tpl.id === want,
      reason + ' now matches ' + JSON.stringify(got.tpl && got.tpl.id) + ' instead of ' + want);
    checks++;
  }
  /* and a row with no procedure signal still refuses */
  assert.strictEqual(api.best('follow-up appointment').tpl, null, 'a no-signal row received a template');
  checks++;
  /* the parent is subsumed by every more specific class, so procClassSet never
     grows and best()'s "names more than one procedure" refusal is unchanged */
  assert.deepStrictEqual(api.classify('Intracept BVN ablation'), 'intracept',
    'the RFA family parent shadowed a more specific ablation class');
  checks++;
}

/* =======================================================================
 * 3. THE NARRATIVE IS BOUND TO THE PROCEDURE, OR IT IS BRACKETED
 * ===================================================================== */
const NOTE = (description) => 'OPERATIVE / PROCEDURE NOTE\n\n' +
  'PROCEDURE(S) PERFORMED: Bilateral L3-L5 radiofrequency ablation under MAC\n\n' +
  'ANESTHESIA: MAC\n\n' +
  'DESCRIPTION OF PROCEDURE:\n' + description + '\n\n' +
  'COMPLICATIONS: None\n\nDISPOSITION / POST-PROCEDURE PLAN: Home.\n';

const INJECTION_STORY =
  'The patient was placed prone on the fluoroscopy table and prepped and draped in the usual sterile fashion. ' +
  'Under fluoroscopic guidance a 22-gauge spinal needle was advanced to the transforaminal epidural space at L5-S1. ' +
  'Contrast was injected and an epidurogram confirmed appropriate flow. The steroid and local anesthetic solution ' +
  'was injected through the needle and the needle was removed.';
const RFA_STORY =
  'The patient was placed prone. Under fluoroscopic guidance radiofrequency cannulae were advanced to the medial ' +
  'branch nerves at L3, L4 and L5 bilaterally. Sensory stimulation at 50 Hz reproduced concordant pain; motor ' +
  'stimulation at 2 Hz showed no lower extremity motor response. Local anesthetic was injected at each level and ' +
  'radiofrequency lesions were created at 80 degrees C for 90 seconds at each level bilaterally.';

{
  const api = install(FULL);

  /* a. THE DEFECT: an injection narrative under an RFA title is replaced */
  const fired = api.narrativeBinding(NOTE(INJECTION_STORY), 'B/L L3, L4, L5 RFA');
  assert.strictEqual(fired.fired, true,
    'an RFA-titled note carrying a single-needle transforaminal injection narrative was shipped unchanged - this is the ' +
    'exact document the owner is complaining about');
  assert(/rfa/.test(String(fired.requested)) && /esi|tfesi|injection/.test(String(fired.found)),
    'the guard fired but did not identify what it found: ' + JSON.stringify(fired));
  checks++;

  /* the fabricated prose is GONE, and nothing was written in its place */
  assert(!/epidurogram|transforaminal epidural space|steroid and local anesthetic solution/i.test(fired.note),
    'the invented injection narrative survived into the guarded note');
  /* and nothing was ASSERTED in its place: every line the guard leaves in that
     section is either a bracketed ask or the notice saying why it is empty */
  {
    const section = fired.note.slice(fired.note.indexOf('DESCRIPTION OF PROCEDURE:'), fired.note.indexOf('COMPLICATIONS'));
    const stray = section.split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((l) => !/^DESCRIPTION OF PROCEDURE:$/.test(l) && !/^\[FILL: [^\]]+\]$/.test(l) && !/^\(The drafted narrative/.test(l));
    assert.deepStrictEqual(stray, [],
      'the guard wrote clinical prose of its own into the narrative section: ' + JSON.stringify(stray) +
      '. It may only ASK - writing the right story is still inventing it');
  }
  checks++;

  /* what it leaves is the requested procedure's own elements, bracketed */
  for (const element of [/sensory stimulation/i, /motor stimulation/i, /lesion temperature and time/i, /cannula/i]) {
    assert(element.test(fired.note), 'the RFA skeleton does not name ' + element + ' - the doctor is not told what to dictate');
  }
  checks++;

  /* THE FAIL-CLOSED PROPERTY, measured with the app's OWN canonical parser:
     the guarded note cannot be saved complete, exported, or sent to Athena. */
  const shellCtx = { String, Object, Array, RegExp, console };
  vm.createContext(shellCtx);
  {
    const shell = read('1pScribeFlow.html');
    const at = shell.indexOf('function opNoteBlankTokens(text){');
    let d = 0, end = -1;
    for (let j = shell.indexOf('{', at); j < shell.length; j++) {
      if (shell[j] === '{') d++; else if (shell[j] === '}') { d--; if (!d) { end = j + 1; break; } }
    }
    vm.runInContext(shell.slice(at, end) + '\nthis.blanks = opNoteBlankTokens;', shellCtx);
  }
  assert.strictEqual(shellCtx.blanks(NOTE(INJECTION_STORY)).length, 0,
    'positive control: the ORIGINAL fabricated note counted as unfinished, so the assertion below would prove nothing. ' +
    'The whole danger of that note is that it looked complete');
  assert(shellCtx.blanks(fired.note).length >= 5,
    'the guarded note reads as FINISHED to opNoteBlankTokens. The bracketed skeleton must use the app\'s own [FILL:] ' +
    'vocabulary, or the note can still be saved complete, exported as a PDF and sent to Athena with a hole in it');
  checks++;

  /* b. CONTROL: a real RFA narrative is left completely alone */
  const ok = api.narrativeBinding(NOTE(RFA_STORY), 'B/L L3, L4, L5 RFA');
  assert.strictEqual(ok.fired, false,
    'a correct RFA narrative was replaced with a skeleton. Over-firing here DELETES real clinical prose, which is the worst ' +
    'outcome available on this surface: ' + JSON.stringify(ok));
  checks++;

  /* c. CONTROL: an injection case with an injection narrative is left alone */
  assert.strictEqual(api.narrativeBinding(NOTE(INJECTION_STORY), 'Left L5-S1 TFESI').fired, false,
    'a matching injection narrative was replaced - the guard is comparing something other than class');
  checks++;

  /* d. CONTROL: an unclassifiable narrative is NEVER touched */
  assert.strictEqual(api.narrativeBinding(NOTE('The patient tolerated the procedure well and was taken to recovery.'), 'B/L L3, L4, L5 RFA').fired, false,
    'a narrative with no procedure vocabulary was replaced. An empty class is not a conflicting class');
  checks++;

  /* e. CONTROL: an unclassifiable REQUEST is never a reason to touch a note */
  assert.strictEqual(api.narrativeBinding(NOTE(INJECTION_STORY), 'follow-up appointment').fired, false,
    'a note was rewritten on the strength of a procedure string that classifies to nothing');
  checks++;

  /* f. CONTROL: a note with no narrative section at all is untouched */
  assert.strictEqual(api.narrativeBinding('PROCEDURE(S) PERFORMED: Bilateral L3-L5 RFA\nFINDINGS: ok\n', 'B/L L3, L4, L5 RFA').fired, false,
    'a note with no DESCRIPTION section had one invented for it');
  checks++;

  /* g. sections AROUND the narrative survive verbatim */
  assert(/COMPLICATIONS: None/.test(fired.note) && /DISPOSITION \/ POST-PROCEDURE PLAN: Home\./.test(fired.note) &&
    /ANESTHESIA: MAC/.test(fired.note) && /PROCEDURE\(S\) PERFORMED: Bilateral L3-L5 radiofrequency ablation under MAC/.test(fired.note),
    'the guard rewrote more than the narrative section');
  checks++;

  /* h. it recognises the other headings the same narrative wears */
  for (const heading of ['TECHNIQUE', 'PROCEDURE IN DETAIL', 'Description of Procedure']) {
    const alt = NOTE(INJECTION_STORY).replace('DESCRIPTION OF PROCEDURE:', heading + ':');
    assert.strictEqual(api.narrativeBinding(alt, 'B/L L3, L4, L5 RFA').fired, true,
      'the narrative under a "' + heading + '" heading is not bound to the procedure');
  }
  checks++;
}

/* =======================================================================
 * 4. THE GUARD RUNS IN THE GENERATOR THAT IS ACTUALLY INSTALLED
 * This module REPLACES window._genOpNote, so a guard added to the shell's
 * shadowed copy would ship and do nothing - the exact mistake this file's
 * own comments record twice.
 * ===================================================================== */
{
  const at = SRC.indexOf('function generate(name,dateStr,procedure,tplText,ctx) {');
  assert(at > 0, 'the installed generator moved');
  const body = SRC.slice(at, SRC.indexOf('\n  /* These markers deliberately stop', at));
  assert(/guardNarrativeBinding\(procedure,\s*result\)/.test(body),
    'the narrative guard is not called from the INSTALLED generator. feat_mls_opnote_integrity.js replaces window._genOpNote ' +
    'outright, so a guard placed anywhere else is a patient-safety fix that ships and does nothing');
  assert(body.indexOf('_opGuardProcedureDate') < body.indexOf('guardNarrativeBinding'),
    'the narrative guard runs before the date guard - it must run after every validation so it can never send a draft back ' +
    'around a repair loop');
  checks++;

  /* it may only ever ADD blanks: no drug name, dose or measurement may appear
     in any skeleton this guard writes */
  const skel = SRC.slice(SRC.indexOf('var NARRATIVE_SKELETON='), SRC.indexOf('function skeletonKindFor'));
  assert(!/\b\d+\s*(?:mg|ml|cc|%|degrees|seconds|gauge)\b/i.test(skel),
    'a narrative skeleton names a dose, a strength or a measured value. It exists precisely because the pipeline may not ' +
    'state what was not dictated: ' + skel.slice(0, 200));
  assert(!/lidocaine|bupivacaine|triamcinolone|marcaine|dexamethasone|omnipaque/i.test(skel),
    'a narrative skeleton names a drug');
  checks++;
}

console.log('PASS an RFA case never receives an injection note: the schedule\'s own wording ("B/L L3, L4, L5 RFA") now classifies as ' +
  'an ablation, is INCOMPATIBLE with every injection template in the library and binds the practice\'s RFA template instead - while ' +
  'the required family relaxation is proven not to open a door between lumbar, genicular and SI RFA, and the six non-RFA families ' +
  'match exactly as before; and an injection narrative written under an RFA title is replaced with a bracketed [FILL:] skeleton the ' +
  'app\'s own parser counts as unfinished, with a correct RFA narrative, a matching injection narrative, an unclassifiable narrative ' +
  'and an unclassifiable request all proven untouched (' + checks + ' checks)');

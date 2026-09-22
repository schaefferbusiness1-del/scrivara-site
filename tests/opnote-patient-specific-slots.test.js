'use strict';

/* OP-NOTE PATIENT-SPECIFIC SLOTS (opfacts-1.0.0, 2026-09-15).
 *
 * Owner: "all the notes and op notes just still don't follow templates good
 * enough and use enough patient data ... hallucinate."
 *
 * MEASURED live on the dummy chart (Right sacroiliac joint injection, strict
 * mode): the template reproduced 19/19 lines verbatim, the sanitizer had turned
 * the INDICATIONS value into an [[indications]] slot, and the model filled it
 * with "Chronic midline low back pain without sciatica, unresponsive to
 * conservative treatment." The verified history on the wire (11,716 chars)
 * contained ZERO occurrences of "conservative" or "physical therapy". The
 * diagnosis was the chart's; the failed-conservative-care clause was the
 * operative idiom, borrowed from the template sentence the sanitizer had just
 * removed. Three doors close it, and this suite pins all three:
 *   1. the installed generator's prompt names what a patient-specific slot may
 *      carry and forbids the borrowed phrase;
 *   2. the verified-history fence says those lines are WRITTEN FROM the block
 *      (bgonly-1.1.0) while the procedure sections stay fenced;
 *   3. a deterministic guard removes a refractory/failed-conservative-care
 *      claim the model still writes when the history documents none - and
 *      leaves the doctor's own fixed template wording alone.
 * Plus the cosmetic cure measured beside it: 23 of 98 library templates open
 * with Word-binary residue before the title; the sanitizer now strips it. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const oni = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const hist = fs.readFileSync(path.join(root, 'feat_opnote_history.js'), 'utf8');
const shells = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/1pScribeFlow.html']
  .filter((f) => fs.existsSync(path.join(root, f)))
  .map((f) => ({ f, s: fs.readFileSync(path.join(root, f), 'utf8') }));

let checks = 0;
function ok(c, m) { checks++; assert.ok(c, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m + ' (got ' + JSON.stringify(a) + ')'); }

/* ---- 1. the prompt ------------------------------------------------------ */
ok(/sys\+=' PATIENT-SPECIFIC SLOTS - INDICATIONS, DIAGNOSIS, HISTORY\./.test(oni),
  'the installed generator does not state the patient-specific slots clause');
ok(oni.includes('a medication on the current list is not a failed trial'),
  'the clause does not separate a listed medication from a failed trial');
ok(oni.includes('never write "refractory to", "unresponsive to", "failed" or "despite" conservative treatment on a chart that does not document it'),
  'the clause does not forbid the borrowed idiom');
ok(oni.includes('A documented diagnosis alone is a complete indication.'),
  'the clause does not tell the model a bare diagnosis is enough');
const reproduceAt = oni.indexOf("sys+=' HOW TO PRODUCE THE NOTE");
const slotsAt = oni.indexOf("sys+=' PATIENT-SPECIFIC SLOTS");
ok(reproduceAt > 0 && slotsAt > reproduceAt, 'the slots clause must follow REPRODUCE, THEN FILL so it reads as the exception to it');
ok(oni.includes('The patient-specific slots (indications, diagnosis, history) are variable by nature and are written for this patient as instructed above.'),
  'the strict mode clause still freezes the patient-specific slots');
ok(!/strict:'[^\n]*heading/i.test(oni.slice(oni.indexOf("strict:' TEMPLATE FIDELITY - CLOSEST"), oni.indexOf("strict:' TEMPLATE FIDELITY - CLOSEST") + 900)),
  'the strict clause may not mention headings (opnote-follow-modes-differ contract)');

/* ---- 2. the fence -------------------------------------------------------- */
const ruleStart = hist.indexOf("var bgRule =");
const ruleEnd = hist.indexOf("';", ruleStart);
const rule = hist.slice(ruleStart, ruleEnd);
ok(ruleStart > 0 && ruleEnd > ruleStart, 'the BACKGROUND_ONLY rule is gone from the history module');
ok(rule.includes('It is the source for the patient-specific'), 'the fence does not say the patient-specific lines are written FROM it');
ok(rule.includes('a medication on the list is not a ') && rule.includes('failed trial'), 'the fence does not separate a listed medication from a failed trial');
ok(rule.includes('not evidence of anything addressed, reviewed, examined, assessed'), 'the shared visit-note sentence was lost');
ok(/performed/.test(rule) && rule.includes('silence is not stability, review, reconciliation, or continuation'), 'the operative verbs or the silence clause were lost');
ok(/findings, technique, procedure/.test(rule), 'the procedure sections are no longer fenced');
ok(!/indication, findings/.test(rule), 'the indication is still listed among the fenced sections - the model will keep writing the idiom instead of the chart');

/* ---- 3. the guard, lifted from the installed module --------------------- */
function lineStarting(prefix, label) {
  const i = oni.indexOf(prefix);
  ok(i >= 0, label + ' is missing');
  return i;
}
const gStart = lineStarting('  var TEMPLATE_JUNK_PREFIX_RX=', 'the junk-prefix regex');
/* opmode-1.0.0: fidelity() now takes the follow mode as a third argument. */
const gEnd = lineStarting('  function fidelity(note, templateText, mode) {', 'fidelity()');
const S = (x) => (x == null ? '' : String(x));
const guard = new Function('S', 'window', oni.slice(gStart, gEnd) +
  '\nreturn {claim:conservativeClaimUnsupported,strip:stripUnsupportedConservativeClaim,guard:guardUnsupportedConservativeClaim,junk:TEMPLATE_JUNK_PREFIX_RX};')(S, {});

const NOTE = 'OPERATIVE REPORT\nPatient: Jordan Lee\nPROCEDURE: Right sacroiliac joint injection\nINDICATIONS: Chronic midline low back pain without sciatica, unresponsive to conservative treatment.\nCONSENT: Risks, benefits, and alternatives were discussed and informed consent was obtained.\nCOMPLICATIONS: None.';
const HISTORY_NO_CARE = 'EXACT PATIENT PROFILE\nActive problems:\nChronic midline low back pain without sciatica\nCurrent medications: Ibuprofen 400 mg as needed\nAllergies: NKDA';
const HISTORY_WITH_CARE = HISTORY_NO_CARE + '\n[2026-08-01] completed six sessions of physical therapy without relief';
const TPL_SCRUBBED = 'OPERATIVE REPORT\nPatient: ______\nPROCEDURE: [[procedure]]\nINDICATIONS: [[indications]]\nCONSENT: Risks, benefits, and alternatives were discussed and informed consent was obtained.\nCOMPLICATIONS: None.';
const TPL_OWNS_PHRASE = 'PROCEDURE: [[procedure]]\nINDICATION: [DIAGNOSIS] with [SYMPTOMS] refractory to conservative care.\nCOMPLICATIONS: None.';

const claim = guard.claim(NOTE, HISTORY_NO_CARE, TPL_SCRUBBED);
ok(claim && /unresponsive to conservative treatment/.test(claim), 'an undocumented failed-conservative-care claim was not detected');
eq(guard.claim(NOTE, HISTORY_WITH_CARE, TPL_SCRUBBED), null, 'a documented physical-therapy trial must license the sentence');
eq(guard.claim(NOTE, HISTORY_NO_CARE, TPL_OWNS_PHRASE), null, "the doctor's own fixed template wording is not the model's claim");
eq(guard.claim('INDICATIONS: Lumbar spondylolisthesis with left L5 radicular pain.', HISTORY_NO_CARE, TPL_SCRUBBED), null,
  'a bare documented diagnosis raises no claim');
eq(guard.claim('INDICATIONS: Chronic low back pain.\nCONSENT: Alternatives including conservative management were discussed.', HISTORY_NO_CARE, TPL_SCRUBBED), null,
  'the word conservative in a consent sentence is not a refractory claim');

const stripped = guard.strip(NOTE);
ok(stripped.includes('INDICATIONS: Chronic midline low back pain without sciatica.'), 'the strip did not leave the documented diagnosis standing alone: ' + JSON.stringify(stripped.split('\n')[3]));
ok(stripped.includes('CONSENT: Risks, benefits, and alternatives were discussed'), 'the strip touched a fixed line');
eq(guard.strip('INDICATIONS: Chronic pain refractory to conservative management including physical therapy, activity modification, and oral analgesics.'),
  'INDICATIONS: Chronic pain.', 'the template idiom with its list is not removed whole');
eq(guard.strip('INDICATIONS: Left L5 radiculitis despite conservative therapy.'), 'INDICATIONS: Left L5 radiculitis.', 'the despite form is not removed');
eq(guard.strip('INDICATIONS: Facet syndrome, having failed conservative measures such as PT and NSAIDs.'), 'INDICATIONS: Facet syndrome.', 'the failed form is not removed');

/* the guard on a result object: receipt on the result and on window */
const w = {};
const guard2 = new Function('S', 'window', oni.slice(gStart, gEnd) +
  '\nreturn {guard:guardUnsupportedConservativeClaim};')(S, w);
const res = guard2.guard({ note: NOTE, missing: [] }, TPL_SCRUBBED, { mlsVerifiedHistoryBinding: { context: HISTORY_NO_CARE } }, { history: '' });
ok(res.indicationGuard && res.indicationGuard.changed === true, 'the guard did not record that it changed the note');
ok(res.note.includes('without sciatica.') && !/conservative/.test(res.note), 'the guard did not remove the claim from the result');
ok(w.__mlsLastOpIndicationGuard && w.__mlsLastOpIndicationGuard.removed, 'the guard left no window receipt');
const untouched = guard2.guard({ note: NOTE, missing: [] }, TPL_SCRUBBED, { mlsVerifiedHistoryBinding: { context: HISTORY_WITH_CARE } }, { history: '' });
ok(!untouched.indicationGuard && /unresponsive to conservative treatment/.test(untouched.note), 'a documented claim was scrubbed');
const legacy = guard2.guard({ note: NOTE, missing: [] }, TPL_SCRUBBED, {}, { history: HISTORY_WITH_CARE });
ok(!legacy.indicationGuard, 'the legacy ctx.history evidence path is not read');

/* the guard is wired on BOTH model passes of the installed generator */
ok(oni.includes('first=guardUnsupportedConservativeClaim(first,tplForModel,opts,ctx);'), 'the guard is not wired after the first draft');
ok(oni.includes('repaired=guardUnsupportedConservativeClaim(repaired,tplForModel,opts,ctx);'), 'the guard is not wired after the repair pass');
ok(oni.indexOf('first=guardUnsupportedConservativeClaim') < oni.indexOf('var check=fidelity(first.note,tplForModel'), 'the guard must run before fidelity grades the first draft');

/* ---- 4. Word-binary residue before the title ---------------------------- */
eq('ÁOPERATIVE REPORT\nPatient: ______'.replace(guard.junk, ''), 'OPERATIVE REPORT\nPatient: ______', 'one residue byte before the title is not stripped');
eq('’ÉOPERATIVE REPORT'.replace(guard.junk, ''), 'OPERATIVE REPORT', 'two residue bytes before the title are not stripped');
eq('Ébauche de note'.replace(guard.junk, ''), 'Ébauche de note', 'a real accented word was stripped');
eq('OPERATIVE REPORT'.replace(guard.junk, ''), 'OPERATIVE REPORT', 'a clean title was altered');
const sanAt = oni.indexOf('function sanitizeTemplate(tplText) {');
const junkAt = oni.indexOf("var t = S(tplText).replace(TEMPLATE_JUNK_PREFIX_RX, '');", sanAt);
const splitAt = oni.indexOf('t = t.replace(SPLIT_TITLES', sanAt);
ok(sanAt > 0 && junkAt > sanAt && splitAt > junkAt,
  'sanitizeTemplate does not strip the residue before anything else reads the template');

/* ---- 5. the shell fallback generator says the same thing --------------- */
for (const { f, s } of shells) {
  ok(s.includes("+'PATIENT-SPECIFIC SLOTS - INDICATIONS, DIAGNOSIS, HISTORY."), f + ': the fallback generator lacks the parity clause');
  ok(s.includes('A documented diagnosis alone is a complete indication. '), f + ': the fallback clause lost its closing sentence');
}

console.log('PASS opnote patient-specific slots: ' + checks + ' checks - the prompt, the fence and a deterministic guard keep an undocumented failed-conservative-care claim out of the indication, and Word residue is stripped from the template title');

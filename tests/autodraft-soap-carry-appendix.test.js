/* autodraft-1.1.0 — SOAP CARRIES THE HISTORY TOO, AS A DISPLAY-ONLY APPENDIX.
 *
 * The carry used to be suppressed under 'soap' because _flatSoapNote()'s parse
 * loop folded any trailing history block into PLAN. This suite slices the
 * SHIPPED functions out of BOTH twins (never copies them) and proves:
 *   - the splitter recognises exactly the marked closed-allowlist blocks the
 *     seed mints, and nothing else;
 *   - _flatSoapNote()/_reorderNoteForStyle() preserve the appendix AFTER the
 *     sections instead of absorbing it — wherever the model happened to put it;
 *   - every athena_note derivation door strips the appendix, and the validator
 *     REFUSES marker text outright, so athena_note stays EXACTLY five
 *     destinations (the write-lane pin is strengthened, not weakened);
 *   - the drug/dose line gate is untouched — a dose line never rides forward.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TWINS = ['1pScribeFlow.html', path.join('1p', 'index.html')];

function liftFn(src, name, rel) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, rel + ': shipped function ' + name + ' is missing');
  let i = src.indexOf('{', at), depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  assert.fail(rel + ': unbalanced braces lifting ' + name);
}

function liftAutodraftRegion(src, rel) {
  const a = src.indexOf('var AUTODRAFT_MARKER_TEXT');
  const b = src.indexOf('/* Per-visit row.');
  assert.ok(a > 0 && b > a, rel + ': autodraft constants/functions region is missing');
  return src.slice(a, b);
}

function buildContext(src, rel) {
  const ctx = {
    console,
    document: { getElementById: (id) => (id === 'visitComment' ? { value: ctx.__visitComment || '' } : null) },
    window: {},
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  vm.createContext(ctx);
  const pieces = [
    liftAutodraftRegion(src, rel),
    liftFn(src, 'stripSignatureBlock', rel),
    liftFn(src, '_mlsAthenaNoteQualityError', rel),
    liftFn(src, '_mlsAthenaBodyIsSubstantive', rel),
    liftFn(src, '_mlsValidateAthenaNote', rel),
    liftFn(src, '_flatSoapNote', rel),
    liftFn(src, '_reorderNoteForStyle', rel),
    liftFn(src, '_mlsAthenaNoteWithVisitComment', rel),
  ];
  vm.runInContext(pieces.join('\n'), ctx, { filename: rel + '#autodraft-lift' });
  return ctx;
}

const M = '(carried from last visit - review)';
const FIVE = [
  'HPI:', 'Right knee pain for two weeks after a fall, worse with stairs.', '',
  'ROS:', 'Negative except as in HPI; no fevers, no numbness.', '',
  'EXAM:', 'Right knee with medial joint line tenderness, stable ligaments.', '',
  'ASSESSMENT:', 'Right knee medial meniscus strain, improving.', '',
  'PLAN:', 'Home exercise program and NSAIDs as needed; return in four weeks.',
].join('\n');
const APPENDIX = [
  'PAST MEDICAL HISTORY ' + M + ':',
  'Hypertension.',
  'Type 2 diabetes.',
  '',
  'ALLERGIES ' + M + ':',
  'Penicillin - rash.',
].join('\n');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

for (const rel of TWINS) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, 'utf8');
  const ctx = buildContext(src, rel);
  const g = (name) => vm.runInContext(name, ctx);
  const call = (expr) => vm.runInContext(expr, ctx);
  ctx.__fixture = null;

  /* 1. every style carries now — soap included, closed map otherwise intact */
  const styles = g('AUTODRAFT_CARRY_STYLES');
  for (const st of ['soap', 'hp', 'narrative', 'problem', 'apso']) eq(styles[st], true, rel + ': style ' + st + ' must carry');
  eq(Object.keys(styles).length, 5, rel + ': carry-style map stays closed');

  /* 2. the seed carries under soap, and the DOSE GATE still drops drug lines */
  ctx.__fixture = [
    'HPI:', 'Old visit HPI.', '',
    'PAST MEDICAL HISTORY:', 'Hypertension.', 'Lisinopril 10 mg daily.', 'Type 2 diabetes.', '',
    'ALLERGIES:', 'Penicillin - rash.', '',
    'PLAN:', 'Old plan.',
  ].join('\n');
  const seed = call('_autoDraftBuildSeed(__fixture, "soap")');
  ok(seed.carryAllowed === true, rel + ': soap seed must allow the carry');
  const names = seed.carried.map((c) => c.name);
  ok(names.indexOf('PAST MEDICAL HISTORY') >= 0 && names.indexOf('ALLERGIES') >= 0, rel + ': stable history must carry under soap');
  ok(seed.droppedDoseLines >= 1, rel + ': the dose line must be counted as dropped');
  const carriedText = seed.carried.map((c) => c.lines.join('\n')).join('\n');
  ok(!/lisinopril|10\s*mg/i.test(carriedText), rel + ': a drug/dose line must NEVER ride forward');
  ok(/Hypertension/.test(carriedText) && /Penicillin/.test(carriedText), rel + ': non-dose history lines carry verbatim');

  /* 3. the seed block tells a fixed-section style to put the blocks at the END */
  ctx.__seed = seed;
  const blockSoap = call('_autoDraftSeedBlock(__seed, {when: "1/2/2026", style: "soap"})');
  const blockHp = call('_autoDraftSeedBlock(__seed, {when: "1/2/2026", style: "hp"})');
  ok(/AFTER the final section/.test(blockSoap), rel + ': soap seed block must direct the blocks after the final section');
  ok(!/AFTER the final section/.test(blockHp), rel + ': hp keeps free placement (history belongs mid-note there)');

  /* 4. flat five + trailing marked appendix → appendix preserved AFTER, plan clean */
  ctx.__note = FIVE + '\n\n' + APPENDIX;
  const flat1 = call('_flatSoapNote(__note)');
  ok(typeof flat1 === 'string' && flat1, rel + ': flatten must succeed with an appendix present');
  const planBody1 = flat1.split(/^PLAN:$/m)[1] || '';
  const planOnly1 = planBody1.split('PAST MEDICAL HISTORY')[0];
  ok(!/carried from last visit/.test(planOnly1), rel + ': PLAN body must not absorb the appendix');
  ok(flat1.indexOf('PAST MEDICAL HISTORY ' + M) > flat1.indexOf('PLAN:'), rel + ': appendix must sit after PLAN');
  ok(/Penicillin - rash\.\s*$/.test(flat1), rel + ': the appendix must end the display note');
  ok(/HPI:\n/.test(flat1) && /ASSESSMENT:\n/.test(flat1), rel + ': the five flat sections survive');

  /* 5. SOAP-wrapped note + appendix → flattened AND appendix preserved */
  ctx.__note = [
    'SUBJECTIVE:', 'HPI: Right knee pain for two weeks after a fall.', 'ROS: Negative except as in HPI.',
    'OBJECTIVE:', 'EXAM: Right knee with medial joint line tenderness.',
    'ASSESSMENT:', 'Right knee medial meniscus strain.',
    'PLAN:', 'Home exercise program; return in four weeks.',
    '', APPENDIX,
  ].join('\n');
  const flat2 = call('_flatSoapNote(__note)');
  ok(typeof flat2 === 'string' && flat2 && /^HPI:/.test(flat2), rel + ': wrapped SOAP must still flatten');
  ok(flat2.indexOf('PAST MEDICAL HISTORY ' + M) > flat2.indexOf('PLAN:'), rel + ': wrapped path keeps the appendix after PLAN');

  /* 6. appendix stranded MID-note is still lifted out — ROS stays clean */
  ctx.__note = FIVE.replace('EXAM:', APPENDIX + '\nEXAM:');
  const flat3 = call('_flatSoapNote(__note)');
  ok(typeof flat3 === 'string' && flat3, rel + ': mid-note appendix must not break the flatten');
  const rosBody = (flat3.split(/^ROS:$/m)[1] || '').split(/^EXAM:$/m)[0];
  ok(!/carried from last visit/.test(rosBody), rel + ': ROS must not absorb a mid-note appendix');
  ok(flat3.indexOf('PAST MEDICAL HISTORY ' + M) > flat3.indexOf('PLAN:'), rel + ': mid-note appendix moves to the end');

  /* 7. appendix at the TOP is lifted so the note still parses */
  ctx.__note = APPENDIX + '\n\n' + FIVE;
  const flat4 = call('_flatSoapNote(__note)');
  ok(typeof flat4 === 'string' && flat4 && /^HPI:/.test(flat4), rel + ': leading appendix must not kill the parse');
  ok(flat4.indexOf('PAST MEDICAL HISTORY ' + M) > flat4.indexOf('PLAN:'), rel + ': leading appendix moves to the end');

  /* 8. an UNMARKED history heading keeps today's behaviour — marker-gated on purpose */
  ctx.__note = FIVE + '\n\nPAST MEDICAL HISTORY:\nHypertension.';
  const flat5 = call('_flatSoapNote(__note)');
  ok(typeof flat5 === 'string' && /PLAN:[\s\S]*PAST MEDICAL HISTORY:/.test(flat5), rel + ': unmarked history still folds (unchanged behaviour)');

  /* 9. a plain five-section note is untouched by the appendix machinery */
  ctx.__note = FIVE;
  const flat6 = call('_flatSoapNote(__note)');
  ok(typeof flat6 === 'string' && !/carried from last visit/.test(flat6), rel + ': no appendix is ever invented');

  /* 10. a NON-allowlist marker heading is not split (closed list) and the
     validator refuses it — fail closed, never fail open */
  ctx.__note = FIVE + '\n\nMEDICATIONS ' + M + ':\nAspirin 81 mg daily.';
  const flat7 = call('_flatSoapNote(__note)');
  ok(typeof flat7 === 'string' && /PLAN:[\s\S]*MEDICATIONS/.test(flat7), rel + ': a medications block must never be treated as carriable');
  ctx.__bad = flat7;
  let medThrew = '';
  try { call('_mlsValidateAthenaNote(__bad)'); } catch (e) { medThrew = String((e && e.mlsAi && e.mlsAi.detail) || (e && e.message) || e); }
  ok(/carried-forward content is not allowed/.test(medThrew), rel + ': the validator must refuse leaked marker text');

  /* 11. APSO reorder lifts the appendix instead of dragging it with Plan */
  ctx.__note = [
    'Subjective: Knee pain, two weeks.',
    'Objective: Medial tenderness on exam.',
    'Assessment: Meniscus strain.',
    'Plan: HEP and NSAIDs.',
    '', APPENDIX,
  ].join('\n');
  const apso = call('_reorderNoteForStyle(__note, "apso")');
  ok(apso.indexOf('Assessment:') < apso.indexOf('Subjective:'), rel + ': APSO still fronts the assessment');
  ok(/Penicillin - rash\.\s*$/.test(apso), rel + ': APSO keeps the appendix at the very end');
  ok(apso.indexOf('PAST MEDICAL HISTORY ' + M) > apso.indexOf('Objective:'), rel + ': appendix must not travel to the front with Plan');

  /* 12. the athena door: display note + appendix + comment → EXACTLY five
     destinations, comment intact, zero marker text */
  ctx.__visitComment = 'Follow up in four weeks.';
  ctx.__note = FIVE + '\n\n' + APPENDIX;
  const canonical = call('_mlsAthenaNoteWithVisitComment(__note)');
  eq(canonical.sections.length, 5, rel + ': athena_note stays exactly five destinations');
  eq(canonical.sections.map((s) => s.key).join('|'), 'hpi|ros|exam|assessment|plan', rel + ': destination order is pinned');
  ok(!/carried from last visit/i.test(canonical.text), rel + ': the door must strip every marked block');
  ok(/COMMENT: Follow up in four weeks\./.test(canonical.text), rel + ': the visit comment still lands in PLAN');
  ctx.__visitComment = '';

  /* 13. validator backstop: marker inside a section body throws; clean passes */
  ctx.__bad = FIVE.replace('return in four weeks.', 'return in four weeks.\nAs ' + M + ' noted previously.');
  let threw = '';
  try { call('_mlsValidateAthenaNote(__bad)'); } catch (e) { threw = String((e && e.mlsAi && e.mlsAi.detail) || (e && e.message) || e); }
  ok(/carried-forward content is not allowed/.test(threw), rel + ': marker text inside a body must fail closed');
  ctx.__good = FIVE;
  const valid = call('_mlsValidateAthenaNote(__good)');
  eq(valid.sections.length, 5, rel + ': a clean five-section note still validates');

  /* 14. the strip is idempotent and honest on markerless text */
  ctx.__note = FIVE + '\n\n' + APPENDIX;
  const once = call('_autoDraftStripCarried(__note)');
  ctx.__once = once;
  eq(call('_autoDraftStripCarried(__once)'), once, rel + ': strip must be idempotent');
  ok(!/carried from last visit/.test(once) && /return in four weeks/.test(once), rel + ': strip removes only marked blocks');

  /* 15. dispatch: the legacy no-sidecar fallback strips before validating */
  ok(src.indexOf("result.athena_note==null?(typeof _autoDraftStripCarried==='function'?_autoDraftStripCarried(result.note):result.note):result.athena_note") > 0,
    rel + ': the generation fallback must strip the display note before it becomes athena_note');

  /* ---- adversarially-derived cases (round 2) -------------------------------- */

  /* 17. SWALLOW CURE: a real section AFTER the appendix ends the block — its
     content survives into the display plan AND the validated athena_note,
     instead of being silently deleted as "carried". */
  ctx.__note = FIVE + '\n\n' + APPENDIX + '\n\nFOLLOW-UP:\nReturn in two weeks for MRI review. Call sooner if the knee locks or gives way.';
  const flatSw = call('_flatSoapNote(__note)');
  ok(typeof flatSw === 'string' && /Call sooner if the knee locks/.test(flatSw), rel + ': content after the appendix must survive in the display note');
  const doorSw = call('_mlsAthenaNoteWithVisitComment(__note)');
  ok(/Call sooner if the knee locks/.test(doorSw.text), rel + ': content after the appendix must survive into athena_note (was silently deleted)');
  ok(!/carried from last visit/i.test(doorSw.text), rel + ': the appendix itself still never reaches athena_note');

  /* 18. same cure for a MEDICATIONS section after the appendix: the med list
     is NOT silently deleted as "carried" — it returns to the core, where the
     validator refuses the bare wrapper heading exactly as it always has
     (HEAD parity: fail closed and visibly, never a silent drop) */
  ctx.__note = FIVE + '\n\n' + APPENDIX + '\n\nMEDICATIONS:\nMetformin 1000 mg twice daily.\nLisinopril 10 mg daily.';
  ok(/Metformin 1000 mg/.test(call('_autoDraftStripCarried(__note)')), rel + ": today's medication list must never be swallowed by the strip");
  let medsDoorThrew = '';
  try { call('_mlsAthenaNoteWithVisitComment(__note)'); } catch (e) { medsDoorThrew = String((e && e.mlsAi && e.mlsAi.detail) || (e && e.message) || e); }
  ok(/nested or wrapper heading/.test(medsDoorThrew), rel + ': the door refuses the wrapper heading out loud (pre-change parity), not by silent deletion');

  /* 19. STOP IMMUNITY: carried prose that merely STARTS with a section word
     stays inside the block — it must not decapitate the appendix and spill
     history into the athena note */
  ctx.__note = FIVE + '\n\n' + [
    'PAST SURGICAL HISTORY ' + M + ':',
    'Exam under anesthesia, right knee, 2017.',
    'Plan for revision surgery discussed in 2020, deferred.',
    'Appendectomy 2010.',
  ].join('\n');
  const spIm = call('_autoDraftSplitCarried(__note)');
  ok(/Exam under anesthesia/.test(spIm.appendix) && /Plan for revision/.test(spIm.appendix) && /Appendectomy/.test(spIm.appendix),
    rel + ': carried prose starting with Exam/Plan must stay in the block');
  ok(!/Exam under anesthesia|Plan for revision|Appendectomy/.test(spIm.core), rel + ': no carried line may spill into the core');
  const doorIm = call('_mlsAthenaNoteWithVisitComment(__note)');
  ok(!/Exam under anesthesia|Appendectomy/.test(doorIm.text), rel + ': spilled history must not reach athena_note');

  /* 20. ABBREVIATION LIFT: the model echoing the block under a standard
     abbreviation is still recognised via the same closed allowlist */
  ctx.__note = FIVE + '\n\nPMH ' + M + ':\nHypertension.\nType 2 diabetes.';
  const spAb = call('_autoDraftSplitCarried(__note)');
  ok(/Hypertension/.test(spAb.appendix), rel + ': a PMH-abbreviated marked block must still be lifted');
  ok(!/Hypertension/.test(call('_mlsAthenaNoteWithVisitComment(__note)').text), rel + ': the abbreviated block must not reach athena_note');

  /* 21. BACKSTOP CALIBRATION — machinery-shaped remnants refuse, plain prose
     writes. (a) an ordinary sentence about the last visit is legitimate
     clinical text and must NOT kill the note (measured false-positive class);
     (b) a parenthesized carried marker refuses; (c) a parenthesized history
     wrapper heading refuses; (d) a sentinel remnant refuses. */
  ctx.__good = FIVE.replace('return in four weeks.', 'return in four weeks.\nThe medication list carried forward from the last visit was reviewed today.');
  eq(call('_mlsValidateAthenaNote(__good)').sections.length, 5, rel + ': plain prose about the last visit stays writable');
  for (const leak of ['A note (carried per protocol) follows.', 'PAST MEDICAL HISTORY (per prior note):', '==== CARRIED HISTORY remnant ====']) {
    ctx.__bad = FIVE.replace('return in four weeks.', 'return in four weeks.\n' + leak);
    let driftThrew = '';
    try { call('_mlsValidateAthenaNote(__bad)'); } catch (e) { driftThrew = String((e && e.mlsAi && e.mlsAi.detail) || (e && e.message) || e); }
    ok(/carried-forward content is not allowed/.test(driftThrew), rel + ': machinery-shaped remnant must fail closed: ' + leak);
  }

  /* 22. APPENDIX DOSE SCREEN: a dose line the model smuggles into a marked
     block is withheld from the display, and says so out loud */
  ctx.__note = FIVE + '\n\n' + [
    'PAST MEDICAL HISTORY ' + M + ':',
    'Hypertension.',
    'Lisinopril 10 mg daily.',
    'Type 2 diabetes.',
  ].join('\n');
  const flatDose = call('_flatSoapNote(__note)');
  ok(!/Lisinopril/.test(flatDose), rel + ': a smuggled dose line must never be displayed as carried history');
  ok(/1 medication\/dose line withheld/.test(flatDose), rel + ': the withheld dose line must be counted out loud');
  ok(/Hypertension/.test(flatDose) && /Type 2 diabetes/.test(flatDose), rel + ': non-dose history still displays');

  /* 23. PRIOR-NOTE FIELD CURE: a normally saved note stores content under
     `soap` — the carry must find it (it never did in production before) */
  ctx.getNotes = () => [{ id: 'n1', patientId: 'p1', kind: 'soap', soap: 'HPI:\nOld knee pain, well documented, from the previous encounter.\n\nPAST MEDICAL HISTORY:\nHypertension.', updated: 5 }];
  const prior = call('_autoDraftPriorNote("p1","")');
  ok(prior && prior.id === 'n1', rel + ': a soap-field-only saved note must be found as the prior note');
  ok(src.split("_autoDraftBuildSeed(String(prior.text||prior.soap||'')").length >= 3, rel + ': both seed builders must read text OR soap');

  /* 24. comment/signature fold: split FIRST (the greedy signature strip must
     never see the appendix), then comment+signature into the core, appendix
     last — executed over a full generate→save→save cycle */
  ok(src.indexOf("withSignatureBlock(withCommentBlock(stripSignatureBlock(__adSplit.core)))+'\\n\\n'+__adSplit.appendix") > 0,
    rel + ': applyVisitCommentToNote must split before the signature strip');
  {
    const avcn = liftFn(src, 'applyVisitCommentToNote', rel);
    const sctx = {
      currentSoap: FIVE + '\n\n' + APPENDIX,
      currentFormat: 'soap',
      document: { getElementById: () => null },
      _mlsSyncAthenaAfterStandardNoteMutation: () => true,
      withCommentBlock: (t) => t.replace(/(?:\nCOMMENT: [^\n]*)+$/, '') + '\nCOMMENT: Seen with chaperone.',
      withSignatureBlock: (t) => t + '\nElectronically signed by:\nAdam Smith, MD',
    };
    vm.createContext(sctx);
    vm.runInContext(liftFn(src, 'stripSignatureBlock', rel) + '\n' + liftAutodraftRegion(src, rel) + '\n' + avcn, sctx, { filename: rel + '#avcn' });
    vm.runInContext('applyVisitCommentToNote()', sctx);
    const call1 = sctx.currentSoap;
    vm.runInContext('applyVisitCommentToNote()', sctx);
    const call2 = sctx.currentSoap;
    vm.runInContext('applyVisitCommentToNote()', sctx);
    ok(/carried from last visit/.test(call2), rel + ': saving must never delete the carried appendix (signature-strip class)');
    eq(sctx.currentSoap, call2, rel + ': the save cycle must settle (call2 === call3)');
    ok(/Penicillin - rash\.\s*$/.test(call1), rel + ': the appendix stays last, after comment and signature');
  }

  /* 25. typed-note write door: strip first, and any surviving remnant demotes
     the write to the generic visible NOTE TEXT row (this branch has no
     validator behind it) */
  ok(src.indexOf("if(/\\([^)\\n]*carried[^)\\n]*\\)|={2,}\\s*(?:END\\s+)?CARRIED\\s+HISTORY/i.test(__typedSrc)) parsedSoap=null;") > 0,
    rel + ': the typed-note door must demote surviving remnants instead of parsing them into five destinations');

  /* 26. SENTINEL round-trip: everything between the sentinels is appendix,
     no matter what it contains — the measured decap-spill class */
  const SENT_B = '==== CARRIED HISTORY (from last visit - review; not written today) ====';
  const SENT_E = '==== END CARRIED HISTORY ====';
  ctx.__note = FIVE + '\n\n' + [SENT_B, 'PAST MEDICAL HISTORY (carried from last visit - review):', 'Hypertension.', 'Labs: A1c 7.1 in 2024.', '', 'ALLERGIES (carried from last visit - review):', 'Penicillin - rash.', SENT_E].join('\n');
  const spSent = call('_autoDraftSplitCarried(__note)');
  ok(/Labs: A1c 7\.1/.test(spSent.appendix) && !/Labs:/.test(spSent.core), rel + ': a heading-shaped line inside the sentinels stays appendix');
  const doorSent = call('_mlsAthenaNoteWithVisitComment(__note)');
  ok(!/A1c 7\.1|Penicillin|CARRIED HISTORY/i.test(doorSent.text), rel + ': nothing between the sentinels may reach athena_note');
  const flatSent = call('_flatSoapNote(__note)');
  ok(/Labs: A1c 7\.1/.test(flatSent) && flatSent.indexOf(SENT_B) > flatSent.indexOf('PLAN:'), rel + ': the sentinel block survives in the display, after the sections');

  /* 27. DECAP-SPILL CURE (un-sentineled): contiguous carried lines that look
     like known headings or carry doses stay in the block — never in PLAN */
  ctx.__note = FIVE + '\n\n' + [
    'PAST MEDICAL HISTORY ' + M + ':',
    'Hypertension.',
    'Labs: A1c 7.1 in 2024.',
    'Type 2 diabetes on metformin 1000 mg BID and insulin glargine 20 units nightly.',
  ].join('\n');
  const doorDecap = call('_mlsAthenaNoteWithVisitComment(__note)');
  ok(!/metformin|A1c/i.test(doorDecap.text), rel + ': stale dose lines must never spill into a validated PLAN (decap class)');
  const spDecap = call('_autoDraftSplitCarried(__note)');
  ok(/metformin/.test(spDecap.appendix) && /Labs: A1c/.test(spDecap.appendix), rel + ': the whole contiguous block stays carried');

  /* 28. CHAIN SURVIVAL: a prior note saved WITH its sentinel appendix still
     seeds the next visit's carry */
  ctx.__prior = FIVE + '\n\n' + [SENT_B, 'PAST MEDICAL HISTORY (carried from last visit - review):', 'Hypertension.', 'Type 2 diabetes.', SENT_E].join('\n');
  const seedChain = call('_autoDraftBuildSeed(__prior, "soap")');
  ok(seedChain.carried.some((c) => c.name === 'PAST MEDICAL HISTORY' && /Hypertension/.test(c.lines.join('\n'))), rel + ': the carry chain must survive its own saved output');

  /* 29. FALSE-LIFT CURE: a doctor's own parenthetical that is not a
     prior-visit marker is never lifted (today's plan text stays whole);
     the athena door then refuses it out loud rather than truncating */
  ctx.__note = FIVE.replace('return in four weeks.', 'return in four weeks.\nAllergies (carried over from the ED chart): penicillin per patient.\nStart ibuprofen 600 mg PO TID with food for two weeks.');
  const spFalse = call('_autoDraftSplitCarried(__note)');
  ok(/Start ibuprofen 600 mg/.test(spFalse.core) && !spFalse.appendix, rel + ': a non-marker parenthetical must never lift (today\'s plan stays whole)');
  let falseLiftThrew = '';
  try { call('_mlsAthenaNoteWithVisitComment(__note)'); } catch (e) { falseLiftThrew = String((e && e.mlsAi && e.mlsAi.detail) || (e && e.message) || e); }
  ok(/carried-forward content is not allowed/.test(falseLiftThrew), rel + ': the ambiguous carried-parenthetical fails closed, visibly — never a silent truncation');

  /* 30. INLINE-MENTION CURE: marker mid-sentence never lifts (no silent
     deletion of assessment text); it fails closed at the door instead */
  ctx.__note = FIVE.replace('improving.', 'improving. Allergies ' + M + ' were reconfirmed with the patient today.');
  const spInline = call('_autoDraftSplitCarried(__note)');
  ok(!spInline.appendix, rel + ': an inline marker mention must never start a block');

  /* 31. deep indentation does not defeat the lifter */
  ctx.__note = FIVE + '\n\n        PAST MEDICAL HISTORY ' + M + ':\n        Hypertension.';
  ok(/Hypertension/.test(call('_autoDraftSplitCarried(__note)').appendix), rel + ': an 8-space-indented marked heading still lifts');
}

/* 16. the twins ship the SAME bytes for every function this suite proved */
{
  const s1 = fs.readFileSync(path.join(ROOT, TWINS[0]), 'utf8');
  const s2 = fs.readFileSync(path.join(ROOT, TWINS[1]), 'utf8');
  for (const name of ['_autoDraftSplitCarried', '_autoDraftStripCarried', '_autoDraftMarkedHead', '_autoDraftStopHead', '_autoDraftScreenAppendix', '_flatSoapNote', '_reorderNoteForStyle', '_mlsValidateAthenaNote', '_mlsAthenaNoteWithVisitComment', '_autoDraftSeedBlock', '_autoDraftBuildSeed', '_autoDraftDoseLine', 'applyVisitCommentToNote']) {
    eq(liftFn(s1, name, TWINS[0]), liftFn(s2, name, TWINS[1]), 'twins must ship identical ' + name);
  }
  eq(liftAutodraftRegion(s1, TWINS[0]), liftAutodraftRegion(s2, TWINS[1]), 'twins must ship an identical autodraft region');
}

console.log('PASS autodraft-soap-carry-appendix: SOAP carries the history as a marked display-only appendix — the flattener and APSO reorder preserve it after the sections wherever the model left it, every athena door strips it, the validator refuses leaked marker text, the allowlist stays closed and the dose gate still drops drug lines (' + checks + ' checks across both twins)');

'use strict';
/* het-1.0.0 pins: THE WRITE DRIVER QUALIFIES ATHENACLINICALS STAGE SURFACES
 * WITHOUT LOOSENING ONE IDENTITY GATE.
 *
 * OLD BYTES FAIL BY NAME: the candidate loop required the patient banner and
 * the note editor in the SAME frame, so every write on the stage UI (banner
 * and editor split across frames) refused no-encounter-frame with the editor
 * open (live 2026-08-25, encounter meta present, editor present).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bg = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'background.js'), 'latin1');

/* the stage-context reader exists with its uniqueness refusals */
assert.ok(bg.includes('function hetStageEncounterContext(frame, expectedPatient) {'),
  'the stage-context reader is gone - stage surfaces cannot qualify again');
assert.ok(bg.includes('if (metas.length !== 1) { hetCommit(); return null; }'),
  'the one-context-META uniqueness refusal is gone');
assert.ok(bg.includes('if (!encId || encId.length < 3 || !metaPatient || !wantMrn || metaPatient !== wantMrn) { hetCommit(); return null; }'),
  'the meta patient_id === expected MRN gate is gone - a foreign chart could qualify');
assert.ok(bg.includes('if (appts.length !== 1) { hetCommit(); return null; }'),
  'the unique-appointment refusal is gone');
assert.ok(bg.includes('if (provs.length !== 1) { hetCommit(); return null; }'),
  'the unique-credentialed-provider refusal is gone');
assert.ok(bg.includes('if (dates.length !== 1) { hetCommit(); return null; }'),
  'the unique-service-date refusal is gone');

/* het-1.0.4: N parseable, AGREEING copies of one patient's header collapse to
   one identity; any disagreement or parse failure stays ambiguous */
assert.ok(bg.includes("if (allSame) return { identity: parsedAll[0], ambiguous: false };"),
  'the agreeing-copies collapse is gone - stage frames with duplicated headers refuse again');
assert.ok(bg.includes("if (!p1) { parsedAll = null; break; }"),
  'an unparseable header copy no longer forces ambiguity - the collapse lost its fail-closed edge');
assert.ok(bg.includes("return { identity: null, ambiguous: true };"),
  'the disagreement fallback is gone');

/* het-1.0.4: the stage context is consulted for every frame */
assert.ok(bg.includes('var hetStage = hetStageEncounterContext(fr, expectedPatient);'),
  'the always-consult seam is gone - own-identity frames lost the machine-typed sources');

/* ancestor-only banner inheritance, judged by the SAME gates */
assert.ok(bg.includes('hetStage = hetStageEncounterContext(fr, expectedPatient);'),
  'the candidate loop no longer consults the stage context');
assert.ok(bg.includes('hetAncWin = fr.w && fr.w.parent && fr.w.parent !== fr.w ? fr.w.parent : null;'),
  'the ancestor-frame walk is gone - identity inheritance lost its frame-chain restriction');
assert.ok(bg.includes('if (!observedIdentity) hetStage = null;'),
  'a stage frame with no ancestor banner no longer fails closed');
/* the classic identity gates still run verbatim on whatever identity was found */
assert.ok(bg.includes('if (nameKey(observedIdentity.name) !== nameKey(expectedPatient.name) || dateKey(observedIdentity.dob) !== dateKey(expectedPatient.dob)) { sawOtherPatient = true; continue; }'),
  'the name/DOB identity gate changed - the wrong-chart guarantee moved');
assert.ok(bg.includes('if (wantMrn && digits(observedIdentity.mrn) !== wantMrn) { sawOtherPatient = true; continue; }'),
  'the MRN identity gate changed - the wrong-chart guarantee moved');

/* the three observed-context sources prefer the machine-typed stage values,
   classic sources untouched otherwise */
assert.ok(bg.includes('var eid = hetStage ? hetStage.encounterId : encounterIdFor(fr, targetRoot, observedIdentity.root);'),
  'the encounter-id source seam is gone');
assert.ok(bg.includes('var observedAppointmentId = hetStage ? hetStage.appointmentId : appointmentIdFor(fr, targetRoot, observedIdentity.root);'),
  'the appointment-id source seam is gone');
assert.ok(bg.includes('var encounterMeta = hetStage ? { root: targetRoot, visitDate: hetStage.visitDate, provider: hetStage.provider } : encounterMetadataFor(fr, targetRoot, observedIdentity.root);'),
  'the visit-metadata source seam is gone');

/* the downstream equality gates still stand for both paths (het-1.1.6 added
   a postGate census stamp inside each continue - the gate itself must keep
   its exact condition and its continue) */
assert.ok(bg.includes("if (dateKey(expectedContext.visitDate) && encounterMeta.visitDate !== dateKey(expectedContext.visitDate)) { if (hetStage) hetDiag.postGate = 'visit-date'; continue; }"),
  'the expected-visit-date equality gate changed');
assert.ok(bg.includes("if (norm(expectedContext.provider) && norm(encounterMeta.provider) !== norm(expectedContext.provider)) { if (hetStage) hetDiag.postGate = 'provider'; continue; }"),
  'the expected-provider equality gate changed');
assert.ok(bg.includes("if (digits(expectedContext.appointmentId) && observedAppointmentId !== digits(expectedContext.appointmentId)) { if (hetStage) hetDiag.postGate = 'appointment-id'; continue; }"),
  'the expected-appointment equality gate changed');

/* behavioral: the three uniqueness regexes, extracted from the SHIPPED bytes
   and executed against live-shaped fixtures (escaped + plain serializations,
   a non-credentialed DisplayName decoy, a dated ScheduledDate object) */
const helperStart = bg.indexOf('function hetStageEncounterContext');
const helper = bg.slice(helperStart, helperStart + 3200);
const rex = (helper.match(/hetUniq\(\/(.+?)\/g/g) || []).map(s => new RegExp(s.slice(9, -2), 'g'));
assert.strictEqual(rex.length, 3, 'expected exactly three hetUniq regexes in the helper');
const fix = 'x\\"AppointmentID\\":\\"55816420\\"y' + '"AppointmentID":"55816420"'
  + ',"DisplayName":"Matthew Schaeffer, MD","DisplayName":"POSM CL West Chester",'
  + '"ScheduledDate":{"__CLASS__":"DateTime","Date":"2026-08-25T16:25:43-04:00"}';
const appts = [...new Set([...fix.matchAll(rex[0])].map(m => m[1]))];
assert.deepStrictEqual(appts, ['55816420'], 'the appointment regex no longer resolves one id across both serializations');
const provs = [...new Set([...fix.matchAll(rex[1])].map(m => m[1]).filter(v => /,\s*(?:MD|DO|PA-C|CRNP|NP|DPM)\s*$/.test(v)))];
assert.deepStrictEqual(provs, ['Matthew Schaeffer, MD'], 'the provider regex + credential filter no longer isolate the one clinician');
const dates = [...new Set([...fix.matchAll(rex[2])].map(m => m[1]))];
assert.deepStrictEqual(dates, ['2026-08-25'], 'the labeled-date regex no longer resolves the one service date');

console.log('PASS het stage-context pins: stage frames qualify only through the machine-typed context META + ancestor banner, every uniqueness refusal and identity/equality gate stands, and the shipped regexes resolve live-shaped serializations');

/* het-1.1.4: named-note scopes admit direct-child-heading hosts (the athena
   stage card shape: div.card host, H3.athena-header label, one slate editor).
   The block must sit INSIDE namedNoteScopes between the attribute query and
   the gate filter, and must only ever ADD candidates via parentElement -
   never touch the gates. */
const nnsStart = bg.indexOf('function namedNoteScopes');
const nnsEnd = bg.indexOf('function findNamedNoteAction', nnsStart);
assert.ok(nnsStart > 0 && nnsEnd > nnsStart, 'namedNoteScopes/findNamedNoteAction moved');
const nns = bg.slice(nnsStart, nnsEnd);
assert.ok(nns.includes("deepQueryAll(frame.doc, 'legend,h1,h2,h3,h4,header,[role=\"heading\"]')"),
  'the heading-parent candidate query is gone from namedNoteScopes');
assert.ok(nns.includes('if (hetPar && raw.indexOf(hetPar) < 0) raw.push(hetPar);'),
  'the heading-parent push (dedup guarded) is gone');
assert.ok(nns.indexOf('raw.push(hetPar)') < nns.indexOf('raw = raw.filter'),
  'heading parents must join the pool BEFORE the gate filter runs');
assert.ok(nns.includes('if (keys.length !== 1 || keys[0] !== key) return false;'),
  'the one-canonical-key gate left namedNoteScopes');
assert.ok(nns.includes('return namedOwnedEditors(frame, el, key).length === 1;'),
  'the one-owned-editor gate left namedNoteScopes');
assert.ok(nns.includes('return collapseContainedMatches(raw);'),
  'the containment collapse left namedNoteScopes');
assert.ok(bg.includes('if (scopes.length !== 1) return null;'),
  'findNamedNoteAction no longer refuses on scope ambiguity');

console.log('PASS het-1.1.4 pins: heading-parent candidates feed the same fail-closed named-scope gates');

/* het-1.1.5: heading labels read the heading's own title. The helper must
   exist, both heading-label readers must route through it, and the un-welding
   must be EXECUTED against the live-shaped H3 (leaf title child + nested
   "Findings" furniture + whitespace-only own text nodes). */
assert.ok(bg.includes('function namedHeadingOwnText(head)'), 'namedHeadingOwnText helper is gone');
const hotUses = (bg.match(/var hot = namedHeadingOwnText\(heads\[i\]\); if \(hot\) out\.push\(hot\);/g) || []).length;
assert.strictEqual(hotUses, 2, 'expected BOTH heading-label readers (section labels + human labels) to use namedHeadingOwnText');
{
  const hotStart = bg.indexOf('function namedHeadingOwnText(head)');
  const hotEnd = bg.indexOf('function namedSectionDescriptor', hotStart);
  const textFn = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const hot = new Function('text', 'return ' + bg.slice(hotStart, hotEnd))(textFn);
  const leaf = t => ({ nodeType: 1, textContent: t, childNodes: [], children: [] });
  const h3 = { nodeType: 1, textContent: '\n\t\tHistory of Present Illness\n\t\tFindings\n\t',
    childNodes: [{ nodeType: 3, nodeValue: '\n\t\t' }, leaf('History of Present Illness'), { nodeType: 3, nodeValue: '\n\t' }, leaf('Findings')],
    children: [leaf('History of Present Illness'), leaf('Findings')] };
  assert.strictEqual(hot(h3), 'History of Present Illness', 'welded stage H3 must yield its first text-bearing child');
  const plain = { nodeType: 1, textContent: 'Assessment', childNodes: [{ nodeType: 3, nodeValue: 'Assessment' }], children: [] };
  assert.strictEqual(hot(plain), 'Assessment', 'a plain-text heading keeps its whole text');
  const mixed = { nodeType: 1, textContent: 'HPI x', childNodes: [{ nodeType: 3, nodeValue: 'HPI ' }, leaf('x')], children: [leaf('x')] };
  assert.strictEqual(hot(mixed), 'HPI x', 'a heading with its own text node keeps the whole text (no cherry-picking)');
}

console.log('PASS het-1.1.5 pins: heading own-title reading is shared by both label readers and un-welds the live stage shape');

/* het-1.1.7: the stage visit date is stored in canonical m/d/yyyy key form -
   dateKey mangles ISO ('2026-08-25' -> '6/8/2025'), which the postGate census
   caught as the visit-date drop. Execute the shipped conversion. */
{
  const convStart = bg.indexOf('var hetIso = ');
  assert.ok(convStart > 0, 'the ISO visit-date conversion is gone');
  const convEnd = bg.indexOf(';', bg.indexOf('var visitDate', convStart));
  const conv = bg.slice(convStart, convEnd + 1);
  const run = new Function('dates', 'dateKey', conv + ' return visitDate;');
  const dk = () => { throw new Error('dateKey must not run on a strict ISO capture'); };
  assert.strictEqual(run(['2026-08-25'], dk), '8/25/2026', 'ISO capture must convert to the canonical m/d/yyyy key');
  assert.strictEqual(run(['2026-01-05'], dk), '1/5/2026', 'leading zeros must drop like dateKey does');
}

console.log('PASS het-1.1.7 pins: the shipped ISO conversion yields the canonical visit-date key');

/* het-1.1.8 (Codex release-review invariant): meta-only admission is allowed
   only when genuinely no credible parsed identity exists. The presence reader
   is extracted from the SHIPPED bytes and executed against the four cases:
   foreign, decorative-noise, expected-present, no-banner. */
{
  const haStart = bg.indexOf('function hetAncestorIdentity');
  const haEnd = bg.indexOf('function hetStageEncounterContext', haStart);
  assert.ok(haStart > 0 && haEnd > haStart, 'hetAncestorIdentity moved');
  const haSrc = bg.slice(haStart, haEnd);
  const nameKeyStub = n => String(n || '').toLowerCase().replace(/[^a-z]/g, '');
  const mk = roots => new Function('identityRoots', 'parseIdentity', 'nameKey', 'dateKey', 'digits', 'return ' + haSrc)(
    () => roots.map((r, i) => i), i => roots[i], nameKeyStub, d => String(d || ''), v => String(v || '').replace(/\D/g, ''));
  const expected = { name: 'Adam J Schaeffer', dob: '03/24/2006', mrn: '7833832' };
  const foreign2 = mk([{ name: 'Pat Q Other', dob: '01/01/1990', mrn: '111' }, { name: 'Sam R Else', dob: '02/02/1985', mrn: '222' }])(null, expected);
  assert.strictEqual(foreign2.identity, null, 'two foreign roots must not yield an identity');
  assert.strictEqual(foreign2.foreign, true, 'two complete parsed foreign roots MUST flag foreign (the Codex VM repro)');
  const decorative = mk([{ name: 'Adam J Schaeffer', dob: '08/25/2026', mrn: '' }])(null, expected);
  assert.strictEqual(decorative.foreign, false, 'a same-name appointment strip stays decoration (het-1.0.9 noise class)');
  const present = mk([{ name: 'Adam J Schaeffer', dob: '03/24/2006', mrn: '7833832' }, { name: 'Pat Q Other', dob: '01/01/1990', mrn: '111' }])(null, expected);
  assert.ok(present.identity, 'the expected banner must still be accepted');
  assert.strictEqual(present.foreign, true, 'the foreign flag must survive alongside acceptance');
  const empty = mk([])(null, expected);
  assert.ok(!empty.foreign, 'no roots means no foreign evidence - meta-bound may proceed');
  /* the loop wiring: foreign accumulates from self + every walked ancestor and
     blocks the meta-bound branch BEFORE it fires, with a truthful census stamp */
  assert.ok(bg.includes("var hetForeign = !!(hetSelf && hetSelf.foreign);"), 'the self foreign accumulator is gone');
  assert.ok(bg.includes("if (hetHeader.foreign) hetForeign = true;"), 'the walk foreign accumulator is gone');
  assert.ok(bg.includes("if (!observedIdentity && hetWalkVerdict === 'none-found' && hetForeign) {"), 'the foreign refusal gate is gone');
  assert.ok(bg.includes("hetWalkVerdict = 'foreign-identity-present';"), 'the foreign refusal verdict is gone');
  assert.ok(bg.indexOf("hetWalkVerdict = 'foreign-identity-present'") < bg.indexOf("hetWalkVerdict = 'meta-bound'"), 'the foreign gate must run BEFORE meta-bound');
  const stampLF = bg.includes("hetDiag.ancestorIdentity = hetWalkVerdict;\n          if (!observedIdentity) hetStage = null;");
  const stampCRLF = bg.includes("hetDiag.ancestorIdentity = hetWalkVerdict;\r\n          if (!observedIdentity) hetStage = null;");
  assert.ok(stampLF || stampCRLF, 'the truthful post-branch census re-stamp is gone');
}

console.log('PASS het-1.1.8 pins: complete parsed foreign identities block meta-only admission (executed from shipped bytes)');

/* sn-1.0.0: the stage-nav pre-pass may click ONLY a whitelisted nav bead
   (HPI/ROS/PE/A/P - never Sign-off, never Review), only in a frame whose
   machine-typed stage context already binds the expected patient, never a
   forbidden control, at most one click, BEFORE the unchanged candidate loop. */
{
  const snStart = bg.indexOf("var snTabs = ");
  assert.ok(snStart > 0, 'the stage-nav whitelist is gone');
  assert.ok(bg.includes("var snTabs = { hpi: 'HPI', ros: 'ROS', exam: 'PE', assessment: 'A/P', plan: 'A/P', ap: 'A/P' };"),
    'the stage-nav tab whitelist changed - Sign-off/Review must never be reachable');
  assert.ok(!/snTabs = \{[^}]*Sign/i.test(bg), 'Sign-off leaked into the stage-nav whitelist');
  const snBlock = bg.slice(snStart, bg.indexOf('var frames = sameOriginFrames()', snStart));
  assert.ok(snBlock.includes('var snStage = hetStageEncounterContext(snFr, expectedPatient);'),
    'stage-nav no longer requires the machine-bound stage context before any click');
  assert.ok(snBlock.includes('if (!snStage) continue;'), 'an unbound frame can now be navigated');
  assert.ok(snBlock.includes('if (wsForbiddenControl(snClick)) {'), 'the forbidden-control refusal left the stage-nav click');
  assert.ok(snBlock.includes("if (findNamedNoteAction(snFr, action, requestedNoteSection)) { hetDiag.stageNav = 'not-needed'; break; }"),
    'stage-nav must be skipped when the section already binds');
  assert.ok((snBlock.match(/snClick\.click\(\)/g) || []).length === 1, 'stage-nav must click at most once');
  assert.ok(snStart < bg.indexOf('var frames = sameOriginFrames(), candidates = [], sawOtherPatient = false;'),
    'the pre-pass must run BEFORE the candidate loop');
  assert.ok(bg.includes("if (action === 'write_note' && requestedNoteSection && requestedNoteSection !== 'note') {"),
    'stage-nav must be limited to named write_note sections');
}

console.log('PASS sn-1.0.0 pins: stage-nav pre-pass is whitelisted, machine-bound, single-click, and loop-preserving');

/* ap-1.0.0: the combined Assessment & Plan note is an EXPLICIT distinct
   destination - one exact label core, its own destination string, discovered
   through the machine subsection anchor. The separate assessment/plan keys
   keep refusing combined labels (a combined label maps only to 'ap'). */
{
  assert.ok(bg.includes("ap: { 'assessment and plan': 1 },"), 'the ap key lost its one exact label');
  assert.ok(bg.includes("ap: 'Athena encounter > Assessment & Plan',"), 'the ap destination string changed');
  assert.ok(bg.includes("ap: 'ap', assessment_and_plan: 'ap', assessment_plan: 'ap', a_and_p: 'ap'"), 'the ap canonical aliases are gone');
  assert.ok(bg.includes("[aria-label],[data-subsection-id]'"), 'the data-subsection-id scope anchor left the selector');
  const dsCount = (bg.match(/el\.getAttribute\('data-subsection-id'\)/g) || []).length;
  assert.strictEqual(dsCount, 2, 'both label readers (section labels + descriptor) must read data-subsection-id');
  /* EXECUTED: the shipped clinicalLabelCore resolves both live machine anchors
     and the visible heading title to the ONE ap core - and to NOTHING else */
  const clcStart = bg.indexOf('function clinicalLabelCore');
  const clcEnd = bg.indexOf('function directHumanLabels', clcStart);
  const textFn = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const normFn = v => textFn(v).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const clc = new Function('norm', 'return ' + bg.slice(clcStart, clcEnd))(normFn);
  assert.strictEqual(clc('assessment-and-plan'), 'assessment and plan', 'the section id no longer resolves the ap core');
  assert.strictEqual(clc('assessment_and_plan'), 'assessment and plan', 'the data-subsection-id no longer resolves the ap core');
  assert.strictEqual(clc('Assessment & Plan'), 'assessment and plan', 'the visible heading title no longer resolves the ap core');
  /* the separate keys must NOT accept the combined core */
  const defsStart = bg.indexOf('var NAMED_NOTE_DEFS = {');
  const defs = new Function('return ' + bg.slice(defsStart + 22, bg.indexOf('};', defsStart) + 1))();
  assert.ok(!defs.assessment['assessment and plan'] && !defs.plan['assessment and plan'],
    'the combined core leaked into a separate key - the two independent destinations lost their refusal');
  assert.strictEqual(defs.ap['assessment and plan'], 1, 'the ap key does not accept its own core');
}

console.log('PASS ap-1.0.0 pins: the combined A&P destination is exact, machine-anchored, and never satisfies the separate keys');

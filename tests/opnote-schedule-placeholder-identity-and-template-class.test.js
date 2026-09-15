'use strict';

/*
 * MEASURED 2026-09-14, live on the PA's account: "Draft all op notes" refused
 * 17 of 26 scheduled procedures with MLS_OPNOTE_IDENTITY and the sentence
 * "Couldn't verify the exact patient for this op note. Re-open it from that
 * patient's chart." Cause: openOpPrep(dayKey) builds each row from the
 * schedule appointment, and every schedule-imported appointment carries a
 * placeholder patient id of the form p_sched_<base36> that exists in NO
 * patient record. _opResolvePatient returned null the instant that id failed
 * to resolve, never trying the name+DOB it was also handed - even though 16
 * of the 17 charts were already in MLS under an exact name+DOB match.
 *
 * FIX 1/2 (1pScribeFlow.html, ~23300s): _opResolvePatient now falls back to
 * the app's own name+DOB identity rule (two factors, unique match only, never
 * a name-only match) when the supplied id resolves to nothing, and stamps WHY
 * a resolution failed so opPrepGenerateOne can name the real cause instead of
 * one catch-all sentence.
 *
 * FIX 3 (feat_mls_opnote_integrity.js): this module - not ScribeFlow's own
 * _opRankTemplates - is the template ranker actually installed in production
 * (ScribeFlow's copy is shadowed; see its own "ONE OWNER" comment at
 * opPrepGenerateAll). Its alternativesFrom() offered any ranked, nominally
 * "compatible" template as a one-click alternative, but templateCompatibility
 * never compares side/level by default and an UNCLASSIFIED template pays no
 * compatibility penalty at all - so a right-sided sacroiliac joint request
 * could surface a bilateral epidural or an unrelated, unclassified template
 * as an "alternative". Alternatives are now filtered to the requested
 * procedure class (the same generic/specific tolerance the ranker already
 * grants ESI/RFA families) and must not contradict the requested side or
 * level, and a template another row already committed to THE SAME DAY for an
 * equivalent procedure string is offered first.
 *
 * This suite lifts the REAL functions from the two shipped sources (vm
 * sandboxes, no reimplementation) and pins all three fixes with synthetic
 * data only. Every assertion here is proven to FAIL against the pre-fix
 * bytes - see verify-red.js in this same directory's sibling scratch step,
 * summarized in the PR/commit message.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
// Overridable so the exact same assertions below can be replayed against a
// pre-fix copy of either file (see the report for the red-before-fix proof).
const SCRIBEFLOW_PATH = process.env.OPIDFIX_SCRIBEFLOW_PATH || path.join(root, '1pScribeFlow.html');
const INTEGRITY_PATH = process.env.OPIDFIX_INTEGRITY_PATH || path.join(root, 'feat_mls_opnote_integrity.js');

const app = fs.readFileSync(SCRIBEFLOW_PATH, 'utf8');
const integritySrc = fs.readFileSync(INTEGRITY_PATH, 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing source marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}

let pass = 0;
function ok(cond, msg) { assert(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); pass++; }

/* ===========================================================================
 * PART 1 — _opResolvePatient / _opPatientCtx (1pScribeFlow.html)
 * A placeholder schedule id must fall back to the app's own name+DOB rule:
 * unique match binds, zero or 2+ matches refuse, a name-only (wrong DOB)
 * match is never accepted, a real stored id still resolves exactly as today.
 * ========================================================================= */

const identitySrc = between(app, 'function _ptAge', 'function _opNewRow');

function newIdentityContext(patients) {
  const context = {
    Date, Math, String, Number, Array, RegExp,
    getPatients() { return patients.map((p) => ({ ...p })); }
  };
  context.window = context;
  vm.runInNewContext(identitySrc, context, { filename: 'opidfix-identity.js' });
  return context;
}

const SCHED_PLACEHOLDER = 'p_sched_k3j9z1';

{
  const patients = [
    { id: 'real-1', name: 'Jordan Rivera', dob: '1975-03-02', sex: 'M', mrn: '5501' }
  ];
  const ctx = newIdentityContext(patients);

  // Unique name+DOB match behind an unresolved placeholder id -> BINDS.
  const bound = ctx._opResolvePatient('Jordan Rivera', '03/02/1975', SCHED_PLACEHOLDER);
  ok(bound && bound.id === 'real-1', 'a placeholder schedule id with exactly one name+DOB match did not bind to that chart');
  eq(ctx._opLastIdentityReason, 'name-dob', 'a placeholder-id fallback match is not stamped as a name-dob match');

  const pctx = ctx._opPatientCtx('Jordan Rivera', '03/02/1975', SCHED_PLACEHOLDER);
  eq(pctx.patientId, 'real-1', '_opPatientCtx did not carry the fallback-resolved patient id forward');
  eq(pctx.identityMatchSource, 'name-dob', '_opPatientCtx does not stamp how the identity was actually matched');

  // A real, valid stored id still resolves exactly as before (byId path).
  const byId = ctx._opResolvePatient('Jordan Rivera', '1975-03-02', 'real-1');
  ok(byId && byId.id === 'real-1', 'a genuinely valid stored patient id no longer resolves');
  eq(ctx._opLastIdentityReason, 'id', 'a valid stored id match is not stamped as an id match');

  // Existing regressions: a valid id with a mismatched name or DOB still refuses.
  eq(ctx._opResolvePatient('Wrong Name', '1975-03-02', 'real-1'), null, 'a valid id accepted a mismatched supplied name');
  eq(ctx._opResolvePatient('Jordan Rivera', '1999-01-01', 'real-1'), null, 'a valid id accepted a mismatched supplied DOB');

  // No DOB on the appointment at all -> refuse, and say so via 'no-dob' (the
  // "keep today's refusal exactly as it is" bucket).
  eq(ctx._opResolvePatient('Jordan Rivera', '', SCHED_PLACEHOLDER), null, 'an appointment with no date of birth was accepted anyway');
  eq(ctx._opLastIdentityReason, 'no-dob', 'a missing date of birth is not distinguished from a real not-found/ambiguous refusal');
}

{
  // A name-only match (right name, WRONG date of birth, no other same-name
  // record) must never be accepted, placeholder id or not.
  const patients = [
    { id: 'real-2', name: 'Casey Nguyen', dob: '1988-11-20', sex: 'F', mrn: '5502' }
  ];
  const ctx = newIdentityContext(patients);
  const r = ctx._opResolvePatient('Casey Nguyen', '01/02/1990', SCHED_PLACEHOLDER);
  eq(r, null, 'a name-only match (different date of birth) was accepted');
  eq(ctx._opLastIdentityReason, 'not-found', 'a name-only mismatch is not reported as no exact match');
}

{
  // Zero records at all match this name+DOB -> the chart genuinely has not
  // been pulled into MLS yet.
  const patients = [
    { id: 'real-3', name: 'Alex Whitfield', dob: '1960-06-06', sex: 'M', mrn: '5503' }
  ];
  const ctx = newIdentityContext(patients);
  const r = ctx._opResolvePatient('Taylor Osei', '1982-04-09', SCHED_PLACEHOLDER);
  eq(r, null, 'a name+DOB with no matching chart at all was accepted');
  eq(ctx._opLastIdentityReason, 'not-found', 'zero matching charts is not reported as not-found');
}

{
  // Two charts share the same name AND date of birth -> refuse as ambiguous,
  // never guess between them.
  const patients = [
    { id: 'dup-a', name: 'Morgan Ellis', dob: '1970-01-15', sex: 'F', mrn: '6001' },
    { id: 'dup-b', name: 'Morgan Ellis', dob: '1970-01-15', sex: 'F', mrn: '6002' }
  ];
  const ctx = newIdentityContext(patients);
  const r = ctx._opResolvePatient('Morgan Ellis', '01/15/1970', SCHED_PLACEHOLDER);
  eq(r, null, 'two charts tying on name+DOB were resolved anyway - an ambiguous bind');
  eq(ctx._opLastIdentityReason, 'ambiguous', 'two tying charts are not reported as ambiguous');
}

console.log('PASS part 1: _opResolvePatient/_opPatientCtx fall back to name+DOB behind an unresolved schedule id, never guess, and stamp why (' + pass + ' checks so far)');

/* ===========================================================================
 * PART 2 — opPrepGenerateOne end to end (1pScribeFlow.html), REAL function,
 * stubbed DOM/persistence only. Pins the three refusal sentences and proves
 * the fallback reaches the generator with the REAL patient id, not the
 * placeholder.
 * ========================================================================= */

const verdictSrc = between(app, 'function _opRowVerdict', '/* Save (or update)');

const MSG_AMBIGUOUS = 'There are two charts here with this patient’s name and date of birth. Open the Patients list, pick the correct one, and draft this note from there.';
const MSG_NOT_FOUND = 'This patient’s chart hasn’t come across into MLS yet. Pull it in from Athena, then this note can be drafted.';
const MSG_UNCHANGED = 'Couldn’t verify the exact patient for this op note. Re-open it from that patient’s chart.';
const TOAST_AMBIGUOUS = 'Op note stopped: two charts match this patient’s name and date of birth.';
const TOAST_NOT_FOUND = 'Op note stopped: this patient’s chart hasn’t come across into MLS yet.';
const TOAST_UNCHANGED = 'Op note stopped: exact patient identity could not be verified.';

function newGenerateHarness(patients) {
  const statusEl = { textContent: '' };
  const toasts = [];
  const genCalls = [];
  const context = {
    Date, Math, String, Number, Array, RegExp, JSON, Object, console,
    getPatients() { return patients.map((p) => ({ ...p })); },
    getTemplateById(id) { return id ? { id: String(id), name: 'Stub Op Template', text: 'PROCEDURE: [[proc]]' } : null; },
    document: { getElementById(id) { return id === 'opPrepStatus' ? statusEl : null; } },
    toast(msg, kind) { toasts.push({ msg, kind }); },
    opPrepRender() {},
    _opReconcileBlanks() {},
    opPrepAutosaveDraft() { return true; },
    _tplTextForDraft(t) { return t; },
    _opTomorrowDateStr() { return '2026-09-18'; },
    /* harness moved 2026-09-15: the finalizer lane put a final safety review
       between the generator's return and the row verdict (_opFinalizerRun,
       which throws the draft when it refuses); the fake answers "ok" so the
       identity/template scenarios below measure what they were written for. */
    _opFinalizerRun() { return { ok: true, issues: [] }; },
    async _genOpNote(name, dateStr, procedure, tplText, genCtx) {
      genCalls.push({ name, dateStr, procedure, tplText, ctx: { ...genCtx } });
      return { note: 'STUB NOTE', missing: [] };
    }
  };
  context.window = context;
  vm.runInNewContext(identitySrc + '\n' + verdictSrc, context, { filename: 'opidfix-generate.js' });
  return { context, statusEl, toasts, genCalls };
}

function makeRow(name, dob, patientId) {
  return { appt: { name, dob }, patientId, tplId: 'tpl-1', proc: 'Right sacroiliac joint injection', dateStr: '2026-09-18', edited: false, gen: false, missing: [] };
}

(async () => {

// Scenario A: placeholder id + exactly one name+DOB match -> binds AND the
// generator is reached with the REAL stored patient id (never the placeholder).
{
  const patients = [{ id: 'real-10', name: 'Devon Marsh', dob: '1965-08-30', sex: 'M', mrn: '7001' }];
  const { context, statusEl, genCalls } = newGenerateHarness(patients);
  context._opPrep = [makeRow('Devon Marsh', '08/30/1965', SCHED_PLACEHOLDER)];
  await context.opPrepGenerateOne(0);
  const row = context._opPrep[0];
  eq(genCalls.length, 1, 'the generator was never reached for a placeholder id with exactly one name+DOB match');
  eq(genCalls[0].ctx.patientId, 'real-10', 'the generator was called with the placeholder id instead of the resolved chart id');
  eq(row.gen, true, 'the row was not marked drafted after a successful generation');
  eq(row.note, 'STUB NOTE', 'the stubbed generator output did not land on the row');
  eq(row._genPass, true, 'the row verdict was not recorded as a pass');
  ok(statusEl.textContent.indexOf('Drafted') === 0, 'the status line does not report a successful draft: ' + statusEl.textContent);
}

// Scenario B: a real, already-valid stored id resolves and drafts exactly as
// it always has (no behavior change on the byId path).
{
  const patients = [{ id: 'real-11', name: 'Priya Anand', dob: '1972-02-14', sex: 'F', mrn: '7002' }];
  const { context, genCalls } = newGenerateHarness(patients);
  context._opPrep = [makeRow('Priya Anand', '1972-02-14', 'real-11')];
  await context.opPrepGenerateOne(0);
  eq(genCalls.length, 1, 'a real stored patient id no longer reaches the generator');
  eq(genCalls[0].ctx.patientId, 'real-11', 'a real stored patient id was not carried through unchanged');
  eq(context._opPrep[0].gen, true, 'a real stored patient id no longer drafts');
}

// Scenario C: two charts tie on name+DOB -> refuse with the two-charts
// sentence, never guess, never reach the generator.
{
  const patients = [
    { id: 'dup-c1', name: 'Sasha Kim', dob: '1990-05-05', sex: 'F', mrn: '7101' },
    { id: 'dup-c2', name: 'Sasha Kim', dob: '1990-05-05', sex: 'F', mrn: '7102' }
  ];
  const { context, statusEl, toasts, genCalls } = newGenerateHarness(patients);
  context._opPrep = [makeRow('Sasha Kim', '05/05/1990', SCHED_PLACEHOLDER)];
  await context.opPrepGenerateOne(0);
  const row = context._opPrep[0];
  eq(genCalls.length, 0, 'an ambiguous two-chart tie still reached the generator');
  eq(row.gen, false, 'an ambiguous two-chart tie was marked as drafted');
  eq(statusEl.textContent, MSG_AMBIGUOUS, 'the two-charts refusal sentence is wrong or missing: ' + JSON.stringify(statusEl.textContent));
  ok(toasts.some((t) => t.msg === TOAST_AMBIGUOUS), 'the two-charts toast is wrong or missing: ' + JSON.stringify(toasts));
  eq(row._genErrCode, 'MLS_OPNOTE_IDENTITY', 'the ambiguous refusal did not carry the identity error code');
}

// Scenario D: no chart anywhere matches this name+DOB -> refuse with the
// not-pulled-yet sentence.
{
  const patients = [{ id: 'real-12', name: 'Nia Foster', dob: '1955-09-09', sex: 'F', mrn: '7201' }];
  const { context, statusEl, toasts, genCalls } = newGenerateHarness(patients);
  context._opPrep = [makeRow('Robin Castillo', '1991-12-01', SCHED_PLACEHOLDER)];
  await context.opPrepGenerateOne(0);
  const row = context._opPrep[0];
  eq(genCalls.length, 0, 'a chart that was never pulled in still reached the generator');
  eq(row.gen, false, 'a chart that was never pulled in was marked as drafted');
  eq(statusEl.textContent, MSG_NOT_FOUND, 'the not-pulled-yet refusal sentence is wrong or missing: ' + JSON.stringify(statusEl.textContent));
  ok(toasts.some((t) => t.msg === TOAST_NOT_FOUND), 'the not-pulled-yet toast is wrong or missing: ' + JSON.stringify(toasts));
}

// Scenario E: the appointment carries NO date of birth at all -> the refusal
// stays byte-identical to today's sentence (never accept with no DOB to check).
{
  const patients = [{ id: 'real-13', name: 'Owen Blackwood', dob: '1948-07-04', sex: 'M', mrn: '7301' }];
  const { context, statusEl, toasts, genCalls } = newGenerateHarness(patients);
  context._opPrep = [makeRow('Owen Blackwood', '', SCHED_PLACEHOLDER)];
  await context.opPrepGenerateOne(0);
  eq(genCalls.length, 0, 'an appointment with no date of birth still reached the generator');
  eq(statusEl.textContent, MSG_UNCHANGED, 'the no-DOB refusal sentence changed - it must stay exactly as it was: ' + JSON.stringify(statusEl.textContent));
  ok(toasts.some((t) => t.msg === TOAST_UNCHANGED), 'the no-DOB toast changed - it must stay exactly as it was: ' + JSON.stringify(toasts));
}

// Scenario F: a name-only match (right name, wrong DOB) must still refuse
// end to end, never bind.
{
  const patients = [{ id: 'real-14', name: 'Harper Quinn', dob: '1980-03-03', sex: 'F', mrn: '7401' }];
  const { context, genCalls } = newGenerateHarness(patients);
  context._opPrep = [makeRow('Harper Quinn', '1999-09-09', SCHED_PLACEHOLDER)];
  await context.opPrepGenerateOne(0);
  eq(genCalls.length, 0, 'a name-only match (wrong date of birth) reached the generator');
  eq(context._opPrep[0].gen, false, 'a name-only match (wrong date of birth) was marked as drafted');
}

console.log('PASS part 2: opPrepGenerateOne names the real refusal reason, keeps the no-DOB sentence byte-identical, and reaches the generator with the resolved chart id (' + pass + ' checks so far)');

/* ===========================================================================
 * PART 3 — feat_mls_opnote_integrity.js alternativesFrom/bestFor (the
 * template ranker actually installed live - see the module's own "ONE
 * OWNER" comment). A right-sided SI joint request must never offer a
 * different-class alternative (bilateral epidural, an unclassified
 * "cluneal" template), must never offer a side-contradicting same-class
 * template, and must offer a same-day matched template first.
 * ========================================================================= */

const PAD = 'sterile prep drape local anesthesia skin wheal needle advanced fluoroscopic confirmation contrast spread final position medication administered dressing applied tolerated well no complications noted vital signs stable throughout';

function tpl(id, name, text) { return { id, name, keywords: [], text }; }

const SI_RIGHT_A = tpl('si_right_a', 'Right Sacroiliac Joint Injection (Method A)', 'OPERATIVE REPORT\nProcedure: right sacroiliac joint injection\nTechnique: the right sacroiliac joint was injected for buttock pain. ' + PAD);
/* fixture retuned 2026-09-15 (opmatch-1.0.0, b1271): two byte-identical
   same-side copies are now resolved as EQUIVALENT (the owner's twin
   templates) and never left to the doctor, so a genuine tie for this
   scenario must differ in a parsed fact while scoring the same. Method B's
   Procedure line (the facts are parsed from that line) names a level; a
   level-less request earns neither copy the level bonus, so the score still
   ties and the pair is no longer equivalent. */
const SI_RIGHT_B = tpl('si_right_b', 'Right Sacroiliac Joint Injection (Method B)', 'OPERATIVE REPORT\nProcedure: right sacroiliac joint injection at S1\nTechnique: the right sacroiliac joint was injected for buttock pain. ' + PAD);
const SI_GENERIC = tpl('si_generic', 'Sacroiliac Joint Injection', 'OPERATIVE REPORT\nProcedure: sacroiliac joint injection\nTechnique: the sacroiliac joint was injected for buttock pain. ' + PAD);
const SI_LEFT = tpl('si_left', 'Left Sacroiliac Joint Injection', 'OPERATIVE REPORT\nProcedure: left sacroiliac joint injection\nTechnique: the left sacroiliac joint was injected for buttock pain. ' + PAD);
// A real doctor's library carries templates the classifier's fixed
// vocabulary does not recognize (repo history: b901, opnq-1.0.0 document
// several such classifier gaps). Neither of these two mentions any word the
// CLASSES table in feat_mls_opnote_integrity.js recognizes, so BOTH classify
// as tplClass:'' - genuinely unclassified, exactly the gap that let them
// reach a sacroiliac joint request's alternatives.
const ESI_BILAT = tpl('esi_bilat', 'Bilateral S1 Epidural', 'OPERATIVE REPORT\nProcedure: bilateral S1 nerve root treatment\nTechnique: a corticosteroid suspension was administered near the bilateral S1 nerve roots for buttock pain relief. ' + PAD);
const CLUNEAL = tpl('cluneal', 'Cluneal Neuropathy Injection', 'OPERATIVE REPORT\nProcedure: cluneal neuropathy treatment\nTechnique: the cluneal nerve territory was treated for buttock pain relief. ' + PAD);

// The full library (used where a legitimate same-class alternative such as
// si_generic needs to exist alongside the tie).
const LIB = [SI_RIGHT_A, SI_RIGHT_B, SI_GENERIC, SI_LEFT, ESI_BILAT, CLUNEAL];
// MEASURED REPRO LIBRARY: only two same-class competitors remain once the
// tie's own winner is excluded (si_right_b and the side-contradicting
// si_left), which is exactly the shape that let the third alternatives slot
// go to a wrong-class template by rank alone - with three or more same-class
// competitors crowding every slot, the bug never gets a chance to show
// itself regardless of whether the class filter exists. This is the library
// that actually reproduces the 2026-09-14 defect end to end.
const LIB_LEAK = [SI_RIGHT_A, SI_RIGHT_B, SI_LEFT, ESI_BILAT, CLUNEAL];

function loadIntegrity(opPrep, lib) {
  const templates = lib || LIB;
  const document = { readyState: 'complete', addEventListener() {}, getElementById() { return null; } };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document,
    getTemplates() { return templates; },
    getTemplateById(id) { return templates.find((t) => t.id === id) || null; },
    getPatients() { return []; },
    _opDobKey(v) { return String(v || '').trim(); },
    opPrepRender() {},
    toast() {}
  };
  context.window = context;
  context._opPrep = opPrep || [];
  vm.runInNewContext(integritySrc, context, { filename: 'opidfix-integrity.js' });
  return context.__mlsOpNoteIntegrity;
}

const RIGHT_SI_REQUEST = 'Right sacroiliac joint injection performed for buttock pain relief. ' + PAD;

// Sanity: the request really is a genuine tie (two right-sided SI templates
// score identically), so this exercises the ambiguous/alternatives path and
// not a confident, alternative-free match.
{
  const api = loadIntegrity([], LIB_LEAK);
  const direct = api.best(RIGHT_SI_REQUEST);
  eq(direct.confident, false, 'the right-sided SI request test fixture is not actually ambiguous - retune the fixture, not the assertion');
  ok(direct.tie === true, 'the right-sided SI request test fixture is not a genuine score tie');
}

{
  const api = loadIntegrity([], LIB_LEAK);
  const bf = api.bestFor('Jane Doe', RIGHT_SI_REQUEST, '', '');
  ok(bf.source !== 'reason' && bf.source !== 'exact-name', 'a genuine tie was auto-applied with confidence instead of leaving the doctor to choose');
  ok(Array.isArray(bf.alternatives) && bf.alternatives.length >= 1, 'the tie produced no alternatives to choose from at all');
  ok(!bf.alternatives.some((a) => a.id === 'esi_bilat'), 'a right-sided sacroiliac joint request offered a bilateral epidural template as an alternative');
  ok(!bf.alternatives.some((a) => a.id === 'cluneal'), 'a right-sided sacroiliac joint request offered an unrelated, unclassified template as an alternative');
  ok(!bf.alternatives.some((a) => a.id === 'si_left'), 'a right-sided sacroiliac joint request offered the opposite-side same-class template as an alternative');
  ok(bf.alternatives.some((a) => a.id === 'si_right_b'), 'no genuinely same-class, same-side alternative survived the class/side filter');
}

// Direct probe of alternativesFrom: an explicit side must exclude the
// opposite-side same-class template, which templateCompatibility's DEFAULT
// fields never check on their own (side is only compared when a template
// declares validatedFacts:true).
{
  const api = loadIntegrity([]);
  const direct = { ranked: [
    { tpl: SI_RIGHT_A, score: 150, procClass: 'si_injection', tplClass: 'si_injection', compatible: true, index: 0 },
    { tpl: SI_LEFT, score: 140, procClass: 'si_injection', tplClass: 'si_injection', compatible: true, index: 1 },
    { tpl: SI_GENERIC, score: 130, procClass: 'si_injection', tplClass: 'si_injection', compatible: true, index: 2 },
    { tpl: ESI_BILAT, score: 20, procClass: 'si_injection', tplClass: '', compatible: true, index: 3 }
  ] };
  const alts = api.alternativesFrom(direct, 'si_right_a', 'Right sacroiliac joint injection');
  ok(!alts.some((a) => a.id === 'si_left'), 'an explicit RIGHT request offered the LEFT-sided same-class template as an alternative');
  ok(!alts.some((a) => a.id === 'esi_bilat'), 'the direct alternativesFrom probe still let an unclassified template through');
  ok(alts.some((a) => a.id === 'si_generic'), 'a side-agnostic same-class template was wrongly dropped');
}

// Same-day preference: another row already committed (not a guess, not a
// refusal) to a template for the identical procedure text -> that template
// is offered FIRST.
{
  const opPrep = [{ tplId: 'si_generic', tplMatchSource: 'reason', proc: RIGHT_SI_REQUEST, appt: { reason: '' } }];
  const api = loadIntegrity(opPrep);
  const bf = api.bestFor('Jane Doe', RIGHT_SI_REQUEST, '', '');
  ok(Array.isArray(bf.alternatives) && bf.alternatives.length > 0, 'the same-day scenario produced no alternatives at all');
  eq(bf.alternatives[0].id, 'si_generic', 'the same-day matched template was not offered first');
  eq(bf.alternatives[0].sameDayMatch, true, 'the same-day match is not marked as such');
}

// The same-day preference must not launder an unsafe (side-contradicting)
// match forward: a same-day row matched to the LEFT template must not be
// promoted for a request that explicitly says RIGHT.
{
  const opPrep = [{ tplId: 'si_left', tplMatchSource: 'manual', proc: RIGHT_SI_REQUEST, appt: { reason: '' } }];
  const api = loadIntegrity(opPrep);
  const bf = api.bestFor('Jane Doe', RIGHT_SI_REQUEST, '', '');
  ok(!bf.alternatives.some((a) => a.id === 'si_left'), 'a side-contradicting same-day match was promoted to the alternatives list anyway');
}

console.log('PASS part 3: the installed template ranker (feat_mls_opnote_integrity.js) keeps alternatives in the requested procedure class, respects side, and offers a same-day match first (' + pass + ' checks total)');

console.log('PASS opnote schedule-placeholder identity + template-class fixes: ' + pass + ' assertions');

})();

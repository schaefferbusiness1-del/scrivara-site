'use strict';
/* =============================================================================
 * opnote-background-only.test.js  -  bgonly-1.0.0
 *
 * Owner 2026-09-11: the upcoming days are pulled ahead of time so an operative
 * note is written with the patient's prior visits, imaging and procedures
 * already in MLS. That only helps if the note treats them as BACKGROUND.
 *
 * MEASURED before this change: the pulled chart DID reach the op-note prompt
 * (problems, medications, allergies, PMH/PSH, the Athena snapshot, every
 * verified visit) - but under "reference prior history only where clinically
 * appropriate", an invitation rather than a limit. The visit-note path fences
 * the same material as BACKGROUND_ONLY_BEGIN/END with an explicit "this is not
 * evidence of anything done today" rule. On an operative report that gap is the
 * fabrication class: a prior procedure narrated as part of today's operation.
 *
 * This suite proves, on the REAL feat_opnote_history.js:
 *   1. every pulled chart fact is inside BACKGROUND_ONLY_BEGIN/END
 *   2. the rule that follows the fence forbids using it as today's evidence
 *   3. the old permissive sentence is gone
 *   4. the op note's rule and the visit note's rule say the SAME thing
 *   5. the splice is still idempotent and still lands ahead of the template
 *   6. the block still fits the 12,000-character history budget
 *
 * Run: node tests/opnote-background-only.test.js   (bare exit code)
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const opSource = fs.readFileSync(path.join(root, 'feat_opnote_history.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

const BG_BEGIN = 'BACKGROUND_ONLY_BEGIN';
const BG_END = 'BACKGROUND_ONLY_END';
const CTX_BEGIN = '=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===';
const CTX_END = '=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===';

/* a patient whose chart facts came from a real day pull: the pull writes
   problems / meds / allergies / athenaChartSnapshot, and the visit model holds
   the verified prior encounters. Synthetic identities only. */
function pulledPatient() {
  return {
    id: 'syn-patient-1',
    name: 'Synthetic Example',
    dob: '01/02/1970',
    problems: 'pulled problem lumbar stenosis',
    meds: 'pulled medication gabapentin 300 mg',
    allergies: 'pulled allergy penicillin',
    history: { pmh: 'pulled PMH hypertension', psh: 'pulled PSH prior laminectomy 2019' },
    athenaHistorySummary: 'pulled longitudinal summary of prior care',
    athenaChartSnapshot: {
      pulledAt: '2026-09-10T12:00:00Z',
      problems: ['pulled snapshot spinal stenosis'],
      history: { pmh: 'pulled snapshot PMH' }
    },
    visits: [{
      date: '2026-05-04', type: 'Office visit',
      source: 'athena-schedule-history', identityVerified: true, identityBinding: 'syn-patient-1',
      icd10: ['M48.06'], cpt: ['64483'],
      raw: 'Diagnoses: pulled prior visit spinal stenosis\nImaging: pulled prior MRI lumbar spine\nProcedures: pulled prior transforaminal injection\nMedications: gabapentin'
    }]
  };
}

function boot(patient) {
  const patients = [patient];
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, Boolean, RegExp, Error,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    document: {
      readyState: 'complete', addEventListener() {}, removeEventListener() {},
      getElementById() { return null; }, querySelector() { return null; },
      querySelectorAll() { return []; }, createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
      head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
    },
    getPatients() { return patients; },
    findPatient(id) { return patients.find(p => String(p.id) === String(id)) || null; },
    activePatient() { return patients[0]; },
    __mlsVisitModel: {
      getVisits(ref) {
        const key = ref && typeof ref === 'object' ? ref.id : ref;
        const p = patients.find(x => String(x.id) === String(key));
        return (p && Array.isArray(p.visits)) ? p.visits : [];
      }
    },
    aiCallRaw() { return Promise.resolve('{}'); }
  };
  context.window = context;
  context.addEventListener = () => {};
  vm.runInNewContext(opSource, context, { filename: 'feat_opnote_history.js' });
  return context.__mlsOpNoteHistory;
}

const PROMPT = [
  'PATIENT: Synthetic Example',
  'DATE OF PROCEDURE: 09/15/2026',
  'PROCEDURE: Synthetic example procedure',
  '',
  'KNOWN PATIENT FACTS (already in our chart):',
  '- date of birth: 01/02/1970',
  '',
  'TEMPLATE (example)',
  'Body of the template.'
].join('\n');

const SYS = 'Draft an OPERATIVE / PROCEDURE NOTE';
const OPTS = { freeform: true, mlsOpNotePatientId: 'syn-patient-1' };

/* --------------------------------------------------------------------------
   1-3. the pulled chart reaches the prompt, fenced and ruled
   ------------------------------------------------------------------------ */
const op = boot(pulledPatient());
ok(op && op.installed, 'the op-note history module did not install');

const injected = op.injectIfOpNote(SYS, PROMPT, OPTS);
ok(injected !== PROMPT, 'the op-note prompt received no verified history at all');

const ctxA = injected.indexOf(CTX_BEGIN);
const ctxB = injected.indexOf(CTX_END);
const bgA = injected.indexOf(BG_BEGIN);
const bgB = injected.indexOf(BG_END);
ok(ctxA >= 0 && ctxB > ctxA, 'the verified-context markers the splice and the stripper key on are gone');
ok(bgA > ctxA && bgB > bgA && bgB < ctxB,
  'the pulled history is not fenced as BACKGROUND_ONLY inside the verified-context block');

/* every pulled fact must sit INSIDE the fence - one outside it is one the
   model may still read as today's evidence */
[
  'pulled problem lumbar stenosis',
  'pulled medication gabapentin 300 mg',
  'pulled allergy penicillin',
  'pulled PMH hypertension',
  'pulled PSH prior laminectomy 2019',
  'pulled longitudinal summary of prior care',
  'pulled snapshot spinal stenosis',
  'pulled prior MRI lumbar spine',
  'pulled prior transforaminal injection'
].forEach(fact => {
  const at = injected.indexOf(fact);
  ok(at >= 0, 'a pulled chart fact never reached the op-note prompt: ' + fact);
  ok(at > bgA && at < bgB, 'a pulled chart fact sits OUTSIDE the BACKGROUND_ONLY fence: ' + fact);
});

const rule = injected.slice(bgB, ctxB);
ok(/not evidence of anything addressed, reviewed, examined, assessed/.test(rule),
  'the BACKGROUND_ONLY rule does not say the block is not evidence of anything done today');
ok(/performed/.test(rule),
  'the operative-note rule does not name PERFORMED - the one verb an op note can fabricate');
ok(/silence is not stability, review, reconciliation, or continuation/.test(rule),
  'the BACKGROUND_ONLY rule lost the silence clause');
ok(/indication|findings|technique/.test(rule),
  'the rule does not name the operative sections a background fact must never enter');
ok(!/TODAY_TRANSCRIPT/.test(rule),
  'the op-note rule cites TODAY_TRANSCRIPT - an operative report has no transcript to cite');

ok(!/reference prior history only where clinically appropriate/.test(injected),
  'the old permissive sentence is still in the op-note prompt beside the new rule');

/* --------------------------------------------------------------------------
   4. the op note and the visit note say the SAME thing
   ------------------------------------------------------------------------ */
{
  const SHARED = 'not evidence of anything addressed, reviewed, examined, assessed';
  ok(shellSource.indexOf('BACKGROUND_ONLY_BEGIN') >= 0,
    'the visit-note BACKGROUND_ONLY block is gone from the shell - this comparison has no control');
  ok(shellSource.indexOf(SHARED) >= 0, 'the visit note lost the shared BACKGROUND_ONLY sentence');
  ok(opSource.indexOf(SHARED) >= 0,
    'the op note no longer states the visit note BACKGROUND_ONLY rule - the two paths have drifted');
}

/* --------------------------------------------------------------------------
   5. the splice still lands ahead of the template, and is still idempotent
   ------------------------------------------------------------------------ */
{
  ok(injected.indexOf(CTX_BEGIN) < injected.indexOf('TEMPLATE (example)'),
    'the verified history no longer sits ahead of the template section');
  const twice = op.injectIfOpNote(SYS, injected, OPTS);
  eq(twice.split(CTX_BEGIN).length - 1, 1, 'a second pass left two verified-context blocks');
  eq(twice.split(BG_BEGIN).length - 1, 1, 'a second pass left two BACKGROUND_ONLY fences');
  eq(twice.split(BG_END).length - 1, 1, 'a second pass left two BACKGROUND_ONLY closers');
  ok(twice.indexOf('Body of the template.') >= 0, 'the second pass ate the template body');
}

/* --------------------------------------------------------------------------
   6. the fence and its rule fit inside the history budget, even on a patient
      with a long record. A block that overflows is a block the budget trims,
      and the rule is the last thing that may be trimmed.
   ------------------------------------------------------------------------ */
{
  const big = pulledPatient();
  big.visits = [];
  for (let i = 0; i < 60; i++) {
    big.visits.push({
      date: '2024-' + String((i % 12) + 1).padStart(2, '0') + '-0' + ((i % 9) + 1),
      type: 'Office visit', source: 'athena-schedule-history',
      identityVerified: true, identityBinding: 'syn-patient-1',
      icd10: ['M48.06'], cpt: ['64483'],
      raw: ('Diagnoses: pulled prior visit number ' + i + '. ' + 'Substantive clinical detail. '.repeat(40))
    });
  }
  const bigOp = boot(big);
  const bigInjected = bigOp.injectIfOpNote(SYS, PROMPT, OPTS);
  const a = bigInjected.indexOf(CTX_BEGIN);
  const b = bigInjected.indexOf(CTX_END) + CTX_END.length;
  const block = bigInjected.slice(a, b);
  ok(block.length <= 12000,
    'the verified-history block overflowed its 12,000-character budget after the fence was added (' + block.length + ')');
  ok(block.indexOf(BG_BEGIN) >= 0 && block.indexOf(BG_END) >= 0,
    'a long record trimmed the BACKGROUND_ONLY fence away');
  ok(/not evidence of anything addressed/.test(block),
    'a long record trimmed the BACKGROUND_ONLY rule away');
  eq(bigOp.lastInjectionReceipt, bigOp.lastInjectionReceipt, 'receipt accessor changed shape');
}

/* --------------------------------------------------------------------------
   7. the receipt still proves what went in
   ------------------------------------------------------------------------ */
{
  const receipt = op.lastInjectionReceipt;
  ok(receipt && receipt.included === true, 'the injection receipt no longer proves the history went in');
  eq(receipt.identityVerified, true, 'the injection receipt no longer proves immutable-id verification');
  ok(receipt.historyChars > 100, 'the injection receipt no longer proves a substantive block');
}

console.log('opnote-background-only: ' + checks + ' checks passed');

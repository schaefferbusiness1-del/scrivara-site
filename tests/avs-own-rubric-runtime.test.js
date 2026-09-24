'use strict';
/* =============================================================================
 * avs-own-rubric-runtime.test.js  (avsq-1.0.0, 2026-09-24)
 *
 * The after-visit summary is a PATIENT handout, and it used to be graded as a
 * SOAP visit note. Measured on the module that shipped before this change:
 *   - a complete six-section summary scored 58, and the three-heading minimum
 *     the backend accepts 19, against the SOAP floor of 90, so a paid
 *     regeneration fired on almost every one;
 *   - the repair block then asked the patient-facing model for "Subjective,
 *     Objective, then Assessment and Plan", "one MDM line" and vitals;
 *   - a summary that came back carrying those chart lines scored HIGHER (67)
 *     than the clean one and was the draft kept.
 *
 * Proven here, against the shipped bytes (feat_mls_note_quality.js and the
 * derived ScribeFlow.html, executed - not grepped):
 *   1. the summary has its own rubric, matching what the backend AVS validator
 *      requires (the three patient headings, alone on their lines, in order,
 *      each with text) plus patient-level language;
 *   2. a good summary passes, so no regeneration fires (1 model call);
 *   3. clinician-only items (decision-making, billing, visit level, SOAP
 *      labels, vitals rules) never reach the summary's contract or repair
 *      block, and a draft carrying chart-only content is never the one kept;
 *   4. the practice billing-code table is never appended to a summary prompt;
 *   5. a saved summary format with its own headings is not asked for the
 *      default headings.
 * ============================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const Q = require(path.join(ROOT, 'feat_mls_note_quality.js'));
const SHIP = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
const CONNECT = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8');

let checks = 0;
const failures = [];
function ok(cond, msg) { checks++; if (!cond) failures.push(msg); }
function eq(a, b, msg) { checks++; if (a !== b) failures.push(msg + ` (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`); }
function sliceBetween(src, a, b, label) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error('could not find the start of ' + label);
  const j = src.indexOf(b, i + a.length);
  if (j < 0) throw new Error('could not find the end of ' + label);
  return src.slice(i, j);
}

const AVS_TYPE = 'after-visit-summary';

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------- */
const GOOD_AVS = [
  'Why you came in today',
  'You came in because of pain in your lower back that goes down your right leg. The pain started about three months ago after you lifted a heavy box.',
  '',
  'What we found',
  'Your exam showed tenderness on the right side of your lower back. Your MRI from May showed a bulging disc between two of the bones in your lower back, which can press on a nerve.',
  '',
  'Your medicines',
  'Keep taking meloxicam 15 mg once a day with food. We started gabapentin 300 mg at bedtime to help the nerve pain.',
  '',
  'What to do at home',
  'Use ice or heat for 20 minutes at a time. Keep walking each day as you can. Start the physical therapy exercises you were given.',
  '',
  'Tests / follow-up',
  'We will see you again in 4 weeks to check how you are doing.',
  '',
  'When to get help right away',
  'Call the office or go to the emergency room if you have new weakness in your leg, numbness between your legs, or trouble controlling your bladder or bowels.'
].join('\n');

const PLAIN_AVS = [
  'Why you came in today:',
  'You came in for a follow-up of your knee pain.',
  'What we found:',
  'Your right knee is less swollen than last time.',
  'What to do at home:',
  'Keep using the knee brace when you walk and ice the knee after activity.'
].join('\n');

/* What the SOAP repair pass pushed the model toward (review note R5): the
   three headings kept - so the backend validator accepts it - plus chart-only
   lines. */
const SOAP_SHAPED_AVS = GOOD_AVS + '\n\n' + [
  'Allergies: No known drug allergies.',
  'Vital signs: BP 128/82, HR 76.',
  'Medical decision making: moderate complexity; 2 chronic problems addressed, MRI reviewed, prescription drug management.',
  'Visit level basis: MDM, 99214.'
].join('\n');

const NO_HOME_AVS = [
  'Why you came in today',
  'You came in because of lower back pain.',
  '',
  'What we found',
  'Your back is tender on the right side.'
].join('\n');

/* The SOAP-rubric check ids and wording a patient handout must never be
   asked for. */
const SOAP_ONLY_IDS = ['soap-headers-anchored-and-ordered', 'mdm-and-data-credit-support', 'leveling-basis-current',
  'vitals-or-explicit-deferral', 'reconciled-medication-list', 'exam-reverification', 'soap.allergies-near-top',
  'soap.interval-anchor', 'pdmp-documented-with-finding', 'follow-up-and-return-precautions'];
const CLINICIAN_ONLY_TEXT = /\bMDM\b|medical decision[- ]making|Subjective|Objective|vital signs|Record vitals|visit level|leveling basis|level of service|\bPDMP\b|\bUDS\b|\bMME\b|signature credentials|TEMPLATE STRUCTURE WINS|LCD\/LCA|>50% of the visit/i;

/* ---------------------------------------------------------------------------
 * 1. THE RUBRIC EXISTS, AND IS NOT THE SOAP ONE
 * ------------------------------------------------------------------------- */
eq(Q.normalizeType('avs'), AVS_TYPE, "the app's 'avs' lane does not resolve to the after-visit-summary rubric");
eq(Q.normalizeType(AVS_TYPE), AVS_TYPE, 'the after-visit-summary rubric id does not resolve to itself');
eq(Q.normalizeType('soap'), 'visit-note-soap', 'the SOAP lane stopped resolving to the SOAP rubric');
ok(Q.noteTypes.indexOf(AVS_TYPE) >= 0, 'the after-visit-summary rubric is not exported in noteTypes');
eq(Q.floor(AVS_TYPE), 90, 'the after-visit-summary floor is not a constant 90');

/* ---------------------------------------------------------------------------
 * 2. MEASURED: A GOOD SUMMARY PASSES; ON THE SOAP RUBRIC IT DID NOT
 * ------------------------------------------------------------------------- */
const soapGood = Q.grade(GOOD_AVS, 'visit-note-soap', { avs: true, template: '' });
const avsGood = Q.grade(GOOD_AVS, AVS_TYPE, { avs: true, template: '' });
const avsPlain = Q.grade(PLAIN_AVS, AVS_TYPE, { avs: true, template: '' });
console.log(`measured: six-section summary  SOAP rubric ${soapGood.score}/${soapGood.floor} pass=${soapGood.pass}` +
  `  ->  AVS rubric ${avsGood.score}/${avsGood.floor} pass=${avsGood.pass}`);
ok(!soapGood.pass, 'the contrast is gone: the SOAP rubric now passes a patient handout (this test measures why it was replaced)');
eq(avsGood.noteType, AVS_TYPE, 'the summary was not graded on its own rubric');
eq(avsGood.pass, true, 'a complete six-section after-visit summary fails its own rubric: ' + JSON.stringify(avsGood.missing.map((m) => m.id)));
ok(avsGood.score >= avsGood.floor, `a complete summary scores ${avsGood.score}, under its floor`);
eq(avsGood.counts.blockFailures, 0, 'a complete summary has a block failure');
eq(avsPlain.pass, true, 'the three-heading minimum the backend accepts fails the rubric: ' + JSON.stringify(avsPlain.missing.map((m) => m.id)));
avsGood.missing.concat(avsPlain.missing).forEach((m) => {
  ok(SOAP_ONLY_IDS.indexOf(m.id) < 0, 'a SOAP-only check ran on a patient handout: ' + m.id);
});

/* ---------------------------------------------------------------------------
 * 3. WHAT THE BACKEND VALIDATOR REQUIRES, AND CHART-ONLY CONTENT
 * ------------------------------------------------------------------------- */
function ids(res) { return res.missing.map((m) => m.id); }
const noHome = Q.grade(NO_HOME_AVS, AVS_TYPE, {});
ok(!noHome.pass && ids(noHome).indexOf('avs.patient-headings') >= 0, 'a summary missing "What to do at home" passed');
const shapes = {
  markdown: GOOD_AVS.replace('Why you came in today', '## Why you came in today'),
  inline: GOOD_AVS.replace('What we found\n', 'What we found: '),
  preamble: 'Here is your summary.\n\n' + GOOD_AVS,
  reordered: PLAIN_AVS.replace('What we found:', 'TMP').replace('What to do at home:', 'What we found:').replace('TMP', 'What to do at home:'),
  duplicate: PLAIN_AVS + '\nWhat we found:\nMore text here for you.',
  empty: PLAIN_AVS.replace('Keep using the knee brace when you walk and ice the knee after activity.', '')
};
Object.keys(shapes).forEach((k) => {
  const r = Q.grade(shapes[k], AVS_TYPE, {});
  ok(!r.pass && ids(r).indexOf('avs.patient-headings') >= 0, `a summary the backend validator refuses (${k}) passed the headings check`);
});
const soapShaped = Q.grade(SOAP_SHAPED_AVS, AVS_TYPE, {});
ok(!soapShaped.pass, 'a summary carrying a decision-making line and a visit-level line passed');
ok(ids(soapShaped).indexOf('avs.no-chart-only-content') >= 0, 'chart-only content in a summary was not found');
ok(Array.isArray(soapShaped.hardFailures) && soapShaped.hardFailures.indexOf('avs.no-chart-only-content') >= 0,
  'chart-only content in a summary is not a hard failure');
eq(Array.isArray(avsGood.hardFailures) && avsGood.hardFailures.length, 0, 'a clean summary reports a hard failure');
const labeled = Q.grade(PLAIN_AVS + '\nSubjective:\nKnee pain.\nObjective:\nNo effusion.', AVS_TYPE, {});
ok(ids(labeled).indexOf('avs.no-chart-section-labels') >= 0, 'SOAP section labels in a summary were not found');
const jargon = Q.grade(PLAIN_AVS.replace('Keep using', 'Pt to keep using').replace('after activity.', 'after activity PRN. RTC 4 wks, f/u PRN.'), AVS_TYPE, {});
ok(ids(jargon).indexOf('avs.plain-language') >= 0, 'clinician shorthand in a summary was not found');
const explained = Q.grade(PLAIN_AVS.replace('ice the knee after activity.', 'we talked about an epidural steroid injection (ESI).'), AVS_TYPE, {});
ok(ids(explained).indexOf('avs.plain-language') < 0, 'an abbreviation explained beside its words was flagged');
const thirdPerson = Q.grade(PLAIN_AVS.replace(/You came in/, 'The patient came in').replace(/Your right knee/, 'The right knee').replace(/Keep using/, 'The patient should keep using'), AVS_TYPE, {});
ok(ids(thirdPerson).indexOf('avs.speaks-to-the-patient') >= 0, 'a summary written about the patient, not to the patient, passed');
/* plain handout language that only LOOKS like a chart term is not flagged */
const benign = Q.grade(PLAIN_AVS + '\nYour pain is leveling off. The problems we addressed today are listed above. Our office is at 100 Main St, Spokane, WA 99201.', AVS_TYPE, {});
ok(ids(benign).indexOf('avs.no-chart-only-content') < 0, 'plain handout language was flagged as chart-only content');

/* ---------------------------------------------------------------------------
 * 4. NOTHING CLINICIAN-ONLY REACHES THE SUMMARY'S PROMPT
 * ------------------------------------------------------------------------- */
const contract = Q.contractFor(AVS_TYPE, { template: '' });
ok(/Why you came in today, What we found and What to do at home, each alone on its own line, in that order/.test(contract),
  'the summary contract does not state the three backend-required headings');
ok(/plain words/.test(contract) && /as "you"/.test(contract), 'the summary contract does not ask for patient-level language');
ok(!CLINICIAN_ONLY_TEXT.test(contract), 'the summary contract carries a clinician-only item: ' + (contract.match(CLINICIAN_ONLY_TEXT) || [''])[0]);
ok(contract.length < 1700, `the summary contract is ${contract.length} characters; the backend avs lane delivers 4,800 in all`);
[soapShaped, noHome, labeled, jargon, thirdPerson].forEach((res, i) => {
  const block = Q.contractFor(AVS_TYPE, { findings: res, regenOnly: true });
  ok(/^REGENERATION PASS 1 of 1\./.test(block) && /FAILURES TO REPAIR:/.test(block) && /RULES FOR THIS PASS:/.test(block),
    `repair block ${i} is not a repair block`);
  ok(!CLINICIAN_ONLY_TEXT.test(block), `repair block ${i} carries a clinician-only item to the patient model: ` + (block.match(CLINICIAN_ONLY_TEXT) || [''])[0]);
  SOAP_ONLY_IDS.forEach((id) => ok(block.indexOf(id) < 0, `repair block ${i} asks for the SOAP item ${id}`));
  ok(!/Offending text: "(Medical decision|Visit level|Vital)/i.test(block), `repair block ${i} quotes a chart-only line back to the model`);
});

/* The code-table wrapper appends the practice billing-code table to any prompt
   it classifies as asking for codes. Classify with the SHIPPED predicate. */
function shippedReach() {
  const start = CONNECT.lastIndexOf('(function', CONNECT.indexOf('if(window.__mlsNoteDefaultsReach) return;'));
  const end = CONNECT.indexOf('})();', CONNECT.indexOf('window.__mlsNoteDefaultsReach={')) + 5;
  const host = { console, setInterval: () => 0, clearInterval: () => {}, aiCallRaw: function () {} };
  host.window = host;
  vm.runInContext(CONNECT.slice(start, end), vm.createContext(host), { filename: 'mls-connect.js#note-defaults-reach' });
  return host.__mlsNoteDefaultsReach;
}
const reach = shippedReach();
ok(reach && typeof reach.wantsCodes === 'function', 'could not execute the shipped code-table wrapper');
const AVS_TASK = sliceBetween(SHIP, "let sys=`You are a clinician writing a PATIENT-FACING after-visit summary", "const user='CLINICAL NOTE:", 'the AVS task text');
ok(AVS_TASK.length > 300, 'the AVS task text could not be sliced');
ok(!reach.wantsCodes('You are a clinician writing a PATIENT-FACING after-visit summary (AVS).' + '\n\n' + contract),
  'the summary contract makes the code-table wrapper append the billing-code table to a patient prompt');
ok(!reach.wantsCodes('You are a clinician writing a PATIENT-FACING after-visit summary (AVS).\n\n' + contract +
  Q.contractFor(AVS_TYPE, { findings: soapShaped, regenOnly: true })),
  'the summary repair block makes the code-table wrapper append the billing-code table to a patient prompt');
/* ...and the op-note chokepoint never reads a summary prompt as an op note
   (it would append the whole operative contract). */
function shippedOpReach() {
  const start = CONNECT.lastIndexOf('(function(){', CONNECT.indexOf('if(window.__mlsNoteQualityReach) return;'));
  const end = CONNECT.indexOf('/* feat_pkg_templates');
  const host = { console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, aiCallRaw: function () {}, __mlsNoteQuality: Q };
  host.window = host;
  vm.runInContext(CONNECT.slice(start, end), vm.createContext(host), { filename: 'mls-connect.js#noteq-reach' });
  return host.__mlsNoteQualityReach;
}
const opReach = shippedOpReach();
ok(opReach && typeof opReach.wants === 'function', 'could not execute the shipped op-note chokepoint');
const AVS_PROMPT = AVS_TASK.replace(/^let sys=`/, '') + contract;
ok(!opReach.wants(AVS_PROMPT) && !opReach.wants(AVS_PROMPT + Q.contractFor(AVS_TYPE, { findings: soapShaped, regenOnly: true })),
  'the op-note chokepoint reads a summary prompt as an op note');
ok(!reach.wantsCodes(AVS_PROMPT), 'the shipped summary task text makes the code-table wrapper append the billing-code table');

/* ---------------------------------------------------------------------------
 * 5. THE SHIPPED generateAVS, EXECUTED
 * ------------------------------------------------------------------------- */
const AVS_SRC = sliceBetween(SHIP, 'async function generateAVS()', '/* =========================================================\n   REFERRAL LETTER', 'generateAVS');
const NOTEQ_SRC = sliceBetween(SHIP, 'var NOTEQ_MAX_REGEN = 1;', 'async function aiCallRaw(sys,user,key,opts){', 'the note-quality wrappers');
ok(/__mlsNoteQualityContract\('after-visit-summary',noteqAvsCtx\)/.test(AVS_SRC), 'generateAVS does not build the after-visit-summary contract');
ok(/__mlsNoteQualityOnce\(avsDraft,'after-visit-summary',noteqAvsCtx,/.test(AVS_SRC), 'generateAVS does not grade on the after-visit-summary rubric');
ok(AVS_SRC.indexOf("'visit-note-soap'") < 0, 'generateAVS still names the SOAP visit-note rubric');

function avsHarness(answers, opts) {
  opts = opts || {};
  const calls = [];
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = { id, style: { display: id === 'noteBox' ? 'none' : '' }, value: '', textContent: '', innerHTML: '', disabled: false };
    return els[id];
  }
  const ctx = {
    console: { warn() {}, log() {}, error() {} }, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array, RegExp,
    currentSoap: 'SUBJECTIVE: low back pain radiating down the right leg.\nPLAN: PT, gabapentin 300 mg at bedtime, follow up 4 weeks.',
    currentInsurance: '', currentFormat: 'soap', currentAVS: '',
    currentVisitAthenaBinding: { id: 'visit-1' }, currentVisitAthenaEpoch: 3,
    document: { readyState: 'complete', addEventListener() {}, getElementById: el, querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    toasts: [],
    toast(m, k) { ctx.toasts.push({ m, k }); },
    hasAI: () => true, backendMode: () => true, getKey: () => 'k', offlineAVS: () => 'OFFLINE',
    buildPatientContext: () => '', docPrefsBlock: () => '',
    currentNoteText: () => ctx.currentSoap,
    _athenaGuardBoundEditor: () => true, _athenaAsyncBindingStillSafe: () => true,
    friendlyError: (e) => String(e && e.message || e),
    showExtra(card, body, text) { el(body).textContent = text; el(card).style.display = 'block'; },
    aiCallRaw(sys, user, key, o) {
      calls.push({ sys: String(sys), user: String(user), opts: o });
      if (opts.tuning && o && o.receipt) o.receipt.draftTuning = opts.tuning;
      return Promise.resolve(answers[Math.min(calls.length - 1, answers.length - 1)]);
    }
  };
  ctx.window = ctx;
  ctx.__mlsNoteQuality = Q;
  vm.runInContext(NOTEQ_SRC + '\n' + AVS_SRC, vm.createContext(ctx), { filename: 'ScribeFlow.html#generateAVS' });
  return { ctx, calls, els };
}

async function runtime() {
  /* 5a. a good summary: graded on its own rubric, no regeneration, 1 call */
  {
    const h = avsHarness([GOOD_AVS]);
    await h.ctx.generateAVS();
    eq(h.calls.length, 1, 'a good after-visit summary still paid for a regeneration');
    eq(h.ctx.currentAVS, GOOD_AVS, 'the good summary is not the one shown');
    const q = h.ctx.__mlsLastAvsQuality;
    ok(q && q.noteType === AVS_TYPE && q.pass === true, 'the shown summary was not graded as passing on the after-visit-summary rubric');
    ok(h.ctx.__mlsLastAvsQualityPass && h.ctx.__mlsLastAvsQualityPass.regenerated === false, 'the summary receipt claims a regeneration');
    ok(/=== MLS PROFESSIONAL NOTE CONTRACT \(noteq-1\.0\.0, after-visit-summary\) ===/.test(h.calls[0].sys),
      'the first summary request does not carry the after-visit-summary contract');
    ok(!CLINICIAN_ONLY_TEXT.test(h.calls[0].sys.slice(h.calls[0].sys.indexOf('=== MLS PROFESSIONAL NOTE CONTRACT'))),
      'the first summary request carries a clinician-only item in its contract');
    console.log(`measured: generateAVS with a good summary -> ${h.calls.length} model call(s), score ${q && q.score}/${q && q.floor}`);
  }
  /* 5b. a chart-shaped first draft: one repair pass, patient rules only, and
         the clean retry is the summary shown */
  {
    const h = avsHarness([SOAP_SHAPED_AVS, GOOD_AVS]);
    await h.ctx.generateAVS();
    eq(h.calls.length, 2, 'a summary carrying chart-only lines did not get its one repair pass');
    const retrySys = h.calls[1] ? h.calls[1].sys : '';
    const tail = retrySys.slice(retrySys.indexOf('REGENERATION PASS'));
    ok(retrySys.indexOf('REGENERATION PASS 1 of 1. The prior draft of this after-visit summary') > 0, 'the repair pass does not carry the summary repair block');
    ok(!CLINICIAN_ONLY_TEXT.test(tail), 'the summary repair pass carries a clinician-only item: ' + (tail.match(CLINICIAN_ONLY_TEXT) || [''])[0]);
    eq(h.ctx.currentAVS, GOOD_AVS, 'the clean retry was not the summary shown');
  }
  /* 5c. a chart-only draft is NEVER the one kept, whatever it scores */
  {
    const h = avsHarness([NO_HOME_AVS, SOAP_SHAPED_AVS]);
    await h.ctx.generateAVS();
    eq(h.calls.length, 2, 'the incomplete summary did not get its one repair pass');
    ok(h.ctx.currentAVS.indexOf('Medical decision making') < 0 && h.ctx.currentAVS.indexOf('Visit level') < 0,
      'a retry carrying decision-making and visit-level lines replaced a draft that had none');
    eq(h.ctx.currentAVS, NO_HOME_AVS, 'the draft without chart-only content was not kept');
  }
  /* 5d. a saved summary format with its own headings: not asked for the
         defaults, so no paid repair pass */
  {
    const SAVED = 'Reason for visit:\nYou came in for your knee.\nNext steps:\nKeep the brace on when you walk and use ice after activity.';
    const h = avsHarness([SAVED], { tuning: { family: 'avs', templateMode: 'strict', templateText: 'Reason for visit:\n[reason]\nNext steps:\n[steps]' } });
    await h.ctx.generateAVS();
    eq(h.calls.length, 1, 'a summary in the doctor\'s saved format was sent back for the default headings');
    ok(h.ctx.__mlsLastAvsQualityPass && h.ctx.__mlsLastAvsQualityPass.savedFormat === true, 'the saved summary format was not recognised');
    const plain = avsHarness([SAVED]);
    await plain.ctx.generateAVS();
    eq(plain.calls.length, 2, 'without a saved format, a summary lacking the three headings was not repaired');
  }
}

runtime().then(() => {
  if (failures.length) {
    console.error(`FAIL avs-own-rubric: ${failures.length} of ${checks} checks failed`);
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log(`PASS avs-own-rubric: ${checks} checks`);
}, (err) => {
  console.error('FAIL avs-own-rubric: the runtime proofs threw - ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});

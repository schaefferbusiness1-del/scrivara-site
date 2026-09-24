'use strict';

/* tplsort-1.3.0 (2026-09-24) - THE BROWSER NEVER CUTS A TEMPLATE; THE SERVER
 * CUTS AT THE LINES THE MODEL NAMES; THE HEADING READER ONLY GUESSES.
 *
 * Owner: "YOU SHOULD BE ABLE TO ADD templates and it should auto sort into the
 * correct places" / "like one stop to add all templates that then all get
 * auto sorted".
 *
 * Round 2 cut and sorted templates with text-pattern rules in the browser and
 * was rejected twice. Round 3 sent every file to the splitter but still cut
 * ONE template in the browser on a line of ***, === or --- (Epic's standard
 * blank, and a divider inside one template), refused fill-in-the-blank forms
 * as unreadable with a false reason, accepted a split that DROPPED lines of
 * ***, ______ and dots, and saved letters with no kind - so a consent form
 * out-ranked the ESI op template in the op-note room.
 *
 * Now every file and every paste goes to /api/templates/split ONCE, WHOLE.
 * The server numbers its lines, the model names the line each template
 * starts on, and the server cuts the document itself: every line after the
 * first start is kept. The browser only checks the answer IS a cut of what it
 * sent (_tplSortVerify); anything else, or a refusal (too-long, too-many,
 * bad-answer), keeps the text whole, one row, with the reason said truly.
 * Letters are saved as kind 'letter', which no picker offers.
 *
 * This lifts the REAL code out of the shipped shells into a vm with a tiny
 * fake document. /api/templates/split is the backend's contract, line for
 * line (tests/fixtures/template-split-server.js); only the MODEL is
 * scripted. Every blocking repro of the round-2 and round-3 reviews is
 * replayed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SPLIT = require('./fixtures/template-split-server.js');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];

function between(src, from, to, what) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, 'missing ' + what);
  const b = src.indexOf(to, a);
  assert.ok(b > a, 'unterminated ' + what);
  return src.slice(a, b);
}
function fn(src, name) {
  const m = new RegExp('^(?:async\\s+)?function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\(', 'm').exec(src);
  assert.ok(m, 'missing ' + name);
  const at = m.index;
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
function decl(src, re, what) { const m = src.match(re); assert.ok(m, 'missing ' + what); return m[0]; }

function codeOf(src) {
  return [
    fn(src, 'esc'),
    decl(src, /var _tplPendingSplit=\[\];/, '_tplPendingSplit'),
    decl(src, /var _tplPendingCarry=\[\];/, '_tplPendingCarry'),
    decl(src, /var _tplUnreadableRows=\[\];/, '_tplUnreadableRows'),
    fn(src, '_tplAppendUnreadableRows'),
    fn(src, '_tplMultiStatus'),
    between(src, "var _tplReadReason='';", 'function _tplReadAdvice(', 'the read advice'),
    fn(src, '_tplReadAdvice'),
    fn(src, '_tplUnreadableWhy'),
    fn(src, '_tplParseMeta'),
    fn(src, '_tplSuggestLibrary'),
    fn(src, '_tplSeedKeywords'),
    decl(src, /var _TPL_AI_LIMIT=\d+;/, '_TPL_AI_LIMIT'),
    decl(src, /var _tplAiInFlight=[^\n]*;/, 'the pool state'),
    fn(src, '_tplAiSlot'), fn(src, '_tplAiRelease'), fn(src, '_tplPool'),
    fn(src, '_tplSplitCall'), fn(src, '_tplFoundWords'), fn(src, '_tplFoundSoFar'),
    fn(src, 'tplMultiFile'), fn(src, 'tplAiSplit'), fn(src, '_tplDedupeTemplatesInfo'),
    fn(src, '_renderTplSplitPreview'), fn(src, '_tplDiscardSplit'),
    between(src, 'var TPL_SORT_FAMILIES=', '/* Retroactively rename ALREADY-saved', 'the tplsort block'),
    fn(src, '_mlsTplKindOf'), fn(src, '_mlsTplKindLabel'), fn(src, '_mlsTemplateHeadingParts'), fn(src, '_mlsTemplateHeadingIsReserved'), fn(src, '_mlsRequiredTemplateHeadings'),
    fn(src, '_mlsVnTplNorm')
  ].join('\n');
}

/* ---------- a tiny document ---------- */
function element(id) {
  const el = { id, innerHTML: '', textContent: '', value: '', style: {}, children: [], attrs: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    focus() {}, scrollIntoView() {}, contains() { return false; }, getClientRects() { return [1]; }, dispatchEvent() {},
    insertAdjacentHTML(where, html) { this.innerHTML = html + this.innerHTML; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } };
  return el;
}

/* ---------- the splitter ----------
   opts.model(doc, lines, callIndex) -> the MODEL's JSON; the answer is the
   backend's cut of it (SPLIT.respond). opts.answer(text, callIndex) ->
   { status, body } | 'throw' overrides the server entirely (a failure, or an
   older server's answer). With neither, the model says: one template, unsure. */
function load(shell, opts) {
  opts = opts || {};
  const src = fs.readFileSync(path.join(root, shell), 'utf8');
  const nodes = {};
  const doc = {
    getElementById: (id) => nodes[id] || (nodes[id] = element(id)),
    querySelector: () => null, querySelectorAll: () => [], createElement: () => element(''),
    body: element('body'), head: element('head'), documentElement: element('html'), activeElement: null
  };
  const calls = [];
  const toasts = [];
  const libraryAdds = [];
  const ctx = {
    console, Math, Date, JSON, Promise, String, Number, Array, Object, RegExp, Error, TypeError, setTimeout, clearTimeout, WeakSet, Set, Map, Symbol,
    document: doc,
    navigator: { onLine: opts.offline ? false : true },
    backendMode: () => opts.signedIn !== false,
    bkToken: () => (opts.signedIn === false ? '' : 'token'),
    bkBase: () => 'https://api.test',
    toast: (m) => toasts.push(String(m)),
    _tplStore: () => [],
    async _tplReadAnyFile(file) { ctx._tplReadReason = file.__reason || ''; return file.__text; },
    Event: function () {},
    async fetch(url, init) {
      const text = JSON.parse(init.body).text;
      const i = calls.length;
      calls.push(text);
      const plan = opts.answer ? opts.answer(text, i) : SPLIT.respond(text, opts.model ? (d, lines) => opts.model(d, lines, i) : null);
      if (plan === 'throw') throw new TypeError('fetch failed');
      const status = (plan && plan.status) || 200;
      const body = (plan && plan.body) || {};
      return { ok: status >= 200 && status < 300, status, async json() { return body; } };
    }
  };
  ctx.window = ctx;
  if (opts.sample) ctx.__MLS_PUBLIC_PREVIEW = { enabled: true };
  vm.createContext(ctx);
  vm.runInContext(codeOf(src), ctx, { filename: shell + ':tplsort' });
  /* the library add (tplAddSplit) as a recorder: what the one Save stages */
  ctx.tplAddSplit = function () {
    const staged = JSON.parse(JSON.stringify(ctx._tplPendingSplit));
    libraryAdds.push(staged);
    ctx._tplDiscardSplit();
    return opts.libraryAnswer ? opts.libraryAnswer(staged) : true;
  };
  ctx.__mlsDraftTuning = opts.draftTuning || null;
  return {
    ctx, calls, toasts, libraryAdds, nodes,
    upload: (files) => ctx.tplMultiFile({ target: { files: files.map((f) => ({ name: f.name, __text: f.text, __reason: f.reason, _mlsTplPasted: !!f.pasted })), value: '' } }),
    rows: () => JSON.parse(JSON.stringify(ctx._tplPendingSplit)),
    html: () => nodes.tplMultiResult ? nodes.tplMultiResult.innerHTML : '',
    status: () => nodes.tplMultiStatus ? nodes.tplMultiStatus.textContent : ''
  };
}

/* A correct model for these pieces of the document (each one's text or
   first line, with goes / why / name / insurance). */
const piece = (text, goes, why, extra) => Object.assign({ text, goes, why: why || '' }, extra || {});
const model = (list) => SPLIT.modelFor(list);
/* An OLDER server's answer: template text copied by the model, no start. */
const oldServer = (list, extra) => () => ({ body: Object.assign({ templates: list.map((p) => ({ name: p.name || '', text: p.text, goes: p.goes, why: p.why || '' })) }, extra || {}) });

const L = (a) => a.join('\n');
/* ---------- the reviewers' repros (synthetic, PHI-free) ---------- */
const VISIT_1 = L(['NEW PATIENT - LOW BACK', 'CHIEF COMPLAINT:', '[ ]', 'HPI:', '[back story]', 'EXAM:', 'Lumbar: [ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', 'Physical therapy referral', 'Return in 6 weeks']);
const VISIT_2 = L(['FOLLOW UP - LOW BACK', 'INTERVAL HISTORY:', '[ ]', 'EXAM:', 'Lumbar: [ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', 'Continue home exercise program', 'Return as needed']);
const VISIT_3 = L(['NEW PATIENT - KNEE', 'CHIEF COMPLAINT:', '[ ]', 'HPI:', '[knee story]', 'EXAM:', 'Knee: [ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', 'Knee injection today', 'Return in 3 months']);
/* a .docx read by mammoth, or a double-spaced paste: a blank line between every paragraph */
const DOUBLE = (t) => t.split('\n').join('\n\n');
const DOCX3 = DOUBLE([VISIT_1, VISIT_2, VISIT_3].join('\n'));
const OB = L(['OB PRENATAL VISIT', 'S:', 'Patient reports [fetal movement], [contractions], [bleeding].', 'O:', 'BP [ ] Wt [ ] FHT [ ] Fundal height [ ]', 'A/P:', 'IUP at [ ] weeks, [ ]', '- Return in [ ] weeks']);
const VISIT_PA = L(['CHIEF COMPLAINT:', '[ ]', 'HPI:', '[ ]', 'ROS:', '[ ]', 'EXAM:', '[ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', 'Will submit prior authorization to insurance for lumbar MRI.']);
const TFESI = L(['PROCEDURE: Transforaminal epidural steroid injection, [level]', 'PRIOR AUTHORIZATION: [#] (verified with insurance)', 'INDICATION: [ ]', 'CONSENT: obtained.', 'TECHNIQUE: fluoroscopic guidance, [dose] injected.', 'COMPLICATIONS: None.', 'DISPOSITION: Home.']);
const HPI_APPEAL = L(['HPI: [age] presents after denial of appeal for [procedure] to discuss next steps.', 'Onset [ ]', 'Severity [ ]']);
const PLAN_HEP = 'Plan: RTC 6 weeks. Continue home exercise program.';
const PLAN_INSTR = L(['Plan: see written instructions given to the patient.', 'Continue [ ].', 'Return in [ ] weeks.']);
const WC_RTW = L(['WORKERS COMPENSATION FOLLOW-UP / RETURN TO WORK EVALUATION', 'Date of injury: [ ]', 'HPI: [ ]', 'Exam: [ ]', 'Assessment: [ ]', 'Plan: [ ]', 'Work status: [full duty / modified duty / off work]']);
const DISABILITY = L(['DISABILITY EVALUATION', 'History of Present Illness:', '[ ]', 'Review of Systems:', '[ ]', 'Physical Examination:', '[ ]', 'Assessment:', '[ ]', 'Opinion regarding work capacity:', '[ ]']);
const FOLLOWUP_NARR = L(['FOLLOW UP', '[Patient] returns today for follow up of [condition]. Since the last visit [ ]. Pain [ ]/10. Medication adherence [ ].']);
const ASTHMA = L(['ASTHMA ACTION PLAN', 'GREEN ZONE - Doing well: Take your controller medicine [ ] every day.', 'YELLOW ZONE - Getting worse: Take your rescue inhaler [ ] puffs every 4 hours.', 'RED ZONE - Medical alert: Take your rescue inhaler and call 911.']);
const PHQ9 = L(['PHQ-9 Depression Assessment', 'Over the last 2 weeks, how often have you been bothered by:', '1. Little interest or pleasure in doing things [0-3]', '2. Feeling down, depressed, or hopeless [0-3]', 'Total score: [ ]']);
const PLAN_BLANK = L(['PLAN:', '- Medications:', '- Imaging:', '- Follow-up:']);
const DISCHARGE = L(['DISCHARGE SUMMARY', 'Admission diagnosis: [ ]', 'Hospital course:', '[ ]', 'Procedures:', '[ ]', 'Discharge Medications:', '[ ]', 'Disposition:', '[home]', 'Follow up:', '[ ]']);
const CONSENT = L(['CONSENT FOR EPIDURAL STEROID INJECTION', 'I, [patient], consent to an epidural steroid injection by Dr. [ ].', 'Risks explained: infection, bleeding, headache, nerve injury.', 'Signature: ________ Date: ________']);
const LMN = L(['LETTER OF MEDICAL NECESSITY', 'To: [Insurance company]', 'Requested treatment: [CPT]', 'Clinical history: [ ]', 'Sincerely, [Doctor]']);
const WORK = L(['WORK STATUS NOTE', '[Patient] was seen in clinic today.', 'Work status: [full duty / restrictions]', 'Return to clinic: [ ]']);
const KNEE_SCOPE = L(['OPERATIVE REPORT', 'PROCEDURE: Right knee arthroscopy with partial medial meniscectomy', 'ANESTHESIA: General', 'FINDINGS: [ ]', 'COMPLICATIONS: None', '', 'POST-OPERATIVE INSTRUCTIONS', 'MEDICATIONS: [ ]', 'ACTIVITY: Weight bearing as tolerated', 'Call for fever over 101.5.']);
const OP_PATH = L(['OPERATIVE NOTE', 'PROCEDURE: Excision of [lesion]', 'ANESTHESIA: Local', 'EBL: minimal', '', 'PATHOLOGY REPORT:', 'SPECIMENS: [ ]', 'Final diagnosis: [ ]']);
const VISIT_RAD = L(['FOLLOW-UP VISIT', 'HPI: [ ]', 'EXAM: [ ]', 'RADIOLOGY REPORT:', 'MRI lumbar spine [date]: [findings]', 'ASSESSMENT: [ ]', 'PLAN: [ ]']);
const OP_REPEAT = L(['PROCEDURE: Lumbar medial branch block, [levels]', 'INDICATION: [ ]', 'TECHNIQUE: The patient was placed prone.', 'PROCEDURE: A 22 gauge needle was advanced to the target under fluoroscopy.', 'COMPLICATIONS: None.']);
const PAIN_OPS = DOUBLE(L(['PROCEDURE: Caudal epidural steroid injection', 'INDICATION: [ ]', 'CONSENT: Informed consent obtained.', 'TECHNIQUE: [ ]', 'COMPLICATIONS: None.', 'Discharged home in stable condition',
  'PROCEDURE: Lumbar facet joint injection at [ ]', 'INDICATION: [ ]', 'CONSENT: Informed consent obtained.', 'TECHNIQUE: [ ]', 'COMPLICATIONS: None.', 'Discharged home in stable condition']));
const KNEE_DAY_VISIT = L(['KNEE FOLLOW-UP VISIT', 'HPI: [ ]', 'EXAM: Knee [ ]', 'ASSESSMENT: [ ]', 'PLAN: injection today']);
const KNEE_DAY_PROC = L(['KNEE INJECTION PROCEDURE NOTE', 'PROCEDURE: Right knee corticosteroid injection', 'CONSENT: obtained', 'COMPLICATIONS: None']);
const KNEE_DAY_INSTR = L(['PATIENT INSTRUCTIONS', 'Keep the site clean and dry.', 'Call us for fever or redness.']);
const KNEE_DAY = [KNEE_DAY_VISIT, KNEE_DAY_PROC, KNEE_DAY_INSTR].join('\n\n');
const SOAP_INSTR = L(['KNEE FOLLOW-UP VISIT', 'SUBJECTIVE:', '[ ]', 'OBJECTIVE:', '[ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', '[ ]', 'PATIENT INSTRUCTIONS:', 'Ice twice a day.', 'Return if swelling worsens.']);
const SOAP_VITALS = L(['S:', 'Patient presents for [ ].', 'O:', 'T: [ ]', 'P: [ ]', 'R: [ ]', 'BP: [ ]', 'General: [ ]', 'Lungs: [ ]', 'A:', '1. [Diagnosis]', 'P:', '- Continue [ ]', '- Return in [ ]']);
const HPI_BLOCKS = L(['HISTORY OF PRESENT ILLNESS:', '[onset, location, duration]', 'PAST MEDICAL HISTORY:', '[ ]', 'MEDICATIONS:', '[ ]', 'ALLERGIES:', '[ ]']);
const EXAM_BLOCKS = L(['PHYSICAL EXAMINATION:', 'General: [ ]', 'VITALS:', 'BP [ ] HR [ ]']);
const HP = L(['CHIEF COMPLAINT:', '[ ]', 'History of present illness:', '[onset, location, duration]', 'PAST MEDICAL HISTORY:', '[ ]', 'REVIEW OF SYSTEMS:', 'Constitutional: [ ]', 'PHYSICAL EXAMINATION:', 'General: [ ]', 'ASSESSMENT:', '[ ]', 'PLAN:', '[ ]']);
/* round 3's blocking repros */
const EPIC = L(['CHIEF COMPLAINT:', '***', '', 'HPI:', '***', '', 'ROS:', '***', '', 'PHYSICAL EXAM:', '***', '', 'ASSESSMENT/PLAN:', '***']);
const EPIC_TIGHT = L(['CHIEF COMPLAINT:', '***', 'HPI:', '***', 'ROS:', '***', 'PHYSICAL EXAM:', '***', 'ASSESSMENT/PLAN:', '***']);
const MBB = L(['PROCEDURE: Lumbar medial branch block at ***', 'INDICATION:', '***', 'TECHNIQUE:', '***', 'COMPLICATIONS:', '***', 'DISPOSITION: Home']);
const CAUDAL = L(['PROCEDURE: Caudal epidural steroid injection', 'INDICATION: [ ]', 'TECHNIQUE: The sacral hiatus was identified under fluoroscopy.', 'COMPLICATIONS: None']);
const GENIC = L(['PROCEDURE: Genicular nerve block, [LATERALITY] knee', 'TECHNIQUE: Under ultrasound guidance the genicular nerves were blocked.', 'COMPLICATIONS: None']);
const KNEE_DASH = L(['KNEE FOLLOW-UP VISIT', '-----', 'SUBJECTIVE:', '[ ]', '-----', 'OBJECTIVE:', '[ ]', '-----', 'ASSESSMENT AND PLAN:', '[ ]']);
const PROC_UNDERLINE = L(['PROCEDURE:', '==========', 'Right knee injection', 'TECHNIQUE:', '==========', '[ ]', 'COMPLICATIONS: None']);
/* a fill-in-the-blank form: 107 letters in 430 non-space characters, the rest blanks */
const WORK_FORM = L(['WORK STATUS REPORT', 'Patient: ______________________________ Date: ______________',
  'Diagnosis: ________________________________________________', 'Work status: [ ] Full duty [ ] Modified duty [ ] Off work',
  'Restrictions: ________________________________________________', '________________________________________________________',
  'Lifting limit: ______ lbs   Hours per day: ______', 'Next visit: ______________', 'Physician signature: ______________________________',
  '________________________________________________________', '________________________________________________________', '________________________________________________________']);
const SCHOOL = L(['SCHOOL EXCUSE', '______________________________ was seen on ______________________.', 'May return on ______________________.', 'Excused from PE until ______________________.', '________________________________________', 'Signed: ______________________________ Date: ____________________']);
const LETTER_SIGNED = L(['TO WHOM IT MAY CONCERN', '[Patient] is under my care for [condition] and may return to work on [date].', 'Sincerely,', '______________________________', '.....................']);
const NAME_BLANK = L(['Name: ______________________________', 'DOB: ____________', 'PAIN QUESTIONNAIRE', 'Where is your pain? ______________', 'Rate your pain 0-10: ____']);
const NAMED_PAIR = L(['Name: Knee templates', 'HPI:', 'Onset: [ ]', 'Location: [ ]', 'PLAN:', '- [brace]', '- [therapy]']);
const COVER = L(['DR SMITH CLINIC TEMPLATES', 'Version 3']);

const signedOutCases = [
  ['docx with blank lines, 3 visit templates', DOCX3], ['S:/O:/A/P: prenatal visit', OB], ['visit whose Plan mentions prior authorization', VISIT_PA],
  ['op note with a PRIOR AUTHORIZATION line', TFESI], ['HPI mentioning a denied appeal', HPI_APPEAL], ['Plan with home exercise', PLAN_HEP],
  ['Plan with written instructions', PLAN_INSTR], ['workers comp / return to work visit', WC_RTW], ['disability evaluation H&P', DISABILITY],
  ['FOLLOW UP over a narrative', FOLLOWUP_NARR], ['asthma action plan', ASTHMA], ['PHQ-9', PHQ9], ['Plan with blank sub-labels', PLAN_BLANK],
  ['discharge summary', DISCHARGE], ['consent form', CONSENT], ['two letters in one file', LMN + '\n\n' + WORK],
  ['op report + post-op instructions', KNEE_SCOPE], ['op note + pathology report', OP_PATH], ['visit + radiology report', VISIT_RAD],
  ['op narrative repeating PROCEDURE:', OP_REPEAT], ['two op-note starters, double spaced', PAIN_OPS], ['knee day: visit + procedure + instructions', KNEE_DAY],
  ['SOAP ending in PATIENT INSTRUCTIONS', SOAP_INSTR], ['Epic *** note (R3-0)', EPIC], ['a --- divided visit (R3-0)', KNEE_DASH], ['=== underlines (R3-0)', PROC_UNDERLINE],
  ['work status form (R3-1)', WORK_FORM], ['school excuse (R3-1)', SCHOOL], ['letter with a signature line (R3-2)', LETTER_SIGNED]
];

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

(async () => {
  /* R4 client-2: the real file reader keeps a PASTE as typed; a .txt still goes through the cleaner */
  {
    for (const shell of ['1pScribeFlow.html', '1p/index.html']) {
      const src = fs.readFileSync(path.join(root, shell), 'utf8');
      const i = src.indexOf('async function _tplReadAnyFile(file){');
      const j = src.indexOf('\n}\n', i);
      const fn = src.slice(i, j + 2);
      const indented = 'PLAN:\n    1. Knee\n        a. Brace\n\t\t\tb. Ice\n\n\n\nFollow up   in 2 weeks';
      const ctx = { _tplReadDone: (r, t) => t, _cleanExtractedText: (t) => t.replace(/[ \t]{3,}/g, '  ').replace(/\n{3,}/g, '\n\n'), _tplSortIsPasted: (f) => !!f._mlsTplPasted, _tplReadReason: '' };
      vm.createContext(ctx); vm.runInContext(fn + '\nthis.read = _tplReadAnyFile;', ctx);
      const pasted = await ctx.read({ name: 'paste.txt', type: 'text/plain', _mlsTplPasted: true, text: async () => indented });
      const typed = await ctx.read({ name: 'plan.txt', type: 'text/plain', text: async () => indented });
      if (pasted !== indented) throw new Error(shell + ': a paste was rewritten before sorting: ' + JSON.stringify(pasted));
      if (typed === indented) throw new Error(shell + ': the .txt path no longer cleans (the paste test proves nothing)');
    }
  }
  for (const shell of SHELLS) {
    const html = fs.readFileSync(path.join(root, shell), 'utf8');
    /* ---- 0. the client-side cutters and the pattern placer are gone ---- */
    for (const gone of ['function _tplSortPieces(', 'TEMPLATEISH', 'looseTitle', 'pullBack', 'function _tplDestinationFor(', 'function _looksMultiForm(', 'function _tplChunk(', '_tplSortLetterEvidence', '_tplSortOpEvidence', 'TPL_SORT_LETTER_WORDS',
      /* round 3's separator cut, its normalising proof and its letter-share rule (R3-0, R3-1, R3-2) */
      'function _tplSortSeparated(', '_tplSortSeparated(', 'function _tplSortNormMap(', 'letters*4>=s.length', 'ruleOnly',
      /* advice a PDF cannot follow (R3-9) */
      'Put a line of --- between its templates', 'one multi-form PDF', 'put a line of --- between them']) {
      ok(!html.includes(gone), shell + ': a client-side cutter or its advice is still shipped: ' + gone);
    }
    ok(/function _tplSortVerify\(doc,list,cover\)\{/.test(html), shell + ': the answer check is not the boundary contract\'s');

    /* ---- 1. SIGNED OUT: nothing is cut, nothing is placed - every file is one whole row to choose ---- */
    for (const [label, text] of signedOutCases) {
      const h = load(shell, { signedIn: false });
      await h.upload([{ name: label, text }]);
      const rows = h.rows();
      eq(rows.length, 1, shell + ': signed out, "' + label + '" was cut into ' + rows.length + ' rows');
      eq(rows[0].text, text.trim(), shell + ': signed out, "' + label + '" did not stay whole');
      eq(rows[0].dest, '', shell + ': signed out, "' + label + '" was placed by a text rule (' + rows[0].dest + ')');
      ok(!rows[0].unreadable, shell + ': signed out, "' + label + '" was called unreadable');
      ok(/Choose where it goes/.test(rows[0].why), shell + ': "' + label + '" does not ask where it goes: ' + rows[0].why);
      eq(h.calls.length, 0, shell + ': signed out, the splitter was called');
      ok(!/^(?:(?:S|Patient|Procedure)\b|_)/.test(rows[0].name) && rows[0].name.length > 1, shell + ': a bad name: ' + rows[0].name);
    }
    {
      /* said once, not per row - and truly: one row per file, each kept whole */
      const h = load(shell, { signedIn: false });
      await h.upload([{ name: 'a', text: OB }, { name: 'b', text: ASTHMA }, { name: 'c', text: CONSENT }]);
      const out = h.html();
      eq((out.match(/class="tpl-sort-unsorted"/g) || []).length, 1, shell + ': the reason it was not sorted is not said exactly once');
      ok(/MLS could not sort 3 of these: you are not signed in/.test(out), shell + ': the not-signed-in reason is missing');
      ok(!/tpl-sort-retry/.test(out), shell + ': signed out, a retry that cannot help is offered');
      eq(h.rows().map((r) => r.dest), ['', '', ''], shell + ': a signed-out row was placed');
      /* R3-0 (b): a signed-out Epic paste is ONE row with every *** in it */
      const e = load(shell, { signedIn: false });
      await e.upload([{ name: 'paste', text: EPIC_TIGHT, pasted: true }]);
      eq([e.rows().length, e.rows()[0].text, (e.rows()[0].text.match(/\*\*\*/g) || []).length], [1, EPIC_TIGHT, 5], shell + ': signed out, the Epic paste was cut or lost a ***');
      ok(/It is kept whole/.test(e.html()) && !/Each one is kept whole/.test(e.html()), shell + ': the one-row paste is not described truly');
    }
    {
      /* the best guess is offered as one tap, never taken: S/O/A/P -> whole visit (never Plan, never named "S") */
      const h = load(shell, { signedIn: false });
      await h.upload([{ name: 'OB prenatal visit', text: OB }]);
      const r = h.rows()[0];
      eq([r.dest, r.guess], ['', 'soap'], shell + ': the S:/O:/A/P: note\'s best guess is wrong or was taken: ' + JSON.stringify([r.dest, r.guess]));
      ok(h.html().includes('Put it in Whole visit note / SOAP'), shell + ': the best guess is not one tap');
      eq(r.name, 'OB PRENATAL VISIT');
    }
    {
      /* the sample workspace and an offline device say why */
      const s = load(shell, { sample: true });
      await s.upload([{ name: 'x', text: PLAN_HEP }]);
      ok(/sample workspace/.test(s.html()) && s.calls.length === 0 && s.rows()[0].dest === '', shell + ': the sample workspace sorted or did not say why');
      const o = load(shell, { offline: true });
      await o.upload([{ name: 'x', text: PLAN_HEP }]);
      ok(/this device is offline/.test(o.html()) && o.calls.length === 0, shell + ': offline did not say why');
    }

    /* ---- 2. SIGNED IN: one call per file, WHOLE; the rows are the server's cut at the model's starts ---- */
    {
      /* R2-0: the docx with blank lines - each template keeps its own last line */
      const h = load(shell, { model: model([
        piece(VISIT_1, 'visit', 'It has CC, HPI, Exam, Assessment and Plan headings.', { name: 'New patient - low back' }),
        piece(VISIT_2, 'visit', 'It has interval history, exam, assessment and plan.', { name: 'Follow up - low back' }),
        piece(VISIT_3, 'visit', 'It has CC, HPI, Exam, Assessment and Plan headings.', { name: 'New patient - knee' })]) });
      await h.upload([{ name: 'Visit templates', text: DOCX3 }]);
      eq([h.calls.length, h.calls[0]], [1, DOCX3], shell + ': the docx did not go to the splitter exactly once, whole');
      const rows = h.rows();
      eq(rows.map((r) => r.dest), ['soap', 'soap', 'soap']);
      eq(rows.map((r) => r.text.replace(/\n\n/g, '\n')), [VISIT_1, VISIT_2, VISIT_3], shell + ': a template lost its last line or gained the next one\'s');
      ok(/Return in 6 weeks$/.test(rows[0].text) && /^FOLLOW UP - LOW BACK/.test(rows[1].text), shell + ': "Return in 6 weeks" moved into the next template');
      eq(rows.map((r) => r.name), ['New patient - low back', 'Follow up - low back', 'New patient - knee'], shell + ': the splitter\'s names were not used');
      eq(rows[0].why, 'It has CC, HPI, Exam, Assessment and Plan headings.');
      ok(/“Visit templates” held 3 templates/.test(h.html()) && /Keep it as one template/.test(h.html()), shell + ': the doctor is not told the file held 3, or cannot keep it whole');
      /* "Keep it as one template" puts the file back exactly as it came */
      const gid = rows[0].group.id;
      ok(h.ctx._tplSortKeepTogether(gid), shell + ': Keep it as one template did nothing');
      const back = h.rows();
      eq(back.length, 1); eq(back[0].text, DOCX3.trim()); eq(back[0].dest, '');
    }
    {
      /* every hard case: the row goes exactly where the splitter said, with its reason */
      const cases = [[OB, 'visit', 'soap'], [VISIT_PA, 'visit', 'soap'], [TFESI, 'op', 'op'], [HPI_APPEAL, 'hpi', 'hpi'], [PLAN_HEP, 'plan', 'plan'], [PLAN_INSTR, 'plan', 'plan'],
        [WC_RTW, 'visit', 'soap'], [DISABILITY, 'visit', 'soap'], [FOLLOWUP_NARR, 'hpi', 'hpi'], [ASTHMA, 'letter', 'letters'], [PHQ9, 'letter', 'letters'], [PLAN_BLANK, 'plan', 'plan'],
        [DISCHARGE, 'letter', 'letters'], [CONSENT, 'letter', 'letters'], [KNEE_SCOPE, 'op', 'op'], [OP_PATH, 'op', 'op'], [VISIT_RAD, 'visit', 'soap'], [OP_REPEAT, 'op', 'op'],
        [WORK_FORM, 'letter', 'letters'], [SCHOOL, 'letter', 'letters'], [LETTER_SIGNED, 'letter', 'letters'], [EPIC, 'visit', 'soap'], [MBB, 'op', 'op']];
      for (const [text, goes, dest] of cases) {
        const h = load(shell, { model: model([piece(text, goes, 'Reason for ' + goes + '.')]) });
        await h.upload([{ name: 'f', text }]);
        const rows = h.rows();
        eq([h.calls.length, rows.length, rows[0].dest, rows[0].why, rows[0].text], [1, 1, dest, 'Reason for ' + goes + '.', text.trim()], shell + ': ' + text.split('\n')[0] + ' was not placed exactly as the splitter said, whole');
      }
      /* an unknown or unsure answer asks, with a best guess from the headings */
      const u = load(shell, { model: model([piece(PLAN_BLANK, 'unsure', 'It could be a plan outline or a checklist.')]) });
      await u.upload([{ name: 'f', text: PLAN_BLANK }]);
      const ur = u.rows()[0];
      eq([ur.dest, ur.guess], ['', 'plan']);
      ok(/^It could be a plan outline or a checklist\. MLS is not sure where it goes\. Choose where it goes\. Best guess: Plan/.test(ur.why), shell + ': the unsure row does not say so: ' + ur.why);
      const odd = load(shell, { model: model([piece(PLAN_BLANK, 'soap', '')]) });
      await odd.upload([{ name: 'f', text: PLAN_BLANK }]);
      eq(odd.rows()[0].dest, '', shell + ': an unknown goes placed a row');
    }
    {
      /* R2-7: two letters in one file become two rows (one call); each file is its own call */
      const h = load(shell, { model: (d) => (d.startsWith('LETTER OF') ? model([piece(LMN, 'letter', 'It is a letter to an insurer.', { insurance: true }), piece(WORK, 'letter', 'It is a work status note.')])(d)
        : model([piece(d, 'op', 'It is an operative report with its instructions.')])(d)) });
      await h.upload([{ name: 'Letters', text: LMN + '\n\n' + WORK }, { name: 'Knee scope and instructions', text: KNEE_SCOPE }, { name: 'c', text: TFESI }]);
      eq(h.calls.length, 3, shell + ': not exactly one splitter call per file');
      const rows = h.rows();
      /* tplsort-1.4.0: kind insurance is the Insurance-ready NOTE format, which drafts
         visit notes - a letter to an insurer is still kind letter (R4 client-0) */
      eq(rows.map((r) => [r.dest, r.libKind]), [['letters', ''], ['letters', ''], ['op', ''], ['op', '']]);
      eq(rows.slice(0, 2).map((r) => r.text), [LMN, WORK]);
      ok(/POST-OPERATIVE INSTRUCTIONS/.test(rows[2].text), shell + ': the post-op instructions left their op note');
      /* the one Save: kind op; every letter kind letter, even one the splitter calls an insurance letter (R3-3, R4 client-0) */
      await h.ctx.tplAddSplitSorted();
      const staged = h.libraryAdds[0];
      eq(staged.map((t) => [t.kind || '', !!t.kindSuggested]), [['letter', false], ['letter', false], ['op', false], ['op', false]], shell + ': the library kinds are wrong: ' + JSON.stringify(staged.map((t) => [t.name, t.kind, t.kindSuggested])));
      eq(h.status(), 'Saved 2 operative note templates and 2 letters or other documents.');
      eq(h.toasts.length, 1);
      /* kind letter is a kind this shell knows - and says it never drafts a note */
      eq([h.ctx._mlsTplKindOf({ kind: ' Letter ' }), h.ctx._mlsTplKindOf({ kind: 'discharge' })], ['letter', '']);
      ok(/never drafts a note/.test(h.ctx._mlsTplKindLabel('letter')), shell + ': kind letter is not labelled as never drafting a note');
      /* the doctor's own marking wins: a row already marked letter goes to Letters */
      const d = load(shell, { model: model([piece(PLAN_BLANK, 'plan', 'x')]) });
      const marked = { name: 'x', text: PLAN_BLANK, kind: 'letter', aiGoes: 'plan', aiWhy: 'x' };
      d.ctx._tplSortApply(marked);
      eq([marked.dest, marked.destBy], ['letters', 'declared']);
    }
    {
      /* R2-7: the knee-day file (a visit, a procedure note and instructions under three titles) is ONE call, and its rows are the splitter's three */
      const h = load(shell, { model: model([piece(KNEE_DAY_VISIT, 'visit', 'A follow-up visit.'), piece(KNEE_DAY_PROC, 'op', 'A procedure note.'), piece(KNEE_DAY_INSTR, 'letter', 'Patient instructions.')]) });
      await h.upload([{ name: 'Knee day', text: KNEE_DAY }]);
      eq([h.calls.length, h.rows().map((r) => r.dest), h.rows().map((r) => r.text)], [1, ['soap', 'op', 'letters'], [KNEE_DAY_VISIT, KNEE_DAY_PROC, KNEE_DAY_INSTR]], shell + ': the knee-day file was not one call split into its three');
      /* the SOAP that ends in PATIENT INSTRUCTIONS stays one template when the splitter says so */
      const k = load(shell, { model: model([piece(SOAP_INSTR, 'visit', 'A whole visit note with its instructions.')]) });
      await k.upload([{ name: 'p', text: SOAP_INSTR, pasted: true }]);
      eq([k.rows().length, k.rows()[0].dest, k.rows()[0].text], [1, 'soap', SOAP_INSTR]);
    }

    /* ---- 3. R3-0: NO CUT IN THE BROWSER - not on ***, === or --- ---- */
    {
      /* (a) the Epic paste, signed in: ONE call with the whole text. The model names the starts; every *** stays */
      const one = load(shell, { model: model([piece(EPIC_TIGHT, 'visit', 'A whole visit note with Epic blanks.')]) });
      await one.upload([{ name: 'paste', text: EPIC_TIGHT, pasted: true }]);
      eq([one.calls.length, one.calls[0]], [1, EPIC_TIGHT], shell + ': the Epic paste was cut before the splitter saw it');
      eq([one.rows().length, one.rows()[0].text, one.rows()[0].dest], [1, EPIC_TIGHT, 'soap']);
      /* even a model that (wrongly) starts a template at every heading cannot lose a *** */
      const five = load(shell, { model: model(['CHIEF COMPLAINT:', 'HPI:', 'ROS:', 'PHYSICAL EXAM:', 'ASSESSMENT/PLAN:'].map((f) => ({ first: f, goes: 'unsure' }))) });
      await five.upload([{ name: 'paste', text: EPIC_TIGHT, pasted: true }]);
      eq(five.rows().map((r) => r.text), ['CHIEF COMPLAINT:\n***', 'HPI:\n***', 'ROS:\n***', 'PHYSICAL EXAM:\n***', 'ASSESSMENT/PLAN:\n***'], shell + ': a *** was lost');
      eq(five.rows().map((r) => r.text).join('\n'), EPIC_TIGHT);
      /* (c) the bulk op-note import: three files, three calls, three whole rows; mbb.txt keeps every *** */
      const ops = load(shell, { model: (d) => model([piece(d, 'op', 'It is a procedure note.')])(d) });
      await ops.upload([{ name: 'caudal', text: CAUDAL }, { name: 'genicular', text: GENIC }, { name: 'mbb', text: MBB }]);
      eq([ops.calls, ops.rows().map((r) => [r.dest, r.text])], [[CAUDAL, GENIC, MBB], [['op', CAUDAL], ['op', GENIC], ['op', MBB]]], shell + ': the op-note batch was cut');
      await ops.ctx.tplAddSplitSorted();
      eq(ops.libraryAdds[0].map((t) => [t.kind, t.text]), [['op', CAUDAL], ['op', GENIC], ['op', MBB]], shell + ': the op-note batch was not saved as three whole op templates');
      /* (d) --- dividers and === underlines: one call, one whole row */
      for (const text of [KNEE_DASH, PROC_UNDERLINE, 'HPI:\nOnset: [ ]\n---\nPlan:\n- [ ]\n***\nHPI:\nMechanism: [ ]']) {
        const h = load(shell, { model: model([piece(text, 'unsure', 'x')]) });
        await h.upload([{ name: 'p', text, pasted: true }]);
        eq([h.calls, h.rows().length, h.rows()[0].text], [[text], 1, text], shell + ': a rule line cut the text before the splitter saw it: ' + JSON.stringify(text.slice(0, 40)));
      }
      /* the model may cut at a --- the doctor typed; the rule line stays in the template above it */
      const typed = 'HPI:\nOnset: [ ]\n---\nPlan:\n- [ ]\n***\nHPI:\nMechanism: [ ]';
      const t3 = load(shell, { model: model([{ first: 'HPI:', goes: 'hpi' }, { first: 'Plan:', goes: 'plan' }, { first: 'Mechanism: [ ]', goes: 'hpi' }].map((p, k) => (k === 2 ? { first: 'HPI:', goes: 'hpi' } : p))) });
      await t3.upload([{ name: 'p', text: typed, pasted: true }]);
      eq(t3.rows().map((r) => r.text), ['HPI:\nOnset: [ ]\n---', 'Plan:\n- [ ]\n***', 'HPI:\nMechanism: [ ]']);
    }

    /* ---- 4. R3-2: NOTHING IS DROPPED - the server keeps every line; an answer that is not its cut is refused ---- */
    {
      /* (a) the letter's signature and dot-leader lines are kept by the cut */
      const h = load(shell, { model: model([piece(LETTER_SIGNED, 'letter', 'A work letter.')]) });
      await h.upload([{ name: 'letter', text: LETTER_SIGNED }]);
      eq(h.rows()[0].text, LETTER_SIGNED, shell + ': the signature line was dropped');
      /* (a') an OLDER server that returns the letter without its signature line is refused, and the text kept whole */
      const signedOff = LETTER_SIGNED.split('\n').slice(0, 3).join('\n');
      const o = load(shell, { answer: oldServer([piece(signedOff, 'letter', 'x')]) });
      await o.upload([{ name: 'letter', text: LETTER_SIGNED }]);
      eq([o.rows().length, o.rows()[0].text, o.rows()[0].dest, o.rows()[0].notSorted], [1, LETTER_SIGNED, '', 'bad-answer'], shell + ': an answer that dropped the signature line reached the list');
      ok(/MLS could not sort one of these: the sorting AI's answer could not be used\. It is kept whole/.test(o.html()) && /tpl-sort-retry/.test(o.html()), shell + ': the unusable answer is not said truly, or no retry');
      /* (b) HPI/***, ROS/***, A/P/*** answered as three heading-only templates by an older server: refused */
      const stars = L(['HPI:', '***', '', 'ROS:', '***', '', 'ASSESSMENT/PLAN:', '***']);
      const b = load(shell, { answer: oldServer([piece('HPI:', 'hpi'), piece('ROS:', 'ros'), piece('ASSESSMENT/PLAN:', 'plan')]) });
      await b.upload([{ name: 'p', text: stars, pasted: true }]);
      eq([b.rows().length, b.rows()[0].text, b.rows()[0].notSorted], [1, stars, 'bad-answer']);
      /* ...and the same three from the server's cut each keep their *** */
      const b2 = load(shell, { model: model([{ first: 'HPI:', goes: 'hpi' }, { first: 'ROS:', goes: 'ros' }, { first: 'ASSESSMENT/PLAN:', goes: 'plan' }]) });
      await b2.upload([{ name: 'p', text: stars, pasted: true }]);
      eq(b2.rows().map((r) => r.text), ['HPI:\n***', 'ROS:\n***', 'ASSESSMENT/PLAN:\n***']);
      /* (c) one template without its trailing ***: refused */
      const c = load(shell, { answer: oldServer([piece(stars.replace(/\n\*\*\*$/, ''), 'visit')]) });
      await c.upload([{ name: 'p', text: stars, pasted: true }]);
      eq([c.rows()[0].text, c.rows()[0].notSorted], [stars, 'bad-answer']);
      /* rewritten, reordered, overlapping, reflowed or mid-line answers: all refused, the text kept whole */
      const refusedFor = async (answer, text, what) => {
        const r = load(shell, { answer });
        await r.upload([{ name: 'k', text }]);
        eq([r.rows().length, r.rows()[0].text, r.rows()[0].dest, r.rows()[0].notSorted], [1, text, '', 'bad-answer'], shell + ': ' + what + ' reached the list');
      };
      await refusedFor(oldServer([piece(KNEE_SCOPE.replace('Weight bearing as tolerated', 'WBAT'), 'op')]), KNEE_SCOPE, 'a rewritten answer');
      await refusedFor(oldServer([piece(WORK, 'letter'), piece(LMN, 'letter')]), LMN + '\n\n' + WORK, 'a reordered answer');
      await refusedFor(oldServer([piece(LMN, 'letter'), piece(LMN.split('\n').slice(3).join('\n') + '\n\n' + WORK, 'letter')]), LMN + '\n\n' + WORK, 'an overlapping answer');
      await refusedFor(oldServer([piece(KNEE_SCOPE.replace(/\n/g, '\n   '), 'op')]), KNEE_SCOPE, 'a reflowed answer');
      await refusedFor(oldServer([piece('LETTER OF MEDICAL', 'letter'), piece(LMN.replace('LETTER OF MEDICAL', '').trim() + '\n\n' + WORK, 'letter')]), LMN + '\n\n' + WORK, 'a mid-line cut');
      /* a start that is not where its text is */
      await refusedFor(() => ({ body: { templates: [{ start: 2, text: LMN, goes: 'letter', why: 'x' }] } }), LMN, 'a start that does not match its text');
      /* a cover the server did not report */
      await refusedFor(() => ({ body: { templates: [{ start: 3, text: LMN, goes: 'letter', why: 'x' }] } }), COVER + '\n\n' + LMN, 'an unreported cover');
      /* the answer check accepts every cut the server can make, and nothing else (a seeded sweep) */
      let seed = 7;
      const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
      const pool = ['', '', 'TITLE', 'HPI:', '***', '______', '---', '* * *', 'Plan: [ ]', 'Résumé of care', 'CAFÉ', '   ', 'Sincerely,', '.....', 'Contents: 1. a 2. b'];
      let swept = 0;
      for (let it = 0; it < 400; it++) {
        const text = SPLIT.doc(Array.from({ length: 1 + rnd(20) }, () => pool[rnd(pool.length)]).join('\n'));
        if (!text.trim()) continue;
        const n = text.split('\n').length;
        const starts = Array.from(new Set(Array.from({ length: 1 + rnd(4) }, () => 1 + rnd(n)))).sort((a, b) => a - b);
        const r = SPLIT.respond(text, () => ({ templates: starts.map((s) => ({ start: s, goes: 'plan' })) }));
        if (r.body.splitRefused) continue;
        const v = load(shell, {}).ctx._tplSortVerify(text, r.body.templates, r.body.cover);
        ok(!v.refused && JSON.stringify(v.templates.map((t) => t.text)) === JSON.stringify(r.body.templates.map((t) => t.text)), shell + ': the answer check refused the server\'s own cut: ' + JSON.stringify({ text, starts }));
        const last = r.body.templates.length - 1, lines = r.body.templates[last].text.split('\n');
        if (lines.length > 1) {
          const cutShort = JSON.parse(JSON.stringify(r.body.templates)); cutShort[last].text = lines.slice(0, -1).join('\n');
          ok(load(shell, {}).ctx._tplSortVerify(text, cutShort, r.body.cover).refused, shell + ': the answer check accepted a dropped line: ' + JSON.stringify({ text, starts }));
        }
        swept++;
      }
      ok(swept > 200, shell + ': the sweep did not run');
    }

    /* ---- 5. THE SERVER'S REFUSALS, EACH SAID AS IT IS ---- */
    {
      /* too long: never sent; kept whole; no advice a PDF cannot follow (R3-9, server R3-1) */
      const long = Array.from({ length: 900 }, (_, i) => 'Line ' + i + ': [a field with a placeholder in it]').join('\n');
      const h = load(shell, { model: model([piece(long, 'visit')]) });
      await h.upload([{ name: 'huge.pdf', text: long }]);
      const r = h.rows()[0];
      eq([h.calls.length, h.rows().length, r.dest, r.notSorted, r.text], [0, 1, '', 'too-long', long]);
      ok(/^It is too long for MLS to sort \([\d,]+ characters; the most is 40,000\), so it is kept as one template\. Choose where the whole thing goes\./.test(r.why), shell + ': the too-long row is not said truly: ' + r.why);
      ok(!/---/.test(r.why) && !/tpl-sort-unsorted/.test(h.html()), shell + ': the too-long row gives advice a PDF cannot follow, or is said twice');
      /* the server's own too-long (its limit, measured on its text) */
      const s = load(shell, { answer: (text) => ({ body: SPLIT.whole(SPLIT.doc(text), 'too-long') }) });
      await s.upload([{ name: 'f', text: KNEE_SCOPE }]);
      eq([s.rows()[0].notSorted, s.rows()[0].text], ['too-long', KNEE_SCOPE]);
      /* R4 client-4: a whole file MLS could not sort is never placed by one tap - one
         tap saved 70 op notes as ONE op template. It is placed from the list only. */
      if (s.rows()[0].guess) {
        ok(!/tpl-sort-use"/.test(s.html()) && !/tpl-sort-use-all/.test(s.html()), shell + ': a too-long row offers a one-tap best guess');
        s.ctx._tplSortUseAllGuesses();
        eq(s.rows()[0].dest, '', shell + ': Use every best guess placed a too-long row');
      }
      /* R4 client-3: a rule line never names a template */
      eq(s.ctx._tplSortCleanName('---'), '', shell + ': a rule line is a name');
      eq(s.ctx._tplSortTitleOf('---\nRIGHT KNEE ARTHROSCOPY\nPROCEDURE: ***'), 'RIGHT KNEE ARTHROSCOPY', shell + ': the title skipped past the rule line wrongly');
      /* more than 30 templates */
      const many = Array.from({ length: 31 }, (_, i) => 'TEMPLATE ' + (i + 1) + '\nPLAN: [item ' + (i + 1) + ']').join('\n\n');
      const m = load(shell, { model: (d) => ({ templates: d.split('\n\n').map((_, i) => ({ start: i * 3 + 1, goes: 'plan', why: 'x' })) }) });
      await m.upload([{ name: 'many', text: many }]);
      const mr = m.rows();
      eq([mr.length, mr[0].notSorted, mr[0].text, mr[0].dest], [1, 'too-many', many, '']);
      ok(/^MLS found more templates in it than it can sort in one go, so it is kept as one template\. Choose where the whole thing goes\./.test(mr[0].why), shell + ': too-many is not said truly: ' + mr[0].why);
      ok(!/Kept as one template: MLS could not split it without changing your text/.test(m.html()), shell + ': the old, untrue refusal line is still said');
      /* an answer the server could not use */
      const bad = load(shell, { model: () => 'I could not find any templates.' });
      await bad.upload([{ name: 'f', text: ASTHMA }]);
      eq([bad.rows()[0].notSorted, bad.rows()[0].text], ['bad-answer', ASTHMA]);
      ok(/the sorting AI's answer could not be used/.test(bad.html()));
      /* a retry does not re-send what cannot be sorted in one go */
      const rt = load(shell, { model: (d) => ({ templates: d.split('\n\n').map((_, i) => ({ start: i * 3 + 1, goes: 'plan' })) }) });
      await rt.upload([{ name: 'many', text: many }]);
      const before = rt.calls.length;
      eq(await rt.ctx._tplSortRetry(), false);
      eq(rt.calls.length, before);
    }
    {
      /* failures keep each file whole, say why once, and "Try sorting again" sorts them */
      let busy = true;
      const h = load(shell, { answer: (text) => (busy ? { status: 429, body: { error: 'rate limited' } } : SPLIT.respond(text, model([piece(text, text.startsWith('PHQ') ? 'letter' : 'plan', 'ok')]))) });
      await h.upload([{ name: 'a', text: PHQ9 }, { name: 'b', text: PLAN_HEP }]);
      eq(h.rows().map((r) => [r.dest, r.notSorted]), [['', 'busy'], ['', 'busy']]);
      ok(/MLS could not sort 2 of these: MLS was busy/.test(h.html()) && /tpl-sort-retry/.test(h.html()), shell + ': a busy splitter is not explained, or no retry');
      busy = false;
      await h.ctx._tplSortRetry();
      eq(h.rows().map((r) => r.dest), ['letters', 'plan'], shell + ': Try sorting again did not sort them');
      ok(!/tpl-sort-unsorted/.test(h.html()));
      for (const [label, answer, why] of [['5xx', () => ({ status: 502, body: {} }), /MLS did not answer/], ['network', () => 'throw', /MLS could not be reached/], ['403', () => ({ status: 403, body: {} }), /not available on this account/]]) {
        const f = load(shell, { answer });
        await f.upload([{ name: 'a', text: OB }, { name: 'b', text: KNEE_SCOPE }, { name: 'c', text: LMN }]);
        const rows = f.rows();
        eq(rows.map((r) => [r.text, r.dest]), [[OB, ''], [KNEE_SCOPE, ''], [LMN, '']], shell + ': a ' + label + ' failure lost, cut or placed a file');
        ok(why.test(f.html()), shell + ': the ' + label + ' failure does not say why');
      }
    }

    /* ---- 6. R3-1: WHAT READS - fill-in-the-blank forms and short section templates do; the reason for what does not is TRUE ---- */
    {
      const letters = (t) => (t.match(/[A-Za-z]/g) || []).length, nonSpace = (t) => t.replace(/\s+/g, '').length;
      ok(letters(WORK_FORM) * 4 < nonSpace(WORK_FORM) && letters(SCHOOL) * 4 < nonSpace(SCHOOL), 'the form fixtures are not mostly blanks');
      const h = load(shell, { model: (d) => model([piece(d, 'letter', 'It is a form to fill in.')])(d) });
      await h.upload([{ name: 'work-status.txt', text: WORK_FORM }, { name: 'paste', text: WORK_FORM.replace('WORK STATUS REPORT', 'WORK STATUS REPORT (pasted)'), pasted: true }, { name: 'school-excuse.docx', text: SCHOOL }]);
      const rows = h.rows();
      eq(rows.map((r) => [!!r.unreadable, r.dest]), [[false, 'letters'], [false, 'letters'], [false, 'letters']], shell + ': a fill-in-the-blank form was refused as unreadable');
      ok(!/couldn|could not extract/.test(h.status() + h.html()), shell + ': a form is still told it could not be read: ' + h.status());
      await h.ctx.tplAddSplitSorted();
      eq(h.libraryAdds[0].map((t) => [t.kind, t.text]), [['letter', WORK_FORM], ['letter', WORK_FORM.replace('WORK STATUS REPORT', 'WORK STATUS REPORT (pasted)')], ['letter', SCHOOL]], shell + ': the forms could not be added as letters');
      /* short section templates in files read, like pastes; binary junk does not */
      const s = load(shell, { signedIn: false });
      await s.upload([{ name: 'ros-short.txt', text: 'ROS:\nEyes: [ ]\nSkin: [ ]\nNeuro: [ ]' }, { name: 'Plan template.docx', text: PLAN_BLANK }, { name: 'junk.doc', text: 'PK\u0003\u0004\u0014\u0000\u0006\u0000\uFFFD\uFFFD\u0000\u0000', reason: 'legacy-doc' }]);
      eq(s.rows().map((r) => !!r.unreadable), [false, false, true], shell + ': a short section template file was called unreadable');
      ok(/old Word \.doc/.test(s.rows()[2].why), shell + ': the old .doc does not get its reader\'s reason: ' + s.rows()[2].why);
      /* a paste or a .txt is never told "no text could be extracted" */
      const p = load(shell, { signedIn: false });
      await p.upload([{ name: 'Pasted template', text: '[ ] ok ____________', pasted: true }]);
      const pr = p.rows()[0];
      ok(pr.unreadable && /paste/i.test(pr.name) && /too few to be a template/.test(pr.why) && !/extract/.test(pr.why + p.status()), shell + ': a short paste is not told the truth: ' + JSON.stringify([pr.name, pr.why, p.status()]));
      ok(/^Your paste could not be used as a template\./.test(p.status()), shell + ': the paste is called a file: ' + p.status());
      eq(pr.text, '[ ] ok ____________', shell + ': the pasted words were not kept');
      const t = load(shell, { signedIn: false });
      await t.upload([{ name: 'blank.txt', text: '   \n  ', reason: 'unreadable' }]);
      ok(/This file is empty/.test(t.rows()[0].why) && !/extract/.test(t.rows()[0].why), shell + ': an empty .txt is told something untrue: ' + t.rows()[0].why);
      const pdf = load(shell, { signedIn: false });
      await pdf.upload([{ name: 'scan.pdf', text: '', reason: 'no-text-layer' }]);
      ok(!/too few|This file is empty/.test(pdf.rows()[0].why), shell + ': a scanned PDF lost its reader\'s own reason: ' + pdf.rows()[0].why);
    }

    /* ---- 7. NAMES, Name: LINES AND THE COVER PAGE ---- */
    {
      /* names: the splitter's name, then the template's own title, then the file name - never a Procedure: line, a lone S or a Patient: line */
      const h = load(shell, { model: (d) => model([piece(d, 'op', 'x', { name: d.startsWith('Procedure') ? 'Procedure: Under ultrasound guidance the joint was prepped' : '' })])(d) });
      await h.upload([{ name: 'knee-injection_v2', text: 'Procedure: Under ultrasound guidance the joint was prepped and draped.\nL of fluid removed.' },
        { name: 'All my templates', text: 'Knee Joint Injection\nPROCEDURE: [ ]\nCOMPLICATIONS: None' }, { name: 'paste', text: 'S:\n[subjective]\nO:\n[objective]\nA:\n[assessment]\nP:\n[plan]', pasted: true },
        { name: 'paste', text: 'Patient:\nDate of service: [ ]\nHPI: [ ]', pasted: true }]);
      const names = h.rows().map((r) => r.name);
      eq(names.slice(0, 2), ['knee injection v2', 'Knee Joint Injection'], shell + ': names do not prefer the template\'s own title over the file name: ' + JSON.stringify(names));
      ok(names.every((n) => !/^(?:S|Patient|Procedure|Under ultrasound)/.test(n)), shell + ': a name came from a field line: ' + JSON.stringify(names));
      const m = load(shell, { model: model([piece('HPI:\nOnset: [ ]', 'hpi', 'x', { name: 'HPI template' })]) });
      await m.upload([{ name: 'f', text: 'Name: Knee HPI\nKeywords: knee\nHPI:\nOnset: [ ]' }]);
      eq([m.calls[0], m.rows()[0].name, m.rows()[0].explicit, m.ctx._tplSortLabel(m.rows()[0])], ['HPI:\nOnset: [ ]', 'Knee HPI', true, 'Knee HPI'], shell + ': an explicit Name: line lost to another name');
    }
    {
      /* R3-4: "Name: ______" is a blank on a form, not the template's name - the line stays in the form */
      const h = load(shell, { model: (d) => model([piece(d, 'letter', 'A questionnaire.')])(d) });
      await h.upload([{ name: 'paste', text: NAME_BLANK, pasted: true }]);
      const r = h.rows()[0];
      eq([h.calls[0], r.text, !!r.explicit], [NAME_BLANK, NAME_BLANK, false], shell + ': a blank Name: field was taken as metadata');
      ok(!/_{3}/.test(r.name), shell + ': the row is named by underscores: ' + r.name);
      for (const blank of ['Name: [ ]', 'Name: [Patient name]', 'Name: ____ DOB: ____', 'Name: :']) eq(h.ctx._tplParseMeta(blank + '\nHPI: [ ]').name, '', shell + ': "' + blank + '" was read as a template name');
      eq(h.ctx._tplParseMeta('Name: Knee HPI\nHPI: [ ]').name, 'Knee HPI');
    }
    {
      /* R3-5: a retry keeps the Name: rule - one named template stays ONE */
      let busy = true;
      const h = load(shell, { answer: (text) => (busy ? { status: 429, body: {} } : SPLIT.respond(text, model([{ first: 'HPI:', goes: 'hpi' }, { first: 'PLAN:', goes: 'plan' }]))) });
      await h.upload([{ name: 'paste', text: NAMED_PAIR, pasted: true }]);
      eq([h.rows().length, h.rows()[0].name, h.rows()[0].notSorted], [1, 'Knee templates', 'busy']);
      busy = false;
      await h.ctx._tplSortRetry();
      const rows = h.rows();
      eq([rows.length, rows[0].name, rows[0].explicit, rows[0].text], [1, 'Knee templates', true, NAMED_PAIR.split('\n').slice(1).join('\n')], shell + ': Try sorting again cut a Name: template: ' + JSON.stringify(rows.map((r) => r.name)));
      ok(/MLS read it as 2 templates, but its Name: line says it is one\./.test(rows[0].why), shell + ': the retried Name: row does not say why it stayed one: ' + rows[0].why);
      /* the first sort says the same */
      const f = load(shell, { model: model([{ first: 'HPI:', goes: 'hpi' }, { first: 'PLAN:', goes: 'plan' }]) });
      await f.upload([{ name: 'paste', text: NAMED_PAIR, pasted: true }]);
      eq([f.rows().length, f.rows()[0].name], [1, 'Knee templates']);
    }
    {
      /* R3-6: the cover page. ONE template: its cover lines go back at its top by default, and can be left out or made a template */
      const one = load(shell, { model: model([piece(VISIT_1, 'visit', 'A visit note.', { name: 'Low back visit' })]) });
      await one.upload([{ name: 'Clinic templates', text: COVER + '\n\n' + VISIT_1 }]);
      let r = one.rows();
      eq([r.length, r[0].cover, r[0].coverAt, r[0].text], [1, COVER, 'top', COVER + '\n\n' + VISIT_1], shell + ': a one-template file did not keep its cover lines at the top');
      ok(/The first 2 lines read as a cover page; they are kept at the top of this template\./.test(one.html()) && /Leave them out/.test(one.html()) && /Add them as a template/.test(one.html()), shell + ': the cover row does not offer its choices');
      one.ctx._tplSortCover(0, 'out');
      r = one.rows();
      eq([r[0].text, r[0].coverAt], [VISIT_1, 'out']);
      ok(/Put them back at the top/.test(one.html()), shell + ': a cover left out cannot be put back');
      one.ctx._tplSortCover(0, 'top');
      eq(one.rows()[0].text, COVER + '\n\n' + VISIT_1);
      one.ctx._tplSortCover(0, 'own');
      r = one.rows();
      eq([r.length, r[0].text, r[1].text, r[1].cover], [2, COVER, VISIT_1, ''], shell + ': "Add them as a template" did not make the cover its own row');
      /* SEVERAL templates: the cover is left out, and can be put back at the top of the first */
      const two = load(shell, { model: model([piece(VISIT_1, 'visit', 'x'), piece(LMN, 'letter', 'x')]) });
      await two.upload([{ name: 'Clinic templates', text: COVER + '\n\n' + VISIT_1 + '\n\n' + LMN }]);
      r = two.rows();
      eq([r.length, r[0].coverAt, r[0].text], [2, 'out', VISIT_1]);
      ok(/The 2 lines before the first template read as a cover page, so they were left out\./.test(two.html()) && /Put them back at the top/.test(two.html()), shell + ': the left-out cover cannot be put back');
      two.ctx._tplSortCover(0, 'top');
      eq(two.rows()[0].text, COVER + '\n\n' + VISIT_1);
      /* an explicit Name: template ignores the cover rule: the whole body is the template */
      const named = load(shell, { model: model([piece(VISIT_1, 'visit', 'x')]) });
      await named.upload([{ name: 'f', text: 'Name: Low back visit\n' + COVER + '\n\n' + VISIT_1 }]);
      r = named.rows();
      eq([r.length, r[0].name, r[0].text, r[0].cover || ''], [1, 'Low back visit', COVER + '\n\n' + VISIT_1, ''], shell + ': an explicit Name: template lost its top lines to the cover rule');
    }

    /* ---- 8. ONE-SECTION TEMPLATES AND SPLIT INTO SECTIONS ---- */
    {
      const h = load(shell, {});
      const required = (text, family) => Array.from(h.ctx._mlsRequiredTemplateHeadings({ templateMode: 'adapt', templateText: text }, family));
      const hpi = h.ctx._tplSortSaveText({ text: HPI_BLOCKS, dest: 'hpi' });
      ok(!/HISTORY OF PRESENT ILLNESS/.test(hpi) && /PAST MEDICAL HISTORY:/.test(hpi) && /^\[onset, location, duration\]/.test(hpi), shell + ': the HPI heading was kept or inner headings lost: ' + JSON.stringify(hpi));
      eq(required(hpi, 'hpi'), ['PAST MEDICAL HISTORY', 'MEDICATIONS', 'ALLERGIES']);
      const exam = h.ctx._tplSortSaveText({ text: EXAM_BLOCKS, dest: 'exam' });
      ok(!/PHYSICAL EXAMINATION/.test(exam), shell + ': the exam kept its own heading: ' + exam);
      ok(!required(exam, 'exam').includes('PHYSICAL EXAMINATION'));
      /* a problem-by-problem A&P keeps its inner Assessment:/Plan: lines */
      const ap = h.ctx._tplSortSaveText({ text: 'ASSESSMENT AND PLAN:\n# Knee OA\n  Assessment: [ ]\n  Plan: [brace]', dest: 'plan' });
      eq(ap, '# Knee OA\n  Assessment: [ ]\n  Plan: [brace]');
      /* Split into sections: no part keeps its section's own heading as a required inner heading */
      const hs = load(shell, { model: model([piece(HP, 'visit', 'It is an H&P.')]) });
      await hs.upload([{ name: 'H&P', text: HP }]);
      ok(hs.html().includes('tpl-sort-split'), shell + ': Split into sections is not offered on the H&P');
      hs.ctx._tplSortSplit(0);
      const parts = hs.rows();
      eq(parts.map((p) => p.dest), ['hpi', 'ros', 'exam', 'assessment', 'plan']);
      const own = { hpi: /HISTORY OF PRESENT ILLNESS|^HPI$/, ros: /REVIEW OF SYSTEMS/, exam: /PHYSICAL EXAM/, assessment: /^ASSESSMENT$/, plan: /^PLAN$/ };
      parts.forEach((p) => {
        const saved = hs.ctx._tplSortSaveText(p);
        ok(!required(saved, p.dest).some((x) => own[p.dest].test(x)), shell + ': the ' + p.dest + ' part keeps its own heading as a required inner heading: ' + JSON.stringify(required(saved, p.dest)));
      });
      /* R3-7: Chief complaint and HPI stay two blocks - the HPI's own placeholder is not moved under CHIEF COMPLAINT */
      eq(hs.ctx._tplSortSaveText(parts[0]), 'CHIEF COMPLAINT:\n[ ]\nHPI:\n[onset, location, duration]\nPAST MEDICAL HISTORY:\n[ ]', shell + ': the HPI part merged Chief complaint and HPI');
      eq(required(hs.ctx._tplSortSaveText(parts[0]), 'hpi'), ['CHIEF COMPLAINT', 'PAST MEDICAL HISTORY']);
    }
    {
      /* R2-9: "P: [ ]" in the vitals of the O: block is a pulse, not the Plan */
      const h = load(shell, { model: model([piece(SOAP_VITALS, 'visit', 'S/O/A/P note.')]) });
      await h.upload([{ name: 'soap', text: SOAP_VITALS }]);
      h.ctx._tplSortSplit(0);
      const parts = h.rows();
      const plan = parts.find((p) => p.dest === 'plan'), exam = parts.find((p) => p.dest === 'exam');
      ok(plan && exam, shell + ': the S/O/A/P note did not split into its parts: ' + JSON.stringify(parts.map((p) => p.dest)));
      ok(!/R: |BP: |General: |Lungs: /.test(plan.text) && /^- Continue/.test(plan.text), shell + ': the pulse line started a Plan part: ' + JSON.stringify(plan.text));
      ok(/P: \[ \]/.test(exam.text) && /Lungs: \[ \]/.test(exam.text), shell + ': the vitals left the exam: ' + JSON.stringify(exam.text));
    }

    /* ---- 9. THE SAVE ---- */
    {
      /* the duplicate-aware summary counts exactly what was saved */
      const h = load(shell, { model: (d) => model([piece(d, d.startsWith('PROCEDURE') ? 'op' : 'letter', 'x')])(d),
        libraryAnswer: () => ({ counts: { added: 1, updated: 0, duplicated: 1, rejected: 0, unchanged: 0 } }) });
      await h.upload([{ name: 'a', text: TFESI }, { name: 'b', text: LMN }]);
      await h.ctx.tplAddSplitSorted();
      eq(h.status(), 'Saved 1 of 2 operative notes and letters (1 was already in your library).', shell + ': the summary guessed which kind was saved');
      const one = load(shell, { model: (d) => model([piece(d, 'op', 'x')])(d), libraryAnswer: () => ({ counts: { added: 0, duplicated: 1 } }) });
      await one.upload([{ name: 'a', text: TFESI }]);
      await one.ctx.tplAddSplitSorted();
      eq(one.status(), 'Nothing was saved yet. The operative note template was already in your library, so nothing was added twice.');
    }
    {
      /* a batch of files: every file to the splitter, bounded, rows in file order */
      let inFlight = 0, max = 0;
      const files = Array.from({ length: 9 }, (_, i) => ({ name: 'f' + i, text: 'HPI:\nFile ' + i + ' onset [ ]' }));
      const h = load(shell, { model: (d) => model([piece(d, 'hpi', 'x')])(d) });
      const realFetch = h.ctx.fetch;
      h.ctx.fetch = async function (u, init) { inFlight++; max = Math.max(max, inFlight); await new Promise((r) => setTimeout(r, 5)); try { return await realFetch(u, init); } finally { inFlight--; } };
      await h.upload(files);
      eq(h.calls.length, 9);
      ok(max > 1 && max <= Number(/var _TPL_AI_LIMIT=(\d+)/.exec(html)[1]), shell + ': the splitter calls are not bounded: ' + max);
      eq(h.rows().map((r) => r.text), files.map((f) => f.text), shell + ': the rows are not in file order');
    }

    /* ---- 10. the card's copy, and every picker leaves a letter out ---- */
    const dropZone = (/id="tplMultiDrop"[^>]*>([^<]*)</.exec(html) || [])[1] || '';
    ok(!/multi-form PDF/.test(dropZone) && /Drag &amp; drop your template files here/.test(dropZone), shell + ': the drop zone still invites a multi-form PDF: ' + dropZone);
    ok(/<option value="letters">|'letters','Letters &amp; other documents'|\['letters','Letters & other documents'\]/.test(html), shell + ': Letters is not a destination');
    for (const [where, marker] of [['the op-note room ranker', "getTemplates().filter(function(t){ var k=_mlsTplKindOf(t); return k===''||k==='op'; });"],
      ['the op-note dropdown', "_tplStore().filter(function(t){ return !(typeof _mlsTplKindOf==='function'&&_mlsTplKindOf(t)==='letter'); });"],
      ['the visit and op picker', "if(tk==='letter') continue;"], ['the generation scope gate', "if(_mlsTplKindOf(tpl)==='letter') return 'letter';"],
      ['the specialty preset list', "_mlsTplKindOf(t)==='letter'); }); if(!list.length) return;"], ['the default after an import', "list.slice(0,keep.length).reverse().filter(function(x){ var k=_mlsTplKindOf(x); return k!=='letter'&&k!=='insurance'; })[0];"]]) {
      ok(html.includes(marker), shell + ': ' + where + ' does not leave a letter out');
    }
    ok((html.match(/if\(tk==='letter'\) continue;/g) || []).length >= 2, shell + ': the exact-name pick does not leave a letter out');
  }

  /* ---- 11. the connect bundles and shared modules: letters never draft, and no patient note is staged as a template (R3-3, R3-10) ---- */
  for (const f of ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const emr = between(src, "host.querySelector('#emrAi').onclick=function(){", 'host.querySelector(\'#emrIns\').onclick', f + ' EMR AI sort');
    ok(!/tplAiSplit|tplMultiFile|_tplPendingSplit/.test(emr), f + ': the EMR panel\'s AI sort still hands a patient note to the template intake');
    ok(/AI sort is not available for a patient note\./.test(src), f + ': the AI sort button does not say why it does nothing');
    ok(/if \(declared === "letter"\) return "unknown";/.test(src) && /window\._mlsTplKindOf\(t\) === "letter"\) return "unknown";/.test(src), f + ': the class pickers can still pick a letter');
  }
  const room = fs.readFileSync(path.join(root, 'feat_mls_opnote_room.js'), 'utf8');
  ok(/buildTplRail[\s\S]{0,900}=== 'letter'/.test(room), 'the op-note room\'s rail still offers a letter');
  const fill = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');
  ok(/var tpls = templates\(\)\.filter\([\s\S]{0,200}=== 'letter'/.test(fill), 'the op-note bulk assign still offers a letter');
  const boost = fs.readFileSync(path.join(root, 'feat_mls_opmatch_boost.js'), 'utf8');
  ok(/return k === '' \|\| k === 'op';/.test(boost), 'the op-match practice default can fall back to a letter');
  const lib = fs.readFileSync(path.join(root, 'feat_mls_template_library.js'), 'utf8');
  ok(/if\(!S\(t\.kind\)\.trim\(\)&&S\(l\.kind\)==='letter'\)t\.kind='letter';/.test(lib) && /letterHints\[k\]=1/.test(lib) && /letterHints\[letterKey\(t\)\]\)t\.kind='letter'/.test(lib), 'a library server that predates kind letter turns a letter back into "any kind"');

  console.log('PASS template sorter (' + checks + ' checks): the browser never cuts a template - every file and paste goes to the splitter ONCE, WHOLE (an Epic *** paste, --- dividers, === underlines and a batch of op notes with *** blanks all stay whole), and the rows are the server\'s cut at the lines the model names, answered by the backend\'s own contract; ' +
    'nothing is dropped (signature, *** and dot-leader lines are kept) and the answer check accepts every cut the server can make and refuses any other answer (rewritten, reordered, overlapping, reflowed, mid-line, a dropped line, an unreported cover) as "the sorting AI\'s answer could not be used"; ' +
    'too long, too many and unusable answers each keep the text whole and are said truly, with no advice a PDF cannot follow; fill-in-the-blank forms and short section templates read, and a paste or a .txt is never told no text could be extracted; ' +
    '"Name: ____" is a form field, a retry keeps a Name: template whole, a cover page goes back at the top of a one-template file and can be left out or made a template; Chief complaint and HPI stay two blocks in a Split H&P; ' +
    'signed out, offline or in the sample workspace every file stays one row to choose with its reason said once; letters are saved as kind letter and every picker leaves them out; the EMR panel never stages a patient note');
})().catch((e) => { console.error(e); process.exit(1); });

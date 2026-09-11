'use strict';
/* THE SAVED NOTE BODY IS THE NOTE (opclean)
 *
 * Measured on a real batch of 25 operative notes drafted for one clinic day.
 * Four separate things reached the note text that are not clinical content,
 * and this suite pins all four by EXECUTING the shipped functions — the ones
 * that are actually live, which for three of the four is not the shell:
 * feat_mls_opnote_integrity.js replaces the shell's ranker and generator at
 * runtime (install() rebinds _opRankTemplates and _genOpNote), so a fix made
 * only in ScribeFlow.html would ship to nobody.
 *
 *   1. A POSITIONAL MARKER IS NOT A LABEL. 20 of 25 notes carried a literal
 *      [FILL: after "<words>" before "<words>"] in the body, and 5 carried a
 *      truncated remnant of one on its own line. Both came from
 *      normalizeAnonBlanks(), which composed the label out of the words either
 *      side of the blank and then cut it to 70 characters — so the marker told
 *      the clinician where the blank was rather than what to write, and the
 *      cut left quotes unterminated. The remnant came from a second mechanism:
 *      headingLabel() read any line starting "[FILL: ..." as a SECTION HEADING
 *      named "[FILL", after which sourceSections() re-emitted the tail without
 *      its "[FILL:" prefix and airSections() gave it a blank line of its own.
 *
 *   2. AN NPI BELONGS TO ONE PERSON. Every one of the 25 notes ended with an
 *      internal provider/facility block appended to the note text, and that
 *      block paired the OPERATING PROVIDER's name with the SIGNED-IN ACCOUNT
 *      HOLDER's NPI. On that account the operating provider is a physician and
 *      the account holder is a physician assistant, so every note asserted the
 *      PA's NPI as the surgeon's. The app holds exactly one NPI (the
 *      account-level Settings field) and the provider roster carries none, so
 *      when the note names somebody else there is no second value to reach
 *      for: no NPI is the only honest answer.
 *
 *   3. A STUB TEMPLATE MUST NOT WIN ON A DUPLICATED NAME. The library holds
 *      199 templates under 102 names; "Left sacroiliac joint injection" exists
 *      five times, four of them full operative notes and one a 433-character
 *      header sheet. Every one scored identically, so the tie resolved by
 *      library order and the header sheet won. Four patients were drafted from
 *      it and got an operative note with no description of the procedure.
 *
 *   4. SCHEDULING TEXT IS NOT A PROCEDURE. 6 of 25 notes printed the
 *      appointment's billing residue in their own "Procedure:" line
 *      ("AUTH# ...", "PER <payer> PORTAL NO AUTH RE", "NO AUTH REQ. REF# ...",
 *      a trailing " P", a staff nickname after a slash).
 *
 * SYNTHETIC DATA ONLY. No patient text, no real name, no real identifier.
 *
 * RED-BEFORE-FIX. Point MLS_OPCLEAN_ROOT at a directory holding the pre-fix
 * copies of the four sources and re-run: the assertions below report
 * individually, so the run names exactly which ones the old bytes fail.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.MLS_OPCLEAN_ROOT || path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ONI = read('feat_mls_opnote_integrity.js');
const FILL = read('feat_mls_opnote_fill.js');
const PREP = read('feat_mls_opnote_prep.js');
const SHELL = read('1pScribeFlow.html');

/* ---- a reporting runner, so a red run names every failure at once ------- */
const results = [];
function t(name, fn) {
  try { fn(); results.push({ ok: true, name: name }); }
  catch (e) { results.push({ ok: false, name: name, why: (e && e.message) || String(e) }); }
}

/* ---- synthetic identities ---------------------------------------------- */
const ACCOUNT = { name: 'Robin Vega', cred: 'PA-C', npi: '1234567893' };
const SURGEON = 'Dana Ruiz, MD';
const FACILITY = 'Northgate Surgery Center';

function baseDocument() {
  return {
    readyState: 'complete', addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; },
    createElement() { return { style: {}, appendChild() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; },
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  };
}
function baseContext(extra) {
  const ctx = Object.assign({
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    setTimeout, clearTimeout, setInterval() { return 1; }, clearInterval() {},
    document: baseDocument(),
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    getPatients: () => [], getTemplates: () => [], getTemplateById: () => null,
    getKey: () => 'k', _opDobKey: (v) => String(v || '').trim(), _opPreviewHtml: () => '',
    opPrepRender() {}, async opPrepGenerateOne() {}, toast() {}
  }, extra || {});
  ctx.window = ctx;
  return ctx;
}
function runIn(ctx, src, file) { vm.runInNewContext(src, ctx, { filename: file }); return ctx; }
function runMore(ctx, src, file) { vm.runInContext(src, ctx, { filename: file }); return ctx; }

/* prep + fill share one context so fill can reach prep's provider comparator,
   exactly as they do in the browser (mls-connect appends both). */
function opNoteContext(settings) {
  settings = settings || {};
  const ctx = baseContext(settings);
  vm.createContext(ctx);
  runMore(ctx, PREP, 'feat_mls_opnote_prep.js');
  runMore(ctx, FILL, 'feat_mls_opnote_fill.js');
  runMore(ctx, ONI, 'feat_mls_opnote_integrity.js');
  return ctx;
}

/* normalizeAnonBlanks is exported by the fixed module; lift it out of the
   source when it is not, so the pre-fix bytes can be driven too. */
function anonBlanks(ctx, source) {
  const api = ctx.__mlsOpNoteFill;
  if (api && typeof api._normalizeAnonBlanks === 'function') return api._normalizeAnonBlanks;
  const lifted = { String, RegExp, Math, Object, Array };
  vm.createContext(lifted);
  vm.runInContext(functionBlock(source, 'S') + '\n' + functionBlock(source, 'normalizeAnonBlanks') +
    '\nthis.fn = normalizeAnonBlanks;', lifted);
  return lifted.fn;
}

/* ---- lifting a plain function out of a source file --------------------- */
function functionBlock(input, name) {
  const at = input.indexOf('function ' + name + '(');
  if (at < 0) return null;
  const brace = input.indexOf('{', at);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < input.length; i++) {
    const ch = input[i], next = input[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return input.slice(at, i + 1); }
  }
  return null;
}

/* =======================================================================
 * 1. NOTHING BUT THE NOTE REACHES THE NOTE BODY
 * ===================================================================== */
/* A FILLED template, on purpose. reanchor() turns an EMPTY heading slot into
   an explicit [[placeholder]] for the doctor to answer, which is correct
   behaviour and is counted by the save gate — so leaving one here would make
   the "[[" assertion measure reanchor rather than the scaffolding block. */
const TEMPLATE = [
  'OPERATIVE REPORT',
  'Patient: Sample Patient',
  'Date of Procedure: Monday, September 14, 2026',
  'Type of Anesthesia: ___',
  'DESCRIPTION OF PROCEDURE:',
  'The patient was brought to the procedure suite and placed prone on the fluoroscopy table.',
  'Under fluoroscopic guidance a spinal needle was advanced to the target and the position confirmed.',
  'The injectate was delivered without difficulty and the needle was withdrawn.',
  'The patient tolerated the procedure well. ___',
  '',
  SURGEON
].join('\n');

const NEVER_IN_A_NOTE = [
  ['PROVIDER & FACILITY', 'the internal provider/facility scaffolding block is inside the saved note body'],
  ['[[', 'an unfilled [[placeholder]] is inside the saved note body'],
  ['not submitted to athenaOne', 'the internal draft disclaimer is inside the saved note body']
];
const POSITIONAL_MARKER = /\[FILL:[^\]]*\b(after|before)\s+"/;

{
  const ctx = opNoteContext({
    getProviderName: () => ACCOUNT.name, clinicalProviderName: () => ACCOUNT.name,
    getProviderCred: () => ACCOUNT.cred, getNpi: () => ACCOUNT.npi,
    getPracticeName: () => 'Northgate Pain Group'
    /* deliberately no getFacilityName: the unfilled facility is what put the
       literal [[facility_name]] into the owner's 25 notes */
  });
  const oni = ctx.__mlsOpNoteIntegrity, prep = ctx.__mlsOpNotePrep;
  const normalize = anonBlanks(ctx, FILL);

  /* the generation context an operative row actually carries: the schedule
     names the operating surgeon, Settings holds the account holder's NPI */
  const genCtx = { patientId: 'p-1', name: 'Sample Patient', provider: SURGEON, providerName: SURGEON, providerNpi: ACCOUNT.npi };

  let body = normalize(TEMPLATE);
  body = oni.reanchor(body, normalize(TEMPLATE), {});
  body = oni.airSections(body);
  body = prep.attest(body, genCtx);

  for (const [needle, why] of NEVER_IN_A_NOTE) {
    t('note body has no "' + needle + '"', () => {
      assert(body.indexOf(needle) < 0, why + '\n  --- note body ---\n' + body);
    });
  }
  t('note body has no positional [FILL: after "..." before "..."] marker', () => {
    assert(!POSITIONAL_MARKER.test(body),
      'a blank was labelled with WHERE it sits instead of WHAT to supply\n  --- note body ---\n' + body);
  });
  t('note body has no amputated marker remnant on its own line', () => {
    assert(!/^\s*(after|before)\s+"/m.test(body),
      'a line of the note is the tail of a [FILL: ...] marker with its prefix removed\n  --- note body ---\n' + body);
  });
  t('note body does not print the account holder NPI beside another surgeon', () => {
    assert(body.indexOf(ACCOUNT.npi) < 0,
      'the signed-in account holder\'s NPI is in a note that names a different operating provider\n  --- note body ---\n' + body);
  });

  /* POSITIVE CONTROL: the clinical content really did survive the pipeline, so
     the four absences above are measuring removals and not an empty string. */
  t('CONTROL the clinical narrative survived the pipeline', () => {
    assert(body.indexOf('DESCRIPTION OF PROCEDURE') >= 0, 'the procedure heading was lost');
    assert(body.indexOf('a spinal needle was advanced to the target') >= 0, 'the technique sentence was lost');
    assert(body.indexOf(SURGEON) >= 0, 'the signature line was lost');
  });

  /* the footer entry point still exists and is now inert, for every shape */
  t('the attestation entry point returns the note unchanged', () => {
    for (const sample of ['', 'NOTE BODY', TEMPLATE]) {
      assert.strictEqual(prep.attest(sample, genCtx), sample,
        'prep.attest still adds text to the note body');
    }
  });
}

/* =======================================================================
 * 1b. A BLANK IS A CLINICAL LABEL, OR IT IS NOTHING
 * ===================================================================== */
{
  const ctx = opNoteContext({});
  const normalize = anonBlanks(ctx, FILL);

  t('a labelled blank becomes its own field label', () => {
    assert.strictEqual(normalize('Type of Anesthesia: ___'), 'Type of Anesthesia: [FILL: Type of Anesthesia]',
      'the blank under a field label did not take that label');
    assert.strictEqual(normalize('Estimated Blood Loss:\n___'), 'Estimated Blood Loss:\n[FILL: Estimated Blood Loss]',
      'a blank on the line below its label did not take that label');
  });
  t('an unlabelled blank is left exactly as the doctor wrote it', () => {
    const prose = 'The patient tolerated the procedure well. ___\n\n' + SURGEON;
    assert.strictEqual(normalize(prose), prose,
      'a blank with no label was given a positional description instead of being left alone');
  });
  t('no emitted marker is truncated or carries an unterminated quote', () => {
    const long = 'methylprednisolone acetate injectable suspension ___ administered intraarticularly today';
    const out = normalize(long);
    const markers = out.match(/\[FILL:[^\]]*\]/g) || [];
    for (const m of markers) {
      assert(m.indexOf('"') < 0, 'an emitted marker quotes surrounding prose: ' + JSON.stringify(m));
      assert(!POSITIONAL_MARKER.test(m), 'an emitted marker describes a position: ' + JSON.stringify(m));
    }
    assert(!POSITIONAL_MARKER.test(out), 'the long-neighbourhood case still emits a positional marker: ' + JSON.stringify(out));
  });
}

/* =======================================================================
 * 1c. A PLACEHOLDER LINE IS NOT A SECTION HEADING
 * This is the mechanism that AMPUTATED the marker's "[FILL:" prefix and put
 * the remnant on a line of its own.
 * ===================================================================== */
{
  const ctx = opNoteContext({});
  const oni = ctx.__mlsOpNoteIntegrity;
  t('a [FILL: ...] line is not counted as a heading', () => {
    const h = oni.headings('PROCEDURE:\n[FILL: type of anesthesia]\nDESCRIPTION OF PROCEDURE:\nprose here');
    assert(h.indexOf('fill') < 0, 'the note grew a phantom "fill" section: ' + JSON.stringify(h));
  });
  t('the spacing pass does not break a note around a [FILL: ...] line', () => {
    const out = oni.airSections('Type of Anesthesia: none\n[FILL: contrast]');
    assert.strictEqual(out, 'Type of Anesthesia: none\n[FILL: contrast]',
      'a blank line was inserted in front of a placeholder, which is what put the remnant on its own line');
  });
  t('CONTROL a real heading is still a heading', () => {
    const h = oni.headings('PROCEDURE:\nDESCRIPTION OF PROCEDURE:\nprose here');
    assert(h.indexOf('description of procedure') >= 0, 'the heading reader stopped seeing real headings: ' + JSON.stringify(h));
  });
}

/* =======================================================================
 * 2. AN NPI IS PRINTED ONLY BESIDE ITS OWNER
 * Both branches are driven: the account holder IS the operating provider (the
 * legitimate case, which must keep working), and the operating provider is
 * somebody else (no NPI at all, never the account's).
 * ===================================================================== */
{
  const settings = {
    getProviderName: () => ACCOUNT.name, clinicalProviderName: () => ACCOUNT.name,
    getProviderCred: () => ACCOUNT.cred, getNpi: () => ACCOUNT.npi,
    getPracticeName: () => 'Northgate Pain Group', getFacilityName: () => FACILITY
  };
  const ctx = opNoteContext(settings);
  const prep = ctx.__mlsOpNotePrep, oni = ctx.__mlsOpNoteIntegrity, fill = ctx.__mlsOpNoteFill;

  t('the panel prints the NPI when the account holder IS the operating provider', () => {
    const panel = prep.providerFacilityPanel({ provider: ACCOUNT.name + ', ' + ACCOUNT.cred });
    assert(panel.indexOf('NPI: ' + ACCOUNT.npi) >= 0,
      'the configured provider stopped getting their own NPI: ' + JSON.stringify(panel));
    assert(panel.indexOf('Facility: ' + FACILITY) >= 0, 'the facility line was lost');
  });
  t('the panel prints NO NPI line when the operating provider is somebody else', () => {
    const panel = prep.providerFacilityPanel({ provider: SURGEON });
    assert(panel.indexOf(SURGEON) >= 0, 'the panel stopped naming the operating provider');
    assert(panel.indexOf(ACCOUNT.npi) < 0,
      'the account holder\'s NPI is printed beside a different surgeon\'s name: ' + JSON.stringify(panel));
    assert(!/^NPI:/m.test(panel),
      'an NPI line was printed for a provider whose NPI the app does not hold: ' + JSON.stringify(panel));
  });
  t('the generation context drops identifiers it cannot prove ownership of', () => {
    const same = oni.scrubUnownedIdentifiers({ provider: ACCOUNT.name + ', ' + ACCOUNT.cred, providerNpi: ACCOUNT.npi });
    assert.strictEqual(same.providerNpi, ACCOUNT.npi, 'the configured provider lost their own NPI');
    const other = oni.scrubUnownedIdentifiers({ provider: SURGEON, providerNpi: ACCOUNT.npi });
    assert.strictEqual(other.providerNpi, undefined,
      'a note naming a different operating provider kept the signed-in account holder\'s NPI');
    const scheduled = oni.scrubUnownedIdentifiers({ provider: SURGEON, providerNpi: '1987654320', providerNpiSource: 'appointment' });
    assert.strictEqual(scheduled.providerNpi, '1987654320',
      'an NPI the SCHEDULE supplied for its own provider was discarded');
  });
  t('an NPI blank is not auto-filled for a colleague\'s case', () => {
    const own = { patientId: '', appt: {} };
    assert.strictEqual(fill._knownValue('Provider NPI', own), ACCOUNT.npi,
      'CONTROL: the account holder\'s own NPI stopped filling their own note');
    const colleague = { patientId: '', appt: { name: 'Sample Patient', providerName: SURGEON } };
    assert.strictEqual(fill._knownValue('Provider NPI', colleague), '',
      'an NPI blank on a colleague\'s case was filled with the signed-in account holder\'s NPI');
    assert.strictEqual(fill._knownValue('NPI', colleague), '',
      'the bare NPI label took the signed-in account holder\'s NPI on a colleague\'s case');
  });
  t('CONTROL an NPI field never takes a provider NAME', () => {
    const noNpi = opNoteContext(Object.assign({}, settings, { getNpi: () => '' }));
    assert.strictEqual(noNpi.__mlsOpNoteFill._knownValue('Provider NPI', { patientId: '', appt: {} }), '',
      'with no NPI configured an NPI blank took something else');
  });
}

/* =======================================================================
 * 3. A HEADER SHEET DOES NOT WIN ON A DUPLICATED NAME
 * ===================================================================== */
const DUP_NAME = 'Left sacroiliac joint injection';
function fullTemplate(extra) {
  return [
    'OPERATIVE REPORT',
    'Preoperative Diagnosis: Left sacroiliac joint pain',
    'Postoperative Diagnosis: Left sacroiliac joint pain',
    'Type of Anesthesia: Local',
    'DESCRIPTION OF PROCEDURE:',
    'The patient was brought to the procedure suite and placed prone on the fluoroscopy table.',
    'The left sacroiliac region was prepped and draped in the usual sterile fashion.',
    'Under intermittent fluoroscopic guidance a spinal needle was advanced into the inferior third of the joint.',
    'Contrast was injected and an arthrogram pattern consistent with intra-articular placement was seen.',
    'The injectate was delivered into the joint without difficulty and the needle was withdrawn.',
    'Complications: None',
    'Conclusion: The procedure was completed without difficulty.' + (extra || '')
  ].join('\n');
}
const HEADER_SHEET = [
  'OPERATIVE REPORT',
  'Patient:',
  'Physician:',
  'Type of Anesthesia:',
  'Procedure: Left sacroiliac joint injection',
  'Preoperative Diagnosis:',
  'Postoperative Diagnosis:',
  'History:',
  'Medication:',
  'NDC:'
].join('\n');
const LIBRARY = [
  { id: 't-stub', name: DUP_NAME, text: HEADER_SHEET },
  { id: 't-full-1', name: DUP_NAME, text: fullTemplate('') },
  { id: 't-full-2', name: DUP_NAME, text: fullTemplate(' The patient was observed and discharged.') },
  { id: 't-full-3', name: DUP_NAME, text: fullTemplate(' The patient was observed and then discharged.') },
  { id: 't-full-4', name: DUP_NAME, text: fullTemplate(' The patient was observed and was then discharged.') }
];

{
  const ctx = opNoteContext({
    getTemplates: () => LIBRARY,
    getTemplateById: (id) => LIBRARY.filter((x) => x.id === id)[0] || null
  });
  const oni = ctx.__mlsOpNoteIntegrity;

  t('the drafter does not select the header sheet', () => {
    const m = oni.bestFor('Sample Patient', DUP_NAME, '01/02/1980', '');
    assert.notStrictEqual(m.tplId, 't-stub',
      'the drafter picked the header-sheet template, which has no description of the procedure in it');
    assert(m.tplId, 'the drafter picked nothing at all');
  });
  t('the header sheet ranks below every full sibling of the same name', () => {
    const r = oni.rank(DUP_NAME);
    assert.strictEqual(r[r.length - 1].tpl.id, 't-stub', 'the header sheet is not last: ' +
      JSON.stringify(r.map((e) => e.tpl.id + '=' + e.score)));
    assert(r[0].score > r[r.length - 1].score, 'the header sheet still ties with the full templates');
  });
  t('nothing is deleted, hidden or edited', () => {
    assert.strictEqual(LIBRARY.length, 5, 'a template was removed from the library');
    const ids = oni.rank(DUP_NAME).map((e) => e.tpl.id);
    assert(ids.indexOf('t-stub') >= 0, 'the header sheet was dropped from the ranking instead of demoted');
    assert.strictEqual(LIBRARY[0].text, HEADER_SHEET, 'a template\'s text was rewritten');
  });
  t('CONTROL a library of header sheets only is left alone', () => {
    const only = [
      { id: 'h-1', name: DUP_NAME, text: HEADER_SHEET },
      { id: 'h-2', name: DUP_NAME, text: HEADER_SHEET + '\nNDC 2:' }
    ];
    const c2 = opNoteContext({ getTemplates: () => only, getTemplateById: (id) => only.filter((x) => x.id === id)[0] || null });
    const scores = c2.__mlsOpNoteIntegrity.rank(DUP_NAME).map((e) => e.score);
    assert.strictEqual(scores[0], scores[1],
      'with no full sibling to compare against, a header sheet was demoted anyway');
  });
}

/* the two doctor-facing pickers must tell same-named entries apart */
{
  let label;
  if (SHELL.indexOf('function _opTplPickerLabel(') < 0) {
    /* the pre-fix shell renders the bare name in both surfaces */
    label = (tpl) => String((tpl && tpl.name) || 'Template');
  } else {
    const lifted = baseContext({});
    lifted.__mlsOpNoteIntegrity = opNoteContext({}).__mlsOpNoteIntegrity;
    lifted.window = lifted;
    vm.createContext(lifted);
    vm.runInContext(functionBlock(SHELL, '_opTplDupNames') + '\n' + functionBlock(SHELL, '_opTplPickerLabel') +
      '\nthis.dup = _opTplDupNames; this.label = _opTplPickerLabel;', lifted);
    const dup = lifted.dup(LIBRARY);
    label = (tpl) => lifted.label(tpl, dup);
  }

  t('five identically-named templates are five distinguishable entries', () => {
    const labels = LIBRARY.map(label);
    const unique = labels.filter((v, i) => labels.indexOf(v) === i);
    assert.strictEqual(unique.length, LIBRARY.length,
      'the picker offers indistinguishable entries for the same name: ' + JSON.stringify(labels));
  });
  t('the picker says which entry is the header sheet', () => {
    assert(/header only/.test(label(LIBRARY[0])),
      'the header sheet is not identified as one: ' + JSON.stringify(label(LIBRARY[0])));
    assert(/full note/.test(label(LIBRARY[1])),
      'a full operative template is not identified as one: ' + JSON.stringify(label(LIBRARY[1])));
  });
  t('a name that is NOT duplicated is still printed plainly', () => {
    if (SHELL.indexOf('function _opTplPickerLabel(') < 0) throw new Error('the shell has no picker label helper at all');
    assert.strictEqual(label({ id: 'solo', name: 'Caudal epidural steroid injection', text: fullTemplate('') }),
      'Caudal epidural steroid injection', 'an ordinary template name gained clutter');
  });
  t('both doctor-facing pickers render through that helper', () => {
    assert(/_optTail=_tplsNow\.map\(function\(t\)\{ return '>'\+esc\(_opTplPickerLabel\(t,_optDup\)\)/.test(SHELL),
      'the row Template dropdown no longer distinguishes duplicated names');
    assert(/var altLabel=altTpl\?_opTplPickerLabel\(altTpl,_altDup\)/.test(SHELL),
      'the "did you mean" alternative buttons no longer distinguish duplicated names');
  });
}

/* =======================================================================
 * 4. THE SCHEDULER'S BILLING NOTE IS NOT A PROCEDURE
 * ===================================================================== */
{
  const ctx = opNoteContext({});
  const oni = ctx.__mlsOpNoteIntegrity;
  const CASES = [
    ['L SIJ injection P; AUTH# 294962974', 'L SIJ injection'],
    ['R SIJ Injection/Bobby P; PER AIM PORTAL NO AUTH RE', 'R SIJ Injection'],
    ['L SIJ injection P; NO AUTH REQ. REF# D63303993', 'L SIJ injection'],
    ['L SIJ injection P; NO AVAILITY', 'L SIJ injection'],
    ['B/L L3, L4 & L5 MBB; AUTHORIZATION# 44881; NO AUTH REQ', 'B/L L3, L4 & L5 MBB']
  ];
  for (const [scheduled, want] of CASES) {
    t('the note prints ' + JSON.stringify(want) + ' for ' + JSON.stringify(scheduled), () => {
      assert.strictEqual(oni.procTitleForNote(scheduled), want,
        'the note printed ' + JSON.stringify(oni.procTitleForNote(scheduled)));
    });
  }
  t('no clinical word is lost from any of them', () => {
    const fields = (s) => {
      const f = oni.parseProcedureFacts(s);
      return { procedureType: f.procedureType, region: f.region, side: f.side, levels: f.levels.join('/'), levelCount: f.levelCount, approach: f.approach };
    };
    for (const [scheduled] of CASES) {
      assert.deepStrictEqual(fields(oni.procTitleForNote(scheduled)), fields(scheduled),
        'the clean changed the clinical identity of ' + JSON.stringify(scheduled));
    }
    assert(/SIJ/.test(oni.procTitleForNote(CASES[0][0])), 'the joint was stripped');
    assert(/^L /.test(oni.procTitleForNote(CASES[0][0])), 'the laterality was stripped');
    assert(/L3, L4 & L5/.test(oni.procTitleForNote(CASES[4][0])), 'the levels were stripped');
  });
  t('a slash that carries clinical words is left alone', () => {
    assert.strictEqual(oni.procTitleForNote('Left/Right knee injection'), 'Left/Right knee injection',
      'the staff-nickname rule ate a laterality');
    assert.strictEqual(oni.procTitleForNote('B/L L4-L5 TFESI'), 'B/L L4-L5 TFESI',
      'the staff-nickname rule ate a bilateral marker');
  });
  t('the row keeps the raw scheduled reason', () => {
    const raw = CASES[0][0];
    const row = ctx._opNewRow('Sample Patient', raw, '01/02/1980', 'Monday', 'p-1');
    assert.strictEqual(row.proc, raw, 'the row\'s own procedure text was cleaned; matching, the editable ' +
      'field, the preview and draft-resume all read it and all need the string the schedule actually carries');
    assert.strictEqual(row.appt.reason, raw, 'the appointment\'s raw reason was rewritten');
  });
}

/* ---- report ------------------------------------------------------------ */
const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log('FAIL  ' + r.name + '\n      ' + String(r.why).split('\n').join('\n      '));
if (failed.length) {
  console.log('\n' + failed.length + ' of ' + results.length + ' assertions failed (root: ' + ROOT + ')');
  process.exit(1);
}
console.log('PASS the saved note body is the note: no provider/facility scaffolding, no [[placeholder]], no draft ' +
  'disclaimer and no positional [FILL: after "..." before "..."] marker survives into it; an NPI is printed only ' +
  'beside the provider it belongs to and no NPI line at all otherwise, on both branches; five identically-named ' +
  'templates put the header sheet last instead of first and the two pickers tell all five apart; and the front ' +
  'desk\'s AUTH#/REF#/NO AUTH REQ/PER-payer/trailing-" P"/staff-nickname residue is cleaned out of what the note ' +
  'prints while the row keeps the raw scheduled reason (' + results.length + ' assertions)');

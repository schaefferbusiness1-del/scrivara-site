'use strict';

/*
 * The display note and the Athena write payload are intentionally different
 * contracts.  This focused seam proves both canonical 1p shells preserve an
 * alternate display style, carry `athena_note` through hosted/direct-key
 * transports, reject malformed sidecars, and refuse stale provenance at the
 * five-destination staging boundary.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function marker: ' + marker);
  const open = source.indexOf('{', start);
  assert(open > start, 'missing function body: ' + marker);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) { if (escaped) { escaped = false; continue; } if (ch === '\\') { escaped = true; continue; } if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unbalanced function: ' + marker);
}

function canonicalBlock(source, file) {
  const start = source.indexOf('function _mlsAthenaNoteQualityError(');
  const end = source.indexOf('\n\n/* =========================================================\n   GENERATE NOTE', start);
  ok(start >= 0 && end > start, file + ': missing canonical Athena contract block');
  return source.slice(start, end);
}

function loadCanonical(source, file) {
  const sandbox = {};
  vm.runInNewContext(canonicalBlock(source, file) +
    '\nthis.__canonical={validate:_mlsValidateAthenaNote,quality:_mlsAthenaNoteQualityError};', sandbox, { filename: file });
  return sandbox.__canonical;
}

function loadParser(source, file) {
  const sandbox = { emrText: value => value == null ? '—' : String(value) };
  vm.runInNewContext(extractFunction(source, 'function parseGenJSON(content)') +
    '\nthis.__parse=parseGenJSON;', sandbox, { filename: file });
  return sandbox.__parse;
}

const canonicalText = [
  'HPI:', 'Pain is improving after the injection.',
  '', 'ROS:', 'Denies weakness or bowel/bladder changes.',
  '', 'EXAM:', 'Strength is five out of five bilaterally.',
  '', 'ASSESSMENT:', 'Lumbar radicular pain, improving.',
  '', 'PLAN:', 'Continue home exercise and follow up in four weeks.'
].join('\n');
const narrativeDisplay = 'The patient reports improving pain after the injection. Exam is reassuring. Continue the current plan and follow up in four weeks.';

async function transportProbe(source, file, hosted, style) {
  const calls = [];
  const tuningCalls = [];
  const payload = JSON.stringify({ note: narrativeDisplay, athena_note: canonicalText });
  const selectedTuning = { families: {} };
  for (const section of ['hpi', 'ros', 'exam', 'assessment', 'plan']) {
    selectedTuning.families[section] = { profileId: section + '-' + style };
  }
  const sandbox = {
    window: { __mlsDraftTuning: {
      installed: true,
      forStructured: override => { tuningCalls.push({ route: 'structured', override }); return { marker: 'nested-applied', families: override.families }; },
      forFamily: (family, override) => { tuningCalls.push({ route: 'family:' + family, override }); return { marker: 'wrong-family' }; },
      promptBlock: family => '\nTUNING-FAMILY:' + family
    } },
    backendMode: () => hosted,
    bkBase: () => '/backend',
    bkToken: () => 'session-token',
    hostedNotePreferences: () => ({ style: 'narrative', patientSummary: true }),
    getNoteModel: () => 'test-model',
    getGenPatientSummary: () => true,
    handle401: () => {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        status: 200,
        ok: true,
        json: async () => url.endsWith('/api/complete')
          ? { content: 'referral draft' }
          : (hosted ? { result: payload } : { choices: [{ message: { content: payload } }] })
      };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(source, 'async function aiCallRaw(sys,user,key,opts)') + '\nthis.__call=aiCallRaw;', sandbox, { filename: file });
  const raw = await sandbox.__call('SYSTEM', 'TRANSCRIPT', 'direct-key', { noteFormat: style, draftTuning: selectedTuning });
  const label = file + ': ' + style + ' ' + (hosted ? 'hosted' : 'direct');
  eq(JSON.parse(raw).athena_note, canonicalText, label + ' transport dropped athena_note');
  eq(calls.length, 1, label + ' probe made an unexpected number of calls');
  eq(tuningCalls.length, 1, label + ' did not resolve one tuning payload');
  eq(tuningCalls[0].route, 'structured', label + ' silently routed visible section profiles through a non-structured family');
  for (const section of ['hpi', 'ros', 'exam', 'assessment', 'plan']) {
    eq(tuningCalls[0].override.families[section].profileId, section + '-' + style, label + ' dropped the selected ' + section + ' profile');
  }
  if (hosted) {
    eq(calls[0].url, '/backend/api/generate', label + ' transport did not use /api/generate');
    const body = JSON.parse(calls[0].options.body);
    eq(body.transcript, 'TRANSCRIPT', label + ' payload did not carry the transcript');
    eq(body.notePreferences.patientSummary, true, label + ' preference payload did not carry the bounded patient-summary choice');
    eq(Object.prototype.hasOwnProperty.call(body, 'patientSummary'), false, label + ' patient-summary choice escaped the backend-sanitized preference object');
    eq(body.draftFamily, 'soap', label + ' changed the structured family because of display style');
    eq(body.draftTuning.marker, 'nested-applied', label + ' did not serialize the nested section tuning payload');
  } else {
    eq(calls[0].url, 'https://api.openai.com/v1/chat/completions', label + ' transport did not use OpenAI');
    const body = JSON.parse(calls[0].options.body);
    ok(body.messages[0].content.includes('TUNING-FAMILY:soap'), label + ' direct system prompt did not receive structured section tuning');
  }
  if (hosted && style === 'soap') {
    const freeform = await sandbox.__call('REFERRAL SYSTEM', 'REFERRAL SOURCE', 'direct-key', { freeform: true, family: 'referral', draftTuning: { instructions: 'Use the saved referral layout.' } });
    eq(freeform, 'referral draft', file + ': freeform control did not return the helper draft');
    eq(calls.length, 2, file + ': freeform control made an unexpected number of requests');
    eq(calls[1].url, '/backend/api/complete', file + ': freeform control was incorrectly forced through structured generation');
    eq(tuningCalls[1].route, 'family:referral', file + ': freeform referral lost its own tuning family');
  }
}

function runPlan(source, file, setup) {
  const values = { transcript: 'visit transcript', contextBox: '', patientLabel: 'Test Patient', noteBox: narrativeDisplay };
  const sandbox = {
    window: { __mlsWriteFlow: { parseGeneratedSoapSections: () => ({ ok: false, sections: [] }) } },
    __values: values,
    document: { getElementById: id => ({ get value() { return values[id] || ''; }, set value(value) { values[id] = value; } }) },
    currentAthenaNote: canonicalText,
    currentAthenaNoteProvenance: 'generated',
    currentAthenaNoteSourceFingerprint: '',
    currentVisitAthenaBinding: { patient: { name: 'Test Patient', patientId: 'p-1', dob: '1980-01-01' }, visitContext: {} },
    currentFormat: 'narrative',
    currentSoap: narrativeDisplay,
    currentInsurance: '',
    currentCoding: null,
    currentOrders: [],
    aiSuggestedOrders: [],
    currentNoteProvenance: 'generated_nonsoap',
    ATHENA_SECTIONS: { note: { icon: 'N', dest: 'generic note' }, dx: { icon: 'D', dest: 'diagnoses' }, billing: { icon: 'B', dest: 'billing' }, orders: { icon: 'O', dest: 'orders' } },
    emrReadyText: () => narrativeDisplay,
    _athenaCanonicalBilling: () => ({}),
    _athenaOrderReviewBundle: () => ({ drafts: [], suggestions: [] })
  };
  vm.createContext(sandbox);
  const block = canonicalBlock(source, file) + '\n' + extractFunction(source, 'function _athenaBuildPlan(binding)');
  vm.runInContext(block + '\n' + (setup || '') + '\nthis.__plan=_athenaBuildPlan({patient:{name:"Test Patient"}});', sandbox, { filename: file });
  return sandbox.__plan;
}

(async () => {
  const sources = shells.map(file => [file, read(file)]);
  const firstCanonical = canonicalBlock(sources[0][1], sources[0][0]);
  for (const [file, source] of sources) {
    eq(canonicalBlock(source, file), firstCanonical, file + ': canonical Athena contract drifted from the canonical 1p lane');
    ok(source.includes('"athena_note": "<the SAME visit as plain text in EXACTLY five flat top-level sections'), file + ': generation prompt does not require athena_note');
    const displayValidation = source.indexOf('_mlsValidateStructuredNoteResult(result);');
    const athenaValidation = source.indexOf('_mlsValidateAthenaNote(result.athena_note==null?result.note:result.athena_note);', displayValidation);
    ok(athenaValidation > displayValidation, file + ': athena_note fallback was not validated after the display note contract');
    ok(source.includes('result.athena_note==null?result.note:result.athena_note'), file + ': present athena_note was not preferred over the legacy display-note fallback');
    const canonicalCapture = source.indexOf("_mlsSetAthenaNote(canonicalAthenaNote.text,'generated');", source.indexOf('const canonicalAthenaNote='));
    ok(canonicalCapture > source.indexOf('const canonicalAthenaNote='), file + ': canonical sidecar is not captured after validation');
    const settledComment = source.lastIndexOf('applyVisitCommentToNote();', canonicalCapture);
    ok(settledComment > source.indexOf('const canonicalAthenaNote=') && settledComment < canonicalCapture, file + ': canonical sidecar was captured before deterministic display/comment mutations settled');
    ok(source.includes('athena_note:Object.prototype.hasOwnProperty.call(obj,\'athena_note\')?obj.athena_note:undefined'), file + ': parseGenJSON does not preserve the exact athena_note property');

    const parse = loadParser(source, file);
    const parsed = parse(JSON.stringify({ note: narrativeDisplay, athena_note: canonicalText }));
    eq(parsed.note, narrativeDisplay, file + ': alternate display note was not preserved');
    eq(parsed.athena_note, canonicalText, file + ': canonical sidecar did not survive response parsing');
    const canonical = loadCanonical(source, file);
    const valid = canonical.validate(parsed.athena_note);
    eq(valid.sections.map(section => section.key).join(','), 'hpi,ros,exam,assessment,plan', file + ': valid canonical sidecar did not produce five exact sections');
    const insufficient = ['HPI:','Not documented in today\'s transcript.','','ROS:','Not documented in today\'s transcript.','','EXAM:','Not documented in today\'s transcript.','','ASSESSMENT:','Not documented in today\'s transcript.','','PLAN:','Not documented in today\'s transcript.'].join('\n');
    eq(canonical.validate(insufficient).sections.length, 5, file + ': honest documented-insufficiency bodies were rejected and would pressure the model to invent content');

    for (const bad of [undefined, '', 'SUBJECTIVE:\nHPI: old\nOBJECTIVE:\nEXAM: old\nASSESSMENT:\nold\nPLAN:\nold', 'HPI:\nold\nHPI:\nduplicate\nROS:\nold\nEXAM:\nold\nASSESSMENT:\nold\nPLAN:\nold', 'ROS:\nold\nHPI:\nold\nEXAM:\nold\nASSESSMENT:\nold\nPLAN:\nold', 'HPI:\nold\nROS:\nold\nEXAM:\nold\nASSESSMENT & PLAN:\nold', 'HPI:\nPatient is fine.\nROS:\nstable\nEXAM:\nnormal\nASSESSMENT:\nunchanged\nPLAN:\ncontinue']) {
      let error = null;
      try { canonical.validate(bad); } catch (caught) { error = caught; }
      ok(error, file + ': malformed canonical sidecar was accepted');
      eq(error.mlsAthenaNoteQuality, true, file + ': malformed canonical sidecar lacked its fail-closed marker');
      eq(error.mlsAi.code, 'athena_note_quality_failed', file + ': malformed canonical sidecar lacked retryable error code');
    }
    let existing = 'clinician draft';
    try { const result = canonical.validate('HPI:\nold'); existing = result.text; } catch (error) {}
    eq(existing, 'clinician draft', file + ': malformed canonical sidecar mutated an existing display draft');

    const validPlan = runPlan(source, file, 'currentAthenaNoteSourceFingerprint=_mlsAthenaSourceFingerprint();');
    eq(validPlan.plan.map(row => row.kind).join(','), 'hpi,ros,exam,assessment,plan', file + ': alternate display style did not stage canonical five destinations');
    ok(validPlan.plan.every(row => row.generatedCanonical === true), file + ': canonical rows were not marked as the canonical write payload');

    const stalePlan = runPlan(source, file, 'currentAthenaNoteSourceFingerprint=_mlsAthenaSourceFingerprint();__values.transcript="changed after generation";');
    eq(stalePlan.blocked, true, file + ': changed visit source silently reused an old canonical payload');
    eq(stalePlan.plan.length, 0, file + ': stale canonical payload retained executable Athena rows');

    const malformedPlan = runPlan(source, file, 'currentAthenaNote="HPI:\\nonly one section";currentAthenaNoteSourceFingerprint=_mlsAthenaSourceFingerprint();');
    eq(malformedPlan.blocked, true, file + ': malformed canonical payload was not blocked at staging');

    for (const style of ['soap', 'apso', 'narrative', 'problem', 'hp']) {
      await transportProbe(source, file, true, style);
      await transportProbe(source, file, false, style);
    }
  }
  console.log('PASS athena-dual-note-contract: ' + checks + ' checks — hosted/direct alternate display notes retain exact athena_note sidecars, malformed payloads fail closed, and stale canonical writes are blocked');
})().catch(error => { console.error(error); process.exitCode = 1; });

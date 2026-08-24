'use strict';

/* Every release shell must request and retain the exact flat SOAP contract
 * used by the optional five-field Athena staging lane. Non-SOAP styles remain
 * honest free-form drafts and are never silently rewritten into SOAP. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html', 'ScribeFlow-staging.html'];
const formatNeutralClinicalContent = '- CLINICAL CONTENT: Include only transcript-supported chief complaint/HPI, pertinent ROS, PMH/PSH/FH/SH, medications/allergies, vitals, focused exam/results, numbered assessment, and plan. The selected FORMAT instruction below exclusively controls top-level section names and order; do not add SOAP wrapper headings unless that selected format explicitly requests them.';
function read(name) { return fs.readFileSync(path.join(root, name), 'utf8'); }
function extract(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'missing ' + signature);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i += 1; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i += 1; continue; }
    if (ch === '/' && next === '*') { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated ' + signature);
}

const wrapper = 'SUBJECTIVE:\nHPI: cough for three days.\nROS: denies dyspnea.\nOBJECTIVE:\nExam: lungs clear.\nASSESSMENT:\nAcute cough.\nPLAN:\nSupportive care.';
const flat = 'HPI:\ncough for three days.\n\nROS:\ndenies dyspnea.\n\nEXAM:\nlungs clear.\n\nASSESSMENT:\nAcute cough.\n\nPLAN:\nSupportive care.';
const malformed = 'SUBJECTIVE:\nHPI: cough.\nOBJECTIVE:\nExam: clear.\nASSESSMENT:\nAcute cough.\nPLAN:\nSupportive care.';
const apso = 'ASSESSMENT:\nAcute cough.\nPLAN:\nSupportive care.\nSUBJECTIVE:\nHPI: cough.\nROS: negative.\nOBJECTIVE:\nEXAM: clear.';

for (const name of shells) {
  const source = read(name);
  assert(source.includes("out.noteFormat=style==='soap'?'flat_hpi_ros_exam_assessment_plan_v1':style"), name + ' does not carry the hosted flat-format contract');
  assert(source.includes("draftFamily:_draftFamily||'soap'") || source.includes('draftFamily:draftFamily'), name + ' does not preserve structured section tuning independently of display style');
  assert(source.includes('FORMAT THE NOTE AS STANDARD SOAP using EXACTLY five flat top-level sections'), name + ' direct prompt does not require exact flat SOAP');
  assert(source.includes(formatNeutralClinicalContent), name + ' common clinical standards are not format-neutral');
  assert(!source.includes('- SOAP structure: SUBJECTIVE ('), name + ' retains a contradictory nested SOAP instruction');
  const helper = extract(source, 'function _flatSoapNote(note)');
  const reorder = extract(source, 'function _reorderNoteForStyle(note, style)');
  const hosted = extract(source, 'function hostedNotePreferences()');
  const sandbox = {
    String, Array, Object, RegExp, JSON,
    getGenStyle: () => 'soap', getMlsNoteStyle: () => 'balanced', getQolFollowup: () => '', getDocPrefs: () => [],
    window: { __mlsCodeTable: null }
  };
  vm.runInNewContext(helper + '\n' + reorder + '\n' + hosted + '\nthis.out={flat:_flatSoapNote(' + JSON.stringify(wrapper) + '), malformed:_reorderNoteForStyle(' + JSON.stringify(malformed) + ',\'soap\'), apso:_reorderNoteForStyle(' + JSON.stringify(apso) + ',\'apso\'), apsoFlat:_reorderNoteForStyle(' + JSON.stringify(flat) + ',\'apso\'), narrative:_reorderNoteForStyle(' + JSON.stringify(wrapper) + ',\'narrative\'), prefs:hostedNotePreferences()};', sandbox);
  assert.strictEqual(sandbox.out.flat, flat, name + ' did not canonicalize shipped nested SOAP to exact flat headings');
  assert.strictEqual(sandbox.out.malformed, malformed, name + ' rewrote incomplete SOAP instead of failing closed');
  assert.strictEqual(sandbox.out.narrative, wrapper, name + ' rewrote a narrative choice into SOAP');
  assert(sandbox.out.apso.startsWith('ASSESSMENT:'), name + ' lost APSO ordering');
  assert(sandbox.out.apsoFlat.startsWith('ASSESSMENT:'), name + ' did not reorder flat SOAP into APSO when selected');
  assert.strictEqual(sandbox.out.prefs.noteFormat, 'flat_hpi_ros_exam_assessment_plan_v1', name + ' did not advertise flat SOAP format');
}

console.log('PASS structured note flat staging: all five release shells request exact flat SOAP, canonicalize only complete shipped SOAP, preserve APSO/narrative choices, and fail closed on incomplete output');

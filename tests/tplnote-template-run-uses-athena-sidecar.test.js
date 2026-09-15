'use strict';
/* tplnote-1.0.0 (2026-09-15) - A TEMPLATED VISIT NOTE IS JUDGED ON ITS SIDECAR.
 *
 * Measured 2026-09-01 (tests/visit-template-scope-proof.js header): with a
 * TEMPLATE_CONTRACT in the payload the backend refused nine generations in a
 * row, because the flat SOAP family demanded exact HPI/ROS/EXAM/ASSESSMENT/PLAN
 * for the very "note" field the contract governs - and the shell's own
 * _mlsValidateStructuredNoteResult ran the same five-field check on the same
 * field, so the app would have refused what the backend allowed.
 *
 * Now: a run that attached a template (window.__mlsLastGenTemplateContract
 * carries an id) tells the backend noteFormat "template", is handled like a
 * reviewed non-SOAP style, and validates the exact five fields on the
 * athena_note sidecar. This executes the shell's validator sliced out of BOTH
 * twins and pins the wiring strings. Synthetic text only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let checks = 0;
function ok(c, m) { checks++; assert.ok(c, m); }
function slice(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker); assert(s > 0, 'missing ' + startMarker.slice(0, 50));
  const e = src.indexOf(endMarker, s); assert(e > s, 'missing end for ' + startMarker.slice(0, 50));
  return src.slice(s, e + endMarker.length);
}

for (const file of ['1pScribeFlow.html', '1p/index.html']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  /* wiring pins */
  ok(src.includes("notePreferences:(opts.templateAttached?Object.assign({},hostedNotePreferences()||{},{noteFormat:'template'}):hostedNotePreferences())"), file + ': /api/generate sends noteFormat template when a contract rode the run');
  ok(src.includes('specialty:spec,templateAttached:!!tplContract,signal:options.signal})'), file + ': callOpenAI hands the template flag to the transport');
  ok(src.includes("const effectiveGenStyle=generationTemplateRun?'template':generationStyle;"), file + ': a template run is handled as its own style');
  ok(src.includes('_mlsValidateStructuredNoteResult(result,generationDraftTuning,generationTemplateRun);'), file + ': the validator is told about the template run');
  ok(src.includes("canonicalAthenaNoteOrNull=effectiveGenStyle==='soap'?_mlsAthenaCanonicalFromStandardNote(result.note):_mlsValidateAthenaNote("), file + ': the canonical athena note comes from the sidecar on a template run');
  ok(src.includes('currentSoap=_reorderNoteForStyle(result.note, effectiveGenStyle);'), file + ': the display note is not folded into flat SOAP on a template run');
  ok(src.includes("currentNoteProvenance=effectiveGenStyle==='soap'?'generated_soap':'generated_nonsoap';"), file + ': provenance follows the effective style');
  ok(src.includes("_mlsSetAthenaNote(effectiveGenStyle==='soap'?_mlsAthenaCanonicalFromStandardNote(currentSoap).text:canonicalAthenaNote.text,'generated');"), file + ': the staged athena note follows the effective style');
  ok(!/generationStyle==='soap'\?_mlsAthenaCanonicalFromStandardNote/.test(src), file + ': no remaining style-keyed canonical door bypasses the template run');

  /* execute the validator */
  const validator = slice(src, 'function _mlsValidateStructuredNoteResult(result,tuning,templateRun){', '\n}\n');
  const athenaValidator = slice(src, 'function _mlsValidateAthenaNote(text){', '\n}\n');
  const qualityErr = slice(src, 'function _mlsStructuredNoteQualityError(', '\n}\n');
  const athenaErr = slice(src, 'function _mlsAthenaNoteQualityError(reason){', '\n}\n');
  const substantive = slice(src, 'function _mlsAthenaBodyIsSubstantive(body){', '\n}\n');
  const ctx = { console, Date, Math, JSON, Object, String, Number, Array, RegExp, Error };
  ctx.window = ctx;
  ctx._mlsValidateActiveTemplateStructure = function () { ctx.__structureCalls = (ctx.__structureCalls || 0) + 1; };
  vm.runInNewContext([qualityErr, athenaErr, substantive, athenaValidator, validator].join('\n'), ctx, { filename: file });
  const five = ['HPI:', 'Back pain, worse on the left, for three weeks.', 'ROS:', 'Denies numbness, tingling or weakness.', 'EXAM:', 'Tender left lumbar paraspinals; strength 5/5.', 'ASSESSMENT:', '1. Lumbar back pain, left.', 'PLAN:', '- Continue current regimen.', '- Return in 4 weeks.'].join('\n');
  const templated = ['PAIN CLINIC FOLLOW-UP', 'Reason for today: back pain, worse on the left.', 'Findings: tender left lumbar paraspinals.', 'Decision: continue current regimen; return 4 weeks.'].join('\n');
  /* a template run with a good sidecar passes */
  let out = null, err = null;
  try { out = ctx._mlsValidateStructuredNoteResult({ note: templated, athena_note: five }, null, true); } catch (e) { err = e; }
  ok(!err && out && out.note === templated, file + ': a filled template with an exact sidecar passes: ' + (err && err.mlsAi && err.mlsAi.detail));
  ok(ctx.__structureCalls === 1, file + ': the active section-template structure check still runs on the canonical copy');
  /* the same note without the template flag is refused, as before */
  err = null; try { ctx._mlsValidateStructuredNoteResult({ note: templated, athena_note: five }, null, false); } catch (e) { err = e; }
  ok(err && err.mlsAi, file + ': without the template flag the five-field rule still refuses a template-shaped note');
  /* a template run with a missing sidecar fails closed */
  err = null; try { ctx._mlsValidateStructuredNoteResult({ note: templated }, null, true); } catch (e) { err = e; }
  ok(err && /athena|five-field/i.test(String(err.mlsAi && err.mlsAi.detail)), file + ': a template run without a sidecar is refused: ' + (err && err.mlsAi && err.mlsAi.detail));
  /* an echoed contract is refused */
  err = null; try { ctx._mlsValidateStructuredNoteResult({ note: 'TEMPLATE_CONTRACT_BEGIN\n' + templated, athena_note: five }, null, true); } catch (e) { err = e; }
  ok(err && /echoed/i.test(String(err.mlsAi && err.mlsAi.detail)), file + ': a note that echoes the contract markers is refused');
  /* the plain SOAP path is unchanged */
  err = null; try { out = ctx._mlsValidateStructuredNoteResult({ note: five }, null, false); } catch (e) { err = e; }
  ok(!err && out && out.note === five, file + ': a flat SOAP note still validates on the old path');
}
console.log('PASS tplnote template run uses the athena sidecar: a templated visit note is displayed as the template, validated on its exact five-field sidecar, and told to the backend as noteFormat template, in both twins (' + checks + ' checks)');

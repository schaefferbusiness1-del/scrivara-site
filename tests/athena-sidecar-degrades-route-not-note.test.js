'use strict';

/* The clinician-reviewed fixed five-field display is the canonical Athena
 * payload. A malformed or different model sidecar cannot overrule it; a
 * malformed display still leaves the note visible while the Athena route is
 * pinned stale. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }

function span(source, startMarker, endMarker, file) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, file + ': missing ' + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, file + ': missing ' + endMarker);
  return source.slice(start, end + endMarker.length);
}

const validDisplay = [
  'HPI:', 'Synthetic pain began three weeks ago.',
  '', 'ROS:', 'Patient denies fever or new weakness.',
  '', 'EXAM:', 'Synthetic examination shows focal tenderness.',
  '', 'ASSESSMENT:', 'Synthetic mechanical pain under evaluation.',
  '', 'PLAN:', 'Continue documented exercise and follow up.'
].join('\n');
const malformedDisplay = validDisplay.replace('\n\nEXAM:', '\n\nSUBJECTIVE:\nUnsupported wrapper.\n\nEXAM:');
const malformedSidecar = validDisplay.replace('ROS:\nPatient denies fever or new weakness.', 'ROS:\nNegative.');

let firstRegion = null;
for (const file of shells) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const displayValidation = source.indexOf('_mlsValidateStructuredNoteResult(result,generationDraftTuning);');
  const canonicalValidation = source.indexOf("generationStyle==='soap'?_mlsAthenaCanonicalFromStandardNote(result.note):_mlsValidateAthenaNote(", displayValidation);
  ok(displayValidation > 0, file + ': display-note contract validation is gone');
  ok(canonicalValidation > displayValidation, file + ': reviewed display is not validated for canonical routing');

  const guarded = span(source, 'let canonicalAthenaNoteOrNull=null,athenaSidecarReason=', 'const canonicalAthenaNote=canonicalAthenaNoteOrNull;', file);
  ok(guarded.includes("generationStyle==='soap'?_mlsAthenaCanonicalFromStandardNote(result.note)"),
    file + ': fixed SOAP generation still prefers the separate model sidecar');
  ok(/catch\(eAthenaSidecar\)\{[^}]*athenaSidecarReason=/.test(guarded), file + ': invalid displayed canonical text no longer records a refusal reason');
  ok(!/\bthrow\b/.test(guarded), file + ': canonical validation still destroys an otherwise retained display note');

  const branch = span(source, 'if(canonicalAthenaNote){', 'try{_mlsAthenaClearReopenAnchor();}catch(eStaleAnchor){}', file);
  ok(branch.includes("_mlsSetAthenaNote(generationStyle==='soap'?_mlsAthenaCanonicalFromStandardNote(currentSoap).text:canonicalAthenaNote.text,'generated');"),
    file + ': final post-mutation displayed SOAP is not the bound canonical payload');
  ok(branch.includes("currentAthenaNoteProvenance='stale'"), file + ': malformed displayed SOAP no longer pins the Athena route stale');

  const canonicalStart = source.indexOf('function _mlsAthenaNoteQualityError(reason)');
  const canonicalEnd = source.indexOf('\nfunction _mlsAthenaSourceState(', canonicalStart);
  assert(canonicalStart >= 0 && canonicalEnd > canonicalStart, file + ': canonical validator block missing');
  const sandbox = { stripSignatureBlock: text => String(text), _autoDraftStripCarried: text => String(text) };
  vm.runInNewContext(source.slice(canonicalStart, canonicalEnd) +
    '\nthis.validate=_mlsValidateAthenaNote;this.fromDisplay=_mlsAthenaCanonicalFromStandardNote;', sandbox, { filename: file });
  eq(sandbox.fromDisplay(validDisplay).text, validDisplay, file + ': valid reviewed display was refused');
  let badDisplay = null;
  try { sandbox.fromDisplay(malformedDisplay); } catch (error) { badDisplay = error; }
  ok(badDisplay && badDisplay.mlsAi && badDisplay.mlsAi.code === 'athena_note_quality_failed',
    file + ': malformed displayed SOAP did not fail closed');
  let badSidecar = null;
  try { sandbox.validate(malformedSidecar); } catch (error) { badSidecar = error; }
  ok(badSidecar && badSidecar.mlsAi && badSidecar.mlsAi.detail === 'non-substantive ros section',
    file + ': non-substantive canonical body was unexpectedly relaxed');

  /* Pin the decision itself: for SOAP, the conditional never evaluates its
     malformed right-hand sidecar branch. */
  const choose = vm.runInNewContext(
    '(function(style,result){return style===\'soap\'?fromDisplay(result.note):validate(result.athena_note);})',
    { fromDisplay: sandbox.fromDisplay, validate: sandbox.validate }
  );
  eq(choose('soap', { note: validDisplay, athena_note: malformedSidecar }).text, validDisplay,
    file + ': malformed separate sidecar overruled a valid displayed SOAP note');
  assert.throws(() => choose('soap', { note: malformedDisplay, athena_note: validDisplay }),
    file + ': valid separate sidecar rescued a malformed displayed SOAP note');
  checks += 1;

  const region = span(source, '_mlsValidateStructuredNoteResult(result,generationDraftTuning);', "outcomeCode='generated';", file);
  if (firstRegion === null) firstRegion = region;
  else eq(region, firstRegion, file + ': generation settlement drifted across shipped shells');
}

console.log('PASS athena-sidecar-degrades-route-not-note: ' + checks + ' checks across ' + shells.length +
  ' shells — reviewed five-field display wins over a malformed model sidecar, malformed display still refuses the Athena route, and note generation remains retained');

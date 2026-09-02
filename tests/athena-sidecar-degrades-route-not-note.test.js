'use strict';

/* sidecar-1.0.0 (measured 2026-09-02 10:xx) -- A REFUSED athena_note SIDECAR
 * MUST DEGRADE THE ATHENA ROUTE, NEVER THE NOTE.
 *
 * `_mlsValidateAthenaNote` was called unguarded inside generateNote's outer
 * try. Any throw from it unwound the whole run to the catch, so a result whose
 * DISPLAY note had already passed `_mlsValidateStructuredNoteResult` was
 * discarded and never rendered: the doctor paid for a generation and got
 * nothing but "The AI returned an unusable Athena note payload."
 *
 * This is very reachable. `_mlsAthenaBodyIsSubstantive` returns false for the
 * bodies 'Negative.', 'Normal.', 'Stable.', 'None.', 'Unchanged.' and
 * 'No new complaints.', so an ordinary model answer of `ROS: Negative.` throws
 * 'non-substantive ros section'.
 *
 * The cure keeps every byte of the validator and makes the WRITE strictly no
 * weaker: the note renders, the Athena route is pinned 'stale', and the
 * refusal is said out loud in a line that does not fade.
 *
 * Three of the four assertions below are NEGATIVE CONTROLS, because the two
 * ways to "fix" this defect wrongly are (a) relaxing the validator and
 * (b) leaving the sidecar unset, which is NOT the same as refusing it.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function marker: ' + marker);
  const open = source.indexOf('{', start);
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

function slice(source, startMarker, endMarker, file) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, file + ': missing span start ' + startMarker.slice(0, 60));
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, file + ': missing span end ' + endMarker.slice(0, 60));
  return source.slice(start, end + endMarker.length);
}

/* The one expression the sidecar preference contract pins (autodraft-1.1.0). */
const FALLBACK_EXPR = "result.athena_note==null?(typeof _autoDraftStripCarried==='function'?_autoDraftStripCarried(result.note):result.note):result.athena_note";
/* A five-section note whose ROS body is a single non-substantive word. This is
   an ORDINARY model answer, not a malformed payload. */
const rosNegative = [
  'HPI:', 'Knee pain for three weeks, worse with stairs.',
  '', 'ROS:', 'Negative.',
  '', 'EXAM:', 'Right knee with medial joint line tenderness, no effusion.',
  '', 'ASSESSMENT:', 'Right knee medial compartment pain.',
  '', 'PLAN:', 'Home exercise program and follow up in four weeks.'
].join('\n');

const sources = shells.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]);

/* ---------------------------------------------------------------- (1) static
   The guard exists, does not rethrow, and the refusal pins 'stale'. */
let firstRegion = null;
for (const [file, source] of sources) {
  const displayValidation = source.indexOf('_mlsValidateStructuredNoteResult(result);');
  const athenaValidation = source.indexOf('_mlsValidateAthenaNote(' + FALLBACK_EXPR + ');', displayValidation);
  ok(displayValidation > 0, file + ': the display-note contract validation is gone');
  ok(athenaValidation > displayValidation, file + ': the sidecar is no longer validated after the display note');

  const guarded = slice(source, 'let canonicalAthenaNoteOrNull=null,athenaSidecarReason=', 'const canonicalAthenaNote=canonicalAthenaNoteOrNull;', file);
  ok(guarded.includes('try{ canonicalAthenaNoteOrNull=_mlsValidateAthenaNote('), file + ': the sidecar validation is no longer inside a try');
  ok(/catch\(eAthenaSidecar\)\{[^}]*athenaSidecarReason=/.test(guarded), file + ': the sidecar catch no longer records a reason');
  ok(!/\bthrow\b/.test(guarded), file + ': the sidecar catch rethrows, so a refused sidecar still destroys the note');
  ok(source.indexOf('const canonicalAthenaNote=') > 0, file + ': the pinned canonical binding token is gone');

  const branch = slice(source, "if(canonicalAthenaNote){", "try{_mlsAthenaClearReopenAnchor();}catch(eStaleAnchor){}", file);
  ok(branch.includes("_mlsSetAthenaNote(canonicalAthenaNote.text,'generated');"), file + ': the accepted sidecar is no longer bound');
  ok(branch.includes("currentAthenaNoteProvenance='stale'"), file + ": a refused sidecar no longer pins the Athena route 'stale'");
  ok(branch.includes('_mlsMarkAthenaNoteStale('), file + ': a refused sidecar no longer marks the canonical note stale');

  ok(source.includes("so Send to Athena is unavailable until you regenerate."), file + ': the doctor is no longer told the Athena route is unavailable');
  ok(source.includes("athenaSidecarReason?'':'ok'"), file + ': a refused sidecar still claims the plain success skin');

  /* The whole generate->settle region must be byte-identical across the four
     shells: two hand-applied twins plus two derived lanes. */
  const region = slice(source, '_mlsValidateStructuredNoteResult(result);', "outcomeCode='generated';", file);
  if (firstRegion === null) firstRegion = region;
  else eq(region, firstRegion, file + ': the generation settle region drifted from the canonical 1p lane');
}

/* -------------------------------------------------- (2) NEGATIVE CONTROL: the
   validator was NOT relaxed. If this ever passes, the fix became a weakening. */
for (const [file, source] of sources) {
  const canonicalStart = source.indexOf('function _mlsAthenaNoteQualityError(reason)');
  const canonicalEnd = source.indexOf('\nfunction _mlsAthenaSourceState(', canonicalStart);
  assert(canonicalStart >= 0 && canonicalEnd > canonicalStart, file + ': canonical validator block missing');
  const sandbox = {};
  vm.runInNewContext(source.slice(canonicalStart, canonicalEnd) + '\nthis.validate=_mlsValidateAthenaNote;', sandbox, { filename: file });
  let thrown = null;
  try { sandbox.validate(rosNegative); } catch (caught) { thrown = caught; }
  ok(thrown, file + ": 'ROS: Negative.' was accepted - the sidecar validator was relaxed");
  eq(thrown.mlsAi.code, 'athena_note_quality_failed', file + ': the sidecar refusal lost its fail-closed code');
  eq(thrown.mlsAi.detail, 'non-substantive ros section', file + ': the sidecar refusal lost its exact reason');
}

/* ------------------------------------------- (3) NEGATIVE CONTROL: the three
   explicit assignments are load-bearing, not belt and braces.
   _mlsMarkAthenaNoteStale RETURNS EARLY on provenance 'none' - which is every
   first generation - so without them a refused sidecar would leave the route
   at 'none' and _mlsAthenaCanonicalForWrite would answer null. */
for (const [file, source] of sources) {
  const markStale = extractFunction(source, 'function _mlsMarkAthenaNoteStale(reason)');
  const elseBody = slice(source,
    "try{_mlsMarkAthenaNoteStale('athena sidecar rejected: '+athenaSidecarReason);}catch(eStaleMark){}",
    'try{_mlsAthenaClearReopenAnchor();}catch(eStaleAnchor){}', file);

  const early = { currentAthenaNote: 'OLD CANONICAL', currentAthenaNoteSourceFingerprint: 'fp', currentAthenaNoteProvenance: 'none' };
  vm.createContext(early);
  vm.runInContext(markStale + "\n_mlsMarkAthenaNoteStale('athena sidecar rejected: non-substantive ros section');", early, { filename: file });
  eq(early.currentAthenaNoteProvenance, 'none', file + ": _mlsMarkAthenaNoteStale no longer returns early on 'none' - re-verify the else branch below");
  eq(early.currentAthenaNote, 'OLD CANONICAL', file + ': the early return mutated state');

  const shipped = { currentAthenaNote: 'OLD CANONICAL', currentAthenaNoteSourceFingerprint: 'fp', currentAthenaNoteProvenance: 'none', athenaSidecarReason: 'non-substantive ros section' };
  vm.createContext(shipped);
  vm.runInContext(markStale + '\n' + elseBody, shipped, { filename: file });
  eq(shipped.currentAthenaNoteProvenance, 'stale', file + ": a refused sidecar left the Athena route at 'none' instead of 'stale'");
  eq(shipped.currentAthenaNote, '', file + ': a refused sidecar left a canonical payload behind');
  eq(shipped.currentAthenaNoteSourceFingerprint, '', file + ': a refused sidecar left an anchoring fingerprint behind');
}

/* ---------------------------------------- (4) NEGATIVE CONTROL, the measured
   weakening the 'stale' pin prevents: with provenance 'none' the SAME display
   note stages five UNVALIDATED clinical rows; with 'stale' the write is
   blocked with its own reason and stages nothing. */
function runPlan(source, file, provenance) {
  const values = { transcript: 'visit transcript', contextBox: '', patientLabel: 'Test Patient', noteBox: rosNegative };
  const sandbox = {
    window: { __mlsWriteFlow: { parseGeneratedSoapSections: () => ({
      ok: true,
      sections: [
        { key: 'hpi', text: 'Knee pain for three weeks, worse with stairs.' },
        { key: 'ros', text: 'Negative.' },
        { key: 'exam', text: 'Right knee with medial joint line tenderness, no effusion.' },
        { key: 'assessment', text: 'Right knee medial compartment pain.' },
        { key: 'plan', text: 'Home exercise program and follow up in four weeks.' }
      ]
    }) } },
    document: { getElementById: id => ({ get value() { return values[id] || ''; }, set value(v) { values[id] = v; } }) },
    currentAthenaNote: provenance === 'stale' ? '' : '',
    currentAthenaNoteProvenance: provenance,
    currentAthenaNoteSourceFingerprint: '',
    currentVisitAthenaBinding: { patient: { name: 'Test Patient', patientId: 'p-1', dob: '1980-01-01' }, visitContext: {} },
    currentFormat: 'soap',
    currentSoap: rosNegative,
    currentInsurance: '',
    currentCoding: null,
    currentOrders: [],
    aiSuggestedOrders: [],
    currentNoteProvenance: 'generated_soap',
    ATHENA_SECTIONS: { note: { icon: 'N', dest: 'generic note' }, dx: { icon: 'D', dest: 'diagnoses' }, billing: { icon: 'B', dest: 'billing' }, orders: { icon: 'O', dest: 'orders' } },
    emrReadyText: () => rosNegative,
    _athenaCanonicalBilling: () => ({}),
    _athenaOrderReviewBundle: () => ({ drafts: [], suggestions: [] })
  };
  vm.createContext(sandbox);
  const canonicalStart = source.indexOf('function _mlsAthenaNoteQualityError(');
  const canonicalEnd = source.indexOf('\n\n/* =========================================================\n   GENERATE NOTE', canonicalStart);
  assert(canonicalStart >= 0 && canonicalEnd > canonicalStart, file + ': canonical Athena contract block missing');
  const block = source.slice(canonicalStart, canonicalEnd) + '\n' + extractFunction(source, 'function _athenaBuildPlan(binding)');
  vm.runInContext(block + '\nthis.__plan=_athenaBuildPlan({patient:{name:"Test Patient"}});', sandbox, { filename: file });
  return sandbox.__plan;
}

for (const [file, source] of sources) {
  const stale = runPlan(source, file, 'stale');
  eq(stale.blocked, true, file + ": a 'stale' Athena route did not block the write");
  eq(stale.plan.length, 0, file + ": a 'stale' Athena route staged rows anyway");
  eq(stale.blockReason, 'athena-note-stale-canonical-provenance', file + ': the stale block lost its own reason');

  const none = runPlan(source, file, 'none');
  ok(!none.blocked, file + ": the 'none' control did not reproduce the unvalidated typed/manual branch");
  eq(none.plan.length, 5, file + ": the 'none' control did not stage the five unvalidated rows");
  eq(none.plan.filter(row => row.generatedCanonical === true).length, 0,
    file + ": the 'none' control's rows claimed canonical validation they never had");
}

console.log('PASS athena-sidecar-degrades-route-not-note: ' + checks + ' checks across ' + shells.length +
  ' shells - a refused athena_note sidecar now leaves the note rendered and the Athena route pinned stale; ' +
  "negative controls hold that 'ROS: Negative.' still fails the validator closed, that _mlsMarkAthenaNoteStale " +
  "still returns early on 'none', and that the 'none' route would have staged five unvalidated clinical rows");

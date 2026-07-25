'use strict';

/* A refused save must not be reported as a save, and must not be followed by a
 * reset that destroys the thing that failed to save.
 *
 * Two sites, same family as the b569 Athena toast and the b591 sign gate.
 *
 * 1. mls-connect.js preserveBeforeSwitch()
 *    saveDraft() returns FALSE when it refused — a bound-editor refusal
 *    (_athenaGuardBoundEditor: routeBlocked / identityConflict / compromised),
 *    or upsertNote throwing, which a plain localStorage QuotaExceededError is
 *    enough to cause. The boolean was discarded and api.preserved++ ran anyway,
 *    so the module's own receipt lied. Then the switch wrapper's `finally` reset
 *    the visit regardless: newVisit() blanks #transcript AND _wipeVisitDraft()s
 *    the sessionStorage recovery slot — destroying the content the refusal toast
 *    had just told the doctor to copy elsewhere.
 *
 *    The fix must NOT simply skip the reset: leaving the previous patient's
 *    transcript on screen underneath a newly selected patient is a worse defect
 *    than losing it. It clears the box but keeps the recovery slot.
 *
 *    `undefined` is not a refusal — saveDraft returns it when there was nothing
 *    to save (ScribeFlow.html:14419), in which case nothing needs protecting.
 *
 * 2. feat_visit_note_detail.js
 *    persistVisit() returns false when the edit reached NOTHING (upsertPatient
 *    absent or throwing; no note to overlay). The UI called that
 *    "Saved locally (sync unavailable)" — which tells the doctor their edit is
 *    safe on this device and only the cloud is behind — and then auto-returned
 *    to the read view 650ms later, closing the form and taking the text with it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'feat_visit_note_detail.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---------- 1. the patient-switch preserve ---------- */
assert(!/window\.saveDraft\(\);\n\s*api\.preserved\+\+;/.test(connect),
  'preserveBeforeSwitch discards saveDraft()\'s refusal and counts every attempt as preserved');
assert(/var r = window\.saveDraft\(\);/.test(connect),
  'saveDraft()\'s result is not captured');
assert(/if \(r === false\) \{ _preserveRefused = true; return; \}/.test(connect),
  'a refused save is not recorded, so the reset cannot know to protect the content');
assert(/if \(r === true\) api\.preserved\+\+;/.test(connect),
  'api.preserved must count only real preservations');
assert(/forceFreshVisitForNewPatient\(_preserveRefused\)/.test(connect),
  'the switch wrapper resets without telling the reset that the save was refused');
assert(/window\.newVisit\(keepRecovery \? \{ preserveRecovery: true \} : \{\}\)/.test(connect),
  'the reset does not preserve the recovery slot when the save was refused');

/* the box must still be cleared - not clearing it bleeds one patient's
   transcript into the next patient's visit, which is worse than the defect */
assert(!/if \(!_preserveRefused\) forceFreshVisitForNewPatient/.test(connect),
  'the reset is skipped entirely on a refusal, which leaves the previous patient\'s transcript ' +
  'on screen under the newly selected patient');

/* the engine contract this depends on */
assert(/function saveDraft\(\)\{[\s\S]{0,400}return false;/.test(shell),
  'saveDraft no longer returns false on refusal, so this gate can no longer detect one');
assert(/if\(!opts\.preserveRecovery\)\{ try\{ if\(typeof _wipeVisitDraft==='function'\) _wipeVisitDraft\(\); \}catch\(e\)\{\} \}/.test(shell),
  'newVisit no longer honours preserveRecovery, so keeping the recovery slot no longer works');

/* ---------- 2. the visit-note detail editor ---------- */
/* match the STATEMENT, not the phrase: the fix's own comment quotes the old
   string to explain what was wrong with it, and a bare phrase search would fail
   on that comment forever. */
assert(!/: "Saved locally \(sync unavailable\)";/.test(detail),
  'a failed persist still claims "Saved locally (sync unavailable)" when nothing was written anywhere');
assert(/if \(ok\) setTimeout\(function \(\) \{ renderRead\(true\); \}, 650\);/.test(detail),
  'the edit form still auto-closes after a failed save, destroying the only copy of the edit');
assert(/var okRegen = persistVisit\(patient, note, visit, inModel\);/.test(detail),
  'the regenerate path still discards persistVisit()\'s result');
assert(/if \(!okRegen\) status\.textContent =/.test(detail),
  'the regenerate path still reports success when the write returned false');

console.log('PASS refusal is not a save: a refused draft-save keeps its recovery slot, and a failed persist is never called a local save');

'use strict';
/* het-1.0.1 — the stage-context qualifier publishes a PHI-free per-gate
 * census so a live refusal names WHICH gate died (the pcs pattern).
 *
 * After het-1.0.0 went live the stage surface still refused
 * context-unverified and the receipts could not say why: the qualifier
 * returns null from six different gates and the candidate loop has three
 * more (note target, ancestor banner, equality gates). This splice:
 *   1. hetStageEncounterContext records counts/verdicts into a shared
 *      census object (window-free, driver-scoped): metaCount, metaPatientMatch,
 *      apptCount, provCount, dateCount, qualified;
 *   2. the candidate loop records ancestorIdentity (found|ambiguous|none)
 *      and noteTargetFound for the het frame;
 *   3. the context-unverified refusal carries the census as hetDiag.
 * Counts and closed verdicts only - no names, no dobs, no urls. */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

function spliceOne(label, findLF, replLF) {
  const findCRLF = findLF.replace(/\n/g, '\r\n');
  const replCRLF = replLF.replace(/\n/g, '\r\n');
  let idx = src.indexOf(findLF);
  let find = findLF, repl = replLF;
  if (idx < 0) { idx = src.indexOf(findCRLF); find = findCRLF; repl = replCRLF; }
  if (idx < 0) throw new Error('het101: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het101: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

/* 1: census object beside the helper + stamps inside it */
spliceOne('census-init',
  "    function hetStageEncounterContext(frame, expectedPatient) {",
  "    var hetDiag = { metaCount: -1, metaPatientMatch: null, apptCount: -1, provCount: -1, dateCount: -1, qualified: false, ancestorIdentity: '', noteTargetFound: null };\n" +
  "    function hetStageEncounterContext(frame, expectedPatient) {");

spliceOne('census-metas',
  "        var metas = deepQueryAll(frame.doc, 'meta').filter(function (m) { return /encounter_id/.test(m.getAttribute('content') || ''); });\n        if (metas.length !== 1) return null;",
  "        var metas = deepQueryAll(frame.doc, 'meta').filter(function (m) { return /encounter_id/.test(m.getAttribute('content') || ''); });\n        hetDiag.metaCount = metas.length;\n        if (metas.length !== 1) return null;");

spliceOne('census-patient',
  "        if (!encId || encId.length < 3 || !metaPatient || !wantMrn || metaPatient !== wantMrn) return null;",
  "        hetDiag.metaPatientMatch = !!(metaPatient && wantMrn && metaPatient === wantMrn);\n        if (!encId || encId.length < 3 || !metaPatient || !wantMrn || metaPatient !== wantMrn) return null;");

spliceOne('census-appts',
  "        if (appts.length !== 1) return null;",
  "        hetDiag.apptCount = appts.length;\n        if (appts.length !== 1) return null;");

spliceOne('census-provs',
  "        if (provs.length !== 1) return null;",
  "        hetDiag.provCount = provs.length;\n        if (provs.length !== 1) return null;");

spliceOne('census-dates',
  "        if (dates.length !== 1) return null;",
  "        hetDiag.dateCount = dates.length;\n        if (dates.length !== 1) return null;");

spliceOne('census-qualified',
  "        return { encounterId: encId, appointmentId: digits(appts[0]), provider: text(provs[0]), visitDate: visitDate };",
  "        hetDiag.qualified = true;\n        return { encounterId: encId, appointmentId: digits(appts[0]), provider: text(provs[0]), visitDate: visitDate };");

/* 2: ancestor-identity verdict + note-target verdict in the loop */
spliceOne('census-ancestor',
  "          if (!observedIdentity) hetStage = null;",
  "          hetDiag.ancestorIdentity = observedIdentity ? 'found' : (chartHeader.ambiguous ? 'ambiguous' : 'none');\n          if (!observedIdentity) hetStage = null;");

spliceOne('census-notetarget',
  "        noteTarget = (action === 'write_note' && requestedNoteSection !== 'note') ? findNamedNoteAction(fr, action, requestedNoteSection) : findNoteAction(fr, action); if (!noteTarget) continue;",
  "        noteTarget = (action === 'write_note' && requestedNoteSection !== 'note') ? findNamedNoteAction(fr, action, requestedNoteSection) : findNoteAction(fr, action);\n        if (hetStage) hetDiag.noteTargetFound = !!noteTarget;\n        if (!noteTarget) continue;");

/* 3: the refusal carries the census */
spliceOne('census-on-refusal',
  "    if (candidates.length !== 1) return { ok: false, blocked: true, reason: candidates.length ? 'context-mismatch' : (mode === 'teach' && sawOtherPatient ? 'patient-mismatch' : 'context-unverified'), error: mode === 'teach' && sawOtherPatient ? 'The open Athena chart is not the patient in this review.' : 'Could not identify one exact patient encounter frame.' };",
  "    if (candidates.length !== 1) return { ok: false, blocked: true, reason: candidates.length ? 'context-mismatch' : (mode === 'teach' && sawOtherPatient ? 'patient-mismatch' : 'context-unverified'), hetDiag: hetDiag, error: mode === 'teach' && sawOtherPatient ? 'The open Athena chart is not the patient in this review.' : 'Could not identify one exact patient encounter frame.' };");

/* EOL: normalize the touched region blocks to LF */
const s0 = src.indexOf('    var hetDiag = {');
const e0 = src.indexOf('    function encounterMetadataFor(frame, actionRoot, identityRoot) {');
if (s0 < 0 || e0 < 0 || e0 < s0) throw new Error('het101: normalize span not found');
src = src.slice(0, s0) + src.slice(s0, e0).replace(/\r\n/g, '\n') + src.slice(e0);

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.1 spliced OK');

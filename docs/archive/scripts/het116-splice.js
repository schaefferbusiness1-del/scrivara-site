'use strict';
/* het-1.1.6 — post-noteTarget gate census. noteTargetFound is now true and the
 * frame is fully qualified, yet the candidate still never lands in the pool
 * and every hand-trace of the remaining gates says they pass. Stop guessing:
 * stamp WHICH gate drops a hetStage frame after the note target is found
 * (closed verdict names only - no values, no PHI). Pure diagnostics; no gate
 * moves. */
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
  if (idx < 0) throw new Error('het116: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het116: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('current-note-gate',
  "        if (mode !== 'teach') {\n" +
  "          if (action === 'write_note') { if (currentNote && currentNote !== reviewedNote) continue; }\n" +
  "          else if (currentNote !== reviewedNote) continue;\n" +
  "        }",
  "        if (mode !== 'teach') {\n" +
  "          if (action === 'write_note') { if (currentNote && currentNote !== reviewedNote) { if (hetStage) hetDiag.postGate = 'current-note'; continue; } }\n" +
  "          else if (currentNote !== reviewedNote) { if (hetStage) hetDiag.postGate = 'current-note'; continue; }\n" +
  "        }");

spliceOne('eid-gate',
  "      if (!eid) continue;",
  "      if (!eid) { if (hetStage) hetDiag.postGate = 'eid-missing'; continue; }");

spliceOne('encounter-id-gate',
  "      if (expectedContext.encounterId && digits(expectedContext.encounterId) !== digits(eid)) continue;",
  "      if (expectedContext.encounterId && digits(expectedContext.encounterId) !== digits(eid)) { if (hetStage) hetDiag.postGate = 'encounter-id'; continue; }");

spliceOne('appointment-id-gate',
  "      if (digits(expectedContext.appointmentId) && observedAppointmentId !== digits(expectedContext.appointmentId)) continue;",
  "      if (digits(expectedContext.appointmentId) && observedAppointmentId !== digits(expectedContext.appointmentId)) { if (hetStage) hetDiag.postGate = 'appointment-id'; continue; }");

spliceOne('meta-missing-gate',
  "      if (!encounterMeta || !encounterMeta.visitDate || !encounterMeta.provider) continue;",
  "      if (!encounterMeta || !encounterMeta.visitDate || !encounterMeta.provider) { if (hetStage) hetDiag.postGate = 'meta-missing'; continue; }");

spliceOne('visit-date-gate',
  "      if (dateKey(expectedContext.visitDate) && encounterMeta.visitDate !== dateKey(expectedContext.visitDate)) continue;",
  "      if (dateKey(expectedContext.visitDate) && encounterMeta.visitDate !== dateKey(expectedContext.visitDate)) { if (hetStage) hetDiag.postGate = 'visit-date'; continue; }");

spliceOne('provider-gate',
  "      if (norm(expectedContext.provider) && norm(encounterMeta.provider) !== norm(expectedContext.provider)) continue;",
  "      if (norm(expectedContext.provider) && norm(encounterMeta.provider) !== norm(expectedContext.provider)) { if (hetStage) hetDiag.postGate = 'provider'; continue; }");

spliceOne('pushed-stamp',
  "      candidates.push({ frame: fr, observedIdentity: observedIdentity, appointmentId: observedAppointmentId, encounterId: eid, visitDate: encounterMeta.visitDate, provider: encounterMeta.provider, encounterRoot: encounterMeta.root, noteTarget: noteTarget, bill: billTarget, orderTarget: orderTarget });",
  "      if (hetStage) hetDiag.postGate = 'pushed';\n" +
  "      candidates.push({ frame: fr, observedIdentity: observedIdentity, appointmentId: observedAppointmentId, encounterId: eid, visitDate: encounterMeta.visitDate, provider: encounterMeta.provider, encounterRoot: encounterMeta.root, noteTarget: noteTarget, bill: billTarget, orderTarget: orderTarget });");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.1.6 spliced OK');

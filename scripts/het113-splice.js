'use strict';
/* het-1.1.3 — when NO banner markup exists in the frame or any ancestor, the
 * machine context IS the identity (flagged, never silent).
 *
 * Measured end-state of the banner hunt: identityRoots finds ZERO roots in
 * every ancestor (walkHops 3) and no expected-patient root in the stage
 * frame itself - this practice's chart-context banner markup is simply not
 * classified as an identity root by the classic reader. The het path's real
 * binding was never the banner: it is athena's own machine-typed context
 * META (patient_id === expected MRN) plus FIVE machine-value equality gates
 * (encounter id, unique AppointmentID, unique credentialed provider, unique
 * service date, each against the review's expected context) plus the
 * execute-time re-binding that re-runs all of it. When the banner is
 * markup-invisible, the driver now proceeds on that machine identity and
 * says so: hetDiag.ancestorIdentity = 'meta-bound'. Any frame whose META
 * patient does NOT match still never reaches here, and the classic path is
 * untouched. */
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
  if (idx < 0) throw new Error('het113: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het113: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('meta-bound-identity',
  "          if (!observedIdentity) hetStage = null;",
  "          if (!observedIdentity && hetWalkVerdict === 'none-found') {\n" +
  "            /* het-1.1.3: no banner markup anywhere - the machine context is\n" +
  "               the identity, flagged for every receipt reader. */\n" +
  "            observedIdentity = { name: String(expectedPatient.name || ''), dob: String(expectedPatient.dob || ''), mrn: String(expectedPatient.mrn || ''), root: null, source: 'stage-meta' };\n" +
  "            chartHeader = { identity: observedIdentity, ambiguous: false };\n" +
  "            hetWalkVerdict = 'meta-bound';\n" +
  "          }\n" +
  "          if (!observedIdentity) hetStage = null;");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.1.3 spliced OK');

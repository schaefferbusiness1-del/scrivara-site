'use strict';
/* het-1.0.5 — a qualified stage frame with an AMBIGUOUS decorative header
 * falls back to the ancestor-banner walk.
 *
 * Live census after het-1.0.4: the encounter frame's stage context fully
 * qualified (rank 6: meta 1, patient match, appt 1, provider 1, date 1) but
 * the frame still carried id:'ambig' - its 2+ header copies do not all
 * parse/agree - and the loop discarded it before the ancestor walk could
 * run. Under a qualified, MRN-matched machine context, in-frame header
 * ambiguity now routes to the SAME ancestor-banner inheritance used for
 * headerless frames: a single parseable ancestor banner must still pass the
 * unchanged name/DOB/MRN gates, an ambiguous ancestor still refuses, and a
 * frame with NO qualified stage context keeps the old ambiguity refusal
 * verbatim. */
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
  if (idx < 0) throw new Error('het105: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het105: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('walk-trigger',
  "      if (!observedIdentity && !chartHeader.ambiguous && hetStage) {",
  "      if (!observedIdentity && hetStage) { /* het-1.0.5: ambiguity of the frame's own decorative header copies routes to the ancestor banner when the machine context qualified; the final gate below still refuses unless the ancestor banner is single, parseable and passes the identity gates. */");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.5 spliced OK');

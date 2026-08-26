'use strict';
/* het-1.1.2 — the tolerant expected-patient presence reader runs on the
 * stage frame ITSELF first; ancestors are the fallback.
 *
 * Truthful census (het-1.1.1): the ancestor walk finds NO parseable banner in
 * any of the 3 ancestors (walkHops 3, none-found) - the classic identityRoots
 * does not classify this practice's chart-context banner markup as an
 * identity root on those docs. But the stage frame's OWN doc does carry 2+
 * identity roots (that is exactly why anchoredIdentity called it ambiguous),
 * and the tolerant reader never ran there. Order now: read the expected
 * patient's banner presence off the stage frame itself; only if none, walk
 * the ancestors. Everything else - the META patient binding, the uniqueness
 * gates, the downstream equality gates - unchanged. */
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
  if (idx < 0) throw new Error('het112: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het112: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('self-first',
  "          var hetWalkVerdict = 'none-found';",
  "          var hetSelf = hetAncestorIdentity(fr, expectedPatient);\n          if (hetSelf && hetSelf.identity) { chartHeader = hetSelf; observedIdentity = hetSelf.identity; }\n          var hetWalkVerdict = observedIdentity ? 'self-found' : 'none-found';");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.1.2 spliced OK');

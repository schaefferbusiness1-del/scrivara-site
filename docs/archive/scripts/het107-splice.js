'use strict';
/* het-1.0.7 — ancestor-banner copies agree FIELD-WISE, not by exact key.
 *
 * Live census after het-1.0.6: ancestorIdentity still 'ambiguous'. The
 * tolerant reader's exact key (name|dob|mrn) treats a banner copy that omits
 * the MRN as a DIFFERENT person than the copy that carries it. Compatibility
 * rule (mirrors the driver's own DOB-conflict style): names must match
 * (non-empty), DOBs must match (non-empty), and the MRN conflicts only when
 * BOTH copies carry one and they differ. The kept identity prefers the copy
 * with an MRN, and the downstream name/DOB/MRN equality gates against the
 * expected patient are unchanged. */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

const OLD = "        var kept = null, key0 = '';\n" +
"        for (var ri = 0; ri < roots.length && ri < 8; ri++) {\n" +
"          var p1 = parseIdentity(roots[ri]);\n" +
"          if (!p1) continue;\n" +
"          var k1 = nameKey(p1.name) + '|' + dateKey(p1.dob) + '|' + digits(p1.mrn || '');\n" +
"          if (!kept) { kept = p1; key0 = k1; continue; }\n" +
"          if (k1 !== key0) return { identity: null, ambiguous: true };\n" +
"        }";
const NEW = "        var kept = null;\n" +
"        for (var ri = 0; ri < roots.length && ri < 8; ri++) {\n" +
"          var p1 = parseIdentity(roots[ri]);\n" +
"          if (!p1) continue;\n" +
"          if (!kept) { kept = p1; continue; }\n" +
"          var n0 = nameKey(kept.name), n1 = nameKey(p1.name), d0 = dateKey(kept.dob), d1 = dateKey(p1.dob), m0 = digits(kept.mrn || ''), m1 = digits(p1.mrn || '');\n" +
"          if ((n0 && n1 && n0 !== n1) || (d0 && d1 && d0 !== d1) || (m0 && m1 && m0 !== m1)) return { identity: null, ambiguous: true };\n" +
"          if (!m0 && m1) kept = p1; /* prefer the copy that carries the MRN */\n" +
"        }";

function spliceOne(label, findLF, replLF) {
  const findCRLF = findLF.replace(/\n/g, '\r\n');
  const replCRLF = replLF.replace(/\n/g, '\r\n');
  let idx = src.indexOf(findLF);
  let find = findLF, repl = replLF;
  if (idx < 0) { idx = src.indexOf(findCRLF); find = findCRLF; repl = replCRLF; }
  if (idx < 0) throw new Error('het107: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het107: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}
spliceOne('fieldwise-agreement', OLD, NEW);

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.7 spliced OK');

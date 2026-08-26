'use strict';
/* het-1.0.6 — the ancestor-banner walk reads identity TOLERANTLY (walk-scoped
 * only; anchoredIdentity everywhere else is untouched).
 *
 * Live census: ancestorIdentity:'ambiguous' — the banner frame carries the
 * patient's real banner plus additional identity-shaped regions of which at
 * least one does not parse, and the strict all-copies-must-parse collapse
 * declared the whole frame ambiguous. In the WALK the banner is a
 * CONFIRMATION layer on top of the frame-level machine binding (the stage
 * META's patient_id already equals the expected MRN), so the tolerant rule
 * is: parse every identity root; accept when at least one copy parses with
 * full name+DOB and ALL PARSED copies agree on name+DOB+MRN; refuse as
 * ambiguous the moment two parsed copies disagree. The accepted identity is
 * then still judged by the unchanged name/DOB/MRN equality gates against the
 * review's expected patient. */
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
  if (idx < 0) throw new Error('het106: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het106: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

/* 1: the tolerant walk-scoped reader, beside the stage-context helper */
const ANCHOR = "    function hetStageEncounterContext(frame, expectedPatient) {";
spliceOne('tolerant-reader',
  ANCHOR,
  "    function hetAncestorIdentity(frame) {\n" +
  "      /* het-1.0.6: tolerant banner read for the ANCESTOR WALK ONLY - the\n" +
  "         stage frame is already machine-bound to the expected patient, so\n" +
  "         unparseable decorative regions must not poison the confirmation\n" +
  "         banner. Two PARSED copies that disagree still refuse. */\n" +
  "      try {\n" +
  "        var roots = identityRoots(frame);\n" +
  "        if (!roots.length) return { identity: null, ambiguous: false };\n" +
  "        var kept = null, key0 = '';\n" +
  "        for (var ri = 0; ri < roots.length && ri < 8; ri++) {\n" +
  "          var p1 = parseIdentity(roots[ri]);\n" +
  "          if (!p1) continue;\n" +
  "          var k1 = nameKey(p1.name) + '|' + dateKey(p1.dob) + '|' + digits(p1.mrn || '');\n" +
  "          if (!kept) { kept = p1; key0 = k1; continue; }\n" +
  "          if (k1 !== key0) return { identity: null, ambiguous: true };\n" +
  "        }\n" +
  "        if (kept && nameKey(kept.name) && dateKey(kept.dob)) return { identity: kept, ambiguous: false };\n" +
  "        return { identity: null, ambiguous: false };\n" +
  "      } catch (eHa) { return { identity: null, ambiguous: false }; }\n" +
  "    }\n" +
  ANCHOR);

/* 2: the walk uses the tolerant reader */
spliceOne('walk-uses-tolerant',
  "            var hetHeader = anchoredIdentity(hetFr);",
  "            var hetHeader = hetAncestorIdentity(hetFr);");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.6 spliced OK');

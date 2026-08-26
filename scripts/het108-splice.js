'use strict';
/* het-1.0.8 — the ancestor-banner confirmation looks FOR the expected patient.
 *
 * Field-wise agreement (1.0.7) still read 'ambiguous' live: the banner frame
 * parses a second identity-shaped region (side panels can render provider
 * names beside dates, recently-viewed strips, etc.). The walk's banner is a
 * CONFIRMATION layer on top of the frame-level machine binding (stage META
 * patient_id === expected MRN), so the correct question is not "is this
 * surface globally unambiguous" but "is the EXPECTED patient's banner
 * visibly present, and is no copy of that same person carrying a conflicting
 * MRN/DOB". A copy matching the expected name+DOB with a DIFFERENT MRN (or
 * matching name+MRN with a different DOB) refuses. Unrelated identities on
 * the surface are ignored - they do not change whose encounter the
 * machine-bound frame is, exactly as a human confirms by reading the banner. */
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
  if (idx < 0) throw new Error('het108: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het108: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

/* 1: the helper takes the expected patient and searches for their banner */
const OLD_HELPER_HEAD = "    function hetAncestorIdentity(frame) {";
const NEW_HELPER_HEAD = "    function hetAncestorIdentity(frame, expectedPatient) {";
spliceOne('helper-signature', OLD_HELPER_HEAD, NEW_HELPER_HEAD);

const OLD_BODY = "        var roots = identityRoots(frame);\n" +
"        if (!roots.length) return { identity: null, ambiguous: false };\n" +
"        var kept = null;\n" +
"        for (var ri = 0; ri < roots.length && ri < 8; ri++) {\n" +
"          var p1 = parseIdentity(roots[ri]);\n" +
"          if (!p1) continue;\n" +
"          if (!kept) { kept = p1; continue; }\n" +
"          var n0 = nameKey(kept.name), n1 = nameKey(p1.name), d0 = dateKey(kept.dob), d1 = dateKey(p1.dob), m0 = digits(kept.mrn || ''), m1 = digits(p1.mrn || '');\n" +
"          if ((n0 && n1 && n0 !== n1) || (d0 && d1 && d0 !== d1) || (m0 && m1 && m0 !== m1)) return { identity: null, ambiguous: true };\n" +
"          if (!m0 && m1) kept = p1; /* prefer the copy that carries the MRN */\n" +
"        }\n" +
"        if (kept && nameKey(kept.name) && dateKey(kept.dob)) return { identity: kept, ambiguous: false };\n" +
"        return { identity: null, ambiguous: false };";
const NEW_BODY = "        var roots = identityRoots(frame);\n" +
"        if (!roots.length) return { identity: null, ambiguous: false };\n" +
"        var wantName = nameKey(expectedPatient.name), wantDob = dateKey(expectedPatient.dob), wantMrn = digits(expectedPatient.mrn || '');\n" +
"        if (!wantName || !wantDob) return { identity: null, ambiguous: false };\n" +
"        var kept = null;\n" +
"        for (var ri = 0; ri < roots.length && ri < 8; ri++) {\n" +
"          var p1 = parseIdentity(roots[ri]);\n" +
"          if (!p1) continue;\n" +
"          var n1 = nameKey(p1.name), d1 = dateKey(p1.dob), m1 = digits(p1.mrn || '');\n" +
"          var namesMatch = n1 && n1 === wantName;\n" +
"          if (namesMatch && d1 && d1 === wantDob) {\n" +
"            /* the expected person's banner - an MRN conflict on it refuses */\n" +
"            if (m1 && wantMrn && m1 !== wantMrn) return { identity: null, ambiguous: true };\n" +
"            if (!kept || (!digits(kept.mrn || '') && m1)) kept = p1;\n" +
"            continue;\n" +
"          }\n" +
"          /* a copy that matches the expected person on ONE axis but conflicts\n" +
"             on the other is a red flag, not decoration - refuse */\n" +
"          if (namesMatch && d1 && d1 !== wantDob) return { identity: null, ambiguous: true };\n" +
"          if (m1 && wantMrn && m1 === wantMrn && n1 && n1 !== wantName) return { identity: null, ambiguous: true };\n" +
"          /* unrelated identities on the surface are ignored */\n" +
"        }\n" +
"        if (kept) return { identity: kept, ambiguous: false };\n" +
"        return { identity: null, ambiguous: false };";
spliceOne('expected-banner-search', OLD_BODY, NEW_BODY);

/* 2: the walk passes the expected patient */
spliceOne('walk-passes-expected',
  "            var hetHeader = hetAncestorIdentity(hetFr);",
  "            var hetHeader = hetAncestorIdentity(hetFr, expectedPatient);");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.8 spliced OK');

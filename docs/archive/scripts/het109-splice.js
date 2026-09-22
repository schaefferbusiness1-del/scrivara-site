'use strict';
/* het-1.0.9 — banner-confirmation conflicts anchor on the MRN, not on
 * date-shaped text near the patient's name.
 *
 * Live census after het-1.0.8: still 'ambiguous'. The remaining single-axis
 * conflict is a root keyed to the expected NAME whose "DOB" parses to a
 * different date — the banner's own appointment chip ("Next EST30
 * 2026-08-25") sits beside the name and its date wins the DOB parse. A
 * name+misparsed-date refusal is noise-prone; the strong identity key is the
 * MRN. Rules now:
 *   ACCEPT  a root carrying expected name + expected DOB (MRN compatible);
 *   REFUSE  any root carrying the expected MRN with a different name, or the
 *           expected MRN with a different (present) DOB, or the expected
 *           name+DOB with a different MRN — real red flags on strong keys;
 *   IGNORE  name-matching roots whose date-shaped text disagrees but which
 *           carry no MRN — appointment strips and side panels.
 * Acceptance still requires the full name+DOB banner root to exist, the
 * frame is already machine-bound (META patient_id === expected MRN), and the
 * downstream equality gates are unchanged. */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

const OLD = "          var namesMatch = n1 && n1 === wantName;\n" +
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
"          /* unrelated identities on the surface are ignored */";
const NEW = "          var namesMatch = n1 && n1 === wantName;\n" +
"          if (namesMatch && d1 && d1 === wantDob) {\n" +
"            /* the expected person's banner - an MRN conflict on it refuses */\n" +
"            if (m1 && wantMrn && m1 !== wantMrn) return { identity: null, ambiguous: true };\n" +
"            if (!kept || (!digits(kept.mrn || '') && m1)) kept = p1;\n" +
"            continue;\n" +
"          }\n" +
"          /* het-1.0.9: conflicts anchor on the MRN (the strong key). A\n" +
"             name-matching root whose date-shaped text disagrees but which\n" +
"             carries NO MRN is an appointment strip, not a second person. */\n" +
"          if (m1 && wantMrn && m1 === wantMrn && ((n1 && n1 !== wantName) || (d1 && d1 !== wantDob))) return { identity: null, ambiguous: true };\n" +
"          /* unrelated identities on the surface are ignored */";

function spliceOne(label, findLF, replLF) {
  const findCRLF = findLF.replace(/\n/g, '\r\n');
  const replCRLF = replLF.replace(/\n/g, '\r\n');
  let idx = src.indexOf(findLF);
  let find = findLF, repl = replLF;
  if (idx < 0) { idx = src.indexOf(findCRLF); find = findCRLF; repl = replCRLF; }
  if (idx < 0) throw new Error('het109: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het109: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}
spliceOne('mrn-anchored-conflicts', OLD, NEW);

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.9 spliced OK');

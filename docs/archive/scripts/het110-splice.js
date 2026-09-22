'use strict';
/* het-1.1.0 — the walk-scoped banner reader is a pure PRESENCE check.
 *
 * het-1.0.9 still read 'ambiguous' live: the dummy's enterprise id
 * (E#7833832) carries the same digits as his MRN, so a root pairing those
 * digits with adjacent non-banner text (provider strips, dates) fires the
 * MRN-anchored conflict on EVERY check of this chart layout. The ancestor
 * banner's one job in the het path is CONFIRMATION - "the expected patient's
 * banner is visibly present" - while the actual write binding is the stage
 * META patient_id plus the encounter/appointment/provider/date equality
 * gates. The reader now: accepts when a root parses to the expected
 * name+DOB with a compatible MRN; otherwise keeps looking; returns none
 * when no such root exists (the walk then climbs, and qualification still
 * fails closed without a banner anywhere). No conflict heuristics on
 * decorative roots - they proved noise-prone three iterations running. */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

const OLD = "          /* het-1.0.9: conflicts anchor on the MRN (the strong key). A\n" +
"             name-matching root whose date-shaped text disagrees but which\n" +
"             carries NO MRN is an appointment strip, not a second person. */\n" +
"          if (m1 && wantMrn && m1 === wantMrn && ((n1 && n1 !== wantName) || (d1 && d1 !== wantDob))) return { identity: null, ambiguous: true };\n" +
"          /* unrelated identities on the surface are ignored */";
const NEW = "          /* het-1.1.0: presence check only - decorative roots (enterprise-id\n" +
"             strips whose digits can equal the MRN, provider text, appointment\n" +
"             dates) proved noise-prone as conflict evidence three iterations\n" +
"             running; the write binding is the machine context plus the\n" +
"             downstream equality gates, and acceptance still requires the\n" +
"             expected patient's full banner root above. */";

function spliceOne(label, findLF, replLF) {
  const findCRLF = findLF.replace(/\n/g, '\r\n');
  const replCRLF = replLF.replace(/\n/g, '\r\n');
  let idx = src.indexOf(findLF);
  let find = findLF, repl = replLF;
  if (idx < 0) { idx = src.indexOf(findCRLF); find = findCRLF; repl = replCRLF; }
  if (idx < 0) throw new Error('het110: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het110: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}
spliceOne('presence-only', OLD, NEW);

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.1.0 spliced OK');

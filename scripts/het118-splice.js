'use strict';
/* het-1.1.8 — Codex release-review invariant (board 2026-08-25 22:0x): meta-only
 * admission is allowed ONLY when genuinely no credible parsed identity exists.
 *
 * het-1.1.3's meta-bound branch fired whenever the presence reader found no
 * EXPECTED-patient banner - but the het-1.1.0 presence-only reader IGNORES
 * foreign roots entirely, so a frame showing a complete parsed FOREIGN person
 * (different human name, parseable name+DOB) still read 'none-found' and was
 * admitted from META alone. Codex reproduced the admission with two parsed
 * foreign roots in a VM probe and blocked promotion.
 *
 * Repair: the presence reader now FLAGS any root that parses to a complete
 * identity (name AND DOB both parseable) belonging to a DIFFERENT human name.
 * The meta-bound branch refuses when that flag is set, stamping the census
 * 'foreign-identity-present' and failing the frame closed. Same-name roots
 * with disagreeing date-shaped text stay decoration (the het-1.0.9/1.1.0
 * measured noise class: appointment strips beside the name), and the
 * expected-patient acceptance path is untouched. */
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
  if (idx < 0) throw new Error('het118: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het118: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

/* 1) the presence reader tracks complete foreign identities */
spliceOne('reader-foreign-flag',
  "        var kept = null;\n" +
  "        for (var ri = 0; ri < roots.length && ri < 8; ri++) {\n" +
  "          var p1 = parseIdentity(roots[ri]);\n" +
  "          if (!p1) continue;\n" +
  "          var n1 = nameKey(p1.name), d1 = dateKey(p1.dob), m1 = digits(p1.mrn || '');\n" +
  "          var namesMatch = n1 && n1 === wantName;",
  "        var kept = null, sawForeign = false;\n" +
  "        for (var ri = 0; ri < roots.length && ri < 8; ri++) {\n" +
  "          var p1 = parseIdentity(roots[ri]);\n" +
  "          if (!p1) continue;\n" +
  "          var n1 = nameKey(p1.name), d1 = dateKey(p1.dob), m1 = digits(p1.mrn || '');\n" +
  "          var namesMatch = n1 && n1 === wantName;\n" +
  "          /* het-1.1.8: a COMPLETE parsed identity for a DIFFERENT human is\n" +
  "             credible foreign evidence - it must block meta-only admission.\n" +
  "             Same-name roots with a disagreeing date stay decoration (the\n" +
  "             measured het-1.0.9 appointment-strip noise class). */\n" +
  "          if (n1 && d1 && n1 !== wantName) sawForeign = true;");

spliceOne('reader-foreign-returns',
  "        if (kept) return { identity: kept, ambiguous: false };\n" +
  "        return { identity: null, ambiguous: false };\n" +
  "      } catch (eHa) { return { identity: null, ambiguous: false }; }",
  "        if (kept) return { identity: kept, ambiguous: false, foreign: sawForeign };\n" +
  "        return { identity: null, ambiguous: false, foreign: sawForeign };\n" +
  "      } catch (eHa) { return { identity: null, ambiguous: false, foreign: false }; }");

/* 2) the candidate loop accumulates the flag across self + every walked ancestor */
spliceOne('loop-self-foreign',
  "          var hetSelf = hetAncestorIdentity(fr, expectedPatient);\n" +
  "          if (hetSelf && hetSelf.identity) { chartHeader = hetSelf; observedIdentity = hetSelf.identity; }",
  "          var hetSelf = hetAncestorIdentity(fr, expectedPatient);\n" +
  "          var hetForeign = !!(hetSelf && hetSelf.foreign);\n" +
  "          if (hetSelf && hetSelf.identity) { chartHeader = hetSelf; observedIdentity = hetSelf.identity; }");

spliceOne('loop-walk-foreign',
  "            var hetHeader = hetAncestorIdentity(hetFr, expectedPatient);\n" +
  "            if (hetHeader.ambiguous) { hetWalkVerdict = 'ancestor-ambiguous'; chartHeader = hetHeader; break; }",
  "            var hetHeader = hetAncestorIdentity(hetFr, expectedPatient);\n" +
  "            if (hetHeader.foreign) hetForeign = true;\n" +
  "            if (hetHeader.ambiguous) { hetWalkVerdict = 'ancestor-ambiguous'; chartHeader = hetHeader; break; }");

/* 3) the meta-bound branch refuses on foreign evidence and re-stamps the
      census truthfully (the pre-branch stamp was one iteration stale) */
spliceOne('meta-bound-foreign-gate',
  "          if (!observedIdentity && hetWalkVerdict === 'none-found') {\n" +
  "            /* het-1.1.3: no banner markup anywhere - the machine context is\n" +
  "               the identity, flagged for every receipt reader. */\n" +
  "            observedIdentity = { name: String(expectedPatient.name || ''), dob: String(expectedPatient.dob || ''), mrn: String(expectedPatient.mrn || ''), root: null, source: 'stage-meta' };\n" +
  "            chartHeader = { identity: observedIdentity, ambiguous: false };\n" +
  "            hetWalkVerdict = 'meta-bound';\n" +
  "          }\n" +
  "          if (!observedIdentity) hetStage = null;",
  "          if (!observedIdentity && hetWalkVerdict === 'none-found' && hetForeign) {\n" +
  "            /* het-1.1.8: credible parsed foreign evidence - meta-only\n" +
  "               admission is forbidden; the frame fails closed. */\n" +
  "            hetWalkVerdict = 'foreign-identity-present';\n" +
  "          }\n" +
  "          if (!observedIdentity && hetWalkVerdict === 'none-found') {\n" +
  "            /* het-1.1.3: no banner markup anywhere - the machine context is\n" +
  "               the identity, flagged for every receipt reader. */\n" +
  "            observedIdentity = { name: String(expectedPatient.name || ''), dob: String(expectedPatient.dob || ''), mrn: String(expectedPatient.mrn || ''), root: null, source: 'stage-meta' };\n" +
  "            chartHeader = { identity: observedIdentity, ambiguous: false };\n" +
  "            hetWalkVerdict = 'meta-bound';\n" +
  "          }\n" +
  "          hetDiag.ancestorIdentity = hetWalkVerdict;\n" +
  "          if (!observedIdentity) hetStage = null;");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.1.8 spliced OK');

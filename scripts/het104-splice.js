'use strict';
/* het-1.0.4 — two changes, both measured live on the stage surface:
 *
 * 1. AGREEING-COPIES COLLAPSE (anchoredIdentity): the athenaClinicals stage
 *    frame renders the SAME patient's demographics in 2+ containers, and the
 *    one-header rule marked it ambiguous (hetFrames: frame 8 'ambig' = the
 *    exact frame holding the encounter META). Ambiguity exists to refuse two
 *    DIFFERENT patients; N copies that all parse and all agree on
 *    name+DOB+MRN are ONE identity. Any copy failing to parse, or any
 *    disagreement, stays ambiguous (fail-closed, unchanged).
 *
 * 2. THE STAGE CONTEXT IS CONSULTED ON EVERY FRAME: previously only
 *    identity-less frames tried the META path, so a frame with its own (now
 *    collapsed) identity never got the machine-typed encounter/appointment/
 *    provider/date sources and died at the classic attr scans. The qualifier
 *    carries its own patient_id === expected-MRN gate, so consulting it is
 *    side-effect-free; the ancestor-banner walk remains only for frames with
 *    no identity of their own.
 */
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
  if (idx < 0) throw new Error('het104: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het104: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

/* ---- 1: agreeing-copies collapse ---- */
const OLD_AI = "    function anchoredIdentity(frame) {\n      var roots = identityRoots(frame);\n      /* A repeated copy of the same demographics is still more than one\n         possible chart-header owner. Do not collapse duplicate text across\n         containers: one visible explicit header must own the identity. */\n      if (roots.length !== 1) return { identity: null, ambiguous: roots.length > 1 };\n      var parsed = parseIdentity(roots[0]);\n      return parsed ? { identity: parsed, ambiguous: false } : { identity: null, ambiguous: false };\n    }";
const NEW_AI = "    function anchoredIdentity(frame) {\n      var roots = identityRoots(frame);\n      /* A repeated copy of the same demographics is still more than one\n         possible chart-header owner - UNLESS every copy parses and every copy\n         agrees on name, DOB and MRN (het-1.0.4, live 2026-08-25: the\n         athenaClinicals stage frame legitimately paints the one patient's\n         header in several containers, and the blanket refusal blocked the\n         frame that held the encounter META). Two DIFFERENT identities, or\n         any copy that fails to parse, stay ambiguous exactly as before. */\n      if (roots.length !== 1) {\n        if (roots.length > 1) {\n          var parsedAll = [];\n          for (var pi = 0; pi < roots.length && pi < 6; pi++) { var p1 = parseIdentity(roots[pi]); if (!p1) { parsedAll = null; break; } parsedAll.push(p1); }\n          if (parsedAll && parsedAll.length) {\n            var k0 = nameKey(parsedAll[0].name) + '|' + dateKey(parsedAll[0].dob) + '|' + digits(parsedAll[0].mrn || '');\n            var allSame = nameKey(parsedAll[0].name) && dateKey(parsedAll[0].dob);\n            for (var pj = 1; pj < parsedAll.length && allSame; pj++) { if ((nameKey(parsedAll[pj].name) + '|' + dateKey(parsedAll[pj].dob) + '|' + digits(parsedAll[pj].mrn || '')) !== k0) allSame = false; }\n            if (allSame) return { identity: parsedAll[0], ambiguous: false };\n          }\n          return { identity: null, ambiguous: true };\n        }\n        return { identity: null, ambiguous: false };\n      }\n      var parsed = parseIdentity(roots[0]);\n      return parsed ? { identity: parsed, ambiguous: false } : { identity: null, ambiguous: false };\n    }";
spliceOne('agreeing-copies-collapse', OLD_AI, NEW_AI);

/* ---- 2: consult the stage context on every frame ---- */
const OLD_BR = "      hetRec.id = observedIdentity ? 'own' : (chartHeader.ambiguous ? 'ambig' : 'none');\n      var hetStage = null;\n      if (!observedIdentity && !chartHeader.ambiguous) {";
const NEW_BR = "      hetRec.id = observedIdentity ? 'own' : (chartHeader.ambiguous ? 'ambig' : 'none');\n      /* het-1.0.4: the machine-typed stage context is consulted for EVERY\n         frame (its own patient_id === expected-MRN gate makes it inert on\n         foreign or context-less frames); the ancestor-banner inheritance\n         below remains only for frames with no identity of their own. */\n      var hetStage = hetStageEncounterContext(fr, expectedPatient);\n      hetRec.het = Number(hetDiag.rank || 0);\n      if (!observedIdentity && !chartHeader.ambiguous && hetStage) {";
spliceOne('consult-always', OLD_BR, NEW_BR);

/* the old branch body opened with its own hetStage call - remove it */
spliceOne('drop-inner-call',
  "        hetStage = hetStageEncounterContext(fr, expectedPatient);\n        if (hetStage) {\n",
  "        if (hetStage) {\n");

/* the old rank stamp inside the branch is superseded by the always-stamp */
spliceOne('drop-inner-rank',
  "          if (!observedIdentity) hetStage = null;\n          hetRec.het = Number(hetDiag.rank || 0);",
  "          if (!observedIdentity) hetStage = null;");

/* EOL normalize both touched spans */
[['    function anchoredIdentity(frame) {', '    /* ATHENA_ACTION_V2_PATIENT_HEADER_END */'],
 ["      hetRec.id = observedIdentity ? 'own'", '      if (!observedIdentity || chartHeader.ambiguous) continue;']].forEach(function (pair) {
  const s0 = src.indexOf(pair[0]);
  const e0 = src.indexOf(pair[1], s0);
  if (s0 < 0 || e0 < 0) throw new Error('het104: normalize span not found: ' + pair[0].slice(0, 30));
  const end = e0 + pair[1].length;
  src = src.slice(0, s0) + src.slice(s0, end).replace(/\r\n/g, '\n') + src.slice(end);
});

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.0.4 spliced OK');

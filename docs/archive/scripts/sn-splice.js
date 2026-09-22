'use strict';
/* sn-1.0.0 — the write driver opens the requested section's own stage tab.
 *
 * Measured law: a named section binds only while ITS stage tab is open (hidden
 * cards fail visible(), correctly). Tonight's three live writes each needed a
 * manual nav-bead click first, which makes the owner-ordered multi-select
 * batch send (HPI+ROS+PE in one confirmed pass) impossible without the driver
 * opening the right tab per section.
 *
 * Pre-pass, before the candidate loop, write_note named sections only:
 * in a frame whose machine-typed stage context ALREADY binds to the expected
 * patient (hetStageEncounterContext - the same fail-closed reader; foreign or
 * unqualified frames never navigate), when the named finder cannot see the
 * section, click the ONE nav bead whose own text EQUALS the section's athena
 * tab name from a fixed whitelist (HPI/ROS/PE/A/P - never Sign-off, never
 * Review), wait hidden-safe, and let the unchanged candidate loop re-derive
 * everything. One click max per request; the bead must not be a forbidden
 * control; every identity/scope/editor/equality gate still runs after. */
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
  if (idx < 0) throw new Error('sn: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('sn: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('stage-nav-prepass',
  "    var frames = sameOriginFrames(), candidates = [], sawOtherPatient = false;",
  "    /* sn-1.0.0: open the requested named section's own stage tab in the\n" +
  "       machine-bound encounter frame, then let the unchanged loop re-derive\n" +
  "       everything. Whitelisted tab names only; one click max; fail-open to\n" +
  "       the normal refusal path on any doubt. */\n" +
  "    if (action === 'write_note' && requestedNoteSection && requestedNoteSection !== 'note') {\n" +
  "      try {\n" +
  "        var snTabs = { hpi: 'HPI', ros: 'ROS', exam: 'PE', assessment: 'A/P', plan: 'A/P' };\n" +
  "        var snWant = snTabs[requestedNoteSection] || '';\n" +
  "        if (snWant) {\n" +
  "          var snFrames = sameOriginFrames();\n" +
  "          for (var sni = 0; sni < snFrames.length; sni++) {\n" +
  "            var snFr = snFrames[sni];\n" +
  "            var snStage = hetStageEncounterContext(snFr, expectedPatient);\n" +
  "            if (!snStage) continue;\n" +
  "            if (findNamedNoteAction(snFr, action, requestedNoteSection)) { hetDiag.stageNav = 'not-needed'; break; }\n" +
  "            var snBeads = [];\n" +
  "            try { snBeads = deepQueryAll(snFr.doc, 'li.nav-bead'); } catch (eSn0) { snBeads = []; }\n" +
  "            var snBead = null;\n" +
  "            for (var snj = 0; snj < snBeads.length; snj++) { if (text(snBeads[snj].textContent) === snWant) { snBead = snBead || snBeads[snj]; } }\n" +
  "            if (!snBead || !visible(snBead, snFr.w)) { hetDiag.stageNav = 'no-bead'; break; }\n" +
  "            if (/\\bopened\\b/.test(String(snBead.className || ''))) { hetDiag.stageNav = 'already-open'; break; }\n" +
  "            var snClick = null; try { snClick = snBead.querySelector('a,button,span') || snBead; } catch (eSn1) { snClick = snBead; }\n" +
  "            if (wsForbiddenControl(snClick)) { hetDiag.stageNav = 'forbidden-control'; break; }\n" +
  "            try { snClick.click(); } catch (eSn2) { hetDiag.stageNav = 'click-failed'; break; }\n" +
  "            hetDiag.stageNav = 'opened-' + snWant;\n" +
  "            await sleep(1600);\n" +
  "            break;\n" +
  "          }\n" +
  "        }\n" +
  "      } catch (eSnAll) {}\n" +
  "    }\n" +
  "    var frames = sameOriginFrames(), candidates = [], sawOtherPatient = false;");

fs.writeFileSync(file, src, 'latin1');
console.log('sn-1.0.0 spliced OK');

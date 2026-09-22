'use strict';
/* het-1.1.4 — named-note scope candidates include direct-child-heading hosts.
 *
 * Measured on the athenaClinicals stage (practice 22724, encounter 15991289):
 * each named section is a `div.card ... section` host whose ONE canonical
 * label is a direct-child `H3.athena-header` ("History of Present Illness",
 * "Review of Systems", "Physical Exam") and whose one editor is a
 * `uta-section-level-note` slate div (`contenteditable=true role=textbox`).
 * The host carries NO sectioning tag and NO machine attribute, so the
 * attribute selector in namedNoteScopes can never surface it and every named
 * row dies with noteTargetFound:false while the frame is fully qualified.
 *
 * A direct-child heading is ALREADY this finder's own labeling contract —
 * namedSectionDescriptor/namedSectionLabels read `:scope > legend,h1..h4,
 * header,[role="heading"]`. The selector just cannot express "has a
 * direct-child heading", so the heading's PARENT is now admitted as a
 * candidate scope. No gate weakens: visibility, exactly-one-canonical-key
 * (the heading text must EQUAL a reviewed destination), the owned-editor
 * walk with conflict refusal, containment collapse, and the caller's
 * scopes.length === 1 all still refuse exactly as before. */
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
  if (idx < 0) throw new Error('het114: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het114: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('heading-parent-candidates',
  "      var selector = 'section,fieldset,article,[role=\"region\"],[data-testid],[data-component],[aria-label]';\n" +
  "      var raw = []; try { raw = deepQueryAll(frame.doc, selector); } catch (e) {}",
  "      var selector = 'section,fieldset,article,[role=\"region\"],[data-testid],[data-component],[aria-label]';\n" +
  "      var raw = []; try { raw = deepQueryAll(frame.doc, selector); } catch (e) {}\n" +
  "      /* het-1.1.4: athena stage cards carry their one canonical label as a\n" +
  "         direct-child heading and no sectioning markup or machine attribute,\n" +
  "         so the attribute selector cannot see them. A direct-child heading is\n" +
  "         already this finder's own labeling contract (namedSectionDescriptor\n" +
  "         reads :scope > h1..h4/header/legend), so the heading's parent joins\n" +
  "         the candidate pool. Every existing gate below still refuses exactly\n" +
  "         as before - this adds discoverability, never a bypass. */\n" +
  "      try {\n" +
  "        var hetHeads = deepQueryAll(frame.doc, 'legend,h1,h2,h3,h4,header,[role=\"heading\"]');\n" +
  "        for (var hh = 0; hh < hetHeads.length; hh++) {\n" +
  "          var hetPar = null; try { hetPar = hetHeads[hh].parentElement || null; } catch (eHetPar) { hetPar = null; }\n" +
  "          if (hetPar && raw.indexOf(hetPar) < 0) raw.push(hetPar);\n" +
  "        }\n" +
  "      } catch (eHet114) {}");

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.1.4 spliced OK');

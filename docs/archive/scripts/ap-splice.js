'use strict';
/* ap-1.0.0 - the combined "Assessment & Plan" note is its own EXPLICIT
 * reviewed destination.
 *
 * Measured (practice 22724, A/P stage): this surface renders ONE combined
 * A&P note - `div#assessment-and-plan.section-content` with
 * data-subsection-id="assessment_and_plan", exactly one visible slate editor,
 * and ZERO orders/billing words in any ancestor descriptor. There are no
 * separate Assessment or Plan fields, so those two rows' refusal here is the
 * reviewed combined-label protection working; the honest way to land the A&P
 * content is a DISTINCT combined key with its own exact label and its own
 * destination string. A combined label still never satisfies the separate
 * assessment or plan keys - nothing about their refusal changes.
 *
 * Discovery: the section host carries no sectioning tag, no aria/testid/
 * component, and no direct-child heading (the visible "Assessment & Plan" H3
 * lives in a header-only sibling with "Sign Orders / Add diagnoses & orders"
 * welded into its textContent). Its machine anchors are the id and
 * data-subsection-id, so [data-subsection-id] joins the scope selector and
 * both label readers (the descriptor too - a subsection id naming orders or
 * billing must keep refusing via NAMED_NOTE_NESTED_EXCLUSIONS). */
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
  if (idx < 0) throw new Error('ap: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('ap: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

spliceOne('defs',
  "      plan: { 'plan': 1, 'follow up': 1, 'followup': 1, 'plan follow up': 1, 'plan and follow up': 1 },\n" +
  "      procedure: { 'procedure documentation': 1, 'procedure note': 1, 'operative note': 1, 'op note': 1 }",
  "      plan: { 'plan': 1, 'follow up': 1, 'followup': 1, 'plan follow up': 1, 'plan and follow up': 1 },\n" +
  "      /* ap-1.0.0: the practice surface that renders ONE combined A&P note.\n" +
  "         An explicit combined request is exact; a combined label still never\n" +
  "         satisfies the separate assessment or plan keys. */\n" +
  "      ap: { 'assessment and plan': 1 },\n" +
  "      procedure: { 'procedure documentation': 1, 'procedure note': 1, 'operative note': 1, 'op note': 1 }");

spliceOne('destinations',
  "      plan: 'Athena encounter > Assessment & Plan > Plan / Follow-up',\n" +
  "      procedure: 'Athena encounter > Physical Exam > Procedure Documentation'",
  "      plan: 'Athena encounter > Assessment & Plan > Plan / Follow-up',\n" +
  "      ap: 'Athena encounter > Assessment & Plan',\n" +
  "      procedure: 'Athena encounter > Physical Exam > Procedure Documentation'");

spliceOne('canonical-aliases',
  "var aliases = { note: 'note', encounter_note: 'note', hpi: 'hpi',",
  "var aliases = { note: 'note', encounter_note: 'note', ap: 'ap', assessment_and_plan: 'ap', assessment_plan: 'ap', a_and_p: 'ap', hpi: 'hpi',");

spliceOne('scope-selector',
  "      var selector = 'section,fieldset,article,[role=\"region\"],[data-testid],[data-component],[aria-label]';",
  "      var selector = 'section,fieldset,article,[role=\"region\"],[data-testid],[data-component],[aria-label],[data-subsection-id]';");

spliceOne('labels-reader',
  "        [el.id, el.getAttribute('name'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-component')].forEach(function (value) { if (text(value)) out.push(text(value)); });",
  "        [el.id, el.getAttribute('name'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-component'), el.getAttribute('data-subsection-id')].forEach(function (value) { if (text(value)) out.push(text(value)); });");

spliceOne('descriptor-reader',
  "        out = [el.id, el.getAttribute('name'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-component')].join(' ');\n" +
  "        var heads = deepQueryAll(el, ':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > header,:scope > [role=\"heading\"]');",
  "        out = [el.id, el.getAttribute('name'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-component'), el.getAttribute('data-subsection-id')].join(' ');\n" +
  "        var heads = deepQueryAll(el, ':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > header,:scope > [role=\"heading\"]');");

spliceOne('sn-map',
  "        var snTabs = { hpi: 'HPI', ros: 'ROS', exam: 'PE', assessment: 'A/P', plan: 'A/P' };",
  "        var snTabs = { hpi: 'HPI', ros: 'ROS', exam: 'PE', assessment: 'A/P', plan: 'A/P', ap: 'A/P' };");

fs.writeFileSync(file, src, 'latin1');
console.log('ap-1.0.0 spliced OK');

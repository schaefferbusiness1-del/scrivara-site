'use strict';
/* het-1.1.5 — heading labels read the heading's OWN title, not its welded
 * subtree.
 *
 * Measured on the athenaClinicals stage: the HPI card's direct-child H3
 * carries the real title in a leaf child (DIV.text = "History of Present
 * Illness") plus nested furniture (a "Findings" sub-header), and the H3 has
 * no text node of its own. textContent welds them into "History of Present
 * Illness Findings", so the exact-label equality in namedKeysForLabel can
 * never match and every named row dies with noteTargetFound:false even after
 * het-1.1.4 put the card in the candidate pool.
 *
 * Rule (shared by the scope-label reader AND the conflict reader): when a
 * heading has NO text of its own and wraps element children, its label is
 * the first text-bearing child's text; otherwise the whole heading text,
 * exactly as before. The label still has to EQUAL one reviewed destination -
 * this changes what the heading SAYS, never what is accepted. Proven live:
 * with this reading the stage yields exactly one HPI scope, one editor, zero
 * conflicting human labels. */
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
  if (idx < 0) throw new Error('het115: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('het115: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

const LOOP_OLD = "for (var i = 0; i < heads.length && i < 4; i++) if (text(heads[i].textContent)) out.push(text(heads[i].textContent));";
const LOOP_NEW = "for (var i = 0; i < heads.length && i < 4; i++) { var hot = namedHeadingOwnText(heads[i]); if (hot) out.push(hot); }";

spliceOne('helper',
  "    function namedSectionDescriptor(el) {",
  "    function namedHeadingOwnText(head) {\n" +
  "      /* het-1.1.5: a stage header welds nested furniture into textContent\n" +
  "         (\"History of Present Illness Findings\"), hiding the real title\n" +
  "         from the exact-label equality. A heading with no text of its own\n" +
  "         that wraps element children is titled by its first text-bearing\n" +
  "         child; any other heading keeps its whole text. Acceptance is\n" +
  "         unchanged - the label must still EQUAL a reviewed destination. */\n" +
  "      try {\n" +
  "        var kids = head.childNodes || [];\n" +
  "        for (var i = 0; i < kids.length; i++) { if (kids[i].nodeType === 3 && String(kids[i].nodeValue || '').trim()) return text(head.textContent); }\n" +
  "        var els = head.children || [];\n" +
  "        for (var j = 0; j < els.length; j++) { var kt = text(els[j].textContent); if (kt) return kt; }\n" +
  "      } catch (e) {}\n" +
  "      return text(head.textContent);\n" +
  "    }\n" +
  "    function namedSectionDescriptor(el) {");

spliceOne('named-section-labels',
  "        [el.id, el.getAttribute('name'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-component')].forEach(function (value) { if (text(value)) out.push(text(value)); });\n" +
  "        var heads = deepQueryAll(el, ':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > header,:scope > [role=\"heading\"]');\n" +
  "        " + LOOP_OLD,
  "        [el.id, el.getAttribute('name'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-component')].forEach(function (value) { if (text(value)) out.push(text(value)); });\n" +
  "        var heads = deepQueryAll(el, ':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > header,:scope > [role=\"heading\"]');\n" +
  "        " + LOOP_NEW);

spliceOne('direct-human-labels',
  "        if (el.labels && el.labels.length === 1 && text(el.labels[0].textContent)) out.push(text(el.labels[0].textContent));\n" +
  "        var heads = deepQueryAll(el, ':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > header,:scope > [role=\"heading\"]');\n" +
  "        " + LOOP_OLD,
  "        if (el.labels && el.labels.length === 1 && text(el.labels[0].textContent)) out.push(text(el.labels[0].textContent));\n" +
  "        var heads = deepQueryAll(el, ':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > header,:scope > [role=\"heading\"]');\n" +
  "        " + LOOP_NEW);

fs.writeFileSync(file, src, 'latin1');
console.log('het-1.1.5 spliced OK');

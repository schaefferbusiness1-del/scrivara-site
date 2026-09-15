'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
// 3.0.134: restorehome-1.1.0 (the restore retries the date navigation while the week strip has no day tabs yet); native persistence remains verified.
// 3.0.135: qpstrip-2.0.0 (a hidden athenaOne tab gets its own unfocused work window; dead solo/host lease fields deleted); native persistence remains verified.
// 3.0.136: navproof-diag-1.0.0 (the appointment-navigation refusal carries the opener diag and closed rejection counts); native persistence remains verified.
// 3.0.137: finddiag-1.0.0 + navaccept-1.0.0 (Find refusals carry rejection counts; a frame our click navigated with banner-grade exact name+DOB is accepted without the bound date); native persistence remains verified.
// 3.0.138: shadowbanner-1.0.0 (the write probe reads athena's 2026-09-02 shadow-DOM patient banner with the read path's strategies; exact pair unchanged); native persistence remains verified.
// 3.0.139: compound3-1.0.0 (a four-word name gets one more honest surname shape in Find; retries counted); native persistence remains verified.
// 3.0.140: legacysettle-1.0.0 (the classic day grid is read only after its row count holds across two looks; receipt carries the settle facts and a headings-only section census); native persistence remains verified.
// 3.0.141: qpstrip-2.1.0 (the work window is a desktop-width viewport, 1280-1500 px; below that athena prints a subset of a long day-grid section); native persistence remains verified.
// 3.0.142: legacyscroll-1.0.0 (athena's classic day grid lazy-loads on scroll; the legacy lane scrolls the list to its end before every look and reads after two agreeing looks; the 3.0.141 width theory is withdrawn in place); native persistence remains verified.
// 3.0.143: rowscroll-1.0.0 (the schedule-row opener's sweep considers div.appointments and waits once at the bottom for athena's lazy page); native persistence remains verified.
// 3.0.144: visitsshadow-1.0.0 (the visits driver reads athena's shadow-root banner first; the visits identity gate accepts the banner's other printed name, DOB exact) + rowveto-1.0.0 (problem/medication/history rows never form an encounter index); native persistence remains verified.
// 3.0.145: restorehome-1.2.0 (the exact-schedule re-ground retries the date navigation up to ten times, about 30 s, while the only answer is the empty week strip; the refusal diag counts the tries) + visitsalt-1.0.0 (a visits result identity carries the printed name the gate matched; the primary rides as namePrinted); native persistence remains verified.
// 3.0.146: qpsticky-1.0.0 (the quiet work window is handed back 30 s after the last verb, never per row; the next row's ensure keeps it); native persistence remains verified.
// 3.0.147: nowindow-1.0.0 (the quiet-pull work window is deleted: no window is created, moved, resized or focused; a hidden athenaOne tab is read where it is, selected in place only when that displaces nothing); native persistence remains verified.
// 3.0.148: legsdiag-1.0.0 (every refused chart-open answer names both legs' outcomes as closed codes: legFind, legSched, legOrder); native persistence remains verified.
// 3.0.149: findmrn-1.0.0 (on athena's Find results, exactly one row carrying the requested MRN with no contradicting DOB is the patient when no row passes the exact pair) + legsdiag-1.1.0 (refusals carry the Find counts) + nowindow-1.0.1 (module header comment); native persistence remains verified.
// 3.0.150: nofront-1.0.0 (reads never activate the athena tab or focus its window: the fronting function is a null stub and ensureBody never selects a tab); native persistence remains verified.
// 3.0.151: axlistdate-1.0.0 (the ax harvest carries the date printed beside each encounter link and the briefing path; the scoped-day decision falls back to it; the frame returns to the briefing after the encounter reads; an explicit empty on an encounter route is not an empty day) + findparticle-1.0.0 (two more Find shapes for a surname carrying a lowercase particle); native persistence remains verified.
// 3.0.152: axscoped-1.1.0 (a scoped day's population is the harvested in-day encounters plus every classic index row the harvest did not cover whose printed date is the day or unknown, plus any declared total beyond both; receipt counts them); native persistence remains verified.
// 3.0.153: findbydob-1.0.0 (after every name shape answers no-results, the open handler asks athena's Find once by date of birth; the driver's exact-pair/MRN row gate still decides)
// 3.0.154: findbydob-1.1.0 (the by-DOB rows' shapes travel as closed codes; gate untouched)
// 3.0.155: pollaccept-1.0.0 (DOB-exact banner ends the identity poll outside the bootstrap lease; poll codes) + findbydob-1.2.0 (shape histogram)
// 3.0.156: hoistfix-1.0.0 (the chart handler's block-level key copies deleted - they hoisted as undefined and failed every 3.0.155 read; the worker now holds one top-level copy)
// 3.0.157: findbydob-2.0.0 (one used-vs-legal by-DOB row opened; the banner gate decides) + axrefusals-1.0.0 (receipt names the refusing step)
// 3.0.158: findbydob-2.1.0 (a middle initial against the full middle name qualifies the used-name row; shape codes carry the middle relation)
assert.strictEqual(manifest.version, '3.0.158', 'regression must exercise the 3.0.158 candidate');
const coreSha = (manifest.version_name.match(/core-sha256:([0-9a-f]{64})/) || [])[1];
assert(coreSha, 'candidate manifest is missing its core hash');
const computedCoreSha = execFileSync(process.execPath, [path.join(root, 'scripts', 'extension-core-digest.js')], { encoding: 'utf8' }).trim();
assert.strictEqual(computedCoreSha, coreSha, 'candidate source/core hash drifted');

const begin = background.indexOf('function slateEditorValue(el)');
const end = background.indexOf('function editorFingerprint', begin);
assert(begin >= 0 && end > begin, 'shipped Slate reader functions not found');
const reader = new Function('noteNorm', `${background.slice(begin, end)}\nreturn { slateEditorValue, editorValue };`)(
  value => String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim()
);
assert(background.includes("initialNoteValue === null"), 'unreadable pre-write Slate state must refuse mutation');
assert(background.includes("preFocusNoteValue === null") && background.includes("focusedNoteValue === null"), 'all empty-only write checks must refuse unreadable state');

function element(tag, attrs, children) {
  const kids = (children || []).slice();
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), parentElement: null,
    firstChild: kids[0] || null,
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs || {}, name); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs || {}, name) ? attrs[name] : null; },
    querySelectorAll(selector) {
      const out = [];
      function match(x) {
        if (selector === '[data-slate-object="block"]') return x.nodeType === 1 && x.getAttribute('data-slate-object') === 'block';
        if (selector === '[data-slate-string="true"]') return x.nodeType === 1 && x.getAttribute('data-slate-string') === 'true';
        if (selector === '[data-slate-zero-width]') return x.nodeType === 1 && x.hasAttribute('data-slate-zero-width');
        if (selector === '[data-slate-object]') return x.nodeType === 1 && x.hasAttribute('data-slate-object');
        return false;
      }
      function walk(x) { if (!x) return; if (match(x)) out.push(x); if (x.nodeType === 1) for (let c = x.firstChild; c; c = c.nextSibling) walk(c); }
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
      return out;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  for (let i = 0; i < kids.length; i++) {
    kids[i].parentElement = node;
    kids[i].nextSibling = kids[i + 1] || null;
  }
  return node;
}
function text(value) { return { nodeType: 3, nodeValue: value, parentElement: null, nextSibling: null }; }
function leaf(parts) { return element('span', { 'data-slate-string': 'true' }, parts); }
function block(parts) { return element('div', { 'data-slate-object': 'block' }, parts); }
function editor(blocks) { const out = element('div', { 'data-slate-editor': 'true' }, blocks); out.isContentEditable = true; return out; }

const slate = editor([
  block([leaf([text('HPI exact')])]),
  block([leaf([text('ROS exact')])]),
  block([leaf([text('Exam'), element('br'), text('continued')])]),
  block([element('span', { 'data-slate-zero-width': 'n' }, [text('\uFEFF'), element('br')])]),
  block([leaf([text('real\uFEFFmarker')])])
]);
assert.strictEqual(reader.editorValue(slate), 'HPI exact\nROS exact\nExam\ncontinued\n\nreal\uFEFFmarker', 'Slate projection changed real block breaks or FEFF');

const unknown = element('div', { 'data-slate-editor': 'true' }, [block([element('span', {}, [text('unreadable')])])]);
unknown.isContentEditable = true;
unknown.innerText = 'unreadable';
assert.strictEqual(reader.editorValue(unknown), null, 'unknown Slate structure must not become an exact readback');

const nested = editor([block([block([leaf([text('nested')])])])]);
assert.strictEqual(reader.editorValue(nested), null, 'nested Slate blocks must refuse exact readback');

const wrongHost = element('div', {}, [block([leaf([text('wrong host')])])]);
wrongHost.isContentEditable = true;
assert.strictEqual(reader.editorValue(wrongHost), null, 'Slate projection must require the exact Slate host marker');

const exactHostWithoutBlocks = editor([]);
exactHostWithoutBlocks.innerText = 'unreadable';
assert.strictEqual(reader.editorValue(exactHostWithoutBlocks), null, 'exact Slate host without blocks must not fall back to innerText');

const directUnknown = editor([element('span', {}, [text('toolbar-like text')])]);
assert.strictEqual(reader.editorValue(directUnknown), null, 'unknown direct Slate child must refuse exact readback');

let mutationCount = 0;
function guardedEmptyOnlyWrite(target) {
  const current = reader.editorValue(target);
  if (current === null || current !== '') return false;
  mutationCount++;
  return true;
}
assert.strictEqual(guardedEmptyOnlyWrite(unknown), false, 'unreadable nonempty Slate state must be blocked before mutation');
assert.strictEqual(mutationCount, 0, 'unreadable Slate state reached the mutation seam');

console.log('PASS savenamed Slate editor reader: exact blocks, placeholder omission, real FEFF, inline break, and unknown-shape refusal');

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
// 3.0.132: restorediag-1.1.0 (the bridge forwards the closed per-frame restore evidence); native persistence remains verified.
assert.strictEqual(manifest.version, '3.0.132', 'regression must exercise the 3.0.132 candidate');
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

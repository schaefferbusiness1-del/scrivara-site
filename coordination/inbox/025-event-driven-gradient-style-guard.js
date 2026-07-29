'use strict';

const fs = require('fs');
const path = require('path');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text was ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const root = path.join(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const testPath = path.join(root, 'tests', 'interaction-performance-contract.test.js');

const originalConnect = fs.readFileSync(connectPath, 'latin1');
const originalTest = fs.readFileSync(testPath, 'utf8');

const patchedConnect = replaceOnce(
  originalConnect,
  [
    '  /* Belt-and-suspenders only: re-insert the stylesheet if some other module',
    '     ever wipes <head> children (nothing in this app does today, but several',
    '     other modules here defend against it the same way). No per-element work',
    '     needed -- this is a global stylesheet, so once present it covers every',
    '     current AND future matching element automatically. */',
    '  var iv = setInterval(ensureCss, 3000);',
    '',
    '  window.__mlsEz3Gradient_revert = function () {',
    '    safe(function () { clearInterval(iv); });'
  ].join('\n'),
  [
    '  /* 2026-07-29: this stylesheet already covers future body content. Watch',
    '     only direct head/root replacements so removal recovery stays immediate',
    '     without waking an unchanged tab every three seconds. */',
    '  var headObserver = null, observedHead = null;',
    '  function observeHead() {',
    '    if (!headObserver || !document.documentElement) { return; }',
    '    headObserver.disconnect();',
    '    observedHead = document.head || null;',
    '    headObserver.observe(document.documentElement, { childList: true });',
    '    if (observedHead) { headObserver.observe(observedHead, { childList: true }); }',
    '  }',
    '  safe(function () {',
    "    if (typeof MutationObserver !== 'function') { return; }",
    '    headObserver = new MutationObserver(function (records) {',
    '      var repair = document.head !== observedHead;',
    '      for (var i = 0; !repair && i < records.length; i++) {',
    '        if (records[i].target !== observedHead) { continue; }',
    '        var removed = records[i].removedNodes || [];',
    '        for (var j = 0; j < removed.length; j++) {',
    '          if (removed[j] && removed[j].id === STYLE_ID) { repair = true; break; }',
    '        }',
    '      }',
    '      if (document.head !== observedHead) { observeHead(); }',
    '      if (repair) { ensureCss(); }',
    '    });',
    '    observeHead();',
    '  });',
    '',
    '  window.__mlsEz3Gradient_revert = function () {',
    '    safe(function () { if (headObserver) { headObserver.disconnect(); } });'
  ].join('\n'),
  'replace permanent gradient style timer'
);

const patchedTest = replaceOnce(
  originalTest,
  [
    'assert(connect.includes("if (!c.birthdays) [].forEach.call(document.querySelectorAll(\'span,em,i,b,div\')"), \'visible birthdays still trigger a full-document classification scan every two seconds\');',
    'assert(app.includes("window.scrollTo({top:0,behavior:\'auto\'})"), \'view switches still fight an animated document scroll\');'
  ].join('\n'),
  [
    'assert(connect.includes("if (!c.birthdays) [].forEach.call(document.querySelectorAll(\'span,em,i,b,div\')"), \'visible birthdays still trigger a full-document classification scan every two seconds\');',
    '',
    'const gradientMarker = connect.indexOf("if (window.__mlsEz3Gradient) { return; }");',
    "const gradientStart = connect.lastIndexOf('(function () {', gradientMarker);",
    "const gradientEnd = connect.indexOf('/* =============================================================================\\n * __mlsEz3Flow', gradientMarker);",
    "assert(gradientMarker >= 0 && gradientStart >= 0 && gradientEnd > gradientMarker, 'gradient style owner slice is missing');",
    'const gradientSource = connect.slice(gradientStart, gradientEnd);',
    "assert(!gradientSource.includes('setInterval(ensureCss, 3000)'), 'gradient style guard still wakes every three seconds');",
    "assert(gradientSource.includes('headObserver.observe(document.documentElement, { childList: true })') && gradientSource.includes('headObserver.observe(observedHead, { childList: true })'), 'gradient style recovery is not scoped to direct head/root changes');",
    "assert(!gradientSource.includes('subtree: true'), 'gradient style recovery observes high-churn body descendants');",
    '',
    'let gradientIntervalCalls = 0;',
    'let gradientObserver = null;',
    'function GradientObserver(callback) { this.callback = callback; this.targets = []; gradientObserver = this; }',
    'GradientObserver.prototype.observe = function (target, options) { this.targets.push({ target, options }); };',
    'GradientObserver.prototype.disconnect = function () { this.targets = []; };',
    'GradientObserver.prototype.emit = function (records) { this.callback(records); };',
    'function gradientHead(label) {',
    '  return {',
    '    label, children: [],',
    '    appendChild(node) { node.parentNode = this; this.children.push(node); return node; },',
    '    removeChild(node) { const at = this.children.indexOf(node); if (at >= 0) this.children.splice(at, 1); node.parentNode = null; return node; }',
    '  };',
    '}',
    "const firstGradientHead = gradientHead('first');",
    'const gradientDocument = {',
    '  head: firstGradientHead,',
    '  documentElement: {},',
    "  createElement(tag) { return { tagName: String(tag).toUpperCase(), id: '', textContent: '', parentNode: null }; },",
    '  getElementById(id) { return (this.head && this.head.children || []).find(node => node.id === id) || null; }',
    '};',
    'const gradientWindow = { document: gradientDocument };',
    'gradientWindow.window = gradientWindow;',
    'vm.runInNewContext(gradientSource, {',
    '  window: gradientWindow, document: gradientDocument, MutationObserver: GradientObserver,',
    '  setInterval() { gradientIntervalCalls++; return gradientIntervalCalls; },',
    '  clearInterval() {}',
    "}, { filename: 'gradient-style-owner.js' });",
    "assert.strictEqual(gradientIntervalCalls, 0, 'gradient owner registered a permanent interval');",
    "let gradientStyle = gradientDocument.getElementById('mlsEz3GradientCss');",
    "assert(gradientStyle && gradientObserver, 'gradient style or scoped observer was not installed');",
    'firstGradientHead.removeChild(gradientStyle);',
    'gradientObserver.emit([{ target: firstGradientHead, removedNodes: [gradientStyle] }]);',
    "assert(gradientDocument.getElementById('mlsEz3GradientCss'), 'exact style removal was not repaired');",
    "const secondGradientHead = gradientHead('second');",
    'gradientDocument.head = secondGradientHead;',
    'gradientObserver.emit([{ target: gradientDocument.documentElement, removedNodes: [firstGradientHead], addedNodes: [secondGradientHead] }]);',
    "assert(gradientDocument.getElementById('mlsEz3GradientCss'), 'wholesale head replacement was not repaired');",
    'assert(gradientObserver.targets.some(entry => entry.target === secondGradientHead && entry.options.childList === true),',
    "  'style observer did not rebind to the replacement head');",
    'gradientWindow.__mlsEz3Gradient_revert();',
    "assert.strictEqual(gradientDocument.getElementById('mlsEz3GradientCss'), null, 'gradient revert left its style behind');",
    "assert.strictEqual(gradientObserver.targets.length, 0, 'gradient revert left its observer connected');",
    '',
    'assert(app.includes("window.scrollTo({top:0,behavior:\'auto\'})"), \'view switches still fight an animated document scroll\');'
  ].join('\n'),
  'add gradient lifecycle runtime proof'
);

fs.writeFileSync(connectPath, patchedConnect, 'latin1');
fs.writeFileSync(testPath, patchedTest, 'utf8');

console.log('Patched ' + connectPath);
console.log('Patched ' + testPath);

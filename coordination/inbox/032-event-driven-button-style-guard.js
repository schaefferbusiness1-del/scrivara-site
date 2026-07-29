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
    '  mount();',
    '  var iv = null;',
    '  try { iv = setInterval(mount, 3000); } catch (e) {}',
    '',
    '  window.__mlsBtnPolish = api;',
    '  window.__mlsBtnPolish_revert = function () {',
    '    try { if (iv) clearInterval(iv); } catch (e) {}'
  ].join('\n'),
  [
    '  mount();',
    '  /* 2026-07-29: the stylesheet already covers future body content. Watch',
    '     only direct head/root changes so exact removal recovery stays immediate',
    '     without waking an unchanged tab every three seconds. */',
    '  var styleObserver = null, observedHead = null;',
    '  function observeStyleHome() {',
    '    if (!styleObserver || !document.documentElement) return;',
    '    styleObserver.disconnect();',
    '    observedHead = document.head || null;',
    '    styleObserver.observe(document.documentElement, { childList: true });',
    '    if (observedHead) styleObserver.observe(observedHead, { childList: true });',
    '  }',
    '  try {',
    "    if (typeof MutationObserver === 'function') {",
    '      styleObserver = new MutationObserver(function (records) {',
    '        var repair = document.head !== observedHead;',
    '        for (var i = 0; !repair && i < records.length; i++) {',
    '          if (records[i].target !== observedHead) continue;',
    '          var removed = records[i].removedNodes || [];',
    '          for (var j = 0; j < removed.length; j++) {',
    '            if (removed[j] && removed[j].id === ID) { repair = true; break; }',
    '          }',
    '        }',
    '        if (document.head !== observedHead) observeStyleHome();',
    '        if (repair) mount();',
    '      });',
    '      observeStyleHome();',
    '    }',
    '  } catch (e) {}',
    '',
    '  window.__mlsBtnPolish = api;',
    '  window.__mlsBtnPolish_revert = function () {',
    '    try { if (styleObserver) styleObserver.disconnect(); } catch (e) {}'
  ].join('\n'),
  'replace permanent primary-button stylesheet timer'
);

const patchedTest = replaceOnce(
  originalTest,
  "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');",
  [
    '/* 2026-07-29: the primary-button stylesheet is global and follows only',
    ' * exact style removal or wholesale head replacement, not an idle timer. */',
    "const buttonPolishMarker = connect.indexOf(' * MLS Scribe - PRIMARY BUTTON POLISH');",
    "const buttonPolishStart = connect.indexOf('(function () {', buttonPolishMarker);",
    "const buttonPolishEnd = connect.indexOf('/* =========================================================================\\n * MLS Scribe - COPILOT PROVIDER-DATA GROUNDING', buttonPolishMarker);",
    "assert(buttonPolishMarker >= 0 && buttonPolishStart >= 0 && buttonPolishEnd > buttonPolishMarker, 'primary-button stylesheet owner slice is missing');",
    'const buttonPolishSource = connect.slice(buttonPolishStart, buttonPolishEnd);',
    "assert(!buttonPolishSource.includes('setInterval('), 'primary-button stylesheet still registers a permanent timer');",
    "assert(buttonPolishSource.includes('styleObserver.observe(document.documentElement, { childList: true })') &&",
    "  buttonPolishSource.includes('styleObserver.observe(observedHead, { childList: true })'),",
    "  'primary-button stylesheet recovery is not scoped to direct head/root changes');",
    "assert(!buttonPolishSource.includes('subtree: true'), 'primary-button stylesheet recovery observes high-churn descendants');",
    '',
    'let buttonPolishIntervals = 0;',
    'let buttonPolishReads = 0;',
    'let buttonPolishWrites = 0;',
    'let buttonPolishObserver = null;',
    'function ButtonPolishObserver(callback) { this.callback = callback; this.targets = []; buttonPolishObserver = this; }',
    'ButtonPolishObserver.prototype.observe = function (target, options) { this.targets.push({ target, options }); };',
    'ButtonPolishObserver.prototype.disconnect = function () { this.targets = []; };',
    'ButtonPolishObserver.prototype.emit = function (records) { this.callback(records); };',
    'function buttonPolishHead(label) {',
    '  return {',
    '    label, children: [],',
    '    appendChild(node) { buttonPolishWrites++; node.parentNode = this; this.children.push(node); return node; },',
    '    removeChild(node) { const at = this.children.indexOf(node); if (at >= 0) this.children.splice(at, 1); node.parentNode = null; return node; }',
    '  };',
    '}',
    "const firstButtonPolishHead = buttonPolishHead('first');",
    'const buttonPolishDocument = {',
    '  head: firstButtonPolishHead,',
    '  documentElement: {},',
    '  createElement(tag) {',
    "    return { tagName: String(tag).toUpperCase(), id: '', textContent: '', parentNode: null,",
    '      remove() { if (this.parentNode) this.parentNode.removeChild(this); } };',
    '  },',
    '  getElementById(id) {',
    '    buttonPolishReads++;',
    '    return (this.head && this.head.children || []).find(node => node.id === id) || null;',
    '  }',
    '};',
    'const buttonPolishWindow = {};',
    'buttonPolishWindow.window = buttonPolishWindow;',
    'vm.runInNewContext(buttonPolishSource, {',
    '  window: buttonPolishWindow, document: buttonPolishDocument, MutationObserver: ButtonPolishObserver,',
    '  setInterval() { buttonPolishIntervals++; return buttonPolishIntervals; },',
    '  clearInterval() {}',
    "}, { filename: 'event-driven-button-style-owner.js' });",
    "assert.strictEqual(buttonPolishIntervals, 0, 'primary-button stylesheet registered an idle interval at runtime');",
    "let buttonPolishStyle = buttonPolishDocument.getElementById('mlsBtnPolishCss');",
    "assert(buttonPolishStyle && buttonPolishObserver, 'primary-button style or scoped observer was not installed');",
    'buttonPolishReads = 0; buttonPolishWrites = 0;',
    "const unrelatedStyle = { id: 'synthetic-unrelated-style' };",
    'buttonPolishObserver.emit([{ target: firstButtonPolishHead, addedNodes: [unrelatedStyle], removedNodes: [] }]);',
    "assert.deepStrictEqual([buttonPolishReads, buttonPolishWrites], [0, 0], 'unrelated head additions triggered style reconciliation');",
    'firstButtonPolishHead.removeChild(buttonPolishStyle);',
    'buttonPolishObserver.emit([{ target: firstButtonPolishHead, addedNodes: [], removedNodes: [buttonPolishStyle] }]);',
    "assert(buttonPolishDocument.getElementById('mlsBtnPolishCss'), 'exact primary-button style removal was not repaired');",
    "const secondButtonPolishHead = buttonPolishHead('second');",
    'buttonPolishDocument.head = secondButtonPolishHead;',
    'buttonPolishObserver.emit([{ target: buttonPolishDocument.documentElement, addedNodes: [secondButtonPolishHead], removedNodes: [firstButtonPolishHead] }]);',
    "assert(buttonPolishDocument.getElementById('mlsBtnPolishCss'), 'wholesale head replacement was not repaired');",
    'assert(buttonPolishObserver.targets.some(entry => entry.target === secondButtonPolishHead && entry.options.childList === true),',
    "  'primary-button style observer did not rebind to the replacement head');",
    'buttonPolishWindow.__mlsBtnPolish_revert();',
    "assert.strictEqual(buttonPolishDocument.getElementById('mlsBtnPolishCss'), null, 'primary-button style revert left its style behind');",
    "assert.strictEqual(buttonPolishObserver.targets.length, 0, 'primary-button style revert left its observer connected');",
    '',
    "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');"
  ].join('\n'),
  'add primary-button stylesheet lifecycle runtime proof'
);

fs.writeFileSync(connectPath, patchedConnect, 'latin1');
fs.writeFileSync(testPath, patchedTest, 'utf8');

console.log('Patched ' + connectPath);
console.log('Patched ' + testPath);

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
  '  setInterval(function(){ sanitize(); wrap(); }, 3000);',
  [
    '  /* 2026-07-29: legacy data is normalized at boot and each Templates open.',
    '     Retry only wrapper discovery through the measured cold satellite tail. */',
    '  var retries=0, retryTimer=setInterval(function(){',
    '    wrap();',
    '    if(++retries>=10){ clearInterval(retryTimer); retryTimer=null; }',
    '  }, 3000);'
  ].join('\n'),
  'bound the template-keyword compatibility scrub'
);

const patchedTest = replaceOnce(
  originalTest,
  "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');",
  [
    '/* 2026-07-29: legacy template keywords are normalized at boot and when',
    ' * Templates opens; wrapper discovery is bounded past the cold asset tail. */',
    "const templateKeywordMarker = connect.indexOf('if(window.__mlsTplKwFix) return;');",
    "const templateKeywordStart = connect.lastIndexOf('(function(){', templateKeywordMarker);",
    "const templateKeywordEnd = connect.indexOf('\\n\\n(function(){', templateKeywordMarker);",
    "assert(templateKeywordMarker >= 0 && templateKeywordStart >= 0 && templateKeywordEnd > templateKeywordMarker, 'template-keyword compatibility owner slice is missing');",
    'const templateKeywordSource = connect.slice(templateKeywordStart, templateKeywordEnd);',
    "assert(!templateKeywordSource.includes('setInterval(function(){ sanitize(); wrap(); }, 3000)'),",
    "  'template-keyword compatibility still reparses every library forever');",
    "assert(templateKeywordSource.includes('if(++retries>=10){ clearInterval(retryTimer); retryTimer=null; }'),",
    "  'template-keyword wrapper discovery is not bounded to ten retries');",
    '',
    "const templateKeywordData = new Map([",
    "  ['synthetic:unrelated', 'x'],",
    "  ['synthetic:account::templates', JSON.stringify([{ id: 't1', keywords: 'one,two' }])]",
    ']);',
    'let templateKeywordKeyReads = 0;',
    'let templateKeywordGets = 0;',
    'let templateKeywordWrites = 0;',
    'let templateKeywordOpens = 0;',
    'let templateKeywordInterval = null;',
    'let templateKeywordDelay = 0;',
    'let templateKeywordClears = 0;',
    'const templateKeywordStorage = {',
    '  get length() { return templateKeywordData.size; },',
    '  key(index) { templateKeywordKeyReads++; return Array.from(templateKeywordData.keys())[index]; },',
    '  getItem(key) { templateKeywordGets++; return templateKeywordData.get(key) || null; },',
    '  setItem(key, value) { templateKeywordWrites++; templateKeywordData.set(key, String(value)); }',
    '};',
    'const templateKeywordWindow = {',
    '  localStorage: templateKeywordStorage,',
    '  openTemplates() { templateKeywordOpens++; }',
    '};',
    'templateKeywordWindow.window = templateKeywordWindow;',
    'vm.runInNewContext(templateKeywordSource, {',
    '  window: templateKeywordWindow,',
    "  document: { readyState: 'complete', addEventListener() {} },",
    '  localStorage: templateKeywordStorage,',
    '  setInterval(fn, delay) { templateKeywordInterval = fn; templateKeywordDelay = delay; return 71; },',
    '  clearInterval(id) { assert.strictEqual(id, 71); templateKeywordClears++; }',
    "}, { filename: 'bounded-template-keyword-scrub.js' });",
    "assert.strictEqual(templateKeywordDelay, 3000, 'template-keyword wrapper retry cadence changed');",
    "assert.strictEqual(typeof templateKeywordInterval, 'function', 'template-keyword wrapper retry was not installed');",
    "assert.deepStrictEqual(JSON.parse(templateKeywordData.get('synthetic:account::templates'))[0].keywords, ['one', 'two'],",
    "  'initial legacy keyword normalization changed');",
    "assert.strictEqual(templateKeywordWrites, 1, 'initial legacy keyword normalization did not write exactly once');",
    'templateKeywordKeyReads = 0; templateKeywordGets = 0; templateKeywordWrites = 0;',
    'for (let i = 0; i < 10; i++) templateKeywordInterval();',
    "assert.deepStrictEqual([templateKeywordKeyReads, templateKeywordGets, templateKeywordWrites], [0, 0, 0],",
    "  'wrapper retries still scan or rewrite template storage');",
    "assert.strictEqual(templateKeywordClears, 1, 'template-keyword wrapper retry did not retire at its bound');",
    'templateKeywordWindow.openTemplates();',
    "assert.strictEqual(templateKeywordOpens, 1, 'template opener wrapper did not preserve the original opener');",
    "assert(templateKeywordKeyReads > 0 && templateKeywordGets > 0, 'opening Templates no longer runs compatibility normalization');",
    '',
    "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');"
  ].join('\n'),
  'add bounded template-keyword scrub runtime proof'
);

fs.writeFileSync(connectPath, patchedConnect, 'latin1');
fs.writeFileSync(testPath, patchedTest, 'utf8');

console.log('Patched ' + connectPath);
console.log('Patched ' + testPath);

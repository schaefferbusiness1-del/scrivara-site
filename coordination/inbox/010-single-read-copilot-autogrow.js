'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const appPath = path.join(root, 'ScribeFlow.html');
const stagingPath = path.join(root, 'ScribeFlow-staging.html');
const testPath = path.join(root, 'tests', 'interaction-performance-contract.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const before = "function _copilotAutogrow(el){ if(!el) return; el.style.height='auto'; el.style.height=Math.min(150, el.height||0||el.scrollHeight)+'px'; el.style.height=Math.min(150, el.scrollHeight)+'px'; }";
const after = "function _copilotAutogrow(el){ if(!el) return; el.style.height='auto'; el.style.height=Math.min(150, el.scrollHeight)+'px'; }";

let app = fs.readFileSync(appPath, 'utf8');
let staging = fs.readFileSync(stagingPath, 'utf8');
let test = fs.readFileSync(testPath, 'utf8');

app = replaceExactlyOnce(app, before, after, 'production Copilot autogrow');
staging = replaceExactlyOnce(staging, before, after, 'staging Copilot autogrow');

test = replaceExactlyOnce(
  test,
  "const app = read('ScribeFlow.html');",
  "const app = read('ScribeFlow.html');\nconst stagingApp = read('ScribeFlow-staging.html');",
  'staging app performance fixture'
);

test = replaceExactlyOnce(
  test,
  "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');",
  "/* 2026-07-29: Copilot autogrow performs one required layout read per call. */\nfunction checkCopilotAutogrow(source, label, measuredHeight, expectedHeight) {\n  const start = source.indexOf('function _copilotAutogrow(el){');\n  const end = source.indexOf('\\n', start);\n  assert(start >= 0 && end > start, label + ' Copilot autogrow source is missing');\n  const fnSource = source.slice(start, end);\n  assert.strictEqual((fnSource.match(/scrollHeight/g) || []).length, 1,\n    label + ' Copilot autogrow performs more than one forced layout read');\n  assert(!fnSource.includes('el.height||0||el.scrollHeight'),\n    label + ' Copilot autogrow restored the overwritten middle assignment');\n  const ctx = {};\n  vm.runInNewContext(fnSource + ';this.autogrow=_copilotAutogrow;', ctx,\n    { filename: label + '-copilot-autogrow.js' });\n  let reads = 0;\n  const writes = [];\n  const style = {};\n  Object.defineProperty(style, 'height', {\n    configurable: true,\n    get() { return writes.length ? writes[writes.length - 1] : ''; },\n    set(value) { writes.push(value); }\n  });\n  const el = { style };\n  Object.defineProperty(el, 'scrollHeight', { get() { reads++; return measuredHeight; } });\n  ctx.autogrow(el);\n  assert.strictEqual(reads, 1, label + ' Copilot autogrow must read scrollHeight once');\n  assert.deepStrictEqual(writes, ['auto', expectedHeight + 'px'],\n    label + ' Copilot autogrow changed its reset/final height writes');\n}\ncheckCopilotAutogrow(app, 'production', 210, 150);\ncheckCopilotAutogrow(stagingApp, 'staging', 90, 90);\n\nconsole.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');",
  'Copilot autogrow forced-layout contract'
);

for (const pair of [['production', app], ['staging', staging]]) {
  const start = pair[1].indexOf('function _copilotAutogrow(el){');
  const end = pair[1].indexOf('\n', start);
  const fn = pair[1].slice(start, end);
  if (start < 0 || end <= start ||
      (fn.match(/scrollHeight/g) || []).length !== 1 ||
      fn.includes('el.height||0||el.scrollHeight')) {
    throw new Error(pair[0] + ' Copilot autogrow postcondition failed');
  }
}

fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(stagingPath, staging, 'utf8');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Reduced both Copilot autogrow functions to one layout read.');

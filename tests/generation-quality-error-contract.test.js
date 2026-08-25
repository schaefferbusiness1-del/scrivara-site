'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const propagationShells = [
  '1pScribeFlow.html',
  '1p/index.html',
  'ScribeFlow.html',
  'cloned/index.html',
  'ScribeFlow-staging.html'
];

for (const shell of propagationShells) {
  const shellSource = fs.readFileSync(path.join(root, shell), 'utf8');
  assert.match(shellSource, /Array\.isArray\(j&&j\.issues\)/,
    shell + ' /api/generate failure path must read backend machine-readable issues');
  assert.match(shellSource, /eGen\.mlsAi\.issues=issueList\.map/,
    shell + ' must keep backend quality issues attached to the generation error');
}
assert.match(source, /id="genError"[^>]*role="alert"/,
  'generation needs an inline accessible failure surface beside Generate');
assert.match(source, /id="noteGenError"[^>]*role="alert"/,
  'the always-visible Clinical note card needs its own accessible failure surface');
assert.match(source, /\['genError','noteGenError'\]\.forEach/,
  'generation failures must reach both the Generate controls and the visible Clinical note card');

const start = source.indexOf('function mlsDraftFailureMessage(');
const end = source.indexOf('function _mlsValidateStructuredNoteResult(', start);
assert(start >= 0 && end > start, 'could not isolate the quality-error formatter');
const context = {};
vm.runInNewContext(source.slice(start, end), context, { filename: '1pScribeFlow.html:quality-error' });
assert.strictEqual(typeof context.mlsDraftFailureMessage, 'function');

const message = context.mlsDraftFailureMessage({
  mlsAi: {
    code: 'draft_quality_failed',
    issues: ['empty_soap_ros', 'unsupported_soap_wrapper', 'not-safe-to-display <transcript>'],
  },
});
assert.match(message, /ROS section was empty/, 'empty section code was not made actionable');
assert.match(message, /unsupported SOAP wrapper/, 'wrapper code was not made actionable');
assert(!message.includes('not-safe-to-display'), 'untrusted backend issue text leaked into the inline message');
assert(!message.includes('<transcript>'), 'inline quality error must not expose arbitrary response text');

const fallback = context.mlsDraftFailureMessage({ mlsAi: { code: 'draft_quality_failed', issues: [] } });
assert.match(fallback, /Nothing changed/, 'quality failure fallback must explicitly preserve the draft');
assert.match(fallback, /Retry Generate/, 'quality failure fallback must give a safe retry action');

console.log('PASS generation quality error: backend issue codes survive safely and are shown beside Generate');

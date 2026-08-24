'use strict';

/* Causal regression for the exact Easy Visit "Generate one note" click path.
 * The wrapper must reject low-information text before it stamps generation or
 * clicks the hidden ScribeFlow button; otherwise the phase watcher replaces
 * the useful sparse-evidence refusal with its generic connection warning. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '1p-mls-connect.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(__dirname, '..', '1pScribeFlow.html'), 'utf8');

function extractFunction(text, marker) {
  const at = text.indexOf(marker);
  assert(at >= 0, 'missing shipped function: ' + marker);
  const open = text.indexOf('{', at);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error('unbalanced shipped function: ' + marker);
}

const marker = "on('ez3Gen', function () {";
const start = source.indexOf(marker);
assert(start >= 0, 'canonical Easy Visit ez3Gen handler is missing');
const fnStart = source.indexOf('function () {', start);
let depth = 0, quote = '', escaped = false, end = -1;
for (let i = fnStart + 'function '.length; i < source.length; i += 1) {
  const ch = source[i];
  if (quote) {
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === quote) quote = '';
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
  if (ch === '{') depth += 1;
  else if (ch === '}' && --depth === 0) { end = i + 1; break; }
}
assert(end > fnStart, 'canonical ez3Gen handler is unbalanced');

let clicked = 0, generated = 0, visibleWarning = '', focused = false;
const transcript = { value: 'the patient is idne' };
const hiddenGenerate = { click() { clicked += 1; } };
const sandbox = {
  S: { appt: { id: 'appt-1' }, phase: 'idle', genClickedAt: 0, signedAt: 0, lastWarn: '' },
  $: id => id === 'transcript' ? transcript : (id === 'genBtn' ? hiddenGenerate : null),
  toast: () => { throw new Error('sparse path must not use a generic toast'); },
  requireExactScheduledBinding: () => true,
  genBtnResolve: () => hiddenGenerate,
  render: () => { visibleWarning = sandbox.S.lastWarn; },
  Date
};
vm.runInNewContext(
  extractFunction(shellSource, 'function _mlsTranscriptHasDraftableTodayEvidence(text)') +
    '\nthis._mlsTranscriptHasDraftableTodayEvidence = _mlsTranscriptHasDraftableTodayEvidence;',
  sandbox,
  { filename: '1pScribeFlow.html' }
);
vm.runInNewContext('this.handler = ' + source.slice(fnStart, end), sandbox, { filename: '1p-mls-connect.js' });
sandbox.handler();

assert.strictEqual(clicked, 0, 'sparse click dispatched the hidden generation button');
assert.strictEqual(generated, 0, 'sparse click dispatched generation');
assert.strictEqual(sandbox.S.genClickedAt, 0, 'sparse click stamped a generation start');
assert.strictEqual(sandbox.S.phase, 'stopped', 'sparse click did not stay stopped');
assert.strictEqual(transcript.value, 'the patient is idne', 'sparse click altered the transcript');
assert(visibleWarning.includes('Add one specific detail from today'), 'actionable sparse warning was not rendered');
assert(!visibleWarning.includes('The note was not generated'), 'generic connection warning replaced sparse warning');
console.log('PASS 1p-easy-generate-sparse-runtime: exact sparse click path is fail-closed and actionable');

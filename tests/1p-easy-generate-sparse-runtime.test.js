'use strict';

/* Causal regression for facade ownership. The visible Easy control delegates
 * exactly once and never claims started/refused itself; the shipped engine is
 * the only lifecycle owner (fully executed in generate-note-lifecycle). */
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

let clicked = 0, renders = 0;
const transcript = { value: 'the patient is idne' };
const hiddenGenerate = { click() { clicked += 1; } };
const sandbox = {
  S: { appt: { id: 'appt-1' }, phase: 'idle', genClickedAt: 0, signedAt: 0, lastWarn: '' },
  $: id => id === 'transcript' ? transcript : (id === 'genBtn' ? hiddenGenerate : null),
  toast: () => { throw new Error('non-empty facade path must not diagnose generation'); },
  requireExactScheduledBinding: () => true,
  genBtnResolve: () => hiddenGenerate,
  render: () => { renders += 1; },
  Date
};
vm.runInNewContext('this.handler = ' + source.slice(fnStart, end), sandbox, { filename: '1p-mls-connect.js' });
sandbox.handler();

assert.strictEqual(clicked, 1, 'visible facade did not delegate exactly once to the hidden engine');
assert.strictEqual(sandbox.S.genClickedAt, 0, 'visible facade stamped a generation start before engine evidence checks');
assert.strictEqual(sandbox.S.phase, 'idle', 'visible facade changed generation phase before an engine event');
assert.strictEqual(transcript.value, 'the patient is idne', 'sparse click altered the transcript');
assert.strictEqual(sandbox.S.lastWarn, '', 'visible facade invented a refusal/connection diagnosis');
assert.strictEqual(renders, 1, 'visible facade did not repaint after engine delegation');
assert(!source.includes('noteGenerationStarted: function ()'), 'legacy facade lifecycle owner still ships');

const exactRefusal = 'Add one specific detail from today—symptom, exam finding, assessment, or plan—before generating. Nothing from old chart history will be invented.';
const lifecycleSandbox = {
  S: { phase: 'idle', genClickedAt: 0, signedAt: 0, lastWarn: '', generationRunId: 0 },
  isRecording: () => false,
  noteText: () => '',
  $: () => ({ disabled: false }),
  bindingNotice() {},
  render() {},
  Date, Number, String
};
vm.runInNewContext([
  extractFunction(source, 'function computePhase()'),
  extractFunction(source, 'function onGenerationStarted(ev)'),
  extractFunction(source, 'function onGenerationRefused(ev)'),
  extractFunction(source, 'function onGenerationSettled(ev)'),
  'this.api={computePhase,onGenerationStarted,onGenerationRefused,onGenerationSettled};'
].join('\n'), lifecycleSandbox, { filename: '1p-easy-generation-lifecycle.js' });
lifecycleSandbox.api.onGenerationRefused({ detail: { runId: 7, code: 'sparse-today-evidence', message: exactRefusal } });
lifecycleSandbox.api.onGenerationSettled({ detail: { runId: 7, status: 'refused', code: 'sparse-today-evidence', message: exactRefusal } });
lifecycleSandbox.api.computePhase();
assert.strictEqual(lifecycleSandbox.S.genClickedAt, 0, 'engine refusal retained a fake in-flight timestamp');
assert.strictEqual(lifecycleSandbox.S.phase, 'stopped', 'engine refusal did not leave the visible control retryable');
assert.strictEqual(lifecycleSandbox.S.lastWarn, exactRefusal, 'phase fallback replaced the exact refusal');
assert(!lifecycleSandbox.S.lastWarn.includes('connection'), 'phase fallback invented a connection failure');
console.log('PASS 1p-easy-generate-sparse-runtime: visible facade delegates once and never fabricates lifecycle state');

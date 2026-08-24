'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html', 'cloned/index.html'];

for (const shell of shells) {
  const source = fs.readFileSync(path.join(root, shell), 'utf8');
  const start = source.indexOf('async function copilotTweak');
  const end = source.indexOf('function copilotCopyArtifact', start);
  assert(start >= 0 && end > start, `${shell}: copilotTweak is missing`);
  const tweak = source.slice(start, end);
  assert.match(tweak, /JSON\.stringify\(\{artifact:cur,instruction:instruction,kind:kind,family:'copilot',draftTuning:/,
    `${shell}: edit requests must identify the Copilot family`);
}

// Execute the production handler so this contract checks the serialized body,
// not only the source spelling of the request object.
const appSource = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const tweakStart = appSource.indexOf('async function copilotTweak');
const tweakEnd = appSource.indexOf('function copilotCopyArtifact', tweakStart);
const nodes = {
  cArt_0: { value: 'Current draft', style: {} },
  cTw_0: { value: 'Make it shorter', style: {} },
  cTwBtn_0: { disabled: false, textContent: '' },
};
let posted = null;
const context = {
  Promise, JSON, String, Math,
  _copilotHistory: [{ artifact: { kind: 'letter', content: 'Current draft' } }],
  document: { getElementById(id) { return nodes[id] || null; } },
  backendMode() { return true; },
  bkToken() { return 'synthetic-token'; },
  bkBase() { return 'https://example.test'; },
  _mlsAiFault() { return ''; },
  _copilotAutogrowArtifact() {},
  _copilotSaveHist() {},
  window: {
    __mlsEnsureDraftTuning() { return Promise.resolve(); },
    __mlsDraftTuning: { installed: true, forFamily() { return { schemaVersion: 1, family: 'copilot', answerShape: 'brief_then_detail' }; } },
  },
  toast() {},
  fetch(_url, options) {
    posted = JSON.parse(options.body);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ text: 'Revised draft' }) });
  },
};
vm.createContext(context);
vm.runInContext(appSource.slice(tweakStart, tweakEnd), context, { filename: 'ScribeFlow-copilot-edit.js' });
context.copilotTweak(0).then(() => {
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), {
    artifact: 'Current draft',
    instruction: 'Make it shorter',
    kind: 'letter',
    family: 'copilot',
    draftTuning: { schemaVersion: 1, family: 'copilot', answerShape: 'brief_then_detail' },
  });

  // Preserve the existing local analytics action normalization shortcut.
  const normalizeStart = appSource.indexOf('function _copilotTopPatientsByVisits');
  const normalizeEnd = appSource.indexOf('function _copilotRenderThread', normalizeStart);
  const normalizeContext = { Array, String, Object, RegExp };
  vm.createContext(normalizeContext);
  vm.runInContext(appSource.slice(normalizeStart, normalizeEnd), normalizeContext,
    { filename: 'ScribeFlow-copilot-analytics.js' });
  assert.deepEqual(JSON.parse(JSON.stringify(
    normalizeContext._copilotNormalizeActions('Who are my top patients by visit count?', undefined),
  )), [{ label: 'View Top Patients', kind: 'navigate', arg: 'patients' }]);
  console.log('PASS Copilot edit family transport and local analytics shortcut');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});

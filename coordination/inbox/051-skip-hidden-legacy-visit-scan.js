'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath, encoding) {
  return fs.readFileSync(path.join(root, relativePath), encoding);
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source anchor is missing');
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': expected source anchor is ambiguous');
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

const files = {
  visits: { path: 'feat_visits.js', encoding: 'utf8' },
  production: { path: 'mls-connect.js', encoding: 'latin1' },
  staging: { path: 'mls-connect.staging.js', encoding: 'latin1' },
  performance: { path: path.join('tests', 'performance-lifecycle-contract.test.js'), encoding: 'utf8' },
  fullReader: { path: path.join('tests', 'full-visit-reader-runtime.test.js'), encoding: 'utf8' },
  dupe: { path: path.join('tests', 'visit-index-dupe-collapse.test.js'), encoding: 'utf8' },
  provenance: { path: path.join('tests', 'visit-history-provenance-chip.test.js'), encoding: 'utf8' },
  cache: { path: path.join('tests', 'immutable-satellite-loader-cache-contract.test.js'), encoding: 'utf8' }
};

const outputs = {};
for (const [key, file] of Object.entries(files)) {
  outputs[key] = read(file.path, file.encoding);
}

outputs.visits = replaceOnce(
  outputs.visits,
  "  function render(force) {\n    var card = host(); if (!card) { _lastSig = ''; return; }\n",
  "  function render(force) {\n    if (!force && document.getElementById('mlsVisitHistoryExt')) return;\n    var card = host(); if (!card) { _lastSig = ''; return; }\n",
  files.visits.path + ' enhanced-owner guard'
);

for (const key of ['production', 'staging']) {
  outputs[key] = replaceOnce(
    outputs[key],
    'feat_visits.js?v=20260728vis10',
    'feat_visits.js?v=20260729vis11',
    files[key].path + ' immutable visit token'
  );
}

outputs.performance = replaceOnce(
  outputs.performance,
  "const path = require('path');\n",
  "const path = require('path');\nconst vm = require('vm');\n",
  files.performance.path + ' VM dependency'
);

outputs.performance = replaceOnce(
  outputs.performance,
  "const legal = read('feat_mls_legal_paywidget.js');\n",
  `/* 2026-07-29: the enhanced visit-history owner hides the legacy history
   section. Its exact node must short-circuit the legacy 900 ms heartbeat before
   profile visibility and visit-array work, while removal restores fallback. */
const visits = read('feat_visits.js');
const visitHostStart = visits.indexOf('  function host() {');
const visitHostEnd = visits.indexOf('  function activeP()', visitHostStart);
const visitRenderStart = visits.indexOf('  function render(force) {', visitHostEnd);
const visitRenderEnd = visits.indexOf('\\n  function start()', visitRenderStart);
assert(visitHostStart >= 0 && visitHostEnd > visitHostStart &&
  visitRenderStart > visitHostEnd && visitRenderEnd > visitRenderStart,
  'legacy visit-history runtime boundaries are missing');
const visitHostSource = visits.slice(visitHostStart, visitHostEnd);
const visitRenderSource = visits.slice(visitRenderStart, visitRenderEnd);
assert(visitRenderSource.includes("if (!force && document.getElementById('mlsVisitHistoryExt')) return;"),
  'legacy visit-history heartbeat does not stand down behind the enhanced owner');

let visitLayoutReads = 0;
let visitGetCalls = 0;
let visitRowsScanned = 0;
const syntheticVisits = Array.from({ length: 100 }, (_, index) => ({
  id: 'synthetic-visit-' + index,
  aiSummary: index % 2 ? 'summary' : ''
}));
const syntheticPatient = { id: 'synthetic-patient', visits: syntheticVisits };
const profileCard = {};
Object.defineProperty(profileCard, 'offsetParent', {
  get() { visitLayoutReads += 1; return {}; }
});
const visitNodes = new Map([
  ['profileCard', profileCard],
  ['mlsVisitHistory', {}],
  ['mlsVisitHistoryExt', {}]
]);
const visitModel = {
  deriveFromLegacy() {},
  getVisits() {
    visitGetCalls += 1;
    visitRowsScanned += syntheticVisits.length;
    return syntheticVisits.slice();
  }
};
const visitRuntime = {
  document: { getElementById(id) { return visitNodes.get(id) || null; } },
  M() { return visitModel; },
  activeP() { return syntheticPatient; },
  css() { throw new Error('unchanged fallback signature unexpectedly rebuilt'); },
  visitCard() {},
  _lastSig: ''
};
vm.runInNewContext(visitHostSource + '\\n' + visitRenderSource, visitRuntime, { timeout: 1000 });
visitRuntime.render(false);
assert.strictEqual(visitGetCalls, 0, 'hidden legacy history still scanned visits');
assert.strictEqual(visitRowsScanned, 0, 'hidden legacy history still walked visit rows');
assert.strictEqual(visitLayoutReads, 0, 'hidden legacy history still forced a profile visibility read');

visitNodes.delete('mlsVisitHistoryExt');
visitRuntime._lastSig = syntheticPatient.id + ':' + syntheticVisits.length + ':' +
  syntheticVisits.map(visit => visit.id + (visit.aiSummary ? '1' : '0')).join(',');
visitRuntime.render(false);
assert.strictEqual(visitGetCalls, 1, 'legacy history did not resume after enhanced-owner removal');
assert.strictEqual(visitRowsScanned, 100, 'legacy history fallback did not inspect the exact synthetic visit set');
assert.strictEqual(visitLayoutReads, 1, 'legacy history fallback did not recheck profile visibility');

const legal = read('feat_mls_legal_paywidget.js');
`,
  files.performance.path + ' hidden legacy visit proof'
);

for (const key of ['fullReader', 'dupe', 'provenance']) {
  outputs[key] = replaceOnce(
    outputs[key],
    'feat_visits.js?v=20260728vis10',
    'feat_visits.js?v=20260729vis11',
    files[key].path + ' visit token pin'
  );
}

outputs.cache = replaceOnce(
  outputs.cache,
  "  ['feat_mls_upnow_realtime.js', '20260723unr110', '20260626unr1c1']\n",
  "  ['feat_mls_upnow_realtime.js', '20260723unr110', '20260626unr1c1'],\n  ['feat_visits.js', '20260729vis11', '20260728vis10']\n",
  files.cache.path + ' changed visit satellite pin'
);

for (const [key, file] of Object.entries(files)) {
  fs.writeFileSync(path.join(root, file.path), outputs[key], file.encoding);
}

console.log('Applied proposal 051: hidden legacy visit history skips its data-scale heartbeat; immutable token and pins advanced.');

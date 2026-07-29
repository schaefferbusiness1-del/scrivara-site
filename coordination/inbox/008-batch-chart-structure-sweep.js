'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const testPath = path.join(root, 'tests', 'patient-scale-perf-contract.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let connect = fs.readFileSync(connectPath, 'latin1');
let test = fs.readFileSync(testPath, 'utf8');

connect = replaceExactlyOnce(
  connect,
  '  function sweepPatient(p) {',
  '  function sweepPatient(p, deferPersist) {',
  'chart sweep deferred-persist parameter'
);

connect = replaceExactlyOnce(
  connect,
  "    if (changed) upsert(p);\n    return changed;\n  }\n  function sweep() {",
  "    if (changed && !deferPersist) upsert(p);\n    return changed;\n  }\n  function persistSweep(ps, dirty) {\n    if (!dirty || !dirty.length) return;\n    var stamp = Date.now(), saved = false;\n    for (var s = 0; s < dirty.length; s++) { if (dirty[s]) dirty[s].updated = stamp; }\n    try { if (isFn(window.savePatients)) { window.savePatients(ps); saved = true; } } catch (e) {}\n    if (!saved) { for (var i = 0; i < dirty.length; i++) upsert(dirty[i]); return; }\n    for (var j = 0; j < dirty.length; j++) { try { if (isFn(window.syncPatientToServer)) window.syncPatientToServer(dirty[j]); } catch (e2) {} }\n  }\n  function sweep() {",
  'chart sweep batch persistence helper'
);

connect = replaceExactlyOnce(
  connect,
  "      if (document.hidden) return;\n      try {\n        var vNow = (window.__mlsStoreCache && typeof window.__mlsStoreCache.ver === 'function') ? window.__mlsStoreCache.ver() : -1;",
  "      if (document.hidden) return;\n      /* 2026-07-29: wait for pull ownership to clear before stamping a version. */\n      try {\n        var busyAt = Number(window.__mlsPullBusyAt || 0);\n        var pulling = (busyAt && (Date.now() - busyAt) < 10000) ||\n          !!(window.__mlsDayHistoryPull && window.__mlsDayHistoryPull.state && window.__mlsDayHistoryPull.state.running);\n        if (pulling) return;\n      } catch (eBusy) {}\n      try {\n        var vNow = (window.__mlsStoreCache && typeof window.__mlsStoreCache.ver === 'function') ? window.__mlsStoreCache.ver() : -1;",
  'chart sweep pull-busy gate'
);

connect = replaceExactlyOnce(
  connect,
  "      var ps = getPatients(); if (!ps.length) return;\n      var touched = 0;\n      for (var i = 0; i < ps.length; i++) {\n        if (needsWork(ps[i])) { if (sweepPatient(ps[i])) touched++; }\n      }\n      STATS.sweepPasses++;\n      if (touched) {\n        try { console.log('[MLS chart-structure] structured ' + touched + ' patient record' + (touched === 1 ? '' : 's')); } catch (e) {}",
  "      var ps = getPatients(); if (!ps.length) return;\n      var touched = 0, dirty = [];\n      for (var i = 0; i < ps.length; i++) {\n        if (needsWork(ps[i])) {\n          var priorStructured = ps[i]._mlsStructuredV1;\n          if (sweepPatient(ps[i], true)) { touched++; dirty.push(ps[i]); }\n          else ps[i]._mlsStructuredV1 = priorStructured;\n        }\n      }\n      STATS.sweepPasses++;\n      if (touched) {\n        persistSweep(ps, dirty);\n        try { console.log('[MLS chart-structure] structured ' + touched + ' patient record' + (touched === 1 ? '' : 's')); } catch (e) {}",
  'automatic chart sweep batch'
);

connect = replaceExactlyOnce(
  connect,
  "    restructureAll: function () {\n      var ps = getPatients(), n = 0;\n      for (var i = 0; i < ps.length; i++) { ps[i]._mlsStructuredV1 = 0; if (needsWork(ps[i]) && sweepPatient(ps[i])) n++; }\n      try { if (isFn(window.renderProfile)) window.renderProfile(); } catch (e) {}\n      return n;\n    },",
  "    restructureAll: function () {\n      var ps = getPatients(), n = 0, dirty = [];\n      for (var i = 0; i < ps.length; i++) {\n        var priorStructured = ps[i]._mlsStructuredV1; ps[i]._mlsStructuredV1 = 0;\n        if (needsWork(ps[i]) && sweepPatient(ps[i], true)) { n++; dirty.push(ps[i]); }\n        else ps[i]._mlsStructuredV1 = priorStructured;\n      }\n      persistSweep(ps, dirty);\n      try { if (isFn(window.renderProfile)) window.renderProfile(); } catch (e) {}\n      return n;\n    },",
  'manual chart restructure batch'
);

test = replaceExactlyOnce(
  test,
  "assert(connect.includes('cleanRuns >= 5'), 'sanitize self-retire threshold changed unexpectedly');",
  "assert(connect.includes('cleanRuns >= 5'), 'sanitize self-retire threshold changed unexpectedly');\n\n/* ---------- 6c. chart structuring persists one outer batch ---------- */\nconst chartStart = connect.indexOf(\"try { if (window.__mlsChartStructure && window.__mlsChartStructure.version === '1.1.0') return; }\");\nconst chartEnd = connect.indexOf('window.__mlsChartStructure_revert = function ()', chartStart);\nassert(chartStart >= 0 && chartEnd > chartStart, 'Chart Structure slice is missing');\nconst chartStructure = connect.slice(chartStart, chartEnd);\nassert(!chartStructure.includes('if (changed) upsert(p);'),\n  'automatic chart structuring returned to one full-store upsert per patient');\nassert.strictEqual((chartStructure.match(/sweepPatient\\(ps\\[i\\], true\\)/g) || []).length, 2,\n  'automatic and manual Chart Structure callers must both defer row persistence');\nassert.strictEqual((chartStructure.match(/persistSweep\\(ps, dirty\\);/g) || []).length, 2,\n  'automatic and manual Chart Structure callers must both persist one outer batch');\nassert.strictEqual((chartStructure.match(/else ps\\[i\\]\\._mlsStructuredV1 = priorStructured;/g) || []).length, 2,\n  'a shared outer save must restore unchanged rows before persisting the batch');\nassert.strictEqual((chartStructure.match(/window\\.savePatients\\(ps\\)/g) || []).length, 1,\n  'Chart Structure must have exactly one normal-path batch save');\nconst chartSweepStart = chartStructure.indexOf('function sweep() {');\nconst chartVersionStamp = chartStructure.indexOf('STATS.lastSweepVer = vNow;', chartSweepStart);\nconst chartBusyReturn = chartStructure.indexOf('if (pulling) return;', chartSweepStart);\nassert(chartBusyReturn >= 0 && chartBusyReturn < chartVersionStamp,\n  'Chart Structure must not stamp a pull-busy store version as clean');\n\nconst persistStart = chartStructure.indexOf('function persistSweep(ps, dirty) {');\nconst persistEnd = chartStructure.indexOf('\\n  function sweep() {', persistStart);\nassert(persistStart >= 0 && persistEnd > persistStart, 'Chart Structure batch helper is missing');\nconst persistCtx = { saveCalls: 0, syncCalls: 0, upsertCalls: 0, window: {}, Date };\npersistCtx.window.savePatients = function (rows) { persistCtx.saveCalls++; persistCtx.savedRows = rows; };\npersistCtx.window.syncPatientToServer = function () { persistCtx.syncCalls++; };\nvm.createContext(persistCtx);\nvm.runInContext(\n  \"var isFn=function(f){return typeof f==='function';};\" +\n  'var upsert=function(){upsertCalls++;};' +\n  chartStructure.slice(persistStart, persistEnd) +\n  ';this.persistSweep=persistSweep;',\n  persistCtx, { filename: 'chart-structure-batch.js' });\nconst chartDirty = Array.from({ length: 8 }, function (_, i) {\n  return { id: 'synthetic-' + i, problems: 'Synthetic problem', meds: 'Synthetic medication',\n    proof: { sentinel: i }, visits: [{ date: '2026-07-01', raw: 'Synthetic visit' }] };\n});\npersistCtx.persistSweep(chartDirty, chartDirty.slice());\nassert.strictEqual(persistCtx.saveCalls, 1, 'eight chart repairs must produce one local save');\nassert.strictEqual(persistCtx.upsertCalls, 0, 'normal batch path must produce zero per-row upserts');\nassert.strictEqual(persistCtx.syncCalls, 8, 'every dirty chart row must retain its server mirror');\nchartDirty.forEach(function (p, i) {\n  assert(Number(p.updated) > 0 && p.proof.sentinel === i && p.visits.length === 1 && p.problems && p.meds,\n    'batch persistence changed a clinical/proof field or failed to stamp updated');\n});",
  'Chart Structure outer-batch contract'
);

test = replaceExactlyOnce(
  test,
  `chartDirty.forEach(function (p, i) {
  assert(Number(p.updated) > 0 && p.proof.sentinel === i && p.visits.length === 1 && p.problems && p.meds,
    'batch persistence changed a clinical/proof field or failed to stamp updated');
});`,
  `chartDirty.forEach(function (p, i) {
  assert(Number(p.updated) > 0 && p.proof.sentinel === i && p.visits.length === 1 && p.problems && p.meds,
    'batch persistence changed a clinical/proof field or failed to stamp updated');
});

persistCtx.saveCalls = 0; persistCtx.syncCalls = 0; persistCtx.upsertCalls = 0;
persistCtx.window.savePatients = function () {
  persistCtx.saveCalls++;
  throw new Error('synthetic save refusal');
};
persistCtx.persistSweep(chartDirty, chartDirty.slice());
assert.deepStrictEqual(
  { save: persistCtx.saveCalls, sync: persistCtx.syncCalls, upsert: persistCtx.upsertCalls },
  { save: 1, sync: 0, upsert: 8 },
  'throwing Chart Structure batch did not fall back without duplicate mirrors');

persistCtx.saveCalls = 0; persistCtx.syncCalls = 0; persistCtx.upsertCalls = 0;
delete persistCtx.window.savePatients;
persistCtx.persistSweep(chartDirty, chartDirty.slice());
assert.deepStrictEqual(
  { save: persistCtx.saveCalls, sync: persistCtx.syncCalls, upsert: persistCtx.upsertCalls },
  { save: 0, sync: 0, upsert: 8 },
  'missing Chart Structure batch API did not fall back without duplicate mirrors');`,
  'Chart Structure batch fallback runtime contract'
);

const chartStart = connect.indexOf("try { if (window.__mlsChartStructure && window.__mlsChartStructure.version === '1.1.0') return; }");
const chartEnd = connect.indexOf('window.__mlsChartStructure_revert = function ()', chartStart);
const chart = connect.slice(chartStart, chartEnd);
if (chartStart < 0 || chartEnd <= chartStart ||
    chart.includes('if (changed) upsert(p);') ||
    (chart.match(/sweepPatient\(ps\[i\], true\)/g) || []).length !== 2 ||
    (chart.match(/persistSweep\(ps, dirty\);/g) || []).length !== 2 ||
    (chart.match(/else ps\[i\]\._mlsStructuredV1 = priorStructured;/g) || []).length !== 2 ||
    (chart.match(/window\.savePatients\(ps\)/g) || []).length !== 1) {
  throw new Error('Chart Structure outer-batch postcondition failed');
}
const sweepStart = chart.indexOf('function sweep() {');
const busyReturn = chart.indexOf('if (pulling) return;', sweepStart);
const versionStamp = chart.indexOf('STATS.lastSweepVer = vNow;', sweepStart);
if (busyReturn < 0 || versionStamp < 0 || busyReturn > versionStamp) {
  throw new Error('Chart Structure busy-gate ordering postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Batched automatic and manual Chart Structure persistence.');

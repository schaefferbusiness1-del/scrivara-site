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
const testPath = path.join(root, 'tests', 'patient-scale-perf-contract.test.js');

let connect = fs.readFileSync(connectPath, 'latin1');
let test = fs.readFileSync(testPath, 'utf8');

connect = replaceOnce(
  connect,
  [
    '  function getPatients() { try { return isFn(window.getPatients) ? (window.getPatients() || []) : []; } catch (e) { return []; } }',
    '  function upsert(p) { try { if (isFn(window.upsertPatient)) window.upsertPatient(p); } catch (e) {} }',
    '',
    '  /* ---------- section-header dictionary ----------'
  ].join('\n'),
  [
    '  function getPatients() { try { return isFn(window.getPatients) ? (window.getPatients() || []) : []; } catch (e) { return []; } }',
    '  function upsert(p) {',
    '    try { if (isFn(window.upsertPatient)) { window.upsertPatient(p); return true; } } catch (e) {}',
    '    return false;',
    '  }',
    '',
    '  /* ---------- section-header dictionary ----------'
  ].join('\n'),
  'make Chart Structure fallback observable'
);

connect = replaceOnce(
  connect,
  [
    '  function addStructuredVisits(p, visits) {',
    '    if (!visits || !visits.length) return 0;',
    '    var M = window.__mlsVisitModel;',
    '    if (!M || !isFn(M.addVisit)) return 0;',
    '    var n = 0;',
    '    visits.forEach(function (v) {',
    "      try { M.addVisit(p.id, { date: v.date, type: v.type || 'Office visit', raw: v.raw }, { source: 'athena-copy', persist: false }); n++; } catch (e) {}",
    '    });',
    "    /* b121 clobber fix: the live honest addVisit drops our persist:false and writes each visit to localStorage via its own re-fetched clone; the caller's p is a SEPARATE stale clone whose later upsert(p) would wipe them. Re-adopt the freshly-persisted .visits onto p. */",
    '    if (n) { try { var _ps = getPatients(); for (var _i = 0; _i < _ps.length; _i++) { if (_ps[_i] && _ps[_i].id === p.id) { if (Array.isArray(_ps[_i].visits)) p.visits = _ps[_i].visits; break; } } } catch (e) {} }',
    '    return n;',
    '  }'
  ].join('\n'),
  [
    '  function addStructuredVisits(p, visits, isolateSource) {',
    '    if (!visits || !visits.length) return 0;',
    '    var M = window.__mlsVisitModel;',
    '    if (!M || !isFn(M.addVisit)) return 0;',
    '    var sourceRow = null, sourceHadVisits = false, sourceVisits = null;',
    '    if (isolateSource) {',
    '      try {',
    '        var beforeRows = getPatients();',
    '        for (var bi = 0; bi < beforeRows.length; bi++) {',
    '          if (beforeRows[bi] && beforeRows[bi].id === p.id) {',
    '            sourceRow = beforeRows[bi];',
    "            sourceHadVisits = Object.prototype.hasOwnProperty.call(sourceRow, 'visits');",
    '            sourceVisits = Array.isArray(sourceRow.visits) ? cloneSweepPatient(sourceRow.visits) : sourceRow.visits;',
    '            if (Array.isArray(sourceRow.visits) && !sourceVisits) return 0;',
    '            break;',
    '          }',
    '        }',
    '      } catch (eBefore) { return 0; }',
    '    }',
    '    var n = 0;',
    '    try {',
    '      visits.forEach(function (v) {',
    "        try { M.addVisit(p.id, { date: v.date, type: v.type || 'Office visit', raw: v.raw }, { source: 'athena-copy', persist: false }); n++; } catch (e) {}",
    '      });',
    '      /* 2026-07-29: deferred sweeps mutate an isolated patient candidate.',
    '         Re-adopt an isolated visit array, then restore the cache source. */',
    '      if (n) {',
    '        try {',
    '          var _ps = getPatients();',
    '          for (var _i = 0; _i < _ps.length; _i++) {',
    '            if (_ps[_i] && _ps[_i].id === p.id) {',
    '              if (Array.isArray(_ps[_i].visits)) {',
    '                var adoptedVisits = isolateSource ? cloneSweepPatient(_ps[_i].visits) : _ps[_i].visits;',
    '                if (adoptedVisits) p.visits = adoptedVisits; else n = 0;',
    '              }',
    '              break;',
    '            }',
    '          }',
    '        } catch (eAdopt) {}',
    '      }',
    '    } finally {',
    '      if (sourceRow && sourceRow !== p) {',
    "        try { if (sourceHadVisits) sourceRow.visits = sourceVisits; else delete sourceRow.visits; } catch (eRestore) {}",
    '      }',
    '    }',
    '    return n;',
    '  }'
  ].join('\n'),
  'isolate Chart Structure visit-model side effects'
);

connect = replaceOnce(
  connect,
  [
    '  function applyToPatient(p, rawText, keepStampFrom) {',
    '    var struct = structureChartText(rawText);'
  ].join('\n'),
  [
    '  function applyToPatient(p, rawText, keepStampFrom, isolateVisits) {',
    '    var struct = structureChartText(rawText);'
  ].join('\n'),
  'carry the visit-isolation mode'
);

connect = replaceOnce(
  connect,
  "    if (addStructuredVisits(p, struct.visits)) changed = true;",
  "    if (addStructuredVisits(p, struct.visits, isolateVisits)) changed = true;",
  'isolate model visits only for deferred sweeps'
);

connect = replaceOnce(
  connect,
  '    var changed = applyToPatient(p, source, p.summary);',
  '    var changed = applyToPatient(p, source, p.summary, deferPersist === true);',
  'request visit isolation from deferred sweeps'
);

connect = replaceOnce(
  connect,
  [
    '  function persistSweep(ps, dirty) {',
    '    if (!dirty || !dirty.length) return;',
    '    var stamp = Date.now(), saved = false;',
    '    for (var s = 0; s < dirty.length; s++) { if (dirty[s]) dirty[s].updated = stamp; }',
    '    try { if (isFn(window.savePatients)) { window.savePatients(ps); saved = true; } } catch (e) {}',
    '    if (!saved) { for (var i = 0; i < dirty.length; i++) upsert(dirty[i]); return; }',
    '    for (var j = 0; j < dirty.length; j++) { try { if (isFn(window.syncPatientToServer)) window.syncPatientToServer(dirty[j]); } catch (e2) {} }',
    '  }'
  ].join('\n'),
  [
    '  function cloneSweepPatient(p) {',
    '    /* 2026-07-29: stored patient rows are JSON data. Never mutate a',
    '       shallow cache alias before the outer store write succeeds. */',
    '    try { return JSON.parse(JSON.stringify(p)); } catch (e) { return null; }',
    '  }',
    '  function markSweepSaveFailure() {',
    "    try { STATS.lastSweepVer = (window.__mlsStoreCache && typeof window.__mlsStoreCache.ver === 'function') ? window.__mlsStoreCache.ver() : null; }",
    '    catch (e) { STATS.lastSweepVer = null; }',
    '  }',
    '  function persistSweep(ps, dirty) {',
    '    if (!dirty || !dirty.length) return true;',
    '    var stamp = Date.now(), batchAvailable = isFn(window.savePatients);',
    '    for (var s = 0; s < dirty.length; s++) { if (dirty[s]) dirty[s].updated = stamp; }',
    '    if (batchAvailable) {',
    '      try { window.savePatients(ps); }',
    '      catch (e) {',
    '        /* 2026-07-29: one rejected whole-store save must never fan out',
    '           into one whole-store compression per structured patient. */',
    '        markSweepSaveFailure();',
    '        return false;',
    '      }',
    '    } else {',
    '      for (var i = 0; i < dirty.length; i++) {',
    '        if (!upsert(dirty[i])) { markSweepSaveFailure(); return false; }',
    '      }',
    '      return true;',
    '    }',
    '    for (var j = 0; j < dirty.length; j++) { try { if (isFn(window.syncPatientToServer)) window.syncPatientToServer(dirty[j]); } catch (e2) {} }',
    '    return true;',
    '  }'
  ].join('\n'),
  'stop Chart Structure failed-batch fan-out'
);

connect = replaceOnce(
  connect,
  '        if (vNow === STATS.lastSweepVer && STATS.sweepPasses > 0) return;',
  '        if (vNow === STATS.lastSweepVer && STATS.lastSweepVer != null) return;',
  'gate Chart Structure after a failed first pass'
);

connect = replaceOnce(
  connect,
  [
    '      var touched = 0, dirty = [];',
    '      for (var i = 0; i < ps.length; i++) {',
    '        if (needsWork(ps[i])) {',
    '          var priorStructured = ps[i]._mlsStructuredV1;',
    '          if (sweepPatient(ps[i], true)) { touched++; dirty.push(ps[i]); }',
    '          else ps[i]._mlsStructuredV1 = priorStructured;',
    '        }',
    '      }',
    '      STATS.sweepPasses++;',
    '      if (touched) {',
    '        persistSweep(ps, dirty);',
    "        try { console.log('[MLS chart-structure] structured ' + touched + ' patient record' + (touched === 1 ? '' : 's')); } catch (e) {}",
    '        try { if (isFn(window.renderProfile)) window.renderProfile(); } catch (e) {}',
    '        try { if (window.__mlsVisitUI && isFn(window.__mlsVisitUI.render)) window.__mlsVisitUI.render(true); } catch (e) {}',
    '      }'
  ].join('\n'),
  [
    '      var touched = 0, dirty = [], structuredBefore = STATS.structured;',
    '      for (var i = 0; i < ps.length; i++) {',
    '        if (needsWork(ps[i])) {',
    '          var candidate = cloneSweepPatient(ps[i]);',
    '          if (!candidate) continue;',
    '          var priorStructured = candidate._mlsStructuredV1;',
    '          if (sweepPatient(candidate, true)) { ps[i] = candidate; touched++; dirty.push(candidate); }',
    '          else candidate._mlsStructuredV1 = priorStructured;',
    '        }',
    '      }',
    '      if (touched) {',
    '        if (!persistSweep(ps, dirty)) { STATS.structured = structuredBefore; return; }',
    "        try { console.log('[MLS chart-structure] structured ' + touched + ' patient record' + (touched === 1 ? '' : 's')); } catch (e) {}",
    '        try { if (isFn(window.renderProfile)) window.renderProfile(); } catch (e) {}',
    '        try { if (window.__mlsVisitUI && isFn(window.__mlsVisitUI.render)) window.__mlsVisitUI.render(true); } catch (e) {}',
    '      }',
    '      STATS.sweepPasses++;'
  ].join('\n'),
  'isolate and honestly complete automatic Chart Structure'
);

connect = replaceOnce(
  connect,
  [
    '      var ps = getPatients(), n = 0, dirty = [];',
    '      for (var i = 0; i < ps.length; i++) {',
    '        var priorStructured = ps[i]._mlsStructuredV1; ps[i]._mlsStructuredV1 = 0;',
    '        if (needsWork(ps[i]) && sweepPatient(ps[i], true)) { n++; dirty.push(ps[i]); }',
    '        else ps[i]._mlsStructuredV1 = priorStructured;',
    '      }',
    '      persistSweep(ps, dirty);',
    '      try { if (isFn(window.renderProfile)) window.renderProfile(); } catch (e) {}',
    '      return n;'
  ].join('\n'),
  [
    '      var ps = getPatients(), n = 0, dirty = [], structuredBefore = STATS.structured;',
    '      for (var i = 0; i < ps.length; i++) {',
    '        var candidate = cloneSweepPatient(ps[i]);',
    '        if (!candidate) continue;',
    '        var priorStructured = candidate._mlsStructuredV1; candidate._mlsStructuredV1 = 0;',
    '        if (needsWork(candidate) && sweepPatient(candidate, true)) { ps[i] = candidate; n++; dirty.push(candidate); }',
    '        else candidate._mlsStructuredV1 = priorStructured;',
    '      }',
    '      if (!persistSweep(ps, dirty)) { STATS.structured = structuredBefore; return 0; }',
    '      try { if (isFn(window.renderProfile)) window.renderProfile(); } catch (e) {}',
    '      return n;'
  ].join('\n'),
  'isolate and honestly complete manual Chart Structure'
);

test = replaceOnce(
  test,
  [
    "assert.strictEqual((chartStructure.match(/sweepPatient\\(ps\\[i\\], true\\)/g) || []).length, 2,",
    "  'automatic and manual Chart Structure callers must both defer row persistence');",
    "assert.strictEqual((chartStructure.match(/persistSweep\\(ps, dirty\\);/g) || []).length, 2,",
    "  'automatic and manual Chart Structure callers must both persist one outer batch');",
    "assert.strictEqual((chartStructure.match(/else ps\\[i\\]\\._mlsStructuredV1 = priorStructured;/g) || []).length, 2,",
    "  'a shared outer save must restore unchanged rows before persisting the batch');"
  ].join('\n'),
  [
    "assert.strictEqual((chartStructure.match(/sweepPatient\\(candidate, true\\)/g) || []).length, 2,",
    "  'automatic and manual Chart Structure callers must both defer row persistence');",
    "assert.strictEqual((chartStructure.match(/var candidate = cloneSweepPatient\\(ps\\[i\\]\\);/g) || []).length, 2,",
    "  'Chart Structure callers do not isolate cached row objects before mutation');",
    "assert.strictEqual((chartStructure.match(/ps\\[i\\] = candidate;/g) || []).length, 2,",
    "  'Chart Structure callers do not publish isolated candidates into the batch array');",
    "assert.strictEqual((chartStructure.match(/!persistSweep\\(ps, dirty\\)/g) || []).length, 2,",
    "  'automatic and manual Chart Structure callers must both guard one outer batch');",
    "assert.strictEqual((chartStructure.match(/else candidate\\._mlsStructuredV1 = priorStructured;/g) || []).length, 2,",
    "  'isolated Chart Structure candidates must restore unchanged stamps before discard');",
    "assert(chartStructure.includes('addStructuredVisits(p, struct.visits, isolateVisits)') &&",
    "  chartStructure.includes('applyToPatient(p, source, p.summary, deferPersist === true)'),",
    "  'deferred Chart Structure does not isolate visit-model side effects');"
  ].join('\n'),
  'pin isolated Chart Structure callers'
);

test = replaceOnce(
  test,
  [
    'const chartVersionStamp = chartStructure.indexOf(\'STATS.lastSweepVer = vNow;\', chartSweepStart);',
    "const chartBusyReturn = chartStructure.indexOf('if (pulling) return;', chartSweepStart);",
    'assert(chartBusyReturn >= 0 && chartBusyReturn < chartVersionStamp,',
    "  'Chart Structure must not stamp a pull-busy store version as clean');"
  ].join('\n'),
  [
    'const chartVersionStamp = chartStructure.indexOf(\'STATS.lastSweepVer = vNow;\', chartSweepStart);',
    "const chartBusyReturn = chartStructure.indexOf('if (pulling) return;', chartSweepStart);",
    'assert(chartBusyReturn >= 0 && chartBusyReturn < chartVersionStamp,',
    "  'Chart Structure must not stamp a pull-busy store version as clean');",
    "assert(chartStructure.includes('if (vNow === STATS.lastSweepVer && STATS.lastSweepVer != null) return;'),",
    "  'Chart Structure first-pass failure is not protected from same-version retry churn');",
    "const chartPersistGuard = chartStructure.indexOf('if (!persistSweep(ps, dirty)) { STATS.structured = structuredBefore; return; }', chartSweepStart);",
    "const chartPassCompletion = chartStructure.indexOf('STATS.sweepPasses++;', chartPersistGuard);",
    'assert(chartPersistGuard > chartVersionStamp && chartPassCompletion > chartPersistGuard,',
    "  'Chart Structure records a failed persistence pass as completed');"
  ].join('\n'),
  'pin Chart Structure retry and completion gates'
);

test = replaceOnce(
  test,
  [
    "const persistStart = chartStructure.indexOf('function persistSweep(ps, dirty) {');",
    "const persistEnd = chartStructure.indexOf('\\n  function sweep() {', persistStart);",
    "assert(persistStart >= 0 && persistEnd > persistStart, 'Chart Structure batch helper is missing');"
  ].join('\n'),
  [
    "const cloneSweepStart = chartStructure.indexOf('function cloneSweepPatient(p) {');",
    "const persistStart = chartStructure.indexOf('function persistSweep(ps, dirty) {', cloneSweepStart);",
    "const persistEnd = chartStructure.indexOf('\\n  function sweep() {', persistStart);",
    "assert(cloneSweepStart >= 0 && persistStart > cloneSweepStart && persistEnd > persistStart,",
    "  'Chart Structure isolation or batch helper is missing');"
  ].join('\n'),
  'extract Chart Structure isolation with persistence'
);

test = replaceOnce(
  test,
  [
    "const persistCtx = { saveCalls: 0, syncCalls: 0, upsertCalls: 0, window: {}, Date };",
    "persistCtx.window.savePatients = function (rows) { persistCtx.saveCalls++; persistCtx.savedRows = rows; };",
    "persistCtx.window.syncPatientToServer = function () { persistCtx.syncCalls++; };",
    'vm.createContext(persistCtx);',
    'vm.runInContext(',
    '  "var isFn=function(f){return typeof f===\'function\';};" +',
    "  'var upsert=function(){upsertCalls++;};' +",
    '  chartStructure.slice(persistStart, persistEnd) +',
    "  ';this.persistSweep=persistSweep;',",
    "  persistCtx, { filename: 'chart-structure-batch.js' });",
    'const chartDirty = Array.from({ length: 8 }, function (_, i) {',
    "  return { id: 'synthetic-' + i, problems: 'Synthetic problem', meds: 'Synthetic medication',",
    "    proof: { sentinel: i }, visits: [{ date: '2026-07-01', raw: 'Synthetic visit' }] };",
    '});',
    'persistCtx.persistSweep(chartDirty, chartDirty.slice());',
    "assert.strictEqual(persistCtx.saveCalls, 1, 'eight chart repairs must produce one local save');",
    "assert.strictEqual(persistCtx.upsertCalls, 0, 'normal batch path must produce zero per-row upserts');",
    "assert.strictEqual(persistCtx.syncCalls, 8, 'every dirty chart row must retain its server mirror');",
    'chartDirty.forEach(function (p, i) {',
    '  assert(Number(p.updated) > 0 && p.proof.sentinel === i && p.visits.length === 1 && p.problems && p.meds,',
    "    'batch persistence changed a clinical/proof field or failed to stamp updated');",
    '});'
  ].join('\n'),
  [
    'function runChartPersistence(mode) {',
    "  const ctx = { mode, storeVersion: 7, saveCalls: 0, syncCalls: 0, upsertCalls: 0, STATS: { lastSweepVer: 6 }, window: {}, Date };",
    '  ctx.window.__mlsStoreCache = { ver() { return ctx.storeVersion; } };',
    "  if (mode !== 'absent' && mode !== 'absentThrow') {",
    '    ctx.window.savePatients = function (rows) {',
    '      ctx.saveCalls++; ctx.savedRows = rows;',
    "      if (mode === 'throw') { ctx.storeVersion++; throw new Error('synthetic batch refusal'); }",
    '    };',
    '  }',
    '  ctx.window.syncPatientToServer = function () { ctx.syncCalls++; };',
    '  vm.createContext(ctx);',
    '  vm.runInContext(',
    '    "var isFn=function(f){return typeof f===\'function\';};" +',
    "    'var upsert=function(){upsertCalls++;if(mode===\\'absentThrow\\'){storeVersion++;return false;}return true;};' +",
    '    chartStructure.slice(cloneSweepStart, persistEnd) +',
    "    ';this.persistSweep=persistSweep;this.cloneSweepPatient=cloneSweepPatient;',",
    "    ctx, { filename: 'chart-structure-batch.js' });",
    '  const dirty = Array.from({ length: 8 }, function (_, i) {',
    "    return { id: 'synthetic-' + i, problems: 'Synthetic problem', meds: 'Synthetic medication',",
    "      proof: { sentinel: i }, visits: [{ date: '2026-07-01', raw: 'Synthetic visit' }] };",
    '  });',
    '  const ok = ctx.persistSweep(dirty, dirty.slice());',
    '  return { ctx, dirty, ok };',
    '}',
    "const chartSaved = runChartPersistence('save');",
    "assert.strictEqual(chartSaved.ok, true, 'Chart Structure successful batch did not report success');",
    "assert.deepStrictEqual([chartSaved.ctx.saveCalls, chartSaved.ctx.upsertCalls, chartSaved.ctx.syncCalls], [1, 0, 8],",
    "  'eight chart repairs did not produce one local save plus eight server mirrors');",
    'chartSaved.dirty.forEach(function (p, i) {',
    '  assert(Number(p.updated) > 0 && p.proof.sentinel === i && p.visits.length === 1 && p.problems && p.meds,',
    "    'batch persistence changed a clinical/proof field or failed to stamp updated');",
    '});',
    "const chartThrown = runChartPersistence('throw');",
    "assert.strictEqual(chartThrown.ok, false, 'Chart Structure throwing batch did not report failure');",
    "assert.deepStrictEqual([chartThrown.ctx.saveCalls, chartThrown.ctx.upsertCalls, chartThrown.ctx.syncCalls], [1, 0, 0],",
    "  'Chart Structure throwing batch fanned out into per-row full-store writes');",
    "assert.strictEqual(chartThrown.ctx.STATS.lastSweepVer, 8,",
    "  'Chart Structure failure did not settle on the post-failure store version');",
    "const chartAbsent = runChartPersistence('absent');",
    "assert.strictEqual(chartAbsent.ok, true, 'Chart Structure absent batch API lost its compatibility fallback');",
    "assert.deepStrictEqual([chartAbsent.ctx.saveCalls, chartAbsent.ctx.upsertCalls, chartAbsent.ctx.syncCalls], [0, 8, 0],",
    "  'Chart Structure absent batch API did not retain its per-row fallback');",
    "const chartAbsentThrow = runChartPersistence('absentThrow');",
    "assert.strictEqual(chartAbsentThrow.ok, false, 'Chart Structure failing compatibility writer reported success');",
    "assert.deepStrictEqual([chartAbsentThrow.ctx.saveCalls, chartAbsentThrow.ctx.upsertCalls, chartAbsentThrow.ctx.syncCalls], [0, 1, 0],",
    "  'Chart Structure repeated a failing compatibility writer across dirty rows');",
    "assert.strictEqual(chartAbsentThrow.ctx.STATS.lastSweepVer, 8,",
    "  'Chart Structure compatibility failure did not settle its version gate');",
    '',
    "const addVisitsStart = chartStructure.indexOf('function addStructuredVisits(p, visits, isolateSource) {');",
    "const addVisitsEnd = chartStructure.indexOf('\\n\\n  /* ---------- compose the new summary', addVisitsStart);",
    "const cloneSweepEnd = chartStructure.indexOf('\\n  function markSweepSaveFailure()', cloneSweepStart);",
    "assert(addVisitsStart >= 0 && addVisitsEnd > addVisitsStart && cloneSweepEnd > cloneSweepStart,",
    "  'Chart Structure visit-isolation helpers could not be extracted');",
    "const sourcePatient = { id: 'synthetic-cache-row', visits: [{ date: '2026-07-01', type: 'Stored visit', raw: 'Stored synthetic body' }] };",
    'const sourceBefore = JSON.stringify(sourcePatient);',
    'const visitIsolationCtx = { window: {}, rows: [sourcePatient], JSON, Object };',
    'visitIsolationCtx.window.__mlsVisitModel = {',
    '  addVisit(patientId, visit, opts) {',
    "    assert.strictEqual(patientId, 'synthetic-cache-row');",
    "    assert.strictEqual(opts.persist, false, 'isolated visit add changed persistence mode');",
    '    sourcePatient.visits.push({ date: visit.date, type: visit.type, raw: visit.raw });',
    '    return sourcePatient.visits[sourcePatient.visits.length - 1];',
    '  }',
    '};',
    'vm.createContext(visitIsolationCtx);',
    'vm.runInContext(',
    '  "var isFn=function(f){return typeof f===\'function\';};var getPatients=function(){return rows.slice();};" +',
    '  chartStructure.slice(addVisitsStart, addVisitsEnd) +',
    '  chartStructure.slice(cloneSweepStart, cloneSweepEnd) +',
    "  ';this.addStructuredVisits=addStructuredVisits;this.cloneSweepPatient=cloneSweepPatient;',",
    "  visitIsolationCtx, { filename: 'chart-visit-isolation.js' });",
    'const isolatedCandidate = visitIsolationCtx.cloneSweepPatient(sourcePatient);',
    'const isolatedCount = visitIsolationCtx.addStructuredVisits(isolatedCandidate,',
    "  [{ date: '2026-07-02', type: 'Synthetic follow up', raw: 'New synthetic body' }], true);",
    "assert.strictEqual(isolatedCount, 1, 'isolated Chart Structure visit was not adopted');",
    "assert.strictEqual(JSON.stringify(sourcePatient), sourceBefore, 'failed-sweep cache source was mutated by visit adoption');",
    "assert.strictEqual(isolatedCandidate.visits.length, 2, 'isolated candidate lost the structured visit');",
    "assert.notStrictEqual(isolatedCandidate.visits, sourcePatient.visits, 'isolated candidate retained the cache visit-array alias');",
    "assert.notStrictEqual(isolatedCandidate.visits[0], sourcePatient.visits[0], 'isolated candidate retained nested visit aliases');"
  ].join('\n'),
  'prove Chart Structure persistence and cache isolation'
);

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Patched ' + connectPath);
console.log('Patched ' + testPath);

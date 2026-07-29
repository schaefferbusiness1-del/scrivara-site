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
    '      if (fixed) {',
    '        var saved = false, fallbackOk = false;',
    "        try { if (typeof window.savePatients === 'function') { window.savePatients(ps); saved = true; } } catch (e) {}",
    '        if (!saved) {',
    "          fallbackOk = typeof window.upsertPatient === 'function';",
    '          if (fallbackOk) {',
    '            for (var u = 0; u < dirty.length; u++) { try { window.upsertPatient(dirty[u]); } catch (eUpsert) { fallbackOk = false; } }',
    '          }',
    '          if (!fallbackOk) { try { if (st8) st8.lastScrubVer = null; } catch (eReset) {} return; }',
    '        } else {',
    "          for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }",
    '        }'
  ].join('\n'),
  [
    '      if (fixed) {',
    "        var saved = false, batchAvailable = typeof window.savePatients === 'function', fallbackOk = false;",
    '        if (batchAvailable) {',
    '          try { window.savePatients(ps); saved = true; }',
    '          catch (eBatch) {',
    '            /* 2026-07-29: one rejected batch already attempted the whole',
    '               store. Never repeat that compression once per dirty row. */',
    "            try { if (st8) st8.lastScrubVer = (window.__mlsStoreCache && typeof window.__mlsStoreCache.ver === 'function') ? window.__mlsStoreCache.ver() : null; } catch (eReset) {}",
    '            return;',
    '          }',
    '        }',
    '        if (!saved) {',
    "          fallbackOk = typeof window.upsertPatient === 'function';",
    '          if (fallbackOk) {',
    '            for (var u = 0; u < dirty.length; u++) { try { window.upsertPatient(dirty[u]); } catch (eUpsert) { fallbackOk = false; } }',
    '          }',
    '          if (!fallbackOk) { try { if (st8) st8.lastScrubVer = null; } catch (eFallbackReset) {} return; }',
    '        } else {',
    "          for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }",
    '        }'
  ].join('\n'),
  'stop Continuous Scrub failed-batch fan-out'
);

connect = replaceOnce(
  connect,
  [
    '  var scrubbed = false;',
    '  function scrubExisting() {',
    '    if (scrubbed) return;'
  ].join('\n'),
  [
    '  var scrubbed = false, saveFailed = false;',
    '  function scrubExisting() {',
    '    if (scrubbed || saveFailed) return;'
  ].join('\n'),
  'latch a failed base scrub save'
);

connect = replaceOnce(
  connect,
  [
    '      if (fixed) {',
    '        var saved = false, fallbackOk = false;',
    "        try { if (typeof window.savePatients === 'function') { window.savePatients(ps); saved = true; } } catch (e) {}",
    '        if (!saved) {',
    "          fallbackOk = typeof window.upsertPatient === 'function';",
    '          if (fallbackOk) {',
    '            for (var u = 0; u < dirty.length; u++) { try { window.upsertPatient(dirty[u]); } catch (eUpsert) { fallbackOk = false; } }',
    '          }',
    '          if (!fallbackOk) return;',
    '        } else {',
    "          for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }",
    '        }',
    '      }'
  ].join('\n'),
  [
    '      if (fixed) {',
    "        var saved = false, batchAvailable = typeof window.savePatients === 'function', fallbackOk = false;",
    '        if (batchAvailable) {',
    '          try { window.savePatients(ps); saved = true; }',
    '          catch (eBatch) {',
    '            /* 2026-07-29: Continuous Scrub owns the next change-driven',
    '               retry. This startup owner must not compress once per row. */',
    '            saveFailed = true;',
    '            return;',
    '          }',
    '        }',
    '        if (!saved) {',
    "          fallbackOk = typeof window.upsertPatient === 'function';",
    '          if (fallbackOk) {',
    '            for (var u = 0; u < dirty.length; u++) { try { window.upsertPatient(dirty[u]); } catch (eUpsert) { fallbackOk = false; } }',
    '          }',
    '          if (!fallbackOk) return;',
    '        } else {',
    "          for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }",
    '        }',
    '      }'
  ].join('\n'),
  'stop base Summary Sanitize failed-batch fan-out'
);

connect = replaceOnce(
  connect,
  "  try { setTimeout(function () { if (scrubbed && _iv) { clearInterval(_iv); _iv = null; } }, 45000); } catch (e) {}",
  "  try { setTimeout(function () { if ((scrubbed || saveFailed) && _iv) { clearInterval(_iv); _iv = null; } }, 45000); } catch (e) {}",
  'retire the base scrub timer after a save failure'
);

connect = replaceOnce(
  connect,
  "  window.__mlsSummarySanitize = { version: '1.0.0', strip: stripChartCode, hasCode: hasCode, _scrub: function () { scrubbed = false; scrubExisting(); } };",
  "  window.__mlsSummarySanitize = { version: '1.0.0', strip: stripChartCode, hasCode: hasCode, _scrub: function () { scrubbed = false; saveFailed = false; scrubExisting(); } };",
  'preserve an explicit base scrub retry'
);

test = replaceOnce(
  test,
  [
    "assert(continuousScrub.includes('fallbackOk = typeof window.upsertPatient') &&",
    "  continuousScrub.includes('window.upsertPatient(dirty[u])'),",
    "  'Continuous Scrub lacks a per-row fallback after a failed batch save');"
  ].join('\n'),
  [
    "assert(continuousScrub.includes(\"batchAvailable = typeof window.savePatients === 'function'\") &&",
    "  continuousScrub.includes('if (!saved)') && continuousScrub.includes('window.upsertPatient(dirty[u])'),",
    "  'Continuous Scrub lost its compatibility fallback for an absent batch API');",
    "assert(continuousScrub.includes('catch (eBatch)') && continuousScrub.includes('st8.lastScrubVer ='),",
    "  'Continuous Scrub does not stop and settle its version after a throwing batch');"
  ].join('\n'),
  'pin Continuous Scrub failure split'
);

test = replaceOnce(
  test,
  [
    "assert(baseSanitize.includes('fallbackOk = typeof window.upsertPatient') &&",
    "  baseSanitize.includes('window.upsertPatient(dirty[u])'),",
    "  'base startup scrub lacks a per-row fallback after a failed batch save');"
  ].join('\n'),
  [
    "assert(baseSanitize.includes(\"batchAvailable = typeof window.savePatients === 'function'\") &&",
    "  baseSanitize.includes('if (!saved)') && baseSanitize.includes('window.upsertPatient(dirty[u])'),",
    "  'base startup scrub lost its compatibility fallback for an absent batch API');",
    "assert(baseSanitize.includes('if (scrubbed || saveFailed) return;') &&",
    "  baseSanitize.includes('if ((scrubbed || saveFailed) && _iv)'),",
    "  'base startup scrub does not latch and retire after a throwing batch');",
    "assert(baseSanitize.includes('_scrub: function () { scrubbed = false; saveFailed = false; scrubExisting(); }'),",
    "  'explicit base scrub retry does not clear its failure latch');"
  ].join('\n'),
  'pin base Summary Sanitize failure split'
);

test = replaceOnce(
  test,
  [
    '/* 2026-07-29: dirty rows are cloned before persistence so failed writers',
    ' * cannot make the shared store cache appear clean. Successful per-row fallback',
    ' * completes normally; total failure must retry on the next heartbeat. */'
  ].join('\n'),
  [
    '/* 2026-07-29: dirty rows are cloned before persistence. A missing batch API',
    ' * retains its compatibility fallback; a throwing batch never fans out and',
    ' * Continuous Scrub retries only after a later store-version change. */'
  ].join('\n'),
  'describe bounded summary scrub failure behavior'
);

test = replaceOnce(
  test,
  [
    '  const counts = { save: 0, upsert: 0, sync: 0, render: 0 };',
    '  const syntheticWindow = {',
    '    __mlsContinuousScrub: { cleaned: 0 },',
    '    __mlsStoreCache: { ver() { return 7; } },'
  ].join('\n'),
  [
    '  const counts = { save: 0, upsert: 0, sync: 0, render: 0 };',
    '  let storeVersion = 7;',
    '  const syntheticWindow = {',
    '    __mlsContinuousScrub: { cleaned: 0 },',
    '    __mlsStoreCache: { ver() { return storeVersion; } },'
  ].join('\n'),
  'make Continuous Scrub store version observable'
);

test = replaceOnce(
  test,
  [
    "  if (mode !== 'absent') {",
    '    syntheticWindow.savePatients = function () {',
    '      counts.save++;',
    "      if (mode === 'throw' || mode === 'allThrow') throw new Error('synthetic save refusal');",
    '    };',
    '  }',
    '  const ctx = {',
    '    window: syntheticWindow,',
    '    document: { hidden: false },'
  ].join('\n'),
  [
    "  if (mode !== 'absent') {",
    '    syntheticWindow.savePatients = function () {',
    '      counts.save++;',
    "      if (mode === 'throw' || (mode === 'throwThenSave' && counts.save === 1)) {",
    '        storeVersion++;',
    "        throw new Error('synthetic save refusal');",
    '      }',
    '    };',
    '  }',
    '  const ctx = {',
    '    window: syntheticWindow,',
    '    document: { hidden: false },'
  ].join('\n'),
  'model the failed storage write version bump'
);

test = replaceOnce(
  test,
  [
    '  return {',
    '    counts,',
    '    state: syntheticWindow.__mlsContinuousScrub,',
    "    sourceDirty: rows.filter(function (row) { return row.summary === 'x'.repeat(90); }).length",
    '  };'
  ].join('\n'),
  [
    '  return {',
    '    counts,',
    '    state: syntheticWindow.__mlsContinuousScrub,',
    "    sourceDirty: rows.filter(function (row) { return row.summary === 'x'.repeat(90); }).length,",
    '    rerun() { ctx.runContinuousScrub(); },',
    '    bumpStore() { storeVersion++; }',
    '  };'
  ].join('\n'),
  'expose Continuous Scrub retry controls'
);

test = replaceOnce(
  test,
  [
    "['throw', 'absent'].forEach(function (mode) {",
    '  const result = runContinuousPersistence(mode);',
    '  assert.deepStrictEqual(result.counts,',
    "    { save: mode === 'throw' ? 1 : 0, upsert: 8, sync: 0, render: 1 },",
    "    'Continuous Scrub ' + mode + ' batch path did not complete through fallback');",
    '  assert.strictEqual(result.state.cleaned, 8,',
    "    'Continuous Scrub ' + mode + ' successful fallback lost completion diagnostics');",
    '});',
    "const continuousFailed = runContinuousPersistence('allThrow', 2);",
    "assert.deepStrictEqual(continuousFailed.counts, { save: 2, upsert: 16, sync: 0, render: 0 },",
    "  'Continuous Scrub total failure did not retry every writer on heartbeat two');",
    'assert.strictEqual(continuousFailed.state.cleaned, 0,',
    "  'Continuous Scrub total failure falsely recorded cleaned rows');",
    'assert.strictEqual(continuousFailed.state.lastScrubVer, null,',
    "  'Continuous Scrub total failure retained its optimistic version stamp');",
    'assert.strictEqual(continuousFailed.sourceDirty, 8,',
    "  'Continuous Scrub total failure mutated the shared source rows');"
  ].join('\n'),
  [
    "const continuousAbsent = runContinuousPersistence('absent');",
    "assert.deepStrictEqual(continuousAbsent.counts, { save: 0, upsert: 8, sync: 0, render: 1 },",
    "  'Continuous Scrub absent batch API did not complete through compatibility fallback');",
    "assert.strictEqual(continuousAbsent.state.cleaned, 8,",
    "  'Continuous Scrub absent batch API lost completion diagnostics');",
    "const continuousThrown = runContinuousPersistence('throwThenSave', 2);",
    "assert.deepStrictEqual(continuousThrown.counts, { save: 1, upsert: 0, sync: 0, render: 0 },",
    "  'Continuous Scrub throwing batch retried or fanned out on the unchanged version');",
    "assert.strictEqual(continuousThrown.state.cleaned, 0,",
    "  'Continuous Scrub throwing batch falsely recorded cleaned rows');",
    "assert.strictEqual(continuousThrown.state.lastScrubVer, 8,",
    "  'Continuous Scrub throwing batch did not settle on the post-failure version');",
    "assert.strictEqual(continuousThrown.sourceDirty, 8,",
    "  'Continuous Scrub throwing batch mutated the shared source rows');",
    'continuousThrown.bumpStore();',
    'continuousThrown.rerun();',
    "assert.deepStrictEqual(continuousThrown.counts, { save: 2, upsert: 0, sync: 8, render: 1 },",
    "  'Continuous Scrub did not permit one successful retry after a later store change');",
    "assert.strictEqual(continuousThrown.state.cleaned, 8,",
    "  'Continuous Scrub successful change-driven retry lost completion diagnostics');"
  ].join('\n'),
  'prove Continuous Scrub failure is bounded and retryable'
);

test = replaceOnce(
  test,
  [
    "  vm.runInContext('var scrubbed=false;\\n' + baseFn +",
    "    '\\nthis.runBaseScrub=scrubExisting;this.wasScrubbed=function(){return scrubbed;};', ctx,",
    "    { filename: 'base-summary-scrub.js' });"
  ].join('\n'),
  [
    "  vm.runInContext('var scrubbed=false,saveFailed=false;\\n' + baseFn +",
    "    '\\nthis.runBaseScrub=scrubExisting;this.wasScrubbed=function(){return scrubbed;};this.didSaveFail=function(){return saveFailed;};', ctx,",
    "    { filename: 'base-summary-scrub.js' });"
  ].join('\n'),
  'expose the base scrub failure latch'
);

test = replaceOnce(
  test,
  [
    '  return {',
    '    counts,',
    '    scrubbed: ctx.wasScrubbed(),',
    "    sourceDirty: rows.filter(function (row) { return row.summary === 'x'.repeat(90); }).length",
    '  };'
  ].join('\n'),
  [
    '  return {',
    '    counts,',
    '    scrubbed: ctx.wasScrubbed(),',
    '    saveFailed: ctx.didSaveFail(),',
    "    sourceDirty: rows.filter(function (row) { return row.summary === 'x'.repeat(90); }).length",
    '  };'
  ].join('\n'),
  'return the base scrub failure latch'
);

test = replaceOnce(
  test,
  [
    "['throw', 'absent'].forEach(function (mode) {",
    '  const result = runBasePersistence(mode);',
    '  assert.deepStrictEqual(result.counts,',
    "    { save: mode === 'throw' ? 1 : 0, upsert: 8, sync: 0, render: 1 },",
    "    'base startup scrub ' + mode + ' batch path did not complete through fallback');",
    '  assert.strictEqual(result.scrubbed, true,',
    "    'base startup scrub ' + mode + ' successful fallback did not retire');",
    '});',
    "const baseFailed = runBasePersistence('allThrow', 2);",
    "assert.deepStrictEqual(baseFailed.counts, { save: 2, upsert: 16, sync: 0, render: 0 },",
    "  'base startup scrub total failure did not retry every writer on heartbeat two');",
    'assert.strictEqual(baseFailed.scrubbed, false,',
    "  'base startup scrub total failure retired');",
    'assert.strictEqual(baseFailed.sourceDirty, 8,',
    "  'base startup scrub total failure mutated the shared source rows');"
  ].join('\n'),
  [
    "const baseAbsent = runBasePersistence('absent');",
    "assert.deepStrictEqual(baseAbsent.counts, { save: 0, upsert: 8, sync: 0, render: 1 },",
    "  'base startup scrub absent batch API did not complete through compatibility fallback');",
    "assert.strictEqual(baseAbsent.scrubbed, true,",
    "  'base startup scrub absent batch API successful fallback did not retire');",
    "const baseThrown = runBasePersistence('throw', 2);",
    "assert.deepStrictEqual(baseThrown.counts, { save: 1, upsert: 0, sync: 0, render: 0 },",
    "  'base startup scrub throwing batch retried or fanned out into per-row writes');",
    "assert.strictEqual(baseThrown.scrubbed, false,",
    "  'base startup scrub throwing batch falsely recorded completion');",
    "assert.strictEqual(baseThrown.saveFailed, true,",
    "  'base startup scrub throwing batch did not latch its failure');",
    "assert.strictEqual(baseThrown.sourceDirty, 8,",
    "  'base startup scrub throwing batch mutated the shared source rows');"
  ].join('\n'),
  'prove base Summary Sanitize failure does not multiply writes'
);

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Patched ' + connectPath);
console.log('Patched ' + testPath);

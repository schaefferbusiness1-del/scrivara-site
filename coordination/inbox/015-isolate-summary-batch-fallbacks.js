'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const perfTestPath = path.join(root, 'tests', 'patient-scale-perf-contract.test.js');
const pullTestPath = path.join(root, 'tests', 'pull-panel-calm-under-fire.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let connect = fs.readFileSync(connectPath, 'latin1');
let perfTest = fs.readFileSync(perfTestPath, 'utf8');
let pullTest = fs.readFileSync(pullTestPath, 'utf8');

connect = replaceExactlyOnce(
  connect,
  "          if (c && c !== s) {\n            p.summary = c; p.updated = Date.now(); fixed++; dirty.push(p);\n          }",
  "          if (c && c !== s) {\n            var next = {}; for (var field in p) next[field] = p[field];\n            next.summary = c; next.updated = Date.now(); ps[i] = next; fixed++; dirty.push(next);\n          }",
  'Continuous Scrub isolated dirty row'
);

connect = replaceExactlyOnce(
  connect,
  "      if (fixed) {\n        try { if (typeof window.savePatients === 'function') window.savePatients(ps); } catch (e) {}\n        for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }\n        window.__mlsContinuousScrub.cleaned += fixed;",
  "      if (fixed) {\n        var saved = false, fallbackOk = false;\n        try { if (typeof window.savePatients === 'function') { window.savePatients(ps); saved = true; } } catch (e) {}\n        if (!saved) {\n          fallbackOk = typeof window.upsertPatient === 'function';\n          if (fallbackOk) {\n            for (var u = 0; u < dirty.length; u++) { try { window.upsertPatient(dirty[u]); } catch (eUpsert) { fallbackOk = false; } }\n          }\n          if (!fallbackOk) { try { if (st8) st8.lastScrubVer = null; } catch (eReset) {} return; }\n        } else {\n          for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }\n        }\n        window.__mlsContinuousScrub.cleaned += fixed;",
  'Continuous Scrub isolated failed-batch fallback'
);

connect = replaceExactlyOnce(
  connect,
  "          if (clean && clean !== s) {\n            p.summary = clean; p.updated = Date.now(); fixed++; dirty.push(p);\n          }",
  "          if (clean && clean !== s) {\n            var next = {}; for (var field in p) next[field] = p[field];\n            next.summary = clean; next.updated = Date.now(); ps[i] = next; fixed++; dirty.push(next);\n          }",
  'base sanitizer isolated dirty row'
);

connect = replaceExactlyOnce(
  connect,
  "      if (fixed) {\n        try { if (typeof window.savePatients === 'function') window.savePatients(ps); } catch (e) {}\n        for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }\n      }\n      scrubbed = true;",
  "      if (fixed) {\n        var saved = false, fallbackOk = false;\n        try { if (typeof window.savePatients === 'function') { window.savePatients(ps); saved = true; } } catch (e) {}\n        if (!saved) {\n          fallbackOk = typeof window.upsertPatient === 'function';\n          if (fallbackOk) {\n            for (var u = 0; u < dirty.length; u++) { try { window.upsertPatient(dirty[u]); } catch (eUpsert) { fallbackOk = false; } }\n          }\n          if (!fallbackOk) return;\n        } else {\n          for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }\n        }\n      }\n      scrubbed = true;",
  'base sanitizer isolated failed-batch fallback'
);

perfTest = replaceExactlyOnce(
  perfTest,
  "assert(!continuousScrub.includes('upsertPatient('), 'Continuous Scrub returned to one full-store upsert per fixed patient');",
  "assert(continuousScrub.includes('fallbackOk = typeof window.upsertPatient') &&\n  continuousScrub.includes('window.upsertPatient(dirty[u])'),\n  'Continuous Scrub lacks a per-row fallback after a failed batch save');",
  'Continuous Scrub fallback source contract'
);

perfTest = replaceExactlyOnce(
  perfTest,
  "assert(!baseSanitize.includes('upsertPatient('), 'base startup scrub returned to one full-store upsert per fixed patient');",
  "assert(baseSanitize.includes('fallbackOk = typeof window.upsertPatient') &&\n  baseSanitize.includes('window.upsertPatient(dirty[u])'),\n  'base startup scrub lacks a per-row fallback after a failed batch save');",
  'base sanitizer fallback source contract'
);

perfTest = replaceExactlyOnce(
  perfTest,
  `assert(continuousScrub.includes('dirty.push(p)') && continuousScrub.includes('syncPatientToServer(dirty[d])') &&
  continuousScrub.includes('p.updated = Date.now()'),
  'Continuous Scrub lost dirty-row collection, timestamping, or server mirrors');`,
  `assert(continuousScrub.includes('ps[i] = next') && continuousScrub.includes('dirty.push(next)') &&
  continuousScrub.includes('syncPatientToServer(dirty[d])') &&
  continuousScrub.includes('next.updated = Date.now()'),
  'Continuous Scrub lost isolated dirty-row collection, timestamping, or server mirrors');`,
  'Continuous Scrub isolated-row source contract'
);

perfTest = replaceExactlyOnce(
  perfTest,
  `assert(baseSanitize.includes('dirty.push(p)') && baseSanitize.includes('syncPatientToServer(dirty[d])') &&
  baseSanitize.includes('p.updated = Date.now()'),
  'base startup scrub lost dirty-row collection, timestamping, or server mirrors');`,
  `assert(baseSanitize.includes('ps[i] = next') && baseSanitize.includes('dirty.push(next)') &&
  baseSanitize.includes('syncPatientToServer(dirty[d])') &&
  baseSanitize.includes('next.updated = Date.now()'),
  'base startup scrub lost isolated dirty-row collection, timestamping, or server mirrors');`,
  'base sanitizer isolated-row source contract'
);

const runtimeContract = `/* 2026-07-29: dirty rows are cloned before persistence so failed writers
 * cannot make the shared store cache appear clean. Successful per-row fallback
 * completes normally; total failure must retry on the next heartbeat. */
const continuousFnStart = continuousScrub.indexOf('  function scrub() {');
const continuousFnEnd = continuousScrub.length;
assert(continuousFnStart >= 0 && continuousFnEnd > continuousFnStart,
  'Continuous Scrub function could not be extracted');
const continuousFn = continuousScrub.slice(continuousFnStart, continuousFnEnd);
function runContinuousPersistence(mode, passes) {
  const rows = new Array(8).fill(0).map(function (_, i) {
    return { id: 'synthetic-continuous-' + i, summary: 'x'.repeat(90) };
  });
  const counts = { save: 0, upsert: 0, sync: 0, render: 0 };
  const syntheticWindow = {
    __mlsContinuousScrub: { cleaned: 0 },
    __mlsStoreCache: { ver() { return 7; } },
    __mlsSummarySanitize: { hasCode() { return true; }, strip() { return 'clean synthetic summary'; } },
    getPatients() { return rows.slice(); },
    upsertPatient() {
      counts.upsert++;
      if (mode === 'allThrow') throw new Error('synthetic upsert refusal');
    },
    syncPatientToServer() { counts.sync++; },
    renderProfile() { counts.render++; }
  };
  if (mode !== 'absent') {
    syntheticWindow.savePatients = function () {
      counts.save++;
      if (mode === 'throw' || mode === 'allThrow') throw new Error('synthetic save refusal');
    };
  }
  const ctx = {
    window: syntheticWindow,
    document: { hidden: false },
    Date,
    Number,
    console: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(continuousFn + '\\nthis.runContinuousScrub=scrub;', ctx,
    { filename: 'continuous-summary-scrub.js' });
  for (let pass = 0; pass < (passes || 1); pass++) ctx.runContinuousScrub();
  return {
    counts,
    state: syntheticWindow.__mlsContinuousScrub,
    sourceDirty: rows.filter(function (row) { return row.summary === 'x'.repeat(90); }).length
  };
}
const continuousSaved = runContinuousPersistence('save');
assert.deepStrictEqual(continuousSaved.counts, { save: 1, upsert: 0, sync: 8, render: 1 },
  'Continuous Scrub successful batch did not save, mirror, and finish once');
assert.strictEqual(continuousSaved.state.cleaned, 8,
  'Continuous Scrub successful batch did not record eight cleaned rows');
['throw', 'absent'].forEach(function (mode) {
  const result = runContinuousPersistence(mode);
  assert.deepStrictEqual(result.counts,
    { save: mode === 'throw' ? 1 : 0, upsert: 8, sync: 0, render: 1 },
    'Continuous Scrub ' + mode + ' batch path did not complete through fallback');
  assert.strictEqual(result.state.cleaned, 8,
    'Continuous Scrub ' + mode + ' successful fallback lost completion diagnostics');
});
const continuousFailed = runContinuousPersistence('allThrow', 2);
assert.deepStrictEqual(continuousFailed.counts, { save: 2, upsert: 16, sync: 0, render: 0 },
  'Continuous Scrub total failure did not retry every writer on heartbeat two');
assert.strictEqual(continuousFailed.state.cleaned, 0,
  'Continuous Scrub total failure falsely recorded cleaned rows');
assert.strictEqual(continuousFailed.state.lastScrubVer, null,
  'Continuous Scrub total failure retained its optimistic version stamp');
assert.strictEqual(continuousFailed.sourceDirty, 8,
  'Continuous Scrub total failure mutated the shared source rows');

const baseFnStart = baseSanitize.indexOf('  function scrubExisting() {');
const baseFnEnd = baseSanitize.indexOf('\\n\\n  function tick()', baseFnStart);
assert(baseFnStart >= 0 && baseFnEnd > baseFnStart,
  'base startup scrub function could not be extracted');
const baseFn = baseSanitize.slice(baseFnStart, baseFnEnd);
function runBasePersistence(mode, passes) {
  const rows = new Array(8).fill(0).map(function (_, i) {
    return { id: 'synthetic-base-' + i, summary: 'x'.repeat(90) };
  });
  const counts = { save: 0, upsert: 0, sync: 0, render: 0 };
  const syntheticWindow = {
    getPatients() { return rows.slice(); },
    upsertPatient() {
      counts.upsert++;
      if (mode === 'allThrow') throw new Error('synthetic upsert refusal');
    },
    syncPatientToServer() { counts.sync++; },
    renderProfile() { counts.render++; }
  };
  if (mode !== 'absent') {
    syntheticWindow.savePatients = function () {
      counts.save++;
      if (mode === 'throw' || mode === 'allThrow') throw new Error('synthetic save refusal');
    };
  }
  const ctx = {
    window: syntheticWindow,
    Date,
    Number,
    console: { log() {} },
    hasCode() { return true; },
    stripChartCode() { return 'clean synthetic summary'; }
  };
  vm.createContext(ctx);
  vm.runInContext('var scrubbed=false;\\n' + baseFn +
    '\\nthis.runBaseScrub=scrubExisting;this.wasScrubbed=function(){return scrubbed;};', ctx,
    { filename: 'base-summary-scrub.js' });
  for (let pass = 0; pass < (passes || 1); pass++) ctx.runBaseScrub();
  return {
    counts,
    scrubbed: ctx.wasScrubbed(),
    sourceDirty: rows.filter(function (row) { return row.summary === 'x'.repeat(90); }).length
  };
}
const baseSaved = runBasePersistence('save');
assert.deepStrictEqual(baseSaved.counts, { save: 1, upsert: 0, sync: 8, render: 1 },
  'base startup scrub successful batch did not save, mirror, and finish once');
assert.strictEqual(baseSaved.scrubbed, true, 'base startup scrub successful batch did not retire');
['throw', 'absent'].forEach(function (mode) {
  const result = runBasePersistence(mode);
  assert.deepStrictEqual(result.counts,
    { save: mode === 'throw' ? 1 : 0, upsert: 8, sync: 0, render: 1 },
    'base startup scrub ' + mode + ' batch path did not complete through fallback');
  assert.strictEqual(result.scrubbed, true,
    'base startup scrub ' + mode + ' successful fallback did not retire');
});
const baseFailed = runBasePersistence('allThrow', 2);
assert.deepStrictEqual(baseFailed.counts, { save: 2, upsert: 16, sync: 0, render: 0 },
  'base startup scrub total failure did not retry every writer on heartbeat two');
assert.strictEqual(baseFailed.scrubbed, false,
  'base startup scrub total failure retired');
assert.strictEqual(baseFailed.sourceDirty, 8,
  'base startup scrub total failure mutated the shared source rows');

`;

perfTest = replaceExactlyOnce(
  perfTest,
  '/* ---------- veil floor (also pinned by boot-loading-visual-contract) ---------- */',
  runtimeContract + '/* ---------- veil floor (also pinned by boot-loading-visual-contract) ---------- */',
  'summary scrub isolated persistence runtime contract'
);

pullTest = replaceExactlyOnce(
  pullTest,
  "assert(continuous.indexOf('if (pulling) return;') < continuous.indexOf('st8.lastScrubVer = v8'),\n  'Continuous Scrub must not stamp a busy store version as clean');",
  "const continuousBusyReturn = continuous.indexOf('if (pulling) return;');\nconst continuousVersionStamp = continuous.indexOf('st8.lastScrubVer = v8');\nassert(continuousBusyReturn >= 0 && continuousVersionStamp >= 0 &&\n  continuousBusyReturn < continuousVersionStamp,\n  'Continuous Scrub must not stamp a busy store version as clean');",
  'Continuous Scrub busy ordering assertion'
);

pullTest = replaceExactlyOnce(
  pullTest,
  "assert(baseSanitize.includes('window.__mlsPullBusyAt') && baseSanitize.includes('.state.running') &&\n  baseSanitize.indexOf('if (pulling) return;') < baseSanitize.indexOf('window.getPatients'),\n  'base startup scrub must defer before reading or rewriting the roster during a pull');",
  "const baseBusyReturn = baseSanitize.indexOf('if (pulling) return;');\nconst baseRosterRead = baseSanitize.indexOf('window.getPatients');\nassert(baseSanitize.includes('window.__mlsPullBusyAt') && baseSanitize.includes('.state.running') &&\n  baseBusyReturn >= 0 && baseRosterRead >= 0 && baseBusyReturn < baseRosterRead,\n  'base startup scrub must defer before reading or rewriting the roster during a pull');",
  'base sanitizer busy ordering assertion'
);

const continuousStart = connect.indexOf('CONTINUOUS SUMMARY SCRUB');
const continuousEnd = connect.indexOf('var iv = null; try { iv = setInterval(scrub, 2500);', continuousStart);
const continuous = connect.slice(continuousStart, continuousEnd);
const baseStart = connect.indexOf("try { if (window.__mlsSummarySanitize) return; }");
const baseEnd = connect.indexOf('window.__mlsSummarySanitize_revert', baseStart);
const base = connect.slice(baseStart, baseEnd);
if (continuousStart < 0 || continuousEnd <= continuousStart ||
    baseStart < 0 || baseEnd <= baseStart) {
  throw new Error('summary scrub correction slices are missing');
}
for (const pair of [['Continuous Scrub', continuous], ['base sanitizer', base]]) {
  if ((pair[1].match(/savePatients\(ps\)/g) || []).length !== 1 ||
      !pair[1].includes('ps[i] = next;') ||
      !pair[1].includes('dirty.push(next)') ||
      !pair[1].includes('fallbackOk = typeof window.upsertPatient') ||
      !pair[1].includes('window.upsertPatient(dirty[u])') ||
      !pair[1].includes('syncPatientToServer(dirty[d])')) {
    throw new Error(pair[0] + ' isolated fallback postcondition failed');
  }
}
if (!continuous.includes('st8.lastScrubVer = null;') ||
    !perfTest.includes("runContinuousPersistence('allThrow', 2)") ||
    !perfTest.includes("runBasePersistence('allThrow', 2)") ||
    !pullTest.includes('continuousBusyReturn >= 0') ||
    !pullTest.includes('baseBusyReturn >= 0')) {
  throw new Error('summary scrub retry/runtime postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(perfTestPath, perfTest, 'utf8');
fs.writeFileSync(pullTestPath, pullTest, 'utf8');

console.log('Isolated summary edits and made fallback completion or retry exact.');

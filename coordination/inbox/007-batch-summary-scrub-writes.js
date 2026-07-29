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
  "      if (document.hidden) return;\n      try {\n        var st8 = window.__mlsContinuousScrub;",
  "      if (document.hidden) return;\n      /* 2026-07-29: do not stamp or rewrite the store while a pull owns it. */\n      try {\n        var busyAt = Number(window.__mlsPullBusyAt || 0);\n        var pulling = (busyAt && (Date.now() - busyAt) < 10000) ||\n          !!(window.__mlsDayHistoryPull && window.__mlsDayHistoryPull.state && window.__mlsDayHistoryPull.state.running);\n        if (pulling) return;\n      } catch (eBusy) {}\n      try {\n        var st8 = window.__mlsContinuousScrub;",
  'Continuous Scrub pull-busy gate'
);

connect = replaceExactlyOnce(
  connect,
  "      if (!ps.length) return;\n      var fixed = 0;\n      for (var i = 0; i < ps.length; i++) {",
  "      if (!ps.length) return;\n      var fixed = 0, dirty = [];\n      for (var i = 0; i < ps.length; i++) {",
  'Continuous Scrub dirty batch'
);

connect = replaceExactlyOnce(
  connect,
  "          if (c && c !== s) {\n            p.summary = c; fixed++;\n            try { if (typeof window.upsertPatient === 'function') window.upsertPatient(p); } catch (e) {}\n          }",
  "          if (c && c !== s) {\n            p.summary = c; p.updated = Date.now(); fixed++; dirty.push(p);\n          }",
  'Continuous Scrub per-patient write removal'
);

connect = replaceExactlyOnce(
  connect,
  "      if (fixed) {\n        window.__mlsContinuousScrub.cleaned += fixed;",
  "      if (fixed) {\n        var saved = false;\n        try { if (typeof window.savePatients === 'function') { window.savePatients(ps); saved = true; } } catch (e) {}\n        if (!saved) {\n          try { if (st8) st8.lastScrubVer = null; } catch (eReset) {}\n          for (var u = 0; u < dirty.length; u++) { try { if (typeof window.upsertPatient === 'function') window.upsertPatient(dirty[u]); } catch (e) {} }\n          return;\n        }\n        for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }\n        window.__mlsContinuousScrub.cleaned += fixed;",
  'Continuous Scrub one local write'
);

connect = replaceExactlyOnce(
  connect,
  "  function scrubExisting() {\n    if (scrubbed) return;\n    try {\n      var ps = (typeof window.getPatients === 'function') ? (window.getPatients() || []) : [];",
  "  function scrubExisting() {\n    if (scrubbed) return;\n    /* 2026-07-29: the startup scrub waits rather than competing with a pull. */\n    try {\n      var busyAt = Number(window.__mlsPullBusyAt || 0);\n      var pulling = (busyAt && (Date.now() - busyAt) < 10000) ||\n        !!(window.__mlsDayHistoryPull && window.__mlsDayHistoryPull.state && window.__mlsDayHistoryPull.state.running);\n      if (pulling) return;\n    } catch (eBusy) {}\n    try {\n      var ps = (typeof window.getPatients === 'function') ? (window.getPatients() || []) : [];",
  'base sanitizer pull-busy gate'
);

connect = replaceExactlyOnce(
  connect,
  "      var fixed = 0;\n      for (var i = 0; i < ps.length; i++) {\n        var p = ps[i]; var s = p && p.summary;",
  "      var fixed = 0, dirty = [];\n      for (var i = 0; i < ps.length; i++) {\n        var p = ps[i]; var s = p && p.summary;",
  'base sanitizer dirty batch'
);

connect = replaceExactlyOnce(
  connect,
  "          if (clean && clean !== s) {\n            p.summary = clean; fixed++;\n            try { if (typeof window.upsertPatient === 'function') window.upsertPatient(p); } catch (e) {}\n          }",
  "          if (clean && clean !== s) {\n            p.summary = clean; p.updated = Date.now(); fixed++; dirty.push(p);\n          }",
  'base sanitizer per-patient write removal'
);

connect = replaceExactlyOnce(
  connect,
  "      scrubbed = true;\n      if (fixed) { try { console.log('[MLS sanitize] cleaned code out of ' + fixed + ' patient summar' + (fixed === 1 ? 'y' : 'ies')); } catch (e) {} }",
  "      if (fixed) {\n        var saved = false;\n        try { if (typeof window.savePatients === 'function') { window.savePatients(ps); saved = true; } } catch (e) {}\n        if (!saved) {\n          for (var u = 0; u < dirty.length; u++) { try { if (typeof window.upsertPatient === 'function') window.upsertPatient(dirty[u]); } catch (e) {} }\n          return;\n        }\n        for (var d = 0; d < dirty.length; d++) { try { if (typeof window.syncPatientToServer === 'function') window.syncPatientToServer(dirty[d]); } catch (e) {} }\n      }\n      scrubbed = true;\n      if (fixed) { try { console.log('[MLS sanitize] cleaned code out of ' + fixed + ' patient summar' + (fixed === 1 ? 'y' : 'ies')); } catch (e) {} }",
  'base sanitizer one local write'
);

perfTest = replaceExactlyOnce(
  perfTest,
  "assert(connect.includes('cleanRuns >= 5'), 'sanitize self-retire threshold changed unexpectedly');",
  "assert(connect.includes('cleanRuns >= 5'), 'sanitize self-retire threshold changed unexpectedly');\n\n/* ---------- 6b. every automatic summary scrub batches its store write ---------- */\nconst continuousStart = connect.indexOf('CONTINUOUS SUMMARY SCRUB');\nconst continuousEnd = connect.indexOf('var iv = null; try { iv = setInterval(scrub, 2500);', continuousStart);\nassert(continuousStart >= 0 && continuousEnd > continuousStart, 'Continuous Scrub slice is missing');\nconst continuousScrub = connect.slice(continuousStart, continuousEnd);\nassert(!continuousScrub.includes('upsertPatient('), 'Continuous Scrub returned to one full-store upsert per fixed patient');\nassert.strictEqual((continuousScrub.match(/savePatients\\(ps\\)/g) || []).length, 1,\n  'Continuous Scrub must make exactly one local batch save');\nassert(continuousScrub.includes('dirty.push(p)') && continuousScrub.includes('syncPatientToServer(dirty[d])') &&\n  continuousScrub.includes('p.updated = Date.now()'),\n  'Continuous Scrub lost dirty-row collection, timestamping, or server mirrors');\n\nconst baseSanitizeStart = connect.indexOf(\"try { if (window.__mlsSummarySanitize) return; }\");\nconst baseSanitizeEnd = connect.indexOf('window.__mlsSummarySanitize_revert', baseSanitizeStart);\nassert(baseSanitizeStart >= 0 && baseSanitizeEnd > baseSanitizeStart, 'base sanitizer slice is missing');\nconst baseSanitize = connect.slice(baseSanitizeStart, baseSanitizeEnd);\nassert(!baseSanitize.includes('upsertPatient('), 'base startup scrub returned to one full-store upsert per fixed patient');\nassert.strictEqual((baseSanitize.match(/savePatients\\(ps\\)/g) || []).length, 1,\n  'base startup scrub must make exactly one local batch save');\nassert(baseSanitize.includes('dirty.push(p)') && baseSanitize.includes('syncPatientToServer(dirty[d])') &&\n  baseSanitize.includes('p.updated = Date.now()'),\n  'base startup scrub lost dirty-row collection, timestamping, or server mirrors');",
  'all summary scrubs batch contract'
);

perfTest = replaceExactlyOnce(
  perfTest,
  "assert(!continuousScrub.includes('upsertPatient('), 'Continuous Scrub returned to one full-store upsert per fixed patient');",
  "assert(continuousScrub.includes('var saved = false;') && continuousScrub.includes('if (!saved) {') &&\\n  continuousScrub.includes('window.upsertPatient(dirty[u])'),\\n  'Continuous Scrub lacks a per-row fallback after a failed batch save');",
  'Continuous Scrub batch fallback contract'
);

perfTest = replaceExactlyOnce(
  perfTest,
  "assert(!baseSanitize.includes('upsertPatient('), 'base startup scrub returned to one full-store upsert per fixed patient');",
  "assert(baseSanitize.includes('var saved = false;') && baseSanitize.includes('if (!saved) {') &&\\n  baseSanitize.includes('window.upsertPatient(dirty[u])'),\\n  'base startup scrub lacks a per-row fallback after a failed batch save');",
  'base sanitizer batch fallback contract'
);

perfTest = replaceExactlyOnce(
  perfTest,
  `assert(baseSanitize.includes('dirty.push(p)') && baseSanitize.includes('syncPatientToServer(dirty[d])') &&
  baseSanitize.includes('p.updated = Date.now()'),
  'base startup scrub lost dirty-row collection, timestamping, or server mirrors');`,
  `assert(baseSanitize.includes('dirty.push(p)') && baseSanitize.includes('syncPatientToServer(dirty[d])') &&
  baseSanitize.includes('p.updated = Date.now()'),
  'base startup scrub lost dirty-row collection, timestamping, or server mirrors');

/* 2026-07-29: execute both transformed scrubbers through successful, throwing,
 * and unavailable batch saves. Failed batches must use the old per-row owner,
 * never mirror separately, and leave the pass eligible to retry. */
const continuousFnStart = continuousScrub.indexOf('  function scrub() {');
const continuousFnEnd = continuousScrub.length;
assert(continuousFnStart >= 0 && continuousFnEnd > continuousFnStart,
  'Continuous Scrub function could not be extracted');
const continuousFn = continuousScrub.slice(continuousFnStart, continuousFnEnd);
function runContinuousPersistence(mode) {
  const rows = new Array(8).fill(0).map(function (_, i) {
    return { id: 'synthetic-continuous-' + i, summary: 'x'.repeat(90) };
  });
  const counts = { save: 0, upsert: 0, sync: 0 };
  const syntheticWindow = {
    __mlsContinuousScrub: { cleaned: 0 },
    __mlsStoreCache: { ver() { return 7; } },
    __mlsSummarySanitize: { hasCode() { return true; }, strip() { return 'clean synthetic summary'; } },
    getPatients() { return rows; },
    upsertPatient() { counts.upsert++; },
    syncPatientToServer() { counts.sync++; }
  };
  if (mode !== 'absent') {
    syntheticWindow.savePatients = function () {
      counts.save++;
      if (mode === 'throw') throw new Error('synthetic save refusal');
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
  ctx.runContinuousScrub();
  return { counts, state: syntheticWindow.__mlsContinuousScrub };
}
const continuousSaved = runContinuousPersistence('save');
assert.deepStrictEqual(continuousSaved.counts, { save: 1, upsert: 0, sync: 8 },
  'Continuous Scrub successful batch did not save once and mirror eight rows');
assert.strictEqual(continuousSaved.state.cleaned, 8,
  'Continuous Scrub successful batch did not record eight cleaned rows');
for (const mode of ['throw', 'absent']) {
  const result = runContinuousPersistence(mode);
  assert.deepStrictEqual(result.counts,
    { save: mode === 'throw' ? 1 : 0, upsert: 8, sync: 0 },
    'Continuous Scrub ' + mode + ' batch path did not fall back without duplicate mirrors');
  assert.strictEqual(result.state.cleaned, 0,
    'Continuous Scrub ' + mode + ' batch path falsely recorded success');
  assert.strictEqual(result.state.lastScrubVer, null,
    'Continuous Scrub ' + mode + ' batch path suppressed its retry');
}

const baseFnStart = baseSanitize.indexOf('  function scrubExisting() {');
const baseFnEnd = baseSanitize.indexOf('\\n\\n  function tick()', baseFnStart);
assert(baseFnStart >= 0 && baseFnEnd > baseFnStart,
  'base startup scrub function could not be extracted');
const baseFn = baseSanitize.slice(baseFnStart, baseFnEnd);
function runBasePersistence(mode) {
  const rows = new Array(8).fill(0).map(function (_, i) {
    return { id: 'synthetic-base-' + i, summary: 'x'.repeat(90) };
  });
  const counts = { save: 0, upsert: 0, sync: 0 };
  const syntheticWindow = {
    getPatients() { return rows; },
    upsertPatient() { counts.upsert++; },
    syncPatientToServer() { counts.sync++; }
  };
  if (mode !== 'absent') {
    syntheticWindow.savePatients = function () {
      counts.save++;
      if (mode === 'throw') throw new Error('synthetic save refusal');
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
  ctx.runBaseScrub();
  return { counts, scrubbed: ctx.wasScrubbed() };
}
const baseSaved = runBasePersistence('save');
assert.deepStrictEqual(baseSaved, {
  counts: { save: 1, upsert: 0, sync: 8 },
  scrubbed: true
}, 'base startup scrub successful batch did not save once, mirror, and retire');
for (const mode of ['throw', 'absent']) {
  const result = runBasePersistence(mode);
  assert.deepStrictEqual(result, {
    counts: { save: mode === 'throw' ? 1 : 0, upsert: 8, sync: 0 },
    scrubbed: false
  }, 'base startup scrub ' + mode + ' batch path did not fall back and stay retryable');
}`,
  'summary scrub persistence runtime contracts'
);

pullTest = replaceExactlyOnce(
  pullTest,
  "assert(sanitize.includes('if (pulling) { cleanRuns = 0; return; }'),\n  'a stood-down pass must not count toward self-retirement');",
  "assert(sanitize.includes('if (pulling) { cleanRuns = 0; return; }'),\n  'a stood-down pass must not count toward self-retirement');\nconst continuousStart = connect.indexOf('CONTINUOUS SUMMARY SCRUB');\nconst continuousEnd = connect.indexOf('var iv = null; try { iv = setInterval(scrub, 2500);', continuousStart);\nconst continuous = connect.slice(continuousStart, continuousEnd);\nassert(continuous.includes('window.__mlsPullBusyAt') && continuous.includes('.state.running'),\n  'Continuous Scrub must stand down while a pull is running');\nassert(continuous.indexOf('if (pulling) return;') < continuous.indexOf('st8.lastScrubVer = v8'),\n  'Continuous Scrub must not stamp a busy store version as clean');\nconst baseStart = connect.indexOf(\"try { if (window.__mlsSummarySanitize) return; }\");\nconst baseEnd = connect.indexOf('function tick() { wrapIngest(); wrapSaveChart(); scrubExisting(); }', baseStart);\nconst baseSanitize = connect.slice(baseStart, baseEnd);\nassert(baseSanitize.includes('window.__mlsPullBusyAt') && baseSanitize.includes('.state.running') &&\n  baseSanitize.indexOf('if (pulling) return;') < baseSanitize.indexOf('window.getPatients'),\n  'base startup scrub must defer before reading or rewriting the roster during a pull');",
  'all summary scrubs pull-busy contract'
);

pullTest = replaceExactlyOnce(
  pullTest,
  `assert(continuous.indexOf('if (pulling) return;') < continuous.indexOf('st8.lastScrubVer = v8'),
  'Continuous Scrub must not stamp a busy store version as clean');`,
  `const continuousBusyReturn = continuous.indexOf('if (pulling) return;');
const continuousVersionStamp = continuous.indexOf('st8.lastScrubVer = v8');
assert(continuousBusyReturn >= 0 && continuousVersionStamp >= 0 &&
  continuousBusyReturn < continuousVersionStamp,
  'Continuous Scrub must not stamp a busy store version as clean');`,
  'Continuous Scrub busy ordering assertion'
);

pullTest = replaceExactlyOnce(
  pullTest,
  `assert(baseSanitize.includes('window.__mlsPullBusyAt') && baseSanitize.includes('.state.running') &&
  baseSanitize.indexOf('if (pulling) return;') < baseSanitize.indexOf('window.getPatients'),
  'base startup scrub must defer before reading or rewriting the roster during a pull');`,
  `const baseBusyReturn = baseSanitize.indexOf('if (pulling) return;');
const baseRosterRead = baseSanitize.indexOf('window.getPatients');
assert(baseSanitize.includes('window.__mlsPullBusyAt') && baseSanitize.includes('.state.running') &&
  baseBusyReturn >= 0 && baseRosterRead >= 0 && baseBusyReturn < baseRosterRead,
  'base startup scrub must defer before reading or rewriting the roster during a pull');`,
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
  throw new Error('summary scrub postcondition slices are missing');
}
for (const pair of [['Continuous Scrub', continuous], ['base sanitizer', base]]) {
  if ((pair[1].match(/savePatients\(ps\)/g) || []).length !== 1 ||
      !pair[1].includes('dirty.push(p)') ||
      !pair[1].includes('var saved = false;') ||
      !pair[1].includes('if (!saved) {') ||
      !pair[1].includes('window.upsertPatient(dirty[u])') ||
      !pair[1].includes('syncPatientToServer(dirty[d])')) {
    throw new Error(pair[0] + ' batching postcondition failed');
  }
}
const busyReturn = continuous.indexOf('if (pulling) return;');
const versionStamp = continuous.indexOf('st8.lastScrubVer = v8');
if (busyReturn < 0 || versionStamp < 0 || busyReturn > versionStamp ||
    !continuous.includes('st8.lastScrubVer = null;')) {
  throw new Error('Continuous Scrub busy-gate ordering postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(perfTestPath, perfTest, 'utf8');
fs.writeFileSync(pullTestPath, pullTest, 'utf8');

console.log('Batched both remaining summary scrub writers and gated them during pulls.');

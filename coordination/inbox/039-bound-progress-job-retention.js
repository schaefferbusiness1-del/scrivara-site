'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': expected source text was ambiguous');
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function prepare(relative, encoding, edits) {
  const file = path.join(root, relative);
  const original = fs.readFileSync(file, encoding);
  let next = original;
  edits.forEach(function (edit, index) {
    next = replaceOnce(next, edit[0], edit[1], relative + ' replacement ' + (index + 1));
  });
  if (next === original) throw new Error(relative + ': proposal produced no change');
  return { file, encoding, original, next };
}

const loadingPlan = prepare('feat_mls_loading_calm.js', 'utf8', [
  [
    ' * MLS shared job-progress store (lb-2.1.0)',
    ' * MLS shared job-progress store (lb-2.1.1)'
  ],
  [
    "  var VERSION = 'lb-2.1.0';",
    "  var VERSION = 'lb-2.1.1';"
  ],
  [
    "  var ACTIVE = { queued: 1, running: 1, retrying: 1 };\n  var TERMINAL = { completed: 1, partial: 1, failed: 1, canceled: 1, timed_out: 1 };\n  var jobs = {}, keyIndex = {}, timers = {}, retryFns = {}, cancelFns = {};",
    "  var ACTIVE = { queued: 1, running: 1, retrying: 1 };\n  var TERMINAL = { completed: 1, partial: 1, failed: 1, canceled: 1, timed_out: 1 };\n  var MAX_TERMINAL = 24;\n  var jobs = {}, keyIndex = {}, timers = {}, retryFns = {}, cancelFns = {};"
  ],
  [
    "  function clearDeadline(id) { if (timers[id]) { clearTimeout(timers[id]); delete timers[id]; } }\n  function armDeadline(j) {",
    "  function clearDeadline(id) { if (timers[id]) { clearTimeout(timers[id]); delete timers[id]; } }\n  function removeManual(id) {\n    var at = manualStack.indexOf(id);\n    while (at >= 0) { manualStack.splice(at, 1); at = manualStack.indexOf(id); }\n  }\n  function dropJob(id) {\n    var j = jobs[id];\n    clearDeadline(id);\n    if (j && keyIndex[j.key] === id) delete keyIndex[j.key];\n    removeManual(id);\n    delete retryFns[id]; delete cancelFns[id]; delete jobs[id];\n  }\n  function pruneTerminalJobs(protectId) {\n    var protectedTerminal = !!(protectId && jobs[protectId] && TERMINAL[jobs[protectId].status]);\n    var ids = Object.keys(jobs).filter(function (id) {\n      return id !== protectId && jobs[id] && TERMINAL[jobs[id].status];\n    });\n    ids.sort(function (a, b) {\n      var byTime = (jobs[b].updatedAt || 0) - (jobs[a].updatedAt || 0);\n      if (byTime) return byTime;\n      return a < b ? 1 : (a > b ? -1 : 0);\n    });\n    var allowance = Math.max(0, MAX_TERMINAL - (protectedTerminal ? 1 : 0));\n    for (var i = allowance; i < ids.length; i++) dropJob(ids[i]);\n  }\n  function clearSessionJobs() {\n    Object.keys(jobs).forEach(dropJob);\n    jobs = {}; keyIndex = {}; timers = {}; retryFns = {}; cancelFns = {}; manualStack = [];\n    safe(function () { sessionStorage.removeItem(STORE_KEY); });\n    sync();\n  }\n  function armDeadline(j) {"
  ],
  [
    "    if (keyIndex[j.key] === id) delete keyIndex[j.key];\n    clearDeadline(id); persist(); emit(j); sync();",
    "    if (keyIndex[j.key] === id) delete keyIndex[j.key];\n    clearDeadline(id);\n    removeManual(id);\n    delete cancelFns[id];\n    if (status === 'completed' || status === 'canceled') delete retryFns[id];\n    pruneTerminalJobs(id);\n    persist(); emit(j); sync();"
  ],
  [
    "  var api = { version: VERSION, installed: true, inflight: 0, visualOwner: 'mlsProgressStages' };",
    "  var api = { version: VERSION, installed: true, inflight: 0, visualOwner: 'mlsProgressStages', terminalRetention: MAX_TERMINAL };"
  ],
  [
    "  api.snapshot = publicJobs;\n\n  function restore() {",
    "  api.snapshot = publicJobs;\n\n  function onSessionBoundary() { clearSessionJobs(); }\n\n  function restore() {"
  ],
  [
    "  restore(); sync();\n  api.revert = function () {\n    safe(function () { Object.keys(timers).forEach(clearDeadline); });\n    retireLegacyVisuals();\n    api.installed = false; delete window.__mlsLoadingCalm;\n  };",
    "  restore(); sync();\n  safe(function () { window.addEventListener('mls:session-boundary', onSessionBoundary); });\n  api.revert = function () {\n    safe(function () { window.removeEventListener('mls:session-boundary', onSessionBoundary); });\n    safe(function () { Object.keys(timers).forEach(clearDeadline); });\n    jobs = {}; keyIndex = {}; timers = {}; retryFns = {}; cancelFns = {}; manualStack = [];\n    retireLegacyVisuals();\n    api.installed = false; delete window.__mlsLoadingCalm;\n  };"
  ]
]);

const connectPlan = prepare('mls-connect.js', 'latin1', [
  [
    "var A='feat_mls_loading_calm.js',V='lb-2.1.0'",
    "var A='feat_mls_loading_calm.js',V='lb-2.1.1'"
  ],
  [
    "s.src=A+'?v=20260719lb204'",
    "s.src=A+'?v=20260729lb211a1'"
  ],
  [
    '/* lb-2.1.0 version-aware headless job store;',
    '/* lb-2.1.1 version-aware headless job store;'
  ]
]);

const sharedTestPlan = prepare('tests/shared-progress-runtime.test.js', 'utf8', [
  [
    "const timeouts = [];\nlet nextTimer = 0;",
    "const timeouts = [];\nconst windowListeners = {};\nlet nextTimer = 0;"
  ],
  [
    "    setItem(k, v) { stored[k] = String(v); }\n  },",
    "    setItem(k, v) { stored[k] = String(v); },\n    removeItem(k) { delete stored[k]; }\n  },"
  ],
  [
    "context.window = context;\ncontext.addEventListener = function () {};\ncontext.dispatchEvent = function () {};",
    "context.window = context;\ncontext.addEventListener = function (type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn); };\ncontext.removeEventListener = function (type, fn) {\n  const list = windowListeners[type] || [], at = list.indexOf(fn); if (at >= 0) list.splice(at, 1);\n};\ncontext.dispatchEvent = function (event) { (windowListeners[event.type] || []).slice().forEach(fn => fn(event)); };"
  ],
  [
    "assert.strictEqual(api.version, 'lb-2.1.0');",
    "assert.strictEqual(api.version, 'lb-2.1.1');"
  ],
  [
    "assert(stored['mls:progress:v2'], 'progress was not persisted for refresh recovery');\n\nconsole.log('PASS shared progress: dedupe, stages/counts, stale rejection, safe cancel, retry, terminal deadlines, and persistence');",
    "assert(stored['mls:progress:v2'], 'progress was not persisted for refresh recovery');\n\n/* 2026-07-29: terminal history and callback closures are bounded in the live\n * owner, not only in its sessionStorage refresh copy. */\ncontext.dispatchEvent(new context.CustomEvent('mls:session-boundary', { detail: { epoch: 2 } }));\nassert.strictEqual(api.snapshot().length, 0, 'same-document session boundary retained prior jobs');\nassert.strictEqual(stored['mls:progress:v2'], undefined, 'same-document session boundary retained prior progress storage');\n\nlet completedRetryCalls = 0;\nlet firstCompletedId = '', newestCompletedId = '';\nfor (let i = 0; i < 40; i += 1) {\n  const h = api.start({ key: 'completed-' + i, timeoutMs: 5000, retry() { completedRetryCalls += 1; } });\n  if (i === 0) firstCompletedId = h.id;\n  newestCompletedId = h.id;\n  h.complete('Done');\n}\nassert.strictEqual(api.terminalRetention, 24, 'terminal retention limit is not public for diagnostics');\nassert.strictEqual(api.snapshot().length, 24, 'completed job history is not bounded');\nassert.strictEqual(api.get(firstCompletedId), null, 'oldest completed job was not evicted');\nassert.strictEqual(api.retry(newestCompletedId), false, 'successful job retained its retry closure');\nassert.strictEqual(completedRetryCalls, 0, 'successful job retry callback remained callable');\n\nlet failedRetryCalls = 0;\nconst failedIds = [];\nfor (let i = 0; i < 30; i += 1) {\n  const h = api.start({ key: 'failed-' + i, timeoutMs: 5000, retry() { failedRetryCalls += 1; } });\n  failedIds.push(h.id); h.fail(new Error('synthetic failure'));\n}\nassert.strictEqual(api.snapshot().filter(j => /^(completed|partial|failed|canceled|timed_out)$/.test(j.status)).length, 24,\n  'failed job history exceeded the shared terminal bound');\nassert.strictEqual(api.get(failedIds[0]), null, 'evicted failure metadata stayed reachable');\nassert.strictEqual(api.retry(failedIds[0]), false, 'evicted failure retained its retry closure');\nconst boundedRetry = api.retry(failedIds[failedIds.length - 1]);\nassert(boundedRetry && failedRetryCalls === 1, 'newest bounded failure lost its retry callback');\n\nlet canceledRetryCalls = 0;\nconst canceled = api.start({ key: 'canceled-retry', timeoutMs: 5000, cancelable: true,\n  retry() { canceledRetryCalls += 1; } });\ncanceled.cancel('Canceled');\nassert.strictEqual(api.retry(canceled.id), false, 'canceled job retained its retry closure');\nassert.strictEqual(canceledRetryCalls, 0, 'canceled retry callback remained callable');\n\napi.start({ key: 'session-active', timeoutMs: 5000 });\nassert(timeouts.some(t => !t.cleared), 'session-boundary probe did not arm a live deadline');\ncontext.dispatchEvent(new context.CustomEvent('mls:session-boundary', { detail: { epoch: 3 } }));\nassert.strictEqual(api.snapshot().length, 0, 'session boundary retained active or terminal jobs');\nassert.strictEqual(timeouts.filter(t => !t.cleared).length, 0, 'session boundary retained live deadline timers');\nassert.strictEqual(stored['mls:progress:v2'], undefined, 'session boundary retained the prior account progress snapshot');\nconst afterBoundary = api.start({ key: 'after-boundary', timeoutMs: 5000 });\nassert(afterBoundary && afterBoundary.isCurrent(), 'progress owner did not recover after a same-document session boundary');\n\nconsole.log('PASS shared progress: dedupe, stages/counts, stale rejection, bounded terminal/callback retention, session reset, deadlines, and persistence');"
  ]
]);

const immutablePlan = prepare('tests/immutable-satellite-loader-cache-contract.test.js', 'utf8', [[
  "  ['feat_mls_loading_calm.js', '20260719lb204', '20260719lb203'],",
  "  ['feat_mls_loading_calm.js', '20260729lb211a1', '20260719lb204'],"
]]);

const progressTestPlan = prepare('tests/progress-stages-runtime.test.js', 'utf8', [
  [
    '/* ps-1.2.0 named-stage progress wiring: loads the REAL lb-2.1.0 owner plus the',
    '/* ps-1.2.0 named-stage progress wiring: loads the REAL lb-2.1.1 owner plus the'
  ],
  [
    "assert(lb && lb.installed && lb.version === 'lb-2.1.0', 'shared lb owner missing');",
    "assert(lb && lb.installed && lb.version === 'lb-2.1.1', 'shared lb owner missing');"
  ],
  [
    "line.includes(\"var A='feat_mls_loading_calm.js',V='lb-2.1.0'\")",
    "line.includes(\"var A='feat_mls_loading_calm.js',V='lb-2.1.1'\")"
  ],
  [
    "lbLoader.includes(\"s.src=A+'?v=20260719lb204'\")",
    "lbLoader.includes(\"s.src=A+'?v=20260729lb211a1'\")"
  ]
]);

const sameTabPlan = prepare('tests/same-tab-owner-upgrade-runtime.test.js', 'utf8', [[
  "  { asset: 'feat_mls_loading_calm.js', version: 'lb-2.1.0', token: '20260719lb204', globalName: '__mlsLoadingCalm', speech: false },",
  "  { asset: 'feat_mls_loading_calm.js', version: 'lb-2.1.1', token: '20260729lb211a1', globalName: '__mlsLoadingCalm', speech: false },"
]]);

const siteAuditPlan = prepare('tests/site-audit-regressions.test.js', 'utf8', [
  [
    "line.includes(\"var A='feat_mls_loading_calm.js',V='lb-2.1.0'\")",
    "line.includes(\"var A='feat_mls_loading_calm.js',V='lb-2.1.1'\")"
  ],
  [
    "loadingLoader.includes(\"s.src=A+'?v=20260719lb204'\")",
    "loadingLoader.includes(\"s.src=A+'?v=20260729lb211a1'\")"
  ]
]);

const templateTestPlan = prepare('tests/template-library-runtime.test.js', 'utf8', [
  [
    "liveLoader.indexOf(\"var A='feat_mls_loading_calm.js',V='lb-2.1.0'\")",
    "liveLoader.indexOf(\"var A='feat_mls_loading_calm.js',V='lb-2.1.1'\")"
  ],
  [
    "includes(\"s.src=A+'?v=20260719lb204'\")",
    "includes(\"s.src=A+'?v=20260729lb211a1'\")"
  ]
]);

const plans = [
  loadingPlan,
  connectPlan,
  sharedTestPlan,
  immutablePlan,
  progressTestPlan,
  sameTabPlan,
  siteAuditPlan,
  templateTestPlan
];

/* Every target and every unique anchor is validated above before the first write. */
plans.forEach(function (plan) {
  fs.writeFileSync(plan.file, plan.next, plan.encoding);
});

console.log('Applied proposal 039: bounded shared progress retention and advanced the immutable loading-calm asset identity.');

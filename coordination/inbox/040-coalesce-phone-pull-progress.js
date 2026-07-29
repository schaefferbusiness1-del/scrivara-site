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

const oldProgressOwner = [
  '  var agentBusy = false;',
  '  function lb(on, label) {',
  '    try {',
  '      var L = window.__mlsLoadingCalm;',
  '      if (!L) return;',
  '      if (on) L.begin(label); else L.end();',
  '    } catch (e) {}',
  '  }'
].join('\n');

const newProgressOwner = [
  '  var agentBusy = false, relayProgress = null;',
  '  /* 2026-07-29: one relay request owns one progress job. Only start creates',
  '     request state; status updates and finish must match that request id. */',
  '  function relayProgressOwner() {',
  '    try { return window.__mlsLoadingCalm || null; } catch (e) { return null; }',
  '  }',
  '  function relayProgressResetOwner(state, owner) {',
  "    state.ownerApi = owner || null; state.handle = null; state.id = '';",
  '    state.legacy = false; state.attached = false;',
  '  }',
  '  function relayProgressAttach(state, label) {',
  '    var L = relayProgressOwner();',
  '    if (!L) return 0;',
  '    if (state.ownerApi !== L) relayProgressResetOwner(state, L);',
  '    if (state.attached) return 2;',
  '    try {',
  "      if (typeof L.start === 'function') {",
  '        var h = L.start({',
  "          key: 'relay:office-active', kind: 'relay_pull', label: label, stage: label,",
  '          timeoutMs: 10 * 60 * 1000, replace: true',
  '        });',
  '        if (!h) return 0;',
  "        state.handle = h; state.id = h.id ? String(h.id) : ''; state.legacy = false; state.attached = true;",
  '        return 1;',
  '      }',
  "      if (typeof L.begin === 'function') {",
  "        var legacyId = L.begin(label); state.id = legacyId ? String(legacyId) : '';",
  '        state.legacy = true; state.attached = true; return 1;',
  '      }',
  '    } catch (e2) {',
  "      state.handle = null; state.id = ''; state.legacy = false; state.attached = false;",
  '    }',
  '    return 0;',
  '  }',
  '  function relayProgressStart(owner, label) {',
  "    var ownerKey = String(owner || ''), message = String(label || '');",
  '    if (!ownerKey) return false;',
  '    if (relayProgress) {',
  '      if (relayProgress.owner === ownerKey) return relayProgressStatus(ownerKey, message);',
  "      relayProgressFinish(relayProgress.owner, { ok: false, message: 'Phone relay was replaced.' });",
  '    }',
  "    relayProgress = { owner: ownerKey, label: message, ownerApi: null, handle: null, id: '', legacy: false, attached: false };",
  '    relayProgressAttach(relayProgress, message);',
  '    return true;',
  '  }',
  '  function relayProgressStatus(owner, label) {',
  "    var ownerKey = String(owner || ''), state = relayProgress, message = String(label || '');",
  '    if (!state || state.owner !== ownerKey) return false;',
  '    state.label = message;',
  '    var attached = relayProgressAttach(state, message);',
  '    if (!attached) return false;',
  '    if (attached === 1) return true;',
  '    try {',
  "      if (state.handle && typeof state.handle.stage === 'function') state.handle.stage(message);",
  "      else if (state.id && state.ownerApi && typeof state.ownerApi.update === 'function') state.ownerApi.update(state.id, { stage: message });",
  '    } catch (e) {}',
  '    return true;',
  '  }',
  '  function relayProgressFinish(owner, outcome) {',
  "    var ownerKey = String(owner || ''), state = relayProgress;",
  '    if (!state || state.owner !== ownerKey) return false;',
  '    outcome = outcome || {};',
  "    var message = String(outcome.message || (outcome.ok === true ? 'Completed.' : 'Phone relay failed.')).slice(0, 160);",
  '    /* A loading satellite can replace its API while a request runs. Reattach',
  '       to the current owner before clearing state so finish never calls a stale',
  '       handle and a swap with no later status still gets one terminal receipt. */',
  '    relayProgressAttach(state, state.label || message);',
  '    relayProgress = null;',
  '    try {',
  '      if (state.handle) {',
  '        if (outcome.ok === true) {',
  "          if (typeof state.handle.complete === 'function') state.handle.complete(message);",
  "        } else if (typeof state.handle.fail === 'function') state.handle.fail({ message: message });",
  "        else if (typeof state.handle.partial === 'function') state.handle.partial(message);",
  "      } else if (state.legacy && state.ownerApi && typeof state.ownerApi.end === 'function') {",
  '        if (state.id) state.ownerApi.end(state.id); else state.ownerApi.end();',
  '      }',
  '    } catch (e) {}',
  '    return true;',
  '  }'
].join('\n');

const oldAgentSettlement = [
  '        api.agentRuns++;',
  "        lb(true, '\xF0\x9F\x93\xB1 Your phone asked the office computer to ' + (job.kind === 'pullDay' ? 'pull a day from Athena\xE2\x80\xA6' : 'read a chart\xE2\x80\xA6'));",
  "        toast('\xF0\x9F\x93\xB1 Phone request received \xE2\x80\x94 running it here (' + job.kind + ').', '');",
  '        var run = relayRunner(job);',
  '        run.then(function (out) {',
  '          lb(false);',
  '          postResult(job.id, out.ok, out.data, out.error).then(function () { agentBusy = false; });',
  "          toast(out.ok ? '\xF0\x9F\x93\xB1 Done \xE2\x80\x94 result sent back to your phone.' : ('\xF0\x9F\x93\xB1 Phone request failed: ' + (out.error || '')), out.ok ? 'ok' : 'err');",
  '        });'
].join('\n');

const newAgentSettlement = [
  '        api.agentRuns++;',
  '        return runAgentJob(job, relayRunner);'
].join('\n');

const oldUnsupportedSettlement = [
  "        if (typeof relayRunner !== 'function') {",
  "          postResult(job.id, false, null, 'unsupported relay kind: ' + String(job.kind))",
  '            .then(function () { agentBusy = false; }, function () { agentBusy = false; });',
  "          toast('\xF0\x9F\x93\xB1 Phone request refused \xE2\x80\x94 this computer does not run \"' + String(job.kind) + '\" jobs.', 'err');",
  '          return;',
  '        }'
].join('\n');

const newUnsupportedSettlement = [
  "        if (typeof relayRunner !== 'function') {",
  '          refuseAgentJob(job);',
  '          return;',
  '        }'
].join('\n');

const agentHelpersAnchor = [
  '  function postResult(id, ok, data, error) {',
  "    return fetch(base() + '/api/relay/jobs/' + encodeURIComponent(id) + '/result', {",
  "      method: 'POST', headers: H(), body: JSON.stringify({ ok: !!ok, data: data == null ? null : data, error: error || null })",
  '    }).catch(function () {});',
  '  }',
  '  /* rl-2.0.0: throttled live progress up to the server so the PHONE sees real'
].join('\n');

const agentHelpersReplacement = [
  '  function postResult(id, ok, data, error) {',
  "    return fetch(base() + '/api/relay/jobs/' + encodeURIComponent(id) + '/result', {",
  "      method: 'POST', headers: H(), body: JSON.stringify({ ok: !!ok, data: data == null ? null : data, error: error || null })",
  '    }).catch(function () {});',
  '  }',
  '  /* 2026-07-29: the runner owns agentBusy, not result transport. Both a',
  '     synchronous throw and a rejected promise settle once, and a stalled',
  '     result request cannot block every later agent poll. */',
  '  function finishAgentJob(job, out) {',
  '    out = out || {};',
  '    var ok = out.ok === true;',
  "    var reportError = ok ? null : String(out.error || 'relay runner returned no verified result');",
  "    relayProgressFinish(job.id, { ok: ok, message: ok ? 'Completed.' : 'Phone relay failed.' });",
  '    agentBusy = false;',
  '    try { postResult(job.id, ok, out.data, reportError); } catch (e) {}',
  "    toast(ok ? '\xF0\x9F\x93\xB1 Done \xE2\x80\x94 result sent back to your phone.' : ('\xF0\x9F\x93\xB1 Phone request failed: ' + reportError), ok ? 'ok' : 'err');",
  '  }',
  '  function refuseAgentJob(job) {',
  "    var reason = 'unsupported relay kind: ' + String(job && job.kind);",
  '    agentBusy = false;',
  '    try { postResult(job.id, false, null, reason); } catch (e) {}',
  "    toast('\xF0\x9F\x93\xB1 Phone request refused \xE2\x80\x94 this computer does not run \"' + String(job.kind) + '\" jobs.', 'err');",
  '  }',
  '  function runAgentJob(job, relayRunner) {',
  "    relayProgressStart(job.id, '\xF0\x9F\x93\xB1 Your phone asked the office computer to ' + (job.kind === 'pullDay' ? 'pull a day from Athena\xE2\x80\xA6' : 'read a chart\xE2\x80\xA6'));",
  "    toast('\xF0\x9F\x93\xB1 Phone request received \xE2\x80\x94 running it here (' + job.kind + ').', '');",
  '    var run;',
  '    try { run = relayRunner(job); }',
  "    catch (runError) { finishAgentJob(job, { ok: false, error: (runError && runError.message) || 'relay runner rejected' }); return Promise.resolve(); }",
  '    return Promise.resolve(run).then(function (out) {',
  '      finishAgentJob(job, out);',
  '    }, function (runError) {',
  "      finishAgentJob(job, { ok: false, error: (runError && runError.message) || 'relay runner rejected' });",
  '    });',
  '  }',
  '  /* rl-2.0.0: throttled live progress up to the server so the PHONE sees real'
].join('\n');

const connectPlan = prepare('mls-connect.js', 'latin1', [
  [
    oldProgressOwner,
    newProgressOwner
  ],
  [
    agentHelpersAnchor,
    agentHelpersReplacement
  ],
  [
    "          try { lb(true, '\xF0\x9F\x93\xB1 Phone pull \xE2\x80\x94 ' + String(m || '').slice(0, 70)); } catch (e) {}",
    "          try { relayProgressStatus(job.id, '\xF0\x9F\x93\xB1 Phone pull \xE2\x80\x94 ' + String(m || '').slice(0, 70)); } catch (e) {}"
  ],
  [
    oldUnsupportedSettlement,
    newUnsupportedSettlement
  ],
  [
    oldAgentSettlement,
    newAgentSettlement
  ]
]);

const testInsertionAnchor = [
  "assert(rl.includes('if (executedJobs[job.id])'), 'agent can execute the same job twice');",
  '',
  'function response(status, body, parseError) {'
].join('\n');

const testInsertion = [
  "assert(rl.includes('if (executedJobs[job.id])'), 'agent can execute the same job twice');",
  '',
  '/* 2026-07-29: one relay request owns one progress job, while runner',
  '   settlement cannot leave the agent single-flight latch behind. */',
  "assert(rl.includes('var agentBusy = false, relayProgress = null;'),",
  "  'relay progress has no explicit request-owned state');",
  "assert(rl.includes('function relayProgressStart(owner, label)') &&",
  "  rl.includes('function relayProgressStatus(owner, label)') &&",
  "  rl.includes('function relayProgressFinish(owner, outcome)'),",
  "  'relay progress is not separated into start, status, and finish transitions');",
  "assert(!rl.includes('if (on) L.begin(label); else L.end();'),",
  "  'relay status still allocates a manual progress job for every update');",
  "assert(rl.includes('relayProgressStatus(job.id,'),",
  "  'relay status does not carry the server job owner');",
  "assert(rl.includes('return runAgentJob(job, relayRunner);'),",
  "  'agent execution does not use the rejection-safe settlement path');",
  "assert(rl.includes('refuseAgentJob(job);'),",
  "  'unsupported relay kind does not use release-before-transport settlement');",
  '',
  "const relayProgressBlock = between(rl, 'var agentBusy = false, relayProgress = null;', 'function postResult(', 'relay progress state machine');",
  "const finishAgentSource = extractFunction(rl, 'function finishAgentJob(job, out)', 'agent settlement helper');",
  "const refuseAgentSource = extractFunction(rl, 'function refuseAgentJob(job)', 'unsupported agent settlement helper');",
  "const runAgentSource = extractFunction(rl, 'function runAgentJob(job, relayRunner)', 'agent runner helper');",
  '',
  'function modernProgressOwner(records, hooks) {',
  '  hooks = hooks || {};',
  '  return {',
  '    start(options) {',
  "      if (hooks.onStart) hooks.onStart(options);",
  '      const record = { options, stages: [], completed: [], failed: [], partial: [] };',
  '      records.push(record);',
  '      return {',
  "        id: 'relay-progress-' + records.length,",
  '        stage(value) { record.stages.push(value); },',
  '        complete(value) { record.completed.push(value); },',
  "        fail(value) { record.failed.push(String(value && value.message || value || '')); },",
  '        partial(value) { record.partial.push(value); }',
  '      };',
  '    }',
  '  };',
  '}',
  '',
  'function relayProgressHarness(owner) {',
  '  const windowObject = { __mlsLoadingCalm: owner };',
  '  const context = { window: windowObject, String };',
  "  vm.runInNewContext(relayProgressBlock + '\\nthis.__relayHarness = {' +",
  "    'start: relayProgressStart, status: relayProgressStatus, finish: relayProgressFinish,' +",
  "    'state: function () { return relayProgress; } };', context);",
  '  return { context, api: context.__relayHarness };',
  '}',
  '',
  'function testRelayProgressStateMachine() {',
  '  const records = [], ownerA = modernProgressOwner(records);',
  '  const harness = relayProgressHarness(ownerA);',
  "  assert.strictEqual(harness.api.start('job-a', 'Starting'), true);",
  '  for (let i = 0; i < 417; i += 1) {',
  "    assert.strictEqual(harness.api.status('job-a', 'Status ' + i), true);",
  '  }',
  "  assert.strictEqual(records.length, 1, 'one request allocated more than one progress job');",
  "  assert.strictEqual(records[0].stages.length, 417, 'current request status updates were dropped');",
  "  assert.strictEqual(records[0].stages[416], 'Status 416', 'latest request status was not preserved');",
  "  assert.strictEqual(harness.api.status('job-stale', 'Stale'), false, 'foreign status changed the current owner');",
  "  assert.strictEqual(harness.api.finish('job-stale', { ok: true }), false, 'foreign finish changed the current owner');",
  "  assert.strictEqual(harness.api.finish('job-a', { ok: true, message: 'Completed.' }), true);",
  "  assert.deepStrictEqual(records[0].completed, ['Completed.'], 'successful request did not complete');",
  "  assert.strictEqual(harness.api.state(), null, 'successful request retained ownership');",
  "  assert.strictEqual(harness.api.status('job-a', 'Late'), false, 'late status was accepted after completion');",
  "  assert.strictEqual(records.length, 1, 'late status allocated an orphan progress job');",
  '',
  '  const oldRecords = [], replacementRecords = [];',
  '  const swap = relayProgressHarness(modernProgressOwner(oldRecords));',
  "  swap.api.start('job-swap', 'Before swap');",
  '  swap.context.window.__mlsLoadingCalm = modernProgressOwner(replacementRecords);',
  "  swap.api.finish('job-swap', { ok: false, message: 'Phone relay failed.' });",
  "  assert.strictEqual(oldRecords[0].completed.length + oldRecords[0].failed.length + oldRecords[0].partial.length, 0,",
  "    'finish called a stale loading-owner handle after replacement');",
  "  assert.strictEqual(replacementRecords.length, 1, 'finish did not attach the replacement loading owner');",
  "  assert.deepStrictEqual(replacementRecords[0].failed, ['Phone relay failed.'],",
  "    'replacement loading owner did not receive the terminal failure');",
  '',
  '  let starts = 0;',
  '  const retryRecords = [];',
  '  const retryOwner = modernProgressOwner(retryRecords, {',
  "    onStart() { starts += 1; if (starts === 1) throw new Error('synthetic first-start failure'); }",
  '  });',
  '  const retry = relayProgressHarness(retryOwner);',
  "  retry.api.start('job-retry', 'Initial');",
  "  assert.strictEqual(retryRecords.length, 0, 'throwing start created a phantom handle');",
  "  assert.strictEqual(retry.api.status('job-retry', 'Synchronous status'), true, 'status did not retry loading-owner start');",
  "  assert.strictEqual(starts, 2, 'loading-owner start did not retry exactly once');",
  "  assert.strictEqual(retryRecords.length, 1, 'start retry allocated the wrong number of handles');",
  "  assert.strictEqual(retryRecords[0].options.stage, 'Synchronous status', 'retry lost the current status');",
  "  retry.api.status('job-retry', 'Later status');",
  "  assert.deepStrictEqual(retryRecords[0].stages, ['Later status'], 'post-retry status did not update the one handle');",
  "  retry.api.finish('job-retry', { ok: true, message: 'Completed.' });",
  "  assert.deepStrictEqual(retryRecords[0].completed, ['Completed.']);",
  '}',
  '',
  'async function testRelayAgentSettlement() {',
  '  const records = [], posts = [], toasts = [];',
  '  const never = new Promise(() => {});',
  '  const windowObject = { __mlsLoadingCalm: modernProgressOwner(records) };',
  '  const context = { Promise, String, Error, window: windowObject, posts, toasts, never };',
  '  vm.runInNewContext(`',
  '    ${relayProgressBlock}',
  '    function postResult(id, ok, data, error) { posts.push({ id: id, ok: ok, data: data, error: error }); return never; }',
  '    function toast(message, kind) { toasts.push({ message: message, kind: kind }); }',
  '    ${finishAgentSource}',
  '    ${refuseAgentSource}',
  '    ${runAgentSource}',
  '    this.__agentHarness = {',
  '      run: runAgentJob, refuse: refuseAgentJob, status: relayProgressStatus,',
  '      busy: function () { return agentBusy; }, setBusy: function (value) { agentBusy = value; }',
  '    };',
  '  `, context);',
  '  const agent = context.__agentHarness;',
  '',
  '  agent.setBusy(true);',
  "  await agent.run({ id: 'sync-job', kind: 'pullDay' }, job => {",
  "    agent.status(job.id, 'Synchronous status');",
  '    return { ok: true, data: { synthetic: true } };',
  '  });',
  "  assert.strictEqual(agent.busy(), false, 'successful plain-result runner retained agentBusy');",
  "  assert.deepStrictEqual(records[0].stages, ['Synchronous status'], 'synchronous runner status arrived before progress start');",
  "  assert.deepStrictEqual(records[0].completed, ['Completed.'], 'successful runner did not complete progress');",
  "  assert.strictEqual(posts[0].ok, true, 'successful runner posted failure');",
  '',
  '  agent.setBusy(true);',
  "  await agent.run({ id: 'reject-job', kind: 'pullDay' }, () => Promise.reject(new Error('synthetic rejection')));",
  "  assert.strictEqual(agent.busy(), false, 'rejected runner retained agentBusy');",
  "  assert.deepStrictEqual(records[1].failed, ['Phone relay failed.'], 'rejected runner did not fail progress');",
  "  assert.strictEqual(posts[1].error, 'synthetic rejection', 'rejected runner did not report its failure');",
  '',
  '  agent.setBusy(true);',
  "  await agent.run({ id: 'throw-job', kind: 'pullChart' }, () => { throw new Error('synthetic throw'); });",
  "  assert.strictEqual(agent.busy(), false, 'synchronously thrown runner retained agentBusy');",
  "  assert.strictEqual(posts[2].error, 'synthetic throw');",
  '',
  '  agent.setBusy(true);',
  "  await agent.run({ id: 'failed-job', kind: 'pullDay' }, () => Promise.resolve({ ok: false, error: 'verified failure' }));",
  "  assert.strictEqual(agent.busy(), false, 'failed result retained agentBusy');",
  "  assert.deepStrictEqual(records[3].failed, ['Phone relay failed.'], 'failed result completed progress');",
  "  assert.strictEqual(posts[3].error, 'verified failure');",
  '',
  '  /* postResult never settles in this harness. Reaching every assertion above',
  '     proves runner settlement and agentBusy release do not await transport. */',
  "  assert.strictEqual(posts.length, 4, 'stalled result transport prevented a later runner from settling');",
  '  agent.setBusy(true);',
  "  agent.refuse({ id: 'unsupported-job', kind: 'syntheticUnsupported' });",
  "  assert.strictEqual(agent.busy(), false, 'unsupported kind retained agentBusy behind result transport');",
  "  assert.strictEqual(posts[4].error, 'unsupported relay kind: syntheticUnsupported');",
  "  assert.strictEqual(toasts[toasts.length - 1].kind, 'err', 'unsupported kind lost its refusal notice');",
  '}',
  '',
  'function response(status, body, parseError) {'
].join('\n');

const mainAnchor = [
  'async function main() {',
  '  await testCalendarAuthoritativeBoundary();'
].join('\n');

const mainReplacement = [
  'async function main() {',
  '  testRelayProgressStateMachine();',
  '  await testRelayAgentSettlement();',
  '  await testCalendarAuthoritativeBoundary();'
].join('\n');

const testPlan = prepare('tests/pull-request-correlation-contract.test.js', 'utf8', [
  [
    testInsertionAnchor,
    testInsertion
  ],
  [
    mainAnchor,
    mainReplacement
  ]
]);

const plans = [connectPlan, testPlan];

/* Every target and every unique anchor is validated above before the first write. */
plans.forEach(function (plan) {
  fs.writeFileSync(plan.file, plan.next, plan.encoding);
});

console.log('Applied proposal 040: one request-owned phone-pull progress job with bounded runner settlement.');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');

function namedFunction(name) {
  const signature = new RegExp('(?:async\\s+)?function\\s+' + name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)\\s*\\{');
  const match = signature.exec(source);
  assert.ok(match, 'missing function ' + name);
  const open = source.indexOf('{', match.index);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error('unterminated function ' + name);
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

const elements = {
  su_name: { value: 'Synthetic Clinician' },
  su_practice: { value: 'Synthetic Practice' },
  setupMsg: { textContent: '', style: {} },
};
const calls = [];
let fetchPlan = [];
const context = {
  console,
  Promise,
  Object,
  Array,
  String,
  Error,
  setTimeout: fn => { fn(); return 1; },
  document: { getElementById: id => elements[id] || null },
  bkBase: () => 'https://backend.example.test',
  bkToken: () => 'synthetic-token',
  bkUser: { role: 'doctor', capabilities: {} },
  fetch: async (url, init) => {
    calls.push({ url, init });
    const next = fetchPlan.shift();
    if (next instanceof Error) throw next;
    return next;
  },
  SU_STATUS: { NOT_STARTED: 'not_started', IN_PROGRESS: 'in_progress', DEFERRED: 'deferred', COMPLETED: 'completed' },
  SU_STATE: { status: 'in_progress', currentStep: 'profile', completedSteps: [], error: '', capabilities: {}, role: 'doctor', tier: 'standard' },
  SU_STEP: 1,
  SU_MAX: 5,
  suIsProvider: () => true,
  suAllowedSteps: () => [0, 1, 4, 5],
  suPersistIdentity: async () => true,
  suShow: () => {},
  saveAvailability: async () => true,
  suFinish: async () => true,
};
vm.createContext(context);
for (const name of [
  'suActionableError',
  'suOnboardingFetch',
  'suNormalizeOnboarding',
  'suClientCompleted',
  'suCompletedWith',
  'suSaveOnboarding',
  'suNext',
]) vm.runInContext(namedFunction(name), context);

(async () => {
  /* The exact live failure: the first PUT transport rejects. Replaying the
     replacement payload is idempotent, and the second acceptance advances. */
  fetchPlan = [
    new TypeError('Failed to fetch'),
    response(200, { onboarding: { status: 'in-progress', currentStep: 'preferences', completedSteps: ['profile', 'practice'], capabilities: {} } }),
  ];
  const button = { disabled: false, textContent: 'Next →' };
  await context.suNext(button);
  assert.equal(calls.length, 2, 'the safe onboarding PUT was not retried once');
  for (const call of calls) {
    assert.equal(call.url, 'https://backend.example.test/api/onboarding/state');
    assert.equal(call.init.method, 'PUT');
    assert.equal(call.init.headers.Authorization, 'Bearer synthetic-token');
    assert.deepEqual(JSON.parse(call.init.body), {
      completedSteps: ['profile', 'practice'],
      step: 'practice',
    });
  }
  assert.equal(context.SU_STEP, 4, 'a confirmed retry did not advance to the next allowed step');
  assert.equal(context.SU_STATE.error, '');
  assert.equal(button.disabled, false);

  /* Transient HTTP gateway failures retry; a real client error does not. */
  calls.length = 0;
  fetchPlan = [response(503, {}), response(200, { onboarding: { status: 'in-progress', completedSteps: [], capabilities: {} } })];
  assert.equal((await context.suOnboardingFetch({ method: 'GET', headers: {} })).status, 200);
  assert.equal(calls.length, 2);
  calls.length = 0;
  fetchPlan = [response(400, { error: 'invalid' })];
  assert.equal((await context.suOnboardingFetch({ method: 'PUT', headers: {} })).status, 400);
  assert.equal(calls.length, 1, 'a non-transient client error was retried');

  /* Exhausted network failure remains on the same step and never leaks the
     browser's opaque implementation text into the setup UI. */
  calls.length = 0;
  context.SU_STEP = 1;
  context.SU_STATE.error = '';
  context.suPersistIdentity = async () => { throw new TypeError('Failed to fetch'); };
  elements.setupMsg.textContent = '';
  await context.suNext(button);
  assert.equal(context.SU_STEP, 1);
  assert.match(elements.setupMsg.textContent, /could not reach MLS/i);
  assert.match(elements.setupMsg.textContent, /entries are still here/i);
  assert.doesNotMatch(elements.setupMsg.textContent, /failed to fetch/i);
  assert.equal(button.disabled, false);

  console.log('PASS setup onboarding network runtime: idempotent PUT retry, transient HTTP retry, and actionable non-raw failure');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

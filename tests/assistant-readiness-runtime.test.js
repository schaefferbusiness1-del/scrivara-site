'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function assistantDocument() {
  return {
    readyState: 'loading',
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    querySelector(sel) { return sel.includes('mls-connect.staging.js') ? {} : null; }
  };
}

function testIncompleteAssistantMarkerSelfHeals() {
  const poisoned = { installed: true, version: '2.9.18' };
  const context = {
    console,
    location: { pathname: '/ScribeFlow.html' },
    document: assistantDocument(),
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    __mlsAsstFix: poisoned
  };
  context.window = context;
  vm.runInNewContext(read('feat_mls_asst_fix.js'), context, { filename: 'feat_mls_asst_fix.js' });
  assert.notStrictEqual(context.__mlsAsstFix, poisoned, 'an incomplete extension-version marker still blocked the real assistant bridge');
  assert.strictEqual(context.__mlsAsstFix.installed, true);
  assert.strictEqual(context.__mlsAsstFix.version, '1.4.1');
  assert.strictEqual(typeof context.__mlsAsstFix._handleSend, 'function');
  assert.strictEqual(typeof context.__mlsAsstFix.registerIntent, 'function');
}

function testProductionAssistantActuallyInstalls() {
  const context = {
    console,
    location: { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' },
    document: {
      readyState: 'loading', addEventListener() {}, removeEventListener() {},
      getElementById() { return null; }, querySelector() { return null; }
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
  };
  context.window = context;
  vm.runInNewContext(read('feat_mls_asst_fix.js'), context, { filename: 'feat_mls_asst_fix.js' });
  assert.strictEqual(context.__mlsAsstFix.installed, true, 'production MLS page left the assistant behind the old staging-only gate');
  assert.strictEqual(typeof context.__mlsAsstFix._handleSend, 'function');
}

function makeVoiceHarness() {
  let now = 1000;
  let activeId = 'A';
  let visitBinding = { id: 'visit-A' };
  let visitEpoch = 1;
  let recordCalls = 0;
  const toasts = [];
  const timers = [];
  const FakeDate = function (...args) { return new Date(...args); };
  FakeDate.now = () => now;
  FakeDate.prototype = Date.prototype;

  const document = {
    readyState: 'loading',
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    createElement() { return { style: {}, classList: { toggle() {} }, remove() {} }; },
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { appendChild() {} }
  };
  const context = {
    console, Promise, Date: FakeDate, Math, JSON, Object, String, Array, RegExp,
    document,
    currentVisitAthenaBinding: visitBinding,
    currentVisitAthenaEpoch: visitEpoch,
    getActivePtId() { return activeId; },
    activePatient() { return { id: activeId, name: activeId === 'A' ? 'Patient A' : 'Patient B' }; },
    getPatients() { return []; },
    startCapture() { recordCalls++; },
    toast(message) { toasts.push(String(message)); },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {},
    _athenaAsyncBindingStillSafe(candidate, action, epoch) {
      return candidate === context.currentVisitAthenaBinding &&
        candidate.id === context.currentVisitAthenaBinding.id &&
        Number(epoch) === Number(context.currentVisitAthenaEpoch);
    }
  };
  context.window = context;
  vm.runInNewContext(read('feat_mls_copilot_voice_v2.js'), context, { filename: 'feat_mls_copilot_voice_v2.js' });
  return {
    context,
    api: context.__mlsCopilotVoiceV2,
    toasts,
    timers,
    advance(ms) { now += ms; },
    recordCalls() { return recordCalls; },
    setPatient(id) { activeId = id; },
    setVisit(id, epoch) {
      visitBinding = { id };
      visitEpoch = epoch;
      context.currentVisitAthenaBinding = visitBinding;
      context.currentVisitAthenaEpoch = visitEpoch;
    }
  };
}

function bridge(delivered, registerIntent) {
  return {
    installed: true,
    _handleSend(text) { delivered.push(text); },
    registerIntent: registerIntent || function () { return function unregister() {}; }
  };
}

function testQueueFlushesExactlyOnce() {
  const h = makeVoiceHarness();
  h.context.__mlsAsstFix = { installed: true, version: '2.9.18' };
  assert.strictEqual(h.api._test.assistantBridgeReady(), false, 'installed-without-methods was mistaken for a ready assistant bridge');
  h.api._testHandle("pull today's patients");
  assert.strictEqual(h.api._test.pendingAssistant().length, 1, 'cold assistant utterance was not queued');
  assert(h.toasts.some(t => /saved that command/i.test(t)), 'queue did not explain that the command was saved');

  const delivered = [];
  h.context.__mlsAsstFix = bridge(delivered);
  assert.strictEqual(h.api._test.flushPendingAssistant(), true, 'ready bridge did not consume the queued command');
  h.api._test.flushPendingAssistant();
  assert.deepStrictEqual(delivered, ["pull today's patients"], 'queued command was lost, reordered, or dispatched more than once');
  assert.strictEqual(h.api._test.pendingAssistant().length, 0);
}

function testQueueBoundExpiryAndOwnership() {
  const bounded = makeVoiceHarness();
  for (let i = 1; i <= 5; i++) bounded.api._test.queueAssistantText('question ' + i);
  assert.strictEqual(
    Array.from(bounded.api._test.pendingAssistant(), item => item.text).join('|'),
    'question 2|question 3|question 4|question 5',
    'assistant startup queue was not a bounded FIFO'
  );
  assert(bounded.toasts.some(t => /queue was full/i.test(t)), 'queue overflow was silent');

  const expired = makeVoiceHarness();
  expired.api._test.queueAssistantText('summarize this visit');
  expired.advance(10001);
  expired.api._test.flushPendingAssistant();
  assert.strictEqual(expired.api._test.pendingAssistant().length, 0, 'expired assistant command remained runnable');
  assert(expired.toasts.some(t => /did not finish loading in time/i.test(t)), 'expiry did not honestly say the command was not run');

  const switched = makeVoiceHarness();
  switched.api._test.queueAssistantText('what is next');
  switched.setPatient('B');
  switched.setVisit('visit-B', 2);
  switched.api._test.flushPendingAssistant();
  assert.strictEqual(switched.api._test.pendingAssistant().length, 0, 'old-patient assistant command survived a patient/visit switch');
  assert(switched.toasts.some(t => /patient, visit, or voice session changed/i.test(t)), 'owner cancellation was silent');

  const stopped = makeVoiceHarness();
  stopped.api._test.queueAssistantText('how many patients today');
  stopped.api.stop();
  assert.strictEqual(stopped.api._test.pendingAssistant().length, 0, 'voice stop left a delayed command runnable');
  assert(stopped.toasts.some(t => /queued assistant command was canceled/i.test(t)), 'voice stop did not disclose queue cancellation');
}

function testFailedDispatchIsNeverDuplicated() {
  const h = makeVoiceHarness();
  h.api._test.queueAssistantText('how many patients today');
  let calls = 0;
  h.context.__mlsAsstFix = {
    installed: true,
    registerIntent() { return function unregister() {}; },
    _handleSend() { calls++; throw new Error('receiver failed after starting'); }
  };
  h.api._test.flushPendingAssistant();
  h.api._test.flushPendingAssistant();
  assert.strictEqual(calls, 1, 'failed assistant handoff was retried and could duplicate an action');
  assert.strictEqual(h.api._test.pendingAssistant().length, 0);
  assert(h.toasts.some(t => /did not retry/i.test(t)), 'failed exact-once handoff was not explained');
}

function testIntentRegistrationRollsBackAndRetries() {
  const h = makeVoiceHarness();
  let calls = 0;
  let active = 0;
  let rollbacks = 0;
  h.context.__mlsAsstFix = bridge([], function () {
    calls++;
    if (calls === 3) throw new Error('cold partial registration');
    active++;
    let live = true;
    return function unregister() {
      if (!live) return;
      live = false;
      active--;
      rollbacks++;
    };
  });
  assert.strictEqual(h.api._test.registerIntents(), false, 'partial registration was marked ready');
  assert.strictEqual(active, 0, 'partial voice intents were not rolled back');
  assert.strictEqual(rollbacks, 2, 'each successfully registered partial intent must be removed once');
  assert.strictEqual(h.api._test.registerIntents(), true, 'voice intents did not retry after rollback');
  assert.strictEqual(active, 10, 'retry did not install exactly one complete voice-intent set');
  const afterSuccess = calls;
  assert.strictEqual(h.api._test.registerIntents(), true);
  assert.strictEqual(calls, afterSuccess, 'completed voice intents registered twice');
}

function testRegistrationFailureCannotDuplicateLocalAction() {
  const h = makeVoiceHarness();
  let chatCalls = 0;
  h.context.__mlsAsstFix = {
    installed: true,
    _handleSend() { chatCalls++; },
    registerIntent() { throw new Error('registration unavailable'); }
  };
  h.api._testHandle('start recording');
  assert.strictEqual(h.recordCalls(), 1, 'deterministic voice action did not use its safe local fallback');
  assert.strictEqual(chatCalls, 0, 'the same voice action also went to chat and could execute twice');
}

function testDeterministicCommandsStayLocalAndVerifyHonestly() {
  /* A healthy assistant bridge must NOT receive deterministic visit commands:
     routing them into chat popped the panel open and let the Copilot AI reply
     "started recording" without starting anything (cv2-1.2.0 regression). */
  const h = makeVoiceHarness();
  const delivered = [];
  h.context.__mlsAsstFix = bridge(delivered);
  h.api._testHandle('start recording');
  assert.strictEqual(h.recordCalls(), 1, 'local record leg did not run with a healthy bridge');
  assert.deepStrictEqual(delivered, [], 'deterministic voice command leaked into the assistant chat');
  assert(!h.toasts.some(t => /Recording for/i.test(t)), 'voice claimed recording before verifying capture state');

  /* Capture never actually started (no `capturing`, no button) -> the deferred
     check must admit failure instead of celebrating. */
  h.timers.splice(0).forEach(fn => fn());
  assert(h.toasts.some(t => /did not start/i.test(t)), 'voice never admitted that recording failed to start');

  /* Consent gate open -> the deferred check points at the consent step. */
  const consented = makeVoiceHarness();
  consented.context.__mlsAsstFix = bridge([]);
  consented.context.document.getElementById = id =>
    id === '_mlsAskDialog' ? { textContent: 'Confirm consent and start capture' } : null;
  consented.api._testHandle('start recording');
  consented.timers.splice(0).forEach(fn => fn());
  assert(consented.toasts.some(t => /consent/i.test(t)), 'voice did not point at the pending consent step');
  assert(!consented.toasts.some(t => /Recording for/i.test(t)), 'voice claimed recording while consent was still pending');

  /* Capture genuinely running -> the success line is allowed. */
  const live = makeVoiceHarness();
  live.context.__mlsAsstFix = bridge([]);
  live.context.capturing = true;
  live.api._testHandle('start recording');
  live.timers.splice(0).forEach(fn => fn());
  assert(live.toasts.some(t => /Recording for Patient A/i.test(t)), 'verified recording start was not announced');

  /* Unknown text is still a real chat question and still reaches the bridge. */
  const chat = makeVoiceHarness();
  const chatDelivered = [];
  chat.context.__mlsAsstFix = bridge(chatDelivered);
  chat.api._testHandle('summarize this visit');
  assert.deepStrictEqual(chatDelivered, ['summarize this visit'], 'non-deterministic question no longer reaches the assistant');
}

testIncompleteAssistantMarkerSelfHeals();
testProductionAssistantActuallyInstalls();
testQueueFlushesExactlyOnce();
testQueueBoundExpiryAndOwnership();
testFailedDispatchIsNeverDuplicated();
testIntentRegistrationRollsBackAndRetries();
testRegistrationFailureCannotDuplicateLocalAction();
testDeterministicCommandsStayLocalAndVerifyHonestly();
console.log('PASS assistant readiness: incomplete markers self-heal; queued voice commands are bounded, owner-frozen, exact-once, cancellable, and retry-safe');

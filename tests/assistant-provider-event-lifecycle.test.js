'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_asst_fix.js'), 'utf8');

assert(!source.includes('providerPoll'), 'legacy permanent providerPoll remains');
assert(!/setInterval\([^]{0,180}5000/.test(source), 'Assistant still refreshes providers forever every five seconds');
assert(source.includes('mls:provider-roster-changed') && source.includes('mls:calendar-changed') && source.includes('mls:view-changed'), 'canonical provider/calendar/UI events are not wired');

const start = source.indexOf('function providerRefresh()');
const end = source.indexOf('  /* =====================================================================', start);
assert(start >= 0 && end > start, 'provider lifecycle implementation was not found');
const lifecycle = source.slice(start, end);

let syncCalls = 0, nextTimer = 0;
const timers = [], handlers = {};
const context = {
  console,
  syncProviders() { syncCalls++; },
  isFn(fn) { return typeof fn === 'function'; },
  safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
  setTimeout(fn) { const timer = { id: ++nextTimer, fn }; timers.push(timer); return timer.id; },
  clearTimeout(id) { const timer = timers.find(item => item.id === id); if (timer) timer.fn = null; },
  addEventListener(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); },
  removeEventListener(name, fn) { if (handlers[name]) handlers[name] = handlers[name].filter(item => item !== fn); }
};
context.window = context;
vm.runInNewContext(`
  var providerEvents = [], providerRetryTimer = null, providerRetryTries = 0, providerLateStarted = false;
  ${lifecycle}
  this.__providerLifecycle = { bindProviderEvents, unbindProviderEvents, startProviderLateRetry, stopProviderLateRetry };
`, context, { filename: 'assistant-provider-lifecycle.js' });

const api = context.__providerLifecycle;
api.bindProviderEvents();
assert.strictEqual((handlers['mls:provider-roster-changed'] || []).length, 1);
assert.strictEqual((handlers['focus'] || []).length, 1);

handlers['mls:provider-roster-changed'][0]();
handlers['mls:calendar-changed'][0]();
assert.strictEqual(syncCalls, 2, 'canonical provider/calendar events did not refresh the selector');

const beforeRetry = syncCalls;
api.startProviderLateRetry();
while (timers.length) { const timer = timers.shift(); if (timer.fn) timer.fn(); }
assert.strictEqual(syncCalls - beforeRetry, 12, 'late provider recovery was not bounded to exactly 12 passes');
api.startProviderLateRetry();
assert.strictEqual(timers.length, 0, 'completed provider recovery restarted itself');

api.unbindProviderEvents();
const afterUnbind = syncCalls;
(handlers['mls:provider-roster-changed'] || []).forEach(fn => fn());
assert.strictEqual(syncCalls, afterUnbind, 'provider lifecycle event remained active after revert');

console.log('PASS Assistant providers: canonical event refresh with one bounded late-start retry and no permanent five-second loop');

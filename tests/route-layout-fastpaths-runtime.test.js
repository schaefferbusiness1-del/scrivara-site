'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const upnow = fs.readFileSync(path.join(root, 'feat_mls_upnow_sync.js'), 'utf8');
const redesign = fs.readFileSync(path.join(root, 'feat_mls_redesign.js'), 'utf8');

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `missing ${signature}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${signature}`);
}

const upnowFns = [
  functionSource(upnow, 'function heroBox()'),
  functionSource(upnow, 'function visitDefinitelyHidden()'),
  functionSource(upnow, 'function heroVisible()'),
  functionSource(upnow, 'function scheduleSync()')
].join('\n');

assert(
  upnow.indexOf('if (visitDefinitelyHidden()) return false;', upnow.indexOf('function heroVisible()')) <
    upnow.indexOf('getComputedStyle(h)', upnow.indexOf('function heroVisible()')),
  'Up Now reads computed style before its hidden-route fast path'
);

const visitView = { style: { display: 'none' } };
const hero = { style: { display: 'block' } };
let heroComputedReads = 0;
let syncCalls = 0;
let nextTimer = 1;
const timers = new Map();
const upnowContext = {
  HERO: 'heroToday',
  document: { getElementById: id => ({ visitView, heroToday: hero }[id] || null) },
  $: id => ({ visitView, heroToday: hero }[id] || null),
  getComputedStyle: () => { heroComputedReads += 1; return { display: 'block' }; },
  setTimeout: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
  sync: () => { syncCalls += 1; }
};
vm.createContext(upnowContext);
vm.runInContext(`var _t = null; ${upnowFns}; this.api = { heroVisible, scheduleSync };`, upnowContext);

assert.strictEqual(upnowContext.api.heroVisible(), false, 'hidden Visit did not suppress Up Now work');
upnowContext.api.scheduleSync();
assert.strictEqual(timers.size, 0, 'hidden Visit mutation scheduled Up Now reconciliation');
assert.strictEqual(heroComputedReads, 0, 'hidden Visit forced a computed-style/layout read');

visitView.style.display = 'block';
assert.strictEqual(upnowContext.api.heroVisible(), true, 'visible Visit lost the original hero visibility result');
assert.strictEqual(heroComputedReads, 1, 'visible Visit did not use the original visibility fallback');
upnowContext.api.scheduleSync();
assert.strictEqual(timers.size, 1, 'visible Visit did not schedule Up Now reconciliation');
visitView.style.display = 'none';
const queuedWhileVisible = [...timers.values()];
timers.clear();
queuedWhileVisible.forEach(fn => fn());
assert.strictEqual(syncCalls, 0, 'Up Now reconciliation ran after Visit became hidden');

visitView.style.display = 'block';
upnowContext.api.scheduleSync();
const visibleTimers = [...timers.values()];
timers.clear();
visibleTimers.forEach(fn => fn());
assert.strictEqual(syncCalls, 1, 'visible Visit reconciliation no longer runs');

const loginFn = functionSource(redesign, 'function isOnLogin()');
assert(
  loginFn.indexOf("a.style.display==='none'") < loginFn.indexOf('getComputedStyle(a)'),
  'redesign reads layout before its authenticated-state fast path'
);

const auth = {
  style: { display: 'none' },
  getBoundingClientRect() { throw new Error('hidden authenticated state must not measure geometry'); }
};
let authComputedReads = 0;
const redesignContext = {
  document: { querySelector: () => auth },
  getComputedStyle: () => {
    authComputedReads += 1;
    return { display: 'flex', visibility: 'visible' };
  }
};
vm.createContext(redesignContext);
vm.runInContext(`${loginFn}; this.isOnLogin = isOnLogin;`, redesignContext);

assert.strictEqual(redesignContext.isOnLogin(), false, 'authenticated hidden auth screen was treated as login');
assert.strictEqual(authComputedReads, 0, 'authenticated route switch forced an auth layout read');

let rectReads = 0;
auth.style.display = 'flex';
auth.getBoundingClientRect = () => { rectReads += 1; return { height: 100 }; };
assert.strictEqual(redesignContext.isOnLogin(), true, 'visible login screen lost its original geometry check');
assert.strictEqual(authComputedReads, 1, 'ambiguous/visible login state did not use the original style fallback');
assert.strictEqual(rectReads, 1, 'visible login state did not use the original geometry fallback');

console.log('PASS route layout fast paths: hidden Visit/auth states avoid layout; ambiguous and visible states retain original checks');

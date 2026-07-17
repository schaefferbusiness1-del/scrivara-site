'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_premium_gate.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
new Function(source); // syntax gate

assert(connect.includes("feat_mls_premium_gate.js';"), 'pmg satellite is not injected by mls-connect.js');
assert(connect.includes('?v=20260717pmg100'), 'pmg satellite injection is not cache-busted');

function fakeBtn(id, text) {
  const b = { id, textContent: text, closest: (sel) => b };
  return b;
}

const listeners = {};
const document = {
  readyState: 'complete',
  addEventListener(type, fn) { listeners['d:' + type] = fn; },
  removeEventListener() {}
};
const window = {};
window.window = window;

const context = {
  window, document, Date, String, Math, console,
  bkUser: null,
  effectivePremium: () => false,
  toastCalls: [],
  toast(msg, kind) { context.toastCalls.push({ msg, kind }); }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_premium_gate.js' });

const api = window.__mlsPremiumGate;
assert(api && api.installed && api.version === 'pmg-1.0.0', 'premium gate did not install');

// target detection by id and by label
assert.strictEqual(api._test.gateTarget(fakeBtn('mlsCompBtn', 'x')), 'Pay Report');
assert.strictEqual(api._test.gateTarget(fakeBtn('mlsPrvbBtn', 'x')), 'Pay Report');
assert.strictEqual(api._test.gateTarget(fakeBtn('', '💵 Pay Report')), 'Pay Report');
assert.strictEqual(api._test.gateTarget(fakeBtn('ez3sReviews', 'x')), 'Reviews & reputation');
assert.strictEqual(api._test.gateTarget(fakeBtn('', '⭐ Reviews & reputation')), 'Reviews & reputation');
assert.strictEqual(api._test.gateTarget(fakeBtn('', 'Start recording')), '', 'non-premium control must not match');

// logged out / demo -> never blocks
assert.strictEqual(api._test.signedInNonPremium(), false, 'logged-out must not be gated');

// signed-in Standard (no premium) -> gated, click blocked with upsell toast
context.bkUser = { email: 'doc@x.test', premium: 0 };
assert.strictEqual(api._test.signedInNonPremium(), true, 'signed-in non-premium must be gated');
let stopped = 0;
const ev = { target: fakeBtn('mlsCompBtn', 'Pay Report'), preventDefault() { stopped++; }, stopImmediatePropagation() { stopped++; } };
listeners['d:click'](ev);
assert.strictEqual(stopped, 2, 'gated click was not blocked');
assert.strictEqual(context.toastCalls.length, 1, 'upsell toast missing');
assert(/Premium feature/.test(context.toastCalls[0].msg), 'upsell copy wrong');

// premium account -> passes through untouched
context.bkUser = { email: 'doc@x.test', premium: 1 };
context.effectivePremium = () => true;
const ev2 = { target: fakeBtn('mlsCompBtn', 'Pay Report'), preventDefault() { throw new Error('premium click must not be blocked'); }, stopImmediatePropagation() {} };
listeners['d:click'](ev2);

// admin implies premium via effectivePremium — same pass-through
context.bkUser = { email: 'schaefferbusiness1@gmail.com', isAdmin: true };
listeners['d:click'](ev2);

console.log('premium-gate-runtime: all assertions passed');

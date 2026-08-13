'use strict';

/* Executed loader contract for the FREE 1p Legal / IME preview. This extracts
   only the canonical loader IIFE from the real 1p bundle and uses a controlled
   clock/DOM. No patient data, network, production asset, or extension is used. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const start = bundle.indexOf(";(function(){try{\n  var A='feat_mls_legalpack.js',SRC='1p-feat_mls_legalpack.js'");
assert(start >= 0, 'real 1p Legal loader start not found');
const end = bundle.indexOf('/* 1p FREE Legal / IME preview:', start);
assert(end > start, 'real 1p Legal loader end not found');
const loader = bundle.slice(start, end);
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function runtime(options = {}) {
  let nextTimer = 1;
  const timers = new Map(), scripts = [];
  function setTimeoutFake(fn) { const id = nextTimer++; timers.set(id, fn); return id; }
  function clearTimeoutFake(id) { timers.delete(id); }
  function tick() { const current = [...timers.entries()]; timers.clear(); current.forEach(([, fn]) => fn()); }
  function node() {
    return {
      attrs: {}, parentNode: null,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; }
    };
  }
  const head = {
    appendChild(item) { item.parentNode = this; scripts.push(item); return item; },
    removeChild(item) { const at = scripts.indexOf(item); if (at >= 0) scripts.splice(at, 1); item.parentNode = null; }
  };
  const document = {
    head, documentElement: head,
    createElement(tag) { assert.strictEqual(tag, 'script'); return node(); },
    querySelectorAll(selector) {
      if (selector !== 'script[data-mls-asset="feat_mls_legalpack.js"]') return [];
      return scripts.filter(item => item.getAttribute('data-mls-asset') === 'feat_mls_legalpack.js');
    }
  };
  const window = { __MLS_AV: 'synthetic-preview' };
  if (options.shared) window.__mlsLegalPack = options.shared;
  if (options.existingP1) window.__mlsP1LegalPack = options.existingP1;
  if (options.priorLoader) {
    options.priorLoader._actualWindow = window;
    window.__mlsP1LegalLoader = options.priorLoader;
  }
  const randomValues = options.randomValues || [0.125, 0.25]; let randomIndex = 0;
  const controlledMath = Object.create(Math);
  controlledMath.random = () => randomValues[Math.min(randomIndex++, randomValues.length - 1)];
  const context = { window, document, setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake, console, Math: controlledMath };
  vm.createContext(context);
  function evalLoader() { vm.runInContext(loader, context, { filename: '1p-mls-connect.js#legal-loader' }); }
  evalLoader();
  return { window, document, scripts, timers, tick, context, evalLoader };
}

/* Fresh success publishes only the unique 1p source under canonical identity. */
{
  const r = runtime(), ctl = r.window.__mlsP1LegalLoader;
  eq(r.scripts.length, 1, 'fresh loader did not create one script');
  eq(r.scripts[0].src, '1p-feat_mls_legalpack.js?v=synthetic-preview', 'fresh loader requested the wrong source');
  eq(r.scripts[0].getAttribute('data-mls-asset'), 'feat_mls_legalpack.js', 'fresh loader lost canonical identity');
  eq(r.scripts[0].getAttribute('data-mls-load-state'), 'loading', 'fresh loader did not expose loading state');
  r.window.__mlsP1LegalPack = { installed: true, version: 'p1-legal-1.0.0', installToken: ctl.installToken };
  r.scripts[0].onload();
  eq(ctl.state, 'ready', 'verified owner did not move loader to ready');
  eq(r.scripts[0].getAttribute('data-mls-load-state'), 'ready', 'verified script did not expose ready state');
}

/* Network failure removes the failed tag, retries once, then stops bounded. */
{
  const r = runtime(), ctl = r.window.__mlsP1LegalLoader, first = r.scripts[0];
  first.onerror();
  eq(r.scripts.length, 0, 'network-failed script remained canonical or mounted');
  eq(first.getAttribute('data-mls-asset'), null, 'network-failed script retained canonical identity');
  eq(r.timers.size, 1, 'network failure did not schedule one bounded retry');
  r.tick(); eq(r.scripts.length, 1, 'network failure did not retry exactly once');
  const second = r.scripts[0]; second.onerror();
  eq(r.scripts.length, 0, 'second network-failed script remained mounted');
  eq(r.timers.size, 0, 'bounded second failure scheduled an unbounded retry');
  eq(ctl.attempts, 2, 'network retry count exceeded or missed the cap');
  eq(ctl.ensure(), false, 'bounded failed loader started a third request');
  eq(ctl.state, 'failed-bounded', 'bounded failure state is dishonest');
}

/* HTTP load without exact API owner is also removed and retryable. */
{
  const r = runtime(), first = r.scripts[0];
  first.onload();
  eq(r.scripts.length, 0, 'owner-missing loaded tag remained mounted');
  eq(first.getAttribute('data-mls-load-state'), 'owner-missing', 'owner-missing state was not recorded');
  eq(r.timers.size, 1, 'owner-missing did not schedule one retry');
  r.tick();
  const ctl = r.window.__mlsP1LegalLoader;
  r.window.__mlsP1LegalPack = { installed: true, version: 'p1-legal-1.0.0', installToken: ctl.installToken };
  r.scripts[0].onload();
  eq(r.window.__mlsP1LegalLoader.state, 'ready', 'owner-missing retry could not recover');
}

/* A reversible shared hot owner is retired before the 1p source mounts. */
{
  let reverted = 0;
  const shared = { installed: true, revert() { reverted++; this.installed = false; } };
  const r = runtime({ shared });
  eq(reverted, 1, 'shared hot Legal owner was not reverted');
  eq(r.scripts.length, 1, '1p source did not mount after reversible shared takeover');
}

/* An unrevertible shared hot owner fails closed and loads nothing. */
{
  const r = runtime({ shared: { installed: true } });
  eq(r.scripts.length, 0, 'loader overlaid an unrevertible shared Legal owner');
  eq(r.window.__mlsP1LegalLoader.state, 'blocked-shared-owner', 'shared-owner refusal was not explicit');
  eq(r.timers.size, 0, 'shared-owner refusal hot-looped');
}
{
  let sharedReverted = 0, p1Reverted = 0;
  const p1 = { installed: true, version: 'p1-legal-1.0.0', installToken: 'p1-legal-4i', revert() { p1Reverted++; this.installed = false; } };
  const shared = { installed: true, revert() { sharedReverted++; this.installed = false; } };
  const r = runtime({ shared, existingP1: p1 });
  eq(sharedReverted, 1, 'exact p1 owner did not retire reversible shared contamination');
  eq(p1Reverted, 0, 'reversible shared cleanup unnecessarily reverted exact p1 owner');
  eq(r.window.__mlsP1LegalLoader.state, 'ready', 'exact p1 owner did not become ready after shared cleanup');
  eq(r.scripts.length, 0, 'exact p1 owner mounted a duplicate script');
}
{
  let p1Reverted = 0;
  const p1 = { installed: true, version: 'p1-legal-1.0.0', installToken: 'p1-legal-4i', revert() { p1Reverted++; this.installed = false; } };
  const r = runtime({ shared: { installed: true }, existingP1: p1 });
  eq(r.window.__mlsP1LegalLoader.state, 'blocked-shared-owner', 'exact p1 + unrevertible shared contamination was marked ready');
  eq(p1Reverted, 1, 'fail-closed shared refusal left exact p1 owner active');
  eq(r.scripts.length, 0, 'dual-owner refusal mounted another script');
}

/* A different-version loader must be reversibly retired; unrevertible prior
   ownership blocks replacement instead of orphaning its timer/tag/API. */
{
  let reverted = 0;
  const prior = { installed: true, version: 'p1-legal-old', revert() {
    reverted++; this.installed = false; delete this._actualWindow.__mlsP1LegalLoader;
  } };
  const r = runtime({ priorLoader: prior });
  eq(reverted, 1, 'different-version prior loader was not reverted');
  ok(r.window.__mlsP1LegalLoader !== prior, 'different-version prior loader still owns the canonical key');
  eq(r.scripts.length, 1, 'new loader did not mount after reversible prior takeover');
}
{
  const prior = { installed: true, version: 'p1-legal-old' };
  const r = runtime({ priorLoader: prior });
  eq(r.window.__mlsP1LegalLoader, prior, 'unrevertible prior loader was overwritten');
  eq(r.scripts.length, 0, 'unrevertible prior loader allowed a duplicate script');
  eq(r.timers.size, 0, 'unrevertible prior loader triggered a retry');
}

/* Revert cancels pending retry, removes only its tag, and removes its API. */
{
  let apiReverted = 0;
  const r = runtime(), ctl = r.window.__mlsP1LegalLoader, oldNode = r.scripts[0];
  const lateLoad = oldNode.onload, lateError = oldNode.onerror;
  r.scripts[0].onerror();
  r.window.__mlsP1LegalPack = { installed: true, version: 'p1-legal-1.0.0', installToken: ctl.installToken, revert() { apiReverted++; } };
  ctl.revert();
  eq(r.timers.size, 0, 'loader revert left retry timer alive');
  eq(r.scripts.length, 0, 'loader revert left its script mounted');
  eq(apiReverted, 1, 'loader revert did not call preview API revert');
  eq(r.window.__mlsP1LegalLoader, undefined, 'loader revert left its controller installed');
  let orphanReverted = 0;
  r.window.__mlsP1LegalPack = { installed: true, version: 'p1-legal-1.0.0', installToken: ctl.installToken, revert() {
    orphanReverted++; delete r.window.__mlsP1LegalPack;
  } };
  if (lateLoad) lateLoad(); if (lateError) lateError(); r.tick();
  eq(orphanReverted, 1, 'late exact preview owner was not disposed after loader revert');
  eq(r.window.__mlsP1LegalPack, undefined, 'late exact preview API survived loader revert callback');
  eq(r.timers.size, 0, 'late callback after loader revert scheduled a timer');
  eq(r.scripts.length, 0, 'late callback after loader revert mounted a tag');
  eq(r.window.__mlsP1LegalLoader, undefined, 'late callback after loader revert resurrected controller');
  eq(ctl.ensure(), false, 'reverted detached controller could still ensure a load');
}

/* A stale controller's saved callbacks and revert can never destroy a newer
   same-version controller/API. Ownership is the per-install token, not version. */
{
  const r = runtime({ randomValues: [0.125, 0.25] });
  const oldCtl = r.window.__mlsP1LegalLoader, oldNode = r.scripts[0];
  const oldLoad = oldNode.onload, oldError = oldNode.onerror;
  oldCtl.revert();
  r.evalLoader();
  const newCtl = r.window.__mlsP1LegalLoader, newNode = r.scripts[0];
  ok(newCtl !== oldCtl, 'new loader did not replace the reverted controller');
  ok(newCtl.installToken !== oldCtl.installToken, 'new loader reused stale ownership token');
  let newApiReverted = 0;
  const newApi = { installed: true, version: 'p1-legal-1.0.0', installToken: newCtl.installToken,
    revert() { newApiReverted++; this.installed = false; } };
  r.window.__mlsP1LegalPack = newApi;
  newNode.onload();
  eq(newCtl.state, 'ready', 'new exact-token owner did not become ready');
  oldLoad(); oldError(); oldCtl.revert(); r.tick();
  eq(newApiReverted, 0, 'stale controller callback/revert destroyed the newer API');
  eq(r.window.__mlsP1LegalPack, newApi, 'stale controller replaced/deleted the newer API');
  eq(r.window.__mlsP1LegalLoader, newCtl, 'stale controller deleted the newer controller');
  eq(r.scripts.length, 1, 'stale controller removed or duplicated the newer script');
  eq(r.scripts[0], newNode, 'stale controller changed newer script ownership');
  eq(r.timers.size, 0, 'stale controller scheduled retry work against the newer owner');
}

ok(!/\.src=['"]feat_mls_legalpack\.js/.test(loader), 'loader contains a shared production Legal source');
console.log(`PASS 1p Legal loader runtime (${checks} assertions)`);

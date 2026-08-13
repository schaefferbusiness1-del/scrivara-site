'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const marker = bundle.indexOf("var A='feat_mls_marketing.js',SRC='1p-feat_mls_marketing.js'");
assert(marker > 0, 'Marketing loader marker missing');
const start = bundle.lastIndexOf(';(function(){try{', marker);
const end = bundle.indexOf('/* 1p FREE Marketing:', marker);
assert(start >= 0 && end > marker, 'Marketing loader extraction failed');
const source = bundle.slice(start, end);
let checks = 0;
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }
function ok(v, m) { assert.ok(v, m); checks++; }

function runtime(options = {}) {
  const scripts = [], nodes = [], observers = [], timers = new Map(), defers = []; let nextTimer = 1;
  function node(tag) { return { tagName: String(tag || '').toUpperCase(), attrs: {}, parentNode: null, src: '', id: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; } }; }
  const head = { appendChild(n) { n.parentNode = this; nodes.push(n); if (n.tagName === 'SCRIPT') scripts.push(n); return n; }, removeChild(n) { let at = scripts.indexOf(n); if (at >= 0) scripts.splice(at, 1); at = nodes.indexOf(n); if (at >= 0) nodes.splice(at, 1); n.parentNode = null; } };
  const document = { head, documentElement: head, createElement: tag => node(tag),
    getElementById(id) { return nodes.find(n => n.id === id) || null; }, addEventListener() {}, removeEventListener() {},
    querySelectorAll(selector) { return /feat_mls_marketing/.test(selector) ? scripts.filter(n => n.getAttribute('data-mls-asset') === 'feat_mls_marketing.js') : []; } };
  let orphanGuard = null;
  if (options.orphanGuard) { orphanGuard = node('style'); orphanGuard.id = 'mlsP1MarketingLoadingGuardCss'; orphanGuard.setAttribute('data-mls-install-token', 'orphan-token'); head.appendChild(orphanGuard); }
  const window = { __MLS_P1_PREVIEW: { enabled: options.preview !== false }, __MLS_AV: 'p1-test',
    __mlsUpgradeSafety: { defer(...args) { defers.push(args); return { deferred: true }; } } };
  window.MutationObserver = class { constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); } observe() { this.connected = true; } disconnect() { this.connected = false; } };
  if (options.api) { options.api._window = window; window.__mlsP1Marketing = options.api; }
  if (options.prior) { options.prior._window = window; window.__mlsP1MarketingLoader = options.prior; }
  const context = { window, document, setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }, Date, Math, Number, console };
  vm.createContext(context);
  function evaluate() { vm.runInContext(source, context, { filename: '1p-mls-connect.js#marketing-loader' }); }
  evaluate();
  return { window, document, scripts, nodes, orphanGuard, timers, defers, evaluate,
    mutate() { observers.filter(observer => observer.connected).forEach(observer => observer.callback([])); },
    tick() { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); } };
}
{
  const r = runtime(), ctl = r.window.__mlsP1MarketingLoader;
  r.scripts[0].onerror(); r.tick(); r.scripts[0].onerror();
  eq(ctl.state, 'failed-bounded', 'fixture did not exhaust Marketing load retries');
  const calls = [];
  const lateReach = { open(kind) { calls.push(['open', kind]); return 'old-' + kind; }, openReviews() { calls.push(['reviews']); return 'old-reviews'; }, openContext(kind) { calls.push(['context', kind]); return 'old-context'; } };
  const originals = { open: lateReach.open, openReviews: lateReach.openReviews, openContext: lateReach.openContext };
  r.window.__mlsPatientReach = lateReach; r.mutate();
  eq(lateReach.open('reviews'), false, 'failed-bounded loader allowed late Premium Reviews open');
  eq(lateReach.openContext('send'), 'old-context', 'fail-closed guard changed Patient Reach send route');
  ctl.revert();
  eq(lateReach.open, originals.open, 'guard revert did not restore late Patient Reach.open');
  eq(lateReach.openReviews, originals.openReviews, 'guard revert did not restore late openReviews');
  eq(lateReach.openContext, originals.openContext, 'guard revert did not restore late openContext');
  eq(calls.some(call => call[0] === 'open' && call[1] === 'reviews'), false, 'guard delegated blocked review route');
}

{
  const r = runtime({ orphanGuard: true }), ctl = r.window.__mlsP1MarketingLoader;
  const ownedGuard = r.document.getElementById('mlsP1MarketingLoadingGuardCss');
  ok(ownedGuard && ownedGuard !== r.orphanGuard, 'new controller adopted a foreign orphan guard node');
  eq(r.orphanGuard.parentNode, null, 'foreign orphan guard node survived exact replacement');
  eq(ownedGuard.getAttribute('data-mls-install-token'), ctl.installToken, 'replacement guard lacks controller token ownership');
  ctl.revert();
  eq(r.document.getElementById('mlsP1MarketingLoadingGuardCss'), null, 'controller revert left its guard style orphaned');
}

{
  const r = runtime(), ctl = r.window.__mlsP1MarketingLoader, script = r.scripts[0];
  eq(r.scripts.length, 1, 'fresh loader did not mount exactly one script');
  eq(script.src, '1p-feat_mls_marketing.js?v=p1-test', 'loader requested non-preview Marketing bytes');
  eq(script.getAttribute('data-mls-asset'), 'feat_mls_marketing.js', 'loader lost canonical asset identity');
  ok(ctl.installToken && script.getAttribute('data-mls-install-token') === ctl.installToken, 'script/loader token ownership differs');
  r.window.__mlsP1Marketing = { installed: true, version: ctl.version, installToken: ctl.installToken, reconcile() {}, revert() { this.installed = false; }, isDirty: () => false, open() {}, close() {} };
  script.onload(); eq(ctl.state, 'ready', 'exact-token owner did not become ready');
}
{
  const r = runtime(), first = r.scripts[0], ctl = r.window.__mlsP1MarketingLoader;
  first.onerror(); eq(r.scripts.length, 0, 'network-failed script stayed canonical'); eq(r.timers.size, 1, 'network failure did not schedule one retry');
  r.tick(); eq(r.scripts.length, 1, 'bounded retry did not mount'); r.scripts[0].onerror(); eq(r.timers.size, 0, 'second failure scheduled an unbounded retry');
  eq(ctl.attempts, 2, 'loader retry cap drifted'); eq(ctl.ensure(), false, 'failed loader mounted a third request');
}
{
  let priorReverts = 0, priorEnsures = 0;
  const prior = { installed: true, version: 'mkt-p1-1.0.0', installToken: 'old-token', ensure() { priorEnsures++; throw new Error('dirty prior ensure was called'); },
    revert() { priorReverts++; this.installed = false; delete this._window.__mlsP1MarketingLoader; } };
  const api = { installed: true, isDirty: () => true, revert() { throw new Error('dirty API was touched'); } };
  const r = runtime({ prior, api });
  eq(r.window.__mlsP1MarketingLoader, prior, 'dirty prior owner lost its loader token');
  eq(priorEnsures, 0, 'loader called prior.ensure before checking dirty owner');
  eq(priorReverts, 0, 'loader reverted prior before checking dirty owner');
  eq(r.scripts.length, 0, 'dirty prior owner allowed a replacement request');
  eq(r.defers.length, 1, 'dirty prior replacement was not truthfully deferred');
}
{
  let ensured = 0, reverted = 0;
  const prior = { installed: true, version: 'mkt-p1-1.0.0', installToken: 'missing-owner', ensure() { ensured++; return true; },
    revert() { reverted++; this.installed = false; delete this._window.__mlsP1MarketingLoader; } };
  const r = runtime({ prior });
  eq(ensured, 1, 'same-version prior was not asked to prove readiness');
  eq(reverted, 1, 'ensure-true prior without exact API suppressed Marketing');
  ok(r.window.__mlsP1MarketingLoader !== prior, 'missing-owner prior retained controller key');
  eq(r.scripts.length, 1, 'fresh Marketing load did not start after missing-owner prior retired');
}
{
  let reverted = 0;
  const prior = { installed: true, version: 'mkt-p1-1.0.0', installToken: 'prior-token', ensure() { return true; },
    revert() { reverted++; this.installed = false; delete this._window.__mlsP1MarketingLoader; } };
  const corrupt = { installed: true, version: 'mkt-p1-1.0.0', installToken: 'wrong-token', reconcile() {}, revert() { this.installed = false; }, isDirty: () => false, open() {}, close() {} };
  const r = runtime({ prior, api: corrupt });
  eq(reverted, 1, 'wrong-token API allowed prior controller no-op');
  eq(r.scripts.length, 1, 'wrong-token stale owner prevented fresh bounded load');
}
{
  let reverted = 0;
  const api = { installed: true, isDirty: () => true, revert() { reverted++; this.installed = false; } };
  const r = runtime({ api });
  eq(reverted, 0, 'new loader retired a dirty stale API');
  eq(r.scripts.length, 0, 'new loader overlaid a dirty stale API');
  eq(r.window.__mlsP1MarketingLoader, undefined, 'dirty stale API was assigned an unrelated loader token');
  eq(r.defers.length, 1, 'dirty stale API did not enter upgrade deferral');
}
{
  const r = runtime(), old = r.window.__mlsP1MarketingLoader, oldNode = r.scripts[0], lateLoad = oldNode.onload;
  old.revert(); r.evaluate(); const fresh = r.window.__mlsP1MarketingLoader, freshNode = r.scripts[0];
  ok(fresh !== old && fresh.installToken !== old.installToken, 'new loader reused stale controller/token');
  let freshReverts = 0;
  r.window.__mlsP1Marketing = { installed: true, version: fresh.version, installToken: fresh.installToken, reconcile() {}, isDirty: () => false, open() {}, close() {}, revert() { freshReverts++; this.installed = false; } };
  freshNode.onload(); lateLoad(); old.revert(); r.tick();
  eq(freshReverts, 0, 'late old callback/revert destroyed new owner');
  eq(r.window.__mlsP1MarketingLoader, fresh, 'late old callback seized loader key');
  eq(r.scripts.length, 1, 'late old callback removed/duplicated current script');
}
{
  const r = runtime({ preview: false });
  eq(r.window.__mlsP1MarketingLoader, undefined, 'loader installed outside preview');
  eq(r.scripts.length, 0, 'loader fetched outside preview');
}
{
  const r = runtime(), ctl = r.window.__mlsP1MarketingLoader, script = r.scripts[0];
  r.window.__mlsP1Marketing = { installed: true, version: ctl.version, installToken: ctl.installToken,
    reconcile() { r.window.__mlsP1Marketing = { installed: true, version: ctl.version, installToken: 'intruder' }; },
    revert() { this.installed = false; }, isDirty: () => false, open() {}, close() {} };
  script.onload();
  eq(ctl.state, 'owner-changed', 'reconcile-time owner replacement was accepted as ready');
  eq(r.scripts.length, 0, 'reconcile-time owner replacement left canonical tag mounted');
}
{
  let called = 0;
  const corrupt = { installed: true, version: 'mkt-p1-1.0.0', installToken: 'bad', reconcile() {}, revert() { called++; this.installed = false; }, isDirty: () => false };
  const r = runtime({ api: corrupt });
  eq(called, 0, 'corrupt owner shape was destructively retired');
  eq(r.window.__mlsP1MarketingLoader.state, 'blocked-stale-owner', 'corrupt owner shape did not fail closed');
  eq(r.scripts.length, 0, 'corrupt owner shape allowed an overlay');
}
{
  const zombie = { installed: true, version: 'old', isDirty: () => false, reconcile() {}, open() {}, close() {}, revert() { delete this._window.__mlsP1Marketing; return true; } };
  const r = runtime({ api: zombie });
  eq(zombie.installed, true, 'zombie fixture did not remain internally live');
  eq(r.window.__mlsP1MarketingLoader.state, 'blocked-stale-owner', 'global-deleting but live stale API was accepted as retired');
  eq(r.scripts.length, 0, 'live stale API allowed a replacement script');
}

ok(!/\.src=['"]feat_mls_marketing\.js/.test(source), 'loader contains production Marketing source');
ok(/maxAttempts:2/.test(source), 'loader is not bounded');
console.log(`PASS 1p Marketing loader runtime (${checks} assertions)`);

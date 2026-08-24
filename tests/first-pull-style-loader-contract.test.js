const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, '1p-feat_mls_first_pull_style.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const autopull = fs.readFileSync(path.join(root, 'feat_athena_autopull.js'), 'utf8');
assert.ok(/first-pull-style-1\.1\.0/.test(moduleSource), 'first-pull style module is missing its version marker');
assert.ok(connect.includes("1p-feat_mls_first_pull_style.js"), '1p bundle does not load the first-pull style module');
assert.ok(connect.includes("window.__mlsDeferAsset(begin)") && !/window\.__mlsEnsureFirstPullStyle\s*=\s*ensure;\s*ensure\(\)/.test(connect),
  'first-pull learner still joins startup instead of loading only after a verified pull');
assert.ok(connect.includes("data-mls-asset"), 'first-pull style loader is not marked for startup diagnostics');
assert.ok(moduleSource.includes("data-mls-first-pull-style-ready"), 'module does not publish a PHI-free execution marker for live QA');
assert.ok(connect.includes("data-mls-install-state") && connect.includes("api.installed === true") && connect.includes("typeof api.bootstrap === 'function'"), 'loader does not distinguish downloaded bytes from an exact installed learner API');
assert.ok(!/window\.dispatchEvent\([^)]*raw|detail\s*:\s*\{[^}]*raw/i.test(moduleSource), 'completion seam may carry raw patient text');
assert.ok(moduleSource.includes('identityVerified === true') && moduleSource.includes('bodyComplete === true'), 'bootstrap does not require verified full visit bodies');
assert.ok(moduleSource.includes('firstPullStyleBootstrapV1'), 'bootstrap does not have an account-local idempotency marker');
assert.ok(moduleSource.includes('firstPullStylePendingV1') && autopull.includes('firstPullStylePendingV1'), 'late-load replay receipt is not wired end to end');
assert.ok(autopull.includes('__mlsEnsureFirstPullStyle'), 'a successful full pull does not re-open the bounded learner loader after an earlier startup failure');
assert.ok(moduleSource.includes('navigator') && moduleSource.includes('locks.request'), 'cross-tab bootstrap lock is missing');
assert.ok(!moduleSource.includes('/api/section-templates/derive') && !moduleSource.includes('exampleText:'), 'first-pull clinical examples can still reach a hosted derivation route');
assert.ok(/CustomEvent\('mls:athena-full-history-pull-complete',[\s\S]{0,180}detail:\s*\{\s*saved:/.test(autopull), 'completion event does not expose only the non-identifying saved count');
assert.ok(!/CustomEvent\('mls:athena-full-history-pull-complete',[\s\S]{0,220}detail:\s*\{[^}]*patientId/.test(autopull), 'completion event still exposes a patient identifier');

const loaderSource = connect.slice(connect.indexOf('/* first-pull-style-1.1.0'));
const VALID_API = { installed: true, version: 'first-pull-style-1.1.0', bootstrap() {} };
function runLoader({ outcomes = ['ready'], existing = null, initialApi = null } = {}) {
  const scripts = [], scheduled = [], watchdogs = [], rootAttrs = {};
  const stale = existing && { attrs: { 'data-mls-asset': '1p-feat_mls_first_pull_style.js', ...(existing.attrs || {}) }, remove() { this.removed = true; } };
  const document = {
    querySelector: () => stale && !stale.removed ? stale : null,
    createElement: () => {
      const attrs = {};
      return { attrs, setAttribute: (k, v) => { attrs[k] = String(v); }, remove() { this.removed = true; } };
    },
    documentElement: {
      setAttribute: (k, v) => { rootAttrs[k] = String(v); },
      appendChild: script => {
        scripts.push(script);
        const outcome = outcomes[scripts.length - 1] || 'missing';
        if (outcome === 'ready') { context.__mlsFirstPullStyle = VALID_API; script.onload(); }
        else if (outcome === 'missing') script.onload();
        else if (outcome === 'network') script.onerror();
      }
    }
  };
  const context = {
    document,
    Date,
    setTimeout: (fn, delay) => {
      if (delay === 12000) { const timer = { fn, active: true }; watchdogs.push(timer); return timer; }
      scheduled.push(fn); return scheduled.length;
    },
    clearTimeout: timer => { if (timer && typeof timer === 'object') timer.active = false; },
    __MLS_AV: 'test-build',
    __mlsDeferAsset: fn => fn(),
    __mlsFirstPullStyle: initialApi
  };
  context.window = context;
  vm.runInNewContext(loaderSource, context, { filename: 'first-pull-style-loader.js' });
  const beforeEnsure = scripts.length;
  context.__mlsEnsureFirstPullStyle();
  return { context, scripts, scheduled, watchdogs, rootAttrs, stale, beforeEnsure };
}

const ready = runLoader();
assert.equal(ready.beforeEnsure, 0, 'learner asset loaded during startup before a verified pull requested it');
assert.equal(ready.scripts.length, 1, 'healthy learner load appended more than one script');
assert.equal(ready.scripts[0].attrs['data-mls-install-state'], 'ready', 'healthy learner load was not marked ready');
assert.equal(ready.rootAttrs['data-mls-first-pull-style-loader'], 'ready', 'healthy learner execution was not exposed to DOM-based live QA');

const healed = runLoader({ outcomes: ['missing', 'ready'] });
assert.equal(healed.scripts.length, 1, 'missing learner API retried before the bounded delay');
assert.equal(healed.scripts[0].attrs['data-mls-install-state'], 'missing-api', 'download-without-install was not diagnosed');
assert.equal(healed.scheduled.length, 1, 'download-without-install did not schedule one bounded retry');
healed.scheduled.shift()();
assert.equal(healed.scripts.length, 2, 'download-without-install did not perform exactly one recovery attempt');
assert.equal(healed.scripts[1].attrs['data-mls-install-state'], 'ready', 'bounded retry did not recognize the installed learner API');
assert.equal(healed.rootAttrs['data-mls-first-pull-style-loader'], 'ready', 'self-healed learner was not exposed as ready to live QA');

const network = runLoader({ outcomes: ['network', 'ready'] });
assert.equal(network.scripts[0].attrs['data-mls-install-state'], 'network-error', 'network failure was not diagnosed');
network.scheduled.shift()();
assert.equal(network.scripts[1].attrs['data-mls-install-state'], 'ready', 'network failure did not recover on its one bounded retry');

const hung = runLoader({ outcomes: ['defer', 'ready'] });
assert.equal(hung.watchdogs[0].active, true, 'a hanging request has no active attempt timeout');
hung.watchdogs[0].fn();
assert.equal(hung.scripts[0].attrs['data-mls-install-state'], 'network-timeout', 'hanging request did not report a truthful timeout');
assert.equal(hung.scheduled.length, 1, 'hanging request did not schedule its one bounded recovery attempt');
hung.scheduled.shift()();
assert.equal(hung.scripts[1].attrs['data-mls-install-state'], 'ready', 'hanging request did not recover after its attempt timeout');

const staleTag = runLoader({ outcomes: ['ready'], existing: { attrs: { 'data-mls-install-state': 'missing-api' } }, initialApi: { installed: true, version: 'old', bootstrap() {} } });
assert.equal(staleTag.stale.removed, true, 'stale canonical loader tag blocked recovery');
assert.equal(staleTag.scripts.length, 1, 'stale or wrong-version API was trusted');
assert.equal(staleTag.rootAttrs['data-mls-first-pull-style-loader'], 'ready', 'stale-tag recovery did not finish ready');

const cappedOutcomes = ['missing', 'missing'];
const capped = runLoader({ outcomes: cappedOutcomes });
capped.scheduled.shift()();
assert.equal(capped.scripts.length, 2, 'loader exceeded or skipped its two-attempt cap');
assert.equal(capped.scheduled.length, 0, 'terminal owner-missing failure scheduled an unbounded retry');
assert.equal(capped.rootAttrs['data-mls-first-pull-style-loader'], 'failed-bounded', 'terminal owner-missing failure was not reported truthfully');
assert.ok(capped.scripts.every(s => s.removed), 'terminal missing-owner script kept poisoning later ensure calls');
cappedOutcomes.push('ready');
capped.context.__mlsEnsureFirstPullStyle();
assert.equal(capped.scripts[2].attrs['data-mls-install-state'], 'ready', 'a later pull-time ensure could not recover after the bounded failure');

const staleCallback = runLoader({ outcomes: ['defer', 'ready'] });
staleCallback.scripts[0].onerror();
staleCallback.scheduled.shift()();
const readyState = staleCallback.rootAttrs['data-mls-first-pull-style-loader'];
staleCallback.scripts[0].onload();
assert.equal(staleCallback.rootAttrs['data-mls-first-pull-style-loader'], readyState, 'stale first-attempt callback clobbered the recovered state');

const alreadyReady = runLoader({ initialApi: VALID_API });
assert.equal(alreadyReady.scripts.length, 0, 'valid installed learner API was loaded twice');
assert.equal(alreadyReady.rootAttrs['data-mls-first-pull-style-loader'], 'ready', 'valid installed learner API was not exposed as ready');

console.log('PASS first-pull-style loader contract: no startup fetch, exact API is execution-marked, stale/network/missing-owner loads self-heal once with stale-callback protection, failures cap truthfully, pull-time ensure is wired, cross-tab locking and late replay remain local-only');

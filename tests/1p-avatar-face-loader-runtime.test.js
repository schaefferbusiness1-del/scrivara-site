'use strict';

/* Executed /1p-only loader and hot-refresh lifecycle for the face studio.
   The real loader is extracted from the preview bundle; the real face asset is
   also evaluated for the late-script case. No network, camera, Athena, shared
   production file, or extension is involved. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const faceSource = fs.readFileSync(path.join(root, '1p-feat_mls_avatar_face.js'), 'utf8');
const marker = "var A='feat_mls_avatar_face.js',SRC='1p-feat_mls_avatar_face.js',V='p1-face-studio-1.0.1',KEY='__mlsP1AvatarFaceLoader'";
const markerAt = connect.indexOf(marker);
assert(markerAt >= 0, 'real /1p face-studio loader marker is missing');
const start = connect.lastIndexOf(';(function(){try{', markerAt);
const endMarker = '/* 1p Avatar face studio:';
const end = connect.indexOf(endMarker, markerAt);
assert(start >= 0 && end > markerAt, 'real /1p face-studio loader boundary is missing');
const loader = connect.slice(start, end);

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function validOwner(version, installToken, extra = {}) {
  return Object.assign({ installed: true, version, installToken, reconcile() {}, revert() { this.installed = false; } }, extra);
}

function runtime(options = {}) {
  let nextTimer = 1;
  const timers = new Map(), scripts = [], elements = [], deferred = [], seeded = [];
  function setTimeoutFake(fn) { const id = nextTimer++; timers.set(id, fn); return id; }
  function clearTimeoutFake(id) { timers.delete(id); }
  function tick() { const rows = [...timers.values()]; timers.clear(); rows.forEach(fn => fn()); }
  function tag(name = 'script') {
    return {
      tagName: String(name).toUpperCase(), attrs: {}, parentNode: null, src: '', async: true,
      id: '', textContent: '', onload: null, onerror: null,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; }
    };
  }
  const head = {
    appendChild(item) {
      item.parentNode = this;
      (item.tagName === 'SCRIPT' ? scripts : elements).push(item);
      return item;
    },
    removeChild(item) {
      const rows = item.tagName === 'SCRIPT' ? scripts : elements;
      const at = rows.indexOf(item); if (at >= 0) rows.splice(at, 1); item.parentNode = null;
    }
  };
  const document = {
    head, documentElement: head, body: null, currentScript: null,
    createElement(name) { return tag(name); },
    getElementById(id) { return elements.find(item => item.id === id) || null; },
    querySelectorAll(selector) {
      if (selector !== 'script[data-mls-asset="feat_mls_avatar_face.js"]') return [];
      return scripts.filter(item => item.getAttribute('data-mls-asset') === 'feat_mls_avatar_face.js');
    }
  };
  for (let i = 0; i < Number(options.seedTags || 0); i++) {
    const item = tag('script');
    item.setAttribute('data-mls-asset', 'feat_mls_avatar_face.js');
    item.setAttribute('data-mls-version', 'stale-' + i);
    head.appendChild(item); seeded.push(item);
  }
  const randomValues = options.randomValues || [0.125, 0.25];
  let randomAt = 0;
  const controlledMath = Object.create(Math);
  controlledMath.random = () => randomValues[Math.min(randomAt++, randomValues.length - 1)];
  const controlledDate = { now: () => Number(options.now == null ? 1776038400000 : options.now) };
  const window = {
    __MLS_AV: 'p1-test-build',
    __MLS_P1_PREVIEW: options.preview === false ? { enabled: false } : { enabled: true },
    __mlsDeferAsset(fn, meta) { deferred.push({ fn, meta }); },
    addEventListener() {}, removeEventListener() {}
  };
  if (options.controller) { options.controller._window = window; window.__mlsP1AvatarFaceLoader = options.controller; }
  if (options.api) { options.api._window = window; window.__mlsAvatarFaceStudio = options.api; }
  window.window = window;
  const context = vm.createContext({ window, document, setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
    Math: controlledMath, Date: controlledDate, console });
  function evaluateLoader() { vm.runInContext(loader, context, { filename: '1p-mls-connect.js#avatar-face-loader' }); }
  function flushDeferred() { while (deferred.length) deferred.shift().fn(); }
  evaluateLoader(); flushDeferred();
  return { window, document, scripts, elements, timers, deferred, seeded, tick, context, evaluateLoader, flushDeferred };
}

/* Fresh loading is canonical, uniquely tokened, versioned, and preview sourced. */
{
  const r = runtime(), ctl = r.window.__mlsP1AvatarFaceLoader, node = r.scripts[0];
  eq(r.scripts.length, 1, 'fresh loader did not mount exactly one script');
  eq(node.src, '1p-feat_mls_avatar_face.js?v=p1-test-build', 'fresh loader requested the wrong source/cache identity');
  eq(node.getAttribute('data-mls-asset'), 'feat_mls_avatar_face.js', 'fresh loader lost canonical asset identity');
  eq(node.getAttribute('data-mls-version'), 'p1-face-studio-1.0.1', 'fresh loader lost exact owner version');
  eq(node.getAttribute('data-mls-install-token'), ctl.installToken, 'script and controller tokens diverged');
  r.window.__mlsAvatarFaceStudio = validOwner(ctl.version, ctl.installToken);
  node.onload();
  eq(ctl.state, 'ready', 'exact asset owner did not make the loader ready');
  eq(node.getAttribute('data-mls-load-state'), 'ready', 'ready state is not receipted on the canonical tag');
  r.evaluateLoader(); r.flushDeferred();
  eq(r.scripts.length, 1, 'repeat bundle evaluation duplicated the exact pending/ready asset');
}

/* A network or owner-missing result removes canonical identity, retries once,
   then stops. There is no unbounded hot loop. */
{
  const r = runtime(), ctl = r.window.__mlsP1AvatarFaceLoader;
  r.scripts[0].onerror();
  eq(r.scripts.length, 0, 'network-failed tag stayed mounted');
  eq(r.timers.size, 1, 'network failure did not schedule one bounded retry');
  r.tick(); eq(r.scripts.length, 1, 'network failure did not retry');
  r.scripts[0].onerror();
  eq(r.timers.size, 0, 'second network failure scheduled an unbounded retry');
  eq(ctl.attempts, 2, 'network retry did not stop at two attempts');
  eq(ctl.ensure(), false, 'failed-bounded controller started a third request');
  eq(ctl.state, 'failed-bounded', 'bounded failure state is not explicit');
}
{
  const r = runtime(), first = r.scripts[0];
  first.onload();
  eq(r.scripts.length, 0, 'loaded tag without its exact API remained canonical');
  eq(first.getAttribute('data-mls-load-state'), 'owner-missing', 'owner-missing receipt was lost');
  eq(r.timers.size, 1, 'owner-missing load did not become retryable');
}
{
  const r = runtime(), ctl = r.window.__mlsP1AvatarFaceLoader, first = r.scripts[0];
  r.window.__mlsAvatarFaceStudio = { installed: true, version: ctl.version, installToken: ctl.installToken };
  first.onload();
  eq(ctl.state, 'owner-missing', 'malformed exact-token API was accepted as ready');
  r.tick();
  eq(ctl.state, 'blocked-stale-owner', 'malformed exact-token API did not fail closed on retry');
  eq(r.scripts.length, 0, 'malformed exact-token API triggered a parallel asset owner');
}

/* Old owner/controller replacement is reversible or fails closed. */
{
  let apiReverts = 0;
  const api = { installed: true, version: 'old', installToken: 'old', revert() {
    apiReverts++; this.installed = false; delete this._window.__mlsAvatarFaceStudio;
  } };
  const r = runtime({ api });
  eq(apiReverts, 1, 'reversible stale face owner was not retired');
  eq(r.scripts.length, 1, 'fresh preview asset did not mount after stale owner retirement');
}
{
  const r = runtime({ seedTags: 2 });
  eq(r.scripts.length, 1, 'stale canonical tags were not reduced to one fresh owner');
  eq(r.seeded[0].getAttribute('data-mls-asset'), null, 'first stale tag retained canonical identity');
  eq(r.seeded[1].getAttribute('data-mls-asset'), null, 'second stale tag retained canonical identity');
  eq(r.seeded[0].getAttribute('data-mls-retired-asset'), 'feat_mls_avatar_face.js', 'stale tag retirement lacks a receipt');
}
{
  const r = runtime({ api: { installed: true, version: 'old', installToken: 'old' } });
  eq(r.scripts.length, 0, 'loader mounted over an unrevertible stale owner');
  eq(r.window.__mlsP1AvatarFaceLoader.state, 'blocked-stale-owner', 'stale-owner refusal is not explicit');
  eq(r.timers.size, 0, 'stale-owner refusal scheduled a retry loop');
}
for (const replacement of [undefined, { installed: false, version: 'replacement' }]) {
  const api = {
    installed: true, version: 'old', installToken: 'old',
    revert() {
      if (replacement) this._window.__mlsAvatarFaceStudio = replacement;
      else delete this._window.__mlsAvatarFaceStudio;
      return true;
    }
  };
  const r = runtime({ api });
  eq(api.installed, true, 'synthetic broken owner unexpectedly proved retirement');
  eq(r.window.__mlsP1AvatarFaceLoader.state, 'blocked-stale-owner',
    'loader accepted a retiring owner that stayed installed after leaving the canonical global');
  eq(r.scripts.length, 0, 'loader mounted alongside a non-retired stale owner');
}
{
  let oldControllerReverts = 0;
  const prior = { installed: true, version: 'old-loader', revert() {
    oldControllerReverts++; this.installed = false; delete this._window.__mlsP1AvatarFaceLoader; return true;
  } };
  const r = runtime({ controller: prior });
  eq(oldControllerReverts, 1, 'different-version controller was not retired');
  ok(r.window.__mlsP1AvatarFaceLoader !== prior, 'old controller retained the canonical key');
  eq(r.scripts.length, 1, 'new controller did not load after reversible takeover');
}
{
  const prior = { installed: true, version: 'old-loader' };
  const r = runtime({ controller: prior });
  eq(r.window.__mlsP1AvatarFaceLoader, prior, 'unrevertible controller was overwritten');
  eq(r.scripts.length, 0, 'loader mounted alongside an unrevertible controller');
}

/* A same-version fast path is still an ownership boundary. Missing shape,
   false/no-op/throwing ensure, or replacement during ensure cannot suppress a
   clean reversible takeover or be mistaken for the current installation. */
for (const [label, mutate] of [
  ['missing token', ctl => { ctl.installToken = ''; }],
  ['missing revert', ctl => { delete ctl.revert; }],
  ['missing state', ctl => { delete ctl.state; }],
]) {
  let reverts = 0;
  const prior = {
    installed: true, version: 'p1-face-studio-1.0.1', state: 'ready', installToken: 'same-old',
    ensure() { return true; }, revert() { reverts++; this.installed = false; delete this._window.__mlsP1AvatarFaceLoader; return true; }
  };
  mutate(prior);
  const r = runtime({ controller: prior });
  if (label === 'missing revert') {
    eq(r.window.__mlsP1AvatarFaceLoader, prior, `${label} controller was overwritten instead of failing closed`);
    eq(r.scripts.length, 0, `${label} controller allowed a parallel asset load`);
  } else {
    eq(reverts, 1, `${label} controller was not reversibly retired`);
    ok(r.window.__mlsP1AvatarFaceLoader !== prior, `${label} controller retained the canonical key`);
    eq(r.scripts.length, 1, `${label} controller suppressed the replacement load`);
  }
}
for (const [label, ensure] of [
  ['no-op', function () {}],
  ['false', function () { return false; }],
  ['throwing', function () { throw new Error('synthetic ensure failure'); }],
]) {
  let reverts = 0;
  const prior = {
    installed: true, version: 'p1-face-studio-1.0.1', state: 'ready', installToken: 'same-old', ensure,
    revert() { reverts++; this.installed = false; delete this._window.__mlsP1AvatarFaceLoader; return true; }
  };
  const r = runtime({ controller: prior });
  eq(reverts, 1, `${label} ensure controller was not retired`);
  ok(r.window.__mlsP1AvatarFaceLoader !== prior, `${label} ensure controller retained the canonical key`);
  eq(r.scripts.length, 1, `${label} ensure controller suppressed the replacement load`);
}
for (const field of ['installToken', 'version', 'state', 'ensure', 'revert']) {
  let reverts = 0;
  const prior = {
    installed: true, version: 'p1-face-studio-1.0.1', state: 'ready', installToken: 'same-old',
    ensure() { if (field === 'version') this.version = 'mutated'; else if (field === 'state') this.state = 'bogus'; else this[field] = ''; return true; },
    revert() { reverts++; this.installed = false; delete this._window.__mlsP1AvatarFaceLoader; return true; }
  };
  const r = runtime({ controller: prior });
  if (field === 'revert') {
    eq(r.window.__mlsP1AvatarFaceLoader, prior, 'post-ensure missing revert was overwritten instead of failing closed');
    eq(r.scripts.length, 0, 'post-ensure missing revert allowed a parallel asset load');
  } else {
    eq(reverts, 1, `post-ensure ${field} mutation was not reversibly retired`);
    ok(r.window.__mlsP1AvatarFaceLoader !== prior, `post-ensure ${field} mutation retained the canonical key`);
    eq(r.scripts.length, 1, `post-ensure ${field} mutation suppressed the replacement load`);
  }
}
{
  const replacement = { installed: true, version: 'foreign-controller' };
  let reverts = 0;
  const prior = {
    installed: true, version: 'p1-face-studio-1.0.1', state: 'ready', installToken: 'same-old',
    ensure() { this._window.__mlsP1AvatarFaceLoader = replacement; return true; },
    revert() { reverts++; this.installed = false; return true; }
  };
  const r = runtime({ controller: prior });
  eq(reverts, 0, 'stale controller replaced during ensure was still allowed to tear down');
  eq(r.window.__mlsP1AvatarFaceLoader, replacement, 'loader overwrote a foreign replacement controller');
  eq(r.scripts.length, 0, 'loader mounted alongside a foreign replacement controller');
}
{
  const replacement = { installed: true, version: 'published-during-revert' };
  let reverts = 0;
  const prior = {
    installed: true, version: 'old-loader',
    revert() {
      reverts++; this.installed = false; this._window.__mlsP1AvatarFaceLoader = replacement; return true;
    }
  };
  const r = runtime({ controller: prior });
  eq(reverts, 1, 'reentrant controller takeover did not invoke old teardown once');
  eq(r.window.__mlsP1AvatarFaceLoader, replacement, 'loader overwrote a controller published during old teardown');
  eq(r.scripts.length, 0, 'loader mounted alongside a controller published during old teardown');
}
{
  const prior = {
    installed: true, version: 'p1-face-studio-1.0.1', state: 'ready', installToken: 'same-current',
    ensure() { return true; }, revert() { throw new Error('must not retire valid controller'); }
  };
  const r = runtime({ controller: prior });
  eq(r.window.__mlsP1AvatarFaceLoader, prior, 'valid same-version controller was needlessly replaced');
  eq(r.scripts.length, 0, 'valid same-version controller duplicated its asset load');
}

/* Revert before a late script evaluation leaves no face owner. The asset reads
   document.currentScript's exact token, so removed old bytes cannot bind to a
   missing or newer controller. */
{
  const r = runtime(), ctl = r.window.__mlsP1AvatarFaceLoader, node = r.scripts[0];
  r.document.currentScript = node;
  vm.runInContext(faceSource, r.context, { filename: '1p-feat_mls_avatar_face.js#real-owner' });
  const owner = r.window.__mlsAvatarFaceStudio;
  ok(owner && owner.installToken === ctl.installToken, 'real face asset did not bind to the exact controller');
  node.onload(); eq(ctl.state, 'ready', 'real face owner was not receipted ready');
  eq(ctl.revert(), true, 'controller could not retire the real face owner');
  eq(owner.installed, false, 'real face owner remained installed after controller teardown');
  eq(r.window.__mlsAvatarFaceStudio, undefined, 'real face owner remained global after controller teardown');
  eq(r.elements.length, 0, 'real face owner left its style behind after controller teardown');
}
{
  const r = runtime(), ctl = r.window.__mlsP1AvatarFaceLoader, node = r.scripts[0];
  let ownerReverts = 0;
  const owner = { installed: true, version: ctl.version, installToken: ctl.installToken, reconcile() {}, revert() {
    ownerReverts++; this.installed = false; delete r.window.__mlsAvatarFaceStudio; return true;
  } };
  r.window.__mlsAvatarFaceStudio = owner; node.onload();
  eq(ctl.revert(), true, 'current controller could not retire its exact owner');
  eq(ownerReverts, 1, 'controller revert did not retire the exact face owner once');
  eq(r.window.__mlsAvatarFaceStudio, undefined, 'controller revert orphaned its exact API');
  eq(r.scripts.length, 0, 'controller revert orphaned its canonical tag');
}
{
  const r = runtime(), ctl = r.window.__mlsP1AvatarFaceLoader, oldNode = r.scripts[0];
  const lateLoad = oldNode.onload, lateError = oldNode.onerror;
  eq(ctl.revert(), true, 'current loader refused its own revert');
  eq(r.scripts.length, 0, 'loader revert left its script mounted');
  eq(r.window.__mlsP1AvatarFaceLoader, undefined, 'loader revert left its controller global');
  r.document.currentScript = oldNode;
  vm.runInContext(faceSource, r.context, { filename: '1p-feat_mls_avatar_face.js#late' });
  eq(r.window.__mlsAvatarFaceStudio, undefined, 'late asset evaluation orphan-installed after loader revert');
  lateLoad(); lateError(); r.tick();
  eq(r.scripts.length, 0, 'late callback remounted a reverted asset');
  eq(r.timers.size, 0, 'late callback scheduled retry after revert');
}

/* A stale saved controller/callback cannot touch a newer same-version owner. */
{
  const r = runtime({ randomValues: [0.125, 0.25] });
  const oldCtl = r.window.__mlsP1AvatarFaceLoader, oldNode = r.scripts[0];
  const oldLoad = oldNode.onload, oldError = oldNode.onerror;
  oldCtl.revert();
  r.evaluateLoader(); r.flushDeferred();
  const newCtl = r.window.__mlsP1AvatarFaceLoader, newNode = r.scripts[0];
  ok(newCtl !== oldCtl, 'new evaluation reused a reverted controller');
  ok(newCtl.installToken !== oldCtl.installToken, 'new evaluation reused the old installation token');
  r.document.currentScript = oldNode;
  vm.runInContext(faceSource, r.context, { filename: '1p-feat_mls_avatar_face.js#old-token-after-new-loader' });
  eq(r.window.__mlsAvatarFaceStudio, undefined, 'old-token asset evaluation captured the newer controller');
  let newerReverts = 0;
  const newer = { installed: true, version: newCtl.version, installToken: newCtl.installToken, reconcile() {},
    revert() { newerReverts++; this.installed = false; } };
  r.window.__mlsAvatarFaceStudio = newer;
  newNode.onload();
  oldLoad(); oldError(); oldCtl.revert(); oldCtl.ensure(); r.tick();
  eq(newerReverts, 0, 'stale controller/callback reverted the newer face owner');
  eq(r.window.__mlsAvatarFaceStudio, newer, 'stale controller replaced the newer face owner');
  eq(r.window.__mlsP1AvatarFaceLoader, newCtl, 'stale controller deleted the newer controller');
  eq(r.scripts.length, 1, 'stale controller removed or duplicated the newer script');
  eq(r.scripts[0], newNode, 'stale callback changed canonical script ownership');
}

/* Install identities stay unique even if clock and random sources collide.
   A removed older script therefore cannot ever authenticate to a later owner. */
{
  const r = runtime({ randomValues: [0.125, 0.125], now: 1776038400000 });
  const first = r.window.__mlsP1AvatarFaceLoader;
  first.revert(); r.evaluateLoader(); r.flushDeferred();
  const second = r.window.__mlsP1AvatarFaceLoader;
  ok(first.installToken !== second.installToken, 'loader reused an install token under clock/random collision');
}

/* The loader exists only behind the preview marker and directly follows the
   preview Avatar loader registration. */
{
  const r = runtime({ preview: false });
  eq(r.window.__mlsP1AvatarFaceLoader, undefined, 'face loader installed outside an enabled /1p preview');
  eq(r.scripts.length, 0, 'face asset loaded outside an enabled /1p preview');
  const avatarAt = connect.indexOf("s.src='1p-feat_mls_avatar.js?v='");
  const legalAt = connect.indexOf("var A='feat_mls_legalpack.js'", avatarAt);
  ok(avatarAt >= 0 && avatarAt < markerAt && markerAt < legalAt,
    'face loader is not immediately between the preview Avatar and next asset loader');
  ok(!/\.src=['"]feat_mls_avatar_face\.js/.test(loader), 'loader contains a shared/production face source');
}

console.log(`PASS 1p Avatar face loader runtime (${checks} assertions)`);

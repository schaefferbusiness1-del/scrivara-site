/* 1p-ondemand-templates.test.js  (1p PREVIEW ONLY)
 *
 * Executes the real p1 on-demand loader in a deliberately small DOM. The
 * important contract is the handoff, not merely the script tags: a cold
 * activation must wait until all three upgrades are ready, then continue the
 * exact interaction once. Hover is only a preload hint and must never consume
 * a later click. A failed early fetch must remain retryable because the normal
 * deferred queue may already have skipped the tag while it existed.
 *
 * This test reads only 1p-mls-connect.js. It neither executes nor asserts on
 * the production bundle, the service worker, or the browser extension.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONNECT = path.join(ROOT, '1p-mls-connect.js');
const src = fs.readFileSync(CONNECT, 'latin1');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(actual, expected, msg) { assert.strictEqual(actual, expected, msg); checks++; }

const ASSETS = [
  'feat_mls_template_library.js',
  'feat_mls_opnote_templates_ui.js',
  'feat_mls_opnote_room.js'
];
const OWNER_BY_ASSET = {
  'feat_mls_template_library.js': '__mlsTemplateLibrary',
  'feat_mls_opnote_templates_ui.js': '__mlsOpNoteTemplatesUi',
  'feat_mls_opnote_room.js': '__mlsOpNoteRoom'
};

/* ---- Static boundary and identity checks ---- */
const marker = /p1-ondemand-1\.[0-9]+\.[0-9]+/g;
ok((src.match(marker) || []).length >= 1,
  'the versioned p1 on-demand block is missing from 1p-mls-connect.js');
eq((src.match(/window\.__mlsP1OnDemand\s*=\s*\{/g) || []).length, 1,
  'expected exactly one __mlsP1OnDemand installation');
ok(/if\s*\(window\.__mlsP1OnDemand\)\s*return;/.test(src),
  'the block must re-entry-guard on window.__mlsP1OnDemand');

for (const name of ASSETS) {
  ok(src.indexOf(name) > -1, 'on-demand asset list is missing ' + name);
}
ok(/setAttribute\('data-mls-asset',\s*name\)/.test(src),
  'on-demand tags must use the exact data-mls-asset identity used by the deferred queue');
ok(!/setAttribute\('data-mls-asset',\s*'1p-/.test(src),
  'on-demand tags must not invent a 1p-prefixed asset identity');
ok(/name\s*\+\s*'\?v='\s*\+\s*\(window\.__MLS_AV\s*\|\|\s*Date\.now\(\)\)/.test(src),
  'on-demand and deferred paths must share NAME?v=__MLS_AV cache identity');
ok(/revert:\s*function/.test(src), 'p1 on-demand loader must expose revert()');
ok(/state:\s*function/.test(src), 'p1 on-demand loader must expose state() for diagnosis');

const markerAt = src.search(marker);
const blockStart = src.indexOf(';(function', markerAt);
const blockEndAt = src.indexOf('\n})();', blockStart);
ok(markerAt >= 0 && blockStart >= 0 && blockEndAt > blockStart,
  'could not isolate the executable p1 on-demand block');
const block = src.slice(blockStart, blockEndAt + '\n})();'.length);
ok(!/ScribeFlow\.html/.test(block), 'p1 on-demand block must not reference the production shell');
ok(!/'mls-connect\.js/.test(block), 'p1 on-demand block must not reference the production bundle');
ok(/catch\s*\(e\)\s*\{\s*\/\* never let a preview convenience break boot \*\/\s*\}/.test(block),
  'the preview enhancement must remain boot-safe');

/* ---- Minimal DOM/event runtime ---- */
class FakeEvent {
  constructor(type, init) {
    init = init || {};
    this.type = type;
    this.key = init.key;
    this.bubbles = init.bubbles !== false;
    this.cancelable = init.cancelable !== false;
    this.defaultPrevented = false;
    this.target = init.target || null;
    this.currentTarget = null;
    this.isTrusted = !!init.isTrusted;
    this._stopped = false;
    this._immediate = false;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
  stopImmediatePropagation() { this._stopped = true; this._immediate = true; }
}

class FakeScript {
  constructor(doc) {
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.tagName = 'SCRIPT';
    this.attributes = Object.create(null);
    this.dataset = Object.create(null);
    this.listeners = Object.create(null);
    this.parentNode = null;
    this.readyState = 'loading';
    this.installOwnerOnLoad = true;
    this.async = false;
    this.src = '';
  }
  setAttribute(name, value) {
    const v = String(value);
    this.attributes[name] = v;
    if (name === 'src') this.src = v;
    if (name.indexOf('data-') === 0) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = v;
    }
  }
  getAttribute(name) {
    if (name === 'src' && !Object.prototype.hasOwnProperty.call(this.attributes, name)) return this.src || null;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  addEventListener(type, fn, opts) {
    (this.listeners[type] || (this.listeners[type] = [])).push({ fn, once: !!(opts && opts.once) });
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((x) => x.fn !== fn);
  }
  emit(type) {
    if (type === 'load') {
      this.readyState = 'complete';
      const asset = this.getAttribute('data-mls-asset');
      const owner = OWNER_BY_ASSET[asset];
      if (this.installOwnerOnLoad && owner && this.ownerDocument.defaultView) {
        this.ownerDocument.defaultView[owner] = { installed: true };
      }
    }
    if (type === 'error') this.readyState = 'error';
    const ev = new FakeEvent(type, { target: this });
    const list = (this.listeners[type] || []).slice();
    for (const rec of list) {
      rec.fn.call(this, ev);
      if (rec.once) this.removeEventListener(type, rec.fn);
    }
    const prop = this['on' + type];
    if (typeof prop === 'function') prop.call(this, ev);
  }
}

class FakeEntry {
  constructor(doc, id, text) {
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.tagName = 'BUTTON';
    this.id = id || '';
    this.textContent = text || '';
  }
  closest(selector) { return selector.indexOf('button') >= 0 ? this : null; }
  click() { return this.ownerDocument.dispatch('click', this, { cancelable: true }); }
  dispatchEvent(event) { return this.ownerDocument.dispatch(event, this); }
}

class FakeDocument {
  constructor() {
    this.listeners = Object.create(null);
    this.scripts = [];
    this.appendHistory = [];
    this.activations = [];
    this.activeElement = null;
    const doc = this;
    this.body = {
      appendChild(node) {
        if (doc.scripts.indexOf(node) < 0) doc.scripts.push(node);
        doc.appendHistory.push(node);
        node.parentNode = this;
        return node;
      },
      removeChild(node) {
        const at = doc.scripts.indexOf(node);
        if (at >= 0) doc.scripts.splice(at, 1);
        node.parentNode = null;
        return node;
      }
    };
    this.head = this.body;
    this.documentElement = this.body;
  }
  addEventListener(type, fn, opts) {
    (this.listeners[type] || (this.listeners[type] = [])).push({
      fn,
      capture: opts === true || !!(opts && opts.capture),
      once: !!(opts && opts.once)
    });
  }
  removeEventListener(type, fn, opts) {
    const capture = opts === true || !!(opts && opts.capture);
    this.listeners[type] = (this.listeners[type] || []).filter((x) => x.fn !== fn || x.capture !== capture);
  }
  createElement(tag) {
    if (String(tag).toLowerCase() !== 'script') throw new Error('unexpected element: ' + tag);
    return new FakeScript(this);
  }
  querySelector(selector) {
    const m = String(selector).match(/script\[data-mls-asset=["']([^"']+)["']\]/);
    if (!m) return null;
    return this.scripts.find((s) => s.getAttribute('data-mls-asset') === m[1]) || null;
  }
  querySelectorAll(selector) {
    const m = String(selector).match(/script\[data-mls-asset=["']([^"']+)["']\]/);
    if (!m) return [];
    return this.scripts.filter((s) => s.getAttribute('data-mls-asset') === m[1]);
  }
  contains(node) { return this.scripts.indexOf(node) >= 0; }
  dispatch(typeOrEvent, target, init) {
    const ev = typeof typeOrEvent === 'string'
      ? new FakeEvent(typeOrEvent, Object.assign({}, init || {}, { target }))
      : typeOrEvent;
    if (!ev.target) ev.target = target;
    ev.currentTarget = this;
    const list = (this.listeners[ev.type] || []).slice();
    for (const rec of list) {
      if (!rec.capture) continue;
      rec.fn.call(this, ev);
      if (rec.once) this.removeEventListener(ev.type, rec.fn, { capture: true });
      if (ev._immediate) break;
    }
    if (!ev._stopped && target) {
      const activation = ev.type === 'click' || ev.type === 'pointerdown' ||
        (ev.type === 'keydown' && (ev.key === 'Enter' || ev.key === ' '));
      if (activation) this.activations.push({ target, type: ev.type });
    }
    if (!ev._stopped && !ev._immediate) {
      for (const rec of list) {
        if (rec.capture) continue;
        rec.fn.call(this, ev);
        if (rec.once) this.removeEventListener(ev.type, rec.fn, false);
        if (ev._immediate) break;
      }
    }
    return ev;
  }
}

function makeHarness() {
  const document = new FakeDocument();
  const timers = [];
  let nextTimer = 1;
  let clock = 0;
  const sandbox = {
    document,
    console,
    Date,
    Event: FakeEvent,
    MouseEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    Promise,
    setTimeout(fn, delay) {
      const id = nextTimer++;
      timers.push({ id, fn, due: clock + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) { const at = timers.findIndex((t) => t.id === id); if (at >= 0) timers.splice(at, 1); }
  };
  sandbox.window = sandbox;
  document.defaultView = sandbox;
  sandbox.__MLS_AV = 'p1-test-build';

  function install() {
    vm.runInNewContext(block, sandbox, { filename: '1p-ondemand-runtime.js', timeout: 1000 });
    assert(sandbox.__mlsP1OnDemand, 'real p1 on-demand block did not install');
    return sandbox.__mlsP1OnDemand;
  }
  function entry(id, text) { return new FakeEntry(document, id, text); }
  function seed(name) {
    const s = document.createElement('script');
    s.src = name + '?v=p1-test-build';
    s.setAttribute('data-mls-asset', name);
    document.body.appendChild(s);
    return s;
  }
  function tags(name) {
    return document.scripts.filter((s) => s.getAttribute('data-mls-asset') === name);
  }
  function created(name) {
    return document.appendHistory.filter((s) => s.getAttribute('data-mls-asset') === name);
  }
  function dispatch(type, target, init) {
    if (type === 'keydown') document.activeElement = target;
    return document.dispatch(type, target, init || {});
  }
  function flushTimers() {
    let turns = 0;
    while (true) {
      if (++turns > 100) throw new Error('on-demand timer loop did not settle');
      timers.sort((a, b) => a.due - b.due || a.id - b.id);
      const at = timers.findIndex((t) => t.due <= clock);
      if (at < 0) break;
      const task = timers.splice(at, 1)[0];
      task.fn();
    }
  }
  function advance(ms) {
    clock += Math.max(0, Number(ms) || 0);
    flushTimers();
  }
  return { sandbox, document, install, entry, seed, tags, created, dispatch, flushTimers, advance };
}

async function settle(h) {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    h.flushTimers();
  }
}

function assertOneTagPerAsset(h, label) {
  for (const name of ASSETS) {
    eq(h.tags(name).length, 1, label + ': expected exactly one active tag for ' + name);
    eq(h.created(name).length, 1, label + ': expected no duplicate fetch tag for ' + name);
  }
}

async function loadAll(h) {
  for (let i = 0; i < ASSETS.length; i++) {
    const tag = h.tags(ASSETS[i])[0];
    assert(tag, 'missing tag for ' + ASSETS[i]);
    tag.emit('load');
    await settle(h);
    if (i < ASSETS.length - 1) {
      eq(h.document.activations.length, 0,
        'the old surface opened before every on-demand script loaded');
    }
  }
}

async function proveColdActivation(type, key, id, text) {
  const h = makeHarness();
  const target = h.entry(id || (type === 'keydown' ? 'oprTabTpls' : 'templatesBtn'), text || 'Templates');
  h.install();
  const ev = h.dispatch(type, target, key ? { key } : {});

  eq(h.document.activations.length, 0,
    type + ': cold activation reached the base old-surface opener');
  ok(ev.defaultPrevented, type + ': cold activation must prevent the browser default while waiting');
  assertOneTagPerAsset(h, type);

  await loadAll(h);
  eq(h.document.activations.length, 1, type + ': ready handoff must continue exactly once');
  eq(h.document.activations[0].target, target, type + ': ready handoff changed the interaction target');
  await settle(h);
  eq(h.document.activations.length, 1, type + ': replay was captured again and looped');
}

async function run() {
  /* Direct mouse/touch-start, click, and keyboard entry must all use the same
     readiness handoff. */
  await proveColdActivation('pointerdown');
  await proveColdActivation('click');
  await proveColdActivation('keydown', 'Enter');
  await proveColdActivation('keydown', ' ');
  await proveColdActivation('click', null, 'opPrepSmartBtn', 'Prep op note');

  /* A real pointer sequence can deliver both pointerdown and click while the
     scripts are still cold. It is one user intent, not two future opens. */
  {
    const h = makeHarness();
    const target = h.entry('templatesBtn', 'Templates');
    h.install();
    const down = h.dispatch('pointerdown', target);
    const click = h.dispatch('click', target);
    eq(h.document.activations.length, 0, 'pointerdown/click pair leaked to the old surface');
    ok(down.defaultPrevented && click.defaultPrevented,
      'both halves of a cold pointer activation must be consumed while loading');
    assertOneTagPerAsset(h, 'pointer pair');
    await loadAll(h);
    eq(h.document.activations.length, 1, 'pointerdown/click pair replayed more than once');
    eq(h.document.activations[0].target, target, 'pointer pair replay changed the target');
  }

  /* Hover is only a head start. It cannot suppress anything and it cannot
     manufacture an activation when loading completes. */
  {
    const h = makeHarness();
    const target = h.entry('templatesBtn', 'Templates');
    h.install();
    const hover = h.dispatch('pointerover', target);
    ok(!hover.defaultPrevented && !hover._stopped, 'hover preload was incorrectly consumed');
    assertOneTagPerAsset(h, 'hover');
    await loadAll(h);
    eq(h.document.activations.length, 0, 'hover preload manufactured a click');
    const click = h.dispatch('click', target);
    await settle(h);
    ok(!click.defaultPrevented, 'ready click was needlessly suppressed after hover preload');
    eq(h.document.activations.length, 1, 'ready click after hover did not reach the surface once');
    eq(h.document.activations[0].target, target, 'hover path changed the later click target');
  }

  /* If the deferred queue already inserted a tag, the p1 handoff must observe
     that tag rather than duplicate it, and still wait for its load event. */
  {
    const h = makeHarness();
    const existing = h.seed(ASSETS[0]);
    const target = h.entry('oprTabTpls', 'Templates');
    h.install();
    const click = h.dispatch('click', target);
    ok(click.defaultPrevented, 'existing in-flight tag made a cold activation leak');
    eq(h.document.activations.length, 0, 'existing in-flight tag opened the old surface');
    assertOneTagPerAsset(h, 'existing tag');
    h.tags(ASSETS[1])[0].emit('load');
    h.tags(ASSETS[2])[0].emit('load');
    await settle(h);
    eq(h.document.activations.length, 0, 'handoff ignored the still-loading existing tag');
    existing.emit('load');
    await settle(h);
    eq(h.document.activations.length, 1, 'existing-tag handoff did not continue exactly once');
    eq(h.document.activations[0].target, target, 'existing-tag handoff lost its target');
  }

  /* The normal deferred queue can see an early tag and skip its own attempt.
     Therefore an error must remove/release that exact claim, and the next user
     activation must create a fresh tag instead of remaining permanently cold. */
  {
    const h = makeHarness();
    const firstTarget = h.entry('templatesBtn', 'Templates');
    const retryTarget = h.entry('oprTabTpls', 'Prep op notes');
    h.install();
    h.dispatch('click', firstTarget);
    h.tags(ASSETS[0])[0].emit('load');
    h.tags(ASSETS[1])[0].emit('load');
    h.tags(ASSETS[2])[0].emit('error');
    await settle(h);
    eq(h.document.activations.length, 0, 'failed upgrade fell through to the old surface');
    eq(h.tags(ASSETS[2]).length, 0, 'failed on-demand tag still blocks a deferred/retry load');
    eq(h.created(ASSETS[2]).length, 1, 'first failed asset attempt count is wrong');

    const retry = h.dispatch('click', retryTarget);
    ok(retry.defaultPrevented, 'retry activation leaked before the replacement script loaded');
    eq(h.tags(ASSETS[2]).length, 1, 'retry did not insert a replacement script tag');
    eq(h.created(ASSETS[2]).length, 2, 'retry reused a permanently failed script claim');
    eq(h.created(ASSETS[0]).length, 1, 'retry duplicated an already loaded dependency');
    eq(h.created(ASSETS[1]).length, 1, 'retry duplicated an already loaded dependency');
    h.tags(ASSETS[2])[0].emit('load');
    await settle(h);
    eq(h.document.activations.length, 1, 'successful retry did not continue exactly once');
    eq(h.document.activations[0].target, retryTarget,
      'successful retry replayed a stale target instead of the latest user intent');
  }

  /* A network-success `load` event is not enough if the module threw before
     publishing its owner. In that case the promised upgraded surface does not
     exist, so the activation must remain blocked and a later click must retry. */
  {
    const h = makeHarness();
    const target = h.entry('templatesBtn', 'Templates');
    h.install();
    h.dispatch('click', target);
    h.tags(ASSETS[0])[0].emit('load');
    h.tags(ASSETS[1])[0].emit('load');
    const missingOwner = h.tags(ASSETS[2])[0];
    missingOwner.installOwnerOnLoad = false;
    missingOwner.emit('load');
    await settle(h);
    eq(h.document.activations.length, 0,
      'script load without its installed owner opened a surface that does not exist');
    eq(h.tags(ASSETS[2]).length, 0,
      'ownerless loaded tag was not released for an explicit retry');

    const retry = h.dispatch('click', target);
    ok(retry.defaultPrevented, 'owner-missing retry leaked to the old surface');
    eq(h.created(ASSETS[2]).length, 2, 'owner-missing retry did not create a fresh tag');
    h.tags(ASSETS[2])[0].emit('load');
    await settle(h);
    eq(h.document.activations.length, 1, 'owner-missing retry did not continue exactly once');
    eq(h.document.activations[0].target, target, 'owner-missing retry lost its target');
  }

  /* A queue-created script may have settled before this late watcher joined,
     so neither load nor error will fire again. The readiness barrier needs a
     real ceiling: it must wait the whole 20 seconds, release the dead tag at
     that boundary, and allow the next activation to issue a fresh request. */
  {
    const h = makeHarness();
    const missed = h.seed(ASSETS[0]);
    missed.readyState = 'complete';
    const target = h.entry('templatesBtn', 'Templates');
    h.install();
    const first = h.dispatch('click', target);
    ok(first.defaultPrevented, 'missed-event existing tag let the cold click escape');
    h.tags(ASSETS[1])[0].emit('load');
    h.tags(ASSETS[2])[0].emit('load');
    await settle(h);
    eq(h.document.activations.length, 0, 'missed-event tag opened before its owner existed');
    eq(h.tags(ASSETS[0]).length, 1, 'missed-event tag was discarded before the timeout ceiling');

    h.advance(19999);
    await settle(h);
    eq(h.tags(ASSETS[0]).length, 1, 'missed-event tag timed out before 20,000ms');
    eq(h.document.activations.length, 0, 'missed-event activation replayed before 20,000ms');

    h.advance(1);
    await settle(h);
    eq(h.tags(ASSETS[0]).length, 0, '20,000ms timeout did not release the stale queue tag');
    eq(h.document.activations.length, 0, 'timeout fell through to the old surface');

    const retry = h.dispatch('click', target);
    ok(retry.defaultPrevented, 'post-timeout retry escaped before the fresh script loaded');
    eq(h.tags(ASSETS[0]).length, 1, 'post-timeout retry did not append a fresh tag');
    eq(h.created(ASSETS[0]).length, 2, 'post-timeout retry reused the dead queue tag');
    h.tags(ASSETS[0])[0].emit('load');
    await settle(h);
    eq(h.document.activations.length, 1, 'post-timeout retry did not continue exactly once');
    eq(h.document.activations[0].target, target, 'post-timeout retry lost the activation target');
  }

  /* Voice, command-palette and tour paths invoke the opener globals directly.
     A cold call must be held at the same barrier. If a feature module wraps the
     gate while loading, completion must enter that latest wrapper once; its
     call back through the gate must reach the captured base opener once. */
  {
    const h = makeHarness();
    const baseCalls = [];
    const receiver = { kind: 'voice-command' };
    h.sandbox.openTemplates = function () {
      baseCalls.push({ self: this, args: Array.prototype.slice.call(arguments) });
      return 'base-result';
    };
    h.sandbox.openOpPrepSmart = function () {};
    h.install();
    const gate = h.sandbox.openTemplates;

    gate.call(receiver, 'from-voice', 42);
    eq(baseCalls.length, 0, 'cold direct openTemplates call reached the base opener');
    assertOneTagPerAsset(h, 'cold direct opener');

    h.tags(ASSETS[0])[0].emit('load');
    await settle(h);
    eq(baseCalls.length, 0, 'direct opener escaped before all three owners were ready');

    let latestCalls = 0;
    const latestArgs = [];
    h.sandbox.openTemplates = function () {
      latestCalls++;
      latestArgs.push({ self: this, args: Array.prototype.slice.call(arguments) });
      return gate.apply(this, arguments);
    };
    h.tags(ASSETS[1])[0].emit('load');
    h.tags(ASSETS[2])[0].emit('load');
    await settle(h);

    eq(latestCalls, 1, 'ready direct call did not enter the latest wrapper exactly once');
    eq(baseCalls.length, 1, 'latest wrapper looped through the gate or skipped the base opener');
    eq(latestArgs[0].self, receiver, 'latest wrapper lost the direct call receiver');
    eq(baseCalls[0].self, receiver, 'base opener lost the direct call receiver');
    assert.deepStrictEqual(latestArgs[0].args, ['from-voice', 42],
      'latest wrapper did not receive the original direct-call arguments'); checks++;
    assert.deepStrictEqual(baseCalls[0].args, ['from-voice', 42],
      'base opener did not receive the original direct-call arguments'); checks++;
    await settle(h);
    eq(latestCalls, 1, 'direct latest-wrapper replay repeated after settlement');
    eq(baseCalls.length, 1, 'direct base opener repeated after settlement');
  }

  /* The op-note global has the same cold behavior, and a plain gate is restored
     by revert so 1p can be rolled back without leaving a function shim. */
  {
    const h = makeHarness();
    const calls = [];
    const receiver = { kind: 'tour' };
    const originalTemplates = function () { calls.push(['templates', this]); };
    const originalOpNote = function () {
      calls.push(['opnote', this].concat(Array.prototype.slice.call(arguments)));
    };
    h.sandbox.openTemplates = originalTemplates;
    h.sandbox.openOpPrepSmart = originalOpNote;
    const api = h.install();
    const opGate = h.sandbox.openOpPrepSmart;

    opGate.call(receiver, 'patient-42', { draft: true });
    eq(calls.length, 0, 'cold direct openOpPrepSmart call reached the base opener');
    await loadAll(h);
    eq(calls.length, 1, 'direct openOpPrepSmart did not replay exactly once');
    eq(calls[0][0], 'opnote', 'direct op-note gate replayed the wrong opener');
    eq(calls[0][1], receiver, 'direct op-note gate lost the call receiver');
    eq(calls[0][2], 'patient-42', 'direct op-note gate lost its first argument');
    assert.deepStrictEqual(calls[0][3], { draft: true },
      'direct op-note gate lost its object argument'); checks++;

    eq(api.revert(), true, 'direct-gate revert() did not report success');
    eq(h.sandbox.openTemplates, originalTemplates,
      'revert did not restore the original Templates global');
    eq(h.sandbox.openOpPrepSmart, originalOpNote,
      'revert did not restore the original op-note global');
  }

  /* Revert is a real behavioral rollback: it unbinds capture and cancels a
     pending replay, without needing to mutate the production application. */
  {
    const h = makeHarness();
    const target = h.entry('templatesBtn', 'Templates');
    const api = h.install();
    h.dispatch('click', target);
    eq(h.document.activations.length, 0, 'revert setup unexpectedly leaked the cold click');
    eq(api.revert(), true, 'revert() did not report success');
    await loadAll(h);
    eq(h.document.activations.length, 0, 'revert allowed a stale pending activation to replay');
    const after = h.dispatch('click', target);
    await settle(h);
    ok(!after.defaultPrevented && !after._stopped, 'revert left an activation capture listener behind');
    eq(h.document.activations.length, 1, 'click did not return to the untouched base behavior after revert');
  }

  console.log('PASS 1p-ondemand-templates (' + checks + ' assertions)');
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

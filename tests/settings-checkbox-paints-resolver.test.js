'use strict';
/* vnsync-1.0.0 control: THE SETTINGS CHECKBOX PAINTS WHAT THE RESOLVER SAYS -
 * INCLUDING WRITES IT DID NOT MAKE ITSELF.
 *
 * Reported 2026-08-25 (owner, via Codex): choosing the Full Visit Notes
 * behavior during first-run/startup does NOT change the corresponding
 * checkbox in Settings. CAUSE: #setPullVisitBodies repainted only inside
 * renderPullVisitBodiesSetting(), which runs when Settings opens. The
 * first-run Full/Faster choice dialog is allowed to appear while the
 * Settings panel is open (its visibility gate checks the agreements, invite
 * and setup modals - not #settingsModal), and the day-strip toggle is always
 * clickable, so a CONFIRMED resolver write from either owner left an
 * already-open Settings panel showing the stale state. Same-tab writes fire
 * no storage event; the qol-2.0 resolver broadcasts
 * 'mls:visit-notes-pref-changed' on every confirmed write for exactly this
 * reason (p1-visitpref-broadcast-1.0.0), and the strip checkbox already
 * listens (sbp-1.0). This suite proves the SETTINGS checkbox listens too.
 *
 * It executes the REAL shipped Settings block (pullVisitBodiesPref +
 * renderPullVisitBodiesSetting, extracted from ScribeFlow.html) against the
 * REAL shipped resolver (tests/lib-visit-notes-resolver's resolverSource from
 * mls-connect.js) in one context whose window can actually deliver the
 * broadcast. OLD BYTES FAIL CASE 1 BY NAME: the first-run choice saves and
 * the visible checkbox never moves. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { resolverSource } = require('./lib-visit-notes-resolver');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'latin1');

function extractFunction(src, name) {
  const tok = 'function ' + name + '(){';
  const at = src.indexOf(tok);
  assert.ok(at >= 0, name + ' present in ScribeFlow.html');
  assert.strictEqual(src.indexOf(tok, at + 1), -1, name + ' unique in ScribeFlow.html');
  const open = src.indexOf('{', at);
  let depth = 0, mode = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && src[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && src[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced ' + name);
}

const prefFnSrc = extractFunction(app, 'pullVisitBodiesPref');
const renderFnSrc = extractFunction(app, 'renderPullVisitBodiesSetting');

/* The fix under test, pinned by shape so a refactor that drops the guard or
 * the listener fails here by name rather than only behaviorally. */
assert.ok(renderFnSrc.indexOf("mls:visit-notes-pref-changed") >= 0,
  'the Settings checkbox wires the resolver confirmed-write broadcast');
assert.ok(renderFnSrc.indexOf("document.getElementById('setPullVisitBodies')===cb") >= 0,
  'the broadcast listener re-checks the live node so a replaced checkbox is never painted through a stale reference');

function makeStorage() {
  const store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    _store: store
  };
}

function makeNode(id) {
  const handlers = {};
  return {
    id, checked: undefined, dataset: {},
    addEventListener: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    fire: function (type) { for (const fn of handlers[type] || []) fn.call(this); },
    _handlers: handlers
  };
}

function makeHarness() {
  const storage = makeStorage();
  const winListeners = {};
  const toasts = [];
  const uns = s => 'sf_u::doc@clinic.example::' + s;
  const w = {
    uns,
    addEventListener: function (type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
    dispatchEvent: function (ev) { for (const fn of winListeners[ev.type] || []) fn(ev); return true; }
  };
  const doc = {
    node: makeNode('setPullVisitBodies'),
    getElementById: function (id) { return id === 'setPullVisitBodies' ? doc.node : null; }
  };
  const ctx = vm.createContext({
    window: w, localStorage: storage, document: doc,
    toast: (msg, kind) => { toasts.push({ msg: String(msg), kind }); },
    CustomEvent: function CustomEvent(type, opts) { this.type = type; this.detail = opts && opts.detail; }
  });
  vm.runInContext(resolverSource(), ctx, { filename: 'mls-connect:__mlsVisitNotesPref' });
  vm.runInContext(prefFnSrc + '\n' + renderFnSrc, ctx, { filename: 'ScribeFlow:settings-visit-notes' });
  const call = name => vm.runInContext(name + '();', ctx);
  return {
    storage, winListeners, toasts, doc,
    resolver: w.__mlsVisitNotesPref,
    render: () => call('renderPullVisitBodiesSetting'),
    listenerCount: () => (winListeners['mls:visit-notes-pref-changed'] || []).length
  };
}

(async function () {
  let n = 0;
  const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

  /* ---- 1. THE REPORTED DEFECT: Settings is open (rendered), the account is
   * settled but unset; the first-run choice dialog saves ON through the ONE
   * resolver's own admission path. The visible checkbox must repaint ON. ---- */
  {
    const h = makeHarness();
    h.render();
    assert.strictEqual(h.doc.node.checked, false, 'unset paints safe first-use OFF');
    const result = await h.resolver.ensureChosenForBulkPull({ settleTimeoutMs: 0, choose: () => Promise.resolve(true) });
    assert.strictEqual(result.reason, 'choice-saved', 'first-run choice saved through the resolver (fixture sanity)');
    assert.strictEqual(h.doc.node.checked, true,
      'the open Settings checkbox repaints ON when the first-run choice saves (old shape: repainted only on the next openSettings - the reported onboarding-vs-Settings desync)');
    ok('first-run choice while Settings is open repaints the Settings checkbox');
  }

  /* ---- 2. any other confirmed owner write repaints it too, both directions ---- */
  {
    const h = makeHarness();
    h.render();
    assert.strictEqual(h.resolver.write(true), true, 'confirmed ON write');
    assert.strictEqual(h.doc.node.checked, true, 'repainted ON');
    assert.strictEqual(h.resolver.write(false), true, 'confirmed OFF write');
    assert.strictEqual(h.doc.node.checked, false, 'repainted OFF');
    ok('confirmed writes from any owner repaint the Settings checkbox in both directions');
  }

  /* ---- 3. reopening Settings never double-wires: one broadcast listener per
   * node, and the change handler still writes through the resolver ---- */
  {
    const h = makeHarness();
    h.render(); h.render(); h.render();
    assert.strictEqual(h.listenerCount(), 1, 'three renders wire exactly one broadcast listener');
    h.doc.node.checked = true;
    h.doc.node.fire('change');
    assert.strictEqual(h.resolver.read().on, true, 'the human click wrote through the ONE resolver (read-back confirmed)');
    assert.ok(h.toasts.length === 1 && /every encounter note/.test(h.toasts[0].msg), 'confirmed save toasts the truthful ON copy');
    h.doc.node.checked = false;
    h.doc.node.fire('change');
    assert.ok(/its own-day note/.test(h.toasts[1].msg),
      'the OFF toast states the dayfacts contract: chart facts + own-day note read, historical notes skipped');
    ok('re-render is idempotent and the write-through + truthful toasts ride along');
  }

  /* ---- 4. teardown/rebuild: a replaced Settings checkbox is never painted
   * through the stale reference; the fresh node wires and paints on render ---- */
  {
    const h = makeHarness();
    h.render();
    const old = h.doc.node;
    h.doc.node = makeNode('setPullVisitBodies');
    assert.strictEqual(h.resolver.write(true), true, 'confirmed write after the node was replaced');
    assert.strictEqual(old.checked, false, 'the stale reference is left alone (id re-check guard)');
    assert.strictEqual(h.doc.node.checked, undefined, 'the fresh node is untouched until Settings renders it');
    h.render();
    assert.strictEqual(h.doc.node.checked, true, 'the fresh node paints the resolver truth on render');
    assert.strictEqual(h.resolver.write(false), true, 'and its own listener repaints it OFF');
    assert.strictEqual(h.doc.node.checked, false, 'fresh node tracks later writes');
    ok('replaced node: stale reference never painted, fresh node wires cleanly');
  }

  console.log('PASS settings-checkbox paints the resolver: first-run choice repaints an open Settings panel, both write directions tracked, single listener per node, stale-node guard holds (' + n + ' cases)');
})().catch(err => { console.error(err.stack || err); process.exit(1); });

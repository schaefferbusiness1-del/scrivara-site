'use strict';

/* WRITE-BACK WALKTHROUGH STRIP (wbw-1.0.0) - owner op-note v2 item 5.
 *
 * The unified Athena review keeps every safety property it has; the strip
 * only SHOWS the sequence (Pick -> Athena checks -> Confirm & write ->
 * Verify in Athena) with every state READ from the surface's own elements.
 * vm-driven (the base function is not proof): wrap-through, injection into
 * the module-owned node only, state transitions on the surface's real
 * signals, ZERO added action controls, clean revert. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mod = fs.readFileSync(path.join(root, 'feat_mls_writeback_walkthrough.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

assert(connect.includes('data-mls-asset="feat_mls_writeback_walkthrough.js"'), 'walkthrough module has no loader');
assert(!/wbwSteps[\s\S]{0,400}<button/.test(mod), 'the strip must not render buttons');
assert(mod.includes("mo.observe(el, { childList: true, subtree: true, characterData: true });") &&
  !/observe\(\s*document/.test(mod), 'observers must be element-scoped, never document-wide');

/* ---- harness ----------------------------------------------------------- */
function node(id) {
  var n = {
    id: id, innerHTML: '', textContent: '', style: {}, _listeners: {},
    parentElement: null, nextSibling: null, children: [],
    addEventListener: function (t, fn) { (n._listeners[t] = n._listeners[t] || []).push(fn); },
    removeEventListener: function () {},
    insertBefore: function (child) { child.parentElement = n; n.children.push(child); return child; },
    remove: function () { n._removed = true; },
    fire: function (t) { (n._listeners[t] || []).forEach(function (fn) { try { fn({}); } catch (e) {} }); }
  };
  return n;
}
const title = node('mlsAthenaUnifiedTitle');
const headerInner = node('hdrInner'); const headerBlock = node('hdrBlock'); const card = node('card');
title.parentElement = headerInner; headerInner.parentElement = headerBlock; headerBlock.parentElement = card;
const ov = node('mlsAthenaUnifiedConfirm');
const ctx = node('mlsAthenaUnifiedContext'); ctx.textContent = 'Exact Athena encounter: waiting for the read-only check.';
const rcpt = node('mlsAthenaUnifiedReceipt'); rcpt.textContent = '';
let host = null;
let radioChecked = false;
const observed = [];

const ctxVm = {
  console: console,
  MutationObserver: function (cb) { this.observe = function (el) { observed.push({ el: el, cb: cb }); }; this.disconnect = function () {}; },
  document: {
    getElementById: function (id) {
      if (id === 'mlsAthenaUnifiedConfirm') return ov;
      if (id === 'mlsAthenaUnifiedTitle') return title;
      if (id === 'mlsAthenaUnifiedContext') return ctx;
      if (id === 'mlsAthenaUnifiedReceipt') return rcpt;
      if (id === 'wbwSteps') return host;
      return null;
    },
    querySelector: function (sel) { return /:checked/.test(sel) && radioChecked ? {} : null; },
    createElement: function () { host = node('wbwSteps'); return host; },
    addEventListener: function () {}, removeEventListener: function () {}
  }
};
ctxVm.window = ctxVm;
let openCalls = 0;
ctxVm.__mlsWriteFlow = { openUnifiedConfirmation: function () { openCalls++; return 'opened'; } };

vm.createContext(ctxVm);
vm.runInContext(mod, ctxVm, { filename: 'feat_mls_writeback_walkthrough.js' });
const api = ctxVm.__mlsWritebackWalkthrough;
assert(api && api.installed && api.version === 'wbw-1.0.0', 'module did not install');
assert(ctxVm.__mlsWriteFlow.openUnifiedConfirmation.__wbwWrap, 'openUnifiedConfirmation was not wrapped');

/* open: callthrough + strip injected into the module-owned node */
const r = ctxVm.__mlsWriteFlow.openUnifiedConfirmation({});
assert.strictEqual(r, 'opened', 'wrap must call the real review through');
assert.strictEqual(openCalls, 1);
assert(host && host.parentElement === card, 'strip must inject into the review card');
assert(host.innerHTML.indexOf('Pick the action') >= 0 && host.innerHTML.indexOf('Verify in Athena') >= 0, 'all four steps must render');
assert(host.innerHTML.indexOf('<button') < 0, 'the strip must add ZERO action controls');
assert(/Pick one READY row/.test(host.innerHTML), 'initial hint must say everything is read-only');
assert.strictEqual(observed.length, 2, 'exactly the context and receipt boxes are observed');

/* pick -> step 1 done */
radioChecked = true; ov.fire('change');
assert(host.innerHTML.indexOf('✓ Pick the action') >= 0, 'a picked radio must mark step 1 done');

/* probe lands -> step 2 done */
ctx.textContent = 'Exact Athena encounter: 06/13/1951 encounter #1234, Dr. Schaeffer, editor open.';
observed[0].cb();
assert(host.innerHTML.indexOf('✓ Athena checks it') >= 0, 'a confirmed exact encounter must mark step 2 done');
assert(/Nothing is sent until you press Confirm/.test(host.innerHTML), 'the confirm hint must state nothing is sent yet');

/* write receipt -> step 3 done, verify is NOW */
rcpt.textContent = 'Write receipt: unsigned draft written to the confirmed encounter. Proof hash abc123.';
observed[1].cb();
assert(host.innerHTML.indexOf('✓ Confirm &amp; write') >= 0 || host.innerHTML.indexOf('✓ Confirm & write') >= 0, 'a write receipt must mark step 3 done');
assert(/Last step is yours/.test(host.innerHTML), 'step 4 must be handed to the doctor explicitly');

/* verified -> all done */
rcpt.textContent += ' Verified in Athena: read-back matches.';
observed[1].cb();
assert(/All four steps are done/.test(host.innerHTML), 'a verified read-back must complete the walkthrough');

/* a refusal never counts as written */
rcpt.textContent = 'Refused: wrong chart open. Nothing was written.';
observed[1].cb();
assert(host.innerHTML.indexOf('✓ Confirm') < 0, 'a refusal must NEVER read as written');

/* revert unwraps and removes */
api.revert();
assert(!ctxVm.__mlsWriteFlow.openUnifiedConfirmation.__wbwWrap, 'revert must restore the real openUnifiedConfirmation');
assert(host._removed, 'revert must remove the strip');

console.log('PASS write-back walkthrough: wrap-through, four live steps read from the surface (pick/check/write/verify), refusals never count as written, zero added controls, element-scoped observers, clean revert - all in vm');

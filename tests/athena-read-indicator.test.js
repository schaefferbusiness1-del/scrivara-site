'use strict';
/*
 * A FAILED ATHENA READ MUST BE VISIBLE WITHOUT INTERRUPTING
 * -----------------------------------------------------------------------------
 * Owner, 2026-08-06, twice: delete the orange failure toast ("I hate this
 * notification just get rid of it"), and then, once QA measured what that left
 * behind: "It should have an indicator."
 *
 * Both hold at once only if the signal is an INDICATOR and not a NOTIFICATION.
 * feat_athena_doctor.js v1.1.0 puts the read outcome on the control the doctor
 * would already use to investigate — #mlsAthenaDoctorBtn gains
 * data-mls-athena-read="failed" — and the next successful read clears it.
 *
 * WHY THE OBVIOUS PLACES WERE REJECTED, measured live by QA on b894/b905:
 *   - #mlsAthenaStatusDot DOES NOT EXIST. mls-connect.js pre-seeds
 *     window.__mlsAthenaStatusDot with {installed:true}, so the satellite's own
 *     installed-guard returns before it builds anything.
 *   - #mlsAsstPanel .as-status exists but reads __mlsConnTruth. Immediately
 *     after a failed search it still read "MLS Assist ready · Athena tab
 *     detected", because the CONNECTION was fine and only the READ failed. An
 *     indicator keyed to it is green in the pass and the fail case alike.
 *
 * This suite asserts the five receipts QA required, plus the two traps that
 * would make the indicator worse than nothing: silently dying on re-mount, and
 * becoming permanent furniture that never clears.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_athena_doctor.js'), 'utf8');

/* ---- a fake DOM with real attribute semantics ---------------------------
   The sibling toast suite's element() has setAttribute/getAttribute but NO
   removeAttribute, which would have made "the indicator clears" untestable
   there — and a clear that throws is exactly the bug this file exists to
   catch. Attributes are a real map here, and querySelectorAll walks the tree
   for the attribute selector the three notice modules share. */
function element(tag) {
  const node = {
    tagName: String(tag || '').toUpperCase(),
    id: '', className: '', textContent: '', parentNode: null,
    children: [], style: {}, attributes: Object.create(null),
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; },
    hasAttribute(name) { return name in this.attributes; },
    addEventListener() {},
    querySelector(selector) { return selector === '.mlsdoc-x' ? (this._dismiss || null) : null; },
    querySelectorAll() { return []; }
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return this._html || ''; },
    set(value) { this._html = String(value || ''); this._dismiss = { addEventListener() {} }; }
  });
  return node;
}

const html = element('html');
const body = element('body');
html.appendChild(element('head'));
html.appendChild(body);

function walk(node, out) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}
function findById(node, id) {
  return walk(node, []).find((n) => n.id === id) || null;
}

const document = {
  readyState: 'complete',            // so boot() mounts the button immediately
  head: html.children[0], body, documentElement: html,
  createElement: element,
  getElementById(id) { return findById(html, id); },
  querySelectorAll(selector) {
    const m = /^\[([a-z-]+)="([^"]*)"\]$/.exec(String(selector || ''));
    if (!m) return [];
    return walk(html, []).filter((n) => n.getAttribute(m[1]) === m[2]);
  },
  addEventListener() {}
};

/* The module re-mounts its button from a MutationObserver when the app blows it
   away. Capturing that callback is the only way to exercise the re-mount path
   without a browser — and it is the path where a naive indicator dies. */
let observerCallback = null;
class FakeMutationObserver {
  constructor(fn) { observerCallback = fn; }
  observe() {}
  disconnect() {}
}

const ctx = {
  console, document, MutationObserver: FakeMutationObserver,
  setTimeout() { return 1; }, clearTimeout() {},
  addEventListener() {}, removeEventListener() {},
  postMessage() {}
};
ctx.window = ctx;

vm.runInNewContext(source, ctx, { filename: 'feat_athena_doctor.js', timeout: 1000 });
const api = ctx.__mlsAthenaDoctor;
assert(api && api.installed, 'Athena doctor did not install');
assert.strictEqual(api.version, '1.1.1');

const dispatch = (data) => api._onResultMessage({ data });
const btn = () => document.getElementById('mlsAthenaDoctorBtn');
const state = () => (btn() ? btn().getAttribute('data-mls-athena-read') : '<no button>');
const bars = () => document.querySelectorAll('[data-mls-athena-pull-failure="1"]').length;
const toast = () => document.getElementById('mlsAthenaDoctorToast');

assert(btn(), 'the Troubleshoot control did not mount — it is the ONLY discovery route and now the only indicator');
assert.strictEqual(state(), null, 'the indicator was raised before any read failed');

/* ---- RECEIPT 1: a failed SEARCH raises it (the owner's screenshotted path) */
const searchFail = { source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-search-1', ok: false, reason: 'no-form' };
dispatch(searchFail);
assert.strictEqual(state(), 'failed', 'a failed Athena search left no indicator at all');
assert.strictEqual(bars(), 0, 'RECEIPT 3 VIOLATED: the deleted orange bar came back through the indicator');
assert.strictEqual(toast(), null, 'a failed search raised a toast');
assert(/did not complete/.test(btn().getAttribute('aria-label') || ''),
  'the indicator is colour-only — a doctor who cannot separate those two backgrounds gets nothing');
assert(btn().getAttribute('title'), 'the indicator has no hover explanation');

/* ---- RECEIPT 2: the next successful read clears it ---------------------- */
dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-ok-1', ok: true, results: [{}, {}] });
assert.strictEqual(state(), null, 'RECEIPT 2 VIOLATED: the indicator survived a successful read and is now furniture');
assert.strictEqual(btn().getAttribute('aria-label'), 'Troubleshoot the MLS Assist Athena connection',
  'the aria-label was left describing a failure that has been resolved');
assert.strictEqual(btn().getAttribute('title'), null, 'the stale hover explanation was left behind');

/* ---- RECEIPT 4: the success toast is byte-identical to QA's before-shot -- */
const okToast = toast();
assert(okToast && okToast.className === 'ok', 'the honest success line stopped speaking');
assert(okToast.innerHTML.includes('✓ Athena search returned 2 results.'),
  'the success line changed wording — QA pins this string against a live before-shot');

/* ---- RECEIPT 1 again, PULL path ---------------------------------------- */
const pullFail = { source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'qa-pull-1', ok: false, reason: 'no-tab' };
dispatch(pullFail);
assert.strictEqual(state(), 'failed', 'a failed Athena pull left no indicator');
assert.strictEqual(bars(), 0, 'the pull path raised a failure bar');

/* ---- THE RE-MOUNT TRAP -------------------------------------------------
   boot()'s observer re-creates the button whenever the app removes it. A fresh
   element carries no attribute, so an indicator painted only at failure time
   would vanish on the next re-render and the doctor would never know a read
   had failed. State lives in the module, not on the node. */
body.removeChild(btn());
assert.strictEqual(btn(), null, 'the button was not actually removed — the trap is not being exercised');
assert(observerCallback, 'the re-mount observer was never registered, so this trap cannot be tested');
observerCallback();
assert(btn(), 'the observer did not re-mount the Troubleshoot control');
assert.strictEqual(state(), 'failed', 'THE INDICATOR DIED ON RE-MOUNT — a failed read is silent again after any re-render');

/* ---- a zero-result read SUCCEEDED, so it clears ------------------------- */
dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-zero-1', ok: true, results: [] });
assert.strictEqual(state(), null, 'a zero-result read was treated as a failure — it is a read that WORKED and found nothing');
assert(toast() && toast().className === 'info', 'the zero-result line stopped speaking');

/* ---- managed/background traffic never touches the doctor's own signal --- */
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'mlssi-mabc12-fail1', ok: false, reason: 'no-tab' });
assert.strictEqual(state(), null, 'a background batch failure raised the doctor-facing indicator');
dispatch(pullFail);
assert.strictEqual(state(), 'failed', 'setup for the managed-success check did not raise the indicator');
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'mlssi-mabc12-ok1', ok: true, visits: [{}] });
assert.strictEqual(state(), 'failed', 'a background batch success erased a real manual failure the doctor never saw resolved');

/* ---- RECEIPT 5 --------------------------------------------------------- */
assert.strictEqual(api.ownsPullNotices, true,
  'RECEIPT 5 VIOLATED: Clarity and Save Verify stand down only on this flag, so the deleted bar returns from another module');

/* ---- NEGATIVE CONTROL: prove the probe can fail ------------------------
   Every assertion above reads the same attribute. If paintReadState silently
   stopped writing it, most of them would still pass by reading null. Force the
   opposite value and confirm the reader sees the change. */
btn().setAttribute('data-mls-athena-read', 'sentinel');
assert.strictEqual(state(), 'sentinel', 'the state reader is not observing the real attribute — every result above is meaningless');
dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-ok-2', ok: true, results: [{}] });
assert.strictEqual(state(), null, 'a successful read did not overwrite a foreign value on the indicator attribute');

/* =========================================================================
 * v1.1.1 — THE TWO DEFECTS QA FOUND ON THE OWNER'S LIVE BROWSER
 *
 * DEFECT 1, and it nullified the whole feature: the indicator was landing on a
 * button with computed display:none, 0x0, offsetParent null. Not conditional —
 * feat_mls_topbar_unify.js:117 lists #mlsAthenaDoctorBtn in MENU_ITEMS and :326
 * adds .mlsTbHidden {display:none !important} to every one of them at install.
 * The floating Troubleshoot button has not been visible since that module
 * shipped; the rendered entry point is the "☰ Menu" button it creates. v1.1.0
 * was therefore present, correct and UNREACHABLE — a perfect indicator on a
 * control the doctor cannot see, which is the same silence he asked us to fix,
 * one layer down.
 *
 * DEFECT 2: a good read cleared data-mls-athena-read and the aria-label but left
 * the tooltip saying "The last Athena read did not complete". The app mirrors a
 * native title into its universal data-tip layer, so clearing only `title` left
 * a permanent false alarm — produced by the fix for silence.
 *
 * Everything below fails against v1.1.0.
 * ====================================================================== */
const menuBtn = element('button');
menuBtn.id = 'mlsTbMenuBtn';
menuBtn.setAttribute('data-tip', 'Open the menu');   // a pre-existing tooltip that MUST come back
body.appendChild(menuBtn);
observerCallback();                                   // the surface appeared after boot

const menuState = () => menuBtn.getAttribute('data-mls-athena-read');
const tip = (el) => el.getAttribute('data-tip');

/* DEFECT 1 — the rendered surface must carry the state, not only the hidden one. */
dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-vis-1', ok: false, reason: 'no-form' });
assert.strictEqual(menuState(), 'failed',
  'DEFECT 1: the ☰ Menu button carries no state. #mlsAthenaDoctorBtn is display:none under feat_mls_topbar_unify, so the indicator is invisible in normal use');
assert.strictEqual(state(), 'failed', 'the original control stopped being painted — it is the surface when topbar_unify is absent or reverted');
assert(/did not complete/.test(menuBtn.getAttribute('aria-label') || ''),
  'the Menu surface is dot-only — colour and shape must never be the only channel');
assert.strictEqual(tip(menuBtn), 'The last Athena read did not complete. Open to see why.',
  'the Menu surface has no hover explanation');

/* DEFECT 2 — the tooltip must clear, on BOTH surfaces, and restore EXACTLY. */
dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-vis-2', ok: true, results: [{}] });
assert.strictEqual(menuState(), null, 'the Menu surface kept the failed state after a good read');
assert(!/did not complete/.test(tip(menuBtn) || ''),
  'DEFECT 2: a good read left the tooltip claiming the last read failed — a permanent false alarm on a control the doctor hovers');
assert.strictEqual(tip(menuBtn), 'Open the menu',
  'the host tooltip was not restored EXACTLY — this is another lane\'s node and clearing must never invent or destroy its text');
assert.strictEqual(menuBtn.getAttribute('aria-label'), null,
  'an aria-label was invented on a button that never had one');
assert(!/did not complete/.test(btn().getAttribute('data-tip') || ''), 'the original control kept a stale data-tip');
assert.strictEqual(btn().getAttribute('title'), null, 'the original control kept a stale native title');

/* THE STASH-POISONING PATH, and it took a mutation test to find that the
   obvious version of this check was vacuous. A repeated FAILURE cannot reach
   the paint at all — setReadState returns early when the state is unchanged —
   so dispatching two failures proves nothing about double-stashing.

   The path that DOES re-raise an already-raised element is the re-mount: the
   observer re-creates #mlsAthenaDoctorBtn and repaints every surface, and the
   ☰ Menu button is NOT re-created, so it gets a second raiseOn while already
   carrying the failure text. Without the early return in raiseOn, that second
   pass stashes "The last Athena read did not complete" AS the host's original
   tooltip, and the real one is gone for the rest of the session. */
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'qa-vis-3', ok: false, reason: 'no-tab' });
assert.strictEqual(menuState(), 'failed', 'setup: the failure did not raise the Menu surface');
body.removeChild(btn());
observerCallback();                      // re-mount + repaint, with the Menu already raised
assert(btn(), 'the re-mount did not restore the original control');
assert.strictEqual(menuState(), 'failed', 'the re-mount dropped the Menu surface state');
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'qa-vis-5', ok: true, visits: [{}] });
assert.strictEqual(tip(menuBtn), 'Open the menu',
  'STASH POISONED: a repaint while already raised saved the failure text as the host tooltip, so the real one is unrecoverable');
assert.strictEqual(menuState(), null, 'the second cycle did not clear');

console.log('PASS Athena read indicator: both failure paths raise it on every RENDERED surface (the ☰ Menu button, since ' +
  'feat_mls_topbar_unify hides the original), any successful read including zero-result clears it, tooltip and aria-label ' +
  'restore exactly and survive repeat cycles, it survives re-mount, background traffic never moves it, 0 failure bars ' +
  'throughout, and the reader is negative-controlled');

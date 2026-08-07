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
    querySelectorAll(selector) {
      /* Only the slot sweep needs this; everything else keeps the old stub. */
      if (String(selector) !== 'button') return [];
      return walk(this, []).filter((n) => n !== this && n.tagName === 'BUTTON');
    },
    /* Layout, so "is it actually on screen" is testable. 0x0 by default —
       a node must be given a box explicitly, mirroring the real defect where
       every id we named turned out to have none. */
    _box: { width: 0, height: 0 },
    getBoundingClientRect() { return { width: this._box.width, height: this._box.height }; }
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
    const sel = String(selector || '');
    const m = /^\[([a-z-]+)="([^"]*)"\]$/.exec(sel);
    if (m) return walk(html, []).filter((n) => n.getAttribute(m[1]) === m[2]);
    /* The affordance sweep's compound selector. Supported explicitly rather
       than left returning [] — a stub that silently matches nothing makes the
       code under test unreachable, and a mutation pass caught exactly that:
       deleting the whole sweep left this suite green. Each clause is
       "<ancestor id> <descendant test>". */
    const clauses = sel.split(',').map((c) => c.trim()).filter(Boolean);
    if (!clauses.length) return [];
    const out = [];
    for (const c of clauses) {
      const parts = /^#([A-Za-z0-9_-]+)\s+(.+)$/.exec(c);
      if (!parts) return [];                       // unknown shape: fail loudly, not silently
      const root = findById(html, parts[1]);
      if (!root) continue;
      const test = parts[2];
      for (const n of walk(root, [])) {
        if (n === root) continue;
        const hit =
          (test === 'button' && n.tagName === 'BUTTON') ||
          (test === '[data-dest="tools"]' && n.getAttribute('data-dest') === 'tools') ||
          (test === '[role="button"]' && n.getAttribute('role') === 'button');
        if (hit && out.indexOf(n) < 0) out.push(n);
      }
    }
    return out;
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

/* Capture console.warn rather than let it through: the module is SUPPOSED to
   warn when a failure has nowhere visible to live, so that warning is a result
   to assert, not noise to print. */
const warnings = [];
const captureConsole = Object.assign(Object.create(console), {
  warn: (...a) => { warnings.push(a.join(' ')); }
});

const ctx = {
  console: captureConsole, document, MutationObserver: FakeMutationObserver,
  setTimeout() { return 1; }, clearTimeout() {},
  addEventListener() {}, removeEventListener() {},
  postMessage() {}
};
ctx.window = ctx;

vm.runInNewContext(source, ctx, { filename: 'feat_athena_doctor.js', timeout: 1000 });
const api = ctx.__mlsAthenaDoctor;
assert(api && api.installed, 'Athena doctor did not install');
assert.strictEqual(api.version, '1.1.4');

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

/* =========================================================================
 * v1.1.2 — THE MENU ROW IS A DIFFERENT NODE AGAIN.
 *
 * QA, re-measuring: the visible "Troubleshoot Athena" the doctor reaches is not
 * the hidden original relocated — feat_mls_topbar_unify.js:232 createMenuRow()
 * builds a BRAND NEW <button> from the item's `label` and `icon` STRINGS. It
 * inherits no attribute, no class and no aria-label from the source element, so
 * painting the original (or even the ☰ Menu button) still leaves the row the
 * doctor actually clicks carrying nothing. The dot on Menu says "something in
 * here"; without this the doctor cannot tell WHICH row.
 *
 * The row is destroyed and rebuilt by reconcileMenuContent() on every menu
 * rebuild, so it is re-painted from module state like every other surface — and
 * that rebuild is exercised below, because a row that only gets painted once is
 * a row that is blank the second time the menu opens.
 * ====================================================================== */
function buildMenuRow() {                       // mirrors createMenuRow's shape
  const row = element('button');
  row.setAttribute('data-mls-topbar-owned', '1');
  row.setAttribute('data-mls-menu-key', 'athena-help');
  row.textContent = '🔧 Troubleshoot Athena';
  return row;
}
let row = buildMenuRow();
body.appendChild(row);
observerCallback();

dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-row-1', ok: false, reason: 'no-form' });
assert.strictEqual(row.getAttribute('data-mls-athena-read'), 'failed',
  'the dropdown ROW carries no state — it is the control the doctor actually clicks, and createMenuRow builds it fresh from strings');
assert(/did not complete/.test(row.getAttribute('aria-label') || ''), 'the row has no accessible failure text');
assert(/Troubleshoot Athena/.test(row.getAttribute('aria-label') || ''),
  'the row announces itself with a borrowed label — its aria-label must be derived from its OWN text, not the Menu button\'s');

/* The menu is rebuilt: the old row is destroyed and a new one inserted. A
   surface painted only at failure time is blank on the second open. */
body.removeChild(row);
row = buildMenuRow();
body.appendChild(row);
observerCallback();
assert.strictEqual(row.getAttribute('data-mls-athena-read'), 'failed',
  'a REBUILT menu row lost the state — the doctor opens the menu a second time and sees nothing');

dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-row-2', ok: true, results: [{}] });
assert.strictEqual(row.getAttribute('data-mls-athena-read'), null, 'the rebuilt row kept a resolved failure');
assert(!/did not complete/.test(row.getAttribute('data-tip') || ''), 'the row kept a stale tooltip after a good read');

/* QA'S ACTUAL RECEIPT, in the form they run it live: a surface OTHER than the
   permanently-hidden original must carry the state. An assertion on
   #mlsAthenaDoctorBtn alone passes forever while the doctor sees nothing —
   which is exactly what happened at b911. The true visibility check needs a
   browser (computed display + box height) and is QA's to run; this is the
   strongest proxy available without one. */
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'qa-vis-9', ok: false, reason: 'no-tab' });
const carriers = [menuBtn, row].filter((el) => el.getAttribute('data-mls-athena-read') === 'failed');
assert(carriers.length >= 2,
  'ANY_VISIBLE_SURFACE_CARRIES_STATE would be false: only the .mlsTbHidden original was painted');

/* =========================================================================
 * v1.1.3 — THE RECEIPT, NOT THE ID.
 *
 * Three ids in a row were named as "the visible surface" and all three were
 * measured off-screen by QA on the owner's browser:
 *   b911  #mlsAthenaDoctorBtn  .mlsTbHidden -> display:none
 *   b915  #mlsTbMenuBtn        itself inline-flex, PARENT #mlsTbMenu display:none
 *   b920  the dropdown row     exists only while the menu is open
 * The rendered control in that header slot today is #mlsAccountMenuBtn — and
 * naming it would just queue the fourth correction.
 *
 * So the module resolves structurally: every rendered <button> inside the
 * header menu slot #mlsRdMenuSlot is painted, whatever it is called. The slot
 * is the stable thing; its occupants are not. This section proves that with a
 * button whose id the module has never heard of.
 *
 * And the assertion is QA's receipt rather than an id: after a failed read, at
 * least one surface that is REALLY RENDERED carries the state. An assertion
 * naming any id passes forever while the doctor sees nothing — which is
 * precisely what shipped three times.
 * ====================================================================== */
const slot = element('div');
slot.id = 'mlsRdMenuSlot';
slot._box = { width: 106, height: 38 };
body.appendChild(slot);

/* The occupant. Deliberately an id the module does not know, standing in for
   whatever supersedes #mlsAccountMenuBtn next. */
const futureBtn = element('button');
futureBtn.id = 'mlsSomeFutureMenuBtn';
futureBtn._box = { width: 106, height: 38 };
futureBtn.setAttribute('aria-label', 'Account');
slot.appendChild(futureBtn);

/* A sibling that is present but NOT rendered — it must never be mistaken for
   the affordance, which is the whole failure mode being fixed. */
const hiddenSibling = element('button');
hiddenSibling.id = 'mlsRdNewBtn';
slot.appendChild(hiddenSibling);

observerCallback();
dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-slot-1', ok: false, reason: 'no-form' });

assert.strictEqual(futureBtn.getAttribute('data-mls-athena-read'), 'failed',
  'the rendered occupant of the header menu slot was not painted — the indicator still needs a code change every time a topbar lane swaps that component');
/* The zero-box sibling IS painted, deliberately. Filtering the paint list to
   rendered nodes looks tidier and is wrong: a surface hidden at the moment of
   failure would then never be painted, and when it later becomes visible it
   would show nothing. Visibility usually flips by toggling a class on an
   ANCESTOR, which a childList/subtree observer never sees, so there is no
   second chance. Painting a hidden node costs one attribute; missing the
   signal costs the whole feature. Rendered-ness is a REPORTING filter, in
   renderedFailureSurfaces() below — never a painting decision. */
assert.strictEqual(hiddenSibling.getAttribute('data-mls-athena-read'), 'failed',
  'a currently-hidden slot control was skipped — it will show nothing if it becomes visible while the failure still stands');
assert(/Account/.test(futureBtn.getAttribute('aria-label') || ''),
  'the slot occupant lost its own label instead of having the failure appended to it');

/* THE DOT'S CSS MUST BE GENERIC. Painting the right node draws nothing if the
   only rules are per-id — the same invisible indicator in a new disguise, and
   the failure this whole section exists to prevent. Asserted against the BUILT
   stylesheet text, because the rules are assembled by string concatenation and
   a source-level grep cannot see the finished selector. */
const styleEl = document.getElementById('mls-athena-doctor-style');
assert(styleEl, 'the module built no stylesheet');
/* The selector must stand ALONE at a rule boundary. A first attempt at this
   assertion used /[^\]]\[data-mls-athena-read…/ and was VACUOUS: the character
   before the bracket in `#mlsAthenaDoctorBtn[data-mls-athena-read…` is "n",
   which satisfied it, so the per-id rule passed the generic check. Caught by
   mutating the generic rule away and watching the suite stay green. */
assert(/(?:^|\})\s*\[data-mls-athena-read="failed"\]::after\s*\{[^}]*content/.test(styleEl.textContent),
  'the failure dot is defined only per-id — a surface resolved structurally would carry the attribute and render nothing');

/* QA'S RECEIPT, exactly as they run it live. */
const rendered = api.renderedFailureSurfaces();
assert(rendered.length > 0,
  'ANY_VISIBLE_SURFACE_CARRIES_STATE is FALSE — after a failed read nothing that is actually on screen carries data-mls-athena-read="failed"');
assert(rendered.indexOf(futureBtn) >= 0, 'the rendered surface list does not contain the one control that is on screen');

dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-slot-2', ok: true, results: [{}] });
assert.strictEqual(futureBtn.getAttribute('data-mls-athena-read'), null, 'the slot occupant kept a resolved failure');
assert.strictEqual(futureBtn.getAttribute('aria-label'), 'Account', 'the slot occupant did not get its own label back verbatim');
assert.strictEqual(api.renderedFailureSurfaces().length, 0, 'a good read left a rendered surface still claiming failure');

/* v1.1.4 — THE AFFORDANCE ITSELF, found by NAME.
   QA measured every element containing "Troubleshoot Athena" as 0x0 and asked
   whether the doctor can reach it at all. He can: it moved to the DOCK's Tools
   menu (feat_mls_calm_shell.js:1108), after feat_mls_redesign.js:148 hid
   #mlsTbMenu outright — their reading was taken with that menu CLOSED, where a
   row is 0x0 by design. So the dock's Tools launcher is a real surface, and so
   is anything that NAMES the affordance. */
const dock = element('div'); dock.id = 'mlsDock'; dock._box = { width: 697, height: 82 };
const toolsBtn = element('button');
toolsBtn.setAttribute('data-dest', 'tools');
toolsBtn.textContent = 'Tools';
toolsBtn._box = { width: 64, height: 48 };
dock.appendChild(toolsBtn);
body.appendChild(dock);

const toolsMenu = element('div'); toolsMenu.id = 'mlsToolsMenu';
const toolsRow = element('button');
toolsRow.textContent = '🔧 Troubleshoot Athena';
toolsRow._box = { width: 96, height: 32 };
const unrelatedRow = element('button');
unrelatedRow.textContent = 'Snapshot';
unrelatedRow._box = { width: 96, height: 32 };
toolsMenu.appendChild(toolsRow);
toolsMenu.appendChild(unrelatedRow);
body.appendChild(toolsMenu);

observerCallback();
dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-dock-1', ok: false, reason: 'no-form' });
assert.strictEqual(toolsBtn.getAttribute('data-mls-athena-read'), 'failed',
  'the dock Tools launcher carries no state — it is the route to Troubleshoot Athena now that #mlsTbMenu is display:none');
assert.strictEqual(toolsRow.getAttribute('data-mls-athena-read'), 'failed',
  'the Tools row that NAMES Troubleshoot Athena was not painted — discovery by name is what ends the id chase');
assert.strictEqual(unrelatedRow.getAttribute('data-mls-athena-read'), null,
  'an unrelated Tools row was painted — the name match is too loose and every menu item would wear an Athena dot');
dispatch({ source: 'mls-ext', type: 'mlsAppSearchResult', id: 'qa-dock-2', ok: true, results: [{}] });
assert.strictEqual(toolsBtn.getAttribute('data-mls-athena-read'), null, 'the dock launcher kept a resolved failure');
assert.strictEqual(toolsRow.getAttribute('data-mls-athena-read'), null, 'the Tools row kept a resolved failure');

/* v1.1.4 — AN INDICATOR WITH NOWHERE TO LIVE IS A PRODUCT BUG, AND IT SAYS SO.
   QA: "if the set comes back EMPTY that is not a no-op." Three rounds went into
   moving paint around before anyone asked whether the affordance was reachable
   at all. Earlier in this run there was no rendered surface, so the module must
   have said so — once, on the console, never as a toast (the owner deleted the
   toast), and it must leave a flag a live probe can read without watching the
   console. */
assert(warnings.some((w) => /NO rendered surface/.test(w)),
  'a failure with no rendered surface passed silently — the unreachable-affordance case must announce itself');
assert.strictEqual(warnings.filter((w) => /NO rendered surface/.test(w)).length, 1,
  'the unreachable warning repeats — it must fire once, not once per failed read');
assert.strictEqual(ctx.__mlsAthenaReadIndicatorUnreachable, false,
  'the unreachable flag is still set even though a rendered surface now carries the state');

/* NEGATIVE CONTROL on the receipt itself: if every candidate loses its box —
   the exact live situation at b911/b915 — the receipt must go FALSE. A receipt
   that cannot fail is the vacuous-pass class all over again. */
const boxes = api.readSurfaces().map((el) => [el, el._box]);
boxes.forEach(([el]) => { el._box = { width: 0, height: 0 }; });
dispatch({ source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'qa-slot-3', ok: false, reason: 'no-tab' });
assert.strictEqual(api.renderedFailureSurfaces().length, 0,
  'the receipt reports a rendered surface when every candidate is 0x0 — it would have passed at b911 and b915, and it must not');
assert.strictEqual(ctx.__mlsAthenaReadIndicatorUnreachable, true,
  'every surface is 0x0 and the unreachable flag did not go true — this is the live b911/b915 state and it must be announced');
boxes.forEach(([el, box]) => { el._box = box; });
assert(api.renderedFailureSurfaces().length > 0, 'the receipt did not recover when the surfaces regained their boxes');

console.log('PASS Athena read indicator: both failure paths raise it on every RENDERED surface (the ☰ Menu button, since ' +
  'feat_mls_topbar_unify hides the original), any successful read including zero-result clears it, tooltip and aria-label ' +
  'restore exactly and survive repeat cycles, it survives re-mount, background traffic never moves it, 0 failure bars ' +
  'throughout, and the reader is negative-controlled');
